/**
 * Page layout for the conversion tools (PDF to Excel, PDF to Word; design 5.11 and section 13).
 *
 * COORDINATES. Everything here is in display coordinates: points, origin at the top-left corner of the
 * page as it is shown after `/Rotate`, y growing downwards. The reader (pageWordsReader.ts) and the
 * ruling-line reader (rulingLines.ts) give words and lines that way, so a turned page needs no care here.
 *
 * WHAT IT DOES. `pageLayout` turns one page's words and ruling lines into blocks in reading order: a
 * table drawn with lines ('ruled'), else a table shown only by how its text lines up ('aligned'), else
 * text. Two columns of running text are read one after the other, split at the gutter between them.
 *
 * THE RULE THAT MATTERS MOST: an amount never lands in the wrong column. So columns are not found by
 * where words start (a right-aligned amount starts wherever its length puts it) but by the clear strips
 * between them; a heading lying over two columns does not join them; and a second line of a narration
 * stays in the narration's column.
 *
 * Every table is a full rectangle: each row has one cell per column, empty cells included. Words are
 * passed through as they are (Hindi or right-to-left words too); nothing is dropped. The functions are
 * synchronous and small (a dense page takes a few milliseconds); the caller paces between pages.
 * Nothing here logs or stores a word.
 *
 * HOW THE PAGE LOOKS (T-064, the quality round). A table drawn with lines also carries its true cells
 * (`Table.grid`): a cell is the rectangle the drawn lines bound, so a cell lying over several columns or
 * rows of the grid is one cell with a span; each has its box, its lines of text in reading order, the line
 * drawn on each of its sides (colour and weight) and its shading. Words may say how they are set (family,
 * bold, italic, colour, stretch, turn); a thin line drawn just under a line of text is its underline, not a
 * rule. Lines across the page that belong to no table are `rules`; pictures are given back by their boxes,
 * with whether text lies over them. A picture that invisible words stand over (a scan with its recognised
 * text: the words are written in text rendering mode 3) already shows those words: it is not given back, the
 * page is marked `scan`, and the words are typed like any others, so nothing is printed twice. Everything is
 * decided from what the page draws, never from what kind of document it may be.
 */

export interface Word {
  text: string; x0: number; y0: number; x1: number; y1: number; size: number; font: string;
  /** How the word is set, when the reader could tell: the family (one Windows ships), bold, italic, the colour as RRGGBB (absent: black). */
  family?: string; bold?: boolean; italic?: boolean; color?: string;
  /** How much wider than its font the text is drawn (1 when absent). */
  stretch?: number;
  /** Which way the word reads on the page as shown: 0 left to right, 90 bottom to top, 270 top to bottom, 180 upside down, -1 slanted. Absent: told from its box. */
  turn?: number;
  /** A thin line is drawn just under it (set by pageLayout). */
  underline?: boolean;
  /**
   * Small text raised ('super') or lowered ('sub') right after a word (set by pageLayout): the "st" of "31st", a
   * note's number. `raisedOf` is the font size of the word it belongs to.
   */
  raised?: 'super' | 'sub';
  raisedOf?: number;
  /** No space stands before it: it touches the word before, and one of the two is raised or lowered (set by pageLayout). */
  glued?: boolean;
  /** The page shows nothing of it: invisible text (text rendering mode 3), as a recognition layer over a scan writes its words. */
  hidden?: true;
}
export interface PageWords { pageIndex: number; width: number; height: number; words: Word[] }
/** A straight line the page draws, with its colour (RRGGBB) and weight in points when known. */
export interface Segment { x0: number; y0: number; x1: number; y1: number; color?: string; width?: number }
/** A straight stroke that runs neither across nor down the page, from its first point to its last, with its colour (RRGGBB) and weight. */
export interface Stroke { x0: number; y0: number; x1: number; y1: number; color?: string; width?: number }
export interface Line {
  y0: number; y1: number; size: number; words: Word[];
  /** The stretches [from, to] along the line where a thin line is drawn just under it (an underline, a blank to fill in). */
  underlines?: [number, number][];
  /** For a line of a cell whose text is turned: 90 or 270; its words are in reading order, y0/y1 are then across the line (x on the page). */
  turn?: number;
}
export interface Cell { text: string; words: Word[] }
/** A line drawn on one side of a cell. */
export interface Border { color: string; width: number; /** Two lines close together (a double rule under a total). */ double?: true }
/** A true cell of a ruled table: the rectangle the drawn lines bound. `row`/`col` index `Grid.ys`/`Grid.xs`. */
export interface GridCell {
  row: number; col: number; rowSpan: number; colSpan: number;
  x0: number; y0: number; x1: number; y1: number;
  text: string; words: Word[]; lines: Line[];
  /** 90 or 270 when the cell's text is turned (read bottom to top, or top to bottom), else 0. */
  turn: 0 | 90 | 270;
  borders: { top: Border | null; right: Border | null; bottom: Border | null; left: Border | null };
  /** The colour (RRGGBB) the cell is filled with, when it is. */
  shade?: string;
}
/** The grid of a ruled table: its column and row edges, and its cells in reading order (each grid square is in exactly one cell). */
export interface Grid {
  xs: number[]; ys: number[]; cells: GridCell[];
  /** For a table shown by how its text lines up: the page draws filled boxes on its rows (they are in PageLayout.fills). */
  shaded?: boolean;
}
/** What the page draws on a table shown by how its text lines up: the lines across its rows, and the filled boxes lying on them. */
export interface TableDrawn { rules: PageRule[]; fills: (Box & { color: string })[] }
export interface Table { source: 'ruled' | 'aligned'; y0: number; y1: number; columns: number[]; rows: Cell[][]; grid?: Grid; drawn?: TableDrawn }
/** A block of one of two columns of running text: which run of columns on its page (`group`), and which column (0 left, 1 right). */
export interface ColumnPlace { group: number; index: 0 | 1 }
export type Block = ({ kind: 'text'; lines: Line[] } | { kind: 'table'; table: Table }) & { column?: ColumnPlace }
/** A box drawn on the page that is not a line: a filled box, a picture. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** A picture on the page: `index` is its place in the list given to pageLayout; `behind` when text lies over it. */
export interface Picture extends Box {
  index: number; behind: boolean; /** How opaque it is drawn, 0 to 1 (absent: fully). */ alpha?: number;
  /** On a page read turned (PageLayout.turned): the picture is to be turned with it, by this many degrees clockwise (90 or 270). */
  turn?: 90 | 270;
}
/** A line across the page that belongs to no table and underlines no text. */
export interface PageRule {
  x0: number; x1: number; y: number; color?: string; width?: number;
  /** A side of a small drawn box (a square to tick): a line of the page, never the edge of a table's row or an underline. */
  side?: true;
}
export interface PageLayout {
  pageIndex: number; width: number; height: number; hasText: boolean; blocks: Block[]; pictures?: Picture[];
  /**
   * The page is a scan with its recognised text: invisible words stand over a picture, which already shows them. That
   * picture is not in `pictures` (the words are typed instead, so nothing is printed twice).
   */
  scan?: true;
  /**
   * The page's text is drawn turned (a wide table set along the page): it was read as the page turned so that the
   * text is upright. 90: the text read from the bottom up; 270: from the top down. `width` and `height` and every
   * place in the layout are those of the turned page.
   */
  turned?: 90 | 270;
  /** Lines across the page that are no table's and underline no text. */
  rules?: PageRule[];
  /** Lines down the page that are no table's (a line between two columns, the sides of a frame), as thin boxes. */
  uprights?: (Box & { color: string })[];
  /** Filled boxes that are no table cell's shading (a coloured band, the ground of a boxed note). */
  fills?: (Box & { color: string })[];
  /** Slanted strokes that are no drawn tick or cross: lines of the page, from their first point to their last. */
  strokes?: Stroke[];
}
/** What a page draws besides words and lines (rulingLines.ts pageDrawings). */
export interface PageExtras {
  shades?: readonly (Box & { color: string })[]; pictures?: readonly (Box & { alpha?: number })[];
  /** The page's slanted strokes (rulingLines.ts): a drawn tick or cross becomes its sign, the rest stay lines of the page. */
  strokes?: readonly Stroke[];
}

export const ROW_TOLERANCE_PT = 4, COLUMN_CLUSTER_PT = 18, COLUMN_WIDEN_PT = 6, MAX_COLUMNS = 80, SCANNED_MAX_CHARS = 20;

// ---- words and lines ----------------------------------------------------------------------------------

const NON_SPACE = /\S/;
/** Letters of right-to-left scripts (as pageText.ts): a cell of them is joined right to left. */
const RIGHT_TO_LEFT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
/** Where the baseline sits in a word's box, as a share of its height from the bottom (0.25 of 1.15 em). */
const BASELINE_SHARE = 0.217;
/** How many lines back a word is compared with (lines are met top to bottom). */
const LOOK_BACK = 12;
/** A gap wider than this many font sizes ends a cell on a line (a word space is about 0.28). */
const PHRASE_GAP_EM = 0.6;
/** How near an edge must be to count as "at" a column's edge. */
const EDGE_PT = 1.5;

const boxHeight = (w: Word): number => Math.max(w.y1 - w.y0, 0.1);
/** The word's font size, or its box height when the size is missing. */
const em = (w: Word): number => (w.size > 0 ? w.size : boxHeight(w) / 1.15);
const byX = (a: Word, b: Word): number => a.x0 - b.x0 || a.y0 - b.y0;

/** The words of a cell or a line as text: left to right with a space between, right to left when most are in a right-to-left script. */
export function wordsText(words: readonly Word[]): string {
  if (words.length === 0) return '';
  const ordered = [...words].sort(byX);
  const reversed = ordered.filter((w) => RIGHT_TO_LEFT.test(w.text)).length * 2 > ordered.length;
  if (reversed) ordered.reverse();
  let out = '';
  // No space before text that touches the word before it (raised or lowered text, and what follows it).
  ordered.forEach((w, i) => {
    out += (i === 0 || (!reversed && w.glued) ? '' : ' ') + w.text;
  });
  return out;
}

/** Small text is raised or lowered when it is at most this share of the size of the word before it, ... */
const RAISED_SIZE_SHARE = 0.85;
/** ... touches it (a gap of at most this many of that word's font sizes), ... */
const GLUED_GAP_EM = 0.12;
/** ... and its baseline stands this many of those font sizes higher, or this many lower. */
const RAISED_UP_EM = 0.12;
const RAISED_DOWN_EM = 0.08;

/**
 * Marks the small text raised or lowered right after a word (Word.raised), and the words no space stands before
 * (Word.glued). Only upright words; a page set in one size has none.
 */
function markRaised(words: readonly Word[]): void {
  let small = Infinity;
  let large = 0;
  for (const w of words) {
    if (w.size <= 0 || (w.turn ?? 0) !== 0) continue;
    if (w.size < small) small = w.size;
    if (w.size > large) large = w.size;
  }
  if (!(small <= RAISED_SIZE_SHARE * large)) return;
  const base = (w: Word): number => w.y1 - BASELINE_SHARE * boxHeight(w);
  for (const line of groupLines(words.filter((w) => (w.turn ?? 0) === 0))) {
    for (let k = 1; k < line.words.length; k++) {
      const prev = line.words[k - 1];
      const w = line.words[k];
      if (prev.size <= 0 || w.size <= 0) continue;
      const gap = w.x0 - prev.x1;
      if (prev.raised) {
        // The word right after raised text, touching it, at the size and on the line of the word that text belongs to.
        const of = prev.raisedOf ?? prev.size;
        if (gap <= GLUED_GAP_EM * of && gap >= -0.5 * prev.size && Math.abs(w.size - of) <= 0.1 * of) w.glued = true;
        continue;
      }
      if (w.size > RAISED_SIZE_SHARE * prev.size || gap > GLUED_GAP_EM * prev.size || gap < -0.5 * w.size) continue;
      const up = base(prev) - base(w);
      if (up >= RAISED_UP_EM * prev.size) w.raised = 'super';
      else if (-up >= RAISED_DOWN_EM * prev.size) w.raised = 'sub';
      else continue;
      w.raisedOf = prev.size;
      w.glued = true;
    }
  }
}

