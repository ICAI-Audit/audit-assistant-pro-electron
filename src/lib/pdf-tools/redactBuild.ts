// Redact's build (design 5.9 "Output", and what the result carries).
//
// Each page with a box becomes a picture of the page with the boxes burned in (drawn by the
// renderer, Task A9, and handed in as bytes) plus, in the searchable form, an invisible text layer
// of the words the renderer chose to keep. Every other page goes through the page copy of Split and
// Delete pages (pageCopy.ts), after the pages to rebuild were emptied in the in-memory copy of the
// source: their content, resources and annotations are never reachable, so nothing of them is
// carried. What the copied pages keep is cleaned of what no check can read (page and annotation
// scripts, private application data, XMP, thumbnails, attachments and media, /Redact marks, actions
// other than going to a page or a web address); comments, links, form fields and layers stay and are
// left to the check (redactCheck.ts). Nothing else of the source document is carried: the result has
// only Producer and Creator "ICAI VERA" and dates, and bookmarks by the rules of 5.10, without those
// whose title (or web address) holds a redacted value.
//
// The build never decides what is redacted: the renderer's words and pictures say it. It refuses
// input it cannot place, and the check that follows proves the result.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFontEmbedder,
  StandardFonts,
  type PDFContext,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import { PARSE_OBJECTS_PER_TICK } from './inspect';
import { carryOutline, mapOutline, outlineOverLimits, readOutline, writeOutline, type OutlineItem } from './outline';
import { copyPagesOf, type OrganiseReport } from './pageCopy';
import { BOX_PAD_PT, type Rect } from './pageText';
import { PdfToolsError } from './types';

/** A page drawn by the renderer: Flate data (zlib) of 8-bit grey or RGB pixels, or a JPEG file. */
export interface PagePicture {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  encoding: 'flate-gray' | 'flate-rgb' | 'jpeg';
}

/** A word of the text layer: origin, direction and size as pdf.js reports them; width along the text, in page units. */
export interface LayerWord {
  text: string;
  transform: readonly [number, number, number, number, number, number];
  width: number;
}

/** A page made into a picture (zero-based index in the source), with the words its text layer keeps (none: picture only). */
export interface RebuiltPage {
  pageIndex: number;
  picture: PagePicture;
  words: readonly LayerWord[];
  /**
   * Why the page is rebuilt (fix round 1, ruling E): 'boxes', for its boxes (at least one; a place
   * the find marks hidden is given as a box too, so the text layer leaves its words out); 'flattened',
   * on the user's confirmation, as drawn and without boxes, to clear hits that are not drawn; 'safety' (wave 4,
   * ruling M), because the page may not be copied as it is: rebuilt under the proof, with the boxes the proof
   * placed, or none.
   */
  reason: 'boxes' | 'flattened' | 'safety';
  /**
   * The page's boxes (pageText.ts `Rect`: user space, before /Rotate, padded as drawn); empty only
   * for a flattened page. No word whose box, padded by BOX_PAD_PT, meets one is written: the run
   * leaves those words out, and the build makes sure of it.
   */
  boxes: readonly Rect[];
}

export interface RedactBuildOptions {
  /** True when a text (a bookmark title or web address) holds a redacted value in any checked form (redactCheck.ts `targetMatcher`). */
  titleHasValue: (title: string) => boolean;
  /**
   * Called before each page is copied and before each rebuilt page is put together, with the steps
   * done so far and their total (pages + rebuilt pages), and once more with done === total before
   * the file is written. It stops the build by throwing (a cancel); nothing is returned then.
   */
  onPage?: (done: number, total: number) => void | Promise<void>;
}

export interface RedactBuildReport {
  /** Characters of kept words that the standard Helvetica font cannot write (Hindi, the rupee sign...), left out of the text layer. */
  textLayerCharsOmitted: number;
  /** Words not written because they touch one of their page's boxes or lie outside the visible page (0 when the run filtered them, as it should). */
  wordsLeftOut: number;
  /** What was removed from the copied pages, by kind ('page /AA', 'annotation FileAttachment', 'action JavaScript'...). No values. */
  cleaned: Record<string, number>;
  /** Bookmarks removed because their title or web address holds a redacted value; their children moved up. */
  bookmarksRemoved: number;
  /** Bookmarks not carried by the rules of 5.10 (scripts, other files, no page), or all of them over the reading limits. */
  bookmarksDropped: number;
  /** The page copy kept a copied page's resources whole (pageCopy.ts OrganiseReport). */
  sharedResourcesKept: boolean;
  /** Pages (zero-based) rebuilt as drawn, without boxes, on the user's confirmation (reason 'flattened'), for the record. */
  pagesFlattened: number[];
}

/** The only entries of a rebuilt page. */
export const REBUILT_PAGE_KEYS: readonly string[] = ['Type', 'Parent', 'MediaBox', 'Rotate', 'UserUnit', 'Resources', 'Contents'];

const APP_NAME = 'ICAI VERA';
/** What a page to rebuild keeps in the in-memory source while the pages are copied. */
const BLANKED_PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'Rotate', 'UserUnit']);
/** Entries removed from everything the copied pages carry: none of them can be checked. */
const UNCHECKABLE_KEYS = ['AA', 'PieceInfo', 'Metadata', 'Thumb', 'AF'];
/** Annotations a copied page loses: attached files, media, 3D and /Redact marks. */
const DROPPED_ANNOTATIONS = new Set(['FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D', 'Redact']);
/** Action types named in the report; any other is counted as 'action other' (a name is never repeated from a file). */
const KNOWN_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ResetForm', 'ImportData', 'GoToR', 'GoToE', 'Sound', 'Movie', 'Hide', 'Named', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView', 'RichMediaExecute', 'Thread']);
/** Arrays from which a reference to a removed object is taken out rather than made null. */
const LIST_KEYS = new Set(['Annots', 'Kids', 'Fields', 'CO', 'OCGs', 'ON', 'OFF', 'Locked', 'Order']);
const NAME_TREE_MAX_ENTRIES = 100_000;
const NAME_TREE_MAX_DEPTH = 32;

