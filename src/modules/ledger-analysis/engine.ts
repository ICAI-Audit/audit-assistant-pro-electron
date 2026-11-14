// Ledger Analysis - the checks. Pure functions: Dataset in, result tables out.
// Signs: Dr positive / Cr negative (types.ts). Amount columns in result rows are plain
// rupee numbers; a separate "Dr/Cr" text column says which side.

import { isValidGstin, normalizeGstin } from "@/lib/gstinValidation";
import { calculateSimilarity } from "@/utils/fuzzyMatch";
import { normalSide } from "./classify";
import { keyName, voucherBalances } from "./importers";
import type { AnalysisSettings, ColumnDef, Dataset, DayBookLine, LedgerRow, ResultTableData } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const drcr = (n: number) => (n > 0.004 ? "Dr" : n < -0.004 ? "Cr" : "");
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const dmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso);

const C = {
  ledger: { key: "ledger", label: "Ledger" } as ColumnDef,
  parent: { key: "parent", label: "Under (group)" } as ColumnDef,
  primary: { key: "primary", label: "Primary group" } as ColumnDef,
  nature: { key: "nature", label: "Nature" } as ColumnDef,
  amt: (key: string, label: string): ColumnDef => ({ key, label, type: "amount" }),
  num: (key: string, label: string): ColumnDef => ({ key, label, type: "number" }),
  txt: (key: string, label: string): ColumnDef => ({ key, label }),
  date: (key: string, label: string): ColumnDef => ({ key, label, type: "date" }),
};

const NEED_DAYBOOK = "This check needs day book (voucher) data. Load a day book file or fetch the day book from Tally.";

// ── period helpers ──────────────────────────────────────────────────────────

