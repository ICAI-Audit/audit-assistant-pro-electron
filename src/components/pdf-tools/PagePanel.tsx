import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { plural } from './format';
import Thumb from './Thumb';

const PAGE_WIDTH = 104;
/** At most this many page tiles exist at a time, however long the file. */
export const PAGE_WINDOW = 200;

export interface PagePanelProps {
  file: WorkingFile;
  /**
   * For tools that pick pages (Split, Delete pages): the chosen page numbers, counted from 1. When
   * `onTogglePage` is given each page becomes a toggle button; otherwise the pages are only shown.
   */
  selectedPages?: number[];
  onTogglePage?: (pageNumber: number) => void;
  /** 'destructive' marks chosen pages as ones to remove (Delete pages). */
  tone?: 'primary' | 'destructive';
  /** Replaces "N pages chosen" in the header. */
  chosenLabel?: string;
  className?: string;
  /** Classes for the scrolling page grid, for example a smaller height inside a dialog. */
  listClassName?: string;
}

const count = new Intl.NumberFormat('en-IN');

/** The pages of one PDF, numbered, rendered as they scroll into view, 200 at a time. */
export default function PagePanel({ file, selectedPages, onTogglePage, tone = 'primary', chosenLabel, className, listClassName }: PagePanelProps) {
  const total = file.pageCount ?? 0;
  const chosen = new Set(selectedPages ?? []);
  const toneText = tone === 'destructive' ? 'text-destructive' : 'text-primary';
  const toneRing = tone === 'destructive' ? 'ring-destructive' : 'ring-primary';
  const listRef = useRef<HTMLOListElement>(null);
  const [start, setStart] = useState(0);
  const end = Math.min(total, start + PAGE_WINDOW);
  const pages = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i + 1);

  const showFrom = (from: number) => {
    setStart(from);
    listRef.current?.scrollTo({ top: 0 });
  };

  return (
    <section aria-label={`Pages of ${file.name}`} className={cn('overflow-hidden rounded-lg border bg-card shadow-sm', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 sm:px-4">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="min-w-0 truncate text-sm font-medium text-foreground" title={file.name}>
          {file.name}
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground">{plural(total, 'page')}</span>
        {(chosenLabel || (onTogglePage && chosen.size > 0)) && (
          <span className={cn('shrink-0 text-xs font-medium', toneText)} data-testid="pdf-tools-pages-chosen">
            {chosenLabel ?? `${plural(chosen.size, 'page')} chosen`}
          </span>
        )}
        {total > PAGE_WINDOW && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground" data-page-window>
              Showing {count.format(start + 1)}–{count.format(end)} of {count.format(total)}
            </span>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={start === 0} onClick={() => showFrom(Math.max(0, start - PAGE_WINDOW))}>
              <ChevronLeft />
              Previous {PAGE_WINDOW}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={end >= total} onClick={() => showFrom(end)}>
              Show next {Math.min(PAGE_WINDOW, total - end) || PAGE_WINDOW} pages
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <ol
        ref={listRef}
        aria-label="Pages"
        className={cn('grid max-h-[460px] gap-3 overflow-y-auto p-3 sm:p-4', listClassName)}
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${PAGE_WIDTH + 8}px, 1fr))` }}
      >
        {pages.map((pageNumber) => {
          const isChosen = chosen.has(pageNumber);
          const preview = (
            <Thumb
              file={file}
              pageIndex={pageNumber - 1}
              width={PAGE_WIDTH}
              scrollRoot={listRef}
              priority="high"
              alt={`Page ${pageNumber} of ${file.name}`}
              className={cn('h-[136px] bg-background', isChosen && cn('ring-2 ring-offset-2 ring-offset-background', toneRing))}
            />
          );
          return (
            <li key={pageNumber} className="flex flex-col items-center gap-1.5">
              {onTogglePage ? (
                <button
                  type="button"
                  aria-pressed={isChosen}
                  aria-label={`Page ${pageNumber}`}
                  data-page={pageNumber}
                  onClick={() => onTogglePage(pageNumber)}
                  className="rounded ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {preview}
                </button>
              ) : (
                preview
              )}
              <span className={cn('text-xs tabular-nums', isChosen ? cn('font-semibold', toneText) : 'text-muted-foreground')}>{pageNumber}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
