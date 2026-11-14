// The browser implementation of compress.ts's ImageRecoder: decode, resize to exactly the
// requested size, and encode as JPEG, all in the renderer.
//
// PDF viewers draw an image's stored pixels as plain device RGB or grey, ignoring EXIF
// orientation and ICC profiles, so the decode must do the same: imageOrientation 'none' and
// colorSpaceConversion 'none' (JPEG sources also arrive with those segments stripped). JPEG has
// no transparency, so the canvas is painted white before the image is drawn.
import type { ImageRecoder, RecodeRequest } from '@/lib/pdf-tools/compress';
import { blobBytes, canvasToBlob, createCanvas, MAX_CANVAS_SIDE, releaseCanvas, type AnyCanvas } from './canvasUtils';

export const RECODE_TIMEOUT_MS = 30_000;
// Larger sources are left as they are rather than risk running the renderer out of memory
// (a raw source is expanded to RGBA, 4 bytes a pixel, before decoding).
const MAX_SOURCE_PIXELS = 64_000_000;

const DECODE_OPTIONS: ImageBitmapOptions = {
  imageOrientation: 'none',
  colorSpaceConversion: 'none',
  premultiplyAlpha: 'none',
};

function isWholePositive(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/** Whether a request can be served at all; anything else is answered with null (keep the original). */
export function validRecodeRequest(req: RecodeRequest): boolean {
  const { width, height, targetWidth, targetHeight, quality, source } = req;
  if (![width, height, targetWidth, targetHeight].every(isWholePositive)) return false;
  if (targetWidth > width || targetHeight > height) return false;
  if (targetWidth > MAX_CANVAS_SIDE || targetHeight > MAX_CANVAS_SIDE) return false;
  if (width * height > MAX_SOURCE_PIXELS) return false;
  if (!(quality > 0 && quality <= 1)) return false;
  if (source.kind === 'raw') return source.bytes.length >= width * height * source.channels;
  return source.bytes.length > 0;
}

/** Raw 8-bit grey or RGB samples, as stored in the PDF, to opaque RGBA. */
function toImageData(bytes: Uint8Array, width: number, height: number, channels: 1 | 3): ImageData {
  const pixels = width * height;
  const rgba = new Uint8ClampedArray(pixels * 4);
  if (channels === 1) {
    for (let i = 0, o = 0; i < pixels; i++, o += 4) {
      const v = bytes[i];
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  } else {
    for (let i = 0, s = 0, o = 0; i < pixels; i++, s += 3, o += 4) {
      rgba[o] = bytes[s];
      rgba[o + 1] = bytes[s + 1];
      rgba[o + 2] = bytes[s + 2];
      rgba[o + 3] = 255;
    }
  }
  return new ImageData(rgba, width, height);
}

/** null when the browser cannot decode the source: that image is left as it is. */
async function decode(req: RecodeRequest): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') throw new Error('This window cannot decode images.');
  const resize: ImageBitmapOptions = {
    ...DECODE_OPTIONS,
    resizeWidth: req.targetWidth,
    resizeHeight: req.targetHeight,
    resizeQuality: 'high',
  };
  const source =
    req.source.kind === 'jpeg'
      ? new Blob([req.source.bytes as BlobPart], { type: 'image/jpeg' })
      : toImageData(req.source.bytes, req.width, req.height, req.source.channels);
  try {
    return await createImageBitmap(source, resize);
  } catch {
    return null;
  }
}

async function recode(req: RecodeRequest, isAbandoned: () => boolean): Promise<Uint8Array | null> {
  if (!validRecodeRequest(req)) return null;
  const bitmap = await decode(req);
  if (!bitmap) return null;
  let canvas: AnyCanvas | null = null;
  try {
    // The cases below are failures of the window, not of the image, so they throw: compress.ts
    // then reports that images could not be processed instead of calling the file already compact.
    if (bitmap.width !== req.targetWidth || bitmap.height !== req.targetHeight) {
      throw new Error('The image was not resized to the requested size.');
    }
    if (isAbandoned()) return null;
    canvas = createCanvas(req.targetWidth, req.targetHeight);
    const context = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error('No drawing surface is available.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, req.targetWidth, req.targetHeight);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvasToBlob(canvas, 'image/jpeg', req.quality);
    releaseCanvas(canvas);
    canvas = null;
    if (blob.type !== 'image/jpeg') throw new Error('JPEG encoding is not available.');
    return await blobBytes(blob);
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}

/**
 * Re-encodes one PDF image as a JPEG of exactly targetWidth x targetHeight. Returns null when the
 * source cannot be decoded or the request is out of range (the original is then kept); rejects when
 * the window cannot draw or encode, and after RECODE_TIMEOUT_MS.
 * Grey sources come back as three equal channels, which compress.ts accepts as DeviceRGB.
 */
export const browserImageRecoder: ImageRecoder = (req) => {
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abandoned = true;
      reject(new Error('Re-encoding this image took too long.'));
    }, RECODE_TIMEOUT_MS);
  });
  return Promise.race([recode(req, () => abandoned), timeout]).finally(() => clearTimeout(timer));
};
