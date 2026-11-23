import { afterEach, describe, expect, it } from 'vitest';
import { form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { createForm26RowTurns, createForm26Session, type Form26Notice, type Form26Session } from '@/lib/taxAuditForm26Session';
import { parseClausePayload, parseTablePayload } from '@/lib/taxAuditForm26Storage';
import { createForm26Store } from '@/lib/taxAuditForm26Store';
import { scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { clientOn, FakeTaxAuditDb, FORM26_VERSION, THREE_CD_VERSION, type FakeRow } from './__fixtures__/taxAuditForm26/fakeTaxAuditDb';

// The session is what the hook useTaxAuditForm26 holds: every rule of loading, saving, reviewing and linking
// evidence runs here, against the strict stand-in of the database and the application's real client.
const ENGAGEMENT = { id: 'eng-1', client_id: 'client-1', financial_year: '2026-27' };
const CLAUSES = 'tax_audit_clause_responses';
const AUDITS = 'tax_audit_engagements';
const LINKS = 'tax_audit_clause_evidence';

let db: FakeTaxAuditDb;
let sessions: Form26Session[] = [];
let notices: Form26Notice[] = [];

async function start(options: { assigned?: boolean; threeCd?: boolean } = {}) {
  db = new FakeTaxAuditDb();
  if (options.assigned !== false) db.assigned.add('eng-1');
  db.seed('clients', { id: 'client-1', name: 'Invented Traders Private Limited', pan: 'AAAAA0000A' });
  db.seed('engagements', { id: 'eng-1', client_id: 'client-1', financial_year: '2026-27' });
  db.seed('evidence_files', { id: 'file-1', engagement_id: 'eng-1', name: 'invented-ledger.pdf', file_path: 'eng-1/invented-ledger.pdf' });
  if (options.threeCd) db.seed(AUDITS, { id: 'audit-3cd', engagement_id: 'eng-1', statutory_version: THREE_CD_VERSION, form_type: '3CB' });
  notices = [];
  const session = createForm26Session({
    store: createForm26Store(await clientOn(db)),
    engagement: ENGAGEMENT,
    userId: 'user-1',
    nowIso: () => '2026-11-22T10:30:00.000Z',
    onNotice: (notice) => notices.push(notice),
  });
  sessions.push(session);
  return session;
}

async function ready(options?: { assigned?: boolean; threeCd?: boolean }) {
  const session = await start(options);
  await session.load();
  expect(session.getState().status).toBe('ready');
  return session;
}

const stored = (clauseKey: string): FakeRow => {
  const row = db.rows(CLAUSES).find((entry) => entry.clause_key === clauseKey);
  if (!row) throw new Error(`no stored row ${clauseKey}`);
  return row;
};
const storedAnswer = (clauseKey: string, key: string) => parseClausePayload(String(stored(clauseKey).response_json)).f[key];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
  if (db) expect(db.violations).toEqual([]);
});

describe('per-row turns (N3: never two saves of one row at a time)', () => {
  it('work for one row runs one after the other; other rows do not wait; idle waits for all', async () => {
    const turns = createForm26RowTurns();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = turns.run('f26_c13', () => new Promise<string>((resolve) => { releaseFirst = () => { order.push('first'); resolve('one'); }; }));
    const second = turns.run('f26_c13', async () => { order.push('second'); return 'two'; });
    const other = turns.run('f26_c14', async () => { order.push('other'); return 'three'; });
    await tick();
    expect(order).toEqual(['other']);
    expect(turns.busy()).toBe(true);
    releaseFirst();
    expect(await first).toBe('one');
    expect(await second).toBe('two');
    expect(await other).toBe('three');
    expect(order).toEqual(['other', 'first', 'second']);
    await turns.idle();
    expect(turns.busy()).toBe(false);
  });

  it('a failure in one turn does not stop the next', async () => {
    const turns = createForm26RowTurns();
    const failing = turns.run('k', async () => { throw new Error('refused'); });
    const next = turns.run('k', async () => 'after');
    await expect(failing).rejects.toThrow('refused');
    expect(await next).toBe('after');
  });
});

