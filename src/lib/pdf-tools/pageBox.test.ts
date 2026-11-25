import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, type PDFObject, type PDFPage } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { displayedPage, type Box, type DisplayedPage } from './marks';
import { changePageBoxes, contentBalance, emptyPageBoxReport, pageBoxError, PAPERS, planPage, type PageBoxOptions, type PageBoxReport, type Sides } from './pageBox';
import { rawHaystack } from './testLeakPdf';
import { makeStrayPdf, type StrayKind } from './testMarksPdf';
import { BUNDLE_PAGES, BUNDLE_TEXT, inkOutside, makeArrayContentPdf, makeBundlePdf, makeLongPdf, makePatternPdf, pdfjsOutlineDests, pdfjsPage, placementOf, renderPage } from './testPageBoxPdf';
import { makePdf, pageTexts } from './testPdf';

vi.setConfig({ testTimeout: 240_000 });

let bundle: Uint8Array;
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
  bundle = await makeBundlePdf();
  await pageTexts(bundle); // pays the cold pdf.js start once
}, 120_000);

const MM = 72 / 25.4;
const A4 = { width: PAPERS.a4.width, height: PAPERS.a4.height };
type Resize = Extract<PageBoxOptions, { mode: 'resize' }>;
const resize = (over: Partial<Resize> = {}): PageBoxOptions => ({ mode: 'resize', size: A4, direction: 'keep', enlarge: true, margin: 0, pages: { from: 1, to: 8 }, ...over });
const sides = (left: number, top: number, right: number, bottom: number): Sides => ({ left, top, right, bottom });
const trim = (s: Sides, mirror = false, pages = { from: 1, to: 8 }): PageBoxOptions => ({ mode: 'trim', sides: s, mirror, pages });
const margin = (s: Sides, mirror = false, pages = { from: 1, to: 8 }): PageBoxOptions => ({ mode: 'margin', sides: s, mirror, pages });

/** A page as displayed, from its visible box in its own coordinates. */
const shown = (box: Box, rotation: 0 | 90 | 180 | 270 = 0, unit = 1): DisplayedPage => {
  const sideways = rotation === 90 || rotation === 270;
  return { box, rotation, unit, width: (sideways ? box.height : box.width) * unit, height: (sideways ? box.width : box.height) * unit };
};
const close = (actual: readonly number[] | null | undefined, expected: readonly number[], within = 1e-3) => {
  expect(actual).not.toBeNull();
  expect(actual!.length).toBe(expected.length);
  actual!.forEach((v, i) => expect(Math.abs(v - expected[i]), `item ${i}: ${v} vs ${expected[i]}`).toBeLessThanOrEqual(within));
};
const numbers = (doc: PDFDocument, obj: PDFObject | undefined): number[] => {
  const a = doc.context.lookup(obj);
  return a instanceof PDFArray ? a.asArray().map((x) => (doc.context.lookup(x) as PDFNumber).asNumber()) : [];
};
const boxOf = (doc: PDFDocument, page: PDFPage, key: string) => numbers(doc, page.node.get(PDFName.of(key)));
const annots = (doc: PDFDocument, page: PDFPage): PDFDict[] => {
  const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return list ? list.asArray().map((a) => doc.context.lookup(a, PDFDict)) : [];
};
const subtypeOf = (d: PDFDict) => (d.get(PDFName.of('Subtype')) as PDFName).decodeText();
const run = async (bytes: Uint8Array, options: PageBoxOptions) => {
  const report = emptyPageBoxReport();
  const out = await changePageBoxes(bytes, options, { report });
  return { out, report, doc: await PDFDocument.load(out, { updateMetadata: false }) };
};

/** The scale and the displayed offset (px from the top-left at scale 1) a page of w x h gets on A4 in its own direction. */
function fitOnA4(w: number, h: number, opts: { enlarge?: boolean; marginPt?: number } = {}) {
  const [tw, th] = w > h ? [A4.height, A4.width] : [A4.width, A4.height];
  const m = opts.marginPt ?? 0;
  let s = Math.min((tw - 2 * m) / w, (th - 2 * m) / h);
  if (opts.enlarge === false) s = Math.min(1, s);
  return { s, tw, th, x: (tw - s * w) / 2, y: (th - s * h) / 2 };
}

