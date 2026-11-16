// The decoders of tiffCodecs.ts. Each encoder of testTiff.ts is first checked against an independent
// decoder (pdf.js for CCITT, pdf-lib for LZW and PackBits, Node's zlib for Deflate), so that the code
// tables shared by the encoder and the decoder cannot hide a mistake.
import { PDFDocument, PDFName, decodePDFRawStream, type PDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderPage } from './testMarksPdf';
import {
  bilevelPicture,
  deflateEncode,
  faxEncode,
  lzwEncode,
  packBitsEncode,
  runSweepPicture,
  seeded,
  type FaxEncodeOptions,
  type FaxEncoding,
} from './testTiff';
import {
  BLACK_CODES,
  CodecError,
  EXTENDED_MAKEUP,
  FAX_MODE_CODES,
  WHITE_CODES,
  faxInto,
  inflateInto,
  inflatePrefix,
  lzwInto,
  packBitsInto,
  reverseBits,
  type Work,
} from './tiffCodecs';

vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  await renderPage(await doc.save(), 1); // warm pdf.js up once
}, 60_000);

/** Runs a decoder to the end; returns how often it paused. */
function run(work: Work): number {
  let pauses = 0;
  for (let r = work.next(); !r.done; r = work.next()) pauses++;
  return pauses;
}

function decodeError(work: () => Work): unknown {
  try {
    run(work());
  } catch (error) {
    return error;
  }
  return null;
}

/** One byte a pixel (1 = black) to packed rows, MSB first, 1 bit = "black" code. */
function packed(bits: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = (width + 7) >> 3;
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (bits[y * width + x]) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}

function randomBytes(n: number, seed: number, alphabet = 256): Uint8Array {
  const rnd = seeded(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rnd() * alphabet);
  return out;
}

/** Text-like data: runs, repeats and noise, as image rows are. */
function rowLikeBytes(n: number, seed: number): Uint8Array {
  const rnd = seeded(seed);
  const out = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const kind = rnd();
    const len = 1 + Math.floor(rnd() * 300);
    if (kind < 0.4) out.fill(Math.floor(rnd() * 4) * 85, i, i + len);
    else if (kind < 0.7 && i > 500) out.copyWithin(i, i - 1 - Math.floor(rnd() * 400), Math.min(n, i + len));
    else for (let j = i; j < Math.min(n, i + len); j++) out[j] = Math.floor(rnd() * 256);
    i += len;
  }
  return out;
}

