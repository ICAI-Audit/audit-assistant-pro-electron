// Make searchable (T-064, OCR part B; design 5.12): the recognition engine, `OcrEngine` of ocrTypes.ts, on
// tesseract.js 7 (Apache-2.0). English only, one worker, everything on this computer.
//
// The settings below are not choices: the OCR trial (OCR-SPIKE-report.md) found the library's defaults fail here.
// - Local files only. The worker script, the engine and the English data are read from the application's own
//   folder (public/pdf-tools/ocr, copied by scripts/sync-ocr-assets.mjs). Without the three paths the library
//   asks a public download address for them.
// - No cache. `cacheMethod: 'none'`: otherwise the library writes the English data into an IndexedDB database
//   (3.7 MB on disk). Nothing is written anywhere.
// - `workerBlobURL: false`: the worker is started straight from its file.
// - Automatic page layout (`tessedit_pageseg_mode` 3): the engine's default read 0 of 70 amounts on a ruled ledger.
// - Sauvola threshold (`thresholding_method` 2) and straightening (`rotateAuto`): a faint page read 6% of its
//   characters in a minute without, 99.9% in 4.5 s with.
// - A failed start never answers and leaves its worker running, and the library hands out no handle on the
//   worker until it is ready: the worker is caught as it is made, `errorHandler` and a time limit end the wait,
//   and the caught worker is ended.
// - Per-page time limit: past it the worker is ended (the only way to stop the engine inside a page), a fresh
//   one is started for the next page, and the page is reported as OcrPageTimedOut.
// - Stop: the worker is ended at once and the page reported as OcrStopped. The library's own promise for the
//   page never settles after that, so nothing here waits for it. (The trial: ending returns in under a
//   millisecond; the thread is gone about 2 s later.)
//
// No message of the library reaches the screen or a record: every failure becomes OcrEngineFailed, which the
// run step words (ocrForm.ts ENGINE_FAILED_MESSAGE).
import { UNSURE_CONFIDENCE } from '@/lib/pdf-tools/ocrReadable';
import { isRulingMark, OCR_RENDER_DPI, OcrPageTimedOut, OcrStopped, type OcrEngine, type RecognisedLine, type RecognisedPage, type RecognisedWord, type RecogniseOptions } from '@/lib/pdf-tools/ocrTypes';
import { blobBytes, canvasToBlob, createCanvas, releaseCanvas } from '../canvasUtils';
import { readImageHeader } from '../imageHeader';

/** How long the worker, the engine and the English data may take to load. The trial's start-ups took 0.4 to 0.9 s. */
export const OCR_START_TIME_LIMIT_MS = 30_000;

/** The engine could not start, or stopped working inside a page. Its message is for developers; the run step words it. */
export class OcrEngineFailed extends Error {
  constructor(what: string) {
    super(`The text recognition engine failed: ${what}.`);
    this.name = 'OcrEngineFailed';
  }
}

// ---- the parts of tesseract.js used here (a test stands in for them) ----------------------------------------

interface EngineBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface EngineWord {
  text: string;
  confidence: number;
  bbox: EngineBox;
}
interface EngineLine {
  bbox?: EngineBox | null;
  baseline?: EngineBox | null;
  /** The engine's own measure of the row of text (tesseract.js RowAttributes). */
  rowAttributes?: { rowHeight?: number | null } | null;
  words?: EngineWord[] | null;
}
/** The page as the library reports it with `{ text: true, blocks: true }`. */
export interface EngineData {
  blocks?: { paragraphs?: { lines?: EngineLine[] | null }[] | null }[] | null;
  rotateRadians?: number | null;
}
export interface EngineWorkerOptions {
  workerPath: string;
  corePath: string;
  langPath: string;
  gzip: true;
  cacheMethod: 'none';
  workerBlobURL: false;
  errorHandler(error: unknown): void;
  logger(message: { status?: string; progress?: number }): void;
}
export interface EngineWorker {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(image: Uint8Array, options: { rotateAuto: true }, output: { text: true; blocks: true; debug: true }): Promise<{ data: EngineData }>;
  terminate(): Promise<unknown>;
}
export interface EngineLibrary {
  createWorker(language: 'eng', engineMode: 1, options: EngineWorkerOptions): Promise<EngineWorker>;
}

