// The edit model behind the Organise pages dialog (plan Task B1, design 5.15): choosing, moving,
// turning, removing and restoring tiles, undo and redo, the keys, and what a screen reader hears.
import { describe, expect, it } from 'vitest';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import {
  createOrganiseState,
  hasChanges,
  ORGANISE_HISTORY_LIMIT,
  organiseEditReducer,
  organiseKeyAction,
  tileDescription,
  toPagePlan,
  type OrganiseEditAction,
  type OrganiseEditState,
} from './organiseEdit';

const run = (state: OrganiseEditState, ...actions: OrganiseEditAction[]) => actions.reduce(organiseEditReducer, state);
const order = (state: OrganiseEditState) => state.tiles.map((tile) => tile.source);
const chosen = (state: OrganiseEditState) => [...state.chosen].sort((a, b) => a - b);
const pick = (...positions: number[]): OrganiseEditAction[] => positions.map((index, i) => ({ type: 'choose', index, mode: i === 0 ? 'only' : 'toggle' }));
const five = () => createOrganiseState(5);

describe('the starting state', () => {
  it('holds every page in its own order, none turned or removed, nothing chosen, no history', () => {
    const state = five();
    expect(state.tiles).toEqual([0, 1, 2, 3, 4].map((source) => ({ source, turn: 0, removed: false })));
    expect(chosen(state)).toEqual([]);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(hasChanges(state)).toBe(false);
    expect(toPagePlan(state)).toEqual({ order: [0, 1, 2, 3, 4], turns: {} });
  });
});

describe('choosing', () => {
  it('only, toggle and range (from the tile last clicked alone or with Ctrl), by position; choosing is not an edit', () => {
    let state = run(five(), { type: 'choose', index: 1, mode: 'only' });
    expect(chosen(state)).toEqual([1]);
    state = run(state, { type: 'choose', index: 3, mode: 'toggle' });
    expect(chosen(state)).toEqual([1, 3]);
    state = run(state, { type: 'choose', index: 3, mode: 'range' });
    expect(chosen(state)).toEqual([3]);
    state = run(state, { type: 'choose', index: 0, mode: 'range' });
    expect(chosen(state)).toEqual([0, 1, 2, 3]);
    state = run(state, { type: 'choose', index: 1, mode: 'toggle' });
    expect(chosen(state)).toEqual([0, 2, 3]);
    state = run(state, { type: 'choose', index: 4, mode: 'range' });
    expect(chosen(state)).toEqual([1, 2, 3, 4]);
    expect(state.past).toEqual([]);
    expect(run(state, { type: 'choose', index: 9, mode: 'only' })).toBe(state);
  });

  it('a range with nothing chosen before chooses that tile alone', () => {
    expect(chosen(run(five(), { type: 'choose', index: 2, mode: 'range' }))).toEqual([2]);
  });

  it('the chosen tiles stay chosen when they move (chosen by page, not by place)', () => {
    const state = run(five(), ...pick(0), { type: 'move', to: 'end' });
    expect(order(state)).toEqual([1, 2, 3, 4, 0]);
    expect(chosen(state)).toEqual([0]);
    // a range now runs over the new places
    expect(chosen(run(state, { type: 'choose', index: 2, mode: 'range' }))).toEqual([0, 3, 4]);
  });
});

