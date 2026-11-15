// Ledger Analysis - file importers (renderer side, no network).
//
// Supported inputs
//   Day Book : Day Book Extractor workbook ($Date / $Amount / $DRcr columns + "Ledgers" sheet),
//              or any columnar day book / journal / GL export (Tally detailed Excel, Busy, Zoho,
//              hand-made Excel) - columns are detected by name and can be overridden by the user.
//   Trial Balance : Day Book Extractor "Ledgers" sheet, Busy TB, Zoho TB (both via the existing FSG
//              parsers, unchanged) or a generic columnar TB.
//   Ledger masters : any sheet with Ledger name + GSTIN / PAN / Group columns.
//
// Everything is converted to Debit = positive (see types.ts).

import * as XLSX from "xlsx";
import { parseBusyTB } from "@/modules/fsg/utils/busyParsers";
import { parseZohoTB } from "@/modules/fsg/utils/zohoParsers";
import { chainFromGroups, classifyChain } from "./classify";
import type { BillRef, DayBookLine, Dataset, LedgerRow, Nature, PartyType } from "./types";

// ── small helpers ────────────────────────────────────────────────────────────

export const normName = (s: unknown) =>
  String(s ?? "").replace(/[\s\u00a0]+/g, " ").trim();
export const keyName = (s: unknown) => normName(s).toLowerCase();
const normHeader = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/^\$/, "").replace(/[^a-z0-9#]+/g, "");
const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tolerant number reader: 1234, "1,23,456.78", "(1,000)", "500 Cr", "500 Dr", "-12". Returns {value, side}. */
export function readAmount(v: unknown): { value: number; side: "Dr" | "Cr" | null } {
  if (v === null || v === undefined || v === "") return { value: 0, side: null };
  if (typeof v === "number") return { value: Number.isFinite(v) ? v : 0, side: null };
  const t = String(v).trim();
  if (!t) return { value: 0, side: null };
  const side = /\bcr\.?\s*$/i.test(t) ? "Cr" : /\bdr\.?\s*$/i.test(t) ? "Dr" : null;
  const neg = /^\(.*\)$/.test(t.replace(/\s*(dr|cr)\.?\s*$/i, "")) || /^-/.test(t);
  const n = parseFloat(t.replace(/[₹,\s()]/g, "").replace(/(dr|cr)\.?$/i, "").replace(/^-/, ""));
  if (!Number.isFinite(n)) return { value: 0, side };
  return { value: neg ? -n : n, side };
}

/** Signed Dr-positive value of a single balance cell. drNegative = the source writes debit as negative. */
function balanceValue(raw: unknown, formatted: unknown, drNegative: boolean): number {
  const f = readAmount(formatted);
  if (f.side) return f.side === "Dr" ? Math.abs(f.value) : -Math.abs(f.value);
  const r = readAmount(raw);
  if (r.side) return r.side === "Dr" ? Math.abs(r.value) : -Math.abs(r.value);
  return drNegative ? -r.value : r.value;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** Any date cell -> ISO yyyy-mm-dd, or "" when it is not a date. */
export function toIsoDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (v > 19000101 && v < 21001231 && Number.isInteger(v)) {
      const s = String(v);
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    if (v < 20000 || v > 80000) return "";
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : "";
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  const t = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{8})$/.exec(t);
  if (m) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,4})[-/. ,]*(\d{2,4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t); // Indian dd-mm-yyyy
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  return "";
}

export function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: false, cellText: true });
}

interface Grid {
  sheet: string;
  raw: unknown[][];
  text: unknown[][];
}

function grids(wb: XLSX.WorkBook): Grid[] {
  return wb.SheetNames.map((sn) => {
    const ws = wb.Sheets[sn];
    return {
      sheet: sn,
      raw: XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false }),
      text: XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null, blankrows: false }),
    };
  });
}

/** Finds the header row (within the first 40 rows) that matches the most column synonyms. */
function findHeader(g: Grid, syn: Record<string, string[]>, required: string[]) {
  let best: { row: number; cols: Record<string, number>; score: number } | null = null;
  for (let i = 0; i < Math.min(g.raw.length, 40); i++) {
    const cells = (g.raw[i] || []).map(normHeader);
    const cols: Record<string, number> = {};
    for (const [field, names] of Object.entries(syn)) {
      const idx = cells.findIndex((c, j) => names.includes(c) && !Object.values(cols).includes(j));
      if (idx >= 0) cols[field] = idx;
    }
    if (!required.every((r) => r.split("|").some((alt) => cols[alt] !== undefined))) continue;
    const score = Object.keys(cols).length;
    if (!best || score > best.score) best = { row: i, cols, score };
  }
  return best;
}

