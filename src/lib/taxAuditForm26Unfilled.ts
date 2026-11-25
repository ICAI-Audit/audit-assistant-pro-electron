// What counts as unfilled in Form No. 26, exactly as the office's fillable file counts it:
// only what is on screen, in the order of the form.
// - An answer counts when blank (never the UDINs and the Part B observations box).
// - A table counts never for A5, B5 and P11a. Otherwise, looking only at cells that are not calculated:
//   with no value anywhere it is ONE item (its first such cell); a table with fixed rows (and each
//   depreciation table) is then complete; a table of added rows counts, in every row that has a value,
//   each blank cell whose column is not optional.
import { form26ClauseKeyOfField, form26ClauseKeyOfTable } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import type { Form26Definition, Form26Field, Form26Table } from '@/data/taxAuditForm26Types';
import { isFieldShown, isTableShown, type Form26ViewOptions } from '@/lib/taxAuditForm26Reveal';
import { getField, type Form26Row, type Form26Values } from '@/lib/taxAuditForm26Values';

export type Form26UnfilledItem = { k: string } | { t: string; r: number; c: string };
export type Form26UnfilledCounts = {
  total: number;
  part: Record<string, number>;
  section: Record<string, number>;
  scheduleGroup: Record<string, number>;
  schedule: Record<string, number>;
  clause: Record<string, number>;
};

type Form26Index = {
  fields: Map<string, Form26Field>;
  tables: Map<string, Form26Table>;
  /** Place in the form of every answer key ('k:' + key) and table ('t:' + id). */
  place: Map<string, number>;
};

const INDEX = new WeakMap<Form26Definition, Form26Index>();

function indexOf(def: Form26Definition): Form26Index {
  let index = INDEX.get(def);
  if (!index) {
    index = {
      fields: new Map(def.fields.map((field) => [field.key, field])),
      tables: new Map(def.tables.map((table) => [table.id, table])),
      place: new Map(def.documentOrder.map((entry, at) => ['k' in entry ? `k:${entry.k}` : `t:${entry.t}`, at])),
    };
    INDEX.set(def, index);
  }
  return index;
}

const hasValue = (row: Form26Row | undefined, key: string) => row !== undefined && row[key] !== undefined && row[key] !== '';

/** The cells of one row that are not calculated, in the order of the form. */
function countedCells(table: Form26Table, rowIndex: number): string[] {
  if (table.dep) {
    const row = table.dep.rows[rowIndex];
    return row && !row.calculated ? row.cells : [];
  }
  return table.columns.filter((column) => column.input && !column.calc).map((column) => column.c);
}

function scanTable(table: Form26Table, rows: Form26Row[], items: Form26UnfilledItem[]): void {
  // The rows the table has on screen: a depreciation table its fixed rows, any other at least one row.
  const rowCount = table.dep ? table.dep.rows.length : Math.max(rows.length, 1);

  let first: { r: number; c: string } | null = null;
  let anyValue = false;
  for (let r = 0; r < rowCount; r += 1) {
    const cells = countedCells(table, r);
    if (first === null && cells.length > 0) first = { r, c: cells[0] };
    if (cells.some((key) => hasValue(rows[r], key))) anyValue = true;
  }
  if (first === null) return;
  if (!anyValue) {
    items.push({ t: table.id, r: first.r, c: first.c });
    return;
  }
  if (table.kind !== 'rows') return;

  const optional = new Set(table.columns.filter((column) => column.optional).map((column) => column.c));
  for (let r = 0; r < rows.length; r += 1) {
    const cells = countedCells(table, r);
    if (!cells.some((key) => hasValue(rows[r], key))) continue;
    for (const key of cells) {
      if (!hasValue(rows[r], key) && !optional.has(key)) items.push({ t: table.id, r, c: key });
    }
  }
}

// A table's items depend only on the table and its list of rows. The screen gives a NEW list of rows (and new row
// objects) for a table that changed and keeps the same ones for every other table, so the screen may pass a cache
// and the items of an unchanged list are taken from it (task 27: with 250 rows in every table, scanning them all on
// every key took 15-80 ms of the 100 ms a key may take). A list whose length or any row object differs is read
// again. Without a cache (the default) every table is read: a caller that changes a row in place stays right.
export type Form26UnfilledCache = WeakMap<Form26Row[], Map<string, { rows: Form26Row[]; items: Form26UnfilledItem[] }>>;
export const createForm26UnfilledCache = (): Form26UnfilledCache => new WeakMap();

function scanTableCached(table: Form26Table, rows: Form26Row[] | undefined, items: Form26UnfilledItem[], cache: Form26UnfilledCache | undefined): void {
  if (!rows || !cache) {
    scanTable(table, rows ?? [], items);
    return;
  }
  let byTable = cache.get(rows);
  if (!byTable) {
    byTable = new Map();
    cache.set(rows, byTable);
  }
  let kept = byTable.get(table.id);
  if (!kept || kept.rows.length !== rows.length || kept.rows.some((row, i) => row !== rows[i])) {
    kept = { rows: [...rows], items: [] };
    scanTable(table, rows, kept.items);
    byTable.set(table.id, kept);
  }
  for (const item of kept.items) items.push({ ...item });
}

