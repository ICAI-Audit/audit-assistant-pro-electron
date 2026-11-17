// Why each Organise pages action is unavailable (ux-audit E8: every unavailable control says why, on
// hover, on focus and on click), or null when it can be used.
import { describe, expect, it } from 'vitest';
import { createOrganiseState, organiseEditReducer, type OrganiseEditAction, type OrganiseEditState } from '../organiseEdit';
import { unavailableReasons } from './toolbarRules';

const apply = (state: OrganiseEditState, ...actions: OrganiseEditAction[]) => actions.reduce(organiseEditReducer, state);
const six = () => createOrganiseState(6);
const one = (index: number): OrganiseEditAction => ({ type: 'choose', index, mode: 'only' });

describe('unavailableReasons', () => {
  it('nothing chosen: every action on pages asks for a choice; history says there is nothing', () => {
    const r = unavailableReasons(six(), '');
    const choose = 'Choose a page first: click it, or press Space on it in the grid.';
    for (const id of ['start', 'earlier', 'later', 'end', 'position', 'rotate-left', 'rotate-right', 'remove', 'restore'] as const) expect(r[id], id).toBe(choose);
    expect(r.undo).toBe('Nothing to undo yet.');
    expect(r.redo).toBe('Nothing to redo.');
    expect(r.reset).toBe("The pages are already in the file's own order.");
  });

  it('at the edges: already at the start or the end', () => {
    let r = unavailableReasons(apply(six(), one(0), { type: 'choose', index: 1, mode: 'toggle' }), '3');
    expect(r.start).toBe('The chosen pages are already at the start.');
    expect(r.earlier).toBe('The chosen pages are already at the start.');
    expect(r.later).toBeNull();
    expect(r.end).toBeNull();
    expect(r.position).toBeNull();
    r = unavailableReasons(apply(six(), one(5)), '');
    expect(r.end).toBe('The chosen page is already at the end.');
    expect(r.later).toBe('The chosen page is already at the end.');
    expect(r.start).toBeNull();
  });

  it('Move to position: says what to type', () => {
    const s = apply(six(), one(2));
    expect(unavailableReasons(s, '').position).toBe('Type a page number from 1 to 6 first.');
    expect(unavailableReasons(s, '9').position).toBe('Type a page number from 1 to 6.');
    expect(unavailableReasons(apply(s, { type: 'remove' }, one(0)), '6').position).toBe('Type a page number from 1 to 5.');
    expect(unavailableReasons(s, '4').position).toBeNull();
  });

  it('rotate, remove and restore follow what the chosen pages are', () => {
    let s = apply(six(), one(2), { type: 'remove' });
    let r = unavailableReasons(s, '');
    expect(r['rotate-left']).toBe('The chosen page is removed. Restore it first.');
    expect(r['rotate-right']).toBe('The chosen page is removed. Restore it first.');
    expect(r.remove).toBe('The chosen page is already removed.');
    expect(r.restore).toBeNull();
    expect(r.undo).toBeNull();
    expect(r.reset).toBeNull();
    s = apply(s, { type: 'choose', index: 3, mode: 'toggle' });
    r = unavailableReasons(s, '');
    expect(r['rotate-right']).toBeNull();
    expect(r.remove).toBeNull();
    expect(r.restore).toBeNull();
    r = unavailableReasons(apply(six(), one(1), { type: 'choose', index: 2, mode: 'toggle' }), '');
    expect(r.restore).toBe('None of the chosen pages is removed.');
    r = unavailableReasons(apply(six(), one(1), { type: 'choose', index: 2, mode: 'toggle' }, { type: 'remove' }), '');
    expect(r.remove).toBe('The chosen pages are already removed.');
    expect(r['rotate-left']).toBe('The chosen pages are removed. Restore them first.');
  });

  it('redo after an undo', () => {
    const r = unavailableReasons(apply(six(), one(1), { type: 'turn', by: 90 }, { type: 'undo' }), '');
    expect(r.redo).toBeNull();
    expect(r.undo).toBe('Nothing to undo yet.');
  });
});
