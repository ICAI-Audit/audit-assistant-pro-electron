// Redact's checks on a written result (design 5.9 "The check", points 1 and 3).
//
// The strings check reads the file two ways and looks for each redacted value in its forms:
// - object by object, as pdf-lib parses it: every string and name (escapes, hex, UTF-16 either way
//   round with or without its mark, UTF-8, PDFDocEncoding, `#xx` in names), every stream decoded
//   through its filters (predictors applied), and inside streams every string decoded and the
//   pieces of each [...] array (a TJ) joined. A find is located to every page its object can be
//   reached from without going up through /Parent (a widget's field ancestors excepted), else to a
//   named place of the document ('document properties', 'bookmarks', 'form', 'other');
// - byte by byte, independent of any parser: the whole file with every stream body inflated where
//   it can be, which also covers earlier saved revisions, cross-reference streams and anything
//   between objects. A find there that the object reading did not explain counts as 'other'.
// Only the rebuilt pages' own pictures (/Im0 on the pages given) are never searched; every other
// stream is. An image's data holds pixels or entropy-coded data, not text: it is searched for each
// value's exact bytes only, and as text only where it holds text by design (a JPEG's APPn and COM
// segments and what follows its end, a JPEG 2000 file's boxes other than its code stream; fix wave 3,
// Ruling D). Large data is read in slices with a pause between them.
//
// How a form is compared depends on its kind (lead ruling 1, 14 November 2026), in two passes (lead
// ruling 2). The strict pass is the find's own rule (redactFind.ts, every occurrence): codes (PAN,
// GSTIN, TAN, IFSC, EVC) with one space, hyphen or line break allowed between characters, numbers
// (Aadhaar, mobile, account, MICR, acknowledgement) with up to two, the tax document number with up
// to three punctuation marks, all ignoring case; an email as written ignoring case; an IP address as
// written with no digit or dot joined to it; names, addresses, typed terms and the same text as whole
// words ignoring case, white space collapsed. The loose pass is a second net, after Unicode
// compatibility folding: codes and numbers with any punctuation between their characters (compact
// form), an email with white space removed, an IP address with white space around its dots (its dots
// are never removed: `10.0.0.1` must not match `10001`), words after folding. A hit in either pass is
// a leftover of the value: the run rebuilds what holds it or discards the result. The targets are
// taken as given: nothing is derived from what lies under a drawn box (lead ruling 3).
//
// `checkHits` says where each hit is, in a form a rebuild round can act on: the pages its object
// belongs to (and, on a rebuilt page's text layer, the boxes of the words that hold it), else the
// document place, the object's number and the key it sits under. Nothing here puts a value or a form
// into a message or a returned text. No Node or DOM API: this runs in the renderer and in tests alike.
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFontEmbedder,
  StandardFonts,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';
import { textBlocks, type LinePiece, type Rect } from './pageText';
import { ADDED_KIND_NAMES, foldText, keyOf, placesOfValue, type RedactKind } from './redactPatterns';
import { PdfToolsError } from './types';

/** One redacted value, by its forms (redactPatterns.ts `checkForms`, reviewState.ts `checkTargets`). Never logged. */
export interface CheckTarget {
  kind: RedactKind;
  forms: readonly string[];
  /** For names, addresses, typed terms and the same text: whole words (else a phrase anywhere). Other kinds are compared by their kind. */
  wholeWord: boolean;
}

/** Where a value was found: zero-based page indices, and named places in words. */
export interface CheckFinding {
  pages: number[];
  elsewhere: string[];
}

/** 'strict': written as the find would find it; 'loose': with other punctuation or folded characters between. Both are leftovers. */
export type CheckPass = 'strict' | 'loose';

/** What holds a hit, in fixed words. */
export type HitPart = 'page' | 'content' | 'text layer' | 'annotation' | 'field' | 'resources' | 'bookmark' | 'properties' | 'object' | 'bytes';

/** One object (or the trailer, or the raw bytes) that holds a target. Holds no text of the file. */
export interface CheckHit {
  pass: CheckPass;
  /** Zero-based pages the object belongs to; empty when it belongs to none. */
  pages: number[];
  /** When it belongs to no page: 'document properties', 'bookmarks', 'form' or 'other'. */
  elsewhere: string[];
  part: HitPart;
  /** 'n g R' of the object; 'trailer'; 'bytes' for what only the byte reading found. */
  object: string;
  /** The key the hit sits under, from a fixed list of PDF keys ('Title', 'Contents', 'V', 'URI'...); 'stream' for stream data; 'other'. */
  key: string;
  /**
   * Painted on the page: a string a content, form or appearance stream shows, a painted annotation
   * text (FreeText, a field's value), a font's own text, or a rebuilt page's text layer. A drawn hit can
   * only be removed by a rebuild with boxes over it (fix round 1, ruling E).
   */
  drawn: boolean;
  /** What a rebuild round can do about it: see `checkHits`. */
  remedy: HitRemedy;
  /** When `remedy` is 'none': why no rebuild removes it. */
  refusal?: HitRefusal;
  /**
   * Where on its pages the hit can be boxed, when the file says so (user space of that page, before
   * /Rotate, unpadded): on a rebuilt page's text layer, the words that hold it; for a comment, field,
   * link or other annotation, its own rectangle (for a field, those of its widgets). Absent for page
   * content, resources and everything else: those positions must come from the find (see `checkHits`).
   */
  boxes?: { page: number; rect: Rect }[];
  /**
   * For a structure element's /ActualText, /Alt or /E (fix wave 2, R6): the marked content it speaks for,
   * by page (0-based) and MCIDs; `pages` are those pages. The page may show the value in glyphs no reader
   * can read: box where that marked content paints, or ask.
   */
  marked?: { page: number; mcids: number[] }[];
}

const ELSEWHERE_ORDER = ['document properties', 'bookmarks', 'form', 'other'] as const;
type Elsewhere = (typeof ELSEWHERE_ORDER)[number];

// ---- text forms ----------------------------------------------------------------------------------

/** Kinds compared as words (drawn boxes and marks have no forms; if given some, they are words too). */
const WORD_KINDS: ReadonlySet<string> = new Set(['name', 'address', 'addressee', 'typed', 'same-text', 'drawn', 'marked']);
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** An IP address has no digit joined to it, nor a dot that leads to one (as redactPatterns.ts). */
const IP_BEFORE = '(?<!\\d|\\d\\.)';
const IP_AFTER = '(?!\\d|\\.\\d)';
/** Unicode format characters, by category (soft hyphen, zero-width and direction marks, byte-order mark and the rest). */
const FORMAT_CHARS = /\p{Cf}/gu;
const NUL = String.fromCharCode(0);
const PERCENT = /%[0-9A-Fa-f]{2}/;

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return true;
  return false;
}

/**
 * Compatibility decomposition (NFKD) with format characters removed, on the whole text at once: fast,
 * for the loose pass and the prefilters. The strict pass is R1's rule (`placesOfValue`), which folds
 * each character by NFKC on its own; decomposing keeps every letter and digit that fold keeps (a letter
 * followed by a combining mark stays that letter, where NFKC on the whole text would compose the two
 * into one character the compact view drops), so every strict match passes the prefilters.
 */
function folded(text: string): string {
  return hasNonAscii(text) ? text.normalize('NFKD').replace(FORMAT_CHARS, '') : text;
}
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The views of one text the rules compare with, each made when first needed. */
class Views {
  private readonly made = new Map<string, string>();
  constructor(readonly raw: string) {}
  private view(which: string, make: () => string): string {
    let value = this.made.get(which);
    if (value === undefined) {
      value = make();
      this.made.set(which, value);
    }
    return value;
  }
  get folded(): string {
    return this.view('folded', () => folded(this.raw));
  }
  get compact(): string {
    return this.view('compact', () => this.folded.toUpperCase().replace(/[^A-Z0-9]+/g, ''));
  }
  get foldedNoSpace(): string {
    return this.view('nospace', () => this.folded.toLowerCase().replace(/\s+/g, ''));
  }
  /** What the loose rule reads (looseFold's text, made at once: fix wave 3, Ruling D): accents and format characters dropped. */
  get loose(): string {
    return this.view('loose', () => looseFoldText(this.raw));
  }
  /** The loose text's letters and digits alone, in lower case: the words' cheap test. */
  get looseLetters(): string {
    return this.view('looseLetters', () => keepOnly(this.loose.toLowerCase(), LETTER_OR_DIGIT));
  }
}

// ---- the one loose rule (fix wave 2, ruling 4) ---------------------------------------------------

/** A place in a text: [start, end) in UTF-16 units of the text given. */
export interface LoosePlace {
  start: number;
  end: number;
}

const COMBINING = /\p{M}/u;

/**
 * The text the loose rule reads: format characters removed and each character decomposed (NFKD) with its
 * combining marks dropped (accents ignored), with a map back to the text given (none for ASCII: offsets
 * are the same).
 */
function looseFold(text: string): { text: string; starts?: number[]; ends?: number[] } {
  if (!hasNonAscii(text)) return { text };
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; ) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      out.push(text[i]);
      starts.push(i);
      ends.push(i + 1);
      i += 1;
      continue;
    }
    const cp = text.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    // A format character or a mark is dropped (a mark's own decomposition is a mark); any other character
    // gives its decomposition without marks, found once per character (fix wave 3, Ruling D: speed only).
    const folded = cp < 0x10000 && unitClass(cp) === MARK_OR_FORMAT ? '' : decompositionOf(cp, ch);
    for (let k = 0; k < folded.length; k++) {
      out.push(folded[k]);
      starts.push(i);
      ends.push(i + ch.length);
    }
    i += ch.length;
  }
  return { text: out.join(''), starts, ends };
}

/** A character's decomposition (NFKD) without its marks, '' for a format character: what looseFold puts for it. */
const DECOMPOSED = new Map<number, string>();
function decompositionOf(cp: number, ch: string): string {
  let folded = DECOMPOSED.get(cp);
  if (folded === undefined) {
    folded = /\p{Cf}/u.test(ch) ? '' : Array.from(ch.normalize('NFKD')).filter((part) => !COMBINING.test(part)).join('');
    DECOMPOSED.set(cp, folded);
  }
  return folded;
}

/** Character classes, by UTF-16 unit, found once each (fix wave 3, Ruling D: a property escape run over a font program read as text held the thread for seconds). */
const LETTER_OR_DIGIT = 1;
const MARK_OR_FORMAT = 2;
const UNIT_CLASS = new Uint8Array(0x10000);
const UNIT_KNOWN = new Uint8Array(0x10000);
const ASTRAL_CLASS = new Map<number, number>();
const classify = (ch: string) => (/^[\p{L}\p{N}]$/u.test(ch) ? LETTER_OR_DIGIT : /^[\p{M}\p{Cf}]$/u.test(ch) ? MARK_OR_FORMAT : 0);
/** The class of a UTF-16 unit that is not a surrogate, found once. */
function unitClass(unit: number): number {
  if (!UNIT_KNOWN[unit]) {
    UNIT_CLASS[unit] = classify(String.fromCharCode(unit));
    UNIT_KNOWN[unit] = 1;
  }
  return UNIT_CLASS[unit];
}

/**
 * `text` with only the characters of class `wanted` (`keepIt`), or without them: one pass over its units,
 * whole runs sliced (a surrogate pair is one character, classed once by its code point).
 */
function filterClass(text: string, wanted: number, keepIt: boolean): string {
  const parts: string[] = [];
  let runStart = 0;
  let dropped = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const unit = text.charCodeAt(i);
    let cls: number;
    let length = 1;
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < n && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      const cp = (unit - 0xd800) * 0x400 + (text.charCodeAt(i + 1) - 0xdc00) + 0x10000;
      let found = ASTRAL_CLASS.get(cp);
      if (found === undefined) ASTRAL_CLASS.set(cp, (found = classify(String.fromCodePoint(cp))));
      cls = found;
      length = 2;
    } else cls = unitClass(unit);
    if ((cls === wanted) !== keepIt) {
      if (i > runStart) parts.push(text.slice(runStart, i));
      runStart = i + length;
      dropped = true;
    }
    i += length - 1;
  }
  if (!dropped) return text;
  if (runStart < n) parts.push(text.slice(runStart));
  return parts.join('');
}
const keepOnly = (text: string, cls: number) => filterClass(text, cls, true);

/**
 * looseFold's text without its map, decomposed in one native call (fix wave 3, Ruling D: the
 * character-by-character fold of a font program read as text held the thread for seconds). The same text:
 * decomposing a whole text decomposes each character and only reorders combining marks, which are dropped.
 */
function looseFoldText(text: string): string {
  return hasNonAscii(text) ? filterClass(text.normalize('NFKD'), MARK_OR_FORMAT, false) : text;
}

const NOT_WORD_CHAR = '[^\\p{L}\\p{N}]';

/**
 * The loose rule of one form, as a regular expression over looseFold's text (global, case ignored), or
 * null when the form has nothing to compare (rx2-contract.md (a)):
 * - words (names, addresses, typed terms, the same text): the form's runs of letters and digits; two or
 *   more in order with any run of non-letters/non-digits between, or none; one code word (letters and
 *   digits) or number with any such run between its characters; one plain word as it is; no letter or
 *   digit joined at either end when `whole`;
 * - email: the key with any white space between its characters;
 * - IP address: the dotted key with white space around its dots, no digit or digit-led dot joined;
 * - codes and numbers: the key's characters with any run of non-ASCII-letters/digits between, inside
 *   longer runs too, except a short number of a kind added in T-048 (no digit joined at either end).
 */
function looseRegExp(kind: RedactKind, form: string, whole = true): RegExp | null {
  if (kind === 'drawn' || kind === 'marked') return null;
  if (WORD_KINDS.has(kind)) {
    const words = looseFold(foldText(form)).text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length === 0) return null;
    const join = (parts: readonly string[]) => parts.map(escapeRe).join(`${NOT_WORD_CHAR}*`);
    const [only] = words;
    const number = words.length === 1 && /^\p{N}+$/u.test(only);
    const code = words.length === 1 && /\p{L}/u.test(only) && /\p{N}/u.test(only);
    const body = words.length > 1 ? join(words) : number || code ? join(Array.from(only)) : join([only]);
    // A number may stand next to letters (INV12345); anything else is a whole word.
    const joined = number ? '\\p{N}' : '[\\p{L}\\p{N}]';
    return new RegExp(whole ? `(?<!${joined})${body}(?!${joined})` : body, 'giu');
  }
  const key = keyOf(kind, form);
  if (key === '') return null;
  if (kind === 'email') return new RegExp(Array.from(key, escapeRe).join('\\s*'), 'gi');
  if (kind === 'ip') return DOTTED_QUAD.test(key) ? new RegExp(`${IP_BEFORE}${key.split('.').join('\\s*\\.\\s*')}${IP_AFTER}`, 'g') : null;
  if (!/^[A-Za-z0-9]+$/.test(key)) return null;
  const body = key.split('').join('[^A-Za-z0-9]*');
  return new RegExp(shortAddedNumber(kind, key) ? `(?<!\\d)${body}(?!\\d)` : body, 'gi');
}

/**
 * THE loose rule (fix wave 2, ruling 4; rx2-contract.md (a)): every place `form` (a value of `kind`, or a
 * typed word) stands in `text` by the loose rule, in `text`'s offsets, in order. Every place of the find's
 * own rule (redactPatterns.ts placesOfValue) is among them. Used by the check's loose pass (targetPass,
 * on copied and rebuilt pages, file names and addresses), by the find for words (redactFind.ts) and by the
 * run's net (redactRounds.ts loosePlaces): one rule, one implementation.
 */
