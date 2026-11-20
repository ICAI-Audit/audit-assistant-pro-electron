/**
 * How the parts of a converted document look (PDF to Word, T-064 quality round; design 5.11): for every
 * paragraph its runs (family, size, bold, italic, underline, colour, stretch), its indents, alignment, line
 * height, tab stops and where it lies on the page; for every table its column widths, row heights, merged
 * cells, the line on each side of each cell, shading and turned text. wordBuild.ts writes these as they are.
 *
 * Everything is measured from the page (points, display coordinates as layout.ts), never from what kind of
 * document it is:
 * - a line whose words stand apart by a wide gap, or that has a blank drawn as an underline, is a "set" line:
 *   it stays a paragraph of its own and its pieces are put at their places with tab stops (an underlined tab
 *   draws the blank);
 * - other lines of one paragraph flow as one paragraph with the page's own line pitch;
 * - a paragraph is centred or set right when it sits so in its box (the cell, or the page's text area), and
 *   justified when its lines all end at the same edge;
 * - a run is drawn as wide as on the page: the font size to the half point, and the character scale making
 *   up the rest (many forms stretch their text).
 */
import type { Border, Grid, GridCell, Line, Word } from './layout';

export interface RunLook {
  text: string;
  /** A tab instead of text (the paragraph's `tabs` say where it lands). */
  tab?: true;
  family?: string;
  /** Points. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** RRGGBB. */
  color?: string;
  /** Character scale in percent, when not 100. */
  scale?: number;
  /** A line break instead of text: the line of the page ends here, inside the paragraph. */
  br?: true;
  /** Small text raised or lowered after its word: written as a superscript or subscript of the size given (its word's). */
  raised?: 'super' | 'sub';
  /** While a paragraph is being fitted to a measure only (never left on a finished run): the widths of its words on the page added up, and where it starts and ends along its line. */
  ink?: number;
  from?: number;
  to?: number;
}

/**
 * How wide `text` is in the font Word will use for a run that looks so, in font sizes (the width at size 1),
 * letter by letter without kerning, as Word sets body text. With a measure, a paragraph keeps the lines of the
 * page (a line break at each line's end, inside the one paragraph) and its letters are scaled so that each run
 * is as wide as on the page; a line is never left wider than on the page, where it would wrap.
 */
export type TextMeasure = (text: string, look: { family?: string; bold?: boolean; italic?: boolean }) => number;

export interface ParaLook {
  runs: RunLook[];
  align?: 'center' | 'right' | 'both';
  /** Indents in points from the box the paragraph stands in; `first` is the first line's own (negative: hanging). */
  left: number;
  right: number;
  first: number;
  /** The exact height of each line, points. */
  line: number;
  /** How many lines it has on the page. */
  lines: number;
  /** The font size most of it has. */
  size: number;
  /** Left tab stops in points from the box's left edge. */
  tabs: number[];
  /** Where its line boxes lie on the page (top of the first, bottom of the last). For turned text: across the cell. */
  y0: number;
  y1: number;
  /** It stands beside a table placed on the page: it is set at its own spot too (its left edge, its top, its width), out of the flow. */
  frame?: { x: number; y: number; w: number };
  /** It is drawn up (90) or down (270) the page: it stands turned in this box of the page, out of the flow. */
  turned?: { x0: number; y0: number; x1: number; y1: number; turn: 90 | 270 };
}

export interface CellLook {
  colSpan: number;
  /** A cell over several rows: 'start' in its first row, 'cont' in the rows below. */
  merge?: 'start' | 'cont';
  paras: ParaLook[];
  borders: { top: Border | null; right: Border | null; bottom: Border | null; left: Border | null };
  shade?: string;
  turn: 0 | 90 | 270;
  /** The cell's top on the page (for turned text: the edge its first line stands at), and its bottom. */
  y0: number;
  y1: number;
}
export interface RowLook { height: number; cells: CellLook[] }
export interface TableLook {
  x0: number; widths: number[]; rows: RowLook[]; y0: number; y1: number;
  /** Something else of the page stands beside it (a label, another table): it is placed at its own spot on the page, out of the flow. */
  float?: true;
}
export interface RuleLook { x0: number; x1: number; y: number; color: string; width: number }

