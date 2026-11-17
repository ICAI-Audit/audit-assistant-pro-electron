import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import {
  assertPrintable,
  CAP_HEIGHT,
  type DisplayedPage,
  displayedPage,
  drawOnPage,
  embedMarkFont,
  hasWidgets,
  type MarkHooks,
  matrixOp,
  num,
  pageHealth,
  pageListedTwice,
  placeBox,
  prepareMarks,
  PRODUCER,
  readerMatrix,
  ringOps,
  textWidth,
} from './marks';
import { isStop, loadPaced, pacer, savePaced } from './pace';
import { PdfToolsError } from './types';

export type NumberPosition = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center' | 'top-left' | 'top-right';
/** The six places in the page margins: one holds the page number, each of the others may hold a line of text. */
export type Slot = NumberPosition;
export type NumberFormat = 'n' | 'n-dot' | 'pg-n' | 'page-n' | 'n-of-total' | 'page-n-of-total' | 'custom';
export type NumberStyle = 'arabic' | 'roman-lower' | 'roman-upper' | 'alpha' | 'circled';
export type DateFormat = 'dd-mm-yyyy' | 'dd/mm/yyyy' | 'yyyy-mm-dd' | 'long';

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

/**
 * The phase 2 fields, all optional: phase 1 options give the phase 1 result. Kept apart from
 * `PageNumberOptions` so that the run step's options record (flat strings, numbers, booleans) still
 * accepts phase 1 options; the integration step folds them into one interface.
 */
export interface PageNumberExtras {
  style?: NumberStyle;
  font?: 'helvetica' | 'times' | 'courier';
  bold?: boolean;
  italic?: boolean;
  /** Header and footer lines by place, as typed (with tokens). A place holds 1..120 characters. */
  texts?: Partial<Record<Slot, string>>;
  dateFormat?: DateFormat;
  /** What the tokens {file}, {name}, {client}, {fy} and {date} are filled from: never read from anywhere else. */
  tokens?: { file: string; client: string; fy: string; today: Date };
  /** False: no page number, only the texts. Default true. */
  numbersOn?: boolean;
}

/** What `addPageNumbers` takes. */
export type PageNumberRunOptions = PageNumberOptions & PageNumberExtras;

const POSITIONS: NumberPosition[] = ['bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'];
const FORMATS: NumberFormat[] = ['n', 'n-dot', 'pg-n', 'page-n', 'n-of-total', 'page-n-of-total', 'custom'];
const STYLES: NumberStyle[] = ['arabic', 'roman-lower', 'roman-upper', 'alpha', 'circled'];
const FONTS = ['helvetica', 'times', 'courier'] as const;
const DATE_FORMATS: DateFormat[] = ['dd-mm-yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd', 'long'];
const MAX_TEXT = 120;
const ROW_GAP = 8; // least space between two texts on one row
const CIRCLE_PAD = 3; // pt added to the ring's radius
const CIRCLE_LINE = 1; // pt

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

// ---- numbers, dates and tokens ---------------------------------------------------------------

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

/** A number in a style. A style that cannot say the number (roman above 3999, letters after z) gives digits. */
export function formatNumber(n: number, style: NumberStyle): string {
  if (style === 'roman-lower' || style === 'roman-upper') {
    if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
    let left = n;
    let out = '';
    for (const [value, letters] of ROMAN) {
      while (left >= value) { out += letters; left -= value; }
    }
    return style === 'roman-upper' ? out.toUpperCase() : out;
  }
  if (style === 'alpha') return Number.isInteger(n) && n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : String(n);
  return String(n); // arabic, and the digits inside a circle
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The date in local time: '14-11-2026', '14/11/2026', '2026-11-14' or '14 November 2026'. */
export function formatDate(d: Date, f: DateFormat): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  switch (f) {
    case 'dd/mm/yyyy': return `${dd}/${mm}/${yyyy}`;
    case 'yyyy-mm-dd': return `${yyyy}-${mm}-${dd}`;
    case 'long': return `${d.getDate()} ${MONTHS[d.getMonth()]} ${yyyy}`;
    default: return `${dd}-${mm}-${yyyy}`;
  }
}

const TOKEN_NAMES = ['page', 'pages', 'file', 'name', 'date', 'client', 'fy'] as const;
type TokenValues = Record<(typeof TOKEN_NAMES)[number], string>;

