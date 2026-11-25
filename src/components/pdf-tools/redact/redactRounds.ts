// Redact's rounds (design 5.9 "The check"; lead rulings 2 and E): build the result, check it, and when a
// chosen value is still found, cover it and build again; at most three builds, and one more if the user
// confirms flattening pages that hold a value no box can cover. Never a silent pass: a value that cannot
// be covered ends the run with nothing added.
//
// A round may mark a value dealt with only by a box over it:
// - a hit that gives its own boxes (an annotation's rectangle, a text layer's words) is boxed there;
// - a hit on a page's text (R2's content hits, and the reader-side check of the page text) is placed by
//   the find's own rules on that page's text (placesOfValue, then the check's looser net) and boxed;
// - a hit that cannot be placed is flattened only when the check says it is NOT drawn (R2's `drawn`
//   flag: hidden alternative text, private keys) and the user confirms; a drawn one, or one without the
//   flag, ends the run "not verified" (flattening drawn text would print it into the picture);
// - a hit with no page (bookmarks, document properties, the form, other) ends the run.
//
// After the end-to-end review (T-052): what a page to rebuild DRAWS is looked at, not only its text.
// Before the first build the source is checked once and what it draws on those pages that the find did
// not box (an annotation's appearance, a pattern, a form) is boxed where it paints (B1); every page to
// rebuild gets the check's wider places in its text, whatever the output (B2); flattening never drops a
// page's boxes (B4); alternative text (/ActualText, /Alt) that holds a chosen value is boxed where its
// marked content paints, and when that cannot be told the question says the page may show it (B5).
// Where an object paints is measured by drawing the page with and without it (makePlacer).
//
// Confidentiality: targets and page texts stay in memory; every error is made of page numbers and
// fixed place names. The copies of the file the placer draws live only inside its calls.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFInvalidObject, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFContext, type PDFObject } from 'pdf-lib';
import { keyOf, placesOfValue, type RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { BOX_PAD_PT, buildPageText, pageReadings, pageSeamPlaces, placesInReadings, rangePieces, rangeRects, type MeasureChar, type PageTextModel, type PixelBox, type Rect } from '@/lib/pdf-tools/pageText';
import type { RebuiltPage, RedactBuildReport } from '@/lib/pdf-tools/redactBuild';
import { loosePlacesOf, type CheckHit, type CheckTarget, type PageDrawing } from '@/lib/pdf-tools/redactCheck';
import { AUTO_BOX_MAX_SHARE, type AnnotationText } from '@/lib/pdf-tools/redactFind';
import { loadPaced, runAtOnce, runPaced, savePaced, type Pace, type Work } from '@/lib/pdf-tools/pace';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { differingBlocks, differingBlocksPaced, toUserRect } from './pageEncode';
import { drawingTransform, type DrawnPage, type PageWork, type PixelRenderer } from './redactPages';
import type { FindReader } from './redactFindRun';
import { flattenDeclined, notVerified, type NotVerifiedHint } from './redactRecord';
import type { TextOp } from './rendererView';
import type { RedactArea } from './reviewState';

/** Builds before the run gives up (design: "at most three rounds"); a confirmed flatten adds one. */
export const MAX_BUILDS = 3;

/** A place where the check still finds a chosen value. Holds no text. */
export interface RoundHit {
  /** 0-based pages it belongs to; empty when it belongs to none. */
  pages: number[];
  /** Named places when it belongs to no page ('bookmarks', 'document properties', 'form', 'other'). */
  elsewhere: string[];
  /** Where the file itself places it (an annotation's rectangle, a text layer's words), user space. */
  boxes?: { page: number; rect: Rect }[];
  /** R2's flag: the value is drawn on the page (text shown, an appearance) or not (alternative text, private keys); absent = not known. */
  drawn?: boolean;
  /**
   * What a round can do (redactCheck.ts HitRemedy): 'boxes' (the file gives them), 'find' (drawn: the
   * find must place it), 'flatten' (not drawn: flattening the page removes it, on the user's word),
   * 'none' (no rebuild removes it). Absent: decided from the boxes and `drawn`.
   */
  remedy?: 'boxes' | 'find' | 'flatten' | 'none';
  /** What holds it (R2's HitPart: 'content', 'resources', 'annotation', 'field', ...); absent for the reader-side check. */
  part?: string;
  /** R2's object ('n g R'), for placing what that object paints; absent for the reader-side check. */
  object?: string;
  /** A structure element's alternative text (CheckHit.marked, R6): the marked-content ids it covers, by page. */
  marked?: { page: number; mcids: number[] }[];
}

/** R2's located hits as round hits. */
export function fromCheckHits(hits: readonly CheckHit[]): RoundHit[] {
  return hits.map((h) => ({
    pages: [...h.pages],
    elsewhere: [...h.elsewhere],
    ...(h.boxes ? { boxes: h.boxes.map((b) => ({ page: b.page, rect: { ...b.rect } })) } : {}),
    drawn: h.drawn === true,
    remedy: h.remedy,
    part: h.part,
    object: h.object,
    ...(h.marked ? { marked: h.marked.map((m) => ({ page: m.page, mcids: [...m.mcids] })) } : {}),
  }));
}

/**
 * Where a hit stands on a page, as far as the run can tell (end-to-end review B1, B5; `makePlacer`):
 * - 'find': the find reads what holds it (the page's own content, a form the page draws, a font), so
 *   the page's text places it (`locate`); `font` when it sits in a font, whose name no box covers;
 * - 'ink': where it paints, from the page drawn with and without it; empty when it paints nothing there;
 * - 'none': it cannot be placed. `mayShow`: alternative text (/ActualText, /Alt) says the page shows a
 *   chosen value there, in a form the find cannot read.
 */
export type Placement = { by: 'find'; font?: boolean } | { by: 'ink'; rects: Rect[] } | { by: 'none'; mayShow?: boolean };

/** What the flatten question is told besides its pages. */
export interface FlattenInfo {
  /** Pages whose alternative text says they may show a chosen value in a form Redact cannot read. */
  mayShow: number[];
}

// ---- placing a value on a page's text ---------------------------------------------------------------------

/**
 * Places of a value by the loose rule (redactCheck.ts loosePlacesOf): codes and numbers with any
 * punctuation, spacing or line breaks between their characters (a short new-kind number with no digit
 * joined); an email with any white space; an IP address with white space around its dots; words with
 * anything but letters and digits between them, or nothing at all. Offsets in `text`.
 */
export function loosePlaces(text: string, kind: RedactKind, form: string): { start: number; end: number }[] {
  // One loose rule, one implementation (wave 2, ruling 4): the check's own, used by the find, the check of
  // copied and rebuilt pages and the file-name step alike (RX-LIB rx2-contract.md (a)).
  return loosePlacesOf(text, kind, form);
}

/**
 * Where the targets stand in a page's text, as areas to box: by the find's own rule (placesOfValue),
 * and by the check's looser net (loosePlaces). Each place's boxes are padded as the find pads them.
 * `neighbours`: the pages before and after, for a value that runs on across a page turn (its piece here).
 */
export function locatePlaces(model: PageTextModel, targets: readonly CheckTarget[], measure: MeasureChar, neighbours: { prev?: PageTextModel; next?: PageTextModel } = {}): RedactArea[] {
  return runAtOnce(locateWork(model, targets, measure, neighbours));
}

/** `locatePlaces` with a turn for the window when one is due between the chosen values' forms (J, wave 4): the same areas. */
export function locatePlacesPaced(model: PageTextModel, targets: readonly CheckTarget[], measure: MeasureChar, neighbours: { prev?: PageTextModel; next?: PageTextModel }, pace: Pace): Promise<RedactArea[]> {
  return runPaced(locateWork(model, targets, measure, neighbours), pace);
}

function* locateWork(model: PageTextModel, targets: readonly CheckTarget[], measure: MeasureChar, neighbours: { prev?: PageTextModel; next?: PageTextModel }): Work<RedactArea[]> {
  const seen = new Set<string>();
  const areas: RedactArea[] = [];
  // Ruling C (wave 3, RX-LIB rx2-contract.md "Wave 3"): every reading of the page, the drawing order, a word
  // broken at a line end rejoined, and each column or table cell read by position; a place found in another
  // reading than the drawing order has one range per piece (each on its own line). Across a page turn
  // (pageSeamPlaces): the end of the page before read on into this one, and this one into the next.
  const readings = pageReadings(model);
  for (const target of targets) {
    for (const form of target.forms) {
      const find = (text: string) => [...placesOfValue(text, target.kind, keyOf(target.kind, form)), ...loosePlaces(text, target.kind, form)];
      // Ruling S (wave 5): a chance of a turn before each reading and each page turn, not only between values (one
      // value of H33's register held the window 0.9 s here); placesInReadings reads each reading in turn as well.
      const found: { ranges: [number, number][] }[] = [];
      for (const reading of readings) {
        yield;
        found.push(...placesInReadings(model, find, [reading]).map((p) => ({ ranges: p.ranges })));
      }
      if (neighbours.prev) {
        yield;
        found.push(...pageSeamPlaces(neighbours.prev, model, find).map((p) => ({ ranges: p.next })));
      }
      if (neighbours.next) {
        yield;
        found.push(...pageSeamPlaces(model, neighbours.next, find).map((p) => ({ ranges: p.prev })));
      }
      for (const { ranges } of found) {
        const id = ranges.map(([s, e]) => `${s}:${e}`).join('_');
        if (ranges.length === 0 || seen.has(id)) continue;
        seen.add(id);
        const rects = ranges.flatMap(([s, e]) => rangeRects(model, s, e, measure, BOX_PAD_PT));
        if (rects.length === 0) continue;
        const [first] = rangePieces(model, ranges[0][0], ranges[0][1], measure);
        const angle = first ? ((Math.round((Math.atan2(first.direction[1], first.direction[0]) * 180) / Math.PI) % 360) + 360) % 360 : 0;
        areas.push({ page: model.pageIndex, rects, kind: target.kind, hidden: false, angle, ranges: ranges.map(([s, e]): [number, number] => [s, e]) });
      }
    }
  }
  return areas;
}

/** A character a reader extracts when a font's map cannot be trusted: private use (either plane), the replacement character, a control character. */
const untrusted = (cp: number) => (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000 || cp === 0xfffd || (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d);

/**
 * Where a page's text cannot be read for certain (ruling 2): each run of characters the reader extracted
 * as private-use, replacement or control characters, as an area (padded as the find pads text). Over a
 * page that is rebuilt anyway such text is covered: what it shows cannot be told. With `rule` (K1, wave 4):
 * a run that is a cluster part of another script (clusterPart, by its place on the page) cannot be part of a
 * chosen value and is not covered.
 */
export function unreadableTextAreas(model: PageTextModel, measure: MeasureChar, rule?: ClusterRule): RedactArea[] {
  const areas: RedactArea[] = [];
  for (const [at, end] of untrustedRuns(model.text)) {
    if (rule && harmlessRun(model.text, at, end, rule)) continue;
    const rects = rangeRects(model, at, end, measure, BOX_PAD_PT);
    if (rects.length > 0) areas.push({ page: model.pageIndex, rects, kind: 'drawn', hidden: false, angle: 0, ranges: [[at, end]] });
  }
  return areas;
}

/** [start, end) of each run of characters a reader takes for nothing (untrusted) in `text`. */
function untrustedRuns(text: string): [number, number][] {
  const runs: [number, number][] = [];
  const width = (k: number) => ((text.codePointAt(k) ?? 0) > 0xffff ? 2 : 1);
  const odd = (k: number) => untrusted(text.codePointAt(k) ?? 0);
  let at = 0;
  while (at < text.length) {
    if (!odd(at)) {
      at += width(at);
      continue;
    }
    let end = at;
    while (end < text.length && odd(end)) end += width(end);
    runs.push([at, end]);
    at = end;
  }
  return runs;
}

// ---- K1 (wave 4): glyphs of another script's letter clusters that no map gives a letter for -----------------
//
// Chrome writes an Indian-script cluster's letters on its first glyph and maps the cluster's other glyphs to
// U+0000 (both readers extract them as U+0000; re-test 3, H14 and H15). Such a glyph is a risk only if it could be
// part of a chosen value. One that stands inside a word of a script that none of the chosen values uses, with no
// Latin letter or digit near it (past spaces and punctuation), and that is shorter than every chosen value, cannot
// be: it is not covered, and the words around it stay. Any other unreadable glyph is covered as before, by itself.

/** No letter of its own: what a composite font's map gives the cluster's other glyphs. */
const NO_LETTER = '\u0000';
const SCRIPT_TESTS: readonly (readonly [string, RegExp])[] = (
  ['Latin', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Arabic', 'Hebrew', 'Greek', 'Cyrillic', 'Thai', 'Han', 'Hangul', 'Hiragana', 'Katakana'] as const
).map((s) => [s, new RegExp(`^\\p{Script=${s}}$`, 'u')] as const);
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u;
const scriptOf = (ch: string) => SCRIPT_TESTS.find(([, re]) => re.test(ch))?.[0] ?? 'Other';

/** What K1 needs to know of the chosen values: the scripts their letters are in, and the shortest one's length (letters and digits). */
export interface ClusterRule {
  scripts: ReadonlySet<string>;
  shortest: number;
  /**
   * Ruling R (wave 5): the scripts of the typed values the find placed nowhere. Text of such a script that cannot be
   * read may be where the value is (Chrome's conjunct in a typed Hindi name, T4-B on H14): it is covered whole, as in
   * round 3, never glyph by glyph.
   */
  whole: ReadonlySet<string>;
}

/** The K1 rule for the chosen values' written forms (CheckTarget.forms), and the forms of those placed nowhere (`nowhere`). */
export function clusterRule(forms: readonly string[], nowhere: readonly string[] = []): ClusterRule {
  const scriptsOf = (form: string) => [...form.normalize('NFKC')].filter((c) => LETTER_OR_MARK.test(c)).map(scriptOf);
  const scripts = new Set<string>();
  let shortest = Infinity;
  for (const form of forms) {
    const chars = [...form.normalize('NFKC')].filter((c) => WORD_CHAR.test(c));
    if (chars.length > 0) shortest = Math.min(shortest, chars.length);
    for (const s of scriptsOf(form)) scripts.add(s);
  }
  const whole = new Set(nowhere.flatMap(scriptsOf));
  for (const s of whole) scripts.add(s);
  return { scripts, shortest, whole };
}

/** Ruling R: the run [at, end) of `text` has a letter or mark of a script in `rule.whole` nearest it on either side (past spaces and punctuation). */
function wholeRun(text: string, at: number, end: number, rule: ClusterRule): boolean {
  if (rule.whole.size === 0) return false;
  const nearest = (side: string[]) => side.find((c) => c !== NO_LETTER && WORD_CHAR.test(c));
  return [nearest([...text.slice(Math.max(0, at - 40), at)].reverse()), nearest([...text.slice(end, end + 40)])].some((c) => c !== undefined && LETTER_OR_MARK.test(c) && rule.whole.has(scriptOf(c)));
}

/** Ruling R: true when `text` (a page's reading) holds text it cannot read of a script whose typed value was placed nowhere. */
export function wholeRunsIn(text: string, rule: ClusterRule): boolean {
  return rule.whole.size > 0 && untrustedRuns(text).some(([at, end]) => wholeRun(text, at, end, rule));
}

/**
 * K1: true when a run of `length` glyphs with no letter of their own (U+0000), read with `before` and `after` beside
 * it (in reading or drawing order), cannot be part of a chosen value: at most three glyphs, fewer than the shortest
 * value; the nearest letter or digit on each side (past spaces and punctuation) is no Latin letter, no digit and no
 * letter of a script a chosen value uses; and right beside it stands a letter or mark of such another script.
 */
export function clusterPart(length: number, before: string, after: string, rule: ClusterRule): boolean {
  if (length < 1 || length > 3 || length >= rule.shortest) return false;
  const left = [...before].reverse();
  const right = [...after];
  const otherScript = (c: string | undefined) => c !== undefined && LETTER_OR_MARK.test(c) && scriptOf(c) !== 'Latin' && !rule.scripts.has(scriptOf(c));
  for (const side of [left, right]) {
    const word = side.find((c) => c !== NO_LETTER && WORD_CHAR.test(c));
    if (word !== undefined && !otherScript(word)) return false;
  }
  return otherScript(left[0]) || otherScript(right[0]);
}

/**
 * K1, said before the run: the pages among `pages` whose text (the find's reading) has letters Redact cannot read that
 * will be covered on a rebuilt page (unreadableTextAreas with the chosen values' `forms`). A symbol or two in a font
 * with private-use codes (bullets) is left out: the limits already say such symbols are covered with small boxes.
 */
export function pagesLosingText(models: readonly (PageTextModel | undefined)[], pages: readonly number[], forms: readonly string[]): number[] {
  const rule = clusterRule(forms);
  const bullet = (run: string) => [...run].length <= 2 && [...run].every((c) => (c.codePointAt(0) ?? 0) >= 0xe000);
  return [...new Set(pages)]
    .sort((a, b) => a - b)
    .filter((p) => {
      const text = models[p]?.text ?? '';
      return untrustedRuns(text).some(([at, end]) => !harmlessRun(text, at, end, rule) && !bullet(text.slice(at, end)));
    });
}

/** A run of untrusted characters in `text` that is only glyphs with no letter of their own and a cluster part (clusterPart). */
function harmlessRun(text: string, at: number, end: number, rule: ClusterRule): boolean {
  if (![...text.slice(at, end)].every((c) => c === NO_LETTER)) return false;
  return clusterPart(end - at, text.slice(Math.max(0, at - 40), at), text.slice(end, end + 40), rule);
}

/**
 * K1 on the renderer's side: the operations `judged` flagged only because they cannot be read, whose only untrusted
 * characters are glyphs with no letter of their own that are cluster parts both in the drawing's order (the
 * operations of the same drawing joined as drawn) and where they stand on the page (the find's reading of the
 * page, `model`, at the operation's place), are not flagged: they cannot be part of a chosen value. Everything else
 * is as judged.
 */
export function releaseClusterParts<J extends { flagged: Set<number>; unreadable: Set<number>; places: Map<number, [number, number][]>; held?: Set<number>; gaveUp?: Set<number> }>(
  judged: J,
  ops: readonly TextOp[],
  model: PageTextModel | undefined,
  measure: MeasureChar,
  rule: ClusterRule,
): J {
  // Never an operation whose place the pixels did not prove (ruling L3: an unplaced one is taken whole).
  const candidates = ops.filter((o) => judged.unreadable.has(o.index) && !judged.held?.has(o.index) && !judged.gaveUp?.has(o.index) && o.gaveUp === false && o.placed !== false && !o.innerUnreadable && o.at !== null && [...o.text].some((c) => c === NO_LETTER) && [...o.text].every((c) => c === NO_LETTER || !untrusted(c.codePointAt(0) ?? 0)));
  if (candidates.length === 0 || !model) return judged;
  // Where the find's reading has glyphs with no letter that are not cluster parts: an operation drawn there stays flagged.
  const unsafe = untrustedRuns(model.text)
    .filter(([at, end]) => !harmlessRun(model.text, at, end, rule))
    .flatMap(([at, end]) => rangeRects(model, at, end, measure, BOX_PAD_PT));
  const released = new Set<number>();
  // An operation that stays flagged for such glyphs is covered over them only, never as a whole line.
  const places = new Map(judged.places);
  const byDrawing = new Map<string, TextOp[]>();
  for (const o of ops) if (o.visible && o.text) byDrawing.set(o.drawing, [...(byDrawing.get(o.drawing) ?? []), o]);
  for (const o of candidates) {
    const list = byDrawing.get(o.drawing) ?? [];
    const k = list.indexOf(o);
    const before = list.slice(Math.max(0, k - 8), k).map((p) => p.text).join('');
    const after = list.slice(k + 1, k + 9).map((p) => p.text).join('');
    const joined = `${before}${o.text}${after}`;
    const runs = untrustedRuns(joined).filter(([at, end]) => at < before.length + o.text.length && end > before.length);
    const { x, y, size } = o.at!;
    const near = (r: Rect) => x >= r.x0 - size && x <= r.x1 + size && y >= r.y0 - size && y <= r.y1 + size;
    if (runs.every(([at, end]) => harmlessRun(joined, at, end, rule)) && !unsafe.some(near)) released.add(o.index);
    // Ruling R (wave 5): glyph by glyph only where no run is of a script whose typed value was placed nowhere; else the whole operation.
    else if (!places.has(o.index) && o.chars && o.chars.length === o.text.length + 1 && !runs.some(([at, end]) => wholeRun(joined, at, end, rule))) {
      places.set(o.index, Array.from({ length: o.text.length }, (_, i): [number, number] => [i, i + 1]).filter(([i]) => o.text[i] === NO_LETTER));
    }
  }
  const flagged = new Set([...judged.flagged].filter((i) => !released.has(i)));
  const unreadable = new Set([...judged.unreadable].filter((i) => !released.has(i)));
  return { ...judged, flagged, unreadable, places };
}

// ---- Ruling S (wave 5): the renderer-view judge, in turns ------------------------------------------------------

/** What a judge in turns has already worked out, by text (one page's; dropped with the run). */
export interface JudgeMemo {
  holds: Map<string, boolean>;
  spans: Map<string, [number, number][]>;
}

/** How long one pass of a judge in turns works out answers itself before it leaves the rest for between turns. */
export const JUDGE_BUDGET_MS = 40;

/**
 * Ruling S: a judge that asks `holds` and `spans` of many texts (rendererView.ts flaggedOperations: H33's register,
 * 2,951 operations and 210 chosen values, held the window 1.7 s), run so that the window gets its turns. Each pass
 * runs the judge with the answers known so far, works out new ones itself for `budgetMs`, and answers the rest "no"
 * for now; those are then worked out with a chance of a turn before each, and the judge runs again, until a pass asks
 * nothing new. That last pass had every answer, so its verdict is exactly the judge's own.
 */
export async function judgeInTurns<J>(
  judge: (holds: (text: string) => boolean, spans: (text: string) => [number, number][]) => J,
  answers: { holds: (text: string) => boolean; spans: (text: string) => [number, number][] },
  pace: Pace,
  memo: JudgeMemo = { holds: new Map(), spans: new Map() },
  budgetMs: number = JUDGE_BUDGET_MS,
): Promise<J> {
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  for (;;) {
    const start = clock();
    const later = { holds: new Set<string>(), spans: new Set<string>() };
    const holds = (text: string) => {
      const known = memo.holds.get(text);
      if (known !== undefined) return known;
      if (clock() - start >= budgetMs) {
        later.holds.add(text);
        return false;
      }
      const answer = answers.holds(text);
      memo.holds.set(text, answer);
      return answer;
    };
    const spans = (text: string): [number, number][] => {
      const known = memo.spans.get(text);
      if (known !== undefined) return known;
      if (clock() - start >= budgetMs) {
        later.spans.add(text);
        return [];
      }
      const answer = answers.spans(text);
      memo.spans.set(text, answer);
      return answer;
    };
    const verdict = judge(holds, spans);
    if (later.holds.size === 0 && later.spans.size === 0) return verdict;
    for (const text of later.holds) {
      const turn = pace();
      if (turn) await turn;
      memo.holds.set(text, answers.holds(text));
    }
    for (const text of later.spans) {
      const turn = pace();
      if (turn) await turn;
      memo.spans.set(text, answers.spans(text));
    }
    const turn = pace();
    if (turn) await turn;
  }
}

/**
 * K1 on the file reading's side (the proof's map-only text): for a drawing of page text in a composite font with an
 * Identity encoding and a character map, the number of glyphs its strings show that the map gives no letter of their
 * own (U+0000), when that is all that makes it unreadable: every code shown has an entry, and no entry is a
 * private-use, replacement, control (other than U+0000) or empty character. Null otherwise (or when it cannot be told).
 */
function noLetterGlyphs(context: PDFContext, drawing: ProofDrawing, decoded: (key: string) => string | null): number | null {
  if (drawing.kind !== 'content' || drawing.unreadable !== 'font' || drawing.gaveUp !== false) return null;
  const fontRef = parseRef(drawing.source.font);
  const font = fontRef ? context.lookup(fontRef) : undefined;
  if (!(font instanceof PDFDict) || context.lookup(font.get(N('Subtype'))) !== N('Type0')) return null;
  const encoding = context.lookup(font.get(N('Encoding')));
  if (encoding !== N('Identity-H') && encoding !== N('Identity-V')) return null;
  const toUnicode = context.lookup(font.get(N('ToUnicode')));
  if (!(toUnicode instanceof PDFRawStream)) return null;
  let map: Map<number, string>;
  try {
    map = twoByteMap(latin1(toUnicode.dict.has(N('Filter')) ? decodePDFRawStream(toUnicode).decode() : toUnicode.contents));
  } catch {
    return null;
  }
  const text = decoded(drawing.source.stream);
  if (text === null) return null;
  let count = 0;
  for (const s of drawing.source.strings) {
    const at = skipSpace(text, s.start);
    if (at >= text.length) return null;
    const { token } = readToken(text, at, 0);
    if (token.kind !== 'string' || token.bytes.length % 2 !== 0) return null;
    for (let i = 0; i < token.bytes.length; i += 2) {
      const u = map.get((token.bytes[i] << 8) | token.bytes[i + 1]);
      if (u === undefined || u === '') return null;
      if (u === NO_LETTER) count++;
      else if ([...u].some((c) => untrusted(c.codePointAt(0) ?? 0))) return null;
    }
  }
  return count;
}

/** A ToUnicode map of two-byte codes (bfchar and bfrange, as Chrome and most writers give it); throws on anything else. */
function twoByteMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const utf16 = (hex: string) => {
    let s = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };
  for (const range of cmap.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const m of range[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) if (m[1].length !== 4 || m[2].length !== 4) throw new RangeError('not two-byte codes');
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      if (m[1].length !== 4) throw new RangeError('not two-byte codes');
      map.set(parseInt(m[1], 16), utf16(m[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
      if (m[1].length !== 4 || m[2].length !== 4) throw new RangeError('not two-byte codes');
      const [lo, hi] = [parseInt(m[1], 16), parseInt(m[2], 16)];
      if (hi < lo || hi - lo > 0xffff) throw new RangeError('bad range');
      if (m[3] !== undefined) {
        const base = utf16(m[3]);
        for (let c = lo; c <= hi; c++) map.set(c, base === '' ? '' : base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)));
      } else {
        const items = [...(m[4] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => utf16(x[1]));
        for (let c = lo; c <= hi; c++) map.set(c, items[c - lo] ?? '');
      }
    }
  }
  return map;
}

// ---- the reader-side check (design 5.9 "Text, as a reader sees it") ------------------------------------------

/**
 * What pdf.js reads of the result that the strings check (R2) cannot join: each page's text as one
 * string (a value split over two show operators), and each annotation's texts. A rebuilt page is read
 * from the result (its text layer); a copied page's text is the source's own (its content is copied
 * byte for byte), read from the enlarged-view copy, so text outside the crop box is in it too.
 */
export async function readerHits(
  result: Uint8Array,
  pageCount: number,
  rebuilt: ReadonlySet<number>,
  models: readonly (PageTextModel | undefined)[],
  holds: (text: string) => boolean,
  reader: FindReader,
  signal?: AbortSignal,
  places?: (text: string) => Iterable<{ start: number; end: number }>,
  pace?: Pace,
): Promise<RoundHit[]> {
  const hits: RoundHit[] = [];
  const annotations = await Promise.all(Array.from({ length: pageCount }, (_, page) => reader.pageAnnotationTexts(result, page, { signal })));
  let before: PageTextModel | undefined;
  for (let page = 0; page < pageCount; page++) {
    // Ruling D: a copied page is read from the find's model, without waiting for anything: a turn when due.
    const due = pace?.();
    if (due) await due;
    let model = models[page];
    if (rebuilt.has(page)) {
      const read = await reader.pageTextContent(result, page, { signal });
      model = buildPageText(page, read.items, read.styles, [0, 0, 0, 0], 0);
    }
    // Ruling C (wave 3): every reading of the page (drawing order, broken words rejoined, by position). J (wave 4): a
    // turn when due between readings (a statement page with many chosen values held the window 0.5 s here).
    const readings = model && model.text !== '' ? pageReadings(model) : [];
    let held = false;
    for (const r of readings) {
      const turn = pace?.();
      if (turn) await turn;
      if (r.text !== '' && holds(r.text)) {
        held = true;
        break;
      }
    }
    if (held) hits.push({ pages: [page], elsewhere: [], drawn: true, remedy: 'find' });
    const turn = pace?.();
    if (turn) await turn;
    // A value that begins at the end of the page before and runs on into this one (pageSeamPlaces).
    if (places && before && model && before.text !== '' && model.text !== '' && pageSeamPlaces(before, model, places).length > 0) hits.push({ pages: [page - 1, page], elsewhere: [], drawn: true, remedy: 'find' });
    before = model;
    for (const a of annotations[page] as AnnotationText[]) {
      if (!a.texts.some(holds)) continue;
      const r = a.rect;
      const rect = r.length >= 4 && r.slice(0, 4).every(Number.isFinite) ? { x0: Math.min(r[0], r[2]), y0: Math.min(r[1], r[3]), x1: Math.max(r[0], r[2]), y1: Math.max(r[1], r[3]) } : null;
      const boxed = rect !== null && rect.x1 > rect.x0 && rect.y1 > rect.y0;
      hits.push({ pages: [page], elsewhere: [], ...(boxed ? { boxes: [{ page, rect }] } : {}), remedy: boxed ? 'boxes' : 'find' });
    }
  }
  return hits;
}

// ---- the rounds -------------------------------------------------------------------------------------------------

export interface RoundDeps {
  /** Draws, burns and encodes one page (redactPages.ts drawRebuiltPage). */
  draw(work: PageWork): Promise<DrawnPage>;
  build(pages: readonly RebuiltPage[]): Promise<{ bytes: Uint8Array; report: RedactBuildReport }>;
  /** Every place the check finds a chosen value in the result, and its structure problems (sentences starting "Page n"). */
  check(bytes: Uint8Array, rebuilt: ReadonlySet<number>): Promise<{ hits: RoundHit[]; structure: string[] }>;
  /** Where the chosen values stand in a page's text (locatePlaces on the find's model of that page; in turns, ruling S). */
  locate(page: number): RedactArea[] | Promise<RedactArea[]>;
  /**
   * Asks the user to flatten pages that hold a value no box can cover, or to go on with pages to rebuild
   * that may show one Redact cannot place; absent: such a run is not verified.
   */
  confirmFlatten?: (pages: number[], info: FlattenInfo) => Promise<boolean>;
  /**
   * The source and what the check finds in it (checkHits on the source), read once before the first
   * build: what a page to rebuild draws that the find did not box is boxed before it is drawn (B1).
   */
  source?: { bytes: Uint8Array; hits(): Promise<RoundHit[]> };
  /** Where a hit's object paints on a page of `bytes` (makePlacer); absent: every hit is placed by the find. */
  place?: (bytes: Uint8Array, page: number, hit: RoundHit) => Promise<Placement>;
  /**
   * The proof (wave 2, ruling 1; proofCopies): pages whose drawing holds a chosen value, and where it
   * paints on such a page (null: it cannot be told). A copied page among them is boxed there before the
   * first build; every rebuilt page is proved when it is drawn (redactPages.ts). `mayShow`: pages whose
   * alternative text holds a chosen value where no marked content of it is found: a page to rebuild among
   * them is asked about ("may show").
   */
  proof?: { pages: ReadonlySet<number>; ink(page: number): Promise<Rect[] | null>; mayShow?: ReadonlySet<number>; unplaced?: ReadonlySet<number>; held?: ReadonlySet<number> };
  /**
   * Ruling B (wave 3): the renderer's own reading of each page that would be copied (`pageCount` pages):
   * where what it draws holds a chosen value or cannot be read (empty: nothing; null: cannot be told).
   * Such a page is boxed there and rebuilt under the proof, or the run stops.
   */
  view?: { pageCount: number; ink(page: number): Promise<{ rects: Rect[]; held: boolean } | null> };
  /**
   * Text on a page that cannot be read for certain (ruling 2: characters the reader extracts as private-use,
   * replacement or control characters, i.e. a font whose map cannot be trusted), as areas to box. Asked for
   * every page to rebuild before it is drawn.
   */
  unreadableText?: (page: number) => RedactArea[];
  /**
   * Wave 4, ruling M: pages that are not on the copy allow-list (redactCheck.ts pageDrawingsAndVerdicts, `plain:
   * false`). Each is rebuilt exactly like a page that holds a value (round 0 places on it, the proof when it is
   * drawn), never copied; one that ends with no box is a picture of the page with its own text layer.
   */
  unsafeToCopy?: ReadonlySet<number>;
  /**
   * Ruling P (wave 4): whether the find's reading of a page (what pdf.js shows) holds a chosen value. A refusal for a
   * page where it does not never tells the user to draw a box over that text: there is nothing shown to draw over.
   */
  shows?: (page: number) => boolean;
  /** The find's model of a page (for a flattened or newly boxed page's text layer). */
  model(page: number): PageTextModel | undefined;
  /** Called before each build after the first ("Checking again (round n)…"), and when checking. */
  onStage?: (stage: 'drawing' | 'building' | 'checking', round: number, done?: number, total?: number) => void;
  /** Throws when the run is stopped or its scope moved on (Run.check). */
  checkpoint(): void;
  /** Ruling D (wave 3b): asked between pages of the work that does not wait for anything; a turn for the window when one is due. */
  turn?: Pace;
}

export interface RoundOutcome {
  bytes: Uint8Array;
  report: RedactBuildReport;
  drawn: ReadonlyMap<number, DrawnPage>;
  /** Pages the check added and boxed (they held a chosen value the review did not list). */
  pagesBoxedByCheck: number[];
  /** Pages flattened on the user's confirmation. */
  pagesFlattened: number[];
  /** Pages to rebuild where text in a font that cannot be read was covered (ruling 2). */
  pagesUnreadableText: number[];
  /** Ruling R (wave 5): pages (not among those above) where only glyphs with no letter of their own were covered, one by one. */
  pagesUnreadableLetters: number[];
  /** Pages rebuilt only because they may not be copied (ruling M), whether or not the proof covered something there. */
  pagesNotCopied: number[];
  builds: number;
}

const contains = (outer: Rect, inner: Rect) => inner.x0 >= outer.x0 - 0.01 && inner.y0 >= outer.y0 - 0.01 && inner.x1 <= outer.x1 + 0.01 && inner.y1 <= outer.y1 + 0.01;
const sameRange = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

/**
 * Where an object paints is measured on one renderer's drawing; another renderer (another reader, or
 * pdf.js with another stand-in for a font the file does not embed) may draw a glyph's edge 1.5 pt
 * further (seen in the application drive: a "Q" tail). Its boxes keep twice the find's margin.
 */
export const INK_PAD_PT = 2 * BOX_PAD_PT;

/** Boxes a place gives (the file's rectangles, or where an object paints), padded as the find pads text (or by `pad`). */
const boxAreas = (page: number, rects: readonly Rect[], pad = BOX_PAD_PT): RedactArea[] =>
  rects.map((r) => ({ page, rects: [{ x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad }], kind: 'drawn' as const, hidden: false, angle: 0, ranges: [] }));

/**
 * R2's flag says it is not drawn (and nothing says otherwise): only such a hit may ever be flattened.
 * Its remedy may be 'boxes' (a comment's /Contents gives the comment's rectangle) when that rectangle is
 * no place (the whole page).
 */
const notDrawn = (hit: RoundHit) => hit.drawn === false && (hit.remedy === undefined || hit.remedy === 'flatten' || hit.remedy === 'boxes');

/** What a round does about one hit on one page. */
type Decision = { act: 'box'; areas: RedactArea[] } | { act: 'leave' } | { act: 'ask'; mayShow: boolean } | { act: 'fail'; hint: NotVerifiedHint };

/**
 * The run's build-and-check loop. `initial` holds each page to rebuild with its areas. Returns the
 * verified result, or throws notVerified / flattenDeclined (nothing added).
 *
 * Round 0 (end-to-end review B1, B2), before anything is drawn: every page to rebuild also gets the
 * places the check's wider net finds in its text (so the picture never depends on a text layer being
 * there to be checked), and what the SOURCE draws on it that the find did not box (an annotation's
 * appearance, a pattern, a form) is boxed where it paints; a drawn value there that cannot be placed
 * ends the run before any work. Then the build-and-check rounds.
 */
export async function redactInRounds(initial: ReadonlyMap<number, PageWork>, deps: RoundDeps): Promise<RoundOutcome> {
  // A place of a comment, field or link as large as the page (no text ranges, not a box the user drew)
  // is no box: the find marks such a place itself, but one that reached the review another way (a
  // promoted value's other places, a drawn box's "everywhere") has not been. It is made hidden here,
  // and what the page shows of it is placed by the source check below (or the run asks, or stops).
  const pageSized = (area: RedactArea) => {
    const view = deps.model(area.page)?.view;
    const pageArea = view ? (view[2] - view[0]) * (view[3] - view[1]) : 0;
    return area.kind !== 'drawn' && !area.hidden && area.ranges.length === 0 && pageArea > 0 && area.rects.some((r) => (r.x1 - r.x0) * (r.y1 - r.y0) > AUTO_BOX_MAX_SHARE * pageArea);
  };
  const works = new Map<number, PageWork>([...initial].map(([page, work]) => [page, { ...work, areas: work.areas.map((a) => (pageSized(a) ? { ...a, hidden: true } : a)) }]));
  const drawn = new Map<number, DrawnPage>();
  const dirty = new Set<number>(works.keys());
  const boxedByCheck = new Set<number>();
  const flattened = new Set<number>();
  let flattenUsed = false;
  const place = deps.place ?? (async (): Promise<Placement> => ({ by: 'find' }));

  // Pages where text or a drawing that could not be read was covered (the result says so in one sentence).
  const unreadableText = new Set<number>();
  /** Ruling R (wave 5): pages where the find's reading had only glyphs with no letter (K1) to cover, one by one. */
  const unreadableLetters = new Set<number>();
  /**
   * Adds areas to a page; true when something not covered before was added. why: a copied page boxed because
   * a drawing on it 'held' a chosen value (the result says the page held text the review did not list), or
   * because one could not be read ('unreadable': the result says it was covered whole, to be safe).
   */
  const addAreas = (page: number, areas: readonly RedactArea[], why: 'held' | 'unreadable' = 'held'): boolean => {
    const work = works.get(page) ?? { page, model: deps.model(page), areas: [] };
    const known = [...work.areas];
    let added = false;
    for (const area of areas) {
      const newRange = area.ranges.some((r) => !known.some((k) => k.ranges.some((q) => sameRange(q, r))));
      const newRect = area.rects.some((r) => !known.some((k) => !k.hidden && k.rects.some((q) => contains(q, r))));
      if (!newRange && !newRect) continue;
      known.push(area);
      added = true;
    }
    if (added) {
      works.set(page, { ...work, areas: known, flatten: false });
      dirty.add(page);
      if (!initial.has(page) && !flattened.has(page)) {
        if (why === 'held') boxedByCheck.add(page);
        else if (!boxedByCheck.has(page)) unreadableText.add(page);
      }
    }
    return added;
  };

  /**
   * One hit on one page. `rebuilding`: the page is being made a picture anyway (what is not drawn
   * goes with it). `firstLook`: the hit is the source's (round 0), on a page to rebuild.
   */
  const decide = async (hit: RoundHit, page: number, bytes: Uint8Array, rebuilding: boolean, firstLook: boolean): Promise<Decision> => {
    const given = (hit.boxes ?? []).filter((b) => b.page === page).map((b) => b.rect);
    // A rectangle of (almost) the whole page (a comment drawn over the page) is no place: the review
    // leaves such a box out (redactFind AUTO_BOX_MAX_SHARE), and the run does not black out a page on
    // its own either. It is placed where it paints, or the user is asked, or the run fails.
    const view = deps.model(page)?.view;
    const pageArea = view ? (view[2] - view[0]) * (view[3] - view[1]) : 0;
    const wholePage = pageArea > 0 && given.some((r) => (r.x1 - r.x0) * (r.y1 - r.y0) > AUTO_BOX_MAX_SHARE * pageArea);
    // A rectangle the file gives: always in a check round; before the first build only for what may
    // show on the page (drawn, or a comment or field, whose appearance may show what its texts say).
    const shows = !firstLook || hit.drawn === true || hit.part === 'annotation' || hit.part === 'field';
    if (given.length > 0 && !wholePage && shows) return { act: 'box', areas: boxAreas(page, given) };
    if (given.length > 0 && !wholePage) return { act: 'leave' };
    const placed = await place(bytes, page, hit);
    deps.checkpoint();
    // (A whole-page hit that is not drawn, a comment's /Contents, follows the rules below; what its
    // appearance writes is a drawn hit of its own.)
    if (!notDrawn(hit)) {
      // A drawn value is never answered with "a box anywhere on that page" (wave 2, ruling 3, R4): on a
      // copied page what no box can place stops the run with a step that can help.
      // Painting nothing there, it goes when the page is made a picture.
      if (placed.by === 'ink') return placed.rects.length > 0 ? { act: 'box', areas: boxAreas(page, placed.rects, INK_PAD_PT) } : rebuilding ? { act: 'leave' } : { act: 'fail', hint: 'elsewhere' };
      if (placed.by === 'find') {
        const located = await deps.locate(page);
        deps.checkpoint();
        if (located.length > 0) return { act: 'box', areas: located };
        // A font's name or map: a page made a picture loses it, and the find read what its text says.
        if (placed.font) return rebuilding ? { act: 'leave' } : { act: 'fail', hint: 'elsewhere' };
        // On a page being rebuilt the proof decides, drawing by drawing, when the page is drawn: what
        // holds the value is boxed where it paints, or the run stops (wave 2, ruling 1).
        if (rebuilding && deps.proof) return { act: 'leave' };
        // Text the find reads, on a copied page: a box over it rebuilds the page, where the proof decides. Where the
        // page as shown holds no chosen value (ruling P), there is nothing to draw a box over.
        return { act: 'fail', hint: deps.shows?.(page) === false ? 'elsewhere' : 'box' };
      }
      // Drawn and not placed: the run stops; no box of the user's would make it acceptable (ruling 3).
      return { act: 'fail', hint: 'elsewhere' };
    }
    if (placed.by === 'ink' && placed.rects.length > 0) return { act: 'box', areas: boxAreas(page, placed.rects, INK_PAD_PT) };
    if (placed.by === 'none' && placed.mayShow) return { act: 'ask', mayShow: true };
    return rebuilding ? { act: 'leave' } : { act: 'ask', mayShow: false };
  };

  /** Asks once about `pages` (flattened, or made pictures as they are); a "no" ends the run with nothing added. */
  const confirm = async (pages: number[], mayShow: number[]) => {
    if (!deps.confirmFlatten) throw notVerified({ pages, elsewhere: [] });
    const yes = await deps.confirmFlatten(pages, { mayShow });
    deps.checkpoint();
    if (!yes) throw flattenDeclined(pages);
  };

  const turn = async () => {
    const due = deps.turn?.();
    if (due) await due;
  };
  /** Ruling P: "draw a box over that text" only where the pages as shown hold a chosen value. */
  const hintFor = (pages: readonly number[]): NotVerifiedHint => (pages.length > 0 && deps.shows && pages.every((p) => deps.shows!(p) === false) ? 'elsewhere' : 'box');

  // ---- round 0: the pages to rebuild, before they are drawn ----
  // Ruling M (wave 4): a page off the copy allow-list is rebuilt exactly like a page that holds a value.
  const notCopied = new Set<number>();
  for (const page of deps.unsafeToCopy ?? []) {
    if (works.has(page) || page < 0 || !Number.isInteger(page)) continue;
    works.set(page, { page, model: deps.model(page), areas: [], safety: true });
    dirty.add(page);
    notCopied.add(page);
  }
  /** Pages made pictures before the first build: the user's, and those ruling M keeps from being copied. */
  const rebuilding = (page: number) => initial.has(page) || notCopied.has(page);
  for (const page of [...initial.keys(), ...notCopied]) {
    await turn();
    addAreas(page, await deps.locate(page));
    deps.checkpoint();
    const odd = deps.unreadableText?.(page) ?? [];
    if (odd.length > 0 && addAreas(page, odd, 'unreadable')) {
      // Ruling R: "covered whole" only where a run was more than glyphs with no letter of their own.
      const text = deps.model(page)?.text ?? '';
      const letters = odd.every((a) => a.ranges.length > 0 && a.ranges.every(([s, e]) => [...text.slice(s, e)].every((c) => c === NO_LETTER)));
      (letters ? unreadableLetters : unreadableText).add(page);
    }
  }
  if (deps.source) {
    deps.onStage?.('checking', 0);
    const sourceHits = await deps.source.hits();
    deps.checkpoint();
    const fatal = new Map<number, NotVerifiedHint>();
    const stop = (page: number, hint: NotVerifiedHint) => fatal.set(page, fatal.get(page) === 'elsewhere' ? 'elsewhere' : hint);
    const asked = new Map<number, boolean>();
    for (const hit of sourceHits) {
      for (const page of hit.pages) {
        if (!rebuilding(page)) continue; // a copied page: the check of the result finds it there
        await turn();
        const decision = await decide(hit, page, deps.source.bytes, true, true);
        if (decision.act === 'box') addAreas(page, decision.areas);
        else if (decision.act === 'fail') stop(page, decision.hint);
        else if (decision.act === 'ask') asked.set(page, (asked.get(page) ?? false) || decision.mayShow);
      }
    }
    // A copied page whose drawing holds a chosen value (a stamp, a form, joined pieces, marked content the
    // structure tree explains) is boxed where that drawing paints; it is then proved like every rebuilt page.
    for (const page of deps.proof?.pages ?? []) {
      if (works.has(page)) continue;
      const ink = await deps.proof!.ink(page);
      deps.checkpoint();
      if (ink === null) stop(page, 'elsewhere');
      else if (ink.length > 0) addAreas(page, boxAreas(page, ink, INK_PAD_PT), deps.proof!.held?.has(page) === false ? 'unreadable' : 'held');
    }
    // Ruling B (wave 3): a page is copied only if its renderer-view reading is complete and clean. A drawing
    // on it that holds a value or cannot be read makes it a page rebuilt under the proof (boxed where that
    // drawing paints), or the run stops; a drawing the copies could not reach stops it too.
    for (const page of deps.proof?.unplaced ?? []) if (!works.has(page)) stop(page, 'elsewhere');
    if (deps.view) {
      for (let page = 0; page < deps.view.pageCount; page++) {
        if (works.has(page) || fatal.has(page)) continue;
        const ink = await deps.view.ink(page);
        deps.checkpoint();
        if (ink === null) stop(page, 'elsewhere');
        else if (ink.rects.length > 0) addAreas(page, boxAreas(page, ink.rects, INK_PAD_PT), ink.held ? 'held' : 'unreadable');
      }
    }
    // Alternative text that says a page shows a chosen value where no marked content of it can be found
    // (RX-LIB's 'alt' drawing without spans; a structure element's MCIDs not on the page): the user is asked,
    // saying the page may show it; a copied page among them is flattened on a yes (R6, rx2-contract.md (b)).
    const flattenNow: number[] = [];
    for (const page of deps.proof?.mayShow ?? []) {
      asked.set(page, true);
      if (!works.has(page)) flattenNow.push(page);
    }
    if (fatal.size > 0) {
      const pages = [...fatal.keys()].sort((a, b) => a - b);
      throw notVerified({ pages, elsewhere: [] }, [...fatal.values()].includes('elsewhere') ? 'elsewhere' : 'box');
    }
    if (asked.size > 0) {
      const pages = [...asked.keys()].sort((a, b) => a - b);
      await confirm(pages, pages.filter((p) => asked.get(p)));
    }
    for (const page of flattenNow) {
      works.set(page, { page, model: deps.model(page), areas: [], flatten: true });
      flattened.add(page);
      dirty.add(page);
      flattenUsed = true;
    }
  }

  for (let build = 1; ; build++) {
    const pages = [...dirty].sort((a, b) => a - b);
    for (const [i, page] of pages.entries()) {
      deps.onStage?.('drawing', build, i, pages.length);
      drawn.set(page, await deps.draw(works.get(page)!));
      deps.checkpoint();
    }
    dirty.clear();
    deps.onStage?.('building', build);
    const { bytes, report } = await deps.build([...drawn.keys()].sort((a, b) => a - b).map((p) => drawn.get(p)!.rebuilt));
    deps.checkpoint();
    deps.onStage?.('checking', build);
    const rebuilt = new Set(drawn.keys());
    const { hits, structure } = await deps.check(bytes, rebuilt);
    deps.checkpoint();
    if (structure.length > 0) {
      const pagesOf = structure.map((s) => /^Page (\d+)/.exec(s)?.[1]).filter((n): n is string => n !== undefined).map((n) => Number(n) - 1);
      throw notVerified({ pages: pagesOf, elsewhere: pagesOf.length > 0 ? [] : ['other'] });
    }
    if (hits.length === 0) {
      const sorted = (pages: Iterable<number>) => [...pages].sort((a, b) => a - b);
      return { bytes, report, drawn, pagesBoxedByCheck: sorted(boxedByCheck), pagesFlattened: sorted(flattened), pagesUnreadableText: sorted(unreadableText), pagesUnreadableLetters: sorted([...unreadableLetters].filter((p) => !unreadableText.has(p))), pagesNotCopied: sorted([...notCopied].filter((p) => !flattened.has(p))), builds: build };
    }

    const fatalPages = new Set<number>();
    // Drawn where no box can place it: only unticking or printing helps (never "a box anywhere": ruling 3).
    const printPages = new Set<number>();
    const elsewhere = new Set<string>();
    const asked = new Map<number, boolean>();
    const stuck = new Set<number>();
    for (const hit of hits) {
      if (hit.pages.length === 0) {
        for (const place of hit.elsewhere.length > 0 ? hit.elsewhere : ['other']) elsewhere.add(place);
        continue;
      }
      if (hit.remedy === 'none') {
        for (const page of hit.pages) fatalPages.add(page);
        continue;
      }
      for (const page of hit.pages) {
        await turn();
        const decision = await decide(hit, page, bytes, works.has(page), false);
        // Placed. When every place was boxed already, those boxes did not remove it.
        if (decision.act === 'box' && !addAreas(page, decision.areas)) stuck.add(page);
        else if (decision.act === 'fail') (decision.hint === 'elsewhere' ? printPages : fatalPages).add(page);
        else if (decision.act === 'ask') asked.set(page, (asked.get(page) ?? false) || decision.mayShow);
      }
    }
    // A page that still holds a value after its places were boxed, and gets nothing new this round.
    for (const page of stuck) if (!dirty.has(page)) fatalPages.add(page);
    if (fatalPages.size > 0 || elsewhere.size > 0 || printPages.size > 0) {
      const pages = [...new Set([...fatalPages, ...printPages])].sort((a, b) => a - b);
      throw notVerified({ pages, elsewhere: [...elsewhere] }, fatalPages.size > 0 && printPages.size === 0 && elsewhere.size === 0 ? hintFor(pages) : 'elsewhere');
    }

    // B4: decided only now that every hit is seen. A page that got boxes this round, or is being
    // rebuilt, is never flattened (flattening would drop its boxes; its rebuild removes what is not
    // drawn); it is asked about only when it may show a value no box was placed for.
    const toFlatten: number[] = [];
    const toConfirm: number[] = [];
    for (const [page, mayShow] of asked) {
      if (!works.has(page)) toFlatten.push(page);
      else if (mayShow) toConfirm.push(page);
    }
    if (toFlatten.length + toConfirm.length > 0) {
      const list = [...toFlatten, ...toConfirm].sort((a, b) => a - b);
      if (flattenUsed) throw notVerified({ pages: list, elsewhere: [] });
      await confirm(list, list.filter((p) => asked.get(p)));
      flattenUsed = true;
      for (const page of toFlatten) {
        works.set(page, { page, model: deps.model(page), areas: [], flatten: true });
        flattened.add(page);
        boxedByCheck.delete(page);
        dirty.add(page);
      }
    }
    if (dirty.size === 0) {
      const pages = [...new Set(hits.flatMap((h) => h.pages))].sort((a, b) => a - b);
      throw notVerified({ pages, elsewhere: [] }, hintFor(pages));
    }
    if (build >= MAX_BUILDS + (flattenUsed ? 1 : 0)) throw notVerified({ pages: [...dirty].sort((a, b) => a - b), elsewhere: [] }, hintFor([...dirty]));
  }
}

// ---- what an object paints (end-to-end review B1, B5) ---------------------------------------------------------

export interface PlacerEnv {
  renderer: PixelRenderer;
  /** True when a text holds a chosen value (redactCheck.ts targetPass over the targets). */
  holds: (text: string) => boolean;
  /** Device pixels per point: the drawing's own scale, so a place is measured as the rebuilt page will show it. */
  scale: number;
  signal?: AbortSignal;
  /** J (wave 4): the comparison of the two drawings gives the window its turns. */
  pace?: Pace;
}

/** Above this share of the page, what an object paints is not taken as a box (it would black out the page): it cannot be placed. */
export const INK_MAX_SHARE = 0.6;

const N = (key: string) => PDFName.of(key);

// pdf-lib waits for a timer every 100 objects read and every 50 written by default: in a hidden window those
// timers are throttled (a second, or a minute, each), so a large file could take minutes (wave 2b). Counted in
// objects, a file of few large objects could also hold the window for seconds (Ruling D, wave 3b): loads and saves
// go through pace.ts, pdf-lib's own load and save with its waits taken by the clock (the bytes are the same; no
// form is opened here, so field appearances are left as they are, as before).
const LOAD = { updateMetadata: false } as const;
const SAVE = { useObjectStreams: false } as const;
const refKey = (ref: PDFRef) => `${ref.objectNumber} ${ref.generationNumber} R`;

function parseRef(object: string | undefined): PDFRef | null {
  const m = /^(\d+) (\d+) R$/.exec(object ?? '');
  return m ? PDFRef.of(Number(m[1]), Number(m[2])) : null;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 0x8000) out += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return out;
}

const bytesOf = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

/** The page's resources, inherited through /Parent when it has none of its own. */
function pageResources(context: PDFContext, page: PDFDict): PDFDict | undefined {
  let node: PDFObject | undefined = page;
  for (let depth = 0; node instanceof PDFDict && depth < 64; depth++) {
    const resources = context.lookup(node.get(N('Resources')));
    if (resources instanceof PDFDict) return resources;
    node = context.lookup(node.get(N('Parent')));
  }
  return undefined;
}

/** Every reference reachable from `root`, not up through /Parent. */
function reachableRefs(context: PDFContext, root: PDFObject | undefined, into: Set<string>): void {
  const stack: (PDFObject | undefined)[] = [root];
  const seen = new Set<PDFObject>();
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof PDFRef) {
      into.add(refKey(value));
      stack.push(context.lookup(value));
    } else if (value instanceof PDFDict) {
      for (const [key, v] of value.entries()) if (key !== N('Parent')) stack.push(v);
    } else if (value instanceof PDFStream) {
      stack.push(value.dict);
    } else if (value instanceof PDFArray) {
      stack.push(...value.asArray());
    }
  }
}

