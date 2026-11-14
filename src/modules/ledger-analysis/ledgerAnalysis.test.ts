// Synthetic data only. Run: npx vitest run src/modules/ledger-analysis
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildDataset, parseDayBook, parseTrialBalance, readAmount, toIsoDate } from "./importers";
import {
  creditorDetails, creditorHeadUsage, ledgerMonthDetails, roundOffCheck, voucherGroupDetails,
  creditorsMultipleExpenses, dayBookReconciliation, dormantLedgers, unchangedBalances, roundAmountEntries, repeatedAmounts, cashLimitBreaches, unusualJournals, duplicateLedgers, duplicateTransactions, incompleteMasters, ledgerVolatility,
  negativeLedgers, outlierEntries, partiesWithoutMovement, smallBalances, trialBalanceAsOn, trialBalanceMonthly,
} from "./engine";
import { classifyChain } from "./classify";
import { DEFAULT_SETTINGS } from "./types";
import { buildExeLayoutWorkbook } from "./exportExcel";
import { duplicateTransactions as dupTxn } from "./engine";
import { calculateGstinCheckDigit } from "@/lib/gstinValidation";

const SHARMA_GSTIN = "18AABCS1234F1Z" + calculateGstinCheckDigit("18AABCS1234F1Z");

const S = DEFAULT_SETTINGS;
const toBuf = (wb: XLSX.WorkBook) => {
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
};

/** A small Day Book Extractor style workbook (Tally signs: $Amount debit negative, $DRcr given). */
function extractorWorkbook() {
  const H = ["$Pk", "$Date", "$VoucherNumber", "$VoucherTypeName", "$Reference", "$PartyLedgerName", "$LedgerName", "$LedGroup", "$MainGroup", "$PartyGSTIN", "$Amount", "$DRcr", "$Narration"];
  const rows: unknown[][] = [];
  let pk = 0;
  const v = (date: string, no: string, type: string, party: string, ref: string, lines: [string, number][], narr = "") => {
    pk++;
    for (const [led, drPlus] of lines) {
      // party line: LedgerName blank, account in PartyLedgerName (the known quirk)
      const isParty = led === party;
      rows.push([pk, date, no, type, ref, party, isParty ? "" : led, "", "", "", -drPlus, drPlus > 0 ? "Dr" : "Cr", narr]);
    }
  };
  // April
  v("2025-04-05", "P1", "Purchase", "Sharma Traders", "B-101", [["Purchase GST", 10000], ["Sharma Traders", -10000]]);
  v("2025-04-06", "P2", "Purchase", "Sharma Traders", "B-101", [["Purchase GST", 10000], ["Sharma Traders", -10000]]); // same bill, near dup
  v("2025-04-10", "J1", "Journal", "Sharma Traders", "", [["Rent", 3000], ["Repairs", 2000], ["Sharma Traders", -5000]]);
  v("2025-04-15", "S1", "Sales", "Gupta & Sons", "", [["Gupta & Sons", 20000], ["Sales GST", -20000]]);
  v("2025-04-20", "R1", "Receipt", "Gupta & Sons", "", [["Cash", 25000], ["Gupta & Sons", -25000]]); // debtor goes Cr
  // May .. Mar small rent each month + one spike
  const months = ["05", "06", "07", "08", "09", "10", "11", "12"];
  months.forEach((m, i) => v(`2025-${m}-01`, `RN${i}`, "Payment", "", "", [["Rent", 3000], ["Cash", -3000]]));
  v("2026-01-01", "RN9", "Payment", "", "", [["Rent", 3000], ["Cash", -3000]]);
  v("2026-02-01", "RN10", "Payment", "", "", [["Rent", 60000], ["Cash", -60000]], "Annual rent arrears");
  v("2026-03-01", "RN11", "Payment", "", "", [["Rent", 3000], ["Cash", -3000]]);
  // exact duplicate
  v("2026-03-10", "PY1", "Payment", "Verma Electricals", "", [["Verma Electricals", 1500], ["Cash", -1500]]);
  v("2026-03-10", "PY2", "Payment", "Verma Electricals", "", [["Verma Electricals", 1500], ["Cash", -1500]]);
  // discount received with credit nature in an expense head
  v("2026-03-15", "J2", "Journal", "", "", [["Sharma Traders", 500], ["Repairs", -2500], ["Cash", 2000]]);

  const L = [
    ["Ledger Name", "Parent Group", "Primary Group", "GSTIN", "Opening Balance", "Debit Totals", "Credit Totals", "Closing Balance"],
    ["Cash", "Cash-in-Hand", "Cash-in-Hand", "", -100000, 0, 0, 0],
    ["Sharma Traders", "Sundry Creditors", "Sundry Creditors", SHARMA_GSTIN, 0, 0, 0, 0],
    ["Sharma Traders.", "Sundry Creditors", "Sundry Creditors", "", 0, 0, 0, 0],
    ["Verma Electricals", "Sundry Creditors", "Sundry Creditors", "", 0, 0, 0, 0],
    ["Gupta & Sons", "Sundry Debtors", "Sundry Debtors", "", 0, 0, 0, 0],
    ["Old Debtor", "Sundry Debtors", "Sundry Debtors", "", -45000, 0, 0, -45000],
    ["Tiny Debtor", "Sundry Debtors", "Sundry Debtors", "", -250, 0, 0, -250],
    ["Old Creditor", "Sundry Creditors", "Sundry Creditors", "", 12000, 0, 0, 12000],
    ["Purchase GST", "Purchase Accounts", "Purchase Accounts", "", 0, 0, 0, 0],
    ["Sales GST", "Sales Accounts", "Sales Accounts", "", 0, 0, 0, 0],
    ["Rent", "Indirect Expenses", "Indirect Expenses", "", 0, 0, 0, 0],
    ["Repairs", "Indirect Expenses", "Indirect Expenses", "", 0, 0, 0, 0],
    ["Capital", "Capital Account", "Capital Account", "", 133250, 0, 0, 133250],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), "odbcdaybook");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L), "Ledgers");
  return wb;
}

