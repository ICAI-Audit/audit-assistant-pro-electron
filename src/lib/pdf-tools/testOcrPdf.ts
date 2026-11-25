// Invented fixtures for Make searchable (T-064, OCR part A). Built with pdf-lib: a "scan" is a page drawn over by one
// opaque picture the size of the page (no renderer is available to bake text into it), and the words the engine
// would have recognised are supplied here as test data, in pixels of the page picture at FIXTURE_DPI. Every name,
// number and word is invented.
//
// Each page also says where its words' ink is (`expected`, display points, y down), so a test can read the
// searchable copy back with pdf.js and compare. On the straightened pages the ink is where the picture was turned
// to, worked out from how the picture was made, not from the text layer's own arithmetic.
import { concatTransformationMatrix, degrees, drawObject, PDFDocument, PDFName, popGraphicsState, pushGraphicsState, StandardFonts, type PDFPage } from 'pdf-lib';
import type { PageKind } from './ocrPlan';
import type { RecognisedLine, RecognisedPage, RecognisedWord } from './ocrTypes';

export const FIXTURE_DPI = 300;
const PX_PER_PT = FIXTURE_DPI / 72;
/** A4 at a size that is a whole number of pixels at 300 dpi (2480 x 3508), so the picture's scale is exact. */
export const A4: [number, number] = [595.2, 841.92];

/** Where a word's ink is on the page as displayed (points, origin top-left, y down): its baseline from start to end, and its size. */
export interface ExpectedWord {
  text: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** The font size the layer should use: the line's height, or the word's when there is no line. */
  size: number;
}

export interface OcrFixturePage {
  pageIndex: number;
  /** What the plan should call the page. */
  kind: PageKind;
  /** What the engine would give for the page; null for a page that is not recognised. */
  recognised: RecognisedPage | null;
  /** The words the text layer should place, in order (ruling marks and unprintable words left out). */
  expected: ExpectedWord[];
}

export interface OcrFixture {
  bytes: Uint8Array;
  pages: OcrFixturePage[];
}

export type OcrFixtureName = 'scan' | 'letter' | 'mixed' | 'rotated' | 'cropped' | 'skewed' | 'trial-skew';
export const OCR_FIXTURE_NAMES: readonly OcrFixtureName[] = ['scan', 'letter', 'mixed', 'rotated', 'cropped', 'skewed', 'trial-skew'];

/** Draws one opaque grey picture over the whole media box: what a scanner writes. */
export function addScanPicture(page: PDFPage, name = 'Scan1'): void {
  const doc = page.doc;
  const image = doc.context.register(
    doc.context.stream(new Uint8Array([200, 190, 210, 180]), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
  );
  page.node.setXObject(PDFName.of(name), image);
  const { x, y, width, height } = page.getMediaBox();
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, x, y), drawObject(name), popGraphicsState());
}

// ---- laying out invented words --------------------------------------------------------------------------

interface LineSpec {
  top: number;
  height: number;
  words: { text: string; width?: number; confidence?: number }[];
}
interface Laid {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  line?: RecognisedLine;
}

/** Lays lines of words from `left`, in display points; a word's width is about half its height per character unless given. */
function layWords(lines: readonly LineSpec[], opts: { left: number; gap: number; withLines: boolean }): Laid[] {
  const out: Laid[] = [];
  for (const spec of lines) {
    let x = opts.left;
    const descent = spec.height * 0.25;
    const line: RecognisedLine | undefined = opts.withLines ? { y0: spec.top, y1: spec.top + spec.height + descent, baseline: spec.top + spec.height } : undefined;
    for (const w of spec.words) {
      const width = w.width ?? [...w.text].length * spec.height * 0.55;
      out.push({ text: w.text, confidence: w.confidence ?? 95, x0: x, y0: spec.top, x1: x + width, y1: spec.top + spec.height, ...(line ? { line } : {}) });
      x += width + opts.gap;
    }
  }
  return out;
}

const toPx = (laid: readonly Laid[]): RecognisedWord[] =>
  laid.map((w) => ({
    text: w.text,
    confidence: w.confidence,
    x0: w.x0 * PX_PER_PT,
    y0: w.y0 * PX_PER_PT,
    x1: w.x1 * PX_PER_PT,
    y1: w.y1 * PX_PER_PT,
    ...(w.line ? { line: { y0: w.line.y0 * PX_PER_PT, y1: w.line.y1 * PX_PER_PT, baseline: w.line.baseline * PX_PER_PT } } : {}),
  }));

const pageOf = (words: RecognisedWord[], shown: [number, number], angle = 0): RecognisedPage => ({
  words,
  angle,
  widthPx: Math.round(shown[0] * PX_PER_PT),
  heightPx: Math.round(shown[1] * PX_PER_PT),
  seconds: 4.2,
});

