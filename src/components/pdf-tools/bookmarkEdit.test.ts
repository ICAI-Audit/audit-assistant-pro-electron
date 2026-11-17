import { describe, expect, it } from 'vitest';
import type { OutlineItem } from '@/lib/pdf-tools/outline';
import {
  BOOKMARK_HISTORY,
  bookmarkCount,
  bookmarkLabel,
  UNTITLED_LABEL,
  bookmarkEditReducer,
  initialBookmarkState,
  notCarriedCount,
  toOutline,
  type BookmarkEditAction,
  type BookmarkEditState,
  type EditableBookmark,
} from './bookmarkEdit';

const XYZ = { kind: 'XYZ', args: [0, 400, null] } as const;
const leaf = (title: string, page: number | null, extra: Partial<OutlineItem> = {}): OutlineItem => ({ title, page, open: false, children: [], ...extra });
const run = (state: BookmarkEditState, ...actions: BookmarkEditAction[]) => actions.reduce(bookmarkEditReducer, state);
const titles = (items: readonly EditableBookmark[]): string[] => items.flatMap((i) => [`${'-'.repeat(i.depth)}${i.title}`, ...titles(i.children)]);
const idOf = (state: BookmarkEditState, title: string): string => {
  const find = (items: readonly EditableBookmark[]): string | undefined => {
    for (const item of items) {
      if (item.title === title) return item.id;
      const below = find(item.children);
      if (below) return below;
    }
    return undefined;
  };
  return find(state.items)!;
};

describe('add', () => {
  it('on page 3 of an empty tree gives one bookmark "Page 3" at page index 2, selected, with the /XYZ view', () => {
    const state = run(initialBookmarkState([]), { type: 'add', page: 2, view: XYZ });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ title: 'Page 3', page: 2, view: XYZ, depth: 0, open: false, children: [] });
    expect(state.selected).toBe(state.items[0].id);
    expect(state.changed).toBe(true);
  });
  it('goes after the selected bookmark at its level, or at the end of the top level when nothing is selected', () => {
    let state = initialBookmarkState([leaf('A', 0), leaf('B', 1), leaf('C', 2)]);
    state = run(state, { type: 'select', id: idOf(state, 'A') }, { type: 'add', page: 5, view: XYZ });
    expect(titles(state.items)).toEqual(['A', 'Page 6', 'B', 'C']);
    state = run(state, { type: 'select', id: null }, { type: 'add', page: 7, view: XYZ });
    expect(titles(state.items)).toEqual(['A', 'Page 6', 'B', 'C', 'Page 8']);
  });
  it('after a child goes at the child level', () => {
    let state = initialBookmarkState([{ ...leaf('A', 0), children: [leaf('A1', 1)] }, leaf('B', 2)]);
    state = run(state, { type: 'select', id: idOf(state, 'A1') }, { type: 'add', page: 3, view: XYZ });
    expect(titles(state.items)).toEqual(['A', '-A1', '-Page 4', 'B']);
    expect(state.items[0].children[1].depth).toBe(1);
  });
  it('gives each new bookmark its own id, even after a delete and an undo', () => {
    let state = run(initialBookmarkState([]), { type: 'add', page: 0, view: XYZ }, { type: 'add', page: 1, view: XYZ });
    const [first, second] = state.items.map((i) => i.id);
    expect(first).not.toBe(second);
    state = run(state, { type: 'delete', id: second }, { type: 'undo' }, { type: 'add', page: 2, view: XYZ });
    expect(new Set(state.items.map((i) => i.id)).size).toBe(state.items.length);
  });
  it('adds nothing past 10,000 bookmarks, or for a page that is not a whole number', () => {
    const many = initialBookmarkState(Array.from({ length: 10_000 }, (_, i) => leaf(`B${i}`, 0)));
    expect(run(many, { type: 'add', page: 0, view: XYZ })).toBe(many);
    const empty = initialBookmarkState([]);
    expect(run(empty, { type: 'add', page: -1, view: XYZ })).toBe(empty);
    expect(run(empty, { type: 'add', page: 1.5, view: XYZ })).toBe(empty);
  });
});

