import { describe, expect, it, vi } from 'vitest';
import { bookmarkKeyAction, type BookmarkKeyAction } from './bookmarks/bookmarkKeys';
import { attachDialogKeys, dialogKeyDecision, frameEscape, ignoreHeldKey, isApplicationShortcut, isLostEscape, type GuardKeyEvent, type KeyFacts, type KeyPlace } from './dialogKeys';

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}): KeyFacts => ({
  key: k,
  ctrlKey: Boolean(mods.ctrl),
  metaKey: Boolean(mods.meta),
  altKey: Boolean(mods.alt),
  shiftKey: Boolean(mods.shift),
});

describe("dialogKeyDecision: the application's shortcuts never act behind an open dialog", () => {
  it('counts every Ctrl or Cmd key and Alt + an arrow, never a plain key, Alt + a letter or a lone Shift', () => {
    expect(isApplicationShortcut(key('y', { ctrl: true }))).toBe(true);
    expect(isApplicationShortcut(key('3', { meta: true }))).toBe(true);
    expect(isApplicationShortcut(key('ArrowRight', { alt: true }))).toBe(true);
    expect(isApplicationShortcut(key('a'))).toBe(false);
    expect(isApplicationShortcut(key('t', { alt: true }))).toBe(false);
    expect(isApplicationShortcut(key('Tab', { shift: true }))).toBe(false);
  });

  it("stops VERA's screens (Ctrl+Y, Ctrl+D, Ctrl+O), its tabs (Ctrl+3, Alt+arrows), the sidebar (Ctrl+B) and the list (Ctrl+/), in the dialog and when held", () => {
    for (const place of ['dialog', 'hold'] as KeyPlace[]) {
      for (const k of ['y', 'd', 'o', '3', 'b', '/', '?']) expect(dialogKeyDecision(key(k, { ctrl: true }), place)).toEqual({ stop: true, preventDefault: false, action: null });
      for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) expect(dialogKeyDecision(key(k, { alt: true }), place)).toEqual({ stop: true, preventDefault: true, action: null });
    }
  });

  it("in a text box the key keeps its own meaning (Ctrl+Z, Alt+Left) but still never reaches the application", () => {
    expect(dialogKeyDecision(key('z', { ctrl: true }), 'text')).toEqual({ stop: true, preventDefault: false, action: null });
    expect(dialogKeyDecision(key('ArrowLeft', { alt: true }), 'text')).toEqual({ stop: true, preventDefault: false, action: null });
    expect(dialogKeyDecision(key('b', { ctrl: true }), 'text')).toEqual({ stop: true, preventDefault: false, action: null });
  });

  it('leaves plain keys alone, and every key from outside the layer', () => {
    for (const k of ['Tab', 'Enter', 'Escape', 'ArrowDown', 'a', 'Delete']) expect(dialogKeyDecision(key(k), 'dialog').stop).toBe(false);
    expect(dialogKeyDecision(key('y', { ctrl: true }), 'outside').stop).toBe(false);
    expect(dialogKeyDecision(key('ArrowRight', { alt: true }), 'outside').stop).toBe(false);
  });

  it("the Bookmarks dialog's own keys (bookmarkKeyAction, now through this guard: REV-B S13) are the ones its old guard acted on", () => {
    const own = (k: KeyFacts): BookmarkKeyAction | null => {
      const command = k.ctrlKey || k.metaKey;
      if (k.altKey && !command) return ({ ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'indent', ArrowLeft: 'outdent' } as Record<string, BookmarkKeyAction>)[k.key] ?? null;
      if (!command || k.altKey) return null;
      const letter = k.key.toLowerCase();
      return letter === 'y' || (letter === 'z' && k.shiftKey) ? 'redo' : letter === 'z' ? 'undo' : null;
    };
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'z', 'Z', 'y', 'd', 'b', '5', '/', 'a', 'Tab', 'Enter'];
    const mods = [{}, { ctrl: true }, { meta: true }, { alt: true }, { shift: true }, { ctrl: true, shift: true }, { ctrl: true, alt: true }, { alt: true, shift: true }];
    for (const k of keys) {
      for (const m of mods) {
        const event = key(k, m);
        expect({ event, action: bookmarkKeyAction(event) }).toEqual({ event, action: own(event) });
      }
    }
  });
});

describe("frameEscape: what an Escape that reaches the tool dialog's own layer does", () => {
  it('closes the Stop question first when it is open or still appearing (Keep running), as the question would (WRAP / RedactDialog)', () => {
    expect(frameEscape({ stopQuestionOpen: true, phase: 'running' })).toBe('keep-running');
    expect(frameEscape({ stopQuestionOpen: true, phase: 'stopping' })).toBe('keep-running');
  });

  it('otherwise asks before stopping a run, waits while it stops, and closes an idle dialog', () => {
    expect(frameEscape({ stopQuestionOpen: false, phase: 'running' })).toBe('ask-to-stop');
    expect(frameEscape({ stopQuestionOpen: false, phase: 'stopping' })).toBe('wait');
    expect(frameEscape({ stopQuestionOpen: false, phase: 'idle' })).toBe('close');
  });
});

