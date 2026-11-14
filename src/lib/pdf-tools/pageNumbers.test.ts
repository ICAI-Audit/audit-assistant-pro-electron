import { degrees, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFRef, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addPageNumbers,
  defaultPageNumberOptions,
  numberPlacement,
  pageNumberLabel,
  type NumberPosition,
} from './pageNumbers';
import { makePdf, pageTexts } from './testPdf';

// The first pdfjs import is slow and the suite runs alongside others, so pay for it here, with room to spare.
vi.setConfig({ testTimeout: 20_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 30_000);

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

  it('shows control, format and combining characters as code points', async () => {
    const msg = await messageFor('a\n‍b́');
    expect(msg).toContain('U+000A');
    expect(msg).toContain('U+200D');
    expect(msg).toContain('U+0301');
    expect(msg).not.toMatch(INVISIBLE);
  });

  it('shows lone surrogates and line separators as code points', async () => {
    const msg = await messageFor('a\uD800b ');
    expect(msg).toContain('U+D800');
    expect(msg).toContain('U+2028');
    expect(msg).not.toMatch(INVISIBLE);
  });

  it('shows each other character once, as a whole code point', async () => {
    const msg = await messageFor('😀😀₹₹');
    expect(msg.split('😀').length - 1).toBe(1);
    expect(msg.split('₹').length - 1).toBe(1);
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
