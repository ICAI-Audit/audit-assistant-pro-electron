// The page viewer's state: which page, zoom and turn, what is drawn, and when the viewer must close.
// Used by PageViewer (the near-full-window dialog) and meant for any other large page surface (the
// Redact review), which renders PageSurface with what this returns.
//
// Confidentiality: the file is looked up by id in the working list returned by the guarded hook,
// and again, with the engagement and session the viewer was opened in, before every drawing. A
// change of engagement, user or session, or the file leaving the list, closes the viewer; closing
// or unmounting cancels every drawing, closes every kept bitmap, revokes the image's object URL,
// and lets the viewer's own pdf.js document go (with the pages kept parsed for it). The PDF side's
// open and close are a viewer session (viewerSession.ts, unit-tested); each viewer has a document
// slot of its own.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { releaseCanvas } from '../canvasUtils';
import { abortError } from '../renderQueue';
import { createViewerSlot, releaseViewerDocument, releaseViewerPages, renderViewerPage, viewerPageInfo, viewerPageText, type ViewerSlot } from '../pdfRenderer';
import { useWorkingList } from '../useWorkingList';
import { pageBoxSize, viewerSurface, type ViewerSurface } from './pageGeometry';
import type { Drawing, PageInfo } from './viewerEngine';
import { displayedSize, scrollForZoom, stepZoom, turnView, zoomFitScale, zoomOfScale, type Size, type ViewRotation, type ZoomMode } from './viewerMath';
import { isLowMemory, viewBytes, viewerCloseReason, viewerErrorMessage, type CloseReason } from './viewerRules';
import type { SearchPageContent } from './viewerSearch';
import { openViewerSession, type ViewerRendererApi, type ViewerSession } from './viewerSession';

/** Space kept around the page inside the scrolling view, in CSS pixels. */
export const VIEWER_PAD = 24;
const FIT_WIDTH: ZoomMode = { kind: 'fit-width' };

export interface ViewerDrawn {
  pageIndex: number;
  turn: ViewRotation;
  /** Device pixels per point of the drawing on screen (for an image: image pixels per image pixel). */
  scale: number;
  widthPx: number;
  heightPx: number;
  reduced: boolean;
  /** Nothing shows on the drawing (a damaged page may draw blank without an error). */
  blank?: boolean;
}

export interface PageViewerModel {
  /** The file as the guarded list has it now; null once the viewer must close. */
  file: WorkingFile | null;
  isImage: boolean;
  pageCount: number;
  /** Counted from 1. */
  page: number;
  goTo(page: number): void;
  zoom: ZoomMode;
  /** CSS pixels per point of the page shown, once its size is known. */
  cssScale: number | null;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn(anchor?: { x: number; y: number }): void;
  zoomOut(anchor?: { x: number; y: number }): void;
  setZoom(mode: ZoomMode): void;
  turn: ViewRotation;
  turnBy(direction: 1 | -1): void;
  /** The page shown: its geometry and size (an image: its pixel size). */
  info: PageInfo | null;
  /** The page box's CSS size. */
  box: Size | null;
  /** The drawing on screen, and whether it is of the page and turn shown (else a placeholder shows). */
  drawn: ViewerDrawn | null;
  showsCurrent: boolean;
  status: 'loading' | 'ready' | 'failed';
  error: string | null;
  /** Draws the page shown again; after running out of memory, with everything else let go first. */
  retry(): void;
  /** For a layer drawn over the page: the mapping between PDF points and the page box. */
  surface: ViewerSurface | null;
  frameRef: (element: HTMLDivElement | null) => void;
  scrollerRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  imageUrl: string | null;
  onImageLoad(image: HTMLImageElement): void;
  onImageError(): void;
  /** A page's text through the viewer's own document slot, for the search (rejects once closed or the list has moved on). */
  readText(pageIndex: number, signal: AbortSignal): Promise<SearchPageContent>;
  /** Whether the working list is still the one the viewer was opened in, with its file: checked before showing anything read. */
  inScope(): boolean;
  /** Why the viewer is closing (read when it closes). */
  closeReason(): CloseReason;
  /** The user closed it. */
  close(): void;
}

