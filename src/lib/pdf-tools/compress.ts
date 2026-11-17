import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import { parentChainsEnd } from './inspect';
import { loadPaced, savePaced } from './pace';
import { PdfToolsError } from './types';

export type CompressLevel = 'low' | 'recommended' | 'extreme';

export const COMPRESS_LEVELS: Record<CompressLevel, { dpi: number; quality: number; label: string }> = {
  low: { dpi: 200, quality: 0.82, label: 'Light' },
  recommended: { dpi: 150, quality: 0.68, label: 'Balanced' },
  extreme: { dpi: 96, quality: 0.45, label: 'Strong' },
};

/**
 * One image to re-encode, as stored in the PDF. PDF viewers draw the stored pixels as plain device RGB or
 * grey and ignore EXIF orientation and embedded ICC profiles, so the recoder must not apply orientation or
 * colour management either. JPEG sources arrive with their EXIF and ICC profile segments already removed,
 * so that a browser decoder cannot apply them on its own.
 */
export interface RecodeRequest {
  source: { kind: 'jpeg'; bytes: Uint8Array } | { kind: 'raw'; bytes: Uint8Array; channels: 1 | 3 };
  width: number; // source pixels
  height: number;
  targetWidth: number; // never larger than the source
  targetHeight: number;
  quality: number; // 0..1 JPEG quality
  grayscale: boolean;
}

/**
 * Returns an 8-bit JPEG with 1 or 3 components of exactly targetWidth x targetHeight, or null if it cannot
 * decode the source. Any other output keeps the original image.
 */
export type ImageRecoder = (req: RecodeRequest) => Promise<Uint8Array | null>;

export interface CompressResult {
  bytes: Uint8Array | null; // null when the result would be less than 1% smaller than the input
  originalSize: number;
  newSize: number;
  imagesFound: number;
  /**
   * Images of a kind the levels can recode; 0 means no level can make the images smaller. Always set by
   * compressPdf; optional so that a stand-in without it reads as "as many as found".
   */
  imagesRecodable?: number;
  imagesReplaced: number;
}

const APP_NAME = 'ICAI VERA';
const POINTS_PER_INCH = 72;
// Smaller gains are not worth another generation of JPEG loss, for example on a second run.
const MAX_IMAGE_RATIO = 0.9;
const MAX_FILE_RATIO = 0.99;

const XOBJECT = PDFName.of('XObject');
const RESOURCES = PDFName.of('Resources');
const USER_UNIT = PDFName.of('UserUnit');
const SUBTYPE = PDFName.of('Subtype');
const IMAGE = PDFName.of('Image');
const FORM = PDFName.of('Form');
const WIDTH = PDFName.of('Width');
const HEIGHT = PDFName.of('Height');
const BITS = PDFName.of('BitsPerComponent');
const COLOR_SPACE = PDFName.of('ColorSpace');
const FILTER = PDFName.of('Filter');
const IMAGE_MASK = PDFName.of('ImageMask');
const MASK_KEYS = [PDFName.of('SMask'), PDFName.of('Mask')];
const DCT = PDFName.of('DCTDecode');
const FLATE = PDFName.of('FlateDecode');
const DEVICE_RGB = PDFName.of('DeviceRGB');
const DEVICE_GRAY = PDFName.of('DeviceGray');
const ICC_BASED = PDFName.of('ICCBased');
const CAL_RGB = PDFName.of('CalRGB');
const CAL_GRAY = PDFName.of('CalGray');
const N_KEY = PDFName.of('N');
const RANGE = PDFName.of('Range');
// F, FFilter and FDecodeParms mean the pixels live in an external file, not in the stream.
const EXCLUDING_KEYS = ['SMask', 'Mask', 'Decode', 'DecodeParms', 'F', 'FFilter', 'FDecodeParms'].map((key) => PDFName.of(key));
const STALE_KEYS = ['Length', 'DL'].map((key) => PDFName.of(key));