const name = (key: string) => PDFName.of(key);
const ANNOTS = name('Annots');
const SUBTYPE = name('Subtype');
const TYPE = name('Type');
const ACTION = name('A');
const ACTION_TYPE = name('S');
const ACTION_DEST = name('D');
const NEXT = name('Next');
const DEST = name('Dest');
const DESTS = name('Dests');
const NAMES = name('Names');
const KIDS = name('Kids');
const PARENT = name('Parent');
const POPUP = name('Popup');
const IN_REPLY_TO = name('IRT');
const REPLY_TYPE = name('RT');
const RECT = name('Rect');
const FIELD_TYPE = name('FT');
const WIDGET = name('Widget');
const LINK = name('Link');
const MEDIA_BOX = name('MediaBox');
const ROTATE = name('Rotate');
const USER_UNIT = name('UserUnit');
const RESOURCES = name('Resources');
const CONTENTS = name('Contents');
const OC_PROPERTIES = name('OCProperties');
const ORDER = name('Order');

const look = (context: PDFContext, object: PDFObject | undefined): PDFObject | undefined => (object instanceof PDFRef ? context.lookup(object) : object);
const dictOf = (context: PDFContext, object: PDFObject | undefined): PDFDict | undefined => {
  const value = look(context, object);
  return value instanceof PDFDict ? value : undefined;
};
const arrayOf = (context: PDFContext, object: PDFObject | undefined): PDFArray | undefined => {
  const value = look(context, object);
  return value instanceof PDFArray ? value : undefined;
};
const nameText = (context: PDFContext, object: PDFObject | undefined) => {
  const value = look(context, object);
  return value instanceof PDFName ? value.decodeText() : undefined;
};

// ---- input -----------------------------------------------------------------------------------------

/**
 * A JPEG's frame (width, height, colour components) when the file is whole: a frame, then image data
 * (a start-of-scan header followed by at least one byte), then the end marker as its last two bytes.
 * Null for anything else (fix round 1, medium 5: a frame without data, or a file cut short, would draw
 * blank).
 */
function jpegFrame(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes.length < 6 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let frame: { width: number; height: number; components: number } | null = null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1];
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) return null; // the end before any image data
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return null;
    if (marker === 0xda) {
      // Image data follows the scan header and runs to the end marker.
      return frame && i + 2 + length < bytes.length - 2 ? frame : null;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) return null;
      frame = { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + length;
  }
  return null;
}

// Deflate (RFC 1951) tables: length codes 257-285 and distance codes 0-29, their bases and extra bits.
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A Huffman decoding table: indexed by the next `bits` input bits (first bit lowest); entry = symbol << 4 | code length, 0 = no code. */
interface Huffman {
  entries: Int32Array;
  bits: number;
}

/** The canonical Huffman table of these code lengths; null when the lengths are over-subscribed. */
function huffman(lengths: ArrayLike<number>, count: number): Huffman | null {
  const perLength = new Int32Array(16);
  let longest = 0;
  for (let s = 0; s < count; s++) {
    const length = lengths[s];
    perLength[length] += 1;
    if (length > longest) longest = length;
  }
  if (longest === 0) return { entries: new Int32Array(1), bits: 0 };
  perLength[0] = 0;
  let left = 1;
  for (let length = 1; length <= 15; length++) {
    left = left * 2 - perLength[length];
    if (left < 0) return null;
  }
  const next = new Int32Array(16);
  for (let length = 1, code = 0; length <= 15; length++) {
    code = (code + perLength[length - 1]) << 1;
    next[length] = code;
  }
  const size = 1 << longest;
  const entries = new Int32Array(size);
  for (let s = 0; s < count; s++) {
    const length = lengths[s];
    if (length === 0) continue;
    const code = next[length]++;
    let reversed = 0;
    for (let b = 0; b < length; b++) reversed |= ((code >> b) & 1) << (length - 1 - b);
    for (let index = reversed; index < size; index += 1 << length) entries[index] = (s << 4) | length;
  }
  return { entries, bits: longest };
}

let fixedTables: [Huffman, Huffman] | undefined;
function fixedHuffman(): [Huffman, Huffman] {
  if (!fixedTables) {
    const literal = new Uint8Array(288).map((_, s) => (s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8));
    fixedTables = [huffman(literal, 288)!, huffman(new Uint8Array(30).fill(5), 30)!];
  }
  return fixedTables;
}

class Invalid extends Error {}

/**
 * How many bytes zlib data inflates to, counted without keeping them (a match adds its length; nothing
 * is copied), or -1 when it is not whole, valid zlib data (header, blocks to the final one, and room
 * for the checksum). Counting stops past `limit`, with a count above it. It takes 1.1 to 2.3 times as
 * long as Node's own zlib inflate on 150 and 200 dpi page renders (fix round 1, measured), where
 * pdf-lib's decoder and DecompressionStream took several times longer.
 */
