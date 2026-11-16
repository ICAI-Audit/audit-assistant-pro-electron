import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addPageNumbers,
  defaultPageNumberOptions,
  fillTokens,
  formatDate,
  formatNumber,
  numberPlacement,
  pageNumberLabel,
  tokenError,
  type NumberPosition,
  type NumberStyle,
  type PageNumberExtras,
  type PageNumberRunOptions,
} from './pageNumbers';
import { emptyMarkReport } from './marks';
import { makePdf, pageTexts } from './testPdf';
import { changedPixels, makeRawPdf, makeSharedPagesPdf, makeStrayPdf, renderPage } from './testMarksPdf';

// The first pdfjs import is slow and the suite runs alongside others, so pay for it here, with room to spare.
vi.setConfig({ testTimeout: 20_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

const POSITIONS: NumberPosition[] = ['bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'];
const INVISIBLE = /[\p{C}\p{M}\p{Zl}\p{Zp}]/u;

// Where each numbered text item lands as the reader sees it: top-left origin viewport coordinates,
// plus whether the glyphs are upright (no rotation or skew in the combined transform).
async function readerView(bytes: Uint8Array, pageNumber: number, text: string) {
  const { getDocument, Util } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const item = content.items.find((i) => 'str' in i && i.str === text);
  if (!item || !('transform' in item)) throw new Error(`text "${text}" not found`);
  const t = Util.transform(viewport.transform, item.transform);
  const result = { x: t[4], y: t[5], upright: Math.abs(t[1]) < 1e-6 && Math.abs(t[2]) < 1e-6 && t[0] > 0 && t[3] < 0, width: item.width, w: viewport.width, h: viewport.height };
  await pdf.destroy();
  return result;
}

describe('pageNumberLabel', () => {
  const o = defaultPageNumberOptions(10);
  it('formats every style', () => {
    expect(pageNumberLabel({ ...o, format: 'n' }, 3, 10)).toBe('3');
    expect(pageNumberLabel({ ...o, format: 'page-n' }, 3, 10)).toBe('Page 3');
    expect(pageNumberLabel({ ...o, format: 'n-of-total' }, 3, 10)).toBe('3 of 10');
    expect(pageNumberLabel({ ...o, format: 'page-n-of-total' }, 3, 10)).toBe('Page 3 of 10');
    expect(pageNumberLabel({ ...o, format: 'custom', prefix: 'WP-A1 / ', suffix: '' }, 3, 10)).toBe('WP-A1 / 3');
    expect(pageNumberLabel({ ...o, format: 'custom', prefix: '[', suffix: ']' }, 3, 10)).toBe('[3]');
  });
});

describe('numberPlacement', () => {
  const o = defaultPageNumberOptions(10);
  const box = { x: 0, y: 0, width: 595, height: 842 };

  it('places unrotated numbers at the margin', () => {
    expect(numberPlacement(box, 0, 20, { ...o, position: 'bottom-center' })).toMatchObject({ x: 287.5, y: 28, rotate: 0 });
    expect(numberPlacement(box, 0, 20, { ...o, position: 'top-right' }).x).toBeCloseTo(595 - 28 - 20);
  });

  it('measures from the visible box, not the origin', () => {
    const crop = { x: 50, y: 100, width: 400, height: 600 };
    expect(numberPlacement(crop, 0, 20, { ...o, position: 'bottom-left' })).toMatchObject({ x: 78, y: 128 });
    const top = numberPlacement(crop, 0, 20, { ...o, position: 'top-left' });
    expect(top.y).toBeLessThan(100 + 600 - 28);
    expect(top.y).toBeGreaterThan(100 + 600 - 28 - 10);
  });

  it('keeps rotated placements inside the box and rotates the text with the page', () => {
    for (const rot of [90, 180, 270] as const) {
      for (const position of POSITIONS) {
        const q = numberPlacement(box, rot, 20, { ...o, position });
        expect(q.x).toBeGreaterThanOrEqual(0);
        expect(q.x).toBeLessThanOrEqual(595);
        expect(q.y).toBeGreaterThanOrEqual(0);
        expect(q.y).toBeLessThanOrEqual(842);
        expect(q.rotate).toBe(rot);
      }
    }
  });
});

describe('addPageNumbers', () => {
  it('numbers the chosen range, with total counting from the start number', async () => {
    const out = await addPageNumbers(await makePdf('A', 5), { ...defaultPageNumberOptions(5), format: 'page-n-of-total', fromPage: 2, toPage: 4, startNumber: 1 });
    const texts = await pageTexts(out);
    expect(texts[0]).toBe('A p1');
    expect(texts[1]).toContain('A p2');
    expect(texts[1]).toContain('Page 1 of 3');
    expect(texts[3]).toContain('Page 3 of 3');
    expect(texts[4]).toBe('A p5');
  });

  it('honours a start number other than 1', async () => {
    const out = await addPageNumbers(await makePdf('A', 4), { ...defaultPageNumberOptions(4), format: 'n-of-total', fromPage: 3, toPage: 4, startNumber: 10 });
    const texts = await pageTexts(out);
    expect(texts[0]).toBe('A p1');
    expect(texts[1]).toBe('A p2');
    expect(texts[2]).toContain('10 of 11');
    expect(texts[3]).toContain('11 of 11');
  });

  it('does not change the source bytes and keeps existing content', async () => {
    const src = await makePdf('Keep', 2);
    const copy = src.slice();
    const out = await addPageNumbers(src, defaultPageNumberOptions(2));
    expect(src).toEqual(copy);
    expect(await pageTexts(out)).toEqual(['Keep p11', 'Keep p22']);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('puts the number inside the cropped area, relative to the crop origin', async () => {
    const out = await addPageNumbers(await makePdf('C', 1, { size: [600, 800], cropBox: [100, 150, 300, 400] }), { ...defaultPageNumberOptions(1), position: 'bottom-left' });
    const v = await readerView(out, 1, '1');
    expect(v.w).toBeCloseTo(300);
    expect(v.h).toBeCloseTo(400);
    expect(v.x).toBeCloseTo(28);
    expect(v.y).toBeCloseTo(400 - 28);
    expect(v.upright).toBe(true);
  });

  it('handles a MediaBox whose origin is not (0,0)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.setMediaBox(-50, -80, 300, 400);
    const out = await addPageNumbers(await doc.save(), { ...defaultPageNumberOptions(1), position: 'top-right' });
    const v = await readerView(out, 1, '1');
    expect(v.x + v.width).toBeCloseTo(300 - 28);
    expect(v.y).toBeGreaterThan(28);
    expect(v.y).toBeLessThan(28 + 10);
    expect(v.upright).toBe(true);
  });

  for (const rotate of [90, 180, 270] as const) {
    for (const position of POSITIONS) {
      it(`reads upright at ${position} on a page rotated ${rotate}`, async () => {
        const out = await addPageNumbers(await makePdf('R', 1, { size: [300, 400], rotate }), { ...defaultPageNumberOptions(1), position });
        const v = await readerView(out, 1, '1');
        expect(v.upright).toBe(true);
        const [vert, horiz] = position.split('-');
        if (horiz === 'left') expect(v.x).toBeCloseTo(28);
        if (horiz === 'right') expect(v.x + v.width).toBeCloseTo(v.w - 28);
        if (horiz === 'center') expect(v.x + v.width / 2).toBeCloseTo(v.w / 2);
        if (vert === 'bottom') expect(v.y).toBeCloseTo(v.h - 28);
        if (vert === 'top') {
          expect(v.y).toBeGreaterThan(28);
          expect(v.y).toBeLessThan(28 + 10);
        }
      });
    }
  }

  it('applies rotation together with a crop box', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(100, 150, 300, 400);
    page.setRotation(degrees(90));
    const out = await addPageNumbers(await doc.save(), { ...defaultPageNumberOptions(1), position: 'bottom-right' });
    const v = await readerView(out, 1, '1');
    expect(v.w).toBeCloseTo(400);
    expect(v.h).toBeCloseTo(300);
    expect(v.x + v.width).toBeCloseTo(400 - 28);
    expect(v.y).toBeCloseTo(300 - 28);
    expect(v.upright).toBe(true);
  });

  it('rejects characters the built-in font cannot draw, naming them', async () => {
    const a = await makePdf('A', 2);
    const o = defaultPageNumberOptions(2);
    for (const prefix of ['पृष्ठ ', '😀 ', '₹ ']) {
      const err = await addPageNumbers(a, { ...o, format: 'custom', prefix }).catch((e) => e);
      expect(err).toMatchObject({ name: 'PdfToolsError', code: 'unsupported-characters' });
      expect(err.message).toContain([...prefix.trim()][0]);
    }
    await expect(addPageNumbers(a, { ...o, format: 'custom', suffix: ' ₹' })).rejects.toMatchObject({ code: 'unsupported-characters' });
    // Supported accented Latin text is fine.
    await expect(addPageNumbers(a, { ...o, format: 'custom', prefix: 'Pagé ' })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('ignores prefix and suffix when the format is not custom', async () => {
    const a = await makePdf('A', 1);
    await expect(addPageNumbers(a, { ...defaultPageNumberOptions(1), format: 'n', prefix: 'पृष्ठ' })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('rejects invalid options', async () => {
    const a = await makePdf('A', 5);
    const o = defaultPageNumberOptions(5);
    for (const bad of [
      { fromPage: 4, toPage: 2 },
      { fromPage: 0 },
      { toPage: 6 },
      { fromPage: 1.5 },
      { fontSize: 80 },
      { fontSize: 5 },
      { marginPt: 4 },
      { marginPt: 200 },
      { startNumber: -1 },
      { startNumber: 1.5 },
      { color: { r: 2, g: 0, b: 0 } },
    ]) {
      await expect(addPageNumbers(a, { ...o, ...bad })).rejects.toMatchObject({ code: 'invalid-number-options' });
    }
  });

  it('rejects bytes that are not a PDF', async () => {
    await expect(addPageNumbers(new Uint8Array([1, 2, 3]), defaultPageNumberOptions(1))).rejects.toMatchObject({ code: 'not-a-pdf' });
  });
});

describe('addPageNumbers: shared resources', () => {
  async function sharedResourcesPdf(mode: 'indirect' | 'inherited'): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const resources = doc.context.obj({ Font: doc.context.obj({ F0: font.ref }) });
    const resRef: PDFRef = doc.context.register(resources);
    for (let i = 0; i < 20; i++) {
      const page = doc.addPage([300, 400]);
      if (mode === 'indirect') page.node.set(PDFName.of('Resources'), resRef);
      else page.node.delete(PDFName.of('Resources'));
    }
    if (mode === 'inherited') doc.catalog.Pages().set(PDFName.of('Resources'), resRef);
    return doc.save();
  }

  for (const mode of ['indirect', 'inherited'] as const) {
    it(`gives each page its own font dictionary when pages share ${mode} resources`, async () => {
      const out = await addPageNumbers(await sharedResourcesPdf(mode), defaultPageNumberOptions(20));
      const reloaded = await PDFDocument.load(out);
      for (const page of reloaded.getPages()) {
        const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
        expect(fonts).toBeDefined();
        // The original font plus the one pdf-lib adds; a shared dictionary would hold one key per page.
        expect(fonts!.keys().length).toBeLessThanOrEqual(2);
      }
      const texts = await pageTexts(out);
      expect(texts[0]).toBe('1');
      expect(texts[19]).toBe('20');
    });
  }
});

describe('addPageNumbers: visible area', () => {
  async function boxed(media: number[], crop: number[] | null): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.node.set(PDFName.of('MediaBox'), doc.context.obj(media));
    if (crop) page.node.set(PDFName.of('CropBox'), doc.context.obj(crop));
    return doc.save();
  }
  const cases: [string, number[], number[] | null, number, number][] = [
    ['reversed MediaBox', [0, 841.89, 595.28, 0], null, 595.28, 841.89],
    ['reversed CropBox', [0, 0, 600, 800], [400, 700, 100, 100], 300, 600],
    ['CropBox larger than MediaBox', [0, 0, 595, 842], [-50, -50, 650, 900], 595, 842],
    ['CropBox partly outside MediaBox', [0, 0, 595, 842], [300, 400, 895, 1242], 295, 442],
    ['MediaBox not at the origin', [100, 100, 695, 942], null, 595, 842],
  ];
  for (const [name, media, crop, w, h] of cases) {
    it(`keeps the number inside the visible area: ${name}`, async () => {
      const out = await addPageNumbers(await boxed(media, crop), { ...defaultPageNumberOptions(1), position: 'bottom-right' });
      const v = await readerView(out, 1, '1');
      expect(v.w).toBeCloseTo(w, 1);
      expect(v.h).toBeCloseTo(h, 1);
      expect(v.x + v.width).toBeCloseTo(w - 28, 1);
      expect(v.y).toBeCloseTo(h - 28, 1);
      expect(v.upright).toBe(true);
    });
  }

  it('falls back to the MediaBox when the CropBox does not overlap it', async () => {
    const out = await addPageNumbers(await boxed([0, 0, 300, 400], [1000, 1000, 1200, 1200]), { ...defaultPageNumberOptions(1), position: 'bottom-left' });
    const v = await readerView(out, 1, '1');
    expect(v.x).toBeCloseTo(28, 1);
    expect(v.y).toBeCloseTo(400 - 28, 1);
  });
});

describe('addPageNumbers: text width', () => {
  // drawText prints without kerning, so the width used for alignment must be the unkerned one.
  for (const position of ['bottom-right', 'bottom-center'] as const) {
    it(`aligns "Page 11" at 36 pt exactly, ${position}`, async () => {
      const o = { ...defaultPageNumberOptions(1), format: 'custom' as const, prefix: 'Page ', startNumber: 11, fontSize: 36, position };
      const v = await readerView(await addPageNumbers(await makePdf('K', 1, { size: [600, 800] }), o), 1, 'Page 11');
      if (position === 'bottom-right') expect(v.x + v.width).toBeCloseTo(600 - 28, 1);
      else expect(v.x + v.width / 2).toBeCloseTo(300, 1);
    });
  }

  it('does not run off the page with a kerned label at a tight margin', async () => {
    const o = { ...defaultPageNumberOptions(1), format: 'custom' as const, prefix: 'Ref. TY-', startNumber: 7, fontSize: 36, marginPt: 8, position: 'bottom-right' as const };
    const v = await readerView(await addPageNumbers(await makePdf('K', 1, { size: [600, 800] }), o), 1, 'Ref. TY-7');
    expect(v.x + v.width).toBeCloseTo(600 - 8, 1);
  });
});

describe('addPageNumbers: page shapes', () => {
  for (const position of POSITIONS) {
    it(`places ${position} on an unrotated landscape page`, async () => {
      const out = await addPageNumbers(await makePdf('L', 1, { size: [400, 300] }), { ...defaultPageNumberOptions(1), position });
      const v = await readerView(out, 1, '1');
      const [vert, horiz] = position.split('-');
      expect(v.upright).toBe(true);
      if (horiz === 'left') expect(v.x).toBeCloseTo(28);
      if (horiz === 'right') expect(v.x + v.width).toBeCloseTo(400 - 28);
      if (horiz === 'center') expect(v.x + v.width / 2).toBeCloseTo(200);
      if (vert === 'bottom') expect(v.y).toBeCloseTo(300 - 28);
      else expect(v.y).toBeCloseTo(28 + 10 * 0.718);
    });
  }

  it('numbers a mixed-size, mixed-rotation file correctly on every page', async () => {
    const doc = await PDFDocument.create();
    const sizes: [number, number, number][] = [[595.28, 841.89, 0], [841.89, 595.28, 0], [612, 792, 0], [300, 500, 90]];
    for (const [w, h, r] of sizes) {
      const page = doc.addPage([w, h]);
      if (r) page.setRotation(degrees(r));
    }
    const out = await addPageNumbers(await doc.save(), defaultPageNumberOptions(4));
    for (let i = 0; i < 4; i++) {
      const v = await readerView(out, i + 1, String(i + 1));
      expect(v.upright).toBe(true);
      expect(v.x + v.width / 2).toBeCloseTo(v.w / 2, 1);
      expect(v.y).toBeCloseTo(v.h - 28, 1);
    }
  });

  for (const angle of [45, 135]) {
    it(`treats /Rotate ${angle} as no rotation`, async () => {
      const doc = await PDFDocument.create();
      doc.addPage([300, 400]).node.set(PDFName.of('Rotate'), PDFNumber.of(angle)); // setRotation refuses non-multiples of 90
      const out = await addPageNumbers(await doc.save(), { ...defaultPageNumberOptions(1), position: 'bottom-left' });
      const v = await readerView(out, 1, '1');
      expect(v.w).toBeCloseTo(300);
      expect(v.x).toBeCloseTo(28);
      expect(v.y).toBeCloseTo(400 - 28);
      expect(v.upright).toBe(true);
    });
  }
});

describe('addPageNumbers: fit check', () => {
  const fitMessage = (n: number) => `The page number does not fit on page ${n}. Use shorter text, a smaller font size or a smaller margin.`;

  it('rejects a long prefix at 36 pt on A4', async () => {
    const a = await makePdf('A', 1, { size: [595, 842] });
    await expect(addPageNumbers(a, { ...defaultPageNumberOptions(1), format: 'custom', prefix: 'W'.repeat(30), fontSize: 36 }))
      .rejects.toMatchObject({ code: 'invalid-number-options', message: fitMessage(1) });
  });

  it('rejects a 400-character prefix', async () => {
    await expect(addPageNumbers(await makePdf('A', 1), { ...defaultPageNumberOptions(1), format: 'custom', prefix: 'x'.repeat(400) }))
      .rejects.toMatchObject({ code: 'invalid-number-options', message: fitMessage(1) });
  });

  it('rejects a 40-character prefix on a narrow receipt page', async () => {
    const a = await makePdf('A', 1, { size: [226.8, 600] });
    await expect(addPageNumbers(a, { ...defaultPageNumberOptions(1), format: 'custom', prefix: 'W'.repeat(40) }))
      .rejects.toMatchObject({ code: 'invalid-number-options', message: fitMessage(1) });
  });

  it('rejects a margin that leaves no room on a 144 x 144 page', async () => {
    const a = await makePdf('A', 1, { size: [144, 144] });
    await expect(addPageNumbers(a, { ...defaultPageNumberOptions(1), marginPt: 144 }))
      .rejects.toMatchObject({ code: 'invalid-number-options', message: fitMessage(1) });
  });

  it('swaps width and height for sideways pages when checking fit', async () => {
    const opts = { ...defaultPageNumberOptions(1), format: 'page-n-of-total' as const, fontSize: 36 };
    const run = (size: [number, number], rotate: 0 | 90) => makePdf('A', 1, { size, rotate }).then((bytes) => addPageNumbers(bytes, opts));
    // "Page 1 of 1" at 36 pt is about 175 pt wide: it only fits where the reader sees 600 pt across.
    await expect(run([600, 100], 90)).rejects.toMatchObject({ message: fitMessage(1) });
    await expect(run([100, 600], 90)).resolves.toBeInstanceOf(Uint8Array);
    await expect(run([600, 100], 0)).resolves.toBeInstanceOf(Uint8Array);
    await expect(run([100, 600], 0)).rejects.toMatchObject({ message: fitMessage(1) });
  });

  it('accepts a number that fits with one margin, on an 80 mm receipt', async () => {
    const label = 'WP-A1 / Bank reconciliation FY 2025-26 / 12';
    const o = { ...defaultPageNumberOptions(1), format: 'custom' as const, prefix: 'WP-A1 / Bank reconciliation FY 2025-26 / ', startNumber: 12 };
    for (const position of ['bottom-right', 'bottom-center'] as const) {
      const out = await addPageNumbers(await makePdf('R', 1, { size: [226.77, 400] }), { ...o, position });
      const v = await readerView(out, 1, label);
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x + v.width).toBeLessThanOrEqual(226.77 + 0.01);
      // Pinned: right edge at width - margin, centre at half the width.
      if (position === 'bottom-right') expect(v.x + v.width).toBeCloseTo(198.77, 2);
      else expect(v.x + v.width / 2).toBeCloseTo(113.39, 2);
    }
  });

  it('accepts a 600 x 60 strip at defaults', async () => {
    const out = await addPageNumbers(await makePdf('S', 1, { size: [600, 60] }), defaultPageNumberOptions(1));
    const v = await readerView(out, 1, '1');
    expect(v.y).toBeCloseTo(32, 2); // baseline 28 pt above the bottom edge of a 60 pt page
  });

  it('names the first offending page', async () => {
    // Page 1 is outside the range; pages 3 and 4 would also be fine or too small, but page 2 comes first.
    const doc = await PDFDocument.create();
    for (const w of [300, 60, 50, 300]) doc.addPage([w, 400]);
    await expect(addPageNumbers(await doc.save(), { ...defaultPageNumberOptions(4), fromPage: 2, toPage: 4, position: 'bottom-right', format: 'custom', prefix: 'Section ' }))
      .rejects.toMatchObject({ code: 'invalid-number-options', message: fitMessage(2) });
  });

  it('ignores pages outside the numbered range', async () => {
    const doc = await PDFDocument.create();
    for (const w of [60, 300]) doc.addPage([w, 400]);
    await expect(addPageNumbers(await doc.save(), { ...defaultPageNumberOptions(2), fromPage: 2, toPage: 2, position: 'bottom-right', format: 'custom', prefix: 'Section ' }))
      .resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('addPageNumbers: unsupported-character message', () => {
  const messageFor = async (prefix: string) => {
    const err = await addPageNumbers(await makePdf('A', 1), { ...defaultPageNumberOptions(1), format: 'custom', prefix }).catch((e) => e);
    expect(err).toMatchObject({ code: 'unsupported-characters' });
    return err.message as string;
  };

  it('shows control and format characters as code points, and a combining mark inside the word it belongs to', async () => {
    const msg = await messageFor('a\n\u200db\u0301');
    expect(msg).toContain('U+000A');
    expect(msg).toContain('U+200D');
    // The word as typed (QA-FIX H): the mark is shown on its letter, not as a code point.
    expect(msg).toContain('\u201cb\u0301\u201d');
    expect(msg).not.toMatch(/[\p{C}\p{Zl}\p{Zp}]/u);
  });

  it('shows lone surrogates and line separators as code points', async () => {
    const msg = await messageFor('a\uD800b\u2028');
    expect(msg).toContain('U+D800');
    expect(msg).toContain('U+2028');
    expect(msg).not.toMatch(INVISIBLE);
  });

  it('shows the word as typed, once, never a broken character pair', async () => {
    const msg = await messageFor('😀😀₹₹ 😀😀₹₹');
    expect(msg.split('“😀😀₹₹”').length - 1).toBe(1);
    expect(msg).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe('addPageNumbers: inherited page attributes', () => {
  it('honours a MediaBox and Rotate inherited from the /Pages parent', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.node.delete(PDFName.of('MediaBox'));
    page.node.delete(PDFName.of('Rotate'));
    const parent = doc.catalog.Pages();
    parent.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, 300, 400]));
    parent.set(PDFName.of('Rotate'), PDFNumber.of(90));
    const out = await addPageNumbers(await doc.save(), { ...defaultPageNumberOptions(1), position: 'bottom-right' });
    const v = await readerView(out, 1, '1');
    // A 300 x 400 page turned 90 degrees is read as 400 wide and 300 high.
    expect(v.w).toBeCloseTo(400);
    expect(v.h).toBeCloseTo(300);
    expect(v.x + v.width).toBeCloseTo(400 - 28, 1);
    expect(v.y).toBeCloseTo(300 - 28, 1);
    expect(v.upright).toBe(true);
  });
});

describe('addPageNumbers: guarantees', () => {
  it('leaves the source bytes unchanged after a fit rejection', async () => {
    const src = await makePdf('A', 2, { size: [100, 100] });
    const copy = src.slice();
    await expect(addPageNumbers(src, { ...defaultPageNumberOptions(2), format: 'custom', prefix: 'x'.repeat(100) }))
      .rejects.toMatchObject({ code: 'invalid-number-options' });
    expect(src).toEqual(copy);
  });

  it('embeds the font once however many pages are numbered', async () => {
    const helvetica = async (bytes: Uint8Array) => {
      const doc = await PDFDocument.load(bytes);
      return doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('BaseFont')) === PDFName.of('Helvetica')).length;
    };
    const src = await makePdf('A', 6);
    const before = await helvetica(src);
    expect((await helvetica(await addPageNumbers(src, { ...defaultPageNumberOptions(6), fromPage: 1, toPage: 1 }))) - before).toBe(1);
    expect((await helvetica(await addPageNumbers(src, defaultPageNumberOptions(6)))) - before).toBe(1);
  });

  for (const rotate of [180, 270] as const) {
    it(`keeps the number inside the CropBox at the visual bottom on a page rotated ${rotate}`, async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 800]);
      page.setCropBox(100, 150, 300, 400);
      page.setRotation(degrees(rotate));
      const out = await addPageNumbers(await doc.save(), { ...defaultPageNumberOptions(1), position: 'bottom-left' });
      const v = await readerView(out, 1, '1');
      const [w, h] = rotate === 180 ? [300, 400] : [400, 300];
      expect(v.w).toBeCloseTo(w);
      expect(v.h).toBeCloseTo(h);
      expect(v.x).toBeCloseTo(28, 1);
      expect(v.y).toBeCloseTo(h - 28, 1);
      expect(v.upright).toBe(true);
    });
  }
});

describe('addPageNumbers: pages whose content leaves a stray state (phase 1 defect)', () => {
  for (const kind of ['unclosed-q', 'flip', 'scale'] as const) {
    it(`puts the number in the right place on a page with ${kind} content (text position and pixels)`, async () => {
      const src = await makeStrayPdf(kind);
      const out = await addPageNumbers(src, { ...defaultPageNumberOptions(1), position: 'bottom-left' });
      const v = await readerView(out, 1, '1');
      expect(Math.abs(v.x - 28)).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y - (792 - 28))).toBeLessThanOrEqual(1);
      expect(v.upright).toBe(true);
      const c = await changedPixels(src, out, 1, 2);
      expect(Math.abs(c.bbox![0] / 2 - 28)).toBeLessThanOrEqual(2);
      expect(Math.abs((c.bbox![3] + 1) / 2 - (792 - 28))).toBeLessThanOrEqual(1);
    });
  }

  it('flags a page with more Q than q, which wrapping cannot repair, and still numbers it', async () => {
    const report = emptyMarkReport();
    const out = await addPageNumbers(await makeStrayPdf('extra-q'), { ...defaultPageNumberOptions(1), position: 'bottom-left' }, { report });
    expect(report.damaged).toEqual([1]);
    expect((await pageTexts(out))[0]).toContain('1');
  });
});

describe('formatNumber', () => {
  it('writes every style, and digits where a style cannot say the number', () => {
    expect(formatNumber(7, 'arabic')).toBe('7');
    const roman = [1, 4, 9, 14, 40, 90, 400, 1994, 3999].map((n) => formatNumber(n, 'roman-lower'));
    expect(roman).toEqual(['i', 'iv', 'ix', 'xiv', 'xl', 'xc', 'cd', 'mcmxciv', 'mmmcmxcix']);
    expect(formatNumber(4000, 'roman-lower')).toBe('4000');
    expect(formatNumber(0, 'roman-upper')).toBe('0');
    expect(formatNumber(2026, 'roman-upper')).toBe('MMXXVI');
    expect([1, 26, 27, 30].map((n) => formatNumber(n, 'alpha'))).toEqual(['a', 'z', '27', '30']);
    expect(formatNumber(12, 'circled')).toBe('12');
  });
  it('round-trips every roman numeral from 1 to 3999', () => {
    const value: Record<string, number> = { m: 1000, d: 500, c: 100, l: 50, x: 10, v: 5, i: 1 };
    for (let n = 1; n <= 3999; n++) {
      const r = formatNumber(n, 'roman-lower');
      expect(r).toMatch(/^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/);
      let sum = 0;
      for (let i = 0; i < r.length; i++) sum += value[r[i]] < (value[r[i + 1]] ?? 0) ? -value[r[i]] : value[r[i]];
      expect(sum).toBe(n);
    }
  });
});

describe('page number labels in the new formats and styles', () => {
  const o = defaultPageNumberOptions(10);
  it('writes 1., Pg-1, and styled numbers in every format', () => {
    expect(pageNumberLabel({ ...o, format: 'n-dot' }, 3, 10)).toBe('3.');
    expect(pageNumberLabel({ ...o, format: 'pg-n' }, 3, 10)).toBe('Pg-3');
    expect(pageNumberLabel({ ...o, format: 'page-n', style: 'roman-lower' }, 4, 10)).toBe('Page iv');
    expect(pageNumberLabel({ ...o, format: 'n-of-total', style: 'alpha' }, 2, 10)).toBe('b of j');
    expect(pageNumberLabel({ ...o, format: 'custom', prefix: '[', suffix: ']', style: 'roman-upper' }, 9, 10)).toBe('[IX]');
    expect(pageNumberLabel({ ...o, format: 'n', style: 'circled' }, 12, 20)).toBe('12');
  });
});

describe('tokens and dates', () => {
  const values = { page: '3', pages: '10', file: 'WP-A1.pdf', name: 'WP-A1', date: '14-11-2026', client: 'ABC Ltd', fy: '2025-26' };
  it('fills every token and leaves unknown ones as typed', () => {
    expect(fillTokens('{client} / {name} / {file} / {date} / {fy} / Page {page} of {pages}', values)).toBe('ABC Ltd / WP-A1 / WP-A1.pdf / 14-11-2026 / 2025-26 / Page 3 of 10');
    expect(fillTokens('{pge} {PAGE} {page', values)).toBe('{pge} 3 {page');
    expect(fillTokens('{page}', { ...values, page: '{pages}' })).toBe('{pages}'); // what was put in is not read again
    expect(fillTokens('{file}', { ...values, file: '$&.pdf' })).toBe('$&.pdf');
  });
  it('names an unknown token', () => {
    expect(tokenError('{pge}')).toContain('{pge}');
    expect(tokenError('Page {page} of {pages} - {clientt}')).toContain('{clientt}');
    expect(tokenError('{Client} {PAGE} {Fy}')).toBeNull(); // letter case does not matter
    expect(tokenError('{client} {fy} {name} {file} {date} {page} {pages}')).toBeNull();
    expect(tokenError('no tokens, a lone { brace')).toBeNull();
  });
  it('formats the date four ways', () => {
    const d = new Date(2026, 10, 14);
    expect(formatDate(d, 'dd-mm-yyyy')).toBe('14-11-2026');
    expect(formatDate(d, 'dd/mm/yyyy')).toBe('14/11/2026');
    expect(formatDate(d, 'yyyy-mm-dd')).toBe('2026-11-14');
    expect(formatDate(d, 'long')).toBe('14 November 2026');
    expect(formatDate(new Date(2026, 0, 5), 'dd-mm-yyyy')).toBe('05-01-2026');
  });
});

describe('addPageNumbers: header and footer text', () => {
  const tokens = { file: 'WP-A1.pdf', client: 'ABC Ltd', fy: '2025-26', today: new Date(2026, 10, 14) };
  const withTexts = (texts: PageNumberExtras['texts'], more: Partial<PageNumberRunOptions> = {}): PageNumberRunOptions => ({ ...defaultPageNumberOptions(3), texts, tokens, ...more });

  it('refuses text in the place of the page number, and accepts it with {page}', async () => {
    const a = await makePdf('A', 3);
    await expect(addPageNumbers(a, withTexts({ 'bottom-center': 'Audit' }))).rejects.toMatchObject({
      code: 'invalid-number-options',
      message: 'The page number is already at the bottom centre. Choose another place for this text, or write {page} in the text.',
    });
    const out = await addPageNumbers(a, withTexts({ 'bottom-center': 'Folio {page} of {pages}' }));
    expect((await pageTexts(out))[0]).toContain('Folio 1 of 3');
    // With the numbers off the place is free.
    await expect(addPageNumbers(a, withTexts({ 'bottom-center': 'Audit' }, { numbersOn: false }))).resolves.toBeInstanceOf(Uint8Array);
  });

  it('fills the tokens from the options, page by page, and never from anywhere else', async () => {
    const out = await addPageNumbers(await makePdf('A', 3), withTexts({ 'top-left': '{client} {name} {date} {fy}', 'bottom-left': '{file}' }, { dateFormat: 'long' }));
    const texts = await pageTexts(out);
    expect(texts[2]).toContain('ABC Ltd WP-A1 14 November 2026 2025-26');
    expect(texts[2]).toContain('WP-A1.pdf');
    const noTokens = await addPageNumbers(await makePdf('A', 1), { ...defaultPageNumberOptions(1), texts: { 'top-left': '[{client}]' } });
    expect((await pageTexts(noTokens))[0]).toContain('[]');
  });

  it('refuses an unknown token, naming it', async () => {
    await expect(addPageNumbers(await makePdf('A', 1), withTexts({ 'top-left': 'Page {pge}' }, { toPage: 1 }))).rejects.toMatchObject({ code: 'invalid-number-options', message: expect.stringContaining('{pge}') });
  });

  it('refuses characters the font cannot draw in the text or in what a token brings, naming them', async () => {
    const a = await makePdf('A', 1);
    for (const text of ['₹ 5,000', 'पृष्ठ', '😀']) {
      const err = await addPageNumbers(a, withTexts({ 'top-left': text }, { toPage: 1 })).catch((e) => e);
      expect(err).toMatchObject({ code: 'unsupported-characters' });
      expect(err.message).toContain([...text][0]);
    }
    const err = await addPageNumbers(a, withTexts({ 'top-left': '{file}' }, { toPage: 1, tokens: { ...tokens, file: 'पृ.pdf' } })).catch((e) => e);
    expect(err).toMatchObject({ code: 'unsupported-characters' });
    expect(err.message).toContain('प');
  });

  it('checks the length of each line', async () => {
    const a = await makePdf('A', 1);
    await expect(addPageNumbers(a, withTexts({ 'top-left': '' }, { numbersOn: false, toPage: 1 }))).rejects.toMatchObject({ code: 'invalid-number-options' });
    await expect(addPageNumbers(a, withTexts({ 'top-left': 'x'.repeat(121) }, { toPage: 1 }))).rejects.toMatchObject({ code: 'invalid-number-options' });
    await expect(addPageNumbers(a, withTexts({ 'top-left': 'W'.repeat(60) }, { toPage: 1 }))).rejects.toMatchObject({ code: 'invalid-number-options', message: expect.stringContaining('page 1') });
  });

  it('refuses two texts on one row that would run into each other', async () => {
    await expect(addPageNumbers(await makePdf('A', 1, { size: [300, 400] }), withTexts({ 'top-left': 'Confidential audit file', 'top-right': 'Prepared for the client' }, { toPage: 1, fontSize: 14 })))
      .rejects.toMatchObject({ code: 'invalid-number-options', message: expect.stringContaining('page 1') });
  });

  for (const rotate of [0, 90, 180, 270] as const) {
    it(`places header and footer in their corners as the reader sees them on a page turned ${rotate}`, async () => {
      const out = await addPageNumbers(await makePdf('R', 1, { size: [300, 400], rotate }), withTexts({ 'top-left': 'HEAD', 'top-right': 'RIGHT', 'bottom-left': 'FOOT' }, { toPage: 1 }));
      const head = await readerView(out, 1, 'HEAD');
      const right = await readerView(out, 1, 'RIGHT');
      const foot = await readerView(out, 1, 'FOOT');
      for (const v of [head, right, foot]) expect(v.upright).toBe(true);
      expect(head.x).toBeCloseTo(28);
      expect(head.y).toBeGreaterThan(28);
      expect(head.y).toBeLessThan(38);
      expect(right.x + right.width).toBeCloseTo(head.w - 28);
      expect(foot.x).toBeCloseTo(28);
      expect(foot.y).toBeCloseTo(head.h - 28);
    });
  }

  it('places header text inside a cropped, turned page', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(100, 150, 300, 400);
    page.setRotation(degrees(90));
    const out = await addPageNumbers(await doc.save(), withTexts({ 'top-right': 'HEAD' }, { toPage: 1 }));
    const v = await readerView(out, 1, 'HEAD');
    expect(v.w).toBeCloseTo(400);
    expect(v.x + v.width).toBeCloseTo(400 - 28);
    expect(v.y).toBeGreaterThan(28);
    expect(v.y).toBeLessThan(38);
  });

  it('uses the font, bold and italic chosen, embedding each face once', async () => {
    const out = await addPageNumbers(await makePdf('A', 6), withTexts({ 'top-left': 'Bold italic' }, { toPage: 6, font: 'times', bold: true, italic: true }));
    const doc = await PDFDocument.load(out);
    const faces = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('BaseFont')) === PDFName.of('Times-BoldItalic'));
    expect(faces).toHaveLength(1);
  });

  it('keeps the page number where the options put it while header and footer are added', async () => {
    const out = await addPageNumbers(await makePdf('A', 2), withTexts({ 'top-center': 'TOP' }, { toPage: 2 }));
    expect(await readerView(out, 1, '1')).toMatchObject({ upright: true });
    expect(await readerView(out, 1, 'TOP')).toMatchObject({ upright: true });
  });
});

