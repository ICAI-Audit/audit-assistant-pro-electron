// Decoders for the compressions TIFF uses: Deflate (zlib), LZW, PackBits and CCITT Group 3 and 4.
// Pure TypeScript, no DOM. Each decoder writes exactly the number of bytes asked for into a given
// buffer and stops there, so a small hostile stream cannot make it allocate or write more than the
// page it belongs to. Each is a generator that pauses (yields) every so often, so that the caller can
// let the screen paint and a stopped run end between slices. Anything wrong in the data throws a
// CodecError; nothing else is thrown on any input.

export type Work<T = void> = Generator<void, T, void>;

/** 'short': the data ends before the picture does; 'damaged': it breaks the format's rules. */
export type CodecReason = 'short' | 'damaged' | 'old-lzw' | 'fax-uncompressed';

export class CodecError extends Error {
  constructor(public reason: CodecReason) {
    super(`TIFF data: ${reason}`);
    this.name = 'CodecError';
  }
}

const short = () => new CodecError('short');
const damaged = () => new CodecError('damaged');

/** Output bytes between pauses of the byte decoders. */
const SLICE_BYTES = 1 << 16;
/** Input bytes between pauses where input is read without output (clear codes, empty blocks, no-op bytes). */
const SLICE_INPUT = 1 << 16;
/**
 * Input a byte decoder may read without writing anything: an honest encoder writes output within a few
 * hundred bytes, so a longer stretch is data made to stall the decoder (40 MB of it took seconds).
 */
const STALL_BYTES = 1 << 20;
/** Rows between pauses of the CCITT decoder. */
const SLICE_ROWS = 16;
/** Zero bits before a fax EOL: fill bits pad a row to a byte or to a transmission time, never to this many. */
const MAX_FILL_BITS = 1 << 16;

// ---- bit order ----------------------------------------------------------------------------------------

const REVERSED = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b);
    table[i] = r;
  }
  return table;
})();

/** A copy of `src` with the bits of every byte in reverse order (TIFF FillOrder 2). */
export function reverseBits(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = REVERSED[src[i]];
  return out;
}

// ---- Deflate (RFC 1950 / 1951) -------------------------------------------------------------------------

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code as a table indexed by the next `bits` input bits: (symbol << 4) | length; 0 = no code. */
interface Huffman {
  table: Int32Array;
  bits: number;
}

function huffman(lengths: Uint8Array, start: number, count: number): Huffman {
  const perLength = new Int32Array(16);
  let bits = 0;
  for (let i = 0; i < count; i++) {
    const len = lengths[start + i];
    perLength[len] += 1;
    if (len > bits) bits = len;
  }
  perLength[0] = 0;
  let left = 1;
  for (let len = 1; len <= 15; len++) {
    left = (left << 1) - perLength[len];
    if (left < 0) throw damaged(); // over-subscribed
  }
  const next = new Int32Array(16);
  for (let len = 1, code = 0; len <= 15; len++) {
    code = (code + perLength[len - 1]) << 1;
    next[len] = code;
  }
  const size = 1 << bits;
  const table = new Int32Array(size);
  for (let symbol = 0; symbol < count; symbol++) {
    const len = lengths[start + symbol];
    if (len === 0) continue;
    const code = next[len]++;
    let reversed = 0;
    for (let i = 0; i < len; i++) reversed |= ((code >> i) & 1) << (len - 1 - i);
    for (let j = reversed; j < size; j += 1 << len) table[j] = (symbol << 4) | len;
  }
  return { table, bits };
}

let fixedCodes: [Huffman, Huffman] | null = null;
function fixed(): [Huffman, Huffman] {
  if (!fixedCodes) {
    const lit = new Uint8Array(288);
    lit.fill(8, 0, 144);
    lit.fill(9, 144, 256);
    lit.fill(7, 256, 280);
    lit.fill(8, 280, 288);
    fixedCodes = [huffman(lit, 0, 288), huffman(new Uint8Array(30).fill(5), 0, 30)];
  }
  return fixedCodes;
}

