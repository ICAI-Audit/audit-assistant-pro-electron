// Redact (design 5.9 "Boxes"): a page's text as pdf.js reports it, joined into one string with a map
// back to its items, and the boxes of any range of that string.
//
// COORDINATES. Every Rect here is in the page's PDF user space: points, origin and axes as the content
// stream draws them (y grows upward), before /Rotate and independent of the crop box. A Rect is
// axis-aligned in that space (x0 < x1, y0 < y1). The same numbers hold on a page with /Rotate 90, 180
// or 270: a reader turns the drawing, not the coordinates. To draw a Rect on a pdf.js drawing, pass
// [x0, y0, x1, y1] to the page viewport's convertToViewportRectangle (it applies the view's origin, the
// scale and the rotation); a redaction picture drawn with rotation 0 needs only its own viewport.
//
// Confidentiality: the model holds a page's text in memory for the review only. Nothing here logs it,
// formats it into a message or stores it.
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { PARSE_OBJECTS_PER_TICK } from './inspect';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES } from './types';

/** A pdf.js text item (getTextContent), as far as Redact reads it. `transform` and `width` are in user space. */
export interface TextItemLike {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

/** pdf.js text-content style of a font: a generic family name and ascent and descent in ems (either may be null). */
export interface FontStyleLike {
  fontFamily: string;
  ascent: number;
  descent: number;
  vertical: boolean;
}

/** The advance of one character at 100 px in the given font family (a canvas's measureText, or a table in tests). */
export type MeasureChar = (ch: string, family: string) => number;

/** The family measured for each generic name pdf.js reports. Any other name is measured as Arial. */
export const FALLBACK_FAMILY: Readonly<Record<string, string>> = { 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Courier New' };

export interface PageTextModel {
  /** 0-based page index. */
  pageIndex: number;
  /**
   * The items' strings joined, with '\n' after each item that ends a line; in the order pdf.js gives
   * them, except that items drawn backwards along one line are read in their order along it (readingOrder).
   */
  text: string;
  /** For each UTF-16 unit of `text`: [item index, unit index in the item's str], or null for an inserted '\n'. */
  map: readonly (readonly [number, number] | null)[];
  items: readonly TextItemLike[];
  styles: Readonly<Record<string, FontStyleLike>>;
  /** The page's visible box (crop box within media box) as [x0, y0, x1, y1] in user space. */
  view: readonly [number, number, number, number];
  /** The page's /Rotate (0, 90, 180 or 270). */
  rotate: number;
}

/** An axis-aligned rectangle in PDF user space (points, y up, before /Rotate); x0 < x1 and y0 < y1. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Added on every side of a box: covers the ink the per-character estimate can miss (0.41 pt in the trial). */
export const BOX_PAD_PT = 1.5;

/**
 * The page's text model. `items` and `styles` come from pdf.js getTextContent of the enlarged-view copy
 * (enlargedViewCopy), so text outside the crop box is in it; `view` and `rotate` must be those of the
 * page in the file itself (pdf.js page.view and page.rotate), so `outsideView` can be told.
 */
export function buildPageText(pageIndex: number, items: readonly TextItemLike[], styles: Readonly<Record<string, FontStyleLike>>, view: readonly number[], rotate: number): PageTextModel {
  const parts: string[] = [];
  const map: (readonly [number, number] | null)[] = [];
  /** Where a gap wider than 1 em on a line was written (as a space, for now). */
  const wide: number[] = [];
  let last = '';
  const insert = (sep: '\n' | ' ') => {
    parts.push(sep);
    map.push(null);
    last = sep;
  };
  let prev: TextItemLike | null = null;
  for (const [i, endsLine] of readingOrder(items, styles)) {
    const item = items[i];
    const str = typeof item.str === 'string' ? item.str : '';
    if (str.length > 0 && prev && last !== '\n') {
      // pdf.js does not always mark a change of line between items (text from a form XObject, or
      // drawn out of reading order): without a separator, words of two places would be read as one.
      const sep = separatorBetween(prev, item, styles);
      if (sep === '\n') insert('\n');
      else if (sep !== '' && !/\s/.test(last) && !/^\s/.test(str)) {
        if (sep === '\t') wide.push(map.length);
        insert(' ');
      }
    }
    // pdf.js's white-space item for a gap wider than 1 em on the line.
    if (prev && last !== '\n' && /^ +$/.test(str) && wideGap(item.width, prev)) wide.push(map.length);
    parts.push(str);
    for (let k = 0; k < str.length; k++) map.push([i, k]);
    if (str.length > 0) {
      last = str[str.length - 1];
      prev = item;
    }
    if (endsLine) insert('\n');
  }
  const v: [number, number, number, number] = [Math.min(view[0], view[2]), Math.min(view[1], view[3]), Math.max(view[0], view[2]), Math.max(view[1], view[3])];
  return { pageIndex, text: withCellEdges(parts.join(''), wide), map, items, styles, view: v, rotate: ((Math.round(rotate / 90) * 90) % 360 + 360) % 360 };
}

/**
 * Fix wave 4 (RX-PAT2): a gap wider than 1 em on a line is written as a tab, which the patterns read as a
 * cell's edge (no number joined across it; a name in the cell after a label). Not between two characters
 * set apart one by one (letter-spaced or boxed text, "R A M E S H   K U M A R"): there the wide gap is a
 * word's end within one value, and stays a space.
 */
function withCellEdges(text: string, wide: readonly number[]): string {
  if (wide.length === 0) return text;
  const chars = text.split('');
  for (const at of wide) {
    if (chars[at] !== ' ') continue;
    const spacedOut = /(?:^|\s)\S$/.test(text.slice(Math.max(0, at - 2), at)) && /^ *\S(?:\s|$)/.test(text.slice(at + 1, at + 8));
    if (!spacedOut) chars[at] = '\t';
  }
  return chars.join('');
}

/**
 * What separates two items that pdf.js gave without an end of line: '\n' when the next one runs
 * another way or sits on another line (its baseline more than half the font size away), ' ' when it
 * is raised or lowered by a quarter of the smaller font size or more (a superscript value after its
 * label, a footnote figure after a value) or on the same line but starts more than 0.1 em after the
 * previous one ends (or well before it), '' when it carries straight on (small capitals stay one word);
 * '\t' when that gap on the line is wider than 1 em (fix wave 4: a cell's edge, see wideGap).
 */
function separatorBetween(p: TextItemLike, q: TextItemLike, styles: Readonly<Record<string, FontStyleLike>>): '\n' | ' ' | '\t' | '' {
  if (styles[p.fontName]?.vertical || styles[q.fontName]?.vertical) return '\n';
  const [a, b, c, d, e, f] = p.transform;
  const [qa, qb, qc, qd, qe, qf] = q.transform;
  const dir = unit(a, b) ?? [1, 0];
  const qdir = unit(qa, qb) ?? [1, 0];
  if (dir[0] * qdir[0] + dir[1] * qdir[1] < 0.99) return '\n';
  const up = unit(c, d) ?? [-dir[1], dir[0]];
  const size = Math.hypot(c, d) || p.height || 10;
  const qsize = Math.hypot(qc, qd) || q.height || size;
  const across = (qe - e) * up[0] + (qf - f) * up[1];
  if (Math.abs(across) > 0.5 * size) return '\n';
  if (Math.abs(across) >= 0.25 * Math.min(size, qsize)) return ' ';
  const width = Number.isFinite(p.width) ? p.width : 0;
  const along = (qe - (e + dir[0] * width)) * dir[0] + (qf - (f + dir[1] * width)) * dir[1];
  if (wideGap(along, p)) return '\t';
  return along > 0.1 * size || along < -0.5 * size ? ' ' : '';
}

/** Wider than this many font sizes, a gap on a line is a cell's edge, written as a tab (fix wave 4, RX-PAT2). */
const WIDE_GAP_EM = 1;
/** Whether a gap of `width` after item `p` on its line is wider than WIDE_GAP_EM of p's font size. */
function wideGap(width: number, p: TextItemLike): boolean {
  const [, , c, d] = p.transform;
  const size = Math.hypot(c, d) || p.height || 10;
  return Number.isFinite(width) && width > WIDE_GAP_EM * size;
}

/** Letters of right-to-left scripts (Hebrew, Arabic, Syriac, Thaana, N'Ko and their presentation forms): their items run backwards by design. */
const RIGHT_TO_LEFT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;

/**
 * The order in which the items are read (fix wave, redact-e2e-review non-blocking 2): pdf.js gives them
 * in the order they are drawn. Items that follow one another on one line (no end of line between them,
 * none empty, the same direction, no right-to-left script) are read in their order along the line when
 * one of them starts clearly before the one drawn just before it (by more than 0.1 em): characters or
 * words drawn last to first, a label drawn after its amount. Every other line is read as drawn. Bounded:
 * one sort per such line. Each entry: the item's index, and whether a line ends after it (the end of
 * line pdf.js gave the line's last item drawn stays at the end of the line).
 */
function readingOrder(items: readonly TextItemLike[], styles: Readonly<Record<string, FontStyleLike>>): [number, boolean][] {
  const order: [number, boolean][] = [];
  let line: number[] = [];
  const flush = () => {
    const ends = line.length > 0 && items[line[line.length - 1]].hasEOL;
    if (line.length > 1) {
      const [a, b] = items[line[0]].transform;
      const dir = unit(a, b) ?? [1, 0];
      const start = (k: number) => items[k].transform[4] * dir[0] + items[k].transform[5] * dir[1];
      const size = (k: number) => Math.hypot(items[k].transform[2], items[k].transform[3]) || items[k].height || 10;
      const backwards = line.some((k, j) => j > 0 && start(k) < start(line[j - 1]) - 0.1 * size(line[j - 1]));
      if (backwards && !line.some((k) => RIGHT_TO_LEFT.test(items[k].str))) line = [...line].sort((p, q) => start(p) - start(q) || p - q);
    }
    line.forEach((k, j) => order.push([k, ends && j === line.length - 1]));
    line = [];
  };
  items.forEach((item, i) => {
    const str = typeof item.str === 'string' ? item.str : '';
    if (str.length === 0) {
      flush();
      order.push([i, item.hasEOL]);
      return;
    }
    if (line.length > 0 && separatorBetween(items[line[line.length - 1]], item, styles) === '\n') flush();
    line.push(i);
    if (item.hasEOL) flush();
  });
  flush();
  return order;
}

/** True when the page has any text pdf.js could read (a scan has none: only drawn boxes remove anything there). */
export function pageHasText(model: PageTextModel): boolean {
  return /\S/.test(model.text);
}

// ---- where each character of an item sits (fix round 1, F2) ----------------------------------------

/**
 * pdf.js gives an item's start and width, not where each character is. A piece of an item is placed by
 * one or more estimates of the characters' positions, and covers every estimate:
 * - per character: each character's advance in the fallback family (measured one at a time: a canvas
 *   would apply kerning to a whole string), the item's extra width given evenly to every character
 *   (letter-spacing, Tc), the same advances scaled to the item's width (a font a little narrower or
 *   wider than its fallback), and the extra width given to the spaces only (word spacing, Tw: a
 *   justified line written in one Tj; fix wave B7);
 * - when the fallback's widths do not fit the item (its width is under 0.97 or over 1.2 times what they
 *   add up to: a substituted or mis-reported font), or when the page has too little of the font to
 *   tell whether it is monospaced (fontClasses; fix round 2, MF2), also one advance per character;
 * - when they cannot be trusted at all (under 0.75 or over 1.35 times, or nothing measurable), the whole
 *   item;
 * - for a font the page shows to be monospaced but reported otherwise (fontClasses), one advance per
 *   character only.
 * Letter-spaced items (pdf.js has written a space between every character, from about 0.11 em of
 * letter-spacing) are placed by bounds: a real word space merged among the inserted ones cannot be told
 * from them, so every arrangement pdf.js's spacing limits allow is covered (letterSpacedBounds).
 */
interface ItemLayout {
  /** Positions along the item (user space, from its origin) of each UTF-16 unit boundary, one array per estimate. */
  estimates: number[][];
  /** Extra width on each side of every piece of this item. */
  margin: number;
  /** Cover the whole item, wherever the range falls in it. */
  whole: boolean;
  width: number;
}

const layoutCache = new WeakMap<PageTextModel, Map<MeasureChar, (ItemLayout | undefined)[]>>();
const LETTER_SPACED = /^\S(?: \S){2,}$/;

/** Cumulative positions from per-unit advances. */
const positions = (advances: readonly number[]) => {
  const out = [0];
  for (const a of advances) out.push(out[out.length - 1] + a);
  return out;
};

/** Per UTF-16 unit of `str`: its advance measured in `family` (user space), and whether it is a character that takes width. */
function measureUnits(str: string, family: string, along: number, measure: MeasureChar, spaced: boolean): { measured: number[]; counts: boolean[] } {
  const measured: number[] = [];
  const counts: boolean[] = [];
  for (const ch of str) {
    const inserted = spaced && ch === ' ';
    const w = inserted ? 0 : measure(ch, family);
    measured.push(Number.isFinite(w) && w > 0 ? (w / 100) * along : 0);
    counts.push(!inserted);
    if (ch.length === 2) {
      measured.push(0);
      counts.push(false);
    }
  }
  return { measured, counts };
}

type FontClass = 'mono' | 'normal';
const fontClassCache = new WeakMap<PageTextModel, Map<MeasureChar, Map<string, FontClass>>>();

/**
 * Which fonts of the page are monospaced faces the fallback family does not describe, judged on their
 * items of four characters or more that are not letter-spaced: 'mono' when every item is as wide as
 * its character count says (within 2%) while the measured widths disagree from item to item (by over
 * 8%), as for a monospaced font reported as sans-serif or serif. A proportional font's items vary with
 * letter- and word-spacing too, so only this specific pattern is acted on. A font with fewer than two
 * such items cannot be judged and has no entry (fix round 2, MF2: layoutOf then adds the per-character
 * estimate).
 */
function fontClasses(model: PageTextModel, measure: MeasureChar): Map<string, FontClass> {
  let byMeasure = fontClassCache.get(model);
  if (!byMeasure) fontClassCache.set(model, (byMeasure = new Map()));
  const cached = byMeasure.get(measure);
  if (cached) return cached;
  const ratios = new Map<string, { byCount: number[]; byMeasure: number[] }>();
  for (const item of model.items) {
    if (!(item.width > 0) || LETTER_SPACED.test(item.str) || Array.from(item.str.replace(/\s/g, '')).length < 4) continue;
    const along = Math.hypot(item.transform[0], item.transform[1]);
    const family = FALLBACK_FAMILY[model.styles[item.fontName]?.fontFamily ?? ''] ?? 'Arial';
    const total = measureUnits(item.str, family, along, measure, false).measured.reduce((s, w) => s + w, 0);
    if (!(total > 0) || !(along > 0)) continue;
    let r = ratios.get(item.fontName);
    if (!r) ratios.set(item.fontName, (r = { byCount: [], byMeasure: [] }));
    r.byCount.push(item.width / (Array.from(item.str).length * along));
    r.byMeasure.push(item.width / total);
  }
  const spread = (v: number[]) => Math.max(...v) / Math.min(...v) - 1;
  const classes = new Map<string, FontClass>();
  for (const [font, r] of ratios) {
    if (r.byCount.length < 2) continue;
    classes.set(font, spread(r.byCount) <= 0.02 && spread(r.byMeasure) > 0.08 ? 'mono' : 'normal');
  }
  byMeasure.set(measure, classes);
  return classes;
}

/**
 * A letter-spaced item: pdf.js puts one space in every gap between 0.102 and 0.6 em, so letters stand
 * Tc apart (Tc above 0.102 em) and a word space merged among them stands `space + 2 Tc` apart (at most
 * 0.6 em). From the item's width and its characters' widths, every count of merged word spaces that
 * fits these limits is tried, each with its word spaces all at the start and all at the end; the
 * earliest start and the latest end of each character over all of them bound where it can be.
 */
function letterSpacedBounds(measured: readonly number[], counts: readonly boolean[], width: number, size: number, space: number): number[][] | null {
  const w = measured.filter((_, k) => counts[k]);
  const n = w.length;
  if (n < 2) return null;
  const before = [0];
  for (const x of w) before.push(before[before.length - 1] + x);
  const surplus = width - before[n];
  if (surplus < 0) return null;
  const lower = Array.from({ length: n }, () => Infinity);
  const upperEnd = Array.from({ length: n }, () => -Infinity);
  for (let m = 0; m <= n - 1; m++) {
    const tc = (surplus - m * space) / (n - 1 + m);
    if (m > 0 && !(tc >= 0.08 * size && tc <= (0.62 * size - 0.9 * space) / 2)) continue;
    for (let g = 0; g < n; g++) {
      const lateGaps = Math.max(0, g - (n - 1 - m));
      lower[g] = Math.min(lower[g], before[g] + g * tc + lateGaps * (space + tc));
      upperEnd[g] = Math.max(upperEnd[g], before[g + 1] + g * tc + Math.min(g, m) * (space + tc));
    }
  }
  // By UTF-16 unit boundary: where the next character can start at the earliest, and where the
  // previous one can end at the latest.
  const starts: number[] = [];
  const ends: number[] = [];
  let g = 0;
  for (let u = 0; u <= counts.length; u++) {
    starts.push(g < n ? lower[g] : width);
    ends.push(g > 0 ? upperEnd[g - 1] : 0);
    if (u < counts.length && counts[u]) g++;
  }
  return [starts, ends];
}

function layoutOf(model: PageTextModel, itemIndex: number, measure: MeasureChar): ItemLayout {
  let byMeasure = layoutCache.get(model);
  if (!byMeasure) layoutCache.set(model, (byMeasure = new Map()));
  let list = byMeasure.get(measure);
  if (!list) byMeasure.set(measure, (list = []));
  const cached = list[itemIndex];
  if (cached) return cached;

  const item = model.items[itemIndex];
  const str = item.str;
  const width = Number.isFinite(item.width) && item.width > 0 ? item.width : 0;
  const along = Math.hypot(item.transform[0], item.transform[1]);
  const size = Math.hypot(item.transform[2], item.transform[3]) || along;
  const family = FALLBACK_FAMILY[model.styles[item.fontName]?.fontFamily ?? ''] ?? 'Arial';
  const spaced = LETTER_SPACED.test(str);
  const { measured, counts } = measureUnits(str, family, along, measure, spaced);
  const glyphs = counts.filter(Boolean).length;
  const total = measured.reduce((s, w) => s + w, 0);
  const ratio = total > 0 ? width / total : NaN;
  const byCount = positions(counts.map((c) => (c && glyphs > 0 ? width / glyphs : 0)));
  const fontClass = fontClasses(model, measure).get(item.fontName);
  let layout: ItemLayout;
  if (spaced) {
    const space = (measure(' ', family) / 100) * along || 0.278 * along;
    const bounds = total > 0 ? letterSpacedBounds(measured, counts, width, size, space) : null;
    layout = bounds ? { estimates: [...bounds, byCount], margin: 0, whole: false, width } : { estimates: [byCount], margin: 0, whole: glyphs >= 3, width };
  } else if (fontClass === 'mono') {
    layout = { estimates: [positions(counts.map((c) => (c && str.length > 0 ? width / Array.from(str).length : 0)))], margin: 0, whole: false, width };
  } else {
    const estimates: number[][] = [];
    if (total > 0 && width > 0) {
      if (width >= total) estimates.push(positions(measured.map((w, k) => (counts[k] ? w + (width - total) / glyphs : 0))));
      estimates.push(positions(measured.map((w) => (w * width) / total)));
      // Word spacing (Tw: a justified line in one Tj) widens the spaces only (fix wave, redact-e2e-review
      // B7): with many more spaces on one side of a value than the other, spreading the surplus over every
      // character puts the value a character early. With letter-spacing too, the truth lies between this
      // estimate and the even one above, and the union covers it. Only a surplus: a shortfall comes mostly
      // from a space pdf.js inserted for a kerning gap narrower than a space (measured as a whole one),
      // which the scaled estimate already places within the plan's 0.7 pt (positions file, C5).
      // `measured` and `counts` run by UTF-16 unit, so a space is str[k].
      const isSpace = (k: number) => counts[k] && str[k] === ' ';
      const spaceUnits = measured.reduce((n, _, k) => n + (isSpace(k) ? 1 : 0), 0);
      if (spaceUnits > 0 && width > total) {
        const perSpace = (width - total) / spaceUnits;
        estimates.push(positions(measured.map((w, k) => (isSpace(k) ? w + perSpace : w))));
      }
    }
    // Per character too when the fallback's widths do not fit the item, or when the page cannot tell
    // whether the font is monospaced (fix round 2, MF2: one line of a monospaced face reported as
    // sans-serif, its wide and narrow letters cancelling out to a fitting width).
    if (!(ratio >= 0.97 && ratio <= 1.2) || fontClass === undefined) estimates.push(byCount);
    if (estimates.length === 0) estimates.push(byCount);
    const untrusted = glyphs >= 3 && (!(total > 0) || ratio < 0.75 || ratio > 1.35);
    layout = { estimates, margin: 0, whole: untrusted, width };
  }
  list[itemIndex] = layout;
  return layout;
}

// ---- pieces and boxes ------------------------------------------------------------------------------

/** One item's share of a range: where its characters start and how far they run, in user space. */
export interface RangePiece {
  itemIndex: number;
  /** UTF-16 units [from, to) of the item's str. */
  from: number;
  to: number;
  /** The baseline point where the piece starts. */
  origin: [number, number];
  /** Unit vector along the text. */
  direction: [number, number];
  /** Unit vector toward the top of the glyphs. */
  up: [number, number];
  /** Length along the text, in user space. */
  length: number;
  /** Font size in user space (|(c, d)| of the item's transform). */
  size: number;
  /** Extent across the line, in user space, below (negative) and above the baseline: from the font's descent and ascent. */
  below: number;
  above: number;
  /** Corners of the piece's box, unpadded. */
  corners: [number, number][];
}

const unit = (x: number, y: number): [number, number] | null => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? [x / n, y / n] : null;
};

function pieceOf(model: PageTextModel, itemIndex: number, from: number, to: number, measure: MeasureChar): RangePiece {
  const item = model.items[itemIndex];
  const style = model.styles[item.fontName];
  const [a, b, c, d, e, f] = item.transform;
  const direction = unit(a, b) ?? [1, 0];
  const up = unit(c, d) ?? [-direction[1], direction[0]];
  const size = Math.hypot(c, d) || item.height || Math.hypot(a, b) || 10;
  const ascent = typeof style?.ascent === 'number' && Number.isFinite(style.ascent) ? style.ascent : 0;
  const descent = typeof style?.descent === 'number' && Number.isFinite(style.descent) ? style.descent : 0;
  let below = Math.min(descent, -0.25) * size;
  let above = Math.max(ascent, 0.9) * size;
  let s0: number;
  let s1: number;
  if (style?.vertical) {
    // Vertical writing runs down from the origin; where a character sits inside the item is not
    // estimated: the whole item is covered, half an em wider on each side.
    const run = Math.max(item.height || 0, item.width || 0);
    const corners: [number, number][] = [];
    for (const [s, t] of [
      [-0.6 * size, 0.3 * size + run],
      [0.6 * size, 0.3 * size + run],
      [-0.6 * size, -size],
      [0.6 * size, -size],
    ] as const) {
      corners.push([e + direction[0] * s - up[0] * t, f + direction[1] * s - up[1] * t]);
    }
    return { itemIndex, from: 0, to: item.str.length, origin: [e, f], direction, up, length: run, size, below: -run, above: size, corners };
  }
  const layout = layoutOf(model, itemIndex, measure);
  if (layout.whole) {
    s0 = 0;
    s1 = layout.width;
  } else {
    const at = (e: number[], k: number) => e[Math.min(k, e.length - 1)];
    s0 = Math.min(...layout.estimates.map((e) => at(e, from))) - layout.margin;
    s1 = Math.max(...layout.estimates.map((e) => at(e, to))) + layout.margin;
  }
  if (s1 < s0) [s0, s1] = [s1, s0];
  if (!Number.isFinite(below)) below = -0.25 * size;
  if (!Number.isFinite(above)) above = 0.9 * size;
  const at = (s: number, t: number): [number, number] => [e + direction[0] * s + up[0] * t, f + direction[1] * s + up[1] * t];
  return {
    itemIndex,
    from,
    to,
    origin: at(s0, 0),
    direction,
    up,
    length: s1 - s0,
    size,
    below,
    above,
    corners: [at(s0, below), at(s1, below), at(s0, above), at(s1, above)],
  };
}

/**
 * The pieces of [start, end) of `model.text`, one per item touched, in order. Spaces at the edges of a
 * piece are left out, and a piece of spaces only is skipped.
 */
export function rangePieces(model: PageTextModel, start: number, end: number, measure: MeasureChar): RangePiece[] {
  const spans = new Map<number, [number, number]>();
  const order: number[] = [];
  for (let k = Math.max(0, start); k < Math.min(end, model.map.length); k++) {
    const at = model.map[k];
    if (!at) continue;
    const [i, j] = at;
    const cur = spans.get(i);
    if (cur) cur[1] = Math.max(cur[1], j + 1);
    else {
      spans.set(i, [j, j + 1]);
      order.push(i);
    }
  }
  const pieces: RangePiece[] = [];
  for (const i of order) {
    let [from, to] = spans.get(i)!;
    const str = model.items[i].str;
    while (from < to && /\s/.test(str[from])) from++;
    while (to > from && /\s/.test(str[to - 1])) to--;
    if (to <= from) continue;
    pieces.push(pieceOf(model, i, from, to, measure));
  }
  return pieces;
}

const bounds = (points: readonly [number, number][]): Rect => ({
  x0: Math.min(...points.map((p) => p[0])),
  y0: Math.min(...points.map((p) => p[1])),
  x1: Math.max(...points.map((p) => p[0])),
  y1: Math.max(...points.map((p) => p[1])),
});

/** Extent of a piece across its line, measured along `up` from the page origin. */
const across = (p: RangePiece, up: [number, number]): [number, number] => {
  const values = p.corners.map(([x, y]) => x * up[0] + y * up[1]);
  return [Math.min(...values), Math.max(...values)];
};

/** Two pieces sit on one line when they run the same way and overlap across the line by half the smaller height. */
function sameLine(a: RangePiece, b: RangePiece): boolean {
  if (a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] < 0.999) return false;
  const [a0, a1] = across(a, a.up);
  const [b0, b1] = across(b, a.up);
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  return overlap >= 0.5 * Math.min(a1 - a0, b1 - b0);
}