describe('addPageNumbers: numbers in circles', () => {
  async function blank(rotate: 0 | 90 | 180 | 270, crop: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    if (crop) page.setCropBox(20, 30, 250, 330);
    if (rotate) page.setRotation(degrees(rotate));
    return doc.save();
  }
  const circled = (over: Partial<PageNumberRunOptions>): PageNumberRunOptions => ({ ...defaultPageNumberOptions(1), style: 'circled' as NumberStyle, ...over });

  async function contentOf(bytes: Uint8Array): Promise<string> {
    const doc = await PDFDocument.load(bytes);
    const parts = (doc.getPage(0).node.Contents() as PDFArray).asArray().map((r) => decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode());
    return parts.map((b) => new TextDecoder('latin1').decode(b)).join('\n');
  }

  it("draws a circle of radius 0.75 x the larger of the number's width and height, plus 3 pt", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    for (const [start, size] of [[1, 10], [123, 24], [7, 36]] as const) {
      const out = await addPageNumbers(await blank(0, false), circled({ startNumber: start, fontSize: size }));
      const stream = await contentOf(out);
      const w = [...String(start)].reduce((a, ch) => a + font.widthOfTextAtSize(ch, size), 0);
      const r = 0.75 * Math.max(w, size * 0.718) + 3;
      const lines = stream.split('\n');
      const at = lines.findIndex((l) => l.endsWith(' m'));
      const startPt = lines[at].split(' ').map(Number);
      const curves = lines.slice(at + 1, at + 5).map((l) => l.split(' ').map(Number));
      expect(curves.every((c) => c.length === 7)).toBe(true);
      const leftmost = curves[1].slice(4, 6); // end of the second curve
      const bottom = curves[2].slice(4, 6);
      const top = curves[0].slice(4, 6);
      expect((startPt[0] - leftmost[0]) / 2).toBeCloseTo(r, 2);
      expect((top[1] - bottom[1]) / 2).toBeCloseTo(r, 2);
      expect(lines[at + 5]).toBe('S');
      expect(stream).toContain('1 w');
    }
  });

  for (const [rotate, crop] of [[0, false], [90, false], [180, false], [270, false], [0, true], [90, true]] as const) {
    for (const [start, size] of [[1, 10], [12, 24], [123, 24]] as const) {
      it(`centres the number in its circle: ${start} at ${size} pt, turned ${rotate}${crop ? ', cropped' : ''} (rendered at 4x)`, async () => {
        const out = await addPageNumbers(await blank(rotate, crop), circled({ startNumber: start, fontSize: size, position: 'bottom-right' }));
        const r = await renderPage(out, 1, 4);
        const dark: [number, number][] = [];
        for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) if (r.data[(y * r.width + x) * 4] < 140) dark.push([x, y]);
        expect(dark.length).toBeGreaterThan(50);
        const bbox = (pts: [number, number][]) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
        const [rx0, ry0, rx1, ry1] = bbox(dark);
        const cx = (rx0 + rx1 + 1) / 2;
        const cy = (ry0 + ry1 + 1) / 2;
        const radius = (rx1 - rx0 + 1) / 2;
        const inner = dark.filter(([x, y]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < radius - 6);
        expect(inner.length).toBeGreaterThan(10);
        const [dx0, dy0, dx1, dy1] = bbox(inner);
        expect(Math.abs((dx0 + dx1 + 1) / 2 - cx) / 4).toBeLessThanOrEqual(1.2);
        expect(Math.abs((dy0 + dy1 + 1) / 2 - cy) / 4).toBeLessThanOrEqual(0.5);
        // The ring's outer width is 2r plus the 1 pt line.
        const expected = 2 * (0.75 * Math.max([...String(start)].length * 0.556 * size, size * 0.718) + 3) + 1;
        expect(Math.abs((rx1 - rx0 + 1) / 4 - expected)).toBeLessThanOrEqual(0.6 + size * 0.04);
      });
    }
  }

  it('asks for the plain number format when the number is in a circle', async () => {
    await expect(addPageNumbers(await makePdf('A', 1), circled({ format: 'page-n' }))).rejects.toMatchObject({ code: 'invalid-number-options' });
  });

  it('refuses a circle that does not fit the page', async () => {
    await expect(addPageNumbers(await makePdf('A', 1, { size: [40, 40] }), circled({ fontSize: 36 }))).rejects.toMatchObject({ code: 'invalid-number-options' });
  });
});

