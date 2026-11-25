// Bookmarks (the PDF "outline") read, carried to a result and written, with pdf-lib's own objects
// (design 5.10). Reading never throws and never loops; writing deletes the old outline's objects so a
// removed or renamed title is gone from the saved bytes, and writes every title as UTF-16BE hex
// (pdf-lib's PDFString.of corrupts non-Latin text). No React, no DOM.
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { runAtOnce, runPaced, type Pace, type Work } from './pace';

/** How the viewer is positioned on the target page: `XYZ left top zoom`, `Fit`, `FitH top` and the others. */
export interface DestView {
  kind: string;
  args: readonly (number | null)[];
}

/** Why a bookmark goes to no page of its file (absent for one that has a page, or a web address). */
export type Unresolved = 'remote' | 'badpage' | 'named-missing' | 'other-action' | 'no-target';

export interface OutlineItem {
  title: string;
  /** Zero-based page of this file; null when the bookmark goes to no page of it. */
  page: number | null;
  children: OutlineItem[];
  open: boolean;
  bold?: boolean;
  italic?: boolean;
  color?: readonly [number, number, number];
  view?: DestView;
  /** A web address (kept, written back as it was). */
  uri?: string;
  unresolved?: Unresolved;
  /** The file's own bookmark has no title; it is kept as it is until the user types one. */
  untitled?: true;
}

export interface OutlineProblems {
  cycles: number;
  truncatedNodes: boolean;
  truncatedDepth: boolean;
  longTitles: number;
  unresolved: number;
}

export const OUTLINE_MAX_ITEMS = 10_000;
export const OUTLINE_MAX_DEPTH = 32;
/** A title is cut here when read, and when written, so a file's own long titles are not changed by a rewrite. */
export const TITLE_READ_MAX = 1_000;
/** The longest title a person may type. */
export const TITLE_TYPED_MAX = 256;
const NAME_TREE_MAX_ENTRIES = 100_000;

const name = (key: string) => PDFName.of(key);
const OUTLINES = name('Outlines');
const FIRST = name('First');
const LAST = name('Last');
const NEXT = name('Next');
const PREV = name('Prev');
const TITLE = name('Title');
const DEST = name('Dest');
const DESTS = name('Dests');
const NAMES = name('Names');
const KIDS = name('Kids');
const COUNT = name('Count');
const ACTION = name('A');
const ACTION_TYPE = name('S');
const ACTION_DEST = name('D');
const TYPE = name('Type');
const URI = name('URI');
const FLAGS = name('F');
const COLOR = name('C');
const PAGE_MODE = name('PageMode');

const look = (context: PDFContext, object: PDFObject | undefined): PDFObject | undefined => (object instanceof PDFRef ? context.lookup(object) : object);
const dictOf = (context: PDFContext, object: PDFObject | undefined): PDFDict | undefined => {
  const value = look(context, object);
  return value instanceof PDFDict ? value : undefined;
};
const arrayOf = (context: PDFContext, object: PDFObject | undefined): PDFArray | undefined => {
  const value = look(context, object);
  return value instanceof PDFArray ? value : undefined;
};
const isString = (object: PDFObject | undefined): object is PDFString | PDFHexString => object instanceof PDFString || object instanceof PDFHexString;

// ---- titles --------------------------------------------------------------------------------------