export function inflatedSize(data: Uint8Array, limit: number): number {
  if (data.length < 6) return -1;
  const cmf = data[0];
  const flg = data[1];
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) return -1;
  let pos = 2;
  let buffer = 0;
  let held = 0;
  const fill = (n: number) => {
    while (held < n) {
      if (pos >= data.length + 4) throw new Invalid();
      buffer |= (pos < data.length ? data[pos] : 0) << held;
      pos += 1;
      held += 8;
    }
  };
  const bits = (n: number): number => {
    if (n === 0) return 0;
    fill(n);
    const value = buffer & ((1 << n) - 1);
    buffer >>>= n;
    held -= n;
    return value;
  };
  const decode = (table: Huffman): number => {
    if (table.bits === 0) throw new Invalid();
    fill(table.bits);
    const entry = table.entries[buffer & ((1 << table.bits) - 1)];
    if (entry === 0) throw new Invalid();
    const length = entry & 15;
    buffer >>>= length;
    held -= length;
    return entry >> 4;
  };
  let total = 0;
  try {
    let last = 0;
    do {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        // A stored block starts at the next byte: give back the whole bytes read ahead.
        pos -= held >> 3;
        buffer = 0;
        held = 0;
        if (pos + 4 > data.length) return -1;
        const length = data[pos] | (data[pos + 1] << 8);
        if ((length ^ 0xffff) !== (data[pos + 2] | (data[pos + 3] << 8))) return -1;
        pos += 4 + length;
        if (pos > data.length) return -1;
        total += length;
      } else if (type === 1 || type === 2) {
        let literal: Huffman | null;
        let distance: Huffman | null;
        if (type === 1) [literal, distance] = fixedHuffman();
        else {
          const literals = bits(5) + 257;
          const distances = bits(5) + 1;
          const codes = bits(4) + 4;
          if (literals > 286 || distances > 30) return -1;
          const codeLengths = new Uint8Array(19);
          for (let k = 0; k < codes; k++) codeLengths[CODE_LENGTH_ORDER[k]] = bits(3);
          const lengthTable = huffman(codeLengths, 19);
          if (!lengthTable) return -1;
          const lengths = new Uint8Array(literals + distances);
          for (let k = 0; k < lengths.length; ) {
            const symbol = decode(lengthTable);
            if (symbol < 16) lengths[k++] = symbol;
            else {
              const repeat = symbol === 16 ? 3 + bits(2) : symbol === 17 ? 3 + bits(3) : 11 + bits(7);
              if (symbol === 16 && k === 0) return -1;
              const value = symbol === 16 ? lengths[k - 1] : 0;
              if (k + repeat > lengths.length) return -1;
              lengths.fill(value, k, k + repeat);
              k += repeat;
            }
          }
          if (lengths[256] === 0) return -1;
          literal = huffman(lengths.subarray(0, literals), literals);
          distance = huffman(lengths.subarray(literals), distances);
        }
        if (!literal || !distance) return -1;
        for (;;) {
          const symbol = decode(literal);
          if (symbol < 256) total += 1;
          else if (symbol === 256) break;
          else {
            const index = symbol - 257;
            if (index >= 29) return -1;
            const length = LENGTH_BASE[index] + bits(LENGTH_EXTRA[index]);
            const code = decode(distance);
            if (code >= 30) return -1;
            if (DISTANCE_BASE[code] + bits(DISTANCE_EXTRA[code]) > total) return -1;
            total += length;
          }
          if (total > limit) return total;
        }
      } else return -1;
      if (total > limit) return total;
    } while (!last);
    // The deflate data must end inside the bytes given, with the four-byte checksum after it.
    return pos - (held >> 3) + 4 <= data.length ? total : -1;
  } catch (error) {
    if (error instanceof Invalid) return -1;
    throw error;
  }
}

/**
 * A fingerprint of a picture's bytes (two 32-bit hashes in one number): what makes a picture counted in
 * an earlier build (an earlier round of the same run) the same picture now. A tenth of a millisecond
 * for a 200 dpi page, against tens for counting it again.
 */
function fingerprint(bytes: Uint8Array): number {
  let a = 0x811c9dc5;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193);
    b = (Math.imul(b, 31) + bytes[i]) | 0;
  }
  return (a >>> 0) * 0x200000 + ((b >>> 0) & 0x1fffff);
}

/**
 * Flate pictures already counted whole and of their stated size, by their bytes (held weakly: an entry
 * goes with the run's own picture), with what was counted: their length, fingerprint and the size
 * stated then. A later build of the same run (rounds 2 and 3 rebuild the pages of round 1 with the same
 * pictures) skips the count only when all three still match (fix wave, R2 open item: the count was most
 * of the build's own time). Holds numbers only.
 */
const countedPictures = new WeakMap<Uint8Array, { length: number; fingerprint: number; expected: number }>();

/**
 * Throws RangeError unless a Flate picture inflates to exactly widthPx x heightPx x components bytes
 * (inflatedSize). Run just before the picture's page is put together, between two progress calls.
 */
function checkFlatePicture(page: RebuiltPage): void {
  const picture = page.picture;
  if (picture.encoding !== 'flate-gray' && picture.encoding !== 'flate-rgb') return;
  const expected = picture.widthPx * picture.heightPx * (picture.encoding === 'flate-rgb' ? 3 : 1);
  const print = fingerprint(picture.bytes);
  const known = countedPictures.get(picture.bytes);
  if (known && known.length === picture.bytes.length && known.fingerprint === print && known.expected === expected) return;
  if (inflatedSize(picture.bytes, expected) !== expected) throw new RangeError(`Page ${page.pageIndex + 1}'s picture is not whole Flate data of the stated size.`);
  countedPictures.set(picture.bytes, { length: picture.bytes.length, fingerprint: print, expected });
}

/**
 * Checks what can be checked without the source: indices, reasons and boxes, picture sizes and
 * encodings, JPEGs whole and of the stated size, word numbers. Throws RangeError. Flate pictures are
 * counted later, one before each page is put together (checkFlatePicture), so the build reports progress
 * and can be stopped between them (fix wave, R2 open item: counting 200 pictures first held the window
 * for 4.2 s).
 */