function load() {
  const p = parseDayBook(toBuf(extractorWorkbook()));
  const ds = buildDataset({ ledgers: p.ledgers, lines: p.lines, groups: p.groups, sources: ["test"], warnings: p.warnings });
  // the Ledgers sheet closings above are deliberately not updated for the year (recon test); fix closings from lines
  return { p, ds };
}

describe("helpers", () => {
  it("reads amounts and dates", () => {
    expect(readAmount("1,23,456.50 Cr")).toEqual({ value: 123456.5, side: "Cr" });
    expect(readAmount("(1,000)").value).toBe(-1000);
    expect(toIsoDate("01-Apr-2025")).toBe("2025-04-01");
    expect(toIsoDate("31/03/2026")).toBe("2026-03-31");
    expect(toIsoDate(45748)).toBe("2025-04-01");
    expect(toIsoDate("20250401")).toBe("2025-04-01");
  });
  it("classifies by the outermost group", () => {
    expect(classifyChain(["Debtors - Delhi", "Sundry Debtors", "Current Assets"]).partyType).toBe("Debtor");
    expect(classifyChain(["Expenses", "Current Assets"]).nature).toBe("Asset");
    expect(classifyChain(["Bank OD A/c", "Loans (Liability)"]).nature).toBe("Liability");
    expect(classifyChain(["Indirect Expenses"]).nature).toBe("Expense");
  });
});

describe("Day Book Extractor import", () => {
  it("resolves the party-column quirk, signs and voucher ids", () => {
    const { p, ds } = load();
    expect(p.format).toBe("daybook-extractor");
    expect(p.ledgers.length).toBe(13);
    const sharmaCr = p.lines.filter((l) => l.ledger === "Sharma Traders" && l.amount < 0).reduce((t, l) => t + l.amount, 0);
    expect(sharmaCr).toBe(-25000);
    const cash = ds.ledgers.find((l) => l.name === "Cash")!;
    expect(cash.opening).toBe(100000); // Tally -100000 = Dr 1,00,000
    expect(p.warnings.filter((w) => /not equal/.test(w))).toHaveLength(0);
  });
});

