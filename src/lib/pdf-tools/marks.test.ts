import { deflateSync } from 'node:zlib';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addImageMark,
  addTextMark,
  autoSize,
  diagonalAngle,
  displayedPage,
  embedMarkFont,
  hasWidgets,
  looksScanned,
  num,
  pageCoverage,
  pageHealth,
  placeBox,
  readerMatrix,
  decodeStreamBytes,
  scanBalance,
  textWidth,
  unsupportedError,
  type Anchor,
  type TextMark,
} from './marks';
import { pageTexts } from './testPdf';
import { changedPixels, makeEncodedPdf, makeOffLayerPdf, makePositionsPdf, makePredictorPdf, makeRawPdf, UNCLOSED_Q_CONTENT, type EncodeStep, makeScanPdf, makeSharedPagesPdf, makeStrayPdf, readerView, renderPage, solidPng, solidPngRgba, type StrayKind } from './testMarksPdf';

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);

const GREY = { r: 0.5, g: 0.5, b: 0.5 };

async function markAll(bytes: Uint8Array, make: (doc: PDFDocument, font: Awaited<ReturnType<typeof embedMarkFont>>) => TextMark | null, pages?: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const font = await embedMarkFont(doc, 'helvetica', true, false);
  doc.getPages().forEach((page, i) => {
    if (pages && !pages.includes(i)) return;
    const mark = make(doc, font);
    if (mark) addTextMark(doc, page, mark);
  });
  return doc.save();
}

describe('geometry', () => {
  it('diagonalAngle of A4 portrait is about 54.7', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    expect(diagonalAngle(displayedPage(page))).toBeCloseTo(54.7, 1);
  });

  it('displayedPage swaps the size of a turned page and uses the visible box', async () => {
    const doc = await PDFDocument.load(await makePositionsPdf());
    const [p0, p90, , , cropped] = doc.getPages();
    expect(displayedPage(p0)).toMatchObject({ rotation: 0, width: 612, height: 792 });
    expect(displayedPage(p90)).toMatchObject({ rotation: 90, width: 792, height: 612 });
    expect(displayedPage(cropped)).toMatchObject({ width: 364, height: 664, box: { x: 100, y: 50 } });
  });

  it('readerMatrix takes the reader frame to the page for every turn', async () => {
    const box = { x: 10, y: 20, width: 300, height: 400 };
    const at = (rotation: 0 | 90 | 180 | 270, u: number, v: number) => {
      const [a, b, c, d, e, f] = readerMatrix({ box, rotation, width: rotation % 180 ? 400 : 300, height: rotation % 180 ? 300 : 400 });
      return [a * u + c * v + e, b * u + d * v + f];
    };
    expect(at(0, 5, 7)).toEqual([15, 27]);
    expect(at(90, 0, 300)).toEqual([10, 20]); // the page's bottom-left shows at the top-left of a page turned 90
    expect(at(180, 0, 0)).toEqual([310, 420]);
    expect(at(270, 0, 0)).toEqual([10, 420]);
  });

  it('placeBox pins the turned bounding box to the chosen edges', async () => {
    const d = { box: { x: 0, y: 0, width: 600, height: 800 }, rotation: 0 as const, width: 600, height: 800 };
    expect(placeBox(d, 100, 20, 0, { anchor: 'top-right', padPt: 20 })).toEqual({ u: 530, v: 770 });
    expect(placeBox(d, 100, 20, 0, { anchor: 'center', padPt: 0 })).toEqual({ u: 300, v: 400 });
    const turned = placeBox(d, 100, 20, 90, { anchor: 'bottom-left', padPt: 10 });
    expect(turned.u).toBeCloseTo(20);
    expect(turned.v).toBeCloseTo(60);
    expect(placeBox(d, 100, 20, 0, { point: { u: 0.25, v: 0.5 } })).toEqual({ u: 150, v: 400 });
    expect(placeBox(d, 100, 20, 0, { point: { u: 0, v: 1 } })).toEqual({ u: 50, v: 790 }); // kept on the page
  });

  it('autoSize makes the text span its share of the line it runs along', async () => {
    const doc = await PDFDocument.create();
    const font = await embedMarkFont(doc, 'helvetica', true, false);
    const d = displayedPage(doc.addPage([612, 792]));
    const size = autoSize('DRAFT', font, d, 0, 0.8);
    expect(textWidth(font, 'DRAFT', size)).toBeGreaterThan(0.8 * 612 * 0.99);
    expect(textWidth(font, 'DRAFT', size)).toBeLessThanOrEqual(0.8 * 612);
    const diagonal = autoSize('DRAFT', font, d, diagonalAngle(d), 0.8);
    expect(textWidth(font, 'DRAFT', diagonal)).toBeLessThanOrEqual(0.8 * Math.hypot(612, 792));
    expect(textWidth(font, 'DRAFT', diagonal)).toBeGreaterThan(0.6 * Math.hypot(612, 792)); // still most of the diagonal
    expect(autoSize('A', font, d, 0, 0.8)).toBe(400);
  });
});

