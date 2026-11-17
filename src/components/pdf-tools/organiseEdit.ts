// The edit model behind the Organise pages dialog (design 5.15; plan Task B1): a pure reducer over
// the page tiles. Positions in actions are places in the grid, from 0; a tile is known by its source
// page (from 0), so the chosen tiles stay chosen when they move. Removed tiles stay in place, marked,
// until restored. Choosing is not an edit; every edit that changes the tiles can be undone, up to
// ORGANISE_HISTORY_LIMIT steps. Nothing here holds file content.
import type { PagePlan, Turn } from '@/lib/pdf-tools/pageOrder';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES } from '@/lib/pdf-tools/types';

export const ORGANISE_HISTORY_LIMIT = 100;

export interface OrganiseTile {
  /** The page's index in the file, from 0. */
  readonly source: number;
  /** Turned clockwise by this much, on top of the rotation the page has. */
  readonly turn: Turn;
  readonly removed: boolean;
}

export interface OrganiseEditState {
  readonly tiles: readonly OrganiseTile[];
  /** The chosen tiles, by source page. */
  readonly chosen: ReadonlySet<number>;
  /** The source page of the tile last chosen alone or with Ctrl: where a Shift range starts. */
  readonly anchor: number | null;
  /** Earlier tiles, oldest first. */
  readonly past: readonly (readonly OrganiseTile[])[];
  /** Undone tiles, the next redo first. */
  readonly future: readonly (readonly OrganiseTile[])[];
}

export type OrganiseEditAction =
  | { type: 'choose'; index: number; mode: 'only' | 'toggle' | 'range' }
  /** A number is the place (from 0) where the first chosen tile lands; the others follow it in their order. */
  | { type: 'move'; to: 'start' | 'earlier' | 'later' | 'end' | number }
  | { type: 'turn'; by: 90 | -90 }
  | { type: 'remove' }
  | { type: 'restore' }
  | { type: 'reset' }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Drag and drop: the chosen tiles go into the gap before the tile now at `at` (`at` = the tile count: the end). */
  | { type: 'drop'; at: number };

const identity = (pageCount: number): OrganiseTile[] => Array.from({ length: pageCount }, (_, source) => ({ source, turn: 0, removed: false }));

export function createOrganiseState(pageCount: number): OrganiseEditState {
  return { tiles: identity(pageCount), chosen: new Set(), anchor: null, past: [], future: [] };
}

const sameTiles = (a: readonly OrganiseTile[], b: readonly OrganiseTile[]) =>
  a.length === b.length && a.every((tile, i) => tile.source === b[i].source && tile.turn === b[i].turn && tile.removed === b[i].removed);

/** A new state holding `tiles` as an edit that can be undone; the same state when nothing changed. */
function edit(state: OrganiseEditState, tiles: readonly OrganiseTile[]): OrganiseEditState {
  if (sameTiles(tiles, state.tiles)) return state;
  return { ...state, tiles, past: [...state.past, state.tiles].slice(-ORGANISE_HISTORY_LIMIT), future: [] };
}

/** The chosen tiles where they are inserted among the others: `before` of the others come first. */
function insertChosen(state: OrganiseEditState, before: number): OrganiseTile[] {
  const chosen = state.tiles.filter((tile) => state.chosen.has(tile.source));
  const others = state.tiles.filter((tile) => !state.chosen.has(tile.source));
  const at = Math.max(0, Math.min(others.length, before));
  return [...others.slice(0, at), ...chosen, ...others.slice(at)];
}

/** Each run of chosen tiles one place earlier (direction -1) or later (+1); a run at the edge stays. */
function step(state: OrganiseEditState, direction: -1 | 1): OrganiseTile[] {
  const tiles = [...state.tiles];
  const isChosen = (i: number) => state.chosen.has(tiles[i].source);
  const swap = (i: number, j: number) => ([tiles[i], tiles[j]] = [tiles[j], tiles[i]]);
  if (direction < 0) {
    for (let i = 1; i < tiles.length; i++) if (isChosen(i) && !isChosen(i - 1)) swap(i, i - 1);
  } else {
    for (let i = tiles.length - 2; i >= 0; i--) if (isChosen(i) && !isChosen(i + 1)) swap(i, i + 1);
  }
  return tiles;
}

function move(state: OrganiseEditState, to: 'start' | 'earlier' | 'later' | 'end' | number): OrganiseTile[] {
  if (to === 'earlier') return step(state, -1);
  if (to === 'later') return step(state, 1);
  if (to === 'start') return insertChosen(state, 0);
  if (to === 'end') return insertChosen(state, state.tiles.length);
  return insertChosen(state, Number.isFinite(to) ? Math.trunc(to) : 0);
}

function choose(state: OrganiseEditState, index: number, mode: 'only' | 'toggle' | 'range'): OrganiseEditState {
  const tile = state.tiles[index];
  if (!tile || !Number.isInteger(index)) return state;
  const anchorAt = state.anchor === null ? -1 : state.tiles.findIndex((t) => t.source === state.anchor);
  if (mode === 'range' && anchorAt >= 0) {
    const [from, to] = anchorAt <= index ? [anchorAt, index] : [index, anchorAt];
    return { ...state, chosen: new Set(state.tiles.slice(from, to + 1).map((t) => t.source)) };
  }
  if (mode === 'toggle') {
    const chosen = new Set(state.chosen);
    if (chosen.has(tile.source)) chosen.delete(tile.source);
    else chosen.add(tile.source);
    return { ...state, chosen, anchor: tile.source };
  }
  return { ...state, chosen: new Set([tile.source]), anchor: tile.source };
}

