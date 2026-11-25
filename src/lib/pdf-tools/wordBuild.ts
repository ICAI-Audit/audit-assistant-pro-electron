/**
 * PDF to Word (design 5.11; contract decision 14): the plan of a Word document that keeps the look of the
 * pages of a PDF and stays editable, made from the page layouts of layout.ts, and the .docx written from it.
 * The first build made an editable text version only; the owner rejected that on 19 November 2026, and the
 * look of the page (places, fonts, colours, pictures, rules, tables with their cells) is now kept by
 * wordLook.ts. Where the paragraph below says something is not kept, wordLook.ts is the authority.
 *
 * What is kept: paragraphs in reading order, headings by font size (1.5 × the body size or more is Heading 1,
 * 1.2 × or more is Heading 2), ruled tables, aligned tables only when 3 or more column starts are each shared
 * by 3 or more rows (otherwise their rows are lines of text, the cells apart by a tab), and one page break
 * between pages. What is not: pictures, fonts, colours, text columns and the page layout. No word is dropped:
 * a page with fewer than 20 characters (it may be scanned) is counted in `pagesNoText`, and its few words are
 * kept as one paragraph; a page with no word at all (`hasText` false) stays an empty page, and is counted too.
 *
 * How the lines of a text block become paragraphs:
 * - a new paragraph starts at a change of size (a heading and its body never share a paragraph);
 * - at a clear vertical gap: a line spacing more than 1.35 × the block's usual spacing (and half a point), or,
 *   in a block with no usual spacing, a gap between two lines of more than 0.75 × the font size;
 * - at an indent: a line that starts away from where most lines of its size start in the block, after a line
 *   that starts there (a first-line indent; and in a hanging indent, the line that starts the next item);
 * - after a short last line: when the first word of a line would have fitted at the end of the line before
 *   (measured to the right edge of the lines of that size in the block, or in another block of the page that
 *   starts at the same place: so each line of an address above a letter is a paragraph of its own; not for a
 *   column, a block with another beside it to its right);
 * - a line ending in a hyphen joined to a word ("finan-", "cial") is one word: the hyphen goes before a small
 *   letter ("financial") and stays before anything else ("2024-25"); a lone dash is not a hyphen. Such a line
 *   is never "short" or followed by an indent; a change of size or a clear gap still starts a new paragraph.
 * Words are joined with single spaces, in the order the layout gives them, so Hindi and other scripts pass
 * through as they are read. Characters a Word file cannot hold (control characters, lone surrogates) are
 * left out.
 *
 * The writer: the `docx` package writes the package (styles, settings, relationships, properties: no title or
 * author), and the body is written here, part by part, giving the window turns (pace.ts); jszip zips it in
 * slices. The package's own writing of a body is one stretch of work: 2.5 s for 500 pages, measured (DOC
 * report), far over the 0.3 s rule; written here, the longest stretch was about 0.1 s for 500 and 1,000 pages.
 */
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { SCANNED_MAX_CHARS, type Block, type Border, type Box, type Line, type PageLayout, type PageRule, type Picture, type Stroke, type Table as LayoutTable, type Word } from './layout';
import { runAtOnce, runPaced, type Pace, type Work } from './pace';
import type { PictureFile } from './pdfPictures';
import { cellParagraphs, clean, isSetLine, paragraphLook, tableLook, type CellLook, type ParaLook, type RunLook, type TableLook, type TextMeasure } from './wordLook';

export type DocPart =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'page-break' };

/** How a part looks on the page (wordLook.ts): a paragraph or heading, or a table. */
export type PartLook = ({ para: ParaLook } | { table: TableLook }) & { column?: ColumnLook };
/** A part standing in one of two columns of text: the run of columns it belongs to, which column, and the columns' edges on the page. */
export interface ColumnLook { group: number; index: 0 | 1; left: number; leftEnd: number; rightStart: number; right: number }
/** One page of the source: its size, the margins its content leaves, its pictures and the rules across it (points). */
export interface PageSetup {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  pictures: Picture[];
  /** What else the page draws outside its tables, as filled boxes at their places: rules, lines down the page, coloured bands. */
  shapes: (Box & { color: string })[];
  /** Its slanted lines, from their first point to their last. */
  lines?: Stroke[];
}
/** The looks of a plan: `looks[i]` belongs to `parts[i]` (null: written plainly), `pages[p]` to the p-th page. */
export interface DocLooks {
  looks: (PartLook | null)[];
  pages: PageSetup[];
}

export interface WordReport {
  pages: number;
  paragraphs: number;
  headings: number;
  tables: number;
  pagesNoText: number;
  /** Pages that are scans with recognised text (layout.ts `scan`): their words were typed and the scan picture left out. Absent when there is none. */
  pagesFromScan?: number;
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Contract decision 13. */
export const HEADING_1_RATIO = 1.5;
export const HEADING_2_RATIO = 1.2;
/** An aligned grid is a table only with this many rows sharing this many columns (decision 13). */
export const ALIGNED_MIN_ROWS = 3;
export const ALIGNED_MIN_COLUMNS = 3;

/** Two sizes within this share of the larger are one size. */
const SAME_SIZE = 0.1;
/** A line spacing more than this many times the block's usual one is a paragraph gap (plus GAP_SLACK_PT). */
const GAP_RATIO = 1.35;
const GAP_SLACK_PT = 0.5;
/** Line spacings above this many font sizes are not "usual": they are gaps already. */
const USUAL_PITCH_MAX = 2.2;
/** In a block with no usual spacing: a gap between two lines above this many font sizes. */
const GAP_WITHOUT_PITCH = 0.75;
/** A start this many font sizes away from the usual start is an indent. */
const INDENT_EM = 0.8;
/** Starts this close (points) are one start. */
const SAME_START_PT = 2;
/** A block measures against another block of the page whose lines start within this many font sizes of its own. */
const SAME_LEFT_EM = 2;
/** A line is short when its slack beats the next line's first word by this many font sizes (a space and a little). */
const SHORT_SLACK_EM = 0.5;

// XML 1.0 refuses these, and Word will not open a file holding them (with the u flag a pair of surrogates is
// one character, so only a lone one matches).
// eslint-disable-next-line no-control-regex
const NOT_IN_XML = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{FFFE}\u{FFFF}\u{D800}-\u{DFFF}]/gu;

const sizeKey = (size: number) => Math.round(size * 2) / 2;
const sameSize = (a: number, b: number) => Math.abs(a - b) <= SAME_SIZE * Math.max(a, b);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function headingLevel(size: number, body: number): 0 | 1 | 2 {
  if (body <= 0) return 0;
  const ratio = size / body;
  if (ratio >= HEADING_1_RATIO - 1e-6) return 1;
  if (ratio >= HEADING_2_RATIO - 1e-6) return 2;
  return 0;
}

/** A word ending in a hyphen (or a soft or Unicode hyphen) that joins it to the next line's first word; not a lone dash. */
const HYPHEN_END = /[\p{L}\p{N}][-\u{AD}\u{2010}]$/u;
const SOFT_HYPHEN_END = /\u{AD}$/u;
const SMALL_LETTER_START = /^\p{Ll}/u;

/** A line as the paragraph rules read it. */
interface PreparedLine {
  size: number;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  texts: string[];
  /** The width of its first word. */
  firstWidth: number;
  /** The line itself, and whether its pieces are set at places of their own (wordLook.ts isSetLine). */
  line: Line;
  set: boolean;
  /** Where its text starts after a number or mark set apart at its start (the hanging indent the lines after it would start at), if it starts so. */
  hang?: number;
}

/** A mark at a line's start (a number, a letter in brackets, a bullet) stands at least this many font sizes before the text after it. */
const MARK_GAP_EM = 0.45;

function prepare(lines: readonly Line[]): PreparedLine[] {
  const out: PreparedLine[] = [];
  for (const line of lines) {
    const texts: string[] = [];
    let x0 = Infinity;
    let x1 = -Infinity;
    let firstWidth = 0;
    for (const word of line.words) {
      const text = clean(word.text).trim();
      if (text === '') continue;
      if (texts.length === 0) firstWidth = word.x1 - word.x0;
      // Raised or lowered text and what touches it are one word with the word before.
      if (word.glued && texts.length > 0) texts[texts.length - 1] += text;
      else texts.push(text);
      x0 = Math.min(x0, word.x0);
      x1 = Math.max(x1, word.x1);
    }
    if (texts.length === 0) continue;
    let hang: number | undefined;
    const shown = line.words.filter((w) => clean(w.text).trim() !== '');
    for (let k = 1; k < shown.length && k <= 2 && hang === undefined; k++) if (shown[k].x0 - shown[k - 1].x1 >= MARK_GAP_EM * (line.size || 10)) hang = shown[k].x0;
    out.push({ size: line.size, y0: line.y0, y1: line.y1, x0, x1, texts, firstWidth, line, set: isSetLine(line), ...(hang !== undefined ? { hang } : {}) });
  }
  return out;
}

