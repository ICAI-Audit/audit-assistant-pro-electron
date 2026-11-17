import { describe, expect, it } from 'vitest';
import type { OutlineItem } from '@/lib/pdf-tools/outline';
import { bookmarkEditReducer, initialBookmarkState, type BookmarkEditAction, type BookmarkEditState } from '../bookmarkEdit';
import {
  codePoints,
  countLabel,
  commandsFor,
  deleteQuestion,
  whyUnavailable,
  describeEdit,
  editCounts,
  limitTyped,
  longTitlesNotice,
  notCarriedNotice,
  notCarriedReason,
  positionOf,
  renameProblem,
  rowWindow,
  scrollToShow,
  titleCounter,
  treeRows,
  treesDiffer,
} from './bookmarkView';

const XYZ = { kind: 'XYZ', args: [0, 792, null] } as const;
const item = (title: string, page: number | null, children: OutlineItem[] = [], extra: Partial<OutlineItem> = {}): OutlineItem => ({
  title,
  page,
  children,
  open: true,
  ...extra,
});

/** A (p1), B (p2) with B1 (p3) and B2 (p4, B2a p5 under it), C (p6). Ids b1..b7 in that order. */
const sample = (): OutlineItem[] => [item('A', 0), item('B', 1, [item('B1', 2), item('B2', 3, [item('B2a', 4)])]), item('C', 5)];

const run = (state: BookmarkEditState, ...actions: BookmarkEditAction[]) => actions.reduce(bookmarkEditReducer, state);

describe('treeRows', () => {
  it('lists every bookmark in reading order with its depth, place among its siblings and position in the list', () => {
    const rows = treeRows(initialBookmarkState(sample()).items, (b) => b.id);
    expect(rows.map((r) => [r.key, r.depth, r.label, r.position, r.posInSet, r.setSize, r.hasChildren])).toEqual([
      ['b1', 0, 'A', 1, 1, 3, false],
      ['b2', 0, 'B', 2, 2, 3, true],
      ['b3', 1, 'B1', 3, 1, 2, false],
      ['b4', 1, 'B2', 4, 2, 2, true],
      ['b5', 2, 'B2a', 5, 1, 1, false],
      ['b6', 0, 'C', 6, 3, 3, false],
    ]);
  });

  it('a collapsed bookmark hides what is under it, and later rows keep their position in the list', () => {
    const rows = treeRows(initialBookmarkState(sample()).items, (b) => b.id, new Set(['b2']));
    expect(rows.map((r) => [r.key, r.position, r.expanded])).toEqual([
      ['b1', 1, false],
      ['b2', 2, false],
      ['b6', 6, false],
    ]);
    expect(treeRows(initialBookmarkState(sample()).items, (b) => b.id).find((r) => r.key === 'b2')?.expanded).toBe(true);
  });

  it('shows an untitled bookmark as "(untitled)", marks bookmarks that are not carried and keeps web links', () => {
    const rows = treeRows(
      [item('', 0, [], { untitled: true }), item('Other file', null, [], { unresolved: 'remote' }), item('Site', null, [], { uri: 'https://example.in/' })],
      (_, path) => path.join('.'),
    );
    expect(rows.map((r) => [r.key, r.label, r.notCarried, r.uri ?? null, r.page])).toEqual([
      ['0', '(untitled)', null, null, 0],
      ['1', 'Other file', 'remote', null, null],
      ['2', 'Site', null, 'https://example.in/', null],
    ]);
  });

  // Alone on the build machine about 10-20 ms; the guard allows for other work sharing the machine.
  it('flattens 10,000 bookmarks quickly', () => {
    const many = Array.from({ length: 2_000 }, (_, i) => item(`Top ${i}`, i % 50, [item('a', 0), item('b', 1), item('c', 2), item('d', 3)]));
    treeRows(many, (_, path) => path.join('.')); // warm up
    // This thread's processor time, not the clock (which on a busy machine also counts other work).
    const started = process.threadCpuUsage();
    const rows = treeRows(many, (_, path) => path.join('.'));
    const used = process.threadCpuUsage(started);
    expect(rows).toHaveLength(10_000);
    expect(rows[9_999]).toMatchObject({
      key: '1999.3',
      position: 10_000,
      depth: 1,
    });
    expect((used.user + used.system) / 1000).toBeLessThan(500);
  });
});