// eslint-disable-next-line no-control-regex
const NOT_IN_XML = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{FFFE}\u{FFFF}\u{D800}-\u{DFFF}]/gu;
/** Text as Word can hold it: no control characters or lone surrogates; tabs, line ends and other spaces as one space. */
export function clean(text: string): string {
  return text.replace(NOT_IN_XML, '').replace(/\s+/g, ' ');
}

/** Where the baseline sits in a word's box, as a share of its height from the bottom (layout.ts). */
const BASELINE_SHARE = 0.217;
/** How far under the baseline a line's box ends in Word, in font sizes (measured: see the WQ report). */
export const DESCENT_EM = 0.21;
/** The line height given to a single line, in font sizes. */
const SINGLE_LINE_EM = 1.15;
/** Words this many font sizes apart (a space and a half) are set apart (a tab stop), in a line that is "set". */
const SET_GAP_EM = 0.45;
/** A gap this wide makes a line "set" by itself. */
const WIDE_GAP_EM = 2;
/** An underline running this many font sizes past its words is a blank to fill in. */
const BLANK_EM = 0.5;
/** A character scale within this of 100 % is left at 100. */
const SCALE_SLACK = 3;

const lineSize = (line: Line): number => (line.size > 0 ? line.size : 10);
const isBlank = (w: Word): boolean => clean(w.text).trim() === '';

/** A word of a turned line as if the line ran left to right: x along the line, y across it. */
function upright(w: Word, turn: number): Word {
  return turn === 90 ? { ...w, x0: -w.y1, x1: -w.y0, y0: w.x0, y1: w.x1 } : turn === 270 ? { ...w, x0: w.y0, x1: w.y1, y0: -w.x1, y1: -w.x0 } : w;
}

/** A line with its words as they read (a turned line made upright), blank words left out. */
interface Laid { words: Word[]; size: number; x0: number; x1: number; base: number; underlines: [number, number][] }

function lay(line: Line): Laid | null {
  const turn = line.turn ?? 0;
  const words = line.words.filter((w) => !isBlank(w)).map((w) => upright(w, turn));
  if (words.length === 0) return null;
  if (turn !== 0) words.sort((a, b) => a.x0 - b.x0);
  let base = -Infinity;
  let x0 = Infinity;
  let x1 = -Infinity;
  // The line's baseline is that of its words on the line: text lowered under it does not count.
  const plain = words.some((w) => !w.raised);
  for (const w of words) {
    if (!plain || !w.raised) base = Math.max(base, w.y1 - BASELINE_SHARE * Math.max(w.y1 - w.y0, 0.1));
    x0 = Math.min(x0, w.x0);
    x1 = Math.max(x1, w.x1);
  }
  return { words, size: lineSize(line), x0, x1, base, underlines: turn === 0 ? (line.underlines ?? []) : [] };
}

/** The blanks of a line: the stretches of its underlines that run past the words they lie under (or lie under none). */
function blanksOf(line: Laid): boolean {
  for (const [u0, u1] of line.underlines) {
    const under = line.words.filter((w) => (w.x0 + w.x1) / 2 > u0 && (w.x0 + w.x1) / 2 < u1);
    if (under.length === 0) return true;
    if (under[0].x0 - u0 > BLANK_EM * line.size || u1 - under[under.length - 1].x1 > BLANK_EM * line.size) return true;
  }
  return false;
}

/** A line whose pieces are set at places of their own: a wide gap between two words, or a blank drawn as an underline. */
export function isSetLine(line: Line): boolean {
  const laid = lay(line);
  return laid !== null && isSetLineLaid(laid);
}

function runOf(w: Word, text: string, underline: boolean, fitted = false): RunLook {
  if (w.raised) {
    // A superscript or subscript in the size of its word (Word draws it smaller itself); it is not fitted.
    const of = w.raisedOf ?? w.size;
    const run: RunLook = { text, raised: w.raised };
    if (w.family) run.family = w.family;
    if (of > 0) run.size = Math.max(1, Math.round(of * 2) / 2);
    if (w.bold) run.bold = true;
    if (w.italic) run.italic = true;
    if (w.color && w.color !== '000000') run.color = w.color;
    return run;
  }
  const size = w.size > 0 ? Math.max(1, Math.round(w.size * 2) / 2) : undefined;
  if (fitted) {
    // The scale comes from the measure (fitRuns): the page's own stretch is part of the width it is fitted to.
    const run: RunLook = { text, ink: w.x1 - w.x0, from: w.x0, to: w.x1 };
    if (w.family) run.family = w.family;
    if (size) run.size = size;
    if (w.bold) run.bold = true;
    if (w.italic) run.italic = true;
    if (underline) run.underline = true;
    if (w.color && w.color !== '000000') run.color = w.color;
    return run;
  }
  const run: RunLook = { text };
  if (w.family) run.family = w.family;
  if (size) run.size = size;
  if (w.bold) run.bold = true;
  if (w.italic) run.italic = true;
  if (underline) run.underline = true;
  if (w.color && w.color !== '000000') run.color = w.color;
  if (size) {
    const scale = Math.round(100 * (w.stretch ?? 1) * (w.size / size));
    if (Math.abs(scale - 100) >= SCALE_SLACK) run.scale = Math.max(20, Math.min(600, scale));
  }
  return run;
}

