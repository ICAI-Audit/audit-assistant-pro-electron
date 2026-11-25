// TIFF pictures for PDF Tools (scanners, bank and government portals give single- and multi-page TIFF).
// Pure TypeScript with pdf-lib, no DOM: reads classic TIFF in both byte orders, every page of the IFD
// chain, and turns a page into exact pixels (bilevel, grey, RGB, palette; strips and tiles; none,
// PackBits, LZW and Deflate with or without the horizontal predictor, CCITT Group 3 and Group 4) or,
// for JPEG compression, into the page's own JPEG made whole. Pixels are written out as PNG (one
// upright page with square pixels, kept as an image) or into a PDF whose pages are sized from the
// scan's resolution (every other file). Everything else is refused, page by page, with one plain
// sentence; nothing else is thrown on any input.
//
// Limits against hostile files: at most TIFF_LIMITS.maxPages pages and twice as many directories, a
// directory visited twice or overlapping another ends the file as damaged, the directories together
// hold at most TIFF_LIMITS.maxEntries entries (only the tags the reader uses are kept), every offset
// and count is checked against the file's length before it is read, the strips or tiles of the whole
// file are at most TIFF_LIMITS.maxFileChunks and the bytes they claim together cannot be more than the
// file holds (so no page or file can make the decoders read the same data twice), each page is held
// to the image limits of the rest of PDF Tools (20,000 pixels a side, 50 megapixels), and the pictures
// of one file together to 1 GB once opened (a tile decoded whole counts whole), all decided from the
// tags before anything is decoded. Strip and tile positions are read from the file when needed, never
// copied into lists. Decoding runs in slices with a pause between them, so the screen stays alive and
// a stopped run ends; a decoder never writes past its page.
//
// Why CCITT is decoded rather than copied into the PDF with /CCITTFaxDecode: a one-page TIFF has to be
// a picture (PNG) for Images to PDF anyway; decoding is the only way to know that a stream is whole
// before the user sees its page (a damaged one is refused, never shown half-drawn); and with the
// pixels in hand one encoding serves every compression, so there is one path to prove exact instead
// of one per reader's CCITT filter settings. Decoded bilevel pages stay 1-bit (Flate with PNG row
// filters), which every reader shows and which Compress leaves as it is; the cost is size (the
// report gives the measured ratio to Group 4).
import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFRef } from 'pdf-lib';
import { CodecError, faxInto, inflateInto, lzwInto, packBitsInto, reverseBits, type FaxMode, type Work } from './tiffCodecs';
import { savePaced } from './pace';
import { PdfToolsError } from './types';

export const TIFF_LIMITS = {
  /** Pages in one file (directories of reduced copies and masks are skipped but count towards twice this). */
  maxPages: 1000,
  /** The image limits of the rest of PDF Tools (components/pdf-tools/imageHeader.ts). */
  maxSide: 20_000,
  maxPixels: 50_000_000,
  /** The pictures of one file together, once opened (JPEG pages, which are not opened, do not count). */
  maxDecodedBytes: 1024 * 1024 * 1024,
  /** Strips or tiles of one page. */
  maxChunks: 1_000_000,
  /** Strips or tiles of the whole file (a 1,000-page fax with a strip for every row has 3.3 million). */
  maxFileChunks: 4_000_000,
  /** Directory entries in the whole file (a page has a few dozen). */
  maxEntries: 500_000,
} as const;

/** The work between two pauses. */
const SLICE_MS = 25;
const PRODUCER = 'ICAI VERA';
/** Largest page side PDF readers accept (as imagesToPdf.ts). */
const MAX_PAGE_PT = 14_400;
/** The long side of A4, in inches: a page without a resolution is sized to fit it. */
const A4_LONG_INCHES = 841.89 / 72;
const DEFAULT_OUTPUT_LIMIT = 300 * 1024 * 1024;

export type TiffPageKind = 'bilevel' | 'grey' | 'rgb' | 'jpeg';

/** One page of a TIFF and how to read it. Built by readTiff; treat as read-only. */
export interface TiffPage {
  /** 1-based, in the file's order. */
  number: number;
  /** Pages in the file (for "Page 3 of this TIFF"). */
  pages: number;
  width: number;
  height: number;
  kind: TiffPageKind;
  /** Pixels per inch along each side as stored, or null when the file does not say. */
  xDpi: number | null;
  yDpi: number | null;
  /** TIFF Orientation 1-8. */
  orientation: number;
  compression: number;
  photometric: number;
  bitsPerSample: number;
  samplesPerPixel: number;
  extra: 'none' | 'associated' | 'unassociated' | 'ignored';
  planar: 1 | 2;
  predictor: boolean;
  reversed: boolean;
  fax2D: boolean;
  tiled: boolean;
  /** Strip: the page's width and RowsPerStrip; tile: TileWidth and TileLength. */
  chunkWidth: number;
  chunkHeight: number;
  /** Strips or tiles (all planes). */
  chunks: number;
  /** Where their offsets and byte counts are in the file. */
  table: ChunkTable;
  /** Palette: r, g, b of each index, 8 bits. */
  colorMap: Uint8Array | null;
  jpegTables: Uint8Array | null;
  /** Bytes held while the page is opened. */
  bufferBytes: number;
  /** Bytes the decoders write for the page: a tile is decoded whole, also where it hangs over the page's edge. */
  decodedBytes: number;
}

/**
 * Where a page's strip or tile offsets and byte counts are: read from the file when a chunk is decoded,
 * never copied into lists (a list of a million numbers a page was 15 MB of memory for each page).
 */
export interface ChunkTable {
  littleEndian: boolean;
  offsetsAt: number;
  offsetsType: number;
  /** -1 for an uncompressed page without byte counts: each chunk is then its rows' bytes. */
  countsAt: number;
  countsType: number;
  /** For the counts worked out: strips or tiles of one plane, the bytes of one row of one, its rows, the page's rows. */
  perPlane: number;
  rowBytes: number;
  tiled: boolean;
  chunkRows: number;
  pageRows: number;
}

export interface TiffFile {
  pages: TiffPage[];
  /** One upright page with square pixels: kept as an image (PNG, or its JPEG); otherwise a PDF is made. */
  asImage: boolean;
}

/** Decoded pixels. 'bilevel': packed rows, 1 = white (as PDF DeviceGray and PNG read 1-bit grey); 'grey': one byte a pixel; 'rgb': three. */
export interface TiffPixels {
  kind: 'bilevel' | 'grey' | 'rgb';
  width: number;
  height: number;
  rowBytes: number;
  data: Uint8Array;
}

export interface TiffWorkOptions {
  /** Called between slices of work and at each page; throws to stop. Default: a zero-delay timer. */
  pause?(progress: { page: number; pages: number }): Promise<void>;
  /** Called with each JPEG page before it is placed in a PDF; throws (PdfToolsError) when it does not decode. */
  checkJpeg?(jpeg: Uint8Array): Promise<void>;
  /** The largest PDF to make (default 300 MB, the list's limit). */
  maxOutputBytes?: number;
  /** Work between pauses, in ms (default 25). */
  sliceMs?: number;
}

