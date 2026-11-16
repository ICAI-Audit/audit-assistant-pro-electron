// The Bookmarks tool's edit model (design 5.10): a pure reducer over the bookmark tree. Add, rename,
// move, nest one level, delete, undo and redo; the limits; bookmarks that PDF Tools cannot carry are
// shown but never saved. No React, no DOM.
import { carryOutline, cleanTitle, OUTLINE_MAX_ITEMS, type DestView, type OutlineItem } from '@/lib/pdf-tools/outline';

export interface EditableBookmark extends OutlineItem {
  id: string;
  /** 0 for a top-level bookmark. */
  depth: number;
  children: EditableBookmark[];
}

export interface BookmarkEditState {
  items: EditableBookmark[];
  selected: string | null;
  past: EditableBookmark[][];
  future: EditableBookmark[][];
  /** False at the start, and after undoing back to it. */
  changed: boolean;
  /** The number the next new bookmark's id takes. */
  nextId: number;
  /** Steps that fell off the start of `past`, so undo can no longer reach the start. */
  evicted: number;
}

export type BookmarkEditAction =
  /** `page` is the zero-based page index; the title starts as "Page <page + 1>". */
  | { type: 'add'; page: number; view: DestView }
  | { type: 'rename'; id: string; title: string }
  | { type: 'move'; id: string; direction: 'up' | 'down' }
  | { type: 'indent'; id: string }
  | { type: 'outdent'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export const BOOKMARK_HISTORY = 100;
export const UNTITLED_LABEL = '(untitled)';

/** What the tree shows for a bookmark: its title, or "(untitled)" for one of the file's own that has none. */
export function bookmarkLabel(item: Pick<OutlineItem, 'title'>): string {
  return item.title === '' ? UNTITLED_LABEL : item.title;
}

function numbered(items: readonly OutlineItem[], first: number, depth: number): { items: EditableBookmark[]; next: number } {
  let next = first;
  const out = items.map((item): EditableBookmark => {
    const id = `b${next++}`;
    const below = numbered(item.children, next, depth + 1);
    next = below.next;
    return { ...item, id, depth, children: below.items };
  });
  return { items: out, next };
}

/** Bookmarks as read from a file, given ids and depths. Existing deeper nesting is kept as it is. */
export function initialBookmarkState(items: readonly OutlineItem[]): BookmarkEditState {
  const tree = numbered(items, 1, 0);
  return { items: tree.items, selected: null, past: [], future: [], changed: false, nextId: tree.next, evicted: 0 };
}

/** The tree for saving: ids and depths removed, bookmarks that cannot be carried left out (what is under one moves up). */
export function toOutline(state: BookmarkEditState): OutlineItem[] {
  const strip = (list: readonly OutlineItem[]): OutlineItem[] =>
    list.map((item) => {
      const { id: _id, depth: _depth, ...rest } = item as EditableBookmark;
      return { ...rest, children: strip(item.children) };
    });
  return strip(carryOutline(state.items, (page) => page).items);
}

/** How many bookmarks are shown "Not carried": they open another file, launch something, run a script or go nowhere. */
export function notCarriedCount(items: readonly EditableBookmark[]): number {
  return items.reduce((sum, item) => sum + (item.unresolved !== undefined ? 1 : 0) + notCarriedCount(item.children), 0);
}

export function bookmarkCount(items: readonly EditableBookmark[]): number {
  return items.reduce((sum, item) => sum + 1 + bookmarkCount(item.children), 0);
}

/** Child indices from the top to the bookmark, or null. */
function pathOf(items: readonly EditableBookmark[], id: string): number[] | null {
  for (const [index, item] of items.entries()) {
    if (item.id === id) return [index];
    const below = pathOf(item.children, id);
    if (below) return [index, ...below];
  }
  return null;
}

function listAt(items: EditableBookmark[], parentPath: readonly number[]): EditableBookmark[] {
  let list = items;
  for (const index of parentPath) list = list[index].children;
  return list;
}

/** A new tree with the list under `parentPath` replaced; only the parents on the way are copied. */
function withList(items: EditableBookmark[], parentPath: readonly number[], next: EditableBookmark[]): EditableBookmark[] {
  if (parentPath.length === 0) return next;
  const [head, ...rest] = parentPath;
  return items.map((item, index) => (index === head ? { ...item, children: withList(item.children, rest, next) } : item));
}

function withDepth(item: EditableBookmark, depth: number): EditableBookmark {
  return { ...item, depth, children: item.children.map((child) => withDepth(child, depth + 1)) };
}

function commit(state: BookmarkEditState, items: EditableBookmark[], extra: Partial<BookmarkEditState> = {}): BookmarkEditState {
  let past = [...state.past, state.items];
  let evicted = state.evicted;
  if (past.length > BOOKMARK_HISTORY) {
    past = past.slice(past.length - BOOKMARK_HISTORY);
    evicted++;
  }
  return { ...state, ...extra, items, past, future: [], evicted, changed: true };
}

function travel(state: BookmarkEditState, items: EditableBookmark[], past: EditableBookmark[][], future: EditableBookmark[][]): BookmarkEditState {
  const selected = state.selected !== null && pathOf(items, state.selected) ? state.selected : null;
  return { ...state, items, past, future, selected, changed: past.length > 0 || state.evicted > 0 };
}

type EditOfOne = Exclude<BookmarkEditAction, { type: 'add' | 'select' | 'undo' | 'redo' }>;

function editExisting(state: BookmarkEditState, action: EditOfOne): BookmarkEditState {
  const path = pathOf(state.items, action.id);
  if (!path) return state;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const list = listAt(state.items, parentPath);
  const item = list[index];
  const replace = (next: EditableBookmark[]) => withList(state.items, parentPath, next);

  switch (action.type) {
    case 'rename': {
      const title = cleanTitle(action.title);
      if (title === '' || title === item.title) return state;
      return commit(
        state,
        replace(
          list.map((entry, i) => {
            if (i !== index) return entry;
            const { untitled: _untitled, ...rest } = entry;
            return { ...rest, title };
          }),
        ),
      );
    }
    case 'move': {
      const to = action.direction === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= list.length) return state;
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return commit(state, replace(next));
    }
    case 'indent': {
      // Only a top-level bookmark with nothing under it goes under the top-level bookmark above it: one new level.
      if (parentPath.length > 0 || index === 0 || item.children.length > 0) return state;
      const above = list[index - 1];
      const moved = withDepth(item, 1);
      const next = list.filter((_, i) => i !== index).map((entry, i) => (i === index - 1 ? { ...above, open: true, children: [...above.children, moved] } : entry));
      return commit(state, next);
    }
    case 'outdent': {
      if (parentPath.length === 0) return state;
      const grandPath = parentPath.slice(0, -1);
      const parentIndex = parentPath[parentPath.length - 1];
      const siblings = listAt(state.items, grandPath);
      const parent = siblings[parentIndex];
      const moved = withDepth(item, grandPath.length);
      const reduced = { ...parent, children: parent.children.filter((_, i) => i !== index) };
      const next = [...siblings.slice(0, parentIndex), reduced, moved, ...siblings.slice(parentIndex + 1)];
      return commit(state, withList(state.items, grandPath, next));
    }
    case 'delete': {
      const next = list.filter((_, i) => i !== index);
      const parent = parentPath.length > 0 ? listAt(state.items, parentPath.slice(0, -1))[parentPath[parentPath.length - 1]] : undefined;
      const neighbour = next[index] ?? next[index - 1] ?? parent;
      const gone = state.selected !== null && (state.selected === item.id || pathOf(item.children, state.selected) !== null);
      return commit(state, replace(next), { selected: gone ? (neighbour?.id ?? null) : state.selected });
    }
  }
}