// ── Day Book ─────────────────────────────────────────────────────────────────

export const DAYBOOK_FIELDS: { key: keyof DayBookColumnMap; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "voucherType", label: "Voucher type" },
  { key: "voucherNo", label: "Voucher no." },
  { key: "reference", label: "Reference / bill no." },
  { key: "party", label: "Party" },
  { key: "ledger", label: "Ledger / account" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "amount", label: "Amount (signed)" },
  { key: "drcr", label: "Dr/Cr indicator" },
  { key: "narration", label: "Narration" },
  { key: "group", label: "Ledger group" },
  { key: "primaryGroup", label: "Primary group" },
  { key: "partyGstin", label: "Party GSTIN" },
  { key: "voucherKey", label: "Voucher ID" },
  { key: "voucherAmount", label: "Voucher amount" },
  { key: "billName", label: "Bill / Ref name" },
  { key: "billType", label: "Reference type" },
  { key: "billAmount", label: "Bill amount" },
  { key: "creditPeriod", label: "Credit period" },
];

export interface DayBookColumnMap {
  date?: number; voucherType?: number; voucherNo?: number; reference?: number; party?: number;
  ledger?: number; debit?: number; credit?: number; amount?: number; drcr?: number; narration?: number;
  group?: number; primaryGroup?: number; partyGstin?: number; voucherKey?: number;
  voucherAmount?: number; billName?: number; billType?: number; billAmount?: number; creditPeriod?: number;
}

const DB_SYN: Record<string, string[]> = {
  voucherKey: ["pk", "masterid", "voucherid", "vchid", "voucherguid", "guid"],
  date: ["date", "voucherdate", "vchdate", "txndate", "transactiondate", "entrydate", "documentdate", "postingdate"],
  voucherType: ["vouchertypename", "vouchertype", "vchtype", "transactiontype", "type", "entrytype", "doctype"],
  voucherNo: ["vouchernumber", "voucherno", "vchno", "vchnumber", "transaction#", "transactionno", "transactionnumber", "entryno", "documentno", "docno", "journalno"],
  reference: ["reference", "referenceno", "reference#", "refno", "ref", "billno", "invoiceno", "supplierinvoiceno", "billnumber"],
  party: ["partyledgername", "party", "partyname", "partyledger", "customer", "vendor", "contact", "customername", "vendorname"],
  ledger: ["ledgername", "ledger", "account", "accountname", "particulars", "glaccount", "accounthead", "ledgeraccount"],
  debit: ["debit", "dr", "debitamount", "dramount", "debitinr", "debit₹"],
  credit: ["credit", "cr", "creditamount", "cramount", "creditinr", "credit₹"],
  amount: ["amount", "value", "amountinr", "netamount"],
  drcr: ["drcr", "drorcr", "crdr", "side", "isdeemedpositive"],
  narration: ["narration", "description", "transactiondetails", "remarks", "notes", "memo", "particularsnarration"],
  group: ["ledgroup", "ledgergroup", "group", "parent", "parentgroup", "under"],
  primaryGroup: ["maingroup", "primarygroup", "primary", "nature"],
  partyGstin: ["partygstin", "gstin", "gstinuin", "gstno", "gstnumber"],
  // TallyDayBook.exe v6 output columns
  voucherAmount: ["voucheramount", "vchamount", "vouchertotal"],
  billName: ["billrefname", "billname", "billref", "refname", "billreference"],
  billType: ["referencetype", "billtype", "reftype"],
  billAmount: ["billamount"],
  creditPeriod: ["creditperiod", "billcreditperiod"],
};

export type DayBookFormat = "daybook-extractor" | "tallydaybook-exe" | "generic";

export interface DayBookParse {
  format: DayBookFormat;
  sheet: string;
  headers: string[];
  columns: DayBookColumnMap;
  lines: DayBookLine[];
  ledgers: LedgerInput[];
  groups: { name: string; parent: string }[];
  company: string;
  warnings: string[];
}