// ---- refusals ----------------------------------------------------------------------------------------

/**
 * A TIFF refused: one plain sentence for the screen that says what to do, with no technical words (owner's
 * instruction). `detail` says why in the format's own terms, for tests and support; it is never shown.
 */
export class TiffRefusal extends PdfToolsError {
  constructor(message: string, readonly detail: string) {
    super('bad-image', message);
  }
}

const numbers = new Intl.NumberFormat('en-IN');
const SAVE_AGAIN = 'save it as PDF, JPG or PNG and add it again.';
const RESAVE = 'open it in the program that made it, save it again and add it again.';
const refuse = (message: string, detail: string) => new TiffRefusal(message, detail);
const label = (number: number, pages: number) => (pages > 1 ? `Page ${number} of this TIFF` : 'This TIFF');
const damagedFile = () => refuse(`This TIFF file is damaged or incomplete; ${RESAVE}`, 'damaged');
const damagedPage = (where: string) => refuse(`${where} is damaged or incomplete; ${RESAVE}`, 'damaged');
const unsupported = (where: string, what: string) => refuse(`${where} is saved in a form PDF Tools cannot read; ${SAVE_AGAIN}`, what);

const COMPRESSION_NAMES: Record<number, string> = {
  6: 'old-style JPEG compression',
  32771: 'an old word-aligned form of fax compression',
  32809: 'ThunderScan compression',
  32766: 'NeXT compression',
  33003: 'JPEG 2000 compression',
  33005: 'JPEG 2000 compression',
  34712: 'JPEG 2000 compression',
  34661: 'JBIG compression',
  34676: 'LogLuv compression',
  34677: 'LogLuv compression',
  34887: 'LERC compression',
  34925: 'LZMA compression',
  50000: 'Zstandard compression',
  50001: 'WebP compression',
  50002: 'JPEG XL compression',
};
const SUPPORTED_COMPRESSION = new Set([1, 2, 3, 4, 5, 7, 8, 32773, 32946]);

// ---- reading the directories -------------------------------------------------------------------------

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

interface Field {
  type: number;
  count: number;
  /** Where the values are, or -1 when they would run past the end of the file. */
  at: number;
}

class Reader {
  readonly length: number;
  constructor(readonly bytes: Uint8Array, readonly le: boolean) {
    this.length = bytes.length;
  }
  u16(at: number): number {
    const b = this.bytes;
    return this.le ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1];
  }
  u32(at: number): number {
    const b = this.bytes;
    return this.le
      ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000
      : ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) + b[at] * 0x1000000;
  }
}

/** The tags the reader uses; a directory's other entries are passed over, not kept. */
const USED_TAGS = new Set([254, 255, 256, 257, 258, 259, 262, 266, 273, 274, 277, 278, 279, 282, 283, 284, 292, 296, 317, 320, 322, 323, 324, 325, 338, 339, 347]);

/** What the directories of one file have used so far: their byte spans (sorted, never overlapping) and their entries. */
class Directories {
  entries = 0;
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];

  /** Takes [start, end) for a directory; false when it overlaps one already read (a loop is the same directory twice). */
  claim(start: number, end: number): boolean {
    let low = 0;
    let high = this.starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.starts[mid] < start) low = mid + 1;
      else high = mid;
    }
    if (low > 0 && this.ends[low - 1] > start) return false;
    if (low < this.starts.length && this.starts[low] < end) return false;
    this.starts.splice(low, 0, start);
    this.ends.splice(low, 0, end);
    return true;
  }
}

function readDirectory(r: Reader, offset: number, read: Directories): { fields: Map<number, Field>; next: number } {
  if (offset < 8 || offset + 2 > r.length) throw damagedFile();
  const n = r.u16(offset);
  const end = offset + 2 + n * 12;
  if (end + 4 > r.length) throw damagedFile();
  // Directories in an honest file never share bytes; overlapping ones could repeat 65,535 entries a
  // thousand times over in under a megabyte.
  if (!read.claim(offset, end + 4)) throw damagedFile();
  read.entries += n;
  if (read.entries > TIFF_LIMITS.maxEntries) throw damagedFile();
  const fields = new Map<number, Field>();
  for (let i = 0; i < n; i++) {
    const e = offset + 2 + i * 12;
    const tag = r.u16(e);
    if (!USED_TAGS.has(tag)) continue;
    const type = r.u16(e + 2);
    const count = r.u32(e + 4);
    const size = TYPE_SIZE[type];
    if (!size || fields.has(tag)) continue; // an unknown type is skipped, as libtiff does; the first of two tags counts
    const bytes = size * count;
    let at = bytes <= 4 ? e + 8 : r.u32(e + 8);
    if (at + bytes > r.length) at = -1;
    fields.set(tag, { type, count, at });
  }
  return { fields, next: r.u32(end) };
}

/** Whole numbers of a field (BYTE, SHORT, LONG), at most `max` of them; null when the field is absent. */
function ints(r: Reader, f: Field | undefined, max: number, fail: () => PdfToolsError): number[] | null {
  if (!f) return null;
  if (f.at < 0 || (f.type !== 1 && f.type !== 3 && f.type !== 4)) throw fail();
  const n = Math.min(f.count, max);
  const out = new Array<number>(n);
  const size = TYPE_SIZE[f.type];
  for (let i = 0; i < n; i++) {
    const at = f.at + i * size;
    out[i] = f.type === 1 ? r.bytes[at] : f.type === 3 ? r.u16(at) : r.u32(at);
  }
  return out;
}

function rational(r: Reader, f: Field | undefined): number | null {
  if (!f || f.at < 0 || f.count < 1) return null;
  if (f.type === 5) {
    const den = r.u32(f.at + 4);
    return den === 0 ? null : r.u32(f.at) / den;
  }
  if (f.type === 3 || f.type === 4) return f.type === 3 ? r.u16(f.at) : r.u32(f.at);
  return null;
}

function dpiOf(value: number | null, unit: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const dpi = unit === 2 ? value : unit === 3 ? value * 2.54 : NaN;
  return dpi >= 20 && dpi <= 9600 ? dpi : null;
}