export function loosePlacesOf(text: string, kind: RedactKind, form: string): LoosePlace[] {
  if (typeof text !== 'string' || text === '') return [];
  const found = new Map<string, LoosePlace>();
  const add = (start: number, end: number) => {
    if (end > start) found.set(`${start}:${end}`, { start, end });
  };
  const key = keyOf(kind, form);
  if (key !== '') for (const p of placesOfValue(text, kind, key)) add(p.start, p.end);
  const re = looseRegExp(kind, form);
  if (re) {
    const f = looseFold(text);
    for (const m of f.text.matchAll(re)) {
      if (m[0].length === 0) continue;
      const s = m.index;
      const e = m.index + m[0].length;
      if (f.starts && f.ends) add(f.starts[s], f.ends[e - 1]);
      else add(s, e);
    }
  }
  return [...found.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** One form's comparison: 'strict' when the find's own rule matches, 'loose' when only the second net does. */
type Rule = (v: Views) => CheckPass | null;

/**
 * One form, compared by its kind (lead ruling 1). The strict pass is R1's shared rule, the find's own
 * (`placesOfValue` with `keyOf`, redactPatterns.ts): codes and numbers with up to three separators,
 * email with white space around `.` `@` `-`, an IP address bounded by digits and digit-leading dots,
 * words as the find's whole words. The loose pass is THE loose rule (loosePlacesOf; fix wave 2, ruling
 * 4): codes and numbers with any punctuation between characters (a short number of a kind added in T-048
 * with no digit joined to it); email without white space; an IP address with white space around its dots
 * (never without its dots); a phrase's words across any run of non-letters/non-digits, or none (this
 * replaces fix round 1's "white space and hyphens only"). The strict test runs only where a cheap test
 * shows it can match: every strict match passes it.
 */
function ruleOf(kind: RedactKind, form: string, whole: boolean): Rule | null {
  const key = keyOf(kind, form);
  if (key === '') return null;
  const strict = (v: Views) => placesOfValue(v.raw, kind, key).length > 0;
  // The loose pass is THE loose rule (looseRegExp, as loosePlacesOf; fix wave 2, ruling 4), tested only
  // where a cheap view shows it can match (every loose and strict match passes the cheap test).
  const global = looseRegExp(kind, form, whole);
  const looseRe = global ? new RegExp(global.source, global.flags.replace('g', '')) : null;
  const loose = (v: Views) => looseRe !== null && looseRe.test(v.loose);
  if (WORD_KINDS.has(kind)) {
    const letters = looseFold(foldText(form)).text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (letters === '') return null;
    return (v) => (!v.looseLetters.includes(letters) ? null : strict(v) ? 'strict' : loose(v) ? 'loose' : null);
  }
  if (kind === 'email') {
    const spaced = folded(key).toLowerCase().replace(/\s+/g, '');
    return (v) => (!v.foldedNoSpace.includes(spaced) ? null : strict(v) ? 'strict' : loose(v) ? 'loose' : null);
  }
  if (kind === 'ip') {
    if (!DOTTED_QUAD.test(key)) return null; // a key without its dots is never compared (lead ruling 1)
    return (v) => (!loose(v) ? null : strict(v) ? 'strict' : 'loose');
  }
  if (!/^[A-Za-z0-9]+$/.test(key)) return null;
  const compact = key.toUpperCase();
  // A short number of a kind added in T-048 (8 digits or fewer: PIN code, cheque, membership number,
  // director's DIN) has no digit joined to it in both passes (fix wave round 2, RX-PAT); the looseRegExp
  // carries that boundary.
  return (v) => (!v.compact.includes(compact) ? null : strict(v) ? 'strict' : loose(v) ? 'loose' : null);
}

/** A kind added in T-048 (redactPatterns.ts ADDED_KIND_NAMES) whose key is 8 digits or fewer: placesOfValue's short-number rule. */
const shortAddedNumber = (kind: RedactKind, key: string) => Object.prototype.hasOwnProperty.call(ADDED_KIND_NAMES, kind) && /^\d{1,8}$/.test(key);

interface Compiled {
  rules: Rule[];
  /** Some form has characters outside ASCII, so streams are also read as UTF-16. */
  unicode: boolean;
  /** Each value's exact bytes, as a byte scanner looks for them in data that holds no text (fix wave 3, Ruling D). */
  needles: Uint8Array[];
}

/**
 * The exact bytes of every form and its key (as written, upper and lower case), in Latin-1 (when every
 * character is one), UTF-8 (when one is not ASCII) and UTF-16 both ways: what a byte scanner finds of a
 * value planted in an image's data. Four characters or more (a shorter run of bytes turns up by chance).
 */
function needlesOf(targets: readonly CheckTarget[]): Uint8Array[] {
  const texts = new Set<string>();
  for (const target of targets) {
    for (const raw of target.forms) {
      if (typeof raw !== 'string') continue;
      const form = raw.trim();
      if (form === '') continue;
      for (const text of [form, keyOf(target.kind, form)]) for (const t of [text, text.toUpperCase(), text.toLowerCase()]) if (t.length >= 4) texts.add(t);
    }
  }
  const found = new Map<string, Uint8Array>();
  const add = (bytes: Uint8Array) => found.set(bytes.join(','), bytes);
  for (const text of texts) {
    const units = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
    if (units.every((u) => u < 0x100)) add(Uint8Array.from(units));
    if (hasNonAscii(text)) add(new TextEncoder().encode(text));
    add(Uint8Array.from(units.flatMap((u) => [u >> 8, u & 0xff])));
    add(Uint8Array.from(units.flatMap((u) => [u & 0xff, u >> 8])));
  }
  return [...found.values()];
}

function compile(targets: readonly CheckTarget[]): Compiled {
  const rules: Rule[] = [];
  const seen = new Set<string>();
  let unicode = false;
  for (const target of targets) {
    for (const raw of target.forms) {
      if (typeof raw !== 'string') continue;
      const form = raw.trim();
      if (form === '') continue;
      if (hasNonAscii(form)) unicode = true;
      const id = `${target.kind}:${target.wholeWord ? 1 : 0}:${form}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const rule = ruleOf(target.kind, form, target.wholeWord);
      if (rule) rules.push(rule);
    }
  }
  return { rules, unicode, needles: needlesOf(targets) };
}

/** The stronger of two passes. */
const stronger = (a: CheckPass | null, b: CheckPass | null): CheckPass | null => (a === 'strict' || b === 'strict' ? 'strict' : a ?? b);

function passOf(rules: readonly Rule[], text: string): CheckPass | null {
  if (!text) return null;
  const views = new Views(text);
  let found: CheckPass | null = null;
  for (const rule of rules) {
    const pass = rule(views);
    if (pass === 'strict') return 'strict';
    found = found ?? pass;
  }
  return found;
}

/** A text of byte values read as UTF-8 (a percent-decoded or base64 text holds bytes). */
const bytesAsUtf8 = (text: string) => new TextDecoder('utf-8').decode(Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff));

/**
 * XML or HTML markup in a text (rich text /RC, XFA, XMP): a character reference, an entity, a closing
 * tag or an XML declaration. Not a PDF dictionary in a content stream (`<</MCID 0>>`, `<</ActualText
 * (...)>>`, which every tagged page has) nor a hex string (`<FEFF...>`): a closing tag here has nothing
 * after its name.
 */
const MARKUP = /&#(?:[0-9]+|[xX][0-9A-Fa-f]+);?|&(?:amp|lt|gt|quot|apos|nbsp);|<\/[A-Za-z][\w:.-]*\s*>|<\?xml/;
const TAG = /<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?\/?>|<\?[^>]*>|<!--[\s\S]*?-->|<!\[CDATA\[|\]\]>/g;
const REFERENCE = /&#(?:([0-9]+)|[xX]([0-9A-Fa-f]+));?|&(amp|lt|gt|quot|apos|nbsp);/g;
const NAMED_REFERENCE: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Character references (decimal and hex) and the XML entities written as the characters they stand for. */
function decodeReferences(text: string): string {
  return text.replace(REFERENCE, (whole, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (named !== undefined) return NAMED_REFERENCE[named] ?? whole;
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * A text with markup read as the text it marks up (fix wave, redact-e2e-review B8): tags removed (a value
 * split across two spans is one), and once more with each tag read as a space (words in two paragraphs
 * stay apart); character references decoded in both. None when the text holds no markup.
 */
function markupReadings(text: string): string[] {
  if (!MARKUP.test(text)) return [];
  const joined = decodeReferences(text.replace(TAG, ''));
  const spaced = decodeReferences(text.replace(TAG, ' '));
  return joined === spaced ? [joined] : [joined, spaced];
}

/** Percent-encoding undone, again while it changes (`%2540` is `%40` encoded once more), at most three times. */
function percentDecoded(text: string): string {
  let decoded = text;
  for (let round = 0; round < 3 && PERCENT.test(decoded); round++) decoded = decoded.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return decoded;
}

/** A plus sign between two characters, as a web address writes a space in its query. */
const PLUS_SPACE = /[^\s+]\+[^\s+]/;

/**
 * The ways a text is read besides as it stands: without NUL characters; with its markup read as text
 * (tags removed, character references decoded: fix wave B8); and, where `addresses` is set, with
 * percent-encoding undone (percentDecoded), also as UTF-8; with "+" read as a space first, as a browser
 * reads a query (fix wave B8); and the data of `data:...;base64,` addresses (fix round 1, B1).
 */
function readings(text: string, addresses: boolean): string[] {
  const out = [text];
  if (text.includes(NUL)) out.push(text.split(NUL).join(''));
  for (const reading of [...out]) out.push(...markupReadings(reading));
  if (!addresses) return out;
  const plus = PLUS_SPACE.test(text);
  if (PERCENT.test(text) || plus) {
    for (const source of plus ? [text, text.replace(/\+/g, ' ')] : [text]) {
      const decoded = percentDecoded(source);
      if (decoded === text) continue;
      out.push(decoded);
      if (hasNonAscii(decoded)) out.push(bytesAsUtf8(decoded));
    }
  }
  if (text.includes('base64,')) {
    let count = 0;
    for (const m of text.matchAll(/base64,([A-Za-z0-9+/=\s]{4,})/g)) {
      if (count++ >= 16) break;
      try {
        const data = atob(m[1].replace(/\s+/g, ''));
        out.push(data);
        if (hasNonAscii(data)) out.push(bytesAsUtf8(data));
      } catch {
        // not base64
      }
    }
  }
  return out;
}

function passOfReadings(rules: readonly Rule[], text: string, addresses: boolean): CheckPass | null {
  let found: CheckPass | null = null;
  for (const reading of readings(text, addresses)) {
    found = stronger(found, passOf(rules, reading));
    if (found === 'strict') break;
  }
  return found;
}

/**
 * How a piece of text holds any of the targets, by the rules of the check: 'strict', 'loose' or
 * null. For the reader-side check (Task A9), so that it compares exactly as this one does.
 */
export function targetPass(targets: readonly CheckTarget[]): (text: string) => CheckPass | null {
  const { rules } = compile(targets);
  return (text) => (typeof text !== 'string' || text === '' || rules.length === 0 ? null : passOfReadings(rules, text, true));
}

/** Whether a piece of text holds any of the targets in either pass: the build's `titleHasValue` (bookmark titles, web addresses). */
export function targetMatcher(targets: readonly CheckTarget[]): (text: string) => boolean {
  const pass = targetPass(targets);
  return (text) => pass(text) !== null;
}

// ---- bytes to text -------------------------------------------------------------------------------

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  return out;
}

function utf16(bytes: Uint8Array, littleEndian: boolean): string {
  const start = bytes.length >= 2 && ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) ? 2 : 0;
  const units = new Uint16Array(Math.max(0, Math.floor((bytes.length - start) / 2)));
  for (let i = 0; i < units.length; i++) {
    const a = bytes[start + 2 * i];
    const b = bytes[start + 2 * i + 1];
    units[i] = littleEndian ? a | (b << 8) : (a << 8) | b;
  }
  let out = '';
  for (let i = 0; i < units.length; i += 8192) out += String.fromCharCode.apply(null, units.subarray(i, i + 8192) as unknown as number[]);
  return out;
}

const utf8Decoder = new TextDecoder('utf-8');
const utf8 = (bytes: Uint8Array) => utf8Decoder.decode(bytes);

/** PDFDocEncoding where it differs from Latin-1 (PDF 1.7, annex D). */
const PDF_DOC: Readonly<Record<number, number>> = {
  0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9, 0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
  0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
  0x88: 0x2039, 0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018,
  0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01, 0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
  0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0xa0: 0x20ac,
};
const pdfDoc = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(PDF_DOC[b] ?? b)).join('');

/** Every way a string's bytes may be text (a short string: all of them). */
function stringTexts(bytes: Uint8Array, unicode: boolean): string[] {
  let nul = false;
  let high = false;
  let low = false;
  for (const b of bytes) {
    if (b === 0) nul = true;
    else if (b < 0x20) low = true;
    else if (b >= 0x80) high = true;
  }
  const plain = latin1(bytes);
  const texts = new Set([plain]);
  if (nul) texts.add(plain.split(NUL).join(''));
  if (high || low) texts.add(pdfDoc(bytes));
  if (high) texts.add(utf8(bytes));
  if (bytes.length >= 2 && (nul || high || low || unicode)) {
    texts.add(utf16(bytes, false));
    texts.add(utf16(bytes, true));
  }
  return [...texts];
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The ways a stream's bytes are read: as bytes (and without NULs); as UTF-8 whenever it holds bytes
 * of 0x80 or more and is valid UTF-8, or is read as PDF syntax anyway (fix round 1: a full-width value
 * in UTF-8 inside a content-stream comment); as UTF-16 when a form has characters outside ASCII.
 */
function streamTexts(bytes: Uint8Array, unicode: boolean, syntax: boolean): string[] {
  const plain = latin1(bytes);
  const texts = [plain];
  if (bytes.includes(0)) texts.push(plain.split(NUL).join(''));
  if (bytes.some((b) => b >= 0x80)) {
    try {
      texts.push(strictUtf8.decode(bytes));
    } catch {
      if (syntax || unicode) texts.push(utf8(bytes));
    }
  }
  if (unicode && bytes.length >= 2) texts.push(utf16(bytes, false), utf16(bytes, true));
  return texts;
}

/** A string's text as a reader takes it: by its byte-order mark, else byte for byte. */
function textOfString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes, false);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return utf16(bytes, true);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8(bytes.subarray(3));
  return latin1(bytes);
}

// ---- strings and names written in streams ------------------------------------------------------

const isWhite = (c: number) => c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
const isDelimiter = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
const hexValue = (c: number) => (c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1);
const ESCAPES: Readonly<Record<number, number>> = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };

interface Piece {
  bytes: Uint8Array;
  /** Written plainly (ASCII, no escape): the stream's own text already holds it as it reads. */
  plain: boolean;
}

interface StreamTokens {
  /** Every string, in order, and every joined array (for `contentStrings`). */
  all: Uint8Array[];
  /** What the stream shows: the operands of `Tj`, `'` and `"`, and the pieces and the join of each `TJ` array. */
  drawn: Piece[];
  /** Other strings that need their own reading (hex, escaped, non-ASCII) and the joins of other arrays. */
  other: Uint8Array[];
  /** Names written with `#` escapes, decoded. */
  names: Uint8Array[];
  /** The `/ActualText` values of the stream's marked content, decoded, in order (fix round 1: one value split across spans). */
  actualText: string[];
  /**
   * Every string the stream shows, in drawing order (a `TJ` array as one), each marked when a new line or
   * text object begins before it (BT, Td, TD, Tm, T*, ' and "): fix wave 2, R1, text drawn in pieces.
   */
  shown: { bytes: Uint8Array; newLine: boolean }[];
}

/** A literal string from `(` at `start`: its bytes, where it ends, and whether it was written plainly. */
function readLiteral(text: string, start: number): { bytes: number[]; end: number; plain: boolean } {
  const bytes: number[] = [];
  let plain = true;
  let depth = 1;
  let i = start + 1;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 0x5c) {
      plain = false;
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
      } else if (next === 0x0d) {
        i += text.charCodeAt(i + 2) === 0x0a ? 3 : 2; // a line continuation
      } else if (next === 0x0a) {
        i += 2;
      } else if (Number.isNaN(next)) {
        i += 1;
      } else {
        bytes.push(ESCAPES[next] ?? next);
        i += 2;
      }
      continue;
    }
    if (c === 0x28) depth += 1;
    else if (c === 0x29) {
      depth -= 1;
      if (depth === 0) return { bytes, end: i + 1, plain };
    }
    if (c >= 0x80) plain = false;
    bytes.push(c & 0xff);
    i += 1;
  }
  return { bytes, end: text.length, plain };
}

/** A hex string from `<` at `start` (not `<<`): its bytes and where it ends. An odd last digit reads as d0. */
function readHex(text: string, start: number): { bytes: number[]; end: number } {
  const bytes: number[] = [];
  let high = -1;
  let i = start + 1;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x3e) {
      i += 1;
      break;
    }
    const v = hexValue(c);
    if (v < 0) continue;
    if (high < 0) high = v;
    else {
      bytes.push(high * 16 + v);
      high = -1;
    }
  }
  if (high >= 0) bytes.push(high * 16);
  return { bytes, end: i };
}

/** A name's characters with `#xx` escapes decoded, either case. */
function decodeNameText(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Strings, joined arrays and escaped names written in a stream read as PDF syntax (content streams,
 * and anything else: a stream that is not PDF syntax only gives harmless extra pieces), each string
 * sorted by the operator that takes it (drawn by `Tj`, `TJ`, `'`, `"`, or not). Comments and inline
 * image data are passed over.
 */
function streamTokens(text: string): StreamTokens {
  const all: Uint8Array[] = [];
  const drawn: Piece[] = [];
  const other: Uint8Array[] = [];
  const names: Uint8Array[] = [];
  const actualText: string[] = [];
  const shown: { bytes: Uint8Array; newLine: boolean }[] = [];
  let newLine = true;
  const arrays: Piece[][] = [];
  let pending: Piece[] = []; // operands since the last operator
  let pendingArrays: Piece[][] = [];
  let lastName = '';
  const keep = (piece: Piece) => {
    if (!piece.plain) other.push(piece.bytes);
  };
  const add = (bytes: number[], plain: boolean) => {
    const piece = { bytes: Uint8Array.from(bytes), plain };
    all.push(piece.bytes);
    if (lastName === 'ActualText') actualText.push(textOfString(piece.bytes));
    if (arrays.length > 0) arrays[arrays.length - 1].push(piece);
    else pending.push(piece);
  };
  const operator = (op: string) => {
    const shows = op === 'Tj' || op === "'" || op === '"';
    if (op === "'" || op === '"') newLine = true;
    for (const piece of pending) {
      if (shows) {
        drawn.push(piece);
        shown.push({ bytes: piece.bytes, newLine });
        newLine = false;
      } else keep(piece);
    }
    for (const pieces of pendingArrays) {
      const joined = pieces.length >= 2 ? { bytes: Uint8Array.from(pieces.flatMap((p) => Array.from(p.bytes))), plain: false } : null;
      if (op === 'TJ') {
        drawn.push(...pieces);
        if (joined) drawn.push(joined);
        shown.push({ bytes: joined?.bytes ?? pieces[0]?.bytes ?? new Uint8Array(0), newLine });
        newLine = false;
      } else {
        pieces.forEach(keep);
        if (joined) other.push(joined.bytes);
      }
    }
    pending = [];
    pendingArrays = [];
    if (op === 'BT' || op === 'ET' || op === 'Td' || op === 'TD' || op === 'Tm' || op === 'T*') newLine = true;
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 0x25) {
      while (i < n && text.charCodeAt(i) !== 0x0a && text.charCodeAt(i) !== 0x0d) i++;
      continue;
    }
    if (c === 0x28) {
      const literal = readLiteral(text, i);
      add(literal.bytes, literal.plain);
      i = literal.end;
    } else if (c === 0x3c && text.charCodeAt(i + 1) !== 0x3c) {
      const hexString = readHex(text, i);
      add(hexString.bytes, false);
      i = hexString.end;
    } else if (c === 0x5b) {
      arrays.push([]);
      i += 1;
    } else if (c === 0x5d) {
      const pieces = arrays.pop();
      if (pieces) {
        all.push(...(pieces.length >= 2 ? [Uint8Array.from(pieces.flatMap((p) => Array.from(p.bytes)))] : []));
        if (arrays.length > 0) arrays[arrays.length - 1].push(...pieces);
        else pendingArrays.push(pieces);
      }
      i += 1;
    } else if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
      const raw = text.slice(i + 1, j);
      const decoded = raw.includes('#') ? decodeNameText(raw) : raw;
      if (raw.includes('#')) names.push(Uint8Array.from(decoded, (ch) => ch.charCodeAt(0) & 0xff));
      lastName = decoded;
      i = j;
      continue;
    } else if (isWhite(c)) {
      i += 1;
      continue;
    } else if (isDelimiter(c)) {
      i += c === 0x3c || c === 0x3e ? 2 : 1;
    } else {
      let j = i + 1;
      while (j < n && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
      const word = text.slice(i, j);
      if (word === 'ID') {
        // Inline image data: binary up to an EI that stands on its own.
        let k = text.indexOf('EI', j + 1);
        while (k >= 0 && !(isWhite(text.charCodeAt(k - 1)) && (k + 2 >= n || isWhite(text.charCodeAt(k + 2)) || isDelimiter(text.charCodeAt(k + 2))))) k = text.indexOf('EI', k + 1);
        j = k < 0 ? n : k + 2;
      }
      if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) && word !== 'true' && word !== 'false' && word !== 'null') operator(word);
      i = j;
    }
    lastName = '';
  }
  operator('');
  return { all, drawn, other, names, actualText, shown };
}

/**
 * The strings a stream shows read together, in drawing order (fix wave 2, R1: a name wrapped over two
 * lines of a signature box, a PAN in two strings): joined with nothing, and with a space between strings
 * and a line break where a new line or text object begins. None when it shows fewer than two strings.
 */
function shownTogether(tokens: StreamTokens): string[] {
  if (tokens.shown.length < 2) return [];
  const pieces = tokens.shown.map((p) => ({ text: textOfString(p.bytes), newLine: p.newLine }));
  const lineBreak = String.fromCharCode(10);
  return [pieces.map((p) => p.text).join(''), pieces.map((p, k) => `${k === 0 ? '' : p.newLine ? lineBreak : ' '}${p.text}`).join('')];
}

/**
 * The strings written in a decoded content stream (given byte for byte as text), decoded: escapes,
 * hex, and a UTF-16 or UTF-8 byte-order mark; the strings of each [...] array (a TJ) also joined.
 */
export function contentStrings(decodedContent: string): string[] {
  return streamTokens(decodedContent).all.map(textOfString);
}

// ---- streams -------------------------------------------------------------------------------------

const name = (key: string) => PDFName.of(key);
const FILTER = name('Filter');
const DECODE_PARMS = name('DecodeParms');
const PREDICTOR = name('Predictor');
const FLATE = name('FlateDecode');
const LZW = name('LZWDecode');
const SUBTYPE = name('Subtype');
const TYPE = name('Type');
const IMAGE = name('Image');
const OBJECT_STREAM = name('ObjStm');
const EXTERNAL = name('F');
const PARENT = name('Parent');
const KIDS = name('Kids');
const RESOURCES = name('Resources');
const XOBJECT = name('XObject');
const FONT = name('Font');
const CONTENTS = name('Contents');
const MEDIA_BOX = name('MediaBox');
const ROTATE = name('Rotate');
const USER_UNIT = name('UserUnit');
const WIDGET = name('Widget');
const FIELD_TYPE = name('FT');
const PAGE = name('Page');
const PAGES = name('Pages');
const CATALOG = name('Catalog');
const PICTURE = name('Im0');
const TEXT_FONT = name('Fh');
/** Font programs: binary, so not read as PDF syntax (still searched as bytes). */
const FONT_PROGRAM_SUBTYPES = new Set(['Type1C', 'CIDFontType0C', 'OpenType']);

const look = (context: PDFContext, object: PDFObject | undefined): PDFObject | undefined => (object instanceof PDFRef ? context.lookup(object) : object);
const numberOf = (context: PDFContext, object: PDFObject | undefined, fallback: number) => {
  const value = look(context, object);
  return value instanceof PDFNumber ? value.asNumber() : fallback;
};

/** PNG (10-15) and TIFF (2) predictors, undone; anything else is returned as it is. */
function unpredict(data: Uint8Array, predictor: number, colors: number, bitsPerComponent: number, columns: number): Uint8Array {
  const pixelBytes = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLength = Math.ceil((columns * colors * bitsPerComponent) / 8);
  if (!(rowLength > 0) || !Number.isFinite(rowLength)) return data;
  if (predictor === 2) {
    if (bitsPerComponent !== 8) return data;
    const out = data.slice();
    for (let row = 0; row * rowLength < out.length; row++) {
      const end = Math.min((row + 1) * rowLength, out.length);
      for (let i = row * rowLength + pixelBytes; i < end; i++) out[i] = (out[i] + out[i - pixelBytes]) & 0xff;
    }
    return out;
  }
  if (predictor < 10) return data;
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLength + 1)];
    const src = r * (rowLength + 1) + 1;
    const dst = r * rowLength;
    for (let i = 0; i < rowLength; i++) {
      const left = i >= pixelBytes ? out[dst + i - pixelBytes] : 0;
      const up = r > 0 ? out[dst - rowLength + i] : 0;
      const upLeft = r > 0 && i >= pixelBytes ? out[dst - rowLength + i - pixelBytes] : 0;
      let predicted = 0;
      if (type === 1) predicted = left;
      else if (type === 2) predicted = up;
      else if (type === 3) predicted = (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[dst + i] = (data[src + i] + predicted) & 0xff;
    }
  }
  return out;
}

