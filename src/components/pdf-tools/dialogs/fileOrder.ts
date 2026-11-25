// The order of the files inside Merge and Images to PDF (UX audit C6.7, T2-6). The dialog shows the
// selection in list order and can change it with a pair of arrows per row or Alt + Up / Alt + Down (the
// file list's keys); each move is read out politely. The run gets the files in the order shown; the list
// itself is not changed (the files chosen need not sit together in it, and Cancel leaves it as it was).
// No DOM here: unit-tested.
import type { KeyFacts } from '../dialogKeys';

export type OrderMove = 'up' | 'down';

/** The list after moving the item at `index` one place; null when it is already at that end, or not in the list. */
export function moveOne<T>(items: readonly T[], index: number, direction: OrderMove): T[] | null {
  const to = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return null;
  const next = items.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * Alt + Up or Alt + Down with no other modifier: the dialog's own keys for moving the file whose row has the
 * focus. The dialog frame's guard (useDialogKeys.ts) listens on the document, after the dialog's handlers, and
 * keeps these keys from VERA Tools' tab shortcut on the window.
 */
export function orderMoveKey(event: KeyFacts): OrderMove | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowUp') return 'up';
  if (event.key === 'ArrowDown') return 'down';
  return null;
}

/**
 * Which arrow of the moved row takes the focus after a move: the same one while it can still be used, else
 * the other (Move up is unavailable on the first row, Move down on the last). `index` is the row's new place.
 */
export function focusAfterMove(direction: OrderMove, index: number, total: number): OrderMove {
  if (direction === 'up') return index > 0 ? 'up' : 'down';
  return index < total - 1 ? 'down' : 'up';
}

/** What is read out after a move, or after a key that could not move the file (counted from 1). */
export function orderAnnouncement(name: string, at: { moved: boolean; position: number; total: number }): string {
  if (at.moved) return `${name} moved to position ${at.position} of ${at.total}.`;
  return at.position <= 1 ? `${name} is already first.` : `${name} is already last.`;
}
