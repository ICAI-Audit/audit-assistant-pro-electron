'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { canAccessPermanentFile } = require('../electron/permanent-file/authorization.cjs');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE clients (id TEXT PRIMARY KEY);
    CREATE TABLE engagements (id TEXT PRIMARY KEY, client_id TEXT NOT NULL);
    CREATE TABLE engagement_assignments (engagement_id TEXT NOT NULL, user_id TEXT NOT NULL);
    INSERT INTO clients VALUES ('client-a'), ('client-b');
    INSERT INTO engagements VALUES ('eng-a1', 'client-a'), ('eng-a2', 'client-a'), ('eng-b', 'client-b');
    INSERT INTO engagement_assignments VALUES ('eng-a1', 'user-a'), ('eng-b', 'user-b');
  `);
  return db;
}

test('assigned users have access across their client engagements, not other clients', (t) => {
  const db = makeDb();
  t.after(() => db.close());
  const staff = { userId: 'user-a', isAdmin: false };
  assert.equal(canAccessPermanentFile(db, staff, 'client-a'), true);
  assert.equal(canAccessPermanentFile(db, staff, 'client-b'), false);
  assert.equal(canAccessPermanentFile(db, staff, 'missing'), false);
});

test('administrators can access existing clients but not non-existent clients', (t) => {
  const db = makeDb();
  t.after(() => db.close());
  const admin = { userId: 'admin', isAdmin: true };
  assert.equal(canAccessPermanentFile(db, admin, 'client-b'), true);
  assert.equal(canAccessPermanentFile(db, admin, 'missing'), false);
});

test('partners without an assignment are not granted global client access', (t) => {
  const db = makeDb();
  t.after(() => db.close());
  assert.equal(canAccessPermanentFile(db, { userId: 'partner', isAdmin: false, isPartner: true }, 'client-a'), false);
});

test('missing authentication and client IDs fail explicitly', (t) => {
  const db = makeDb();
  t.after(() => db.close());
  assert.throws(() => canAccessPermanentFile(db, null, 'client-a'), /authenticated/);
  assert.throws(() => canAccessPermanentFile(db, { userId: 'user-a' }, 'client-a'), /authenticated/);
  assert.throws(() => canAccessPermanentFile(db, { userId: 'user-a', isAdmin: false }, ''), /client ID/);
});