/**
 * The boxes of [start, end) of `model.text`: one per line it covers, the pieces of a line joined into
 * one (so a value written as three groups is one box), each padded by `padPt` on every side.
 * Each piece is placed by the per-character advances of the font's fallback family (`measure`), never
 * the whole string at once, scaled to the width pdf.js gives the item; vertically from
 * min(descent, -0.25) to max(ascent, 0.9) of the font size.
 */
export function rangeRects(model: PageTextModel, start: number, end: number, measure: MeasureChar, padPt: number = BOX_PAD_PT): Rect[] {
  const pieces = rangePieces(model, start, end, measure);
  const lines: RangePiece[][] = [];
  for (const piece of pieces) {
    const line = lines.find((l) => l.some((p) => sameLine(p, piece)));
    if (line) line.push(piece);
    else lines.push([piece]);
  }
  // A piece can bridge two lines that were apart: join until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[i].some((p) => lines[j].some((q) => sameLine(p, q)))) {
          lines[i].push(...lines[j]);
          lines.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return lines.map((line) => {
    const r = bounds(line.flatMap((p) => p.corners));
    return { x0: r.x0 - padPt, y0: r.y0 - padPt, x1: r.x1 + padPt, y1: r.y1 + padPt };
  });
}

/** Each run of non-space characters of the page text, as [start, end). */
export function wordRanges(model: PageTextModel): [number, number][] {
  return [...model.text.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
}

/** The unpadded box of a word (all its lines joined, which for a word is one). */
export function wordRect(model: PageTextModel, range: readonly [number, number], measure: MeasureChar): Rect {
  const rects = rangeRects(model, range[0], range[1], measure, 0);
  if (rects.length === 0) {
    const at = model.map[range[0]];
    const t = at ? model.items[at[0]].transform : [0, 0, 0, 0, 0, 0];
    return { x0: t[4], y0: t[5], x1: t[4], y1: t[5] };
  }
  return { x0: Math.min(...rects.map((r) => r.x0)), y0: Math.min(...rects.map((r) => r.y0)), x1: Math.max(...rects.map((r) => r.x1)), y1: Math.max(...rects.map((r) => r.y1)) };
}

// ---- reading by position, and words broken at a line end (fix wave 3, Ruling C) -------------------------

/** One way of reading a page's text (Ruling C). Held in memory only: never logged, stored or formatted. */
export interface TextReading {
  /** The text as read. */
  text: string;
  /** For each UTF-16 unit of `text`: its offset in the model's `text`, or -1 for a separator this reading put in. */
  from: Int32Array;
  /** A block read by position (not the drawing order): the find takes only sure values and typed words from it (a table column of numbers read top to bottom is not a number). */
  byPosition?: true;
}

/**
 * A piece of text placed on a page, for reading by position: its origin on the baseline (user space), the
 * unit direction of the text, its advance along that direction, its size (the em), and whether it is white
 * space only (pdf.js puts in white-space items as wide as a gap, so they would bridge a column gutter).
 */
export interface LinePiece {
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
  size: number;
  blank?: boolean;
}

/** Hyphens a word is broken with at a line end: hyphen-minus, soft hyphen, hyphen, non-breaking hyphen. */
const HYPHENS = String.fromCharCode(0x2d, 0xad, 0x2010, 0x2011);
/** A letter, a hyphen, a line break with white space around it, a letter: a word broken at a line end. */
const LINE_END_HYPHEN = new RegExp(`(?<=\\p{L})[${HYPHENS.replace('-', '\\-')}][^\\S\\n]*\\n[^\\S\\n]*(?=\\p{L})`, 'gu');
/** Between two pieces of one place: nothing a reader would read as text (white space, line breaks, the hyphen of a broken word). */
const DROPPABLE = new RegExp(`^[\\s${HYPHENS.replace('-', '\\-')}]*$`);

/** Ruling C (a): `reading` with each word broken at a line end by a hyphen joined again ("Ku-" + line break + "mar" reads "Kumar"); null when there is none. */
function rejoined(reading: TextReading): TextReading | null {
  const breaks = [...reading.text.matchAll(LINE_END_HYPHEN)];
  if (breaks.length === 0) return null;
  const parts: string[] = [];
  const from: number[] = [];
  let at = 0;
  const keep = (end: number) => {
    parts.push(reading.text.slice(at, end));
    for (let k = at; k < end; k++) from.push(reading.from[k]);
  };
  for (const m of breaks) {
    keep(m.index);
    at = m.index + m[0].length;
  }
  keep(reading.text.length);
  return { text: parts.join(''), from: Int32Array.from(from), ...(reading.byPosition ? { byPosition: true as const } : {}) };
}

/**
 * Ruling I: each line that holds a right-to-left script (Urdu, Arabic, Hebrew) read in its logical order. pdf.js
 * gives such a line as it is drawn, left to right; a reader reads it right to left, where a number written in groups
 * ("2345 6789 0124") has its groups laid out right to left, so the file holds "6789 2345". The line's runs are put
 * back in reading order: its right-to-left letters one by one, white space, and each run of other characters, a run
 * of Latin words joined by spaces kept as one (as the bidirectional rules lay it out); numbers separated by spaces
 * are runs of their own. Lines without such a script are left as they are. Null when the reading has none.
 */
function rightToLeftReading(reading: TextReading): TextReading | null {
  const { text } = reading;
  if (!RIGHT_TO_LEFT.test(text)) return null;
  const parts: string[] = [];
  const from: number[] = [];
  const emit = (a: number, b: number) => {
    parts.push(text.slice(a, b));
    for (let k = a; k < b; k++) from.push(reading.from[k]);
  };
  const isRtl = (ch: string) => RIGHT_TO_LEFT.test(ch);
  const latin = (a: number, b: number) => /[A-Za-z]/.test(text.slice(a, b));
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== '\n') continue;
    if (RIGHT_TO_LEFT.test(text.slice(lineStart, i))) {
      const runs: [number, number][] = [];
      for (let k = lineStart; k < i; ) {
        let e = k + 1;
        if (/\s/.test(text[k])) while (e < i && /\s/.test(text[e])) e++;
        else if (!isRtl(text[k])) while (e < i && !/\s/.test(text[e]) && !isRtl(text[e])) e++;
        runs.push([k, e]);
        k = e;
      }
      // Latin words with only spaces between them stay one left-to-right run.
      const merged: [number, number][] = [];
      for (const run of runs) {
        const last = merged[merged.length - 1];
        const gap = merged[merged.length - 2];
        if (last && gap && latin(...run) && latin(...gap) && /^\s+$/.test(text.slice(...last)) && gap[1] === last[0] && last[1] === run[0]) {
          merged.pop();
          gap[1] = run[1];
        } else merged.push([run[0], run[1]]);
      }
      for (let r = merged.length - 1; r >= 0; r--) emit(merged[r][0], merged[r][1]);
    } else emit(lineStart, i);
    if (i < text.length) emit(i, i + 1);
    lineStart = i + 1;
  }
  return { text: parts.join(''), from: Int32Array.from(from) };
}

