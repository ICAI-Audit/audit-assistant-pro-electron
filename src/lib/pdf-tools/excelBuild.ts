// PDF to Excel: from page layouts to sheets, and from sheets to an .xlsx workbook (design 5.11 and 13;
// contract decisions 11, 12, 14 and 17; T-064).
//
// THE PLAN (planSheets). Each page's blocks are written in reading order (layout.ts decides them): a
// table, ruled or aligned, as rows of cells; text as one line per row in column A. So the fallbacks of
// design 13 hold page by page: a ruled table, else an aligned grid, else the page's text in column A from
// A1. Nothing is dropped: repeated heading rows, page headers and footers are all kept. Empty cells at the
// end of a row are trimmed (design 13). A table cell is a number only when the whole cell parses
// (excelNumbers.ts); a line of text is never a number.
// - "All pages on one sheet" (the default): the pages follow each other on one sheet.
// - "One sheet per page": one sheet a page, `Page_n`; a page with no word is an empty sheet.
// - Carrying a table on (lead's rulings, 17 Nov, rounds 1 and 2; both modes, so a statement has the same
//   columns on every sheet too). The tables met so far are references (the newest first). A table read
//   from how its text lines up is ALWAYS first placed again in a reference's columns (layout.ts
//   gridFromLines, which matches a right-aligned column by its right edge), whatever number of columns the
//   page itself showed: a page whose long amounts closed the gap between two amount columns (fewer
//   columns), or whose narrations happened to line up (more columns), still gives the reference's columns.
//   The re-grid is kept only when it is consistent (`consistent` below); else, and for a ruled table of
//   another column count, the table is a new one from its own columns: after one blank row on one sheet,
//   and it becomes the newest reference. A ruled table with a reference's column count carries on as it
//   is (its columns are drawn). A table that carries on never moves a reference.
// - A page with little or no text (under 20 characters, layout.ts countsAsScanned) is counted
//   (`pagesNoText`), and whatever words it holds are still written: no word is ever dropped.
// - A second line of a narration in a table read from how its text lines up arrives as a row of its own,
//   the other cells empty: it stays a row of its own; it is never joined to the amounts' row.
// - Limits: a row holds at most 80 cells (what lies beyond is joined, as text, into the 80th); one sheet
//   holds at most 1,048,576 rows, refused in plain words (before any row is built when the rows alone are
//   too many, else as soon as the sheet passes it); a cell holds at most 32,767 characters (Excel's limit).
// - No import of pace.ts here (only its types): the write worker loads this file, and pace.ts brings pdf-lib.
// - Columns are sized to their table cells, not to the long lines of text above a table.
//
// HOW THE SHEET LOOKS (T-064, the quality round). A table drawn with lines is written from its true cells
// (layout.ts Table.grid): a cell lying over several columns or rows of the grid is a merged range; its
// columns are as wide and its rows as tall as on the page, in proportion; each cell keeps bold, italic,
// underline, colour, font and size, its shading, the lines drawn on its sides, how its text sits in it
// (left, centre, right; top, middle, bottom), wrapping for a cell of several lines, and turned text. Cells
// of other tables and lines of text keep bold, italic, underline and colour. A number is still a number only
// when the whole cell parses, and is right-aligned by Excel itself.
//
// THE WORKBOOK (buildWorkbook). exceljs, loaded when first needed (the dialog's preview does not need it).
// Numbers are number cells with the format of numberFormat; text is a text cell with the Text format ("@"),
// so Excel never reads a date, a leading zero or a long number into something else, even when the cell is
// edited. The workbook says "ICAI VERA" as its creator; it has no title and no person's name.
import { countsAsScanned, gridFromLines, largestGroup, lineText, type Block, type Border, type Grid, type GridCell, type Line, type PageLayout, type Picture, type Table, type Word } from './layout';
import { numberFormat, parseAmount, type ParsedNumber } from './excelNumbers';
import type { Pace, Work } from './pace';
import type { PictureFile } from './pdfPictures';
import { PdfToolsError } from './types';

/** pace.ts's runAtOnce and runPaced, here so that the write worker does not load pace.ts (and pdf-lib). */
function runAtOnce<T>(work: Work<T>): T {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}
async function runPaced<T>(work: Work<T>, pace: Pace): Promise<T> {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
    const turn = pace();
    if (turn) await turn;
  }
}

export type SheetMode = 'one-sheet' | 'per-page';
/** How a cell looks, where it is not Excel's plain cell. Colours are RRGGBB; `size` is in points. */
export interface CellStyle {
  bold?: true;
  italic?: true;
  underline?: true;
  color?: string;
  fill?: string;
  family?: string;
  size?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  wrap?: true;
  /** Text turned to read bottom to top (90) or top to bottom (270). */
  turn?: 90 | 270;
  /** How deep a caption is set in from its column's left edge, in Excel's indent steps. */
  indent?: number;
  borders?: { top?: Border; right?: Border; bottom?: Border; left?: Border };
}
export type CellPlan = ({ text: string } | { number: ParsedNumber }) & { look?: CellStyle };
export interface SheetPlan {
  name: string;
  rows: CellPlan[][];
  columnWidths: number[];
  /** Merged ranges as [first row, first column, last row, last column], from 0. */
  merges?: number[][];
  /** Row heights in points, by row index from 0 (rows of tables drawn with lines). */
  rowHeights?: Record<number, number>;
  /** The pictures standing on the sheet. */
  pictures?: SheetPicture[];
}
/** A picture on a sheet: the cell its top-left corner stands in (from 0, with the share of the cell before it), and its size in pixels. */
export interface SheetPicture { file: PictureFile; col: number; row: number; width: number; height: number }
export interface ExcelReport {
  pages: number; sheets: number; tablesRuled: number; tablesAligned: number; pagesAsText: number; pagesNoText: number; rows: number; numberCells: number;
  /** Pages that are scans with recognised text (layout.ts `scan`): their words were typed and the scan picture left out. Absent when there is none. */
  pagesFromScan?: number;
}

/** Excel's limits (contract decision 17). */
export const EXCEL_MAX_ROWS = 1_048_576;
export const EXCEL_MAX_COLUMNS = 80;
export const EXCEL_MAX_CELL_CHARS = 32_767;
export const ONE_SHEET_NAME = 'All pages';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MIN_WIDTH = 6;
const MAX_WIDTH = 60;
const MAX_TEXT_WIDTH = 100;
const DEFAULT_WIDTH = 10;
/** The height of a row Excel gives no height to, in points. */
const DEFAULT_ROW_PT = 15;
/** A picture is never made smaller than this share of its size on the page. */
const MIN_PICTURE_SCALE = 0.25;
/** At most this many pictures are placed for one page. */
const MAX_PAGE_PICTURES = 64;
/** Cells planned or written between two questions to the pace. */
const CELLS_PER_STEP = 200;

export const tooManyRowsMessage = () =>
  'This file gives more rows than one Excel sheet can hold (1,048,576). Choose "One sheet per page" and try again. Nothing was added.';

// ---- sheet names ---------------------------------------------------------------------------------------

/** A name Excel accepts (at most 31 characters, none of []:*?/\, no apostrophe at either end, not "History"), unique in `used` whatever the letter case. */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').trim();
  if (base === '') base = 'Sheet';
  if (base.toLowerCase() === 'history') base = 'History_';
  base = Array.from(base).slice(0, 31).join('');
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const tail = ` (${n})`;
    candidate = Array.from(base).slice(0, 31 - tail.length).join('') + tail;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// ---- the plan ------------------------------------------------------------------------------------------

/** How far a word may stand outside its column's edges and still be in it (layout.ts COLUMN_WIDEN_PT). */
export const COLUMN_EDGE_PT = 6;
/** References kept: the tables met most recently (a page's small header table must not end the statement's). */
const MAX_REFERENCES = 8;

/** A table later tables may carry on: its columns, which of them hold amounts, and its heading row. */
interface Reference {
  columns: number[];
  /** A column holds amounts when its cells below the first row are amounts at least as often as text (an empty column may). */
  amounts: boolean[];
  /** The first row's cell texts. */
  heading: string[];
}

function referenceOf(table: Table): Reference {
  const n = table.columns.length;
  const amounts = new Array<number>(n).fill(0);
  const texts = new Array<number>(n).fill(0);
  for (const row of table.rows.slice(1)) {
    row.forEach((cell, c) => {
      const text = cell.text.trim();
      if (text === '') return;
      if (parseAmount(text)) amounts[c]++;
      else texts[c]++;
    });
  }
  return { columns: [...table.columns], amounts: amounts.map((a, c) => a >= texts[c]), heading: (table.rows[0] ?? []).map((cell) => cell.text.trim()) };
}

const wordCount = (table: Table) => table.rows.reduce((n, row) => n + row.reduce((m, cell) => m + cell.words.length, 0), 0);
/** How many cells of a table are amounts (the whole cell parses). */
const amountCount = (table: Table) => table.rows.reduce((n, row) => n + row.reduce((m, cell) => m + (cell.words.length > 0 && parseAmount(cell.text.trim()) ? 1 : 0), 0), 0);

