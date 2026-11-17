// The Organise pages grid's keyboard (design 5.15), on top of organiseEdit.ts's key map. The grid
// applies it only while focus is on a page tile, so typing in "Move to position" is never a key here.
//
// - Arrows, Home, End, Page Up and Page Down move focus (by the grid's columns for Up and Down); they
//   never choose. Shift with them chooses the range from the anchor to the new focus.
// - Space chooses or un-chooses the focused page; Shift + Space chooses the range up to it; Ctrl + A
//   chooses every page.
// - The edit keys of organiseKeyAction act on the chosen pages when the focused page is one of them;
//   otherwise on the focused page alone, which is not left chosen (review F1), so "go to a page, R" always
//   rotates the page with the focus ring.
// - Delete (or Backspace, a Mac's Delete key) removes; when every page it would act on is already
//   removed, it restores them instead.
// - Enter opens the page viewer at the focused page (the page itself is not a toggle: Space is).
// - VERA Tools changes tab on Alt + arrows and Ctrl + a number: those keys are held (handled, nothing
//   done) so the tab does not change under the dialog.
import { organiseEditReducer, organiseKeyAction, type OrganiseEditAction, type OrganiseEditState, type OrganiseKey, type OrganiseTile } from '../organiseEdit';

export type GridKeyInput = OrganiseKey;

export interface GridKeyResult {
  /** For the reducer, in order. */
  actions: OrganiseEditAction[];
  /** The place (from 0) focus moves to. */
  focus?: number;
  /** Open the page viewer at the focused page. */
  view?: boolean;
  /** The key was used: the grid stops it (preventDefault, stopPropagation). */
  handled: boolean;
}

const NAVIGATION = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const ROWS_PER_PAGE = 4;
const unused: GridKeyResult = { actions: [], handled: false };
const held: GridKeyResult = { actions: [], handled: true };

function target(key: string, focus: number, count: number, columns: number): number {
  const last = count - 1;
  const row = (at: number) => Math.floor(at / columns);
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, focus - 1);
    case 'ArrowRight':
      return Math.min(last, focus + 1);
    case 'ArrowUp':
      return focus - columns >= 0 ? focus - columns : focus;
    case 'ArrowDown':
      return row(focus) < row(last) ? Math.min(last, focus + columns) : focus;
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'PageUp':
      return Math.max(0, focus - columns * ROWS_PER_PAGE);
    default:
      return Math.min(last, focus + columns * ROWS_PER_PAGE);
  }
}

/** Chooses from the anchor to `to`; with no anchor, from the focused page. */
function range(state: OrganiseEditState, focus: number, to: number): OrganiseEditAction[] {
  const steps: OrganiseEditAction[] = [];
  if (state.anchor === null || !state.tiles.some((tile) => tile.source === state.anchor)) steps.push({ type: 'choose', index: focus, mode: 'only' });
  steps.push({ type: 'choose', index: to, mode: 'range' });
  return steps;
}

/** What `event` does in the grid. `focus` is the focused tile's place, `columns` the grid's columns now. */
export function gridKey(event: GridKeyInput, state: OrganiseEditState, focus: number, columns: number): GridKeyResult {
  const count = state.tiles.length;
  if (count === 0) return unused;
  const at = Math.max(0, Math.min(count - 1, focus));
  const cols = Math.max(1, Math.floor(columns));
  const command = event.ctrlKey || event.metaKey;

  if (event.altKey && event.key.startsWith('Arrow') && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.shiftKey || command)) return held;
  if (command && !event.altKey && /^[1-9]$/.test(event.key)) return held;
  if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
    return { actions: [{ type: 'choose', index: 0, mode: 'only' }, { type: 'choose', index: count - 1, mode: 'range' }], handled: true };
  }

  if (!event.altKey && NAVIGATION.has(event.key)) {
    const to = target(event.key, at, count, cols);
    return { actions: event.shiftKey && !command ? range(state, at, to) : [], focus: to, handled: true };
  }
  if (event.key === ' ' && event.shiftKey && !command && !event.altKey) return { actions: range(state, at, at), handled: true };
  if (event.key === 'Enter' && !command && !event.altKey && !event.shiftKey) return { actions: [], view: true, handled: true };

  // A Mac keyboard's Delete key sends Backspace (P-review F11).
  const plainBackspace = event.key === 'Backspace' && !command && !event.altKey && !event.shiftKey;
  const action = organiseKeyAction(plainBackspace ? { ...event, key: 'Delete' } : event, at);
  if (!action) return unused;
  if (action.type === 'choose' || action.type === 'undo' || action.type === 'redo') return { actions: [action], handled: true };

  // An edit of the chosen pages when the focused page is one of them. Otherwise of the focused page
  // alone (review F1: a page chosen earlier must never be the one rotated, removed or moved), and the
  // pages the user had chosen are chosen again afterwards, the focused page not left chosen.
  const focused = state.tiles[at];
  const edit = (acting: readonly OrganiseTile[]): OrganiseEditAction => (action.type === 'remove' && acting.every((tile) => tile.removed) ? { type: 'restore' } : action);
  if (state.chosen.has(focused.source)) return { actions: [edit(state.tiles.filter((tile) => state.chosen.has(tile.source)))], handled: true };
  const steps: OrganiseEditAction[] = [{ type: 'choose', index: at, mode: 'only' }, edit([focused])];
  const after = steps.reduce(organiseEditReducer, state);
  const before = new Set(state.chosen);
  const places = after.tiles.flatMap((tile, place) => (before.has(tile.source) ? [place] : []));
  if (places.length === 0) {
    steps.push({ type: 'choose', index: after.tiles.findIndex((tile) => tile.source === focused.source), mode: 'toggle' });
  } else {
    steps.push({ type: 'choose', index: places[0], mode: 'only' });
    for (const place of places.slice(1)) steps.push({ type: 'choose', index: place, mode: 'toggle' });
  }
  return { actions: steps, handled: true };
}