/** One filter applied (with its predictor); null when pdf-lib cannot apply it or the data is damaged. */
function decodeOne(context: PDFContext, filter: PDFName, parms: PDFDict | undefined, data: Uint8Array): Uint8Array | null {
  try {
    const dict = context.obj({});
    dict.set(FILTER, filter);
    if (parms) dict.set(DECODE_PARMS, parms);
    const decoded = decodePDFRawStream(PDFRawStream.of(dict, data)).decode();
    const predictor = parms ? numberOf(context, parms.get(PREDICTOR), 1) : 1;
    if (predictor > 1 && (filter === FLATE || filter === LZW)) {
      return unpredict(decoded, predictor, numberOf(context, parms!.get(name('Colors')), 1), numberOf(context, parms!.get(name('BitsPerComponent')), 8), numberOf(context, parms!.get(name('Columns')), 1));
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * A stream's data to search: decoded through every filter; when a filter cannot be applied, the
 * stored bytes and what the filters before it gave.
 */
function streamData(context: PDFContext, stream: PDFRawStream): Uint8Array[] {
  const { dict, contents } = stream;
  if (dict.has(EXTERNAL)) return [contents];
  const filter = look(context, dict.get(FILTER));
  if (filter === undefined) return [contents];
  const filters = filter instanceof PDFName ? [filter] : filter instanceof PDFArray ? filter.asArray().map((f) => look(context, f)) : [undefined];
  const parmsValue = look(context, dict.get(DECODE_PARMS));
  const parmsList = parmsValue instanceof PDFArray ? parmsValue.asArray().map((p) => look(context, p)) : [parmsValue];
  let data = contents;
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    const parms = parmsList[i];
    const decoded = f instanceof PDFName ? decodeOne(context, f, parms instanceof PDFDict ? parms : undefined, data) : null;
    if (decoded === null) return i === 0 ? [contents] : [contents, data];
    data = decoded;
  }
  return [data];
}

/** Whether a stream's data is read as PDF syntax for strings: not an image, not a font program. */
function readsAsSyntax(context: PDFContext, dict: PDFDict): boolean {
  if (look(context, dict.get(SUBTYPE)) === IMAGE) return false;
  if (dict.has(name('Length1')) || dict.has(name('Length2')) || dict.has(name('Length3'))) return false;
  const subtype = look(context, dict.get(SUBTYPE));
  return !(subtype instanceof PDFName && FONT_PROGRAM_SUBTYPES.has(subtype.decodeText()));
}

// ---- reading objects -----------------------------------------------------------------------------

/** Receives every piece of text read and says whether (and how) it holds a target. */
interface Sink {
  unicode: boolean;
  /** `addresses`: also read the text percent-decoded and its base64 data addresses (strings and PDF-syntax streams). */
  take(text: string, addresses: boolean): CheckPass | null;
  /** Exact bytes looked for in data that holds no text (an image's pixels); none: such data is not looked into. */
  needles?: readonly Uint8Array[];
}

/** A pause between two slices of work, when the caller paces the run (see Pacer). */
type Pace = () => Promise<void> | undefined;

/** Data read as text in slices of this many bytes, each with the end of the one before it (fix wave 3, Ruling D). */
const SLICE_BYTES = 256 * 1024;
/** Bytes of the slice before that each slice also reads, so a value across the cut is still whole in one of them. */
const SLICE_OVERLAP = 4096;

const nameBytes = (n: PDFName) => {
  const text = decodeNameText(n.decodeText());
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
};

/** A hex string as a reader reads it: white space ignored, an odd last digit read as d0 (pdf-lib pairs the spaces too). */
const hexBytes = (value: string) => Uint8Array.from(readHex(`<${value}>`, 0).bytes);

function takeString(sink: Sink, bytes: Uint8Array): CheckPass | null {
  let found: CheckPass | null = null;
  for (const text of stringTexts(bytes, sink.unicode)) {
    found = stronger(found, sink.take(text, true));
    if (found === 'strict') break;
  }
  return found;
}

/** What reading a stream found: the stronger pass, and whether a string it shows (drawn) holds the target. */
interface Taken {
  pass: CheckPass | null;
  drawn: boolean;
}

/**
 * A stream's data as bytes, and as PDF syntax: the strings it shows (drawn), its other strings, each
 * `TJ` array joined, all its `/ActualText` values read together, and its escaped names.
 */
function takeData(sink: Sink, data: Uint8Array, syntax: boolean): Taken {
  let pass: CheckPass | null = null;
  for (const text of streamTexts(data, sink.unicode, syntax)) pass = stronger(pass, sink.take(text, syntax));
  if (!syntax) return { pass, drawn: false };
  return takeTokens(sink, data, pass);
}

/** takeData's reading of a stream as PDF syntax, after its reading as text found `before`. */
function takeTokens(sink: Sink, data: Uint8Array, before: CheckPass | null): Taken {
  const run = tokensReading(sink, data, before);
  let step = run.next();
  while (!step.done) step = run.next();
  return step.value;
}

/** Strings read between two chances to pause (fix wave 3, Ruling D: a page of a browser-printed report shows thousands). */
const STRINGS_PER_PAUSE = 256;

/** takeTokens with a pause every STRINGS_PER_PAUSE strings. */
async function takeTokensPaced(sink: Sink, data: Uint8Array, before: CheckPass | null, pace?: Pace): Promise<Taken> {
  const run = tokensReading(sink, data, before);
  let step = run.next();
  while (!step.done) {
    const wait = pace?.();
    if (wait) await wait;
    step = run.next();
  }
  return step.value;
}

/** The reading of a stream's strings, yielding every STRINGS_PER_PAUSE strings so a caller may pause there. */
function* tokensReading(sink: Sink, data: Uint8Array, before: CheckPass | null): Generator<void, Taken, void> {
  let pass = before;
  const tokens = streamTokens(latin1(data));
  let drawn = false;
  let count = 0;
  // A string written plainly is part of the stream's own text: when that text holds nothing, neither does it.
  for (const piece of tokens.drawn) {
    if (piece.plain && pass === null) continue;
    if (++count % STRINGS_PER_PAUSE === 0) yield;
    const found = takeString(sink, piece.bytes);
    if (found) {
      drawn = true;
      pass = stronger(pass, found);
    }
  }
  for (const bytes of [...tokens.other, ...tokens.names]) {
    if (++count % STRINGS_PER_PAUSE === 0) yield;
    pass = stronger(pass, takeString(sink, bytes));
  }
  if (tokens.actualText.length > 1) pass = stronger(pass, sink.take(tokens.actualText.join(''), true));
  for (const together of shownTogether(tokens)) {
    const found = sink.take(together, true);
    if (found) {
      drawn = true;
      pass = stronger(pass, found);
    }
  }
  return { pass, drawn };
}

/**
 * takeData on data of any size without a long stretch (fix wave 3, Ruling D): read as text in slices of
 * SLICE_BYTES (each with SLICE_OVERLAP bytes of the one before), with a pause between slices; as PDF syntax
 * (its strings and shown text) in one piece, as before.
 */
async function takeDataPaced(sink: Sink, data: Uint8Array, syntax: boolean, pace?: Pace): Promise<Taken> {
  if (data.length <= SLICE_BYTES) {
    let pass: CheckPass | null = null;
    for (const text of streamTexts(data, sink.unicode, syntax)) pass = stronger(pass, sink.take(text, syntax));
    if (!syntax) return { pass, drawn: false };
    const wait = pace?.();
    if (wait) await wait;
    return takeTokensPaced(sink, data, pass, pace);
  }
  let pass: CheckPass | null = null;
  for (let at = 0; at < data.length; at += SLICE_BYTES) {
    const slice = data.subarray(Math.max(0, at - SLICE_OVERLAP), Math.min(data.length, at + SLICE_BYTES));
    for (const text of streamTexts(slice, sink.unicode, syntax)) pass = stronger(pass, sink.take(text, syntax));
    const wait = pace?.();
    if (wait) await wait;
  }
  if (!syntax) return { pass, drawn: false };
  return takeTokensPaced(sink, data, pass, pace);
}

/**
 * The needles by the byte each is looked up by (its first byte that is not 0: UTF-16 has many), with that
 * byte's place in the needle: one pass over the data finds them all.
 */
function needleTable(needles: readonly Uint8Array[]): ({ needle: Uint8Array; anchor: number }[] | undefined)[] {
  const table: ({ needle: Uint8Array; anchor: number }[] | undefined)[] = Array.from({ length: 256 }, () => undefined);
  for (const needle of needles) {
    let anchor = 0;
    while (anchor < needle.length - 1 && needle[anchor] === 0) anchor++;
    (table[needle[anchor]] ??= []).push({ needle, anchor });
  }
  return table;
}

/** Whether any needle stands in `data` ('strict': the value's own bytes), in one pass, a slice at a time with a pause between slices. */
async function needlesIn(needles: readonly Uint8Array[], data: Uint8Array, pace?: Pace): Promise<CheckPass | null> {
  const table = needleTable(needles);
  const step = SLICE_BYTES * 4;
  for (let at = 0; at < data.length; at += step) {
    const end = Math.min(data.length, at + step);
    for (let i = at; i < end; i++) {
      const candidates = table[data[i]];
      if (!candidates) continue;
      for (const { needle, anchor } of candidates) {
        const start = i - anchor;
        if (start < 0 || start + needle.length > data.length) continue;
        let k = 0;
        while (k < needle.length && data[start + k] === needle[k]) k++;
        if (k === needle.length) return 'strict';
      }
    }
    const wait = pace?.();
    if (wait) await wait;
  }
  return null;
}

/** Codecs whose data is pixels or entropy-coded data (an image's last filter). */
const IMAGE_CODECS = new Set(['DCTDecode', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode']);

/**
 * The parts of an image's encoded data that hold text by design (fix wave 3, Ruling D): a JPEG's APP0 to
 * APP15 segments (JFIF, EXIF, XMP, ICC, IPTC, Adobe) and COM segments, and anything after its end marker;
 * a JPEG 2000 file's boxes other than its code stream, and a code stream's comment segments. Data that is
 * not what its codec says is returned whole: it is read as text.
 */
function imageTextParts(codec: string | undefined, data: Uint8Array): Uint8Array[] {
  if (codec === 'DCTDecode') return jpegTextParts(data);
  if (codec === 'JPXDecode') return jpxTextParts(data);
  return [];
}

function jpegTextParts(data: Uint8Array): Uint8Array[] {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return [data];
  const parts: Uint8Array[] = [];
  let at = 2;
  while (at + 1 < data.length) {
    if (data[at] !== 0xff) {
      parts.push(data.subarray(at));
      return parts;
    }
    const marker = data[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9) {
      if (at + 2 < data.length) parts.push(data.subarray(at + 2));
      return parts;
    }
    if (at + 4 > data.length) break;
    const length = (data[at + 2] << 8) | data[at + 3];
    if (length < 2) {
      parts.push(data.subarray(at));
      return parts;
    }
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) parts.push(data.subarray(at + 4, Math.min(data.length, at + 2 + length)));
    at += 2 + length;
    if (marker === 0xda) {
      // The entropy-coded scan, up to the next marker (a stuffed 0, a restart or a fill byte is part of it).
      let k = at;
      for (;;) {
        k = data.indexOf(0xff, k);
        if (k < 0 || k + 1 >= data.length) return parts;
        const next = data[k + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) k += 2;
        else if (next === 0xff) k += 1;
        else break;
      }
      at = k;
    }
  }
  return parts;
}

function jpxTextParts(data: Uint8Array): Uint8Array[] {
  const u32 = (at: number) => ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
  const codestreamComments = (from: number, to: number) => {
    const out: Uint8Array[] = [];
    let at = from + 2;
    while (at + 4 <= to && data[at] === 0xff && data[at + 1] !== 0x90) {
      const length = (data[at + 2] << 8) | data[at + 3];
      if (length < 2) break;
      if (data[at + 1] === 0x64) out.push(data.subarray(at + 4, Math.min(to, at + 2 + length)));
      at += 2 + length;
    }
    return out;
  };
  if (data[0] === 0xff && data[1] === 0x4f) return codestreamComments(0, data.length);
  const parts: Uint8Array[] = [];
  let at = 0;
  while (at + 8 <= data.length) {
    let length = u32(at);
    let header = 8;
    if (length === 1) {
      if (at + 16 > data.length) break;
      length = u32(at + 8) * 0x100000000 + u32(at + 12);
      header = 16;
    } else if (length === 0) length = data.length - at;
    if (length < header) {
      parts.push(data.subarray(at));
      return parts;
    }
    const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
    const end = Math.min(data.length, at + length);
    if (type === 'jp2c') parts.push(...codestreamComments(at + header, end));
    else parts.push(data.subarray(at + header, end));
    at += length;
  }
  if (at < data.length) parts.push(data.subarray(at));
  return parts;
}

/** Flate data inflated in pieces by the runtime (DecompressionStream: no long stretch), with a pause between pieces; null when the runtime has none or the data does not inflate so. */
async function inflatePaced(data: Uint8Array, pace?: Pace): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || typeof ReadableStream === 'undefined') return null;
  try {
    // A copy with its own ArrayBuffer: what the stream types ask for (pdf-lib's data may share a larger buffer).
    const copy = new Uint8Array(new ArrayBuffer(data.length));
    copy.set(data);
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(copy);
        controller.close();
      },
    });
    const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      const wait = pace?.();
      if (wait) await wait;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } catch {
    return null;
  }
}

/** Stored data larger than this is inflated in pieces (inflatePaced) where the runtime can. */
const PACED_INFLATE_BYTES = 64 * 1024;

/**
 * streamData without a long stretch (fix wave 3, Ruling D): the same layers, with Flate data larger than
 * PACED_INFLATE_BYTES inflated in pieces where the runtime can (pdf-lib's own decoder otherwise, or when
 * the runtime refuses the data); `codecs` false stops before an image codec (DCT, JPX, JBIG2, CCITT) and
 * leaves predictors undone, so an image's encoded data is what is returned.
 */
async function streamDataPaced(context: PDFContext, stream: PDFRawStream, pace: Pace | undefined, image: boolean): Promise<{ layers: Uint8Array[]; codec?: string }> {
  const { dict, contents } = stream;
  if (dict.has(EXTERNAL)) return { layers: [contents] };
  const filter = look(context, dict.get(FILTER));
  if (filter === undefined) return { layers: [contents] };
  const filters = filter instanceof PDFName ? [filter] : filter instanceof PDFArray ? filter.asArray().map((f) => look(context, f)) : [undefined];
  const parmsValue = look(context, dict.get(DECODE_PARMS));
  const parmsList = parmsValue instanceof PDFArray ? parmsValue.asArray().map((p) => look(context, p)) : [parmsValue];
  let data = contents;
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    const parms = parmsList[i];
    if (image && f instanceof PDFName && IMAGE_CODECS.has(f.decodeText())) return { layers: i === 0 ? [contents] : [contents, data], codec: f.decodeText() };
    let decoded: Uint8Array | null = null;
    if (f === FLATE && data.length > PACED_INFLATE_BYTES) {
      const inflated = await inflatePaced(data, pace);
      if (inflated) {
        const predictor = parms instanceof PDFDict ? numberOf(context, parms.get(PREDICTOR), 1) : 1;
        decoded = predictor > 1 && !image && parms instanceof PDFDict
          ? unpredict(inflated, predictor, numberOf(context, parms.get(name('Colors')), 1), numberOf(context, parms.get(name('BitsPerComponent')), 8), numberOf(context, parms.get(name('Columns')), 1))
          : inflated;
      }
    }
    if (decoded === null) decoded = f instanceof PDFName ? decodeOne(context, f, parms instanceof PDFDict && !image ? parms : undefined, data) : null;
    if (decoded === null) return { layers: i === 0 ? [contents] : [contents, data] };
    data = decoded;
    const wait = pace?.();
    if (wait) await wait;
  }
  return { layers: image ? [contents, data] : [data] };
}

/**
 * An image's data (fix wave 3, Ruling D): what holds text by design read as text (imageTextParts), and the
 * stored and decoded data searched for each value's exact bytes (needlesIn); never read as text: it holds
 * pixels or entropy-coded data, which no reader extracts as text.
 */
async function takeImage(context: PDFContext, stream: PDFRawStream, sink: Sink, pace?: Pace): Promise<CheckPass | null> {
  const { layers, codec } = await streamDataPaced(context, stream, pace, true);
  let pass: CheckPass | null = null;
  for (const part of imageTextParts(codec, layers[layers.length - 1])) {
    pass = stronger(pass, (await takeDataPaced(sink, part, false, pace)).pass);
    if (pass === 'strict') return pass;
  }
  if (!sink.needles || sink.needles.length === 0) return pass;
  for (const data of layers) {
    pass = stronger(pass, await needlesIn(sink.needles, data, pace));
    if (pass === 'strict') return pass;
  }
  return pass;
}

/** PDF keys a hit may be reported under; any other key is reported as 'other' (a file's own names are never repeated). */
const KNOWN_KEYS = new Set([
  'A', 'AA', 'ActualText', 'AF', 'Alt', 'Annots', 'AP', 'Author', 'BaseFont', 'CA', 'Contents', 'Creator', 'D', 'DA', 'Desc', 'Dest', 'Differences',
  'DR', 'DS', 'DV', 'E', 'EF', 'Encoding', 'F', 'Font', 'FontName', 'FS', 'ID', 'JS', 'K', 'Keywords', 'Kids', 'Lang', 'MK', 'Metadata', 'N', 'Name',
  'Names', 'NM', 'OCGs', 'Opt', 'Order', 'OverlayText', 'P', 'PA', 'Parent', 'PieceInfo', 'Popup', 'Producer', 'Properties', 'RC', 'Resources',
  'S', 'Subj', 'Subject', 'T', 'Title', 'TM', 'ToUnicode', 'TU', 'UF', 'URI', 'V', 'XObject',
]);
const keyName = (key: PDFName) => {
  const text = key.decodeText();
  return KNOWN_KEYS.has(text) ? text : 'other';
};

/**
 * Whether text under this key of this dictionary is painted on the page: a FreeText comment's own
 * text, a field's value, options and captions. A comment's contents, a link's address, a name or a
 * tooltip are not painted (they show only on request), so a rebuild without a box removes them.
 */
function drawnUnder(context: PDFContext, dict: PDFDict, key: string): boolean {
  const subtype = look(context, dict.get(SUBTYPE));
  if (subtype === name('FreeText')) return key === 'Contents' || key === 'RC' || key === 'DS';
  if (subtype === WIDGET || dict.has(FIELD_TYPE)) return key === 'V' || key === 'Opt' || key === 'MK';
  return false;
}

interface Found {
  pass: CheckPass;
  key: string;
  /** A string the page shows holds it (an operand of a text-showing operator, or a painted annotation text). */
  drawn: boolean;
}

/**
 * One object's own text: its strings and names (keys too), nested direct objects, and its stream
 * data unless `skipData` says not to. References are not followed (each object is read on its own).
 * Returns the first strict hit, else the first loose one, with the key it sits under, and whether
 * any hit is drawn.
 */
async function scanObject(context: PDFContext, object: PDFObject, sink: Sink, skipData: (stream: PDFRawStream) => boolean, pace?: Pace): Promise<Found | null> {
  const result: { found: Found | null } = { found: null };
  const note = (pass: CheckPass | null, key: string, drawn: boolean) => {
    if (!pass) return;
    const known = result.found;
    if (!known || (pass === 'strict' && known.pass !== 'strict')) result.found = { pass, key, drawn: drawn || (known?.drawn ?? false) };
    else if (drawn) known.drawn = true;
  };
  const stack: [PDFObject, string, boolean][] = [[object, 'other', false]];
  while (stack.length > 0) {
    const [item, key, drawn] = stack.pop()!;
    if (item instanceof PDFHexString) note(takeString(sink, hexBytes(item.asString())), key, drawn);
    else if (item instanceof PDFString) note(takeString(sink, item.asBytes()), key, drawn);
    else if (item instanceof PDFName) note(takeString(sink, nameBytes(item)), key, drawn);
    else if (item instanceof PDFArray) {
      for (const entry of item.asArray()) stack.push([entry, key, drawn]);
    } else if (item instanceof PDFDict || item instanceof PDFStream) {
      const dict = item instanceof PDFDict ? item : item.dict;
      for (const [k, value] of dict.entries()) {
        const text = keyName(k);
        stack.push([k, text, false], [value, text, drawn || drawnUnder(context, dict, k.decodeText())]);
      }
      if (item instanceof PDFRawStream) {
        if (look(context, item.dict.get(TYPE)) === OBJECT_STREAM || skipData(item)) continue;
        if (look(context, item.dict.get(SUBTYPE)) === IMAGE) {
          note(await takeImage(context, item, sink, pace), 'stream', false);
          continue;
        }
        const syntax = readsAsSyntax(context, item.dict);
        for (const data of (await streamDataPaced(context, item, pace, false)).layers) {
          const taken = await takeDataPaced(sink, data, syntax, pace);
          note(taken.pass, 'stream', taken.drawn);
        }
      } else if (item instanceof PDFStream) {
        let contents: Uint8Array | null = null;
        try {
          contents = item.getContents();
        } catch {
          // nothing readable
        }
        if (contents) {
          const taken = takeData(sink, contents, true);
          note(taken.pass, 'stream', taken.drawn);
        }
      }
    }
  }
  return result.found;
}

// ---- reading bytes -------------------------------------------------------------------------------

/** Flate data inflated by pdf-lib's own decoder; null when it is not Flate data. */
function inflate(context: PDFContext, data: Uint8Array): Uint8Array | null {
  if (data.length < 2) return null;
  return decodeOne(context, FLATE, undefined, data);
}

/** Whether a parsed stream holds exactly these bytes (with or without the line end before `endstream`). */
function sameData(contents: Uint8Array, body: Uint8Array): boolean {
  let trimmed = body.length;
  if (trimmed > 0 && body[trimmed - 1] === 0x0a) trimmed -= 1;
  if (trimmed > 0 && body[trimmed - 1] === 0x0d) trimmed -= 1;
  const length = contents.length;
  if (length !== body.length && length !== trimmed && length !== body.length - 1) return false;
  for (let i = 0; i < length; i++) if (contents[i] !== body[i]) return false;
  return true;
}

/** Where an ASCII `word` starts in `bytes`, from `from`; -1 when it does not. */
function indexOfBytes(bytes: Uint8Array, word: string, from: number): number {
  const first = word.charCodeAt(0);
  for (let i = bytes.indexOf(first, from); i >= 0; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < word.length && bytes[i + k] === word.charCodeAt(k)) k++;
    if (k === word.length) return i;
  }
  return -1;
}

/** Stream bodies found in the bytes, one at a time: after a `stream` keyword that follows a dictionary's `>>` and a line end, up to `endstream`. */
function* streamBodies(file: Uint8Array): Generator<{ start: number; end: number }> {
  let search = 0;
  for (;;) {
    const at = indexOfBytes(file, 'stream', search);
    if (at < 0) break;
    search = at + 6;
    if (at >= 3 && file[at - 3] === 0x65 && file[at - 2] === 0x6e && file[at - 1] === 0x64) continue; // endstream
    let before = at - 1;
    while (before >= 0 && isWhite(file[before])) before--;
    if (before < 0 || file[before] !== 0x3e) continue;
    let start = at + 6;
    if (file[start] === 0x0d) start++;
    if (file[start] === 0x0a) start++;
    if (start === at + 6) continue;
    const endAt = indexOfBytes(file, 'endstream', start);
    const end = endAt < 0 ? file.length : endAt;
    yield { start, end };
    search = end + 9;
  }
}

/**
 * The file byte by byte: text outside streams; each stream body that is not a stream pdf-lib read
 * (or is an object stream), stored and inflated (twice when it was compressed twice). Streams
 * pdf-lib read are left to `scanObject`, which has their filters. The file is never turned into one
 * string: a redacted file is mostly pictures. `pace` is called before each stream body, and inside a large one.
 */
async function scanBytes(file: Uint8Array, doc: PDFDocument, sink: Sink, pace?: () => Promise<void> | undefined): Promise<CheckPass | null> {
  const context = doc.context;
  let found: CheckPass | null = null;
  const outside: string[] = [];
  let from = 0;
  for (const { start, end } of streamBodies(file)) {
    const wait = pace?.();
    if (wait) await wait;
    const segment = latin1(file.subarray(from, start));
    outside.push(segment);
    from = end;
    let owner: string | undefined; // the last object header before the keyword
    for (const m of segment.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) owner = `${m[1]} ${m[2]}`;
    const body = file.subarray(start, end);
    if (owner) {
      const [num, gen] = owner.split(' ').map(Number);
      const parsed = context.lookup(PDFRef.of(num, gen));
      if (parsed instanceof PDFRawStream && look(context, parsed.dict.get(TYPE)) !== OBJECT_STREAM && sameData(parsed.contents, body)) continue;
    }
    const layers = [body];
    const once = inflate(context, body);
    if (once) {
      layers.push(once);
      const twice = inflate(context, once);
      if (twice) layers.push(twice);
    }
    for (const data of layers) {
      // In slices with a pause between them (takeDataPaced): one body of a long statement held the window over a second.
      found = stronger(found, (await takeDataPaced(sink, data, true, pace)).pass);
      if (found === 'strict') return found;
    }
  }
  outside.push(latin1(file.subarray(from)));
  const rest = outside.join('\n');
  found = stronger(found, sink.take(rest, true));
  if (rest.includes(NUL)) found = stronger(found, sink.take(rest.split(NUL).join(''), true));
  const tokens = streamTokens(rest);
  for (const bytes of [...tokens.all, ...tokens.names]) {
    if (found === 'strict') break;
    found = stronger(found, takeString(sink, bytes));
  }
  return found;
}

// ---- where a find is -----------------------------------------------------------------------------

const typeOf = (context: PDFContext, dict: PDFDict) => look(context, dict.get(TYPE));

