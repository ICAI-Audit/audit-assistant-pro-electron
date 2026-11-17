// The TIFF reader (tiff.ts): every layout it accepts is decoded to the exact picture it was made from,
// every result is drawn by pdf.js and compared pixel for pixel (JPEG within its tolerance), and every
// hostile or unsupported file is refused with one plain sentence, quickly, and never with anything but
// a PdfToolsError. Files are built in the test (testTiff.ts); no real scan is used.
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { imagesToPdf } from './imagesToPdf';
import { renderPage, type Raster } from './testMarksPdf';
import {
  T,
  baselineJpeg,
  bilevelPicture,
  editJpeg,
  entryAt,
  greyPicture,
  jpegOf,
  makeTiff,
  makeTiffFile,
  packBits1,
  packSamples,
  pageIfd,
  poke32,
  rgbPicture,
  seeded,
  smoothRgbPicture,
  splitJpegTables,
  textPagePicture,
  writeTiff,
  type PageSpec,
} from './testTiff';
import {
  TIFF_LIMITS,
  TiffRefusal,
  decodeTiffPage,
  readTiff,
  tiffPageJpeg,
  tiffToImage,
  tiffToPdf,
  type TiffPixels,
} from './tiff';
import { PdfToolsError } from './types';

vi.setConfig({ testTimeout: 120_000 });

beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  await renderPage(await doc.save(), 1);
}, 60_000);

const noPause = async () => undefined;

async function refusal(work: () => unknown): Promise<PdfToolsError> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(PdfToolsError);
    return error as PdfToolsError;
  }
  throw new Error('expected a refusal');
}

/** Words the owner does not want on screen (14 November 2026: no technical words). */
const TECHNICAL = /compression|strip|tile|IFD|predictor|sample|BigTIFF|CCITT|LZW|YCbCr|CMYK|Lab colour|palette|planar|-bit|JPEG|deflate|PackBits|byte|codec/i;

/** One plain sentence that says what to do; `contains` is looked for in it or in the refusal's off-screen detail. */
function expectPlainRefusal(error: PdfToolsError, contains: string | RegExp): void {
  expect(error.code).toBe('bad-image');
  expect(error).toBeInstanceOf(TiffRefusal);
  const said = `${error.message} [${(error as TiffRefusal).detail}]`;
  if (typeof contains === 'string') expect(said).toContain(contains);
  else expect(said).toMatch(contains);
  expect(error.message).toMatch(/add (it|them) again\.$/);
  expect(error.message.slice(0, -1)).not.toMatch(/[.!?]\s/);
  expect(error.message).not.toMatch(TECHNICAL);
}

async function decodeFirst(bytes: Uint8Array, page = 0): Promise<TiffPixels> {
  const file = readTiff(bytes);
  return decodeTiffPage(bytes, file.pages[page], { pause: noPause });
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));

// ---- expected pictures -----------------------------------------------------------------------------

/** Output convention for bilevel: packed rows, 1 = white. */
const bilevelOut = (black: Uint8Array, w: number, h: number) => packBits1(black, w, h, true);

function bilevelSpec(black: Uint8Array, w: number, h: number, photometric: 0 | 1, extra: Partial<PageSpec> = {}): PageSpec {
  return { width: w, height: h, bitsPerSample: 1, photometric, samples: packBits1(black, w, h, photometric === 1), ...extra };
}

/** RGBA of a page drawn by pdf.js versus an expected grey or RGB picture. */
function differences(raster: Raster, expected: Uint8Array, channels: 1 | 3): { max: number; mean: number; count: number } {
  let max = 0;
  let sum = 0;
  let count = 0;
  const n = raster.width * raster.height;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const want = channels === 1 ? expected[i] : expected[i * 3 + c];
      const d = Math.abs(raster.data[i * 4 + c] - want);
      if (d > max) max = d;
      if (d > 0) count++;
      sum += d;
    }
  }
  return { max, mean: sum / (n * 3), count };
}

function bilevelToGrey(black: Uint8Array): Uint8Array {
  return black.map((b) => (b ? 0 : 255));
}

/** Displayed picture of stored pixels (c channels) under a TIFF orientation (TIFF 6.0, tag 274). */
function oriented(src: Uint8Array, w: number, h: number, c: number, o: number): { data: Uint8Array; w: number; h: number } {
  const swap = o >= 5;
  const dw = swap ? h : w;
  const dh = swap ? w : h;
  const out = new Uint8Array(dw * dh * c);
  for (let Y = 0; Y < dh; Y++) {
    for (let X = 0; X < dw; X++) {
      let x: number;
      let y: number;
      switch (o) {
        case 2: [x, y] = [w - 1 - X, Y]; break;
        case 3: [x, y] = [w - 1 - X, h - 1 - Y]; break;
        case 4: [x, y] = [X, h - 1 - Y]; break;
        case 5: [x, y] = [Y, X]; break;
        case 6: [x, y] = [Y, h - 1 - X]; break;
        case 7: [x, y] = [w - 1 - Y, h - 1 - X]; break;
        case 8: [x, y] = [w - 1 - Y, X]; break;
        default: [x, y] = [X, Y];
      }
      for (let k = 0; k < c; k++) out[(Y * dw + X) * c + k] = src[(y * w + x) * c + k];
    }
  }
  return { data: out, w: dw, h: dh };
}

/** A PNG decoded by Node's zlib and the PNG filters, for an independent look at what tiff.ts wrote. */
function decodePng(png: Uint8Array): { width: number; height: number; depth: number; colour: number; rows: Uint8Array; ppm: [number, number] | null } {
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let ppm: [number, number] | null = null;
  const idat: Uint8Array[] = [];
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = data[8];
      colour = data[9];
    } else if (type === 'pHYs') {
      ppm = [view.getUint32(pos + 8), view.getUint32(pos + 12)];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + len;
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const bpp = colour === 2 ? 3 : 1;
  const rowBytes = colour === 2 ? width * 3 : depth === 1 ? (width + 7) >> 3 : width;
  const rows = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const line = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? rows[y * rowBytes + i - bpp] : 0;
      const b = y > 0 ? rows[(y - 1) * rowBytes + i] : 0;
      const c = i >= bpp && y > 0 ? rows[(y - 1) * rowBytes + i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[y * rowBytes + i] = v & 255;
    }
  }
  return { width, height, depth, colour, rows, ppm };
}

// ---- reading the structure ---------------------------------------------------------------------------