/** Picks the sheet that looks most like a day book and detects its columns. */
export function detectDayBook(wb: XLSX.WorkBook, sheetName?: string): { grid: Grid; headerRow: number; columns: DayBookColumnMap; format: DayBookFormat } {
  const all = grids(wb);
  const cand = sheetName ? all.filter((g) => g.sheet === sheetName) : all;
  let best: { grid: Grid; h: NonNullable<ReturnType<typeof findHeader>> } | null = null;
  for (const g of cand) {
    const h = findHeader(g, DB_SYN, ["date", "ledger|party", "debit|amount"]);
    if (h && (!best || h.score > best.h.score)) best = { grid: g, h };
  }
  if (!best) {
    throw new Error("No day book sheet found. Expected a header row with Date, Ledger/Account and Debit/Credit (or Amount) columns.");
  }
  const hdr = (best.grid.raw[best.h.row] || []).map((c) => String(c ?? ""));
  const nh = hdr.map(normHeader);
  const format: DayBookFormat = hdr.some((c) => /^\$date$/i.test(c.trim())) && hdr.some((c) => /^\$amount$/i.test(c.trim()))
    ? "daybook-extractor"
    : nh.includes("billrefname") && nh.includes("referencetype") && nh.includes("ledgername") ? "tallydaybook-exe" : "generic";
  return { grid: best.grid, headerRow: best.h.row, columns: best.h.cols as DayBookColumnMap, format };
}