function checkInput(pages: readonly RebuiltPage[]): void {
  const seen = new Set<number>();
  for (const page of pages) {
    const n = page?.pageIndex;
    if (!Number.isInteger(n) || n < 0) throw new RangeError('A page to rebuild has no valid page number.');
    if (seen.has(n)) throw new RangeError(`Page ${n + 1} is given twice.`);
    seen.add(n);
    if (page.reason !== 'boxes' && page.reason !== 'flattened' && page.reason !== 'safety') throw new RangeError(`Page ${n + 1} has no reason to be rebuilt.`);
    if (!Array.isArray(page.boxes)) throw new RangeError(`Page ${n + 1} has no list of boxes.`);
    if (page.reason === 'boxes' && page.boxes.length === 0) throw new RangeError(`Page ${n + 1} is rebuilt for its boxes but has none.`);
    if (page.reason === 'flattened' && page.boxes.length > 0) throw new RangeError(`Page ${n + 1} is flattened but has boxes.`);
    for (const box of page.boxes) {
      if (![box?.x0, box?.y0, box?.x1, box?.y1].every((v) => Number.isFinite(v))) throw new RangeError(`Page ${n + 1} has a box that cannot be placed.`);
    }
    const picture = page.picture;
    if (!picture || !(picture.bytes instanceof Uint8Array) || picture.bytes.length === 0) throw new RangeError(`Page ${n + 1} has no picture.`);
    if (!Number.isInteger(picture.widthPx) || !Number.isInteger(picture.heightPx) || picture.widthPx < 1 || picture.heightPx < 1) {
      throw new RangeError(`Page ${n + 1}'s picture has no valid size.`);
    }
    if (picture.encoding === 'jpeg') {
      const frame = jpegFrame(picture.bytes);
      if (!frame || frame.width !== picture.widthPx || frame.height !== picture.heightPx || (frame.components !== 1 && frame.components !== 3)) {
        throw new RangeError(`Page ${n + 1}'s picture is not a whole grey or colour JPEG of the stated size.`);
      }
    } else if (picture.encoding === 'flate-gray' || picture.encoding === 'flate-rgb') {
      // Counted just before the page is put together (checkFlatePicture).
    } else {
      throw new RangeError(`Page ${n + 1}'s picture has an unknown encoding.`);
    }
    for (const word of page.words ?? []) {
      const finite = Array.isArray(word?.transform) && word.transform.length === 6 && word.transform.every((v) => Number.isFinite(v));
      if (typeof word?.text !== 'string' || !finite || !Number.isFinite(word.width) || word.width < 0) {
        throw new RangeError(`Page ${n + 1} has a word that cannot be placed.`);
      }
    }
  }
}

async function loadSource(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK });
  } catch {
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
  }
  if (doc.isEncrypted) throw new PdfToolsError('encrypted', 'This file is password-protected. Unlock it first.');
  return doc;
}

// ---- the rebuilt page ------------------------------------------------------------------------------

/** What a reader shows of the page: the crop box clipped to the media box, or the media box when they do not overlap (as pageNumbers.ts and pdf.js). */
function visibleBox(page: PDFPage): [number, number, number, number] {
  const normal = (b: { x: number; y: number; width: number; height: number }) => ({
    x0: Math.min(b.x, b.x + b.width),
    y0: Math.min(b.y, b.y + b.height),
    x1: Math.max(b.x, b.x + b.width),
    y1: Math.max(b.y, b.y + b.height),
  });
  let media = { x0: 0, y0: 0, x1: 612, y1: 792 };
  try {
    const box = normal(page.getMediaBox());
    if ([box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) && box.x1 > box.x0 && box.y1 > box.y0) media = box;
  } catch {
    // no readable media box: pdf.js uses US Letter too
  }
  let crop = media;
  try {
    const box = normal(page.getCropBox());
    if ([box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) crop = box;
  } catch {
    // no readable crop box: the media box
  }
  const x0 = Math.max(media.x0, crop.x0);
  const y0 = Math.max(media.y0, crop.y0);
  const x1 = Math.min(media.x1, crop.x1);
  const y1 = Math.min(media.y1, crop.y1);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [media.x0, media.y0, media.x1, media.y1];
}

/** The page's turn as readers apply it: a multiple of 90, else none. */
function turnOf(page: PDFPage): 0 | 90 | 180 | 270 {
  let angle = 0;
  try {
    angle = page.getRotation().angle;
  } catch {
    return 0;
  }
  if (!Number.isInteger(angle) || angle % 90 !== 0) return 0;
  return ((((angle / 90) % 4) + 4) % 4) * 90 as 0 | 90 | 180 | 270;
}

/** A number for a content stream: at most four decimals, never an exponent, never -0. */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10_000) / 10_000;
  if (rounded === 0) return '0';
  return rounded.toFixed(4).replace(/\.?0+$/, '');
}

interface TextFont {
  embedder: StandardFontEmbedder;
  writable: Set<number>;
  widths: Map<string, number>;
}

