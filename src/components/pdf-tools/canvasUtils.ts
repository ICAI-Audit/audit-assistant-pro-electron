// Small helpers shared by the page renderer and the image recoder. Every canvas made here is
// released with releaseCanvas as soon as its pixels have been encoded, so large pages do not
// keep hundreds of megabytes alive until garbage collection.
import { PdfToolsError } from '@/lib/pdf-tools/types';

export const MAX_CANVAS_SIDE = 8192;
export const MAX_CANVAS_AREA = 50_000_000;

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The browser could not make the picture of a page: in practice memory ran short. */
export const OUT_OF_MEMORY = 'out-of-memory';
/** The canvas gave no image (toBlob returned null, convertToBlob failed): usually memory, too. */
export const IMAGE_ENCODE_FAILED = 'image-encode-failed';

const looksLikeMemory = (error: unknown) =>
  error instanceof RangeError || (error instanceof Error && /out of memory|allocation failed|allocate/i.test(error.message));

/**
 * A failure while drawing or copying a picture, with its own code when it is a lack of memory.
 * Anything else (a cancel, our own errors) is returned unchanged.
 */
export function drawingFailure(error: unknown): unknown {
  if (error instanceof PdfToolsError) return error;
  if (looksLikeMemory(error)) return new PdfToolsError(OUT_OF_MEMORY, 'There was not enough memory to draw this page.');
  return error;
}

export async function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  const failed = () => new PdfToolsError(IMAGE_ENCODE_FAILED, 'The page image could not be encoded.');
  if ('convertToBlob' in canvas) {
    try {
      return await canvas.convertToBlob({ type, quality });
    } catch {
      throw failed();
    }
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(failed())), type, quality);
  });
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  try {
    return new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    throw drawingFailure(error);
  }
}

export function releaseCanvas(canvas: AnyCanvas | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * The largest scale, at most `wanted`, at which a box of width x height stays within the canvas
 * limits. Returns the scale and whether it had to be reduced.
 */
export function fitScale(width: number, height: number, wanted: number): { scale: number; reduced: boolean } {
  let scale = wanted;
  if (width * scale > MAX_CANVAS_SIDE) scale = MAX_CANVAS_SIDE / width;
  if (height * scale > MAX_CANVAS_SIDE) scale = MAX_CANVAS_SIDE / height;
  if (width * scale * height * scale > MAX_CANVAS_AREA) scale = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  return { scale, reduced: scale < wanted };
}

export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Resolves after the next frame has painted, so that a busy message shows before slow work on
 * the main thread. Hidden windows get no frames, so a timer also ends the wait.
 */
export function nextPaint(fallbackMs = 100): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, fallbackMs);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(finish, 0));
  });
}
