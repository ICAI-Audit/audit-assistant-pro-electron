// Compare (design 5.13 "Compare two versions"; contract T-064 decisions 3, 5 and 17, risk 5): the text of
// two versions of a PDF, compared word by word.
//
// - A page's words are its text split at any run of white space, so spaces, tabs and line breaks are never a
//   difference; ligatures, non-breaking spaces and full-width forms are read as plain text (NFKC), and soft
//   hyphens and zero-width marks are dropped.
// - A word hyphenated across a line end (a line ending in a hyphen, the next starting with a small letter) is
//   one word with the hyphen dropped, as PDF to Word joins it; a year range broken after its hyphen ("2024-" /
//   "25") is one word with the hyphen kept. Against the other version the other form is tried too ("co-" /
//   "operative" matches "co-operative" as well as "cooperative"), so a re-wrapped paragraph is no difference.
// - Pages are paired by matching text first (a longest common run of identical pages). The pages left
//   between two such anchors pair in order when at least half their words are shared (the pairing with
//   the most shared words wins); the rest are listed as only in the earlier or only in the later file. So
//   an inserted page never makes every later page "differ".
// - The word diff is Myers' (a shortest edit script, in linear memory, by its middle snake), after the
//   common start and end are taken off. Guard: when what is left of a page is over 5,000 words on either
//   side, or the diff would take too many steps, the page is compared in larger pieces (runs of words cut
//   where a word's hash says so, so an insertion moves no cut), and only the differing pieces are compared
//   word by word, as long as they are small; a large differing passage is then shown as removed and added
//   whole. Such a page is marked `coarse` and counted (`pagesComparedCoarsely`), and the report says so.
// - Every loop gives the window its turns through the caller's pace (pace.ts), which also takes Stop.
//
// Confidentiality: the texts are held in memory for the report only. Nothing here logs, stores or
// formats a word into a message; the counts are all that leave it for the record.
import { runAtOnce, runPaced, type Pace, type Work } from './pace';

/** One run of words: the same in both versions, only in the later (added) or only in the earlier (removed). Words are joined by one space. */
export type WordChange = { kind: 'same' | 'added' | 'removed'; text: string };

export interface PagePair {
  /** 0-based page of the earlier file, or null for a page only in the later. */
  earlier: number | null;
  later: number | null;
  /**
   * The page's runs of words: when both pages are there, the same and differing runs ([] when they are the
   * same); for a page in one file only, its words as one run (removed or added; [] when it has none).
   */
  changes: WordChange[];
  added: number;
  removed: number;
  changed: number;
  /** Compared in larger pieces (a very long page): some changes may be shown as whole passages. */
  coarse: boolean;
}

export interface Comparison {
  pagesEarlier: number;
  pagesLater: number;
  /** One row per page pair or page in one file only, in the order of the files. */
  pairs: PagePair[];
  /** Pages in both files whose text differs. */
  pagesDiffer: number;
  pagesOnlyEarlier: number;
  pagesOnlyLater: number;
  /** Word counts are for pages found in both files. */
  wordsAdded: number;
  wordsRemoved: number;
  wordsChanged: number;
  /** Pages of either file with fewer than 20 characters of text (scans, blank pages). */
  pagesWithoutText: number;
  /** Pages compared in larger pieces (see `coarse`). */
  pagesComparedCoarsely: number;
}

/** Over this many words on either side (after the common start and end), a page is compared in larger pieces. */
export const LARGE_PAGE_WORDS = 5_000;
/** A page with fewer characters than this (besides spaces) has no text, as in the other tools (decision 14). */
export const NO_TEXT_MAX_CHARS = 20;
/** Unmatched pages pair only when at least this share of their words is common to both. */
export const MIN_SHARED = 0.5;

/**
 * Steps (diagonals visited) one word diff may take before it gives way to larger pieces: about 0.3 s on this
 * machine (a step costs some 100 ns), enough for some 3,400 edits on a page.
 */