/**
 * What the find reads on a page besides its own content (pdf.js text content): the forms the page
 * draws, through any depth (each with the resources its content uses), and its fonts with all they
 * hold. Not what patterns, soft masks or annotation appearances draw.
 */
function readByFind(context: PDFContext, page: PDFDict): { forms: Map<string, { ref: PDFRef; resources: PDFDict | undefined }>; fonts: Set<string>; drawings: Set<string> } {
  const forms = new Map<string, { ref: PDFRef; resources: PDFDict | undefined }>();
  const fonts = new Set<string>();
  // A Type 3 font's glyph procedures and what they draw are drawings, not a font's name or map (R4):
  // they are measured where they paint.
  const drawings = new Set<string>();
  const queue: (PDFDict | undefined)[] = [pageResources(context, page)];
  const seen = new Set<PDFDict>();
  while (queue.length > 0) {
    const resources = queue.pop();
    if (!resources || seen.has(resources)) continue;
    seen.add(resources);
    const xobjects = context.lookup(resources.get(N('XObject')));
    if (xobjects instanceof PDFDict) {
      for (const [, value] of xobjects.entries()) {
        const stream = context.lookup(value);
        if (!(value instanceof PDFRef) || !(stream instanceof PDFStream) || context.lookup(stream.dict.get(N('Subtype'))) !== N('Form') || forms.has(refKey(value))) continue;
        const own = context.lookup(stream.dict.get(N('Resources')));
        const used = own instanceof PDFDict ? own : resources;
        forms.set(refKey(value), { ref: value, resources: used });
        queue.push(used);
      }
    }
    const fontDict = context.lookup(resources.get(N('Font')));
    if (fontDict instanceof PDFDict) {
      for (const [, value] of fontDict.entries()) {
        const font = context.lookup(value);
        if (font instanceof PDFDict && context.lookup(font.get(N('Subtype'))) === N('Type3')) {
          reachableRefs(context, font.get(N('CharProcs')), drawings);
          reachableRefs(context, font.get(N('Resources')), drawings);
        }
        reachableRefs(context, value, fonts);
      }
    }
  }
  for (const key of drawings) fonts.delete(key);
  return { forms, fonts, drawings };
}

