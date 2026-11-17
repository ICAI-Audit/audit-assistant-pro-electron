// Where a search hit is drawn on the page: one quad per text item it touches, in the page's PDF user
// space, from pdf.js's item geometry (the item's transform gives where it starts, which way it runs
// and its font size; its width how far it runs). The viewer maps the quads to the page box with
// pageGeometry.ts, the single mapping for every layer over the page, so highlights are right at every
// zoom, every page /Rotate, every view turn and on boxes that do not start at 0,0. No DOM here.
//
// Where each character sits inside an item is estimated: its advance in a fallback family (Arial,
// Times New Roman or Courier New, measured one character at a time), scaled to the item's width. When
// nothing can be measured, or the fallback's widths are too far from the item's (a font the fallback
// does not resemble), every character gets the same share.
import type { FontStyleLike, MeasureChar, TextItemLike } from '@/lib/pdf-tools/pageText';
import type { PdfRect } from './pageGeometry';
import type { SearchPage } from './searchText';

export type Point = readonly [number, number];
/** Four corners in PDF user space: start and end on the descent side, then end and start on the ascent side. */
export type Quad = readonly [Point, Point, Point, Point];

/** The family measured for each generic family name pdf.js reports; any other name is measured as Arial. */
export const SEARCH_FALLBACK_FAMILY: Readonly<Record<string, string>> = { 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Courier New' };

const isSpace = (code: number) => code === 0x20 || (code >= 0x09 && code <= 0x0d) || code === 0xa0 || (code >= 0x2000 && code <= 0x200b) || code === 0x3000;

const unit = (x: number, y: number): [number, number] | null => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? [x / n, y / n] : null;
};

/** The ascent and descent of the item's font in ems, within sensible bounds (pdf.js reports 0 for some fonts). */
function extent(style: FontStyleLike | undefined): { above: number; below: number } {
  const ascent = style && Number.isFinite(style.ascent) && style.ascent > 0.5 && style.ascent < 1.2 ? style.ascent : 0.8;
  const descent = style && Number.isFinite(style.descent) && style.descent < -0.05 && style.descent > -0.5 ? style.descent : -0.2;
  return { above: ascent, below: descent };
}

/** Positions along the item (user space, from its origin) of each UTF-16 unit boundary of its string. */
function itemPositions(item: TextItemLike, style: FontStyleLike | undefined, measure?: MeasureChar): Float64Array {
  const str = item.str;
  const width = Number.isFinite(item.width) && item.width > 0 ? item.width : 0;
  const advances = new Float64Array(str.length);
  let glyphs = 0;
  let total = 0;
  const family = SEARCH_FALLBACK_FAMILY[style?.fontFamily ?? ''] ?? 'Arial';
  // A measure is at 100 px; the item's font size along the line turns it into user space.
  const along = Math.hypot(item.transform[0], item.transform[1]);
  for (let k = 0; k < str.length; ) {
    const cp = str.codePointAt(k)!;
    const size = cp > 0xffff ? 2 : 1;
    glyphs += 1;
    const w = measure ? measure(String.fromCodePoint(cp), family) : 0;
    advances[k] = Number.isFinite(w) && w > 0 ? (w / 100) * along : 0;
    total += advances[k];
    k += size;
  }
  const ratio = total > 0 ? width / total : 0;
  const trusted = total > 0 && ratio >= 0.75 && ratio <= 1.35;
  const out = new Float64Array(str.length + 1);
  if (trusted) {
    // The second half of a surrogate pair has no advance of its own (0 in `advances`).
    for (let k = 0; k < str.length; k++) out[k + 1] = out[k] + advances[k] * ratio;
  } else if (glyphs > 0) {
    // Every character the same share; the second half of a pair takes none.
    let g = 0;
    for (let k = 0; k < str.length; k++) {
      const low = k > 0 && str.charCodeAt(k) >= 0xdc00 && str.charCodeAt(k) <= 0xdfff;
      if (!low) g += 1;
      out[k + 1] = (width * g) / glyphs;
    }
  }
  return out;
}

function quadOf(item: TextItemLike, style: FontStyleLike | undefined, from: number, to: number, measure?: MeasureChar): Quad {
  const [a, b, c, d, e, f] = item.transform;
  const dir = unit(a, b) ?? [1, 0];
  const up = unit(c, d) ?? [-dir[1], dir[0]];
  const size = Math.hypot(c, d) || item.height || Math.hypot(a, b) || 10;
  const at = (s: number, t: number): Point => [e + dir[0] * s + up[0] * t, f + dir[1] * s + up[1] * t];
  if (style?.vertical) {
    // Vertical writing runs down from the origin; where a character sits inside it is not estimated:
    // the whole item, half an em either side.
    const run = Math.max(item.height || 0, item.width || 0);
    return [at(-0.6 * size, -(0.3 * size + run)), at(0.6 * size, -(0.3 * size + run)), at(0.6 * size, size), at(-0.6 * size, size)];
  }
  const { above, below } = extent(style);
  const positions = itemPositions(item, style, measure);
  const s0 = positions[Math.min(from, positions.length - 1)];
  const s1 = positions[Math.min(to, positions.length - 1)];
  return [at(s0, below * size), at(s1, below * size), at(s1, above * size), at(s0, above * size)];
}

/** The index of the item whose string holds `offset` of the page text (the last one starting at or before it). */
function itemAt(page: SearchPage, offset: number): number {
  let lo = 0;
  let hi = page.itemStarts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (page.itemStarts[mid] <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The quads of the hit [start, end) of `page.text`: one per item it touches, spaces at either edge
 * of a piece left out, a piece of spaces only skipped.
 */
export function hitQuads(page: SearchPage, start: number, end: number, measure?: MeasureChar): Quad[] {
  const quads: Quad[] = [];
  if (!(end > start)) return quads;
  // Items that start at the same place as an empty one before them: begin with the first that can hold `start`.
  let i = Math.max(0, itemAt(page, start));
  while (i > 0 && page.itemStarts[i - 1] === page.itemStarts[i]) i--;
  for (; i < page.items.length && page.itemStarts[i] < end; i++) {
    const item = page.items[i];
    const str = typeof item.str === 'string' ? item.str : '';
    const base = page.itemStarts[i];
    let from = Math.max(start, base) - base;
    let to = Math.min(end, base + str.length) - base;
    while (from < to && isSpace(str.charCodeAt(from))) from++;
    while (to > from && isSpace(str.charCodeAt(to - 1))) to--;
    if (to <= from) continue;
    quads.push(quadOf(item, page.styles[item.fontName], from, to, measure));
  }
  return quads;
}

/** The smallest axis-aligned rectangle in PDF user space that holds every quad, or null for none. */
export function quadsBounds(quads: readonly Quad[]): PdfRect | null {
  if (quads.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const quad of quads) {
    for (const [x, y] of quad) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}
