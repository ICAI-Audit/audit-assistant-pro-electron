// The page picture of a rebuilt page (design 5.9 "Output"): boxes in pixels, grown past ink along the
// text, burned black and checked, replacements fitted, and the picture encoded with exactly
// width x height samples.
import * as zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { openPdfjs, type PdfjsDocument } from '@/lib/pdf-tools/testRedactPdf';
import { pageTransform } from '../viewer/pageGeometry';
import {
  differingBlocks,
  encodePagePicture,
  fillBlack,
  growAlong,
  isBlack,
  isGrey,
  jpegFrame,
  markedBlocks,
  pasteInto,
  pixelDiffers,
  replacementSize,
  samplesOf,
  toPixelBox,
  toUserRect,
  type PagePixels,
} from './pageEncode';

vi.setConfig({ testTimeout: 60_000 });

const deflate = async (samples: Uint8Array) => new Uint8Array(zlib.deflateSync(samples));

function blank(width: number, height: number, rgb: [number, number, number] = [255, 255, 255]): PagePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function paint(px: PagePixels, left: number, top: number, right: number, bottom: number, rgb: [number, number, number] = [0, 0, 0]) {
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * px.width + x) * 4;
      px.data[i] = rgb[0];
      px.data[i + 1] = rgb[1];
      px.data[i + 2] = rgb[2];
    }
  }
}

/** Glyph-like ink: every column has some, no row has an unbroken run (so it is not a rule). */
function glyphs(px: PagePixels, left: number, top: number, right: number, bottom: number, rgb: [number, number, number] = [0, 0, 0]) {
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if ((x + y) % 3 === 0) paint(px, x, y, x + 1, y + 1, rgb);
}

const pixel = (px: PagePixels, x: number, y: number) => Array.from(px.data.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 4));

let pdf: PdfjsDocument;
beforeAll(async () => {
  // pdf.js in Node brings a canvas (for JPEG encoding in these tests); warm it up once.
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  pdf = await openPdfjs(await doc.save());
}, 60_000);

function jpegCodec() {
  return async (px: PagePixels) => {
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { encode(f: 'jpeg', q: number): Promise<Uint8Array> }; context: CanvasRenderingContext2D } } }).canvasFactory;
    const { canvas, context } = factory.create(px.width, px.height);
    const image = context.createImageData(px.width, px.height);
    image.data.set(px.data);
    context.putImageData(image, 0, 0);
    return new Uint8Array(await canvas.encode('jpeg', 85));
  };
}

describe('user space and pixels', () => {
  const geometry = { view: [36, 36, 400, 700] as const, rotate: 0 as const };
  const m = pageTransform(geometry, 200 / 72);

  it('maps a user-space box outward to whole pixels, and back to a box that contains it', () => {
    const rect = { x0: 100.2, y0: 500.3, x1: 160.7, y1: 512.9 };
    const box = toPixelBox(m, rect, 2000, 2000)!;
    const s = 200 / 72;
    expect(box.left).toBe(Math.floor((100.2 - 36) * s));
    expect(box.right).toBe(Math.ceil((160.7 - 36) * s));
    expect(box.top).toBe(Math.floor((700 - 512.9) * s));
    expect(box.bottom).toBe(Math.ceil((700 - 500.3) * s));
    const back = toUserRect(m, box);
    expect(back.x0).toBeLessThanOrEqual(rect.x0);
    expect(back.y0).toBeLessThanOrEqual(rect.y0);
    expect(back.x1).toBeGreaterThanOrEqual(rect.x1);
    expect(back.y1).toBeGreaterThanOrEqual(rect.y1);
  });

  it('clips to the drawing and gives null for a box wholly off it', () => {
    expect(toPixelBox(m, { x0: -500, y0: -500, x1: -400, y1: -400 }, 1000, 1800)).toBeNull();
    const clipped = toPixelBox(m, { x0: 0, y0: 690, x1: 50, y1: 800 }, 1000, 1800)!;
    expect(clipped.left).toBe(0);
    expect(clipped.top).toBe(0);
  });
});

