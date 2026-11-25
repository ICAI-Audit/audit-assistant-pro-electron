import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { cssRectToPdf, cssToPdf, normaliseRotation, pageBoxSize, pageTransform, pdfRectToCss, pdfToCss, viewerSurface, type PageGeometry } from './pageGeometry';
import type { ViewRotation } from './viewerMath';

// Loading pdf.js in beforeAll took over 10 s on a loaded machine (UX-GAP report).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

// Pages whose boxes do not start at 0,0 and that carry their own /Rotate, so the mapping is checked
// against everything pdf.js takes into account: the visible box (CropBox within MediaBox), its
// offset, the page's own turn and the view's extra turn.
interface Fixture {
  media: [number, number, number, number];
  crop?: [number, number, number, number];
  rotate: number;
  userUnit?: number;
}
const FIXTURES: Fixture[] = [
  { media: [0, 0, 595.28, 841.89], rotate: 0 },
  { media: [10, 20, 622, 812], rotate: 90 },
  { media: [-50, -40, 560, 760], crop: [30, 60, 400, 500], rotate: 180 },
  { media: [0, 0, 841.89, 595.28], crop: [100, 50, 700, 545], rotate: 270 },
  // An upside-down /Rotate value written as -90 and a crop box that pokes out of the media box.
  { media: [0, 0, 612, 792], crop: [-20, 100, 500, 900], rotate: -90 },
  // A large drawing with /UserUnit 2: each unit is two points.
  { media: [0, 0, 1000, 700], rotate: 90, userUnit: 2 },
];

type PdfjsPage = {
  view: number[];
  rotate: number;
  userUnit: number;
  getViewport(o: { scale: number; rotation?: number }): {
    transform: number[];
    width: number;
    height: number;
    convertToViewportPoint(x: number, y: number): number[];
    convertToPdfPoint(x: number, y: number): number[];
  };
};
let pages: PdfjsPage[] = [];

beforeAll(async () => {
  const doc = await PDFDocument.create();
  for (const f of FIXTURES) {
    const page = doc.addPage([100, 100]);
    page.setMediaBox(f.media[0], f.media[1], f.media[2] - f.media[0], f.media[3] - f.media[1]);
    if (f.crop) page.setCropBox(f.crop[0], f.crop[1], f.crop[2] - f.crop[0], f.crop[3] - f.crop[1]);
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(f.rotate));
    if (f.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(f.userUnit));
  }
  const bytes = await doc.save();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  pages = [];
  for (let n = 1; n <= pdf.numPages; n++) pages.push((await pdf.getPage(n)) as unknown as PdfjsPage);
});

const geometryOf = (page: PdfjsPage): PageGeometry => ({ view: page.view as unknown as PageGeometry['view'], rotate: normaliseRotation(page.rotate), userUnit: page.userUnit });
const TURNS: ViewRotation[] = [0, 90, 180, 270];
const SCALES = [0.25, 1, 1.7, 4];

describe('page geometry matches pdf.js', () => {
  it('the page box and transform equal pdf.js viewports for every page, turn and zoom', () => {
    let compared = 0;
    for (const page of pages) {
      const geometry = geometryOf(page);
      for (const turn of TURNS) {
        for (const scale of SCALES) {
          const viewport = page.getViewport({ scale, rotation: (page.rotate + turn) % 360 });
          const mine = pageTransform(geometry, scale, turn);
          mine.forEach((v, i) => expect(v).toBeCloseTo(viewport.transform[i], 9));
          const size = pageBoxSize(geometry, scale, turn);
          expect(size.width).toBeCloseTo(viewport.width, 9);
          expect(size.height).toBeCloseTo(viewport.height, 9);
          compared++;
        }
      }
    }
    expect(compared).toBe(FIXTURES.length * TURNS.length * SCALES.length);
    // The /UserUnit page really is twice the size.
    expect(pages[5].userUnit).toBe(2);
    expect(pageBoxSize(geometryOf(pages[5]), 1, 0).width).toBeCloseTo(1400, 9);
  });

  it('points map both ways as pdf.js maps them', () => {
    for (const page of pages) {
      const geometry = geometryOf(page);
      for (const turn of TURNS) {
        const viewport = page.getViewport({ scale: 1.7, rotation: (page.rotate + turn) % 360 });
        const m = pageTransform(geometry, 1.7, turn);
        for (const [x, y] of [
          [page.view[0], page.view[1]],
          [page.view[2], page.view[3]],
          [123.4, 456.7],
        ]) {
          const [cx, cy] = pdfToCss(m, x, y);
          const [px, py] = viewport.convertToViewportPoint(x, y);
          expect(cx).toBeCloseTo(px, 9);
          expect(cy).toBeCloseTo(py, 9);
          const [bx, by] = cssToPdf(m, cx, cy);
          expect(bx).toBeCloseTo(x, 9);
          expect(by).toBeCloseTo(y, 9);
          const [qx, qy] = viewport.convertToPdfPoint(cx, cy);
          expect(bx).toBeCloseTo(qx, 9);
          expect(by).toBeCloseTo(qy, 9);
        }
      }
    }
  });

  it("the visible box's corners land on the page box's corners", () => {
    for (const page of pages) {
      const geometry = geometryOf(page);
      for (const turn of TURNS) {
        const m = pageTransform(geometry, 2, turn);
        const box = pdfRectToCss(m, { x0: page.view[0], y0: page.view[1], x1: page.view[2], y1: page.view[3] });
        const size = pageBoxSize(geometry, 2, turn);
        expect(box.left).toBeCloseTo(0, 9);
        expect(box.top).toBeCloseTo(0, 9);
        expect(box.width).toBeCloseTo(size.width, 9);
        expect(box.height).toBeCloseTo(size.height, 9);
      }
    }
  });
});

