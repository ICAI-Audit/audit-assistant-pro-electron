// A picture a PDF page draws, as a file Word and Excel can hold (PDF to Word; design 5.11). Read from the
// picture's own data with pdf-lib, never from a drawing of the page, so text lying over a faint background
// picture is not baked into it. A JPEG is passed on as it is; grey, colour and palette pictures of 1 to 8
// bits are written as PNG (with their soft mask as transparency). Any other kind (a JPEG with a soft mask, JPEG 2000, fax
// codings, CMYK samples, a stencil mask) gives null, and the picture is then left out.
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFStream, PDFString } from 'pdf-lib';
import { decodeStreamBytes } from './marks';

export interface PictureFile {
  bytes: Uint8Array;
  type: 'png' | 'jpeg';
  /** Pixels. */
  width: number;
  height: number;
}

/** A picture with more pixels than this is left out. */
export const MAX_PICTURE_PIXELS = 16_000_000;

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A PNG of `width` × `height` pixels of `channels` bytes each (1 grey, 2 grey and alpha, 3 colour, 4 colour and
 * alpha), row by row from the top. The pixel data is stored, not packed: the office file that holds it is a zip
 * and packs it there.
 */
export function encodePng(pixels: Uint8Array, width: number, height: number, channels: 1 | 2 | 3 | 4): Uint8Array {
  const row = width * channels;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const idat = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  idat[0] = 0x78;
  idat[1] = 0x01;
  let at = 2;
  let a = 1;
  let b = 0;
  for (let k = 0; k < blocks; k++) {
    const from = k * 65535;
    const length = Math.min(65535, raw.length - from);
    idat[at++] = k === blocks - 1 ? 1 : 0;
    idat[at++] = length & 0xff;
    idat[at++] = length >>> 8;
    idat[at++] = ~length & 0xff;
    idat[at++] = (~length >>> 8) & 0xff;
    idat.set(raw.subarray(from, from + length), at);
    at += length;
  }
  // Adler-32, in stretches short enough that the sums stay exact.
  for (let i = 0; i < raw.length; ) {
    const end = Math.min(raw.length, i + 3800);
    for (; i < end; i++) {
      a += raw[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  idat[at++] = b >>> 8;
  idat[at++] = b & 0xff;
  idat[at++] = a >>> 8;
  idat[at++] = a & 0xff;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6;
  const chunks: [string, Uint8Array][] = [['IHDR', header], ['IDAT', idat], ['IEND', new Uint8Array(0)]];
  const out = new Uint8Array(8 + chunks.reduce((n, [, data]) => n + 12 + data.length, 0));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const whole = new DataView(out.buffer);
  let o = 8;
  for (const [name, data] of chunks) {
    whole.setUint32(o, data.length);
    for (let k = 0; k < 4; k++) out[o + 4 + k] = name.charCodeAt(k);
    out.set(data, o + 8);
    whole.setUint32(o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  }
  return out;
}

const num = (dict: PDFDict, key: string, short?: string): number | null => {
  const v = dict.lookup(PDFName.of(key)) ?? (short ? dict.lookup(PDFName.of(short)) : undefined);
  return v instanceof PDFNumber ? v.asNumber() : null;
};

interface Space { channels: 1 | 3; palette?: Uint8Array; paletteChannels?: 1 | 3 }

/** The colour space as far as it is read here: grey or RGB samples, or a palette of them. */
function spaceOf(value: unknown, depth = 0): Space | null {
  if (value instanceof PDFName) {
    const name = value.decodeText();
    if (name === 'DeviceGray' || name === 'CalGray' || name === 'G') return { channels: 1 };
    if (name === 'DeviceRGB' || name === 'CalRGB' || name === 'RGB') return { channels: 3 };
    return null;
  }
  if (!(value instanceof PDFArray) || value.size() === 0 || depth > 2) return null;
  const head = value.lookup(0);
  const kind = head instanceof PDFName ? head.decodeText() : '';
  if (kind === 'CalGray') return { channels: 1 };
  if (kind === 'CalRGB') return { channels: 3 };
  if (kind === 'ICCBased') {
    const profile = value.lookup(1);
    const n = profile instanceof PDFStream ? num(profile.dict, 'N') : null;
    return n === 1 ? { channels: 1 } : n === 3 ? { channels: 3 } : null;
  }
  if ((kind === 'Indexed' || kind === 'I') && value.size() >= 4) {
    const base = spaceOf(value.lookup(1), depth + 1);
    if (!base || base.palette) return null;
    const table = value.lookup(3);
    let palette: Uint8Array | null = null;
    if (table instanceof PDFStream) palette = decodeStreamBytes(table);
    else if (table instanceof PDFString || table instanceof PDFHexString) palette = table.asBytes();
    return palette ? { channels: 1, palette, paletteChannels: base.channels } : null;
  }
  return null;
}

/** The filters of a stream by their long names. */
function filtersOf(stream: PDFStream): string[] {
  const f = stream.dict.lookup(PDFName.of('Filter')) ?? stream.dict.lookup(PDFName.of('F'));
  const list = f instanceof PDFArray ? f.asArray().map((v) => stream.dict.context.lookup(v)) : f ? [f] : [];
  return list.map((v) => (v instanceof PDFName ? v.decodeText() : '?'));
}

/** Sample `i` of a row of `bits`-bit samples starting at byte `from`. */
function sample(data: Uint8Array, from: number, i: number, bits: number): number {
  if (bits === 8) return data[from + i];
  const bit = i * bits;
  return (data[from + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
}

/**
 * The picture held by an image stream of a PDF as a JPEG or PNG file, or null when it is of a kind not read
 * here, is larger than MAX_PICTURE_PIXELS, or its data does not fit its stated size. Never throws.
 */
export function pictureFile(image: PDFStream): PictureFile | null {
  try {
    const dict = image.dict;
    const width = num(dict, 'Width', 'W');
    const height = num(dict, 'Height', 'H');
    if (!width || !height || width < 1 || height < 1 || width * height > MAX_PICTURE_PIXELS) return null;
    const mask = dict.lookup(PDFName.of('ImageMask'));
    if (mask && mask.toString() === 'true') return null;
    const filters = filtersOf(image);
    if (filters.length === 1 && (filters[0] === 'DCTDecode' || filters[0] === 'DCT')) {
      // A JPEG with a soft mask shows only part of itself; without the mask it would cover what lies under it.
      if (dict.lookup(PDFName.of('SMask')) instanceof PDFStream) return null;
      const bytes = image.getContents();
      return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 ? { bytes: bytes.slice(), type: 'jpeg', width, height } : null;
    }
    const bits = num(dict, 'BitsPerComponent', 'BPC') ?? 8;
    if (![1, 2, 4, 8].includes(bits)) return null;
    const space = spaceOf(dict.lookup(PDFName.of('ColorSpace')) ?? dict.lookup(PDFName.of('CS')));
    if (!space) return null;
    const data = decodeStreamBytes(image);
    if (!data) return null;
    const stride = Math.ceil((width * space.channels * bits) / 8);
    if (data.length < stride * height) return null;
    // Samples the other way round ([1 0]): only for grey.
    const decode = dict.lookup(PDFName.of('Decode')) ?? dict.lookup(PDFName.of('D'));
    const first = decode instanceof PDFArray && decode.size() >= 2 ? decode.lookup(0) : undefined;
    const inverted = !space.palette && space.channels === 1 && first instanceof PDFNumber && first.asNumber() === 1;

    // A soft mask of the same size is the picture's transparency.
    let alpha: Uint8Array | null = null;
    const soft = dict.lookup(PDFName.of('SMask'));
    if (soft instanceof PDFStream && num(soft.dict, 'Width') === width && num(soft.dict, 'Height') === height && (num(soft.dict, 'BitsPerComponent') ?? 8) === 8) {
      const softFilters = filtersOf(soft);
      const softData = softFilters.some((f) => f === 'DCTDecode' || f === 'JPXDecode') ? null : decodeStreamBytes(soft);
      if (softData && softData.length >= width * height) alpha = softData;
    }
    const colour = space.palette ? space.paletteChannels === 3 : space.channels === 3;
    const channels = ((colour ? 3 : 1) + (alpha ? 1 : 0)) as 1 | 2 | 3 | 4;
    const out = new Uint8Array(width * height * channels);
    const top = (1 << bits) - 1;
    let o = 0;
    for (let y = 0; y < height; y++) {
      const from = y * stride;
      for (let x = 0; x < width; x++) {
        if (space.palette) {
          const index = sample(data, from, x, bits);
          const n = space.paletteChannels ?? 1;
          for (let k = 0; k < n; k++) out[o++] = space.palette[index * n + k] ?? 0;
        } else if (space.channels === 3) {
          for (let k = 0; k < 3; k++) out[o++] = bits === 8 ? data[from + x * 3 + k] : Math.round((sample(data, from, x * 3 + k, bits) * 255) / top);
        } else {
          const v = bits === 8 ? data[from + x] : Math.round((sample(data, from, x, bits) * 255) / top);
          out[o++] = inverted ? 255 - v : v;
        }
        if (alpha) out[o++] = alpha[y * width + x];
      }
    }
    return { bytes: encodePng(out, width, height, channels), type: 'png', width, height };
  } catch {
    return null;
  }
}
