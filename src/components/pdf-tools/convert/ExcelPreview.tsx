// The PDF to Excel dialog's preview (contract decision 10): a plain grid of what one page puts on its sheet,
// at most 30 rows by 12 columns, numbers right-aligned as Excel shows them, with Previous and Next page.
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { kindNote, previewCut } from './excelForm';
import type { PreviewState } from './useExcelPreview';

/** A, B, … Z, AA, …: the sheet's column letters. */
function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export default function ExcelPreview({ state, onShow }: { state: PreviewState; onShow: (pageIndex: number) => void }) {
  if (state.status === 'reading') {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-6 text-sm text-muted-foreground" role="status" data-testid="pdf-tools-excel-preview" data-status="reading">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {state.checked === 0 ? 'Reading the file for the preview…' : `Looking for text: page ${state.checked + 1} of ${state.pageCount}…`}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <p className="rounded-md border bg-muted/30 px-3 py-4 text-sm text-muted-foreground" data-testid="pdf-tools-excel-preview" data-status="error">
        {state.message}
      </p>
    );
  }
  if (state.status === 'scanned') return null; // the dialog says why Run waits

  const { grid, pageIndex, pageCount, loading } = state;
  const cut = previewCut(grid);
  const width = grid.cells.reduce((n, row) => Math.max(n, row.length), 0);
  return (
    <section className="space-y-2" aria-label="Preview" data-testid="pdf-tools-excel-preview" data-status="ready" data-page={pageIndex + 1}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium leading-none">Preview</p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            aria-label="Previous page"
            data-testid="pdf-tools-excel-preview-previous"
            disabled={pageIndex === 0}
            onClick={() => onShow(pageIndex - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="min-w-[6.5rem] text-center text-xs tabular-nums text-muted-foreground" aria-live="polite" data-testid="pdf-tools-excel-preview-page">
            {loading ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" aria-label="Reading the page" /> : `Page ${pageIndex + 1} of ${pageCount}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            aria-label="Next page"
            data-testid="pdf-tools-excel-preview-next"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onShow(pageIndex + 1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="pdf-tools-excel-preview-kind">
        {kindNote(grid.kind)}
      </p>
      {grid.cells.length > 0 && (
        // Lower on a small laptop screen (1280 x 720), so the "Sheets" choice under it is in view without scrolling.
        <div className={cn('max-h-[min(300px,28vh)] overflow-auto rounded-md border bg-card', loading && 'opacity-60')}>
          <table className="w-max min-w-full border-collapse text-xs" data-testid="pdf-tools-excel-preview-grid">
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 z-10 border-b border-r bg-muted px-1.5 py-1 text-[11px] font-normal text-muted-foreground">
                  <span className="sr-only">Row</span>
                </th>
                {Array.from({ length: width }, (_, c) => (
                  <th key={c} scope="col" className="sticky top-0 z-10 border-b border-r bg-muted px-2 py-1 text-center text-[11px] font-normal text-muted-foreground">
                    {columnLetter(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.cells.map((row, r) => (
                <tr key={r}>
                  <th scope="row" className="border-b border-r bg-muted/60 px-1.5 py-1 text-right text-[11px] font-normal tabular-nums text-muted-foreground">
                    {r + 1}
                  </th>
                  {Array.from({ length: width }, (_, c) => {
                    const cell = row[c];
                    return (
                      <td
                        key={c}
                        title={cell?.text || undefined}
                        className={cn('max-w-[14rem] truncate whitespace-nowrap border-b border-r px-2 py-1 text-foreground', cell?.number && 'text-right tabular-nums')}
                        data-number={cell?.number ? 'true' : undefined}
                      >
                        {cell?.text ?? ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cut && (
        <p className="text-[11px] text-muted-foreground" data-testid="pdf-tools-excel-preview-cut">
          {cut}
        </p>
      )}
    </section>
  );
}