describe('rectangles for a layer drawn over the page (Redact boxes)', () => {
  const geometry: PageGeometry = { view: [10, 20, 622, 812], rotate: 90 };

  it('a PDF rectangle becomes a CSS box with a positive size, and back', () => {
    for (const turn of TURNS) {
      const m = pageTransform(geometry, 1.5, turn);
      const rect = { x0: 100, y0: 700, x1: 220, y1: 730 };
      const box = pdfRectToCss(m, rect);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      // 120 x 30 pt at 1.5: 180 x 45 px, swapped on a quarter turn of the whole (90 + turn).
      const quarter = (90 + turn) % 180 === 90;
      expect(box.width).toBeCloseTo(quarter ? 45 : 180, 9);
      expect(box.height).toBeCloseTo(quarter ? 180 : 45, 9);
      const back = cssRectToPdf(m, box);
      expect(back.x0).toBeCloseTo(rect.x0, 9);
      expect(back.y0).toBeCloseTo(rect.y0, 9);
      expect(back.x1).toBeCloseTo(rect.x1, 9);
      expect(back.y1).toBeCloseTo(rect.y1, 9);
    }
  });

  it('the surface a layer mounts on carries the same mapping', () => {
    const surface = viewerSurface(4, geometry, 1.5, 180);
    expect(surface.pageIndex).toBe(4);
    expect(surface.turn).toBe(180);
    expect(surface.cssScale).toBe(1.5);
    expect(surface.width).toBeCloseTo(pageBoxSize(geometry, 1.5, 180).width, 9);
    expect(surface.height).toBeCloseTo(pageBoxSize(geometry, 1.5, 180).height, 9);
    const rect = { x0: 300, y0: 400, x1: 310, y1: 420 };
    expect(surface.rectToCss(rect)).toEqual(pdfRectToCss(pageTransform(geometry, 1.5, 180), rect));
    const [x, y] = surface.toCss(300, 400);
    const [bx, by] = surface.toPdf(x, y);
    expect(bx).toBeCloseTo(300, 9);
    expect(by).toBeCloseTo(400, 9);
  });

  it('rotation values are normalised to quarter turns', () => {
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(360)).toBe(0);
    expect(normaliseRotation(45)).toBe(0);
  });
});

// The 31 cases of the viewer trial (spike-viewer 4.5), each checked in Electron against the ink of a
// drawn rectangle (within 1 device pixel): the trial's seven pages (pdf-lib boxes as x, y, width,
// height), each at the four view turns, then page 5 at 200% and 400%, and page 6 at pixel ratio 1.
const TRIAL_PAGES: { rotate: number; media?: [number, number, number, number]; crop?: [number, number, number, number]; rect: { x0: number; y0: number; x1: number; y1: number } }[] = [
  { rotate: 0, rect: { x0: 100, y0: 600, x1: 220, y1: 640 } },
  { rotate: 90, rect: { x0: 100, y0: 600, x1: 220, y1: 640 } },
  { rotate: 180, rect: { x0: 100, y0: 600, x1: 220, y1: 640 } },
  { rotate: 270, rect: { x0: 100, y0: 600, x1: 220, y1: 640 } },
  { rotate: 90, crop: [50, 100, 400, 600], rect: { x0: 100, y0: 600, x1: 220, y1: 640 } },
  { rotate: 270, media: [-200, -300, 595.28, 841.89], rect: { x0: -100, y0: 300, x1: 20, y1: 340 } },
  { rotate: 0, crop: [150, 200, 300, 400], rect: { x0: 200, y0: 500, x1: 320, y1: 540 } },
];
const TRIAL_CASES: { page: number; turn: ViewRotation; zoom: number }[] = [
  ...[0, 1, 2, 3, 4, 5, 6].flatMap((page) => ([0, 90, 180, 270] as ViewRotation[]).map((turn) => ({ page, turn, zoom: 0 }))),
  { page: 4, turn: 90, zoom: 2 },
  { page: 4, turn: 90, zoom: 4 },
  { page: 5, turn: 90, zoom: 0.97 },
];