/**
 * Whether a table re-gridded in a reference's columns is consistent (lead's ruling, round 2):
 * - every word of the page is still there, in exactly the reference's columns;
 * - an amount cell (the whole cell parses, excelNumbers.ts) is in a column that holds amounts in the
 *   reference, and ends (its right edge) inside that column: after its left edge, and before the next
 *   column's left edge, give or take COLUMN_EDGE_PT. Its left edge may lie further left: a right-aligned
 *   amount longer than any on the reference's page starts earlier;
 * - every word of any other cell lies inside its column: from the column's left edge to the next column's
 *   left edge, give or take COLUMN_EDGE_PT (so no word is cut across a column boundary);
 * - a row that repeats the reference's heading (the same texts in the same order) has them in the same columns;
 * - no amount is lost: the table has as many amount cells in the reference's columns as in its own (two amounts
 *   that fall into one column of an unrelated table above would be joined into one text).
 */
function consistent(placed: Table, reference: Reference, words: number, amounts: number): boolean {
  const { columns } = reference;
  if (placed.columns.length !== columns.length || wordCount(placed) !== words || amountCount(placed) < amounts) return false;
  const heading = reference.heading.filter((t) => t !== '');
  for (const row of placed.rows) {
    if (row.length !== columns.length) return false;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell.words.length === 0) continue;
      const left = columns[c] - COLUMN_EDGE_PT;
      const right = c + 1 < columns.length ? columns[c + 1] + COLUMN_EDGE_PT : Number.POSITIVE_INFINITY;
      if (parseAmount(cell.text.trim())) {
        const end = Math.max(...cell.words.map((w) => w.x1));
        if (!reference.amounts[c] || end <= left || end > right) return false;
      } else if (cell.words.some((w) => w.x0 < left || w.x1 > right)) return false;
    }
    const texts = row.map((cell) => cell.text.trim());
    const shown = texts.filter((t) => t !== '');
    if (heading.length > 0 && shown.length === heading.length && shown.every((t, i) => t === heading[i]) && texts.some((t, i) => t !== (reference.heading[i] ?? ''))) return false;
  }
  return true;
}

/**
 * A table read from how its text lines up, placed again in a reference's columns, or null when that is not
 * consistent. Its rows are its lines (one row per line of text, layout.ts), so each row's words make one
 * line again.
 */
function regrid(table: Table, reference: Reference): Table | null {
  const lines: Line[] = [];
  for (const row of table.rows) {
    const words = row.flatMap((cell) => cell.words).sort((a, b) => a.x0 - b.x0);
    if (words.length === 0) continue;
    lines.push({ y0: Math.min(...words.map((w) => w.y0)), y1: Math.max(...words.map((w) => w.y1)), size: words[0].size, words });
  }
  try {
    const placed = gridFromLines(lines, reference.columns);
    return consistent(placed, reference, wordCount(table), amountCount(table)) ? { ...placed, source: 'aligned', ...(table.drawn ? { drawn: table.drawn } : {}) } : null;
  } catch {
    return null;
  }
}

/** A gap wider than this many font sizes ends a run of words on a line (layout.ts cuts cells the same way). */
const RUN_GAP_EM = 0.6;
const CURRENCY_WORD = /^(₹|rs\.?|inr)$/i;
const SUFFIX_WORD = /^(dr|cr)$/i;

/**
 * The second try when gridFromLines keeps a column the page alone showed (two amount columns run together
 * when long amounts close the gap between them): each line's words are placed in the reference's columns
 * one run at a time. An amount (a word that is an amount by itself, with a currency word just before it or
 * Dr/Cr just after) is a run of its own and goes to the column its right edge ends in; any other run of
 * words (cut at a gap wider than 0.6 of the font size) goes to the column its left edge starts in. Runs that
 * meet in one column are joined with a space (an amount joined so no longer parses, and is refused by
 * `consistent`). Judged by `consistent`, as the re-grid is.
 */
function placeWords(table: Table, reference: Reference): Table | null {
  const { columns } = reference;
  const columnEnding = (x1: number) => {
    for (let c = columns.length - 1; c >= 0; c--) if (x1 > columns[c]) return c;
    return 0;
  };
  const columnStarting = (x0: number) => {
    for (let c = columns.length - 1; c >= 0; c--) if (x0 >= columns[c] - COLUMN_EDGE_PT) return c;
    return 0;
  };
  const rows = [];
  for (const row of table.rows) {
    const words = row.flatMap((cell) => cell.words).sort((a, b) => a.x0 - b.x0);
    if (words.length === 0) continue;
    const runs: { words: Word[]; amount: boolean }[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (parseAmount(w.text)) {
        const run = [w];
        const before = runs[runs.length - 1];
        if (before && !before.amount && CURRENCY_WORD.test(before.words[before.words.length - 1].text)) run.unshift(before.words.pop()!);
        if (before && before.words.length === 0) runs.pop();
        if (i + 1 < words.length && SUFFIX_WORD.test(words[i + 1].text)) run.push(words[++i]);
        runs.push({ words: run, amount: true });
        continue;
      }
      const last = runs[runs.length - 1];
      const prev = last?.words[last.words.length - 1];
      if (last && !last.amount && prev && w.x0 - prev.x1 <= RUN_GAP_EM * (w.size || prev.size || 9)) last.words.push(w);
      else runs.push({ words: [w], amount: false });
    }
    const cells: Word[][] = columns.map(() => []);
    for (const run of runs) {
      const c = run.amount ? columnEnding(Math.max(...run.words.map((w) => w.x1))) : columnStarting(run.words[0].x0);
      cells[c].push(...run.words);
    }
    rows.push(cells.map((ws) => ({ text: ws.map((w, i) => (i === 0 || w.glued ? '' : ' ') + w.text).join(''), words: ws })));
  }
  const placed: Table = { source: 'aligned', y0: table.y0, y1: table.y1, columns: [...columns], rows, ...(table.drawn ? { drawn: table.drawn } : {}) };
  return consistent(placed, reference, wordCount(table), amountCount(table)) ? placed : null;
}

/**
 * The table as it goes on the sheet: carried on in a reference's columns (newest reference first), or a
 * new table from its own columns (`carried` false). An aligned table tries gridFromLines first, then the
 * word-by-word placement; a ruled table carries on with a reference of its column count.
 */
function placeTable(table: Table, references: Reference[]): { table: Table; carried: boolean } {
  for (const reference of references) {
    if (table.source === 'aligned') {
      const placed = regrid(table, reference) ?? placeWords(table, reference);
      if (placed) return { table: placed, carried: true };
    } else if (table.columns.length === reference.columns.length) return { table, carried: true };
  }
  references.unshift(referenceOf(table));
  if (references.length > MAX_REFERENCES) references.pop();
  return { table, carried: false };
}

/** Every word a page's blocks hold (each word is in exactly one block, layout.ts). */
function wordsOf(page: PageLayout): Word[] {
  const words: Word[] = [];
  for (const block of page.blocks) {
    if (block.kind === 'text') for (const line of block.lines) words.push(...line.words);
    else for (const row of block.table.rows) for (const cell of row) words.push(...cell.words);
  }
  return words;
}

/** A line's words as its text (layout.ts wordsText: right to left when most are of such a script). */
const wordsLine = (words: readonly Word[]): string => lineText({ y0: 0, y1: 0, size: 0, words: [...words] }).trim();

const fitCell = (text: string) => (text.length > EXCEL_MAX_CELL_CHARS ? text.slice(0, EXCEL_MAX_CELL_CHARS) : text);

/** A table row's cell texts, capped at 80 (the rest joined into the 80th) and trimmed of empty cells at its end. */
function rowTexts(cells: readonly { text: string }[]): string[] {
  let texts = cells.map((c) => c.text.trim());
  if (texts.length > EXCEL_MAX_COLUMNS) {
    const rest = texts.slice(EXCEL_MAX_COLUMNS - 1).filter((t) => t !== '');
    texts = [...texts.slice(0, EXCEL_MAX_COLUMNS - 1), rest.join(' ')];
  }
  let end = texts.length;
  while (end > 0 && texts[end - 1] === '') end--;
  return texts.slice(0, end);
}

/** How words are set, as far as a cell shows it: what most of their letters are. Undefined for plain words. */
function wordsStyle(words: readonly Word[], whole: boolean, sized = whole): CellStyle | undefined {
  let chars = 0;
  let bold = 0;
  let italic = 0;
  let under = 0;
  const colors = new Map<string, number>();
  const families = new Map<string, number>();
  const sizes = new Map<number, number>();
  for (const w of words) {
    const n = w.text.length;
    chars += n;
    if (w.bold) bold += n;
    if (w.italic) italic += n;
    if (w.underline) under += n;
    if (w.color) colors.set(w.color, (colors.get(w.color) ?? 0) + n);
    if (whole && w.family) families.set(w.family, (families.get(w.family) ?? 0) + n);
    if (whole && w.size > 0) sizes.set(Math.round(w.size * 2) / 2, (sizes.get(Math.round(w.size * 2) / 2) ?? 0) + n);
  }
  if (chars === 0) return undefined;
  const most = <K,>(map: Map<K, number>): K | undefined => {
    let best: K | undefined;
    let top = 0;
    for (const [k, n] of map) if (n > top) [best, top] = [k, n];
    return top * 2 > chars ? best : undefined;
  };
  const look: CellStyle = {};
  if (bold * 2 > chars) look.bold = true;
  if (italic * 2 > chars) look.italic = true;
  if (under * 2 > chars) look.underline = true;
  const color = most(colors);
  if (color && color !== '000000') look.color = color;
  const family = most(families);
  if (family) look.family = family;
  const size = most(sizes);
  // Outside a drawn table the size goes with a known font only (a size alone would not make the cell look as the page does).
  if (size && (sized || family)) look.size = size;
  return Object.keys(look).length > 0 ? look : undefined;
}

