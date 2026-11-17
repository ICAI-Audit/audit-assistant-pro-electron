import { describe, expect, it } from 'vitest';
import {
  CSS_PX_PER_PT,
  displayedSize,
  imageSizeLabel,
  pageFromInput,
  pageJumpProblem,
  pageSizeLabel,
  renderPlan,
  RERENDER_DELAY_MS,
  sameShape,
  scrollForZoom,
  stepZoom,
  turnView,
  VIEWER_MAX_PIXELS,
  ZOOM_STEPS,
  zoomFitScale,
  zoomOfScale,
  zoomPercent,
} from './viewerMath';

const A4 = { width: 595.28, height: 841.89 };

describe('zoom steps', () => {
  it('are the design steps, 25% to 400%', () => {
    expect(ZOOM_STEPS).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
    expect(VIEWER_MAX_PIXELS).toBe(16_000_000);
    expect(RERENDER_DELAY_MS).toBe(150);
  });

  it('step to the next value and stop at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    // A fit scale that is a step by a rounding error still moves on.
    expect(stepZoom(1.2500000001, 1)).toBe(1.5);
    expect(stepZoom(1.2499999999, -1)).toBe(1);
    // Outside the steps: zoom in never zooms out, and the reverse.
    expect(stepZoom(6, 1)).toBe(6);
    expect(stepZoom(6, -1)).toBe(4);
    expect(stepZoom(0.1, 1)).toBe(0.25);
    expect(stepZoom(0.1, -1)).toBe(0.1);
  });

  it('a step is always one the eye sees: a preset within 5% of the zoom is passed over', () => {
    // Re-review 1: fit width at 1280 x 720 reads 149.85%, and Zoom in went to 150% (nothing seemed to happen).
    expect(stepZoom(1.4985, 1)).toBe(2);
    expect(stepZoom(1.52, -1)).toBe(1.25);
    expect(stepZoom(1.4985, -1)).toBe(1.25);
    expect(stepZoom(0.98, 1)).toBe(1.25);
    // Near either end, the end itself is still reached.
    expect(stepZoom(3.9, 1)).toBe(4);
    expect(stepZoom(0.26, -1)).toBe(0.25);
  });

  it('100% is actual size, as other PDF readers mean it: one point is 96/72 CSS pixels', () => {
    expect(CSS_PX_PER_PT).toBeCloseTo(4 / 3, 12);
    // The reading takes the CSS scale of the page box.
    expect(zoomPercent(4 / 3)).toBe(100);
    expect(zoomPercent(1)).toBe(75);
    expect(zoomPercent(2.0494)).toBe(154);
    expect(zoomPercent(0.25)).toBe(19);
    expect(zoomOfScale(4 / 3)).toBeCloseTo(1, 12);
    expect(zoomOfScale(16 / 3)).toBeCloseTo(4, 12);
  });
});

describe('fit', () => {
  it('fit width and fit page give CSS pixels per point', () => {
    expect(zoomFitScale({ kind: 'fit-width' }, A4, { width: 1220, height: 700 })).toBeCloseTo(1220 / 595.28);
    expect(zoomFitScale({ kind: 'fit-page' }, A4, { width: 1220, height: 700 })).toBeCloseTo(700 / 841.89);
    // A wide frame and a landscape page: fit page is limited by the width.
    expect(zoomFitScale({ kind: 'fit-page' }, { width: 841.89, height: 595.28 }, { width: 800, height: 900 })).toBeCloseTo(800 / 841.89);
  });

  it('a percent zoom is turned into CSS pixels per point (1 = actual size)', () => {
    expect(zoomFitScale({ kind: 'percent', value: 1.5 }, A4, { width: 1220, height: 700 })).toBeCloseTo(2, 12);
    // A4 at 100% is 793 x 1122 CSS pixels: paper size on a 96 dpi screen.
    const actual = zoomFitScale({ kind: 'percent', value: 1 }, A4, { width: 1220, height: 700 });
    expect(Math.floor(595.28 * actual)).toBe(793);
    expect(Math.floor(841.89 * actual)).toBe(1122);
    // So 400% is 5.33 CSS pixels per point: A4 meets the 16 megapixel cap from pixel ratio 1.25.
    const at400 = zoomFitScale({ kind: 'percent', value: 4 }, A4, { width: 1220, height: 700 });
    expect(renderPlan(595.28, 841.89, at400, 1).reduced).toBe(false);
    expect(renderPlan(595.28, 841.89, at400, 1.25).reduced).toBe(true);
    expect(renderPlan(595.28, 841.89, at400, 1.5).reduced).toBe(true);
  });

  it('an unmeasured frame or an empty page never gives zero or infinity', () => {
    const tiny = zoomFitScale({ kind: 'fit-width' }, A4, { width: 0, height: 0 });
    expect(tiny).toBeGreaterThan(0);
    expect(Number.isFinite(tiny)).toBe(true);
    const empty = zoomFitScale({ kind: 'fit-page' }, { width: 0, height: 0 }, { width: 1220, height: 700 });
    expect(empty).toBeGreaterThan(0);
    expect(Number.isFinite(empty)).toBe(true);
  });
});