/** Reads the directory chain. Every page is checked, so a file is refused before any work starts. */
export function readTiff(bytes: Uint8Array): TiffFile {
  if (bytes.length < 8) throw damagedFile();
  const order = (bytes[0] << 8) | bytes[1];
  if (order !== 0x4949 && order !== 0x4d4d) throw damagedFile();
  const r = new Reader(bytes, order === 0x4949);
  const magic = r.u16(2);
  if (magic === 43) throw unsupported('This TIFF', 'BigTIFF');
  if (magic !== 42) throw damagedFile();

  const directories: Map<number, Field>[] = [];
  const read = new Directories();
  const seen = new Set<number>();
  let offset = r.u32(4);
  let visited = 0;
  while (offset !== 0) {
    if (seen.has(offset)) throw damagedFile(); // the chain loops
    seen.add(offset);
    visited += 1;
    if (visited > TIFF_LIMITS.maxPages * 2 + 16) throw tooManyPages();
    const { fields, next } = readDirectory(r, offset, read);
    if (!skipped(r, fields)) {
      directories.push(fields);
      if (directories.length > TIFF_LIMITS.maxPages) throw tooManyPages();
    }
    offset = next;
  }
  if (directories.length === 0) throw damagedFile();

  const claimed: Claimed = { chunks: 0, dataBytes: 0 };
  const pages = directories.map((fields, i) => planPage(r, fields, i + 1, directories.length, claimed));
  const total = pages.reduce((sum, p) => sum + Math.max(p.bufferBytes, p.decodedBytes), 0);
  if (total > TIFF_LIMITS.maxDecodedBytes) throw tooLargeFile('more picture data than 1 GB once opened');
  // a JPEG page is checked whole here, without being copied out (that is done one page at a time, later)
  for (const page of pages) if (page.kind === 'jpeg') jpegPage(bytes, page);
  const only = pages[0];
  return { pages, asImage: pages.length === 1 && only.orientation === 1 && squarePixels(only) };
}

const tooManyPages = () => refuse(`This TIFF has more than ${numbers.format(TIFF_LIMITS.maxPages)} pages, more than PDF Tools converts at once; split it into smaller files and add them again.`, 'too many pages');
const tooLargeFile = (detail: string) => refuse('This TIFF is too large to convert at once; split it into smaller files and add them again.', detail);

/** What the pages of one file have claimed so far: strips or tiles, and the bytes of the file they say they hold. */
interface Claimed {
  chunks: number;
  dataBytes: number;
}

/** Reduced-resolution copies and transparency masks are not pages. */
function skipped(r: Reader, fields: Map<number, Field>): boolean {
  const newType = ints(r, fields.get(254), 1, damagedFile)?.[0] ?? 0;
  const oldType = ints(r, fields.get(255), 1, damagedFile)?.[0] ?? 1;
  return (newType & 5) !== 0 || oldType === 2;
}

function squarePixels(p: TiffPage): boolean {
  if (p.xDpi === null || p.yDpi === null) return true;
  return Math.abs(p.xDpi - p.yDpi) <= 0.01 * Math.max(p.xDpi, p.yDpi);
}

/** A table of whole numbers (BYTE, SHORT, LONG) with at least `n` of them in the file, or null when the tag is absent. */
function numberTable(f: Field | undefined, n: number, fail: () => PdfToolsError): Field | null {
  if (!f) return null;
  if (f.at < 0 || (f.type !== 1 && f.type !== 3 && f.type !== 4) || f.count < n) throw fail();
  return f;
}

function tableValue(r: Reader, at: number, type: number, i: number): number {
  return type === 1 ? r.bytes[at + i] : type === 3 ? r.u16(at + 2 * i) : r.u32(at + 4 * i);
}

/** Where strip or tile `i` starts in the file. */
function chunkOffset(r: Reader, t: ChunkTable, i: number): number {
  return tableValue(r, t.offsetsAt, t.offsetsType, i);
}

/** The bytes strip or tile `i` says it holds (not cut at the end of the file). */
function chunkCount(r: Reader, t: ChunkTable, i: number): number {
  if (t.countsAt >= 0) return tableValue(r, t.countsAt, t.countsType, i);
  const rows = t.tiled ? t.chunkRows : Math.min(t.chunkRows, t.pageRows - (i % t.perPlane) * t.chunkRows);
  return t.rowBytes * rows;
}