/** Replaces a stream's data (written unfiltered), keeping its dictionary. False when `ref` is not a stream. */
function replaceStream(doc: PDFDocument, ref: PDFRef, contents: Uint8Array): boolean {
  const old = doc.context.lookup(ref);
  if (!(old instanceof PDFStream)) return false;
  const dict = old.dict.clone(doc.context);
  for (const key of ['Filter', 'DecodeParms', 'Length', 'DL', 'F', 'FFilter', 'FDecodeParms']) dict.delete(N(key));
  doc.context.assign(ref, PDFRawStream.of(dict, contents));
  return true;
}

/** The pixel boxes where two drawings of one page differ, joined into blocks of touching `cell`-sized squares. */
export function inkBoxes(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number, cell: number): PixelBox[] {
  return differingBlocks(a, b, width, height, cell);
}

// ---- alternative text in content streams (/ActualText, /Alt) ----

const isWhite = (c: number) => c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
const isDelimiter = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
const ESCAPES: Readonly<Record<number, number>> = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };

type Token =
  | { kind: 'string'; bytes: number[] }
  | { kind: 'name'; name: string }
  | { kind: 'dict'; entries: Map<string, Token> }
  | { kind: 'array'; strings: number[][]; items: ({ str: number[] } | { num: string })[] }
  | { kind: 'other'; raw?: string }
  | { kind: 'op'; op: string };

