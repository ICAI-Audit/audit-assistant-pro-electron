// Boxes drawn with the keyboard (plan A10: "a box can be drawn with the keyboard"): arrows move the box as
// the page is displayed, Shift by 10 pt, Alt changes its size; ids are random.
import { describe, expect, it } from 'vitest';
import { newBoxId, nudge } from './drawnBoxes';

const box = { x0: 100, y0: 500, x1: 220, y1: 516 };

describe('keyboard boxes', () => {
  it('moves along the page as displayed: 1 pt, Shift 10 pt', () => {
    expect(nudge(box, 'ArrowRight', false, false, 0)).toEqual({ x0: 101, y0: 500, x1: 221, y1: 516 });
    expect(nudge(box, 'ArrowDown', true, false, 0)).toEqual({ x0: 100, y0: 490, x1: 220, y1: 506 });
    // A page turned 90: displayed right is user +y.
    expect(nudge(box, 'ArrowRight', false, false, 90)).toEqual({ x0: 100, y0: 501, x1: 220, y1: 517 });
    expect(nudge(box, 'Tab', false, false, 0)).toBeNull();
  });

  it('Alt grows the far edge as displayed, and never makes the box smaller than 2 pt', () => {
    expect(nudge(box, 'ArrowRight', false, true, 0)).toEqual({ ...box, x1: 221 });
    expect(nudge(box, 'ArrowDown', false, true, 0)).toEqual({ ...box, y0: 499 });
    expect(nudge(box, 'ArrowRight', false, true, 90)).toEqual({ ...box, y1: 517 });
    expect(nudge({ x0: 0, y0: 0, x1: 2, y1: 2 }, 'ArrowLeft', false, true, 0)).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
  });

  it('gives random ids that never hold page content', () => {
    const a = newBoxId();
    expect(a).toMatch(/^d-/);
    expect(newBoxId()).not.toBe(a);
  });
});
