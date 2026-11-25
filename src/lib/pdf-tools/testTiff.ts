// Synthetic TIFF files for the tests of tiff.ts and tiffCodecs.ts: known pictures, the encoders TIFF
// uses (PackBits, LZW, Deflate, CCITT Group 3 and 4, JPEG strips) and a writer for both byte orders
// that can also write broken files. Nothing here reads a real scan or client data.
import { deflateSync, constants as zlibConstants } from 'node:zlib';
import { BLACK_CODES, EXTENDED_MAKEUP, FAX_MODE_CODES, WHITE_CODES } from './tiffCodecs';

// ---- pictures -------------------------------------------------------------------------------------

/** A deterministic pseudo-random sequence (LCG), so every test file is the same on every run. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Grey picture, one byte a pixel: gradients, sharp edges and noise. */
export function greyPicture(width: number, height: number, seed = 1): Uint8Array {
  const rnd = seeded(seed);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = Math.round((x * 255) / Math.max(1, width - 1) * 0.6 + (y * 255) / Math.max(1, height - 1) * 0.4);
      if ((x >> 3) % 5 === 0 && (y >> 2) % 3 === 0) v = 255 - v;
      if (rnd() < 0.08) v = Math.floor(rnd() * 256);
      out[y * width + x] = v & 255;
    }
  }
  return out;
}

/** A smooth RGB picture (a photograph's kind of content), three bytes a pixel: what JPEG keeps well. */
export function smoothRgbPicture(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      out[i] = Math.round(40 + (180 * x) / Math.max(1, width - 1));
      out[i + 1] = Math.round(30 + (190 * y) / Math.max(1, height - 1));
      out[i + 2] = Math.round(128 + 90 * Math.sin((x + y) / 9));
    }
  }
  return out;
}

/** RGB picture, three bytes a pixel. */
export function rgbPicture(width: number, height: number, seed = 2): Uint8Array {
  const rnd = seeded(seed);
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      out[i] = (x * 7 + y * 3) & 255;
      out[i + 1] = Math.round((y * 255) / Math.max(1, height - 1));
      out[i + 2] = rnd() < 0.1 ? Math.floor(rnd() * 256) : (255 - x * 4) & 255;
    }
  }
  return out;
}

/**
 * A bilevel picture, one byte a pixel, 1 = black: text-like blocks, lines and noise, so that every
 * coding mode of Group 3 and 4 is used.
 */
export function bilevelPicture(width: number, height: number, seed = 3): Uint8Array {
  const rnd = seeded(seed);
  const out = new Uint8Array(width * height);
  // "words": short black blocks on lines
  for (let line = 4; line + 7 < height; line += 12) {
    let x = 2 + Math.floor(rnd() * 6);
    while (x < width - 2) {
      const w = 2 + Math.floor(rnd() * 14);
      const h = 4 + Math.floor(rnd() * 4);
      for (let y = line; y < Math.min(height, line + h); y++) {
        for (let xx = x; xx < Math.min(width, x + w); xx++) if (rnd() < 0.9) out[y * width + xx] = 1;
      }
      x += w + 1 + Math.floor(rnd() * 5);
    }
  }
  // a frame and a diagonal
  for (let x = 0; x < width; x++) {
    out[x] = 1;
    out[(height - 1) * width + x] = 1;
  }
  for (let y = 0; y < height; y++) {
    out[y * width] = 1;
    const d = Math.floor((y * width) / height);
    out[y * width + d] = 1;
  }
  return out;
}

/**
 * A page of typed text as a 300 dpi scanner sees it, one byte a pixel, 1 = black: margins, lines of
 * solid letter-like strokes, a ruled table. Compresses with Group 4 the way real text pages do.
 */
export function textPagePicture(width: number, height: number, seed = 4): Uint8Array {
  const rnd = seeded(seed);
  const out = new Uint8Array(width * height);
  const box = (x: number, y: number, w: number, h: number) => {
    for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) out.fill(1, yy * width + Math.max(0, x), yy * width + Math.min(width, x + w));
  };
  const margin = Math.round(width * 0.1);
  for (let y = margin; y + 40 < height - margin; y += 62) {
    if (rnd() < 0.08) continue; // a blank line
    let x = margin;
    const end = width - margin - (rnd() < 0.2 ? Math.floor(rnd() * width * 0.4) : 0);
    while (x < end) {
      const word = 2 + Math.floor(rnd() * 8);
      for (let c = 0; c < word && x < end; c++) {
        const w = 14 + Math.floor(rnd() * 10);
        const tall = rnd() < 0.3;
        const top = y + (tall ? 0 : 10);
        const h = tall ? 34 : 24;
        box(x, top, 4, h); // stem
        if (rnd() < 0.7) box(x + w - 6, top, 4, h); // second stem
        if (rnd() < 0.6) box(x, top, w - 2, 4); // bar
        if (rnd() < 0.5) box(x, top + h - 4, w - 2, 4); // foot
        x += w + 3;
      }
      x += 18;
    }
  }
  // a ruled table at the bottom
  const t = height - margin - 400;
  for (let r = 0; r <= 8; r++) box(margin, t + r * 50, width - 2 * margin, 3);
  for (let c = 0; c <= 5; c++) box(margin + Math.round(((width - 2 * margin - 3) * c) / 5), t, 3, 403);
  return out;
}

