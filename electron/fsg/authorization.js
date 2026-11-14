// Main-process authorization for the Financial Statement Review (FSG) IPC
// channels.
//
// FSG_Bharat had no users: every PC connected to a shared PostgreSQL database
// could read and write every Auditee. Inside ICAI VERA each fsg:* call must
// pass the same controls as VERA's own database access (T-003):
//   1. an authenticated, active user with a supported role, from the main
//      application frame (checked by the caller, electron/fsg/index.js);
//   2. a policy entry for the channel (unknown channels are refused);
//   3. scope checks for every record id the call names.
//
// Scope model (owner decision 2026-11-02, T-019): an FSG entity is a VERA
// client; an FSG entity period is that client's financial year, shared by
// every engagement of the client for that year.
//   - read of client data: the user can access at least one engagement of the
//     client (partners and admins: all clients);
//   - write to a financial year's data (trial balances, mapping, notes,
//     statements): the user can access an engagement of that client for that
//     financial year or the following one (comparatives are prepared by the
//     next year's team);
//   - write to client-level data (auditors, signatories, custom mapping rules,
//     learned rules, consolidated-view settings): client access;
//   - global masters (auditor firms and their signatories): managers and above;
//   - export of every FSG table: partners and admins.
// All ids named in one call must belong to the same client.
//
// File paths: FSG reads and writes files by path in the main process. A path
// is accepted only if the user picked it in an fsg:dialog:openFile /
// fsg:dialog:saveFile dialog in this session (a saved file may also have a
// sibling written beside it, as Generate Financials does for its second PDF).

import { basename, dirname, extname, resolve as resolvePath } from 'node:path'

// ── Policy table ───────────────────────────────────────────────────────────
// access: 'auth' | 'manager' | 'partner' | 'disabled'
// scopes: [{ kind, arg, prop?, many?, optional? }]
// write:  true when the call changes data (period/client write rules apply)
// paths:  [{ arg, prop?, mode: 'open' | 'save' }]

const R = (kind, arg = 0, extra = {}) => ({ kind, arg, ...extra })

const DISABLED_IN_VERA = {
  'entity:delete': 'Auditees are VERA clients. Delete the client in VERA instead.',
  'entityPeriod:attach': 'Financial years are opened from VERA engagements.',
  'entityPeriod:delete': 'Financial years are opened from VERA engagements and cannot be detached here.',
  'financialPeriod:save': 'Financial years come from VERA engagements.',
  'financialPeriod:delete': 'Financial years come from VERA engagements.',
  'settings:save': 'The database is managed by ICAI VERA.',
  'settings:testConnection': 'The database is managed by ICAI VERA.',
}

