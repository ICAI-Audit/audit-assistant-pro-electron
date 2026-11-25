import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FORM26_ALL_ROW_KEYS, FORM26_CLAUSE_UNITS, form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  form26ImportDoneSentence,
  form26ImportStoppedSentence,
  importSummary,
  importSummaryLines,
  importWrites,
  type Form26ImportablePlan,
} from '@/lib/taxAuditForm26Import';
import { planImport, serialiseSaveFile } from '@/lib/taxAuditForm26SaveFile';
import { createForm26Session, type Form26Notice, type Form26Session } from '@/lib/taxAuditForm26Session';
import { parseClausePayload, readSetup, seedRows, valuesFromRows } from '@/lib/taxAuditForm26Storage';
import { createForm26Store, type Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';
import { clientOn, FakeTaxAuditDb } from './__fixtures__/taxAuditForm26/fakeTaxAuditDb';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
const EVERYTHING = fixture('save-everything-3-rows.json');

// The 122 rows of an audit, as the store holds them: holding nothing (the plan's vector), or the form's opening answers.
function freshRows(values: Form26Values = { f: {}, t: {} }): Map<string, Form26ClauseRow> {
  return new Map(
    seedRows(DEF, 'audit-1', values, []).map((row, i) => [
      row.clause_key,
      { ...row, id: `row-${i}`, created_at: '2026-11-22 10:00:00', updated_at: '2026-11-22 10:00:00' } as unknown as Form26ClauseRow,
    ]),
  );
}
const valuesOf = (rows: Map<string, Form26ClauseRow>, category: '' | '1' | '2' = '2'): Form26Values =>
  valuesFromRows(DEF, { v: 1, category, showAllSchedules: false }, [...rows.values()]);
function ok(text: string, current: Form26Values): Form26ImportablePlan {
  const plan = planImport(DEF, text, current);
  if ('message' in plan) throw new Error(plan.message);
  return plan;
}
// The rows after the writes are put in (as the database would hold them).
function applied(rows: Map<string, Form26ClauseRow>, writes: ReturnType<typeof importWrites>['writes']) {
  const next = new Map(rows);
  for (const write of writes) next.set(write.rowKey, { ...next.get(write.rowKey)!, response_json: write.responseJson });
  return next;
}

describe('importWrites', () => {
  it('the everything-filled file gives 120 row writes and the category (55 clause payloads, 65 tables)', () => {
    const rows = freshRows();
    const plan = ok(EVERYTHING, valuesOf(rows));
    const result = importWrites(DEF, plan, rows);
    expect(result.writes).toHaveLength(120);
    const clauseWrites = result.writes.filter((write) => !write.rowKey.startsWith('f26_t_'));
    expect(clauseWrites).toHaveLength(55);
    expect(clauseWrites.map((write) => write.rowKey)).not.toContain('f26_category');
    expect(clauseWrites.map((write) => write.rowKey)).not.toContain('f26_c49');
    expect(result.writes.filter((write) => write.rowKey.startsWith('f26_t_'))).toHaveLength(65);
    expect(result.category).toBe('2');
    expect(result.skippedLocked).toEqual([]);
    // In the order of the storage rows; every payload is the text written (tables through tablePayload).
    const order = result.writes.map((write) => FORM26_ALL_ROW_KEYS.indexOf(write.rowKey));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const write of result.writes) expect(JSON.parse(write.responseJson)).toEqual(write.payload);
  });

  it('from the form’s opening answers only the rows the file changes are written', () => {
    const rows = freshRows(defaultValues(DEF));
    const result = importWrites(DEF, ok(EVERYTHING, valuesOf(rows)), rows);
    expect(result.writes.length).toBeGreaterThan(65);
    expect(result.writes.length).toBeLessThan(120);
    // Clause 10's answer in the file is the opening "No": its row is not written; every table is.
    expect(result.writes.map((write) => write.rowKey)).not.toContain('f26_c10');
    expect(result.writes.filter((write) => write.rowKey.startsWith('f26_t_'))).toHaveLength(65);
  });

  it('after the writes the stored answers are the file: read back and saved again, the file is the same text', () => {
    const rows = freshRows();
    const plan = ok(EVERYTHING, valuesOf(rows));
    const after = applied(rows, importWrites(DEF, plan, rows).writes);
    // Calculated cells as the file has them (not recomputed), every value as given.
    expect(serialiseSaveFile(DEF, valuesOf(after, '2'))).toBe(EVERYTHING.replace(/\r\n/g, '\n').trimEnd());
  });

  it('a second run after a full import gives no write', () => {
    const rows = freshRows();
    const plan = ok(EVERYTHING, valuesOf(rows));
    const after = applied(rows, importWrites(DEF, plan, rows).writes);
    const again = importWrites(DEF, ok(EVERYTHING, valuesOf(after)), after);
    expect(again.writes).toEqual([]);
  });

  it('a locked clause and its tables are skipped and named', () => {
    const rows = freshRows();
    rows.set('f26_c28', { ...rows.get('f26_c28')!, review_status: 'approved', locked: 1 });
    rows.set('f26_c45', { ...rows.get('f26_c45')!, review_status: 'reviewed', locked: 1 });
    const plan = ok(EVERYTHING, valuesOf(rows));
    const result = importWrites(DEF, plan, rows);
    const keys = result.writes.map((write) => write.rowKey);
    const c28 = FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c28')!;
    const c45 = FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c45')!;
    for (const key of ['f26_c28', 'f26_c45', ...c28.tables.map(form26TableRowKey), ...c45.tables.map(form26TableRowKey)]) expect(keys).not.toContain(key);
    expect(result.writes).toHaveLength(120 - 2 - c28.tables.length - c45.tables.length);
    expect(result.skippedLocked).toEqual(['f26_c28', 'f26_c45']);
  });

  it('a locked category keeps the category and is named; a locked clause the file does not change is not named', () => {
    const rows = freshRows();
    rows.set('f26_category', { ...rows.get('f26_category')!, review_status: 'approved', locked: 1 });
    const save = JSON.parse(EVERYTHING) as { f: Record<string, string> };
    save.f.cat = '1';
    const plan = ok(JSON.stringify(save), valuesOf(rows));
    const result = importWrites(DEF, plan, rows, { category: '2' });
    expect(result.category).toBe('2');
    expect(result.skippedLocked).toEqual(['f26_category']);
    // Once the file is in, an approved clause the same file does not change is not named.
    const filled = applied(rows, result.writes);
    filled.set('f26_c49', { ...filled.get('f26_c49')!, review_status: 'approved', locked: 1 });
    const unchanged = importWrites(DEF, ok(EVERYTHING, valuesOf(filled)), filled, { category: '2' });
    expect(unchanged.skippedLocked).toEqual([]);
    expect(unchanged.writes).toEqual([]);
  });

  it('an answer brought from the 3CD draft and given by the file loses its mark (the file is the user\'s own answer)', () => {
    const rows = freshRows();
    const row = rows.get('f26_c10')!;
    const payload = parseClausePayload(row.response_json);
    rows.set('f26_c10', { ...row, response_json: JSON.stringify({ ...payload, f: { ...payload.f, c10: 'No' }, brought: { c10: { from: 'clause_8a', at: '2026-11-22' } } }) });
    const save = JSON.parse(EVERYTHING) as { f: Record<string, string> };
    save.f.c10 = 'No';
    const result = importWrites(DEF, ok(JSON.stringify(save), valuesOf(rows)), rows);
    const write = result.writes.find((entry) => entry.rowKey === 'f26_c10')!;
    expect(write).toBeDefined();
    expect('brought' in write.payload).toBe(false);
  });
});

