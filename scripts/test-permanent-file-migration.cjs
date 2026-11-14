'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { upgradePermanentFile, TABLES } = require('../electron/permanent-file/migration.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-pf-test-'));
  const file = path.join(dir, 'test.db');
  const db = new DatabaseSync(file);
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true });
  });
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE engagements (id TEXT PRIMARY KEY, client_id TEXT);
    INSERT INTO clients VALUES ('client-a', 'Synthetic client');
    INSERT INTO engagements VALUES ('eng-a', 'client-a');
  `);
  return { db, dir };
}

test('upgrade preserves existing data, writes a restorable backup and is idempotent', (t) => {
  const { db, dir } = fixture(t);
  const result = upgradePermanentFile(db, path.join(dir, 'backups'));
  assert.equal(result.upgraded, true);
  assert.ok(fs.existsSync(result.backupPath));
  assert.deepEqual({ ...db.prepare('SELECT * FROM clients').get() }, { id: 'client-a', name: 'Synthetic client' });
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'permanent_file_%'").get().n, TABLES.length);
  const restored = new DatabaseSync(result.backupPath);
  try {
    assert.deepEqual({ ...restored.prepare('SELECT * FROM clients').get() }, { id: 'client-a', name: 'Synthetic client' });
    assert.equal(restored.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'permanent_file_%'").get().n, 0);
  } finally {
    restored.close();
  }
  assert.deepEqual(upgradePermanentFile(db, path.join(dir, 'backups')), { upgraded: false, backupPath: null });
});

test('partial schema fails closed without changing existing records', (t) => {
  const { db, dir } = fixture(t);
  db.exec('CREATE TABLE permanent_file_entities (client_id TEXT)');
  assert.throws(() => upgradePermanentFile(db, path.join(dir, 'backups')), /incomplete/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM clients').get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'permanent_file_%'").get().n, 1);
});

test('failure during upgrade rolls back all new tables and allows retry', (t) => {
  const { db, dir } = fixture(t);
  db.exec('CREATE INDEX idx_permanent_file_people_client ON clients(name)');
  assert.throws(() => upgradePermanentFile(db, path.join(dir, 'backups')), /already exists/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'permanent_file_%'").get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM clients').get().n, 1);
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
  db.exec('DROP INDEX idx_permanent_file_people_client');
  assert.equal(upgradePermanentFile(db, path.join(dir, 'backups')).upgraded, true);
});

test('backup failure stops upgrade before schema changes', (t) => {
  const { db, dir } = fixture(t);
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'fixture');
  assert.throws(() => upgradePermanentFile(db, blocker));
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'permanent_file_%'").get().n, 0);
});