describe('planPage: the geometry of one page', () => {
  it('fits a Letter page to A4, scaled to fit and centred, never stretched', () => {
    const plan = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }), resize(), 1);
    const s = A4.width / 612;
    expect(plan.kind).toBe('change');
    if (plan.kind !== 'change') return;
    expect(plan.box).toEqual({ x: 0, y: 0, width: A4.width, height: A4.height });
    close(plan.matrix, [s, 0, 0, s, 0, (A4.height - 792 * s) / 2]);
    expect(plan.clip).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    expect(plan.dropUserUnit).toBe(true);
  });

  it('leaves a page already that size, within 1 mm, as it is', () => {
    expect(planPage(shown({ x: 0, y: 0, width: 595.28, height: 841.89 }), resize(), 1).kind).toBe('keep');
    expect(planPage(shown({ x: 0, y: 0, width: 596, height: 843 }), resize(), 1).kind).toBe('keep');
    expect(planPage(shown({ x: 0, y: 0, width: 595.28, height: 841.89 + 1.1 * MM }), resize(), 1).kind).toBe('change');
    // A margin is asked for: every page is fitted inside it, A4 pages too.
    expect(planPage(shown({ x: 0, y: 0, width: 595.28, height: 841.89 }), resize({ margin: 10 * MM }), 1).kind).toBe('change');
  });

  it("keeps each page's direction unless told to make every page portrait or landscape", () => {
    const landscape = shown({ x: 0, y: 0, width: 841.89, height: 595.28 });
    expect(planPage(landscape, resize(), 1).kind).toBe('keep');
    const portrait = planPage(landscape, resize({ direction: 'portrait' }), 1);
    expect(portrait.kind).toBe('change');
    if (portrait.kind === 'change') {
      const s = A4.width / 841.89;
      expect(portrait.box).toEqual({ x: 0, y: 0, width: A4.width, height: A4.height });
      close(portrait.matrix, [s, 0, 0, s, 0, (A4.height - 595.28 * s) / 2]);
    }
    const letter = shown({ x: 0, y: 0, width: 612, height: 792 });
    const wide = planPage(letter, resize({ direction: 'landscape' }), 1);
    if (wide.kind !== 'change') throw new Error('expected a change');
    expect(wide.box).toEqual({ x: 0, y: 0, width: A4.height, height: A4.width });
    // A custom size typed landscape follows each page's direction too.
    const custom = planPage(letter, resize({ size: { width: 300 * MM, height: 200 * MM } }), 1);
    if (custom.kind !== 'change') throw new Error('expected a change');
    close([custom.box.width, custom.box.height], [200 * MM, 300 * MM]);
  });

  it('on a page turned 90 degrees, the new box is turned with it and the content is centred as displayed', () => {
    // Letter turned 90 shows landscape (792 x 612): it becomes A4 landscape as displayed.
    const plan = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }, 90), resize(), 2);
    if (plan.kind !== 'change') throw new Error('expected a change');
    const s = Math.min(A4.height / 792, A4.width / 612);
    expect(plan.box).toEqual({ x: 0, y: 0, width: A4.width, height: A4.height });
    close(plan.matrix, [s, 0, 0, s, 0, (A4.height - 792 * s) / 2]);
  });

  it('the content transform is always an upright uniform scale, whatever the turn, unit and offsets', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const unit of [1, 2, 0.5]) {
        const d = shown({ x: 37, y: -21, width: 400, height: 250 }, rotation, unit);
        const plan = planPage(d, resize({ margin: 7 }), 1);
        if (plan.kind !== 'change') throw new Error('expected a change');
        const [a, b, c, dd] = plan.matrix!;
        expect(Math.abs(b) + Math.abs(c)).toBeLessThan(1e-9);
        expect(a).toBeCloseTo(dd, 9);
        // The old visible box lands centred in the new box as displayed, inside the margin.
        const corners = [[37, -21], [437, 229]].map(([x, y]) => [a * x + plan.matrix![4], dd * y + plan.matrix![5]]);
        const left = Math.min(corners[0][0], corners[1][0]) - plan.box.x;
        const right = plan.box.x + plan.box.width - Math.max(corners[0][0], corners[1][0]);
        const bottom = Math.min(corners[0][1], corners[1][1]) - plan.box.y;
        const top = plan.box.y + plan.box.height - Math.max(corners[0][1], corners[1][1]);
        expect(left).toBeCloseTo(right, 6);
        expect(top).toBeCloseTo(bottom, 6);
        expect(Math.min(left, top)).toBeGreaterThanOrEqual(7 - 1e-6);
      }
    }
  });

  it('a page with /UserUnit 2 is scaled by its unit too, and loses the unit (the new size is in real points)', () => {
    const plan = planPage(shown({ x: 0, y: 0, width: 306, height: 396 }, 0, 2), resize(), 6);
    if (plan.kind !== 'change') throw new Error('expected a change');
    const s = A4.width / 612;
    close(plan.matrix, [2 * s, 0, 0, 2 * s, 0, (A4.height - 792 * s) / 2]);
    expect(plan.box).toEqual({ x: 0, y: 0, width: A4.width, height: A4.height });
    expect(plan.dropUserUnit).toBe(true);
  });

  it('a visible box away from the origin is moved to the new box; small pages are not enlarged when asked', () => {
    const d = shown({ x: 100, y: 110, width: 464, height: 664 });
    const plan = planPage(d, resize({ enlarge: false }), 5);
    if (plan.kind !== 'change') throw new Error('expected a change');
    close(plan.matrix, [1, 0, 0, 1, (A4.width - 464) / 2 - 100, (A4.height - 664) / 2 - 110]);
    expect(plan.clip).toEqual({ x: 100, y: 110, width: 464, height: 664 });
    const big = planPage(d, resize({ enlarge: true }), 5);
    if (big.kind !== 'change') throw new Error('expected a change');
    expect(big.matrix![0]).toBeCloseTo(Math.min(A4.width / 464, A4.height / 664), 9);
  });

  it('fits inside a margin on every side', () => {
    const m = 10 * MM;
    const plan = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }), resize({ margin: m }), 1);
    if (plan.kind !== 'change') throw new Error('expected a change');
    const s = Math.min((A4.width - 2 * m) / 612, (A4.height - 2 * m) / 792);
    close(plan.matrix, [s, 0, 0, s, (A4.width - 612 * s) / 2, (A4.height - 792 * s) / 2]);
  });

  it('trims each edge as the reader sees it, on upright, turned and offset pages, and mirrors left and right on even pages', () => {
    const t = trim(sides(10, 20, 30, 40));
    const upright = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }), t, 1);
    if (upright.kind !== 'change') throw new Error('expected a change');
    expect(upright).toMatchObject({ box: { x: 10, y: 40, width: 572, height: 732 }, matrix: null, clip: null, dropUserUnit: false });
    const turned = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }, 90), t, 1);
    if (turned.kind !== 'change') throw new Error('expected a change');
    // Turned 90: the displayed left is the bottom of the page's own space, the displayed bottom its right.
    expect(turned.box).toEqual({ x: 20, y: 10, width: 552, height: 752 });
    const half = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }, 180), t, 1);
    if (half.kind !== 'change') throw new Error('expected a change');
    expect(half.box).toEqual({ x: 30, y: 20, width: 572, height: 732 });
    const offset = planPage(shown({ x: 100, y: 110, width: 464, height: 664 }), t, 1);
    if (offset.kind !== 'change') throw new Error('expected a change');
    expect(offset.box).toEqual({ x: 110, y: 150, width: 424, height: 604 });
    const even = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }), trim(sides(10, 20, 30, 40), true), 2);
    if (even.kind !== 'change') throw new Error('expected a change');
    expect(even.box).toEqual({ x: 30, y: 40, width: 572, height: 732 });
    const odd = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }), trim(sides(10, 20, 30, 40), true), 3);
    if (odd.kind !== 'change') throw new Error('expected a change');
    expect(odd.box.x).toBe(10);
    const unit = planPage(shown({ x: 0, y: 0, width: 306, height: 396 }, 0, 2), t, 1);
    if (unit.kind !== 'change') throw new Error('expected a change');
    expect(unit.box).toEqual({ x: 5, y: 20, width: 286, height: 366 });
  });

  it('adds a margin outside the visible box and clips the content to the old box', () => {
    const plan = planPage(shown({ x: 100, y: 110, width: 464, height: 664 }), margin(sides(10, 20, 30, 40)), 1);
    if (plan.kind !== 'change') throw new Error('expected a change');
    expect(plan).toMatchObject({ box: { x: 90, y: 70, width: 504, height: 724 }, matrix: null, clip: { x: 100, y: 110, width: 464, height: 664 } });
    const turned = planPage(shown({ x: 0, y: 0, width: 612, height: 792 }, 270), margin(sides(10, 0, 0, 0)), 1);
    if (turned.kind !== 'change') throw new Error('expected a change');
    // Turned 270: the displayed left is the top of the page's own space.
    expect(turned.box).toEqual({ x: 0, y: 0, width: 612, height: 802 });
  });

  it('refuses a trim that leaves less than 10 mm of a page, and a page larger than a PDF allows, naming the page', () => {
    expect(() => planPage(shown({ x: 0, y: 0, width: 612, height: 792 }), trim(sides(300, 0, 300, 0)), 4)).toThrow(
      'Trimming that much leaves less than 10 mm of page 4. Use smaller values.',
    );
    expect(() => planPage(shown({ x: 0, y: 0, width: 14_000, height: 792 }), margin(sides(300, 0, 300, 0)), 2)).toThrow(
      'Page 2 would be larger than 5,080 mm, the largest page a PDF can have. Use a smaller margin.',
    );
  });
});

