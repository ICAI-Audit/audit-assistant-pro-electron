// The marks over the page viewer, when it is opened from a marks dialog's preview: the page shown is
// drawn marked (marks/markedPage.ts, the same path as the dialog's preview), at the resolution the
// viewer's zoom needs, and laid over the viewer's own drawing of the page. A page outside the chosen
// pages is left as it is, and says so. Everything here lets the pointer through, so the viewer still
// pans by dragging.
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ViewerSurface } from '../viewer/pageGeometry';
import { isAbortError } from '../pdfRenderer';
import { createPreviewDeps } from '../dialogs/useMarkPreview';
import { drawMarkedPage, overlayDpi, previewProblem, type MarkedPageDeps, type MarkPage } from './markedPage';

interface Drawn {
  url: string;
  dpi: number;
}

/**
 * The marked pages drawn for the viewer, kept while the dialog is open (at most four: the viewer
 * moves between pages and zooms) and released when it closes.
 */
export class OverlayCache {
  private readonly drawn = new Map<string, Drawn>();
  private deps: MarkedPageDeps | null = null;
  constructor(private readonly max = 4) {}
  get pageDeps(): MarkedPageDeps {
    this.deps ??= createPreviewDeps();
    return this.deps;
  }
  /** The sharpest drawing kept for this page and these marks. */
  best(key: string): Drawn | undefined {
    return this.drawn.get(key);
  }
  keep(key: string, value: Drawn): void {
    const old = this.drawn.get(key);
    if (old) {
      if (old.dpi >= value.dpi) {
        URL.revokeObjectURL(value.url);
        return;
      }
      URL.revokeObjectURL(old.url);
      this.drawn.delete(key);
    }
    this.drawn.set(key, value);
    while (this.drawn.size > this.max) {
      const [first, entry] = this.drawn.entries().next().value as [string, Drawn];
      URL.revokeObjectURL(entry.url);
      this.drawn.delete(first);
    }
  }
  clear(): void {
    for (const entry of this.drawn.values()) URL.revokeObjectURL(entry.url);
    this.drawn.clear();
    this.deps = null;
  }
}

export interface MarkedPageOverlayProps {
  surface: ViewerSurface;
  bytes: Uint8Array;
  /** The marks of a page (from 0), or null when that page is not marked. */
  markFor: (pageIndex: number) => { key: string; mark: MarkPage } | null;
  cache: OverlayCache;
  /** The dialog's own small preview, shown enlarged until the sharp drawing arrives. */
  seed?: { key: string; pageIndex: number; url: string } | null;
  isCurrent: () => boolean;
  /** Told the page the viewer shows, so the dialog's preview can follow it. */
  onPageShown?: (pageIndex: number) => void;
}

export default function MarkedPageOverlay({ surface, bytes, markFor, cache, seed, isCurrent, onPageShown }: MarkedPageOverlayProps) {
  const { pageIndex, turn, cssScale } = surface;
  const marks = markFor(pageIndex);
  const dpi = overlayDpi(cssScale, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const cacheKey = marks ? `${marks.key}|${pageIndex}` : null;
  const [, setVersion] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef({ marks, isCurrent });
  latest.current = { marks, isCurrent };

  useEffect(() => {
    onPageShown?.(pageIndex);
  }, [pageIndex, onPageShown]);

  const kept = cacheKey ? cache.best(cacheKey) : undefined;
  const needed = cacheKey !== null && (!kept || kept.dpi < dpi);
  useEffect(() => {
    setProblem(null);
    if (!needed || !cacheKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const current = latest.current;
      if (!current.marks) return;
      try {
        const page = await drawMarkedPage(cache.pageDeps, bytes, pageIndex, current.marks.mark, dpi, controller.signal);
        if (controller.signal.aborted || !current.isCurrent()) return;
        cache.keep(cacheKey, { url: URL.createObjectURL(new Blob([page.png as BlobPart], { type: 'image/png' })), dpi });
        setVersion((v) => v + 1);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error) || !current.isCurrent()) return;
        setProblem(previewProblem(error, pageIndex + 1).message);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needed, cacheKey, bytes, pageIndex, dpi, cache]);

  const shownUrl = kept?.url ?? (seed && marks && seed.key === marks.key && seed.pageIndex === pageIndex ? seed.url : null);
  const sideways = turn === 90 || turn === 270;
  const chip = (text: string, busy = false) => (
    <p className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full border bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm" data-testid="pdf-tools-marks-overlay-note">
      {busy && <Loader2 className="h-3 w-3 animate-spin text-primary" aria-hidden="true" />}
      {text}
    </p>
  );

  if (!marks) return chip(`Page ${pageIndex + 1} is not among the chosen pages: nothing is added to it.`);
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="pdf-tools-marks-overlay" data-page={pageIndex + 1} data-dpi={kept?.dpi ?? 0}>
      {shownUrl && (
        <img
          src={shownUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute left-1/2 top-1/2 max-w-none select-none"
          style={{
            width: sideways ? surface.height : surface.width,
            height: sideways ? surface.width : surface.height,
            transform: `translate(-50%, -50%) rotate(${turn}deg)`,
          }}
        />
      )}
      {problem ? chip(problem) : needed ? chip('Adding the marks to this page…', true) : chip('Preview: the page as it will be made')}
    </div>
  );
}
