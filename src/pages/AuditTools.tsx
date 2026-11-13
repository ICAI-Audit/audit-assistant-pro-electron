import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTabShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useEngagement } from "@/contexts/EngagementContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTallyODBC } from "@/hooks/useTallyODBC";
import { cn } from "@/lib/utils";
import {
  formatGstinInput,
  getGstinTaxpayerType,
  getGstinValidationError,
  GSTIN_TAXPAYER_TYPE_LABELS,
  type GstinTaxpayerType,
} from "@/lib/gstinValidation";
import { createVerifiedGstinCsv, parseGstinSpreadsheet, type InvalidGstinRow } from "@/lib/gstinSpreadsheet";
import { getSQLiteClient } from "@/integrations/sqlite/client";

const db = getSQLiteClient();

// Type definitions (moved from TallyContext)
export interface TallyTrialBalanceLine {
  accountHead: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  accountCode: string;
  branch: string;
  primaryGroup: string;
  parent: string;
  isRevenue: boolean;
}

export interface TallyMonthWiseLine {
  accountName: string;
  primaryGroup: string;
  isRevenue: boolean;
  openingBalance: number;
  monthlyBalances: Record<string, number>;
}

export interface TallyGSTNotFeedLine {
  ledgerName: string;
  primaryGroup: string;
  partyGSTIN: string | null;
  registrationType: string;
  gstRegistrationType?: string; // Alias for compatibility
}

import { useOpeningBalanceMatching } from "@/hooks/useOpeningBalanceMatching";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "lucide-react";
import DeferredTax from "@/components/audit/DeferredTax";
import DeferredTaxCalculator from "@/components/audit/DeferredTaxCalculator";
import {
  Database,
  FileSpreadsheet,
  Building2,
  Receipt,
  FileText,
  Download,
  Upload,
  Search,
  RefreshCw,
  FileJson,
  FilePlus,
  Scissors,
  FileType,
  Table,
  Shield,
  AlertTriangle,
  AlertCircle,
  Bell,
  Users,
  CreditCard,
  Calculator,
  Merge,
  Eye,
  CheckCircle2,
  Loader2,
  Unplug,
  Scale,
  FileDown,
  FileX,
  FolderOpen,
  HelpCircle,
} from "lucide-react";

interface ToolCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  status?: "available" | "coming-soon" | "beta";
  onClick?: () => void;
}