/** Where the lines of one size usually start in a block, and how far right they reach. */
interface SizeShape {
  key: number;
  left: number;
  /** More lines start at `left` than at any other start. */
  leftIsUsual: boolean;
  right: number;
}

function sizeShapes(lines: readonly PreparedLine[]): Map<number, SizeShape> {
  const groups = new Map<number, PreparedLine[]>();
  for (const line of lines) {
    const key = sizeKey(line.size);
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }
  const shapes = new Map<number, SizeShape>();
  for (const [key, group] of groups) {
    // The start most lines share is the usual one (the leftmost on a tie).
    const starts: { x: number; n: number }[] = [];
    let right = -Infinity;
    for (const line of group) {
      right = Math.max(right, line.x1);
      const near = starts.find((s) => Math.abs(s.x - line.x0) <= SAME_START_PT);
      if (near) near.n++;
      else starts.push({ x: line.x0, n: 1 });
    }
    starts.sort((a, b) => b.n - a.n || a.x - b.x);
    shapes.set(key, { key, left: starts[0].x, leftIsUsual: starts[0].n > (starts[1]?.n ?? 0), right });
  }
  return shapes;
}

/** Where a block lies on the page. */
interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function linesExtent(lines: readonly PreparedLine[]): Extent | null {
  if (lines.length === 0) return null;
  return { x0: Math.min(...lines.map((l) => l.x0)), x1: Math.max(...lines.map((l) => l.x1)), y0: Math.min(...lines.map((l) => l.y0)), y1: Math.max(...lines.map((l) => l.y1)) };
}

function tableExtent(table: LayoutTable): Extent {
  const x0 = table.columns.length > 0 ? Math.min(...table.columns) : 0;
  const right = table.rows.flatMap((row) => row.flatMap((cell) => cell.words.map((w) => w.x1)));
  return { x0, x1: Math.max(x0, ...right), y0: table.y0, y1: table.y1 };
}

/**
 * A block of short lines (an address above a letter) measures its lines against the blocks of its page that
 * start where it starts, unless it is a column: another block beside it, to its right, at the same height.
 */
function widenRights(blocks: readonly { shapes: Map<number, SizeShape>; extent: Extent | null }[], extents: readonly Extent[]): void {
  const own = new Map<SizeShape, number>();
  for (const { shapes } of blocks) for (const shape of shapes.values()) own.set(shape, shape.right);
  for (const block of blocks) {
    const at = block.extent;
    if (!at) continue;
    const column = extents.some((e) => e !== at && e.y0 < at.y1 && e.y1 > at.y0 && e.x0 >= at.x1 - SAME_START_PT);
    if (column) continue;
    for (const shape of block.shapes.values()) {
      for (const other of blocks) {
        if (other === block) continue;
        for (const theirs of other.shapes.values()) {
          if (sameSize(theirs.key, shape.key) && Math.abs(theirs.left - shape.left) <= SAME_LEFT_EM * shape.key) shape.right = Math.max(shape.right, own.get(theirs)!);
        }
      }
    }
  }
}

interface Para {
  level: 0 | 1 | 2;
  text: string;
  lines: Line[];
}

/** The paragraphs of one text block (the rules at the top of this file). */
function blockParagraphs(lines: readonly PreparedLine[], shapes: ReadonlyMap<number, SizeShape>, body: number): Para[] {
  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1];
    const b = lines[i];
    const pitch = b.y0 - a.y0;
    if (sameSize(a.size, b.size) && pitch > 0 && pitch <= USUAL_PITCH_MAX * Math.max(a.size, b.size)) pitches.push(pitch);
  }
  const usualPitch = median(pitches);
  const away = (line: PreparedLine) => {
    const shape = shapes.get(sizeKey(line.size))!;
    return Math.abs(line.x0 - shape.left) >= INDENT_EM * line.size;
  };

  const paras: Para[] = [];
  let level: 0 | 1 | 2 = 0;
  let text = '';
  let own: Line[] = [];
  // A heading stands alone on its line: a line with pieces set apart (a number at the left, a date at the right) is not one.
  const levelOf = (line: PreparedLine) => (line.set ? 0 : headingLevel(line.size, body));
  lines.forEach((line, i) => {
    const words = line.texts.join(' ');
    const lineLevel = levelOf(line);
    if (i === 0) {
      level = lineLevel;
      text = words;
      own = [line.line];
      return;
    }
    const prev = lines[i - 1];
    const size = Math.max(prev.size, line.size);
    const pitch = line.y0 - prev.y0;
    // Lines centred one under the other (their middles agree, their starts do not) are each a paragraph: centred text does not flow.
    // (Not a first line set in from the margin above a longer line that starts at it.)
    const shape = shapes.get(sizeKey(prev.size))!;
    const longer = prev.x1 - prev.x0 >= line.x1 - line.x0 ? prev : line;
    const centred = Math.abs(prev.x0 + prev.x1 - line.x0 - line.x1) <= 6 && Math.abs(prev.x0 - line.x0) > 6 && !(shape.leftIsUsual && Math.abs(longer.x0 - shape.left) <= SAME_START_PT);
    // The line after a mark and its text, starting where that text starts: the same paragraph, with a hanging indent.
    const hangs = own.length === 1 && prev.hang !== undefined && Math.abs(line.x0 - prev.hang) <= SAME_START_PT && !line.set;
    const sizeChange = !sameSize(prev.size, line.size) || levelOf(prev) !== lineLevel || (prev.set && !hangs) || line.set || (centred && !hangs);
    const clearGap = pitch <= 0 || (usualPitch !== null ? pitch > usualPitch * GAP_RATIO + GAP_SLACK_PT : line.y0 - prev.y1 > GAP_WITHOUT_PITCH * size);
    const hyphenated = HYPHEN_END.test(prev.texts[prev.texts.length - 1]);
    const indent = shapes.get(sizeKey(line.size))!.leftIsUsual && away(line) && !away(prev);
    const short = shapes.get(sizeKey(prev.size))!.right - prev.x1 > line.firstWidth + SHORT_SLACK_EM * line.size;
    if (sizeChange || clearGap || (!hyphenated && ((indent && !hangs) || short))) {
      paras.push({ level, text, lines: own });
      level = lineLevel;
      text = words;
      own = [line.line];
      return;
    }
    own.push(line.line);
    if (hyphenated) {
      const dropHyphen = SOFT_HYPHEN_END.test(text) || SMALL_LETTER_START.test(line.texts[0]);
      text = (dropHyphen ? text.slice(0, -1) : text) + words;
    } else {
      text = `${text} ${words}`;
    }
  });
  if (lines.length > 0) paras.push({ level, text, lines: own });
  return paras;
}

/**
 * An aligned grid is a table only when 3 or more of its column starts are each shared by 3 or more rows (a
 * trial balance, whose rows have an amount in one column or the other, is one; a list of labels and amounts,
 * two columns, is not).
 */
function alignedEnough(rows: readonly string[][]): boolean {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let shared = 0;
  for (let c = 0; c < width; c++) if (rows.filter((row) => (row[c] ?? '') !== '').length >= ALIGNED_MIN_ROWS) shared++;
  return shared >= ALIGNED_MIN_COLUMNS;
}