describe('rowWindow and scrollToShow', () => {
  it('renders only the rows in view, with a margin either side', () => {
    expect(rowWindow(0, 320, 32, 1000, 4)).toEqual({ start: 0, end: 14 });
    expect(rowWindow(3200, 320, 32, 1000, 4)).toEqual({ start: 96, end: 114 });
    expect(rowWindow(31_900, 320, 32, 1000, 4)).toEqual({
      start: 992,
      end: 1000,
    });
    expect(rowWindow(0, 320, 32, 0, 4)).toEqual({ start: 0, end: 0 });
    // before the box has a height, a screenful is assumed rather than nothing
    expect(rowWindow(0, 0, 32, 1000, 4).end).toBeGreaterThan(10);
  });

  it('scrolls a row into view only when it is not already in view', () => {
    expect(scrollToShow(5, 32, 0, 320)).toBeNull();
    expect(scrollToShow(20, 32, 0, 320)).toBe(21 * 32 - 320);
    expect(scrollToShow(2, 32, 320, 320)).toBe(64);
  });
});

describe('commandsFor', () => {
  const state = (selected: string | null) => ({
    ...initialBookmarkState(sample()),
    selected,
  });

  it('offers only what the edit model would do for the selected bookmark', () => {
    expect(commandsFor(state('b3'), true)).toEqual({
      rename: true,
      up: false,
      down: true,
      indent: false,
      outdent: true,
      delete: true,
      undo: false,
      redo: false,
    });
    expect(commandsFor(state('b6'), true)).toMatchObject({
      up: true,
      down: false,
      indent: true,
      outdent: false,
    });
    expect(commandsFor(state('b2'), true)).toMatchObject({ indent: false }); // it has bookmarks under it
    expect(commandsFor(state('b1'), true)).toMatchObject({
      up: false,
      indent: false,
    });
    expect(commandsFor(state('b5'), true)).toMatchObject({
      outdent: true,
      indent: false,
    });
    expect(commandsFor(state(null), true)).toEqual({
      rename: false,
      up: false,
      down: false,
      indent: false,
      outdent: false,
      delete: false,
      undo: false,
      redo: false,
    });
  });

  it('offers undo and redo from the history', () => {
    const after = run(state('b6'), { type: 'move', id: 'b6', direction: 'up' });
    expect(commandsFor(after, true)).toMatchObject({ undo: true, redo: false });
    expect(commandsFor(run(after, { type: 'undo' }), true)).toMatchObject({
      undo: false,
      redo: true,
    });
  });

  it('a bookmark that is not carried can only be removed, and nothing goes under it', () => {
    const items = [item('A', 0), item('Script', null, [], { unresolved: 'other-action' }), item('C', 2)];
    const base = initialBookmarkState(items);
    expect(commandsFor({ ...base, selected: 'b2' }, true)).toMatchObject({
      rename: false,
      up: false,
      down: false,
      indent: false,
      outdent: false,
      delete: true,
    });
    expect(commandsFor({ ...base, selected: 'b3' }, true)).toMatchObject({
      indent: false,
      up: true,
    });
  });

  it('nothing is offered on a file that cannot be edited', () => {
    expect(Object.values(commandsFor(state('b3'), false)).some(Boolean)).toBe(false);
  });
});

