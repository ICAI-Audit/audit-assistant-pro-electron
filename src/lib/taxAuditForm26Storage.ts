// Form No. 26 in the tax-audit tables: how the answers are split into storage rows and put together again.
//
// One row of `tax_audit_engagements` per audit (its `setup_json` holds the category of assessee and the
// view switches under the key "form26"), and 122 rows of `tax_audit_clause_responses`: one per clause unit,
// holding { v: 1, f: { answer key: text } }, and one per table, holding { v: 1, rows: [ { column key: text } ] }.
// Every row carries the Form 26 statutory-version key: the column's own default is the Form 3CD key.
// Pure functions only; the database is reached in taxAuditForm26Store.ts.
import { FORM26_ALL_ROW_KEYS, FORM26_CLAUSE_UNITS, form26ClauseKeyOfTable, form26TableRowKey, type Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Category, Form26Definition, Form26Table } from '@/data/taxAuditForm26Types';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { FORM26_SAVE_FILE_MAX_ROWS } from '@/lib/taxAuditForm26SaveFile';
import { defaultValues, form26RowCellKeys, type Form26Row, type Form26Values } from '@/lib/taxAuditForm26Values';
import { parseEngagementYear } from '@/lib/taxAuditForm26Year';
import type { TaxAuditFormType } from '@/types/taxAudit';

export type Form26ClausePayload = { v: 1; f: Record<string, string>; brought?: Record<string, { from: string; at: string }> };
export type Form26TablePayload = { v: 1; rows: Form26Row[] };
export type Form26Setup = {
  v: 1; category: '' | Form26Category; showAllSchedules: boolean; comparisonHidden?: boolean;
  conversion?: { fromTaxAuditId: string; startedAt: string; completedAt?: string; untouched: boolean; carried: string[] };
  importedFrom?: { fileName: string; at: string; by: string };
};
export type Form26NewAuditRow = {
  engagement_id: string; client_id: string | null; statutory_version: typeof TAX_AUDIT_FORM26_STATUTORY_VERSION; form_type: TaxAuditFormType;
  financial_year: string; assessee_name: string | null; pan: string | null; books_audited_under_other_law: 0 | 1; setup_json: string; review_status: 'draft';
};
export type Form26NewClauseRow = {
  tax_audit_id: string; clause_key: string; clause_no: string; clause_title: string; statutory_version: typeof TAX_AUDIT_FORM26_STATUTORY_VERSION;
  applicability_status: 'applicable'; response_json: string; prefill_status: 'not_attempted' | 'auto_filled'; validation_status: 'not_run';
  qualification_required: 0; workpaper_ref: string; review_status: 'draft'; locked: 0;
};

/** The answer key of the category of assessee: held in the audit row's setup, never in a clause row. */
export const FORM26_CATEGORY_FIELD = 'cat';
/** The clause row of the category: review state and evidence only. */
export const FORM26_CATEGORY_ROW_KEY = 'f26_category';
/** The particulars filled from the client master and the engagement when an audit is created. */
export const FORM26_PREFILL_KEYS = { name: 'C.name', pan: 'C.pan', taxYear: 'C.ty' } as const;

const SETUP_KEY = 'form26';

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(json: string | null | undefined): unknown {
  if (typeof json !== 'string' || json === '') return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// A stored value as text: text as it is, a number or true/false as its text; anything else is not a value.
function asText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return null;
}

const UNIT_BY_KEY = new Map<string, Form26ClauseUnit>(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit]));

/** True for one of the 122 storage keys of Form No. 26. */
export function isForm26RowKey(clauseKey: string): boolean {
  return FORM26_ROW_KEY_SET.has(clauseKey);
}
const FORM26_ROW_KEY_SET = new Set<string>(FORM26_ALL_ROW_KEYS);

/** Category (i) is reported in Part A ('3CA' in the table's own terms); category (ii) and "not chosen" in Part B ('3CB'). */
export function deriveFormType(category: '' | Form26Category): TaxAuditFormType {
  return category === '1' ? '3CA' : '3CB';
}

/** The two columns of the audit row that shadow the category; written with every setup save. */
export function derivedAuditColumns(category: '' | Form26Category): { form_type: TaxAuditFormType; books_audited_under_other_law: 0 | 1 } {
  return { form_type: deriveFormType(category), books_audited_under_other_law: category === '1' ? 1 : 0 };
}

const BLANK_SETUP: Form26Setup = { v: 1, category: '', showAllSchedules: false };

