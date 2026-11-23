// Loading a save file of the office's fillable Form No. 26 into an audit (BUILD-PLAN task 23), as pure functions:
// which storage rows the file changes and with what (`importWrites`), and what the screen says BEFORE anything
// is written (`importSummary`): the counts, a plain warning when the file is for another PAN or name, and what
// will not be taken, one sentence each with its list. The writing itself runs in the session (applyImport).
//
// Rules:
//  - a row is written only when the file changes it: answers are compared field by field with what the row holds,
//    tables through `tablePayload` (the text every table write uses), so a second load of the same file writes
//    nothing, and a load that stopped part of the way completes when run again;
//  - calculated cells are written as the file has them (never recomputed), as the office's file loads them;
//  - an answer the file gives is the user's own answer: its "brought from the 3CD draft" mark goes;
//  - an approved (or locked) clause and the tables under it are not changed; the clause is named;
//  - the category of assessee lives in the setup: it is returned, not written into a row.
import { FORM26_CLAUSE_UNITS, form26ClauseKeyOfTable, form26TableRowKey, type Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Category, Form26Definition, Form26Table } from '@/data/taxAuditForm26Types';
import { editorTitle } from '@/lib/taxAuditForm26EditorModel';
import { depreciationColumnLabels, rowListHeading } from '@/lib/taxAuditForm26Layout';
import { isRowLocked } from '@/lib/taxAuditForm26Review';
import { parseForm26Where, type Form26ImportNote, type Form26ImportPlan } from '@/lib/taxAuditForm26SaveFile';
import {
  clausePayloadPatch,
  FORM26_CATEGORY_FIELD,
  FORM26_CATEGORY_ROW_KEY,
  parseClausePayload,
  parseTablePayload,
  tablePayload,
  type Form26ClausePayload,
  type Form26TablePayload,
} from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { Form26Values } from '@/lib/taxAuditForm26Values';

export type Form26ImportablePlan = Extract<Form26ImportPlan, { ok: true }>;
/** One storage row the file changes: its new payload, and that payload as the text written. */
export type Form26ImportWrite = { rowKey: string; payload: Form26ClausePayload | Form26TablePayload; responseJson: string };
/** One sentence of what will not be taken, with the list it opens. */
export type Form26ImportNoteLine = { kind: 'dropped' | 'missing-answers' | 'cleared' | 'missing-cells' | 'missing-tables' | 'rows' | 'unknown' | 'locked'; text: string; items: string[] };
export type Form26ImportSummary = { counts: string; identity: string[]; notes: Form26ImportNoteLine[] };

const UNIT_BY_KEY = new Map<string, Form26ClauseUnit>(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit]));
const ORDER_OF_UNIT = new Map<string, number>(FORM26_CLAUSE_UNITS.map((unit, index) => [unit.key, index]));
const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const count = (n: number) => n.toLocaleString('en-IN');
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------------
// The writes

function missingAnswerKeys(plan: Form26ImportablePlan): Set<string> {
  const keys = new Set<string>();
  for (const note of plan.notes) if (note.kind === 'missing-key' && !note.key.includes('[')) keys.add(note.key);
  return keys;
}

/** The clause row's write (null: the row already holds the file's answers). */
function clauseWrite(def: Form26Definition, plan: Form26ImportablePlan, unit: Form26ClauseUnit, row: Form26ClauseRow, missing: Set<string>): Form26ImportWrite | null {
  if (unit.key === FORM26_CATEGORY_ROW_KEY || unit.fields.length === 0) return null;
  const stored = parseClausePayload(row.response_json);
  const changes: Record<string, string> = {};
  for (const key of unit.fields) {
    const wanted = hasOwn(plan.values.f, key) ? plan.values.f[key] : '';
    const held = hasOwn(stored.f, key) ? stored.f[key] : '';
    // A value the file gives becomes the user's own answer, so a "brought from the 3CD draft" mark goes with it.
    if (wanted !== held || (stored.brought?.[key] && !missing.has(key))) changes[key] = wanted;
  }
  if (Object.keys(changes).length === 0) return null;
  const payload = clausePayloadPatch(def, unit.key, changes, stored);
  return { rowKey: unit.key, payload, responseJson: JSON.stringify(payload) };
}

