import { deflateSync } from 'node:zlib';
import { decodePDFRawStream, PDFArray, PDFDocument, type PDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { imagesToPdf, sniffImageFormat, type ImageInput, type ImagePageSize, type ImagesToPdfOptions } from './imagesToPdf';
import { makePdf } from './testPdf';

vi.setConfig({ testTimeout: 20_000 });

const A4_W = 595.28;
const A4_H = 841.89;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

interface PngSpec {
  colorType?: 0 | 2 | 3 | 4 | 6;
  bitDepth?: 8 | 16;
  interlace?: 0 | 1;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;

// Synthetic grey-ish test pattern; every row starts with filter byte 0. Interlaced is only
// supported for 1x1 images, where Adam7 has a single pass holding the single pixel.
function makePng(width: number, height: number, spec: PngSpec = {}): Uint8Array {
  const { colorType = 2, bitDepth = 8, interlace = 0 } = spec;
  if (interlace && (width !== 1 || height !== 1)) throw new Error('interlaced helper is 1x1 only');
  const bytesPerPixel = (CHANNELS[colorType] * bitDepth) / 8;
  const row = new Uint8Array(1 + width * bytesPerPixel).fill(0x80);
  row[0] = 0;
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (colorType === 3) parts.push(chunk('PLTE', new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255])));
  if (colorType === 3) parts.push(chunk('tRNS', new Uint8Array([255, 128, 0])));
  parts.push(chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array()));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// pdf-lib only reads the SOF header of a JPEG (it copies the stream as-is), so a header-only
// JPEG is enough to exercise embedding and layout. Optionally carries an EXIF orientation tag.
interface ExifSpec {
  orientation?: number; // omitted: an Exif segment whose IFD has no orientation tag
  order?: 'II' | 'MM';
  afterApp0?: boolean; // put a JFIF APP0 segment first
  truncateTo?: number; // cut the Exif payload to this many bytes (the segment length stays honest)
  long?: boolean; // write the orientation entry as TIFF type LONG (4) instead of SHORT (3)
}

function makeJpeg(width: number, height: number, exif?: ExifSpec): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  const segments: number[] = [];
  if (exif?.afterApp0) segments.push(0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  if (exif) {
    const le = exif.order === 'II';
    const u16 = (n: number) => (le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
    const u32 = (n: number) => (le ? [n & 0xff, 0, 0, 0] : [0, 0, 0, n]);
    // TIFF header, then an IFD with one entry (tag 0x0112 SHORT count 1) or, when no orientation, a different tag.
    const tag = exif.orientation === undefined ? 0x0100 : 0x0112;
    const tiff = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(tag), ...u16(exif.long ? 4 : 3), ...u32(1), ...(exif.long ? u32(exif.orientation ?? 5) : [...u16(exif.orientation ?? 5), 0, 0]), ...u32(0)];
    let body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    if (exif.truncateTo !== undefined) body = body.slice(0, exif.truncateTo);
    segments.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  }
  return new Uint8Array([0xff, 0xd8, ...segments, ...sof, 0xff, 0xd9]);
}

function png(name: string, width: number, height: number, spec?: PngSpec): ImageInput {
  return { bytes: makePng(width, height, spec), format: 'png', name };
}

function jpg(name: string, width: number, height: number, exif?: ExifSpec): ImageInput {
  return { bytes: makeJpeg(width, height, exif), format: 'jpeg', name };
}

const png200x100 = png('wide.png', 200, 100);
const jpg100x200 = jpg('tall.jpg', 100, 200);
const A4_AUTO: ImagesToPdfOptions = { pageSize: 'a4-auto', marginPt: 28 };

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes);
}

type Matrix = [number, number, number, number, number, number];