describe('opening', () => {
  it('a new engagement opens ready with 122 rows, the opening answers and the three particulars from the client master', async () => {
    const session = await ready();
    const state = session.getState();
    expect(state.rowsByKey.size).toBe(122);
    expect(state.values.f['C.name']).toBe('Invented Traders Private Limited');
    expect(state.values.f['C.pan']).toBe('AAAAA0000A');
    expect(state.values.f['C.ty']).toBe('2026-27');
    expect(state.values.f.cat).toBe('2');
    expect(state.setup.category).toBe('2');
    expect(state.saveState).toEqual({ kind: 'idle' });
    expect(state.unconfirmed.size).toBe(0);
    expect(state.audit?.statutory_version).toBe(FORM26_VERSION);
  });

  it('a user who is not on the engagement gets no-access; nothing is written', async () => {
    const session = await start({ assigned: false });
    await session.load();
    expect(session.getState().status).toBe('no-access');
    expect(db.writes()).toEqual([]);
  });

  it('an engagement that holds an untouched Form 3CD draft is converted at once, with no question; no 3CD row is written', async () => {
    const session = await start({ threeCd: true });
    const before = JSON.stringify(db.rows(AUDITS));
    await session.load();
    const state = session.getState();
    expect(state.status).toBe('ready');
    expect(state.rowsByKey.size).toBe(122);
    expect(state.unconfirmed.size).toBe(0);
    expect(state.setup.conversion).toMatchObject({ fromTaxAuditId: 'audit-3cd', untouched: true });
    expect(JSON.stringify(db.rows(AUDITS).filter((row) => row.statutory_version === THREE_CD_VERSION))).toBe(JSON.stringify(JSON.parse(before)));
  });

  it('a failed load says so with the plain message and can be tried again', async () => {
    const session = await start();
    db.before = () => { throw new Error('IPC channel closed'); };
    await session.load();
    expect(session.getState()).toMatchObject({ status: 'error', errorMessage: 'Form No. 26 could not be loaded.' });
    db.before = null;
    await session.reload();
    expect(session.getState().status).toBe('ready');
  });

  it('a load that ends after the session was closed changes nothing (a quick change of engagement never shows the earlier answers)', async () => {
    const session = await start();
    let release: () => void = () => undefined;
    db.before = (query) => (query.action === 'select' && query.table === AUDITS ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    const seen: string[] = [];
    session.subscribe((state) => seen.push(state.status));
    const loading = session.load();
    await tick();
    session.dispose();
    db.before = null;
    release();
    await loading;
    expect(session.getState().status).toBe('loading');
    expect(seen.filter((status) => status === 'ready')).toEqual([]);
  });
});

describe('answers', () => {
  it('a committed answer shows at once, is saved in one write of its row, and stays shown', async () => {
    const session = await ready();
    session.setField('c13', 'Yes');
    expect(session.getState().values.f.c13).toBe('Yes');
    expect(session.hasPending()).toBe(true);
    expect(await session.flush()).toBe(true);
    expect(storedAnswer('f26_c13', 'c13')).toBe('Yes');
    expect(session.getState().values.f.c13).toBe('Yes');
    expect(session.getState().saveState.kind).toBe('saved');
    expect(db.writes().filter((call) => call.action === 'update')).toHaveLength(1);
  });

  it('the value seen when the box took focus is the measure: a change made elsewhere meanwhile is held, not overwritten (F3)', async () => {
    const session = await ready();
    const id = String(stored('f26_c14').id);
    session.fieldFocused('c14b');
    db.changeElsewhere(CLAUSES, id, { response_json: '{"v":1,"f":{"c14b":"Theirs","c14c":"","c14d":"Yes","c14e":""}}' });
    session.setField('c14b', 'Mine');
    session.fieldBlurred('c14b');
    expect(await session.flush()).toBe(false);
    expect(storedAnswer('f26_c14', 'c14b')).toBe('Theirs');
    const state = session.getState();
    expect(state.values.f.c14b).toBe('Mine');
    expect(state.fieldConflicts.c14b).toMatchObject({ theirs: 'Theirs' });
    expect(state.saveState.kind).toBe('changed-elsewhere');
    expect(session.hasUnresolved()).toBe(true);
    await session.resolveConflict('c14b', 'mine');
    expect(storedAnswer('f26_c14', 'c14b')).toBe('Mine');
    expect(session.getState().fieldConflicts.c14b).toBeUndefined();
    expect(session.hasUnresolved()).toBe(false);
  });

  it('"Use theirs" shows the other user\'s value and sends nothing', async () => {
    const session = await ready();
    const id = String(stored('f26_c14').id);
    session.fieldFocused('c14b');
    db.changeElsewhere(CLAUSES, id, { response_json: '{"v":1,"f":{"c14b":"Theirs","c14c":"","c14d":"Yes","c14e":""}}' });
    session.setField('c14b', 'Mine');
    session.fieldBlurred('c14b');
    await session.flush();
    const writes = db.writes().length;
    await session.resolveConflict('c14b', 'theirs');
    expect(session.getState().values.f.c14b).toBe('Theirs');
    expect(db.writes().length).toBe(writes);
    expect(session.hasPending()).toBe(false);
  });

  it('another user\'s change of a different answer is kept and shown: both answers end in the row', async () => {
    const session = await ready();
    const id = String(stored('f26_c14').id);
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { response_json: '{"v":1,"f":{"c14b":"","c14c":"Invented software","c14d":"Yes","c14e":""}}' });
    session.setField('c14b', 'Mine');
    expect(await session.flush()).toBe(true);
    expect(storedAnswer('f26_c14', 'c14b')).toBe('Mine');
    expect(storedAnswer('f26_c14', 'c14c')).toBe('Invented software');
    expect(session.getState().values.f.c14c).toBe('Invented software');
  });

  it('a yes/no is judged against the value shown before the choice', async () => {
    const session = await ready();
    const id = String(stored('f26_c28').id);
    db.changeElsewhere(CLAUSES, id, { response_json: '{"v":1,"f":{"c28":"Yes"}}' });
    session.setField('c28', 'Yes');               // both chose Yes: no clash
    expect(await session.flush()).toBe(true);
    db.changeElsewhere(CLAUSES, id, { response_json: '{"v":1,"f":{"c28":"No"}}' });
    session.setField('c28', '');                    // the screen showed Yes; the row now holds No
    expect(await session.flush()).toBe(false);
    expect(session.getState().fieldConflicts.c28).toMatchObject({ theirs: 'No' });
  });

  it('editing a value from the client master takes its "From client master" mark away (ruling 2); other rows keep theirs', async () => {
    const session = await ready();
    expect(stored('f26_p1').prefill_status).toBe('auto_filled');
    session.setField('C.name', 'Invented Traders LLP');
    expect(await session.flush()).toBe(true);
    expect(storedAnswer('f26_p1', 'C.name')).toBe('Invented Traders LLP');
    expect(stored('f26_p1').prefill_status).toBe('manual_override');
    expect(session.getState().rowsByKey.get('f26_p1')?.prefill_status).toBe('manual_override');
    expect(stored('f26_p3').prefill_status).toBe('auto_filled');
    expect(stored('f26_p8').prefill_status).toBe('auto_filled');
    // An answer of a clause without such a mark leaves its prefill state alone.
    session.setField('C.a1', 'Invented Road 1');
    await session.flush();
    expect(stored('f26_p2').prefill_status).toBe('not_attempted');
  });

  it('a value equal to the stored one sends nothing', async () => {
    const session = await ready();
    const writes = db.writes().length;
    session.setField('c14d', 'Yes');
    expect(await session.flush()).toBe(true);
    expect(db.writes()).toHaveLength(writes);
    expect(session.getState().values.f.c14d).toBe('Yes');
  });

  it('a save that fails keeps the entry on screen and says so; the retry saves it', async () => {
    const session = await ready();
    db.before = (query) => (query.action === 'update' ? { data: null, error: { message: 'database is locked' } } : undefined);
    session.setField('c13', 'Invented books');
    expect(await session.flush()).toBe(false);
    expect(session.getState().saveState).toMatchObject({ kind: 'failed', pending: 1 });
    expect(session.getState().values.f.c13).toBe('Invented books');
    expect(session.hasUnresolved()).toBe(true);
    db.before = null;
    expect(await session.flush()).toBe(true);
    expect(storedAnswer('f26_c13', 'c13')).toBe('Invented books');
    expect(session.hasUnresolved()).toBe(false);
  });

  it('the category goes into the setup row with form_type derived; Part C answers are not touched', async () => {
    const session = await ready();
    const clauseWrites = db.writes().filter((call) => call.table === CLAUSES).length;
    session.setField('cat', '1');
    expect(session.getState().values.f.cat).toBe('1');
    await session.flush();
    const audit = db.rows(AUDITS)[0];
    expect(audit.form_type).toBe('3CA');
    expect(JSON.parse(String(audit.setup_json)).form26.category).toBe('1');
    expect(session.getState().setup.category).toBe('1');
    expect(db.writes().filter((call) => call.table === CLAUSES)).toHaveLength(clauseWrites);
  });

  it('a category changed by someone else meanwhile is shown as theirs with Keep mine / Use theirs; Keep mine saves mine', async () => {
    const session = await ready();
    const audit = db.rows(AUDITS)[0];
    db.changeElsewhere(AUDITS, String(audit.id), { setup_json: JSON.stringify({ form26: { v: 1, category: '1', showAllSchedules: false } }) });
    await session.setCategory('');
    const state = session.getState();
    expect(state.setup.category).toBe('1');
    expect(state.values.f.cat).toBe('1');
    expect(state.fieldConflicts.cat).toBeDefined();
    await session.resolveConflict('cat', 'mine');
    expect(JSON.parse(String(db.rows(AUDITS)[0].setup_json)).form26.category).toBe('');
    expect(session.getState().fieldConflicts.cat).toBeUndefined();
    expect(session.getState().values.f.cat).toBeUndefined();
  });

  it('the category of an approved category entry is not changed', async () => {
    const session = await ready();
    await session.setStatus('f26_category', 'approved');
    const before = db.rows(AUDITS)[0];
    await session.setCategory('1');
    expect(db.rows(AUDITS)[0]).toEqual(before);
    expect(session.getState().values.f.cat).toBe('2');
    expect(notices.at(-1)).toEqual({ tone: 'warning', text: 'This clause is approved. Choose Edit to change it.' });
  });

  it('"Show all schedules" is stored in the shared setup (N11, as the file has it)', async () => {
    const session = await ready();
    await session.setShowAllSchedules(true);
    expect(JSON.parse(String(db.rows(AUDITS)[0].setup_json)).form26.showAllSchedules).toBe(true);
    expect(session.getState().setup.showAllSchedules).toBe(true);
  });
});

