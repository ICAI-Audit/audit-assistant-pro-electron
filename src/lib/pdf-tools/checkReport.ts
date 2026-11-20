// The Document check report (T-064, contract REV and decisions 6 and 8): the same rows as the dialog
// (documentCheck.ts factRows) on A4 portrait pages, 36 pt margins, Helvetica 10 with a bold 14 title, and the
// footer "Made by ICAI VERA PDF Tools on this computer · page n of N".
//
// - Standard fonts only (no font embedding is installed): a word they cannot print is shown as
//   "[word in another script]" and counted, so the run can say how many.
// - The report sets no title, author, subject or keywords of its own (Producer and Creator are "ICAI VERA",
//   as for the other tools' results), so nothing in it is "still carried" from the checked file's properties.
// - It is built with pdf-lib from nothing: no object of the checked file, so no signature, is copied into it.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { factRows, plainDate, shownText, type DocumentFacts } from './documentCheck';
import { textWidth } from './marks';
import { savePaced } from './pace';

export const REPORT_TITLE = 'Document check';
export const OTHER_SCRIPT = '[word in another script]';

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 36;
const BODY = 10;
const TITLE = 14;
const NOTE = 9;
const FOOTER = 8;
const LEADING = 13;
const NOTE_LEADING = 11.5;
const LABEL_WIDTH = 132;
const GUTTER = 10;
const ROW_GAP = 5;
const VALUE_X = MARGIN + LABEL_WIDTH + GUTTER;
const VALUE_WIDTH = PAGE[0] - MARGIN - VALUE_X;
const FULL_WIDTH = PAGE[0] - 2 * MARGIN;
/** The footer's baseline, and the lowest a line of the body may sit. */
const FOOTER_Y = MARGIN - FOOTER;
const BODY_BOTTOM = MARGIN + 6;
const GREY = rgb(0.35, 0.35, 0.35);
const RULE = rgb(0.75, 0.75, 0.75);

export function footerText(page: number, pages: number): string {
  return `Made by ICAI VERA PDF Tools on this computer · page ${page} of ${pages}`;
}

/** Words the standard fonts cannot print, replaced by OTHER_SCRIPT and counted. */
class Printable {
  private readonly supported: Set<number>;
  wordsNotShown = 0;
  constructor(font: PDFFont) {
    this.supported = new Set(font.getCharacterSet());
  }

  text(raw: string): string {
    return shownText(raw)
      .split(' ')
      .map((word) => {
        if ([...word].every((ch) => this.supported.has(ch.codePointAt(0)!))) return word;
        this.wordsNotShown += 1;
        return OTHER_SCRIPT;
      })
      .join(' ');
  }
}

/** The text cut into lines of at most `width`; a word longer than a line is broken between characters. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  // Summed per character: drawing prints without kerning, widthOfTextAtSize subtracts kerning pairs (marks.ts).
  const fits = (t: string) => textWidth(font, t, size) <= width;
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = '';
    let rest = word;
    while (!fits(rest)) {
      const chars = [...rest];
      let n = 1;
      while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n++;
      lines.push(chars.slice(0, n).join(''));
      rest = chars.slice(n).join('');
    }
    line = rest;
  }
  if (line !== '' || lines.length === 0) lines.push(line);
  return lines;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Writes lines top-down, starting a new page whenever the next line would reach the footer. */