describe('a box edge never cuts ink', () => {
  it('grows past a glyph the box cut, and not into the lines above and below', () => {
    const px = blank(200, 60);
    glyphs(px, 20, 22, 96, 38); // the value; its last glyph runs 6 px past the box
    glyphs(px, 20, 5, 180, 19); // the line above, reaching into the box's top padding
    glyphs(px, 20, 41, 180, 55); // the line below
    const box = { left: 18, top: 18, right: 90, bottom: 42 };
    const grown = growAlong(px, box, 0, 20, 4);
    // Over the line above and below, nothing moved: only the ends along the text grow.
    expect(grown.hitLimit).toBe(false);
    expect(grown.box.right).toBeGreaterThanOrEqual(96);
    expect([grown.box.top, grown.box.bottom, grown.box.left]).toEqual([18, 42, 18]);
  });

  it('does not follow an underline along the line (a rule, not a glyph)', () => {
    const px = blank(300, 40);
    glyphs(px, 10, 10, 80, 26);
    paint(px, 10, 26, 290, 28); // an underline under the whole line
    const grown = growAlong(px, { left: 8, top: 8, right: 82, bottom: 30 }, 0, 15, 0);
    expect(grown.hitLimit).toBe(false);
    expect(grown.box.right).toBeLessThan(100);
  });

  it('says when glyph ink runs on past the limit (text set with no gap), so the caller widens the box', () => {
    const px = blank(300, 40);
    // Strokes in every column, broken in every row: glyphs, not a rule.
    glyphs(px, 10, 10, 290, 26);
    const grown = growAlong(px, { left: 8, top: 8, right: 82, bottom: 30 }, 0, 15, 0);
    expect(grown.hitLimit).toBe(true);
  });

  it('grows along y for upward text, staying within its columns', () => {
    const px = blank(60, 200);
    glyphs(px, 22, 20, 38, 104); // the value, its last glyph 4 px past the box
    glyphs(px, 5, 20, 18, 180); // the next column of text
    const grown = growAlong(px, { left: 18, top: 18, right: 42, bottom: 100 }, 90, 20, 0);
    expect(grown.box.bottom).toBeGreaterThanOrEqual(104);
    expect(grown.box.left).toBe(18);
    expect(grown.hitLimit).toBe(false);
  });

  it('takes a shaded cell as the paper, so faint text on it still counts as ink', () => {
    const px = blank(120, 40, [230, 230, 230]);
    glyphs(px, 20, 10, 60, 30, [200, 200, 200]);
    const grown = growAlong(px, { left: 18, top: 8, right: 50, bottom: 32 }, 0, 20, 0);
    expect(grown.box.right).toBeGreaterThanOrEqual(60);
  });
});

describe('burning', () => {
  it('fills a box black and the check sees it; a pixel left unburned fails the check', () => {
    const px = blank(50, 50);
    paint(px, 10, 10, 30, 30, [12, 40, 200]);
    const box = { left: 8, top: 8, right: 32, bottom: 32 };
    fillBlack(px, box);
    expect(isBlack(px, box)).toBe(true);
    expect(pixel(px, 7, 7)).toEqual([255, 255, 255, 255]);
    px.data[(20 * 50 + 20) * 4] = 1;
    expect(isBlack(px, box)).toBe(false);
  });

  it('pastes a replacement inside its box only, as grey levels', () => {
    const px = blank(40, 20);
    const box = { left: 5, top: 5, right: 15, bottom: 10 };
    fillBlack(px, box);
    const text = new Uint8ClampedArray(10 * 5 * 4);
    for (let i = 0; i < text.length; i += 4) {
      text[i] = i % 8 === 0 ? 255 : 0;
      text[i + 1] = 0;
      text[i + 2] = 0;
      text[i + 3] = 255;
    }
    pasteInto(px, box, text);
    expect(pixel(px, 5, 5)).toEqual([255, 255, 255, 255]);
    expect(pixel(px, 4, 5)).toEqual([255, 255, 255, 255]);
    expect(pixel(px, 6, 5)).toEqual([0, 0, 0, 255]);
    expect(() => pasteInto(px, box, new Uint8ClampedArray(12))).toThrow();
  });
});

describe('replacement fit (design 5.9)', () => {
  const pxPerPt = 200 / 72;
  it('is the largest size up to 70% of the box height that fits its length', () => {
    // "[REDACTED]" is about 6.1 em wide in a bold sans-serif.
    const thick = 14.5 * pxPerPt;
    const size = replacementSize(6.1, 80 * pxPerPt, thick, pxPerPt)!;
    expect(size).toBeCloseTo(0.7 * thick, 6);
    const narrow = replacementSize(6.1, 40 * pxPerPt, thick, pxPerPt)!;
    expect(narrow).toBeCloseTo((40 - 2) * pxPerPt / 6.1, 6);
  });
  it('does not draw below 4 pt: the box stays plain black', () => {
    expect(replacementSize(6.1, 20 * pxPerPt, 14 * pxPerPt, pxPerPt)).toBeNull();
    expect(replacementSize(6.1, 200 * pxPerPt, 5 * pxPerPt, pxPerPt)).toBeNull();
  });
});