/** The references reachable from `starts` without going up through /Parent or into pages, the page tree or the catalog. */
function reachable(context: PDFContext, starts: PDFObject[], startPage?: PDFRef): Set<PDFRef> {
  const seen = new Set<PDFRef>();
  const stack = [...starts];
  const stop = (value: PDFObject | undefined) => {
    if (!(value instanceof PDFDict)) return false;
    const type = typeOf(context, value);
    return type === PAGES || type === CATALOG || (type === PAGE && value !== look(context, startPage));
  };
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item instanceof PDFRef) {
      if (seen.has(item)) continue;
      seen.add(item);
      const value = context.lookup(item);
      if (value !== undefined && !stop(value)) stack.push(value);
      continue;
    }
    const dict = item instanceof PDFDict ? item : item instanceof PDFStream ? item.dict : undefined;
    if (dict) {
      for (const [key, value] of dict.entries()) if (key !== PARENT) stack.push(value);
      // A widget's field ancestors hold its value, default value and options: they belong to its page.
      if (look(context, dict.get(SUBTYPE)) === WIDGET || dict.has(FIELD_TYPE)) {
        let parent = dict.get(PARENT);
        for (let depth = 0; parent !== undefined && depth < 32; depth++) {
          const field = look(context, parent);
          if (!(field instanceof PDFDict) || stop(field) || typeOf(context, field) === PAGE) break;
          if (parent instanceof PDFRef) {
            if (seen.has(parent)) break;
            seen.add(parent);
          }
          for (const [key, value] of field.entries()) if (key !== PARENT && key !== KIDS) stack.push(value);
          parent = field.get(PARENT);
        }
      }
    } else if (item instanceof PDFArray) {
      stack.push(...item.asArray());
    }
  }
  return seen;
}

/** What a page draws with includes the resources it inherits from the page tree. */
function inheritedResources(context: PDFContext, page: PDFDict): PDFObject[] {
  const found: PDFObject[] = [];
  let parent = look(context, page.get(PARENT));
  for (let depth = 0; parent instanceof PDFDict && depth < 32; depth++) {
    const resources = parent.get(RESOURCES);
    if (resources !== undefined) found.push(resources);
    parent = look(context, parent.get(PARENT));
  }
  return found;
}

/** The page references of the document, in order; none when pdf-lib cannot read its page tree. */
function pageRefsOf(doc: PDFDocument): PDFRef[] {
  try {
    return doc.getPages().map((page) => page.ref);
  } catch {
    return [];
  }
}

/** For each object some page reaches: the zero-based pages it belongs to. */
function pagesOf(doc: PDFDocument, refs: ReadonlySet<PDFRef>): Map<PDFRef, number[]> {
  const context = doc.context;
  const out = new Map<PDFRef, number[]>();
  if (refs.size === 0) return out;
  pageRefsOf(doc).forEach((ref, index) => {
    const page = context.lookup(ref);
    const extra = page instanceof PDFDict ? inheritedResources(context, page) : [];
    const reached = reachable(context, [ref, ...extra], ref);
    for (const hit of refs) if (reached.has(hit)) out.set(hit, [...(out.get(hit) ?? []), index]);
  });
  return out;
}

/** For each object no page reaches: the named places of the document that reach it, else 'other'. */
function placesOf(doc: PDFDocument, refs: ReadonlySet<PDFRef>): Map<PDFRef, Elsewhere[]> {
  const context = doc.context;
  const found = new Map<PDFRef, Set<Elsewhere>>();
  if (refs.size === 0) return new Map();
  const roots: [Elsewhere, PDFObject | undefined][] = [
    ['document properties', context.trailerInfo.Info],
    ['document properties', doc.catalog.get(name('Metadata'))],
    ['bookmarks', doc.catalog.get(name('Outlines'))],
    ['form', doc.catalog.get(name('AcroForm'))],
  ];
  for (const [place, root] of roots) {
    if (root === undefined) continue;
    const reached = reachable(context, [root]);
    for (const ref of refs) if (reached.has(ref)) found.set(ref, (found.get(ref) ?? new Set<Elsewhere>()).add(place));
  }
  const out = new Map<PDFRef, Elsewhere[]>();
  for (const ref of refs) {
    const places = found.get(ref);
    out.set(ref, places ? ELSEWHERE_ORDER.filter((place) => places.has(place)) : ['other']);
  }
  return out;
}

/** The content streams of the pages, and those of the rebuilt pages (their text layers). */
function contentRoles(doc: PDFDocument, picturePages: ReadonlySet<number>): { content: Set<PDFRef>; layer: Map<number, PDFRef> } {
  const context = doc.context;
  const content = new Set<PDFRef>();
  const layer = new Map<number, PDFRef>();
  pageRefsOf(doc).forEach((ref, index) => {
    const page = context.lookup(ref);
    if (!(page instanceof PDFDict)) return;
    const value = page.get(CONTENTS);
    const looked = look(context, value);
    const streams = looked instanceof PDFArray ? looked.asArray() : [value];
    const refs = streams.filter((entry): entry is PDFRef => entry instanceof PDFRef);
    refs.forEach((entry) => content.add(entry));
    if (picturePages.has(index)) layer.set(index, refs[0] ?? ref);
  });
  return { content, layer };
}

function partOf(context: PDFContext, ref: PDFRef, object: PDFObject | undefined, layers: ReadonlySet<PDFRef>, content: ReadonlySet<PDFRef>, pages: number[], elsewhere: string[]): HitPart {
  if (layers.has(ref)) return 'text layer';
  if (content.has(ref)) return 'content';
  const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : undefined;
  if (dict) {
    if (typeOf(context, dict) === PAGE) return 'page';
    if (look(context, dict.get(SUBTYPE)) === WIDGET || dict.has(FIELD_TYPE)) return 'field';
    if (dict.has(SUBTYPE) && dict.has(name('Rect'))) return 'annotation';
  }
  if (pages.length > 0) return 'resources';
  if (elsewhere.includes('bookmarks')) return 'bookmark';
  if (elsewhere.includes('document properties')) return 'properties';
  if (elsewhere.includes('form')) return 'field';
  return 'object';
}

// ---- a rebuilt page's text layer -----------------------------------------------------------------

interface LayerItem {
  text: string;
  rect: Rect;
  /** Where the word stands on its line, for reading the layer by position (fix wave 3, Ruling C). */
  piece: LinePiece;
}

let layerFontCache: { decode: Map<number, string>; width: (ch: string) => number } | undefined;

/** The standard Helvetica of a text layer: WinAnsi codes to characters, and advances at size 1. */
function layerFont(): { decode: Map<number, string>; width: (ch: string) => number } {
  if (layerFontCache) return layerFontCache;
  // pdf-lib types the standard font names separately from its StandardFonts enum; the value is the same.
  const embedder = StandardFontEmbedder.for(StandardFonts.Helvetica as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
  const decode = new Map<number, string>();
  for (const codePoint of embedder.encoding.supportedCodePoints) {
    try {
      decode.set(embedder.encoding.encodeUnicodeCodePoint(codePoint).code, String.fromCodePoint(codePoint));
    } catch {
      // not in WinAnsi
    }
  }
  const widths = new Map<string, number>();
  const width = (ch: string) => {
    let value = widths.get(ch);
    if (value === undefined) {
      try {
        value = embedder.widthOfTextAtSize(ch, 1);
      } catch {
        value = 0.5;
      }
      widths.set(ch, value);
    }
    return value;
  };
  layerFontCache = { decode, width };
  return layerFontCache;
}

/** A page's content streams decoded and joined; null when one cannot be read. */
function pageContent(context: PDFContext, page: PDFDict): string | null {
  const contents = look(context, page.get(CONTENTS));
  const streams = contents instanceof PDFArray ? contents.asArray().map((entry) => look(context, entry)) : [contents];
  let text = '';
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) return null;
    try {
      text += `${latin1(stream.dict.has(FILTER) ? decodePDFRawStream(stream).decode() : stream.contents)}\n`;
    } catch {
      return null;
    }
  }
  return text;
}

/**
 * The words of a rebuilt page's text layer, in order, with their boxes in the page's user space
 * (unpadded: along the word's advance, from 0.25 em below its baseline to 0.9 em above it), read
 * from its own operators (Tm, Tz, Tf, Tj, and q, Q, BT).
 */
function layerItems(context: PDFContext, page: PDFDict): LayerItem[] {
  const text = pageContent(context, page);
  if (text === null) return [];
  const font = layerFont();
  const items: LayerItem[] = [];
  let scale = 100;
  let size = 1;
  let tm = [1, 0, 0, 1, 0, 0];
  const saved: { scale: number; size: number }[] = [];
  const numbers = (operands: Operand[]) => (operands.every((o) => o.kind === 'number') ? operands.map((o) => (o as { value: number }).value) : null);
  for (const { op, operands } of operations(text)) {
    const values = numbers(operands);
    if (op === 'q') saved.push({ scale, size });
    else if (op === 'Q') ({ scale, size } = saved.pop() ?? { scale, size });
    else if (op === 'BT') tm = [1, 0, 0, 1, 0, 0];
    else if (op === 'Tz' && values?.length === 1) scale = values[0];
    else if (op === 'Tf' && operands.length === 2 && operands[1].kind === 'number') size = operands[1].value;
    else if (op === 'Tm' && values?.length === 6) tm = values;
    else if (op === 'Tj' && operands.length === 1 && operands[0].kind === 'string') {
      const chars = operands[0].bytes.map((b) => font.decode.get(b) ?? String.fromCharCode(b));
      const advance = (chars.reduce((sum, ch) => sum + font.width(ch), 0) * size * scale) / 100;
      const [a, b, c, d, e, f] = tm;
      const corners = [
        [0, -0.25],
        [advance, -0.25],
        [0, 0.9],
        [advance, 0.9],
      ].map(([along, up]) => [e + a * along + c * up * size, f + b * along + d * up * size]);
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      const scaleAlong = Math.hypot(a, b);
      const piece: LinePiece = { x: e, y: f, dx: scaleAlong > 0 ? a / scaleAlong : 1, dy: scaleAlong > 0 ? b / scaleAlong : 0, width: advance * scaleAlong, size: Math.hypot(c, d) * size };
      items.push({ text: chars.join(''), rect: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, piece });
      tm = [a, b, c, d, e + a * advance, f + b * advance];
    }
  }
  return items;
}

/** The longest run of words a value split across a text layer is looked for in. */
const MAX_WORD_RUN = 32;

/** A word ending in a hyphen the layer's font writes (hyphen-minus, soft hyphen): broken at a line end when the next word starts the next line. */
const BROKEN_WORD_END = new RegExp(`[${String.fromCharCode(0xad)}-]$`);

/** Whether `q` stands on another line than `p` (another direction, or its baseline more than half a size away). */
function newLine(p: LinePiece, q: LinePiece): boolean {
  if (p.dx * q.dx + p.dy * q.dy < 0.99) return true;
  const across = (r: LinePiece) => -r.x * p.dy + r.y * p.dx;
  return Math.abs(across(p) - across(q)) > 0.5 * Math.min(p.size || 1, q.size || 1);
}

/**
 * Which words of a text layer hold a target: alone, or as the shortest run of words read together with
 * spaces or with nothing between them; in the layer's own order and (fix wave 3, Ruling C) in each block
 * read by position (pageText.ts textBlocks: a column, a table cell), with a word broken at a line end by
 * a hyphen joined again when the words are read together.
 */
function layerHit(items: readonly LayerItem[], rules: readonly Rule[], anywhere: readonly Rule[] = rules): { pass: CheckPass; words: number[] } | null {
  const words = new Set<number>();
  let pass: CheckPass | null = null;
  for (let i = 0; i < items.length; i++) {
    const found = passOf(rules, items[i].text);
    if (found) {
      words.add(i);
      pass = stronger(pass, found);
    }
  }
  const alone = new Set(words);
  const orders: number[][] = [items.map((_, i) => i)];
  for (const block of textBlocks(items.map((item) => item.piece))) {
    const order = block.flat();
    if (order.some((w, k) => k > 0 && w !== order[k - 1] + 1)) orders.push(order);
  }
  for (const order of orders) {
    const breakAfter = order.map((w, k) => k + 1 < order.length && newLine(items[w].piece, items[order[k + 1]].piece));
    // Words read together with a space, and with nothing between them (fix wave 2: the check reads a
    // stream's strings joined both ways, so the layer must be able to place what either finds).
    for (const gap of [' ', '']) {
      const run = (i: number, j: number) => {
        let text = '';
        for (let k = i; k <= j; k++) {
          let word = items[order[k]].text;
          if (gap === '' && k < j && breakAfter[k] && BROKEN_WORD_END.test(word) && /^\p{L}/u.test(items[order[k + 1]].text)) word = word.slice(0, -1);
          text += k > i ? gap + word : word;
        }
        return text;
      };
      // A first test over the whole order: read together with nothing between them, the words beside a
      // value join it, so that test is made without whole-word edges (`anywhere`); each run is then tested
      // with them.
      if (order.length < 2 || !passOf(gap === '' ? anywhere : rules, run(0, order.length - 1))) continue;
      for (let i = 0; i < order.length; i++) {
        // A word that holds the value alone is its own shortest run: the word after it is not needed
        // (fix wave, redact-e2e-review non-blocking 3: the word on the line below was boxed with it).
        if (alone.has(order[i])) continue;
        for (let j = i + 1; j < order.length && j < i + MAX_WORD_RUN; j++) {
          const found = passOf(rules, run(i, j));
          if (!found) continue;
          if (!passOf(rules, run(i + 1, j))) {
            for (let k = i; k <= j; k++) words.add(order[k]);
            pass = stronger(pass, found);
          }
          break;
        }
      }
    }
  }
  return pass ? { pass, words: [...words].sort((a, b) => a - b) } : null;
}

// ---- entry points --------------------------------------------------------------------------------

/** Objects pdf-lib parses between two turns of the event loop when the caller paces the run (a page picture is copied as it is parsed). */
const OBJECTS_PER_TICK = 20;

async function loadForCheck(file: Uint8Array, paced = false): Promise<PDFDocument> {
  try {
    // pdf-lib's load takes `parseSpeed` (objects parsed between two turns of the event loop); its
    // `objectsPerTick` is an option of save, ignored here (integration lane, fix wave 3).
    return await PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, ...(paced ? { parseSpeed: OBJECTS_PER_TICK } : {}) });
  } catch {
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
  }
}

/**
 * The rebuilt pages' own pictures: /Im0 of each given page, when it is an image stream with exactly
 * the build's entries (a page's own /Im0 that is anything else is searched like every image).
 */
function pictureStreams(doc: PDFDocument, picturePages: ReadonlySet<number>): Set<PDFRawStream> {
  const found = new Set<PDFRawStream>();
  if (picturePages.size === 0) return found;
  let pages: ReturnType<PDFDocument['getPages']> = [];
  try {
    pages = doc.getPages();
  } catch {
    return found;
  }
  for (const index of picturePages) {
    const page = pages[index];
    if (!page) continue;
    const resources = look(doc.context, page.node.get(RESOURCES));
    const xobjects = resources instanceof PDFDict ? look(doc.context, resources.get(XOBJECT)) : undefined;
    const picture = xobjects instanceof PDFDict ? look(doc.context, xobjects.get(PICTURE)) : undefined;
    if (!(picture instanceof PDFRawStream) || look(doc.context, picture.dict.get(SUBTYPE)) !== IMAGE) continue;
    if (picture.dict.keys().every((key) => IMAGE_KEYS.has(key.decodeText()))) found.add(picture);
  }
  return found;
}

/** The trailer's own entries other than its references (the file identifier, a direct /Info). */
function trailerParts(doc: PDFDocument): { info?: PDFObject; other: PDFObject[] } {
  const { Info, ID, Encrypt } = doc.context.trailerInfo;
  return { info: Info instanceof PDFRef ? undefined : Info, other: [ID, Encrypt instanceof PDFRef ? undefined : Encrypt].filter((x): x is PDFObject => x !== undefined) };
}

/**
 * Everything the strings check reads, as one text (for tests and diagnosis): every string and name
 * decoded every way, every stream that is not an image decoded, strings inside streams decoded and
 * each [...] array joined, the file's bytes outside parsed streams; all also without NUL characters.
 */
export async function stringsHaystack(file: Uint8Array): Promise<string> {
  const doc = await loadForCheck(file);
  const parts: string[] = [];
  const sink: Sink = {
    unicode: true,
    take: (text) => {
      parts.push(text);
      if (text.includes(NUL)) parts.push(text.split(NUL).join(''));
      return null;
    },
  };
  const context = doc.context;
  const isImage = (stream: PDFRawStream) => look(context, stream.dict.get(SUBTYPE)) === IMAGE;
  for (const [, object] of context.enumerateIndirectObjects()) await scanObject(context, object, sink, isImage);
  const trailer = trailerParts(doc);
  for (const object of [trailer.info, ...trailer.other]) if (object) await scanObject(context, object, sink, isImage);
  await scanBytes(file, doc, sink);
  return parts.join('\n');
}

/** A rectangle as the file writes it ([x0 y0 x1 y1], either corner order), normalised; undefined when it is not four numbers. */
function rectOf(context: PDFContext, value: PDFObject | undefined): Rect | undefined {
  const array = look(context, value);
  if (!(array instanceof PDFArray) || array.size() !== 4) return undefined;
  const n = array.asArray().map((v) => look(context, v));
  if (!n.every((v) => v instanceof PDFNumber && Number.isFinite(v.asNumber()))) return undefined;
  const [a, b, c, d] = n.map((v) => (v as PDFNumber).asNumber());
  return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
}

/**
 * The boxes the file gives for a hit in an annotation: its own rectangle on the page that lists it;
 * for a field, the rectangles of its widgets (followed through /Kids) on the pages that list them.
 */
function annotationBoxes(context: PDFContext, object: PDFObject | undefined, pageOfAnnotation: Map<PDFObject, number>, ref: PDFObject): { page: number; rect: Rect }[] {
  const boxes: { page: number; rect: Rect }[] = [];
  const stack: [PDFObject | undefined, PDFObject, number][] = [[object, ref, 0]];
  const seen = new Set<PDFObject>();
  while (stack.length > 0) {
    const [value, key, depth] = stack.pop()!;
    if (!(value instanceof PDFDict) || seen.has(value)) continue;
    seen.add(value);
    const rect = rectOf(context, value.get(name('Rect')));
    const page = pageOfAnnotation.get(key) ?? pageOfAnnotation.get(value);
    if (rect && page !== undefined) boxes.push({ page, rect });
    const kids = look(context, value.get(KIDS));
    if (depth < 32 && kids instanceof PDFArray) for (const kid of kids.asArray()) stack.push([look(context, kid), kid, depth + 1]);
  }
  return boxes;
}

/** Each annotation (by reference, and as a dictionary) and the zero-based page whose /Annots lists it. */
function annotationPages(doc: PDFDocument): Map<PDFObject, number> {
  const context = doc.context;
  const map = new Map<PDFObject, number>();
  pageRefsOf(doc).forEach((ref, index) => {
    const page = context.lookup(ref);
    const annots = page instanceof PDFDict ? look(context, page.get(name('Annots'))) : undefined;
    for (const entry of annots instanceof PDFArray ? annots.asArray() : []) {
      if (!map.has(entry)) map.set(entry, index);
      const dict = look(context, entry);
      if (dict && !map.has(dict)) map.set(dict, index);
    }
  });
  return map;
}

/**
 * The objects drawn only by an annotation's appearance (its /AP and everything that uses, fix round 1
 * finding 1), each with every annotation that draws it (fix wave 2, R2): a hit there is boxed by all of
 * their rectangles. An object
 * the page's own content or resources also reach is not one of them (its position is not known).
 */
function appearanceOwners(doc: PDFDocument): Map<PDFRef, { annotation: PDFDict; entry: PDFObject }[]> {
  const context = doc.context;
  const pageRefs = pageRefsOf(doc);
  const drawnByPages = new Set<PDFRef>();
  for (const ref of pageRefs) {
    const page = context.lookup(ref);
    if (!(page instanceof PDFDict)) continue;
    const starts = [page.get(CONTENTS), page.get(RESOURCES), ...inheritedResources(context, page)].filter((x): x is PDFObject => x !== undefined);
    for (const reached of reachable(context, starts)) drawnByPages.add(reached);
  }
  const owners = new Map<PDFRef, { annotation: PDFDict; entry: PDFObject }[]>();
  for (const ref of pageRefs) {
    const page = context.lookup(ref);
    const annots = page instanceof PDFDict ? look(context, page.get(name('Annots'))) : undefined;
    for (const entry of annots instanceof PDFArray ? annots.asArray() : []) {
      const annotation = look(context, entry);
      const appearance = annotation instanceof PDFDict ? annotation.get(name('AP')) : undefined;
      if (!(annotation instanceof PDFDict) || appearance === undefined) continue;
      // Every annotation that draws it (fix wave 2, R2: two stamps sharing one stored stream are two drawings).
      for (const reached of reachable(context, [appearance])) if (!drawnByPages.has(reached)) owners.set(reached, [...(owners.get(reached) ?? []), { annotation, entry }]);
    }
  }
  return owners;
}