describe('scanBalance', () => {
  it('counts the q left open and notices a Q with nothing to close', () => {
    expect(scanBalance('q 1 0 0 1 0 0 cm Q')).toMatchObject({ open: 0, extraClose: false });
    expect(scanBalance('q q Q')).toMatchObject({ open: 1, extraClose: false });
    expect(scanBalance('Q Q 1 0 0 1 40 40 cm')).toMatchObject({ open: 0, extraClose: true });
  });
  it('ignores q and Q in strings, comments, names, hex strings and inline images', () => {
    expect(scanBalance('BT (q q q \\) q) Tj ET')).toMatchObject({ open: 0, extraClose: false });
    expect(scanBalance('% q q q\nq Q')).toMatchObject({ open: 0, extraClose: false });
    expect(scanBalance('/q gs <7171> Tj')).toMatchObject({ open: 0, extraClose: false });
    expect(scanBalance('BI /W 1 /H 1 ID q Q q q \nEI q')).toMatchObject({ open: 1, extraClose: false });
  });
  it('reads a Q followed by a delimiter or the end of the text', () => {
    expect(scanBalance('q[1 2]TJ Q')).toMatchObject({ open: 0, extraClose: false });
    expect(scanBalance('q\nQ')).toMatchObject({ open: 0, extraClose: false });
    expect(scanBalance('q Q q')).toMatchObject({ open: 1, extraClose: false });
  });
});