describe('render plan', () => {
  it('draws at zoom x pixel ratio when it fits', () => {
    expect(renderPlan(595.28, 841.89, 1, 1)).toEqual({ scale: 1, widthPx: 595, heightPx: 841, reduced: false });
  });

  it('caps A4 at 400% on a 1.5 screen at 16 megapixels, without calling it reduced', () => {
    const plan = renderPlan(595.28, 841.89, 4, 1.5);
    expect(plan.scale).toBeCloseTo(5.65, 2);
    expect(plan.widthPx * plan.heightPx).toBeLessThanOrEqual(16_000_000);
    expect(plan.reduced).toBe(false);
  });

  it('says reduced when the cap takes more than a tenth', () => {
    expect(renderPlan(595.28, 841.89, 4, 2).reduced).toBe(true);
  });

  it('keeps a long strip within 8192 px a side', () => {
    const plan = renderPlan(226, 2000, 2, 2);
    expect(plan.heightPx).toBeLessThanOrEqual(8192);
    expect(plan.widthPx).toBeLessThanOrEqual(8192);
  });

  it('never asks for an empty canvas', () => {
    const plan = renderPlan(0.5, 0.5, 0.25, 1);
    expect(plan.widthPx).toBeGreaterThanOrEqual(1);
    expect(plan.heightPx).toBeGreaterThanOrEqual(1);
  });

  it("the sizes measured in Electron (spike-viewer): A3 and A4 at 400% on a 1.5 screen", () => {
    const a3 = renderPlan(1190.55, 841.89, 4, 1.5);
    expect(Math.abs(a3.widthPx - 4756)).toBeLessThanOrEqual(1);
    expect(Math.abs(a3.heightPx - 3363)).toBeLessThanOrEqual(1);
    expect(a3.reduced).toBe(true);
    const a4 = renderPlan(595.28, 841.89, 4, 1.5);
    expect(Math.abs(a4.widthPx - 3363)).toBeLessThanOrEqual(1);
    expect(Math.abs(a4.heightPx - 4756)).toBeLessThanOrEqual(1);
    expect(a4.reduced).toBe(false);
  });
});

describe('page size label', () => {
  it('names the common sizes as the reader sees them', () => {
    expect(pageSizeLabel(595.28, 841.89)).toBe('A4 portrait, 210 × 297 mm');
    expect(pageSizeLabel(841.89, 595.28)).toBe('A4 landscape, 297 × 210 mm');
    expect(pageSizeLabel(612, 792)).toBe('Letter portrait, 216 × 279 mm');
    expect(pageSizeLabel(300, 400)).toBe('106 × 141 mm');
  });

  it('names a scan a few points off A4, and the other common sizes', () => {
    expect(pageSizeLabel(594.96, 841.92)).toBe('A4 portrait, 210 × 297 mm');
    expect(pageSizeLabel(841.89, 1190.55)).toBe('A3 portrait, 297 × 420 mm');
    expect(pageSizeLabel(419.53, 595.28)).toBe('A5 portrait, 148 × 210 mm');
    expect(pageSizeLabel(612, 1008)).toBe('Legal portrait, 216 × 356 mm');
  });

  it('an image is given in pixels', () => {
    expect(imageSizeLabel(4000, 3000)).toBe('4,000 × 3,000 px');
  });
});

