// Copies chosen pages of one PDF into a new one, for Split and Delete pages.
//
// What this does and does not promise. Split and Delete pages copy only what the kept pages use, so
// the left-out pages' content, comments, annotations, form values, and the images, drawings and
// layers that only they use are not copied (tested on the structures in organiseLeaks.test.ts). This
// is not a redaction guarantee: fonts shared with kept pages and the form's default resources (/DR)
// are copied whole, a resource whose name a kept page happens to contain is kept, a few non-standard
// structures are copied as they are, and when a page cannot be read with certainty its resources are
// kept whole and the result is marked "May hold left-out pages' images"
// (OrganiseReport.sharedResourcesKept). Only Redact (phase 2) is meant to remove content with certainty.
//
// How:
// - a reference to a page of the source becomes the reference to its copy, or null when the page is
//   left out; the source's catalog, page tree and structure tree are never copied;
// - the annotations of left-out pages are never copied (a reply's /IRT or a popup's /Parent that
//   pointed at one is dropped); article beads and structure destinations (/SD) are not carried;
// - every copied page, form XObject, tiling pattern, annotation appearance and Type 3 font with
//   resources gets its own resource dictionary holding the entries its drawing may use (see
//   `ownResources`). The rule may keep too much, never too little: what it cannot follow with
//   certainty keeps the whole dictionary, and the report says so;
// - the form keeps the fields that have a widget on a kept page; every field's /Kids keeps only what
//   is kept; layers (/OCProperties) are carried for the layers the kept pages still use;
// - finally every object nothing refers to is removed (pdf-lib writes every object it holds).
import {
  decodePDFRawStream,
  PDFArray,
  PDFCatalog,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFPage,
  PDFPageLeaf,
  PDFPageTree,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { ACRO_FORM, asArray, asDict, FIELDS, isFieldNode, isSignatureField, KIDS, MAX_FIELD_DEPTH, PARENT } from './formFields';

export interface OrganiseReport {
  /**
   * Set when something a kept page draws with could not be followed with certainty, so the
   * resources concerned were kept whole and may include images or fonts of pages that were left
   * out: a content stream pdf-lib cannot decode (a filter or predictor it does not apply, a decoding
   * error), a /Contents entry that is not a stream, a resource dictionary entry that is not a
   * standard category, a resource that is not what its category holds, a resource name pdf-lib does
   * not read exactly (a lower-case or broken # escape), a chain of references deeper than
   * MAX_WALK_DEPTH, or a layer setting this copy does not know (carried as it is).
   */
  sharedResourcesKept?: boolean;
}

const name = (key: string) => PDFName.of(key);
const ANNOTS = name('Annots');
const SUBTYPE = name('Subtype');
const TYPE = name('Type');
const LINK = name('Link');
const POPUP = name('Popup');
const WIDGET = name('Widget');
const DEST = name('Dest');
const ACTION = name('A');
const ACTION_TYPE = name('S');
const GO_TO = name('GoTo');
const ACTION_DEST = name('D');
const STRUCTURE_DEST = name('SD');
const IN_REPLY_TO = name('IRT');
const REPLY_TYPE = name('RT');
const CALCULATION_ORDER = name('CO');
const RESOURCES = name('Resources');
const CONTENTS = name('Contents');
const BEADS = name('B');
const PAGE = name('P');
const GROUP = name('Group');
const APPEARANCE = name('AP');
const IMAGE = name('Image');
const FORM = name('Form');
const POSTSCRIPT = name('PS');
const TYPE3 = name('Type3');
const CHAR_PROCS = name('CharProcs');
const PATTERN_TYPE = name('PatternType');
const SOFT_MASK_GROUP = name('G');
const LUMINOSITY = name('Luminosity');
const ALPHA = name('Alpha');
const DECODE_PARMS = name('DecodeParms');
const PREDICTOR = name('Predictor');
const EXTERNAL_FILE = name('F');
const PAGES = name('Pages');
const STRUCT_ELEM = name('StructElem');
const STRUCT_TREE_ROOT = name('StructTreeRoot');
const OC_PROPERTIES = name('OCProperties');
const OCGS = name('OCGs');
const DEFAULT_CONFIG = name('D');
const CONFIGS = name('Configs');
const PROC_SET = name('ProcSet');
const XOBJECT = name('XObject');
const COLOR_SPACE = name('ColorSpace');
const PATTERN = name('Pattern');
const SHADING = name('Shading');
/** The resource categories a content stream names its resources in. /ProcSet is kept as it is; any other entry keeps everything. */
const CATEGORIES = ['XObject', 'Font', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties'].map(name);
/** Colour spaces used without being named: whenever the content uses the device space they replace. */
const IMPLICIT_COLOR_SPACES = ['DefaultGray', 'DefaultRGB', 'DefaultCMYK'];
/** How many references deep a resource is followed before it counts as unreadable. */
const MAX_WALK_DEPTH = 32;
/** Layer configuration entries that hold no reference (anything else unknown is carried, and said). */
const PLAIN_LAYER_SETTINGS = new Set(['Name', 'Creator', 'BaseState', 'Intent', 'ListMode']);
const LAYER_USAGE_SETTINGS = new Set(['Event', 'Category']);
/** The form-wide entries carried over: how values are drawn, and the resources they are drawn with. */
const FORM_ENTRIES = ['NeedAppearances', 'DA', 'DR', 'Q'].map(name);

// ---- names written in content streams -----------------------------------------------------------

const isWhitespace = (b: number) => b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
const isDelimiter = (b: number) => b === 0x28 || b === 0x29 || b === 0x3c || b === 0x3e || b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d || b === 0x2f || b === 0x25;
const hexValue = (b: number) => (b >= 0x30 && b <= 0x39 ? b - 0x30 : b >= 0x41 && b <= 0x46 ? b - 0x37 : b >= 0x61 && b <= 0x66 ? b - 0x57 : -1);
const isNumber = (object: PDFObject | undefined, value: number) => object instanceof PDFNumber && object.asNumber() === value;

/** A name's characters with `#xx` escapes decoded; a `#` not followed by two hex digits is kept as it is. */
function decodeName(raw: number[]): string {
  let text = '';
  for (let j = 0; j < raw.length; ) {
    const high = j + 2 < raw.length ? hexValue(raw[j + 1]) : -1;
    const low = j + 2 < raw.length ? hexValue(raw[j + 2]) : -1;
    if (raw[j] === 0x23 && high >= 0 && low >= 0) {
      text += String.fromCharCode(high * 16 + low);
      j += 3;
    } else {
      text += String.fromCharCode(raw[j]);
      j += 1;
    }
  }
  return text;
}

/**
 * Every name written in streams read one after another: each `/` and the characters up to the next
 * delimiter or white space. This is a plain byte search, not a parser: a name inside a string, a
 * comment or inline image data counts too, so it can only add names, never miss one. A name still
 * open at the end of a stream is counted as it stands there (a reader that reads each stream on its
 * own) and also as it continues into the next stream (pdf.js joins a page's streams).
 */
class NameScanner {
  readonly names = new Set<string>();
  private token: number[] | null = null;

  read(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (this.token !== null) {
        if (!isWhitespace(b) && !isDelimiter(b)) {
          this.token.push(b);
          continue;
        }
        this.names.add(decodeName(this.token));
        this.token = null;
      }
      if (b === 0x2f) this.token = [];
    }
    if (this.token !== null) this.names.add(decodeName(this.token));
  }
}

/** The names written in `streams`, read one after another (see NameScanner). */
export function namesIn(...streams: Uint8Array[]): Set<string> {
  const scanner = new NameScanner();
  for (const bytes of streams) scanner.read(bytes);
  return scanner.names;
}

/** A content stream's decoded bytes, or null when they cannot be read with certainty. */
function decodedContent(context: PDFContext, stream: PDFRawStream): Uint8Array | null {
  const { dict } = stream;
  if (dict.has(EXTERNAL_FILE)) return null; // the data is in another file
  // pdf-lib's decoders do not apply predictors: such a stream would come out garbled.
  const parms = dict.get(DECODE_PARMS);
  const lookedUpParms = parms instanceof PDFRef ? context.lookup(parms) : parms;
  for (const entry of lookedUpParms instanceof PDFArray ? lookedUpParms.asArray() : [lookedUpParms]) {
    const params = asDict(context, entry);
    const predictor = params?.get(PREDICTOR);
    if (predictor === undefined) continue;
    const value = predictor instanceof PDFRef ? context.lookup(predictor) : predictor;
    if (!(value instanceof PDFNumber) || value.asNumber() > 1) return null;
  }
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    return null; // a filter pdf-lib does not decode, or damaged data
  }
}

