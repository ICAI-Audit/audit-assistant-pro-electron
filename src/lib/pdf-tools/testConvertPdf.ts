/**
 * TEST HELPER (PDF to Excel, PDF to Word; T-064): invented PDFs built with pdf-lib, with the word boxes
 * and ruling lines recorded from the same draw calls, so a test needs no PDF reader. Never imported by
 * the application. Every name, account and amount here is made up.
 *
 * Coordinates are those of layout.ts: points, origin at the top-left corner of the page as it is shown
 * after /Rotate, y growing downwards. A word's box runs from 0.9 of the font size above its baseline to
 * 0.25 below it, as the application's reader reports it for these fonts.
 */
import { closePath, degrees, fill, lineTo, moveTo, PDFDocument, popGraphicsState, pushGraphicsState, rectangle, rgb, setFillingColor, setLineWidth, StandardFonts, stroke, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PageWords, Segment, Word } from './layout';
import { displayedPage, readerMatrix, textWidth, type Matrix } from './marks';

export type ConvertFixtureName =
  | 'statement-ruled'
  | 'statement-plain'
  | 'trial-balance'
  | 'two-column-letter'
  | 'merged-heading'
  | 'rotated-page';

export const CONVERT_FIXTURE_NAMES: readonly ConvertFixtureName[] = ['statement-ruled', 'statement-plain', 'trial-balance', 'two-column-letter', 'merged-heading', 'rotated-page'];

export interface ConvertFixture { bytes: Uint8Array; pages: PageWords[]; segments: Segment[][] }

/** What a fixture's pages hold, as drawn: for checking a layout or a workbook against. One entry per page. */
export interface ConvertExpected {
  /** The page's table as cell text, one array per row as a reader sees it (a cell's lines joined by a space). Empty when the page has no table. */
  rows: string[][][];
  /** The same table with one row per line of text (a second line of a cell is a row of its own): what a page without ruling lines gives. */
  lineRows: string[][][];
  /** The lines of text outside the table, in reading order. */
  text: string[][];
}

interface Fonts { regular: PDFFont; bold: PDFFont }
interface TextOptions { size?: number; bold?: boolean }

/** Draws on one page in display coordinates and records what it drew. */
class Sheet {
  readonly words: Word[] = [];
  readonly segments: Segment[] = [];
  readonly width: number;
  readonly height: number;
  private readonly matrix: Matrix;
  private readonly angle: number;

  constructor(private readonly page: PDFPage, private readonly fonts: Fonts) {
    const shown = displayedPage(page);
    this.width = shown.width;
    this.height = shown.height;
    this.matrix = readerMatrix(shown);
    this.angle = shown.rotation;
  }

  /** A display point in the page's own coordinates. */
  private at(x: number, y: number): { x: number; y: number } {
    const m = this.matrix;
    const v = this.height - y;
    return { x: m[0] * x + m[2] * v + m[4], y: m[1] * x + m[3] * v + m[5] };
  }

  /** Text starting at `x` on the baseline `y`; returns where it ends. */
  text(str: string, x: number, y: number, options: TextOptions = {}): number {
    const size = options.size ?? 9;
    const font = options.bold ? this.fonts.bold : this.fonts.regular;
    const p = this.at(x, y);
    this.page.drawText(str, { x: p.x, y: p.y, size, font, rotate: degrees(this.angle), color: rgb(0, 0, 0) });
    for (const m of str.matchAll(/\S+/g)) {
      const x0 = x + textWidth(font, str.slice(0, m.index), size);
      this.words.push({ text: m[0], x0, y0: y - 0.9 * size, x1: x0 + textWidth(font, m[0], size), y1: y + 0.25 * size, size, font: font.name });
    }
    return x + textWidth(font, str, size);
  }

  /** Text ending at `xRight`. */
  right(str: string, xRight: number, y: number, options: TextOptions = {}): void {
    const font = options.bold ? this.fonts.bold : this.fonts.regular;
    this.text(str, xRight - textWidth(font, str, options.size ?? 9), y, options);
  }

  /** Text centred on `xCentre`. */
  centre(str: string, xCentre: number, y: number, options: TextOptions = {}): void {
    const font = options.bold ? this.fonts.bold : this.fonts.regular;
    this.text(str, xCentre - textWidth(font, str, options.size ?? 9) / 2, y, options);
  }