describe('tables', () => {
  it('rows typed into a table are saved in the table\'s own row when the table is left', async () => {
    const session = await ready();
    const rows = [{ '1': 'Invented Act', '2': 'Invented nature', '3': '700' }, { '1': 'Invented Act', '2': 'Other', '3': '300' }];
    session.setTable('S28', rows);
    expect(session.getState().values.t.S28).toEqual(rows);
    session.tableLeft('S28');
    expect(await session.flush()).toBe(true);
    expect(parseTablePayload(String(stored(form26TableRowKey('S28')).response_json)).rows).toEqual(rows);
    expect(session.getState().values.t.S28).toEqual(rows);
  });

  it('a table of a clause approved elsewhere is not written; it is held for the user to see, and "Use theirs" puts the stored rows back', async () => {
    const session = await ready();
    db.changeElsewhere(CLAUSES, String(stored('f26_c28').id), { review_status: 'approved', locked: 1 });
    const before = stored(form26TableRowKey('S28'));
    session.setTable('S28', [{ '1': 'Invented Act', '2': 'x', '3': '1' }, { '1': '', '2': '', '3': '' }]);
    session.tableLeft('S28');
    expect(await session.flush()).toBe(false);
    expect(stored(form26TableRowKey('S28'))).toEqual(before);
    expect(session.getState().tableConflicts.S28).toBeDefined();
    expect(session.getState().rowsByKey.get('f26_c28')?.review_status).toBe('approved');
    await session.resolveTableConflict('S28', 'theirs');
    expect(session.getState().tableConflicts.S28).toBeUndefined();
    expect(session.getState().values.t.S28).toEqual(parseTablePayload(String(before.response_json)).rows);
  });
});