describe('addPageNumbers: progress, and size', () => {
  it('reports each page and stops when the caller throws', async () => {
    const seen: number[] = [];
    await addPageNumbers(await makePdf('A', 3), defaultPageNumberOptions(3), { onPage: (done, total) => void seen.push(done * 10 + total) });
    expect(seen).toEqual([3, 13, 23, 33]);
    await expect(addPageNumbers(await makePdf('A', 3), defaultPageNumberOptions(3), { onPage: (done) => { if (done === 1) throw new Error('stop'); } })).rejects.toThrow('stop');
  });

  it('grows in line with the page count when pages share one resource dictionary (150, 300, 600 pages)', async () => {
    const added: number[] = [];
    for (const n of [150, 300, 600]) {
      const src = await makeSharedPagesPdf(n, 40);
      const out = await addPageNumbers(src, { ...defaultPageNumberOptions(n), texts: { 'top-left': 'Header {page}' } });
      added.push(out.length - src.length);
    }
    expect(added[2] / added[1]).toBeLessThan(2.3);
    expect(added[1] / added[0]).toBeLessThan(2.3);
    expect(added[1] / 300).toBeLessThan(1200);
    // 1,050 pages built and numbered: 23-26 s on a loaded machine, over the file's 20 s. The limit is a hang guard
    // only; what is checked is the size, which no load changes.
  }, 120_000);
});