function skipSpace(text: string, at: number): number {
  let i = at;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (isWhite(c)) i++;
    else if (c === 0x25) while (i < text.length && text.charCodeAt(i) !== 0x0a && text.charCodeAt(i) !== 0x0d) i++;
    else break;
  }
  return i;
}

function readLiteral(text: string, start: number): { bytes: number[]; end: number } {
  const bytes: number[] = [];
  let depth = 1;
  let i = start + 1;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 0x5c) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0x30 && next <= 0x37) {
        let value = 0;
        let j = i + 1;
        for (; j < i + 4 && j < text.length; j++) {
          const d = text.charCodeAt(j);
          if (d < 0x30 || d > 0x37) break;
          value = value * 8 + (d - 0x30);
        }
        bytes.push(value & 0xff);
        i = j;
      } else if (next === 0x0d) i += text.charCodeAt(i + 2) === 0x0a ? 3 : 2;
      else if (next === 0x0a) i += 2;
      else if (Number.isNaN(next)) i += 1;
      else {
        bytes.push(ESCAPES[next] ?? next);
        i += 2;
      }
      continue;
    }
    if (c === 0x28) depth++;
    else if (c === 0x29 && --depth === 0) return { bytes, end: i + 1 };
    bytes.push(c & 0xff);
    i++;
  }
  return { bytes, end: text.length };
}