/** The table row's write (null: the row already holds the file's rows). */
function tableWrite(def: Form26Definition, plan: Form26ImportablePlan, tableId: string, row: Form26ClauseRow): Form26ImportWrite | null {
  const json = tablePayload(def, tableId, plan.values.t[tableId] ?? []);
  if (tablePayload(def, tableId, parseTablePayload(row.response_json).rows) === json) return null;
  return { rowKey: form26TableRowKey(tableId), payload: JSON.parse(json) as Form26TablePayload, responseJson: json };
}

/**
 * What one storage row needs from the file now: `write` (null when it holds the file already) and `locked`
 * (its clause is approved or locked, so it is not written; `clauseKey` names that clause).
 */
export function importWriteFor(
  def: Form26Definition,
  plan: Form26ImportablePlan,
  rowKey: string,
  rowsByKey: Map<string, Form26ClauseRow>,
): { write: Form26ImportWrite | null; locked: boolean; clauseKey: string } {
  const unit = UNIT_BY_KEY.get(rowKey);
  const tableId = unit ? null : def.tables.find((table) => form26TableRowKey(table.id) === rowKey)?.id ?? null;
  const clauseKey = unit ? unit.key : tableId ? form26ClauseKeyOfTable(tableId) : rowKey;
  const row = rowsByKey.get(rowKey);
  const clause = rowsByKey.get(clauseKey);
  if (!row || (!unit && !tableId)) return { write: null, locked: false, clauseKey };
  const write = unit ? clauseWrite(def, plan, unit, row, missingAnswerKeys(plan)) : tableWrite(def, plan, tableId as string, row);
  const locked = Boolean(clause && isRowLocked(clause));
  return locked ? { write: null, locked: write !== null, clauseKey } : { write, locked: false, clauseKey };
}

/**
 * The rows the file changes, in the order of the storage rows (clauses, then tables), the category it gives, and
 * the approved clauses it would have changed (form order). `opts.category`: the category held now (to tell whether
 * an approved category entry would change); without it an approved category entry is always named.
 */
export function importWrites(
  def: Form26Definition,
  plan: Form26ImportablePlan,
  rowsByKey: Map<string, Form26ClauseRow>,
  opts: { category?: '' | Form26Category } = {},
): { writes: Form26ImportWrite[]; category: '' | Form26Category; skippedLocked: string[] } {
  const given = plan.values.f[FORM26_CATEGORY_FIELD];
  const fileCategory: '' | Form26Category = given === '1' || given === '2' ? given : '';
  const skipped = new Set<string>();
  const writes: Form26ImportWrite[] = [];
  const rowKeys = [...FORM26_CLAUSE_UNITS.map((unit) => unit.key), ...def.tables.map((table) => form26TableRowKey(table.id))];
  for (const rowKey of rowKeys) {
    const one = importWriteFor(def, plan, rowKey, rowsByKey);
    if (one.locked) skipped.add(one.clauseKey);
    else if (one.write) writes.push(one.write);
  }
  let category = fileCategory;
  const categoryRow = rowsByKey.get(FORM26_CATEGORY_ROW_KEY);
  if (categoryRow && isRowLocked(categoryRow) && opts.category !== fileCategory) {
    skipped.add(FORM26_CATEGORY_ROW_KEY);
    category = opts.category ?? fileCategory;
  }
  const skippedLocked = [...skipped].sort((a, b) => (ORDER_OF_UNIT.get(a) ?? 0) - (ORDER_OF_UNIT.get(b) ?? 0));
  return { writes, category, skippedLocked };
}

// ---------------------------------------------------------------------------------------------------
// What the screen says before anything is written