class Writer {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = 0;
  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.newPage();
  }

  private newPage(): void {
    this.page = this.doc.addPage(PAGE);
    this.pages.push(this.page);
    this.y = PAGE[1] - MARGIN;
  }

  /** Moves down by `height`, first to a new page when the line would not fit. */
  private room(height: number): void {
    if (this.y - height < BODY_BOTTOM) this.newPage();
    this.y -= height;
  }

  line(text: string, opts: { x?: number; size?: number; bold?: boolean; grey?: boolean; leading?: number } = {}): void {
    const size = opts.size ?? BODY;
    this.room(opts.leading ?? LEADING);
    if (text === '') return;
    this.page.drawText(text, { x: opts.x ?? MARGIN, y: this.y + (opts.leading ?? LEADING) - size, size, font: opts.bold ? this.fonts.bold : this.fonts.regular, color: opts.grey ? GREY : rgb(0, 0, 0) });
  }

  gap(height: number): void {
    this.y -= height;
  }

  rule(): void {
    this.room(6);
    this.page.drawLine({ start: { x: MARGIN, y: this.y + 3 }, end: { x: PAGE[0] - MARGIN, y: this.y + 3 }, thickness: 0.5, color: RULE });
  }

  /** One fact: its label on the left, the value and its note on the right; the lines go onto the next page if need be. */
  row(label: string[], value: string[], note: string[]): void {
    const right: { text: string; note: boolean }[] = [...value.map((text) => ({ text, note: false })), ...note.map((text) => ({ text, note: true }))];
    const count = Math.max(label.length, right.length);
    // Keep a short row together on one page.
    const height = count * LEADING;
    if (height < PAGE[1] - 2 * MARGIN && this.y - height < BODY_BOTTOM) this.newPage();
    for (let k = 0; k < count; k++) {
      const leading = right[k]?.note && k >= label.length ? NOTE_LEADING : LEADING;
      this.room(leading);
      const base = this.y + leading - BODY;
      if (k < label.length) this.page.drawText(label[k], { x: MARGIN, y: base, size: BODY, font: this.fonts.bold });
      const r = right[k];
      if (r) this.page.drawText(r.text, { x: VALUE_X, y: base, size: r.note ? NOTE : BODY, font: this.fonts.regular, color: r.note ? GREY : rgb(0, 0, 0) });
    }
    this.gap(ROW_GAP);
  }

  footers(): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => page.drawText(footerText(i + 1, total), { x: MARGIN, y: FOOTER_Y, size: FOOTER, font: this.fonts.regular, color: GREY }));
  }
}

export interface CheckReport {
  bytes: Uint8Array;
  pages: number;
  /** Words shown as "[word in another script]". */
  wordsNotShown: number;
}

/** The report, with its page count and the words the standard fonts could not print. */
export async function buildCheckReportCounted(fileName: string, facts: DocumentFacts, madeOn: Date): Promise<CheckReport> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('ICAI VERA');
  doc.setCreator('ICAI VERA');
  doc.setCreationDate(madeOn);
  doc.setModificationDate(madeOn);
  const fonts: Fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const printable = new Printable(fonts.regular);
  const out = new Writer(doc, fonts);

  out.line(REPORT_TITLE, { size: TITLE, bold: true, leading: 18 });
  out.gap(2);
  for (const line of wrap(printable.text(fileName), fonts.bold, BODY, FULL_WIDTH)) out.line(line, { bold: true });
  out.line(`Checked on ${plainDate(madeOn)}`, { size: NOTE, grey: true, leading: NOTE_LEADING });
  out.gap(4);
  out.rule();
  out.gap(4);

  for (const row of factRows(facts)) {
    out.row(
      wrap(printable.text(row.label), fonts.bold, BODY, LABEL_WIDTH),
      wrap(printable.text(row.value), fonts.regular, BODY, VALUE_WIDTH),
      row.note ? wrap(printable.text(row.note), fonts.regular, NOTE, VALUE_WIDTH) : [],
    );
  }
  out.footers();
  const bytes = await savePaced(doc, { useObjectStreams: false });
  return { bytes, pages: out.pages.length, wordsNotShown: printable.wordsNotShown };
}

/** The report as a PDF (contract REV): see buildCheckReportCounted. */
export async function buildCheckReport(fileName: string, facts: DocumentFacts, madeOn: Date): Promise<Uint8Array> {
  return (await buildCheckReportCounted(fileName, facts, madeOn)).bytes;
}
