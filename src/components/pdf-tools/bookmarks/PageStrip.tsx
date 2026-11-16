// The page thumbnails of the Bookmarks dialog (design 5.10: "the page thumbnails, left; choosing one
// makes it the current page; the expand icon opens the page viewer"). One column, of which only the
// tiles in view exist, so a 2,000-page file costs what a screenful costs. The keyboard moves the
// current page with the arrows (the strip is one stop for Tab) and Enter opens it in the viewer, where
// "Choose this page" makes the shown page the current one. The header's page number box goes straight
// to a page (type 212, Enter), with the viewer's words when the number is not in the file.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import Thumb from '../Thumb';
import PageViewer from '../viewer/PageViewer';
import QuietTip from '../viewer/QuietTip';
import { usePageJump } from '../viewer/usePageJump';
import { viewAvailability } from '../viewer/viewerRules';
import { useVirtualRows } from './useVirtualRows';

const THUMB_WIDTH = 96;
/** Tile, page number and gaps. */
export const STRIP_ROW = 164;

export interface PageStripHandle {
  /** Scrolls the strip so that page `pageNumber` (from 1) is in view. */
  show(pageNumber: number): void;
  focus(): void;
}

export interface PageStripProps {
  file: WorkingFile;
  /** The current page, from 1. */
  current: number;
  onChoose: (pageNumber: number) => void;
  /** A tool run is in progress: the large view is unavailable and says why (the viewer lane's rule). */
  running?: boolean;
  className?: string;
}