/** The angle of a direction to the nearest degree: pieces in one such group are read as one frame. */
const angleKey = (dx: number, dy: number) => Math.round((Math.atan2(dy, dx) * 180) / Math.PI);

interface Laid {
  index: number;
  along0: number;
  along1: number;
  across: number;
  size: number;
}

interface Segment {
  line: number;
  along0: number;
  along1: number;
  size: number;
  members: number[];
}

/**
 * Ruling C (b): the blocks of a group of pieces that run one way. Lines by baseline (within half a size);
 * a line is cut at a gap of half a size or more whose far edge lines up (within 0.05 size, at least 0.5)
 * with where pieces start after a gap on two of the four nearest lines (two above, two below), or whose
 * near edge lines up with where pieces end before a gap on two of them (a column gutter, a table cell's
 * edge), or on one of them when the gap is two sizes or more; a justified line's wide spaces do not line
 * up with its neighbours', so it stays whole (a paragraph repeated further down does not count). A segment is
 * joined to the one below it when, on the nearest line below within 2.2 sizes that has any segment
 * overlapping it, that is the only one, and the reverse holds, and their sizes differ by less than a third.
 */
function blocksOfGroup(laid: readonly Laid[]): number[][][] {
  const sorted = [...laid].sort((p, q) => q.across - p.across || p.along0 - q.along0);
  const lines: { across: number; size: number; pieces: Laid[] }[] = [];
  for (const p of sorted) {
    const line = lines[lines.length - 1];
    if (line && line.across - p.across <= 0.5 * Math.min(line.size, p.size)) line.pieces.push(p);
    else lines.push({ across: p.across, size: p.size, pieces: [p] });
  }
  // Where pieces start after a gap (or start a line) and end before one (or end it), per line.
  const gapsOf = lines.map((line) => {
    const pieces = [...line.pieces].sort((p, q) => p.along0 - q.along0);
    line.pieces = pieces;
    const starts: number[] = [];
    const ends: number[] = [];
    const gaps: { after: number; g0: number; g1: number }[] = [];
    let end = -Infinity;
    pieces.forEach((p, k) => {
      if (k === 0) starts.push(p.along0);
      else if (p.along0 - end >= 0.5 * line.size) {
        ends.push(end);
        starts.push(p.along0);
        gaps.push({ after: k, g0: end, g1: p.along0 });
      }
      end = Math.max(end, p.along1);
    });
    ends.push(end);
    return { starts, ends, gaps };
  });
  const count = (values: (l: number) => readonly number[], at: number, tol: number, self: number) => {
    let n = 0;
    for (let l = Math.max(0, self - 2); l <= Math.min(lines.length - 1, self + 2); l++) if (l !== self && values(l).some((v) => Math.abs(v - at) <= tol)) n++;
    return n;
  };
  const segments: Segment[] = [];
  const byLine: Segment[][] = lines.map(() => []);
  lines.forEach((line, l) => {
    const tol = Math.max(0.5, 0.05 * line.size);
    const cuts = new Set<number>();
    for (const g of gapsOf[l].gaps) {
      const starts = count((k) => gapsOf[k].starts, g.g1, tol, l);
      const ends = count((k) => gapsOf[k].ends, g.g0, tol, l);
      if (starts >= 2 || ends >= 2 || ((starts >= 1 || ends >= 1) && g.g1 - g.g0 >= 2 * line.size)) cuts.add(g.after);
    }
    let current: Segment | null = null;
    line.pieces.forEach((p, k) => {
      if (!current || cuts.has(k)) {
        current = { line: l, along0: p.along0, along1: p.along1, size: p.size, members: [] };
        segments.push(current);
        byLine[l].push(current);
      }
      current.members.push(p.index);
      current.along0 = Math.min(current.along0, p.along0);
      current.along1 = Math.max(current.along1, p.along1);
      current.size = Math.max(current.size, p.size);
    });
  });
  const overlaps = (a: Segment, b: Segment) => Math.min(a.along1, b.along1) - Math.max(a.along0, b.along0) > 0;
  /** The only segment overlapping `s` on the nearest line (stepping `step`) within 2.2 sizes that has any; null when none or several. */
  const neighbour = (s: Segment, step: 1 | -1): Segment | null => {
    for (let l = s.line + step; l >= 0 && l < lines.length; l += step) {
      if (Math.abs(lines[s.line].across - lines[l].across) > 2.2 * s.size) return null;
      const hits = byLine[l].filter((t) => overlaps(s, t));
      if (hits.length > 0) return hits.length === 1 ? hits[0] : null;
    }
    return null;
  };
  const next = new Map<Segment, Segment>();
  const linked = new Set<Segment>();
  for (const s of segments) {
    const below = neighbour(s, 1);
    if (!below || neighbour(below, -1) !== s) continue;
    const ratio = below.size / s.size;
    if (!(ratio > 0.75 && ratio < 1.34)) continue;
    next.set(s, below);
    linked.add(below);
  }
  const blocks: number[][][] = [];
  for (const s of segments) {
    if (linked.has(s) || !next.has(s)) continue;
    const block: number[][] = [];
    for (let at: Segment | undefined = s; at; at = next.get(at)) block.push(at.members);
    blocks.push(block);
  }
  return blocks;
}

