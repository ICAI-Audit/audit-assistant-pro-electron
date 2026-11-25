// Page rendering for PDF Tools, built on pdfjs-dist. Everything here runs locally:
//
// - pdfjs is imported on first use, and one worker is shared by every render. The worker is
//   created here and handed to pdfjs as a port: from a file:// page pdfjs would otherwise wrap
//   it in a blob: worker, which Electron does not load, and drop to parsing on the main thread.
// - Character maps, standard fonts, wasm decoders and the CMYK profile come from
//   public/pdf-tools/pdfjs (copied by scripts/sync-pdfjs-assets.mjs). Nothing else is fetched:
//   no annotation or XFA layer is created, scripts are not evaluated, and document data is
//   always passed as bytes, never as a URL.
// - Renders go through renderQueue: one at a time, the page viewer's drawings first, then a tool
//   run's pages, then page-panel tiles, then list thumbnails, each cancellable and limited in time.
//   The most recently used document stays open while renders for it continue and is destroyed
//   when another file is needed or after a short idle time.
// - Each page viewer opens its file in a slot of its own (another opener on the same worker, made
//   by createViewerSlot), so that thumbnails and tool runs on other files never close it, the idle
//   release leaves it, and two viewer surfaces at once (the Redact review and a viewer opened from
//   it) never close each other's; a slot is let go when its viewer closes. With one shared slot, a
//   run on another file reopened the viewer's document 16 times in 3 s and a scan page took up to
//   5.45 s (spike-viewer 4.3).
// - Work the viewer lets go (an open in progress, its document, a cancelled drawing) is destroyed
//   at once, and watched: if it has not ended within the time limit, the worker has stopped
//   answering and is restarted, although nobody waits for that work any more (lane V review,
//   item 7). Failures are not isolated between slots: they share the worker, and a restart fails
//   what every slot had in progress (recorded in the Task A1 report).
// - Pages the viewer has drawn keep what pdf.js has read of them (drawing instructions, decoded
//   pictures) until the viewer lets them go, so that a new zoom of a scanned page takes 0.16 to
//   0.39 s instead of 1.9 to 2.5 s. Every other page is cleaned up after each render.
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PDFWorker, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import type { AnnotationText } from '@/lib/pdf-tools/redactFind';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { blobBytes, canvasToBlob, createCanvas, drawingFailure, fitScale, IMAGE_ENCODE_FAILED, OUT_OF_MEMORY, releaseCanvas, yieldToUi } from './canvasUtils';
import { createDocOpener, createLetGoWatches, type DocOpener, type StartedOpen } from './docOpener';
import { abortError, createRenderQueue, isAbortError, type JobContext, type Priority } from './renderQueue';
import { createThumbCache } from './thumbCache';
import { opIdsOf, readOperations, type OperatorList, type TextOp, type ViewFont } from './redact/rendererView';
import { normaliseRotation } from './viewer/pageGeometry';
import type { ViewRotation } from './viewer/viewerMath';

export { isAbortError } from './renderQueue';

type Pdfjs = typeof import('pdfjs-dist');

export interface RenderedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
  /** The resolution actually used: lower than asked when the page was too large to draw at that size. */
  dpi: number;
  reduced: boolean;
}

export interface RenderOptions {
  signal?: AbortSignal;
  /**
   * 'view' for the page viewer; 'run' for a tool run's pages; 'dialog' for a tool dialog's own pages (the
   * Organise pages grid); 'high' for the page panel; list thumbnails are 'normal'.
   */
  priority?: Priority;
  /** Called when the render actually starts (it may wait in the queue first). */
  onStart?: () => void;
  /** Called once it is queued, with a way to raise its priority while it waits (thumbCache.ts). */
  onQueued?: (raise: (priority: Priority) => void) => void;
}

/**
 * Every page and image preview, drawn once and shared at a given size (QA-FIX C): Thumb.tsx takes them
 * from here. 400 previews nobody shows are kept at most (a 208 px PNG is tens of kilobytes); they go
 * with PDF Tools and with the engagement (clearThumbnails).
 */
export const thumbnails = createThumbCache({ maxIdle: 400, revoke: (url) => URL.revokeObjectURL(url) });

/** Lets every kept preview go: PDF Tools closed, or the engagement or user changed. */
export function clearThumbnails(): void {
  thumbnails.clear();
}

// Callers waiting for the queue to have nothing left to do (whenRendererIdle).
const idleWaiters = new Set<() => void>();

/**
 * Resolves once the renderer has had nothing to do for a moment: when a preview failed (usually a busy
 * worker running out of time), it is tried once more then (QA-FIX D).
 */
export function whenRendererIdle(): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      idleWaiters.delete(settle);
      // A moment more, so that the retry is not the first of a new burst.
      setTimeout(resolve, 1000);
    };
    if (!queue.busy) settle();
    else idleWaiters.add(settle);
  });
}

export const RENDER_UNAVAILABLE = 'render-unavailable';
/** The file did not open within the time limit (25 s). */
export const OPEN_TIMEOUT = 'open-timeout';
/** The worker was dropped (a job ran out of time, or the worker failed) while this file was opening. */
export const RENDERER_RESTARTED = 'renderer-restarted';