describe("checks", () => {
  const { ds } = load();
  it("TB as on date and month over month", () => {
    const tb = trialBalanceAsOn(ds, "2025-04-30");
    const cash = tb.rows.find((r) => r.ledger === "Cash")!;
    expect(cash.closeDr).toBe(125000);
    const total = tb.rows.find((r) => r.ledger === "TOTAL")!;
    expect(total.closeDr).toBe(total.closeCr);
    const mm = trialBalanceMonthly(ds, "closing");
    expect(mm.columns.length).toBe(4 + 12 + 1);
    const rent = mm.rows.find((r) => r.ledger === "Rent")!;
    expect(rent.closing).toBe(3000 + 3000 * 11 + 57000);
  });
  it("reconciliation flags ledgers whose TB closing ignores the day book", () => {
    const r = dayBookReconciliation(ds, S);
    expect(r.rows.some((x) => x.ledger === "Cash")).toBe(true);
    expect(r.rows.some((x) => x.ledger === "Old Debtor")).toBe(false);
  });
  it("negative ledgers", () => {
    // TB closings in the Ledgers sheet are used as-is: give realistic ones
    const ds2 = { ...ds, ledgers: ds.ledgers.map((l) => (l.name === "Gupta & Sons" ? { ...l, closing: -5000 } : l.name === "Repairs" ? { ...l, closing: -500 } : l.name === "Sales GST" ? { ...l, closing: 100 } : l.name === "Verma Electricals" ? { ...l, closing: 3000 } : l)) };
    expect(negativeLedgers(ds2, "assets_cr", S).rows.map((r) => r.ledger)).toContain("Gupta & Sons");
    expect(negativeLedgers(ds2, "expense_cr", S).rows.map((r) => r.ledger)).toEqual(["Repairs"]);
    expect(negativeLedgers(ds2, "income_dr", S).rows.map((r) => r.ledger)).toEqual(["Sales GST"]);
    expect(negativeLedgers(ds2, "liabilities_dr", S).rows.map((r) => r.ledger)).toContain("Verma Electricals");
    expect(negativeLedgers(ds2, "liabilities_dr", S).rows.map((r) => r.ledger)).not.toContain("Old Creditor");
  });
  it("incomplete masters", () => {
    const g = incompleteMasters(ds, "customers_no_gstin");
    expect(g.rows.map((r) => r.ledger).sort()).toEqual(["Gupta & Sons", "Old Debtor", "Tiny Debtor"]);
    expect(incompleteMasters(ds, "customers_no_pan").cannotRun).toBeTruthy(); // no PAN column loaded
    const s = incompleteMasters(ds, "suppliers_no_gstin").rows.map((r) => r.ledger);
    expect(s).not.toContain("Sharma Traders");
  });
  it("unusual balances", () => {
    expect(partiesWithoutMovement(ds, "Debtor", S).rows.map((r) => r.ledger).sort()).toEqual(["Old Debtor", "Tiny Debtor"]);
    expect(partiesWithoutMovement(ds, "Creditor", S).rows.map((r) => r.ledger)).toEqual(["Old Creditor"]);
    expect(smallBalances(ds, S).rows.map((r) => r.ledger)).toContain("Tiny Debtor");
    const ce = creditorsMultipleExpenses(ds, S);
    expect(ce.rows[0].creditor).toBe("Sharma Traders");
    expect(ce.rows[0].heads).toBe(3); // Purchase GST, Rent, Repairs
    const sd = ledgerVolatility(ds, S).rows.find((r) => r.ledger === "Rent")!;
    expect(sd.outlierList).toContain("Feb-26");
    expect(outlierEntries(ds, S).rows.some((r) => r.ledger === "Rent" && r.amount === 60000)).toBe(true);
  });
  it("duplicates", () => {
    const d = duplicateTransactions(ds, S);
    const kinds = new Set(d.rows.map((r) => r.match));
    expect(kinds.has("Exact")).toBe(true);
    expect([...kinds].some((k) => String(k).startsWith("Near"))).toBe(true);
    expect(kinds.has("Same bill / reference")).toBe(true);
    const dl = duplicateLedgers(ds, S);
    expect(dl.rows.filter((r) => r.match === "Same name").map((r) => r.ledger).sort()).toEqual(["Sharma Traders", "Sharma Traders."]);
  });
});