/** Least-significant-bit-first reader. Bits past the end read as zero; using one throws 'short'. */
class LsbReader {
  buf = 0;
  count = 0;
  private padding = 0;
  constructor(private src: Uint8Array, public pos: number) {}

  need(n: number): void {
    while (this.count < n) {
      if (this.pos < this.src.length) this.buf |= this.src[this.pos++] << this.count;
      else this.padding += 8;
      this.count += 8;
    }
  }

  drop(n: number): void {
    this.buf >>>= n;
    this.count -= n;
    if (this.count < this.padding) throw short();
  }

  bits(n: number): number {
    if (n === 0) return 0;
    this.need(n);
    const value = this.buf & ((1 << n) - 1);
    this.drop(n);
    return value;
  }

  symbol(code: Huffman): number {
    if (code.bits === 0) throw damaged();
    this.need(code.bits);
    const entry = code.table[this.buf & ((1 << code.bits) - 1)];
    if (entry === 0) throw damaged();
    this.drop(entry & 15);
    return entry >> 4;
  }

  /** Whole bytes still in the buffer, then the source. */
  get exhausted(): boolean {
    return this.padding > 0;
  }
}

function dynamicCodes(reader: LsbReader): [Huffman, Huffman] {
  const literals = reader.bits(5) + 257;
  const distances = reader.bits(5) + 1;
  const lengthCodes = reader.bits(4) + 4;
  if (literals > 286 || distances > 30) throw damaged();
  const codeLengths = new Uint8Array(19);
  for (let i = 0; i < lengthCodes; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
  const lengthCode = huffman(codeLengths, 0, 19);
  const total = literals + distances;
  const lengths = new Uint8Array(total);
  for (let i = 0; i < total; ) {
    const symbol = reader.symbol(lengthCode);
    if (symbol < 16) {
      lengths[i++] = symbol;
      continue;
    }
    let value = 0;
    let repeat: number;
    if (symbol === 16) {
      if (i === 0) throw damaged();
      value = lengths[i - 1];
      repeat = 3 + reader.bits(2);
    } else if (symbol === 17) {
      repeat = 3 + reader.bits(3);
    } else {
      repeat = 11 + reader.bits(7);
    }
    if (i + repeat > total) throw damaged();
    lengths.fill(value, i, i + repeat);
    i += repeat;
  }
  if (lengths[256] === 0) throw damaged(); // no end-of-block code
  return [huffman(lengths, 0, literals), huffman(lengths, literals, distances)];
}

/**
 * Inflates a zlib stream into out[start, start + length). Back-references reach only bytes written by
 * this call. The checksum is not read: the stream may stop once the picture is complete.
 */
export function* inflateInto(src: Uint8Array, out: Uint8Array, start: number, length: number): Work {
  yield* inflateCore(src, out, start, length, false);
}

/**
 * At most the first `max` bytes a zlib stream inflates to, without inflating the rest (a 510 KB stream
 * can inflate to 512 MB). A stream that ends sooner gives what it holds; damaged data throws CodecError.
 */
export function inflatePrefix(src: Uint8Array, max: number): Uint8Array {
  const run = (room: number) => {
    const out = new Uint8Array(room);
    const work = inflateCore(src, out, 0, room, true);
    let step = work.next();
    while (!step.done) step = work.next();
    return out.subarray(0, step.value);
  };
  // most streams inflate to a few times their size: try that room first, and the whole `max` only if it fills
  const guess = Math.min(max, 16 * src.length + 4096);
  const first = run(guess);
  return first.length < guess || guess === max ? first : run(max);
}

/** Inflates into out[start, start + length); returns the bytes written. `untilEnd`: a stream may end before `length`. */
function* inflateCore(src: Uint8Array, out: Uint8Array, start: number, length: number, untilEnd: boolean): Work<number> {
  if (src.length < 2) throw short();
  const cmf = src[0];
  const flg = src[1];
  if ((cmf & 15) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0 || flg & 0x20) throw damaged();
  const reader = new LsbReader(src, 2);
  const end = start + length;
  let o = start;
  let pauseAt = o + SLICE_BYTES;
  let pauseIn = reader.pos + SLICE_INPUT;
  let progressAt = o;
  let progressIn = reader.pos;
  // Each block with its own codes builds two tables of up to 32,768 entries: blocks that write little
  // or nothing could make that the work. An honest stream has one block per thousands of bytes written.
  let tableWork = 0;
  const tableBudget = (1 << 22) + 64 * length;
  let last = 0;
  while (o < end) {
    if (last) {
      if (untilEnd) return o - start;
      throw short(); // the stream ended before the picture did
    }
    if (o > progressAt) {
      progressAt = o;
      progressIn = reader.pos;
    } else if (reader.pos - progressIn > STALL_BYTES) {
      throw damaged();
    }
    if (reader.pos >= pauseIn) {
      pauseIn = reader.pos + SLICE_INPUT;
      yield;
    }
    last = reader.bits(1);
    const type = reader.bits(2);
    if (type === 0) {
      reader.drop(reader.count & 7);
      const len = reader.bits(16);
      if ((len ^ 0xffff) !== reader.bits(16)) throw damaged();
      let n = len;
      while (n > 0 && reader.count >= 8 && o < end) {
        out[o++] = reader.bits(8);
        n--;
      }
      if (o >= end) return o - start;
      const take = Math.min(n, end - o, src.length - reader.pos);
      out.set(src.subarray(reader.pos, reader.pos + take), o);
      o += take;
      reader.pos += take;
      if (o >= end) return o - start;
      if (take < n) throw short();
    } else if (type === 1 || type === 2) {
      const [literal, distance] = type === 1 ? fixed() : dynamicCodes(reader);
      if (type === 2) {
        tableWork += literal.table.length + distance.table.length;
        if (tableWork > tableBudget) throw damaged();
      }
      for (;;) {
        const symbol = reader.symbol(literal);
        if (symbol < 256) {
          out[o++] = symbol;
          if (o >= end) return o - start;
        } else if (symbol === 256) {
          break;
        } else {
          const li = symbol - 257;
          if (li >= 29) throw damaged();
          const len = LEN_BASE[li] + reader.bits(LEN_EXTRA[li]);
          const ds = reader.symbol(distance);
          if (ds >= 30) throw damaged();
          const dist = DIST_BASE[ds] + reader.bits(DIST_EXTRA[ds]);
          if (dist > o - start) throw damaged();
          const n = Math.min(len, end - o);
          for (let i = 0; i < n; i++, o++) out[o] = out[o - dist];
          if (o >= end) return o - start;
        }
        if (o >= pauseAt) {
          pauseAt = o + SLICE_BYTES;
          yield;
        }
      }
    } else {
      throw damaged();
    }
    if (o >= pauseAt) {
      pauseAt = o + SLICE_BYTES;
      yield;
    }
  }
  return o - start;
}

// ---- LZW (TIFF 6.0, as libtiff writes it) --------------------------------------------------------------

/**
 * TIFF LZW into out[start, start + length): codes most significant bit first, 9 to 12 bits, widening one
 * code early; 256 clears the table, 257 ends. The old LSB-first form of early libtiff is refused.
 */
export function* lzwInto(src: Uint8Array, out: Uint8Array, start: number, length: number): Work {
  if (src.length >= 2 && src[0] === 0 && src[1] & 1) throw new CodecError('old-lzw');
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const size = new Uint16Array(4096);
  const first = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    size[i] = 1;
    first[i] = i;
  }
  const totalBits = src.length * 8;
  const end = start + length;
  let o = start;
  let pauseAt = o + SLICE_BYTES;
  let bitPos = 0;
  let width = 9;
  let next = 258;
  let prev = -1;
  // clear codes write nothing: they pause by input read, and too many of them in a row is not LZW
  let pauseBits = SLICE_INPUT * 8;
  let progressAt = o;
  let progressBits = 0;

  const emit = (code: number): void => {
    const len = size[code];
    const n = Math.min(len, end - o);
    let c = code;
    for (let j = len - 1; j >= 0; j--) {
      if (j < n) out[o + j] = suffix[c];
      c = prefix[c];
    }
    o += n;
  };

  while (o < end) {
    if (bitPos + width > totalBits) throw short();
    const at = bitPos >> 3;
    const window = (src[at] << 16) | ((at + 1 < src.length ? src[at + 1] : 0) << 8) | (at + 2 < src.length ? src[at + 2] : 0);
    const code = (window >>> (24 - (bitPos & 7) - width)) & ((1 << width) - 1);
    bitPos += width;
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      if (o > progressAt) {
        progressAt = o;
        progressBits = bitPos;
      } else if (bitPos - progressBits > STALL_BYTES * 8) {
        throw damaged();
      }
      if (bitPos >= pauseBits) {
        pauseBits = bitPos + SLICE_INPUT * 8;
        yield;
      }
      continue;
    }
    if (code === 257) break;
    if (prev === -1) {
      if (code > 255) throw damaged();
      out[o++] = code;
      prev = code;
      continue;
    }
    if (code < next) {
      emit(code);
      if (next < 4096) {
        prefix[next] = prev;
        suffix[next] = first[code];
        size[next] = size[prev] + 1;
        first[next] = first[prev];
        next++;
      }
    } else if (code === next && next < 4096) {
      prefix[next] = prev;
      suffix[next] = first[prev];
      size[next] = size[prev] + 1;
      first[next] = first[prev];
      next++;
      emit(code);
    } else {
      throw damaged();
    }
    prev = code;
    if (next >= (1 << width) - 1 && width < 12) width++;
    if (o >= pauseAt) {
      pauseAt = o + SLICE_BYTES;
      yield;
    }
  }
  if (o < end) throw short();
}