/** Fills the tokens; an unknown token stays as typed, and what was filled in is never read again. */
export function fillTokens(template: string, values: TokenValues): string {
  return template.replace(/\{(page|pages|file|name|date|client|fy)\}/gi, (_, name: string) => values[name.toLowerCase() as keyof TokenValues]);
}

/** Names the first unknown token, or null. A brace that does not close is plain text. */
export function tokenError(template: string): string | null {
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!(TOKEN_NAMES as readonly string[]).includes(m[1].toLowerCase())) {
      return `{${m[1]}} is not a known name. Use {page}, {pages}, {file}, {name}, {date}, {client} or {fy}.`;
    }
  }
  return null;
}

export function pageNumberLabel(opts: PageNumberRunOptions, n: number, total: number): string {
  const style = opts.style ?? 'arabic';
  const s = (x: number) => formatNumber(x, style);
  switch (opts.format) {
    case 'n': return s(n);
    case 'n-dot': return `${s(n)}.`;
    case 'pg-n': return `Pg-${s(n)}`;
    case 'page-n': return `Page ${s(n)}`;
    case 'n-of-total': return `${s(n)} of ${s(total)}`;
    case 'page-n-of-total': return `Page ${s(n)} of ${s(total)}`;
    case 'custom': return `${opts.prefix ?? ''}${s(n)}${opts.suffix ?? ''}`;
  }
}

// ---- placement ---------------------------------------------------------------------------------

/**
 * Where a text of width `w` sits in a place, in the reader frame (real points, origin bottom-left of the
 * page as displayed, u right, v up): the baseline's start. The one rule for the drawing and the preview.
 */
export function slotOrigin(d: DisplayedPage, slot: Slot, w: number, opts: { marginPt: number; fontSize: number }): { u: number; v: number } {
  const [vertical, horizontal] = slot.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const u = horizontal === 'left' ? opts.marginPt : horizontal === 'right' ? d.width - opts.marginPt - w : (d.width - w) / 2;
  const v = vertical === 'bottom' ? opts.marginPt : d.height - opts.marginPt - opts.fontSize * CAP_HEIGHT;
  return { u, v };
}

/**
 * Where to draw the number, in the page's own (unrotated) coordinates, through `slotOrigin` and the reader
 * matrix, so that it cannot disagree with what `addPageNumbers` draws. The position is chosen as the
 * reader sees the page, so the text is rotated with the page to stay upright. `pageBox` is the visible box
 * (CropBox clipped to MediaBox). `unit` is the page's /UserUnit (default 1): margins and sizes are real
 * points, so x and y are in user units and the font size to draw with is `fontSize / unit`.
 */
export function numberPlacement(
  pageBox: { x: number; y: number; width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
  textWidth: number,
  opts: PageNumberOptions,
  unit = 1,
): { x: number; y: number; rotate: number } {
  const sideways = rotation === 90 || rotation === 270;
  const d: DisplayedPage = { box: pageBox, rotation, unit, width: (sideways ? pageBox.height : pageBox.width) * unit, height: (sideways ? pageBox.width : pageBox.height) * unit };
  const { u, v } = slotOrigin(d, opts.position, textWidth, opts);
  const m = readerMatrix(d);
  return { x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5], rotate: rotation };
}

function invalid(message: string): PdfToolsError {
  return new PdfToolsError('invalid-number-options', message);
}

const SLOT_NAMES: Record<Slot, string> = {
  'top-left': 'top left', 'top-center': 'top centre', 'top-right': 'top right',
  'bottom-left': 'bottom left', 'bottom-center': 'bottom centre', 'bottom-right': 'bottom right',
};

function slotTexts(opts: PageNumberRunOptions): [Slot, string][] {
  return POSITIONS.flatMap((slot) => {
    const text = opts.texts?.[slot];
    return text === undefined ? [] : [[slot, text] as [Slot, string]];
  });
}