describe("Tally (live) shape", () => {
  it("builds group chains from Tally group masters and flips Tally signs", async () => {
    const raw = {
      company: "Demo", companies: [], from: "2025-04-01", to: "2025-06-30", warnings: [],
      ledgers: [
        { name: "Cash", parent: "Cash-in-Hand", opening: -1000, closing: -500, gstin: "", pan: "", gstRegistrationType: "" },
        { name: "Rent & Rates", parent: "Office Exp", opening: 0, closing: -500, gstin: "", pan: "", gstRegistrationType: "" },
        { name: "ABC Traders", parent: "Debtors Delhi", opening: -200, closing: -200, gstin: "", pan: "ABCDE1234F", gstRegistrationType: "Unregistered" },
      ],
      groups: [
        { name: "Office Exp", parent: "Indirect Expenses" }, { name: "Debtors Delhi", parent: "Sundry Debtors" },
        { name: "Sundry Debtors", parent: "Current Assets" }, { name: "Current Assets", parent: "\u0004 Primary" }, { name: "Cash-in-Hand", parent: "Current Assets" },
      ],
      lines: [
        { voucherId: "T9", date: "2025-05-10", voucherType: "Payment", voucherNo: "1", reference: "", party: "", narration: "", partyGstin: "", ledger: "Rent & Rates", amount: -500 },
        { voucherId: "T9", date: "2025-05-10", voucherType: "Payment", voucherNo: "1", reference: "", party: "", narration: "", partyGstin: "", ledger: "Cash", amount: 500 },
      ],
    };
    (globalThis as unknown as { window: unknown }).window = { electronAPI: { ledgerAnalysis: { tallyFetch: async () => ({ success: true, data: raw }), onProgress: () => () => undefined } } };
    const { fetchFromTally } = await import("./tallyClient");
    const ds = buildDataset(await fetchFromTally({ host: "x", port: "1", company: "", from: "2025-04-01", to: "2025-06-30", includeDayBook: true }));
    const by = Object.fromEntries(ds.ledgers.map((l) => [l.name, l]));
    expect(by["ABC Traders"].chain).toEqual(["Debtors Delhi", "Sundry Debtors", "Current Assets"]);
    expect(by["ABC Traders"].partyType).toBe("Debtor");
    expect(by["Rent & Rates"].nature).toBe("Expense");
    expect([by["Cash"].opening, by["Cash"].closing, by["Cash"].credit]).toEqual([1000, 500, 500]);
    expect(partiesWithoutMovement(ds, "Debtor", S).rows.map((r) => r.ledger)).toEqual(["ABC Traders"]);
    expect(incompleteMasters(ds, "customers_no_gstin").rows[0].issue).toBe("Blank - marked Unregistered");
    expect(dayBookReconciliation(ds, S).rows).toHaveLength(0);
    expect(trialBalanceAsOn(ds, "2025-04-30").rows.find((r) => r.ledger === "Cash")!.closeDr).toBe(1000);
  });
});

describe("generic day book + generic TB", () => {
  it("fills down voucher headers and reads separate Dr/Cr columns", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["ABC Pvt Ltd"], ["Day Book"], [],
      ["Date", "Vch Type", "Vch No.", "Particulars", "Debit", "Credit", "Narration"],
      ["01-04-2025", "Payment", "1", "Rent", 1000, null, "April rent"],
      [null, null, null, "HDFC Bank", null, 1000, null],
      ["02-04-2025", "Receipt", "1", "HDFC Bank", 500, null, null],
      [null, null, null, "Gupta & Sons", null, 500, null],
    ]), "Sheet1");
    const p = parseDayBook(toBuf(wb));
    expect(p.format).toBe("generic");
    expect(p.lines).toHaveLength(4);
    expect(new Set(p.lines.map((l) => l.voucherId)).size).toBe(2);
    expect(p.lines[1].narration).toBe("April rent");
    const tbwb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(tbwb, XLSX.utils.aoa_to_sheet([
      ["Ledger", "Group", "Opening", "Debit", "Credit", "Closing", "PAN"],
      ["Rent", "Indirect Expenses", 0, 1000, 0, "1,000.00 Dr", ""],
      ["HDFC Bank", "Bank Accounts", "2,000.00 Dr", 500, 1000, "1,500.00 Dr", ""],
      ["Gupta & Sons", "Sundry Debtors", "500 Dr", 0, 500, 0, "ABCDE1234F"],
    ]), "TB");
    const tb = parseTrialBalance(toBuf(tbwb), "generic");
    expect(tb.ledgers.find((l) => l.name === "HDFC Bank")!.closing).toBe(1500);
    const ds = buildDataset({ ledgers: tb.ledgers, lines: p.lines });
    expect(dayBookReconciliation(ds, S).rows).toHaveLength(0);
    expect(incompleteMasters(ds, "customers_no_pan").rows).toHaveLength(0);
  });
});

