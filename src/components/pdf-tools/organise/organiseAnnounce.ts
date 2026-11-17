// What a screen reader hears after each edit in the Organise pages grid (design 5.15: "every move is
// announced"). Worked out from the state before and after the action, so it says what really
// happened: a move at the edge says so, an undo says what the grid now holds. Page numbers only.
import { plural } from '../format';
import { organiseEditReducer, type OrganiseEditAction, type OrganiseEditState } from '../organiseEdit';
import { changeLine, countsOfTiles } from './organiseSummary';

/** The places (from 0) of the chosen tiles, in grid order. */
function chosenPlaces(state: OrganiseEditState): number[] {
  return state.tiles.flatMap((tile, at) => (state.chosen.has(tile.source) ? [at] : []));
}

/**
 * A planned rotation in words: "rotated right", "rotated 180°", "rotated left" (QA-FIX J, user QA 2.12: the
 * badge "270°" read as the page's position; it is the turn the user gave it).
 */
export function turnWords(turn: number): string {
  const quarter = ((Math.round(turn / 90) % 4) + 4) % 4;
  return quarter === 1 ? 'rotated right' : quarter === 2 ? 'rotated 180°' : quarter === 3 ? 'rotated left' : 'not rotated';
}

/**
 * What a screen reader hears for the tile at `at`: "Page 3 (was page 7), rotated right, position 3 of
 * 40", a removed tile by its original page ("Page 7, removed, position 3 of 40"); '' when there is none.
 * organiseEdit.ts tileDescription says the same with "turned"; this is it in the owner's word.
 */
export function tileLabel(state: OrganiseEditState, at: number, page?: number | null): string {
  const tile = state.tiles[at];
  if (!tile) return '';
  const where = `position ${at + 1} of ${state.tiles.length}`;
  if (tile.removed) return `Page ${tile.source + 1}, removed, ${where}`;
  return `${tileName(state, at, page)}${tile.turn === 0 ? '' : `, ${turnWords(tile.turn)}`}, ${where}`;
}

/**
 * "Page 3 (was page 7)", or the original number for a removed tile ("Page 7"). `page`, the tile's number in
 * the result, when the caller has it already (the grid works them out once: gridLayout.ts shownNumbers), so a
 * grid of 200 tiles does not count the tiles before each one again (REV-B minor 4).
 */
function tileName(state: OrganiseEditState, at: number, known?: number | null): string {
  const tile = state.tiles[at];
  if (tile.removed) return `Page ${tile.source + 1}`;
  const page = typeof known === 'number' ? known : state.tiles.slice(0, at + 1).filter((t) => !t.removed).length;
  return `Page ${page}${page === tile.source + 1 ? '' : ` (was page ${tile.source + 1})`}`;
}

const sameTiles = (a: OrganiseEditState, b: OrganiseEditState) => a.tiles === b.tiles;

function nowHolds(state: OrganiseEditState): string {
  const counts = countsOfTiles(state.tiles);
  return counts.moved + counts.turned + counts.removed === 0 ? 'no changes' : changeLine(counts);
}

function moved(before: OrganiseEditState, after: OrganiseEditState, action: Extract<OrganiseEditAction, { type: 'move' | 'drop' }>): string {
  if (sameTiles(before, after)) {
    if (action.type === 'drop') return '';
    if (action.to === 'start' || action.to === 'earlier') return 'Already at the start.';
    if (action.to === 'end' || action.to === 'later') return 'Already at the end.';
    return 'Already at that position.';
  }
  const places = chosenPlaces(after);
  if (places.length === 1) return `Moved. ${tileLabel(after, places[0])}`;
  const first = places[0];
  const last = places[places.length - 1];
  if (last - first === places.length - 1) return `Moved ${places.length} pages to positions ${first + 1} to ${last + 1} of ${after.tiles.length}.`;
  return `Moved ${places.length} pages one place ${action.type === 'move' && action.to === 'earlier' ? 'earlier' : 'later'}.`;
}

/** The sentence to announce after `action` took `before` to `after`; '' when there is nothing to say. */
export function announceEdit(before: OrganiseEditState, after: OrganiseEditState, action: OrganiseEditAction): string {
  switch (action.type) {
    case 'choose': {
      if (action.mode === 'only') return '';
      const count = after.chosen.size;
      const total = count === 0 ? 'No page chosen.' : `${plural(count, 'page')} chosen.`;
      if (action.mode === 'range') return total;
      const tile = after.tiles[action.index];
      if (!tile) return '';
      return `${tileName(after, action.index)} ${after.chosen.has(tile.source) ? 'chosen' : 'not chosen'}. ${total}`;
    }
    case 'move':
    case 'drop':
      if (before.chosen.size === 0) return action.type === 'drop' ? '' : 'Choose a page first.';
      return moved(before, after, action);
    case 'turn': {
      if (before.chosen.size === 0) return 'Choose a page first.';
      const way = action.by > 0 ? 'right' : 'left';
      const places = chosenPlaces(after);
      if (places.length !== 1) return `Rotated ${places.length} pages ${way}.`;
      const upright = after.tiles[places[0]].turn === 0 && !after.tiles[places[0]].removed ? ', as in the file' : '';
      return `Rotated ${way}. ${tileLabel(after, places[0])}${upright}`;
    }
    case 'remove':
    case 'restore': {
      if (before.chosen.size === 0) return 'Choose a page first.';
      if (sameTiles(before, after)) return '';
      const changed = after.tiles.flatMap((tile, at) => (before.tiles.find((t) => t.source === tile.source)?.removed !== tile.removed ? [at] : []));
      const what = changed.length === 1 ? tileName(after, changed[0]) : plural(changed.length, 'page');
      if (action.type === 'restore') return `${what} restored.`;
      return changed.length === 1 ? `${what} removed. Press Delete again, or Restore, to bring it back.` : `${what} removed.`;
    }
    case 'undo':
      return sameTiles(before, after) ? 'Nothing to undo.' : `Undone. Now ${nowHolds(after)}.`;
    case 'redo':
      return sameTiles(before, after) ? 'Nothing to redo.' : `Redone. Now ${nowHolds(after)}.`;
    case 'reset':
      return sameTiles(before, after) ? "Already in the file's own order." : "Back to the file's own order. Undo brings your changes back.";
  }
}

/**
 * Applies the actions in order and says what they did: the last edit's sentence, else the last choosing
 * sentence. A key that chooses a page, edits it and chooses again (organiseKeys.ts) is announced as the edit.
 */
export function announceActions(state: OrganiseEditState, actions: readonly OrganiseEditAction[]): { state: OrganiseEditState; text: string } {
  let edited = '';
  let chose = '';
  let next = state;
  for (const action of actions) {
    const after = organiseEditReducer(next, action);
    const said = announceEdit(next, after, action);
    if (said && action.type === 'choose') chose = said;
    else if (said) edited = said;
    next = after;
  }
  return { state: next, text: edited || chose };
}