describe('rename', () => {
  const start = initialBookmarkState([leaf('A', 0), leaf('B', 1)]);
  it('cleans the title the way a typed title is cleaned', () => {
    const state = run(start, { type: 'rename', id: idOf(start, 'A'), title: '  क्\u200dष \u202eNotes\u200b \u0007 here  ' });
    expect(state.items[0].title).toBe('क्\u200dष Notes here');
    expect(state.changed).toBe(true);
  });
  it('cuts a title at 256 characters', () => {
    expect([...run(start, { type: 'rename', id: idOf(start, 'A'), title: 'x'.repeat(400) }).items[0].title]).toHaveLength(256);
  });
  it('changes nothing for an empty title, a title that cleans to nothing, the same title, or a bookmark that is not there', () => {
    const id = idOf(start, 'A');
    expect(run(start, { type: 'rename', id, title: '  ' })).toBe(start);
    expect(run(start, { type: 'rename', id, title: '\u200b\u202e' })).toBe(start);
    expect(run(start, { type: 'rename', id, title: ' A ' })).toBe(start);
    expect(run(start, { type: 'rename', id: 'nope', title: 'x' })).toBe(start);
  });
});

describe('move', () => {
  const start = initialBookmarkState([{ ...leaf('A', 0), children: [leaf('A1', 1), leaf('A2', 2)] }, leaf('B', 3), leaf('C', 4)]);
  it('moves within its level, and a move of the first up or the last down changes nothing', () => {
    expect(titles(run(start, { type: 'move', id: idOf(start, 'B'), direction: 'up' }).items)).toEqual(['B', 'A', '-A1', '-A2', 'C']);
    expect(titles(run(start, { type: 'move', id: idOf(start, 'A'), direction: 'down' }).items)).toEqual(['B', 'A', '-A1', '-A2', 'C']);
    expect(titles(run(start, { type: 'move', id: idOf(start, 'A2'), direction: 'up' }).items)).toEqual(['A', '-A2', '-A1', 'B', 'C']);
    expect(run(start, { type: 'move', id: idOf(start, 'A'), direction: 'up' })).toBe(start);
    expect(run(start, { type: 'move', id: idOf(start, 'C'), direction: 'down' })).toBe(start);
    expect(run(start, { type: 'move', id: idOf(start, 'A2'), direction: 'down' })).toBe(start);
  });
});

describe('indent and outdent', () => {
  const start = initialBookmarkState([leaf('A', 0), leaf('B', 1), leaf('C', 2)]);
  it('indent of the first top-level bookmark changes nothing', () => {
    expect(run(start, { type: 'indent', id: idOf(start, 'A') })).toBe(start);
  });
  it('indent of the second makes it the first one\'s last child, opens the parent, and sets the depth', () => {
    const state = run(start, { type: 'indent', id: idOf(start, 'B') });
    expect(titles(state.items)).toEqual(['A', '-B', 'C']);
    expect(state.items[0].open).toBe(true);
    const again = run(state, { type: 'indent', id: idOf(start, 'C') });
    expect(titles(again.items)).toEqual(['A', '-B', '-C']);
  });
  it('indent of a bookmark that is already a child changes nothing (one new level only)', () => {
    const state = run(start, { type: 'indent', id: idOf(start, 'B') }, { type: 'indent', id: idOf(start, 'C') });
    expect(run(state, { type: 'indent', id: idOf(state, 'C') })).toBe(state);
  });
  it('indent of a bookmark with bookmarks under it changes nothing (it would nest a third level)', () => {
    const tree = initialBookmarkState([leaf('A', 0), { ...leaf('B', 1), children: [leaf('B1', 2)] }]);
    expect(run(tree, { type: 'indent', id: idOf(tree, 'B') })).toBe(tree);
  });
  it('outdent returns it to the level of its parent, right after it', () => {
    const nested = run(start, { type: 'indent', id: idOf(start, 'B') });
    const back = run(nested, { type: 'outdent', id: idOf(nested, 'B') });
    expect(titles(back.items)).toEqual(['A', 'B', 'C']);
    expect(back.items.map((i) => i.depth)).toEqual([0, 0, 0]);
    expect(run(start, { type: 'outdent', id: idOf(start, 'A') })).toBe(start);
  });
  it('outdent of one of several children leaves the next ones under the parent', () => {
    const tree = initialBookmarkState([{ ...leaf('A', 0), children: [leaf('A1', 1), leaf('A2', 2), leaf('A3', 3)] }, leaf('B', 4)]);
    const state = run(tree, { type: 'outdent', id: idOf(tree, 'A2') });
    expect(titles(state.items)).toEqual(['A', '-A1', '-A3', 'A2', 'B']);
  });
  it('a bookmark of a file nested three levels deep keeps its depth after its parent moves, and is not flattened', () => {
    const tree = initialBookmarkState([leaf('Z', 9), { ...leaf('A', 0), children: [{ ...leaf('A1', 1), children: [leaf('A1a', 2)] }] }]);
    expect(titles(tree.items)).toEqual(['Z', 'A', '-A1', '--A1a']);
    const moved = run(tree, { type: 'move', id: idOf(tree, 'A'), direction: 'up' });
    expect(titles(moved.items)).toEqual(['A', '-A1', '--A1a', 'Z']);
    expect(moved.items[0].children[0].children[0].depth).toBe(2);
    // outdent of its parent lifts the whole branch one level and the depths follow
    const lifted = run(tree, { type: 'outdent', id: idOf(tree, 'A1') });
    expect(titles(lifted.items)).toEqual(['Z', 'A', 'A1', '-A1a']);
    // rename and delete work at any depth
    const renamed = run(tree, { type: 'rename', id: idOf(tree, 'A1a'), title: 'Deep' });
    expect(titles(renamed.items)).toEqual(['Z', 'A', '-A1', '--Deep']);
    expect(toOutline(renamed)[1].children[0].children[0].title).toBe('Deep');
  });
});