/**
 * A drawn cell's text for the sheet: its lines top to bottom. A line the next one runs on from (it reaches the
 * cell's right edge: the next line's first word would not have fitted) is joined to it by a space; any other line
 * ends with a line break, as on the page.
 */
function cellLines(cell: GridCell): string {
  const lines = cell.lines.filter((l) => l.words.length > 0);
  if (lines.length < 2 || cell.turn !== 0 || lines.some((l) => l.turn !== undefined)) return cell.text.trim();
  let out = '';
  lines.forEach((line, i) => {
    const text = lineText(line).trim();
    if (i === 0) {
      out = text;
      return;
    }
    const prev = lines[i - 1];
    const end = Math.max(...prev.words.map((w) => w.x1));
    const first = [...line.words].sort((a, b) => a.x0 - b.x0)[0];
    const fits = cell.x1 - end >= first.x1 - first.x0 + 0.5 * (line.size || 10) + 2;
    out += (fits ? '\n' : ' ') + text;
  });
  return out;
}

/** How a grid cell's text sits in it, across and down; nothing for the plain place (left, or right for a number). */
function sitting(cell: GridCell, isNumber: boolean): Pick<CellStyle, 'align' | 'valign'> {
  const out: Pick<CellStyle, 'align' | 'valign'> = {};
  const upright = cell.words.filter((w) => (w.turn ?? 0) === 0);
  if (cell.turn !== 0 || upright.length === 0) {
    if (cell.turn !== 0) {
      out.align = 'center';
      out.valign = 'middle';
    }
    return out;
  }
  const x0 = Math.min(...upright.map((w) => w.x0));
  const x1 = Math.max(...upright.map((w) => w.x1));
  const y0 = Math.min(...upright.map((w) => w.y0));
  const y1 = Math.max(...upright.map((w) => w.y1));
  const dl = x0 - cell.x0;
  const dr = cell.x1 - x1;
  const wide = cell.x1 - cell.x0;
  if (dl > 2 && Math.abs(dl - dr) <= Math.max(1.5, 0.03 * wide)) out.align = 'center';
  else if (dr < dl && dl > 4 && dr <= (isNumber ? 0.5 * dl : dl / 3)) {
    if (!isNumber) out.align = 'right';
  } else if (isNumber) out.align = 'left';
  const dt = y0 - cell.y0;
  const db = cell.y1 - y1;
  out.valign = Math.abs(dt - db) <= Math.max(2, 0.15 * (cell.y1 - cell.y0)) ? 'middle' : dt < db ? 'top' : 'bottom';
  return out;
}

// ---- how a table read from its text looks (T-064, quality round 2) --------------------------------------
//
// A table shown only by how its text lines up has no drawn cells, so what the page shows of it is read from
// where its words stand and from what is drawn on its rows (layout.ts Table.drawn): a filled box lying on a
// row is the fill of that row's cells; a line across the page just under a row is the bottom border of the
// cells it lies under (two lines close together, a double border), one above the first row its top border;
// a caption set in from its column's left edge keeps its depth as the cell indent; text that ends where the
// column's amounts end is set right; and a heading whose text lies over several columns, centred on them, is
// merged across them. Which cell is a number is decided before any of this and is not changed by it.

/** One step of Excel's cell indent, in points on the page (three spaces of the default font). */
const INDENT_PT = 7;
const MAX_INDENT = 8;
/** Two edges this near are one edge. */
const SAME_EDGE_PT = 1.5;
/** Two lines across a row's edge at most this far apart are a double line. */
const DOUBLE_RULE_PT = 4.5;
/** A text overlapping this share of a neighbouring column's width lies over that column too. */
const OVER_SHARE = 0.3;

interface Extent { x0: number; x1: number; y0: number; y1: number }
function extentOf(words: readonly Word[]): Extent | null {
  if (words.length === 0) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const w of words) {
    if (w.x0 < x0) x0 = w.x0;
    if (w.x1 > x1) x1 = w.x1;
    if (w.y0 < y0) y0 = w.y0;
    if (w.y1 > y1) y1 = w.y1;
  }
  return { x0, x1, y0, y1 };
}

interface RowCell { text: string; words: Word[] }
interface AlignedLooks {
  /** The rows as they go on the sheet (a heading lying over several columns stands in the first of them). */
  rows: RowCell[][];
  looks: (CellStyle | undefined)[][];
  /** [row, first column, last column] of each merged heading. */
  merges: [number, number, number][];
  /** Each row's place down the page, or null for a row with no word. */
  ys: ([number, number] | null)[];
  /** Each column's width on the page, in points. */
  widths: number[];
  /** Per row and column: the cell's text runs on past its column (over empty cells), so it says nothing of the column's width. */
  runsOn: boolean[][];
}

/** Lines of a table whose baselines are nearer than this many font sizes stand side by side: one row (layout.ts reads its grid the same way). */
const SAME_ROW_EM = 0.75;
/** ... but further apart than this (words on one baseline are one line already). */
const SAME_LINE_PT = 0.5;

/**
 * The rows of a table read from its text as they go on the sheet: lines that stand side by side (a heading of one
 * line at the middle height of a heading of two lines) are one row, a cell that so holds several lines has them one
 * under the other. `tall[r][c]` says which cells do.
 */
function sideBySide(table: Table, C: number): { rows: RowCell[][]; tall: boolean[][] } {
  const rows: RowCell[][] = [];
  const tall: boolean[][] = [];
  // The row being built: the baseline and size of its last line, how many lines it holds, and which cells its first
  // and its second line filled.
  let lastBase = -Infinity;
  let lastSize = 0;
  let held = 0;
  let firstCells = new Set<number>();
  let secondCells = new Set<number>();
  for (const source of table.rows) {
    const row: RowCell[] = Array.from({ length: Math.max(C, source.length) }, (_, c) => source[c] ?? { text: '', words: [] });
    let base = -Infinity;
    let size = 0;
    const filled = new Set<number>();
    row.forEach((cell, c) => {
      if (cell.words.length > 0) filled.add(c);
      for (const w of cell.words) {
        const b = w.y1 - 0.217 * Math.max(w.y1 - w.y0, 0.1);
        if (b > base) base = b;
        if (size === 0) size = w.size > 0 ? w.size : Math.max(w.y1 - w.y0, 0.1);
      }
    });
    const last = rows[rows.length - 1];
    const close = last !== undefined && Number.isFinite(base) && Number.isFinite(lastBase) && base - lastBase > SAME_LINE_PT && base - lastBase < SAME_ROW_EM * Math.min(size, lastSize);
    // A row is at most three lines: a line, a line beside it (in other cells), and a line that carries the first
    // one's cells on (the second line of a heading or caption). Two amounts never share a cell.
    let joins = false;
    if (close && last) {
      const isAmount = (cell: RowCell | undefined) => cell !== undefined && cell.words.length > 0 && parseAmount(cell.text.trim()) !== null;
      if (held === 1) joins = [...filled].every((c) => !firstCells.has(c));
      else if (held === 2) joins = [...filled].every((c) => firstCells.has(c) && !secondCells.has(c) && !(isAmount(last[c]) && isAmount(row[c])));
    }
    if (joins && last) {
      const marks = tall[tall.length - 1];
      row.forEach((cell, c) => {
        if (cell.words.length === 0) return;
        const before = last[c] ?? { text: '', words: [] };
        if (before.words.length > 0) marks[c] = true;
        last[c] = before.words.length > 0 ? { text: `${before.text.trim()}\n${cell.text.trim()}`, words: [...before.words, ...cell.words] } : cell;
      });
      if (held === 1) secondCells = filled;
      held++;
      lastBase = base;
      lastSize = size;
      continue;
    }
    rows.push(row);
    tall.push(row.map(() => false));
    held = 1;
    firstCells = filled;
    secondCells = new Set();
    if (Number.isFinite(base)) {
      lastBase = base;
      lastSize = size;
    } else lastBase = -Infinity;
  }
  return { rows, tall };
}