describe('review state', () => {
  it('prepared, reviewed and approved write the stamps the Form 3CD hook writes; approval locks; unlocking with a reason reopens', async () => {
    const session = await ready();
    expect(await session.setStatus('f26_c28', 'prepared')).toBe(true);
    expect(stored('f26_c28')).toMatchObject({ review_status: 'prepared', prepared_by: 'user-1', prepared_at: '2026-11-22T10:30:00.000Z', locked: 0 });
    expect(await session.setStatus('f26_c28', 'reviewed')).toBe(true);
    expect(stored('f26_c28')).toMatchObject({ review_status: 'reviewed', reviewed_by: 'user-1' });
    expect(await session.setStatus('f26_c28', 'approved')).toBe(true);
    expect(stored('f26_c28')).toMatchObject({ review_status: 'approved', locked: 1, approved_by: 'user-1', locked_by: 'user-1', approved_at: '2026-11-22T10:30:00.000Z' });
    expect(session.getState().rowsByKey.get('f26_c28')?.locked).toBe(1);
    expect(await session.setStatus('f26_c28', 'reviewed', { unlockReason: 'Invented reason' })).toBe(true);
    expect(stored('f26_c28')).toMatchObject({ review_status: 'reviewed', locked: 0, unlock_reason: 'Invented reason', locked_by: null, locked_at: null });
  });

  it('an answer committed in an approved clause is never written; the user is told it was not saved', async () => {
    const session = await ready();
    await session.setStatus('f26_c13', 'approved');
    const before = stored('f26_c13');
    session.setField('c13', 'Typed after approval');
    expect(await session.flush()).toBe(false);
    expect(stored('f26_c13')).toEqual(before);
    expect(session.getState().fieldConflicts.c13).toBeDefined();
    await session.resolveConflict('c13', 'theirs');
    expect(session.getState().values.f.c13).toBe('');
  });

  it('marking waits for the clause\'s own unsaved answer, which is saved first; then the state goes in (no false "changed elsewhere")', async () => {
    const session = await ready();
    session.setField('c13', 'Invented books');
    expect(await session.setStatus('f26_c13', 'prepared')).toBe(true);
    expect(storedAnswer('f26_c13', 'c13')).toBe('Invented books');
    expect(stored('f26_c13').review_status).toBe('prepared');
    expect(notices).toEqual([]);
  });

  it('N2: an approval is refused when the answers changed since the approver saw them; the new answers are shown; approving again works', async () => {
    const session = await ready();
    db.changeElsewhere(CLAUSES, String(stored('f26_c13').id), { response_json: '{"v":1,"f":{"c13":"Changed by the other user"}}' });   // the same second
    expect(await session.setStatus('f26_c13', 'approved')).toBe(false);
    expect(stored('f26_c13').review_status).toBe('draft');
    expect(session.getState().values.f.c13).toBe('Changed by the other user');
    expect(notices.at(-1)).toEqual({ tone: 'warning', text: 'Someone else changed this clause just now, so it was not approved. Check its answers and approve it again.' });
    expect(await session.setStatus('f26_c13', 'approved')).toBe(true);
    expect(stored('f26_c13')).toMatchObject({ review_status: 'approved', locked: 1 });
  });

  it('N2 for tables: an approval is refused when a table of the clause changed since it was shown', async () => {
    const session = await ready();
    const rows = [{ '1': 'Their Act', '2': 'x', '3': '5' }, { '1': '', '2': '', '3': '' }];
    db.changeElsewhere(CLAUSES, String(stored(form26TableRowKey('S28')).id), { response_json: JSON.stringify({ v: 1, rows }) });
    expect(await session.setStatus('f26_c28', 'approved')).toBe(false);
    expect(stored('f26_c28').review_status).toBe('draft');
    expect(session.getState().values.t.S28).toEqual(rows);
    expect(await session.setStatus('f26_c28', 'approved')).toBe(true);
  });

  it('marking is refused while an answer could not be saved, and nothing is marked', async () => {
    const session = await ready();
    db.before = (query) => (query.action === 'update' && query.table === CLAUSES ? { data: null, error: { message: 'database is locked' } } : undefined);
    session.setField('c13', 'Invented books');
    expect(await session.setStatus('f26_c13', 'approved')).toBe(false);
    db.before = null;
    expect(stored('f26_c13').review_status).toBe('draft');
    expect(notices.at(-1)?.tone).toBe('warning');
  });
});