/**
 * The unfilled items, in the order of the form. A key in `unconfirmed` (an answer brought from an
 * earlier draft and not yet confirmed) counts while it is on screen even though it has a value.
 */
export function scanUnfilled(
  def: Form26Definition,
  values: Form26Values,
  opts: Form26ViewOptions & { unconfirmed?: ReadonlySet<string>; cache?: Form26UnfilledCache },
): Form26UnfilledItem[] {
  const index = indexOf(def);
  const items: Form26UnfilledItem[] = [];
  for (const entry of def.documentOrder) {
    if ('k' in entry) {
      const field = index.fields.get(entry.k);
      if (!field || !isFieldShown(def, field.key, values, opts)) continue;
      if (opts.unconfirmed?.has(field.key)) {
        items.push({ k: field.key });
        continue;
      }
      if (field.unfilledExempt) continue;
      if (getField(values, field.key) === '') items.push({ k: field.key });
    } else {
      const table = index.tables.get(entry.t);
      if (!table || table.unfilledExempt || !isTableShown(def, table.id, values, opts)) continue;
      scanTableCached(table, values.t[table.id], items, opts.cache);
    }
  }
  return items;
}

const add = (buckets: Record<string, number>, name: string | null) => {
  if (name !== null) buckets[name] = (buckets[name] ?? 0) + 1;
};

/**
 * Counts for the screen: by Part, by section of Part D, by schedule group, by schedule, and by clause
 * unit (the clause an answer or a table stands under). An item outside any section, group or schedule
 * is in none of those buckets.
 */
export function countUnfilled(def: Form26Definition, items: Form26UnfilledItem[]): Form26UnfilledCounts {
  const index = indexOf(def);
  const counts: Form26UnfilledCounts = { total: items.length, part: {}, section: {}, scheduleGroup: {}, schedule: {}, clause: {} };
  for (const item of items) {
    if ('k' in item) {
      const field = index.fields.get(item.k);
      if (!field) throw new Error(`Form 26 has no answer key "${item.k}"`);
      add(counts.part, field.part);
      add(counts.section, field.section);
      add(counts.schedule, field.schedule);
      add(counts.clause, form26ClauseKeyOfField(field.key));
    } else {
      const table = index.tables.get(item.t);
      if (!table) throw new Error(`Form 26 has no table "${item.t}"`);
      add(counts.part, table.part);
      add(counts.section, table.section);
      add(counts.scheduleGroup, table.group);
      add(counts.schedule, table.schedule);
      add(counts.clause, form26ClauseKeyOfTable(table.id));
    }
  }
  return counts;
}

/** The place of an item in the form: [place of its answer or table, row, cell within the row]; null when the form has no such item. */
function placeOf(def: Form26Definition, item: Form26UnfilledItem): [number, number, number] | null {
  const index = indexOf(def);
  if ('k' in item) {
    const at = index.place.get(`k:${item.k}`);
    return at === undefined ? null : [at, 0, 0];
  }
  const at = index.place.get(`t:${item.t}`);
  const table = index.tables.get(item.t);
  if (at === undefined || !table) return null;
  const cells = table.dep ? table.dep.rows[item.r]?.cells ?? [] : table.columns.map((column) => column.c);
  return [at, item.r, cells.indexOf(item.c)];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The item to go to on "Next unfilled": the first one after `after` in the order of the form, wrapping
 * to the first. `after` is the item visited last; it need not be in the list any more (it has usually
 * just been filled). `items` must be in the order `scanUnfilled` gives.
 */
export function nextUnfilled(
  items: Form26UnfilledItem[],
  after: Form26UnfilledItem | null,
  def: Form26Definition = FORM26_DEFINITION,
): Form26UnfilledItem | null {
  if (items.length === 0) return null;
  const from = after === null ? null : placeOf(def, after);
  if (from === null) return items[0];
  for (const item of items) {
    const at = placeOf(def, item);
    if (at !== null && compare(at, from) > 0) return item;
  }
  return items[0];
}

/** The mirror of `nextUnfilled`: the last item before `before`, wrapping to the last. */
export function previousUnfilled(
  items: Form26UnfilledItem[],
  before: Form26UnfilledItem | null,
  def: Form26Definition = FORM26_DEFINITION,
): Form26UnfilledItem | null {
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  const from = before === null ? null : placeOf(def, before);
  if (from === null) return last;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const at = placeOf(def, items[i]);
    if (at !== null && compare(at, from) < 0) return items[i];
  }
  return last;
}