export interface OcrEngineDeps {
  /** Loads the library (its own small chunk, on first use). */
  load?: () => Promise<EngineLibrary>;
  /** What the three paths are resolved against: the page's own address. */
  baseUrl?: string;
  startLimitMs?: number;
  /** Pixels to PNG bytes (the engine is handed a PNG, as the trial did). */
  encodePng?: (image: ImageData) => Promise<Uint8Array>;
}

/** What this engine takes beside the interface's options. */
export interface PageRecogniseOptions extends RecogniseOptions {
  /** The picture's resolution when it is not OCR_RENDER_DPI (a very large page drawn smaller). */
  dpi?: number;
  /** How far through the page the engine is, 0 to 1, for a bar that moves inside a page. */
  onProgress?(share: number): void;
}

export interface StartOptions {
  signal?: AbortSignal;
}

/** The engine with its start made explicit, so the run can say "Getting the text reader ready…" first. */
export interface AppOcrEngine extends OcrEngine {
  /** Starts the worker (once). Rejects with OcrEngineFailed, or OcrStopped when `signal` fires first. */
  start(options?: StartOptions): Promise<void>;
  recognise(image: ImageData | Uint8Array, options: PageRecogniseOptions): Promise<RecognisedPage>;
}

async function loadLibrary(): Promise<EngineLibrary> {
  const module = (await import('tesseract.js')) as unknown as { createWorker?: unknown; default?: { createWorker?: unknown } };
  const createWorker = module.createWorker ?? module.default?.createWorker;
  if (typeof createWorker !== 'function') throw new Error('no createWorker');
  return { createWorker: createWorker as EngineLibrary['createWorker'] };
}

async function encodeAsPng(image: ImageData): Promise<Uint8Array> {
  const canvas = createCanvas(image.width, image.height);
  try {
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error('no canvas');
    context.putImageData(image, 0, 0);
    return await blobBytes(await canvasToBlob(canvas, 'image/png'));
  } finally {
    releaseCanvas(canvas);
  }
}

/** The settings every page is read with; `dpi` is the picture's resolution. */
export const engineParameters = (dpi: number): Record<string, string> => ({
  tessedit_pageseg_mode: '3',
  thresholding_method: '2',
  user_defined_dpi: String(Math.round(dpi)),
});

const isBox = (b: EngineBox | null | undefined): b is EngineBox => !!b && [b.x0, b.y0, b.x1, b.y1].every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Where a word stands: the line's baseline under the middle of the word (the trial's text layer did the same), or
 * the word's own bottom when the line gives no baseline, or gives one that misses the word. A baseline belongs
 * between the middle of a word's box and just under its bottom (a descender reaches below it); on a ruled page
 * scanned askew the engine can give two rows as one line with one baseline, and half the words hang below it.
 * Only a word with a letter or a digit is moved: a hyphen or a quotation mark floats above the baseline by nature.
 */
function baselineUnder(line: EngineLine, word: EngineWord): number {
  const box = word.bbox;
  const b = line.baseline;
  if (!isBox(b) || b.x1 === b.x0) return box.y1;
  const centre = (box.x0 + box.x1) / 2;
  const baseline = b.y0 + ((b.y1 - b.y0) * (centre - b.x0)) / (b.x1 - b.x0);
  if (!LETTER_OR_DIGIT.test(word.text)) return baseline;
  const height = box.y1 - box.y0;
  return baseline >= box.y0 + height / 2 && baseline <= box.y1 + height * BELOW_BASELINE_SHARE ? baseline : box.y1;
}
/** How far under a word's bottom its line's baseline may still be its own, as a share of the word's height. */
const BELOW_BASELINE_SHARE = 0.15;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * What the two measures of a line's text are of its font size, as medians over 1,179 lines of 36 scans whose true
 * font sizes were known (OCR-C-report.md): the engine's row height is 0.96 of it, the height of a word above the
 * baseline 0.75 of it.
 */
export const ROW_HEIGHT_SHARE = 0.96;
export const ASCENT_SHARE = 0.75;