describe('encodePagePicture', () => {
  it('a page without colour is stored grey: inflated, exactly width x height bytes, equal to the pixels', async () => {
    const px = blank(37, 23);
    paint(px, 3, 3, 20, 9, [40, 40, 40]);
    expect(isGrey(px)).toBe(true);
    const picture = await encodePagePicture(px, { deflate, jpeg: jpegCodec() });
    expect(picture.encoding).toBe('flate-gray');
    expect([picture.widthPx, picture.heightPx]).toEqual([37, 23]);
    const inflated = new Uint8Array(zlib.inflateSync(picture.bytes));
    expect(inflated.length).toBe(37 * 23);
    expect(Array.from(inflated)).toEqual(Array.from(samplesOf(px, true)));
  });

  it('a coloured page without a JPEG encoder is RGB: exactly width x height x 3 bytes', async () => {
    const px = blank(31, 17);
    paint(px, 2, 2, 10, 10, [200, 20, 20]);
    const picture = await encodePagePicture(px, { deflate });
    expect(picture.encoding).toBe('flate-rgb');
    expect(zlib.inflateSync(picture.bytes).length).toBe(31 * 17 * 3);
  });

  it('a photo-like page (colour gradients with grain) is kept as JPEG, whose frame states the drawing size', async () => {
    const px = blank(240, 160);
    let seed = 7;
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 240; x++) {
        const i = (y * 240 + x) * 4;
        seed = (seed * 1103515245 + 12345) >>> 0;
        const grain = (seed >>> 28) - 8;
        px.data[i] = x + grain;
        px.data[i + 1] = y + 40 + grain;
        px.data[i + 2] = (x + y) / 2 + grain;
      }
    }
    const picture = await encodePagePicture(px, { deflate, jpeg: jpegCodec() });
    expect(picture.encoding).toBe('jpeg');
    expect(jpegFrame(picture.bytes)).toMatchObject({ width: 240, height: 160 });
  });

  it('a page of text (small lossless picture) is not tried as JPEG at all', async () => {
    const px = blank(400, 300);
    paint(px, 20, 20, 200, 30);
    let tried = false;
    const picture = await encodePagePicture(px, {
      deflate,
      jpeg: async () => {
        tried = true;
        return new Uint8Array(0);
      },
    });
    expect(picture.encoding).toBe('flate-gray');
    expect(tried).toBe(false);
  });

  it('a JPEG of another size is never used', async () => {
    const px = blank(64, 64);
    for (let i = 0; i < px.data.length; i += 4) px.data[i] = (i * 7) % 256;
    const other = await jpegCodec()(blank(32, 32));
    const picture = await encodePagePicture(px, { deflate, jpeg: async () => other });
    expect(picture.encoding).toBe('flate-rgb');
  });

  it('refuses pixels that are not width x height x 4, and a deflate that is not zlib', async () => {
    await expect(encodePagePicture({ data: new Uint8ClampedArray(10), width: 3, height: 3 }, { deflate })).rejects.toThrow(/could not be drawn/);
    await expect(encodePagePicture(blank(4, 4), { deflate: async (s) => new Uint8Array(zlib.deflateRawSync(s)) })).rejects.toThrow(/could not be drawn/);
  });
});

describe('the comparison of the proof (wave 2b: the same blocks, without a call per pixel)', () => {
  it('finds exactly what markedBlocks with pixelDiffers finds, with and without a mask, aligned or not', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const [width, height, cell] of [[97, 61, 6], [200, 150, 17], [33, 300, 4], [1, 1, 4]] as const) {
      const n = width * height;
      const a = new Uint8ClampedArray(n * 4).map(() => 255);
      const b = new Uint8ClampedArray(a);
      // Sparse differences in one byte of a pixel (any of R, G, B, A), and a few solid runs.
      for (let k = 0; k < Math.ceil(n / 50); k++) b[Math.floor(random() * n) * 4 + Math.floor(random() * 4)] = Math.floor(random() * 255);
      for (let k = 0; k < 3; k++) {
        const y = Math.floor(random() * height);
        const x0 = Math.floor(random() * width);
        for (let x = x0; x < Math.min(width, x0 + 20); x++) b[(y * width + x) * 4] = 0;
      }
      const skip = new Uint8Array(n).map(() => (random() < 0.3 ? 1 : 0));
      expect(differingBlocks(a, b, width, height, cell)).toEqual(markedBlocks(width, height, cell, (p) => pixelDiffers(a, b, p)));
      expect(differingBlocks(a, b, width, height, cell, skip)).toEqual(markedBlocks(width, height, cell, (p) => skip[p] === 0 && pixelDiffers(a, b, p)));
      // Data that do not start on a four-byte boundary are compared byte by byte, to the same result.
      const shifted = (src: Uint8ClampedArray) => {
        const buffer = new ArrayBuffer(src.length + 1);
        const view = new Uint8ClampedArray(buffer, 1, src.length);
        view.set(src);
        return view;
      };
      expect(differingBlocks(shifted(a), shifted(b), width, height, cell, skip)).toEqual(markedBlocks(width, height, cell, (p) => skip[p] === 0 && pixelDiffers(a, b, p)));
    }
    expect(() => differingBlocks(new Uint8ClampedArray(8), new Uint8ClampedArray(8), 3, 3, 4)).toThrow(/could not be drawn/);
  });
});