// ---- PackBits ------------------------------------------------------------------------------------------

/** PackBits into out[start, start + length). The byte 128 is skipped, as TIFF says. */
export function* packBitsInto(src: Uint8Array, out: Uint8Array, start: number, length: number): Work {
  const end = start + length;
  let o = start;
  let i = 0;
  let pauseAt = o + SLICE_BYTES;
  let pauseIn = SLICE_INPUT;
  let noOps = 0;
  while (o < end) {
    if (i >= src.length) throw short();
    const n = src[i++];
    if (n < 128) {
      const count = n + 1;
      if (i + count > src.length) throw short();
      const take = Math.min(count, end - o);
      out.set(src.subarray(i, i + take), o);
      o += take;
      i += count;
      noOps = 0;
    } else if (n > 128) {
      if (i >= src.length) throw short();
      const take = Math.min(257 - n, end - o);
      out.fill(src[i++], o, o + take);
      o += take;
      noOps = 0;
    } else if (++noOps > STALL_BYTES) {
      throw damaged(); // 128 writes nothing and encoders do not write it: this many in a row is not PackBits
    }
    if (o >= pauseAt || i >= pauseIn) {
      pauseAt = o + SLICE_BYTES;
      pauseIn = i + SLICE_INPUT;
      yield;
    }
  }
}