/**
 * Ruling C (b): the blocks of a page's pieces read by position: each block's lines top to bottom (a column
 * of a page, the lines of one table cell, a column of a table), each line its piece indices in order along
 * it. Only blocks of two lines or more. White-space and sizeless pieces are left out. Pure: no state.
 */
export function textBlocks(pieces: readonly LinePiece[]): number[][][] {
  const groups = new Map<number, Laid[]>();
  pieces.forEach((p, index) => {
    if (p.blank || !(p.size > 0) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !(Math.hypot(p.dx, p.dy) > 0)) return;
    const key = angleKey(p.dx, p.dy);
    const theta = (key * Math.PI) / 180;
    const [c, s] = [Math.cos(theta), Math.sin(theta)];
    const along0 = p.x * c + p.y * s;
    const laid = { index, along0, along1: along0 + (Number.isFinite(p.width) ? Math.max(0, p.width) : 0), across: -p.x * s + p.y * c, size: p.size };
    const group = groups.get(key);
    if (group) group.push(laid);
    else groups.set(key, [laid]);
  });
  const blocks: number[][][] = [];
  for (const group of groups.values()) blocks.push(...blocksOfGroup(group));
  return blocks;
}

/** Each item of the model as a piece, and the range of the model's text its string takes (null when none). */
function modelPieces(model: PageTextModel): { pieces: LinePiece[]; spans: ([number, number] | null)[] } {
  const spans: ([number, number] | null)[] = model.items.map(() => null);
  model.map.forEach((at, k) => {
    if (!at) return;
    const span = spans[at[0]];
    if (span) span[1] = Math.max(span[1], k + 1);
    else spans[at[0]] = [k, k + 1];
  });
  const pieces = model.items.map((item, i): LinePiece => {
    const [a, b, c, d, e, f] = item.transform;
    const dir = unit(a, b) ?? [1, 0];
    const str = typeof item.str === 'string' ? item.str : '';
    const vertical = model.styles[item.fontName]?.vertical === true;
    return { x: e, y: f, dx: dir[0], dy: dir[1], width: Number.isFinite(item.width) ? item.width : 0, size: Math.hypot(c, d) || item.height || 10, blank: vertical || spans[i] === null || !/\S/.test(str) };
  });
  return { pieces, spans };
}

