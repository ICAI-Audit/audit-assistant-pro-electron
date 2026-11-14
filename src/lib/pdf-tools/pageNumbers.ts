import { degrees, PDFDict, PDFDocument, PDFName, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { PdfToolsError } from './types';

export type NumberPosition = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center' | 'top-left' | 'top-right';
export type NumberFormat = 'n' | 'page-n' | 'n-of-total' | 'page-n-of-total' | 'custom';

export interface PageNumberOptions {
  position: NumberPosition;
  format: NumberFormat;
  prefix?: string;
  suffix?: string; // prefix and suffix are used when format === 'custom'
  startNumber: number;
  fromPage: number; // 1-based, inclusive
  toPage: number;
  fontSize: number; // 6..36
  marginPt: number; // 8..144
  color: { r: number; g: number; b: number }; // each 0..1
}

const PRODUCER = 'ICAI VERA';
const POSITIONS: NumberPosition[] = ['bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'];
const FORMATS: NumberFormat[] = ['n', 'page-n', 'n-of-total', 'page-n-of-total', 'custom'];
const CAP_HEIGHT = 0.718; // Helvetica cap height, so a top-positioned number sits at the margin

export function defaultPageNumberOptions(pageCount: number): PageNumberOptions {
  return {
    position: 'bottom-center',
    format: 'n',
    prefix: '',
    suffix: '',
    startNumber: 1,
    fromPage: 1,
    toPage: pageCount,
    fontSize: 10,
    marginPt: 28,
    color: { r: 0, g: 0, b: 0 },
  };
}

export function pageNumberLabel(opts: PageNumberOptions, n: number, total: number): string {
  switch (opts.format) {
    case 'n': return `${n}`;
    case 'page-n': return `Page ${n}`;
    case 'n-of-total': return `${n} of ${total}`;
    case 'page-n-of-total': return `Page ${n} of ${total}`;
    case 'custom': return `${opts.prefix ?? ''}${n}${opts.suffix ?? ''}`;
  }
}

/**
 * Where to draw the number, in the page's own (unrotated) coordinates. The position is
 * chosen as the reader sees the page, so the text is rotated with the page to stay upright.
 * `pageBox` is the visible box (CropBox clipped to MediaBox).
 */
export function numberPlacement(
  pageBox: { x: number; y: number; width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
  textWidth: number,
  opts: PageNumberOptions,
): { x: number; y: number; rotate: number } {
  const { width: W, height: H } = pageBox;
  const sideways = rotation === 90 || rotation === 270;
  const viewW = sideways ? H : W;
  const viewH = sideways ? W : H;

  // Reader frame: origin bottom-left of the page as displayed, u to the right, v up.
  const m = opts.marginPt;
  const [vertical, horizontal] = opts.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const u = horizontal === 'left' ? m : horizontal === 'right' ? viewW - m - textWidth : (viewW - textWidth) / 2;
  const v = vertical === 'bottom' ? m : viewH - m - opts.fontSize * CAP_HEIGHT;

  let x: number;
  let y: number;
  if (rotation === 90) { x = W - v; y = u; }
  else if (rotation === 180) { x = W - u; y = H - v; }
  else if (rotation === 270) { x = v; y = H - u; }
  else { x = u; y = v; }
  return { x: pageBox.x + x, y: pageBox.y + y, rotate: rotation };
}

function invalid(message: string): PdfToolsError {
  return new PdfToolsError('invalid-number-options', message);
}

function validate(opts: PageNumberOptions, pageCount: number): void {
  if (!POSITIONS.includes(opts.position)) throw invalid('Choose where the page number should go.');
  if (!FORMATS.includes(opts.format)) throw invalid('Choose how the page number should look.');
  if (!Number.isInteger(opts.startNumber) || opts.startNumber < 0 || opts.startNumber > 1_000_000) {
    throw invalid('Enter a starting number between 0 and 1,000,000.');
  }
  if (!Number.isInteger(opts.fromPage) || !Number.isInteger(opts.toPage) || opts.fromPage < 1 || opts.toPage > pageCount || opts.fromPage > opts.toPage) {
    throw invalid(`Enter a page range between 1 and ${pageCount}, with the first page not after the last.`);
  }
  if (!Number.isFinite(opts.fontSize) || opts.fontSize < 6 || opts.fontSize > 36) throw invalid('Enter a font size from 6 to 36.');
  if (!Number.isFinite(opts.marginPt) || opts.marginPt < 8 || opts.marginPt > 144) throw invalid('Enter a margin from 8 to 144 points.');
  const { r, g, b } = opts.color ?? { r: NaN, g: NaN, b: NaN };
  if (![r, g, b].every((c) => Number.isFinite(c) && c >= 0 && c <= 1)) throw invalid('Choose a valid colour for the page number.');
}

// Viewers ignore a /Rotate that is not a multiple of 90, so the number must too.
function normaliseRotation(angle: number): 0 | 90 | 180 | 270 {
  if (!Number.isInteger(angle) || angle % 90 !== 0) return 0;
  return ((((angle / 90) % 4) + 4) % 4 * 90) as 0 | 90 | 180 | 270;
}

type Box = { x: number; y: number; width: number; height: number };

// pdf-lib reports a box written with reversed corners as negative width/height.
function normaliseBox(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.width), y: Math.min(b.y, b.y + b.height), width: Math.abs(b.width), height: Math.abs(b.height) };
}