/**
 * Rows whose runs have every length the code tables hold: 0 to 63, each make-up length (64 to 2,560)
 * with a remainder, and runs longer than 2,560, in both colours. `width` should be at least 5,200.
 */
export function runSweepPicture(width: number): { bits: Uint8Array; height: number } {
  const rows: number[][] = [];
  const lengths: number[] = [];
  for (let r = 1; r < 64; r++) lengths.push(r);
  for (let m = 64; m <= 2560; m += 64) lengths.push(m, m + 1 + (m % 63));
  lengths.push(2561, 2624, 3000, 5000);
  // pack runs into rows, alternating colours; each row is white then black then white...
  let row: number[] = [];
  let used = 0;
  for (const len of lengths) {
    if (used + len > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(len);
    used += len;
  }
  rows.push(row);
  const height = rows.length * 2 + 2;
  const bits = new Uint8Array(width * height);
  rows.forEach((runs, r) => {
    for (const colourFirst of [0, 1]) {
      const y = r * 2 + colourFirst;
      let x = 0;
      let colour = colourFirst;
      for (const len of runs) {
        if (colour) bits.fill(1, y * width + x, y * width + Math.min(width, x + len));
        x += len;
        colour ^= 1;
      }
    }
  });
  // a row starting black at pixel 0 and a row ending black at the last pixel
  bits.fill(1, (height - 2) * width, (height - 2) * width + 10);
  bits.fill(1, (height - 1) * width + width - 10, height * width);
  return { bits, height };
}

/** Packs one byte a pixel (0/1) into rows of bits, MSB first; `one` is what a 1 pixel becomes. */
export function packBits1(pixels: Uint8Array, width: number, height: number, invert = false): Uint8Array {
  const rowBytes = (width + 7) >> 3;
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = pixels[y * width + x] ^ (invert ? 1 : 0);
      if (bit) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** Packs samples of `bits` (1, 2, 4, 8) into TIFF rows (each row starts on a byte). */
export function packSamples(values: Uint8Array, samplesPerRow: number, height: number, bits: number): Uint8Array {
  if (bits === 8) return values.slice();
  const rowBytes = Math.ceil((samplesPerRow * bits) / 8);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let s = 0; s < samplesPerRow; s++) {
      const v = values[y * samplesPerRow + s] & ((1 << bits) - 1);
      const bit = s * bits;
      out[y * rowBytes + (bit >> 3)] |= v << (8 - bits - (bit & 7));
    }
  }
  return out;
}

// ---- bit writer and simple encoders ---------------------------------------------------------------

class MsbWriter {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  bitLength = 0;
  put(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bit((value >> i) & 1);
  }
  bit(b: number): void {
    this.acc = (this.acc << 1) | b;
    this.n += 1;
    this.bitLength += 1;
    if (this.n === 8) {
      this.bytes.push(this.acc);
      this.acc = 0;
      this.n = 0;
    }
  }
  code(bits: string): void {
    for (const c of bits) this.bit(c === '1' ? 1 : 0);
  }
  align(): void {
    while (this.n !== 0) this.bit(0);
  }
  finish(): Uint8Array {
    this.align();
    return new Uint8Array(this.bytes);
  }
}

/** Reverses the bit order of every byte (FillOrder 2). */
export function reverseEachByte(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    let v = bytes[i];
    let r = 0;
    for (let b = 0; b < 8; b++) {
      r = (r << 1) | (v & 1);
      v >>= 1;
    }
    out[i] = r;
  }
  return out;
}

/** TIFF PackBits, row by row (runs never cross a row). */
export function packBitsEncode(data: Uint8Array, rowBytes: number): Uint8Array {
  const out: number[] = [];
  for (let start = 0; start < data.length; start += rowBytes) {
    const row = data.subarray(start, Math.min(data.length, start + rowBytes));
    let i = 0;
    while (i < row.length) {
      let run = 1;
      while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++;
      if (run >= 3) {
        out.push(257 - run, row[i]);
        i += run;
        continue;
      }
      let lit = 0;
      while (i + lit < row.length && lit < 128) {
        const r3 = i + lit + 2 < row.length && row[i + lit] === row[i + lit + 1] && row[i + lit] === row[i + lit + 2];
        if (r3) break;
        lit++;
      }
      out.push(lit - 1, ...row.subarray(i, i + lit));
      i += lit;
    }
  }
  return new Uint8Array(out);
}