describe('importSummary / importSummaryLines', () => {
  const rows = freshRows();
  const current = valuesOf(rows);

  it('the counts line of the everything file: 142 answers and 65 tables, with the cells', () => {
    const plan = ok(EVERYTHING, current);
    const summary = importSummary(DEF, plan, current, []);
    expect(summary.counts).toBe(`142 answers and 65 tables (${plan.summary.cells.toLocaleString('en-IN')} cells)`);
    expect(importSummaryLines(DEF, plan, current, [])[0]).toBe(summary.counts);
  });

  it('a file for another PAN and name gives the plain warning lines; the same PAN gives none', () => {
    const save = JSON.parse(EVERYTHING) as { f: Record<string, string> };
    save.f['C.pan'] = 'AAAAA1111A';
    const screen: Form26Values = { f: { ...current.f, 'C.pan': 'AAAAA0000A', 'C.name': 'Invented Traders Private Limited' }, t: current.t };
    const lines = importSummaryLines(DEF, ok(JSON.stringify(save), screen), screen, []);
    expect(lines).toContain('This file is for PAN AAAAA1111A. This audit is for PAN AAAAA0000A.');
    expect(lines).toContain('This file is for Invented C.name. This audit is for Invented Traders Private Limited.');
    const same: Form26Values = { f: { ...screen.f, 'C.name': 'invented c.name ' }, t: screen.t };
    save.f['C.pan'] = 'AAAAA0000A';
    expect(importSummary(DEF, ok(JSON.stringify(save), same), same, []).identity).toEqual([]);
    // Nothing to compare with (a blank on screen): no warning.
    const blank: Form26Values = { f: { ...current.f, 'C.pan': '', 'C.name': '' }, t: current.t };
    expect(importSummary(DEF, ok(EVERYTHING, blank), blank, []).identity).toEqual([]);
  });

  it('a file with one bad amount, one missing key and one unknown table: one sentence each, with its list', () => {
    const save = JSON.parse(EVERYTHING) as { f: Record<string, string>; t: Record<string, Record<string, string>[]> };
    save.t.S28[1]['3'] = 'twelve';
    delete save.f['C.a3'];
    (save.t as Record<string, unknown>).X99 = [{ 1: 'a' }];
    const screen: Form26Values = { f: { ...current.f, 'C.a3': 'Invented Road 1' }, t: current.t };
    const plan = ok(JSON.stringify(save), screen);
    const summary = importSummary(DEF, plan, screen, ['f26_c28', 'f26_c45']);
    const texts = summary.notes.map((note) => note.text);
    expect(texts).toEqual([
      '1 value cannot be held and will be left blank',
      '1 answer is not in the file and stays as it is',
      '1 item in the file is not part of Form No. 26 and is ignored',
      '2 approved clauses will not be changed',
    ]);
    expect(summary.notes[0].items).toEqual(['Clause 28, row 2, (D) Amount of penalty: "twelve" is not a number.']);
    expect(summary.notes[1].items).toEqual(['Item 2: Road/Street/Block/Sector']);
    expect(summary.notes[2].items).toEqual(['Table "X99"']);
    expect(summary.notes[3].items).toEqual(['Clause 28', 'Clause 45']);
    const lines = importSummaryLines(DEF, plan, screen, ['f26_c28', 'f26_c45']);
    expect(lines.slice(1)).toEqual(texts);
  });

  it('a group of options the file leaves out is cleared, and that is said', () => {
    const save = JSON.parse(EVERYTHING) as { f: Record<string, string> };
    delete save.f.q9;
    const screen: Form26Values = { f: { ...current.f, q9: (DEF.fields.find((f) => f.key === 'q9')!.radioOptions ?? [])[0].value }, t: current.t };
    const summary = importSummary(DEF, ok(JSON.stringify(save), screen), screen, []);
    const cleared = summary.notes.find((note) => note.text.startsWith('1 choice'));
    expect(cleared?.text).toBe('1 choice is not in the file and will be cleared');
    expect(cleared?.items).toHaveLength(1);
    expect(cleared?.items[0].startsWith('Clause 9')).toBe(true);
  });

  it('the produced sentences: done and stopped', () => {
    expect(form26ImportDoneSentence({ answers: 142, tables: 65 }, 'Form26_AAAAA0000A.json')).toBe('Loaded 142 answers and 65 tables from Form26_AAAAA0000A.json.');
    expect(form26ImportDoneSentence({ answers: 1, tables: 1 }, 'a.json')).toBe('Loaded 1 answer and 1 table from a.json.');
    expect(form26ImportStoppedSentence(38, 120)).toBe('Loading stopped after 38 of 120. The rest is unchanged. Try again.');
  });
});