export interface UsePageViewerOptions {
  fileId: string;
  /** Counted from 1. */
  startPage: number;
  onClose: (reason: CloseReason) => void;
}

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [dpr]);
  return dpr;
}

// The renderer's viewer functions, as a viewer session uses them.
const pdfViewerRenderer: ViewerRendererApi<ImageBitmap, ViewerSlot> = {
  createSlot: createViewerSlot,
  pageInfo: (bytes, pageIndex, { signal, slot }) => viewerPageInfo(bytes, pageIndex, { signal, slot }),
  drawPage: (bytes, pageIndex, scale, turn, { signal, slot, keep }) =>
    renderViewerPage(bytes, pageIndex, scale, turn, { signal, slot, keep }).then((d) => ({ bitmap: d.bitmap, widthPx: d.widthPx, heightPx: d.heightPx })),
  releasePages: (keep, slot) => releaseViewerPages(keep, slot),
  releaseSlot: (slot) => releaseViewerDocument(slot),
  pageText: (bytes, pageIndex, { signal, slot }) => viewerPageText(bytes, pageIndex, { signal, slot }),
};

// The long side of the sample a drawing is shrunk to, to tell whether anything shows on it: big
// enough that a line of small text darkens some of its pixels well below white.
const SAMPLE_SIDE = 256;

/** A small copy of a drawing's pixels (RGBA), shrunk on the graphics card; only this copy is read back. */
function sampleDrawing(drawing: Drawing<ImageBitmap>): Uint8ClampedArray | null {
  const ratio = Math.min(1, SAMPLE_SIDE / Math.max(1, drawing.widthPx, drawing.heightPx));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(drawing.widthPx * ratio));
  canvas.height = Math.max(1, Math.round(drawing.heightPx * ratio));
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    context.imageSmoothingQuality = 'high';
    context.drawImage(drawing.bitmap, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  } finally {
    releaseCanvas(canvas);
  }
}