describe('moving', () => {
  it('to the end: two chosen tiles keep their relative order', () => {
    expect(order(run(five(), ...pick(1, 3), { type: 'move', to: 'end' }))).toEqual([0, 2, 4, 1, 3]);
    expect(order(run(five(), ...pick(3, 1), { type: 'move', to: 'end' }))).toEqual([0, 2, 4, 1, 3]);
  });

  it('to the start', () => {
    expect(order(run(five(), ...pick(4, 2), { type: 'move', to: 'start' }))).toEqual([2, 4, 0, 1, 3]);
  });

  it('earlier and later, one place, each run of chosen tiles together; a tile at the edge stays', () => {
    expect(order(run(five(), ...pick(2, 3), { type: 'move', to: 'earlier' }))).toEqual([0, 2, 3, 1, 4]);
    expect(order(run(five(), ...pick(0, 2), { type: 'move', to: 'earlier' }))).toEqual([0, 2, 1, 3, 4]);
    expect(order(run(five(), ...pick(1, 2), { type: 'move', to: 'later' }))).toEqual([0, 3, 1, 2, 4]);
    expect(order(run(five(), ...pick(4, 2), { type: 'move', to: 'later' }))).toEqual([0, 1, 3, 2, 4]);
  });

  it('to a position (from 0): the first chosen tile lands there, the others after it; positions past the end clamp', () => {
    expect(order(run(five(), ...pick(4), { type: 'move', to: 1 }))).toEqual([0, 4, 1, 2, 3]);
    expect(order(run(five(), ...pick(0, 1), { type: 'move', to: 2 }))).toEqual([2, 3, 0, 1, 4]);
    expect(order(run(five(), ...pick(0), { type: 'move', to: 99 }))).toEqual([1, 2, 3, 4, 0]);
    expect(order(run(five(), ...pick(3), { type: 'move', to: -4 }))).toEqual([3, 0, 1, 2, 4]);
  });

  it('dropping (drag and drop): the chosen tiles go into the gap before the tile now at that place', () => {
    expect(order(run(five(), ...pick(0), { type: 'drop', at: 3 }))).toEqual([1, 2, 0, 3, 4]);
    expect(order(run(five(), ...pick(4), { type: 'drop', at: 0 }))).toEqual([4, 0, 1, 2, 3]);
    expect(order(run(five(), ...pick(1, 3), { type: 'drop', at: 5 }))).toEqual([0, 2, 4, 1, 3]);
  });

  it('nothing chosen, or a move that changes nothing, makes no history entry', () => {
    const state = five();
    expect(run(state, { type: 'move', to: 'end' })).toBe(state);
    const first = run(state, ...pick(0));
    expect(run(first, { type: 'move', to: 'start' })).toBe(first);
    expect(run(first, { type: 'move', to: 'earlier' })).toBe(first);
  });
});

describe('turning, removing and restoring', () => {
  it('turns add up in quarters and wrap; removed tiles stay in place, marked, and come back', () => {
    let state = run(five(), ...pick(1, 2), { type: 'turn', by: 90 }, { type: 'turn', by: 90 });
    expect(state.tiles.map((t) => t.turn)).toEqual([0, 180, 180, 0, 0]);
    state = run(state, { type: 'turn', by: -90 }, { type: 'turn', by: -90 }, { type: 'turn', by: -90 });
    expect(state.tiles.map((t) => t.turn)).toEqual([0, 270, 270, 0, 0]);
    state = run(state, ...pick(2), { type: 'remove' });
    expect(order(state)).toEqual([0, 1, 2, 3, 4]);
    expect(state.tiles.map((t) => t.removed)).toEqual([false, false, true, false, false]);
    expect(toPagePlan(state)).toEqual({ order: [0, 1, 3, 4], turns: { 1: 270 } });
    state = run(state, { type: 'restore' });
    expect(toPagePlan(state)).toEqual({ order: [0, 1, 2, 3, 4], turns: { 1: 270, 2: 270 } });
  });

  it('a plan with every page removed is refused when it is made', () => {
    const state = run(five(), ...pick(0), { type: 'choose', index: 4, mode: 'range' }, { type: 'remove' });
    expect(hasChanges(state)).toBe(true);
    let error: unknown;
    try {
      toPagePlan(state);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).code).toBe('organise-all-removed');
    expect((error as PdfToolsError).message).toBe('You cannot remove every page. Keep at least one.');
  });

  it('the plan lists the kept pages in their new order, with the turns of kept pages only', () => {
    const state = run(five(), ...pick(4), { type: 'move', to: 'start' }, { type: 'turn', by: 90 }, ...pick(1), { type: 'remove' }, { type: 'turn', by: -90 });
    expect(order(state)).toEqual([4, 0, 1, 2, 3]);
    expect(toPagePlan(state)).toEqual({ order: [4, 1, 2, 3], turns: { 4: 90 } });
  });
});