// ---- what one run reads from the source ---------------------------------------------------------

/** One resource category's entries by decoded name. */
type CategoryIndex = Map<string, [PDFName, PDFObject][]>;

/** What a resource brings with it (see PageCopier.walk). */
interface Walk {
  names: string[];
  streams: PDFRawStream[];
}

/**
 * What one run has read from the source, kept for every page and every part the run copies, so
 * that pages sharing one large resource dictionary do not read it again page after page.
 */
export class SourceScans {
  /** The names written in a content stream; null when it cannot be read with certainty. */
  readonly streamNames = new Map<PDFRawStream, Set<string> | null>();
  /** A category dictionary's entries by name; null when a name is not exact. */
  readonly categories = new Map<PDFDict, CategoryIndex | null>();
  /** What a resource brings with it; null when it cannot be followed with certainty. */
  readonly walks = new Map<PDFObject, Walk | null>();
}

/** What draws with one resource dictionary. */
interface Drawing {
  /**
   * The content to read. The streams of one unit are read one after another (a page's /Contents);
   * null when something there is not a stream.
   */
  units: PDFRawStream[][] | null;
  /** Objects drawn with these resources whose names count as used (a page's /Group, a form's own dictionary). */
  also: PDFObject[];
}

// ---- the copier ----------------------------------------------------------------------------------

export class PageCopier {
  private readonly copies = new Map<PDFObject, PDFObject>();

