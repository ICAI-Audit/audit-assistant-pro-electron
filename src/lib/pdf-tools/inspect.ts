import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { ACRO_FORM, asArray, asDict, FIELDS, isFieldNode, isPushButton, isSignatureField, KIDS, MAX_FIELD_DEPTH } from './formFields';
import { loadPaced } from './pace';
import { inflatePrefix } from './tiffCodecs';
import { PdfToolsError, type CarriedContent, type CarriedProperty } from './types';

/**
 * The object count pdf-lib is given as its slice. It now lives in pace.ts (pace.ts would otherwise import
 * this file while this file uses its paced load); the other modules may keep importing it from here. Every
 * non-Redact load and save of PDF Tools gives the window a turn by the clock, at least every 50 ms of work
 * (pace.ts: loadPaced, savePaced, withClockWaits), and the tools' own loops do the same, so the screen
 * paints and Stop is seen between pages or files. The count matters only where the library is called
 * directly (Redact's files) or its insides are not as expected: a slice of 1,500 objects takes up to 0.14 s
 * of processor time on a 320-page ledger and 0.22 s on a 2,000-page one; a save's longest stretch is about
 * 0.17 s whatever this number is.
 */
export { PARSE_OBJECTS_PER_TICK } from './pace';

export interface PdfInfo {
  encrypted: boolean;
  pageCount: number | null; // null while encrypted
  hasSignature: boolean;
  /** An /AcroForm with at least one field that can hold a value: not a signature field or push button (false while encrypted). */
  hasFormFields: boolean;
  /** An /Outlines with at least one bookmark (false while encrypted). */
  hasBookmarks: boolean;
  /** A link on a page that goes to a page of this file (false while encrypted). */
  hasPageLinks: boolean;
  /**
   * Attachments in the document's list: a /Names /EmbeddedFiles name tree with at least one entry
   * (false while encrypted). Split, Delete pages and Merge do not carry them; Organise pages does.
   */
  hasAttachments: boolean;
  /**
   * What a copy of this file still carries besides its pages: comments that hold text, attached files
   * (in the document's list and on pages) and the document properties filled in (from the document
   * information and the XMP metadata). Counts only; nothing while encrypted.
   */
  carried: CarriedContent;
}

/** Nothing carried: no comment, no attachment, no property filled in. */
export const nothingCarried = (): CarriedContent => ({ comments: 0, attachments: 0, properties: [] });

/** Whether `carried` holds anything worth a word. */
export const carriesAnything = (carried: CarriedContent | undefined): carried is CarriedContent =>
  carried !== undefined && (carried.comments > 0 || carried.attachments > 0 || carried.properties.length > 0);

const HEADER_WINDOW = 1024;
const TAIL_WINDOW = 2048;

function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, HEADER_WINDOW) - 4;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

/**
 * The first `needle` (ASCII) that starts in [from, to), or -1. The platform's own search finds each
 * candidate's first byte (a plain loop took seconds over a 59 MB scan); it never looks past `to`.
 */
function indexOfAscii(bytes: Uint8Array, needle: string, from = 0, to = bytes.length): number {
  const n = needle.length;
  const end = Math.min(to, bytes.length - n + 1); // a match starts before this
  if (from >= end) return -1;
  const view = end < bytes.length ? bytes.subarray(0, end) : bytes;
  const first = needle.charCodeAt(0);
  for (let i = view.indexOf(first, from); i >= 0; i = view.indexOf(first, i + 1)) {
    let j = 1;
    while (j < n && bytes[i + j] === needle.charCodeAt(j)) j++;
    if (j === n) return i;
  }
  return -1;
}

/** Bytes searched in one stretch: a search through a large file gives the window a turn between stretches. */
const SCAN_SLICE_BYTES = 4 * 1024 * 1024;
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One pass through a file, front to back, that gives the window a turn after each SCAN_SLICE_BYTES searched. */
class Scan {
  private turnAt: number;
  constructor(private readonly bytes: Uint8Array) {
    this.turnAt = SCAN_SLICE_BYTES;
  }

  /** The first `needle` at or after `from` (positions only move forward in one pass), or -1. */
  async find(needle: string, from: number): Promise<number> {
    let start = from;
    for (;;) {
      if (start >= this.turnAt) {
        await turn();
        this.turnAt = start + SCAN_SLICE_BYTES;
      }
      const found = indexOfAscii(this.bytes, needle, start, this.turnAt);
      if (found >= 0) return found;
      if (this.turnAt >= this.bytes.length) return -1;
      start = this.turnAt;
    }
  }
}

