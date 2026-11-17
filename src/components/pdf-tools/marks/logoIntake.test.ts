import { describe, expect, it } from 'vitest';
import { solidPng } from '@/lib/pdf-tools/testMarksPdf';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { inspectLogo, logoCandidates, logoPlan, LOGO_LIMITS, prepareLogo, type LogoDeps } from './logoIntake';

/** A JPEG header only: SOI, an optional EXIF orientation, a baseline frame of the given size and components, EOI. */
function jpegHeader(width: number, height: number, opts: { orientation?: number; components?: number; littleEndian?: boolean } = {}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  if (opts.orientation !== undefined) {
    const le = opts.littleEndian === true;
    const u16 = (n: number) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
    const u32 = (n: number) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    const tiff = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(opts.orientation), 0, 0, ...u32(0)];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload);
  }
  const n = opts.components ?? 3;
  const frame = [8, height >> 8, height & 255, width >> 8, width & 255, n];
  for (let c = 0; c < n; c++) frame.push(c + 1, 0x11, 0);
  bytes.push(0xff, 0xc0, (frame.length + 2) >> 8, (frame.length + 2) & 255, ...frame, 0xff, 0xd9);
  return new Uint8Array(bytes);
}

function pngHeader(width: number, height: number): Uint8Array {
  // The real file is not needed: the header holds the size.
  const png = solidPng(1, 1, [0, 0, 0]);
  const out = png.slice();
  const view = new DataView(out.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}

describe('inspectLogo', () => {
  it('reads a PNG size', () => {
    expect(inspectLogo(solidPng(300, 120, [1, 2, 3]))).toEqual({ format: 'png', width: 300, height: 120, orientation: 1, cmyk: false });
  });

  it("reads a JPEG's size, EXIF orientation (either byte order) and CMYK colour", () => {
    expect(inspectLogo(jpegHeader(1000, 800))).toEqual({ format: 'jpeg', width: 1000, height: 800, orientation: 1, cmyk: false });
    expect(inspectLogo(jpegHeader(1000, 800, { orientation: 6 }))).toMatchObject({ orientation: 6 });
    expect(inspectLogo(jpegHeader(1000, 800, { orientation: 8, littleEndian: true }))).toMatchObject({ orientation: 8 });
    expect(inspectLogo(jpegHeader(400, 400, { components: 4 }))).toMatchObject({ cmyk: true });
    expect(inspectLogo(jpegHeader(400, 400, { components: 1 }))).toMatchObject({ cmyk: false });
  });

  it('treats an orientation out of range as upright', () => {
    expect(inspectLogo(jpegHeader(10, 10, { orientation: 9 }))).toMatchObject({ orientation: 1 });
  });

  it('calls anything else another format', () => {
    expect(inspectLogo(new TextEncoder().encode('GIF89a......'))).toMatchObject({ format: 'other' });
    expect(inspectLogo(new Uint8Array([0xff, 0xd8, 0xff]))).toMatchObject({ format: 'other' });
  });
});

describe('logoPlan', () => {
  it('uses a small upright PNG or RGB JPEG as it is', () => {
    expect(logoPlan(inspectLogo(solidPng(800, 400, [0, 0, 0])))).toEqual({ kind: 'as-is', format: 'png', width: 800, height: 400 });
    expect(logoPlan(inspectLogo(jpegHeader(1600, 900)))).toEqual({ kind: 'as-is', format: 'jpeg', width: 1600, height: 900 });
  });

  it(`redraws anything above ${LOGO_LIMITS.longSide} px on its long side at ${LOGO_LIMITS.target} px, keeping a PNG a PNG`, () => {
    expect(logoPlan(inspectLogo(pngHeader(6000, 4000)))).toEqual({ kind: 'redraw', format: 'png', width: 1200, height: 800, reasons: ['large'] });
    expect(logoPlan(inspectLogo(pngHeader(1601, 200)))).toMatchObject({ kind: 'redraw', width: 1200, height: 150 });
  });

  it('turns a JPEG by its EXIF orientation, and swaps its sides for a quarter turn', () => {
    expect(logoPlan(inspectLogo(jpegHeader(1000, 800, { orientation: 6 })))).toEqual({ kind: 'redraw', format: 'jpeg', width: 800, height: 1000, reasons: ['turned'] });
    expect(logoPlan(inspectLogo(jpegHeader(1000, 800, { orientation: 3 })))).toEqual({ kind: 'redraw', format: 'jpeg', width: 1000, height: 800, reasons: ['turned'] });
    expect(logoPlan(inspectLogo(jpegHeader(4000, 3000, { orientation: 8 })))).toEqual({ kind: 'redraw', format: 'jpeg', width: 900, height: 1200, reasons: ['large', 'turned'] });
  });

  it('converts a CMYK JPEG to RGB', () => {
    expect(logoPlan(inspectLogo(jpegHeader(500, 500, { components: 4 })))).toEqual({ kind: 'redraw', format: 'jpeg', width: 500, height: 500, reasons: ['cmyk'] });
  });

  it('refuses what is not a PNG or JPG, in the library words', () => {
    expect(logoPlan(inspectLogo(new TextEncoder().encode('BM......')))).toEqual({ kind: 'refuse', message: 'Choose a PNG or JPG image for the logo.' });
  });
});

describe('prepareLogo', () => {
  const fakeDeps = () => {
    const calls: { decode: unknown[]; encode: unknown[] } = { decode: [], encode: [] };
    const deps: LogoDeps = {
      decode: async (_bytes, mimeType, size) => {
        calls.decode.push({ mimeType, size });
        return { width: size.width, height: size.height, close: () => undefined };
      },
      encode: async (image, size, format) => {
        calls.encode.push({ size, format, from: [image.width, image.height] });
        return format === 'png' ? solidPng(size.width, size.height, [9, 9, 9]) : jpegHeader(size.width, size.height);
      },
    };
    return { deps, calls };
  };

  it('returns the bytes unchanged when nothing needs doing, without decoding', async () => {
    const { deps, calls } = fakeDeps();
    const bytes = solidPng(400, 200, [0, 0, 0]);
    const ready = await prepareLogo(bytes, deps);
    expect(ready.image).toBe(bytes);
    expect(ready).toMatchObject({ format: 'png', width: 400, height: 200, changed: [] });
    expect(calls.decode).toEqual([]);
  });

  it('decodes at the planned size, upright, and encodes in the planned format', async () => {
    const { deps, calls } = fakeDeps();
    const ready = await prepareLogo(jpegHeader(4000, 3000, { orientation: 6 }), deps);
    expect(calls.decode).toEqual([{ mimeType: 'image/jpeg', size: { width: 900, height: 1200 } }]);
    expect(calls.encode).toEqual([{ size: { width: 900, height: 1200 }, format: 'jpeg', from: [900, 1200] }]);
    expect(ready).toMatchObject({ format: 'jpeg', width: 900, height: 1200, changed: ['large', 'turned'] });
  });

  it('keeps the shape the decoder gave when it differs from the plan, never stretching the picture', async () => {
    const { deps, calls } = fakeDeps();
    // A decoder that turned the picture but left the sides as asked: the drawing follows the picture.
    deps.decode = async (_bytes, _mime, size) => ({ width: size.height, height: size.width, close: () => undefined });
    const ready = await prepareLogo(jpegHeader(1000, 800, { orientation: 6 }), deps);
    expect(calls.encode).toEqual([{ size: { width: 1000, height: 800 }, format: 'jpeg', from: [1000, 800] }]);
    expect(ready).toMatchObject({ width: 1000, height: 800 });
  });

  it('refuses a picture it cannot read', async () => {
    const { deps } = fakeDeps();
    await expect(prepareLogo(new TextEncoder().encode('not an image'), deps)).rejects.toThrow('Choose a PNG or JPG image for the logo.');
    deps.decode = async () => {
      throw new Error('decode failed');
    };
    await expect(prepareLogo(pngHeader(3000, 3000), deps)).rejects.toThrow('This image could not be read. It may be damaged.');
  });
});

describe('logoCandidates', () => {
  const file = (over: Partial<WorkingFile>): WorkingFile => ({
    id: 'x',
    name: 'x',
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'computer',
    bytes: new Uint8Array(),
    size: 10,
    pageCount: 1,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
    ...over,
  });

  it("offers the list's PNG and JPG images, in list order", () => {
    const files = [
      file({ id: 'a', name: 'report.pdf' }),
      file({ id: 'b', name: 'logo.png', kind: 'image', mimeType: 'image/png', pageCount: null, size: 2048 }),
      file({ id: 'c', name: 'seal.jpg', kind: 'image', mimeType: 'image/jpeg', pageCount: null }),
      file({ id: 'd', name: 'odd.tif', kind: 'image', mimeType: 'image/tiff', pageCount: null }),
    ];
    expect(logoCandidates(files).map((c) => [c.id, c.name])).toEqual([
      ['b', 'logo.png'],
      ['c', 'seal.jpg'],
    ]);
  });
});