// ---- CCITT Group 3 and Group 4 (ITU-T T.4, T.6) --------------------------------------------------------

/** Terminating (0-63) and make-up (64-1728) codes for white runs, T.4 tables 2 and 3. */
export const WHITE_CODES: readonly (readonly [number, string])[] = [
  [0, '00110101'], [1, '000111'], [2, '0111'], [3, '1000'], [4, '1011'], [5, '1100'], [6, '1110'], [7, '1111'],
  [8, '10011'], [9, '10100'], [10, '00111'], [11, '01000'], [12, '001000'], [13, '000011'], [14, '110100'], [15, '110101'],
  [16, '101010'], [17, '101011'], [18, '0100111'], [19, '0001100'], [20, '0001000'], [21, '0010111'], [22, '0000011'], [23, '0000100'],
  [24, '0101000'], [25, '0101011'], [26, '0010011'], [27, '0100100'], [28, '0011000'], [29, '00000010'], [30, '00000011'], [31, '00011010'],
  [32, '00011011'], [33, '00010010'], [34, '00010011'], [35, '00010100'], [36, '00010101'], [37, '00010110'], [38, '00010111'], [39, '00101000'],
  [40, '00101001'], [41, '00101010'], [42, '00101011'], [43, '00101100'], [44, '00101101'], [45, '00000100'], [46, '00000101'], [47, '00001010'],
  [48, '00001011'], [49, '01010010'], [50, '01010011'], [51, '01010100'], [52, '01010101'], [53, '00100100'], [54, '00100101'], [55, '01011000'],
  [56, '01011001'], [57, '01011010'], [58, '01011011'], [59, '01001010'], [60, '01001011'], [61, '00110010'], [62, '00110011'], [63, '00110100'],
  [64, '11011'], [128, '10010'], [192, '010111'], [256, '0110111'], [320, '00110110'], [384, '00110111'], [448, '01100100'], [512, '01100101'],
  [576, '01101000'], [640, '01100111'], [704, '011001100'], [768, '011001101'], [832, '011010010'], [896, '011010011'], [960, '011010100'], [1024, '011010101'],
  [1088, '011010110'], [1152, '011010111'], [1216, '011011000'], [1280, '011011001'], [1344, '011011010'], [1408, '011011011'], [1472, '010011000'], [1536, '010011001'],
  [1600, '010011010'], [1664, '011000'], [1728, '010011011'],
];