describe('review remarks and qualification', () => {
  it('remarks and the qualification box are saved in their columns; they wait for the row\'s answer save (N3)', async () => {
    const session = await ready();
    let release: () => void = () => undefined;
    let held = false;
    db.before = (query) => {
      if (held || query.action !== 'update' || query.table !== CLAUSES) return undefined;
      held = true;
      return new Promise<void>((resolve) => { release = resolve; });
    };
    session.setField('c13', 'Invented books');
    await tick();
    await tick();
    db.tick(2);                                                  // a second passes while the answer save is out
    const remarks = session.updateRow('f26_c13', { auditor_remarks_html: '<p>Invented remark</p>' });
    await tick();
    expect(db.writes().filter((call) => call.action === 'update')).toHaveLength(1);   // the remarks have not gone yet
    release();
    expect(await remarks).toBe(true);
    expect(await session.flush()).toBe(true);
    expect(stored('f26_c13')).toMatchObject({ auditor_remarks_html: '<p>Invented remark</p>' });
    expect(storedAnswer('f26_c13', 'c13')).toBe('Invented books');
    expect(notices).toEqual([]);
    expect(await session.updateRow('f26_c13', { qualification_required: 1, qualification_text_html: '<p>Invented qualification</p>' })).toBe(true);
    expect(stored('f26_c13')).toMatchObject({ qualification_required: 1, qualification_text_html: '<p>Invented qualification</p>' });
  });

  it('a change of another column made elsewhere does not stop the remarks; the same column changed elsewhere is not overwritten', async () => {
    const session = await ready();
    const id = String(stored('f26_c13').id);
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { qualification_required: 1 });
    expect(await session.updateRow('f26_c13', { auditor_remarks_html: '<p>Mine</p>' })).toBe(true);
    expect(stored('f26_c13')).toMatchObject({ auditor_remarks_html: '<p>Mine</p>', qualification_required: 1 });
    db.tick(2);
    db.changeElsewhere(CLAUSES, id, { auditor_remarks_html: '<p>Theirs</p>' });
    expect(await session.updateRow('f26_c13', { auditor_remarks_html: '<p>Mine again</p>' })).toBe(false);
    expect(stored('f26_c13').auditor_remarks_html).toBe('<p>Theirs</p>');
    expect(session.getState().rowsByKey.get('f26_c13')?.auditor_remarks_html).toBe('<p>Theirs</p>');
    expect(notices.at(-1)?.tone).toBe('warning');
  });

  it('remarks of an approved clause are not written', async () => {
    const session = await ready();
    await session.setStatus('f26_c13', 'approved');
    const before = stored('f26_c13');
    expect(await session.updateRow('f26_c13', { auditor_remarks_html: '<p>Late</p>' })).toBe(false);
    expect(stored('f26_c13')).toEqual(before);
  });
});