  constructor(
    private readonly src: PDFContext,
    private readonly dest: PDFContext,
    readonly report: OrganiseReport,
    private readonly scans: SourceScans = new SourceScans(),
  ) {}

  /** Every reference to `ref` in what is copied becomes `to`. */
  redirect(ref: PDFRef, to: PDFRef | typeof PDFNull): void {
    this.copies.set(ref, to);
  }

  /** The reference of the copy of `ref` made so far, without copying anything. */
  copyOf(ref: PDFRef): PDFRef | undefined {
    const copy = this.copies.get(ref);
    return copy instanceof PDFRef ? copy : undefined;
  }

  /** The reference of the copy of `ref`, copying it now if it has not been copied yet. */
  refFor(ref: PDFRef): PDFRef | undefined {
    const copy = this.copies.get(ref) ?? this.copy(ref);
    return copy instanceof PDFRef ? copy : undefined;
  }

  copy(object: PDFObject): PDFObject {
    if (object instanceof PDFRef) return this.copyRef(object);
    if (object instanceof PDFDict) return this.copyDict(object);
    if (object instanceof PDFArray) return this.copyArray(object);
    if (object instanceof PDFStream) return this.copyStream(object);
    return object.clone();
  }

  copyPage(original: PDFPageLeaf): PDFPageLeaf {
    const page = original.clone();
    // Entries the page inherits from its page tree (its resources among them) go onto the page itself.
    for (const key of PDFPageLeaf.InheritableEntries) {
      const entry = name(key);
      const value = page.getInheritableAttribute(entry);
      if (!page.get(entry) && value) page.set(entry, value);
    }
    page.delete(PARENT);
    page.delete(BEADS); // article threads are not carried
    const resources = page.get(RESOURCES);
    page.delete(RESOURCES);
    const copy = this.copyDict(page) as PDFPageLeaf;
    const own = this.ownResources(resources, this.pageDrawing(page));
    if (own !== undefined) copy.set(RESOURCES, own);
    return copy;
  }

  private lookedUp(object: PDFObject | undefined): PDFObject | undefined {
    return object instanceof PDFRef ? this.src.lookup(object) : object;
  }

  /** Whether a dictionary has a resource dictionary of its own (anything else there counts as none, as in pdf.js). */
  private hasOwnResources(dict: PDFDict): boolean {
    return asDict(this.src, dict.get(RESOURCES)) !== undefined;
  }

  /** Objects never copied and never followed: the source's pages, page tree, catalog and structure tree. */
  private outsidePages(value: PDFObject): boolean {
    if (value instanceof PDFPageLeaf || value instanceof PDFPageTree || value instanceof PDFCatalog) return true;
    return value instanceof PDFDict && (value.get(TYPE) === STRUCT_ELEM || value.get(TYPE) === STRUCT_TREE_ROOT);
  }

  private copyRef(ref: PDFRef): PDFObject {
    const known = this.copies.get(ref);
    if (known) return known;
    const value = this.src.lookup(ref);
    if (value === undefined || this.outsidePages(value)) {
      this.copies.set(ref, PDFNull);
      return PDFNull;
    }
    const target = this.dest.nextRef();
    this.copies.set(ref, target);
    this.dest.assign(target, this.copy(value));
    return target;
  }

  private copyDict(original: PDFDict): PDFDict {
    const known = this.copies.get(original);
    if (known) return known as PDFDict;
    const copy = original.clone(this.dest);
    this.copies.set(original, copy);
    const type3 = !(original instanceof PDFPageLeaf) && original.has(RESOURCES) && this.lookedUp(original.get(SUBTYPE)) === TYPE3;
    const action = original.has(ACTION_TYPE);
    for (const [key, value] of original.entries()) {
      if ((type3 && key === RESOURCES) || (action && key === STRUCTURE_DEST)) copy.delete(key);
      else copy.set(key, this.copy(value));
    }
    if (type3) {
      const glyphs = this.charProcsOf(original);
      const own = this.ownResources(original.get(RESOURCES), { units: glyphs && glyphs.map((glyph) => [glyph]), also: [] });
      if (own !== undefined) copy.set(RESOURCES, own);
    }
    return copy;
  }

  private copyArray(original: PDFArray): PDFArray {
    const known = this.copies.get(original);
    if (known) return known as PDFArray;
    const copy = original.clone(this.dest);
    this.copies.set(original, copy);
    for (let i = 0; i < original.size(); i++) copy.set(i, this.copy(original.get(i)));
    return copy;
  }

  private copyStream(original: PDFStream): PDFStream {
    const known = this.copies.get(original);
    if (known) return known as PDFStream;
    const copy = original.clone(this.dest);
    this.copies.set(original, copy);
    // A stream drawn with resources of its own: a form XObject (an annotation's appearance too) or a tiling pattern.
    const owner = original.dict.has(RESOURCES) && this.lookedUp(original.dict.get(SUBTYPE)) !== IMAGE;
    for (const [key, value] of original.dict.entries()) {
      if (owner && key === RESOURCES) copy.dict.delete(key);
      else copy.dict.set(key, this.copy(value));
    }
    if (owner) {
      const units = original instanceof PDFRawStream ? [[original]] : null;
      const own = this.ownResources(original.dict.get(RESOURCES), { units, also: [original] });
      if (own !== undefined) copy.dict.set(RESOURCES, own);
    }
    return copy;
  }

