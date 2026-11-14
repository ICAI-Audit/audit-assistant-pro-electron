'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { upgradePermanentFile } = require('../electron/permanent-file/migration.cjs');
const { uploadVersion, downloadVersion, inspectStorage, MAX_FILE_BYTES } = require('../electron/permanent-file/documents.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-pf-files-'));
  const db = new DatabaseSync(path.join(dir, 'test.db'));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true });
  });
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE engagements (id TEXT PRIMARY KEY, client_id TEXT NOT NULL);
    CREATE TABLE engagement_assignments (engagement_id TEXT NOT NULL, user_id TEXT NOT NULL);
    INSERT INTO clients VALUES ('client-a','A'), ('client-b','B');
    INSERT INTO engagements VALUES ('eng-a','client-a'), ('eng-b','client-b');
    INSERT INTO engagement_assignments VALUES ('eng-a','user-a'), ('eng-b','user-b');
  `);
  upgradePermanentFile(db, path.join(dir, 'backups'));
  return { db, root: path.join(dir, 'documents'), clientId: 'client-a', context: { userId: 'user-a', isAdmin: false } };
}

test('upload retains both versions, links engagement and downloads exact bytes', (t) => {
  const env = fixture(t);
  const first = uploadVersion({ ...env, category: 'PF-06', name: 'Loan', fileName: 'loan.pdf', bytes: Buffer.from('one'), engagementIds: ['eng-a'] });
  const second = uploadVersion({ ...env, documentId: first.documentId, fileName: 'loan-v2.pdf', bytes: Buffer.from('two') });
  assert.equal(first.reference, 'client-a-PF-06-DOC-001-V01');
  assert.equal(second.reference, 'client-a-PF-06-DOC-001-V02');
  assert.equal(downloadVersion({ ...env, versionId: first.versionId }).bytes.toString(), 'one');
  assert.equal(downloadVersion({ ...env, versionId: second.versionId }).bytes.toString(), 'two');
  assert.equal(env.db.prepare('SELECT count(*) AS n FROM permanent_file_engagements').get().n, 1);
});

test('rejects unauthorized users, foreign engagements and unsafe or oversized uploads', (t) => {
  const env = fixture(t);
  const input = { ...env, category: 'PF-01', name: 'Master', fileName: 'test.pdf', bytes: Buffer.from('x') };
  assert.throws(() => uploadVersion({ ...input, context: { userId: 'user-b', isAdmin: false } }), /access denied/i);
  assert.throws(() => uploadVersion({ ...input, engagementIds: ['eng-b'] }), /does not belong/);
  assert.throws(() => uploadVersion({ ...input, fileName: '../other' }), /path/);
  assert.throws(() => uploadVersion({ ...input, bytes: Buffer.alloc(MAX_FILE_BYTES + 1) }), /25 MiB/);
  assert.equal(env.db.prepare('SELECT count(*) AS n FROM permanent_file_documents').get().n, 0);
  assert.equal(fs.existsSync(env.root), false);
});

test('cross-client document IDs and versions are not accessible', (t) => {
  const env = fixture(t);
  const result = uploadVersion({ ...env, category: 'PF-01', name: 'Master', fileName: 'a.pdf', bytes: Buffer.from('x') });
  const other = { ...env, context: { userId: 'user-b', isAdmin: false }, clientId: 'client-b' };
  assert.throws(() => downloadVersion({ ...other, versionId: result.versionId }), /not found/);
  assert.throws(() => uploadVersion({ ...other, documentId: result.documentId, fileName: 'b.pdf', bytes: Buffer.from('x') }), /not found/);
});

test('database failure rolls back records and removes newly written bytes', (t) => {
  const env = fixture(t);
  env.db.exec("CREATE TRIGGER reject_version BEFORE INSERT ON permanent_file_versions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.throws(() => uploadVersion({ ...env, category: 'PF-01', name: 'Master', fileName: 'a.pdf', bytes: Buffer.from('x') }), /synthetic failure/);
  assert.equal(env.db.prepare('SELECT count(*) AS n FROM permanent_file_documents').get().n, 0);
  assert.deepEqual(fs.readdirSync(env.root), []);
});

test('missing or altered file is reported rather than returned as valid', (t) => {
  const env = fixture(t);
  const result = uploadVersion({ ...env, category: 'PF-01', name: 'Master', fileName: 'a.pdf', bytes: Buffer.from('abc') });
  const key = env.db.prepare('SELECT storage_key FROM permanent_file_versions WHERE id = ?').get(result.versionId).storage_key;
  fs.writeFileSync(path.join(env.root, key), 'x');
  assert.throws(() => downloadVersion({ ...env, versionId: result.versionId }), /size/);
  fs.writeFileSync(path.join(env.root, key), 'xyz');
  assert.throws(() => downloadVersion({ ...env, versionId: result.versionId }), /checksum/);
  fs.unlinkSync(path.join(env.root, key));
  assert.throws(() => downloadVersion({ ...env, versionId: result.versionId }), /ENOENT/);
});

test('inspection reports interrupted writes and missing files without deleting anything', (t) => {
  const env = fixture(t);
  const result = uploadVersion({ ...env, category: 'PF-01', name: 'Master', fileName: 'a.pdf', bytes: Buffer.from('abc') });
  const key = env.db.prepare('SELECT storage_key FROM permanent_file_versions WHERE id = ?').get(result.versionId).storage_key;
  const orphan = 'b4428245-68c3-4f71-8a25-31a7a4be5c71';
  fs.writeFileSync(path.join(env.root, orphan), 'interrupted');
  fs.writeFileSync(path.join(env.root, 'unexpected'), 'unrecognized');
  fs.unlinkSync(path.join(env.root, key));
  assert.deepEqual(inspectStorage(env), { orphaned: [orphan], missing: [key], unexpected: ['unexpected'] });
  assert.equal(fs.readFileSync(path.join(env.root, orphan), 'utf8'), 'interrupted');
  assert.equal(fs.readFileSync(path.join(env.root, 'unexpected'), 'utf8'), 'unrecognized');
});