// Reads the single `cm` matrix the page draws its (single) image with.
async function matrix(doc: PDFDocument, pageIndex: number): Promise<Matrix> {
  const contents = doc.getPage(pageIndex).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  const text = streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
  const ops = [...text.matchAll(/([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) cm/g)].map((m) => m.slice(1).map(Number) as Matrix);
  if (ops.length !== 1) throw new Error(`expected one cm operator in: ${text}`);
  return ops[0];
}

// Placement of an unrotated image (orientation 1).
async function placement(doc: PDFDocument, pageIndex: number): Promise<{ w: number; h: number; x: number; y: number }> {
  const [a, , , d, e, f] = await matrix(doc, pageIndex);
  return { w: a, h: d, x: e, y: f };
}

// Where a point of the image's unit square (X right, Y up, so the stored top-left pixel is (0,1)) lands on the page.
function mapPoint([a, b, c, d, e, f]: Matrix, X: number, Y: number): [number, number] {
  return [a * X + c * Y + e, b * X + d * Y + f];
}

describe('sniffImageFormat', () => {
  it('recognises PNG and JPEG by content', () => {
    expect(sniffImageFormat(png200x100.bytes)).toBe('png');
    expect(sniffImageFormat(jpg100x200.bytes)).toBe('jpeg');
  });
  it('returns other for everything else', () => {
    expect(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46]))).toBe('other');
    expect(sniffImageFormat(new Uint8Array())).toBe('other');
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8]))).toBe('other');
    expect(sniffImageFormat(new TextEncoder().encode('hello world'))).toBe('other');
    expect(sniffImageFormat(new TextEncoder().encode('GIF89a......'))).toBe('other');
    expect(sniffImageFormat(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('other');
    expect(sniffImageFormat(new TextEncoder().encode('BM......'))).toBe('other');
  });
});

describe('imagesToPdf page sizes', () => {
  it('chooses landscape or portrait A4 per image in a4-auto', async () => {
    const doc = await load(await imagesToPdf([png200x100, jpg100x200], A4_AUTO));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(A4_H, 1);
    expect(doc.getPage(0).getSize().height).toBeCloseTo(A4_W, 1);
    expect(doc.getPage(1).getSize().width).toBeCloseTo(A4_W, 1);
    expect(doc.getPage(1).getSize().height).toBeCloseTo(A4_H, 1);
  });
  it('treats a square image as portrait in a4-auto', async () => {
    const doc = await load(await imagesToPdf([png('sq.png', 50, 50)], A4_AUTO));
    expect(doc.getPage(0).getSize().width).toBeCloseTo(A4_W, 1);
  });
  it('forces every page to A4 portrait or landscape when asked', async () => {
    const portrait = await load(await imagesToPdf([png200x100, jpg100x200], { pageSize: 'a4-portrait', marginPt: 28 }));
    for (const i of [0, 1]) expect(portrait.getPage(i).getSize().width).toBeCloseTo(A4_W, 1);
    const landscape = await load(await imagesToPdf([png200x100, jpg100x200], { pageSize: 'a4-landscape', marginPt: 28 }));
    for (const i of [0, 1]) expect(landscape.getPage(i).getSize().width).toBeCloseTo(A4_H, 1);
  });
  it('makes the page the image pixel size in fit mode, ignoring any margin', async () => {
    const fit = await load(await imagesToPdf([png200x100], { pageSize: 'fit', marginPt: 0 }));
    expect(fit.getPage(0).getSize()).toEqual({ width: 200, height: 100 });
    const withMargin = await load(await imagesToPdf([jpg100x200], { pageSize: 'fit', marginPt: 40 }));
    expect(withMargin.getPage(0).getSize()).toEqual({ width: 100, height: 200 });
    expect(await placement(withMargin, 0)).toEqual({ w: 100, h: 200, x: 0, y: 0 });
  });
  it('handles a 1x1 image in fit mode and on A4', async () => {
    const one = png('one.png', 1, 1);
    const fit = await load(await imagesToPdf([one], { pageSize: 'fit', marginPt: 0 }));
    expect(fit.getPage(0).getSize()).toEqual({ width: 1, height: 1 });
    const a4 = await load(await imagesToPdf([one], A4_AUTO));
    expect(await placement(a4, 0)).toMatchObject({ w: 1, h: 1 });
  });
});

