// Placing text and images on a page in the frame of the page as the reader sees it, for Watermark,
// stamp, logo (watermark.ts) and Page numbers (pageNumbers.ts). This file is the one way to draw on a page.
//
// How a mark is drawn (spike-stamps.md, measured):
// - Existing content is never re-encoded. In front, `/Contents` becomes
//   [q x (S + 1), ...original streams, Q x K, ...our streams] where S is the number of `Q` the original
//   has with nothing of its own to close (each pops one of our `q`, as pageBox.ts does) and K is the
//   number of `q` it leaves open, plus one. That keeps a stray `cm` (flip, scale), an unclosed `q` or a
//   stray `Q` from moving the mark. A page with a stray `Q` is still reported (`damaged`): readers
//   differ on such content, so the page's own drawing may look different.
//   Behind, our (self-balanced) stream goes first and nothing is wrapped.
// - pdf-lib's `normalize()` is never called: it copies a shared /Resources into every page, which
//   grows the file with the square of the page count. Pages that share one /Resources get ONE cloned
//   dictionary between them (fixed key names `VRA<n>_...`), registered once.
// - One shared stream holds `q`, one shared stream per K holds the `Q`s, one shared /ExtGState per
//   opacity; fonts and images are embedded by the caller once.
import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
  type PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  type PDFFont,
  type PDFImage,
} from 'pdf-lib';
import { runAtOnce, runPaced, type Pace, type Work } from './pace';
import { PdfToolsError } from './types';

// ---- geometry -------------------------------------------------------------------------------

export type Anchor = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
/** `point`: fractions 0-1 of the displayed page, from the bottom-left. */
export type Placement = { anchor: Anchor; padPt: number } | { point: { u: number; v: number } };
export type Rotation = 0 | 90 | 180 | 270;
export type Box = { x: number; y: number; width: number; height: number };
export type Matrix = [number, number, number, number, number, number];
export interface DisplayedPage {
  /** The visible box in the page's own coordinates (CropBox clipped to MediaBox). */
  box: Box;
  rotation: Rotation;
  /** Size as displayed, in real points (width and height swap on a page turned 90 or 270; a /UserUnit is applied). */
  width: number;
  height: number;
  /** The page's /UserUnit (default 1): user-space units per real point is 1 / unit. */
  unit?: number;
}

/** Cap height of the standard fonts, so that a mark's box is the height of its capital letters. */
export const CAP_HEIGHT = 0.718;

// pdf-lib reports a box written with reversed corners as negative width/height.
export function normaliseBox(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.width), y: Math.min(b.y, b.y + b.height), width: Math.abs(b.width), height: Math.abs(b.height) };
}

/** What a viewer shows: the CropBox clipped to the MediaBox, or the MediaBox when they do not overlap. */
export function visibleBox(page: PDFPage): Box {
  const media = normaliseBox(page.getMediaBox());
  const crop = normaliseBox(page.getCropBox());
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : media;
}

// Viewers ignore a /Rotate that is not a multiple of 90, so a mark must too.
export function normaliseRotation(angle: number): Rotation {
  if (!Number.isInteger(angle) || angle % 90 !== 0) return 0;
  return ((((angle / 90) % 4) + 4) % 4 * 90) as Rotation;
}