/**
 * The size of a line's text in pixels: the smaller of what the engine's row height says and what the middle one
 * of the given heights above the baseline says (pass those of the line's confident words); whichever there is
 * when one is missing; undefined when neither is usable.
 *
 * The line's box is not used. Wherever a mark of the neighbouring line touches a line (lines printed close, an
 * accent or a descender above), the box takes the mark in: on the same 1,179 lines the box was more than 25%
 * off on 36% (up to three times too tall), the row height on 10%, the words' height on 12%, the smaller of the
 * two on 9% (4% on ordinary office scans). Text sized from a swollen box is selected as a bar across two lines,
 * and a reader that sorts text by position weaves the two lines together.
 */
export function lineTextSize(rowHeight: number | null | undefined, ascents: readonly number[]): number | undefined {
  const fromRow = typeof rowHeight === 'number' && Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight / ROW_HEIGHT_SHARE : undefined;
  const heights = ascents.filter((a) => Number.isFinite(a) && a > 0).sort((a, b) => a - b);
  const middle = heights.length === 0 ? undefined : heights.length % 2 === 1 ? heights[(heights.length - 1) / 2] : (heights[heights.length / 2 - 1] + heights[heights.length / 2]) / 2;
  const fromWords = middle === undefined ? undefined : middle / ASCENT_SHARE;
  if (fromRow === undefined) return fromWords;
  return fromWords === undefined ? fromRow : Math.min(fromRow, fromWords);
}

const usableWord = (word: EngineWord | null | undefined): word is EngineWord => !!word && typeof word.text === 'string' && isBox(word.bbox);

/**
 * The text size of an engine line: measured on its confident words, on every word when none is confident; never
 * on ruling marks or on punctuation standing alone.
 */
function sizeOfLine(line: EngineLine): number | undefined {
  const words = (line.words ?? []).filter(usableWord).filter((word) => LETTER_OR_DIGIT.test(word.text) && !isRulingMark(word.text));
  const confident = words.filter((word) => Number(word.confidence) >= UNSURE_CONFIDENCE);
  const measured = (confident.length > 0 ? confident : words).map((word) => baselineUnder(line, word) - word.bbox.y0);
  return lineTextSize(line.rowAttributes?.rowHeight, measured);
}

/** The library's page as a RecognisedPage: every word, in the engine's reading order, with its line (box, baseline, number, text size). */
export function pageFromEngine(data: EngineData, picture: { width: number; height: number }, seconds: number): RecognisedPage {
  const words: RecognisedWord[] = [];
  let index = -1;
  for (const block of data.blocks ?? []) {
    for (const paragraph of block?.paragraphs ?? []) {
      for (const line of paragraph?.lines ?? []) {
        if (!line) continue;
        index += 1;
        const boxed = isBox(line.bbox) && line.bbox.y1 > line.bbox.y0 ? line.bbox : null;
        const size = boxed ? sizeOfLine(line) : undefined;
        for (const word of line.words ?? []) {
          if (!usableWord(word)) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          const on: RecognisedLine | undefined = boxed ? { y0: boxed.y0, y1: boxed.y1, baseline: baselineUnder(line, word), index, ...(size === undefined ? {} : { size }) } : undefined;
          words.push({ text: word.text, x0, y0, x1, y1, confidence: Number(word.confidence), ...(on ? { line: on } : {}) });
        }
      }
    }
  }
  const angle = typeof data.rotateRadians === 'number' && Number.isFinite(data.rotateRadians) ? data.rotateRadians : 0;
  return { words, angle, widthPx: picture.width, heightPx: picture.height, seconds };
}

/** A worker of the browser, as far as it is used here. */
interface RawWorker {
  terminate(): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
}

/**
 * Runs `make` and returns the worker it constructed while it ran (the first), if any. tesseract.js makes its
 * worker inside `createWorker` before it first waits, and gives no handle on it when start-up then fails. The
 * global is put back before this returns.
 */
function catchWorker<T>(make: () => T): { made: T; raw: RawWorker | null } {
  const scope = globalThis as unknown as { Worker?: new (...args: never[]) => RawWorker };
  const Original = scope.Worker;
  if (typeof Original !== 'function') return { made: make(), raw: null };
  const caught: RawWorker[] = [];
  const Catching = class extends Original {
    constructor(...args: never[]) {
      super(...args);
      caught.push(this);
    }
  };
  scope.Worker = Catching;
  try {
    const made = make();
    return { made, raw: caught[0] ?? null };
  } finally {
    scope.Worker = Original;
  }
}