function planPage(r: Reader, fields: Map<number, Field>, number: number, pages: number, claimed: Claimed): TiffPage {
  const where = label(number, pages);
  const bad = () => damagedPage(where);
  const one = (tag: number, fallback: number): number => {
    const values = ints(r, fields.get(tag), 1, bad);
    return values && values.length > 0 ? values[0] : fallback;
  };

  const width = one(256, 0);
  const height = one(257, 0);
  if (width < 1 || height < 1) throw bad();
  if (width > TIFF_LIMITS.maxSide || height > TIFF_LIMITS.maxSide || width * height > TIFF_LIMITS.maxPixels) {
    throw refuse(
      `${where} is ${numbers.format(width)} × ${numbers.format(height)} pixels; PDF Tools accepts pictures up to ${numbers.format(TIFF_LIMITS.maxSide)} pixels a side and ${TIFF_LIMITS.maxPixels / 1_000_000} megapixels, so make it smaller and add it again.`,
      'over the image limits',
    );
  }

  const compression = one(259, 1);
  if (!SUPPORTED_COMPRESSION.has(compression)) {
    throw unsupported(where, COMPRESSION_NAMES[compression] ?? `an unknown kind of compression (number ${compression})`);
  }
  const fax = compression === 2 || compression === 3 || compression === 4;
  const samplesPerPixel = one(277, 1);
  if (samplesPerPixel < 1) throw bad();
  const photometric = fields.has(262) ? one(262, 1) : fax ? 0 : samplesPerPixel >= 3 ? 2 : 1;

  const sampleFormat = one(339, 1);
  if (sampleFormat === 3) throw unsupported(where, 'floating-point samples');
  if (sampleFormat === 2) throw unsupported(where, 'signed samples');
  if (sampleFormat !== 1 && sampleFormat !== 4) throw unsupported(where, 'an unusual sample format');

  const sizes = ints(r, fields.get(258), 16, bad) ?? [1];
  const bitsPerSample = sizes[0];
  if (sizes.some((s) => s !== bitsPerSample)) throw unsupported(where, 'samples of different sizes');

  let channels: number;
  switch (photometric) {
    case 0:
    case 1:
    case 3:
      channels = 1;
      break;
    case 2:
    case 6:
      channels = 3;
      break;
    case 5:
      throw unsupported(where, 'CMYK colour');
    case 8:
    case 9:
    case 10:
      throw unsupported(where, 'Lab colour');
    default:
      throw unsupported(where, 'an unusual colour model');
  }
  if (![1, 2, 4, 8].includes(bitsPerSample)) throw unsupported(where, `${bitsPerSample}-bit samples`);
  const extraCount = samplesPerPixel - channels;
  if (extraCount < 0) throw bad();
  if (extraCount > 1) throw unsupported(where, 'more than one extra channel');
  const extraType = extraCount === 1 ? (ints(r, fields.get(338), 1, bad)?.[0] ?? 0) : -1;
  const extra = extraCount === 0 ? 'none' : extraType === 1 ? 'associated' : extraType === 2 ? 'unassociated' : 'ignored';
  if (extraCount === 1 && photometric === 3) throw unsupported(where, 'a transparency channel with a colour palette');
  if (extraCount === 1 && bitsPerSample !== 8) throw unsupported(where, `${bitsPerSample}-bit samples with an extra channel`);
  if (photometric === 2 && bitsPerSample !== 8) throw unsupported(where, `${bitsPerSample}-bit colour samples`);
  if (photometric === 6 && compression !== 7) throw unsupported(where, 'YCbCr colour without JPEG compression');

  let planar = one(284, 1);
  if (planar !== 1 && planar !== 2) throw bad();
  if (samplesPerPixel === 1) planar = 1;
  if (planar === 2 && (extra === 'associated' || extra === 'unassociated')) throw unsupported(where, 'a transparency channel in separate planes');
  if (planar === 2 && bitsPerSample !== 8) throw unsupported(where, `${bitsPerSample}-bit samples in separate planes`);

  const predictorTag = one(317, 1);
  if (predictorTag === 3) throw unsupported(where, 'the floating-point predictor');
  if (predictorTag !== 1 && predictorTag !== 2) throw bad();
  // libtiff applies the predictor with LZW and Deflate only
  const predictor = predictorTag === 2 && (compression === 5 || compression === 8 || compression === 32946);
  if (predictor && bitsPerSample !== 8) throw unsupported(where, `the horizontal predictor with ${bitsPerSample}-bit samples`);

  const fillOrder = one(266, 1);
  if (fillOrder !== 1 && fillOrder !== 2) throw bad();
  const reversed = fillOrder === 2 && compression !== 7;
  if (reversed && bitsPerSample !== 1) throw unsupported(where, 'a reversed bit order with more than one bit a sample');

  if (fax && (bitsPerSample !== 1 || samplesPerPixel !== 1 || photometric > 1)) throw bad();
  const fax2D = compression === 3 && (one(292, 0) & 1) === 1;

  if (compression === 7) {
    if (photometric === 0) throw unsupported(where, 'white-is-zero JPEG pictures');
    if (photometric === 3 || extraCount > 0 || planar === 2 || bitsPerSample !== 8) throw unsupported(where, 'a kind of JPEG compression');
  }

  let orientation = one(274, 1);
  if (orientation < 1 || orientation > 8) orientation = 1;
  const unit = one(296, 2);
  let xDpi = dpiOf(rational(r, fields.get(282)), unit);
  let yDpi = dpiOf(rational(r, fields.get(283)), unit);
  if (xDpi === null) xDpi = yDpi;
  if (yDpi === null) yDpi = xDpi;

  // strips or tiles
  const tiled = fields.has(322) || fields.has(323) || fields.has(324);
  const chunkySpp = planar === 1 ? samplesPerPixel : 1;
  let chunkWidth: number;
  let chunkHeight: number;
  let perPlane: number;
  if (tiled) {
    chunkWidth = one(322, 0);
    chunkHeight = one(323, 0);
    if (chunkWidth < 1 || chunkHeight < 1) throw bad();
    const roomy = Math.max(16 * 1024 * 1024, (Math.ceil(width / 16) * 16) * (Math.ceil(height / 16) * 16));
    if (chunkWidth > 65_536 || chunkHeight > 65_536 || chunkWidth * chunkHeight > roomy) throw unsupported(where, 'tiles of an unusual size');
    if ((chunkWidth * chunkySpp * bitsPerSample) % 8 !== 0) throw unsupported(where, 'tiles that do not start on a byte');
    perPlane = Math.ceil(width / chunkWidth) * Math.ceil(height / chunkHeight);
  } else {
    const rows = one(278, 0xffffffff);
    chunkWidth = width;
    chunkHeight = rows < 1 || rows > height ? height : rows;
    perPlane = Math.ceil(height / chunkHeight);
  }
  const chunks = perPlane * (planar === 2 ? samplesPerPixel : 1);
  if (compression === 7 && chunks !== 1) throw unsupported(where, 'a kind of JPEG compression');
  if (chunks > TIFF_LIMITS.maxChunks) throw unsupported(where, 'an unusual strip layout');
  claimed.chunks += chunks;
  if (claimed.chunks > TIFF_LIMITS.maxFileChunks) throw tooLargeFile('more strips or tiles than PDF Tools reads in one file');
  const offsetsField = numberTable(fields.get(tiled ? 324 : 273), chunks, bad);
  if (!offsetsField) throw bad();
  const chunkRowBytes = Math.ceil((chunkWidth * chunkySpp * bitsPerSample) / 8);
  const countsField = numberTable(fields.get(tiled ? 325 : 279), chunks, bad);
  if (!countsField && compression !== 1) throw bad();
  const table: ChunkTable = {
    littleEndian: r.le,
    offsetsAt: offsetsField.at,
    offsetsType: offsetsField.type,
    countsAt: countsField ? countsField.at : -1,
    countsType: countsField ? countsField.type : 0,
    perPlane,
    rowBytes: chunkRowBytes,
    tiled,
    chunkRows: chunkHeight,
    pageRows: height,
  };
  // Each strip or tile must start in the file and hold something. Honest strips never share bytes, so
  // all the strips of the file together (each cut at the end of the file) cannot claim more bytes than
  // the file has: strips that point at the same data again and again would make the decoders read it
  // again and again (20,000 strips of 8 MB each, or a thousand pages of one 20 MB strip).
  for (let i = 0; i < chunks; i++) {
    const start = chunkOffset(r, table, i);
    const count = chunkCount(r, table, i);
    if (start > r.length || count === 0) throw bad();
    claimed.dataBytes += Math.min(count, r.length - start);
    if (claimed.dataBytes > r.length) throw bad();
  }

  let colorMap: Uint8Array | null = null;
  if (photometric === 3) {
    const n = 1 << bitsPerSample;
    const map = ints(r, fields.get(320), 3 * n, bad);
    if (!map || map.length < 3 * n) throw bad();
    // libtiff: a map whose values all fit in 8 bits was written 8-bit by mistake
    const eightBit = map.every((v) => v < 256);
    colorMap = new Uint8Array(3 * n);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const v = map[c * n + i];
        // the high byte, as libtiff and Pillow read a 16-bit map: exact for maps written as value x 257 and value x 256
        colorMap[i * 3 + c] = eightBit ? v : v >> 8;
      }
    }
  }

  let jpegTables: Uint8Array | null = null;
  const tablesField = fields.get(347);
  if (compression === 7 && tablesField) {
    if (tablesField.at < 0 || (tablesField.type !== 7 && tablesField.type !== 1)) throw bad();
    jpegTables = r.bytes.subarray(tablesField.at, tablesField.at + tablesField.count);
  }

  const kind: TiffPageKind = compression === 7 ? 'jpeg' : photometric === 2 || photometric === 3 ? 'rgb' : bitsPerSample === 1 && samplesPerPixel === 1 ? 'bilevel' : 'grey';
  const storedRowBytes = planar === 1 ? Math.ceil((width * samplesPerPixel * bitsPerSample) / 8) : width * samplesPerPixel;
  const outputBytes = kind === 'bilevel' ? Math.ceil(width / 8) * height : kind === 'grey' ? width * height : width * height * 3;
  const bufferBytes = kind === 'jpeg' ? 0 : Math.max(storedRowBytes * height, outputBytes);
  // A tile is decoded whole: a 16 x 16 page in one 4,096 x 4,096 tile writes 64 MB.
  const decodedBytes = kind === 'jpeg' ? 0 : tiled ? chunks * chunkHeight * chunkRowBytes : storedRowBytes * height;

  return {
    number, pages, width, height, kind, xDpi, yDpi, orientation, compression, photometric, bitsPerSample, samplesPerPixel,
    extra, planar: planar as 1 | 2, predictor, reversed, fax2D, tiled, chunkWidth, chunkHeight, chunks, table, colorMap, jpegTables, bufferBytes, decodedBytes,
  };
}

