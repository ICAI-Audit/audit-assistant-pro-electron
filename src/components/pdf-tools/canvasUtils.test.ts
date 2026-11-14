import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { blobBytes, canvasToBlob, drawingFailure, fitScale, IMAGE_ENCODE_FAILED, MAX_CANVAS_AREA, MAX_CANVAS_SIDE, nextPaint, OUT_OF_MEMORY } from './canvasUtils';

describe('drawing failures get their own codes', () => {
  it('a canvas that gives no image is an encoding failure, not a damaged file', async () => {
    const canvas = { toBlob: (done: (blob: Blob | null) => void) => done(null) } as unknown as HTMLCanvasElement;
    await expect(canvasToBlob(canvas, 'image/png')).rejects.toMatchObject({ name: 'PdfToolsError', code: IMAGE_ENCODE_FAILED });
  });

  it('an OffscreenCanvas that cannot encode is an encoding failure too', async () => {
    const canvas = { convertToBlob: async () => Promise.reject(new DOMException('Out of memory', 'EncodingError')) } as unknown as OffscreenCanvas;
    await expect(canvasToBlob(canvas, 'image/png')).rejects.toMatchObject({ code: IMAGE_ENCODE_FAILED });
  });

  it('memory running out while copying the image is reported as such', async () => {
    const blob = { arrayBuffer: async () => Promise.reject(new RangeError('Array buffer allocation failed')) } as unknown as Blob;
    await expect(blobBytes(blob)).rejects.toMatchObject({ code: OUT_OF_MEMORY });
  });

  it('classifies a failure while drawing', () => {
    expect(drawingFailure(new RangeError('Array buffer allocation failed'))).toMatchObject({ code: OUT_OF_MEMORY });
    expect(drawingFailure(new Error('Out of memory'))).toMatchObject({ code: OUT_OF_MEMORY });
    const own = new PdfToolsError('render-unavailable', 'x');
    expect(drawingFailure(own)).toBe(own);
    const abort = new DOMException('cancelled', 'AbortError');
    expect(drawingFailure(abort)).toBe(abort); // a cancel stays a cancel
    const other = new TypeError('something else');
    expect(drawingFailure(other)).toBe(other);
  });
});

describe('fitScale', () => {
  it('keeps the wanted scale when the canvas fits', () => {
    expect(fitScale(595, 842, 300 / 72)).toEqual({ scale: 300 / 72, reduced: false });
  });

  it('caps the longer side at 8192 px', () => {
    const { scale, reduced } = fitScale(5000, 100, 2);
    expect(reduced).toBe(true);
    expect(5000 * scale).toBeCloseTo(MAX_CANVAS_SIDE, 6);
    const tall = fitScale(100, 9000, 1);
    expect(9000 * tall.scale).toBeCloseTo(MAX_CANVAS_SIDE, 6);
  });

  it('caps the area at 50 megapixels', () => {
    const { scale, reduced } = fitScale(8000, 8000, 1);
    expect(reduced).toBe(true);
    expect(8000 * scale * 8000 * scale).toBeLessThanOrEqual(MAX_CANVAS_AREA * 1.000001);
  });

  it('never returns a canvas over either limit', () => {
    for (const [w, h, s] of [[14400, 14400, 300 / 72], [2384, 3370, 300 / 72], [100000, 50, 1], [612, 792, 0.5]]) {
      const { scale } = fitScale(w, h, s);
      expect(Math.floor(w * scale)).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
      expect(Math.floor(h * scale)).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
      expect(Math.floor(w * scale) * Math.floor(h * scale)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    }
  });
});

describe('nextPaint', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits for a frame when frames run', async () => {
    const frame = vi.fn((cb: () => void) => setTimeout(cb, 1));
    vi.stubGlobal('requestAnimationFrame', frame);
    await nextPaint();
    expect(frame).toHaveBeenCalled();
  });

  it('does not stall when the window is hidden and frames never come', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const started = Date.now();
    await nextPaint(30);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