/** TIFF LZW as libtiff writes it: MSB first, codes widen one code early, Clear when the table fills. */
export function lzwEncode(data: Uint8Array): Uint8Array {
  const w = new MsbWriter();
  let width = 9;
  let free = 258;
  let dict = new Map<number, number>();
  w.put(256, width);
  if (data.length === 0) {
    w.put(257, width);
    return w.finish();
  }
  let ent = data[0];
  for (let i = 1; i < data.length; i++) {
    const c = data[i];
    const key = ent * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) {
      ent = hit;
      continue;
    }
    w.put(ent, width);
    ent = c;
    dict.set(key, free);
    free += 1;
    if (free === 4094) {
      w.put(256, width);
      dict = new Map();
      free = 258;
      width = 9;
    } else if (free > (1 << width) - 1) {
      width += 1;
    }
  }
  w.put(ent, width);
  // the decoder adds one more entry on reading `ent`: write the end code at its width (libtiff LZWPostEncode)
  if (free + 1 === 4094) {
    w.put(256, width);
    width = 9;
  } else if (free + 1 > (1 << width) - 1) {
    width += 1;
  }
  w.put(257, width);
  return w.finish();
}

/** zlib (RFC 1950) with Node's encoder; `strategy` 'fixed' forces fixed Huffman blocks, level 0 stored ones. */
export function deflateEncode(data: Uint8Array, level = 6, strategy: 'default' | 'fixed' | 'huffman' = 'default'): Uint8Array {
  const s = strategy === 'fixed' ? zlibConstants.Z_FIXED : strategy === 'huffman' ? zlibConstants.Z_HUFFMAN_ONLY : zlibConstants.Z_DEFAULT_STRATEGY;
  return new Uint8Array(deflateSync(data, { level, strategy: s }));
}

/** Horizontal differencing (Predictor 2) of 8-bit rows. */
export function predictorEncode(data: Uint8Array, rowBytes: number, samplesPerPixel: number): Uint8Array {
  const out = data.slice();
  for (let row = 0; row < out.length; row += rowBytes) {
    for (let i = rowBytes - 1; i >= samplesPerPixel; i--) out[row + i] = (out[row + i] - out[row + i - samplesPerPixel]) & 255;
  }
  return out;
}

// ---- CCITT encoders ---------------------------------------------------------------------------------

const lookup = (table: readonly (readonly [number, string])[]) => new Map(table.map(([run, code]) => [run, code]));
const WHITE = lookup(WHITE_CODES);
const BLACK = lookup(BLACK_CODES);
const EXTENDED = lookup(EXTENDED_MAKEUP);
const MODES = new Map(FAX_MODE_CODES.map(([mode, code]) => [mode, code]));
const EOL = '000000000001';

function putRun(w: MsbWriter, run: number, colour: number): void {
  const table = colour ? BLACK : WHITE;
  while (run >= 2560) {
    w.code(EXTENDED.get(2560)!);
    run -= 2560;
  }
  if (run >= 64) {
    const m = run - (run % 64);
    w.code(m <= 1728 ? table.get(m)! : EXTENDED.get(m)!);
    run -= m;
  }
  w.code(table.get(run)!);
}

/** Changing elements of a row (one byte a pixel, 1 = black): positions where the colour changes. */
function changes(bits: Uint8Array, start: number, width: number): number[] {
  const out: number[] = [];
  let colour = 0;
  for (let x = 0; x < width; x++) {
    if (bits[start + x] !== colour) {
      out.push(x);
      colour ^= 1;
    }
  }
  return out;
}

function encode1D(w: MsbWriter, c: number[], width: number): void {
  let prev = 0;
  const ends = [...c, width];
  ends.forEach((end, i) => {
    putRun(w, end - prev, i & 1);
    prev = end;
  });
}

/**
 * First element of `list` right of a0 whose colour is opposite to a0's (index parity = colour),
 * searching from `hint` (a0 only grows, so each row is linear); returns [it, the next, its index].
 */
function nextOf(list: number[], a0: number, colour: number, width: number, hint: number): [number, number, number] {
  let i = hint;
  while (i > 0 && list[i - 1] > a0) i--;
  while (i < list.length && (list[i] <= a0 || (i & 1) !== colour)) i++;
  return [i < list.length ? list[i] : width, i + 1 < list.length ? list[i + 1] : width, i];
}

function encode2D(w: MsbWriter, ref: number[], cur: number[], width: number): void {
  let a0 = -1;
  let colour = 0;
  let ai = 0;
  let bi = 0;
  while (a0 < width) {
    const [a1, a2, aAt] = nextOf(cur, a0, colour, width, ai);
    const [b1, b2, bAt] = nextOf(ref, a0, colour, width, bi);
    ai = aAt;
    bi = bAt;
    if (b2 < a1) {
      w.code(MODES.get('P')!);
      a0 = b2;
    } else if (Math.abs(a1 - b1) <= 3) {
      const d = a1 - b1;
      w.code(MODES.get(d === 0 ? 'V0' : d > 0 ? `VR${d}` : `VL${-d}`)!);
      a0 = a1;
      colour ^= 1;
    } else {
      w.code(MODES.get('H')!);
      putRun(w, a1 - Math.max(a0, 0), colour);
      putRun(w, a2 - a1, colour ^ 1);
      a0 = a2;
    }
  }
}

