// Document check (T-064, design 5.13; contract REV): what one PDF holds, read on this computer, as plain facts
// for the dialog and the one-page report (checkReport.ts). Both show `factRows`, so the screen and the report
// never say different things.
//
// - Signatures are reported as the file states them: /Name, /M, /Reason, /Location of each signature
//   dictionary, and whether its byte range runs to the end of the file. No certificate is read, so nothing
//   here ever calls a signature good or bad; every list of signatures ends with "Open the file in Adobe
//   Acrobat Reader to verify the signature." (contract decision 7).
// - Text per page comes from the caller (`deps.pageChars`, pdf.js in the app): a page with at least 20
//   characters has searchable text; one with fewer "looks scanned" when anything but text is drawn on it
//   (a picture of any size, a line, a filled shape), and otherwise has no text. This is Make searchable's own
//   rule, by its own functions (`pageKind` and `pageHasDrawing` of ocrPlan.ts; ruling of 18 November 2026):
//   the pages counted here as scanned are exactly the pages that tool recognises, so the two never disagree.
// - Dates are shown in a plain form ("17 November 2026, 14:05 (UTC+05:30)"), never as stored.
// - The work gives the window a turn by the clock (pace.ts) and stops within a page when the signal is
//   aborted (CheckStopped). The facts hold what the file states; the activity record never does
//   (review/documentCheckForm.ts keeps counts and choices only).
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFDocument, type PDFObject, type PDFPage } from 'pdf-lib';
import { ACRO_FORM, FIELDS, KIDS, MAX_FIELD_DEPTH, asArray, asDict, isFieldNode, isPushButton, isSignatureField } from './formFields';
import { displayedPage } from './marks';
import { pageHasDrawing, pageKind } from './ocrPlan';
import { PAPERS, PT_PER_MM, SAME_SIZE_PT } from './pageBox';
import { loadPaced, pacer, type Pace } from './pace';
import { inflatePrefix } from './tiffCodecs';
import { PdfToolsError, type WorkingFile } from './types';

export interface SignatureFact {
  signer: string | null;
  /** The signing time as the file states it, in the plain form of plainPdfDate; null when absent or unreadable. */
  signedOn: string | null;
  reason: string | null;
  location: string | null;
  /** The signed byte range starts at the beginning of the file and runs to its end (nothing added after it). */
  coversWholeFile: boolean;
}

export type PropertyKey = 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer' | 'created' | 'modified';

export interface DocumentFacts {
  pageCount: number;
  sizeBytes: number;
  /** Each page size as shown (after /Rotate), most pages first. */
  pageSizes: { label: string; pages: number }[];
  protection: 'none' | 'password' | 'restrictions';
  signatures: SignatureFact[];
  /** Pages whose text could not be read are in none of the three counts. */
  text: { pagesWithText: number; pagesScanned: number; pagesEmpty: number };
  /** As the file states them; `created` and `modified` in the plain form of plainPdfDate. */
  properties: Record<PropertyKey, string | null>;
  pdfVersion: string;
  hasBookmarks: boolean;
  hasFormFields: boolean;
  hasAttachments: boolean;
}

export interface FactRow {
  label: string;
  value: string;
  /** One line, only where the auditor needs one. */
  note?: string;
}

export interface CheckDeps {
  /** Non-space characters of the page's text (0-based page index). */
  pageChars(pageIndex: number): Promise<number>;
}

export interface CheckOptions {
  signal?: AbortSignal;
  /** Called with 0 before the first page and after each page; what it throws ends the check as it is. */
  onPage?(done: number, total: number): void;
}

/** The check was stopped (its signal aborted). */
export class CheckStopped extends Error {
  constructor() {
    super('The check was stopped.');
    this.name = 'CheckStopped';
  }
}

/** Fewer characters than this: the page has no searchable text (the contract's under-20 rule). */
export const SCANNED_MAX_CHARS = 20;

export const SIGNATURE_CHECK_NOTE = 'Open the file in Adobe Acrobat Reader to verify the signature.';
export const NAME_NOT_STATED = 'Name not stated in the file';
export const SCANNED_NOTE = 'Make it searchable before converting or redacting.';
const NO_DATE = 'no readable date in the file';
const ADDED_AFTER_NOTE = 'The file was added to after this signature, for example by another signature or a change.';
/** The longest value shown; a longer one is cut with "…". */
export const MAX_VALUE_LENGTH = 300;