/** The page's /UserUnit: a user-space unit is `unit` points on paper. Anything unusable counts as 1. */
function userUnit(page: PDFPage): number {
  const v = page.node.lookup(PDFName.of('UserUnit'));
  const n = v instanceof PDFNumber ? v.asNumber() : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function displayedPage(page: PDFPage): DisplayedPage {
  const box = visibleBox(page);
  const rotation = normaliseRotation(page.getRotation().angle);
  const sideways = rotation === 90 || rotation === 270;
  const unit = userUnit(page);
  return { box, rotation, unit, width: (sideways ? box.height : box.width) * unit, height: (sideways ? box.width : box.height) * unit };
}

/**
 * Takes the reader frame (origin bottom-left as displayed, u right, v up, in real points) to the page's
 * own coordinates (user units: one real point is 1 / UserUnit of them).
 */
export function readerMatrix(d: DisplayedPage): Matrix {
  const { x, y, width: W, height: H } = d.box;
  const s = 1 / (d.unit ?? 1);
  switch (d.rotation) {
    case 90: return [0, s, -s, 0, x + W, y];
    case 180: return [-s, 0, 0, -s, x + W, y + H];
    case 270: return [0, -s, s, 0, x, y + H];
    default: return [s, 0, 0, s, x, y];
  }
}

/** The centre, in the reader frame, of a w x h box turned by `angleDeg` (counter-clockwise as seen) and placed. */
export function placeBox(d: DisplayedPage, w: number, h: number, angleDeg: number, placement: Placement): { u: number; v: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  if ('point' in placement) {
    const u = placement.point.u * d.width;
    const v = placement.point.v * d.height;
    return {
      u: bw <= d.width ? Math.min(Math.max(u, bw / 2), d.width - bw / 2) : u,
      v: bh <= d.height ? Math.min(Math.max(v, bh / 2), d.height - bh / 2) : v,
    };
  }
  const [row, col] = placement.anchor === 'center' ? ['middle', 'center'] : (placement.anchor.split('-') as [string, string]);
  const pad = placement.padPt;
  const u = col === 'left' ? pad + bw / 2 : col === 'right' ? d.width - pad - bw / 2 : d.width / 2;
  const v = row === 'top' ? d.height - pad - bh / 2 : row === 'bottom' ? pad + bh / 2 : d.height / 2;
  return { u, v };
}

/** Corner to corner of the page as displayed, in degrees (about 54.7 on A4 portrait). */
export function diagonalAngle(d: DisplayedPage): number {
  return (Math.atan2(d.height, d.width) * 180) / Math.PI;
}

// ---- fonts and text -------------------------------------------------------------------------

export type FontFamily = 'helvetica' | 'times' | 'courier';

const FACES: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  // regular, bold, italic, bold italic
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
const fontCache = new WeakMap<PDFDocument, Map<StandardFonts, PDFFont>>();

/** One embedded font per face and document, however many pages use it. */
export async function embedMarkFont(doc: PDFDocument, family: FontFamily, bold: boolean, italic: boolean): Promise<PDFFont> {
  const face = FACES[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
  let faces = fontCache.get(doc);
  if (!faces) {
    faces = new Map();
    fontCache.set(doc, faces);
  }
  let font = faces.get(face);
  if (!font) {
    font = await doc.embedFont(face);
    faces.set(face, font);
  }
  return font;
}

/** Text width summed per character: drawing prints without kerning, widthOfTextAtSize subtracts kerning pairs. */
export function textWidth(font: PDFFont, text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += font.widthOfTextAtSize(ch, size);
  return w;
}

// Code points that would print as nothing or merge into a neighbour are shown as U+XXXX.
export function describeCharacter(ch: string): string {
  if (/[\p{C}\p{M}\p{Zl}\p{Zp}]/u.test(ch)) return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
  return ch;
}

/** The characters of `text` the built-in font cannot draw, each once. */
export function unsupportedCharacters(font: PDFFont, text: string): string[] {
  const supported = new Set(font.getCharacterSet());
  return [...new Set([...text].filter((ch) => !supported.has(ch.codePointAt(0)!)))];
}

/** What the built-in fonts print today, said after every refusal (QA-FIX H). */
const PRINTABLE_RULE = 'use English letters, digits and common signs (write Rs. for ₹).';
const SHOWN_WORDS = 3;
const WORD_MAX = 20;
/** Characters that print as nothing, so they are named by their code: controls, format characters, separators, broken pairs. */
const INVISIBLE = /[\p{C}\p{Zl}\p{Zp}]/u;
const WORD_GAP = /[\s\u2028\u2029]+/u;

/** A word as typed, for the message: invisible characters left out, a lone combining mark on a dotted circle, a long word cut. */
function shownWord(word: string): string {
  let shown = [...word].filter((ch) => !INVISIBLE.test(ch)).join('');
  if (/^\p{M}/u.test(shown)) shown = `◌${shown}`;
  const letters = [...shown];
  return letters.length > WORD_MAX ? `${letters.slice(0, WORD_MAX).join('')}…` : shown;
}

/**
 * The refusal for characters the built-in fonts cannot print: the words that hold them, as typed
 * ("“मौसम”"), not code points, and in the same sentence what works today. Only characters that would
 * print as nothing are named by their code. `text` is what was typed; without it the characters are shown.
 */
export function unsupportedError(subject: string, bad: string[], text?: string): PdfToolsError {
  const hidden = bad.filter((ch) => INVISIBLE.test(ch));
  const shown = bad.filter((ch) => !INVISIBLE.test(ch));
  const words: string[] = [];
  if (text !== undefined) {
    for (const word of text.split(WORD_GAP)) {
      if (![...word].some((ch) => shown.includes(ch))) continue;
      const display = shownWord(word);
      if (display !== '' && !words.includes(display)) words.push(display);
    }
  } else {
    for (const ch of shown) words.push(shownWord(ch));
  }
  const parts = words.slice(0, SHOWN_WORDS).map((word) => `“${word}”`);
  const more = words.length - SHOWN_WORDS;
  const invisible = hidden.length === 0 ? null : `${hidden.length === 1 ? 'an invisible character' : 'invisible characters'} (${hidden.map(describeCharacter).join(', ')})`;
  const listed = [...parts, ...(more > 0 ? [`${more} more ${more === 1 ? 'word' : 'words'}`] : []), ...(invisible ? [invisible] : [])];
  const named = listed.length < 2 ? listed.join('') : `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1]}`;
  const sentence = `${named.charAt(0).toUpperCase()}${named.slice(1)} cannot be printed in the ${subject}; ${PRINTABLE_RULE}`;
  return new PdfToolsError('unsupported-characters', sentence);
}

/** Throws `unsupported-characters` naming the words that hold them, before anything is drawn. */
export function assertPrintable(font: PDFFont, text: string, subject: string): void {
  const bad = unsupportedCharacters(font, text);
  if (bad.length > 0) throw unsupportedError(subject, bad, text);
}

/**
 * The largest size whose text fits `share` of the line it runs along across the page, and whose turned
 * bounding box stays within 90% of the page in both directions (never above 400 pt). The second rule
 * matters on narrow and short pages (a receipt, a strip), where the line rule alone clips the text.
 */
export function autoSize(text: string, font: PDFFont, d: DisplayedPage, angleDeg: number, share: number): number {
  const unit = textWidth(font, text, 1000) / 1000;
  if (unit <= 0) return 12;
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const chord = Math.min(c < 1e-9 ? Infinity : d.width / c, s < 1e-9 ? Infinity : d.height / s);
  const along = (share * chord) / unit;
  const acrossW = (0.9 * d.width) / (unit * c + CAP_HEIGHT * s);
  const acrossH = (0.9 * d.height) / (unit * s + CAP_HEIGHT * c);
  const size = Math.min(400, along, acrossW, acrossH);
  return Math.max(1, Math.floor(size * 10) / 10);
}

// ---- reading page content (tokens, balance, coverage) ---------------------------------------

type Tok = { k: 'op'; v: string } | { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'other' };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * A small content-stream tokenizer: skips strings, hex strings, comments and inline image data, so
 * that a `q` or `Q` inside them is not counted. Calls `on` for every token.
 */
export function tokenize(s: string, on: (t: Tok) => void): void {
  const n = s.length;
  let i = 0;
  while (i < n) {
    const code = s.charCodeAt(i);
    if (WS.has(code)) { i++; continue; }
    if (code === 37) { // % comment
      while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++;
      continue;
    }
    if (code === 40) { // ( string )
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const c = s.charCodeAt(i);
        if (c === 92) i += 2;
        else {
          if (c === 40) depth++;
          else if (c === 41) depth--;
          i++;
        }
      }
      on({ k: 'other' });
      continue;
    }
    if (code === 60) { // < hex > or <<
      if (s.charCodeAt(i + 1) === 60) { i += 2; on({ k: 'other' }); continue; }
      while (i < n && s.charCodeAt(i) !== 62) i++;
      i++;
      on({ k: 'other' });
      continue;
    }
    if (code === 62) { i += s.charCodeAt(i + 1) === 62 ? 2 : 1; on({ k: 'other' }); continue; }
    if (code === 91 || code === 93 || code === 123 || code === 125 || code === 41) { i++; on({ k: 'other' }); continue; }
    if (code === 47) { // /name
      let j = i + 1;
      while (j < n && !WS.has(s.charCodeAt(j)) && !DELIM.has(s.charCodeAt(j))) j++;
      on({ k: 'name', v: s.slice(i + 1, j) });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !WS.has(s.charCodeAt(j)) && !DELIM.has(s.charCodeAt(j))) j++;
    const word = s.slice(i, j);
    i = j;
    if (NUMBER.test(word)) { on({ k: 'num', v: Number(word) }); continue; }
    on({ k: 'op', v: word });
    if (word === 'ID') { // inline image data runs to a whitespace-delimited EI
      const m = /\sEI(?=[\s]|$)/g;
      m.lastIndex = i;
      const found = m.exec(s);
      i = found ? found.index + found[0].length : n;
      on({ k: 'op', v: 'EI' });
    }
  }
}

export interface Balance {
  /** `q` still open at the end (the stack depth the content leaves behind, never below 0). */
  open: number;
  /** A `Q` with nothing to close was met (`strays` > 0). */
  extraClose: boolean;
  /** How many `Q` had nothing of the content's own to close: each would pop a `q` of ours, so one more is opened per stray. */
  strays: number;
  /** Marked-content sequences (`BMC`/`BDC`) still open: a mark drawn after them would be inside, and hidden with, an optional-content layer that is off. */
  marked: number;
  /** The content ends inside a text object (`BT` without `ET`). */
  inText: boolean;
  /** The content ends with a path built and not painted: a stroke of ours would paint it too. */
  pendingPath: boolean;
}

const PAINT = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's', 'n']);
const BUILD = new Set(['m', 'l', 'c', 'v', 'y', 're']);