/** Two columns nearer than this many font sizes (in the middle row) are not set apart as columns are. */
const COLUMN_GAP_EM = 1.2;
/** A table of text has at most this share of amounts among its cells. */
const TEXT_AMOUNT_SHARE = 0.15;
const AMOUNT_CELL = /^[(+-]?(?:₹|Rs\.?|INR)?\s?[(+-]?\d[\d,]*(?:\.\d+)?\)?\s?(?:Dr|Cr|%)?\.?$/i;

/**
 * Whether a table read from how its text lines up is running text after all: hardly any of its cells is an
 * amount, most of its rows run to its right edge, and two of its columns stand no further apart than words do
 * in a justified line (the place where they meet is chance, not a column's edge).
 */
function readsAsText(table: LayoutTable): boolean {
  let cells = 0;
  let amounts = 0;
  let right = -Infinity;
  const ends: number[] = [];
  const gaps: number[][] = table.columns.map(() => []);
  for (const row of table.rows) {
    let end = -Infinity;
    let before: { x1: number; size: number } | null = null;
    row.forEach((cell, c) => {
      if (cell.words.length === 0) return;
      cells++;
      if (AMOUNT_CELL.test(cell.text.trim())) amounts++;
      const x0 = Math.min(...cell.words.map((w) => w.x0));
      const x1 = Math.max(...cell.words.map((w) => w.x1));
      const size = cell.words[0].size || 10;
      if (before) gaps[c].push((x0 - before.x1) / Math.max(size, before.size));
      before = { x1, size };
      end = Math.max(end, x1);
    });
    if (end > -Infinity) ends.push(end);
    right = Math.max(right, end);
  }
  if (cells === 0 || amounts > TEXT_AMOUNT_SHARE * cells) return false;
  const left = table.columns[0];
  if (ends.filter((x) => right - x <= 0.15 * (right - left)).length < 0.5 * ends.length) return false;
  return gaps.some((list) => list.length >= 2 && (median(list) ?? Infinity) < COLUMN_GAP_EM);
}

/** Every row as wide as the table, each cell's text cleaned. */
function tableRows(table: LayoutTable): string[][] {
  const width = Math.max(table.columns.length, ...table.rows.map((r) => r.length));
  return table.rows.map((row) => Array.from({ length: width }, (_, c) => clean(row[c]?.text ?? '').trim()));
}

/** The size most characters are written in (table cells included); the smaller size on a tie. 0 with no text. */
function* bodySize(pages: readonly PageLayout[]): Work<number> {
  const chars = new Map<number, number>();
  const add = (size: number, text: string) => {
    const n = text.replace(/\s/g, '').length;
    if (n > 0 && size > 0) chars.set(sizeKey(size), (chars.get(sizeKey(size)) ?? 0) + n);
  };
  for (const page of pages) {
    if (!page.hasText) continue;
    for (const block of page.blocks) {
      if (block.kind === 'text') for (const line of block.lines) for (const word of line.words) add(word.size || line.size, word.text);
      else for (const row of block.table.rows) for (const cell of row) for (const word of cell.words) add(word.size, word.text);
    }
    yield;
  }
  let best = 0;
  let most = 0;
  for (const [size, n] of chars) {
    if (n > most || (n === most && size < best)) {
      best = size;
      most = n;
    }
  }
  return best;
}

/**
 * A page with fewer than SCANNED_MAX_CHARS characters that are not white space (layout.ts's "counts as
 * scanned"): all its words in reading order, joined by spaces, table cells row by row. Null for any other page.
 */
function littleText(page: PageLayout): string | null {
  const words: string[] = [];
  for (const block of page.blocks) {
    if (block.kind === 'text') for (const line of block.lines) for (const word of line.words) words.push(word.text);
    else for (const row of block.table.rows) for (const cell of row) for (const word of cell.words) words.push(word.text);
  }
  const cleaned = words.map((w) => clean(w).trim()).filter((w) => w !== '');
  let chars = 0;
  for (const word of cleaned) {
    chars += Array.from(word.replace(/\s/g, '')).length;
    if (chars >= SCANNED_MAX_CHARS) return null;
  }
  return cleaned.join(' ');
}

/** The box of everything a page shows: its words, its tables, its rules. Null for a page with nothing. */
function contentBox(page: PageLayout): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (a: number, b: number, c: number, d: number) => {
    if (a < x0) x0 = a;
    if (b < y0) y0 = b;
    if (c > x1) x1 = c;
    if (d > y1) y1 = d;
  };
  for (const block of page.blocks) {
    if (block.kind === 'text') {
      for (const line of block.lines) for (const w of line.words) if ((w.turn ?? 0) === 0) take(w.x0, w.y0, w.x1, w.y1);
    } else {
      const grid = block.table.grid;
      if (grid) take(grid.xs[0], grid.ys[0], grid.xs[grid.xs.length - 1], grid.ys[grid.ys.length - 1]);
      for (const row of block.table.rows) for (const cell of row) for (const w of cell.words) take(w.x0, w.y0, w.x1, w.y1);
    }
  }
  for (const rule of page.rules ?? []) take(rule.x0, rule.y, rule.x1, rule.y);
  return Number.isFinite(x0 + y0 + x1 + y1) ? { x0, y0, x1, y1 } : null;
}

/** Room at the right of text set at its own spot, so that a slightly wider font does not wrap it. */
const FRAME_SLACK_PT = 6;
/** A gap this many font sizes wide sets two pieces of a line apart (wordLook.ts). */
const PIECE_GAP_EM = 2;

/** The pieces of a line that stand apart by a wide gap, each as a line of its own. */
function linePieces(line: Line): Line[] {
  const words = [...line.words].sort((a, b) => a.x0 - b.x0);
  const size = line.size > 0 ? line.size : 10;
  const groups: Word[][] = [];
  for (const w of words) {
    const last = groups[groups.length - 1];
    if (last && w.x0 - last[last.length - 1].x1 < PIECE_GAP_EM * size) last.push(w);
    else groups.push([w]);
  }
  return groups.map((list) => ({ y0: line.y0, y1: line.y1, size: line.size, words: list }));
}

/** Two things stand beside each other when they share at least this much of the page's height and lie apart across it. */
const BESIDE_OVERLAP_PT = 3;

/**
 * Whether something else of the page stands beside a drawn table: a line of text or another table that shares
 * part of its height and lies wholly to its left or right. Such a table cannot stand in the flow (what is
 * beside it would come before or after it, and the page would grow).
 */
function standsBeside(page: PageLayout, block: Block & { kind: 'table' }): boolean {
  const grid = block.table.grid;
  if (!grid) return false;
  const x0 = grid.xs[0];
  const x1 = grid.xs[grid.xs.length - 1];
  const y0 = grid.ys[0];
  const y1 = grid.ys[grid.ys.length - 1];
  const beside = (a0: number, a1: number, b0: number, b1: number): boolean => Math.min(b1, y1) - Math.max(b0, y0) >= BESIDE_OVERLAP_PT && (a1 <= x0 + 2 || a0 >= x1 - 2);
  for (const other of page.blocks) {
    if (other === block) continue;
    if (other.kind === 'table') {
      const e = other.table.grid ? { x0: other.table.grid.xs[0], x1: other.table.grid.xs[other.table.grid.xs.length - 1], y0: other.table.grid.ys[0], y1: other.table.grid.ys[other.table.grid.ys.length - 1] } : tableExtent(other.table);
      if (beside(e.x0, e.x1, e.y0, e.y1)) return true;
      // A table read from its text that this one stands inside: a row of it at this table's height whose words all
      // lie left or right of it (a label before the boxes, a note after them).
      if (other.table.source === 'aligned') {
        for (const row of other.table.rows) {
          let r0 = Infinity;
          let r1 = -Infinity;
          let outside = 0;
          let inside = 0;
          for (const cell of row) {
            for (const w of cell.words) {
              if (w.y0 < r0) r0 = w.y0;
              if (w.y1 > r1) r1 = w.y1;
              if (w.x1 <= x0 + 2 || w.x0 >= x1 - 2) outside++;
              else inside++;
            }
          }
          if (outside > 0 && inside === 0 && Math.min(r1, y1) - Math.max(r0, y0) >= BESIDE_OVERLAP_PT) return true;
        }
      }
      continue;
    }
    for (const line of other.lines) {
      if (line.words.length === 0 || line.words.some((w) => (w.turn ?? 0) !== 0)) continue;
      let a0 = Infinity;
      let a1 = -Infinity;
      for (const w of line.words) {
        if (w.x0 < a0) a0 = w.x0;
        if (w.x1 > a1) a1 = w.x1;
      }
      if (beside(a0, a1, line.y0, line.y1)) return true;
    }
  }
  return false;
}

/** The foot of a page: at most this many paragraphs, each of one line, ... */
const FOOT_MAX_PARAS = 3;
/** ... standing after a gap of at least this many points and this many of its own line heights ... */
const FOOT_GAP_PT = 18;
const FOOT_GAP_LINES = 1.5;
/** ... in the last part of the page's height. */
const FOOT_FROM_SHARE = 0.85;

/**
 * Where the foot of the page starts among the looks from `from` on: the first of its last paragraphs (single lines
 * in the flow, not in a column) that stand after a clear gap under everything before them, in the lowest part of the
 * page. -1 when the page ends otherwise.
 */
