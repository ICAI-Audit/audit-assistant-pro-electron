// Make searchable (T-064, OCR part A; contract section 6; OCR-SPIKE-report.md section 6): the recognised words of a
// page added to it as invisible text, so that the file can be searched, selected, redacted and converted while every
// page looks exactly as before.
//
// - Each word is written in Helvetica (the standard font, nothing embedded beyond its name) with text rendering
//   mode 3 (neither filled nor stroked), sized to its line's text (the size the engine adapter measured, else the
//   line box's height, else the word's own box), on the line's baseline, and scaled horizontally (Tz) so that it
//   spans exactly its box. This is the trial's method: pdf.js and pdftotext read every word back in order, edges
//   within 1.8 pt, and the page drawn before and after differed in no pixel.
// - A word followed by another word of the same line ends with a space, written after its box. Without it a
//   reader has to guess the gaps from positions, and joins neighbouring words wherever the gap is small for the
//   text's size (T-064 part C: on a real scan text extraction joined words on most lines).
// - Boxes come in pixels of the page picture as displayed. They are taken to the page through its displayed
//   geometry (marks.ts displayedPage / readerMatrix), so a page shown turned by /Rotate or cut by a crop box comes
//   out right. When the engine straightened the picture, the boxes are first turned back by its reported angle
//   about the picture's centre (spike concern 6: 9 pt off on average otherwise); each word is then written along
//   the tilted line it was printed on.
// - Words that are only ruling-line marks (`|`, `_` runs, ocrTypes.ts isRulingMark) are left out. Characters the
//   standard font cannot encode (₹, ligatures, any script but Latin) are dropped and counted; a word with nothing
//   left is left out and counted. The engine's reading order is kept, so text extraction gives the lines in order.
// - The page's own content is never touched: its streams stay as they are, wrapped in `q … Q` (with one more `Q`
//   for each it leaves open), and the layer is appended in its own `q … Q` (marks.ts drawOnPage, 'front'), so it
//   cannot disturb the graphics state. A page with no usable word is left exactly as it was.
import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import { displayedPage, drawOnPage, embedMarkFont, matrixOp, num, prepareMarks, readerMatrix, textWidth, type DisplayedPage, type Matrix } from './marks';
import { emptyLayerReport, isRulingMark, type LayerReport, type RecognisedPage, type RecognisedWord } from './ocrTypes';
import type { Pace } from './pace';

/** The font the layer writes with, and the characters it can encode. */
export interface LayerFont {
  font: PDFFont;
  supported: ReadonlySet<number>;
}

const supportedSets = new WeakMap<PDFFont, ReadonlySet<number>>();

/**
 * Gets a document ready for text layers: reads its pages for earlier marks with the window given its turns
 * (marks.ts prepareMarks) and embeds Helvetica once for every page.
 */
export async function prepareTextLayer(doc: PDFDocument, pace: Pace): Promise<LayerFont> {
  await prepareMarks(doc, pace);
  const font = await embedMarkFont(doc, 'helvetica', false, false);
  let supported = supportedSets.get(font);
  if (!supported) {
    supported = new Set(font.getCharacterSet());
    supportedSets.set(font, supported);
  }
  return { font, supported };
}

/** The characters of `text` the font can encode, and how many were dropped. */
export function printableText(text: string, layer: LayerFont): { text: string; dropped: number } {
  let kept = '';
  let dropped = 0;
  for (const ch of text) {
    if (layer.supported.has(ch.codePointAt(0)!)) kept += ch;
    else dropped += 1;
  }
  return { text: kept, dropped };
}

/** a then b, for row vectors as PDF writes matrices: a point goes through `a` first. */
const then = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));

export interface WordPlacement {
  /** Font size in points. */
  size: number;
  /** Horizontal scaling (Tz), in percent: the word then spans its box exactly. */
  scale: number;
  /** The text matrix (Tm) in the reader frame (points, origin bottom-left of the page as displayed, y up). */
  matrix: Matrix;
}

