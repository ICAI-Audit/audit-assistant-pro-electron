'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { upgradePermanentFile } = require('../electron/permanent-file/migration.cjs');
const { addHistory, readHistory, yearEndChanges, endHistory } = require('../electron/permanent-file/records.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-pf-records-'));
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
  return db;
}

test('history persists effective changes and provides a year-end comparison', (t) => {
  const db = fixture(t);
  const user = { userId: 'user-a', isAdmin: false };
  const common = { kind: 'director', subjectId: 'person-1' };
  addHistory(db, user, 'client-a', { ...common, effectiveFrom: '2024-01-01', effectiveUntil: '2025-04-01', attributes: { name: 'A', title: 'Director' } });
  addHistory(db, user, 'client-a', { ...common, effectiveFrom: '2025-04-01', effectiveUntil: null, attributes: { name: 'A', title: 'Chair' } });
  assert.equal(readHistory(db, user, 'client-a').length, 2);
  assert.deepEqual(yearEndChanges(db, user, 'client-a', '2025-03-31', '2026-03-31'), [{
    kind: 'director', subjectId: 'person-1', change: 'changed',
    before: { name: 'A', title: 'Director' }, after: { name: 'A', title: 'Chair' },
  }]);
});

test('history refuses overlaps and leaves existing data unchanged', (t) => {
  const db = fixture(t);
  const user = { userId: 'user-a', isAdmin: false };
  const entry = { kind: 'shareholder', subjectId: 's1', effectiveFrom: '2024-01-01', effectiveUntil: null, attributes: { name: 'A' } };
  addHistory(db, user, 'client-a', entry);
  assert.throws(() => addHistory(db, user, 'client-a', { ...entry, effectiveFrom: '2025-01-01' }), /overlap/);
  assert.equal(readHistory(db, user, 'client-a').length, 1);
});

test('unauthorized and cross-client history access fails', (t) => {
  const db = fixture(t);
  const user = { userId: 'user-a', isAdmin: false };
  assert.throws(() => readHistory(db, user, 'client-b'), /access denied/i);
  assert.throws(() => addHistory(db, user, 'client-b', {}), /access denied/i);
  assert.throws(() => readHistory(db, null, 'client-a'), /authenticated/i);
});

test('successor closes an open record atomically and rejects forged or overlapping changes', (t) => {
  const db = fixture(t);
  const user = { userId: 'user-a', isAdmin: false };
  const original = { kind: 'director', subjectId: 'p1', effectiveFrom: '2024-01-01', effectiveUntil: null, attributes: { name: 'A' } };
  const id = addHistory(db, user, 'client-a', original);
  assert.throws(() => addHistory(db, user, 'client-a', { ...original, predecessorId: id, effectiveFrom: '2023-01-01' }), /earlier record/);
  assert.equal(readHistory(db, user, 'client-a')[0].effectiveUntil, null);
  assert.throws(() => addHistory(db, user, 'client-a', { ...original, predecessorId: 'forged', effectiveFrom: '2025-01-01' }), /earlier record/);
  addHistory(db, user, 'client-a', { ...original, predecessorId: id, effectiveFrom: '2025-01-01', attributes: { name: 'B' } });
  assert.equal(readHistory(db, user, 'client-a')[0].effectiveUntil, '2025-01-01');
  assert.throws(() => addHistory(db, user, 'client-a', { ...original, predecessorId: id, effectiveFrom: '2026-01-01' }), /open earlier/);
  assert.equal(yearEndChanges(db, user, 'client-a', '2024-03-31', '2025-03-31')[0].change, 'changed');
});

test('supporting document must belong to the same client', (t) => {
  const db = fixture(t);
  const user = { userId: 'user-a', isAdmin: false };
  db.exec(`INSERT INTO permanent_file_documents (id,client_id,category,document_number,name,created_by)
    VALUES ('doc-b','client-b','PF-03',1,'Document','user-b');
    INSERT INTO permanent_file_versions (id,document_id,version,file_name,storage_key,size_bytes,sha256,uploaded_by)
    VALUES ('version-b','doc-b',1,'a.pdf','key',1,'hash','user-b');`);
  assert.throws(() => addHistory(db, user, 'client-a', {
    kind: 'director', subjectId: 'p1', effectiveFrom: '2024-01-01', effectiveUntil: null,
    attributes: { name: 'A', documentVersionId: 'version-b' },
  }), /Supporting document/);
  assert.equal(readHistory(db, user, 'client-a').length, 0);
});

test('ending an open record retains history and flags removal', (t) => {
  const db = fixture(t);
  const user = { userId: 'user-a', isAdmin: false };
  const id = addHistory(db, user, 'client-a', { kind: 'partner', subjectId: 'p1', effectiveFrom: '2024-01-01', effectiveUntil: null, attributes: { name: 'A' } });
  assert.throws(() => endHistory(db, user, 'client-a', id, null), /end date is required/);
  assert.throws(() => endHistory(db, user, 'client-a', id, '2023-01-01'), /after effective from/);
  assert.throws(() => endHistory(db, { userId: 'user-b', isAdmin: false }, 'client-b', id, '2025-01-01'), /open record/);
  endHistory(db, user, 'client-a', id, '2025-01-01');
  assert.equal(yearEndChanges(db, user, 'client-a', '2024-03-31', '2025-03-31')[0].change, 'removed');
  assert.throws(() => endHistory(db, user, 'client-a', id, '2026-01-01'), /open record/);
});