export type FaxEncoding = 'g4' | 'g3-1d' | 'g3-2d' | 'mh';
export interface FaxEncodeOptions {
  /** Group 3 two-dimensional: every k-th row is one-dimensional (default 2). */
  k?: number;
  /** Group 3: zero bits before each EOL so that it ends on a byte (T4Options bit 2). */
  fillBits?: boolean;
  /** Group 3: write the EOL before the first row (default true). */
  firstEol?: boolean;
  /** Group 3: end with RTC (six EOLs); Group 4: end with EOFB (two EOLs). Default true. */
  end?: boolean;
}

/**
 * CCITT encoding of `bits` (one byte a pixel; 1 = a "black" code, which is the bit value 1 in TIFF).
 * One strip: the first reference row is white.
 */
export function faxEncode(bits: Uint8Array, width: number, height: number, mode: FaxEncoding, opts: FaxEncodeOptions = {}): Uint8Array {
  const w = new MsbWriter();
  const k = opts.k ?? 2;
  const eol = () => {
    if (opts.fillBits) while ((w.bitLength + 12) % 8 !== 0) w.bit(0);
    w.code(EOL);
  };
  let ref: number[] = [];
  for (let y = 0; y < height; y++) {
    const cur = changes(bits, y * width, width);
    if (mode === 'g4') {
      encode2D(w, ref, cur, width);
    } else if (mode === 'mh') {
      encode1D(w, cur, width);
      w.align();
    } else {
      const withEol = y > 0 || opts.firstEol !== false;
      if (withEol) eol();
      if (mode === 'g3-2d') {
        // the tag bit follows an EOL; a first row without EOL is one-dimensional and has none
        const oneD = y % k === 0;
        if (withEol) w.bit(oneD ? 1 : 0);
        if (oneD) encode1D(w, cur, width);
        else encode2D(w, ref, cur, width);
      } else {
        encode1D(w, cur, width);
      }
    }
    ref = cur;
  }
  if (opts.end !== false) {
    if (mode === 'g4') {
      w.code(EOL);
      w.code(EOL);
    } else if (mode !== 'mh') {
      for (let i = 0; i < 6; i++) {
        w.code(EOL);
        if (mode === 'g3-2d') w.bit(1);
      }
    }
  }
  return w.finish();
}

// ---- TIFF writer ------------------------------------------------------------------------------------

export const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7, SSHORT: 8, SLONG: 9, FLOAT: 11, DOUBLE: 12 } as const;
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

export interface Entry {
  tag: number;
  type: number;
  /** Numbers (a RATIONAL is two numbers), or raw bytes for BYTE/UNDEFINED/ASCII. */
  values: readonly number[] | Uint8Array;
  /** Writes this count instead of the real one (to make broken files). */
  count?: number;
}

export interface RawIfd {
  entries: Entry[];
  /** Data blocks written before the IFD; their offsets and sizes fill `offsetsTag` and `countsTag`. */
  chunks?: Uint8Array[];
  offsetsTag?: number;
  countsTag?: number;
}

export interface WrittenTiff {
  bytes: Uint8Array;
  /** Where each IFD starts. */
  ifdOffsets: number[];
  /** Where each IFD's next-IFD pointer is. */
  nextPointers: number[];
  littleEndian: boolean;
}

