// What the Bookmarks dialog and the bookmark list beside the page panel show (design 5.10): the tree
// as rows, the rows in view, which commands the selected bookmark allows, the line read out after
// each action, the title rules as typed, the notices, and the counts for the record. Pure: no React,
// no DOM. The edit model itself is bookmarkEdit.ts.
import { cleanTitle, OUTLINE_MAX_ITEMS, TITLE_TYPED_MAX, type OutlineItem, type Unresolved } from '@/lib/pdf-tools/outline';
import { BOOKMARK_TITLE_INVALID_MESSAGE } from '@/lib/pdf-tools/bookmarks';
import {
  bookmarkCount,
  bookmarkEditReducer,
  bookmarkLabel,
  notCarriedCount,
  type BookmarkEditAction,
  type BookmarkEditState,
  type EditableBookmark,
} from '../bookmarkEdit';
import { plural } from '../format';

// ---- rows ------------------------------------------------------------------------------------------

export interface TreeRow {
  /** The bookmark's id in the editor, or its path ("0.2.1") in the read-only list. */
  key: string;
  /** 1-based place in the whole list, in reading order, counting rows hidden under a collapsed one. */
  position: number;
  /** 0 for a top-level bookmark. */
  depth: number;
  label: string;
  /** Zero-based page, or null. */
  page: number | null;
  uri?: string;
  /** Why the bookmark is not carried, or null when it is. */
  notCarried: Unresolved | null;
  hasChildren: boolean;
  /** Has children and they are shown. */
  expanded: boolean;
  /** 1-based place among its siblings, and how many siblings there are (for aria-posinset and aria-setsize). */
  posInSet: number;
  setSize: number;
  bold: boolean;
  italic: boolean;
}

function descendants(item: Pick<OutlineItem, 'children'>): number {
  let total = 0;
  const stack = [...item.children];
  while (stack.length > 0) {
    const next = stack.pop()!;
    total++;
    stack.push(...next.children);
  }
  return total;
}

/**
 * The tree as rows in reading order. Rows under a key in `collapsed` are left out, but every row keeps
 * its position in the whole list, so a row's number never changes when another is collapsed.
 */
export function treeRows<T extends OutlineItem>(items: readonly T[], keyOf: (item: T, path: readonly number[]) => string, collapsed?: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  let position = 0;
  const path: number[] = []; // one array, pushed and popped: no copy per row
  const walk = (list: readonly T[], depth: number) => {
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      path.push(index);
      const key = keyOf(item, path);
      position++;
      const hasChildren = item.children.length > 0;
      const hidden = hasChildren && collapsed?.has(key) === true;
      const row: TreeRow = {
        key,
        position,
        depth,
        label: bookmarkLabel(item),
        page: item.page,
        notCarried: item.unresolved ?? null,
        hasChildren,
        expanded: hasChildren && !hidden,
        posInSet: index + 1,
        setSize: list.length,
        bold: item.bold === true,
        italic: item.italic === true,
      };
      if (item.uri !== undefined) row.uri = item.uri;
      rows.push(row);
      if (hidden) position += descendants(item);
      else walk(item.children as T[], depth + 1);
      path.pop();
    }
  };
  walk(items, 0);
  return rows;
}

/** 1-based place of a bookmark in the whole list, in reading order; 0 when it is not there. */
export function positionOf(items: readonly EditableBookmark[], id: string): number {
  let position = 0;
  const stack = [...items].reverse();
  while (stack.length > 0) {
    const item = stack.pop()!;
    position++;
    if (item.id === id) return position;
    for (let i = item.children.length - 1; i >= 0; i--) stack.push(item.children[i]);
  }
  return 0;
}

// ---- the rows in view ------------------------------------------------------------------------------

/** Assumed height of the box before it is measured, so the first paint shows rows rather than none. */
const VIEWPORT_GUESS = 600;

/** The rows to render for a scroll position: those in view and `overscan` either side. `end` is exclusive. */
export function rowWindow(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 8): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const height = viewport > 0 ? viewport : VIEWPORT_GUESS;
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + height) / rowHeight);
  return {
    start: Math.max(0, Math.min(count, first - overscan)),
    end: Math.min(count, last + overscan),
  };
}

/** The scroll position that brings row `index` fully into view, or null when it already is. */
export function scrollToShow(index: number, rowHeight: number, scrollTop: number, viewport: number): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return Math.max(0, bottom - viewport);
  return null;
}

// ---- commands --------------------------------------------------------------------------------------

export type EditCommand = 'rename' | 'up' | 'down' | 'indent' | 'outdent' | 'delete' | 'undo' | 'redo';

