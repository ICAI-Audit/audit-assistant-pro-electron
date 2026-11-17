'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TABLES = [
  'permanent_file_entities',
  'permanent_file_people',
  'permanent_file_documents',
  'permanent_file_versions',
  'permanent_file_engagements',
];

const SCHEMA = `
CREATE TABLE permanent_file_entities (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE RESTRICT,
  trade_name TEXT,
  incorporation_date TEXT,
  incorporation_place TEXT,
  tan TEXT,
  branches_json TEXT NOT NULL DEFAULT '[]',
  group_details TEXT,
  audit_partner TEXT,
  key_personnel TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE permanent_file_people (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  attributes_json TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX idx_permanent_file_people_client ON permanent_file_people(client_id, kind, subject_id, effective_from);
CREATE TABLE permanent_file_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  document_number INTEGER NOT NULL CHECK (document_number > 0),
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, category, document_number)
);
CREATE INDEX idx_permanent_file_documents_client ON permanent_file_documents(client_id, category);
CREATE TABLE permanent_file_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES permanent_file_documents(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 26214400),
  sha256 TEXT NOT NULL,
  mime_type TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  reviewed_date TEXT,
  expiry_date TEXT,
  document_year TEXT,
  keywords TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, version)
);
CREATE TABLE permanent_file_engagements (
  document_id TEXT NOT NULL REFERENCES permanent_file_documents(id) ON DELETE RESTRICT,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE RESTRICT,
  PRIMARY KEY (document_id, engagement_id)
);
`;

function inspectTables(db) {
  const query = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
  return TABLES.filter((name) => query.get(name));
}

function upgradePermanentFile(db, backupDir) {
  const present = inspectTables(db);
  if (present.length === TABLES.length) return { upgraded: false, backupPath: null };
  if (present.length !== 0) {
    throw new Error('Permanent-file schema is incomplete; restore the pre-upgrade backup before retrying.');
  }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'clients'").get()
      || !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'engagements'").get()) {
    throw new Error('Client and engagement tables must exist before upgrading permanent files.');
  }
  if (typeof backupDir !== 'string' || !backupDir.trim()) throw new TypeError('Backup directory is required.');

  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `audit_assistant-before-permanent-file-${crypto.randomUUID()}.db`);
  db.prepare('VACUUM INTO ?').run(backupPath);
  if (!fs.statSync(backupPath).isFile()) throw new Error('Permanent-file upgrade backup was not created.');

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SCHEMA);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { upgraded: true, backupPath };
}

module.exports = { upgradePermanentFile, TABLES };