export function readSetup(setupJson: string | null | undefined): Form26Setup {
  const top = parseJson(setupJson);
  const held = isRecord(top) ? top[SETUP_KEY] : null;
  if (!isRecord(held)) return { ...BLANK_SETUP };
  const setup: Form26Setup = {
    v: 1,
    category: held.category === '1' || held.category === '2' ? held.category : '',
    showAllSchedules: held.showAllSchedules === true,
  };
  if (typeof held.comparisonHidden === 'boolean') setup.comparisonHidden = held.comparisonHidden;
  const conversion = held.conversion;
  if (isRecord(conversion) && typeof conversion.fromTaxAuditId === 'string' && typeof conversion.startedAt === 'string') {
    setup.conversion = {
      fromTaxAuditId: conversion.fromTaxAuditId,
      startedAt: conversion.startedAt,
      untouched: conversion.untouched === true,
      carried: Array.isArray(conversion.carried) ? conversion.carried.filter((key): key is string => typeof key === 'string') : [],
    };
    if (typeof conversion.completedAt === 'string') setup.conversion.completedAt = conversion.completedAt;
  }
  const imported = held.importedFrom;
  if (isRecord(imported) && typeof imported.fileName === 'string' && typeof imported.at === 'string') {
    setup.importedFrom = { fileName: imported.fileName, at: imported.at, by: typeof imported.by === 'string' ? imported.by : '' };
  }
  return setup;
}

/** The setup written under "form26"; every other top-level entry of `setup_json` is kept as it is. */
export function writeSetup(existingSetupJson: string | null | undefined, setup: Form26Setup): string {
  const top = parseJson(existingSetupJson);
  return JSON.stringify({ ...(isRecord(top) ? top : {}), [SETUP_KEY]: setup });
}

function presetCategory(def: Form26Definition): '' | Form26Category {
  const preset = def.fields.find((field) => field.key === FORM26_CATEGORY_FIELD)?.default;
  return preset === '1' || preset === '2' ? preset : '';
}

export function newAuditRow(
  input: { engagementId: string; clientId: string | null; financialYear: string; clientName: string | null; clientPan: string | null },
  def: Form26Definition,
): Form26NewAuditRow {
  const category = presetCategory(def);
  return {
    engagement_id: input.engagementId,
    client_id: input.clientId,
    statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION,
    form_type: deriveFormType(category),
    financial_year: input.financialYear,
    assessee_name: input.clientName,
    pan: input.clientPan,
    books_audited_under_other_law: derivedAuditColumns(category).books_audited_under_other_law,
    setup_json: writeSetup(null, { v: 1, category, showAllSchedules: false }),
    review_status: 'draft',
  };
}

// The tax year as item 8 of the form expects it ("2026-27"); a year text that is not understood is given as typed.
function taxYearText(financialYear: string): string {
  const parsed = parseEngagementYear(financialYear);
  if (!parsed) return financialYear.trim();
  return `${parsed.startYear}-${String(parsed.endYear % 100).padStart(2, '0')}`;
}

export function prefillParticulars(
  values: Form26Values,
  input: { clientName: string | null; clientPan: string | null; financialYear: string },
): { values: Form26Values; prefilled: string[] } {
  const f = { ...values.f };
  const prefilled: string[] = [];
  const offers: [string, string][] = [
    [FORM26_PREFILL_KEYS.name, (input.clientName ?? '').trim()],
    [FORM26_PREFILL_KEYS.pan, (input.clientPan ?? '').trim()],
    [FORM26_PREFILL_KEYS.taxYear, taxYearText(input.financialYear ?? '')],
  ];
  for (const [key, offered] of offers) {
    if (offered === '' || (hasOwn(f, key) && f[key] !== '')) continue;
    f[key] = offered;
    prefilled.push(key);
  }
  return { values: { f, t: values.t }, prefilled };
}

function tableOf(def: Form26Definition, tableId: string): Form26Table {
  const table = def.tables.find((entry) => entry.id === tableId);
  if (!table) throw new Error(`Form 26 has no table "${tableId}"`);
  return table;
}

// One row of a table as it is stored and shown: exactly the cells the table holds, each as text.
function wholeRow(table: Form26Table, rowIndex: number, held: unknown): Form26Row {
  const row: Form26Row = {};
  for (const key of form26RowCellKeys(table, rowIndex)) {
    const value = isRecord(held) && hasOwn(held, key) ? asText(held[key]) : null;
    row[key] = value ?? '';
  }
  return row;
}

