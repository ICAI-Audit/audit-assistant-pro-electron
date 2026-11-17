// Redact (design 5.9 "Output", "Remove or Replace"): a page's pixels with the redaction boxes burned
// in, made into the picture the build places on the rebuilt page.
//
// Pixels are RGBA, row by row from the top, as a canvas's getImageData gives them, of the page drawn
// with rotation 0 (its own /Rotate ignored: the build keeps /Rotate on the rebuilt page), so user
// space +x is pixel +x and user space +y is pixel -y. A user-space Rect becomes pixels through the
// drawing's transform (the viewer's single mapping, pageGeometry.ts, with no turn), floored and ceiled
// outward: a box never loses a partly covered pixel.
//
// The rules here, in order, for every page: grow each text box until no end cuts glyph ink (R1's
// growPastInk, along the text only, past rules); fill every box black; check every pixel of every box is black (a box that is not wholly
// black is a failure, never a warning); then draw the replacements, each clipped to its own box
// (white on black, so it can never show what was under it); then encode, losslessly (Flate, grey when
// the page has no colour) and as JPEG 0.85, keeping the smaller. The Flate data is exactly
// width x height x components bytes before compression (the build does not inflate it to count).
//
// Confidentiality: the pixels are the page itself. Nothing here logs, names or keeps them; the caller
// drops its reference once the picture is encoded.
import { growPastInk, textAxis, type InkGrowth, type PixelBox, type Rect } from '@/lib/pdf-tools/pageText';
import type { PagePicture } from '@/lib/pdf-tools/redactBuild';
import { runAtOnce, runPaced, type Pace, type Work } from '@/lib/pdf-tools/pace';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { cssToPdf, pdfToCss, type Matrix } from '../viewer/pageGeometry';