interface Located {
  item: EditableBookmark;
  siblings: EditableBookmark[];
  index: number;
  parent: EditableBookmark | null;
}

function locate(items: readonly EditableBookmark[], id: string, parent: EditableBookmark | null = null): Located | null {
  for (const [index, item] of items.entries()) {
    if (item.id === id) return { item, siblings: items as EditableBookmark[], index, parent };
    const below = locate(item.children, id, item);
    if (below) return below;
  }
  return null;
}

const ACTION_OF: Record<Exclude<EditCommand, 'rename' | 'delete' | 'undo' | 'redo'>, (id: string) => BookmarkEditAction> = {
  up: (id) => ({ type: 'move', id, direction: 'up' }),
  down: (id) => ({ type: 'move', id, direction: 'down' }),
  indent: (id) => ({ type: 'indent', id }),
  outdent: (id) => ({ type: 'outdent', id }),
};

/**
 * What the selected bookmark allows: exactly what the edit model would do (it returns the same state
 * for an action it refuses). A bookmark that is not carried can only be removed, and nothing is put
 * under one. A file that cannot be edited allows nothing.
 */
export function commandsFor(state: BookmarkEditState, editable: boolean): Record<EditCommand, boolean> {
  const none: Record<EditCommand, boolean> = {
    rename: false,
    up: false,
    down: false,
    indent: false,
    outdent: false,
    delete: false,
    undo: false,
    redo: false,
  };
  if (!editable) return none;
  const history = {
    undo: state.past.length > 0,
    redo: state.future.length > 0,
  };
  const at = state.selected === null ? null : locate(state.items, state.selected);
  if (!at) return { ...none, ...history };
  const notCarried = at.item.unresolved !== undefined;
  const would = (command: keyof typeof ACTION_OF) => !notCarried && bookmarkEditReducer(state, ACTION_OF[command](at.item.id)) !== state;
  const above = at.index > 0 ? at.siblings[at.index - 1] : null;
  return {
    rename: !notCarried,
    up: would('up'),
    down: would('down'),
    indent: would('indent') && above?.unresolved === undefined,
    outdent: would('outdent'),
    delete: true,
    ...history,
  };
}

// ---- what is read out ------------------------------------------------------------------------------

const SAID_TITLE_MAX = 50;

/** A title as it is read out or asked about: quoted, and cut short when long. */
function quoted(item: Pick<OutlineItem, 'title'>): string {
  const label = bookmarkLabel(item);
  const chars = Array.from(label);
  return `'${chars.length > SAID_TITLE_MAX ? `${chars.slice(0, SAID_TITLE_MAX).join('')}…` : label}'`;
}

function place(at: Located): string {
  return `${at.index + 1} of ${at.siblings.length} ${at.parent ? `under ${quoted(at.parent)}` : 'at the top level'}`;
}

const GROUPED = new Intl.NumberFormat('en-IN');

