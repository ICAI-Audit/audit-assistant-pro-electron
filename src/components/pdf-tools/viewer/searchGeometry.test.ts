import { beforeAll, describe, expect, it, vi } from 'vitest';
import { degrees, PDFDocument, PDFName, PDFNumber, StandardFonts, type PDFFont } from 'pdf-lib';
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import { normaliseRotation, pageTransform, pdfRectToCss, pdfToCss, type PageGeometry } from './pageGeometry';
import { hitQuads, quadsBounds, type Quad } from './searchGeometry';
import { buildSearchPage, findInPage, foldQuery, type SearchPage } from './searchText';
import type { ViewRotation } from './viewerMath';

// Loading pdf.js in beforeAll takes over 10 s on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const STYLES: Record<string, FontStyleLike> = {
  f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false },
  v1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: true },
};
// Every character half an em wide at 100 px: an item of n characters at 12 pt is 6n points wide.
const halfEm = () => 50;

function item(str: string, transform: number[], more: Partial<TextItemLike> = {}): TextItemLike {
  const size = Math.hypot(transform[2], transform[3]);
  return { str, transform, width: str.length * size * 0.5, height: size, fontName: 'f1', hasEOL: false, ...more };
}

/** The [start, end) of the first hit of `query`. */
function firstHit(page: SearchPage, query: string): [number, number] {
  const r = findInPage(page, foldQuery(query), 1);
  expect(r.length).toBe(2);
  return [r[0], r[1]];
}

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe('where a hit is drawn: one item, every turn of the page and a box that does not start at 0,0', () => {
  // "Cash at Bank" at (100, 700), 12 pt: "Bank" is characters 8 to 12, so x 148 to 172; the line
  // runs from the descent (697.6) to the ascent (709.6).
  const page = buildSearchPage(0, [item('Cash at Bank', [12, 0, 0, 12, 100, 700])], STYLES);
  const [start, end] = firstHit(page, 'bank');
  const quads = hitQuads(page, start, end, halfEm);

  it('is one quad, on the baseline from the descent to the ascent', () => {
    expect(quads).toHaveLength(1);
    const box = quadsBounds(quads)!;
    close(box.x0, 148);
    close(box.x1, 172);
    close(box.y0, 697.6);
    close(box.y1, 709.6);
  });

  // The visible box starts at (50, 100); s = 1.5 CSS px per point.
  const view = [50, 100, 650, 900] as const;
  const s = 1.5;
  const expected: Record<ViewRotation, { left: number; top: number; width: number; height: number }> = {
    0: { left: s * (148 - 50), top: s * (900 - 709.6), width: s * 24, height: s * 12 },
    90: { left: s * (697.6 - 100), top: s * (148 - 50), width: s * 12, height: s * 24 },
    180: { left: s * (650 - 172), top: s * (697.6 - 100), width: s * 24, height: s * 12 },
    270: { left: s * (900 - 709.6), top: s * (650 - 172), width: s * 12, height: s * 24 },
  };
  for (const rotate of [0, 90, 180, 270] as ViewRotation[]) {
    it(`page /Rotate ${rotate}: the box on screen`, () => {
      const geometry: PageGeometry = { view, rotate };
      const css = pdfRectToCss(pageTransform(geometry, s, 0), quadsBounds(quads)!);
      for (const k of ['left', 'top', 'width', 'height'] as const) close(css[k], expected[rotate][k]);
    });
    it(`page /Rotate 0 turned ${rotate} in the viewer: the same box as /Rotate ${rotate}`, () => {
      const css = pdfRectToCss(pageTransform({ view, rotate: 0 }, s, rotate), quadsBounds(quads)!);
      for (const k of ['left', 'top', 'width', 'height'] as const) close(css[k], expected[rotate][k]);
    });
  }
});

