// Text search in the page viewer: a page's text as pdf.js reads it, joined into one string, folded
// for matching, and the occurrences of what the user typed. No DOM or pdf.js here, so it is
// unit-tested.
//
// What matches (said in the search box's help line):
// - Capitals do not matter.
// - Any run of spaces or line breaks counts as one space, in the file and in what is typed; leading
//   and trailing spaces typed are ignored. A space typed is still needed where the file has words
//   apart: "per books" finds "per\nbooks", "perbooks" does not.
// - A comma between two digits is ignored on both sides, so 1234567, 12,34,567 and 1,234,567 find
//   one another. A comma followed by a space (a list) is kept; a decimal point always is.
// - Compatibility forms match their plain letters (Unicode NFKD: ligatures, full-width digits), and
//   invisible characters (soft hyphen, zero-width joiners) are ignored, so Hindi typed with or
//   without a joiner matches.
// - Text is searched in the order the file stores it. A phrase the file draws in pieces out of
//   reading order may not be found (a known limit).
//
// Confidentiality: page text and the query are document content. Nothing here logs or formats
// them, and no regular expression is ever run on either (V8 keeps the last string a regular
// expression matched, process-wide).
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';

export interface SearchPage {
  /** Counted from 0. */
  pageIndex: number;
  /** The items' strings joined in the file's order, with one space where items are apart or a line ends. */
  text: string;
  /** Where each item's string starts in `text`. */
  itemStarts: Int32Array;
  items: readonly TextItemLike[];
  styles: Readonly<Record<string, FontStyleLike>>;
  /** `text` folded for matching (see the header). */
  folded: string;
  /** For each UTF-16 unit of `folded`: [start, end) in `text` of the character it came from. */
  starts: Int32Array;
  ends: Int32Array;
  /** The page has a letter, digit or sign to search; false for a scan or a blank page. */
  hasText: boolean;
  /** Roughly the bytes this page holds, for the search's memory budget. */
  cost: number;
}

export interface FoldedText {
  folded: string;
  starts: Int32Array;
  ends: Int32Array;
}

// ---- characters, by code (no regular expressions: see the header) ---------------------------------

function isSpaceCode(c: number): boolean {
  return (
    c === 0x20 ||
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** Characters that show nothing and only shape the text: soft hyphen, zero-width space and joiners, word joiner, byte-order mark. */
function isInvisibleCode(c: number): boolean {
  return c === 0xad || (c >= 0x200b && c <= 0x200d) || c === 0x2060 || c === 0xfeff || c === 0x180e;
}

const isDigitUnit = (c: number) => c >= 0x30 && c <= 0x39;

/** A code point folded: lower case, compatibility forms decomposed (NFKD). ASCII without calling into Unicode tables. */
function foldCodePoint(cp: number, cache: Map<number, string>): string {
  if (cp < 0x80) return String.fromCharCode(cp >= 0x41 && cp <= 0x5a ? cp + 32 : cp);
  let out = cache.get(cp);
  if (out === undefined) {
    out = String.fromCodePoint(cp).normalize('NFKD').toLowerCase();
    cache.set(cp, out);
  }
  return out;
}

/** The first code point at or after `i` that is not invisible, folded, or -1. Used to see a digit after a comma. */
function nextFoldedUnit(text: string, i: number, cache: Map<number, string>): number {
  for (let k = i; k < text.length; ) {
    const cp = text.codePointAt(k)!;
    const width = cp > 0xffff ? 2 : 1;
    if (!isInvisibleCode(cp)) {
      const f = foldCodePoint(cp, cache);
      return f.length > 0 ? f.charCodeAt(0) : -1;
    }
    k += width;
  }
  return -1;
}

/**
 * The text as matching sees it (see the header), with a map from each folded unit back to the
 * characters of `text` it came from.
 */
export function foldText(text: string): FoldedText {
  const cache = new Map<number, string>();
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let last = -1; // the last unit written
  let spaceAt = -1; // a run of spaces seen since then, not yet written
  const emit = (unit: string, start: number, end: number) => {
    parts.push(unit);
    starts.push(start);
    ends.push(end);
    last = unit.charCodeAt(0);
  };
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (isSpaceCode(cp)) {
      // One space for the run, written only when something follows it: no leading or trailing space.
      if (parts.length > 0 && last !== 0x20 && spaceAt < 0) spaceAt = i;
    } else if (!isInvisibleCode(cp)) {
      const commaInNumber = cp === 0x2c && spaceAt < 0 && isDigitUnit(last) && isDigitUnit(nextFoldedUnit(text, i + 1, cache));
      if (!commaInNumber) {
        const folded = foldCodePoint(cp, cache);
        for (let u = 0; u < folded.length; u++) {
          const unit = folded[u];
          if (unit === ' ') {
            // A compatibility form that decomposes with a space counts as a space.
            if (parts.length > 0 && last !== 0x20 && spaceAt < 0) spaceAt = i;
            continue;
          }
          if (spaceAt >= 0) {
            emit(' ', spaceAt, spaceAt + 1);
            spaceAt = -1;
          }
          emit(unit, i, i + width);
        }
      }
    }
    i += width;
  }
  return { folded: parts.join(''), starts: Int32Array.from(starts), ends: Int32Array.from(ends) };
}

/** What the user typed, folded as the page text is (an empty string: nothing to look for). */
export function foldQuery(query: string): string {
  return foldText(query).folded;
}

// ---- a page ------------------------------------------------------------------------------------------

const unit = (x: number, y: number): [number, number] | null => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? [x / n, y / n] : null;
};

