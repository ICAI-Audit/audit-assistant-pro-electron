// Compare's report (contract T-064 decisions 3, 6, 8 and 17): a PDF that says what differs between two
// versions. A summary comes first (pages in each, pages that differ, pages in one file only, words added,
// removed and changed, pages with no text); then each page that differs, with its removed, added and
// changed (old → new) words, each with up to five words of the same text on each side so that the reader
// can find the place.
//
// - A4 portrait, 36 pt margins, Helvetica 10, a bold 14 pt title, and the footer "Made by ICAI VERA PDF Tools
//   on this computer · page n of N" (the same frame as Document check's report).
// - Standard fonts only (no font embedding is installed): a word they cannot draw is printed as
//   "[word in another script]" and counted; ₹ is printed as "Rs.". The arrow comes from the Symbol font.
// - At most 200 differing pages are detailed (the rest are counted), at most 200 changes a page, and a
//   passage of over 40 words is shortened to its start and end with its length.
// - The report sets no title, author, subject or keywords (decision 8); Producer and Creator are "ICAI VERA".
// - Writing gives the window its turns through the caller's pace; the save is pace.ts's savePaced.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { changeEntries, pairDiffers, type ChangeEntry, type Comparison, type PagePair } from './compareText';
import { runAtOnce, runPaced, savePaced, type Pace, type Work } from './pace';

/** What a word the standard fonts cannot draw is printed as (decision 6). */
export const NOT_PRINTABLE = '[word in another script]';
/** Differing pages detailed in one report; the rest are counted (decision 17). */
export const MAX_DETAILED_PAGES = 200;
/** Changes listed for one page; the rest are counted. */
export const MAX_CHANGES_PER_PAGE = 200;
/** A passage longer than this is shown by its first and last words and its length. */
export const LONG_PASSAGE_WORDS = 40;
const PASSAGE_HEAD = 25;
const PASSAGE_TAIL = 10;
/** How a page in one file only is shown: its first words. */
const BEGINS_WORDS = 12;

export const REPORT_TITLE = 'Comparison of two versions';
export const footerText = (page: number, pages: number) => `Made by ICAI VERA PDF Tools on this computer · page ${page} of ${pages}`;

const PAGE_SIZE: [number, number] = [595.28, 841.89];
const MARGIN = 36;
const BODY = 10;
const SMALL = 9;
const FOOTER_SIZE = 8;
const FOOTER_Y = 20;
const RIGHT = PAGE_SIZE[0] - MARGIN;
const TOP = PAGE_SIZE[1] - MARGIN;
const BOTTOM = MARGIN;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.36, 0.36, 0.36);
const REMOVED = rgb(0.62, 0.08, 0.08);
const ADDED = rgb(0, 0.42, 0.18);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateText = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
/** Counts with their digits grouped as the tools' messages write them (1,000; 1,23,456). */
const grouped = (n: number) => n.toLocaleString('en-IN');
const count = (n: number, one: string, many = `${one}s`) => `${grouped(n)} ${n === 1 ? one : many}`;

type FontName = 'regular' | 'bold' | 'symbol';
/** Words of one look; laid out with one space between words. */
interface Piece {
  text: string;
  font?: FontName;
  color?: RGB;
}

/** Characters the standard fonts draw as something else, before the check. */
const STAND_INS: [RegExp, string][] = [
  [/₹/g, 'Rs.'],
  [/[‐‑−]/g, '-'],
];