  /** A page's content streams, or null when /Contents holds something that is not a stream. */
  private contentsOf(page: PDFDict): PDFRawStream[] | null {
    const contents = this.lookedUp(page.get(CONTENTS));
    if (contents === undefined) return [];
    if (contents instanceof PDFRawStream) return [contents];
    if (contents instanceof PDFArray) {
      const streams = contents.asArray().map((entry) => this.lookedUp(entry));
      return streams.every((s) => s instanceof PDFRawStream) ? (streams as PDFRawStream[]) : null;
    }
    return null;
  }

  /** A Type 3 font's glyph streams, or null when one is not a stream. */
  private charProcsOf(font: PDFDict): PDFRawStream[] | null {
    const procs = asDict(this.src, font.get(CHAR_PROCS));
    if (!procs) return [];
    const streams = procs.values().map((entry) => this.lookedUp(entry));
    return streams.every((s) => s instanceof PDFRawStream) ? (streams as PDFRawStream[]) : null;
  }

  /**
   * What draws with a page's resources: its content streams (read one after another), the
   * appearance streams of its annotations that have no resources of their own (pdf.js draws those
   * with none, other readers may use the page's), and its /Group (its colour space may be named).
   */
  private pageDrawing(page: PDFDict): Drawing {
    const contents = this.contentsOf(page);
    if (contents === null) return { units: null, also: [] };
    const units: PDFRawStream[][] = contents.length > 0 ? [contents] : [];
    for (const entry of asArray(this.src, page.get(ANNOTS))) {
      const appearances = asDict(this.src, asDict(this.src, entry)?.get(APPEARANCE));
      for (const value of appearances?.values() ?? []) {
        const looked = this.lookedUp(value);
        const states = looked instanceof PDFDict ? looked.values().map((state) => this.lookedUp(state)) : [looked];
        for (const state of states) if (state instanceof PDFRawStream && !this.hasOwnResources(state.dict)) units.push([state]);
      }
    }
    const group = page.get(GROUP);
    return { units, also: group === undefined ? [] : [group] };
  }

  /**
   * The resource dictionary a copied page, form, pattern, appearance or Type 3 font gets: a new
   * dictionary holding, in each category, only the entries its drawing may use (`usedNames`). When
   * something cannot be followed with certainty, the resources are copied whole and the report says so.
   */
  private ownResources(resources: PDFObject | undefined, drawing: Drawing): PDFObject | undefined {
    if (resources === undefined) return undefined;
    const dict = asDict(this.src, resources);
    const index = dict ? this.resourceIndex(dict) : null;
    const used = index ? this.usedNames(drawing, index) : null;
    if (!dict || !index || !used) {
      this.report.sharedResourcesKept = true;
      return this.copy(resources);
    }
    const kept = this.dest.obj({});
    const procSet = dict.get(PROC_SET);
    if (procSet !== undefined) kept.set(PROC_SET, this.copy(procSet));
    for (const [category, entries] of index) {
      const copy = this.dest.obj({});
      for (const text of used) for (const [key, value] of entries.get(text) ?? []) copy.set(key, this.copy(value));
      // Kept even when empty: pdf.js merges a tiling pattern's resources with its drawer's category
      // by category, so a category the source had must still hide the drawer's.
      kept.set(category, copy);
    }
    return kept;
  }

  /**
   * The resources by category; null when an entry is neither a standard category nor /ProcSet, a
   * category is not a dictionary, or a name in it is not read exactly by pdf-lib.
   */
  private resourceIndex(resources: PDFDict): Map<PDFName, CategoryIndex> | null {
    const index = new Map<PDFName, CategoryIndex>();
    for (const [key, value] of resources.entries()) {
      if (key === PROC_SET) continue;
      if (!CATEGORIES.includes(key)) return null;
      const category = asDict(this.src, value);
      const entries = category ? this.categoryIndex(category) : null;
      if (!entries) return null;
      index.set(key, entries);
    }
    return index;
  }

  /**
   * A category's entries by decoded name, once per run. A name that still holds `#` after pdf-lib
   * decoded it (a lower-case escape, or a literal `#`) cannot be compared exactly: null.
   */
  private categoryIndex(category: PDFDict): CategoryIndex | null {
    const known = this.scans.categories.get(category);
    if (known !== undefined) return known;
    let index: CategoryIndex | null = new Map();
    for (const [key, value] of category.entries()) {
      const text = key.decodeText();
      if (text.includes('#')) {
        index = null;
        break;
      }
      const same = index.get(text);
      if (same) same.push([key, value]);
      else index.set(text, [[key, value]]);
    }
    this.scans.categories.set(category, index);
    return index;
  }