const sameLook = (a: RunLook, b: RunLook): boolean =>
  !a.tab && !b.tab && !a.br && !b.br && a.raised === b.raised && a.family === b.family && a.size === b.size && !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && a.color === b.color && a.scale === b.scale;

function joinInk(prev: RunLook, run: RunLook): void {
  if (prev.ink === undefined || run.ink === undefined) return;
  prev.ink += run.ink;
  prev.to = run.to;
}

/**
 * Fits runs to a measure: each run's letters are scaled to the width its words have on the page; a piece (the
 * runs between two tabs or line breaks) that would still come out wider than on the page, its spaces being
 * wider than the page's, is scaled down to the page's width. A scale within a hundredth of 100 % is left out.
 */
const FIT_MARGIN = 1.005;
/** For lines that run from edge to edge of their paragraph (Word stretches them to the edge anyway): more is kept in hand. */
const FIT_MARGIN_EVEN = 1.02;
/** Room at the right of kept lines that end unevenly: they break where the page breaks them, never where the room ends. */
const KEPT_ROOM_PT = 9;
/** Room given on each side of centred text that is fitted to the page's width. */
const CENTRED_ROOM_PT = 6;
function fitRuns(runs: RunLook[], measure: TextMeasure, margin = FIT_MARGIN): void {
  let piece: { run: RunLook; scale: number; full: number; lead: number }[] = [];
  const close = () => {
    if (piece.length > 0) {
      const first = piece[0].run;
      const last = piece[piece.length - 1].run;
      let natural = 0;
      piece.forEach(({ run, scale, full, lead }, i) => {
        natural += (i === 0 ? full - lead : full) * (run.size ?? 10) * scale;
      });
      const extent = (last.to ?? 0) - (first.from ?? 0);
      // Word's own widths differ from the measure's by a little: half a hundredth is kept in hand.
      const less = natural * margin > extent && extent > 0 ? extent / (natural * margin) : 1;
      for (const { run, scale } of piece) {
        const percent = Math.max(33, Math.min(300, Math.floor(scale * less * 100 + 1e-6)));
        // Never left a hundredth too wide (a kept line would wrap); a hundredth wider than the font is not asked for.
        if (percent === 100 || percent === 101) delete run.scale;
        else run.scale = percent;
      }
    }
    piece = [];
  };
  for (const run of runs) {
    if (run.tab || run.br) {
      close();
      continue;
    }
    if (run.ink === undefined || !run.size || !(run.ink > 0)) continue;
    // The whole text once; its spaces (every word space is one space) taken off for the letters' own width.
    const full = measure(run.text, run);
    let spaces = 0;
    let leading = 0;
    for (let i = 0; i < run.text.length; i++) {
      if (run.text.charCodeAt(i) !== 32) continue;
      spaces++;
      if (i === leading) leading++;
    }
    const space = spaces > 0 ? measure(' ', run) : 0;
    const wide = (full - spaces * space) * run.size;
    if (wide > 0) piece.push({ run, scale: run.ink / wide, full, lead: leading * space });
  }
  close();
  for (const run of runs) {
    delete run.ink;
    delete run.from;
    delete run.to;
  }
}

