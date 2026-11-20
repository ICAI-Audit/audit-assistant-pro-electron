import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FileSpreadsheet, FileText, FileWarning, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { isOfficeFile, officeInfo } from './officeFiles';
import { isAbortError, RENDER_UNAVAILABLE, renderImageThumbnail, renderThumbnail, thumbnails, whenRendererIdle } from './pdfRenderer';
import type { Priority } from './renderQueue';

interface ThumbProps {
  file: Pick<WorkingFile, 'bytes' | 'kind' | 'mimeType'>;
  pageIndex?: number;
  /** Width of the box in CSS pixels; the image is rendered at twice that for sharp screens. */
  width: number;
  alt: string;
  className?: string;
  /**
   * The scrolling box the preview sits in (the page panel). With it, the preview is rendered when
   * it comes near the visible area, a render that has not started is dropped when it scrolls away,
   * and the image is let go when it is far out of view (shown again on return, from the shared
   * drawing when it is still kept). Without it, the preview is rendered straight away.
   */
  scrollRoot?: RefObject<Element>;
  priority?: Priority;
  /** Offer a Try again button when the preview failed; off where the box sits inside a button itself. */
  retryButton?: boolean;
}

type ThumbState = { status: 'waiting' } | { status: 'ready'; url: string } | { status: 'failed' };

const NEAR_MARGIN = '400px 0px';
const KEEP_MARGIN = '800px 0px';
/** From this box width the waiting and failed states say so in words; smaller ones show an icon. */
const WORDS_FROM = 80;

/**
 * In place of a preview for an Excel workbook or a Word document (T-064, decision 9): a tile of the same size
 * with the kind's icon and its letters. Nothing is drawn from the file, so nothing waits and nothing can fail.
 */
export function OfficeTile({ file, width, alt, className }: Pick<ThumbProps, 'file' | 'width' | 'className'> & { alt?: string }) {
  const info = officeInfo(file);
  const Icon = info.type === 'word' ? FileText : FileSpreadsheet;
  return (
    <div
      className={cn('relative flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded border bg-muted/60', className)}
      style={{ width }}
      data-testid="pdf-tools-office-tile"
      data-office={info.type}
      // Named where a picture would have its description; silent where the picture is decoration (alt "").
      {...(alt === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt ?? info.label })}
    >
      <Icon className={cn('h-4 w-4 shrink-0', info.type === 'word' ? 'text-primary' : 'text-success')} aria-hidden="true" />
      {width >= 32 && (
        <span className="text-[8px] font-semibold leading-none tracking-wide text-muted-foreground" aria-hidden="true">
          {info.short}
        </span>
      )}
    </div>
  );
}

/**
 * A page or image preview in a box of fixed size, so nothing moves when it arrives. Previews are shared
 * (pdfRenderer.ts `thumbnails`): a page drawn for the page panel shows at once in Organise pages at the
 * same size (QA-FIX C). A box that is waiting says so; a preview that failed is tried once more when the
 * renderer is idle, and then offers Try again (QA-FIX D). An Excel or Word result has no preview: its tile.
 */
export default function Thumb(props: ThumbProps) {
  if (isOfficeFile(props.file)) return <OfficeTile file={props.file} width={props.width} alt={props.alt} className={props.className} />;
  return <DrawnThumb {...props} />;
}

