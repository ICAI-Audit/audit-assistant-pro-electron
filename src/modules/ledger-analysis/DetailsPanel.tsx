// Ledger Analysis - side panel with the summary and the vouchers behind one result row.

import { useMemo, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResultTable } from "./ResultTable";
import { exportTables } from "./exportExcel";
import type { DetailView } from "./engine";
import type { Dataset } from "./types";

export function DetailsPanel({ ds, view, onClose }: { ds: Dataset; view: DetailView | null; onClose: () => void }) {
  const [pick, setPick] = useState<string | null>(null);

  const lines = useMemo(() => {
    if (!view || pick === null) return view?.lines || null;
    return { ...view.lines, title: `${view.lines.title} - ${pick}`, rows: view.lines.rows.filter((r) => String(r[view.pickKey] ?? "") === pick) };
  }, [view, pick]);

  const exportBoth = () => {
    if (!view) return;
    const safe = view.title.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
    exportTables(ds, [view.summary, view.lines], `${view.title} - ${view.subtitle}`, `details_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Sheet open={!!view} onOpenChange={(o) => { if (!o) { setPick(null); onClose(); } }}>
      <SheetContent side="right" className="w-[96vw] sm:max-w-[1100px] overflow-y-auto">
        {view && lines && (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="pr-8">{view.title}</SheetTitle>
              <SheetDescription>{view.subtitle}</SheetDescription>
            </SheetHeader>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={exportBoth}><FileSpreadsheet className="h-4 w-4 mr-2" />Export these details</Button>
            </div>
            <ResultTable key={`${view.title}-summary`} table={view.summary} maxHeight={340}
              onDetails={(r) => setPick(String(r._pick ?? ""))} detailsLabel="Show" />
            {pick !== null && (
              <div className="flex items-center gap-2 text-sm">
                Showing only <Badge variant="secondary">{pick}</Badge>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setPick(null)}><X className="h-3.5 w-3.5 mr-1" />Show all</Button>
              </div>
            )}
            <ResultTable key={`${view.title}-lines-${pick ?? "all"}`} table={lines} maxHeight={480} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