/** A line's text. */
export function lineText(line: Line): string {
  return wordsText(line.words);
}

function toLine(words: Word[]): Line {
  words.sort(byX);
  let y0 = Infinity;
  let y1 = -Infinity;
  const weight = new Map<number, number>();
  let size = 0;
  let best = -1;
  for (const w of words) {
    if (w.y0 < y0) y0 = w.y0;
    if (w.y1 > y1) y1 = w.y1;
    const s = em(w);
    const total = (weight.get(s) ?? 0) + w.text.length;
    weight.set(s, total);
    if (total > best || (total === best && s > size)) {
      best = total;
      size = s;
    }
  }
  return { y0, y1, size, words };
}

/**
 * Words grouped into lines, top to bottom, each line's words left to right. Two words share a line when
 * their tops, or their baselines (a large word beside small ones), are within ROW_TOLERANCE_PT; for
 * small print the tolerance is half the word's height, so close lines stay apart. A line's `size` is the
 * font size most of its text has. Words of white space only are left out.
 */
export function groupLines(words: readonly Word[]): Line[] {
  const sorted = words.filter((w) => NON_SPACE.test(w.text)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const open: { top: number; base: number; h: number; words: Word[] }[] = [];
  for (const w of sorted) {
    const h = boxHeight(w);
    const base = w.y1 - BASELINE_SHARE * h;
    let home: (typeof open)[number] | undefined;
    for (let k = open.length - 1; k >= 0 && k >= open.length - LOOK_BACK; k--) {
      const line = open[k];
      const tol = Math.min(ROW_TOLERANCE_PT, 0.5 * Math.min(h, line.h));
      if (Math.abs(w.y0 - line.top) <= tol || Math.abs(base - line.base) <= tol) {
        home = line;
        break;
      }
    }
    if (home) home.words.push(w);
    else open.push({ top: w.y0, base, h, words: [w] });
  }
  return open.map((line) => toLine(line.words)).sort((a, b) => a.y0 - b.y0 || a.words[0].x0 - b.words[0].x0);
}

// ---- cells on a line, and the columns they show --------------------------------------------------------

/** A run of words on one line with only word spaces between them: one cell's text, as far as one line shows. */
interface Phrase { x0: number; x1: number; words: Word[] }

function phrasesOf(line: Line): Phrase[] {
  const out: Phrase[] = [];
  let cur: Phrase | null = null;
  let last: Word | null = null;
  for (const w of [...line.words].sort(byX)) {
    if (!NON_SPACE.test(w.text)) continue;
    if (cur && last && w.x0 - cur.x1 <= PHRASE_GAP_EM * Math.max(em(w), em(last))) {
      cur.words.push(w);
      if (w.x1 > cur.x1) cur.x1 = w.x1;
    } else {
      cur = { x0: w.x0, x1: w.x1, words: [w] };
      out.push(cur);
    }
    last = w;
  }
  return out;
}

/** An amount as a page shows it: digits with grouping, a sign or brackets, a currency mark, Dr or Cr. */
const AMOUNT = /^(?:₹|Rs\.?|INR)?[(+-]?\d[\d,]*(?:\.\d+)?\)?-?(?:Dr|Cr)?\.?$/i;
const looksNumeric = (words: readonly Word[]): boolean => AMOUNT.test(words.map((w) => w.text).join(''));

/** A column as the text shows it: the strip its cells take, the edge its cells end at, and how they line up. */
interface Band {
  x0: number;
  x1: number;
  /** Where most of its cells end. */
  right: number;
  /** Its cells line up on the right, as amounts do. */
  rightAligned: boolean;
  /** Two cells or more share a left edge, a right edge or a middle: the mark of a column, not of chance. */
  linedUp: boolean;
}

/** The size of the largest group of values within EDGE_PT of each other, and that group's mean. */
export function largestGroup(values: number[]): { count: number; at: number } {
  values.sort((a, b) => a - b);
  let best = { count: 0, at: 0 };
  for (let k = 0, end = 0; k < values.length; k++) {
    if (end < k) end = k;
    while (end < values.length && values[end] - values[k] <= EDGE_PT) end++;
    if (end - k > best.count) {
      let sum = 0;
      for (let i = k; i < end; i++) sum += values[i];
      best = { count: end - k, at: sum / (end - k) };
    }
  }
  return best;
}

interface Columns { bands: Band[]; phrases: Phrase[][] }

/** A column of list marks is at most this many font sizes wide, the gap after it at most this many, and this share of the lines start in it and run on. */
const MARK_WIDE_EM = 4;
const MARK_GAP_EM = 2.5;
const MARK_LINES_SHARE = 0.15;
/** How many times the cells lying across column gaps are set aside and the gaps looked for again. */
const COLUMN_PASSES = 6;

/**
 * The clear strips between columns, as [where a cell ends, where the next cell to the right starts].
 * `solid` are the cells that count as evidence, `over` the cells already known to lie across columns.
 * A strip is a gap between columns unless cells of more than half the lines lie across it.
 */
function riversOf(solid: readonly Phrase[], over: readonly Phrase[], lineCount: number): [number, number][] {
  const starts = solid.map((p) => p.x0).sort((a, b) => a - b);
  const ends = solid.map((p) => p.x1).sort((a, b) => a - b);
  const rivers: [number, number][] = [];
  // Walk the ends left to right: after each end, the next start beyond it.
  for (let i = 0, j = 0; i < ends.length; i++) {
    const e = ends[i];
    if (i + 1 < ends.length && ends[i + 1] === e) continue;
    while (j < starts.length && starts[j] <= e + 0.5) j++;
    if (j >= starts.length) break;
    const s = starts[j];
    // Another cell ends between: that later end is the one to try.
    if (i + 1 < ends.length && ends[i + 1] < s) continue;
    const mid = (e + s) / 2;
    let across = solid.length - (i + 1) - (starts.length - j);
    for (const p of over) if (p.x0 < mid && mid < p.x1) across++;
    if (across * 2 > lineCount) continue;
    rivers.push([e, s]);
  }
  return rivers;
}

/**
 * The columns a run of lines shows. Each line is cut into cells at its wide gaps. Wherever one cell
 * ends and the next cell to the right (on any line) starts, the strip between them is a gap between
 * columns (riversOf). A cell lying across such a gap (a heading over two columns, a title, a sentence
 * across the table, an amount longer than its column is wide) says nothing about where columns are: it
 * is set aside and the gaps are looked for again without it, so the place where a heading happens to end
 * does not cut a column in two. A column written with a wide space on a few lines stays one column.
 */
function columnsOf(lines: readonly Line[]): Columns {
  const phrases = lines.map(phrasesOf);
  const all = phrases.flat();
  if (all.length === 0) return { bands: [], phrases };
  let solid = all;
  const over: Phrase[] = [];
  let rivers: [number, number][] = [];
  for (let pass = 0; pass < COLUMN_PASSES; pass++) {
    rivers = riversOf(solid, over, lines.length);
    const crossing = (p: Phrase) => rivers.some(([e, s]) => p.x0 < (e + s) / 2 && (e + s) / 2 < p.x1);
    const across = solid.filter(crossing);
    if (across.length === 0) break;
    // Text first: where a heading ends inside a column of amounts, the longer amounts seem to lie across a gap
    // there, and no longer do once the heading is set aside. Amounts are set aside only when no text is left to.
    const text = across.filter((p) => !looksNumeric(p.words));
    const aside = new Set(text.length > 0 ? text : across);
    if (aside.size === solid.length) break;
    over.push(...aside);
    solid = solid.filter((p) => !aside.has(p));
  }
  // A narrow column of list marks (I., (a), A.: not numbers) with a small gap after it, when cells of other lines
  // start where the marks start and run on over that gap, is no column of its own: the marks and the captions
  // after them are one column, written with a hanging indent. Serial numbers stay a column.
  const all0 = rivers;
  rivers = all0.filter(([e, s], i) => {
    const from = i > 0 ? all0[i - 1][1] : -Infinity;
    const own = solid.filter((p) => p.x0 >= from - 0.01 && p.x1 <= e + 0.01);
    if (own.length === 0) return true;
    const size = em(own[0].words[0]);
    if (s - e > MARK_GAP_EM * size || own.some((p) => p.x1 - p.x0 > MARK_WIDE_EM * size || looksNumeric(p.words))) return true;
    const left = Math.min(...own.map((p) => p.x0));
    let running = 0;
    for (const p of over) if (p.x0 >= left - EDGE_PT && p.x0 < e && p.x1 > s + 0.5) running++;
    return running < Math.max(2, MARK_LINES_SHARE * lines.length);
  });
  let first = Infinity;
  let last = -Infinity;
  for (const p of solid) {
    if (p.x0 < first) first = p.x0;
    if (p.x1 > last) last = p.x1;
  }
  // Design section 13: starts nearer than the cluster width are one column, the width growing until at most 80 are left.
  for (let width = COLUMN_CLUSTER_PT; rivers.length + 1 > MAX_COLUMNS; width += COLUMN_WIDEN_PT) {
    const fewer: [number, number][] = [];
    let start = first;
    for (const river of rivers) {
      if (river[1] - start <= width) continue;
      fewer.push(river);
      start = river[1];
    }
    rivers = fewer;
  }
  const edges = [first, ...rivers.flat(), last];
  const bands: Band[] = [];
  for (let k = 0; k < edges.length; k += 2) {
    const x0 = edges[k];
    const x1 = edges[k + 1];
    const own = solid.filter((p) => p.x0 >= x0 - 0.01 && p.x1 <= x1 + 0.01);
    const left = largestGroup(own.map((p) => p.x0));
    const right = largestGroup(own.map((p) => p.x1));
    const middle = largestGroup(own.map((p) => (p.x0 + p.x1) / 2));
    const numeric = own.length > 0 && own.every((p) => looksNumeric(p.words));
    bands.push({
      x0,
      x1,
      right: right.count > 0 ? right.at : x1,
      rightAligned: (right.count >= 2 && right.count > left.count) || (numeric && right.count >= left.count),
      linedUp: left.count >= 2 || right.count >= 2 || middle.count >= 2,
    });
  }
  return { bands, phrases };
}

/**
 * Where each column of a run of lines starts (its leftmost text), left to right. Columns are told apart
 * by the clear strips between their cells, so a right-aligned column of amounts is one column however
 * long each amount is, and its start is where its longest amount starts. More than MAX_COLUMNS are
 * joined by clustering their starts at COLUMN_CLUSTER_PT, widened by COLUMN_WIDEN_PT at a time.
 */
export function columnStarts(lines: readonly Line[]): number[] {
  return columnsOf(lines).bands.map((band) => band.x0);
}

/** The index of the last value of `starts` that is at most `x`, or 0. */
function lastAtMost(starts: readonly number[], x: number): number {
  let k = 0;
  for (let i = 1; i < starts.length && starts[i] <= x; i++) k = i;
  return k;
}

/** The band a cell belongs to: by the edge it sits at (the right edge first for an amount), else the one it mostly lies in. */
function bandOf(bands: readonly Band[], x0: number, x1: number, numeric: boolean): number {
  const starts = bands.map((b) => b.x0);
  let leftAt = -1;
  let rightAt = -1;
  for (let i = 0; i < bands.length; i++) {
    if (leftAt < 0 && Math.abs(x0 - bands[i].x0) <= EDGE_PT) leftAt = i;
    if (bands[i].rightAligned && Math.abs(x1 - bands[i].right) <= EDGE_PT) rightAt = i;
  }
  if (numeric && rightAt >= 0) return rightAt;
  if (leftAt >= 0) return leftAt;
  if (rightAt >= 0) return rightAt;
  let best = lastAtMost(starts, x0 + EDGE_PT);
  let most = -Infinity;
  for (let i = best; i < bands.length && bands[i].x0 < x1; i++) {
    const end = i + 1 < bands.length ? bands[i + 1].x0 : Infinity;
    const overlap = Math.min(x1, end) - Math.max(x0, i === 0 ? -Infinity : bands[i].x0);
    if (overlap > most) {
      most = overlap;
      best = i;
    }
  }
  return best;
}

/**
 * A cell run that holds two cells standing close together is cut: before a word that starts exactly
 * where a later column starts, or before the amount at its end when that amount ends exactly at the
 * right edge of a later, right-aligned column.
 */
function cutAtColumns(p: Phrase, bands: readonly Band[]): Phrase[] {
  if (p.words.length < 2 || bands.length < 2) return [p];
  const home = bandOf(bands, p.x0, p.words[0].x1, false);
  const cuts = new Set<number>();
  for (let j = 1; j < p.words.length; j++) {
    const at = bands.findIndex((b, i) => i > home && !b.rightAligned && Math.abs(p.words[j].x0 - b.x0) <= EDGE_PT);
    if (at >= 0) cuts.add(j);
  }
  const last = p.words[p.words.length - 1];
  const edge = bands.findIndex((b, i) => i > home && b.rightAligned && Math.abs(last.x1 - b.right) <= EDGE_PT);
  if (edge >= 0) {
    // The shortest run of words at the end that reads as an amount (a number in the narration before it is
    // not drawn into it), with a currency mark or an opening bracket standing just before it.
    for (let j = p.words.length - 1; j >= 1 && j >= p.words.length - 3; j--) {
      if (!looksNumeric(p.words.slice(j))) continue;
      cuts.add(j > 1 && /^(?:₹|Rs\.?|INR|\(|-)$/i.test(p.words[j - 1].text) ? j - 1 : j);
      break;
    }
  }
  if (cuts.size === 0) return [p];
  const out: Phrase[] = [];
  p.words.forEach((w, j) => {
    if (j === 0 || cuts.has(j)) out.push({ x0: w.x0, x1: w.x1, words: [w] });
    else {
      const cur = out[out.length - 1];
      cur.words.push(w);
      cur.x1 = Math.max(cur.x1, w.x1);
    }
  });
  return out;
}

const cell = (words: Word[]): Cell => ({ text: wordsText(words), words: [...words].sort(byX) });

/**
 * A table from lines of text: one row per line, one cell per column, empty cells included. Without
 * `columns` the columns are the ones the lines show (columnStarts). With `columns` (the starts of
 * another page's table, to carry its columns on) each column the lines show is put into the given
 * column it belongs to: by its right edge when its cells line up on the right, as amounts do, else by
 * its middle; so an amount longer than any on the other page still lands in its own column.
 */
export function gridFromLines(lines: readonly Line[], columns?: readonly number[]): Table {
  return buildGrid(lines, columns).table;
}

function buildGrid(lines: readonly Line[], columns?: readonly number[]): { table: Table; bands: Band[] } {
  const kept = lines.filter((line) => line.words.some((w) => NON_SPACE.test(w.text)));
  const { bands, phrases } = columnsOf(kept);
  const given = columns && columns.length > 0 ? [...columns].sort((a, b) => a - b) : null;
  const starts = given ?? bands.map((b) => b.x0);
  const target = bands.map((band, i) => {
    if (!given) return i;
    return band.rightAligned ? lastAtMost(given, band.right - 1) : lastAtMost(given, (band.x0 + band.x1) / 2);
  });
  const width = starts.length;
  const rows = kept.map((_, r) => {
    const cells: Word[][] = Array.from({ length: width }, () => []);
    for (const whole of phrases[r]) {
      for (const p of cutAtColumns(whole, bands)) {
        const at = target[bandOf(bands, p.x0, p.x1, looksNumeric(p.words))] ?? 0;
        (cells[at] ?? cells[0])?.push(...p.words);
      }
    }
    return cells.map(cell);
  });
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const line of kept) {
    if (line.y0 < y0) y0 = line.y0;
    if (line.y1 > y1) y1 = line.y1;
  }
  return { table: { source: 'aligned', y0: kept.length ? y0 : 0, y1: kept.length ? y1 : 0, columns: starts, rows: kept.length ? rows : [] }, bands };
}

// ---- tables drawn with lines ---------------------------------------------------------------------------

/** Lines nearer than this are one line (a double rule, the two sides of a thin drawn box). */
const SNAP_PT = 3;
/** A line shorter than this after joining is not a table line. */
const MIN_RULE_PT = 6;
/** Past these, a page's lines are a drawing, not a table: no ruled table is looked for. */
const MAX_SEGMENTS = 20_000;
const MAX_CROSSINGS = 2_000_000;
const MAX_CELLS = 40_000;

interface Rule { at: number; from: number; to: number; color?: string; width?: number }

/** Lines running one way (`at` is the coordinate they share), joined where they continue each other. */
function joinRules(raw: Rule[]): Rule[] {
  raw.sort((a, b) => a.at - b.at || a.from - b.from);
  const out: Rule[] = [];
  let k = 0;
  while (k < raw.length) {
    let end = k;
    let sum = 0;
    while (end < raw.length && raw[end].at - raw[k].at <= SNAP_PT) sum += raw[end++].at;
    const at = sum / (end - k);
    const group = raw.slice(k, end).sort((a, b) => a.from - b.from);
    let cur: Rule | null = null;
    for (const r of group) {
      if (cur && r.from <= cur.to + SNAP_PT) cur.to = Math.max(cur.to, r.to);
      else {
        cur = { at, from: r.from, to: r.to, color: r.color, width: r.width };
        out.push(cur);
      }
    }
    k = end;
  }
  return out.filter((r) => r.to - r.from >= MIN_RULE_PT);
}

/** Sorted values with those nearer than SNAP_PT joined (their mean). */
function distinct(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  let k = 0;
  while (k < values.length) {
    let end = k;
    let sum = 0;
    while (end < values.length && values[end] - values[k] <= SNAP_PT) sum += values[end++];
    out.push(sum / (end - k));
    k = end;
  }
  return out;
}

/** The index i with edges[i] <= v < edges[i + 1], or -1 outside (1 pt of grace at the outer edges). */
function bandIndex(edges: readonly number[], v: number): number {
  const n = edges.length - 1;
  if (v < edges[0] - 1 || v > edges[n] + 1) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Found { table: Table; x0: number; x1: number; used: Set<Word>; h: Rule[]; v: Rule[] }
/** A drawn grid is only a box round part of a wider table when it has this many lines of text and this share of them run on outside it. */
const PART_MIN_LINES = 3;
const PART_RUN_ON_SHARE = 0.8;

/** How a word reads: its `turn` when the reader gave one, else 0, or -1 when its box is far taller than its print. */
const turnOf = (w: Word): number => (w.turn !== undefined ? w.turn : isTurnedBox(w) ? -1 : 0);

/**
 * The lines of words that read up or down the page, in reading order: for 90 (bottom to top) the lines run
 * left to right across the page and each reads from its lowest word up; for 270 the other way round.
 */
function turnedLines(words: readonly Word[], turn: number): Line[] {
  const back = new Map<Word, Word>();
  const upright = words.map((w) => {
    const v: Word = turn === 90 ? { ...w, x0: -w.y1, x1: -w.y0, y0: w.x0, y1: w.x1 } : { ...w, x0: w.y0, x1: w.y1, y0: -w.x1, y1: -w.x0 };
    back.set(v, w);
    return v;
  });
  return groupLines(upright).map((line) => ({ y0: line.y0, y1: line.y1, size: line.size, words: line.words.map((v) => back.get(v)!), turn }));
}

/** A share of this of a cell's side must have a line for the side to count as drawn. */
const SIDE_SHARE = 0.5;
/** A filled box must cover this share of a cell to be its shading. */
const SHADE_SHARE = 0.7;

interface GridInput {
  h: Rule[]; v: Rule[]; xs: number[]; ys: number[];
  /** Per row band: the y values that cut it into rows of text where no line does (only the columns are drawn). */
  cuts: number[][];
  words: readonly Word[];
  shades: readonly (Box & { color: string })[];
}

/**
 * The true cells of a ruled grid (see Grid): squares with no line between them are one cell. A band that only
 * its columns rule is cut into rows of text (`cuts`) only when it really reads as rows: two cells or more hold
 * several lines, and most of the band's lines of text have words in two cells or more.
 */
function trueCells(input: GridInput): { grid: Grid; used: Set<Word> } {
  const first = cellsOnce({ ...input, cuts: input.ys.map(() => []) });
  if (!input.cuts.some((c) => c.length > 0)) return first;
  const keep = input.cuts.map((cut, r) => {
    if (cut.length === 0) return [];
    const inBand = first.grid.cells.filter((c) => c.row === r && c.rowSpan === 1 && c.turn === 0 && c.words.length > 0);
    if (inBand.filter((c) => c.lines.length >= 2).length < 2) return [];
    const cellOf = new Map<Word, GridCell>();
    for (const c of inBand) for (const w of c.words) cellOf.set(w, c);
    const lines = groupLines(inBand.flatMap((c) => c.words));
    const shared = lines.filter((line) => new Set(line.words.map((w) => cellOf.get(w))).size >= 2).length;
    return shared >= 0.6 * lines.length ? cut : [];
  });
  return keep.some((c) => c.length > 0) ? cellsOnce({ ...input, cuts: keep }) : first;
}

function cellsOnce(input: GridInput): { grid: Grid; used: Set<Word> } {
  const { h, v, xs } = input;
  // Rows: the drawn ones, and the cuts inside a band that only its columns rule.
  const ys: number[] = [];
  const soft: boolean[] = [];
  input.ys.forEach((y, r) => {
    ys.push(y);
    soft.push(false);
    for (const cut of input.cuts[r] ?? []) {
      ys.push(cut);
      soft.push(true);
    }
  });
  const R = ys.length - 1;
  const C = xs.length - 1;
  const vLine = (r: number, c: number): Rule | undefined => {
    const need = SIDE_SHARE * (ys[r + 1] - ys[r]);
    return v.find((l) => Math.abs(l.at - xs[c]) <= SNAP_PT && Math.min(l.to, ys[r + 1]) - Math.max(l.from, ys[r]) >= need);
  };
  const hLine = (r: number, c: number): Rule | undefined => {
    if (soft[r]) return undefined;
    const need = SIDE_SHARE * (xs[c + 1] - xs[c]);
    return h.find((l) => Math.abs(l.at - ys[r]) <= SNAP_PT && Math.min(l.to, xs[c + 1]) - Math.max(l.from, xs[c]) >= need);
  };
  const vAt: (Rule | undefined)[] = [];
  const hAt: (Rule | undefined)[] = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
    vAt.push(r < R ? vLine(r, c) : undefined);
    hAt.push(c < C ? hLine(r, c) : undefined);
  }
  const vOf = (r: number, c: number) => vAt[r * (C + 1) + c];
  const hOf = (r: number, c: number) => hAt[r * (C + 1) + c];

  // Each word in the square its middle lies in.
  const inSquare: Word[][] = Array.from({ length: R * C }, () => []);
  const used = new Set<Word>();
  for (const w of input.words) {
    const c = bandIndex(xs, (w.x0 + w.x1) / 2);
    const r = bandIndex(ys, (w.y0 + w.y1) / 2);
    if (c < 0 || r < 0) continue;
    inSquare[r * C + c].push(w);
    used.add(w);
  }
  // A row with no line between any of its squares whose text is set out in the grid's columns (each run of
  // words inside one column, in two columns or more) keeps its columns: a heading row boxed as one.
  const columnar: boolean[] = [];
  for (let r = 0; r < R; r++) {
    let open = true;
    for (let c = 1; c < C && open; c++) if (vOf(r, c)) open = false;
    const rowWords = open ? inSquare.slice(r * C, (r + 1) * C).flat().filter((w) => turnOf(w) === 0) : [];
    let ok = rowWords.length >= 2;
    const seen = new Set<number>();
    if (ok) {
      for (const line of groupLines(rowWords)) {
        for (const p of phrasesOf(line)) {
          const a = bandIndex(xs, p.x0 + 1);
          const b = bandIndex(xs, p.x1 - 1);
          if (a !== b) ok = false;
          seen.add(a);
        }
      }
    }
    columnar.push(ok && seen.size >= 2);
  }
  const parent = Array.from({ length: R * C }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (c > 0 && !vOf(r, c) && !columnar[r]) parent[find(r * C + c)] = find(r * C + c - 1);
    if (r > 0 && !soft[r] && !hOf(r, c) && !columnar[r] && !columnar[r - 1]) parent[find(r * C + c)] = find((r - 1) * C + c);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < R * C; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }
  const side = (lines: (Rule | undefined)[]): Border | null => {
    const drawn = lines.filter((l): l is Rule => l !== undefined);
    if (drawn.length === 0 || drawn.length < SIDE_SHARE * lines.length) return null;
    return { color: drawn[0].color ?? '000000', width: drawn[0].width ?? 0.5 };
  };
  const range = (from: number, n: number) => Array.from({ length: n }, (_, k) => from + k);
  const cells: GridCell[] = [];
  const add = (r0: number, c0: number, rs: number, cs: number, squares: number[]) => {
    const words = squares.flatMap((i) => inSquare[i]);
    const upright = words.filter((w) => turnOf(w) === 0);
    const up = words.filter((w) => turnOf(w) === 90);
    const down = words.filter((w) => turnOf(w) === 270);
    const turn: 0 | 90 | 270 = up.length > upright.length && up.length >= down.length ? 90 : down.length > upright.length ? 270 : 0;
    const lines = turn === 0 ? [...groupLines(upright), ...turnedLines(up, 90), ...turnedLines(down, 270)] : [...turnedLines(turn === 90 ? up : down, turn), ...groupLines(upright), ...turnedLines(turn === 90 ? down : up, turn === 90 ? 270 : 90)];
    const box = { x0: xs[c0], y0: ys[r0], x1: xs[c0 + cs], y1: ys[r0 + rs] };
    let shade: string | undefined;
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    for (const sh of input.shades) {
      const w = Math.min(sh.x1, box.x1) - Math.max(sh.x0, box.x0);
      const hh = Math.min(sh.y1, box.y1) - Math.max(sh.y0, box.y0);
      if (w > 0 && hh > 0 && w * hh >= SHADE_SHARE * area) shade = sh.color === 'FFFFFF' ? undefined : sh.color;
    }
    cells.push({
      row: r0, col: c0, rowSpan: rs, colSpan: cs, ...box,
      text: lines.map((l) => (l.turn !== undefined ? l.words.map((w) => w.text).join(' ') : lineText(l))).join(' '), words: lines.flatMap((l) => l.words), lines, turn,
      borders: {
        top: side(range(c0, cs).map((c) => hOf(r0, c))),
        bottom: side(range(c0, cs).map((c) => hOf(r0 + rs, c))),
        left: side(range(r0, rs).map((r) => vOf(r, c0))),
        right: side(range(r0, rs).map((r) => vOf(r, c0 + cs))),
      },
      ...(shade ? { shade } : {}),
    });
  };
  for (const squares of groups.values()) {
    let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1;
    for (const i of squares) {
      const r = Math.floor(i / C);
      const c = i % C;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
    }
    // Squares joined in a shape that is not a rectangle stay single cells (no line is drawn between them).
    if ((r1 - r0 + 1) * (c1 - c0 + 1) === squares.length) add(r0, c0, r1 - r0 + 1, c1 - c0 + 1, squares);
    else for (const i of squares) add(Math.floor(i / C), i % C, 1, 1, [i]);
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return { grid: { xs, ys, cells }, used };
}

function findRuled(page: PageWords, segments: readonly Segment[], extras: PageExtras = {}): Found[] {
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return [];
  const hRaw: Rule[] = [];
  const vRaw: Rule[] = [];
  for (const s of segments) {
    const dx = Math.abs(s.x1 - s.x0);
    const dy = Math.abs(s.y1 - s.y0);
    if (!Number.isFinite(dx + dy)) continue;
    if (dy <= 1 && dx > dy) hRaw.push({ at: (s.y0 + s.y1) / 2, from: Math.min(s.x0, s.x1), to: Math.max(s.x0, s.x1), color: s.color, width: s.width });
    else if (dx <= 1 && dy > dx) vRaw.push({ at: (s.x0 + s.x1) / 2, from: Math.min(s.y0, s.y1), to: Math.max(s.y0, s.y1), color: s.color, width: s.width });
  }
  const H = joinRules(hRaw);
  const V = joinRules(vRaw);
  if (H.length === 0 || V.length === 0 || H.length + V.length < 3 || H.length * V.length > MAX_CROSSINGS) return [];

  // Lines that meet belong to one table.
  const parent = Array.from({ length: H.length + V.length }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  H.forEach((h, i) => {
    V.forEach((v, j) => {
      if (v.at >= h.from - SNAP_PT && v.at <= h.to + SNAP_PT && h.at >= v.from - SNAP_PT && h.at <= v.to + SNAP_PT) parent[find(i)] = find(H.length + j);
    });
  });
  const groups = new Map<number, { h: Rule[]; v: Rule[] }>();
  const groupOf = (i: number) => {
    const root = find(i);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = { h: [], v: [] }));
    return g;
  };
  H.forEach((h, i) => groupOf(i).h.push(h));
  V.forEach((v, j) => groupOf(H.length + j).v.push(v));

  const every = page.words.filter((w) => NON_SPACE.test(w.text) && [0, 90, 270].includes(turnOf(w)));
  const words = every.filter((w) => turnOf(w) === 0);
  const found: Found[] = [];
  let pageLines: Line[] | undefined;
  for (const g of groups.values()) {
    if (g.h.length + g.v.length < 3 || g.h.length === 0 || g.v.length === 0) continue;
    // The grid's edges: every line, and where the lines of the other direction end (a table with no outer border).
    const xs = distinct([...g.v.map((v) => v.at), Math.min(...g.h.map((h) => h.from)), Math.max(...g.h.map((h) => h.to))]);
    const ys = distinct([...g.h.map((h) => h.at), Math.min(...g.v.map((v) => v.from)), Math.max(...g.v.map((v) => v.to))]);
    const cols = xs.length - 1;
    const bandsY = ys.length - 1;
    if (cols < 2 || bandsY < 1 || cols > MAX_COLUMNS || cols * bandsY > MAX_CELLS) continue;

    // Whether a line stands between two neighbouring cells; where none does, the cells are one (a merged cell).
    const wallLeft = (r: number, c: number): boolean => {
      if (c === 0) return true;
      const need = 0.5 * (ys[r + 1] - ys[r]);
      return g.v.some((v) => Math.abs(v.at - xs[c]) <= SNAP_PT && Math.min(v.to, ys[r + 1]) - Math.max(v.from, ys[r]) >= need);
    };
    const wallAbove = (r: number, c: number): boolean => {
      if (r === 0) return true;
      const need = 0.5 * (xs[c + 1] - xs[c]);
      return g.h.some((h) => Math.abs(h.at - ys[r]) <= SNAP_PT && Math.min(h.to, xs[c + 1]) - Math.max(h.from, xs[c]) >= need);
    };
    const leftMemo = new Map<number, boolean>();
    const aboveMemo = new Map<number, boolean>();
    const memo = (store: Map<number, boolean>, ask: (r: number, c: number) => boolean, r: number, c: number): boolean => {
      const key = r * (cols + 1) + c;
      let v = store.get(key);
      if (v === undefined) store.set(key, (v = ask(r, c)));
      return v;
    };

    const grid: Word[][][] = Array.from({ length: bandsY }, () => Array.from({ length: cols }, () => []));
    const used = new Set<Word>();
    const filled = new Set<number>();
    // Each word by where its middle lies.
    const placed: { w: Word; r: number; c: number }[] = [];
    const byRow: Word[][] = Array.from({ length: bandsY }, () => []);
    for (const w of words) {
      const c = bandIndex(xs, (w.x0 + w.x1) / 2);
      const r = bandIndex(ys, (w.y0 + w.y1) / 2);
      if (c < 0 || r < 0) continue;
      placed.push({ w, r, c });
      byRow[r].push(w);
    }
    // A row with no line between any of its cells is one merged cell (a title across the table), unless its
    // text is set out in columns all the same (only the heading row is boxed): then every word stays in the
    // column it stands in, and no amount is drawn into the first cell.
    const unboxed = byRow.map((rowWords, r) => {
      if (rowWords.length < 2) return false;
      for (let c = 1; c < cols; c++) if (memo(leftMemo, wallLeft, r, c)) return false;
      return groupLines(rowWords).some((line) => {
        const cells = phrasesOf(line);
        const first = cells.length ? bandIndex(xs, (cells[0].x0 + cells[0].x1) / 2) : -1;
        return cells.some((p) => bandIndex(xs, (p.x0 + p.x1) / 2) !== first);
      });
    });
    for (const place of placed) {
      let { r, c } = place;
      // A merged cell's text belongs to its first cell: up and to the left while no line stands in the way.
      for (let moved = !unboxed[r], guard = 0; moved && guard < cols + bandsY; guard++) {
        moved = false;
        while (c > 0 && !unboxed[r] && !memo(leftMemo, wallLeft, r, c)) {
          c--;
          moved = true;
        }
        while (r > 0 && !unboxed[r] && !memo(aboveMemo, wallAbove, r, c)) {
          r--;
          moved = true;
        }
      }
      grid[r][c].push(place.w);
      used.add(place.w);
      filled.add(r * cols + c);
    }
    // A frame with nothing in it, or with everything in one cell, is a box round text, not a table.
    if (filled.size < 2) continue;
    // One box holding two columns of amounts of its own (three rows or more each): the lines are a frame round a
    // statement set out by its text, not its cells. It is left to the reading by how the text lines up.
    let frameOnly = false;
    for (const row of grid) {
      for (const cellWords of row) {
        if (frameOnly || cellWords.length < 6) continue;
        const inner = columnsOf(groupLines(cellWords));
        let amountColumns = 0;
        for (const band of inner.bands) {
          if (!band.rightAligned) continue;
          let n = 0;
          for (const list of inner.phrases) for (const p of list) if (p.x0 >= band.x0 - 0.01 && p.x1 <= band.x1 + 0.01 && looksNumeric(p.words)) n++;
          if (n >= 3) amountColumns++;
        }
        if (amountColumns >= 2) frameOnly = true;
      }
    }
    if (frameOnly) continue;
    // A box drawn round some columns of a wider table: nearly all its lines of text run on outside it on the same
    // lines, and most of its lines across go on outside it at the same heights (the wider table's own row lines,
    // drawn in pieces). The wider table is read by how its text lines up; these lines stay lines of the page.
    {
      const inBox = (w: Word) => (w.x0 + w.x1) / 2 > xs[0] - 1 && (w.x0 + w.x1) / 2 < xs[cols] + 1;
      let own = 0;
      let runOn = 0;
      for (const line of (pageLines ??= groupLines(words))) {
        const mid = (line.y0 + line.y1) / 2;
        if (mid < ys[0] || mid > ys[bandsY] || !line.words.some(inBox)) continue;
        own++;
        if (line.words.some((w) => !inBox(w))) runOn++;
      }
      const goOn = g.h.filter((l) => H.some((o) => !g.h.includes(o) && Math.abs(o.at - l.at) <= EDGE_PT && (o.to <= xs[0] + SNAP_PT || o.from >= xs[cols] - SNAP_PT))).length;
      if (own >= PART_MIN_LINES && runOn >= PART_RUN_ON_SHARE * own && goOn * 2 > g.h.length) continue;
    }

    const rows: Cell[][] = [];
    const cuts: number[][] = ys.map(() => []);
    grid.forEach((row, r) => {
      const all = row.flat();
      if (all.length === 0) {
        if (ys[r + 1] - ys[r] >= MIN_RULE_PT) rows.push(row.map(() => cell([])));
        return;
      }
      // Rows not ruled off from each other (only the columns are drawn): one row per line of text.
      const linesIn = row.map((cellWords) => (cellWords.length > 1 ? groupLines(cellWords).length : cellWords.length));
      if (Math.max(...linesIn) >= 3 && linesIn.filter((n) => n >= 2).length >= 2) {
        const columnOf = new Map<Word, number>();
        row.forEach((cellWords, c) => cellWords.forEach((w) => columnOf.set(w, c)));
        let above: Line | null = null;
        for (const line of groupLines(all)) {
          if (above && line.y0 > above.y1 - 0.5) {
            const cut = (above.y1 + line.y0) / 2;
            if (cut > ys[r] + 1 && cut < ys[r + 1] - 1 && cut > (cuts[r][cuts[r].length - 1] ?? -Infinity) + 1) cuts[r].push(cut);
          }
          above = line;
          const cells: Word[][] = row.map(() => []);
          for (const w of line.words) cells[columnOf.get(w) ?? 0].push(w);
          rows.push(cells.map(cell));
        }
        return;
      }
      rows.push(
        row.map((cellWords) => {
          // A cell's lines top to bottom, joined by a space.
          const lines = cellWords.length > 1 ? groupLines(cellWords) : [];
          return lines.length > 1 ? { text: lines.map(lineText).join(' '), words: lines.flatMap((line) => line.words) } : cell(cellWords);
        }),
      );
    });
    const inside = (w: Word) => bandIndex(xs, (w.x0 + w.x1) / 2) >= 0 && bandIndex(ys, (w.y0 + w.y1) / 2) >= 0;
    const shades = (extras.shades ?? []).filter((sh) => sh.x1 > xs[0] && sh.x0 < xs[cols] && sh.y1 > ys[0] && sh.y0 < ys[bandsY]);
    const real = trueCells({ h: g.h, v: g.v, xs, ys, cuts, words: every.filter(inside), shades });
    for (const w of real.used) used.add(w);
    found.push({ table: { source: 'ruled', y0: ys[0], y1: ys[ys.length - 1], columns: xs.slice(0, cols), rows, grid: real.grid }, x0: xs[0], x1: xs[cols], used, h: g.h, v: g.v });
  }
  return found.sort((a, b) => a.table.y0 - b.table.y0 || a.x0 - b.x0);
}

/**
 * The tables a page draws with lines, top to bottom. Lines that meet form one grid; a table needs two
 * columns or more and text in two cells or more (a box round a paragraph, an underline, a page border
 * are not tables). Where no line stands between two cells they are one merged cell, and its text is
 * given to its first (top-left) cell, the others staying empty. Where only the columns are drawn and a
 * row holds several lines of text in several cells, each line of text is a row. `columns` holds each
 * column's left edge. A grid of one column (only its rows ruled off) is left to the aligned reading.
 */
export function ruledTables(page: PageWords, segments: readonly Segment[]): Table[] {
  return findRuled(page, segments).map((f) => f.table);
}

// ---- the page ------------------------------------------------------------------------------------------

/** Rows of a table whose baselines are nearer than this many font sizes stand side by side: they are one row. */
const SAME_ROW_EM = 0.75;
/** A rule or a shaded box's edge within this of the gap between two rows is their boundary. */
const ROW_EDGE_PT = 1.5;

/**
 * The grid of a table shown only by how its text lines up: its columns from where each starts to where the
 * next starts, its rows the lines of text (lines standing side by side, as a date centred beside two lines
 * of narration, are one row). The lines the page draws across it are the lines under and over its rows, and
 * its filled boxes stay boxes of the page (`shaded` says it has some); a cell whose text runs on over the empty cells after it lies
 * over them. Returns the rules it took as its own.
 */
function alignedGrid(table: Table, rules: readonly PageRule[], shades: readonly (Box & { color: string })[]): { grid: Grid; taken: Set<PageRule>; drawn: TableDrawn } | null {
  const source = table.rows.filter((row) => row.some((c) => c.words.length > 0));
  const C = table.columns.length;
  if (source.length === 0 || C === 0) return null;
  // Rows that stand side by side are one.
  const merged: { cells: Word[][]; base: number; size: number; y0: number; y1: number }[] = [];
  for (const row of source) {
    const words = row.flatMap((c) => c.words);
    let base = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const w of words) {
      base = Math.max(base, w.y1 - BASELINE_SHARE * boxHeight(w));
      y0 = Math.min(y0, w.y0);
      y1 = Math.max(y1, w.y1);
    }
    const size = words[0].size > 0 ? words[0].size : boxHeight(words[0]);
    const last = merged[merged.length - 1];
    if (last && base - last.base < SAME_ROW_EM * Math.min(size, last.size)) {
      for (let c = 0; c < C; c++) last.cells[c].push(...(row[c]?.words ?? []));
      last.base = base;
      last.y0 = Math.min(last.y0, y0);
      last.y1 = Math.max(last.y1, y1);
    } else merged.push({ cells: Array.from({ length: C }, (_, c) => [...(row[c]?.words ?? [])]), base, size, y0, y1 });
  }
  const R = merged.length;
  let right = -Infinity;
  for (const row of merged) for (const cell of row.cells) for (const w of cell) right = Math.max(right, w.x1);
  const top = merged[0].y0;
  const bottom = merged[R - 1].y1;
  const pitch = R > 1 ? (merged[R - 1].base - merged[0].base) / (R - 1) : merged[0].size * 1.4;
  // What the page draws on the table: rules (a line under one column's total too) and filled boxes that lie on its rows.
  // A rule that is no row's edge stays a rule of the page.
  const wide = right - table.columns[0];
  const near = (y: number) => y > top - pitch && y < bottom + pitch;
  const lines = rules.filter((r) => !r.side && near(r.y) && r.x1 - r.x0 >= MIN_RULE_PT && r.x1 > table.columns[0] && r.x0 < right);
  const fills = shades.filter((s) => s.color !== 'FFFFFF' && s.y1 > top - 1 && s.y0 < bottom + 1 && s.x1 > table.columns[0] && s.x0 < right && s.x1 - s.x0 < wide + 80 && s.y1 - s.y0 < bottom - top + 2 * pitch);
  let x0 = table.columns[0];
  let x1 = right + 1;
  for (const b of [...lines, ...fills]) {
    if (b.x0 < x0 && b.x0 > x0 - 40) x0 = b.x0;
    if (b.x1 > x1 && b.x1 < x1 + 40) x1 = b.x1;
  }
  const xs = [x0, ...table.columns.slice(1), x1];
  for (let c = 1; c < xs.length; c++) if (!(xs[c] > xs[c - 1])) return null;
  // Row boundaries: a rule or a fill's edge in the gap between two rows, else the middle of the gap.
  const edges = [...lines.map((r) => r.y), ...fills.flatMap((s) => [s.y0, s.y1])];
  const between = (a: number, b: number, fallback: number): number => {
    let best: number | null = null;
    for (const y of edges) if (y >= a - ROW_EDGE_PT && y <= b + ROW_EDGE_PT && (best === null || Math.abs(y - (a + b) / 2) < Math.abs(best - (a + b) / 2))) best = y;
    return best ?? fallback;
  };
  const ys = [between(top - 0.6 * pitch, top, top - 1)];
  for (let r = 1; r < R; r++) ys.push(Math.max(ys[r - 1] + 0.5, between(merged[r - 1].y1, merged[r].y0, (merged[r - 1].y1 + merged[r].y0) / 2)));
  ys.push(Math.max(ys[R - 1] + 0.5, between(bottom, bottom + 0.6 * pitch, bottom + 1)));
  const taken = new Set<PageRule>();
  const ruleAt = (y: number, a: number, b: number): Border | null => {
    for (const r of lines) {
      if (Math.abs(r.y - y) > ROW_EDGE_PT || Math.min(r.x1, b) - Math.max(r.x0, a) < SIDE_SHARE * (b - a)) continue;
      taken.add(r);
      return { color: r.color ?? '000000', width: r.width ?? 0.5 };
    }
    return null;
  };
  // Each cell's own edges: text that runs on over the empty cells after it lies over them, and text that runs
  // into the column of a cell that is not empty ends half-way to that cell's text (the grid gets an edge there).
  const placed: { r: number; left: number; right: number; words: Word[] }[] = [];
  merged.forEach((row, r) => {
    let left = xs[0];
    for (let c = 0; c < C; c++) {
      const words = row.cells[c];
      let span = 1;
      const end = words.length ? Math.max(...words.map((w) => w.x1)) : -Infinity;
      while (c + span < C && end > xs[c + span] - 0.5 && row.cells[c + span].length === 0) span++;
      let edge = xs[c + span];
      const next = c + span < C ? row.cells[c + span] : [];
      if (next.length > 0) {
        const start = Math.min(...next.map((w) => w.x0));
        if (end > edge - 0.5) {
          if (start > end + 1) edge = (end + start) / 2;
        } else if (start < edge - 0.5) {
          // The next cell's text starts before its column does (an amount longer than its column is wide): the edge
          // gives way to it, half-way back to this cell's text, or to just before it when this cell is empty.
          edge = Number.isFinite(end) ? (end + start) / 2 : Math.max(left + 0.5, start - 1);
        }
      }
      placed.push({ r, left, right: edge, words });
      left = edge;
      c += span - 1;
    }
  });
  const all = distinct(placed.flatMap((p) => [p.left, p.right]));
  const at = (x: number): number => {
    let best = 0;
    for (let i = 1; i < all.length; i++) if (Math.abs(all[i] - x) < Math.abs(all[best] - x)) best = i;
    return best;
  };
  const cells: GridCell[] = [];
  for (const p of placed) {
    {
      const r = p.r;
      const c = at(p.left);
      const span = Math.max(1, at(p.right) - c);
      const words = p.words;
      const box = { x0: all[c], y0: ys[r], x1: all[c + span], y1: ys[r + 1] };
      const cellLines = groupLines(words);
      cells.push({
        row: r, col: c, rowSpan: 1, colSpan: span, ...box,
        text: cellLines.map(lineText).join(' '), words: cellLines.flatMap((l) => l.words), lines: cellLines, turn: 0,
        borders: { top: ruleAt(ys[r], box.x0, box.x1), right: null, bottom: ruleAt(ys[r + 1], box.x0, box.x1), left: null },
      });
    }
  }
  // Its filled boxes stay boxes of the page (PageLayout.fills): they need not lie on its cells.
  return { grid: { xs: all, ys, cells, ...(fills.length > 0 ? { shaded: true } : {}) }, taken, drawn: { rules: lines, fills } };
}