export const CHANNEL_POLICY = {
  // Reference data and utilities (no client data)
  'settings:get': { access: 'auth' },
  'format:getReference': { access: 'auth' },
  'tally:getConfig': { access: 'auth' },
  'tally:saveConfig': { access: 'auth' },
  'tally:check': { access: 'auth' },
  'tally:tcpPing': { access: 'auth' },
  'tally:companies': { access: 'auth' },
  'tally:listCompanies': { access: 'auth' },
  'tally:fetchTB': { access: 'auth' },
  'importPPEFromTally': { access: 'auth' },
  'financials:renderPDF': { access: 'auth' },
  'itr:exportExcel': { access: 'auth' },
  'tb:template': { access: 'auth' },
  'dep:scheduleII': { access: 'auth' },
  'dep:itBlocksMaster': { access: 'auth' },
  'dep:downloadTemplate': { access: 'auth' },
  'dep:parseExcel': { access: 'auth', paths: [{ arg: 0, mode: 'open' }] },
  'financialPeriod:list': { access: 'auth' },
  'mapping:getDefault': { access: 'auth' },
  'auditor:listGlobal': { access: 'auth' },
  'auditorFirm:list': { access: 'auth' },
  'globalSignatory:list': { access: 'auth' },
  'dialog:openFile': { access: 'auth' },
  'dialog:saveFile': { access: 'auth' },
  'file:read': { access: 'auth', paths: [{ arg: 0, mode: 'open' }] },
  'file:write': { access: 'auth', paths: [{ arg: 0, mode: 'save' }] },

  // Global masters
  'auditorFirm:save': { access: 'manager', write: true },
  'auditorFirm:delete': { access: 'manager', write: true },
  'globalSignatory:save': { access: 'manager', write: true },
  'globalSignatory:delete': { access: 'manager', write: true },
  'db:exportAllTablesToFile': { access: 'partner' },

  // Entities (VERA clients)
  'entity:getAll': { access: 'auth', filterResult: 'entities' },
  'entity:save': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'id' })], requireScope: true },
  'tb:getBranches': { access: 'auth', scopes: [R('entity')] },

  // Entity periods (financial years)
  'entityPeriod:list': { access: 'auth', scopes: [R('entity')] },
  'entityPeriod:get': { access: 'auth', scopes: [R('entityPeriod')] },
  'investments:list': { access: 'auth', scopes: [R('entityPeriod', 0, { prop: 'entityPeriodId' }), R('tb', 0, { prop: 'tbId', optional: true })] },
  'investments:save': { access: 'auth', write: true, scopes: [R('entityPeriod', 0, { prop: 'entityPeriodId' }), R('tb', 0, { prop: 'tbId', optional: true })] },
  'entityPeriod:setPrevTB': { access: 'auth', write: true, scopes: [R('entityPeriod'), R('tb', 1, { optional: true, readOnly: true })] },
  'entityPeriod:setPYMode': { access: 'auth', write: true, scopes: [R('entityPeriod')] },
  'entityPeriod:lock': { access: 'auth', write: true, scopes: [R('entityPeriod')] },
  'entityPeriod:unlock': { access: 'manager', write: true, scopes: [R('entityPeriod')] },
  'entityPeriod:finalise': { access: 'auth', write: true, scopes: [R('entityPeriod')] },

  // Trial balances
  'tb:upload': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' }), R('entityPeriod', 0, { prop: 'entityPeriodId' })], paths: [{ arg: 0, prop: 'filePath', mode: 'open' }] },
  'tb:uploadTally': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' }), R('entityPeriod', 0, { prop: 'entityPeriodId' })] },
  'tb:uploadRealBooks': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' }), R('entityPeriod', 0, { prop: 'entityPeriodId' })] },
  'tb:uploadZoho': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' }), R('entityPeriod', 0, { prop: 'entityPeriodId' })] },
  'tb:uploadBusy': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' }), R('entityPeriod', 0, { prop: 'entityPeriodId' })] },
  'tb:list': { access: 'auth', scopes: [R('entity')] },
  'tb:listByEntityPeriod': { access: 'auth', scopes: [R('entityPeriod')] },
  'tb:rows': { access: 'auth', scopes: [R('tb')] },
  'tb:delete': { access: 'auth', write: true, scopes: [R('tb')] },
  'tb:saveStock': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'tb:getStockRows': { access: 'auth', scopes: [R('tb')] },
  'tb:getOtherExpenseHeads': { access: 'auth', scopes: [R('tb')] },
  'tb:getOpeningStockCheck': { access: 'auth', scopes: [R('tb')] },
  'tb:insertManualRow': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'tb:deleteRow': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' }), R('tbRow', 0, { prop: 'rowId' })] },
  'tb:getLedgersForTB': { access: 'auth', scopes: [R('tb')] },
  'tb:saveJournalEntry': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },

  // Mapping rules
  'mapping:ruleSets': { access: 'auth', scopes: [R('entity')] },
  'mapping:getUserMapping': { access: 'auth', scopes: [R('entity')] },
  'mapping:levelFormat': { access: 'auth', scopes: [R('ruleSet', 1, { optional: true })] },
  'mapping:upload': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' })], paths: [{ arg: 0, prop: 'filePath', mode: 'open' }] },
  'mapping:revertDefault': { access: 'auth', write: true, scopes: [R('entity')] },
  'mapping:getMapSheets': { access: 'auth', scopes: [R('ruleSet', 0, { optional: true })] },
  'mapping:download': { access: 'auth', scopes: [R('ruleSet', 0, { optional: true })] },
  'mapping:saveUser': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' })] },

  // Mapped trial balance
  'mappedTB:run': { access: 'auth', write: true, scopes: [R('tb'), R('ruleSet', 1, { optional: true, readOnly: true })] },
  'mappedTB:rows': { access: 'auth', scopes: [R('tb')] },
  'mappedTB:setAdjustment': { access: 'auth', write: true, scopes: [R('mappedRow')] },
  'mappedTB:addManualLedger': { access: 'auth', write: true, scopes: [R('tb')] },
  'mappedTB:deleteManualLedger': { access: 'auth', write: true, scopes: [R('mappedRow')] },
  'mappedTB:adjustmentSummary': { access: 'auth', scopes: [R('tbOrEntity')] },
  'mappedTB:clearAdjustments': { access: 'auth', write: true, scopes: [R('tb')] },
  'mappedTB:adjustmentLog': { access: 'auth', scopes: [R('tb')] },
  'mappedTB:approve': { access: 'auth', write: true, scopes: [R('mappedRow')] },
  'mappedTB:approveMany': { access: 'auth', write: true, scopes: [R('mappedRow', 0, { many: true })] },
  'mappedTB:override': { access: 'auth', write: true, scopes: [R('mappedRow')] },
  'mappedTB:overrideMany': { access: 'auth', write: true, scopes: [R('mappedRow', 0, { many: true })] },
  'mappedTB:bulkSetLevel5': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'mappedTB:bulkSetLevel3': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'mappedTB:markReview': { access: 'auth', write: true, scopes: [R('mappedRow', 0, { many: true })] },
  'mappedTB:resolveConflict': { access: 'auth', write: true, scopes: [R('mappedRow')] },
  'mappedTB:resolveDiscrepancy': { access: 'auth', write: true, scopes: [R('mappedRow')] },
  'mappedTB:clearAll': { access: 'auth', write: true, scopes: [R('tb')] },
  'mappedTB:downloadExcel': { access: 'auth', scopes: [R('tb')] },
  'mappedTB:captionTuples': { access: 'auth', scopes: [R('tb')] },
  'mappedTB:findByFilter': { access: 'auth', scopes: [R('tb')] },
  'mappedTB:diagnostics': { access: 'auth', scopes: [R('tb')] },
  'learnedRules:download': { access: 'auth', scopes: [R('entity')] },
  'learnedRules:upload': { access: 'auth', write: true, scopes: [R('entity')] },
  'learnedRules:apply': { access: 'auth', write: true, scopes: [R('entity')] },
  'learnedRules:list': { access: 'auth', scopes: [R('entity')] },

  // Statements
  'financials:getData': { access: 'auth', scopes: [R('tb')] },
  'financials:getMissingAlie': { access: 'auth', scopes: [R('tb')] },
  'financials:getConsolidatedMissingAlie': { access: 'auth', scopes: [R('entity'), R('tb', 1, { many: true, optional: true })] },
  'financials:getConsolidatedData': { access: 'auth', scopes: [R('entity'), R('tb', 1, { many: true, optional: true })] },
  'financials:getBranchTBsData': { access: 'auth', scopes: [R('entity'), R('tb', 1, { many: true, optional: true })] },

  // Auditors and signatories of an entity
  'auditor:list': { access: 'auth', scopes: [R('entity')] },
  'auditor:save': { access: 'auth', write: true, scopes: [R('auditorSave')] },
  'auditor:delete': { access: 'auth', write: true, scopes: [R('auditor')] },
  'signatory:list': { access: 'auth', scopes: [R('entity')] },
  'signatory:save': { access: 'auth', write: true, scopes: [R('signatorySave')] },
  'signatory:delete': { access: 'auth', write: true, scopes: [R('signatory')] },

  // Notes
  'noteDetails:get': { access: 'auth', scopes: [R('tb')] },
  'noteDetails:save': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'noteDetails:listByTB': { access: 'auth', scopes: [R('tb')] },
  'itrDetails:get': { access: 'auth', scopes: [R('tb')] },
  'itrDetails:save': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'noteDisclosure:get': { access: 'auth', scopes: [R('tb')] },
  'noteDisclosure:save': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'noteDisclosure:listByTB': { access: 'auth', scopes: [R('tb')] },
  'entityNoteDisclosure:get': { access: 'auth', scopes: [R('entity')] },
  'entityNoteDisclosure:save': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' })] },
  'entityNoteDisclosure:list': { access: 'auth', scopes: [R('entity')] },
  'entityNoteDetails:get': { access: 'auth', scopes: [R('entity')] },
  'entityNoteDetails:save': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' })] },
  'entityNoteDetails:list': { access: 'auth', scopes: [R('entity')] },
  'notesGetMSME': { access: 'auth', scopes: [R('tb')] },
  'notesSaveMSME': { access: 'auth', write: true, scopes: [R('tb')] },
  'notesGetCashBank': { access: 'auth', scopes: [R('tb')] },
  'notesSaveCashBank': { access: 'auth', write: true, scopes: [R('tb')] },
  'notesGetTradeReceivablesAging': { access: 'auth', scopes: [R('tb')] },
  'notesSaveTradeReceivablesAging': { access: 'auth', write: true, scopes: [R('tb')] },
  'notesGetTradePayablesAging': { access: 'auth', scopes: [R('tb')] },
  'notesSaveTradePayablesAging': { access: 'auth', write: true, scopes: [R('tb')] },

  // Remarks, manual previous-year figures, EPS, face lines
  'remarks:listByTB': { access: 'auth', scopes: [R('tb')] },
  'remarks:save': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'remarks:consolidated': { access: 'auth', scopes: [R('tb'), R('tb', 1, { optional: true })] },
  'manualPY:get': { access: 'auth', scopes: [R('tb')] },
  'manualPY:set': { access: 'auth', write: true, scopes: [R('tb')] },
  'plClosedToCapital:get': { access: 'auth', scopes: [R('tb')] },
  'plClosedToCapital:set': { access: 'auth', write: true, scopes: [R('tb')] },
  'entityPlClosedToCapital:get': { access: 'auth', scopes: [R('entity')] },
  'entityPlClosedToCapital:set': { access: 'auth', write: true, scopes: [R('entity')] },
  'eps:get': { access: 'auth', scopes: [R('tb')] },
  'eps:set': { access: 'auth', write: true, scopes: [R('tb')] },
  'entityEps:get': { access: 'auth', scopes: [R('entity')] },
  'entityEps:set': { access: 'auth', write: true, scopes: [R('entity')] },
  'manualPyEntries:list': { access: 'auth', scopes: [R('tb')] },
  'manualPyEntries:upsert': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'manualPyEntries:delete': { access: 'auth', write: true, scopes: [R('manualPyEntry')] },
  'entityManualPY:get': { access: 'auth', scopes: [R('entity')] },
  'entityManualPY:set': { access: 'auth', write: true, scopes: [R('entity')] },
  'entityManualPyEntries:list': { access: 'auth', scopes: [R('entity')] },
  'entityManualPyEntries:upsert': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' })] },
  'entityManualPyEntries:delete': { access: 'auth', write: true, scopes: [R('entityManualPyEntry')] },
  'manualFaceLines:list': { access: 'auth', scopes: [R('tb')] },
  'manualFaceLines:add': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'manualFaceLines:update': { access: 'auth', write: true, scopes: [R('manualFaceLine', 0, { prop: 'id' })] },
  'manualFaceLines:delete': { access: 'auth', write: true, scopes: [R('manualFaceLine')] },

  // Depreciation
  'dep:save': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'dep:get': { access: 'auth', scopes: [R('tb')] },
  'dep:getMappedLedgers': { access: 'auth', scopes: [R('tb')] },
  'dep:itBlocksCustom': { access: 'auth', scopes: [R('entity')] },
  'dep:saveCustomITBlock': { access: 'auth', write: true, scopes: [R('entity', 0, { prop: 'entityId' })] },
  'dep:getITLedgers': { access: 'auth', scopes: [R('tb')] },
  'dep:getIT': { access: 'auth', scopes: [R('tb')] },
  'dep:saveIT': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },
  'dep:getComp': { access: 'auth', scopes: [R('tb')] },
  'dep:saveComp': { access: 'auth', write: true, scopes: [R('tb', 0, { prop: 'tbId' })] },

  // Per financial-year documents: (entityId, entityPeriodId, ...)
  'cfs:get': { access: 'auth', scopes: [R('entity'), R('entityPeriod', 1)] },
  'cfs:save': { access: 'auth', write: true, scopes: [R('entity'), R('entityPeriod', 1)] },
  'deferredTax:get': { access: 'auth', scopes: [R('entity'), R('entityPeriod', 1)] },
  'deferredTax:save': { access: 'auth', write: true, scopes: [R('entity'), R('entityPeriod', 1)] },
  'taxComputation:get': { access: 'auth', scopes: [R('entity'), R('entityPeriod', 1)] },
  'taxComputation:save': { access: 'auth', write: true, scopes: [R('entity'), R('entityPeriod', 1)] },
  'generalNotes:get': { access: 'auth', scopes: [R('entity'), R('entityPeriod', 1)] },
  'generalNotes:save': { access: 'auth', write: true, scopes: [R('entity'), R('entityPeriod', 1)] },
  'getForm3CD': { access: 'auth', scopes: [R('entity'), R('entityPeriod', 1)] },
  'saveForm3CD': { access: 'auth', write: true, scopes: [R('entity'), R('entityPeriod', 1)] },
  'ratio:getGPSelection': { access: 'auth', scopes: [R('entity'), R('entityPeriod', 1)] },
  'ratio:saveGPSelection': { access: 'auth', write: true, scopes: [R('entity'), R('entityPeriod', 1)] },
  'getPPELedgers': { access: 'auth', scopes: [R('entity'), R('entityPeriod', 1)] },
  'savePPELedgers': { access: 'auth', write: true, scopes: [R('entity'), R('entityPeriod', 1)] },
  'deletePPELedger': { access: 'auth', write: true, scopes: [R('ppeLedger')] },
}