export function monthsBetween(from: string, to: string): string[] {
  if (!from || !to) return [];
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while ((y < ey || (y === ey && m <= em)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym: string) => `${MONTH_LABEL[+ym.slice(5, 7) - 1]}-${ym.slice(2, 4)}`;

function lineIndex(ds: Dataset) {
  const byLedger = new Map<string, DayBookLine[]>();
  for (const l of ds.lines) {
    const k = keyName(l.ledger);
    const a = byLedger.get(k);
    if (a) a.push(l); else byLedger.set(k, [l]);
  }
  return byLedger;
}

const ledgerMap = (ds: Dataset) => new Map(ds.ledgers.map((l) => [keyName(l.name), l]));
const isStock = (l: LedgerRow) => /stock in hand/i.test(l.reservedGroup.replace(/-/g, " ")) || /^stock-?in-?hand$/i.test(l.primaryGroup);
const base = (l: LedgerRow) => ({ ledger: l.name, parent: l.parent, primary: l.primaryGroup, nature: l.nature });

// ── 1. Trial balance ─────────────────────────────────────────────────────────

export function trialBalanceAsOn(ds: Dataset, asOn: string): ResultTableData {
  const columns = [C.ledger, C.parent, C.primary, C.nature, C.amt("openDr", "Opening Dr"), C.amt("openCr", "Opening Cr"),
    C.amt("debit", "Debit"), C.amt("credit", "Credit"), C.amt("closeDr", "Closing Dr"), C.amt("closeCr", "Closing Cr")];
  const res: ResultTableData = {
    id: "tb_as_on", title: `Trial Balance as on ${dmy(asOn || ds.to)}`, columns, rows: [],
    description: "Opening balance + every day book entry up to the selected date. Without a day book only the period-end trial balance can be shown.",
  };
  const date = asOn || ds.to;
  const useLines = ds.lines.length > 0;
  if (!useLines && date !== ds.to) { res.cannotRun = NEED_DAYBOOK + " (A trial balance file only gives the period-end figures.)"; return res; }
  const idx = useLines ? lineIndex(ds) : null;
  let tDr = 0, tCr = 0, oDr = 0, oCr = 0;
  for (const l of ds.ledgers) {
    let debit = l.debit, credit = l.credit, closing = l.closing;
    if (idx) {
      debit = 0; credit = 0;
      for (const x of idx.get(keyName(l.name)) || []) {
        if (x.date > date) continue;
        if (x.amount > 0) debit += x.amount; else credit -= x.amount;
      }
      closing = l.opening + debit - credit;
    }
    if (Math.abs(l.opening) < 0.005 && Math.abs(debit) < 0.005 && Math.abs(credit) < 0.005 && Math.abs(closing) < 0.005) continue;
    res.rows.push({
      ...base(l),
      openDr: l.opening > 0 ? r2(l.opening) : 0, openCr: l.opening < 0 ? r2(-l.opening) : 0,
      debit: r2(debit), credit: r2(credit),
      closeDr: closing > 0 ? r2(closing) : 0, closeCr: closing < 0 ? r2(-closing) : 0,
    });
    if (closing > 0) tDr += closing; else tCr -= closing;
    if (l.opening > 0) oDr += l.opening; else oCr -= l.opening;
  }
  res.rows.push({ ledger: "TOTAL", parent: "", primary: "", nature: "", openDr: r2(oDr), openCr: r2(oCr), debit: null, credit: null, closeDr: r2(tDr), closeCr: r2(tCr) });
  if (Math.abs(tDr - tCr) > 1) {
    res.description += ` Closing Dr and Cr differ by ${r2(tDr - tCr).toLocaleString("en-IN")} - usually opening stock / closing stock or a ledger missing from the masters.`;
  }
  return res;
}

export function trialBalanceMonthly(ds: Dataset, mode: "closing" | "movement"): ResultTableData {
  const months = monthsBetween(ds.from, ds.to);
  const columns: ColumnDef[] = [C.ledger, C.primary, C.nature, C.amt("opening", "Opening (Dr+ / Cr-)"),
    ...months.map((m) => C.amt(m, monthLabel(m))), C.amt("closing", "Closing (Dr+ / Cr-)")];
  const res: ResultTableData = {
    id: mode === "closing" ? "tb_monthly_closing" : "tb_monthly_movement",
    title: mode === "closing" ? "Trial Balance month over month - month-end balances" : "Trial Balance month over month - net movement each month",
    description: "Debit shown as +, credit as -. " + (mode === "closing" ? "Each column is the ledger balance at the end of that month." : "Each column is debits minus credits posted in that month."),
    columns, rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const idx = lineIndex(ds);
  for (const l of ds.ledgers) {
    const mv: Record<string, number> = {};
    for (const x of idx.get(keyName(l.name)) || []) mv[x.date.slice(0, 7)] = (mv[x.date.slice(0, 7)] || 0) + x.amount;
    if (!Object.keys(mv).length && Math.abs(l.opening) < 0.005) continue;
    const row: Record<string, string | number | null> = { ledger: l.name, primary: l.primaryGroup, nature: l.nature, opening: r2(l.opening) };
    let run = l.opening;
    for (const m of months) {
      run += mv[m] || 0;
      row[m] = r2(mode === "closing" ? run : mv[m] || 0);
    }
    row.closing = r2(run);
    res.rows.push(row);
  }
  return res;
}

/** Tally's "Profit & Loss A/c": its master closing includes the current year's profit, which no voucher posts. */
const isPLAccount = (l: LedgerRow) => /^profit\s*(and|&)\s*loss(\s*a\/?c|\s*account)?$/i.test(l.name.trim());
const fmtIN = (n: number) => Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Day book vs trial balance: for every ledger, opening balance + debits - credits in the loaded day book
 * should give the closing balance Tally (or the TB file) reports. A ledger that does not agree means the
 * loaded day book is missing vouchers for it, or holds vouchers that do not post in the books.
 */
export function dayBookReconciliation(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "recon", title: "Day book vs trial balance - ledgers that do not agree",
    description: "Completeness check of the loaded day book. For each ledger: opening balance (from the ledger master / TB) + debits - credits in the day book = closing balance as per the day book. " +
      "That is compared with the closing balance Tally / the TB reports. Only ledgers that do NOT agree are listed; the 'What it means' column says which side is short. " +
      "Stock-in-hand (valued from inventory) and Profit & Loss A/c (its closing includes the current year's profit) are left out.",
    columns: [C.ledger, C.primary, C.amt("opening", "Opening"), C.txt("openSide", "Dr/Cr"),
      C.amt("dayDr", "Debits in day book"), C.amt("dayCr", "Credits in day book"),
      C.amt("computed", "Closing as per day book"), C.txt("computedSide", "Dr/Cr"),
      C.amt("tb", "Closing as per Tally / TB"), C.txt("tbSide", "Dr/Cr"),
      C.amt("diff", "Difference"), C.txt("meaning", "What it means")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  if (!ds.ledgers.some((l) => l.hasBalances)) { res.cannotRun = "Load a trial balance (or ledger masters with balances) to reconcile against."; return res; }
  const idx = lineIndex(ds);
  let checked = 0;
  for (const l of ds.ledgers) {
    if (!l.hasBalances || isStock(l) || isPLAccount(l)) continue;
    checked++;
    const ls = idx.get(keyName(l.name)) || [];
    let dr = 0, cr = 0;
    for (const x of ls) { if (x.amount > 0) dr += x.amount; else cr -= x.amount; }
    const computed = l.opening + dr - cr;
    const diff = computed - l.closing;
    if (Math.abs(diff) <= s.tolerance) continue;
    const amt = fmtIN(diff);
    const meaning = !ls.length
      ? `No vouchers for this ledger in the loaded day book, yet its balance moved by ${amt} - its vouchers are missing (or the TB is for another date).`
      : diff > 0
        ? `Day book gives ${amt} more debit than Tally: a credit entry is missing from the day book, or it holds a debit that does not post in the books.`
        : `Day book gives ${amt} more credit than Tally: a debit entry is missing from the day book, or it holds a credit that does not post in the books.`;
    res.rows.push({
      ledger: l.name, primary: l.primaryGroup,
      opening: r2(Math.abs(l.opening)), openSide: drcr(l.opening),
      dayDr: r2(dr), dayCr: r2(cr),
      computed: r2(Math.abs(computed)), computedSide: drcr(computed),
      tb: r2(Math.abs(l.closing)), tbSide: drcr(l.closing),
      diff: r2(Math.abs(diff)), meaning,
    });
  }
  res.rows.sort((a, b) => (b.diff as number) - (a.diff as number));
  res.description = `${checked - res.rows.length} of ${checked} ledgers agree. ` + res.description;
  return res;
}

// ── 1b. Dormant ledgers ─────────────────────────────────────────────────────

const NO_TXN_NOTE = "Stock-in-hand and Profit & Loss A/c are left out. Optional, cancelled, post-dated and non-accounting vouchers (orders, delivery / receipt notes, memorandum) do not count as transactions.";

/**
 * Ledgers with no debit and no credit in the period: from the day book when one is loaded, else from the
 * TB's debit / credit totals. null when neither is available.
 */
function ledgersWithoutTransactions(ds: Dataset, s: AnalysisSettings): LedgerRow[] | null {
  if (!ds.lines.length && !ds.ledgers.some((l) => l.hasBalances)) return null;
  const used = ds.lines.length ? new Set(ds.lines.map((x) => keyName(x.ledger))) : null;
  return ds.ledgers.filter((l) => {
    if (isStock(l) || isPLAccount(l)) return false;
    return used ? !used.has(keyName(l.name)) : l.debit + l.credit <= s.tolerance;
  });
}

/** Dormant = nothing at all in the period: no opening balance, no debit, no credit, no closing balance. */
export function dormantLedgers(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "dormant", title: "Dormant ledgers - no opening, no transactions, no closing",
    description: "Ledgers with nil opening balance, no debit or credit in the period and nil closing balance - unused masters, candidates to delete or disable. " +
      "Ledgers that carry a balance without any transaction are a separate check: 'Same opening and closing, no transactions'. " + NO_TXN_NOTE,
    columns: [C.ledger, C.parent, C.primary, C.nature, C.txt("partyType", "Party type"), C.txt("gstin", "GSTIN")],
    rows: [],
  };
  const quiet = ledgersWithoutTransactions(ds, s);
  if (!quiet) { res.cannotRun = NEED_DAYBOOK; return res; }
  for (const l of quiet) {
    if (Math.abs(l.opening) > s.tolerance || Math.abs(l.closing) > s.tolerance) continue;
    res.rows.push({ ...base(l), partyType: l.partyType || "", gstin: l.gstin });
  }
  res.rows.sort((a, b) => String(a.primary).localeCompare(String(b.primary)) || String(a.ledger).localeCompare(String(b.ledger)));
  return res;
}

/**
 * Same opening and closing balance with no transaction in the period (all ledgers, not only parties).
 * A ledger with no transaction whose closing differs from its opening is listed too, flagged: that points to
 * an incomplete day book (or a TB for another date), not to a static balance.
 */
export function unchangedBalances(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "unchanged", title: "Same opening and closing balance, no transactions",
    description: "Ledgers that carry a balance but had no debit or credit in the period - balances to confirm or explain (balance confirmation, write-off / write-back, s.41(1), provision, MSME, old advances, capital WIP not capitalised). " + NO_TXN_NOTE,
    columns: [C.ledger, C.parent, C.primary, C.nature, C.txt("partyType", "Party type"),
      C.amt("opening", "Opening"), C.txt("openSide", "Dr/Cr"), C.amt("closing", "Closing"), C.txt("side", "Dr/Cr"), C.txt("note", "Note")],
    rows: [],
  };
  const quiet = ledgersWithoutTransactions(ds, s);
  if (!quiet) { res.cannotRun = NEED_DAYBOOK; return res; }
  for (const l of quiet) {
    if (Math.abs(l.opening) <= s.tolerance && Math.abs(l.closing) <= s.tolerance) continue;
    const changed = Math.abs(l.closing - l.opening) > s.tolerance;
    res.rows.push({
      ...base(l), partyType: l.partyType || "",
      opening: r2(Math.abs(l.opening)), openSide: drcr(l.opening), closing: r2(Math.abs(l.closing)), side: drcr(l.closing),
      note: changed ? "Closing differs from opening although no transaction was loaded - check the day book / TB date" : "",
    });
  }
  res.rows.sort((a, b) => (a.note ? 0 : 1) - (b.note ? 0 : 1) || (b.closing as number) - (a.closing as number));
  return res;
}

// ── 2. Negative (abnormal-side) ledgers ─────────────────────────────────────

export type NegativeKind = "assets_cr" | "income_dr" | "expense_cr" | "liabilities_dr";
const NEG_META: Record<NegativeKind, { nature: LedgerRow["nature"]; title: string; expected: "Dr" | "Cr" }> = {
  assets_cr: { nature: "Asset", title: "Assets with credit balance", expected: "Dr" },
  income_dr: { nature: "Income", title: "Income with debit balance", expected: "Cr" },
  expense_cr: { nature: "Expense", title: "Expenses with credit balance", expected: "Dr" },
  liabilities_dr: { nature: "Liability", title: "Liabilities with debit balance", expected: "Cr" },
};

export function negativeLedgers(ds: Dataset, kind: NegativeKind, s: AnalysisSettings): ResultTableData {
  const meta = NEG_META[kind];
  const months = ds.lines.length ? monthsBetween(ds.from, ds.to) : [];
  const idx = ds.lines.length ? lineIndex(ds) : null;
  const res: ResultTableData = {
    id: `neg_${kind}`, title: meta.title,
    description: `${meta.nature} ledgers whose closing balance is on the ${meta.expected === "Dr" ? "credit" : "debit"} side. ` +
      (idx ? "'Month-ends abnormal' counts how many month-ends the balance was on the wrong side (needs the day book)." : ""),
    columns: [C.ledger, C.parent, C.primary, C.txt("reserved", "Reserved group"), C.txt("expected", "Expected"),
      C.amt("amount", "Closing balance"), C.txt("side", "Dr/Cr"), ...(idx ? [C.num("abnMonths", "Month-ends abnormal")] : []), C.txt("note", "Note")],
    rows: [],
  };
  const side = normalSide(meta.nature);
  for (const l of ds.ledgers) {
    if (l.nature !== meta.nature) continue;
    if (l.closing * side >= -s.tolerance) continue;
    let abn: number | null = null;
    if (idx) {
      const mv: Record<string, number> = {};
      for (const x of idx.get(keyName(l.name)) || []) mv[x.date.slice(0, 7)] = (mv[x.date.slice(0, 7)] || 0) + x.amount;
      let run = l.opening; abn = 0;
      for (const m of months) { run += mv[m] || 0; if (run * side < -s.tolerance) abn++; }
    }
    let note = "";
    if (/^profit (and|&) loss/i.test(l.name)) note = "P&L account - a debit balance is an accumulated loss";
    else if (l.reservedGroup === "Sundry Debtors") note = "Advance from customer / excess receipt?";
    else if (l.reservedGroup === "Sundry Creditors") note = "Advance to supplier / excess payment?";
    else if (l.reservedGroup === "Cash-in-Hand") note = "Negative cash - not possible";
    else if (l.reservedGroup === "Bank Accounts") note = "Bank overdrawn - check if it is an OD/CC account";
    else if (l.reservedGroup === "Duties & Taxes") note = "Tax receivable / ITC balance?";
    res.rows.push({ ...base(l), reserved: l.reservedGroup, expected: meta.expected, amount: r2(Math.abs(l.closing)), side: drcr(l.closing), ...(idx ? { abnMonths: abn } : {}), note });
  }
  res.rows.sort((a, b) => (b.amount as number) - (a.amount as number));
  return res;
}

// ── 3. Incomplete masters ───────────────────────────────────────────────────

export type MasterKind = "customers_no_gstin" | "customers_no_pan" | "suppliers_no_gstin" | "suppliers_no_pan";

export function incompleteMasters(ds: Dataset, kind: MasterKind): ResultTableData {
  const party = kind.startsWith("customers") ? "Debtor" : "Creditor";
  const field = kind.endsWith("gstin") ? "gstin" : "pan";
  const who = party === "Debtor" ? "Customers" : "Suppliers";
  const res: ResultTableData = {
    id: `mst_${kind}`, title: `${who} without ${field === "gstin" ? "GST number" : "PAN"}`,
    description: field === "gstin"
      ? `${who} (ledgers under Sundry ${party === "Debtor" ? "Debtors" : "Creditors"}) whose GSTIN is blank or not a valid GSTIN (format and check digit). Ledgers marked Unregistered / Consumer in the master are shown with that status - review them separately.`
      : `${who} whose PAN is blank or not in the AAAAA9999A format. Where a valid GSTIN exists, the PAN inside it (characters 3-12) is shown so the master can be completed.`,
    columns: [C.ledger, C.parent, C.txt("gstin", "GSTIN"), C.txt("pan", "PAN"), C.txt("regType", "GST registration type"),
      C.txt("issue", "Issue"), ...(field === "pan" ? [C.txt("panFromGstin", "PAN from GSTIN")] : []),
      C.amt("turnover", "Debit + Credit in period"), C.amt("closing", "Closing balance"), C.txt("side", "Dr/Cr")],
    rows: [],
  };
  if (!ds.taxFields[field]) {
    res.cannotRun = `The loaded data has no ${field === "gstin" ? "GSTIN" : "PAN"} field. Fetch from Tally (ledger masters) or load a ledger master file with a ${field === "gstin" ? "GSTIN" : "PAN"} column.`;
    return res;
  }
  for (const l of ds.ledgers) {
    if (l.partyType !== party) continue;
    const gstin = normalizeGstin(l.gstin);
    let issue = "";
    if (field === "gstin") {
      if (!gstin) issue = /unregistered|consumer|unknown/i.test(l.gstRegistrationType) ? `Blank - marked ${l.gstRegistrationType}` : "GSTIN blank";
      else if (!isValidGstin(gstin)) issue = "GSTIN invalid (format / check digit)";
    } else {
      if (!l.pan) issue = "PAN blank";
      else if (!PAN_RX.test(l.pan)) issue = "PAN invalid format";
      else if (gstin && isValidGstin(gstin) && gstin.slice(2, 12) !== l.pan) issue = "PAN does not match the PAN inside the GSTIN";
    }
    if (!issue) continue;
    res.rows.push({
      ledger: l.name, parent: l.parent, gstin: l.gstin, pan: l.pan, regType: l.gstRegistrationType, issue,
      ...(field === "pan" ? { panFromGstin: gstin && isValidGstin(gstin) ? gstin.slice(2, 12) : "" } : {}),
      turnover: r2(l.debit + l.credit), closing: r2(Math.abs(l.closing)), side: drcr(l.closing),
    });
  }
  res.rows.sort((a, b) => (b.turnover as number) - (a.turnover as number));
  return res;
}

// ── 4. Unusual ledger balances ──────────────────────────────────────────────

export function partiesWithoutMovement(ds: Dataset, party: "Debtor" | "Creditor", s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: party === "Debtor" ? "unu_debtors_static" : "unu_creditors_static",
    title: `${party === "Debtor" ? "Debtors" : "Creditors"} - opening and closing balance same, no transactions`,
    description: `Party ledgers with an opening balance and no debit or credit during the period - dormant balances to confirm (balance confirmation, write-off / write-back, ${party === "Debtor" ? "provision for doubtful debts" : "MSME and s.41(1) review"}).`,
    columns: [C.ledger, C.parent, C.amt("opening", "Opening"), C.amt("closing", "Closing"), C.txt("side", "Dr/Cr"), C.txt("gstin", "GSTIN")],
    rows: [],
  };
  const idx = ds.lines.length ? lineIndex(ds) : null;
  for (const l of ds.ledgers) {
    if (l.partyType !== party || Math.abs(l.opening) <= s.tolerance) continue;
    const moved = idx ? (idx.get(keyName(l.name)) || []).length > 0 : l.debit + l.credit > s.tolerance;
    if (moved || Math.abs(l.closing - l.opening) > s.tolerance) continue;
    res.rows.push({ ledger: l.name, parent: l.parent, opening: r2(Math.abs(l.opening)), closing: r2(Math.abs(l.closing)), side: drcr(l.closing), gstin: l.gstin });
  }
  res.rows.sort((a, b) => (b.closing as number) - (a.closing as number));
  return res;
}

export function smallBalances(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "unu_small", title: `Ledgers with small balances (below ₹${s.smallBalanceLimit.toLocaleString("en-IN")})`,
    description: "Balance-sheet ledgers with a non-nil closing balance below the limit (change it in Settings) - candidates for write-off / write-back or clean-up of the masters.",
    columns: [C.ledger, C.parent, C.primary, C.txt("partyType", "Party type"), C.amt("closing", "Closing balance"), C.txt("side", "Dr/Cr"), C.amt("turnover", "Debit + Credit in period")],
    rows: [],
  };
  for (const l of ds.ledgers) {
    if (l.nature !== "Asset" && l.nature !== "Liability") continue;
    const a = Math.abs(l.closing);
    if (a < 0.01 || a >= s.smallBalanceLimit) continue;
    res.rows.push({ ledger: l.name, parent: l.parent, primary: l.primaryGroup, partyType: l.partyType || "", closing: r2(a), side: drcr(l.closing), turnover: r2(l.debit + l.credit) });
  }
  res.rows.sort((a, b) => (a.closing as number) - (b.closing as number));
  return res;
}

