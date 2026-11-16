// The Organise pages grid's keyboard (design 5.15): arrows move focus, Space chooses, Shift extends a
// range, the edit keys of organiseEdit.ts act on the chosen pages (or on the focused page when none is
// chosen), Delete on removed pages restores them, Enter opens the page viewer, and VERA Tools' tab keys
// are held back while the grid has focus.
import { describe, expect, it } from 'vitest';
import { createOrganiseState, organiseEditReducer, type OrganiseEditAction, type OrganiseEditState } from '../organiseEdit';
import { gridKey, type GridKeyInput } from './organiseKeys';

const key = (k: string, mods: Partial<GridKeyInput> = {}): GridKeyInput => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
const apply = (state: OrganiseEditState, actions: readonly OrganiseEditAction[]) => actions.reduce(organiseEditReducer, state);
const twelve = () => createOrganiseState(12);
const chosen = (state: OrganiseEditState) => [...state.chosen].sort((a, b) => a - b);

describe('focus moves', () => {
  it('Left, Right, Up, Down by the grid columns, Home and End; clamped at the edges; nothing chosen', () => {
    const s = twelve();
    expect(gridKey(key('ArrowRight'), s, 4, 5)).toEqual({ actions: [], focus: 5, handled: true });
    expect(gridKey(key('ArrowLeft'), s, 4, 5)).toEqual({ actions: [], focus: 3, handled: true });
    expect(gridKey(key('ArrowDown'), s, 4, 5).focus).toBe(9);
    expect(gridKey(key('ArrowDown'), s, 9, 5).focus).toBe(11); // into the last, shorter row
    expect(gridKey(key('ArrowUp'), s, 9, 5).focus).toBe(4);
    expect(gridKey(key('ArrowUp'), s, 2, 5).focus).toBe(2);
    expect(gridKey(key('ArrowLeft'), s, 0, 5).focus).toBe(0);
    expect(gridKey(key('ArrowRight'), s, 11, 5).focus).toBe(11);
    expect(gridKey(key('Home'), s, 7, 5).focus).toBe(0);
    expect(gridKey(key('End'), s, 1, 5).focus).toBe(11);
    expect(gridKey(key('PageDown'), s, 1, 5).focus).toBe(11);
    expect(gridKey(key('PageUp'), s, 11, 2).focus).toBe(3);
  });
  it('Ctrl + arrows move focus too (the choice stays)', () => {
    const s = apply(twelve(), [{ type: 'choose', index: 2, mode: 'only' }]);
    const out = gridKey(key('ArrowRight', { ctrlKey: true }), s, 2, 5);
    expect(out).toEqual({ actions: [], focus: 3, handled: true });
  });
});