const unreadable = () =>
  new PdfToolsError('not-a-pdf', 'This file could not be read to check it. Open the file in a PDF reader, save a fresh copy and add that.');

// ---- small helpers -----------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const two = (n: number) => String(n).padStart(2, '0');

/** A moment in local time: "17 November 2026, 14:05". */
export function plainDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${two(date.getHours())}:${two(date.getMinutes())}`;
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function plainParts(y: number, mo?: number, d?: number, h?: number, mi?: number, s?: number, zone?: string): string | null {
  if (mo === undefined) return String(y);
  if (mo < 1 || mo > 12) return null;
  if (d === undefined) return `${MONTHS[mo - 1]} ${y}`;
  if (d < 1 || d > daysIn(y, mo)) return null;
  const day = `${d} ${MONTHS[mo - 1]} ${y}`;
  if (h === undefined) return day;
  if (h > 23 || (mi ?? 0) > 59 || (s ?? 0) > 59) return null;
  return `${day}, ${two(h)}:${two(mi ?? 0)}${zone ? ` (${zone})` : ''}`;
}

const num = (text: string | undefined) => (text === undefined || text === '' ? undefined : Number(text));

function zoneText(sign: string, hours: string, minutes: string | undefined): string | null {
  const h = Number(hours);
  const m = Number(minutes ?? '0');
  if (h > 23 || m > 59) return null;
  return `UTC${sign}${two(h)}:${two(m)}`;
}

const PDF_DATE = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)(?:00'?00'?)?|([+-])(\d{2})'?(?:(\d{2})'?)?)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:(Z)|([+-])(\d{2}):(\d{2}))?)?)?$/;

/**
 * A date as a PDF states it ("D:20261117140500+05'30'", or the ISO form of XMP metadata), in a plain form:
 * "17 November 2026, 14:05 (UTC+05:30)", the time as stated with its zone when the file gives one. Null
 * when it cannot be read; the stored value itself is never returned.
 */
export function plainPdfDate(raw: string): string | null {
  const text = raw.trim();
  const m = PDF_DATE.exec(text) ?? ISO_DATE.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z, sign, zh, zm] = m;
  let zone: string | undefined;
  if (z) zone = 'UTC';
  else if (sign) {
    const shown = zoneText(sign, zh, zm);
    if (shown === null) return null;
    zone = shown;
  }
  return plainParts(Number(y), num(mo), num(d), num(h), num(mi), num(s), zone);
}

/** Non-space characters of a page's text items (pdf.js getTextContent), counted as characters, not code units. */
export function charsIn(items: readonly { str: string }[]): number {
  let n = 0;
  for (const item of items) n += [...item.str.replace(/\s/gu, '')].length;
  return n;
}

/** A size as the rest of PDF Tools writes it (components/pdf-tools/format.ts formatBytes; the tests compare them). */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a file states, made safe to show: line breaks and tabs become spaces, other control and format
 * characters (which print as nothing or turn text around) go, spaces are joined, and a very long value is
 * cut with "…".
 */
export function shownText(text: string): string {
  const flat = text
    .replace(/[\r\n\t\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const chars = [...flat];
  return chars.length > MAX_VALUE_LENGTH ? `${chars.slice(0, MAX_VALUE_LENGTH - 1).join('')}…` : flat;
}

const stated = (text: string | null) => {
  if (text === null) return null;
  const shown = shownText(text);
  return shown === '' ? null : shown;
};

// ---- reading the file --------------------------------------------------------------------------

function textOf(doc: PDFDocument, object: PDFObject | undefined): string | null {
  const value = object instanceof PDFRef ? doc.context.lookup(object) : object;
  try {
    if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  } catch {
    return null;
  }
  return null;
}

function numbersOf(doc: PDFDocument, object: PDFObject | undefined): number[] | null {
  const array = object instanceof PDFRef ? doc.context.lookup(object) : object;
  if (!(array instanceof PDFArray)) return null;
  const out: number[] = [];
  for (const item of array.asArray()) {
    const n = item instanceof PDFRef ? doc.context.lookup(item) : item;
    if (!(n instanceof PDFNumber)) return null;
    out.push(n.asNumber());
  }
  return out;
}

const isTrailing = (byte: number) => byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;

/** The byte range starts at 0, its parts follow each other and the last ends at the file's end (end-of-line bytes after it allowed). */
function coversWhole(range: number[] | null, bytes: Uint8Array): boolean {
  if (!range || range.length < 4 || range.length % 2 !== 0 || range[0] !== 0) return false;
  let end = 0;
  for (let i = 0; i < range.length; i += 2) {
    const [start, length] = [range[i], range[i + 1]];
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < end || length < 0) return false;
    end = start + length;
  }
  if (end > bytes.length || bytes.length - end > 64) return false;
  for (let i = end; i < bytes.length; i++) if (!isTrailing(bytes[i])) return false;
  return true;
}

const BYTE_RANGE = PDFName.of('ByteRange');
const TYPE = PDFName.of('Type');
const SIG_TYPES = new Set(['Sig', 'DocTimeStamp']);
const MAX_FIELDS_VISITED = 100_000;
const OBJECTS_PER_PACE = 200;

function isSignatureDict(doc: PDFDocument, dict: PDFDict): boolean {
  if (!dict.has(BYTE_RANGE)) return false;
  const type = doc.context.lookup(dict.get(TYPE));
  return (type instanceof PDFName && SIG_TYPES.has(type.decodeText())) || dict.has(PDFName.of('Contents'));
}

/** Signature dictionaries: the values of signature fields first, in field order, then any other in the file. */
async function signatureDicts(doc: PDFDocument, pace: Pace): Promise<PDFDict[]> {
  const { context } = doc;
  const found: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const add = (dict: PDFDict | undefined) => {
    if (dict && !seen.has(dict) && isSignatureDict(doc, dict)) {
      seen.add(dict);
      found.push(dict);
    }
  };
  try {
    const form = asDict(context, doc.catalog.get(ACRO_FORM));
    const stack: [PDFObject, number][] = asArray(context, form?.get(FIELDS))
      .map((entry): [PDFObject, number] => [entry, 0])
      .reverse();
    const visited = new Set<PDFObject>();
    while (stack.length > 0 && visited.size < MAX_FIELDS_VISITED) {
      const [entry, depth] = stack.pop()!;
      if (visited.has(entry)) continue;
      visited.add(entry);
      const field = asDict(context, entry);
      if (!field) continue;
      if (isSignatureField(context, field)) add(asDict(context, field.get(PDFName.of('V'))));
      if (depth < MAX_FIELD_DEPTH) {
        const kids = asArray(context, field.get(KIDS)).filter((kid) => {
          const dict = asDict(context, kid);
          return dict !== undefined && isFieldNode(dict);
        });
        for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
      }
    }
  } catch {
    // a damaged form: the signatures elsewhere in the file are still found below
  }
  let n = 0;
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) add(object);
    if (++n % OBJECTS_PER_PACE === 0) {
      const turn = pace();
      if (turn) await turn;
    }
  }
  return found;
}

function signatureFact(doc: PDFDocument, dict: PDFDict, bytes: Uint8Array, original: boolean): SignatureFact {
  const date = textOf(doc, dict.get(PDFName.of('M')));
  return {
    signer: stated(textOf(doc, dict.get(PDFName.of('Name')))),
    signedOn: date === null ? null : plainPdfDate(date),
    reason: stated(textOf(doc, dict.get(PDFName.of('Reason')))),
    location: stated(textOf(doc, dict.get(PDFName.of('Location')))),
    // The copy of a protected file is not the file that was signed: its bytes say nothing about the range.
    coversWholeFile: original && coversWhole(numbersOf(doc, dict.get(BYTE_RANGE)), bytes),
  };
}

/** A field that can be filled in: one with no child fields, other than a signature field or a push button (as inspect.ts counts them). */
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
  const outlines = asDict(doc.context, doc.catalog.get(PDFName.of('Outlines')));
  return asDict(doc.context, outlines?.get(PDFName.of('First'))) !== undefined;
}

const MAX_NAME_TREE_NODES = 10_000;

/** An entry in the document's embedded-files name tree, or a file-attachment comment on a page. */
function hasAttachment(doc: PDFDocument, pages: readonly PDFPage[]): boolean {
  const { context } = doc;
  const names = asDict(context, doc.catalog.get(PDFName.of('Names')));
  const stack: PDFObject[] = [];
  const root = names?.get(PDFName.of('EmbeddedFiles'));
  if (root) stack.push(root);
  const seen = new Set<PDFObject>();
  while (stack.length > 0 && seen.size < MAX_NAME_TREE_NODES) {
    const entry = stack.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    const node = asDict(context, entry);
    if (!node) continue;
    if (asArray(context, node.get(PDFName.of('Names'))).length >= 2) return true;
    stack.push(...asArray(context, node.get(KIDS)));
  }
  const fileAttachment = PDFName.of('FileAttachment');
  return pages.some((page) =>
    safely(() => asArray(context, page.node.get(PDFName.of('Annots'))).some((a) => asDict(context, a)?.lookup(PDFName.of('Subtype')) === fileAttachment)),
  );
}

function safely(test: () => boolean): boolean {
  try {
    return test();
  } catch {
    return false;
  }
}

const INFO_KEYS: Readonly<Record<PropertyKey, string>> = {
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  creator: 'Creator',
  producer: 'Producer',
  created: 'CreationDate',
  modified: 'ModDate',
};

/** The XMP element (or attribute) for each property. */
const XMP_NAMES: Readonly<Record<PropertyKey, string>> = {
  title: 'dc:title',
  author: 'dc:creator',
  subject: 'dc:description',
  keywords: 'pdf:Keywords',
  creator: 'xmp:CreatorTool',
  producer: 'pdf:Producer',
  created: 'xmp:CreateDate',
  modified: 'xmp:ModifyDate',
};

/** Decoded bytes of XMP metadata read: far more than it holds (inspect.ts reads the same). */
const MAX_XMP_BYTES = 4 * 1024 * 1024;

/** The catalog's XMP metadata as text: plain or Flate (bounded), '' otherwise. */
function xmpText(doc: PDFDocument): string {
  try {
    const metadata = doc.context.lookup(doc.catalog.get(PDFName.of('Metadata')));
    if (!(metadata instanceof PDFRawStream)) return '';
    const filter = metadata.dict.lookup(PDFName.of('Filter'));
    const parms = metadata.dict.lookup(PDFName.of('DecodeParms'));
    let data: Uint8Array;
    if (filter === undefined) data = metadata.contents.subarray(0, MAX_XMP_BYTES);
    else if (filter === PDFName.of('FlateDecode') && parms === undefined) data = inflatePrefix(metadata.contents, MAX_XMP_BYTES);
    else return '';
    return new TextDecoder('utf-8').decode(data);
  } catch {
    return '';
  }
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

const escapeName = (name: string) => name.replace(':', '\\:');

function xmpValue(xmp: string, name: string): string | null {
  if (xmp === '') return null;
  const element = new RegExp(`<${escapeName(name)}\\b[^>]*>([\\s\\S]*?)</${escapeName(name)}>`).exec(xmp)?.[1];
  const attribute = new RegExp(`\\b${escapeName(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(xmp);
  const raw = element ?? attribute?.[1] ?? attribute?.[2];
  return raw === undefined ? null : stated(xmlText(raw));
}

function readProperties(doc: PDFDocument): DocumentFacts['properties'] {
  const { context } = doc;
  let info: PDFDict | undefined;
  try {
    info = asDict(context, context.trailerInfo.Info);
  } catch {
    info = undefined;
  }
  let xmp: string | null = null;
  const fromXmp = (key: PropertyKey) => xmpValue((xmp ??= xmpText(doc)), XMP_NAMES[key]);
  const out = {} as DocumentFacts['properties'];
  for (const key of Object.keys(INFO_KEYS) as PropertyKey[]) {
    const own = info ? stated(textOf(doc, info.get(PDFName.of(INFO_KEYS[key])))) : null;
    const value = own ?? fromXmp(key);
    out[key] = key === 'created' || key === 'modified' ? (value === null ? null : plainPdfDate(value)) : value;
  }
  return out;
}

/** The version in the file's header, or the catalog's /Version when that is later. */
function pdfVersion(bytes: Uint8Array, doc: PDFDocument): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const header = /%PDF-(\d+\.\d+)/.exec(head)?.[1];
  let catalog: string | undefined;
  try {
    const named = doc.catalog.lookup(PDFName.of('Version'));
    if (named instanceof PDFName && /^\d+\.\d+$/.test(named.decodeText())) catalog = named.decodeText();
  } catch {
    catalog = undefined;
  }
  const versions = [header, catalog].filter((v): v is string => v !== undefined);
  if (versions.length === 0) return 'Not stated in the file';
  return versions.sort((a, b) => Number(b) - Number(a))[0];
}