const WORD_DIFF_STEPS = 3_000_000;
/** The same for the diff of the larger pieces, and for one differing passage refined word by word. */
const PIECE_DIFF_STEPS = 2_000_000;
const PASSAGE_DIFF_STEPS = 500_000;
/** A differing passage of up to this many words (both sides) is refined word by word. */
const PASSAGE_WORDS = 2_000;
/** A piece ends after a word whose hash is a multiple of this, or at PIECE_MAX words. */
const PIECE_CUT = 8;
const PIECE_MAX = 32;
/** How many page similarities one gap of unmatched pages may compute (the rest are not paired). */
const GAP_SIMILARITIES = 40_000;

/** Soft hyphens, zero-width marks and control characters (other than white space): never part of a word. */
// eslint-disable-next-line no-control-regex
const STRIPPED = /[\u00AD\u200B-\u200D\u2060\uFEFF\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;

/** A word as read, and for a word joined across a line end, its other form (hyphen kept or dropped). */
interface Token {
  text: string;
  alt?: string;
}

/** A word that ends its line with a hyphen after a letter or digit: it may run on into the next line. */
const LINE_END_HYPHEN = /[\p{L}\p{N}][-\u2010]$/u;

/** A page's words, a word broken by a hyphen at a line end joined (see the top of this file). */
function tokensOf(pageText: string): Token[] {
  const text = pageText.normalize('NFKC').replace(STRIPPED, '');
  const out: Token[] = [];
  let pending: string | null = null;
  for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/)) {
    const words = line.split(/\s+/u).filter((w) => w !== '');
    const tokens: Token[] = words.map((w) => ({ text: w }));
    if (pending !== null) {
      const first = words[0];
      const stem = pending.slice(0, -1);
      if (first !== undefined && /^\p{Ll}/u.test(first)) tokens[0] = { text: stem + first, alt: pending + first };
      else if (first !== undefined && /^\d+$/.test(stem) && /^\d/.test(first)) tokens[0] = { text: pending + first, alt: stem + first };
      else out.push({ text: pending });
      pending = null;
    }
    const last = tokens[tokens.length - 1];
    if (last && last.alt === undefined && LINE_END_HYPHEN.test(last.text)) {
      pending = last.text;
      tokens.pop();
    }
    out.push(...tokens);
  }
  if (pending !== null) out.push({ text: pending });
  return out;
}

/** A page's words: its text split at any run of white space (see the top of this file). */
export function wordsOf(pageText: string): string[] {
  return tokensOf(pageText).map((t) => t.text);
}

/** A file's words that were not joined across a line end. */
function* vocabularyOf(pages: readonly Token[][]): Work<Set<string>> {
  const words = new Set<string>();
  for (const page of pages) {
    for (const t of page) if (t.alt === undefined) words.add(t.text);
    yield;
  }
  return words;
}

/** A joined word takes its other form only when the other version has that form and not this one. */
function resolved(page: readonly Token[], other: ReadonlySet<string>): string[] {
  return page.map((t) => (t.alt === undefined || other.has(t.text) || !other.has(t.alt) ? t.text : t.alt));
}

/** Whether a page counts as having no text: fewer than 20 characters besides white space. */
export function pageHasNoText(pageText: string): boolean {
  let n = 0;
  for (const ch of pageText.replace(STRIPPED, '')) {
    if (/\s/u.test(ch)) continue;
    n += 1;
    if (n >= NO_TEXT_MAX_CHARS) return false;
  }
  return true;
}

/** Pages that differ in any way: changed, or in one file only (the "x" of "x of n pages differ"). */
export function pagesThatDiffer(c: Pick<Comparison, 'pagesDiffer' | 'pagesOnlyEarlier' | 'pagesOnlyLater'>): number {
  return c.pagesDiffer + c.pagesOnlyEarlier + c.pagesOnlyLater;
}

/** Whether a row of the comparison is a difference (shown in the report). */
export function pairDiffers(pair: PagePair): boolean {
  return pair.earlier === null || pair.later === null || pair.changes.length > 0;
}

// ---- the diff of two sequences of numbers ---------------------------------------------------------------