/** One worker: what the library gave, the browser's own handle, and who is waiting on it now. */
interface Slot {
  worker: EngineWorker | null;
  raw: RawWorker | null;
  ended: boolean;
  dpi: number;
  onError: ((error: unknown) => void) | null;
  onProgress: ((share: number) => void) | null;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const quietly = (work: () => unknown): void => {
  try {
    const result = work();
    if (result && typeof (result as Promise<unknown>).then === 'function') (result as Promise<unknown>).then(undefined, () => undefined);
  } catch {
    // already gone
  }
};

export function createOcrEngine(deps: OcrEngineDeps = {}): AppOcrEngine {
  const load = deps.load ?? loadLibrary;
  const startLimitMs = deps.startLimitMs ?? OCR_START_TIME_LIMIT_MS;
  const encodePng = deps.encodePng ?? encodeAsPng;
  const asset = (path: string) => new URL(`./pdf-tools/ocr/${path}`, deps.baseUrl ?? document.baseURI).href;

  const slots = new Set<Slot>();
  let ready: Slot | null = null;
  let starting: Promise<Slot> | null = null;
  let closed = false;
  /** Ends the page in progress as stopped (close during a page). */
  let stopPage: (() => void) | null = null;

  /** Ends a worker: through the library when it gave one, else the worker caught as it was made. Never waits. */
  function end(slot: Slot): void {
    if (slot.ended) return;
    slot.ended = true;
    slot.onError = null;
    slot.onProgress = null;
    slots.delete(slot);
    if (ready === slot) ready = null;
    if (slot.worker) quietly(() => slot.worker!.terminate());
    else if (slot.raw) quietly(() => slot.raw!.terminate());
  }

  async function startOne(): Promise<Slot> {
    const slot: Slot = { worker: null, raw: null, ended: false, dpi: OCR_RENDER_DPI, onError: null, onProgress: null };
    slots.add(slot);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const failed = new Promise<never>((_, reject) => {
        slot.onError = () => reject(new OcrEngineFailed('start-up reported an error'));
        timer = setTimeout(() => reject(new OcrEngineFailed('start-up did not answer in time')), startLimitMs);
      });
      failed.catch(() => undefined);
      const library = await Promise.race([load(), failed]);
      if (closed || slot.ended) throw new OcrEngineFailed('closed while starting');
      const options: EngineWorkerOptions = {
        workerPath: asset('worker.min.js'),
        corePath: asset('core'), // a folder: the worker picks the engine file for this processor
        langPath: asset('eng'), // holds eng.traineddata.gz
        gzip: true,
        cacheMethod: 'none',
        workerBlobURL: false,
        errorHandler: (error) => slot.onError?.(error),
        logger: (message) => {
          if (message?.status === 'recognizing text' && typeof message.progress === 'number') slot.onProgress?.(message.progress);
        },
      };
      const { made, raw } = catchWorker(() => library.createWorker('eng', 1, options));
      slot.raw = raw;
      raw?.addEventListener('error', (event) => {
        event.preventDefault?.();
        slot.onError?.(event);
      });
      // A start that finishes after it was given up (time limit, Stop, close) is ended as it arrives.
      made.then(
        (worker) => {
          slot.worker = worker;
          if (slot.ended) quietly(() => worker.terminate());
        },
        () => undefined,
      );
      const worker = await Promise.race([made, failed]);
      await Promise.race([worker.setParameters(engineParameters(slot.dpi)), failed]);
      if (closed || slot.ended) throw new OcrEngineFailed('closed while starting');
      slot.onError = null;
      return slot;
    } catch (error) {
      end(slot);
      throw error instanceof OcrEngineFailed ? error : new OcrEngineFailed('start-up failed');
    } finally {
      clearTimeout(timer);
    }
  }

  /** The worker, started if need be (one start at a time; a failed start may be tried again). */
  function begin(): Promise<Slot> {
    if (ready) return Promise.resolve(ready);
    if (!starting) {
      const attempt = startOne().then(
        (slot) => {
          if (starting === attempt) starting = null;
          ready = slot;
          return slot;
        },
        (error: unknown) => {
          if (starting === attempt) starting = null;
          throw error;
        },
      );
      attempt.catch(() => undefined);
      starting = attempt;
    }
    return starting;
  }