/** Adds a word to the runs, after a space when `spaced`: joined to the run before when it looks the same. */
function addWord(runs: RunLook[], run: RunLook, spaced: boolean): void {
  const prev = runs[runs.length - 1];
  if (prev && sameLook(prev, run)) {
    prev.text += (spaced ? ' ' : '') + run.text;
    joinInk(prev, run);
    return;
  }
  if (spaced && prev && !prev.tab && !prev.br) {
    // The space is not underlined unless the words on both sides are.
    // ... and a space after raised text is a space of the line, not of the raised text.
    if ((prev.underline && !run.underline) || (prev.raised && !run.raised)) run.text = ` ${run.text}`;
    else prev.text += ' ';
  } else if (spaced) run.text = ` ${run.text}`;
  runs.push(run);
}

/** The runs of a set line, its pieces at their places: `tabs` receives the stops, in points from `boxLeft`. Returns where the line starts. */
function setRuns(line: Laid, boxLeft: number, runs: RunLook[], tabs: number[], breaks?: ReadonlySet<Word>, fitted = false): number {
  const size = line.size;
  const pure = line.underlines.filter(([u0, u1]) => !line.words.some((w) => (w.x0 + w.x1) / 2 > u0 && (w.x0 + w.x1) / 2 < u1));
  const stretchOf = (w: Word) => (w.underline ? line.underlines.find(([u0, u1]) => (w.x0 + w.x1) / 2 > u0 && (w.x0 + w.x1) / 2 < u1) : undefined);
  const first = line.words[0];
  const firstStretch = stretchOf(first);
  let start = first.x0;
  if (firstStretch && first.x0 - firstStretch[0] > BLANK_EM * size) start = firstStretch[0];
  for (const [u0] of pure) if (u0 < start) start = u0;
  let pen = start;
  const look = (w: Word): RunLook => runOf(w, '', false);
  const tabTo = (x: number, like: Word, underline: boolean): boolean => {
    if (x - pen < 0.75) return false;
    const run = look(like);
    delete run.scale;
    runs.push({ ...run, text: '', tab: true, ...(underline ? { underline: true } : {}) });
    tabs.push(x - boxLeft);
    pen = x;
    return true;
  };
  /** The blanks standing wholly before `x`: each a plain move to its start, then an underlined tab along it. */
  const blanksBefore = (x: number, like: Word): boolean => {
    let any = false;
    for (const b of pure) {
      if (b[0] < pen - 1 || b[1] > x + 1) continue;
      if (b[0] - pen >= 0.75) tabTo(b[0], like, false);
      if (tabTo(b[1], like, true)) any = true;
    }
    return any;
  };
  let prevStretch: [number, number] | undefined;
  line.words.forEach((w, k) => {
    const text = clean(w.text).trim();
    const stretch = stretchOf(w);
    let moved = blanksBefore(w.x0, w);
    if (stretch && stretch !== prevStretch && w.x0 - stretch[0] > BLANK_EM * size && stretch[0] >= pen - 1) {
      // A blank runs up to the word: a plain move to where it starts, then an underlined one along it.
      if (stretch[0] - pen >= 0.75) tabTo(stretch[0], w, false);
      if (tabTo(w.x0, w, true)) moved = true;
    }
    const gap = w.x0 - pen;
    let spaced = false;
    if (!moved && k > 0) {
      if (!w.glued && (gap >= SET_GAP_EM * size * (w.stretch ?? 1) || breaks?.has(w))) moved = tabTo(w.x0, w, !!stretch && stretch === prevStretch);
      if (!moved) spaced = !w.glued;
    }
    const run = runOf(w, text, !!w.underline, fitted);
    if (spaced && stretch && stretch === prevStretch) {
      // Inside one underline the space is underlined too.
      const prev = runs[runs.length - 1];
      if (prev && sameLook(prev, run)) {
        prev.text += ` ${text}`;
        joinInk(prev, run);
      } else runs.push({ ...run, text: ` ${text}` });
    } else addWord(runs, run, spaced);
    pen = w.x1;
    const next = line.words[k + 1];
    if (stretch && (!next || stretchOf(next) !== stretch) && stretch[1] - w.x1 > BLANK_EM * size) tabTo(stretch[1], w, true);
    prevStretch = stretch;
  });
  blanksBefore(Infinity, line.words[line.words.length - 1]);
  return start;
}

/** The box a paragraph stands in, along its lines. */
export interface Span { x0: number; x1: number }

const HYPHEN_END = /[\p{L}\p{N}][-\u{AD}\u{2010}]$/u;
const SOFT_HYPHEN_END = /\u{AD}$/u;
const SMALL_LETTER_START = /^\p{Ll}/u;

