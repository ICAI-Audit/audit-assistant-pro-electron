// Ledger Analysis - shared data model.
//
// SIGN CONVENTION used everywhere inside this module: DEBIT = POSITIVE, CREDIT = NEGATIVE.
// Every importer converts its source's convention into this one (Tally XML/ODBC and the
// Day Book Extractor workbook use Debit = negative; Busy and Zoho already use Debit = positive).

export type Nature = "Asset" | "Liability" | "Income" | "Expense" | "Unknown";
export type PartyType = "Debtor" | "Creditor" | null;
export type SourceKind = "tally" | "daybook-extractor" | "busy" | "zoho" | "excel";

export interface LedgerRow {
  name: string;
  /** Immediate parent group as in the source. */
  parent: string;
  /** Top-level (primary) group. */
  primaryGroup: string;
  /** Parent chain, nearest first, ending with the primary group (when the source gives it). */
  chain: string[];
  nature: Nature;
  partyType: PartyType;
  /** Reserved / well-known group that drove the classification, e.g. "Sundry Debtors", "Bank Accounts". */
  reservedGroup: string;
  gstin: string;
  pan: string;
  gstRegistrationType: string;
  /** Dr positive. */
  opening: number;
  /** Period debit total (positive number). */
  debit: number;
  /** Period credit total (positive number). */
  credit: number;
  /** Dr positive. */
  closing: number;
  /** True when opening/debit/credit/closing were given by a TB/master (not only built from day book lines). */
  hasBalances: boolean;
}

/** One bill allocation of a ledger line (Tally bill-wise details). Amount Dr positive. */
export interface BillRef {
  name: string;
  /** New Ref / Agst Ref / Advance / On Account */
  type: string;
  creditPeriod: string;
  amount: number;
}

export interface DayBookLine {
  /** Voucher key - all lines of one voucher share it. */
  voucherId: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  voucherType: string;
  voucherNo: string;
  reference: string;
  party: string;
  ledger: string;
  /** Dr positive, Cr negative. */
  amount: number;
  narration: string;
  partyGstin: string;
  /** Group columns carried by the day book itself (optional). */
  group: string;
  primaryGroup: string;
  /** Voucher total (as Tally reports it), same on every line of the voucher. */
  voucherAmount?: number;
  /** Bill-wise allocations of this ledger line, when the source has them. */
  bills?: BillRef[];
}

export interface Dataset {
  company: string;
  from: string; // ISO
  to: string; // ISO
  ledgers: LedgerRow[];
  lines: DayBookLine[];
  sources: string[];
  warnings: string[];
  /** Whether the loaded sources actually carry GSTIN / PAN (otherwise "missing" would be meaningless). */
  taxFields: { gstin: boolean; pan: boolean };
}

export interface AnalysisSettings {
  smallBalanceLimit: number;
  sdMultiplier: number;
  duplicateWindowDays: number;
  minExpenseHeads: number;
  fuzzyThreshold: number;
  /** Ignore rounding below this (rupees). */
  tolerance: number;
  /** Round-amount entries: vouchers of at least this amount ... */
  roundMinAmount: number;
  /** ... that are an exact multiple of this. */
  roundUnit: number;
  /** Same amount repeated: flagged at this many vouchers ... */
  repeatMinCount: number;
  /** ... of at least this amount. */
  repeatMinAmount: number;
  /** s.40A(3): cash payment to a person in a day above this. */
  cash40A3Limit: number;
  /** s.269ST: cash receipt from a person in a day of this or more. */
  cash269STLimit: number;
  /** s.269SS / 269T: loan or deposit taken / repaid in cash of this or more. */
  cashLoanLimit: number;
  /** Round-off check: a single round-off entry above this is unusual. */
  roundOffLimit: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  smallBalanceLimit: 1000,
  sdMultiplier: 2,
  duplicateWindowDays: 7,
  minExpenseHeads: 2,
  fuzzyThreshold: 0.9,
  tolerance: 1,
  roundMinAmount: 10000,
  roundUnit: 1000,
  repeatMinCount: 3,
  repeatMinAmount: 5000,
  cash40A3Limit: 10000,
  cash269STLimit: 200000,
  cashLoanLimit: 20000,
  roundOffLimit: 10,
};

/** A generic result table: column keys in display order, rows as plain objects. */
export interface ColumnDef {
  key: string;
  label: string;
  type?: "text" | "amount" | "number" | "date";
  /** Written to Excel only; not shown in the on-screen table (e.g. a long text the Details panel shows better). */
  exportOnly?: boolean;
}

export interface ResultTableData {
  id: string;
  title: string;
  description: string;
  columns: ColumnDef[];
  rows: Record<string, string | number | null>[];
  /** Why the check could not run (missing data), if it could not. */
  cannotRun?: string;
}