const IDLE_RELEASE_MS = 4000;
const JOB_TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 25_000;
// A thumbnail is never taller than this many times its width (very long receipts, strips).
const THUMB_MAX_ASPECT = 4;
const JPEG_QUALITY = 0.92;

let pdfjsPromise: Promise<Pdfjs> | null = null;
let shared: { pdfWorker: PDFWorker; worker: Worker } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
// Set when PDF Tools closes: the worker is stopped once the queue has drained.
let releaseRequested = false;
// True only while dropWorker resets the opener, so an open that fails then is labelled a restart.
let restarting = false;
// How many times the worker has been dropped, so a page whose drawing failed because the worker
// went away under it is labelled a restart too.
let restarts = 0;

const queue = createRenderQueue({
  timeoutMs: JOB_TIMEOUT_MS,
  // A cancelled job whose work has not ended after as long again: the worker is stuck (see the header).
  stuckAfterCancelMs: JOB_TIMEOUT_MS,
  between: yieldToUi,
  onDrained: () => {
    for (const waiter of [...idleWaiters]) waiter();
    if (releaseRequested) {
      finishRelease();
      return;
    }
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      // The viewer's document is not the shared one: it stays while the viewer is open.
      if (!queue.busy) void opener.close();
    }, IDLE_RELEASE_MS);
  },
  // A render that hangs suggests the worker is stuck: start again with a fresh one.
  onTimeout: () => dropWorker(),
});

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function assetUrl(folder: string): string {
  // Absolute, so that it means the same thing to pdfjs on the page and inside its worker.
  return new URL(`./pdf-tools/pdfjs/${folder}/`, document.baseURI).href;
}

function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

const unavailable = () => new PdfToolsError(RENDER_UNAVAILABLE, 'Page previews could not be started. Restart the application and try again.');

function sharedWorker(pdfjs: Pdfjs): NonNullable<typeof shared> {
  if (shared && !shared.pdfWorker.destroyed) return shared;
  let worker: Worker;
  let pdfWorker: PDFWorker;
  try {
    worker = new Worker(workerUrl, { type: 'module', name: 'vera-pdf-tools' });
  } catch {
    throw unavailable();
  }
  try {
    pdfWorker = pdfjs.PDFWorker.create({ port: worker, verbosity: pdfjs.VerbosityLevel.ERRORS });
  } catch {
    worker.terminate();
    throw unavailable();
  }
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    if (shared?.worker === worker) dropWorker();
  });
  shared = { pdfWorker, worker };
  return shared;
}

/**
 * Watches the worker for failure during one open; the watch is removed when the open settles (a
 * promise that never settles while the worker lives would keep every opened document alive).
 */
function watchWorker(worker: Worker): (onFailure: (error: Error) => void) => () => void {
  return (onFailure) => {
    const listener = (event: Event) => {
      event.preventDefault();
      onFailure(unavailable());
    };
    worker.addEventListener('error', listener);
    return () => worker.removeEventListener('error', listener);
  };
}

/** Calls `onAnswer` the next time the worker sends anything (it still works); returns how to stop listening. */
function watchAnswer(worker: Worker): (onAnswer: () => void) => () => void {
  return (onAnswer) => {
    const listener = () => onAnswer();
    worker.addEventListener('message', listener);
    return () => worker.removeEventListener('message', listener);
  };
}

/** Stops the worker and forgets the open documents; the next render starts afresh. */
function dropWorker(): void {
  restarts += 1;
  // Work let go on this worker no longer needs watching, and a watch would keep the worker.
  letGoWatches.endAll();
  // An open in progress fails now: say it was the restart, not the file.
  restarting = true;
  try {
    opener.reset();
    for (const slot of viewerSlots.values()) {
      slot.pages.clear();
      slot.doc = null;
      slot.opener.reset();
    }
  } finally {
    restarting = false;
  }
  if (!shared) return;
  shared.pdfWorker.destroy();
  shared.worker.terminate();
  shared = null;
}

// Every document keeps pdf.js's own JPEG decoder. The browser's (`isImageDecoderSupported: true`,
// which pdf.js leaves off in Chromium) drew a 300 dpi scan page in 0.24 to 0.42 s instead of 2.0
// to 3.2 s in a bare Electron trial page, with pixel-equivalent output, but in the application the
// same page's first drawing took 10.5 s instead of 2.3 s (twice), for a reason not found (Task A1
// report). Not used until that is understood.
async function startOpen(bytes: Uint8Array): Promise<StartedOpen<PDFDocumentProxy, Worker>> {
  const pdfjs = await loadPdfjs();
  const { pdfWorker, worker } = sharedWorker(pdfjs);
  // pdfjs takes ownership of the buffer it is given (it is transferred to the worker), so it gets a copy.
  const task: PDFDocumentLoadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    worker: pdfWorker,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: true,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  return { promise: task.promise, destroy: () => task.destroy(), worker, watchFailure: watchWorker(worker), watchAnswer: watchAnswer(worker) };
}

const openerOptions = {
  start: startOpen,
  currentWorker: () => shared?.worker ?? null,
  dropWorker: () => dropWorker(),
  timeoutMs: OPEN_TIMEOUT_MS,
  timeoutError: () => openTimeoutError(),
  failure: (error: unknown) => openFailure(error, restarting),
  abortError,
};

