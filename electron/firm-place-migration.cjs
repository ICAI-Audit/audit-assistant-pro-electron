'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Additive, retryable upgrade. Back up the complete SQLite database before
// adding the optional field; existing firm details and final years stay intact.
function ensureFirmPlace(db, backupDir) {
  if (db.prepare('PRAGMA table_info(firm_settings)').all().some(c => c.name === 'place')) return null;
  let backupPath = null;
  if (db.name !== ':memory:') {
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `audit_assistant-before-T023-firm-place-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.prepare('VACUUM INTO ?').run(backupPath);
  }
  db.transaction(() => db.exec('ALTER TABLE firm_settings ADD COLUMN place TEXT'))();
  return backupPath;
}

module.exports = { ensureFirmPlace };