/** "2,001 bookmarks": a count grouped as the page panel writes page numbers. */
export function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${GROUPED.format(n)} ${n === 1 ? one : many}`;
}

/**
 * The line a screen reader hears after an action: what happened and where the bookmark now is, or why
 * nothing happened. `before` and `after` are the states either side of `action`.
 */
export function describeEdit(before: BookmarkEditState, after: BookmarkEditState, action: BookmarkEditAction): string {
  const nothing = after === before;
  switch (action.type) {
    case 'undo':
      return nothing ? 'Nothing to undo.' : 'Undone.';
    case 'redo':
      return nothing ? 'Nothing to redo.' : 'Redone.';
    case 'select':
      return '';
    case 'add':
      return nothing ? 'No bookmark was added: a file can have at most 10,000.' : `Added a bookmark for page ${action.page + 1}. Type its title, then press Enter.`;
    default:
      break;
  }
  const was = locate(before.items, action.id);
  if (!was) return '';
  const name = quoted(was.item);
  const now = locate(after.items, action.id);
  switch (action.type) {
    case 'rename':
      return nothing || !now ? `${name} was not renamed.` : `Renamed to ${quoted(now.item)}.`;
    case 'delete': {
      const under = descendants(was.item);
      return under > 0 ? `Removed ${name} and the ${plural(under, 'bookmark')} under it.` : `Removed ${name}.`;
    }
    case 'move':
      if (nothing || !now) return `${name} is already ${action.direction === 'up' ? 'first' : 'last'} at its level.`;
      return `Moved ${name} ${action.direction}: now ${place(now)}.`;
    case 'indent':
      if (!nothing && now) return `${name} is now under ${quoted(now.parent!)}: ${now.index + 1} of ${now.siblings.length}.`;
      if (was.parent) return 'Only a top-level bookmark can be indented: bookmarks nest one level.';
      if (was.index === 0) return `${name} has no bookmark above it to go under.`;
      if (was.item.children.length > 0) return `${name} has bookmarks under it, so it cannot be indented.`;
      return `${name} cannot be indented.`;
    case 'outdent':
      if (nothing || !now) return `${name} is already at the top level.`;
      return `Moved ${name} out one level: now ${place(now)}.`;
  }
}

/** Said instead of acting when the selected bookmark is not carried (it can only be removed). */
export function notCarriedRefusal(item: Pick<OutlineItem, 'title'>): string {
  return `${quoted(item)} will not be kept when the file is saved. It can only be removed.`;
}

/** Said instead of indenting under a bookmark that is not carried. */
export function indentUnderNotCarried(item: Pick<OutlineItem, 'title'>, above: Pick<OutlineItem, 'title'>): string {
  return `${quoted(item)} cannot go under ${quoted(above)}, which will not be kept.`;
}

/**
 * Why a button of the bookmark toolbar does nothing now (shown on hover and focus, and said on press),
 * or null when it works. The same rules as `commandsFor`. `reading` says where the reading of the file is
 * while there is no state yet: still going, or stopped (then the dialog offers Try again).
 */
export function whyUnavailable(state: BookmarkEditState | null, editable: boolean, command: EditCommand | 'add', reading: 'reading' | 'failed' = 'reading'): string | null {
  if (!state) return reading === 'failed' ? 'The file has to be read again first: press Try again.' : 'The bookmarks are still being read.';
  if (!editable) return 'This file has too many bookmarks, or levels, to edit here. Every other tool can still use it.';
  if (command === 'add') return bookmarkCount(state.items) >= OUTLINE_MAX_ITEMS ? 'A file can have at most 10,000 bookmarks.' : null;
  if (command === 'undo') return state.past.length > 0 ? null : 'Nothing to undo yet.';
  if (command === 'redo') return state.future.length > 0 ? null : 'Nothing to redo.';
  const at = state.selected === null ? null : locate(state.items, state.selected);
  if (!at) return 'Choose a bookmark in the list first.';
  if (command === 'delete') return null;
  if (at.item.unresolved !== undefined) return notCarriedRefusal(at.item);
  if (command === 'rename') return null;
  const action = ACTION_OF[command](at.item.id);
  if (bookmarkEditReducer(state, action) === state) return describeEdit(state, state, action);
  const above = at.index > 0 ? at.siblings[at.index - 1] : null;
  if (command === 'indent' && above && above.unresolved !== undefined) return indentUnderNotCarried(at.item, above);
  return null;
}

// ---- titles as typed -------------------------------------------------------------------------------

/** From this many characters a counter is shown beside the title being typed. */
export const TITLE_COUNTER_FROM = 200;

/** Characters (code points), as the limit counts them. */
export function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** The text cut to `max` characters, never between the two halves of a pair. */
export function limitTyped(text: string, max = TITLE_TYPED_MAX): string {
  if (text.length <= max) return text;
  let units = 0;
  let count = 0;
  for (const char of text) {
    if (count === max) break;
    units += char.length;
    count++;
  }
  return text.slice(0, units);
}

/** "230 of 256 characters" once the title is near the limit; null before. */
export function titleCounter(text: string): string | null {
  const used = codePoints(text);
  if (used < TITLE_COUNTER_FROM) return null;
  return used >= TITLE_TYPED_MAX ? `${TITLE_TYPED_MAX} of ${TITLE_TYPED_MAX} characters: the most a title can have` : `${used} of ${TITLE_TYPED_MAX} characters`;
}

/** Why a typed title cannot be used, naming the bookmark by its place in the list; null when it can. */
export function renameProblem(items: readonly EditableBookmark[], id: string, text: string): string | null {
  if (cleanTitle(text) !== '') return null;
  return `${BOOKMARK_TITLE_INVALID_MESSAGE} (Bookmark ${positionOf(items, id)} in the list has none.)`;
}

// ---- questions and notices -------------------------------------------------------------------------

/** "Remove 'Notes' and the 4 bookmarks under it?", or null when nothing is under it (no question then). */
export function deleteQuestion(item: EditableBookmark): string | null {
  const under = descendants(item);
  if (under === 0) return null;
  return under === 1 ? `Remove ${quoted(item)} and the bookmark under it?` : `Remove ${quoted(item)} and the ${under} bookmarks under it?`;
}

const NO_PAGE: readonly Unresolved[] = ['badpage', 'named-missing', 'no-target'];

/** Why a bookmark is shown "Not carried" (its hint). */
export function notCarriedReason(kind: Unresolved): string {
  switch (kind) {
    case 'remote':
      return 'Opens another file';
    case 'other-action':
      return 'Launches something or runs a script';
    case 'badpage':
      return 'Goes to a page this file does not have';
    case 'named-missing':
      return 'Goes to a named place this file does not have';
    case 'no-target':
      return 'Goes to no page of this file';
  }
}

/** The dialog's line about bookmarks that are not kept when the file is saved; null when there are none. */
export function notCarriedNotice(items: readonly EditableBookmark[]): string | null {
  const total = notCarriedCount(items);
  if (total === 0) return null;
  const kinds: Unresolved[] = [];
  let withChildren = false;
  const stack = [...items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.unresolved !== undefined) {
      kinds.push(item.unresolved);
      if (item.children.length > 0) withChildren = true;
    }
    stack.push(...item.children);
  }
  const nowhere = kinds.some((kind) => NO_PAGE.includes(kind));
  const one = total === 1;
  const what = nowhere
    ? one
      ? 'opens another file, runs a script or goes to no page of this file'
      : 'open other files, run scripts or go to no page of this file'
    : one
      ? 'opens another file or runs a script'
      : 'open other files or run scripts';
  const moved = withChildren ? ` The bookmarks under ${one ? 'it' : 'them'} move up one level.` : '';
  return `${plural(total, 'bookmark')} that ${what} will not be kept.${moved}`;
}

/** The line about titles over 1,000 characters (read cut there, and saved so); null when there are none. */
export function longTitlesNotice(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 bookmark title is longer than 1,000 characters. It is shortened to 1,000 characters when saved.'
    : `${count} bookmark titles are longer than 1,000 characters. They are shortened to 1,000 characters when saved.`;
}

// ---- the record ------------------------------------------------------------------------------------

export interface BookmarkEditCounts {
  /** Bookmarks the saved file will have (those not carried are left out). */
  bookmarks: number;
  added: number;
  renamed: number;
  moved: number;
  removed: number;
  notCarried: number;
}

interface Placed {
  item: EditableBookmark;
  parent: string | null;
  index: number;
}

function byId(items: readonly EditableBookmark[]): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const walk = (list: readonly EditableBookmark[], parent: string | null) => {
    list.forEach((item, index) => {
      out.set(item.id, { item, parent, index });
      walk(item.children, item.id);
    });
  };
  walk(items, null);
  return out;
}

/** Length of the longest increasing run (not necessarily adjacent) in `values`. */
function longestIncreasing(values: readonly number[]): number {
  const tails: number[] = [];
  for (const value of values) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
  }
  return tails.length;
}

/**
 * What an edit did, for the record: bookmarks added, renamed, moved and removed (a removed bookmark
 * with everything under it), and how many the saved file will have. A bookmark counts as moved when its
 * parent changed, or when it is among the fewest that would have to move to put its siblings back in
 * their old order (moving one bookmark to the top moves one, not all it passed).
 */
export function editCounts(initial: readonly EditableBookmark[], final: readonly EditableBookmark[]): BookmarkEditCounts {
  const before = byId(initial);
  const after = byId(final);
  let added = 0;
  let renamed = 0;
  let removed = 0;
  let moved = 0;
  const sameParent = new Map<string, number[]>();
  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) {
      added++;
      continue;
    }
    if (was.item.title !== now.item.title) renamed++;
    if (was.parent !== now.parent) {
      moved++;
      continue;
    }
    const key = now.parent ?? '';
    const ranks = sameParent.get(key) ?? [];
    ranks[now.index] = was.index;
    sameParent.set(key, ranks);
  }
  for (const ranks of sameParent.values()) {
    const inOrder = ranks.filter((rank) => rank !== undefined);
    moved += inOrder.length - longestIncreasing(inOrder);
  }
  for (const id of before.keys()) if (!after.has(id)) removed++;
  const notCarried = notCarriedCount(final);
  return {
    bookmarks: bookmarkCount(final) - notCarried,
    added,
    renamed,
    moved,
    removed,
    notCarried,
  };
}

/** What is saved of each bookmark, in a fixed order (an edit may rebuild an item with its keys in another order). */
function plain(items: readonly OutlineItem[]): unknown[] {
  return items.map((item) => [
    item.title,
    item.page,
    item.open,
    item.bold ?? false,
    item.italic ?? false,
    item.color ?? null,
    item.view ?? null,
    item.uri ?? null,
    item.unresolved ?? null,
    item.untitled ?? false,
    plain(item.children),
  ]);
}

/** Whether two trees would save differently: false for a tree changed and changed back. */
export function treesDiffer(a: readonly EditableBookmark[], b: readonly EditableBookmark[]): boolean {
  if (a === b) return false;
  return JSON.stringify(plain(a)) !== JSON.stringify(plain(b));
}
