// Page rendering for PDF Tools, built on pdfjs-dist. Everything here runs locally:
//
// - pdfjs is imported on first use, and one worker is shared by every render. The worker is
//   created here and handed to pdfjs as a port: from a file:// page pdfjs would otherwise wrap
//   it in a blob: worker, which Electron does not load, and drop to parsing on the main thread.
// - Character maps, standard fonts, wasm decoders and the CMYK profile come from
//   public/pdf-tools/pdfjs (copied by scripts/sync-pdfjs-assets.mjs). Nothing else is fetched:
//   no annotation or XFA layer is created, scripts are not evaluated, and document data is
//   always passed as bytes, never as a URL.
// - Renders go through renderQueue: one at a time, a tool run's pages first, then page-panel
//   tiles, then list thumbnails, each cancellable and limited in time. The most recently used
//   document stays open while renders for it continue and is destroyed when another file is
//   needed or after a short idle time.
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PDFWorker, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { blobBytes, canvasToBlob, createCanvas, drawingFailure, fitScale, IMAGE_ENCODE_FAILED, OUT_OF_MEMORY, releaseCanvas, yieldToUi } from './canvasUtils';
import { createDocOpener } from './docOpener';
import { abortError, createRenderQueue, isAbortError, type JobContext, type Priority } from './renderQueue';

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
  /** 'run' for a tool run's pages; 'high' for what the user is looking at closely (the page panel); list thumbnails are 'normal'. */
  priority?: Priority;
  /** Called when the render actually starts (it may wait in the queue first). */
  onStart?: () => void;
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
let shared: { pdfWorker: PDFWorker; worker: Worker; failed: Promise<never> } | null = null;
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
  between: yieldToUi,
  onDrained: () => {
    if (releaseRequested) {
      finishRelease();
      return;
    }
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
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
  const failed = new Promise<never>((_, reject) => {
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      reject(unavailable());
      if (shared?.worker === worker) dropWorker();
    });
  });
  failed.catch(() => undefined);
  shared = { pdfWorker, worker, failed };
  return shared;
}

/** Stops the worker and forgets the open document; the next render starts afresh. */
function dropWorker(): void {
  restarts += 1;
  // An open in progress fails now: say it was the restart, not the file.
  restarting = true;
  try {
    opener.reset();
  } finally {
    restarting = false;
  }
  if (!shared) return;
  shared.pdfWorker.destroy();
  shared.worker.terminate();
  shared = null;
}

// One document open at a time, kept while renders for it continue (see docOpener.ts).
const opener = createDocOpener<PDFDocumentProxy, Worker>({
  async start(bytes) {
    const pdfjs = await loadPdfjs();
    const { pdfWorker, worker, failed } = sharedWorker(pdfjs);
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
    return { promise: task.promise, destroy: () => task.destroy(), worker, failed };
  },
  currentWorker: () => shared?.worker ?? null,
  dropWorker: () => dropWorker(),
  timeoutMs: OPEN_TIMEOUT_MS,
  timeoutError: () => openTimeoutError(),
  failure: (error) => openFailure(error, restarting),
  abortError,
});

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
  return queue.schedule(run, { signal: options.signal, priority: options.priority, onStart: options.onStart, dispose });
}

const revokeUrl = (value: string) => URL.revokeObjectURL(value);

async function drawPage(page: PDFPageProxy, scale: number, ctx: JobContext): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  let task: RenderTask | null = null;
  try {
    task = page.render({ canvas, viewport, background: 'rgb(255,255,255)' });
    ctx.setCancel(() => task?.cancel());
    await task.promise;
    if (ctx.signal.aborted) throw abortError();
    return canvas;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
}

async function onPage<T>(bytes: Uint8Array, pageIndex: number, ctx: JobContext, work: (page: PDFPageProxy) => Promise<T>): Promise<T> {
  const doc = await opener.open(bytes, ctx.signal);
  if (ctx.signal.aborted) throw abortError();
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) {
    throw new PdfToolsError('render-failed', `This file has no page ${pageIndex + 1}.`);
  }
  const page = await doc.getPage(pageIndex + 1);
  try {
    if (ctx.signal.aborted) throw abortError();
    return await work(page);
  } finally {
    page.cleanup();
  }
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
