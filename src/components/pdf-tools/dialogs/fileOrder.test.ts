// The order of the files inside Merge and Images to PDF (UX audit C6.7, T2-6): moved one place at a time
// with the arrows or Alt + Up / Alt + Down, read out after each move, and run in the order shown.
import { describe, expect, it } from 'vitest';
import { dialogKeyDecision, type KeyFacts } from '../dialogKeys';
import { focusAfterMove, moveOne, orderAnnouncement, orderMoveKey } from './fileOrder';

const key = (k: string, mods: Partial<KeyFacts> = {}): KeyFacts => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

describe('moveOne', () => {
  it('moves an item one place up or down, in a new list, leaving the given list as it was', () => {
    const files = ['A', 'B', 'C'];
    expect(moveOne(files, 1, 'up')).toEqual(['B', 'A', 'C']);
    expect(moveOne(files, 1, 'down')).toEqual(['A', 'C', 'B']);
    expect(files).toEqual(['A', 'B', 'C']);
  });

  it('does nothing past either end or for a place that is not in the list', () => {
    expect(moveOne(['A', 'B'], 0, 'up')).toBeNull();
    expect(moveOne(['A', 'B'], 1, 'down')).toBeNull();
    expect(moveOne(['A'], 0, 'down')).toBeNull();
    expect(moveOne(['A', 'B'], -1, 'down')).toBeNull();
    expect(moveOne(['A', 'B'], 2, 'up')).toBeNull();
    expect(moveOne([], 0, 'up')).toBeNull();
  });

  it('keeps every file exactly once whatever the moves, and the last file can be brought to the top', () => {
    let order: string[] = ['Two.pdf', 'Three.pdf', 'Cover.png', 'Appendix.pdf'];
    for (let at = 3; at > 0; at--) order = moveOne(order, at, 'up') ?? order;
    expect(order).toEqual(['Appendix.pdf', 'Two.pdf', 'Three.pdf', 'Cover.png']);
    order = moveOne(order, 1, 'down') ?? order;
    order = moveOne(order, 2, 'down') ?? order;
    expect(order).toEqual(['Appendix.pdf', 'Three.pdf', 'Cover.png', 'Two.pdf']);
    expect([...order].sort()).toEqual(['Appendix.pdf', 'Cover.png', 'Three.pdf', 'Two.pdf']);
  });

  it('moves the files themselves, so the run gets them in the order shown', () => {
    const a = { id: 'a', name: 'A.pdf' };
    const b = { id: 'b', name: 'B.pdf' };
    const moved = moveOne([a, b], 1, 'up');
    expect(moved).toEqual([b, a]);
    expect(moved?.[0]).toBe(b);
  });
});

describe('orderMoveKey', () => {
  it('Alt + Up and Alt + Down move the file whose row has the focus (as in the file list)', () => {
    expect(orderMoveKey(key('ArrowUp', { altKey: true }))).toBe('up');
    expect(orderMoveKey(key('ArrowDown', { altKey: true }))).toBe('down');
  });

  it('leaves every other key alone', () => {
    expect(orderMoveKey(key('ArrowUp'))).toBeNull();
    expect(orderMoveKey(key('ArrowDown'))).toBeNull();
    expect(orderMoveKey(key('ArrowLeft', { altKey: true }))).toBeNull();
    expect(orderMoveKey(key('ArrowRight', { altKey: true }))).toBeNull();
    expect(orderMoveKey(key('ArrowUp', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(orderMoveKey(key('ArrowUp', { altKey: true, metaKey: true }))).toBeNull();
    expect(orderMoveKey(key('ArrowDown', { altKey: true, shiftKey: true }))).toBeNull();
    expect(orderMoveKey(key('Home', { altKey: true }))).toBeNull();
  });

  it('the dialog frame keeps the same keys from the application (no VERA Tools tab change) without taking them from the dialog', () => {
    // The frame's guard listens on the document, after the dialog's own handlers (useDialogKeys.ts); for
    // Alt + Up in the dialog it stops the key there, so the window's tab shortcut never sees it.
    for (const k of ['ArrowUp', 'ArrowDown']) {
      expect(dialogKeyDecision(key(k, { altKey: true }), 'dialog')).toEqual({ stop: true, preventDefault: true, action: null });
    }
  });
});

describe('focusAfterMove', () => {
  it('keeps the focus on the same arrow while it can still be used, else on the other one', () => {
    expect(focusAfterMove('up', 1, 3)).toBe('up');
    expect(focusAfterMove('up', 0, 3)).toBe('down'); // now first: Move up is unavailable
    expect(focusAfterMove('down', 1, 3)).toBe('down');
    expect(focusAfterMove('down', 2, 3)).toBe('up'); // now last: Move down is unavailable
  });
});

describe('orderAnnouncement', () => {
  it('says where the file is now, in words a screen reader reads out politely', () => {
    expect(orderAnnouncement('Three.pdf', { moved: true, position: 1, total: 2 })).toBe('Three.pdf moved to position 1 of 2.');
    expect(orderAnnouncement('Cover.png', { moved: true, position: 3, total: 4 })).toBe('Cover.png moved to position 3 of 4.');
  });

  it('says why nothing moved at either end', () => {
    expect(orderAnnouncement('Three.pdf', { moved: false, position: 1, total: 2 })).toBe('Three.pdf is already first.');
    expect(orderAnnouncement('Two.pdf', { moved: false, position: 2, total: 2 })).toBe('Two.pdf is already last.');
  });
});