/** Counts what the content leaves open at its end: graphics states, marked content, a text object, a path. */
export function scanBalance(content: string): Balance {
  const b: Balance = { open: 0, extraClose: false, strays: 0, marked: 0, inText: false, pendingPath: false };
  tokenize(content, (t) => {
    if (t.k !== 'op') return;
    const op = t.v;
    if (op === 'q') b.open++;
    else if (op === 'Q') {
      if (b.open > 0) b.open--;
      else {
        b.extraClose = true;
        b.strays++;
      }
    } else if (op === 'BMC' || op === 'BDC') b.marked++;
    else if (op === 'EMC') { if (b.marked > 0) b.marked--; }
    else if (op === 'BT') b.inText = true;
    else if (op === 'ET') b.inText = false;
    else if (BUILD.has(op)) b.pendingPath = true;
    else if (PAINT.has(op)) b.pendingPath = false;
  });
  return b;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

const FILTER_LONG: Record<string, string> = {
  Fl: 'FlateDecode', AHx: 'ASCIIHexDecode', A85: 'ASCII85Decode', LZW: 'LZWDecode', RL: 'RunLengthDecode', CCF: 'CCITTFaxDecode', DCT: 'DCTDecode',
};
const DECODABLE = new Set(['FlateDecode', 'LZWDecode', 'ASCIIHexDecode', 'ASCII85Decode', 'RunLengthDecode']);

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Undoes a Flate/LZW predictor: TIFF (2) and PNG (10 to 15, each row names its own filter: None, Sub,
 * Up, Average, Paeth). Only what content streams use is supported with certainty: one colour, 8 bits
 * per component. Anything else gives null (the caller then calls the page unreadable).
 */
export function unpredict(data: Uint8Array, predictor: number, columns: number, colors: number, bpc: number): Uint8Array | null {
  if (predictor === 1) return data;
  if (colors !== 1 || bpc !== 8 || !Number.isInteger(columns) || columns < 1) return null;
  if (predictor === 2) {
    const out = new Uint8Array(data);
    for (let i = 0; i < out.length; i++) if (i % columns !== 0) out[i] = (out[i] + out[i - 1]) & 255;
    return out;
  }
  if (predictor < 10 || predictor > 15) return null;
  const stride = columns + 1;
  const rows = Math.ceil(data.length / stride);
  const out = new Uint8Array(data.length - rows);
  for (let r = 0; r < rows; r++) {
    const tag = data[r * stride];
    const o = r * columns;
    const n = Math.min(columns, data.length - r * stride - 1);
    for (let i = 0; i < n; i++) {
      const raw = data[r * stride + 1 + i];
      const left = i > 0 ? out[o + i - 1] : 0;
      const up = r > 0 ? out[o - columns + i] : 0;
      const upLeft = i > 0 && r > 0 ? out[o - columns + i - 1] : 0;
      let v: number;
      if (tag === 0) v = raw;
      else if (tag === 1) v = raw + left;
      else if (tag === 2) v = raw + up;
      else if (tag === 3) v = raw + ((left + up) >> 1);
      else if (tag === 4) v = raw + paeth(left, up, upLeft);
      else return null;
      out[o + i] = v & 255;
    }
  }
  return out;
}

/**
 * The decoded bytes of a stream, or null when they cannot be trusted. Abbreviated filter names are
 * read as the full ones; Flate and LZW predictors are undone here (pdf-lib ignores them and returns
 * nonsense without an error); a filter pdf-lib does not know, a parameter that matters on any other
 * filter, or a predictor shape not fully supported counts as unreadable.
 */
export function decodeStreamBytes(s: PDFStream): Uint8Array | null {
  if (!(s instanceof PDFRawStream)) return s.getContents();
  const ctx = s.dict.context;
  const filter = s.dict.lookup(PDFName.of('Filter'));
  const parms = s.dict.lookup(PDFName.of('DecodeParms')) ?? s.dict.lookup(PDFName.of('DP'));
  const names = (filter instanceof PDFArray ? filter.asArray().map((f) => ctx.lookup(f)) : filter ? [filter] : [])
    .map((f) => (f instanceof PDFName ? f.decodeText() : ''))
    .map((n) => FILTER_LONG[n] ?? n);
  const params = (parms instanceof PDFArray ? parms.asArray().map((p) => ctx.lookup(p)) : parms ? [parms] : [])
    .map((p) => (p instanceof PDFDict ? p : undefined));
  let bytes = s.contents;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const p = params[i];
    if (!DECODABLE.has(name)) return null;
    const predictable = name === 'FlateDecode' || name === 'LZWDecode';
    if (!predictable && p && p.keys().length > 0) return null;
    try {
      const step = { dict: ctx.obj(p && name === 'LZWDecode' ? { Filter: name, DecodeParms: p } : { Filter: name }), contents: bytes };
      bytes = decodePDFRawStream(step as unknown as PDFRawStream).decode();
    } catch {
      return null;
    }
    if (predictable && p) {
      const num = (k: string, d: number): number => {
        const v = p.lookup(PDFName.of(k));
        return v instanceof PDFNumber ? v.asNumber() : d;
      };
      const out = unpredict(bytes, num('Predictor', 1), num('Columns', 1), num('Colors', 1), num('BitsPerComponent', 8));
      if (out === null) return null;
      bytes = out;
    }
  }
  return bytes;
}

/** The decoded text of a stream object (reference or stream), or null when it cannot be trusted. */
function streamText(page: PDFPage, obj: PDFObject): string | null {
  const s = page.node.context.lookup(obj);
  if (!(s instanceof PDFStream)) return null;
  const bytes = decodeStreamBytes(s);
  return bytes === null ? null : latin1(bytes);
}

