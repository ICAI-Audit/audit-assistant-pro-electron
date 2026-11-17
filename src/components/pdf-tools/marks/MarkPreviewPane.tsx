// The preview beside a marks dialog's options: one page of the file as the run will make it, a way to
// step through the chosen pages, the expand icon that opens the page viewer, a click to place a mark
// at a point (when a mark's position waits for one), and what the page shows that the user should know.
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Crosshair, Info, Loader2, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A step button that cannot step now: it looks unavailable and keeps the focus. */
const UNAVAILABLE = 'cursor-default opacity-50 hover:bg-transparent';

export type PanePreview =
  | { status: 'ready'; url: string; width: number; height: number }
  | { status: 'error'; message: string; blocking: boolean }
  | null;

export interface MarkPreviewPaneProps {
  /** Test id of the pane; its parts add -image, -expand, -prev, -next, -page, -notes. */
  id: string;
  preview: PanePreview;
  pending: boolean;
  /** The page shown (from 1). */
  page: number;
  /** The pages the preview can show, in order (the chosen pages). */
  pages: readonly number[];
  onPage: (page: number) => void;
  /** Set while a mark waits to be placed by a click: the instruction shown over the page. */
  picking: string | null;
  /** The point clicked, in percent from the left and from the top of the page as displayed. */
  onPick: (point: { x: number; y: number }) => void;
  onStopPicking: () => void;
  onExpand: (opener: HTMLElement) => void;
  alt: string;
  notes?: readonly string[];
  /** A problem with the options (an alert, pointed to by the invalid fields). */
  problem?: string | null;
  /** False when a field already reads the problem out: shown here, not read out a second time. */
  problemAlert?: boolean;
  problemId?: string;
  /** More below the page (the Page numbers close-up). */
  children?: ReactNode;
  maxHeight?: number;
  /** Test ids kept from phase 1 (Page numbers: "pdf-tools-preview-page", "pdf-tools-preview-error"). */
  imageTestId?: string;
  errorTestId?: string;
}

export default function MarkPreviewPane({
  id,
  preview,
  pending,
  page,
  pages,
  onPage,
  picking,
  onPick,
  onStopPicking,
  onExpand,
  alt,
  notes = [],
  problem,
  problemAlert = true,
  problemId,
  children,
  maxHeight = 340,
  imageTestId,
  errorTestId,
}: MarkPreviewPaneProps) {
  const at = pages.indexOf(page);
  const stop = useRef(onStopPicking);
  stop.current = onStopPicking;
  const pane = useRef<HTMLElement>(null);

  // While waiting for a click, Escape stops waiting instead of closing the dialog. Not an Escape meant for a
  // layer over the dialog (a drop-down list, the page viewer): that layer closes as usual (REV-B S8).
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const dialog = pane.current?.closest('[role="dialog"]');
      const target = event.target;
      if (dialog && target instanceof Element && target !== document.body && !dialog.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      stop.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picking]);

  const pick = (event: MouseEvent<HTMLImageElement>) => {
    if (!picking) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    const round = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
    onPick({ x: round(((event.clientX - box.left) / box.width) * 100), y: round(((event.clientY - box.top) / box.height) * 100) });
  };

  const ready = preview?.status === 'ready' ? preview : null;
  const atFirst = at <= 0;
  const atLast = at < 0 || at >= pages.length - 1;
  return (
    <section ref={pane} aria-label="Preview" className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid={id}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground" data-testid={`${id}-page`}>
          Preview of page {page}
        </span>
        <span className="flex items-center gap-1">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Updating the preview" />}
          {pages.length > 1 && (
            <>
              {/* aria-disabled, not disabled, at either end: a disabled button would drop the focus (REV-B S7). */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', atFirst && UNAVAILABLE)}
                aria-label="Previous chosen page"
                data-testid={`${id}-prev`}
                aria-disabled={atFirst || undefined}
                onClick={() => !atFirst && onPage(pages[at - 1])}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', atLast && UNAVAILABLE)}
                aria-label="Next chosen page"
                data-testid={`${id}-next`}
                aria-disabled={atLast || undefined}
                onClick={() => !atLast && onPage(pages[at + 1])}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
          {/* In the bar, not over the page: a mark in the page's top-right corner must stay visible. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-haspopup="dialog"
            aria-label={`View page ${page} larger, with the marks`}
            title="View larger"
            data-testid={`${id}-expand`}
            disabled={!preview || preview.status !== 'ready'}
            onClick={(event) => onExpand(event.currentTarget)}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>

      {picking && (
        <p className="flex items-center gap-1.5 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-xs text-foreground" role="status" data-testid={`${id}-picking`}>
          <Crosshair className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          {picking}
        </p>
      )}

      <div className="relative flex min-h-[160px] items-center justify-center">
        {ready ? (
          <img
            src={ready.url}
            alt={alt}
            data-testid={imageTestId ?? `${id}-image`}
            draggable={false}
            onClick={pick}
            className={cn('block h-auto w-auto max-w-full border bg-white shadow-sm', picking && 'cursor-crosshair ring-2 ring-primary ring-offset-2 ring-offset-background')}
            style={{ maxHeight }}
          />
        ) : (
          !problem && (
            <div className="flex h-[220px] w-full items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
              {preview?.status === 'error' ? preview.message : 'Drawing the preview…'}
            </div>
          )
        )}
      </div>

      {children}

      {notes.length > 0 && (
        <ul className="space-y-1" data-testid={`${id}-notes`}>
          {notes.map((note) => (
            <li key={note} className="flex gap-1.5 text-xs text-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              {note}
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p id={problemId} role={problemAlert ? 'alert' : undefined} data-testid={errorTestId ?? `${id}-error`} className="flex gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {problem}
        </p>
      )}
    </section>
  );
}
