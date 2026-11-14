import { concatTransformationMatrix, drawObject, PDFDocument, popGraphicsState, pushGraphicsState, type PDFImage } from 'pdf-lib';
import { PdfToolsError } from './types';

export type ImagePageSize = 'fit' | 'a4-portrait' | 'a4-landscape' | 'a4-auto';
export interface ImageInput {
  bytes: Uint8Array;
  format: 'jpeg' | 'png';
  name: string;
}
export interface ImagesToPdfOptions {
  pageSize: ImagePageSize;
  marginPt: number;
}

const PRODUCER = 'ICAI VERA';
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_SIZES: readonly string[] = ['fit', 'a4-portrait', 'a4-landscape', 'a4-auto'];
const MAX_PAGE_PT = 14400; // largest page side Acrobat and similar viewers accept
const MIN_USABLE = 36; // least width and height, in points, a margin may leave for the image
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, i) => bytes[i] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function sniffImageFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'other' {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  return 'other';
}

// Only used to give a clearer message; these formats are not embedded here.
function otherFormatName(bytes: Uint8Array): string | null {
  const head = ascii(bytes, 0, 12);
  if (head.startsWith('GIF8')) return 'GIF';
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'WebP';
  if (head.startsWith('BM')) return 'BMP';
  if (head.startsWith('II*\0') || head.startsWith('MM\0*')) return 'TIFF';
  if (head.slice(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(head.slice(8))) return 'HEIC';
  return null;
}

function badImage(name: string, detail: string): PdfToolsError {
  return new PdfToolsError('bad-image', `"${name}" ${detail}`);
}

// The declared format and file name are not trusted: the bytes decide.
async function embed(doc: PDFDocument, image: ImageInput): Promise<PDFImage> {
  const format = sniffImageFormat(image.bytes);
  if (format === 'other') {
    const named = otherFormatName(image.bytes);
    throw badImage(
      image.name,
      named
        ? `is a ${named} image, which cannot be added directly. Use a JPEG or PNG instead.`
        : 'is not a JPEG or PNG image, or it is damaged.',
    );
  }
  // pdf-lib's JPEG reader does `new DataView(bytes.buffer)`, which ignores the view's offset, so a
  // subarray or pooled Buffer must be copied into a buffer of its own first.
  const { bytes } = image;
  // new Uint8Array(view) copies; Buffer#slice would only return another view.
  const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : new Uint8Array(bytes);
  let embedded: PDFImage;
  try {
    embedded = format === 'png' ? await doc.embedPng(own) : await doc.embedJpg(own);
  } catch {
    throw badImage(image.name, `could not be read as a ${format === 'png' ? 'PNG' : 'JPEG'} image. It may be damaged.`);
  }
  if (!(embedded.width > 0 && embedded.height > 0)) {
    throw badImage(image.name, 'could not be read as an image. It may be damaged.');
  }
  return embedded;
}

// Reads the EXIF Orientation tag (1-8) of a JPEG. Anything missing, truncated or out of range is 1.
function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2; // after SOI
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return 1; // image data or end: no Exif seen
    const length = view.getUint16(pos + 2);
    const start = pos + 4;
    const end = Math.min(pos + 2 + length, bytes.length);
    if (marker === 0xe1 && ascii(bytes, start, 6) === 'Exif\0\0') return tiffOrientation(view, start + 6, end);
    pos += 2 + length;
  }
  return 1;
}