describe('ignoreHeldKey: a held key presses a button once', () => {
  it('cancels the repeats of Enter and Space only, never the first press or another key', () => {
    const press = (key: string, repeat: boolean) => {
      const event = { key, repeat, preventDefault: vi.fn() };
      ignoreHeldKey(event);
      return event.preventDefault.mock.calls.length;
    };
    expect(press('Enter', false)).toBe(0);
    expect(press(' ', false)).toBe(0);
    expect(press('Enter', true)).toBe(1);
    expect(press(' ', true)).toBe(1);
    expect(press('ArrowRight', true)).toBe(0);
  });
});

describe('attachDialogKeys', () => {
  function target() {
    const listeners: { listener: (event: GuardKeyEvent) => void; capture: boolean }[] = [];
    return {
      listeners,
      addEventListener: vi.fn((_type: string, listener: (event: GuardKeyEvent) => void, options: AddEventListenerOptions) => listeners.push({ listener, capture: Boolean(options.capture) })),
      removeEventListener: vi.fn(),
    };
  }
  const press = (k: KeyFacts, eventTarget: unknown = 'in') => ({ ...k, target: eventTarget, preventDefault: vi.fn(), stopPropagation: vi.fn() });

  it('listens in the phase asked for, stops what it decides, acts on the layer\'s own keys, and lets go', () => {
    const doc = target();
    const act = vi.fn();
    const detach = attachDialogKeys(doc, (t) => (t === 'in' ? 'dialog' : 'outside'), { phase: 'bubble', own: (k) => (k.key === 'F2' ? 'rename' : null), act });
    expect(doc.listeners[0].capture).toBe(false);
    const ctrlY = press(key('y', { ctrl: true }));
    doc.listeners[0].listener(ctrlY);
    expect(ctrlY.stopPropagation).toHaveBeenCalled();
    expect(ctrlY.preventDefault).not.toHaveBeenCalled();
    const altRight = press(key('ArrowRight', { alt: true }));
    doc.listeners[0].listener(altRight);
    expect(altRight.preventDefault).toHaveBeenCalled();
    const elsewhere = press(key('y', { ctrl: true }), 'out');
    doc.listeners[0].listener(elsewhere);
    expect(elsewhere.stopPropagation).not.toHaveBeenCalled();
    doc.listeners[0].listener(press(key('F2')));
    expect(act).toHaveBeenCalledWith('rename');
    detach();
    expect(doc.removeEventListener).toHaveBeenCalledWith('keydown', doc.listeners[0].listener, { capture: false });
    const win = target();
    attachDialogKeys(win, () => 'hold', { phase: 'capture' });
    expect(win.listeners[0].capture).toBe(true);
  });
});

describe('an Escape that no layer took (Radix counts neither layer as topmost while a tooltip appears)', () => {
  const escape = (over: Partial<KeyFacts & { defaultPrevented: boolean; isComposing: boolean }> = {}) => ({ ...key('Escape'), defaultPrevented: false, isComposing: false, ...over });

  it('is one with no modifier, not taken (not default-prevented), not composing, pressed anywhere the layer holds', () => {
    for (const place of ['dialog', 'text', 'hold'] as KeyPlace[]) expect(isLostEscape(escape(), place)).toBe(true);
    expect(isLostEscape(escape(), 'outside')).toBe(false);
    expect(isLostEscape(escape({ defaultPrevented: true }), 'dialog')).toBe(false); // a layer closed (or kept) itself
    expect(isLostEscape(escape({ isComposing: true }), 'text')).toBe(false); // an input method's own Escape
    expect(isLostEscape(escape({ shiftKey: true }), 'dialog')).toBe(false);
    expect(isLostEscape(escape({ ctrlKey: true }), 'dialog')).toBe(false);
    expect(isLostEscape({ ...key('Enter'), defaultPrevented: false }, 'dialog')).toBe(false);
  });

  it('is handed to the frame once, with its default cancelled, and a taken one is left alone', () => {
    const listeners: ((event: GuardKeyEvent) => void)[] = [];
    const doc = { addEventListener: (_t: string, l: (event: GuardKeyEvent) => void) => listeners.push(l), removeEventListener: vi.fn() };
    const lost = vi.fn();
    attachDialogKeys(doc, () => 'dialog', { phase: 'bubble', lostEscape: lost });
    const taken = { ...key('Escape'), defaultPrevented: true, target: 'in', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners[0](taken);
    expect(lost).not.toHaveBeenCalled();
    const dropped = { ...key('Escape'), defaultPrevented: false, target: 'in', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners[0](dropped);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(dropped.preventDefault).toHaveBeenCalled();
    // without the option nothing changes for Escape
    const plain: ((event: GuardKeyEvent) => void)[] = [];
    attachDialogKeys({ addEventListener: (_t: string, l: (event: GuardKeyEvent) => void) => plain.push(l), removeEventListener: vi.fn() }, () => 'dialog', { phase: 'bubble' });
    const alone = { ...key('Escape'), defaultPrevented: false, target: 'in', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    plain[0](alone);
    expect(alone.preventDefault).not.toHaveBeenCalled();
  });
});