/** Boxes without repeats (one annotation listed twice on a page), in order. */
function uniqueBoxes(boxes: { page: number; rect: Rect }[]): { page: number; rect: Rect }[] {
  const seen = new Set<string>();
  return boxes.filter((b) => {
    const key = `${b.page}:${b.rect.x0}:${b.rect.y0}:${b.rect.x1}:${b.rect.y1}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Fonts and everything they hold (encodings, ToUnicode maps, descriptors, programs, Type 3 glyphs): text there changes what drawn text reads as. */
function fontObjects(doc: PDFDocument): Set<PDFRef> {
  const context = doc.context;
  const fonts: PDFRef[] = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) if (object instanceof PDFDict && look(context, object.get(TYPE)) === FONT) fonts.push(ref);
  return fonts.length > 0 ? reachable(context, fonts) : new Set();
}

/** What a rebuild round can do about a hit (see `checkHits`). */
export type HitRemedy = 'boxes' | 'find' | 'flatten' | 'none';
/** Why no rebuild removes a hit: it belongs to no page ('document'), to the form's own resources ('form'), to a rebuilt page outside its text layer, to the raw bytes, or the file is encrypted. */
export type HitRefusal = 'document' | 'form' | 'rebuilt-page' | 'bytes' | 'encrypted';

function remedyOf(hit: Omit<CheckHit, 'remedy' | 'refusal'>, pictures: ReadonlySet<number>): { remedy: HitRemedy; refusal?: HitRefusal } {
  if (hit.pages.length === 0) return { remedy: 'none', refusal: hit.part === 'bytes' ? 'bytes' : hit.elsewhere.includes('form') ? 'form' : 'document' };
  if (hit.pages.some((page) => pictures.has(page))) return hit.part === 'text layer' && hit.boxes ? { remedy: 'boxes' } : { remedy: 'none', refusal: 'rebuilt-page' };
  if (hit.boxes) return { remedy: 'boxes' };
  return { remedy: hit.drawn ? 'find' : 'flatten' };
}

/**
 * The pages whose hits have no boxes, for the dialog: `drawn` when one of them is painted, so the
 * page must be boxed by the find (or the result is not verified); otherwise the user may flatten it.
 */
export function unboxedPages(hits: readonly CheckHit[]): { page: number; drawn: boolean }[] {
  const pages = new Map<number, boolean>();
  for (const hit of hits) {
    if (hit.remedy !== 'find' && hit.remedy !== 'flatten') continue;
    for (const page of hit.pages) pages.set(page, (pages.get(page) ?? false) || hit.remedy === 'find');
  }
  return [...pages].sort((a, b) => a[0] - b[0]).map(([page, drawn]) => ({ page, drawn }));
}

/**
 * Stop and progress for a check (fix round 1, low 8, and the run lane's request). The signal is read
 * at every step. `onProgress` is awaited: it is called at most every PACE_MS of work, and once more at
 * the end with done === total; `done` never goes down and may repeat. To keep a window live and Stop
 * working, it should return a promise that resolves after the event loop has had a turn (a frame or a
 * timer). It stops the run by throwing or rejecting; the run then keeps nothing.
 */
export interface CheckOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

function stopIfAsked(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error || signal.reason instanceof DOMException ? signal.reason : new DOMException('The check was stopped.', 'AbortError');
}

/** The longest stretch of work between two progress calls, when the caller gives a callback. */
const PACE_MS = 50;

/**
 * Reads Stop at every step and calls the progress callback when PACE_MS have passed since the last
 * call (or when forced). `step` gives back a promise only when there is something to wait for, so a
 * run without a callback pays nothing: `const wait = pacer.step(...); if (wait) await wait;`.
 */
class Pacer {
  private last = performance.now();
  constructor(private readonly options: CheckOptions) {}

  get paced(): boolean {
    return this.options.onProgress !== undefined;
  }

  step(done: number, total: number, force = false): Promise<void> | undefined {
    stopIfAsked(this.options.signal);
    const { onProgress } = this.options;
    if (!onProgress || (!force && performance.now() - this.last < PACE_MS)) return undefined;
    return this.call(onProgress, done, total);
  }

  private async call(onProgress: NonNullable<CheckOptions['onProgress']>, done: number, total: number): Promise<void> {
    await onProgress(done, total);
    this.last = performance.now();
    stopIfAsked(this.options.signal);
  }
}

/**
 * Every object of the file that holds a target, located: to the pages (zero-based) it belongs to,
 * else to a named place of the document, with its object number and key; whether it is drawn (painted
 * on the page: a string a content, form or appearance stream shows, a painted annotation text, or a
 * font's own text); `boxes` where the file itself gives a position (the words of a rebuilt page's text
 * layer; an annotation's or a field's rectangle, also for a hit in what the annotation's appearance
 * draws); and what a round can do (`remedy`):
 * - 'boxes': rebuild its pages with those boxes;
 * - 'find': drawn, but the file gives no position (page content, fonts): the find must place boxes by
 *   position; if it cannot, the result is not verified;
 * - 'flatten': not drawn and without boxes: rebuilding the page as drawn removes it (on the user's
 *   confirmation, RebuiltPage reason 'flattened');
 * - 'none': no rebuild removes it (`refusal` says why): the result is not verified.
 * `picturePages` are the rebuilt pages, whose own pictures are not searched. Nothing in a hit is text
 * of the file. An encrypted file cannot be read, so it counts as holding a target.
 */
export async function checkHits(file: Uint8Array, targets: readonly CheckTarget[], picturePages: ReadonlySet<number>, options: CheckOptions = {}): Promise<CheckHit[]> {
  const { rules, unicode, needles } = compile(targets);
  if (rules.length === 0) return [];
  const anywhere = compile(targets.map((t) => ({ ...t, wholeWord: false }))).rules;
  const pacer = new Pacer(options);
  let wait = pacer.step(0, 1);
  if (wait) await wait;
  const doc = await loadForCheck(file, pacer.paced);
  if (doc.isEncrypted) {
    wait = pacer.step(1, 1, true);
    if (wait) await wait;
    return [{ pass: 'strict', pages: [], elsewhere: ['other'], part: 'object', object: 'trailer', key: 'other', drawn: false, remedy: 'none', refusal: 'encrypted' }];
  }
  const context = doc.context;
  const pictures = pictureStreams(doc, picturePages);
  const sink: Sink = { unicode, take: (text, addresses) => passOfReadings(rules, text, addresses), needles };
  const skip = (stream: PDFRawStream) => pictures.has(stream);
  const found = new Map<PDFRef, Found & { boxes?: { page: number; rect: Rect }[] }>();
  const objects = context.enumerateIndirectObjects();
  const roles = contentRoles(doc, picturePages);
  // Progress: one step per object, one per rebuilt page's text layer, one for the rest. A first call
  // once the file is read: reading it is one long step.
  const total = objects.length + roles.layer.size + 1;
  wait = pacer.step(0, total, true);
  if (wait) await wait;
  for (const [i, [ref, object]] of objects.entries()) {
    wait = pacer.step(i, total);
    if (wait) await wait;
    const hit = await scanObject(context, object, sink, skip, () => pacer.step(i, total));
    if (hit) found.set(ref, hit);
  }
  // A rebuilt page's text layer: which words hold a target, alone or read together, and where they are.
  const pageRefs = pageRefsOf(doc);
  let done = objects.length;
  for (const [index, owner] of roles.layer) {
    wait = pacer.step(done++, total);
    if (wait) await wait;
    const page = context.lookup(pageRefs[index]);
    if (!(page instanceof PDFDict)) continue;
    const items = layerItems(context, page);
    const hit = layerHit(items, rules, anywhere);
    if (!hit) continue;
    const known = found.get(owner);
    found.set(owner, { pass: stronger(known?.pass ?? null, hit.pass) ?? hit.pass, key: known?.key ?? 'stream', drawn: true, boxes: hit.words.map((i) => ({ page: index, rect: items[i].rect })) });
  }
  const hits: CheckHit[] = [];
  const trailer = trailerParts(doc);
  const infoHit = trailer.info !== undefined ? await scanObject(context, trailer.info, sink, skip, () => pacer.step(done, total)) : null;
  if (infoHit) hits.push({ pass: infoHit.pass, pages: [], elsewhere: ['document properties'], part: 'properties', object: 'trailer', key: infoHit.key, drawn: false, remedy: 'none', refusal: 'document' });
  for (const object of trailer.other) {
    const hit = await scanObject(context, object, sink, skip, () => pacer.step(done, total));
    if (hit) hits.push({ pass: hit.pass, pages: [], elsewhere: ['other'], part: 'object', object: 'trailer', key: hit.key, drawn: false, remedy: 'none', refusal: 'document' });
  }
  // The byte reading counts only when the object reading found nothing: what it explains is found
  // again by the byte reading of the next round, once the pages it named are rebuilt.
  wait = pacer.step(done, total);
  if (wait) await wait;
  if (found.size === 0 && hits.length === 0) {
    const pass = await scanBytes(file, doc, sink, () => pacer.step(done, total));
    if (pass) hits.push({ pass, pages: [], elsewhere: ['other'], part: 'bytes', object: 'bytes', key: 'other', drawn: false, remedy: 'none', refusal: 'bytes' });
  }
  if (found.size > 0) {
    const refs = new Set(found.keys());
    const pagesByRef = pagesOf(doc, refs);
    wait = pacer.step(done, total);
    if (wait) await wait;
    // A structure element whose alternative text holds a target speaks for marked content on its pages
    // (fix wave 2, R6): located there, with the MCIDs, instead of to no page.
    const structural = new Map<PDFRef, { page: number; mcids: number[] }[]>();
    const pageIndexOf = new Map(pageRefsOf(doc).map((r, i) => [r, i] as const));
    for (const alt of structureAlts(doc)) {
      if (!alt.holder || !found.has(alt.holder) || pagesByRef.has(alt.holder) || passOfReadings(rules, alt.text, true) === null) continue;
      const list = structural.get(alt.holder) ?? [];
      for (const [pg, mcids] of alt.marks) {
        const page = pageIndexOf.get(pg);
        if (page !== undefined) list.push({ page, mcids: [...mcids] });
      }
      if (list.length > 0) structural.set(alt.holder, list);
    }
    const placesByRef = placesOf(doc, new Set([...refs].filter((ref) => !pagesByRef.has(ref) && !structural.has(ref))));
    const layers = new Set(roles.layer.values());
    const pageOfAnnotation = annotationPages(doc);
    wait = pacer.step(done, total);
    if (wait) await wait;
    const owners = appearanceOwners(doc);
    wait = pacer.step(done, total);
    if (wait) await wait;
    const fonts = fontObjects(doc);
    const picturePageSet = new Set(roles.layer.keys());
    for (const [ref, hit] of found) {
      wait = pacer.step(done, total);
      if (wait) await wait;
      const marked = structural.get(ref);
      const pages = pagesByRef.get(ref) ?? (marked ? [...new Set(marked.map((m) => m.page))].sort((a, b) => a - b) : []);
      const elsewhere = pages.length > 0 ? [] : placesByRef.get(ref) ?? ['other'];
      const drawers = layers.has(ref) ? undefined : owners.get(ref);
      const object = context.lookup(ref);
      const part: HitPart = marked ? 'properties' : drawers ? partOf(context, ref, drawers[0].annotation, layers, roles.content, pages, elsewhere) : partOf(context, ref, object, layers, roles.content, pages, elsewhere);
      const boxes =
        hit.boxes ??
        (drawers
          ? uniqueBoxes(drawers.flatMap((d) => annotationBoxes(context, d.annotation, pageOfAnnotation, d.entry)))
          : (part === 'annotation' || part === 'field') && pages.length > 0
            ? annotationBoxes(context, object, pageOfAnnotation, ref)
            : []);
      const located = { pass: hit.pass, pages, elsewhere, part, object: `${ref.objectNumber} ${ref.generationNumber} R`, key: hit.key, drawn: hit.drawn || fonts.has(ref), ...(boxes.length > 0 ? { boxes } : {}), ...(marked ? { marked } : {}) };
      hits.push({ ...located, ...remedyOf(located, picturePageSet) });
    }
  }
  wait = pacer.step(total, total, true);
  if (wait) await wait;
  const first = (hit: CheckHit) => (hit.pages.length > 0 ? hit.pages[0] : Number.MAX_SAFE_INTEGER);
  const number = (hit: CheckHit) => Number.parseInt(hit.object, 10) || 0;
  return hits.sort((a, b) => first(a) - first(b) || number(a) - number(b));
}

/**
 * Where the targets are found in the file: the pages (zero-based) whose objects hold one, and named
 * places for the rest (a summary of `checkHits`).
 */
export async function findTargets(file: Uint8Array, targets: readonly CheckTarget[], picturePages: ReadonlySet<number>, options: CheckOptions = {}): Promise<CheckFinding> {
  const pages = new Set<number>();
  const places = new Set<string>();
  for (const hit of await checkHits(file, targets, picturePages, options)) {
    hit.pages.forEach((page) => pages.add(page));
    hit.elsewhere.forEach((place) => places.add(place));
  }
  return { pages: [...pages].sort((a, b) => a - b), elsewhere: ELSEWHERE_ORDER.filter((place) => places.has(place)) };
}

// ---- structure of the rebuilt pages --------------------------------------------------------------

/** Entries a rebuilt page may have (redactBuild.ts REBUILT_PAGE_KEYS). */
const PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'Rotate', 'UserUnit', 'Resources', 'Contents']);
/** Page entries named in a problem; any other name is not repeated (it could be anything). */
const KNOWN_PAGE_KEYS = new Set([
  'Annots', 'AA', 'Metadata', 'PieceInfo', 'Thumb', 'Group', 'B', 'StructParents', 'Tabs', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox',
  'BoxColorInfo', 'Dur', 'Trans', 'PZ', 'SeparationInfo', 'ID', 'VP', 'LastModified', 'OutputIntents', 'AF', 'DPart', 'TemplateInstantiated', 'PresSteps',
]);
const IMAGE_KEYS = new Set(['Type', 'Subtype', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent', 'Filter', 'Length']);
const FONT_KEYS = new Set(['Type', 'Subtype', 'BaseFont', 'Encoding']);
const CONTENT_KEYS = new Set(['Length', 'Filter']);
const OPERATORS = new Set(['q', 'Q', 'cm', 'Do', 'BT', 'ET', 'Tr', 'Tf', 'Tz', 'Tm', 'Tj']);

type Operand = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'string'; bytes: number[] } | { kind: 'other' };

/** A content stream as operators with their operands (arrays, dictionaries and odd tokens as 'other'). */
function operations(text: string): { op: string; operands: Operand[] }[] {
  const ops: { op: string; operands: Operand[] }[] = [];
  let operands: Operand[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (isWhite(c)) i += 1;
    else if (c === 0x25) {
      while (i < n && text.charCodeAt(i) !== 0x0a && text.charCodeAt(i) !== 0x0d) i++;
    } else if (c === 0x28) {
      const literal = readLiteral(text, i);
      operands.push({ kind: 'string', bytes: literal.bytes });
      i = literal.end;
    } else if (c === 0x3c && text.charCodeAt(i + 1) !== 0x3c) {
      const hexString = readHex(text, i);
      operands.push({ kind: 'string', bytes: hexString.bytes });
      i = hexString.end;
    } else if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
      operands.push({ kind: 'name', value: decodeNameText(text.slice(i + 1, j)) });
      i = j;
    } else if (isDelimiter(c)) {
      operands.push({ kind: 'other' });
      i += c === 0x3c || c === 0x3e ? 2 : 1;
    } else {
      let j = i + 1;
      while (j < n && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
      const word = text.slice(i, j);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) operands.push({ kind: 'number', value: Number(word) });
      else {
        ops.push({ op: word, operands });
        operands = [];
      }
      i = j;
    }
  }
  if (operands.length > 0) ops.push({ op: '', operands });
  return ops;
}

function contentProblems(context: PDFContext, page: PDFDict, say: (what: string) => void): void {
  const contents = look(context, page.get(CONTENTS));
  const streams = contents instanceof PDFArray ? contents.asArray().map((entry) => look(context, entry)) : [contents];
  let text = '';
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) return say('has content that cannot be read.');
    const keys = stream.dict.keys().map((key) => key.decodeText());
    const filter = look(context, stream.dict.get(FILTER));
    if (keys.some((key) => !CONTENT_KEYS.has(key)) || (filter !== undefined && filter !== FLATE)) return say('has content that cannot be read.');
    try {
      text += `${latin1(filter === undefined ? stream.contents : decodePDFRawStream(stream).decode())}\n`;
    } catch {
      return say('has content that cannot be read.');
    }
  }
  let draws = 0;
  let inText = false;
  let mode = 0;
  const saved: number[] = [];
  const isNumbers = (operands: Operand[], count: number) => operands.length === count && operands.every((o) => o.kind === 'number');
  for (const { op, operands } of operations(text)) {
    if (!OPERATORS.has(op) || operands.some((o) => o.kind === 'other')) {
      say('draws more than its picture and invisible text.');
      continue;
    }
    if (op === 'q') saved.push(mode);
    else if (op === 'Q') mode = saved.pop() ?? mode;
    else if (op === 'BT') inText = true;
    else if (op === 'ET') inText = false;
    else if (op === 'Do') {
      if (operands.length === 1 && operands[0].kind === 'name' && operands[0].value === 'Im0') draws += 1;
      else say('draws more than its picture and invisible text.');
    } else if (op === 'Tf') {
      if (!(operands.length === 2 && operands[0].kind === 'name' && operands[0].value === 'Fh' && operands[1].kind === 'number')) say('draws more than its picture and invisible text.');
    } else if (op === 'Tr') {
      if (isNumbers(operands, 1)) mode = (operands[0] as { value: number }).value;
      if (mode !== 3) say('shows text that is not invisible.');
    } else if (op === 'Tj') {
      if (operands.length !== 1 || operands[0].kind !== 'string' || !inText) say('draws more than its picture and invisible text.');
      else if (mode !== 3) say('shows text that is not invisible.');
    } else if ((op === 'cm' || op === 'Tm') && !isNumbers(operands, 6)) say('draws more than its picture and invisible text.');
    else if (op === 'Tz' && !isNumbers(operands, 1)) say('draws more than its picture and invisible text.');
  }
  if (draws !== 1) say('does not draw its picture exactly once.');
}

function resourceProblems(context: PDFContext, page: PDFDict, say: (what: string) => void): void {
  const resources = look(context, page.get(RESOURCES));
  if (!(resources instanceof PDFDict)) return say('has no picture.');
  const categories = resources.keys().map((key) => key.decodeText());
  const xobjects = look(context, resources.get(XOBJECT));
  const fonts = look(context, resources.get(FONT));
  const only = (dict: PDFObject | undefined, key: string) => dict instanceof PDFDict && dict.keys().length === 1 && dict.has(name(key));
  if (categories.some((key) => key !== 'XObject' && key !== 'Font') || !only(xobjects, 'Im0') || (fonts !== undefined && !only(fonts, 'Fh'))) {
    say('has resources other than its picture and the text font.');
  }
  const picture = xobjects instanceof PDFDict ? look(context, xobjects.get(PICTURE)) : undefined;
  const plainImage =
    picture instanceof PDFRawStream &&
    picture.dict.keys().every((key) => IMAGE_KEYS.has(key.decodeText())) &&
    look(context, picture.dict.get(SUBTYPE)) === IMAGE &&
    [name('DeviceGray'), name('DeviceRGB')].includes(look(context, picture.dict.get(name('ColorSpace'))) as PDFName) &&
    [FLATE, name('DCTDecode')].includes(look(context, picture.dict.get(FILTER)) as PDFName) &&
    numberOf(context, picture.dict.get(name('BitsPerComponent')), 0) === 8 &&
    Number.isInteger(numberOf(context, picture.dict.get(name('Width')), 0)) &&
    numberOf(context, picture.dict.get(name('Width')), 0) > 0 &&
    Number.isInteger(numberOf(context, picture.dict.get(name('Height')), 0)) &&
    numberOf(context, picture.dict.get(name('Height')), 0) > 0;
  if (!plainImage) say('has a picture that is not a plain image.');
  if (fonts instanceof PDFDict) {
    const font = look(context, fonts.get(TEXT_FONT));
    const standard =
      font instanceof PDFDict &&
      font.keys().every((key) => FONT_KEYS.has(key.decodeText())) &&
      look(context, font.get(TYPE)) === FONT &&
      look(context, font.get(SUBTYPE)) === name('Type1') &&
      look(context, font.get(name('BaseFont'))) === name('Helvetica') &&
      look(context, font.get(name('Encoding'))) === name('WinAnsiEncoding');
    if (!standard) say('has a text font other than the standard Helvetica.');
  }
}

/**
 * What is wrong with the rebuilt pages (zero-based indices): each must hold only its picture, its
 * invisible text layer and the standard Helvetica font, with no comments, actions or metadata.
 * Each problem is a sentence starting "Page n"; none repeats anything written in the file. Stop and
 * progress as for `checkHits` (one step per rebuilt page, one for the document-wide reading).
 */
export async function structureProblems(file: Uint8Array, rebuiltPages: readonly number[], options: CheckOptions = {}): Promise<string[]> {
  const pacer = new Pacer(options);
  let wait = pacer.step(0, 1);
  if (wait) await wait;
  const doc = await loadForCheck(file, pacer.paced);
  const context = doc.context;
  const problems: string[] = [];
  let pages: ReturnType<PDFDocument['getPages']> = [];
  try {
    pages = doc.getPages();
  } catch {
    return ['Page 1 cannot be read: the file has no page tree that can be read.'];
  }
  const indices = [...new Set(rebuiltPages)].sort((a, b) => a - b);
  const total = indices.length + 1;
  wait = pacer.step(0, total, true);
  if (wait) await wait;
  for (const [k, index] of indices.entries()) {
    wait = pacer.step(k, total);
    if (wait) await wait;
    const said = new Set<string>();
    const say = (what: string) => void said.add(`Page ${index + 1} ${what}`);
    const page = pages[index]?.node;
    if (!page) {
      problems.push(`Page ${index + 1} is not in the file.`);
      continue;
    }
    for (const key of page.keys()) {
      const text = key.decodeText();
      if (PAGE_KEYS.has(text)) continue;
      say(`has ${KNOWN_PAGE_KEYS.has(text) ? `/${text}` : 'an entry'}, which a rebuilt page must not have.`);
    }
    const box = look(context, page.get(MEDIA_BOX));
    const numbers = box instanceof PDFArray ? box.asArray().map((v) => look(context, v)) : [];
    const valid = numbers.length === 4 && numbers.every((v) => v instanceof PDFNumber && Number.isFinite(v.asNumber()));
    const [x0, y0, x1, y1] = valid ? numbers.map((v) => (v as PDFNumber).asNumber()) : [0, 0, 0, 0];
    if (!valid || x1 === x0 || y1 === y0) say('has no valid page size.');
    const rotate = look(context, page.get(ROTATE));
    if (rotate !== undefined && !(rotate instanceof PDFNumber && rotate.asNumber() % 90 === 0)) say('has a turn that is not a multiple of 90 degrees.');
    const unit = look(context, page.get(USER_UNIT));
    if (unit !== undefined && !(unit instanceof PDFNumber && unit.asNumber() > 0)) say('has a page unit that is not a positive number.');
    resourceProblems(context, page, say);
    contentProblems(context, page, say);
    problems.push(...said);
  }
  wait = pacer.step(indices.length, total);
  if (wait) await wait;
  problems.push(...documentProblems(doc));
  wait = pacer.step(total, total, true);
  if (wait) await wait;
  return problems;
}

/** Document-wide things a redacted file must not hold, in fixed words: none can be checked, so their presence is a fault (fix round 1). */
const ABSENT = {
  files: 'The file holds attached files, which a redacted file must not hold.',
  scripts: 'The file holds scripts or actions other than going to a page or a web address, which a redacted file must not hold.',
  addresses: 'The file holds web addresses other than http, https or mailto, which a redacted file must not hold.',
  metadata: 'The file holds metadata (XMP), which a redacted file must not hold.',
  privateData: 'The file holds private application data or thumbnails, which a redacted file must not hold.',
  document: 'The file holds document-level names, scripts, page labels or structure, which a redacted file must not hold.',
} as const;

function documentProblems(doc: PDFDocument): string[] {
  const context = doc.context;
  const found = new Set<string>();
  const catalog = doc.catalog;
  if (['Names', 'OpenAction', 'AA', 'PageLabels', 'StructTreeRoot', 'Dests'].some((key) => catalog.has(name(key)))) found.add(ABSENT.document);
  const visit = (dict: PDFDict) => {
    if (dict.has(name('AF')) || dict.has(name('EF')) || dict.has(name('RF')) || look(context, dict.get(TYPE)) === name('EmbeddedFile')) found.add(ABSENT.files);
    if (dict.has(name('FS')) && dict.has(SUBTYPE)) found.add(ABSENT.files);
    if (look(context, dict.get(SUBTYPE)) === name('FileAttachment')) found.add(ABSENT.files);
    if (dict.has(name('Metadata'))) found.add(ABSENT.metadata);
    if (dict.has(name('PieceInfo')) || dict.has(name('Thumb'))) found.add(ABSENT.privateData);
    if (dict.has(name('AA'))) found.add(ABSENT.scripts);
    for (const slot of ['A', 'PA', 'OpenAction', 'Next']) {
      const action = look(context, dict.get(name(slot)));
      const type = action instanceof PDFDict ? look(context, action.get(name('S'))) : undefined;
      if (!(action instanceof PDFDict) || !(type instanceof PDFName)) continue; // an outline item's /Next is not an action
      if (type !== name('GoTo') && type !== name('URI')) found.add(ABSENT.scripts);
      const uri = look(context, action.get(name('URI')));
      if (type === name('URI') && (uri instanceof PDFString || uri instanceof PDFHexString)) {
        const scheme = /^\s*([A-Za-z][A-Za-z0-9+.-]*):/.exec(textOfString(uri instanceof PDFHexString ? hexBytes(uri.asString()) : uri.asBytes()))?.[1].toLowerCase();
        if (scheme !== undefined && scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') found.add(ABSENT.addresses);
      }
    }
  };
  for (const [, object] of context.enumerateIndirectObjects()) {
    const stack: PDFObject[] = [object];
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (item instanceof PDFDict) {
        visit(item);
        stack.push(...item.values());
      } else if (item instanceof PDFStream) {
        visit(item.dict);
        stack.push(...item.dict.values());
      } else if (item instanceof PDFArray) stack.push(...item.asArray());
    }
  }
  return Object.values(ABSENT).filter((sentence) => found.has(sentence));
}

// ---- drawings: what paints on a page besides ordinary page text (fix wave 2, rulings 1, 2, 5) ---------
//
// rx2-contract.md (b). The find reads a page's text with pdf.js; anything else that paints (an
// annotation's appearance, each instance; a form XObject; a tiling pattern; a Type 3 glyph procedure that
// writes text or draws; text in a font whose map cannot be trusted; alternative text) is read here, one
// drawing at a time, as joined text (in drawing order, across lines), or reported unreadable with a
// reason. Where this reader is less sure than the renderer it says so; it never says "no text".

/** What kind of drawing (rx2-contract.md (b)). */
export type DrawingKind = 'appearance' | 'form' | 'pattern' | 'glyph' | 'content' | 'alt';
/** Why a drawing could not be read for certain. */
export type UnreadableReason = 'filter' | 'parse' | 'font' | 'type3' | 'depth';

export interface DrawingSource {
  /** 'n g R' of the stream that draws it ('direct' if not indirect). Never a name from the file. */
  stream: string;
  /** appearance: its annotation (index in the page's /Annots, 'n g R' or 'direct') and the annotation's /Rect. */
  annotation?: { index: number; object: string; rect: Rect };
  /** glyph: 'n g R' of the Type 3 font. */
  font?: string;
  /** Offsets [start, end) in the stream's decoded data (byte for byte as Latin-1) of every string operand it shows. */
  strings: LoosePlace[];
  /** alt: the marked-content spans [BDC .. EMC] in the decoded data of `stream`. */
  spans?: LoosePlace[];
  /** alt: their marked-content ids. */
  mcids?: number[];
  /** Ids of the drawings this one is drawn inside, outermost first. */
  within: string[];
}

export interface PageDrawing {
  /** Unique within one call: `p<page>-<kind>-<n>`. */
  id: string;
  /** 0-based page. */
  page: number;
  kind: DrawingKind;
  source: DrawingSource;
  /** Readable: every string shown, decoded, in drawing order; joined with nothing, and with spaces and line breaks. */
  text?: { joined: string; spaced: string };
  /** Not readable for certain: why (box where this instance paints, or ask, or stop). */
  unreadable?: UnreadableReason;
}

const DRAW_DEPTH = 32;
const READABLE_FILTERS = new Set(['FlateDecode', 'LZWDecode', 'ASCIIHexDecode', 'ASCII85Decode', 'RunLengthDecode']);
const LINE_BREAK = String.fromCharCode(10);
const refText = (value: PDFObject | undefined) => (value instanceof PDFRef ? `${value.objectNumber} ${value.generationNumber} R` : 'direct');
const nameOf = (context: PDFContext, value: PDFObject | undefined) => {
  const v = look(context, value);
  return v instanceof PDFName ? v.decodeText() : undefined;
};

/**
 * Object numbers the reader cannot trust to be the renderer's object (ruling 2): defined twice within one
 * saved revision (between two %%EOF marks), or defined after the last %%EOF (no table points at it; pdf-lib
 * keeps the last copy, pdf.js the table's). Stream bodies are skipped (an embedded file may hold "1 0 obj").
 */
function suspectObjects(file: Uint8Array): Set<number> {
  const bodies: [number, number][] = [];
  for (const body of streamBodies(file)) bodies.push([body.start, body.end]);
  const inBody = (at: number) => bodies.some(([s, e]) => at >= s && at < e);
  const eofs: number[] = [];
  for (let at = indexOfBytes(file, '%%EOF', 0); at >= 0; at = indexOfBytes(file, '%%EOF', at + 5)) if (!inBody(at)) eofs.push(at);
  const seen = new Map<string, number>();
  const suspects = new Set<number>();
  for (let at = indexOfBytes(file, 'obj', 0); at >= 0; at = indexOfBytes(file, 'obj', at + 3)) {
    if (inBody(at) || !isWhite(file[at - 1] ?? 0)) continue;
    const next = file[at + 3];
    if (next !== undefined && !isWhite(next) && !isDelimiter(next)) continue;
    let k = at - 1;
    while (k >= 0 && isWhite(file[k])) k--;
    const genEnd = k + 1;
    while (k >= 0 && file[k] >= 0x30 && file[k] <= 0x39) k--;
    if (k + 1 === genEnd) continue;
    while (k >= 0 && isWhite(file[k])) k--;
    const numEnd = k + 1;
    while (k >= 0 && file[k] >= 0x30 && file[k] <= 0x39) k--;
    if (k + 1 === numEnd) continue;
    const number = Number(latin1(file.subarray(k + 1, numEnd)));
    const revision = eofs.filter((e) => e < at).length;
    if (eofs.length > 0 && revision === eofs.length) suspects.add(number);
    const key = `${number}:${revision}`;
    if (seen.has(key)) suspects.add(number);
    seen.set(key, at);
  }
  return suspects;
}

/** A stream's data decoded as the renderer would, or why that is not certain (an object that did not parse, a filter not applied exactly). */
function strictData(context: PDFContext, value: PDFObject | undefined, suspects: ReadonlySet<number>): { data?: Uint8Array; unreadable?: UnreadableReason } {
  if (value instanceof PDFRef && suspects.has(value.objectNumber)) return { unreadable: 'parse' };
  const stream = look(context, value);
  if (stream === undefined || stream instanceof PDFInvalidObject) return { unreadable: 'parse' };
  if (!(stream instanceof PDFStream)) return { unreadable: 'parse' };
  if (stream.dict.values().some((v) => v instanceof PDFInvalidObject)) return { unreadable: 'parse' };
  if (!(stream instanceof PDFRawStream)) {
    try {
      return { data: stream.getContents() };
    } catch {
      return { unreadable: 'filter' };
    }
  }
  if (stream.dict.has(EXTERNAL)) return { unreadable: 'filter' };
  const filter = look(context, stream.dict.get(FILTER));
  if (filter === undefined) return { data: stream.contents };
  const filters = filter instanceof PDFName ? [filter] : filter instanceof PDFArray ? filter.asArray().map((f) => look(context, f)) : [undefined];
  const parmsValue = look(context, stream.dict.get(DECODE_PARMS));
  const parmsList = parmsValue instanceof PDFArray ? parmsValue.asArray().map((p) => look(context, p)) : [parmsValue];
  let data = stream.contents;
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    if (!(f instanceof PDFName) || !READABLE_FILTERS.has(f.decodeText())) return { unreadable: 'filter' };
    const parms = parmsList[i];
    const decoded = decodeOne(context, f, parms instanceof PDFDict ? parms : undefined, data);
    if (decoded === null) return { unreadable: 'filter' };
    data = decoded;
  }
  return { data };
}

// -- fonts --

const GLYPH_CHARS: Readonly<Record<string, string>> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')',
  asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: String.fromCharCode(92), bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  quoteright: String.fromCharCode(0x2019), quoteleft: String.fromCharCode(0x2018), quotedblleft: String.fromCharCode(0x201c), quotedblright: String.fromCharCode(0x201d),
  endash: String.fromCharCode(0x2013), emdash: String.fromCharCode(0x2014), bullet: String.fromCharCode(0x2022), periodcentered: String.fromCharCode(0xb7),
  fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', nbspace: String.fromCharCode(0xa0), Euro: String.fromCharCode(0x20ac),
};

/** The character a glyph name stands for (AGL: single letters, digit and punctuation names, uniXXXX, uXXXX, ligatures with _ and suffixes after a dot), else undefined. */
function glyphChar(glyphName: string): string | undefined {
  const base = glyphName.split('.')[0];
  if (base === '') return undefined;
  if (base.includes('_')) {
    const parts = base.split('_').map(glyphChar);
    return parts.every((p) => p !== undefined) ? parts.join('') : undefined;
  }
  if (/^[A-Za-z]$/.test(base)) return base;
  if (Object.prototype.hasOwnProperty.call(GLYPH_CHARS, base)) return GLYPH_CHARS[base];
  const uni = /^uni((?:[0-9A-F]{4})+)$/.exec(base);
  if (uni) return String.fromCharCode(...(uni[1].match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  const u = /^u([0-9A-F]{4,6})$/.exec(base);
  if (u) {
    const cp = parseInt(u[1], 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : undefined;
  }
  return undefined;
}

/** What a composite font's map gives a glyph that carries no letter of its own (U+0000). */
const NO_LETTER = '\u0000';
/** A letter or mark of a script other than Latin (Devanagari, Tamil, Arabic, ...). */
const OTHER_SCRIPT = /^(?![\p{Script=Latin}\p{Script=Common}])[\p{L}\p{M}]$/u;

/**
 * Fix wave 4 (RX-RUN's K1 note): whether every U+0000 in a shown string is a part of a letter cluster of a script
 * other than Latin: Chrome writes an Indian-script cluster's letters on its first glyph and maps the cluster's other
 * glyphs to U+0000 (pdf.js extracts them as U+0000 too). Such a glyph is read as no letter when what stands beside it
 * (skipping other such glyphs; `before`: the end of the text shown before) is no Latin letter and no digit, and at
 * least one side is a letter or mark of another script. Anything else (a U+0000 beside a Latin letter or a digit,
 * or with nothing beside it) keeps the string unreadable: such a glyph could hide a letter of a value.
 */
function clusterPartsOnly(text: string, before: string): boolean {
  const chars = [...text];
  const nearest = (k: number, step: number): string | undefined => {
    for (let j = k + step; j >= 0 && j < chars.length; j += step) if (chars[j] !== NO_LETTER) return chars[j];
    return step < 0 ? ([...before].pop() ?? undefined) : undefined;
  };
  return chars.every((c, k) => {
    if (c !== NO_LETTER) return true;
    const sides = [nearest(k, -1), nearest(k, 1)];
    if (sides.some((s) => s !== undefined && /[\p{Script=Latin}\p{Nd}]/u.test(s))) return false;
    return sides.some((s) => s !== undefined && OTHER_SCRIPT.test(s));
  });
}

/** A character a reader takes for nothing: private use, a control (not white space), the replacement character. */
function unusable(text: string): boolean {
  if (text === '') return true;
  for (const c of text) {
    const cp = c.codePointAt(0) ?? 0;
    if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000 || cp === 0xfffd || (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13)) return true;
  }
  return false;
}
const sameText = (a: string, b: string) => a.normalize('NFKC') === b.normalize('NFKC');

interface CodeMap {
  /** Codespace ranges: byte length and bounds. */
  ranges: { length: number; lo: number; hi: number }[];
  map: Map<number, string>;
}

const hexToBytes = (hex: string) => (hex.replace(/[^0-9A-Fa-f]/g, '').match(/.{1,2}/g) ?? []).map((h) => parseInt(h.padEnd(2, '0'), 16));
const bytesToCode = (bytes: number[]) => bytes.reduce((n, b) => n * 256 + b, 0);
const utf16Text = (bytes: number[]) => {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return out;
};

/** A ToUnicode CMap: codespace ranges, bfchar and bfrange. 'bad' when it cannot be read for certain; null when absent. */
function toUnicodeOf(context: PDFContext, value: PDFObject | undefined, suspects: ReadonlySet<number>): CodeMap | 'bad' | null {
  if (value === undefined) return null;
  const { data } = strictData(context, value, suspects);
  if (!data) return 'bad';
  const text = latin1(data);
  const ranges: CodeMap['ranges'] = [];
  const map = new Map<number, string>();
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const hexes = [...block[1].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((m) => m[1].replace(/\s+/g, ''));
    for (let i = 0; i + 1 < hexes.length; i += 2) ranges.push({ length: Math.ceil(hexes[i].length / 2), lo: parseInt(hexes[i] || '0', 16), hi: parseInt(hexes[i + 1] || '0', 16) });
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const hexes = [...block[1].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((m) => m[1]);
    for (let i = 0; i + 1 < hexes.length; i += 2) map.set(bytesToCode(hexToBytes(hexes[i])), utf16Text(hexToBytes(hexes[i + 1])));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    const re = /<([0-9A-Fa-f\s]*)>\s*<([0-9A-Fa-f\s]*)>\s*(?:<([0-9A-Fa-f\s]*)>|\[([^\]]*)\])/g;
    for (const m of body.matchAll(re)) {
      const lo = bytesToCode(hexToBytes(m[1]));
      const hi = bytesToCode(hexToBytes(m[2]));
      if (hi < lo || hi - lo > 65_535) return 'bad';
      if (m[3] !== undefined) {
        const dst = hexToBytes(m[3]);
        for (let code = lo; code <= hi; code++) {
          const shifted = [...dst];
          let add = code - lo;
          for (let k = shifted.length - 1; k >= 0 && add > 0; k--) {
            const sum = shifted[k] + add;
            shifted[k] = sum & 0xff;
            add = sum >> 8;
          }
          map.set(code, utf16Text(shifted));
        }
      } else {
        const list = [...(m[4] ?? '').matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((x) => utf16Text(hexToBytes(x[1])));
        list.forEach((dst, k) => {
          if (lo + k <= hi) map.set(lo + k, dst);
        });
      }
    }
  }
  return { ranges, map };
}

/** How a font's strings read: `decode` gives the characters shown, or null when they cannot be told. */
interface FontReading {
  decode(bytes: Uint8Array): string | null;
  /** Its map says other characters than its glyph names or encoding show (set while decoding). */
  lying: boolean;
  /**
   * A shown code has a glyph name that is not a standard one (a suffix such as `Q.sc`, a name no list knows) and no
   * map entry: pdf.js invents a letter for it (fix wave 4, ruling N). Set while decoding.
   */
  invents?: boolean;
  /** Its letters are trusted without decoding (ruling M): a usable map, or a standard encoding with standard names only. */
  trusted?: boolean;
  /** A Type 3 font's dictionary (its glyph procedures draw). */
  type3?: PDFDict;
  /** 'n g R' of the font. */
  ref: string;
}

const WIN_ANSI_HIGH: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039,
  0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122,
  0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
/** The character a simple font's base encoding gives a code (WinAnsi, Standard, MacRoman read alike for ASCII), else undefined. */
function baseChar(base: string, code: number): string | undefined {
  if (code >= 0x20 && code <= 0x7e) {
    if (base === 'std' && code === 0x27) return String.fromCharCode(0x2019);
    if (base === 'std' && code === 0x60) return String.fromCharCode(0x2018);
    return String.fromCharCode(code);
  }
  if (base === 'win') {
    if (code >= 0xa0) return String.fromCharCode(code);
    const mapped = WIN_ANSI_HIGH[code];
    return mapped !== undefined ? String.fromCharCode(mapped) : undefined;
  }
  return undefined;
}

const STANDARD_FONTS_14 = /^(?:Times|Helvetica|Courier|Arial|TimesNewRoman)/;

const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** ASCII punctuation and the name the base encodings give it (WinAnsi and MacRoman; Standard differs at 0x27 and 0x60). */
const PUNCTUATION_NAMES = new Map(Object.entries(GLYPH_CHARS).filter(([, ch]) => ch.length === 1 && ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) < 0x7f && !/[0-9]/.test(ch) && ch !== '-').map(([glyph, ch]) => [ch.charCodeAt(0), glyph] as const));

/**
 * The glyph name a base encoding (WinAnsi, MacRoman, Standard; Standard when none is named) gives an ASCII
 * code: letters, digits, punctuation; undefined for any other code, which the reader does not name (fix
 * wave 3, finding 6: a Type 3 font's /Encoding may be a name).
 */
function baseGlyphName(encoding: string | undefined, code: number): string | undefined {
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return String.fromCharCode(code);
  if (code >= 0x30 && code <= 0x39) return DIGIT_NAMES[code - 0x30];
  if (code === 0x2d) return 'hyphen';
  const standard = encoding === undefined || encoding === 'StandardEncoding';
  if (standard && code === 0x27) return 'quoteright';
  if (standard && code === 0x60) return 'quoteleft';
  if (encoding !== undefined && encoding !== 'StandardEncoding' && encoding !== 'WinAnsiEncoding' && encoding !== 'MacRomanEncoding') return undefined;
  return PUNCTUATION_NAMES.get(code);
}

function fontReading(context: PDFContext, value: PDFObject | undefined, suspects: ReadonlySet<number>): FontReading {
  const ref = refText(value);
  const unreadable: FontReading = { decode: () => null, lying: false, ref, trusted: false };
  if (value instanceof PDFRef && suspects.has(value.objectNumber)) return unreadable;
  const font = look(context, value);
  if (!(font instanceof PDFDict)) return unreadable;
  const subtype = nameOf(context, font.get(SUBTYPE));
  const toUnicode = toUnicodeOf(context, font.get(name('ToUnicode')), suspects);
  if (toUnicode === 'bad') return unreadable;
  if (subtype === 'Type0') {
    if (!toUnicode) return unreadable;
    const ranges = toUnicode.ranges.length > 0 ? toUnicode.ranges : [{ length: 2, lo: 0, hi: 0xffff }];
    const lengths = [...new Set(ranges.map((r) => r.length))].sort((a, b) => a - b);
    const reading: FontReading = {
      ref,
      lying: false,
      trusted: true,
      decode(bytes) {
        let out = '';
        for (let i = 0; i < bytes.length; ) {
          let taken = 0;
          for (const length of lengths) {
            if (i + length > bytes.length) break;
            const code = bytesToCode(Array.from(bytes.subarray(i, i + length)));
            if (!ranges.some((r) => r.length === length && code >= r.lo && code <= r.hi)) continue;
            const u = toUnicode.map.get(code);
            // U+0000: a glyph that carries no letter of its own (show() decides whether that can be trusted).
            if (u === undefined || (u !== NO_LETTER && unusable(u))) return null;
            out += u;
            taken = length;
            break;
          }
          if (taken === 0) return null;
          i += taken;
        }
        return out;
      },
    };
    return reading;
  }
  if (subtype !== 'Type1' && subtype !== 'MMType1' && subtype !== 'TrueType' && subtype !== 'Type3') return unreadable;
  const names = new Map<number, string>();
  let base: string | null = null;
  const baseName = (n: string | undefined) => (n === 'WinAnsiEncoding' ? 'win' : n === 'StandardEncoding' ? 'std' : n === 'MacRomanEncoding' ? 'mac' : null);
  const encoding = look(context, font.get(name('Encoding')));
  if (encoding instanceof PDFName) base = baseName(encoding.decodeText());
  else if (encoding instanceof PDFDict) {
    base = baseName(nameOf(context, encoding.get(name('BaseEncoding'))));
    const differences = look(context, encoding.get(name('Differences')));
    let code = 0;
    for (const entry of differences instanceof PDFArray ? differences.asArray() : []) {
      const v = look(context, entry);
      if (v instanceof PDFNumber) code = v.asNumber();
      else if (v instanceof PDFName) names.set(code++, v.decodeText());
    }
  }
  const descriptor = look(context, font.get(name('FontDescriptor')));
  const flags = descriptor instanceof PDFDict ? numberOf(context, descriptor.get(name('Flags')), 0) : 0;
  const symbolic = (flags & 4) !== 0;
  const standard = !(descriptor instanceof PDFDict) && STANDARD_FONTS_14.test(nameOf(context, font.get(name('BaseFont'))) ?? '');
  if (base === null && subtype !== 'Type3' && (standard || (!symbolic && descriptor instanceof PDFDict))) base = 'std';
  const map = toUnicode?.map;
  // Ruling M: without a map, its letters are trusted only from a standard encoding whose names are all standard.
  const standardNames = [...names.values()].every((n) => !n.includes('.') && glyphChar(n) !== undefined);
  const trusted = subtype !== 'Type3' && (map !== undefined || (base !== null && !symbolic && standardNames));
  const reading: FontReading = {
    ref,
    lying: false,
    trusted,
    ...(subtype === 'Type3' ? { type3: font } : {}),
    decode(bytes) {
      let out = '';
      for (const code of bytes) {
        const glyph = names.get(code);
        const fromName = glyph !== undefined ? glyphChar(glyph) : undefined;
        const mapped = map?.get(code);
        // A name pdf.js does not know as it stands (a suffix, an invented name) and no map: pdf.js invents the letter.
        if (glyph !== undefined && mapped === undefined && (glyph.includes('.') || fromName === undefined)) reading.invents = true;
        if (fromName !== undefined) {
          if (mapped !== undefined && !sameText(mapped, fromName)) reading.lying = true;
          out += fromName;
          continue;
        }
        if (glyph !== undefined) {
          if (mapped === undefined || unusable(mapped)) return null;
          out += mapped;
          continue;
        }
        const fromBase = base !== null && !symbolic ? baseChar(base, code) : undefined;
        if (fromBase !== undefined) {
          if (mapped !== undefined && !sameText(mapped, fromBase)) reading.lying = true;
          out += fromBase;
          continue;
        }
        if (mapped === undefined || unusable(mapped)) return null;
        out += mapped;
      }
      return out;
    },
  };
  return reading;
}

// -- content streams --

type DrawToken =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; bytes: Uint8Array; start: number; end: number }
  | { t: 'array'; items: DrawToken[] }
  | { t: 'dict'; entries: Map<string, DrawToken> }
  | { t: 'other' };

/** The operators pdf.js knows: an "EI" followed by another word is image data, not the image's end (pdf.js's own test). */
const KNOWN_OPERATORS = new Set([
  'w', 'J', 'j', 'M', 'd', 'ri', 'i', 'gs', 'q', 'Q', 'cm', 'm', 'l', 'c', 'v', 'y', 'h', 're', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n',
  'W', 'W*', 'BT', 'ET', 'Tc', 'Tw', 'Tz', 'TL', 'Tf', 'Tr', 'Ts', 'Td', 'TD', 'Tm', 'T*', 'Tj', 'TJ', "'", '"', 'd0', 'd1', 'CS', 'cs', 'SC', 'SCN',
  'sc', 'scn', 'G', 'g', 'RG', 'rg', 'K', 'k', 'sh', 'BI', 'ID', 'EI', 'Do', 'MP', 'DP', 'BMC', 'BDC', 'EMC', 'BX', 'EX',
]);

/**
 * Where an inline image's data ends, as pdf.js ends it (fix wave 3, redact-retest-2 finding 4): at the
 * first "EI" (an E then an I, whatever stands before them) followed by a space, line feed or carriage
 * return, when the next ten bytes are not binary and the word after it, if any, is an operator pdf.js
 * knows. Returns the offset after "EI", or -1 when there is none (pdf.js then takes the rest as image).
 */
function inlineImageEnd(text: string, from: number): number {
  const n = text.length;
  let state = 0;
  for (let i = from; i < n; i++) {
    const c = text.charCodeAt(i);
    if (state === 0) state = c === 0x45 ? 1 : 0;
    else if (state === 1) state = c === 0x49 ? 2 : 0;
    else if (c === 0x20 || c === 0x0a || c === 0x0d) {
      let binary = false;
      for (let k = i + 1; k < Math.min(n, i + 11); k++) {
        const b = text.charCodeAt(k);
        if (b === 0x00 && text.charCodeAt(k + 1) !== 0x00) continue;
        if (b !== 0x0a && b !== 0x0d && (b < 0x20 || b > 0x7f)) {
          binary = true;
          break;
        }
      }
      if (!binary) {
        let k = i + 1;
        while (k < n && isWhite(text.charCodeAt(k))) k++;
        let j = k;
        while (j < n && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
        const word = text.slice(k, j);
        const isNumber = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word);
        if (word === '' || isNumber || word === 'true' || word === 'false' || word === 'null' || KNOWN_OPERATORS.has(word)) return i;
      }
      state = 0;
    } else state = 0;
  }
  return -1;
}

/**
 * Fix wave 4, ruling O: where an inline image ends by its own data length (as Poppler ends it): the bytes its
 * width, height, components and bits give, unfiltered, then white space, then "EI". -1 when it is filtered, its
 * size cannot be told, or no "EI" stands there.
 */
function inlineImageLengthEnd(text: string, from: number, dict: readonly DrawToken[]): number {
  const entries = new Map<string, DrawToken>();
  for (let k = 0; k + 1 < dict.length; k += 2) if (dict[k].t === 'name') entries.set((dict[k] as { v: string }).v, dict[k + 1]);
  const value = (...keys: string[]) => keys.map((k) => entries.get(k)).find((v) => v !== undefined);
  if (value('F', 'Filter') !== undefined) return -1;
  const num = (...keys: string[]) => {
    const v = value(...keys);
    return v?.t === 'num' ? v.v : undefined;
  };
  const width = num('W', 'Width');
  const height = num('H', 'Height');
  // /IM true (an image mask: one bit, one component); written false it is as rare as it is pointless.
  const isMask = value('IM', 'ImageMask') !== undefined;
  const cs = value('CS', 'ColorSpace');
  const csName = cs?.t === 'name' ? cs.v : undefined;
  const components = csName === 'RGB' || csName === 'DeviceRGB' ? 3 : csName === 'CMYK' || csName === 'DeviceCMYK' ? 4 : 1;
  const bits = num('BPC', 'BitsPerComponent') ?? (isMask ? 1 : undefined);
  if (width === undefined || height === undefined || bits === undefined || !(width > 0) || !(height > 0)) return -1;
  const bytes = Math.ceil((width * components * bits) / 8) * height;
  let k = from + bytes;
  while (k < text.length && isWhite(text.charCodeAt(k))) k++;
  return text.startsWith('EI', k) && (k + 2 >= text.length || isWhite(text.charCodeAt(k + 2)) || isDelimiter(text.charCodeAt(k + 2))) ? k + 2 : -1;
}

/**
 * The operators of a decoded content stream with their operands (strings with their offsets; arrays and
 * dictionaries kept). An inline image whose end cannot be found is the operator 'EI?' (the reader cannot
 * tell what follows it: unreadable, never empty). `byLength` ends each inline image by its own data length
 * where that can be told (ruling O: the other reader's continuation); `ambiguous` says some image ends in two
 * different places by the two rules.
 */
function drawOperations(text: string, byLength = false): { op: string; operands: DrawToken[]; start: number; end: number }[] & { ambiguous: boolean } {
  let ambiguous = false;
  const ops: { op: string; operands: DrawToken[]; start: number; end: number }[] = [];
  const n = text.length;
  let i = 0;
  const value = (): DrawToken | null => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (isWhite(c)) i++;
      else if (c === 0x25) {
        while (i < n && text.charCodeAt(i) !== 0x0a && text.charCodeAt(i) !== 0x0d) i++;
      } else break;
    }
    if (i >= n) return null;
    const c = text.charCodeAt(i);
    const start = i;
    if (c === 0x28) {
      const literal = readLiteral(text, i);
      i = literal.end;
      return { t: 'str', bytes: Uint8Array.from(literal.bytes), start, end: i };
    }
    if (c === 0x3c && text.charCodeAt(i + 1) === 0x3c) {
      i += 2;
      const entries = new Map<string, DrawToken>();
      for (let guard = 0; guard < 10_000; guard++) {
        while (i < n && isWhite(text.charCodeAt(i))) i++;
        if (i >= n) break;
        if (text.charCodeAt(i) === 0x3e && text.charCodeAt(i + 1) === 0x3e) {
          i += 2;
          break;
        }
        const key = value();
        if (key === null) break;
        if (key.t !== 'name') continue;
        const v = value();
        if (v === null) break;
        entries.set(key.v, v);
      }
      return { t: 'dict', entries };
    }
    if (c === 0x3c) {
      const hexString = readHex(text, i);
      i = hexString.end;
      return { t: 'str', bytes: Uint8Array.from(hexString.bytes), start, end: i };
    }
    if (c === 0x5b) {
      i++;
      const items: DrawToken[] = [];
      for (let guard = 0; guard < 100_000; guard++) {
        while (i < n && isWhite(text.charCodeAt(i))) i++;
        if (i >= n) break;
        if (text.charCodeAt(i) === 0x5d) {
          i++;
          break;
        }
        const item = value();
        if (item === null) break;
        items.push(item);
      }
      return { t: 'array', items };
    }
    if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
      const v = decodeNameText(text.slice(i + 1, j));
      i = j;
      return { t: 'name', v };
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      i++;
      return { t: 'other' };
    }
    let j = i + 1;
    while (j < n && !isWhite(text.charCodeAt(j)) && !isDelimiter(text.charCodeAt(j))) j++;
    const word = text.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: Number(word) };
    if (word === 'true' || word === 'false' || word === 'null') return { t: 'other' };
    ops.push({ op: word, operands: [], start, end: j });
    return null;
  };
  let operands: DrawToken[] = [];
  while (i < n) {
    const before = ops.length;
    const v = value();
    if (ops.length > before) {
      const op = ops[ops.length - 1];
      op.operands = operands;
      operands = [];
      if (op.op === 'ID') {
        // Inline image data, up to where pdf.js ends it (one white-space byte after ID, then the data); and where
        // its own data length ends it (ruling O).
        const k = inlineImageEnd(text, i + 1);
        const byData = inlineImageLengthEnd(text, i + 1, op.operands.length > 0 ? op.operands : (ops[ops.length - 2]?.op === 'BI' ? ops[ops.length - 2].operands : []));
        if (byData >= 0 && byData !== k) ambiguous = true;
        const end = byLength && byData >= 0 ? byData : k;
        if (end < 0) {
          ops.push({ op: 'EI?', operands: [], start: i, end: n });
          i = n;
        } else i = end;
      }
      continue;
    }
    if (v === null) break;
    operands.push(v);
  }
  return Object.assign(ops, { ambiguous });
}

/** Why a page is not on the copy allow-list (fix wave 4, ruling M). Fixed words only. */
export type CopyRefusal = 'inline-image' | 'type3' | 'font' | 'text-state' | 'font-size' | 'damaged' | 'gave-up' | 'encrypted';

/** The allow-list verdict of one page (ruling M): copied only when `plain`. */
export interface PageCopyVerdict {
  /** 0-based page index. */
  page: number;
  /** True only when everything on the page is of a kind both readers read fully and in agreement. */
  plain: boolean;
  /** Why not, each once, in the order met; empty when plain. Never text of the file. */
  reasons: CopyRefusal[];
}

/** Text render mode, rise and horizontal scaling (their defaults 0, 0, 100), with what q saved (ruling M). */
interface TextState {
  tr: number;
  ts: number;
  tz: number;
  saved: { tr: number; ts: number; tz: number }[];
}

interface ReadState {
  /** What the page met that is not on the copy allow-list (ruling M), for pageCopyVerdicts. */
  notes?: Set<CopyRefusal>;
  /** The text state the page's own content leaves, across its streams (ruling M), for pageCopyVerdicts. */
  textState?: TextState;
  context: PDFContext;
  suspects: ReadonlySet<number>;
  fonts: Map<PDFObject | string, FontReading>;
  depth: number;
  stack: Set<PDFObject>;
}

/** What one content stream shows, read through its fonts, forms, patterns and Type 3 glyphs. */
interface StreamRead {
  pieces: { text: string; newLine: boolean }[];
  strings: LoosePlace[];
  unreadable?: UnreadableReason;
  /** Top-level reading of page content only: what it draws that is its own drawing (a form starts with the font in effect where it is drawn). */
  forms: { value: PDFObject; resources: PDFDict | undefined; font?: FontReading }[];
  patterns: { value: PDFObject }[];
  /** A glyph procedure; `proc` absent when a shown code has no glyph name the reader can tell (unreadable). */
  glyphs: { proc?: PDFObject; font: FontReading; resources: PDFDict | undefined }[];
  /** Strings shown in a font that cannot be trusted (lying or unreadable map), by font. */
  untrusted: Map<FontReading, { font: FontReading; pieces: { text: string; newLine: boolean }[]; strings: LoosePlace[]; unreadable?: UnreadableReason; continued?: true }>;
  /** Marked content: inline alternative text and the spans of each MCID. */
  alts: { text: string; span: LoosePlace; mcid?: number }[];
  marks: Map<number, LoosePlace>;
  /** It shows text, or draws a form, pattern or image (for a glyph procedure: more than an outline). */
  draws: boolean;
  /** It draws an image XObject (in a glyph procedure: a picture, not a glyph's own bitmap). */
  images: boolean;
}

const resourceOf = (context: PDFContext, resources: PDFDict | undefined, category: string, key: string): PDFObject | undefined => {
  const group = resources ? look(context, resources.get(name(category))) : undefined;
  return group instanceof PDFDict ? group.get(name(key)) : undefined;
};
const resourcesOf = (context: PDFContext, value: PDFObject | undefined): PDFDict | undefined => {
  const v = look(context, value);
  return v instanceof PDFDict ? v : undefined;
};

/**
 * Reads one content stream. `top` (page content): forms, patterns and Type 3 glyph procedures are listed
 * as drawings of their own and only text in an untrusted font is kept; otherwise (an appearance, form,
 * pattern or glyph procedure) everything it draws is read into its text, in drawing order.
 */
function readContent(state: ReadState, data: Uint8Array, resources: PDFDict | undefined, top: boolean, initialFont?: FontReading): StreamRead {
  const read: StreamRead = { pieces: [], strings: [], forms: [], patterns: [], glyphs: [], untrusted: new Map(), alts: [], marks: new Map(), draws: false, images: false };
  const { context } = state;
  const fail = (reason: UnreadableReason) => {
    read.unreadable ??= reason;
  };
  /** What this page meets that is not on the copy allow-list (fix wave 4, ruling M). */
  const note = (reason: CopyRefusal) => {
    state.notes?.add(reason);
  };
  // A form or soft mask starts with the font in effect where it is drawn (fix wave 3, finding 5);
  // page content, an appearance, a pattern and a glyph procedure start with none (as pdf.js).
  let font: FontReading | undefined = initialFont;
  /** The font of a name in /Font, read once per object (a direct dictionary has no number; a missing font by its name). */
  const fontOf = (value: PDFObject | undefined, key: string): FontReading => {
    const id: PDFObject | string = value ?? `missing:${key}`;
    let reading = state.fonts.get(id);
    if (!reading) {
      reading = value === undefined ? { decode: () => null, lying: false, ref: 'missing' } : fontReading(context, value, state.suspects);
      state.fonts.set(id, reading);
    }
    return reading;
  };
  const fontStack: (FontReading | undefined)[] = [];
  let newLine = true;
  /** The text of the last readable string shown here (for a string that starts with a glyph of no letter). */
  let lastShown = '';
  /** In the second continuation of an ambiguous inline image (ruling O): the key of each font's own entry. */
  let continuation: Map<FontReading, FontReading> | undefined;
  const marked: { start: number; mcid?: number; alt?: string }[] = [];
  const show = (token: DrawToken | undefined) => {
    if (!token) return;
    const strings = token.t === 'str' ? [token] : token.t === 'array' ? token.items.filter((x): x is Extract<DrawToken, { t: 'str' }> => x.t === 'str') : [];
    if (strings.length === 0) return;
    read.draws = true;
    // Text shown with no font known (none set, or set by a means not followed) is unreadable, never
    // read as plain letters (fix wave 3, finding 5).
    const shownIn = font ?? fontOf(undefined, '');
    let text = '';
    let readable = true;
    for (const s of strings) {
      const decoded = shownIn.decode(s.bytes);
      if (decoded === null) readable = false;
      else text += decoded;
    }
    // A glyph mapped to U+0000 in a cluster of another script is no letter; elsewhere it is unreadable (K1 note).
    // Either way the page is not plain: what that glyph draws is not told by any map (ruling M).
    const noLetter = readable && text.includes(NO_LETTER);
    if (noLetter) {
      if (clusterPartsOnly(text, lastShown)) text = text.split(NO_LETTER).join('');
      else readable = false;
    }
    if (readable && text !== '') lastShown = text;
    // Fix wave 4: letters pdf.js invents, or a map that disagrees with the glyph names, cannot be trusted
    // (ruling N: unreadable); and the page is not plain (ruling M).
    if (shownIn.trusted === false || !readable || noLetter || shownIn.lying || shownIn.invents) note('font');
    if (shownIn.type3) note('type3');
    if (!top && (shownIn.lying || shownIn.invents)) readable = false;
    const places = strings.map((s) => ({ start: s.start, end: s.end }));
    const piece = { text, newLine };
    newLine = false;
    if (top) {
      // Every font's strings are kept; whether the font is trusted is decided at the end (a later string
      // may show that its map lies). Text read only in an inline image's second continuation (ruling O) is a
      // drawing of its own, whatever its font: pdf.js does not show it, another viewer may.
      let key = shownIn;
      if (continuation) {
        key = continuation.get(shownIn) ?? { ...shownIn };
        continuation.set(shownIn, key);
      }
      let entry = read.untrusted.get(key);
      if (!entry) read.untrusted.set(key, (entry = { font: shownIn, pieces: [], strings: [], ...(continuation ? { continued: true as const } : {}) }));
      entry.strings.push(...places);
      if (!readable) entry.unreadable = 'font';
      else entry.pieces.push(piece);
      if (font?.type3) glyphsOf(font, strings);
      return;
    }
    read.strings.push(...places);
    if (!readable) fail('font');
    else read.pieces.push(piece);
    if (font?.type3) glyphsOf(font, strings);
  };
  const glyphsOf = (type3: FontReading, strings: { bytes: Uint8Array }[]) => {
    const dict = type3.type3!;
    const procs = look(context, dict.get(name('CharProcs')));
    const encoding = look(context, dict.get(name('Encoding')));
    const differences = encoding instanceof PDFDict ? look(context, encoding.get(name('Differences'))) : undefined;
    // Glyph names from /Differences over the base encoding (a name, or /BaseEncoding; Standard when none):
    // fix wave 3, finding 6, as pdf.js takes them.
    const baseEncoding = encoding instanceof PDFName ? encoding.decodeText() : encoding instanceof PDFDict ? nameOf(context, encoding.get(name('BaseEncoding'))) : undefined;
    const names = new Map<number, string>();
    let code = 0;
    for (const entry of differences instanceof PDFArray ? differences.asArray() : []) {
      const v = look(context, entry);
      if (v instanceof PDFNumber) code = v.asNumber();
      else if (v instanceof PDFName) names.set(code++, v.decodeText());
    }
    const glyphResources = resourcesOf(context, dict.get(RESOURCES)) ?? resources;
    for (const s of strings) {
      for (const c of s.bytes) {
        const glyph = names.get(c) ?? baseGlyphName(baseEncoding, c);
        if (glyph === undefined) {
          // A code whose glyph the reader cannot name: what pdf.js draws for it cannot be told.
          if (top) {
            if (!read.glyphs.some((g) => g.proc === undefined && g.font === type3)) read.glyphs.push({ font: type3, resources: glyphResources });
          } else fail('type3');
          continue;
        }
        // A named glyph without a procedure draws nothing (as pdf.js).
        const proc = procs instanceof PDFDict ? procs.get(name(glyph)) : undefined;
        if (proc === undefined) continue;
        if (top) {
          if (!read.glyphs.some((g) => g.proc === proc)) read.glyphs.push({ proc, font: type3, resources: glyphResources });
        } else {
          const inner = nested(proc, glyphResources);
          if (inner.unreadable) fail(inner.unreadable === 'font' ? 'type3' : inner.unreadable);
          read.pieces.push(...inner.pieces);
          if (inner.draws) read.draws = true;
        }
      }
    }
  };
  const nested = (value: PDFObject, parentResources: PDFDict | undefined, inherited?: FontReading): StreamRead => {
    const empty: StreamRead = { pieces: [], strings: [], forms: [], patterns: [], glyphs: [], untrusted: new Map(), alts: [], marks: new Map(), draws: false, images: false };
    const target = look(context, value) ?? value;
    if (state.depth >= DRAW_DEPTH || state.stack.has(target)) {
      note('gave-up');
      return { ...empty, unreadable: 'depth' };
    }
    const { data: inner, unreadable } = strictData(context, value, state.suspects);
    if (!inner) {
      note('damaged');
      return { ...empty, unreadable };
    }
    const dict = target instanceof PDFStream ? target.dict : undefined;
    const own = dict ? resourcesOf(context, dict.get(RESOURCES)) : undefined;
    state.depth++;
    state.stack.add(target);
    try {
      return readContent(state, inner, own ?? parentResources, false, inherited);
    } finally {
      state.depth--;
      state.stack.delete(target);
    }
  };
  /** A form or soft-mask group drawn here: listed (top) or read into this stream's text, starting with the current font. */
  const drawForm = (value: PDFObject) => {
    read.draws = true;
    if (top) {
      // A form drawn in both continuations of an ambiguous inline image is one drawing.
      if (!continuation || !read.forms.some((f) => f.value === value)) read.forms.push({ value, resources, ...(font ? { font } : {}) });
    } else {
      const inner = nested(value, resources, font);
      if (inner.unreadable) fail(inner.unreadable);
      read.pieces.push(...inner.pieces.map((p, k) => (k === 0 ? { ...p, newLine: true } : p)));
    }
  };
  // Where an inline image ends in two places by the two rules, both continuations are read (ruling O).
  const text = latin1(data);
  const first = drawOperations(text);
  if (first.ambiguous) note('damaged');
  for (const ops of first.ambiguous ? [first, drawOperations(text, true)] : [first]) {
  if (ops !== first) {
    continuation = new Map();
    font = initialFont;
    fontStack.length = 0;
    newLine = true;
    lastShown = '';
    marked.length = 0;
  }
  // The text state the page content leaves (ruling M): followed in the first reading only (an ambiguous
  // page is not plain whatever it leaves).
  const textState = top && ops === first ? state.textState : undefined;
  for (const { op, operands, start, end } of ops) {
    switch (op) {
      case 'q':
        fontStack.push(font);
        if (textState) textState.saved.push({ tr: textState.tr, ts: textState.ts, tz: textState.tz });
        break;
      case 'Q':
        font = fontStack.length > 0 ? fontStack.pop() : font;
        if (textState) Object.assign(textState, textState.saved.pop() ?? {});
        break;
      case 'Tr':
      case 'Ts':
      case 'Tz': {
        const value = operands[0]?.t === 'num' ? operands[0].v : undefined;
        if (textState && value !== undefined) textState[op === 'Tr' ? 'tr' : op === 'Ts' ? 'ts' : 'tz'] = value;
        break;
      }
      case 'BT':
      case 'ET':
      case 'Td':
      case 'TD':
      case 'Tm':
      case 'T*':
        newLine = true;
        break;
      case 'Tf': {
        const key = operands[0]?.t === 'name' ? operands[0].v : undefined;
        font = fontOf(key !== undefined ? resourceOf(context, resources, 'Font', key) : undefined, key ?? '');
        const size = operands[1];
        if (size?.t === 'num' && !(size.v > 0)) note('font-size');
        break;
      }
      case 'gs': {
        // A graphics state may set the font (/Font [font size]: finding 5) and a soft mask whose group
        // draws (/SMask << /G form >>: finding 7).
        const key = operands[0]?.t === 'name' ? operands[0].v : undefined;
        const gstate = key !== undefined ? look(context, resourceOf(context, resources, 'ExtGState', key)) : undefined;
        if (gstate instanceof PDFInvalidObject) {
          note('damaged');
          fail('parse');
          break;
        }
        if (!(gstate instanceof PDFDict)) break;
        const fontEntry = look(context, gstate.get(FONT));
        if (fontEntry instanceof PDFArray && fontEntry.size() >= 1) {
          font = fontOf(fontEntry.get(0), '');
          const size = look(context, fontEntry.get(1));
          if (size instanceof PDFNumber && !(size.asNumber() > 0)) note('font-size');
        }
        else if (fontEntry !== undefined) font = fontOf(undefined, '');
        const mask = look(context, gstate.get(name('SMask')));
        if (mask instanceof PDFInvalidObject) fail('parse');
        else if (mask instanceof PDFDict) {
          const group = mask.get(name('G'));
          const groupValue = look(context, group);
          if (group !== undefined && (groupValue instanceof PDFStream || groupValue instanceof PDFInvalidObject || (group instanceof PDFRef && state.suspects.has(group.objectNumber)))) drawForm(group);
        }
        break;
      }
      case 'EI?':
        // An inline image whose end pdf.js finds and this reader does not: what follows cannot be told.
        note('damaged');
        read.draws = true;
        if (top) {
          const entry = read.untrusted.get(fontOf(undefined, 'inline image')) ?? { font: fontOf(undefined, 'inline image'), pieces: [], strings: [] };
          entry.unreadable = 'parse';
          read.untrusted.set(entry.font, entry);
        } else fail('parse');
        break;
      case 'Tj':
        show(operands[operands.length - 1]);
        break;
      case "'":
      case '"':
        newLine = true;
        show(operands[operands.length - 1]);
        break;
      case 'TJ':
        show(operands[operands.length - 1]);
        break;
      case 'Do': {
        const key = operands[0]?.t === 'name' ? operands[0].v : undefined;
        const value = key !== undefined ? resourceOf(context, resources, 'XObject', key) : undefined;
        if (value === undefined) break;
        const object = look(context, value);
        if (object instanceof PDFInvalidObject || (value instanceof PDFRef && state.suspects.has(value.objectNumber))) {
          note('damaged');
          read.draws = true;
          if (top) read.forms.push({ value, resources });
          else fail('parse');
          break;
        }
        if (!(object instanceof PDFStream)) break;
        const subtype = look(context, object.dict.get(SUBTYPE));
        if (subtype === IMAGE) {
          read.draws = true;
          read.images = true;
          break;
        }
        drawForm(value);
        break;
      }
      case 'scn':
      case 'SCN': {
        const last = operands[operands.length - 1];
        const value = last?.t === 'name' ? resourceOf(context, resources, 'Pattern', last.v) : undefined;
        const pattern = look(context, value);
        if (value === undefined || !(pattern instanceof PDFStream)) break;
        read.draws = true;
        if (top) {
          if (!read.patterns.some((p) => p.value === value)) read.patterns.push({ value });
        } else {
          const inner = nested(value, resources);
          if (inner.unreadable) fail(inner.unreadable);
          read.pieces.push(...inner.pieces);
        }
        break;
      }
      case 'BI':
        note('inline-image');
        read.draws = true;
        break;
      case 'BMC':
      case 'BDC': {
        let props = operands[1];
        if (props?.t === 'name') {
          const named = look(context, resourceOf(context, resources, 'Properties', props.v));
          props = { t: 'dict', entries: new Map(named instanceof PDFDict ? named.entries().map(([k, v]) => [k.decodeText(), tokenOfObject(context, v)] as const) : []) };
        }
        const entries = props?.t === 'dict' ? props.entries : undefined;
        const mcid = entries?.get('MCID');
        const altToken = entries?.get('ActualText') ?? entries?.get('Alt') ?? entries?.get('E');
        marked.push({ start, ...(mcid?.t === 'num' ? { mcid: mcid.v } : {}), ...(altToken?.t === 'str' ? { alt: textOfString(altToken.bytes) } : {}) });
        break;
      }
      case 'EMC': {
        const open = marked.pop();
        if (!open) break;
        const span = { start: open.start, end };
        if (open.mcid !== undefined) read.marks.set(open.mcid, span);
        if (open.alt !== undefined) read.alts.push({ text: open.alt, span, ...(open.mcid !== undefined ? { mcid: open.mcid } : {}) });
        break;
      }
      default:
        break;
    }
  }
  }
  if (top) {
    for (const [key, entry] of read.untrusted) {
      // Ruling N: a map that disagrees with the glyph names, or letters pdf.js invents, is unreadable.
      if (entry.font.lying || entry.font.invents) entry.unreadable = 'font';
      else if (!entry.unreadable && !entry.continued) read.untrusted.delete(key);
    }
  }
  return read;
}

/** A PDF object as a content-stream token (for /Properties named dictionaries). */
function tokenOfObject(context: PDFContext, value: PDFObject): DrawToken {
  const v = look(context, value);
  if (v instanceof PDFNumber) return { t: 'num', v: v.asNumber() };
  if (v instanceof PDFName) return { t: 'name', v: v.decodeText() };
  if (v instanceof PDFHexString) return { t: 'str', bytes: hexBytes(v.asString()), start: -1, end: -1 };
  if (v instanceof PDFString) return { t: 'str', bytes: v.asBytes(), start: -1, end: -1 };
  return { t: 'other' };
}

const textOfRead = (pieces: readonly { text: string; newLine: boolean }[]) => ({
  joined: pieces.map((p) => p.text).join(''),
  spaced: pieces.map((p, k) => `${k === 0 ? '' : p.newLine ? LINE_BREAK : ' '}${p.text}`).join(''),
});

/** Structure elements with /ActualText, /Alt or /E: their text and the marked content (page, MCIDs) under them. */
function structureAlts(doc: PDFDocument): { text: string; marks: Map<PDFRef, number[]>; holder?: PDFRef }[] {
  const context = doc.context;
  const out: { text: string; marks: Map<PDFRef, number[]>; holder?: PDFRef }[] = [];
  const root = look(context, doc.catalog.get(name('StructTreeRoot')));
  if (!(root instanceof PDFDict)) return out;
  const visited = new Set<PDFObject>();
  /** The (page, MCID) pairs under a kid, inheriting `page`. */
  const collect = (kid: PDFObject | undefined, page: PDFRef | undefined, depth: number, into: Map<PDFRef, number[]>) => {
    if (kid === undefined || depth > DRAW_DEPTH) return;
    const v = look(context, kid);
    if (v instanceof PDFNumber) {
      if (page) into.set(page, [...(into.get(page) ?? []), v.asNumber()]);
      return;
    }
    if (v instanceof PDFArray) {
      for (const item of v.asArray()) collect(item, page, depth + 1, into);
      return;
    }
    if (!(v instanceof PDFDict) || visited.has(v)) return;
    const pg = v.get(name('Pg'));
    const own = pg instanceof PDFRef ? pg : page;
    if (look(context, v.get(TYPE)) === name('MCR')) {
      const mcid = look(context, v.get(name('MCID')));
      if (own && mcid instanceof PDFNumber) into.set(own, [...(into.get(own) ?? []), mcid.asNumber()]);
      return;
    }
    if (look(context, v.get(TYPE)) === name('OBJR')) return;
    collect(v.get(name('K')), own, depth + 1, into);
  };
  const walk = (node: PDFObject | undefined, page: PDFRef | undefined, depth: number, holder?: PDFRef) => {
    if (node === undefined || depth > DRAW_DEPTH) return;
    const v = look(context, node);
    const own = node instanceof PDFRef ? node : holder;
    if (v instanceof PDFArray) {
      for (const item of v.asArray()) walk(item, page, depth + 1, own);
      return;
    }
    if (!(v instanceof PDFDict) || visited.has(v)) return;
    const type = look(context, v.get(TYPE));
    if (type === name('MCR') || type === name('OBJR')) return;
    visited.add(v);
    const pg = v.get(name('Pg'));
    const onPage = pg instanceof PDFRef ? pg : page;
    for (const key of ['ActualText', 'Alt', 'E']) {
      const value = look(context, v.get(name(key)));
      if (!(value instanceof PDFString) && !(value instanceof PDFHexString)) continue;
      const marks = new Map<PDFRef, number[]>();
      collect(v.get(name('K')), onPage, 0, marks);
      out.push({ text: textOfString(value instanceof PDFHexString ? hexBytes(value.asString()) : value.asBytes()), marks, ...(own ? { holder: own } : {}) });
    }
    walk(v.get(name('K')), onPage, depth + 1, own);
  };
  walk(root.get(name('K')), undefined, 0);
  return out;
}

/**
 * Every drawing on `pages` (0-based) of `file` that paints and is not ordinary page text the find reads
 * (fix wave 2, rulings 1, 2, 5; rx2-contract.md (b)): each shown annotation's appearance (one drawing per
 * annotation, even when two share a stream), each form XObject and tiling pattern the page draws, each
 * Type 3 glyph procedure that writes text or draws, text in a font whose map cannot be trusted, and
 * alternative text (on marked content, or on structure elements through /Pg and their MCIDs). Each is
 * read as joined text (in drawing order, across lines) or reported unreadable with a reason. Stop and
 * progress as checkHits (one step per page).
 */
export async function pageDrawings(file: Uint8Array, pages: readonly number[], options: CheckOptions = {}): Promise<PageDrawing[]> {
  return (await readPages(file, pages, options, false)).drawings;
}

/**
 * Fix wave 4, ruling M: whether each of `pages` (0-based) of `file` may be copied as it is. Default deny: a page is
 * plain only when nothing on it (its content, every form, pattern, glyph procedure and annotation appearance it
 * draws) is outside the allow-list: no inline image, no Type 3 font, every font's letters trusted (a usable map,
 * or a standard encoding whose glyph names are all standard; no map that disagrees with its names, no invented
 * letters, no missing font), no text state left odd at the end of the content (3 Tr, Ts, Tz) when the page has
 * annotations, no font size of zero or below, nothing recovered from damage, nothing the reader gave up on. Any
 * other page is rebuilt (RX-RUN). Stop and progress as checkHits.
 */
export async function pageCopyVerdicts(file: Uint8Array, pages: readonly number[], options: CheckOptions = {}): Promise<PageCopyVerdict[]> {
  return (await readPages(file, pages, options, true)).verdicts;
}

/**
 * Both at once, reading the file once: what RX-RUN needs when it wants the drawings (pageDrawings) and the
 * copy verdicts (pageCopyVerdicts) of the same pages. The drawings are exactly pageDrawings'.
 */
export async function pageDrawingsAndVerdicts(file: Uint8Array, pages: readonly number[], options: CheckOptions = {}): Promise<{ drawings: PageDrawing[]; verdicts: PageCopyVerdict[] }> {
  return readPages(file, pages, options, true);
}

/** The drawings of `pages`, and (with `withNotes`) each page's copy verdict (ruling M). */
async function readPages(file: Uint8Array, pages: readonly number[], options: CheckOptions, withNotes: boolean): Promise<{ drawings: PageDrawing[]; verdicts: PageCopyVerdict[] }> {
  const pacer = new Pacer(options);
  let wait = pacer.step(0, 1);
  if (wait) await wait;
  const doc = await loadForCheck(file, pacer.paced);
  const drawings: PageDrawing[] = [];
  const verdicts: PageCopyVerdict[] = [];
  const wanted = [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 0).sort((a, b) => a - b);
  const pageRefs = pageRefsOf(doc);
  const add = (page: number, kind: DrawingKind, source: DrawingSource, read: { text?: { joined: string; spaced: string }; unreadable?: UnreadableReason }) => {
    const id = `p${page}-${kind}-${drawings.filter((d) => d.page === page && d.kind === kind).length}`;
    drawings.push({ id, page, kind, source, ...(read.unreadable ? { unreadable: read.unreadable } : { text: read.text ?? { joined: '', spaced: '' } }) });
    return id;
  };
  if (doc.isEncrypted) {
    for (const page of wanted) {
      add(page, 'content', { stream: 'direct', strings: [], within: [] }, { unreadable: 'filter' });
      verdicts.push({ page, plain: false, reasons: ['encrypted'] });
    }
    return { drawings, verdicts };
  }
  const context = doc.context;
  const suspects = suspectObjects(file);
  const state: ReadState = { context, suspects, fonts: new Map(), depth: 0, stack: new Set() };
  const alts = structureAlts(doc);
  // An appearance without resources of its own takes the form's default resources (as readers do).
  const acroForm = look(context, doc.catalog.get(name('AcroForm')));
  const formResources = acroForm instanceof PDFDict ? resourcesOf(context, acroForm.get(name('DR'))) : undefined;
  const total = wanted.length + 1;
  wait = pacer.step(0, total, true);
  if (wait) await wait;
  for (const [step, index] of wanted.entries()) {
    wait = pacer.step(step, total);
    if (wait) await wait;
    const ref = pageRefs[index];
    const page = ref ? context.lookup(ref) : undefined;
    if (!(page instanceof PDFDict)) {
      verdicts.push({ page: index, plain: false, reasons: ['damaged'] });
      continue;
    }
    state.notes = withNotes ? new Set<CopyRefusal>() : undefined;
    state.textState = withNotes ? { tr: 0, ts: 0, tz: 100, saved: [] } : undefined;
    const firstDrawing = drawings.length;
    let resources = resourcesOf(context, page.get(RESOURCES));
    for (let parent = look(context, page.get(PARENT)), d = 0; !resources && parent instanceof PDFDict && d < DRAW_DEPTH; parent = look(context, parent.get(PARENT)), d++) resources = resourcesOf(context, parent.get(RESOURCES));
    const marks = new Map<number, { stream: string; span: LoosePlace }>();
    // The page's own content: untrusted text, its forms, patterns and Type 3 glyphs, marked content.
    const contents = look(context, page.get(CONTENTS));
    const streams = contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [page.get(CONTENTS)!];
    for (const value of streams) {
      const { data, unreadable } = strictData(context, value, suspects);
      if (!data) {
        state.notes?.add('damaged');
        add(index, 'content', { stream: refText(value), strings: [], within: [] }, { unreadable: unreadable ?? 'parse' });
        continue;
      }
      const read = readContent(state, data, resources, true);
      for (const [, entry] of read.untrusted) {
        add(index, 'content', { stream: refText(value), font: entry.font.ref, strings: entry.strings, within: [] }, entry.unreadable ? { unreadable: entry.unreadable } : { text: textOfRead(entry.pieces) });
      }
      for (const form of read.forms) {
        const inner = readNested(state, form.value, form.resources, form.font);
        add(index, 'form', { stream: refText(form.value), strings: inner.strings, within: [] }, inner.unreadable ? { unreadable: inner.unreadable } : { text: textOfRead(inner.pieces) });
      }
      for (const pattern of read.patterns) {
        const inner = readNested(state, pattern.value, resources);
        add(index, 'pattern', { stream: refText(pattern.value), strings: inner.strings, within: [] }, inner.unreadable ? { unreadable: inner.unreadable } : { text: textOfRead(inner.pieces) });
      }
      for (const glyph of read.glyphs) {
        if (glyph.proc === undefined) {
          add(index, 'glyph', { stream: refText(value), font: glyph.font.ref, strings: [], within: [] }, { unreadable: 'type3' });
          continue;
        }
        const inner = readNested(state, glyph.proc, glyph.resources);
        // A glyph that only outlines or paints its own bitmap is a glyph; one that writes text or draws a
        // picture is a drawing (R4). A picture cannot be read: unreadable.
        if (!inner.unreadable && inner.strings.length === 0 && inner.pieces.length === 0 && !inner.images) continue;
        const reason = inner.unreadable === 'font' || (!inner.unreadable && inner.images) ? 'type3' : inner.unreadable;
        add(index, 'glyph', { stream: refText(glyph.proc), font: glyph.font.ref, strings: inner.strings, within: [] }, reason ? { unreadable: reason } : { text: textOfRead(inner.pieces) });
      }
      for (const alt of read.alts) add(index, 'alt', { stream: refText(value), strings: [], spans: [alt.span], ...(alt.mcid !== undefined ? { mcids: [alt.mcid] } : {}), within: [] }, { text: { joined: alt.text, spaced: alt.text } });
      for (const [mcid, span] of read.marks) marks.set(mcid, { stream: refText(value), span });
    }
    // Alternative text on structure elements (R6): placed by the MCIDs it covers on this page.
    for (const alt of alts) {
      const mcids = alt.marks.get(ref) ?? [];
      if (mcids.length === 0) continue;
      const placed = mcids.map((m) => marks.get(m)).filter((m): m is { stream: string; span: LoosePlace } => m !== undefined);
      add(index, 'alt', { stream: placed[0]?.stream ?? refText(streams[0]), strings: [], spans: placed.map((m) => m.span), mcids, within: [] }, { text: { joined: alt.text, spaced: alt.text } });
    }
    // Each shown annotation's appearance, one drawing per annotation.
    const annots = look(context, page.get(name('Annots')));
    (annots instanceof PDFArray ? annots.asArray() : []).forEach((entry, k) => {
      const annotation = look(context, entry);
      if (annotation instanceof PDFInvalidObject || (entry instanceof PDFRef && suspects.has(entry.objectNumber))) {
        add(index, 'appearance', { stream: 'direct', annotation: { index: k, object: refText(entry), rect: { x0: 0, y0: 0, x1: 0, y1: 0 } }, strings: [], within: [] }, { unreadable: 'parse' });
        return;
      }
      if (!(annotation instanceof PDFDict)) return;
      if ((numberOf(context, annotation.get(name('F')), 0) & (2 | 32)) !== 0) return;
      const rect = rectOf(context, annotation.get(name('Rect'))) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
      const ap = look(context, annotation.get(name('AP')));
      if (ap instanceof PDFInvalidObject) {
        add(index, 'appearance', { stream: 'direct', annotation: { index: k, object: refText(entry), rect }, strings: [], within: [] }, { unreadable: 'parse' });
        return;
      }
      if (!(ap instanceof PDFDict)) return;
      const normal = ap.get(name('N'));
      const normalValue = look(context, normal);
      let states: PDFObject[] = [];
      if (normalValue instanceof PDFStream || normalValue instanceof PDFInvalidObject || (normal instanceof PDFRef && suspects.has(normal.objectNumber))) states = [normal!];
      else if (normalValue instanceof PDFDict) {
        const chosen = nameOf(context, annotation.get(name('AS')));
        const picked = chosen !== undefined ? normalValue.get(name(chosen)) : undefined;
        states = picked !== undefined ? [picked] : normalValue.values();
      }
      if (states.length === 0) return;
      const pieces: { text: string; newLine: boolean }[] = [];
      const strings: LoosePlace[] = [];
      let unreadable: UnreadableReason | undefined;
      for (const s of states) {
        const inner = readNested(state, s, formResources);
        unreadable ??= inner.unreadable;
        pieces.push(...inner.pieces.map((p, i) => (i === 0 ? { ...p, newLine: true } : p)));
        strings.push(...inner.strings);
      }
      add(index, 'appearance', { stream: refText(states[0]), annotation: { index: k, object: refText(entry), rect }, strings, within: [] }, unreadable ? { unreadable } : { text: textOfRead(pieces) });
    });
    if (state.notes) {
      const notes = state.notes;
      const left = state.textState;
      if (drawings.slice(firstDrawing).some(readerGaveUp)) notes.add('gave-up');
      // Text state left odd at the end of the content carries into annotation appearances in some viewers (B5).
      if (annots instanceof PDFArray && annots.size() > 0 && left && (left.tr !== 0 || left.ts !== 0 || left.tz !== 100)) notes.add('text-state');
      verdicts.push({ page: index, plain: notes.size === 0, reasons: [...notes] });
      state.notes = undefined;
      state.textState = undefined;
    }
  }
  wait = pacer.step(total, total, true);
  if (wait) await wait;
  return { drawings, verdicts };
}

/** A form, pattern, appearance or glyph procedure read completely (its own resources, else `parent`; a form with the font it inherits). */
function readNested(state: ReadState, value: PDFObject, parent: PDFDict | undefined, font?: FontReading): StreamRead {
  const { context } = state;
  const empty: StreamRead = { pieces: [], strings: [], forms: [], patterns: [], glyphs: [], untrusted: new Map(), alts: [], marks: new Map(), draws: false, images: false };
  const target = look(context, value) ?? value;
  if (state.stack.has(target)) return { ...empty, unreadable: 'depth' };
  const { data, unreadable } = strictData(context, value, state.suspects);
  if (!data) return { ...empty, unreadable };
  const dict = target instanceof PDFStream ? target.dict : undefined;
  const own = dict ? resourcesOf(context, dict.get(RESOURCES)) : undefined;
  state.stack.add(target);
  try {
    return readContent(state, data, own ?? parent, false, font);
  } finally {
    state.stack.delete(target);
  }
}

/**
 * Fix wave 3, finding 8 (Ruling B): true when the reader gave up on this drawing: too deep, an object or
 * font it cannot reach or parse, a filter, a glyph procedure it cannot follow, text shown with no font;
 * anything unreadable except page text shown in a font of its own with no usable map ('content' with
 * 'font', such as symbol-font bullets). A page with such a drawing must be rebuilt under the proof, or the
 * run asks or stops: never copied without a word.
 */
export function readerGaveUp(drawing: PageDrawing): boolean {
  if (drawing.unreadable === undefined) return false;
  return !(drawing.kind === 'content' && drawing.unreadable === 'font' && drawing.source.font !== undefined && drawing.source.font !== 'missing');
}

/** Whether a drawing's text holds any target (joined or spaced; strict or loose); null for none, or for an unreadable drawing. */
export function drawingPass(targets: readonly CheckTarget[]): (drawing: PageDrawing) => CheckPass | null {
  const pass = targetPass(targets);
  return (drawing) => (drawing.text ? stronger(pass(drawing.text.joined), pass(drawing.text.spaced)) : null);
}