/** How a paragraph sits in its box: centred, set right, or left. */
function placeIn(x0: number, x1: number, box: Span, numeric: boolean): 'left' | 'center' | 'right' {
  const dl = x0 - box.x0;
  const dr = box.x1 - x1;
  const width = box.x1 - box.x0;
  if (dl > 2 && Math.abs(dl - dr) <= Math.max(1.5, 0.03 * width)) return 'center';
  if (dr < dl && (numeric ? dr <= 0.5 * dl : dr <= dl / 3) && dl > 4) return 'right';
  return 'left';
}

const AMOUNT = /^[(+-]?[₹$€£]?\s?\(?[+-]?\d[\d,]*(?:\.\d+)?\)?\s?(?:Dr|Cr|%)?\.?\)?$/i;

/**
 * The look of one paragraph made of `lines` (one line, or the lines that flow together), standing in `box`.
 * `breaks` are words that start a piece of their own in a set line (the cells of a row written as text).
 * Null when the lines hold no word.
 */
export function paragraphLook(lines: readonly Line[], box: Span, breaks?: ReadonlySet<Word>, measure?: TextMeasure): ParaLook | null {
  const turn = lines[0]?.turn ?? 0;
  // A turned line's box: along the line.
  const laid = lines.map(lay).filter((l): l is Laid => l !== null);
  if (laid.length === 0) return null;
  const first = laid[0];
  const last = laid[laid.length - 1];
  const size = first.size;
  const runs: RunLook[] = [];
  const tabs: number[] = [];
  const n = laid.length;
  const line = n >= 2 && last.base > first.base ? (last.base - first.base) / (n - 1) : SINGLE_LINE_EM * size;
  const y1 = last.base + DESCENT_EM * last.size;
  const y0 = first.base + DESCENT_EM * first.size - line;
  const base: ParaLook = { runs, left: 0, right: 0, first: 0, line, lines: n, size, tabs, y0, y1 };
  void turn;

  if (n === 1 && (breaks || isSetLineLaid(first))) {
    const start = setRuns(first, box.x0, runs, tabs, breaks, measure !== undefined);
    if (measure) {
      for (const run of runs) if (run.tab) delete run.ink;
      fitRuns(runs, measure);
    }
    base.left = Math.max(0, start - box.x0);
    // Never wrapped: its pieces are at their places.
    base.right = Math.min(0, box.x1 - first.x1 - 12);
    return base;
  }
  // A first line that starts with a number or a mark standing left of where the other lines start (a hanging
  // indent): the mark, a tab to the hanging indent, then the text.
  let hang = -1;
  if (n >= 2) {
    const restLeft = Math.min(...laid.slice(1).map((l) => l.x0));
    for (let k = 1; k < first.words.length && k <= 2 && hang < 0; k++) {
      const w = first.words[k];
      if (first.x0 < restLeft - 2 && Math.abs(w.x0 - restLeft) <= 2 && w.x0 - first.words[k - 1].x1 >= SET_GAP_EM * size) hang = k;
    }
  }
  laid.forEach((l, i) => {
    if (measure && i > 0) runs.push({ text: '', br: true });
    l.words.forEach((w, k) => {
      const text = clean(w.text).trim();
      const prev = runs[runs.length - 1];
      if (i === 0 && k === hang) {
        const tab = runOf(w, '', false);
        delete tab.scale;
        runs.push({ ...tab, tab: true }, runOf(w, text, !!w.underline, measure !== undefined));
        return;
      }
      if (measure) {
        addWord(runs, runOf(w, text, !!w.underline, true), k > 0 && !w.glued);
        return;
      }
      if (i > 0 && k === 0 && prev && HYPHEN_END.test(prev.text)) {
        // A word cut at the line's end is one word (wordBuild.ts states the rule).
        if (SOFT_HYPHEN_END.test(prev.text) || SMALL_LETTER_START.test(text)) prev.text = prev.text.slice(0, -1);
        const run = runOf(w, text, !!w.underline);
        if (sameLook(prev, run)) prev.text += text;
        else runs.push(run);
        return;
      }
      addWord(runs, runOf(w, text, !!w.underline), runs.length > 0 && !w.glued);
    });
  });
  const x1 = Math.max(...laid.map((l) => l.x1));
  // Lines that all run to one edge (but the last) from one start (but the first): the paragraph runs from edge to edge.
  const restLeft = n >= 2 ? Math.min(...laid.slice(1).map((l) => l.x0)) : first.x0;
  const oneStart = laid.slice(1).every((l) => Math.abs(l.x0 - restLeft) <= 2);
  const even = n >= 3 && oneStart && laid.slice(0, -1).every((l) => x1 - l.x1 <= 2);
  if (measure) fitRuns(runs, measure, even ? FIT_MARGIN_EVEN : FIT_MARGIN);
  if (n === 1) {
    const text = first.words.map((w) => w.text).join('');
    const at = placeIn(first.x0, first.x1, box, AMOUNT.test(text));
    if (at === 'center') {
      base.align = 'center';
      const centre = (first.x0 + first.x1) / 2;
      base.left = Math.max(0, 2 * centre - box.x1 - box.x0);
      base.right = Math.max(0, box.x1 + box.x0 - 2 * centre);
      if (measure) {
        // A fitted line is as wide as the room left for it: a little more on both sides, so that Word's own widths do not wrap it.
        base.left -= CENTRED_ROOM_PT;
        base.right -= CENTRED_ROOM_PT;
      }
    } else if (at === 'right') {
      base.align = 'right';
      base.right = box.x1 - first.x1;
      // Room to the left, so that a slightly wider font does not wrap it.
      base.left = Math.min(0, first.x0 - box.x0 - 12);
    } else {
      base.left = first.x0 - box.x0;
      base.right = Math.min(0, box.x1 - first.x1 - 12);
    }
    return base;
  }
  const rest = laid.slice(1);
  const left = Math.min(...rest.map((l) => l.x0));
  const centres = laid.map((l) => (l.x0 + l.x1) / 2);
  const centred = laid.some((l) => Math.abs(l.x0 - first.x0) > 2) && centres.every((c) => Math.abs(c - centres[0]) <= 2);
  if (centred) {
    base.align = 'center';
    base.left = Math.max(0, 2 * centres[0] - box.x1 - box.x0);
    base.right = Math.max(0, box.x1 + box.x0 - 2 * centres[0]);
    if (measure) {
      // Kept lines wider than what is left of the box have room on both sides.
      const wide = Math.max(...laid.map((l) => l.x1 - l.x0)) + 2 * CENTRED_ROOM_PT;
      const over = wide - (box.x1 - box.x0 - base.left - base.right);
      if (over > 0) {
        base.left -= over / 2;
        base.right -= over / 2;
      }
    }
    return base;
  }
  // Set right: every line ends at one edge and they start at different places. Not a paragraph whose number hangs
  // before it, nor one whose lines after the first share their start (those run from edge to edge).
  const rights = hang < 0 && !(n >= 3 && oneStart) && laid.every((l) => Math.abs(l.x1 - x1) <= 1.5) && laid.some((l) => Math.abs(l.x0 - first.x0) > 2);
  if (rights) {
    base.align = 'right';
    base.right = box.x1 - x1;
    // Kept lines never wrap: one that starts left of its box has room there.
    if (measure) base.left = Math.min(0, Math.min(...laid.map((l) => l.x0)) - box.x0 - 2);
    return base;
  }
  base.left = left - box.x0;
  base.first = Math.abs(first.x0 - left) >= 1 ? first.x0 - left : 0;
  // A little room on the right, so that the lines break where they broke on the page.
  if (n >= 3 && laid.slice(0, -1).every((l) => x1 - l.x1 <= 2)) base.align = 'both';
  base.right = measure ? box.x1 - x1 - (base.align === 'both' ? 1.5 : KEPT_ROOM_PT) : Math.max(0, box.x1 - x1 - 1.5);
  return base;
}

