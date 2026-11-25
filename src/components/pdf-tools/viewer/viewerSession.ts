// One opening of the page viewer on a PDF, from open to close, without React or the DOM, so that
// the lifecycle is unit-tested (lane V review, item 4): the viewer's own document slot, the engine
// that decides what is drawn, painting into the viewer's canvas, the low-memory Try again, and
// letting everything go on close.
//
// - Each session has a document slot of its own in the renderer, used for every lookup and drawing,
//   and let go on close: two viewer surfaces at once never close each other's document.
// - Closing cancels every drawing, closes every kept bitmap (once), lets the slot's document and
//   the pages kept parsed for it go, and empties the canvas. Closing twice does nothing more.
// - The bytes are read through `currentBytes` at the moment of each lookup and drawing: once the
//   working list has moved on it gives none, and nothing is drawn (the caller closes the viewer).
// - Try again after running out of memory empties the canvas, keeps no page parsed and no drawing,
//   and draws the page shown alone; from then on no page either side is drawn or kept parsed.
// - The viewer's text search reads each page's text through the same slot (readText), so the file is
//   not opened a second time; nothing is read once the session has closed or the list has moved on.
import { abortError } from '../renderQueue';
import type { PageGeometry } from './pageGeometry';
import type { SearchPageContent } from './viewerSearch';
import { createViewerEngine, type Drawing, type EngineDeps, type PageInfo, type Painted, type ViewRequest } from './viewerEngine';
import type { ViewRotation } from './viewerMath';
import { looksBlank } from './viewerRules';

/** What the renderer says of a page (pdfRenderer's ViewerPageInfo). */
export interface RendererPageInfo {
  view: PageGeometry['view'];
  rotate: ViewRotation;
  userUnit?: number;
  widthPt: number;
  heightPt: number;
}

/** The renderer as the session uses it (pdfRenderer's viewer functions; a fake in tests). */
export interface ViewerRendererApi<B, S = unknown> {
  createSlot(): S;
  pageInfo(bytes: Uint8Array, pageIndex: number, options: { signal: AbortSignal; slot: S }): Promise<RendererPageInfo>;
  drawPage(bytes: Uint8Array, pageIndex: number, scale: number, turn: ViewRotation, options: { signal: AbortSignal; slot: S; keep: boolean }): Promise<Drawing<B>>;
  /** Cleans up the slot's kept pages that are not in `keep` (page indexes, from 0). */
  releasePages(keep: readonly number[], slot: S): void;
  /** Lets the slot's document go. */
  releaseSlot(slot: S): Promise<void> | void;
  /** A page's text, for the search (pdfRenderer's viewerPageText). */
  pageText?(bytes: Uint8Array, pageIndex: number, options: { signal: AbortSignal; slot: S }): Promise<SearchPageContent>;
}

/** The viewer's canvas (an HTMLCanvasElement; a fake in tests). */
export interface SessionCanvas<B = unknown> {
  width: number;
  height: number;
  getContext(kind: '2d', options: { alpha: boolean }): { drawImage(image: B, dx: number, dy: number): void } | null;
}

/** What was painted: the drawing on screen. */
export interface SessionPainted {
  pageIndex: number;
  turn: ViewRotation;
  /** Device pixels per point of the drawing. */
  scale: number;
  widthPx: number;
  heightPx: number;
  /** The caps took more than a tenth off the asked sharpness. */
  reduced: boolean;
  /** Nothing shows on the drawing: every sampled pixel is white (see viewerRules.looksBlank). */
  blank: boolean;
}

export interface ViewerSessionOptions<B extends { close(): void }, S = unknown> {
  fileId: string;
  pageCount: number;
  /** The bytes to draw now, or null once the working list has moved on. */
  currentBytes: () => Uint8Array | null;
  renderer: ViewerRendererApi<B, S>;
  canvas: () => SessionCanvas<B> | null;
  /**
   * A small sample of a drawing's pixels (RGBA), to tell a blank drawing (pdf.js draws what it can
   * of a damaged page and says nothing). Without it, no drawing is said to be blank.
   */
  sample?: (drawing: Drawing<B>) => ArrayLike<number> | null;
  onInfo(pageIndex: number, info: PageInfo): void;
  onPainted(painted: SessionPainted): void;
  onFailed(pageIndex: number, error: unknown): void;
  /** For tests: the engine's timing (see viewerEngine). */
  timing?: Pick<EngineDeps<B>, 'delayMs' | 'setTimer' | 'clearTimer'>;
}