class Writer {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = 0;
  /** Words printed as NOT_PRINTABLE. */
  notShown = 0;
  private readonly drawable = new Map<string, boolean>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Record<FontName, PDFFont>,
  ) {
    this.newPage();
  }

  private newPage(): void {
    this.page = this.doc.addPage(PAGE_SIZE);
    this.pages.push(this.page);
    this.y = TOP;
  }

  /** Room for `height` more, else a new page. */
  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  space(height: number): void {
    this.y -= height;
  }

  private canDraw(ch: string): boolean {
    let ok = this.drawable.get(ch);
    if (ok === undefined) {
      ok = (ch.codePointAt(0) ?? 0) >= 0x20;
      if (ok) {
        try {
          this.fonts.regular.encodeText(ch);
          this.fonts.bold.encodeText(ch);
        } catch {
          ok = false;
        }
      }
      this.drawable.set(ch, ok);
    }
    return ok;
  }

  /** A word of a document (or a file name) as it can be printed; counted when it cannot. */
  printable(word: string): string {
    let text = word;
    for (const [from, to] of STAND_INS) text = text.replace(from, to);
    for (const ch of text) {
      if (!this.canDraw(ch)) {
        this.notShown += 1;
        return NOT_PRINTABLE;
      }
    }
    return text;
  }

  font(name: FontName): PDFFont {
    return this.fonts[name];
  }

  printWords(words: readonly string[]): string {
    return words.map((w) => this.printable(w)).join(' ');
  }

  /** Where a line starts now (for a line drawn once its value is known). */
  reserveLine(leading: number): { page: PDFPage; y: number } {
    this.ensure(leading);
    this.y -= leading;
    return { page: this.page, y: this.y + leading - BODY };
  }

  /**
   * One paragraph of pieces, wrapped at the right margin; lines after the first start `hang` further in.
   * A word wider than a whole line is broken where it must be.
   */
  paragraph(pieces: readonly Piece[], options: { size?: number; leading?: number; hang?: number; before?: number } = {}): void {
    const size = options.size ?? BODY;
    const leading = options.leading ?? size * 1.3;
    const hang = options.hang ?? 0;
    if (options.before) this.space(options.before);
    type Token = { text: string; font: FontName; color: RGB; width: number };
    const tokens: Token[] = [];
    const available = RIGHT - MARGIN - hang;
    for (const piece of pieces) {
      const font = piece.font ?? 'regular';
      const color = piece.color ?? BLACK;
      for (const word of piece.text.split(' ')) {
        if (word === '') continue;
        const width = this.fonts[font].widthOfTextAtSize(word, size);
        if (width <= available) {
          tokens.push({ text: word, font, color, width });
          continue;
        }
        let part = '';
        for (const ch of word) {
          if (part !== '' && this.fonts[font].widthOfTextAtSize(part + ch, size) > available) {
            tokens.push({ text: part, font, color, width: this.fonts[font].widthOfTextAtSize(part, size) });
            part = '';
          }
          part += ch;
        }
        if (part !== '') tokens.push({ text: part, font, color, width: this.fonts[font].widthOfTextAtSize(part, size) });
      }
    }
    let line: (Token & { x: number })[] = [];
    let x = MARGIN;
    const flush = () => {
      if (line.length === 0) return;
      this.ensure(leading);
      const baseline = this.y - size;
      // Words of one look next to each other are drawn as one string (their spaces measured in that font).
      let k = 0;
      while (k < line.length) {
        const first = line[k];
        let text = first.text;
        let j = k + 1;
        while (j < line.length && line[j].font === first.font && line[j].color === first.color) {
          text += ` ${line[j].text}`;
          j++;
        }
        this.page.drawText(text, { x: first.x, y: baseline, size, font: this.fonts[first.font], color: first.color });
        k = j;
      }
      this.y -= leading;
      line = [];
    };
    for (const token of tokens) {
      const space = line.length === 0 ? 0 : this.fonts[line[line.length - 1].font === token.font ? token.font : 'regular'].widthOfTextAtSize(' ', size);
      if (line.length > 0 && x + space + token.width > RIGHT) {
        flush();
        x = MARGIN + hang;
      }
      const at = line.length === 0 ? x : x + space;
      line.push({ ...token, x: at });
      x = at + token.width;
    }
    flush();
  }

  footers(): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      page.drawText(footerText(i + 1, total), { x: MARGIN, y: FOOTER_Y, size: FOOTER_SIZE, font: this.fonts.regular, color: GREY });
    });
  }
}

/** A passage as printed: shortened to its start and end, with its length, when it is long. */
function passage(w: Writer, words: readonly string[]): string {
  if (words.length <= LONG_PASSAGE_WORDS) return w.printWords(words);
  return `${w.printWords(words.slice(0, PASSAGE_HEAD))} … ${w.printWords(words.slice(-PASSAGE_TAIL))} (${words.length} words)`;
}

/** One change as a paragraph: its label, the words before, the change, the words after. */
function entryPieces(w: Writer, e: ChangeEntry): Piece[] {
  const pieces: Piece[] = [];
  const changed = e.removed.length > 0 && e.added.length > 0;
  pieces.push({ text: changed ? 'Changed:' : e.added.length > 0 ? 'Added:' : 'Removed:', font: 'bold' });
  if (e.before.length > 0) pieces.push({ text: `${e.atStart ? '' : '…'}${w.printWords(e.before)}`, color: GREY });
  if (e.removed.length > 0) pieces.push({ text: passage(w, e.removed), font: 'bold', color: REMOVED });
  if (changed) pieces.push({ text: '→', font: 'symbol' });
  if (e.added.length > 0) pieces.push({ text: passage(w, e.added), font: 'bold', color: ADDED });
  if (e.after.length > 0) pieces.push({ text: `${w.printWords(e.after)}${e.atEnd ? '' : '…'}`, color: GREY });
  return pieces;
}

function pairHeading(pair: PagePair): string {
  if (pair.later === null) return `Earlier page ${(pair.earlier ?? 0) + 1}: only in the earlier version`;
  if (pair.earlier === null) return `Later page ${pair.later + 1}: only in the later version`;
  return `Earlier page ${pair.earlier + 1} and later page ${pair.later + 1}`;
}