// One document open at a time for thumbnails, the page panel and tool runs, kept while renders for
// it continue (see docOpener.ts).
const opener = createDocOpener<PDFDocumentProxy, Worker>(openerOptions);

/** A page viewer's own document slot (see the header): made by createViewerSlot, let go by releaseViewerDocument. */
export interface ViewerSlot {
  readonly id: number;
}

interface ViewerSlotState {
  opener: DocOpener<PDFDocumentProxy>;
  /** Pages that keep what pdf.js has read of them (see the header), by index. */
  pages: Map<number, PDFPageProxy>;
  doc: PDFDocumentProxy | null;
}

// The watches of work the viewers let go (docOpener.ts), ended when the worker is dropped.
const letGoWatches = createLetGoWatches();

// Callers that pass no slot share this one (as before slots were made per viewer).
const DEFAULT_SLOT: ViewerSlot = Object.freeze({ id: 0 });
let slotsMade = 0;
// Slots in use: made on first use, forgotten when let go.
const viewerSlots = new Map<ViewerSlot, ViewerSlotState>();
// Slots let go: a late job of one opens nothing again. The shared default slot is never retired.
const retiredSlots = new WeakSet<ViewerSlot>();

/** A document slot of its own for one page viewer surface. Let it go with releaseViewerDocument(slot). */
export function createViewerSlot(): ViewerSlot {
  slotsMade += 1;
  return Object.freeze({ id: slotsMade });
}

function slotState(slot: ViewerSlot): ViewerSlotState {
  let state = viewerSlots.get(slot);
  if (!state) {
    // Work a viewer let go is watched for a stuck worker (docOpener.ts), for as long as an open may take.
    state = { opener: createDocOpener<PDFDocumentProxy, Worker>({ ...openerOptions, abandonMs: OPEN_TIMEOUT_MS, watches: letGoWatches }), pages: new Map(), doc: null };
    viewerSlots.set(slot, state);
  }
  return state;
}

export function openTimeoutError(): PdfToolsError {
  return new PdfToolsError(OPEN_TIMEOUT, 'The file took too long to open for preview.');
}

/**
 * Why a file did not open, with its own code: the renderer restarting under it, or memory running
 * out, are not the file's fault. Only what pdf.js could not read stays 'render-failed'.
 */
export function openFailure(error: unknown, restartingNow: boolean): PdfToolsError {
  if (error instanceof PdfToolsError) return error;
  if (restartingNow) return new PdfToolsError(RENDERER_RESTARTED, 'The page renderer had to restart.');
  const memory = drawingFailure(error);
  if (memory instanceof PdfToolsError) return memory;
  return new PdfToolsError('render-failed', 'This file could not be opened for preview.');
}

/**
 * Why drawing a page failed: the renderer restarting under it (pdf.js only says that its worker
 * went away), memory running out, or the page's own error, left for the caller. A cancel and the
 * renderer's own labels are kept.
 */
export function pageFailure(error: unknown, restartedMeanwhile: boolean): unknown {
  if (error instanceof PdfToolsError || isAbortError(error)) return error;
  if (restartedMeanwhile) return new PdfToolsError(RENDERER_RESTARTED, 'The page renderer had to restart.');
  return drawingFailure(error);
}

function schedule<T>(run: (ctx: JobContext) => Promise<T>, options: RenderOptions, dispose?: (value: T) => void): Promise<T> {
  releaseRequested = false;
  clearIdleTimer();
  // The worker a job started on, by restart count: work cancelled and stuck restarts that worker
  // only, never one started since (a watchdog may have replaced it meanwhile).
  let startedOn = -1;
  return queue.schedule(
    (ctx) => {
      startedOn = restarts;
      return run(ctx);
    },
    {
      signal: options.signal,
      priority: options.priority,
      onStart: options.onStart,
      onQueued: options.onQueued,
      dispose,
      onStuck: () => {
        if (startedOn === restarts) dropWorker();
      },
    },
  );
}

const revokeUrl = (value: string) => URL.revokeObjectURL(value);

/**
 * Draws a page for `viewport` on a new page canvas, on white. With `contextOptions`, pdf.js is
 * handed a 2D context made here with those options, returned with the canvas; otherwise pdf.js
 * makes its own.
 */
async function drawOnCanvas(
  page: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
  ctx: JobContext,
  contextOptions?: CanvasRenderingContext2DSettings,
  redact?: { recordOperations?: boolean; operationsFilter?: (index: number) => boolean; heartbeat?: boolean },
): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null }> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  let task: RenderTask | null = null;
  try {
    const own = contextOptions ? canvas.getContext('2d', contextOptions) : null;
    if (contextOptions && !own) throw new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.');
    // Redact's reading (wave 3): pdf.js records where each operation paints, or skips the operations given.
    const extra = redact ? { ...(redact.recordOperations ? { recordOperations: true } : {}), ...(redact.operationsFilter ? { operationsFilter: redact.operationsFilter } : {}) } : {};
    // Recording needs the canvas itself (pdf.js sizes its record by it); its getContext then returns `own`.
    task = own && !redact?.recordOperations ? page.render({ canvas: null, canvasContext: own, viewport, background: 'rgb(255,255,255)', ...extra }) : page.render({ canvas, viewport, background: 'rgb(255,255,255)', ...extra });
    // Redact (wave 4): each step pdf.js makes in the drawing is a sign of work, so a drawing that goes on working on
    // a busy machine is not "out of time" (the job's limit counts silence, not the clock).
    if (redact?.heartbeat) {
      task.onContinue = (next: () => void) => {
        ctx.alive();
        next();
      };
    }
    ctx.setCancel(() => task?.cancel());
    await task.promise;
    if (ctx.signal.aborted) throw abortError();
    return { canvas, context: own };
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
}

