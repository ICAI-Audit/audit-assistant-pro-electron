'use strict';

const crypto = require('node:crypto');
const { canAccessPermanentFile } = require('./authorization.cjs');
const { compareYearEnds, requirePastOrToday } = require('./domain.cjs');

const KINDS = new Set([
  'director', 'kmp', 'partner', 'shareholder', 'beneficial_owner',
  'related_party', 'group_company', 'committee', 'authorized_signatory',
]);

function assertAccess(db, context, clientId) {
  if (!canAccessPermanentFile(db, context, clientId)) throw new Error('Permanent-file access denied.');
}

function readHistory(db, context, clientId) {
  assertAccess(db, context, clientId);
  return db.prepare(`
    SELECT id, subject_id AS subjectId, kind, effective_from AS effectiveFrom,
           effective_until AS effectiveUntil, attributes_json AS attributesJson,
           recorded_by AS recordedBy, recorded_at AS recordedAt
    FROM permanent_file_people WHERE client_id = ?
    ORDER BY kind, subject_id, effective_from
  `).all(clientId).map(({ attributesJson, ...row }) => ({
    ...row,
    attributes: JSON.parse(attributesJson),
  }));
}

function addHistory(db, context, clientId, entry) {
  assertAccess(db, context, clientId);
  if (!entry || !KINDS.has(entry.kind)) throw new TypeError('Invalid ownership or management category.');
  if (typeof entry.subjectId !== 'string' || !entry.subjectId.trim() || entry.subjectId.length > 128) {
    throw new TypeError('A stable subject ID is required.');
  }
  if (!entry.attributes || Object.getPrototypeOf(entry.attributes) !== Object.prototype
      || typeof entry.attributes.name !== 'string' || !entry.attributes.name.trim()) {
    throw new TypeError('A name is required.');
  }
  const attributesJson = JSON.stringify(entry.attributes);
  if (Buffer.byteLength(attributesJson, 'utf8') > 16384) throw new RangeError('Record details are too large.');
  const normalized = {
    kind: entry.kind,
    subjectId: entry.subjectId.trim(),
    effectiveFrom: entry.effectiveFrom,
    effectiveUntil: entry.effectiveUntil || null,
    attributes: entry.attributes,
  };
  compareYearEnds([normalized], '0001-01-01', '9999-12-31');
  requirePastOrToday(normalized.effectiveFrom, 'Effective from');
  if (normalized.effectiveUntil) requirePastOrToday(normalized.effectiveUntil, 'Effective until');
  if (entry.attributes.documentVersionId) {
    if (typeof entry.attributes.documentVersionId !== 'string'
        || !db.prepare(`SELECT 1 FROM permanent_file_versions v
          JOIN permanent_file_documents d ON d.id = v.document_id
          WHERE v.id = ? AND d.client_id = ?`).get(entry.attributes.documentVersionId, clientId)) {
      throw new Error('Supporting document version not found for this client.');
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (entry.predecessorId) {
      const predecessor = db.prepare(`SELECT id, effective_from AS effectiveFrom, effective_until AS effectiveUntil
        FROM permanent_file_people WHERE id = ? AND client_id = ? AND kind = ? AND subject_id = ?`)
        .get(entry.predecessorId, clientId, normalized.kind, normalized.subjectId);
      if (!predecessor || predecessor.effectiveUntil !== null || predecessor.effectiveFrom >= normalized.effectiveFrom) {
        throw new Error('An open earlier record for this subject is required.');
      }
      db.prepare('UPDATE permanent_file_people SET effective_until = ? WHERE id = ? AND client_id = ?')
        .run(normalized.effectiveFrom, predecessor.id, clientId);
    }
    const overlap = db.prepare(`
      SELECT 1 FROM permanent_file_people
      WHERE client_id = ? AND kind = ? AND subject_id = ?
        AND (? IS NULL OR effective_from < ?)
        AND (effective_until IS NULL OR effective_until > ?)
      LIMIT 1
    `).get(clientId, normalized.kind, normalized.subjectId, normalized.effectiveUntil,
      normalized.effectiveUntil, normalized.effectiveFrom);
    if (overlap) throw new Error('Effective dates overlap an existing record.');
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO permanent_file_people
        (id, client_id, subject_id, kind, effective_from, effective_until, attributes_json, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, clientId, normalized.subjectId, normalized.kind, normalized.effectiveFrom,
      normalized.effectiveUntil, attributesJson, context.userId);
    db.exec('COMMIT');
    return id;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function yearEndChanges(db, context, clientId, previousDate, currentDate) {
  return compareYearEnds(readHistory(db, context, clientId), previousDate, currentDate);
}

function endHistory(db, context, clientId, id, effectiveUntil) {
  assertAccess(db, context, clientId);
  if (typeof effectiveUntil !== 'string' || !effectiveUntil) throw new TypeError('An end date is required.');
  requirePastOrToday(effectiveUntil, 'Effective until');
  const record = readHistory(db, context, clientId).find((row) => row.id === id);
  if (!record || record.effectiveUntil !== null) throw new Error('An open record for this client is required.');
  compareYearEnds([{ ...record, effectiveUntil }], '0001-01-01', '9999-12-31');
  const result = db.prepare(`UPDATE permanent_file_people SET effective_until = ?
    WHERE id = ? AND client_id = ? AND effective_until IS NULL`).run(effectiveUntil, id, clientId);
  if (result.changes !== 1) throw new Error('The record changed before it could be ended.');
}

module.exports = { KINDS, addHistory, readHistory, yearEndChanges, endHistory };