function textFont(): TextFont {
  // pdf-lib types the standard font names separately from its StandardFonts enum; the value is the same.
  const embedder = StandardFontEmbedder.for(StandardFonts.Helvetica as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
  return { embedder, writable: new Set(embedder.encoding.supportedCodePoints), widths: new Map() };
}

/** A word's box in user space: along its advance, 0.25 em below its baseline to 0.9 em above it (as pageText.ts boxes text), padded. */
function wordBox(origin: [number, number], along: [number, number], up: [number, number], width: number, pad: number): Rect {
  const corners = [
    [0, -0.25],
    [width, -0.25],
    [0, 0.9],
    [width, 0.9],
  ].map(([s, t]) => [origin[0] + along[0] * s + up[0] * t, origin[1] + along[1] * s + up[1] * t]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}
const meets = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Invisible Helvetica text for the words: each placed at its origin along its direction, scaled to
 * its width. A word whose box (padded by BOX_PAD_PT) meets one of the page's boxes, or that lies
 * wholly outside the visible page, is not written (`leftOut`): the run leaves such words out already,
 * and this is the second guard of "nothing under a box is kept".
 */
function textLayer(words: readonly LayerWord[], font: TextFont, view: Rect, boxes: readonly Rect[]): { lines: string[]; omitted: number; leftOut: number } {
  const lines: string[] = [];
  let omitted = 0;
  let leftOut = 0;
  const widthOf = (ch: string) => {
    let width = font.widths.get(ch);
    if (width === undefined) {
      width = font.embedder.widthOfTextAtSize(ch, 1);
      font.widths.set(ch, width);
    }
    return width;
  };
  for (const word of words) {
    const kept: string[] = [];
    for (const ch of Array.from(word.text)) {
      if (ch !== ' ' && /\s/.test(ch)) continue; // a line break or tab is not a character of the word
      if (font.writable.has(ch.codePointAt(0)!)) kept.push(ch);
      else omitted += 1;
    }
    if (kept.length === 0) continue;
    let [a, b, c, d] = word.transform;
    const [, , , , e, f] = word.transform;
    let along = Math.hypot(a, b);
    let up = Math.hypot(c, d);
    if (!(along > 0) && !(up > 0)) {
      omitted += kept.length; // no size and no direction: it cannot be placed
      continue;
    }
    if (!(up > 0)) {
      up = along;
      [c, d] = [-b, a];
    }
    if (!(along > 0)) {
      along = up;
      [a, b] = [d, -c];
    }
    const ux = a / along;
    const uy = b / along;
    const upward: [number, number] = [c / up, d / up];
    const width = Math.max(0, word.width);
    const scaledUp: [number, number] = [upward[0] * up, upward[1] * up];
    const padded = wordBox([e, f], [ux, uy], scaledUp, width, BOX_PAD_PT);
    if (boxes.some((box) => meets(padded, box)) || !overlaps(wordBox([e, f], [ux, uy], scaledUp, width, 0), view)) {
      leftOut += 1;
      continue;
    }
    const text = kept.join('');
    const natural = kept.reduce((sum, ch) => sum + widthOf(ch), 0);
    const scale = natural > 0 && word.width > 0 ? (100 * word.width) / (natural * up) : 100;
    const encoded = font.embedder.encodeText(text).toString();
    lines.push(`${num(scale)} Tz ${num(ux * up)} ${num(uy * up)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} Tm ${encoded} Tj`);
  }
  return { lines, omitted, leftOut };
}

interface PagePlan {
  page: RebuiltPage;
  box: [number, number, number, number];
  turn: 0 | 90 | 180 | 270;
  userUnit?: number;
}

/** Makes the copied page `node` the rebuilt page: its picture filling the visible box, then its text layer. */
function assemble(context: PDFContext, node: PDFPageLeaf, plan: PagePlan, font: TextFont, fontRef: () => PDFRef): { omitted: number; leftOut: number } {
  for (const key of node.keys()) if (key !== TYPE && key !== PARENT) node.delete(key);
  const [x0, y0, x1, y1] = plan.box;
  node.set(MEDIA_BOX, context.obj(plan.box));
  if (plan.turn !== 0) node.set(ROTATE, PDFNumber.of(plan.turn));
  if (plan.userUnit !== undefined) node.set(USER_UNIT, PDFNumber.of(plan.userUnit));
  const { picture, words } = plan.page;
  const colour = picture.encoding === 'flate-rgb' || (picture.encoding === 'jpeg' && jpegFrame(picture.bytes)?.components === 3);
  const image = context.register(
    context.stream(picture.bytes, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: picture.widthPx,
      Height: picture.heightPx,
      ColorSpace: colour ? 'DeviceRGB' : 'DeviceGray',
      BitsPerComponent: 8,
      Filter: picture.encoding === 'jpeg' ? 'DCTDecode' : 'FlateDecode',
    }),
  );
  const layer = textLayer(words, font, { x0, y0, x1, y1 }, plan.page.boxes ?? []);
  let content = `q ${num(x1 - x0)} 0 0 ${num(y1 - y0)} ${num(x0)} ${num(y0)} cm /Im0 Do Q`;
  if (layer.lines.length > 0) content += `\nBT\n3 Tr\n/Fh 1 Tf\n${layer.lines.join('\n')}\nET`;
  node.set(CONTENTS, context.register(context.flateStream(content)));
  const resources = context.obj({ XObject: { Im0: image } });
  if (layer.lines.length > 0) resources.set(name('Font'), context.obj({ Fh: fontRef() }));
  node.set(RESOURCES, resources);
  return { omitted: layer.omitted, leftOut: layer.leftOut };
}

// ---- what the copied pages carry -------------------------------------------------------------------

/** Every dictionary in the document, direct ones inside indirect objects included, and every stream's dictionary. */
function eachDict(context: PDFContext, visit: (dict: PDFDict) => void): void {
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
      } else if (item instanceof PDFArray) {
        stack.push(...item.asArray());
      }
    }
  }
}

function ownerKind(context: PDFContext, dict: PDFDict): 'page' | 'field' | 'annotation' | 'object' {
  if (dict instanceof PDFPageLeaf || nameText(context, dict.get(TYPE)) === 'Page') return 'page';
  if (dict.has(FIELD_TYPE) || look(context, dict.get(SUBTYPE)) === WIDGET) return 'field';
  if (dict.has(RECT) && dict.has(SUBTYPE)) return 'annotation';
  return 'object';
}