/**
 * Draws a page on a new page canvas. `rotation` replaces the page's own turn when given (pdf.js
 * getViewport). The viewer passes `contextOptions` `{ alpha: false }`: a context made here with
 * nothing else, which the browser may keep on the graphics card (the viewer's drawings are only
 * shown, never read back pixel by pixel): pdf.js's own asks for `willReadFrequently`, a CPU canvas,
 * which blocked the screen for 384 to 956 ms on a scan and an A3 drawing against 0 to 68 ms
 * (spike-viewer 4.1).
 */
async function drawPage(page: PDFPageProxy, scale: number, ctx: JobContext, rotation?: number, contextOptions?: CanvasRenderingContext2DSettings): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport(rotation === undefined ? { scale } : { scale, rotation });
  return (await drawOnCanvas(page, viewport, ctx, contextOptions)).canvas;
}

function cleanUp(page: PDFPageProxy): void {
  try {
    page.cleanup();
  } catch {
    // Its document has already gone: nothing is held.
  }
}

/**
 * Runs `work` on a page of an open document: the shared one, or a viewer slot's (`viewer`). A
 * shared page is cleaned up afterwards. A page of a viewer slot's document is kept with what pdf.js
 * read of it when `keep` is true, until releaseViewerPages lets it go; otherwise it is cleaned up
 * unless it is already kept.
 */
async function onPage<T>(
  bytes: Uint8Array,
  pageIndex: number,
  ctx: JobContext,
  work: (page: PDFPageProxy) => Promise<T>,
  slot: { viewer: ViewerSlot; keep: boolean } | null = null,
): Promise<T> {
  // A late job of a viewer that has closed opens nothing again.
  if (slot && retiredSlots.has(slot.viewer)) throw abortError();
  const state = slot ? slotState(slot.viewer) : null;
  const doc = await (state ? state.opener : opener).open(bytes, ctx.signal);
  if (ctx.signal.aborted) throw abortError();
  if (state && state.doc !== doc) {
    // The viewer moved to another file: the pages kept were its old document's, destroyed with it.
    state.pages.clear();
    state.doc = doc;
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) {
    throw new PdfToolsError('render-failed', `This file has no page ${pageIndex + 1}.`);
  }
  const page = await doc.getPage(pageIndex + 1);
  try {
    if (ctx.signal.aborted) throw abortError();
    return await work(page);
  } finally {
    // Kept only while its document is still the slot's: a drawing that finishes after the viewer
    // let its document go (closed, engagement changed) must not hold that document alive.
    if (state && slot?.keep && state.doc === doc) state.pages.set(pageIndex, page);
    else if (!(state && state.pages.get(pageIndex) === page)) cleanUp(page);
  }
}

function releaseSlotPages(state: ViewerSlotState, keep: readonly number[]): void {
  const wanted = new Set(keep);
  for (const [index, page] of state.pages) {
    if (wanted.has(index)) continue;
    state.pages.delete(index);
    cleanUp(page);
  }
}

/** Cleans up a viewer slot's kept pages that are not in `keep` (page indexes, from 0). */
export function releaseViewerPages(keep: readonly number[], slot: ViewerSlot = DEFAULT_SLOT): void {
  const state = viewerSlots.get(slot);
  if (state) releaseSlotPages(state, keep);
}

/**
 * Lets a viewer slot's document go: its kept pages are cleaned up, an open in progress is let go
 * and the document is destroyed. The viewer calls it when it closes, on a change of engagement or
 * user, and when it unmounts. The other slots are not touched. A slot made by createViewerSlot is
 * not used again afterwards.
 */
export function releaseViewerDocument(slot: ViewerSlot = DEFAULT_SLOT): Promise<void> {
  if (slot !== DEFAULT_SLOT) retiredSlots.add(slot);
  const state = viewerSlots.get(slot);
  if (!state) return Promise.resolve();
  viewerSlots.delete(slot);
  releaseSlotPages(state, []);
  state.doc = null;
  return state.opener.close();
}

/**
 * Renders one page as a thumbnail at most `maxWidthPx` wide and returns an object URL for a PNG.
 * The caller must revoke the URL when it is no longer shown. Rejects with an AbortError when the
 * signal fires, RenderTimeoutError after 30 s, or a PdfToolsError when the page cannot be drawn
 * (code 'render-unavailable' when previews cannot run at all).
 */
