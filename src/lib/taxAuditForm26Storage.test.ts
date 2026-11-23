import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_ALL_ROW_KEYS, FORM26_CLAUSE_UNITS, form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { categoryOf, shownParts } from '@/lib/taxAuditForm26Reveal';
import { FORM26_SAVE_FILE_MAX_ROWS, serialiseSaveFile } from '@/lib/taxAuditForm26SaveFile';
import { scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import {
  clausePayloadPatch,
  deriveFormType,
  missingRows,
  newAuditRow,
  parseClausePayload,
  parseTablePayload,
  prefillParticulars,
  readSetup,
  seedRows,
  tablePayload,
  valuesFromRows,
  writeSetup,
  type Form26Setup,
} from '@/lib/taxAuditForm26Storage';
import { defaultValues, form26RowCellKeys, type Form26Row, type Form26Values } from '@/lib/taxAuditForm26Values';

// Fixtures are read as text (tsconfig has no resolveJsonModule, and the bytes matter here).
const readText = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
const FILLED_TEXT = readText('save-everything-3-rows.json');
const filled = (): Form26Values => { const o = JSON.parse(FILLED_TEXT); return { f: o.f, t: o.t }; };
const SETUP_2: Form26Setup = { v: 1, category: '2', showAllSchedules: false };
const AUDIT_ID = 'audit-invented-1';

describe('seedRows', () => {
  const rows = seedRows(DEF, AUDIT_ID, defaultValues(DEF), []);

  it("seedRows gives 122 rows, each with the Form 26 version key, an f26_ clause key, review_status 'draft', locked 0 and a working-paper reference starting TA-F26-", () => {
    expect(rows).toHaveLength(122);
    expect(rows.map((row) => row.clause_key)).toEqual(FORM26_ALL_ROW_KEYS);
    for (const row of rows) {
      expect(row.statutory_version).toBe('ITA_2025_FORM_26_RULE_47_NOTIF_22_2026');
      expect(row.statutory_version).toBe(TAX_AUDIT_FORM26_STATUTORY_VERSION);
      expect(row.clause_key.startsWith('f26_')).toBe(true);
      expect(row.tax_audit_id).toBe(AUDIT_ID);
      expect(row.review_status).toBe('draft');
      expect(row.locked).toBe(0);
      expect(row.workpaper_ref.startsWith('TA-F26-')).toBe(true);
      expect(row.applicability_status).toBe('applicable');
      expect(row.validation_status).toBe('not_run');
      expect(row.qualification_required).toBe(0);
      expect(row.prefill_status).toBe('not_attempted');
      expect(typeof row.response_json).toBe('string');
    }
  });

  it('a clause row carries the number, label and reference of its unit; a table row is named by its table and filed under its clause', () => {
    const c14 = rows.find((row) => row.clause_key === 'f26_c14');
    expect(c14).toMatchObject({ clause_no: '14', workpaper_ref: 'TA-F26-14' });
    expect(c14?.clause_title).toBe(FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c14')?.label);
    const opening = defaultValues(DEF).f;
    expect(JSON.parse(c14?.response_json ?? '')).toEqual({ v: 1, f: { c14b: opening.c14b, c14c: opening.c14c, c14d: 'Yes', c14e: opening.c14e } });
    expect(JSON.parse(rows.find((row) => row.clause_key === 'f26_c17')?.response_json ?? '')).toEqual({ v: 1, f: { c17: 'No' } });
    const table = rows.find((row) => row.clause_key === 'f26_t_S45a');
    expect(table).toMatchObject({ clause_no: 'T:S45a', clause_title: 'S45a', workpaper_ref: 'TA-F26-45' });
    expect(rows.find((row) => row.clause_key === 'f26_part_a')?.workpaper_ref).toBe('TA-F26-PartA');
  });

  it('the category row holds no answer: the category lives in the setup', () => {
    expect(JSON.parse(rows[0].response_json)).toEqual({ v: 1, f: {} });
    expect(rows[0].clause_key).toBe('f26_category');
    for (const row of rows) expect(row.response_json.includes('"cat"')).toBe(false);
  });

  it('every table row holds every input column of every opening row', () => {
    for (const table of DEF.tables) {
      const row = rows.find((entry) => entry.clause_key === form26TableRowKey(table.id));
      const payload = JSON.parse(row?.response_json ?? '');
      expect(payload.v).toBe(1);
      expect(payload.rows).toHaveLength(table.startRows);
      payload.rows.forEach((cells: Form26Row, index: number) => expect(Object.keys(cells)).toEqual(form26RowCellKeys(table, index)));
    }
  });

  it("prefill_status is 'auto_filled' only on the particulars that were prefilled", () => {
    const seeded = seedRows(DEF, AUDIT_ID, defaultValues(DEF), ['C.name', 'C.ty']);
    const auto = seeded.filter((row) => row.prefill_status === 'auto_filled').map((row) => row.clause_key);
    expect(auto).toEqual(['f26_p1', 'f26_p8']);
  });

  it('seed then read gives back the default values', () => {
    const back = valuesFromRows(DEF, SETUP_2, rows);
    expect(back).toEqual(defaultValues(DEF));
    expect(back.f.cat).toBe('2');
  });

  it('with no category chosen the read values have no category key', () => {
    const back = valuesFromRows(DEF, { v: 1, category: '', showAllSchedules: false }, rows);
    expect(Object.prototype.hasOwnProperty.call(back.f, 'cat')).toBe(false);
    const expected = defaultValues(DEF);
    delete expected.f.cat;
    expect(back).toEqual(expected);
  });
});

describe('split and merge', () => {
  it('split and merge are inverse for the everything-filled file', () => {
    const rows = seedRows(DEF, AUDIT_ID, filled(), []);
    const back = valuesFromRows(DEF, SETUP_2, rows);
    expect(back).toEqual(filled());
    expect(serialiseSaveFile(DEF, back)).toBe(FILLED_TEXT);
  });

  it('the order of the rows read does not matter, and a row of another form is ignored', () => {
    const rows = [...seedRows(DEF, AUDIT_ID, filled(), [])].reverse();
    const withForeign = [{ clause_key: 'clause_13', response_json: '{"structured":{"c13":"Other"}}' }, ...rows];
    expect(valuesFromRows(DEF, SETUP_2, withForeign)).toEqual(filled());
  });

  it('a table of 250 rows is one payload under 40 kB for a ten-column table and does not appear in any clause payload', () => {
    const table = DEF.tables.find((entry) => entry.kind === 'rows' && form26RowCellKeys(entry, 0).length === 10);
    if (!table) throw new Error('no ten-column table in the definition');
    const keys = form26RowCellKeys(table, 0);
    const many: Form26Row[] = Array.from({ length: 250 }, (_, index) => Object.fromEntries(keys.map((key) => [key, `v${index}`])));
    const values = defaultValues(DEF);
    values.t[table.id] = many;
    const rows = seedRows(DEF, AUDIT_ID, values, []);
    const holder = rows.filter((row) => row.response_json.includes('"v249"'));
    expect(holder.map((row) => row.clause_key)).toEqual([form26TableRowKey(table.id)]);
    expect(holder[0].response_json.length).toBeLessThan(40_000);
    for (const row of rows.slice(0, 57)) expect(row.response_json.includes('"rows"')).toBe(false);
    expect(valuesFromRows(DEF, SETUP_2, rows).t[table.id]).toEqual(many);
    expect(JSON.parse(tablePayload(DEF, table.id, many)).rows).toEqual(many);
  });

  it('a stored option that is not one of its group\'s options reads as not answered, as the office\'s file clears it', () => {
    const unitOf = (key: string) => FORM26_CLAUSE_UNITS.find((unit) => unit.fields.includes(key))!.key;
    const bad: Record<string, string> = { q9: '9', c15a: 'not an option' };
    const rows = seedRows(DEF, AUDIT_ID, filled(), []).map((row) => {
      const keys = Object.keys(bad).filter((key) => unitOf(key) === row.clause_key);
      if (keys.length === 0) return row;
      const payload = JSON.parse(row.response_json);
      for (const key of keys) payload.f[key] = bad[key];
      return { ...row, response_json: JSON.stringify(payload) };
    });
    const back = valuesFromRows(DEF, SETUP_2, rows);
    for (const key of Object.keys(bad)) expect(Object.prototype.hasOwnProperty.call(back.f, key), key).toBe(false);
    const unfilled = scanUnfilled(DEF, back, { showAllSchedules: false }).filter((item) => 'k' in item).map((item) => ('k' in item ? item.k : ''));
    expect(unfilled).toEqual(expect.arrayContaining(['q9', 'c15a']));
    // A good option still reads; every radio key of the form is checked the same way.
    expect(valuesFromRows(DEF, SETUP_2, seedRows(DEF, AUDIT_ID, filled(), [])).f.q9).toBe(filled().f.q9);
    expect(DEF.saveFile.radioKeys).toEqual(expect.arrayContaining(['cat', 'q9', 'c15a']));
  });

  it('a category that is not one of the two is "not chosen" everywhere: both Parts shown, categoryOf null', () => {
    const setup = readSetup(JSON.stringify({ form26: { v: 1, category: '3', showAllSchedules: false } }));
    const back = valuesFromRows(DEF, setup, seedRows(DEF, AUDIT_ID, filled(), []));
    expect(Object.prototype.hasOwnProperty.call(back.f, 'cat')).toBe(false);
    expect(categoryOf(back)).toBeNull();
    expect(shownParts(back)).toEqual(['cat', 'A', 'B', 'C', 'D', 'S']);
    // Even a setup object that was never read through readSetup cannot carry one in.
    const raw = valuesFromRows(DEF, { v: 1, category: '3' as unknown as '1', showAllSchedules: false }, seedRows(DEF, AUDIT_ID, filled(), []));
    expect(categoryOf(raw)).toBeNull();
    expect(shownParts(raw)).toEqual(['cat', 'A', 'B', 'C', 'D', 'S']);
  });

  it('stored table rows are read up to the same limit as a save file', () => {
    const table = DEF.tables.find((entry) => entry.id === 'S29')!;
    const keys = form26RowCellKeys(table, 0);
    const many = Array.from({ length: FORM26_SAVE_FILE_MAX_ROWS + 3 }, (_, index) => Object.fromEntries(keys.map((key) => [key, `v${index}`])));
    const json = JSON.stringify({ v: 1, rows: many });
    expect(parseTablePayload(json).rows).toHaveLength(FORM26_SAVE_FILE_MAX_ROWS);
    expect(parseTablePayload(json).rows[FORM26_SAVE_FILE_MAX_ROWS - 1]['1']).toBe(`v${FORM26_SAVE_FILE_MAX_ROWS - 1}`);
    const rows = seedRows(DEF, AUDIT_ID, defaultValues(DEF), []).map((row) => (row.clause_key === 'f26_t_S29' ? { ...row, response_json: json } : row));
    expect(valuesFromRows(DEF, SETUP_2, rows).t.S29).toHaveLength(FORM26_SAVE_FILE_MAX_ROWS);
  });

  it('a stored table row lacking a cell reads with that cell blank; a fixed table is filled up to its rows', () => {
    const rows = seedRows(DEF, AUDIT_ID, defaultValues(DEF), []).map((row) => {
      if (row.clause_key === 'f26_t_S29') return { ...row, response_json: '{"v":1,"rows":[{"1":"Invented name"}]}' };
      if (row.clause_key === 'f26_t_Dpm') return { ...row, response_json: '{"v":1,"rows":[]}' };
      return row;
    });
    const back = valuesFromRows(DEF, SETUP_2, rows);
    const s29 = DEF.tables.find((table) => table.id === 'S29');
    if (!s29) throw new Error('S29');
    expect(Object.keys(back.t.S29[0])).toEqual(form26RowCellKeys(s29, 0));
    expect(back.t.S29[0]['1']).toBe('Invented name');
    expect(back.t.Dpm).toEqual(defaultValues(DEF).t.Dpm);
  });
});

describe('missingRows', () => {
  it('missingRows returns only absent keys and never an existing one', () => {
    const existing = FORM26_ALL_ROW_KEYS.filter((_, index) => index % 2 === 0).slice(0, 60);
    const rows = missingRows(DEF, AUDIT_ID, existing);
    expect(rows).toHaveLength(62);
    const present = new Set(existing);
    for (const row of rows) expect(present.has(row.clause_key)).toBe(false);
    expect([...existing, ...rows.map((row) => row.clause_key)].sort()).toEqual([...FORM26_ALL_ROW_KEYS].sort());
    for (const row of rows) expect(row.statutory_version).toBe(TAX_AUDIT_FORM26_STATUTORY_VERSION);
  });

  it('nothing is missing when all 122 are there; keys of another form do not count', () => {
    expect(missingRows(DEF, AUDIT_ID, FORM26_ALL_ROW_KEYS)).toEqual([]);
    expect(missingRows(DEF, AUDIT_ID, ['clause_9', 'clause_13'])).toHaveLength(122);
  });

  it('the top-up rows hold the opening answers', () => {
    const rows = missingRows(DEF, AUDIT_ID, []);
    expect(valuesFromRows(DEF, SETUP_2, rows)).toEqual(defaultValues(DEF));
  });
});

describe('the audit row and the setup', () => {
  it('deriveFormType', () => {
    expect(deriveFormType('1')).toBe('3CA');
    expect(deriveFormType('2')).toBe('3CB');
    expect(deriveFormType('')).toBe('3CB');
  });

  it("newAuditRow has form_type '3CB', books flag 0, version key, no assessment year key", () => {
    const row = newAuditRow({ engagementId: 'eng-1', clientId: 'client-1', financialYear: '2026-27', clientName: 'Invented Traders', clientPan: 'AAAAA0000A' }, DEF);
    expect(row).toEqual({
      engagement_id: 'eng-1',
      client_id: 'client-1',
      statutory_version: 'ITA_2025_FORM_26_RULE_47_NOTIF_22_2026',
      form_type: '3CB',
      financial_year: '2026-27',
      assessee_name: 'Invented Traders',
      pan: 'AAAAA0000A',
      books_audited_under_other_law: 0,
      setup_json: '{"form26":{"v":1,"category":"2","showAllSchedules":false}}',
      review_status: 'draft',
    });
    for (const key of ['assessment_year', 'previous_year_from', 'previous_year_to', 'applicability_result', 'applicability_reason', 'id']) {
      expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(false);
    }
  });

  it('readSetup is tolerant', () => {
    const blank: Form26Setup = { v: 1, category: '', showAllSchedules: false };
    expect(readSetup(null)).toEqual(blank);
    expect(readSetup(undefined)).toEqual(blank);
    expect(readSetup('')).toEqual(blank);
    expect(readSetup('{not json')).toEqual(blank);
    expect(readSetup('[1,2]')).toEqual(blank);
    expect(readSetup('{"form26":"x"}')).toEqual(blank);
    expect(readSetup('{"form26":{"category":"3","showAllSchedules":"yes"}}')).toEqual(blank);
    expect(readSetup('{"form26":{"v":1,"category":"1","showAllSchedules":true,"comparisonHidden":true}}')).toEqual({ v: 1, category: '1', showAllSchedules: true, comparisonHidden: true });
  });

  it('writeSetup keeps foreign keys of setup_json', () => {
    const written = writeSetup('{"applicability":{"x":1}}', { v: 1, category: '1', showAllSchedules: true });
    expect(JSON.parse(written)).toEqual({ applicability: { x: 1 }, form26: { v: 1, category: '1', showAllSchedules: true } });
    expect(readSetup(written)).toEqual({ v: 1, category: '1', showAllSchedules: true });
    expect(JSON.parse(writeSetup('{broken', SETUP_2))).toEqual({ form26: SETUP_2 });
  });

  it('the conversion and import records survive a write and a read', () => {
    const setup: Form26Setup = {
      v: 1, category: '2', showAllSchedules: false, comparisonHidden: false,
      conversion: { fromTaxAuditId: 'old-1', startedAt: '2026-11-22T10:00:00.000Z', untouched: false, carried: ['c10'] },
      importedFrom: { fileName: 'Form26_AAAAA0000A.json', at: '2026-11-22T10:05:00.000Z', by: 'user-1' },
    };
    expect(readSetup(writeSetup('{}', setup))).toEqual(setup);
  });
});

describe('prefillParticulars', () => {
  it('prefillParticulars fills C.name, C.pan and C.ty only when blank and reports them', () => {
    const base = defaultValues(DEF);
    const result = prefillParticulars(base, { clientName: 'Invented Traders', clientPan: 'AAAAA0000A', financialYear: '2026-27' });
    expect(result.prefilled).toEqual(['C.name', 'C.pan', 'C.ty']);
    expect(result.values.f['C.name']).toBe('Invented Traders');
    expect(result.values.f['C.pan']).toBe('AAAAA0000A');
    expect(result.values.f['C.ty']).toBe('2026-27');
    expect(base.f['C.name']).toBe('');                               // the input is not changed

    const partly = defaultValues(DEF);
    partly.f['C.name'] = 'Typed by the user';
    const second = prefillParticulars(partly, { clientName: 'Invented Traders', clientPan: null, financialYear: 'FY 2026-27' });
    expect(second.prefilled).toEqual(['C.ty']);
    expect(second.values.f['C.name']).toBe('Typed by the user');
    expect(second.values.f['C.pan']).toBe('');
    expect(second.values.f['C.ty']).toBe('2026-27');

    const none = prefillParticulars(defaultValues(DEF), { clientName: '  ', clientPan: '', financialYear: '' });
    expect(none.prefilled).toEqual([]);
    expect(none.values).toEqual(defaultValues(DEF));
  });
});

describe('payloads', () => {
  it('bad JSON in a row reads as empty, never throws', () => {
    for (const bad of [null, undefined, '', '{', 'null', '7', '"text"', '[]', '{"f":[1]}', '{"f":"x"}']) {
      expect(parseClausePayload(bad)).toEqual({ v: 1, f: {} });
    }
    for (const bad of [null, undefined, '', '{', 'null', '[]', '{"rows":{}}', '{"rows":"abc"}']) {
      expect(parseTablePayload(bad)).toEqual({ v: 1, rows: [] });
    }
    expect(parseClausePayload('{"v":1,"f":{"c13":"Yes","n":5,"o":{"a":1},"z":null}}')).toEqual({ v: 1, f: { c13: 'Yes', n: '5' } });
    expect(parseTablePayload('{"v":1,"rows":[{"1":"a","2":3},null,"x"]}')).toEqual({ v: 1, rows: [{ '1': 'a', '2': '3' }, {}, {}] });
    const rows = seedRows(DEF, AUDIT_ID, defaultValues(DEF), []).map((row) => ({ ...row, response_json: '{broken' }));
    expect(() => valuesFromRows(DEF, SETUP_2, rows)).not.toThrow();
  });

  it('a brought mark is read with its payload and kept by a change to another field', () => {
    const current = parseClausePayload('{"v":1,"f":{"c15a":"Cash system","c15b":"No"},"brought":{"c15b":{"from":"clause_13","at":"2026-11-22T10:00:00.000Z"}}}');
    expect(current.brought).toEqual({ c15b: { from: 'clause_13', at: '2026-11-22T10:00:00.000Z' } });
    const next = clausePayloadPatch(DEF, 'f26_c15', { c15a: 'Mercantile system' }, current);
    expect(next).toEqual({ v: 1, f: { c15a: 'Mercantile system', c15b: 'No' }, brought: { c15b: { from: 'clause_13', at: '2026-11-22T10:00:00.000Z' } } });
    expect(current.f.c15a).toBe('Cash system');                      // the input is not changed
  });

  it('a change to a brought field makes it the user’s own answer: the mark goes', () => {
    const current = parseClausePayload('{"v":1,"f":{"c15b":"No"},"brought":{"c15b":{"from":"clause_13","at":"x"}}}');
    expect(clausePayloadPatch(DEF, 'f26_c15', { c15b: 'Yes' }, current)).toEqual({ v: 1, f: { c15b: 'Yes' } });
  });

  it('clausePayloadPatch touches only the fields given and refuses a field of another clause, the category and a table row', () => {
    const current = parseClausePayload('{"v":1,"f":{"c14b":"No","c14c":"No","c14d":"Yes","c14e":"No"}}');
    expect(clausePayloadPatch(DEF, 'f26_c14', { c14c: 'Yes' }, current).f).toEqual({ c14b: 'No', c14c: 'Yes', c14d: 'Yes', c14e: 'No' });
    expect(() => clausePayloadPatch(DEF, 'f26_c14', { c13: 'x' }, current)).toThrow();
    expect(() => clausePayloadPatch(DEF, 'f26_category', { cat: '1' }, { v: 1, f: {} })).toThrow();
    expect(() => clausePayloadPatch(DEF, 'f26_t_S29', { '1': 'x' }, { v: 1, f: {} })).toThrow();
    expect(() => clausePayloadPatch(DEF, 'clause_13', { c13: 'x' }, { v: 1, f: {} })).toThrow();
  });

  it('tablePayload refuses a table the form does not have', () => {
    expect(() => tablePayload(DEF, 'S999', [])).toThrow();
  });
});