describe('text marks in the displayed frame (rendered with pdf.js at 72 dpi)', () => {
  const centres: [number, number][] = [[306, 396], [396, 306], [306, 396], [396, 306], [182, 332]];

  it('puts a centred 45 degree DRAFT at the centre of every displayed page, turned or cropped', async () => {
    const src = await makePositionsPdf();
    const out = await markAll(src, (_, font) => ({ text: 'DRAFT', font, size: 96, angleDeg: 45, opacity: 0.25, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' }));
    for (let p = 1; p <= 5; p++) {
      const c = await changedPixels(src, out, p);
      expect(c.count).toBeGreaterThan(2000);
      expect(Math.abs(c.centre![0] - centres[p - 1][0])).toBeLessThanOrEqual(6);
      expect(Math.abs(c.centre![1] - centres[p - 1][1])).toBeLessThanOrEqual(6);
    }
  });

  it('draws the watermark text as real, upright-at-angle text pdf.js can read', async () => {
    const src = await makePositionsPdf();
    const out = await markAll(src, (_, font) => ({ text: 'DRAFT', font, size: 96, angleDeg: 45, opacity: 0.25, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' }), [0, 1]);
    for (const p of [1, 2]) expect(Math.abs((await readerView(out, p, 'DRAFT')).angle - 45)).toBeLessThan(0.5);
  });

  it('behind a full-page image changes no pixel, in front it changes many', async () => {
    const src = await makeScanPdf();
    const mark = (layer: 'behind' | 'front') => markAll(src, (_, font) => ({ text: 'DRAFT', font, size: 150, angleDeg: 45, opacity: 0.5, color: { r: 0, g: 0, b: 0 }, placement: { anchor: 'center', padPt: 0 }, layer }));
    expect((await changedPixels(src, await mark('behind'), 1)).count).toBe(0);
    expect((await changedPixels(src, await mark('front'), 1)).count).toBeGreaterThan(5000);
  });

  it('a top-right stamp sits the padding in from the top and right edges on every turn', async () => {
    const src = await makePositionsPdf();
    const out = await markAll(src, (_, font) => ({ text: 'VERIFIED', font, size: 20, angleDeg: 0, opacity: 0.78, color: { r: 0.63, g: 0, b: 0 }, placement: { anchor: 'top-right', padPt: 20 }, layer: 'front' }));
    for (let p = 1; p <= 5; p++) {
      const c = await changedPixels(src, out, p);
      expect(Math.abs(c.bbox![2] + 1 - (c.width - 20))).toBeLessThanOrEqual(3);
      expect(Math.abs(c.bbox![1] - 20)).toBeLessThanOrEqual(3);
    }
  });

  it('puts the text at the other anchors on a turned page', async () => {
    const src = await makePositionsPdf();
    const anchors: Anchor[] = ['top-left', 'bottom-left', 'bottom-right', 'middle-left', 'bottom-center'];
    for (const anchor of anchors) {
      const out = await markAll(src, (_, font) => ({ text: 'VERIFIED', font, size: 20, angleDeg: 0, opacity: 1, color: { r: 0, g: 0, b: 0 }, placement: { anchor, padPt: 20 }, layer: 'front' }), [1]);
      const c = await changedPixels(src, out, 2); // turned 90: displayed 792 x 612
      const [x0, y0, x1, y1] = c.bbox!;
      if (anchor.endsWith('left')) expect(Math.abs(x0 - 20)).toBeLessThanOrEqual(3);
      if (anchor.endsWith('right')) expect(Math.abs(x1 + 1 - (c.width - 20))).toBeLessThanOrEqual(3);
      if (anchor.startsWith('top')) expect(Math.abs(y0 - 20)).toBeLessThanOrEqual(3);
      if (anchor.startsWith('bottom')) expect(Math.abs(y1 + 1 - (c.height - 20))).toBeLessThanOrEqual(3);
      if (anchor === 'bottom-center') expect(Math.abs((x0 + x1) / 2 - c.width / 2)).toBeLessThanOrEqual(3);
    }
  });

  it('refuses characters the built-in font cannot draw, naming them', async () => {
    const doc = await PDFDocument.load(await makePositionsPdf());
    const font = await embedMarkFont(doc, 'helvetica', false, false);
    const mark = (text: string): TextMark => ({ text, font, size: 12, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' });
    for (const text of ['₹ 500', 'पृष्ठ', '😀']) {
      let error: unknown;
      try { addTextMark(doc, doc.getPage(0), mark(text)); } catch (e) { error = e; }
      expect(error).toMatchObject({ code: 'unsupported-characters' });
      expect((error as Error).message).toContain([...text][0]);
    }
  });
});

describe('image marks', () => {
  it('draws a logo 18 percent of the displayed width, and caps a tall one at 35 percent of the height', async () => {
    const src = await makePositionsPdf();
    const doc = await PDFDocument.load(src);
    const wide = await doc.embedPng(solidPng(200, 100, [0, 0, 200]));
    const tall = await doc.embedPng(solidPng(100, 400, [0, 0, 200]));
    const sizes: { widthPt: number; heightPt: number }[] = [];
    const base = { maxHeightShare: 0.35, minWidthPt: 28, opacity: 1, placement: { anchor: 'top-left', padPt: 20 } as const };
    sizes.push(addImageMark(doc, doc.getPage(0), { ...base, image: wide, widthShare: 0.18 }));
    sizes.push(addImageMark(doc, doc.getPage(1), { ...base, image: wide, widthShare: 0.18 }));
    sizes.push(addImageMark(doc, doc.getPage(2), { ...base, image: tall, widthShare: 0.18 }));
    const out = await doc.save();
    expect(sizes[0].widthPt).toBeCloseTo(0.18 * 612);
    expect(sizes[1].widthPt).toBeCloseTo(0.18 * 792);
    const c1 = await changedPixels(src, out, 1);
    expect(Math.abs(c1.bbox![2] - c1.bbox![0] + 1 - 0.18 * 612)).toBeLessThanOrEqual(1.5);
    const c2 = await changedPixels(src, out, 2);
    expect(Math.abs(c2.bbox![2] - c2.bbox![0] + 1 - 0.18 * 792)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(c2.bbox![0] - 20)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(c2.bbox![1] - 20)).toBeLessThanOrEqual(1.5);
    const c3 = await changedPixels(src, out, 3);
    expect(Math.abs(c3.bbox![3] - c3.bbox![1] + 1 - 0.35 * 792)).toBeLessThanOrEqual(1.5);
    expect(sizes[2].heightPt).toBeCloseTo(0.35 * 792);
  });

  it('uses a minimum width, and embeds the image once for every page', async () => {
    const doc = await PDFDocument.load(await makeSharedPagesPdf(5));
    const image = await doc.embedPng(solidPng(40, 40, [0, 0, 0]));
    for (const page of doc.getPages()) {
      expect(addImageMark(doc, page, { image, widthShare: 0.05, maxHeightShare: 0.35, minWidthPt: 28, opacity: 0.5, placement: { anchor: 'top-left', padPt: 20 } }).widthPt).toBe(28);
    }
    const out = await PDFDocument.load(await doc.save());
    const images = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(1);
  });
});

describe('existing content is isolated, not re-encoded', () => {
  const kinds: StrayKind[] = ['unclosed-q', 'flip', 'scale'];

  for (const kind of kinds) {
    it(`a mark in front lands 20 pt from the top left on a page with ${kind} content (text position and pixels)`, async () => {
      const src = await makeStrayPdf(kind);
      const out = await markAll(src, (_, font) => ({ text: 'MARK', font, size: 20, angleDeg: 0, opacity: 1, color: { r: 0, g: 0, b: 0 }, placement: { anchor: 'top-left', padPt: 20 }, layer: 'front' }));
      const v = await readerView(out, 1, 'MARK');
      expect(Math.abs(v.x - 20)).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y - (20 + 20 * 0.718))).toBeLessThanOrEqual(1);
      expect(v.upright).toBe(true);
      const c = await changedPixels(src, out, 1, 2);
      expect(Math.abs(c.bbox![0] / 2 - 20)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(c.bbox![1] / 2 - 20)).toBeLessThanOrEqual(1.5);
      expect(pageHealth((await PDFDocument.load(out)).getPage(0))).toEqual({ damaged: false, unverified: false });
    });
  }

  it('leaves the page drawing exactly where the unmarked page had it', async () => {
    for (const kind of kinds) {
      const src = await makeStrayPdf(kind);
      const out = await markAll(src, (_, font) => ({ text: 'MARK', font, size: 20, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'bottom-right', padPt: 20 }, layer: 'front' }));
      const a = await renderPage(src, 1);
      const b = await renderPage(out, 1);
      // Outside the mark's corner every pixel is the same.
      let differing = 0;
      for (let y = 0; y < a.height - 60; y++) for (let x = 0; x < a.width; x++) if (a.data[(y * a.width + x) * 4] !== b.data[(y * a.width + x) * 4]) differing++;
      expect(differing).toBe(0);
    }
  });

  it('a page with more Q than q is reported as damaged, and marked where it belongs in front and behind (REV-A S4)', async () => {
    const src = await makeStrayPdf('extra-q');
    const doc = await PDFDocument.load(src);
    expect(pageHealth(doc.getPage(0)).damaged).toBe(true);
    expect(scanBalance('Q Q 1 0 0 1 40 40 cm')).toMatchObject({ strays: 2, open: 0 });
    const mark = (layer: 'behind' | 'front', anchor: Anchor = 'top-left') => markAll(src, (_, font) => ({ text: 'MARK', font, size: 20, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor, padPt: 20 }, layer }));
    // A `q` is opened for each stray `Q`, so the stray transform (40 pt) does not move the mark.
    for (const layer of ['front', 'behind'] as const) {
      const at = await readerView(await mark(layer), 1, 'MARK');
      expect(Math.abs(at.x - 20), layer).toBeLessThanOrEqual(1);
      expect(Math.abs(at.y - (20 + 20 * 0.718)), layer).toBeLessThanOrEqual(1);
    }
    // The page's own drawing is where the unmarked page has it.
    expect((await readerView(await mark('front'), 1, 'Body')).x).toBeCloseTo((await readerView(src, 1, 'Body')).x, 0);
  });

  it('keeps every original content stream byte for byte and shares the q and Q streams between pages', async () => {
    const src = await makeSharedPagesPdf(6);
    const before = await PDFDocument.load(src);
    const originals = before.getPages().map((p) => (before.context.lookup(p.node.get(PDFName.of('Contents'))) as PDFRawStream).contents.slice());
    const out = await markAll(src, (_, font) => ({ text: 'M', font, size: 12, angleDeg: 0, opacity: 0.5, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' }));
    const after = await PDFDocument.load(out);
    const refs = new Set<string>();
    const closers = new Set<string>();
    after.getPages().forEach((page, i) => {
      const contents = page.node.Contents() as PDFArray;
      expect(contents.size()).toBe(4); // q, original, Q, ours
      refs.add((contents.get(0) as PDFRef).tag);
      closers.add((contents.get(2) as PDFRef).tag);
      expect((after.context.lookup(contents.get(1)) as PDFRawStream).contents).toEqual(originals[i]);
    });
    expect(refs.size).toBe(1);
    expect(closers.size).toBe(1);
  });

  it('puts a mark behind as the first stream, with nothing wrapped around the original', async () => {
    const out = await markAll(await makeSharedPagesPdf(2), (_, font) => ({ text: 'M', font, size: 12, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'behind' }));
    const page = (await PDFDocument.load(out)).getPage(0);
    expect((page.node.Contents() as PDFArray).size()).toBe(2);
  });
});

describe('opacity and resources', () => {
  it('sets /ca and /CA through one shared graphics state per opacity', async () => {
    const out = await markAll(await makeSharedPagesPdf(4), (_, font) => ({ text: 'M', font, size: 12, angleDeg: 0, opacity: 0.25, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' }));
    const doc = await PDFDocument.load(out);
    const states = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('ExtGState'));
    expect(states).toHaveLength(1);
    const gs = states[0][1] as PDFDict;
    expect((gs.get(PDFName.of('ca')) as PDFNumber).asNumber()).toBe(0.25);
    expect((gs.get(PDFName.of('CA')) as PDFNumber).asNumber()).toBe(0.25);
  });

  it('gives pages that share resources one cloned dictionary and leaves other pages and the original alone', async () => {
    const src = await makeSharedPagesPdf(5, 3);
    const out = await markAll(src, (_, font) => ({ text: 'M', font, size: 12, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' }), [0, 1, 2]);
    const doc = await PDFDocument.load(out);
    const refs = doc.getPages().map((p) => (p.node.get(PDFName.of('Resources')) as PDFRef).tag);
    expect(new Set(refs.slice(0, 3)).size).toBe(1);
    expect(refs[3]).toBe(refs[4]);
    expect(refs[3]).not.toBe(refs[0]);
    const fonts = (r: PDFRef) => (doc.context.lookup(r, PDFDict).lookup(PDFName.of('Font'), PDFDict) as PDFDict).keys().map((k) => k.decodeText());
    expect(fonts(doc.getPage(3).node.get(PDFName.of('Resources')) as PDFRef)).toEqual(['F0', 'X0', 'X1', 'X2']);
    expect(fonts(doc.getPage(0).node.get(PDFName.of('Resources')) as PDFRef)).toContain('VRA1_F1');
  });

  it('adds no empty /Annots or other keys that normalize() would write, and a second run does not overwrite the first', async () => {
    const first = await markAll(await makeSharedPagesPdf(3), (_, font) => ({ text: 'M', font, size: 12, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' }));
    const second = await markAll(first, (_, font) => ({ text: 'N', font, size: 12, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'top-left', padPt: 10 }, layer: 'front' }));
    const doc = await PDFDocument.load(second);
    expect(doc.getPage(0).node.has(PDFName.of('Annots'))).toBe(false);
    const fonts = (doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict) as PDFDict).keys().map((k) => k.decodeText());
    expect(fonts).toEqual(expect.arrayContaining(['F0', 'VRA1_F1', 'VRA2_F1']));
    expect(await (async () => (await import('./testPdf')).pageTexts(second))()).toEqual(['Shared 1 MN', 'Shared 2 MN', 'Shared 3 MN']);
  });

  it('keeps one embedded font for every page', async () => {
    const out = await markAll(await makeSharedPagesPdf(8), (_, font) => ({ text: 'M', font, size: 12, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' }));
    const doc = await PDFDocument.load(out);
    const bold = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('BaseFont')) === PDFName.of('Helvetica-Bold'));
    expect(bold).toHaveLength(1);
  });
});

describe('size grows in line with the page count when pages share resources', () => {
  async function grown(pages: number): Promise<{ input: number; output: number }> {
    const src = await makeSharedPagesPdf(pages, 40);
    const doc = await PDFDocument.load(src);
    const font = await embedMarkFont(doc, 'helvetica', true, false);
    for (const page of doc.getPages()) addTextMark(doc, page, { text: 'DRAFT', font, size: 40, angleDeg: 45, opacity: 0.25, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' });
    return { input: src.length, output: (await doc.save({ useObjectStreams: false })).length };
  }

  it('is linear at 300 and 600 pages', async () => {
    const a = await grown(150);
    const b = await grown(300);
    const c = await grown(600);
    const g = (x: { input: number; output: number }) => x.output - x.input;
    expect(g(c) / g(b)).toBeLessThan(2.2);
    expect(g(b) / g(a)).toBeLessThan(2.2);
    expect(g(b) / 300).toBeLessThan(1200); // bytes added per page
    expect(c.output / c.input).toBeLessThan(b.output / b.input + 0.5);
  });
});

describe('what the page holds', () => {
  it('recognises a scan, and not a page with text or a half-page picture', async () => {
    const scan = await PDFDocument.load(await makeScanPdf());
    expect(pageCoverage(scan.getPage(0)).images).toBeGreaterThan(0.99);
    expect(looksScanned(scan.getPage(0), false)).toBe(true);
    expect(looksScanned(scan.getPage(0), true)).toBe(false);
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(solidPng(10, 10, [10, 10, 10]));
    doc.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 470 });
    const reloaded = await PDFDocument.load(await doc.save());
    expect(looksScanned(reloaded.getPage(0), false)).toBe(false);
    expect(pageCoverage(reloaded.getPage(0)).images).toBeCloseTo(470 / 792, 1);
  });

  it('sees a page-sized filled rectangle, by re and by a path', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawRectangle({ x: 0, y: 0, width: 612, height: 792 });
    const path = doc.addPage([612, 792]);
    path.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('0 0 m 612 0 l 612 792 l 0 792 l h f')));
    const reloaded = await PDFDocument.load(await doc.save());
    expect(pageCoverage(reloaded.getPage(0)).covered).toBeGreaterThan(0.99);
    expect(pageCoverage(reloaded.getPage(1)).covered).toBeGreaterThan(0.99);
  });

  it('sees a scan wrapped in a form XObject', async () => {
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(solidPng(10, 10, [200, 200, 200]));
    const form = doc.context.register(doc.context.flateStream('612 0 0 792 0 0 cm /Im Do', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: doc.context.obj({ XObject: doc.context.obj({ Im: image.ref }) }),
    }));
    const page = doc.addPage([612, 792]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: doc.context.obj({ Fm: form }) }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('/Fm Do')));
    const reloaded = await PDFDocument.load(await doc.save());
    expect(looksScanned(reloaded.getPage(0), false)).toBe(true);
  });

  it('knows when a page has form fields', async () => {
    const { makeFormPdf } = await import('./testPdf');
    const doc = await PDFDocument.load(await makeFormPdf());
    expect(hasWidgets(doc.getPage(0))).toBe(true);
    expect(hasWidgets((await PDFDocument.load(await makePositionsPdf())).getPage(0))).toBe(false);
  });

  it('keeps a page with undecodable content usable and flags it', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('q', { Filter: 'DCTDecode' })));
    const font = await embedMarkFont(doc, 'helvetica', false, false);
    expect(pageHealth(page).unverified).toBe(true);
    addTextMark(doc, page, { text: 'M', font, size: 12, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'center', padPt: 0 }, layer: 'front' });
    expect(StandardFonts.Helvetica).toBeTruthy();
  });
});

describe('fix round 1: content the scan must not be fooled by', () => {
  const mark = (text: string, anchor: Anchor = 'center'): ((_: PDFDocument, font: Awaited<ReturnType<typeof embedMarkFont>>) => TextMark) =>
    (_, font) => ({ text, font, size: 24, angleDeg: 0, opacity: 1, color: { r: 0, g: 0, b: 0 }, placement: { anchor, padPt: 20 }, layer: 'front' });

  describe('F1 and R1: content is decoded with certainty or the page is reported', () => {
    const text = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder('latin1').decode(bytes).trimEnd());
    const streamOf = async (pdf: Uint8Array) => {
      const doc = await PDFDocument.load(pdf);
      return doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Contents'))) as PDFRawStream;
    };

    for (const kind of ['none', 'sub', 'up', 'avg', 'paeth', 'mixed', 'tiff'] as const) {
      for (const columns of [16, 5, 1]) {
        it(`round trip: ${kind} predictor, ${columns} columns, gives back the content`, async () => {
          const pdf = await makeEncodedPdf([{ filter: 'FlateDecode', predictor: { kind, columns } }]);
          expect(text(decodeStreamBytes(await streamOf(pdf)))).toBe(UNCLOSED_Q_CONTENT);
        });
      }
    }

    it('the defect it guards against: pdf-lib alone returns something else for a predictor stream', async () => {
      const raw = await streamOf(await makePredictorPdf());
      expect(text(decodePDFRawStream(raw).decode())).not.toBe(UNCLOSED_Q_CONTENT);
      expect(text(decodeStreamBytes(raw))).toBe(UNCLOSED_Q_CONTENT);
    });

    const cases: [string, EncodeStep[]][] = [
      ['Flate with a PNG Up predictor', [{ filter: 'FlateDecode', predictor: { kind: 'up', columns: 16 } }]],
      ['Flate with PNG Paeth rows of 7', [{ filter: 'FlateDecode', predictor: { kind: 'paeth', columns: 7 } }]],
      ['Flate with every PNG row filter in turn', [{ filter: 'FlateDecode', predictor: { kind: 'mixed', columns: 11 } }]],
      ['Flate with the TIFF predictor', [{ filter: 'FlateDecode', predictor: { kind: 'tiff', columns: 9 } }]],
      ['the short name /Fl', [{ filter: 'Fl' }]],
      ['/Fl with a predictor', [{ filter: 'Fl', predictor: { kind: 'sub', columns: 13 } }]],
      ['/AHx then /Fl', [{ filter: 'AHx' }, { filter: 'Fl' }]],
      ['/AHx then /Fl with a predictor', [{ filter: 'AHx' }, { filter: 'Fl', predictor: { kind: 'up', columns: 16 } }]],
      ['/RL', [{ filter: 'RL' }]],
      ['/RL then /FlateDecode', [{ filter: 'RL' }, { filter: 'FlateDecode' }]],
    ];
    for (const [name, steps] of cases) {
      it(`${name}: a page with an unclosed q is marked within 1 pt and is not reported`, async () => {
        const src = await makeEncodedPdf(steps);
        expect(pageHealth((await PDFDocument.load(src)).getPage(0))).toEqual({ damaged: false, unverified: false });
        const out = await markAll(src, mark('MARK', 'top-left'));
        const v = await readerView(out, 1, 'MARK');
        expect(Math.abs(v.x - 20)).toBeLessThanOrEqual(1);
        expect(Math.abs(v.y - (20 + 24 * 0.718))).toBeLessThanOrEqual(1);
        expect(v.upright).toBe(true);
      });
    }

    const unreadable: [string, EncodeStep[]][] = [
      ['a predictor over 3 colours', [{ filter: 'FlateDecode', predictor: { kind: 'up', columns: 16, colors: 3 } }]],
      ['a predictor over 16 bits', [{ filter: 'FlateDecode', predictor: { kind: 'up', columns: 16, bpc: 16 } }]],
      ['a predictor value of 20', [{ filter: 'FlateDecode', predictor: { kind: 'up', columns: 16, predictorValue: 20 } }]],
      ['parameters on a filter that takes none that matter (ASCIIHex)', [{ filter: 'AHx', junk: true }, { filter: 'Fl' }]],
    ];
    for (const [name, steps] of unreadable) {
      it(`${name} is reported, and the page is still marked`, async () => {
        const src = await makeEncodedPdf(steps);
        expect(pageHealth((await PDFDocument.load(src)).getPage(0))).toEqual({ damaged: false, unverified: true });
        expect((await pageTexts(await markAll(src, mark('MARK'))))[0]).toContain('MARK');
      });
    }

    it('a filter nobody here can decode (DCT) is reported', async () => {
      const src = await makeRawPdf({ content: Uint8Array.from([1, 2, 3]), streamDict: () => ({ Filter: 'DCT' }) });
      expect(pageHealth((await PDFDocument.load(src)).getPage(0)).unverified).toBe(true);
    });

    it('a plain Flate stream stays readable', async () => {
      const plain = await PDFDocument.load(await makeStrayPdf('unclosed-q'));
      expect(pageHealth(plain.getPage(0))).toEqual({ damaged: false, unverified: false });
    });
  });

  for (const kind of ['bdc', 'nested'] as const) {
    it(`F2: a mark lands, and the page is unchanged elsewhere, when the content ends inside ${kind === 'bdc' ? 'marked content' : 'nested marked content'} of a layer that is off`, async () => {
      const src = await makeOffLayerPdf(kind);
      const out = await markAll(src, mark('MARK'));
      const c = await changedPixels(src, out, 1, 2);
      expect(c.count).toBeGreaterThan(200); // it was 0: the mark went into the hidden layer
      expect(Math.abs(c.centre![0] / 2 - 306)).toBeLessThanOrEqual(3);
      expect(Math.abs(c.centre![1] / 2 - 396)).toBeLessThanOrEqual(8);
      expect(c.bbox![1] / 2).toBeGreaterThan(300); // nothing else of the page moved or appeared
      expect((await pageTexts(out))[0]).toContain('Body');
    });
  }

  it('F2: a content stream that ends inside a text object still gets a mark at the right place, closed with ET', async () => {
    const src = await makeOffLayerPdf('bt');
    const out = await markAll(src, mark('MARK', 'top-left'));
    const v = await readerView(out, 1, 'MARK');
    expect(Math.abs(v.x - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(v.y - (20 + 24 * 0.718))).toBeLessThanOrEqual(1);
    const doc = await PDFDocument.load(out);
    const parts = (doc.getPage(0).node.Contents() as PDFArray).asArray().map((r) => new TextDecoder('latin1').decode(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode()));
    expect(parts.some((p) => p.split('\n')[0] === 'ET')).toBe(true);
    expect(scanBalance('BT /F1 12 Tf (x) Tj')).toMatchObject({ inText: true });
  });

  it('F2/F5: scanBalance counts open marked content, a text object and a pending path', () => {
    expect(scanBalance('/OC /MC0 BDC /Span BMC EMC')).toMatchObject({ marked: 1 });
    expect(scanBalance('/A BMC /B BDC EMC EMC EMC')).toMatchObject({ marked: 0 });
    expect(scanBalance('BT ET')).toMatchObject({ inText: false });
    expect(scanBalance('0 0 m 10 10 l')).toMatchObject({ pendingPath: true });
    expect(scanBalance('0 0 m 10 10 l S')).toMatchObject({ pendingPath: false });
    expect(scanBalance('0 0 10 10 re n')).toMatchObject({ pendingPath: false });
  });

  it('F13: asking about a page changes nothing in it', async () => {
    const doc = await PDFDocument.load(await makeSharedPagesPdf(2));
    const page = doc.getPage(0);
    const before = page.node.get(PDFName.of('Resources'));
    pageHealth(page);
    pageCoverage(page);
    expect(page.node.get(PDFName.of('Resources'))).toBe(before);
  });
});

describe('fix round 1: automatic size on narrow and wide pages', () => {
  const sizes: [string, [number, number]][] = [['receipt', [226.8, 800]], ['strip', [600, 120]], ['A5', [419.5, 595.3]], ['A4', [595.3, 841.9]], ['A3', [841.9, 1190.6]], ['A4 landscape', [841.9, 595.3]], ['letter', [612, 792]]];
  for (const [name, size] of sizes) {
    it(`keeps the whole text inside the ${name} page`, async () => {
      const doc = await PDFDocument.create();
      const font = await embedMarkFont(doc, 'helvetica', true, false);
      const d = displayedPage(doc.addPage(size));
      for (const text of ['DRAFT', 'COPY', 'CONFIDENTIAL']) {
        const angle = diagonalAngle(d);
        const s = autoSize(text, font, d, angle, 0.8);
        const w = textWidth(font, text, s);
        const rad = (angle * Math.PI) / 180;
        const bw = w * Math.cos(rad) + s * 0.718 * Math.sin(rad);
        const bh = w * Math.sin(rad) + s * 0.718 * Math.cos(rad);
        expect(bw).toBeLessThanOrEqual(0.9 * d.width + 0.5);
        expect(bh).toBeLessThanOrEqual(0.9 * d.height + 0.5);
      }
    });
  }
});

describe('fix round 1: /UserUnit pages work in real points', () => {
  it('F8: a 10 pt text and its 20 pt padding are 10 pt and 20 pt on paper on a UserUnit 2 page', async () => {
    const src = await makeRawPdf({ content: 'BT /F1 12 Tf 10 10 Td (x) Tj ET', userUnit: 2 });
    const out = await markAll(src, (_, font) => ({ text: 'MARK', font, size: 10, angleDeg: 0, opacity: 1, color: GREY, placement: { anchor: 'top-left', padPt: 20 }, layer: 'front' }));
    const v = await readerView(out, 1, 'MARK');
    // pdf.js lays the page out in real points (1224 x 1584) and keeps font sizes in user units: 10 pt is 5 of them.
    expect(v.w).toBeCloseTo(1224);
    expect(v.size).toBeCloseTo(5, 1);
    expect(v.x).toBeCloseTo(20, 1);
    expect(v.y).toBeCloseTo(20 + 10 * 0.718, 1);
    const doc = await PDFDocument.load(src);
    expect(displayedPage(doc.getPage(0))).toMatchObject({ width: 1224, height: 1584, unit: 2 });
  });
});

describe('fix round 1: numbers as PDF writes them', () => {
  it('F12: never an exponent, never a negative zero', () => {
    expect(num(1e-9)).toBe('0');
    expect(num(-0.00001)).toBe('0');
    expect(num(12.345678)).toBe('12.3457');
    expect(num(-3)).toBe('-3');
  });
});

describe('unsupportedError: the words as typed, and what works today (QA-FIX H)', () => {
  const RULE = 'use English letters, digits and common signs (write Rs. for ₹).';
  it('shows a Hindi word as typed, never as code points', () => {
    const message = unsupportedError('watermark text', ['म', 'ौ', 'स'], 'मौसम DRAFT').message;
    expect(message).toBe(`“मौसम” cannot be printed in the watermark text; ${RULE}`);
    expect(message).not.toMatch(/U\+/);
  });
  it('shows the word that holds the rupee sign', () => {
    expect(unsupportedError('header or footer text', ['₹'], 'Fee ₹500 paid').message).toBe(`“₹500” cannot be printed in the header or footer text; ${RULE}`);
  });
  it('names at most three words, then how many more', () => {
    expect(unsupportedError('stamp text', ['क', 'ख', 'ग', 'घ'], 'क ख ग घ').message).toBe(`“क”, “ख”, “ग” and 1 more word cannot be printed in the stamp text; ${RULE}`);
  });
  it('names a character that would print as nothing by its code, as it cannot be shown', () => {
    const message = unsupportedError('page number text', ['\u200b', '\n'], 'a\u200bb\nc').message;
    expect(message).toBe(`Invisible characters (U+200B, U+000A) cannot be printed in the page number text; ${RULE}`);
    expect(message).not.toMatch(/[\p{C}\p{Zl}\p{Zp}]/u);
  });
  it('shows a combining mark inside its word, and a lone one on a dotted circle', () => {
    expect(unsupportedError('mark text', ['\u0301'], 'cafe\u0301').message).toBe(`“cafe\u0301” cannot be printed in the mark text; ${RULE}`);
    expect(unsupportedError('mark text', ['े'], 'े').message).toBe(`“◌े” cannot be printed in the mark text; ${RULE}`);
  });
  it('cuts a very long word', () => {
    const word = 'क'.repeat(60);
    const message = unsupportedError('watermark text', ['क'], word).message;
    expect(message.startsWith(`“${'क'.repeat(20)}…”`)).toBe(true);
  });
});

// REV-A (15 November 2026): bounded coverage check, long paths, masks read once, damaged attributes, a page listed twice.
describe('REV-A fixes in the marks library', () => {
  /** One page whose content draws form X `fan` times; X draws itself `fan` times and names itself in its resources (REV-A B4). */
  async function formBomb(fan: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    const formRef = doc.context.nextRef();
    const res = doc.context.obj({ Font: doc.context.obj({ F1: font.ref }), XObject: doc.context.obj({ X: formRef }) });
    const inner = Array.from({ length: fan }, () => '/X Do').join('\n');
    doc.context.assign(formRef, doc.context.flateStream(inner, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: res } as never));
    page.node.set(PDFName.of('Resources'), res);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(`BT /F1 12 Tf 100 600 Td (Body) Tj ET\n${inner}`)));
    return doc.save({ useObjectStreams: false });
  }

  it('B4: a form that draws itself is read within a budget, and the area it may paint counts as unknown, not as clear', async () => {
    // fan 1000 is about 10^12 form readings without a budget; with one it is a few hundred.
    for (const fan of [30, 1000]) {
      const page = (await PDFDocument.load(await formBomb(fan))).getPage(0);
      const c = pageCoverage(page);
      expect(c.known, `fan ${fan}`).toBe(true);
      expect(c.covered, `fan ${fan}`).toBe(0);
      expect(c.unknown, `fan ${fan}`).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('B4 variation: forms nested deeper than three levels count as unknown over their box, and an opaque form within the limit still counts', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    // Five forms, each drawing the next; the last fills its box opaquely.
    const refs = Array.from({ length: 5 }, () => doc.context.nextRef());
    refs.forEach((ref, i) => {
      const next = i < refs.length - 1 ? '/N Do' : '0 0 300 400 re f';
      const res = i < refs.length - 1 ? { XObject: doc.context.obj({ N: refs[i + 1] }) } : {};
      doc.context.assign(ref, doc.context.flateStream(next, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 400], Resources: doc.context.obj(res) } as never));
    });
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: doc.context.obj({ A: refs[0], E: refs[4] }) }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('/A Do\nq 1 0 0 1 300 400 cm /E Do Q')));
    const loaded = (await PDFDocument.load(await doc.save())).getPage(0);
    const whole = pageCoverage(loaded);
    // The deep chain cannot be read to its end: its box (a quarter of the page) is unknown. /E, drawn directly, is a known quarter.
    expect(whole.covered).toBeCloseTo(0.25, 2);
    expect(whole.unknown).toBeCloseTo(0.25, 2);
  });

  it('S1: a path of 200,000 points behind a watermark does not overflow the stack', async () => {
    const pts = Array.from({ length: 200_000 }, (_, i) => `${i % 600} ${(i * 7) % 790} l`).join('\n');
    for (const end of ['f', 'W n']) {
      const src = await makeRawPdf({ content: `BT /F1 12 Tf 100 600 Td (Body) Tj ET\n0 0 m\n${pts}\n${end}\nq 0 0 612 792 re f Q` });
      const c = pageCoverage((await PDFDocument.load(src)).getPage(0));
      expect(c.known, end).toBe(true);
      expect(c.covered, end).toBeGreaterThan(0.9); // the rectangle after the long path is still counted (clipped to it for W n)
    }
  });

  it('S5: a masked picture drawn 300 times has its mask read once', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const image = await doc.embedPng(solidPngRgba(64, 64, [10, 20, 30, 128]));
    for (let i = 0; i < 300; i++) page.drawImage(image, { x: (i % 20) * 30, y: Math.floor(i / 20) * 50, width: 30, height: 50 });
    const loaded = await PDFDocument.load(await doc.save());
    const mask = loaded.context.enumerateIndirectObjects().map(([, o]) => o).find((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('SMask')) instanceof PDFRef);
    const smask = loaded.context.lookup(mask!.dict.get(PDFName.of('SMask'))) as PDFRawStream;
    const bytes = smask.contents;
    let reads = 0;
    Object.defineProperty(smask, 'contents', { get: () => { reads++; return bytes; } });
    const c = pageCoverage(loaded.getPage(0));
    expect(reads).toBe(1);
    expect(c.images).toBe(0); // half-transparent: lets the page show
    pageCoverage(loaded.getPage(0));
    expect(reads).toBe(1);
  });

  it('S2: annotations or resources that are not what they should be are read as none, never thrown', async () => {
    const annots = await makeRawPdf({ content: 'BT /F1 12 Tf 100 600 Td (Body) Tj ET' });
    const doc = await PDFDocument.load(annots);
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj({}));
    expect(hasWidgets(doc.getPage(0))).toBe(false);
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([5]));
    expect(hasWidgets(doc.getPage(0))).toBe(false);
    doc.getPage(0).node.set(PDFName.of('Resources'), PDFNumber.of(5));
    expect(pageCoverage(doc.getPage(0)).known).toBe(true);
  });
});