function originalContents(page: PDFPage): PDFRef[] {
  const ctx = page.node.context;
  const raw = page.node.get(PDFName.of('Contents'));
  if (!raw) return [];
  const value = ctx.lookup(raw);
  const parts = value instanceof PDFArray ? value.asArray() : [raw];
  return parts.map((p) => (p instanceof PDFRef ? p : ctx.register(p as PDFStream)));
}

/** The page's own content, read before any mark is added; null text when a stream cannot be trusted. */
interface ContentInfo { original: PDFRef[]; text: string | null }
const contentInfos = new WeakMap<object, ContentInfo>();

function contentInfo(page: PDFPage): ContentInfo {
  let info = contentInfos.get(page.node);
  if (!info) {
    const original = originalContents(page);
    const texts: string[] = [];
    let text: string | null = '';
    for (const p of original) {
      const t = streamText(page, p);
      if (t === null) { text = null; break; }
      texts.push(t);
    }
    info = { original, text: text === null ? null : texts.join('\n') };
    contentInfos.set(page.node, info);
  }
  return info;
}

// ---- coverage: what opaque painting lies over an area, for "is a mark behind the page hidden" -------

type Mat = Matrix;
const concat = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
interface Cover { kind: 'image' | 'fill' | 'unknown'; x0: number; y0: number; x1: number; y1: number }

function decodeName(n: string): string {
  return n.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

const OPAQUE = 0.99;

interface Rect { x0: number; y0: number; x1: number; y1: number }
const WHOLE: Rect = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
const meet = (a: Rect, b: Rect): Rect => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
type PatternKind = 'none' | 'tiling' | 'shading';

type MaskKind = 'opaque' | 'transparent' | 'unknown';
/** Each image's soft mask is read once (REV-A S5: a masked picture drawn 300 times was decoded 300 times). */
const maskKinds = new WeakMap<PDFStream, MaskKind>();

/** What an image's soft mask says: 'opaque' (nearly all of it), 'transparent' (it lets the page show), or 'unknown' (cannot be read cheaply). */
function softMaskKind(img: PDFStream): MaskKind {
  let kind = maskKinds.get(img);
  if (kind === undefined) {
    kind = readSoftMask(img);
    maskKinds.set(img, kind);
  }
  return kind;
}

function readSoftMask(img: PDFStream): MaskKind {
  const ctx = img.dict.context;
  const mask = ctx.lookup(img.dict.get(PDFName.of('SMask')));
  if (!(mask instanceof PDFStream)) return 'unknown';
  const bpc = mask.dict.lookup(PDFName.of('BitsPerComponent'));
  const width = mask.dict.lookup(PDFName.of('Width'));
  const height = mask.dict.lookup(PDFName.of('Height'));
  if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8 || !(width instanceof PDFNumber) || !(height instanceof PDFNumber)) return 'unknown';
  if (width.asNumber() * height.asNumber() > 16_000_000) return 'unknown';
  const bytes = decodeStreamBytes(mask);
  if (bytes === null || bytes.length === 0) return 'unknown';
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  return sum / bytes.length >= 0.95 * 255 ? 'opaque' : 'transparent';
}

interface RectPath { x0: number; y0: number; x1: number; y1: number; sign: number }

/** The bounding box of points; a loop, not Math.min(...points): a path of 200,000 points overflows the stack (REV-A S1). */
function boundsOf(pts: readonly (readonly [number, number])[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    // As Math.min and Math.max: a point that is not a number makes the box not a number.
    if (Number.isNaN(x) || Number.isNaN(y)) return { x0: NaN, y0: NaN, x1: NaN, y1: NaN };
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** An axis-aligned rectangle, from a subpath's points, or null. */
function rectOf(pts: [number, number][]): RectPath | null {
  if (pts.length < 4) return null;
  const { x0, y0, x1, y1 } = boundsOf(pts);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    area += ax * by - bx * ay;
  }
  const box = (x1 - x0) * (y1 - y0);
  return box > 0 && Math.abs(area) / 2 >= 0.98 * box ? { x0, y0, x1, y1, sign: Math.sign(area) } : null;
}

const disjoint = (rects: RectPath[]): boolean =>
  rects.every((a, i) => rects.every((b, j) => i >= j || a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0));

/** How deep forms drawn inside forms are read by the coverage check. */
const COVER_FORM_DEPTH = 3;
/** The most form drawings one coverage check reads (REV-A B4: a form drawing itself 30 times took 9.6 s, 1.4 KB). */
const COVER_MAX_FORMS = 256;
/** The most characters of form content one coverage check reads in all (a form drawn many times is read each time). */
const COVER_MAX_FORM_TEXT = 4_000_000;
/** The most painted areas one coverage check keeps; past it the rest of the page counts as painting that cannot be judged. */
const COVER_MAX_AREAS = 50_000;

/**
 * What one coverage check may still read. A form past it (too deep, drawn from inside itself, or over the
 * budget) is not read: it counts as painting that cannot be judged over its box ('unknown'), so the run
 * says the watermark may be hidden but this could not be checked. Never "not hidden" by default.
 */
interface CoverBudget {
  forms: number;
  text: number;
  /** Each form's content, decoded once per check (null: it cannot be read with certainty). */
  texts: Map<PDFStream, string | null>;
  /** The forms being read now: a form drawn from inside itself is not entered again. */
  open: Set<PDFStream>;
  /** COVER_MAX_AREAS were kept: one unknown area over everything stands for the rest. */
  full: boolean;
}
const coverBudget = (): CoverBudget => ({ forms: COVER_MAX_FORMS, text: COVER_MAX_FORM_TEXT, texts: new Map(), open: new Set(), full: false });

/** A dictionary entry that is a dictionary (or an array), looked up; anything else counts as absent, never a throw. */
function dictAt(dict: PDFDict | undefined, key: string): PDFDict | undefined {
  const value = dict?.lookup(PDFName.of(key));
  return value instanceof PDFDict ? value : undefined;
}
function arrayAt(dict: PDFDict | undefined, key: string): PDFArray | undefined {
  const value = dict?.lookup(PDFName.of(key));
  return value instanceof PDFArray ? value : undefined;
}

/** A form's /Matrix, or the identity when it has none or it is not six numbers. */
function formMatrix(form: PDFStream): Mat {
  const matrix = arrayAt(form.dict, 'Matrix');
  const m = matrix ? matrix.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) : [1, 0, 0, 1, 0, 0];
  return m.length === 6 ? (m as Mat) : [1, 0, 0, 1, 0, 0];
}