const bytesOf = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const EXIF_ID = bytesOf('Exif\0\0');
const ICC_ID = bytesOf('ICC_PROFILE\0');

interface FoundImage {
  ref: PDFRef;
  stream: PDFStream;
  // Largest extent, in inches, of the pages that use the image, turned to the image's orientation.
  across: number;
  down: number;
  onUnreadablePage: boolean;
}

/**
 * The colour of an image the levels can recode: grey (one component) or RGB (three), and whether that is a
 * plain device space (DeviceGray, DeviceRGB) or one carrying its own calibration (an ICC profile, CalGray,
 * CalRGB). The recoder keeps the stored numbers (it applies no colour management), so a recoded image keeps
 * its colour space and its colours mean what they meant; only a grey image that comes back with three
 * components is written as DeviceRGB, which drops a grey profile (see acceptedColorSpace).
 */
interface Colour {
  grey: boolean;
  device: boolean;
}

interface Candidate {
  ref: PDFRef;
  stream: PDFRawStream;
  kind: 'jpeg' | 'raw';
  width: number;
  height: number;
  colour: Colour;
  across: number;
  down: number;
}

interface JpegFrame {
  precision: number;
  width: number;
  height: number;
  components: number;
}

type Outcome = 'not-offered' | 'threw' | 'kept' | 'replaced';

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  const unreadable = () => new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
  let doc: PDFDocument;
  try {
    doc = await loadPaced(bytes, { ignoreEncryption: true, updateMetadata: false }); // pdf-lib's own load, waiting by the clock
  } catch {
    throw unreadable();
  }
  // Checked before the pages: an encrypted file's catalog can sit in an object stream that cannot be read yet.
  if (doc.isEncrypted) throw new PdfToolsError('encrypted', 'This file is password-protected. Unlock it first.');
  let pages = 0;
  try {
    pages = doc.getPageCount();
    // A page-tree node that is its own ancestor sends a page's inherited lookups round for ever (a raw
    // RangeError, REV-A S2): refused here as damaged, by the same rule intake applies (inspect.ts).
    if (!parentChainsEnd(doc)) pages = 0;
  } catch {
    // no readable page tree (a loop through /Kids overflows the stack); reported below
  }
  if (pages < 1) throw unreadable();
  return doc;
}

function positiveInteger(value: PDFObject | undefined): number | null {
  if (!(value instanceof PDFNumber)) return null;
  const n = value.asNumber();
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pageInches(page: PDFPage): [number, number] | null {
  try {
    const { width, height } = page.getMediaBox();
    const unit = page.node.lookup(USER_UNIT);
    const scale = (unit instanceof PDFNumber && unit.asNumber() > 0 ? unit.asNumber() : 1) / POINTS_PER_INCH;
    const across = Math.abs(width) * scale;
    const down = Math.abs(height) * scale;
    return across > 0 && down > 0 && Number.isFinite(across) && Number.isFinite(down) ? [across, down] : null;
  } catch {
    return null;
  }
}

function collectImages(doc: PDFDocument): FoundImage[] {
  const found = new Map<string, FoundImage>();

  const note = (ref: PDFRef, stream: PDFStream, page: [number, number] | null) => {
    const key = ref.toString();
    const entry = found.get(key) ?? { ref, stream, across: 0, down: 0, onUnreadablePage: false };
    found.set(key, entry);
    if (!page) {
      entry.onUnreadablePage = true;
      return;
    }
    let [across, down] = page;
    const width = positiveInteger(stream.dict.lookup(WIDTH)) ?? 0;
    const height = positiveInteger(stream.dict.lookup(HEIGHT)) ?? 0;
    // A landscape image on a portrait page (or the reverse) is usually drawn turned to fill it.
    if ((width > height && across < down) || (width < height && across > down)) [across, down] = [down, across];
    entry.across = Math.max(entry.across, across);
    entry.down = Math.max(entry.down, down);
  };

  const visit = (resources: PDFObject | undefined, page: [number, number] | null, forms: Set<string>) => {
    if (!(resources instanceof PDFDict)) return;
    const xobjects = resources.lookup(XOBJECT);
    if (!(xobjects instanceof PDFDict)) return;
    for (const value of xobjects.values()) {
      if (!(value instanceof PDFRef)) continue;
      const object = doc.context.lookup(value);
      if (!(object instanceof PDFStream)) continue;
      const subtype = object.dict.lookup(SUBTYPE);
      if (subtype === IMAGE) {
        note(value, object, page);
      } else if (subtype === FORM && !forms.has(value.toString())) {
        forms.add(value.toString());
        visit(object.dict.lookup(RESOURCES), page, forms);
      }
    }
  };

  for (const page of doc.getPages()) {
    visit(doc.context.lookup(page.node.getInheritableAttribute(RESOURCES)), pageInches(page), new Set());
  }
  return [...found.values()];
}

// Masks must stay as they are: a mask recoded as a colour JPEG is no longer a valid mask, and the image it masks vanishes.
function maskRefs(doc: PDFDocument): Set<string> {
  const refs = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : null;
    if (!dict) continue;
    for (const key of MASK_KEYS) {
      const value = dict.get(key);
      if (value instanceof PDFRef) refs.add(value.toString());
    }
  }
  return refs;
}

