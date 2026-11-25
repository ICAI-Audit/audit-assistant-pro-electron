// Zoom, fit and drawing-size arithmetic of the page viewer. No DOM or pdf.js here, so it is
// unit-tested. Units: page sizes are PDF points as the reader sees the page (its own /Rotate
// applied); a CSS scale is CSS pixels per point; a drawing scale is device pixels per point. The
// zoom the user reads is actual size, as other PDF readers mean it: 100% is one point drawn as
// 96/72 CSS pixels (paper size on a 96 dpi screen), so a CSS scale of 4/3 reads "100%".
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE } from '../canvasUtils';

/** CSS pixels per point at 100%: a CSS inch is 96 px, a point 1/72 inch. */
export const CSS_PX_PER_PT = 96 / 72;

/** The zoom steps the user moves through, as zooms (1 = 100% = actual size). */
export const ZOOM_STEPS: readonly number[] = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
/** Design call (section 4): one viewer drawing holds at most 16 megapixels (64 MB). */
export const VIEWER_MAX_PIXELS = 16_000_000;
/** A new zoom is drawn this long after the last change; until then the previous drawing is stretched. */
export const RERENDER_DELAY_MS = 150;

/** `percent.value` is the zoom the user reads: 1 is 100% (actual size), 1.25 is 125%. */
export type ZoomMode = { kind: 'fit-width' } | { kind: 'fit-page' } | { kind: 'percent'; value: number };
export type ViewRotation = 0 | 90 | 180 | 270;

export interface Size {
  width: number;
  height: number;
}

export interface RenderPlan {
  /** Device pixels per point actually used. */
  scale: number;
  widthPx: number;
  heightPx: number;
  /** The caps took more than a tenth off the asked sharpness: the viewer says so. */
  reduced: boolean;
}

const EPSILON = 1e-6;
// Fit modes on extreme pages (a till roll, a postage stamp) stay within these.
const MIN_FIT = 0.02;
const MAX_FIT = 16;

/** A zoom step is at least this much bigger or smaller than the zoom it starts from (5%). */
const VISIBLE_STEP = 1.05;

/**
 * The next zoom step in that direction, at least a visible step away: a preset within 5% of the
 * zoom is passed over (fit width at 149.85% zooms in to 200%, not 150%; re-review 1). Near either
 * end, the end itself is still reached. Stays put at either end (zoom in never zooms out).
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    const visible = ZOOM_STEPS.find((step) => step > current * VISIBLE_STEP + EPSILON);
    const last = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    return visible ?? (last > current + EPSILON ? last : current);
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < current / VISIBLE_STEP - EPSILON) return ZOOM_STEPS[i];
  return ZOOM_STEPS[0] < current - EPSILON ? ZOOM_STEPS[0] : current;
}

/** The zoom the user reads for a CSS scale (1 = 100% = actual size). */
export function zoomOfScale(cssScale: number): number {
  return cssScale / CSS_PX_PER_PT;
}

/** The zoom reading, as a whole percent, for a CSS scale: 4/3 CSS pixels per point is 100%. */
export function zoomPercent(cssScale: number): number {
  return Math.round(zoomOfScale(cssScale) * 100);
}

/** CSS pixels per point for a zoom mode, for a page of `pagePt` (as displayed) in a frame of `framePx`. */
export function zoomFitScale(mode: ZoomMode, pagePt: Size, framePx: Size): number {
  if (mode.kind === 'percent') return mode.value * CSS_PX_PER_PT;
  const pageWidth = Math.max(1, pagePt.width);
  const pageHeight = Math.max(1, pagePt.height);
  const byWidth = Math.max(1, framePx.width) / pageWidth;
  const scale = mode.kind === 'fit-width' ? byWidth : Math.min(byWidth, Math.max(1, framePx.height) / pageHeight);
  return Math.min(MAX_FIT, Math.max(MIN_FIT, scale));
}

/**
 * The drawing for a page of `widthPt` x `heightPt` shown at `cssScale` on a screen of pixel ratio
 * `dpr`: zoom x pixel ratio, held within the canvas limits (8,192 px a side, 50 megapixels) and the
 * viewer's 16 megapixels. Rotation does not matter: every limit is the same for the turned page.
 */
export function renderPlan(widthPt: number, heightPt: number, cssScale: number, dpr: number): RenderPlan {
  const w = Math.max(1e-3, widthPt);
  const h = Math.max(1e-3, heightPt);
  const wanted = cssScale * dpr;
  const cap = Math.min(MAX_CANVAS_SIDE / Math.max(w, h), Math.sqrt(MAX_CANVAS_AREA / (w * h)), Math.sqrt(VIEWER_MAX_PIXELS / (w * h)));
  const scale = Math.min(wanted, cap);
  return {
    scale,
    widthPx: Math.max(1, Math.floor(w * scale)),
    heightPx: Math.max(1, Math.floor(h * scale)),
    reduced: scale < 0.9 * wanted,
  };
}

