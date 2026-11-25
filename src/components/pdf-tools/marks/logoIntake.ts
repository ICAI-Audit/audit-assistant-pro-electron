// The logo of the Watermark tool: an image already in the working list (design 5.16), so it went
// through the same intake as every file (engagement scope, size limits; WebP, BMP and GIF already
// turned into PNG there). Before the marks library gets it, it is made ready here:
//
// - a JPEG is turned upright by its EXIF orientation (PDF readers ignore it; the library does not
//   apply it), and a CMYK JPEG becomes RGB (embedded as CMYK its colours shift, spike-stamps 2.4);
// - anything above 1,600 px on its long side is redrawn at 1,200 px (a 6000 x 4000 PNG took 14 s
//   to embed as it was in the trial); a PNG stays a PNG so its transparency is kept.
//
// The redraw decodes with createImageBitmap from a Blob (decoded, turned and resized off the main
// thread by the browser) and encodes with an OffscreenCanvas's convertToBlob, so the dialog never
// waits on a long step. Nothing is stored: the prepared bytes live in the dialog's state only.
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { blobBytes, canvasToBlob, createCanvas, releaseCanvas } from '../canvasUtils';

export const LOGO_LIMITS = { longSide: 1600, target: 1200 } as const;
/** The preview's copy: the page is drawn at 100 to 300 dpi, where a logo of 18% of A4 is under 450 px wide. */
export const PREVIEW_LOGO_LIMITS = { longSide: 480, target: 480 } as const;

const NOT_AN_IMAGE = 'Choose a PNG or JPG image for the logo.';
const UNREADABLE = 'This image could not be read. It may be damaged.';

export interface LogoInfo {
  format: 'png' | 'jpeg' | 'other';
  /** As stored, before any EXIF turn. */
  width: number;
  height: number;
  /** EXIF orientation 1-8 (JPEG only; 1 is upright). */
  orientation: number;
  /** A four-component (CMYK or YCCK) JPEG. */
  cmyk: boolean;
}

const OTHER: LogoInfo = { format: 'other', width: 0, height: 0, orientation: 1, cmyk: false };
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

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

/** A JPEG's frame size, components and EXIF orientation, read from its markers (as imagesToPdf.ts reads the orientation). */
function inspectJpeg(bytes: Uint8Array): LogoInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let orientation = 1;
  let pos = 2;
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(pos + 2);
    if (length < 2) break;
    const start = pos + 4;
    const end = Math.min(pos + 2 + length, bytes.length);
    if (marker === 0xe1 && ascii(bytes, start, 6) === 'Exif\0\0') orientation = tiffOrientation(view, start + 6, end);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (start + 6 > bytes.length) break;
      const height = view.getUint16(start + 1);
      const width = view.getUint16(start + 3);
      const components = bytes[start + 5];
      if (!(width > 0 && height > 0)) break;
      return { format: 'jpeg', width, height, orientation, cmyk: components === 4 };
    }
    pos += 2 + length;
  }
  return OTHER;
}

/** What the logo's bytes are, from their header only (nothing is decoded). */
export function inspectLogo(bytes: Uint8Array): LogoInfo {
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && ascii(bytes, 12, 4) === 'IHDR') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { format: 'png', width, height, orientation: 1, cmyk: false } : OTHER;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return inspectJpeg(bytes);
  return OTHER;
}

export type LogoChange = 'large' | 'turned' | 'cmyk';
export type LogoPlan =
  | { kind: 'as-is'; format: 'png' | 'jpeg'; width: number; height: number }
  | { kind: 'redraw'; format: 'png' | 'jpeg'; width: number; height: number; reasons: LogoChange[] }
  | { kind: 'refuse'; message: string };