function sizeLabel(width: number, height: number): string {
  const near = (a: number, b: number) => Math.abs(a - b) <= SAME_SIZE_PT;
  for (const paper of Object.values(PAPERS)) {
    if (near(width, paper.width) && near(height, paper.height)) return `${paper.label} portrait`;
    if (near(width, paper.height) && near(height, paper.width)) return `${paper.label} landscape`;
  }
  return `${Math.round(width / PT_PER_MM)} × ${Math.round(height / PT_PER_MM)} mm`;
}

function pageSizeLabel(page: PDFPage): string {
  try {
    const shown = displayedPage(page);
    return sizeLabel(shown.width, shown.height);
  } catch {
    return 'Size not stated in the file';
  }
}

/**
 * Reads the facts of one PDF. `source` gives what the list knows of the file as it was added (its size,
 * whether it was opened with its password or carried restrictions); `deps.pageChars` counts each page's
 * text. Gives the window a turn by the clock; an aborted signal ends it with CheckStopped, and what
 * `onPage` throws is passed on as it is. A file that cannot be read is refused with a plain message.
 */
export async function checkDocument(
  bytes: Uint8Array,
  source: Pick<WorkingFile, 'size' | 'wasProtected' | 'hasRestrictions'>,
  deps: CheckDeps,
  opts: CheckOptions = {},
): Promise<DocumentFacts> {
  const { signal, onPage } = opts;
  const stopIfAsked = () => {
    if (signal?.aborted) throw new CheckStopped();
  };
  stopIfAsked();
  let doc: PDFDocument;
  let pages: PDFPage[];
  try {
    doc = await loadPaced(bytes, { ignoreEncryption: true, updateMetadata: false, check: stopIfAsked });
    pages = doc.getPages();
  } catch (error) {
    if (error instanceof CheckStopped) throw error;
    throw unreadable();
  }
  if (pages.length === 0) throw unreadable();
  const pace = pacer(stopIfAsked);
  const total = pages.length;
  onPage?.(0, total);

  const sizes = new Map<string, { pages: number; first: number }>();
  const text = { pagesWithText: 0, pagesScanned: 0, pagesEmpty: 0 };
  for (let i = 0; i < total; i++) {
    stopIfAsked();
    const page = pages[i];
    const label = pageSizeLabel(page);
    const size = sizes.get(label);
    if (size) size.pages += 1;
    else sizes.set(label, { pages: 1, first: i });

    let chars: number | null;
    try {
      chars = await deps.pageChars(i);
    } catch {
      stopIfAsked();
      chars = null; // the page's text could not be read: it is counted as not read
    }
    stopIfAsked();
    if (chars !== null) {
      // As Make searchable plans the page (ocrPlan.ts readPlan): the drawing is looked at only when there is little text.
      const kind = pageKind(chars, chars < SCANNED_MAX_CHARS && pageHasDrawing(page));
      if (kind === 'text') text.pagesWithText += 1;
      else if (kind === 'scanned') text.pagesScanned += 1;
      else text.pagesEmpty += 1;
    }
    onPage?.(i + 1, total);
    const turn = pace();
    if (turn) await turn;
  }

  const original = !source.wasProtected;
  const signatures = (await signatureDicts(doc, pace)).map((dict) => signatureFact(doc, dict, bytes, original));
  stopIfAsked();
  let protection: DocumentFacts['protection'] = 'none';
  if (source.wasProtected) protection = source.hasRestrictions ? 'restrictions' : 'password';
  else if (doc.isEncrypted) protection = 'password';

  return {
    pageCount: total,
    sizeBytes: source.size,
    pageSizes: [...sizes.entries()].sort((a, b) => b[1].pages - a[1].pages || a[1].first - b[1].first).map(([label, { pages: n }]) => ({ label, pages: n })),
    protection,
    signatures,
    text,
    properties: readProperties(doc),
    pdfVersion: pdfVersion(bytes, doc),
    hasBookmarks: safely(() => hasOutline(doc)),
    hasFormFields: safely(() => hasFillableField(doc)),
    hasAttachments: safely(() => hasAttachment(doc, pages)),
  };
}