export interface PagePixels {
  /** RGBA, width x height x 4 bytes, rows from the top. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The picture could not be made exactly as the build needs it: nothing of it is used. */
export const pictureFailed = () => new PdfToolsError('render-failed', 'A page could not be drawn for redaction. Nothing was added. Try again; if it fails again, restart the application.');

// ---- user space and pixels ----------------------------------------------------------------------------

/** A user-space rectangle as whole pixels of the drawing (outward), clipped to it; null when nothing of it is on the drawing. */
export function toPixelBox(m: Matrix, rect: Rect, width: number, height: number): PixelBox | null {
  const corners = [pdfToCss(m, rect.x0, rect.y0), pdfToCss(m, rect.x1, rect.y0), pdfToCss(m, rect.x0, rect.y1), pdfToCss(m, rect.x1, rect.y1)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  // A hair of tolerance so a box edge that falls exactly on a pixel boundary (after floating error) does not take a whole extra pixel.
  const left = Math.max(0, Math.floor(Math.min(...xs) + 1e-6));
  const top = Math.max(0, Math.floor(Math.min(...ys) + 1e-6));
  const right = Math.min(width, Math.ceil(Math.max(...xs) - 1e-6));
  const bottom = Math.min(height, Math.ceil(Math.max(...ys) - 1e-6));
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** Pixels back to a user-space rectangle (the build and the text layer work in user space). */
export function toUserRect(m: Matrix, box: PixelBox): Rect {
  const corners = [cssToPdf(m, box.left, box.top), cssToPdf(m, box.right, box.top), cssToPdf(m, box.left, box.bottom), cssToPdf(m, box.right, box.bottom)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Grows a text box with R1's growPastInk until neither end along its text cuts glyph ink, at most
 * `maxGrowPx` at each end. It grows along the text only (never into the lines above and below: a box's
 * height comes from the font, padded by `padPx`) and does not follow rules (underlines, table rules),
 * which it tells from glyphs. The drawing is made with rotation 0, so the text's axis is its angle's.
 * `hitLimit` true: glyph ink still runs on past the limit; the caller widens the box to what certainly
 * holds the value.
 */
export function growAlong(px: PagePixels, box: PixelBox, angle: number, maxGrowPx: number, padPx: number): InkGrowth {
  return growPastInk(px.data, px.width, px.height, box, { maxGrowPx, along: textAxis(angle, 0), padPx });
}

// ---- burning and checking ------------------------------------------------------------------------------

/** Fills a box with opaque black. */
export function fillBlack(px: PagePixels, box: PixelBox): void {
  for (let y = Math.max(0, box.top); y < Math.min(px.height, box.bottom); y++) {
    const row = y * px.width;
    for (let x = Math.max(0, box.left); x < Math.min(px.width, box.right); x++) {
      const i = (row + x) * 4;
      px.data[i] = 0;
      px.data[i + 1] = 0;
      px.data[i + 2] = 0;
      px.data[i + 3] = 255;
    }
  }
}

/** True when every pixel of the box is opaque black: the box hides everything under it. */
export function isBlack(px: PagePixels, box: PixelBox): boolean {
  for (let y = box.top; y < box.bottom; y++) {
    const row = y * px.width;
    for (let x = box.left; x < box.right; x++) {
      const i = (row + x) * 4;
      if (px.data[i] !== 0 || px.data[i + 1] !== 0 || px.data[i + 2] !== 0 || px.data[i + 3] !== 255) return false;
    }
  }
  return true;
}

/**
 * Copies a rendered replacement (RGBA of the box's own size: white text on black) into the page at the
 * box. Only pixels inside the box are written, and only from the black-and-white drawing, so nothing of
 * the page under the box can come back.
 */
export function pasteInto(px: PagePixels, box: PixelBox, rgba: Uint8ClampedArray): void {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  if (rgba.length !== w * h * 4) throw pictureFailed();
  for (let y = 0; y < h; y++) {
    const to = ((box.top + y) * px.width + box.left) * 4;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Grey levels only (anti-aliased white on black), fully opaque.
      const v = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
      px.data[to + x * 4] = v;
      px.data[to + x * 4 + 1] = v;
      px.data[to + x * 4 + 2] = v;
      px.data[to + x * 4 + 3] = 255;
    }
  }
}

/**
 * The pixel boxes of the pixels `on` marks, joined into blocks of touching `cell`-sized squares (where
 * a drawing paints, as the proof and the placer measure it).
 */
export function markedBlocks(width: number, height: number, cell: number, on: (pixel: number) => boolean): PixelBox[] {
  const cw = Math.ceil(width / cell);
  const ch = Math.ceil(height / cell);
  const bounds = new Int32Array(cw * ch * 4).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!on(y * width + x)) continue;
      const c = (Math.floor(y / cell) * cw + Math.floor(x / cell)) * 4;
      if (bounds[c] < 0) {
        bounds[c] = x;
        bounds[c + 1] = y;
        bounds[c + 2] = x + 1;
        bounds[c + 3] = y + 1;
      } else {
        bounds[c] = Math.min(bounds[c], x);
        bounds[c + 1] = Math.min(bounds[c + 1], y);
        bounds[c + 2] = Math.max(bounds[c + 2], x + 1);
        bounds[c + 3] = Math.max(bounds[c + 3], y + 1);
      }
    }
  }
  return joinCells(bounds, cw, ch, width, height);
}

/** The cells' bounds (`bounds`, four numbers a cell, -1 when empty) joined into blocks of touching cells. */
function joinCells(bounds: Int32Array, cw: number, ch: number, width: number, height: number): PixelBox[] {
  const boxes: PixelBox[] = [];
  const done = new Uint8Array(cw * ch);
  for (let first = 0; first < cw * ch; first++) {
    if (done[first] || bounds[first * 4] < 0) continue;
    const box = { left: width, top: height, right: 0, bottom: 0 };
    const stack = [first];
    done[first] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      box.left = Math.min(box.left, bounds[c * 4]);
      box.top = Math.min(box.top, bounds[c * 4 + 1]);
      box.right = Math.max(box.right, bounds[c * 4 + 2]);
      box.bottom = Math.max(box.bottom, bounds[c * 4 + 3]);
      const cx = c % cw;
      const cy = Math.floor(c / cw);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const n = ny * cw + nx;
          if (done[n] || bounds[n * 4] < 0) continue;
          done[n] = 1;
          stack.push(n);
        }
      }
    }
    boxes.push(box);
  }
  return boxes;
}

/** True when two RGBA drawings differ at a pixel. */
export const pixelDiffers = (a: Uint8ClampedArray, b: Uint8ClampedArray, pixel: number) => {
  const i = pixel * 4;
  return a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
};

/**
 * `markedBlocks` of the pixels where two RGBA drawings of one size differ and `skip` (one byte a pixel, may be
 * absent) is 0: the same blocks, found without a call per pixel (a 200 dpi page is 4 million pixels; the call
 * per pixel took 0.5 to 1 s a page: wave 2b). Pixels are compared four bytes at a time when the data allow it.
 */
export function differingBlocks(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number, cell: number, skip?: Uint8Array): PixelBox[] {
  return runAtOnce(differingWork(a, b, width, height, cell, skip));
}