describe('brought from the 3CD draft', () => {
  it('a brought answer counts as unconfirmed until confirmed; confirming keeps the value and removes the mark', async () => {
    const session = await start();
    await session.load();
    db.tick(1);
    db.changeElsewhere(CLAUSES, String(stored('f26_c10').id), { response_json: JSON.stringify({ v: 1, f: { c10: 'Yes' }, brought: { c10: { from: 'clause_8a', at: '2026-11-22T10:00:00.000Z' } } }) });
    await session.reload();
    expect([...session.getState().unconfirmed]).toEqual(['c10']);
    await session.confirmBrought('c10');
    expect(parseClausePayload(String(stored('f26_c10').response_json))).toEqual({ v: 1, f: { c10: 'Yes' } });
    expect(session.getState().unconfirmed.size).toBe(0);
    expect(session.getState().values.f.c10).toBe('Yes');
  });
});

describe('evidence (task 18)', () => {
  it('a file linked to clause 14 is listed with clause_key f26_c14 and workpaper_ref TA-F26-14; unlinking removes it', async () => {
    const session = await ready();
    await session.linkEvidence('f26_c14', 'file-1');
    const links = db.rows(LINKS);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ clause_key: 'f26_c14', workpaper_ref: 'TA-F26-14', evidence_file_id: 'file-1', linked_by: 'user-1', clause_response_id: stored('f26_c14').id });
    expect(session.getState().evidence.map((link) => link.clause_key)).toEqual(['f26_c14']);
    await session.unlinkEvidence(String(links[0].id));
    expect(db.rows(LINKS)).toEqual([]);
    expect(session.getState().evidence).toEqual([]);
  });

  it('evidence goes on clause units only: a table\'s own row cannot take a link', async () => {
    const session = await ready();
    await expect(session.linkEvidence(form26TableRowKey('S28'), 'file-1')).rejects.toThrow();
    expect(db.rows(LINKS)).toEqual([]);
  });
});