function footStart(looks: readonly (PartLook | null)[], from: number, sources: ReadonlyMap<number, Para>, pageHeight: number): number {
  for (let k = looks.length - 1; k > from && k >= looks.length - FOOT_MAX_PARAS; k--) {
    const look = looks[k];
    const source = sources.get(k);
    if (!look || !('para' in look) || look.column || look.para.frame || look.para.lines !== 1 || !source) return -1;
    if (source.lines.some((l) => (l.turn ?? 0) !== 0 || l.words.some((w) => (w.turn ?? 0) !== 0))) return -1;
    let above = -Infinity;
    for (let j = from; j < k; j++) {
      const other = looks[j];
      if (other) above = Math.max(above, 'para' in other ? other.para.y1 : other.table.y1);
    }
    if (!Number.isFinite(above)) return -1;
    if (look.para.y0 - above >= Math.max(FOOT_GAP_PT, FOOT_GAP_LINES * look.para.line)) return look.para.y0 >= FOOT_FROM_SHARE * pageHeight ? k : -1;
  }
  return -1;
}

/** A box of text set at its own spot is this much taller than its lines (their print may reach under the last line's box). */
const BOX_UNDER_PT = 3;
/** Room given to a line drawn up or down the page in the box that holds it: along the line (at each end) and across it (on each side). */
const TURNED_ALONG_PT = 6;
const TURNED_ACROSS_PT = 1;

/** Room kept at the right of the text area, so that lines break where they broke on the page. */
const RIGHT_SLACK_PT = 1.5;
/** The most room left under the page's content (Word's own line heights differ a little: a page must not spill over). */
const MAX_BOTTOM_PT = 2;

