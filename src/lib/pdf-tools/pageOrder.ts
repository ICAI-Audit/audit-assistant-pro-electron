// Organise pages (design 5.15; plan Task B1; spike-stamps.md section 3.7; the lead's rulings of
// 14 November 2026 and of review fix round 1): reorder, turn and remove the pages of one PDF.
//
// - Turning only (every page kept, in its own order) edits a loaded copy in place: links, form
//   fields, bookmarks, the signature field and every document-level part stay. Objects nothing refers
//   to any more (such as content an earlier incremental save replaced) are dropped before saving
//   (design 11a). A file that claims PDF/A-1 is written without object streams, which PDF/A-1 forbids.
// - Any move or removal goes through the page copy of Split and Delete pages (organise.ts
//   extractPages, pageCopy.ts), so nothing of a removed page is carried, and form fields, links,
//   comments and bookmarks follow their pages (organise.ts carries the bookmarks, design 5.10). Then,
//   onto the copy: the document language (/Lang); the attachments (the document's embedded files,
//   copied whole: they belong to the document, not to a page, so they stay even when every page that
//   mentions them is removed); the named destinations that go to kept pages (so links by name keep
//   working); the page labels, rebuilt so that every kept page shows the label it had; and the turns.
//   What is not carried (XMP, structure tags, scripts, the opening view, viewer settings, article
//   threads, other document data) is reported, never dropped silently.
// - A turn changes the page's /Rotate only, never its content: the new value is the rotation the
//   page shows (its own or inherited, read as pdf.js reads it) plus the turn, from 0 to 270, written
//   on the page itself.
// - A page may appear once: two copies of a page would share its form widgets (spike-stamps.md).
// - pdf-lib's normalize() is never called (it would inline shared resources into every page).
// - Every page of the result is checked against the source page it came from, as a reader reads both
//   (the library @cantoo/pdf-lib's parser): the same content bytes, and every resource its content
//   names still there, of the same kind (forms followed in). pdf-lib 1.17.1 reads a name written with
//   a lower-case escape (/Im#2d1, which readers read as Im-1) as a different name and writes it back as
//   such (review F4), so a page would lose that image or font. When the file has such names they are
//   first read as readers read them; if a page would still change, the run is tried with the names as
//   pdf-lib read them; if a page changes either way, nothing is made ('page-would-change').
import type {
  PDFDict as CantooDict,
  PDFDocument as CantooDocument,
  PDFObject as CantooObject,
  PDFPageLeaf as CantooPageLeaf,
  PDFRawStream as CantooRawStream,
} from '@cantoo/pdf-lib';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
  type PDFPageLeaf,
} from 'pdf-lib';
import { PARSE_OBJECTS_PER_TICK } from './inspect';
import { extractPages, type BookmarkReport, type OrganiseReport } from './organise';
import { byTheClock, isStop, loadPaced, pacer, runPaced, savePaced, type Pace, type Work } from './pace';
import { namesIn, PageCopier, pageMapping, type PageMapping } from './pageCopy';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES } from './types';

/** A turn clockwise, in degrees. */
export type Turn = 0 | 90 | 180 | 270;

/**
 * `order` lists the source page indices (from 0) kept, in their new order; `turns` gives the turn of a
 * source page by its index. A turn on a page that is not kept has no effect.
 */
export interface PagePlan {
  order: readonly number[];
  turns: Readonly<Record<number, Turn>>;
}

/** Document-level parts a move or removal does not carry, as `PageOrderReport.notCarried` names them. */
export type NotCarried = 'xmp-metadata' | 'accessibility-tags' | 'document-scripts' | 'opening-view' | 'viewer-settings' | 'article-threads' | 'other-document-data';

/** Plain words for `NotCarried`, for the dialog and the record. */
export const NOT_CARRIED_LABELS: Readonly<Record<NotCarried, string>> = {
  'xmp-metadata': 'XMP metadata',
  'accessibility-tags': 'accessibility tags',
  'document-scripts': 'document scripts and actions',
  'opening-view': 'the opening view',
  'viewer-settings': 'viewer settings',
  'article-threads': 'article threads',
  'other-document-data': 'other document data',
};

/** What a run reports. A turn-only run reports nothing; a move or removal what the page copy reports, and: */
export interface PageOrderReport extends OrganiseReport, BookmarkReport {
  /** The source's page labels could not be read exactly (as pdf.js reads them), so the result has none. */
  pageLabelsDropped?: boolean;
  /** Named destinations that go to removed pages (or to no page): not carried. */
  namedDestinationsDropped?: number;
  /** Document-level parts the source has and the result does not, in a fixed order. */
  notCarried?: NotCarried[];
}

