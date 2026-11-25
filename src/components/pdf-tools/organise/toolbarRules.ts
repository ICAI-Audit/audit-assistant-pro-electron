// Why each Organise pages action cannot be used now (ux-audit E8: every unavailable control says why,
// on hover, on focus and on click), or null when it can. Pure: the toolbar shows the words.
import { hasChanges, type OrganiseEditState } from '../organiseEdit';
import { readPosition } from './gridLayout';

export type ToolbarActionId = 'start' | 'earlier' | 'later' | 'end' | 'position' | 'rotate-left' | 'rotate-right' | 'remove' | 'restore' | 'undo' | 'redo' | 'reset';

export const CHOOSE_FIRST = 'Choose a page first: click it, or press Space on it in the grid.';

/** `positionText` is what is typed in "Move to position". */
export function unavailableReasons(state: OrganiseEditState, positionText: string): Record<ToolbarActionId, string | null> {
  const count = state.tiles.length;
  const places = state.tiles.flatMap((tile, at) => (state.chosen.has(tile.source) ? [at] : []));
  const chosen = places.map((at) => state.tiles[at]);
  const one = chosen.length === 1;
  const none = chosen.length === 0 ? CHOOSE_FIRST : null;
  const atStart = places.every((at, i) => at === i);
  const atEnd = places.every((at, i) => at === count - places.length + i);
  const start = none ?? (atStart ? `The chosen ${one ? 'page is' : 'pages are'} already at the start.` : null);
  const end = none ?? (atEnd ? `The chosen ${one ? 'page is' : 'pages are'} already at the end.` : null);
  // Move to position counts the pages of the result, not removed tiles.
  const pages = state.tiles.filter((tile) => !tile.removed).length;
  const typed = readPosition(positionText, pages);
  const position = none ?? (pages === 0 ? 'Every page is removed.' : positionText.trim() === '' ? `Type a page number from 1 to ${pages} first.` : typed.error);
  const allRemoved = chosen.every((tile) => tile.removed);
  const rotate = none ?? (allRemoved ? `The chosen ${one ? 'page is removed. Restore it' : 'pages are removed. Restore them'} first.` : null);
  return {
    start,
    earlier: start,
    later: end,
    end,
    position,
    'rotate-left': rotate,
    'rotate-right': rotate,
    remove: none ?? (allRemoved ? `The chosen ${one ? 'page is' : 'pages are'} already removed.` : null),
    restore: none ?? (chosen.some((tile) => tile.removed) ? null : `None of the chosen pages is removed.`),
    undo: state.past.length === 0 ? 'Nothing to undo yet.' : null,
    redo: state.future.length === 0 ? 'Nothing to redo.' : null,
    reset: hasChanges(state) ? null : "The pages are already in the file's own order.",
  };
}