  /**
   * The names a drawing may use, to a fixed point:
   * - the names written in its content (`NameScanner`);
   * - for each name in use, in every category: the name values inside the resource it names (an
   *   Indexed or Pattern colour space based on a named one, an image's /ColorSpace, a form's /Group
   *   colour space...), and the names written in what that resource draws with these resources
   *   (see `walk`), read the same way;
   * - the implicit default colour spaces, when present.
   * Null when anything involved cannot be followed with certainty.
   */
  private usedNames(drawing: Drawing, index: Map<PDFName, CategoryIndex>): Set<string> | null {
    if (drawing.units === null) return null;
    const used = new Set<string>();
    const pending: string[] = [];
    const markUsed = (text: string) => {
      if (used.has(text)) return;
      used.add(text);
      pending.push(text);
    };
    const units = [...drawing.units];
    const queued = new Set<PDFRawStream>(units.flat());
    const followed = new Set<PDFObject>();
    const follow = (object: PDFObject): boolean => {
      if (followed.has(object)) return true;
      followed.add(object);
      const walk = this.walk(object);
      if (walk === null) return false;
      walk.names.forEach(markUsed);
      for (const stream of walk.streams) {
        if (queued.has(stream)) continue;
        queued.add(stream);
        units.push([stream]);
      }
      return true;
    };
    for (const object of drawing.also) if (!follow(object)) return null;
    const colorSpaces = index.get(COLOR_SPACE);
    for (const text of IMPLICIT_COLOR_SPACES) if (colorSpaces?.has(text)) markUsed(text);
    for (;;) {
      const unit = units.pop();
      if (unit) {
        const names = this.namesOf(unit);
        if (names === null) return null;
        names.forEach(markUsed);
        continue;
      }
      const text = pending.pop();
      if (text === undefined) return used;
      for (const [category, entries] of index) {
        for (const [, value] of entries.get(text) ?? []) if (!this.isExpected(category, value) || !follow(value)) return null;
      }
    }
  }

  /** The names written in a unit of content (see Drawing.units); null when a stream cannot be read with certainty. */
  private namesOf(unit: PDFRawStream[]): Set<string> | null {
    if (unit.length === 1) {
      const [stream] = unit;
      if (!this.scans.streamNames.has(stream)) {
        const bytes = decodedContent(this.src, stream);
        this.scans.streamNames.set(stream, bytes === null ? null : namesIn(bytes));
      }
      return this.scans.streamNames.get(stream)!;
    }
    const scanner = new NameScanner();
    for (const stream of unit) {
      const bytes = decodedContent(this.src, stream);
      if (bytes === null) return null;
      scanner.read(bytes);
    }
    return scanner.names;
  }

  /** Whether a resource is what its category holds; anything else cannot be followed with certainty. */
  private isExpected(category: PDFName, value: PDFObject): boolean {
    const object = this.lookedUp(value);
    if (object === undefined || object === PDFNull) return true; // it names nothing
    if (category === XOBJECT) {
      if (!(object instanceof PDFRawStream)) return false;
      const subtype = this.lookedUp(object.dict.get(SUBTYPE));
      return subtype === FORM || subtype === IMAGE || subtype === POSTSCRIPT;
    }
    if (category === COLOR_SPACE) return object instanceof PDFName || object instanceof PDFArray;
    if (category === PATTERN || category === SHADING) return object instanceof PDFRawStream || object instanceof PDFDict;
    return object instanceof PDFDict; // Font, ExtGState, Properties
  }

  /**
   * What one resource brings with it, read once per run:
   * - every name value inside it, followed through references (never into pages, the page tree,
   *   the catalog or the structure tree), not into the /Resources of a form or Type 3 font that has
   *   its own (those are trimmed for that form or font);
   * - the content streams it draws with its drawer's resources: a form XObject or soft-mask group
   *   without a resource dictionary of its own, a Type 3 font's glyphs when the font has none, and
   *   every tiling pattern (pdf.js merges a pattern's resources with its drawer's, so the pattern's
   *   own /Resources is followed too).
   * Null when it cannot be followed with certainty: a soft-mask group or glyph that is not a stream,
   * a stream pdf-lib did not read as raw data, or references deeper than MAX_WALK_DEPTH.
   */
  private walk(start: PDFObject): Walk | null {
    const known = this.scans.walks.get(start);
    if (known !== undefined) return known;
    const walk = this.walkFrom(start);
    this.scans.walks.set(start, walk);
    return walk;
  }

