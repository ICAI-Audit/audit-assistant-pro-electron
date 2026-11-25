import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_PIXELS, IMAGE_MAX_SIDE, imageSizeProblem, readImageHeader } from './imageHeader';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

function png(width: number, height: number, animated = false) {
  const chunk = (type: string, data: number[]) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...be32(width), ...be32(height), 8, 2, 0, 0, 0]),
    animated ? chunk('acTL', [...be32(2), ...be32(0)]) : [],
    chunk('IDAT', [1, 2, 3]),
  );
}

function jpeg(width: number, height: number, sof = 0xc0) {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe1, 0x00, 0x08, ...ascii('Exif'), 0, 0], // an APP1 segment before the frame header
    [0xff, 0xc4, 0x00, 0x04, 0, 0], // a Huffman table, which is not a frame header
    [0xff, sof, 0x00, 0x11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3],
    new Array(9).fill(0),
    [0xff, 0xda],
  );
}

function gif(width: number, height: number, frames: number) {
  const frame = [0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, ...le16(0), ...le16(0), ...le16(width), ...le16(height), 0, 2, 2, 0x4c, 0x01, 0];
  return bytes(ascii('GIF89a'), le16(width), le16(height), [0x80, 0, 0], new Array(6).fill(0), ...new Array(frames).fill(frame), [0x3b]);
}

function bmp(width: number, height: number) {
  return bytes(ascii('BM'), le32(0), le32(0), le32(54), le32(40), le32(width), le32(height), le16(1), le16(24), new Array(24).fill(0));
}

const webpLossy = (w: number, h: number) =>
  bytes(ascii('RIFF'), le32(30), ascii('WEBP'), ascii('VP8 '), le32(18), [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h), new Array(8).fill(0));
const webpLossless = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return bytes(ascii('RIFF'), le32(20), ascii('WEBP'), ascii('VP8L'), le32(5), [0x2f], le32(bits), new Array(4).fill(0));
};
const webpExtended = (w: number, h: number, animated: boolean) =>
  bytes(ascii('RIFF'), le32(30), ascii('WEBP'), ascii('VP8X'), le32(10), [animated ? 0x02 : 0, 0, 0, 0], le24(w - 1), le24(h - 1), new Array(8).fill(0));

describe('readImageHeader', () => {
  it('reads PNG, and spots an animated PNG', () => {
    expect(readImageHeader(png(640, 480))).toEqual({ format: 'png', width: 640, height: 480, animated: false });
    expect(readImageHeader(png(10, 20, true))?.animated).toBe(true);
  });

  it('reads JPEG from the frame header, skipping other segments, baseline and progressive', () => {
    expect(readImageHeader(jpeg(1200, 800))).toEqual({ format: 'jpeg', width: 1200, height: 800, animated: false });
    expect(readImageHeader(jpeg(31, 17, 0xc2))).toMatchObject({ width: 31, height: 17 });
  });

  it('reads GIF and counts its frames', () => {
    expect(readImageHeader(gif(300, 200, 1))).toEqual({ format: 'gif', width: 300, height: 200, animated: false });
    expect(readImageHeader(gif(300, 200, 3))?.animated).toBe(true);
  });

  it('reads BMP, including a bottom-up or top-down height', () => {
    expect(readImageHeader(bmp(800, 600))).toEqual({ format: 'bmp', width: 800, height: 600, animated: false });
    expect(readImageHeader(bmp(800, -600))).toMatchObject({ height: 600 });
  });

  it('reads the three kinds of WebP, and spots an animated one', () => {
    expect(readImageHeader(webpLossy(320, 240))).toEqual({ format: 'webp', width: 320, height: 240, animated: false });
    expect(readImageHeader(webpLossless(1000, 750))).toMatchObject({ width: 1000, height: 750 });
    expect(readImageHeader(webpExtended(4000, 3000, false))).toMatchObject({ width: 4000, height: 3000, animated: false });
    expect(readImageHeader(webpExtended(400, 300, true))?.animated).toBe(true);
  });

  it('returns null for truncated or unknown data', () => {
    expect(readImageHeader(png(10, 10).slice(0, 20))).toBeNull();
    expect(readImageHeader(jpeg(10, 10).slice(0, 12))).toBeNull();
    expect(readImageHeader(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readImageHeader(png(0, 10))).toBeNull();
  });
});

describe('imageSizeProblem', () => {
  it('accepts an image within the limits', () => {
    expect(imageSizeProblem({ width: IMAGE_MAX_SIDE, height: 2000 })).toBeNull();
  });

  it('refuses a side above the limit', () => {
    expect(imageSizeProblem({ width: IMAGE_MAX_SIDE + 1, height: 10 })).toMatch(/20,001 × 10 pixels/);
  });

  it('refuses too many pixels', () => {
    const side = Math.ceil(Math.sqrt(IMAGE_MAX_PIXELS)) + 1;
    expect(imageSizeProblem({ width: side, height: side })).toMatch(/megapixels/);
  });
});