describe('imagesToPdf layout', () => {
  // Warm the PNG code path (zlib, upng) so a cold first call cannot time out a layout test.
  beforeAll(async () => {
    await imagesToPdf([png('warm.png', 4, 4)], { pageSize: 'fit', marginPt: 0 });
  }, 30_000);
  it('never scales a small image up and centres it', async () => {
    const doc = await load(await imagesToPdf([png200x100], { pageSize: 'a4-portrait', marginPt: 28 }));
    const p = await placement(doc, 0);
    expect(p.w).toBeCloseTo(200, 3);
    expect(p.h).toBeCloseTo(100, 3);
    expect(p.x).toBeCloseTo((A4_W - 200) / 2, 2);
    expect(p.y).toBeCloseTo((A4_H - 100) / 2, 2);
  });
  it('scales a large image down to fit inside the margins, keeping its ratio', async () => {
    const doc = await load(await imagesToPdf([jpg('big.jpg', 2000, 1000)], { pageSize: 'a4-portrait', marginPt: 28 }));
    const p = await placement(doc, 0);
    const boxW = A4_W - 56;
    expect(p.w).toBeCloseTo(boxW, 2);
    expect(p.h).toBeCloseTo(boxW / 2, 2);
    expect(p.x).toBeCloseTo(28, 2);
    expect(p.y).toBeCloseTo((A4_H - boxW / 2) / 2, 2);
  });
  it('fits a very wide and a very tall image inside the margins', async () => {
    const doc = await load(
      await imagesToPdf([png('wide.png', 5000, 50), png('tall.png', 50, 5000)], { pageSize: 'a4-portrait', marginPt: 28 }),
    );
    const wide = await placement(doc, 0);
    expect(wide.w).toBeCloseTo(A4_W - 56, 2);
    expect(wide.h).toBeCloseTo((A4_W - 56) / 100, 2);
    const tall = await placement(doc, 1);
    expect(tall.h).toBeCloseTo(A4_H - 56, 2);
    expect(tall.w).toBeCloseTo((A4_H - 56) / 100, 2);
    expect(tall.y).toBeCloseTo(28, 2);
  });
  it('honours a larger margin', async () => {
    const doc = await load(await imagesToPdf([jpg('big.jpg', 2000, 2000)], { pageSize: 'a4-portrait', marginPt: 100 }));
    const p = await placement(doc, 0);
    expect(p.w).toBeCloseTo(A4_W - 200, 2);
    expect(p.x).toBeCloseTo(100, 2);
  });
  it('rotates nothing: a landscape image on a4-auto fills the landscape page width', async () => {
    const doc = await load(await imagesToPdf([jpg('big.jpg', 2000, 1000)], A4_AUTO));
    const p = await placement(doc, 0);
    expect(p.w).toBeCloseTo(A4_H - 56, 2);
  });
});

describe('imagesToPdf order and duplicates', () => {
  it('keeps the supplied order and repeats an image supplied twice', async () => {
    const a = png('a.png', 300, 100);
    const b = jpg('b.jpg', 100, 300);
    const doc = await load(await imagesToPdf([a, b, a], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => p.getSize())).toEqual([
      { width: 300, height: 100 },
      { width: 100, height: 300 },
      { width: 300, height: 100 },
    ]);
  });
});