export interface ViewerSession {
  show(request: ViewRequest): void;
  /**
   * Draws the page shown again; `lowMemory` after running out of memory (see the header); `redraw`
   * afresh rather than from the drawing kept (Try again on a drawing that showed nothing).
   */
  retry(lowMemory?: boolean, redraw?: boolean): void;
  /** A page's text through the session's slot, for the search; rejects with an AbortError once closed or the list has moved on. */
  readText(pageIndex: number, signal: AbortSignal): Promise<SearchPageContent>;
  close(): void;
  readonly closed: boolean;
}

const toPageInfo = (i: RendererPageInfo): PageInfo => ({
  geometry: { view: i.view, rotate: i.rotate, userUnit: i.userUnit ?? 1 },
  widthPt: i.widthPt,
  heightPt: i.heightPt,
});

export function openViewerSession<B extends { close(): void }, S = unknown>(o: ViewerSessionOptions<B, S>): ViewerSession {
  const slot = o.renderer.createSlot();
  let closed = false;
  // Memory ran out once: pages are no longer kept parsed after drawing.
  let lowMemory = false;
  // Whether each page's drawing shows nothing, once looked at (it does not change with the zoom).
  const blankPages = new Map<number, boolean>();

  const emptyCanvas = () => {
    const canvas = o.canvas();
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  };

  const isBlank = (pageIndex: number, drawing: Drawing<B>): boolean => {
    const known = blankPages.get(pageIndex);
    if (known !== undefined) return known;
    let blank = false;
    try {
      const pixels = o.sample?.(drawing);
      blank = pixels ? looksBlank(pixels) : false;
    } catch {
      blank = false; // only a note: without the sample, nothing is said
    }
    blankPages.set(pageIndex, blank);
    return blank;
  };

  const paint = (p: Painted<B>) => {
    const canvas = o.canvas();
    if (!canvas) return;
    try {
      canvas.width = p.drawing.widthPx;
      canvas.height = p.drawing.heightPx;
      canvas.getContext('2d', { alpha: false })?.drawImage(p.drawing.bitmap, 0, 0);
    } catch {
      return; // a bitmap closed under it: the next drawing replaces it
    }
    o.onPainted({
      pageIndex: p.pageIndex,
      turn: p.turn,
      scale: p.scale,
      widthPx: p.drawing.widthPx,
      heightPx: p.drawing.heightPx,
      reduced: p.plan.reduced,
      blank: isBlank(p.pageIndex, p.drawing),
    });
  };

  const engine = createViewerEngine<B>({
    fileId: o.fileId,
    pageCount: o.pageCount,
    info: (pageIndex, signal) => {
      const bytes = o.currentBytes();
      return bytes ? o.renderer.pageInfo(bytes, pageIndex, { signal, slot }).then(toPageInfo) : Promise.reject(abortError());
    },
    draw: (pageIndex, scale, turn, signal) => {
      const bytes = o.currentBytes();
      if (!bytes) return Promise.reject(abortError());
      return o.renderer.drawPage(bytes, pageIndex, scale, turn, { signal, slot, keep: !lowMemory });
    },
    release: (bitmap) => bitmap.close(),
    onInfo: (pageIndex, info) => o.onInfo(pageIndex, info),
    onPaint: paint,
    onFailed: (pageIndex, error) => o.onFailed(pageIndex, error),
    // Pages whose drawings left the viewer's three are cleaned up in pdf.js too.
    onKept: (pages) => o.renderer.releasePages(pages, slot),
    ...o.timing,
  });

  return {
    show(request) {
      if (!closed) engine.show(request);
    },
    retry(low = false, redraw = false) {
      if (closed) return;
      // The page is looked at again once drawn.
      if (low || redraw) blankPages.clear();
      if (low) {
        lowMemory = true;
        // The canvas's own pixels go first: at 16 megapixels it holds 64 MB.
        emptyCanvas();
        engine.retry({ lowMemory: true });
        return;
      }
      engine.retry(redraw ? { redraw: true } : undefined);
    },
    readText(pageIndex, signal) {
      const bytes = closed ? null : o.currentBytes();
      if (!bytes || !o.renderer.pageText) return Promise.reject(abortError());
      return o.renderer.pageText(bytes, pageIndex, { signal, slot });
    },
    close() {
      if (closed) return;
      closed = true;
      engine.close();
      emptyCanvas();
      blankPages.clear();
      try {
        void Promise.resolve(o.renderer.releaseSlot(slot)).catch(() => undefined);
      } catch {
        // Letting go never fails the close.
      }
    },
    get closed() {
      return closed;
    },
  };
}