/** An ICC profile's /Range, when given, must be the usual 0 to 1 for every component. */
function unitRange(range: PDFObject | undefined, n: number): boolean {
  if (range === undefined) return true;
  if (!(range instanceof PDFArray) || range.size() !== 2 * n) return false;
  return range.asArray().every((value, i) => value instanceof PDFNumber && value.asNumber() === i % 2);
}

/**
 * Grey or RGB, plain or calibrated (Colour above), or null for any other colour space: CMYK (with a profile
 * or not), Lab, Indexed (palettes are logos and drawings, which JPEG would blur), Separation, DeviceN.
 */
function colourOf(space: PDFObject | undefined): Colour | null {
  if (space === DEVICE_RGB) return { grey: false, device: true };
  if (space === DEVICE_GRAY) return { grey: true, device: true };
  if (!(space instanceof PDFArray) || space.size() !== 2) return null;
  const family = space.lookup(0);
  const params = space.lookup(1);
  if ((family === CAL_RGB || family === CAL_GRAY) && params instanceof PDFDict) return { grey: family === CAL_GRAY, device: false };
  if (family !== ICC_BASED || !(params instanceof PDFStream)) return null;
  const n = params.dict.lookup(N_KEY);
  const components = n instanceof PDFNumber ? n.asNumber() : 0;
  if ((components !== 1 && components !== 3) || !unitRange(params.dict.lookup(RANGE), components)) return null;
  return { grey: components === 1, device: false };
}

function asCandidate(image: FoundImage, masks: Set<string>): Candidate | null {
  const { stream } = image;
  if (image.onUnreadablePage || masks.has(image.ref.toString()) || !(stream instanceof PDFRawStream)) return null;
  const dict = stream.dict;
  if (EXCLUDING_KEYS.some((key) => dict.has(key))) return null;
  if (dict.has(IMAGE_MASK) && dict.lookup(IMAGE_MASK) !== PDFBool.False) return null;
  const width = positiveInteger(dict.lookup(WIDTH));
  const height = positiveInteger(dict.lookup(HEIGHT));
  const bits = dict.lookup(BITS);
  const filter = dict.lookup(FILTER);
  if (!width || !height || !(bits instanceof PDFNumber) || bits.asNumber() !== 8) return null;
  let colour: Colour | null;
  try {
    colour = colourOf(dict.lookup(COLOR_SPACE));
  } catch {
    colour = null; // a broken reference in the colour space: left as it is
  }
  if (!colour) return null;
  const kind = filter === DCT ? 'jpeg' : filter === FLATE ? 'raw' : null;
  if (!kind) return null;
  return { ref: image.ref, stream, kind, width, height, colour, across: image.across, down: image.down };
}