// A table that always has the same rows (a fixed table, a depreciation table) is filled up to them.
function fixedRowCount(table: Form26Table): number | null {
  if (table.dep) return table.dep.rows.length;
  return table.kind === 'rows' ? null : table.fixedRows?.length ?? table.startRows;
}

function wholeRows(table: Form26Table, held: unknown[]): Form26Row[] {
  const count = Math.max(held.length, fixedRowCount(table) ?? 0);
  const rows: Form26Row[] = [];
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) rows.push(wholeRow(table, rowIndex, held[rowIndex]));
  return rows;
}

/** The `response_json` of a table's own row: every input column of every row. Throws for a table the form does not have. */
export function tablePayload(def: Form26Definition, tableId: string, rows: Form26Row[]): string {
  const payload: Form26TablePayload = { v: 1, rows: wholeRows(tableOf(def, tableId), rows) };
  return JSON.stringify(payload);
}

function clausePayloadOf(unit: Form26ClauseUnit, values: Form26Values): Form26ClausePayload {
  const f: Record<string, string> = {};
  if (unit.key !== FORM26_CATEGORY_ROW_KEY) {
    for (const key of unit.fields) {
      if (hasOwn(values.f, key) && typeof values.f[key] === 'string') f[key] = values.f[key];
    }
  }
  return { v: 1, f };
}

function newClauseRow(taxAuditId: string, clauseKey: string, clauseNo: string, title: string, workpaperRef: string, responseJson: string, autoFilled: boolean): Form26NewClauseRow {
  return {
    tax_audit_id: taxAuditId,
    clause_key: clauseKey,
    clause_no: clauseNo,
    clause_title: title,
    statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION,
    applicability_status: 'applicable',
    response_json: responseJson,
    prefill_status: autoFilled ? 'auto_filled' : 'not_attempted',
    validation_status: 'not_run',
    qualification_required: 0,
    workpaper_ref: workpaperRef,
    review_status: 'draft',
    locked: 0,
  };
}

/** The 122 rows of a new audit, in the order of FORM26_ALL_ROW_KEYS: 57 clause rows, then 65 table rows. */
export function seedRows(def: Form26Definition, taxAuditId: string, values: Form26Values, prefilled: string[]): Form26NewClauseRow[] {
  const prefilledKeys = new Set(prefilled);
  const rows: Form26NewClauseRow[] = FORM26_CLAUSE_UNITS.map((unit) => newClauseRow(
    taxAuditId, unit.key, unit.no, unit.label, unit.workpaperRef,
    JSON.stringify(clausePayloadOf(unit, values)),
    unit.fields.some((key) => prefilledKeys.has(key)),
  ));
  for (const table of def.tables) {
    const held = values.t[table.id];
    const owner = UNIT_BY_KEY.get(form26ClauseKeyOfTable(table.id));
    rows.push(newClauseRow(
      taxAuditId, form26TableRowKey(table.id), `T:${table.id}`, table.id, owner?.workpaperRef ?? '',
      tablePayload(def, table.id, Array.isArray(held) ? held : []),
      false,
    ));
  }
  return rows;
}

/** The rows an audit lacks, with the form's opening answers; never a row whose key is already there. */
export function missingRows(def: Form26Definition, taxAuditId: string, existingKeys: string[]): Form26NewClauseRow[] {
  const present = new Set(existingKeys);
  return seedRows(def, taxAuditId, defaultValues(def), []).filter((row) => !present.has(row.clause_key));
}

export function parseClausePayload(json: string | null | undefined): Form26ClausePayload {
  const top = parseJson(json);
  const payload: Form26ClausePayload = { v: 1, f: {} };
  if (!isRecord(top) || !isRecord(top.f)) return payload;
  for (const key of Object.keys(top.f)) {
    const value = asText(top.f[key]);
    if (value !== null) payload.f[key] = value;
  }
  if (isRecord(top.brought)) {
    const brought: Record<string, { from: string; at: string }> = {};
    for (const key of Object.keys(top.brought)) {
      const mark = top.brought[key];
      if (isRecord(mark) && typeof mark.from === 'string' && typeof mark.at === 'string') brought[key] = { from: mark.from, at: mark.at };
    }
    if (Object.keys(brought).length > 0) payload.brought = brought;
  }
  return payload;
}