function isSetLineLaid(laid: Laid): boolean {
  let widest = 0;
  let narrowest = Infinity;
  for (let k = 1; k < laid.words.length; k++) {
    const gap = laid.words[k].x0 - laid.words[k - 1].x1;
    widest = Math.max(widest, gap);
    narrowest = Math.min(narrowest, gap);
  }
  // Words spread evenly along the line (a justified line of few words) are not pieces set apart.
  const spread = laid.words.length >= 3 && widest < 1.3 * narrowest;
  return (widest >= WIDE_GAP_EM * laid.size && !spread) || blanksOf(laid);
}

/** A turned cell's box as its text reads: along the lines, and where the first line stands. */
function cellSpan(cell: { x0: number; y0: number; x1: number; y1: number }, turn: number): { span: Span; top: number } {
  if (turn === 90) return { span: { x0: -cell.y1, x1: -cell.y0 }, top: cell.x0 };
  if (turn === 270) return { span: { x0: cell.y0, x1: cell.y1 }, top: -cell.x1 };
  return { span: { x0: cell.x0, x1: cell.x1 }, top: cell.y0 };
}

/**
 * The lines of a cell as paragraphs: lines that follow each other closely at one left edge in one size, the
 * one before running to the cell's right edge (the next line's first word would not have fitted), flow as
 * one paragraph; every other line is a paragraph of its own.
 */