/** Terminating (0-63) and make-up (64-1728) codes for black runs, T.4 tables 2 and 3. */
export const BLACK_CODES: readonly (readonly [number, string])[] = [
  [0, '0000110111'], [1, '010'], [2, '11'], [3, '10'], [4, '011'], [5, '0011'], [6, '0010'], [7, '00011'],
  [8, '000101'], [9, '000100'], [10, '0000100'], [11, '0000101'], [12, '0000111'], [13, '00000100'], [14, '00000111'], [15, '000011000'],
  [16, '0000010111'], [17, '0000011000'], [18, '0000001000'], [19, '00001100111'], [20, '00001101000'], [21, '00001101100'], [22, '00000110111'], [23, '00000101000'],
  [24, '00000010111'], [25, '00000011000'], [26, '000011001010'], [27, '000011001011'], [28, '000011001100'], [29, '000011001101'], [30, '000001101000'], [31, '000001101001'],
  [32, '000001101010'], [33, '000001101011'], [34, '000011010010'], [35, '000011010011'], [36, '000011010100'], [37, '000011010101'], [38, '000011010110'], [39, '000011010111'],
  [40, '000001101100'], [41, '000001101101'], [42, '000011011010'], [43, '000011011011'], [44, '000001010100'], [45, '000001010101'], [46, '000001010110'], [47, '000001010111'],
  [48, '000001100100'], [49, '000001100101'], [50, '000001010010'], [51, '000001010011'], [52, '000000100100'], [53, '000000110111'], [54, '000000111000'], [55, '000000100111'],
  [56, '000000101000'], [57, '000001011000'], [58, '000001011001'], [59, '000000101011'], [60, '000000101100'], [61, '000001011010'], [62, '000001100110'], [63, '000001100111'],
  [64, '0000001111'], [128, '000011001000'], [192, '000011001001'], [256, '000001011011'], [320, '000000110011'], [384, '000000110100'], [448, '000000110101'], [512, '0000001101100'],
  [576, '0000001101101'], [640, '0000001001010'], [704, '0000001001011'], [768, '0000001001100'], [832, '0000001001101'], [896, '0000001110010'], [960, '0000001110011'], [1024, '0000001110100'],
  [1088, '0000001110101'], [1152, '0000001110110'], [1216, '0000001110111'], [1280, '0000001010010'], [1344, '0000001010011'], [1408, '0000001010100'], [1472, '0000001010101'], [1536, '0000001011010'],
  [1600, '0000001011011'], [1664, '0000001100100'], [1728, '0000001100101'],
];