// ---- the rows ----------------------------------------------------------------------------------

/** Page sizes listed by name before the rest are counted. */
const SIZES_LISTED = 4;

function pageSizeValue(sizes: DocumentFacts['pageSizes']): string {
  if (sizes.length === 0) return 'Not stated in the file';
  if (sizes.length === 1) return shownText(sizes[0].label);
  const listed = sizes.length > SIZES_LISTED + 1 ? sizes.slice(0, SIZES_LISTED) : sizes;
  const parts = listed.map((s) => `${shownText(s.label)} on ${plural(s.pages, 'page')}`);
  const rest = sizes.slice(listed.length);
  if (rest.length > 0) parts.push(`${plural(rest.length, 'other size')} on ${plural(rest.reduce((n, s) => n + s.pages, 0), 'page')}`);
  return parts.join('; ');
}

const PROTECTION_ROWS: Readonly<Record<DocumentFacts['protection'], FactRow>> = {
  none: { label: 'Protection', value: 'No password or restrictions' },
  password: { label: 'Protection', value: 'Opened with its password', note: 'The copy in this list has no password; the original file still has one.' },
  restrictions: {
    label: 'Protection',
    value: 'Restrictions, for example on copying or printing',
    note: 'The copy in this list has no restrictions; the original file still has them.',
  },
};