describe('imagesToPdf errors', () => {
  it('rejects an empty list', async () => {
    await expect(imagesToPdf([], { pageSize: 'fit', marginPt: 0 })).rejects.toMatchObject({ code: 'no-images' });
  });
  it('rejects a 3-byte file, naming it', async () => {
    const bad: ImageInput = { bytes: new Uint8Array([1, 2, 3]), format: 'png', name: 'x.png' };
    await expect(imagesToPdf([bad], A4_AUTO)).rejects.toMatchObject({ code: 'bad-image', message: expect.stringContaining('x.png') });
  });
  it('rejects empty, text and PDF bytes as bad-image even when labelled as images', async () => {
    const pdf = await makePdf('A', 1);
    const cases: ImageInput[] = [
      { bytes: new Uint8Array(), format: 'jpeg', name: 'empty.jpg' },
      { bytes: new TextEncoder().encode('not an image at all'), format: 'png', name: 'notes.png' },
      { bytes: pdf, format: 'jpeg', name: 'doc.jpg' },
    ];
    for (const bad of cases) {
      await expect(imagesToPdf([bad], A4_AUTO)).rejects.toMatchObject({ code: 'bad-image', message: expect.stringContaining(bad.name) });
    }
  });
  it('names the unsupported format when a recognised but unsupported image is supplied', async () => {
    const gif: ImageInput = { bytes: new TextEncoder().encode('GIF89a\x01\x00\x01\x00'), format: 'png', name: 'anim.gif' };
    await expect(imagesToPdf([gif], A4_AUTO)).rejects.toMatchObject({ code: 'bad-image', message: expect.stringContaining('anim.gif') });
  });
  it('rejects a truncated PNG and a corrupt-body JPEG without an unhandled exception', async () => {
    const truncated: ImageInput = { bytes: makePng(20, 20).slice(0, 40), format: 'png', name: 'cut.png' };
    await expect(imagesToPdf([truncated], A4_AUTO)).rejects.toMatchObject({ code: 'bad-image', message: expect.stringContaining('cut.png') });
    const headerless: ImageInput = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), format: 'jpeg', name: 'nosof.jpg' };
    await expect(imagesToPdf([headerless], A4_AUTO)).rejects.toMatchObject({ code: 'bad-image', message: expect.stringContaining('nosof.jpg') });
  });
  it('reports the first bad file in a batch by name', async () => {
    const bad: ImageInput = { bytes: new Uint8Array([9, 9, 9, 9]), format: 'jpeg', name: 'second.jpg' };
    await expect(imagesToPdf([png200x100, bad], A4_AUTO)).rejects.toMatchObject({ code: 'bad-image', message: expect.stringContaining('second.jpg') });
  });
});