/**
 * Where and how big one word is written, or null when its box cannot be used. Text space (points, y up) is taken
 * to the straightened picture (pixels, y down, origin at the word's left end on its baseline), turned back by the
 * engine's angle about the picture's centre, then scaled from the picture to the page as displayed.
 */
export function wordPlacement(word: RecognisedWord, text: string, page: RecognisedPage, target: PDFPage | DisplayedPage, layer: LayerFont): WordPlacement | null {
  const d = 'rotation' in target && 'box' in target ? target : displayedPage(target);
  const { widthPx: W, heightPx: H } = page;
  const { x0, y0, x1, y1 } = word;
  if (!finite(W, H, x0, y0, x1, y1, d.width, d.height) || W <= 0 || H <= 0 || x1 <= x0 || y1 <= y0) return null;
  const line = word.line && finite(word.line.y0, word.line.y1, word.line.baseline) && word.line.y1 > word.line.y0 ? word.line : null;
  const sx = d.width / W;
  const sy = d.height / H;
  const measured = line && typeof line.size === 'number' && Number.isFinite(line.size) && line.size > 0 ? line.size : null;
  const size = (measured ?? (line ? line.y1 - line.y0 : y1 - y0)) * sy;
  const baseline = line ? line.baseline : y1;
  const natural = textWidth(layer.font, text, size);
  const scale = (100 * (x1 - x0) * sx) / natural;
  if (!(size > 0) || !(natural > 0) || !Number.isFinite(scale)) return null;

  const angle = Number.isFinite(page.angle) ? -page.angle : 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cx = W / 2;
  const cy = H / 2;
  const toPicture: Matrix = [1 / sx, 0, 0, -1 / sy, x0, baseline];
  const turnBack: Matrix = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
  const toReader: Matrix = [sx, 0, 0, -sy, 0, d.height];
  return { size, scale, matrix: then(then(toPicture, turnBack), toReader) };
}

/** A number for a text matrix: six decimals (a 2-degree turn on a 1,000 pt page stays within 0.001 pt), never an exponent. */
const fine = (x: number): string => String(Number(x.toFixed(6)) || 0);

/**
 * Adds the recognised words of one page as invisible text (see the head of this file). Synchronous after
 * `prepareTextLayer` (the trial built a 289-word layer and saved the file in 91 ms). Returns what it did, as counts.
 */
export function addTextLayer(doc: PDFDocument, page: PDFPage, layer: LayerFont, recognised: RecognisedPage): LayerReport {
  const report = emptyLayerReport();
  const d = displayedPage(page);
  const placed: { text: string; at: WordPlacement; line: number | undefined }[] = [];
  for (const word of recognised.words) {
    const raw = typeof word.text === 'string' ? word.text.trim() : '';
    if (raw === '') continue;
    if (isRulingMark(raw)) {
      report.rulingMarks += 1;
      continue;
    }
    const { text, dropped } = printableText(raw, layer);
    report.charactersDropped += dropped;
    if (text.trim() === '') {
      report.wordsUnprintable += 1;
      continue;
    }
    const at = wordPlacement(word, text, recognised, d, layer);
    if (!at) {
      report.wordsBadBox += 1;
      report.charactersDropped -= dropped; // a word left out for its box is not counted twice
      continue;
    }
    placed.push({ text, at, line: word.line?.index });
  }
  report.wordsPlaced = placed.length;
  if (placed.length === 0) return report;
  // A space after every word that is followed by a word of its own line.
  const written = placed.map((word, i) => (word.line !== undefined && placed[i + 1]?.line === word.line ? `${word.text} ` : word.text));

  drawOnPage(doc, page, 'front', (namer) => {
    const name = namer.font(layer.font);
    const ops = [matrixOp(readerMatrix(d)), 'BT', '3 Tr'];
    placed.forEach(({ at }, i) => {
      ops.push(`/${name} ${num(at.size)} Tf ${num(at.scale)} Tz ${at.matrix.map(fine).join(' ')} Tm ${layer.font.encodeText(written[i]).toString()} Tj`);
    });
    ops.push('ET');
    return ops.join('\n');
  });
  return report;
}