describe('choosing', () => {
  it('Space toggles the focused page; Shift + Space chooses the range from the anchor', () => {
    let s = twelve();
    s = apply(s, gridKey(key(' '), s, 3, 5).actions);
    expect(chosen(s)).toEqual([3]);
    s = apply(s, gridKey(key(' ', { shiftKey: true }), s, 6, 5).actions);
    expect(chosen(s)).toEqual([3, 4, 5, 6]);
    s = apply(s, gridKey(key(' '), s, 6, 5).actions);
    expect(chosen(s)).toEqual([3, 4, 5]);
  });
  it('Shift + arrow moves focus and extends the range; with no anchor it starts at the focused page', () => {
    let s = twelve();
    let out = gridKey(key('ArrowRight', { shiftKey: true }), s, 2, 5);
    expect(out.focus).toBe(3);
    s = apply(s, out.actions);
    expect(chosen(s)).toEqual([2, 3]);
    out = gridKey(key('ArrowDown', { shiftKey: true }), s, 3, 5);
    s = apply(s, out.actions);
    expect(out.focus).toBe(8);
    expect(chosen(s)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    out = gridKey(key('Home', { shiftKey: true }), s, 8, 5);
    s = apply(s, out.actions);
    expect(chosen(s)).toEqual([0, 1, 2]);
  });
  it('Ctrl + A chooses every page', () => {
    const s = twelve();
    const out = gridKey(key('a', { ctrlKey: true }), s, 4, 5);
    expect(out.handled).toBe(true);
    expect(chosen(apply(s, out.actions))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('edits', () => {
  it('act on the chosen pages', () => {
    let s = apply(twelve(), [{ type: 'choose', index: 2, mode: 'only' }, { type: 'choose', index: 3, mode: 'toggle' }]);
    s = apply(s, gridKey(key('End', { altKey: true }), s, 3, 5).actions);
    expect(s.tiles.map((t) => t.source).slice(-2)).toEqual([2, 3]);
  });
  it('act on the focused page when nothing is chosen, which is not left chosen', () => {
    let s = twelve();
    const out = gridKey(key('r'), s, 5, 5);
    s = apply(s, out.actions);
    expect(s.tiles[5].turn).toBe(90);
    expect(chosen(s)).toEqual([]);
    s = apply(s, gridKey(key('ArrowLeft', { altKey: true }), s, 5, 5).actions);
    expect(s.tiles[4].source).toBe(5);
  });
  it('every key of organiseEdit.ts: Alt + Home/Left/Right/End, R, Shift + R, Delete, Ctrl + Z, Ctrl + Y, Ctrl + Shift + Z', () => {
    const s = apply(twelve(), [{ type: 'choose', index: 4, mode: 'only' }]);
    const first = (k: GridKeyInput) => gridKey(k, s, 4, 5).actions[0];
    expect(first(key('Home', { altKey: true }))).toEqual({ type: 'move', to: 'start' });
    expect(first(key('ArrowLeft', { altKey: true }))).toEqual({ type: 'move', to: 'earlier' });
    expect(first(key('ArrowRight', { altKey: true }))).toEqual({ type: 'move', to: 'later' });
    expect(first(key('End', { altKey: true }))).toEqual({ type: 'move', to: 'end' });
    expect(first(key('R', { shiftKey: true }))).toEqual({ type: 'turn', by: -90 });
    expect(first(key('r'))).toEqual({ type: 'turn', by: 90 });
    expect(first(key('Delete'))).toEqual({ type: 'remove' });
    expect(first(key('z', { ctrlKey: true }))).toEqual({ type: 'undo' });
    expect(first(key('y', { ctrlKey: true }))).toEqual({ type: 'redo' });
    expect(first(key('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'redo' });
  });
  it('Backspace (the Delete key of a Mac keyboard) works as Delete (P-review F11)', () => {
    const s = apply(twelve(), [{ type: 'choose', index: 4, mode: 'only' }]);
    expect(gridKey(key('Backspace'), s, 4, 5)).toEqual({ actions: [{ type: 'remove' }], handled: true });
    expect(gridKey(key('Backspace', { ctrlKey: true }), s, 4, 5).handled).toBe(false);
  });
  it('undo and redo never choose the focused page', () => {
    const s = twelve();
    expect(gridKey(key('z', { ctrlKey: true }), s, 4, 5).actions).toEqual([{ type: 'undo' }]);
  });
  it('Delete restores when every page it acts on is already removed; otherwise removes', () => {
    let s = apply(twelve(), [{ type: 'choose', index: 4, mode: 'only' }, { type: 'remove' }]);
    expect(gridKey(key('Delete'), s, 4, 5).actions).toEqual([{ type: 'restore' }]);
    s = apply(s, [{ type: 'choose', index: 5, mode: 'toggle' }]);
    expect(gridKey(key('Delete'), s, 5, 5).actions).toEqual([{ type: 'remove' }]);
    const none = apply(twelve(), [{ type: 'choose', index: 7, mode: 'only' }, { type: 'remove' }, { type: 'choose', index: 7, mode: 'toggle' }]);
    expect(gridKey(key('Delete'), none, 7, 5).actions).toEqual([{ type: 'choose', index: 7, mode: 'only' }, { type: 'restore' }, { type: 'choose', index: 7, mode: 'toggle' }]);
  });
});

describe('an edit key acts on the focused page, never on a page chosen earlier (review F1)', () => {
  const press = (state: OrganiseEditState, k: GridKeyInput, focus: number) => {
    const out = gridKey(k, state, focus, 5);
    return { state: apply(state, out.actions), focus: out.focus ?? focus };
  };
  const run = (keys: GridKeyInput[], start = twelve(), focus = 0) => keys.reduce((acc, k) => press(acc.state, k, acc.focus), { state: start, focus });

  it('Home, R, Right, Right, R rotates pages 1 and 3, each once, and leaves nothing chosen', () => {
    const { state } = run([key('Home'), key('r'), key('ArrowRight'), key('ArrowRight'), key('r')], twelve(), 4);
    expect(state.tiles.map((t) => t.turn).slice(0, 4)).toEqual([90, 0, 90, 0]);
    expect(chosen(state)).toEqual([]);
  });
  it('the same for Delete (removes pages 1 and 3) and for restoring them', () => {
    let { state } = run([key('Home'), key('Delete'), key('ArrowRight'), key('ArrowRight'), key('Delete')]);
    expect(state.tiles.filter((t) => t.removed).map((t) => t.source)).toEqual([0, 2]);
    expect(chosen(state)).toEqual([]);
    state = run([key('Home'), key('Delete'), key('ArrowRight'), key('ArrowRight'), key('Delete')], state).state;
    expect(state.tiles.some((t) => t.removed)).toBe(false);
  });
  it('the same for the move keys: Alt+Right moves the focused page, not one chosen before', () => {
    const { state } = run([key('Home'), key('ArrowRight', { altKey: true }), key('End'), key('ArrowLeft', { altKey: true })]);
    expect(state.tiles.map((t) => t.source)).toEqual([1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 11, 10]);
    expect(chosen(state)).toEqual([]);
  });
  it('pages the user chose stay chosen, and are not acted on, when the focused page is elsewhere', () => {
    let state = apply(twelve(), [{ type: 'choose', index: 5, mode: 'only' }, { type: 'choose', index: 6, mode: 'toggle' }]);
    state = press(state, key('r'), 9).state;
    expect(state.tiles.map((t) => t.turn)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 90, 0, 0]);
    expect(chosen(state)).toEqual([5, 6]);
    state = press(state, key('End', { altKey: true }), 2).state;
    expect(state.tiles.map((t) => t.source)).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 2]);
    expect(chosen(state)).toEqual([5, 6]);
  });
  it('when the focused page is chosen, the key acts on every chosen page', () => {
    let state = apply(twelve(), [{ type: 'choose', index: 5, mode: 'only' }, { type: 'choose', index: 6, mode: 'toggle' }]);
    state = press(state, key('r'), 6).state;
    expect(state.tiles.map((t) => t.turn).slice(4, 8)).toEqual([0, 90, 90, 0]);
    expect(chosen(state)).toEqual([5, 6]);
  });
});

describe('other keys', () => {
  it('Enter opens the viewer at the focused page', () => {
    expect(gridKey(key('Enter'), twelve(), 3, 5)).toEqual({ actions: [], view: true, handled: true });
  });
  it("VERA Tools' tab keys (Alt + Up/Down, Ctrl + 1-9) are held: handled, nothing done", () => {
    expect(gridKey(key('ArrowUp', { altKey: true }), twelve(), 3, 5)).toEqual({ actions: [], handled: true });
    expect(gridKey(key('ArrowDown', { altKey: true }), twelve(), 3, 5)).toEqual({ actions: [], handled: true });
    expect(gridKey(key('3', { ctrlKey: true }), twelve(), 3, 5)).toEqual({ actions: [], handled: true });
  });
  it('Tab, Escape, letters and Ctrl + R are left to the browser and the dialog', () => {
    for (const k of [key('Tab'), key('Tab', { shiftKey: true }), key('Escape'), key('x'), key('r', { ctrlKey: true }), key('F5')]) {
      expect(gridKey(k, twelve(), 3, 5)).toEqual({ actions: [], handled: false });
    }
  });
  it('an empty grid does nothing', () => {
    expect(gridKey(key('ArrowRight'), createOrganiseState(0), 0, 5)).toEqual({ actions: [], handled: false });
  });
});