describe('pageBoxError: the options', () => {
  it('names the first problem in plain words', () => {
    expect(pageBoxError(resize(), 8)).toBeNull();
    expect(pageBoxError(resize({ pages: { from: 3, to: 9 } }), 8)).toBe('Enter a page range between 1 and 8, with the first page not after the last.');
    expect(pageBoxError(resize({ pages: { from: 5, to: 4 } }), 8)).toBe('Enter a page range between 1 and 8, with the first page not after the last.');
    expect(pageBoxError(resize({ size: { width: 5, height: 800 } }), 8)).toBe('Enter a page width and height from 10 to 5,080 mm.');
    expect(pageBoxError(resize({ size: { width: Number.NaN, height: 800 } }), 8)).toBe('Enter a page width and height from 10 to 5,080 mm.');
    expect(pageBoxError(resize({ direction: 'sideways' as never }), 8)).toBe("Choose whether pages keep their direction or all become portrait or landscape.");
    expect(pageBoxError(resize({ margin: 290 }), 8)).toBe('The margin leaves less than 10 mm for the page content. Use a smaller margin.');
    expect(pageBoxError(resize({ margin: -1 }), 8)).toBe('Enter a margin of 0 mm or more.');
    expect(pageBoxError(trim(sides(0, 0, 0, 0)), 8)).toBe('Enter how much to trim from at least one edge.');
    expect(pageBoxError(trim(sides(-1, 0, 0, 0)), 8)).toBe('Enter edges of 0 mm or more.');
    expect(pageBoxError(margin(sides(0, 0, 0, 0)), 8)).toBe('Enter the width of the margin for at least one edge.');
    expect(pageBoxError(margin(sides(600 * MM, 0, 0, 0)), 8)).toBe('Enter a margin of at most 500 mm on each edge.');
    expect(pageBoxError({ mode: 'stretch' } as never, 8)).toBe('Choose whether to resize the pages or to trim or add margins.');
  });
});