  private walkFrom(start: PDFObject): Walk | null {
    const names = new Set<string>();
    const streams: PDFRawStream[] = [];
    const groups = new Set<PDFObject>(); // soft-mask groups: form XObjects, whatever their /Subtype says
    const seen = new Set<PDFRef>();
    const queue: [PDFObject, number][] = [[start, 0]];
    // Breadth first, so that the depth of an object is the shortest chain of references to it.
    for (let head = 0; head < queue.length; head++) {
      const [object, depth] = queue[head];
      if (object instanceof PDFRef) {
        if (seen.has(object)) continue;
        seen.add(object);
        if (depth >= MAX_WALK_DEPTH) return null;
        const value = this.src.lookup(object);
        if (value !== undefined && !this.outsidePages(value)) queue.push([value, depth + 1]);
      } else if (object instanceof PDFName) {
        names.add(object.decodeText());
      } else if (object instanceof PDFArray) {
        for (const entry of object.asArray()) queue.push([entry, depth]);
      } else if (object instanceof PDFDict || object instanceof PDFRawStream) {
        const dict = object instanceof PDFRawStream ? object.dict : object;
        const subtype = this.lookedUp(dict.get(SUBTYPE));
        const ownResources = this.hasOwnResources(dict);
        let skipResources = false;
        if (object instanceof PDFRawStream) {
          const tiling = isNumber(this.lookedUp(dict.get(PATTERN_TYPE)), 1);
          const form = subtype === FORM || groups.has(object);
          if (tiling || (form && !ownResources)) streams.push(object);
          skipResources = form && ownResources && !tiling;
        } else if (subtype === TYPE3) {
          skipResources = ownResources;
          if (!ownResources) {
            const glyphs = this.charProcsOf(dict);
            if (glyphs === null) return null;
            streams.push(...glyphs);
          }
        }
        const maskType = this.lookedUp(dict.get(ACTION_TYPE));
        if ((maskType === LUMINOSITY || maskType === ALPHA) && dict.has(SOFT_MASK_GROUP)) {
          const group = this.lookedUp(dict.get(SOFT_MASK_GROUP));
          if (!(group instanceof PDFRawStream)) return null;
          groups.add(group);
          if (!this.hasOwnResources(group.dict)) streams.push(group);
        }
        for (const [key, value] of dict.entries()) if (!(skipResources && key === RESOURCES)) queue.push([value, depth]);
      } else if (object instanceof PDFStream) {
        return null;
      }
    }
    return { names: [...names], streams };
  }
}

// ---- after the pages are copied ------------------------------------------------------------------

/** A link whose explicit destination is a page that is not in the result. */
function linkGoesNowhere(context: PDFContext, annotation: PDFDict): boolean {
  const lookedUp = (object: PDFObject | undefined) => (object instanceof PDFRef ? context.lookup(object) : object);
  if (lookedUp(annotation.get(SUBTYPE)) !== LINK) return false;
  const action = asDict(context, annotation.get(ACTION));
  const destination = annotation.get(DEST) ?? (action && lookedUp(action.get(ACTION_TYPE)) === GO_TO ? action.get(ACTION_DEST) : undefined);
  return asArray(context, destination)[0] === PDFNull;
}

/**
 * On the result's pages: links to left-out pages and popups whose comment was on a left-out page go;
 * a reply to a comment of a left-out page loses its /IRT (it stays, as a comment of its own).
 */
function tidyAnnotations(out: PDFDocument): void {
  const { context } = out;
  for (const page of out.getPages()) {
    const annotations = asArray(context, page.node.get(ANNOTS));
    const kept = annotations.filter((entry) => {
      const annotation = asDict(context, entry);
      if (!annotation) return false;
      if (annotation.get(IN_REPLY_TO) === PDFNull) {
        annotation.delete(IN_REPLY_TO);
        annotation.delete(REPLY_TYPE);
      }
      if (annotation.get(POPUP) === PDFNull) annotation.delete(POPUP);
      if (annotation.get(SUBTYPE) === POPUP && annotation.get(PARENT) === PDFNull) return false;
      return !linkGoesNowhere(context, annotation);
    });
    if (kept.length !== annotations.length) page.node.set(ANNOTS, context.obj(kept));
  }
}

/** The annotations (by reference) on the given pages of the source. */
function annotationsOn(source: PDFDocument, pages: PDFPageLeaf[]): Set<PDFRef> {
  const found = new Set<PDFRef>();
  for (const page of pages) for (const entry of asArray(source.context, page.get(ANNOTS))) if (entry instanceof PDFRef) found.add(entry);
  return found;
}

/**
 * Gives the result an /AcroForm holding the source's fields that have a widget on a kept page.
 * A field keeps only its widgets on kept pages, a parent only its children that are kept; the
 * values, the drawn appearances, /NeedAppearances, /DA and /DR come with them, copied into the
 * result. Signature fields are left out (with /SigFlags): a copy cannot carry a valid signature.
 * Their widgets stay on the page as they are. Nothing is added when no field is kept.
 */