/**
 * Whether two items pdf.js gave one after the other are apart (another line, another direction, a
 * gap of more than a tenth of an em, or drawn well before), so that a space stands between them.
 * Touching pieces of one word (kerning) are not.
 */
function apart(p: TextItemLike, q: TextItemLike, styles: Readonly<Record<string, FontStyleLike>>): boolean {
  if (styles[p.fontName]?.vertical || styles[q.fontName]?.vertical) return true;
  const [a, b, c, d, e, f] = p.transform;
  const [qa, qb, , , qe, qf] = q.transform;
  const dir = unit(a, b) ?? [1, 0];
  const qdir = unit(qa, qb) ?? [1, 0];
  if (dir[0] * qdir[0] + dir[1] * qdir[1] < 0.99) return true;
  const up = unit(c, d) ?? [-dir[1], dir[0]];
  const size = Math.hypot(c, d) || p.height || 10;
  const across = (qe - e) * up[0] + (qf - f) * up[1];
  if (Math.abs(across) > 0.5 * size) return true;
  const width = Number.isFinite(p.width) ? p.width : 0;
  const along = (qe - (e + dir[0] * width)) * dir[0] + (qf - (f + dir[1] * width)) * dir[1];
  return along > 0.1 * size || along < -0.5 * size;
}

const endsWithSpace = (s: string) => s.length > 0 && isSpaceCode(s.charCodeAt(s.length - 1));
const startsWithSpace = (s: string) => s.length > 0 && isSpaceCode(s.charCodeAt(0));

const hasNonSpace = (s: string) => {
  for (let k = 0; k < s.length; k++) if (!isSpaceCode(s.charCodeAt(k))) return true;
  return false;
};

/**
 * A page's search text from pdf.js's text items and font styles (pdfRenderer's viewerPageText). Only
 * items with something to find are kept: pdf.js gives a column layout as text, a space, text, ..., an
 * empty line end, and the spaces and line ends need no position of their own; each becomes one space
 * in the text (so a page keeps about half the items, and the search's memory budget holds twice the pages).
 */
export function buildSearchPage(pageIndex: number, items: readonly TextItemLike[], styles: Readonly<Record<string, FontStyleLike>>): SearchPage {
  const parts: string[] = [];
  const kept: TextItemLike[] = [];
  const itemStarts: number[] = [];
  let length = 0;
  let tail = ''; // the last string written, to see whether the text ends in a space
  let prev: TextItemLike | null = null;
  // A space or a line end was left out since the last item kept.
  let gap = false;
  const write = (s: string) => {
    parts.push(s);
    length += s.length;
    if (s.length > 0) tail = s;
  };
  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!hasNonSpace(str)) {
      if (str.length > 0 || item.hasEOL) gap = true;
      continue;
    }
    if (prev && !endsWithSpace(tail) && !startsWithSpace(str) && (gap || apart(prev, item, styles))) write(' ');
    itemStarts.push(length);
    kept.push(item);
    write(str);
    prev = item;
    gap = false;
    if (item.hasEOL && !endsWithSpace(tail)) write(' ');
  }
  const text = parts.join('');
  const { folded, starts, ends } = foldText(text);
  return {
    pageIndex,
    text,
    itemStarts: Int32Array.from(itemStarts),
    items: kept,
    styles,
    folded,
    starts,
    ends,
    hasText: folded.length > 0,
    // Two bytes a character for the text and the folded text, eight for the map, and an estimate per item.
    cost: 2 * text.length + 10 * folded.length + 160 * kept.length,
  };
}

/**
 * Every occurrence of `needle` (already folded: foldQuery) on the page, in order and without overlap,
 * at most `limit`, as [start, end) pairs in `page.text`.
 */
export function findInPage(page: SearchPage, needle: string, limit = Number.POSITIVE_INFINITY): Int32Array {
  if (needle.length === 0 || limit <= 0) return new Int32Array(0);
  const found: number[] = [];
  for (let at = page.folded.indexOf(needle); at >= 0 && found.length / 2 < limit; at = page.folded.indexOf(needle, at + needle.length)) {
    found.push(page.starts[at], page.ends[at + needle.length - 1]);
  }
  return Int32Array.from(found);
}