function validate(opts: PageNumberRunOptions, pageCount: number): void {
  if (!POSITIONS.includes(opts.position)) throw invalid('Choose where the page number should go.');
  if (!FORMATS.includes(opts.format)) throw invalid('Choose how the page number should look.');
  if (opts.style !== undefined && !STYLES.includes(opts.style)) throw invalid('Choose how the page numbers should be written.');
  if (opts.font !== undefined && !FONTS.includes(opts.font)) throw invalid('Choose a font for the page number.');
  if (opts.dateFormat !== undefined && !DATE_FORMATS.includes(opts.dateFormat)) throw invalid('Choose how the date should be written.');
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
  if (opts.style === 'circled' && opts.format !== 'n') throw invalid('A number in a circle goes with the plain number format. Choose "1, 2, 3" or another style.');

  const numbersOn = opts.numbersOn !== false;
  const texts = slotTexts(opts);
  if (!numbersOn && texts.length === 0) throw invalid('Turn on the page number or add header or footer text.');
  for (const [slot, text] of texts) {
    // Spaces alone print nothing: refused as Watermark refuses them (REV-A M4).
    if ([...text.trim()].length < 1 || [...text].length > MAX_TEXT) throw invalid(`The text at the ${SLOT_NAMES[slot]} needs 1 to ${MAX_TEXT} characters.`);
    const token = tokenError(text);
    if (token) throw invalid(`The text at the ${SLOT_NAMES[slot]}: ${token}`);
    if (numbersOn && slot === opts.position && !/\{page\}/i.test(text)) {
      throw invalid(`The page number is already at the ${SLOT_NAMES[slot]}. Choose another place for this text, or write {page} in the text.`);
    }
  }
}

/** One line to draw on a page: its text, and the place it sits in. */
interface Item { text: string; slot: Slot; circled: boolean }

