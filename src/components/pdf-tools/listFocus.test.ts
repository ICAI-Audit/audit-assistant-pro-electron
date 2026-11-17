import { describe, expect, it } from 'vitest';
import { focusAfterListChange, type ListFocusChange } from './listFocus';

const change = (over: Partial<ListFocusChange>): ListFocusChange => ({
  wasEmpty: false,
  empty: true,
  sameSession: true,
  focusLost: true,
  focusWasInside: true,
  dialogOpen: false,
  lastAddedFrom: 'computer',
  ...over,
});

describe('focusAfterListChange', () => {
  it('after the user removed the last rows inside PDF Tools: "Add from computer"', () => {
    expect(focusAfterListChange(change({}))).toBe('add');
  });

  it('never moves focus when the list was cleared by a change of engagement, session or sign-out', () => {
    // The header's engagement menu is still closing; moving focus then breaks its focus trap.
    expect(focusAfterListChange(change({ sameSession: false }))).toBeNull();
    expect(focusAfterListChange(change({ sameSession: false, focusWasInside: false }))).toBeNull();
  });

  it('never takes focus from an element that has it, nor when focus was last outside PDF Tools', () => {
    expect(focusAfterListChange(change({ focusLost: false }))).toBeNull();
    expect(focusAfterListChange(change({ focusWasInside: false }))).toBeNull();
  });

  it('when the first rows arrive and focus fell with the empty area: the same "Add from" button in the strip', () => {
    expect(focusAfterListChange(change({ wasEmpty: true, empty: false }))).toBe('strip-add');
    expect(focusAfterListChange(change({ wasEmpty: true, empty: false, lastAddedFrom: 'vault' }))).toBe('strip-vault');
    // A dialog still open or closing returns focus itself.
    expect(focusAfterListChange(change({ wasEmpty: true, empty: false, dialogOpen: true }))).toBeNull();
    expect(focusAfterListChange(change({ wasEmpty: true, empty: false, sameSession: false }))).toBeNull();
  });

  it('does nothing when emptiness did not change', () => {
    expect(focusAfterListChange(change({ wasEmpty: true, empty: true }))).toBeNull();
    expect(focusAfterListChange(change({ wasEmpty: false, empty: false }))).toBeNull();
  });
});