/** Round-off / rounding ledgers ("ROUND OFF", "Rounded Off", "Rounding Diff."). */
export const isRoundOffLedger = (name: string) => /round(ed|ing)?[\s._-]*off|rounding/i.test(name || "");

/** One expense line booked against a supplier: the expense amount is shared equally when a voucher credits several suppliers. */
interface CreditorExpenseLine { vid: string; creditor: string; head: string; amount: number; line: DayBookLine }

/** Every expense ledger debited in a voucher that credits a supplier (Sundry Creditors). */
function creditorExpenseLines(ds: Dataset): CreditorExpenseLine[] {
  const L = ledgerMap(ds);
  const out: CreditorExpenseLine[] = [];
  for (const [vid, ls] of vouchersById(ds)) {
    const creditors = [...new Set(ls.filter((x) => x.amount < 0 && L.get(keyName(x.ledger))?.partyType === "Creditor").map((x) => x.ledger))];
    if (!creditors.length) continue;
    for (const e of ls) {
      if (e.amount <= 0 || L.get(keyName(e.ledger))?.nature !== "Expense") continue;
      for (const c of creditors) out.push({ vid, creditor: c, head: e.ledger, amount: e.amount / creditors.length, line: e });
    }
  }
  return out;
}

/**
 * Creditors whose bills are booked to several expense heads. `ignore` = expense ledger keys (keyName) left out
 * of the count - e.g. the round-off ledger once the user has checked it is only paise.
 */