export function parseDayBook(buffer: ArrayBuffer, override?: { sheet?: string; columns?: DayBookColumnMap; drNegative?: boolean }): DayBookParse {
  const wb = readWorkbook(buffer);
  const det = detectDayBook(wb, override?.sheet);
  const cols: DayBookColumnMap = override?.columns ?? det.columns;
  const g = det.grid;
  const warnings: string[] = [];
  const headers = (g.raw[det.headerRow] || []).map((c) => String(c ?? ""));
  // Day Book Extractor ($Amount) and Tally write debit as negative when no Dr/Cr column is present.
  const drNegative = override?.drNegative ?? det.format === "daybook-extractor";

  const at = (row: unknown[], c?: number) => (c === undefined ? null : row[c]);
  const str = (row: unknown[], c?: number) => normName(at(row, c));

  const lines: DayBookLine[] = [];
  let last = { date: "", type: "", no: "", party: "", ref: "", narr: "", key: "" };
  let seq = 0;
  let running = 0;
  let curKey = "";
  let badDates = 0;
  let billRowsMerged = 0;
  const readBill = (row: unknown[]): BillRef | null => {
    if (cols.billName === undefined && cols.billType === undefined) return null;
    const name = str(row, cols.billName), type = str(row, cols.billType);
    const amt = readAmount(at(row, cols.billAmount)).value;
    if (!name && !type && !amt) return null;
    return { name, type, creditPeriod: str(row, cols.creditPeriod), amount: amt };
  };
  for (let i = det.headerRow + 1; i < g.raw.length; i++) {
    const row = g.raw[i] || [];
    const trow = g.text[i] || [];
    const ledgerCell = str(row, cols.ledger);
    const partyCell = str(row, cols.party);
    const ledger = ledgerCell || partyCell;
    if (!ledger || /^(grand\s+)?total$|^opening balance$|^closing balance$|^current total$/i.test(ledger)) continue;
    const bill = readBill(row);

    // amount
    let amount = 0;
    if (cols.debit !== undefined || cols.credit !== undefined) {
      const d = Math.abs(readAmount(at(row, cols.debit)).value);
      const c = Math.abs(readAmount(at(row, cols.credit)).value);
      amount = d - c;
      if (!d && !c && cols.amount !== undefined) amount = NaN; // fall through to amount column
    }
    if ((cols.debit === undefined && cols.credit === undefined) || Number.isNaN(amount)) {
      const a = readAmount(at(row, cols.amount));
      const ind = String(at(row, cols.drcr) ?? "").trim().toLowerCase();
      const ft = readAmount(at(trow, cols.amount));
      if (/^(dr|debit|d|yes)$/.test(ind)) amount = Math.abs(a.value);
      else if (/^(cr|credit|c|no)$/.test(ind)) amount = -Math.abs(a.value);
      else if (a.side || ft.side) amount = (a.side || ft.side) === "Dr" ? Math.abs(a.value) : -Math.abs(a.value);
      else amount = drNegative ? -a.value : a.value;
    }
    // Bill-wise rows (TallyDayBook.exe layout): one row per bill of a ledger line. The EXE repeated the
    // line's Dr/Cr on every bill row; this tool's own export leaves it blank after the first. Either way the
    // extra rows add a bill to the previous line and NOT its amount again.
    const prev = lines[lines.length - 1];
    if (bill && prev && prev.bills?.length && prev.ledger === ledger) {
      const dC = at(row, cols.date);
      const sameVoucher = (isBlank(dC) || toIsoDate(dC) === prev.date) && (!str(row, cols.voucherNo) || str(row, cols.voucherNo) === prev.voucherNo)
        && (!str(row, cols.voucherType) || str(row, cols.voucherType) === prev.voucherType);
      if (sameVoucher && (!amount || (det.format === "tallydaybook-exe" && r2(amount) === prev.amount))) {
        prev.bills.push(bill);
        billRowsMerged++;
        continue;
      }
    }
    if (!amount) continue;

    // fill-down of voucher header cells (detailed exports print them on the first line only)
    const dCell = at(row, cols.date);
    const date = isBlank(dCell) ? last.date : toIsoDate(dCell);
    if (!isBlank(dCell) && !date) badDates++;
    const type = str(row, cols.voucherType) || (isBlank(dCell) ? last.type : "");
    const no = str(row, cols.voucherNo) || (isBlank(dCell) ? last.no : "");
    const ref = str(row, cols.reference) || (isBlank(dCell) ? last.ref : "");
    const narr = str(row, cols.narration) || (isBlank(dCell) ? last.narr : "");
    const explicitKey = str(row, cols.voucherKey);
    let party = ledgerCell ? partyCell : partyCell; // party column as given
    if (!party && isBlank(dCell)) party = last.party;
    if (!date) continue;

    let vKey: string;
    if (explicitKey) vKey = "K" + explicitKey;
    else {
      const k = `${date}|${type}|${no}`;
      const sameHeader = k === curKey;
      const noNumber = cols.voucherNo === undefined || !no;
      if (!sameHeader || (noNumber && !isBlank(dCell) && Math.abs(running) < 0.005 && lines.length > 0 && lines[lines.length - 1].voucherId === `G${seq}`)) {
        seq++;
        running = 0;
      }
      curKey = k;
      vKey = `G${seq}`;
    }
    running += amount;

    lines.push({
      voucherId: vKey,
      date,
      voucherType: type,
      voucherNo: no,
      reference: ref,
      party,
      ledger,
      amount: r2(amount),
      narration: narr,
      partyGstin: str(row, cols.partyGstin).toUpperCase(),
      group: str(row, cols.group),
      primaryGroup: str(row, cols.primaryGroup),
      ...(cols.voucherAmount !== undefined ? { voucherAmount: Math.abs(readAmount(at(row, cols.voucherAmount)).value) } : {}),
      ...(bill ? { bills: [bill] } : {}),
    });
    last = { date, type, no, party, ref, narr, key: vKey };
  }
  if (billRowsMerged) {
    warnings.push(`${billRowsMerged} extra bill-wise row(s) were read as bills of the line above them, not as new amounts${det.format === "tallydaybook-exe" ? " (TallyDayBook.exe repeats the Dr/Cr amount on every bill row, so its own Dr/Cr totals are overstated)" : ""}.`);
  }
  if (badDates) warnings.push(`${badDates} row(s) had a date that could not be read and were skipped.`);
  if (!lines.length) throw new Error("The day book sheet was found but no lines with a ledger, date and amount could be read. Check the column mapping.");

  // narration: one voucher -> join distinct narrations of its lines
  const narrBy = new Map<string, string>();
  for (const l of lines) if (l.narration) {
    const p = narrBy.get(l.voucherId) || "";
    if (!p.includes(l.narration)) narrBy.set(l.voucherId, p ? `${p} | ${l.narration}` : l.narration);
  }
  for (const l of lines) l.narration = narrBy.get(l.voucherId) || "";

  // party for vouchers whose party column is blank on some lines
  const partyBy = new Map<string, string>();
  for (const l of lines) if (l.party && !partyBy.has(l.voucherId)) partyBy.set(l.voucherId, l.party);
  for (const l of lines) if (!l.party) l.party = partyBy.get(l.voucherId) || "";

  const unbalanced = voucherBalances(lines).filter((v) => Math.abs(v.diff) > 1).length;
  if (unbalanced) {
    warnings.push(`${unbalanced} voucher(s) where debit is not equal to credit. If most vouchers show this, the export is probably a condensed Day Book - export it with ledger details, use the Day Book Extractor format, or fetch from Tally.`);
  }

  // Day Book Extractor workbook: its Ledgers (and Groups) sheets
  let ledgers: LedgerInput[] = [];
  const groupsOut: { name: string; parent: string }[] = [];
  let company = "";
  const others = grids(wb)
    .filter((x) => x.sheet !== g.sheet)
    .sort((a, b) => Number(/^ledgers?$/i.test(b.sheet)) - Number(/^ledgers?$/i.test(a.sheet)));
  for (const o of others) {
    if (/dormant/i.test(o.sheet)) continue;
    const h = findHeader(o, TB_SYN, ["name", "closing|closingDr|closingCr"]);
    if (!h) continue;
    try { ledgers = tbFromGrid(o, h.row, h.cols, det.format === "daybook-extractor"); } catch { ledgers = []; }
    if (ledgers.length) break;
  }
  for (const o of others) {
    if (!/group/i.test(o.sheet)) continue;
    const h = findHeader(o, { name: ["name", "groupname", "group"], parent: ["parent", "under", "parentgroup"] }, ["name", "parent"]);
    if (h) {
      for (let i = h.row + 1; i < o.raw.length; i++) {
        const n = normName(o.raw[i]?.[h.cols.name]);
        if (n) groupsOut.push({ name: n, parent: normName(o.raw[i]?.[h.cols.parent]) });
      }
    }
  }
  for (const o of grids(wb)) {
    for (let i = 0; i < Math.min(o.raw.length, 12) && !company; i++) {
      const row = o.raw[i] || [];
      const j = row.findIndex((c) => /^company\s*name$/i.test(String(c ?? "").trim()));
      if (j >= 0 && row[j + 1]) company = normName(row[j + 1]);
    }
  }
  return { format: det.format, sheet: g.sheet, headers, columns: cols, lines, ledgers, groups: groupsOut, company, warnings };
}