// The import on screen runs inside the session (its row turns), against the strict stand-in database.
describe('session.applyImport', () => {
  let db: FakeTaxAuditDb;
  const sessions: Form26Session[] = [];
  let notices: Form26Notice[] = [];
  afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    if (db) expect(db.violations).toEqual([]);
  });

  async function ready() {
    db = new FakeTaxAuditDb();
    db.assigned.add('eng-1');
    db.seed('clients', { id: 'client-1', name: 'Invented Traders Private Limited', pan: 'AAAAA1111A' });
    db.seed('engagements', { id: 'eng-1', client_id: 'client-1', financial_year: '2026-27' });
    notices = [];
    const session = createForm26Session({
      store: createForm26Store(await clientOn(db)),
      engagement: { id: 'eng-1', client_id: 'client-1', financial_year: '2026-27' },
      userId: 'user-1',
      nowIso: () => '2026-11-22T10:30:00.000Z',
      onNotice: (notice) => notices.push(notice),
    });
    sessions.push(session);
    await session.load();
    expect(session.getState().status).toBe('ready');
    return session;
  }
  const storedRows = () => db.rows('tax_audit_clause_responses');

  it('writes every row, shows the values at once, records importedFrom, and a second run writes nothing', async () => {
    const session = await ready();
    const plan = ok(EVERYTHING, session.getState().values);
    const total = importWrites(DEF, plan, session.getState().rowsByKey).writes.length;
    expect(total).toBeGreaterThan(65);
    const progress: [number, number][] = [];
    const outcome = await session.applyImport(plan, 'Form26_AAAAA0000A.json', { onProgress: (done, all) => progress.push([done, all]) });
    expect(outcome).toEqual({ ok: true, written: total, skippedLocked: [], sentence: 'Loaded 142 answers and 65 tables from Form26_AAAAA0000A.json.' });
    expect(progress[0]).toEqual([0, total]);
    expect(progress[progress.length - 1]).toEqual([total, total]);
    const state = session.getState();
    expect(serialiseSaveFile(DEF, state.values)).toBe(EVERYTHING.replace(/\r\n/g, '\n').trimEnd());
    expect(state.setup.category).toBe('2');
    const setup = readSetup(String(db.rows('tax_audit_engagements')[0].setup_json));
    expect(setup.importedFrom).toEqual({ fileName: 'Form26_AAAAA0000A.json', at: '2026-11-22T10:30:00.000Z', by: 'user-1' });
    // What the database holds is the file.
    expect(serialiseSaveFile(DEF, valuesFromRows(DEF, setup, storedRows() as never))).toBe(EVERYTHING.replace(/\r\n/g, '\n').trimEnd());
    // A second run of the same file: no row is written.
    db.tick();
    const before = JSON.stringify(storedRows().map((row) => [row.clause_key, row.updated_at]));
    const again = await session.applyImport(ok(EVERYTHING, session.getState().values), 'Form26_AAAAA0000A.json');
    expect(again).toMatchObject({ ok: true, written: 0 });
    expect(JSON.stringify(storedRows().map((row) => [row.clause_key, row.updated_at]))).toBe(before);
  });

  it('a failure stops the load and says how far it got; running it again completes it', async () => {
    const session = await ready();
    const plan = ok(EVERYTHING, session.getState().values);
    const total = importWrites(DEF, plan, session.getState().rowsByKey).writes.length;
    let updates = 0;
    db.before = (request) => {
      // Only the writes of answers count (the mark "From client master" is taken off in the same turn).
      if (request.table === 'tax_audit_clause_responses' && request.action === 'update' && typeof request.data === 'object' && request.data !== null && 'response_json' in request.data) {
        updates += 1;
        if (updates === 39) return { data: null, error: { message: 'disk I/O error' } };
      }
      return undefined;
    };
    const stopped = await session.applyImport(plan, 'a.json');
    expect(stopped).toEqual({ ok: false, written: 38, message: `Loading stopped after 38 of ${total}. The rest is unchanged. Try again.` });
    expect(readSetup(String(db.rows('tax_audit_engagements')[0].setup_json)).importedFrom).toBeUndefined();
    db.before = null;
    const rest = await session.applyImport(ok(EVERYTHING, session.getState().values), 'a.json');
    expect(rest).toMatchObject({ ok: true, written: total - 38 });
    expect(serialiseSaveFile(DEF, session.getState().values)).toBe(EVERYTHING.replace(/\r\n/g, '\n').trimEnd());
  });

  it('a clause approved by someone else meanwhile is not written and is named', async () => {
    const session = await ready();
    const plan = ok(EVERYTHING, session.getState().values);
    const c28 = db.rows('tax_audit_clause_responses').find((row) => row.clause_key === 'f26_c28')!;
    db.changeElsewhere('tax_audit_clause_responses', c28.id as string, { review_status: 'approved', locked: 1 });
    const outcome = await session.applyImport(plan, 'a.json');
    expect(outcome).toMatchObject({ ok: true, skippedLocked: ['f26_c28'] });
    expect(parseClausePayload(String(db.rows('tax_audit_clause_responses').find((row) => row.clause_key === 'f26_c28')!.response_json)).f.c28).toBe('No');
  });

  it('is refused while a change on screen could not be saved', async () => {
    const session = await ready();
    // Every save of the typed value fails (also the retry the load's own flush makes).
    db.before = (request) => (request.table === 'tax_audit_clause_responses' && request.action === 'update' && JSON.stringify(request.data ?? '').includes('Invented Road 1') ? { data: null, error: { message: 'disk I/O error' } } : undefined);
    session.setField('C.a3', 'Invented Road 1');
    await session.flush();
    const writesBefore = db.writes().length;
    const outcome = await session.applyImport(ok(EVERYTHING, session.getState().values), 'a.json');
    expect(outcome).toEqual({ ok: false, written: 0, message: 'Some changes on screen are not saved yet. Save them, or choose which entry to keep, then load the file again.' });
    // Nothing of the file was written (only the retry of the typed value was tried).
    expect(db.writes().slice(writesBefore).every((write) => JSON.stringify(write.data ?? '').includes('Invented Road 1'))).toBe(true);
    db.before = null;
  });
});
