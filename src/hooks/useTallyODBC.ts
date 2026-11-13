import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { TallyMonthWiseLine } from "@/contexts/TallyContext";

interface TallyCompanyInfo {
  companyName: string;
  financialYear: string;
  booksFrom: string;
  booksTo: string;
}

export interface TallyTrialBalanceLine {
  accountHead: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  accountCode: string;
  branch: string;
  // Hierarchy fields
  primaryGroup: string;
  parent: string;
  isRevenue: boolean;
}

interface TallyODBCState {
  isConnected: boolean;
  isConnecting: boolean;
  companyInfo: TallyCompanyInfo | null;
  error: string | null;
}

const STORAGE_KEY = 'auditpro_odbc_connection';

export const useTallyODBC = () => {
  const { toast } = useToast();
  const [state, setState] = useState<TallyODBCState>({
    isConnected: false,
    isConnecting: false,
    companyInfo: null,
    error: null,
  });

  // Restore connection state on mount and verify it's still active
  useEffect(() => {
    const checkConnectionStatus = async () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.isConnected) {
            // Verify connection is still active without creating a new one
            try {
              if (window.electronAPI && typeof window.electronAPI.odbcCheckConnection === 'function') {
                const result = await window.electronAPI.odbcCheckConnection();
                if (result.success && result.isConnected) {
                  // Connection is still active, restore state
                  setState({
                    isConnected: true,
                    isConnecting: false,
                    companyInfo: parsed.companyInfo || null,
                    error: null,
                  });
                  return;
                }
              }
            } catch {
              // Check failed, connection is not active
            }
            // Connection lost, clear saved state
            localStorage.removeItem(STORAGE_KEY);
            setState({
              isConnected: false,
              isConnecting: false,
              companyInfo: null,
              error: null,
            });
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    };

    checkConnectionStatus();
  }, []);

  const testConnection = useCallback(async (port?: string): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, isConnecting: true, error: null }));

      if (!window.electronAPI || typeof window.electronAPI.odbcTestConnection !== 'function') {
        throw new Error('ODBC API unavailable. Restart the app and ensure preload is enabled.');
      }

      const result = await window.electronAPI.odbcTestConnection(port);

      if (result.success) {
        const newState = {
          isConnected: true,
          isConnecting: false,
          companyInfo: null, // Can be populated later if needed
          error: null
        };
        setState(newState);
        
        // Persist connection state to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          isConnected: true,
          companyInfo: null,
        }));
        
        toast({
          title: "ODBC Connected",
          description: `Successfully connected using ${result.driver}`,
        });
        return true;
      } else {
        throw new Error(result.error || "ODBC connection failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        error: errorMessage
      }));
      toast({
        title: "ODBC Connection Failed",
        description: errorMessage,
        variant: "destructive",
      });
      return false;
    }
  }, [toast]);

  const fetchTrialBalance = useCallback(async (fromDate?: string, toDate?: string): Promise<{ data: any[]; companyName: string }> => {
    try {
      const result = await window.electronAPI.odbcFetchTrialBalance(fromDate, toDate);

      if (result.success && result.data) {
        return { data: result.data, companyName: result.companyName || '' };
      } else {
        throw new Error(result.error || "Failed to fetch trial balance");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Failed to Fetch Trial Balance",
        description: errorMessage,
        variant: "destructive",
      });
      return { data: [], companyName: '' };
    }
  }, [toast]);

  const fetchMonthWise = useCallback(async (fyStartYear: number, targetMonth: string): Promise<{ plLines: TallyMonthWiseLine[]; bsLines: TallyMonthWiseLine[]; months: string[] } | null> => {
    try {
      const result = await window.electronAPI.odbcFetchMonthWise(fyStartYear, targetMonth);

      if (result.success && result.data) {
        return result.data;
      } else {
        throw new Error(result.error || "Failed to fetch month wise data");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Failed to Fetch Month Wise Data",
        description: errorMessage,
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  const fetchStockItems = useCallback(async (): Promise<any[]> => {
    try {
      const result = await window.electronAPI.odbcFetchStockItems();

      if (result.success && result.items) {
        toast({
          title: "Stock Items Fetched",
          description: `Successfully fetched ${result.items.length} stock items from Tally`,
        });
        return result.items;
      } else {
        throw new Error(result.error || "Failed to fetch stock items");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Failed to Fetch Stock Items",
        description: errorMessage,
        variant: "destructive",
      });
      return [];
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    try {
      await window.electronAPI.odbcDisconnect();
    } catch (err) {
      console.error("Error disconnecting ODBC:", err);
    }
    
    setState({
      isConnected: false,
      isConnecting: false,
      companyInfo: null,
      error: null,
    });
    
    // Remove persisted connection state
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    ...state,
    testConnection,
    fetchTrialBalance,
    fetchMonthWise,
    fetchStockItems,
    disconnect,
  };
};