  /** A stroked line (`m`, `l`, `S`). */
  rule(x0: number, y0: number, x1: number, y1: number): void {
    this.page.drawLine({ start: this.at(x0, y0), end: this.at(x1, y1), thickness: 0.5, color: rgb(0, 0, 0) });
    this.segments.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  }

  /** A line drawn as a thin filled rectangle (`re`, `f`), 0.75 pt thick. */
  bar(x0: number, y0: number, x1: number, y1: number): void {
    const t = 0.375;
    const a = this.at(Math.min(x0, x1) - (y0 === y1 ? 0 : t), Math.min(y0, y1) - (y0 === y1 ? t : 0));
    const b = this.at(Math.max(x0, x1) + (y0 === y1 ? 0 : t), Math.max(y0, y1) + (y0 === y1 ? t : 0));
    this.page.pushOperators(pushGraphicsState(), rectangle(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)), fill(), popGraphicsState());
    this.segments.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  }

  /** A stroked rectangle (`re`, `S`): four lines. */
  box(x0: number, y0: number, x1: number, y1: number): void {
    const a = this.at(x0, y0);
    const b = this.at(x1, y1);
    this.page.pushOperators(pushGraphicsState(), setLineWidth(0.5), rectangle(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)), stroke(), popGraphicsState());
    this.segments.push({ x0, y0, x1, y1: y0 }, { x0, y0: y1, x1, y1 }, { x0, y0, x1: x0, y1 }, { x0: x1, y0, x1, y1 });
  }
}

interface Built extends ConvertFixture { expected: ConvertExpected }

interface Maker {
  doc: PDFDocument;
  fonts: Fonts;
  sheets: Sheet[];
  expected: ConvertExpected;
  /** A new page; `rotate` is its /Rotate. */
  page(size?: [number, number], rotate?: number): Sheet;
}

async function maker(): Promise<Maker> {
  const doc = await PDFDocument.create();
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const sheets: Sheet[] = [];
  const expected: ConvertExpected = { rows: [], lineRows: [], text: [] };
  return {
    doc,
    fonts,
    sheets,
    expected,
    page(size = [595, 842], rotate = 0) {
      const page = doc.addPage(size);
      if (rotate) page.setRotation(degrees(rotate));
      const sheet = new Sheet(page, fonts);
      sheets.push(sheet);
      expected.rows.push([]);
      expected.lineRows.push([]);
      expected.text.push([]);
      return sheet;
    },
  };
}

async function finish(m: Maker): Promise<Built> {
  // No title, author or dates of the day: the same bytes on every run.
  const fixed = new Date(Date.UTC(2025, 0, 1));
  m.doc.setCreationDate(fixed);
  m.doc.setModificationDate(fixed);
  const bytes = await m.doc.save({ useObjectStreams: false });
  return {
    bytes,
    pages: m.sheets.map((s, pageIndex) => ({ pageIndex, width: s.width, height: s.height, words: s.words })),
    segments: m.sheets.map((s) => s.segments),
    expected: m.expected,
  };
}