const containsAscii = (bytes: Uint8Array, needle: string) => indexOfAscii(bytes, needle) >= 0;
const containsAsciiPaced = async (bytes: Uint8Array, needle: string) => (await new Scan(bytes).find(needle, 0)) >= 0;

/** An indirect security dictionary: /Filter /Standard with its /O and /U password checks. */
function hasSecurityDictionary(doc: PDFDocument): boolean {
  return doc.context
    .enumerateIndirectObjects()
    .some(
      ([, object]) =>
        object instanceof PDFDict &&
        object.get(PDFName.of('Filter')) === PDFName.of('Standard') &&
        object.has(PDFName.of('O')) &&
        object.has(PDFName.of('U')),
    );
}

/**
 * A classic trailer or a cross-reference stream (which carries the trailer entries) is present.
 * An intact file ends with `startxref`, so the last 2 KB settle it; only a file without one is
 * scanned in full.
 */
async function hasTrailer(bytes: Uint8Array): Promise<boolean> {
  if (containsAscii(bytes.subarray(Math.max(0, bytes.length - TAIL_WINDOW)), 'startxref')) return true;
  return (await containsAsciiPaced(bytes, 'trailer')) || containsAsciiPaced(bytes, '/XRef');
}

// A real object or generation number has at most 10 digits; a longer run is cut short rather than spread onto the stack.
const latin1 = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, Math.min(to, from + 11)));

function refersToSecurityDictionary(doc: PDFDocument, number: number, generation: number): boolean {
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(generation)) return false;
  const target = doc.context.lookup(PDFRef.of(number, generation));
  return target instanceof PDFDict && target.get(PDFName.of('Filter')) === PDFName.of('Standard');
}

/**
 * The stream bodies of a file, found once, front to back, and only as far as they are asked about. A
 * stream starts at a `stream` keyword that follows a dictionary (`>>`, optional whitespace) and is
 * followed by CR or LF (a word that merely contains "stream" is not one), and ends at the next
 * `endstream`, or at the end of the file when there is none. Asking whether each of n positions lies in
 * a body costs one pass over the file in all (it was one pass for each position: a few thousand
 * `/Encrypt<<` in an 82 KB file held the window for 25 s).
 */
class StreamBodies {
  /** start, end pairs in file order; end is Infinity for a body that runs to the end of the file. */
  private readonly ranges: number[] = [];
  private from = 0;
  private done = false;
  private readonly scan: Scan;
  constructor(private readonly bytes: Uint8Array) {
    this.scan = new Scan(bytes);
  }

  private async next(): Promise<void> {
    let start = await this.scan.find('stream', this.from);
    while (start >= 0 && !isStreamKeyword(this.bytes, start)) start = await this.scan.find('stream', start + 1);
    if (start < 0) {
      this.done = true;
      return;
    }
    const end = await this.scan.find('endstream', start + 6);
    this.ranges.push(start, end < 0 ? Infinity : end);
    if (end < 0) this.done = true;
    else this.from = end + 9;
  }

  /** Whether `at` lies in a stream body. Positions may be asked in any order; the bodies are read once. */
  async contain(at: number): Promise<boolean> {
    // every body that starts before `at` must be known: read on until one starts at or after it
    while (!this.done && (this.ranges.length === 0 || this.ranges[this.ranges.length - 2] < at)) await this.next();
    // the bodies do not overlap, so only the last one that starts before `at` can hold it
    let low = 0;
    let high = this.ranges.length / 2 - 1;
    let last = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.ranges[mid * 2] < at) {
        last = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return last >= 0 && this.ranges[last * 2 + 1] > at;
  }
}

/**
 * `/Encrypt` names looked at before a file is refused as made to mislead. A protected file names its
 * security dictionary once in each trailer, and the stream bodies of an honest file hold the words a few
 * times at most; with more than this, whether the file is protected cannot be told quickly.
 */
const MAX_ENCRYPT_NAMES = 10_000;

function isStreamKeyword(bytes: Uint8Array, at: number): boolean {
  const after = bytes[at + 6];
  if (after !== 0x0d && after !== 0x0a) return false;
  let i = at - 1;
  while (i >= 0 && isPdfWhitespace(bytes[i])) i--;
  return i >= 1 && bytes[i] === 0x3e && bytes[i - 1] === 0x3e;
}

const isPdfWhitespace = (byte: number) => byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;
const isDigit = (byte: number) => byte >= 0x30 && byte <= 0x39;