function rebuildForm(out: PDFDocument, source: PDFDocument, copier: PageCopier, onKeptPages: Set<PDFRef>): void {
  const context = source.context;
  const form = asDict(context, source.catalog.get(ACRO_FORM));
  if (!form) return;
  const keptFields = new Set<PDFRef>();
  const visited = new Set<PDFRef>();

  // Whether the field keeps a widget on a kept page; its copy's /Kids then holds only what is kept.
  const keep = (ref: PDFRef, depth: number): boolean => {
    if (visited.has(ref) || depth > MAX_FIELD_DEPTH) return false;
    visited.add(ref);
    const field = asDict(context, ref);
    if (!field || isSignatureField(context, field)) return false;
    if (!field.has(KIDS)) {
      // The field and its widget are one dictionary, copied with the page it is on.
      if (!onKeptPages.has(ref) || !copier.refFor(ref)) return false;
      keptFields.add(ref);
      return true;
    }
    const kids: PDFRef[] = [];
    for (const kid of asArray(context, field.get(KIDS))) {
      if (!(kid instanceof PDFRef)) continue;
      const kidDict = asDict(context, kid);
      if (kidDict && (isFieldNode(kidDict) ? keep(kid, depth + 1) : onKeptPages.has(kid))) kids.push(kid);
    }
    const copy = kids.length > 0 ? copier.refFor(ref) : undefined;
    const kidCopies = kids.map((kid) => copier.refFor(kid)).filter((kid): kid is PDFRef => kid !== undefined);
    if (!copy || kidCopies.length === 0) return false;
    out.context.lookup(copy, PDFDict).set(KIDS, out.context.obj(kidCopies));
    for (const kidCopy of kidCopies) out.context.lookup(kidCopy, PDFDict).set(PARENT, copy);
    keptFields.add(ref);
    return true;
  };

  const fields = asArray(context, form.get(FIELDS)).filter((entry): entry is PDFRef => entry instanceof PDFRef && keep(entry, 0));
  if (fields.length === 0) return;

  const rebuilt = out.context.obj({});
  rebuilt.set(FIELDS, out.context.obj(fields.map((ref) => copier.refFor(ref)!)));
  for (const key of FORM_ENTRIES) {
    const value = form.get(key);
    if (value !== undefined) rebuilt.set(key, copier.copy(value));
  }
  const order = asArray(context, form.get(CALCULATION_ORDER)).filter((entry): entry is PDFRef => entry instanceof PDFRef && keptFields.has(entry));
  if (order.length > 0) rebuilt.set(CALCULATION_ORDER, out.context.obj(order.map((ref) => copier.refFor(ref)!)));
  out.catalog.set(ACRO_FORM, out.context.register(rebuilt));
}

/**
 * Every /Kids array outside the page tree (field trees) keeps only kids that exist: a widget that is
 * on no page of the result and does not name one as its page (/P) goes (a widget of a left-out page,
 * now null, or one only its field lists), and so does a field left with no kids, up the tree. This
 * covers signature fields and fields missing from /Fields, which rebuildForm does not walk.
 */
function pruneFieldKids(out: PDFDocument): void {
  const { context } = out;
  const pages = new Set<PDFObject>();
  const onPages = new Set<PDFObject>();
  for (const page of out.getPages()) {
    pages.add(page.ref);
    for (const entry of asArray(context, page.node.get(ANNOTS))) onPages.add(entry);
  }
  const dead = (entry: PDFObject): boolean => {
    const kid = asDict(context, entry);
    if (!(entry instanceof PDFRef) || !kid) return true;
    if (kid.get(SUBTYPE) === WIDGET) return !onPages.has(entry) && !pages.has(kid.get(PAGE) ?? PDFNull);
    return kid.has(KIDS) && asArray(context, kid.get(KIDS)).length === 0;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [, object] of context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || object instanceof PDFPageTree || object.get(TYPE) === PAGES || !object.has(KIDS)) continue;
      const kids = asArray(context, object.get(KIDS));
      const alive = kids.filter((kid) => !dead(kid));
      if (alive.length !== kids.length) {
        object.set(KIDS, context.obj(alive));
        changed = true;
      }
    }
  }
}

/** The references reachable from the trailer's /Root and /Info. */
function reachableRefs(doc: PDFDocument): Set<PDFRef> {
  const { context } = doc;
  const reachable = new Set<PDFRef>();
  const stack: PDFObject[] = [context.trailerInfo.Root, context.trailerInfo.Info].filter((x): x is PDFObject => x !== undefined);
  while (stack.length > 0) {
    const object = stack.pop()!;
    if (object instanceof PDFRef) {
      if (reachable.has(object)) continue;
      reachable.add(object);
      const value = context.lookup(object);
      if (value !== undefined) stack.push(value);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof PDFArray) {
      stack.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      for (const [, value] of object.dict.entries()) stack.push(value);
    }
  }
  return reachable;
}

/**
 * Carries /OCProperties for the layers (optional content groups) the result still uses, so a layer
 * hidden by default stays hidden: the default configuration and any alternative ones keep their
 * settings for those layers only (ON, OFF, Locked, Order, RBGroups, AS). No layer the kept pages do
 * not use is named, except through a setting this copy does not know: that is carried as it is, and
 * the report says so.
 */