/** Where a form can paint, in page space: its /BBox through `at`; the whole clip when the box cannot be read. */
function formBox(form: PDFStream, at: Mat): Rect {
  const box = arrayAt(form.dict, 'BBox');
  const n = box?.asArray().map((x) => form.dict.context.lookup(x));
  if (!n || n.length !== 4 || !n.every((x) => x instanceof PDFNumber)) return WHOLE;
  const [a, b, c, d] = (n as PDFNumber[]).map((x) => x.asNumber());
  return boundsOf([apply(at, a, b), apply(at, c, b), apply(at, a, d), apply(at, c, d)]);
}

/** The form's content to read now, charged to the budget; undefined when the budget is spent; null when it cannot be read. */
function formText(form: PDFStream, budget: CoverBudget): string | null | undefined {
  if (budget.forms <= 0) return undefined;
  let text = budget.texts.get(form);
  if (text === undefined) {
    const bytes = decodeStreamBytes(form);
    text = bytes === null ? null : latin1(bytes);
    budget.texts.set(form, text);
  }
  if (text === null) return null;
  if (text.length > budget.text) return undefined;
  budget.forms--;
  budget.text -= text.length;
  return text;
}

/**
 * Collects, in page space, what paints opaquely over an area: images (XObjects, inline; soft masks
 * read), rectangles filled (several in one fill too, when the rule gives no holes), and shadings
 * (`sh`). Everything is cut to the current clip. Unknown: pattern fills of a tiling pattern,
 * images whose mask or colour key cannot be read, and forms the budget does not read (CoverBudget).
 * Ignored: strokes, fills under `/ca` below 1, paths with curves, frames, forms that cannot be decoded.
 */
function collectCovers(page: PDFPage, text: string, resources: PDFDict | undefined, start: Mat, out: Cover[], depth: number, budget: CoverBudget, startClip: Rect = WHOLE, startAlpha = 1): void {
  const ctx = page.node.context;
  let ctm = start;
  let alpha = startAlpha;
  let clip = startClip;
  let pattern: PatternKind = 'none';
  const stack: { ctm: Mat; alpha: number; clip: Rect; pattern: PatternKind }[] = [];
  let nums: number[] = [];
  let lastName = '';
  let nameSeen = false;
  let subpaths: [number, number][][] = [];
  let curved = false;
  let pendingClip = false;
  const begin = (x: number, y: number) => subpaths.push([apply(ctm, x, y)]);
  const extend = (x: number, y: number) => {
    if (subpaths.length === 0) begin(x, y);
    else subpaths[subpaths.length - 1].push(apply(ctm, x, y));
  };
  const push = (kind: Cover['kind'], r: Rect) => {
    if (budget.full) return;
    if (out.length >= COVER_MAX_AREAS) {
      budget.full = true;
      out.push({ kind: 'unknown', ...WHOLE });
      return;
    }
    const c = meet(r, clip);
    if (c.x1 > c.x0 && c.y1 > c.y0) out.push({ kind, ...c });
  };
  const pathBox = (): Rect => {
    const all = subpaths.flat();
    return all.length === 0 ? WHOLE : boundsOf(all);
  };
  const fillPath = (evenOdd: boolean) => {
    if (curved || subpaths.length === 0 || alpha < OPAQUE) return;
    const rects = subpaths.map(rectOf);
    if (rects.some((r) => r === null)) return; // one that is not a rectangle: not counted (a hole or a shape we cannot size)
    const list = rects as RectPath[];
    const usable = list.length === 1 ? list : evenOdd ? (disjoint(list) ? list : []) : (list.every((r) => r.sign === list[0].sign) ? list : []);
    for (const r of usable) push(pattern === 'tiling' ? 'unknown' : 'fill', r);
  };
  const image = (kind: 'image' | 'unknown') => {
    push(kind, boundsOf([apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]));
  };
  tokenize(text, (t) => {
    if (t.k === 'num') { nums.push(t.v); if (nums.length > 8) nums.shift(); return; }
    if (t.k === 'name') { lastName = t.v; nameSeen = true; return; }
    if (t.k !== 'op') return;
    const op = t.v;
    const last = (k: number) => nums.slice(nums.length - k);
    switch (op) {
      case 'q': stack.push({ ctm, alpha, clip, pattern }); break;
      case 'Q': if (stack.length > 0) ({ ctm, alpha, clip, pattern } = stack.pop()!); break;
      case 'cm': if (nums.length >= 6) ctm = concat(last(6) as Mat, ctm); break;
      case 'gs': {
        const gs = dictAt(dictAt(resources, 'ExtGState'), decodeName(lastName));
        const ca = gs?.lookup(PDFName.of('ca'));
        if (ca instanceof PDFNumber) alpha = ca.asNumber();
        break;
      }
      case 'g': case 'rg': case 'k': pattern = 'none'; break;
      case 'cs': pattern = decodeName(lastName) === 'Pattern' ? 'tiling' : 'none'; break;
      case 'sc': case 'scn': {
        if (!nameSeen) break;
        const patterns = dictAt(resources, 'Pattern');
        const p = patterns ? ctx.lookup(patterns.get(PDFName.of(decodeName(lastName)))) : undefined;
        const dict = p instanceof PDFStream ? p.dict : p instanceof PDFDict ? p : undefined;
        const type = dict?.lookup(PDFName.of('PatternType'));
        pattern = type instanceof PDFNumber && type.asNumber() === 2 ? 'shading' : 'tiling';
        break;
      }
      case 'W': case 'W*': pendingClip = true; break;
      case 'm': if (nums.length >= 2) { const [x, y] = last(2); begin(x, y); } break;
      case 'l': if (nums.length >= 2) { const [x, y] = last(2); extend(x, y); } break;
      case 'c': case 'v': case 'y': curved = true; break;
      case 're':
        if (nums.length >= 4) {
          const [x, y, w, h] = last(4);
          begin(x, y);
          extend(x + w, y);
          extend(x + w, y + h);
          extend(x, y + h);
        }
        break;
      case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'S': case 's': case 'n':
        if (op !== 'S' && op !== 's' && op !== 'n') fillPath(op.endsWith('*'));
        if (pendingClip) clip = meet(clip, pathBox());
        pendingClip = false;
        subpaths = [];
        curved = false;
        break;
      case 'sh': if (alpha >= OPAQUE) push('fill', WHOLE); break; // a shading paints the whole clip
      case 'EI': if (alpha >= OPAQUE) image('image'); break; // an inline image, drawn into the unit square
      case 'Do': {
        const xo = dictAt(resources, 'XObject');
        const obj = xo ? ctx.lookup(xo.get(PDFName.of(decodeName(lastName)))) : undefined;
        if (obj instanceof PDFStream) {
          const subtype = obj.dict.lookup(PDFName.of('Subtype'));
          if (subtype === PDFName.of('Image')) {
            if (alpha >= OPAQUE && obj.dict.lookup(PDFName.of('ImageMask')) !== PDFBool.True) {
              if (obj.dict.has(PDFName.of('SMask'))) {
                const kind = softMaskKind(obj);
                if (kind === 'opaque') image('image');
                else if (kind === 'unknown') image('unknown');
              } else if (obj.dict.has(PDFName.of('Mask'))) image('unknown');
              else image('image');
            }
          } else if (subtype === PDFName.of('Form')) {
            const at = concat(formMatrix(obj), ctm);
            const inner = depth < COVER_FORM_DEPTH && !budget.open.has(obj) ? formText(obj, budget) : undefined;
            if (inner === undefined) push('unknown', formBox(obj, at));
            else if (inner !== null) {
              budget.open.add(obj);
              collectCovers(page, inner, dictAt(obj.dict, 'Resources') ?? resources, at, out, depth + 1, budget, clip, alpha);
              budget.open.delete(obj);
            }
          }
        }
        break;
      }
      default: break;
    }
    nums = [];
    nameSeen = false;
  });
}