describe('imagesToPdf format detection', () => {
  it('trusts the content, not the declared format or file name', async () => {
    const pngNamedJpg: ImageInput = { bytes: makePng(120, 60), format: 'jpeg', name: 'really-a-png.jpg' };
    const jpgNamedPng: ImageInput = { bytes: makeJpeg(60, 120), format: 'png', name: 'really-a-jpeg.png' };
    const doc = await load(await imagesToPdf([pngNamedJpg, jpgNamedPng], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPages().map((p) => p.getSize())).toEqual([
      { width: 120, height: 60 },
      { width: 60, height: 120 },
    ]);
  });
});

describe('imagesToPdf image variants', () => {
  const variants: Array<[string, PngSpec]> = [
    ['RGBA (transparency)', { colorType: 6 }],
    ['grey + alpha', { colorType: 4 }],
    ['greyscale', { colorType: 0 }],
    ['palette with tRNS', { colorType: 3 }],
    ['16-bit RGB', { bitDepth: 16 }],
    ['16-bit RGBA', { colorType: 6, bitDepth: 16 }],
  ];
  for (const [label, spec] of variants) {
    it(`embeds a ${label} PNG or reports bad-image, never an unhandled error`, async () => {
      const result = await imagesToPdf([png('v.png', 8, 4, spec)], { pageSize: 'fit', marginPt: 0 }).then(
        (bytes) => ({ bytes }),
        (error) => ({ error }),
      );
      if ('error' in result) {
        expect(result.error).toMatchObject({ name: 'PdfToolsError', code: 'bad-image' });
      } else {
        expect((await load(result.bytes)).getPage(0).getSize()).toEqual({ width: 8, height: 4 });
      }
    });
  }
  it('embeds RGBA, palette and 16-bit PNGs successfully', async () => {
    for (const [, spec] of variants) {
      const doc = await load(await imagesToPdf([png('v.png', 8, 4, spec)], { pageSize: 'fit', marginPt: 0 }));
      expect(doc.getPageCount()).toBe(1);
    }
  });
  it('handles an interlaced PNG', async () => {
    const doc = await load(await imagesToPdf([png('i.png', 1, 1, { interlace: 1 })], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 1, height: 1 });
  });
});

type Corner = 'TL' | 'TR' | 'BL' | 'BR';

describe('imagesToPdf JPEG EXIF orientation', () => {
  // Where the stored image's top-left, top-right and bottom-left pixels must appear on screen, per the EXIF spec.
  const expected: Record<number, { topLeft: Corner; topRight: Corner; bottomLeft: Corner }> = {
    1: { topLeft: 'TL', topRight: 'TR', bottomLeft: 'BL' },
    2: { topLeft: 'TR', topRight: 'TL', bottomLeft: 'BR' },
    3: { topLeft: 'BR', topRight: 'BL', bottomLeft: 'TR' },
    4: { topLeft: 'BL', topRight: 'BR', bottomLeft: 'TL' },
    5: { topLeft: 'TL', topRight: 'BL', bottomLeft: 'TR' },
    6: { topLeft: 'TR', topRight: 'BR', bottomLeft: 'TL' },
    7: { topLeft: 'BR', topRight: 'TR', bottomLeft: 'BL' },
    8: { topLeft: 'BL', topRight: 'TL', bottomLeft: 'BR' },
  };
  const STORED_W = 200;
  const STORED_H = 100;

  for (const order of ['MM', 'II'] as const) {
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
      it(`orientation ${orientation} (${order}): upright page and drawing transform`, async () => {
        const doc = await load(await imagesToPdf([jpg('p.jpg', STORED_W, STORED_H, { orientation, order })], A4_AUTO));
        const swapped = orientation >= 5;
        const dw = swapped ? STORED_H : STORED_W;
        const dh = swapped ? STORED_W : STORED_H;
        const size = doc.getPage(0).getSize();
        // Portrait A4 when the displayed image is tall, landscape when wide.
        expect(size.width).toBeCloseTo(swapped ? A4_W : A4_H, 1);
        expect(size.height).toBeCloseTo(swapped ? A4_H : A4_W, 1);
        expect(doc.getPage(0).getRotation().angle).toBe(0);
        const left = (size.width - dw) / 2;
        const bottom = (size.height - dh) / 2;
        const corner: Record<Corner, [number, number]> = {
          TL: [left, bottom + dh],
          TR: [left + dw, bottom + dh],
          BL: [left, bottom],
          BR: [left + dw, bottom],
        };
        const m = await matrix(doc, 0);
        const [tlx, tly] = mapPoint(m, 0, 1);
        const [trx, try_] = mapPoint(m, 1, 1);
        expect(tlx).toBeCloseTo(corner[expected[orientation].topLeft][0], 3);
        expect(tly).toBeCloseTo(corner[expected[orientation].topLeft][1], 3);
        expect(trx).toBeCloseTo(corner[expected[orientation].topRight][0], 3);
        expect(try_).toBeCloseTo(corner[expected[orientation].topRight][1], 3);
        const [blx, bly] = mapPoint(m, 0, 0);
        expect(blx).toBeCloseTo(corner[expected[orientation].bottomLeft][0], 3);
        expect(bly).toBeCloseTo(corner[expected[orientation].bottomLeft][1], 3);
      });
    }
  }

  it('fits and scales from the displayed size (a large phone photo, orientation 6)', async () => {
    const doc = await load(await imagesToPdf([jpg('p.jpg', 4000, 3000, { orientation: 6 })], A4_AUTO));
    expect(doc.getPage(0).getSize().width).toBeCloseTo(A4_W, 1); // displayed 3000x4000 is portrait
    const m = await matrix(doc, 0);
    // Orientation 6: stored top-left lands top-right, stored bottom-right lands bottom-left.
    const [x1, y1] = mapPoint(m, 0, 1);
    const [x2, y2] = mapPoint(m, 1, 0);
    const scale = Math.min((A4_W - 56) / 3000, (A4_H - 56) / 4000);
    expect(x1 - x2).toBeCloseTo(3000 * scale, 2);
    expect(y1 - y2).toBeCloseTo(4000 * scale, 2);
    expect(x2).toBeCloseTo((A4_W - 3000 * scale) / 2, 2);
    expect(y2).toBeCloseTo((A4_H - 4000 * scale) / 2, 2);
  });

  it('fit mode uses the displayed size as the page size', async () => {
    const doc = await load(await imagesToPdf([jpg('p.jpg', 200, 100, { orientation: 8 })], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 100, height: 200 });
  });

  const asOrientation1: Array<[string, ExifSpec]> = [
    ['no Exif segment', undefined as unknown as ExifSpec],
    ['Exif without an orientation tag', { order: 'MM' }],
    ['orientation value 0', { orientation: 0, order: 'MM' }],
    ['orientation value 9', { orientation: 9, order: 'II' }],
    ['truncated Exif (cut inside the TIFF header)', { orientation: 6, order: 'MM', truncateTo: 10 }],
    ['truncated Exif (cut inside the IFD entry)', { orientation: 6, order: 'II', truncateTo: 24 }],
    ['orientation 1 after a JFIF APP0 segment', { orientation: 1, order: 'MM', afterApp0: true }],
    ['orientation tag of type LONG (big-endian)', { orientation: 6, order: 'MM', long: true }],
    ['orientation tag of type LONG (little-endian)', { orientation: 6, order: 'II', long: true }],
  ];
  for (const [label, exif] of asOrientation1) {
    it(`treats ${label} as orientation 1`, async () => {
      const doc = await load(await imagesToPdf([jpg('p.jpg', STORED_W, STORED_H, exif)], A4_AUTO));
      expect(doc.getPage(0).getSize().width).toBeCloseTo(A4_H, 1);
      const [a, b, c, d] = await matrix(doc, 0);
      expect([a, b, c, d]).toEqual([STORED_W, 0, 0, STORED_H]);
    });
  }

  it('finds the orientation in an Exif segment that follows other APPn segments', async () => {
    const doc = await load(await imagesToPdf([jpg('p.jpg', STORED_W, STORED_H, { orientation: 6, order: 'MM', afterApp0: true })], A4_AUTO));
    expect(doc.getPage(0).getSize().width).toBeCloseTo(A4_W, 1);
  });

  it('never rotates a PNG', async () => {
    const doc = await load(await imagesToPdf([png('p.png', 200, 100)], A4_AUTO));
    const [a, b, c, d] = await matrix(doc, 0);
    expect([a, b, c, d]).toEqual([200, 0, 0, 100]);
  });

  it('embeds the JPEG bytes untouched (no re-encoding)', async () => {
    const image = jpg('p.jpg', 200, 100, { orientation: 6, order: 'MM' });
    const out = await imagesToPdf([image], A4_AUTO);
    const hay = Buffer.from(out);
    expect(hay.indexOf(Buffer.from(image.bytes))).toBeGreaterThan(-1);
  });
});