/** Make-up codes 1792-2560, the same for both colours (T.4 table 3a). */
export const EXTENDED_MAKEUP: readonly (readonly [number, string])[] = [
  [1792, '00000001000'], [1856, '00000001100'], [1920, '00000001101'], [1984, '000000010010'], [2048, '000000010011'], [2112, '000000010100'],
  [2176, '000000010101'], [2240, '000000010110'], [2304, '000000010111'], [2368, '000000011100'], [2432, '000000011101'], [2496, '000000011110'],
  [2560, '000000011111'],
];

/** Two-dimensional mode codes (T.4 table 4); 'X' is the extension code that starts uncompressed mode. */
export const FAX_MODE_CODES: readonly (readonly [string, string])[] = [
  ['P', '0001'], ['H', '001'], ['V0', '1'], ['VR1', '011'], ['VR2', '000011'], ['VR3', '0000011'],
  ['VL1', '010'], ['VL2', '000010'], ['VL3', '0000010'], ['X', '0000001'],
];

const RUN_BITS = 13;

function runTable(...tables: (readonly (readonly [number, string])[])[]): Int32Array {
  const table = new Int32Array(1 << RUN_BITS);
  for (const list of tables) {
    for (const [run, code] of list) {
      const base = parseInt(code, 2) << (RUN_BITS - code.length);
      for (let j = 0; j < 1 << (RUN_BITS - code.length); j++) table[base + j] = (run << 4) | code.length;
    }
  }
  return table;
}

const WHITE = runTable(WHITE_CODES, EXTENDED_MAKEUP);
const BLACK = runTable(BLACK_CODES, EXTENDED_MAKEUP);

const MODE_BITS = 7;
const PASS = 1;
const HORIZONTAL = 2;
const EXTENSION = 3;
/** Vertical modes are stored as 10 + (a1 - b1). */
const VERTICAL = 10;
const MODES = (() => {
  const table = new Int32Array(1 << MODE_BITS);
  const value: Record<string, number> = { P: PASS, H: HORIZONTAL, X: EXTENSION, V0: VERTICAL, VR1: VERTICAL + 1, VR2: VERTICAL + 2, VR3: VERTICAL + 3, VL1: VERTICAL - 1, VL2: VERTICAL - 2, VL3: VERTICAL - 3 };
  for (const [name, code] of FAX_MODE_CODES) {
    const base = parseInt(code, 2) << (MODE_BITS - code.length);
    for (let j = 0; j < 1 << (MODE_BITS - code.length); j++) table[base + j] = (value[name] << 4) | code.length;
  }
  return table;
})();

/**
 * Most-significant-bit-first reader for the CCITT codes. It reads the data where it is (a copy of every
 * strip, however long the strip claimed to be, was most of the work for a page of 20,000 strips), with
 * the bits of each byte reversed on the way for FillOrder 2; bits past the end read as zero.
 */
class MsbReader {
  pos = 0;
  readonly total: number;
  constructor(private readonly src: Uint8Array, private readonly order: Uint8Array | null = null) {
    this.total = src.length * 8;
  }

  private byte(i: number): number {
    if (i >= this.src.length) return 0;
    return this.order ? this.order[this.src[i]] : this.src[i];
  }