/**
 * The bytes hold an /Encrypt entry: /Encrypt followed by a dictionary (`<<`) or by a reference
 * (`n g R`) to a security dictionary (a dictionary whose /Filter is /Standard). The same text inside
 * a content stream refers to nothing of the kind. One pass over the file, with turns for the window;
 * `tooMany` is thrown past MAX_ENCRYPT_NAMES names.
 */
async function namesEncrypt(bytes: Uint8Array, doc: PDFDocument, tooMany: () => Error): Promise<boolean> {
  const names = new Scan(bytes);
  const bodies = new StreamBodies(bytes);
  let looked = 0;
  for (let at = await names.find('/Encrypt', 0); at >= 0; at = await names.find('/Encrypt', at + 1)) {
    if (++looked > MAX_ENCRYPT_NAMES) throw tooMany();
    let i = at + '/Encrypt'.length;
    const skip = (test: (byte: number) => boolean) => {
      const start = i;
      while (i < bytes.length && test(bytes[i])) i++;
      return i > start;
    };
    skip(isPdfWhitespace);
    if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c && !(await bodies.contain(at))) return true; // << (a trailer or cross-reference stream dictionary)
    const numberStart = i;
    if (skip(isDigit)) {
      const number = Number(latin1(bytes, numberStart, i));
      skip(isPdfWhitespace);
      const generationStart = i;
      if (skip(isDigit)) {
        const generation = Number(latin1(bytes, generationStart, i));
        if (skip(isPdfWhitespace) && bytes[i] === 0x52 && refersToSecurityDictionary(doc, number, generation)) return true; // n g R
      }
    }
  }
  return false;
}

const FLATE = PDFName.of('FlateDecode');
/** Decoded bytes read of XMP metadata or of a comment's rich text: far more than either holds. */
const MAX_TEXT_READ = 4 * 1024 * 1024;
/** Decoded bytes of a content stream checked to tell whether it decompresses (encrypted data fails at once). */
const MAX_CONTENTS_CHECKED = 64 * 1024 * 1024;
/** Stored bytes of a stream with a filter other than Flate that is decoded whole for its text. */
const SMALL_OTHER_FILTER = 64 * 1024;

/**
 * At most `max` bytes of a stream's data, decoded, without decoding the rest (a 510 KB XMP stream that
 * inflates to 512 MB held the window for 27 s), or null when it cannot be decoded. Data with no filter
 * is read as it is and Flate with a bounded inflater; another filter is decoded whole, by pdf-lib, only
 * when its stored data is small ('small only') or always ('any size', where only the outcome counts).
 */
function decodedPrefix(stream: PDFRawStream, max: number, otherFilters: 'small only' | 'any size'): Uint8Array | null {
  try {
    const { dict } = stream;
    const filter = dict.lookup(PDFName.of('Filter'));
    const filters = filter instanceof PDFArray ? filter.asArray().map((f) => dict.context.lookup(f)) : filter === undefined ? [] : [filter];
    const parms = dict.lookup(PDFName.of('DecodeParms'));
    const predictor = parms instanceof PDFDict ? parms.lookup(PDFName.of('Predictor')) : undefined;
    const noPredictor = parms === undefined || (parms instanceof PDFDict && (predictor === undefined || (predictor instanceof PDFNumber && predictor.asNumber() <= 1)));
    const raw = stream.contents;
    if (filters.length === 0) return raw.subarray(0, max);
    if (filters.length === 1 && filters[0] === FLATE && noPredictor) return inflatePrefix(raw, max);
    if (otherFilters === 'small only' && raw.length > SMALL_OTHER_FILTER) return null;
    return decodePDFRawStream(stream).decode().subarray(0, max);
  } catch {
    return null;
  }
}