export function voucherBalances(lines: DayBookLine[]) {
  const m = new Map<string, { voucherId: string; dr: number; cr: number; diff: number; first: DayBookLine }>();
  for (const l of lines) {
    let v = m.get(l.voucherId);
    if (!v) { v = { voucherId: l.voucherId, dr: 0, cr: 0, diff: 0, first: l }; m.set(l.voucherId, v); }
    if (l.amount > 0) v.dr += l.amount; else v.cr += -l.amount;
  }
  for (const v of m.values()) v.diff = r2(v.dr - v.cr);
  return [...m.values()];
}

// ── Trial balance / ledger masters ──────────────────────────────────────────

export interface LedgerInput {
  name: string;
  parent?: string;
  primaryGroup?: string;
  chain?: string[];
  /** Authoritative nature from the source (Busy / Zoho sections). */
  nature?: Nature;
  /** Used only when the group names cannot be classified (e.g. the VERA TB export's Category column). */
  natureFallback?: Nature;
  partyType?: PartyType;
  gstin?: string;
  pan?: string;
  gstRegistrationType?: string;
  opening?: number;
  debit?: number;
  credit?: number;
  closing?: number;
  hasBalances?: boolean;
}

const TB_SYN: Record<string, string[]> = {
  name: ["ledgername", "ledger", "name", "accountname", "account", "particulars", "accounthead", "ledgeraccount"],
  parent: ["parentgroup", "parent", "group", "under", "ledgergroup", "ledgroup"],
  primary: ["primarygroup", "primary", "maingroup", "nature", "section"],
  opening: ["openingbalance", "opening", "openingbal", "ob"],
  openingDr: ["openingdr", "openingdebit", "obdr", "openingbalancedr"],
  openingCr: ["openingcr", "openingcredit", "obcr", "openingbalancecr"],
  debit: ["debittotals", "debit", "debits", "netdebit", "transactionsdebit", "dr", "debitamount", "totaldebit"],
  credit: ["credittotals", "credit", "credits", "netcredit", "transactionscredit", "cr", "creditamount", "totalcredit"],
  closing: ["closingbalance", "closing", "closingbal", "balance", "cb"],
  closingDr: ["closingdr", "closingdebit", "cbdr", "closingbalancedr"],
  closingCr: ["closingcr", "closingcredit", "cbcr", "closingbalancecr"],
  gstin: ["gstin", "gstinuin", "partygstin", "gstno", "gstnumber", "gstregistrationnumber"],
  pan: ["pan", "panno", "incometaxnumber", "pannumber", "panit"],
  regType: ["gstregistrationtype", "registrationtype", "gstregtype"],
};