  peek(n: number): number {
    const at = this.pos >> 3;
    const s = this.src;
    let window: number;
    if (at + 3 < s.length) {
      const o = this.order;
      window = o
        ? ((o[s[at]] << 24) | (o[s[at + 1]] << 16) | (o[s[at + 2]] << 8) | o[s[at + 3]]) >>> 0
        : ((s[at] << 24) | (s[at + 1] << 16) | (s[at + 2] << 8) | s[at + 3]) >>> 0;
    } else {
      if (at > s.length) return 0; // only once the position is past the end
      window = ((this.byte(at) << 24) | (this.byte(at + 1) << 16) | (this.byte(at + 2) << 8) | this.byte(at + 3)) >>> 0;
    }
    return ((window << (this.pos & 7)) >>> 0) >>> (32 - n);
  }

  skip(n: number): void {
    this.pos += n;
    if (this.pos > this.total) throw short();
  }

  align(): void {
    this.pos = (this.pos + 7) & ~7;
  }
}

/** A run of one colour: make-up codes then a terminating code. */
function readRun(reader: MsbReader, table: Int32Array, most: number): number {
  let run = 0;
  for (;;) {
    if (reader.pos >= reader.total) throw short();
    const entry = table[reader.peek(RUN_BITS)];
    if (entry === 0) throw damaged(); // an EOL or invalid bits inside a row
    reader.skip(entry & 15);
    const value = entry >> 4;
    run += value;
    if (run > most) throw damaged();
    if (value < 64) return run;
  }
}

/**
 * Skips an EOL (at least 11 zero bits, then a 1) if one is next; otherwise leaves the position alone.
 * More than MAX_FILL_BITS zero bits is not fill: data made to hold the decoder in one row.
 */
function skipEol(reader: MsbReader): boolean {
  const at = reader.pos;
  let zeros = 0;
  while (reader.pos < reader.total) {
    if (zeros > MAX_FILL_BITS) throw damaged();
    if (reader.peek(8) === 0 && reader.pos + 8 <= reader.total) {
      reader.pos += 8;
      zeros += 8;
      continue;
    }
    if (reader.peek(1) === 0) {
      reader.pos += 1;
      zeros += 1;
      continue;
    }
    break;
  }
  if (zeros >= 11 && reader.pos < reader.total) {
    reader.pos += 1;
    return true;
  }
  reader.pos = at;
  return false;
}

/** One row coded in one dimension; returns how many changing elements it has. */
function row1D(reader: MsbReader, cur: Int32Array, columns: number): number {
  let pos = 0;
  let colour = 0;
  let n = 0;
  for (;;) {
    const run = readRun(reader, colour ? BLACK : WHITE, columns - pos);
    if (run === 0 && n > 0) throw damaged(); // only the first (white) run may be empty
    pos += run;
    cur[n++] = pos;
    if (pos === columns) return n;
    colour ^= 1;
  }
}

