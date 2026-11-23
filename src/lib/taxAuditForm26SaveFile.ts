// The save file of the office's fillable Form No. 26 (.json): write it exactly as that file writes it,
// and read one — checking everything first, so the screen can say what will happen before anything is written.
//
// The format: { "f": { key: text }, "t": { tableId: [ { columnKey: text } ] }, "v": 1 }, written with
// JSON.stringify(o, null, 1). Reading reproduces what the fillable file's own loading ends with (tables
// resized to the file's rows, an absent answer or cell keeps the present value, the three groups of options
// are cleared when absent, a value its box cannot hold becomes blank) and reports each such case as a note.
import type { Form26ColumnType, Form26Definition, Form26FieldKind, Form26Table } from '@/data/taxAuditForm26Types';
import type { Form26Row, Form26Values } from '@/lib/taxAuditForm26Values';

export type Form26SaveFile = { f: Record<string, string>; t: Record<string, Form26Row[]>; v: 1 };
export type Form26ImportNote =
  | { kind: 'unknown-key'; key: string } | { kind: 'unknown-table'; table: string } | { kind: 'unknown-column'; table: string; column: string }
  | { kind: 'value-dropped'; where: string; given: string; reason: 'not-an-option' | 'not-a-number' | 'not-a-date' }
  | { kind: 'missing-key'; key: string } | { kind: 'missing-table'; table: string } | { kind: 'rows-ignored'; table: string; given: number; kept: number };
export type Form26ImportPlan =
  | { ok: true; values: Form26Values; notes: Form26ImportNote[]; summary: { answers: number; tables: number; rows: number; cells: number } }
  | { ok: false; message: string };

/** A file longer than this is refused before it is read (the 250-rows-in-every-table file is 1.9 million characters). */
export const FORM26_SAVE_FILE_MAX_CHARS = 25_000_000;
// The limits on rows and cells. The proof of the owner's file (roundtrip-check.md) is 250 rows in each of
// the 52 add/delete tables: 13,128 rows, 70,364 cells, 1.9 million characters. A table is stored whole in one
// row and written twice per save (the change and the check that nothing else changed), and the screens go
// over every row on each change, so the limits keep that small while leaving room far beyond the proof:
//  - one table: 5,000 rows (twenty times the proof; the widest table, 16 cells a row, is then 80,000 cells);
//  - all tables: 50,000 rows and 400,000 cells (four and almost six times the proof; read in well under a
//    second, a save file of some 6 million characters, inside the character limit above).
// The same row limit holds for a table read back from the database.
/** A table with more rows than this is refused. */
export const FORM26_SAVE_FILE_MAX_ROWS = 5_000;
/** All tables together: more rows than this are refused. */
export const FORM26_SAVE_FILE_MAX_TOTAL_ROWS = 50_000;
/** All tables together: more cells than this are refused. */
export const FORM26_SAVE_FILE_MAX_CELLS = 400_000;

const COULD_NOT_READ = 'Could not read this file.';                 // the fillable file's own words
const TOO_LARGE = 'This file is too large to be a Form No. 26 save file.';
const NOT_A_SAVE_FILE = 'This is not a Form No. 26 save file.';
/** The refusals the screen says before reading a file (task 23: a file that cannot be read, or is far too large). */
export const FORM26_SAVE_FILE_REFUSALS = { couldNotRead: COULD_NOT_READ, tooLarge: TOO_LARGE, notASaveFile: NOT_A_SAVE_FILE } as const;
const figure = (n: number): string => n.toLocaleString('en-US');
const TOO_MANY_ROWS = `This file cannot be loaded: one of its tables has more than ${figure(FORM26_SAVE_FILE_MAX_ROWS)} rows.`;
const TOO_MANY_ROWS_IN_ALL = `This file cannot be loaded: its tables have more than ${figure(FORM26_SAVE_FILE_MAX_TOTAL_ROWS)} rows in all.`;
const TOO_MANY_CELLS = `This file cannot be loaded: its tables have more than ${figure(FORM26_SAVE_FILE_MAX_CELLS)} cells in all.`;

const NUMBER_PATTERN = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YES_NO = ['Yes', 'No'];
const GIVEN_MAX = 80;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where a note points: an answer is its key; a cell is table[row number from 1].column key. */
export function form26CellWhere(tableId: string, rowIndex: number, columnKey: string): string {
  return `${tableId}[${rowIndex + 1}].${columnKey}`;
}