const withoutEndDot = (text: string) => text.replace(/[.\s]+$/u, '');

function signatureValue(s: SignatureFact): string {
  const signer = stated(s.signer);
  const signedOn = stated(s.signedOn);
  const reason = stated(s.reason);
  const location = stated(s.location);
  const first = signer
    ? `Signed by ${signer}${signedOn ? ` on ${signedOn}` : `; ${NO_DATE}`}`
    : `${NAME_NOT_STATED}; ${signedOn ? `signed on ${signedOn}` : NO_DATE}`;
  const parts = [first];
  if (reason) parts.push(`Reason: ${withoutEndDot(reason)}`);
  if (location) parts.push(`Location: ${withoutEndDot(location)}`);
  return `${parts.join('. ')}.`;
}

function textValue(withText: number, pages: number): string {
  if (withText === 0) return 'On no page';
  if (withText === pages) return pages === 1 ? 'On its only page' : `On all ${pages} pages`;
  return `On ${withText} of ${plural(pages, 'page')}`;
}

const yesNo = (on: boolean) => (on ? 'Yes' : 'No');

/** The facts as the dialog and the report show them, in this order, each with a note only where one is needed. */
export function factRows(facts: DocumentFacts): FactRow[] {
  const rows: FactRow[] = [
    { label: 'Pages', value: String(facts.pageCount) },
    { label: 'Page size', value: pageSizeValue(facts.pageSizes) },
    { label: 'File size', value: sizeText(facts.sizeBytes) },
    { ...PROTECTION_ROWS[facts.protection] },
  ];

  const signatures = facts.signatures;
  rows.push(
    signatures.length === 0
      ? { label: 'Digital signatures', value: 'None' }
      : { label: 'Digital signatures', value: plural(signatures.length, 'signature'), note: `Shown as stated in the file. ${SIGNATURE_CHECK_NOTE}` },
  );
  signatures.forEach((s, i) => {
    const row: FactRow = { label: `Signature ${i + 1}`, value: signatureValue(s) };
    // A protected file's copy is not the signed file, so whether anything came after a signature is not said.
    if (!s.coversWholeFile && facts.protection === 'none') row.note = ADDED_AFTER_NOTE;
    rows.push(row);
  });

  const { pagesWithText, pagesScanned, pagesEmpty } = facts.text;
  rows.push({ label: 'Searchable text', value: textValue(pagesWithText, facts.pageCount) });
  if (pagesScanned > 0) rows.push({ label: 'Pages that look scanned', value: plural(pagesScanned, 'page'), note: SCANNED_NOTE });
  if (pagesEmpty > 0) rows.push({ label: 'Pages with no text', value: plural(pagesEmpty, 'page'), note: 'They may be blank, or hold only pictures or drawings.' });
  const notRead = facts.pageCount - pagesWithText - pagesScanned - pagesEmpty;
  if (notRead > 0) {
    rows.push({ label: 'Pages not read', value: plural(notRead, 'page'), note: 'Their text could not be read. Open the file in a PDF reader, save a fresh copy and add that.' });
  }

  const p = facts.properties;
  const filled = (key: PropertyKey) => stated(p[key]);
  rows.push({ label: 'Title', value: filled('title') ?? 'Not filled in' });
  rows.push({ label: 'Author', value: filled('author') ?? 'Not filled in' });
  if (filled('subject')) rows.push({ label: 'Subject', value: filled('subject')! });
  if (filled('keywords')) rows.push({ label: 'Keywords', value: filled('keywords')! });
  rows.push({ label: 'Created', value: filled('created') ?? 'Not stated in the file' });
  rows.push({ label: 'Last changed', value: filled('modified') ?? 'Not stated in the file' });
  if (filled('creator')) rows.push({ label: 'Created with', value: filled('creator')! });
  if (filled('producer')) rows.push({ label: 'PDF produced by', value: filled('producer')! });

  rows.push({ label: 'PDF version', value: shownText(facts.pdfVersion) });
  rows.push({ label: 'Bookmarks', value: yesNo(facts.hasBookmarks) });
  rows.push({ label: 'Form fields', value: yesNo(facts.hasFormFields) });
  rows.push(
    facts.hasAttachments
      ? { label: 'Attachments', value: 'Yes', note: 'Files are attached inside this PDF. Open it in a PDF reader to see them.' }
      : { label: 'Attachments', value: 'No' },
  );
  return rows;
}