function targetSize(image: Candidate, dpi: number): [number, number] {
  // Limits are whole pixels first; one scale for both sides then keeps the aspect ratio.
  const limitAcross = Math.max(1, Math.round(image.across * dpi));
  const limitDown = Math.max(1, Math.round(image.down * dpi));
  const scale = Math.min(1, limitAcross / image.width, limitDown / image.height);
  return [Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale))];
}

function startsWithId(bytes: Uint8Array, at: number, end: number, id: number[]): boolean {
  return at + id.length <= end && id.every((b, k) => bytes[at + k] === b);
}

/** A copy of the JPEG without its EXIF (APP1) and ICC profile (APP2) segments. Nothing from the scan data on is touched. */
function withoutExifOrProfile(jpeg: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg.slice();
  const parts: Uint8Array[] = [];
  let runStart = 0;
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const end = i + 2 + ((jpeg[i + 2] << 8) | jpeg[i + 3]);
    if (end < i + 4 || end > jpeg.length) break;
    // A declared length that ends mid-data is not a segment boundary: leave every byte as it is.
    if (end !== jpeg.length && jpeg[end] !== 0xff) break;
    const drop = (marker === 0xe1 && startsWithId(jpeg, i + 4, end, EXIF_ID)) || (marker === 0xe2 && startsWithId(jpeg, i + 4, end, ICC_ID));
    if (drop) {
      parts.push(jpeg.subarray(runStart, i));
      runStart = end;
    }
    i = end;
  }
  if (runStart === 0) return jpeg.slice();
  parts.push(jpeg.subarray(runStart));
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// The recoder gets copies, so nothing it does to them can reach the document or the caller's bytes.
function sourceFor(image: Candidate): RecodeRequest['source'] | null {
  if (image.kind === 'jpeg') return { kind: 'jpeg', bytes: withoutExifOrProfile(image.stream.getContents()) };
  const channels = image.colour.grey ? 1 : 3;
  const expected = image.width * image.height * channels;
  let pixels: Uint8Array;
  try {
    pixels = decodePDFRawStream(image.stream).decode();
  } catch {
    return null;
  }
  if (pixels.length < expected) return null;
  return { kind: 'raw', bytes: pixels.length === expected ? pixels : pixels.subarray(0, expected), channels };
}

function jpegFrame(bytes: Uint8Array): JpegFrame | null {
  let i = 2; // after SOI
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // image ended or data began without a frame header
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8 || i + 10 > bytes.length) return null;
      return {
        precision: bytes[i + 4],
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * The colour space for a usable recoded JPEG: a device space to write, 'keep' for the image's own space (its
 * profile or calibration, unchanged), or null when the bytes must not replace the original.
 */
function acceptedColorSpace(out: Uint8Array, image: Candidate, target: [number, number]): PDFName | 'keep' | null {
  const n = out.length;
  if (n < 4 || out[0] !== 0xff || out[1] !== 0xd8 || out[2] !== 0xff || out[n - 2] !== 0xff || out[n - 1] !== 0xd9) return null;
  const frame = jpegFrame(out);
  if (!frame || frame.precision !== 8 || frame.width !== target[0] || frame.height !== target[1]) return null;
  const { grey, device } = image.colour;
  // Browsers write three components even for grey pixels, so a grey image may come back as RGB: three equal
  // channels in DeviceRGB show the stored grey values as DeviceGray does (a grey profile is not kept then).
  if (frame.components === 3) return grey || device ? DEVICE_RGB : 'keep';
  if (frame.components === 1 && grey) return device ? DEVICE_GRAY : 'keep';
  return null;
}