/** What must be done to the logo before it is placed; `width` and `height` are as it will be seen (upright). */
export function logoPlan(info: LogoInfo, limits: { longSide: number; target: number } = LOGO_LIMITS): LogoPlan {
  if (info.format === 'other') return { kind: 'refuse', message: NOT_AN_IMAGE };
  const turned = info.format === 'jpeg' && info.orientation !== 1;
  const sideways = turned && info.orientation >= 5;
  let width = sideways ? info.height : info.width;
  let height = sideways ? info.width : info.height;
  const reasons: LogoChange[] = [];
  const long = Math.max(width, height);
  if (long > limits.longSide) {
    const scale = limits.target / long;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    reasons.push('large');
  }
  if (turned) reasons.push('turned');
  if (info.cmyk) reasons.push('cmyk');
  return reasons.length === 0 ? { kind: 'as-is', format: info.format, width, height } : { kind: 'redraw', format: info.format, width, height, reasons };
}

/** A decoded picture: upright, at the size asked for when the decoder could. */
export interface DecodedLogo {
  width: number;
  height: number;
  close(): void;
}

export interface LogoDeps {
  /** Decodes the bytes upright (EXIF applied), resized towards `size`. */
  decode(bytes: Uint8Array, mimeType: string, size: { width: number; height: number }): Promise<DecodedLogo>;
  /** Draws the picture at `size` and encodes it (a JPEG on white). */
  encode(image: DecodedLogo, size: { width: number; height: number }, format: 'png' | 'jpeg'): Promise<Uint8Array>;
}

export interface PreparedLogo {
  image: Uint8Array;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  /** What was done to it (empty: used as it was). */
  changed: LogoChange[];
}

/** A logo that cannot be used, with a message that can be shown as it is. */
export class LogoError extends Error {}

/** The logo's bytes made ready for the library, or a rejection whose message can be shown as it is. */
export async function prepareLogo(bytes: Uint8Array, deps: LogoDeps, limits: { longSide: number; target: number } = LOGO_LIMITS): Promise<PreparedLogo> {
  const plan = logoPlan(inspectLogo(bytes), limits);
  if (plan.kind === 'refuse') throw new LogoError(plan.message);
  if (plan.kind === 'as-is') return { image: bytes, format: plan.format, width: plan.width, height: plan.height, changed: [] };
  let decoded: DecodedLogo;
  try {
    decoded = await deps.decode(bytes, plan.format === 'png' ? 'image/png' : 'image/jpeg', { width: plan.width, height: plan.height });
  } catch {
    throw new LogoError(UNREADABLE);
  }
  try {
    // The picture's own shape decides: a decoder that turned it differently from the plan must not stretch it.
    const long = Math.max(plan.width, plan.height);
    const scale = long / Math.max(decoded.width, decoded.height);
    const size = { width: Math.max(1, Math.round(decoded.width * scale)), height: Math.max(1, Math.round(decoded.height * scale)) };
    const image = await deps.encode(decoded, size, plan.format);
    return { image, format: plan.format, width: size.width, height: size.height, changed: plan.reasons };
  } catch (error) {
    if (error instanceof LogoError) throw error;
    throw new LogoError('This image could not be made ready. It may be too large for the memory available.');
  } finally {
    decoded.close();
  }
}

const JPEG_QUALITY = 0.92;

/** The browser's decoder and canvas. */
export const browserLogoDeps: LogoDeps = {
  async decode(bytes, mimeType, size) {
    if (typeof createImageBitmap !== 'function') throw new Error('This window cannot decode images.');
    return createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }), {
      imageOrientation: 'from-image',
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high',
    });
  },
  async encode(image, size, format) {
    const canvas = createCanvas(size.width, size.height);
    try {
      const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (!context) throw new Error('No drawing surface is available.');
      if (format === 'jpeg') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, size.width, size.height);
      }
      context.imageSmoothingQuality = 'high';
      context.drawImage(image as ImageBitmap, 0, 0, size.width, size.height);
      const blob = await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpeg' ? JPEG_QUALITY : undefined);
      return await blobBytes(blob);
    } finally {
      releaseCanvas(canvas);
    }
  },
};

export interface LogoCandidate {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

/** The working list's PNG and JPG images, in list order: the logos a user can choose. */
export function logoCandidates(files: readonly WorkingFile[]): LogoCandidate[] {
  return files
    .filter((f) => f.kind === 'image' && (f.mimeType === 'image/png' || f.mimeType === 'image/jpeg'))
    .map((f) => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType }));
}