export function parseForm26Where(where: string): { key: string } | { table: string; row: number; column: string } {
  const match = /^([^[\]]+)\[(\d+)\]\.(.+)$/.exec(where);
  return match ? { table: match[1], row: Number(match[2]) - 1, column: match[3] } : { key: where };
}

function isRealDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

// What a box holds after it is given a value that is not text: a number or true/false becomes its text,
// nothing (null) becomes blank. A list or an object is never an answer.
function asText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

export function normaliseValue(
  kind: Form26FieldKind | Form26ColumnType,
  options: string[] | undefined,
  raw: unknown,
): { value: string; dropped?: 'not-an-option' | 'not-a-number' | 'not-a-date' } {
  switch (kind) {
    case 'sl':
    case 's':
      return { value: '' };
    case 'radio':
      // The file chooses an option only when the value IS the option's text; a number is not.
      if (raw === '' || raw === null || raw === undefined) return { value: '' };
      return typeof raw === 'string' && (options ?? []).includes(raw) ? { value: raw } : { value: '', dropped: 'not-an-option' };
    case 'yesno':
    case 'yn':
    case 'choice':
    case 'sel': {
      const text = asText(raw);
      if (text === '' && (raw === '' || raw === null || raw === undefined)) return { value: '' };
      return (options ?? YES_NO).includes(text) ? { value: text } : { value: '', dropped: 'not-an-option' };
    }
    case 'number':
    case 'num':
    case 'calc': {
      const text = asText(raw);
      if (text === '' && (raw === '' || raw === null || raw === undefined)) return { value: '' };
      return NUMBER_PATTERN.test(text) ? { value: text } : { value: '', dropped: 'not-a-number' };
    }
    case 'date': {
      const text = asText(raw);
      if (text === '' && (raw === '' || raw === null || raw === undefined)) return { value: '' };
      return isRealDate(text) ? { value: text } : { value: '', dropped: 'not-a-date' };
    }
    case 'longtext':
    case 'ta':
      return { value: asText(raw).replace(/\r\n?/g, '\n') };
    case 'email':
      return { value: asText(raw).replace(/[\r\n]/g, '').replace(/^[ \t\f]+|[ \t\f]+$/g, '') };
    default:
      return { value: asText(raw).replace(/[\r\n]/g, '') };
  }
}

type CellSpec = { c: string; type: Form26ColumnType; options: string[] | undefined };
type TableSpec = { table: Form26Table; fixedCount: number | null; cellsOfRow: (rowIndex: number) => CellSpec[] };

const tableSpecCache = new WeakMap<Form26Definition, Map<string, TableSpec>>();

function tableSpecs(def: Form26Definition): Map<string, TableSpec> {
  const cached = tableSpecCache.get(def);
  if (cached) return cached;
  const specs = new Map<string, TableSpec>();
  for (const table of def.tables) {
    if (table.dep) {
      const perRow: CellSpec[][] = table.dep.rows.map((row) => row.cells.map((c) => ({ c, type: 'num' as const, options: undefined })));
      specs.set(table.id, { table, fixedCount: perRow.length, cellsOfRow: (rowIndex) => perRow[rowIndex] ?? [] });
    } else {
      const cells: CellSpec[] = table.columns.filter((column) => column.input).map((column) => ({ c: column.c, type: column.type, options: column.options }));
      const fixedCount = table.kind === 'rows' ? null : table.fixedRows?.length ?? table.startRows;
      specs.set(table.id, { table, fixedCount, cellsOfRow: () => cells });
    }
  }
  tableSpecCache.set(def, specs);
  return specs;
}

const textOf = (holder: unknown, key: string): string => {
  if (!isRecord(holder) || !hasOwn(holder, key)) return '';
  const value = holder[key];
  return typeof value === 'string' ? value : '';
};

function blankRow(spec: TableSpec, rowIndex: number): Form26Row {
  const row: Form26Row = {};
  for (const cell of spec.cellsOfRow(rowIndex)) row[cell.c] = '';
  return row;
}

const heldRowsOf = (spec: TableSpec, current: Form26Values): unknown =>
  (isRecord(current?.t) && hasOwn(current.t, spec.table.id) ? (current.t[spec.table.id] as unknown) : undefined);

// How many rows a table holds now (a table the present values lack opens as the form opens it).
function presentCount(spec: TableSpec, current: Form26Values): number {
  const held = heldRowsOf(spec, current);
  return spec.fixedCount ?? (Array.isArray(held) ? Math.max(1, held.length) : Math.max(1, spec.table.startRows));
}

function cellCount(spec: TableSpec, rowCount: number): number {
  if (!spec.table.dep) return rowCount * spec.cellsOfRow(0).length;
  let cells = 0;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) cells += spec.cellsOfRow(rowIndex).length;
  return cells;
}