function tbFromGrid(g: Grid, headerRow: number, cols: Record<string, number>, drNegative: boolean): LedgerInput[] {
  const out: LedgerInput[] = [];
  const hasBal = ["opening", "openingDr", "openingCr", "closing", "closingDr", "closingCr", "debit", "credit"].some((k) => cols[k] !== undefined);
  const val = (i: number, k: string) => (cols[k] === undefined ? null : g.raw[i]?.[cols[k]]);
  const txt = (i: number, k: string) => (cols[k] === undefined ? null : g.text[i]?.[cols[k]]);
  const bal = (i: number, single: string, dr: string, cr: string) => {
    if (cols[dr] !== undefined || cols[cr] !== undefined) {
      return Math.abs(readAmount(val(i, dr)).value) - Math.abs(readAmount(val(i, cr)).value);
    }
    return balanceValue(val(i, single), txt(i, single), drNegative);
  };
  for (let i = headerRow + 1; i < g.raw.length; i++) {
    const name = normName(val(i, "name"));
    if (!name || /^(grand\s+)?total$/i.test(name)) continue;
    const opening = bal(i, "opening", "openingDr", "openingCr");
    const closing = bal(i, "closing", "closingDr", "closingCr");
    const debit = Math.abs(readAmount(val(i, "debit")).value);
    const credit = Math.abs(readAmount(val(i, "credit")).value);
    out.push({
      name,
      parent: normName(val(i, "parent")),
      primaryGroup: normName(val(i, "primary")),
      gstin: normName(val(i, "gstin")).toUpperCase(),
      pan: normName(val(i, "pan")).toUpperCase(),
      gstRegistrationType: normName(val(i, "regType")),
      opening: r2(opening),
      debit: r2(debit),
      credit: r2(credit),
      closing: r2(cols.closing === undefined && cols.closingDr === undefined && cols.closingCr === undefined ? opening + debit - credit : closing),
      hasBalances: hasBal,
    });
  }
  return out;
}

interface BusyRow { name: string; parents?: string[]; groupTally?: string | null; sectionType: string; opening: number; debit: number; credit: number; closing: number }
interface ZohoRow { name: string; parents?: string[]; section?: string; sectionType: string; opening: number; debit: number; credit: number; closing: number }

export type TBFormat = "auto" | "daybook-extractor" | "vera-tally" | "busy" | "zoho" | "generic";

export interface TBParse {
  format: Exclude<TBFormat, "auto">;
  ledgers: LedgerInput[];
  company: string;
  from: string;
  to: string;
  warnings: string[];
}

/**
 * Trial balance / ledger list. drNegative applies to the generic format only (plain numbers with no
 * Dr/Cr marking): true = the file writes debit balances as negative (Tally convention).
 */
export function parseTrialBalance(buffer: ArrayBuffer, format: TBFormat = "auto", drNegative = false): TBParse {
  const tryBusy = () => {
    const r = parseBusyTB(buffer);
    return {
      format: "busy" as const,
      company: r.entityName || "", from: r.from || "", to: r.to || "", warnings: r.warnings || [],
      ledgers: r.rows.map((x: BusyRow) => ({
        name: x.name, parent: x.parents?.[x.parents.length - 1] || x.groupTally || "", primaryGroup: x.parents?.[0] || "",
        chain: [...(x.parents || [])].reverse().concat(x.groupTally ? [x.groupTally] : []),
        nature: natureFromSection(x.sectionType),
        opening: r2(x.opening), debit: r2(x.debit), credit: r2(x.credit), closing: r2(x.closing), hasBalances: true,
      })),
    };
  };
  const tryZoho = () => {
    const r = parseZohoTB(buffer);
    return {
      format: "zoho" as const,
      company: r.entityName || "", from: r.from || "", to: r.to || "", warnings: r.warnings || [],
      ledgers: r.rows.map((x: ZohoRow) => ({
        name: x.name, parent: x.parents?.[x.parents.length - 1] || x.section || "", primaryGroup: x.section || "",
        chain: [...(x.parents || [])].reverse().concat([x.section || ""]).filter(Boolean),
        nature: natureFromSection(x.sectionType),
        opening: r2(x.opening), debit: r2(x.debit), credit: r2(x.credit), closing: r2(x.closing), hasBalances: true,
      })),
    };
  };
  const tryGeneric = (fmt: "generic" | "daybook-extractor") => {
    const wb = readWorkbook(buffer);
    for (const g of grids(wb)) {
      const h = findHeader(g, TB_SYN, ["name", "closing|closingDr|closingCr|debit|gstin|pan"]);
      if (!h) continue;
      const hdr = (g.raw[h.row] || []).map((c) => String(c ?? ""));
      const isDbe = fmt === "daybook-extractor" || /^ledgers?$/i.test(g.sheet) && hdr.some((c) => /^primary group$/i.test(c.trim()));
      if (fmt === "daybook-extractor" && !/^ledgers?$/i.test(g.sheet) && wb.SheetNames.some((s) => /^ledgers?$/i.test(s))) continue;
      const ledgers = tbFromGrid(g, h.row, h.cols, isDbe ? true : drNegative);
      if (ledgers.length) return { format: isDbe ? ("daybook-extractor" as const) : ("generic" as const), ledgers, company: "", from: "", to: "", warnings: [] as string[] };
    }
    throw new Error("No trial balance / ledger table found. Expected a header row with a Ledger/Account name and balance columns.");
  };

  // VERA Tools > Tally Tools > "Get Trial Balance from Tally" > Export to Excel:
  // sheet "Trial Balance" (Account Head, Opening Balance, Total Debit, Total Credit, Closing Balance - Tally signs,
  // debit negative) + sheet "Hierarchy" (Account Head, Parent 1..4, Category).
  const tryVeraTally = () => {
    const wb = readWorkbook(buffer);
    const tbSheet = grids(wb).find((g) => (g.raw[0] || []).map(normHeader).includes("accounthead") && (g.raw[0] || []).map(normHeader).includes("totaldebit"));
    if (!tbSheet) throw new Error("Not a VERA Tally TB export.");
    const h = findHeader(tbSheet, TB_SYN, ["name", "closing"])!;
    const ledgers = tbFromGrid(tbSheet, h.row, h.cols, true);
    const hier = grids(wb).find((g) => /hierarchy/i.test(g.sheet));
    if (hier) {
      const hdr = (hier.raw[0] || []).map(normHeader);
      const iName = hdr.indexOf("accounthead"), iP1 = hdr.indexOf("parent1"), iCat = hdr.indexOf("category");
      const by = new Map<string, { parent: string; cat: string }>();
      for (const r of hier.raw.slice(1)) by.set(keyName(r?.[iName]), { parent: normName(r?.[iP1]).replace(/^[^\p{L}\p{N}]+/u, ""), cat: normName(r?.[iCat]) });
      for (const l of ledgers) {
        const m = by.get(keyName(l.name));
        if (!m) continue;
        if (m.parent && !/^primary$/i.test(m.parent)) l.parent = m.parent;
        const n = natureFromSection(m.cat);
        if (n !== "Unknown") l.natureFallback = n;
      }
    }
    const warnings = ["This trial balance export carries only each ledger's immediate group. Where that group is a user-created one, Asset / Liability / Income / Expense is taken from its Category column, which can be wrong for some P&L ledgers. For exact groups use Tally (live) or a Day Book Extractor file."];
    return { format: "vera-tally" as const, ledgers, company: "", from: "", to: "", warnings };
  };

  if (format === "vera-tally") return tryVeraTally();
  if (format === "busy") return tryBusy();
  if (format === "zoho") return tryZoho();
  if (format === "generic" || format === "daybook-extractor") return tryGeneric(format);
  // auto: the specific parsers throw on anything that is not their format
  const wb = readWorkbook(buffer);
  if (wb.SheetNames.some((s) => /^ledgers?$/i.test(s))) { try { return tryGeneric("daybook-extractor"); } catch { /* next */ } }
  try { return tryVeraTally(); } catch { /* next */ }
  try { return tryZoho(); } catch { /* next */ }
  try { return tryBusy(); } catch { /* next */ }
  return tryGeneric("generic");
}

