// The Organise pages grid's layout rules: 200 tiles at a time as in the page panel (design 4 and
// 5.15), the gap a dragged tile is dropped into, and the page number each tile shows.
import { describe, expect, it } from 'vitest';
import { createOrganiseState, organiseEditReducer } from '../organiseEdit';
import { dropGap, GRID_WINDOW, moveTargetForPage, readPosition, shownNumbers, shownTiles, windowLabel, windowOf } from './gridLayout';

describe('windowOf', () => {
  it('200 tiles at a time, the window holding the given place', () => {
    expect(GRID_WINDOW).toBe(200);
    expect(windowOf(0, 300)).toEqual({ start: 0, end: 200 });
    expect(windowOf(199, 300)).toEqual({ start: 0, end: 200 });
    expect(windowOf(200, 300)).toEqual({ start: 200, end: 300 });
    expect(windowOf(299, 300)).toEqual({ start: 200, end: 300 });
    expect(windowOf(450, 300)).toEqual({ start: 200, end: 300 });
    expect(windowOf(-3, 300)).toEqual({ start: 0, end: 200 });
    expect(windowOf(5, 40)).toEqual({ start: 0, end: 40 });
    expect(windowOf(0, 0)).toEqual({ start: 0, end: 0 });
  });
  it('says which tiles are shown, in Indian digit grouping', () => {
    expect(windowLabel({ start: 200, end: 400 }, 1500)).toBe('Showing 201–400 of 1,500');
  });
});

describe('dropGap', () => {
  it('the left half of a tile drops before it, the right half after it', () => {
    expect(dropGap(4, 110, 100, 40)).toBe(4);
    expect(dropGap(4, 119, 100, 40)).toBe(4);
    expect(dropGap(4, 121, 100, 40)).toBe(5);
    expect(dropGap(4, 139, 100, 40)).toBe(5);
  });
  it('a tile with no width drops before it', () => {
    expect(dropGap(2, 50, 50, 0)).toBe(2);
  });
});

describe('shownTiles: the tiles of the window, each with its place in the whole grid (review M3a)', () => {
  it('places start at the window, not at 0', () => {
    const tiles = createOrganiseState(300).tiles;
    const shown = shownTiles(tiles, windowOf(250, 300));
    expect(shown).toHaveLength(100);
    expect(shown[0]).toEqual({ tile: tiles[200], place: 200 });
    expect(shown[99]).toEqual({ tile: tiles[299], place: 299 });
    expect(shownTiles(tiles, windowOf(0, 300))[5]).toEqual({ tile: tiles[5], place: 5 });
  });
});

describe('readPosition (Move to position…: a page number in the result)', () => {
  it('a whole number from 1 to the pages in the result is an index from 0; empty is nothing yet; anything else says what to type', () => {
    expect(readPosition('', 40)).toEqual({ place: null, error: null });
    expect(readPosition('  ', 40)).toEqual({ place: null, error: null });
    expect(readPosition('1', 40)).toEqual({ place: 0, error: null });
    expect(readPosition(' 40 ', 40)).toEqual({ place: 39, error: null });
    for (const bad of ['0', '41', '-2', '2.5', '1e1', 'abc', '3 4']) expect(readPosition(bad, 40), bad).toEqual({ place: null, error: 'Type a page number from 1 to 40.' });
  });
});

describe('moveTargetForPage: Move to position counts pages in the result, not removed tiles (review wording)', () => {
  const run = (state: ReturnType<typeof createOrganiseState>, ...actions: Parameters<typeof organiseEditReducer>[1][]) => actions.reduce(organiseEditReducer, state);
  it('the chosen page becomes that page of the result, removed tiles not counted', () => {
    // tiles 0 1 2 3 4 5; pages 2 and 3 (sources 1, 2) removed; choose source 5 and make it page 2 of the result
    let state = run(createOrganiseState(6), { type: 'choose', index: 1, mode: 'only' }, { type: 'choose', index: 2, mode: 'range' }, { type: 'remove' }, { type: 'choose', index: 5, mode: 'only' });
    state = run(state, { type: 'move', to: moveTargetForPage(state, 1) });
    expect(shownNumbers(state.tiles)[state.tiles.findIndex((t) => t.source === 5)]).toBe(2);
    state = run(state, { type: 'move', to: moveTargetForPage(state, 0) });
    expect(state.tiles[0].source).toBe(5);
    state = run(state, { type: 'move', to: moveTargetForPage(state, 3) });
    expect(shownNumbers(state.tiles)[state.tiles.findIndex((t) => t.source === 5)]).toBe(4);
  });
});

describe('shownNumbers', () => {
  it('each kept tile shows its page number in the result; a removed one shows none', () => {
    let state = createOrganiseState(5);
    state = organiseEditReducer(state, { type: 'choose', index: 4, mode: 'only' });
    state = organiseEditReducer(state, { type: 'move', to: 'start' }); // 4 0 1 2 3
    state = organiseEditReducer(state, { type: 'choose', index: 2, mode: 'only' });
    state = organiseEditReducer(state, { type: 'remove' }); // page 1 (source 1) removed
    expect(shownNumbers(state.tiles)).toEqual([1, 2, null, 3, 4]);
  });
});