/** What the layer should place for a laid word: the printable text, on the baseline from left to right. */
function expectedOf(w: Laid, text = w.text): ExpectedWord {
  const baseline = w.line ? w.line.baseline : w.y1;
  const size = w.line ? w.line.y1 - w.line.y0 : w.y1 - w.y0;
  return { text, start: { x: w.x0, y: baseline }, end: { x: w.x1, y: baseline }, size };
}

const PLACEABLE = (w: Laid) => w.text !== '|' && w.text !== '____' && !/[ऀ-ॿ]/u.test(w.text);

// An invented supplier letter and ledger lines. Wide gaps (1.2 x the height) keep each word its own pdf.js item,
// so a test can read each word's box; `letter` has ordinary gaps for reading order.
const LETTER: LineSpec[] = [
  { top: 72, height: 14, words: [{ text: 'Nirvexa' }, { text: 'Traders' }, { text: 'Private' }, { text: 'Limited' }] },
  { top: 100, height: 10, words: [{ text: 'Invoice' }, { text: 'NX/2291' }, { text: 'dated' }, { text: '14-08-2025' }] },
  { top: 124, height: 10, words: [{ text: 'Amount' }, { text: 'payable' }, { text: 'Rs.' }, { text: '1,23,456.78', confidence: 71 }] },
];
const SCAN_LINES: LineSpec[] = [
  ...LETTER,
  // A ruled column line read as a word, an amount with the rupee sign, a word in another script, a rule.
  { top: 148, height: 10, words: [{ text: 'Freight' }, { text: '|' }, { text: '₹2,950.00', confidence: 64 }, { text: 'नमस्ते' }, { text: '____' }] },
];

async function scanPage(doc: PDFDocument, size: [number, number], setup?: (page: PDFPage) => void): Promise<PDFPage> {
  const page = doc.addPage(size);
  setup?.(page);
  addScanPicture(page);
  return page;
}