export function creditorsMultipleExpenses(ds: Dataset, s: AnalysisSettings, ignore: Set<string> = new Set()): ResultTableData {
  const ignoredNames = ds.ledgers.filter((l) => ignore.has(keyName(l.name))).map((l) => l.name);
  const res: ResultTableData = {
    id: "unu_creditor_expenses", title: `Creditors whose bills are booked to ${s.minExpenseHeads} or more expense heads`,
    description: "For every voucher that credits a supplier, the expense ledgers debited in the same voucher are collected. One supplier spread over many expense heads may mean wrong classification, a TDS section mismatch (e.g. 194C vs 194J) or expenses parked under a convenient party. " +
      "Use Details to see each head and its vouchers." + (ignoredNames.length ? ` Left out of the count: ${ignoredNames.join(", ")}.` : ""),
    columns: [C.txt("creditor", "Creditor"), C.num("heads", "Expense heads"), C.num("vouchers", "Vouchers"), C.amt("total", "Total expense booked"),
      C.txt("mainHead", "Main head"), C.num("mainPct", "Main head %"), C.txt("others", "Other heads"),
      { key: "breakup", label: "Expense heads (amount)", exportOnly: true }],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const agg = new Map<string, { creditor: string; vouchers: Set<string>; heads: Map<string, number> }>();
  for (const x of creditorExpenseLines(ds)) {
    if (ignore.has(keyName(x.head))) continue;
    const k = keyName(x.creditor);
    const a = agg.get(k) || { creditor: x.creditor, vouchers: new Set<string>(), heads: new Map<string, number>() };
    a.vouchers.add(x.vid);
    a.heads.set(x.head, (a.heads.get(x.head) || 0) + x.amount);
    agg.set(k, a);
  }
  for (const a of agg.values()) {
    if (a.heads.size < s.minExpenseHeads) continue;
    const list = [...a.heads.entries()].sort((x, y) => y[1] - x[1]);
    const total = list.reduce((t, x) => t + x[1], 0);
    res.rows.push({
      creditor: a.creditor, heads: a.heads.size, vouchers: a.vouchers.size, total: r2(total),
      mainHead: list[0][0], mainPct: total ? Math.round((list[0][1] / total) * 1000) / 10 : null,
      others: list.slice(1).map(([n, v]) => `${n} (${inr(v)})`).join("; "),
      breakup: list.map(([n, v]) => `${n} (${inr(v)})`).join("; "),
      _heads: list.map(([n]) => keyName(n)).join("|"),
    });
  }
  res.rows.sort((a, b) => (b.heads as number) - (a.heads as number) || (b.total as number) - (a.total as number));
  return res;
}

/** Expense heads booked against suppliers, most widely used first - for the "creditors using this head" filter. */
export function creditorHeadUsage(ds: Dataset): { head: string; key: string; creditors: number; amount: number; roundOff: boolean }[] {
  const m = new Map<string, { head: string; creditors: Set<string>; amount: number }>();
  for (const x of creditorExpenseLines(ds)) {
    const k = keyName(x.head);
    const a = m.get(k) || { head: x.head, creditors: new Set<string>(), amount: 0 };
    a.creditors.add(keyName(x.creditor));
    a.amount += x.amount;
    m.set(k, a);
  }
  return [...m.entries()].map(([key, a]) => ({ head: a.head, key, creditors: a.creditors.size, amount: r2(a.amount), roundOff: isRoundOffLedger(a.head) }))
    .sort((a, b) => b.creditors - a.creditors || b.amount - a.amount);
}

export interface RoundOffCheck {
  ledgers: { name: string; key: string }[];
  entries: number;
  vouchers: number;
  debit: number;
  credit: number;
  largest: number;
  /** Entries above the limit (all vouchers in the day book, not only supplier bills). */
  over: ResultTableData;
}

/** All round-off entries in the day book: are they only paise / a few rupees, or is the ledger used to plug amounts? */
export function roundOffCheck(ds: Dataset, s: AnalysisSettings): RoundOffCheck {
  const lines = ds.lines.filter((x) => isRoundOffLedger(x.ledger));
  const names = new Map<string, string>();
  for (const l of ds.ledgers) if (isRoundOffLedger(l.name)) names.set(keyName(l.name), l.name);
  for (const x of lines) names.set(keyName(x.ledger), x.ledger);
  const over: ResultTableData = {
    id: "round_off_over", title: `Round-off entries above ₹${inr(s.roundOffLimit)}`,
    description: "A round-off entry should only absorb paise or a few rupees. Larger amounts may be discounts, short payments or differences parked in round-off - check each voucher.",
    columns: [C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.txt("party", "Party"), C.ledger,
      C.amt("amount", "Amount"), C.txt("side", "Dr/Cr"), C.amt("vchAmount", "Voucher amount"), C.txt("narration", "Narration")],
    rows: [],
  };
  let debit = 0, credit = 0, largest = 0;
  for (const x of lines) {
    if (x.amount > 0) debit += x.amount; else credit -= x.amount;
    largest = Math.max(largest, Math.abs(x.amount));
    if (Math.abs(x.amount) > s.roundOffLimit) {
      over.rows.push({ date: x.date, vchType: x.voucherType, vchNo: x.voucherNo, party: x.party, ledger: x.ledger,
        amount: r2(Math.abs(x.amount)), side: drcr(x.amount), vchAmount: x.voucherAmount ? r2(x.voucherAmount) : null, narration: x.narration });
    }
  }
  over.rows.sort((a, b) => (b.amount as number) - (a.amount as number));
  return {
    ledgers: [...names.entries()].map(([key, name]) => ({ name, key })),
    entries: lines.length, vouchers: new Set(lines.map((x) => x.voucherId)).size,
    debit: r2(debit), credit: r2(credit), largest: r2(largest), over,
  };
}

// ── Details panels (one row -> its summary and the vouchers behind it) ─────

export interface DetailView {
  title: string;
  subtitle: string;
  /** Summary table; `_pick` on a row = value to filter the lines by (matched against lines[pickKey]). */
  summary: ResultTableData;
  lines: ResultTableData;
  pickKey: string;
}

/** Creditor -> each expense head (amount, vouchers, share, first / last date) and every expense line. */
export function creditorDetails(ds: Dataset, creditor: string, ignore: Set<string> = new Set()): DetailView {
  const k = keyName(creditor);
  const xs = creditorExpenseLines(ds).filter((x) => keyName(x.creditor) === k);
  const total = xs.filter((x) => !ignore.has(keyName(x.head))).reduce((t, x) => t + x.amount, 0);
  const heads = new Map<string, { head: string; amount: number; vids: Set<string>; first: string; last: string }>();
  for (const x of xs) {
    const h = heads.get(x.head) || { head: x.head, amount: 0, vids: new Set<string>(), first: x.line.date, last: x.line.date };
    h.amount += x.amount; h.vids.add(x.vid);
    if (x.line.date < h.first) h.first = x.line.date;
    if (x.line.date > h.last) h.last = x.line.date;
    heads.set(x.head, h);
  }
  const summary: ResultTableData = {
    id: "creditor_heads", title: "Expense heads", description: "Click Show to list only that head's vouchers below.",
    columns: [C.txt("head", "Expense head"), C.amt("amount", "Amount"), C.num("pct", "% of total"), C.num("vouchers", "Vouchers"),
      C.date("first", "First"), C.date("last", "Last"), C.txt("note", "Note")],
    rows: [...heads.values()].sort((a, b) => b.amount - a.amount).map((h) => ({
      head: h.head, amount: r2(h.amount), pct: total && !ignore.has(keyName(h.head)) ? Math.round((h.amount / total) * 1000) / 10 : null,
      vouchers: h.vids.size, first: h.first, last: h.last,
      note: [isRoundOffLedger(h.head) ? "Round off" : "", ignore.has(keyName(h.head)) ? "left out of the count" : ""].filter(Boolean).join(" - "),
      _pick: h.head,
    })),
  };
  const lines: ResultTableData = {
    id: "creditor_lines", title: "Vouchers", description: "Each expense line in the supplier's vouchers.",
    columns: [C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.txt("reference", "Reference"),
      C.txt("head", "Expense head"), C.amt("amount", "Amount"), C.amt("vchAmount", "Voucher amount"), C.txt("narration", "Narration")],
    rows: xs.sort((a, b) => a.line.date.localeCompare(b.line.date)).map((x) => ({
      date: x.line.date, vchType: x.line.voucherType, vchNo: x.line.voucherNo, reference: x.line.reference, head: x.head,
      amount: r2(x.amount), vchAmount: x.line.voucherAmount ? r2(x.line.voucherAmount) : null, narration: x.line.narration,
    })),
  };
  return { title: creditor, subtitle: `${heads.size} expense head(s), ₹${inr(total)} booked in ${new Set(xs.map((x) => x.vid)).size} voucher(s)`, summary, lines, pickKey: "head" };
}

/** Ledger -> each month (debit, credit, net, entries, outlier) and every entry. */
export function ledgerMonthDetails(ds: Dataset, ledger: string, s: AnalysisSettings): DetailView {
  const k = keyName(ledger);
  const ls = ds.lines.filter((x) => keyName(x.ledger) === k).sort((a, b) => a.date.localeCompare(b.date));
  const l = ledgerMap(ds).get(k);
  const pl = l && (l.nature === "Income" || l.nature === "Expense");
  const sign = pl ? normalSide(l!.nature) || 1 : 1;
  const months = monthsBetween(ds.from, ds.to);
  const by = new Map<string, { dr: number; cr: number; n: number; v: number }>();
  for (const x of ls) {
    const m = x.date.slice(0, 7);
    const a = by.get(m) || { dr: 0, cr: 0, n: 0, v: 0 };
    if (x.amount > 0) a.dr += x.amount; else a.cr -= x.amount;
    a.n++; a.v += pl ? x.amount * sign : Math.abs(x.amount);
    by.set(m, a);
  }
  const xs = months.map((m) => by.get(m)?.v || 0);
  const { mean, sd } = meanSd(xs);
  const summary: ResultTableData = {
    id: "ledger_months", title: "Month by month", description: `Average ${inr(mean)} a month, standard deviation ${inr(sd)}. Months more than ${s.sdMultiplier} SD from the average are marked. Click Show to list that month's entries.`,
    columns: [C.txt("month", "Month"), C.amt("debit", "Debit"), C.amt("credit", "Credit"), C.amt("value", pl ? "Movement (normal side +)" : "Movement (Dr + Cr)"),
      C.num("entries", "Entries"), C.num("z", "SDs from average"), C.txt("flag", "Outlier")],
    rows: months.map((m, i) => {
      const a = by.get(m);
      const z = sd > 0 ? Math.round(((xs[i] - mean) / sd) * 100) / 100 : null;
      return { month: monthLabel(m), debit: r2(a?.dr || 0), credit: r2(a?.cr || 0), value: r2(xs[i]), entries: a?.n || 0, z,
        flag: z !== null && Math.abs(z) > s.sdMultiplier ? "Outlier" : "", _pick: monthLabel(m) };
    }),
  };
  const lines: ResultTableData = {
    id: "ledger_entries", title: "Entries", description: "Every entry of the ledger in the period.",
    columns: [C.txt("month", "Month"), C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.txt("party", "Party"),
      C.amt("debit", "Debit"), C.amt("credit", "Credit"), C.txt("narration", "Narration")],
    rows: ls.map((x) => ({ month: monthLabel(x.date.slice(0, 7)), date: x.date, vchType: x.voucherType, vchNo: x.voucherNo, party: x.party,
      debit: x.amount > 0 ? r2(x.amount) : 0, credit: x.amount < 0 ? r2(-x.amount) : 0, narration: x.narration })),
  };
  return { title: ledger, subtitle: `${l?.primaryGroup || ""}${l?.nature ? ` - ${l.nature}` : ""} - ${ls.length} entries`, summary, lines, pickKey: "month" };
}

/** A group of vouchers (e.g. same amount repeated) -> ledgers they post to, and all their lines. */
export function voucherGroupDetails(ds: Dataset, voucherIds: string[], title: string): DetailView {
  const want = new Set(voucherIds);
  const ls = ds.lines.filter((x) => want.has(x.voucherId)).sort((a, b) => a.date.localeCompare(b.date) || a.voucherId.localeCompare(b.voucherId));
  const by = new Map<string, { ledger: string; dr: number; cr: number; v: Set<string> }>();
  for (const x of ls) {
    const a = by.get(x.ledger) || { ledger: x.ledger, dr: 0, cr: 0, v: new Set<string>() };
    if (x.amount > 0) a.dr += x.amount; else a.cr -= x.amount;
    a.v.add(x.voucherId);
    by.set(x.ledger, a);
  }
  const summary: ResultTableData = {
    id: "group_ledgers", title: "Ledgers in these vouchers", description: "Where the vouchers were posted. Click Show to list only the lines of that ledger.",
    columns: [C.ledger, C.amt("debit", "Debit"), C.amt("credit", "Credit"), C.num("vouchers", "Vouchers")],
    rows: [...by.values()].sort((a, b) => b.dr + b.cr - a.dr - a.cr).map((a) => ({ ledger: a.ledger, debit: r2(a.dr), credit: r2(a.cr), vouchers: a.v.size, _pick: a.ledger })),
  };
  const lines: ResultTableData = {
    id: "group_lines", title: "Voucher lines", description: "Every line of every voucher in the group.",
    columns: [C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.txt("party", "Party"), C.ledger,
      C.amt("debit", "Debit"), C.amt("credit", "Credit"), C.txt("narration", "Narration")],
    rows: ls.map((x) => ({ date: x.date, vchType: x.voucherType, vchNo: x.voucherNo, party: x.party, ledger: x.ledger,
      debit: x.amount > 0 ? r2(x.amount) : 0, credit: x.amount < 0 ? r2(-x.amount) : 0, narration: x.narration })),
  };
  return { title, subtitle: `${want.size} voucher(s), ${ls.length} line(s)`, summary, lines, pickKey: "ledger" };
}

function meanSd(xs: number[]) {
  const n = xs.length;
  if (!n) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, sd };
}