async function recodeOne(
  context: PDFContext,
  image: Candidate,
  settings: CompressSettings,
  recode: ImageRecoder,
  target: [number, number],
): Promise<Outcome> {
  const source = sourceFor(image);
  if (!source) return 'not-offered';
  let out: unknown;
  try {
    out = await recode({
      source,
      width: image.width,
      height: image.height,
      targetWidth: target[0],
      targetHeight: target[1],
      quality: settings.quality,
      grayscale: image.colour.grey,
    });
  } catch {
    return 'threw'; // this image keeps its original; the others go on
  }
  if (!(out instanceof Uint8Array) || out.length > image.stream.getContentsSize() * MAX_IMAGE_RATIO) return 'kept';
  const colorSpace = acceptedColorSpace(out, image, target);
  if (!colorSpace) return 'kept';

  // Cloning keeps entries such as /Intent, /Interpolate, /OC and /StructParent.
  const dict = image.stream.dict.clone(context);
  for (const key of STALE_KEYS) dict.delete(key);
  dict.set(WIDTH, PDFNumber.of(target[0]));
  dict.set(HEIGHT, PDFNumber.of(target[1]));
  if (colorSpace !== 'keep') dict.set(COLOR_SPACE, colorSpace);
  dict.set(BITS, PDFNumber.of(8));
  dict.set(FILTER, DCT);
  // Assigning to the same reference keeps the image shared by every page and form that uses it.
  context.assign(image.ref, PDFRawStream.of(dict, out.slice()));
  return 'replaced';
}

/** How far a pass reduces images: the resolution limit (as if each image filled its page) and the JPEG quality. */
export interface CompressSettings {
  dpi: number;
  quality: number;
}

/** What one pass over the images did. */
export interface RecodePass {
  /** Images handed to the recoder. */
  offered: number;
  /** Recoder calls that threw (those images keep their original). */
  threw: number;
  replaced: number;
  /** The lowest resolution, in dpi of its page, of an image this pass replaced; null when none was replaced. */
  lowestDpi: number | null;
}

/**
 * A document loaded once, with its images found once, that can be compressed at several settings in turn
 * (Fit to a size, compressTarget.ts) as well as at one level (compressPdf). Every pass starts from the
 * original images: `restore()` puts them back. The image decisions are the levels' own: same size rule,
 * same images left alone, same 90% rule.
 */
export interface CompressionSession {
  /** Images the pages use, recodable or not. */
  readonly imagesFound: number;
  /** Images that can be recoded. */
  readonly candidateCount: number;
  /** The stored bytes of the images that can be recoded: at most this much can be gained. */
  readonly imageBytes: number;
  /** Recodes every image that can be recoded at `settings`. `onProgress` may throw to stop. */
  recodeAll(settings: CompressSettings, recode: ImageRecoder, onProgress?: (done: number, total: number) => void): Promise<RecodePass>;
  /** Puts every original image back. */
  restore(): void;
  /**
   * Producer and Creator set to "ICAI VERA" and a new modification date (design section 5, "Document
   * properties": Compress sets both, as Merge and Split do); title, author, subject, keywords and creation
   * date stay as the source has them.
   */
  stamp(): void;
  save(): Promise<Uint8Array>;
}

/** Opens `file` for compression. Throws 'not-a-pdf' and 'encrypted' as compressPdf does. */
export async function openCompression(file: Uint8Array): Promise<CompressionSession> {
  const doc = await load(file);
  const found = collectImages(doc);
  const masks = maskRefs(doc);
  const candidates = found.map((image) => asCandidate(image, masks)).filter((c): c is Candidate => c !== null);
  return {
    imagesFound: found.length,
    candidateCount: candidates.length,
    imageBytes: candidates.reduce((sum, c) => sum + c.stream.getContentsSize(), 0),
    async recodeAll(settings, recode, onProgress) {
      let offered = 0;
      let threw = 0;
      let replaced = 0;
      let lowestDpi: number | null = null;
      onProgress?.(0, candidates.length);
      for (const [i, candidate] of candidates.entries()) {
        const target = targetSize(candidate, settings.dpi);
        const outcome = await recodeOne(doc.context, candidate, settings, recode, target);
        if (outcome !== 'not-offered') offered++;
        if (outcome === 'threw') threw++;
        if (outcome === 'replaced') {
          replaced++;
          const dpi = Math.round(Math.min(target[0] / candidate.across, target[1] / candidate.down));
          lowestDpi = lowestDpi === null ? dpi : Math.min(lowestDpi, dpi);
        }
        onProgress?.(i + 1, candidates.length);
      }
      return { offered, threw, replaced, lowestDpi };
    },
    restore() {
      // The originals were never changed: a recoded image is a new stream assigned to the same reference.
      for (const candidate of candidates) doc.context.assign(candidate.ref, candidate.stream);
    },
    stamp() {
      // Producer and Creator are ours (design section 5 lists Compress with the tools that set both; its
      // golden bytes pin it). Title, Author, Subject, Keywords and CreationDate stay as the source has them,
      // since the document is edited in place.
      doc.setProducer(APP_NAME);
      doc.setCreator(APP_NAME);
      doc.setModificationDate(new Date());
    },
    // pdf-lib's own save with object streams, its waits taken by the clock (the same bytes; pace.ts).
    save: () => savePaced(doc, { useObjectStreams: true }),
  };
}