// ---- decoding a page -----------------------------------------------------------------------------------

const defaultPause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

async function drive<T>(work: Work<T>, pause: () => Promise<void>, sliceMs: number): Promise<T> {
  let start = now();
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
    if (now() - start >= sliceMs) {
      await pause();
      start = now();
    }
  }
}

/** The stored bytes of strip or tile `index`, where they are in the file (cut at its end). */
function chunkBytes(r: Reader, p: TiffPage, index: number): Uint8Array {
  const start = chunkOffset(r, p.table, index);
  return r.bytes.subarray(start, Math.min(r.length, start + chunkCount(r, p.table, index)));
}

function decompress(stored: Uint8Array, out: Uint8Array, at: number, length: number, columns: number, rows: number, p: TiffPage): Work {
  const fax = p.compression === 2 || p.compression === 3 || p.compression === 4;
  // FillOrder 2: fax data is read reversed where it is; the other compressions read a reversed copy of
  // no more than they can need (none of them takes four times its output; a strip may claim far more)
  const raw = p.reversed && !fax ? reverseBits(stored.subarray(0, Math.min(stored.length, 4 * length + 65_536))) : stored;
  switch (p.compression) {
    case 1:
      return (function* copy(): Work {
        if (raw.length < length) throw new CodecError('short');
        out.set(raw.subarray(0, length), at);
        yield;
      })();
    case 32773:
      return packBitsInto(raw, out, at, length);
    case 5:
      return lzwInto(raw, out, at, length);
    case 8:
    case 32946:
      return inflateInto(raw, out, at, length);
    default: {
      const mode: FaxMode = p.compression === 2 ? 'mh' : p.compression === 4 ? 'g4' : p.fax2D ? 'g3-2d' : 'g3-1d';
      return faxInto(raw, out, at, columns, rows, mode, p.reversed);
    }
  }
}

function undoPredictor(buf: Uint8Array, at: number, rows: number, rowLength: number, spp: number): void {
  for (let r = 0; r < rows; r++) {
    const base = at + r * rowLength;
    for (let i = spp; i < rowLength; i++) buf[base + i] = (buf[base + i] + buf[base + i - spp]) & 255;
  }
}

function* pageWork(bytes: Uint8Array, p: TiffPage): Work<TiffPixels> {
  const reader = new Reader(bytes, p.table.littleEndian);
  const { width, height, bitsPerSample: bps, samplesPerPixel: spp } = p;
  const chunkySpp = p.planar === 1 ? spp : 1;
  const rowBytes = p.planar === 1 ? Math.ceil((width * spp * bps) / 8) : width * spp;
  const chunkRowBytes = Math.ceil((p.chunkWidth * chunkySpp * bps) / 8);
  const buf = new Uint8Array(p.bufferBytes);
  const planes = p.planar === 2 ? spp : 1;
  const across = Math.ceil(width / p.chunkWidth);
  const down = Math.ceil(height / p.chunkHeight);
  let temp: Uint8Array | null = null;
  let index = 0;
  for (let plane = 0; plane < planes; plane++) {
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++, index++) {
        const y0 = ty * p.chunkHeight;
        const rows = p.tiled ? p.chunkHeight : Math.min(p.chunkHeight, height - y0);
        const length = rows * chunkRowBytes;
        const direct = !p.tiled && p.planar === 1;
        let target: Uint8Array = buf;
        let at = y0 * rowBytes;
        if (!direct) {
          if (!temp || temp.length !== length) temp = new Uint8Array(length);
          target = temp;
          at = 0;
        }
        yield* decompress(chunkBytes(reader, p, index), target, at, length, p.chunkWidth, rows, p);
        if (p.predictor) undoPredictor(target, at, rows, chunkRowBytes, chunkySpp);
        if (!direct) place(target, p, plane, tx, y0, rows, chunkRowBytes, buf, rowBytes);
        yield;
      }
    }
  }
  return yield* convert(buf, p, rowBytes);
}

/** Copies a decoded tile (or a strip of one plane) into the page's interleaved rows. */
function place(src: Uint8Array, p: TiffPage, plane: number, tx: number, y0: number, rows: number, srcRowBytes: number, buf: Uint8Array, rowBytes: number): void {
  const { width, height, samplesPerPixel: spp } = p;
  const lastRow = Math.min(rows, height - y0);
  if (p.planar === 1) {
    const offset = (tx * p.chunkWidth * spp * p.bitsPerSample) / 8;
    const n = Math.min(srcRowBytes, rowBytes - offset);
    for (let r = 0; r < lastRow; r++) buf.set(src.subarray(r * srcRowBytes, r * srcRowBytes + n), (y0 + r) * rowBytes + offset);
    return;
  }
  const x0 = tx * p.chunkWidth;
  const columns = Math.min(p.chunkWidth, width - x0);
  for (let r = 0; r < lastRow; r++) {
    let o = ((y0 + r) * width + x0) * spp + plane;
    const s = r * srcRowBytes;
    for (let c = 0; c < columns; c++, o += spp) buf[o] = src[s + c];
  }
}

const unassociated = (c: number, a: number) => ((c * a + 255 * (255 - a) + 127) / 255) | 0;
const associated = (c: number, a: number) => Math.min(255, c + 255 - a);