/** A word drawn turned on the page (up the margin, a slanted watermark): its box is far taller than its print. */
const isTurnedBox = (w: Word): boolean => w.size > 0 && w.y1 - w.y0 > 2.2 * w.size;
const isTurned = (w: Word): boolean => turnOf(w) !== 0;

/** Words of one turned line further apart than this many font sizes are pieces of their own (two labels up one margin). */
const TURNED_PIECE_EM = 2;
/** A small drawn box (a square to tick) is at most this many points a side, and at least BOX_MIN_PT. */
const BOX_MAX_PT = 24;
const BOX_MIN_PT = 3;

/**
 * The lines that are the four sides of a small drawn box: a line across, another of the same length straight under
 * it, and a line down at each end joining the two.
 */
function boxSides(segments: readonly Segment[]): Set<Segment> {
  const sides = new Set<Segment>();
  const small = (n: number) => n >= BOX_MIN_PT && n <= BOX_MAX_PT;
  const across = segments.filter((q) => Math.abs(q.y1 - q.y0) <= 1 && small(q.x1 - q.x0));
  const down = segments.filter((q) => Math.abs(q.x1 - q.x0) <= 1 && small(q.y1 - q.y0));
  if (across.length < 2 || down.length < 2 || across.length > MAX_BOX_LINES || down.length > MAX_BOX_LINES) return sides;
  const byLeft = new Map<number, Segment[]>();
  for (const h of across) {
    const key = Math.round(h.x0);
    const list = byLeft.get(key);
    if (list) list.push(h);
    else byLeft.set(key, [h]);
  }
  const byX = new Map<number, Segment[]>();
  for (const v of down) {
    const key = Math.round((v.x0 + v.x1) / 2);
    const list = byX.get(key);
    if (list) list.push(v);
    else byX.set(key, [v]);
  }
  const near = <T,>(map: Map<number, T[]>, at: number): T[] => [...(map.get(Math.round(at) - 1) ?? []), ...(map.get(Math.round(at)) ?? []), ...(map.get(Math.round(at) + 1) ?? [])];
  for (const top of across) {
    const y = (top.y0 + top.y1) / 2;
    for (const bottom of near(byLeft, top.x0)) {
      const y2 = (bottom.y0 + bottom.y1) / 2;
      if (bottom === top || !small(y2 - y) || Math.abs(bottom.x0 - top.x0) > 1 || Math.abs(bottom.x1 - top.x1) > 1) continue;
      const joins = (v: Segment) => Math.abs(v.y0 - y) <= 1 && Math.abs(v.y1 - y2) <= 1;
      const left = near(byX, top.x0).find((v) => Math.abs((v.x0 + v.x1) / 2 - top.x0) <= 1 && joins(v));
      const right = near(byX, top.x1).find((v) => Math.abs((v.x0 + v.x1) / 2 - top.x1) <= 1 && joins(v));
      if (left && right) for (const q of [top, bottom, left, right]) sides.add(q);
    }
  }
  return sides;
}
/** Past this many short lines one way, a page's boxes are not looked for (a drawing). */
const MAX_BOX_LINES = 4000;