function* writeReport(w: Writer, names: { earlier: string; later: string }, c: Comparison, madeOn: Date): Work<void> {
  w.paragraph([{ text: REPORT_TITLE, font: 'bold' }], { size: 14, leading: 20 });
  w.paragraph([{ text: `Made on ${dateText(madeOn)}.`, color: GREY }]);
  w.paragraph([{ text: 'Earlier version:', font: 'bold' }, { text: `${w.printWords(names.earlier.split(' '))}, ${count(c.pagesEarlier, 'page')}` }], { before: 8 });
  w.paragraph([{ text: 'Later version:', font: 'bold' }, { text: `${w.printWords(names.later.split(' '))}, ${count(c.pagesLater, 'page')}` }]);

  w.paragraph([{ text: 'Summary', font: 'bold' }], { size: 12, leading: 16, before: 10 });
  const rows = [
    `Pages that differ: ${grouped(c.pagesDiffer)} of ${grouped(c.pagesLater)}`,
    `Pages only in the earlier version: ${grouped(c.pagesOnlyEarlier)}`,
    `Pages only in the later version: ${grouped(c.pagesOnlyLater)}`,
    `Words added: ${grouped(c.wordsAdded)}`,
    `Words removed: ${grouped(c.wordsRemoved)}`,
    `Words changed: ${grouped(c.wordsChanged)}`,
    `Pages with no text (both versions together): ${grouped(c.pagesWithoutText)}`,
  ];
  if (c.pagesComparedCoarsely > 0) rows.push(`Very long pages compared in larger pieces: ${grouped(c.pagesComparedCoarsely)}`);
  for (const row of rows) w.paragraph([{ text: row }]);
  // Known only once everything is written: drawn at the end.
  const notShownLine = w.reserveLine(BODY * 1.3);
  w.paragraph(
    [
      { text: 'Pages that differ are pages in both versions whose text differs, out of the pages of the later version. Word counts are for pages found in both versions. A changed word is one replaced by another in the same place (old', color: GREY },
      { text: '→', font: 'symbol', color: GREY },
      { text: 'new). Spaces and line breaks are not differences.', color: GREY },
    ],
    { size: SMALL, before: 4 },
  );

  const differing = c.pairs.filter(pairDiffers);
  if (differing.length > 0) w.paragraph([{ text: 'Pages that differ', font: 'bold' }], { size: 12, leading: 16, before: 12 });
  for (const pair of differing.slice(0, MAX_DETAILED_PAGES)) {
    yield;
    w.ensure(BODY * 1.3 * 3);
    w.paragraph([{ text: pairHeading(pair), font: 'bold' }], { size: 11, leading: 15, before: 8 });
    const changes = pair.changes;
    if (pair.earlier === null || pair.later === null) {
      const words = changes.flatMap((run) => (run.text === '' ? [] : run.text.split(' ')));
      if (words.length === 0) w.paragraph([{ text: 'This page has no text.', color: GREY }]);
      else w.paragraph([{ text: 'Begins:', font: 'bold' }, { text: `${w.printWords(words.slice(0, BEGINS_WORDS))}${words.length > BEGINS_WORDS ? '…' : ''}`, color: GREY }], { hang: 12 });
      continue;
    }
    w.paragraph([{ text: `${count(pair.added, 'word')} added, ${grouped(pair.removed)} removed, ${grouped(pair.changed)} changed.`, color: GREY }], { size: SMALL });
    if (pair.coarse) w.paragraph([{ text: 'This page is very long, so it was compared in larger pieces: some changes are shown as whole passages.', color: GREY }], { size: SMALL });
    const entries = changeEntries(changes);
    for (const [k, entry] of entries.entries()) {
      if (k >= MAX_CHANGES_PER_PAGE) {
        const rest = entries.length - MAX_CHANGES_PER_PAGE;
        w.paragraph([{ text: `… and ${grouped(rest)} more ${rest === 1 ? 'change on this page is' : 'changes on this page are'} not listed.`, color: GREY }], { size: SMALL });
        break;
      }
      yield;
      w.paragraph(entryPieces(w, entry), { hang: 12, before: 2 });
    }
  }
  const rest = differing.length - MAX_DETAILED_PAGES;
  if (rest > 0) {
    w.paragraph(
      [{ text: rest === 1 ? '1 more page differs. It is counted in the summary but not detailed in this report.' : `${grouped(rest)} more pages differ. They are counted in the summary but not detailed in this report.` }],
      { before: 10 },
    );
  }
  notShownLine.page.drawText(`Words shown as ${NOT_PRINTABLE}: ${w.notShown}`, { x: MARGIN, y: notShownLine.y, size: BODY, font: w.font('regular'), color: BLACK });
}

/**
 * The report of a comparison: its bytes, its page count, and how many words were printed as
 * NOT_PRINTABLE. `pace` gives the window its turns while it is written (and takes Stop).
 */
export async function buildCompareReport(
  names: { earlier: string; later: string },
  c: Comparison,
  madeOn: Date,
  pace?: Pace,
): Promise<{ bytes: Uint8Array; pages: number; wordsNotShown: number }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('ICAI VERA');
  doc.setCreator('ICAI VERA');
  const fonts: Record<FontName, PDFFont> = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    symbol: await doc.embedFont(StandardFonts.Symbol),
  };
  const w = new Writer(doc, fonts);
  const work = writeReport(w, names, c, madeOn);
  if (pace) await runPaced(work, pace);
  else runAtOnce(work);
  w.footers();
  const bytes = await savePaced(doc);
  return { bytes, pages: doc.getPageCount(), wordsNotShown: w.notShown };
}