function* plan(pages: readonly PageLayout[], measure?: TextMeasure): Work<{ parts: DocPart[]; report: WordReport; looks: DocLooks }> {
  const body = yield* bodySize(pages);
  const parts: DocPart[] = [];
  const looks: (PartLook | null)[] = [];
  const setups: PageSetup[] = [];
  const report: WordReport = { pages: pages.length, paragraphs: 0, headings: 0, tables: 0, pagesNoText: 0 };
  // The page being planned: the box its paragraphs stand in, and the column being planned, if any.
  let area = { x0: 0, x1: 0 };
  let column: ColumnLook | undefined;
  const inColumn = <T extends object>(look: T): T & { column?: ColumnLook } => (column ? { ...look, column } : look);
  /** For each look of the page being planned that is a plain paragraph in the flow: the paragraph it was made from. */
  let sources = new Map<number, Para>();
  /** The lines drawn on tables of the page being planned that are written as lines of text. */
  let lostRules: PageRule[] = [];
  /** The lines drawn up or down the page being planned: written after everything else of the page. */
  let turnedLater: Line[] = [];
  const addPara = ({ level, text, lines }: Para, breaks?: ReadonlySet<Word>) => {
    if (!column && !breaks && lines.length > 0) sources.set(looks.length, { level, text, lines });
    const box = column ? (column.index === 0 ? { x0: column.left, x1: column.leftEnd } : { x0: column.rightStart, x1: column.right }) : area;
    const para = lines.length > 0 ? paragraphLook(lines, box, breaks, measure) : null;
    looks.push(para ? inColumn({ para }) : null);
    if (level === 0) {
      parts.push({ kind: 'paragraph', text });
      report.paragraphs++;
    } else {
      parts.push({ kind: 'heading', level, text });
      report.headings++;
    }
  };
  /** A paragraph standing beside a table that is placed on the page: set at its own spot. One line with pieces set apart: each piece at its own. */
  const addFramed = ({ level, text, lines }: Para) => {
    const single = lines.length === 1 && (lines[0].underlines ?? []).length === 0;
    const groups: Line[][] = single ? linePieces(lines[0]).map((piece) => [piece]) : [lines];
    for (const group of groups) {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const line of group) {
        for (const w of line.words) {
          if (w.x0 < x0) x0 = w.x0;
          if (w.x1 > x1) x1 = w.x1;
        }
        for (const [, u1] of line.underlines ?? []) if (u1 > x1) x1 = u1;
      }
      const para = Number.isFinite(x0) ? paragraphLook(group, { x0, x1: x1 + FRAME_SLACK_PT }, undefined, measure) : null;
      if (!para) continue;
      para.frame = { x: x0, y: para.y0, w: x1 - x0 + FRAME_SLACK_PT };
      looks.push({ para });
      const own = groups.length === 1 ? text : group[0].words.map((w) => clean(w.text).trim()).filter((t) => t !== '').join(' ');
      if (level === 0 || groups.length > 1) {
        parts.push({ kind: 'paragraph', text: own });
        report.paragraphs++;
      } else {
        parts.push({ kind: 'heading', level, text: own });
        report.headings++;
      }
    }
  };
  /** A line drawn up (90) or down (270) the page, outside any table: a box of text without lines, anchored where the line stands, its text turned. */
  const addTurned = (line: Line, turn: 90 | 270) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of line.words) {
      if (w.x0 < x0) x0 = w.x0;
      if (w.y0 < y0) y0 = w.y0;
      if (w.x1 > x1) x1 = w.x1;
      if (w.y1 > y1) y1 = w.y1;
    }
    const text = line.words.map((w) => clean(w.text).trim()).filter((t) => t !== '').join(' ');
    if (text === '' || !Number.isFinite(x0 + y0 + x1 + y1)) return;
    // Room along the line, so that a slightly wider font does not wrap it, and a little across it.
    const box = { x0: x0 - TURNED_ACROSS_PT, y0: y0 - TURNED_ALONG_PT, x1: x1 + TURNED_ACROSS_PT, y1: y1 + TURNED_ALONG_PT };
    const para = cellParagraphs({ ...box, lines: [line], turn }, measure)[0];
    if (!para) return;
    para.turned = { ...box, turn };
    parts.push({ kind: 'paragraph', text });
    looks.push({ para });
    report.paragraphs++;
  };
  /**
   * `beside`: something stands beside this drawn table, so it is placed at its own spot. `around`: for a table read
   * from its text, the placed tables that stand inside it: its rows are then lines of text (Word moves a table of
   * the flow under a placed one), those at the height of a placed table set at their own spots.
   */
  const addTable = (table: LayoutTable, beside = false, around: readonly Box[] = []) => {
    const rows = tableRows(table);
    if (!rows.some((row) => row.some((t) => t !== ''))) return;
    // A table when lines bound it or enough of its text lines up; also when the page draws on its rows (a line under
    // each, a shaded heading): the page itself shows it as rows.
    const drawn = table.grid ? table.grid.shaded === true || table.grid.cells.some((c) => c.shade || c.borders.top || c.borders.bottom) : false;
    if (table.source === 'aligned' && !drawn && readsAsText(table)) {
      // Running text whose words happened to line up (a list with bullets, justified lines): paragraphs, not cells.
      const lines = prepare(
        table.rows.flatMap((cells): Line[] => {
          const words = cells.flatMap((c) => c.words).sort((x, y) => x.x0 - y.x0);
          return words.length > 0 ? [{ y0: Math.min(...words.map((w) => w.y0)), y1: Math.max(...words.map((w) => w.y1)), size: words[0].size, words }] : [];
        }),
      );
      for (const para of blockParagraphs(lines, sizeShapes(lines), body)) addPara(para);
      return;
    }
    if (around.length === 0 && (table.source === 'ruled' || alignedEnough(rows) || drawn)) {
      const grid = table.grid ?? null;
      parts.push({ kind: 'table', rows });
      looks.push(grid ? inColumn({ table: beside && !column ? { ...tableLook(grid, measure), float: true as const } : tableLook(grid, measure) }) : null);
      report.tables++;
      return;
    }
    // The lines the page draws on its rows were its grid's: written as lines of text, they are lines of the page again.
    lostRules.push(...(table.drawn?.rules ?? []));
    // Its rows as lines of text. Rows that read on as one paragraph (a number or mark, then text whose next lines
    // start under it) are that paragraph; any other row is one line, each cell's first word starting a piece of its own.
    const rowOf = new Map<Line, number>();
    const asLines: Line[] = [];
    table.rows.forEach((cells, r) => {
      const words = cells.flatMap((c) => c.words).sort((x, y) => x.x0 - y.x0);
      if (words.length === 0 || rows[r].every((t) => t === '')) return;
      const whole: Line = { y0: Math.min(...words.map((w) => w.y0)), y1: Math.max(...words.map((w) => w.y1)), size: words[0].size, words };
      rowOf.set(whole, r);
      asLines.push(whole);
    });
    const prepared = prepare(asLines);
    for (const para of blockParagraphs(prepared, sizeShapes(prepared), 0)) {
      if (para.lines.length > 1) {
        addPara(para);
        continue;
      }
      const r = rowOf.get(para.lines[0]);
      if (r === undefined) continue;
      const breaks = new Set(table.rows[r].flatMap((c) => (c.words.length > 0 ? [[...c.words].sort((x, y) => x.x0 - y.x0)[0]] : [])));
      const line = para.lines[0];
      if (around.some((f) => Math.min(line.y1, f.y1) - Math.max(line.y0, f.y0) >= BESIDE_OVERLAP_PT)) addFramed({ level: 0, text: rows[r].filter((t) => t !== '').join(' '), lines: para.lines });
      else addPara({ level: 0, text: rows[r].filter((t) => t !== '').join('\t'), lines: para.lines }, breaks);
    }
  };
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (i > 0) {
      parts.push({ kind: 'page-break' });
      looks.push(null);
    }
    const box = contentBox(page);
    const pictures = page.pictures ?? [];
    if (page.scan) report.pagesFromScan = (report.pagesFromScan ?? 0) + 1;
    const setup: PageSetup = {
      width: page.width,
      height: page.height,
      left: box ? Math.max(0, box.x0) : 72,
      right: box ? Math.max(0, page.width - box.x1 - RIGHT_SLACK_PT) : 72,
      top: box ? Math.max(0, box.y0) : 72,
      bottom: box ? Math.max(0, Math.min(MAX_BOTTOM_PT, page.height - box.y1 - 4)) : 72,
      pictures,
      // Filled boxes first (they lie under the lines), then the lines across and down the page.
      shapes: [
        ...(page.fills ?? []),
        ...(page.rules ?? []).map((r) => ({ x0: r.x0, y0: r.y - Math.max(0.25, (r.width ?? 0.5) / 2), x1: r.x1, y1: r.y + Math.max(0.25, (r.width ?? 0.5) / 2), color: r.color ?? '000000' })),
        ...(page.uprights ?? []),
      ],
      ...(page.strokes && page.strokes.length > 0 ? { lines: page.strokes } : {}),
    };
    setups.push(setup);
    area = { x0: setup.left, x1: page.width - setup.right };
    const from = looks.length;
    sources = new Map();
    turnedLater = [];
    lostRules = [];
    if (!page.hasText) {
      report.pagesNoText++;
      continue;
    }
    const few = littleText(page);
    if (few !== null) {
      // Under 20 characters (it may be scanned): counted, and its few words kept as one paragraph.
      report.pagesNoText++;
      if (few !== '') addPara({ level: 0, text: few, lines: [] });
      yield;
      continue;
    }
    const prepared = page.blocks.map((block: Block) => {
      if (block.kind !== 'text') return null;
      const lines = prepare(block.lines);
      return { lines, shapes: sizeShapes(lines), extent: linesExtent(lines) };
    });
    const extents = page.blocks.flatMap((block, b) => {
      const extent = block.kind === 'table' ? tableExtent(block.table) : prepared[b]?.extent;
      return extent ? [extent] : [];
    });
    widenRights(prepared.flatMap((p) => (p ? [p] : [])), extents);
    // Two columns of text: where the left one ends and the right one starts, for each run of columns.
    const edges = new Map<number, { leftEnd: number; rightStart: number }>();
    for (const block of page.blocks) {
      if (!block.column) continue;
      const edge = edges.get(block.column.group) ?? { leftEnd: -Infinity, rightStart: Infinity };
      const words = block.kind === 'text' ? block.lines.flatMap((l) => l.words) : block.table.rows.flatMap((row) => row.flatMap((c) => c.words));
      for (const w of words) {
        if (block.column.index === 0) edge.leftEnd = Math.max(edge.leftEnd, w.x1);
        else edge.rightStart = Math.min(edge.rightStart, w.x0);
      }
      edges.set(block.column.group, edge);
    }
    // The drawn tables something stands beside (they are placed on the page by their corners), and where they lie.
    const placed = new Set<Block>();
    const spots: Box[] = [];
    for (const block of page.blocks) {
      if (block.kind !== 'table' || block.table.source !== 'ruled' || block.column || !block.table.grid || !standsBeside(page, block)) continue;
      const g = block.table.grid;
      placed.add(block);
      spots.push({ x0: g.xs[0], y0: g.ys[0], x1: g.xs[g.xs.length - 1], y1: g.ys[g.ys.length - 1] });
    }
    page.blocks.forEach((block, b) => {
      const text = prepared[b];
      const edge = block.column ? edges.get(block.column.group) : undefined;
      column =
        block.column && edge && edge.rightStart - edge.leftEnd > RIGHT_SLACK_PT + 2 && edge.leftEnd > area.x0 && edge.rightStart < area.x1
          ? { group: block.column.group, index: block.column.index, left: area.x0, leftEnd: edge.leftEnd + RIGHT_SLACK_PT, rightStart: edge.rightStart, right: area.x1 }
          : undefined;
      if (block.kind === 'table') {
        const t = block.table;
        const inside = t.source === 'aligned' && !column ? spots.filter((f) => f.y0 < t.y1 && f.y1 > t.y0 && f.x1 > tableExtent(t).x0 && f.x0 < tableExtent(t).x1) : [];
        addTable(t, placed.has(block), inside);
      }
      else if (block.lines.some((l) => l.turn === 90 || l.turn === 270)) {
        // Text drawn up or down the page: each line a cell placed where it stands, its text turned; any other line as before.
        for (const line of block.lines) {
          if (line.turn === 90 || line.turn === 270) turnedLater.push(line);
          else for (const para of blockParagraphs(prepare([line]), sizeShapes(prepare([line])), body)) addPara(para);
        }
      } else if (text) {
        for (const para of blockParagraphs(text.lines, text.shapes, body)) {
          const beside = !column && spots.length > 0 && para.lines.every((l) => l.words.every((w) => (w.turn ?? 0) === 0)) && para.lines.some((l) => spots.some((f) => Math.min(l.y1, f.y1) - Math.max(l.y0, f.y0) >= BESIDE_OVERLAP_PT));
          if (beside) addFramed(para);
          else addPara(para);
        }
      }
    });
    column = undefined;
    for (const r of lostRules) {
      if ((page.rules ?? []).includes(r)) continue;
      const half = Math.max(0.25, (r.width ?? 0.5) / 2);
      setup.shapes.push({ x0: r.x0, y0: r.y - half, x1: r.x1, y1: r.y + half, color: r.color ?? '000000' });
    }
    // The foot of the page (its last lines, after a clear gap, at the bottom): set at its own spot, so that what is
    // above may come out a little taller in Word without pushing it over to a page of its own.
    const foot = footStart(looks, from, sources, page.height);
    if (foot >= 0) {
      const tail: Para[] = [];
      for (let k = foot; k < looks.length; k++) {
        tail.push(sources.get(k)!);
        if (parts[k].kind === 'heading') report.headings--;
        else report.paragraphs--;
      }
      parts.length = foot;
      looks.length = foot;
      for (const para of tail) addFramed(para);
    }
    for (const line of turnedLater) addTurned(line, line.turn === 270 ? 270 : 90);
    // The page starts where its first part's first line box starts (a picture's anchor takes a point before it).
    let top = Infinity;
    for (let k = from; k < looks.length; k++) {
      const look = looks[k];
      if (look && !('para' in look && look.para.turned)) top = Math.min(top, 'para' in look ? look.para.y0 : look.table.y0);
    }
    if (Number.isFinite(top)) setup.top = Math.max(0, top - (pictures.length > 0 || setup.shapes.length > 0 || (setup.lines ?? []).length > 0 ? 1 : 0));
    yield;
  }
  return { parts, report, looks: { looks, pages: setups } };
}

/** The document's parts and their counts, from every page's layout, in one stretch (pure). */
export function planDocument(pages: readonly PageLayout[], measure?: TextMeasure): { parts: DocPart[]; report: WordReport; looks: DocLooks } {
  return runAtOnce(plan(pages, measure));
}

/** The same plan, giving the window turns through `pace` between pages (a long file takes a while). */
export function planDocumentPaced(pages: readonly PageLayout[], pace: Pace, measure?: TextMeasure): Promise<{ parts: DocPart[]; report: WordReport; looks: DocLooks }> {
  return runPaced(plan(pages, measure), pace);
}

// ---- the .docx ------------------------------------------------------------------------------------------

/** The plain default: Calibri 11 pt (in half-points), a little space after each paragraph. */
const FONT = 'Calibri';
const FONT_HALF_POINTS = 22;
const SPACE_AFTER_TWIPS = 120;
/** The text width of an A4 page with the package's 1-inch margins, in twips. */
const TEXT_WIDTH_TWIPS = 9026;
/** The one paragraph of the package's own document, replaced by the body written here. */
const MARKER = 'VERA-BODY-MARKER-7d1c';

