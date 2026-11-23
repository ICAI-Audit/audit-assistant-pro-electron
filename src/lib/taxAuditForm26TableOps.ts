// Rows of a Form No. 26 table as the office's fillable file handles them: the rows a table opens with,
// a cell typed in (then its calculations), a row added or deleted, and where a row stands.
// Pure functions; they return new rows and leave the given ones alone. Only the edited row is a new
// object, so a screen that draws rows one by one redraws only that row.
import type { Form26Table } from '@/data/taxAuditForm26Types';
import { recalcDepreciation, recalcRow } from '@/lib/taxAuditForm26Calc';
import { FORM26_QUIRKS, type Form26Quirks } from '@/lib/taxAuditForm26Quirks';
import { FORM26_SAVE_FILE_MAX_ROWS } from '@/lib/taxAuditForm26SaveFile';
import type { Form26UnfilledItem } from '@/lib/taxAuditForm26Unfilled';
import { form26BlankRow, form26RowCellKeys, type Form26Row } from '@/lib/taxAuditForm26Values';

/** A blank row (every cell the row holds is ''). A depreciation row holds its own cells: pass its index. */
export function blankRow(table: Form26Table, rowIndex = 0): Form26Row {
  return form26BlankRow(table, rowIndex);
}

/** The rows a table opens with: the file's number of blank rows (a fixed table: one per fixed row). */
export function startRows(table: Form26Table): Form26Row[] {
  return Array.from({ length: table.startRows }, (_, rowIndex) => blankRow(table, rowIndex));
}

/** Only a table of added rows takes more rows ("+ Add row"). */
export function canAddRows(table: Form26Table): boolean {
  return table.kind === 'rows';
}

/** The most rows a table can hold: the save file's own limit per table, so whatever is typed can be saved and loaded again. */
export const FORM26_TABLE_MAX_ROWS = FORM26_SAVE_FILE_MAX_ROWS;

/** A table of added rows that holds the most rows it can: "Add row" takes no more. */
export function rowLimitReached(table: Form26Table, rows: Form26Row[]): boolean {
  return canAddRows(table) && rows.length >= FORM26_TABLE_MAX_ROWS;
}

/**
 * A delete control on a row. The file has one where the table has a "Sl. No." column; the application
 * gives one to every table of added rows (build-plan decision A3, switch `deleteControlOnEveryRowTable`).
 */
export function hasDeleteControl(table: Form26Table, quirks: Form26Quirks = FORM26_QUIRKS): boolean {
  if (table.kind !== 'rows') return false;
  return table.hasSerialColumn || quirks.deleteControlOnEveryRowTable;
}

/** The row with every cell it must hold; the same object when nothing is missing. */
function completeRow(table: Form26Table, row: Form26Row | undefined, rowIndex: number): Form26Row {
  if (!row) return blankRow(table, rowIndex);
  const keys = form26RowCellKeys(table, rowIndex);
  if (keys.every((key) => typeof row[key] === 'string')) return row;
  const next = blankRow(table, rowIndex);
  for (const key of keys) if (typeof row[key] === 'string') next[key] = row[key];
  return next;
}

/**
 * The rows to show: a table of added rows has at least one row; a fixed or depreciation table has exactly
 * its rows. A missing cell is blank. When nothing changes the same list is given back.
 */
export function normaliseRows(table: Form26Table, rows: Form26Row[] | undefined): Form26Row[] {
  const given = rows ?? [];
  const count = table.kind === 'rows' ? Math.max(given.length, 1) : table.startRows;
  const next: Form26Row[] = [];
  let changed = given.length !== count;
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    const row = completeRow(table, given[rowIndex], rowIndex);
    if (row !== given[rowIndex]) changed = true;
    next.push(row);
  }
  return changed ? next : given;
}

/**
 * A cell typed in, then the calculations of the file: the row's calculated columns (the typed column
 * itself is left as typed), or the whole depreciation table.
 */
export function setCell(table: Form26Table, rows: Form26Row[], r: number, c: string, value: string): Form26Row[] {
  const base = normaliseRows(table, rows);
  if (r < 0 || r >= base.length) throw new Error(`Form 26 table ${table.id} has no row ${r}`);
  const edited = { ...base[r], [c]: value };
  if (table.dep) return recalcDepreciation(table, base.map((row, index) => (index === r ? edited : row)));
  const next = base.slice();
  next[r] = recalcRow(table, edited, c);
  return next;
}

/** One blank row added at the end (a table of added rows only, below its limit; otherwise the same rows). */
export function addRow(table: Form26Table, rows: Form26Row[]): Form26Row[] {
  if (!canAddRows(table) || rowLimitReached(table, rows)) return rows;
  const base = normaliseRows(table, rows);
  return [...base, blankRow(table, base.length)];
}

/** A row deleted; the only row is cleared instead of removed. Fixed tables keep their rows. */
export function deleteRow(table: Form26Table, rows: Form26Row[], r: number): Form26Row[] {
  if (!canAddRows(table)) return rows;
  const base = normaliseRows(table, rows);
  if (r < 0 || r >= base.length) return base;
  if (base.length === 1) return [blankRow(table, 0)];
  return base.filter((_, index) => index !== r);
}

/**
 * The unfilled cells of one table, by row: '|1|3|' lists columns 1 and 3. Text, so that a row drawn on its
 * own can tell cheaply whether its unfilled cells changed.
 */
export function unfilledCellsByRow(items: Form26UnfilledItem[], tableId: string): Record<number, string> {
  const byRow: Record<number, string> = {};
  for (const item of items) {
    if (!('t' in item) || item.t !== tableId) continue;
    byRow[item.r] = `${byRow[item.r] ?? '|'}${item.c}|`;
  }
  return byRow;
}

export function isUnfilledCell(rowCells: string | undefined, columnKey: string): boolean {
  return rowCells !== undefined && rowCells.includes(`|${columnKey}|`);
}

/**
 * Where a row stands, counted as the file counts unfilled cells: only cells that are typed in (not the
 * calculated ones). A row with no value is not filled and has nothing to fill; a row with a value has
 * one cell to fill for every blank cell whose column is not optional.
 */
export function rowState(table: Form26Table, row: Form26Row): { filled: boolean; toFill: number } {
  const counted = table.columns.filter((column) => column.input && !column.calc);
  const hasValue = (key: string) => row[key] !== undefined && row[key] !== '';
  const filled = counted.some((column) => hasValue(column.c));
  if (!filled) return { filled: false, toFill: 0 };
  return { filled: true, toFill: counted.filter((column) => !column.optional && !hasValue(column.c)).length };
}