const ToolCard = ({ title, description, icon, status = "available", onClick }: ToolCardProps) => {
  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/50 ${status === "coming-soon" ? "opacity-60" : ""
        }`}
      onClick={status !== "coming-soon" ? onClick : undefined}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            {icon}
          </div>
          {status === "coming-soon" && (
            <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
          )}
        </div>
        <CardTitle className="text-base mt-3">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm">{description}</CardDescription>
      </CardContent>
    </Card>
  );
};

type ConnectionMode = "odbc" | "excel";
type GstinBulkLookupResult = {
  gstin: string;
  name: string;
  taxpayerType: GstinTaxpayerType | "";
  valid: boolean;
  message: string | null;
};

const TallyTools = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentEngagement } = useEngagement();
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("odbc");

  // Trial Balance fetch state
  const [showTBDialog, setShowTBDialog] = useState(false);
  const [tbFromDate, setTbFromDate] = useState("2024-04-01");
  const [tbToDate, setTbToDate] = useState("2025-03-31");
  const [isFetchingTB, setIsFetchingTB] = useState(false);
  const [fetchedTBData, setFetchedTBData] = useState<TallyTrialBalanceLine[] | null>(null);
  const [tbSearchTerm, setTbSearchTerm] = useState("");


  // Month wise data fetch state
  const [showMonthWiseDialog, setShowMonthWiseDialog] = useState(false);
  const [mwFyStartYear, setMwFyStartYear] = useState(new Date().getFullYear() - 1);
  const [mwTargetMonth, setMwTargetMonth] = useState("Mar");
  const [isFetchingMW, setIsFetchingMW] = useState(false);
  const [fetchedMWData, setFetchedMWData] = useState<{ plLines: TallyMonthWiseLine[]; bsLines: TallyMonthWiseLine[]; months: string[] } | null>(null);
  const [mwSearchTerm, setMwSearchTerm] = useState("");

  // GST Not Feeded state
  const [showGSTNotFeedDialog, setShowGSTNotFeedDialog] = useState(false);
  const [isFetchingGSTNotFeed, setIsFetchingGSTNotFeed] = useState(false);
  const [fetchedGSTNotFeedData, setFetchedGSTNotFeedData] = useState<TallyGSTNotFeedLine[] | null>(null);
  const [gstSearchTerm, setGstSearchTerm] = useState("");


  // Negative Ledgers state
  const [showNegativeLedgersDialog, setShowNegativeLedgersDialog] = useState(false);
  const [negativeLedgersTab, setNegativeLedgersTab] = useState("debtors");
  const [negativeLedgersSearchTerm, setNegativeLedgersSearchTerm] = useState("");

  // No Transactions state
  const [showNoTransactionsDialog, setShowNoTransactionsDialog] = useState(false);
  const [noTransactionsSearchTerm, setNoTransactionsSearchTerm] = useState("");

  // ODBC Info Dialog state
  const [showODBCInfoDialog, setShowODBCInfoDialog] = useState(false);

  // Opening Balance Matching state
  const [showOpeningBalanceDialog, setShowOpeningBalanceDialog] = useState(false);
  const [showOpeningBalanceHelpDialog, setShowOpeningBalanceHelpDialog] = useState(false);
  const openingBalanceMatching = useOpeningBalanceMatching();

  // ODBC connection (only connection method)
  const odbcConnection = useTallyODBC();

  // Use ODBC connection
  const isConnected = odbcConnection.isConnected;
  const isConnecting = odbcConnection.isConnecting;
  const companyInfo = odbcConnection.companyInfo;

  const handleConnect = () => {
    if (isConnected) {
      odbcConnection.disconnect();
    } else {
      odbcConnection.testConnection();
    }
  };

  const handleFetchTrialBalance = async () => {
    setIsFetchingTB(true);
    try {
      const result = await odbcConnection.fetchTrialBalance();
      if (result && result.data && result.data.length > 0) {
        setFetchedTBData(result.data);
        toast({
          title: "Trial Balance Fetched",
          description: `Retrieved ${result.data.length} ledger accounts from Tally`,
        });
      }
    } catch (error) {
      toast({
        title: "Failed to Fetch Trial Balance",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsFetchingTB(false);
    }
  };

  const handleExportToExcel = () => {
    if (!fetchedTBData || fetchedTBData.length === 0) return;

    // Function to get category
    const getCategory = (primaryGroup: string, isRevenue: boolean) => {
      const assetGroups = ['Fixed Assets', 'Current Assets', 'Investments', 'Loans & Advances', 'Cash-in-hand', 'Bank Accounts', 'Deposits (Asset)', 'Stock-in-hand', 'Miscellaneous Expenses (Asset)', 'Advance Tax', 'Sundry Debtors'];
      const liabilityGroups = ['Capital Account', 'Loans (Liability)', 'Current Liabilities', 'Provisions', 'Reserves & Surplus', 'Sundry Creditors', 'Duties & Taxes', 'Secured Loans', 'Unsecured Loans'];
      const incomeGroups = ['Sales Accounts', 'Direct Income', 'Indirect Income', 'Service Income'];
      const expenseGroups = ['Direct Expenses', 'Indirect Expenses', 'Administrative Expenses', 'Selling Expenses', 'Miscellaneous Expenses'];

      const lowerGroup = primaryGroup.toLowerCase();

      if (assetGroups.some(g => lowerGroup.includes(g.toLowerCase()))) return 'Asset';
      if (liabilityGroups.some(g => lowerGroup.includes(g.toLowerCase()))) return 'Liability';
      if (incomeGroups.some(g => lowerGroup.includes(g.toLowerCase()))) return 'Income';
      if (expenseGroups.some(g => lowerGroup.includes(g.toLowerCase()))) return 'Expense';

      // Default based on isRevenue
      return isRevenue ? 'Income' : 'Asset';
    };

    // Function to build hierarchy levels
    const buildHierarchy = (data: TallyTrialBalanceLine[]) => {
      return data.map(line => {
        const hierarchy = [line.accountHead];
        const category = getCategory(line.primaryGroup, line.isRevenue);

        // Build hierarchy based on category
        if (category === 'Income') {
          hierarchy.push(line.parent || 'Income Accounts');
          hierarchy.push('Revenue from Operations');
          hierarchy.push('Income');
          hierarchy.push('');
        } else if (category === 'Expense') {
          hierarchy.push(line.parent || 'Expense Accounts');
          hierarchy.push('Expenses');
          hierarchy.push('Expense');
          hierarchy.push('');
        } else if (category === 'Asset') {
          hierarchy.push(line.parent || line.primaryGroup);
          if (['Bank Accounts', 'Cash-in-hand', 'Deposits', 'Loans & Advances', 'Sundry Debtors'].includes(line.primaryGroup)) {
            hierarchy.push('Current Assets');
          } else {
            hierarchy.push('Non-Current Assets');
          }
          hierarchy.push('Asset');
          hierarchy.push('');
        } else if (category === 'Liability') {
          hierarchy.push(line.parent || line.primaryGroup);
          if (['Sundry Creditors', 'Duties & Taxes', 'Provisions'].includes(line.primaryGroup)) {
            hierarchy.push('Current Liabilities');
          } else {
            hierarchy.push('Non-Current Liabilities');
          }
          hierarchy.push('Liability');
          hierarchy.push('');
        } else {
          // Default
          hierarchy.push(line.parent || line.primaryGroup);
          hierarchy.push(category);
          hierarchy.push('');
          hierarchy.push('');
        }

        return {
          "Account Head": hierarchy[0],
          "Parent 1": hierarchy[1],
          "Parent 2": hierarchy[2],
          "Parent 3": hierarchy[3],
          "Parent 4": hierarchy[4] || '',
          "Category": category,
        };
      });
    };

    const wb = XLSX.utils.book_new();

    // Sheet 1: Trial Balance Data
    const trialBalanceData = fetchedTBData.map(line => ({
      "Account Head": line.accountHead,
      "Opening Balance": line.openingBalance,
      "Total Debit": line.totalDebit,
      "Total Credit": line.totalCredit,
      "Closing Balance": line.closingBalance,
      "Account Code": line.accountCode,
      "Branch": line.branch,
    }));

    const trialBalanceWs = XLSX.utils.json_to_sheet(trialBalanceData);
    const colWidths = [
      { wch: 30 }, // Account Head
      { wch: 15 }, // Opening Balance
      { wch: 12 }, // Total Debit
      { wch: 12 }, // Total Credit
      { wch: 15 }, // Closing Balance
      { wch: 15 }, // Account Code
      { wch: 10 }, // Branch
    ];
    trialBalanceWs['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, trialBalanceWs, "Trial Balance");

    // Sheet 2: Hierarchy
    const hierarchyData = buildHierarchy(fetchedTBData);
    const hierarchyWs = XLSX.utils.json_to_sheet(hierarchyData);
    const hierarchyColWidths = [
      { wch: 30 }, // Account Head
      { wch: 25 }, // Parent 1
      { wch: 25 }, // Parent 2
      { wch: 20 }, // Parent 3
      { wch: 20 }, // Parent 4
      { wch: 15 }, // Category
    ];
    hierarchyWs['!cols'] = hierarchyColWidths;
    XLSX.utils.book_append_sheet(wb, hierarchyWs, "Hierarchy");

    const fileName = `Trial_Balance_${tbFromDate}_to_${tbToDate}.xlsx`;
    XLSX.writeFile(wb, fileName);

    const plCount = fetchedTBData.filter(line => line.isRevenue).length;
    const bsCount = fetchedTBData.filter(line => !line.isRevenue).length;

    toast({
      title: "Export Complete",
      description: `Saved ${plCount} P&L and ${bsCount} Balance Sheet items to ${fileName}`,
    });
  };

  const handleFetchMonthWiseData = async () => {
    if (!isConnected) {
      toast({
        title: "Not Connected",
        description: "Connect to Tally first using ODBC",
        variant: "destructive",
      });
      return;
    }

    setIsFetchingMW(true);
    try {
      const result = await odbcConnection.fetchMonthWise(mwFyStartYear, mwTargetMonth);

      if (result) {
        setFetchedMWData(result);
        toast({
          title: "Month wise Data Fetched",
          description: `Retrieved ${result.plLines.length + result.bsLines.length} ledger accounts (${result.plLines.length} P&L, ${result.bsLines.length} BS) for ${result.months.join(", ")}`,
        });
      } else {
        throw new Error("Failed to fetch month wise data");
      }
    } catch (error) {
      toast({
        title: "Failed to Fetch Month Wise Data",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsFetchingMW(false);
    }
  };

  const handleExportMonthWiseToExcel = () => {
    if (!fetchedMWData || (fetchedMWData.plLines.length === 0 && fetchedMWData.bsLines.length === 0)) return;

    const { plLines: plItems, bsLines: bsItems, months } = fetchedMWData;

    // Sort items
    plItems.sort((a, b) => {
      if (a.primaryGroup !== b.primaryGroup) return a.primaryGroup.localeCompare(b.primaryGroup);
      return a.accountName.localeCompare(b.accountName);
    });
    bsItems.sort((a, b) => {
      if (a.primaryGroup !== b.primaryGroup) return a.primaryGroup.localeCompare(b.primaryGroup);
      return a.accountName.localeCompare(b.accountName);
    });

    const formatRow = (line: TallyMonthWiseLine, isPL: boolean) => {
      const row: Record<string, string | number> = {
        "Ledger Name": line.accountName,
        "Primary Group": line.primaryGroup,
      };

      // For P&L, calculate movement (current - previous)
      // For BS, show absolute closing balances
      if (isPL) {
        months.forEach((month, idx) => {
          if (idx === 0) {
            // Movement for first month = closing - opening
            row[month] = (line.monthlyBalances[month] || 0) - line.openingBalance;
          } else {
            // Movement = current - previous month
            const prevMonth = months[idx - 1];
            row[month] = (line.monthlyBalances[month] || 0) - (line.monthlyBalances[prevMonth] || 0);
          }
        });
      } else {
        months.forEach(month => {
          row[month] = line.monthlyBalances[month] || 0;
        });
      }

      return row;
    };

    const wb = XLSX.utils.book_new();

    // P&L Sheet
    if (plItems.length > 0) {
      const plData = plItems.map(line => formatRow(line, true));
      // Add grand total row
      const plTotals: Record<string, string | number> = { "Ledger Name": "GRAND TOTAL", "Primary Group": "" };
      months.forEach(month => {
        plTotals[month] = plData.reduce((sum, row) => sum + (Number(row[month]) || 0), 0);
      });
      plData.push(plTotals);

      const plWs = XLSX.utils.json_to_sheet(plData);
      XLSX.utils.book_append_sheet(wb, plWs, "Profit_Loss");
    }

    // Balance Sheet
    if (bsItems.length > 0) {
      const bsData = bsItems.map(line => formatRow(line, false));
      // Add grand total row
      const bsTotals: Record<string, string | number> = { "Ledger Name": "GRAND TOTAL", "Primary Group": "" };
      months.forEach(month => {
        bsTotals[month] = bsData.reduce((sum, row) => sum + (Number(row[month]) || 0), 0);
      });
      bsData.push(bsTotals);

      const bsWs = XLSX.utils.json_to_sheet(bsData);
      XLSX.utils.book_append_sheet(wb, bsWs, "Balance_Sheet");
    }

    const fileName = `Financial_Report_${mwFyStartYear}_${mwTargetMonth}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({
      title: "Export Complete",
      description: `Saved month wise data to ${fileName}`,
    });
  };

  const handleFetchGSTNotFeed = async () => {
    if (!isConnected) {
      toast({
        title: "Not Connected",
        description: "Connect to Tally first using ODBC",
        variant: "destructive",
      });
      return;
    }

    setIsFetchingGSTNotFeed(true);
    try {
      if (!window.electronAPI || typeof window.electronAPI.odbcFetchGSTNotFeeded !== 'function') {
        throw new Error('Electron API not available. Please restart the application.');
      }

      const result = await window.electronAPI.odbcFetchGSTNotFeeded();

      if (result && result.success) {
        setFetchedGSTNotFeedData(result.lines || []);
        if (result.lines && result.lines.length > 0) {
          toast({
            title: "GST Not Feeded Data Fetched",
            description: `Found ${result.lines.length} ledgers with missing GSTIN`,
          });
        } else {
          toast({
            title: "GST Check Complete",
            description: "All Regular GST ledgers have GSTIN entered. No issues found!",
          });
        }
      } else {
        throw new Error(result?.error || "Failed to fetch GST not feeded data");
      }
    } catch (error) {
      toast({
        title: "Failed to Fetch GST Not Feeded Data",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsFetchingGSTNotFeed(false);
    }
  };

  const handleExportGSTNotFeedToExcel = () => {
    if (!fetchedGSTNotFeedData || fetchedGSTNotFeedData.length === 0) return;

    const isBlankGstin = (v: unknown) => {
      const s = (v ?? "").toString().trim();
      if (!s) return true;
      const low = s.toLowerCase();
      return low === "null" || low === "na" || low === "n/a" || s === "0" || s === "-";
    };

    const data = fetchedGSTNotFeedData.map(line => ({
      "Ledger Name": line.ledgerName,
      "GST Registration Type": line.registrationType || line.gstRegistrationType || "Unknown",
      "Party GSTIN": isBlankGstin(line.partyGSTIN) ? "(Not Feeded)" : line.partyGSTIN,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "GST_Not_Feeded");

    const fileName = `GST_Not_Feeded_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({
      title: "Export Complete",
      description: `Saved ${fetchedGSTNotFeedData.length} ledgers to ${fileName}`,
    });
  };

  // Negative Ledgers - accounts with opposite balances
  // Tally convention: Negative = Debit, Positive = Credit
  const getNegativeLedgers = () => {
    if (!fetchedTBData) return { debtors: [], creditors: [], assets: [], liabilities: [] };

    // Debtors should have Dr balance (negative), so Cr balance (positive/closingBalance > 0) is opposite
    const debtors = fetchedTBData.filter(line =>
      line.primaryGroup === "Sundry Debtors" && line.closingBalance > 0
    );

    // Creditors should have Cr balance (positive), so Dr balance (negative/closingBalance < 0) is opposite
    const creditors = fetchedTBData.filter(line =>
      line.primaryGroup === "Sundry Creditors" && line.closingBalance < 0
    );

    // Assets should have Dr balance (negative), so Cr balance (positive) is opposite
    const assetGroups = ["Fixed Assets", "Current Assets", "Investments", "Bank Accounts", "Cash-in-Hand", "Deposits (Asset)", "Loans & Advances (Asset)", "Stock-in-Hand", "Bank OD Accounts"];
    const assets = fetchedTBData.filter(line =>
      assetGroups.includes(line.primaryGroup) && line.closingBalance > 0
    );

    // Liabilities should have Cr balance (positive), so Dr balance (negative) is opposite
    const liabilityGroups = ["Capital Account", "Reserves & Surplus", "Loans (Liability)", "Secured Loans", "Unsecured Loans", "Current Liabilities", "Provisions", "Duties & Taxes"];
    const liabilities = fetchedTBData.filter(line =>
      liabilityGroups.includes(line.primaryGroup) && line.closingBalance < 0
    );

    return { debtors, creditors, assets, liabilities };
  };

  // Ledgers with No Transactions - only opening balance, no transactions during the year
  const getNoTransactionLedgers = () => {
    if (!fetchedTBData) return [];

    // A ledger has no transactions if:
    // 1. Total Debit and Total Credit are zero (or very small, < 0.01 to account for rounding)
    // 2. Opening Balance exists (non-zero, >= 0.01 to exclude negligible balances)
    // 3. Closing Balance equals Opening Balance (no change during the year)
    //    Formula: Closing Balance = Opening Balance + Total Debit - Total Credit
    //    If Total Debit = 0 and Total Credit = 0, then Closing = Opening
    const threshold = 0.01; // Small threshold for rounding differences

    return fetchedTBData.filter(line => {
      // Check if there are no transactions (both debit and credit totals are effectively zero)
      const hasNoTransactions =
        Math.abs(line.totalDebit) < threshold &&
        Math.abs(line.totalCredit) < threshold;

      // Must have a meaningful opening balance (exclude zero-balance accounts)
      const hasOpeningBalance = Math.abs(line.openingBalance) >= threshold;

      // Verify closing balance equals opening balance (safety check for data integrity)
      // This ensures: Closing = Opening + Debit - Credit = Opening + 0 - 0 = Opening
      const balanceUnchanged = Math.abs(line.closingBalance - line.openingBalance) < threshold;

      // All three conditions must be true
      return hasNoTransactions && hasOpeningBalance && balanceUnchanged;
    });
  };

  const handleExportNegativeLedgersToExcel = () => {
    const { debtors, creditors, assets, liabilities } = getNegativeLedgers();

    const formatRow = (line: TallyTrialBalanceLine, expectedNature: string) => {
      // For accounts with opposite balance:
      // - If expected Dr but has Cr: closingBalance > 0, so closingCr = closingBalance
      // - If expected Cr but has Dr: closingBalance < 0, so closingDr = abs(closingBalance)
      const closingCr = line.closingBalance > 0 ? line.closingBalance : 0;
      const closingDr = line.closingBalance < 0 ? Math.abs(line.closingBalance) : 0;
      return {
        "Account Name": line.accountHead,
        "Primary Group": line.primaryGroup,
        "Parent": line.parent,
        "Expected Nature": expectedNature,
        "Actual Balance": expectedNature === "Dr" ? `Cr ${formatCurrency(closingCr)}` : `Dr ${formatCurrency(closingDr)}`,
        "Amount": expectedNature === "Dr" ? closingCr : closingDr,
      };
    };

    const wb = XLSX.utils.book_new();

    if (debtors.length > 0) {
      const ws = XLSX.utils.json_to_sheet(debtors.map(l => formatRow(l, "Dr")));
      XLSX.utils.book_append_sheet(wb, ws, "Debtors_Cr_Bal");
    }

    if (creditors.length > 0) {
      const ws = XLSX.utils.json_to_sheet(creditors.map(l => formatRow(l, "Cr")));
      XLSX.utils.book_append_sheet(wb, ws, "Creditors_Dr_Bal");
    }

    if (assets.length > 0) {
      const ws = XLSX.utils.json_to_sheet(assets.map(l => formatRow(l, "Dr")));
      XLSX.utils.book_append_sheet(wb, ws, "Assets_Cr_Bal");
    }

    if (liabilities.length > 0) {
      const ws = XLSX.utils.json_to_sheet(liabilities.map(l => formatRow(l, "Cr")));
      XLSX.utils.book_append_sheet(wb, ws, "Liabilities_Dr_Bal");
    }

    const fileName = `Negative_Ledgers_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({
      title: "Export Complete",
      description: `Saved negative ledgers to ${fileName}`,
    });
  };

  const handleExportNoTransactionLedgersToExcel = () => {
    const noTransactionLedgers = getNoTransactionLedgers();

    if (noTransactionLedgers.length === 0) {
      toast({
        title: "No Data",
        description: "No ledgers with zero transactions found",
        variant: "destructive",
      });
      return;
    }

    const data = noTransactionLedgers.map(line => {
      const openingDr = line.openingBalance > 0 ? line.openingBalance : 0;
      const openingCr = line.openingBalance < 0 ? Math.abs(line.openingBalance) : 0;
      const closingDr = line.closingBalance > 0 ? line.closingBalance : 0;
      const closingCr = line.closingBalance < 0 ? Math.abs(line.closingBalance) : 0;

      return {
        "Account Name": line.accountHead,
        "Primary Group": line.primaryGroup,
        "Parent": line.parent,
        "Account Code": line.accountCode,
        "Branch": line.branch,
        "Opening Balance": formatCurrency(line.openingBalance),
        "Opening Dr": formatCurrency(openingDr),
        "Opening Cr": formatCurrency(openingCr),
        "Total Debit": formatCurrency(line.totalDebit),
        "Total Credit": formatCurrency(line.totalCredit),
        "Closing Balance": formatCurrency(line.closingBalance),
        "Closing Dr": formatCurrency(closingDr),
        "Closing Cr": formatCurrency(closingCr),
        "Type": line.isRevenue ? "P&L" : "BS",
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "No_Transactions");

    const fileName = `No_Transaction_Ledgers_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({
      title: "Export Complete",
      description: `Saved ${noTransactionLedgers.length} ledgers with no transactions to ${fileName}`,
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  // Filter Trial Balance data based on search term
  const filteredTBData = useMemo(() => {
    if (!fetchedTBData) return null;
    if (!tbSearchTerm.trim()) return fetchedTBData;

    const searchLower = tbSearchTerm.toLowerCase().trim();
    return fetchedTBData.filter(line =>
      line.accountHead.toLowerCase().includes(searchLower) ||
      line.accountCode.toLowerCase().includes(searchLower) ||
      line.primaryGroup.toLowerCase().includes(searchLower) ||
      (line.parent && line.parent.toLowerCase().includes(searchLower)) ||
      (line.branch && line.branch.toLowerCase().includes(searchLower))
    );
  }, [fetchedTBData, tbSearchTerm]);

  // Calculate totals from filtered data
  // Note: In Tally ODBC:
  // - $DebitTotals and $CreditTotals are typically absolute values (positive)
  // - But we use Math.abs() to ensure they're always positive for totals
  // - Opening and Closing balances follow Tally convention: negative = Debit, positive = Credit
  
  // Separate Balance Sheet and P&L accounts for proper calculation
  const bsAccounts = filteredTBData?.filter(line => !line.isRevenue) || [];
  const plAccounts = filteredTBData?.filter(line => line.isRevenue) || [];
  
  // For Balance Sheet accounts: Closing = Opening + Debit - Credit
  const bsOpeningBalance = bsAccounts.reduce((sum, line) => sum + line.openingBalance, 0);
  const bsDebit = bsAccounts.reduce((sum, line) => sum + Math.abs(line.totalDebit), 0);
  const bsCredit = bsAccounts.reduce((sum, line) => sum + Math.abs(line.totalCredit), 0);
  const bsClosingBalance = bsAccounts.reduce((sum, line) => sum + line.closingBalance, 0);
  const bsClosingCalculated = bsOpeningBalance + bsDebit - bsCredit;
  
  // For P&L accounts: Closing balance is the net result (profit/loss)
  // The formula Opening + Debit - Credit may not hold for P&L accounts
  const plOpeningBalance = plAccounts.reduce((sum, line) => sum + line.openingBalance, 0);
  const plDebit = plAccounts.reduce((sum, line) => sum + Math.abs(line.totalDebit), 0);
  const plCredit = plAccounts.reduce((sum, line) => sum + Math.abs(line.totalCredit), 0);
  const plClosingBalance = plAccounts.reduce((sum, line) => sum + line.closingBalance, 0);
  
  // Total Opening Balance (all accounts)
  const totalOpeningBalance = bsOpeningBalance + plOpeningBalance;
  
  // Total Debit and Credit (all accounts)
  const totalDebit = bsDebit + plDebit;
  const totalCredit = bsCredit + plCredit;
  
  // Total Closing Balance: Sum of individual closing balances
  const totalClosingBalance = bsClosingBalance + plClosingBalance;


  return (
    <div className="space-y-6">
      {/* Connection Mode Toggle */}
      <div className="flex gap-2">
        <Button
          variant={connectionMode === "odbc" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setShowODBCInfoDialog(true);
          }}
          disabled={isConnected}
        >
          <Database className="h-4 w-4 mr-2" />
          ODBC Direct
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            toast({
              title: "Coming Soon",
              description: "Excel Import will be available later",
            });
          }}
          disabled={isConnected}
        >
          <Upload className="h-4 w-4 mr-2" />
          Excel Import
        </Button>
      </div>

      {/* ODBC Mode UI */}
      {connectionMode === "odbc" && (
        <div className="bg-muted/50 rounded-lg p-4 border space-y-4">
          <div className="flex items-start gap-3">
            <Database className="h-5 w-5 text-green-500 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Direct ODBC Connection to Tally</p>
              <p>Connect directly to Tally using ODBC. Ensure Tally is running with ODBC enabled.</p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {isConnected ? (
              <Button onClick={handleConnect} size="sm" variant="outline" className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950">
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                ODBC Connected
              </Button>
            ) : (
              <Button onClick={handleConnect} size="sm" disabled={isConnecting}>
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing Connection...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Test ODBC Connection
                  </>
                )}
              </Button>
            )}

            {/* Show connection status */}
            {isConnected && (
              <div className="flex items-center gap-4 ml-2 pl-4 border-l">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">ODBC Connection Active</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => odbcConnection.disconnect()}
                  className="h-7 px-2 text-muted-foreground hover:text-destructive"
                >
                  <Unplug className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Excel Import Mode UI */}
      {connectionMode === "excel" && (
        <div className="bg-muted/50 rounded-lg p-4 border space-y-4">
          <div className="flex items-start gap-3">
            <Upload className="h-5 w-5 text-amber-500 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Excel/CSV Import from Tally</p>
              <p>Export your Trial Balance from Tally as Excel/CSV and import it into the system. This is a manual process but works reliably.</p>
            </div>
          </div>

          <Button size="sm" onClick={() => toast({ title: "Coming Soon", description: "Use Trial Balance > Import button to import Excel files" })}>
            <Upload className="h-4 w-4 mr-2" />
            Import Trial Balance
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Get Trial Balance from Tally"
          description="Extract Trial Balance directly from Tally ERP for the selected period. Automatically maps to audit worksheet format."
          icon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          status={isConnected ? "available" : "beta"}
          onClick={() => {
            if (!isConnected) {
              const modeName = connectionMode === "odbc" ? "ODBC" : "selected method";
              toast({ title: "Not Connected", description: `Connect to Tally first using the ${modeName}` });
            } else {
              setShowTBDialog(true);
            }
          }}
        />
        <ToolCard
          title="Get Month wise Data"
          description="Extract month wise data for analysis. Get P&L movement and Balance Sheet snapshots."
          icon={<Calendar className="h-5 w-5 text-primary" />}
          status={isConnected ? "available" : "beta"}
          onClick={() => {
            if (!isConnected) {
              toast({ title: "Not Connected", description: "Connect to Tally first using ODBC" });
            } else {
              setShowMonthWiseDialog(true);
            }
          }}
        />
        <ToolCard
          title="GST Number Not Feeded"
          description="Find parties with Regular GST registration but missing GSTIN. Identifies data entry gaps."
          icon={<AlertTriangle className="h-5 w-5 text-primary" />}
          status={isConnected ? "available" : "beta"}
          onClick={() => {
            if (!isConnected) {
              toast({ title: "Not Connected", description: "Connect to Tally first using ODBC" });
            } else {
              setShowGSTNotFeedDialog(true);
            }
          }}
        />
        <ToolCard
          title="Negative Ledgers"
          description="Find accounts with opposite balances - Debtors with Cr, Creditors with Dr, Assets with Cr, Liabilities with Dr."
          icon={<AlertCircle className="h-5 w-5 text-primary" />}
          status={fetchedTBData ? "available" : "beta"}
          onClick={() => {
            if (!fetchedTBData) {
              toast({ title: "Fetch Trial Balance First", description: "Use 'Get Trial Balance from Tally' to fetch data first" });
            } else {
              setShowNegativeLedgersDialog(true);
            }
          }}
        />
        <ToolCard
          title="Opening Balance Matching"
          description="Compare opening balances between Old and New Tally instances. Generate XML to import old balances into new Tally."
          icon={<Scale className="h-5 w-5 text-primary" />}
          status={isConnected ? "available" : "beta"}
          onClick={() => {
            if (!isConnected) {
              const modeName = connectionMode === "odbc" ? "ODBC" : "selected method";
              toast({ title: "Not Connected", description: `Connect to Tally first using the ${modeName}` });
            } else {
              setShowOpeningBalanceDialog(true);
            }
          }}
        />
        <ToolCard
          title="No Transactions Ledgers"
          description="Identify ledgers with no transactions during the year - only opening balances exist. Useful for identifying dormant accounts."
          icon={<FileX className="h-5 w-5 text-primary" />}
          status={fetchedTBData ? "available" : "beta"}
          onClick={() => {
            if (!fetchedTBData) {
              toast({ title: "Fetch Trial Balance First", description: "Use 'Get Trial Balance from Tally' to fetch data first" });
            } else {
              setShowNoTransactionsDialog(true);
            }
          }}
        />
        <ToolCard
          title="Query on Transactions"
          description="Run custom queries on Tally ledger transactions. Filter by date, voucher type, party name, and amount range."
          icon={<Search className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Ledger Extraction"
          description="Extract specific ledger accounts with all transaction details for verification and vouching."
          icon={<Database className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Daybook Export"
          description="Export daybook/journal register for any period with party details and narrations."
          icon={<Table className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      {/* Trial Balance Fetch Dialog */}
      <Dialog open={showTBDialog} onOpenChange={(open) => {
        setShowTBDialog(open);
        if (!open) {
          setTbSearchTerm("");
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Fetch Trial Balance from Tally
            </DialogTitle>
            <DialogDescription>
              Select the period and fetch Trial Balance data directly from Tally ERP
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Period Selection */}
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Label htmlFor="tbFromDate">From:</Label>
                <Input
                  id="tbFromDate"
                  type="date"
                  value={tbFromDate}
                  onChange={(e) => setTbFromDate(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="tbToDate">To:</Label>
                <Input
                  id="tbToDate"
                  type="date"
                  value={tbToDate}
                  onChange={(e) => setTbToDate(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button onClick={handleFetchTrialBalance} disabled={isFetchingTB}>
                {isFetchingTB ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Fetch from Tally
                  </>
                )}
              </Button>
            </div>

            {/* Search/Filter & Export */}
            {fetchedTBData && fetchedTBData.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search by Account Head, Code, Group, Parent, or Branch..."
                      value={tbSearchTerm}
                      onChange={(e) => setTbSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  {tbSearchTerm && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTbSearchTerm("")}
                      className="h-9"
                    >
                      Clear
                    </Button>
                  )}
                  {tbSearchTerm && filteredTBData && (
                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                      Showing {filteredTBData.length} of {fetchedTBData.length} accounts
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end">
                  <Button className="h-9" onClick={handleExportToExcel}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Export to Excel
                  </Button>
                </div>
              </div>
            )}

            {/* Results Table */}
            {fetchedTBData && fetchedTBData.length > 0 && (
              <div className="border rounded-lg overflow-hidden flex flex-col" style={{ maxHeight: '500px' }}>
                <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        <th className="text-left p-2 font-medium">Account Head</th>
                        <th className="text-right p-2 font-medium">Opening Balance</th>
                        <th className="text-right p-2 font-medium">Total Debit</th>
                        <th className="text-right p-2 font-medium">Total Credit</th>
                        <th className="text-right p-2 font-medium">Closing Balance</th>
                        <th className="text-left p-2 font-medium">Account Code</th>
                        <th className="text-left p-2 font-medium">Branch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTBData && filteredTBData.length > 0 ? (
                        filteredTBData.map((line, idx) => (
                          <tr key={idx} className="border-t hover:bg-muted/50">
                            <td className="p-2">{line.accountHead}</td>
                            <td className="p-2 text-right font-mono text-xs">{formatCurrency(line.openingBalance)}</td>
                            <td className="p-2 text-right font-mono text-xs">{formatCurrency(line.totalDebit)}</td>
                            <td className="p-2 text-right font-mono text-xs">{formatCurrency(line.totalCredit)}</td>
                            <td className="p-2 text-right font-mono">{formatCurrency(line.closingBalance)}</td>
                            <td className="p-2 text-muted-foreground text-xs">{line.accountCode}</td>
                            <td className="p-2 text-muted-foreground text-xs">{line.branch}</td>
                          </tr>
                        ))
                      ) : tbSearchTerm ? (
                        <tr>
                          <td colSpan={7} className="p-4 text-center text-muted-foreground">
                            No accounts found matching "{tbSearchTerm}"
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {/* Summary & Save */}
                <div className="p-4 border-t bg-muted/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-muted-foreground">
                      {tbSearchTerm ? (
                        <>
                          {filteredTBData?.length || 0} of {fetchedTBData.length} accounts
                          {tbSearchTerm && <span className="ml-1">(filtered)</span>}
                        </>
                      ) : (
                        `${fetchedTBData.length} accounts`
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Total Opening Balance:</span>
                      <span className="ml-2 font-mono font-medium">{formatCurrency(totalOpeningBalance)}</span>
                      {Math.abs(totalOpeningBalance) > 0.01 && (
                        <div className="mt-1">
                          <Badge variant="destructive" className="text-xs">
                            Difference: {formatCurrency(Math.abs(totalOpeningBalance))}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Total Debit:</span>
                      <span className="ml-2 font-mono font-medium">{formatCurrency(totalDebit)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Total Credit:</span>
                      <span className="ml-2 font-mono font-medium">{formatCurrency(totalCredit)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Total Closing Balance:</span>
                      <span className="ml-2 font-mono font-medium">{formatCurrency(totalClosingBalance)}</span>
                      {Math.abs(totalClosingBalance) > 0.01 && (
                        <div className="mt-1">
                          <Badge variant="destructive" className="text-xs">
                            Difference: {formatCurrency(Math.abs(totalClosingBalance))}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between mt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" className="h-10" onClick={() => setFetchedTBData(null)}>
                        Clear
                      </Button>
                    </div>

                    <div className="flex items-center sm:justify-end">
                      <Button
                        className="h-10 w-full sm:w-auto"
                        onClick={() => {
                          if (!currentEngagement) {
                            toast({ title: "No Engagement", description: "Select an engagement first to save Trial Balance", variant: "destructive" });
                            return;
                          }
                          toast({
                            title: "Save to Trial Balance",
                            description: "Navigate to Trial Balance page and use Import to save this data"
                          });
                          setShowTBDialog(false);
                        }}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Use in Trial Balance
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {fetchedTBData && fetchedTBData.length === 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No Trial Balance data found for the selected period. Make sure Tally has data for this date range.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Month wise Data Dialog */}
      <Dialog open={showMonthWiseDialog} onOpenChange={(open) => {
        setShowMonthWiseDialog(open);
        if (!open) {
          setMwSearchTerm("");
        }
      }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Get Month wise Data from Tally
            </DialogTitle>
            <DialogDescription>
              Extract month wise data for analysis. P&L shows movement, Balance Sheet shows closing balances.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Period Selection */}
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg flex-wrap">
              <div className="flex items-center gap-2">
                <Label htmlFor="mwFyStartYear">FY Starting Year:</Label>
                <Select
                  value={String(mwFyStartYear)}
                  onValueChange={(v) => setMwFyStartYear(Number(v))}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2020, 2021, 2022, 2023, 2024, 2025, 2026].map(year => (
                      <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="mwTargetMonth">Target Month:</Label>
                <Select value={mwTargetMonth} onValueChange={setMwTargetMonth}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"].map(month => (
                      <SelectItem key={month} value={month}>{month}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground">
                FY {mwFyStartYear}-{String(mwFyStartYear + 1).slice(-2)} → Apr to {mwTargetMonth}
              </div>
              <Button onClick={handleFetchMonthWiseData} disabled={isFetchingMW}>
                {isFetchingMW ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Fetch from Tally
                  </>
                )}
              </Button>
            </div>

            {/* Search/Filter */}
            {fetchedMWData && (fetchedMWData.plLines.length > 0 || fetchedMWData.bsLines.length > 0) && (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search by Ledger Name or Primary Group..."
                    value={mwSearchTerm}
                    onChange={(e) => setMwSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {mwSearchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMwSearchTerm("")}
                    className="h-9"
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}

            {/* Results Table */}
            {fetchedMWData && (fetchedMWData.plLines.length > 0 || fetchedMWData.bsLines.length > 0) && (() => {
              // Filter data based on search term
              const allLines = [...fetchedMWData.plLines, ...fetchedMWData.bsLines];
              const filteredLines = mwSearchTerm.trim()
                ? allLines.filter(line => {
                  const searchLower = mwSearchTerm.toLowerCase().trim();
                  return line.accountName.toLowerCase().includes(searchLower) ||
                    line.primaryGroup.toLowerCase().includes(searchLower);
                })
                : allLines;

              const filteredPlCount = filteredLines.filter(l => l.isRevenue).length;
              const filteredBsCount = filteredLines.filter(l => !l.isRevenue).length;
              const displayLines = filteredLines.slice(0, 100);

              return (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium min-w-[200px]">Ledger Name</th>
                          <th className="text-left p-2 font-medium min-w-[120px]">Primary Group</th>
                          <th className="text-center p-2 font-medium text-xs">Type</th>
                          {fetchedMWData.months.map(month => (
                            <th key={month} className="text-right p-2 font-medium min-w-[80px]">{month}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {displayLines.length > 0 ? (
                          displayLines.map((line, idx) => (
                            <tr key={idx} className="border-t hover:bg-muted/50">
                              <td className="p-2">{line.accountName}</td>
                              <td className="p-2 text-muted-foreground text-xs">{line.primaryGroup}</td>
                              <td className="p-2 text-center">
                                <Badge variant={line.isRevenue ? "secondary" : "outline"} className="text-[10px]">
                                  {line.isRevenue ? "P&L" : "BS"}
                                </Badge>
                              </td>
                              {fetchedMWData.months.map((month, monthIdx) => {
                                // For P&L items, show movement (current - previous)
                                // For BS items, show absolute closing balance
                                let displayValue = 0;
                                if (line.isRevenue) {
                                  // P&L: Calculate movement
                                  if (monthIdx === 0) {
                                    // First month: closing - opening
                                    displayValue = (line.monthlyBalances[month] || 0) - (line.openingBalance || 0);
                                  } else {
                                    // Subsequent months: current closing - previous closing
                                    const prevMonth = fetchedMWData.months[monthIdx - 1];
                                    displayValue = (line.monthlyBalances[month] || 0) - (line.monthlyBalances[prevMonth] || 0);
                                  }
                                } else {
                                  // BS: Show absolute closing balance
                                  displayValue = line.monthlyBalances[month] || 0;
                                }

                                return (
                                  <td key={month} className="p-2 text-right font-mono text-xs">
                                    {displayValue !== 0
                                      ? formatCurrency(displayValue)
                                      : '-'}
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        ) : mwSearchTerm ? (
                          <tr>
                            <td colSpan={3 + fetchedMWData.months.length} className="p-4 text-center text-muted-foreground">
                              No accounts found matching "{mwSearchTerm}"
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary & Export */}
                  <div className="p-4 border-t bg-muted/30 flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {mwSearchTerm ? (
                        <>
                          {filteredLines.length} of {allLines.length} accounts
                          {filteredLines.length > 0 && (
                            <span className="ml-1">({filteredPlCount} P&L, {filteredBsCount} BS)</span>
                          )}
                          {mwSearchTerm && <span className="ml-1">(filtered)</span>}
                        </>
                      ) : (
                        <>
                          {allLines.length} accounts ({fetchedMWData.plLines.length} P&L, {fetchedMWData.bsLines.length} BS)
                        </>
                      )}
                      {displayLines.length < filteredLines.length && (
                        <span className="ml-2 text-amber-600">(showing first {displayLines.length} of {filteredLines.length})</span>
                      )}
                      {!mwSearchTerm && allLines.length > 100 && (
                        <span className="ml-2 text-amber-600">(showing first 100)</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setFetchedMWData(null)}>
                        Clear
                      </Button>
                      <Button variant="outline" onClick={handleExportMonthWiseToExcel}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Export to Excel
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {fetchedMWData && fetchedMWData.plLines.length === 0 && fetchedMWData.bsLines.length === 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No month wise data found. Make sure Tally has data for FY {mwFyStartYear}-{mwFyStartYear + 1}.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* GST Not Feeded Dialog */}
      <Dialog open={showGSTNotFeedDialog} onOpenChange={(open) => {
        setShowGSTNotFeedDialog(open);
        if (!open) {
          setGstSearchTerm("");
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              GST Number Not Feeded
            </DialogTitle>
            <DialogDescription>
              Find parties where GST Registration Type is Regular but Party GSTIN is not entered.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Fetch Button */}
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
              <Button onClick={handleFetchGSTNotFeed} disabled={isFetchingGSTNotFeed}>
                {isFetchingGSTNotFeed ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Fetch from Tally
                  </>
                )}
              </Button>
              <span className="text-sm text-muted-foreground">
                Fetches all ledgers and filters where GST Type = Regular but GSTIN is blank
              </span>
            </div>

            {/* Search/Filter */}
            {fetchedGSTNotFeedData && fetchedGSTNotFeedData.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search by Ledger Name or Primary Group..."
                    value={gstSearchTerm}
                    onChange={(e) => setGstSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {gstSearchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setGstSearchTerm("")}
                    className="h-9"
                  >
                    Clear
                  </Button>
                )}
                {gstSearchTerm && (
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    Showing {(() => {
                      const filtered = fetchedGSTNotFeedData.filter(line => {
                        const searchLower = gstSearchTerm.toLowerCase().trim();
                        return line.ledgerName.toLowerCase().includes(searchLower) ||
                          line.primaryGroup.toLowerCase().includes(searchLower);
                      });
                      return filtered.length;
                    })()} of {fetchedGSTNotFeedData.length} ledgers
                  </div>
                )}
              </div>
            )}

            {/* Results Table */}
            {fetchedGSTNotFeedData && fetchedGSTNotFeedData.length > 0 && (() => {
              // Filter data based on search term
              const filteredData = gstSearchTerm.trim()
                ? fetchedGSTNotFeedData.filter(line => {
                  const searchLower = gstSearchTerm.toLowerCase().trim();
                  return line.ledgerName.toLowerCase().includes(searchLower) ||
                    line.primaryGroup.toLowerCase().includes(searchLower);
                })
                : fetchedGSTNotFeedData;

              return (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="text-left p-3 font-medium">#</th>
                          <th className="text-left p-3 font-medium">Ledger Name</th>
                          <th className="text-left p-3 font-medium">Primary Group</th>
                          <th className="text-left p-3 font-medium">GST Registration Type</th>
                          <th className="text-left p-3 font-medium">Party GSTIN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredData.length > 0 ? (
                          filteredData.map((line, idx) => (
                            <tr key={idx} className="border-t hover:bg-muted/50">
                              <td className="p-3 text-muted-foreground">{idx + 1}</td>
                              <td className="p-3 font-medium">{line.ledgerName}</td>
                              <td className="p-3 text-muted-foreground text-xs">{line.primaryGroup}</td>
                              <td className="p-3">
                                <Badge variant="secondary">{line.registrationType || line.gstRegistrationType || "Unknown"}</Badge>
                              </td>
                              <td className="p-3">
                                <Badge variant="destructive">Not Feeded</Badge>
                              </td>
                            </tr>
                          ))
                        ) : gstSearchTerm ? (
                          <tr>
                            <td colSpan={5} className="p-4 text-center text-muted-foreground">
                              No ledgers found matching "{gstSearchTerm}"
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary & Export */}
                  <div className="p-4 border-t bg-muted/30 flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {gstSearchTerm ? (
                        <>
                          {filteredData.length} of {fetchedGSTNotFeedData.length} ledgers with missing GSTIN
                          {gstSearchTerm && <span className="ml-1">(filtered)</span>}
                        </>
                      ) : (
                        `Found ${fetchedGSTNotFeedData.length} ledgers with missing GSTIN`
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setFetchedGSTNotFeedData(null)}>
                        Clear
                      </Button>
                      <Button variant="outline" onClick={handleExportGSTNotFeedToExcel}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Export to Excel
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {fetchedGSTNotFeedData && fetchedGSTNotFeedData.length === 0 && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  All ledgers with Regular GST registration have GSTIN entered. No data gaps found!
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Negative Ledgers Dialog */}
      <Dialog open={showNegativeLedgersDialog} onOpenChange={(open) => {
        setShowNegativeLedgersDialog(open);
        if (!open) {
          setNegativeLedgersSearchTerm("");
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Negative Ledgers - Opposite Balances
            </DialogTitle>
            <DialogDescription>
              Accounts with balances opposite to their expected nature (e.g., Debtors with Credit balance)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {(() => {
              const { debtors, creditors, assets, liabilities } = getNegativeLedgers();

              // Filter function for search
              const filterData = (data: TallyTrialBalanceLine[]) => {
                if (!negativeLedgersSearchTerm.trim()) return data;
                const searchLower = negativeLedgersSearchTerm.toLowerCase().trim();
                return data.filter(line =>
                  line.accountHead.toLowerCase().includes(searchLower) ||
                  line.primaryGroup.toLowerCase().includes(searchLower) ||
                  (line.parent && line.parent.toLowerCase().includes(searchLower))
                );
              };

              const filteredDebtors = filterData(debtors);
              const filteredCreditors = filterData(creditors);
              const filteredAssets = filterData(assets);
              const filteredLiabilities = filterData(liabilities);

              const totalCount = debtors.length + creditors.length + assets.length + liabilities.length;
              const filteredTotalCount = filteredDebtors.length + filteredCreditors.length + filteredAssets.length + filteredLiabilities.length;

              const renderTable = (data: TallyTrialBalanceLine[], filteredData: TallyTrialBalanceLine[], expectedNature: string, oppositeNature: string) => (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[350px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="text-left p-3 font-medium">#</th>
                          <th className="text-left p-3 font-medium">Account Name</th>
                          <th className="text-left p-3 font-medium">Primary Group</th>
                          <th className="text-left p-3 font-medium">Parent</th>
                          <th className="text-right p-3 font-medium">Opposite Balance ({oppositeNature})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredData.length > 0 ? (
                          filteredData.map((line, idx) => (
                            <tr key={idx} className="border-t hover:bg-muted/50">
                              <td className="p-3 text-muted-foreground">{idx + 1}</td>
                              <td className="p-3 font-medium">{line.accountHead}</td>
                              <td className="p-3 text-muted-foreground text-xs">{line.primaryGroup}</td>
                              <td className="p-3 text-muted-foreground text-xs">{line.parent || '-'}</td>
                              <td className="p-3 text-right font-mono text-destructive">
                                {(() => {
                                  // Since we've already filtered for opposite balances:
                                  // - For debtors/assets (expected Dr): filtered for closingBalance > 0 (Credit), so show the positive value
                                  // - For creditors/liabilities (expected Cr): filtered for closingBalance < 0 (Debit), so show the absolute value
                                  if (expectedNature === "Dr") {
                                    // Expected Debit, but has Credit balance (positive)
                                    return formatCurrency(line.closingBalance);
                                  } else {
                                    // Expected Credit, but has Debit balance (negative)
                                    return formatCurrency(Math.abs(line.closingBalance));
                                  }
                                })()}
                              </td>
                            </tr>
                          ))
                        ) : negativeLedgersSearchTerm ? (
                          <tr>
                            <td colSpan={5} className="p-4 text-center text-muted-foreground">
                              No accounts found matching "{negativeLedgersSearchTerm}"
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              );

              return (
                <>
                  {totalCount === 0 ? (
                    <Alert>
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertDescription>
                        No ledgers with opposite balances found. All accounts have balances matching their expected nature.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      {/* Search Input */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search by Account Name, Primary Group, or Parent..."
                          value={negativeLedgersSearchTerm}
                          onChange={(e) => setNegativeLedgersSearchTerm(e.target.value)}
                          className="pl-9 pr-9"
                        />
                        {negativeLedgersSearchTerm && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                            onClick={() => setNegativeLedgersSearchTerm("")}
                          >
                            ×
                          </Button>
                        )}
                      </div>

                      {negativeLedgersSearchTerm && (
                        <div className="text-sm text-muted-foreground">
                          Showing {filteredTotalCount} of {totalCount} accounts
                          {negativeLedgersSearchTerm && <span className="ml-1">(filtered)</span>}
                        </div>
                      )}

                      <Tabs value={negativeLedgersTab} onValueChange={setNegativeLedgersTab}>
                        <TabsList className="grid w-full grid-cols-4">
                          <TabsTrigger value="debtors" className="text-xs">
                            Debtors (Cr) <Badge variant="secondary" className="ml-1 text-[10px]">
                              {negativeLedgersSearchTerm ? `${filteredDebtors.length}/${debtors.length}` : debtors.length}
                            </Badge>
                          </TabsTrigger>
                          <TabsTrigger value="creditors" className="text-xs">
                            Creditors (Dr) <Badge variant="secondary" className="ml-1 text-[10px]">
                              {negativeLedgersSearchTerm ? `${filteredCreditors.length}/${creditors.length}` : creditors.length}
                            </Badge>
                          </TabsTrigger>
                          <TabsTrigger value="assets" className="text-xs">
                            Assets (Cr) <Badge variant="secondary" className="ml-1 text-[10px]">
                              {negativeLedgersSearchTerm ? `${filteredAssets.length}/${assets.length}` : assets.length}
                            </Badge>
                          </TabsTrigger>
                          <TabsTrigger value="liabilities" className="text-xs">
                            Liabilities (Dr) <Badge variant="secondary" className="ml-1 text-[10px]">
                              {negativeLedgersSearchTerm ? `${filteredLiabilities.length}/${liabilities.length}` : liabilities.length}
                            </Badge>
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent value="debtors" className="mt-4">
                          {debtors.length > 0 ? (
                            renderTable(debtors, filteredDebtors, "Dr", "Cr")
                          ) : (
                            <Alert><AlertDescription>No Debtors with Credit balance found.</AlertDescription></Alert>
                          )}
                        </TabsContent>

                        <TabsContent value="creditors" className="mt-4">
                          {creditors.length > 0 ? (
                            renderTable(creditors, filteredCreditors, "Cr", "Dr")
                          ) : (
                            <Alert><AlertDescription>No Creditors with Debit balance found.</AlertDescription></Alert>
                          )}
                        </TabsContent>

                        <TabsContent value="assets" className="mt-4">
                          {assets.length > 0 ? (
                            renderTable(assets, filteredAssets, "Dr", "Cr")
                          ) : (
                            <Alert><AlertDescription>No Assets with Credit balance found.</AlertDescription></Alert>
                          )}
                        </TabsContent>

                        <TabsContent value="liabilities" className="mt-4">
                          {liabilities.length > 0 ? (
                            renderTable(liabilities, filteredLiabilities, "Cr", "Dr")
                          ) : (
                            <Alert><AlertDescription>No Liabilities with Debit balance found.</AlertDescription></Alert>
                          )}
                        </TabsContent>
                      </Tabs>

                      {/* Summary & Export */}
                      <div className="p-4 border rounded-lg bg-muted/30 flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                          {negativeLedgersSearchTerm ? (
                            <>
                              Showing {filteredTotalCount} of {totalCount} accounts with opposite balances
                              <span className="ml-1">(filtered)</span>
                              <span className="ml-2 text-xs">
                                (Debtors: {filteredDebtors.length}/{debtors.length}, Creditors: {filteredCreditors.length}/{creditors.length},
                                Assets: {filteredAssets.length}/{assets.length}, Liabilities: {filteredLiabilities.length}/{liabilities.length})
                              </span>
                            </>
                          ) : (
                            <>
                              Total: {totalCount} accounts with opposite balances
                              (Debtors: {debtors.length}, Creditors: {creditors.length}, Assets: {assets.length}, Liabilities: {liabilities.length})
                            </>
                          )}
                        </div>
                        <Button variant="outline" onClick={handleExportNegativeLedgersToExcel}>
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Export All to Excel
                        </Button>
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* No Transactions Ledgers Dialog */}
      <Dialog open={showNoTransactionsDialog} onOpenChange={(open) => {
        setShowNoTransactionsDialog(open);
        if (!open) {
          setNoTransactionsSearchTerm("");
        }
      }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileX className="h-5 w-5" />
              Ledgers with No Transactions
            </DialogTitle>
            <DialogDescription>
              Ledgers that have opening balances but no transactions during the year. Closing balance equals opening balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {(() => {
              const noTransactionLedgers = getNoTransactionLedgers();

              // Filter data based on search term
              const filteredData = noTransactionsSearchTerm.trim()
                ? noTransactionLedgers.filter(line => {
                  const searchLower = noTransactionsSearchTerm.toLowerCase().trim();
                  return line.accountHead.toLowerCase().includes(searchLower) ||
                    line.primaryGroup.toLowerCase().includes(searchLower) ||
                    (line.parent && line.parent.toLowerCase().includes(searchLower));
                })
                : noTransactionLedgers;

              if (noTransactionLedgers.length === 0) {
                return (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      No ledgers found with zero transactions. All ledgers have activity during the year.
                    </AlertDescription>
                  </Alert>
                );
              }

              return (
                <>
                  {/* Search Input */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search by Account Name, Primary Group, or Parent..."
                      value={noTransactionsSearchTerm}
                      onChange={(e) => setNoTransactionsSearchTerm(e.target.value)}
                      className="pl-9 pr-9"
                    />
                    {noTransactionsSearchTerm && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                        onClick={() => setNoTransactionsSearchTerm("")}
                      >
                        ×
                      </Button>
                    )}
                  </div>

                  {noTransactionsSearchTerm && (
                    <div className="text-sm text-muted-foreground">
                      Showing {filteredData.length} of {noTransactionLedgers.length} ledgers
                      {noTransactionsSearchTerm && <span className="ml-1">(filtered)</span>}
                    </div>
                  )}

                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-[500px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="text-left p-3 font-medium">#</th>
                            <th className="text-left p-3 font-medium">Account Name</th>
                            <th className="text-left p-3 font-medium">Primary Group</th>
                            <th className="text-left p-3 font-medium">Parent</th>
                            <th className="text-right p-3 font-medium">Opening Balance</th>
                            <th className="text-right p-3 font-medium">Total Debit</th>
                            <th className="text-right p-3 font-medium">Total Credit</th>
                            <th className="text-right p-3 font-medium">Closing Balance</th>
                            <th className="text-center p-3 font-medium">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredData.length > 0 ? (
                            filteredData.map((line, idx) => {
                              return (
                                <tr key={idx} className="border-t hover:bg-muted/50">
                                  <td className="p-3 text-muted-foreground">{idx + 1}</td>
                                  <td className="p-3 font-medium">{line.accountHead}</td>
                                  <td className="p-3 text-muted-foreground text-xs">{line.primaryGroup}</td>
                                  <td className="p-3 text-muted-foreground text-xs">{line.parent || '-'}</td>
                                  <td className="p-3 text-right font-mono text-xs">
                                    {line.openingBalance !== 0 ? (
                                      <span className={line.openingBalance < 0 ? "text-blue-600" : "text-red-600"}>
                                        {formatCurrency(Math.abs(line.openingBalance))} {line.openingBalance < 0 ? "Dr" : "Cr"}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </td>
                                  <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                                    {formatCurrency(line.totalDebit)}
                                  </td>
                                  <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                                    {formatCurrency(line.totalCredit)}
                                  </td>
                                  <td className="p-3 text-right font-mono text-xs">
                                    {line.closingBalance !== 0 ? (
                                      <span className={line.closingBalance < 0 ? "text-blue-600" : "text-red-600"}>
                                        {formatCurrency(Math.abs(line.closingBalance))} {line.closingBalance < 0 ? "Dr" : "Cr"}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </td>
                                  <td className="p-3 text-center">
                                    <Badge variant={line.isRevenue ? "secondary" : "outline"} className="text-[10px]">
                                      {line.isRevenue ? "P&L" : "BS"}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })
                          ) : noTransactionsSearchTerm ? (
                            <tr>
                              <td colSpan={9} className="p-4 text-center text-muted-foreground">
                                No ledgers found matching "{noTransactionsSearchTerm}"
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Summary & Export */}
                  <div className="p-4 border rounded-lg bg-muted/30 flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {noTransactionsSearchTerm ? (
                        <>
                          Showing {filteredData.length} of {noTransactionLedgers.length} ledger{noTransactionLedgers.length !== 1 ? 's' : ''} with no transactions
                          <span className="ml-1">(filtered)</span>
                          <span className="ml-2 text-xs">
                            ({filteredData.filter(l => !l.isRevenue).length} BS)
                          </span>
                        </>
                      ) : (
                        <>
                          Found {noTransactionLedgers.length} ledger{noTransactionLedgers.length !== 1 ? 's' : ''} with no transactions during the year
                          <span className="ml-2 text-xs">
                            ({noTransactionLedgers.filter(l => !l.isRevenue).length} BS)
                          </span>
                        </>
                      )}
                    </div>
                    <Button variant="outline" onClick={handleExportNoTransactionLedgersToExcel}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Export to Excel
                    </Button>
                  </div>
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* ODBC Info Dialog */}
      <Dialog open={showODBCInfoDialog} onOpenChange={setShowODBCInfoDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              ODBC Direct Connection Requirements
            </DialogTitle>
            <DialogDescription>
              Please ensure the following requirements are met before using ODBC Direct connection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Run Tally as Administrator</p>
                  <p className="text-sm text-muted-foreground">
                    Tally must be running with administrator privileges for ODBC connections to work properly.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Database className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Configure Tally ODBC</p>
                  <p className="text-sm text-muted-foreground">
                    Ensure Tally ODBC is properly configured in your system settings before attempting to connect.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowODBCInfoDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => {
              setShowODBCInfoDialog(false);
              setConnectionMode("odbc");
            }}>
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Opening Balance Matching Dialog */}
      <Dialog open={showOpeningBalanceDialog} onOpenChange={setShowOpeningBalanceDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Opening Balance Matching
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOpeningBalanceHelpDialog(true)}
                className="h-8 w-8 p-0"
              >
                <HelpCircle className="h-5 w-5 text-muted-foreground hover:text-primary" />
              </Button>
            </DialogTitle>
            <DialogDescription>
              Compare opening balances between Old and New Tally instances. Generate XML to import old balances into new Tally.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Step 1: Fetch Old Tally Data */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-sm">Step 1: Fetch Old Tally Data</h3>
                  <p className="text-sm text-muted-foreground">
                    Load the Old Tally instance in TallyPrime, then click to fetch closing balances.
                  </p>
                </div>
                <Button
                  onClick={openingBalanceMatching.fetchOldTallyLedgers}
                  disabled={openingBalanceMatching.isLoading || !!openingBalanceMatching.oldTallyData}
                  size="sm"
                >
                  {openingBalanceMatching.isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Fetching...
                    </>
                  ) : openingBalanceMatching.oldTallyData ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                      Fetched ({openingBalanceMatching.oldTallyData.length} ledgers)
                    </>
                  ) : (
                    <>
                      <Database className="h-4 w-4 mr-2" />
                      Fetch Old Tally Data
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Step 2: Fetch New Tally Data */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-sm">Step 2: Fetch New Tally Data</h3>
                  <p className="text-sm text-muted-foreground">
                    Load the New Tally instance in TallyPrime, then click to fetch opening balances.
                  </p>
                </div>
                <Button
                  onClick={openingBalanceMatching.fetchNewTallyLedgers}
                  disabled={openingBalanceMatching.isLoading || !!openingBalanceMatching.newTallyData || !openingBalanceMatching.oldTallyData}
                  size="sm"
                >
                  {openingBalanceMatching.isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Fetching...
                    </>
                  ) : openingBalanceMatching.newTallyData ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                      Fetched ({openingBalanceMatching.newTallyData.length} ledgers)
                    </>
                  ) : (
                    <>
                      <Database className="h-4 w-4 mr-2" />
                      Fetch New Tally Data
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Step 3: Compare Balances */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-sm">Step 3: Compare Balances</h3>
                  <p className="text-sm text-muted-foreground">
                    Compare the balances and generate comparison report with XML for import.
                  </p>
                </div>
                <Button
                  onClick={openingBalanceMatching.compareBalances}
                  disabled={openingBalanceMatching.isLoading || !openingBalanceMatching.oldTallyData || !openingBalanceMatching.newTallyData}
                  size="sm"
                >
                  {openingBalanceMatching.isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Comparing...
                    </>
                  ) : (
                    <>
                      <Scale className="h-4 w-4 mr-2" />
                      Compare Balances
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Comparison Results */}
            {openingBalanceMatching.comparisonResult && (
              <div className="space-y-4 border-t pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Balance Mismatches</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{openingBalanceMatching.comparisonResult.balanceMismatches.length}</div>
                      <p className="text-xs text-muted-foreground">Ledgers with different balances</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Name Mismatches</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{openingBalanceMatching.comparisonResult.nameMismatches.length}</div>
                      <p className="text-xs text-muted-foreground">Ledgers not found in one instance</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Balance Mismatches Table */}
                {openingBalanceMatching.comparisonResult.balanceMismatches.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Balance Mismatches</h4>
                    <div className="border rounded-lg overflow-hidden">
                      <div className="max-h-60 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted">
                            <tr>
                              <th className="p-2 text-left">Ledger Name</th>
                              <th className="p-2 text-right">Old Dr</th>
                              <th className="p-2 text-right">Old Cr</th>
                              <th className="p-2 text-right">New Dr</th>
                              <th className="p-2 text-right">New Cr</th>
                            </tr>
                          </thead>
                          <tbody>
                            {openingBalanceMatching.comparisonResult.balanceMismatches.slice(0, 10).map((mismatch, idx) => (
                              <tr key={idx} className="border-t">
                                <td className="p-2">{mismatch.$Name}</td>
                                <td className="p-2 text-right">{mismatch.Old_Dr_Balance.toFixed(2)}</td>
                                <td className="p-2 text-right">{mismatch.Old_Cr_Balance.toFixed(2)}</td>
                                <td className="p-2 text-right">{mismatch.New_Dr_Balance.toFixed(2)}</td>
                                <td className="p-2 text-right">{mismatch.New_Cr_Balance.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {openingBalanceMatching.comparisonResult.balanceMismatches.length > 10 && (
                        <div className="p-2 text-xs text-muted-foreground text-center border-t">
                          Showing first 10 of {openingBalanceMatching.comparisonResult.balanceMismatches.length} mismatches
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Download Excel Button */}
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => {
                      // Export to Excel instead of XML
                      if (!openingBalanceMatching.comparisonResult) return;

                      const wb = XLSX.utils.book_new();

                      // Balance Mismatches Sheet
                      if (openingBalanceMatching.comparisonResult.balanceMismatches.length > 0) {
                        const balanceData = openingBalanceMatching.comparisonResult.balanceMismatches.map((row, idx) => ({
                          'Sl No': idx + 1,
                          '$Name': row.$Name,
                          '$_PrimaryGroup': row.$_PrimaryGroup,
                          '$Parent': row.$Parent,
                          'New_Dr_Balance': row.New_Dr_Balance,
                          'New_Cr_Balance': row.New_Cr_Balance,
                          'Old_Dr_Balance': row.Old_Dr_Balance,
                          'Old_Cr_Balance': row.Old_Cr_Balance,
                          'Dr_Difference': row.Dr_Difference,
                          'Cr_Difference': row.Cr_Difference,
                        }));
                        const wsBalance = XLSX.utils.json_to_sheet(balanceData);
                        XLSX.utils.book_append_sheet(wb, wsBalance, "Balance Mismatches");
                      }

                      // Name Mismatches Sheet
                      if (openingBalanceMatching.comparisonResult.nameMismatches.length > 0) {
                        const nameData = openingBalanceMatching.comparisonResult.nameMismatches.map((row, idx) => ({
                          'Sl No': idx + 1,
                          'Name as per OLD Tally': row['Name as per OLD Tally'],
                          'Name as per NEW Tally': row['Name as per NEW Tally'],
                          'Balance as per OLD Tally': row['Balance as per OLD Tally'],
                          'Balance as per NEW Tally': row['Balance as per NEW Tally'],
                          'Remarks': row['Remarks'],
                        }));
                        const wsName = XLSX.utils.json_to_sheet(nameData);
                        XLSX.utils.book_append_sheet(wb, wsName, "Ledger Name Mismatches");
                      }

                      const fileName = `Balance_Comparison_${new Date().toISOString().split('T')[0]}.xlsx`;
                      XLSX.writeFile(wb, fileName);

                      toast({
                        title: "Excel Downloaded",
                        description: `${fileName} has been downloaded`,
                      });
                    }}
                    className="gap-2"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Download Excel Report
                  </Button>
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    The comparison report shows balance mismatches (ledgers with different balances between old and new Tally) and name mismatches (ledgers present in only one instance).
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {/* Reset Button */}
            {(openingBalanceMatching.oldTallyData || openingBalanceMatching.newTallyData || openingBalanceMatching.comparisonResult) && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    openingBalanceMatching.reset();
                  }}
                  size="sm"
                >
                  Reset
                </Button>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setShowOpeningBalanceDialog(false);
              openingBalanceMatching.reset();
            }}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Opening Balance Matching Help Dialog */}
      <Dialog open={showOpeningBalanceHelpDialog} onOpenChange={setShowOpeningBalanceHelpDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              How to Use Opening Balance Matching
            </DialogTitle>
            <DialogDescription>
              Step-by-step guide to compare and match opening balances between Old and New Tally instances
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-2 text-blue-900 dark:text-blue-100">Overview</h3>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  This tool helps you compare opening balances between two Tally instances (Old and New) and identify any mismatches. 
                  It's useful when migrating data or ensuring consistency between different Tally company files.
                </p>
              </div>

              <div className="space-y-4">
                <div className="border-l-4 border-primary pl-4">
                  <h3 className="font-semibold text-sm mb-2">Step 1: Fetch Old Tally Data</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                    <li>Open TallyPrime and load the <strong>Old Tally company file</strong> (the source file with existing balances)</li>
                    <li>Ensure Tally is running and ODBC connection is active</li>
                    <li>Click the <strong>"Fetch Old Tally Data"</strong> button</li>
                    <li>The system will fetch all ledger closing balances from the Old Tally instance</li>
                    <li>Wait for the confirmation message showing the number of ledgers fetched</li>
                  </ol>
                </div>

                <div className="border-l-4 border-primary pl-4">
                  <h3 className="font-semibold text-sm mb-2">Step 2: Fetch New Tally Data</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                    <li>In TallyPrime, close the Old Tally company and load the <strong>New Tally company file</strong> (the target file)</li>
                    <li>Ensure the ODBC connection is still active</li>
                    <li>Click the <strong>"Fetch New Tally Data"</strong> button</li>
                    <li>The system will fetch all ledger opening balances from the New Tally instance</li>
                    <li>Wait for the confirmation message showing the number of ledgers fetched</li>
                  </ol>
                </div>

                <div className="border-l-4 border-primary pl-4">
                  <h3 className="font-semibold text-sm mb-2">Step 3: Compare Balances</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                    <li>Once both Old and New Tally data are fetched, click the <strong>"Compare Balances"</strong> button</li>
                    <li>The system will compare the closing balances from Old Tally with opening balances from New Tally</li>
                    <li>Results will show:
                      <ul className="list-disc list-inside ml-4 mt-1">
                        <li><strong>Balance Mismatches:</strong> Ledgers where balances don't match between Old and New Tally</li>
                        <li><strong>Name Mismatches:</strong> Ledgers that exist in one instance but not the other</li>
                      </ul>
                    </li>
                    <li>Review the comparison results in the tables below</li>
                  </ol>
                </div>

                <div className="border-l-4 border-green-500 pl-4">
                  <h3 className="font-semibold text-sm mb-2">Step 4: Export Results</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                    <li>Click the <strong>"Download Excel Report"</strong> button to export the comparison results</li>
                    <li>The Excel file will contain two sheets:
                      <ul className="list-disc list-inside ml-4 mt-1">
                        <li><strong>Balance Mismatches:</strong> Detailed comparison of ledgers with different balances</li>
                        <li><strong>Ledger Name Mismatches:</strong> Ledgers present in only one Tally instance</li>
                      </ul>
                    </li>
                    <li>Use this report to identify and resolve discrepancies between the two Tally instances</li>
                  </ol>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-2 text-amber-900 dark:text-amber-100">Important Notes</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-amber-800 dark:text-amber-200">
                  <li>Ensure Tally is running with ODBC enabled before starting</li>
                  <li>Make sure you have the correct company file loaded in Tally for each step</li>
                  <li>The Old Tally should have closing balances, and New Tally should have opening balances</li>
                  <li>Ledger names must match exactly between both instances for accurate comparison</li>
                  <li>If ledger names differ, they will appear in the "Name Mismatches" section</li>
                  <li>You can reset and start over at any time using the "Reset" button</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-2">Troubleshooting</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li><strong>ODBC Connection Failed:</strong> Ensure Tally is running as Administrator and ODBC is enabled</li>
                  <li><strong>No Data Fetched:</strong> Verify the correct company file is loaded in Tally</li>
                  <li><strong>Mismatches Found:</strong> Review the Excel report to identify which ledgers need adjustment</li>
                  <li><strong>Name Mismatches:</strong> These may be due to renamed ledgers or new/removed accounts</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowOpeningBalanceHelpDialog(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const GSTTools = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { currentEngagement } = useEngagement();
  const { user } = useAuth();

  const [gstinDialogOpen, setGstinDialogOpen] = useState(false);
  const [gstinInput, setGstinInput] = useState("");
  const [gstinName, setGstinName] = useState("");
  const [taxpayerType, setTaxpayerType] = useState<GstinTaxpayerType | "">("");
  const [gstinLookupConsent, setGstinLookupConsent] = useState(false);
  const [isFetchingGstinDetails, setIsFetchingGstinDetails] = useState(false);
  const [gstinLookupMessage, setGstinLookupMessage] = useState<string | null>(null);
  const [bulkGstinFile, setBulkGstinFile] = useState<File | null>(null);
  const [bulkInvalidGstins, setBulkInvalidGstins] = useState<InvalidGstinRow[]>([]);
  const [bulkDuplicateCount, setBulkDuplicateCount] = useState(0);
  const [bulkLookupResults, setBulkLookupResults] = useState<GstinBulkLookupResult[]>([]);
  const [bulkLookupProgress, setBulkLookupProgress] = useState<{ completed: number; total: number } | null>(null);
  const [isBulkLookupRunning, setIsBulkLookupRunning] = useState(false);
  const cancelBulkLookupRef = useRef(false);
  const [gstins, setGstins] = useState<{ id: string; gstin: string; created_at: string }[]>([]);
  const [isLoadingGstins, setIsLoadingGstins] = useState(false);
  const [isSavingGstin, setIsSavingGstin] = useState(false);
  const [editingGstinId, setEditingGstinId] = useState<string | null>(null);
  const [editingGstinValue, setEditingGstinValue] = useState("");
  const [isUpdatingGstin, setIsUpdatingGstin] = useState(false);
  const [isDeletingGstinId, setIsDeletingGstinId] = useState<string | null>(null);

  const clientId = currentEngagement?.client_id;

  const fetchClientGstins = useCallback(async () => {
    if (!clientId) {
      setGstins([]);
      return;
    }

    setIsLoadingGstins(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .select("id, gstin, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGstins(data || []);
    } catch (error) {
      console.error("Error fetching GSTINs:", error);
      toast({
        title: "Failed to load GST numbers",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingGstins(false);
    }
  }, [clientId, toast]);

  useEffect(() => {
    fetchClientGstins();
  }, [fetchClientGstins]);

  const handleOpenGstinDialog = () => {
    if (!clientId) {
      toast({
        title: "Client not linked",
        description: "This engagement is not linked to a client. Link a client in Admin Settings → Clients.",
        variant: "destructive",
      });
      return;
    }
    setGstinInput("");
    setGstinName("");
    setTaxpayerType("");
    setGstinLookupConsent(false);
    setGstinLookupMessage(null);
    setBulkGstinFile(null);
    setBulkInvalidGstins([]);
    setBulkDuplicateCount(0);
    setBulkLookupResults([]);
    setGstinDialogOpen(true);
  };

  const handleFetchGstinDetails = async () => {
    const normalized = formatGstinInput(gstinInput);
    if (!gstinLookupConsent) {
      toast({ title: "Consent required", description: "Confirm the internet lookup statement before fetching GSTIN details." });
      return;
    }
    const validationError = getGstinValidationError(normalized);
    if (validationError) {
      toast({ title: "Invalid GSTIN", description: validationError, variant: "destructive" });
      return;
    }

    setIsFetchingGstinDetails(true);
    setGstinLookupMessage(null);
    try {
      const response = await window.electronAPI.gstinLookup.fetchDetails({
        gstin: normalized,
        consentConfirmed: true,
      });
      if (!response.success || !response.data) throw new Error(response.error || "GSTIN details could not be fetched.");
      if (!response.data.valid) {
        const message = "Local structure/checksum validation passed, but e-waybill.in did not confirm this GSTIN. No verified taxpayer details were returned.";
        setGstinLookupMessage(message);
        toast({ title: "GSTIN not confirmed by provider", description: message, variant: "destructive" });
        return;
      }

      setGstinName(response.data.name);
      if (response.data.taxpayerType) setTaxpayerType(response.data.taxpayerType);
      if (!response.data.name) {
        setGstinLookupMessage("Lookup completed, but the service did not return a taxpayer name. You can enter it manually.");
        toast({ title: "Name not returned", description: "The lookup service did not return a taxpayer name. You can enter it manually." });
      } else {
        setGstinLookupMessage("Taxpayer name fetched; registration type derived from the GSTIN.");
        toast({ title: "GSTIN details fetched", description: "Taxpayer name and registration type are ready to review." });
      }
    } catch (error) {
      setGstinLookupMessage(error instanceof Error ? error.message : "GSTIN details could not be fetched.");
      toast({
        title: "GSTIN lookup failed",
        description: error instanceof Error ? error.message : "Check your internet connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingGstinDetails(false);
    }
  };

  const handleDownloadGstinTemplate = async () => {
    const exportFile = window.electronAPI.app?.exportFile;
    if (!exportFile) {
      toast({ title: "Template download unavailable", description: "The Electron save dialog is not available." });
      return;
    }

    try {
      const buffer = new TextEncoder().encode("\uFEFFGSTIN\r\n").buffer as ArrayBuffer;
      const savedPath = await exportFile({
        defaultFilename: "GSTIN_Template.csv",
        buffer,
        mimeType: "text/csv;charset=utf-8",
        fileExtension: "csv",
        showSaveDialog: true,
      });
      if (savedPath) toast({ title: "Template downloaded", description: savedPath });
    } catch (error) {
      toast({
        title: "Template download failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadVerifiedGstins = async () => {
    const verifiedRows = bulkLookupResults.filter((result) => result.valid);
    if (verifiedRows.length === 0) {
      toast({ title: "No verified GSTINs", description: "Only provider-confirmed GSTINs are included in this download." });
      return;
    }

    const exportFile = window.electronAPI.app?.exportFile;
    if (!exportFile) {
      toast({ title: "Download unavailable", description: "The Electron save dialog is not available." });
      return;
    }

    try {
      const csv = createVerifiedGstinCsv(verifiedRows.map((result) => ({
        gstin: result.gstin,
        name: result.name,
        taxpayerType: result.taxpayerType ? GSTIN_TAXPAYER_TYPE_LABELS[result.taxpayerType] : "",
      })));
      const buffer = new TextEncoder().encode(`\uFEFF${csv}`).buffer as ArrayBuffer;
      const savedPath = await exportFile({
        defaultFilename: "Verified_GSTINs.csv",
        buffer,
        mimeType: "text/csv;charset=utf-8",
        fileExtension: "csv",
        showSaveDialog: true,
      });
      if (savedPath) toast({ title: "Verified GSTINs downloaded", description: savedPath });
    } catch (error) {
      toast({
        title: "Verified GSTIN download failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleBulkGstinLookup = async () => {
    if (!gstinLookupConsent) {
      toast({ title: "Consent required", description: "Confirm the internet lookup statement before fetching GSTIN details." });
      return;
    }
    if (!bulkGstinFile) {
      toast({ title: "Spreadsheet required", description: "Choose a CSV, XLS, or XLSX file first." });
      return;
    }

    let parsed;
    try {
      parsed = parseGstinSpreadsheet(await bulkGstinFile.arrayBuffer());
    } catch (error) {
      toast({
        title: "Spreadsheet could not be read",
        description: error instanceof Error ? error.message : "Choose a supported spreadsheet with GSTIN in cell A1.",
        variant: "destructive",
      });
      return;
    }

    setBulkInvalidGstins(parsed.invalidGstins);
    setBulkDuplicateCount(parsed.duplicateCount);
    setBulkLookupResults([]);
    if (parsed.invalidGstins.length > 0) {
      toast({
        title: "Invalid GSTINs excluded",
        description: `${parsed.invalidGstins.length} invalid GSTIN${parsed.invalidGstins.length === 1 ? " was" : "s were"} not sent to the API.`,
        variant: "destructive",
      });
    }
    if (parsed.validGstins.length === 0) {
      setBulkLookupProgress(null);
      if (parsed.invalidGstins.length === 0) {
        toast({ title: "No GSTINs found", description: "Enter GSTIN values below the GSTIN header." });
      }
      return;
    }

    setIsBulkLookupRunning(true);
    cancelBulkLookupRef.current = false;
    setBulkLookupProgress({ completed: 0, total: parsed.validGstins.length });
    const results: GstinBulkLookupResult[] = [];
    try {
      for (const gstin of parsed.validGstins) {
        if (cancelBulkLookupRef.current) break;
        try {
          const response = await window.electronAPI.gstinLookup.fetchDetails({
            gstin,
            consentConfirmed: true,
          });
          if (!response.success || !response.data) {
            results.push({ gstin, name: "", taxpayerType: "", valid: false, message: response.error || "Lookup failed." });
          } else {
            results.push({
              gstin,
              name: response.data.name,
              taxpayerType: getGstinTaxpayerType(gstin) || "",
              valid: response.data.valid,
              message: response.data.message,
            });
          }
        } catch (error) {
          results.push({
            gstin,
            name: "",
            taxpayerType: "",
            valid: false,
            message: error instanceof Error ? error.message : "Lookup failed.",
          });
        }
        setBulkLookupResults([...results]);
        setBulkLookupProgress({ completed: results.length, total: parsed.validGstins.length });
      }

      const confirmedCount = results.filter((result) => result.valid).length;
      toast({
        title: cancelBulkLookupRef.current ? "Bulk lookup stopped" : "Bulk lookup complete",
        description: cancelBulkLookupRef.current
          ? `Stopped after ${results.length} of ${parsed.validGstins.length} lookups. The current request was allowed to finish.`
          : `Lookup confirmed ${confirmedCount} of ${results.length} structurally valid GSTINs.`,
      });
    } finally {
      setIsBulkLookupRunning(false);
    }
  };

  const handleSaveBulkGstins = async () => {
    if (!clientId || !user?.id) {
      toast({ title: "Login required", description: "Sign in and select a client before saving GSTINs.", variant: "destructive" });
      return;
    }

    const existingGstins = new Set(gstins.map((item) => formatGstinInput(item.gstin)));
    const saveableResults = bulkLookupResults.filter(
      (result) => result.valid && result.name.trim() && result.taxpayerType && !existingGstins.has(result.gstin)
    );
    if (saveableResults.length === 0) {
      toast({
        title: "No complete GSTIN details to save",
        description: "Confirmed rows need a taxpayer name and a valid GSTIN-derived type.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingGstin(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .insert(saveableResults.map((result) => ({
          client_id: clientId,
          gstin: result.gstin,
          name: result.name.trim(),
          taxpayer_type: result.taxpayerType,
          created_by: user.id,
        })))
        .select("id, gstin, created_at");
      if (error) throw error;

      setGstins((current) => [...(data || []), ...current]);
      toast({ title: "GSTINs saved", description: `Saved ${data?.length || 0} GSTINs to this client locally.` });
      setBulkLookupResults([]);
      setBulkInvalidGstins([]);
      setBulkGstinFile(null);
    } catch (error) {
      toast({
        title: "Could not save GSTINs",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingGstin(false);
    }
  };

  const handleAddGstin = async () => {
    const normalized = formatGstinInput(gstinInput);
    const name = gstinName.trim();

    if (!clientId) {
      toast({
        title: "Client not linked",
        description: "Please link a client before adding GST numbers.",
        variant: "destructive",
      });
      return;
    }
    if (!normalized) {
      toast({ title: "GSTIN required", description: "Enter a GST number to continue." });
      return;
    }
    const gstinValidationError = getGstinValidationError(normalized);
    if (gstinValidationError) {
      toast({
        title: "Invalid GSTIN",
        description: gstinValidationError,
        variant: "destructive",
      });
      return;
    }
    if (!name) {
      toast({ title: "Company name required", description: "Enter the company/taxpayer name." });
      return;
    }
    if (gstins.some((gstin) => gstin.gstin === normalized)) {
      toast({ title: "GSTIN already added", description: "This GSTIN already exists for this client." });
      return;
    }
    if (!user?.id) {
      toast({
        title: "Login required",
        description: "Please sign in again to add GST numbers.",
        variant: "destructive",
      });
      return;
    }

    if (!taxpayerType) {
      toast({ title: "Taxpayer type required", description: "Select a type or fetch it from the lookup service." });
      return;
    }
    setIsSavingGstin(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .insert({
          client_id: clientId,
          gstin: normalized,
          name,
          taxpayer_type: taxpayerType,
          created_by: user.id,
        })
        .select("id, gstin, created_at")
        .single();

      if (error) throw error;

      setGstins((prev) => [data, ...prev]);
      setGstinInput("");
      setGstinName("");
      setTaxpayerType("");
      setGstinDialogOpen(false);
      toast({
        title: "GST number added",
        description: `${normalized} saved locally for ${currentEngagement?.client_name || "this client"}.`,
      });
    } catch (error) {
      console.error("Error adding GSTIN:", error);
      toast({
        title: "Failed to add GST number",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingGstin(false);
    }
  };

  const startEditGstin = (gstinId: string, gstinValue: string) => {
    setEditingGstinId(gstinId);
    setEditingGstinValue(formatGstinInput(gstinValue));
  };

  const cancelEditGstin = () => {
    setEditingGstinId(null);
    setEditingGstinValue("");
  };

  const handleUpdateGstin = async () => {
    if (!clientId || !editingGstinId) return;
    const normalized = formatGstinInput(editingGstinValue);

    if (!normalized) {
      toast({ title: "GSTIN required", description: "Enter a GST number to continue." });
      return;
    }
    const gstinValidationError = getGstinValidationError(normalized);
    if (gstinValidationError) {
      toast({
        title: "Invalid GSTIN",
        description: gstinValidationError,
        variant: "destructive",
      });
      return;
    }
    if (gstins.some((gstin) => gstin.gstin === normalized && gstin.id !== editingGstinId)) {
      toast({ title: "GSTIN already added", description: "This GSTIN already exists for this client." });
      return;
    }

    setIsUpdatingGstin(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .update({ gstin: normalized })
        .eq("id", editingGstinId)
        .eq("client_id", clientId)
        .select("id, gstin, created_at")
        .single();

      if (error) throw error;

      setGstins((prev) => prev.map((item) => (item.id === data.id ? data : item)));
      toast({ title: "GST number updated", description: `${normalized} updated.` });
      cancelEditGstin();
    } catch (error) {
      console.error("Error updating GSTIN:", error);
      toast({
        title: "Failed to update GST number",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingGstin(false);
    }
  };

  const handleDeleteGstin = async (gstinId: string, gstinValue: string) => {
    if (!clientId) return;

    setIsDeletingGstinId(gstinId);
    try {
      const { error } = await db
        .from("client_gstins")
        .delete()
        .eq("id", gstinId)
        .eq("client_id", clientId);

      if (error) throw error;

      setGstins((prev) => prev.filter((item) => item.id !== gstinId));
      toast({
        title: "GST number removed",
        description: `${gstinValue} removed from this client.`,
      });
    } catch (error) {
      console.error("Error deleting GSTIN:", error);
      toast({
        title: "Failed to delete GST number",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeletingGstinId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="GST Number Master"
          description="Add GST numbers linked to this client. Numbers are scoped per client."
          icon={<FilePlus className="h-5 w-5 text-primary" />}
          status="available"
          onClick={handleOpenGstinDialog}
        />
        <ToolCard
          title="GSTR1 Data Download"
          description="Download GSTR1 reports directly from GST portal for audit and reconciliation purposes."
          icon={<Download className="h-5 w-5 text-primary" />}
          status="available"
          onClick={() => navigate("/gstr1-integration")}
        />
        <ToolCard
          title="Reconcile with Books"
          description="Compare GST returns with books of accounts. Identify mismatches in sales, purchases, and ITC claims."
          icon={<Calculator className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="JSON to Excel Converter"
          description="Convert GST JSON files to Excel format for easy analysis and documentation."
          icon={<FileJson className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="ITC Reconciliation"
          description="Match GSTR-2A/2B with purchase register to identify eligible and ineligible ITC claims."
          icon={<Receipt className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="E-Way Bill Tracker"
          description="Track and validate e-way bills for goods movement verification."
          icon={<FileText className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      <Dialog open={gstinDialogOpen} onOpenChange={(open) => {
        if (!open && (isFetchingGstinDetails || isBulkLookupRunning || isSavingGstin)) return;
        setGstinDialogOpen(open);
        if (!open) setGstinLookupConsent(false);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>GST Number Master</DialogTitle>
            <DialogDescription>
              Manage GST numbers for {currentEngagement?.client_name || "this client"}. GST numbers are client-specific.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="gstin-input">GSTIN *</Label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    id="gstin-input"
                    value={gstinInput}
                    onChange={(e) => {
                      const normalized = formatGstinInput(e.target.value);
                      setGstinInput(normalized);
                      setGstinName("");
                      setTaxpayerType(getGstinTaxpayerType(normalized) || "");
                      setGstinLookupMessage(null);
                    }}
                    placeholder="Enter GSTIN (15 characters)"
                    maxLength={15}
                    className="font-mono"
                    disabled={isSavingGstin || isFetchingGstinDetails}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleFetchGstinDetails}
                    disabled={!gstinLookupConsent || !gstinInput.trim() || isFetchingGstinDetails || isSavingGstin}
                  >
                    {isFetchingGstinDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    {isFetchingGstinDetails ? "Fetching details..." : "Fetch taxpayer details"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gstin-name">Company/Taxpayer Name *</Label>
                <Input
                  id="gstin-name"
                  value={gstinName}
                  onChange={(e) => setGstinName(e.target.value)}
                  placeholder="Enter company or taxpayer name"
                  disabled={isSavingGstin}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="taxpayer-type">Taxpayer/Registration Type *</Label>
                <Input
                  id="taxpayer-type"
                  value={taxpayerType ? GSTIN_TAXPAYER_TYPE_LABELS[taxpayerType] : ""}
                  placeholder=""
                  readOnly
                />
              </div>
            </div>

            {gstinLookupMessage && <p className="text-sm text-muted-foreground" role="status">{gstinLookupMessage}</p>}

            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="gstin-lookup-consent"
                  checked={gstinLookupConsent}
                  onCheckedChange={(checked) => setGstinLookupConsent(checked === true)}
                  disabled={isFetchingGstinDetails || isBulkLookupRunning}
                />
                <Label htmlFor="gstin-lookup-consent" className="text-sm font-normal leading-5">
                  I hereby confirm and agree to the use of an API over the internet for fetching and retrieving GSTIN-related details and information, as required for the intended purpose.
                </Label>
              </div>
              <p className="pl-6 text-xs text-muted-foreground">
                Only GSTINs that pass local structure and checksum checks are sent to API.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleAddGstin} disabled={isSavingGstin || isFetchingGstinDetails}>
                {isSavingGstin ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FilePlus className="h-4 w-4 mr-2" />
                )}
                Add GSTIN
              </Button>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="bulk-gstin-file">Bulk GSTIN file</Label>
                  <p className="text-xs text-muted-foreground">CSV, XLS, or XLSX. The first worksheet must have GSTIN in cell A1, with GSTINs in column A from row 2 onward.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleDownloadGstinTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  Download CSV template
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  id="bulk-gstin-file"
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={(event) => {
                    setBulkGstinFile(event.target.files?.[0] || null);
                    setBulkInvalidGstins([]);
                    setBulkDuplicateCount(0);
                    setBulkLookupResults([]);
                    setBulkLookupProgress(null);
                  }}
                  disabled={isBulkLookupRunning || isSavingGstin}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBulkGstinLookup}
                  disabled={!bulkGstinFile || !gstinLookupConsent || isBulkLookupRunning || isSavingGstin}
                >
                  {isBulkLookupRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                  Validate and fetch
                </Button>
              </div>
              {isBulkLookupRunning && (
                <Button type="button" variant="outline" onClick={() => { cancelBulkLookupRef.current = true; }}>
                  Stop after current lookup
                </Button>
              )}
              {bulkLookupProgress && (
                <p className="text-sm text-muted-foreground" role="status">
                  Fetching details: {bulkLookupProgress.completed} of {bulkLookupProgress.total}
                </p>
              )}
              {bulkDuplicateCount > 0 && (
                <p className="text-sm text-muted-foreground">Skipped {bulkDuplicateCount} duplicate GSTIN row{bulkDuplicateCount === 1 ? "" : "s"}.</p>
              )}
              {bulkInvalidGstins.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p className="font-medium">These GSTINs are invalid and were not sent to the API:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {bulkInvalidGstins.map((item, index) => <li key={`${item.gstin}-${index}`}><span className="font-mono">{item.gstin}</span>: {item.error}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {bulkLookupResults.length > 0 && (
                <div className="space-y-2">
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {bulkLookupResults.map((result, index) => (
                      <div key={result.gstin} className={`rounded-md border p-3 ${result.valid ? "" : "border-red-300 bg-red-50/50"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-sm">{result.gstin}</span>
                          <span className={`text-xs ${result.valid ? "text-green-700" : "text-red-700"}`}>
                            {result.valid ? "Lookup confirmed" : "Not confirmed"}
                          </span>
                        </div>
                        {result.valid && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor={`bulk-gstin-name-${index}`}>Taxpayer name</Label>
                              <Input
                                id={`bulk-gstin-name-${index}`}
                                value={result.name}
                                onChange={(event) => setBulkLookupResults((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`bulk-gstin-type-${index}`}>Taxpayer/registration type</Label>
                              <Input
                                id={`bulk-gstin-type-${index}`}
                                value={result.taxpayerType ? GSTIN_TAXPAYER_TYPE_LABELS[result.taxpayerType] : ""}
                                readOnly
                              />
                            </div>
                          </div>
                        )}
                        {result.message && <p className="mt-2 text-xs text-muted-foreground">{result.message}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDownloadVerifiedGstins}
                      disabled={!bulkLookupResults.some((result) => result.valid) || isBulkLookupRunning || isSavingGstin}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download verified GSTINs
                    </Button>
                    <Button type="button" onClick={handleSaveBulkGstins} disabled={isSavingGstin || isBulkLookupRunning}>
                      {isSavingGstin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus className="mr-2 h-4 w-4" />}
                      Save complete GSTINs locally
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Saved GST numbers appear only for this client. Saving is local and does not call GSTZen.</p>
            </div>

            {isLoadingGstins ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading GST numbers...
              </div>
            ) : gstins.length === 0 ? (
              <div className="text-sm text-muted-foreground">No GST numbers added yet.</div>
            ) : (
              <div className="space-y-2">
                {gstins.map((gstin) => (
                  <div
                    key={gstin.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex-1">
                      {editingGstinId === gstin.id ? (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            value={editingGstinValue}
                            onChange={(e) => setEditingGstinValue(formatGstinInput(e.target.value))}
                            maxLength={15}
                            className="font-mono"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={handleUpdateGstin}
                              disabled={isUpdatingGstin}
                            >
                              {isUpdatingGstin ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : null}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelEditGstin}
                              disabled={isUpdatingGstin}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="font-mono text-sm">{gstin.gstin}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {editingGstinId !== gstin.id && (
                        <div className="text-xs text-muted-foreground">
                          Added {new Date(gstin.created_at).toLocaleDateString()}
                        </div>
                      )}
                      {editingGstinId !== gstin.id && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEditGstin(gstin.id, gstin.gstin)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteGstin(gstin.id, gstin.gstin)}
                            disabled={isDeletingGstinId === gstin.id}
                          >
                            {isDeletingGstinId === gstin.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Delete"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const MCATools = () => {
  const { toast } = useToast();
  const [cinNumber, setCinNumber] = useState("");

  return (
    <div className="space-y-6">
      <div className="bg-muted/50 rounded-lg p-4 border">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Label htmlFor="cin">CIN Number:</Label>
            <Input
              id="cin"
              value={cinNumber}
              onChange={(e) => setCinNumber(e.target.value)}
              placeholder="Enter CIN/LLPIN"
              className="flex-1"
            />
          </div>
          <Button size="sm" onClick={() => toast({ title: "Searching MCA...", description: `Looking up ${cinNumber}` })}>
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Get Company Master Data"
          description="Retrieve complete company master data including registered address, authorized capital, paid-up capital, and company status."
          icon={<Building2 className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Download Financials / AOC-4 / MGT-7"
          description="Download filed financial statements (AOC-4) and annual returns (MGT-7) directly from MCA."
          icon={<Download className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="DIR-3 KYC / DIN Status"
          description="Check Director Identification Number (DIN) status and DIR-3 KYC compliance for directors."
          icon={<Users className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Charges & Signatories"
          description="View registered charges on company assets and list of authorized signatories."
          icon={<CreditCard className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Company Documents"
          description="Access MOA, AOA, and other incorporation documents filed with MCA."
          icon={<FileText className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Related Party Check"
          description="Identify common directors and potential related parties across companies."
          icon={<Shield className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>
    </div>
  );
};

const IncomeTaxTools = () => {
  const { toast } = useToast();
  const [pan, setPan] = useState("");
  const [showDeferredTaxDialog, setShowDeferredTaxDialog] = useState(false);


  return (
    <div className="space-y-6">
      <div className="bg-muted/50 rounded-lg p-4 border">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Label htmlFor="pan">PAN Number:</Label>
            <Input
              id="pan"
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="Enter PAN"
              className="flex-1 uppercase"
              maxLength={10}
            />
          </div>
          <Button size="sm" onClick={() => toast({ title: "Income Tax Portal", description: "Authentication required" })}>
            <Search className="h-4 w-4 mr-2" />
            Connect
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Deferred Tax Calculator (AS-22)"
          description="Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22 for taxes on income."
          icon={<Scale className="h-5 w-5 text-primary" />}
          onClick={() => setShowDeferredTaxDialog(true)}
        />
        <ToolCard
          title="Check Notices on IT Website"
          description="View pending notices and communications from the Income Tax department for the assessee."
          icon={<Bell className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Check TDS Related Notices"
          description="Review TDS default notices, demand notices, and challan correction requirements."
          icon={<AlertTriangle className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="AIS (Annual Information Statement)"
          description="Access Annual Information Statement showing all financial transactions reported to IT department."
          icon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="TIS (Taxpayer Information Summary)"
          description="View Taxpayer Information Summary with pre-filled income details and high-value transactions."
          icon={<Table className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      <Dialog open={showDeferredTaxDialog} onOpenChange={setShowDeferredTaxDialog}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deferred Tax Calculator (AS-22)</DialogTitle>
            <DialogDescription>
              Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <DeferredTaxCalculator />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const PDFTools = () => {
  const { toast } = useToast();
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Split PDF specific state
  const [splitMode, setSplitMode] = useState<'range' | 'every' | 'specific'>('range');
  const [pageRange, setPageRange] = useState({ start: 1, end: 1 });
  const [splitEvery, setSplitEvery] = useState(1);
  const [specificPages, setSpecificPages] = useState('');
  const [totalPages, setTotalPages] = useState<number | null>(null);

  const toolsConfig: Record<string, {
    title: string;
    accept: string;
    multiple: boolean;
    description: string;
  }> = {
    "Merge PDFs": {
      title: "Merge PDF Documents",
      accept: ".pdf",
      multiple: true,
      description: "Select multiple PDF files to merge into one document"
    },
    "Split PDF": {
      title: "Split PDF File",
      accept: ".pdf",
      multiple: false,
      description: "Select a PDF file to split by page range"
    },
    "Word to PDF": {
      title: "Convert Word to PDF",
      accept: ".doc,.docx",
      multiple: true,
      description: "Select Word documents to convert to PDF"
    },
    "Excel to PDF": {
      title: "Convert Excel to PDF",
      accept: ".xls,.xlsx",
      multiple: true,
      description: "Select Excel files to convert to PDF"
    },
    "Redact PII": {
      title: "Redact Personal Information",
      accept: ".pdf",
      multiple: true,
      description: "Select PDF files to redact personal information"
    },
    "Compress PDF": {
      title: "Compress PDF",
      accept: ".pdf",
      multiple: true,
      description: "Select PDF files to compress"
    }
  };

  const handleToolClick = (toolName: string) => {
    setSelectedTool(toolName);
    setSelectedFiles([]);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      if (selectedTool === "Split PDF" && files.length === 1) {
        setSelectedFiles(files);
        // Get total page count for Split PDF
        try {
          const file = files[0];
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await PDFDocument.load(arrayBuffer);
          const pageCount = pdf.getPageCount();
          setTotalPages(pageCount);
          setPageRange({ start: 1, end: pageCount });
        } catch (error) {
          console.error("Error reading PDF:", error);
          setTotalPages(null);
          toast({
            title: "Error reading PDF",
            description: "Could not read the PDF file. Please ensure it's a valid PDF.",
            variant: "destructive",
          });
        }
      } else {
        setSelectedFiles(files);
      }
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const config = selectedTool ? toolsConfig[selectedTool] : null;

      if (config) {
        const validFiles = files.filter(file => {
          const ext = '.' + file.name.split('.').pop()?.toLowerCase();
          return config.accept.split(',').some(accept => accept.trim() === ext);
        });

        if (validFiles.length > 0) {
          if (config.multiple) {
            setSelectedFiles(validFiles);
          } else {
            setSelectedFiles([validFiles[0]]);
            // For Split PDF, get the total page count
            if (selectedTool === "Split PDF") {
              try {
                const file = validFiles[0];
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await PDFDocument.load(arrayBuffer);
                const pageCount = pdf.getPageCount();
                setTotalPages(pageCount);
                setPageRange({ start: 1, end: pageCount });
              } catch (error) {
                console.error("Error reading PDF:", error);
                setTotalPages(null);
                toast({
                  title: "Error reading PDF",
                  description: "Could not read the PDF file. Please ensure it's a valid PDF.",
                  variant: "destructive",
                });
              }
            }
          }
        } else {
          toast({
            title: "Invalid file type",
            description: `Please select ${config.accept} files`,
            variant: "destructive",
          });
        }
      }
    }
  };

  const handleProcess = async () => {
    if (selectedFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select files to process",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      if (selectedTool === "Merge PDFs") {
        // Merge PDF functionality
        if (selectedFiles.length < 2) {
          toast({
            title: "Insufficient files",
            description: "Please select at least 2 PDF files to merge",
            variant: "destructive",
          });
          setIsProcessing(false);
          return;
        }

        // Create a new PDF document
        const mergedPdf = await PDFDocument.create();

        // Process each PDF file
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];

          try {
            // Read the file as array buffer
            const arrayBuffer = await file.arrayBuffer();

            // Load the PDF
            const pdf = await PDFDocument.load(arrayBuffer);

            // Get all pages from the PDF
            const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

            // Add each page to the merged PDF
            pages.forEach((page) => {
              mergedPdf.addPage(page);
            });
          } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
            toast({
              title: "Error processing file",
              description: `Failed to process ${file.name}. It may not be a valid PDF file.`,
              variant: "destructive",
            });
            setIsProcessing(false);
            return;
          }
        }

        // Generate the merged PDF as bytes
        const mergedPdfBytes = await mergedPdf.save();

        // Create a blob and download
        const blob = new Blob([new Uint8Array(mergedPdfBytes)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `merged_pdf_${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast({
          title: "PDFs Merged Successfully",
          description: `Successfully merged ${selectedFiles.length} PDF file(s)`,
        });

        setSelectedTool(null);
        setSelectedFiles([]);
        setTotalPages(null);
        setSplitMode('range');
        setPageRange({ start: 1, end: 1 });
        setSplitEvery(1);
        setSpecificPages('');
      } else if (selectedTool === "Split PDF") {
        // Split PDF functionality
        if (selectedFiles.length !== 1) {
          toast({
            title: "Invalid selection",
            description: "Please select exactly one PDF file to split",
            variant: "destructive",
          });
          setIsProcessing(false);
          return;
        }

        try {
          const file = selectedFiles[0];
          const arrayBuffer = await file.arrayBuffer();
          const sourcePdf = await PDFDocument.load(arrayBuffer);
          const pageCount = sourcePdf.getPageCount();

          let pagesToExtract: number[] = [];

          if (splitMode === 'range') {
            // Extract page range
            const start = Math.max(1, Math.min(pageRange.start, pageCount));
            const end = Math.max(start, Math.min(pageRange.end, pageCount));

            if (start > end) {
              toast({
                title: "Invalid range",
                description: "Start page must be less than or equal to end page",
                variant: "destructive",
              });
              setIsProcessing(false);
              return;
            }

            for (let i = start; i <= end; i++) {
              pagesToExtract.push(i - 1); // pdf-lib uses 0-based indexing
            }
          } else if (splitMode === 'every') {
            // Split every N pages
            if (splitEvery < 1) {
              toast({
                title: "Invalid value",
                description: "Pages per file must be at least 1",
                variant: "destructive",
              });
              setIsProcessing(false);
              return;
            }

            // Create multiple PDFs, each with splitEvery pages
            const baseFileName = file.name.replace('.pdf', '');

            for (let startPage = 0; startPage < pageCount; startPage += splitEvery) {
              const endPage = Math.min(startPage + splitEvery - 1, pageCount - 1);
              const newPdf = await PDFDocument.create();

              const pages = await newPdf.copyPages(sourcePdf,
                Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i)
              );

              pages.forEach((page) => {
                newPdf.addPage(page);
              });

              const pdfBytes = await newPdf.save();
              const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${baseFileName}_pages_${startPage + 1}_to_${endPage + 1}.pdf`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }

            toast({
              title: "PDF Split Successfully",
              description: `Split PDF into ${Math.ceil(pageCount / splitEvery)} file(s)`,
            });

            setSelectedTool(null);
            setSelectedFiles([]);
            setTotalPages(null);
            setSplitMode('range');
            setPageRange({ start: 1, end: 1 });
            setSplitEvery(1);
            setSpecificPages('');
            setIsProcessing(false);
            return;
          } else if (splitMode === 'specific') {
            // Extract specific pages
            const pageNumbers = specificPages
              .split(',')
              .map(p => p.trim())
              .filter(p => p.length > 0)
              .map(p => {
                if (p.includes('-')) {
                  const [start, end] = p.split('-').map(n => parseInt(n.trim()));
                  if (!isNaN(start) && !isNaN(end) && start <= end) {
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
                  }
                  return [];
                }
                const num = parseInt(p);
                return isNaN(num) ? [] : [num];
              })
              .flat()
              .filter(p => !isNaN(p) && p >= 1 && p <= pageCount)
              .map(p => p - 1); // Convert to 0-based

            if (pageNumbers.length === 0) {
              toast({
                title: "Invalid pages",
                description: "Please specify valid page numbers (e.g., 1,3,5 or 1-5)",
                variant: "destructive",
              });
              setIsProcessing(false);
              return;
            }

            pagesToExtract = [...new Set(pageNumbers)].sort((a, b) => a - b);
          }

          // Create the split PDF
          const newPdf = await PDFDocument.create();
          const pages = await newPdf.copyPages(sourcePdf, pagesToExtract);
          pages.forEach((page) => {
            newPdf.addPage(page);
          });

          const pdfBytes = await newPdf.save();
          const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;

          let fileName = file.name.replace('.pdf', '');
          if (splitMode === 'range') {
            a.download = `${fileName}_pages_${pageRange.start}_to_${pageRange.end}.pdf`;
          } else {
            a.download = `${fileName}_extracted_pages.pdf`;
          }

          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          toast({
            title: "PDF Split Successfully",
            description: `Extracted ${pagesToExtract.length} page(s) from the PDF`,
          });

          setSelectedTool(null);
          setSelectedFiles([]);
          setTotalPages(null);
          setSplitMode('range');
          setPageRange({ start: 1, end: 1 });
          setSplitEvery(1);
          setSpecificPages('');
        } catch (error) {
          console.error("Error splitting PDF:", error);
          toast({
            title: "Processing Failed",
            description: error instanceof Error ? error.message : "An error occurred while splitting the PDF",
            variant: "destructive",
          });
        } finally {
          setIsProcessing(false);
        }
      } else {
        // Placeholder for other tools
        setTimeout(() => {
          setIsProcessing(false);
          toast({
            title: `${selectedTool} - Processing`,
            description: `Processing ${selectedFiles.length} file(s). This feature is coming soon!`,
          });
          setSelectedTool(null);
          setSelectedFiles([]);
        }, 1500);
      }
    } catch (error) {
      console.error("Error processing PDFs:", error);
      toast({
        title: "Processing Failed",
        description: error instanceof Error ? error.message : "An error occurred while processing the files",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const config = selectedTool ? toolsConfig[selectedTool] : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Merge PDF Documents"
          description="Combine multiple PDF files into a single document. Useful for consolidating audit evidence."
          icon={<Merge className="h-5 w-5 text-primary" />}
          onClick={() => handleToolClick("Merge PDFs")}
        />
        <ToolCard
          title="Split PDF File"
          description="Split a PDF into multiple files by page range or extract specific pages."
          icon={<Scissors className="h-5 w-5 text-primary" />}
          onClick={() => handleToolClick("Split PDF")}
        />
        <ToolCard
          title="Convert Word to PDF"
          description="Convert Microsoft Word documents (.doc, .docx) to PDF format."
          icon={<FileType className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Convert Excel to PDF"
          description="Convert Microsoft Excel spreadsheets (.xls, .xlsx) to PDF format."
          icon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Redact Personal Information"
          description="Automatically detect and redact PII like Aadhaar, PAN, bank account numbers from documents."
          icon={<Eye className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="OCR - Extract Text from PDF"
          description="Extract text from scanned PDFs using optical character recognition."
          icon={<FileText className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Compress PDF"
          description="Reduce PDF file size while maintaining quality for easier sharing and storage."
          icon={<FilePlus className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Add Watermark"
          description="Add 'Draft', 'Confidential', or custom watermarks to PDF documents."
          icon={<Shield className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      {/* PDF Tool Dialog */}
      <Dialog open={selectedTool !== null} onOpenChange={(open) => {
        if (!open) {
          setSelectedTool(null);
          setSelectedFiles([]);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{config?.title}</DialogTitle>
            <DialogDescription>
              {config?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* File Drop Zone */}
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50',
                selectedFiles.length > 0 && 'border-primary bg-primary/5'
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={config?.accept}
                multiple={config?.multiple}
                onChange={handleFileSelect}
              />
              {selectedFiles.length > 0 ? (
                <>
                  <FileText className="h-12 w-12 mx-auto text-primary mb-4" />
                  <p className="text-sm text-foreground font-medium mb-2">
                    {selectedFiles.length} file(s) selected
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {selectedFiles.map((file, idx) => (
                      <p key={idx} className="text-xs text-muted-foreground">
                        {file.name} ({formatFileSize(file.size)})
                      </p>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Click to change files</p>
                </>
              ) : (
                <>
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-sm text-foreground font-medium mb-1">
                    Drop files here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {config?.accept} {config?.multiple ? '(Multiple files allowed)' : '(Single file)'}
                  </p>
                </>
              )}
            </div>

            {/* Split PDF Options */}
            {selectedTool === "Split PDF" && selectedFiles.length > 0 && totalPages !== null && (
              <div className="space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <Label>Split Mode</Label>
                  <Select value={splitMode} onValueChange={(value: 'range' | 'every' | 'specific') => setSplitMode(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="range">Extract Page Range</SelectItem>
                      <SelectItem value="every">Split Every N Pages</SelectItem>
                      <SelectItem value="specific">Extract Specific Pages</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {splitMode === 'range' && (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      Total pages: {totalPages}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="start-page">Start Page</Label>
                        <Input
                          id="start-page"
                          type="number"
                          min={1}
                          max={totalPages}
                          value={pageRange.start}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 1;
                            setPageRange({ ...pageRange, start: Math.max(1, Math.min(value, totalPages || 1)) });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end-page">End Page</Label>
                        <Input
                          id="end-page"
                          type="number"
                          min={pageRange.start}
                          max={totalPages}
                          value={pageRange.end}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 1;
                            setPageRange({ ...pageRange, end: Math.max(pageRange.start, Math.min(value, totalPages || 1)) });
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Pages {pageRange.start} to {pageRange.end} will be extracted ({pageRange.end - pageRange.start + 1} pages)
                    </p>
                  </div>
                )}

                {splitMode === 'every' && (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      Total pages: {totalPages}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="split-every">Pages per File</Label>
                      <Input
                        id="split-every"
                        type="number"
                        min={1}
                        max={totalPages}
                        value={splitEvery}
                        onChange={(e) => {
                          const value = parseInt(e.target.value) || 1;
                          setSplitEvery(Math.max(1, Math.min(value, totalPages || 1)));
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      PDF will be split into {Math.ceil((totalPages || 1) / splitEvery)} file(s), each containing {splitEvery} page(s)
                    </p>
                  </div>
                )}

                {splitMode === 'specific' && (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      Total pages: {totalPages}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="specific-pages">Page Numbers</Label>
                      <Input
                        id="specific-pages"
                        type="text"
                        placeholder="e.g., 1,3,5 or 1-5,10,15-20"
                        value={specificPages}
                        onChange={(e) => setSpecificPages(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter page numbers separated by commas. Use ranges like "1-5" for pages 1 through 5. Example: "1,3,5" or "1-5,10,15-20"
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Process Button */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedTool(null);
                  setSelectedFiles([]);
                  setTotalPages(null);
                  setSplitMode('range');
                  setPageRange({ start: 1, end: 1 });
                  setSplitEvery(1);
                  setSpecificPages('');
                }}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleProcess}
                disabled={selectedFiles.length === 0 || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <FilePlus className="h-4 w-4 mr-2" />
                    Process Files
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const AnalyticsTools = () => {
  const { toast } = useToast();
  const [showDTLDialog, setShowDTLDialog] = useState(false);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Deferred Tax Calculator (AS-22)"
          description="Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22 for taxes on income."
          icon={<Scale className="h-5 w-5 text-primary" />}
          onClick={() => setShowDTLDialog(true)}
        />
        <ToolCard
          title="Ratio Analysis Calculator"
          description="Calculate key financial ratios including liquidity, profitability, and solvency ratios from trial balance."
          icon={<Calculator className="h-5 w-5 text-primary" />}
          onClick={() => toast({ title: "Ratio Analysis", description: "Import trial balance first" })}
        />
        <ToolCard
          title="Benford's Law Analysis"
          description="Apply Benford's Law to detect anomalies in financial data that may indicate fraud or errors."
          icon={<Search className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Duplicate Transaction Finder"
          description="Identify potential duplicate transactions based on amount, date, and party matching."
          icon={<AlertTriangle className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Bank Statement Analyzer"
          description="Parse and analyze bank statements for reconciliation and unusual transaction detection."
          icon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Sampling Calculator"
          description="Calculate sample sizes using statistical sampling methods (MUS, random, stratified)."
          icon={<Calculator className="h-5 w-5 text-primary" />}
          onClick={() => toast({ title: "Sampling Calculator", description: "Feature available" })}
        />
        <ToolCard
          title="Trend Analysis"
          description="Perform month-on-month and year-on-year trend analysis on key financial metrics."
          icon={<Table className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      {/* Deferred Tax Calculator Dialog */}
      <Dialog open={showDTLDialog} onOpenChange={setShowDTLDialog}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deferred Tax Calculator (AS-22)</DialogTitle>
            <DialogDescription>
              Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <DeferredTax />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const AUDIT_TOOLS_TABS = ['tally', 'gst', 'mca', 'incometax', 'pdf', 'analytics'];

export default function AuditTools() {
  const { currentEngagement } = useEngagement();
  const location = useLocation();
  const queryTab = new URLSearchParams(location.search).get('tab');
  const [activeTab, setActiveTab] = useState(AUDIT_TOOLS_TABS.includes(queryTab || '') ? queryTab || 'tally' : 'tally');

  useEffect(() => {
    if (queryTab && AUDIT_TOOLS_TABS.includes(queryTab) && queryTab !== activeTab) {
      setActiveTab(queryTab);
    }
  }, [activeTab, queryTab]);

  // Enable tab keyboard shortcuts (Ctrl+1-6, Alt+Arrow)
  useTabShortcuts(AUDIT_TOOLS_TABS, activeTab, setActiveTab);

  if (!currentEngagement) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VERA Tools</h1>
          <p className="text-muted-foreground">
            Productivity tools to streamline your audit workflow
          </p>
        </div>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select an engagement from the sidebar to use VERA tools.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">VERA Tools</h1>
        <p className="text-muted-foreground">
          {currentEngagement.client_name} - {currentEngagement.name}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          <TabsTrigger
            value="tally"
            className="flex items-center gap-2"
          >
            <Database className="h-4 w-4" />
            Tally Tools
          </TabsTrigger>
          <TabsTrigger
            value="gst"
            className="flex items-center gap-2"
          >
            <Receipt className="h-4 w-4" />
            GST Related
          </TabsTrigger>
          <TabsTrigger
            value="mca"
            className="flex items-center gap-2"
          >
            <Building2 className="h-4 w-4" />
            MCA Data
          </TabsTrigger>
          <TabsTrigger
            value="incometax"
            className="flex items-center gap-2"
          >
            <FileText className="h-4 w-4" />
            Income Tax
          </TabsTrigger>
          <TabsTrigger
            value="pdf"
            className="flex items-center gap-2"
          >
            <FileType className="h-4 w-4" />
            PDF Tools
          </TabsTrigger>
          <TabsTrigger
            value="analytics"
            className="flex items-center gap-2"
          >
            <Calculator className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tally">
          <TallyTools />
        </TabsContent>

        <TabsContent value="gst">
          <GSTTools />
        </TabsContent>

        <TabsContent value="mca">
          <MCATools />
        </TabsContent>

        <TabsContent value="incometax">
          <IncomeTaxTools />
        </TabsContent>

        <TabsContent value="pdf">
          <PDFTools />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTools />
        </TabsContent>
      </Tabs>
    </div>
  );
}
