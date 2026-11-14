'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createPermanentFileHandler } = require('../electron/permanent-file/ipc.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-pf-ipc-'));
  const db = new DatabaseSync(path.join(dir, 'test.db'));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true }); });
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT, constitution TEXT, cin TEXT, pan TEXT, address TEXT, state TEXT, pin TEXT, updated_at TEXT);
    CREATE TABLE engagements (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, financial_year TEXT NOT NULL, client_name TEXT, updated_at TEXT);
    CREATE TABLE engagement_assignments (engagement_id TEXT NOT NULL, user_id TEXT NOT NULL);
    CREATE TABLE client_gstins (client_id TEXT NOT NULL, gstin TEXT NOT NULL);
    INSERT INTO clients (id,name) VALUES ('client-a','A'), ('client-b','B');
    INSERT INTO engagements (id,client_id,name,financial_year,client_name) VALUES ('eng-a','client-a','Audit A','2024-25','A'), ('eng-b','client-b','Audit B','2024-25','B');
    INSERT INTO engagement_assignments VALUES ('eng-a','user-a'), ('eng-b','user-b');
  `);
  const handler = createPermanentFileHandler({
    getDb: () => db,
    getContext: (_db, event) => {
      if (!event.user) throw new Error('Authentication required.');
      return { userId: event.user, isAdmin: false, isManagerOrAbove: event.manager === true };
    },
    backupDir: path.join(dir, 'backup'),
    storageDir: path.join(dir, 'files'),
  });

  return { db, handler, dir };
}

test('supplemental client details persist without changing the existing client master', async (t) => {
  const { db, handler } = fixture(t);
  const user = { user: 'user-a' };
  db.exec("INSERT INTO client_gstins VALUES ('client-a','GST-A'), ('client-b','GST-B')");
  const details = { tradeName: 'Trading name', incorporationDate: '2020-01-01', incorporationPlace: 'Delhi',
    tan: 'TAN', branches: ['Branch A'], groupDetails: 'Group', auditPartner: 'Partner', keyPersonnel: 'CFO' };
  assert.equal((await handler(user, { action: 'saveEntity', clientId: 'client-a', details })).success, true);
  const result = await handler(user, { action: 'entity', clientId: 'client-a' });
  assert.deepEqual(result.data.entity.details, details);
  assert.deepEqual(result.data.entity.gstins, []);
  assert.deepEqual(result.data.entity.unmatchedGstins, ['GST-A']);
  assert.equal(result.data.entity.client.name, 'A');
  assert.equal((await handler({ user: 'user-b' }, { action: 'entity', clientId: 'client-a' })).success, false);
  assert.equal((await handler(user, { action: 'saveEntity', clientId: 'client-a', details: { ...details, incorporationDate: '2024-02-31' } })).success, false);
  assert.deepEqual((await handler(user, { action: 'entity', clientId: 'client-a' })).data.entity.details, details);
});

test('master editing validates, isolates, atomically syncs names and reconciles display without deleting GSTINs', async (t) => {
  const { db, handler } = fixture(t);
  const manager = { user: 'user-a', manager: true };
  const master = { name: 'Updated A', industry: 'Services', constitution: 'company', cin: 'U12345DL2020PTC123456',
    pan: 'AAACA1234A', address: 'Office', state: 'Delhi', pin: '110001' };
  db.exec("INSERT INTO client_gstins VALUES ('client-a','27AAACA1234A1Z5'), ('client-b','27AAACA1234A1Z5')");
  const missing = await handler(manager, { action: 'entity', clientId: 'client-a' });
  assert.deepEqual(missing.data.entity.gstins, []);
  assert.equal(missing.data.entity.unmatchedGstins.length, 1);
  assert.equal((await handler({ user: 'user-a' }, { action: 'saveClientMaster', clientId: 'client-a', master })).success, false);
  assert.equal((await handler({ user: 'user-b', manager: true }, { action: 'saveClientMaster', clientId: 'client-a', master })).success, false);
  for (const invalid of [{ pan: 'invalid' }, { constitution: 'llp' }, { cin: 'wrong' }, { pin: '1' }]) {
    assert.equal((await handler(manager, { action: 'saveClientMaster', clientId: 'client-a', master: { ...master, ...invalid } })).success, false);
  }
  db.exec("CREATE TRIGGER reject_name BEFORE UPDATE ON engagements BEGIN SELECT RAISE(ABORT, 'sync failed'); END");
  assert.equal((await handler(manager, { action: 'saveClientMaster', clientId: 'client-a', master })).success, false);
  assert.equal(db.prepare("SELECT name FROM clients WHERE id='client-a'").get().name, 'A');
  db.exec('DROP TRIGGER reject_name');
  assert.equal((await handler(manager, { action: 'saveClientMaster', clientId: 'client-a', master })).success, true);
  db.exec("INSERT INTO client_gstins VALUES ('client-a','27BBBPF1234B1Z5')");
  assert.match((await handler(manager, { action: 'saveClientMaster', clientId: 'client-a', master: { ...master, pan: 'BBBCA1234B' } })).error, /reconcile/i);
  assert.equal((await handler(manager, { action: 'saveClientMaster', clientId: 'client-a', master: { ...master, name: 'Updated A again' } })).success, true);
  const reopened = await handler(manager, { action: 'entity', clientId: 'client-a' });
  assert.deepEqual(reopened.data.entity.gstins, ['27AAACA1234A1Z5']);
  assert.deepEqual(reopened.data.entity.unmatchedGstins, ['27BBBPF1234B1Z5']);
  assert.equal(db.prepare("SELECT client_name FROM engagements WHERE id='eng-a'").get().client_name, 'Updated A again');
  assert.equal(db.prepare("SELECT client_name FROM engagements WHERE id='eng-b'").get().client_name, 'B');
  assert.equal(db.prepare('SELECT count(*) AS n FROM client_gstins').get().n, 3);
  const llp = { ...master, constitution: 'llp', pan: 'AAAFB1234A', cin: 'ABC-1234' };
  assert.equal((await handler(manager, { action: 'saveClientMaster', clientId: 'client-b', master: llp })).success, false);
  assert.equal((await handler({ user: 'user-b', manager: true }, { action: 'saveClientMaster', clientId: 'client-b', master: { ...llp, cin: 'ABC1234' } })).success, false);
});

test('IPC denies anonymous and unassigned requests before upgrading', async (t) => {
  const { db, handler, dir } = fixture(t);
  assert.match((await handler({}, { action: 'list', clientId: 'client-a' })).error, /Authentication/);
  assert.match((await handler({ user: 'user-b' }, { action: 'list', clientId: 'client-a' })).error, /denied/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='permanent_file_documents'").get().n, 0);
  assert.equal(fs.existsSync(path.join(dir, 'backup')), false);
});

test('IPC uploads, lists and downloads versioned documents for assigned client', async (t) => {
  const { handler } = fixture(t);
  const user = { user: 'user-a' };
  const first = await handler(user, { action: 'upload', clientId: 'client-a', category: 'PF-02', name: 'Deed', fileName: 'deed.pdf', bytes: new Uint8Array([1, 2, 3]), engagementIds: ['eng-a'] });
  assert.equal(first.success, true);
  const list = await handler(user, { action: 'list', clientId: 'client-a' });
  assert.equal(list.success, true);
  assert.equal(list.data.documents[0].reference, 'client-a-PF-02-DOC-001-V01');
  const download = await handler(user, { action: 'download', clientId: 'client-a', versionId: first.data.versionId });
  assert.deepEqual([...download.data.bytes], [1, 2, 3]);
  const other = await handler({ user: 'user-b' }, { action: 'download', clientId: 'client-b', versionId: first.data.versionId });
  assert.equal(other.success, false);
});

test('history IPC persists and compares records while rejecting cross-client access', async (t) => {
  const { handler } = fixture(t);
  const user = { user: 'user-a' };
  const entry = { kind: 'director', subjectId: 'p1', effectiveFrom: '2024-01-01', effectiveUntil: null, attributes: { name: 'A', details: 'Director' } };
  const first = await handler(user, { action: 'addHistory', clientId: 'client-a', entry });
  assert.equal(first.success, true);
  const second = await handler(user, { action: 'addHistory', clientId: 'client-a', entry: {
    ...entry, predecessorId: first.data.historyId, effectiveFrom: '2025-04-01', attributes: { name: 'A', details: 'Chair' },
  } });
  assert.equal(second.success, true);
  const result = await handler(user, { action: 'compareHistory', clientId: 'client-a', previousDate: '2025-03-31', currentDate: '2026-03-31' });
  assert.equal(result.data.changes[0].change, 'changed');
  assert.equal((await handler(user, { action: 'history', clientId: 'client-a' })).data.history.length, 2);
  assert.equal((await handler({ user: 'user-b' }, { action: 'history', clientId: 'client-a' })).success, false);
  assert.equal((await handler({ user: 'user-b' }, { action: 'addHistory', clientId: 'client-b', entry: { ...entry, predecessorId: first.data.historyId } })).success, false);
});

test('metadata updates preserve version bytes and reject foreign engagements or versions', async (t) => {
  const { handler } = fixture(t);
  const user = { user: 'user-a' };
  const upload = await handler(user, { action: 'upload', clientId: 'client-a', category: 'PF-02', name: 'Deed', fileName: 'deed.pdf', bytes: new Uint8Array([5, 6]), engagementIds: ['eng-a'] });
  const metadata = { action: 'updateMetadata', clientId: 'client-a', versionId: upload.data.versionId,
    verificationStatus: 'verified', reviewedDate: '2026-03-31', expiryDate: null,
    documentYear: '2025-26', keywords: 'constitution', engagementIds: ['eng-a'] };
  assert.equal((await handler(user, { ...metadata, engagementIds: ['eng-b'] })).success, false);
  assert.equal((await handler(user, { ...metadata, reviewedDate: '2026-02-31' })).success, false);
  assert.equal((await handler(user, metadata)).success, true);
  const list = await handler(user, { action: 'list', clientId: 'client-a' });
  assert.equal(list.data.documents[0].verificationStatus, 'verified');
  assert.equal(list.data.documents[0].documentYear, '2025-26');
  assert.deepEqual(list.data.documents[0].engagementIds, ['eng-a']);
  assert.deepEqual([...(await handler(user, { action: 'download', clientId: 'client-a', versionId: upload.data.versionId })).data.bytes], [5, 6]);
  assert.equal((await handler({ user: 'user-b' }, { ...metadata, clientId: 'client-b', engagementIds: ['eng-b'] })).success, false);
});

test('IPC rejects future module dates without mutating records', async (t) => {
  const { handler } = fixture(t);
  const user = { user: 'user-a' };
  const future = '9999-12-31';
  const details = { tradeName: '', incorporationDate: future, incorporationPlace: '', tan: '', branches: [], groupDetails: '', auditPartner: '', keyPersonnel: '' };
  assert.match((await handler(user, { action: 'saveEntity', clientId: 'client-a', details })).error, /future/i);
  const upload = await handler(user, { action: 'upload', clientId: 'client-a', category: 'PF-02', name: 'Deed', fileName: 'deed.pdf', bytes: new Uint8Array([5]), engagementIds: ['eng-a'] });
  const metadata = { action: 'updateMetadata', clientId: 'client-a', versionId: upload.data.versionId, verificationStatus: 'unverified', reviewedDate: null, expiryDate: future, documentYear: null, keywords: null, engagementIds: ['eng-a'] };
  assert.match((await handler(user, metadata)).error, /future/i);
  const entry = { kind: 'director', subjectId: 'p1', effectiveFrom: future, effectiveUntil: null, attributes: { name: 'A' } };
  assert.match((await handler(user, { action: 'addHistory', clientId: 'client-a', entry })).error, /future/i);
  const valid = await handler(user, { action: 'addHistory', clientId: 'client-a', entry: { ...entry, effectiveFrom: '2000-01-01' } });
  assert.equal(valid.success, true);
  assert.match((await handler(user, { action: 'endHistory', clientId: 'client-a', historyId: valid.data.historyId, effectiveUntil: future })).error, /future/i);
  assert.match((await handler(user, { action: 'compareHistory', clientId: 'client-a', previousDate: '2000-01-01', currentDate: future })).error, /future/i);
  assert.equal((await handler(user, { action: 'history', clientId: 'client-a' })).data.history[0].effectiveUntil, null);
});