function alignedLooks(table: Table): AlignedLooks {
  const C = table.columns.length;
  const { rows, tall } = sideBySide(table, C);
  const boxes = rows.map((row) => row.map((cell) => extentOf(cell.words)));
  const numbers = rows.map((row) => row.map((cell) => cell.words.length > 0 && parseAmount(cell.text.trim()) !== null));
  // Each column as its own cells show it: those that do not reach into the next column.
  const ext: { x0: number; x1: number }[] = [];
  const leftAt: { count: number; at: number }[] = [];
  const rightAt: { count: number; at: number }[] = [];
  const midAt: { count: number; at: number }[] = [];
  const headMid: (number | null)[] = [];
  const ownLefts: number[][] = [];
  const ownRights: number[][] = [];
  const sharing = (values: readonly number[], x: number): number => {
    let n = 0;
    for (const v of values) if (Math.abs(v - x) <= SAME_EDGE_PT) n++;
    return n;
  };
  for (let c = 0; c < C; c++) {
    const next = c + 1 < C ? table.columns[c + 1] : Infinity;
    const own: Extent[] = [];
    let head: number | null = null;
    rows.forEach((_, r) => {
      const b = boxes[r][c];
      if (!b || b.x1 > next + SAME_EDGE_PT || b.x0 < table.columns[c] - 4 * COLUMN_EDGE_PT) return;
      own.push(b);
      if (head === null && !numbers[r][c]) head = (b.x0 + b.x1) / 2;
    });
    headMid.push(head);
    ext.push(own.length > 0 ? { x0: Math.min(...own.map((b) => b.x0)), x1: Math.max(...own.map((b) => b.x1)) } : { x0: table.columns[c], x1: table.columns[c] });
    ownLefts.push(own.map((b) => b.x0));
    ownRights.push(own.map((b) => b.x1));
    leftAt.push(largestGroup(own.map((b) => b.x0)));
    rightAt.push(largestGroup(own.map((b) => b.x1)));
    midAt.push(largestGroup(own.map((b) => (b.x0 + b.x1) / 2)));
  }
  const looks: (CellStyle | undefined)[][] = rows.map(() => new Array<CellStyle | undefined>(C).fill(undefined));
  const merges: [number, number, number][] = [];
  const set = (r: number, c: number, more: CellStyle) => {
    looks[r][c] = { ...(looks[r][c] ?? {}), ...more };
  };
  // A cell holding several lines shows them one under the other.
  tall.forEach((marks, r) => marks.forEach((yes, c) => {
    if (yes && c < C) set(r, c, { wrap: true });
  }));
  const spanOf = new Map<number, [number, number]>();
  rows.forEach((row, r) => {
    for (let c = 0; c < C; c++) {
      const b = boxes[r][c];
      if (!b) continue;
      const atLeft = leftAt[c].count >= 2 && Math.abs(b.x0 - leftAt[c].at) <= SAME_EDGE_PT;
      const atRight = rightAt[c].count >= 2 && Math.abs(b.x1 - rightAt[c].at) <= SAME_EDGE_PT;
      const atMid = midAt[c].count >= 2 && Math.abs((b.x0 + b.x1) / 2 - midAt[c].at) <= SAME_EDGE_PT;
      if (numbers[r][c]) {
        // Excel sets a number right; one the page sets under its heading's middle or at the left edge keeps that place.
        if (atLeft && atRight) {
          if (headMid[c] !== null && Math.abs((b.x0 + b.x1) / 2 - headMid[c]!) <= 2) set(r, c, { align: 'center' });
        } else if (atLeft && !atRight) set(r, c, { align: 'left' });
        else if (atMid && !atRight && midAt[c].count > rightAt[c].count) set(r, c, { align: 'center' });
        continue;
      }
      // A heading lying over the columns beside it (they are empty on its row), centred on them.
      let first = c;
      let last = c;
      const reaches = (k: number, edge: number, fromLeft: boolean): boolean => {
        const w = ext[k].x1 - ext[k].x0;
        return fromLeft ? edge > ext[k].x0 + OVER_SHARE * w + (w > 0 ? 0 : 0.5) : edge < ext[k].x1 - OVER_SHARE * w - (w > 0 ? 0 : 0.5);
      };
      while (last + 1 < C && row[last + 1].words.length === 0 && reaches(last + 1, b.x1, true)) last++;
      while (first > 0 && row[first - 1].words.length === 0 && reaches(first - 1, b.x0, false)) first--;
      if (last > first) {
        const u0 = Math.min(ext[first].x0, b.x0);
        const u1 = Math.max(ext[last].x1, b.x1);
        const centred = Math.abs((b.x0 + b.x1) / 2 - (ext[first].x0 + ext[last].x1) / 2) <= Math.max(3, 0.08 * (u1 - u0)) && b.x0 - ext[first].x0 > 2;
        if (centred) {
          if (first !== c) {
            row[first] = row[c];
            row[c] = { text: '', words: [] };
          }
          merges.push([r, first, last]);
          spanOf.set(r * C + first, [first, last]);
          set(r, first, { align: 'center' });
          c = last;
          continue;
        }
      }
      const wide = ext[c].x1 - ext[c].x0;
      // Set right when more cells of the column end where it ends than start where it starts (two equal words set in
      // to one depth end at one place by chance: they are not set right).
      const endsWith = sharing(ownRights[c], b.x1);
      if (endsWith >= 2 && endsWith > sharing(ownLefts[c], b.x0) && !atLeft) set(r, c, { align: 'right' });
      else if (atMid && !atLeft && midAt[c].count > leftAt[c].count && b.x0 - ext[c].x0 > 2 && wide > 0) set(r, c, { align: 'center' });
      else if (leftAt[c].count >= 2 && b.x1 <= (c + 1 < C ? table.columns[c + 1] : Infinity) + SAME_EDGE_PT) {
        const depth = Math.round((b.x0 - ext[c].x0) / INDENT_PT);
        if (depth >= 1 && depth <= MAX_INDENT) set(r, c, { indent: depth });
      }
    }
  });
  // What the page draws on the rows.
  const rowBox = rows.map((row) => extentOf(row.flatMap((cell) => cell.words)));
  const filled = rowBox.flatMap((b, r) => (b ? [r] : []));
  const base = (b: Extent) => b.y1 - 0.217 * Math.max(b.y1 - b.y0, 0.1);
  const pitches: number[] = [];
  for (let k = 1; k < filled.length; k++) pitches.push(base(rowBox[filled[k]]!) - base(rowBox[filled[k - 1]]!));
  pitches.sort((a, b) => a - b);
  const pitch = Math.max(6, pitches.length > 0 ? pitches[pitches.length >> 1] : 14);
  const covers = (x0: number, x1: number, r: number, c: number): boolean => {
    const span = spanOf.get(r * C + c);
    const e = span ? { x0: ext[span[0]].x0, x1: ext[span[1]].x1 } : ext[c];
    const w = e.x1 - e.x0;
    return w > 0 ? Math.min(x1, e.x1) - Math.max(x0, e.x0) >= 0.5 * w : x0 <= e.x0 && e.x0 <= x1;
  };
  for (const fill of table.drawn?.fills ?? []) {
    for (const r of filled) {
      const b = rowBox[r]!;
      const mid = (b.y0 + b.y1) / 2;
      if (mid < fill.y0 - 1 || mid > fill.y1 + 1) continue;
      for (let c = 0; c < C; c++) if (covers(fill.x0, fill.x1, r, c)) set(r, c, { fill: fill.color });
    }
  }
  const drawn = new Map<string, { y: number; color: string; width: number }[]>();
  for (const rule of table.drawn?.rules ?? []) {
    let above = -1;
    for (const r of filled) if (base(rowBox[r]!) <= rule.y + 0.5) above = r;
    let r = above;
    let side: 'top' | 'bottom' = 'bottom';
    if (above < 0 || rule.y - rowBox[above]!.y1 > pitch) {
      const below = filled.find((k) => rowBox[k]!.y0 >= rule.y - 0.5);
      if (below === undefined || rowBox[below]!.y0 - rule.y > pitch) continue;
      r = below;
      side = 'top';
    }
    for (let c = 0; c < C; c++) {
      if (!covers(rule.x0, rule.x1, r, c)) continue;
      const key = `${r} ${c} ${side}`;
      const list = drawn.get(key);
      const line = { y: rule.y, color: rule.color ?? '000000', width: rule.width ?? 0.5 };
      if (list) list.push(line);
      else drawn.set(key, [line]);
    }
  }
  for (const [key, list] of drawn) {
    const [r, c, side] = key.split(' ');
    const ys = list.map((l) => l.y);
    const apart = Math.max(...ys) - Math.min(...ys);
    const border: Border = { color: list[0].color, width: list[0].width, ...(list.length >= 2 && apart >= 1 && apart <= DOUBLE_RULE_PT ? { double: true as const } : {}) };
    const at = looks[Number(r)][Number(c)];
    set(Number(r), Number(c), { borders: { ...(at?.borders ?? {}), [side]: border } });
  }
  const right = Math.max(ext[C - 1]?.x1 ?? 0, ...rowBox.map((b) => b?.x1 ?? -Infinity));
  const widths = table.columns.map((x, c) => Math.max(0, (c + 1 < C ? table.columns[c + 1] : right + 4) - x));
  const runsOn = rows.map((row) => row.map((cell, c) => c + 1 < C && cell.words.length > 0 && Math.max(...cell.words.map((w) => w.x1)) > table.columns[c + 1] + SAME_EDGE_PT));
  return { rows, looks, merges, ys: rowBox.map((b) => (b ? [b.y0, b.y1] : null)), widths, runsOn };
}

/** A gap this many font sizes wide sets two pieces of a line of text apart (wordLook.ts WIDE_GAP_EM). */
const PIECE_GAP_EM = 2;
/** A piece ends at a table's right edge, or is centred over it, within this. */
const PIECE_EDGE_PT = 3;
/** Text centred over a table or set at its right edge starts at least this far from its left edge. */
const CENTRED_MIN_PT = 20;