describe('readTiff', () => {
  const W = 37;
  const H = 23;
  const grey = greyPicture(W, H);

  it('reads both byte orders the same, with the page count, size and resolution', async () => {
    for (const order of ['II', 'MM'] as const) {
      const bytes = makeTiff(
        [
          { width: W, height: H, photometric: 1, samples: grey, compression: 'lzw', predictor: 2, resolution: { x: 300, y: 300 } },
          { width: 20, height: 10, photometric: 2, samplesPerPixel: 3, samples: rgbPicture(20, 10), resolution: { x: 118.11, y: 118.11, unit: 3 } },
        ],
        order,
      );
      const file = readTiff(bytes);
      expect(file.pages.map((p) => [p.number, p.width, p.height, p.kind])).toEqual([
        [1, W, H, 'grey'],
        [2, 20, 10, 'rgb'],
      ]);
      expect(file.pages[0].xDpi).toBeCloseTo(300, 3);
      expect(file.pages[1].xDpi).toBeCloseTo(300, 1); // 118.11 per cm
      expect(file.asImage).toBe(false);
      expect(same((await decodeFirst(bytes)).data, grey)).toBe(true);
    }
  });

  it('keeps one upright page with square pixels as an image; several pages, a turned page or uneven pixels become a PDF', () => {
    const one = (extra: Partial<PageSpec>) => readTiff(makeTiff([{ width: W, height: H, photometric: 1, samples: grey, ...extra }])).asImage;
    expect(one({})).toBe(true);
    expect(one({ resolution: null })).toBe(true);
    expect(one({ orientation: 6 })).toBe(false);
    expect(one({ resolution: { x: 204, y: 98 } })).toBe(false);
    expect(one({ resolution: { x: 300, y: 301 } })).toBe(true); // within 1%
    const two = makeTiff([{ width: W, height: H, photometric: 1, samples: grey }, { width: W, height: H, photometric: 1, samples: grey }]);
    expect(readTiff(two).asImage).toBe(false);
  });

  it('skips reduced-resolution copies and transparency masks (NewSubfileType 1 and 4)', () => {
    const bytes = makeTiff([
      { width: 8, height: 8, photometric: 1, samples: greyPicture(8, 8), newSubfileType: 1 },
      { width: W, height: H, photometric: 1, samples: grey, newSubfileType: 2 },
      { width: W, height: H, photometric: 0, bitsPerSample: 1, samples: packBits1(new Uint8Array(W * H), W, H), newSubfileType: 4 },
    ]);
    const file = readTiff(bytes);
    expect(file.pages.map((p) => [p.number, p.width])).toEqual([[1, W]]);
    expect(file.asImage).toBe(true);
  });

  it('refuses BigTIFF, a file that is not a TIFF, and a header cut short', async () => {
    const big = new Uint8Array([0x49, 0x49, 43, 0, 8, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0, 0]);
    expectPlainRefusal(await refusal(() => readTiff(big)), 'BigTIFF');
    expectPlainRefusal(await refusal(() => readTiff(new Uint8Array([0x4d, 0x4d, 0, 43, 0, 8, 0, 0]))), 'BigTIFF');
    expectPlainRefusal(await refusal(() => readTiff(new Uint8Array([0x49, 0x49, 7, 0, 8, 0, 0, 0]))), 'damaged');
    expectPlainRefusal(await refusal(() => readTiff(new Uint8Array([0x49, 0x49, 42, 0]))), 'damaged');
  });

  it('refuses a looping list of pages at once (to itself, to an earlier page)', async () => {
    const file = makeTiffFile([{ width: W, height: H, photometric: 1, samples: grey }, { width: W, height: H, photometric: 1, samples: grey }]);
    poke32(file, file.nextPointers[1], file.ifdOffsets[0]);
    const started = performance.now();
    expectPlainRefusal(await refusal(() => readTiff(file.bytes)), 'damaged');
    const self = makeTiffFile([{ width: W, height: H, photometric: 1, samples: grey }]);
    poke32(self, self.nextPointers[0], self.ifdOffsets[0]);
    expectPlainRefusal(await refusal(() => readTiff(self.bytes)), 'damaged');
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('refuses offsets and counts past the end of the file, and huge counts, without allocating them', async () => {
    const cases: [string, (f: ReturnType<typeof makeTiffFile>) => void][] = [
      ['first IFD past the end', (f) => poke32(f, 4, f.bytes.length + 10)],
      ['next IFD past the end', (f) => poke32(f, f.nextPointers[0], f.bytes.length - 3)],
      ['strip offset past the end', (f) => poke32(f, entryAt(f, 0, 273) + 8, f.bytes.length + 100)],
      ['StripOffsets count 2^32-1', (f) => poke32(f, entryAt(f, 0, 273) + 4, 0xffffffff)],
      ['StripByteCounts count 2^32-1', (f) => poke32(f, entryAt(f, 0, 279) + 4, 0xffffffff)],
      ['ImageWidth count huge', (f) => poke32(f, entryAt(f, 0, 256) + 4, 0x40000000)],
    ];
    for (const [, breakIt] of cases) {
      const f = makeTiffFile([{ width: W, height: H, photometric: 1, samples: grey, compression: 'packbits', rowsPerStrip: 5 }]);
      breakIt(f);
      const started = performance.now();
      const error = await refusal(async () => {
        const file = readTiff(f.bytes);
        await decodeTiffPage(f.bytes, file.pages[0], { pause: noPause });
      });
      expectPlainRefusal(error, /damaged|cut short/);
      expect(performance.now() - started).toBeLessThan(500);
    }
    // the IFD's entry count runs past the end
    const g = makeTiffFile([{ width: W, height: H, photometric: 1, samples: grey }]);
    g.bytes[g.ifdOffsets[0]] = 0xff;
    g.bytes[g.ifdOffsets[0] + 1] = 0xff;
    expectPlainRefusal(await refusal(() => readTiff(g.bytes)), 'damaged');
  });

  it('refuses a strip that is cut short, and every truncation of a file, with a sentence', async () => {
    const black = bilevelPicture(W, H);
    const bytes = makeTiff([
      { width: W, height: H, photometric: 1, samples: grey, compression: 'deflate', rowsPerStrip: 4 },
      { width: W, height: H, photometric: 0, bitsPerSample: 1, samples: packBits1(black, W, H), compression: 'g4' },
    ]);
    const whole = [grey, packBits1(black, W, H, true)];
    let refused = 0;
    for (let cut = 1; cut < bytes.length; cut += 7) {
      const part = bytes.slice(0, cut);
      let pages: TiffPixels[];
      try {
        const file = readTiff(part);
        pages = [];
        for (const page of file.pages) pages.push(await decodeTiffPage(part, page, { pause: noPause }));
      } catch (error) {
        expectPlainRefusal(error as PdfToolsError, /damaged|cut short/);
        refused++;
        continue;
      }
      // accepted only when nothing it needs was cut off: every page, exactly as in the whole file (REV-A M8)
      expect({ cut, pages: pages.length }).toEqual({ cut, pages: 2 });
      pages.forEach((px, i) => expect({ cut, page: i + 1, same: same(px.data, whole[i]) }).toEqual({ cut, page: i + 1, same: true }));
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('refuses a page over the image limits, naming its size, before decoding anything', async () => {
    const tooWide = makeTiff([{ width: 20_001, height: 1, photometric: 1, samples: new Uint8Array(20_001), compression: 'packbits' }]);
    const e1 = await refusal(() => readTiff(tooWide));
    expectPlainRefusal(e1, '20,001 × 1 pixels');
    expect(e1.message).toContain('20,000 pixels a side');
    // 8,000 x 8,000 = 64 megapixels: written with a tiny (bogus) strip, refused from the tags alone
    const big = writeTiff([{ ...pageIfd({ width: 1, height: 1, photometric: 1, samples: new Uint8Array(1) }), entries: [
      { tag: 256, type: T.LONG, values: [8000] }, { tag: 257, type: T.LONG, values: [8000] }, { tag: 258, type: T.SHORT, values: [8] },
      { tag: 259, type: T.SHORT, values: [8] }, { tag: 262, type: T.SHORT, values: [1] }, { tag: 278, type: T.LONG, values: [8000] },
    ] }]).bytes;
    expectPlainRefusal(await refusal(() => readTiff(big)), '50 megapixels');
    expect(TIFF_LIMITS).toMatchObject({ maxSide: 20_000, maxPixels: 50_000_000 });
  });

  it('refuses more pages than it converts at once, and more picture data than it opens at once', async () => {
    const tiny: PageSpec = { width: 1, height: 1, photometric: 1, samples: new Uint8Array([7]) };
    const many = makeTiff(new Array(TIFF_LIMITS.maxPages + 1).fill(tiny));
    expectPlainRefusal(await refusal(() => readTiff(many)), '1,000 pages');
    expect(readTiff(makeTiff(new Array(TIFF_LIMITS.maxPages).fill(tiny))).pages).toHaveLength(TIFF_LIMITS.maxPages);
    // 25 RGB pages of 7,000 x 7,000 declared (3.4 GB once opened), each with a tiny strip
    const ifd = (): ReturnType<typeof pageIfd> => ({ ...pageIfd(tiny), entries: [
      { tag: 256, type: T.LONG, values: [7000] }, { tag: 257, type: T.LONG, values: [7000] }, { tag: 258, type: T.SHORT, values: [8, 8, 8] },
      { tag: 259, type: T.SHORT, values: [8] }, { tag: 262, type: T.SHORT, values: [2] }, { tag: 277, type: T.SHORT, values: [3] }, { tag: 278, type: T.LONG, values: [7000] },
    ] });
    const heavy = writeTiff(new Array(25).fill(0).map(ifd)).bytes;
    expectPlainRefusal(await refusal(() => readTiff(heavy)), 'more picture data');
  });

  const unsupported: [string, Partial<PageSpec>, string | RegExp][] = [
    ['old-style JPEG (6)', { extra: [{ tag: 259, type: T.SHORT, values: [6] }], omit: [259] }, 'old-style JPEG'],
    ['JBIG (34661)', { extra: [{ tag: 259, type: T.SHORT, values: [34661] }], omit: [259] }, 'JBIG compression'],
    ['an unknown compression', { extra: [{ tag: 259, type: T.SHORT, values: [12345] }], omit: [259] }, 'number 12345'],
    ['16-bit samples', { bitsPerSample: 16, samples: new Uint8Array(W * H * 2) }, '16-bit'],
    ['floating-point samples', { bitsPerSample: 32, sampleFormat: 3, samples: new Uint8Array(W * H * 4) }, /floating-point|32-bit/],
    ['signed samples', { sampleFormat: 2 }, 'signed'],
    ['CMYK', { photometric: 5, samplesPerPixel: 4, samples: new Uint8Array(W * H * 4) }, 'CMYK'],
    ['CIE Lab', { photometric: 8, samplesPerPixel: 3, samples: new Uint8Array(W * H * 3) }, 'Lab'],
    ['YCbCr without JPEG', { photometric: 6, samplesPerPixel: 3, samples: new Uint8Array(W * H * 3) }, 'YCbCr'],
    ['palette with alpha', { photometric: 3, samplesPerPixel: 2, extraSamples: [2], colorMap: new Array(768).fill(0), samples: new Uint8Array(W * H * 2) }, 'palette'],
    ['two extra channels', { photometric: 2, samplesPerPixel: 5, extraSamples: [2, 0], samples: new Uint8Array(W * H * 5) }, 'extra channel'],
    ['planar with alpha', { photometric: 2, samplesPerPixel: 4, extraSamples: [2], planar: 2, samples: new Uint8Array(W * H * 4) }, /separate planes/],
    ['the floating-point predictor', { predictor: 3 as 1, compression: 'lzw' }, 'predictor'],
    ['bit-reversed 8-bit samples', { fillOrder: 2 }, 'bit order'],
    ['a palette without its colour map', { photometric: 3 }, 'damaged'],
  ];
  it.each(unsupported)('refuses %s with a sentence that names it', async (_name, extra, contains) => {
    const spec: PageSpec = { width: W, height: H, photometric: 1, samples: grey, ...extra };
    expectPlainRefusal(await refusal(() => readTiff(makeTiff([spec]))), contains);
  });

  it('names the page of a several-page file that it refuses', async () => {
    const bytes = makeTiff([
      { width: W, height: H, photometric: 1, samples: grey },
      { width: W, height: H, photometric: 1, samples: grey },
      { width: W, height: H, photometric: 5, samplesPerPixel: 4, samples: new Uint8Array(W * H * 4) },
    ]);
    const error = await refusal(() => readTiff(bytes));
    expectPlainRefusal(error, 'CMYK');
    expect(error.message).toBe('Page 3 of this TIFF is saved in a form PDF Tools cannot read; save it as PDF, JPG or PNG and add it again.');
  });

  it('refuses old-style LZW and fax data in uncompressed mode when the page is opened', async () => {
    const f = makeTiffFile([{ width: W, height: H, photometric: 1, samples: grey, compression: 'lzw' }]);
    const strip = f.bytes.subarray(8);
    strip[0] = 0;
    strip[1] = 1;
    expectPlainRefusal(await refusal(() => decodeFirst(f.bytes)), 'old form of LZW');
    const fax = makeTiffFile([bilevelSpec(new Uint8Array(W * H), W, H, 0, { compression: 'g4' })]);
    fax.bytes.set([0b00000011, 0b11000000], 8);
    expectPlainRefusal(await refusal(() => decodeFirst(fax.bytes)), 'uncompressed mode');
  });
});

// ---- decoding every layout -----------------------------------------------------------------------

describe('decodeTiffPage: bilevel', () => {
  const W = 61;
  const H = 45;
  const black = bilevelPicture(W, H, 21);
  const expected = bilevelOut(black, W, H);
  const compressions = ['none', 'packbits', 'lzw', 'deflate', 'deflate-old', 'g4', 'g3-1d', 'g3-2d', 'mh'] as const;

  for (const compression of compressions) {
    it(`${compression}: both photometric senses, both bit orders, strips and tiles`, async () => {
      for (const photometric of [0, 1] as const) {
        for (const fillOrder of [1, 2] as const) {
          for (const layout of [{ rowsPerStrip: 7 }, { rowsPerStrip: H }, { tile: { width: 32, height: 16 } }]) {
            const bytes = makeTiff([bilevelSpec(black, W, H, photometric, { compression, fillOrder, ...layout, fax: { fillBits: true } })]);
            const px = await decodeFirst(bytes);
            expect(px).toMatchObject({ kind: 'bilevel', width: W, height: H, rowBytes: 8 });
            expect(same(px.data, expected)).toBe(true);
          }
        }
      }
    });
  }

  it('reads Group 3 with 2-D rows every fourth row, and without a first EOL', async () => {
    for (const fax of [{ k: 4 }, { firstEol: false }, { end: false, fillBits: true }]) {
      const bytes = makeTiff([bilevelSpec(black, W, H, 0, { compression: 'g3-2d', fax, rowsPerStrip: 11 })]);
      expect(same((await decodeFirst(bytes)).data, expected)).toBe(true);
    }
  });

  it('ignores a Predictor tag where libtiff does (no compression, PackBits, fax)', async () => {
    const grey = greyPicture(W, H, 4);
    for (const compression of ['none', 'packbits'] as const) {
      const bytes = makeTiff([{ width: W, height: H, photometric: 1, samples: grey, compression, predictor: 2 }]);
      expect(same((await decodeFirst(bytes)).data, grey)).toBe(true);
    }
    const fax = makeTiff([bilevelSpec(black, W, H, 0, { compression: 'g4', extra: [{ tag: 317, type: T.SHORT, values: [2] }] })]);
    expect(same((await decodeFirst(fax)).data, expected)).toBe(true);
  });

  it('assumes white-is-zero for fax data without a PhotometricInterpretation tag', async () => {
    const bytes = makeTiff([bilevelSpec(black, W, H, 0, { compression: 'g4', omit: [262] })]);
    expect(same((await decodeFirst(bytes)).data, expected)).toBe(true);
  });
});

describe('decodeTiffPage: grey, colour and palette', () => {
  const W = 37;
  const H = 23;
  const grey = greyPicture(W, H, 5);
  const rgb = rgbPicture(W, H, 6);
  const layouts: Partial<PageSpec>[] = [{ rowsPerStrip: 5 }, { rowsPerStrip: H }, { tile: { width: 16, height: 16 } }];
  const codecs: Partial<PageSpec>[] = [
    { compression: 'none' },
    { compression: 'packbits' },
    { compression: 'lzw' },
    { compression: 'lzw', predictor: 2 },
    { compression: 'deflate', predictor: 2 },
    { compression: 'deflate-old' },
  ];

  it('8-bit grey, black-is-zero and white-is-zero, every compression and layout', async () => {
    for (const codec of codecs) {
      for (const layout of layouts) {
        for (const photometric of [0, 1]) {
          const samples = photometric === 0 ? grey.map((v) => 255 - v) : grey;
          const px = await decodeFirst(makeTiff([{ width: W, height: H, photometric, samples, ...codec, ...layout }]));
          expect(px.kind).toBe('grey');
          expect(same(px.data, grey)).toBe(true);
        }
      }
    }
  });

  it('2- and 4-bit grey are widened exactly (x85, x17)', async () => {
    for (const bits of [2, 4]) {
      const levels = (1 << bits) - 1;
      const values = grey.map((v) => Math.round((v * levels) / 255));
      for (const layout of layouts) {
        for (const photometric of [0, 1]) {
          const stored = photometric === 0 ? values.map((v) => levels - v) : values;
          const samples = layout.tile ? packSamples(stored, W, H, bits) : packSamples(stored, W, H, bits);
          const px = await decodeFirst(makeTiff([{ width: W, height: H, photometric, bitsPerSample: bits, samples, compression: 'lzw', ...layout }]));
          expect(same(px.data, values.map((v) => (v * 255) / levels))).toBe(true);
        }
      }
    }
  });

  it('RGB, chunky and planar, every compression and layout', async () => {
    for (const codec of codecs) {
      for (const layout of layouts) {
        for (const planar of [1, 2] as const) {
          const px = await decodeFirst(makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 3, samples: rgb, planar, ...codec, ...layout }]));
          expect(px.kind).toBe('rgb');
          expect(same(px.data, rgb)).toBe(true);
        }
      }
    }
  });

  it('flattens alpha onto white: unassociated, associated, and ignores an unspecified extra channel', async () => {
    const rnd = seeded(31);
    const alpha = new Uint8Array(W * H).map((_, i) => (i % 7 === 0 ? 0 : i % 5 === 0 ? 255 : Math.floor(rnd() * 256)));
    const unassoc = (c: number, a: number) => Math.floor((c * a + 255 * (255 - a) + 127) / 255);
    const rgba = new Uint8Array(W * H * 4);
    const premultiplied = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      for (let c = 0; c < 3; c++) {
        rgba[i * 4 + c] = rgb[i * 3 + c];
        premultiplied[i * 4 + c] = Math.round((rgb[i * 3 + c] * alpha[i]) / 255);
      }
      rgba[i * 4 + 3] = alpha[i];
      premultiplied[i * 4 + 3] = alpha[i];
    }
    const flatUnassoc = new Uint8Array(W * H * 3).map((_, j) => unassoc(rgb[j], alpha[Math.floor(j / 3)]));
    const flatAssoc = new Uint8Array(W * H * 3).map((_, j) => Math.min(255, premultiplied[Math.floor(j / 3) * 4 + (j % 3)] + 255 - alpha[Math.floor(j / 3)]));
    for (const layout of layouts) {
      const a = await decodeFirst(makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 4, extraSamples: [2], samples: rgba, compression: 'deflate', ...layout }]));
      expect(same(a.data, flatUnassoc)).toBe(true);
      const b = await decodeFirst(makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 4, extraSamples: [1], samples: premultiplied, compression: 'lzw', predictor: 2, ...layout }]));
      expect(same(b.data, flatAssoc)).toBe(true);
      const c = await decodeFirst(makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 4, extraSamples: [0], samples: rgba, ...layout }]));
      expect(same(c.data, rgb)).toBe(true);
      // grey with alpha, white-is-zero
      const ga = new Uint8Array(W * H * 2);
      for (let i = 0; i < W * H; i++) {
        ga[i * 2] = 255 - grey[i];
        ga[i * 2 + 1] = alpha[i];
      }
      const d = await decodeFirst(makeTiff([{ width: W, height: H, photometric: 0, samplesPerPixel: 2, extraSamples: [2], samples: ga, compression: 'packbits', ...layout }]));
      expect(d.kind).toBe('grey');
      expect(same(d.data, grey.map((v, i) => unassoc(v, alpha[i])))).toBe(true);
    }
  });

  it('palette colour at 1, 2, 4 and 8 bits, 16-bit and 8-bit-style colour maps', async () => {
    for (const bits of [1, 2, 4, 8]) {
      const n = 1 << bits;
      const rnd = seeded(bits);
      const colours = Array.from({ length: n }, () => [0, 0, 0].map(() => Math.floor(rnd() * 256)));
      const indices = new Uint8Array(W * H).map(() => Math.floor(rnd() * n));
      const expected = new Uint8Array(W * H * 3);
      indices.forEach((ix, i) => expected.set(colours[ix], i * 3));
      // 16-bit maps are written as value x 257 (libtiff's own tools) or value x 256 (Pillow, many scanners): both exact (REV-A S11)
      for (const style of ['16-bit', '16-bit x256', '8-bit'] as const) {
        const colorMap = [0, 1, 2].flatMap((c) => colours.map((col) => (style === '16-bit' ? col[c] * 257 : style === '16-bit x256' ? col[c] * 256 : col[c])));
        for (const layout of layouts) {
          const px = await decodeFirst(makeTiff([{ width: W, height: H, photometric: 3, bitsPerSample: bits, colorMap, samples: packSamples(indices, W, H, bits), compression: 'packbits', ...layout }]));
          expect(px.kind).toBe('rgb');
          expect(same(px.data, expected)).toBe(true);
        }
      }
    }
  });

  it('pauses while decoding a large page', async () => {
    const big = greyPicture(1200, 900, 3);
    const bytes = makeTiff([{ width: 1200, height: 900, photometric: 1, samples: big, compression: 'lzw', predictor: 2 }]);
    let pauses = 0;
    const file = readTiff(bytes);
    const px = await decodeTiffPage(bytes, file.pages[0], {
      pause: async () => {
        pauses++;
      },
      sliceMs: 0,
    });
    expect(same(px.data, big)).toBe(true);
    expect(pauses).toBeGreaterThan(5);
  });
});

