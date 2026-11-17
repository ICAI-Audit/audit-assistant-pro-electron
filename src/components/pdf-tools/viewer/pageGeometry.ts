// Where a point of a PDF page lands on the viewer's page box, and back: the single mapping for
// every layer drawn over the page (the Redact review's boxes, later previews). It is the formula
// table of the viewer trial (spike-viewer 4.5), which is pdf.js's PageViewport transform written
// out; in Electron it put a drawn rectangle's ink within 1 device pixel of the prediction in all 31
// rotation, crop and offset cases tried. Checked against pdf.js and those cases in
// pageGeometry.test.ts. No DOM or pdf.js here.
//
// With the visible box view = [x0, y0, x1, y1], r = (page /Rotate + view turn) mod 360 and
// s = zoom × UserUnit CSS pixels per point:
//
//   r     vx          vy          box width × height
//   0     s(x − x0)   s(y1 − y)   s(x1 − x0) × s(y1 − y0)
//   90    s(y − y0)   s(x − x0)   s(y1 − y0) × s(x1 − x0)
//   180   s(x1 − x)   s(y − y0)   s(x1 − x0) × s(y1 − y0)
//   270   s(y1 − y)   s(x1 − x)   s(y1 − y0) × s(x1 − x0)
//
// Rectangles map corner by corner, then min/max. A layer uses the page box's CSS size, never the
// drawing's pixels: a capped drawing is stretched to the same box, so boxes stay right at any zoom.
//
// Coordinates:
// - PDF user space: points, origin at the bottom-left of the page's coordinate system, y up. A
//   page's visible box (`view`, pdf.js `page.view`: the CropBox within the MediaBox) may start
//   anywhere, not only at 0,0.
// - CSS: pixels inside the page box shown on screen, origin at its top-left corner, y down. The page
//   box is the visible box after the page's own /Rotate and the viewer's view-only turn.
import type { ViewRotation } from './viewerMath';

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (the PDF and canvas convention). */
export type Matrix = readonly [number, number, number, number, number, number];

export interface PageGeometry {
  /** The visible box in PDF user space, [x0, y0, x1, y1] (pdf.js `page.view`). */
  view: readonly [number, number, number, number];
  /** The page's own /Rotate, as a quarter turn (pdf.js `page.rotate`). */
  rotate: ViewRotation;
  /** /UserUnit: points per unit, 1 unless the page says otherwise (pdf.js `page.userUnit`). */
  userUnit?: number;
}

/** A rectangle in PDF user space (the shape used by the Redact text model). */
export interface PdfRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A box in the page box's CSS pixels. */
export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A /Rotate value as pdf.js reads it: a multiple of 90 brought into 0–270; anything else is 0. */
export function normaliseRotation(degrees: number): ViewRotation {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) return 0;
  return ((((degrees % 360) + 360) % 360) as ViewRotation);
}

/** The PDF-to-CSS transform of the page box at `cssScale` CSS pixels per point with the view turned by `turn` (the table above). */
export function pageTransform(geometry: PageGeometry, cssScale: number, turn: ViewRotation = 0): Matrix {
  const [x0, y0, x1, y1] = geometry.view;
  const s = cssScale * (geometry.userUnit ?? 1);
  switch (normaliseRotation(geometry.rotate + turn)) {
    case 90: // vx = s(y − y0), vy = s(x − x0)
      return [0, s, s, 0, -s * y0, -s * x0];
    case 180: // vx = s(x1 − x), vy = s(y − y0)
      return [-s, 0, 0, s, s * x1, -s * y0];
    case 270: // vx = s(y1 − y), vy = s(x1 − x)
      return [0, -s, -s, 0, s * y1, s * x1];
    default: // vx = s(x − x0), vy = s(y1 − y)
      return [s, 0, 0, -s, -s * x0, s * y1];
  }
}

/** The page box's CSS size. */
export function pageBoxSize(geometry: PageGeometry, cssScale: number, turn: ViewRotation = 0): { width: number; height: number } {
  const [x0, y0, x1, y1] = geometry.view;
  const scale = cssScale * (geometry.userUnit ?? 1);
  const quarter = normaliseRotation(geometry.rotate + turn) % 180 === 90;
  const width = Math.abs(x1 - x0) * scale;
  const height = Math.abs(y1 - y0) * scale;
  return quarter ? { width: height, height: width } : { width, height };
}

export function pdfToCss(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function cssToPdf(m: Matrix, x: number, y: number): [number, number] {
  const det = m[0] * m[3] - m[1] * m[2];
  return [(x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / det, (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / det];
}

export function pdfRectToCss(m: Matrix, rect: PdfRect): CssRect {
  const [ax, ay] = pdfToCss(m, rect.x0, rect.y0);
  const [bx, by] = pdfToCss(m, rect.x1, rect.y1);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export function cssRectToPdf(m: Matrix, box: CssRect): PdfRect {
  const [ax, ay] = cssToPdf(m, box.left, box.top);
  const [bx, by] = cssToPdf(m, box.left + box.width, box.top + box.height);
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/**
 * What a layer drawn over the viewer's page receives: the page shown, its box size in CSS pixels and
 * the mapping both ways. The layer is placed at the page box's top-left corner with this size; the
 * drawing underneath is the same page at the same scale and turn.
 */
export interface ViewerSurface {
  /** Counted from 0. */
  pageIndex: number;
  geometry: PageGeometry;
  turn: ViewRotation;
  /** CSS pixels per point. */
  cssScale: number;
  width: number;
  height: number;
  transform: Matrix;
  toCss(x: number, y: number): [number, number];
  toPdf(x: number, y: number): [number, number];
  rectToCss(rect: PdfRect): CssRect;
  rectToPdf(box: CssRect): PdfRect;
}

export function viewerSurface(pageIndex: number, geometry: PageGeometry, cssScale: number, turn: ViewRotation): ViewerSurface {
  const transform = pageTransform(geometry, cssScale, turn);
  const { width, height } = pageBoxSize(geometry, cssScale, turn);
  return {
    pageIndex,
    geometry,
    turn,
    cssScale,
    width,
    height,
    transform,
    toCss: (x, y) => pdfToCss(transform, x, y),
    toPdf: (x, y) => cssToPdf(transform, x, y),
    rectToCss: (rect) => pdfRectToCss(transform, rect),
    rectToPdf: (box) => cssRectToPdf(transform, box),
  };
}