describe('fix round 1', () => {
  it('F5: a path the page left unpainted is not stroked by the ring of a circled number', async () => {
    const src = await makeRawPdf({ content: 'BT /F1 12 Tf 100 600 Td (Body) Tj ET\n0 0 m 612 792 l 0 792 l' });
    const out = await addPageNumbers(src, { ...defaultPageNumberOptions(1), style: 'circled', position: 'bottom-right' });
    const c = await changedPixels(src, out, 1);
    expect(c.bbox![0]).toBeGreaterThan(500); // only the ring and its digit, in the bottom-right corner
    expect(c.bbox![1]).toBeGreaterThan(700);
  });

  it('F7: refuses a header and a footer that would print over each other, naming the page', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    doc.addPage([300, 60]);
    const opts: PageNumberRunOptions = { ...defaultPageNumberOptions(2), fontSize: 36, marginPt: 8, numbersOn: false, texts: { 'top-left': 'Head', 'bottom-left': 'Foot' } };
    await expect(addPageNumbers(await doc.save(), opts)).rejects.toMatchObject({ code: 'invalid-number-options', message: expect.stringMatching(/page 2/) });
    // The same texts fit a taller page, and a header alone fits the short one.
    const tall = await PDFDocument.create();
    tall.addPage([300, 400]);
    await expect(addPageNumbers(await tall.save(), { ...opts, toPage: 1 })).resolves.toBeInstanceOf(Uint8Array);
    const short = await PDFDocument.create();
    short.addPage([300, 60]);
    await expect(addPageNumbers(await short.save(), { ...opts, toPage: 1, texts: { 'top-left': 'Head' } })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('F7: a page number and a header at opposite edges of a short page are checked too', async () => {
    const short = await PDFDocument.create();
    short.addPage([300, 50]);
    await expect(addPageNumbers(await short.save(), { ...defaultPageNumberOptions(1), fontSize: 20, marginPt: 8, texts: { 'top-left': 'Head' } })).rejects.toMatchObject({ code: 'invalid-number-options' });
  });

  it('F8: on a /UserUnit 2 page a 10 pt number is 10 pt on paper and sits 28 pt from the edge', async () => {
    const src = await makeRawPdf({ content: 'BT /F1 12 Tf 10 10 Td (x) Tj ET', userUnit: 2 });
    const out = await addPageNumbers(src, { ...defaultPageNumberOptions(1), position: 'bottom-left' });
    const v = await (await import('./testMarksPdf')).readerView(out, 1, '1');
    expect(v.w).toBeCloseTo(1224);
    expect(v.size).toBeCloseTo(5, 1); // font size in user units: 5 units of 2 pt
    expect(v.x).toBeCloseTo(28, 1);
    expect(v.y).toBeCloseTo(1584 - 28, 1);
  });

  it('F12: no exponent notation reaches the content', async () => {
    const out = await addPageNumbers(await makePdf('A', 1), { ...defaultPageNumberOptions(1), color: { r: 1e-9, g: 0.5, b: 1 } });
    const doc = await PDFDocument.load(out);
    const parts = (doc.getPage(0).node.Contents() as PDFArray).asArray().map((r) => new TextDecoder('latin1').decode(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode()));
    expect(parts.join('\n')).not.toMatch(/\d[eE][-+]?\d/);
  });
});

describe('R3: one rule for the drawing and the preview', () => {
  it('numberPlacement agrees with what addPageNumbers draws, on a /UserUnit 2 page and on turned and cropped pages', async () => {
    const { readerView: view } = await import('./testMarksPdf');
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const width = font.widthOfTextAtSize('1', 10);
    const cases: [string, Uint8Array, number, 0 | 90 | 180 | 270, { x: number; y: number; width: number; height: number }][] = [];
    cases.push(['unit 2', await makeRawPdf({ content: ' ', userUnit: 2 }), 2, 0, { x: 0, y: 0, width: 612, height: 792 }]);
    for (const rotate of [90, 180, 270] as const) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 800]);
      page.setCropBox(100, 150, 300, 400);
      page.setRotation(degrees(rotate));
      cases.push([`turned ${rotate}, cropped`, await doc.save(), 1, rotate, { x: 100, y: 150, width: 300, height: 400 }]);
    }
    for (const [name, bytes, unit, rotation, box] of cases) {
      for (const position of ['bottom-left', 'top-right', 'bottom-center'] as const) {
        const opts = { ...defaultPageNumberOptions(1), position };
        const out = await addPageNumbers(bytes, opts);
        const drawn = await view(out, 1, '1');
        const placed = numberPlacement(box, rotation, width, opts, unit);
        expect(drawn.ux, `${name} ${position} x`).toBeCloseTo(placed.x, 3);
        expect(drawn.uy, `${name} ${position} y`).toBeCloseTo(placed.y, 3);
      }
    }
  });
});