function readHex(text: string, start: number): { bytes: number[]; end: number } {
  const bytes: number[] = [];
  let high = -1;
  let i = start + 1;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x3e) return { bytes: high >= 0 ? [...bytes, high * 16] : bytes, end: i + 1 };
    const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1;
    if (v < 0) continue;
    if (high < 0) high = v;
    else {
      bytes.push(high * 16 + v);
      high = -1;
    }
  }
  return { bytes, end: i };
}

/** One object or operator of content syntax at `at` (whose first character is not white space). */
function readToken(text: string, at: number, depth: number): { token: Token; end: number } {
  const c = text.charCodeAt(at);
  if (c === 0x28) {
    const s = readLiteral(text, at);
    return { token: { kind: 'string', bytes: s.bytes }, end: s.end };
  }
  if (c === 0x3c && text.charCodeAt(at + 1) === 0x3c) {
    const entries = new Map<string, Token>();
    let i = at + 2;
    let key: string | null = null;
    for (;;) {
      i = skipSpace(text, i);
      if (i >= text.length) break;
      if (text.charCodeAt(i) === 0x3e && text.charCodeAt(i + 1) === 0x3e) {
        i += 2;
        break;
      }
      const { token, end } = depth < 32 ? readToken(text, i, depth + 1) : { token: { kind: 'other' } as Token, end: i + 1 };
      i = Math.max(end, i + 1);
      if (key === null) key = token.kind === 'name' ? token.name : null;
      else {
        entries.set(key, token);
        key = null;
      }
    }
    return { token: { kind: 'dict', entries }, end: i };
  }
  if (c === 0x3c) {
    const s = readHex(text, at);
    return { token: { kind: 'string', bytes: s.bytes }, end: s.end };
  }
  if (c === 0x5b) {
    // An array keeps its strings (a TJ's pieces), in order, and its strings and numbers as items.
    const strings: number[][] = [];
    const items: ({ str: number[] } | { num: string })[] = [];
    let i = at + 1;
    for (;;) {
      i = skipSpace(text, i);
      if (i >= text.length) break;
      if (text.charCodeAt(i) === 0x5d) {
        i += 1;
        break;
      }
      const read = depth < 32 ? readToken(text, i, depth + 1) : { token: { kind: 'other' } as Token, end: i + 1 };
      if (read.token.kind === 'string') {
        strings.push(read.token.bytes);
        items.push({ str: read.token.bytes });
      } else if (read.token.kind === 'other' && read.token.raw !== undefined) items.push({ num: read.token.raw });
      i = Math.max(read.end, i + 1);
    }
    return { token: { kind: 'array', strings, items }, end: i };
  }
  if (c === 0x2f) {
    let j = at + 1;
    while (j < text.length && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
    const raw = text.slice(at + 1, j);
    return { token: { kind: 'name', name: raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) }, end: j };
  }
  if (isDelimiter(c)) return { token: { kind: 'other' }, end: at + 1 };
  let j = at + 1;
  while (j < text.length && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
  const word = text.slice(at, j);
  return { token: /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) || word === 'true' || word === 'false' || word === 'null' ? { kind: 'other', raw: word } : { kind: 'op', op: word }, end: j };
}

/** A string of a PDF file as text: UTF-16 (with its mark, either way round), UTF-8 with its mark, else one byte a character. */
function textOfBytes(bytes: readonly number[]): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return s;
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(Uint8Array.from(bytes.slice(3)));
  return String.fromCharCode(...bytes);
}

/** The keys of a marked-content property list that say what its content shows. */
const ALT_KEYS = ['ActualText', 'Alt'] as const;

/**
 * The marked-content sequences of a content stream whose property list (written in it, or named and
 * looked up by `named`) holds alternative text that `holds` finds a chosen value in: each as
 * [start, end) of `text`, from the first operand of its BDC to the end of its EMC, the outermost only.
 * A sequence whose marked-content id (written in, or in the named list: `namedMcid`) is in `mcids` (a
 * structure element's alternative text holds the value: CheckHit.marked) is taken too.
 * `open` counts such sequences that do not end in this stream.
 */
export function altTextSpans(
  text: string,
  holds: (text: string) => boolean,
  named: (name: string) => string[] = () => [],
  mcids: ReadonlySet<number> = new Set(),
  namedMcid: (name: string) => number | undefined = () => undefined,
): { spans: [number, number][]; open: number } {
  const spans: [number, number][] = [];
  const stack: { start: number; match: boolean }[] = [];
  const operands: Token[] = [];
  let operandStart = -1;
  let i = 0;
  for (;;) {
    i = skipSpace(text, i);
    if (i >= text.length) break;
    const start = i;
    const { token, end } = readToken(text, i, 0);
    i = Math.max(end, i + 1);
    if (token.kind !== 'op') {
      if (operandStart < 0) operandStart = start;
      operands.push(token);
      continue;
    }
    const from = operandStart >= 0 ? operandStart : start;
    if (token.op === 'ID') {
      // Inline image data: binary, up to an EI that stands on its own.
      let k = text.indexOf('EI', i);
      while (k >= 0 && !(isWhite(text.charCodeAt(k - 1)) && (k + 2 >= text.length || isWhite(text.charCodeAt(k + 2)) || isDelimiter(text.charCodeAt(k + 2))))) k = text.indexOf('EI', k + 1);
      i = k < 0 ? text.length : k + 2;
    } else if (token.op === 'BMC') stack.push({ start: from, match: false });
    else if (token.op === 'BDC') {
      const props = operands[operands.length - 1];
      const texts = props?.kind === 'dict' ? ALT_KEYS.map((k) => props.entries.get(k)).flatMap((t) => (t?.kind === 'string' ? [textOfBytes(t.bytes)] : [])) : props?.kind === 'name' ? named(props.name) : [];
      const written = props?.kind === 'dict' ? props.entries.get('MCID') : undefined;
      const mcid = written?.kind === 'other' && written.raw !== undefined ? Number(written.raw) : props?.kind === 'name' ? namedMcid(props.name) : undefined;
      stack.push({ start: from, match: texts.some(holds) || (mcid !== undefined && mcids.has(mcid)) });
    } else if (token.op === 'EMC') {
      const top = stack.pop();
      if (top?.match) spans.push([top.start, i]);
    }
    operands.length = 0;
    operandStart = -1;
  }
  // Marked content nests: a sequence lies inside another or apart from it.
  const outer: [number, number][] = [];
  for (const s of spans.sort((a, b) => a[0] - b[0] || b[1] - a[1])) if (!outer.some((o) => o[0] <= s[0] && s[1] <= o[1])) outer.push(s);
  return { spans: outer, open: stack.filter((s) => s.match).length };
}

/** The alternative texts of a named property list (/Properties of `resources`). */
function namedAltTexts(context: PDFContext, resources: PDFDict | undefined, name: string): string[] {
  const properties = context.lookup(resources?.get(N('Properties')));
  const list = properties instanceof PDFDict ? context.lookup(properties.get(N(name))) : undefined;
  if (!(list instanceof PDFDict)) return [];
  return ALT_KEYS.map((k) => context.lookup(list.get(N(k)))).flatMap((v) => (v instanceof PDFString || v instanceof PDFHexString ? [v.decodeText()] : []));
}