export interface PageOrderOptions {
  /** Filled in when the run succeeds. */
  report?: PageOrderReport;
  /** Called before each page with the pages done so far; it stops the run by throwing (a cancel). */
  onPage?: (done: number, total: number) => void | Promise<void>;
  /** The run's Stop check, asked after each wait while a file is read (pace.ts loadPaced); it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
}

const TURNS: readonly number[] = [0, 90, 180, 270];
const ROTATE = PDFName.of('Rotate');
const APP_NAME = 'ICAI VERA';

/** A /Rotate value as readers apply it (pdf.js): a multiple of 90 brought into 0-270; anything else is 0. */
export function normaliseRotation(value: number): Turn {
  if (!Number.isInteger(value) || value % 90 !== 0) return 0;
  return (((value % 360) + 360) % 360) as Turn;
}

/** The rotation a page shows after `turn` is added to the rotation it shows now. */
export function turnedRotation(shown: number, turn: Turn): Turn {
  return normaliseRotation(normaliseRotation(shown) + turn);
}

/** The rotation a page shows: its own /Rotate, or the one it inherits from the page tree. */
function shownRotation(node: PDFPageLeaf): Turn {
  const value = node.getInheritableAttribute(ROTATE);
  const looked = value instanceof PDFRef ? node.context.lookup(value) : value;
  return looked instanceof PDFNumber ? normaliseRotation(looked.asNumber()) : 0;
}

function turnPage(node: PDFPageLeaf, turn: Turn): void {
  if (turn !== 0) node.set(ROTATE, PDFNumber.of(turnedRotation(shownRotation(node), turn)));
}

const outside = (index: number, pageCount: number) =>
  new PdfToolsError('invalid-page-list', Number.isInteger(index) && index >= pageCount ? `Page ${index + 1} is outside this file's ${pageCount} pages.` : `Page numbers must be whole numbers from 1 to ${pageCount}.`);

/**
 * Throws PdfToolsError when the plan cannot be made: 'organise-all-removed' (no page kept),
 * 'invalid-page-list' (a page or a turn's page outside the file), 'duplicate-page' (a page kept
 * twice), 'invalid-rotation' (a turn that is not 0, 90, 180 or 270).
 */
export function checkPagePlan(plan: PagePlan, pageCount: number): void {
  if (plan.order.length === 0) {
    throw new PdfToolsError('organise-all-removed', PHASE_TWO_ERROR_MESSAGES['organise-all-removed'] ?? 'You cannot remove every page. Keep at least one.');
  }
  const seen = new Set<number>();
  for (const index of plan.order) {
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) throw outside(index, pageCount);
    if (seen.has(index)) throw new PdfToolsError('duplicate-page', `Page ${index + 1} is in the new order twice. Each page can be kept once.`);
    seen.add(index);
  }
  for (const [key, turn] of Object.entries(plan.turns)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) throw outside(index, pageCount);
    if (!TURNS.includes(turn)) throw new PdfToolsError('invalid-rotation', 'Pages turn in steps of 90 degrees.');
  }
}

/** Every page kept, in its own order: only turns. */
export function isTurnOnly(plan: PagePlan, pageCount: number): boolean {
  return plan.order.length === pageCount && plan.order.every((index, at) => index === at);
}

/** Where each source page lands: its new index, or undefined when it is removed (pageCopy.ts pageMapping). */
export function planMapping(plan: PagePlan): PageMapping {
  return pageMapping(plan.order);
}

/** The mapping as a list: for each source page (from 0), its new index (from 0), or null when it is removed. */
export function newPositions(plan: PagePlan, pageCount: number): (number | null)[] {
  const map = planMapping(plan);
  return Array.from({ length: pageCount }, (_, index) => map(index) ?? null);
}

/** Plain sentences for the dialog and the record about what a run did not keep; empty when it kept everything. */
export function organiseNotes(report: PageOrderReport): string[] {
  const notes: string[] = [];
  if (report.pageLabelsDropped) notes.push('Page labels (such as i, ii or A-1) could not be read exactly, so they are not kept.');
  const dropped = report.namedDestinationsDropped ?? 0;
  if (dropped > 0) notes.push(`${dropped} named ${dropped === 1 ? 'destination' : 'destinations'} of removed pages ${dropped === 1 ? 'is' : 'are'} not kept.`);
  if (report.notCarried && report.notCarried.length > 0) {
    notes.push(`Not kept when pages are moved or removed: ${report.notCarried.map((part) => NOT_CARRIED_LABELS[part]).join(', ')}.`);
  }
  return notes;
}

