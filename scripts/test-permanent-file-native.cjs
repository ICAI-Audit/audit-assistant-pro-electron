'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { createPermanentFileHandler } = require('../electron/permanent-file/ipc.cjs');

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-pf-native-'));
  const db = new Database(path.join(dir, 'test.db'));
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT, constitution TEXT, cin TEXT,
        pan TEXT, address TEXT, state TEXT, pin TEXT, updated_at TEXT);
      CREATE TABLE engagements (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_name TEXT, updated_at TEXT);
      CREATE TABLE engagement_assignments (engagement_id TEXT NOT NULL, user_id TEXT NOT NULL);
      CREATE TABLE client_gstins (client_id TEXT NOT NULL, gstin TEXT NOT NULL);
      INSERT INTO clients (id, name) VALUES ('client-a','A'), ('client-b','B');
      INSERT INTO engagements (id, client_id, client_name) VALUES ('eng-a','client-a','A'), ('eng-b','client-b','B');
      INSERT INTO engagement_assignments VALUES ('eng-a','user-a'), ('eng-b','user-b');
      INSERT INTO client_gstins VALUES ('client-a','27AAACA1234A1Z5');
    `);
    const handler = createPermanentFileHandler({
      getDb: () => db,
      getContext: (_db, event) => {
        if (!event.user) throw new Error('Authentication required.');
        return { userId: event.user, isAdmin: false, isManagerOrAbove: true };
      },
      backupDir: path.join(dir, 'backup'),
      storageDir: path.join(dir, 'files'),
    });
    const user = { user: 'user-a' };
    const denied = await handler({ user: 'user-b' }, { action: 'list', clientId: 'client-a' });
    assert.equal(denied.success, false);
    const upload = await handler(user, { action: 'upload', clientId: 'client-a', category: 'PF-01', name: 'Test', fileName: 'test.txt', bytes: new Uint8Array([1, 2, 3]), engagementIds: ['eng-a'] });
    assert.equal(upload.success, true, upload.error);
    const result = await handler(user, { action: 'download', clientId: 'client-a', versionId: upload.data.versionId });
    assert.deepEqual([...result.data.bytes], [1, 2, 3]);
    const master = { name: 'Updated A', industry: 'Services', constitution: 'company', cin: '',
      pan: 'AAACA1234A', address: '', state: '', pin: '' };
    const saved = await handler(user, { action: 'saveClientMaster', clientId: 'client-a', master });
    assert.equal(saved.success, true, saved.error);
    db.exec("INSERT INTO client_gstins VALUES ('client-a','27BBBPF1234B1Z5')");
    const entity = await handler(user, { action: 'entity', clientId: 'client-a' });
    assert.deepEqual(entity.data.entity.gstins, ['27AAACA1234A1Z5']);
    assert.deepEqual(entity.data.entity.unmatchedGstins, ['27BBBPF1234B1Z5']);
    assert.equal(db.prepare("SELECT client_name FROM engagements WHERE id = 'eng-a'").get().client_name, 'Updated A');
    console.log('Permanent-file synthetic native SQLite smoke passed.');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true });
  }
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