/** The marked-content id of a named property list (/Properties of `resources`), if it has one. */
function namedMcidOf(context: PDFContext, resources: PDFDict | undefined, name: string): number | undefined {
  const properties = context.lookup(resources?.get(N('Properties')));
  const list = properties instanceof PDFDict ? context.lookup(properties.get(N(name))) : undefined;
  const mcid = list instanceof PDFDict ? Number(String(context.lookup(list.get(N('MCID'))))) : NaN;
  return Number.isInteger(mcid) ? mcid : undefined;
}

// ---- proving the picture (wave 2, lead rulings 1 and 2) ----

/** A string's bytes read as text the ways a file may mean them: one byte a character, UTF-16 either way round, UTF-8. */
function readingsOf(bytes: readonly number[]): string[] {
  let latin = '';
  for (const b of bytes) latin += String.fromCharCode(b);
  const out = [latin];
  if (bytes.length >= 2 && bytes.length % 2 === 0) {
    let be = '';
    let le = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      be += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      le += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    }
    out.push(be, le);
  }
  if (bytes.some((b) => b >= 0x80)) {
    try {
      out.push(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)));
    } catch {
      // not UTF-8
    }
  }
  return out;
}

const hexOf = (bytes: readonly number[]) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;

/** How a content stream is rewritten for the proof: its text for the drawing copy (`base`) and for the copy without what holds a value (`cut`). */
export interface ProofEdit {
  base: string;
  cut: string;
  /** Something holding a chosen value is drawn by this stream (a string, joined strings, marked content), by this reading (not `forced`). */
  changed: boolean;
}

/**
 * What RX-LIB's per-drawing reading (redactCheck.ts pageDrawings) says must go from the cut copy of a stream:
 * the string operands a drawing shows (`strings`, offsets of the string tokens) and marked-content sequences
 * (`spans`, from the BDC operator to the end of the EMC). Offsets in the decoded stream read as Latin-1.
 */
export interface ProofForce {
  strings: readonly [number, number][];
  spans: readonly [number, number][];
}

const NO_FORCE: ProofForce = { strings: [], spans: [] };

/**
 * The proof's rewriting of one content stream (page content, form, pattern, appearance, Type 3 glyph):
 * - each show operation (Tj, ', ", TJ) whose string reads as holding a chosen value (`holds`, in any of
 *   its readings) is made invisible in `cut` (render mode 3 around it, the mode before restored); in page
 *   content (`partial`) with a one-byte reading and the value's places known (`spans`), only those
 *   characters: the string is split in both copies at the same places, so nothing else moves (a stamp's,
 *   form's or pattern's string goes whole: it is not ordinary page text);
 * - consecutive show operations whose readings JOINED (with nothing or a space between, across lines and
 *   text objects, up to 16) hold a value are made invisible whole (a name wrapped over two lines);
 * - marked content whose property list (written in, or named: `named`) has /ActualText or /Alt holding
 *   a value, or whose /MCID is in `mcids` (the structure tree said so), is cut out of `cut`;
 * - what `forced` names (RX-LIB's reading of a drawing that holds a value or cannot be read): each show
 *   whose operands hold one of its strings is made invisible whole; each of its marked-content sequences is
 *   cut out (one this tokenizer does not end at the same place: the shows inside it are made invisible).
 * `base` differs from the stream only by those splits; the pictures are drawn from it.
 */
export function proofEdit(
  text: string,
  holds: (text: string) => boolean,
  spans: (text: string) => [number, number][],
  mcids: ReadonlySet<number> = new Set(),
  named: (name: string) => { texts: string[]; mcid?: number } = () => ({ texts: [] }),
  partial = true,
  forced: ProofForce = NO_FORCE,
): ProofEdit {
  return runAtOnce(proofEditWork(text, holds, spans, mcids, named, partial, forced));
}

/**
 * `proofEdit` with a turn for the window between shows when one is due (Ruling J, wave 4: one page's stream of a
 * printed report read in one go held the window 1 to 2 s of processor time). The same edit.
 */
export function proofEditPaced(
  text: string,
  holds: (text: string) => boolean,
  spans: (text: string) => [number, number][],
  mcids: ReadonlySet<number>,
  named: (name: string) => { texts: string[]; mcid?: number },
  partial: boolean,
  forced: ProofForce,
  pace: Pace,
): Promise<ProofEdit> {
  return runPaced(proofEditWork(text, holds, spans, mcids, named, partial, forced), pace);
}

function* proofEditWork(
  text: string,
  holds: (text: string) => boolean,
  spans: (text: string) => [number, number][],
  mcids: ReadonlySet<number>,
  named: (name: string) => { texts: string[]; mcid?: number },
  partial: boolean,
  forced: ProofForce,
): Work<ProofEdit> {
  const forcedEnds = new Set(forced.spans.map(([, end]) => end));
  const endsMet = new Set<number>();
  let forcedRemovals = 0;
  interface Show {
    start: number;
    end: number;
    op: string;
    strings: number[][];
    nums: string[];
    tr: string;
    /** TJ: the array's strings and numbers, in order. */
    items?: ({ str: number[] } | { num: string })[];
  }
  type Read = { token: Token; start: number; end: number };
  const shows: Show[] = [];
  const removals: [number, number][] = [];
  const marked: { start: number; match: boolean }[] = [];
  const trStack: string[] = [];
  let tr = '0';
  let operands: Read[] = [];
  let i = 0;
  for (;;) {
    i = skipSpace(text, i);
    if (i >= text.length) break;
    const start = i;
    const { token, end } = readToken(text, i, 0);
    i = Math.max(end, i + 1);
    if (token.kind !== 'op') {
      operands.push({ token, start, end: i });
      continue;
    }
    const from = operands.length > 0 ? operands[0].start : start;
    const op = token.op;
    const last = operands[operands.length - 1]?.token;
    if (op === 'ID') {
      let k = text.indexOf('EI', i);
      while (k >= 0 && !(isWhite(text.charCodeAt(k - 1)) && (k + 2 >= text.length || isWhite(text.charCodeAt(k + 2)) || isDelimiter(text.charCodeAt(k + 2))))) k = text.indexOf('EI', k + 1);
      i = k < 0 ? text.length : k + 2;
    } else if (op === 'q') trStack.push(tr);
    else if (op === 'Q') tr = trStack.pop() ?? tr;
    else if (op === 'Tr' && last?.kind === 'other' && last.raw !== undefined) tr = last.raw;
    else if (op === 'BMC') marked.push({ start: from, match: false });
    else if (op === 'BDC') {
      let texts: string[] = [];
      let mcid: number | undefined;
      if (last?.kind === 'dict') {
        texts = ALT_KEYS.map((k) => last.entries.get(k)).flatMap((t) => (t?.kind === 'string' ? [textOfBytes(t.bytes)] : []));
        const m = last.entries.get('MCID');
        if (m?.kind === 'other' && m.raw !== undefined) mcid = Number(m.raw);
      } else if (last?.kind === 'name') ({ texts, mcid } = named(last.name));
      marked.push({ start: from, match: texts.some(holds) || (mcid !== undefined && mcids.has(mcid)) });
    } else if (op === 'EMC') {
      const top = marked.pop();
      if (top && forcedEnds.has(i)) endsMet.add(i);
      if (top?.match) removals.push([top.start, i]);
      else if (top && forcedEnds.has(i)) {
        removals.push([top.start, i]);
        forcedRemovals++;
      }
    } else if ((op === 'Tj' || op === "'") && last?.kind === 'string') shows.push({ start: from, end: i, op, strings: [last.bytes], nums: [], tr });
    else if (op === '"' && last?.kind === 'string' && operands.length >= 3) {
      shows.push({ start: from, end: i, op, strings: [last.bytes], nums: operands.slice(-3, -1).map((o) => text.slice(o.start, o.end)), tr });
    } else if (op === 'TJ' && last?.kind === 'array') shows.push({ start: from, end: i, op, strings: last.strings, nums: [], tr, items: last.items });
    operands = [];
  }

  // What each show reads as, and which characters of it to cut (or all of it).
  const latin = shows.map((s) => readingsOf(s.strings.flat())[0]);
  const whole = new Set<number>();
  const parts: [number, number][][] = shows.map(() => []);
  for (let k = 0; k < shows.length; k++) {
    // A turn when due before each show (J, wave 4: many chosen values make each show's test long).
    yield;
    if (!readingsOf(shows[k].strings.flat()).some(holds)) continue;
    const sp = partial && holds(latin[k]) ? spans(latin[k]).filter(([a, b]) => b > a) : [];
    if (sp.length > 0) parts[k].push(...sp);
    else whole.add(k);
  }
  // A run of shows k..j holds a value when a place of it in their joined reading begins in show k and
  // ends in show j (it runs across them): in page content each show loses that place's characters, else
  // the shows go whole. Where the places cannot be told, the shortest run at the right end that holds it
  // goes whole, not counting a show that holds it by itself (it is dealt with on its own).
  const across = (joined: string, starts: number[]): [number, number][] | null => {
    const places = spans(joined).filter(([a, b]) => b > a);
    if (places.length === 0) return null;
    return places.filter(([a, b]) => a < starts[1] && b > starts[starts.length - 1]);
  };
  const runHolds = (f: number, j: number) => {
    const run = latin.slice(f, j + 1);
    return holds(run.join('')) || holds(run.join(' '));
  };
  const takeAcross = (k: number, starts: number[], places: [number, number][]) => {
    for (let m = k; m < k + starts.length; m++) {
      if (!partial) {
        whole.add(m);
        continue;
      }
      const from = starts[m - k];
      const to = from + latin[m].length;
      for (const [a, b] of places) if (a < to && b > from) parts[m].push([Math.max(a, from) - from, Math.min(b, to) - from]);
    }
  };
  for (let k = 0; k < shows.length; k++) {
    yield;
    let joinedTight = latin[k];
    let joinedSpaced = latin[k];
    const tightStarts = [0];
    const spacedStarts = [0];
    // Wave 3 (ruling C): a word broken at a line end by a hyphen or soft hyphen ("Ku-" + "mar") is read
    // rejoined; each character remembers its show and place, so only the value's characters are cut.
    let rejoined = latin[k];
    let owners: [number, number][] = Array.from(latin[k], (_, o): [number, number] => [k, o]);
    let rejoinedAny = false;
    for (let j = k + 1; j < Math.min(shows.length, k + 16); j++) {
      // And before each longer join (J, wave 4).
      yield;
      tightStarts.push(joinedTight.length);
      spacedStarts.push(joinedSpaced.length + 1);
      joinedTight += latin[j];
      joinedSpaced += ` ${latin[j]}`;
      const hyphen = /[-\u00ad][ \t]*$/.exec(rejoined);
      const lead = /^[ \t]*/.exec(latin[j])![0].length;
      if (hyphen && /\p{L}/u.test(latin[j].charAt(lead)) && /\p{L}/u.test(rejoined.charAt(hyphen.index - 1))) {
        rejoined = rejoined.slice(0, hyphen.index);
        owners = owners.slice(0, hyphen.index);
        rejoinedAny = true;
      } else {
        rejoined += ' ';
        owners.push([-1, -1]);
      }
      rejoined += latin[j].slice(lead);
      for (let o = lead; o < latin[j].length; o++) owners.push([j, o]);
      if (rejoinedAny && holds(rejoined)) {
        for (const [a, b] of spans(rejoined).filter(([a, b]) => b > a)) {
          if (owners[a]?.[0] !== k || owners[b - 1]?.[0] !== j) continue;
          for (let c = a; c < b; c++) {
            const [m, o] = owners[c];
            if (m < 0) continue;
            if (partial) parts[m].push([o, o + 1]);
            else whole.add(m);
          }
        }
      }
      const tight = holds(joinedTight) ? across(joinedTight, tightStarts) : [];
      const spaced = holds(joinedSpaced) ? across(joinedSpaced, spacedStarts) : [];
      if ((tight?.length ?? 0) > 0 || (spaced?.length ?? 0) > 0) {
        takeAcross(k, tightStarts, tight ?? []);
        takeAcross(k, spacedStarts, spaced ?? []);
        continue;
      }
      if (tight !== null && spaced !== null) continue;
      // Places unknown: the old reading, for a start show that does not hold the value itself.
      if (whole.has(k) || parts[k].length > 0) break;
      let from = -1;
      for (let f = j; f > k; f--) {
        if (runHolds(f, j)) {
          from = f;
          break;
        }
      }
      const held = (m: number) => whole.has(m) || parts[m].length > 0;
      if (from === -1) for (let m = k; m <= j; m++) whole.add(m);
      else if (from < j || !held(j)) for (let m = from; m <= j; m++) whole.add(m);
      break;
    }
  }
  const found = whole.size > 0 || parts.some((p) => p.length > 0) || removals.length > forcedRemovals;

  // What RX-LIB's reading names: its strings' shows whole; the shows inside a sequence not ended here.
  const loose = forced.spans.filter(([, end]) => !endsMet.has(end));
  shows.forEach((s, k) => {
    if (forced.strings.some(([a, b]) => a < s.end && b > s.start) || loose.some(([a, b]) => a <= s.start && s.end <= b)) whole.add(k);
  });
  const mark: (null | 'whole' | [number, number][])[] = shows.map((_, k) => (whole.has(k) ? 'whole' : parts[k].length > 0 ? parts[k] : null));

  // The edits, in order; a cut-out marked content sequence takes the shows inside it.
  type Edit = { start: number; end: number; base: string; cut: string };
  const outer: [number, number][] = [];
  for (const r of removals.sort((a, b) => a[0] - b[0] || b[1] - a[1])) if (!outer.some((o) => o[0] <= r[0] && r[1] <= o[1])) outer.push(r);
  const edits: Edit[] = outer.map(([s, e]) => ({ start: s, end: e, base: text.slice(s, e), cut: ' ' }));
  shows.forEach((s, k) => {
    const m = mark[k];
    if (m === null || outer.some(([a, b]) => a <= s.start && s.end <= b)) return;
    const original = text.slice(s.start, s.end);
    if (m === 'whole' || (s.op === 'TJ' && !s.items)) {
      edits.push({ start: s.start, end: s.end, base: original, cut: ` 3 Tr ${original} ${s.tr} Tr ` });
      return;
    }
    const bytes = s.strings.flat();
    const merged: [number, number][] = [];
    for (const [a, b] of [...m].sort((x, y) => x[0] - y[0])) {
      const top = merged[merged.length - 1];
      if (top && a <= top[1]) top[1] = Math.max(top[1], b);
      else merged.push([Math.max(0, a), Math.min(bytes.length, b)]);
    }
    const hidden = (at: number) => merged.some(([a, b]) => a <= at && at < b);
    if (s.op === 'TJ') {
      // The array is split into consecutive TJ operations at the cut's edges (the same positions: a TJ
      // only moves the text position), each piece as hidden or shown; numbers stay where they were.
      const runs: { hide: boolean; parts: string[] }[] = [];
      const put = (hide: boolean, part: string) => {
        const top = runs[runs.length - 1];
        if (top && top.hide === hide) top.parts.push(part);
        else runs.push({ hide, parts: [part] });
      };
      let at = 0;
      for (const item of s.items ?? []) {
        if ('num' in item) {
          put(runs[runs.length - 1]?.hide ?? false, item.num);
          continue;
        }
        let from = 0;
        for (let x = 1; x <= item.str.length; x++) {
          if (x < item.str.length && hidden(at + x) === hidden(at + from)) continue;
          put(hidden(at + from), hexOf(item.str.slice(from, x)));
          from = x;
        }
        at += item.str.length;
      }
      edits.push({
        start: s.start,
        end: s.end,
        base: ` ${runs.map((r) => `[${r.parts.join(' ')}] TJ`).join(' ')} `,
        cut: ` ${runs.map((r) => (r.hide ? `3 Tr [${r.parts.join(' ')}] TJ ${s.tr} Tr` : `[${r.parts.join(' ')}] TJ`)).join(' ')} `,
      });
      return;
    }
    const pieces: { bytes: number[]; hide: boolean }[] = [];
    let at = 0;
    for (const [a, b] of merged) {
      if (a > at) pieces.push({ bytes: bytes.slice(at, a), hide: false });
      if (b > a) pieces.push({ bytes: bytes.slice(a, b), hide: true });
      at = b;
    }
    if (at < bytes.length) pieces.push({ bytes: bytes.slice(at), hide: false });
    const lead = s.op === "'" ? 'T* ' : s.op === '"' ? `${s.nums[0]} Tw ${s.nums[1]} Tc T* ` : '';
    edits.push({
      start: s.start,
      end: s.end,
      base: ` ${lead}${pieces.map((p) => `${hexOf(p.bytes)} Tj`).join(' ')} `,
      cut: ` ${lead}${pieces.map((p) => (p.hide ? `3 Tr ${hexOf(p.bytes)} Tj ${s.tr} Tr` : `${hexOf(p.bytes)} Tj`)).join(' ')} `,
    });
  });
  if (edits.length === 0) return { base: text, cut: text, changed: false };
  edits.sort((a, b) => a.start - b.start);
  let base = '';
  let cut = '';
  let pos = 0;
  for (const e of edits) {
    if (e.start < pos) continue; // never overlapping by construction; skipped if it were
    base += text.slice(pos, e.start) + e.base;
    cut += text.slice(pos, e.start) + e.cut;
    pos = e.end;
  }
  return { base: base + text.slice(pos), cut: cut + text.slice(pos), changed: found };
}