describe('whyUnavailable (what an unavailable button says on hover, focus and press)', () => {
  const state = (selected: string | null) => ({
    ...initialBookmarkState(sample()),
    selected,
  });

  it('says nothing for a button that works', () => {
    for (const command of ['rename', 'down', 'outdent', 'delete'] as const) expect(whyUnavailable(state('b3'), true, command)).toBeNull();
    expect(whyUnavailable(state(null), true, 'add')).toBeNull();
  });

  it('gives the reason for each button that does not', () => {
    expect(whyUnavailable(null, true, 'add')).toBe('The bookmarks are still being read.');
    // Never "still being read" once the reading has stopped (QA-FIX B: the two said opposite things at once).
    expect(whyUnavailable(null, true, 'add', 'failed')).toBe('The file has to be read again first: press Try again.');
    expect(whyUnavailable(null, true, 'rename', 'reading')).toBe('The bookmarks are still being read.');
    expect(whyUnavailable(state('b3'), false, 'rename')).toBe('This file has too many bookmarks, or levels, to edit here. Every other tool can still use it.');
    expect(whyUnavailable(state(null), true, 'up')).toBe('Choose a bookmark in the list first.');
    expect(whyUnavailable(state('b1'), true, 'up')).toBe("'A' is already first at its level.");
    expect(whyUnavailable(state('b3'), true, 'indent')).toBe('Only a top-level bookmark can be indented: bookmarks nest one level.');
    expect(whyUnavailable(state('b1'), true, 'outdent')).toBe("'A' is already at the top level.");
    expect(whyUnavailable(state('b1'), true, 'undo')).toBe('Nothing to undo yet.');
    expect(whyUnavailable(state('b1'), true, 'redo')).toBe('Nothing to redo.');
  });

  it('a bookmark that is not carried can only be removed; nothing goes under one', () => {
    const base = initialBookmarkState([item('A', 0), item('Script', null, [], { unresolved: 'other-action' }), item('C', 2)]);
    expect(whyUnavailable({ ...base, selected: 'b2' }, true, 'rename')).toBe("'Script' will not be kept when the file is saved. It can only be removed.");
    expect(whyUnavailable({ ...base, selected: 'b2' }, true, 'delete')).toBeNull();
    expect(whyUnavailable({ ...base, selected: 'b3' }, true, 'indent')).toBe("'C' cannot go under 'Script', which will not be kept.");
  });

  it('no bookmark is added past 10,000', () => {
    const many = initialBookmarkState(Array.from({ length: 10_000 }, (_, i) => item(`B${i}`, 0)));
    expect(whyUnavailable(many, true, 'add')).toBe('A file can have at most 10,000 bookmarks.');
  });
});

describe('describeEdit (the line read out after each action)', () => {
  const base = { ...initialBookmarkState(sample()), selected: 'b6' };

  it('says where a moved bookmark now is', () => {
    const moved = run(base, { type: 'move', id: 'b6', direction: 'up' });
    expect(describeEdit(base, moved, { type: 'move', id: 'b6', direction: 'up' })).toBe("Moved 'C' up: now 2 of 3 at the top level.");
    const inner = { ...base, selected: 'b4' };
    const up = run(inner, { type: 'move', id: 'b4', direction: 'up' });
    expect(describeEdit(inner, up, { type: 'move', id: 'b4', direction: 'up' })).toBe("Moved 'B2' up: now 1 of 2 under 'B'.");
  });

  it('says why nothing happened', () => {
    const first = { ...base, selected: 'b1' };
    expect(describeEdit(first, first, { type: 'move', id: 'b1', direction: 'up' })).toBe("'A' is already first at its level.");
    expect(describeEdit(base, base, { type: 'move', id: 'b6', direction: 'down' })).toBe("'C' is already last at its level.");
    expect(describeEdit(first, first, { type: 'indent', id: 'b1' })).toBe("'A' has no bookmark above it to go under.");
    expect(describeEdit(base, base, { type: 'indent', id: 'b2' })).toBe("'B' has bookmarks under it, so it cannot be indented.");
    expect(describeEdit(base, base, { type: 'indent', id: 'b3' })).toBe('Only a top-level bookmark can be indented: bookmarks nest one level.');
    expect(describeEdit(base, base, { type: 'outdent', id: 'b1' })).toBe("'A' is already at the top level.");
    expect(describeEdit(base, base, { type: 'undo' })).toBe('Nothing to undo.');
    expect(describeEdit(base, base, { type: 'redo' })).toBe('Nothing to redo.');
  });

  it('says what indent, outdent, add, rename, delete, undo and redo did', () => {
    const indented = run(base, { type: 'indent', id: 'b6' });
    expect(describeEdit(base, indented, { type: 'indent', id: 'b6' })).toBe("'C' is now under 'B': 3 of 3.");
    const out = run(base, { type: 'outdent', id: 'b3' });
    expect(describeEdit(base, out, { type: 'outdent', id: 'b3' })).toBe("Moved 'B1' out one level: now 3 of 4 at the top level.");
    const added = run(base, { type: 'add', page: 4, view: XYZ });
    expect(describeEdit(base, added, { type: 'add', page: 4, view: XYZ })).toBe('Added a bookmark for page 5. Type its title, then press Enter.');
    const renamed = run(base, { type: 'rename', id: 'b6', title: 'Annexure' });
    expect(
      describeEdit(base, renamed, {
        type: 'rename',
        id: 'b6',
        title: 'Annexure',
      }),
    ).toBe("Renamed to 'Annexure'.");
    const deleted = run(base, { type: 'delete', id: 'b2' });
    expect(describeEdit(base, deleted, { type: 'delete', id: 'b2' })).toBe("Removed 'B' and the 3 bookmarks under it.");
    const one = run(base, { type: 'delete', id: 'b1' });
    expect(describeEdit(base, one, { type: 'delete', id: 'b1' })).toBe("Removed 'A'.");
    expect(describeEdit(one, run(one, { type: 'undo' }), { type: 'undo' })).toBe('Undone.');
    const undone = run(one, { type: 'undo' });
    expect(describeEdit(undone, run(undone, { type: 'redo' }), { type: 'redo' })).toBe('Redone.');
  });

  it('shortens a long title in what it reads out', () => {
    const long = initialBookmarkState([item('x'.repeat(300), 0), item('B', 1)]);
    const said = describeEdit(long, long, {
      type: 'move',
      id: 'b1',
      direction: 'up',
    });
    expect(said.length).toBeLessThan(120);
    expect(said).toContain('…');
  });
});