/** An amount in paise with Indian digit grouping: 12345678 gives "1,23,456.78". */
export function indianAmount(paise: number): string {
  const whole = Math.floor(Math.abs(paise) / 100).toString();
  const head = whole.length > 3 ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}` : whole;
  return `${head}.${(Math.abs(paise) % 100).toString().padStart(2, '0')}`;
}

// ---- the bank statement, with and without ruling lines ------------------------------------------------

const STATEMENT_X = [36, 96, 300, 360, 430, 500, 559];
const STATEMENT_HEAD = ['Date', 'Narration', 'Ref', 'Debit', 'Credit', 'Balance'];
const NARRATIONS = [
  'NEFT from Sample Buyer One',
  'Cheque paid to Example Supplies',
  'UPI collection from counter sales',
  'Electricity charges for the shop',
  'Salary transfer for the month',
  'GST payment for the quarter',
  'Cash deposit at branch',
  'Interest credited by the bank',
  'Rent paid for the godown',
  'RTGS to Example Machinery Works',
];
const LONG_NARRATION = ['NEFT from Sample Buyer Two against', 'invoices 114 and 115 for March'];
const STATEMENT_ROWS_PER_PAGE = [20, 22, 12];

async function statement(ruled: boolean): Promise<Built> {
  const m = await maker();
  const X = STATEMENT_X;
  let balance = 12_50_000_00;
  let n = 0;
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  STATEMENT_ROWS_PER_PAGE.forEach((count, p) => {
    const s = m.page();
    const text = m.expected.text[p];
    const say = (str: string, x: number, y: number, options?: TextOptions) => {
      s.text(str, x, y, options);
      text.push(str);
    };
    say('Example Co-operative Bank (invented)', 36, 50, { size: 14, bold: true });
    say('Statement of account', 36, 68, { size: 10 });
    say('Account TEST-0001 of Sample Traders, 01-04-2025 to 30-06-2025', 36, 82);

    const rows: string[][][] = []; // per row: its lines, each a row of cell text
    rows.push([STATEMENT_HEAD]);
    if (p === 0) rows.push([['01-04-2025', 'Opening balance', '', '', '', indianAmount(balance)]]);
    for (let i = 0; i < count; i++, n++) {
      const amount = 500_00 + (next() % 4_00_000_00);
      const credit = n % 3 === 0;
      balance += credit ? amount : -amount;
      const day = 1 + ((n * 2) % 28);
      const month = 4 + Math.floor(n / 20);
      const date = `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-2025`;
      const ref = n % 4 === 1 ? String(100 + n).padStart(6, '0') : `R${100200 + n * 7}`;
      const long = n % 5 === 2;
      const first = [date, long ? LONG_NARRATION[0] : NARRATIONS[n % NARRATIONS.length], ref, credit ? '' : indianAmount(amount), credit ? indianAmount(amount) : '', indianAmount(balance)];
      rows.push(long ? [first, ['', LONG_NARRATION[1], '', '', '', '']] : [first]);
    }
    if (p === STATEMENT_ROWS_PER_PAGE.length - 1) rows.push([['30-06-2025', 'Closing balance', '', '', '', indianAmount(balance)]]);

    let y = 100;
    const top = y;
    const edges = [y];
    rows.forEach((lines, r) => {
      const bold = r === 0 || lines[0][1] === 'Closing balance';
      lines.forEach((cells, l) => {
        const base = y + 11.5 + l * 11;
        cells.forEach((cell, c) => {
          if (cell === '') return;
          if (c >= 3) s.right(cell, X[c + 1] - 4, base, { bold });
          else s.text(cell, X[c] + 4, base, { bold });
        });
      });
      y += r === 0 ? 18 : 16 + (lines.length - 1) * 11;
      edges.push(y);
    });
    if (ruled) {
      for (const edge of edges) s.rule(X[0], edge, X[X.length - 1], edge);
      for (const x of X) s.rule(x, top, x, y);
    }
    m.expected.rows[p] = rows.map((lines) => lines[0].map((_, c) => lines.map((cells) => cells[c]).filter((t) => t !== '').join(' ')));
    m.expected.lineRows[p] = rows.flat();
    say(`Page ${p + 1} of ${STATEMENT_ROWS_PER_PAGE.length}`, 36, 810, { size: 8 });
  });
  return finish(m);
}

// ---- the trial balance: no table lines, bracketed negatives, Indian grouping -----------------------------

const TRIAL_ROWS: string[][] = [
  ['Particulars', 'Debit (Rs.)', 'Credit (Rs.)'],
  ['Liabilities', '', ''],
  ['Share capital', '', '25,00,000.00'],
  ['Reserves and surplus', '', '12,34,567.50'],
  ['Secured loans', '', '8,75,000.00'],
  ['Sundry creditors', '', '4,10,250.75'],
  ['Assets', '', ''],
  ['Plant and machinery', '18,45,000.00', ''],
  ['Accumulated depreciation', '(1,25,000.00)', ''],
  ['Stock in trade', '9,80,400.25', ''],
  ['Sundry debtors', '14,62,318.00', ''],
  ['Provision for doubtful debts', '(42,500.00)', ''],
  ['Cash in hand', '37,600.00', ''],
  ['Balance with banks', '8,62,000.00', ''],
  ['Total', '50,19,818.25', '50,19,818.25'],
];

async function trialBalance(): Promise<Built> {
  const m = await maker();
  const s = m.page();
  s.centre('Sample Traders (invented)', 297.5, 60, { size: 12, bold: true });
  s.centre('Trial balance as at 31 March 2025', 297.5, 78, { size: 10 });
  m.expected.text[0].push('Sample Traders (invented)', 'Trial balance as at 31 March 2025');
  let y = 120;
  TRIAL_ROWS.forEach((row, r) => {
    const bold = r === 0 || row[0] === 'Total' || (row[1] === '' && row[2] === '');
    if (row[0] === 'Total') {
      s.rule(60, y - 12, 534, y - 12);
      s.rule(60, y + 5, 534, y + 5);
    }
    s.text(row[0], 60, y, { bold });
    if (row[1]) s.right(row[1], 420, y, { bold });
    if (row[2]) s.right(row[2], 530, y, { bold });
    y += row[0] === 'Total' || TRIAL_ROWS[r + 1]?.[0] === 'Total' ? 18 : 16;
  });
  m.expected.rows[0] = TRIAL_ROWS;
  m.expected.lineRows[0] = TRIAL_ROWS;
  s.text('Prepared from the books of account for testing only.', 60, y + 30);
  m.expected.text[0].push('Prepared from the books of account for testing only.');
  return finish(m);
}

// ---- the two-column letter ----------------------------------------------------------------------------

const LETTER_LEFT =
  'Every branch will count its stock on the last working day of March. The count starts after the shop closes and is finished before it opens again. Two members of staff count each rack and sign the sheet together. A third person, who does not handle the stock during the year, checks one rack in five. Items held for customers are listed apart and are not added to our own stock. Damaged goods are counted, marked on the sheet and kept on a separate shelf until the visit.';
const LETTER_RIGHT =
  'Cash in the drawer is counted at the same time and agreed with the cash book. Any difference is written on the sheet with a short reason and is not adjusted on the day. Cheques in hand are listed with the name of the party and the amount. The signed sheets reach the head office within three working days. Please keep a copy at the branch. The auditors may visit any branch during the count without notice, so the store keys and the stock register must be at hand.';

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const tried = line === '' ? word : `${line} ${word}`;
    if (line !== '' && textWidth(font, tried, size) > width) {
      lines.push(line);
      line = word;
    } else line = tried;
  }
  if (line !== '') lines.push(line);
  return lines;
}

async function twoColumnLetter(): Promise<Built> {
  const m = await maker();
  const s = m.page();
  const text = m.expected.text[0];
  const say = (str: string, x: number, y: number, options?: TextOptions) => {
    s.text(str, x, y, options);
    text.push(str);
  };
  say('Sample Traders (invented)', 50, 60, { size: 14, bold: true });
  say('Circular to all branch managers about the year end stock count and the cash verification', 50, 84, { size: 10 });
  const left = wrap(LETTER_LEFT, m.fonts.regular, 10, 235);
  const right = wrap(LETTER_RIGHT, m.fonts.regular, 10, 235);
  left.forEach((line, i) => say(line, 50, 120 + i * 14, { size: 10 }));
  right.forEach((line, i) => say(line, 310, 120 + i * 14, { size: 10 }));
  say('For Sample Traders (invented), the accounts department, on behalf of the partners of the firm', 50, 120 + Math.max(left.length, right.length) * 14 + 30, { size: 10 });
  return finish(m);
}

// ---- a ruled table with a merged heading cell and a two-line narration ---------------------------------

async function mergedHeading(): Promise<Built> {
  const m = await maker();
  const s = m.page();
  s.text('Trading account for the year (invented figures)', 50, 70, { size: 11, bold: true });
  m.expected.text[0].push('Trading account for the year (invented figures)');
  const X = [50, 290, 400, 510];
  const data: { lines: string[]; debit: string; credit: string }[] = [
    { lines: ['Opening stock of raw material'], debit: '4,50,000.00', credit: '' },
    { lines: ['Purchases during the year from registered and', 'unregistered dealers'], debit: '32,10,500.00', credit: '' },
    { lines: ['Sales during the year'], debit: '', credit: '41,75,250.00' },
    { lines: ['Closing stock of finished goods'], debit: '', credit: '6,20,000.00' },
    { lines: ['Discount allowed'], debit: '(15,750.00)', credit: '' },
  ];
  // Two heading rows: "Particulars" takes both, "Amount (Rs.)" lies over Debit and Credit.
  s.text('Particulars', X[0] + 4, 122, { bold: true });
  s.centre('Amount (Rs.)', (X[1] + X[3]) / 2, 112, { bold: true });
  s.right('Debit', X[2] - 4, 130, { bold: true });
  s.right('Credit', X[3] - 4, 130, { bold: true });
  s.bar(X[0], 100, X[3], 100);
  s.bar(X[1], 118, X[3], 118);
  s.bar(X[0], 136, X[3], 136);
  let y = 136;
  for (const row of data) {
    row.lines.forEach((line, l) => s.text(line, X[0] + 4, y + 11.5 + l * 11));
    if (row.debit) s.right(row.debit, X[2] - 4, y + 11.5);
    if (row.credit) s.right(row.credit, X[3] - 4, y + 11.5);
    y += 16 + (row.lines.length - 1) * 11;
    s.bar(X[0], y, X[3], y);
  }
  s.bar(X[0], 100, X[0], y);
  s.bar(X[1], 100, X[1], y);
  s.bar(X[2], 118, X[2], y);
  s.bar(X[3], 100, X[3], y);
  m.expected.rows[0] = [['Particulars', 'Amount (Rs.)', ''], ['', 'Debit', 'Credit'], ...data.map((row) => [row.lines.join(' '), row.debit, row.credit])];
  // Without the lines the page reads top to bottom: the merged heading, then "Particulars", then the two sub-headings.
  m.expected.lineRows[0] = [
    ['', 'Amount (Rs.)', ''],
    ['Particulars', '', ''],
    ['', 'Debit', 'Credit'],
    ...data.flatMap((row) => row.lines.map((line, l) => [line, l === 0 ? row.debit : '', l === 0 ? row.credit : ''])),
  ];
  return finish(m);
}

// ---- a page turned by /Rotate 90, shown landscape -----------------------------------------------------

async function rotatedPage(): Promise<Built> {
  const m = await maker();
  const s = m.page([595, 842], 90);
  s.text('Stock summary (invented)', 60, 60, { size: 12, bold: true });
  m.expected.text[0].push('Stock summary (invented)');
  const X = [60, 300, 420, 540];
  const rows = [
    ['Item', 'Quantity', 'Value (Rs.)'],
    ['Steel rods 12 mm', '1,250', '3,12,500.00'],
    ['Cement bags', '840', '2,94,000.00'],
    ['Binding wire', '65', '9,750.00'],
  ];
  rows.forEach((row, r) => {
    const top = 90 + r * 18;
    row.forEach((cell, c) => {
      // Each cell is its own stroked rectangle, so every inner line is drawn twice.
      s.box(X[c], top, X[c + 1], top + 18);
      if (c === 0) s.text(cell, X[c] + 4, top + 12.5, { bold: r === 0 });
      else s.right(cell, X[c + 1] - 4, top + 12.5, { bold: r === 0 });
    });
  });
  m.expected.rows[0] = rows;
  m.expected.lineRows[0] = rows;
  s.text('Counted on 31 March 2025 by two members of staff.', 60, 190);
  m.expected.text[0].push('Counted on 31 March 2025 by two members of staff.');
  return finish(m);
}

const BUILDERS: Record<ConvertFixtureName, () => Promise<Built>> = {
  'statement-ruled': () => statement(true),
  'statement-plain': () => statement(false),
  'trial-balance': trialBalance,
  'two-column-letter': twoColumnLetter,
  'merged-heading': mergedHeading,
  'rotated-page': rotatedPage,
};

const built = new Map<ConvertFixtureName, Promise<Built>>();
function build(name: ConvertFixtureName): Promise<Built> {
  let made = built.get(name);
  if (!made) built.set(name, (made = BUILDERS[name]()));
  return made;
}

/** The fixture's file, and each page's words and ruling lines as drawn. A fresh copy on every call. */
export async function convertFixture(name: ConvertFixtureName): Promise<ConvertFixture> {
  const made = await build(name);
  return {
    bytes: made.bytes.slice(),
    pages: made.pages.map((page) => ({ ...page, words: page.words.map((word) => ({ ...word })) })),
    segments: made.segments.map((page) => page.map((segment) => ({ ...segment }))),
  };
}

/** What the fixture's pages hold, as drawn. A fresh copy on every call. */
export async function convertFixtureExpected(name: ConvertFixtureName): Promise<ConvertExpected> {
  const { expected } = await build(name);
  const copy = (pages: string[][][]) => pages.map((rows) => rows.map((row) => [...row]));
  return { rows: copy(expected.rows), lineRows: copy(expected.lineRows), text: expected.text.map((lines) => [...lines]) };
}

// ---- a ruled form (T-064, the quality round) ---------------------------------------------------------------

/** What the form fixture draws, for the tests to ask after. Every value is invented. */
export const FORM = {
  title: 'SAMPLE RETURN ACKNOWLEDGEMENT',
  code: 'QZXCV0000W',
  sideLabel: 'Income Details',
  amounts: ['0', '6,79,234', '(-) 70,000'],
  footer: 'DO NOT SEND THIS SAMPLE ANYWHERE',
  /** The grid's column and row edges, in display coordinates. */
  xs: [40, 64, 130, 300, 400, 430, 440, 470, 555],
  ys: [60, 110, 134, 158, 182, 206, 230, 290, 340, 362],
  line: 'B9BFDF',
} as const;

/**
 * An acknowledgement-style form with invented data: a title box with a side cell, label and value rows of two
 * and of four cells, a tall cell with turned text beside three rows of caption, number and right-aligned
 * amount, a boxed sentence with underlined blanks, a picture with a caption, a faint picture behind the middle,
 * and a red underlined line at the foot. Its lines are thin filled boxes in a pale colour (one of them drawn as
 * a box of six points), its fonts Helvetica, Helvetica-Bold and Times-Roman.
 */
export async function formFixture(): Promise<Uint8Array> {
  const { encodePng } = await import('./pdfPictures');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const H = 842;
  const pale = rgb(0xb9 / 255, 0xbf / 255, 0xdf / 255);
  const text = (t: string, x: number, y: number, size: number, font: PDFFont = regular, color = rgb(0, 0, 0)) => page.drawText(t, { x, y: H - y, size, font, color });
  const centred = (t: string, x0: number, x1: number, y: number, size: number, font: PDFFont = regular, color = rgb(0, 0, 0)) => {
    const w = font.widthOfTextAtSize(t, size);
    text(t, (x0 + x1) / 2 - w / 2, y, size, font, color);
    return [(x0 + x1) / 2 - w / 2, (x0 + x1) / 2 + w / 2];
  };
  const hline = (x0: number, x1: number, y: number, color = pale, width = 0.6) => page.drawRectangle({ x: x0, y: H - y - width / 2, width: x1 - x0, height: width, color });
  const vline = (x: number, y0: number, y1: number) => page.drawRectangle({ x: x - 0.3, y: H - y1, width: 0.6, height: y1 - y0, color: pale });
  const [X0, X1, X2, X3, X4, X5, X6, X7, X8] = FORM.xs;
  const [Y0, Y1, Y2, Y3, Y4, Y5, Y6, Y7, Y8, Y9] = FORM.ys;
  void X5;

  // A faint picture behind the middle, drawn first.
  const grey = new Uint8Array(40 * 40).fill(120);
  page.drawImage(await doc.embedPng(encodePng(grey, 40, 40, 1)), { x: 200, y: H - 340, width: 160, height: 160, opacity: 0.1 });

  // The line above the form: a reference at the left, a date at the right, a rule under both.
  text('Reference number: ZX-0000-1234', 40, 42, 10, bold);
  const date = 'Date of issue: 01-Jan-2030';
  text(date, 555 - bold.widthOfTextAtSize(date, 10), 42, 10, bold);
  hline(40, 555, 50, rgb(0, 0, 0));

  // The grid. The top line is a box of six points (two of them along its sides), as some writers draw lines.
  page.pushOperators(
    pushGraphicsState(),
    setFillingColor(pale),
    moveTo(X0, H - Y0 - 0.3),
    lineTo(300, H - Y0 - 0.3),
    lineTo(X8, H - Y0 - 0.3),
    lineTo(X8, H - Y0 + 0.3),
    lineTo(300, H - Y0 + 0.3),
    lineTo(X0, H - Y0 + 0.3),
    closePath(),
    fill(),
    popGraphicsState(),
  );
  for (const y of [Y1, Y2, Y3, Y6, Y7, Y8, Y9]) hline(X0, X8, y);
  for (const y of [Y4, Y5]) hline(X1, X8, y);
  vline(X0, Y0, Y9);
  vline(X8, Y0, Y9);
  vline(X7, Y0, Y1);
  vline(X2, Y1, Y3);
  vline(X3, Y2, Y3);
  vline(X5, Y2, Y3);
  vline(X1, Y3, Y6);
  vline(X4, Y3, Y6);
  vline(X6, Y3, Y6);

  // The title box and its side cell.
  const [t0, t1] = centred(FORM.title, X0, X7, 80, 11, bold);
  hline(t0, t1, 81.5, rgb(0, 0, 0), 0.7);
  centred('(issued for a made-up sample only)', X0, X7, 96, 7.5, serif);
  centred('Sample Year', X7, X8, 80, 9);
  centred('2030-31', X7, X8, 96, 9);
  // Label and value rows.
  text('Code', 46, 126, 8);
  text(FORM.code, 136, 126, 8);
  text('Status', 46, 150, 8);
  text('Individual', 136, 150, 8);
  text('Form', 306, 150, 8);
  text('S-3', 436, 150, 8);
  // The tall cell with turned text, and its three rows.
  const side = bold.widthOfTextAtSize(FORM.sideLabel, 8);
  page.drawText(FORM.sideLabel, { x: 55, y: H - ((Y3 + Y6) / 2 + side / 2), size: 8, font: bold, rotate: degrees(90) });
  ['Business loss of the year, if any', 'Total income', 'Tax payable or refundable'].forEach((caption, i) => {
    const y = Y3 + 16 + i * 24;
    text(caption, 70, y, 8);
    text(String(i + 1), 406, y, 8);
    text(FORM.amounts[i], 549 - regular.widthOfTextAtSize(FORM.amounts[i], 8), y, 8);
  });
  // The boxed sentence, with blanks drawn as underlines.
  const blank = (t: string, x: number, y: number): number => {
    const w = regular.widthOfTextAtSize(t, 8);
    text(t, x + 12, y, 8);
    hline(x, x + w + 24, y + 1.5, rgb(0, 0, 0), 0.5);
    return x + w + 24;
  };
  const piece = (t: string, x: number, y: number): number => {
    text(t, x, y, 8);
    return x + regular.widthOfTextAtSize(t, 8) + 6;
  };
  let x = piece('Return transmitted on', 50, 252);
  x = blank('01-Jan-2030', x, 252) + 6;
  x = piece('from address', x, 252);
  blank('10.0.0.1', x, 252);
  x = piece('and verified by', 50, 272);
  x = blank('SAMPLE PERSON', x, 272) + 6;
  x = piece('using code', x, 272);
  blank('ABC123', x, 272);
  // The picture with its caption, and the words beside it.
  text('System generated', 60, 310, 8);
  text('Sample code', 60, 326, 8);
  const check = new Uint8Array(60 * 20 * 3);
  for (let i = 0; i < 60 * 20; i++) check.fill((i % 60) % 4 < 2 ? 0 : 255, i * 3, i * 3 + 3);
  page.drawImage(await doc.embedPng(encodePng(check, 60, 20, 3)), { x: 250, y: H - 322, width: 120, height: 24 });
  centred('ZZ0000SAMPLE0000CAPTION', 250, 370, 334, 7, bold);
  // The line at the foot: red, bold, underlined.
  const red = rgb(1, 0, 0);
  const [f0, f1] = centred(FORM.footer, X0, X8, 354, 8, bold, red);
  hline(f0, f1, 355.5, red, 0.6);
  return doc.save();
}
