import { describe, expect, it, vi } from 'vitest';
import { attachDialogKeys, dialogKeyDecision, type GuardKeyEvent, type KeyPlace } from '../dialogKeys';
import { bookmarkKeyAction } from './bookmarkKeys';

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key: k,
  ctrlKey: Boolean(mods.ctrl),
  metaKey: Boolean(mods.meta),
  altKey: Boolean(mods.alt),
  shiftKey: Boolean(mods.shift),
});

// The Bookmarks dialog's keys go through the one shared guard (dialogKeys.ts, REV-B S13), with the dialog's own
// keys given by bookmarkKeyAction: the same decisions the dialog's own guard made before.
const decide = (event: ReturnType<typeof key>, place: KeyPlace) => dialogKeyDecision(event, place, bookmarkKeyAction);

describe('the Bookmarks dialog keeps the application’s shortcuts away, wherever its focus is', () => {
  it('Alt + an arrow moves, indents or outdents the chosen bookmark from anywhere in the dialog, and never reaches the application', () => {
    expect(decide(key('ArrowUp', { alt: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'up' });
    expect(decide(key('ArrowDown', { alt: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'down' });
    expect(decide(key('ArrowRight', { alt: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'indent' });
    expect(decide(key('ArrowLeft', { alt: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'outdent' });
  });

  it('Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo (Cmd too), and the application never sees them', () => {
    expect(decide(key('z', { ctrl: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'undo' });
    expect(decide(key('Z', { ctrl: true, shift: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'redo' });
    expect(decide(key('y', { ctrl: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'redo' });
    expect(decide(key('z', { meta: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: 'undo' });
    expect(decide(key('z', { ctrl: true, alt: true }), 'dialog')).toEqual({ stop: true, preventDefault: false, action: null });
  });

  it('in a text box the keys keep their own meaning (Ctrl+Z is the text’s undo) but still never reach the application', () => {
    expect(decide(key('z', { ctrl: true }), 'text')).toEqual({ stop: true, preventDefault: false, action: null });
    expect(decide(key('y', { ctrl: true }), 'text')).toEqual({ stop: true, preventDefault: false, action: null });
    expect(decide(key('ArrowLeft', { alt: true }), 'text')).toEqual({ stop: true, preventDefault: false, action: null });
    expect(decide(key('a', { ctrl: true }), 'text')).toEqual({ stop: true, preventDefault: false, action: null });
  });

  it('in a question, or with the focus nowhere, the keys are held: nothing happens', () => {
    expect(decide(key('ArrowUp', { alt: true }), 'hold')).toEqual({ stop: true, preventDefault: true, action: null });
    expect(decide(key('y', { ctrl: true }), 'hold')).toEqual({ stop: true, preventDefault: true, action: null });
  });

  it('the application’s own shortcuts (Ctrl + a letter, a digit, / or ?) are kept from it, the key’s own meaning left alone', () => {
    for (const k of ['d', 'y', 'b', 'o', '5', '/', '?']) {
      const decision = decide(key(k, { ctrl: true }), 'dialog');
      if (k === 'y') expect(decision.action).toBe('redo');
      else expect(decision, k).toEqual({ stop: true, preventDefault: false, action: null });
    }
    expect(decide(key('ArrowUp', { ctrl: true, alt: true }), 'dialog')).toEqual({ stop: true, preventDefault: false, action: null });
  });

  it('leaves every other key to the control that has focus, and keys outside the dialog to their own screen', () => {
    for (const k of ['ArrowUp', 'ArrowRight', 'Tab', 'Escape', 'Enter', 'F2', 'Delete', 'Insert', 'a']) {
      expect(decide(key(k), 'dialog'), k).toEqual({ stop: false, preventDefault: false, action: null });
    }
    expect(decide(key('Tab', { shift: true }), 'dialog').stop).toBe(false);
    expect(decide(key('ArrowUp', { alt: true }), 'outside')).toEqual({ stop: false, preventDefault: false, action: null });
    expect(decide(key('y', { ctrl: true }), 'outside')).toEqual({ stop: false, preventDefault: false, action: null });
  });

  it('attached on the window in the capture phase: stops what it decides, acts, and lets go', () => {
    const listeners = new Map<string, (event: GuardKeyEvent) => void>();
    const target = {
      addEventListener: vi.fn((type: string, fn: (event: GuardKeyEvent) => void, options: AddEventListenerOptions) => {
        expect(options.capture).toBe(true);
        listeners.set(type, fn);
      }),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    };
    const acted: string[] = [];
    const stop = attachDialogKeys(target, (t: unknown): KeyPlace => (t === 'tree' ? 'dialog' : 'outside'), { phase: 'capture', own: bookmarkKeyAction, act: (action) => acted.push(action) });
    const fire = (t: unknown, k: ReturnType<typeof key>) => {
      const event = { ...k, target: t, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      listeners.get('keydown')!(event);
      return event;
    };
    const inside = fire('tree', key('ArrowRight', { alt: true }));
    expect(inside.preventDefault).toHaveBeenCalled();
    expect(inside.stopPropagation).toHaveBeenCalled();
    expect(acted).toEqual(['indent']);
    const outside = fire('viewer', key('ArrowRight', { alt: true }));
    expect(outside.stopPropagation).not.toHaveBeenCalled();
    expect(acted).toEqual(['indent']);
    stop();
    expect(target.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    expect(listeners.size).toBe(0);
  });
});
