// VERA Tools > Ledger Analysis
// One screen that (1) loads accounting data from Tally (live), a Day Book Extractor workbook, Busy, Zoho
// or Excel, (2) runs the Ledger Analysis checks and (3) extracts the Day Book to Excel.
// Data stays in memory on this computer; nothing is saved to the database or sent anywhere.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, CheckCircle2, Copy, Database, FileSpreadsheet, FileWarning, Loader2, Moon, RefreshCw, Scale, Search,
  Settings2, SlidersHorizontal, Table as TableIcon, Trash2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useEngagement } from "@/contexts/EngagementContext";
import { ResultTable } from "./ResultTable";
import {
  buildDataset, DAYBOOK_FIELDS, parseDayBook, parseTrialBalance,
  type BuildInput, type DayBookColumnMap, type DayBookParse, type TBFormat, type TBParse,
} from "./importers";
import {
  creditorsMultipleExpenses, dayBookReconciliation, dayBookTable, dormantLedgers, duplicateLedgers, duplicateTransactions, findingCount,
  incompleteMasters, ledgerVolatility, negativeLedgers, outlierEntries, partiesWithoutMovement, runAllChecks, smallBalances,
  trialBalanceAsOn, trialBalanceMonthly, unchangedBalances,
  cashLimitBreaches, repeatedAmounts, roundAmountEntries, unusualJournals,
  creditorDetails, creditorHeadUsage, ledgerMonthDetails, roundOffCheck, voucherGroupDetails, type DetailView,
} from "./engine";
import { DetailsPanel } from "./DetailsPanel";
import { exportAll, exportDayBook, exportTable } from "./exportExcel";
import { fetchFromTally, tallyAvailable, type TallyFetchProgress } from "./tallyClient";
import { DEFAULT_SETTINGS, type AnalysisSettings, type Dataset, type ResultTableData } from "./types";

// Kept outside React so switching VERA Tools tabs does not lose the loaded data (memory only).
let cache: { ds: Dataset | null; settings: AnalysisSettings } = { ds: null, settings: DEFAULT_SETTINGS };

function defaultPeriod(fy?: string) {
  const m = /(20\d{2})/.exec(fy || "");
  let y: number;
  if (m) y = +m[1];
  else { const d = new Date(); y = d.getMonth() >= 3 ? d.getFullYear() - 1 : d.getFullYear() - 2; }
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

const fmtDate = (iso: string) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "-");

type SubItem = { key: string; label: string; table: ResultTableData; filterKey?: string };

function SubNav({ items, value, onChange }: { items: SubItem[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const n = findingCount(it.table);
        return (
          <Button key={it.key} size="sm" variant={value === it.key ? "default" : "outline"} onClick={() => onChange(it.key)} className="h-8">
            {it.label}
            <Badge variant={n ? "destructive" : "secondary"} className="ml-2 h-5 px-1.5 text-[10px]">{n === null ? "n/a" : n}</Badge>
          </Button>
        );
      })}
    </div>
  );
}