function share(c: Cover, box: Box): number {
  const w = Math.min(c.x1, box.x + box.width) - Math.max(c.x0, box.x);
  const h = Math.min(c.y1, box.y + box.height) - Math.max(c.y0, box.y);
  return w > 0 && h > 0 ? (w * h) / (box.width * box.height) : 0;
}

export interface Coverage {
  /** Share of the region covered by opaque drawn images (areas added, at most 1). */
  images: number;
  /** Share covered by opaque painting of either kind (images, filled rectangles, shadings; added, at most 1). */
  covered: number;
  /** Share covered by painting that may or may not hide what is behind it (a tiling pattern, an image whose mask cannot be read). */
  unknown: number;
  /** False when a content stream could not be read: the shares are then 0 and unknown. */
  known: boolean;
}

/** How much of `region` (default: the visible box), in the page's user space, opaque painting covers. */
export function pageCoverage(page: PDFPage, region?: Box): Coverage {
  const info = contentInfo(page);
  if (info.text === null) return { images: 0, covered: 0, unknown: 0, known: false };
  const covers: Cover[] = [];
  const own = page.node.context.lookup(page.node.getInheritableAttribute(PDFName.of('Resources')));
  collectCovers(page, info.text, own instanceof PDFDict ? own : undefined, [1, 0, 0, 1, 0, 0], covers, 0, coverBudget());
  const box = region ?? visibleBox(page);
  let images = 0;
  let covered = 0;
  let unknown = 0;
  for (const c of covers) {
    const s = share(c, box);
    if (c.kind === 'unknown') unknown += s;
    else covered += s;
    if (c.kind === 'image') images += s;
  }
  return { images: Math.min(1, images), covered: Math.min(1, covered), unknown: Math.min(1, unknown), known: true };
}

/** No text and an image drawn over 90% of the page: a scan. */
export function looksScanned(page: PDFPage, hasText: boolean): boolean {
  return !hasText && pageCoverage(page).images >= 0.9;
}

/** The page has form fields (widgets): marks drawn in front are painted under them. An /Annots that is not a list holds none (as pdf.js reads it). */
export function hasWidgets(page: PDFPage): boolean {
  const annots = arrayAt(page.node, 'Annots');
  if (!annots) return false;
  for (let i = 0; i < annots.size(); i++) {
    const a = annots.lookup(i);
    if (a instanceof PDFDict && a.lookup(PDFName.of('Subtype')) === PDFName.of('Widget')) return true;
  }
  return false;
}

/**
 * A page that the page tree lists twice, with at least one of its places in `from`..`to` (from 1), as
 * [its first place, the next place], or null. Such a page is one object shown twice: a mark (or a new
 * size) for one place would land on both (REV-A S6), so the tools refuse it.
 */
export function pageListedTwice(pages: readonly PDFPage[], from: number, to: number): [number, number] | null {
  const seen = new Map<object, number>();
  const inRange = (n: number) => n >= from && n <= to;
  for (let n = 1; n <= pages.length; n++) {
    const first = seen.get(pages[n - 1].node);
    if (first === undefined) seen.set(pages[n - 1].node, n);
    else if (inRange(first) || inRange(n)) return [first, n];
  }
  return null;
}

// ---- drawing: per-document and per-page state ------------------------------------------------

class ResourceSet {
  private readonly names = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  private readonly cloned = new Set<string>();
  constructor(readonly dict: PDFDict, readonly ref: PDFRef, readonly doc: PDFDocument, readonly runId: number) {}

  /** The key under which `ref` is registered in category `cat`, adding it on first use. */
  nameFor(cat: 'Font' | 'ExtGState' | 'XObject', prefix: string, ref: PDFRef): string {
    const id = `${cat}:${ref.tag}`;
    const known = this.names.get(id);
    if (known) return known;
    const catKey = PDFName.of(cat);
    if (!this.cloned.has(cat)) {
      // A category that is not a dictionary names nothing a reader can use (pdf.js ignores it): ours replaces it.
      const own = dictAt(this.dict, cat);
      this.dict.set(catKey, own ? own.clone(this.doc.context) : this.doc.context.obj({}));
      this.cloned.add(cat);
    }
    const sub = this.dict.lookup(catKey, PDFDict);
    const index = (this.counts.get(cat) ?? 0) + 1;
    this.counts.set(cat, index);
    const name = `VRA${this.runId}_${prefix}${index}`;
    sub.set(PDFName.of(name), ref);
    this.names.set(id, name);
    return name;
  }
}

interface PageState {
  original: PDFRef[];
  balance: Balance;
  unverified: boolean;
  resources: ResourceSet;
  behind: PDFRef[];
  front: PDFRef[];
}

interface DocState {
  runId: number;
  open: PDFRef | null;
  /** The opening streams for content with stray `Q`, by their count: `q` once more for each. */
  openers: Map<number, PDFRef>;
  closers: Map<string, PDFRef>;
  resources: Map<unknown, ResourceSet>;
  gs: Map<number, PDFRef>;
  pages: WeakMap<object, PageState>;
}
const docStates = new WeakMap<PDFDocument, DocState>();

/** The page's resources entry, its own or inherited; undefined when the page tree cannot be climbed (a node that is its own parent). */
function inheritedResources(page: PDFPage): PDFObject | undefined {
  try {
    return page.node.getInheritableAttribute(PDFName.of('Resources'));
  } catch {
    return undefined;
  }
}