/** A block of the page read as text: its lines joined by line breaks, the pieces of a line by a space where they stand apart. */
function blockReading(model: PageTextModel, block: readonly (readonly number[])[], pieces: readonly LinePiece[], spans: readonly ([number, number] | null)[]): TextReading & { byPosition: true } {
  const parts: string[] = [];
  const from: number[] = [];
  const separator = (ch: string) => {
    parts.push(ch);
    from.push(-1);
  };
  block.forEach((line, l) => {
    if (l > 0) separator('\n');
    let end = -Infinity;
    line.forEach((i, k) => {
      const p = pieces[i];
      const along = p.x * p.dx + p.y * p.dy;
      if (k > 0 && along - end > 0.1 * p.size) separator(' ');
      end = Math.max(end, along + p.width);
      const span = spans[i];
      if (!span) return;
      parts.push(model.text.slice(span[0], span[1]));
      for (let u = span[0]; u < span[1]; u++) from.push(u);
    });
  });
  return { text: parts.join(''), from: Int32Array.from(from), byPosition: true };
}

/** True when the reading follows the model's own text (only white space left out between its pieces): the drawing order already reads it so. */
function inDrawingOrder(model: PageTextModel, reading: TextReading): boolean {
  let last = -1;
  for (const o of reading.from) {
    if (o < 0) continue;
    if (last >= 0 && (o <= last || !DROPPABLE.test(model.text.slice(last + 1, o)))) return false;
    last = o;
  }
  return true;
}

/**
 * Every reading of the page (fix wave 3, Ruling C), the first always the model's own text in drawing
 * order: (a) the same with each word broken at a line end by a hyphen joined again; (b) each block read by
 * position (textBlocks: a column, a table cell, a table column) whose order differs from the drawing order,
 * each its own reading (never joined to another block), as it stands and with (a). Pure: pass the result
 * to placesInReadings to search the page more than once.
 */
export function pageReadings(model: PageTextModel): readonly TextReading[] {
  const kept = (model as { [READINGS]?: readonly TextReading[] })[READINGS];
  if (kept) return kept;
  const identity: TextReading = { text: model.text, from: Int32Array.from({ length: model.text.length }, (_, k) => k) };
  const readings = [identity];
  const add = (reading: TextReading) => {
    readings.push(reading);
    const again = rejoined(reading);
    if (again) readings.push(again);
  };
  const again = rejoined(identity);
  if (again) readings.push(again);
  // Lines in a right-to-left script in their logical order (Ruling I).
  const logical = rightToLeftReading(identity);
  if (logical) add(logical);
  const { pieces, spans } = modelPieces(model);
  for (const block of textBlocks(pieces)) {
    const reading = blockReading(model, block, pieces, spans);
    if (!inDrawingOrder(model, reading)) add(reading);
  }
  try {
    // Kept on the model itself (not in module state): their text is the model's own, and goes with it.
    Object.defineProperty(model, READINGS, { value: readings, enumerable: false });
  } catch {
    // a frozen model: made again next time
  }
  return readings;
}

/** Where pageReadings keeps a model's readings on the model. */
const READINGS = Symbol('pageReadings');

/** The ranges of the model's text a place [start, end) of a reading stands for: one per run of offsets with nothing but white space or a broken word's hyphen between them. */
function modelRanges(model: PageTextModel, reading: TextReading, start: number, end: number): [number, number][] {
  const runs: [number, number][] = [];
  let first = -1;
  let last = -1;
  for (let k = Math.max(0, start); k < Math.min(end, reading.from.length); k++) {
    const o = reading.from[k];
    if (o < 0) continue;
    if (first < 0) {
      first = last = o;
      continue;
    }
    if (o > last && DROPPABLE.test(model.text.slice(last + 1, o))) {
      last = o;
      continue;
    }
    runs.push([first, last + 1]);
    first = last = o;
  }
  if (first >= 0) runs.push([first, last + 1]);
  return runs.filter(([s, e]) => /\S/.test(model.text.slice(s, e)));
}

/**
 * Every place `find` gives in any reading of the page (Ruling C), without repeats, as ranges of the
 * model's text: one range per run of consecutive offsets, so each piece on its own line is its own range
 * (rangeRects of each gives that piece's boxes); in the drawing-order reading a place is one range.
 * `text` is the place as the reading reads it. `readings` defaults to pageReadings(model).
 */