  /** `begin()`, given up at once when Stop is pressed (the worker being started is ended as it arrives, or by close). */
  function beginUnlessStopped(signal?: AbortSignal): Promise<Slot> {
    if (closed) return Promise.reject(new OcrEngineFailed('closed'));
    if (signal?.aborted) return Promise.reject(new OcrStopped());
    const started = begin();
    if (!signal) return started;
    return new Promise<Slot>((resolve, reject) => {
      const onAbort = () => {
        // The start in progress is of no use now: end every worker, started or starting.
        for (const slot of [...slots]) end(slot);
        reject(new OcrStopped());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      started.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  async function picture(image: ImageData | Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    let bytes: Uint8Array;
    try {
      bytes = image instanceof Uint8Array ? image : await encodePng(image);
    } catch {
      throw new OcrEngineFailed('the page picture could not be encoded');
    }
    const header = readImageHeader(bytes);
    if (!header) throw new OcrEngineFailed('the page picture has no readable size');
    return { bytes, width: header.width, height: header.height };
  }

  return {
    async start(options = {}) {
      await beginUnlessStopped(options.signal);
    },

    async recognise(image, options) {
      const { signal, timeoutMs } = options;
      if (closed) throw new OcrEngineFailed('closed');
      if (signal?.aborted) throw new OcrStopped();
      const page = await picture(image);
      const slot = await beginUnlessStopped(signal);
      const worker = slot.worker!;
      const dpi = options.dpi && options.dpi > 0 ? Math.round(options.dpi) : OCR_RENDER_DPI;

      return new Promise<RecognisedPage>((resolve, reject) => {
        let settled = false;
        const settle = (finish: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onStop);
          slot.onError = null;
          slot.onProgress = null;
          if (stopPage === onStop) stopPage = null;
          finish();
        };
        const onStop = () =>
          settle(() => {
            end(slot);
            reject(new OcrStopped());
          });
        const fail = (what: string) =>
          settle(() => {
            end(slot);
            reject(new OcrEngineFailed(what));
          });
        const timer = setTimeout(
          () =>
            settle(() => {
              // The engine cannot be interrupted inside a page: its worker is ended and a fresh one started
              // for the next page (its start is awaited there).
              end(slot);
              if (!closed) void begin().catch(() => undefined);
              reject(new OcrPageTimedOut(timeoutMs));
            }),
          timeoutMs,
        );
        signal?.addEventListener('abort', onStop, { once: true });
        stopPage = onStop;
        slot.onError = () => fail('a page reported an error');
        slot.onProgress = options.onProgress ? (share) => options.onProgress!(share) : null;

        const started = now();
        (async () => {
          if (slot.dpi !== dpi) {
            await worker.setParameters(engineParameters(dpi));
            slot.dpi = dpi;
          }
          if (settled) return null;
          // `debug`: the engine keeps its own notes on the page ("Detected 12 diacritics", counts only) with the result,
          // which is not read here, instead of writing them to the console as errors.
          return worker.recognize(page.bytes, { rotateAuto: true }, { text: true, blocks: true, debug: true });
        })().then(
          (result) => {
            if (!result) return;
            settle(() => {
              try {
                resolve(pageFromEngine(result.data ?? {}, page, (now() - started) / 1000));
              } catch {
                end(slot);
                reject(new OcrEngineFailed('a page came back in an unknown shape'));
              }
            });
          },
          () => fail('a page was rejected'),
        );
      });
    },

    async close() {
      closed = true;
      stopPage?.();
      for (const slot of [...slots]) end(slot);
      starting = null;
    },
  };
}

/** Opens an engine ready to read: what the run step is given (a test passes a stand-in). */
export type OpenEngine = (options: StartOptions) => Promise<AppOcrEngine | OcrEngine>;

/** The application's engine, started. Rejects with OcrEngineFailed or OcrStopped; a failed start leaves no worker. */
export const openAppEngine: OpenEngine = async (options) => {
  const engine = createOcrEngine();
  try {
    await engine.start(options);
  } catch (error) {
    await engine.close();
    throw error;
  }
  return engine;
};