describe('changePageBoxes: resize', () => {
  it('makes every chosen page A4 as displayed, keeps each page turn, drops /UserUnit, and leaves the A4 page as it was', async () => {
    const { report, doc } = await run(bundle, resize());
    const source = await PDFDocument.load(bundle);
    expect(report.changed).toEqual([1, 2, 3, 4, 5, 6, 8]);
    expect(report.unchanged).toEqual([7]);
    doc.getPages().forEach((page, i) => {
      const d = displayedPage(page);
      const landscape = BUNDLE_PAGES[i].width > BUNDLE_PAGES[i].height;
      expect([d.width, d.height]).toEqual(landscape ? [A4.height, A4.width] : [A4.width, A4.height]);
      expect(page.getRotation().angle).toBe(BUNDLE_PAGES[i].rotate);
      if (i === 6) return;
      expect(boxOf(doc, page, 'CropBox')).toEqual(boxOf(doc, page, 'MediaBox'));
      expect(page.node.get(PDFName.of('UserUnit'))).toBeUndefined();
    });
    // Page 7 was A4 already: its dictionary and its content are what they were, to the byte.
    const before = source.getPage(6).node;
    const after = doc.getPage(6).node;
    expect(after.keys().map((k) => k.decodeText()).sort()).toEqual(before.keys().map((k) => k.decodeText()).sort());
    for (const key of before.keys()) {
      const a = source.context.lookup(before.get(key));
      const b = doc.context.lookup(after.get(key));
      if (a instanceof PDFRawStream) expect(Buffer.from((b as PDFRawStream).contents).equals(Buffer.from(a.contents))).toBe(true);
      else if (!(a instanceof PDFDict) && key.decodeText() !== 'Parent') expect(String(b)).toBe(String(a));
    }
  });

  it('draws the content of each resized page as the source content scaled and centred (pdf.js), for every turn, the offset boxes and /UserUnit', async () => {
    const { out } = await run(bundle, resize());
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      const spec = BUNDLE_PAGES[n - 1];
      const fit = fitOnA4(spec.width, spec.height);
      const inner = await renderPage(bundle, n, fit.s);
      const outer = await renderPage(out, n, 1);
      const where = placementOf(inner, outer, fit.x, fit.y);
      expect(Math.abs(where.best[0]), `page ${n} across`).toBeLessThanOrEqual(1);
      expect(Math.abs(where.best[1]), `page ${n} down`).toBeLessThanOrEqual(1);
      expect(where.mismatch, `page ${n}`).toBeLessThan(0.01);
      expect(where.atExpected, `page ${n}`).toBeLessThan(0.02);
      // Around the content the new page is white: nothing hidden before (page 5's red bars) shows now.
      expect(inkOutside(outer, fit.x, fit.y, inner.width, inner.height), `page ${n}`).toBe(0);
    }
  });

  it('a wrong placement fails the comparison (the check can tell 3 px apart)', async () => {
    const fit = fitOnA4(612, 792);
    const inner = await renderPage(bundle, 1, fit.s);
    const outer = await renderPage((await run(bundle, resize())).out, 1, 1);
    const right = placementOf(inner, outer, fit.x, fit.y);
    for (const [dx, dy] of [[3, 0], [0, 3], [-3, 0], [0, -3]]) {
      const wrong = placementOf(inner, outer, fit.x + dx, fit.y + dy);
      expect(wrong.atExpected).toBeGreaterThan(0.02);
      expect(wrong.atExpected).toBeGreaterThan(5 * right.atExpected);
    }
  });

  it('does not enlarge small pages when asked, and fits inside a margin', async () => {
    const { out } = await run(bundle, resize({ enlarge: false, margin: 15 * MM, pages: { from: 8, to: 8 } }));
    const spec = BUNDLE_PAGES[7];
    const fit = fitOnA4(spec.width, spec.height, { enlarge: false, marginPt: 15 * MM });
    expect(fit.s).toBe(1);
    const where = placementOf(await renderPage(bundle, 8, 1), await renderPage(out, 8, 1), fit.x, fit.y);
    expect(where.best.map(Math.abs).every((v) => v <= 1)).toBe(true);
    expect(where.mismatch).toBeLessThan(0.01);
  });

  it('moves links, the form field and comments with the content: each still covers its text', async () => {
    const { out } = await run(bundle, resize());
    for (const [n, texts] of [[1, [BUNDLE_TEXT.link3, BUNDLE_TEXT.chapter]], [2, [BUNDLE_TEXT.back]], [6, [BUNDLE_TEXT.unit]]] as const) {
      const spec = BUNDLE_PAGES[n - 1];
      const fit = fitOnA4(spec.width, spec.height);
      const before = await pdfjsPage(bundle, n, fit.s);
      const after = await pdfjsPage(out, n, 1);
      expect(after.boxes.length).toBe(before.boxes.length);
      after.boxes.forEach((a, i) => {
        const b = before.boxes[i];
        expect(a.subtype).toBe(b.subtype);
        close(a.box, [b.box[0] + fit.x, b.box[1] + fit.y, b.box[2] + fit.x, b.box[3] + fit.y], 0.75);
      });
      for (const text of texts) {
        const [x0, y0] = before.textAt(text);
        const [x1, y1] = after.textAt(text);
        close([x1, y1], [x0 + fit.x, y0 + fit.y], 0.75);
        // The text's baseline start lies inside a link box (the link still lands on it).
        expect(after.boxes.some((a) => a.subtype === 'Link' && x1 >= a.box[0] && x1 <= a.box[2] && y1 >= a.box[1] && y1 <= a.box[3]), text).toBe(true);
      }
    }
    // The field's box sits under its label as before.
    const fit = fitOnA4(612, 792);
    const field = (await pdfjsPage(out, 1, 1)).boxes.find((b) => b.fieldName === 'amount')!;
    close(field.box, [100 * fit.s + fit.x, (792 - 424) * fit.s + fit.y, 300 * fit.s + fit.x, (792 - 400) * fit.s + fit.y], 0.75);
  });

  it('transforms every coordinate an annotation holds, scales widths and the field text size, and flags a kind it does not know', async () => {
    const { report, doc } = await run(bundle, resize({ pages: { from: 1, to: 1 } }));
    const fit = fitOnA4(612, 792);
    const k = fit.s;
    const f = fit.y;
    const at = (xs: number[]) => xs.map((v, i) => (i % 2 === 0 ? v * k : v * k + f));
    const page = doc.getPage(0);
    const byType = new Map(annots(doc, page).map((d) => [subtypeOf(d), d]));
    const link = annots(doc, page).find((d) => d.has(PDFName.of('QuadPoints')) && subtypeOf(d) === 'Link')!;
    const source = await PDFDocument.load(bundle);
    const sourceQuads = numbers(source, annots(source, source.getPage(0))[0].get(PDFName.of('QuadPoints')));
    expect(sourceQuads).toHaveLength(8);
    close(numbers(doc, link.get(PDFName.of('QuadPoints'))), at(sourceQuads));
    const square = byType.get('Square')!;
    close(numbers(doc, square.get(PDFName.of('Rect'))), at([400, 600, 520, 700]));
    close(numbers(doc, square.get(PDFName.of('RD'))), [2 * k, 2 * k, 2 * k, 2 * k]);
    expect((square.lookup(PDFName.of('BS'), PDFDict).get(PDFName.of('W')) as PDFNumber).asNumber()).toBeCloseTo(3 * k, 3);
    const ink = byType.get('Ink')!;
    const inkList = ink.lookup(PDFName.of('InkList'), PDFArray);
    close(numbers(doc, inkList.get(0)), at([302, 302, 350, 378, 398, 302]));
    const line = byType.get('Line')!;
    close(numbers(doc, line.get(PDFName.of('L'))), at([100, 200, 300, 250]));
    expect((line.get(PDFName.of('LL')) as PDFNumber).asNumber()).toBeCloseTo(10 * k, 3);
    close(numbers(doc, byType.get('Highlight')!.get(PDFName.of('QuadPoints'))), at([100, 520, 250, 520, 100, 500, 250, 500]));
    close(numbers(doc, byType.get('Popup')!.get(PDFName.of('Rect'))), at([420, 450, 580, 560]));
    close(numbers(doc, byType.get('Weird')!.get(PDFName.of('Rect'))), at([450, 100, 500, 150]));
    // The widget takes its text size from its field: the scaled size is set on the widget, the field keeps its own.
    const widget = byType.get('Widget')!;
    const da = (widget.get(PDFName.of('DA')) as PDFString).decodeText();
    expect(da).toMatch(/^\/Helv ([\d.]+) Tf 0 g$/);
    expect(Number(/\/Helv ([\d.]+) Tf/.exec(da)![1])).toBeCloseTo(12 * k, 2);
    expect((widget.lookup(PDFName.of('Parent'), PDFDict).get(PDFName.of('DA')) as PDFString).decodeText()).toBe('/Helv 12 Tf 0 g');
    const bead = doc.context.lookup(page.node.lookup(PDFName.of('B'), PDFArray).get(0), PDFDict);
    close(numbers(doc, bead.get(PDFName.of('R'))), at([50, 50, 300, 300]));
    // The form value is the same and the field still belongs to the form.
    expect(doc.getForm().getTextField('amount').getText()).toBe('1,250.00');
    expect(report.approximate).toEqual([1]);
  });

  it('bookmarks, named destinations, links and the opening view still open the same spot of the content', async () => {
    const { doc, out } = await run(bundle, resize());
    const before = await pdfjsOutlineDests(bundle);
    const after = await pdfjsOutlineDests(out);
    expect(after.map((d) => [d.title, d.page])).toEqual(before.map((d) => [d.title, d.page]));
    const view = async (bytes: Uint8Array, page: number, scale: number) => pdfjsPage(bytes, page + 1, scale);
    for (const [i, item] of after.entries()) {
      const b = before[i];
      const kind = (b.dest![1] as { name: string }).name;
      const n = b.page!;
      const spec = BUNDLE_PAGES[n];
      const fit = n === 6 ? { s: 1, x: 0, y: 0 } : fitOnA4(spec.width, spec.height);
      const src = await view(bundle, n, fit.s);
      const res = await view(out, n, 1);
      const args = (d: unknown[]) => d.slice(2) as (number | null)[];
      if (kind === 'XYZ' && args(b.dest!)[0] !== null && args(b.dest!)[1] !== null) {
        const [x0, y0] = src.toView(args(b.dest!)[0]!, args(b.dest!)[1]!);
        const [x1, y1] = res.toView(args(item.dest!)[0]!, args(item.dest!)[1]!);
        close([x1, y1], [x0 + fit.x, y0 + fit.y], 0.5);
        expect(args(item.dest!)[2]).toBe(args(b.dest!)[2]);
      } else if (kind === 'FitR') {
        const [x0, y0] = src.toView(args(b.dest!)[0]!, args(b.dest!)[1]!);
        const [x1, y1] = res.toView(args(item.dest!)[0]!, args(item.dest!)[1]!);
        close([x1, y1], [x0 + fit.x, y0 + fit.y], 0.5);
      } else if (kind === 'FitH') {
        // The top of the view as displayed (page 5 is upright): the same line of the content.
        const y0 = src.toView(0, args(b.dest!)[0]!)[1];
        const y1 = res.toView(0, args(item.dest!)[0]!)[1];
        expect(Math.abs(y1 - (y0 + fit.y))).toBeLessThanOrEqual(0.5);
      }
    }
    // The XYZ of "Two" leaves its zoom unset; the unchanged page 7 keeps its numbers exactly.
    expect(after.find((d) => d.title === 'Two')!.dest![4]).toBeNull();
    expect(after.find((d) => d.title === 'Seven')!.dest!.slice(2)).toEqual([72, 800, 0]);
    // Named destinations in /Dests and /Names, the opening view, and the links' own destinations: the point
    // they name, as displayed, is the same point of the content (page n of the source drawn at its scale,
    // moved by its offset).
    const source = await PDFDocument.load(bundle);
    const samePoint = async (n: number, before: PDFArray, after: PDFArray, xy: [number, number] = [2, 3]) => {
      const spec = BUNDLE_PAGES[n - 1];
      const fit = fitOnA4(spec.width, spec.height);
      const at = (a: PDFArray, i: number) => (a.get(i) as PDFNumber).asNumber();
      const [x0, y0] = (await view(bundle, n - 1, fit.s)).toView(at(before, xy[0]), at(before, xy[1]));
      const [x1, y1] = (await view(out, n - 1, 1)).toView(at(after, xy[0]), at(after, xy[1]));
      close([x1, y1], [x0 + fit.x, y0 + fit.y], 0.5);
    };
    const destsOf = (d: PDFDocument) => d.catalog.lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('old'), PDFArray);
    await samePoint(2, destsOf(source), destsOf(doc));
    const openOf = (d: PDFDocument) => d.catalog.lookup(PDFName.of('OpenAction'), PDFArray);
    await samePoint(1, openOf(source), openOf(doc));
    const linkOf = (d: PDFDocument, page: number) => annots(d, d.getPage(page))[0].lookup(PDFName.of('Dest'), PDFArray);
    expect(linkOf(doc, 0).get(0)).toBe(doc.getPage(2).ref);
    await samePoint(3, linkOf(source, 0), linkOf(doc, 0));
    await samePoint(1, linkOf(source, 1), linkOf(doc, 1));
    await samePoint(1, linkOf(source, 1), linkOf(doc, 1), [4, 5]);
    const namedOf = (d: PDFDocument) => d.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray).lookup(1, PDFArray);
    const five = fitOnA4(464, 664);
    const y0 = (await view(bundle, 4, five.s)).toView(0, (namedOf(source).get(2) as PDFNumber).asNumber())[1];
    const y1 = (await view(out, 4, 1)).toView(0, (namedOf(doc).get(2) as PDFNumber).asNumber())[1];
    expect(Math.abs(y1 - (y0 + five.y))).toBeLessThanOrEqual(0.5);
  });

  it('carries the attachment, document properties, XMP and bookmarks; text stays text; only Producer changes', async () => {
    const { doc, out } = await run(bundle, resize());
    expect(doc.getTitle()).toBe('Bundle title');
    expect(doc.getAuthor()).toBe('Bundle author');
    expect(doc.getCreator()).toBe('Bundle creator');
    expect(doc.getProducer()).toBe('ICAI VERA');
    const files = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    expect((files.lookup(0) as PDFString).decodeText()).toBe('note.txt');
    const xmp = doc.context.lookup(doc.catalog.get(PDFName.of('Metadata'))) as PDFRawStream;
    expect(Buffer.from(xmp.contents).toString('latin1')).toContain('BundleXMP');
    expect((await pdfjsOutlineDests(out)).map((d) => d.title)).toEqual(['One', 'Two', 'Five', 'Six', 'Seven', 'Chapter']);
    const texts = await pageTexts(out);
    texts.forEach((t, i) => expect(t).toContain(`Box p${i + 1}`));
    expect(texts[0]).toContain(BUNDLE_TEXT.link3);
  });

  it('patterns are scaled with the content (their space is the page, not the drawing)', async () => {
    const src = await makePatternPdf();
    const { out } = await run(src, resize({ pages: { from: 1, to: 1 } }));
    const fit = fitOnA4(612, 792);
    const where = placementOf(await renderPage(src, 1, fit.s), await renderPage(out, 1, 1), fit.x, fit.y);
    expect(where.best.map(Math.abs).every((v) => v <= 1)).toBe(true);
    expect(where.mismatch).toBeLessThan(0.01);
  });

  const strays: StrayKind[] = ['unclosed-q', 'flip', 'scale', 'extra-q'];
  it.each(strays)('a page whose drawing leaves a %s behind is wrapped: its content is scaled and nothing escapes the new layout', async (kind) => {
    const src = await makeStrayPdf(kind);
    const report = emptyPageBoxReport();
    const out = await changePageBoxes(src, resize({ pages: { from: 1, to: 1 } }), { report });
    const fit = fitOnA4(612, 792);
    const inner = await renderPage(src, 1, fit.s);
    const outer = await renderPage(out, 1, 1);
    const where = placementOf(inner, outer, fit.x, fit.y);
    expect(where.best.map(Math.abs).every((v) => v <= 1)).toBe(true);
    expect(where.mismatch).toBeLessThan(0.01);
    expect(inkOutside(outer, fit.x, fit.y, inner.width, inner.height)).toBe(0);
    // More Q than q: kept and flagged, because readers differ on what a stray Q does.
    expect(report.damaged).toEqual(kind === 'extra-q' ? [1] : []);
  });

  it('a content array whose q opens in one stream and closes in another is wrapped whole', async () => {
    const src = await makeArrayContentPdf();
    const { out, doc, report } = await run(src, resize({ pages: { from: 1, to: 1 } }));
    const fit = fitOnA4(612, 792);
    const where = placementOf(await renderPage(src, 1, fit.s), await renderPage(out, 1, 1), fit.x, fit.y);
    expect(where.best.map(Math.abs).every((v) => v <= 1)).toBe(true);
    expect(where.mismatch).toBeLessThan(0.01);
    // The three original streams are kept as they are, between our two.
    expect(doc.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray).size()).toBe(5);
    expect(report.damaged).toEqual([]);
    expect((await pageTexts(out))[0]).toBe('Array');
  });

  it('pages outside the range are not touched; a file with nothing to change comes back as it was', async () => {
    const { doc, report } = await run(bundle, resize({ pages: { from: 2, to: 3 } }));
    expect(report.changed).toEqual([2, 3]);
    expect(displayedPage(doc.getPage(0)).width).toBe(612);
    const a4 = await makePdf('A', 3, { size: [595.28, 841.89] });
    const none = emptyPageBoxReport();
    expect(await changePageBoxes(a4, resize({ pages: { from: 1, to: 3 } }), { report: none })).toBe(a4);
    expect(none).toMatchObject({ changed: [], unchanged: [1, 2, 3] });
  });
});