/** The highest run number of marks already on the pages (`VRA<n>_` names), so a new run's names never collide. */
function* highestRun(doc: PDFDocument): Work<number> {
  const seen = new Set<unknown>();
  let highest = 0;
  for (const page of doc.getPages()) {
    yield;
    const found = doc.context.lookup(inheritedResources(page));
    const res = found instanceof PDFDict ? found : undefined;
    if (!res || seen.has(res)) continue;
    seen.add(res);
    for (const cat of ['Font', 'ExtGState', 'XObject']) {
      const sub = dictAt(res, cat);
      if (!sub) continue;
      for (const key of sub.keys()) {
        const m = /^VRA(\d+)_/.exec(key.decodeText());
        if (m) highest = Math.max(highest, Number(m[1]));
      }
    }
  }
  return highest;
}

const newDocState = (runId: number): DocState => ({ runId, open: null, openers: new Map(), closers: new Map(), resources: new Map(), gs: new Map(), pages: new WeakMap() });

function docState(doc: PDFDocument): DocState {
  let s = docStates.get(doc);
  if (!s) {
    s = newDocState(runAtOnce(highestRun(doc)) + 1);
    docStates.set(doc, s);
  }
  return s;
}

/**
 * Reads the pages for earlier runs' marks before the first page is drawn, giving the window its turns
 * (REV-A B6: on 2,000 pages the first drawing held the window 0.7 s while this ran inside it). Drawing
 * without it reads them at the first page, in one stretch.
 */
export async function prepareMarks(doc: PDFDocument, pace: Pace): Promise<void> {
  if (docStates.has(doc)) return;
  const runId = (await runPaced(highestRun(doc), pace)) + 1;
  if (!docStates.has(doc)) docStates.set(doc, newDocState(runId));
}

function stateOf(doc: PDFDocument, page: PDFPage): PageState {
  const ds = docState(doc);
  let ps = ds.pages.get(page.node);
  if (ps) return ps;
  const ctx = doc.context;
  // Resources: one clone for every page that shares the same original dictionary. Resources that are not a
  // dictionary give the page nothing a reader can use (pdf.js reads them as none): ours replace them.
  const raw = page.node.getInheritableAttribute(PDFName.of('Resources'));
  const key: unknown = raw instanceof PDFRef ? raw.tag : raw ?? page.node;
  let rs = ds.resources.get(key);
  if (!rs) {
    const found = ctx.lookup(raw);
    const original = found instanceof PDFDict ? found : undefined;
    const clone = original ? original.clone(ctx) : ctx.obj({});
    rs = new ResourceSet(clone, ctx.register(clone), doc, ds.runId);
    ds.resources.set(key, rs);
  }
  page.node.set(PDFName.of('Resources'), rs.ref);

  const info = contentInfo(page);
  // Content that cannot be trusted is assumed to be in order (one `Q`), and the page is reported.
  const balance = info.text === null ? { open: 0, extraClose: false, strays: 0, marked: 0, inText: false, pendingPath: false } : scanBalance(info.text);
  ps = { original: info.original, balance, unverified: info.text === null, resources: rs, behind: [], front: [] };
  ds.pages.set(page.node, ps);
  return ps;
}

function commit(doc: PDFDocument, page: PDFPage, ps: PageState): void {
  const ds = docState(doc);
  const ctx = doc.context;
  let parts: PDFRef[];
  if (ps.front.length === 0) parts = [...ps.behind, ...ps.original];
  else {
    const b = ps.balance;
    // A `q` more for each stray `Q`, so that a stray pops one of ours, never the one that protects the mark (S4).
    let open = b.strays === 0 ? (ds.open ??= ctx.register(ctx.flateStream('q'))) : ds.openers.get(b.strays);
    if (!open) {
      open = ctx.register(ctx.flateStream(Array.from({ length: b.strays + 1 }, () => 'q').join('\n')));
      ds.openers.set(b.strays, open);
    }
    // Close what the content left open, innermost first: a text object, a pending path, marked content
    // (a mark inside an optional-content layer that is off would vanish), then the graphics states.
    const key = `${b.open}|${b.marked}|${b.inText ? 1 : 0}|${b.pendingPath ? 1 : 0}`;
    let closer = ds.closers.get(key);
    if (!closer) {
      const ops = [
        ...(b.inText ? ['ET'] : []),
        ...(b.pendingPath ? ['n'] : []),
        ...Array.from({ length: b.marked }, () => 'EMC'),
        ...Array.from({ length: b.open + 1 }, () => 'Q'),
      ];
      closer = ctx.register(ctx.flateStream(ops.join('\n')));
      ds.closers.set(key, closer);
    }
    parts = [...ps.behind, open, ...ps.original, closer, ...ps.front];
  }
  page.node.set(PDFName.of('Contents'), ctx.obj(parts));
}

export interface MarkNamer {
  font(font: PDFFont): string;
  /** The graphics-state name for an opacity, or null at full opacity (nothing to set). */
  opacity(alpha: number): string | null;
  image(image: PDFImage): string;
}

/** What a page's content leaves behind: used to flag pages where a mark in front may be misplaced. */
export interface PageHealth {
  /** More `Q` than `q`: the stray `Q` pops our own `q`, a mark in front may be misplaced. */
  damaged: boolean;
  /** A content stream could not be decoded: assumed balanced. */
  unverified: boolean;
}

/** Reads the page's own content (as it was before any mark); changes nothing. */
export function pageHealth(page: PDFPage): PageHealth {
  const info = contentInfo(page);
  return { damaged: info.text !== null && scanBalance(info.text).extraClose, unverified: info.text === null };
}

/**
 * Draws on a page: `build` returns the operators (already in the page's own coordinates) and may ask
 * for resource names. The operators are wrapped in their own `q … Q`.
 */
export function drawOnPage(doc: PDFDocument, page: PDFPage, layer: 'behind' | 'front', build: (namer: MarkNamer) => string): void {
  const ps = stateOf(doc, page);
  const ds = docState(doc);
  const namer: MarkNamer = {
    font: (f) => ps.resources.nameFor('Font', 'F', f.ref),
    image: (i) => ps.resources.nameFor('XObject', 'I', i.ref),
    opacity: (alpha) => {
      if (alpha >= 1) return null;
      let ref = ds.gs.get(alpha);
      if (!ref) {
        ref = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha }));
        ds.gs.set(alpha, ref);
      }
      return ps.resources.nameFor('ExtGState', 'G', ref);
    },
  };
  const ops = build(namer);
  const stream = doc.context.register(doc.context.flateStream(`q\n${ops}\nQ`));
  (layer === 'behind' ? ps.behind : ps.front).push(stream);
  commit(doc, page, ps);
}

