// Where focus goes when the file list becomes empty or gets its first rows (the area holding the
// focused button is replaced). Focus is moved only after the user's own action inside PDF Tools:
// a list emptied by a change of engagement, session or sign-out is left alone (the header's
// engagement menu may still be closing, and its focus trap must not be fought), and focus is never
// taken from an element that has it.

export interface ListFocusChange {
  wasEmpty: boolean;
  empty: boolean;
  /** The list's session did not change (its rows went by the user's own removal, not a switch). */
  sameSession: boolean;
  /** Focus is on nothing, or on the page body. */
  focusLost: boolean;
  /** The last element focused (before focus was lost) was inside PDF Tools. */
  focusWasInside: boolean;
  /** A dialog or alert dialog is open or closing: it returns focus itself. */
  dialogOpen: boolean;
  lastAddedFrom: 'computer' | 'vault';
}

export type ListFocusTarget = 'add' | 'strip-add' | 'strip-vault' | null;

export function focusAfterListChange(c: ListFocusChange): ListFocusTarget {
  if (!c.sameSession || !c.focusLost || !c.focusWasInside) return null;
  if (c.empty && !c.wasEmpty) return 'add';
  if (!c.empty && c.wasEmpty && !c.dialogOpen) return c.lastAddedFrom === 'vault' ? 'strip-vault' : 'strip-add';
  return null;
}
