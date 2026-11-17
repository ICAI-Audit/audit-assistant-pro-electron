import { describe, expect, it, vi } from 'vitest';
import { attachViewerKeys, type GuardEvent, type GuardTarget } from './viewerGuard';

// A window stand-in that records how listeners were added and lets the test dispatch to them.
function fakeWindow() {
  const listeners: { type: string; listener: (event: GuardEvent) => void; options: unknown }[] = [];
  const target: GuardTarget = {
    addEventListener: (type, listener, options) => listeners.push({ type, listener: listener as (event: GuardEvent) => void, options }),
    removeEventListener: (type, listener, options) => {
      const at = listeners.findIndex((l) => l.type === type && l.listener === listener && JSON.stringify(l.options) === JSON.stringify(options));
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  const dispatch = (type: string, event: GuardEvent) => {
    for (const l of [...listeners]) if (l.type === type) l.listener(event);
  };
  return { target, listeners, dispatch };
}

const PAGE_INPUT = { tag: 'INPUT' };
const BODY = { tag: 'BODY' };
const BUTTON = { tag: 'BUTTON' };

function key(k: string, more: Partial<GuardEvent> = {}): GuardEvent {
  return { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: BUTTON, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...more };
}

function setup(context: Partial<{ hasPages: boolean; fitsWidth: boolean }> = {}) {
  const win = fakeWindow();
  const act = vi.fn();
  const detach = attachViewerKeys(
    win.target,
    () => ({ hasPages: context.hasPages ?? true, fitsWidth: context.fitsWidth ?? true, isTextField: (t) => t === PAGE_INPUT }),
    act,
  );
  return { ...win, act, detach };
}

describe('the viewer keys, whatever has focus', () => {
  it('listens on the window in the capture phase, and the wheel listener is not passive', () => {
    const { listeners } = setup();
    expect(listeners.map((l) => [l.type, l.options])).toEqual([
      ['keydown', { capture: true }],
      ['wheel', { capture: true, passive: false }],
    ]);
  });

  it('Ctrl + minus, plus, = and 0 never reach the application: the viewer zooms instead, focus anywhere', () => {
    // Focus on the page body: a button that turned itself off can drop it there.
    for (const target of [BODY, BUTTON, PAGE_INPUT]) {
      const { dispatch, act } = setup();
      const cases: [GuardEvent, string][] = [
        [key('-', { ctrlKey: true, target }), 'zoom-out'],
        [key('+', { ctrlKey: true, shiftKey: true, target }), 'zoom-in'],
        [key('=', { ctrlKey: true, target }), 'zoom-in'],
        [key('0', { ctrlKey: true, target }), 'fit-page'],
        [key('_', { ctrlKey: true, shiftKey: true, target }), 'zoom-out'],
        [key('=', { metaKey: true, target }), 'zoom-in'],
      ];
      for (const [event, action] of cases) {
        dispatch('keydown', event);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(act).toHaveBeenLastCalledWith(action);
      }
    }
  });

  it("the viewer's page keys work with focus on the page body", () => {
    const { dispatch, act } = setup();
    const event = key('PageDown', { target: BODY });
    dispatch('keydown', event);
    expect(act).toHaveBeenCalledWith('next');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('keys VERA Tools uses to change tab are held back, with no viewer action', () => {
    const { dispatch, act } = setup();
    const event = key('ArrowRight', { altKey: true });
    dispatch('keydown', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
  });

  it("the application's own shortcuts never reach it while the viewer is open; what the key does by itself is left alone", () => {
    // Re-review 1: Ctrl+Y, S, D and B went to other screens behind the viewer, Ctrl+/ opened the
    // shortcuts list over it. Focus on the page body, a button or the page number box.
    for (const target of [BODY, BUTTON, PAGE_INPUT]) {
      const { dispatch, act } = setup();
      const keys: Partial<GuardEvent>[] = [
        { key: 'y', ctrlKey: true },
        { key: 's', ctrlKey: true },
        { key: 'd', ctrlKey: true },
        { key: 'b', ctrlKey: true },
        { key: '/', ctrlKey: true },
        { key: '?', ctrlKey: true, shiftKey: true },
        { key: 'C', ctrlKey: true, shiftKey: true },
        { key: 'k', metaKey: true },
        { key: 'o', ctrlKey: true, altKey: true },
        // In the page number box these keep their own meaning: only the application is kept out.
        { key: 'a', ctrlKey: true },
        { key: 'c', ctrlKey: true },
        { key: 'v', ctrlKey: true },
      ];
      for (const more of keys) {
        const event = key(more.key as string, { ...more, target });
        dispatch('keydown', event);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
      expect(act).not.toHaveBeenCalled();
    }
  });

  it('Shift or Alt pressed alone, and Alt with a letter (the window menu), are left alone', () => {
    const { dispatch } = setup();
    for (const [k, more] of [['Shift', { shiftKey: true }], ['Alt', { altKey: true }], ['f', { altKey: true }]] as const) {
      const event = key(k, more);
      dispatch('keydown', event);
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
  });

  it("typing and Tab are left alone (Escape is the viewer's own: below)", () => {
    const { dispatch, act } = setup();
    for (const k of ['a', 'Tab', 'ArrowLeft']) {
      const event = key(k, { target: PAGE_INPUT });
      dispatch('keydown', event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(act).not.toHaveBeenCalled();
  });

  it('Ctrl + wheel anywhere is kept from the application, but still reaches the page view to zoom it', () => {
    const { dispatch } = setup();
    const zoomWheel = { ctrlKey: true, metaKey: false, deltaY: -100, deltaMode: 0, target: BODY, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    dispatch('wheel', zoomWheel);
    expect(zoomWheel.preventDefault).toHaveBeenCalledTimes(1);
    expect(zoomWheel.stopPropagation).not.toHaveBeenCalled();
    const scroll = { ctrlKey: false, metaKey: false, deltaY: -100, deltaMode: 0, target: BODY, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    dispatch('wheel', scroll);
    expect(scroll.preventDefault).not.toHaveBeenCalled();
  });

  it('detaching removes both listeners', () => {
    const { listeners, detach, dispatch, act } = setup();
    detach();
    expect(listeners).toEqual([]);
    dispatch('keydown', key('-', { ctrlKey: true }));
    expect(act).not.toHaveBeenCalled();
  });
});

describe('Ctrl + F while the viewer is open', () => {
  it("opens the viewer's search wherever the focus is; neither the application nor the browser's own find sees it", () => {
    for (const target of [BODY, BUTTON, PAGE_INPUT]) {
      const { dispatch, act } = setup();
      for (const event of [key('f', { ctrlKey: true, target }), key('F', { ctrlKey: true, shiftKey: true, target }), key('f', { metaKey: true, target })]) {
        dispatch('keydown', event);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      }
      expect(act.mock.calls).toEqual([['find'], ['find'], ['find']]);
    }
  });
});

describe('Escape while the viewer is open', () => {
  it('is kept from every other layer (a tooltip, the tool dialog behind) and handed to the viewer, wherever the focus is', () => {
    for (const target of [BODY, BUTTON, PAGE_INPUT]) {
      const { dispatch, act } = setup();
      const event = key('Escape', { target });
      dispatch('keydown', event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      expect(act.mock.calls).toEqual([['escape']]);
    }
    // An image has no pages, and Escape still closes its viewer.
    const image = setup({ hasPages: false });
    image.dispatch('keydown', key('Escape', { target: BODY }));
    expect(image.act.mock.calls).toEqual([['escape']]);
  });

  it('is left to an input method that is composing (it cancels the composition)', () => {
    const { dispatch, act } = setup();
    const event = key('Escape', { target: PAGE_INPUT, isComposing: true });
    dispatch('keydown', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
  });
});