/** Turns the stored samples into the output kind, in place. */
function* convert(buf: Uint8Array, p: TiffPage, rowBytes: number): Work<TiffPixels> {
  const { width: w, height: h, photometric, bitsPerSample: bps, samplesPerPixel: spp } = p;
  const n = w * h;
  const step = 1 << 18;
  if (p.kind === 'bilevel') {
    const length = rowBytes * h;
    if (photometric === 0) {
      for (let i = 0; i < length; i++) {
        buf[i] ^= 0xff;
        if ((i & (step - 1)) === step - 1) yield;
      }
    }
    // the bits after the last pixel of each row are cleared, whatever the file held there
    if (w % 8 !== 0) {
      const keep = (0xff << (8 - (w % 8))) & 0xff;
      for (let i = rowBytes - 1; i < length; i += rowBytes) buf[i] &= keep;
    }
    return { kind: 'bilevel', width: w, height: h, rowBytes, data: buf.subarray(0, length) };
  }
  const flip = photometric === 0 ? 255 : 0;
  if (p.kind === 'grey') {
    if (bps < 8) {
      const max = (1 << bps) - 1;
      const scale = 255 / max;
      for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
          const bit = x * bps;
          const v = (buf[y * rowBytes + (bit >> 3)] >> (8 - bps - (bit & 7))) & max;
          buf[y * w + x] = (v * scale) ^ flip;
        }
        if (y % 256 === 0) yield;
      }
    } else if (spp === 1) {
      if (flip) for (let i = 0; i < n; i++) buf[i] ^= 0xff;
    } else {
      for (let i = 0; i < n; i++) {
        const g = buf[2 * i] ^ flip;
        const a = buf[2 * i + 1];
        buf[i] = p.extra === 'unassociated' ? unassociated(g, a) : p.extra === 'associated' ? associated(g, a) : g;
        if ((i & (step - 1)) === step - 1) yield;
      }
    }
    return { kind: 'grey', width: w, height: h, rowBytes: w, data: buf.subarray(0, n) };
  }
  if (photometric === 3) {
    const map = p.colorMap!;
    const max = (1 << bps) - 1;
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const bit = x * bps;
        const ix = (buf[y * rowBytes + (bit >> 3)] >> (8 - bps - (bit & 7))) & max;
        const o = (y * w + x) * 3;
        buf[o] = map[ix * 3];
        buf[o + 1] = map[ix * 3 + 1];
        buf[o + 2] = map[ix * 3 + 2];
      }
      if (y % 256 === 0) yield;
    }
  } else if (spp === 4) {
    for (let i = 0; i < n; i++) {
      const r = buf[4 * i];
      const g = buf[4 * i + 1];
      const b = buf[4 * i + 2];
      const a = buf[4 * i + 3];
      const f = p.extra === 'unassociated' ? unassociated : p.extra === 'associated' ? associated : null;
      buf[3 * i] = f ? f(r, a) : r;
      buf[3 * i + 1] = f ? f(g, a) : g;
      buf[3 * i + 2] = f ? f(b, a) : b;
      if ((i & (step - 1)) === step - 1) yield;
    }
  }
  return { kind: 'rgb', width: w, height: h, rowBytes: w * 3, data: buf.subarray(0, n * 3) };
}

function codecRefusal(error: unknown, where: string): unknown {
  if (error instanceof RangeError) return tooLargeFile('memory for the page could not be had'); // an allocation refused
  if (!(error instanceof CodecError)) return error;
  if (error.reason === 'old-lzw') return unsupported(where, 'an old form of LZW compression');
  if (error.reason === 'fax-uncompressed') return unsupported(where, 'the uncompressed mode of fax compression');
  return damagedPage(where);
}

function pauseFor(p: TiffPage, options: TiffWorkOptions): () => Promise<void> {
  const pause = options.pause;
  return pause ? () => pause({ page: p.number, pages: p.pages }) : defaultPause;
}

/** The exact pixels of one page (not for JPEG pages). */
export async function decodeTiffPage(bytes: Uint8Array, page: TiffPage, options: TiffWorkOptions = {}): Promise<TiffPixels> {
  if (page.kind === 'jpeg') throw damagedPage(label(page.number, page.pages));
  try {
    return await drive(pageWork(bytes, page), pauseFor(page, options), options.sliceMs ?? SLICE_MS);
  } catch (error) {
    throw codecRefusal(error, label(page.number, page.pages));
  }
}

// ---- JPEG pages ----------------------------------------------------------------------------------------

const ADOBE = (transform: number) => [0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, transform];

interface JpegParts {
  kept: Uint8Array[];
  scan: Uint8Array | null;
  frame: { width: number; height: number; components: number } | null;
  tables: { dqt: boolean; dht: boolean };
}

/**
 * Walks the markers of a JPEG (from just after SOI): keeps the segments that say nothing about how the
 * picture is turned or coloured, notes the frame and the tables, and stops at the scan.
 */
function jpegSegments(data: Uint8Array, start: number, dropApp0: boolean, parts: JpegParts, where: string, tablesOnly: boolean): void {
  const odd = () => unsupported(where, 'a kind of JPEG compression');
  let i = start;
  while (i < data.length) {
    if (data[i] !== 0xff || i + 1 >= data.length) throw damagedPage(where);
    const marker = data[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd9) {
      if (!tablesOnly) throw damagedPage(where);
      return;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) throw damagedPage(where);
    if (i + 4 > data.length) throw damagedPage(where);
    const length = (data[i + 2] << 8) | data[i + 3];
    if (length < 2 || i + 2 + length > data.length) throw damagedPage(where);
    const segment = data.subarray(i, i + 2 + length);
    if (marker === 0xda) {
      if (tablesOnly) throw damagedPage(where);
      parts.scan = data.subarray(i);
      return;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (tablesOnly || parts.frame) throw damagedPage(where);
      if (marker > 0xc2) throw odd(); // lossless, hierarchical or arithmetic-coded
      if (length < 8 || segment[4] !== 8) throw odd(); // 12-bit
      const height = (segment[5] << 8) | segment[6];
      const width = (segment[7] << 8) | segment[8];
      parts.frame = { width, height, components: segment[9] };
    }
    if (marker === 0xdb) parts.tables.dqt = true;
    if (marker === 0xc4) parts.tables.dht = true;
    const drop = marker === 0xe1 || marker === 0xee || (marker === 0xe0 && dropApp0);
    if (!drop) parts.kept.push(segment);
    i += 2 + length;
  }
  if (!tablesOnly) throw damagedPage(where);
}