/** Named destinations of the source (/Dests and the /Names tree), looked up by name or string; bounded. */
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
      if (seen.has(node) || depth > NAME_TREE_MAX_DEPTH) continue;
      seen.add(node);
      const pairs = arrayOf(this.context, node.get(NAMES));
      for (let i = 0; pairs && i + 1 < pairs.size() && map.size < NAME_TREE_MAX_ENTRIES; i += 2) {
        const key = look(this.context, pairs.get(i));
        if (key instanceof PDFString || key instanceof PDFHexString) map.set(bytesText(key.asBytes()), pairs.get(i + 1));
      }
      const kids = arrayOf(this.context, node.get(KIDS));
      for (let i = (kids?.size() ?? 0) - 1; i >= 0; i--) {
        const kid = dictOf(this.context, kids!.get(i));
        if (kid) stack.push([kid, depth + 1]);
      }
    }
    return map;
  }

  find(key: PDFObject): PDFObject | undefined {
    const old = (text: string) => dictOf(this.context, this.catalog.get(DESTS))?.get(PDFName.of(text));
    if (key instanceof PDFName) return old(key.decodeText()) ?? (this.tree ??= this.buildTree()).get(key.decodeText());
    if (key instanceof PDFString || key instanceof PDFHexString) {
      const text = bytesText(key.asBytes());
      return (this.tree ??= this.buildTree()).get(text) ?? old(text);
    }
    return undefined;
  }
}

const bytesText = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

interface Cleaning {
  out: PDFDocument;
  carried: Set<number>;
  named: NamedDestinations;
  sourceContext: PDFContext;
  /** Source page reference to result page reference (the same index). */
  pageMap: Map<PDFRef, PDFRef>;
  /** The build's `titleHasValue`, for web addresses. */
  holdsValue: (text: string) => boolean;
  count: (what: string) => void;
}

/** A named destination made direct in the result, or null when it goes to no page of the file. */
function directDestination(clean: Cleaning, key: PDFObject): PDFArray | null {
  const found = clean.named.find(key);
  let dest = look(clean.sourceContext, found);
  if (dest instanceof PDFDict) dest = look(clean.sourceContext, dest.get(ACTION_DEST));
  if (!(dest instanceof PDFArray) || dest.size() === 0) return null;
  const first = dest.get(0);
  const page = first instanceof PDFRef ? clean.pageMap.get(first) : undefined;
  if (!page) return null;
  const view = dest.asArray().slice(1).map((value) => {
    const v = look(clean.sourceContext, value);
    return v instanceof PDFName || v instanceof PDFNumber ? v : PDFNull;
  });
  return clean.out.context.obj([page, ...view]);
}

const isNamed = (value: PDFObject | undefined) => value instanceof PDFName || value instanceof PDFString || value instanceof PDFHexString;

/** A string's text as a reader takes it (UTF-16 with its mark, else PDFDocEncoding); '' when it cannot be read. */
function stringText(value: PDFObject | undefined): string {
  if (!(value instanceof PDFString) && !(value instanceof PDFHexString)) return '';
  try {
    return value.decodeText();
  } catch {
    return '';
  }
}