export function renderThumbnail(file: Uint8Array, pageIndex: number, maxWidthPx: number, options: RenderOptions = {}): Promise<string> {
  return schedule<string>(
    (ctx) =>
      onPage(file, pageIndex, ctx, async (page) => {
        const base = page.getViewport({ scale: 1 });
        const wanted = Math.min(maxWidthPx / base.width, (maxWidthPx * THUMB_MAX_ASPECT) / base.height);
        const { scale } = fitScale(base.width, base.height, wanted);
        const canvas = await drawPage(page, scale, ctx);
        try {
          return URL.createObjectURL(await canvasToBlob(canvas, 'image/png'));
        } finally {
          releaseCanvas(canvas);
        }
      }),
    options,
    revokeUrl,
  );
}

/**
 * Renders one page at the given resolution, for PDF to images. A page that would exceed the
 * canvas limits (8192 px a side, 50 megapixels) is drawn at the highest resolution that fits;
 * `dpi` and `reduced` in the result say so.
 */
export function renderPage(
  file: Uint8Array,
  pageIndex: number,
  dpi: 100 | 150 | 300,
  format: 'png' | 'jpg',
  options: RenderOptions = {},
): Promise<RenderedImage> {
  return schedule<RenderedImage>((ctx) => {
    const restartsAtStart = restarts;
    return onPage<RenderedImage>(file, pageIndex, ctx, async (page) => {
      const base = page.getViewport({ scale: 1 });
      const { scale, reduced } = fitScale(base.width, base.height, dpi / 72);
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await drawPage(page, scale, ctx);
        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
        const blob = await canvasToBlob(canvas, mimeType, format === 'jpg' ? JPEG_QUALITY : undefined);
        return {
          bytes: await blobBytes(blob),
          width: canvas.width,
          height: canvas.height,
          mimeType,
          dpi: Math.round(scale * 72),
          reduced,
        };
      } finally {
        releaseCanvas(canvas);
      }
    }).catch((error: unknown) => {
      // A big page at 300 dpi can run the window out of memory, and the worker can be restarted
      // under a page: say so, not "damaged".
      throw pageFailure(error, restarts !== restartsAtStart);
    });
  }, options);
}

// ---- the page viewer -----------------------------------------------------------------------------

export interface ViewerPageInfo {
  /** The visible box in PDF user space (pdf.js `page.view`: the CropBox within the MediaBox). */
  view: [number, number, number, number];
  /** The page's own /Rotate. */
  rotate: ViewRotation;
  userUnit: number;
  /** The page's size in points as the reader sees it (its own /Rotate applied). */
  widthPt: number;
  heightPt: number;
}

export interface ViewerPageDrawing {
  bitmap: ImageBitmap;
  widthPx: number;
  heightPx: number;
  /** As ViewerPageInfo's widthPt and heightPt: the page as the reader sees it, without the view turn. */
  pageWidthPt: number;
  pageHeightPt: number;
  view: [number, number, number, number];
  rotate: ViewRotation;
}

export interface ViewerLookupOptions extends RenderOptions {
  /** The viewer's own document slot (createViewerSlot); without one, the shared default slot. */
  slot?: ViewerSlot;
}

export interface ViewerRenderOptions extends ViewerLookupOptions {
  /** Keep the page's parsed content after drawing it, until releaseViewerPages lets it go (default true). */
  keep?: boolean;
}

function viewerInfo(page: PDFPageProxy): ViewerPageInfo {
  const rotate = normaliseRotation(page.rotate);
  const base = page.getViewport({ scale: 1, rotation: rotate });
  const [x0, y0, x1, y1] = page.view;
  return { view: [x0, y0, x1, y1], rotate, userUnit: page.userUnit ?? 1, widthPt: base.width, heightPt: base.height };
}

/** A page's visible box, own turn and size, without drawing it. Scheduled as the viewer's ('view'). */
export function viewerPageInfo(file: Uint8Array, pageIndex: number, options: ViewerLookupOptions = {}): Promise<ViewerPageInfo> {
  const slot = options.slot ?? DEFAULT_SLOT;
  return schedule<ViewerPageInfo>((ctx) => onPage(file, pageIndex, ctx, async (page) => viewerInfo(page), { viewer: slot, keep: false }), {
    ...options,
    priority: options.priority ?? 'view',
  });
}

/**
 * Draws a page for the page viewer at `scale` device pixels per point (already held within the
 * caps by the viewer's renderPlan), with the view turned by `rotation` on top of the page's own
 * /Rotate. Scheduled before every other drawing ('view'). The caller closes the bitmap; one that
 * arrives after a cancel is closed here.
 */
export function renderViewerPage(
  file: Uint8Array,
  pageIndex: number,
  scale: number,
  rotation: ViewRotation,
  options: ViewerRenderOptions = {},
): Promise<ViewerPageDrawing> {
  return schedule<ViewerPageDrawing>(
    (ctx) => {
      const restartsAtStart = restarts;
      return onPage<ViewerPageDrawing>(
        file,
        pageIndex,
        ctx,
        async (page) => {
          const info = viewerInfo(page);
          const canvas = await drawPage(page, scale, ctx, normaliseRotation(info.rotate + rotation), { alpha: false });
          try {
            const bitmap = await createImageBitmap(canvas);
            return {
              bitmap,
              widthPx: canvas.width,
              heightPx: canvas.height,
              pageWidthPt: info.widthPt,
              pageHeightPt: info.heightPt,
              view: info.view,
              rotate: info.rotate,
            };
          } catch (error) {
            throw drawingFailure(error);
          } finally {
            releaseCanvas(canvas);
          }
        },
        { viewer: options.slot ?? DEFAULT_SLOT, keep: options.keep ?? true },
      ).catch((error: unknown) => {
        throw pageFailure(error, restarts !== restartsAtStart);
      });
    },
    { ...options, priority: options.priority ?? 'view' },
    (value) => value.bitmap.close(),
  );
}