function carryLayers(out: PDFDocument, source: PDFDocument, copier: PageCopier): void {
  const src = source.context;
  const dest = out.context;
  const properties = asDict(src, source.catalog.get(OC_PROPERTIES));
  if (!properties) return;
  const reachable = reachableRefs(out);
  const kept = new Map<PDFRef, PDFRef>();
  for (const entry of asArray(src, properties.get(OCGS))) {
    const copy = entry instanceof PDFRef ? copier.copyOf(entry) : undefined;
    if (copy && reachable.has(copy)) kept.set(entry as PDFRef, copy);
  }
  if (kept.size === 0) return;
  const unknown = (value: PDFObject) => {
    copier.report.sharedResourcesKept = true;
    return copier.copy(value);
  };
  const refs = (value: PDFObject | undefined): PDFRef[] => asArray(src, value).flatMap((e) => (e instanceof PDFRef && kept.has(e) ? [kept.get(e)!] : []));
  const order = (value: PDFObject | undefined, depth = 0): PDFObject[] =>
    asArray(src, value).flatMap((e): PDFObject[] => {
      if (e instanceof PDFRef && kept.has(e)) return [kept.get(e)!];
      if (e instanceof PDFString || e instanceof PDFHexString) return [e.clone()];
      const nested = e instanceof PDFRef ? src.lookup(e) : e;
      if (nested instanceof PDFArray && depth < MAX_FIELD_DEPTH) {
        const inner = order(nested, depth + 1);
        return inner.some((x) => x instanceof PDFRef || x instanceof PDFArray) ? [dest.obj(inner)] : [];
      }
      return [];
    });
  const config = (value: PDFObject | undefined): PDFDict | undefined => {
    const settings = asDict(src, value);
    if (!settings) return undefined;
    const copy = dest.obj({});
    for (const [key, entry] of settings.entries()) {
      const k = key.decodeText();
      if (k === 'ON' || k === 'OFF' || k === 'Locked') copy.set(key, dest.obj(refs(entry)));
      else if (k === 'Order') copy.set(key, dest.obj(order(entry)));
      else if (k === 'RBGroups') copy.set(key, dest.obj(asArray(src, entry).map((group) => refs(group)).filter((group) => group.length > 0).map((group) => dest.obj(group))));
      else if (k === 'AS') {
        const usages = asArray(src, entry).flatMap((usage) => {
          const u = asDict(src, usage);
          const groups = refs(u?.get(OCGS));
          if (!u || groups.length === 0) return [];
          const usageCopy = dest.obj({});
          for (const [uk, uv] of u.entries()) {
            usageCopy.set(uk, uk === OCGS ? dest.obj(groups) : LAYER_USAGE_SETTINGS.has(uk.decodeText()) ? copier.copy(uv) : unknown(uv));
          }
          return [usageCopy];
        });
        copy.set(key, dest.obj(usages));
      } else copy.set(key, PLAIN_LAYER_SETTINGS.has(k) ? copier.copy(entry) : unknown(entry));
    }
    return copy;
  };
  const carried = dest.obj({});
  carried.set(OCGS, dest.obj([...kept.values()]));
  const defaults = config(properties.get(DEFAULT_CONFIG));
  if (defaults) carried.set(DEFAULT_CONFIG, defaults);
  const alternatives = asArray(src, properties.get(CONFIGS)).map((c) => config(c)).filter((c): c is PDFDict => c !== undefined);
  if (alternatives.length > 0) carried.set(CONFIGS, dest.obj(alternatives));
  out.catalog.set(OC_PROPERTIES, dest.register(carried));
}

/** Removes every object nothing in the document refers to. */
function dropUnreachable(doc: PDFDocument): void {
  const reachable = reachableRefs(doc);
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!reachable.has(ref)) doc.context.delete(ref);
}

export interface CopyOptions {
  /** What the run has read from the source already (Split every N shares one across its parts). */
  scans?: SourceScans;
  /** Called before each page is copied, with the pages copied so far; it stops the copy by throwing (a cancel). */
  onPage?: (done: number, total: number) => void | Promise<void>;
}

/**
 * Copies the pages at `indices` of `source` into `out` (in that order; a page may repeat, and its
 * copies then share its annotations), with the form fields, links and layers that go with them.
 */
export async function copyPagesOf(out: PDFDocument, source: PDFDocument, indices: number[], report: OrganiseReport, options: CopyOptions = {}): Promise<void> {
  const pages = source.getPages();
  const copier = new PageCopier(source.context, out.context, report, options.scans);
  const copyRefs = new Map<PDFRef, PDFRef>();
  for (const index of indices) if (!copyRefs.has(pages[index].ref)) copyRefs.set(pages[index].ref, out.context.nextRef());
  for (const page of pages) copier.redirect(page.ref, copyRefs.get(page.ref) ?? PDFNull);
  // The annotations of left-out pages are never copied (an annotation also on a kept page is).
  const keptPages = [...new Set(indices)].map((index) => pages[index].node);
  const onKeptPages = annotationsOn(source, keptPages);
  const leftOut = pages.filter((page) => !copyRefs.has(page.ref)).map((page) => page.node);
  for (const annotation of annotationsOn(source, leftOut)) if (!onKeptPages.has(annotation)) copier.redirect(annotation, PDFNull);

  const placed = new Set<PDFRef>();
  for (const [done, index] of indices.entries()) {
    if (options.onPage) await options.onPage(done, indices.length);
    const leaf = copier.copyPage(pages[index].node);
    const first = copyRefs.get(pages[index].ref)!;
    let ref = first;
    if (placed.has(first)) {
      ref = out.context.register(leaf);
    } else {
      out.context.assign(first, leaf);
      placed.add(first);
    }
    out.addPage(PDFPage.of(leaf, ref, out));
  }

  tidyAnnotations(out);
  rebuildForm(out, source, copier, onKeptPages);
  pruneFieldKids(out);
  carryLayers(out, source, copier);
  dropUnreachable(out);
}
