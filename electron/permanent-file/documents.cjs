'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canAccessPermanentFile } = require('./authorization.cjs');
const { CATEGORIES, documentReference } = require('./domain.cjs');

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertAccess(db, context, clientId) {
  if (!canAccessPermanentFile(db, context, clientId)) throw new Error('Permanent-file access denied.');
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 255) {
    throw new TypeError(`${label} must be between 1 and 255 characters.`);
  }
  return value.trim();
}

function uploadVersion({ db, root, context, clientId, documentId, category, name, fileName, bytes, engagementIds = [] }) {
  assertAccess(db, context, clientId);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
    throw new RangeError('Document must contain between 1 byte and 25 MiB.');
  }
  const safeFileName = requireText(fileName, 'File name');
  if (safeFileName.includes('/') || safeFileName.includes('\\') || safeFileName === '.' || safeFileName === '..') {
    throw new TypeError('File name must not contain a path.');
  }
  if (!Array.isArray(engagementIds) || engagementIds.some((id) => typeof id !== 'string' || !id)) {
    throw new TypeError('Engagement IDs must be a list of IDs.');
  }
  const engagementExists = db.prepare('SELECT 1 FROM engagements WHERE id = ? AND client_id = ?');
  for (const id of engagementIds) {
    if (!engagementExists.get(id, clientId)) throw new Error('Linked engagement does not belong to this client.');
  }
  let document = null;
  if (documentId) {
    document = db.prepare('SELECT * FROM permanent_file_documents WHERE id = ? AND client_id = ?').get(documentId, clientId);
    if (!document) throw new Error('Document not found for this client.');
  } else {
    if (!Object.hasOwn(CATEGORIES, category)) throw new RangeError('Unknown permanent-file category.');
    name = requireText(name, 'Document name');
  }

  fs.mkdirSync(root, { recursive: true });
  const key = crypto.randomUUID();
  const filePath = path.join(root, key);
  let wroteFile = false;
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(filePath, 'wx', 0o600);
    wroteFile = true;
    fs.writeFileSync(fileDescriptor, bytes);
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;

    db.exec('BEGIN IMMEDIATE');
    let transactionOpen = true;
    try {
      if (!document) {
        const documentNumber = db.prepare('SELECT COALESCE(MAX(document_number), 0) + 1 AS next FROM permanent_file_documents WHERE client_id = ? AND category = ?').get(clientId, category).next;
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO permanent_file_documents (id, client_id, category, document_number, name, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, clientId, category, documentNumber, name, context.userId);
        document = { id, client_id: clientId, category, document_number: documentNumber };
      }
      const version = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM permanent_file_versions WHERE document_id = ?').get(document.id).next;
      const versionId = crypto.randomUUID();
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      db.prepare('INSERT INTO permanent_file_versions (id, document_id, version, file_name, storage_key, size_bytes, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(versionId, document.id, version, safeFileName, key, bytes.length, digest, context.userId);
      const link = db.prepare('INSERT OR IGNORE INTO permanent_file_engagements (document_id, engagement_id) VALUES (?, ?)');
      for (const id of engagementIds) link.run(document.id, id);
      const reference = documentReference(clientId, document.category, document.document_number, version);
      db.exec('COMMIT');
      transactionOpen = false;
      return { documentId: document.id, versionId, reference };
    } catch (error) {
      if (transactionOpen) db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
    if (wroteFile) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Upload failed and its temporary file could not be removed.');
      }
    }
    throw error;
  }
}

function downloadVersion({ db, root, context, clientId, versionId }) {
  assertAccess(db, context, clientId);
  const row = db.prepare(`
    SELECT v.file_name, v.storage_key, v.size_bytes, v.sha256
    FROM permanent_file_versions v
    JOIN permanent_file_documents d ON d.id = v.document_id
    WHERE v.id = ? AND d.client_id = ?
  `).get(versionId, clientId);
  if (!row) throw new Error('Document version not found for this client.');
  if (!KEY_PATTERN.test(row.storage_key)) throw new Error('Invalid stored document identifier.');
  const bytes = fs.readFileSync(path.join(root, row.storage_key));
  if (bytes.length !== row.size_bytes) throw new Error('Stored document size does not match its record.');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
    throw new Error('Stored document checksum does not match its record.');
  }
  return { fileName: row.file_name, bytes };
}

function inspectStorage({ db, root }) {
  const rows = db.prepare('SELECT storage_key FROM permanent_file_versions').all();
  const referenced = new Set(rows.map((row) => row.storage_key));
  if ([...referenced].some((key) => !KEY_PATTERN.test(key))) {
    throw new Error('Permanent-file records contain an invalid storage identifier.');
  }
  if (!fs.existsSync(root)) {
    return { orphaned: [], missing: [...referenced].sort(), unexpected: [] };
  }
  const files = fs.readdirSync(root, { withFileTypes: true });
  const stored = new Set(files.filter((file) => file.isFile() && KEY_PATTERN.test(file.name)).map((file) => file.name));
  const unexpected = files.filter((file) => !file.isFile() || !KEY_PATTERN.test(file.name)).map((file) => file.name).sort();
  return {
    orphaned: [...stored].filter((key) => !referenced.has(key)).sort(),
    missing: [...referenced].filter((key) => !stored.has(key)).sort(),
    unexpected,
  };
}

module.exports = { MAX_FILE_BYTES, uploadVersion, downloadVersion, inspectStorage };
