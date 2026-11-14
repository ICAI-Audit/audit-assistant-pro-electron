// How the file list shows results that belong together (the page images of one PDF to images
// run, the parts of one split): one row for the group, which opens to show its files. A group
// moves as one, and a row moves past a whole group. No React here.
import type { WorkingFile } from '@/lib/pdf-tools/types';

export type ListUnit =
  | { kind: 'file'; key: string; file: WorkingFile }
  | { kind: 'group'; key: string; groupId: string; files: WorkingFile[] };

export const groupKey = (groupId: string) => `group:${groupId}`;

/** The list's rows: files in list order, a group's files gathered where its first file is. */
export function listUnits(files: readonly WorkingFile[]): ListUnit[] {
  const members = new Map<string, WorkingFile[]>();
  for (const f of files) {
    if (!f.groupId) continue;
    const list = members.get(f.groupId);
    if (list) list.push(f);
    else members.set(f.groupId, [f]);
  }
  const units: ListUnit[] = [];
  const placed = new Set<string>();
  for (const f of files) {
    const group = f.groupId ? members.get(f.groupId)! : null;
    if (!group || group.length < 2) {
      units.push({ kind: 'file', key: f.id, file: f });
    } else if (!placed.has(f.groupId!)) {
      placed.add(f.groupId!);
      units.push({ kind: 'group', key: groupKey(f.groupId!), groupId: f.groupId!, files: group });
    }
  }
  return units;
}

export const unitIds = (unit: ListUnit): string[] => (unit.kind === 'file' ? [unit.file.id] : unit.files.map((f) => f.id));

export interface VisibleRow {
  key: string;
  ids: string[];
}

/** The rows on screen, top to bottom: a group row, then its files when it is open. */
export function visibleRows(units: ListUnit[], expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  for (const unit of units) {
    rows.push({ key: unit.key, ids: unitIds(unit) });
    if (unit.kind === 'group' && expanded.has(unit.groupId)) {
      for (const f of unit.files) rows.push({ key: f.id, ids: [f.id] });
    }
  }
  return rows;
}

/**
 * Where focus goes when files are removed: the first row after the removed ones that stays, else
 * the nearest one before, else nothing (the caller then focuses select-all). `ids` lets the caller
 * find the row even if a group falls to a single file and is shown as an ordinary row.
 */
export function focusAfterRemove(rows: VisibleRow[], removed: string[]): VisibleRow | null {
  const gone = new Set(removed);
  const isGone = (row: VisibleRow) => row.ids.every((id) => gone.has(id));
  const first = rows.findIndex(isGone);
  if (first < 0) return null;
  return (
    rows.slice(first + 1).find((row) => !isGone(row)) ??
    rows
      .slice(0, first)
      .reverse()
      .find((row) => !isGone(row)) ??
    null
  );
}

/** The list order (file ids) after moving the row or group `key` one place; null at either end. */
export function orderAfterMove(files: readonly WorkingFile[], key: string, direction: 'up' | 'down'): string[] | null {
  const units = listUnits(files);
  const at = units.findIndex((u) => u.key === key);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= units.length) return null;
  const reordered = units.slice();
  [reordered[at], reordered[to]] = [reordered[to], reordered[at]];
  return reordered.flatMap(unitIds);
}

/** Single-place moves (the store's `move`) that turn `current` into `target`. */
export function movesToOrder(current: string[], target: string[]): { id: string; direction: 'up' | 'down' }[] {
  const order = current.slice();
  const moves: { id: string; direction: 'up' | 'down' }[] = [];
  for (let i = 0; i < target.length; i++) {
    for (let j = order.indexOf(target[i], i); j > i; j--) {
      moves.push({ id: target[i], direction: 'up' });
      [order[j - 1], order[j]] = [order[j], order[j - 1]];
    }
  }
  return moves;
}

// A " (n)" before the extension is the number given to a name the list already held (a second
// split of the same file, for example); the stem may have been cut to keep the name at 120 characters.
const PAGE_IMAGE = /^(.*)_page_\d+(?: \(\d+\))?\.(png|jpe?g)$/i;
const PART = /^(.*)_part_\d+(?: \(\d+\))?\.pdf$/i;
const MAX_NAME_LENGTH = 120;

/**
 * `name` with " (n)" before its extension, within 120 characters. A part or page-image name keeps
 * its whole "_part_01" or "_page_001" ending (so it stays in its group): the stem is cut instead.
 */
export function numberedResultName(name: string, n: number): string {
  // 's': a name may hold a line break or a line or paragraph separator; every name matches.
  const match = /^(.*?)((?:_part_\d+|_page_\d+)?)(\.[A-Za-z0-9]+)?$/s.exec(name)!;
  const [, stem, ending, extension = ''] = match;
  const tail = `${ending} (${n})${extension}`;
  let cut = stem.slice(0, Math.max(1, MAX_NAME_LENGTH - tail.length));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  cut = cut.replace(/[. ]+$/, '');
  return `${cut || 'document'}${tail}`;
}

function sharedStem(files: WorkingFile[], pattern: RegExp): string | null {
  const stems = files.map((f) => pattern.exec(f.name)?.[1]);
  return stems.every((s) => s !== undefined && s === stems[0]) ? (stems[0] as string) : null;
}

/** The group row's title and the first and last names it holds. */
export function groupTitle(files: WorkingFile[]): { title: string; range: string } {
  const range = `${files[0].name} to ${files[files.length - 1].name}`;
  const pages = sharedStem(files, PAGE_IMAGE);
  if (pages !== null) return { title: `${pages} — ${files.length} page images`, range };
  const parts = sharedStem(files, PART);
  if (parts !== null) return { title: `${parts} — ${files.length} parts`, range };
  return { title: `${files[0].name} and ${files.length - 1} more`, range };
}