/**
 * `differingBlocks`, a band of rows at a time with a turn for the window between bands when one is due
 * (Ruling D, wave 3b: the first page's pass over 4 million pixels, before the engine has compiled the loop,
 * held the window 0.6 s in the application). The same blocks.
 */
export function differingBlocksPaced(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number, cell: number, skip: Uint8Array | undefined, pace: Pace): Promise<PixelBox[]> {
  return runPaced(differingWork(a, b, width, height, cell, skip), pace);
}

/** Rows a band of the pixel passes covers between two chances of a turn. */
const BAND_ROWS = 64;

function* differingWork(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number, cell: number, skip?: Uint8Array): Work<PixelBox[]> {
  const n = width * height;
  if (a.length < n * 4 || b.length < n * 4 || (skip && skip.length < n)) throw pictureFailed();
  const cw = Math.ceil(width / cell);
  const ch = Math.ceil(height / cell);
  const bounds = new Int32Array(cw * ch * 4).fill(-1);
  const column = new Int32Array(width);
  for (let x = 0; x < width; x++) column[x] = Math.floor(x / cell);
  // One flag a pixel: it differs (four bytes at a time where the data start on a four-byte boundary).
  const differs = new Uint8Array(n);
  const aligned = a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0;
  const a32 = aligned ? new Uint32Array(a.buffer, a.byteOffset, n) : null;
  const b32 = aligned ? new Uint32Array(b.buffer, b.byteOffset, n) : null;
  for (let y0 = 0; y0 < height; y0 += BAND_ROWS) {
    const y1 = Math.min(height, y0 + BAND_ROWS);
    const [p0, p1] = [y0 * width, y1 * width];
    if (a32 && b32) {
      for (let p = p0; p < p1; p++) if (a32[p] !== b32[p]) differs[p] = 1;
    } else {
      for (let p = p0; p < p1; p++) if (pixelDiffers(a, b, p)) differs[p] = 1;
    }
    if (skip) for (let p = p0; p < p1; p++) if (skip[p] !== 0) differs[p] = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      const rowCells = Math.floor(y / cell) * cw;
      for (let x = 0; x < width; x++) {
        if (differs[row + x] === 0) continue;
        const c = (rowCells + column[x]) * 4;
        if (bounds[c] < 0) {
          bounds[c] = x;
          bounds[c + 1] = y;
          bounds[c + 2] = x + 1;
          bounds[c + 3] = y + 1;
        } else {
          if (x < bounds[c]) bounds[c] = x;
          if (x + 1 > bounds[c + 2]) bounds[c + 2] = x + 1;
          bounds[c + 3] = y + 1;
        }
      }
    }
    yield;
  }
  return joinCells(bounds, cw, ch, width, height);
}

// ---- replacements -----------------------------------------------------------------------------------------

/** The smallest replacement drawn, in points (design 5.9): below it the box stays plain black. */
export const REPLACEMENT_MIN_PT = 4;
/** A replacement is at most this share of the box's height (across the text). */
export const REPLACEMENT_MAX_SHARE = 0.7;
/** Space kept clear at each end of the box, in points. */
export const REPLACEMENT_END_PT = 1;

/**
 * The font size (px) of a replacement in a box `lengthPx` along the text and `thickPx` across it: the
 * largest bold size up to 70% of the box's height that fits its length, not below 4 pt; null when it
 * does not fit (the box stays plain black, and the result says how many). `advancePerPx` is the
 * replacement's width at a 1 px font size.
 */
export function replacementSize(advancePerPx: number, lengthPx: number, thickPx: number, pxPerPt: number): number | null {
  if (!(advancePerPx > 0) || !(lengthPx > 0) || !(thickPx > 0) || !(pxPerPt > 0)) return null;
  const room = lengthPx - 2 * REPLACEMENT_END_PT * pxPerPt;
  const size = Math.min(REPLACEMENT_MAX_SHARE * thickPx, room / advancePerPx);
  return size >= REPLACEMENT_MIN_PT * pxPerPt ? size : null;
}

// ---- encoding ------------------------------------------------------------------------------------------------

/** True when every pixel has equal red, green and blue: the page is stored grey, without loss. */
export function isGrey(px: PagePixels): boolean {
  return runAtOnce(greyWork(px));
}

function* greyWork(px: PagePixels): Work<boolean> {
  const d = px.data;
  const step = Math.max(4, BAND_ROWS * px.width * 4);
  for (let from = 0; from < d.length; from += step) {
    const to = Math.min(d.length, from + step);
    for (let i = from; i < to; i += 4) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false;
    yield;
  }
  return true;
}