/** The proof's two copies of a file (`proofCopies`). */
export interface ProofCopies {
  /** pdf-lib's copy with the matching strings split out (still drawn): the rebuilt pages are drawn from it. */
  base: Uint8Array;
  /** The same copy with what holds a value made invisible or cut out, and every painting stream that could not be read emptied. */
  cut: Uint8Array;
  /** Pages where something holding a chosen value is drawn (a string, joined strings, marked content). */
  valuePages: ReadonlySet<number>;
  /** Pages where a stream that could not be read paints (covered whole on a page that is rebuilt). */
  unreadablePages: ReadonlySet<number>;
  /**
   * Those of `unreadablePages` where the reading gave up (Ruling B, finding 8): a stream pdf-lib cannot decode
   * or parse, one the strings check reads a value in that this reading did not find, or a drawing for which
   * RX-LIB's `readerGaveUp` is true. Not a page whose only such drawing is text in a real font with no usable
   * map (symbol-font bullets): such a page is copied, unless it holds a value.
   */
  gaveUpPages: ReadonlySet<number>;
  /** Pages whose alternative text holds a chosen value where no marked content of it is found (asked about: "may show"). */
  mayShowPages: ReadonlySet<number>;
  /** Pages with a drawing to cover whose stream cannot be found in pdf-lib's copy: a page among them is not rebuilt. */
  unplacedPages: ReadonlySet<number>;
}

/**
 * A drawing of RX-LIB's reader (redactCheck.ts pageDrawings), whether its text holds a chosen value
 * (drawingPass), and whether the reader gave up on it (readerGaveUp; absent: counted as given up).
 */
export type ProofDrawing = Pick<PageDrawing, 'page' | 'kind' | 'source' | 'unreadable'> & { holds: boolean; gaveUp?: boolean };

/**
 * Builds the proof's copies (lead rulings 1 and 2): every stream that paints (page contents, forms,
 * patterns, annotation appearances, Type 3 glyph procedures) is rewritten by `proofEdit`; marked content
 * the structure tree says reads as a value (/ActualText, /Alt, /E on an element; its /Pg and MCIDs) is
 * cut; a painting stream pdf-lib cannot decode, an object it cannot parse, or a stream the strings check
 * found a drawn value in (`mustCut`, 'n g R') that the rewriting did not find, is emptied in `cut`
 * ("cannot read" = covered whole). Throws when pdf-lib cannot read the file.
 *
 * `drawings` (RX-LIB's per-drawing reading, rx2-contract.md (b)), each one that holds a value or cannot be
 * read: text in a font whose map cannot be trusted goes by its strings; any other drawing that cannot be
 * read is emptied; a readable drawing that holds a value and that this reading did not find (in it or in
 * what it draws) is emptied; alternative text goes by its marked content, or its page is asked about. So
 * on a page that is rebuilt each such drawing is boxed where that instance paints, or the run stops.
 */
export async function proofCopies(
  bytes: Uint8Array,
  opts: {
    holds: (text: string) => boolean;
    spans: (text: string) => [number, number][];
    mustCut?: ReadonlySet<string>;
    drawings?: readonly ProofDrawing[];
    pace?: Pace;
    /** K1: how many glyphs with no letter of their own (U+0000) the find's reading of a page holds. */
    noLetter?: (page: number) => number;
  },
): Promise<ProofCopies> {
  // Ruling D (wave 3b): the window gets its turns between streams and between pages (reading every stream of a
  // 100-page file held it 2.7 s of processor time in one stretch, a 500-page one several times that).
  const turn = async () => {
    const due = opts.pace?.();
    if (due) await due;
  };
  const baseDoc = await loadPaced(bytes, LOAD);
  const cutDoc = await loadPaced(bytes, LOAD);
  const context = baseDoc.context;
  const pages = baseDoc.getPages().map((p) => p.node);
  const pageKey = new Map<string, number>(baseDoc.getPages().map((p, i) => [refKey(p.ref), i]));

  // The painting streams, each with the resources its named property lists come from, and its page (page content only).
  const painting = new Map<string, { ref: PDFRef; resources: PDFDict | undefined; page?: number }>();
  const addStream = (value: PDFObject | undefined, resources: PDFDict | undefined, page?: number) => {
    if (!(value instanceof PDFRef) || painting.has(refKey(value)) || !(context.lookup(value) instanceof PDFStream)) return;
    painting.set(refKey(value), { ref: value, resources, page });
  };
  pages.forEach((node, index) => {
    const resources = pageResources(context, node);
    const contents = context.lookup(node.get(N('Contents')));
    for (const v of contents instanceof PDFArray ? contents.asArray() : [node.get(N('Contents'))]) addStream(v, resources, index);
    const annots = context.lookup(node.get(N('Annots')));
    for (const a of annots instanceof PDFArray ? annots.asArray() : []) {
      const annot = context.lookup(a);
      const ap = annot instanceof PDFDict ? context.lookup(annot.get(N('AP'))) : undefined;
      if (!(ap instanceof PDFDict)) continue;
      for (const [, look] of ap.entries()) {
        const entry = context.lookup(look);
        if (entry instanceof PDFStream) addStream(look, undefined);
        else if (entry instanceof PDFDict) for (const [, state] of entry.entries()) addStream(state, undefined);
      }
    }
  });
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFStream) {
      const subtype = context.lookup(object.dict.get(N('Subtype')));
      const patternType = context.lookup(object.dict.get(N('PatternType')));
      if (subtype === N('Form') || (patternType !== undefined && String(patternType) === '1')) addStream(ref, undefined);
    } else if (object instanceof PDFDict && context.lookup(object.get(N('Subtype'))) === N('Type3')) {
      const procs = context.lookup(object.get(N('CharProcs')));
      if (procs instanceof PDFDict) for (const [, proc] of procs.entries()) addStream(proc, undefined);
    }
  }

  // Marked content the structure tree says reads as a chosen value: page index -> MCIDs.
  const structMcids = new Map<number, Set<number>>();
  const addMcid = (index: number | undefined, n: number) => {
    if (index === undefined || !Number.isInteger(n)) return;
    const set = structMcids.get(index) ?? new Set<number>();
    set.add(n);
    structMcids.set(index, set);
  };
  const root = context.lookup(baseDoc.catalog.get(N('StructTreeRoot')));
  if (root instanceof PDFDict) {
    const seen = new Set<PDFObject>();
    const visit = (node: PDFObject | undefined, pg: PDFObject | undefined, taken: boolean, depth: number) => {
      const value = context.lookup(node);
      if (value === undefined || depth > 64 || seen.has(value)) return;
      if (value instanceof PDFArray) {
        for (const kid of value.asArray()) visit(kid, pg, taken, depth + 1);
        return;
      }
      if (!(value instanceof PDFDict)) {
        // An integer kid: a marked-content id on the element's page.
        if (taken && pg instanceof PDFRef) addMcid(pageKey.get(refKey(pg)), Number(String(value)));
        return;
      }
      seen.add(value);
      const ownPg = value.get(N('Pg')) ?? pg;
      const says = ['ActualText', 'Alt', 'E'].map((k) => context.lookup(value.get(N(k)))).some((v) => (v instanceof PDFString || v instanceof PDFHexString) && opts.holds(v.decodeText()));
      if (context.lookup(value.get(N('Type'))) === N('MCR') || value.has(N('MCID'))) {
        if (taken && ownPg instanceof PDFRef) addMcid(pageKey.get(refKey(ownPg)), Number(String(context.lookup(value.get(N('MCID'))))));
        return;
      }
      visit(value.get(N('K')), ownPg, taken || says, depth + 1);
    };
    visit(root.get(N('K')), undefined, false, 0);
  }

  const changed = new Set<string>();
  const unreadable = new Set<string>();
  // An object pdf-lib could not parse is written back as it was, and the renderer may still draw it (a
  // stamp whose dictionary holds a malformed number): it is unreadable, so it goes from the cut copy and
  // whatever it paints on a page to rebuild is covered whole (ruling 2).
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFInvalidObject)) continue;
    cutDoc.context.assign(ref, cutDoc.context.flateStream(''));
    unreadable.add(refKey(ref));
  }

  // RX-LIB's drawings that hold a value or cannot be read (rx2-contract.md (b)), stream by stream.
  const force = new Map<string, { strings: [number, number][]; spans: [number, number][] }>();
  const forceOf = (key: string) => {
    let f = force.get(key);
    if (!f) force.set(key, (f = { strings: [], spans: [] }));
    return f;
  };
  const emptied = new Set<string>();
  const holding = new Set<string>();
  const drawnValue = new Set<number>();
  const drawnUnreadable = new Set<number>();
  const drawnGaveUp = new Set<number>();
  const mayShowPages = new Set<number>();
  const unplacedPages = new Set<number>();
  // K1 (wave 4): page text in a composite font that is unreadable only for glyphs with no letter of their own
  // (U+0000) is left to the find's reading, which has those glyphs too and covers each one that could be part of a
  // chosen value (unreadableTextAreas), and to the renderer's; it is not covered whole. Only as many such glyphs
  // as the find's reading of the page holds (`noLetter`): else the whole drawing goes, as before.
  const released = new Set<ProofDrawing>();
  if (opts.noLetter) {
    const streams = new Map<string, string | null>();
    const decoded = (key: string) => {
      if (!streams.has(key)) {
        const ref = parseRef(key);
        const stream = ref ? context.lookup(ref) : undefined;
        let text: string | null = null;
        try {
          if (stream instanceof PDFRawStream) text = latin1(stream.dict.has(N('Filter')) ? decodePDFRawStream(stream).decode() : stream.contents);
        } catch {
          text = null;
        }
        streams.set(key, text);
      }
      return streams.get(key) ?? null;
    };
    const left = new Map<number, number>();
    for (const d of opts.drawings ?? []) {
      if (d.holds) continue;
      const glyphs = noLetterGlyphs(context, d, decoded);
      if (glyphs === null) continue;
      const allowance = left.get(d.page) ?? opts.noLetter(d.page);
      if (glyphs > allowance) continue;
      left.set(d.page, allowance - glyphs);
      released.add(d);
    }
  }
  for (const d of opts.drawings ?? []) {
    if (!d.holds && d.unreadable === undefined) continue;
    if (released.has(d)) continue;
    const key = d.source.stream;
    if (d.kind === 'alt') {
      const spans = d.source.spans ?? [];
      if (!d.holds) continue;
      if (spans.length === 0 || !painting.has(key)) mayShowPages.add(d.page);
      else {
        forceOf(key).spans.push(...spans.map((s): [number, number] => [s.start, s.end]));
        drawnValue.add(d.page);
      }
      continue;
    }
    // Every stream is an indirect object (ISO 32000-1 7.3.8.1); one not found here cannot be covered.
    if (!painting.has(key) && !unreadable.has(key)) {
      unplacedPages.add(d.page);
      continue;
    }
    (d.unreadable !== undefined ? drawnUnreadable : drawnValue).add(d.page);
    if (d.unreadable !== undefined && d.gaveUp !== false) drawnGaveUp.add(d.page);
    if (d.kind === 'content' && d.source.strings.length > 0) forceOf(key).strings.push(...d.source.strings.map((s): [number, number] => [s.start, s.end]));
    else if (d.unreadable !== undefined || d.kind === 'content') emptied.add(key);
    else holding.add(key);
  }

  for (const [key, { ref, resources, page }] of painting) {
    await turn();
    const stream = context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    let text: string;
    try {
      text = latin1(stream.dict.has(N('Filter')) ? decodePDFRawStream(stream).decode() : stream.contents);
    } catch {
      // Not readable here although the renderer may draw it (an abbreviated filter, /Crypt): covered whole.
      replaceStream(cutDoc, ref, new Uint8Array(0));
      unreadable.add(key);
      continue;
    }
    const own = context.lookup(stream.dict.get(N('Resources')));
    const used = resources ?? (own instanceof PDFDict ? own : undefined);
    const named = (name: string) => {
      const props = context.lookup(used ? used.get(N('Properties')) : undefined);
      const list = props instanceof PDFDict ? context.lookup(props.get(N(name))) : undefined;
      if (!(list instanceof PDFDict)) return { texts: [] };
      const texts = ALT_KEYS.map((k) => context.lookup(list.get(N(k)))).flatMap((v) => (v instanceof PDFString || v instanceof PDFHexString ? [v.decodeText()] : []));
      const mcid = Number(String(context.lookup(list.get(N('MCID')))));
      return Number.isInteger(mcid) ? { texts, mcid } : { texts };
    };
    const mcidsOf = (page !== undefined ? structMcids.get(page) : undefined) ?? new Set<number>();
    const edit = opts.pace
      ? await proofEditPaced(text, opts.holds, opts.spans, mcidsOf, named, page !== undefined, force.get(key) ?? NO_FORCE, opts.pace)
      : proofEdit(text, opts.holds, opts.spans, mcidsOf, named, page !== undefined, force.get(key) ?? NO_FORCE);
    if (edit.base !== text) replaceStream(baseDoc, ref, bytesOf(edit.base));
    if (emptied.has(key)) replaceStream(cutDoc, ref, new Uint8Array(0));
    else if (edit.cut !== text) replaceStream(cutDoc, ref, bytesOf(edit.cut));
    if (edit.changed) changed.add(key);
    else if (opts.mustCut?.has(key) && !emptied.has(key)) {
      // The strings check reads a value drawn here that this reading did not find: covered whole.
      replaceStream(cutDoc, ref, new Uint8Array(0));
      unreadable.add(key);
    }
  }
  // A readable drawing that holds a value: when this reading found it in that very stream, its edit covers
  // it; otherwise (the value is in what it draws, joined across streams, or the readings differ) it is
  // covered whole, as is everything it draws (a covered place never vouches for it: ruling 1).
  for (const key of holding) {
    const entry = painting.get(key);
    if (entry && !changed.has(key)) replaceStream(cutDoc, entry.ref, new Uint8Array(0));
  }

  // Which pages each changed stream paints on: everything a page reaches, its annotations included.
  const valuePages = new Set<number>(drawnValue);
  const unreadablePages = new Set<number>(drawnUnreadable);
  const gaveUpPages = new Set<number>(drawnGaveUp);
  if (changed.size + unreadable.size > 0) {
    for (const [index, node] of pages.entries()) {
      await turn();
      const reached = new Set<string>();
      reachableRefs(context, node, reached);
      if ([...changed].some((k) => reached.has(k))) valuePages.add(index);
      if ([...unreadable].some((k) => reached.has(k))) {
        unreadablePages.add(index);
        gaveUpPages.add(index);
      }
    }
  }
  const write = (doc: PDFDocument) => savePaced(doc, SAVE);
  return { base: await write(baseDoc), cut: await write(cutDoc), valuePages, unreadablePages, gaveUpPages, mayShowPages, unplacedPages };
}