describe('changePageBoxes: what else a changed page holds', () => {
  it('a changed page loses its print-production boxes and its stored thumbnail (both describe the old page); an untouched page keeps them', async () => {
    const doc = await PDFDocument.create();
    for (const size of [[612, 792], [595.28, 841.89]] as const) {
      const page = doc.addPage([...size]);
      for (const key of ['BleedBox', 'TrimBox', 'ArtBox']) page.node.set(PDFName.of(key), doc.context.obj([10, 10, size[0] - 10, size[1] - 10]));
      page.node.set(PDFName.of('Thumb'), doc.context.register(doc.context.stream('thumb', { Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })));
    }
    const src = await doc.save();
    for (const options of [resize({ pages: { from: 1, to: 2 } }), trim(sides(5, 5, 5, 5), false, { from: 1, to: 1 })]) {
      const { doc: out } = await run(src, options);
      const [changed, kept] = out.getPages();
      for (const key of ['BleedBox', 'TrimBox', 'ArtBox', 'Thumb']) expect(changed.node.has(PDFName.of(key)), key).toBe(false);
      expect(boxOf(out, changed, 'CropBox')).toEqual(boxOf(out, changed, 'MediaBox'));
      for (const key of ['BleedBox', 'TrimBox', 'ArtBox', 'Thumb']) expect(kept.node.has(PDFName.of(key)), key).toBe(true);
    }
  });

  it('keeps and flags what a resize cannot scale exactly: a measuring scale, viewports, a pattern a form without resources would take', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const measured = doc.addPage([612, 792]);
    measured.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Line', Rect: [10, 10, 200, 20], L: [10, 15, 200, 15], Measure: ctx.obj({ Type: 'Measure', Subtype: 'RL' }) })));
    const viewports = doc.addPage([612, 792]);
    viewports.node.set(PDFName.of('VP'), ctx.obj([ctx.obj({ Type: 'Viewport', BBox: [0, 0, 300, 300] })]));
    const patterned = doc.addPage([612, 792]);
    const bare = ctx.register(ctx.flateStream('/Pattern cs /P scn 0 0 100 100 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100] }));
    const pattern = ctx.register(ctx.obj({ PatternType: 2, Shading: ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0], Function: ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 }) }) }));
    patterned.node.set(PDFName.of('Resources'), ctx.obj({ Pattern: ctx.obj({ P: pattern }), XObject: ctx.obj({ X: bare }) }));
    patterned.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('/X Do')));
    doc.addPage([612, 792]); // a plain page: changed, not flagged
    const { report } = await run(await doc.save(), resize({ pages: { from: 1, to: 4 } }));
    expect(report.approximate).toEqual([1, 2, 3]);
    expect(report.changed).toEqual([1, 2, 3, 4]);
  });

  it('reads what the page content leaves open: stray closes, open states, text and marked content', () => {
    expect(contentBalance('Q Q 1 0 0 1 4 4 cm q')).toMatchObject({ stray: 2, end: -1 });
    expect(contentBalance('q q Q')).toMatchObject({ stray: 0, end: 1 });
    expect(contentBalance('BT (q) Tj /Span BMC 0 0 m 10 10 l')).toMatchObject({ stray: 0, end: 0, inText: true, marked: 1, pendingPath: true });
    expect(contentBalance('BI /W 1 /H 1 ID Q\u0001 EI Q')).toMatchObject({ stray: 1, end: -1 });
  });
});