/**
 * A page's text for the page viewer's search, read through the viewer's own slot as a viewer job
 * ('view' unless asked otherwise), one page per job so that a drawing of the page shown waits at most
 * for one page's text. Nothing is drawn; the page is cleaned up afterwards unless the viewer keeps it
 * drawn. Same items and styles as pageTextContent.
 */
export function viewerPageText(file: Uint8Array, pageIndex: number, options: ViewerLookupOptions = {}): Promise<PageTextContent> {
  return schedule<PageTextContent>(
    (ctx) => {
      const restartsAtStart = restarts;
      return onPage<PageTextContent>(file, pageIndex, ctx, (page) => readTextContent(page), { viewer: options.slot ?? DEFAULT_SLOT, keep: false }).catch((error: unknown) => {
        throw pageFailure(error, restarts !== restartsAtStart);
      });
    },
    { ...options, priority: options.priority ?? 'view' },
  );
}

/** pdf.js's text content of a page: the items that have a string, and each font's style. */
async function readTextContent(page: PDFPageProxy): Promise<PageTextContent> {
  const content = await page.getTextContent();
  const items: TextItemLike[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    items.push({ str: item.str, transform: item.transform, width: item.width, height: item.height, fontName: item.fontName, hasEOL: item.hasEOL });
  }
  const styles: Record<string, FontStyleLike> = {};
  for (const [name, style] of Object.entries(content.styles)) {
    styles[name] = { fontFamily: style.fontFamily, ascent: style.ascent, descent: style.descent, vertical: style.vertical };
  }
  return { items, styles };
}

// ---- page reads for Redact ---------------------------------------------------------------------
//
// What the Redact run reads of a page, for its find and its picture check. Each is one job on the
// shared slot, as a tool run's ('run') unless asked otherwise, cancellable through `options.signal`,
// with failures labelled as renderPage's. Nothing read is kept here: each page is cleaned up after.

/** Runs `work` on one page of the shared slot's document as one job (see above). */
function readPage<T>(file: Uint8Array, pageIndex: number, options: RenderOptions, work: (page: PDFPageProxy, ctx: JobContext) => Promise<T>): Promise<T> {
  return schedule<T>(
    (ctx) => {
      const restartsAtStart = restarts;
      // Wave 4 (RX-RUN2): the file open and the page read are a sign of work, so a busy machine's slow open does not
      // count against the job's limit (renderQueue.ts JobContext.alive).
      return onPage<T>(file, pageIndex, ctx, (page) => {
        ctx.alive();
        return work(page, ctx);
      }).catch((error: unknown) => {
        throw pageFailure(error, restarts !== restartsAtStart);
      });
    },
    { ...options, priority: options.priority ?? 'run' },
  );
}

export interface PageTextContent {
  /** The text items (pdf.js marked-content items, which have no string, are left out). */
  items: TextItemLike[];
  /** Each font's style, by the items' `fontName`. */
  styles: Record<string, FontStyleLike>;
}

/** A page's text as pdf.js reads it (`getTextContent()` with its default options). */
export function pageTextContent(file: Uint8Array, pageIndex: number, options: RenderOptions = {}): Promise<PageTextContent> {
  return readPage(file, pageIndex, options, (page) => readTextContent(page));
}

export interface PageGeometryRead {
  /** pdf.js `page.view`: the visible box (CropBox within MediaBox) in user space. */
  view: [number, number, number, number];
  /** pdf.js `page.rotate`. */
  rotate: number;
  /** pdf.js `page.userUnit` (1 unless the page says otherwise). */
  userUnit: number;
}

/** Every page's visible box, turn and unit, in page order, in one job: nothing drawn, no text read. */
export function pageGeometries(file: Uint8Array, options: RenderOptions = {}): Promise<PageGeometryRead[]> {
  return schedule<PageGeometryRead[]>(
    (ctx) => {
      const restartsAtStart = restarts;
      return (async () => {
        const doc = await opener.open(file, ctx.signal);
        const geometries: PageGeometryRead[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          if (ctx.signal.aborted) throw abortError();
          const page = await doc.getPage(n);
          // Each page read is a sign of work (wave 4): a 500-page file on a busy machine is not "out of time".
          ctx.alive();
          try {
            const [x0, y0, x1, y1] = page.view;
            geometries.push({ view: [x0, y0, x1, y1], rotate: page.rotate, userUnit: page.userUnit ?? 1 });
          } finally {
            cleanUp(page);
          }
        }
        if (ctx.signal.aborted) throw abortError();
        return geometries;
      })().catch((error: unknown) => {
        throw pageFailure(error, restarts !== restartsAtStart);
      });
    },
    { ...options, priority: options.priority ?? 'run' },
  );
}