export function cellParagraphs(cell: Pick<GridCell, 'x0' | 'y0' | 'x1' | 'y1' | 'lines' | 'turn'>, measure?: TextMeasure): ParaLook[] {
  const paras: ParaLook[] = [];
  const groups: Line[][] = [];
  const main = cell.lines.filter((l) => (l.turn ?? 0) === cell.turn);
  const { span } = cellSpan(cell, cell.turn);
  let prev: Laid | null = null;
  for (const line of main) {
    const laid = lay(line);
    if (!laid) continue;
    const group = groups[groups.length - 1];
    const flows =
      prev !== null &&
      group !== undefined &&
      !isSetLineLaid(prev) &&
      !isSetLineLaid(laid) &&
      Math.abs(prev.size - laid.size) <= 0.1 * Math.max(prev.size, laid.size) &&
      laid.base - prev.base > 0 &&
      laid.base - prev.base <= 1.7 * laid.size &&
      (group.length === 1 || Math.abs(laid.x0 - Math.min(...group.slice(1).map((l) => lay(l)?.x0 ?? laid.x0))) <= 1.5) &&
      span.x1 - prev.x1 < laid.words[0].x1 - laid.words[0].x0 + 0.5 * laid.size + 2 &&
      (group.length === 1 || Math.abs(laid.base - prev.base - (prev.base - (lay(group[group.length - 2])?.base ?? prev.base))) <= 1);
    if (flows) group.push(line);
    else groups.push([line]);
    prev = laid;
  }
  for (const group of groups) {
    const para = paragraphLook(group, span, undefined, measure);
    if (para) paras.push(para);
  }
  return paras;
}

/** The table a grid describes: its true cells row by row, with the spans Word needs. */
export function tableLook(grid: Grid, measure?: TextMeasure): TableLook {
  const R = grid.ys.length - 1;
  const C = grid.xs.length - 1;
  const owner: (GridCell | undefined)[] = new Array(R * C).fill(undefined);
  for (const cell of grid.cells) for (let r = cell.row; r < cell.row + cell.rowSpan; r++) for (let c = cell.col; c < cell.col + cell.colSpan; c++) owner[r * C + c] = cell;
  const none = { top: null, right: null, bottom: null, left: null };
  const rows: RowLook[] = [];
  for (let r = 0; r < R; r++) {
    const cells: CellLook[] = [];
    for (let c = 0; c < C; ) {
      const cell = owner[r * C + c];
      if (!cell) {
        cells.push({ colSpan: 1, paras: [], borders: none, turn: 0, y0: grid.ys[r], y1: grid.ys[r + 1] });
        c++;
        continue;
      }
      const start = cell.row === r;
      const lastRow = cell.row + cell.rowSpan - 1 === r;
      cells.push({
        colSpan: cell.colSpan,
        ...(cell.rowSpan > 1 ? { merge: start ? ('start' as const) : ('cont' as const) } : {}),
        paras: start ? cellParagraphs(cell, measure) : [],
        borders: { top: start ? cell.borders.top : null, right: cell.borders.right, bottom: lastRow ? cell.borders.bottom : null, left: cell.borders.left },
        ...(cell.shade ? { shade: cell.shade } : {}),
        turn: cell.turn,
        y0: cellSpan(cell, cell.turn).top,
        y1: cellSpan(cell, cell.turn).top + (cell.turn === 0 ? cell.y1 - cell.y0 : cell.x1 - cell.x0),
      });
      c = cell.col + cell.colSpan;
    }
    rows.push({ height: grid.ys[r + 1] - grid.ys[r], cells });
  }
  return { x0: grid.xs[0], widths: grid.xs.slice(1).map((x, i) => x - grid.xs[i]), rows, y0: grid.ys[0], y1: grid.ys[R] };
}
