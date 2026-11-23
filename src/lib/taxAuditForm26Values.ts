// The answers of one Form No. 26: the same shape the office's fillable file saves
// ("f" = answers by key, "t" = table rows by table id), every value a string as typed.
import type { Form26Definition, Form26Table } from '@/data/taxAuditForm26Types';

export type Form26Row = Record<string, string>;
export type Form26Values = { f: Record<string, string>; t: Record<string, Form26Row[]> };

/**
 * The keys one row of a table holds, in the file's order: for a depreciation table the cell keys of
 * that row; otherwise the columns that take input (calculated columns included; serial numbers and
 * fixed texts are not held).
 */
export function form26RowCellKeys(table: Form26Table, rowIndex: number): string[] {
  if (table.dep) return table.dep.rows[rowIndex]?.cells ?? [];
  return table.columns.filter((column) => column.input).map((column) => column.c);
}

/** A blank row of a table (every cell ''). */
export function form26BlankRow(table: Form26Table, rowIndex: number): Form26Row {
  const row: Form26Row = {};
  for (const key of form26RowCellKeys(table, rowIndex)) row[key] = '';
  return row;
}

/** What the form holds when it is opened: the file's preset answers and its blank starting rows. */
export function defaultValues(def: Form26Definition): Form26Values {
  const fieldByKey = new Map(def.fields.map((field) => [field.key, field]));
  const tableById = new Map(def.tables.map((table) => [table.id, table]));
  const radioKeys = new Set(def.saveFile.radioKeys);

  const f: Record<string, string> = {};
  for (const key of def.saveFile.fieldOrder) {
    const preset = fieldByKey.get(key)?.default ?? '';
    // As in the file's save: a group of options is present only when one is chosen.
    if (preset === '' && radioKeys.has(key)) continue;
    f[key] = preset;
  }

  const t: Record<string, Form26Row[]> = {};
  for (const id of def.saveFile.tableOrder) {
    const table = tableById.get(id);
    if (!table) continue;
    const rows: Form26Row[] = [];
    for (let rowIndex = 0; rowIndex < table.startRows; rowIndex += 1) rows.push(form26BlankRow(table, rowIndex));
    t[id] = rows;
  }
  return { f, t };
}

/** The value of an answer; '' when the key is absent (a group of options with none chosen). */
export function getField(values: Form26Values, key: string): string {
  return Object.prototype.hasOwnProperty.call(values.f, key) ? values.f[key] ?? '' : '';
}