/** "Clause 28", "Item 2", "Part A", or the name of a unit without a number. */
export function form26UnitTitle(unit: Form26ClauseUnit): string {
  const title = editorTitle(unit);
  return title.prefix ?? title.label;
}

function titleOfClause(clauseKey: string): string {
  const unit = UNIT_BY_KEY.get(clauseKey);
  return unit ? form26UnitTitle(unit) : clauseKey;
}

function cellPlace(def: Form26Definition, table: Form26Table, row: number, column: string): string {
  let heading = column;
  if (table.dep) {
    const rate = Number(column) - row * 20;
    heading = depreciationColumnLabels(table)[rate] ?? column;
  } else {
    const found = table.columns.find((entry) => entry.c === column);
    if (found) heading = rowListHeading(found);
  }
  return `${titleOfClause(form26ClauseKeyOfTable(table.id))}, row ${row + 1}, ${heading}`;
}

function placeOf(def: Form26Definition, where: string): string {
  const parsed = parseForm26Where(where);
  if ('key' in parsed) {
    const field = def.fields.find((entry) => entry.key === parsed.key);
    if (!field) return `Answer "${parsed.key}"`;
    let clause = '';
    for (const unit of FORM26_CLAUSE_UNITS) if (unit.fields.includes(field.key)) clause = form26UnitTitle(unit);
    return field.label ? `${clause}: ${field.label}` : clause;
  }
  const table = def.tables.find((entry) => entry.id === parsed.table);
  return table ? cellPlace(def, table, parsed.row, parsed.column) : `Table "${parsed.table}"`;
}

const REASON: Record<Extract<Form26ImportNote, { kind: 'value-dropped' }>['reason'], string> = {
  'not-an-option': 'is not one of the choices',
  'not-a-number': 'is not a number',
  'not-a-date': 'is not a date',
};