// The rows a table holds now, as whole rows of text.
function presentRows(spec: TableSpec, current: Form26Values): Form26Row[] {
  const held = heldRowsOf(spec, current);
  const count = presentCount(spec, current);
  const rows: Form26Row[] = [];
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    const heldRow = Array.isArray(held) ? held[rowIndex] : undefined;
    const row: Form26Row = {};
    for (const cell of spec.cellsOfRow(rowIndex)) row[cell.c] = textOf(heldRow, cell.c);
    rows.push(row);
  }
  return rows;
}

export function serialiseSaveFile(def: Form26Definition, values: Form26Values): string {
  const specs = tableSpecs(def);
  const radioKeys = new Set(def.saveFile.radioKeys);
  const f: Record<string, string> = {};
  for (const key of def.saveFile.fieldOrder) {
    const value = textOf(values.f, key);
    if (value === '' && radioKeys.has(key)) continue;      // a group of options is written only when one is chosen
    f[key] = value;
  }
  const t: Record<string, Form26Row[]> = {};
  for (const id of def.saveFile.tableOrder) {
    const spec = specs.get(id);
    if (!spec) continue;
    t[id] = presentRows(spec, values);                     // every input column of every row, blank as ""
  }
  const file: Form26SaveFile = { f, t, v: 1 };
  return JSON.stringify(file, null, 1);
}

export function fileStem(values: Form26Values): string {
  const name = (textOf(values.f, 'C.pan') || textOf(values.f, 'C.name') || 'Form26').trim().replace(/[^A-Za-z0-9_-]+/g, '_');
  return `Form26_${name}`;
}

export function saveFileName(values: Form26Values): string {
  return `${fileStem(values)}.json`;
}

const given = (raw: unknown): string => {
  const text = asText(raw);
  return text.length > GIVEN_MAX ? text.slice(0, GIVEN_MAX) : text;
};

