const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { initializeAutoUpdater } = require('./auto-updater.cjs');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// GSTZen API Configuration
const GSTZEN_API_URL = process.env.VITE_GSTZEN_API_URL || 'https://staging.gstzen.in';

// GSTZen API Helper Function
async function gstzenApiCall(endpoint, options = {}) {
    const url = `${GSTZEN_API_URL}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    try {
        console.log('[GSTZen Main] Request:', options.method || 'GET', url);
        if (options.body) {
            console.log('[GSTZen Main] Payload:', options.body);
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        const text = await response.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch (e) {
            console.error('Failed to parse JSON response:', text.substring(0, 100));
            data = { error: 'Invalid JSON response', raw: text.substring(0, 1000) };
        }

        console.log(`[GSTZen Main] Response (${response.status}) ${url}:`, JSON.stringify(data, null, 2));

        return {
            ok: response.ok,
            status: response.status,
            data,
        };
    } catch (error) {
        console.error('[GSTZen Main] Error:', error);
        return {
            ok: false,
            status: 0,
            data: { error: error.message },
        };
    }
}

// IPC Handlers for GSTZen API
function setupGstzenHandlers() {
    // Login
    ipcMain.handle('gstzen:login', async (event, credentials) => {
        return await gstzenApiCall('/accounts/api/login/token/', {
            method: 'POST',
            body: JSON.stringify(credentials),
        });
    });

    // Customer operations
    ipcMain.handle('gstzen:getCustomerByEmail', async (event, { email, token }) => {
        return await gstzenApiCall(`/api/customer/by-email/${email}/`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
        });
    });

    ipcMain.handle('gstzen:createCustomer', async (event, { customerData, token }) => {
        return await gstzenApiCall('/api/customer/create/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(customerData),
        });
    });

    // GSTIN operations
    ipcMain.handle('gstzen:getGstins', async (event, { customerUuid, token }) => {
        return await gstzenApiCall(`/api/customer/${customerUuid}/gstins/`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
        });
    });

    ipcMain.handle('gstzen:addGstin', async (event, { customerUuid, gstinData, token }) => {
        return await gstzenApiCall(`/api/customer/${customerUuid}/gstins/`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(gstinData),
        });
    });

    ipcMain.handle('gstzen:updateGstinCredentials', async (event, { gstinUuid, credentials, token }) => {
        return await gstzenApiCall(`/api/gstin/${gstinUuid}/credentials/`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(credentials),
        });
    });

    ipcMain.handle('gstzen:testGstinConnection', async (event, { gstinUuid, token }) => {
        return await gstzenApiCall(`/api/gstin/${gstinUuid}/test-connection/`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
        });
    });

    // GSTN OTP Login
    ipcMain.handle('gstzen:generateOtp', async (event, { requestData, token }) => {
        return await gstzenApiCall('/api/gstn-generate-otp/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(requestData),
        });
    });

    ipcMain.handle('gstzen:establishSession', async (event, { requestData, token }) => {
        return await gstzenApiCall('/api/gstn-establish-session/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(requestData),
        });
    });

    // GSTR1 Downloads
    ipcMain.handle('gstzen:downloadGstr1', async (event, { downloadRequest, token }) => {
        return await gstzenApiCall('/api/gstr1/download/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(downloadRequest),
        });
    });

    // GSTIN Validation
    ipcMain.handle('gstzen:validateGstins', async (event, { gstinList, token }) => {
        return await gstzenApiCall('/api/multiple-gstin-validator/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ gstin_list: gstinList }),
        });
    });

    // Create GSTIN
    ipcMain.handle('gstzen:createGstin', async (event, { gstinData, token }) => {
        return await gstzenApiCall('/api/create-gstin/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(gstinData),
        });
    });
}

function createWindow() {
    // Create the browser window.
    // Determine the correct icon path for the platform
    let iconPath;
    const buildDir = path.join(__dirname, '../build');
    
    if (process.platform === 'win32') {
        // Windows: use .ico format for best taskbar appearance
        iconPath = path.join(buildDir, 'icon.ico');
    } else if (process.platform === 'darwin') {
        // macOS: use .png
        iconPath = path.join(buildDir, 'icon.png');
    } else {
        // Linux: use .png
        iconPath = path.join(buildDir, 'icon.png');
    }
    
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        icon: iconPath,
        title: 'ICAI VERA',
        show: false,
    });

    // Show window maximized when ready to prevent visual flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });

    // Load the app
    if (isDev) {
        // In development, load from Vite dev server
        mainWindow.loadURL('http://localhost:8080');
        // Open DevTools in development
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the built files
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

// Auto-updater event handlers are now managed in auto-updater.js
// They are initialized when app is ready

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
    setupGstzenHandlers();
    setupAppHandlers();
    createWindow();

    // Initialize auto-updater with GitHub provider
    // - Checks for updates on app ready
    // - Sets up all event handlers and IPC communication
    // - Configures beta channel based on environment/version
    initializeAutoUpdater();

    app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

function setupAppHandlers() {
    ipcMain.handle('app:getDownloadsPath', () => {
        return app.getPath('downloads');
    });

    ipcMain.handle('app:openPath', async (event, targetPath) => {
        return await shell.openPath(targetPath);
    });

    ipcMain.handle('app:exportFile', async (event, payload) => {
        try {
            const { defaultFilename, buffer, showSaveDialog = true } = payload || {};
            const safeFilename = String(defaultFilename || 'export.docx')
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
                .replace(/\s+/g, '_');
            const filename = safeFilename.toLowerCase().endsWith('.docx') ? safeFilename : `${safeFilename}.docx`;
            const downloadsPath = app.getPath('downloads');
            let filePath = path.join(downloadsPath, filename);

            if (showSaveDialog) {
                const result = await dialog.showSaveDialog({
                    title: 'Export Word Document',
                    defaultPath: filePath,
                    filters: [{ name: 'Word Document', extensions: ['docx'] }],
                });

                if (result.canceled || !result.filePath) {
                    return { success: false, canceled: true };
                }

                filePath = result.filePath;
            } else {
                const parsedPath = path.parse(filePath);
                let counter = 1;
                while (fs.existsSync(filePath)) {
                    filePath = path.join(parsedPath.dir, `${parsedPath.name}_${counter}${parsedPath.ext}`);
                    counter += 1;
                }
            }

            if (!buffer) {
                throw new Error('No file data received for export');
            }

            fs.writeFileSync(filePath, Buffer.from(buffer));
            return { success: true, path: filePath };
        } catch (error) {
            console.error('File export error:', error);
            return { success: false, error: error.message || 'File export failed' };
        }
    });
}