/** Every page's content streams are present and, where compressed, decompress. Encrypted ones do not. */
function contentsDecode(doc: PDFDocument): boolean {
  try {
    for (const page of doc.getPages()) {
      const named = page.node.get(PDFName.of('Contents'));
      if (!named) continue; // a page with no content
      const contents = doc.context.lookup(named);
      const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
      for (const stream of streams) {
        if (!(stream instanceof PDFRawStream)) return false; // cut off or unreadable
        if (stream.dict.get(PDFName.of('Filter')) && decodedPrefix(stream, MAX_CONTENTS_CHECKED, 'any size') === null) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

const PARENT = PDFName.of('Parent');
/** Page-tree levels above a page (pdf.js stops looking for an inherited attribute after 100). */
const MAX_TREE_DEPTH = 1024;

/**
 * Every page's chain of /Parent entries ends, within MAX_TREE_DEPTH levels. Each node of the tree is
 * followed once, however many pages share it. Also used by Compress (compress.ts), which reads inherited
 * page attributes. Throws what pdf-lib's page walk throws (a /Kids loop overflows the stack).
 */
export function parentChainsEnd(doc: PDFDocument): boolean {
  const { context } = doc;
  const depthOf = new Map<PDFDict, number>(); // nodes whose chain ends, with the levels from them to its end
  for (const page of doc.getPages()) {
    const path: PDFDict[] = [];
    const onPath = new Set<PDFDict>();
    let node: PDFDict | undefined = page.node;
    let above = 0;
    while (node) {
      const known = depthOf.get(node);
      if (known !== undefined) {
        above = known;
        break;
      }
      if (onPath.has(node) || path.length >= MAX_TREE_DEPTH) return false; // a loop, or too deep to be a page tree
      onPath.add(node);
      path.push(node);
      const parent = context.lookup(node.get(PARENT));
      node = parent instanceof PDFDict ? parent : undefined;
    }
    if (above + path.length > MAX_TREE_DEPTH) return false;
    for (let k = path.length - 1, depth = above + 1; k >= 0; k--, depth++) depthOf.set(path[k], depth);
  }
  return true;
}

// ---- what Split, Delete pages and Merge may not carry: form fields, bookmarks, links -------------

const OUTLINES = PDFName.of('Outlines');
const FIRST = PDFName.of('First');
const ANNOTS = PDFName.of('Annots');
const SUBTYPE = PDFName.of('Subtype');
const LINK = PDFName.of('Link');
const DEST = PDFName.of('Dest');
const ACTION = PDFName.of('A');
const ACTION_TYPE = PDFName.of('S');
const GO_TO = PDFName.of('GoTo');
const MAX_FIELDS_VISITED = 100_000;

/** A field that can be filled in: one with no child fields, other than a signature field. */
function hasFillableField(doc: PDFDocument): boolean {
  const { context } = doc;
  const form = asDict(context, doc.catalog.get(ACRO_FORM));
  const stack: [PDFObject, number][] = asArray(context, form?.get(FIELDS)).map((entry) => [entry, 0]);
  const seen = new Set<PDFObject>();
  while (stack.length > 0 && seen.size < MAX_FIELDS_VISITED) {
    const [entry, depth] = stack.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    const field = asDict(context, entry);
    if (!field) continue;
    const children = asArray(context, field.get(KIDS)).filter((kid) => {
      const dict = asDict(context, kid);
      return dict !== undefined && isFieldNode(dict);
    });
    if (children.length === 0) {
      if (!isSignatureField(context, field) && !isPushButton(context, field)) return true;
    } else if (depth < MAX_FIELD_DEPTH) {
      for (const child of children) stack.push([child, depth + 1]);
    }
  }
  return false;
}

function hasOutline(doc: PDFDocument): boolean {
  const outlines = asDict(doc.context, doc.catalog.get(OUTLINES));
  return asDict(doc.context, outlines?.get(FIRST)) !== undefined;
}

function hasLinkToPage(doc: PDFDocument): boolean {
  const { context } = doc;
  const name = (object: PDFObject | undefined) => (object instanceof PDFRef ? context.lookup(object) : object);
  for (const page of doc.getPages()) {
    for (const entry of asArray(context, page.node.get(ANNOTS))) {
      const annotation = asDict(context, entry);
      if (!annotation || name(annotation.get(SUBTYPE)) !== LINK) continue;
      if (annotation.has(DEST)) return true;
      const action = asDict(context, annotation.get(ACTION));
      if (action && name(action.get(ACTION_TYPE)) === GO_TO) return true;
    }
  }
  return false;
}

const NAMES = PDFName.of('Names');
const EMBEDDED_FILES = PDFName.of('EmbeddedFiles');
const MAX_NAME_TREE_NODES = 10_000;

/** The document's embedded-files name tree has an entry: a node with a name and its value, at any depth. */
function hasEmbeddedFile(doc: PDFDocument): boolean {
  const { context } = doc;
  const names = asDict(context, doc.catalog.get(NAMES));
  const stack: PDFObject[] = [];
  const root = names?.get(EMBEDDED_FILES);
  if (root) stack.push(root);
  const seen = new Set<PDFObject>();
  while (stack.length > 0 && seen.size < MAX_NAME_TREE_NODES) {
    const entry = stack.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    const node = asDict(context, entry);
    if (!node) continue;
    if (asArray(context, node.get(NAMES)).length >= 2) return true;
    stack.push(...asArray(context, node.get(KIDS)));
  }
  return false;
}

// ---- what a copy still carries: comments, attachments, document properties -----------------------

const CONTENTS = PDFName.of('Contents');
const RICH_CONTENTS = PDFName.of('RC');
/** Annotations that are not comments: links, form fields, a comment's pop-up window, and printing marks. */
const NOT_COMMENTS = new Set(['Link', 'Widget', 'Popup', 'PrinterMark', 'TrapNet', 'FileAttachment']);
const FILE_ATTACHMENT = PDFName.of('FileAttachment');
const MAX_ANNOTATIONS_VISITED = 100_000;

/** The text of a string object, or '' for anything else. */
function textOf(context: PDFDocument['context'], object: PDFObject | undefined): string {
  const value = object instanceof PDFRef ? context.lookup(object) : object;
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  // Rich text (/RC) may also be a stream; any bytes in it count as text.
  if (value instanceof PDFRawStream) {
    const text = decodedPrefix(value, MAX_TEXT_READ, 'small only');
    return text === null ? '' : new TextDecoder('latin1').decode(text);
  }
  return '';
}

/** Comments that hold text (a note, a typed comment, a mark with words in it), and file-attachment annotations, on every page. */
function countAnnotations(doc: PDFDocument): { comments: number; attached: number } {
  const { context } = doc;
  let comments = 0;
  let attached = 0;
  let visited = 0;
  for (const page of doc.getPages()) {
    for (const entry of safelyList(() => asArray(context, page.node.get(ANNOTS)))) {
      if (++visited > MAX_ANNOTATIONS_VISITED) return { comments, attached };
      // A damaged annotation is skipped; the others are still counted.
      safely(() => {
        const annotation = asDict(context, entry);
        if (!annotation) return false;
        const subtype = annotation.lookup(SUBTYPE);
        if (subtype === FILE_ATTACHMENT) {
          attached++;
          return true;
        }
        if (subtype instanceof PDFName && NOT_COMMENTS.has(subtype.decodeText())) return false;
        const text = textOf(context, annotation.get(CONTENTS)).trim() || textOf(context, annotation.get(RICH_CONTENTS)).replace(/<[^>]*>/g, '').trim();
        if (text !== '') comments++;
        return true;
      });
    }
  }
  return { comments, attached };
}

/** Entries of the document's embedded-files name tree (each name with its file), at any depth. */
function countEmbeddedFiles(doc: PDFDocument): number {
  const { context } = doc;
  const names = asDict(context, doc.catalog.get(NAMES));
  const stack: PDFObject[] = [];
  const root = names?.get(EMBEDDED_FILES);
  if (root) stack.push(root);
  const seen = new Set<PDFObject>();
  let count = 0;
  while (stack.length > 0 && seen.size < MAX_NAME_TREE_NODES) {
    const entry = stack.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    const node = asDict(context, entry);
    if (!node) continue;
    count += Math.floor(asArray(context, node.get(NAMES)).length / 2);
    stack.push(...asArray(context, node.get(KIDS)));
  }
  return count;
}

const PROPERTY_KEYS: readonly [CarriedProperty, string][] = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords'],
];

/** XMP: dc:title, dc:creator, dc:description (the subject) and pdf:Keywords, as elements or (Keywords) an attribute. */
const XMP_PATTERNS: Readonly<Record<CarriedProperty, readonly RegExp[]>> = {
  title: [/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/],
  author: [/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/],
  subject: [/<dc:description\b[^>]*>([\s\S]*?)<\/dc:description>/],
  keywords: [/<pdf:Keywords\b[^>]*>([\s\S]*?)<\/pdf:Keywords>/, /\bpdf:Keywords\s*=\s*"([^"]*)"/, /\bpdf:Keywords\s*=\s*'([^']*)'/],
};

/** The catalog's XMP metadata as text ('' when there is none or it cannot be read). */
function xmpText(doc: PDFDocument): string {
  const metadata = doc.context.lookup(doc.catalog.get(PDFName.of('Metadata')));
  if (!(metadata instanceof PDFRawStream)) return '';
  const xmp = decodedPrefix(metadata, MAX_TEXT_READ, 'small only');
  return xmp === null ? '' : new TextDecoder('utf-8').decode(xmp);
}

/** Which of title, author, subject and keywords are filled in, in the document information or the XMP metadata (never their values). */
function filledProperties(doc: PDFDocument): CarriedProperty[] {
  const { context } = doc;
  const info = asDict(context, context.trailerInfo.Info);
  const xmp = xmpText(doc);
  const filled = (property: CarriedProperty, key: string) => {
    if (info && textOf(context, info.get(PDFName.of(key))).trim() !== '') return true;
    if (xmp === '') return false;
    return XMP_PATTERNS[property].some((pattern) => {
      const found = pattern.exec(xmp)?.[1];
      return found !== undefined && found.replace(/<[^>]*>/g, '').trim() !== '';
    });
  };
  return PROPERTY_KEYS.filter(([property, key]) => safely(() => filled(property, key))).map(([property]) => property);
}

function carriedContent(doc: PDFDocument): CarriedContent {
  let counted = { comments: 0, attached: 0 };
  try {
    counted = countAnnotations(doc);
  } catch {
    // no page tree to walk: nothing on pages can be counted
  }
  let listed = 0;
  try {
    listed = countEmbeddedFiles(doc);
  } catch {
    listed = 0;
  }
  return { comments: counted.comments, attachments: counted.attached + listed, properties: filledProperties(doc) };
}

/** A list that may be damaged: empty when it cannot be read. */
function safelyList<T>(read: () => T[]): T[] {
  try {
    return read();
  } catch {
    return [];
  }
}

/** A damaged part of the file means "not found": these only decide whether a notice is shown. */
function safely(test: () => boolean): boolean {
  try {
    return test();
  } catch {
    return false;
  }
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  if (bytes.length === 0) throw new PdfToolsError('empty-file', 'This file is empty.');
  if (!hasPdfHeader(bytes)) throw new PdfToolsError('not-a-pdf', 'This file is not a PDF.');

  const damaged = () => new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged or incomplete: download it again, or ask the sender for a fresh copy.');
  let doc: PDFDocument;
  try {
    // pdf-lib's own load, waiting by the clock (pace.ts): every file added is read here.
    doc = await loadPaced(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw damaged();
  }

  let trailerFound: Promise<boolean> | undefined;
  const trailer = () => (trailerFound ??= hasTrailer(bytes));
  const securityDictionary = !doc.isEncrypted && hasSecurityDictionary(doc);

  // pdf-lib 1.17.1 lets each cross-reference stream it reads replace the trailer. In a linearised
  // file the last one has no /Encrypt (or /Root), so a protected file looks unprotected: look for
  // the security dictionary and the /Encrypt entry instead. Decided before anything reads the catalog.
  const encrypted = doc.isEncrypted || (securityDictionary && (await trailer()) && (await namesEncrypt(bytes, doc, damaged)));

  let pageCount: number | null = null;
  if (!encrypted) {
    // A protected file whose end is cut off loses the trailer that marks it as protected, while its
    // contents stay encrypted. pdf-lib 1.17.1 keeps no trailer /Size, so look for the trailer itself.
    if (securityDictionary && !(await trailer())) throw damaged();
    try {
      pageCount = doc.getPageCount();
    } catch {
      throw damaged(); // no catalog or page tree
    }
    // A page-tree node that is its own ancestor makes every tool that reads a page's inherited size,
    // turn or resources climb for ever: refused here, as damaged, rather than failing in each tool.
    if (!parentChainsEnd(doc)) throw damaged();
    // Cut off before its security dictionary, such a file shows nothing protected at all, but its
    // page contents are still encrypted and will not decompress.
    if (!(await trailer()) && !contentsDecode(doc)) throw damaged();
    if (pageCount === 0) throw new PdfToolsError('no-pages', 'This PDF has no pages.');
  }

  let hasSignature = false;
  try {
    const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    const flags = acroForm?.lookupMaybe(PDFName.of('SigFlags'), PDFNumber);
    hasSignature = flags !== undefined && flags.asNumber() > 0;
  } catch {
    // fall through to the byte search
  }
  if (!hasSignature) hasSignature = await containsAsciiPaced(bytes, '/ByteRange');

  return {
    encrypted,
    pageCount,
    hasSignature,
    hasFormFields: !encrypted && safely(() => hasFillableField(doc)),
    hasBookmarks: !encrypted && safely(() => hasOutline(doc)),
    hasPageLinks: !encrypted && safely(() => hasLinkToPage(doc)),
    hasAttachments: !encrypted && safely(() => hasEmbeddedFile(doc)),
    carried: encrypted ? nothingCarried() : carriedContent(doc),
  };
}