for (const [channel, reason] of Object.entries(DISABLED_IN_VERA)) {
  CHANNEL_POLICY[channel] = { access: 'disabled', reason }
}

// ── Scope resolution ───────────────────────────────────────────────────────

class AuthorizationError extends Error {}

function fyKey(value) {
  const m = String(value || '').match(/(\d{4})\s*-\s*(\d{2,4})/)
  return m ? m[1] : null
}

// Each resolver returns { clientId, fy } where fy is the financial-year key of
// the period the record belongs to (null for client-level records), or null
// when the record does not exist.
function makeResolvers(db) {
  const one = (sql, id) => db.prepare(sql).get(id)
  const periodSql = `
    SELECT e.client_id AS client_id, fp.year_label AS year_label
      FROM entity_periods ep
      JOIN entities e ON e.id = ep.entity_id
      JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE ep.id = ?`
  const tbSql = `
    SELECT e.client_id AS client_id, fp.year_label AS year_label, tb.entity_period_id AS entity_period_id
      FROM trial_balances tb
      JOIN entities e ON e.id = tb.entity_id
      LEFT JOIN entity_periods ep ON ep.id = tb.entity_period_id
      LEFT JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE tb.id = ?`
  const fromTb = (row) => (row ? { clientId: row.client_id, fy: fyKey(row.year_label), periodless: !row.entity_period_id } : null)
  const entityScope = (row) => (row ? { clientId: row.client_id, fy: null } : null)

  const tb = (id) => fromTb(one(tbSql, id))
  const entity = (id) => entityScope(one('SELECT client_id FROM entities WHERE id = ?', id))
  const entityPeriod = (id) => {
    const row = one(periodSql, id)
    return row ? { clientId: row.client_id, fy: fyKey(row.year_label) } : null
  }
  const viaTb = (sql) => (id) => {
    const row = one(sql, id)
    return row ? tb(row.tb_id) : null
  }

  return {
    tb,
    entity,
    entityPeriod,
    mappedRow: viaTb('SELECT tb_id FROM mapped_tb WHERE id = ?'),
    manualPyEntry: viaTb('SELECT tb_id FROM manual_py_entries WHERE id = ?'),
    manualFaceLine: viaTb('SELECT tb_id FROM manual_face_lines WHERE id = ?'),
    auditor: (id) => {
      const row = one('SELECT entity_id FROM auditors WHERE id = ?', id)
      return row ? entity(row.entity_id) : null
    },
    signatory: (id) => {
      const row = one('SELECT entity_id FROM signatories WHERE id = ?', id)
      return row ? entity(row.entity_id) : null
    },
    entityManualPyEntry: (id) => {
      const row = one('SELECT entity_id FROM entity_manual_py_entries WHERE id = ?', id)
      return row ? entity(row.entity_id) : null
    },
    ppeLedger: (id) => {
      const row = one('SELECT entity_period_id FROM ppe_ledgers WHERE id = ?', id)
      return row ? entityPeriod(row.entity_period_id) : null
    },
    ruleSet: (id) => {
      const row = one('SELECT entity_id, is_default FROM mapping_rule_sets WHERE id = ?', id)
      if (!row) return null
      if (row.entity_id == null) return { global: true }
      return entity(row.entity_id)
    },
  }
}

