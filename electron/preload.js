const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Add any IPC methods you need here
  platform: process.platform,

  // GSTZen API Methods (via IPC to main process - no CORS!)
  gstzen: {
    login: (credentials) => ipcRenderer.invoke('gstzen:login', credentials),
    getCustomerByEmail: (email, token) => ipcRenderer.invoke('gstzen:getCustomerByEmail', { email, token }),
    createCustomer: (customerData, token) => ipcRenderer.invoke('gstzen:createCustomer', { customerData, token }),
    getGstins: (customerUuid, token) => ipcRenderer.invoke('gstzen:getGstins', { customerUuid, token }),
    addGstin: (customerUuid, gstinData, token) => ipcRenderer.invoke('gstzen:addGstin', { customerUuid, gstinData, token }),
    updateGstinCredentials: (gstinUuid, credentials, token) => ipcRenderer.invoke('gstzen:updateGstinCredentials', { gstinUuid, credentials, token }),
    testGstinConnection: (gstinUuid, token) => ipcRenderer.invoke('gstzen:testGstinConnection', { gstinUuid, token }),
    downloadGstr1: (downloadRequest, token) => ipcRenderer.invoke('gstzen:downloadGstr1', { downloadRequest, token }),
    generateOtp: (requestData, token) => ipcRenderer.invoke('gstzen:generateOtp', { requestData, token }),
    establishSession: (requestData, token) => ipcRenderer.invoke('gstzen:establishSession', { requestData, token }),
    validateGstins: (gstinList, token) => ipcRenderer.invoke('gstzen:validateGstins', { gstinList, token }),
    createGstin: (gstinData, token) => ipcRenderer.invoke('gstzen:createGstin', { gstinData, token }),
  },

  // ODBC methods
  odbcCheckConnection: () => ipcRenderer.invoke('odbc-check-connection'),
  odbcTestConnection: (port) => ipcRenderer.invoke('odbc-test-connection', port),
  odbcFetchTrialBalance: (fromDate, toDate) => ipcRenderer.invoke('odbc-fetch-trial-balance', fromDate, toDate),
  odbcFetchMonthWise: (fyStartYear, targetMonth) => ipcRenderer.invoke('odbc-fetch-month-wise', fyStartYear, targetMonth),
  odbcDisconnect: () => ipcRenderer.invoke('odbc-disconnect'),
  odbcFetchOldTallyLedgers: () => ipcRenderer.invoke('odbc-fetch-old-tally-ledgers'),
  odbcFetchNewTallyLedgers: () => ipcRenderer.invoke('odbc-fetch-new-tally-ledgers'),
  odbcCompareOpeningBalances: (data) => ipcRenderer.invoke('odbc-compare-opening-balances', data),
  odbcFetchMonthWiseData: (data) => ipcRenderer.invoke('odbc-fetch-month-wise-data', data),
  odbcFetchGSTNotFeeded: () => ipcRenderer.invoke('odbc-fetch-gst-not-feeded'),
  odbcFetchStockItems: () => ipcRenderer.invoke('odbc-fetch-stock-items'),
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

  // Auto-updater methods
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    getCurrentVersion: () => ipcRenderer.invoke('updater:getCurrentVersion'),
    restartForUpdate: () => ipcRenderer.invoke('updater:restartForUpdate'),
    onUpdateEvent: (channel, listener) => ipcRenderer.on(channel, listener),
    removeUpdateListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
  },
});

// Log when preload script is loaded
console.log('Preload script loaded with GSTZen IPC handlers and Auto-Updater');

