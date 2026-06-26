declare global {
  interface Window {
    electronAPI: {
      platform: string;
      app?: {
        getDownloadsPath: () => Promise<string>;
        openPath: (targetPath: string) => Promise<string>;
        exportFile: (payload: {
          defaultFilename: string;
          buffer: ArrayBuffer;
          mimeType?: string;
          showSaveDialog?: boolean;
        }) => Promise<string | null>;
      };
      gstzen: {
        login: (credentials: { username: string; password: string }) => Promise<any>;
        // Generic request handles most APIs now
        downloadGstr1: (downloadRequest: any, token: string) => Promise<any>;
        generateOtp: (requestData: any, token: string) => Promise<any>;
        establishSession: (requestData: any, token: string) => Promise<any>;
        request: (endpoint: string, method: string, data: any, token: string) => Promise<any>;
      };
      // ODBC methods
      odbcCheckConnection: () => Promise<{ success: boolean; isConnected?: boolean; error?: string }>;
      odbcTestConnection: (port?: string) => Promise<{ success: boolean; error?: string; driver?: string; sampleData?: any }>;
      odbcFetchTrialBalance: () => Promise<{ success: boolean; error?: string; data?: any[] }>;
      odbcFetchMonthWise: (fyStartYear: number, targetMonth: string) => Promise<{ success: boolean; error?: string; data?: { plLines: any[]; bsLines: any[]; months: string[]; fyStartYear: number; targetMonth: string } }>;
      odbcDisconnect: () => Promise<{ success: boolean; error?: string }>;
      // Opening Balance Matching methods
      odbcFetchOldTallyLedgers: () => Promise<{ success: boolean; error?: string; data?: any[] }>;
      odbcFetchNewTallyLedgers: () => Promise<{ success: boolean; error?: string; data?: any[] }>;
      odbcCompareOpeningBalances: (data: { oldData: any[]; newData: any[] }) => Promise<{
        success: boolean;
        error?: string;
        comparison?: {
          balanceMismatches: any[];
          nameMismatches: any[];
        };
        xml?: string;
      }>;
      // Month wise and GST methods
      odbcFetchMonthWiseData: (data: { fyStartYear: number; targetMonth: string }) => Promise<{
        success: boolean;
        error?: string;
        lines?: any[];
        months?: string[];
      }>;
      odbcFetchGSTNotFeeded: () => Promise<{
        success: boolean;
        error?: string;
        lines?: any[];
      }>;
    };
  }
}

export {};