/** Writes a classic TIFF. Entries are sorted by tag; offsets and counts of the chunks are filled in. */
export function writeTiff(ifds: RawIfd[], order: 'II' | 'MM' = 'II'): WrittenTiff {
  const le = order === 'II';
  const parts: Uint8Array[] = [];
  let size = 8;
  const add = (data: Uint8Array): number => {
    const at = size;
    parts.push(data);
    size += data.length;
    if (size % 2) {
      parts.push(new Uint8Array(1));
      size += 1;
    }
    return at;
  };
  const num = (value: number, type: number): number[] => {
    const n = TYPE_SIZE[type];
    const out: number[] = [];
    const v = type === T.SSHORT || type === T.SLONG ? value >>> 0 : value;
    for (let i = 0; i < n; i++) out.push(le ? (v / 2 ** (8 * i)) & 255 : (v / 2 ** (8 * (n - 1 - i))) & 255);
    return out;
  };
  const encodeValues = (e: Entry): Uint8Array => {
    if (e.values instanceof Uint8Array) return e.values;
    if (e.type === T.RATIONAL) return new Uint8Array(e.values.flatMap((v) => num(v, T.LONG)));
    if (e.type === T.FLOAT || e.type === T.DOUBLE) {
      const out = new Uint8Array(e.values.length * TYPE_SIZE[e.type]);
      const view = new DataView(out.buffer);
      e.values.forEach((v, i) => (e.type === T.FLOAT ? view.setFloat32(i * 4, v, le) : view.setFloat64(i * 8, v, le)));
      return out;
    }
    return new Uint8Array(e.values.flatMap((v) => num(v, e.type)));
  };
  const ifdOffsets: number[] = [];
  const nextPointers: number[] = [];
  const pending: { at: number; ifd: Uint8Array }[] = [];
  for (const ifd of ifds) {
    const entries = [...ifd.entries];
    if (ifd.chunks) {
      const offsets = ifd.chunks.map((c) => add(c));
      const longs = (values: number[]): Entry => ({ tag: 0, type: T.LONG, values });
      entries.push({ ...longs(offsets), tag: ifd.offsetsTag ?? 273 });
      entries.push({ ...longs(ifd.chunks.map((c) => c.length)), tag: ifd.countsTag ?? 279 });
    }
    entries.sort((a, b) => a.tag - b.tag);
    const values = entries.map(encodeValues);
    const outOfLine = values.map((v) => (v.length > 4 ? add(v) : -1));
    const table = new Uint8Array(2 + entries.length * 12 + 4);
    const put = (at: number, bytes: number[]) => table.set(bytes, at);
    put(0, num(entries.length, T.SHORT));
    entries.forEach((e, i) => {
      const at = 2 + i * 12;
      const count = e.count ?? (e.values instanceof Uint8Array ? e.values.length : e.type === T.RATIONAL ? e.values.length / 2 : e.values.length);
      put(at, num(e.tag, T.SHORT));
      put(at + 2, num(e.type, T.SHORT));
      put(at + 4, num(count, T.LONG));
      if (outOfLine[i] >= 0) put(at + 8, num(outOfLine[i], T.LONG));
      else table.set(values[i], at + 8);
    });
    const at = add(table);
    ifdOffsets.push(at);
    nextPointers.push(at + 2 + entries.length * 12);
    pending.push({ at, ifd: table });
  }
  const bytes = new Uint8Array(size);
  bytes.set(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42], 0);
  let at = 8;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  const set32 = (pos: number, v: number) => bytes.set(num(v, T.LONG), pos);
  set32(4, ifdOffsets[0] ?? 0);
  nextPointers.forEach((p, i) => set32(p, ifdOffsets[i + 1] ?? 0));
  return { bytes, ifdOffsets, nextPointers, littleEndian: le };
}

/** Writes a 32-bit value into a written file (to break it). */
export function poke32(file: WrittenTiff, pos: number, value: number): void {
  const v = value >>> 0;
  for (let i = 0; i < 4; i++) file.bytes[pos + i] = file.littleEndian ? (v >>> (8 * i)) & 255 : (v >>> (8 * (3 - i))) & 255;
}