describe("TallyDayBook.exe files", () => {
  /** A workbook laid out exactly as TallyDayBook.exe v6 save_to_excel() writes it. */
  function exeWorkbook() {
    const H = ["Voucher Date", "Voucher No", "Voucher Type", "Party Name", "Voucher Amount (₹)", "Narration", "Ledger Name", "Dr Amount (₹)", "Cr Amount (₹)", "Bill / Ref Name", "Reference Type", "Bill Amount (₹)", "Credit Period"];
    const rows = [
      // purchase with two bills on the party line: the EXE repeats Cr 11,800 on both bill rows
      ["05-Apr-2025", "P-7", "Purchase", "Sharma Traders", 11800, "Bill received", "Sharma Traders", "", 11800, "INV-55", "New Ref", 8000, "30 Days"],
      ["05-Apr-2025", "P-7", "Purchase", "Sharma Traders", 11800, "Bill received", "Sharma Traders", "", 11800, "ADV-2", "Agst Ref", 3800, ""],
      ["05-Apr-2025", "P-7", "Purchase", "Sharma Traders", 11800, "Bill received", "Input IGST", 1800, "", "", "", 0, ""],
      ["05-Apr-2025", "P-7", "Purchase", "Sharma Traders", 11800, "Bill received", "Purchase GST 18%", 10000, "", "", "", 0, ""],
      ["06-Apr-2025", "12", "Payment", "Sharma Traders", 8000, "", "Sharma Traders", 8000, "", "INV-55", "Agst Ref", 8000, ""],
      ["06-Apr-2025", "12", "Payment", "Sharma Traders", 8000, "", "HDFC Bank", "", 8000, "", "", 0, ""],
      // a second purchase with the same supplier bill number -> duplicate bill
      ["20-Apr-2025", "P-9", "Purchase", "Sharma Traders", 5000, "", "Sharma Traders", "", 5000, "INV-55", "New Ref", 5000, ""],
      ["20-Apr-2025", "P-9", "Purchase", "Sharma Traders", 5000, "", "Purchase GST 18%", 5000, "", "", "", 0, ""],
    ];
    const aoa = [["Day Book  |  01-Apr-2025  to  30-Apr-2025"], ["Vouchers: 3   |   Rows: 8   |   Types: Payment, Purchase"], [], H, ...rows,
      ["TOTAL  (₹)", "", "", "", 99999, "", "", 24800, 36600, "", "", "", ""]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Day Book");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Summary"], [], [], ["Voucher Type", "Count"], ["Purchase", 2]]), "Summary");
    return wb;
  }
  it("reads an EXE file: repeated Dr/Cr on bill rows is not double counted", () => {
    const p = parseDayBook(toBuf(exeWorkbook()));
    expect(p.format).toBe("tallydaybook-exe");
    expect(p.lines).toHaveLength(7);
    const party = p.lines.find((l) => l.voucherNo === "P-7" && l.ledger === "Sharma Traders")!;
    expect(party.amount).toBe(-11800);
    expect(party.bills!.map((b) => b.name)).toEqual(["INV-55", "ADV-2"]);
    expect(p.lines.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0)).toBe(24800);
    expect(p.lines.filter((l) => l.amount < 0).reduce((t, l) => t + l.amount, 0)).toBe(-24800);
    expect(p.warnings.join(" ")).toMatch(/overstated/);
    const ds = buildDataset({ lines: p.lines });
    // supplier bill INV-55 booked twice as "New Ref" -> same bill check uses the bill name
    const d = dupTxn(ds, S);
    expect(d.rows.filter((r) => r.match === "Same bill / reference").map((r) => r.vchNo).sort()).toEqual(["P-7", "P-9"]);
  });
  it("our TallyDayBook.exe-layout export reads back to the same lines", async () => {
    const p = parseDayBook(toBuf(exeWorkbook()));
    const ds = buildDataset({ lines: p.lines, from: "2025-04-01", to: "2025-04-30" });
    const { buffer, fileName } = await buildExeLayoutWorkbook(ds);
    expect(fileName).toBe("DayBook_01Apr2025_to_30Apr2025.xlsx");
    const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
    expect(wb.SheetNames).toEqual(["Day Book", "Summary"]);
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Day Book"], { header: 1, defval: "" });
    expect(aoa[3]).toEqual(["Voucher Date", "Voucher No", "Voucher Type", "Party Name", "Voucher Amount (₹)", "Narration", "Ledger Name", "Dr Amount (₹)", "Cr Amount (₹)", "Bill / Ref Name", "Reference Type", "Bill Amount (₹)", "Credit Period"]);
    const total = aoa[aoa.length - 1];
    expect(total[0]).toBe("TOTAL  (₹)");
    expect([total[4], total[7], total[8]]).toEqual([24800, 24800, 24800]);
    // second bill row carries no Dr/Cr
    const adv = aoa.find((r) => r[9] === "ADV-2")!;
    expect([adv[7], adv[8]]).toEqual(["", ""]);
    const q = parseDayBook(buffer);
    const key = (ls: typeof p.lines) => ls.map((l) => `${l.date}|${l.voucherNo}|${l.ledger}|${l.amount}|${(l.bills || []).map((b) => b.name).join(",")}`).sort();
    expect(key(q.lines)).toEqual(key(p.lines));
  });
});