describe('delete', () => {
  it('removes a bookmark and what is under it, and selects a neighbour', () => {
    let state = initialBookmarkState([{ ...leaf('A', 0), children: [leaf('A1', 1), leaf('A2', 2), leaf('A3', 3)] }, leaf('B', 4)]);
    state = run(state, { type: 'select', id: idOf(state, 'A') }, { type: 'delete', id: idOf(state, 'A') });
    expect(titles(state.items)).toEqual(['B']);
    expect(state.selected).toBe(state.items[0].id);
    expect(bookmarkCount(state.items)).toBe(1);
  });
  it('deleting a parent removes 1 plus its children (counted)', () => {
    const state = initialBookmarkState([{ ...leaf('A', 0), children: [leaf('A1', 1), leaf('A2', 2)] }, leaf('B', 3)]);
    expect(bookmarkCount(state.items)).toBe(4);
    expect(bookmarkCount(run(state, { type: 'delete', id: idOf(state, 'A') }).items)).toBe(1);
  });
  it('keeps another selection', () => {
    let state = initialBookmarkState([leaf('A', 0), leaf('B', 1)]);
    state = run(state, { type: 'select', id: idOf(state, 'B') }, { type: 'delete', id: idOf(state, 'A') });
    expect(state.selected).toBe(idOf(state, 'B'));
  });
  it('selects nothing when the last bookmark goes', () => {
    let state = initialBookmarkState([leaf('A', 0)]);
    state = run(state, { type: 'select', id: idOf(state, 'A') }, { type: 'delete', id: idOf(state, 'A') });
    expect(state.items).toEqual([]);
    expect(state.selected).toBeNull();
  });
});

describe('undo and redo', () => {
  it('five undos after five actions give the initial state back, with changed false', () => {
    const initial = initialBookmarkState([leaf('A', 0), leaf('B', 1), leaf('C', 2)]);
    let state = run(
      initial,
      { type: 'add', page: 5, view: XYZ },
      { type: 'rename', id: idOf(initial, 'A'), title: 'Alpha' },
      { type: 'move', id: idOf(initial, 'B'), direction: 'up' },
      { type: 'indent', id: idOf(initial, 'C') },
      { type: 'delete', id: idOf(initial, 'A') },
    );
    expect(state.changed).toBe(true);
    for (let i = 0; i < 5; i++) state = run(state, { type: 'undo' });
    expect(state.items).toEqual(initial.items);
    expect(state.selected).toBeNull();
    expect(state.past).toEqual([]);
    expect(state.changed).toBe(false);
    expect(run(state, { type: 'undo' })).toBe(state);
  });
  it('redo goes forward again, and a new action clears what could be redone', () => {
    const initial = initialBookmarkState([leaf('A', 0)]);
    let state = run(initial, { type: 'rename', id: idOf(initial, 'A'), title: 'One' }, { type: 'rename', id: idOf(initial, 'A'), title: 'Two' });
    state = run(state, { type: 'undo' });
    expect(state.items[0].title).toBe('One');
    expect(run(state, { type: 'redo' }).items[0].title).toBe('Two');
    const diverged = run(state, { type: 'rename', id: idOf(initial, 'A'), title: 'Three' });
    expect(diverged.future).toEqual([]);
    expect(run(diverged, { type: 'redo' })).toBe(diverged);
  });
  it('keeps 100 steps of 101 actions, and then undo cannot get back to the start', () => {
    const initial = initialBookmarkState([leaf('A', 0)]);
    const id = idOf(initial, 'A');
    let state = initial;
    for (let i = 0; i < 101; i++) state = run(state, { type: 'rename', id, title: `Title ${i}` });
    expect(state.past).toHaveLength(BOOKMARK_HISTORY);
    for (let i = 0; i < 100; i++) state = run(state, { type: 'undo' });
    expect(state.past).toHaveLength(0);
    expect(state.items[0].title).toBe('Title 0');
    expect(state.changed).toBe(true);
  });
  it('does not keep a selection that the undo made disappear', () => {
    const state = run(initialBookmarkState([]), { type: 'add', page: 0, view: XYZ }, { type: 'undo' });
    expect(state.selected).toBeNull();
    expect(state.items).toEqual([]);
  });
  it('select changes no history', () => {
    const initial = initialBookmarkState([leaf('A', 0)]);
    const state = run(initial, { type: 'select', id: idOf(initial, 'A') });
    expect(state.past).toEqual([]);
    expect(state.changed).toBe(false);
    expect(run(state, { type: 'select', id: 'nope' })).toBe(state);
  });
});

