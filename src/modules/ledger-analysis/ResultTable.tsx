import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Eye, FileSpreadsheet, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ResultTableData } from "./types";

const PAGE = 100;
const fmtAmt = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso);

type Row = ResultTableData["rows"][number];

export function ResultTable({ table, onExport, filterKey, onDetails, detailsLabel = "Details", maxHeight = 520 }: {
  table: ResultTableData; onExport?: () => void; filterKey?: string;
  /** Adds a button at the start of each row (e.g. open the Details panel for that row). */
  onDetails?: (row: Row) => void; detailsLabel?: string; maxHeight?: number;
}) {
  const cols = useMemo(() => table.columns.filter((c) => !c.exportOnly), [table]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [filterVal, setFilterVal] = useState("__all");

  const filterOptions = useMemo(() => {
    if (!filterKey) return [];
    return [...new Set(table.rows.map((r) => String(r[filterKey] ?? "")))].filter(Boolean).sort();
  }, [table, filterKey]);

  const rows = useMemo(() => {
    let rs = table.rows;
    if (filterKey && filterVal !== "__all") rs = rs.filter((r) => String(r[filterKey] ?? "") === filterVal);
    const t = q.trim().toLowerCase();
    if (t) rs = rs.filter((r) => cols.some((c) => String(r[c.key] ?? "").toLowerCase().includes(t)));
    if (sort) {
      const total = rs.filter((r) => r.ledger === "TOTAL");
      rs = rs.filter((r) => r.ledger !== "TOTAL").slice().sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
        return String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true }) * sort.dir;
      }).concat(total);
    }
    return rs;
  }, [table, cols, q, sort, filterKey, filterVal]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = rows.slice(p * PAGE, p * PAGE + PAGE);

  if (table.cannotRun) {
    return (
      <div className="space-y-2">
        <h3 className="font-semibold">{table.title}</h3>
        <Alert><Info className="h-4 w-4" /><AlertDescription>{table.cannotRun}</AlertDescription></Alert>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <h3 className="font-semibold">{table.title}</h3>
          <p className="text-xs text-muted-foreground">{table.description}</p>
        </div>
        {onExport && (
          <Button size="sm" variant="outline" onClick={onExport} disabled={!table.rows.length}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />Export to Excel
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search in this table..." value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        {filterKey && filterOptions.length > 1 && (
          <Select value={filterVal} onValueChange={(v) => { setFilterVal(v); setPage(0); }}>
            <SelectTrigger className="w-[230px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All ({table.rows.length})</SelectItem>
              {filterOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {rows.length.toLocaleString("en-IN")} row{rows.length === 1 ? "" : "s"}{rows.length !== table.rows.length ? ` of ${table.rows.length.toLocaleString("en-IN")}` : ""}
        </span>
      </div>
      {table.rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No findings - nothing matched this check.</div>
      ) : (
        <div className="border rounded-lg overflow-auto" style={{ maxHeight }}>
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                {onDetails && <th className="p-2 w-px" />}
                {cols.map((c) => (
                  <th key={c.key}
                    className={`p-2 font-medium whitespace-nowrap cursor-pointer select-none ${c.type === "amount" || c.type === "number" ? "text-right" : "text-left"}`}
                    onClick={() => setSort((s) => (s && s.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: c.type === "amount" || c.type === "number" ? -1 : 1 }))}>
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className={`border-t hover:bg-muted/50 ${r.ledger === "TOTAL" ? "font-semibold bg-muted/30" : ""}`}>
                  {onDetails && (
                    <td className="p-1 align-top">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onDetails(r)}><Eye className="h-3.5 w-3.5 mr-1" />{detailsLabel}</Button>
                    </td>
                  )}
                  {cols.map((c) => {
                    const v = r[c.key];
                    const isNum = c.type === "amount" || c.type === "number";
                    let text = v === null || v === undefined ? "" : String(v);
                    if (c.type === "amount" && typeof v === "number") text = v === 0 && r.ledger !== "TOTAL" ? "" : fmtAmt(v);
                    if (c.type === "date" && typeof v === "string") text = fmtDate(v);
                    return (
                      <td key={c.key} className={`p-2 align-top ${isNum ? "text-right font-mono text-xs whitespace-nowrap" : ""} ${c.type === "amount" && typeof v === "number" && v < 0 ? "text-destructive" : ""}`}
                        title={text.length > 60 ? text : undefined}>
                        {text.length > 140 ? text.slice(0, 140) + "..." : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={p === 0} onClick={() => setPage(p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span>Page {p + 1} of {pages}</span>
          <Button size="sm" variant="ghost" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );
}