export function displayedSize(size: Size, turn: ViewRotation): Size {
  return turn === 90 || turn === 270 ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

export function turnView(current: ViewRotation, direction: 1 | -1): ViewRotation {
  return ((((current + direction * 90) % 360) + 360) % 360) as ViewRotation;
}

const NAMED_SIZES: readonly { name: string; width: number; height: number }[] = [
  { name: 'A3', width: 297, height: 420 },
  { name: 'A4', width: 210, height: 297 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'Letter', width: 215.9, height: 279.4 },
  { name: 'Legal', width: 215.9, height: 355.6 },
];
// Scanners and converters are often a point or two off the paper size.
const SIZE_TOLERANCE_MM = 1.5;
const MM_PER_PT = 25.4 / 72;

/** "A4 portrait, 210 × 297 mm"; other sizes as "106 × 141 mm". Width and height as the reader sees the page. */
export function pageSizeLabel(widthPt: number, heightPt: number): string {
  const w = widthPt * MM_PER_PT;
  const h = heightPt * MM_PER_PT;
  const mm = `${Math.round(w)} × ${Math.round(h)} mm`;
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const named = NAMED_SIZES.find((s) => Math.abs(s.width - short) <= SIZE_TOLERANCE_MM && Math.abs(s.height - long) <= SIZE_TOLERANCE_MM);
  if (!named || Math.abs(w - h) < EPSILON) return mm;
  return `${named.name} ${w > h ? 'landscape' : 'portrait'}, ${mm}`;
}

const count = new Intl.NumberFormat('en-IN');

export function imageSizeLabel(width: number, height: number): string {
  return `${count.format(width)} × ${count.format(height)} px`;
}

/** A typed page number, 1 to `total`, or null. */
export function pageFromInput(text: string, total: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= total ? n : null;
}

/**
 * Why a typed page number cannot be shown, in plain words (the page number boxes of the viewer and of
 * the Bookmarks dialog's page strip), or null when it can.
 */
export function pageJumpProblem(text: string, total: number): string | null {
  const trimmed = text.trim();
  if (pageFromInput(trimmed, total) !== null) return null;
  const last = Math.max(1, Math.floor(total));
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return `Type a page number from 1 to ${count.format(last)}.`;
  const asked = `There is no page ${count.format(Number(trimmed))}.`;
  return last === 1 ? `${asked} This file has one page.` : `${asked} Type a number from 1 to ${count.format(last)}.`;
}

/** Whether a picture of `w` × `h` has the shape of a box of `boxW` × `boxH` (within 3%). */
export function sameShape(w: number, h: number, boxW: number, boxH: number): boolean {
  if (!(w > 0 && h > 0 && boxW > 0 && boxH > 0)) return false;
  return Math.abs(w / h / (boxW / boxH) - 1) <= 0.03;
}

export interface ZoomScroll {
  /** The scroll box's scroll position before the zoom. */
  scroll: { left: number; top: number };
  /** The point to keep still, in the scroll box's own coordinates (from its top-left corner). */
  anchor: { x: number; y: number };
  /** The scroll box's inner size. */
  frame: Size;
  /** Space kept around the page inside the scroll box. */
  pad: number;
  /** The page's CSS size before and after. */
  before: Size;
  after: Size;
}

// The page sits `pad` from the edge, or centred when it is smaller than the box.
const pageOffset = (frame: number, page: number, pad: number) => Math.max(pad, (frame - page) / 2);

/** The scroll position after a zoom that keeps the page point under `anchor` where it was. */
export function scrollForZoom({ scroll, anchor, frame, pad, before, after }: ZoomScroll): { left: number; top: number } {
  const axis = (scrolled: number, at: number, frameSize: number, was: number, now: number) => {
    // A page that fits the box is centred in it: nothing to scroll.
    if (now + 2 * pad <= frameSize) return 0;
    const fraction = Math.min(1, Math.max(0, (scrolled + at - pageOffset(frameSize, was, pad)) / Math.max(1, was)));
    return Math.max(0, fraction * now + pageOffset(frameSize, now, pad) - at);
  };
  return {
    left: axis(scroll.left, anchor.x, frame.width, before.width, after.width),
    top: axis(scroll.top, anchor.y, frame.height, before.height, after.height),
  };
}