/** Where an entry of an IFD is, by tag (or -1). */
export function entryAt(file: WrittenTiff, ifdIndex: number, tag: number): number {
  const at = file.ifdOffsets[ifdIndex];
  const b = file.bytes;
  const u16 = (p: number) => (file.littleEndian ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
  const n = u16(at);
  for (let i = 0; i < n; i++) if (u16(at + 2 + i * 12) === tag) return at + 2 + i * 12;
  return -1;
}

// ---- pages -------------------------------------------------------------------------------------------

export type Compression = 'none' | 'packbits' | 'lzw' | 'deflate' | 'deflate-old' | 'g4' | 'g3-1d' | 'g3-2d' | 'mh' | 'jpeg';
const COMPRESSION_CODE: Record<Compression, number> = {
  none: 1, packbits: 32773, lzw: 5, deflate: 8, 'deflate-old': 32946, g4: 4, 'g3-1d': 3, 'g3-2d': 3, mh: 2, jpeg: 7,
};

export interface PageSpec {
  width: number;
  height: number;
  /** Stored samples, chunky, rows packed as TIFF stores them (ignored for 'jpeg'). */
  samples?: Uint8Array;
  bitsPerSample?: number;
  samplesPerPixel?: number;
  photometric: number;
  compression?: Compression;
  predictor?: 1 | 2;
  rowsPerStrip?: number;
  tile?: { width: number; height: number };
  planar?: 1 | 2;
  fillOrder?: 1 | 2;
  orientation?: number;
  /** dpi (or per cm with unit 3); null writes no resolution tags. Default 72 dpi. */
  resolution?: { x: number; y: number; unit?: number } | null;
  extraSamples?: number[];
  colorMap?: number[];
  fax?: FaxEncodeOptions;
  /** JPEG strip (whole picture) and tables, for compression 'jpeg'. */
  jpeg?: { strip: Uint8Array; tables?: Uint8Array };
  newSubfileType?: number;
  sampleFormat?: number;
  /** Tags written as given (after the builder's own; a duplicate tag here wins nothing: the first is read). */
  extra?: Entry[];
  /** Tags of the builder's own to leave out. */
  omit?: number[];
}

function encodeChunk(spec: PageSpec, data: Uint8Array, rowBytes: number, width: number, rows: number, spp: number): Uint8Array {
  const compression = spec.compression ?? 'none';
  let raw = data;
  if (spec.predictor === 2 && (compression === 'lzw' || compression === 'deflate' || compression === 'deflate-old')) raw = predictorEncode(raw, rowBytes, spp);
  let out: Uint8Array;
  switch (compression) {
    case 'none':
      out = raw.slice();
      break;
    case 'packbits':
      out = packBitsEncode(raw, rowBytes);
      break;
    case 'lzw':
      out = lzwEncode(raw);
      break;
    case 'deflate':
    case 'deflate-old':
      out = deflateEncode(raw);
      break;
    case 'jpeg':
      throw new Error('JPEG pages are given whole');
    default: {
      // CCITT: one byte a pixel for the encoder
      const bits = new Uint8Array(width * rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) bits[y * width + x] = (raw[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      out = faxEncode(bits, width, rows, compression, spec.fax);
    }
  }
  return spec.fillOrder === 2 ? reverseEachByte(out) : out;
}

/** The IFD of one page: its tags and its strips or tiles, encoded. */
export function pageIfd(spec: PageSpec): RawIfd {
  const bps = spec.bitsPerSample ?? 8;
  const spp = spec.samplesPerPixel ?? 1;
  const planar = spec.planar ?? 1;
  const compression = spec.compression ?? 'none';
  const entries: Entry[] = [
    { tag: 256, type: T.LONG, values: [spec.width] },
    { tag: 257, type: T.LONG, values: [spec.height] },
    { tag: 258, type: T.SHORT, values: new Array(spp).fill(bps) },
    { tag: 259, type: T.SHORT, values: [COMPRESSION_CODE[compression]] },
    { tag: 262, type: T.SHORT, values: [spec.photometric] },
    { tag: 277, type: T.SHORT, values: [spp] },
    { tag: 284, type: T.SHORT, values: [planar] },
  ];
  if (spec.newSubfileType !== undefined) entries.push({ tag: 254, type: T.LONG, values: [spec.newSubfileType] });
  if (spec.fillOrder) entries.push({ tag: 266, type: T.SHORT, values: [spec.fillOrder] });
  if (spec.orientation) entries.push({ tag: 274, type: T.SHORT, values: [spec.orientation] });
  if (spec.predictor) entries.push({ tag: 317, type: T.SHORT, values: [spec.predictor] });
  if (spec.extraSamples) entries.push({ tag: 338, type: T.SHORT, values: spec.extraSamples });
  if (spec.colorMap) entries.push({ tag: 320, type: T.SHORT, values: spec.colorMap });
  if (spec.sampleFormat) entries.push({ tag: 339, type: T.SHORT, values: new Array(spp).fill(spec.sampleFormat) });
  const res = spec.resolution === undefined ? { x: 72, y: 72, unit: 2 } : spec.resolution;
  if (res) {
    const rational = (v: number): number[] => [Math.round(v * 1000), 1000];
    entries.push({ tag: 282, type: T.RATIONAL, values: rational(res.x) });
    entries.push({ tag: 283, type: T.RATIONAL, values: rational(res.y) });
    entries.push({ tag: 296, type: T.SHORT, values: [res.unit ?? 2] });
  }
  if (compression === 'g3-1d' || compression === 'g3-2d') {
    entries.push({ tag: 292, type: T.LONG, values: [(compression === 'g3-2d' ? 1 : 0) | (spec.fax?.fillBits ? 4 : 0)] });
  }

  const chunks: Uint8Array[] = [];
  let offsetsTag = 273;
  let countsTag = 279;
  if (compression === 'jpeg') {
    if (!spec.jpeg) throw new Error('jpeg strip missing');
    chunks.push(spec.jpeg.strip);
    entries.push({ tag: 278, type: T.LONG, values: [spec.height] });
    if (spec.jpeg.tables) entries.push({ tag: 347, type: T.UNDEFINED, values: spec.jpeg.tables });
  } else {
    const samples = spec.samples!;
    const chunkySpp = planar === 1 ? spp : 1;
    const rowBytes = Math.ceil((spec.width * spp * bps) / 8);
    const planeRowBytes = Math.ceil((spec.width * chunkySpp * bps) / 8);
    // planes of a planar page (8-bit only), each width x height
    const planes: Uint8Array[] = [];
    if (planar === 2) {
      for (let p = 0; p < spp; p++) {
        const plane = new Uint8Array(spec.width * spec.height);
        for (let i = 0; i < plane.length; i++) plane[i] = samples[i * spp + p];
        planes.push(plane);
      }
    } else {
      planes.push(samples);
    }
    const stride = planar === 1 ? rowBytes : planeRowBytes;
    if (spec.tile) {
      offsetsTag = 324;
      countsTag = 325;
      const { width: tw, height: th } = spec.tile;
      entries.push({ tag: 322, type: T.LONG, values: [tw] }, { tag: 323, type: T.LONG, values: [th] });
      const tileRowBytes = Math.ceil((tw * chunkySpp * bps) / 8);
      for (const plane of planes) {
        for (let ty = 0; ty < Math.ceil(spec.height / th); ty++) {
          for (let tx = 0; tx < Math.ceil(spec.width / tw); tx++) {
            const tile = new Uint8Array(tileRowBytes * th);
            for (let r = 0; r < th; r++) {
              const y = ty * th + r;
              if (y >= spec.height) break;
              const from = y * stride + (tx * tw * chunkySpp * bps) / 8;
              const n = Math.min(tileRowBytes, stride - (tx * tw * chunkySpp * bps) / 8);
              tile.set(plane.subarray(from, from + n), r * tileRowBytes);
            }
            chunks.push(encodeChunk(spec, tile, tileRowBytes, tw, th, chunkySpp));
          }
        }
      }
    } else {
      const rps = spec.rowsPerStrip ?? spec.height;
      entries.push({ tag: 278, type: T.LONG, values: [rps] });
      for (const plane of planes) {
        for (let y = 0; y < spec.height; y += rps) {
          const rows = Math.min(rps, spec.height - y);
          chunks.push(encodeChunk(spec, plane.subarray(y * stride, (y + rows) * stride), stride, spec.width, rows, chunkySpp));
        }
      }
    }
  }
  const omit = new Set(spec.omit ?? []);
  return { entries: [...entries.filter((e) => !omit.has(e.tag)), ...(spec.extra ?? [])], chunks, offsetsTag, countsTag };
}

/** A TIFF of the given pages. */
export function makeTiff(pages: PageSpec[], order: 'II' | 'MM' = 'II'): Uint8Array {
  return writeTiff(pages.map(pageIfd), order).bytes;
}

/** The same, with the IFD offsets for breaking it. */
export function makeTiffFile(pages: PageSpec[], order: 'II' | 'MM' = 'II'): WrittenTiff {
  return writeTiff(pages.map(pageIfd), order);
}

// ---- JPEG through pdf.js's canvas (Node) --------------------------------------------------------------

/**
 * A baseline YCbCr JPEG (JFIF, three components) of an RGB (3 bytes a pixel) or grey picture, made by
 * the canvas pdf.js uses in Node. `quality` is 0-100, as that canvas takes it.
 */
export async function jpegOf(pixels: Uint8Array, width: number, height: number, channels: 1 | 3, quality = 92): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  const pdf = await pdfjs.getDocument({ data: await doc.save(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(mime: string, q?: number): Uint8Array }; context: CanvasRenderingContext2D } } }).canvasFactory;
    const { canvas, context } = factory.create(width, height);
    const image = context.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const r = pixels[i * channels];
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = channels === 3 ? pixels[i * 3 + 1] : r;
      image.data[i * 4 + 2] = channels === 3 ? pixels[i * 3 + 2] : r;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return new Uint8Array(canvas.toBuffer('image/jpeg', quality));
  } finally {
    await pdf.destroy();
  }
}

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