/** The pieces of a line of text that stand apart by a wide gap (a reference at the left, a date at the right); one piece for a line whose words are spread evenly. */
function linePieces(line: Line): Word[][] {
  const words = [...line.words].filter((w) => w.text.trim() !== '').sort((a, b) => a.x0 - b.x0);
  if (words.length < 2) return [words];
  const size = line.size > 0 ? line.size : 10;
  let widest = 0;
  let narrowest = Infinity;
  for (let k = 1; k < words.length; k++) {
    const gap = words[k].x0 - words[k - 1].x1;
    widest = Math.max(widest, gap);
    narrowest = Math.min(narrowest, gap);
  }
  if (widest < PIECE_GAP_EM * size || (words.length >= 3 && widest < 1.3 * narrowest)) return [words];
  const pieces: Word[][] = [[words[0]]];
  for (let k = 1; k < words.length; k++) {
    if (words[k].x0 - words[k - 1].x1 >= PIECE_GAP_EM * size) pieces.push([words[k]]);
    else pieces[pieces.length - 1].push(words[k]);
  }
  return pieces;
}

/** The columns of a table on its page, for placing what stands beside or over it: where each starts, and the table's edges. */
interface Frame { y0: number; y1: number; columns: number[]; /** Where each column's text ends (a drawn column: its right edge). */ ends: number[]; left: number; right: number }

function frameOf(table: Table): Frame {
  let right = -Infinity;
  const C = table.columns.length;
  const ends = table.columns.map((x) => x);
  for (const row of table.rows) {
    row.forEach((cell, c) => {
      for (const w of cell.words) {
        if (w.x1 > right) right = w.x1;
        if (c < C && w.x1 > ends[c] && (c + 1 >= C || w.x1 <= table.columns[c + 1])) ends[c] = w.x1;
      }
    });
  }
  if (table.grid && table.source === 'ruled') {
    const xs = table.grid.xs;
    right = Math.max(right, xs[xs.length - 1]);
    for (let c = 0; c < C && c + 1 < xs.length; c++) ends[c] = xs[c + 1];
  }
  const first = table.columns[0] ?? 0;
  const last = table.columns[C - 1] ?? 0;
  return { y0: table.y0, y1: table.y1, columns: table.columns, ends, left: first, right: Math.max(right, last + 1) };
}

/** The index of the last column starting at or before `x`. */
function columnAt(columns: readonly number[], x: number): number {
  let k = 0;
  for (let i = 1; i < columns.length && columns[i] <= x; i++) k = i;
  return k;
}

/** Excel's column width (characters of the default font) for a width on the page in points. */
const widthOfPoints = (pt: number) => Math.round(Math.max(0.6, pt / 5.3) * 10) / 10;

const width = (chars: number, max: number) => Math.round(Math.min(max, Math.max(MIN_WIDTH, chars * 1.1 + 2)) * 10) / 10;

class SheetBuilder {
  readonly rows: CellPlan[][] = [];
  /** Longest table cell text per column; longest text line (column A). */
  private readonly tableChars: number[] = [];
  private textChars = 0;
  /** The sheet has a table already (one-sheet mode: a new table then starts after a blank row). */
  hadTable = false;
  /** Merged ranges, row heights, and the widths the columns of drawn tables have on the page. */
  private readonly merges: number[][] = [];
  private readonly heights: Record<number, number> = {};
  private readonly drawnWidths: number[] = [];
  /** The widths the columns of tables read from their text have on the page. */
  private readonly pageWide: number[] = [];
  /** The rows written for the page being planned, with their places down the page: what a picture is anchored to. */
  private marks: { row: number; y0: number; y1: number }[] = [];
  private readonly pictures: SheetPicture[] = [];

  constructor(readonly name: string) {}

  private push(row: CellPlan[], y?: readonly [number, number] | null): void {
    if (this.rows.length >= EXCEL_MAX_ROWS) throw new PdfToolsError('excel-too-many-rows', tooManyRowsMessage());
    if (y && y[1] > y[0]) this.marks.push({ row: this.rows.length, y0: y[0], y1: y[1] });
    this.rows.push(row);
  }

  /** A new page starts: pictures are anchored to the rows of their own page. */
  beginPage(): void {
    this.marks = [];
  }

  /** How far down the page the rows written for it reach. */
  reached(): number {
    return this.marks.length > 0 ? this.marks[this.marks.length - 1].y1 : -Infinity;
  }

  textLine(text: string, words: readonly Word[] = [], y?: readonly [number, number]): void {
    const shown = fitCell(text);
    const look = wordsStyle(words, true, false);
    this.push(shown === '' ? [] : [look ? { text: shown, look } : { text: shown }], y);
    this.textChars = Math.max(this.textChars, shown.length);
  }

  /**
   * A line of text whose pieces stand in cells of their own (`col` from 0, rising), or one piece set over the
   * columns `col` to `last` (merged) or at a column's right edge. Each piece stays text: a line of text is never a number.
   */
  textPieces(pieces: readonly { words: readonly Word[]; col: number; last?: number; align?: 'center' | 'right' }[], y?: readonly [number, number]): void {
    const row: CellPlan[] = [];
    for (const piece of pieces) {
      const shown = fitCell(wordsLine(piece.words));
      if (shown === '') continue;
      const col = Math.min(piece.col, EXCEL_MAX_COLUMNS - 1);
      while (row.length < col) row.push({ text: '' });
      const look: CellStyle = { ...(wordsStyle(piece.words, true, false) ?? {}), ...(piece.align ? { align: piece.align } : {}) };
      row[col] = Object.keys(look).length > 0 ? { text: shown, look } : { text: shown };
      if (piece.last !== undefined && piece.last > col) this.merges.push([this.rows.length, col, this.rows.length, Math.min(piece.last, EXCEL_MAX_COLUMNS - 1)]);
      if (col === 0 && piece.last === undefined) this.textChars = Math.max(this.textChars, shown.length);
    }
    this.push(row, y);
  }

  blank(): void {
    this.push([]);
  }

  /** Empty rows standing for a stretch of the page that only a picture takes. */
  room(y0: number, y1: number): void {
    const n = Math.max(1, Math.min(60, Math.ceil((y1 - y0) / DEFAULT_ROW_PT)));
    for (let k = 0; k < n; k++) this.push([], [y0 + ((y1 - y0) * k) / n, y0 + ((y1 - y0) * (k + 1)) / n]);
  }

  /** A picture of the page being planned, at the rows written for the stretch of the page it stands in; `col` as SheetPicture's. */
  picture(file: PictureFile, box: { x0: number; y0: number; x1: number; y1: number }, col: number): void {
    let row = this.rows.length;
    for (const mark of this.marks) {
      if (box.y0 <= mark.y0) {
        row = mark.row;
        break;
      }
      if (box.y0 < mark.y1) {
        row = mark.row + Math.min(0.95, (box.y0 - mark.y0) / (mark.y1 - mark.y0));
        break;
      }
    }
    // Where it ends, the same way; the rows between are as tall on the sheet as they are (their set height, else the default).
    let end = this.rows.length;
    for (const mark of this.marks) {
      if (box.y1 <= mark.y0) {
        end = mark.row;
        break;
      }
      if (box.y1 < mark.y1) {
        end = mark.row + (box.y1 - mark.y0) / (mark.y1 - mark.y0);
        break;
      }
    }
    let room = 0;
    for (let r = Math.floor(row); r < Math.ceil(end) && r < this.rows.length; r++) {
      const share = Math.min(end, r + 1) - Math.max(row, r);
      if (share > 0) room += share * (this.heights[r] ?? DEFAULT_ROW_PT);
    }
    // Rows shorter on the sheet than on the page: the picture is made smaller, in its proportions, so that it ends
    // where it ends on the page and covers nothing that stands under it.
    const tall = box.y1 - box.y0;
    const scale = end < this.rows.length && room > 0 && room < tall ? Math.max(MIN_PICTURE_SCALE, room / tall) : 1;
    this.pictures.push({ file, col, row, width: Math.max(1, Math.round(((box.x1 - box.x0) * scale * 96) / 72)), height: Math.max(1, Math.round((tall * scale * 96) / 72)) });
  }

  /**
   * A table row; returns how many cells became numbers. `cells` are the row's cells, for how their words are
   * set; `looks` what the page shows of each cell besides (a fill, a border, an indent: alignedLooks).
   */
  tableRow(texts: readonly string[], cells: readonly { words: Word[] }[] = [], looks: readonly (CellStyle | undefined)[] = [], y?: readonly [number, number] | null, runsOn: readonly boolean[] = []): number {
    let numbers = 0;
    let width = texts.length;
    for (let c = Math.min(looks.length, EXCEL_MAX_COLUMNS) - 1; c >= width; c--) {
      if (looks[c]) {
        width = c + 1;
        break;
      }
    }
    const row: CellPlan[] = [];
    for (let c = 0; c < width; c++) {
      const text = fitCell(texts[c] ?? '');
      const words = cells[c]?.words ?? [];
      const set = text === '' ? undefined : wordsStyle(words, true, false);
      // Sized to its text in the size it is written in (Excel's width counts characters of an 11-point font).
      this.tableChars[c] = Math.max(this.tableChars[c] ?? 0, runsOn[c] ? 0 : text.length * (set?.size ? Math.min(1.5, set.size / 11) : 1));
      const number = text === '' ? null : parseAmount(text);
      const more = looks[c];
      const look = set || more ? { ...(set ?? {}), ...(more ?? {}) } : undefined;
      if (number) {
        numbers++;
        row.push(look ? { number, look } : { number });
      } else row.push(look ? { text, look } : { text });
    }
    this.push(row, y);
    return numbers;
  }