describe("Tally fetch rules and dormant ledgers (T-024 follow-up)", () => {
  it("leaves out orders and post-dated vouchers, and flags a Day Book report that returned one day", async () => {
    const { _internal: T } = await import("../../../electron/ledger-analysis/tally-xml.cjs");
    const vch = (type: string, date: string, extra = "") => `<VOUCHER VCHTYPE="${type}"><DATE>${date}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>${extra}
      <ALLLEDGERENTRIES.LIST><LEDGERNAME>Sample Supplier</LEDGERNAME><AMOUNT>64900</AMOUNT></ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST><LEDGERNAME>Sample Machine Mould</LEDGERNAME><AMOUNT>-64900</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`;
    const xml = `<ENVELOPE>${vch("Local Purchase", "20260120")}${vch("Purchase Order", "20260103")}${vch("Payment", "20260125", "<ISPOSTDATED>Yes</ISPOSTDATED>")}</ENVELOPE>`;
    const stats: Record<string, unknown> = {};
    const lines = T.parseVouchers(xml, "2026-01-01", "2026-01-31", stats, new Map([["purchase order", "purchase order"]]));
    expect(new Set(lines.map((l: { voucherType: string }) => l.voucherType))).toEqual(new Set(["Local Purchase"]));
    expect(stats.skippedPostDated).toBe(1);
    expect(stats.skippedTypes).toEqual({ "Purchase Order": 1 });
  });

  it("dormant = nil opening, no transactions, nil closing; a carried balance is the separate unchanged check", () => {
    const L = (name: string, parent: string, opening: number, closing: number) => ({ name, parent, opening, closing, gstin: "", pan: "", gstRegistrationType: "", hasBalances: true });
    const ds = buildDataset({
      ledgers: [L("Cash", "Cash-in-Hand", 1000, 500), L("Rent", "Indirect Expenses", 0, 500), L("Old Supplier", "Sundry Creditors", -2000, -2000),
        L("Unused Bank", "Bank Accounts", 0, 0), L("Ghost", "Sundry Debtors", 0, 300), L("Profit & Loss A/c", "Primary", 0, -9000)],
      lines: [
        { voucherId: "V1", date: "2025-05-10", voucherType: "Payment", voucherNo: "1", reference: "", party: "", narration: "", partyGstin: "", group: "", primaryGroup: "", ledger: "Rent", amount: 500 },
        { voucherId: "V1", date: "2025-05-10", voucherType: "Payment", voucherNo: "1", reference: "", party: "", narration: "", partyGstin: "", group: "", primaryGroup: "", ledger: "Cash", amount: -500 },
      ],
    });
    expect(dormantLedgers(ds, S).rows.map((r) => r.ledger)).toEqual(["Unused Bank"]);
    const un = Object.fromEntries(unchangedBalances(ds, S).rows.map((r) => [r.ledger, r]));
    expect(Object.keys(un).sort()).toEqual(["Ghost", "Old Supplier"]);
    expect([un["Old Supplier"].opening, un["Old Supplier"].openSide, un["Old Supplier"].note]).toEqual([2000, "Cr", ""]);
    expect(un["Ghost"].note).toMatch(/check the day book/);
    const recon = dayBookReconciliation(ds, S);
    expect(recon.rows.map((r) => r.ledger)).toEqual(["Ghost"]);
    expect(recon.description).toMatch(/^4 of 5 ledgers agree/);
  });

  it("works from a trial balance alone (debit / credit totals) when no day book is loaded", () => {
    const L = (name: string, parent: string, opening: number, debit: number, credit: number, closing: number) =>
      ({ name, parent, opening, debit, credit, closing, gstin: "", pan: "", gstRegistrationType: "", hasBalances: true });
    const ds = buildDataset({ ledgers: [L("Rent", "Indirect Expenses", 0, 500, 0, 500), L("Old Supplier", "Sundry Creditors", -2000, 0, 0, -2000), L("Unused Bank", "Bank Accounts", 0, 0, 0, 0)] });
    expect(dormantLedgers(ds, S).rows.map((r) => r.ledger)).toEqual(["Unused Bank"]);
    expect(unchangedBalances(ds, S).rows.map((r) => r.ledger)).toEqual(["Old Supplier"]);
  });
});