/** For example no canvas in the packaged app: "already compact" would be the wrong thing to tell the user. */
export function allRecodesFailed(pass: RecodePass): boolean {
  return pass.offered > 0 && pass.threw === pass.offered;
}

export const recodeFailed = () => new PdfToolsError('recode-failed', 'The images in this file could not be processed, so it was not compressed.');

/**
 * Re-encodes the document's photographic images in place and re-saves it.
 *
 * `onProgress` may throw to cancel; the error then propagates and nothing is returned. Throws
 * 'recode-failed' when there were images to process and every recoder call threw.
 *
 * Known limits:
 * - Each image is sized as if it filled its page, so an image drawn larger than its page (a zoomed crop)
 *   is reduced below the level's nominal dpi.
 * - A recoder call that never settles is not timed out here; the caller's recoder must time out.
 */
export async function compressPdf(
  file: Uint8Array,
  level: CompressLevel,
  recode: ImageRecoder,
  onProgress?: (done: number, total: number) => void,
): Promise<CompressResult> {
  const settings = Object.prototype.hasOwnProperty.call(COMPRESS_LEVELS, level) ? COMPRESS_LEVELS[level] : undefined;
  if (!settings) throw new PdfToolsError('invalid-level', 'Choose a compression level.');
  const session = await openCompression(file);
  const pass = await session.recodeAll(settings, recode, onProgress);
  if (allRecodesFailed(pass)) throw recodeFailed();

  const result = { originalSize: file.length, imagesFound: session.imagesFound, imagesRecodable: session.candidateCount, imagesReplaced: pass.replaced };
  const worthReturning = (size: number) => size <= file.length * MAX_FILE_RATIO;
  // Whether anything was gained is judged before our own stamp, so that shortening a long Producer
  // string alone never passes for compression. Only the length is kept, not the bytes.
  const unstampedSize = (await session.save()).length;
  if (!worthReturning(unstampedSize)) return { ...result, bytes: null, newSize: unstampedSize };

  session.stamp();
  const saved = await session.save();
  return { ...result, bytes: worthReturning(saved.length) ? saved : null, newSize: saved.length };
}

/**
 * One pass at any settings, always returning the saved file (no "less than 1% smaller" rule): what Fit to a
 * size does at one step of its ladder, for tests and measurements. Throws as compressPdf does.
 */
export async function compressAtStep(
  file: Uint8Array,
  settings: CompressSettings,
  recode: ImageRecoder,
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; originalSize: number; imagesFound: number; imagesReplaced: number; lowestDpi: number | null }> {
  const session = await openCompression(file);
  const pass = await session.recodeAll(settings, recode, onProgress);
  if (allRecodesFailed(pass)) throw recodeFailed();
  session.stamp();
  return { bytes: await session.save(), originalSize: file.length, imagesFound: session.imagesFound, imagesReplaced: pass.replaced, lowestDpi: pass.lowestDpi };
}

/** A result is worth making only at or under this share of the original's size (the levels' "1% smaller" rule). */
export const WORTHWHILE_RATIO = MAX_FILE_RATIO;