export async function addPageNumbers(file: Uint8Array, opts: PageNumberRunOptions, hooks: MarkHooks = {}): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await loadPaced(file, { updateMetadata: false, check: hooks.check });
  } catch (error) {
    if (isStop(error)) throw error; // the run's own Stop, pressed while the file was read
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged or protected.');
  }
  const pages = doc.getPages();
  validate(opts, pages.length);
  const twice = pageListedTwice(pages, opts.fromPage, opts.toPage);
  if (twice) throw invalid(`Pages ${twice[0]} and ${twice[1]} are one page listed twice in this file, so they cannot be numbered separately. The file may be damaged.`);

  const font: PDFFont = await embedMarkFont(doc, opts.font ?? 'helvetica', opts.bold === true, opts.italic === true);

  // The built-in font only covers Latin text; reject anything else rather than let pdf-lib throw or print garbage.
  const typed = opts.format === 'custom' ? `${opts.prefix ?? ''}${opts.suffix ?? ''}` : '';
  assertPrintable(font, typed, 'page number text');

  const count = opts.toPage - opts.fromPage + 1;
  const total = count + opts.startNumber - 1;
  const color = opts.color;
  const numbersOn = opts.numbersOn !== false;
  const texts = slotTexts(opts);
  const tokens = opts.tokens ?? { file: '', client: '', fy: '', today: new Date() };
  const date = formatDate(tokens.today, opts.dateFormat ?? 'dd-mm-yyyy');
  const circled = opts.style === 'circled';
  const fillFor = (template: string, n: number): string =>
    fillTokens(template, { page: formatNumber(n, opts.style ?? 'arabic'), pages: formatNumber(total, opts.style ?? 'arabic'), file: tokens.file, name: tokens.file.replace(/\.pdf$/i, ''), date, client: tokens.client, fy: tokens.fy });

  // Characters: the typed texts first, then what the tokens bring (file name, client name, financial year).
  for (const [, template] of texts) {
    assertPrintable(font, template, 'header or footer text');
    assertPrintable(font, fillFor(template, opts.startNumber), 'file name, client name or financial year used in the header or footer text');
  }

  // Check every page first so a failure leaves nothing half-numbered and names the first page that is too small.
  const pace = pacer();
  const plans: { page: PDFPage; items: Item[]; d: DisplayedPage }[] = [];
  for (let i = 0; i < count; i++) {
    await pace();
    const page = pages[opts.fromPage - 1 + i];
    const n = opts.startNumber + i;
    let d: DisplayedPage;
    try {
      d = displayedPage(page);
    } catch {
      // A box, turn or page tree pdf-lib cannot read (REV-A S2): refused plainly, naming the page.
      throw invalid(`Page ${opts.fromPage + i} could not be read, so it cannot be numbered. The file may be damaged.`);
    }
    const items: Item[] = [];
    const slotTaken = new Set<Slot>();
    for (const [slot, template] of texts) {
      items.push({ text: fillFor(template, n), slot, circled: false });
      slotTaken.add(slot);
    }
    if (numbersOn && !slotTaken.has(opts.position)) items.push({ text: pageNumberLabel(opts, n, total), slot: opts.position, circled });

    const spans: { slot: Slot; from: number; to: number }[] = [];
    for (const item of items) {
      // drawText prints without kerning, while widthOfTextAtSize subtracts kerning pairs, so sum the glyphs.
      const w = textWidth(font, item.text, opts.fontSize);
      // A centred text needs no side margin; the others need one margin on the side they sit against.
      const sideMargin = item.slot.endsWith('-center') ? 0 : opts.marginPt;
      const isNumber = numbersOn && item.slot === opts.position && !texts.some(([s]) => s === item.slot);
      const what = isNumber ? 'The page number' : 'The header or footer text';
      const box = item.circled ? 2 * (0.75 * Math.max(w, opts.fontSize * CAP_HEIGHT) + CIRCLE_PAD) + CIRCLE_LINE : w;
      const height = item.circled ? box : opts.fontSize;
      if (box + sideMargin > d.width || height + opts.marginPt > d.height) {
        throw invalid(`${what} does not fit on page ${opts.fromPage + i}. Use shorter text, a smaller font size or a smaller margin.`);
      }
      const [, horizontal] = item.slot.split('-');
      const from = horizontal === 'left' ? opts.marginPt : horizontal === 'right' ? d.width - opts.marginPt - box : (d.width - box) / 2;
      spans.push({ slot: item.slot, from, to: from + box });
    }
    // Header and footer must not print over each other on a short page.
    const rowHeight = (row: string) => Math.max(0, ...items.filter((it) => it.slot.startsWith(row)).map((it) => (it.circled ? 2 * (0.75 * Math.max(textWidth(font, it.text, opts.fontSize), opts.fontSize * CAP_HEIGHT) + CIRCLE_PAD) + CIRCLE_LINE : opts.fontSize * CAP_HEIGHT)));
    if (items.some((it) => it.slot.startsWith('top')) && items.some((it) => it.slot.startsWith('bottom'))
      && 2 * opts.marginPt + rowHeight('top') + rowHeight('bottom') + ROW_GAP > d.height) {
      throw invalid(`The header and footer text would print over each other on page ${opts.fromPage + i}. Use a smaller font size or a smaller margin.`);
    }
    for (const row of ['top', 'bottom']) {
      const line = spans.filter((s) => s.slot.startsWith(row)).sort((a, b) => a.from - b.from);
      for (let k = 1; k < line.length; k++) {
        if (line[k].from - line[k - 1].to < ROW_GAP) {
          throw invalid(`The text at the ${row} of page ${opts.fromPage + i} runs into the text next to it. Use shorter text, a smaller font size or a smaller margin.`);
        }
      }
    }
    plans.push({ page, items, d });
  }

  await prepareMarks(doc, pace);
  const report = hooks.report;
  for (const [i, { page, items, d }] of plans.entries()) {
    await hooks.onPage?.(i, count);
    await pace();
    drawOnPage(doc, page, 'front', (namer) => {
      const fontName = namer.font(font);
      const rgb = `${num(color.r)} ${num(color.g)} ${num(color.b)} rg`;
      // Everything is placed in the reader frame, in real points: a 10 pt number is 10 pt on a /UserUnit page too.
      const parts: string[] = [matrixOp(readerMatrix(d)), rgb];
      for (const item of items) {
        const w = textWidth(font, item.text, opts.fontSize);
        const hex = font.encodeText(item.text).toString();
        if (item.circled) {
          const r = 0.75 * Math.max(w, opts.fontSize * CAP_HEIGHT) + CIRCLE_PAD;
          const { u, v } = placeBox(d, 2 * r + CIRCLE_LINE, 2 * r + CIRCLE_LINE, 0, { anchor: item.slot, padPt: opts.marginPt });
          parts.push(ringOps(u, v, r, CIRCLE_LINE, color), rgb);
          parts.push(`BT /${fontName} ${num(opts.fontSize)} Tf 1 0 0 1 ${num(u - w / 2)} ${num(v - (opts.fontSize * CAP_HEIGHT) / 2)} Tm ${hex} Tj ET`);
        } else {
          const { u, v } = slotOrigin(d, item.slot, w, opts);
          parts.push(`BT /${fontName} ${num(opts.fontSize)} Tf 1 0 0 1 ${num(u)} ${num(v)} Tm ${hex} Tj ET`);
        }
      }
      return parts.join('\n');
    });
    if (report) {
      const n = opts.fromPage + i;
      const health = pageHealth(page);
      if (health.damaged) report.damaged.push(n);
      if (health.unverified) report.unverified.push(n);
      if (hasWidgets(page)) report.underFields.push(n);
    }
  }
  await hooks.onPage?.(count, count);
  // An edit of the source in place: Producer and modification date are ours, the Creator stays (REV-A S12).
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  return savePaced(doc);
}