export function usePageViewer({ fileId, startPage, onClose }: UsePageViewerOptions): PageViewerModel {
  const { state, contextKey, store } = useWorkingList();
  // The list the viewer was opened in. A list that is not this engagement's (session -1) never opens it.
  const opened = useRef({ contextKey, session: state.session, fileId });
  const fileIds = useMemo(() => state.files.map((f) => f.id), [state.files]);
  const reason = viewerCloseReason(opened.current, { contextKey, session: state.session, fileIds });
  const file = reason ? null : (state.files.find((f) => f.id === fileId) ?? null);
  const isImage = file?.kind === 'image';
  const pageCount = isImage ? 1 : Math.max(1, file?.pageCount ?? 1);
  const isPdf = file?.kind === 'pdf';

  const [page, setPage] = useState(() => Math.min(Math.max(1, Math.round(startPage) || 1), pageCount));
  const [zoom, setZoomMode] = useState<ZoomMode>(FIT_WIDTH);
  const [turn, setTurn] = useState<ViewRotation>(0);
  const [frame, setFrame] = useState<Size | null>(null);
  const dpr = useDevicePixelRatio();
  const [current, setCurrent] = useState<{ pageIndex: number; info: PageInfo } | null>(null);
  const [drawn, setDrawn] = useState<ViewerDrawn | null>(null);
  const [failure, setFailure] = useState<{ pageIndex: number; message: string; lowMemory: boolean } | null>(null);
  const [session, setSession] = useState<ViewerSession | null>(null);
  const sessionRef = useRef<ViewerSession | null>(null);
  sessionRef.current = session;
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reasonRef = useRef<CloseReason>('user');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  // The bytes to draw, read from the store at the moment of drawing, only while the store is still
  // the list (engagement, user, session) the viewer was opened in and still holds the file.
  const currentBytes = useCallback((): Uint8Array | null => {
    const live = store.getState();
    const scope = opened.current;
    if (viewerCloseReason(scope, { contextKey: live.contextKey, session: live.session, fileIds: live.files.map((f) => f.id) })) return null;
    const row = live.files.find((f) => f.id === scope.fileId);
    return row ? viewBytes(row) : null;
  }, [store]);

  // Closes by itself when the list moves on.
  useEffect(() => {
    if (!reason) return;
    reasonRef.current = reason;
    onCloseRef.current(reason);
  }, [reason]);

  // ---- PDF pages: a viewer session ---------------------------------------------------------------

  useEffect(() => {
    if (!isPdf) return;
    // React lets go of the ref before this effect's cleanup runs: the last canvas seen is the one
    // emptied on close.
    let lastCanvas = canvasRef.current;
    const created = openViewerSession<ImageBitmap, ViewerSlot>({
      fileId,
      pageCount,
      currentBytes,
      renderer: pdfViewerRenderer,
      canvas: () => {
        if (canvasRef.current) lastCanvas = canvasRef.current;
        return canvasRef.current ?? lastCanvas;
      },
      sample: sampleDrawing,
      onInfo: (pageIndex, info) => setCurrent({ pageIndex, info }),
      onPainted: (p) => {
        setDrawn({ pageIndex: p.pageIndex, turn: p.turn, scale: p.scale, widthPx: p.widthPx, heightPx: p.heightPx, reduced: p.reduced, blank: p.blank });
        setFailure((f) => (f && f.pageIndex === p.pageIndex ? null : f));
      },
      onFailed: (pageIndex, error) => setFailure({ pageIndex, message: viewerErrorMessage(error), lowMemory: isLowMemory(error) }),
    });
    setSession(created);
    return () => {
      created.close();
      setSession(null);
    };
  }, [isPdf, fileId, pageCount, currentBytes]);

  // ---- images: shown by the browser from an object URL, released on close ---------------------

  const imageBytes = isImage && file ? viewBytes(file) : null;
  const imageType = file?.mimeType ?? 'image/png';
  useEffect(() => {
    if (!imageBytes) return;
    const url = URL.createObjectURL(new Blob([imageBytes as BlobPart], { type: imageType }));
    setImageUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setImageUrl(null);
    };
  }, [imageBytes, imageType]);

  const onImageLoad = useCallback((image: HTMLImageElement) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!(width > 0 && height > 0)) return;
    setCurrent({ pageIndex: 0, info: { geometry: { view: [0, 0, width, height], rotate: 0 }, widthPt: width, heightPt: height } });
    setDrawn({ pageIndex: 0, turn: 0, scale: 1, widthPx: width, heightPx: height, reduced: false });
    setFailure(null);
  }, []);
  const onImageError = useCallback(() => setFailure({ pageIndex: 0, message: 'This image could not be shown. It may be damaged.', lowMemory: false }), []);

  // ---- the frame the page is fitted into ---------------------------------------------------------

  const observer = useRef<ResizeObserver | null>(null);
  const frameRef = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    (scrollerRef as { current: HTMLDivElement | null }).current = element;
    if (!element) return;
    const measure = () => {
      const width = Math.max(1, element.clientWidth - 2 * VIEWER_PAD);
      const height = Math.max(1, element.clientHeight - 2 * VIEWER_PAD);
      setFrame((f) => (f && Math.abs(f.width - width) < 1 && Math.abs(f.height - height) < 1 ? f : { width, height }));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(element);
    }
  }, []);

  // ---- what to draw ------------------------------------------------------------------------------

  useEffect(() => {
    if (!session || !frame) return;
    session.show({ pageIndex: page - 1, turn, zoom, frame, dpr });
  }, [session, page, turn, zoom, frame, dpr]);

  const info = current && current.pageIndex === page - 1 ? current.info : null;
  const shown = info ? displayedSize({ width: info.widthPt, height: info.heightPt }, turn) : null;
  const cssScale = info && shown && frame ? zoomFitScale(zoom, shown, frame) : null;
  const box = info && cssScale ? pageBoxSize(info.geometry, cssScale, turn) : null;
  const surface = useMemo(() => (info && cssScale && !isImage ? viewerSurface(page - 1, info.geometry, cssScale, turn) : null), [info, cssScale, isImage, page, turn]);
  const showsCurrent = Boolean(drawn && drawn.pageIndex === page - 1 && (isImage || drawn.turn === turn));
  const failed = failure && failure.pageIndex === page - 1 ? failure.message : null;
  // The zoom the user reads and steps through (1 = 100% = actual size).
  const userZoom = cssScale !== null ? zoomOfScale(cssScale) : null;

  // Keep the point under the pointer (or the middle of the view) still across a zoom.
  useLayoutEffect(() => {
    const target = pendingScroll.current;
    const scroller = scrollerRef.current;
    if (!target || !scroller) return;
    pendingScroll.current = null;
    scroller.scrollTo({ left: target.left, top: target.top });
  }, [box?.width, box?.height]);

  // A new page, or the page turned, starts at its top-left corner.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTo({ left: 0, top: 0 });
  }, [page, turn]);

  const zoomTo = useCallback(
    (next: ZoomMode, anchor?: { x: number; y: number }) => {
      const scroller = scrollerRef.current;
      if (scroller && info && box && frame) {
        const nextScale = zoomFitScale(next, displayedSize({ width: info.widthPt, height: info.heightPt }, turn), frame);
        const after = pageBoxSize(info.geometry, nextScale, turn);
        pendingScroll.current = scrollForZoom({
          scroll: { left: scroller.scrollLeft, top: scroller.scrollTop },
          anchor: anchor ?? { x: scroller.clientWidth / 2, y: scroller.clientHeight / 2 },
          frame: { width: scroller.clientWidth, height: scroller.clientHeight },
          pad: VIEWER_PAD,
          before: box,
          after,
        });
      }
      setZoomMode(next);
    },
    [info, box, frame, turn],
  );

  const goTo = useCallback((n: number) => setPage(Math.min(pageCount, Math.max(1, Math.round(n)))), [pageCount]);
  const readText = useCallback((pageIndex: number, signal: AbortSignal) => (sessionRef.current ? sessionRef.current.readText(pageIndex, signal) : Promise.reject(abortError())), []);
  const inScope = useCallback(() => currentBytes() !== null, [currentBytes]);

  return {
    file,
    isImage,
    pageCount,
    page,
    goTo,
    zoom,
    cssScale,
    canZoomIn: userZoom !== null && stepZoom(userZoom, 1) !== userZoom,
    canZoomOut: userZoom !== null && stepZoom(userZoom, -1) !== userZoom,
    zoomIn: (anchor) => {
      if (userZoom !== null) zoomTo({ kind: 'percent', value: stepZoom(userZoom, 1) }, anchor);
    },
    zoomOut: (anchor) => {
      if (userZoom !== null) zoomTo({ kind: 'percent', value: stepZoom(userZoom, -1) }, anchor);
    },
    setZoom: (mode) => zoomTo(mode),
    turn,
    turnBy: (direction) => setTurn((t) => turnView(t, direction)),
    info,
    box,
    drawn,
    showsCurrent,
    status: failed ? 'failed' : showsCurrent ? 'ready' : 'loading',
    error: failed,
    retry: () => {
      // After a failure, its Try again; without one, Try again on a drawing that showed nothing.
      const lowMemory = Boolean(failure?.lowMemory);
      const redraw = !failure;
      setFailure(null);
      session?.retry(lowMemory, redraw);
    },
    surface,
    frameRef,
    scrollerRef,
    canvasRef,
    imageUrl,
    onImageLoad,
    onImageError,
    readText,
    inScope,
    closeReason: () => {
      // Read at the moment of closing: the list may have moved on since the last render.
      const live = store.getState();
      return viewerCloseReason(opened.current, { contextKey: live.contextKey, session: live.session, fileIds: live.files.map((f) => f.id) }) ?? reasonRef.current;
    },
    close: () => {
      reasonRef.current = 'user';
      onCloseRef.current('user');
    },
  };
}