const STYLES = {
  default: {
    document: { run: { font: FONT, size: FONT_HALF_POINTS }, paragraph: { spacing: { after: SPACE_AFTER_TWIPS } } },
    // Word's heading styles in the text colour (the package's are blue): 16 and 13 pt, bold, kept with what follows.
    heading1: { run: { size: 32, bold: true }, paragraph: { spacing: { before: 240, after: SPACE_AFTER_TWIPS }, keepNext: true } },
    heading2: { run: { size: 26, bold: true }, paragraph: { spacing: { before: 200, after: SPACE_AFTER_TWIPS }, keepNext: true } },
  },
};

/** The package's document: its styles and page, no title or author, and the marker paragraph where the body goes. */
function packageDocument(): Document {
  return new Document({ creator: '', title: '', description: '', styles: STYLES, sections: [{ children: [new Paragraph(MARKER)] }] });
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Text for an attribute's value: as element text, and both quotes too, so that no value can end its attribute. */
const escapeAttr = (text: string) => escapeXml(text.replace(NOT_IN_XML, '')).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
/** A colour as an attribute takes it: six hex digits, or null for anything else. */
const hexColour = (color: string | null | undefined): string | null => (typeof color === 'string' && /^[0-9A-Fa-f]{6}$/.test(color) ? color : null);

/** One run of text: its stretches, a tab element for each tab. Empty text, an empty paragraph. */
function paragraphXml(text: string, style?: 'Heading1' | 'Heading2'): string {
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const clean = text.replace(NOT_IN_XML, '');
  if (clean === '') return `<w:p>${props}</w:p>`;
  const inner = clean
    .split('\t')
    .map((piece) => (piece === '' ? '' : `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>`))
    .join('<w:tab/>');
  return `<w:p>${props}<w:r>${inner}</w:r></w:p>`;
}

const GRID_LINE = 'w:val="single" w:color="auto" w:sz="4"';
const TABLE_BORDERS = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} ${GRID_LINE}/>`).join('')}</w:tblBorders>`;

/** A table the width of the page, its columns equal, with grid lines; a turn may be given after each row. */
function* tableXml(rows: readonly string[][], push: (xml: string) => void): Work<void> {
  const columns = Math.max(1, ...rows.map((r) => r.length));
  const width = Math.floor(TEXT_WIDTH_TWIPS / columns);
  push(`<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="5000"/>${TABLE_BORDERS}</w:tblPr><w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(columns)}</w:tblGrid>`);
  for (const row of rows) {
    let cells = '';
    for (let c = 0; c < columns; c++) cells += `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${width}"/></w:tcPr>${paragraphXml(row[c] ?? '')}</w:tc>`;
    push(`<w:tr>${cells}</w:tr>`);
    yield;
  }
  push('</w:tbl>');
}

const PAGE_BREAK_XML = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
/** The body is turned into UTF-8 this many characters at a time, so no single step is long. */
const ENCODE_CHARS = 1 << 16;

// ---- the looks, written (T-064 quality round) ---------------------------------------------------------

const twips = (pt: number): number => Math.round(pt * 20);
const emu = (pt: number): number => Math.round(pt * 12700);
/** A paragraph that takes `pt` of height and shows nothing (between two tables, before a table that stands lower). */
const spacerXml = (pt: number, inner = ''): string =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, twips(pt))}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>${inner}</w:pPr></w:p>`;
const borderXml = (side: string, border: Border | null): string =>
  border ? `<w:${side} w:val="single" w:sz="${Math.max(2, Math.min(96, Math.round(border.width * 8)))}" w:space="0" w:color="${hexColour(border.color) ?? 'auto'}"/>` : `<w:${side} w:val="nil"/>`;

function runXml(run: RunLook, plain = false): string {
  let props = '';
  if (run.family) {
    const family = escapeAttr(run.family);
    props += `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>`;
  }
  if (run.bold) props += '<w:b/><w:bCs/>';
  // In a heading style of Word (which is bold) a run the page draws in a plain weight says so: it would come out bold, and wider than measured.
  else if (plain) props += '<w:b w:val="0"/><w:bCs w:val="0"/>';
  if (run.italic) props += '<w:i/><w:iCs/>';
  const colour = hexColour(run.color);
  if (colour) props += `<w:color w:val="${colour}"/>`;
  if (run.scale) props += `<w:w w:val="${run.scale}"/>`;
  if (run.size) props += `<w:sz w:val="${Math.round(run.size * 2)}"/><w:szCs w:val="${Math.round(run.size * 2)}"/>`;
  if (run.underline) props += '<w:u w:val="single"/>';
  if (run.raised) props += `<w:vertAlign w:val="${run.raised === 'super' ? 'superscript' : 'subscript'}"/>`;
  const text = run.br ? '<w:br/>' : run.tab ? '<w:tab/>' : `<w:t xml:space="preserve">${escapeXml(run.text.replace(NOT_IN_XML, ''))}</w:t>`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${text}</w:r>`;
}

/** A paragraph as it looks, `before` points of space above it; `line` overrides its line height. */
function lookParagraphXml(para: ParaLook, before: number, line: number, style?: 'Heading1' | 'Heading2', inner = '', lead = '', trail = ''): string {
  let props = style ? `<w:pStyle w:val="${style}"/>` : '';
  if (para.tabs.length > 0) props += `<w:tabs>${para.tabs.map((at) => `<w:tab w:val="left" w:pos="${twips(at)}"/>`).join('')}</w:tabs>`;
  props += `<w:spacing w:before="${Math.max(0, twips(before))}" w:after="0" w:line="${Math.max(20, twips(line))}" w:lineRule="exact"/>`;
  const first = twips(para.first);
  props += `<w:ind w:left="${twips(para.left)}" w:right="${twips(para.right)}"${first > 0 ? ` w:firstLine="${first}"` : first < 0 ? ` w:hanging="${-first}"` : ''}/>`;
  if (para.align) props += `<w:jc w:val="${para.align}"/>`;
  return `<w:p><w:pPr>${props}${inner}</w:pPr>${lead}${para.runs.map((run) => runXml(run, style !== undefined)).join('')}${trail}</w:p>`;
}

/** Where the flow stands on the page, and how a paragraph is fitted under it: the space above it and its line height. */
interface Flow { at: number }
function place(flow: Flow, para: ParaLook): { before: number; line: number } {
  let before = para.y0 - flow.at;
  let line = para.line;
  if (before < 0) {
    // It starts above where the flow stands: a single line gives up some of its height, down to its print.
    if (para.lines === 1) line = Math.max(0.85 * para.size, line + before);
    before = 0;
  }
  flow.at += before + line * para.lines;
  return { before, line };
}

/** The least height a line is given when its cell has no more room: this many font sizes (its print). */
const LINE_FLOOR_EM = 0.9;

function cellXml(cell: CellLook, width: number): string {
  let props = `<w:tcW w:type="dxa" w:w="${width}"/>`;
  if (cell.colSpan > 1) props += `<w:gridSpan w:val="${cell.colSpan}"/>`;
  if (cell.merge) props += cell.merge === 'start' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
  props += `<w:tcBorders>${borderXml('top', cell.borders.top)}${borderXml('left', cell.borders.left)}${borderXml('bottom', cell.borders.bottom)}${borderXml('right', cell.borders.right)}</w:tcBorders>`;
  const shade = hexColour(cell.shade);
  if (shade) props += `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`;
  if (cell.turn !== 0) props += `<w:textDirection w:val="${cell.turn === 90 ? 'btLr' : 'tbRl'}"/>`;
  let body = '';
  const flow: Flow = { at: cell.y0 };
  const placed = cell.paras.map((para) => ({ para, ...place(flow, para) }));
  // Text standing lower than its cell's bottom line would make the row taller: it is moved up by that much instead.
  // (Word adds the line under the row to the row's height, so the text must end that much higher.)
  const under = cell.borders.bottom ? Math.max(2, Math.min(96, Math.round(cell.borders.bottom.width * 8))) / 8 : 0;
  let over = flow.at - (cell.y1 - under);
  for (const p of placed) {
    if (over <= 0) break;
    const less = Math.min(over, p.before);
    p.before -= less;
    over -= less;
  }
  if (over > 0) {
    // Still taller than the cell (rows standing closer than a line usually takes): the lines give up height, down to
    // their print, so that the row keeps its height and the page its length.
    const spare = placed.map((p) => Math.max(0, p.line - LINE_FLOOR_EM * p.para.size) * p.para.lines);
    const total = spare.reduce((sum, x) => sum + x, 0);
    const share = total > 0 ? Math.min(1, over / total) : 0;
    placed.forEach((p, k) => {
      // Down to the twentieth of a point below, as Word counts.
      if (spare[k] > 0) p.line = Math.max(LINE_FLOOR_EM * p.para.size, Math.floor((p.line - (spare[k] * share) / p.para.lines) * 20) / 20);
    });
  }
  for (const p of placed) body += lookParagraphXml(p.para, p.before, p.line);
  return `<w:tc><w:tcPr>${props}</w:tcPr>${body === '' ? spacerXml(1) : body}</w:tc>`;
}