describe('imagesToPdf margin validation', () => {
  const img = [png('m.png', 100, 100)];
  const rejects = (marginPt: number, pageSize: ImagePageSize = 'a4-portrait') =>
    expect(imagesToPdf(img, { pageSize, marginPt })).rejects.toMatchObject({ name: 'PdfToolsError', code: 'invalid-image-options' });

  it('rejects negative and non-finite margins', async () => {
    await rejects(-1);
    await rejects(Number.NaN);
    await rejects(Number.POSITIVE_INFINITY);
  });
  it('rejects a margin leaving less than 36 pt of usable width or height', async () => {
    await rejects(280); // width 595.28 - 560 = 35.28
    await rejects(300);
    await rejects(280, 'a4-landscape'); // height 595.28 - 560 = 35.28
  });
  it('accepts a margin that leaves at least 36 pt', async () => {
    const out = await imagesToPdf(img, { pageSize: 'a4-portrait', marginPt: 279 });
    expect((await load(out)).getPageCount()).toBe(1);
  });
  it('uses a plain message', async () => {
    await expect(imagesToPdf(img, { pageSize: 'a4-portrait', marginPt: 400 })).rejects.toThrow(/margin/i);
  });
  it('validates the margin per page, using the displayed orientation in a4-auto', async () => {
    // A wide image gets a landscape page (595.28 high): margin 280 leaves 35.28 high.
    await expect(imagesToPdf([png('w.png', 200, 100)], { pageSize: 'a4-auto', marginPt: 280 })).rejects.toMatchObject({ code: 'invalid-image-options' });
  });
  it('ignores the margin in fit mode, as the brief says', async () => {
    const doc = await load(await imagesToPdf(img, { pageSize: 'fit', marginPt: 500 }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 100, height: 100 });
  });
});