export function planImport(def: Form26Definition, text: string, current: Form26Values): Form26ImportPlan {
  if (typeof text !== 'string') return { ok: false, message: COULD_NOT_READ };
  if (text.length > FORM26_SAVE_FILE_MAX_CHARS) return { ok: false, message: TOO_LARGE };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, message: COULD_NOT_READ };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, message: COULD_NOT_READ };
  const top: Record<string, unknown> = Array.isArray(parsed) ? {} : (parsed as Record<string, unknown>);   // a list loads as {}

  // As the file: `o.f || {}` and `o.t || {}` — an empty entry is read as absent. Anything else must be an object.
  const fileF = hasOwn(top, 'f') && top.f ? top.f : {};
  const fileT = hasOwn(top, 't') && top.t ? top.t : {};
  if (!isRecord(fileF) || !isRecord(fileT)) return { ok: false, message: NOT_A_SAVE_FILE };

  const notes: Form26ImportNote[] = [];
  const summary = { answers: 0, tables: 0, rows: 0, cells: 0 };
  const specs = tableSpecs(def);

  for (const key of Object.keys(top)) {
    if (key !== 'f' && key !== 't' && key !== 'v') notes.push({ kind: 'unknown-key', key });
  }

  // Sizes first, before a row is built: rows as text are refused, and so is a table or a whole that is too large.
  let totalRows = 0;
  let totalCells = 0;
  for (const id of def.saveFile.tableOrder) {
    const spec = specs.get(id);
    if (!spec) continue;
    const fileRows = hasOwn(fileT, id) ? fileT[id] : undefined;
    let count: number;
    if (typeof fileRows === 'string' && fileRows !== '') return { ok: false, message: NOT_A_SAVE_FILE };
    if (Array.isArray(fileRows)) {
      if (fileRows.length > FORM26_SAVE_FILE_MAX_ROWS) return { ok: false, message: TOO_MANY_ROWS };
      count = spec.fixedCount ?? Math.max(1, fileRows.length);
    } else {
      count = presentCount(spec, current);                    // absent, or not a list: the rows it has
    }
    totalRows += count;
    totalCells += cellCount(spec, count);
  }
  if (totalRows > FORM26_SAVE_FILE_MAX_TOTAL_ROWS) return { ok: false, message: TOO_MANY_ROWS_IN_ALL };
  if (totalCells > FORM26_SAVE_FILE_MAX_CELLS) return { ok: false, message: TOO_MANY_CELLS };

  // Tables first, as the file does.
  const t: Record<string, Form26Row[]> = {};
  for (const id of def.saveFile.tableOrder) {
    const spec = specs.get(id);
    if (!spec) continue;
    const present = presentRows(spec, current);
    const fileRows = hasOwn(fileT, id) ? fileT[id] : undefined;
    if (!fileRows) {                                       // absent (or empty): the table is untouched
      t[id] = present;
      notes.push({ kind: 'missing-table', table: id });
      continue;
    }
    const isList = Array.isArray(fileRows);
    // A list has its rows; anything else (a number, true, an object) leaves the row count alone. Rows given
    // as text were refused above (the file would make blank rows of its length).
    const list: unknown[] = isList ? (fileRows as unknown[]) : [];
    const count = spec.fixedCount ?? (isList ? Math.max(1, list.length) : present.length);
    if (!isList) notes.push({ kind: 'rows-ignored', table: id, given: 0, kept: count });
    else if (spec.fixedCount !== null && list.length > spec.fixedCount) notes.push({ kind: 'rows-ignored', table: id, given: list.length, kept: spec.fixedCount });

    const unknownColumns = new Set<string>();
    const rows: Form26Row[] = [];
    for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
      const fileRow = rowIndex < list.length && isRecord(list[rowIndex]) ? (list[rowIndex] as Record<string, unknown>) : null;
      const presentRow = present[rowIndex];
      const cells = spec.cellsOfRow(rowIndex);
      const row: Form26Row = {};
      let known = 0;
      for (const cell of cells) {
        if (fileRow !== null && hasOwn(fileRow, cell.c) && fileRow[cell.c] !== undefined) {
          const raw = fileRow[cell.c];
          if (typeof raw === 'object' && raw !== null) return { ok: false, message: NOT_A_SAVE_FILE };
          const normalised = normaliseValue(cell.type, cell.options, raw);
          if (normalised.dropped) notes.push({ kind: 'value-dropped', where: form26CellWhere(id, rowIndex, cell.c), given: given(raw), reason: normalised.dropped });
          row[cell.c] = normalised.value;
          known += 1;
        } else {
          const kept = presentRow ? presentRow[cell.c] ?? '' : '';
          row[cell.c] = kept;
          // An absent cell keeps what it holds; said only when it holds something (and the rows were a list).
          if (kept !== '' && isList) notes.push({ kind: 'missing-key', key: form26CellWhere(id, rowIndex, cell.c) });
        }
      }
      if (fileRow !== null) {
        const keys = Object.keys(fileRow);
        if (keys.length !== known) {
          const own = new Set(cells.map((cell) => cell.c));
          for (const key of keys) if (!own.has(key)) unknownColumns.add(key);
        }
      }
      summary.cells += known;
      rows.push(row);
    }
    for (const column of unknownColumns) notes.push({ kind: 'unknown-column', table: id, column });
    t[id] = rows;
    summary.tables += 1;
    summary.rows += rows.length;
  }
  for (const id of Object.keys(fileT)) {
    if (!specs.has(id)) notes.push({ kind: 'unknown-table', table: id });
  }

  // Then the answers.
  const radioKeys = new Set(def.saveFile.radioKeys);
  const fieldByKey = new Map(def.fields.map((field) => [field.key, field]));
  const f: Record<string, string> = {};
  for (const key of def.saveFile.fieldOrder) {
    const field = fieldByKey.get(key);
    if (!field) continue;
    const isRadio = radioKeys.has(key) || field.kind === 'radio';
    const inFile = hasOwn(fileF, key) && fileF[key] !== undefined;
    let value: string;
    if (inFile) {
      const raw = fileF[key];
      if (typeof raw === 'object' && raw !== null) return { ok: false, message: NOT_A_SAVE_FILE };
      const options = field.kind === 'radio' ? (field.radioOptions ?? []).map((option) => option.value) : field.options;
      const normalised = normaliseValue(field.kind, options, raw);
      if (normalised.dropped) notes.push({ kind: 'value-dropped', where: key, given: given(raw), reason: normalised.dropped });
      value = normalised.value;
      summary.answers += 1;
    } else {
      // Absent: a group of options is cleared; any other answer keeps what it holds.
      value = isRadio ? '' : textOf(current?.f, key);
      notes.push({ kind: 'missing-key', key });
    }
    if (isRadio && value === '') continue;                 // a cleared group has no key, as in the file's own save
    f[key] = value;
  }
  for (const key of Object.keys(fileF)) {
    if (!fieldByKey.has(key)) notes.push({ kind: 'unknown-key', key });
  }

  return { ok: true, values: { f, t }, notes, summary };
}
