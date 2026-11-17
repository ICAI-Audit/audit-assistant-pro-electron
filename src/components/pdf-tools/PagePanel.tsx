import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, FileText, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { plural } from './format';
import MiddleName from './MiddleName';
import Thumb from './Thumb';
import PageViewer from './viewer/PageViewer';
import QuietTip from './viewer/QuietTip';
import { viewAvailability } from './viewer/viewerRules';

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
  /**
   * Bring this page into view and mark it for a moment (the bookmark list beside the panel, design
   * section 4). A new `token` asks again for the same page.
   */
  showPage?: { page: number; token: number } | null;
  /** Called as the viewer opens (the screen clears its result message, which would sit over the viewer). */
  onViewerOpen?: () => void;
}

const count = new Intl.NumberFormat('en-IN');

/**
 * Whether the panel sits in a form part that is disabled: a tool dialog locks its controls in a
 * disabled fieldset while it runs. The fieldset disables buttons only, so the panel follows it for
 * the tiles that are not buttons (lane V review, item 5).
 */
function useInDisabledFieldset(ref: RefObject<HTMLElement>): boolean {
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    const fieldset = ref.current?.closest('fieldset');
    if (!fieldset || typeof MutationObserver === 'undefined') return;
    const update = () => setDisabled(fieldset.matches(':disabled'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, [ref]);
  return disabled;
}

/** The panel's line for pages that are only shown (UX audit C5.2, T1-11). */
export const VIEW_HINT = 'Click a page to view it larger.';

/**
 * The pages of one PDF, numbered, rendered as they scroll into view, 200 at a time. Each page has
 * an expand icon at its top-right corner (shown on hover and with keyboard focus) that opens the
 * page viewer; a page that is only shown also opens it with a click, Enter or a double-click (UX
 * audit C5.2: the header says "Click a page to view it larger."). Where pages are chosen (a toggle
 * per page: Split, Delete pages, PDF to images), a click, Enter and Space keep choosing and only the
 * icon opens the viewer, which then offers "Choose this page", in step with the panel both ways.
 * While a tool runs the larger view is not offered: the line says why instead, and a click, a key or
 * the icon also says it to screen readers.
 */
export default function PagePanel({ file, selectedPages, onTogglePage, tone = 'primary', chosenLabel, className, listClassName, showPage, onViewerOpen }: PagePanelProps) {
  const total = file.pageCount ?? 0;
  const chosen = new Set(selectedPages ?? []);
  const toneText = tone === 'destructive' ? 'text-destructive' : 'text-primary';
  const toneRing = tone === 'destructive' ? 'ring-destructive' : 'ring-primary';
  const listRef = useRef<HTMLOListElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // While a tool runs, the larger view is not offered (and says why).
  const availability = viewAvailability(useInDisabledFieldset(sectionRef));
  const [start, setStart] = useState(0);
  const end = Math.min(total, start + PAGE_WINDOW);
  const pages = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i + 1);

  const showFrom = (from: number) => {
    setStart(from);
    listRef.current?.scrollTo({ top: 0 });
  };

  // A page asked for from outside (a bookmark): show its window of 200, scroll to it, mark it briefly.
  const [marked, setMarked] = useState<{ page: number; token: number } | null>(null);
  useEffect(() => {
    if (!showPage || showPage.page < 1 || showPage.page > total) return;
    setStart(Math.floor((showPage.page - 1) / PAGE_WINDOW) * PAGE_WINDOW);
    setMarked(showPage);
  }, [showPage, total]);
  useEffect(() => {
    if (!marked) return;
    listRef.current?.querySelector(`[data-page="${marked.page}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const timer = window.setTimeout(() => setMarked(null), 1500);
    return () => window.clearTimeout(timer);
  }, [marked, start]);

  // The viewer opened from a page of this panel, and the control that opened it.
  const [viewing, setViewing] = useState<{ page: number; opener: HTMLElement | null; placeholder: string | null; key: number } | null>(null);
  // Said (politely, for screen readers) when the larger view was asked for while a tool runs; the line in
  // the header already shows the reason. The count makes the same words be read out again.
  const [why, setWhy] = useState<{ text: string; count: number }>({ text: '', count: 0 });
  // A reason that no longer holds goes when the run ends.
  useEffect(() => {
    if (availability.enabled) setWhy((w) => (w.text ? { text: '', count: w.count } : w));
  }, [availability.enabled]);
  // The page's thumbnail, if drawn, is shown enlarged in the viewer until its sharp drawing arrives.
  const view = (pageNumber: number, opener: HTMLElement | null) => {
    if (!availability.enabled) {
      const reason = availability.reason ?? '';
      setWhy((w) => ({ text: reason, count: w.count + 1 }));
      return;
    }
    onViewerOpen?.();
    // One viewer at a time: the second click of a double-click, or a click while it opens, adds nothing.
    setViewing(
      (open) =>
        open ?? {
          page: pageNumber,
          opener,
          placeholder: opener?.closest('li')?.querySelector<HTMLImageElement>('img[data-testid="pdf-tools-thumb"]')?.src ?? null,
          key: Date.now(),
        },
    );
  };
  const onTileKey = (pageNumber: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) view(pageNumber, event.currentTarget);
  };

  return (
    <section ref={sectionRef} aria-label={`Pages of ${file.name}`} className={cn('overflow-hidden rounded-lg border bg-card shadow-sm', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 sm:px-4">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="min-w-0 text-sm font-medium text-foreground">
          <MiddleName name={file.name} />
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground">{plural(total, 'page')}</span>
        {!onTogglePage && total > 0 && (
          <span className="text-xs text-muted-foreground" data-testid="pdf-tools-pages-hint" data-unavailable={availability.enabled ? undefined : 'true'}>
            <span aria-hidden="true">· </span>
            {availability.enabled ? VIEW_HINT : availability.reason}
          </span>
        )}
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
            {/* aria-disabled, not disabled, at either end: a disabled button would drop the focus (REV-B S7). */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn('h-7 px-2 text-xs', start === 0 && 'cursor-default opacity-50 hover:bg-background')}
              aria-disabled={start === 0 || undefined}
              onClick={() => start > 0 && showFrom(Math.max(0, start - PAGE_WINDOW))}
            >
              <ChevronLeft />
              Previous {PAGE_WINDOW}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn('h-7 px-2 text-xs', end >= total && 'cursor-default opacity-50 hover:bg-background')}
              aria-disabled={end >= total || undefined}
              onClick={() => end < total && showFrom(end)}
            >
              Show next {Math.min(PAGE_WINDOW, total - end) || PAGE_WINDOW} pages
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <ol
        ref={listRef}
        aria-label="Pages"
        className={cn('grid max-h-[min(460px,55vh)] gap-3 overflow-y-auto p-3 sm:p-4', listClassName)}
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${PAGE_WIDTH + 8}px, 1fr))` }}
      >
        {pages.map((pageNumber) => {
          const isChosen = chosen.has(pageNumber);
          const isMarked = marked?.page === pageNumber;
          const preview = (
            <Thumb
              file={file}
              pageIndex={pageNumber - 1}
              width={PAGE_WIDTH}
              scrollRoot={listRef}
              priority="high"
              // A page that is a toggle is itself a button: no button inside it.
              retryButton={!onTogglePage}
              alt={`Page ${pageNumber} of ${file.name}`}
              className={cn('h-[136px] bg-background', isChosen && cn('ring-2 ring-offset-2 ring-offset-background', toneRing), isMarked && !isChosen && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
            />
          );
          return (
            <li key={pageNumber} data-marked={isMarked ? 'true' : undefined} className="flex flex-col items-center gap-1.5">
              <div className="group relative">
                {onTogglePage ? (
                  <button
                    type="button"
                    aria-pressed={isChosen}
                    aria-label={`Page ${pageNumber}`}
                    data-page={pageNumber}
                    onClick={() => onTogglePage(pageNumber)}
                    className="block rounded ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {preview}
                  </button>
                ) : (
                  // Only shown: a click, Enter, Space or a double-click opens the viewer.
                  <div
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    aria-disabled={availability.enabled ? undefined : true}
                    aria-label={availability.enabled ? `Page ${pageNumber}. Press Enter to view it larger.` : `Page ${pageNumber}. ${availability.reason}`}
                    data-page={pageNumber}
                    onKeyDown={onTileKey(pageNumber)}
                    onClick={(event) => view(pageNumber, event.currentTarget)}
                    onDoubleClick={(event) => view(pageNumber, event.currentTarget)}
                    className={cn(
                      'block rounded ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      availability.enabled ? 'cursor-zoom-in' : 'cursor-default',
                    )}
                  >
                    {preview}
                  </div>
                )}
                <QuietTip text={availability.reason ?? 'View larger'}>
                  <button
                    type="button"
                    // Where a page is a toggle, the icon is the keyboard's way to the viewer; otherwise
                    // the page itself is, and the icon is for the mouse.
                    tabIndex={onTogglePage ? 0 : -1}
                    aria-haspopup="dialog"
                    aria-disabled={availability.enabled ? undefined : true}
                    aria-label={availability.enabled ? `View page ${pageNumber} larger` : `View page ${pageNumber} larger. ${availability.reason}`}
                    data-testid={`pdf-tools-page-expand-${pageNumber}`}
                    data-unavailable={availability.enabled ? undefined : 'true'}
                    onClick={(event) => view(pageNumber, event.currentTarget)}
                    className={cn(
                      'absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md border bg-background/95 text-foreground shadow-sm transition-opacity',
                      'opacity-0 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100',
                      !availability.enabled && 'cursor-not-allowed text-muted-foreground hover:bg-background/95',
                    )}
                  >
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </QuietTip>
              </div>
              <span className={cn('text-xs tabular-nums', isChosen ? cn('font-semibold', toneText) : 'text-muted-foreground')}>{pageNumber}</span>
            </li>
          );
        })}
      </ol>
      {/* Two polite regions taking turns, so a second ask while the tool runs is read out again. */}
      <div className="sr-only" data-testid="pdf-tools-pages-why" data-count={why.count}>
        <p role="status" aria-live="polite" aria-atomic="true">
          {why.count % 2 === 1 ? why.text : ''}
        </p>
        <p role="status" aria-live="polite" aria-atomic="true">
          {why.count > 0 && why.count % 2 === 0 ? why.text : ''}
        </p>
      </div>
      {viewing && (
        <PageViewer
          key={viewing.key}
          file={file}
          startPage={viewing.page}
          chosenPages={onTogglePage ? selectedPages : undefined}
          onTogglePage={onTogglePage}
          tone={tone}
          onClose={() => setViewing(null)}
          returnFocusTo={viewing.opener}
          placeholder={viewing.placeholder}
        />
      )}
    </section>
  );
}