describe('hits across items and lines', () => {
  it('a phrase over two lines is drawn as one quad per line', () => {
    const page = buildSearchPage(0, [item('Balance as per', [10, 0, 0, 10, 72, 700], { hasEOL: true }), item('books of account', [10, 0, 0, 10, 72, 686])], STYLES);
    const [start, end] = firstHit(page, 'per books');
    const quads = hitQuads(page, start, end, halfEm);
    expect(quads).toHaveLength(2);
    // "per" is characters 11 to 14 of the first line; "books" 0 to 5 of the second.
    close(quadsBounds([quads[0]])!.x0, 72 + 11 * 5);
    close(quadsBounds([quads[0]])!.x1, 72 + 14 * 5);
    close(quadsBounds([quads[1]])!.x0, 72);
    close(quadsBounds([quads[1]])!.x1, 72 + 5 * 5);
    close(quadsBounds([quads[1]])!.y0, 684);
  });

  it('spaces at the edges of a piece, and items of spaces only, get no highlight', () => {
    const page = buildSearchPage(0, [item('Total ', [10, 0, 0, 10, 72, 700]), item('   ', [10, 0, 0, 10, 102, 700]), item('due', [10, 0, 0, 10, 117, 700])], STYLES);
    const [start, end] = firstHit(page, 'total due');
    const quads = hitQuads(page, start, end, halfEm);
    expect(quads).toHaveLength(2);
    close(quadsBounds([quads[0]])!.x1, 72 + 5 * 5);
  });

  it('characters are placed by their widths in the fallback font, scaled to the width pdf.js gives the item', () => {
    // "iW": i is narrow (0.25 em), W wide (0.95 em); the item is drawn 10% wider than that.
    const widths = (ch: string) => (ch === 'i' ? 25 : 95);
    const page = buildSearchPage(0, [item('iW', [10, 0, 0, 10, 0, 0], { width: 1.1 * 12 })], STYLES);
    const [start, end] = firstHit(page, 'w');
    const box = quadsBounds(hitQuads(page, start, end, widths))!;
    close(box.x0, 2.5 * 1.1);
    close(box.x1, 12 * 1.1);
  });

  it('without a measure, or when the fallback widths do not fit the item, by character count', () => {
    const page = buildSearchPage(0, [item('iW', [10, 0, 0, 10, 0, 0], { width: 20 })], STYLES);
    const [start, end] = firstHit(page, 'w');
    close(quadsBounds(hitQuads(page, start, end))!.x0, 10);
    // 0.25 + 0.95 em = 12 pt against 20: too far apart to trust.
    close(quadsBounds(hitQuads(page, start, end, (ch) => (ch === 'i' ? 25 : 95)))!.x0, 10);
  });

  it('text drawn turned on the page gives a turned quad', () => {
    // Running up the page from (300, 200): direction (0, 1), up (-1, 0).
    const page = buildSearchPage(0, [item('Cash at Bank', [0, 12, -12, 0, 300, 200])], STYLES);
    const [start, end] = firstHit(page, 'bank');
    const [a, b, c, d] = hitQuads(page, start, end, halfEm)[0];
    // Start and end on the descent side (x = 300 + 0.2 * 12), then the ascent side (x = 300 - 0.8 * 12).
    for (const [p, x, y] of [[a, 302.4, 248], [b, 302.4, 272], [c, 290.4, 272], [d, 290.4, 248]] as [readonly [number, number], number, number][]) {
      close(p[0], x);
      close(p[1], y);
    }
  });

  it('vertical writing covers the whole item', () => {
    const page = buildSearchPage(0, [item('ABCD', [12, 0, 0, 12, 100, 700], { fontName: 'v1', height: 48, width: 12 })], STYLES);
    const [start, end] = firstHit(page, 'bc');
    const box = quadsBounds(hitQuads(page, start, end, halfEm))!;
    expect(box.y0).toBeLessThanOrEqual(700 - 48);
    expect(box.y1).toBeGreaterThanOrEqual(700);
  });
});

// The same, from a real file read by pdf.js: Helvetica text written by pdf-lib on pages with every
// /Rotate, boxes that do not start at 0,0, and text drawn turned. The hit's box must sit where pdf-lib
// drew the word, and land on screen where pdf.js's own viewport puts those points.
interface Fixture {
  media: [number, number, number, number];
  crop?: [number, number, number, number];
  rotate: number;
  at: [number, number];
  turnText?: number;
}
const FIXTURES: Fixture[] = [
  { media: [0, 0, 595.28, 841.89], rotate: 0, at: [100, 700] },
  { media: [50, 100, 650, 942], crop: [60, 120, 640, 900], rotate: 90, at: [150, 700] },
  { media: [-40, -30, 560, 812], rotate: 180, at: [20, 400] },
  { media: [0, 0, 841.89, 595.28], crop: [100, 50, 700, 545], rotate: 270, at: [200, 300] },
  { media: [0, 0, 595.28, 841.89], rotate: 0, at: [300, 200], turnText: 90 },
];
const LINE = 'Cash at Bank and in hand';