// ---- reading ----------------------------------------------------------------------------------------

const notAPdf = () => new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');

async function load(file: Uint8Array, check?: () => void): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await loadPaced(file, { ignoreEncryption: true, updateMetadata: false, check });
  } catch (error) {
    if (isStop(error)) throw error; // the run's own Stop, pressed while the file was read
    throw notAPdf();
  }
  if (doc.isEncrypted) throw new PdfToolsError('encrypted', 'This file is password-protected. Unlock it first.');
  return doc;
}

function pageCountOf(doc: PDFDocument): number {
  try {
    return doc.getPageCount();
  } catch {
    throw notAPdf();
  }
}

const lookedUp = (context: PDFContext, object: PDFObject | undefined) => (object instanceof PDFRef ? context.lookup(object) : object);
const dictOf = (context: PDFContext, object: PDFObject | undefined) => {
  const value = lookedUp(context, object);
  return value instanceof PDFDict ? value : undefined;
};

/** The source claims PDF/A-1 in its XMP (part 1, any conformance). */
function claimsPdfA1(doc: PDFDocument): boolean {
  try {
    const metadata = lookedUp(doc.context, doc.catalog.get(PDFName.of('Metadata')));
    if (!(metadata instanceof PDFRawStream)) return false;
    const xml = new TextDecoder('utf-8').decode(decodePDFRawStream(metadata).decode());
    return /<pdfaid:part>\s*1\s*<\/pdfaid:part>|pdfaid:part\s*=\s*["']1["']/.test(xml);
  } catch {
    return false;
  }
}

// ---- names written with lower-case escapes (review F4) ------------------------------------------

/**
 * The name as readers read it, when pdf-lib 1.17.1 read it otherwise: pdf-lib decodes only upper-case
 * #XX escapes, so a lower-case one stays in its value as '#' and two hex digits. Such an escape with a
 * lower-case letter can only come from the file's own lower-case escape (an upper-case one, or digits
 * alone, would have been decoded, so those are a real '#' in the name and stay). Undefined when the
 * name is read the same.
 */
function asReadersRead(name: PDFName): PDFName | undefined {
  const value = name.decodeText();
  if (!value.includes('#')) return undefined;
  const read = value.replace(/#([0-9a-fA-F]{2})/g, (whole, hex: string) => (/[a-f]/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : whole));
  if (read === value) return undefined;
  // PDFName.of decodes #XX itself: write every '#' left as #23 so that it stays one.
  return PDFName.of(read.replace(/#/g, '#23'));
}

/**
 * Whether the file holds names pdf-lib reads otherwise than readers do; with `apply`, every such name
 * (dictionary keys and values, array items, stream dictionaries, indirect names) is replaced by the
 * name readers read.
 */
function readNamesAsReaders(doc: PDFDocument, apply: boolean, pace: Pace): Promise<boolean> {
  return runPaced(namesAsReaders(doc, apply), pace);
}

function* namesAsReaders(doc: PDFDocument, apply: boolean): Work<boolean> {
  let found = false;
  const fix = (object: PDFObject): PDFObject | undefined => {
    if (!(object instanceof PDFName)) return undefined;
    const read = asReadersRead(object);
    if (read) found = true;
    return read;
  };
  const pending: PDFObject[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const fixed = fix(object);
    if (fixed && apply) doc.context.assign(ref, fixed);
    pending.push(object);
  }
  const seen = new Set<PDFObject>();
  while (pending.length > 0) {
    yield;
    const object = pending.pop()!;
    if (seen.has(object)) continue;
    seen.add(object);
    const dict = object instanceof PDFStream ? object.dict : object;
    if (dict instanceof PDFDict) {
      for (const [key, value] of dict.entries()) {
        const newKey = fix(key) as PDFName | undefined;
        const newValue = fix(value);
        if (apply && (newKey || newValue)) {
          if (newKey) dict.delete(key);
          dict.set(newKey ?? key, newValue ?? value);
        }
        if (value instanceof PDFDict || value instanceof PDFArray) pending.push(value);
      }
    } else if (dict instanceof PDFArray) {
      for (let i = 0; i < dict.size(); i++) {
        const value = dict.get(i);
        const newValue = fix(value);
        if (apply && newValue) dict.set(i, newValue);
        if (value instanceof PDFDict || value instanceof PDFArray) pending.push(value);
      }
    }
    if (found && !apply) return true;
  }
  return found;
}

// ---- what a move or removal carries ---------------------------------------------------------------

const NAME_TREE_MAX_ENTRIES = 100_000;
const NAME_TREE_MAX_DEPTH = 32;

/** The entries of a name or number tree (`leafKey` /Names or /Nums), in order; null when it cannot be read within the limits. */
function treeEntries(context: PDFContext, root: PDFObject | undefined, leafKey: 'Names' | 'Nums'): [PDFObject, PDFObject][] | null {
  const entries: [PDFObject, PDFObject][] = [];
  const pending: [PDFObject | undefined, number][] = [[root, 0]];
  const seen = new Set<PDFDict>();
  while (pending.length > 0) {
    const [object, depth] = pending.pop()!;
    const node = dictOf(context, object);
    if (!node || seen.has(node) || depth > NAME_TREE_MAX_DEPTH) return null;
    seen.add(node);
    const leaf = lookedUp(context, node.get(PDFName.of(leafKey)));
    if (leaf instanceof PDFArray) {
      if (leaf.size() % 2 !== 0) return null;
      for (let i = 0; i < leaf.size(); i += 2) entries.push([lookedUp(context, leaf.get(i))!, leaf.get(i + 1)]);
      if (entries.length > NAME_TREE_MAX_ENTRIES) return null;
    }
    const kids = lookedUp(context, node.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) for (let i = kids.size() - 1; i >= 0; i--) pending.push([kids.get(i), depth + 1]);
  }
  return entries;
}

const stringBytes = (object: PDFObject) => (object instanceof PDFString || object instanceof PDFHexString ? object.asBytes() : undefined);
const compareBytes = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** One page's label as pdf.js reads it: style (or none), prefix (or none), and its number. */
interface Label {
  style: PDFName | undefined;
  prefix: PDFString | PDFHexString | undefined;
  number: number;
}
const LABEL_STYLES = new Set(['D', 'R', 'r', 'A', 'a']);

/**
 * Every page's label, read by pdf.js's rules (Catalog._readPageLabels): undefined when the file has
 * none, null when they cannot be read exactly (a value that is not a dictionary, an unknown style, a
 * prefix that is not a string, a start that is not a whole number from 1, a key that is not a page).
 */
function pageLabels(source: PDFDocument, pageCount: number): Label[] | null | undefined {
  const context = source.context;
  const root = source.catalog.get(PDFName.of('PageLabels'));
  if (root === undefined) return undefined;
  const entries = treeEntries(context, root, 'Nums');
  if (entries === null) return null;
  const starts = new Map<number, PDFDict>();
  for (const [key, value] of entries) {
    const dict = dictOf(context, value);
    if (!(key instanceof PDFNumber) || !Number.isInteger(key.asNumber()) || key.asNumber() < 0 || !dict) return null;
    const type = lookedUp(context, dict.get(PDFName.of('Type')));
    const style = lookedUp(context, dict.get(PDFName.of('S')));
    const prefix = lookedUp(context, dict.get(PDFName.of('P')));
    const start = lookedUp(context, dict.get(PDFName.of('St')));
    if (type !== undefined && type !== PDFName.of('PageLabel')) return null;
    if (style !== undefined && !(style instanceof PDFName && LABEL_STYLES.has(style.decodeText()))) return null;
    if (prefix !== undefined && !(prefix instanceof PDFString || prefix instanceof PDFHexString)) return null;
    if (start !== undefined && !(start instanceof PDFNumber && Number.isInteger(start.asNumber()) && start.asNumber() >= 1)) return null;
    starts.set(key.asNumber(), dict);
  }
  const labels: Label[] = [];
  let current: Label = { style: undefined, prefix: undefined, number: 1 };
  for (let i = 0; i < pageCount; i++) {
    const dict = starts.get(i);
    if (dict) {
      const style = lookedUp(context, dict.get(PDFName.of('S')));
      const prefix = lookedUp(context, dict.get(PDFName.of('P')));
      const start = lookedUp(context, dict.get(PDFName.of('St')));
      current = {
        style: style instanceof PDFName ? style : undefined,
        prefix: prefix instanceof PDFString || prefix instanceof PDFHexString ? prefix : undefined,
        number: start instanceof PDFNumber ? start.asNumber() : 1,
      };
    } else if (i > 0) {
      current = { ...current, number: current.number + 1 };
    }
    labels.push(current);
  }
  return labels;
}

const samePrefix = (a: Label['prefix'], b: Label['prefix']) => (a === undefined || b === undefined ? a === b : compareBytes(a.asBytes(), b.asBytes()) === 0);

/** /PageLabels for pages showing `labels` in this order: a range wherever a label does not follow from the one before. */
function labelsTree(out: PDFDocument, labels: Label[]): PDFDict {
  const nums: PDFObject[] = [];
  labels.forEach((label, at) => {
    const before = labels[at - 1];
    const follows = before && before.style === label.style && samePrefix(before.prefix, label.prefix) && (label.style === undefined || label.number === before.number + 1);
    if (follows) return;
    const range = out.context.obj({});
    if (label.style) range.set(PDFName.of('S'), label.style);
    if (label.prefix) range.set(PDFName.of('P'), label.prefix.clone());
    if (label.style && label.number !== 1) range.set(PDFName.of('St'), PDFNumber.of(label.number));
    nums.push(PDFNumber.of(at), range);
  });
  return out.context.obj({ Nums: out.context.obj(nums) });
}

/** Catalog entries the copy does not carry, and how the report names them. */
const NOT_CARRIED_KEYS: readonly [string, NotCarried][] = [
  ['Metadata', 'xmp-metadata'],
  ['StructTreeRoot', 'accessibility-tags'],
  ['MarkInfo', 'accessibility-tags'],
  ['AA', 'document-scripts'],
  ['OpenAction', 'opening-view'],
  ['ViewerPreferences', 'viewer-settings'],
  ['PageLayout', 'viewer-settings'],
  ['Threads', 'article-threads'],
  ['URI', 'other-document-data'],
  ['SpiderInfo', 'other-document-data'],
  ['OutputIntents', 'other-document-data'],
  ['PieceInfo', 'other-document-data'],
  ['Perms', 'other-document-data'],
  ['Legal', 'other-document-data'],
  ['Requirements', 'other-document-data'],
  ['Collection', 'other-document-data'],
  ['NeedsRendering', 'other-document-data'],
  ['DSS', 'other-document-data'],
  ['AF', 'other-document-data'],
  ['DPartRoot', 'other-document-data'],
];
const NOT_CARRIED_ORDER: readonly NotCarried[] = ['xmp-metadata', 'accessibility-tags', 'document-scripts', 'opening-view', 'viewer-settings', 'article-threads', 'other-document-data'];

/**
 * Onto the copy `out` of `source`'s pages in `plan.order`: /Lang, the attachments, the named
 * destinations of kept pages (name tree and old /Dests), and the page labels; reports the rest.
 */
function carryDocumentParts(source: PDFDocument, out: PDFDocument, plan: PagePlan, report: PageOrderReport): void {
  const src = source.context;
  const dest = out.context;
  const map = planMapping(plan);
  const sourcePages = source.getPages();
  const outPages = out.getPages();
  const copier = new PageCopier(src, dest, {});
  const pageIndex = new Map<PDFRef, number>();
  sourcePages.forEach((page, index) => {
    pageIndex.set(page.ref, index);
    const at = map(index);
    copier.redirect(page.ref, at === undefined ? PDFNull : outPages[at].ref);
  });
  const notCarried = new Set<NotCarried>();
  let destinationsDropped = 0;

  /** A destination (array, or dictionary with /D) to a kept page. */
  const keptDestination = (value: PDFObject): boolean => {
    let looked = lookedUp(src, value);
    if (looked instanceof PDFDict) looked = lookedUp(src, looked.get(PDFName.of('D')));
    const page = looked instanceof PDFArray && looked.size() > 0 ? looked.get(0) : undefined;
    const index = page instanceof PDFRef ? pageIndex.get(page) : undefined;
    return index !== undefined && map(index) !== undefined;
  };

  const lang = source.catalog.get(PDFName.of('Lang'));
  if (lang !== undefined) out.catalog.set(PDFName.of('Lang'), copier.copy(lang));

  const names = dictOf(src, source.catalog.get(PDFName.of('Names')));
  if (names) {
    const carried = dest.obj({});
    for (const [key, value] of names.entries()) {
      const which = key.decodeText();
      if (which === 'EmbeddedFiles') {
        carried.set(key, copier.copy(value));
      } else if (which === 'Dests') {
        const entries = treeEntries(src, value, 'Names') ?? [];
        const kept = entries.filter(([name, target]) => stringBytes(name) !== undefined && keptDestination(target));
        destinationsDropped += entries.length - kept.length;
        kept.sort(([a], [b]) => compareBytes(stringBytes(a)!, stringBytes(b)!));
        if (kept.length > 0) carried.set(key, dest.obj({ Names: dest.obj(kept.flatMap(([name, target]) => [(name as PDFString).clone(), copier.copy(target)])) }));
      } else {
        notCarried.add(which === 'JavaScript' ? 'document-scripts' : 'other-document-data');
      }
    }
    if (carried.keys().length > 0) out.catalog.set(PDFName.of('Names'), dest.register(carried));
  }

  const oldDests = dictOf(src, source.catalog.get(PDFName.of('Dests')));
  if (oldDests) {
    const carried = dest.obj({});
    for (const [name, target] of oldDests.entries()) {
      if (keptDestination(target)) carried.set(name, copier.copy(target));
      else destinationsDropped += 1;
    }
    if (carried.keys().length > 0) out.catalog.set(PDFName.of('Dests'), dest.register(carried));
  }

  const labels = pageLabels(source, sourcePages.length);
  if (labels === null) report.pageLabelsDropped = true;
  else if (labels !== undefined) out.catalog.set(PDFName.of('PageLabels'), dest.register(labelsTree(out, plan.order.map((index) => labels[index]))));

  for (const [key, part] of NOT_CARRIED_KEYS) if (source.catalog.has(PDFName.of(key))) notCarried.add(part);
  if (destinationsDropped > 0) report.namedDestinationsDropped = destinationsDropped;
  if (notCarried.size > 0) report.notCarried = NOT_CARRIED_ORDER.filter((part) => notCarried.has(part));
}

/** Removes every object nothing reachable from the trailer's /Root and /Info refers to. */
function dropUnreachable(doc: PDFDocument, pace: Pace): Promise<void> {
  return runPaced(unreachableDropped(doc), pace);
}

function* unreachableDropped(doc: PDFDocument): Work<void> {
  const { context } = doc;
  const reachable = new Set<PDFRef>();
  const pending: PDFObject[] = [context.trailerInfo.Root, context.trailerInfo.Info].filter((x): x is PDFObject => x !== undefined);
  while (pending.length > 0) {
    yield;
    const object = pending.pop()!;
    if (object instanceof PDFRef) {
      if (reachable.has(object)) continue;
      reachable.add(object);
      const value = context.lookup(object);
      if (value !== undefined) pending.push(value);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) pending.push(value);
    } else if (object instanceof PDFArray) {
      pending.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      for (const [, value] of object.dict.entries()) pending.push(value);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) if (!reachable.has(ref)) context.delete(ref);
}

// ---- the check: every page draws as before --------------------------------------------------------

type Cantoo = typeof import('@cantoo/pdf-lib');

/** What draws: the content streams (null when /Contents holds something else) and the resources they draw with. */
interface Drawing {
  streams: CantooObject[] | null;
  resources: CantooDict | undefined;
}

const RESOURCE_CATEGORIES = ['XObject', 'Font', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties'];
const FORM_DEPTH = 8;

/**
 * The first page of the result (by its number in the source, from 1) that would not draw as the source
 * page it came from, as a reader reads both; null when every page matches. Compared: the content
 * streams' bytes, and for every name the content writes that the source's resources hold, the same
 * resource of the same kind in the result's (forms followed in, up to FORM_DEPTH). Throws
 * 'organise-unverified' when either file cannot be read for the check.
 */
async function firstChangedPage(file: Uint8Array, result: Uint8Array, plan: PagePlan, pace: Pace): Promise<number | null> {
  const lib: Cantoo = await import('@cantoo/pdf-lib');
  let source: CantooDocument;
  let made: CantooDocument;
  try {
    source = await loadCantoo(lib, file, true);
    made = await loadCantoo(lib, result, false);
  } catch {
    throw unverifiable();
  }
  const sourcePages = source.getPages();
  const madePages = made.getPages();
  if (madePages.length !== plan.order.length) throw unverifiable();
  for (const [at, index] of plan.order.entries()) {
    if (!sameDrawing(lib, drawingOf(lib, sourcePages[index].node), drawingOf(lib, madePages[at].node), 0, new Set())) return index + 1;
    // A turn for the screen by the clock: on a 320-page ledger the whole check held the window about 2 s (INT2).
    await pace();
  }
  return null;
}

const unverifiable = () => new PdfToolsError('organise-unverified', 'The organised file could not be checked against the source. Nothing was created.');

/**
 * The second parser's load (`PDFDocument.load` with `updateMetadata: false` and PARSE_OBJECTS_PER_TICK),
 * with its waits taken by the clock as pace.ts takes pdf-lib's (REV-A B6: its slices of 1,500 objects were
 * the longest stretch left in Organise on the 320-page ledger). Its own load when its insides differ.
 */
async function loadCantoo(lib: Cantoo, bytes: Uint8Array, ignoreEncryption: boolean): Promise<CantooDocument> {
  const parser = (lib.PDFParser.forBytesWithOptions as (...args: unknown[]) => unknown)(bytes, PARSE_OBJECTS_PER_TICK, false, false, false, undefined, false) as {
    shouldWaitForTick?: unknown;
    parseDocument?: () => Promise<unknown>;
  };
  if (typeof parser.shouldWaitForTick !== 'function' || typeof parser.parseDocument !== 'function') {
    return lib.PDFDocument.load(bytes, { ignoreEncryption, updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK });
  }
  parser.shouldWaitForTick = byTheClock();
  const Doc = lib.PDFDocument as unknown as new (context: unknown, ignoreEncryption: boolean, updateMetadata: boolean, preserveXFA: boolean) => CantooDocument;
  return new Doc(await parser.parseDocument(), ignoreEncryption, false, false);
}

function drawingOf(lib: Cantoo, page: CantooPageLeaf): Drawing {
  const context = page.context;
  const look = (o: CantooObject | undefined) => (o instanceof lib.PDFRef ? context.lookup(o) : o);
  const resources = look(page.getInheritableAttribute(lib.PDFName.of('Resources')));
  const contents = look(page.get(lib.PDFName.of('Contents')));
  let streams: CantooObject[] | null;
  if (contents === undefined) streams = [];
  else if (contents instanceof lib.PDFRawStream) streams = [contents];
  else if (contents instanceof lib.PDFArray) streams = contents.asArray().map(look).filter((s): s is CantooObject => s !== undefined);
  else streams = null;
  if (streams && !streams.every((s) => s instanceof lib.PDFRawStream)) streams = null;
  return { streams, resources: resources instanceof lib.PDFDict ? resources : undefined };
}

function sameDrawing(lib: Cantoo, source: Drawing, made: Drawing, depth: number, seen: Set<CantooObject>): boolean {
  const { PDFArray: Arr, PDFDict: Dict, PDFName: Name, PDFNull: Null, PDFRawStream: Raw, PDFRef: Ref } = lib;
  // The content itself: the same streams, byte for byte.
  if ((source.streams === null) !== (made.streams === null)) return false;
  if (source.streams && made.streams) {
    if (source.streams.length !== made.streams.length) return false;
    for (const [i, stream] of source.streams.entries()) {
      const a = (stream as CantooRawStream).contents;
      const b = (made.streams[i] as CantooRawStream).contents;
      if (a.length !== b.length || a.some((byte, k) => byte !== b[k])) return false;
    }
  }
  // The names it writes; when it cannot be decoded, every name its resources hold counts.
  let used: Set<string> | null = null;
  if (source.streams) {
    try {
      used = namesIn(...source.streams.map((s) => lib.decodePDFRawStream(s as CantooRawStream).decode()));
    } catch {
      used = null;
    }
  }
  const look = (context: CantooDict['context'], o: CantooObject | undefined) => (o instanceof Ref ? context.lookup(o) : o);
  const kind = (o: CantooObject | undefined): string => {
    const nameOf = (n: CantooObject | undefined) => (n instanceof Name ? n.decodeText() : '');
    if (o instanceof Raw) return `stream/${nameOf(o.dict.get(Name.of('Subtype')))}`;
    if (o instanceof Dict) return `dict/${nameOf(o.get(Name.of('Type')))}/${nameOf(o.get(Name.of('Subtype')))}`;
    if (o instanceof Arr) return `array/${nameOf(o.size() > 0 ? o.get(0) : undefined)}`;
    if (o instanceof Name) return `name/${o.decodeText()}`;
    return o === undefined ? 'none' : o.constructor.name;
  };
  if (!source.resources) return true;
  for (const category of RESOURCE_CATEGORIES) {
    const key = Name.of(category);
    const sourceCategory = look(source.resources.context, source.resources.get(key));
    if (!(sourceCategory instanceof Dict)) continue;
    const madeCategory = made.resources ? look(made.resources.context, made.resources.get(key)) : undefined;
    for (const [name, value] of sourceCategory.entries()) {
      if (value === Null || (used && !used.has(name.decodeText()))) continue;
      const sourceObject = look(sourceCategory.context, value);
      if (sourceObject === undefined || sourceObject === Null) continue;
      const madeObject = madeCategory instanceof Dict ? look(madeCategory.context, madeCategory.get(name)) : undefined;
      if (kind(madeObject) !== kind(sourceObject)) return false;
      const isForm = sourceObject instanceof Raw && sourceObject.dict.get(Name.of('Subtype')) === Name.of('Form');
      if (category !== 'XObject' || !isForm || depth >= FORM_DEPTH || seen.has(sourceObject)) continue;
      seen.add(sourceObject);
      const formMade = madeObject as CantooRawStream;
      const ownSource = look(sourceObject.dict.context, sourceObject.dict.get(Name.of('Resources')));
      const ownMade = look(formMade.dict.context, formMade.dict.get(Name.of('Resources')));
      const inner = (own: CantooObject | undefined, drawer: CantooDict | undefined) => (own instanceof Dict ? own : drawer);
      if (
        !sameDrawing(
          lib,
          { streams: [sourceObject], resources: inner(ownSource, source.resources) },
          { streams: [formMade], resources: inner(ownMade, made.resources) },
          depth + 1,
          seen,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

// ---- organise ---------------------------------------------------------------------------------------

/** One way of making the result, with names as pdf-lib read them or as readers read them. */
async function makeResult(file: Uint8Array, plan: PagePlan, turnOnly: boolean, namesAsReaders: boolean, options: PageOrderOptions, report: PageOrderReport, pace: Pace): Promise<Uint8Array> {
  if (turnOnly) {
    const doc = await load(file, options.check);
    if (namesAsReaders) await readNamesAsReaders(doc, true, pace);
    const pages = doc.getPages();
    for (const [index, page] of pages.entries()) {
      if (options.onPage) await options.onPage(index, pages.length);
      await pace();
      turnPage(page.node, plan.turns[index] ?? 0);
    }
    doc.setProducer(APP_NAME);
    doc.setModificationDate(new Date());
    await dropUnreachable(doc, pace);
    return savePaced(doc, { useObjectStreams: !claimsPdfA1(doc) });
  }
  const source = await load(file, options.check);
  let sourceBytes = file;
  if (namesAsReaders) {
    await readNamesAsReaders(source, true, pace);
    sourceBytes = await savePaced(source);
  }
  const copied = await extractPages(sourceBytes, [...plan.order], { report, onPage: options.onPage, check: options.check });
  // The page copy wrote each page's inherited entries, /Rotate among them, onto the copied page.
  const out = await loadPaced(copied, { updateMetadata: false, check: options.check });
  carryDocumentParts(source, out, plan, report);
  for (const [at, page] of out.getPages().entries()) {
    await pace();
    turnPage(page.node, plan.turns[plan.order[at]] ?? 0);
  }
  await dropUnreachable(out, pace);
  return savePaced(out);
}

/**
 * A page tree that is its own parent, or a chain of references deeper than the call stack, overflows the
 * stack inside pdf-lib or the page copy (REV-A S2, S3): refused plainly, as a damaged file, never as the
 * generic failure.
 */
function stackSafe<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof RangeError) throw notAPdf();
    throw error;
  });
}

/**
 * The pages of `file` in `plan.order`, each turned by its `plan.turns` entry (design 5.15). The source
 * is not changed. `options.report` is filled in when the run succeeds: a turn-only run reports nothing;
 * a move or removal reports what the page copy reports (`sharedResourcesKept`, `bookmarksDropped`) and
 * what was not carried (`pageLabelsDropped`, `namedDestinationsDropped`, `notCarried`; organiseNotes
 * words them). `options.onPage` is called before each page with the pages done so far and stops the run
 * by throwing (a cancel); when the run is made a second time (see the file's notes) it starts again.
 * Throws PdfToolsError: checkPagePlan's codes, 'not-a-pdf', 'encrypted', 'page-would-change' (a page
 * would not draw as before), 'organise-unverified' (the result could not be checked).
 */
export async function organisePages(file: Uint8Array, plan: PagePlan, options: PageOrderOptions = {}): Promise<Uint8Array> {
  const source = await load(file, options.check);
  const pageCount = pageCountOf(source);
  checkPagePlan(plan, pageCount);
  const turnOnly = isTurnOnly(plan, pageCount);
  // Turns for the window by the clock in every loop here (REV-A B6); Stop is checked by `onPage`.
  const pace = pacer();
  const renamed = await readNamesAsReaders(source, false, pace);
  let changedPage = 0;
  for (const namesAsReaders of renamed ? [true, false] : [false]) {
    const report: PageOrderReport = {};
    const result = await stackSafe(() => makeResult(file, plan, turnOnly, namesAsReaders, options, report, pace));
    const changed = await stackSafe(() => firstChangedPage(file, result, plan, pace));
    if (changed === null) {
      if (options.report) Object.assign(options.report, report);
      return result;
    }
    changedPage = changed;
  }
  throw new PdfToolsError(
    'page-would-change',
    renamed
      ? `This file uses a name form that cannot be kept; page ${changedPage} would lose an image or font. Nothing was created.`
      : `Page ${changedPage} would not look the same in the result. Nothing was created.`,
  );
}