/** The most lines down the page, and the most filled boxes, a page gives back. */
const MAX_DRAWN = 300;
/** An underline lies at most this many font sizes under the baseline (and hardly above it). */
const UNDERLINE_BELOW_EM = 0.32;
const UNDERLINE_ABOVE_EM = 0.04;

/**
 * Gives each line of text the thin lines drawn just under it, marks the words they lie under as underlined,
 * and returns the lines taken. A line that runs on past the text it lies under by more than the text is long
 * is a rule, not an underline, and is left.
 */
function takeUnderlines(lines: readonly Line[], free: readonly Segment[]): Set<Segment> {
  const taken = new Set<Segment>();
  if (free.length === 0) return taken;
  for (const line of lines) {
    if (line.turn !== undefined || line.words.length === 0) continue;
    let base = -Infinity;
    for (const w of line.words) base = Math.max(base, w.y1 - BASELINE_SHARE * boxHeight(w));
    const left = line.words[0].x0;
    const right = Math.max(...line.words.map((w) => w.x1));
    for (const s of free) {
      if (taken.has(s)) continue;
      const y = (s.y0 + s.y1) / 2;
      if (y < base - UNDERLINE_ABOVE_EM * line.size || y > base + UNDERLINE_BELOW_EM * line.size) continue;
      if (s.x1 <= left - 0.5 * line.size || s.x0 >= right + 4 * line.size) continue;
      const under = line.words.filter((w) => (w.x0 + w.x1) / 2 > s.x0 && (w.x0 + w.x1) / 2 < s.x1);
      const all = under.length === line.words.length;
      if (all && s.x1 - s.x0 > 2 * (right - left) + 2 * line.size) continue;
      if (under.length === 0 && (s.x0 < left - 0.5 * line.size)) continue;
      for (const w of under) w.underline = true;
      (line.underlines ??= []).push([s.x0, s.x1]);
      taken.add(s);
    }
    line.underlines?.sort((a, b) => a[0] - b[0]);
  }
  return taken;
}