/** A table as it looks: its place, its columns to the twip, its rows at least as tall as on the page; a turn may be given after each row. */
function* lookTableXml(table: TableLook, left: number, push: (xml: string) => void): Work<void> {
  const edges: number[] = [0];
  let x = 0;
  for (const w of table.widths) edges.push(twips((x += w)));
  const widths = table.widths.map((_, c) => Math.max(1, edges[c + 1] - edges[c]));
  const zero = ['top', 'left', 'bottom', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('');
  // A table something stands beside is placed on the page by its corner; any other stands in the flow, set in from the margin.
  const at = table.float
    ? `<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="${Math.max(1, twips(table.x0))}" w:tblpY="${Math.max(1, twips(table.y0))}"/><w:tblOverlap w:val="overlap"/>`
    : '';
  push(
    `<w:tbl><w:tblPr>${at}<w:tblW w:type="dxa" w:w="${edges[edges.length - 1]}"/>${table.float ? '' : `<w:tblInd w:type="dxa" w:w="${twips(table.x0 - left)}"/>`}<w:tblLayout w:type="fixed"/><w:tblCellMar>${zero}</w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`,
  );
  for (const row of table.rows) {
    let cells = '';
    let c = 0;
    for (const cell of row.cells) {
      cells += cellXml(cell, edges[Math.min(c + cell.colSpan, widths.length)] - edges[c]);
      c += cell.colSpan;
    }
    // Word adds the line under a row to the row's height.
    let under = 0;
    for (const cell of row.cells) if (cell.borders.bottom) under = Math.max(under, Math.max(2, Math.min(96, Math.round(cell.borders.bottom.width * 8))) / 8);
    push(`<w:tr><w:trPr><w:trHeight w:val="${Math.max(20, twips(row.height - under))}" w:hRule="atLeast"/></w:trPr>${cells}</w:tr>`);
    yield;
  }
  push('</w:tbl>');
}

/** A section's end: the page's size and margins; `continuous` when the section started in the middle of a page; its two columns, if it has them. */
const sectionXml = (page: PageSetup, continuous = false, columns?: ColumnLook): string =>
  `<w:sectPr>${continuous ? '<w:type w:val="continuous"/>' : ''}<w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"${page.width > page.height ? ' w:orient="landscape"' : ''}/>` +
  `<w:pgMar w:top="${twips(page.top)}" w:right="${twips(page.right)}" w:bottom="${twips(page.bottom)}" w:left="${twips(page.left)}" w:header="0" w:footer="0" w:gutter="0"/>` +
  (columns
    ? `<w:cols w:num="2" w:equalWidth="0" w:space="0"><w:col w:w="${twips(columns.leftEnd - columns.left)}" w:space="${twips(columns.rightStart - columns.leftEnd)}"/><w:col w:w="${twips(columns.right - columns.rightStart)}"/></w:cols>`
    : '') +
  '</w:sectPr>';
const COLUMN_BREAK_XML = '<w:r><w:br w:type="column"/></w:r>';

/** A picture at its place on the page (behind the text when text lies over it), anchored in the page's first paragraph. */
function pictureXml(picture: Picture, relation: string, id: number): string {
  // On a page read turned the picture is turned with it: its frame before turning is as tall as it is wide after, about the same middle.
  const wide = picture.turn ? picture.y1 - picture.y0 : picture.x1 - picture.x0;
  const tall = picture.turn ? picture.x1 - picture.x0 : picture.y1 - picture.y0;
  const cx = emu(wide);
  const cy = emu(tall);
  const left = (picture.x0 + picture.x1 - wide) / 2;
  const top = (picture.y0 + picture.y1 - tall) / 2;
  const rot = picture.turn ? ` rot="${picture.turn * 60000}"` : '';
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="${picture.behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(left)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(top)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relation}">${picture.alpha !== undefined ? `<a:alphaModFix amt="${Math.round(picture.alpha * 100000)}"/>` : ''}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm${rot}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

/** A filled box at its place on the page, behind the text: a rule, a line down the page, a coloured band. */
function shapeXml(shape: Box & { color: string }, id: number): string {
  const cx = Math.max(1, emu(shape.x1 - shape.x0));
  const cy = Math.max(1, emu(shape.y1 - shape.y0));
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(shape.x0)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(shape.y0)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Shape ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${hexColour(shape.color) ?? '000000'}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

/**
 * Text set at its own spot on the page: a box without line or fill anchored to the page, which takes no room in the
 * flow and pushes nothing (text wraps round nothing of it). With `turn` its text is turned: read from the bottom up
 * (90) or from the top down (270).
 */
function boxedXml(para: ParaLook, at: { x0: number; y0: number; x1: number; y1: number; turn?: 90 | 270 }, id: number, style?: 'Heading1' | 'Heading2'): string {
  const cx = Math.max(1, emu(at.x1 - at.x0));
  const cy = Math.max(1, emu(at.y1 - at.y0));
  const inner = lookParagraphXml({ ...para, left: Math.max(0, para.left), right: Math.max(0, para.right) }, 0, at.turn ? Math.min(para.line, at.x1 - at.x0) : para.line, style, style ? '<w:keepNext w:val="0"/>' : '');
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(at.x0)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(at.y0)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Text ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>` +
    `<wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="${at.turn === 90 ? 'vert270' : at.turn === 270 ? 'vert' : 'horz'}" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

/** A slanted line of the page at its place, behind the text. */
function lineXml(line: Stroke, id: number): string {
  const x0 = Math.min(line.x0, line.x1);
  const y0 = Math.min(line.y0, line.y1);
  const cx = Math.max(1, emu(Math.abs(line.x1 - line.x0)));
  const cy = Math.max(1, emu(Math.abs(line.y1 - line.y0)));
  // The shape runs from its top-left corner to its bottom-right one; a line that rises to the right is that one flipped.
  const flip = (line.x1 - line.x0) * (line.y1 - line.y0) < 0 ? ' flipV="1"' : '';
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(x0)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(y0)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Line ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvCnPr/><wps:spPr><a:xfrm${flip}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
    `<a:ln w="${Math.max(3175, emu(line.width ?? 0.5))}"><a:solidFill><a:srgbClr val="${hexColour(line.color) ?? '000000'}"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

/** What the body writer is given besides the parts: their looks, and for each page the relation of each of its pictures (null: left out). */
interface Written { looks: DocLooks; relations: (string | null)[][] }

/** The body's XML as UTF-8 pieces, written part by part; a turn may be given after each part and each table row. */
function* bodyBytes(parts: readonly DocPart[], written?: Written): Work<{ chunks: Uint8Array[]; lastPage: PageSetup | null; lastMidPage: boolean }> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let pending: string[] = [];
  let pendingChars = 0;
  const flush = () => {
    if (pending.length > 0) chunks.push(encoder.encode(pending.join('')));
    pending = [];
    pendingChars = 0;
  };
  const push = (xml: string) => {
    pending.push(xml);
    pendingChars += xml.length;
    if (pendingChars >= ENCODE_CHARS) flush();
  };
  const pages = written?.looks.pages ?? [];
  let pageIndex = 0;
  let page: PageSetup | null = pages[0] ?? null;
  const flow: Flow = { at: 0 };
  let drawing = 0;
  const startPage = () => {
    if (!page) return;
    flow.at = page.top;
    const relations = written?.relations[pageIndex] ?? [];
    let anchors = '';
    page.pictures.forEach((picture, k) => {
      if (relations[k]) anchors += pictureXml(picture, relations[k]!, ++drawing);
    });
    for (const shape of page.shapes) anchors += shapeXml(shape, ++drawing);
    for (const line of page.lines ?? []) anchors += lineXml(line, ++drawing);
    if (page.pictures.length > 0 || page.shapes.length > 0 || (page.lines ?? []).length > 0) {
      push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${anchors}</w:p>`);
      flow.at += 1;
    }
  };
  startPage();
  let previous: DocPart['kind'] | null = null;
  // Sections inside a page: whether the one being written started in the middle of the page, the columns being
  // written (if any), where they start on the page and how far down they have reached.
  let midPage = false;
  let columns: ColumnLook | undefined;
  let columnsTop = 0;
  let columnsBottom = 0;
  let pendingBreak = false;
  /** Ends the columns being written: their section ends, and the flow goes on under the longer column. */
  const endColumns = () => {
    if (!columns || !page) return;
    push(spacerXml(1, sectionXml(page, midPage, columns)));
    flow.at = Math.max(columnsBottom, flow.at) + 1;
    columns = undefined;
    midPage = true;
    pendingBreak = false;
    previous = null;
  };
  /** Before a part is written: the columns it stands in are opened, changed or ended. Returns what must lead its first paragraph (a column break). */
  const enter = (look: PartLook | null): string => {
    const next = look?.column;
    if (columns && (!next || next.group !== columns.group)) endColumns();
    if (!next || !page) return '';
    if (!columns) {
      // What was written so far on the page is a section of its own, one column wide.
      if (previous !== null || midPage) {
        push(spacerXml(1, sectionXml(page, midPage)));
        flow.at += 1;
      }
      midPage = true;
      columns = next;
      columnsTop = flow.at;
      columnsBottom = flow.at;
      previous = null;
      pendingBreak = next.index === 1;
    } else if (next.index === 1 && columns.index === 0) {
      columnsBottom = Math.max(columnsBottom, flow.at);
      flow.at = columnsTop;
      columns = next;
      pendingBreak = true;
      previous = null;
    }
    if (!pendingBreak) return '';
    pendingBreak = false;
    // The break stands in a thin paragraph of its own, so that the space above the next column's first paragraph stays above it.
    push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>${COLUMN_BREAK_XML}</w:p>`);
    flow.at += 1;
    return '';
  };
  // Text set at its own spot (boxes anchored to the page): the anchors wait for the next paragraph of the flow on
  // their page, and stand in a thin paragraph of their own when the page has none after them.
  let boxesWaiting = '';
  /** A table placed on the page was written since the last paragraph of the flow. */
  let afterPlaced = false;
  const anchorBoxes = () => {
    if (boxesWaiting === '') return;
    push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>${boxesWaiting}</w:p>`);
    flow.at += 1;
    boxesWaiting = '';
    previous = 'paragraph';
  };
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const look = written?.looks.looks[i] ?? null;
    switch (part.kind) {
      case 'heading':
      case 'paragraph': {
        const style = part.kind === 'heading' ? (part.level === 1 ? 'Heading1' : 'Heading2') : undefined;
        if (look && 'para' in look && look.para.turned && page) {
          // Turned text in a box anchored to the page: its anchor waits for the next paragraph of the flow.
          enter(look);
          boxesWaiting += boxedXml(look.para, look.para.turned, ++drawing);
        } else if (look && 'para' in look && look.para.frame && page) {
          // Set at its own spot on the page, in a box anchored there: it takes no room in the flow.
          enter(look);
          const f = look.para.frame;
          boxesWaiting += boxedXml(look.para, { x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + look.para.line * look.para.lines + BOX_UNDER_PT }, ++drawing, style);
        } else if (look && 'para' in look) {
          const lead = enter(look);
          const placedAt = place(flow, look.para);
          let before = placedAt.before;
          // After tables placed on the page the gap above is an empty paragraph of its own: Word breaks a line at the
          // edge of a placed table when the line's own space above lies beside that table.
          if (afterPlaced && before >= 1) {
            push(spacerXml(before));
            before = 0;
          }
          afterPlaced = false;
          push(lookParagraphXml(look.para, before, placedAt.line, style, style ? '<w:keepNext w:val="0"/>' : '', lead, boxesWaiting));
          boxesWaiting = '';
        } else {
          enter(null);
          push(paragraphXml(part.text, style));
        }
        break;
      }
      case 'table':
        if (look && 'table' in look && page) {
          const lead = enter(look);
          if (look.table.float) {
            // Placed by its corner: it takes no room in the flow. A thin paragraph keeps it apart from a table before it.
            if (previous === 'table' || lead !== '') {
              push(spacerXml(1));
              flow.at += 1;
            }
            yield* lookTableXml(look.table, page.left, push);
            afterPlaced = true;
            break;
          }
          const gap = look.table.y0 - flow.at;
          if (previous === 'table' || gap >= 1 || lead !== '') {
            push(lead === '' ? spacerXml(Math.max(1, gap)) : `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, twips(Math.max(1, gap)))}" w:lineRule="exact"/></w:pPr>${lead}</w:p>`);
            flow.at += Math.max(1, gap);
          }
          yield* lookTableXml(look.table, columns ? (columns.index === 0 ? columns.left : columns.rightStart) : page.left, push);
          flow.at += look.table.y1 - look.table.y0;
        } else {
          enter(null);
          // Two tables one after the other would join into one in Word: an empty paragraph keeps them apart.
          if (previous === 'table') push('<w:p/>');
          yield* tableXml(part.rows, push);
        }
        break;
      case 'page-break':
        if (page) {
          anchorBoxes();
          endColumns();
          // The page's own section ends here: its size and margins, and the next page starts.
          push(spacerXml(1, sectionXml(page, midPage)));
          midPage = false;
          page = pages[++pageIndex] ?? page;
          startPage();
        } else push(PAGE_BREAK_XML);
        break;
    }
    previous = part.kind;
    yield;
  }
  anchorBoxes();
  endColumns();
  // The body ends with a paragraph (Word adds one after a last table; an empty document has one).
  if (previous === null || previous === 'table') push(page ? spacerXml(1) : '<w:p/>');
  flush();
  return { chunks, lastPage: page, lastMidPage: midPage };
}