  /** A heading of a table row lying over several columns: the row `back` rows before the end of the sheet, its first and last column. */
  mergeAt(back: number, first: number, last: number): void {
    const row = this.rows.length - back;
    if (row >= 0 && first < EXCEL_MAX_COLUMNS && last > first) this.merges.push([row, first, row, Math.min(last, EXCEL_MAX_COLUMNS - 1)]);
  }

  /** The columns of a table read from its text are at least as wide as on the page. */
  pageWidths(widths: readonly number[]): void {
    widths.slice(0, EXCEL_MAX_COLUMNS).forEach((pt, c) => {
      this.pageWide[c] = Math.max(this.pageWide[c] ?? 0, Math.min(MAX_WIDTH, widthOfPoints(pt)));
    });
  }

  /**
   * A table drawn with lines, from its true cells: a row of the sheet per row of the grid, a merged range per
   * cell lying over several, each cell as it looks. Returns how many cells became numbers.
   */
  gridTable(grid: Grid): number {
    const base = this.rows.length;
    const R = grid.ys.length - 1;
    const C = Math.min(grid.xs.length - 1, EXCEL_MAX_COLUMNS);
    const rows: CellPlan[][] = Array.from({ length: R }, () => []);
    let numbers = 0;
    // How far from its cell's left edge the text of each column usually starts: a caption set in further is indented.
    const starts: number[] = [];
    const startOf = (cell: GridCell): number | null => {
      if (cell.turn !== 0 || cell.colSpan !== 1) return null;
      let x0 = Infinity;
      for (const w of cell.words) if ((w.turn ?? 0) === 0 && w.x0 < x0) x0 = w.x0;
      return Number.isFinite(x0) ? x0 - cell.x0 : null;
    };
    for (const cell of grid.cells) {
      const at = startOf(cell);
      if (at !== null && cell.col < C) starts[cell.col] = Math.min(starts[cell.col] ?? Infinity, at);
    }
    for (const cell of grid.cells) {
      if (cell.col >= C) continue;
      const whole = fitCell(cell.text.trim());
      const number = whole === '' ? null : parseAmount(whole);
      const text = number === null ? fitCell(cellLines(cell)) : whole;
      // A cell of several lines looks as its first line does (a title over a smaller line).
      const look: CellStyle = { ...(wordsStyle(cell.lines[0]?.words ?? cell.words, true) ?? {}), ...sitting(cell, number !== null) };
      if (cell.shade) look.fill = cell.shade;
      const at = number === null && look.align === undefined ? startOf(cell) : null;
      if (at !== null) {
        const depth = Math.round((at - (starts[cell.col] ?? at)) / INDENT_PT);
        if (depth >= 1 && depth <= MAX_INDENT) look.indent = depth;
      }
      if (cell.lines.length >= 2 && cell.turn === 0) look.wrap = true;
      if (cell.turn !== 0) look.turn = cell.turn;
      const b = cell.borders;
      if (b.top || b.right || b.bottom || b.left) look.borders = { ...(b.top ? { top: b.top } : {}), ...(b.right ? { right: b.right } : {}), ...(b.bottom ? { bottom: b.bottom } : {}), ...(b.left ? { left: b.left } : {}) };
      const styled = Object.keys(look).length > 0;
      const row = rows[cell.row];
      while (row.length < cell.col) row.push({ text: '' });
      row[cell.col] = number ? (styled ? { number, look } : { number }) : styled ? { text, look } : { text };
      if (number) numbers++;
      const lastCol = Math.min(cell.col + cell.colSpan, C) - 1;
      if (cell.rowSpan > 1 || lastCol > cell.col) this.merges.push([base + cell.row, cell.col, base + cell.row + cell.rowSpan - 1, lastCol]);
    }
    for (let c = 0; c < C; c++) this.drawnWidths[c] = Math.max(this.drawnWidths[c] ?? 0, widthOfPoints(grid.xs[c + 1] - grid.xs[c]));
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) row[c] ??= { text: '' };
      this.heights[base + r] = Math.round(Math.max(3, Math.min(400, grid.ys[r + 1] - grid.ys[r])) * 100) / 100;
      this.push(row, [grid.ys[r], grid.ys[r + 1]]);
    });
    return numbers;
  }

  plan(): SheetPlan {
    let columnWidths: number[];
    const columns = Math.max(this.tableChars.length, this.drawnWidths.length, this.pageWide.length);
    // A drawn table's columns are as wide as on the page; a column only other tables use, as wide as its longest cell.
    if (columns > 0) columnWidths = Array.from({ length: columns }, (_, c) => Math.max(this.drawnWidths[c] ?? 0, this.pageWide[c] ?? 0, this.tableChars[c] !== undefined ? width(this.tableChars[c] ?? 0, MAX_WIDTH) : 0));
    else if (this.textChars > 0) columnWidths = [width(this.textChars, MAX_TEXT_WIDTH)];
    else columnWidths = [];
    return {
      name: this.name,
      rows: this.rows,
      columnWidths: columnWidths.map((w) => (Number.isFinite(w) ? w : DEFAULT_WIDTH)),
      ...(this.merges.length > 0 ? { merges: this.merges } : {}),
      ...(Object.keys(this.heights).length > 0 ? { rowHeights: this.heights } : {}),
      ...(this.pictures.length > 0 ? { pictures: this.pictures } : {}),
    };
  }
}

/** The foot of a page (as wordBuild.ts reads it): a line in the last part of the page's height, after a gap of this many points and this many of its own heights. */
const FOOT_FROM_SHARE = 0.85;
const FOOT_GAP_PT = 18;
const FOOT_GAP_LINES = 1.5;

/** Rows a page adds to one sheet at least (blank rows not counted), before anything is built. */
function rowsOf(page: PageLayout): number {
  let n = 0;
  for (const block of page.blocks) n += block.kind === 'text' ? block.lines.length : block.table.rows.length;
  return n;
}

/** The pictures of a page that go on the sheet: those with a file that no text lies over (a faint ground behind the text is left out). */
function sheetPictures(page: PageLayout, files: readonly (PictureFile | null)[] | undefined): { box: Picture; file: PictureFile }[] {
  const out: { box: Picture; file: PictureFile }[] = [];
  for (const box of page.pictures ?? []) {
    const file = files?.[box.index] ?? null;
    // A picture of a page read turned would have to be turned with it, which a sheet's picture cannot be: left out.
    if (file && !box.behind && !box.turn && out.length < MAX_PAGE_PICTURES) out.push({ box, file });
  }
  return out.sort((a, b) => a.box.y0 - b.box.y0);
}