/** A JPEG page checked whole (markers, frame, tables, end), with the parts to build it from; nothing is copied. */
function jpegPage(bytes: Uint8Array, page: TiffPage): { parts: JpegParts; last: number; rgb: boolean } {
  const where = label(page.number, page.pages);
  if (page.kind !== 'jpeg') throw damagedPage(where);
  const r = new Reader(bytes, page.table.littleEndian);
  const start = chunkOffset(r, page.table, 0);
  const end = start + chunkCount(r, page.table, 0);
  if (end > bytes.length) throw damagedPage(where);
  const strip = bytes.subarray(start, end);
  if (strip.length < 4 || strip[0] !== 0xff || strip[1] !== 0xd8) throw damagedPage(where);
  const rgb = page.photometric === 2;
  const parts: JpegParts = { kept: [], scan: null, frame: null, tables: { dqt: false, dht: false } };
  if (page.jpegTables) {
    const t = page.jpegTables;
    if (t.length < 4 || t[0] !== 0xff || t[1] !== 0xd8) throw damagedPage(where);
    jpegSegments(t, 2, rgb, parts, where, true);
  }
  jpegSegments(strip, 2, rgb, parts, where, false);
  const { frame, scan } = parts;
  if (!frame || !scan || !parts.tables.dqt || !parts.tables.dht) throw damagedPage(where);
  if (frame.width !== page.width || frame.height !== page.height) throw unsupported(where, 'a kind of JPEG compression');
  if (frame.components !== (page.photometric === 1 ? 1 : 3)) throw damagedPage(where);
  // the picture must end: EOI after the scan (zero padding after it is allowed)
  let last = scan.length;
  while (last > 2 && scan[last - 1] === 0) last--;
  if (last < 4 || scan[last - 2] !== 0xff || scan[last - 1] !== 0xd9) throw damagedPage(where);
  return { parts, last, rgb };
}

/**
 * The page's JPEG made whole and unambiguous: its JPEGTables merged in, any EXIF orientation or Adobe
 * marker of its own removed, and, for colour, an Adobe marker saying whether the samples are RGB
 * (photometric 2, as libtiff writes them, no colour transform) or YCbCr (photometric 6).
 */
export function tiffPageJpeg(bytes: Uint8Array, page: TiffPage): Uint8Array {
  const { parts, last, rgb } = jpegPage(bytes, page);
  const frame = parts.frame!;
  const scan = parts.scan!;
  const head = frame.components === 3 ? ADOBE(rgb ? 0 : 1) : [];
  const size = 2 + head.length + parts.kept.reduce((s, k) => s + k.length, 0) + last;
  const out = new Uint8Array(size);
  out.set([0xff, 0xd8], 0);
  out.set(head, 2);
  let at = 2 + head.length;
  for (const segment of parts.kept) {
    out.set(segment, at);
    at += segment.length;
  }
  out.set(scan.subarray(0, last), at);
  return out;
}

// ---- writing: rows, zlib, PNG ----------------------------------------------------------------------------

const cost = (v: number) => (v < 128 ? v : 256 - v);

/**
 * One row filtered with PNG filter `f` (0 None, 1 Sub, 2 Up, 4 Paeth; `prev` is the row above, zeros
 * for the first) into `out`; returns the libpng cost (sum of |signed bytes|), or stops at `stopAt`.
 */
function filterRow(f: number, row: Uint8Array, prev: Uint8Array, bpp: number, out: Uint8Array, stopAt: number): number {
  const n = row.length;
  let sum = 0;
  if (f === 0) {
    for (let i = 0; i < n; i++) {
      out[i] = row[i];
      sum += cost(row[i]);
      if (sum >= stopAt) return sum;
    }
  } else if (f === 1) {
    for (let i = 0; i < n; i++) {
      const v = (row[i] - (i >= bpp ? row[i - bpp] : 0)) & 255;
      out[i] = v;
      sum += cost(v);
      if (sum >= stopAt) return sum;
    }
  } else if (f === 2) {
    for (let i = 0; i < n; i++) {
      const v = (row[i] - prev[i]) & 255;
      out[i] = v;
      sum += cost(v);
      if (sum >= stopAt) return sum;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const pa = p > a ? p - a : a - p;
      const pb = p > b ? p - b : b - p;
      const pc = p > c ? p - c : c - p;
      const v = (row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      out[i] = v;
      sum += cost(v);
      if (sum >= stopAt) return sum;
    }
  }
  return sum;
}

/**
 * The rows with a PNG filter byte each, in batches, followed by `whiteRows` rows of 1 bits (see
 * BILEVEL_EXTRA_ROWS). Each row takes whichever filter looks smallest: of None and Up for 1-bit rows
 * (Sub and Paeth do nothing useful across packed bits), of None, Sub, Up and Paeth otherwise.
 */
function* filteredRows(px: TiffPixels, whiteRows = 0): Generator<Uint8Array> {
  const { rowBytes, height, data } = px;
  const bpp = px.kind === 'rgb' ? 3 : 1;
  const filters = px.kind === 'bilevel' ? [0, 2] : [0, 1, 2, 4];
  const line = rowBytes + 1;
  const total = height + whiteRows;
  const perBatch = Math.max(1, Math.floor((1 << 16) / line));
  const white = new Uint8Array(rowBytes).fill(0xff);
  const zeros = new Uint8Array(rowBytes);
  const rowAt = (y: number) => (y < 0 ? zeros : y < height ? data.subarray(y * rowBytes, (y + 1) * rowBytes) : white);
  const candidates = filters.map(() => new Uint8Array(rowBytes));
  for (let y0 = 0; y0 < total; y0 += perBatch) {
    const rows = Math.min(perBatch, total - y0);
    const batch = new Uint8Array(rows * line);
    for (let r = 0; r < rows; r++) {
      const y = y0 + r;
      const row = rowAt(y);
      const prev = rowAt(y - 1);
      let best = 0;
      let bestCost = Infinity;
      for (let k = 0; k < filters.length; k++) {
        const c = filterRow(filters[k], row, prev, bpp, candidates[k], bestCost);
        if (c < bestCost) {
          bestCost = c;
          best = k;
        }
      }
      batch[r * line] = filters[best];
      batch.set(candidates[best], r * line + 1); // the best was filtered to its end: it never reached its stop
    }
    yield batch;
  }
}

/**
 * pdf.js 5.4.296, this application's renderer, draws the last row of a 1-bit picture only up to pixel
 * ceil(width / 8) * 8 - 7 and leaves the rest transparent (canvas.js putBinaryImageData, "srcDiff * 8 - 7").
 * A bilevel page is therefore stored with one more row, white, which its matrix places just below the
 * page's bottom edge, where the page box cuts it off: every reader shows exactly the TIFF's pixels.
 */
const BILEVEL_EXTRA_ROWS = 1;

/** zlib (RFC 1950) of the batches, with the platform's CompressionStream, pausing between slices. */
async function deflate(batches: Generator<Uint8Array>, pause: () => Promise<void>, sliceMs: number, limit: number): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let tooLarge = false;
  const reading = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      parts.push(value);
      total += value.length;
      if (total > limit) tooLarge = true;
    }
  })();
  reading.catch(() => undefined);
  try {
    let start = now();
    for (const batch of batches) {
      await writer.ready;
      await writer.write(batch as Uint8Array<ArrayBuffer>);
      if (tooLarge) throw tooLargeOutput();
      if (now() - start >= sliceMs) {
        await pause();
        start = now();
      }
    }
    await writer.close();
    await reading;
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
  if (tooLarge) throw tooLargeOutput();
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const tooLargeOutput = () => refuse('The PDF made from this TIFF would be too large for the list; split the TIFF into smaller files and add them again.', 'output over the limit');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  let crc = -1;
  for (let i = 4; i < 8 + body.length; i++) crc = CRC_TABLE[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  view.setUint32(8 + body.length, (crc ^ -1) >>> 0);
  return out;
}

async function pngOf(px: TiffPixels, page: TiffPage, pause: () => Promise<void>, sliceMs: number): Promise<Uint8Array> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, px.width);
  view.setUint32(4, px.height);
  header[8] = px.kind === 'bilevel' ? 1 : 8;
  header[9] = px.kind === 'rgb' ? 2 : 0;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header)];
  if (page.xDpi !== null && page.yDpi !== null) {
    const phys = new Uint8Array(9);
    const pv = new DataView(phys.buffer);
    pv.setUint32(0, Math.round(page.xDpi / 0.0254));
    pv.setUint32(4, Math.round(page.yDpi / 0.0254));
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  const data = await deflate(filteredRows(px), pause, sliceMs, Infinity);
  for (let at = 0; at < data.length; at += 1 << 20) parts.push(chunk('IDAT', data.subarray(at, Math.min(data.length, at + (1 << 20)))));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The one page of a file kept as an image: PNG, or the page's own JPEG. The TIFF is not changed. */
export async function tiffToImage(bytes: Uint8Array, file: TiffFile, options: TiffWorkOptions = {}): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' }> {
  const page = file.pages[0];
  if (page.kind === 'jpeg') return { bytes: tiffPageJpeg(bytes, page), mimeType: 'image/jpeg' };
  const pause = pauseFor(page, options);
  await pause();
  const px = await decodeTiffPage(bytes, page, options);
  return { bytes: await pngOf(px, page, pause, options.sliceMs ?? SLICE_MS), mimeType: 'image/png' };
}