describe('changePageBoxes: trim', () => {
  const cut = sides(36, 18, 54, 72);

  it('sets the visible box only: the content is not changed, and what is shown is the source less the trimmed edges (mirrored on even pages)', async () => {
    const source = await PDFDocument.load(bundle);
    const { out, doc, report } = await run(bundle, trim(cut, true, { from: 1, to: 6 }));
    expect(report.changed).toEqual([1, 2, 3, 4, 5, 6]);
    for (let n = 1; n <= 6; n++) {
      const spec = BUNDLE_PAGES[n - 1];
      const even = n % 2 === 0;
      const [l, t, r, b] = even ? [cut.right, cut.top, cut.left, cut.bottom] : [cut.left, cut.top, cut.right, cut.bottom];
      const d = displayedPage(doc.getPage(n - 1));
      close([d.width, d.height], [spec.width - l - r, spec.height - t - b], 0.01);
      const before = await renderPage(bundle, n, 1);
      const after = await renderPage(out, n, 1);
      // The result is the source seen through a window: shift the result by the trimmed left and top.
      const where = placementOf(after, before, l, t);
      expect(where.best.map(Math.abs).every((v) => v <= 1), `page ${n}`).toBe(true);
      expect(where.mismatch, `page ${n}`).toBeLessThan(0.01);
      // The content streams are the source's, byte for byte.
      const contents = (doc0: PDFDocument, i: number) => {
        const c = doc0.getPage(i).node.get(PDFName.of('Contents'));
        const v = doc0.context.lookup(c);
        return (v instanceof PDFArray ? v.asArray() : [c]).map((x) => Buffer.from((doc0.context.lookup(x) as PDFRawStream).contents).toString('hex')).join('|');
      };
      expect(contents(doc, n - 1)).toBe(contents(source, n - 1));
    }
  });

  it('after a trim, links and the form field still cover their text and label as displayed', async () => {
    const { out } = await run(bundle, trim(cut, true, { from: 1, to: 6 }));
    for (const [n, texts] of [[1, [BUNDLE_TEXT.link3, BUNDLE_TEXT.chapter]], [2, [BUNDLE_TEXT.back]], [6, [BUNDLE_TEXT.unit]]] as const) {
      const before = await pdfjsPage(bundle, n, 1);
      const after = await pdfjsPage(out, n, 1);
      const [l, t] = n % 2 === 0 ? [cut.right, cut.top] : [cut.left, cut.top];
      after.boxes.forEach((a, i) => close(a.box, [before.boxes[i].box[0] - l, before.boxes[i].box[1] - t, before.boxes[i].box[2] - l, before.boxes[i].box[3] - t], 0.75));
      for (const text of texts) {
        const [x, y] = after.textAt(text);
        close([x, y], [before.textAt(text)[0] - l, before.textAt(text)[1] - t], 0.75);
        expect(after.boxes.some((a) => a.subtype === 'Link' && x >= a.box[0] && x <= a.box[2] && y >= a.box[1] && y <= a.box[3]), text).toBe(true);
      }
    }
  });

  it('trimmed parts are hidden, not removed: their text can still be found in the file; comments wholly in a trimmed part are reported', async () => {
    const { out, report } = await run(bundle, trim(sides(0, 0, 0, 450), false, { from: 1, to: 1 }));
    // "Amount" (y 430) is now outside the page: pdf.js no longer shows or reads it, yet it is still in the file.
    expect((await pageTexts(out))[0]).not.toContain(BUNDLE_TEXT.field);
    expect(rawHaystack(out)).toContain(BUNDLE_TEXT.field);
    expect(report.hiddenAnnotations).toEqual([1]);
    const clean = emptyPageBoxReport();
    await changePageBoxes(bundle, trim(sides(10, 10, 10, 10), false, { from: 1, to: 1 }), { report: clean });
    expect(clean.hiddenAnnotations).toEqual([]);
  });
});