describe('undo, redo and reset', () => {
  it('undo and redo step through the edits; a new edit clears what could be redone', () => {
    const start = five();
    const moved = run(start, ...pick(0), { type: 'move', to: 'end' });
    const turned = run(moved, { type: 'turn', by: 90 });
    const undone = run(turned, { type: 'undo' });
    expect(undone.tiles).toEqual(moved.tiles);
    const twice = run(undone, { type: 'undo' });
    expect(twice.tiles).toEqual(start.tiles);
    expect(run(twice, { type: 'undo' })).toBe(twice);
    const redone = run(twice, { type: 'redo' }, { type: 'redo' });
    expect(redone.tiles).toEqual(turned.tiles);
    expect(run(redone, { type: 'redo' })).toBe(redone);
    const branched = run(undone, { type: 'remove' });
    expect(branched.future).toEqual([]);
  });

  it(`keeps at most ${ORGANISE_HISTORY_LIMIT} steps`, () => {
    let state = run(createOrganiseState(3), ...pick(0));
    for (let i = 0; i < ORGANISE_HISTORY_LIMIT + 21; i++) state = run(state, { type: 'turn', by: 90 });
    expect(state.past).toHaveLength(ORGANISE_HISTORY_LIMIT);
    for (let i = 0; i < ORGANISE_HISTORY_LIMIT + 5; i++) state = run(state, { type: 'undo' });
    expect(state.past).toHaveLength(0);
    expect(state.tiles[0].turn).toBe(90); // the oldest 21 turns cannot be undone: 21 x 90 = 1890 = 5 x 360 + 90
  });

  it('reset goes back to the file as it is, and can be undone', () => {
    const edited = run(five(), ...pick(3), { type: 'move', to: 'start' }, { type: 'turn', by: 90 }, { type: 'remove' });
    expect(hasChanges(edited)).toBe(true);
    const reset = run(edited, { type: 'reset' });
    expect(hasChanges(reset)).toBe(false);
    expect(toPagePlan(reset)).toEqual({ order: [0, 1, 2, 3, 4], turns: {} });
    expect(run(reset, { type: 'undo' }).tiles).toEqual(edited.tiles);
    expect(run(reset, { type: 'reset' })).toBe(reset);
  });

  it('hasChanges sees a move, a turn and a removal, and not a turn taken back', () => {
    expect(hasChanges(run(five(), ...pick(0), { type: 'move', to: 'later' }))).toBe(true);
    expect(hasChanges(run(five(), ...pick(0), { type: 'turn', by: 90 }))).toBe(true);
    expect(hasChanges(run(five(), ...pick(0), { type: 'remove' }))).toBe(true);
    expect(hasChanges(run(five(), ...pick(0), { type: 'turn', by: 90 }, { type: 'turn', by: -90 }))).toBe(false);
  });
});

describe('keys (design 5.15)', () => {
  const key = (k: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  it('Alt with Home, Left, Right and End moves; R and Shift+R turn; Delete removes; Ctrl+Z and Ctrl+Y undo and redo; Space chooses', () => {
    expect(organiseKeyAction(key('Home', { altKey: true }), 2)).toEqual({ type: 'move', to: 'start' });
    expect(organiseKeyAction(key('ArrowLeft', { altKey: true }), 2)).toEqual({ type: 'move', to: 'earlier' });
    expect(organiseKeyAction(key('ArrowRight', { altKey: true }), 2)).toEqual({ type: 'move', to: 'later' });
    expect(organiseKeyAction(key('End', { altKey: true }), 2)).toEqual({ type: 'move', to: 'end' });
    expect(organiseKeyAction(key('r'), 2)).toEqual({ type: 'turn', by: 90 });
    expect(organiseKeyAction(key('R', { shiftKey: true }), 2)).toEqual({ type: 'turn', by: -90 });
    expect(organiseKeyAction(key('Delete'), 2)).toEqual({ type: 'remove' });
    expect(organiseKeyAction(key('Backspace'), 2)).toEqual({ type: 'remove' }); // the Mac keyboard's delete key (review F11)
    expect(organiseKeyAction(key('z', { ctrlKey: true }), 2)).toEqual({ type: 'undo' });
    expect(organiseKeyAction(key('y', { ctrlKey: true }), 2)).toEqual({ type: 'redo' });
    expect(organiseKeyAction(key('Z', { ctrlKey: true, shiftKey: true }), 2)).toEqual({ type: 'redo' });
    expect(organiseKeyAction(key('z', { metaKey: true }), 2)).toEqual({ type: 'undo' });
    expect(organiseKeyAction(key(' '), 2)).toEqual({ type: 'choose', index: 2, mode: 'toggle' });
  });

  it('leaves other keys to the grid (arrows move focus) and to the browser', () => {
    for (const k of [key('ArrowLeft'), key('Home'), key('r', { ctrlKey: true }), key('r', { altKey: true }), key('a', { ctrlKey: true }), key('Enter'), key('x')]) {
      expect(organiseKeyAction(k, 0), k.key).toBeNull();
    }
  });
});

describe('what a screen reader hears', () => {
  it('"Page 3 (was page 7), turned right, position 3 of 40"', () => {
    let state = createOrganiseState(40);
    state = run(state, ...pick(6), { type: 'move', to: 2 }, { type: 'turn', by: 90 });
    expect(tileDescription(state, 2)).toBe('Page 3 (was page 7), turned right, position 3 of 40');
    expect(tileDescription(state, 0)).toBe('Page 1, position 1 of 40');
    state = run(state, ...pick(0), { type: 'remove' });
    expect(tileDescription(state, 0)).toBe('Page 1, removed, position 1 of 40');
    expect(tileDescription(state, 2)).toBe('Page 2 (was page 7), turned right, position 3 of 40');
    expect(tileDescription(state, 99)).toBe('');
  });
});