/** A web or mail address a result may keep: http, https or mailto, or no scheme at all (a relative address). */
export function safeAddress(uri: string): boolean {
  const scheme = /^\s*([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)?.[1].toLowerCase();
  return scheme === undefined || scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

/** The entries that may hold an action: a link's or widget's /A, a link's previous action /PA, an open action. */
const ACTION_SLOTS = ['A', 'PA', 'OpenAction'].map(name);

/**
 * Everything the copied pages carry: /AA, /PieceInfo, /Metadata, /Thumb and /AF removed; a kept
 * annotation's attached file (/FS) and any embedded or related file of a file specification (/EF,
 * /RF) removed; actions in every slot other than GoTo and URI removed, and anything chained after the
 * kept ones; web addresses that are not http, https or mailto (a `javascript:` or `data:` address)
 * removed, and so are those holding a redacted value (`holdsValue`, also when percent-encoded);
 * named destinations made direct (the result has no name tree), or removed when they go nowhere.
 */
function cleanEntries(clean: Cleaning): void {
  const context = clean.out.context;
  eachDict(context, (dict) => {
    for (const key of UNCHECKABLE_KEYS) {
      if (dict.has(name(key))) {
        clean.count(`${ownerKind(context, dict)} /${key}`);
        dict.delete(name(key));
      }
    }
    if (dict.has(name('FS')) && dict.has(SUBTYPE)) {
      clean.count(`${ownerKind(context, dict)} /FS`);
      dict.delete(name('FS'));
    }
    for (const key of ['EF', 'RF']) {
      if (dict.has(name(key))) {
        clean.count(`file specification /${key}`);
        dict.delete(name(key));
      }
    }
  });
  eachDict(context, (dict) => {
    for (const slot of ACTION_SLOTS) {
      const action = dictOf(context, dict.get(slot));
      const type = action ? nameText(context, action.get(ACTION_TYPE)) : undefined;
      if (!action || type === undefined) continue;
      if (type !== 'GoTo' && type !== 'URI') {
        dict.delete(slot);
        clean.count(`action ${KNOWN_ACTIONS.has(type) ? type : 'other'}`);
        continue;
      }
      if (action.has(NEXT)) {
        action.delete(NEXT);
        clean.count('action /Next');
      }
      if (type === 'URI') {
        const uri = stringText(look(context, action.get(name('URI'))));
        if (!safeAddress(uri)) {
          dict.delete(slot);
          clean.count('link address not http, https or mailto');
        } else if (clean.holdsValue(uri)) {
          dict.delete(slot);
          clean.count('link address holding a value');
        }
        continue;
      }
      const target = look(context, action.get(ACTION_DEST));
      if (isNamed(target)) {
        const direct = directDestination(clean, target!);
        if (direct) {
          action.set(ACTION_DEST, direct);
          clean.count('named destination made direct');
        } else {
          dict.delete(slot);
          clean.count('named destination not found');
        }
      }
    }
    const dest = look(context, dict.get(DEST));
    if (isNamed(dest)) {
      const direct = directDestination(clean, dest!);
      if (direct) {
        dict.set(DEST, direct);
        clean.count('named destination made direct');
      } else {
        dict.delete(DEST);
        clean.count('named destination not found');
      }
    }
  });
}

/** Copied pages lose attachments, media, 3D and /Redact marks, links left with nowhere to go, and the popups of what was removed. */
function cleanAnnotations(clean: Cleaning): void {
  const context = clean.out.context;
  const pages = clean.out.getPages();
  const removed = new Set<PDFObject>();
  const lists: [PDFPageLeaf, number, PDFObject[]][] = [];
  for (const index of clean.carried) {
    const node = pages[index].node;
    const entries = arrayOf(context, node.get(ANNOTS))?.asArray();
    if (!entries) continue;
    const kept: PDFObject[] = [];
    for (const entry of entries) {
      const annotation = dictOf(context, entry);
      if (!annotation) continue;
      const subtype = nameText(context, annotation.get(SUBTYPE)) ?? '';
      if (DROPPED_ANNOTATIONS.has(subtype)) {
        clean.count(`annotation ${subtype}`);
        removed.add(entry).add(annotation);
      } else if (look(context, annotation.get(SUBTYPE)) === LINK && !annotation.has(ACTION) && !annotation.has(DEST)) {
        clean.count('link without destination');
        removed.add(entry).add(annotation);
      } else kept.push(entry);
    }
    lists.push([node, entries.length, kept]);
  }
  // pdf-lib's PDFDict.get answers undefined for a null value, so the entry is read as stored: the page
  // copy writes null where an annotation of a rebuilt page was referred to.
  const stored = (dict: PDFDict, key: PDFName) => dict.entries().find(([k]) => k === key)?.[1];
  const gone = (value: PDFObject | undefined) => value === PDFNull || (value !== undefined && (removed.has(value) || removed.has(look(context, value) as PDFObject)));
  for (const [node, before, kept] of lists) {
    const still = kept.filter((entry) => {
      const annotation = dictOf(context, entry)!;
      if (look(context, annotation.get(SUBTYPE)) === POPUP && gone(stored(annotation, PARENT))) {
        clean.count('annotation Popup');
        removed.add(entry).add(annotation);
        return false;
      }
      if (gone(stored(annotation, IN_REPLY_TO))) {
        annotation.delete(IN_REPLY_TO);
        annotation.delete(REPLY_TYPE);
      }
      if (gone(stored(annotation, POPUP))) annotation.delete(POPUP);
      return true;
    });
    if (still.length !== before) node.set(ANNOTS, context.obj(still));
  }
  for (const entry of removed) if (entry instanceof PDFRef) context.delete(entry);
}

/** The layers carried keep their settings, not the configurations' names or the layer panel's labels (descriptive text no check reads with certainty). */
function cleanLayers(clean: Cleaning): void {
  const context = clean.out.context;
  const properties = dictOf(context, clean.out.catalog.get(OC_PROPERTIES));
  if (!properties) return;
  const configs = [dictOf(context, properties.get(name('D'))), ...(arrayOf(context, properties.get(name('Configs')))?.asArray() ?? []).map((c) => dictOf(context, c))];
  const labelsOut = (list: PDFArray, depth: number): PDFArray => {
    const kept: PDFObject[] = [];
    for (const entry of list.asArray()) {
      const value = look(context, entry);
      if (value instanceof PDFString || value instanceof PDFHexString) clean.count('layer settings text');
      else if (value instanceof PDFArray && depth < NAME_TREE_MAX_DEPTH) kept.push(labelsOut(value, depth + 1));
      else kept.push(entry);
    }
    return context.obj(kept);
  };
  for (const config of configs) {
    if (!config) continue;
    for (const key of ['Name', 'Creator']) {
      if (config.has(name(key))) {
        config.delete(name(key));
        clean.count('layer settings text');
      }
    }
    const order = arrayOf(context, config.get(ORDER));
    if (order) config.set(ORDER, labelsOut(order, 0));
  }
}

/** The references reachable from the trailer's /Root and /Info. */
function reachableRefs(doc: PDFDocument): Set<PDFRef> {
  const { context } = doc;
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = [context.trailerInfo.Root, context.trailerInfo.Info].filter((x): x is PDFObject => x !== undefined);
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item instanceof PDFRef) {
      if (seen.has(item)) continue;
      seen.add(item);
      const value = context.lookup(item);
      if (value !== undefined) stack.push(value);
    } else if (item instanceof PDFDict) stack.push(...item.values());
    else if (item instanceof PDFArray) stack.push(...item.asArray());
    else if (item instanceof PDFStream) stack.push(...item.dict.values());
  }
  return seen;
}

/** Removes every object nothing refers to, then every reference to an object that is not there. */
function tidy(doc: PDFDocument): void {
  const { context } = doc;
  const reachable = reachableRefs(doc);
  for (const [ref] of context.enumerateIndirectObjects()) if (!reachable.has(ref)) context.delete(ref);
  const dangling = (value: PDFObject) => value instanceof PDFRef && context.lookup(value) === undefined;
  const fixArray = (array: PDFArray, list: boolean) => {
    for (let i = array.size() - 1; i >= 0; i--) {
      if (!dangling(array.get(i))) continue;
      if (list) array.remove(i);
      else array.set(i, PDFNull);
    }
  };
  eachDict(context, (dict) => {
    for (const [key, value] of dict.entries()) {
      if (dangling(value)) dict.delete(key);
      else if (value instanceof PDFArray) fixArray(value, LIST_KEYS.has(key.decodeText()));
    }
  });
  for (const [, object] of context.enumerateIndirectObjects()) if (object instanceof PDFArray) fixArray(object, false);
}