describe('turning the view', () => {
  it('goes round in quarter turns', () => {
    expect(turnView(270, 1)).toBe(0);
    expect(turnView(0, -1)).toBe(270);
    expect(turnView(0, 1)).toBe(90);
    expect(turnView(180, -1)).toBe(90);
  });

  it('a quarter turn swaps the displayed width and height', () => {
    expect(displayedSize(A4, 0)).toEqual(A4);
    expect(displayedSize(A4, 180)).toEqual(A4);
    expect(displayedSize(A4, 90)).toEqual({ width: 841.89, height: 595.28 });
    expect(displayedSize(A4, 270)).toEqual({ width: 841.89, height: 595.28 });
  });
});

describe('typed page number', () => {
  it('accepts a whole number within the file', () => {
    expect(pageFromInput('3', 10)).toBe(3);
    expect(pageFromInput(' 10 ', 10)).toBe(10);
    expect(pageFromInput('0', 10)).toBeNull();
    expect(pageFromInput('11', 10)).toBeNull();
    expect(pageFromInput('2.5', 10)).toBeNull();
    expect(pageFromInput('', 10)).toBeNull();
    expect(pageFromInput('abc', 10)).toBeNull();
  });
});

describe('zoom keeps the point under the pointer', () => {
  it('a point in the middle of a page stays under the pointer', () => {
    // Page 600 x 800 at 1x in a 1000 x 700 frame with 24 px padding: centred horizontally (left 200).
    // The pointer is over page point (300, 400): client x 200 + 300 = 500, y 24 + 400 = 424 with scroll 0.
    const next = scrollForZoom({ scroll: { left: 0, top: 0 }, anchor: { x: 500, y: 424 }, frame: { width: 1000, height: 700 }, pad: 24, before: { width: 600, height: 800 }, after: { width: 1200, height: 1600 } });
    // After 2x the page is 1200 wide (left 24): page point (300, 400) is at content (24 + 600, 24 + 800).
    expect(next.left).toBeCloseTo(24 + 600 - 500);
    expect(next.top).toBeCloseTo(24 + 800 - 424);
  });

  it('never scrolls before the start, and not at all along a side where the page fits', () => {
    const next = scrollForZoom({ scroll: { left: 0, top: 0 }, anchor: { x: 10, y: 10 }, frame: { width: 1000, height: 700 }, pad: 24, before: { width: 1200, height: 1600 }, after: { width: 600, height: 800 } });
    expect(next.left).toBe(0);
    expect(next.top).toBeGreaterThanOrEqual(0);
    const fits = scrollForZoom({ scroll: { left: 300, top: 900 }, anchor: { x: 500, y: 350 }, frame: { width: 1000, height: 700 }, pad: 24, before: { width: 1200, height: 1600 }, after: { width: 500, height: 600 } });
    expect(fits).toEqual({ left: 0, top: 0 });
  });
});

describe('a thumbnail shown under a page still being drawn', () => {
  it('only when it has the shape of the page box', () => {
    // A 208 px wide A4 thumbnail under a 1189 px wide A4 page box.
    expect(sameShape(208, 294, 1189.4, 1682.1)).toBe(true);
    // A long strip's thumbnail is cut at four times its width: not the page's shape.
    expect(sameShape(208, 832, 226, 2000)).toBe(false);
    // A landscape page turned in the view: not the thumbnail's shape.
    expect(sameShape(208, 294, 1682, 1189)).toBe(false);
    expect(sameShape(0, 0, 100, 100)).toBe(false);
  });
});

describe('a typed page number that is not in the file', () => {
  it('says the range, in plain words', () => {
    expect(pageJumpProblem('212', 320)).toBeNull();
    expect(pageJumpProblem('400', 320)).toBe('There is no page 400. Type a number from 1 to 320.');
    expect(pageJumpProblem('0', 320)).toBe('There is no page 0. Type a number from 1 to 320.');
    expect(pageJumpProblem('', 320)).toBe('Type a page number from 1 to 320.');
    expect(pageJumpProblem('  ', 320)).toBe('Type a page number from 1 to 320.');
    expect(pageJumpProblem('3', 1)).toBe('There is no page 3. This file has one page.');
    expect(pageJumpProblem('12000', 12000)).toBeNull();
    expect(pageJumpProblem('12001', 12000)).toBe('There is no page 12,001. Type a number from 1 to 12,000.');
  });
});