describe('titles as typed', () => {
  it('counts characters, not UTF-16 units', () => {
    expect(codePoints('नमस्ते')).toBe(6);
    expect(codePoints('\u{1F600}')).toBe(1);
  });

  it('stops typing at 256 characters without cutting a character in two', () => {
    const emoji = '\u{1F600}'.repeat(300);
    const cut = limitTyped(emoji);
    expect(codePoints(cut)).toBe(256);
    expect(cut.length).toBe(512);
    expect(limitTyped('short')).toBe('short');
  });

  it('shows a counter only near the limit', () => {
    expect(titleCounter('a'.repeat(199))).toBeNull();
    expect(titleCounter('a'.repeat(200))).toBe('200 of 256 characters');
    expect(titleCounter('a'.repeat(256))).toBe('256 of 256 characters: the most a title can have');
  });

  it('an emptied title is refused, naming the bookmark by its place in the list', () => {
    const state = initialBookmarkState(sample());
    expect(renameProblem(state.items, 'b3', '   ')).toBe('A bookmark needs a title. (Bookmark 3 in the list has none.)');
    expect(renameProblem(state.items, 'b6', '\u200B\u200E')).toBe('A bookmark needs a title. (Bookmark 6 in the list has none.)');
    expect(renameProblem(state.items, 'b6', 'Annexure')).toBeNull();
    expect(positionOf(state.items, 'b5')).toBe(5);
    expect(positionOf(state.items, 'missing')).toBe(0);
  });
});

describe('countLabel', () => {
  it('writes counts as the rest of PDF Tools does (en-IN grouping)', () => {
    expect(countLabel(1, 'bookmark')).toBe('1 bookmark');
    expect(countLabel(0, 'bookmark')).toBe('0 bookmarks');
    expect(countLabel(2_001, 'bookmark')).toBe('2,001 bookmarks');
    expect(countLabel(10_000, 'bookmark')).toBe('10,000 bookmarks');
    expect(countLabel(100_000, 'bookmark')).toBe('1,00,000 bookmarks');
  });
});