/** Words, pages or pieces as small numbers: equal text, equal number. */
class Ids {
  private readonly map = new Map<string, number>();
  of(text: string): number {
    let id = this.map.get(text);
    if (id === undefined) {
      id = this.map.size;
      this.map.set(text, id);
    }
    return id;
  }
  all(texts: readonly string[]): Int32Array {
    const out = new Int32Array(texts.length);
    for (let i = 0; i < texts.length; i++) out[i] = this.of(texts[i]);
    return out;
  }
}

/** A stretch of the edit script: `n` items the same, removed from a, or added from b, at the given starts. */
interface Segment {
  kind: 'same' | 'removed' | 'added';
  a: number;
  b: number;
  n: number;
}

/** Thrown inside a diff that has used up its steps; the caller falls back to larger pieces. */
const TOO_COSTLY = Symbol('too costly');

class Steps {
  constructor(private left: number) {}
  spend(n: number): void {
    this.left -= n;
    if (this.left < 0) throw TOO_COSTLY;
  }
}

function push(out: Segment[], kind: Segment['kind'], a: number, b: number, n: number): void {
  if (n <= 0) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind && (kind === 'added' ? last.b + last.n === b : last.a + last.n === a) && (kind !== 'same' || last.b + last.n === b)) {
    last.n += n;
    return;
  }
  out.push({ kind, a, b, n });
}

/** The edit script of a[aLo, aHi) against b[bLo, bHi), appended to `out` in order. */
function* diffRange(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number, out: Segment[], steps: Steps): Work<void> {
  let p = 0;
  while (aLo + p < aHi && bLo + p < bHi && a[aLo + p] === b[bLo + p]) p++;
  push(out, 'same', aLo, bLo, p);
  aLo += p;
  bLo += p;
  let s = 0;
  while (aHi - s > aLo && bHi - s > bLo && a[aHi - 1 - s] === b[bHi - 1 - s]) s++;
  const aEnd = aHi - s;
  const bEnd = bHi - s;
  if (aLo === aEnd) push(out, 'added', aLo, bLo, bEnd - bLo);
  else if (bLo === bEnd) push(out, 'removed', aLo, bLo, aEnd - aLo);
  else yield* bisect(a, aLo, aEnd, b, bLo, bEnd, out, steps);
  push(out, 'same', aEnd, bEnd, s);
}

/**
 * Myers' middle snake (as diff-match-patch's bisect): finds where a shortest path crosses the middle,
 * then diffs the two halves. Memory is linear in the lengths; a turn may be given at every step of d.
 */
function* bisect(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number, out: Segment[], steps: Steps): Work<void> {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const vOffset = maxD;
  const vLength = 2 * maxD + 2;
  const v1 = new Int32Array(vLength).fill(-1);
  const v2 = new Int32Array(vLength).fill(-1);
  v1[vOffset + 1] = 0;
  v2[vOffset + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  for (let d = 0; d < maxD; d++) {
    steps.spend(2 * d + 2);
    yield;
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1 = k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1]) ? v1[k1Offset + 1] : v1[k1Offset - 1] + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      v1[k1Offset] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = n - v2[k2Offset];
          if (x1 >= x2) {
            yield* diffRange(a, aLo, aLo + x1, b, bLo, bLo + y1, out, steps);
            yield* diffRange(a, aLo + x1, aHi, b, bLo + y1, bHi, out, steps);
            return;
          }
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2 = k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1]) ? v2[k2Offset + 1] : v2[k2Offset - 1] + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aHi - 1 - x2] === b[bHi - 1 - y2]) {
        x2++;
        y2++;
      }
      v2[k2Offset] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset];
          const y1 = vOffset + x1 - k1Offset;
          if (x1 >= n - x2) {
            yield* diffRange(a, aLo, aLo + x1, b, bLo, bLo + y1, out, steps);
            yield* diffRange(a, aLo + x1, aHi, b, bLo + y1, bHi, out, steps);
            return;
          }
        }
      }
    }
  }
  // Nothing in common.
  push(out, 'removed', aLo, bLo, n);
  push(out, 'added', aLo + n, bLo, m);
}