const turned = (turn: Turn, by: 90 | -90) => ((((turn + by) % 360) + 360) % 360) as Turn;

export function organiseEditReducer(state: OrganiseEditState, action: OrganiseEditAction): OrganiseEditState {
  const onChosen = (change: (tile: OrganiseTile) => OrganiseTile) => state.tiles.map((tile) => (state.chosen.has(tile.source) ? change(tile) : tile));
  switch (action.type) {
    case 'choose':
      return choose(state, action.index, action.mode);
    case 'move':
      return state.chosen.size === 0 ? state : edit(state, move(state, action.to));
    case 'drop': {
      if (state.chosen.size === 0) return state;
      const at = Math.max(0, Math.min(state.tiles.length, Number.isFinite(action.at) ? Math.trunc(action.at) : 0));
      const othersBefore = state.tiles.slice(0, at).filter((tile) => !state.chosen.has(tile.source)).length;
      return edit(state, insertChosen(state, othersBefore));
    }
    case 'turn':
      return edit(state, onChosen((tile) => ({ ...tile, turn: turned(tile.turn, action.by) })));
    case 'remove':
      return edit(state, onChosen((tile) => ({ ...tile, removed: true })));
    case 'restore':
      return edit(state, onChosen((tile) => ({ ...tile, removed: false })));
    case 'reset':
      return edit(state, identity(state.tiles.length));
    case 'undo': {
      if (state.past.length === 0) return state;
      return { ...state, tiles: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.tiles, ...state.future] };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      return { ...state, tiles: state.future[0], past: [...state.past, state.tiles].slice(-ORGANISE_HISTORY_LIMIT), future: state.future.slice(1) };
    }
  }
}

/**
 * The plan for pageOrder.ts organisePages: the kept pages in their new order, and the turns of kept
 * pages that are turned. Throws PdfToolsError 'organise-all-removed' when every page is removed.
 */
export function toPagePlan(state: OrganiseEditState): PagePlan {
  const kept = state.tiles.filter((tile) => !tile.removed);
  if (kept.length === 0) {
    throw new PdfToolsError('organise-all-removed', PHASE_TWO_ERROR_MESSAGES['organise-all-removed'] ?? 'You cannot remove every page. Keep at least one.');
  }
  const turns: Record<number, Turn> = {};
  for (const tile of kept) if (tile.turn !== 0) turns[tile.source] = tile.turn;
  return { order: kept.map((tile) => tile.source), turns };
}

/** Whether the tiles differ from the file as it is (Run is enabled only after a change). */
export function hasChanges(state: OrganiseEditState): boolean {
  return !sameTiles(state.tiles, identity(state.tiles.length));
}

export interface OrganiseKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * The action for a key pressed in the grid (design 5.15), or null for keys the grid or the browser
 * handles (the arrow keys move focus). `focus` is the place of the focused tile. The dialog applies
 * these only while the grid has focus, so typing in "Move to position" is not taken as a key.
 */
export function organiseKeyAction(event: OrganiseKey, focus: number): OrganiseEditAction | null {
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (command && !event.altKey) {
    if (key === 'z') return event.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (key === 'y') return { type: 'redo' };
    return null;
  }
  if (command) return null;
  if (event.altKey) {
    if (event.shiftKey) return null;
    if (key === 'Home') return { type: 'move', to: 'start' };
    if (key === 'ArrowLeft') return { type: 'move', to: 'earlier' };
    if (key === 'ArrowRight') return { type: 'move', to: 'later' };
    if (key === 'End') return { type: 'move', to: 'end' };
    return null;
  }
  if (key === 'r') return { type: 'turn', by: event.shiftKey ? -90 : 90 };
  // Backspace is the delete key of a Mac keyboard.
  if ((key === 'Delete' || key === 'Backspace') && !event.shiftKey) return { type: 'remove' };
  if (key === ' ') return { type: 'choose', index: focus, mode: 'toggle' };
  return null;
}

/** What a screen reader hears for the tile at `position`, e.g. "Page 3 (was page 7), turned right, position 3 of 40"; '' when there is none. */
export function tileDescription(state: OrganiseEditState, position: number): string {
  const tile = state.tiles[position];
  if (!tile) return '';
  const where = `position ${position + 1} of ${state.tiles.length}`;
  const original = tile.source + 1;
  if (tile.removed) return `Page ${original}, removed, ${where}`;
  const page = state.tiles.slice(0, position + 1).filter((t) => !t.removed).length;
  const was = page === original ? '' : ` (was page ${original})`;
  // In words, not the angle of the change (user QA 2.12: "270°" read as the page's position).
  const quarter = ((Math.round(tile.turn / 90) % 4) + 4) % 4;
  const turn = quarter === 0 ? '' : `, turned ${quarter === 1 ? 'right' : quarter === 3 ? 'left' : '180°'}`;
  return `Page ${page}${was}${turn}, ${where}`;
}