function natureFromSection(t: string): Nature {
  if (/asset/i.test(t)) return "Asset";
  if (/liabil|equit/i.test(t)) return "Liability";
  if (/income/i.test(t)) return "Income";
  if (/expense/i.test(t)) return "Expense";
  return "Unknown";
}

// ── Dataset assembly ────────────────────────────────────────────────────────

export interface BuildInput {
  company?: string;
  from?: string;
  to?: string;
  ledgers?: LedgerInput[];
  masters?: LedgerInput[];
  groups?: { name: string; parent: string }[];
  lines?: DayBookLine[];
  sources?: string[];
  warnings?: string[];
  taxFields?: { gstin: boolean; pan: boolean };
}

export function buildDataset(inp: BuildInput): Dataset {
  const warnings = [...(inp.warnings || [])];
  const lines = inp.lines || [];
  const map = new Map<string, LedgerInput>();
  for (const l of inp.ledgers || []) {
    const k = keyName(l.name);
    if (!k) continue;
    const prev = map.get(k);
    if (prev && prev.hasBalances) {
      prev.opening = (prev.opening || 0) + (l.opening || 0);
      prev.debit = (prev.debit || 0) + (l.debit || 0);
      prev.credit = (prev.credit || 0) + (l.credit || 0);
      prev.closing = (prev.closing || 0) + (l.closing || 0);
    } else map.set(k, { ...l });
  }
  for (const m of inp.masters || []) {
    const k = keyName(m.name);
    if (!k) continue;
    const t = map.get(k);
    if (!t) { map.set(k, { ...m, hasBalances: !!m.hasBalances }); continue; }
    t.parent = t.parent || m.parent;
    t.primaryGroup = t.primaryGroup || m.primaryGroup;
    t.gstin = m.gstin || t.gstin;
    t.pan = m.pan || t.pan;
    t.gstRegistrationType = m.gstRegistrationType || t.gstRegistrationType;
    if (!t.chain?.length && m.chain?.length) t.chain = m.chain;
  }
  // ledgers that appear only in the day book
  let onlyInDayBook = 0;
  for (const l of lines) {
    const k = keyName(l.ledger);
    if (!map.has(k)) {
      map.set(k, { name: l.ledger, parent: l.group, primaryGroup: l.primaryGroup, hasBalances: false });
      onlyInDayBook++;
    } else {
      const t = map.get(k)!;
      if (!t.parent && l.group) t.parent = l.group;
      if (!t.primaryGroup && l.primaryGroup) t.primaryGroup = l.primaryGroup;
    }
  }
  if (onlyInDayBook && (inp.ledgers?.length || 0) > 0) {
    warnings.push(`${onlyInDayBook} ledger(s) used in the day book are not in the trial balance / ledger list.`);
  }

  const groupParent = new Map<string, string>();
  for (const g of inp.groups || []) groupParent.set(keyName(g.name), g.parent);

  // movements from the day book (used when there is no TB, and for reconciliation)
  const mv = new Map<string, { dr: number; cr: number }>();
  for (const l of lines) {
    const k = keyName(l.ledger);
    const m = mv.get(k) || { dr: 0, cr: 0 };
    if (l.amount > 0) m.dr += l.amount; else m.cr += -l.amount;
    mv.set(k, m);
  }

  // GSTIN printed on the day book lines fills a party ledger whose master has none
  const lineGstin = new Map<string, string>();
  for (const l of lines) if (l.partyGstin && l.party && !lineGstin.has(keyName(l.party))) lineGstin.set(keyName(l.party), l.partyGstin);

  const ledgers: LedgerRow[] = [];
  let unknown = 0;
  for (const [k, l] of map) {
    let chain = l.chain?.length ? l.chain : [];
    if (!chain.length) {
      chain = groupParent.size ? chainFromGroups(l.parent || "", groupParent) : [];
      if (!chain.length) chain = [l.parent || "", l.primaryGroup || ""].filter(Boolean);
      if (l.primaryGroup && !chain.some((c) => keyName(c) === keyName(l.primaryGroup))) chain.push(l.primaryGroup);
    }
    const cls = classifyChain(chain, l.name);
    const isPL = /^profit\s*(and|&)?\s*loss\s*a\/?c(count)?$/i.test(l.name.trim());
    const nature: Nature = isPL ? "Liability"
      : l.nature && l.nature !== "Unknown" ? l.nature
      : cls.nature !== "Unknown" ? cls.nature
      : l.natureFallback || "Unknown";
    if (nature === "Unknown") unknown++;
    const m = mv.get(k) || { dr: 0, cr: 0 };
    const hasBalances = !!l.hasBalances;
    const opening = hasBalances ? l.opening || 0 : 0;
    const debit = hasBalances && (l.debit || l.credit) ? l.debit || 0 : m.dr;
    const credit = hasBalances && (l.debit || l.credit) ? l.credit || 0 : m.cr;
    ledgers.push({
      name: l.name,
      parent: l.parent || chain[0] || "",
      primaryGroup: chain[chain.length - 1] || l.primaryGroup || "",
      chain,
      nature,
      partyType: l.partyType ?? cls.partyType,
      reservedGroup: cls.reservedGroup,
      gstin: (l.gstin || lineGstin.get(k) || "").toUpperCase(),
      pan: (l.pan || "").toUpperCase(),
      gstRegistrationType: l.gstRegistrationType || "",
      opening: r2(opening),
      debit: r2(debit),
      credit: r2(credit),
      closing: r2(hasBalances ? l.closing ?? opening + debit - credit : opening + debit - credit),
      hasBalances,
    });
  }
  if (unknown) warnings.push(`${unknown} ledger(s) could not be classified as Asset / Liability / Income / Expense (no recognisable group). Load a trial balance or ledger masters with groups for full results.`);
  if (!ledgers.some((l) => l.hasBalances) && lines.length) {
    warnings.push("No trial balance was loaded: opening balances are taken as nil and balances are built from the day book only.");
  }

  const dates = lines.map((l) => l.date).filter(Boolean).sort();
  return {
    company: inp.company || "",
    from: inp.from || dates[0] || "",
    to: inp.to || dates[dates.length - 1] || "",
    ledgers: ledgers.sort((a, b) => a.name.localeCompare(b.name)),
    lines,
    sources: inp.sources || [],
    warnings,
    taxFields: inp.taxFields || {
      gstin: ledgers.some((l) => l.gstin) || lines.some((l) => l.partyGstin),
      pan: ledgers.some((l) => l.pan),
    },
  };
}