/** The edit script of two whole sequences, or TOO_COSTLY thrown when it takes more than `budget` steps. */
function* diffIds(a: Int32Array, b: Int32Array, budget: number): Work<Segment[]> {
  const out: Segment[] = [];
  yield* diffRange(a, 0, a.length, b, 0, b.length, out, new Steps(budget));
  return out;
}

/** Tries a diff; null when it was too costly. */
function* tryDiff(a: Int32Array, b: Int32Array, budget: number): Work<Segment[] | null> {
  try {
    return yield* diffIds(a, b, budget);
  } catch (error) {
    if (error === TOO_COSTLY) return null;
    throw error;
  }
}

// ---- words ------------------------------------------------------------------------------------------------

/** FNV-1a of a word: where the larger pieces are cut. */
function hashOf(word: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Cuts words [lo, hi) into pieces: the starts of each piece, and one id per piece. */
function pieces(words: readonly string[], lo: number, hi: number, ids: Ids): { starts: number[]; ids: Int32Array } {
  const starts: number[] = [];
  const keys: string[] = [];
  let start = lo;
  for (let i = lo; i < hi; i++) {
    if (hashOf(words[i]) % PIECE_CUT === 0 || i - start + 1 >= PIECE_MAX || i === hi - 1) {
      starts.push(start);
      keys.push(words.slice(start, i + 1).join(' '));
      start = i + 1;
    }
  }
  return { starts, ids: ids.all(keys) };
}

/**
 * The edit script of the words, with the guard for long pages (see the top of this file); `coarse` when
 * larger pieces were used.
 */
function* wordScript(a: readonly string[], b: readonly string[]): Work<{ segments: Segment[]; coarse: boolean }> {
  const ids = new Ids();
  const ai = ids.all(a);
  const bi = ids.all(b);
  let p = 0;
  while (p < ai.length && p < bi.length && ai[p] === bi[p]) p++;
  let s = 0;
  while (s < ai.length - p && s < bi.length - p && ai[ai.length - 1 - s] === bi[bi.length - 1 - s]) s++;
  const aEnd = ai.length - s;
  const bEnd = bi.length - s;
  if (aEnd - p <= LARGE_PAGE_WORDS && bEnd - p <= LARGE_PAGE_WORDS) {
    const exact = yield* tryDiff(ai, bi, WORD_DIFF_STEPS);
    if (exact) return { segments: exact, coarse: false };
  }
  // Larger pieces, for the middle that differs.
  const out: Segment[] = [];
  push(out, 'same', 0, 0, p);
  const pa = pieces(a, p, aEnd, ids);
  const pb = pieces(b, p, bEnd, ids);
  yield;
  const script = yield* tryDiff(pa.ids, pb.ids, PIECE_DIFF_STEPS);
  const startA = (k: number) => (k < pa.starts.length ? pa.starts[k] : aEnd);
  const startB = (k: number) => (k < pb.starts.length ? pb.starts[k] : bEnd);
  const passage = function* (a0: number, a1: number, b0: number, b1: number): Work<void> {
    if (a1 - a0 + (b1 - b0) <= PASSAGE_WORDS) {
      const fine = yield* tryDiff(ai.subarray(a0, a1), bi.subarray(b0, b1), PASSAGE_DIFF_STEPS);
      if (fine) {
        for (const seg of fine) push(out, seg.kind, seg.a + a0, seg.b + b0, seg.n);
        return;
      }
    }
    push(out, 'removed', a0, b0, a1 - a0);
    push(out, 'added', a1, b0, b1 - b0);
  };
  if (!script) {
    yield* passage(p, aEnd, p, bEnd);
  } else {
    // Each run of differing pieces is one passage; pieces the same are the same words.
    let k = 0;
    while (k < script.length) {
      const seg = script[k];
      if (seg.kind === 'same') {
        const a0 = startA(seg.a);
        const n = startA(seg.a + seg.n) - a0;
        push(out, 'same', a0, startB(seg.b), n);
        k++;
        continue;
      }
      const ka = seg.a;
      const kb = seg.b;
      let kaEnd = ka;
      let kbEnd = kb;
      while (k < script.length && script[k].kind !== 'same') {
        if (script[k].kind === 'removed') kaEnd = script[k].a + script[k].n;
        else kbEnd = script[k].b + script[k].n;
        k++;
      }
      kaEnd = Math.max(kaEnd, ka);
      kbEnd = Math.max(kbEnd, kb);
      yield* passage(startA(ka), startA(kaEnd), startB(kb), startB(kbEnd));
      yield;
    }
  }
  push(out, 'same', aEnd, bEnd, s);
  return { segments: out, coarse: true };
}

/** Segments as runs of words (adjacent runs of one kind merged). */
function runsOf(segments: readonly Segment[], a: readonly string[], b: readonly string[]): WordChange[] {
  const runs: WordChange[] = [];
  for (const seg of segments) {
    const text = (seg.kind === 'added' ? b.slice(seg.b, seg.b + seg.n) : a.slice(seg.a, seg.a + seg.n)).join(' ');
    const last = runs[runs.length - 1];
    if (last && last.kind === seg.kind) last.text = `${last.text} ${text}`;
    else runs.push({ kind: seg.kind, text });
  }
  return runs;
}

/** Added, removed and changed words: next to each other, removed and added words pair up as changed (old → new). */
function countsOf(segments: readonly Segment[]): { added: number; removed: number; changed: number } {
  let added = 0;
  let removed = 0;
  let changed = 0;
  let r = 0;
  let ad = 0;
  const close = () => {
    const pairs = Math.min(r, ad);
    changed += pairs;
    added += ad - pairs;
    removed += r - pairs;
    r = 0;
    ad = 0;
  };
  for (const seg of segments) {
    if (seg.kind === 'same') close();
    else if (seg.kind === 'removed') r += seg.n;
    else ad += seg.n;
  }
  close();
  return { added, removed, changed };
}

/** The runs of words that differ between `a` and `b` and those that are the same, in order (a shortest diff). */
export function diffWords(a: readonly string[], b: readonly string[]): WordChange[] {
  const { segments } = runAtOnce(wordScript(a, b));
  return runsOf(segments, a, b);
}

/** Up to this many words of the same text are shown on each side of a change. */
export const CONTEXT_WORDS = 5;

/** One change on a page, with the same words around it. */
export interface ChangeEntry {
  before: string[];
  removed: string[];
  added: string[];
  after: string[];
  /** The words before / after reach the start / end of the page (nothing more there to point to). */
  atStart: boolean;
  atEnd: boolean;
}

/**
 * A page's changes, each with up to `context` words of the same text before and after it. The context stops
 * at the next change, so it is always text found in both versions.
 */
export function changeEntries(changes: readonly WordChange[], context: number = CONTEXT_WORDS): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const split = (text: string) => (text === '' ? [] : text.split(' '));
  let k = 0;
  while (k < changes.length) {
    if (changes[k].kind === 'same') {
      k++;
      continue;
    }
    const start = k;
    const removed: string[] = [];
    const added: string[] = [];
    while (k < changes.length && changes[k].kind !== 'same') {
      (changes[k].kind === 'removed' ? removed : added).push(...split(changes[k].text));
      k++;
    }
    const prev = start > 0 ? split(changes[start - 1].text) : [];
    const next = k < changes.length ? split(changes[k].text) : [];
    entries.push({
      before: prev.slice(-context),
      removed,
      added,
      after: next.slice(0, context),
      atStart: start === 0 || (start === 1 && prev.length <= context),
      atEnd: k === changes.length || (k === changes.length - 1 && next.length <= context),
    });
  }
  return entries;
}

