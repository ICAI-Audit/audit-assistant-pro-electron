// What a screen reader hears after each edit in the Organise pages grid (design 5.15: "every move is
// announced"). Built from the state before and after, so it says what really happened.
import { describe, expect, it } from 'vitest';
import { createOrganiseState, organiseEditReducer, tileDescription, type OrganiseEditAction, type OrganiseEditState } from '../organiseEdit';
import { announceActions, announceEdit, tileLabel, turnWords } from './organiseAnnounce';
import { shownNumbers } from './gridLayout';

const apply = (state: OrganiseEditState, ...actions: OrganiseEditAction[]) => actions.reduce(organiseEditReducer, state);
const say = (state: OrganiseEditState, action: OrganiseEditAction) => announceEdit(state, organiseEditReducer(state, action), action);
const ten = () => createOrganiseState(10);
const one = (index: number): OrganiseEditAction => ({ type: 'choose', index, mode: 'only' });
const also = (index: number): OrganiseEditAction => ({ type: 'choose', index, mode: 'toggle' });

describe('moves', () => {
  it('one page: where it is now, in the words of the tile', () => {
    const s = apply(ten(), one(6));
    expect(say(s, { type: 'move', to: 'start' })).toBe('Moved. Page 1 (was page 7), position 1 of 10');
    expect(say(s, { type: 'move', to: 'earlier' })).toBe('Moved. Page 6 (was page 7), position 6 of 10');
    expect(say(s, { type: 'move', to: 2 })).toBe('Moved. Page 3 (was page 7), position 3 of 10');
    expect(say(s, { type: 'drop', at: 10 })).toBe('Moved. Page 10 (was page 7), position 10 of 10');
  });
  it('several pages together: the positions they take', () => {
    const s = apply(ten(), one(1), also(2), also(3));
    expect(say(s, { type: 'move', to: 'end' })).toBe('Moved 3 pages to positions 8 to 10 of 10.');
  });
  it('several pages apart: the direction', () => {
    const s = apply(ten(), one(2), also(6));
    expect(say(s, { type: 'move', to: 'later' })).toBe('Moved 2 pages one place later.');
    expect(say(s, { type: 'move', to: 'earlier' })).toBe('Moved 2 pages one place earlier.');
  });
  it('already at the edge: says so', () => {
    expect(say(apply(ten(), one(0)), { type: 'move', to: 'earlier' })).toBe('Already at the start.');
    expect(say(apply(ten(), one(0)), { type: 'move', to: 'start' })).toBe('Already at the start.');
    expect(say(apply(ten(), one(9)), { type: 'move', to: 'later' })).toBe('Already at the end.');
    expect(say(apply(ten(), one(4)), { type: 'move', to: 4 })).toBe('Already at that position.');
  });
  it('nothing chosen: asks for a choice', () => {
    expect(say(ten(), { type: 'move', to: 'end' })).toBe('Choose a page first.');
    expect(say(ten(), { type: 'turn', by: 90 })).toBe('Choose a page first.');
  });
});

describe('turns, removals, restores', () => {
  it('rotations of one page and several (the owner’s word: rotate)', () => {
    let s = apply(ten(), one(2));
    expect(say(s, { type: 'turn', by: 90 })).toBe('Rotated right. Page 3, rotated right, position 3 of 10');
    s = apply(s, { type: 'turn', by: 90 });
    expect(say(s, { type: 'turn', by: -90 })).toBe('Rotated left. Page 3, position 3 of 10, as in the file');
    expect(say(apply(ten(), one(1), also(4)), { type: 'turn', by: -90 })).toBe('Rotated 2 pages left.');
  });
  it('removes (naming the original page) and restores (naming where it is now)', () => {
    let s = apply(ten(), one(6), { type: 'move', to: 'start' });
    expect(say(s, { type: 'remove' })).toBe('Page 7 removed. Press Delete again, or Restore, to bring it back.');
    s = apply(s, { type: 'remove' });
    expect(say(s, { type: 'remove' })).toBe('');
    expect(say(s, { type: 'restore' })).toBe('Page 1 (was page 7) restored.');
    expect(say(apply(ten(), one(1), also(2)), { type: 'remove' })).toBe('2 pages removed.');
    expect(say(apply(ten(), one(1), also(2), { type: 'remove' }), { type: 'restore' })).toBe('2 pages restored.');
  });
});