/** Turns a point about the picture's centre by `deg` degrees, clockwise as seen (y down): how the skewed picture was made. */
function turn(p: { x: number; y: number }, centre: { x: number; y: number }, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return { x: centre.x + dx * Math.cos(a) - dy * Math.sin(a), y: centre.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/**
 * Twelve words from the OCR trial's skewed ledger (an invented ledger, scanned 2 degrees clockwise at 300 dpi;
 * OCR-SPIKE-report.md concern 6): the box the engine gave after straightening, its line box and baseline, and the
 * same word's box on the unskewed page. The engine reported `rotateRadians` -0.034877926111221313.
 */
export const TRIAL_SKEW = {
  widthPx: 2480,
  heightPx: 3508,
  rotateRadians: -0.034877926111221313,
  /** [text, straightened box, box on the unskewed page, line top, line bottom, baseline] */
  words: [
    ['Zentharo', [167, 172, 379, 208], [167, 172, 379, 208], 172, 218, 208],
    ['Limited', [755, 172, 926, 208], [755, 172, 926, 208], 172, 218, 208],
    ['Ledger', [170, 245, 297, 283], [170, 245, 297, 283], 245, 283, 275],
    ['Halvick', [480, 245, 611, 275], [480, 245, 611, 275], 245, 283, 275],
    ['Castings', [625, 245, 784, 283], [625, 245, 784, 283], 245, 283, 275],
    ['Forgings', [881, 245, 1038, 283], [881, 245, 1038, 283], 245, 283, 275],
    ['Particulars', [661, 402, 851, 445], [661, 402, 851, 445], 402, 445, 433],
    ['Credit', [1741, 406, 1848, 433], [1741, 406, 1848, 433], 402, 445, 433],
    ['Balance', [2065, 406, 2205, 433], [2065, 406, 2205, 433], 402, 445, 433],
    ['Opening', [660, 481, 798, 516], [660, 481, 798, 516], 481, 516, 508],
    ['charges', [789, 1831, 920, 1866], [789, 1831, 920, 1866], 1831, 1866, 1858],
    ['Closing', [660, 3106, 794, 3141], [660, 3106, 794, 3141], 3106, 3141, 3133],
  ] as [string, number[], number[], number, number, number][],
};

export async function ocrFixture(name: OcrFixtureName): Promise<OcrFixture> {
  const doc = await PDFDocument.create();
  const pages: OcrFixturePage[] = [];
  const wide = { left: 60, gap: 0, withLines: false };

  if (name === 'scan' || name === 'letter') {
    await scanPage(doc, A4);
    const laid = name === 'scan' ? layWords(SCAN_LINES, { left: 60, gap: 20, withLines: true }) : layWords(LETTER, { left: 60, gap: 3.5, withLines: false });
    const expected = laid.filter(PLACEABLE).map((w) => expectedOf(w, w.text.replace('₹', '')));
    pages.push({ pageIndex: 0, kind: 'scanned', recognised: pageOf(toPx(laid), A4), expected });
  } else if (name === 'mixed') {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage(A4).drawText('Statement of account for the quarter ended 30 June 2025', { x: 60, y: 760, size: 11, font });
    await scanPage(doc, A4);
    doc.addPage(A4); // nothing on it
    const laid = layWords(LETTER.slice(0, 2), { ...wide, gap: 18 });
    pages.push({ pageIndex: 0, kind: 'text', recognised: null, expected: [] });
    pages.push({ pageIndex: 1, kind: 'scanned', recognised: pageOf(toPx(laid), A4), expected: laid.map((w) => expectedOf(w)) });
    pages.push({ pageIndex: 2, kind: 'empty', recognised: null, expected: [] });
  } else if (name === 'rotated') {
    // Stored portrait, shown landscape: the picture handed to the engine is the page as shown.
    await scanPage(doc, A4, (page) => page.setRotation(degrees(90)));
    const shown: [number, number] = [A4[1], A4[0]];
    const laid = layWords(LETTER, { ...wide, gap: 18 });
    pages.push({ pageIndex: 0, kind: 'scanned', recognised: pageOf(toPx(laid), shown), expected: laid.map((w) => expectedOf(w)) });
  } else if (name === 'cropped') {
    // A US letter scan cropped by 36 pt at the sides and 48 pt at top and bottom: shown as 540 x 696 pt.
    await scanPage(doc, [612, 792], (page) => page.setCropBox(36, 48, 540, 696));
    const laid = layWords(LETTER, { ...wide, gap: 18 });
    pages.push({ pageIndex: 0, kind: 'scanned', recognised: pageOf(toPx(laid), [540, 696]), expected: laid.map((w) => expectedOf(w)) });
  } else if (name === 'skewed') {
    // Scanned 2 degrees clockwise: the engine straightened the picture (angle -2 degrees, as the trial's engine
    // reports it) and gave the boxes in the straightened picture; the ink is turned 2 degrees about the centre.
    await scanPage(doc, A4);
    const laid = layWords(LETTER, { ...wide, gap: 18 });
    const centre = { x: A4[0] / 2, y: A4[1] / 2 };
    const expected = laid.map((w) => {
      const e = expectedOf(w);
      return { ...e, start: turn(e.start, centre, 2), end: turn(e.end, centre, 2) };
    });
    pages.push({ pageIndex: 0, kind: 'scanned', recognised: pageOf(toPx(laid), A4, (-2 * Math.PI) / 180), expected });
  } else {
    await scanPage(doc, A4);
    const k = 72 / FIXTURE_DPI;
    const centre = { x: TRIAL_SKEW.widthPx / 2, y: TRIAL_SKEW.heightPx / 2 };
    const words: RecognisedWord[] = [];
    const expected: ExpectedWord[] = [];
    for (const [text, straight, clean, lineTop, lineBottom, baseline] of TRIAL_SKEW.words) {
      words.push({ text, x0: straight[0], y0: straight[1], x1: straight[2], y1: straight[3], confidence: 95, line: { y0: lineTop, y1: lineBottom, baseline } });
      // The skewed picture was the clean page turned 2 degrees clockwise about its centre (the trial's drawing code).
      const start = turn({ x: clean[0], y: baseline }, centre, 2);
      const end = turn({ x: clean[2], y: baseline }, centre, 2);
      expected.push({ text, start: { x: start.x * k, y: start.y * k }, end: { x: end.x * k, y: end.y * k }, size: (lineBottom - lineTop) * k });
    }
    pages.push({ pageIndex: 0, kind: 'scanned', recognised: { words, angle: TRIAL_SKEW.rotateRadians, widthPx: TRIAL_SKEW.widthPx, heightPx: TRIAL_SKEW.heightPx, seconds: 9.2 }, expected });
  }
  return { bytes: await doc.save(), pages };
}

/** A recognised page made of the given words in one column, for the quality and wording tests (pixels at 300 dpi). */
export function wordsPage(words: readonly { text: string; confidence: number }[], shown: [number, number] = A4): RecognisedPage {
  const laid: RecognisedWord[] = words.map((w, i) => {
    const top = 200 + (i % 60) * 50;
    const left = 200 + Math.floor(i / 60) * 600;
    return { text: w.text, confidence: w.confidence, x0: left, y0: top, x1: left + 40 * [...w.text].length, y1: top + 40 };
  });
  return pageOf(laid, shown);
}