function* planWork(pages: readonly PageLayout[], mode: SheetMode, pictures?: readonly (readonly (PictureFile | null)[])[]): Work<{ sheets: SheetPlan[]; report: ExcelReport }> {
  const report: ExcelReport = { pages: pages.length, sheets: 0, tablesRuled: 0, tablesAligned: 0, pagesAsText: 0, pagesNoText: 0, rows: 0, numberCells: 0 };
  if (mode === 'one-sheet') {
    // Refused before anything is built when the rows alone are too many; a sheet that passes the limit
    // only with its blank rows is refused as it passes it (SheetBuilder).
    let needed = 0;
    for (const page of pages) needed += rowsOf(page);
    if (needed > EXCEL_MAX_ROWS) throw new PdfToolsError('excel-too-many-rows', tooManyRowsMessage());
  }

  // Shared by every sheet: a statement has the same columns on each sheet of "One sheet per page" too.
  const references: Reference[] = [];
  const used = new Set<string>();
  const sheets: SheetBuilder[] = [];
  let sheet: SheetBuilder | null = mode === 'one-sheet' ? new SheetBuilder(safeSheetName(ONE_SHEET_NAME, used)) : null;
  if (sheet) sheets.push(sheet);
  let since = 0;

  for (const page of pages) {
    if (mode === 'per-page') {
      sheet = new SheetBuilder(safeSheetName(`Page_${page.pageIndex + 1}`, used));
      sheets.push(sheet);
    }
    const target = sheet!;
    // Little or no text: counted, but every word it holds is still written below.
    const little = countsAsScanned({ pageIndex: page.pageIndex, width: page.width, height: page.height, words: wordsOf(page) });
    if (little) report.pagesNoText++;
    if (page.scan) report.pagesFromScan = (report.pagesFromScan ?? 0) + 1;
    if (!page.hasText) continue;
    let tables = 0;
    // The page's tables as they go on the sheet, placed first: what stands over or beside a table is set in its columns.
    const placedOf = new Map<Block, { table: Table; carried: boolean }>();
    const frames: Frame[] = [];
    for (const block of page.blocks as readonly Block[]) {
      if (block.kind !== 'table') continue;
      const placed = placeTable(block.table, references);
      placedOf.set(block, placed);
      frames.push(frameOf(placed.table));
    }
    /** The table nearest to a stretch of the page, if the page has one. */
    const frameAt = (y0: number, y1: number): Frame | null => {
      let best: Frame | null = null;
      let near = Infinity;
      for (const f of frames) {
        const d = y1 < f.y0 ? f.y0 - y1 : y0 > f.y1 ? y0 - f.y1 : 0;
        if (d < near) [best, near] = [f, d];
      }
      return best;
    };
    target.beginPage();
    const waiting = sheetPictures(page, pictures?.[page.pageIndex]);
    /** Pictures standing wholly in a stretch of the page that holds no row get rows of their own there. */
    const roomed = new Set<Picture>();
    const roomBefore = (y: number) => {
      for (const p of waiting) {
        if (roomed.has(p.box) || p.box.y1 > y + 2 || p.box.y0 < target.reached() - 2) continue;
        roomed.add(p.box);
        target.room(Math.max(p.box.y0, target.reached()), p.box.y1);
      }
    };
    for (const block of page.blocks as readonly Block[]) {
      if (block.kind === 'text') {
        for (const line of block.lines) {
          const turned = line.words.some((w) => (w.turn ?? 0) !== 0);
          if (!turned) roomBefore(line.y0);
          // The foot of the page (a line after a clear gap, at the bottom): on a sheet that holds this page alone an empty
          // row keeps it apart from what is above. A sheet of several pages keeps its rows together (a statement carried
          // over its pages stays one block of rows).
          if (!turned && (mode === 'per-page' || pages.length === 1) && Number.isFinite(target.reached()) && line.y0 >= FOOT_FROM_SHARE * page.height && line.y0 - target.reached() >= Math.max(FOOT_GAP_PT, FOOT_GAP_LINES * (line.y1 - line.y0))) target.blank();
          const y: [number, number] | undefined = turned ? undefined : [line.y0, line.y1];
          const frame = turned ? null : frameAt(line.y0, line.y1);
          const pieces = turned ? [line.words] : linePieces(line);
          if (pieces.length >= 2) {
            // Pieces set apart: each in the column it starts in; the last, when it ends at the table's right edge, in the column it ends in.
            let col = -1;
            target.textPieces(
              pieces.map((words, k) => {
                const x0 = words[0].x0;
                const x1 = Math.max(...words.map((w) => w.x1));
                const atEnd = frame !== null && k === pieces.length - 1 && Math.abs(x1 - frame.right) <= PIECE_EDGE_PT;
                const at = frame ? columnAt(frame.columns, atEnd ? x1 - SAME_EDGE_PT : x0 + SAME_EDGE_PT) : k;
                col = Math.max(col + 1, at);
                return atEnd && col === at && col > 0 ? { words, col, align: 'right' as const } : { words, col };
              }),
              y,
            );
          } else if (frame && frame.columns.length >= 2 && pieces[0].length > 0) {
            // One piece that does not start at the table's left edge stands where the page sets it: centred over the
            // whole table, across its columns; over several of its columns, across those; else in the column it lies
            // in, at that column's right edge or middle when it stands so.
            const x0 = pieces[0][0].x0;
            const x1 = Math.max(...pieces[0].map((w) => w.x1));
            const end = Math.min(frame.columns.length, EXCEL_MAX_COLUMNS) - 1;
            const first = columnAt(frame.columns, x0 + SAME_EDGE_PT);
            const last = Math.min(end, columnAt(frame.columns, x1 - SAME_EDGE_PT));
            const setIn = x0 - frame.left > CENTRED_MIN_PT;
            if (setIn && Math.abs((x0 + x1) / 2 - (frame.left + frame.right) / 2) <= PIECE_EDGE_PT) target.textPieces([{ words: pieces[0], col: 0, last: end, align: 'center' }], y);
            else if (setIn && first > 0 && first <= end && last > first) target.textPieces([{ words: pieces[0], col: first, last, align: 'center' }], y);
            else if (setIn && first > 0 && first <= end) {
              const c0 = frame.columns[first];
              const c1 = frame.ends[first] ?? c0;
              const align = Math.abs(x1 - c1) <= PIECE_EDGE_PT ? ('right' as const) : x0 - c0 > 2 && Math.abs((x0 + x1) / 2 - (c0 + c1) / 2) <= PIECE_EDGE_PT ? ('center' as const) : undefined;
              target.textPieces([{ words: pieces[0], col: first, ...(align ? { align } : {}) }], y);
            } else target.textLine(lineText(line).trim(), line.words, y);
          } else target.textLine((line.turn !== undefined ? line.words.map((w) => w.text).join(' ') : lineText(line)).trim(), line.words, y);
        }
        since += block.lines.length;
      } else {
        tables++;
        if (block.table.source === 'ruled') report.tablesRuled++;
        else report.tablesAligned++;
        const { table, carried } = placedOf.get(block)!;
        if (!carried && mode === 'one-sheet' && target.hadTable) target.blank();
        target.hadTable = true;
        roomBefore(table.y0);
        if (table.grid && table.source === 'ruled') {
          report.numberCells += target.gridTable(table.grid);
          since += table.grid.cells.length;
        } else {
          // A table read from its text also shows what the page draws on its rows (alignedLooks).
          const seen = table.source === 'aligned' && table.columns.length > 0 && table.columns.length <= EXCEL_MAX_COLUMNS ? alignedLooks(table) : null;
          if (seen) target.pageWidths(seen.widths);
          const rows = seen?.rows ?? table.rows;
          for (let r = 0; r < rows.length; r++) {
            const cells = rows[r];
            report.numberCells += target.tableRow(rowTexts(cells), cells, seen?.looks[r], seen?.ys[r], seen?.runsOn[r]);
            since += cells.length;
            if (since >= CELLS_PER_STEP) {
              since = 0;
              yield;
            }
          }
          if (seen) for (const [r, first, last] of seen.merges) target.mergeAt(rows.length - r, first, last);
        }
      }
      if (since >= CELLS_PER_STEP) {
        since = 0;
        yield;
      }
    }
    if (waiting.length > 0) {
      roomBefore(Infinity);
      let left = Infinity;
      let right = -Infinity;
      for (const w of wordsOf(page)) {
        if (w.x0 < left) left = w.x0;
        if (w.x1 > right) right = w.x1;
      }
      for (const p of waiting) {
        const frame = frameAt(p.box.y0, p.box.y1);
        let col = 0;
        if (frame) {
          const c = columnAt(frame.columns, p.box.x0);
          const next = c + 1 < frame.columns.length ? frame.columns[c + 1] : frame.right;
          col = c + Math.max(0, Math.min(0.95, (p.box.x0 - frame.columns[c]) / Math.max(1, next - frame.columns[c])));
        } else if (right > left) col = Math.max(0, Math.min(0.9, (p.box.x0 - left) / (right - left)));
        target.picture(p.file, p.box, col);
      }
    }
    if (tables === 0 && !little) report.pagesAsText++;
    yield;
  }

  const plans = sheets.map((s) => s.plan());
  report.sheets = plans.length;
  report.rows = plans.reduce((n, s) => n + s.rows.length, 0);
  return { sheets: plans, report };
}

/** The sheets for these pages, and what was found (contract XLS). Throws a PdfToolsError over 1,048,576 rows on one sheet. */
export function planSheets(pages: readonly PageLayout[], mode: SheetMode, pictures?: readonly (readonly (PictureFile | null)[])[]): { sheets: SheetPlan[]; report: ExcelReport } {
  return runAtOnce(planWork(pages, mode, pictures));
}

/** planSheets, giving the window a turn through `pace` (a long file holds many thousand cells). */
export function planSheetsPaced(pages: readonly PageLayout[], mode: SheetMode, pace: Pace, pictures?: readonly (readonly (PictureFile | null)[])[]): Promise<{ sheets: SheetPlan[]; report: ExcelReport }> {
  return runPaced(planWork(pages, mode, pictures), pace);
}

// ---- the workbook --------------------------------------------------------------------------------------
//
// exceljs renders a sheet and zips the file in one stretch (measured, 500 statement pages: 3.4 s on one
// sheet, 1.6 s one sheet per page), so the run hands the sheets to a worker (convert/excelWrite.worker.ts).
// They go there packed, so the copy made for the worker is a few block copies: the cells as flat typed
// arrays and the text of the text cells as one string, packed here a slice at a time. The copy is kept, so
// a worker that fails can be replaced by writing here. writePacked is the same writer in the worker and,
// where no worker can be started, on the window's thread.

/** The sheets as the writer takes them, cheap to hand to a worker. Cell k of a sheet is at rows[k], cols[k] (from 1). */
export interface PackedSheet {
  name: string;
  widths: number[];
  rows: Uint32Array;
  cols: Uint16Array;
  /** -1 for a text cell, else the index of its number format in PackedWorkbook.formats. */
  formats: Int32Array;
  /** A number cell's value (0 for a text cell). */
  numbers: Float64Array;
  /** The text cells' texts, in cell order, joined by TEXT_SEPARATOR. */
  texts: string;
  /** Per cell: the index of its look in PackedWorkbook.looks, or -1 for a plain cell. */
  looks?: Int32Array;
  /** Merged ranges, four numbers each: first row, first column, last row, last column (from 1). */
  merges?: Uint32Array;
  /** Row heights in points, two numbers each: the row (from 1) and its height in hundredths of a point. */
  heights?: Uint32Array;
  /** Pictures, five numbers each: the index of its file in PackedWorkbook.media, the column and row of its top-left corner (from 0, with the share of the cell before it), its width and height in pixels. */
  pictures?: Float64Array;
}
export interface PackedWorkbook { sheets: PackedSheet[]; formats: string[]; looks?: CellStyle[]; /** Each picture file once, however many places show it. */ media?: { bytes: Uint8Array; type: 'png' | 'jpeg' }[] }

/** Never inside a cell's text: planSheets replaces characters an .xlsx file cannot hold. */
const TEXT_SEPARATOR = '\u0000';
/** Characters an .xlsx file (XML 1.0) cannot hold, and lone surrogates: shown as U+FFFD, never dropped silently. */
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
export const xmlSafe = (text: string) => text.replace(NOT_XML, '\ufffd');