function valuesFor(spec, args) {
  let value = args[spec.arg]
  if (spec.prop) value = value && typeof value === 'object' ? value[spec.prop] : undefined
  if (spec.many) return Array.isArray(value) ? value : value == null ? [] : [value]
  return [value]
}

// Special argument shapes that need more than a single id.
function expandSpecialScopes(spec, args) {
  const arg = args[spec.arg]
  if (spec.kind === 'tbOrEntity') {
    if (arg && typeof arg === 'object' && arg.entityId != null) return [{ kind: 'entity', id: arg.entityId }]
    return [{ kind: 'tb', id: arg }]
  }
  if (spec.kind === 'auditorSave' || spec.kind === 'signatorySave') {
    const base = spec.kind === 'auditorSave' ? 'auditor' : 'signatory'
    if (arg && arg.id != null) return [{ kind: base, id: arg.id }]
    return [{ kind: 'entity', id: arg ? arg.entity_id : undefined }]
  }
  if (spec.kind === 'tbRow') return [] // checked in checkTbRowBelongs
  return null
}

function isId(value) {
  return (typeof value === 'number' && Number.isInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value))
}

// ── Access decisions ───────────────────────────────────────────────────────

function createAccessChecker(db, context) {
  const cache = new Map()
  const engagementsForClient = (clientId) => {
    if (cache.has(clientId)) return cache.get(clientId)
    const rows = context.hasGlobalEngagementAccess
      ? db.prepare('SELECT id, financial_year FROM engagements WHERE client_id = ?').all(clientId)
      : db.prepare(`
          SELECT e.id, e.financial_year
            FROM engagements e
            JOIN engagement_assignments ea ON ea.engagement_id = e.id
           WHERE e.client_id = ? AND ea.user_id = ?`).all(clientId, context.userId)
    cache.set(clientId, rows)
    return rows
  }
  return {
    canReadClient(clientId) {
      if (context.hasGlobalEngagementAccess) return true
      return engagementsForClient(clientId).length > 0
    },
    // A year's data can be changed by the team of that year's engagement, and
    // by the team of the following year (who prepare the comparatives).
    canWriteYear(clientId, fy) {
      if (context.hasGlobalEngagementAccess) return true
      if (!fy) return false
      const next = String(Number(fy) + 1)
      return engagementsForClient(clientId).some((e) => {
        const key = fyKey(e.financial_year)
        return key === fy || key === next
      })
    },
  }
}

