import { describe, expect, it } from 'vitest';
import { viewerKeyAction, wheelZoom, WHEEL_STEP, type KeyInput } from './viewerKeys';

const key = (k: string, more: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  inTextField: false,
  fitsWidth: true,
  hasPages: true,
  ...more,
});

describe('viewer keys', () => {
  it('Ctrl + plus, minus and 0 zoom in, out and fit the page', () => {
    expect(viewerKeyAction(key('+', { ctrlKey: true }))).toBe('zoom-in');
    expect(viewerKeyAction(key('=', { ctrlKey: true }))).toBe('zoom-in');
    expect(viewerKeyAction(key('+', { ctrlKey: true, shiftKey: true }))).toBe('zoom-in');
    expect(viewerKeyAction(key('-', { ctrlKey: true }))).toBe('zoom-out');
    expect(viewerKeyAction(key('_', { ctrlKey: true, shiftKey: true }))).toBe('zoom-out');
    expect(viewerKeyAction(key('0', { ctrlKey: true }))).toBe('fit-page');
    expect(viewerKeyAction(key('=', { metaKey: true }))).toBe('zoom-in');
    // Also from the page number box.
    expect(viewerKeyAction(key('-', { ctrlKey: true, inTextField: true }))).toBe('zoom-out');
  });

  it('PgUp, PgDn, Home and End move between pages', () => {
    expect(viewerKeyAction(key('PageDown'))).toBe('next');
    expect(viewerKeyAction(key('PageUp'))).toBe('prev');
    expect(viewerKeyAction(key('Home'))).toBe('first');
    expect(viewerKeyAction(key('End'))).toBe('last');
  });

  it('Left and Right turn the page only while it fits the width; otherwise they scroll', () => {
    expect(viewerKeyAction(key('ArrowRight'))).toBe('next');
    expect(viewerKeyAction(key('ArrowLeft'))).toBe('prev');
    expect(viewerKeyAction(key('ArrowRight', { fitsWidth: false }))).toBeNull();
    expect(viewerKeyAction(key('ArrowLeft', { fitsWidth: false }))).toBeNull();
    expect(viewerKeyAction(key('ArrowDown'))).toBeNull();
  });

  it('an image has no pages to move between', () => {
    for (const k of ['PageDown', 'PageUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft']) expect(viewerKeyAction(key(k, { hasPages: false }))).toBeNull();
    expect(viewerKeyAction(key('=', { ctrlKey: true, hasPages: false }))).toBe('zoom-in');
  });

  it('typing in the page number box keeps its own keys', () => {
    for (const k of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) expect(viewerKeyAction(key(k, { inTextField: true }))).toBeNull();
    expect(viewerKeyAction(key('PageDown', { inTextField: true }))).toBe('next');
  });

  it('keys that would change the VERA Tools tab underneath are held back', () => {
    expect(viewerKeyAction(key('ArrowRight', { altKey: true }))).toBe('hold');
    expect(viewerKeyAction(key('ArrowUp', { altKey: true }))).toBe('hold');
    expect(viewerKeyAction(key('3', { ctrlKey: true }))).toBe('hold');
    expect(viewerKeyAction(key('PageDown', { altKey: true }))).toBe('hold');
  });

  it('everything else is left alone (Escape is the viewer key below)', () => {
    expect(viewerKeyAction(key('a'))).toBeNull();
    expect(viewerKeyAction(key('Tab'))).toBeNull();
    expect(viewerKeyAction(key(' '))).toBeNull();
  });
});

describe('Ctrl + wheel', () => {
  it('one notch of a mouse wheel is one zoom step, up to zoom in', () => {
    expect(wheelZoom(0, { ctrlKey: true, metaKey: false, deltaY: -100, deltaMode: 0 })).toEqual({ direction: 1, rest: 0 });
    expect(wheelZoom(0, { ctrlKey: true, metaKey: false, deltaY: 120, deltaMode: 0 })).toEqual({ direction: -1, rest: 0 });
    // Line mode (some mice): 3 lines is a notch.
    expect(wheelZoom(0, { ctrlKey: true, metaKey: false, deltaY: -3, deltaMode: 1 }).direction).toBe(1);
  });

  it('small trackpad pinch deltas add up before a step', () => {
    let rest = 0;
    const steps: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = wheelZoom(rest, { ctrlKey: true, metaKey: false, deltaY: -10, deltaMode: 0 });
      rest = r.rest;
      if (r.direction) steps.push(r.direction);
    }
    expect(steps).toEqual([1, 1]);
    expect(WHEEL_STEP).toBe(50);
  });

  it('without Ctrl the wheel scrolls', () => {
    expect(wheelZoom(30, { ctrlKey: false, metaKey: false, deltaY: -100, deltaMode: 0 })).toEqual({ direction: null, rest: 0 });
  });

  it('a change of direction starts counting again', () => {
    // 40 counted towards zooming out, then 30 towards zooming in: only the 30 is kept.
    expect(wheelZoom(-40, { ctrlKey: true, metaKey: false, deltaY: -30, deltaMode: 0 })).toEqual({ direction: null, rest: 30 });
    // The same direction adds up.
    expect(wheelZoom(-40, { ctrlKey: true, metaKey: false, deltaY: 30, deltaMode: 0 })).toEqual({ direction: -1, rest: 0 });
  });
});

describe('find', () => {
  it('Ctrl + F (or Cmd + F) opens the search, from the page or a text box, also for an image; F alone types', () => {
    expect(viewerKeyAction(key('f', { ctrlKey: true }))).toBe('find');
    expect(viewerKeyAction(key('F', { ctrlKey: true }))).toBe('find');
    expect(viewerKeyAction(key('F', { ctrlKey: true, shiftKey: true }))).toBe('find');
    expect(viewerKeyAction(key('f', { metaKey: true }))).toBe('find');
    expect(viewerKeyAction(key('f', { ctrlKey: true, inTextField: true }))).toBe('find');
    expect(viewerKeyAction(key('f', { ctrlKey: true, hasPages: false }))).toBe('find');
    expect(viewerKeyAction(key('f'))).toBeNull();
    expect(viewerKeyAction(key('f', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe('Escape', () => {
  it("is the viewer's own key wherever the focus is (the page, a text box, an image), except while an input method composes", () => {
    expect(viewerKeyAction(key('Escape'))).toBe('escape');
    expect(viewerKeyAction(key('Escape', { inTextField: true }))).toBe('escape');
    expect(viewerKeyAction(key('Escape', { hasPages: false }))).toBe('escape');
    expect(viewerKeyAction(key('Escape', { composing: true }))).toBeNull();
    expect(viewerKeyAction(key('Escape', { ctrlKey: true }))).toBeNull();
  });
});