/** The gutter between two columns of running text must be at least this wide, and lie in this middle share of the page. */
const GUTTER_MIN_PT = 8;
const GUTTER_ZONE: readonly [number, number] = [0.3, 0.7];
/** Running text has at least this many words a line on each side of the gutter. */
const PROSE_WORDS_PER_LINE = 3;

interface Section { lines: Line[]; split?: number }

/** Of a column of running text, this share of the lines at least reach nearly as far right as its longest line. */
const FULL_LINES_SHARE = 0.4;
const FULL_LINE_SLACK = 0.15;

/**
 * Whether one side of a gutter reads as running text: its lines start at one place (or two: a bullet or a
 * number, then the text), and many of them run on to the column's right edge. Labels and values set side
 * by side do not: they are as long as their words.
 */
function runsOn(words: Word[]): boolean {
  const lines = groupLines(words);
  if (lines.length < 3 || columnStarts(lines).length > 2) return false;
  const left = Math.min(...lines.map((l) => l.words[0].x0));
  const ends = lines.map((l) => Math.max(...l.words.map((w) => w.x1)));
  const right = Math.max(...ends);
  return ends.filter((x) => right - x <= FULL_LINE_SLACK * (right - left)).length >= FULL_LINES_SHARE * lines.length;
}

/** The page's lines cut into sections: full-width runs, and runs of two columns of running text (with where to split them). */
function sections(lines: Line[], pageWidth: number): Section[] {
  if (lines.length < 3) return [{ lines }];
  const z0 = Math.floor(GUTTER_ZONE[0] * pageWidth);
  const z1 = Math.ceil(GUTTER_ZONE[1] * pageWidth);
  const cover = new Int32Array(Math.max(1, z1 - z0) + 1);
  const phrases = lines.map(phrasesOf);
  for (const list of phrases) {
    for (const p of list) {
      const a = Math.max(z0, Math.floor(p.x0));
      const b = Math.min(z1, Math.ceil(p.x1));
      for (let x = a; x < b; x++) cover[x - z0]++;
    }
  }
  // The widest strip in the middle of the page that few lines cross (a heading may).
  const allowed = Math.floor(0.2 * lines.length);
  let best: [number, number] | null = null;
  for (let x = 0, start = -1; x <= z1 - z0; x++) {
    const clear = x < z1 - z0 && cover[x] <= allowed;
    if (clear && start < 0) start = x;
    if (!clear && start >= 0) {
      if (!best || x - start > best[1] - best[0]) best = [start, x];
      start = -1;
    }
  }
  if (!best || best[1] - best[0] < GUTTER_MIN_PT) return [{ lines }];
  const g0 = best[0] + z0;
  const g1 = best[1] + z0;
  const split = (g0 + g1) / 2;
  // A line lies across the columns when a run of its words spans the whole gutter; a long line that only reaches into it does not.
  const crosses = (i: number) => phrases[i].some((p) => p.x0 < g0 + 0.5 && p.x1 > g1 - 0.5);

  const out: Section[] = [];
  const full = (run: Line[]) => {
    const last = out[out.length - 1];
    if (last && last.split === undefined) last.lines.push(...run);
    else out.push({ lines: [...run] });
  };
  let run: Line[] = [];
  const close = () => {
    if (run.length === 0) return;
    let both = 0;
    const count = { left: 0, right: 0, leftNumeric: 0, rightNumeric: 0, leftLines: 0, rightLines: 0 };
    for (const line of run) {
      let l = 0;
      let r = 0;
      for (const w of line.words) {
        const numeric = AMOUNT.test(w.text);
        if ((w.x0 + w.x1) / 2 < split) {
          l++;
          if (numeric) count.leftNumeric++;
        } else {
          r++;
          if (numeric) count.rightNumeric++;
        }
      }
      count.left += l;
      count.right += r;
      if (l) count.leftLines++;
      if (r) count.rightLines++;
      if (l && r) both++;
    }
    const prose =
      both >= 3 &&
      count.left >= PROSE_WORDS_PER_LINE * count.leftLines &&
      count.right >= PROSE_WORDS_PER_LINE * count.rightLines &&
      count.leftNumeric < 0.3 * count.left &&
      count.rightNumeric < 0.3 * count.right &&
      runsOn(run.flatMap((line) => line.words.filter((w) => (w.x0 + w.x1) / 2 < split))) &&
      runsOn(run.flatMap((line) => line.words.filter((w) => (w.x0 + w.x1) / 2 >= split)));
    if (prose) out.push({ lines: run, split });
    else full(run);
    run = [];
  };
  lines.forEach((line, i) => {
    if (crosses(i)) {
      close();
      full([line]);
    } else run.push(line);
  });
  close();
  return out;
}