// ---- writing: PDF ----------------------------------------------------------------------------------------

interface Transform {
  swap: boolean;
  U: [number, number, number];
  T: [number, number, number];
}

// TIFF Orientation is defined as EXIF's (the same table as imagesToPdf.ts): where a stored point (u right,
// t down, 0..1) lands on the page (U right, T down): U = U0 + Uu*u + Ut*t, T = T0 + Tu*u + Tt*t.
const TRANSFORMS: Transform[] = [
  { swap: false, U: [0, 1, 0], T: [0, 0, 1] },
  { swap: false, U: [0, 1, 0], T: [0, 0, 1] },
  { swap: false, U: [1, -1, 0], T: [0, 0, 1] },
  { swap: false, U: [1, -1, 0], T: [1, 0, -1] },
  { swap: false, U: [0, 1, 0], T: [1, 0, -1] },
  { swap: true, U: [0, 0, 1], T: [0, 1, 0] },
  { swap: true, U: [1, 0, -1], T: [0, 1, 0] },
  { swap: true, U: [1, 0, -1], T: [1, -1, 0] },
  { swap: true, U: [0, 0, 1], T: [1, -1, 0] },
];

/** The page's size in points: from its resolution, or fitted to A4 when it has none; within 14,400 pt. */
export function tiffPageSize(p: TiffPage): [number, number] {
  let xd = p.xDpi;
  let yd = p.yDpi;
  if (xd === null || yd === null) {
    const dpi = Math.max(72, Math.max(p.width, p.height) / A4_LONG_INCHES);
    xd = dpi;
    yd = dpi;
  }
  const stored: [number, number] = [(p.width * 72) / xd, (p.height * 72) / yd];
  const [w, h] = TRANSFORMS[p.orientation].swap ? [stored[1], stored[0]] : stored;
  const scale = Math.min(1, MAX_PAGE_PT / Math.max(w, h));
  return [Math.min(MAX_PAGE_PT, w * scale), Math.min(MAX_PAGE_PT, h * scale)];
}

/**
 * A PDF with one page for each page of the TIFF, each picture filling its page, sized from the scan's
 * resolution and turned by its orientation. The TIFF is not changed.
 */
export async function tiffToPdf(bytes: Uint8Array, file: TiffFile, options: TiffWorkOptions = {}): Promise<Uint8Array> {
  const limit = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT;
  const sliceMs = options.sliceMs ?? SLICE_MS;
  const doc = await PDFDocument.create({ updateMetadata: false });
  let total = 0;
  for (const page of file.pages) {
    const where = label(page.number, page.pages);
    const pause = pauseFor(page, options);
    await pause();
    let image: PDFRef;
    let extraRows = 0;
    if (page.kind === 'jpeg') {
      const jpeg = tiffPageJpeg(bytes, page);
      if (options.checkJpeg) {
        try {
          await options.checkJpeg(jpeg);
        } catch (error) {
          throw error instanceof PdfToolsError ? damagedPage(where) : error;
        }
      }
      total += jpeg.length;
      image = doc.context.register(doc.context.stream(jpeg, {
        Type: 'XObject', Subtype: 'Image', Width: page.width, Height: page.height, BitsPerComponent: 8,
        ColorSpace: page.photometric === 1 ? 'DeviceGray' : 'DeviceRGB', Filter: 'DCTDecode',
      }));
    } else {
      const px = await decodeTiffPage(bytes, page, options);
      extraRows = px.kind === 'bilevel' ? BILEVEL_EXTRA_ROWS : 0;
      const data = await deflate(filteredRows(px, extraRows), pause, sliceMs, limit - total);
      total += data.length;
      const colours = px.kind === 'rgb' ? 3 : 1;
      const bits = px.kind === 'bilevel' ? 1 : 8;
      image = doc.context.register(doc.context.stream(data, {
        Type: 'XObject', Subtype: 'Image', Width: page.width, Height: page.height + extraRows, BitsPerComponent: bits,
        ColorSpace: colours === 3 ? 'DeviceRGB' : 'DeviceGray', Filter: 'FlateDecode',
        DecodeParms: { Predictor: 15, Colors: colours, BitsPerComponent: bits, Columns: page.width },
      }));
    }
    if (total > limit) throw tooLargeOutput();
    const [w, h] = tiffPageSize(page);
    const t = TRANSFORMS[page.orientation];
    const [U0, Uu, Ut0] = t.U;
    const [T0, Tu, Tt0] = t.T;
    // the stored rows run down the picture's height; with extra rows below them, the picture's unit
    // square is (height + extra) / height of the stored height, and the extra rows fall off the page
    const k = (page.height + extraRows) / page.height;
    const Ut = Ut0 * k;
    const Tt = Tt0 * k;
    const pdfPage = doc.addPage([w, h]);
    const name = pdfPage.node.newXObject('Image', image);
    pdfPage.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(w * Uu, -h * Tu, -w * Ut, h * Tt, w * (U0 + Ut), h * (1 - T0 - Tt)),
      drawObject(name),
      popGraphicsState(),
    );
  }
  const date = new Date();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  // pdf-lib's own save with object streams, its waits taken by the clock (the same bytes; pace.ts).
  return savePaced(doc, { useObjectStreams: true });
}