/** The text of a PDF text string: UTF-16 (either order) or UTF-8 with its mark, else PDFDocEncoding. Never throws. */
function decodeText(object: PDFString | PDFHexString): string {
  let bytes: Uint8Array;
  try {
    bytes = object.asBytes();
  } catch {
    return '';
  }
  const decode = (label: string, from: number) => {
    try {
      return new TextDecoder(label).decode(bytes.subarray(from));
    } catch {
      return '';
    }
  };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decode('utf-16be', 2);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decode('utf-16le', 2);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decode('utf-8', 3);
  try {
    return object.decodeText();
  } catch {
    return '';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const INVISIBLE = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function cutCodePoints(text: string, max: number): string {
  let count = 0;
  let i = 0;
  while (i < text.length && count < max) {
    i += text.codePointAt(i)! > 0xffff ? 2 : 1;
    count++;
  }
  return text.slice(0, i);
}

/**
 * A bookmark title as it may be kept: control characters and line or paragraph separators become a
 * space; direction marks, the zero-width space and the byte-order mark are removed; the zero-width
 * joiner and non-joiner stay (Hindi needs them); a lone surrogate becomes U+FFFD; spaces are
 * collapsed and trimmed; at most `max` characters, never cutting a pair in two.
 */
export function cleanTitle(raw: string, max: number = TITLE_TYPED_MAX): string {
  const text = raw.replace(LONE_SURROGATE, '�').replace(INVISIBLE, '').replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  return cutCodePoints(text, max).trim();
}

// ---- destinations --------------------------------------------------------------------------------

const latin1 = (bytes: Uint8Array) => {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
};

class NamedDestinations {
  private tree?: Map<string, PDFObject>;
  constructor(
    private readonly context: PDFContext,
    private readonly catalog: PDFDict,
  ) {}

  private buildTree(): Map<string, PDFObject> {
    const map = new Map<string, PDFObject>();
    const root = dictOf(this.context, dictOf(this.context, this.catalog.get(NAMES))?.get(DESTS));
    if (!root) return map;
    const seen = new Set<PDFDict>();
    const stack: [PDFDict, number][] = [[root, 0]];
    while (stack.length > 0 && map.size < NAME_TREE_MAX_ENTRIES) {
      const [node, depth] = stack.pop()!;
      if (seen.has(node) || depth > OUTLINE_MAX_DEPTH) continue;
      seen.add(node);
      const pairs = arrayOf(this.context, node.get(NAMES));
      if (pairs) {
        for (let i = 0; i + 1 < pairs.size() && map.size < NAME_TREE_MAX_ENTRIES; i += 2) {
          const key = look(this.context, pairs.get(i));
          if (isString(key)) map.set(latin1(key.asBytes()), pairs.get(i + 1));
        }
      }
      const kids = arrayOf(this.context, node.get(KIDS));
      if (kids) {
        for (let i = kids.size() - 1; i >= 0; i--) {
          const kid = dictOf(this.context, kids.get(i));
          if (kid) stack.push([kid, depth + 1]);
        }
      }
    }
    return map;
  }

  /** The destination (an array, or a dictionary holding /D) for a name or a string, or undefined. */
  find(key: PDFObject): PDFObject | undefined {
    const old = (text: string) => dictOf(this.context, this.catalog.get(DESTS))?.get(PDFName.of(text));
    if (key instanceof PDFName) {
      const text = key.decodeText();
      return old(text) ?? (this.tree ??= this.buildTree()).get(text);
    }
    if (isString(key)) {
      const text = latin1(key.asBytes());
      return (this.tree ??= this.buildTree()).get(text) ?? old(text);
    }
    return undefined;
  }
}

/**
 * For the name (or string) of a named destination, the page object it opens, or undefined when the name
 * is not found, does not lead to a page, or is not a name. Looks in /Dests and in the /Names name tree.
 */
export function namedDestinationPage(context: PDFContext, catalog: PDFDict): (key: PDFObject) => PDFRef | undefined {
  const named = new NamedDestinations(context, catalog);
  return (key) => {
    const found = look(context, named.find(look(context, key) ?? key));
    const array = found instanceof PDFDict ? look(context, found.get(ACTION_DEST)) : found;
    if (!(array instanceof PDFArray) || array.size() === 0) return undefined;
    const first = array.get(0);
    return first instanceof PDFRef ? first : undefined;
  };
}

interface Target {
  page: number | null;
  view?: DestView;
  uri?: string;
  unresolved?: Unresolved;
}

/** The kinds of destination the PDF format has, with how many numbers each takes. */
const VIEW_ARGS: Readonly<Record<string, number>> = { XYZ: 3, Fit: 0, FitH: 1, FitV: 1, FitR: 4, FitB: 0, FitBH: 1, FitBV: 1 };

function viewOf(array: PDFArray): DestView | undefined {
  const kind = array.get(1);
  if (!(kind instanceof PDFName)) return undefined;
  const text = kind.decodeText();
  const wanted = VIEW_ARGS[text];
  if (wanted === undefined) return undefined;
  const args: (number | null)[] = [];
  for (let i = 0; i < wanted; i++) {
    const value = array.get(2 + i);
    args.push(value instanceof PDFNumber ? value.asNumber() : null);
  }
  return { kind: text, args };
}

// ---- reading -------------------------------------------------------------------------------------

/**
 * The bookmarks of a document, as a tree, however damaged the outline is: followed through /First
 * and /Next only, each item once, within 10,000 items and 32 levels (`problems` says when a limit was
 * hit). Never throws.
 */
export function readOutline(doc: PDFDocument): { items: OutlineItem[]; count: number; problems: OutlineProblems } {
  const problems: OutlineProblems = { cycles: 0, truncatedNodes: false, truncatedDepth: false, longTitles: 0, unresolved: 0 };
  const result = { items: [] as OutlineItem[], count: 0, problems };
  try {
    return readOutlineUnsafe(doc, result);
  } catch {
    // An outline too damaged to read is read as far as it went; this never stops a tool.
    return result;
  }
}

function readOutlineUnsafe(doc: PDFDocument, result: { items: OutlineItem[]; count: number; problems: OutlineProblems }): typeof result {
  const context = doc.context;
  const problems = result.problems;
  const root = dictOf(context, doc.catalog.get(OUTLINES));
  if (!root) return result;
  const pages = new Map<PDFRef, number>();
  doc.getPages().forEach((page, index) => pages.set(page.ref, index));
  const pageCount = pages.size;
  const named = new NamedDestinations(context, doc.catalog);

  const resolveDest = (value: PDFObject | undefined, hops = 0): Target => {
    let found = look(context, value);
    if (found instanceof PDFName || isString(found)) {
      if (hops > 0) return { page: null, unresolved: 'named-missing' };
      const target = named.find(found);
      return target === undefined ? { page: null, unresolved: 'named-missing' } : resolveDest(target, hops + 1);
    }
    if (found instanceof PDFDict) found = look(context, found.get(ACTION_DEST));
    if (!(found instanceof PDFArray) || found.size() === 0) return { page: null, unresolved: 'no-target' };
    const first = found.get(0);
    if (first instanceof PDFRef) {
      const index = pages.get(first);
      return index === undefined ? { page: null, unresolved: 'badpage' } : { page: index, view: viewOf(found) };
    }
    if (first instanceof PDFNumber) {
      // A page number belongs to a link into another file; viewers read one that this file has as that page.
      const index = first.asNumber();
      return Number.isInteger(index) && index >= 0 && index < pageCount ? { page: index, view: viewOf(found) } : { page: null, unresolved: 'remote' };
    }
    return { page: null, unresolved: 'no-target' };
  };

  const targetOf = (item: PDFDict): Target => {
    if (item.has(DEST)) return resolveDest(item.get(DEST));
    const action = dictOf(context, item.get(ACTION));
    if (!action) return { page: null, unresolved: 'no-target' };
    const kind = look(context, action.get(ACTION_TYPE));
    const type = kind instanceof PDFName ? kind.decodeText() : '';
    if (type === 'GoTo') return resolveDest(action.get(ACTION_DEST));
    if (type === 'URI') {
      const address = look(context, action.get(URI));
      const uri = isString(address) ? latin1(address.asBytes()) : '';
      return uri ? { page: null, uri } : { page: null, unresolved: 'other-action' };
    }
    return { page: null, unresolved: type === 'GoToR' ? 'remote' : 'other-action' };
  };

  const seen = new Set<PDFDict>([root]);
  const stack: { next: PDFObject | undefined; out: OutlineItem[]; depth: number }[] = [{ next: root.get(FIRST), out: result.items, depth: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const dict = dictOf(context, frame.next);
    if (!dict) {
      stack.pop();
      continue;
    }
    if (seen.has(dict)) {
      problems.cycles++;
      stack.pop();
      continue;
    }
    if (result.count >= OUTLINE_MAX_ITEMS) {
      problems.truncatedNodes = true;
      break;
    }
    seen.add(dict);
    result.count++;
    frame.next = dict.get(NEXT);
    const titleObject = look(context, dict.get(TITLE));
    const rawTitle = isString(titleObject) ? decodeText(titleObject) : '';
    if (rawTitle.length > TITLE_READ_MAX) problems.longTitles++;
    const target = targetOf(dict);
    if (target.unresolved) problems.unresolved++;
    const count = look(context, dict.get(COUNT));
    const flags = look(context, dict.get(FLAGS));
    const color = arrayOf(context, dict.get(COLOR));
    const item: OutlineItem = { title: cleanTitle(rawTitle, TITLE_READ_MAX), page: target.page, children: [], open: count instanceof PDFNumber && count.asNumber() > 0 };
    if (target.view) item.view = target.view;
    if (target.uri) item.uri = target.uri;
    if (target.unresolved) item.unresolved = target.unresolved;
    if (item.title === '') item.untitled = true;
    if (flags instanceof PDFNumber) {
      if (flags.asNumber() & 1) item.italic = true;
      if (flags.asNumber() & 2) item.bold = true;
    }
    if (color && color.size() === 3) {
      const rgb = [0, 1, 2].map((i) => {
        const part = look(context, color.get(i));
        return part instanceof PDFNumber ? Math.min(1, Math.max(0, part.asNumber())) : 0;
      }) as [number, number, number];
      if (rgb.some((part) => part !== 0)) item.color = rgb;
    }
    frame.out.push(item);
    if (dict.has(FIRST)) {
      if (frame.depth + 1 >= OUTLINE_MAX_DEPTH) problems.truncatedDepth = true;
      else stack.push({ next: dict.get(FIRST), out: item.children, depth: frame.depth + 1 });
    }
  }
  return result;
}

/** True when the outline has more bookmarks, or more levels, than were read: saving what was read would lose the rest. */
export function outlineOverLimits(problems: OutlineProblems): boolean {
  return problems.truncatedNodes || problems.truncatedDepth;
}

/** The number of levels of a tree (0 for an empty one). */
export function outlineDepth(items: readonly OutlineItem[]): number {
  let max = 0;
  const stack: [readonly OutlineItem[], number][] = [[items, 1]];
  while (stack.length > 0) {
    const [list, depth] = stack.pop()!;
    if (list.length > 0) max = Math.max(max, depth);
    for (const item of list) stack.push([item.children, depth + 1]);
  }
  return max;
}

// ---- carrying and filtering ----------------------------------------------------------------------

export interface CarriedOutline {
  items: OutlineItem[];
  /** Every item not kept: the three counts below added up. */
  dropped: number;
  /** Items that open another file, launch something, run a script or go to no page. */
  droppedNoPage: number;
  /** Items of a page that is in no result. */
  droppedLeftOut: number;
  /** Items of a page that is in another result (Split every N): they belong to that result, so they are not lost. */
  droppedOtherResult: number;
}

/**
 * The bookmarks a result keeps (design 5.10). An item whose page is in the result keeps everything and
 * points at the page's new index; an item whose page is not, and one that opens another file, runs a
 * script or goes to no page, is dropped and its kept children take its place, in order, one level up
 * (so an item with nothing kept under it goes, with everything under it); a web address is kept. Outline
 * order is never re-sorted. `newIndexOf` gives a page's new index, or undefined when it is left out;
 * `inAnotherResult` (Split every N) says which of those pages are in another result. The tree given is not changed.
 */
export function carryOutline(
  items: readonly OutlineItem[],
  newIndexOf: (oldIndex: number) => number | undefined,
  inAnotherResult?: (oldIndex: number) => boolean,
): CarriedOutline {
  let droppedNoPage = 0;
  let droppedLeftOut = 0;
  let droppedOtherResult = 0;
  const go = (list: readonly OutlineItem[]): OutlineItem[] => {
    const out: OutlineItem[] = [];
    for (const item of list) {
      const children = go(item.children);
      let page: number | null | undefined;
      if (item.unresolved === undefined) {
        if (item.page !== null) page = newIndexOf(item.page);
        else if (item.uri !== undefined) page = null;
      }
      if (page === undefined) {
        if (item.page === null || item.unresolved !== undefined) droppedNoPage++;
        else if (inAnotherResult?.(item.page)) droppedOtherResult++;
        else droppedLeftOut++;
        out.push(...children);
      } else {
        out.push({ ...item, page, children });
      }
    }
    return out;
  };
  const carried = go(items);
  return { items: carried, dropped: droppedNoPage + droppedLeftOut + droppedOtherResult, droppedNoPage, droppedLeftOut, droppedOtherResult };
}

/** The tree without the items `keep` refuses; what was under a removed item moves up into its place. Not changed in place. */
export function mapOutline(items: readonly OutlineItem[], keep: (item: OutlineItem) => boolean): { items: OutlineItem[]; removed: number } {
  let removed = 0;
  const go = (list: readonly OutlineItem[]): OutlineItem[] => {
    const out: OutlineItem[] = [];
    for (const item of list) {
      const children = go(item.children);
      if (keep(item)) out.push({ ...item, children });
      else {
        removed++;
        out.push(...children);
      }
    }
    return out;
  };
  return { items: go(items), removed };
}

// ---- writing -------------------------------------------------------------------------------------

/** A dictionary an outline item may be: nothing a page, a form field, an annotation or the catalog is. */
function outlineLike(context: PDFContext, dict: PDFDict): boolean {
  const type = look(context, dict.get(TYPE));
  if (type !== undefined && !(type instanceof PDFName && type.decodeText() === 'Outlines')) return false;
  return !['Kids', 'Contents', 'Resources', 'Subtype', 'FT', 'MediaBox'].some((key) => dict.has(name(key)));
}

/**
 * How many objects of an old outline are looked at, at most (a damaged outline can link to anything, or
 * loop): four times what the Bookmarks tool edits, so a healthy outline is always walked whole.
 */
const OLD_OUTLINE_MAX_OBJECTS = 4 * OUTLINE_MAX_ITEMS;
const PARENT = name('Parent');

/** The references written directly in an object (not followed): a dictionary's values, an array's items, a stream's dictionary. */
function* refsIn(object: PDFObject | undefined): Generator<PDFRef> {
  const stack: PDFObject[] = object === undefined ? [] : [object];
  while (stack.length > 0) {
    const value = stack.pop()!;
    if (value instanceof PDFRef) yield value;
    else if (value instanceof PDFDict) for (const [, entry] of value.entries()) stack.push(entry);
    else if (value instanceof PDFArray) for (let i = 0; i < value.size(); i++) stack.push(value.get(i));
    else if (value instanceof PDFStream) for (const [, entry] of value.dict.entries()) stack.push(entry);
  }
}

/** What taking the old outline out did: objects deleted, and old bookmarks left in the file because deleting them was not certain to be safe. */
export interface OldOutlineRemoval {
  deleted: number;
  /** Dictionaries with a title, reached from the old outline, that stay in the file (unlinked): an old title may still be in its bytes. */
  keptTitled: number;
}

/**
 * Takes the old outline out (REV-A B5): it is unlinked from the catalog first, then only objects that are
 * provably its own are deleted, so that a damaged or hostile outline cannot make a page lose its resources:
 * - its items: indirect dictionaries reached from the outline root through /First, /Last, /Next and /Prev
 *   (never /Parent), that look like items (no /Type other than Outlines, nothing a page, field, annotation
 *   or the catalog has), and whose /Parent chain leads back to the root;
 * - the root itself, the items' titles held as separate objects, and what the items' /A and /Dest hold (an
 *   action, an address, a script, a destination array), never entering a page, the page tree or the catalog;
 * - and of those, only the objects nothing else in the document refers to: every other object, the
 *   trailer, and anything kept are read for references (a reverse-reference check), and nothing deleted is
 *   still reachable from the trailer.
 * Anything doubtful stays in the file, unlinked; `keptTitled` counts the old bookmarks that stay. The walk
 * is bounded (OLD_OUTLINE_MAX_OBJECTS objects, each once) and yields so the window keeps its turns.
 */
function* removeOldOutline(doc: PDFDocument): Work<OldOutlineRemoval> {
  const context = doc.context;
  const start = doc.catalog.get(OUTLINES);
  if (start === undefined) return { deleted: 0, keptTitled: 0 };
  doc.catalog.delete(OUTLINES);
  const rootRef = start instanceof PDFRef ? start : undefined;
  const root = dictOf(context, start);
  if (!root) return { deleted: 0, keptTitled: 0 };

  // 1. Every dictionary the outline's links reach, and which of them look like items.
  const items = new Map<PDFRef, PDFDict>();
  const reached = new Set<PDFRef>();
  const titledReached = new Set<PDFRef>();
  const directSeen = new Set<PDFDict>([root]);
  let overflow = false;
  const links: PDFObject[] = [];
  const pushLinks = (dict: PDFDict) => {
    for (const key of [FIRST, LAST, NEXT, PREV]) {
      const link = dict.get(key);
      if (link !== undefined) links.push(link);
    }
  };
  pushLinks(root);
  while (links.length > 0) {
    yield;
    const link = links.pop()!;
    if (link instanceof PDFRef) {
      if (link === rootRef || reached.has(link)) continue;
      // Each object is looked at once and pushes at most four links, so this bounds the whole walk.
      if (reached.size + directSeen.size > OLD_OUTLINE_MAX_OBJECTS) {
        overflow = true;
        break;
      }
      reached.add(link);
      const dict = context.lookup(link);
      if (!(dict instanceof PDFDict)) continue;
      if (dict.has(TITLE)) titledReached.add(link);
      if (!outlineLike(context, dict)) continue;
      items.set(link, dict);
      pushLinks(dict);
    } else if (link instanceof PDFDict && !directSeen.has(link) && outlineLike(context, link)) {
      // An item written inside its neighbour goes with it; its own links are followed.
      if (reached.size + directSeen.size > OLD_OUTLINE_MAX_OBJECTS) {
        overflow = true;
        break;
      }
      directSeen.add(link);
      pushLinks(link);
    }
  }

  // 2. The items whose /Parent chain leads back to the root (every hop an item; no loop).
  const provable = new Map<PDFRef, boolean>();
  for (const ref of items.keys()) {
    const path: PDFRef[] = [];
    let at: PDFRef = ref;
    let answer = false;
    for (;;) {
      const known = provable.get(at);
      if (known !== undefined) {
        answer = known;
        break;
      }
      if (path.includes(at) || path.length > items.size) break;
      path.push(at);
      const parent = items.get(at)!.get(PARENT);
      if (rootRef !== undefined && parent === rootRef) {
        answer = true;
        break;
      }
      if (!(parent instanceof PDFRef) || !items.has(parent)) break;
      at = parent;
    }
    for (const step of path) provable.set(step, answer);
    yield;
  }

  // 3. What deleting the outline would delete: the root, the provable items, their titles and what they hold.
  const candidates = new Set<PDFRef>();
  if (rootRef !== undefined) candidates.add(rootRef);
  const held: PDFObject[] = [];
  for (const [ref, dict] of items) {
    if (!provable.get(ref)) continue;
    candidates.add(ref);
    const title = dict.get(TITLE);
    if (title instanceof PDFRef) candidates.add(title);
    for (const key of [ACTION, DEST]) {
      const value = dict.get(key);
      if (value instanceof PDFRef) held.push(value);
    }
  }
  const heldSeen = new Set<PDFRef>();
  while (held.length > 0) {
    yield;
    const value = held.pop()!;
    if (!(value instanceof PDFRef) || heldSeen.has(value) || candidates.has(value)) continue;
    heldSeen.add(value);
    const target = context.lookup(value);
    if (target === undefined) continue;
    if (target instanceof PDFDict) {
      const type = look(context, target.get(TYPE));
      if (type instanceof PDFName && ['Page', 'Pages', 'Catalog'].includes(type.decodeText())) continue;
    }
    candidates.add(value);
    for (const ref of refsIn(target)) held.push(ref);
  }

  // 4. The reverse-reference check: a candidate that any other object (or the trailer) refers to is kept,
  //    and so is everything a kept candidate refers to.
  const kept = new Set<PDFRef>();
  const keep: PDFRef[] = [];
  const mark = (ref: PDFRef) => {
    if (candidates.has(ref) && !kept.has(ref)) {
      kept.add(ref);
      keep.push(ref);
    }
  };
  for (const value of Object.values(context.trailerInfo)) if (value !== undefined) for (const ref of refsIn(value as PDFObject)) mark(ref);
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    yield;
    if (!candidates.has(ref)) for (const inner of refsIn(object)) mark(inner);
  }
  while (keep.length > 0) {
    yield;
    for (const inner of refsIn(context.lookup(keep.pop()!))) mark(inner);
  }

  // 5. The safety net: nothing about to be deleted may be reachable from the trailer.
  const reachable = new Set<PDFRef>();
  const walk: PDFObject[] = Object.values(context.trailerInfo).filter((value): value is PDFObject => value !== undefined);
  while (walk.length > 0) {
    yield;
    for (const ref of refsIn(walk.pop()!)) {
      if (reachable.has(ref)) continue;
      reachable.add(ref);
      const target = context.lookup(ref);
      if (target !== undefined) walk.push(target);
    }
  }

  let deleted = 0;
  for (const ref of candidates) {
    if (kept.has(ref) || reachable.has(ref)) continue;
    context.delete(ref);
    deleted++;
  }
  let keptTitled = overflow ? 1 : 0;
  for (const ref of titledReached) if (context.lookup(ref) !== undefined) keptTitled++;
  return { deleted, keptTitled };
}

/** Throws RangeError for a page index the document does not have, or more than 32 levels. */
function checkOutline(doc: PDFDocument, items: readonly OutlineItem[]): void {
  if (outlineDepth(items) > OUTLINE_MAX_DEPTH) throw new RangeError(`Bookmarks nest more than ${OUTLINE_MAX_DEPTH} levels deep.`);
  const count = doc.getPageCount();
  const stack: OutlineItem[] = [...items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.page !== null && (!Number.isInteger(item.page) || item.page < 0 || item.page >= count)) {
      throw new RangeError(`A bookmark points at page ${item.page + 1}, outside the ${count} pages.`);
    }
    stack.push(...item.children);
  }
}

/**
 * writeOutline for a document that may hold an outline already (the Bookmarks tool's own file): the old
 * outline is taken out with the window kept alive (`pace`, pace.ts), then the new one written. The same
 * checks and the same result as writeOutline, plus how many old bookmarks had to stay.
 */
export async function replaceOutline(doc: PDFDocument, items: readonly OutlineItem[], pace: Pace): Promise<{ written: number; deletedObjects: number; keptBookmarks: number }> {
  checkOutline(doc, items);
  const removal = await runPaced(removeOldOutline(doc), pace);
  const { written } = writeNewOutline(doc, items);
  return { written, deletedObjects: removal.deleted, keptBookmarks: removal.keptTitled };
}

/**
 * Replaces the document's bookmarks. The old outline's objects are deleted (not only unlinked), so an
 * old title is not left in the saved bytes. Titles are written as UTF-16BE hex strings, /Count by the
 * PDF rules, and /PageMode /UseOutlines is set when there are bookmarks and the page mode is unset or
 * "none" (removed when none are left and it was /UseOutlines). Named destinations are not touched.
 * Throws RangeError, before changing anything, for a page index the document does not have or more
 * than 32 levels.
 */
export function writeOutline(doc: PDFDocument, items: readonly OutlineItem[]): { written: number; deletedObjects: number; keptBookmarks: number } {
  checkOutline(doc, items);
  // The old outline's own objects go (removeOldOutline says which are certainly its own): a renamed or
  // deleted title is then gone from the bytes. In one stretch here; the Bookmarks tool uses replaceOutline.
  const removal = runAtOnce(removeOldOutline(doc));
  const { written } = writeNewOutline(doc, items);
  return { written, deletedObjects: removal.deleted, keptBookmarks: removal.keptTitled };
}

/** Writes `items` as the document's outline (it has none now) and sets the page mode. */
function writeNewOutline(doc: PDFDocument, items: readonly OutlineItem[]): { written: number } {
  const context = doc.context;
  const pages = doc.getPages();
  let written = 0;
  const numberOrNull = (value: number | null) => (value === null ? context.obj(null) : value);
  const destination = (item: OutlineItem): PDFArray => {
    const page = pages[item.page!];
    const view = item.view;
    if (view && VIEW_ARGS[view.kind] !== undefined) {
      return context.obj([page.ref, name(view.kind), ...Array.from({ length: VIEW_ARGS[view.kind] }, (_, i) => numberOrNull(view.args[i] ?? null))]);
    }
    const box = page.getMediaBox();
    return context.obj([page.ref, name('XYZ'), box.x, box.y + box.height, context.obj(null)]);
  };

  /** Writes one level; returns its refs and how many bookmarks it shows (itself and what is visible under it). */
  const build = (list: readonly OutlineItem[], parent: PDFRef): { refs: PDFRef[]; visible: number } => {
    const refs = list.map(() => context.nextRef());
    let visible = 0;
    list.forEach((item, i) => {
      written++;
      visible++;
      const dict: Record<string, PDFObject | number | string> = { Title: PDFHexString.fromText(cleanTitle(item.title, TITLE_READ_MAX)), Parent: parent };
      if (i > 0) dict.Prev = refs[i - 1];
      if (i < list.length - 1) dict.Next = refs[i + 1];
      if (item.page !== null) dict.Dest = destination(item);
      else if (item.uri) {
        // The address is written back byte for byte as it was read (each character is one byte).
        const address = Array.from(item.uri, (c) => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0')).join('');
        dict.A = context.obj({ S: 'URI', URI: PDFHexString.of(address) });
      }
      if (item.color) dict.C = context.obj([...item.color]);
      const flags = (item.italic ? 1 : 0) | (item.bold ? 2 : 0);
      if (flags) dict.F = flags;
      if (item.children.length > 0) {
        const below = build(item.children, refs[i]);
        dict.First = below.refs[0];
        dict.Last = below.refs[below.refs.length - 1];
        dict.Count = item.open ? below.visible : -below.visible;
        if (item.open) visible += below.visible;
      }
      context.assign(refs[i], context.obj(dict));
    });
    return { refs, visible };
  };

  if (items.length > 0) {
    const rootRef = context.nextRef();
    const top = build(items, rootRef);
    context.assign(rootRef, context.obj({ Type: 'Outlines', First: top.refs[0], Last: top.refs[top.refs.length - 1], Count: top.visible }));
    doc.catalog.set(OUTLINES, rootRef);
  }

  const mode = doc.catalog.get(PAGE_MODE);
  const current = mode instanceof PDFName ? mode.decodeText() : undefined;
  if (items.length > 0 && (current === undefined || current === 'UseNone')) doc.catalog.set(PAGE_MODE, name('UseOutlines'));
  if (items.length === 0 && current === 'UseOutlines') doc.catalog.delete(PAGE_MODE);
  return { written };
}