// What a viewer shows: the CropBox clipped to the MediaBox, or the MediaBox when they do not overlap.
function visibleBox(page: PDFPage): Box {
  const media = normaliseBox(page.getMediaBox());
  const crop = normaliseBox(page.getCropBox());
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : media;
}

// Pages often share one Resources dictionary (indirect, or inherited from /Pages). pdf-lib adds a
// font key to it on every draw, so give each page its own copy of Resources and of its Font dictionary.
function ownResources(doc: PDFDocument, page: PDFPage): void {
  page.node.normalize();
  const resources = page.node.Resources()!.clone(doc.context);
  const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (fonts) resources.set(PDFName.of('Font'), fonts.clone(doc.context));
  page.node.set(PDFName.of('Resources'), resources);
}

// Code points that would print as nothing or merge into a neighbour are shown as U+XXXX.
function describeCharacter(ch: string): string {
  if (/[\p{C}\p{M}\p{Zl}\p{Zp}]/u.test(ch)) return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
  return ch;
}

export async function addPageNumbers(file: Uint8Array, opts: PageNumberOptions): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(file, { updateMetadata: false });
  } catch {
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged or protected.');
  }
  const pages = doc.getPages();
  validate(opts, pages.length);

  const font = await doc.embedFont(StandardFonts.Helvetica);

  // The built-in font only covers Latin text; reject anything else rather than let pdf-lib throw or print garbage.
  const supported = new Set(font.getCharacterSet());
  const typed = opts.format === 'custom' ? `${opts.prefix ?? ''}${opts.suffix ?? ''}` : '';
  const bad = [...new Set([...typed].filter((ch) => !supported.has(ch.codePointAt(0)!)))];
  if (bad.length > 0) {
    throw new PdfToolsError(
      'unsupported-characters',
      `The page number text contains characters that cannot be printed: ${bad.map(describeCharacter).join(' ')}. Use letters, digits and common punctuation only.`,
    );
  }

  const count = opts.toPage - opts.fromPage + 1;
  const total = count + opts.startNumber - 1;
  const color = rgb(opts.color.r, opts.color.g, opts.color.b);

  // Check every page first so a failure leaves nothing half-numbered and names the first page that is too small.
  const plans = Array.from({ length: count }, (_, i) => {
    const page = pages[opts.fromPage - 1 + i];
    const label = pageNumberLabel(opts, opts.startNumber + i, total);
    // drawText prints without kerning, while widthOfTextAtSize subtracts kerning pairs, so sum the glyphs.
    const textWidth = [...label].reduce((w, ch) => w + font.widthOfTextAtSize(ch, opts.fontSize), 0);
    const box = visibleBox(page);
    const rotation = normaliseRotation(page.getRotation().angle);
    const sideways = rotation === 90 || rotation === 270;
    const viewW = sideways ? box.height : box.width;
    const viewH = sideways ? box.width : box.height;
    // A centred number needs no side margin; the others need one margin on the side they sit against.
    const sideMargin = opts.position.endsWith('-center') ? 0 : opts.marginPt;
    if (textWidth + sideMargin > viewW || opts.fontSize + opts.marginPt > viewH) {
      throw invalid(`The page number does not fit on page ${opts.fromPage + i}. Use shorter text, a smaller font size or a smaller margin.`);
    }
    return { page, label, textWidth, box, rotation };
  });

  for (const { page, label, textWidth, box, rotation } of plans) {
    ownResources(doc, page);
    const place = numberPlacement(box, rotation, textWidth, opts);
    page.drawText(label, { x: place.x, y: place.y, size: opts.fontSize, font, color, rotate: degrees(place.rotate) });
  }
  doc.setProducer(PRODUCER);
  return doc.save({ useObjectStreams: true });
}
