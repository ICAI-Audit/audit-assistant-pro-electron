import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { isAbortError, RENDER_UNAVAILABLE, renderImageThumbnail, renderThumbnail } from './pdfRenderer';
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
   * and the image is released when it is far out of view (drawn again on return). Without it, the
   * preview is rendered straight away and kept until the box goes away.
   */
  scrollRoot?: RefObject<Element>;
  priority?: Priority;
}

type ThumbState = { status: 'waiting' } | { status: 'ready'; url: string } | { status: 'failed' };

const NEAR_MARGIN = '400px 0px';
const KEEP_MARGIN = '800px 0px';

/** A page or image preview in a box of fixed size, so nothing moves when it arrives. */
export default function Thumb({ file, pageIndex = 0, width, alt, className, scrollRoot, priority = 'normal' }: ThumbProps) {
  const box = useRef<HTMLDivElement>(null);
  const lazy = Boolean(scrollRoot);
  const [near, setNear] = useState(!lazy);
  const [kept, setKept] = useState(true);
  const [state, setState] = useState<ThumbState>({ status: 'waiting' });
  const job = useRef<{ controller: AbortController; started: boolean } | null>(null);
  const url = useRef<string | null>(null);
  const { bytes, kind, mimeType } = file;

  const release = useCallback(() => {
    job.current?.controller.abort();
    job.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
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

  // Another file or page: start again.
  useEffect(() => {
    release();
    setState((s) => (s.status === 'waiting' ? s : { status: 'waiting' }));
  }, [bytes, kind, mimeType, pageIndex, width, release]);

  // Scrolled away before its turn came: drop the queued render.
  useEffect(() => {
    if (lazy && !near && job.current && !job.current.started) {
      job.current.controller.abort();
      job.current = null;
    }
  }, [lazy, near]);

  // Far out of view: give the image's memory back.
  useEffect(() => {
    if (!lazy || kept) return;
    release();
    setState((s) => (s.status === 'waiting' ? s : { status: 'waiting' }));
  }, [lazy, kept, release]);

  useEffect(() => {
    if (!near || state.status !== 'waiting' || job.current) return;
    const controller = new AbortController();
    const entry = { controller, started: false };
    job.current = entry;
    const options = { signal: controller.signal, priority, onStart: () => (entry.started = true) };
    const pixels = Math.round(width * 2);
    const render =
      kind === 'pdf' ? renderThumbnail(bytes, pageIndex, pixels, options) : renderImageThumbnail(bytes, mimeType, pixels, options);
    render.then(
      (made) => {
        if (controller.signal.aborted || job.current !== entry) {
          URL.revokeObjectURL(made);
          return;
        }
        job.current = null;
        url.current = made;
        setState({ status: 'ready', url: made });
      },
      (error) => {
        if (job.current === entry) job.current = null;
        if (controller.signal.aborted || isAbortError(error)) return;
        // Previews that cannot run at all are announced once, not only shown as icons.
        if (error instanceof PdfToolsError && error.code === RENDER_UNAVAILABLE) toast.error(error.message, { id: RENDER_UNAVAILABLE });
        setState({ status: 'failed' });
      },
    );
  }, [near, state.status, bytes, kind, mimeType, pageIndex, width, priority]);

  return (
    <div
      ref={box}
      className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/60', className)}
      style={{ width }}
    >
      {state.status === 'ready' && (
        <img data-testid="pdf-tools-thumb" src={state.url} alt={alt} className="h-full w-full object-contain" draggable={false} />
      )}
      {state.status === 'waiting' && <div className="absolute inset-1 animate-pulse rounded-sm bg-muted" aria-hidden="true" />}
      {state.status === 'failed' && (
        <>
          <FileWarning className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Preview not available</span>
        </>
      )}
    </div>
  );
}