/** The pieces as one array; copying is quick (a few milliseconds for 20 MB). */
function joined(pieces: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(pieces.reduce((n, piece) => n + piece.byteLength, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.byteLength;
  }
  return out;
}

/**
 * The .docx of a plan. The body is written part by part (each row of a table too) with `pace` asked after
 * each: it gives the window a turn and runs the caller's Stop check, which ends the write by throwing. The
 * package writes the rest of the file around a marker paragraph, which is replaced by the body; the zip is
 * then made in slices, the window getting turns between them (jszip).
 *
 * With `looks` (the plan's) every part is written as it looks on the page, each page of the source a section
 * with its own size and margins; `pictures[p][k]` is the file of page p's k-th picture (null: left out).
 * Without them the parts are written plainly, as before.
 */
export async function buildDocx(parts: readonly DocPart[], pace: Pace, looks?: DocLooks, pictures?: readonly (readonly (PictureFile | null)[])[]): Promise<Uint8Array> {
  // Each picture file once, however many pages show it.
  const media = new Map<PictureFile, string>();
  const relations: (string | null)[][] = [];
  if (looks) {
    looks.pages.forEach((page, p) => {
      relations.push(
        page.pictures.map((_, k) => {
          const file = pictures?.[p]?.[k] ?? null;
          if (!file) return null;
          if (!media.has(file)) media.set(file, `rIdPic${media.size + 1}`);
          return media.get(file)!;
        }),
      );
    });
  }
  const { chunks: body, lastPage, lastMidPage } = await runPaced(bodyBytes(parts, looks ? { looks, relations } : undefined), pace);
  const zip = await JSZip.loadAsync(await Packer.pack(packageDocument(), 'uint8array'));
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
  const at = xml.indexOf(MARKER);
  const start = at < 0 ? -1 : xml.lastIndexOf('<w:p>', at);
  const end = at < 0 ? -1 : xml.indexOf('</w:p>', at);
  if (start < 0 || end < 0) throw new Error('The Word writer could not be prepared.');
  const encoder = new TextEncoder();
  let tail = xml.slice(end + '</w:p>'.length);
  if (lastPage) tail = tail.replace(/<w:sectPr>.*<\/w:sectPr>/s, sectionXml(lastPage, lastMidPage));
  zip.file('word/document.xml', joined([encoder.encode(xml.slice(0, start)), ...body, encoder.encode(tail)]));
  if (media.size > 0) {
    const rels = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? '';
    let added = '';
    let n = 0;
    for (const [file, id] of media) {
      const name = `image${++n}.${file.type === 'png' ? 'png' : 'jpeg'}`;
      zip.file(`word/media/${name}`, file.bytes);
      added += `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`;
    }
    if (!rels.includes('</Relationships>')) throw new Error('The Word writer could not be prepared.');
    zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', `${added}</Relationships>`));
  }
  const turn = pace();
  if (turn) await turn;
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