/** An annotation as pdf.js `getAnnotations()` reports it: only the fields read here. */
interface RawAnnotation {
  subtype?: string;
  rect?: number[];
  annotationFlags?: number;
  contentsObj?: { str?: unknown };
  titleObj?: { str?: unknown };
  textContent?: unknown;
  fieldValue?: unknown;
  url?: unknown;
  unsafeUrl?: unknown;
  alternativeText?: unknown;
  options?: { displayValue?: unknown; exportValue?: unknown }[];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Every string of an annotation a reader can see or a copy can carry, in a fixed order. */
function annotationText(a: RawAnnotation): AnnotationText {
  const texts: unknown[] = [a.contentsObj?.str, a.titleObj?.str];
  if (Array.isArray(a.textContent)) texts.push(...(a.textContent as unknown[]));
  if (Array.isArray(a.fieldValue)) texts.push(...(a.fieldValue as unknown[]));
  else texts.push(a.fieldValue);
  texts.push(a.url, a.unsafeUrl, a.alternativeText);
  if (Array.isArray(a.options)) for (const option of a.options) texts.push(option?.displayValue, option?.exportValue);
  return { subtype: a.subtype ?? '', rect: a.rect ? [...a.rect] : [0, 0, 0, 0], flags: a.annotationFlags ?? 0, texts: texts.filter(isText) };
}

/** A page's annotations as shown on screen (`getAnnotations({ intent: 'display' })`), with their strings. */
export function pageAnnotationTexts(file: Uint8Array, pageIndex: number, options: RenderOptions = {}): Promise<AnnotationText[]> {
  return readPage(file, pageIndex, options, async (page) => {
    const annotations = (await page.getAnnotations({ intent: 'display' })) as RawAnnotation[];
    return annotations.map(annotationText);
  });
}

export interface PagePixels {
  /** RGBA, row by row from the top-left corner. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Device pixels per point actually used: lower than asked when the page would exceed the canvas limits. */
  scale: number;
  view: [number, number, number, number];
  userUnit: number;
  /** pdf.js `viewport.transform`: user space to these pixels. */
  transform: number[];
  /** With `read` (Redact, wave 3): the operations that painted text, as pdf.js drew them. */
  textOps?: TextOp[];
}

/**
 * A page drawn unturned (rotation 0, not the page's /Rotate) on white at `scale`, held within the
 * canvas limits, with annotations and form fields as on screen, and its pixels read back. The
 * canvas is let go before the result is given; nothing is encoded.
 */
export function renderPagePixels(file: Uint8Array, pageIndex: number, scale: number, options: RenderOptions & RedactDrawOptions = {}): Promise<PagePixels> {
  return readPage(file, pageIndex, options, async (page, ctx) => {
    // The file is open and the page read: a sign of work (a busy machine opens slowly too).
    ctx.alive();
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const used = fitScale(base.width, base.height, scale).scale;
    const viewport = page.getViewport({ scale: used, rotation: 0 });
    const skip = options.skip;
    const redact = { recordOperations: options.read === true, ...(skip ? { operationsFilter: (i: number) => !skip.has(i) } : {}), heartbeat: true };
    // pdf.js records the operations' boxes only on a page proxy's first recorded drawing: start afresh.
    if (options.read) (page as unknown as { recordedBBoxes: unknown }).recordedBBoxes = null;
    // Read back, not shown: a context kept on the CPU.
    const { canvas, context } = await drawOnCanvas(page, viewport, ctx, { willReadFrequently: true }, redact);
    try {
      if (!context) throw new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.');
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const [x0, y0, x1, y1] = page.view;
      const textOps = options.read ? readDrawnOperations(page, (await loadPdfjs()) as unknown as PdfjsOps, canvas.width, canvas.height) : undefined;
      return { data, width: canvas.width, height: canvas.height, scale: used, view: [x0, y0, x1, y1], userUnit: page.userUnit ?? 1, transform: [...viewport.transform], ...(textOps ? { textOps } : {}) };
    } catch (error) {
      throw drawingFailure(error);
    } finally {
      releaseCanvas(canvas);
    }
  });
}

/** What Redact's drawings may also do (wave 3, ruling A): skip operations (pdf.js `operationsFilter`), or read the ones that paint text. */
export interface RedactDrawOptions {
  /** Operations of the page's operator list (the one this drawing executes) not to draw. */
  skip?: ReadonlySet<number>;
  /** Record where each operation paints (pdf.js `recordOperations`) and read the operations that paint text. */
  read?: boolean;
}

type PdfjsOps = { AnnotationMode: { ENABLE: number }; OPS: Record<string, number> };

/** What pdf.js's page proxy keeps after a drawing: the parts read here (testRedactRun.ts reads the same). */
interface DrawnPageProxy {
  recordedBBoxes: { length: number; isEmpty(i: number): boolean; minX(i: number): number; minY(i: number): number; maxX(i: number): number; maxY(i: number): number } | null;
  commonObjs: { has(id: string): boolean; get(id: string): unknown };
  objs: { has(id: string): boolean; get(id: string): unknown };
  _intentStates?: Map<string, { operatorList?: OperatorList }>;
  _transport?: { getRenderingIntent(intent: string, annotationMode: number): { cacheKey: string } };
}

/**
 * The operations that painted text in the drawing just made, read from the very operator list that drawing
 * executed (pdf.js keeps it in the page's display intent state; `getOperatorList()` would build another, for
 * the operator-list intent, whose indexes need not match), with each operation's recorded box in pixels.
 */
function readDrawnOperations(page: PDFPageProxy, pdfjs: PdfjsOps, width: number, height: number): TextOp[] {
  const p = page as unknown as DrawnPageProxy;
  const key = p._transport?.getRenderingIntent('display', pdfjs.AnnotationMode.ENABLE).cacheKey;
  const list = key !== undefined ? p._intentStates?.get(key)?.operatorList : undefined;
  // Not readable here: every drawing is then treated as unreadable by the run.
  if (!list) return [{ index: -1, drawing: 'page', text: '', unreadable: true, visible: true, inner: '', innerUnreadable: true, box: null, at: null }];
  const boxes = p.recordedBBoxes;
  const font = (name: string): ViewFont | null => {
    for (const pool of [p.commonObjs, p.objs]) {
      try {
        if (pool.has(name)) return pool.get(name) as ViewFont;
      } catch {
        // not resolved
      }
    }
    return null;
  };
  // A box of the whole drawing says nothing (pdf.js records that when it cannot measure the text).
  const box = (i: number) => {
    if (!boxes || i >= boxes.length || boxes.isEmpty(i)) return null;
    const b = { left: Math.floor(boxes.minX(i) * width), top: Math.floor(boxes.minY(i) * height), right: Math.ceil(boxes.maxX(i) * width), bottom: Math.ceil(boxes.maxY(i) * height) };
    return (b.right - b.left) * (b.bottom - b.top) >= 0.98 * width * height || !(b.right > b.left && b.bottom > b.top) ? null : b;
  };
  return readOperations(list, opIdsOf(pdfjs.OPS), font, box);
}

async function decodeImage(bytes: Uint8Array, mimeType: string, options?: ImageBitmapOptions): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }), options);
  } catch {
    throw new PdfToolsError('bad-image', 'This image could not be read. It may be damaged, or be in a format that is not supported.');
  }
}