/** The samples the build's image holds: one byte a pixel (grey) or three (RGB), rows from the top, no padding. */
export function samplesOf(px: PagePixels, grey: boolean): Uint8Array {
  return runAtOnce(samplesWork(px, grey));
}

function* samplesWork(px: PagePixels, grey: boolean): Work<Uint8Array> {
  const n = px.width * px.height;
  if (px.data.length !== n * 4) throw pictureFailed();
  const out = new Uint8Array(n * (grey ? 1 : 3));
  const d = px.data;
  const band = Math.max(1, BAND_ROWS * px.width);
  for (let p0 = 0; p0 < n; p0 += band) {
    const p1 = Math.min(n, p0 + band);
    if (grey) {
      for (let p = p0, i = p0 * 4; p < p1; p++, i += 4) out[p] = d[i];
    } else {
      for (let p = p0, i = p0 * 4, o = p0 * 3; p < p1; p++, i += 4, o += 3) {
        out[o] = d[i];
        out[o + 1] = d[i + 1];
        out[o + 2] = d[i + 2];
      }
    }
    yield;
  }
  return out;
}

/** Width, height and colour components of a JPEG's frame; null when the bytes are not a JPEG with a frame. */
export function jpegFrame(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
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
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 >= bytes.length) return null;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + length;
  }
  return null;
}

const isZlib = (bytes: Uint8Array) => bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8) | bytes[1]) % 31 === 0;

export interface PictureCodecs {
  /** zlib (RFC 1950) compression of the samples: CompressionStream('deflate') in the application. */
  deflate(samples: Uint8Array): Promise<Uint8Array>;
  /** The page as a JPEG of quality 0.85; absent where no encoder exists (the lossless picture is used). */
  jpeg?(px: PagePixels): Promise<Uint8Array>;
}

/** The JPEG quality of design 5.9. */
export const JPEG_QUALITY = 0.85;
/** Lossless bytes a pixel above which JPEG is tried as well (text pages stay well below it). */
export const JPEG_WORTH_TRYING = 0.15;

/**
 * The page's picture for the build: Flate of the exact samples (grey when the page has no colour) and,
 * when an encoder is given, a JPEG of the same pixels; the smaller is kept. Every picture handed over
 * holds exactly width x height pixels: the samples are counted before compression, and a JPEG's frame
 * must state the drawing's size (a JPEG that fails is simply not used).
 */
export async function encodePagePicture(px: PagePixels, codecs: PictureCodecs, pace?: Pace): Promise<PagePicture> {
  const { width, height } = px;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || px.data.length !== width * height * 4) throw pictureFailed();
  // With a pacer, the passes over the pixels give the window its turns (Ruling D, wave 3b).
  const grey = pace ? await runPaced(greyWork(px), pace) : isGrey(px);
  const samples = pace ? await runPaced(samplesWork(px, grey), pace) : samplesOf(px, grey);
  if (samples.length !== width * height * (grey ? 1 : 3)) throw pictureFailed();
  let flate: Uint8Array;
  try {
    flate = await codecs.deflate(samples);
  } catch {
    throw pictureFailed();
  }
  if (!isZlib(flate)) throw pictureFailed();
  const lossless: PagePicture = { bytes: flate, widthPx: width, heightPx: height, encoding: grey ? 'flate-gray' : 'flate-rgb' };
  // A page of text compresses to well under a tenth of a byte a pixel losslessly, and JPEG does not beat
  // that (trial: text pages always came out Flate): JPEG is tried only for pictures (scans, photos).
  if (!codecs.jpeg || flate.length < JPEG_WORTH_TRYING * width * height) return lossless;
  let jpeg: Uint8Array | null = null;
  try {
    jpeg = await codecs.jpeg(px);
  } catch {
    jpeg = null;
  }
  const frame = jpeg ? jpegFrame(jpeg) : null;
  if (!jpeg || !frame || frame.width !== width || frame.height !== height || (frame.components !== 1 && frame.components !== 3)) return lossless;
  return jpeg.length < flate.length ? { bytes: jpeg, widthPx: width, heightPx: height, encoding: 'jpeg' } : lossless;
}

/**
 * zlib compression with the browser's CompressionStream, fed in slices so that a large page does not hold
 * the window for the whole of it.
 */
export async function deflateInBrowser(samples: Uint8Array, slice = 1 << 18): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reading = new Response(stream.readable).arrayBuffer();
  for (let at = 0; at < samples.length; at += slice) {
    await writer.ready;
    await writer.write(samples.subarray(at, Math.min(samples.length, at + slice)) as Uint8Array<ArrayBuffer>);
  }
  await writer.close();
  return new Uint8Array(await reading);
}