/**
 * Where hits stand on a page (Placement), for the rounds (`RoundDeps.place`):
 * - a drawn hit in the page's content, or in a form the page draws or a font (the find reads those):
 *   'find';
 * - a drawn hit in any other stream (a pattern, a soft mask, a picture's data): where that stream
 *   paints, from the page drawn with the stream emptied, against the page drawn as it is;
 * - a hit that is not drawn: where the marked content paints whose alternative text (/ActualText,
 *   /Alt, in the page's content or its forms) holds a chosen value, from the page drawn without those
 *   sequences; none found: 'none'; found but not measurable: 'none' with `mayShow`.
 * Both drawings are made from pdf-lib's own copy of the file, so the only difference is the change.
 * What covers more than INK_MAX_SHARE of the page is not taken as a box.
 */
export function makePlacer(env: PlacerEnv): (bytes: Uint8Array, page: number, hit: RoundHit) => Promise<Placement> {
  const loaded = new WeakMap<Uint8Array, Promise<PDFDocument | null>>();
  const baselines = new WeakMap<Uint8Array, Promise<Uint8Array | null>>();
  const alts = new WeakMap<Uint8Array, Map<string, Promise<Placement>>>();
  const write = (doc: PDFDocument) => savePaced(doc, SAVE);
  const load = (bytes: Uint8Array) => {
    let doc = loaded.get(bytes);
    if (!doc) loaded.set(bytes, (doc = loadPaced(bytes, LOAD).catch(() => null)));
    return doc;
  };
  const baseline = (bytes: Uint8Array) => {
    let base = baselines.get(bytes);
    if (!base) baselines.set(bytes, (base = load(bytes).then((doc) => (doc ? write(doc) : null)).catch(() => null)));
    return base;
  };
  const stop = () => {
    if (env.signal?.aborted) throw env.signal.reason instanceof Error ? env.signal.reason : new DOMException('Stopped.', 'AbortError');
  };

  /** Where the page drawn after `change` differs from it drawn as it is; null when that cannot be told or covers too much. */
  async function inkOf(bytes: Uint8Array, page: number, change: (doc: PDFDocument) => boolean): Promise<Rect[] | null> {
    try {
      const base = await baseline(bytes);
      if (!base) return null;
      const doc = await loadPaced(bytes, LOAD);
      if (!change(doc)) return null;
      const changed = await write(doc);
      stop();
      const before = await env.renderer.renderPagePixels(base, page, env.scale, { signal: env.signal });
      const after = await env.renderer.renderPagePixels(changed, page, env.scale, { signal: env.signal });
      stop();
      if (before.width !== after.width || before.height !== after.height || before.data.length !== after.data.length) return null;
      const cell = Math.max(4, Math.round(6 * env.scale));
      const boxes = env.pace ? await differingBlocksPaced(before.data, after.data, before.width, before.height, cell, undefined, env.pace) : inkBoxes(before.data, after.data, before.width, before.height, cell);
      const area = boxes.reduce((sum, b) => sum + (b.right - b.left) * (b.bottom - b.top), 0);
      if (area > INK_MAX_SHARE * before.width * before.height) return null;
      const m = drawingTransform(before);
      return boxes.map((box) => toUserRect(m, box));
    } catch (error) {
      stop();
      // A drawing that failed or went silent ends the run with its own sentence (wave 2b), not "cannot be placed".
      if (error instanceof PdfToolsError) throw error;
      return null;
    }
  }

  const pageNode = (doc: PDFDocument | null, page: number): PDFDict | undefined => {
    try {
      return doc?.getPages()[page]?.node;
    } catch {
      return undefined;
    }
  };

  /** `mcids`: the marked-content ids a structure element's alternative text covers on this page (CheckHit.marked). */
  async function altPlacement(bytes: Uint8Array, page: number, mcids: ReadonlySet<number>): Promise<Placement> {
    const doc = await load(bytes);
    const node = pageNode(doc, page);
    // The structure tree says the page shows it: where it paints cannot be told, so the page may show it.
    if (!doc || !node) return mcids.size > 0 ? { by: 'none', mayShow: true } : { by: 'none' };
    const context = doc.context;
    const contents = context.lookup(node.get(N('Contents')));
    const contentRefs = (contents instanceof PDFArray ? contents.asArray() : [node.get(N('Contents'))]).filter((v): v is PDFRef => v instanceof PDFRef);
    const resources = pageResources(context, node);
    const streams = [...contentRefs.map((ref) => ({ ref, resources, content: true })), ...[...readByFind(context, node).forms.values()].map((f) => ({ ...f, content: false }))];
    const cuts: { ref: PDFRef; text: string; spans: [number, number][] }[] = [];
    let open = 0;
    for (const { ref, resources: used, content } of streams) {
      const stream = context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      let text: string;
      try {
        text = latin1(stream.dict.has(N('Filter')) ? decodePDFRawStream(stream).decode() : stream.contents);
      } catch {
        continue;
      }
      // Marked-content ids belong to the page's own content.
      const found = altTextSpans(text, env.holds, (name) => namedAltTexts(context, used, name), content ? mcids : new Set(), (name) => namedMcidOf(context, used, name));
      open += found.open;
      if (found.spans.length > 0) cuts.push({ ref, text, spans: found.spans });
    }
    // A structure element's alternative text whose marked content is not found: ask, saying it may show (R6).
    if (cuts.length === 0 && open === 0) return mcids.size > 0 ? { by: 'none', mayShow: true } : { by: 'none' };
    if (open > 0) return { by: 'none', mayShow: true };
    const rects = await inkOf(bytes, page, (copy) =>
      cuts.every(({ ref, text, spans }) => {
        let kept = '';
        let from = 0;
        for (const [s, e] of spans) {
          kept += `${text.slice(from, s)} `;
          from = e;
        }
        return replaceStream(copy, ref, bytesOf(kept + text.slice(from)));
      }),
    );
    return rects ? { by: 'ink', rects } : { by: 'none', mayShow: true };
  }

  return async (bytes, page, hit) => {
    stop();
    if (notDrawn(hit)) {
      const mcids = new Set((hit.marked ?? []).filter((m) => m.page === page).flatMap((m) => m.mcids));
      const key = `${page}:${[...mcids].sort((a, b) => a - b).join(',')}`;
      let byPage = alts.get(bytes);
      if (!byPage) alts.set(bytes, (byPage = new Map()));
      let placement = byPage.get(key);
      if (!placement) byPage.set(key, (placement = altPlacement(bytes, page, mcids)));
      return placement;
    }
    if (hit.part === undefined || hit.part === 'content' || hit.part === 'text layer') return { by: 'find' };
    const doc = await load(bytes);
    const ref = parseRef(hit.object);
    const node = ref ? pageNode(doc, page) : undefined;
    if (!doc || !ref || !node) return { by: 'none' };
    const reads = readByFind(doc.context, node);
    if (!reads.drawings.has(refKey(ref)) && reads.fonts.has(refKey(ref))) return { by: 'find', font: true };
    if (!reads.drawings.has(refKey(ref)) && reads.forms.has(refKey(ref))) return { by: 'find' };
    if (!(doc.context.lookup(ref) instanceof PDFStream)) return { by: 'none' };
    const rects = await inkOf(bytes, page, (copy) => replaceStream(copy, ref, new Uint8Array(0)));
    return rects ? { by: 'ink', rects } : { by: 'none' };
  };
}

/**
 * Where the proof's cut copy differs from its drawing copy on one page (what holds a chosen value there):
 * the pixel blocks as user-space rectangles; empty when nothing differs; null when it cannot be told or
 * covers more than INK_MAX_SHARE of the page.
 */
export async function proofInk(renderer: PixelRenderer, copies: { base: Uint8Array; cut: Uint8Array }, page: number, scale: number, signal?: AbortSignal, pace?: Pace): Promise<Rect[] | null> {
  try {
    const before = await renderer.renderPagePixels(copies.base, page, scale, { signal });
    const after = await renderer.renderPagePixels(copies.cut, page, scale, { signal });
    if (before.width !== after.width || before.height !== after.height || before.data.length !== after.data.length) return null;
    // J (wave 4): the comparison of two whole-page drawings gives the window its turns.
    const cell = Math.max(4, Math.round(6 * scale));
    const boxes = pace ? await differingBlocksPaced(before.data, after.data, before.width, before.height, cell, undefined, pace) : inkBoxes(before.data, after.data, before.width, before.height, cell);
    const area = boxes.reduce((sum, b) => sum + (b.right - b.left) * (b.bottom - b.top), 0);
    if (area > INK_MAX_SHARE * before.width * before.height) return null;
    const m = drawingTransform(before);
    return boxes.map((box) => toUserRect(m, box));
  } catch (error) {
    // Stopped, gone silent (wave 2b), or a drawing that failed: the run ends with its own sentence.
    if (signal?.aborted || error instanceof PdfToolsError) throw error;
    return null;
  }
}