export function authorizeCall({ db, context, channel, args }) {
  const policy = CHANNEL_POLICY[channel]
  if (!policy) throw new AuthorizationError(`Unknown Financial Statement Review action: ${channel}`)
  if (policy.access === 'disabled') throw new AuthorizationError(policy.reason)
  if (policy.access === 'manager' && !context.isManagerOrAbove) {
    throw new AuthorizationError('This action requires a manager, partner or admin role.')
  }
  if (policy.access === 'partner' && !context.isPartner) {
    throw new AuthorizationError('This action requires a partner or admin role.')
  }

  const resolvers = makeResolvers(db)
  const access = createAccessChecker(db, context)
  const clients = new Set()
  let resolvedAny = false

  for (const spec of policy.scopes || []) {
    const targets = expandSpecialScopes(spec, args)
      || valuesFor(spec, args).map((id) => ({ kind: spec.kind, id }))
    if (spec.many && targets.length === 0 && !spec.optional) {
      throw new AuthorizationError('No records were named for this action.')
    }
    for (const target of targets) {
      if (target.id == null || target.id === '') {
        if (spec.optional) continue
        throw new AuthorizationError('A required record id is missing for this action.')
      }
      // The consolidated view of a branch entity uses a virtual TB id.
      if (target.kind === 'tb' && target.id === '__consolidated__') continue
      if (!isId(target.id)) throw new AuthorizationError('Invalid record id.')
      const scope = resolvers[target.kind](Number(target.id))
      if (!scope) throw new AuthorizationError('The requested record was not found.')
      resolvedAny = true
      if (scope.global) {
        if (policy.write && !spec.readOnly && !context.isManagerOrAbove) {
          throw new AuthorizationError('The default mapping rules can only be changed by a manager, partner or admin.')
        }
        continue
      }
      if (!scope.clientId) throw new AuthorizationError('This record is not linked to a VERA client.')
      clients.add(scope.clientId)
      if (!access.canReadClient(scope.clientId)) {
        throw new AuthorizationError('This client is outside your engagement access.')
      }
      if (policy.write && !spec.readOnly && scope.fy !== null && scope.fy !== undefined) {
        if (!access.canWriteYear(scope.clientId, scope.fy)) {
          throw new AuthorizationError('You are not assigned to an engagement of this client for this financial year.')
        }
      }
      if (policy.write && !spec.readOnly && scope.periodless && !context.hasGlobalEngagementAccess) {
        throw new AuthorizationError('This trial balance is not attached to a financial year.')
      }
    }
  }

  if (policy.requireScope && !resolvedAny) {
    throw new AuthorizationError('New Auditees are created from VERA clients, not from this screen.')
  }
  if (clients.size > 1) {
    throw new AuthorizationError('All records in one action must belong to the same client.')
  }

  if (channel === 'tb:deleteRow') {
    const { tbId, rowId } = args[0] || {}
    const row = db.prepare('SELECT tb_id FROM tb_rows WHERE id = ?').get(Number(rowId))
    if (!row || Number(row.tb_id) !== Number(tbId)) {
      throw new AuthorizationError('The ledger row does not belong to this trial balance.')
    }
  }
  return policy
}