describe("Unusual entries", () => {
  const ln = (id: string, date: string, type: string, no: string, party: string, ledger: string, amount: number, narration = "") =>
    ({ voucherId: id, date, voucherType: type, voucherNo: no, reference: "", party, narration, partyGstin: "", group: "", primaryGroup: "", ledger, amount });
  const L = (name: string, parent: string) => ({ name, parent, opening: 0, closing: 0, gstin: "", pan: "", gstRegistrationType: "", hasBalances: true });
  const ds = buildDataset({
    from: "2025-04-01", to: "2026-03-31",
    ledgers: [L("Cash", "Cash-in-Hand"), L("HDFC Bank", "Bank Accounts"), L("Repairs", "Indirect Expenses"), L("Rent", "Indirect Expenses"),
      L("Sales", "Sales Accounts"), L("Ravi Traders", "Sundry Debtors"), L("Om Loans", "Unsecured Loans"), L("Landlord", "Sundry Creditors"),
      L("A Ltd", "Sundry Creditors"), L("B Ltd", "Sundry Creditors"), L("Capital", "Capital Account")],
    lines: [
      // cash repairs 6,000 + 7,000 same day -> 13,000 > 10,000 (40A(3)); round 50,000 cash receipt from debtor < 2 lakh
      ln("P1", "2025-05-02", "Payment", "1", "", "Repairs", 6000), ln("P1", "2025-05-02", "Payment", "1", "", "Cash", -6000),
      ln("P2", "2025-05-02", "Payment", "2", "", "Repairs", 7000), ln("P2", "2025-05-02", "Payment", "2", "", "Cash", -7000),
      ln("R1", "2025-05-03", "Receipt", "1", "Ravi Traders", "Cash", 250000), ln("R1", "2025-05-03", "Receipt", "1", "Ravi Traders", "Ravi Traders", -250000),
      ln("R2", "2025-05-04", "Receipt", "2", "Om Loans", "Cash", 50000), ln("R2", "2025-05-04", "Receipt", "2", "Om Loans", "Om Loans", -50000),
      ln("C1", "2025-05-05", "Contra", "1", "", "HDFC Bank", 90000), ln("C1", "2025-05-05", "Contra", "1", "", "Cash", -90000),
      ln("D1", "2025-05-06", "Payment", "3", "", "Capital", 30000), ln("D1", "2025-05-06", "Payment", "3", "", "Cash", -30000),
      // rent 25,000 x 3 months via bank; same day 40,000 to A and B
      ...["2025-06-01", "2025-07-01", "2025-08-01"].flatMap((d, i) => [ln(`RT${i}`, d, "Payment", `R${i}`, "Landlord", "Landlord", 25000), ln(`RT${i}`, d, "Payment", `R${i}`, "Landlord", "HDFC Bank", -25000)]),
      ln("A1", "2025-09-10", "Payment", "9", "A Ltd", "A Ltd", 40000), ln("A1", "2025-09-10", "Payment", "9", "A Ltd", "HDFC Bank", -40000),
      ln("B1", "2025-09-10", "Payment", "10", "B Ltd", "B Ltd", 40000), ln("B1", "2025-09-10", "Payment", "10", "B Ltd", "HDFC Bank", -40000),
      // journal moving sales to a debtor, and a non-round one
      ln("J1", "2026-03-31", "Journal", "77", "", "Ravi Traders", 12345.5, "year-end"), ln("J1", "2026-03-31", "Journal", "77", "", "Sales", -12345.5, "year-end"),
    ],
  });

  it("round amounts: multiples of the unit at or above the minimum, voucher level", () => {
    const r = roundAmountEntries(ds, S);
    expect(r.rows.map((x) => x.vchNo).sort()).toEqual(["1", "1", "10", "2", "3", "9", "R0", "R1", "R2"].sort());
    expect(r.rows.find((x) => x.vchType === "Receipt" && x.vchNo === "1")!.cash).toBe("Cash");
    expect(r.rows.some((x) => x.vchNo === "77")).toBe(false);
  });

  it("same amount: party repeated N times, and same day across parties", () => {
    const r = repeatedAmounts(ds, S);
    const by = (m: string) => r.rows.filter((x) => x.match === m).map((x) => x.party);
    expect(by("Same party, same amount")).toEqual(["Landlord", "Landlord", "Landlord"]);
    expect(by("Same day, same amount, different parties").sort()).toEqual(["A Ltd", "B Ltd"]);
  });

  it("cash limits: 40A(3) per ledger per day, 269ST, 269SS; bank and capital left out", () => {
    const r = cashLimitBreaches(ds, S);
    const got = r.rows.map((x) => [String(x.rule).split(" ")[0], x.ledger, x.amount]);
    expect(got).toEqual([["269SS", "Om Loans", 50000], ["269ST", "Ravi Traders", 250000], ["40A(3)", "Repairs", 13000]]);
  });

  it("journals touching sales / purchase / cash / bank", () => {
    const r = unusualJournals(ds);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].flags).toBe("Sales");
  });
});