const sameName = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/** What the dialog shows before anything is written. `current`: the answers on screen now. */
export function importSummary(def: Form26Definition, plan: Form26ImportablePlan, current: Form26Values, skippedLocked: string[]): Form26ImportSummary {
  const { answers, tables, cells } = plan.summary;
  const counts = `${plural(answers, 'answer', 'answers')} and ${plural(tables, 'table', 'tables')} (${plural(cells, 'cell', 'cells')})`;

  const identity: string[] = [];
  const filePan = (plan.values.f['C.pan'] ?? '').trim().toUpperCase();
  const ownPan = (current.f['C.pan'] ?? '').trim().toUpperCase();
  if (filePan !== '' && ownPan !== '' && filePan !== ownPan) identity.push(`This file is for PAN ${filePan}. This audit is for PAN ${ownPan}.`);
  const fileName = (plan.values.f['C.name'] ?? '').trim();
  const ownName = (current.f['C.name'] ?? '').trim();
  if (fileName !== '' && ownName !== '' && !sameName(fileName, ownName)) identity.push(`This file is for ${fileName}. This audit is for ${ownName}.`);

  const radioKeys = new Set(def.saveFile.radioKeys);
  const dropped: string[] = [];
  const missingAnswers: string[] = [];
  const cleared: string[] = [];
  let missingCells = 0;
  const missingCellPlaces: string[] = [];
  const missingTables: string[] = [];
  const rows: string[] = [];
  const unknown: string[] = [];
  for (const note of plan.notes) {
    switch (note.kind) {
      case 'value-dropped':
        dropped.push(`${placeOf(def, note.where)}: "${note.given}" ${REASON[note.reason]}.`);
        break;
      case 'missing-key': {
        const parsed = parseForm26Where(note.key);
        if (!('key' in parsed)) {
          missingCells += 1;
          missingCellPlaces.push(placeOf(def, note.key));
        } else if (radioKeys.has(note.key)) {
          // A group of options the file leaves out is cleared (as the office's file loads it): said when it had a choice.
          if ((current.f[note.key] ?? '') !== '') cleared.push(placeOf(def, note.key));
        } else if ((current.f[note.key] ?? '') !== '') {
          missingAnswers.push(placeOf(def, note.key));
        }
        break;
      }
      case 'missing-table': {
        const table = def.tables.find((entry) => entry.id === note.table);
        const held = current.t[note.table] ?? [];
        if (table && held.some((row) => Object.values(row).some((value) => value !== ''))) missingTables.push(`${titleOfClause(form26ClauseKeyOfTable(table.id))} (table ${table.id})`);
        break;
      }
      case 'rows-ignored': {
        const where = `${titleOfClause(form26ClauseKeyOfTable(note.table))} (table ${note.table})`;
        rows.push(note.given > 0 ? `${where}: the file has ${count(note.given)} rows; the form has ${count(note.kept)}.` : `${where}: the rows in the file are not a list; the rows on screen stay.`);
        break;
      }
      case 'unknown-key':
        unknown.push(`Answer "${note.key}"`);
        break;
      case 'unknown-table':
        unknown.push(`Table "${note.table}"`);
        break;
      case 'unknown-column':
        unknown.push(`Table ${note.table}, column "${note.column}"`);
        break;
    }
  }

  const notes: Form26ImportNoteLine[] = [];
  const add = (kind: Form26ImportNoteLine['kind'], items: string[], text: string) => {
    if (items.length > 0) notes.push({ kind, text, items });
  };
  add('dropped', dropped, `${plural(dropped.length, 'value', 'values')} cannot be held and will be left blank`);
  add('missing-answers', missingAnswers, missingAnswers.length === 1 ? '1 answer is not in the file and stays as it is' : `${count(missingAnswers.length)} answers are not in the file and stay as they are`);
  add('cleared', cleared, cleared.length === 1 ? '1 choice is not in the file and will be cleared' : `${count(cleared.length)} choices are not in the file and will be cleared`);
  if (missingCells > 0) add('missing-cells', missingCellPlaces, missingCells === 1 ? '1 table cell is not in the file and keeps what it holds' : `${count(missingCells)} table cells are not in the file and keep what they hold`);
  add('missing-tables', missingTables, missingTables.length === 1 ? '1 table is not in the file and stays as it is' : `${count(missingTables.length)} tables are not in the file and stay as they are`);
  add('rows', rows, rows.length === 1 ? '1 table keeps its own number of rows' : `${count(rows.length)} tables keep their own number of rows`);
  add('unknown', unknown, unknown.length === 1 ? '1 item in the file is not part of Form No. 26 and is ignored' : `${count(unknown.length)} items in the file are not part of Form No. 26 and are ignored`);
  const locked = skippedLocked.map(titleOfClause);
  add('locked', locked, locked.length === 1 ? '1 approved clause will not be changed' : `${count(locked.length)} approved clauses will not be changed`);
  return { counts, identity, notes };
}

/** The same as lines: the counts, the warnings, then one sentence for each kind of thing not taken. */
export function importSummaryLines(def: Form26Definition, plan: Form26ImportablePlan, current: Form26Values, skippedLocked: string[]): string[] {
  const summary = importSummary(def, plan, current, skippedLocked);
  return [summary.counts, ...summary.identity, ...summary.notes.map((note) => note.text)];
}

/** Said once the file is loaded. */
export function form26ImportDoneSentence(summary: { answers: number; tables: number }, fileName: string): string {
  return `Loaded ${plural(summary.answers, 'answer', 'answers')} and ${plural(summary.tables, 'table', 'tables')} from ${fileName}.`;
}

/** Said when a write fails part of the way (the rows written stay; running it again completes it). */
export function form26ImportStoppedSentence(done: number, total: number): string {
  return `Loading stopped after ${count(done)} of ${count(total)}. The rest is unchanged. Try again.`;
}

/** The name of the copy of the present answers saved before a load (the application keeps no backup of its own). */
export function form26BeforeImportFileName(stem: string): string {
  return `${stem}_before-import.json`;
}
