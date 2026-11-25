// What the Organise pages dialog says about the edit (design 5.15): the counts of pages moved, turned
// and removed, the line shown above the grid and written as the activity summary, the record's
// metadata, and why Run cannot be pressed.
import { describe, expect, it } from 'vitest';
import { createOrganiseState, organiseEditReducer, type OrganiseEditAction, type OrganiseEditState } from '../organiseEdit';
import {
  changeLine,
  countsOfPlan,
  countsOfTiles,
  cutList,
  cutPageList,
  movedCount,
  ORDER_MAX_LENGTH,
  organiseRecord,
  runBlockedReason,
  runLabel,
} from './organiseSummary';

const run = (state: OrganiseEditState, ...actions: OrganiseEditAction[]) => actions.reduce(organiseEditReducer, state);
const pick = (index: number): OrganiseEditAction => ({ type: 'choose', index, mode: 'only' });

describe('movedCount: the fewest pages that had to move to give the new order', () => {
  it('is 0 for the file order, with or without removals', () => {
    expect(movedCount([0, 1, 2, 3])).toBe(0);
    expect(movedCount([0, 2, 3])).toBe(0);
    expect(movedCount([])).toBe(0);
  });
  it('counts one page taken to the end as 1, not every page that shifted', () => {
    expect(movedCount([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])).toBe(1);
    expect(movedCount([9, 0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe(1);
  });
  it('counts a reversal of n pages as n - 1, and the trial order 3, 1, 2 as 1', () => {
    expect(movedCount([4, 3, 2, 1, 0])).toBe(4);
    expect(movedCount([2, 0, 1])).toBe(1);
  });
  it('handles 2,000 pages in linear-log time', () => {
    const order = Array.from({ length: 2000 }, (_, i) => 1999 - i);
    // This thread's processor time, not the clock (which on a busy machine also counts other work).
    const started = process.threadCpuUsage();
    expect(movedCount(order)).toBe(1999);
    const used = process.threadCpuUsage(started);
    expect((used.user + used.system) / 1000).toBeLessThan(200);
  });
});

describe('counts', () => {
  it('of tiles: a turn on a removed page does not count, a removed page that was moved is not "moved"', () => {
    let state = createOrganiseState(6);
    state = run(state, pick(5), { type: 'move', to: 'start' }); // 5 0 1 2 3 4
    state = run(state, pick(1), { type: 'turn', by: 90 }); // page 0 turned
    state = run(state, pick(4), { type: 'turn', by: -90 }, { type: 'remove' }); // page 3 turned, then removed
    expect(countsOfTiles(state.tiles)).toEqual({ moved: 1, turned: 1, removed: 1, kept: 5 });
    state = run(state, pick(0), { type: 'remove' }); // the moved page removed: nothing is out of order now
    expect(countsOfTiles(state.tiles)).toEqual({ moved: 0, turned: 1, removed: 2, kept: 4 });
  });
  it('of a plan agree with the tiles it was made from', () => {
    expect(countsOfPlan({ order: [2, 0, 1], turns: { 2: 90 } }, 3)).toEqual({ moved: 1, turned: 1, removed: 0, kept: 3 });
    expect(countsOfPlan({ order: [0, 2], turns: { 1: 90, 2: 0 } }, 4)).toEqual({ moved: 0, turned: 0, removed: 2, kept: 2 });
  });
});

describe('changeLine', () => {
  it('says what changed, leaving out what did not', () => {
    expect(changeLine({ moved: 3, turned: 2, removed: 1, kept: 9 })).toBe('3 moved, 2 rotated, 1 removed');
    expect(changeLine({ moved: 0, turned: 1, removed: 0, kept: 9 })).toBe('1 rotated');
    expect(changeLine({ moved: 1, turned: 0, removed: 4, kept: 9 })).toBe('1 moved, 4 removed');
    expect(changeLine({ moved: 0, turned: 0, removed: 0, kept: 9 })).toBe('No changes yet');
  });
});

describe('runLabel: the primary button starts with a verb and names the result (ux-audit E1)', () => {
  it('names the pages saved and what was done to them', () => {
    expect(runLabel({ moved: 3, turned: 1, removed: 0, kept: 12 })).toBe('Save 12 pages in the new order');
    expect(runLabel({ moved: 3, turned: 0, removed: 2, kept: 10 })).toBe('Save 10 pages in the new order');
    expect(runLabel({ moved: 0, turned: 0, removed: 1, kept: 11 })).toBe('Save 11 pages without the removed page');
    expect(runLabel({ moved: 0, turned: 2, removed: 3, kept: 9 })).toBe('Save 9 pages without the 3 removed pages');
    expect(runLabel({ moved: 0, turned: 2, removed: 0, kept: 12 })).toBe('Save 12 pages with 2 rotated');
    expect(runLabel({ moved: 0, turned: 1, removed: 0, kept: 1 })).toBe('Save 1 page with 1 rotated');
    expect(runLabel({ moved: 0, turned: 0, removed: 0, kept: 12 })).toBe('Save 12 pages');
    expect(runLabel({ moved: 0, turned: 0, removed: 4, kept: 0 })).toBe('Save in the new order');
  });
});

describe('runBlockedReason', () => {
  it('nothing changed, then every page removed, then fine', () => {
    let state = createOrganiseState(2);
    expect(runBlockedReason(state)).toBe('Nothing to do yet. Move, rotate or remove a page first.');
    state = run(state, pick(0), { type: 'turn', by: 90 }, { type: 'turn', by: -90 });
    expect(runBlockedReason(state)).toBe('Nothing to do yet. Move, rotate or remove a page first.');
    state = run(state, pick(0), { type: 'choose', index: 1, mode: 'range' }, { type: 'remove' });
    expect(runBlockedReason(state)).toBe('You cannot remove every page. Keep at least one.');
    state = run(state, pick(1), { type: 'restore' });
    expect(runBlockedReason(state)).toBeNull();
  });
});

describe('cutList', () => {
  it('keeps a list that fits; cuts a long one at a separator with "…", within the limit', () => {
    expect(cutList('1-3, 7', 200)).toBe('1-3, 7');
    const long = Array.from({ length: 120 }, (_, i) => String(i * 2 + 1)).join(', ');
    const cut = cutList(long, ORDER_MAX_LENGTH);
    expect(ORDER_MAX_LENGTH).toBe(200);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith(', …')).toBe(true);
    expect(long.startsWith(cut.slice(0, -3))).toBe(true);
    expect(cut.slice(0, -3)).toMatch(/\d$/);
  });
});

describe('organiseRecord: the activity summary and metadata (design 5.15)', () => {
  it('a mixed run', () => {
    const record = organiseRecord({ order: [2, 0, 4], turns: { 2: 90, 4: 180, 1: 90 } }, 5);
    expect(record.summary).toBe('Organised pages: 1 moved, 2 rotated, 2 removed');
    expect(record.options).toEqual({ order: '3, 1, 5', moved: 1, turned: 2, removed: '2, 4', method: 'page-copy' });
  });
  it('a turn-only run is made in place and says so', () => {
    const record = organiseRecord({ order: [0, 1, 2], turns: { 1: 270 } }, 3);
    expect(record.summary).toBe('Organised pages: 1 rotated');
    expect(record.options).toEqual({ order: '1-3', moved: 0, turned: 1, removed: '', method: 'in-place' });
  });
  it('the library’s own sentences about what was not kept join the summary as they are (pageOrder.ts organiseNotes)', () => {
    const record = organiseRecord({ order: [1, 0], turns: {} }, 2, ['Not kept when pages are moved or removed: XMP metadata, accessibility tags.', '2 named destinations of removed pages are not kept.']);
    expect(record.summary).toBe('Organised pages: 1 moved; Not kept when pages are moved or removed: XMP metadata, accessibility tags; 2 named destinations of removed pages are not kept');
  });
  it('a long removed list is cut to 200 characters with "… and N more" (review S2)', () => {
    const order = Array.from({ length: 150 }, (_, i) => i * 2); // every second page of 300 removed
    const removed = String(organiseRecord({ order, turns: {} }, 300).options.removed);
    expect(removed.length).toBeLessThanOrEqual(200);
    const match = /^(.*), … and (\d+) more$/.exec(removed);
    expect(match).not.toBeNull();
    const listed = match![1].split(', ');
    expect(listed[0]).toBe('2');
    expect(listed.length + Number(match![2])).toBe(150);
    expect(cutPageList([0, 1, 2, 7], 200)).toBe('1-3, 8');
    expect(cutPageList([0, 1, 2, 7, 9, 10], 18)).toBe('1-3, 8, 10-11');
    expect(cutPageList([0, 1, 2, 7, 9, 10, 20, 30], 18)).toBe('1-3, … and 5 more');
  });
  it('a long order is cut to 200 characters with "…"', () => {
    const order = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 299 - i : i));
    const record = organiseRecord({ order, turns: {} }, 300);
    expect(String(record.options.order).length).toBeLessThanOrEqual(200);
    expect(String(record.options.order).endsWith('…')).toBe(true);
  });
  it('holds page numbers only, never a file name or text', () => {
    const record = organiseRecord({ order: [1, 0], turns: {} }, 2);
    expect(Object.values(record.options).every((value) => typeof value === 'number' || /^[\d, \-…a-z]*$/.test(String(value)))).toBe(true);
  });
});