// ---- pages ------------------------------------------------------------------------------------------------

/** Each page's words as sorted ids, for counting shared words (made when first needed). */
class Bags {
  private readonly made: (Int32Array | undefined)[] = [];
  constructor(
    private readonly pages: readonly (readonly string[])[],
    private readonly ids: Ids,
  ) {}
  of(i: number): Int32Array {
    let bag = this.made[i];
    if (!bag) {
      bag = this.ids.all(this.pages[i]).sort();
      this.made[i] = bag;
    }
    return bag;
  }
}

/** Shared words over the larger page's words (1 for two empty pages). */
function similarity(p: Int32Array, q: Int32Array): number {
  const most = Math.max(p.length, q.length);
  if (most === 0) return 1;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < p.length && j < q.length) {
    if (p[i] === q[j]) {
      shared++;
      i++;
      j++;
    } else if (p[i] < q[j]) i++;
    else j++;
  }
  return shared / most;
}

type Row = [number | null, number | null];

/**
 * Pairs the unmatched pages ea (earlier) and lb (later) of one gap, in order: the pairing with the most
 * shared words, among pages sharing at least half their words. A large gap compares only pages near the
 * diagonal (GAP_SIMILARITIES).
 */
function* pairGap(ea: readonly number[], lb: readonly number[], bagsA: Bags, bagsB: Bags, rows: Row[]): Work<void> {
  const n = ea.length;
  const m = lb.length;
  if (n === 0 || m === 0) {
    for (const i of ea) rows.push([i, null]);
    for (const j of lb) rows.push([null, j]);
    return;
  }
  const all = n * m <= GAP_SIMILARITIES;
  const band = Math.max(3, Math.floor(GAP_SIMILARITIES / (2 * Math.max(n, m))));
  const slope = m / n;
  const width = m + 1;
  const score = new Float32Array((n + 1) * (m + 1));
  // 1: skip the earlier page; 2: skip the later page; 3: pair them.
  const move = new Uint8Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) move[i * width] = 1;
  for (let j = 1; j <= m; j++) move[j] = 2;
  for (let i = 1; i <= n; i++) {
    yield;
    for (let j = 1; j <= m; j++) {
      const up = score[(i - 1) * width + j];
      const left = score[i * width + j - 1];
      let best = left;
      let how = 2;
      if (up > best) {
        best = up;
        how = 1;
      }
      if (all || Math.abs(j - 1 - (i - 1) * slope) <= band) {
        const s = similarity(bagsA.of(ea[i - 1]), bagsB.of(lb[j - 1]));
        const diagonal = score[(i - 1) * width + j - 1] + s;
        if (s >= MIN_SHARED && diagonal >= best) {
          best = diagonal;
          how = 3;
        }
      }
      score[i * width + j] = best;
      move[i * width + j] = how;
    }
  }
  const back: Row[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const how = move[i * width + j];
    if (how === 3) {
      back.push([ea[i - 1], lb[j - 1]]);
      i--;
      j--;
    } else if (how === 1) {
      back.push([ea[i - 1], null]);
      i--;
    } else {
      back.push([null, lb[j - 1]]);
      j--;
    }
  }
  for (let k = back.length - 1; k >= 0; k--) rows.push(back[k]);
}