describe('changePageBoxes: add margins', () => {
  it('grows each page by the margins as displayed; the content stays where it was and only what was shown is shown', async () => {
    const add = sides(20, 30, 40, 50);
    const { out, doc } = await run(bundle, margin(add, false, { from: 1, to: 6 }));
    for (let n = 1; n <= 6; n++) {
      const spec = BUNDLE_PAGES[n - 1];
      const d = displayedPage(doc.getPage(n - 1));
      close([d.width, d.height], [spec.width + 60, spec.height + 80], 0.01);
      const inner = await renderPage(bundle, n, 1);
      const outer = await renderPage(out, n, 1);
      const where = placementOf(inner, outer, 20, 30);
      expect(where.best.map(Math.abs).every((v) => v <= 1), `page ${n}`).toBe(true);
      expect(where.mismatch, `page ${n}`).toBeLessThan(0.01);
      // The new margin is white: page 5's hidden red bars stay hidden.
      expect(inkOutside(outer, 20, 30, inner.width, inner.height), `page ${n}`).toBe(0);
    }
  });
});

describe('changePageBoxes: refusals, progress, Stop and a long file', () => {
  it('refuses before changing anything, naming the first page that cannot take the change', async () => {
    await expect(changePageBoxes(bundle, trim(sides(0, 0, 0, 0)))).rejects.toThrow('Enter how much to trim from at least one edge.');
    // Page 8 (80 mm wide) cannot lose 40 mm from each side; the pages before it could.
    await expect(changePageBoxes(bundle, trim(sides(40 * MM, 0, 40 * MM, 0)))).rejects.toThrow('Trimming that much leaves less than 10 mm of page 8. Use smaller values.');
    await expect(changePageBoxes(Uint8Array.from([1, 2, 3]), resize())).rejects.toThrow('This file could not be read as a PDF.');
  });

  it('500 pages of mixed sizes: progress page by page, a stop between pages, and the time it takes', async () => {
    const long = await makeLongPdf(500);
    const seen: number[] = [];
    const report: PageBoxReport = emptyPageBoxReport();
    const started = performance.now();
    const out = await changePageBoxes(long, resize({ pages: { from: 1, to: 500 } }), { report, onPage: (done, total) => { expect(total).toBe(500); seen.push(done); } });
    const ms = performance.now() - started;
    console.log(`[pageBox] 500 pages resized to A4 in ${Math.round(ms)} ms (${report.changed.length} changed, ${report.unchanged.length} already A4), ${out.byteLength} bytes`);
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(500);
    expect(seen.length).toBe(501);
    expect(report.changed.length).toBe(300);
    expect(ms).toBeLessThan(120_000);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(500);
    // A stop thrown from the progress hook ends the run between pages; nothing is returned.
    const stop = new Error('stopped');
    await expect(changePageBoxes(long, resize({ pages: { from: 1, to: 500 } }), { onPage: (done) => { if (done === 250) throw stop; } })).rejects.toBe(stop);
  });
});