describe('CCITT code tables', () => {
  const sets: [string, (readonly (readonly [number | string, string])[])[]][] = [
    ['white', [WHITE_CODES, EXTENDED_MAKEUP, [[-1, '000000000001']]]],
    ['black', [BLACK_CODES, EXTENDED_MAKEUP, [[-1, '000000000001']]]],
    ['2-D modes', [FAX_MODE_CODES, [[-1, '000000000001']]]],
  ];
  it.each(sets)('the %s codes are a prefix code (no code begins another) within the Kraft bound', (_name, tables) => {
    const codes = tables.flat().map(([, code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of codes) for (const b of codes) if (a !== b) expect(b.startsWith(a)).toBe(false);
    const kraft = codes.reduce((sum, c) => sum + 2 ** -c.length, 0);
    expect(kraft).toBeLessThanOrEqual(1);
  });

  it('has 64 terminating and 27 make-up codes for each colour, and 13 shared extended make-up codes', () => {
    for (const table of [WHITE_CODES, BLACK_CODES]) {
      const runs = table.map(([run]) => run);
      expect(runs.filter((r) => r < 64)).toEqual(Array.from({ length: 64 }, (_, i) => i));
      expect(runs.filter((r) => r >= 64)).toEqual(Array.from({ length: 27 }, (_, i) => (i + 1) * 64));
    }
    expect(EXTENDED_MAKEUP.map(([run]) => run)).toEqual(Array.from({ length: 13 }, (_, i) => 1792 + i * 64));
  });
});

// ---- the test encoders against pdf.js ----------------------------------------------------------------

async function renderCcitt(data: Uint8Array, width: number, height: number, parms: Record<string, unknown>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = doc.context.register(
    doc.context.stream(data, {
      Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceGray', BitsPerComponent: 1,
      Filter: 'CCITTFaxDecode', DecodeParms: { Columns: width, Rows: height, BlackIs1: false, ...parms },
    } as never),
  );
  const page = doc.addPage([width, height]);
  page.node.setXObject(PDFName.of('Im0'), image);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`)));
  const raster = await renderPage(await doc.save(), 1, 1);
  expect([raster.width, raster.height]).toEqual([width, height]);
  const black = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) black[i] = raster.data[i * 4] < 128 ? 1 : 0;
  return black;
}

const encodings: [FaxEncoding, FaxEncodeOptions, Record<string, unknown>][] = [
  ['g4', {}, { K: -1 }],
  ['g3-1d', {}, { K: 0, EndOfLine: true }],
  ['g3-2d', { k: 2 }, { K: 2, EndOfLine: true }],
  ['g3-2d', { k: 4 }, { K: 4, EndOfLine: true }],
  ['mh', {}, { K: 0, EncodedByteAlign: true }],
];

/**
 * pdf.js 5.4.296 draws the last row of any 1-bit picture only up to pixel ceil(width / 8) * 8 - 7
 * (canvas.js putBinaryImageData; tiff.ts BILEVEL_EXTRA_ROWS). The rows checked are followed by one white
 * row that is not checked.
 */
async function shownByPdfJs(bits: Uint8Array, width: number, height: number, mode: FaxEncoding, opts: FaxEncodeOptions, parms: Record<string, unknown>): Promise<Uint8Array> {
  const padded = new Uint8Array(width * (height + 1));
  padded.set(bits);
  const shown = await renderCcitt(faxEncode(padded, width, height + 1, mode, opts), width, height + 1, parms);
  return shown.subarray(0, width * height);
}

describe('the test CCITT encoder agrees with pdf.js', () => {
  it.each(encodings)('%s %o: every run length of the tables, both colours', async (mode, opts, parms) => {
    const width = 5300;
    const { bits, height } = runSweepPicture(width);
    const shown = await shownByPdfJs(bits, width, height, mode, opts, parms);
    expect(Buffer.from(shown).equals(Buffer.from(bits))).toBe(true);
  });

  it.each(encodings)('%s %o: a text-like page with every 2-D mode', async (mode, opts, parms) => {
    const [width, height] = [301, 157];
    const bits = bilevelPicture(width, height, 7);
    const shown = await shownByPdfJs(bits, width, height, mode, opts, parms);
    expect(Buffer.from(shown).equals(Buffer.from(bits))).toBe(true);
  });
});

// ---- CCITT decoder -----------------------------------------------------------------------------------

describe('faxInto', () => {
  const decode = (data: Uint8Array, width: number, height: number, mode: FaxEncoding): Uint8Array => {
    const out = new Uint8Array(((width + 7) >> 3) * height);
    run(faxInto(data, out, 0, width, height, mode));
    return out;
  };

  it.each(['g4', 'g3-1d', 'g3-2d', 'mh'] as const)('%s: decodes every run length exactly', (mode) => {
    const width = 5300;
    const { bits, height } = runSweepPicture(width);
    expect(Buffer.from(decode(faxEncode(bits, width, height, mode), width, height, mode)).equals(Buffer.from(packed(bits, width, height)))).toBe(true);
  });

  it.each(['g4', 'g3-1d', 'g3-2d', 'mh'] as const)('%s: decodes text-like pages of odd widths exactly', (mode) => {
    for (const [width, height, seed] of [[301, 157, 1], [8, 9, 2], [1, 5, 3], [17, 40, 4], [1728, 60, 5]]) {
      const bits = bilevelPicture(width, height, seed);
      expect(Buffer.from(decode(faxEncode(bits, width, height, mode), width, height, mode)).equals(Buffer.from(packed(bits, width, height)))).toBe(true);
    }
  });

  it('decodes all-white and all-black pages and random noise', () => {
    for (const mode of ['g4', 'g3-1d', 'g3-2d', 'mh'] as const) {
      for (const fill of [0, 1, -1]) {
        const [width, height] = [97, 23];
        const rnd = seeded(11);
        const bits = new Uint8Array(width * height).map(() => (fill >= 0 ? fill : rnd() < 0.5 ? 1 : 0));
        expect(Buffer.from(decode(faxEncode(bits, width, height, mode), width, height, mode)).equals(Buffer.from(packed(bits, width, height)))).toBe(true);
      }
    }
  });

  it('Group 3: EOLs with fill bits, a first row without EOL, and no RTC are all read', () => {
    const [width, height] = [123, 31];
    const bits = bilevelPicture(width, height, 9);
    const expected = Buffer.from(packed(bits, width, height));
    for (const mode of ['g3-1d', 'g3-2d'] as const) {
      for (const opts of [{ fillBits: true }, { firstEol: false }, { end: false }, { fillBits: true, firstEol: false, end: false }]) {
        expect(Buffer.from(decode(faxEncode(bits, width, height, mode, opts), width, height, mode)).equals(expected)).toBe(true);
      }
    }
    expect(Buffer.from(decode(faxEncode(bits, width, height, 'g4', { end: false }), width, height, 'g4')).equals(expected)).toBe(true);
  });

  it('writes into the output at an offset and pauses every few rows', () => {
    const [width, height] = [64, 300];
    const bits = bilevelPicture(width, height, 2);
    const out = new Uint8Array(10 + 8 * height).fill(0xaa);
    const pauses = run(faxInto(faxEncode(bits, width, height, 'g4'), out, 10, width, height, 'g4'));
    expect(pauses).toBeGreaterThan(3);
    expect(Array.from(out.subarray(0, 10))).toEqual(new Array(10).fill(0xaa));
    expect(Buffer.from(out.subarray(10)).equals(Buffer.from(packed(bits, width, height)))).toBe(true);
  });

  it('refuses data that ends early, an early end of block, a run past the row and uncompressed mode', () => {
    const [width, height] = [200, 50];
    const bits = bilevelPicture(width, height, 4);
    const out = () => new Uint8Array(25 * height);
    for (const mode of ['g4', 'g3-1d', 'g3-2d', 'mh'] as const) {
      const data = faxEncode(bits, width, height, mode, { end: false });
      const cut = decodeError(() => faxInto(data.subarray(0, data.length >> 1), out(), 0, width, height, mode));
      expect(cut).toBeInstanceOf(CodecError);
    }
    // EOFB after 10 of 50 rows
    const early = faxEncode(bits.subarray(0, width * 10), width, 10, 'g4');
    expect(decodeError(() => faxInto(early, out(), 0, width, height, 'g4'))).toBeInstanceOf(CodecError);
    // a one-dimensional row of 300 white pixels in a 200-pixel row
    const long = faxEncode(new Uint8Array(300), 300, 1, 'mh');
    expect(decodeError(() => faxInto(long, new Uint8Array(25), 0, 200, 1, 'mh'))).toMatchObject({ reason: 'damaged' });
    // the extension code 0000001 111 (uncompressed mode) as the first 2-D code
    expect(decodeError(() => faxInto(new Uint8Array([0b00000011, 0b11000000, 0, 0]), out(), 0, width, height, 'g4'))).toMatchObject({ reason: 'fax-uncompressed' });
    // invalid bits
    expect(decodeError(() => faxInto(new Uint8Array(64), out(), 0, width, height, 'g4'))).toBeInstanceOf(CodecError);
  });

  it('never throws anything but CodecError on random or mutated data, and always ends', () => {
    const [width, height] = [83, 21];
    const bits = bilevelPicture(width, height, 5);
    const rnd = seeded(77);
    for (const mode of ['g4', 'g3-1d', 'g3-2d', 'mh'] as const) {
      const good = faxEncode(bits, width, height, mode);
      for (let i = 0; i < 400; i++) {
        const data = i % 4 === 0 ? randomBytes(1 + Math.floor(rnd() * 300), i) : good.slice(0, Math.max(1, Math.floor(rnd() * good.length * 1.2)));
        if (i % 4 !== 0) for (let f = 0; f < 1 + (i % 5); f++) data[Math.floor(rnd() * data.length)] ^= 1 << Math.floor(rnd() * 8);
        const error = decodeError(() => faxInto(data, new Uint8Array(11 * height), 0, width, height, mode));
        if (error !== null) expect(error).toBeInstanceOf(CodecError);
      }
    }
  });
});

// ---- LZW --------------------------------------------------------------------------------------------

/** pdf-lib's own decoder of a PDF filter (LZWDecode with EarlyChange 1 is TIFF's LZW). */
async function independent(data: Uint8Array, filter: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  return decodePDFRawStream(doc.context.stream(data, { Filter: filter } as never) as PDFRawStream).decode();
}

describe('LZW', () => {

  const samples: [string, Uint8Array][] = [
    ['empty-ish', new Uint8Array([7])],
    ['row-like', rowLikeBytes(200_000, 1)],
    ['random (fills the table, many Clear codes)', randomBytes(60_000, 2)],
    ['a long single run', new Uint8Array(100_000).fill(9)],
  ];

  it.each(samples)('the test encoder agrees with pdf-lib (%s)', async (_name, data) => {
    expect(Buffer.from(await independent(lzwEncode(data), 'LZWDecode')).equals(Buffer.from(data))).toBe(true);
  });

  it.each(samples)('lzwInto decodes exactly (%s), and stops when the output is full', (_name, data) => {
    const out = new Uint8Array(data.length + 4).fill(0xee);
    run(lzwInto(lzwEncode(data), out, 2, data.length));
    expect(Buffer.from(out.subarray(2, 2 + data.length)).equals(Buffer.from(data))).toBe(true);
    expect([out[0], out[1], out[data.length + 2], out[data.length + 3]]).toEqual([0xee, 0xee, 0xee, 0xee]);
    if (data.length > 10) {
      const part = new Uint8Array(10);
      run(lzwInto(lzwEncode(data), part, 0, 10));
      expect(Array.from(part)).toEqual(Array.from(data.subarray(0, 10)));
    }
  });

  it('pauses while decoding a large strip', () => {
    const data = rowLikeBytes(1_000_000, 3);
    expect(run(lzwInto(lzwEncode(data), new Uint8Array(data.length), 0, data.length))).toBeGreaterThan(5);
  });

  it('refuses old-style LZW, a code past the table, and data that ends early', () => {
    expect(decodeError(() => lzwInto(new Uint8Array([0, 1, 2, 3]), new Uint8Array(10), 0, 10))).toMatchObject({ reason: 'old-lzw' });
    // Clear, then code 300 (not in the table yet) at 9 bits: 100000000 100101100
    expect(decodeError(() => lzwInto(new Uint8Array([0x80, 0x4b, 0x00, 0x00]), new Uint8Array(10), 0, 10))).toMatchObject({ reason: 'damaged' });
    const data = rowLikeBytes(5000, 4);
    const encoded = lzwEncode(data);
    expect(decodeError(() => lzwInto(encoded.subarray(0, encoded.length >> 1), new Uint8Array(data.length), 0, data.length))).toMatchObject({ reason: 'short' });
  });

  it('never throws anything but CodecError on random or mutated data, and always ends', () => {
    const rnd = seeded(5);
    const good = lzwEncode(rowLikeBytes(3000, 9));
    for (let i = 0; i < 1500; i++) {
      const data = i % 3 === 0 ? randomBytes(1 + Math.floor(rnd() * 500), i) : good.slice(0, Math.max(1, Math.floor(rnd() * good.length * 1.2)));
      if (i % 3 !== 0) for (let f = 0; f < 1 + (i % 4); f++) data[Math.floor(rnd() * data.length)] ^= 1 << Math.floor(rnd() * 8);
      const error = decodeError(() => lzwInto(data, new Uint8Array(3000), 0, 3000));
      if (error !== null) expect(error).toBeInstanceOf(CodecError);
    }
  });
});

// ---- Deflate ------------------------------------------------------------------------------------------

describe('inflateInto', () => {
  const inputs: [string, Uint8Array][] = [
    ['row-like', rowLikeBytes(300_000, 5)],
    ['random', randomBytes(70_000, 6)],
    ['one long run', new Uint8Array(500_000).fill(200)],
    ['short', new Uint8Array([1, 2, 3])],
  ];
  const modes: [string, number, 'default' | 'fixed' | 'huffman'][] = [
    ['stored blocks', 0, 'default'],
    ['level 1', 1, 'default'],
    ['level 6', 6, 'default'],
    ['level 9', 9, 'default'],
    ['fixed Huffman', 6, 'fixed'],
    ['Huffman only', 6, 'huffman'],
  ];
  for (const [name, data] of inputs) {
    it.each(modes)(`${name}: %s`, (_mode, level, strategy) => {
      const out = new Uint8Array(data.length + 2).fill(0x5a);
      run(inflateInto(deflateEncode(data, level, strategy), out, 1, data.length));
      expect(Buffer.from(out.subarray(1, 1 + data.length)).equals(Buffer.from(data))).toBe(true);
      expect([out[0], out[data.length + 1]]).toEqual([0x5a, 0x5a]);
    });
  }

  it('stops when the output is full, and pauses on a large strip', () => {
    const data = rowLikeBytes(2_000_000, 8);
    const part = new Uint8Array(1000);
    run(inflateInto(deflateEncode(data), part, 0, 1000));
    expect(Array.from(part)).toEqual(Array.from(data.subarray(0, 1000)));
    expect(run(inflateInto(deflateEncode(data), new Uint8Array(data.length), 0, data.length))).toBeGreaterThan(10);
  });

  it('refuses a bad header, a preset dictionary, data that ends early, a distance too far and a bad block type', () => {
    const data = rowLikeBytes(20_000, 7);
    const good = deflateEncode(data);
    const out = () => new Uint8Array(data.length);
    expect(decodeError(() => inflateInto(new Uint8Array([0x78, 0x00, 0]), out(), 0, 10))).toMatchObject({ reason: 'damaged' });
    expect(decodeError(() => inflateInto(new Uint8Array([0x78, 0xbb, 0, 0, 0, 0]), out(), 0, 10))).toMatchObject({ reason: 'damaged' });
    expect(decodeError(() => inflateInto(good.subarray(0, good.length >> 1), out(), 0, data.length))).toMatchObject({ reason: 'short' });
    // more output asked for than the stream holds
    expect(decodeError(() => inflateInto(good, new Uint8Array(data.length + 5), 0, data.length + 5))).toMatchObject({ reason: 'short' });
    // fixed block: literal 'a' then length 3 at distance 5 with only 1 byte written
    // bits (LSB first): BFINAL=1, BTYPE=01, lit 'a' (0x61 -> code 0x30+0x61=0x91, 8 bits), len sym 257 (0000001, 7 bits), dist sym 4 (00100, 5 bits) + 1 extra bit
    const w: number[] = [];
    const bits: number[] = [];
    const put = (v: number, n: number, msbFirst = false) => {
      for (let i = 0; i < n; i++) bits.push(msbFirst ? (v >> (n - 1 - i)) & 1 : (v >> i) & 1);
    };
    put(1, 1);
    put(1, 2);
    put(0x91, 8, true);
    put(1, 7, true);
    put(4, 5, true);
    put(0, 1);
    put(0, 7, true);
    for (let i = 0; i < bits.length; i += 8) w.push(bits.slice(i, i + 8).reduce((acc, b, j) => acc | (b << j), 0));
    expect(decodeError(() => inflateInto(new Uint8Array([0x78, 0x9c, ...w]), new Uint8Array(10), 0, 10))).toMatchObject({ reason: 'damaged' });
    // BTYPE 11
    expect(decodeError(() => inflateInto(new Uint8Array([0x78, 0x9c, 0b111, 0, 0]), new Uint8Array(10), 0, 10))).toMatchObject({ reason: 'damaged' });
  });

  it('never throws anything but CodecError on random or mutated data, and always ends', () => {
    const rnd = seeded(13);
    const good = deflateEncode(rowLikeBytes(4000, 12));
    for (let i = 0; i < 2000; i++) {
      let data: Uint8Array;
      if (i % 3 === 0) {
        data = randomBytes(2 + Math.floor(rnd() * 400), i);
        data[0] = 0x78;
        data[1] = 0x9c;
      } else {
        data = good.slice(0, Math.max(2, Math.floor(rnd() * good.length * 1.2)));
        for (let f = 0; f < 1 + (i % 4); f++) data[2 + Math.floor(rnd() * (data.length - 2))] ^= 1 << Math.floor(rnd() * 8);
      }
      const error = decodeError(() => inflateInto(data, new Uint8Array(4000), 0, 4000));
      if (error !== null) expect(error).toBeInstanceOf(CodecError);
    }
  });
});

// ---- PackBits ------------------------------------------------------------------------------------------

describe('packBitsInto', () => {
  it('the test encoder agrees with pdf-lib, and packBitsInto decodes exactly', async () => {
    const data = rowLikeBytes(50_000, 3);
    const encoded = packBitsEncode(data, 500);
    expect(Buffer.from(await independent(encoded, 'RunLengthDecode')).equals(Buffer.from(data))).toBe(true);
    const out = new Uint8Array(data.length);
    run(packBitsInto(encoded, out, 0, data.length));
    expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true);
  });

  it('skips the no-op byte 128, and refuses data that ends early', () => {
    const out = new Uint8Array(4);
    run(packBitsInto(new Uint8Array([128, 1, 7, 8, 128, 0xff, 9]), out, 0, 4));
    expect(Array.from(out)).toEqual([7, 8, 9, 9]);
    expect(decodeError(() => packBitsInto(new Uint8Array([5, 1, 2]), new Uint8Array(6), 0, 6))).toMatchObject({ reason: 'short' });
    expect(decodeError(() => packBitsInto(new Uint8Array([0xfe]), new Uint8Array(3), 0, 3))).toMatchObject({ reason: 'short' });
    expect(decodeError(() => packBitsInto(new Uint8Array(1000).fill(128), new Uint8Array(3), 0, 3))).toMatchObject({ reason: 'short' });
  });
});

describe('reverseBits', () => {
  it('reverses the bits of every byte into a copy', () => {
    const src = new Uint8Array([0b10000000, 0b00000001, 0b11010010, 0]);
    const out = reverseBits(src);
    expect(Array.from(out)).toEqual([0b00000001, 0b10000000, 0b01001011, 0]);
    expect(src[0]).toBe(0b10000000);
  });

  it('fax data stored least significant bit first is read where it is, as its reversed copy is', () => {
    const W = 203;
    const H = 37;
    const bits = bilevelPicture(W, H, 9);
    for (const mode of ['g4', 'g3-2d', 'mh'] as const) {
      const data = faxEncode(bits, W, H, mode, { fillBits: true });
      const straight = new Uint8Array(((W + 7) >> 3) * H);
      run(faxInto(data, straight, 0, W, H, mode));
      const stored = reverseBits(data);
      const read = new Uint8Array(straight.length);
      run(faxInto(stored, read, 0, W, H, mode, true));
      expect(Buffer.from(read).equals(Buffer.from(straight))).toBe(true);
      expect(Buffer.from(straight).equals(Buffer.from(packed(bits, W, H)))).toBe(true);
    }
  });
});

// ---- input that writes nothing (REV-A S8) ------------------------------------------------------------

/** Runs a decoder until it ends or throws: how often it paused, and what it threw. */
function runCounting(work: Work): { pauses: number; error: unknown } {
  let pauses = 0;
  try {
    for (let r = work.next(); !r.done; r = work.next()) pauses++;
  } catch (error) {
    return { pauses, error };
  }
  return { pauses, error: null };
}

/** Least-significant-bit-first writer for Deflate blocks; `code` writes a Huffman code most significant bit first. */
class DeflateBits {
  private readonly out: number[] = [];
  private acc = 0;
  private n = 0;
  bits(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.acc |= ((value >> i) & 1) << this.n;
      if (++this.n === 8) {
        this.out.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  code(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits((code >> i) & 1, 1);
  }
  done(): Uint8Array {
    if (this.n > 0) this.out.push(this.acc);
    return Uint8Array.from(this.out);
  }
}

describe('inflatePrefix', () => {
  it('gives a whole short stream, only the first bytes of a long one, and refuses damaged data', () => {
    const data = rowLikeBytes(200_000, 11);
    const z = deflateEncode(data);
    expect(Buffer.from(inflatePrefix(z, 1_000_000)).equals(Buffer.from(data))).toBe(true); // ends before the limit
    expect(Buffer.from(inflatePrefix(z, 5000)).equals(Buffer.from(data.subarray(0, 5000)))).toBe(true);
    // 64 MB from 64 KB: only the first megabyte is made
    const bomb = deflateEncode(new Uint8Array(64 * 1024 * 1024).fill(7), 9);
    const since = process.threadCpuUsage();
    const head = inflatePrefix(bomb, 1024 * 1024);
    const used = process.threadCpuUsage(since);
    expect(head.length).toBe(1024 * 1024);
    expect(head.every((b) => b === 7)).toBe(true);
    expect((used.user + used.system) / 1000).toBeLessThan(1000);
    expect(() => inflatePrefix(new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0xff]), 100)).toThrow(CodecError);
  });
});

describe('input that writes nothing (REV-A S8)', () => {
  const MB2 = 2 * 1024 * 1024;

  it('LZW clear codes, empty Deflate blocks and PackBits no-ops pause as they are read, and a long stretch of them is refused', () => {
    const clears = new Uint8Array(MB2);
    for (let bit = 0; bit + 9 <= MB2 * 8; bit += 9) clears[bit >> 3] |= 0x80 >> (bit & 7); // 256 in 9 bits, again and again
    const emptyBlocks = new Uint8Array(MB2);
    emptyBlocks.set([0x78, 0x9c]);
    for (let i = 2; i + 5 <= MB2; i += 5) emptyBlocks.set([0, 0, 0, 0xff, 0xff], i); // stored blocks of no bytes
    const noOps = new Uint8Array(MB2).fill(128);
    for (const [name, work] of [
      ['LZW', () => lzwInto(clears, new Uint8Array(64), 0, 64)],
      ['Deflate', () => inflateInto(emptyBlocks, new Uint8Array(64), 0, 64)],
      ['PackBits', () => packBitsInto(noOps, new Uint8Array(64), 0, 64)],
    ] as [string, () => Work][]) {
      const since = process.threadCpuUsage();
      const { pauses, error } = runCounting(work());
      const used = process.threadCpuUsage(since);
      expect({ name, error }).toMatchObject({ name, error: { reason: 'damaged' } }); // refused after 1 MB, not at the end
      expect({ name, pauses: pauses >= 8 }).toEqual({ name, pauses: true }); // every 64 KB of input, about 16 before the refusal
      expect((used.user + used.system) / 1000).toBeLessThan(1500);
    }
  });

  it('fax rows of nothing but zero bits are refused at once, not after reading them all', () => {
    const zeros = new Uint8Array(MB2);
    for (const mode of ['g3-1d', 'g3-2d'] as const) {
      const since = process.threadCpuUsage();
      expect(decodeError(() => faxInto(zeros, new Uint8Array(1000), 0, 80, 100, mode))).toMatchObject({ reason: 'damaged' });
      const used = process.threadCpuUsage(since);
      expect((used.user + used.system) / 1000).toBeLessThan(500);
    }
    // up to 8 KB of fill before an EOL is still read: fill pads a row, and some fax machines pad generously
    const W = 64;
    const bits = bilevelPicture(W, 4, 5);
    const data = faxEncode(bits, W, 4, 'g3-1d', { fillBits: true });
    const padded = new Uint8Array(8000 + data.length);
    padded.set(data, 8000);
    const out = new Uint8Array(8 * 4);
    run(faxInto(padded, out, 0, W, 4, 'g3-1d'));
    expect(Buffer.from(out).equals(Buffer.from(packed(bits, W, 4)))).toBe(true);
  });

  it('a Deflate stream of blocks that each build 15-bit code tables and write nothing is refused quickly', () => {
    // each block: dynamic codes where only the end-of-block code exists, 15 bits long (a 32,768-entry table)
    const w = new DeflateBits();
    const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const codeLengthLengths: Record<number, number> = { 18: 1, 0: 2, 15: 2 }; // codes 18: '0', 0: '10', 15: '11'
    for (let block = 0; block < 20_000; block++) {
      w.bits(0, 1); // not the last
      w.bits(2, 2); // dynamic codes
      w.bits(0, 5); // 257 literal/length codes
      w.bits(0, 5); // 1 distance code
      w.bits(15, 4); // 19 code length codes
      for (const symbol of order) w.bits(codeLengthLengths[symbol] ?? 0, 3);
      w.code(0, 1);
      w.bits(127, 7); // 138 zeros
      w.code(0, 1);
      w.bits(107, 7); // 118 zeros: literals 0-255 unused
      w.code(0b11, 2); // end of block: 15 bits long
      w.code(0b10, 2); // no distance code
      w.code(0, 15); // the end of block itself
    }
    const stream = new Uint8Array([0x78, 0x9c, ...w.done()]);
    const since = process.threadCpuUsage();
    const { pauses, error } = runCounting(inflateInto(stream, new Uint8Array(1000), 0, 1000));
    const used = process.threadCpuUsage(since);
    expect(error).toMatchObject({ reason: 'damaged' });
    expect(pauses).toBeLessThan(50); // refused long before its 280 KB were read
    expect((used.user + used.system) / 1000).toBeLessThan(1500);
    // the same blocks, few of them and followed by a real end, are read: the stream is valid, only wasteful
    const few = new DeflateBits();
    for (let block = 0; block < 3; block++) {
      few.bits(block === 2 ? 1 : 0, 1);
      few.bits(2, 2);
      few.bits(0, 5);
      few.bits(0, 5);
      few.bits(15, 4);
      for (const symbol of order) few.bits(codeLengthLengths[symbol] ?? 0, 3);
      few.code(0, 1);
      few.bits(127, 7);
      few.code(0, 1);
      few.bits(107, 7);
      few.code(0b11, 2);
      few.code(0b10, 2);
      few.code(0, 15);
    }
    expect(decodeError(() => inflateInto(new Uint8Array([0x78, 0x9c, ...few.done()]), new Uint8Array(10), 0, 10))).toMatchObject({ reason: 'short' });
  });
});