/** Packs the sheets for writePacked, giving the window a turn through `pace`. */
export async function packSheets(sheets: readonly SheetPlan[], pace: Pace): Promise<PackedWorkbook> {
  const formats: string[] = [];
  const formatIndex = new Map<string, number>();
  const list = sheets.length > 0 ? sheets : [{ name: ONE_SHEET_NAME, rows: [], columnWidths: [] }];
  const used = new Set<string>();
  const packed: PackedSheet[] = [];
  const looks: CellStyle[] = [];
  const lookIndex = new Map<string, number>();
  const media: { bytes: Uint8Array; type: 'png' | 'jpeg' }[] = [];
  const mediaIndex = new Map<PictureFile, number>();
  let since = 0;
  for (const plan of list as readonly SheetPlan[]) {
    let count = 0;
    for (const row of plan.rows) for (const c of row) if ('number' in c || c.text !== '' || c.look) count++;
    const cellLooks = new Int32Array(count).fill(-1);
    const rows = new Uint32Array(count);
    const cols = new Uint16Array(count);
    const cellFormats = new Int32Array(count);
    const numbers = new Float64Array(count);
    const texts: string[] = [];
    let k = 0;
    for (let r = 0; r < plan.rows.length; r++) {
      const cells = plan.rows[r];
      for (let c = 0; c < cells.length; c++) {
        const planned = cells[c];
        if ('number' in planned) {
          const format = numberFormat(planned.number);
          let index = formatIndex.get(format);
          if (index === undefined) {
            index = formats.push(format) - 1;
            formatIndex.set(format, index);
          }
          cellFormats[k] = index;
          numbers[k] = planned.number.value;
        } else if (planned.text !== '' || planned.look) {
          cellFormats[k] = -1;
          texts.push(xmlSafe(planned.text));
        } else continue;
        if (planned.look) {
          const key = JSON.stringify(planned.look);
          let index = lookIndex.get(key);
          if (index === undefined) {
            index = looks.push(planned.look) - 1;
            lookIndex.set(key, index);
          }
          cellLooks[k] = index;
        }
        rows[k] = r + 1;
        cols[k] = c + 1;
        k++;
      }
      since += cells.length;
      if (since >= CELLS_PER_STEP) {
        since = 0;
        const turn = pace();
        if (turn) await turn;
      }
    }
    const merges = Uint32Array.from((plan.merges ?? []).flatMap(([r0, c0, r1, c1]) => [r0 + 1, c0 + 1, r1 + 1, c1 + 1]));
    const heights = Uint32Array.from(Object.entries(plan.rowHeights ?? {}).flatMap(([r, h]) => [Number(r) + 1, Math.round(h * 100)]));
    const placed = Float64Array.from(
      (plan.pictures ?? []).flatMap((p) => {
        let index = mediaIndex.get(p.file);
        if (index === undefined) {
          index = media.push({ bytes: p.file.bytes, type: p.file.type }) - 1;
          mediaIndex.set(p.file, index);
        }
        return [index, p.col, p.row, p.width, p.height];
      }),
    );
    packed.push({ name: safeSheetName(plan.name, used), widths: [...plan.columnWidths], rows, cols, formats: cellFormats, numbers, texts: texts.join(TEXT_SEPARATOR), looks: cellLooks, merges, heights, ...(placed.length > 0 ? { pictures: placed } : {}) });
  }
  return { sheets: packed, formats, looks, ...(media.length > 0 ? { media } : {}) };
}

/**
 * Writes a packed workbook as an .xlsx file with exceljs. `pace`, when given, is asked between rows and
 * what it throws (a Stop) ends the write; exceljs's own rendering and zipping at the end is one stretch.
 */
/** A cell's style as exceljs takes it: its number format and its look. */
function styleOf(numFmt: string | undefined, look: CellStyle | undefined): Partial<import('exceljs').Style> {
  const style: Partial<import('exceljs').Style> = {};
  if (numFmt !== undefined) style.numFmt = numFmt;
  if (!look) return style;
  if (look.bold || look.italic || look.underline || look.color || look.family || look.size) {
    style.font = {
      ...(look.family ? { name: look.family } : {}),
      ...(look.size ? { size: look.size } : {}),
      ...(look.bold ? { bold: true } : {}),
      ...(look.italic ? { italic: true } : {}),
      ...(look.underline ? { underline: true } : {}),
      ...(look.color ? { color: { argb: `FF${look.color}` } } : {}),
    };
  }
  if (look.align || look.valign || look.wrap || look.turn || look.indent) {
    style.alignment = {
      ...(look.align ? { horizontal: look.align } : look.indent ? { horizontal: 'left' as const } : {}),
      ...(look.indent ? { indent: look.indent } : {}),
      ...(look.valign ? { vertical: look.valign } : {}),
      ...(look.wrap ? { wrapText: true } : {}),
      ...(look.turn ? { textRotation: look.turn === 90 ? 90 : -90 } : {}),
    };
  }
  if (look.fill) style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${look.fill}` } };
  if (look.borders) {
    const side = (b?: Border) => (b ? { style: b.double ? ('double' as const) : b.width > 1.6 ? ('medium' as const) : ('thin' as const), color: { argb: `FF${b.color}` } } : undefined);
    const { top, right, bottom, left } = look.borders;
    style.border = { ...(top ? { top: side(top) } : {}), ...(right ? { right: side(right) } : {}), ...(bottom ? { bottom: side(bottom) } : {}), ...(left ? { left: side(left) } : {}) };
  }
  return style;
}

export async function writePacked(packed: PackedWorkbook, pace?: Pace): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'ICAI VERA';
  book.lastModifiedBy = 'ICAI VERA';
  let since = 0;
  const styles = new Map<string, Partial<import('exceljs').Style>>();
  for (const sheet of packed.sheets) {
    const ws = book.addWorksheet(sheet.name);
    sheet.widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    const texts = sheet.texts === '' ? [] : sheet.texts.split(TEXT_SEPARATOR);
    let t = 0;
    let rowNumber = 0;
    let row: ReturnType<typeof ws.getRow> | null = null;
    for (let k = 0; k < sheet.rows.length; k++) {
      if (sheet.rows[k] !== rowNumber) {
        rowNumber = sheet.rows[k];
        row = ws.getRow(rowNumber);
      }
      const cell = row!.getCell(sheet.cols[k]);
      const format = sheet.formats[k];
      let numFmt: string | undefined;
      if (format >= 0) {
        cell.value = sheet.numbers[k];
        numFmt = packed.formats[format];
      } else {
        const text = texts[t++] ?? '';
        if (text !== '') {
          cell.value = text;
          numFmt = '@';
        }
      }
      // One style object for all cells that look the same: exceljs then works each style out once, not once a cell.
      const lookAt = sheet.looks ? sheet.looks[k] : -1;
      if (numFmt !== undefined || lookAt >= 0) {
        const key = `${numFmt ?? ''}\u0000${lookAt}`;
        let style = styles.get(key);
        if (!style) styles.set(key, (style = styleOf(numFmt, lookAt >= 0 ? packed.looks?.[lookAt] : undefined)));
        cell.style = style;
      }
      if (pace && ++since >= CELLS_PER_STEP) {
        since = 0;
        const turn = pace();
        if (turn) await turn;
      }
    }
  }
  // After every cell is written: a merged range takes its first cell's look.
  const imageIds = new Map<number, number>();
  packed.sheets.forEach((sheet, i) => {
    const ws = book.worksheets[i];
    for (let k = 0; sheet.heights && k + 1 < sheet.heights.length; k += 2) ws.getRow(sheet.heights[k]).height = sheet.heights[k + 1] / 100;
    for (let k = 0; sheet.merges && k + 3 < sheet.merges.length; k += 4) {
      try {
        ws.mergeCells(sheet.merges[k], sheet.merges[k + 1], sheet.merges[k + 2], sheet.merges[k + 3]);
      } catch {
        // Two ranges that overlap (a grid read wrongly): the later one is left unmerged.
      }
    }
    // Pictures last: their places are counted from the widths and heights set above.
    for (let k = 0; sheet.pictures && k + 4 < sheet.pictures.length; k += 5) {
      const file = packed.media?.[sheet.pictures[k]];
      if (!file) continue;
      let id = imageIds.get(sheet.pictures[k]);
      if (id === undefined) imageIds.set(sheet.pictures[k], (id = book.addImage({ buffer: file.bytes as unknown as ArrayBuffer, extension: file.type })));
      ws.addImage(id, { tl: { col: sheet.pictures[k + 1], row: sheet.pictures[k + 2] }, ext: { width: sheet.pictures[k + 3], height: sheet.pictures[k + 4] }, editAs: 'oneCell' });
    }
  });
  const out = await book.xlsx.writeBuffer();
  // A plain Uint8Array of its own buffer (Node's Buffer may share a pool; the worker hands the buffer over).
  return new Uint8Array(out as ArrayBuffer | Uint8Array);
}

/** Writes the sheets as an .xlsx file on this thread. `pace` is asked between rows; what it throws (a Stop) ends the write. */
export async function buildWorkbook(sheets: readonly SheetPlan[], pace: Pace): Promise<Uint8Array> {
  return writePacked(await packSheets(sheets, pace), pace);
}