type PdfjsPage = {
  view: number[];
  rotate: number;
  getTextContent(): Promise<{ items: (TextItemLike | { type: string })[]; styles: Record<string, FontStyleLike> }>;
  getViewport(o: { scale: number; rotation?: number }): { convertToViewportPoint(x: number, y: number): number[] };
};
let pages: PdfjsPage[] = [];
let helvetica: PDFFont;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  helvetica = await doc.embedFont(StandardFonts.Helvetica);
  for (const f of FIXTURES) {
    const page = doc.addPage([100, 100]);
    page.setMediaBox(f.media[0], f.media[1], f.media[2] - f.media[0], f.media[3] - f.media[1]);
    if (f.crop) page.setCropBox(f.crop[0], f.crop[1], f.crop[2] - f.crop[0], f.crop[3] - f.crop[1]);
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(f.rotate));
    page.drawText(LINE, { x: f.at[0], y: f.at[1], size: 12, font: helvetica, rotate: degrees(f.turnText ?? 0) });
  }
  const bytes = await doc.save();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  pages = [];
  for (let n = 1; n <= pdf.numPages; n++) pages.push((await pdf.getPage(n)) as unknown as PdfjsPage);
});

describe('hits on pages read by pdf.js', () => {
  // Helvetica's own widths, as the application measures them in its fallback family.
  const measure = (ch: string) => helvetica.widthOfTextAtSize(ch, 100);

  FIXTURES.forEach((f, n) => {
    it(`page ${n + 1} (/Rotate ${f.rotate}${f.crop ? ', crop box' : ''}${f.turnText ? ', text turned' : ''}): the box is on the word, and on screen where pdf.js puts it`, async () => {
      const pdfPage = pages[n];
      const content = await pdfPage.getTextContent();
      const items = content.items.filter((i): i is TextItemLike => 'str' in i);
      const page = buildSearchPage(n, items, content.styles);
      const [start, end] = firstHit(page, 'BANK');
      const quads: Quad[] = hitQuads(page, start, end, measure);
      expect(quads).toHaveLength(1);
      // Along the line: from the end of "Cash at " to the end of "Cash at Bank", where pdf-lib drew them.
      const from = helvetica.widthOfTextAtSize('Cash at ', 12);
      const to = helvetica.widthOfTextAtSize('Cash at Bank', 12);
      const [dx, dy] = f.turnText ? [0, 1] : [1, 0];
      const along = (p: readonly [number, number]) => (p[0] - f.at[0]) * dx + (p[1] - f.at[1]) * dy;
      const across = (p: readonly [number, number]) => (p[0] - f.at[0]) * -dy + (p[1] - f.at[1]) * dx;
      const [a, b, c, d] = quads[0];
      expect(Math.abs(along(a) - from)).toBeLessThan(0.05);
      expect(Math.abs(along(d) - from)).toBeLessThan(0.05);
      expect(Math.abs(along(b) - to)).toBeLessThan(0.05);
      expect(Math.abs(along(c) - to)).toBeLessThan(0.05);
      // Across the line: below the baseline by the descent, above it by the ascent (12 pt type).
      expect(across(a)).toBeLessThanOrEqual(-0.1 * 12);
      expect(across(a)).toBeGreaterThanOrEqual(-0.35 * 12);
      expect(across(d)).toBeGreaterThanOrEqual(0.6 * 12);
      expect(across(d)).toBeLessThanOrEqual(1.1 * 12);
      // On screen, at every view turn: each corner where pdf.js's viewport puts it.
      const geometry: PageGeometry = { view: pdfPage.view as unknown as PageGeometry['view'], rotate: normaliseRotation(pdfPage.rotate) };
      for (const turn of [0, 90, 180, 270] as ViewRotation[]) {
        const viewport = pdfPage.getViewport({ scale: 1.75, rotation: (normaliseRotation(pdfPage.rotate) + turn) % 360 });
        const m = pageTransform(geometry, 1.75, turn);
        for (const corner of quads[0]) {
          const [x, y] = pdfToCss(m, corner[0], corner[1]);
          const [px, py] = viewport.convertToViewportPoint(corner[0], corner[1]);
          close(x, px, 6);
          close(y, py, 6);
        }
      }
    });
  });
});
