import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from 'pdf-lib';
import { ACRO_FORM, asArray, asDict, FIELDS, isFieldNode, isPushButton, isSignatureField, KIDS, MAX_FIELD_DEPTH } from './formFields';
import { PdfToolsError } from './types';

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
}

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

function indexOfAscii(bytes: Uint8Array, needle: string, from = 0): number {
  const n = needle.length;
  outer: for (let i = from; i + n <= bytes.length; i++) {
    for (let j = 0; j < n; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

const containsAscii = (bytes: Uint8Array, needle: string) => indexOfAscii(bytes, needle) >= 0;

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
function hasTrailer(bytes: Uint8Array): boolean {
  if (containsAscii(bytes.subarray(Math.max(0, bytes.length - TAIL_WINDOW)), 'startxref')) return true;
  return containsAscii(bytes, 'trailer') || containsAscii(bytes, '/XRef');
}

// A real object or generation number has at most 10 digits; a longer run is cut short rather than spread onto the stack.
const latin1 = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, Math.min(to, from + 11)));

function refersToSecurityDictionary(doc: PDFDocument, number: number, generation: number): boolean {
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(generation)) return false;
  const target = doc.context.lookup(PDFRef.of(number, generation));
  return target instanceof PDFDict && target.get(PDFName.of('Filter')) === PDFName.of('Standard');
}

/**
 * Whether `at` lies in a stream body. A stream starts at a `stream` keyword that follows a dictionary
 * (`>>`, optional whitespace) and is followed by CR or LF; a word that merely contains "stream" is not one.
 */
function insideStreamBody(bytes: Uint8Array, at: number): boolean {
  let from = 0;
  for (;;) {
    let start = indexOfAscii(bytes, 'stream', from);
    while (start >= 0 && start < at && !isStreamKeyword(bytes, start)) start = indexOfAscii(bytes, 'stream', start + 1);
    if (start < 0 || start >= at) return false;
    const end = indexOfAscii(bytes, 'endstream', start + 6);
    if (end < 0 || end > at) return true;
    from = end + 9;
  }
}

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
 * a content stream refers to nothing of the kind.
 */
function namesEncrypt(bytes: Uint8Array, doc: PDFDocument): boolean {
  for (let at = indexOfAscii(bytes, '/Encrypt'); at >= 0; at = indexOfAscii(bytes, '/Encrypt', at + 1)) {
    let i = at + '/Encrypt'.length;
    const skip = (test: (byte: number) => boolean) => {
      const start = i;
      while (i < bytes.length && test(bytes[i])) i++;
      return i > start;
    };
    skip(isPdfWhitespace);
    if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c && !insideStreamBody(bytes, at)) return true; // << (a trailer or cross-reference stream dictionary)
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
        if (stream.dict.get(PDFName.of('Filter'))) decodePDFRawStream(stream).decode();
      }
    }
    return true;
  } catch {
    return false;
  }
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

  const damaged = () => new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged or incomplete.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw damaged();
  }

  let trailerFound: boolean | undefined;
  const trailer = () => (trailerFound ??= hasTrailer(bytes));
  const securityDictionary = !doc.isEncrypted && hasSecurityDictionary(doc);

  // pdf-lib 1.17.1 lets each cross-reference stream it reads replace the trailer. In a linearised
  // file the last one has no /Encrypt (or /Root), so a protected file looks unprotected: look for
  // the security dictionary and the /Encrypt entry instead. Decided before anything reads the catalog.
  const encrypted = doc.isEncrypted || (securityDictionary && trailer() && namesEncrypt(bytes, doc));

  let pageCount: number | null = null;
  if (!encrypted) {
    // A protected file whose end is cut off loses the trailer that marks it as protected, while its
    // contents stay encrypted. pdf-lib 1.17.1 keeps no trailer /Size, so look for the trailer itself.
    if (securityDictionary && !trailer()) throw damaged();
    try {
      pageCount = doc.getPageCount();
    } catch {
      throw damaged(); // no catalog or page tree
    }
    // Cut off before its security dictionary, such a file shows nothing protected at all, but its
    // page contents are still encrypted and will not decompress.
    if (!trailer() && !contentsDecode(doc)) throw damaged();
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
  if (!hasSignature) hasSignature = containsAscii(bytes, '/ByteRange');

  return {
    encrypted,
    pageCount,
    hasSignature,
    hasFormFields: !encrypted && safely(() => hasFillableField(doc)),
    hasBookmarks: !encrypted && safely(() => hasOutline(doc)),
    hasPageLinks: !encrypted && safely(() => hasLinkToPage(doc)),
  };
}
