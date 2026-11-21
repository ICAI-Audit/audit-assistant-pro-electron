// Make searchable (OCR, T-064, F-030; contract section 6; design 5.12): the recogniser's interface and the
// shapes shared by the page plan (ocrPlan.ts), the invisible text layer (ocrLayer.ts), the reliability figures
// (ocrQuality.ts) and the result's words (components/pdf-tools/ocr/ocrForm.ts).
//
// Part A builds everything that does not need the recognition engine. Part B implements `OcrEngine` on the
// engine (a worker, fully offline) and wires the run and the dialog. Nothing here imports the engine.
//
// Units: a recognised word's box is in pixels of the page picture as it was handed to the engine (origin at
// the top-left of the page as displayed, after /Rotate and the crop box; y down). When the engine straightened
// the picture first, the boxes are in the straightened picture and `RecognisedPage.angle` says by how much it
// was turned (OCR-SPIKE-report.md concern 6: the text layer turns them back).

/** The line a word sits on, as the engine reports it (pixels, straightened picture). */
export interface RecognisedLine {
  /** Top and bottom of the line's box: the text layer sizes every word of the line from this height. */
  y0: number;
  y1: number;
  /** The line's baseline under the middle of this word (the engine gives the baseline as a slope; part B evaluates it at the word's centre). */
  baseline: number;
  /**
   * The line's number on the page, from 0, in reading order: the words of one line share it. With it the text
   * layer writes a space between neighbouring words of a line, and a line the engine could mostly not read is
   * left out as a whole (ocrReadable.ts).
   */
  index?: number;
  /**
   * The size of the line's text in pixels, as measured by the engine adapter (ocrEngine.ts lineTextSize), when
   * it could be measured. The line's box is no measure of it: wherever a mark of a neighbouring line touches
   * the line, the box takes that mark in and is up to three times too tall. Without it the box height is used.
   */
  size?: number;
}

export interface RecognisedWord {
  text: string;
  /** The word's box: left, top, right, bottom, in pixels of the (straightened) picture. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The engine's own confidence in the word, 0 to 100. */
  confidence: number;
  /**
   * The word's line, when the engine gives one (it does with its block output). With it, words of one line
   * share one size and baseline, which keeps a line together for text selection and extraction and puts the
   * baseline above descenders; without it the word's own box is used (bottom as baseline). Added to the
   * proposed shape because the trial's measured accuracy (spike section 6) was made with line boxes.
   */
  line?: RecognisedLine;
}

export interface RecognisedPage {
  /** In the engine's reading order (blocks, paragraphs, lines); the text layer keeps this order. */
  words: RecognisedWord[];
  /**
   * Radians by which the engine turned the picture to straighten it, exactly as tesseract.js reports
   * `rotateRadians` (0 when it did not). On a page scanned 2 degrees clockwise the trial read -0.0349.
   * The engine turns about the picture's centre and keeps its size.
   */
  angle: number;
  /** Size of the picture handed to the engine, in pixels: the whole page as displayed. */
  widthPx: number;
  heightPx: number;
  /** How long the page took, for the record of timings only (never shown as a promise). */
  seconds: number;
}

export interface RecogniseOptions {
  /** Stop: the engine is ended at once and the promise rejects with OcrStopped (the spike: ending takes about 2 s in the background, the run must not wait for it). */
  signal?: AbortSignal;
  /** The per-page time limit: past it the promise rejects with OcrPageTimedOut and the engine is ready for the next page. */
  timeoutMs: number;
}

/**
 * What part B implements on the recognition engine (English only, every file loaded from the application's
 * own folder, no cache written). `image` is the page picture: pixels, or PNG bytes. One engine serves a whole
 * run, one page at a time; `close` ends it and is safe to call twice.
 */
export interface OcrEngine {
  recognise(image: ImageData | Uint8Array, opts: RecogniseOptions): Promise<RecognisedPage>;
  close(): Promise<void>;
}

/** A page that ran out of time: it is left as it was, and named in the result's message. */
export class OcrPageTimedOut extends Error {
  readonly limitMs: number;
  constructor(limitMs: number) {
    super(`The page was not recognised within ${Math.round(limitMs / 1000)} seconds.`);
    this.name = 'OcrPageTimedOut';
    this.limitMs = limitMs;
  }
}

/** The run was stopped while a page was being recognised: nothing is added. */
export class OcrStopped extends Error {
  constructor() {
    super('Recognition was stopped.');
    this.name = 'OcrStopped';
  }
}

/** The page picture's resolution. The trial read 70 of 70 amounts at 300 dpi and 68 of 70 at 200 dpi (spike section 5). */
export const OCR_RENDER_DPI = 300;

/**
 * Per-page time limit. The slowest good page in the trial took 15.7 s on a busy 2-core machine (spike section 4,
 * ledger at 300 dpi), a faint page under the wrong settings 620 s. A minute is four times the slowest good
 * page, so a slow machine does not lose good pages, and a page that would take ten minutes is given up.
 */
export const OCR_PAGE_TIME_LIMIT_MS = 60_000;

/**
 * What the dialog promises, roughly, as a range: the trial's quiet runs took 3.3 to 7.1 s a page at 300 dpi, its
 * runs on a busy machine up to 15.7 s (a ruled ledger); in the application ruled ledgers then took 9 to 19 s.
 * Ruling of 18 November 2026: "about 5 to 20 seconds a page".
 */
export const SECONDS_PER_PAGE = { low: 5, high: 20 } as const;

/**
 * Words that are only marks of ruling lines: the engine reads each ruled column line as a `|` word (34 a page on
 * the trial's ledger), and rules as runs of `_` or of two or more em dashes. They are left out of the text layer
 * and of the counts. A single em dash is kept: statements use it for "nil".
 */
export function isRulingMark(text: string): boolean {
  const t = text.trim();
  return /^[|¦_—―─-╿]+$/u.test(t) && !/^[—―]$/u.test(t);
}

/** What adding the text layer to one page did. Counts only. */
export interface LayerReport {
  /** Words added as invisible text. */
  wordsPlaced: number;
  /** Words left out because they are only ruling-line marks. */
  rulingMarks: number;
  /** Words left out because none of their characters can be written in the standard font (any script but Latin). */
  wordsUnprintable: number;
  /** Characters left out of placed or unprintable words because the standard font cannot write them (₹, ﬁ, Devanagari). */
  charactersDropped: number;
  /** Words left out because their box is unusable (no width or height, or not a number). */
  wordsBadBox: number;
}

export const emptyLayerReport = (): LayerReport => ({ wordsPlaced: 0, rulingMarks: 0, wordsUnprintable: 0, charactersDropped: 0, wordsBadBox: 0 });