export default function LedgerAnalysisTool() {
  const { toast } = useToast();
  const { currentEngagement } = useEngagement();
  const period = defaultPeriod(currentEngagement?.financial_year);

  const [ds, setDs] = useState<Dataset | null>(cache.ds);
  const [settings, setSettings] = useState<AnalysisSettings>(cache.settings);
  useEffect(() => { cache = { ds, settings }; }, [ds, settings]);

  // source
  const [mode, setMode] = useState<"tally" | "files">(tallyAvailable() ? "tally" : "files");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("9000");
  const [company, setCompany] = useState("");
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [method, setMethod] = useState<"auto" | "report" | "collection">("auto");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TallyFetchProgress | null>(null);
  const [error, setError] = useState("");

  // files
  const [dbFile, setDbFile] = useState<File | null>(null);
  const [dbParse, setDbParse] = useState<DayBookParse | null>(null);
  const [dbMap, setDbMap] = useState<DayBookColumnMap | null>(null);
  const [dbDrNeg, setDbDrNeg] = useState(false);
  const [tbFile, setTbFile] = useState<File | null>(null);
  const [tbFormat, setTbFormat] = useState<TBFormat>("auto");
  const [tbDrNeg, setTbDrNeg] = useState(false);
  const [tbParse, setTbParse] = useState<TBParse | null>(null);
  const [mFile, setMFile] = useState<File | null>(null);
  const [mParse, setMParse] = useState<TBParse | null>(null);
  const dbRef = useRef<HTMLInputElement>(null);
  const tbRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);

  // views
  const [section, setSection] = useState("summary");
  const [tbView, setTbView] = useState("asOn");
  const [asOn, setAsOn] = useState("");
  const [negView, setNegView] = useState("assets_cr");
  const [mstView, setMstView] = useState("customers_no_gstin");
  const [unuView, setUnuView] = useState("debtors");
  const [dupView, setDupView] = useState("txn");
  const [dormView, setDormView] = useState("dormant");
  const [entView, setEntView] = useState("round");
  // creditors - multiple expense heads: round-off ledgers are counted until the user checks them and chooses to ignore
  const [ignoreRoundOff, setIgnoreRoundOff] = useState(false);
  const [headFilter, setHeadFilter] = useState<string | null>(null);
  const [showRoundOffOver, setShowRoundOffOver] = useState(false);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  /** Summary row -> its tab and sub-view (keys are the result table ids from engine.ts). */
  const openCheck = (id: string) => {
    const go = (sec: string, set?: (v: string) => void, view?: string) => {
      if (set && view) set(view);
      setSection(sec);
      requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    if (id === "recon") return go("tb", setTbView, "recon");
    if (id === "dormant" || id === "unchanged") return go("dormant", setDormView, id);
    if (id.startsWith("neg_")) return go("neg", setNegView, id.slice(4));
    if (id.startsWith("mst_")) return go("mst", setMstView, id.slice(4));
    const unu: Record<string, string> = {
      unu_debtors_static: "debtors", unu_creditors_static: "creditors", unu_small: "small",
      unu_creditor_expenses: "creditorExp", unu_sd_monthly: "sdMonthly", unu_sd_entries: "sdEntries",
    };
    if (unu[id]) return go("unu", setUnuView, unu[id]);
    if (id === "dup_txn") return go("dup", setDupView, "txn");
    if (id === "dup_ledgers") return go("dup", setDupView, "ledgers");
    const ent: Record<string, string> = { ent_round: "round", ent_repeat: "repeat", ent_cash: "cash", ent_journal: "journal" };
    if (ent[id]) return go("ent", setEntView, ent[id]);
  };

  // ── loading ──
  const doTally = async () => {
    setError(""); setBusy(true); setProgress(null);
    try {
      const inp = await fetchFromTally({ host, port, company, from, to, includeDayBook: true, method }, setProgress);
      const d = buildDataset(inp);
      setDs(d); setAsOn(d.to); setSection("summary");
      toast({ title: "Fetched from Tally", description: `${d.ledgers.length} ledgers, ${new Set(d.lines.map((l) => l.voucherId)).size} vouchers` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); setProgress(null); }
  };

  const readDayBook = async (f: File, map?: DayBookColumnMap, drNeg?: boolean) => {
    const p = parseDayBook(await f.arrayBuffer(), { columns: map, drNegative: drNeg });
    setDbParse(p); setDbMap(p.columns);
    if (drNeg === undefined) setDbDrNeg(p.format === "daybook-extractor");
    return p;
  };

  const onPickDayBook = async (f: File | null) => {
    setError(""); setDbFile(f); setDbParse(null);
    if (!f) return;
    try { await readDayBook(f); } catch (e) { setError(`Day book: ${e instanceof Error ? e.message : e}`); }
  };
  const onPickTB = async (f: File | null, fmt = tbFormat, neg = tbDrNeg) => {
    setError(""); setTbFile(f); setTbParse(null);
    if (!f) return;
    try { setTbParse(parseTrialBalance(await f.arrayBuffer(), fmt, neg)); } catch (e) { setError(`Trial balance: ${e instanceof Error ? e.message : e}`); }
  };
  const onPickMasters = async (f: File | null) => {
    setError(""); setMFile(f); setMParse(null);
    if (!f) return;
    try { setMParse(parseTrialBalance(await f.arrayBuffer(), "generic", false)); } catch (e) { setError(`Ledger masters: ${e instanceof Error ? e.message : e}`); }
  };

  const doFiles = () => {
    setError("");
    if (!dbParse && !tbParse) { setError("Choose a day book file and/or a trial balance file first."); return; }
    const inp: BuildInput = {
      company: tbParse?.company || dbParse?.company || currentEngagement?.client_name || "",
      from: tbParse?.from || undefined, to: tbParse?.to || undefined,
      ledgers: tbParse?.ledgers?.length ? tbParse.ledgers : dbParse?.ledgers || [],
      masters: [...(tbParse && dbParse?.ledgers?.length ? dbParse.ledgers : []), ...(mParse?.ledgers || [])],
      groups: dbParse?.groups || [],
      lines: dbParse?.lines || [],
      sources: [dbFile && `Day book: ${dbFile.name}`, tbFile && `TB (${tbParse?.format}): ${tbFile.name}`, mFile && `Masters: ${mFile.name}`].filter(Boolean) as string[],
      warnings: [...(dbParse?.warnings || []), ...(tbParse?.warnings || [])],
    };
    const d = buildDataset(inp);
    setDs(d); setAsOn(d.to); setSection("summary");
    toast({ title: "Data loaded", description: `${d.ledgers.length} ledgers, ${d.lines.length} day book lines` });
  };

  const clearAll = () => {
    setDs(null); setDbFile(null); setDbParse(null); setTbFile(null); setTbParse(null); setMFile(null); setMParse(null); setError("");
    [dbRef, tbRef, mRef].forEach((r) => { if (r.current) r.current.value = ""; });
  };

  // ── results ──
  const roundOff = useMemo(() => (ds ? roundOffCheck(ds, settings) : null), [ds, settings]);
  const ignoreSet = useMemo(() => new Set(ignoreRoundOff && roundOff ? roundOff.ledgers.map((l) => l.key) : []), [ignoreRoundOff, roundOff]);
  const headUsage = useMemo(() => (ds ? creditorHeadUsage(ds) : []), [ds]);

  const R = useMemo(() => {
    if (!ds) return null;
    const s = settings;
    const creditorExp = creditorsMultipleExpenses(ds, s, ignoreSet);
    return {
      // the Summary shows the creditor check as the user set it up (round off counted or ignored)
      all: runAllChecks(ds, s).map((c) => (c.table.id === creditorExp.id ? { ...c, table: creditorExp } : c)),
      tb: {
        asOn: trialBalanceAsOn(ds, asOn || ds.to),
        monthClosing: trialBalanceMonthly(ds, "closing"),
        monthMovement: trialBalanceMonthly(ds, "movement"),
        recon: dayBookReconciliation(ds, s),
      },
      dormant: { dormant: dormantLedgers(ds, s), unchanged: unchangedBalances(ds, s) },
      neg: {
        assets_cr: negativeLedgers(ds, "assets_cr", s), income_dr: negativeLedgers(ds, "income_dr", s),
        expense_cr: negativeLedgers(ds, "expense_cr", s), liabilities_dr: negativeLedgers(ds, "liabilities_dr", s),
      },
      mst: {
        customers_no_gstin: incompleteMasters(ds, "customers_no_gstin"), customers_no_pan: incompleteMasters(ds, "customers_no_pan"),
        suppliers_no_gstin: incompleteMasters(ds, "suppliers_no_gstin"), suppliers_no_pan: incompleteMasters(ds, "suppliers_no_pan"),
      },
      unu: {
        debtors: partiesWithoutMovement(ds, "Debtor", s), creditors: partiesWithoutMovement(ds, "Creditor", s),
        small: smallBalances(ds, s), creditorExp,
        sdMonthly: ledgerVolatility(ds, s), sdEntries: outlierEntries(ds, s),
      },
      dup: { txn: duplicateTransactions(ds, s), ledgers: duplicateLedgers(ds, s) },
      ent: { round: roundAmountEntries(ds, s), repeat: repeatedAmounts(ds, s), cash: cashLimitBreaches(ds, s), journal: unusualJournals(ds) },
      daybook: dayBookTable(ds),
    };
  }, [ds, settings, asOn, ignoreSet]);

  const ex = (t: ResultTableData) => () => ds && exportTable(ds, t);
  const inrFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  /** Creditors table narrowed to suppliers that used the chosen expense head. */
  const creditorTable = useMemo(() => {
    if (!R) return null;
    const t = R.unu.creditorExp;
    if (!headFilter) return t;
    return { ...t, rows: t.rows.filter((r) => String(r._heads ?? "").split("|").includes(headFilter)) };
  }, [R, headFilter]);

  const roundOffPanel = roundOff && (
    <div className={`rounded-lg border p-3 text-sm space-y-2 ${roundOff.over.rows.length ? "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20" : "bg-muted/30"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Round-off check</div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Limit per entry (₹)</Label>
          <Input type="number" min={0} step={1} className="h-8 w-24" value={settings.roundOffLimit}
            onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) setSettings({ ...settings, roundOffLimit: v }); }} />
        </div>
      </div>
      {roundOff.entries === 0 ? (
        <p className="text-muted-foreground">No round-off ledger is used in the day book{roundOff.ledgers.length ? ` (${roundOff.ledgers.map((l) => l.name).join(", ")})` : ""}.</p>
      ) : (
        <>
          <p>
            <b>{roundOff.ledgers.map((l) => l.name).join(", ")}</b>: {roundOff.entries.toLocaleString("en-IN")} entries in {roundOff.vouchers.toLocaleString("en-IN")} vouchers -
            debit ₹{inrFmt(roundOff.debit)}, credit ₹{inrFmt(roundOff.credit)}, largest single entry ₹{inrFmt(roundOff.largest)}.
          </p>
          {roundOff.over.rows.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span><b>{roundOff.over.rows.length}</b> entr{roundOff.over.rows.length === 1 ? "y is" : "ies are"} above ₹{inrFmt(settings.roundOffLimit)} - round off may be used to plug differences.</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setShowRoundOffOver((v) => !v)}>{showRoundOffOver ? "Hide" : "View"} them</Button>
            </div>
          ) : (
            <p className="text-green-700 dark:text-green-400"><CheckCircle2 className="inline h-4 w-4 mr-1" />Every round-off entry is within ₹{inrFmt(settings.roundOffLimit)}.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {ignoreRoundOff ? (
              <>
                <Badge variant="secondary">Round off is left out of the expense-head count</Badge>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setIgnoreRoundOff(false)}>Count it again</Button>
              </>
            ) : (
              <Button size="sm" variant={roundOff.over.rows.length ? "outline" : "default"} className="h-7" onClick={() => setIgnoreRoundOff(true)}>
                Ignore round off in this check{roundOff.over.rows.length ? " anyway" : ""}
              </Button>
            )}
          </div>
          {showRoundOffOver && roundOff.over.rows.length > 0 && <ResultTable table={roundOff.over} onExport={ex(roundOff.over)} maxHeight={320} />}
        </>
      )}
    </div>
  );

  const headChips = headUsage.length > 0 && (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">Expense heads most used with suppliers - click one to see only the creditors that used it:</div>
      <div className="flex flex-wrap gap-1.5">
        {headUsage.slice(0, 12).map((h) => (
          <Button key={h.key} size="sm" variant={headFilter === h.key ? "default" : "outline"} className="h-7 text-xs"
            onClick={() => setHeadFilter(headFilter === h.key ? null : h.key)}
            title={`₹${inrFmt(h.amount)} booked`}>
            {h.head} <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{h.creditors}</Badge>
          </Button>
        ))}
        {headFilter && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setHeadFilter(null)}>Clear</Button>}
      </div>
    </div>
  );
  const vouchers = useMemo(() => (ds ? new Set(ds.lines.map((l) => l.voucherId)).size : 0), [ds]);

  // ── UI pieces ──
  const filePicker = (label: string, hint: string, file: File | null, ref: React.RefObject<HTMLInputElement>, onPick: (f: File | null) => void) => (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => ref.current?.click()}><Upload className="h-4 w-4 mr-2" />Choose file</Button>
        <span className="text-xs text-muted-foreground truncate max-w-[260px]">{file ? file.name : "No file"}</span>
        {file && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { onPick(null); if (ref.current) ref.current.value = ""; }}><Trash2 className="h-3.5 w-3.5" /></Button>}
        <input ref={ref} type="file" accept=".xlsx,.xls,.xlsm,.csv" className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  const settingsPopover = (
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="outline"><SlidersHorizontal className="h-4 w-4 mr-2" />Settings</Button></PopoverTrigger>
      <PopoverContent className="w-96 space-y-3 max-h-[70vh] overflow-y-auto">
        <p className="text-sm font-medium">Check limits</p>
        {([
          ["smallBalanceLimit", "Small balance below (₹)", 1],
          ["sdMultiplier", "Outlier = more than N standard deviations", 0.5],
          ["duplicateWindowDays", "Near-duplicate window (days)", 1],
          ["minExpenseHeads", "Creditor flagged at N or more expense heads", 1],
          ["fuzzyThreshold", "Similar ledger names at (0.80 - 0.99)", 0.01],
          ["tolerance", "Ignore differences up to (₹)", 1],
          ["roundMinAmount", "Round entries: from amount (₹)", 1000],
          ["roundUnit", "Round entries: multiple of (₹)", 100],
          ["repeatMinCount", "Same amount: flag at N vouchers", 1],
          ["repeatMinAmount", "Same amount: from amount (₹)", 1000],
          ["cash40A3Limit", "40A(3) cash payment above (₹)", 1000],
          ["cash269STLimit", "269ST cash receipt from (₹)", 1000],
          ["cashLoanLimit", "269SS / 269T loan in cash from (₹)", 1000],
        ] as [keyof AnalysisSettings, string, number][]).map(([k, label, step]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <Label className="text-xs">{label}</Label>
            <Input type="number" step={step} className="w-24 h-8" value={settings[k]}
              onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) setSettings({ ...settings, [k]: v }); }} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset to defaults</Button>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="space-y-6">
      {/* ── Data source ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4 text-primary" />Ledger Analysis - load data</CardTitle>
              <CardDescription>Tally (live), Day Book Extractor workbook, Busy, Zoho or Excel. Data stays in memory on this computer and is not saved to the engagement.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={mode === "tally" ? "default" : "outline"} onClick={() => setMode("tally")}>Tally (live)</Button>
              <Button size="sm" variant={mode === "files" ? "default" : "outline"} onClick={() => setMode("files")}>Excel / Busy / Zoho files</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "tally" ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-6">
                <div><Label className="text-xs">Host</Label><Input className="h-9" value={host} onChange={(e) => setHost(e.target.value)} /></div>
                <div><Label className="text-xs">Port</Label><Input className="h-9" value={port} onChange={(e) => setPort(e.target.value)} /></div>
                <div><Label className="text-xs">Company (optional)</Label><Input className="h-9" placeholder="Active company" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
                <div><Label className="text-xs">From</Label><Input className="h-9" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div><Label className="text-xs">To</Label><Input className="h-9" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
                <div>
                  <Label className="text-xs">Day book method</Label>
                  <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (voucher collection, report if it fails)</SelectItem>
                      <SelectItem value="collection">Voucher collection</SelectItem>
                      <SelectItem value="report">Day Book report (as TallyDayBook.exe - may return one day only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={doTally} disabled={busy || !tallyAvailable()}>
                  {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Fetch masters + day book from Tally
                </Button>
                <span className="text-xs text-muted-foreground">Tally must be open with the company loaded and its server enabled on this port (same as the Financial Statement Review import). Read-only - nothing is written to Tally.</span>
              </div>
              {busy && progress && (
                <div className="space-y-1">
                  <Progress value={progress.total ? (progress.done / progress.total) * 100 : 5} />
                  <p className="text-xs text-muted-foreground">{progress.step === "daybook" ? `Day book: ${progress.label} (${progress.done}/${progress.total} months${progress.rows ? `, ${progress.rows.toLocaleString("en-IN")} lines so far` : ""})` : progress.label}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="space-y-2">
                {filePicker("1. Day Book (vouchers)", "Day Book Extractor workbook (odbcdaybook + Ledgers), a TallyDayBook.exe file (DayBook_..._to_....xlsx), or any day book / journal / GL export with Date, Ledger and Debit/Credit columns.", dbFile, dbRef, onPickDayBook)}
                {dbParse && (
                  <div className="text-xs space-y-1 rounded border p-2 bg-muted/30">
                    <div><CheckCircle2 className="inline h-3.5 w-3.5 text-green-600 mr-1" />{dbParse.format === "daybook-extractor" ? "Day Book Extractor format" : dbParse.format === "tallydaybook-exe" ? "TallyDayBook.exe format (with bill-wise details)" : "Columns detected"} - sheet "{dbParse.sheet}", {dbParse.lines.length.toLocaleString("en-IN")} lines{dbParse.ledgers.length ? `, ${dbParse.ledgers.length} ledgers in its Ledgers sheet` : ""}</div>
                    <details>
                      <summary className="cursor-pointer text-primary">Check / change column mapping</summary>
                      <div className="grid grid-cols-2 gap-1 mt-2">
                        {DAYBOOK_FIELDS.map((f) => (
                          <div key={f.key} className="flex items-center gap-1">
                            <span className="w-28 shrink-0">{f.label}</span>
                            <select className="border rounded h-7 px-1 bg-background w-full" value={dbMap?.[f.key] ?? ""}
                              onChange={(e) => setDbMap({ ...(dbMap || {}), [f.key]: e.target.value === "" ? undefined : +e.target.value })}>
                              <option value="">-</option>
                              {dbParse.headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 mt-2">
                        <Checkbox checked={dbDrNeg} onCheckedChange={(v) => setDbDrNeg(!!v)} />
                        Signed Amount column: negative = debit (Tally convention)
                      </label>
                      <Button size="sm" variant="secondary" className="mt-2 h-7" onClick={async () => {
                        if (!dbFile) return;
                        try { await readDayBook(dbFile, dbMap || undefined, dbDrNeg); setError(""); } catch (e) { setError(`Day book: ${e instanceof Error ? e.message : e}`); }
                      }}>Re-read with this mapping</Button>
                    </details>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {filePicker("2. Trial Balance (optional with a Day Book Extractor file)", "Gives opening balances and groups. Busy and Zoho TB exports are read with the same parsers as Financial Statement Review.", tbFile, tbRef, (f) => onPickTB(f))}
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={tbFormat} onValueChange={(v) => { setTbFormat(v as TBFormat); if (tbFile) onPickTB(tbFile, v as TBFormat); }}>
                    <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Detect format</SelectItem>
                      <SelectItem value="daybook-extractor">Day Book Extractor (Ledgers sheet)</SelectItem>
                      <SelectItem value="vera-tally">VERA "Get Trial Balance from Tally" export</SelectItem>
                      <SelectItem value="busy">Busy Trial Balance</SelectItem>
                      <SelectItem value="zoho">Zoho Books Trial Balance</SelectItem>
                      <SelectItem value="generic">Excel (Ledger, Group, Opening, Debit, Credit, Closing)</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox checked={tbDrNeg} onCheckedChange={(v) => { setTbDrNeg(!!v); if (tbFile) onPickTB(tbFile, tbFormat, !!v); }} />
                    Excel: negative = debit
                  </label>
                </div>
                {tbParse && <div className="text-xs rounded border p-2 bg-muted/30"><CheckCircle2 className="inline h-3.5 w-3.5 text-green-600 mr-1" />{tbParse.format} - {tbParse.ledgers.length} ledgers{tbParse.company ? `, ${tbParse.company}` : ""}{tbParse.from ? `, ${fmtDate(tbParse.from)} to ${fmtDate(tbParse.to)}` : ""}</div>}
              </div>
              <div className="space-y-2">
                {filePicker("3. Ledger masters (optional)", "Any sheet with Ledger name and GSTIN / PAN / Group columns - fills GSTIN and PAN for the Incomplete Masters checks.", mFile, mRef, onPickMasters)}
                {mParse && <div className="text-xs rounded border p-2 bg-muted/30"><CheckCircle2 className="inline h-3.5 w-3.5 text-green-600 mr-1" />{mParse.ledgers.length} ledgers, {mParse.ledgers.filter((l) => l.gstin).length} with GSTIN, {mParse.ledgers.filter((l) => l.pan).length} with PAN</div>}
                <Button onClick={doFiles} disabled={!dbParse && !tbParse} className="mt-2"><Scale className="h-4 w-4 mr-2" />Analyse these files</Button>
              </div>
            </div>
          )}
          {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription></Alert>}
        </CardContent>
      </Card>

      {/* ── Loaded data ── */}
      {ds && R && (
        <>
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span><b>{ds.company || "Company"}</b></span>
                  <span>Period: {fmtDate(ds.from)} to {fmtDate(ds.to)}</span>
                  <span>{ds.ledgers.length.toLocaleString("en-IN")} ledgers</span>
                  <span>{vouchers.toLocaleString("en-IN")} vouchers / {ds.lines.length.toLocaleString("en-IN")} lines</span>
                  <span className="text-muted-foreground">{ds.sources.join(" · ")}</span>
                </div>
                <div className="flex gap-2">
                  {settingsPopover}
                  <Button size="sm" onClick={() => exportAll(ds, R.all, [R.tb.asOn])}><FileSpreadsheet className="h-4 w-4 mr-2" />Export all findings</Button>
                  <Button size="sm" variant="ghost" onClick={clearAll}><Trash2 className="h-4 w-4 mr-2" />Clear</Button>
                </div>
              </div>
              {ds.warnings.length > 0 && (
                <Alert><FileWarning className="h-4 w-4" /><AlertDescription><ul className="list-disc pl-4 text-xs space-y-0.5">{ds.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></AlertDescription></Alert>
              )}
            </CardContent>
          </Card>

          <div ref={tabsRef} className="scroll-mt-4" />
          <Tabs value={section} onValueChange={setSection} className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
              <TabsTrigger value="summary" className="gap-2"><Settings2 className="h-4 w-4" />Summary</TabsTrigger>
              <TabsTrigger value="tb" className="gap-2"><Scale className="h-4 w-4" />Trial Balance</TabsTrigger>
              <TabsTrigger value="dormant" className="gap-2"><Moon className="h-4 w-4" />Dormant Ledgers</TabsTrigger>
              <TabsTrigger value="neg" className="gap-2"><AlertTriangle className="h-4 w-4" />Negative Ledgers</TabsTrigger>
              <TabsTrigger value="mst" className="gap-2"><FileWarning className="h-4 w-4" />Incomplete Masters</TabsTrigger>
              <TabsTrigger value="unu" className="gap-2"><TableIcon className="h-4 w-4" />Unusual Balances</TabsTrigger>
              <TabsTrigger value="dup" className="gap-2"><Copy className="h-4 w-4" />Duplicates</TabsTrigger>
              <TabsTrigger value="ent" className="gap-2"><Search className="h-4 w-4" />Unusual Entries</TabsTrigger>
              <TabsTrigger value="daybook" className="gap-2"><BookOpen className="h-4 w-4" />Day Book Extractor</TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              <Card><CardContent className="pt-5">
                <table className="w-full text-sm">
                  <thead className="bg-muted"><tr><th className="text-left p-2">Section</th><th className="text-left p-2">Check</th><th className="text-right p-2">Findings</th><th className="text-left p-2">Note</th></tr></thead>
                  <tbody>
                    {R.all.map(({ section: sec, table }, i) => {
                      const n = findingCount(table);
                      return (
                        <tr key={i} className="border-t cursor-pointer hover:bg-muted/50" title="Open the details"
                          onClick={() => openCheck(table.id)}>
                          <td className="p-2 text-muted-foreground">{sec}</td>
                          <td className="p-2 text-primary hover:underline">{table.title}</td>
                          <td className="p-2 text-right">{n === null ? <Badge variant="secondary">not run</Badge> : n ? <Badge variant="destructive">{n}</Badge> : <Badge variant="outline">0</Badge>}</td>
                          <td className="p-2 text-xs text-muted-foreground">{table.cannotRun || ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="tb">
              <Card><CardContent className="pt-5 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <SubNav value={tbView} onChange={setTbView} items={[
                    { key: "asOn", label: "TB on a given date", table: R.tb.asOn },
                    { key: "monthClosing", label: "Month over month - balances", table: R.tb.monthClosing },
                    { key: "monthMovement", label: "Month over month - movement", table: R.tb.monthMovement },
                    { key: "recon", label: "Day book vs TB", table: R.tb.recon },
                  ]} />
                  {tbView === "asOn" && (
                    <div className="flex items-center gap-2 ml-auto">
                      <Label className="text-xs">As on</Label>
                      <Input type="date" className="h-8 w-40" value={asOn || ds.to} min={ds.from} max={ds.to} onChange={(e) => setAsOn(e.target.value)} />
                    </div>
                  )}
                </div>
                {(() => { const t = R.tb[tbView as keyof typeof R.tb]; return <ResultTable key={t.id + asOn} table={t} onExport={ex(t)} />; })()}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="dormant">
              <Card><CardContent className="pt-5 space-y-4">
                <SubNav value={dormView} onChange={setDormView} items={[
                  { key: "dormant", label: "Dormant - nil balance, no transactions", table: R.dormant.dormant },
                  { key: "unchanged", label: "Same opening & closing, no transactions", table: R.dormant.unchanged },
                ]} />
                {(() => { const t = R.dormant[dormView as keyof typeof R.dormant]; return <ResultTable key={t.id} table={t} onExport={ex(t)} filterKey="primary" />; })()}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="neg">
              <Card><CardContent className="pt-5 space-y-4">
                <SubNav value={negView} onChange={setNegView} items={[
                  { key: "assets_cr", label: "Assets with credit balance", table: R.neg.assets_cr },
                  { key: "income_dr", label: "Income with debit balance", table: R.neg.income_dr },
                  { key: "expense_cr", label: "Expense with credit balance", table: R.neg.expense_cr },
                  { key: "liabilities_dr", label: "Liabilities with debit balance", table: R.neg.liabilities_dr },
                ]} />
                {(() => { const t = R.neg[negView as keyof typeof R.neg]; return <ResultTable key={t.id} table={t} onExport={ex(t)} filterKey="reserved" />; })()}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="mst">
              <Card><CardContent className="pt-5 space-y-4">
                <SubNav value={mstView} onChange={setMstView} items={[
                  { key: "customers_no_gstin", label: "Customers without GST number", table: R.mst.customers_no_gstin },
                  { key: "customers_no_pan", label: "Customers without PAN", table: R.mst.customers_no_pan },
                  { key: "suppliers_no_gstin", label: "Suppliers without GST number", table: R.mst.suppliers_no_gstin },
                  { key: "suppliers_no_pan", label: "Suppliers without PAN", table: R.mst.suppliers_no_pan },
                ]} />
                {(() => { const t = R.mst[mstView as keyof typeof R.mst]; return <ResultTable key={t.id} table={t} onExport={ex(t)} filterKey="issue" />; })()}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="unu">
              <Card><CardContent className="pt-5 space-y-4">
                <SubNav value={unuView} onChange={setUnuView} items={[
                  { key: "debtors", label: "Debtors - no movement", table: R.unu.debtors },
                  { key: "creditors", label: "Creditors - no movement", table: R.unu.creditors },
                  { key: "small", label: "Small balances", table: R.unu.small },
                  { key: "creditorExp", label: "Creditors - multiple expense heads", table: R.unu.creditorExp },
                  { key: "sdMonthly", label: "Std deviation - months", table: R.unu.sdMonthly },
                  { key: "sdEntries", label: "Std deviation - entries", table: R.unu.sdEntries },
                ]} />
                {unuView === "creditorExp" && creditorTable ? (
                  <div className="space-y-4">
                    {roundOffPanel}
                    {headChips}
                    <ResultTable key={`${creditorTable.id}-${headFilter ?? ""}-${ignoreRoundOff}`} table={creditorTable} onExport={ex(creditorTable)}
                      onDetails={(r) => setDetail(creditorDetails(ds, String(r.creditor), ignoreSet))} />
                  </div>
                ) : (() => {
                  const t = R.unu[unuView as keyof typeof R.unu];
                  return <ResultTable key={t.id} table={t} onExport={ex(t)} filterKey={unuView === "small" ? "partyType" : unuView === "sdMonthly" ? "nature" : undefined}
                    onDetails={unuView === "sdMonthly" ? (r) => setDetail(ledgerMonthDetails(ds, String(r.ledger), settings)) : undefined} />;
                })()}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="dup">
              <Card><CardContent className="pt-5 space-y-4">
                <SubNav value={dupView} onChange={setDupView} items={[
                  { key: "txn", label: "Duplicate transactions", table: R.dup.txn },
                  { key: "ledgers", label: "Duplicate ledgers", table: R.dup.ledgers },
                ]} />
                {(() => { const t = R.dup[dupView as keyof typeof R.dup]; return <ResultTable key={t.id} table={t} onExport={ex(t)} filterKey="match" />; })()}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="ent">
              <Card><CardContent className="pt-5 space-y-4">
                <SubNav value={entView} onChange={setEntView} items={[
                  { key: "round", label: "Round-amount entries", table: R.ent.round },
                  { key: "repeat", label: "Same amount repeated", table: R.ent.repeat },
                  { key: "cash", label: "Cash over tax limits", table: R.ent.cash },
                  { key: "journal", label: "Journals on cash / bank / sales / purchase", table: R.ent.journal },
                ]} />
                {(() => {
                  const t = R.ent[entView as keyof typeof R.ent];
                  const fk = entView === "round" ? "vchType" : entView === "repeat" ? "match" : entView === "cash" ? "rule" : "flags";
                  return <ResultTable key={t.id} table={t} onExport={ex(t)} filterKey={fk}
                    onDetails={entView === "repeat"
                      ? (r) => setDetail(voucherGroupDetails(ds, String(r._vids ?? "").split("|").filter(Boolean), `${r.party} - ₹${inrFmt(Number(r.amount))} (${r.match})`))
                      : undefined} />;
                })()}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="daybook">
              <Card><CardContent className="pt-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={!ds.lines.length} onClick={() => { void exportDayBook(ds, "standard"); }}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel extract of Day Book</Button>
                  <Button size="sm" variant="outline" disabled={!ds.lines.length} onClick={() => { exportDayBook(ds, "exe").catch((e) => setError(`Export: ${e instanceof Error ? e.message : e}`)); }}><FileSpreadsheet className="h-4 w-4 mr-2" />TallyDayBook.exe layout</Button>
                  <Button size="sm" variant="outline" disabled={!ds.lines.length} onClick={() => { void exportDayBook(ds, "extractor"); }}><FileSpreadsheet className="h-4 w-4 mr-2" />Day Book Extractor format (odbcdaybook)</Button>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div><b>Excel extract</b>: Day Book (with voucher amount and bill-wise columns), Vouchers, Ledgers, Bill-wise and Summary by voucher type.</div>
                  <div><b>TallyDayBook.exe layout</b>: the same 13 columns, colours, TOTAL row and Summary sheet as your EXE (DayBook_01Apr2025_to_31Mar2026.xlsx). A line with several bills shows its Dr/Cr once, so totals are not overstated.</div>
                  <div><b>Day Book Extractor format</b>: $-column sheet + Ledgers with Tally signs, for the Day Book audit tool.</div>
                </div>
                <ResultTable key="daybook" table={R.daybook} />
              </CardContent></Card>
            </TabsContent>
          </Tabs>
          <DetailsPanel ds={ds} view={detail} onClose={() => setDetail(null)} />
        </>
      )}
    </div>
  );
}