const lineHeight = (line: Line): number => Math.max(line.y1 - line.y0, 1);

/** Lines of running text cut into blocks: a new block at a wider gap between lines or a change of font size (about a paragraph, a heading). */
function textBlocks(lines: readonly Line[]): Block[] {
  const blocks: Block[] = [];
  let cur: Line[] = [];
  for (const line of lines) {
    const prev = cur[cur.length - 1];
    if (prev && (line.y0 - prev.y1 > 0.7 * prev.size || Math.abs(line.size - prev.size) > 0.1 * Math.max(line.size, prev.size))) {
      blocks.push({ kind: 'text', lines: cur });
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) blocks.push({ kind: 'text', lines: cur });
  return blocks;
}

/** At most this many one-cell lines may stand between two lines of several cells inside one table. */
const MAX_PLAIN_BETWEEN = 2;

/** One region's lines (a full-width run, or one column of a two-column run) as blocks: aligned tables where the lines show them, text elsewhere. */
function regionBlocks(lines: readonly Line[]): Block[] {
  const blocks: Block[] = [];
  const cells = lines.map((line) => phrasesOf(line).length);
  const near = (a: Line, b: Line, share: number) => b.y0 - a.y1 <= share * lineHeight(a);
  let pending: Line[] = [];
  const flush = () => {
    if (pending.length) blocks.push(...textBlocks(pending));
    pending = [];
  };
  let i = 0;
  while (i < lines.length) {
    if (cells[i] < 2) {
      pending.push(lines[i++]);
      continue;
    }
    // From this line of several cells to the last one that follows closely.
    let end = i;
    let several = 1;
    for (let k = i + 1, plain = 0; k < lines.length && near(lines[k - 1], lines[k], 2); k++) {
      if (cells[k] >= 2) {
        end = k;
        several++;
        plain = 0;
      } else if (++plain > MAX_PLAIN_BETWEEN) break;
    }
    let table: Table | null = null;
    if (several >= 2) {
      // A table has two rows or more with text in two columns or more, and a column after the first whose cells line up.
      const tried = buildGrid(lines.slice(i, end + 1));
      const filledRows = tried.table.rows.filter((row) => row.filter((c) => c.words.length > 0).length >= 2).length;
      if (tried.table.columns.length >= 2 && filledRows >= 2 && tried.bands.slice(1).some((band) => band.linedUp)) table = tried.table;
    }
    if (!table) {
      pending.push(lines[i++]);
      continue;
    }
    // Heading lines standing right on top of the table (a heading over two columns, a tall heading cell) are its first rows.
    let start = i;
    const left = table.columns[0];
    const right = Math.max(...lines.slice(i, end + 1).map((line) => Math.max(...line.words.map((w) => w.x1))));
    while (
      start > 0 &&
      i - start < MAX_PLAIN_BETWEEN &&
      pending.length > 0 &&
      pending[pending.length - 1] === lines[start - 1] &&
      near(lines[start - 1], lines[start], 0.5) &&
      lines[start - 1].words[0].x0 >= left - EDGE_PT &&
      Math.max(...lines[start - 1].words.map((w) => w.x1)) <= right + EDGE_PT
    ) {
      start--;
      pending.pop();
    }
    // A second line of a cell under the last row (a narration that wraps), when it sits in a column that is not the first.
    let stop = end;
    while (stop + 1 < lines.length && stop - end < MAX_PLAIN_BETWEEN && cells[stop + 1] === 1 && near(lines[stop], lines[stop + 1], 0.5)) {
      const next = lines[stop + 1];
      const k = lastAtMost(table.columns, next.words[0].x0 + EDGE_PT);
      const limit = k + 1 < table.columns.length ? table.columns[k + 1] : Infinity;
      if (k === 0 || Math.max(...next.words.map((w) => w.x1)) >= limit) break;
      stop++;
    }
    flush();
    blocks.push({ kind: 'table', table: start < i || stop > end ? gridFromLines(lines.slice(start, stop + 1)) : table });
    i = stop + 1;
  }
  flush();
  return blocks;
}

/** Words outside any ruled table as blocks in reading order. */
function flowBlocks(words: readonly Word[], pageWidth: number, groups: { next: number } = { next: 0 }, tables: readonly Found[] = []): Block[] {
  if (words.length === 0 && tables.length === 0) return [];
  const blocks: Block[] = [];
  const placed = new Set<Found>();
  /** One column's text and the drawn tables standing in it, top to bottom. */
  const column = (own: Word[], inside: Found[], at: ColumnPlace) => {
    const sorted = [...inside].sort((x, y) => x.table.y0 - y.table.y0);
    const slots: Word[][] = Array.from({ length: sorted.length + 1 }, () => []);
    for (const w of own) {
      const mid = (w.y0 + w.y1) / 2;
      let slot = sorted.length;
      for (let t = 0; t < sorted.length; t++) {
        if (mid <= sorted[t].table.y1) {
          slot = t;
          break;
        }
      }
      slots[slot].push(w);
    }
    const out: Block[] = [];
    sorted.forEach((f, t) => {
      out.push(...regionBlocks(groupLines(slots[t])));
      out.push({ kind: 'table', table: f.table });
      placed.add(f);
    });
    out.push(...regionBlocks(groupLines(slots[sorted.length])));
    blocks.push(...out.map((block): Block => ({ ...block, column: at })));
  };
  for (const section of sections(groupLines(words), pageWidth)) {
    if (section.split === undefined) {
      blocks.push(...regionBlocks(section.lines));
      continue;
    }
    const split = section.split;
    const all = section.lines.flatMap((line) => line.words);
    const top = Math.min(...section.lines.map((l) => l.y0));
    const bottom = Math.max(...section.lines.map((l) => l.y1));
    const here = tables.filter((f) => !placed.has(f) && (f.table.y0 + f.table.y1) / 2 > top && (f.table.y0 + f.table.y1) / 2 < bottom && (f.x1 <= split || f.x0 >= split));
    const group = groups.next++;
    column(all.filter((w) => (w.x0 + w.x1) / 2 < split), here.filter((f) => f.x1 <= split), { group, index: 0 });
    column(all.filter((w) => (w.x0 + w.x1) / 2 >= split), here.filter((f) => f.x0 >= split), { group, index: 1 });
  }
  for (const f of tables) if (!placed.has(f)) blocks.push({ kind: 'table', table: f.table });
  return blocks;
}

/**
 * One page as blocks in reading order (top to bottom; two columns of running text one after the other,
 * split at the gutter). A table drawn with lines comes first in choice; text that lines up in columns
 * on two rows or more is an aligned table; the rest is text, a block per paragraph or heading. Every
 * word of the page is in exactly one block. Words drawn turned on the page (up a margin, a slanted
 * watermark) come last, each as a line of its own, so they cannot disturb a table. `hasText` is false,
 * and `blocks` empty, when the page has no word at all (countsAsScanned is the under-20-characters rule).
 */
export function pageLayout(page: PageWords, segments: readonly Segment[], extras: PageExtras = {}): PageLayout {
  // A page whose words nearly all read up the page, or nearly all down it, is read turned (its text upright).
  let up = 0;
  let down = 0;
  let shown = 0;
  for (const w of page.words) {
    if (!NON_SPACE.test(w.text)) continue;
    shown++;
    if (w.turn === 90) up++;
    else if (w.turn === 270) down++;
  }
  const turn = up >= TURNED_PAGE_MIN_WORDS && up >= TURNED_PAGE_SHARE * shown ? 90 : down >= TURNED_PAGE_MIN_WORDS && down >= TURNED_PAGE_SHARE * shown ? 270 : 0;
  if (turn === 0) return layoutAsShown(page, segments, extras);
  const W = page.width;
  const H = page.height;
  const box = <T extends Box>(b: T): T => {
    const [ax, ay] = turn === 90 ? [H - b.y0, b.x0] : [b.y0, W - b.x0];
    const [bx, by] = turn === 90 ? [H - b.y1, b.x1] : [b.y1, W - b.x1];
    return { ...b, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
  };
  const words = page.words.map((w): Word => {
    const t = w.turn ?? 0;
    return { ...box(w), turn: t < 0 ? t : (t + (turn === 90 ? 270 : 90)) % 360 };
  });
  const layout = layoutAsShown({ pageIndex: page.pageIndex, width: H, height: W, words }, segments.map(box), {
    ...(extras.shades ? { shades: extras.shades.map(box) } : {}),
    ...(extras.pictures ? { pictures: extras.pictures.map(box) } : {}),
    ...(extras.strokes
      ? { strokes: extras.strokes.map((q) => (turn === 90 ? { ...q, x0: H - q.y0, y0: q.x0, x1: H - q.y1, y1: q.x1 } : { ...q, x0: q.y0, y0: W - q.x0, x1: q.y1, y1: W - q.x1 })) }
      : {}),
  });
  return { ...layout, turned: turn, ...(layout.pictures ? { pictures: layout.pictures.map((p) => ({ ...p, turn })) } : {}) };
}

/** The signs a drawn tick and a drawn cross are read as, and the font of signs they are set in. */
export const TICK_SIGN = '\u2713';
export const CROSS_SIGN = '\u2717';
const SIGN_FAMILY = 'Segoe UI Symbol';
/** A drawn mark is two strokes in a box of at least and at most this many points a side; ends within MARK_JOIN_PT are one point. */
const MARK_MIN_PT = 3;
const MARK_MAX_PT = 24;
const MARK_JOIN_PT = 1;
/** The long arm of a tick is at least this many times its short arm. */
const TICK_ARMS = 1.3;
/** How much of its font size the print of a sign takes in height. */
const SIGN_PRINT_EM = 0.72;

/**
 * The drawn marks among the slanted strokes of a page. A tick: two strokes that meet at one end, that end the
 * lowest point of both, a short arm up to the left and a longer arm up to the right. A cross: two strokes that cut
 * each other near the middle of both. Each becomes a word of one sign in its box (its size from the height of the
 * mark); every other stroke is given back as it is.
 */
function drawnMarks(strokes: readonly Stroke[]): { signs: Word[]; rest: Stroke[] } {
  const signs: Word[] = [];
  const rest: Stroke[] = [];
  if (strokes.length === 0) return { signs, rest };
  const used = new Set<Stroke>();
  const long = (q: Stroke) => Math.hypot(q.x1 - q.x0, q.y1 - q.y0);
  const ends = (q: Stroke): [number, number][] => [[q.x0, q.y0], [q.x1, q.y1]];
  const sign = (text: string, a: Stroke, b: Stroke): boolean => {
    const x0 = Math.min(a.x0, a.x1, b.x0, b.x1);
    const x1 = Math.max(a.x0, a.x1, b.x0, b.x1);
    const y0 = Math.min(a.y0, a.y1, b.y0, b.y1);
    const y1 = Math.max(a.y0, a.y1, b.y0, b.y1);
    if (Math.max(x1 - x0, y1 - y0) > MARK_MAX_PT || Math.min(x1 - x0, y1 - y0) < MARK_MIN_PT) return false;
    const size = (y1 - y0) / SIGN_PRINT_EM;
    const color = a.color && a.color !== '000000' ? { color: a.color } : {};
    // The box of the word as a line of text has it: its print stands on the baseline, a quarter of a size above the foot of the box.
    signs.push({ text, x0, x1, y1: y1 + 0.25 * size, y0: y1 + 0.25 * size - 1.15 * size, size, font: 'drawn', family: SIGN_FAMILY, ...color });
    used.add(a);
    used.add(b);
    return true;
  };
  for (let i = 0; i < strokes.length; i++) {
    const a = strokes[i];
    if (used.has(a)) continue;
    // Its partner is the stroke drawn right after it, or the one after that.
    for (let j = i + 1; j < strokes.length && j <= i + 2 && !used.has(a); j++) {
      const b = strokes[j];
      if (used.has(b)) continue;
      // A tick: the end the two share is its foot.
      let made = false;
      for (const [ax, ay] of ends(a)) {
        for (const [bx, by] of ends(b)) {
          if (made || Math.hypot(ax - bx, ay - by) > MARK_JOIN_PT) continue;
          const far = (q: Stroke, x: number, y: number): [number, number] => (Math.hypot(q.x0 - x, q.y0 - y) > Math.hypot(q.x1 - x, q.y1 - y) ? [q.x0, q.y0] : [q.x1, q.y1]);
          const pa = far(a, ax, ay);
          const pb = far(b, bx, by);
          const [left, right] = pa[0] < pb[0] ? [pa, pb] : [pb, pa];
          const shortArm = Math.hypot(left[0] - ax, left[1] - ay);
          const longArm = Math.hypot(right[0] - ax, right[1] - ay);
          if (left[1] < ay && right[1] < ay && left[0] < ax && right[0] > ax && longArm >= TICK_ARMS * shortArm) made = sign(TICK_SIGN, a, b);
        }
      }
      if (made) break;
      // A cross: the two cut each other between a quarter and three quarters of the way along both.
      const d = (a.x1 - a.x0) * (b.y1 - b.y0) - (a.y1 - a.y0) * (b.x1 - b.x0);
      if (Math.abs(d) < 1e-6) continue;
      const t = ((b.x0 - a.x0) * (b.y1 - b.y0) - (b.y0 - a.y0) * (b.x1 - b.x0)) / d;
      const u = ((b.x0 - a.x0) * (a.y1 - a.y0) - (b.y0 - a.y0) * (a.x1 - a.x0)) / d;
      if (t > 0.25 && t < 0.75 && u > 0.25 && u < 0.75 && long(a) < 2 * long(b) && long(b) < 2 * long(a)) sign(CROSS_SIGN, a, b);
    }
  }
  for (const q of strokes) if (!used.has(q)) rest.push(q);
  return { signs, rest };
}

/** A page is read turned when this share of its words, and at least this many, read the same way up or down it. */
const TURNED_PAGE_SHARE = 0.9;
const TURNED_PAGE_MIN_WORDS = 10;

function layoutAsShown(page: PageWords, segments: readonly Segment[], extras: PageExtras = {}): PageLayout {
  const size = { pageIndex: page.pageIndex, width: page.width, height: page.height };
  const words = page.words.filter((w) => NON_SPACE.test(w.text));
  // A tick or a cross drawn with strokes is the sign it shows, standing where it is drawn.
  const marks = drawnMarks(extras.strokes ?? []);
  words.push(...marks.signs);
  // A picture that invisible words stand over is a scan with its recognised text: it shows those words already, so it is
  // left out and the words are typed. Any other picture is kept, behind the text when visible words lie over it.
  let scan = false;
  const pictures: Picture[] = [];
  (extras.pictures ?? []).forEach((p, index) => {
    let over = 0;
    let hidden = 0;
    for (const w of words) {
      if ((w.x0 + w.x1) / 2 > p.x0 && (w.x0 + w.x1) / 2 < p.x1 && (w.y0 + w.y1) / 2 > p.y0 && (w.y0 + w.y1) / 2 < p.y1) {
        over++;
        if (w.hidden) hidden++;
      }
    }
    if (hidden > 0) scan = true;
    else pictures.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, index, behind: over >= 3 || (p.alpha !== undefined && p.alpha < 0.5), ...(p.alpha !== undefined && p.alpha < 0.995 ? { alpha: p.alpha } : {}) });
  });
  const base = { ...size, ...(scan ? { scan: true as const } : {}) };
  if (words.length === 0) return { ...base, hasText: false, blocks: [], ...(pictures.length ? { pictures } : {}) };
  markRaised(words);
  const ruled = findRuled({ ...page, words }, segments, extras);
  const inTable = new Set<Word>();
  for (const f of ruled) for (const w of f.used) inTable.add(w);
  const turned = words.filter((w) => isTurned(w) && !inTable.has(w));
  const upright = words.filter((w) => !isTurned(w));
  const blocks: Block[] = [];
  const groups = { next: 0 };
  if (ruled.length === 0) blocks.push(...flowBlocks(upright, page.width, groups));
  else {
    const taken = new Set<Word>();
    for (const f of ruled) for (const w of f.used) taken.add(w);
    const loose = upright.filter((w) => !taken.has(w));
    // A drawn table standing wholly in one of two columns of text belongs to that column; any other lies across the page.
    const columns = sections(groupLines(loose), page.width).filter((sec) => sec.split !== undefined);
    const inColumn = (f: Found): boolean =>
      columns.some((sec) => {
        const mid = (f.table.y0 + f.table.y1) / 2;
        return mid > Math.min(...sec.lines.map((l) => l.y0)) && mid < Math.max(...sec.lines.map((l) => l.y1)) && (f.x1 <= sec.split! || f.x0 >= sec.split!);
      });
    const wide = ruled.filter((f) => !inColumn(f));
    const narrow = ruled.filter(inColumn);
    // The words and column tables outside the wide tables, by which wide table they come before.
    const slotOf = (mid: number): number => {
      for (let t = 0; t < wide.length; t++) if (mid <= wide[t].table.y1) return t;
      return wide.length;
    };
    const slots: Word[][] = Array.from({ length: wide.length + 1 }, () => []);
    const tableSlots: Found[][] = Array.from({ length: wide.length + 1 }, () => []);
    for (const w of loose) slots[slotOf((w.y0 + w.y1) / 2)].push(w);
    for (const f of narrow) tableSlots[slotOf((f.table.y0 + f.table.y1) / 2)].push(f);
    wide.forEach((f, t) => {
      blocks.push(...flowBlocks(slots[t], page.width, groups, tableSlots[t]));
      blocks.push({ kind: 'table', table: f.table });
    });
    blocks.push(...flowBlocks(slots[wide.length], page.width, groups, tableSlots[wide.length]));
  }
  // Words drawn turned outside any table: those reading up or down the page as the lines they make (a label up the
  // side of a band), each piece set apart a line of its own; any other turned word a line of its own.
  if (turned.length) {
    const lines: Line[] = [];
    for (const way of [90, 270] as const) {
      for (const line of turnedLines(turned.filter((w) => turnOf(w) === way), way)) {
        let piece: Word[] = [];
        for (const w of line.words) {
          const prev = piece[piece.length - 1];
          const gap = prev ? (way === 90 ? prev.y0 - w.y1 : w.y0 - prev.y1) : 0;
          if (prev && gap > TURNED_PIECE_EM * Math.max(em(w), em(prev))) {
            lines.push({ ...line, words: piece });
            piece = [];
          }
          piece.push(w);
        }
        lines.push({ ...line, words: piece });
      }
    }
    lines.push(...turned.filter((w) => turnOf(w) !== 90 && turnOf(w) !== 270).map((w) => toLine([w])));
    blocks.push({ kind: 'text', lines });
  }
  // The lines across the page that are no table's: an underline of the text just above, else a rule.
  const onTable = (s: Segment): boolean => {
    const y = (s.y0 + s.y1) / 2;
    return ruled.some((f) => f.h.some((l) => Math.abs(l.at - y) <= SNAP_PT && s.x0 >= l.from - SNAP_PT && s.x1 <= l.to + SNAP_PT));
  };
  // The sides of small drawn boxes (squares to tick) are lines of the page and nothing else.
  const sides = boxSides(segments);
  // Pieces of one line (a rule drawn cell by cell) are one line.
  const free: Segment[] = [];
  for (const s of segments.filter((q) => Math.abs(q.y1 - q.y0) <= 1 && q.x1 - q.x0 > 2 && Number.isFinite(q.x0 + q.x1 + q.y0 + q.y1) && !onTable(q) && !sides.has(q)).sort((a, b) => Math.round(a.y0 + a.y1) - Math.round(b.y0 + b.y1) || a.x0 - b.x0)) {
    const last = free[free.length - 1];
    if (last && Math.abs(last.y0 + last.y1 - s.y0 - s.y1) <= 1.5 && s.x0 <= last.x1 + SNAP_PT && last.color === s.color) last.x1 = Math.max(last.x1, s.x1);
    else free.push({ ...s });
  }
  const allLines: Line[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') allLines.push(...block.lines);
    else if (block.table.grid) for (const c of block.table.grid.cells) allLines.push(...c.lines);
  }
  const lined = takeUnderlines(allLines, free);
  let rules: PageRule[] = free.filter((s) => !lined.has(s) && s.x1 - s.x0 >= MIN_RULE_PT).map((s) => ({ x0: s.x0, x1: s.x1, y: (s.y0 + s.y1) / 2, color: s.color, width: s.width }));
  for (const s of sides) if (Math.abs(s.y1 - s.y0) <= 1 && s.x1 - s.x0 > 2 && !onTable(s)) rules.push({ x0: s.x0, x1: s.x1, y: (s.y0 + s.y1) / 2, color: s.color, width: s.width, side: true });
  // A table shown by how its text lines up gets its grid too, with the rules and shading drawn on its rows.
  for (const block of blocks) {
    if (block.kind !== 'table' || block.table.source !== 'aligned' || block.table.grid) continue;
    const made = alignedGrid(block.table, rules, extras.shades ?? []);
    if (!made) continue;
    block.table.grid = made.grid;
    if (made.drawn.rules.length > 0 || made.drawn.fills.length > 0) block.table.drawn = made.drawn;
    if (made.taken.size > 0) rules = rules.filter((r) => !made.taken.has(r));
  }
  // What else the page draws outside its tables: lines down the page, and filled boxes.
  const grids: Box[] = [];
  for (const block of blocks) {
    const g = block.kind === 'table' && block.table.source === 'ruled' ? block.table.grid : undefined;
    if (g) grids.push({ x0: g.xs[0], y0: g.ys[0], x1: g.xs[g.xs.length - 1], y1: g.ys[g.ys.length - 1] });
  }
  const inGrid = (x: number, y: number) => grids.some((g) => x > g.x0 - 1 && x < g.x1 + 1 && y > g.y0 - 1 && y < g.y1 + 1);
  const onTableDown = (q: Segment): boolean => {
    const x = (q.x0 + q.x1) / 2;
    return ruled.some((f) => f.v.some((l) => Math.abs(l.at - x) <= SNAP_PT && q.y0 >= l.from - SNAP_PT && q.y1 <= l.to + SNAP_PT));
  };
  const uprights = segments
    .filter((q) => Math.abs(q.x1 - q.x0) <= 1 && q.y1 - q.y0 >= MIN_RULE_PT && Number.isFinite(q.x0 + q.x1 + q.y0 + q.y1) && !onTableDown(q) && !inGrid((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2))
    .slice(0, MAX_DRAWN)
    .map((q) => {
      const half = Math.max(0.25, (q.width ?? 0.5) / 2);
      return { x0: (q.x0 + q.x1) / 2 - half, y0: q.y0, x1: (q.x0 + q.x1) / 2 + half, y1: q.y1, color: q.color ?? '000000' };
    });
  const fills = (extras.shades ?? [])
    .filter((sh) => sh.color !== 'FFFFFF' && sh.x1 > 0 && sh.y1 > 0 && sh.x0 < page.width && sh.y0 < page.height && !inGrid((sh.x0 + sh.x1) / 2, (sh.y0 + sh.y1) / 2))
    .slice(0, MAX_DRAWN)
    .map((sh) => ({ x0: Math.max(0, sh.x0), y0: Math.max(0, sh.y0), x1: Math.min(page.width, sh.x1), y1: Math.min(page.height, sh.y1), color: sh.color }));
  return {
    ...base, hasText: true, blocks,
    ...(pictures.length ? { pictures } : {}), ...(rules.length ? { rules } : {}), ...(uprights.length ? { uprights } : {}), ...(fills.length ? { fills } : {}),
    ...(marks.rest.length ? { strokes: marks.rest.slice(0, MAX_DRAWN) } : {}),
  };
}

/** True when the page has fewer than SCANNED_MAX_CHARS (20) characters that are not white space: design section 13's "counts as scanned". */
export function countsAsScanned(page: PageWords): boolean {
  let chars = 0;
  for (const w of page.words) {
    chars += Array.from(w.text.replace(/\s/g, '')).length;
    if (chars >= SCANNED_MAX_CHARS) return false;
  }
  return true;
}