describe('history', () => {
  it('undo, redo and reset say what the grid holds now', () => {
    const s = apply(ten(), one(6), { type: 'move', to: 'start' }, { type: 'turn', by: 90 }, one(3), { type: 'remove' });
    const undone = organiseEditReducer(s, { type: 'undo' });
    expect(announceEdit(s, undone, { type: 'undo' })).toBe('Undone. Now 1 moved, 1 rotated.');
    expect(announceEdit(undone, organiseEditReducer(undone, { type: 'redo' }), { type: 'redo' })).toBe('Redone. Now 1 moved, 1 rotated, 1 removed.');
    expect(say(s, { type: 'reset' })).toBe("Back to the file's own order. Undo brings your changes back.");
    expect(say(ten(), { type: 'undo' })).toBe('Nothing to undo.');
    expect(say(ten(), { type: 'redo' })).toBe('Nothing to redo.');
    expect(say(ten(), { type: 'reset' })).toBe("Already in the file's own order.");
    const back = apply(ten(), one(1), { type: 'turn', by: 90 }, { type: 'undo' });
    expect(announceEdit(apply(ten(), one(1), { type: 'turn', by: 90 }), back, { type: 'undo' })).toBe('Undone. Now no changes.');
  });
});

describe('tileLabel: what a screen reader hears for a tile (organiseEdit.ts tileDescription in the owner’s word)', () => {
  it('page in the result, original page when moved, rotation, position; removed tiles by their original page', () => {
    let s = apply(ten(), one(6), { type: 'move', to: 2 }, { type: 'turn', by: 90 });
    expect(tileLabel(s, 2)).toBe('Page 3 (was page 7), rotated right, position 3 of 10');
    // Words, not the angle of the change (QA-FIX J, user QA 2.12: "270°" read as the page's position).
    expect(turnWords(270)).toBe('rotated left');
    expect(turnWords(180)).toBe('rotated 180°');
    expect(turnWords(90)).toBe('rotated right');
    expect(tileLabel(s, 0)).toBe('Page 1, position 1 of 10');
    s = apply(s, one(0), { type: 'remove' });
    expect(tileLabel(s, 0)).toBe('Page 1, removed, position 1 of 10');
    expect(tileLabel(s, 1)).toBe('Page 1 (was page 2), position 2 of 10');
    expect(tileLabel(s, 99)).toBe('');
  });
  it('says the same with the page numbers worked out once for the whole grid (shownNumbers), as the grid gives them (REV-B minor 4)', () => {
    const s = apply(ten(), one(3), { type: 'move', to: 'end' }, { type: 'turn', by: -90 }, one(0), { type: 'remove' });
    const numbers = shownNumbers(s.tiles);
    for (let at = 0; at < 10; at++) expect(tileLabel(s, at, numbers[at])).toBe(tileLabel(s, at));
  });
  it('says the same as tileDescription with "turned" read as "rotated"', () => {
    const s = apply(ten(), one(3), { type: 'move', to: 'end' }, { type: 'turn', by: -90 }, one(0), { type: 'remove' });
    for (let at = 0; at < 10; at++) expect(tileLabel(s, at)).toBe(tileDescription(s, at).replace('turned', 'rotated'));
  });
});

describe('announceActions: a key that chooses, edits and un-chooses says what it did (review F1)', () => {
  it('the edit is announced, not the choosing around it', () => {
    const out = announceActions(ten(), [{ type: 'choose', index: 4, mode: 'only' }, { type: 'turn', by: 90 }, { type: 'choose', index: 4, mode: 'toggle' }]);
    expect(out.text).toBe('Rotated right. Page 5, rotated right, position 5 of 10');
    expect(out.state.tiles[4].turn).toBe(90);
    expect(out.state.chosen.size).toBe(0);
  });
  it('choosing alone is announced as choosing', () => {
    expect(announceActions(ten(), [{ type: 'choose', index: 0, mode: 'only' }, { type: 'choose', index: 3, mode: 'range' }]).text).toBe('4 pages chosen.');
  });
});

describe('choosing', () => {
  it('Space and ranges say how many pages are chosen; a click alone says nothing', () => {
    expect(say(ten(), also(3))).toBe('Page 4 chosen. 1 page chosen.');
    expect(say(apply(ten(), also(3)), also(3))).toBe('Page 4 not chosen. No page chosen.');
    expect(say(apply(ten(), one(2)), { type: 'choose', index: 5, mode: 'range' })).toBe('4 pages chosen.');
    expect(say(ten(), one(2))).toBe('');
  });
});
