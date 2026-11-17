// Reads an image's pixel size (and whether it is animated) from its header, before anything is
// decoded, so an oversized image is refused without allocating its pixels.

export type HeaderFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';

export interface ImageHeaderInfo {
  format: HeaderFormat;
  width: number;
  height: number;
  /** Animated GIF, WebP or PNG: only the first frame can be placed in a PDF. */
  animated: boolean;
}

/** One limit for every image added to the list. */
export const IMAGE_MAX_SIDE = 20_000;
export const IMAGE_MAX_PIXELS = 50_000_000;

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const le32s = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const text = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): Omit<ImageHeaderInfo, 'format'> | null {
  if (b.length < 24 || text(b, 12, 4) !== 'IHDR') return null;
  const width = be32(b, 16);
  const height = be32(b, 20);
  let animated = false;
  for (let pos = 8; pos + 8 <= b.length; ) {
    const type = text(b, pos + 4, 4);
    if (type === 'acTL') animated = true;
    if (type === 'IDAT' || type === 'acTL') break;
    pos += 12 + be32(b, pos);
  }
  return { width, height, animated };
}

function jpeg(b: Uint8Array): Omit<ImageHeaderInfo, 'format'> | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = be16(b, i + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > b.length) return null;
      return { width: be16(b, i + 7), height: be16(b, i + 5), animated: false };
    }
    i += 2 + length;
  }
  return null;
}

function skipSubBlocks(b: Uint8Array, pos: number): number {
  while (pos < b.length) {
    const size = b[pos];
    pos += 1;
    if (size === 0) return pos;
    pos += size;
  }
  return -1;
}

function gif(b: Uint8Array): Omit<ImageHeaderInfo, 'format'> | null {
  if (b.length < 13) return null;
  const width = le16(b, 6);
  const height = le16(b, 8);
  let pos = 13;
  if (b[10] & 0x80) pos += 3 * (1 << ((b[10] & 7) + 1));
  let frames = 0;
  while (pos >= 0 && pos < b.length && frames < 2) {
    const id = b[pos];
    if (id === 0x21) {
      pos = skipSubBlocks(b, pos + 2);
    } else if (id === 0x2c) {
      frames += 1;
      if (pos + 10 > b.length) break;
      const packed = b[pos + 9];
      pos += 10;
      if (packed & 0x80) pos += 3 * (1 << ((packed & 7) + 1));
      pos = skipSubBlocks(b, pos + 1);
    } else {
      break; // trailer or damaged data
    }
  }
  return { width, height, animated: frames > 1 };
}

function bmp(b: Uint8Array): Omit<ImageHeaderInfo, 'format'> | null {
  if (b.length < 26) return null;
  if (le32s(b, 14) === 12) return { width: le16(b, 18), height: le16(b, 20), animated: false };
  return { width: Math.abs(le32s(b, 18)), height: Math.abs(le32s(b, 22)), animated: false };
}

function webp(b: Uint8Array): Omit<ImageHeaderInfo, 'format'> | null {
  const kind = text(b, 12, 4);
  if (kind === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff, animated: false };
  }
  if (kind === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = le32s(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
  }
  if (kind === 'VP8X') {
    if (b.length < 30) return null;
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1, animated: (b[20] & 0x02) !== 0 };
  }
  return null;
}

/** The image's format, size and animation, or null when the header cannot be read. */
export function readImageHeader(bytes: Uint8Array): ImageHeaderInfo | null {
  let format: HeaderFormat | null = null;
  let info: Omit<ImageHeaderInfo, 'format'> | null = null;
  if (bytes.length >= 8 && bytes[0] === 0x89 && text(bytes, 1, 3) === 'PNG') {
    format = 'png';
    info = png(bytes);
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    format = 'jpeg';
    info = jpeg(bytes);
  } else if (text(bytes, 0, 6) === 'GIF87a' || text(bytes, 0, 6) === 'GIF89a') {
    format = 'gif';
    info = gif(bytes);
  } else if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
    format = 'webp';
    info = webp(bytes);
  } else if (text(bytes, 0, 2) === 'BM') {
    format = 'bmp';
    info = bmp(bytes);
  }
  if (!format || !info || !(info.width > 0 && info.height > 0)) return null;
  return { format, ...info };
}

const count = new Intl.NumberFormat('en-IN');

/** A plain message when the image is over the limit, otherwise null. */
export function imageSizeProblem({ width, height }: { width: number; height: number }): string | null {
  const limits = `PDF Tools accepts images up to ${count.format(IMAGE_MAX_SIDE)} pixels a side and ${IMAGE_MAX_PIXELS / 1_000_000} megapixels. Make it smaller and add it again.`;
  if (width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE) {
    return `This image is ${count.format(width)} × ${count.format(height)} pixels. ${limits}`;
  }
  if (width * height > IMAGE_MAX_PIXELS) {
    return `This image has ${Math.round((width * height) / 1_000_000)} megapixels. ${limits}`;
  }
  return null;
}