// The trial's table, written out on its own, for comparison.
function tableToCss(view: readonly number[], r: number, s: number, x: number, y: number): [number, number] {
  const [x0, y0, x1, y1] = view;
  if (r === 90) return [s * (y - y0), s * (x - x0)];
  if (r === 180) return [s * (x1 - x), s * (y - y0)];
  if (r === 270) return [s * (y1 - y), s * (x1 - x)];
  return [s * (x - x0), s * (y1 - y)];
}

describe('the viewer trial cases', () => {
  let trialPages: PdfjsPage[] = [];
  beforeAll(async () => {
    const { PDFDocument: Doc, degrees } = await import('pdf-lib');
    const doc = await Doc.create();
    for (const spec of TRIAL_PAGES) {
      const page = doc.addPage([595.28, 841.89]);
      if (spec.media) page.setMediaBox(...spec.media);
      if (spec.crop) page.setCropBox(...spec.crop);
      page.setRotation(degrees(spec.rotate));
    }
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: (await doc.save()).slice(), useSystemFonts: true, isEvalSupported: false }).promise;
    trialPages = [];
    for (let n = 1; n <= pdf.numPages; n++) trialPages.push((await pdf.getPage(n)) as unknown as PdfjsPage);
  });

  it('all 31: the mapping equals the table and pdf.js, both ways', () => {
    expect(TRIAL_CASES).toHaveLength(31);
    for (const c of TRIAL_CASES) {
      const page = trialPages[c.page];
      const geometry = geometryOf(page);
      const r = (page.rotate + c.turn) % 360;
      // Fit page in a 1252 x 772 frame (the trial's window less the viewer's bars) unless a zoom is given.
      const quarter = r % 180 === 90;
      const w = page.view[2] - page.view[0];
      const h = page.view[3] - page.view[1];
      const zoom = c.zoom || Math.min(1252 / (quarter ? h : w), 772 / (quarter ? w : h));
      const surface = viewerSurface(c.page, geometry, zoom, c.turn);
      const viewport = page.getViewport({ scale: zoom, rotation: r });
      const { rect } = TRIAL_PAGES[c.page];
      for (const [x, y] of [
        [rect.x0, rect.y0],
        [rect.x1, rect.y1],
      ]) {
        const [vx, vy] = surface.toCss(x, y);
        const [tx, ty] = tableToCss(page.view, r, zoom, x, y);
        const [px, py] = viewport.convertToViewportPoint(x, y);
        expect(Math.abs(vx - tx)).toBeLessThan(1e-9);
        expect(Math.abs(vy - ty)).toBeLessThan(1e-9);
        expect(Math.abs(vx - px)).toBeLessThan(1e-9);
        expect(Math.abs(vy - py)).toBeLessThan(1e-9);
        const [bx, by] = surface.toPdf(vx, vy);
        expect(Math.abs(bx - x)).toBeLessThan(1e-9);
        expect(Math.abs(by - y)).toBeLessThan(1e-9);
      }
      expect(surface.width).toBeCloseTo(viewport.width, 9);
      expect(surface.height).toBeCloseTo(viewport.height, 9);
    }
  });

  it("the trial's measured example: page 5 turned 90 more, 200%, 1.5 screen", () => {
    // View [50, 100, 450, 700], /Rotate 90 + view 90: (100, 600)-(220, 640) → CSS (460, 1000)-(700, 1080),
    // device (690, 1500)-(1050, 1620): the ink was measured exactly there.
    const page = trialPages[4];
    expect(page.view).toEqual([50, 100, 450, 700]);
    const surface = viewerSurface(4, geometryOf(page), 2, 90);
    const box = surface.rectToCss({ x0: 100, y0: 600, x1: 220, y1: 640 });
    expect(box).toEqual({ left: 460, top: 1000, width: 240, height: 80 });
    expect([box.left * 1.5, box.top * 1.5, (box.left + box.width) * 1.5, (box.top + box.height) * 1.5]).toEqual([690, 1500, 1050, 1620]);
  });

  it('a negative-origin box turned 270 maps as the table says', () => {
    const page = trialPages[5];
    expect(page.view.map((v) => Math.round(v * 100) / 100)).toEqual([-200, -300, 395.28, 541.89]);
    const s = 1.3;
    const [vx, vy] = viewerSurface(5, geometryOf(page), s, 0).toCss(-100, 300);
    expect(vx).toBeCloseTo(s * (page.view[3] - 300), 9);
    expect(vy).toBeCloseTo(s * (page.view[2] + 100), 9);
  });
});