// REV-A (15 November 2026): damaged page attributes, a page listed twice, spaces-only text, a stray Q,
// the modification date.
describe('REV-A fixes in Page numbers', () => {
  const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  function rawPdf(objects: string[]): Uint8Array {
    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return enc(out);
  }
  const onePage = (extra: string) =>
    rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R ${extra} /Contents 4 0 R >>`, '<< /Length 13 >>\nstream\n0 0 m 1 1 l S\nendstream']);

  it('S2: a page whose box or turn cannot be read is refused plainly, naming the page; odd annotations or resources are read as none', async () => {
    for (const extra of ['', '/MediaBox [0 0 612]', '/MediaBox [0 0 612 792] /Rotate /Ninety', '/MediaBox [0 0 612 792] /CropBox [0 0]']) {
      await expect(addPageNumbers(onePage(extra), defaultPageNumberOptions(1)), extra).rejects.toMatchObject({
        name: 'PdfToolsError',
        code: 'invalid-number-options',
        message: 'Page 1 could not be read, so it cannot be numbered. The file may be damaged.',
      });
    }
    const cycle = rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 2 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>']);
    await expect(addPageNumbers(cycle, defaultPageNumberOptions(1))).rejects.toMatchObject({ message: expect.stringContaining('Page 1 could not be read') });
    for (const extra of ['/MediaBox [0 0 612 792] /Annots << >>', '/MediaBox [0 0 612 792] /Annots [5]', '/MediaBox [0 0 612 792] /Resources [1 2]', '/MediaBox [0 0 612 792] /Resources << /Font 5 >>']) {
      const report = emptyMarkReport();
      const out = await addPageNumbers(onePage(extra), defaultPageNumberOptions(1), { report });
      expect((await pageTexts(out))[0], extra).toContain('1');
    }
  });

  it('S6: one page listed twice in the page tree is refused, naming both places', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const tree = doc.catalog.Pages();
    const kids = tree.lookup(PDFName.of('Kids'), PDFArray);
    kids.push(kids.get(0));
    tree.set(PDFName.of('Count'), PDFNumber.of(2));
    await expect(addPageNumbers(await doc.save(), defaultPageNumberOptions(2))).rejects.toMatchObject({
      code: 'invalid-number-options',
      message: 'Pages 1 and 2 are one page listed twice in this file, so they cannot be numbered separately. The file may be damaged.',
    });
  });

  it('M4: a header or footer of spaces only is refused as Watermark refuses it', async () => {
    await expect(addPageNumbers(await makePdf('S', 1), { ...defaultPageNumberOptions(1), texts: { 'top-left': '   ' } })).rejects.toMatchObject({
      code: 'invalid-number-options',
      message: 'The text at the top left needs 1 to 120 characters.',
    });
  });

  it('S4: a page number lands where it belongs on a page with more Q than q', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: doc.context.obj({ F1: font.ref }) }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('Q 0.5 0 0 0.5 0 0 cm\nBT /F1 12 Tf 100 600 Td (Body) Tj ET')));
    const report = emptyMarkReport();
    const out = await addPageNumbers(await doc.save(), defaultPageNumberOptions(1), { report });
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false, verbosity: 0 }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items as { str: string; transform: number[] }[];
    await pdf.destroy();
    const at = (s: string) => items.find((i) => i.str === s)!.transform.slice(4, 6).map(Math.round);
    expect(at('1')).toEqual([303, 28]); // was [152, 14]: the stray Q popped the only q, so the scale reached the number
    expect(at('Body')).toEqual([50, 300]); // the page's own drawing as the unmarked page has it
    expect(report.damaged).toEqual([1]); // still said: readers differ on such pages
  });

  it('S12: the result gets our Producer and a new modification date; the source Creator stays', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([612, 792]);
    doc.setCreator('Tally');
    doc.setModificationDate(new Date('2020-01-01T00:00:00Z'));
    const out = await PDFDocument.load(await addPageNumbers(await doc.save(), defaultPageNumberOptions(1)), { updateMetadata: false });
    expect(out.getCreator()).toBe('Tally');
    expect(out.getProducer()).toBe('ICAI VERA');
    expect(out.getModificationDate()!.getFullYear()).toBeGreaterThan(2020);
  });
});

// FIX-A2 follow-up (INT3 concern 1): a Stop pressed while the file is still being read ends the run within the
// read, with the run's own error, never "could not be read".
describe('Page numbers: Stop while the file is read', () => {
  class Stopped extends Error {}
  it('stops with the run’s own error', async () => {
    let clock = 0;
    // A clock that runs 60 ms between two looks at it: every look finds a turn due, so the read waits often.
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60));
    try {
      const stop = new Stopped('numbers');
      const error = await addPageNumbers(await makePdf('N', 3), defaultPageNumberOptions(3), { check: () => { throw stop; } }).catch((e: unknown) => e);
      expect(error).toBe(stop);
    } finally {
      spy.mockRestore();
    }
  });
});
