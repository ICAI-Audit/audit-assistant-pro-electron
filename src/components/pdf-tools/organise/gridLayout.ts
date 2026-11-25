// Layout rules of the Organise pages grid: which 200 tiles exist at a time (as the page panel, design
// section 4), the gap a dragged tile drops into, and the page number each tile shows. No DOM here.
import type { OrganiseEditState, OrganiseTile } from '../organiseEdit';

/** At most this many tiles exist at a time, however long the file (the page panel's PAGE_WINDOW). */
export const GRID_WINDOW = 200;

export interface GridWindow {
  start: number;
  /** One past the last place shown. */
  end: number;
}

/** The window of GRID_WINDOW places that holds `place` (clamped to the grid). */
export function windowOf(place: number, total: number, size = GRID_WINDOW): GridWindow {
  if (total <= 0) return { start: 0, end: 0 };
  const at = Math.max(0, Math.min(total - 1, Math.trunc(place)));
  const start = Math.floor(at / size) * size;
  return { start, end: Math.min(total, start + size) };
}

const count = new Intl.NumberFormat('en-IN');

export function windowLabel(window: GridWindow, total: number): string {
  return `Showing ${count.format(window.start + 1)}–${count.format(window.end)} of ${count.format(total)}`;
}

/** The gap a tile is dropped into: before the tile at `place` over its left half, after it over its right half. */
export function dropGap(place: number, pointerX: number, left: number, width: number): number {
  return width > 0 && pointerX - left > width / 2 ? place + 1 : place;
}

/** The tiles of the window, each with its place in the whole grid (not in the window). */
export function shownTiles(tiles: readonly OrganiseTile[], window: GridWindow): { tile: OrganiseTile; place: number }[] {
  return tiles.slice(window.start, window.end).map((tile, i) => ({ tile, place: window.start + i }));
}

/**
 * "Move to position…": a page number of the result, a whole number from 1 to `count` (the pages kept),
 * gives an index from 0; anything else says what to type.
 */
export function readPosition(text: string, count: number): { place: number | null; error: string | null } {
  const value = text.trim();
  if (value === '') return { place: null, error: null };
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > count) return { place: null, error: `Type a page number from 1 to ${count}.` };
  return { place: Number(value) - 1, error: null };
}

/**
 * The reducer's `move` target that makes the chosen pages start at page `page` (from 0) of the result:
 * removed tiles are not counted (the tiles show page numbers of the result).
 */
export function moveTargetForPage(state: OrganiseEditState, page: number): number {
  const others = state.tiles.filter((tile) => !state.chosen.has(tile.source));
  let kept = 0;
  for (let i = 0; i < others.length; i++) {
    if (kept >= page) return i;
    if (!others[i].removed) kept += 1;
  }
  return others.length;
}

/** For each tile, its page number in the result (from 1), or null when it is removed. */
export function shownNumbers(tiles: readonly OrganiseTile[]): (number | null)[] {
  let page = 0;
  return tiles.map((tile) => (tile.removed ? null : ++page));
}