// ---- JPEG pages ------------------------------------------------------------------------------------------

/** Draws a JPEG with pdf.js, optionally telling it the samples are RGB (ColorTransform 0). */
async function renderJpeg(jpeg: Uint8Array, w: number, h: number, channels: 1 | 3, colorTransform?: 0): Promise<Raster> {
  const doc = await PDFDocument.create();
  const image = doc.context.register(doc.context.stream(jpeg, {
    Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: channels === 3 ? 'DeviceRGB' : 'DeviceGray', BitsPerComponent: 8,
    Filter: 'DCTDecode', ...(colorTransform === 0 ? { DecodeParms: { ColorTransform: 0 } } : {}),
  } as never));
  const page = doc.addPage([w, h]);
  page.node.setXObject(PDFName.of('Im0'), image);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`)));
  return renderPage(await doc.save(), 1, 1);
}

describe('JPEG pages (compression 7)', () => {
  const W = 64;
  const H = 40;
  const rgb = smoothRgbPicture(W, H);
  const grey = rgb.filter((_, i) => i % 3 === 1);
  let colourJpeg: Uint8Array;
  let greyJpeg: Uint8Array;
  beforeAll(async () => {
    colourJpeg = await jpegOf(rgb, W, H, 3);
    greyJpeg = baselineJpeg(grey, W, H, 1);
  });

  it('the test JPEGs are close to their pictures when pdf.js draws them', async () => {
    expect(differences(await renderJpeg(colourJpeg, W, H, 3), rgb, 3).mean).toBeLessThan(3);
    expect(differences(await renderJpeg(greyJpeg, W, H, 1), grey, 1).max).toBeLessThan(4);
  });

  it('a YCbCr page, whole or with JPEGTables, is the same JPEG picture, close to the source', async () => {
    const reference = await renderJpeg(colourJpeg, W, H, 3);
    const { tables, strip } = splitJpegTables(colourJpeg);
    for (const jpeg of [{ strip: colourJpeg }, { strip, tables }]) {
      const bytes = makeTiff([{ width: W, height: H, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg }]);
      const file = readTiff(bytes);
      expect(file.pages[0].kind).toBe('jpeg');
      const made = tiffPageJpeg(bytes, file.pages[0]);
      const shown = await renderJpeg(made, W, H, 3);
      expect(same(new Uint8Array(shown.data), new Uint8Array(reference.data))).toBe(true);
      const d = differences(shown, rgb, 3);
      expect(d.mean).toBeLessThan(3);
    }
  });

  it('an RGB page as libtiff writes it (component ids 0,1,2, no JFIF, no colour transform) is marked as RGB, so readers do not convert its colours', async () => {
    for (const raw of [baselineJpeg(rgb, W, H, 3, { ids: [0, 1, 2] }), editJpeg(colourJpeg, { dropApp0: true, componentIds: [0, 1, 2] })]) {
      const asRgb = await renderJpeg(raw, W, H, 3, 0);
      const bytes = makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: raw } }]);
      const made = tiffPageJpeg(bytes, readTiff(bytes).pages[0]);
      // an Adobe marker with transform 0 right after SOI
      expect(Array.from(made.subarray(0, 18))).toEqual([0xff, 0xd8, 0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0]);
      const shown = await renderJpeg(made, W, H, 3);
      expect(same(new Uint8Array(shown.data), new Uint8Array(asRgb.data))).toBe(true);
    }
    // and the stored samples are the picture itself
    const raw = baselineJpeg(rgb, W, H, 3, { ids: [0, 1, 2] });
    const bytes = makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: raw } }]);
    expect(differences(await renderJpeg(tiffPageJpeg(bytes, readTiff(bytes).pages[0]), W, H, 3), rgb, 3).max).toBeLessThan(4);
  });

  it('a grey page, and markers that would change how it is shown (EXIF orientation, a contrary Adobe marker) are removed', async () => {
    const withOrientation = editJpeg(greyJpeg, { addApp1Orientation: 6 });
    const bytes = makeTiff([{ width: W, height: H, photometric: 1, compression: 'jpeg', jpeg: { strip: withOrientation } }]);
    const made = tiffPageJpeg(bytes, readTiff(bytes).pages[0]);
    expect(Buffer.from(made).includes(Buffer.from('Exif'))).toBe(false);
    const shown = await renderJpeg(made, W, H, 1);
    expect(same(new Uint8Array(shown.data), new Uint8Array((await renderJpeg(greyJpeg, W, H, 1)).data))).toBe(true);
    const contrary = editJpeg(colourJpeg, { addAdobeTransform: 0 });
    const ycc = makeTiff([{ width: W, height: H, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: contrary } }]);
    const fixedUp = tiffPageJpeg(ycc, readTiff(ycc).pages[0]);
    expect(fixedUp[17]).toBe(1); // the Adobe marker now says YCbCr
    expect(same(new Uint8Array((await renderJpeg(fixedUp, W, H, 3)).data), new Uint8Array((await renderJpeg(colourJpeg, W, H, 3)).data))).toBe(true);
  });

  it('refuses JPEG that is not one whole picture, or of a kind readers do not all show', async () => {
    const half = baselineJpeg(rgb.subarray(0, W * 20 * 3), W, 20, 3);
    const cases: [string, Partial<PageSpec>, string | RegExp][] = [
      ['a frame of another size', { jpeg: { strip: half } }, 'JPEG'],
      ['several strips', { extra: [{ tag: 278, type: T.LONG, values: [20] }], omit: [278], jpeg: { strip: colourJpeg } }, 'JPEG'],
      ['a strip cut short', { jpeg: { strip: colourJpeg.slice(0, colourJpeg.length - 200) } }, /damaged|cut short/],
      ['arithmetic coding', { jpeg: { strip: Uint8Array.from(colourJpeg).map((b, i, a) => (b === 0xc0 && a[i - 1] === 0xff ? 0xc9 : b)) } }, 'JPEG'],
      ['white-is-zero JPEG', { photometric: 0, samplesPerPixel: 1, jpeg: { strip: greyJpeg } }, 'JPEG'],
      ['CMYK JPEG', { photometric: 5, samplesPerPixel: 4, jpeg: { strip: colourJpeg } }, 'CMYK'],
    ];
    for (const [, extra, contains] of cases) {
      const spec: PageSpec = { width: W, height: H, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', ...extra };
      expectPlainRefusal(await refusal(() => tiffPageJpeg(makeTiff([spec]), readTiff(makeTiff([spec])).pages[0])), contains);
    }
  });
});

// ---- outputs ------------------------------------------------------------------------------------------

describe('tiffToImage (one upright page)', () => {
  const W = 53;
  const H = 31;
  it('bilevel becomes a 1-bit PNG, grey an 8-bit grey PNG, colour an RGB PNG, each exact, with the resolution', async () => {
    const black = bilevelPicture(W, H, 2);
    const grey = greyPicture(W, H, 2);
    const rgb = rgbPicture(W, H, 2);
    const cases: [PageSpec, number, number, Uint8Array][] = [
      [bilevelSpec(black, W, H, 0, { compression: 'g4', resolution: { x: 300, y: 300 } }), 1, 0, bilevelOut(black, W, H)],
      [{ width: W, height: H, photometric: 1, samples: grey, compression: 'lzw', resolution: { x: 200, y: 200 } }, 8, 0, grey],
      [{ width: W, height: H, photometric: 2, samplesPerPixel: 3, samples: rgb, compression: 'deflate', predictor: 2, resolution: null }, 8, 2, rgb],
    ];
    for (const [spec, depth, colour, rows] of cases) {
      const bytes = makeTiff([spec]);
      const before = createHash('sha256').update(bytes).digest('hex');
      const image = await tiffToImage(bytes, readTiff(bytes), { pause: noPause });
      expect(image.mimeType).toBe('image/png');
      const png = decodePng(image.bytes);
      expect([png.width, png.height, png.depth, png.colour]).toEqual([W, H, depth, colour]);
      expect(same(png.rows, rows)).toBe(true);
      const dpi = spec.resolution ? spec.resolution.x : null;
      expect(png.ppm).toEqual(dpi ? [Math.round(dpi / 0.0254), Math.round(dpi / 0.0254)] : null);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(before); // the TIFF is not changed
      // the way Images to PDF places it, drawn by pdf.js
      const pdf = await imagesToPdf([{ bytes: image.bytes, format: 'png', name: 'x.tif' }], { pageSize: 'fit', marginPt: 0 });
      const shown = await renderPage(pdf, 1, 1);
      const want = depth === 1 ? bilevelToGrey(black) : colour === 2 ? rgb : grey;
      expect(differences(shown, want, colour === 2 ? 3 : 1).max).toBe(0);
    }
  });

  it('a whole-JPEG page stays a JPEG', async () => {
    const rgb = smoothRgbPicture(48, 32);
    const jpeg = await jpegOf(rgb, 48, 32, 3);
    const bytes = makeTiff([{ width: 48, height: 32, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: jpeg } }]);
    const image = await tiffToImage(bytes, readTiff(bytes), { pause: noPause });
    expect(image.mimeType).toBe('image/jpeg');
    expect(Array.from(image.bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
  });
});

describe('tiffToPdf', () => {
  it('a mixed file: every page drawn by pdf.js is the source picture (JPEG within its tolerance)', async () => {
    const W = 47;
    const H = 29;
    const black = bilevelPicture(W, H, 8);
    const grey = greyPicture(W, H, 8);
    const rgb = rgbPicture(W, H, 8);
    const rnd = seeded(4);
    const colours = Array.from({ length: 16 }, () => [0, 0, 0].map(() => Math.floor(rnd() * 256)));
    const indices = new Uint8Array(W * H).map(() => Math.floor(rnd() * 16));
    const paletteRgb = new Uint8Array(W * H * 3);
    indices.forEach((ix, i) => paletteRgb.set(colours[ix], i * 3));
    const photo = smoothRgbPicture(W, H);
    const jpeg = await jpegOf(photo, W, H, 3);
    const pages: [PageSpec, Uint8Array, 1 | 3, number][] = [
      [bilevelSpec(black, W, H, 0, { compression: 'g4' }), bilevelToGrey(black), 1, 0],
      [bilevelSpec(black, W, H, 1, { compression: 'g3-2d', fillOrder: 2, rowsPerStrip: 9 }), bilevelToGrey(black), 1, 0],
      [{ width: W, height: H, photometric: 0, samples: grey.map((v) => 255 - v), compression: 'lzw', predictor: 2, tile: { width: 16, height: 16 } }, grey, 1, 0],
      [{ width: W, height: H, photometric: 2, samplesPerPixel: 3, samples: rgb, compression: 'deflate', planar: 2 }, rgb, 3, 0],
      [{ width: W, height: H, photometric: 3, bitsPerSample: 4, colorMap: [0, 1, 2].flatMap((c) => colours.map((col) => col[c] * 257)), samples: packSamples(indices, W, H, 4), compression: 'packbits' }, paletteRgb, 3, 0],
      [{ width: W, height: H, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: jpeg } }, photo, 3, 4],
    ];
    const bytes = makeTiff(pages.map(([spec]) => spec), 'MM');
    const before = createHash('sha256').update(bytes).digest('hex');
    const progress: number[] = [];
    const checked: number[] = [];
    const pdf = await tiffToPdf(bytes, readTiff(bytes), {
      pause: async ({ page }) => void progress.push(page),
      checkJpeg: async (data) => void checked.push(data.length),
    });
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(before);
    expect(checked).toHaveLength(1);
    expect(new Set(progress)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(pages.length);
    expect(doc.getProducer()).toBe('ICAI VERA');
    expect(doc.getCreator()).toBe('ICAI VERA');
    const wrong: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const [, want, channels, tolerance] = pages[i];
      const shown = await renderPage(pdf, i + 1, 1);
      expect([shown.width, shown.height]).toEqual([W, H]);
      const d = differences(shown, want, channels);
      if (tolerance === 0 ? d.max !== 0 : d.mean >= tolerance) wrong.push(`page ${i + 1}: max ${d.max}, mean ${d.mean.toFixed(2)}, ${d.count} samples differ`);
    }
    expect(wrong).toEqual([]);
  });

  it('sizes each page from its resolution, with a sensible size when it has none, and within what readers accept', async () => {
    const page = (w: number, h: number, resolution: PageSpec['resolution']): PageSpec => ({ width: w, height: h, photometric: 0, bitsPerSample: 1, samples: new Uint8Array(((w + 7) >> 3) * h), compression: 'g4', resolution });
    const bytes = makeTiff([
      page(2480, 3508, { x: 300, y: 300 }), // A4 at 300 dpi
      page(1728, 1143, { x: 204, y: 98 }), // a standard fax page
      page(2480, 3508, null), // no resolution: fits A4
      page(400, 300, null), // small, no resolution: 72 dpi
      page(20_000, 100, { x: 72, y: 72 }), // longer than 14,400 pt: scaled down
      page(1000, 1000, { x: 39.37, y: 39.37, unit: 3 }), // 100 dpi given per centimetre
    ]);
    const pdf = await PDFDocument.load(await tiffToPdf(bytes, readTiff(bytes), { pause: noPause }));
    const sizes = pdf.getPages().map((p) => [Math.round(p.getWidth() * 100) / 100, Math.round(p.getHeight() * 100) / 100]);
    expect(sizes[0]).toEqual([595.2, 841.92]);
    expect(sizes[1]).toEqual([609.88, 839.76]);
    expect(sizes[2][1]).toBeCloseTo(841.89, 1);
    expect(sizes[3]).toEqual([400, 300]);
    expect(sizes[4]).toEqual([14400, 72]);
    expect(sizes[5][0]).toBeCloseTo(720, 1);
  });

  it('honours the eight orientations, for grey and for bilevel pages (whose hidden white row stays off the page)', async () => {
    const W = 23;
    const H = 13;
    const grey = greyPicture(W, H, 12);
    const black = bilevelPicture(W, H, 12);
    const orientations = [1, 2, 3, 4, 5, 6, 7, 8];
    const bytes = makeTiff([
      ...orientations.map((orientation) => ({ width: W, height: H, photometric: 1, samples: grey, orientation })),
      ...orientations.map((orientation) => bilevelSpec(black, W, H, 0, { compression: 'g4', orientation })),
    ]);
    const pdf = await tiffToPdf(bytes, readTiff(bytes), { pause: noPause });
    for (let o = 1; o <= 8; o++) {
      for (const [index, picture] of [[o, grey], [o + 8, bilevelToGrey(black)]] as const) {
        const want = oriented(picture, W, H, 1, o);
        const shown = await renderPage(pdf, index, 1);
        expect([shown.width, shown.height]).toEqual([want.w, want.h]);
        expect(differences(shown, want.data, 1).max).toBe(0);
      }
    }
  });

  it('a bilevel page of every width from 1 to 17 is shown whole by pdf.js, last row included', async () => {
    const pages: PageSpec[] = [];
    const pictures: Uint8Array[] = [];
    for (let w = 1; w <= 17; w++) {
      const black = new Uint8Array(w * 3).fill(1); // all black: a missing pixel shows white
      pictures.push(black);
      pages.push(bilevelSpec(black, w, 3, 0, { compression: 'packbits' }));
    }
    const bytes = makeTiff([...pages, ...pages]); // several pages: kept as a PDF
    const pdf = await tiffToPdf(bytes, readTiff(bytes), { pause: noPause });
    for (let i = 0; i < pages.length; i++) {
      const shown = await renderPage(pdf, i + 1, 1);
      expect(differences(shown, bilevelToGrey(pictures[i]), 1).max).toBe(0);
    }
  });

  it('stops when the pause says so, and refuses a result larger than allowed', async () => {
    const grey = greyPicture(300, 200, 1);
    const bytes = makeTiff([{ width: 300, height: 200, photometric: 1, samples: grey }, { width: 300, height: 200, photometric: 1, samples: grey }]);
    const stop = new Error('stopped');
    await expect(tiffToPdf(bytes, readTiff(bytes), { pause: async () => { throw stop; } })).rejects.toBe(stop);
    expectPlainRefusal(await refusal(() => tiffToPdf(bytes, readTiff(bytes), { pause: noPause, maxOutputBytes: 1000 })), 'would be too large');
  });

  it('a JPEG page that the check refuses is named', async () => {
    const rgb = rgbPicture(16, 16, 1);
    const jpeg = await jpegOf(rgb, 16, 16, 3);
    const spec: PageSpec = { width: 16, height: 16, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: jpeg } };
    const bytes = makeTiff([spec, spec]);
    const error = await refusal(() => tiffToPdf(bytes, readTiff(bytes), { pause: noPause, checkJpeg: async () => { throw new PdfToolsError('bad-image', 'x'); } }));
    expectPlainRefusal(error, 'Page 1 of this TIFF');
  });
});

// ---- hostile files -------------------------------------------------------------------------------------

describe('fuzz', () => {
  it('thousands of mutated files: never a hang, never anything but a PdfToolsError', async () => {
    const W = 29;
    const H = 17;
    const black = bilevelPicture(W, H, 3);
    const grey = greyPicture(W, H, 3);
    const rgb = rgbPicture(W, H, 3);
    const jpeg = await jpegOf(rgb, W, H, 3);
    const corpus = [
      makeTiff([bilevelSpec(black, W, H, 0, { compression: 'g4', rowsPerStrip: 6 }), bilevelSpec(black, W, H, 0, { compression: 'g3-2d' })]),
      makeTiff([bilevelSpec(black, W, H, 1, { compression: 'mh', tile: { width: 16, height: 16 } })], 'MM'),
      makeTiff([{ width: W, height: H, photometric: 1, samples: grey, compression: 'lzw', predictor: 2, rowsPerStrip: 4 }]),
      makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 3, samples: rgb, compression: 'deflate', tile: { width: 16, height: 16 } }], 'MM'),
      makeTiff([{ width: W, height: H, photometric: 2, samplesPerPixel: 3, samples: rgb, compression: 'packbits', planar: 2 }]),
      makeTiff([{ width: W, height: H, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg: splitJpegTables(jpeg) }]),
      makeTiff([{ width: W, height: H, photometric: 3, bitsPerSample: 4, colorMap: new Array(48).fill(0).map((_, i) => i * 1000), samples: packSamples(new Uint8Array(W * H).map((_, i) => i % 16), W, H, 4) }]),
    ];
    const rnd = seeded(2026);
    let refused = 0;
    let accepted = 0;
    let slowest = 0;
    for (let i = 0; i < 3000; i++) {
      const base = corpus[i % corpus.length];
      const bytes = base.slice(0, rnd() < 0.15 ? Math.floor(rnd() * base.length) : base.length);
      const flips = 1 + Math.floor(rnd() * 6);
      for (let f = 0; f < flips; f++) {
        const at = rnd() < 0.5 ? Math.floor(rnd() * Math.min(bytes.length, 400)) : Math.floor(rnd() * bytes.length);
        bytes[at] = rnd() < 0.5 ? bytes[at] ^ (1 << Math.floor(rnd() * 8)) : Math.floor(rnd() * 256);
      }
      const started = performance.now();
      try {
        const file = readTiff(bytes);
        for (const page of file.pages) {
          if (page.kind === 'jpeg') tiffPageJpeg(bytes, page);
          else await decodeTiffPage(bytes, page, { pause: noPause });
        }
        accepted++;
      } catch (error) {
        if (!(error instanceof PdfToolsError)) throw error;
        expect(error.message).toMatch(/again\.$/);
        refused++;
      }
      slowest = Math.max(slowest, performance.now() - started);
    }
    expect(refused).toBeGreaterThan(100);
    expect(accepted).toBeGreaterThan(100);
    expect(slowest).toBeLessThan(2000);
    // and a few hundred all the way to a PDF
    for (let i = 0; i < 300; i++) {
      const base = corpus[i % corpus.length];
      const bytes = base.slice();
      for (let f = 0; f < 3; f++) bytes[Math.floor(rnd() * bytes.length)] = Math.floor(rnd() * 256);
      try {
        const file = readTiff(bytes);
        const out = file.asImage ? (await tiffToImage(bytes, file, { pause: noPause })).bytes : await tiffToPdf(bytes, file, { pause: noPause });
        expect(out.length).toBeGreaterThan(0);
      } catch (error) {
        if (!(error instanceof PdfToolsError)) throw error;
      }
    }
  });
});

// ---- hostile structure: directories and strips that repeat themselves (REV-A B2, B3, S7, S9, S10, M3) -------

/** A little-endian file of `size` bytes with the header filled in (first directory at 8). */
function blankTiff(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size);
  bytes.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  return { bytes, view: new DataView(bytes.buffer) };
}

/** Writes a directory of [tag, type, count, value or offset] entries at `at`; returns where it ends. */
function directoryAt(view: DataView, at: number, entries: number[][], next: number): number {
  view.setUint16(at, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const p = at + 2 + i * 12;
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === T.SHORT && count === 1) view.setUint16(p + 8, value, true);
    else view.setUint32(p + 8, value, true);
  });
  view.setUint32(at + 2 + entries.length * 12, next, true);
  return at + 2 + entries.length * 12 + 4;
}

/** This thread's processor time and heap growth for `work`. */
async function cost(work: () => unknown): Promise<{ outcome: unknown; ms: number; heapMB: number }> {
  const heap = process.memoryUsage().heapUsed;
  let peak = heap;
  const since = process.threadCpuUsage();
  let outcome: unknown;
  try {
    outcome = await work();
  } catch (error) {
    outcome = error;
  }
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  const used = process.threadCpuUsage(since);
  return { outcome, ms: (used.user + used.system) / 1000, heapMB: (peak - heap) / 1048576 };
}

describe('hostile structure', () => {
  it('refuses directories that overlap at once, holding nothing for them (a 0.8 MB directory bomb, REV-A B2)', async () => {
    // 1,000 directories of 65,535 entries each, all sharing one grid of entries: 973 MB at 200 of them, out of memory at 1,000
    const K = 1000;
    const N = 65_535;
    const { bytes, view } = blankTiff(10 + 12 * (N + K) + 4);
    view.setUint16(8, N, true);
    for (let j = 0; j < N + K; j++) {
      const p = 10 + 12 * j;
      view.setUint16(p, j & 0xffff, true);
      view.setUint16(p + 2, T.BYTE, true);
      view.setUint32(p + 4, 1, true);
    }
    for (let k = 0; k < K; k++) view.setUint32(10 + 12 * (k + N), k < K - 1 ? 8 + 12 * (k + 1) : 0, true);
    const { outcome, ms, heapMB } = await cost(() => readTiff(bytes));
    expectPlainRefusal(outcome as PdfToolsError, 'damaged');
    expect(ms).toBeLessThan(1000);
    expect(heapMB).toBeLessThan(64);
  });

  it('reads a directory of 65,000 entries it does not use, and refuses more entries in a file than any file has', async () => {
    const grey = greyPicture(13, 7, 2);
    const unused = Array.from({ length: 65_000 }, (_, i) => ({ tag: 40_000 + (i % 25_000), type: T.SHORT, values: [1] }));
    const one = makeTiff([{ width: 13, height: 7, photometric: 1, samples: grey, extra: unused }]);
    expect(same((await decodeFirst(one)).data, grey)).toBe(true);
    // eight such pages hold 520,000 entries, over TIFF_LIMITS.maxEntries
    const eight = makeTiff(new Array(8).fill({ width: 13, height: 7, photometric: 1, samples: grey, extra: unused }));
    const { outcome, ms } = await cost(() => readTiff(eight));
    expectPlainRefusal(outcome as PdfToolsError, 'damaged');
    expect(ms).toBeLessThan(1000);
    expect(TIFF_LIMITS.maxEntries).toBe(500_000);
  });

  it('refuses pages whose strips or tiles claim the same bytes again, before holding any list of them (REV-A B3)', async () => {
    // 100 pages of 1,000 x 1,000 in 1 x 1 tiles, all pointing at one shared 1 MB table: 1.5 GB of lists, and accepted
    const P = 100;
    const dirSize = 2 + 9 * 12 + 4;
    const tableAt = 8 + P * dirSize;
    const { bytes, view } = blankTiff(tableAt + 1_000_000);
    bytes.fill(1, tableAt);
    for (let p = 0; p < P; p++) {
      const at = 8 + p * dirSize;
      directoryAt(view, at, [[256, T.SHORT, 1, 1000], [257, T.SHORT, 1, 1000], [258, T.SHORT, 1, 8], [259, T.SHORT, 1, 1], [262, T.SHORT, 1, 1], [322, T.SHORT, 1, 1], [323, T.SHORT, 1, 1], [324, T.BYTE, 1_000_000, tableAt], [325, T.BYTE, 1_000_000, tableAt]], p < P - 1 ? at + dirSize : 0);
    }
    const { outcome, ms, heapMB } = await cost(() => readTiff(bytes));
    expectPlainRefusal(outcome as PdfToolsError, 'damaged');
    expect((outcome as PdfToolsError).message).toMatch(/^Page 2 of this TIFF/);
    expect(ms).toBeLessThan(2000);
    expect(heapMB).toBeLessThan(64);
  });

  it('refuses a thousand JPEG pages sharing one strip before rebuilding any (REV-A S7), and a page of strips that all claim the rest of the file (S9)', async () => {
    const P = 1000;
    const n = 2 * 1024 * 1024;
    const dirSize = 2 + 8 * 12 + 4;
    const dataAt = 8 + P * dirSize;
    const jpegs = blankTiff(dataAt + n);
    jpegs.bytes.set([0xff, 0xd8, 0xff, 0xdb, 0, 3, 0, 0xff, 0xc4, 0, 3, 0, 0xff, 0xc0, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0], dataAt);
    jpegs.bytes.set([0xff, 0xd9], dataAt + n - 2);
    for (let p = 0; p < P; p++) {
      const at = 8 + p * dirSize;
      directoryAt(jpegs.view, at, [[256, T.SHORT, 1, 8], [257, T.SHORT, 1, 8], [258, T.SHORT, 1, 8], [259, T.SHORT, 1, 7], [262, T.SHORT, 1, 1], [273, T.LONG, 1, dataAt], [278, T.SHORT, 1, 8], [279, T.LONG, 1, n]], p < P - 1 ? at + dirSize : 0);
    }
    const shared = await cost(() => readTiff(jpegs.bytes));
    expectPlainRefusal(shared.outcome as PdfToolsError, 'damaged');
    expect(shared.ms).toBeLessThan(1000);
    // one 8 x 20,000 fax page whose 20,000 one-row strips all start at one byte and claim 2 GB each
    const S = 20_000;
    const offAt = 8 + 2 + 9 * 12 + 4;
    const cntAt = offAt + 4 * S;
    const quadratic = blankTiff(cntAt + 4 * S + 1 + 1024 * 1024);
    for (let i = 0; i < S; i++) {
      quadratic.view.setUint32(offAt + 4 * i, cntAt + 4 * S, true);
      quadratic.view.setUint32(cntAt + 4 * i, 0x7fffffff, true);
    }
    directoryAt(quadratic.view, 8, [[256, T.SHORT, 1, 8], [257, T.SHORT, 1, S], [258, T.SHORT, 1, 1], [259, T.SHORT, 1, 4], [262, T.SHORT, 1, 0], [273, T.LONG, S, offAt], [278, T.SHORT, 1, 1], [279, T.LONG, S, cntAt], [266, T.SHORT, 1, 1]], 0);
    const repeated = await cost(() => readTiff(quadratic.bytes));
    expectPlainRefusal(repeated.outcome as PdfToolsError, 'damaged');
    expect(repeated.ms).toBeLessThan(1000);
  });

  it('still reads a page whose last strip claims more bytes than are left in the file (cut at its end, as libtiff does)', async () => {
    const grey = greyPicture(40, 30, 7);
    for (const compression of ['none', 'lzw', 'deflate', 'packbits'] as const) {
      const f = makeTiffFile([{ width: 40, height: 30, photometric: 1, samples: grey, compression, rowsPerStrip: 8 }]);
      const counts = entryAt(f, 0, 279);
      const countsAt = new DataView(f.bytes.buffer).getUint32(counts + 8, true);
      poke32(f, countsAt + 4 * 3, 0x7fffffff); // the fourth and last strip
      expect({ compression, same: same((await decodeFirst(f.bytes)).data, grey) }).toEqual({ compression, same: true });
    }
  });

  it('refuses more strips or tiles in one file than it reads at once, from the tags alone', async () => {
    // five honest-looking pages of 1,000 x 1,000 in 1 x 1 tiles, each with its own byte: five million tiles
    const P = 5;
    const n = 1_000_000;
    const dirSize = 2 + 9 * 12 + 4;
    const tablesAt = 8 + P * dirSize;
    const dataAt = tablesAt + P * 5 * n;
    const { bytes, view } = blankTiff(dataAt + P * n);
    bytes.fill(1, tablesAt, dataAt); // every count 1 (bytes), every offset written below
    for (let p = 0; p < P; p++) {
      const offAt = tablesAt + p * 5 * n;
      for (let i = 0; i < n; i++) view.setUint32(offAt + 4 * i, dataAt + p * n + i, true);
      const at = 8 + p * dirSize;
      directoryAt(view, at, [[256, T.SHORT, 1, 1000], [257, T.SHORT, 1, 1000], [258, T.SHORT, 1, 8], [259, T.SHORT, 1, 1], [262, T.SHORT, 1, 1], [322, T.SHORT, 1, 1], [323, T.SHORT, 1, 1], [324, T.LONG, n, offAt], [325, T.BYTE, n, offAt + 4 * n]], p < P - 1 ? at + dirSize : 0);
    }
    const { outcome, ms, heapMB } = await cost(() => readTiff(bytes));
    expectPlainRefusal(outcome as PdfToolsError, 'split it into smaller files');
    expect(ms).toBeLessThan(2000);
    expect(heapMB).toBeLessThan(64);
    expect(TIFF_LIMITS.maxFileChunks).toBe(4_000_000);
  });

  it('counts a tile decoded whole towards the 1 GB, also where it hangs over a small page (REV-A S10)', async () => {
    // 16 x 16 pages, each in its own 4,096 x 4,096 RGBA tile (64 MB decoded), each with its own small Deflate stream
    const z = deflateSync(Buffer.alloc(4096 * 4096 * 4), { level: 9 });
    const tilePages = (P: number) => {
      const dirSize = 2 + 11 * 12 + 4;
      const bitsAt = 8 + P * dirSize;
      const zAt = bitsAt + 8;
      const { bytes, view } = blankTiff(zAt + P * z.length);
      [8, 8, 8, 8].forEach((v, i) => view.setUint16(bitsAt + i * 2, v, true));
      for (let p = 0; p < P; p++) {
        bytes.set(z, zAt + p * z.length);
        const at = 8 + p * dirSize;
        directoryAt(view, at, [[256, T.SHORT, 1, 16], [257, T.SHORT, 1, 16], [258, T.SHORT, 4, bitsAt], [259, T.SHORT, 1, 8], [262, T.SHORT, 1, 2], [277, T.SHORT, 1, 4], [322, T.SHORT, 1, 4096], [323, T.SHORT, 1, 4096], [324, T.LONG, 1, zAt + p * z.length], [325, T.LONG, 1, z.length], [338, T.SHORT, 1, 0]], p < P - 1 ? at + dirSize : 0);
      }
      return bytes;
    };
    expect(readTiff(tilePages(16)).pages).toHaveLength(16); // 16 x 64 MB is the 1 GB itself
    expectPlainRefusal(await refusal(() => readTiff(tilePages(17))), 'more picture data');
  });

  it('turns memory it cannot have into the plain sentence, not a raw error (REV-A M3)', async () => {
    const bytes = makeTiff([{ width: 9, height: 5, photometric: 1, samples: greyPicture(9, 5, 1) }]);
    const page = readTiff(bytes).pages[0];
    const error = await refusal(() => decodeTiffPage(bytes, { ...page, bufferBytes: -1 }, { pause: noPause })); // an allocation that throws RangeError
    expectPlainRefusal(error, 'split it into smaller files');
  });
});

// ---- scale -------------------------------------------------------------------------------------------------

describe('scale', () => {
  it('a 50-page A4 300 dpi Group 4 file: time, peak memory and a responsive pause', async () => {
    const [W, H] = [2480, 3508];
    const black = textPagePicture(W, H, 50);
    // one page encoded once, written 50 times (each page has its own copy of the strip)
    const ifd = pageIfd(bilevelSpec(black, W, H, 0, { compression: 'g4', resolution: { x: 300, y: 300 } }));
    const bytes = writeTiff(new Array(50).fill(ifd)).bytes;
    const file = readTiff(bytes);
    expect(same((await decodeTiffPage(bytes, file.pages[0], { pause: noPause })).data, bilevelOut(black, W, H))).toBe(true);
    const before = process.memoryUsage();
    let peakRss = 0;
    let peakBuffers = 0;
    // The limits are on this thread's processor time, not on the clock: on a busy machine the clock also counts the
    // time other work holds the processor (108 s and 476 ms were measured that way for 4.9 s and 55 ms of work), while
    // the processor time is the work itself: what an idle machine would take, and what the screen would wait for.
    const cpuMs = (since: NodeJS.CpuUsage) => {
      const used = process.threadCpuUsage(since);
      return (used.user + used.system) / 1000;
    };
    let longest = 0;
    let longestCpu = 0;
    let last = performance.now();
    let lastCpu = process.threadCpuUsage();
    const started = performance.now();
    const startedCpu = process.threadCpuUsage();
    const pdf = await tiffToPdf(bytes, file, {
      pause: async () => {
        const now = performance.now();
        longest = Math.max(longest, now - last);
        longestCpu = Math.max(longestCpu, cpuMs(lastCpu));
        const m = process.memoryUsage();
        peakRss = Math.max(peakRss, m.rss);
        peakBuffers = Math.max(peakBuffers, m.arrayBuffers);
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
        lastCpu = process.threadCpuUsage();
      },
    });
    const seconds = (performance.now() - started) / 1000;
    const cpuSeconds = cpuMs(startedCpu) / 1000;
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(50);
    expect(Math.round(doc.getPage(49).getWidth() * 10) / 10).toBe(595.2);
    process.stderr.write(`\nTIFF scale: 50 pages A4 300 dpi G4, file ${(bytes.length / 1e6).toFixed(2)} MB -> PDF ${(pdf.length / 1e6).toFixed(2)} MB in ${seconds.toFixed(2)} s (${cpuSeconds.toFixed(2)} s of processor time); longest step without a pause ${longest.toFixed(0)} ms (${longestCpu.toFixed(0)} ms of processor time); peak rss ${(peakRss / 1e6).toFixed(0)} MB (${((peakRss - before.rss) / 1e6).toFixed(0)} MB over the ${(before.rss / 1e6).toFixed(0)} MB before), array buffers ${(peakBuffers / 1e6).toFixed(0)} MB (${((peakBuffers - before.arrayBuffers) / 1e6).toFixed(0)} MB over)\n`);
    expect(cpuSeconds).toBeLessThan(90);
    expect(longestCpu).toBeLessThan(400);
    // The time limit only guards against a hang (the work is bounded above): 4.9 s alone, 114 s on a loaded machine.
  }, 600_000);
});