export function bookmarkEditReducer(state: BookmarkEditState, action: BookmarkEditAction): BookmarkEditState {
  switch (action.type) {
    case 'select': {
      if (action.id === state.selected) return state;
      if (action.id !== null && !pathOf(state.items, action.id)) return state;
      return { ...state, selected: action.id };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      return travel(state, state.past[state.past.length - 1], state.past.slice(0, -1), [...state.future, state.items]);
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      return travel(state, state.future[state.future.length - 1], [...state.past, state.items], state.future.slice(0, -1));
    }
    case 'add': {
      // The editor stays within what it can open again: it adds no bookmark past the limit.
      if (bookmarkCount(state.items) >= OUTLINE_MAX_ITEMS || !Number.isInteger(action.page) || action.page < 0) return state;
      const at = state.selected === null ? null : pathOf(state.items, state.selected);
      const parentPath = at ? at.slice(0, -1) : [];
      const index = at ? at[at.length - 1] + 1 : state.items.length;
      const id = `b${state.nextId}`;
      const added: EditableBookmark = { id, depth: parentPath.length, title: `Page ${action.page + 1}`, page: action.page, view: action.view, open: false, children: [] };
      const list = listAt(state.items, parentPath);
      const next = [...list.slice(0, index), added, ...list.slice(index)];
      return commit(state, withList(state.items, parentPath, next), { selected: id, nextId: state.nextId + 1 });
    }
    default:
      return editExisting(state, action);
  }
}