/** A number as PDF writes it: plain decimals, never an exponent. */
export const num = (x: number): string => String(Math.round(x * 10000) / 10000 || 0);
export const matrixOp = (m: readonly number[]): string => `${m.map(num).join(' ')} cm`;
export const colorOp = (c: { r: number; g: number; b: number }, stroke = false): string => `${num(c.r)} ${num(c.g)} ${num(c.b)} ${stroke ? 'RG' : 'rg'}`;

export interface TextMark {
  text: string;
  font: PDFFont;
  size: number;
  angleDeg: number;
  opacity: number;
  color: { r: number; g: number; b: number };
  placement: Placement;
  layer: 'behind' | 'front';
}
export interface ImageMark {
  image: PDFImage;
  widthShare: number;
  maxHeightShare: number;
  minWidthPt: number;
  opacity: number;
  placement: Placement;
}

export function addTextMark(doc: PDFDocument, page: PDFPage, mark: TextMark): void {
  assertPrintable(mark.font, mark.text, 'mark text');
  const d = displayedPage(page);
  const w = textWidth(mark.font, mark.text, mark.size);
  const h = mark.size * CAP_HEIGHT;
  const { u, v } = placeBox(d, w, h, mark.angleDeg, mark.placement);
  const rad = (mark.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  drawOnPage(doc, page, mark.layer, (namer) => {
    const gs = namer.opacity(mark.opacity);
    return [
      gs ? `/${gs} gs` : '',
      matrixOp(readerMatrix(d)),
      `${cos.toFixed(6)} ${sin.toFixed(6)} ${(-sin).toFixed(6)} ${cos.toFixed(6)} ${num(u)} ${num(v)} cm`,
      colorOp(mark.color),
      `BT /${namer.font(mark.font)} ${num(mark.size)} Tf 1 0 0 1 ${num(-w / 2)} ${num(-h / 2)} Tm ${mark.font.encodeText(mark.text).toString()} Tj ET`,
    ].filter(Boolean).join('\n');
  });
}

export function addImageMark(doc: PDFDocument, page: PDFPage, mark: ImageMark): { widthPt: number; heightPt: number } {
  const d = displayedPage(page);
  let w = Math.max(mark.minWidthPt, d.width * mark.widthShare);
  let h = (w * mark.image.height) / mark.image.width;
  if (h > d.height * mark.maxHeightShare) {
    h = d.height * mark.maxHeightShare;
    w = (h * mark.image.width) / mark.image.height;
  }
  const { u, v } = placeBox(d, w, h, 0, mark.placement);
  drawOnPage(doc, page, 'front', (namer) => {
    const gs = namer.opacity(mark.opacity);
    return [
      gs ? `/${gs} gs` : '',
      matrixOp(readerMatrix(d)),
      matrixOp([w, 0, 0, h, u - w / 2, v - h / 2]),
      `/${namer.image(mark.image)} Do`,
    ].filter(Boolean).join('\n');
  });
  return { widthPt: w, heightPt: h };
}

/** A ring, in the reader frame (the caller has set the reader matrix), of the given centre and radius. */
export function ringOps(u: number, v: number, r: number, lineWidth: number, color: { r: number; g: number; b: number }): string {
  const k = 0.5522847498 * r;
  return [
    'q',
    `${num(lineWidth)} w`,
    colorOp(color, true),
    `${num(u + r)} ${num(v)} m`,
    `${num(u + r)} ${num(v + k)} ${num(u + k)} ${num(v + r)} ${num(u)} ${num(v + r)} c`,
    `${num(u - k)} ${num(v + r)} ${num(u - r)} ${num(v + k)} ${num(u - r)} ${num(v)} c`,
    `${num(u - r)} ${num(v - k)} ${num(u - k)} ${num(v - r)} ${num(u)} ${num(v - r)} c`,
    `${num(u + k)} ${num(v - r)} ${num(u + r)} ${num(v - k)} ${num(u + r)} ${num(v)} c`,
    'S',
    'Q',
  ].join('\n');
}

/** The share of a watermark's own area that opaque painting must cover for a warning that it may be hidden. */
export const HIDDEN_SHARE = 0.5;
export const PRODUCER = 'ICAI VERA';

/**
 * Where a w x h mark turned by `angleDeg` lies: its page-space bounding box (user units, for the
 * coverage scan) and whether all of it is inside the visible page.
 */
export function markRegion(d: DisplayedPage, w: number, h: number, angleDeg: number, placement: Placement): { region: Box; inside: boolean } {
  const rad = (angleDeg * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const { u, v } = placeBox(d, w, h, angleDeg, placement);
  const m = readerMatrix(d);
  const corners = [[u - bw / 2, v - bh / 2], [u + bw / 2, v + bh / 2]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const x0 = Math.min(corners[0][0], corners[1][0]);
  const y0 = Math.min(corners[0][1], corners[1][1]);
  const inside = u - bw / 2 >= -0.5 && u + bw / 2 <= d.width + 0.5 && v - bh / 2 >= -0.5 && v + bh / 2 <= d.height + 0.5;
  return { region: { x: x0, y: y0, width: Math.abs(corners[1][0] - corners[0][0]), height: Math.abs(corners[1][1] - corners[0][1]) }, inside };
}

// ---- what a run tells its caller ----------------------------------------------------------------

/** What a run noticed about the pages it marked (1-based page numbers). The dialog decides what to show. */
export interface MarkReport {
  /** A watermark behind the page may be hidden: opaque pictures or filled rectangles cover half or more of the watermark's own area (HIDDEN_SHARE). */
  hiddenBehind: number[];
  /** Painting over the watermark's area could not be judged (a pattern fill, an image mask that cannot be read) and could reach half of it. A weaker note than hiddenBehind. */
  uncertain: number[];
  /** A watermark is larger than the visible page on these pages, so part of it is cut off. */
  clipped: number[];
  /** A mark in front may be misplaced: the page's own drawing instructions close more than they open. */
  damaged: number[];
  /** The page's content could not be read to check this: assumed to be in order. */
  unverified: number[];
  /** A mark in front of the page is painted under the page's form fields. */
  underFields: number[];
}
export interface MarkHooks {
  /** Called before each page is marked, with the pages marked so far; it stops the run by throwing (a cancel). */
  onPage?: (done: number, total: number) => void | Promise<void>;
  report?: MarkReport;
  /** The run's Stop check, asked after each wait while the file is read (pace.ts loadPaced); it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
}
export function emptyMarkReport(): MarkReport {
  return { hiddenBehind: [], uncertain: [], clipped: [], damaged: [], unverified: [], underFields: [] };
}