describe('bookmarks that cannot be carried', () => {
  const tree: OutlineItem[] = [
    leaf('Page one', 0),
    leaf('Other file', null, { unresolved: 'remote' }),
    leaf('Script', null, { unresolved: 'other-action', children: [leaf('Under the script', 1)] }),
    leaf('Web', null, { uri: 'https://example.in/' }),
    leaf('Nowhere', null, { unresolved: 'no-target' }),
  ];
  it('stay in the tree, are counted, and are left out of what is saved, with what was under them moved up', () => {
    const state = initialBookmarkState(tree);
    expect(titles(state.items)).toEqual(['Page one', 'Other file', 'Script', '-Under the script', 'Web', 'Nowhere']);
    expect(notCarriedCount(state.items)).toBe(3);
    expect(toOutline(state).map((i) => i.title)).toEqual(['Page one', 'Under the script', 'Web']);
  });
  it('can be renamed, moved and deleted like the others', () => {
    const state = initialBookmarkState(tree);
    const renamed = run(state, { type: 'rename', id: idOf(state, 'Other file'), title: 'Renamed' });
    expect(titles(renamed.items)).toContain('Renamed');
    expect(notCarriedCount(run(state, { type: 'delete', id: idOf(state, 'Other file') }).items)).toBe(2);
  });
  it('toOutline strips ids and depths and keeps the view, the open state, bold, italic and colour', () => {
    const state = initialBookmarkState([leaf('A', 0, { open: true, bold: true, italic: true, color: [1, 0, 0], view: { kind: 'FitH', args: [380] }, children: [leaf('A1', 1)] })]);
    const [out] = toOutline(state);
    expect(out).toEqual({ title: 'A', page: 0, open: true, bold: true, italic: true, color: [1, 0, 0], view: { kind: 'FitH', args: [380] }, children: [{ title: 'A1', page: 1, open: false, children: [] }] });
    expect('id' in out).toBe(false);
    expect('depth' in out).toBe(false);
  });
});

describe('an untitled bookmark of the file', () => {
  const tree: OutlineItem[] = [leaf('', 0, { untitled: true }), leaf('B', 1)];
  it('is shown as (untitled), kept as it is when saved, and gets a title only when the user types one', () => {
    const state = initialBookmarkState(tree);
    expect(UNTITLED_LABEL).toBe('(untitled)');
    expect(bookmarkLabel(state.items[0])).toBe('(untitled)');
    expect(bookmarkLabel(state.items[1])).toBe('B');
    expect(toOutline(state)[0]).toMatchObject({ title: '', untitled: true });
    const renamed = run(state, { type: 'rename', id: state.items[0].id, title: 'Named' });
    expect(bookmarkLabel(renamed.items[0])).toBe('Named');
    expect(toOutline(renamed)[0].untitled).toBeUndefined();
    expect(run(state, { type: 'rename', id: state.items[0].id, title: '  ' })).toBe(state);
  });
  it('a typed title over 256 characters is cut, while one read from the file is not', () => {
    const state = initialBookmarkState([leaf('x'.repeat(500), 0)]);
    expect(state.items[0].title).toHaveLength(500);
    expect([...run(state, { type: 'rename', id: state.items[0].id, title: 'y'.repeat(500) }).items[0].title]).toHaveLength(256);
  });
});