describe('imagesToPdf document metadata', () => {
  it('sets Producer and Creator to ICAI VERA and stamps both dates', async () => {
    const before = Date.now() - 2000;
    const doc = await PDFDocument.load(await imagesToPdf([png200x100], A4_AUTO), { updateMetadata: false });
    expect(doc.getProducer()).toBe('ICAI VERA');
    expect(doc.getCreator()).toBe('ICAI VERA');
    expect(doc.getCreationDate()!.getTime()).toBeGreaterThan(before);
    expect(doc.getModificationDate()!.getTime()).toBeGreaterThan(before);
  });
});

describe('imagesToPdf views into larger buffers', () => {
  function atOffset(bytes: Uint8Array, offset: number): Uint8Array {
    const big = new Uint8Array(offset + bytes.length + 3).fill(0xaa);
    big.set(bytes, offset);
    return big.subarray(offset, offset + bytes.length);
  }
  it('embeds a JPEG that is a subarray at a non-zero offset', async () => {
    const view = atOffset(makeJpeg(120, 60), 7);
    const doc = await load(await imagesToPdf([{ bytes: view, format: 'jpeg', name: 'view.jpg' }], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 120, height: 60 });
  });
  it('embeds a PNG that is a subarray at a non-zero offset', async () => {
    const view = atOffset(makePng(30, 20), 7);
    const doc = await load(await imagesToPdf([{ bytes: view, format: 'png', name: 'view.png' }], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 30, height: 20 });
  });
  it('embeds a JPEG held in a pooled Node Buffer', async () => {
    const view = Buffer.from(makeJpeg(80, 40));
    const doc = await load(await imagesToPdf([{ bytes: view, format: 'jpeg', name: 'pooled.jpg' }], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 80, height: 40 });
  });
  it('does not change the bytes behind a view', async () => {
    const view = atOffset(makeJpeg(120, 60), 7);
    const before = view.slice();
    await imagesToPdf([{ bytes: view, format: 'jpeg', name: 'view.jpg' }], A4_AUTO);
    expect(Array.from(view)).toEqual(Array.from(before));
  });
});

describe('imagesToPdf zero-dimension images', () => {
  const cases: Array<[string, ImageInput]> = [
    ['JPEG with width 0', { bytes: makeJpeg(0, 50), format: 'jpeg', name: 'zw.jpg' }],
    ['JPEG with height 0', { bytes: makeJpeg(50, 0), format: 'jpeg', name: 'zh.jpg' }],
    ['PNG with width 0', { bytes: makePng(0, 5), format: 'png', name: 'zw.png' }],
    ['PNG with height 0', { bytes: makePng(5, 0), format: 'png', name: 'zh.png' }],
  ];
  for (const [label, image] of cases) {
    it(`rejects a ${label} as bad-image naming the file`, async () => {
      for (const pageSize of ['fit', 'a4-auto'] as const) {
        await expect(imagesToPdf([image], { pageSize, marginPt: 0 })).rejects.toMatchObject({
          name: 'PdfToolsError',
          code: 'bad-image',
          message: expect.stringContaining(image.name),
        });
      }
    });
  }
});