const PageStrip = forwardRef<PageStripHandle, PageStripProps>(function PageStrip({ file, current, onChoose, running = false, className }, ref) {
  const total = file.pageCount ?? 0;
  const box = useRef<HTMLDivElement>(null);
  const rows = useVirtualRows(box, total, STRIP_ROW, 2);
  const [focused, setFocused] = useState(false);
  const availability = viewAvailability(running);
  // Said when the large view was asked for while it is unavailable; cleared when the run ends.
  const [why, setWhy] = useState<string | null>(null);
  useEffect(() => {
    if (!running) setWhy(null);
  }, [running]);
  const [viewing, setViewing] = useState<{
    page: number;
    opener: HTMLElement | null;
    key: number;
  } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      show: (pageNumber) => rows.show(pageNumber - 1),
      focus: () => box.current?.focus(),
    }),
    [rows],
  );

  // The current page stays in view as it changes (from a bookmark, the viewer or the keys).
  const { show } = rows;
  useEffect(() => {
    show(current - 1);
  }, [current, show]);

  const view = (page: number, opener: HTMLElement | null) => {
    if (!availability.enabled) {
      setWhy(availability.reason);
      return;
    }
    setViewing({ page, opener, key: Date.now() });
  };
  const choose = (pageNumber: number) => onChoose(Math.min(total, Math.max(1, pageNumber)));
  // Go to page: the page becomes the current one and is brought into view (also when it already was current).
  const jump = usePageJump(current, total, (pageNumber) => {
    choose(pageNumber);
    show(pageNumber - 1);
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const page = Math.max(1, Math.min(total, current));
    const moves: Record<string, number> = {
      ArrowDown: page + 1,
      ArrowRight: page + 1,
      ArrowUp: page - 1,
      ArrowLeft: page - 1,
      PageDown: page + 3,
      PageUp: page - 3,
      Home: 1,
      End: total,
    };
    if (event.key in moves) {
      event.preventDefault();
      choose(moves[event.key]);
    } else if (event.key === 'Enter' && !event.repeat) {
      event.preventDefault();
      view(page, event.currentTarget);
    }
  };

  const tiles = [];
  for (let index = rows.start; index < rows.end; index++) {
    const pageNumber = index + 1;
    const isCurrent = pageNumber === current;
    tiles.push(
      <div
        key={pageNumber}
        id={`pdf-tools-bookmarks-page-${pageNumber}`}
        role="option"
        aria-selected={isCurrent}
        aria-label={`Page ${pageNumber}`}
        data-page={pageNumber}
        data-testid={`pdf-tools-bookmarks-page-${pageNumber}`}
        className="absolute inset-x-0 flex flex-col items-center gap-1 pt-2"
        style={{ top: index * STRIP_ROW, height: STRIP_ROW }}
        onClick={() => {
          choose(pageNumber);
          box.current?.focus();
        }}
        onDoubleClick={(event) => view(pageNumber, event.currentTarget)}
      >
        <div className="group relative cursor-pointer">
          <Thumb
            file={file}
            pageIndex={index}
            width={THUMB_WIDTH}
            scrollRoot={box}
            priority="high"
            alt=""
            className={cn('h-[128px] bg-background', isCurrent ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:ring-1 hover:ring-border')}
          />
          <QuietTip text={availability.reason ?? 'View larger'}>
            <button
              type="button"
              tabIndex={-1}
              aria-haspopup="dialog"
              aria-disabled={availability.enabled ? undefined : true}
              aria-label={availability.enabled ? `View page ${pageNumber} larger` : `View page ${pageNumber} larger. ${availability.reason}`}
              data-unavailable={availability.enabled ? undefined : 'true'}
              data-testid={`pdf-tools-bookmarks-page-expand-${pageNumber}`}
              onClick={(event) => {
                event.stopPropagation();
                view(pageNumber, box.current);
              }}
              className={cn(
                'absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md border bg-background/95 text-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent group-hover:opacity-100',
                !availability.enabled && 'cursor-not-allowed text-muted-foreground hover:bg-background/95',
              )}
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </QuietTip>
        </div>
        <span className={cn('text-xs tabular-nums', isCurrent ? 'font-semibold text-primary' : 'text-muted-foreground')}>{pageNumber}</span>
      </div>,
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-md border bg-muted/20', className)}>
      <label className="flex items-center justify-between gap-1.5 border-b bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground" data-testid="pdf-tools-bookmarks-current-page">
        <span className="text-xs font-medium text-foreground">Page</span>
        <input
          data-testid="pdf-tools-bookmarks-page-input"
          aria-label={`Go to page, 1 to ${total}`}
          {...jump.inputProps}
          // Leaving the box may change the page and take nodes out (the message under it, tiles of the strip):
          // done during the blur, that sends the focus to the dialog and the Tab is lost. So it waits until the
          // focus has landed (REV-B S9).
          onBlur={() => window.setTimeout(jump.inputProps.onBlur, 0)}
          className="h-6 w-11 min-w-0 rounded border border-input bg-background px-1 text-center text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="whitespace-nowrap tabular-nums">of {total}</span>
      </label>
      {jump.problem && (
        <p id={jump.problemId} role="alert" className="border-b px-3 py-1.5 text-[11px] leading-snug text-foreground" data-testid="pdf-tools-bookmarks-page-problem">
          {jump.problem}
        </p>
      )}
      {why && (
        <p role="status" className="border-b px-3 py-1.5 text-[11px] leading-snug text-foreground" data-testid="pdf-tools-bookmarks-pages-why">
          {why}
        </p>
      )}
      <div
        ref={box}
        role="listbox"
        tabIndex={0}
        aria-label={`Pages of ${file.name}. Arrow keys choose the page for a new bookmark; ${availability.enabled ? 'Enter views it larger.' : availability.reason}`}
        aria-activedescendant={current >= rows.start + 1 && current <= rows.end ? `pdf-tools-bookmarks-page-${current}` : undefined}
        data-testid="pdf-tools-bookmarks-pages"
        onScroll={rows.onScroll}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn('relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-none', focused && 'ring-2 ring-inset ring-ring')}
      >
        <div className="relative" style={{ height: rows.total }}>
          {tiles}
        </div>
      </div>
      {viewing && (
        <PageViewer
          key={viewing.key}
          file={file}
          startPage={viewing.page}
          chosenPages={[current]}
          onTogglePage={(pageNumber) => choose(pageNumber)}
          onClose={() => setViewing(null)}
          returnFocusTo={viewing.opener}
        />
      )}
    </div>
  );
});

export default PageStrip;
