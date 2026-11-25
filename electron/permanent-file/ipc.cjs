'use strict';

const { canAccessPermanentFile } = require('./authorization.cjs');
const { CATEGORIES, documentReference, compareYearEnds, requirePastOrToday } = require('./domain.cjs');
const { MAX_FILE_BYTES, uploadVersion, downloadVersion, inspectStorage } = require('./documents.cjs');
const { upgradePermanentFile } = require('./migration.cjs');
const { addHistory, readHistory, endHistory } = require('./records.cjs');
const { readEntity, saveEntity, saveClientMaster } = require('./entities.cjs');

function createPermanentFileHandler({ getDb, getContext, backupDir, storageDir }) {
  return async (event, request) => {
    try {
      const db = getDb();
      if (!db) throw new Error('Database is unavailable.');
      const context = getContext(db, event);
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new TypeError('Invalid permanent-file request.');
      }
      const { action, clientId } = request;
      if (!canAccessPermanentFile(db, context, clientId)) throw new Error('Permanent-file access denied.');
      upgradePermanentFile(db, backupDir);

      if (action === 'list') {
        const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(clientId);
        const documents = db.prepare(`
          SELECT d.id, d.name, d.category, d.document_number AS documentNumber,
                 v.id AS versionId, v.version, v.file_name AS fileName,
                 v.uploaded_by AS uploadedBy, v.uploaded_at AS uploadedAt,
                 v.verification_status AS verificationStatus, v.reviewed_date AS reviewedDate,
                 v.expiry_date AS expiryDate, v.document_year AS documentYear, v.keywords
          FROM permanent_file_documents d
          JOIN permanent_file_versions v ON v.document_id = d.id
          WHERE d.client_id = ?
          ORDER BY d.name, v.version DESC
        `).all(clientId).map((row) => ({
          ...row,
          reference: documentReference(clientId, row.category, row.documentNumber, row.version),
          engagementIds: db.prepare('SELECT engagement_id FROM permanent_file_engagements WHERE document_id = ? ORDER BY engagement_id')
            .all(row.id).map((link) => link.engagement_id),
        }));
        const inspection = inspectStorage({ db, root: storageDir });
        return { success: true, data: {
          client, documents, categories: CATEGORIES,
          engagements: db.prepare('SELECT id, name, financial_year AS financialYear FROM engagements WHERE client_id = ? ORDER BY name, financial_year, id').all(clientId),
          storageWarning: inspection.orphaned.length + inspection.missing.length + inspection.unexpected.length > 0,
        } };
      }
      if (action === 'upload') {
        if (!(request.bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(request.bytes)) {
          throw new TypeError('Document contents are required.');
        }
        if (request.bytes.byteLength === 0 || request.bytes.byteLength > MAX_FILE_BYTES) {
          throw new RangeError('Document must contain between 1 byte and 25 MiB.');
        }
        const bytes = Buffer.from(request.bytes);
        const result = uploadVersion({
          db, root: storageDir, context, clientId,
          documentId: request.documentId,
          category: request.category,
          name: request.name,
          fileName: request.fileName,
          engagementIds: request.engagementIds,
          bytes,
        });
        return { success: true, data: result };
      }
      if (action === 'download') {
        const result = downloadVersion({ db, root: storageDir, context, clientId, versionId: request.versionId });
        return { success: true, data: { fileName: result.fileName, bytes: result.bytes } };
      }
      if (action === 'updateMetadata') {
        const { versionId, verificationStatus, reviewedDate, expiryDate, documentYear, keywords, engagementIds } = request;
        if (!['unverified', 'verified', 'rejected'].includes(verificationStatus)) throw new TypeError('Invalid verification status.');
        for (const [label, date] of [['Reviewed date', reviewedDate], ['Expiry date', expiryDate]]) {
          if (date) {
            requirePastOrToday(date, label);
          } else if (date !== null) throw new TypeError(`${label} must be a date or null.`);
        }
        if (documentYear !== null && (typeof documentYear !== 'string' || documentYear.length > 30)) throw new TypeError('Invalid document year.');
        if (keywords !== null && (typeof keywords !== 'string' || keywords.length > 1000)) throw new TypeError('Invalid keywords.');
        if (!Array.isArray(engagementIds) || engagementIds.some((id) => typeof id !== 'string' || !id)) throw new TypeError('Invalid engagement list.');
        const row = db.prepare(`SELECT d.id FROM permanent_file_versions v JOIN permanent_file_documents d ON d.id = v.document_id
          WHERE v.id = ? AND d.client_id = ?`).get(versionId, clientId);
        if (!row) throw new Error('Document version not found for this client.');
        const belongs = db.prepare('SELECT 1 FROM engagements WHERE id = ? AND client_id = ?');
        if (engagementIds.some((id) => !belongs.get(id, clientId))) throw new Error('Linked engagement does not belong to this client.');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`UPDATE permanent_file_versions SET verification_status = ?, reviewed_date = ?, expiry_date = ?,
            document_year = ?, keywords = ? WHERE id = ?`).run(verificationStatus, reviewedDate, expiryDate, documentYear, keywords, versionId);
          db.prepare('DELETE FROM permanent_file_engagements WHERE document_id = ?').run(row.id);
          const link = db.prepare('INSERT OR IGNORE INTO permanent_file_engagements (document_id, engagement_id) VALUES (?, ?)');
          engagementIds.forEach((id) => link.run(row.id, id));
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return { success: true, data: { updated: true } };
      }
      if (action === 'history') {
        return { success: true, data: { history: readHistory(db, context, clientId) } };
      }
      if (action === 'entity') return { success: true, data: { entity: readEntity(db, context, clientId) } };
      if (action === 'saveClientMaster') {
        saveClientMaster(db, context, clientId, request.master);
        return { success: true, data: { updated: true } };
      }
      if (action === 'saveEntity') {
        saveEntity(db, context, clientId, request.details);
        return { success: true, data: { updated: true } };
      }
      if (action === 'addHistory') {
        const id = addHistory(db, context, clientId, request.entry);
        return { success: true, data: { historyId: id } };
      }
      if (action === 'compareHistory') {
        requirePastOrToday(request.previousDate, 'Previous year end');
        requirePastOrToday(request.currentDate, 'Current year end');
        const history = readHistory(db, context, clientId);
        return { success: true, data: {
          changes: compareYearEnds(history, request.previousDate, request.currentDate),
          records: history.filter((row) => row.effectiveFrom <= request.currentDate
            && (row.effectiveUntil === null || request.currentDate < row.effectiveUntil)),
        } };
      }
      if (action === 'endHistory') {
        endHistory(db, context, clientId, request.historyId, request.effectiveUntil);
        return { success: true, data: { ended: true } };
      }
      throw new Error('Unsupported permanent-file action.');
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Permanent-file operation failed.' };
    }
  };
}

module.exports = { createPermanentFileHandler };