/** Steps the page-level diff may take: two files of 1,000 pages need at most about 1,000,000. */
const PAGE_DIFF_STEPS = 5_000_000;

function* alignWork(a: readonly (readonly string[])[], b: readonly (readonly string[])[], ids: Ids): Work<Row[]> {
  // Each page's text as a number, page by page (2,000 pages joined at once held the window 0.11 s).
  const pageIds = new Ids();
  const keys = function* (pages: readonly (readonly string[])[]): Work<Int32Array> {
    const out = new Int32Array(pages.length);
    for (let i = 0; i < pages.length; i++) {
      out[i] = pageIds.of(pages[i].join(' '));
      yield;
    }
    return out;
  };
  const pa = yield* keys(a);
  const pb = yield* keys(b);
  const script = (yield* tryDiff(pa, pb, PAGE_DIFF_STEPS)) ?? [
    { kind: 'removed' as const, a: 0, b: 0, n: a.length },
    { kind: 'added' as const, a: a.length, b: 0, n: b.length },
  ];
  const bagsA = new Bags(a, ids);
  const bagsB = new Bags(b, ids);
  const rows: Row[] = [];
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flush = function* (): Work<void> {
    if (gapA.length === 0 && gapB.length === 0) return;
    yield* pairGap(gapA, gapB, bagsA, bagsB, rows);
    gapA = [];
    gapB = [];
  };
  for (const seg of script) {
    if (seg.kind === 'same') {
      yield* flush();
      for (let k = 0; k < seg.n; k++) rows.push([seg.a + k, seg.b + k]);
    } else if (seg.kind === 'removed') {
      for (let k = 0; k < seg.n; k++) gapA.push(seg.a + k);
    } else {
      for (let k = 0; k < seg.n; k++) gapB.push(seg.b + k);
    }
  }
  yield* flush();
  return rows;
}