describe('questions and notices', () => {
  it('asks before deleting a bookmark that has bookmarks under it', () => {
    const { items } = initialBookmarkState([...sample(), item('D', 0, [item('D1', 0)])]);
    expect(deleteQuestion(items[0])).toBeNull();
    expect(deleteQuestion(items[1])).toBe("Remove 'B' and the 3 bookmarks under it?");
    expect(deleteQuestion(items[3])).toBe("Remove 'D' and the bookmark under it?");
  });

  it('says how many bookmarks will not be kept, and why', () => {
    const two = initialBookmarkState([
      item('Other', null, [], { unresolved: 'remote' }),
      item('Script', null, [], { unresolved: 'other-action' }),
      item('Web', null, [], { uri: 'https://x.in' }),
    ]);
    expect(notCarriedNotice(two.items)).toBe('2 bookmarks that open other files or run scripts will not be kept.');
    const one = initialBookmarkState([item('Script', null, [item('Kid', 0)], { unresolved: 'other-action' })]);
    expect(notCarriedNotice(one.items)).toBe('1 bookmark that opens another file or runs a script will not be kept. The bookmarks under it move up one level.');
    const nowhere = initialBookmarkState([item('Gone', null, [], { unresolved: 'badpage' }), item('Script', null, [], { unresolved: 'other-action' })]);
    expect(notCarriedNotice(nowhere.items)).toBe('2 bookmarks that open other files, run scripts or go to no page of this file will not be kept.');
    expect(notCarriedNotice(initialBookmarkState(sample()).items)).toBeNull();
    expect(notCarriedReason('remote')).toBe('Opens another file');
    expect(notCarriedReason('other-action')).toBe('Launches something or runs a script');
    expect(notCarriedReason('no-target')).toBe('Goes to no page of this file');
  });

  it('says when titles longer than 1,000 characters will be shortened', () => {
    expect(longTitlesNotice(0)).toBeNull();
    expect(longTitlesNotice(1)).toBe('1 bookmark title is longer than 1,000 characters. It is shortened to 1,000 characters when saved.');
    expect(longTitlesNotice(3)).toBe('3 bookmark titles are longer than 1,000 characters. They are shortened to 1,000 characters when saved.');
  });
});

describe('editCounts and treesDiffer', () => {
  it('counts what was added, renamed, moved and removed, and how many bookmarks will be saved', () => {
    const start = initialBookmarkState([...sample(), item('Script', null, [], { unresolved: 'other-action' })]);
    const end = run(
      { ...start, selected: 'b6' },
      { type: 'move', id: 'b6', direction: 'up' },
      { type: 'move', id: 'b6', direction: 'up' }, // C to the top: one bookmark moved
      { type: 'rename', id: 'b1', title: 'A, renamed' },
      { type: 'outdent', id: 'b5' }, // B2a out of B2: moved
      { type: 'delete', id: 'b3' },
      { type: 'select', id: null },
      { type: 'add', page: 0, view: XYZ },
    );
    expect(editCounts(start.items, end.items)).toEqual({
      bookmarks: 6,
      added: 1,
      renamed: 1,
      moved: 2,
      removed: 1,
      notCarried: 1,
    });
  });

  it('a removed bookmark counts with everything under it', () => {
    const start = initialBookmarkState(sample());
    expect(editCounts(start.items, run(start, { type: 'delete', id: 'b2' }).items)).toMatchObject({ removed: 4, bookmarks: 2, moved: 0 });
  });

  it('a tree changed and changed back is not a change; deleting a bookmark that is not carried is', () => {
    const start = initialBookmarkState([...sample(), item('Script', null, [], { unresolved: 'other-action' })]);
    const back = run(start, { type: 'rename', id: 'b1', title: 'X' }, { type: 'rename', id: 'b1', title: 'A' });
    expect(back.changed).toBe(true);
    expect(treesDiffer(start.items, back.items)).toBe(false);
    expect(treesDiffer(start.items, run(start, { type: 'delete', id: 'b7' }).items)).toBe(true);
    const added = run(start, { type: 'add', page: 0, view: XYZ });
    expect(treesDiffer(start.items, added.items)).toBe(true);
    expect(treesDiffer(start.items, run(added, { type: 'delete', id: added.selected! }).items)).toBe(false);
  });
});