function DrawnThumb({ file, pageIndex = 0, width, alt, className, scrollRoot, priority = 'normal', retryButton = true }: ThumbProps) {
  const box = useRef<HTMLDivElement>(null);
  const lazy = Boolean(scrollRoot);
  const [near, setNear] = useState(!lazy);
  const [kept, setKept] = useState(true);
  const [state, setState] = useState<ThumbState>({ status: 'waiting' });
  // The drawing has started (it may wait in the queue first): the box says "Drawing…" rather than "Waiting…".
  const [drawing, setDrawing] = useState(false);
  // Bumped to draw again: the automatic retry and Try again.
  const [attempt, setAttempt] = useState(0);
  const retried = useRef(false);
  const job = useRef<{ controller: AbortController; started: boolean } | null>(null);
  // The shared drawing this box shows, given back when it is no longer shown.
  const held = useRef<{ bytes: Uint8Array; key: string } | null>(null);
  const { bytes, kind, mimeType } = file;
  const pixels = Math.round(width * 2);
  const key = kind === 'pdf' ? `p${pageIndex}:${pixels}` : `i:${mimeType}:${pixels}`;

  const release = useCallback(() => {
    job.current?.controller.abort();
    job.current = null;
    if (held.current) thumbnails.give(held.current.bytes, held.current.key);
    held.current = null;
  }, []);

  useEffect(() => release, [release]);

  useEffect(() => {
    if (!lazy) return;
    const element = box.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const root = scrollRoot?.current ?? null;
    const watch = (margin: string, set: (value: boolean) => void) => {
      const observer = new IntersectionObserver((entries) => set(entries[entries.length - 1].isIntersecting), { root, rootMargin: margin });
      observer.observe(element);
      return observer;
    };
    const nearObserver = watch(NEAR_MARGIN, setNear);
    const keepObserver = watch(KEEP_MARGIN, setKept);
    return () => {
      nearObserver.disconnect();
      keepObserver.disconnect();
    };
  }, [lazy, scrollRoot]);

  // Another file or page: start again (and the automatic retry is due again).
  useEffect(() => {
    release();
    retried.current = false;
    setDrawing(false);
    setState((s) => (s.status === 'waiting' ? s : { status: 'waiting' }));
  }, [bytes, kind, mimeType, pageIndex, width, release]);

  // Scrolled away before its turn came: drop the queued render.
  useEffect(() => {
    if (lazy && !near && job.current && !job.current.started) {
      job.current.controller.abort();
      job.current = null;
    }
  }, [lazy, near]);

  // Far out of view: let the image go (the shared drawing may still be kept for its return).
  useEffect(() => {
    if (!lazy || kept) return;
    release();
    setState((s) => (s.status === 'waiting' ? s : { status: 'waiting' }));
  }, [lazy, kept, release]);

  useEffect(() => {
    if (!near || state.status !== 'waiting' || job.current || held.current) return;
    // Drawn already (by the page panel, or before it scrolled away): shown at once.
    const ready = thumbnails.take(bytes, key);
    if (ready) {
      held.current = { bytes, key };
      setState({ status: 'ready', url: ready });
      return;
    }
    const controller = new AbortController();
    const entry = { controller, started: false };
    job.current = entry;
    setDrawing(false);
    const render = (options: Parameters<typeof renderThumbnail>[3]) =>
      kind === 'pdf' ? renderThumbnail(bytes, pageIndex, pixels, options) : renderImageThumbnail(bytes, mimeType, pixels, options);
    thumbnails
      .draw(bytes, key, (options) => render(options), {
        priority,
        signal: controller.signal,
        onStart: () => {
          entry.started = true;
          if (job.current === entry) setDrawing(true);
        },
      })
      .then(
        (made) => {
          if (controller.signal.aborted || job.current !== entry) {
            thumbnails.give(bytes, key); // it was counted as shown here
            return;
          }
          job.current = null;
          held.current = { bytes, key };
          setState({ status: 'ready', url: made });
        },
        (error) => {
          if (job.current === entry) job.current = null;
          if (controller.signal.aborted || isAbortError(error)) return;
          // Previews that cannot run at all are announced once, not only shown as icons.
          if (error instanceof PdfToolsError && error.code === RENDER_UNAVAILABLE) {
            toast.error(error.message, { id: RENDER_UNAVAILABLE });
            setState({ status: 'failed' });
            return;
          }
          // Usually the renderer was busy (a time limit, a restart): tried once more when it is idle,
          // still looking like a preview on its way, so a good file never keeps a warning (QA-FIX D).
          if (!retried.current) {
            retried.current = true;
            void whenRendererIdle().then(() => setAttempt((n) => n + 1));
            return;
          }
          setState({ status: 'failed' });
        },
      );
  }, [near, state.status, bytes, kind, mimeType, pageIndex, pixels, key, priority, attempt]);

  const tryAgain = () => {
    retried.current = true; // a press of Try again is the user's own retry
    setDrawing(false);
    setState({ status: 'waiting' });
    setAttempt((n) => n + 1);
  };
  const words = width >= WORDS_FROM;

  return (
    <div
      ref={box}
      className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/60', className)}
      style={{ width }}
      data-thumb-state={state.status === 'waiting' ? (drawing ? 'drawing' : 'waiting') : state.status}
    >
      {state.status === 'ready' && (
        <img data-testid="pdf-tools-thumb" src={state.url} alt={alt} className="h-full w-full object-contain" draggable={false} />
      )}
      {state.status === 'waiting' && (
        <>
          {/* Only a box whose drawing is due pulses. A long file's page panel holds hundreds of boxes far out of
              view that never draw: pulsing, they made every frame restyle and re-layer them all (about 80 ms a
              frame on a busy machine, all the time), and each turn a run gives the screen paid for one such frame. */}
          {/* Nor does any box pulse behind an open dialog (T-064; a dialog marks the screen behind it data-aria-hidden):
              a run's page reads go before the previews, so the boxes in view kept waiting, and pulsing, for the whole
              run. On a 500-page statement converted straight after it was added, that made the run two to three times
              longer (60 to 80 s in place of 25 to 30 s), all of it the window drawing the pulse. */}
          <div className={cn('absolute inset-1 rounded-sm bg-muted', near && 'animate-pulse [[data-aria-hidden=true]_&]:animate-none')} aria-hidden="true" />
          {words && (
            <span className="relative text-[11px] text-muted-foreground" aria-hidden="true">
              {drawing ? 'Drawing…' : 'Waiting…'}
            </span>
          )}
        </>
      )}
      {state.status === 'failed' && (
        <div className="flex flex-col items-center gap-1 px-1 text-center">
          {words && <FileWarning className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          {words && <span className="text-[11px] leading-tight text-muted-foreground">Preview not drawn</span>}
          {!words && !retryButton && <FileWarning className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          <span className="sr-only">Preview not drawn</span>
          {retryButton && (
          <button
            type="button"
            data-testid="pdf-tools-thumb-retry"
            aria-label={`Try again to draw the preview${alt ? ` (${alt})` : ''}`}
            title="Try again"
            onClick={(event) => {
              // Inside a page tile or a row thumbnail: only this, not the tile's choice or the viewer.
              event.stopPropagation();
              tryAgain();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            // Only the button's own keys stay here: the grid's keys (arrows, Delete, R, Ctrl+Z) still reach the
            // page it sits on (REV-B minor 19).
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            }}
            className={cn(
              'inline-flex items-center justify-center gap-1 rounded border bg-background font-medium text-foreground shadow-sm ring-offset-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              words ? 'h-6 px-1.5 text-[11px]' : 'h-6 w-6',
            )}
          >
            <RotateCw className="h-3 w-3" aria-hidden="true" />
            {words && 'Try again'}
          </button>
          )}
        </div>
      )}
    </div>
  );
}