/** One row coded in two dimensions against `ref`; returns how many changing elements it has. */
function row2D(reader: MsbReader, ref: Int32Array, refLength: number, cur: Int32Array, columns: number): number {
  let a0 = -1;
  let colour = 0;
  let n = 0;
  let bi = 0;
  while (a0 < columns) {
    // b1: the first changing element of the reference row right of a0 whose colour is not a0's
    while (bi > 0 && ref[bi - 1] > a0) bi--;
    while (bi < refLength && (ref[bi] <= a0 || (bi & 1) !== colour)) bi++;
    const b1 = bi < refLength ? Math.min(ref[bi], columns) : columns;
    const b2 = bi + 1 < refLength ? Math.min(ref[bi + 1], columns) : columns;
    if (reader.pos >= reader.total) throw short();
    const entry = MODES[reader.peek(MODE_BITS)];
    if (entry === 0) throw reader.peek(12) === 1 ? short() : damaged(); // an EOL: the block ended early
    reader.skip(entry & 15);
    const mode = entry >> 4;
    if (mode === PASS) {
      a0 = b2;
    } else if (mode === HORIZONTAL) {
      const from = a0 < 0 ? 0 : a0;
      const a1 = from + readRun(reader, colour ? BLACK : WHITE, columns - from);
      const a2 = a1 + readRun(reader, colour ? WHITE : BLACK, columns - a1);
      if ((a0 >= 0 && a1 <= a0) || (a2 <= a1 && a2 !== columns)) throw damaged();
      cur[n++] = a1;
      cur[n++] = a2;
      a0 = a2;
    } else if (mode === EXTENSION) {
      throw new CodecError('fax-uncompressed');
    } else {
      let a1 = b1 + (mode - VERTICAL);
      if (a1 > columns) a1 = columns;
      if (a1 < 0 || (a0 >= 0 && a1 <= a0)) throw damaged();
      cur[n++] = a1;
      a0 = a1;
      colour ^= 1;
    }
  }
  return n;
}

/** Sets bits [x0, x1) of a row to 1, most significant bit first. */
function setBits(out: Uint8Array, row: number, x0: number, x1: number): void {
  if (x0 >= x1) return;
  const b0 = x0 >> 3;
  const b1 = (x1 - 1) >> 3;
  const m0 = 0xff >> (x0 & 7);
  const m1 = (0xff << (7 - ((x1 - 1) & 7))) & 0xff;
  if (b0 === b1) {
    out[row + b0] |= m0 & m1;
    return;
  }
  out[row + b0] |= m0;
  out.fill(0xff, row + b0 + 1, row + b1);
  out[row + b1] |= m1;
}

export type FaxMode = 'g4' | 'g3-1d' | 'g3-2d' | 'mh';

/**
 * CCITT data of one strip or tile into packed rows at out[start...]: `rows` rows of `columns` pixels,
 * ceil(columns / 8) bytes each; a "white" code gives 0 bits and a "black" code 1 bits, as libtiff
 * does. 'g4' is T.6; 'g3-1d' and 'g3-2d' are T.4 with an EOL before each row (the first may lack
 * it) and, for 2-D, a tag bit after it; 'mh' is TIFF compression 2: one-dimensional rows, each
 * starting on a byte, without EOLs. `reversed`: the data is stored least significant bit first (TIFF
 * FillOrder 2); it is read so, without a copy.
 */
export function* faxInto(src: Uint8Array, out: Uint8Array, start: number, columns: number, rows: number, mode: FaxMode, reversed = false): Work {
  const rowBytes = (columns + 7) >> 3;
  const reader = new MsbReader(src, reversed ? REVERSED : null);
  let ref = new Int32Array(columns + 4);
  let cur = new Int32Array(columns + 4);
  let refLength = 0; // the row before the first is white
  for (let y = 0; y < rows; y++) {
    let twoD = mode === 'g4';
    if (mode === 'g3-1d' || mode === 'g3-2d') {
      const eol = skipEol(reader);
      if (!eol && y > 0) throw reader.pos >= reader.total ? short() : damaged();
      if (eol && mode === 'g3-2d') {
        if (reader.pos >= reader.total) throw short();
        twoD = reader.peek(1) === 0;
        reader.skip(1);
      }
    }
    const n = twoD ? row2D(reader, ref, refLength, cur, columns) : row1D(reader, cur, columns);
    const row = start + y * rowBytes;
    out.fill(0, row, row + rowBytes);
    for (let i = 0; i < n; i += 2) setBits(out, row, cur[i], i + 1 < n ? cur[i + 1] : columns);
    if (mode === 'mh') reader.align();
    const swap = ref;
    ref = cur;
    cur = swap;
    refLength = n;
    if (y % SLICE_ROWS === SLICE_ROWS - 1) yield;
  }
}