describe('closing', () => {
  it('hasPending is true while a table waits for its pause, and flush saves it', async () => {
    const session = await ready();
    session.setTable('S28', [{ '1': 'Invented Act', '2': 'x', '3': '1' }, { '1': '', '2': '', '3': '' }]);
    expect(session.hasPending()).toBe(true);
    expect(await session.flush()).toBe(true);
    expect(session.hasPending()).toBe(false);
    expect(parseTablePayload(String(stored(form26TableRowKey('S28')).response_json)).rows[0]['1']).toBe('Invented Act');
  });

  it('after dispose nothing is reported and nothing more is sent', async () => {
    const session = await ready();
    const seen: unknown[] = [];
    session.subscribe((state) => seen.push(state));
    const writes = db.writes().length;
    session.dispose();
    session.setField('c13', 'After close');
    await tick();
    expect(seen).toEqual([]);
    expect(db.writes()).toHaveLength(writes);
  });
});

describe('task 26: a Form 3CD draft with answers is converted when the workspace opens', () => {
  // The 3CD page's own rows (stamped when seeded), then answers saved on it later.
  async function convertedSession() {
    const session = await start({ threeCd: true });
    db.seed(CLAUSES, { id: '3cd-8a', tax_audit_id: 'audit-3cd', clause_key: 'clause_8a', clause_no: '8a', clause_title: 'Option', response_json: '{}' });
    db.seed(CLAUSES, { id: '3cd-13', tax_audit_id: 'audit-3cd', clause_key: 'clause_13', clause_no: '13', clause_title: 'Method', response_json: '{}' });
    db.tick(30);
    db.changeElsewhere(CLAUSES, '3cd-8a', { response_json: JSON.stringify({ structured: { opted_for_section_115_taxation: 'yes' } }) });
    db.changeElsewhere(CLAUSES, '3cd-13', { response_json: JSON.stringify({ structured: { method_of_accounting: 'Mercantile', whether_change_in_method: 'no' } }) });
    db.tick(30);
    const threeCd = JSON.stringify({ a: db.rows(AUDITS).filter((row) => row.statutory_version === THREE_CD_VERSION), c: db.rows(CLAUSES).filter((row) => row.statutory_version === THREE_CD_VERSION) });
    await session.load();
    expect(session.getState().status).toBe('ready');
    return { session, threeCd };
  }
  const threeCdNow = () => JSON.stringify({ a: db.rows(AUDITS).filter((row) => row.statutory_version === THREE_CD_VERSION), c: db.rows(CLAUSES).filter((row) => row.statutory_version === THREE_CD_VERSION) });
  const unfilledCount = (session: Form26Session) => {
    const state = session.getState();
    return scanUnfilled(DEF, state.values, { showAllSchedules: state.setup.showAllSchedules, unconfirmed: state.unconfirmed }).length;
  };

  it('the brought answers are shown with their values and count as unfilled until confirmed', async () => {
    const { session, threeCd } = await convertedSession();
    const state = session.getState();
    expect([...state.unconfirmed].sort()).toEqual(['c10', 'c15a', 'c15b']);
    expect(state.values.f.c10).toBe('Yes');
    expect(state.values.f.c15a).toBe('Mercantile system');
    expect(threeCdNow()).toBe(threeCd);
  });

  it('"Confirm" removes the mark through a save of that row (the row as seen); the value stays and the count drops by one', async () => {
    const { session, threeCd } = await convertedSession();
    const before = unfilledCount(session);
    db.tick();
    await session.confirmBrought('c10');
    expect(parseClausePayload(String(stored('f26_c10').response_json))).toEqual({ v: 1, f: { c10: 'Yes' } });
    expect(session.getState().unconfirmed.has('c10')).toBe(false);
    expect(session.getState().values.f.c10).toBe('Yes');
    expect(unfilledCount(session)).toBe(before - 1);
    // 15(a) and 15(b) share a row: confirming one keeps the other's mark.
    await session.confirmBrought('c15a');
    expect(parseClausePayload(String(stored('f26_c15').response_json)).brought).toEqual({ c15b: expect.objectContaining({ from: 'clause_13' }) });
    expect([...session.getState().unconfirmed]).toEqual(['c15b']);
    expect(unfilledCount(session)).toBe(before - 2);
    expect(notices).toEqual([]);
    expect(threeCdNow()).toBe(threeCd);
  });

  it('confirming after someone else changed another answer of the same row still confirms, on top of their change', async () => {
    const { session } = await convertedSession();
    db.tick();
    const row = stored('f26_c15');
    const payload = parseClausePayload(String(row.response_json));
    db.changeElsewhere(CLAUSES, String(row.id), { response_json: JSON.stringify({ ...payload, f: { ...payload.f, c15b: 'Yes' }, brought: { c15a: payload.brought?.c15a } }) });
    await session.confirmBrought('c15a');
    expect(parseClausePayload(String(stored('f26_c15').response_json))).toEqual({ v: 1, f: { c15a: 'Mercantile system', c15b: 'Yes' } });
    expect(session.getState().unconfirmed.size).toBe(1);                       // c10 only
    expect(notices).toEqual([]);
  });

  it('a brought answer someone else changed meanwhile is not confirmed: theirs is shown and the user is told', async () => {
    const { session } = await convertedSession();
    db.tick();
    db.changeElsewhere(CLAUSES, String(stored('f26_c10').id), { response_json: JSON.stringify({ v: 1, f: { c10: 'No' } }) });
    await session.confirmBrought('c10');
    expect(parseClausePayload(String(stored('f26_c10').response_json))).toEqual({ v: 1, f: { c10: 'No' } });
    expect(session.getState().values.f.c10).toBe('No');
    expect(session.getState().unconfirmed.has('c10')).toBe(false);
    expect(notices.map((notice) => notice.text)).toEqual(['Someone else changed this answer just now. Their answer is shown.']);
  });

  it('changing a brought answer makes it the user\'s own: the mark goes with the save', async () => {
    const { session } = await convertedSession();
    session.setField('c10', 'No');
    expect(await session.flush()).toBe(true);
    expect(parseClausePayload(String(stored('f26_c10').response_json))).toEqual({ v: 1, f: { c10: 'No' } });
    expect(session.getState().unconfirmed.has('c10')).toBe(false);
  });

  it('two windows opening the engagement at once: one Form 26 audit, 122 rows, the same brought answers', async () => {
    const first = await start({ threeCd: true });
    db.seed(CLAUSES, { id: '3cd-8a', tax_audit_id: 'audit-3cd', clause_key: 'clause_8a', clause_no: '8a', clause_title: 'Option', response_json: '{}' });
    db.tick(30);
    db.changeElsewhere(CLAUSES, '3cd-8a', { response_json: JSON.stringify({ structured: { opted_for_section_115_taxation: 'no' } }) });
    db.tick(30);
    const second = createForm26Session({ store: createForm26Store(await clientOn(db)), engagement: ENGAGEMENT, userId: 'user-1' });
    sessions.push(second);
    await Promise.all([first.load(), second.load()]);
    expect(first.getState().status).toBe('ready');
    expect(second.getState().status).toBe('ready');
    expect(db.rows(AUDITS).filter((row) => row.statutory_version === FORM26_VERSION)).toHaveLength(1);
    expect(db.rows(CLAUSES).filter((row) => row.statutory_version === FORM26_VERSION)).toHaveLength(122);
    expect([...first.getState().unconfirmed]).toEqual(['c10']);
    expect([...second.getState().unconfirmed]).toEqual(['c10']);
    expect(first.getState().values.f.c10).toBe('No');
  });
});