/** A table's stored rows; at most as many as a save file may give a table (FORM26_SAVE_FILE_MAX_ROWS). */
export function parseTablePayload(json: string | null | undefined): Form26TablePayload {
  const top = parseJson(json);
  if (!isRecord(top) || !Array.isArray(top.rows)) return { v: 1, rows: [] };
  return {
    v: 1,
    rows: top.rows.slice(0, FORM26_SAVE_FILE_MAX_ROWS).map((held) => {
      const row: Form26Row = {};
      if (isRecord(held)) {
        for (const key of Object.keys(held)) {
          const value = asText(held[key]);
          if (value !== null) row[key] = value;
        }
      }
      return row;
    }),
  };
}

// The options of each group of options (radio key -> the values it can hold).
const radioOptionsCache = new WeakMap<Form26Definition, Map<string, Set<string>>>();
function radioOptionsOf(def: Form26Definition): Map<string, Set<string>> {
  let cached = radioOptionsCache.get(def);
  if (!cached) {
    cached = new Map();
    for (const key of def.saveFile.radioKeys) {
      const field = def.fields.find((entry) => entry.key === key);
      cached.set(key, new Set((field?.radioOptions ?? []).map((option) => option.value)));
    }
    radioOptionsCache.set(def, cached);
  }
  return cached;
}

/**
 * The answers of an audit from its stored rows. The category comes from the setup; a group of options with
 * none chosen has no key (as in the office's save file), and so has a group whose stored value is not one of
 * its options (the office's file clears such a group: it counts as not answered); any other answer a row
 * lacks is blank. Rows whose key is not one of Form No. 26's are ignored.
 */
export function valuesFromRows(def: Form26Definition, setup: Form26Setup, rows: { clause_key: string; response_json?: string | null }[]): Form26Values {
  const jsonByKey = new Map<string, string | null | undefined>();
  for (const row of rows) if (isForm26RowKey(row.clause_key)) jsonByKey.set(row.clause_key, row.response_json);

  const radioKeys = new Set(def.saveFile.radioKeys);
  const radioOptions = radioOptionsOf(def);
  const held: Record<string, string> = {};
  for (const unit of FORM26_CLAUSE_UNITS) {
    if (unit.key === FORM26_CATEGORY_ROW_KEY) continue;
    const payload = parseClausePayload(jsonByKey.get(unit.key));
    for (const key of unit.fields) if (hasOwn(payload.f, key)) held[key] = payload.f[key];
  }
  if (setup.category === '1' || setup.category === '2') held[FORM26_CATEGORY_FIELD] = setup.category;

  const f: Record<string, string> = {};
  for (const key of def.saveFile.fieldOrder) {
    const value = hasOwn(held, key) ? held[key] : '';
    if (radioKeys.has(key) && !radioOptions.get(key)?.has(value)) continue;
    f[key] = value;
  }

  const tableById = new Map(def.tables.map((table) => [table.id, table]));
  const t: Record<string, Form26Row[]> = {};
  for (const id of def.saveFile.tableOrder) {
    const table = tableById.get(id);
    if (!table) continue;
    t[id] = wholeRows(table, parseTablePayload(jsonByKey.get(form26TableRowKey(id))).rows);
  }
  return { f, t };
}

/**
 * A clause row's payload with some of its answers changed: only the fields given are touched, so a change
 * made meanwhile to another field of the same clause is kept. A field that is changed becomes the user's own
 * answer and loses its "brought from the 3CD draft" mark. Throws for a field that is not this clause's.
 */
export function clausePayloadPatch(def: Form26Definition, clauseKey: string, changes: Record<string, string>, current: Form26ClausePayload): Form26ClausePayload {
  const unit = UNIT_BY_KEY.get(clauseKey);
  if (!unit) throw new Error(`Form 26 has no clause "${clauseKey}"`);
  if (unit.key === FORM26_CATEGORY_ROW_KEY) throw new Error('The category of assessee is saved with the setup, not in a clause row.');
  const own = new Set(unit.fields);
  const known = new Set(def.saveFile.fieldOrder);
  const f = { ...current.f };
  const brought = { ...(current.brought ?? {}) };
  for (const key of Object.keys(changes)) {
    if (!own.has(key) || !known.has(key)) throw new Error(`"${key}" is not an answer of ${clauseKey}`);
    f[key] = changes[key];
    delete brought[key];
  }
  const next: Form26ClausePayload = { v: 1, f };
  if (Object.keys(brought).length > 0) next.brought = brought;
  return next;
}