describe("Details panels and the round-off check", () => {
  const ln = (id: string, date: string, type: string, no: string, party: string, ledger: string, amount: number) =>
    ({ voucherId: id, date, voucherType: type, voucherNo: no, reference: "", party, narration: "", partyGstin: "", group: "", primaryGroup: "", ledger, amount });
  const L = (name: string, parent: string) => ({ name, parent, opening: 0, closing: 0, gstin: "", pan: "", gstRegistrationType: "", hasBalances: true });
  const bill = (id: string, date: string, supplier: string, head: string, amt: number, ro: number) => [
    ln(id, date, "Purchase", id, supplier, head, amt), ln(id, date, "Purchase", id, supplier, "ROUND OFF", ro), ln(id, date, "Purchase", id, supplier, supplier, -(amt + ro)),
  ];
  const ds = buildDataset({
    from: "2025-04-01", to: "2026-03-31",
    ledgers: [L("Packing", "Purchase Accounts"), L("Repairs", "Indirect Expenses"), L("ROUND OFF", "Indirect Expenses"), L("Box Co", "Sundry Creditors"), L("Fix Co", "Sundry Creditors")],
    lines: [
      ...bill("V1", "2025-04-10", "Box Co", "Packing", 10000, 0.4), ...bill("V2", "2025-05-10", "Box Co", "Packing", 12000, 0.3),
      ...bill("V3", "2025-06-10", "Fix Co", "Repairs", 5000, 0.2),
      ln("V4", "2025-07-10", "Purchase", "V4", "Fix Co", "Packing", 3000), ln("V4", "2025-07-10", "Purchase", "V4", "Fix Co", "ROUND OFF", 25), ln("V4", "2025-07-10", "Purchase", "V4", "Fix Co", "Fix Co", -3025),
    ],
  });
  const roKey = new Set(["round off"]);

  it("round off is counted as a head by default and can be ignored", () => {
    const all = creditorsMultipleExpenses(ds, S);
    expect(all.rows.map((r) => [r.creditor, r.heads])).toEqual([["Fix Co", 3], ["Box Co", 2]]);
    expect(all.rows.find((r) => r.creditor === "Box Co")!.mainHead).toBe("Packing");
    const ign = creditorsMultipleExpenses(ds, S, roKey);
    expect(ign.rows.map((r) => [r.creditor, r.heads])).toEqual([["Fix Co", 2]]); // Box Co was only Packing + round off
    expect(ign.description).toContain("Left out of the count: ROUND OFF");
  });

  it("round-off check totals every entry and lists those above the limit", () => {
    const r = roundOffCheck(ds, S);
    expect([r.entries, r.vouchers, r.debit, r.largest]).toEqual([4, 4, 25.9, 25]);
    expect(r.over.rows.map((x) => x.vchNo)).toEqual(["V4"]);
    expect(creditorHeadUsage(ds).map((h) => [h.head, h.creditors])).toEqual([["Packing", 2], ["ROUND OFF", 2], ["Repairs", 1]]);
  });

  it("creditor details: one row per head with share, and the expense lines", () => {
    const d = creditorDetails(ds, "Fix Co", roKey);
    expect(d.summary.rows.map((r) => [r.head, r.amount, r.vouchers])).toEqual([["Repairs", 5000, 1], ["Packing", 3000, 1], ["ROUND OFF", 25.2, 2]]);
    expect(d.summary.rows[0].pct).toBe(62.5); // 5,000 of 8,000 once round off is left out
    expect(d.summary.rows[2].note).toBe("Round off - left out of the count");
    expect(d.lines.rows).toHaveLength(4);
  });

  it("ledger month details and voucher group details", () => {
    const m = ledgerMonthDetails(ds, "Packing", S);
    expect(m.summary.rows).toHaveLength(12);
    expect(m.summary.rows.find((r) => r.month === "May-25")!.debit).toBe(12000);
    expect(m.lines.rows.filter((r) => r.month === "Apr-25")).toHaveLength(1);
    const g = voucherGroupDetails(ds, ["V1", "V2"], "Box Co");
    expect(g.summary.rows.map((r) => r.ledger)).toEqual(["Box Co", "Packing", "ROUND OFF"]);
    expect(g.lines.rows).toHaveLength(6);
  });
});