// REV-A (15 November 2026): damaged page attributes, a page listed twice, the modification date.
describe('REV-A fixes in Resize or crop pages', () => {
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
  const twoPages = (extra: string) =>
    rawPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      `<< /Type /Page /Parent 2 0 R ${extra} /Contents 5 0 R >>`,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>',
      '<< /Length 13 >>\nstream\n0 0 m 1 1 l S\nendstream',
    ]);
  const A4: PageBoxOptions = { mode: 'resize', size: { width: PAPERS.a4.width, height: PAPERS.a4.height }, direction: 'keep', enlarge: true, margin: 0, pages: { from: 1, to: 1 } };

  it('S2: a page whose box or turn cannot be read is refused plainly, naming the page; odd annotations are read as none', async () => {
    for (const extra of ['', '/MediaBox [0 0 612]', '/MediaBox [0 0 612 792] /Rotate /Ninety']) {
      await expect(changePageBoxes(twoPages(extra), A4), extra).rejects.toMatchObject({
        name: 'PdfToolsError',
        code: 'invalid-page-box-options',
        message: 'Page 1 could not be read, so it cannot be changed. The file may be damaged.',
      });
    }
    const cycle = rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 2 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>']);
    await expect(changePageBoxes(cycle, A4)).rejects.toMatchObject({ code: 'invalid-page-box-options', message: expect.stringContaining('Page 1 could not be read') });
    const report = emptyPageBoxReport();
    const out = await changePageBoxes(twoPages('/MediaBox [0 0 612 792] /Annots << >>'), A4, { report });
    expect(report.changed).toEqual([1]);
    expect((await PDFDocument.load(out)).getPage(0).getSize().width).toBeCloseTo(PAPERS.a4.width, 1);
  });

  it('S6: one page listed twice in the page tree is refused, naming both places', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const tree = doc.catalog.Pages();
    const kids = tree.lookup(PDFName.of('Kids'), PDFArray);
    kids.push(kids.get(0));
    tree.set(PDFName.of('Count'), PDFNumber.of(2));
    await expect(changePageBoxes(await doc.save(), { ...A4, pages: { from: 2, to: 2 } })).rejects.toMatchObject({
      code: 'invalid-page-box-options',
      message: 'Pages 1 and 2 are one page listed twice in this file, so they cannot be changed separately. The file may be damaged.',
    });
  });

  it('S12: the result gets our Producer and a new modification date; the source Creator stays', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([612, 792]);
    doc.setCreator('Tally');
    doc.setModificationDate(new Date('2020-01-01T00:00:00Z'));
    const out = await PDFDocument.load(await changePageBoxes(await doc.save(), A4), { updateMetadata: false });
    expect(out.getCreator()).toBe('Tally');
    expect(out.getProducer()).toBe('ICAI VERA');
    expect(out.getModificationDate()!.getFullYear()).toBeGreaterThan(2020);
  });
});

// FIX-A2 follow-up (INT3 concern 1): a Stop pressed while the file is still being read ends the run within the
// read, with the run's own error, never "could not be read".
describe('Resize or crop pages: Stop while the file is read', () => {
  class Stopped extends Error {}
  it('stops with the run’s own error', async () => {
    let clock = 0;
    // A clock that runs 60 ms between two looks at it: every look finds a turn due, so the read waits often.
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60));
    try {
      const stop = new Stopped('resize');
      const options: PageBoxOptions = { mode: 'resize', size: { width: PAPERS.a4.width, height: PAPERS.a4.height }, direction: 'keep', enlarge: true, margin: 0, pages: { from: 1, to: 2 } };
      const error = await changePageBoxes(await makePdf('R', 2), options, { check: () => { throw stop; } }).catch((e: unknown) => e);
      expect(error).toBe(stop);
    } finally {
      spy.mockRestore();
    }
  });
});
