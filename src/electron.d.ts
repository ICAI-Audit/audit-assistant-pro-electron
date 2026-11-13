declare global {
  interface Window {
    electronAPI: {
      platform: string;
      app?: {
        exportFile: (payload: {
          defaultFilename: string;
          buffer: ArrayBuffer;
          mimeType?: string;
          showSaveDialog?: boolean;
          fileExtension?: 'docx' | 'csv';
        }) => Promise<string | null>;
      };
      gstzen: {
        login: (credentials: { username: string; password: string }) => Promise<any>;
        // Generic request handles most APIs now
        downloadGstr1: (downloadRequest: any, token: string) => Promise<any>;
        generateOtp: (requestData: any, token: string) => Promise<any>;
        establishSession: (requestData: any, token: string) => Promise<any>;
        request: (endpoint: string, method: string, data: any, token: string) => Promise<any>;
        validateGstins?: (gstinList: string, token: string) => Promise<any>;
        createGstin?: (gstinData: { gstin: string; name: string; taxpayer_type: 'REGULAR' | 'COMPOSITION' | 'ISD' }, token: string) => Promise<any>;
      };
      gstinLookup: {
        fetchDetails: (payload: { gstin: string; consentConfirmed: boolean }) => Promise<{
          success: boolean;
          error?: string;
          data?: {
            valid: boolean;
            name: string;
            taxpayerType:
              | 'REGULAR'
              | 'ISD'
              | 'TCS'
              | 'TDS'
              | 'NON_RESIDENT'
              | 'UN_BODIES'
              | 'TAX_RETURN_PREPARER'
              | 'TEMPORARY_ID'
              | null;
            message: string | null;
          };
        }>;
      };
      // ODBC methods
      odbcCheckConnection: () => Promise<{ success: boolean; isConnected?: boolean; error?: string }>;
      odbcTestConnection: (port?: string) => Promise<{ success: boolean; error?: string; driver?: string; sampleData?: any }>;
      odbcFetchTrialBalance: (fromDate?: string, toDate?: string) => Promise<{ success: boolean; error?: string; data?: any[]; companyName?: string }>;
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
      odbcFetchStockItems: () => Promise<{
        success: boolean;
        error?: string;
        items?: any[];
      }>;
      // Financial Statement Review (FSG) module: fsg:* channels only
      fsg?: {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      };
    };
  }
}

export {};