// ---- bookmarks -------------------------------------------------------------------------------------

/** The source's bookmarks as the result keeps them: those holding a value removed (children moved up), then carried by 5.10. */
function carriedBookmarks(source: PDFDocument, options: RedactBuildOptions): { items: OutlineItem[]; removed: number; dropped: number } {
  const read = readOutline(source);
  if (read.count === 0) return { items: [], removed: 0, dropped: 0 };
  if (outlineOverLimits(read.problems)) return { items: [], removed: 0, dropped: read.count };
  const holdsValue = (item: OutlineItem) => options.titleHasValue(item.title) || (item.uri !== undefined && options.titleHasValue(item.uri));
  const mapped = mapOutline(read.items, (item) => !holdsValue(item));
  // A web address that is not http, https or mailto (a script, a data address) is not carried (fix round 1, medium 7).
  const safe = mapOutline(mapped.items, (item) => item.uri === undefined || safeAddress(item.uri));
  const pageCount = source.getPageCount();
  const carried = carryOutline(safe.items, (index) => (index >= 0 && index < pageCount ? index : undefined));
  return { items: carried.items, removed: mapped.removed, dropped: carried.dropped + safe.removed };
}

// ---- the build -------------------------------------------------------------------------------------

/**
 * The redacted file: `pages` rebuilt as pictures with their text layers, every other page copied and
 * cleaned, bookmarks carried without those holding a value, nothing else of the source. The source
 * bytes are not changed.
 */
export async function buildRedacted(source: Uint8Array, pages: readonly RebuiltPage[], options: RedactBuildOptions): Promise<{ bytes: Uint8Array; report: RedactBuildReport }> {
  checkInput(pages);
  const doc = await loadSource(source);
  const sourcePages = doc.getPages();
  const pageCount = sourcePages.length;
  for (const page of pages) if (page.pageIndex >= pageCount) throw new RangeError(`Page ${page.pageIndex + 1} is outside this file's ${pageCount} pages.`);
  const rebuilt = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const rebuiltIndices = new Set(rebuilt.map((page) => page.pageIndex));
  const total = pageCount + rebuilt.length;
  const step = async (done: number) => {
    if (options.onPage) await options.onPage(done, total);
  };

  const bookmarks = carriedBookmarks(doc, options);
  const plans: PagePlan[] = rebuilt.map((page) => {
    const sourcePage = sourcePages[page.pageIndex];
    const unit = look(doc.context, sourcePage.node.get(USER_UNIT));
    return { page, box: visibleBox(sourcePage), turn: turnOf(sourcePage), userUnit: unit instanceof PDFNumber && unit.asNumber() > 0 ? unit.asNumber() : undefined };
  });

  // Empty the pages to rebuild in the in-memory source: their annotations are deleted outright, so
  // every reference to one (a reply, a field, a popup on another page) comes out of the copy as null.
  for (const index of rebuiltIndices) {
    const node = sourcePages[index].node;
    for (const entry of arrayOf(doc.context, node.get(ANNOTS))?.asArray() ?? []) if (entry instanceof PDFRef) doc.context.delete(entry);
    for (const key of node.keys()) if (!BLANKED_PAGE_KEYS.has(key.decodeText())) node.delete(key);
  }

  const out = await PDFDocument.create({ updateMetadata: false });
  const now = new Date();
  out.setProducer(APP_NAME);
  out.setCreator(APP_NAME);
  out.setCreationDate(now);
  out.setModificationDate(now);
  const copyReport: OrganiseReport = {};
  await copyPagesOf(out, doc, doc.getPageIndices(), copyReport, { onPage: (done) => step(done) });

  const outPages = out.getPages();
  const font = textFont();
  let fontRef: PDFRef | undefined;
  const textFontRef = () => (fontRef ??= out.context.register(out.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' })));
  let textLayerCharsOmitted = 0;
  let wordsLeftOut = 0;
  for (const [k, plan] of plans.entries()) {
    await step(pageCount + k);
    checkFlatePicture(plan.page);
    const layer = assemble(out.context, outPages[plan.page.pageIndex].node, plan, font, textFontRef);
    textLayerCharsOmitted += layer.omitted;
    wordsLeftOut += layer.leftOut;
  }

  const cleaned: Record<string, number> = {};
  const clean: Cleaning = {
    out,
    carried: new Set(outPages.map((_, i) => i).filter((i) => !rebuiltIndices.has(i))),
    named: new NamedDestinations(doc.context, doc.catalog),
    sourceContext: doc.context,
    pageMap: new Map(sourcePages.map((page, i) => [page.ref, outPages[i].ref])),
    holdsValue: options.titleHasValue,
    count: (what) => {
      cleaned[what] = (cleaned[what] ?? 0) + 1;
    },
  };
  // Annotations dropped whole go first, and what only they held is pruned, so their attached files are
  // not also counted as entries; links left with nowhere to go once their actions are cleaned go after.
  cleanAnnotations(clean);
  tidy(out);
  cleanEntries(clean);
  cleanAnnotations(clean);
  cleanLayers(clean);
  if (bookmarks.items.length > 0) writeOutline(out, bookmarks.items);
  tidy(out);
  await step(total);
  const bytes = await out.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: PARSE_OBJECTS_PER_TICK });
  return {
    bytes,
    report: {
      textLayerCharsOmitted,
      wordsLeftOut,
      cleaned,
      bookmarksRemoved: bookmarks.removed,
      bookmarksDropped: bookmarks.dropped,
      sharedResourcesKept: copyReport.sharedResourcesKept === true,
      pagesFlattened: rebuilt.filter((page) => page.reason === 'flattened').map((page) => page.pageIndex),
    },
  };
}