describe('imagesToPdf option checks', () => {
  it('rejects an unknown page size with a PdfToolsError', async () => {
    await expect(imagesToPdf([png200x100], { pageSize: 'letter' as ImagePageSize, marginPt: 28 })).rejects.toMatchObject({
      name: 'PdfToolsError',
      code: 'invalid-image-options',
    });
  });
});

describe('imagesToPdf fit mode page size limit', () => {
  it('lands exactly on 14,400 pt for a width that rounds badly (16653 x 10)', async () => {
    const doc = await load(await imagesToPdf([jpg('r.jpg', 16653, 10)], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPage(0).getSize().width).toBe(14400);
    expect((await matrix(doc, 0))[0]).toBe(14400);
  });
  it('never exceeds 14,400 pt across widths from 14,401 to 20,000', async () => {
    // Every 7th width: about one width in ten overshoots without the clamp, so 800 samples catch it.
    const images = Array.from({ length: 800 }, (_, i) => jpg('w.jpg', 14401 + i * 7, 10));
    // One document per chunk keeps each save small; pages are checked from the saved files.
    for (let start = 0; start < images.length; start += 600) {
      const doc = await load(await imagesToPdf(images.slice(start, start + 600), { pageSize: 'fit', marginPt: 0 }));
      for (const page of doc.getPages()) {
        expect(Math.max(page.getSize().width, page.getSize().height)).toBeLessThanOrEqual(14400);
      }
    }
  }, 60_000);
  it('scales a very wide image so the longer page side is 14,400 pt', async () => {
    const doc = await load(await imagesToPdf([jpg('w.jpg', 20000, 100)], { pageSize: 'fit', marginPt: 0 }));
    const size = doc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(14400, 3);
    expect(size.height).toBeCloseTo(72, 3);
    const [a, , , d, e, f] = await matrix(doc, 0);
    expect(a).toBeCloseTo(14400, 3);
    expect(d).toBeCloseTo(72, 3);
    expect(e).toBeCloseTo(0, 3);
    expect(f).toBeCloseTo(0, 3);
  });
  it('scales a very tall image so the longer page side is 14,400 pt', async () => {
    const doc = await load(await imagesToPdf([png('t.png', 100, 20000)], { pageSize: 'fit', marginPt: 0 }));
    const size = doc.getPage(0).getSize();
    expect(size.height).toBeCloseTo(14400, 3);
    expect(size.width).toBeCloseTo(72, 3);
  });
  it('leaves an image of exactly 14,400 pt alone', async () => {
    const doc = await load(await imagesToPdf([jpg('x.jpg', 14400, 10)], { pageSize: 'fit', marginPt: 0 }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 14400, height: 10 });
  });
  it('applies the limit to the displayed size of a rotated JPEG', async () => {
    const doc = await load(await imagesToPdf([jpg('r.jpg', 20000, 100, { orientation: 6, order: 'MM' })], { pageSize: 'fit', marginPt: 0 }));
    const size = doc.getPage(0).getSize();
    expect(size.height).toBeCloseTo(14400, 3);
    expect(size.width).toBeCloseTo(72, 3);
  });
});

describe('imagesToPdf purity', () => {
  it('does not change the source bytes', async () => {
    const images = [
      png('a.png', 40, 20),
      png('b.png', 4, 4, { colorType: 6 }),
      png('c.png', 4, 4, { colorType: 3 }),
      png('d.png', 4, 4, { bitDepth: 16 }),
      jpg('e.jpg', 20, 40, { orientation: 3, order: 'II' }),
    ];
    const before = images.map((i) => i.bytes.slice());
    await imagesToPdf(images, A4_AUTO);
    images.forEach((image, n) => expect(Array.from(image.bytes)).toEqual(Array.from(before[n])));
  });
  it('produces a PDF that loads', async () => {
    const out = await imagesToPdf([png200x100], A4_AUTO);
    expect(new TextDecoder().decode(out.slice(0, 5))).toBe('%PDF-');
  });
});