export function ledgerVolatility(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const months = monthsBetween(ds.from, ds.to);
  const res: ResultTableData = {
    id: "unu_sd_monthly", title: "Standard deviation of ledgers - monthly movement",
    description: `For every ledger the net movement of each month is compared with the ledger's own monthly average. Months more than ${s.sdMultiplier} standard deviations away are listed as outliers. CV = standard deviation / average (a higher CV means a more erratic ledger). Balance-sheet ledgers use the absolute monthly movement.`,
    columns: [C.ledger, C.primary, C.nature, C.num("active", "Months with entries"), C.amt("mean", "Monthly average"), C.amt("sd", "Standard deviation"),
      C.num("cv", "CV"), C.txt("maxMonth", "Highest month"), C.amt("maxValue", "Highest month value"), C.num("outliers", "Outlier months"), C.txt("outlierList", "Outlier months (value)")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const idx = lineIndex(ds);
  for (const l of ds.ledgers) {
    const ls = idx.get(keyName(l.name)) || [];
    if (!ls.length) continue;
    const pl = l.nature === "Income" || l.nature === "Expense";
    const sign = pl ? normalSide(l.nature) || 1 : 1;
    const mv: Record<string, number> = {};
    for (const x of ls) mv[x.date.slice(0, 7)] = (mv[x.date.slice(0, 7)] || 0) + (pl ? x.amount * sign : Math.abs(x.amount));
    const active = Object.keys(mv).length;
    if (active < 3) continue;
    const xs = months.map((m) => mv[m] || 0);
    const { mean, sd } = meanSd(xs);
    let maxI = 0;
    xs.forEach((v, i) => { if (Math.abs(v) > Math.abs(xs[maxI])) maxI = i; });
    const outl = sd > 0 ? months.map((m, i) => ({ m, v: xs[i] })).filter((o) => Math.abs(o.v - mean) > s.sdMultiplier * sd) : [];
    res.rows.push({
      ledger: l.name, primary: l.primaryGroup, nature: l.nature, active, mean: r2(mean), sd: r2(sd),
      cv: mean ? Math.round((sd / Math.abs(mean)) * 100) / 100 : null,
      maxMonth: months[maxI] ? monthLabel(months[maxI]) : "", maxValue: r2(xs[maxI] || 0),
      outliers: outl.length, outlierList: outl.map((o) => `${monthLabel(o.m)} (${Math.round(o.v).toLocaleString("en-IN")})`).join("; "),
    });
  }
  res.rows.sort((a, b) => (b.outliers as number) - (a.outliers as number) || ((b.cv as number) ?? 0) - ((a.cv as number) ?? 0));
  return res;
}

export function outlierEntries(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "unu_sd_entries", title: "Standard deviation of ledgers - unusually large entries",
    description: `Single entries more than ${s.sdMultiplier} standard deviations above the ledger's own average entry (ledgers with at least 5 entries). Z-score = how many standard deviations the entry is from the average.`,
    columns: [C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.ledger, C.txt("party", "Party"),
      C.amt("amount", "Amount"), C.txt("side", "Dr/Cr"), C.amt("mean", "Ledger average entry"), C.amt("sd", "Standard deviation"), C.num("z", "Z-score"), C.txt("narration", "Narration")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const idx = lineIndex(ds);
  for (const ls of idx.values()) {
    if (ls.length < 5) continue;
    const xs = ls.map((x) => Math.abs(x.amount));
    const { mean, sd } = meanSd(xs);
    if (sd <= 0) continue;
    for (const x of ls) {
      const z = (Math.abs(x.amount) - mean) / sd;
      if (z <= s.sdMultiplier) continue;
      res.rows.push({ date: x.date, vchType: x.voucherType, vchNo: x.voucherNo, ledger: x.ledger, party: x.party, amount: r2(Math.abs(x.amount)), side: drcr(x.amount),
        mean: r2(mean), sd: r2(sd), z: Math.round(z * 100) / 100, narration: x.narration });
    }
  }
  res.rows.sort((a, b) => (b.z as number) - (a.z as number));
  return res;
}

// ── 5. Duplicates ────────────────────────────────────────────────────────────

interface VSum { id: string; date: string; type: string; no: string; ref: string; party: string; amount: number; narration: string }

function voucherSummaries(ds: Dataset): VSum[] {
  const L = ledgerMap(ds);
  const bal = voucherBalances(ds.lines);
  const byV = new Map<string, DayBookLine[]>();
  for (const x of ds.lines) { const a = byV.get(x.voucherId); if (a) a.push(x); else byV.set(x.voucherId, [x]); }
  return bal.map((b) => {
    const ls = byV.get(b.voucherId) || [];
    const f = b.first;
    let party = f.party;
    if (!party) {
      const p = ls.find((x) => L.get(keyName(x.ledger))?.partyType);
      party = p ? p.ledger : [...ls].sort((a, c) => Math.abs(c.amount) - Math.abs(a.amount))[0]?.ledger || "";
    }
    // bill reference: the voucher's Reference, else the "New Ref" bill on its lines (Tally bill-wise details)
    const newRef = ls.flatMap((x) => x.bills || []).find((y) => /new ref/i.test(y.type) && y.name)?.name || "";
    return { id: b.voucherId, date: f.date, type: f.voucherType, no: f.voucherNo, ref: f.reference || newRef, party, amount: r2(Math.max(b.dr, b.cr)), narration: f.narration };
  });
}

const dayNo = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);

export function duplicateTransactions(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "dup_txn", title: "Duplicate transactions",
    description: `Possible double postings. Exact: same date, voucher type, party and amount. Near: same voucher type, party and amount within ${s.duplicateWindowDays} days. Same bill: one bill / reference number used in more than one voucher of the same party and type. Voucher no. repeated: one voucher number used by more than one voucher of the same type.`,
    columns: [C.txt("match", "Match"), C.num("group", "Group"), C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."),
      C.txt("ref", "Reference"), C.txt("party", "Party"), C.amt("amount", "Amount"), C.txt("narration", "Narration")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const vs = voucherSummaries(ds).filter((v) => v.amount > 0);
  let g = 0;
  const used = new Set<string>();
  const emit = (match: string, arr: VSum[]) => {
    g++;
    for (const v of arr) res.rows.push({ match, group: g, date: v.date, vchType: v.type, vchNo: v.no, ref: v.ref, party: v.party, amount: v.amount, narration: v.narration });
  };
  const groupBy = (keyFn: (v: VSum) => string | null) => {
    const m = new Map<string, VSum[]>();
    for (const v of vs) { const k = keyFn(v); if (!k) continue; const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
    return [...m.values()].filter((a) => a.length > 1);
  };
  // exact
  for (const arr of groupBy((v) => (v.party ? `${v.date}|${v.type.toLowerCase()}|${keyName(v.party)}|${v.amount}` : null))) {
    emit("Exact", arr); arr.forEach((v) => used.add(v.id));
  }
  // near (different dates within window)
  for (const arr of groupBy((v) => (v.party ? `${v.type.toLowerCase()}|${keyName(v.party)}|${v.amount}` : null))) {
    const sorted = arr.filter((v) => !used.has(v.id)).sort((a, b) => a.date.localeCompare(b.date));
    let cluster: VSum[] = [];
    const flush = () => { if (cluster.length > 1) { emit(`Near (within ${s.duplicateWindowDays} days)`, cluster); cluster.forEach((v) => used.add(v.id)); } cluster = []; };
    for (const v of sorted) {
      if (cluster.length && dayNo(v.date) - dayNo(cluster[cluster.length - 1].date) > s.duplicateWindowDays) flush();
      cluster.push(v);
    }
    flush();
  }
  // same bill reference
  for (const arr of groupBy((v) => (v.ref && v.party && !/^(new ref|agst ref|advance|on account)$/i.test(v.ref) ? `${keyName(v.party)}|${v.type.toLowerCase()}|${v.ref.toLowerCase().replace(/\s+/g, "")}` : null))) {
    emit("Same bill / reference", arr);
  }
  // repeated voucher numbers
  for (const arr of groupBy((v) => (v.no ? `${v.type.toLowerCase()}|${v.no.toLowerCase()}` : null))) {
    emit("Voucher no. repeated", arr);
  }
  return res;
}

/** Aggressive name key for duplicate ledgers: "M/s. ABC Traders Pvt. Ltd." == "abc traders private limited". */
export function ledgerNameKey(name: string) {
  return String(name || "").toLowerCase()
    .replace(/\bm\/s\.?|\bmessrs\.?/g, " ")
    .replace(/&/g, " and ")
    .replace(/\bpvt\b\.?/g, " private ").replace(/\bltd\b\.?/g, " limited ").replace(/\bco\b\.?/g, " company ")
    .replace(/[^a-z0-9]+/g, "");
}

export function duplicateLedgers(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "dup_ledgers", title: "Duplicate ledgers",
    description: `Same party opened more than once. Same name: identical after removing M/s, spaces, punctuation and Pvt/Ltd spellings. Similar name: ${Math.round(s.fuzzyThreshold * 100)}% or more alike within the same group type (party ledgers only). Same GSTIN / Same PAN: one GSTIN or PAN on more than one ledger.`,
    columns: [C.txt("match", "Match"), C.num("group", "Group"), C.ledger, C.parent, C.txt("gstin", "GSTIN"), C.txt("pan", "PAN"),
      C.amt("closing", "Closing balance"), C.txt("side", "Dr/Cr"), C.num("similarity", "Similarity %")],
    rows: [],
  };
  let g = 0;
  const seenPair = new Set<string>();
  const emit = (match: string, arr: LedgerRow[], sim?: number) => {
    const ids = arr.map((l) => keyName(l.name)).sort().join("||");
    if (seenPair.has(ids)) return;
    seenPair.add(ids);
    g++;
    for (const l of arr) res.rows.push({ match, group: g, ledger: l.name, parent: l.parent, gstin: l.gstin, pan: l.pan, closing: r2(Math.abs(l.closing)), side: drcr(l.closing), similarity: sim ?? 100 });
  };
  const by = (fn: (l: LedgerRow) => string | null) => {
    const m = new Map<string, LedgerRow[]>();
    for (const l of ds.ledgers) { const k = fn(l); if (!k) continue; const a = m.get(k); if (a) a.push(l); else m.set(k, [l]); }
    return [...m.values()].filter((a) => a.length > 1);
  };
  for (const arr of by((l) => ledgerNameKey(l.name) || null)) emit("Same name", arr);
  for (const arr of by((l) => (l.gstin && l.gstin.length >= 15 ? normalizeGstin(l.gstin) : null))) emit("Same GSTIN", arr);
  for (const arr of by((l) => (l.pan && PAN_RX.test(l.pan) ? l.pan : null))) emit("Same PAN", arr);

  // fuzzy - party ledgers, blocked by first 3 characters of the key
  const parties = ds.ledgers.filter((l) => l.partyType).map((l) => ({ l, k: ledgerNameKey(l.name) })).filter((x) => x.k.length >= 4);
  const blocks = new Map<string, typeof parties>();
  for (const p of parties) { const b = `${p.l.partyType}|${p.k.slice(0, 3)}`; const a = blocks.get(b); if (a) a.push(p); else blocks.set(b, [p]); }
  for (const arr of blocks.values()) {
    if (arr.length < 2 || arr.length > 400) continue;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (a.k === b.k || Math.abs(a.k.length - b.k.length) > 4) continue;
        const sim = calculateSimilarity(a.k, b.k);
        if (sim >= s.fuzzyThreshold) emit("Similar name", [a.l, b.l], Math.round(sim * 100));
      }
    }
  }
  return res;
}

// ── 5b. Unusual entries ──────────────────────────────────────────────────────

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const CASH = "Cash-in-Hand";
const BANKS = new Set(["Bank Accounts", "Bank OD A/c"]);
const LOANS = new Set(["Secured Loans", "Unsecured Loans", "Loans (Liability)"]);

function vouchersById(ds: Dataset) {
  const byV = new Map<string, DayBookLine[]>();
  for (const x of ds.lines) { const a = byV.get(x.voucherId); if (a) a.push(x); else byV.set(x.voucherId, [x]); }
  return byV;
}

/** Round-figure vouchers: at least the minimum amount and an exact multiple of the unit (₹1,000 by default). */
export function roundAmountEntries(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "ent_round", title: `Round-amount entries (₹${inr(s.roundMinAmount)} or more, multiple of ₹${inr(s.roundUnit)})`,
    description: "Vouchers whose amount is an exact round figure. Estimates, provisions, cash withdrawals and made-up or adjusting entries tend to be round; genuine invoices usually are not. " +
      "Read together with the voucher type: round Contra / bank transfers and loan or capital receipts are normal, round cash payments, journals and expense bills deserve a look. Filter by voucher type.",
    columns: [C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.txt("party", "Party"),
      C.amt("amount", "Amount"), C.txt("roundness", "Round to"), C.txt("cash", "Cash?"), C.txt("ledgers", "Ledgers in the voucher"), C.txt("narration", "Narration")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const L = ledgerMap(ds);
  const byV = vouchersById(ds);
  const unit = Math.max(1, s.roundUnit);
  for (const v of voucherSummaries(ds)) {
    if (v.amount < s.roundMinAmount || Math.abs(v.amount % unit) > 0.004) continue;
    const ls = byV.get(v.id) || [];
    const roundness = v.amount % 10000000 === 0 ? "₹1 crore" : v.amount % 100000 === 0 ? "₹1 lakh" : v.amount % 10000 === 0 ? "₹10,000" : `₹${inr(unit)}`;
    res.rows.push({
      date: v.date, vchType: v.type, vchNo: v.no, party: v.party, amount: v.amount, roundness,
      cash: ls.some((x) => L.get(keyName(x.ledger))?.reservedGroup === CASH) ? "Cash" : "",
      ledgers: [...new Set(ls.map((x) => x.ledger))].filter((n) => n !== v.party).join("; "), narration: v.narration,
    });
  }
  res.rows.sort((a, b) => (b.amount as number) - (a.amount as number));
  return res;
}

/**
 * Same amount repeated. (a) one party (or, without a party, the voucher's main ledger) booked with the same
 * amount in N or more vouchers of one type; (b) the same amount on one day to different parties.
 */
export function repeatedAmounts(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "ent_repeat", title: `Same amount repeated (₹${inr(s.repeatMinAmount)} or more)`,
    description: `Same party, same amount: one party / ledger with the same amount in ${s.repeatMinCount} or more vouchers of the same type - fixed monthly charges (rent, salary, EMI) are normal; otherwise look for split bills, recycled invoices or round-tripping. ` +
      "Same day, same amount, different parties: one amount on one date to several parties in vouchers of the same type - look for one payment split or booked to the wrong party. Exact duplicates (same party, same date) are in Duplicates.",
    columns: [C.txt("match", "Match"), C.num("group", "Group"), C.num("count", "Vouchers in group"), C.date("date", "Date"), C.txt("vchType", "Voucher type"),
      C.txt("vchNo", "Voucher no."), C.txt("party", "Party / ledger"), C.amt("amount", "Amount"), C.txt("narration", "Narration")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const vs = voucherSummaries(ds).filter((v) => v.amount >= s.repeatMinAmount && v.party);
  let g = 0;
  const emit = (match: string, arr: VSum[]) => {
    g++;
    const vids = arr.map((v) => v.id).join("|");
    for (const v of [...arr].sort((a, b) => a.date.localeCompare(b.date))) {
      res.rows.push({ match, group: g, count: arr.length, date: v.date, vchType: v.type, vchNo: v.no, party: v.party, amount: v.amount, narration: v.narration, _vids: vids });
    }
  };
  const groupBy = (keyFn: (v: VSum) => string) => {
    const m = new Map<string, VSum[]>();
    for (const v of vs) { const k = keyFn(v); const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
    return [...m.values()];
  };
  const samePartyGroups = groupBy((v) => `${keyName(v.party)}|${v.type.toLowerCase()}|${v.amount}`)
    .filter((a) => a.length >= Math.max(2, s.repeatMinCount))
    .sort((a, b) => b.length - a.length || b[0].amount - a[0].amount);
  for (const arr of samePartyGroups) emit("Same party, same amount", arr);
  const sameDayGroups = groupBy((v) => `${v.date}|${v.type.toLowerCase()}|${v.amount}`)
    .filter((a) => new Set(a.map((v) => keyName(v.party))).size > 1)
    .sort((a, b) => b[0].amount - a[0].amount);
  for (const arr of sameDayGroups) emit("Same day, same amount, different parties", arr);
  return res;
}

/**
 * Cash transactions over the Income-tax Act limits, per person (ledger) per day:
 * s.40A(3) cash payments for expenditure, s.269ST cash receipts, s.269SS / 269T loans and deposits in cash.
 */
export function cashLimitBreaches(ds: Dataset, s: AnalysisSettings): ResultTableData {
  const res: ResultTableData = {
    id: "ent_cash", title: "Cash transactions over the Income-tax limits",
    description: `Cash (Cash-in-Hand ledgers) paid to or received from one ledger on one day, totalled. ` +
      `s.40A(3): cash payment above ₹${inr(s.cash40A3Limit)} to a person in a day for an expense (₹35,000 for plying, hiring or leasing goods carriages; Rule 6DD exceptions apply) - the expense is disallowed; report in Form 3CD clause 21(d). ` +
      `s.269ST: cash receipt of ₹${inr(s.cash269STLimit)} or more from a person in a day (penalty u/s 271DA). ` +
      `s.269SS / 269T: loan or deposit accepted / repaid in cash of ₹${inr(s.cashLoanLimit)} or more (Form 3CD clause 31). ` +
      "The 'person' is the ledger on the other side; where an expense ledger was paid to several persons on one day, split it from the vouchers. Cash deposited to / withdrawn from bank is left out.",
    columns: [C.txt("rule", "Section"), C.date("date", "Date"), C.ledger, C.txt("group", "Under (group)"), C.txt("nature", "Nature"),
      C.amt("amount", "Cash amount in the day"), C.amt("limit", "Limit"), C.num("vouchers", "Vouchers"), C.txt("vchNos", "Voucher nos."), C.txt("narration", "Narration (first)")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const L = ledgerMap(ds);
  if (!ds.ledgers.some((l) => l.reservedGroup === CASH)) { res.cannotRun = "No ledger under Cash-in-Hand was found, so cash transactions cannot be identified."; return res; }
  type Agg = { rule: string; date: string; ledger: string; amount: number; vchs: Set<string>; narration: string };
  const agg = new Map<string, Agg>();
  for (const ls of vouchersById(ds).values()) {
    const cash = ls.filter((x) => L.get(keyName(x.ledger))?.reservedGroup === CASH);
    if (!cash.length) continue;
    const cashNet = cash.reduce((t, x) => t + x.amount, 0); // + = cash received, - = cash paid
    if (Math.abs(cashNet) < 0.5) continue;
    const paid = cashNet < 0;
    for (const x of ls) {
      const l = L.get(keyName(x.ledger));
      if (!l || l.reservedGroup === CASH || BANKS.has(l.reservedGroup)) continue;
      // the other side of a cash payment is debited, of a cash receipt credited
      if (paid ? x.amount <= 0 : x.amount >= 0) continue;
      const loan = LOANS.has(l.reservedGroup);
      let rule = "";
      if (loan) rule = paid ? "269T (loan / deposit repaid)" : "269SS (loan / deposit taken)";
      else if (paid) { if (l.reservedGroup === "Capital Account") continue; rule = "40A(3) (cash payment)"; }
      else rule = "269ST (cash receipt)";
      const k = `${rule}|${x.date}|${keyName(x.ledger)}`;
      const a = agg.get(k) || { rule, date: x.date, ledger: x.ledger, amount: 0, vchs: new Set<string>(), narration: x.narration };
      a.amount += Math.abs(x.amount);
      a.vchs.add(`${x.voucherType} ${x.voucherNo}`.trim());
      agg.set(k, a);
    }
  }
  for (const a of agg.values()) {
    const limit = a.rule.startsWith("40A") ? s.cash40A3Limit : a.rule.startsWith("269ST") ? s.cash269STLimit : s.cashLoanLimit;
    const over = a.rule.startsWith("40A") ? a.amount > limit : a.amount >= limit;
    if (!over) continue;
    const l = L.get(keyName(a.ledger));
    res.rows.push({ rule: a.rule, date: a.date, ledger: a.ledger, group: l?.parent || "", nature: l?.nature || "", amount: r2(a.amount), limit,
      vouchers: a.vchs.size, vchNos: [...a.vchs].join("; "), narration: a.narration });
  }
  res.rows.sort((a, b) => String(a.rule).localeCompare(String(b.rule)) || (b.amount as number) - (a.amount as number));
  return res;
}

/** Journal vouchers that touch cash, bank, sales or purchase ledgers - normally booked through other voucher types. */
export function unusualJournals(ds: Dataset): ResultTableData {
  const res: ResultTableData = {
    id: "ent_journal", title: "Journals touching cash, bank, sales or purchase",
    description: "Cash and bank normally move through Payment / Receipt / Contra vouchers and sales / purchases through Sales / Purchase vouchers. " +
      "A journal posted to them by-passes those controls (GST, bill-wise, numbering) - typical of management-override, cut-off and year-end adjustments. Read the narration; obtain support for each. " +
      "Voucher types are recognised by name (Journal / Jrnl / JV); stock and manufacturing journals are not included.",
    columns: [C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.txt("flags", "Touches"), C.amt("amount", "Voucher amount"),
      C.txt("ledgers", "Ledgers (Dr + / Cr -)"), C.txt("narration", "Narration")],
    rows: [],
  };
  if (!ds.lines.length) { res.cannotRun = NEED_DAYBOOK; return res; }
  const L = ledgerMap(ds);
  for (const ls of vouchersById(ds).values()) {
    const f = ls[0];
    if (!/journal|jrnl|\bjv\b/i.test(f.voucherType) || /stock|manufactur|material|physical|reversing/i.test(f.voucherType)) continue;
    const flags = new Set<string>();
    for (const x of ls) {
      const rg = L.get(keyName(x.ledger))?.reservedGroup || "";
      if (rg === CASH) flags.add("Cash");
      else if (BANKS.has(rg)) flags.add("Bank");
      else if (rg === "Sales Accounts") flags.add("Sales");
      else if (rg === "Purchase Accounts") flags.add("Purchase");
    }
    if (!flags.size) continue;
    const dr = ls.reduce((t, x) => t + (x.amount > 0 ? x.amount : 0), 0);
    res.rows.push({
      date: f.date, vchType: f.voucherType, vchNo: f.voucherNo, flags: ["Cash", "Bank", "Sales", "Purchase"].filter((k) => flags.has(k)).join(", "),
      amount: r2(dr), ledgers: ls.map((x) => `${x.ledger} (${x.amount > 0 ? "+" : "-"}${inr(Math.abs(x.amount))})`).join("; "), narration: f.narration,
    });
  }
  res.rows.sort((a, b) => (b.amount as number) - (a.amount as number));
  return res;
}

// ── 6. Day book extract (screen view) ───────────────────────────────────────

export function dayBookTable(ds: Dataset): ResultTableData {
  const L = ledgerMap(ds);
  return {
    id: "daybook", title: "Day Book", description: "Every ledger line of every voucher, with the ledger's group.",
    columns: [C.date("date", "Date"), C.txt("vchType", "Voucher type"), C.txt("vchNo", "Voucher no."), C.txt("ref", "Reference"), C.txt("party", "Party"),
      C.ledger, C.txt("group", "Under (group)"), C.primary, C.amt("debit", "Debit"), C.amt("credit", "Credit"),
      C.txt("bills", "Bill / Ref (type)"), C.txt("narration", "Narration")],
    rows: ds.lines.map((x) => {
      const l = L.get(keyName(x.ledger));
      return { date: x.date, vchType: x.voucherType, vchNo: x.voucherNo, ref: x.reference, party: x.party, ledger: x.ledger,
        group: l?.parent || x.group, primary: l?.primaryGroup || x.primaryGroup, debit: x.amount > 0 ? x.amount : 0, credit: x.amount < 0 ? -x.amount : 0,
        bills: (x.bills || []).map((b) => `${b.name}${b.type ? ` (${b.type})` : ""}`).join("; "), narration: x.narration };
    }),
    cannotRun: ds.lines.length ? undefined : NEED_DAYBOOK,
  };
}

// ── Run everything (for the summary and "export all") ───────────────────────

export function runAllChecks(ds: Dataset, s: AnalysisSettings): { section: string; table: ResultTableData }[] {
  return [
    { section: "Trial Balance", table: dayBookReconciliation(ds, s) },
    { section: "Dormant Ledgers", table: dormantLedgers(ds, s) },
    { section: "Dormant Ledgers", table: unchangedBalances(ds, s) },
    { section: "Negative Ledgers", table: negativeLedgers(ds, "assets_cr", s) },
    { section: "Negative Ledgers", table: negativeLedgers(ds, "income_dr", s) },
    { section: "Negative Ledgers", table: negativeLedgers(ds, "expense_cr", s) },
    { section: "Negative Ledgers", table: negativeLedgers(ds, "liabilities_dr", s) },
    { section: "Incomplete Masters", table: incompleteMasters(ds, "customers_no_gstin") },
    { section: "Incomplete Masters", table: incompleteMasters(ds, "customers_no_pan") },
    { section: "Incomplete Masters", table: incompleteMasters(ds, "suppliers_no_gstin") },
    { section: "Incomplete Masters", table: incompleteMasters(ds, "suppliers_no_pan") },
    { section: "Unusual Ledger Balances", table: partiesWithoutMovement(ds, "Debtor", s) },
    { section: "Unusual Ledger Balances", table: partiesWithoutMovement(ds, "Creditor", s) },
    { section: "Unusual Ledger Balances", table: smallBalances(ds, s) },
    { section: "Unusual Ledger Balances", table: creditorsMultipleExpenses(ds, s) },
    { section: "Unusual Ledger Balances", table: ledgerVolatility(ds, s) },
    { section: "Unusual Ledger Balances", table: outlierEntries(ds, s) },
    { section: "Duplicates", table: duplicateTransactions(ds, s) },
    { section: "Duplicates", table: duplicateLedgers(ds, s) },
    { section: "Unusual Entries", table: roundAmountEntries(ds, s) },
    { section: "Unusual Entries", table: repeatedAmounts(ds, s) },
    { section: "Unusual Entries", table: cashLimitBreaches(ds, s) },
    { section: "Unusual Entries", table: unusualJournals(ds) },
  ];
}

/** Count of findings: rows, or for grouped tables the number of groups. */
export function findingCount(t: ResultTableData) {
  if (t.cannotRun) return null;
  if (t.columns.some((c) => c.key === "group")) return new Set(t.rows.map((r) => r.group)).size;
  if (t.id === "unu_sd_monthly") return t.rows.filter((r) => (r.outliers as number) > 0).length;
  return t.rows.length;
}