// Filters results that list records across clients.
export function filterResult({ db, context, policy, result }) {
  if (policy.filterResult !== 'entities' || !Array.isArray(result)) return result
  const access = createAccessChecker(db, context)
  return result.filter((entity) => entity && entity.client_id && access.canReadClient(entity.client_id))
}

// ── Dialog-chosen file paths ───────────────────────────────────────────────

const MAX_REMEMBERED_PATHS = 100

export function createPathGuard() {
  const openPaths = new Set()
  const savePaths = new Set()
  const remember = (set, value) => {
    if (typeof value !== 'string' || !value) return
    set.add(resolvePath(value))
    while (set.size > MAX_REMEMBERED_PATHS) set.delete(set.values().next().value)
  }

  function isAllowedSave(target) {
    if (savePaths.has(target)) return true
    // A file written beside a dialog-chosen file, with the chosen name as its
    // prefix and the same extension (e.g. "<name>_Without_Index_and_Annexures.pdf"),
    // or the chosen name with its missing extension added.
    for (const chosen of savePaths) {
      const ext = extname(chosen)
      const stem = basename(chosen, ext)
      if (dirname(chosen) !== dirname(target)) continue
      const name = basename(target)
      if (!ext && name.startsWith(`${stem}.`)) return true
      if (ext && extname(target).toLowerCase() === ext.toLowerCase() && name.startsWith(`${stem}_`)) return true
    }
    return false
  }

  return {
    recordDialogResult(channel, result) {
      if (!result || result.canceled) return
      if (channel === 'dialog:openFile') for (const p of result.filePaths || []) remember(openPaths, p)
      if (channel === 'dialog:saveFile') remember(savePaths, result.filePath)
    },
    check(policy, args) {
      for (const spec of policy.paths || []) {
        let value = args[spec.arg]
        if (spec.prop) value = value && typeof value === 'object' ? value[spec.prop] : undefined
        if (typeof value !== 'string' || !value) throw new AuthorizationError('A file path is required.')
        const target = resolvePath(value)
        const ok = spec.mode === 'open' ? openPaths.has(target) : isAllowedSave(target)
        if (!ok) throw new AuthorizationError('Choose the file in the file dialog first.')
      }
    },
  }
}

export { AuthorizationError }
