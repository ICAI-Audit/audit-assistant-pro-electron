import { afterEach, describe, expect, it } from 'vitest';
import { FORM26_ALL_ROW_KEYS, form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { parseClausePayload, parseTablePayload, tablePayload, writeSetup } from '@/lib/taxAuditForm26Storage';
import { createForm26RowWriter, createForm26Store, type Form26ClauseRow, type Form26Loaded } from '@/lib/taxAuditForm26Store';
import { defaultValues, form26RowCellKeys, type Form26Row } from '@/lib/taxAuditForm26Values';
import { clientOn, FakeTaxAuditDb, FORM26_VERSION, THREE_CD_VERSION, type FakeQuery, type FakeRow } from './__fixtures__/taxAuditForm26/fakeTaxAuditDb';

const INPUT = { engagementId: 'eng-1', clientId: 'client-1', financialYear: '2026-27', userId: 'user-1' };
const CLAUSES = 'tax_audit_clause_responses';
const AUDITS = 'tax_audit_engagements';
const LINKS = 'tax_audit_clause_evidence';
type Ready = Extract<Form26Loaded, { state: 'ready' }>;

let db: FakeTaxAuditDb;

async function open() {
  db = new FakeTaxAuditDb();
  db.assigned.add('eng-1');
  db.seed('clients', { id: 'client-1', name: 'Invented Traders', pan: 'AAAAA0000A' });
  db.seed('engagements', { id: 'eng-1', client_id: 'client-1', financial_year: '2026-27' });
  db.seed('evidence_files', { id: 'file-1', engagement_id: 'eng-1', name: 'ledger.pdf', file_path: 'eng-1/ledger.pdf' });
  return createForm26Store(await clientOn(db));
}

function ready(loaded: Form26Loaded): Ready {
  if (loaded.state !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(loaded)}`);
  return loaded;
}

const rowOf = (loaded: Ready, key: string): Form26ClauseRow => {
  const row = loaded.rows.find((entry) => entry.clause_key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
};
const stored = (id: string): FakeRow => {
  const row = db.rows(CLAUSES).find((entry) => entry.id === id);
  if (!row) throw new Error(`no stored row ${id}`);
  return row;
};
const payloadOf = (row: { response_json?: unknown }) => parseClausePayload(typeof row.response_json === 'string' ? row.response_json : null);

// A Form 3CD audit with two answered clauses on the same engagement.
function seedThreeCd(): { audit: FakeRow; clauses: FakeRow[] } {
  const audit = db.seed(AUDITS, { id: 'audit-3cd', engagement_id: 'eng-1', client_id: 'client-1', statutory_version: THREE_CD_VERSION, form_type: '3CA', setup_json: '{"applicability":{"x":1}}' });
  const clauses = [
    db.seed(CLAUSES, { id: '3cd-9', tax_audit_id: 'audit-3cd', clause_key: 'clause_9', clause_no: '9', clause_title: 'Partners', response_json: '{"structured":{"a":"Invented answer"}}' }),
    db.seed(CLAUSES, { id: '3cd-13', tax_audit_id: 'audit-3cd', clause_key: 'clause_13', clause_no: '13', clause_title: 'Method', response_json: '{"structured":{"b":"Another"}}' }),
  ];
  return { audit, clauses };
}

afterEach(() => {
  expect(db.violations).toEqual([]);
});

describe('load', () => {
  it('first load of a new engagement inserts one audit row and 122 clause rows, all with the Form 26 key', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));

    const audits = db.rows(AUDITS);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      engagement_id: 'eng-1', client_id: 'client-1', statutory_version: FORM26_VERSION, form_type: '3CB', books_audited_under_other_law: 0,
      financial_year: '2026-27', assessee_name: 'Invented Traders', pan: 'AAAAA0000A', review_status: 'draft', created_by: 'user-1', assessment_year: null,
    });
    const rows = db.rows(CLAUSES);
    expect(rows).toHaveLength(122);
    expect(rows.map((row) => row.clause_key).sort()).toEqual([...FORM26_ALL_ROW_KEYS].sort());
    for (const row of rows) {
      expect(row.statutory_version).toBe(FORM26_VERSION);
      expect(row.tax_audit_id).toBe(audits[0].id);
    }

    expect(loaded.audit.id).toBe(audits[0].id);
    expect(loaded.setup).toEqual({ v: 1, category: '2', showAllSchedules: false });
    expect(loaded.rows.map((row) => row.clause_key)).toEqual(FORM26_ALL_ROW_KEYS);          // in the order of the form
    expect(loaded.evidence).toEqual([]);
    const expected = defaultValues(DEF);
    expected.f['C.name'] = 'Invented Traders';
    expected.f['C.pan'] = 'AAAAA0000A';
    expected.f['C.ty'] = '2026-27';
    expect(loaded.values).toEqual(expected);
    expect(rows.filter((row) => row.prefill_status === 'auto_filled').map((row) => row.clause_key).sort()).toEqual(['f26_p1', 'f26_p3', 'f26_p8']);
  });

  it('second load inserts nothing', async () => {
    const store = await open();
    const first = ready(await store.load(INPUT));
    const before = db.rows(CLAUSES);
    const callsBefore = db.calls.length;
    db.tick(5);
    const second = ready(await store.load(INPUT));
    expect(db.calls.slice(callsBefore).filter((call) => call.action !== 'select')).toEqual([]);
    expect(db.rows(CLAUSES)).toEqual(before);
    expect(db.rows(AUDITS)).toHaveLength(1);
    expect(second.values).toEqual(first.values);
    expect(second.rows).toEqual(first.rows);
  });

  it('a load with 100 rows present inserts exactly the 22 missing and changes none of the 100', async () => {
    const store = await open();
    const first = ready(await store.load(INPUT));
    // An answer typed and a clause approved since the audit was made.
    const c13 = rowOf(first, 'f26_c13');
    db.changeElsewhere(CLAUSES, c13.id, { response_json: '{"v":1,"f":{"c13":"Books kept at the invented office"}}', review_status: 'approved', locked: 1 });
    const gone = FORM26_ALL_ROW_KEYS.filter((key) => key !== 'f26_c13').filter((_, index) => index % 5 === 0).slice(0, 22);
    expect(gone).toHaveLength(22);
    db.remove(CLAUSES, (row) => !gone.includes(String(row.clause_key)));
    const kept = db.rows(CLAUSES);
    expect(kept).toHaveLength(100);
    db.tick(60);
    const callsBefore = db.calls.length;

    const second = ready(await store.load(INPUT));

    const inserts = db.calls.slice(callsBefore).filter((call) => call.action !== 'select');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].action).toBe('insert');
    expect((inserts[0].data as FakeRow[]).map((row) => row.clause_key).sort()).toEqual([...gone].sort());
    const after = db.rows(CLAUSES);
    expect(after).toHaveLength(122);
    for (const row of kept) expect(after.find((entry) => entry.id === row.id)).toEqual(row);
    expect(second.values.f.c13).toBe('Books kept at the invented office');
    expect(rowOf(second, 'f26_c13').review_status).toBe('approved');
    // The rows topped up hold the form's opening answers.
    for (const key of gone) {
      const row = after.find((entry) => entry.clause_key === key);
      expect(row?.statutory_version).toBe(FORM26_VERSION);
      expect(row?.created_at).toBe(db.now());
    }
    const opening = defaultValues(DEF);
    expect(second.values.t).toEqual(opening.t);
  });

  it('a 3CD audit on the engagement gives needs-conversion and inserts nothing', async () => {
    const store = await open();
    const threeCd = seedThreeCd();
    const before = { audits: db.rows(AUDITS), clauses: db.rows(CLAUSES) };
    const loaded = await store.load(INPUT);
    expect(loaded).toEqual({ state: 'needs-conversion', threeCdAuditId: threeCd.audit.id });
    expect(db.writes()).toEqual([]);
    expect(db.rows(AUDITS)).toEqual(before.audits);
    expect(db.rows(CLAUSES)).toEqual(before.clauses);
  });

  it('an earlier 3CD audit row is never read back as Form 26', async () => {
    const store = await open();
    ready(await store.load(INPUT));                 // the Form 26 audit first, then a 3CD audit beside it
    seedThreeCd();
    const before = { audits: db.rows(AUDITS).filter((row) => row.id === 'audit-3cd'), clauses: db.rows(CLAUSES).filter((row) => row.tax_audit_id === 'audit-3cd') };
    const loaded = ready(await store.load(INPUT));
    expect(loaded.audit.statutory_version).toBe(FORM26_VERSION);
    expect(loaded.audit.id).not.toBe('audit-3cd');
    expect(loaded.rows).toHaveLength(122);
    expect(loaded.rows.every((row) => row.clause_key.startsWith('f26_') && row.tax_audit_id === loaded.audit.id)).toBe(true);
    expect(await store.findForm26Audit('eng-1')).toEqual({ id: loaded.audit.id });
    expect(await store.findThreeCdAudit('eng-1')).toEqual({ id: 'audit-3cd' });
    expect(db.rows(AUDITS).filter((row) => row.id === 'audit-3cd')).toEqual(before.audits);
    expect(db.rows(CLAUSES).filter((row) => row.tax_audit_id === 'audit-3cd')).toEqual(before.clauses);
  });

  it('every select on the tax-audit tables names the version, the audit or the row', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    await store.load(INPUT);
    await store.reloadRow(loaded.rows[0].id);
    await store.listEvidence(String(loaded.audit.id));
    await store.findThreeCdAudit('eng-1');
    const columnsOf = (call: FakeQuery) => (call.filters ?? []).map((filter) => filter.column);
    for (const call of db.calls.filter((entry) => entry.action === 'select')) {
      if (call.table === AUDITS) expect(columnsOf(call)).toContain('statutory_version');
      if (call.table === CLAUSES) expect(columnsOf(call).some((column) => column === 'tax_audit_id' || column === 'id')).toBe(true);
      if (call.table === LINKS) expect(columnsOf(call).some((column) => column === 'tax_audit_id' || column === 'id')).toBe(true);
    }
  });

  it('a user who is not on the engagement gets no-access and nothing is written', async () => {
    const store = await open();
    db.assigned.clear();
    expect(await store.load(INPUT)).toEqual({ state: 'no-access' });
    expect(db.writes()).toEqual([]);
    expect(db.rows(AUDITS)).toEqual([]);
  });

  it('a user who is not on the engagement does not see an audit that exists', async () => {
    const store = await open();
    ready(await store.load(INPUT));
    const writes = db.writes().length;
    db.assigned.clear();
    expect(await store.load(INPUT)).toEqual({ state: 'no-access' });
    expect(db.writes()).toHaveLength(writes);
  });

  it('a partner opens an engagement without being assigned to it', async () => {
    const store = await open();
    db.assigned.clear();
    db.globalAccess = true;
    expect(ready(await store.load(INPUT)).rows).toHaveLength(122);
  });

  it('a thrown error becomes state error', async () => {
    const store = await open();
    db.before = () => { throw new Error('IPC channel closed'); };
    const loaded = await store.load(INPUT);
    expect(loaded.state).toBe('error');
    expect(loaded).toEqual({ state: 'error', message: 'Form No. 26 could not be loaded.' });
    db.before = (query) => (query.table === CLAUSES ? { data: null, error: { message: 'database is locked' } } : undefined);
    expect(await store.load(INPUT)).toEqual({ state: 'error', message: 'Form No. 26 could not be loaded.' });
    db.before = null;
    expect((await store.load(INPUT)).state).toBe('ready');
  });

  it('seeding twice (two windows opening at once) does not duplicate rows', async () => {
    const storeA = await open();
    const storeB = createForm26Store(await clientOn(db));
    const [a, b] = await Promise.all([storeA.load(INPUT), storeB.load(INPUT)]);
    expect(db.rows(AUDITS)).toHaveLength(1);
    const keys = db.rows(CLAUSES).map((row) => row.clause_key);
    expect(keys).toHaveLength(122);
    expect(new Set(keys).size).toBe(122);
    expect(ready(a).audit.id).toBe(ready(b).audit.id);
    expect(ready(a).values).toEqual(ready(b).values);
    expect(ready(b).rows).toHaveLength(122);
  });

  it('a seed that stops midway is completed in the same load, and no row is written twice', async () => {
    const store = await open();
    // While the 122 rows are being inserted another window has already put one of them in: the insert stops there.
    db.before = (query) => {
      if (query.table === CLAUSES && query.action === 'insert' && Array.isArray(query.data) && query.data.length === 122) {
        const fiftieth = query.data[49] as FakeRow;
        db.seed(CLAUSES, { ...fiftieth, statutory_version: FORM26_VERSION });
      }
    };
    const loaded = ready(await store.load(INPUT));
    const keys = db.rows(CLAUSES).map((row) => row.clause_key);
    expect(keys).toHaveLength(122);
    expect(new Set(keys).size).toBe(122);
    expect(loaded.rows).toHaveLength(122);
  });

  it('when rows cannot be inserted the load says so, keeps what is there, and the next load completes it', async () => {
    const store = await open();
    let inserted = 0;
    db.before = (query) => {
      if (query.table !== CLAUSES || query.action !== 'insert') return undefined;
      // The first request is let through for its first 30 rows only (the rest "fails"); every later insert fails.
      if (inserted === 0 && Array.isArray(query.data)) {
        inserted = 30;
        for (const row of query.data.slice(0, 30)) db.seed(CLAUSES, row as FakeRow);
      }
      return { data: null, error: { message: 'disk I/O error' } };
    };
    expect(await store.load(INPUT)).toEqual({ state: 'error', message: 'Form No. 26 could not be prepared for this engagement.' });
    expect(db.rows(CLAUSES)).toHaveLength(30);
    expect(db.rows(AUDITS)).toHaveLength(1);
    const thirty = db.rows(CLAUSES);

    db.before = null;
    const loaded = ready(await store.load(INPUT));
    expect(db.rows(AUDITS)).toHaveLength(1);
    expect(db.rows(CLAUSES)).toHaveLength(122);
    for (const row of thirty) expect(stored(String(row.id))).toEqual(row);
    expect(loaded.values.f['C.name']).toBe('Invented Traders');
  });

  it('an audit seeded from an older definition gets its missing rows, and answered rows are not touched', async () => {
    const store = await open();
    const first = ready(await store.load(INPUT));
    const older = ['f26_c53', 'f26_t_S53a', 'f26_t_S53bi', 'f26_t_S53bii', 'f26_sign'];
    db.remove(CLAUSES, (row) => !older.includes(String(row.clause_key)));
    const s29 = rowOf(first, 'f26_t_S29');
    const typed = tablePayload(DEF, 'S29', [{ '1': 'Invented person' }]);
    db.changeElsewhere(CLAUSES, s29.id, { response_json: typed });
    const kept = db.rows(CLAUSES);
    db.tick(10);

    const second = ready(await store.load(INPUT));
    expect(db.rows(CLAUSES)).toHaveLength(122);
    for (const row of kept) expect(stored(String(row.id))).toEqual(row);
    expect(second.values.t.S29[0]['1']).toBe('Invented person');
    expect(second.values.f.c53a).toBe(defaultValues(DEF).f.c53a);
    expect(second.values.t.S53a).toEqual(defaultValues(DEF).t.S53a);
  });

  it('a row of the audit stored under another version is reported, not used', async () => {
    const store = await open();
    const first = ready(await store.load(INPUT));
    db.remove(CLAUSES, (row) => row.clause_key !== 'f26_c13');
    db.seed(CLAUSES, { tax_audit_id: first.audit.id, clause_key: 'f26_c13', clause_no: '13', clause_title: 'x' });   // the column default: the 3CD key
    expect(await store.load(INPUT)).toEqual({ state: 'error', message: 'Form No. 26 could not be prepared for this engagement.' });
  });

  it('createAudit takes a setup: category (i) is stored with form_type 3CA', async () => {
    const store = await open();
    const audit = await store.createAudit({ engagementId: 'eng-1', clientId: 'client-1', financialYear: '2026-27', setup: { category: '1', showAllSchedules: true } });
    expect(audit).toMatchObject({ statutory_version: FORM26_VERSION, form_type: '3CA', books_audited_under_other_law: 1 });
    expect(JSON.parse(String(audit.setup_json))).toEqual({ form26: { v: 1, category: '1', showAllSchedules: true } });
    // A second call finds the audit that is there; it never makes another.
    const again = await store.createAudit({ engagementId: 'eng-1', clientId: 'client-1', financialYear: '2026-27' });
    expect(again.id).toBe(audit.id);
    expect(db.rows(AUDITS)).toHaveLength(1);
    expect(db.rows(AUDITS)[0].form_type).toBe('3CA');
  });
});

describe('saveRow', () => {
  it('writes the patch and gives back the row with its new time stamp', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const row = rowOf(loaded, 'f26_c13');
    db.tick(3);
    const result = await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Yes"}}' });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.row.response_json).toBe('{"v":1,"f":{"c13":"Yes"}}');
    expect(result.row.updated_at).toBe(db.now());
    expect(result.row.updated_at).not.toBe(row.updated_at);
    expect(stored(row.id).response_json).toBe('{"v":1,"f":{"c13":"Yes"}}');
    // In the same second the stamp does not move; the save is still known to have landed.
    const again = await store.saveRow(result.row, { auditor_remarks_html: '<p>Seen</p>' });
    if (!again.ok) throw new Error(JSON.stringify(again));
    expect(again.row.auditor_remarks_html).toBe('<p>Seen</p>');
    expect(db.writes().filter((call) => call.action === 'update')).toHaveLength(2);
  });

  it('saveRow with a stale updated_at reports changed-elsewhere and writes nothing', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const row = rowOf(loaded, 'f26_c13');
    db.tick(2);
    db.changeElsewhere(CLAUSES, row.id, { response_json: '{"v":1,"f":{"c13":"Theirs"}}' });
    const theirs = stored(row.id);
    db.tick(2);
    const result = await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Mine"}}' });
    expect(result.ok).toBe(false);
    if (!('latest' in result)) throw new Error(JSON.stringify(result));
    expect(result.reason).toBe('changed-elsewhere');
    expect(result.latest).toEqual(theirs);
    expect(stored(row.id)).toEqual(theirs);
  });

  it('a change made elsewhere in the same second is detected too: the answers read are compared, not only the time', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const row = rowOf(loaded, 'f26_c13');
    db.changeElsewhere(CLAUSES, row.id, { response_json: '{"v":1,"f":{"c13":"Theirs"}}' });      // no tick: the stamp is the same
    expect(stored(row.id).updated_at).toBe(row.updated_at);
    const result = await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Mine"}}' });
    expect(result.ok).toBe(false);
    expect(payloadOf(stored(row.id)).f.c13).toBe('Theirs');
  });

  it('answers are never written into a row that was approved in the same second; its state can still be changed (unlocking)', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const row = rowOf(loaded, 'f26_c13');
    db.changeElsewhere(CLAUSES, row.id, { review_status: 'approved', locked: 1 });      // no tick, answers untouched
    const approved = stored(row.id);
    expect(approved.updated_at).toBe(row.updated_at);
    const result = await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Mine"}}' });
    expect(result.ok).toBe(false);
    expect(stored(row.id)).toEqual(approved);
    // The same for a row left in the state approved with the lock column off.
    db.changeElsewhere(CLAUSES, row.id, { locked: 0 });
    expect((await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Mine"}}' })).ok).toBe(false);
    expect(payloadOf(stored(row.id)).f.c13).toBe('');
    const unlocked = await store.saveRow(row, { review_status: 'draft', locked: 0, unlock_reason: 'Figure corrected' });
    expect(unlocked.ok).toBe(true);
    expect((await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Mine"}}' })).ok).toBe(true);
    expect(payloadOf(stored(row.id)).f.c13).toBe('Mine');
  });

  it('a change of state is checked against the answers given with the row (N2): an approval never lands on answers the approver has not seen', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const row = rowOf(loaded, 'f26_c13');
    db.changeElsewhere(CLAUSES, row.id, { response_json: '{"v":1,"f":{"c13":"Theirs"}}' });      // the same second: only the answers tell
    const theirs = stored(row.id);
    const approval = { review_status: 'approved', locked: 1, approved_by: 'user-1', approved_at: '2026-11-22T10:00:00.000Z' } as Partial<Form26ClauseRow>;
    const refused = await store.saveRow(row, approval);
    if (!('latest' in refused)) throw new Error(JSON.stringify(refused));
    expect(refused.reason).toBe('changed-elsewhere');
    expect(refused.latest).toEqual(theirs);
    expect(stored(row.id)).toEqual(theirs);
    // With the answers now on screen the approval goes in.
    const approved = await store.saveRow(refused.latest, approval);
    expect(approved.ok).toBe(true);
    expect(stored(row.id)).toMatchObject({ review_status: 'approved', locked: 1 });
    // A state patch sent without answers is checked on the time stamp only (unlocking, remarks).
    db.tick(2);
    const unlocked = await store.saveRow({ id: row.id, updated_at: String(stored(row.id).updated_at) }, { review_status: 'reviewed', locked: 0, unlock_reason: 'Invented reason' });
    expect(unlocked.ok).toBe(true);
  });

  it('never changes the columns that say which row it is', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const row = rowOf(loaded, 'f26_c13');
    const patch = { id: 'other', tax_audit_id: 'other', clause_key: 'clause_13', statutory_version: THREE_CD_VERSION, created_at: 'x', updated_at: 'y', review_status: 'prepared' } as unknown as Partial<Form26ClauseRow>;
    const result = await store.saveRow(row, patch);
    expect(result.ok).toBe(true);
    const update = db.writes().filter((call) => call.action === 'update').pop();
    expect(update?.data).toEqual({ review_status: 'prepared' });
    expect(stored(row.id)).toMatchObject({ id: row.id, clause_key: 'f26_c13', statutory_version: FORM26_VERSION, review_status: 'prepared' });
  });

  it('a refused or failed update is reported as failed with its message, and nothing is written', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const row = rowOf(loaded, 'f26_c13');
    const before = stored(row.id);
    db.before = (query) => (query.action === 'update' ? { data: null, error: { message: 'database is locked' } } : undefined);
    expect(await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Mine"}}' })).toEqual({ ok: false, reason: 'failed', message: 'database is locked' });
    db.before = (query) => { if (query.action === 'update') throw new Error('IPC channel closed'); };
    expect(await store.saveRow(row, { response_json: '{"v":1,"f":{"c13":"Mine"}}' })).toEqual({ ok: false, reason: 'failed', message: 'IPC channel closed' });
    db.before = null;
    expect(await store.saveRow(row, { review_status: 'not-a-state' } as unknown as Partial<Form26ClauseRow>)).toMatchObject({ ok: false, reason: 'failed' });
    expect(stored(row.id)).toEqual(before);
  });

  it('a row of a Form 3CD audit is never written, whatever id is passed', async () => {
    const store = await open();
    ready(await store.load(INPUT));
    const threeCd = seedThreeCd();
    const result = await store.saveRow({ id: '3cd-9', updated_at: String(threeCd.clauses[0].updated_at) }, { response_json: '{"v":1,"f":{}}', review_status: 'approved' });
    expect(result.ok).toBe(false);
    expect(await store.reloadRow('3cd-9')).toBeNull();
    expect(db.rows(CLAUSES).filter((row) => row.tax_audit_id === 'audit-3cd')).toEqual(threeCd.clauses);
    expect(await store.saveSetup({ id: 'audit-3cd', setup_json: '{}' }, { category: '1' })).toMatchObject({ ok: false, reason: 'failed' });
    expect(db.rows(AUDITS).find((row) => row.id === 'audit-3cd')).toEqual(threeCd.audit);
  });

  it('250 rows in a table are stored and read back identical, and no other row is rewritten', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const table = DEF.tables.find((entry) => entry.id === 'S29');
    if (!table) throw new Error('S29');
    const keys = form26RowCellKeys(table, 0);
    const many: Form26Row[] = Array.from({ length: 250 }, (_, index) => Object.fromEntries(keys.map((key) => [key, `Invented ${index}-${key}`])));
    const others = db.rows(CLAUSES).filter((row) => row.clause_key !== 'f26_t_S29');
    db.tick(7);
    const result = await store.saveRow(rowOf(loaded, 'f26_t_S29'), { response_json: tablePayload(DEF, 'S29', many) });
    expect(result.ok).toBe(true);
    const again = ready(await store.load(INPUT));
    expect(again.values.t.S29).toEqual(many);
    expect(parseTablePayload(rowOf(again, 'f26_t_S29').response_json).rows).toEqual(many);
    expect(db.rows(CLAUSES).filter((row) => row.clause_key !== 'f26_t_S29')).toEqual(others);
    for (const key of Object.keys(again.values.t)) if (key !== 'S29') expect(again.values.t[key]).toEqual(loaded.values.t[key]);
  });
});

describe('saveSetup', () => {
  it("saveSetup writes form_type '3CA' for category 1 and keeps other setup_json keys", async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const auditId = String(loaded.audit.id);
    // Another key in setup_json, written since the audit row was read.
    db.changeElsewhere(AUDITS, auditId, { setup_json: writeSetup('{"applicability":{"x":1}}', loaded.setup) });
    const saved = await store.saveSetup({ id: auditId, setup_json: loaded.audit.setup_json }, { category: '1', showAllSchedules: true });
    if (!('audit' in saved) || !saved.ok) throw new Error(JSON.stringify(saved));
    expect(saved.audit).toMatchObject({ id: auditId, form_type: '3CA', books_audited_under_other_law: 1, statutory_version: FORM26_VERSION });
    expect(saved.setup).toEqual({ v: 1, category: '1', showAllSchedules: true });
    expect(JSON.parse(String(db.rows(AUDITS)[0].setup_json))).toEqual({ applicability: { x: 1 }, form26: { v: 1, category: '1', showAllSchedules: true } });
    const update = db.writes().filter((call) => call.table === AUDITS && call.action === 'update').pop();
    expect(Object.keys(update?.data as object).sort()).toEqual(['books_audited_under_other_law', 'form_type', 'setup_json']);

    const back = await store.saveSetup(saved.audit, { category: '2' });
    expect(back).toMatchObject({ ok: true, audit: { form_type: '3CB', books_audited_under_other_law: 0 }, setup: { category: '2', showAllSchedules: true } });
    const none = await store.saveSetup({ id: auditId }, { category: '', showAllSchedules: false });
    expect(none).toMatchObject({ ok: true, audit: { form_type: '3CB', books_audited_under_other_law: 0 } });
    expect(ready(await store.load(INPUT)).setup).toEqual({ v: 1, category: '', showAllSchedules: false });
    expect(Object.prototype.hasOwnProperty.call(ready(await store.load(INPUT)).values.f, 'cat')).toBe(false);
  });

  it('a failed setup save is reported with its message and leaves the row as it was', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const before = db.rows(AUDITS);
    db.before = (query) => (query.action === 'update' ? { data: null, error: { message: 'database is locked' } } : undefined);
    expect(await store.saveSetup(loaded.audit, { category: '1' })).toEqual({ ok: false, reason: 'failed', message: 'database is locked' });
    expect(db.rows(AUDITS)).toEqual(before);
  });

  // REVIEW-F scenario S3.
  it('a stale window cannot put back a category it did not change, and a clash on the same entry is reported, not written', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const auditId = String(loaded.audit.id);
    const windowA = loaded.audit;
    const windowB = { ...loaded.audit };                       // loaded at the same time, never refreshed
    const a = await store.saveSetup(windowA, { category: '1' });
    expect(a.ok).toBe(true);
    db.tick(3);
    // B ticks "Show all schedules": only that entry is written; A's category stands.
    expect(await store.saveSetup(windowB, { showAllSchedules: true })).toMatchObject({ ok: true, setup: { category: '1', showAllSchedules: true } });
    const row = () => db.rows(AUDITS).find((entry) => entry.id === auditId)!;
    expect(JSON.parse(String(row().setup_json)).form26).toEqual({ v: 1, category: '1', showAllSchedules: true });
    expect(row().form_type).toBe('3CA');
    // B then chooses category (ii) while its screen still showed (ii) as stored: B is told, nothing is written.
    const before = row();
    const clash = await store.saveSetup(windowB, { category: '2' });
    if (!('fields' in clash)) throw new Error(JSON.stringify(clash));
    expect(clash).toMatchObject({ ok: false, reason: 'changed-elsewhere', fields: ['category'], setup: { category: '1' }, audit: { id: auditId, form_type: '3CA' } });
    expect(row()).toEqual(before);
    // "Keep mine": the same choice made on top of the row now shown.
    expect(await store.saveSetup(clash.audit, { category: '2' })).toMatchObject({ ok: true, audit: { form_type: '3CB' }, setup: { category: '2' } });
    // The value seen can also be given directly (the radio's value before the click).
    expect(await store.saveSetup(windowB, { category: '1' }, { category: '2' })).toMatchObject({ ok: true, setup: { category: '1' } });
  });

  it('an entry the patch does not name is never erased: a conversion completed elsewhere stays completed', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const auditId = String(loaded.audit.id);
    const conversion = { fromTaxAuditId: 'audit-3cd', startedAt: '2026-11-22 10:00:00', completedAt: '2026-11-22 10:00:05', untouched: false, carried: ['c13'] };
    db.tick(2);
    db.changeElsewhere(AUDITS, auditId, { setup_json: writeSetup(loaded.audit.setup_json, { ...loaded.setup, conversion, importedFrom: { fileName: 'Form26_x.json', at: '2026-11-22', by: 'user-2' } }) });
    db.tick(2);
    expect(await store.saveSetup(loaded.audit, { showAllSchedules: true, comparisonHidden: true })).toMatchObject({ ok: true });
    const held = JSON.parse(String(db.rows(AUDITS).find((entry) => entry.id === auditId)!.setup_json)).form26;
    expect(held).toEqual({ v: 1, category: '2', showAllSchedules: true, comparisonHidden: true, conversion, importedFrom: { fileName: 'Form26_x.json', at: '2026-11-22', by: 'user-2' } });
    // A patch naming the conversion without its completion time does not take the completion away.
    const fresh = ready(await store.load(INPUT)).audit;
    expect(await store.saveSetup(fresh, { conversion: { fromTaxAuditId: 'audit-3cd', startedAt: '2026-11-22 10:00:00', untouched: false, carried: ['c13', 'c14b'] } })).toMatchObject({ ok: true });
    expect(ready(await store.load(INPUT)).setup.conversion).toEqual({ ...conversion, carried: ['c13', 'c14b'] });
  });

  it('a change made between the read and the write of the same save is kept (same second)', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const auditId = String(loaded.audit.id);
    let once = true;
    db.before = (query) => {
      if (once && query.table === AUDITS && query.action === 'update') {
        once = false;
        db.changeElsewhere(AUDITS, auditId, { setup_json: writeSetup(loaded.audit.setup_json, { ...loaded.setup, category: '1' }), form_type: '3CA' });
      }
    };
    expect(await store.saveSetup(loaded.audit, { showAllSchedules: true })).toMatchObject({ ok: true, setup: { category: '1', showAllSchedules: true } });
    db.before = null;
    const row = db.rows(AUDITS).find((entry) => entry.id === auditId)!;
    expect(JSON.parse(String(row.setup_json)).form26).toEqual({ v: 1, category: '1', showAllSchedules: true });
    expect(row.form_type).toBe('3CA');
  });

  it('an audit row that is gone gives a failure, not a made-up row', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const auditId = String(loaded.audit.id);
    db.before = (query) => { if (query.table === AUDITS && query.action === 'update') db.remove(AUDITS, (row) => row.id !== auditId); };
    expect(await store.saveSetup(loaded.audit, { category: '1' })).toMatchObject({ ok: false, reason: 'failed' });
    db.before = null;
    expect(await store.saveSetup({ id: 'no-such-audit' }, { category: '1' })).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('the store keeps to the audit it opened', () => {
  it('a row, a link or an audit of another engagement is never written through it', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    db.assigned.add('eng-2');
    db.seed('engagements', { id: 'eng-2', client_id: 'client-1', financial_year: '2026-27' });
    db.seed('evidence_files', { id: 'file-2', engagement_id: 'eng-2', name: 'other.pdf', file_path: 'eng-2/other.pdf' });
    const other = ready(await createForm26Store(await clientOn(db)).load({ ...INPUT, engagementId: 'eng-2' }));
    const otherRow = rowOf(other, 'f26_c13');
    const before = db.rows(CLAUSES);
    const result = await store.saveRow(otherRow, { response_json: '{"v":1,"f":{"c13":"Wrong audit"}}', review_status: 'approved' });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    expect(await store.reloadRow(otherRow.id)).toBeNull();
    expect(db.rows(CLAUSES)).toEqual(before);
    // Evidence: a link of the other audit is not removed, and none is added to it.
    const link = db.seed(LINKS, { id: 'link-2', tax_audit_id: String(other.audit.id), clause_response_id: otherRow.id, clause_key: 'f26_c13', evidence_file_id: 'file-2', workpaper_ref: 'TA-F26-13' });
    await expect(store.unlinkEvidence('link-2')).rejects.toThrow();
    await expect(store.linkEvidence({ id: String(other.audit.id) }, otherRow, 'file-2', 'user-1')).rejects.toThrow();
    expect(db.rows(LINKS)).toEqual([link]);
    expect(await store.saveSetup(other.audit, { category: '1' })).toMatchObject({ ok: false, reason: 'failed' });
    // Its own audit still works.
    expect(await store.saveRow(rowOf(loaded, 'f26_c13'), { response_json: '{"v":1,"f":{"c13":"Right audit"}}' })).toMatchObject({ ok: true });
  });
});

describe('evidence', () => {
  it('linkEvidence writes workpaper_ref TA-F26-<no>', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const audit = { id: String(loaded.audit.id) };
    await store.linkEvidence(audit, rowOf(loaded, 'f26_c14'), 'file-1', 'user-1');
    await store.linkEvidence(audit, { ...rowOf(loaded, 'f26_part_a'), workpaper_ref: null }, 'file-1', 'user-1');
    const links = db.rows(LINKS);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ tax_audit_id: audit.id, clause_response_id: rowOf(loaded, 'f26_c14').id, clause_key: 'f26_c14', evidence_file_id: 'file-1', workpaper_ref: 'TA-F26-14', linked_by: 'user-1' });
    expect(links[1]).toMatchObject({ clause_key: 'f26_part_a', workpaper_ref: 'TA-F26-PartA' });
    // Linking the same file again is not an error and adds nothing.
    await store.linkEvidence(audit, rowOf(loaded, 'f26_c14'), 'file-1', 'user-1');
    expect(db.rows(LINKS)).toHaveLength(2);
    expect(await store.listEvidence(audit.id)).toHaveLength(2);
    expect(ready(await store.load(INPUT)).evidence).toHaveLength(2);

    await store.unlinkEvidence(String(links[0].id));
    expect(db.rows(LINKS).map((link) => link.clause_key)).toEqual(['f26_part_a']);
    await store.unlinkEvidence('no-such-link');
    expect(db.rows(LINKS)).toHaveLength(1);
  });

  it('evidence of a Form 3CD clause is never linked or unlinked from here', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const threeCd = seedThreeCd();
    const link = db.seed(LINKS, { id: 'link-3cd', tax_audit_id: 'audit-3cd', clause_response_id: '3cd-9', clause_key: 'clause_9', evidence_file_id: 'file-1', workpaper_ref: 'TA-3CD-9' });
    await expect(store.unlinkEvidence('link-3cd')).rejects.toThrow();
    await expect(store.linkEvidence({ id: 'audit-3cd' }, threeCd.clauses[1] as unknown as Form26ClauseRow, 'file-1', 'user-1')).rejects.toThrow();
    await expect(store.linkEvidence({ id: 'audit-3cd' }, rowOf(loaded, 'f26_c14'), 'file-1', 'user-1')).rejects.toThrow();
    expect(db.rows(LINKS)).toEqual([link]);
    expect(db.writes().filter((call) => call.table === LINKS)).toEqual([]);
    expect(ready(await store.load(INPUT)).evidence).toEqual([]);
  });
});

describe('the row writer (what the save queue calls)', () => {
  async function openWriter() {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    const rows = new Map(loaded.rows.map((row) => [row.clause_key, row]));
    const seen: string[] = [];
    const writer = createForm26RowWriter({
      store,
      getRow: (key) => rows.get(key),
      onRow: (row) => { rows.set(row.clause_key, row); seen.push(row.clause_key); },
    });
    const updates = () => db.writes().filter((call) => call.action === 'update');
    return { store, loaded, rows, seen, writer, updates };
  }
  const c14 = (changes: Record<string, string>) => JSON.stringify({ v: 1, f: { c14b: '', c14c: '', c14d: 'Yes', c14e: '', ...changes } });

  it('saves only the field given, in one write to one row', async () => {
    const { writer, rows, updates, loaded } = await openWriter();
    db.tick(4);
    expect(await writer.saveClause('f26_c14', { c14b: 'Invented software' })).toBe('ok');
    expect(updates()).toHaveLength(1);
    expect(payloadOf(stored(rowOf(loaded, 'f26_c14').id)).f).toEqual({ c14b: 'Invented software', c14c: '', c14d: 'Yes', c14e: '' });
    expect(rows.get('f26_c14')?.updated_at).toBe(db.now());           // the writer hands the fresh row back
    expect(db.rows(CLAUSES).filter((row) => row.updated_at === db.now())).toHaveLength(1);
  });

  it('nothing is sent for a value equal to the stored one', async () => {
    const { writer, updates } = await openWriter();
    expect(writer.isStored('f26_c14', 'c14d', 'Yes')).toBe(true);
    expect(writer.isStored('f26_c14', 'c14d', 'No')).toBe(false);
    expect(writer.isStored('f26_c14', 'c14b', '')).toBe(true);
    expect(writer.isStored('f26_c14', 'no-such-field', '')).toBe(true);   // a key the row does not hold reads as blank
    expect(writer.isStored('clause_13', 'c13', '')).toBe(false);         // a row that is not loaded holds nothing
    expect(await writer.saveClause('f26_c14', { c14d: 'Yes', c14b: '' })).toBe('ok');
    expect(await writer.saveTable('S29', defaultValues(DEF).t.S29)).toBe('ok');
    expect(updates()).toEqual([]);
    expect(db.calls.filter((call) => call.action === 'select' && call.table === CLAUSES && (call.filters ?? []).some((filter) => filter.column === 'id'))).toEqual([]);
  });

  it('a change made elsewhere to ANOTHER field is kept: both answers end in the row, without a word', async () => {
    const { writer, loaded, rows } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { response_json: c14({ c14c: 'Their cloud' }) });
    db.tick(2);
    expect(await writer.saveClause('f26_c14', { c14b: 'My software' })).toBe('ok');
    expect(payloadOf(stored(id)).f).toEqual({ c14b: 'My software', c14c: 'Their cloud', c14d: 'Yes', c14e: '' });
    expect(payloadOf(rows.get('f26_c14') ?? {}).f.c14c).toBe('Their cloud');
  });

  it('a change made elsewhere to the SAME field is not overwritten: it is reported, and the other fields of the save still go in', async () => {
    const { writer, loaded, rows, updates } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { response_json: c14({ c14b: 'Their software' }) });
    db.tick(2);
    expect(await writer.saveClause('f26_c14', { c14b: 'My software', c14e: 'My backup address' })).toEqual({ conflict: ['c14b'] });
    expect(payloadOf(stored(id)).f).toEqual({ c14b: 'Their software', c14c: '', c14d: 'Yes', c14e: 'My backup address' });
    expect(payloadOf(rows.get('f26_c14') ?? {}).f.c14b).toBe('Their software');
    // "Keep mine": the same save again, now knowingly on top of what was read.
    const before = updates().length;
    expect(await writer.saveClause('f26_c14', { c14b: 'My software' })).toBe('ok');
    expect(updates()).toHaveLength(before + 1);
    expect(payloadOf(stored(id)).f.c14b).toBe('My software');
  });

  it('the same answer given by both is not a conflict', async () => {
    const { writer, loaded, updates } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { response_json: c14({ c14b: 'Same software' }) });
    expect(await writer.saveClause('f26_c14', { c14b: 'Same software' })).toBe('ok');
    expect(updates()).toHaveLength(1);                                  // the one that found the row changed; no second one was needed
    expect(payloadOf(stored(id)).f.c14b).toBe('Same software');
  });

  it('a clause approved meanwhile is never overwritten', async () => {
    const { writer, loaded, rows, updates } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { review_status: 'approved', locked: 1, approved_by: 'user-2' });
    const approved = stored(id);
    db.tick(2);
    expect(await writer.saveClause('f26_c14', { c14b: 'Typed while it was approved' })).toEqual({ conflict: ['c14b'] });
    expect(stored(id)).toEqual(approved);
    expect(rows.get('f26_c14')?.review_status).toBe('approved');        // the screen learns of the lock
    // Trying again does not get through either, and does not even ask the database.
    const before = updates().length;
    expect(await writer.saveClause('f26_c14', { c14b: 'Typed while it was approved' })).toEqual({ conflict: ['c14b'] });
    expect(updates()).toHaveLength(before);
    expect(stored(id)).toEqual(approved);
  });

  it('a failed save reports its message and writes nothing; the same save works afterwards', async () => {
    const { writer, loaded } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    const before = stored(id);
    db.before = (query) => (query.action === 'update' ? { data: null, error: { message: 'database is locked' } } : undefined);
    expect(await writer.saveClause('f26_c14', { c14b: 'My software' })).toEqual({ failed: 'database is locked' });
    expect(stored(id)).toEqual(before);
    db.before = null;
    expect(await writer.saveClause('f26_c14', { c14b: 'My software' })).toBe('ok');
    expect(payloadOf(stored(id)).f.c14b).toBe('My software');
  });

  it('a save that fails in the middle of a merge leaves the other user’s row whole', async () => {
    const { writer, loaded } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { response_json: c14({ c14c: 'Their cloud' }) });
    const theirs = stored(id);
    let updatesSeen = 0;
    db.before = (query) => {
      if (query.action !== 'update') return undefined;
      updatesSeen += 1;
      return updatesSeen === 2 ? { data: null, error: { message: 'disk I/O error' } } : undefined;   // the merged write fails
    };
    expect(await writer.saveClause('f26_c14', { c14b: 'My software' })).toEqual({ failed: 'disk I/O error' });
    expect(stored(id)).toEqual(theirs);
    db.before = null;
    expect(await writer.saveClause('f26_c14', { c14b: 'My software' })).toBe('ok');
    expect(payloadOf(stored(id)).f).toMatchObject({ c14b: 'My software', c14c: 'Their cloud' });
  });

  it('a clash found before a later attempt fails is still reported, together with the failure', async () => {
    const { writer, loaded, rows } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { response_json: c14({ c14b: 'Theirs', c14c: 'Their cloud' }) });
    const theirs = stored(id);
    db.tick(2);
    let updatesSeen = 0;
    db.before = (query) => (query.action === 'update' && ++updatesSeen === 2 ? { data: null, error: { message: 'database is locked' } } : undefined);
    expect(await writer.saveClause('f26_c14', { c14b: 'Mine', c14e: 'My backup' })).toEqual({ conflict: ['c14b'], failed: 'database is locked' });
    db.before = null;
    expect(stored(id)).toEqual(theirs);
    expect(payloadOf(rows.get('f26_c14') ?? {}).f.c14b).toBe('Theirs');      // the screen can show "theirs"
  });

  it('with the value the user saw, a row refreshed meanwhile still shows the clash; without it, the row is the measure', async () => {
    const { writer, loaded, rows, updates } = await openWriter();
    const id = rowOf(loaded, 'f26_c14').id;
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { response_json: c14({ c14b: 'Theirs' }) });
    db.tick(2);
    expect(await writer.saveClause('f26_c14', { c14c: 'My cloud' }, { c14c: '' })).toBe('ok');   // refreshes the row held
    expect(payloadOf(rows.get('f26_c14') ?? {}).f.c14b).toBe('Theirs');
    const before = updates().length;
    // The user saw c14b blank: the stored "Theirs" is someone else's, so it is a clash and nothing is sent.
    expect(await writer.saveClause('f26_c14', { c14b: 'Mine' }, { c14b: '' })).toEqual({ conflict: ['c14b'] });
    expect(updates()).toHaveLength(before);
    expect(payloadOf(stored(id)).f.c14b).toBe('Theirs');
    // The same answer as theirs is no clash; a user who saw "Theirs" changes it knowingly.
    expect(await writer.saveClause('f26_c14', { c14b: 'Theirs' }, { c14b: '' })).toBe('ok');
    expect(await writer.saveClause('f26_c14', { c14b: 'Mine' }, { c14b: 'Theirs' })).toBe('ok');
    expect(payloadOf(stored(id)).f.c14b).toBe('Mine');
    // Without a seen value the row held is the measure (as before).
    expect(await writer.saveClause('f26_c14', { c14b: 'Mine again' })).toBe('ok');
    expect(payloadOf(stored(id)).f.c14b).toBe('Mine again');
  });

  it('a field of another clause, the category and an unknown clause are refused before anything is sent', async () => {
    const { writer, updates } = await openWriter();
    expect(await writer.saveClause('f26_c14', { c13: 'x' })).toMatchObject({ failed: expect.any(String) });
    expect(await writer.saveClause('f26_category', { cat: '1' })).toMatchObject({ failed: expect.any(String) });
    expect(await writer.saveClause('clause_13', { c13: 'x' })).toMatchObject({ failed: expect.any(String) });
    expect(await writer.saveTable('S999', [])).toMatchObject({ failed: expect.any(String) });
    expect(updates()).toEqual([]);
  });

  it('a table is saved in its own row only', async () => {
    const { writer, loaded, updates } = await openWriter();
    const others = db.rows(CLAUSES).filter((row) => row.clause_key !== 'f26_t_S29');
    db.tick(3);
    const rows: Form26Row[] = [{ ...defaultValues(DEF).t.S29[0], '1': 'Invented person' }];
    expect(await writer.saveTable('S29', rows)).toBe('ok');
    expect(updates()).toHaveLength(1);
    expect(parseTablePayload(String(stored(rowOf(loaded, 'f26_t_S29').id).response_json)).rows[0]['1']).toBe('Invented person');
    expect(db.rows(CLAUSES).filter((row) => row.clause_key !== 'f26_t_S29')).toEqual(others);
  });

  it('a table is not saved once its clause has been approved elsewhere', async () => {
    const { writer, loaded, rows, updates } = await openWriter();
    db.tick(2);
    db.changeElsewhere(CLAUSES, rowOf(loaded, 'f26_c29').id, { review_status: 'approved', locked: 1 });
    const before = stored(rowOf(loaded, 'f26_t_S29').id);
    expect(await writer.saveTable('S29', [{ ...defaultValues(DEF).t.S29[0], '1': 'Too late' }])).toEqual({ conflict: ['S29'] });
    expect(updates()).toEqual([]);
    expect(stored(rowOf(loaded, 'f26_t_S29').id)).toEqual(before);
    expect(rows.get('f26_c29')?.review_status).toBe('approved');
  });

  it('a table changed elsewhere is reported, not overwritten; saving again after that is the user’s choice', async () => {
    const { writer, loaded, rows } = await openWriter();
    const id = rowOf(loaded, 'f26_t_S29').id;
    db.tick(2);
    const theirs = tablePayload(DEF, 'S29', [{ '1': 'Their person' }, { '1': 'Their second' }]);
    db.changeElsewhere(CLAUSES, id, { response_json: theirs });
    db.tick(2);
    const mine: Form26Row[] = [{ ...defaultValues(DEF).t.S29[0], '1': 'My person' }];
    expect(await writer.saveTable('S29', mine)).toEqual({ conflict: ['S29'] });
    expect(stored(id).response_json).toBe(theirs);
    expect(rows.get('f26_t_S29')?.response_json).toBe(theirs);
    expect(await writer.saveTable('S29', mine)).toBe('ok');
    expect(stored(id).response_json).toBe(tablePayload(DEF, 'S29', mine));
  });
});

describe('last year (task 25): read only, the same client, the access rules of the main process', () => {
  const LAST_YEAR_INPUT = { engagementId: 'eng-1', clientId: 'client-1', financialYear: '2026-27' };
  // Last year's engagement of the same client with its Form 3CD audit and an answered clause 13; another
  // client's 2025-26 engagement; an older year of the same client.
  function seedLastYear(options: { assigned?: boolean } = {}) {
    db.seed('engagements', { id: 'eng-2025', client_id: 'client-1', financial_year: '2025-26' });
    db.seed('engagements', { id: 'eng-other', client_id: 'client-2', financial_year: '2025-26' });
    db.seed('engagements', { id: 'eng-2024', client_id: 'client-1', financial_year: '2024-25' });
    if (options.assigned !== false) db.assigned.add('eng-2025');
    db.assigned.add('eng-other');
    db.assigned.add('eng-2024');
    db.seed(AUDITS, { id: 'audit-2025', engagement_id: 'eng-2025', client_id: 'client-1', statutory_version: THREE_CD_VERSION, form_type: '3CB', financial_year: '2025-26' });
    db.seed(CLAUSES, { id: '2025-13', tax_audit_id: 'audit-2025', clause_key: 'clause_13', clause_no: '13', clause_title: 'Method of accounting and changes therein', response_json: '{"structured":{"method_of_accounting":"Mercantile","whether_change_in_method":"no"}}' });
    db.seed(CLAUSES, { id: '2025-15', tax_audit_id: 'audit-2025', clause_key: 'clause_15', clause_no: '15', clause_title: 'Capital asset converted', response_json: '{"structured":{}}' });
    db.seed(AUDITS, { id: 'audit-other', engagement_id: 'eng-other', client_id: 'client-2', statutory_version: THREE_CD_VERSION, form_type: '3CB' });
    db.seed(CLAUSES, { id: 'other-13', tax_audit_id: 'audit-other', clause_key: 'clause_13', clause_no: '13', clause_title: 'x', response_json: '{"structured":{"method_of_accounting":"Cash"}}' });
    db.seed(AUDITS, { id: 'audit-2024', engagement_id: 'eng-2024', client_id: 'client-1', statutory_version: THREE_CD_VERSION, form_type: '3CB' });
  }

  it('finds the Form 3CD audit of 2025-26 of the same client and returns its rows; every request is a select', async () => {
    const store = await open();
    seedLastYear();
    const callsBefore = db.calls.length;
    const result = await store.loadLastYear(LAST_YEAR_INPUT);
    if (result.state !== 'found') throw new Error(`expected found, got ${JSON.stringify(result)}`);
    expect(result.year).toBe('2025-26');
    expect(result.form).toBe('3cd');
    expect(result.audit.id).toBe('audit-2025');
    expect(result.rows.map((row) => row.id).sort()).toEqual(['2025-13', '2025-15']);
    const calls = db.calls.slice(callsBefore);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.action === 'select')).toBe(true);
    expect(db.writes()).toEqual([]);
  });

  it('a user who is not on last year\'s engagement gets "none", not an error, and nothing is written', async () => {
    const store = await open();
    seedLastYear({ assigned: false });
    const before = { audits: db.rows(AUDITS), clauses: db.rows(CLAUSES) };
    expect(await store.loadLastYear(LAST_YEAR_INPUT)).toEqual({ state: 'none', year: '2025-26', form: '3cd' });
    expect(db.writes()).toEqual([]);
    expect(db.rows(AUDITS)).toEqual(before.audits);
    expect(db.rows(CLAUSES)).toEqual(before.clauses);
  });

  it('no engagement of last year for this client (another client\'s does not count), no client, a year not understood: "none"', async () => {
    const store = await open();
    db.seed('engagements', { id: 'eng-other', client_id: 'client-2', financial_year: '2025-26' });
    db.assigned.add('eng-other');
    db.seed(AUDITS, { id: 'audit-other', engagement_id: 'eng-other', client_id: 'client-2', statutory_version: THREE_CD_VERSION, form_type: '3CB' });
    expect(await store.loadLastYear(LAST_YEAR_INPUT)).toEqual({ state: 'none', year: '2025-26', form: '3cd' });
    expect(await store.loadLastYear({ ...LAST_YEAR_INPUT, clientId: null })).toEqual({ state: 'none', year: '2025-26', form: '3cd' });
    expect(await store.loadLastYear({ ...LAST_YEAR_INPUT, financialYear: 'Year 26' })).toEqual({ state: 'none', year: null, form: '3cd' });
    expect(db.writes()).toEqual([]);
  });

  it('last year\'s engagement without a tax audit: "none"', async () => {
    const store = await open();
    db.seed('engagements', { id: 'eng-2025', client_id: 'client-1', financial_year: '2025-26' });
    db.assigned.add('eng-2025');
    expect(await store.loadLastYear(LAST_YEAR_INPUT)).toEqual({ state: 'none', year: '2025-26', form: '3cd' });
  });

  it('an engagement of 2027-28: last year is the Form No. 26 audit of 2026-27, its Form 26 rows only', async () => {
    const store = await open();
    db.seed('engagements', { id: 'eng-2027', client_id: 'client-1', financial_year: '2027-28' });
    db.assigned.add('eng-2027');
    ready(await store.load(INPUT));                       // the 2026-27 Form 26 audit of eng-1
    const result = await createForm26Store(await clientOn(db)).loadLastYear({ engagementId: 'eng-2027', clientId: 'client-1', financialYear: '2027-28' });
    if (result.state !== 'found') throw new Error(`expected found, got ${JSON.stringify(result)}`);
    expect(result.form).toBe('form26');
    expect(result.year).toBe('2026-27');
    expect(result.audit.statutory_version).toBe(FORM26_VERSION);
    expect(result.rows).toHaveLength(122);
  });

  it('a failed read is said plainly (state error), never thrown', async () => {
    const store = await open();
    seedLastYear();
    db.before = (query) => (query.table === 'tax_audit_clause_responses' ? { data: null, error: { message: 'database is locked' } } : undefined);
    expect(await store.loadLastYear(LAST_YEAR_INPUT)).toEqual({ state: 'error', message: 'database is locked' });
    expect(db.writes()).toEqual([]);
  });

  it('reading last year does not bind the store to that audit: the store keeps to the Form 26 audit it opened', async () => {
    const store = await open();
    seedLastYear();
    const loaded = ready(await store.load(INPUT));
    await store.loadLastYear(LAST_YEAR_INPUT);
    const row = rowOf(loaded, 'f26_c13');
    expect(await store.saveRow(row, { auditor_remarks_html: '<p>Invented remark</p>' })).toMatchObject({ ok: true });
    expect(await store.reloadRow('2025-13')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// Task 26: converting an existing Form 3CD draft (R5), the earlier draft read only, a changed year.
// The fake database refuses AND records any write to a Form 3CD row, clause row, evidence link or acceptance
// check (afterEach: `violations` stays empty); each test also compares those rows byte for byte.

const CHECKS = 'tax_audit_acceptance_checks';
const CONVERT = { engagementId: 'eng-1', clientId: 'client-1', financialYear: '2026-27', threeCdAuditId: 'audit-3cd', userId: 'user-1' };
const THREE_CD_KEYS = ['clause_1', 'clause_3', 'clause_8a', 'clause_12', 'clause_13', 'clause_15', 'clause_31', 'clause_37'];

// A Form 3CD draft as the 3CD page leaves it on opening (rows stamped once), optionally with answers saved later.
function seedThreeCdDraft(answers: Record<string, Record<string, unknown>> = {}, extra: { evidence?: boolean; acceptance?: boolean } = {}) {
  const audit = db.seed(AUDITS, { id: 'audit-3cd', engagement_id: 'eng-1', client_id: 'client-1', statutory_version: THREE_CD_VERSION, form_type: '3CA', financial_year: '2026-27', setup_json: '{"applicability":{"x":1}}' });
  for (const key of THREE_CD_KEYS) {
    db.seed(CLAUSES, { id: `3cd-${key}`, tax_audit_id: 'audit-3cd', clause_key: key, clause_no: key.slice(7), clause_title: key, response_json: '{}', prefill_status: 'needs_input', review_status: 'draft' });
  }
  db.tick(30);
  for (const [key, structured] of Object.entries(answers)) db.changeElsewhere(CLAUSES, `3cd-${key}`, { response_json: JSON.stringify({ structured }) });
  if (extra.evidence) db.seed(LINKS, { id: 'link-3cd', tax_audit_id: 'audit-3cd', clause_response_id: '3cd-clause_31', clause_key: 'clause_31', evidence_file_id: 'file-1' });
  if (extra.acceptance) db.seed(CHECKS, { id: 'check-3cd', tax_audit_id: 'audit-3cd', overall_status: 'in_progress' });
  db.tick(30);
  return audit;
}
const ANSWERS = {
  clause_8a: { opted_for_section_115_taxation: 'yes', selected_section_115_taxation: '115BAA' },
  clause_13: { method_of_accounting: 'Cash', whether_change_in_method: 'no', change_details: 'Invented: none' },
  clause_31: { clause_31a_loan_deposit_rows: [{ lender_or_depositor_name: 'Invented Lender', amount_of_loan_or_deposit: '50000' }] },
};
// Everything of the Form 3CD draft, as stored: the audit row, its clause rows, links and acceptance check.
const threeCdState = () => JSON.stringify({
  audits: db.rows(AUDITS).filter((row) => row.statutory_version !== FORM26_VERSION),
  clauses: db.rows(CLAUSES).filter((row) => row.statutory_version !== FORM26_VERSION),
  links: db.rows(LINKS).filter((row) => !String(row.clause_key).startsWith('f26_')),
  checks: db.rows(CHECKS),
});
const form26Rows = () => db.rows(CLAUSES).filter((row) => row.statutory_version === FORM26_VERSION);
const form26Audit = () => db.rows(AUDITS).filter((row) => row.statutory_version === FORM26_VERSION);
const setupOf = (row: FakeRow | undefined) => JSON.parse(String(row?.setup_json ?? '{}')).form26;
const f26Row = (key: string) => form26Rows().find((row) => row.clause_key === key) as FakeRow;
// Successful writes of a "brought" mark per answer key (counted from what each request changed).
function countBroughtWrites(): Record<string, number> {
  const counts: Record<string, number> = {};
  const original = db.sqliteQuery.bind(db);
  db.sqliteQuery = async (query: FakeQuery) => {
    const before = new Map(db.rows(CLAUSES).map((row) => [row.id, row.response_json]));
    // The fake carries a request out before its promise is returned: what changed now is this request's alone.
    const result = original(query);
    for (const row of db.rows(CLAUSES)) {
      const was = before.get(row.id);
      if (was === undefined || was === row.response_json) continue;
      const nowMarks = Object.keys(payloadOf(row).brought ?? {});
      const wasMarks = Object.keys(parseClausePayload(String(was)).brought ?? {});
      for (const key of nowMarks) if (!wasMarks.includes(key)) counts[key] = (counts[key] ?? 0) + 1;
    }
    return result;
  };
  return counts;
}

describe('task 26: the earlier draft, read only', () => {
  it('loadThreeCdSnapshot reads the audit, its rows, its evidence and its acceptance check, and writes nothing', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS, { evidence: true, acceptance: true });
    const callsBefore = db.calls.length;
    const snapshot = await store.loadThreeCdSnapshot('audit-3cd');
    expect(db.calls.slice(callsBefore).every((call) => call.action === 'select')).toBe(true);
    expect(snapshot?.audit.id).toBe('audit-3cd');
    expect(snapshot?.rows.map((row) => row.clause_key).sort()).toEqual([...THREE_CD_KEYS].sort());
    expect(snapshot?.evidenceCount).toBe(1);
    expect(snapshot?.hasAcceptanceCheck).toBe(true);
  });

  it('loadThreeCdSnapshot of an unknown id or of a Form No. 26 audit gives null', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    expect(await store.loadThreeCdSnapshot('no-such-audit')).toBeNull();
    expect(await store.loadThreeCdSnapshot(String(loaded.audit.id))).toBeNull();
  });
});

describe('task 26: convert', () => {
  it('an untouched draft: one audit row and 122 clause rows with the Form 26 key, exactly as a new audit, and no 3CD row changed', async () => {
    const store = await open();
    seedThreeCdDraft();
    const before = threeCdState();
    expect(await store.load(INPUT)).toEqual({ state: 'needs-conversion', threeCdAuditId: 'audit-3cd' });
    const loaded = ready(await store.convert(CONVERT));
    expect(threeCdState()).toBe(before);
    expect(form26Audit()).toHaveLength(1);
    expect(form26Rows()).toHaveLength(122);
    expect(form26Rows().every((row) => row.tax_audit_id === form26Audit()[0].id)).toBe(true);
    const expected = defaultValues(DEF);
    expected.f['C.name'] = 'Invented Traders';
    expected.f['C.pan'] = 'AAAAA0000A';
    expected.f['C.ty'] = '2026-27';
    expect(loaded.values).toEqual(expected);
    expect(form26Rows().some((row) => payloadOf(row).brought)).toBe(false);
    expect(loaded.setup.conversion).toMatchObject({ fromTaxAuditId: 'audit-3cd', untouched: true, carried: [] });
    expect(typeof loaded.setup.conversion?.completedAt).toBe('string');
    expect(db.writes().every((call) => call.table === AUDITS || call.table === CLAUSES)).toBe(true);
  });

  it('a draft with answers: the carried values come across marked "brought"; everything else starts with the presets; no 3CD row, link or check changed', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS, { evidence: true, acceptance: true });
    const before = threeCdState();
    const loaded = ready(await store.convert(CONVERT));
    expect(threeCdState()).toBe(before);
    expect(loaded.values.f.c10).toBe('Yes');
    expect(loaded.values.f.c15a).toBe('Cash system');
    expect(loaded.values.f.c15b).toBe('No');
    const c10 = payloadOf(f26Row('f26_c10'));
    expect(c10.brought?.c10).toEqual({ from: 'clause_8a', at: loaded.setup.conversion?.startedAt });
    expect(Object.keys(payloadOf(f26Row('f26_c15')).brought ?? {}).sort()).toEqual(['c15a', 'c15b']);
    // Nothing for the table of clause 31 or the cost audit of clause 37: those clauses show it beside them.
    expect(loaded.values.t.S45a).toEqual(defaultValues(DEF).t.S45a);
    expect(loaded.values.f.c12c).toBe('No');
    expect(loaded.setup.conversion).toMatchObject({ fromTaxAuditId: 'audit-3cd', untouched: false, carried: ['c10', 'c15a', 'c15b'] });
    expect(typeof loaded.setup.conversion?.completedAt).toBe('string');
    // The 3CD evidence stays linked to the 3CD draft; the Form No. 26 audit has none.
    expect(loaded.evidence).toEqual([]);
    expect(db.rows(LINKS).map((row) => row.tax_audit_id)).toEqual(['audit-3cd']);
  });

  it('the store is bound to the new audit: its rows can be saved at once', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    const loaded = ready(await store.convert(CONVERT));
    db.tick();
    const row = rowOf(loaded, 'f26_c14');
    const saved = await store.saveRow(row, { response_json: JSON.stringify({ v: 1, f: { ...payloadOf(row).f, c14b: 'Invented software' } }) });
    expect('row' in saved).toBe(true);
  });

  it('a second load after completion writes nothing', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    ready(await store.convert(CONVERT));
    db.tick(5);
    const callsBefore = db.calls.length;
    const rowsBefore = db.rows(CLAUSES);
    const again = ready(await store.load(INPUT));
    expect(db.calls.slice(callsBefore).filter((call) => call.action !== 'select')).toEqual([]);
    expect(db.rows(CLAUSES)).toEqual(rowsBefore);
    expect(again.values.f.c10).toBe('Yes');
  });

  it('a conversion started and left with 30 rows completes to 122 and applies each carried value once', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    const before = threeCdState();
    // A run that stopped after its audit row and 30 rows (the application closed, or an insert refused).
    let calls = 0;
    db.before = (query) => {
      if (query.table === CLAUSES && query.action === 'insert') {
        calls += 1;
        if (calls === 1) for (const row of (query.data as FakeRow[]).slice(0, 30)) db.seed(CLAUSES, { ...row });
        return { data: null, error: { message: 'The application was closed.' } };
      }
      return undefined;
    };
    const stopped = await store.convert(CONVERT);
    expect(stopped.state).toBe('error');
    db.before = null;
    expect(form26Rows()).toHaveLength(30);
    const audit = form26Audit()[0];
    expect(setupOf(audit).conversion.startedAt).toBeTruthy();
    expect(setupOf(audit).conversion.completedAt).toBeUndefined();

    db.tick(10);
    const counts = countBroughtWrites();
    const loaded = ready(await createForm26Store(await clientOn(db)).load(INPUT));
    expect(form26Rows()).toHaveLength(122);
    expect(counts).toEqual({ c10: 1, c15a: 1, c15b: 1 });
    expect(loaded.values.f.c10).toBe('Yes');
    expect(typeof loaded.setup.conversion?.completedAt).toBe('string');
    expect(threeCdState()).toBe(before);
    // And once more: nothing is written again.
    const writesBefore = db.writes().length;
    ready(await createForm26Store(await clientOn(db)).load(INPUT));
    expect(db.writes().length).toBe(writesBefore);
    expect(counts).toEqual({ c10: 1, c15a: 1, c15b: 1 });
  });

  it('a carried value whose write was refused leaves the conversion unfinished; the next load completes it once', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    db.before = (query) => (query.table === CLAUSES && query.action === 'update' ? { data: null, error: { message: 'disk I/O error' } } : undefined);
    expect((await store.convert(CONVERT)).state).toBe('error');
    db.before = null;
    expect(setupOf(form26Audit()[0]).conversion.completedAt).toBeUndefined();
    const counts = countBroughtWrites();
    const loaded = ready(await store.load(INPUT));
    expect(counts).toEqual({ c10: 1, c15a: 1, c15b: 1 });
    expect(loaded.setup.conversion?.carried).toEqual(['c10', 'c15a', 'c15b']);
  });

  it("a carried target edited by the user before the resume keeps the user's value", async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    db.before = (query) => (query.table === CLAUSES && query.action === 'update' ? { data: null, error: { message: 'stopped' } } : undefined);
    await store.convert(CONVERT);
    db.before = null;
    db.tick(5);
    const c10 = f26Row('f26_c10');
    db.changeElsewhere(CLAUSES, String(c10.id), { response_json: JSON.stringify({ v: 1, f: { c10: 'No' } }) });
    db.tick(5);
    const loaded = ready(await store.load(INPUT));
    expect(loaded.values.f.c10).toBe('No');
    expect(payloadOf(f26Row('f26_c10')).brought).toBeUndefined();
    expect(loaded.setup.conversion?.carried).toEqual(['c15a', 'c15b']);
  });

  it('two windows converting at once: one Form 26 audit, 122 rows, each carried value written once', async () => {
    await open();
    seedThreeCdDraft(ANSWERS);
    const before = threeCdState();
    const counts = countBroughtWrites();
    const client = await clientOn(db);
    const [a, b] = await Promise.all([createForm26Store(client).convert(CONVERT), createForm26Store(client).convert(CONVERT)]);
    expect(ready(a).audit.id).toBe(ready(b).audit.id);
    expect(form26Audit()).toHaveLength(1);
    expect(form26Rows()).toHaveLength(122);
    expect(counts).toEqual({ c10: 1, c15a: 1, c15b: 1 });
    expect(setupOf(form26Audit()[0]).conversion.carried).toEqual(['c10', 'c15a', 'c15b']);
    expect(threeCdState()).toBe(before);
  });

  it('convert when the Form 26 audit was made a moment ago by another window: that audit is used', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    ready(await createForm26Store(await clientOn(db)).convert(CONVERT));
    const loaded = ready(await store.convert(CONVERT));
    expect(form26Audit()).toHaveLength(1);
    expect(loaded.values.f.c10).toBe('Yes');
  });
});

describe('task 26: a changed year', () => {
  it('syncYear changes only financial_year', async () => {
    const store = await open();
    const loaded = ready(await store.load(INPUT));
    db.tick(5);
    const before = form26Audit()[0];
    const after = await store.syncYear(loaded.audit, '2027-28');
    const row = form26Audit()[0];
    expect(after.financial_year).toBe('2027-28');
    const { financial_year: y1, updated_at: u1, ...restBefore } = before;
    const { financial_year: y2, updated_at: u2, ...restAfter } = row;
    expect([y1, y2]).toEqual(['2026-27', '2027-28']);
    expect(u2).not.toBe(u1);
    expect(restAfter).toEqual(restBefore);
    expect(db.writes().slice(-1)[0]).toMatchObject({ table: AUDITS, action: 'update', data: { financial_year: '2027-28' } });
  });

  it('a load under another Form 26 year updates the audit row once; the answers stay; back again the same; the 3CD draft untouched', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    const before = threeCdState();
    ready(await store.convert(CONVERT));
    db.tick(5);
    const rowsBefore = db.rows(CLAUSES);
    const moved = ready(await store.load({ ...INPUT, financialYear: '2027-28' }));
    expect(moved.audit.financial_year).toBe('2027-28');
    expect(moved.values.f['C.ty']).toBe('2026-27');              // item 8 keeps its answer until the user updates it
    expect(db.rows(CLAUSES)).toEqual(rowsBefore);
    const writes = db.writes().length;
    ready(await store.load({ ...INPUT, financialYear: '2027-28' }));
    expect(db.writes().length).toBe(writes);
    ready(await store.load(INPUT));
    expect(form26Audit()[0].financial_year).toBe('2026-27');
    expect(db.rows(CLAUSES)).toEqual(rowsBefore);
    expect(threeCdState()).toBe(before);
  });

  it('readForm26Draft (the read-only view of a year changed back) only selects, and gives the answers', async () => {
    const store = await open();
    seedThreeCdDraft(ANSWERS);
    ready(await store.convert(CONVERT));
    const reader = createForm26Store(await clientOn(db));
    const callsBefore = db.calls.length;
    const draft = await reader.readForm26Draft('eng-1');
    expect(db.calls.slice(callsBefore).every((call) => call.action === 'select')).toBe(true);
    expect(draft?.values.f.c10).toBe('Yes');
    expect(draft?.rows).toHaveLength(122);
    expect(await reader.readForm26Draft('eng-none')).toBeNull();
  });
});
