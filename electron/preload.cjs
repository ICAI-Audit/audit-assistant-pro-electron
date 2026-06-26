const { contextBridge, ipcRenderer } = require('electron');

// Auto-updater API mirrored from electron/auto-updater-preload.js
// (defined inline here to avoid dynamic requires in bundled preload)
const updaterApi = {
  /**
   * Manually check for updates
   * @returns {Promise<{success: boolean, updateAvailable: boolean, currentVersion: string, latestVersion?: string, error?: string}>}
   */
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),

  /**
   * Get current app version and beta status
   * @returns {Promise<{version: string, isBeta: boolean}>}
   */
  getCurrentVersion: () => ipcRenderer.invoke('updater:getCurrentVersion'),

  /**
   * Trigger immediate restart for waiting update
   * @returns {Promise<void>}
   */
  restartForUpdate: () => ipcRenderer.invoke('updater:restartForUpdate'),

  /**
   * Listen for update events
   * Events:
   * - 'update:checking' - checking for updates started
   * - 'update:available' - {version, releaseNotes, releaseName, releaseDate}
   * - 'update:not-available' - {currentVersion}
   * - 'update:downloaded' - {version} - update ready to install
   * - 'update:progress' - {percent, transferred, total}
   * - 'update:deferred' - {version} - user postponed restart
   * - 'update:error' - {message}
   */
  onUpdateEvent: (channel, listener) => {
    // Validate channel to prevent listening to arbitrary events
    const validChannels = [
      'update:checking',
      'update:available',
      'update:not-available',
      'update:downloaded',
      'update:progress',
      'update:deferred',
      'update:error',
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, listener);

      // Return unsubscribe function for cleanup
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    } else {
      console.warn(`[SECURITY] Attempted to listen to invalid channel: ${channel}`);
    }
  },

  /**
   * Remove listener for update event
   */
  removeUpdateListener: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Add any IPC methods you need here
  platform: process.platform,
  // SQLite methods
  sqliteAuth: (payload) => ipcRenderer.invoke('sqlite-auth', payload),
  sqliteGetCurrentUser: () => ipcRenderer.invoke('sqlite-get-current-user'),
  sqliteQuery: (payload) => ipcRenderer.invoke('sqlite-query', payload),
  saveFile: async ({ bucket, path, buffer, mimeType }) => {
    const result = await ipcRenderer.invoke('file-save', { bucket, path, buffer, mimeType });
    if (!result?.success) {
      throw new Error(result?.error || 'File save failed');
    }
    return result.path;
  },
  getFilePath: async (bucket, path) => {
    const result = await ipcRenderer.invoke('file-get-path', bucket, path);
    if (!result?.success) {
      throw new Error(result?.error || 'File path lookup failed');
    }
    return result.path;
  },
  downloadFile: async (bucket, path) => {
    const result = await ipcRenderer.invoke('file-download', bucket, path);
    if (!result?.success) {
      throw new Error(result?.error || 'File download failed');
    }
    return { buffer: result.buffer, mimeType: result.mimeType };
  },
  deleteFile: async (bucket, path) => {
    const result = await ipcRenderer.invoke('file-delete', bucket, path);
    if (!result?.success) {
      throw new Error(result?.error || 'File delete failed');
    }
    return true;
  },
  app: {
    getDownloadsPath: () => ipcRenderer.invoke('app:getDownloadsPath'),
    openPath: (targetPath) => ipcRenderer.invoke('app:openPath', targetPath),
    exportFile: async ({ defaultFilename, buffer, mimeType, showSaveDialog }) => {
      const result = await ipcRenderer.invoke('app:exportFile', { defaultFilename, buffer, mimeType, showSaveDialog });
      if (!result?.success) {
        if (result?.canceled) return null;
        throw new Error(result?.error || 'File export failed');
      }
      return result.path;
    },
  },
  gstzen: {
    login: (credentials) => ipcRenderer.invoke('gstzen-login', credentials),
    generateOtp: (data, token) => ipcRenderer.invoke('gstzen-generate-otp', { data, token }),
    establishSession: (data, token) => ipcRenderer.invoke('gstzen-establish-session', { data, token }),
    downloadGstr1: (data, token) => ipcRenderer.invoke('gstzen-download-gstr1', { data, token }),
    request: (endpoint, method, data, token) => ipcRenderer.invoke('gstzen-api-request', { endpoint, method, data, token }),
  },
  // Auto-updater API, consumed by useAutoUpdater hook
  updater: updaterApi,
  // Example: send a message to main process
  send: (channel, data) => {
    const validChannels = ['toMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  // Example: receive a message from main process
  receive: (channel, func) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  // ODBC methods
  odbcCheckConnection: () => ipcRenderer.invoke('odbc-check-connection'),
  odbcTestConnection: (port) => ipcRenderer.invoke('odbc-test-connection', port),
  odbcFetchTrialBalance: (fromDate, toDate) => ipcRenderer.invoke('odbc-fetch-trial-balance', fromDate, toDate),
  odbcFetchMonthWise: (fyStartYear, targetMonth) => ipcRenderer.invoke('odbc-fetch-month-wise', fyStartYear, targetMonth),
  odbcDisconnect: () => ipcRenderer.invoke('odbc-disconnect'),
  // Opening Balance Matching methods
  odbcFetchOldTallyLedgers: () => ipcRenderer.invoke('odbc-fetch-old-tally-ledgers'),
  odbcFetchNewTallyLedgers: () => ipcRenderer.invoke('odbc-fetch-new-tally-ledgers'),
  odbcCompareOpeningBalances: (data) => ipcRenderer.invoke('odbc-compare-opening-balances', data),
  // Month wise and GST methods
  odbcFetchMonthWiseData: (data) => ipcRenderer.invoke('odbc-fetch-month-wise-data', data),
  odbcFetchGSTNotFeeded: () => ipcRenderer.invoke('odbc-fetch-gst-not-feeded'),
  // Stock Items methods
  odbcFetchStockItems: () => ipcRenderer.invoke('odbc-fetch-stock-items'),
});

// Log when preload script is loaded
console.log('Preload script loaded');