/**
 * Re-encodes a WebP, BMP or GIF image (first frame) as PNG so that it can be placed in a PDF.
 * Throws PdfToolsError 'bad-image' when the bytes do not decode. The size limit is checked from
 * the header before this is called (intake.ts).
 */
export async function decodeToPng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const bitmap = await decodeImage(bytes, mimeType);
  let canvas: ReturnType<typeof createCanvas> | null = null;
  try {
    canvas = createCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new PdfToolsError('bad-image', 'This image could not be converted.');
    context.drawImage(bitmap, 0, 0);
    return await blobBytes(await canvasToBlob(canvas, 'image/png'));
  } catch (error) {
    // Encoding and memory failures are worded for page images; say it of this image instead.
    if (error instanceof PdfToolsError && (error.code === IMAGE_ENCODE_FAILED || error.code === OUT_OF_MEMORY)) {
      throw new PdfToolsError('bad-image', 'This image could not be converted. It may be too large for the memory available.');
    }
    throw error;
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}

/** Checks that an image decodes and returns its size. Throws PdfToolsError 'bad-image' otherwise. */
export async function imageSize(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number }> {
  const bitmap = await decodeImage(bytes, mimeType);
  try {
    if (!(bitmap.width > 0 && bitmap.height > 0)) throw new PdfToolsError('bad-image', 'This image is empty.');
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** A thumbnail of an image file, as an object URL the caller revokes. Shown the way Images to PDF places it. */
export function renderImageThumbnail(bytes: Uint8Array, mimeType: string, maxWidthPx: number, options: RenderOptions = {}): Promise<string> {
  return schedule<string>(
    async (ctx) => {
      // Decoding straight to the thumbnail width lets the decoder skip most of a large photo's pixels.
      const bitmap = await decodeImage(bytes, mimeType, { resizeWidth: Math.max(1, Math.round(maxWidthPx)), resizeQuality: 'medium' });
      let canvas: ReturnType<typeof createCanvas> | null = null;
      try {
        if (ctx.signal.aborted) throw abortError();
        const height = Math.min(bitmap.height, Math.round(maxWidthPx * THUMB_MAX_ASPECT));
        const width = Math.max(1, Math.round((bitmap.width * height) / bitmap.height));
        canvas = createCanvas(width, Math.max(1, height));
        const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
        if (!context) throw new PdfToolsError('bad-image', 'This image could not be shown.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return URL.createObjectURL(await canvasToBlob(canvas, 'image/png'));
      } finally {
        bitmap.close();
        releaseCanvas(canvas);
      }
    },
    options,
    revokeUrl,
  );
}

function finishRelease(): void {
  clearIdleTimer();
  releaseRequested = false;
  dropWorker();
}

/**
 * Closes the open document and stops the worker as soon as nothing is queued. Safe to call at any
 * time; a render scheduled afterwards cancels the request and starts a new worker when needed.
 */
export function releasePdfRenderer(): void {
  releaseRequested = true;
  if (!queue.busy) finishRelease();
}