export function placesInReadings<T extends { start: number; end: number }>(
  model: PageTextModel,
  find: (text: string) => Iterable<T>,
  readings: readonly TextReading[] = pageReadings(model),
): { place: T; ranges: [number, number][]; text: string }[] {
  const out: { place: T; ranges: [number, number][]; text: string }[] = [];
  const seen = new Set<string>();
  for (const reading of readings) {
    for (const place of find(reading.text)) {
      if (!(place.end > place.start)) continue;
      const ranges = modelRanges(model, reading, place.start, place.end);
      if (ranges.length === 0) continue;
      const key = `${ranges.map(([s, e]) => `${s}-${e}`).join('_')}|${JSON.stringify(Object.entries(place).filter(([k]) => k !== 'start' && k !== 'end'))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ place, ranges, text: reading.text.slice(place.start, place.end) });
    }
  }
  return out;
}

/** How much of the end of one page and the start of the next a page turn is read with. */
const SEAM_CHARS = 300;
/** The most lines at the end of a page, and at the start of the next, a page turn is read with. */
const SEAM_LINES = 16;
/** The most candidate furniture lines each tried kept in (Ruling G: with and without each). */
const SEAM_CANDIDATES = 6;
/** Ruling Q: the most lines left out at the end of one page, and at the start of the next (furniture lines among them are not counted). */
const SEAM_LEFT_OUT = 4;
/** Ruling Q: what a reading with lines left out keeps on each side of the turn: at most this many lines, and about this many characters. */
const SEAM_NEAR_LINES = 3;
const SEAM_NEAR_CHARS = 64;
/**
 * What stands between two ways of reading a page turn when they are searched as one text: no value's place
 * runs through it (letters and digits no rule skips), and a place that touches it is not taken (the ways
 * are then searched one by one). Never part of a page's text; never shown.
 */
const SEAM_FENCE = '\n\nQZ9XJ7QZ\n\n';
/** In a reading's `from`: a character of SEAM_FENCE. */
const FENCED = -2;

/** A line of a page's text as the page turn reads it (or one cell of it): its range in the model's text, its words in a fixed form, and where it stands. */
interface SeamLine {
  start: number;
  end: number;
  /** The text in lower case, white space collapsed, every run of digits as '#': the same heading or footer on every page reads alike. */
  key: string;
  x: number;
  y: number;
  size: number;
  /** The line holds a gap wider than 1 em (a tab): a row of cells. */
  row: boolean;
}

/** [start, end) of the model's text without the white space at its edges, as a line placed by its first item; null when nothing is left. */
function seamPiece(model: PageTextModel, from: number, to: number): SeamLine | null {
  let a = from;
  let b = to;
  while (a < b && /\s/.test(model.text[a])) a++;
  while (b > a && /\s/.test(model.text[b - 1])) b--;
  const at = a < b ? model.map[a] : null;
  if (!at) return null;
  const item = model.items[at[0]];
  const [, , c, d, e, f] = item.transform;
  const text = model.text.slice(a, b);
  return { start: a, end: b, key: text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' '), x: e, y: f, size: Math.hypot(c, d) || item.height || 10, row: text.includes('\t') };
}

/** Where a page's lines are kept on its model (a page is read at two turns: the one before it and the one after). */
const SEAM_LINES_OF = Symbol('seamLines');

/** The lines of a page in drawing order (its text between line breaks, edges trimmed), each placed by its first item. */
function seamLines(model: PageTextModel): readonly SeamLine[] {
  const kept = (model as { [SEAM_LINES_OF]?: readonly SeamLine[] })[SEAM_LINES_OF];
  if (kept) return kept;
  const lines: SeamLine[] = [];
  let from = 0;
  for (let i = 0; i <= model.text.length; i++) {
    if (i < model.text.length && model.text[i] !== '\n') continue;
    const line = seamPiece(model, from, i);
    if (line) lines.push(line);
    from = i + 1;
  }
  try {
    Object.defineProperty(model, SEAM_LINES_OF, { value: lines, enumerable: false });
  } catch {
    // a frozen model: made again next time
  }
  return lines;
}

/** The cells of a line: its text between tabs (a gap wider than 1 em, see buildPageText), each placed by its own first item; the line itself when it has none. */
function seamCells(model: PageTextModel, line: SeamLine): SeamLine[] {
  if (!line.row) return [line];
  const cells: SeamLine[] = [];
  let from = line.start;
  for (let i = line.start; i <= line.end; i++) {
    if (i < line.end && model.text[i] !== '\t') continue;
    const cell = seamPiece(model, from, i);
    if (cell) cells.push(cell);
    from = i + 1;
  }
  return cells;
}

/** A page number as it is written: "7", "Page 7", "Page 7 of 9", "7/9", "- 7 -", "p. 7", roman numerals; already in SeamLine.key form. */
const PAGE_NUMBER = /^(?:page|pg\.?|p\.)?\s*(?:#|[ivxlc]+)(?:\s*(?:of|\/)\s*(?:#|[ivxlc]+))?$|^-\s*(?:#|[ivxlc]+)\s*-$/;

/**
 * Ruling G: the lines of a page that may be furniture rather than body: a line the neighbouring page repeats at
 * the same place (a running header or footer, a letterhead, a table's repeated heading row: digits read alike, so
 * "Page 1" and "Page 2" are one), and a page number in the top or bottom fifth of the page.
 */
function furnitureOf(page: PageTextModel, lines: readonly SeamLine[], neighbour: readonly SeamLine[]): Set<SeamLine> {
  const height = Math.abs(page.view[3] - page.view[1]) || 842;
  const bottom = Math.min(page.view[1], page.view[3]);
  const furniture = new Set<SeamLine>();
  for (const line of lines) {
    const tol = Math.max(2, 0.3 * line.size);
    const repeated = neighbour.some((other) => other.key === line.key && Math.abs(other.y - line.y) <= tol);
    const margin = (line.y - bottom) / height;
    if (repeated || (PAGE_NUMBER.test(line.key) && (margin < 0.2 || margin > 0.8))) furniture.add(line);
  }
  return furniture;
}

/** One way a page turn is read: pieces of the two pages' text (`page` 0: prev, 1: next) read together with line breaks. */
type SeamVariant = { page: 0 | 1; start: number; end: number }[];

/**
 * Ruling Q: the lines nearest the turn that a reading with lines left out keeps on one side: of `lines` (in
 * reading order, furniture skipped), the last ones before the turn (`side` 0) or the first after it (`side` 1),
 * at most SEAM_NEAR_LINES and about SEAM_NEAR_CHARS; the nearest line always, cut at white space on its far side
 * when it is longer.
 */
function nearTheTurn(model: PageTextModel, lines: readonly SeamLine[], side: 0 | 1, skip: ReadonlySet<SeamLine>): SeamVariant {
  const out: SeamVariant = [];
  let chars = 0;
  for (let n = 0; n < lines.length && out.length < SEAM_NEAR_LINES; n++) {
    const line = side === 0 ? lines[lines.length - 1 - n] : lines[n];
    if (skip.has(line)) continue;
    let { start, end } = line;
    const length = end - start;
    if (out.length > 0 && chars + length > SEAM_NEAR_CHARS) break;
    if (length > SEAM_NEAR_CHARS) {
      if (side === 0) {
        const cut = model.text.slice(end - SEAM_NEAR_CHARS, end).search(/\s/);
        if (cut >= 0) start = end - SEAM_NEAR_CHARS + cut + 1;
      } else {
        const cut = model.text.slice(start, start + SEAM_NEAR_CHARS).search(/\s\S*$/);
        if (cut > 0) end = start + cut;
      }
    }
    chars += end - start;
    if (side === 0) out.unshift({ page: 0, start, end });
    else out.push({ page: 1, start, end });
  }
  return out;
}

/**
 * The ways a page turn is read. Ruling G: the end of `prev` and the start of `next` with the furniture left out
 * (BODY to body), and with each candidate furniture line kept in in turn; and, by position, each column of body
 * lines (lines starting at the same x) read from the foot of `prev` on to the top of `next` (a table row whose cell
 * continues under the repeated heading row).
 *
 * Ruling Q (fix wave 5): what stands in a margin between the two halves of a value need not repeat on the other
 * page (odd and even headers, a "continued" heading, a section name, footnotes on one page, headers and footers
 * written after the body), so the turn is also read with 0 to SEAM_LEFT_OUT lines left out at the end of `prev` and
 * 0 to SEAM_LEFT_OUT at the start of `next`, whatever they say (furniture lines among them are left out too and not
 * counted). A row of cells on `next` that repeats a row anywhere on `prev` (a table's heading row, lower on the first
 * page than on later ones) is furniture as well. And the columns are also read cell by cell (a line's text between
 * gaps wider than 1 em), so a cell that continues overleaf is joined without the amounts that stand beside it.
 * A value found in any of these is a place on both pages: more may be covered, a half is not missed.
 */
function seamVariants(prev: PageTextModel, next: PageTextModel): SeamVariant[] {
  const prevLines = seamLines(prev);
  const nextLines = seamLines(next);
  const tail = prevLines.slice(Math.max(0, prevLines.length - SEAM_LINES));
  const head = nextLines.slice(0, SEAM_LINES);
  const prevFurniture = furnitureOf(prev, tail, nextLines);
  const nextFurniture = furnitureOf(next, head, prevLines);
  // A heading row that stands at another height on the earlier page.
  const prevRows = new Set(prevLines.filter((l) => l.row).map((l) => l.key));
  for (const line of head) if (line.row && prevRows.has(line.key)) nextFurniture.add(line);
  const candidates = tail.some((l) => prevFurniture.has(l)) || head.some((l) => nextFurniture.has(l));
  const isFurniture = (line: SeamLine) => prevFurniture.has(line) || nextFurniture.has(line);
  const piece = (page: 0 | 1) => (line: SeamLine) => ({ page, start: line.start, end: line.end });
  /** The tail's last lines and the head's first lines (about SEAM_CHARS of each), leaving out the furniture not kept. */
  const join = (kept: ReadonlySet<SeamLine>): SeamVariant => {
    const keep = (line: SeamLine) => !isFurniture(line) || kept.has(line);
    const before: SeamLine[] = [];
    let chars = 0;
    for (let k = tail.length - 1; k >= 0 && chars < SEAM_CHARS; k--) {
      if (!keep(tail[k])) continue;
      before.unshift(tail[k]);
      chars += tail[k].end - tail[k].start;
    }
    const after: SeamLine[] = [];
    chars = 0;
    for (let k = 0; k < head.length && chars < SEAM_CHARS; k++) {
      if (!keep(head[k])) continue;
      after.push(head[k]);
      chars += head[k].end - head[k].start;
    }
    return [...before.map(piece(0)), ...after.map(piece(1))];
  };
  const variants: SeamVariant[] = [];
  const furniture = new Set([...prevFurniture, ...nextFurniture]);
  if (candidates) {
    variants.push(join(new Set()));
    // Each candidate kept in, the ones nearest the turn first, read with the lines near the turn only (wave 5: every
    // character of a reading is searched for every value, and a line far from the turn stands between no two halves).
    const nearest = [...tail.filter((l) => prevFurniture.has(l)).reverse().slice(0, SEAM_CANDIDATES / 2), ...head.filter((l) => nextFurniture.has(l)).slice(0, SEAM_CANDIDATES / 2)];
    for (const candidate of nearest) {
      const others = new Set(furniture);
      others.delete(candidate);
      variants.push([...nearTheTurn(prev, tail, 0, others), ...nearTheTurn(next, head, 1, others)]);
    }
  }
  // Ruling Q: lines left out on either side of the turn, whatever they say.
  /** How many of `lines` are left, counted from the far side, after 0, 1, ... lines nearest the turn are left out (with the furniture around them). */
  const cuts = (lines: readonly SeamLine[], side: 0 | 1): number[] => {
    const nearest = (left: number) => (side === 0 ? lines[left - 1] : lines[lines.length - left]);
    const out: number[] = [];
    let left = lines.length;
    for (let n = 0; n <= SEAM_LEFT_OUT; n++) {
      if (n > 0) left--;
      while (left > 0 && furniture.has(nearest(left))) left--;
      if (left <= 0) break;
      out.push(left);
    }
    return out;
  };
  const tailCuts = cuts(tail, 0);
  const headCuts = cuts(head, 1);
  for (const [t, tailLeft] of tailCuts.entries()) {
    const before = nearTheTurn(prev, tail.slice(0, tailLeft), 0, furniture);
    for (const [h, headLeft] of headCuts.entries()) {
      // Nothing left out and no furniture at the turn: the page turn as written, which is read anyway.
      if (t === 0 && h === 0 && tailLeft === tail.length && headLeft === head.length) continue;
      variants.push([...before, ...nearTheTurn(next, head.slice(head.length - headLeft), 1, furniture)]);
    }
  }
  // By position: a column (the same left edge, a like size) from the foot of prev to the top of next; of body lines,
  // and (ruling Q) of their cells, with and without the lines taken for furniture.
  const sameColumn = (a: SeamLine, b: SeamLine) => Math.abs(a.x - b.x) <= Math.max(2, 0.2 * Math.min(a.size, b.size)) && a.size / b.size > 0.75 && a.size / b.size < 1.34;
  const columns = (above: readonly SeamLine[], below: readonly SeamLine[]) => {
    const prevBody = [...above].sort((a, b) => b.y - a.y);
    const nextBody = [...below].sort((a, b) => b.y - a.y);
    const firsts: SeamLine[] = [];
    for (const line of prevBody) if (!firsts.some((c) => sameColumn(c, line))) firsts.push(line);
    for (const column of firsts) {
      const foot = prevBody.filter((l) => sameColumn(column, l)).slice(-4);
      const top = nextBody.filter((l) => sameColumn(column, l)).slice(0, 4);
      if (foot.length === 0 || top.length === 0) continue;
      variants.push([...foot.map(piece(0)), ...top.map(piece(1))]);
    }
  };
  const tailBody = tail.filter((l) => !isFurniture(l));
  const headBody = head.filter((l) => !isFurniture(l));
  columns(tailBody, headBody);
  if (tail.some((l) => l.row) || head.some((l) => l.row)) {
    columns(tailBody.flatMap((l) => seamCells(prev, l)), headBody.flatMap((l) => seamCells(next, l)));
    columns(tail.flatMap((l) => seamCells(prev, l)), head.flatMap((l) => seamCells(next, l)));
  }
  return variants;
}

/** Where the page-turn readings of a page are kept, with the next page they were made for (they are the pages' own text). */
const SEAMS = Symbol('pageSeamPlaces');

/** The ways one page turn is read: each on its own, and all as one text with SEAM_FENCE between them. */
interface SeamReadings {
  next: PageTextModel;
  each: TextReading[];
  all: TextReading;
}

/** The readings of the turn from `prev` to `next` (offsets of `prev` as they are; those of `next` shifted past them), made once and kept on `prev`. */
function seamReadings(prev: PageTextModel, next: PageTextModel, shift: number): SeamReadings {
  const kept = (prev as { [SEAMS]?: SeamReadings })[SEAMS];
  if (kept && kept.next === next) return kept;
  const tailFrom = Math.max(0, prev.text.length - SEAM_CHARS);
  const head = Math.min(next.text.length, SEAM_CHARS);
  const tail = prev.text.length - tailFrom;
  const plain: TextReading = {
    text: `${prev.text.slice(tailFrom)}\n${next.text.slice(0, head)}`,
    from: Int32Array.from({ length: tail + 1 + head }, (_, k) => (k < tail ? tailFrom + k : k === tail ? -1 : shift + (k - tail - 1))),
  };
  const made: TextReading[] = [plain];
  const texts = new Set([plain.text]);
  for (const variant of seamVariants(prev, next)) {
    const parts: string[] = [];
    const from: number[] = [];
    variant.forEach(({ page, start, end }, k) => {
      if (k > 0) {
        parts.push('\n');
        from.push(-1);
      }
      const model = page === 0 ? prev : next;
      parts.push(model.text.slice(start, end));
      for (let o = start; o < end; o++) from.push(page === 0 ? o : shift + o);
    });
    const text = parts.join('');
    if (texts.has(text)) continue;
    texts.add(text);
    made.push({ text, from: Int32Array.from(from) });
  }
  const each = [...made, ...made.map(rejoined).filter((r): r is TextReading => r !== null)];
  // All of them as one text, so a value is searched for once a page turn, not once a reading.
  const length = each.reduce((n, r) => n + r.text.length, 0) + SEAM_FENCE.length * Math.max(0, each.length - 1);
  const from = new Int32Array(length);
  let at = 0;
  each.forEach((reading, k) => {
    if (k > 0) {
      from.fill(FENCED, at, at + SEAM_FENCE.length);
      at += SEAM_FENCE.length;
    }
    from.set(reading.from, at);
    at += reading.text.length;
  });
  const readings: SeamReadings = { next, each, all: { text: each.map((r) => r.text).join(SEAM_FENCE), from } };
  try {
    Object.defineProperty(prev, SEAMS, { value: readings, enumerable: false, configurable: true, writable: true });
  } catch {
    // a frozen model: made again next time
  }
  return readings;
}

/**
 * Ruling C across a page turn, Rulings G and Q with what stands in the margins left out: the places `find` gives
 * in the end of `prev`'s text read on into the start of `next`'s (a word broken by a hyphen there joined again)
 * that begin on `prev` and end on `next`. Read as written (the last 300 characters of one, the first 300 of the
 * next); BODY to body, without the lines both pages repeat at the same place (running headers and footers,
 * letterhead lines, a table's repeated heading row) and page numbers in the margins, trying each such line kept in
 * too; with up to four lines left out on either side of the turn, whatever they say (odd and even headers, a
 * "continued" heading, footnotes on one page, headers written after the body); and each column by position, line
 * by line and cell by cell (a table cell that continues overleaf). Each place's ranges on either page, one per run
 * of the page's text (each piece on its own line). Places wholly on one page are not given. `find` is called once
 * with all these readings as one text (nothing of one reading can be joined to the next), and once a reading only
 * when it gave a place that ran from one into another.
 */
export function pageSeamPlaces<T extends { start: number; end: number }>(
  prev: PageTextModel,
  next: PageTextModel,
  find: (text: string) => Iterable<T>,
): { place: T; prev: [number, number][]; next: [number, number][]; text: string }[] {
  // Offsets of `prev` as they are; those of `next` after them, past a gap no offset of `prev` reaches.
  const shift = prev.text.length + 1;
  const readings = seamReadings(prev, next, shift);
  const out: { place: T; prev: [number, number][]; next: [number, number][]; text: string }[] = [];
  const seen = new Set<string>();
  /** The runs of a page's text that the offsets cover (each piece on its own line), as placesInReadings gives them. */
  const rangesOf = (model: PageTextModel, offsets: number[]) => {
    const sorted = [...new Set(offsets)].sort((a, b) => a - b);
    return modelRanges(model, { text: '', from: Int32Array.from(sorted) }, 0, sorted.length);
  };
  /** Takes the places of one text; false when one of them touched a fence between two readings. */
  const take = (reading: TextReading): boolean => {
    let whole = true;
    for (const place of find(reading.text)) {
      const span = reading.from.subarray(Math.max(0, place.start), Math.max(0, place.end));
      if (span.includes(FENCED)) {
        whole = false;
        continue;
      }
      const offsets = Array.from(span).filter((o) => o >= 0);
      const before = offsets.filter((o) => o < shift);
      const after = offsets.filter((o) => o >= shift).map((o) => o - shift);
      if (before.length === 0 || after.length === 0) continue;
      const p = rangesOf(prev, before);
      const n = rangesOf(next, after);
      const key = `${p.join('_')}|${n.join('_')}|${JSON.stringify(Object.entries(place).filter(([k]) => k !== 'start' && k !== 'end'))}`;
      if (p.length === 0 || n.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out.push({ place, prev: p, next: n, text: reading.text.slice(place.start, place.end) });
    }
    return whole;
  };
  if (!take(readings.all)) for (const reading of readings.each) take(reading);
  return out;
}

// ---- reading what lies outside the crop box ----------------------------------------------------------

export const ENLARGED_BOX = [-100_000, -100_000, 100_000, 100_000] as const;

/**
 * A copy of the file in which every page has no crop box and a media box of ±100,000 pt, so that
 * pdf.js's getTextContent reads text placed outside the visible page (it drops every glyph outside
 * the crop box). Used only to search; never shown or saved. Throws PdfToolsError 'redact-find-failed'
 * (its message names nothing in the file) when the file cannot be read.
 */
export async function enlargedViewCopy(file: Uint8Array): Promise<Uint8Array> {
  const failed = () => new PdfToolsError('redact-find-failed', PHASE_TWO_ERROR_MESSAGES['redact-find-failed'] ?? 'The file could not be searched.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK });
  } catch {
    throw failed();
  }
  if (doc.isEncrypted) throw failed();
  try {
    const box = doc.context.obj([...ENLARGED_BOX]);
    const cleared = new Set<PDFDict>();
    for (const page of doc.getPages()) {
      // /CropBox and /MediaBox are inherited: clear them up the page tree as well.
      for (let node: PDFDict | undefined = page.node; node && !cleared.has(node); node = node.lookupMaybe(PDFName.of('Parent'), PDFDict)) {
        cleared.add(node);
        node.delete(PDFName.of('CropBox'));
      }
      page.node.set(PDFName.of('MediaBox'), box);
    }
    return await doc.save({ useObjectStreams: false, objectsPerTick: PARSE_OBJECTS_PER_TICK });
  } catch {
    throw failed();
  }
}

/**
 * True when every pixel (RGBA) is within `tolerance` levels of the first in every channel.
 * Fix round 1 (F9, lead ruling): this is NOT proof that text is hidden. Faint text (grey 0.97 on white)
 * passes it and would stay in the picture, recoverable by a contrast stretch. Redact boxes every place
 * that is drawn; only text that is not painted at all (outside the visible box; render mode 3 where the
 * run can prove it) is removed without a box. Use this as a hint only.
 */
export function isUniform(rgba: Uint8ClampedArray, tolerance = 8): boolean {
  if (rgba.length < 4) return true;
  const [r, g, b, a] = [rgba[0], rgba[1], rgba[2], rgba[3]];
  for (let i = 4; i + 3 < rgba.length; i += 4) {
    if (Math.abs(rgba[i] - r) > tolerance || Math.abs(rgba[i + 1] - g) > tolerance || Math.abs(rgba[i + 2] - b) > tolerance || Math.abs(rgba[i + 3] - a) > tolerance) return false;
  }
  return true;
}

// ---- a box edge never cuts ink (fix round 1, F2: for the run, Task A9) --------------------------------

/** A rectangle of whole pixels of a drawing: `right` and `bottom` are exclusive. */
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InkGrowth {
  box: PixelBox;
  /** Pixels added on each side. */
  grew: { left: number; top: number; right: number; bottom: number };
  /** Some side still had ink just outside it when it reached `maxGrowPx`: the run must not trust this box. */
  hitLimit: boolean;
}

/** The direction a text runs in a drawing: along its x axis ('horizontal') or its y axis ('vertical'). */
export type TextAxis = 'horizontal' | 'vertical';

/**
 * The axis of the drawing a text at `angle` degrees (counter-clockwise from user-space +x, as
 * Proposal.angle) runs nearer to, in a drawing made with viewport rotation `rotation` (degrees, as
 * pdf.js getViewport's; 0 draws the page unturned).
 */
export function textAxis(angle: number, rotation = 0): TextAxis {
  const r = ((angle + rotation) * Math.PI) / 180;
  return Math.abs(Math.cos(r)) >= Math.abs(Math.sin(r)) ? 'horizontal' : 'vertical';
}

/**
 * Grows `box` along its text (fix round 2, MF1) at each end until neither end has glyph ink just
 * outside it or beyond a gap narrower than 0.2 em, so no end cuts through a glyph, or stops a glyph
 * short of a word, that the per-character estimate placed slightly wrong (fonts whose widths differ
 * from their fallback by more than the padding, letter-spacing, word spacing, italics). It never
 * grows across the text: the cover above and below a line comes from
 * the padding and the placement's bounds (rangeRects), not from the picture, so it does not follow
 * neighbouring lines under tight leading.
 *
 * - `along`: the direction the text runs in the drawing (textAxis; default 'horizontal'). Only the
 *   two ends across that direction move (left and right for horizontal text).
 * - Glyph ink: a pixel that differs by more than `tolerance` (default 24) levels in some channel from
 *   the paper (`background`, or by default the most common colour around the text: paperColour, so a
 *   shaded table cell is paper and faint text on it is ink, and rules hugging the box are not taken
 *   for the paper), in a line of pixels along the
 *   text that is not a rule. A rule is an unbroken run of ink along the text, through the pixel just
 *   outside the end, at least as long as the box is tall (across the text): an underline, a
 *   strike-through, a table rule or a fill-in line; no glyph stroke is that long. So a line with ink
 *   across the whole box (the reviewer's test) is a rule whenever the box is at least as long as it is
 *   tall; in a shorter box it counts as glyph ink, and the end follows it (never the unsafe way).
 * - `padPx`: the padding the box has across the text, in pixels (BOX_PAD_PT at the drawing's scale;
 *   the run should always pass it). Lines of pixels that close to the box's sides along the text are
 *   not looked at for ink (a neighbouring line's descenders or capitals reach into them under tight
 *   leading) but are where the paper is judged. Default 0.
 * - An end stops only in a gap between glyphs at least `gapPx` wide (default 0.2 em, estimated from the
 *   box's size across its text and `padPx`; fix wave B7), counted from the last glyph ink inside the
 *   box to the next outside: a narrower gap lies between two glyphs of one word ("1" then "K"), and the
 *   end steps over it. An end already standing in a wider gap takes in ink that touches it (as before:
 *   it may be a cut glyph) only as far as that ink runs on unbroken, not across the next word's gaps.
 * - Each end grows at most `maxGrowPx`; an end that reaches the edge of the drawing stops there.
 *   `hitLimit` is true when an end reached its maximum with glyph ink still outside it, or beyond a
 *   narrow gap: the run must not trust that box. An end may swallow a neighbouring character the
 *   padding touched: over-covering by a character is the price of never leaving part of one visible. A
 *   glyph wholly beyond a gap of 0.2 em or more is not reached (the box was more than a word gap off):
 *   the placement's estimates are for that.
 *
 * Run with the page's drawing BEFORE any box is filled: `rgba` is its RGBA pixels, `width` x `height`.
 * Map a Rect to pixels with the drawing's viewport (convertToViewportRectangle, then floor and ceil
 * outward) and back with its inverse.
 */
export function growPastInk(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  box: PixelBox,
  options: { maxGrowPx: number; tolerance?: number; background?: readonly [number, number, number]; along?: TextAxis; padPx?: number; gapPx?: number },
): InkGrowth {
  const tolerance = options.tolerance ?? 24;
  const max = Math.max(0, Math.floor(options.maxGrowPx));
  const b = {
    left: Math.max(0, Math.min(width, Math.floor(box.left))),
    top: Math.max(0, Math.min(height, Math.floor(box.top))),
    right: Math.max(0, Math.min(width, Math.ceil(box.right))),
    bottom: Math.max(0, Math.min(height, Math.ceil(box.bottom))),
  };
  // u runs along the text, v across it.
  const vertical = options.along === 'vertical';
  const pad = Math.max(0, Math.floor(options.padPx ?? 0));
  const paper = options.background ?? paperColour(rgba, width, height, b, vertical, pad);
  const uSize = vertical ? height : width;
  const ink = (u: number, v: number) => {
    const i = (vertical ? u * width + v : v * width + u) * 4;
    return Math.abs(rgba[i] - paper[0]) > tolerance || Math.abs(rgba[i + 1] - paper[1]) > tolerance || Math.abs(rgba[i + 2] - paper[2]) > tolerance;
  };
  const vLo = vertical ? b.left : b.top;
  const vHi = vertical ? b.right : b.bottom;
  const [from, to] = vHi - vLo > 2 * pad ? [vLo + pad, vHi - pad] : [vLo, vHi];
  const ruleLength = Math.max(1, vHi - vLo);
  /** Ink pixels in a row along the text from `u` on, stepping `step`, counted up to ruleLength. */
  const run = (u: number, v: number, step: 1 | -1) => {
    let n = 0;
    for (let k = u; n < ruleLength && k >= 0 && k < uSize && ink(k, v); k += step) n++;
    return n;
  };
  /** Glyph ink in the line of pixels across the text at `u`, just outside an end; `inward` points into the box. */
  const cuts = (u: number, inward: 1 | -1) => {
    for (let v = from; v < to; v++) {
      if (ink(u, v) && 1 + run(u + inward, v, inward) + run(u - inward, v, inward === 1 ? -1 : 1) < ruleLength) return true;
    }
    return false;
  };
  const startLo = vertical ? b.top : b.left;
  const startHi = vertical ? b.bottom : b.right;
  // An end may stand in a gap between two glyphs of one word (a narrow one: "1" then "K"), with the next
  // glyph of the value beyond it. It stops only in a gap at least 0.2 em wide, counted from the last
  // glyph ink inside the box to the next one outside (fix wave, redact-e2e-review B7). The box is about
  // 1.15 em across its text plus its padding (rangeRects), so an em is at most (across - 2 pad) / 1.15:
  // the gap estimated from it errs wide, the safe way.
  const gap = Math.max(1, Math.round(options.gapPx ?? Math.ceil((0.2 * Math.max(1, vHi - vLo - 2 * pad)) / 1.15)));
  let lo = startLo;
  let hi = startHi;
  /** Lines of pixels without glyph ink just inside an end, from `first` inward, counted up to `limit`. */
  const clearInside = (first: number, inward: 1 | -1, limit: number) => {
    let n = 0;
    for (let u = first; n < limit && u >= lo && u < hi && !cuts(u, inward); u += inward) n++;
    return n;
  };
  /** The first line of pixels holding glyph ink from `first` outward, within `limit` lines (always the first); -1 when none. */
  const nextInk = (first: number, outward: 1 | -1, limit: number) => {
    for (let d = 0; d < Math.max(1, limit); d++) {
      const u = first + outward * d;
      if (u < 0 || u >= uSize) return -1;
      if (cuts(u, outward === 1 ? -1 : 1)) return u;
    }
    return -1;
  };
  /**
   * The next line of glyph ink an end must take in, from `first` outward; -1 when it stops. In the
   * value's own word (`far` false) a narrow gap is stepped over. An end whose box has a gap of 0.2 em or
   * more inside it stands between words: ink touching it belongs to another word, which it then takes in
   * only as far as that ink runs on unbroken (`far` true from there on), never across that word's own
   * narrow gaps.
   */
  const take = (first: number, outward: 1 | -1, far: boolean): { u: number; far: boolean } => {
    const inward = outward === 1 ? -1 : 1;
    if (far) return { u: cuts(first, inward) ? first : -1, far };
    const inner = clearInside(first + inward, inward, gap);
    if (inner >= gap) return cuts(first, inward) ? { u: first, far: true } : { u: -1, far };
    return { u: nextInk(first, outward, gap - inner), far };
  };
  let farLo = false;
  let farHi = false;
  let hitLimit = false;
  for (let changed = true; changed; ) {
    changed = false;
    if (lo > 0) {
      const next = take(lo - 1, -1, farLo);
      farLo = next.far;
      if (next.u >= 0) {
        const to = startLo - next.u > max ? startLo - max : next.u;
        if (startLo - next.u > max) hitLimit = true;
        if (to < lo) {
          lo = to;
          changed = true;
        }
      }
    }
    if (hi < uSize) {
      const next = take(hi, 1, farHi);
      farHi = next.far;
      if (next.u >= 0) {
        const to = next.u + 1 - startHi > max ? startHi + max : next.u + 1;
        if (next.u + 1 - startHi > max) hitLimit = true;
        if (to > hi) {
          hi = to;
          changed = true;
        }
      }
    }
  }
  const grown = vertical ? { ...b, top: lo, bottom: hi } : { ...b, left: lo, right: hi };
  return {
    box: grown,
    grew: { left: b.left - grown.left, top: b.top - grown.top, right: grown.right - b.right, bottom: grown.bottom - b.bottom },
    hitLimit,
  };
}

/**
 * The paper around a box's text: the most common colour (to 4 levels) of the lines of pixels just
 * beyond its two ends and, with a padding, of the padding's bands inside the box (the text's own glyphs
 * rarely reach them); without one, of the whole box and the lines just above and below it. White when
 * there is nothing to look at. Not the ring alone (fix round 2): when table rules hug the box above and
 * below, a ring is mostly rule, which would make the rules' colour the paper and a cut glyph of that
 * colour no ink at all.
 */
function paperColour(rgba: Uint8ClampedArray, width: number, height: number, b: PixelBox, vertical: boolean, pad: number): [number, number, number] {
  const counts = new Map<number, { n: number; rgb: [number, number, number] }>();
  const note = (u: number, v: number) => {
    const [x, y] = vertical ? [v, u] : [u, v];
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    const k = ((rgba[i] >> 2) << 12) | ((rgba[i + 1] >> 2) << 6) | (rgba[i + 2] >> 2);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { n: 1, rgb: [rgba[i], rgba[i + 1], rgba[i + 2]] });
  };
  const [uLo, uHi, vLo, vHi] = vertical ? [b.top, b.bottom, b.left, b.right] : [b.left, b.right, b.top, b.bottom];
  for (let v = vLo; v < vHi; v++) {
    note(uLo - 1, v);
    note(uHi, v);
  }
  const bands = pad > 0 && vHi - vLo > 2 * pad;
  for (let v = bands ? vLo : vLo - 1; v < (bands ? vHi : vHi + 1); v++) {
    if (bands && v >= vLo + pad && v < vHi - pad) continue;
    for (let u = uLo; u < uHi; u++) note(u, v);
  }
  let best: { n: number; rgb: [number, number, number] } | undefined;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.rgb ?? [255, 255, 255];
}