// ---- the shape, checked again by the run step ------------------------------------------------------

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= 10_000;
const isTextOrNull = (v: unknown) => v === null || isText(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether a value has the full shape of DocumentFacts (the dialog's facts, checked again by the run step). */
export function isDocumentFacts(value: unknown): value is DocumentFacts {
  if (!isRecord(value)) return false;
  const v = value;
  if (!isCount(v.pageCount) || v.pageCount < 1 || !isCount(v.sizeBytes) || !isText(v.pdfVersion)) return false;
  if (!['none', 'password', 'restrictions'].includes(v.protection as string)) return false;
  if (typeof v.hasBookmarks !== 'boolean' || typeof v.hasFormFields !== 'boolean' || typeof v.hasAttachments !== 'boolean') return false;
  if (!Array.isArray(v.pageSizes) || !v.pageSizes.every((s) => isRecord(s) && isText(s.label) && isCount(s.pages))) return false;
  if (
    !Array.isArray(v.signatures) ||
    !v.signatures.every(
      (s) => isRecord(s) && isTextOrNull(s.signer) && isTextOrNull(s.signedOn) && isTextOrNull(s.reason) && isTextOrNull(s.location) && typeof s.coversWholeFile === 'boolean',
    )
  ) {
    return false;
  }
  const t = v.text;
  if (!isRecord(t) || !isCount(t.pagesWithText) || !isCount(t.pagesScanned) || !isCount(t.pagesEmpty)) return false;
  if (t.pagesWithText + t.pagesScanned + t.pagesEmpty > v.pageCount) return false;
  const p = v.properties;
  return isRecord(p) && (Object.keys(INFO_KEYS) as PropertyKey[]).every((key) => isTextOrNull(p[key]));
}