/**
 * A baseline JPEG written here, for what the canvas cannot make: one component (a grey JPEG), or three
 * components stored exactly as given, with no colour transform and the given component ids (libtiff's
 * RGB JPEG). No subsampling; every coefficient divided by `q` (2 keeps it nearly lossless); Huffman codes
 * of fixed length (4 bits for DC sizes, 8 for AC symbols), which is a valid table.
 */
export function baselineJpeg(samples: Uint8Array, width: number, height: number, components: 1 | 3, opts: { ids?: number[]; q?: number } = {}): Uint8Array {
  const q = opts.q ?? 2;
  const ids = opts.ids ?? (components === 1 ? [1] : [1, 2, 3]);
  const acSymbols = [0x00, 0xf0];
  for (let r = 0; r < 16; r++) for (let s = 1; s <= 10; s++) acSymbols.push((r << 4) | s);
  const acCode = new Map(acSymbols.map((s, i) => [s, i]));
  const out: number[] = [];
  const segment = (marker: number, body: number[]) => out.push(0xff, marker, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body);
  out.push(0xff, 0xd8);
  segment(0xdb, [0, ...new Array(64).fill(q)]);
  segment(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, components, ...ids.flatMap((id) => [id, 0x11, 0])]);
  const dcBits = new Array(16).fill(0);
  dcBits[3] = 12;
  const acBits = new Array(16).fill(0);
  acBits[7] = acSymbols.length;
  segment(0xc4, [0x00, ...dcBits, ...Array.from({ length: 12 }, (_, i) => i), 0x10, ...acBits, ...acSymbols]);
  segment(0xda, [components, ...ids.flatMap((id) => [id, 0x00]), 0, 63, 0]);

  let acc = 0;
  let n = 0;
  const put = (value: number, bits: number) => {
    for (let i = bits - 1; i >= 0; i--) {
      acc = (acc << 1) | ((value >> i) & 1);
      if (++n === 8) {
        out.push(acc);
        if (acc === 0xff) out.push(0);
        acc = 0;
        n = 0;
      }
    }
  };
  const size = (v: number) => (v === 0 ? 0 : 32 - Math.clz32(Math.abs(v)));
  const cos = Array.from({ length: 64 }, (_, i) => Math.cos(((2 * (i >> 3) + 1) * (i & 7) * Math.PI) / 16));
  const prevDc = new Array(components).fill(0);
  const block = new Float64Array(64);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let c = 0; c < components; c++) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const sx = Math.min(width - 1, bx + x);
            const sy = Math.min(height - 1, by + y);
            block[y * 8 + x] = samples[(sy * width + sx) * components + c] - 128;
          }
        }
        const coef = new Array<number>(64);
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            let sum = 0;
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * cos[x * 8 + u] * cos[y * 8 + v];
            const cu = u === 0 ? Math.SQRT1_2 : 1;
            const cv = v === 0 ? Math.SQRT1_2 : 1;
            coef[v * 8 + u] = Math.round((0.25 * cu * cv * sum) / q);
          }
        }
        const diff = coef[0] - prevDc[c];
        prevDc[c] = coef[0];
        const ds = size(diff);
        put(ds, 4);
        if (ds) put(diff < 0 ? diff + (1 << ds) - 1 : diff, ds);
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const v = coef[ZIGZAG[k]];
          if (v === 0) {
            run++;
            continue;
          }
          while (run > 15) {
            put(acCode.get(0xf0)!, 8);
            run -= 16;
          }
          const s = size(v);
          put(acCode.get((run << 4) | s)!, 8);
          put(v < 0 ? v + (1 << s) - 1 : v, s);
          run = 0;
        }
        if (run > 0) put(acCode.get(0x00)!, 8);
      }
    }
  }
  if (n > 0) put(0xff, 8 - n);
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