function tiffOrientation(view: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const le = order === 0x4949;
  if (view.getUint16(tiff + 2, le) !== 42) return 1;
  const ifd = tiff + view.getUint32(tiff + 4, le);
  if (ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (view.getUint16(entry, le) === 0x0112) {
      if (view.getUint16(entry + 2, le) !== 3) return 1; // only SHORT is valid for Orientation
      const value = view.getUint16(entry + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

interface Transform {
  swap: boolean; // displayed width/height are the stored height/width
  // Where the stored (u right, t down, both 0..1) point lands in displayed coordinates (U right, T down):
  // U = U0 + Uu*u + Ut*t, T = T0 + Tu*u + Tt*t.
  U: [number, number, number];
  T: [number, number, number];
}

// Index = EXIF orientation. 5-8 turn the image through 90 degrees, so displayed size is swapped.
const TRANSFORMS: Transform[] = [
  { swap: false, U: [0, 1, 0], T: [0, 0, 1] }, // unused slot 0 (treated as 1)
  { swap: false, U: [0, 1, 0], T: [0, 0, 1] }, // 1 as stored
  { swap: false, U: [1, -1, 0], T: [0, 0, 1] }, // 2 mirrored left-right
  { swap: false, U: [1, -1, 0], T: [1, 0, -1] }, // 3 rotated 180
  { swap: false, U: [0, 1, 0], T: [1, 0, -1] }, // 4 mirrored top-bottom
  { swap: true, U: [0, 0, 1], T: [0, 1, 0] }, // 5 transposed
  { swap: true, U: [1, 0, -1], T: [0, 1, 0] }, // 6 rotated 90 clockwise
  { swap: true, U: [1, 0, -1], T: [1, -1, 0] }, // 7 transversed
  { swap: true, U: [0, 0, 1], T: [1, -1, 0] }, // 8 rotated 90 anticlockwise
];

function pageDimensions(size: ImagePageSize, displayW: number, displayH: number): [number, number] {
  switch (size) {
    case 'fit':
      return [displayW, displayH];
    case 'a4-portrait':
      return [A4_WIDTH, A4_HEIGHT];
    case 'a4-landscape':
      return [A4_HEIGHT, A4_WIDTH];
    case 'a4-auto':
      return displayW > displayH ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
  }
}

function checkMargin(marginPt: number, pageW: number, pageH: number): void {
  if (pageW - 2 * marginPt < MIN_USABLE || pageH - 2 * marginPt < MIN_USABLE) {
    throw new PdfToolsError('invalid-image-options', 'The margin is too large for this page size. Choose a smaller margin.');
  }
}

export async function imagesToPdf(images: ImageInput[], opts: ImagesToPdfOptions): Promise<Uint8Array> {
  if (images.length === 0) throw new PdfToolsError('no-images', 'Choose at least one image.');
  // Callers outside TypeScript can pass anything.
  if (!PAGE_SIZES.includes(opts.pageSize)) {
    throw new PdfToolsError('invalid-image-options', 'Choose a page size: fit to image, A4 portrait, A4 landscape or A4 automatic.');
  }
  if (!Number.isFinite(opts.marginPt) || opts.marginPt < 0) {
    throw new PdfToolsError('invalid-image-options', 'The margin must be zero or more.');
  }
  const margin = opts.pageSize === 'fit' ? 0 : opts.marginPt;
  const out = await PDFDocument.create({ updateMetadata: false });
  // Each entry is embedded separately, so the same image supplied twice appears twice.
  for (const input of images) {
    const image = await embed(out, input);
    const orientation = sniffImageFormat(input.bytes) === 'jpeg' ? jpegOrientation(input.bytes) : 1;
    const t = TRANSFORMS[orientation];
    const displayW = t.swap ? image.height : image.width;
    const displayH = t.swap ? image.width : image.height;
    // In fit mode the page is the image itself, shrunk if a side would pass what PDF viewers accept.
    const scale =
      opts.pageSize === 'fit'
        ? Math.min(1, MAX_PAGE_PT / Math.max(displayW, displayH))
        : (() => {
            const [pw, ph] = pageDimensions(opts.pageSize, displayW, displayH);
            checkMargin(margin, pw, ph);
            return Math.min(1, (pw - 2 * margin) / displayW, (ph - 2 * margin) / displayH);
          })();
    // Clamp: displayW * (14400 / displayW) can land one rounding step above 14400.
    const w = Math.min(MAX_PAGE_PT, displayW * scale);
    const h = Math.min(MAX_PAGE_PT, displayH * scale);
    const [pageW, pageH] = opts.pageSize === 'fit' ? [w, h] : pageDimensions(opts.pageSize, displayW, displayH);
    const x0 = (pageW - w) / 2;
    const y0 = (pageH - h) / 2;
    // Matrix mapping the image's unit square (X right, Y up) onto the displayed box. The page's
    // /Rotate entry stays 0 so later tools see an unrotated page.
    const [U0, Uu, Ut] = t.U;
    const [T0, Tu, Tt] = t.T;
    const page = out.addPage([pageW, pageH]);
    const xObject = page.node.newXObject('Image', image.ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(w * Uu, -h * Tu, -w * Ut, h * Tt, x0 + w * (U0 + Ut), y0 + h * (1 - T0 - Tt)),
      drawObject(xObject),
      popGraphicsState(),
    );
  }
  const now = new Date();
  out.setProducer(PRODUCER);
  out.setCreator(PRODUCER);
  out.setCreationDate(now);
  out.setModificationDate(now);
  return out.save({ useObjectStreams: true });
}