/**
 * Pairs the pages of two files (each page as its words): `[earlier, later]` for each row, null for a page in
 * one file only, in the order of the files.
 */
export function alignPages(a: readonly string[][], b: readonly string[][]): [number | null, number | null][] {
  return runAtOnce(alignWork(a, b, new Ids()));
}

/** Compares the page texts of two files (each page's text, as read), giving the window its turns through `pace`. */
export function compareTexts(earlier: readonly string[], later: readonly string[], pace: Pace): Promise<Comparison> {
  return runPaced(compareWork(earlier, later), pace);
}

function* compareWork(earlier: readonly string[], later: readonly string[]): Work<Comparison> {
  const ta: Token[][] = [];
  const tb: Token[][] = [];
  let pagesWithoutText = 0;
  for (const [texts, into] of [
    [earlier, ta],
    [later, tb],
  ] as const) {
    for (const text of texts) {
      into.push(tokensOf(text));
      if (pageHasNoText(text)) pagesWithoutText++;
      yield;
    }
  }
  // A word broken at a line end takes the form the other version has (hyphen dropped or kept).
  const vocabularyA = yield* vocabularyOf(ta);
  const vocabularyB = yield* vocabularyOf(tb);
  const a: string[][] = [];
  const b: string[][] = [];
  for (const page of ta) {
    a.push(resolved(page, vocabularyB));
    yield;
  }
  for (const page of tb) {
    b.push(resolved(page, vocabularyA));
    yield;
  }
  // Only the resolved words are kept.
  ta.length = 0;
  tb.length = 0;
  const rows = yield* alignWork(a, b, new Ids());
  const c: Comparison = {
    pagesEarlier: earlier.length,
    pagesLater: later.length,
    pairs: [],
    pagesDiffer: 0,
    pagesOnlyEarlier: 0,
    pagesOnlyLater: 0,
    wordsAdded: 0,
    wordsRemoved: 0,
    wordsChanged: 0,
    pagesWithoutText,
    pagesComparedCoarsely: 0,
  };
  for (const [i, j] of rows) {
    yield;
    if (i === null || j === null) {
      const words = i === null ? b[j ?? 0] : a[i];
      const changes: WordChange[] = words.length === 0 ? [] : [{ kind: i === null ? 'added' : 'removed', text: words.join(' ') }];
      c.pairs.push({ earlier: i, later: j, changes, added: 0, removed: 0, changed: 0, coarse: false });
      if (i === null) c.pagesOnlyLater++;
      else c.pagesOnlyEarlier++;
      continue;
    }
    const wa = a[i];
    const wb = b[j];
    if (wa.length === wb.length && wa.every((w, k) => w === wb[k])) {
      c.pairs.push({ earlier: i, later: j, changes: [], added: 0, removed: 0, changed: 0, coarse: false });
      continue;
    }
    const { segments, coarse } = yield* wordScript(wa, wb);
    const counts = countsOf(segments);
    c.pairs.push({ earlier: i, later: j, changes: runsOf(segments, wa, wb), ...counts, coarse });
    c.pagesDiffer++;
    c.wordsAdded += counts.added;
    c.wordsRemoved += counts.removed;
    c.wordsChanged += counts.changed;
    if (coarse) c.pagesComparedCoarsely++;
  }
  return c;
}