/** Splits a JPEG into a tables-only stream (SOI, DQT, DHT, EOI) and an abbreviated stream without them. */
export function splitJpegTables(jpeg: Uint8Array): { tables: Uint8Array; strip: Uint8Array } {
  const tables: number[] = [0xff, 0xd8];
  const strip: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < jpeg.length) {
    const marker = jpeg[i + 1];
    if (marker === 0xda) {
      strip.push(...jpeg.subarray(i));
      break;
    }
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    const seg = jpeg.subarray(i, i + 2 + len);
    if (marker === 0xdb || marker === 0xc4) tables.push(...seg);
    else strip.push(...seg);
    i += 2 + len;
  }
  tables.push(0xff, 0xd9);
  return { tables: new Uint8Array(tables), strip: new Uint8Array(strip) };
}

/**
 * Rewrites a JPEG's markers: drops JFIF (APP0), sets the frame's component ids (to make the "RGB with no
 * colour transform" case libtiff writes), or adds an APP1 with an orientation (to check it is removed).
 */
export function editJpeg(jpeg: Uint8Array, edit: { dropApp0?: boolean; componentIds?: number[]; addApp1Orientation?: number; addAdobeTransform?: number }): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  if (edit.addApp1Orientation) {
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, edit.addApp1Orientation, 0, 0, 0, 0, 0, 0];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    out.push(0xff, 0xe1, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body);
  }
  if (edit.addAdobeTransform !== undefined) {
    out.push(0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, edit.addAdobeTransform);
  }
  const ids = new Map<number, number>();
  let i = 2;
  while (i < jpeg.length) {
    const marker = jpeg[i + 1];
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    const seg = Array.from(jpeg.subarray(i, i + 2 + len));
    if (marker === 0xda) {
      // the scan names its components by id too (one scan: a baseline JPEG)
      for (let c = 0; c < seg[4]; c++) seg[5 + c * 2] = ids.get(seg[5 + c * 2]) ?? seg[5 + c * 2];
      out.push(...seg, ...jpeg.subarray(i + 2 + len));
      break;
    }
    if (marker === 0xe0 && edit.dropApp0) {
      i += 2 + len;
      continue;
    }
    if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && edit.componentIds) {
      edit.componentIds.forEach((id, c) => {
        ids.set(seg[10 + c * 3], id);
        seg[10 + c * 3] = id;
      });
    }
    out.push(...seg);
    i += 2 + len;
  }
  return new Uint8Array(out);
}
