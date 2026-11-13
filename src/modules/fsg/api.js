// Renderer bridge for the Financial Statement Review (FSG) module.
//
// FSG_Bharat's screens call `window.api.<method>()`; its preload exposed one
// method per IPC channel. In ICAI VERA the preload exposes only
// `window.electronAPI.fsg.invoke(channel, ...args)`, limited to the fsg:*
// channel family, and every call is authorised in the main process
// (electron/fsg/authorization.js). This module keeps FSG's method names and
// argument shapes so the ported screens are unchanged apart from importing
// `fsgApi` instead of reading `window.api`. Method list generated from
// FSG_Bharat 0.1.137 src/preload/index.js.

const listeners = new Set()

async function call(channel, ...args) {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.fsg : undefined
  if (!bridge) throw new Error('Financial Statement Review is available only in the ICAI VERA desktop application.')
  const response = await bridge.invoke(`fsg:${channel}`, ...args)
  if (!response || response.ok !== true) {
    const err = new Error(response?.error || 'The request failed.')
    err.denied = Boolean(response?.denied)
    throw err
  }
  // FSG notified its other windows after a save; inside VERA there is one
  // window, so the notification goes to listeners in this window only.
  if (WRITE_CHANNEL.test(channel)) for (const listener of listeners) { try { listener({ channel }) } catch (_) { /* listener */ } }
  return response.result
}

const WRITE_CHANNEL = /:(save|set|add|upsert|update|override|approve|delete|remove|run|upload|import|clear|lock|unlock|finali[sz]e|attach|revert|resolve|bulk|markReview|publish|insert|apply)/i

export function openEngagementContext(engagementId) {
  return call('context:open', engagementId)
}

export async function getModuleStatus() {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.fsg : undefined
  if (!bridge) return { ok: false, error: 'Financial Statement Review is available only in the ICAI VERA desktop application.' }
  try {
    return await bridge.invoke('fsg:status')
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

export const fsgApi = {
  // Multiple windows are not used inside VERA.
  openNewWindow: async () => false,
  onDataChanged: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
  getSettings:       ()       => call('settings:get'),
  saveSettings:      (cfg)    => call('settings:save', cfg),
  testConnection:    (cfg)    => call('settings:testConnection', cfg),
  exportAllTablesToFile: (opts) => call('db:exportAllTablesToFile', opts),
  getFormatReference:()       => call('format:getReference'),

  // Entities
  getEntities:       ()       => call('entity:getAll'),
  saveEntity:        (e)      => call('entity:save', e),
  deleteEntity:      (id)     => call('entity:delete', id),
  getBranches:       (eid)    => call('tb:getBranches', eid),

  // Financial Periods (global master) + Entity Periods (per-Auditee attachment, with locking)
  listFinancialPeriods:  ()                    => call('financialPeriod:list'),
  saveFinancialPeriod:   (data)                => call('financialPeriod:save', data),
  deleteFinancialPeriod: (id)                  => call('financialPeriod:delete', id),
  listEntityPeriods:     (entityId)            => call('entityPeriod:list', entityId),
  attachEntityPeriod:    (entityId, fpId)      => call('entityPeriod:attach', entityId, fpId),
  lockEntityPeriod:      (id)                  => call('entityPeriod:lock', id),
  unlockEntityPeriod:    (id)                  => call('entityPeriod:unlock', id),
  finaliseEntityPeriod:  (id, place, date)     => call('entityPeriod:finalise', id, place, date),
  deleteEntityPeriod:    (id)                  => call('entityPeriod:delete', id),
  setEntityPeriodPrevTB: (id, tbId)            => call('entityPeriod:setPrevTB', id, tbId),
  getEntityPeriod:       (id)                  => call('entityPeriod:get', id),
  setEntityPeriodPYMode: (id, mode)            => call('entityPeriod:setPYMode', id, mode),

  // Trial Balance
  uploadTB:          (data)   => call('tb:upload', data),
  uploadTallyTB:     (data)   => call('tb:uploadTally', data),
  uploadRealBooksTB: (data)   => call('tb:uploadRealBooks', data),
  uploadZohoTB:      (data)   => call('tb:uploadZoho', data),
  uploadBusyTB:      (data)   => call('tb:uploadBusy', data),

  // Tally Auto-Import (HTTP XML from running Tally)
  checkTally:        (cfg)                    => call('tally:check', cfg),
  getTallyCompanies: (cfg)                    => call('tally:companies', cfg),
  listTallyCompanies:(cfg)                    => call('tally:listCompanies', cfg),
  fetchTallyTB:      (data)                   => call('tally:fetchTB', data),
  tallyGetConfig:    ()                       => call('tally:getConfig'),
  tallySaveConfig:   (cfg)                    => call('tally:saveConfig', cfg),
  tallyTcpPing:      (cfg)                    => call('tally:tcpPing', cfg),
  getTBList:         (eid)    => call('tb:list', eid),
  getTBsForEntityPeriod: (entityPeriodId) => call('tb:listByEntityPeriod', entityPeriodId),
  getTBRows:         (tbId)   => call('tb:rows', tbId),
  downloadTBTemplate:()       => call('tb:template'),
  deleteTB:          (tbId)   => call('tb:delete', tbId),
  saveStock:         (data)   => call('tb:saveStock', data),
  getStockRows:      (tbId)   => call('tb:getStockRows', tbId),
  getOtherExpenseHeads: (tbId) => call('tb:getOtherExpenseHeads', tbId),
  getOpeningStockCheck: (tbId) => call('tb:getOpeningStockCheck', tbId),
  insertManualRow:   (data)   => call('tb:insertManualRow', data),
  deleteTBRow:       (data)   => call('tb:deleteRow', data),
  getLedgersForTB:   (tbId)   => call('tb:getLedgersForTB', tbId),
  saveJournalEntry:  (data)   => call('tb:saveJournalEntry', data),

  // Mapping Rules
  getDefaultMapping: (const_) => call('mapping:getDefault', const_),
  getUserMapping:    (eid)    => call('mapping:getUserMapping', eid),
  saveUserMapping:   (data)   => call('mapping:saveUser', data),
  revertToDefault:   (eid)    => call('mapping:revertDefault', eid),
  downloadMapping:   (rsId)   => call('mapping:download', rsId),
  uploadMapping:     (data)   => call('mapping:upload', data),
  getLevelFormat:    (const_, rsId) => call('mapping:levelFormat', const_, rsId),
  getRuleSets:       (eid)    => call('mapping:ruleSets', eid),
  getMapSheets:      (rsId, const_) => call('mapping:getMapSheets', rsId, const_),

  // Mapped TB
  runMapping:        (tbId, rsId, opts) => call('mappedTB:run', tbId, rsId, opts),
  getMappedRows:     (tbId)          => call('mappedTB:rows', tbId),
  findMappedByFilter:(tbId, filter) => call('mappedTB:findByFilter', tbId, filter),
  listMappedCaptions:(tbId)         => call('mappedTB:captionTuples', tbId),
  exceptionsDiagnostics:(tbId)     => call('mappedTB:diagnostics', tbId),
  setAdjustment:     (id, data)      => call('mappedTB:setAdjustment', id, data),
  getAdjustmentSummary: (arg)        => call('mappedTB:adjustmentSummary', arg),
  clearAdjustments:  (tbId)          => call('mappedTB:clearAdjustments', tbId),
  addManualLedger:   (tbId, data)    => call('mappedTB:addManualLedger', tbId, data),
  deleteManualLedger: (id)           => call('mappedTB:deleteManualLedger', id),
  getAdjustmentLog:  (tbId)          => call('mappedTB:adjustmentLog', tbId),
  approveRow:        (id)            => call('mappedTB:approve', id),
  approveMany:       (ids)           => call('mappedTB:approveMany', ids),
  overrideRow:       (id, data)      => call('mappedTB:override', id, data),
  overrideMany:      (ids, data)     => call('mappedTB:overrideMany', ids, data),
  markReview:        (ids)           => call('mappedTB:markReview', ids),
  bulkSetNature:     (tbId, pattern, val) => call('mappedTB:bulkSetLevel5', { tbId, mapping2Pattern: pattern, level5Value: val }),
  bulkSetNatureL3:   (tbId, pattern, val) => call('mappedTB:bulkSetLevel3', { tbId, mapping2Pattern: pattern, level3Value: val }),
  clearAllMappings:  (tbId)          => call('mappedTB:clearAll', tbId),
  downloadMappedTB:  (tbId)          => call('mappedTB:downloadExcel', tbId),
  downloadLearnedRules: (entityId)          => call('learnedRules:download', entityId),
  uploadLearnedRules:   (entityId, bytes)   => call('learnedRules:upload', entityId, bytes),
  applyLearnedRules:    (entityId)          => call('learnedRules:apply', entityId),
  listLearnedRules:     (entityId)          => call('learnedRules:list', entityId),
  resolveConflict:      (id, chosen)          => call('mappedTB:resolveConflict', id, chosen),
  resolveDiscrepancy:   (id, action, option)  => call('mappedTB:resolveDiscrepancy', id, action, option),

  // Financial Statements
  getFinancialData:          (tbId)       => call('financials:getData', tbId),
  getMissingAlie:            (tbId)       => call('financials:getMissingAlie', tbId),
  getConsolidatedMissingAlie:(entityId, tbIds) => call('financials:getConsolidatedMissingAlie', entityId, tbIds),
  getConsolidatedData:       (entityId, tbIds) => call('financials:getConsolidatedData', entityId, tbIds),
  getBranchTBsData:          (entityId, tbIds = null) => call('financials:getBranchTBsData', entityId, tbIds),
  renderPDF:                 (html)       => call('financials:renderPDF', html),
  getAppVersion:             ()           => call('app:getVersion'),

  // Masters — Auditors & Signatories (legacy per-entity)
  listAuditors:         (entityId)            => call('auditor:list', entityId),
  listGlobalAuditors:   ()                    => call('auditor:listGlobal'),
  saveAuditor:          (data)                => call('auditor:save', data),
  deleteAuditor:        (id)                  => call('auditor:delete', id),
  listSignatories:      (entityId)            => call('signatory:list', entityId),
  saveSignatory:        (data)                => call('signatory:save', data),
  deleteSignatory:      (id)                  => call('signatory:delete', id),

  // Masters — Global Auditor Firms & Signatories (shared across all entities)
  listAuditorFirms:     ()                    => call('auditorFirm:list'),
  saveAuditorFirm:      (data)                => call('auditorFirm:save', data),
  deleteAuditorFirm:    (id)                  => call('auditorFirm:delete', id),
  listGlobalSignatories:(firmId)              => call('globalSignatory:list', firmId),
  saveGlobalSignatory:  (data)                => call('globalSignatory:save', data),
  deleteGlobalSignatory:(id)                  => call('globalSignatory:delete', id),

  // Note Details (supplementary data for each financial statement note)
  getNoteDetails:       (tbId, noteNum, noteTitle)   => call('noteDetails:get', tbId, noteNum, noteTitle),
  listInvestments:      (scope) => call('investments:list', scope),
  saveInvestments:      (scope) => call('investments:save', scope),
  saveNoteDetails:      (data)                       => call('noteDetails:save', data),
  listNoteDetails:      (tbId)                       => call('noteDetails:listByTB', tbId),
  getItrDetails:        (tbId)                       => call('itrDetails:get', tbId),
  saveItrDetails:       (data)                       => call('itrDetails:save', data),
  exportItrExcel:       (data)                       => call('itr:exportExcel', data),
  getNoteDisclosure:    (tbId, noteNum, noteTitle)   => call('noteDisclosure:get', tbId, noteNum, noteTitle),
  saveNoteDisclosure:   (data)                       => call('noteDisclosure:save', data),
  listNoteDisclosures:  (tbId)                       => call('noteDisclosure:listByTB', tbId),
  getEntityNoteDisclosure:   (entityId, noteNum, noteTitle) => call('entityNoteDisclosure:get', entityId, noteNum, noteTitle),
  saveEntityNoteDisclosure:  (data)                  => call('entityNoteDisclosure:save', data),
  listEntityNoteDisclosures: (entityId)              => call('entityNoteDisclosure:list', entityId),
  notesGetMSME:         (tbId, noteNum, noteTitle) => call('notesGetMSME', tbId, noteNum, noteTitle),
  notesSaveMSME:        (tbId, noteNum, noteTitle, data) => call('notesSaveMSME', tbId, noteNum, noteTitle, data),
  notesGetCashBank:     (tbId, noteNum, noteTitle) => call('notesGetCashBank', tbId, noteNum, noteTitle),
  notesSaveCashBank:    (tbId, noteNum, noteTitle, data) => call('notesSaveCashBank', tbId, noteNum, noteTitle, data),
  notesGetTradeReceivablesAging: (tbId, noteNum, noteTitle) => call('notesGetTradeReceivablesAging', tbId, noteNum, noteTitle),
  notesSaveTradeReceivablesAging: (tbId, noteNum, noteTitle, data) => call('notesSaveTradeReceivablesAging', tbId, noteNum, noteTitle, data),
  notesGetTradePayablesAging: (tbId, noteNum, noteTitle) => call('notesGetTradePayablesAging', tbId, noteNum, noteTitle),
  notesSaveTradePayablesAging: (tbId, noteNum, noteTitle, data) => call('notesSaveTradePayablesAging', tbId, noteNum, noteTitle, data),

  // Entity-level Note Details (shared across all branches for statutory forms)
  getEntityNoteDetails:  (entityId, noteNum, noteTitle) => call('entityNoteDetails:get', entityId, noteNum, noteTitle),
  saveEntityNoteDetails: (data)                      => call('entityNoteDetails:save', data),
  listEntityNoteDetails: (entityId)                  => call('entityNoteDetails:list', entityId),

  // Form 3CD (Ratios)
  getForm3CD:            (entityId, entityPeriodId)  => call('getForm3CD', entityId, entityPeriodId),
  saveForm3CD:           (entityId, entityPeriodId, data) => call('saveForm3CD', entityId, entityPeriodId, data),

  // Ratio tab — Gross Profit Trading-Account item selection
  ratioGetGPSelection:   (entityId, entityPeriodId)  => call('ratio:getGPSelection', entityId, entityPeriodId),
  ratioSaveGPSelection:  (entityId, entityPeriodId, selection) => call('ratio:saveGPSelection', entityId, entityPeriodId, selection),

  // General Notes (narrative Notes to Accounts — replaces Tally tab slot)
  getGeneralNotes:       (entityId, entityPeriodId)  => call('generalNotes:get', entityId, entityPeriodId),
  saveGeneralNotes:      (entityId, entityPeriodId, segments) => call('generalNotes:save', entityId, entityPeriodId, segments),

  // Cash Flow Statement (CFS tab): the Previous Year column, typed Current Year overrides, include-in-PDF flag
  getCfs:                (entityId, entityPeriodId)  => call('cfs:get', entityId, entityPeriodId),
  saveCfs:               (entityId, entityPeriodId, data) => call('cfs:save', entityId, entityPeriodId, data),
  getDeferredTax:        (entityId, entityPeriodId)  => call('deferredTax:get', entityId, entityPeriodId),
  saveDeferredTax:       (entityId, entityPeriodId, data) => call('deferredTax:save', entityId, entityPeriodId, data),
  getTaxComputation:     (entityId, entityPeriodId)  => call('taxComputation:get', entityId, entityPeriodId),
  saveTaxComputation:    (entityId, entityPeriodId, data) => call('taxComputation:save', entityId, entityPeriodId, data),


  // PPE (Property, Plant & Equipment)
  getPPELedgers:         (entityId, entityPeriodId)  => call('getPPELedgers', entityId, entityPeriodId),
  savePPELedgers:        (entityId, entityPeriodId, ledgers) => call('savePPELedgers', entityId, entityPeriodId, ledgers),
  deletePPELedger:       (id)                        => call('deletePPELedger', id),
  importPPEFromTally:    (company, host, port)      => call('importPPEFromTally', company, host, port),

  // Manual Previous Year entry (one flag per TB, shared by BS/PL/Notes; plus
  // per-particular/sub-heading PY values entered inline in the Notes screen)
  getManualPY:          (tbId)                      => call('manualPY:get', tbId),
  setManualPY:          (tbId, enabled)              => call('manualPY:set', tbId, enabled),
  getPlClosedToCapital: (tbId)                      => call('plClosedToCapital:get', tbId),
  setPlClosedToCapital: (tbId, enabled)              => call('plClosedToCapital:set', tbId, enabled),
  getEntityPlClosedToCapital: (entityId)              => call('entityPlClosedToCapital:get', entityId),
  setEntityPlClosedToCapital: (entityId, enabled)     => call('entityPlClosedToCapital:set', entityId, enabled),
  getEps:                (tbId)                      => call('eps:get', tbId),
  setEps:                (tbId, field, value)         => call('eps:set', tbId, field, value),
  getEntityEps:           (entityId)                  => call('entityEps:get', entityId),
  setEntityEps:           (entityId, field, value)     => call('entityEps:set', entityId, field, value),
  listManualPyEntries:  (tbId)                       => call('manualPyEntries:list', tbId),
  upsertManualPyEntry:  (data)                       => call('manualPyEntries:upsert', data),
  deleteManualPyEntry:  (id)                         => call('manualPyEntries:delete', id),

  // Manual PY for the Consolidated view of a branch entity — entity-scoped
  // mirror of the four above (see schema.js's entity_manual_py_entries).
  getEntityManualPY:          (entityId)             => call('entityManualPY:get', entityId),
  setEntityManualPY:          (entityId, enabled)    => call('entityManualPY:set', entityId, enabled),
  listEntityManualPyEntries:  (entityId)             => call('entityManualPyEntries:list', entityId),
  upsertEntityManualPyEntry:  (data)                 => call('entityManualPyEntries:upsert', data),
  deleteEntityManualPyEntry:  (id)                   => call('entityManualPyEntries:delete', id),

  // Manual custom face lines (e.g. Tax Expense "+ Add Line" for non-corp)
  listManualFaceLines:  (tbId, section)               => call('manualFaceLines:list', tbId, section),
  addManualFaceLine:    (data)                        => call('manualFaceLines:add', data),
  updateManualFaceLine: (data)                        => call('manualFaceLines:update', data),
  deleteManualFaceLine: (id)                          => call('manualFaceLines:delete', id),

  // Remarks
  listRemarks:          (tbId)                => call('remarks:listByTB', tbId),
  saveRemark:           (data)                => call('remarks:save', data),
  remarksConsolidated:  (tbId, prevTbId)       => call('remarks:consolidated', tbId, prevTbId),

  // Depreciation Schedules — Useful Life / Schedule II basis (unchanged)
  depSave:              (data)      => call('dep:save', data),
  depGet:               (tbId)      => call('dep:get', tbId),
  depScheduleII:        ()          => call('dep:scheduleII'),
  depDownloadTemplate:  ()          => call('dep:downloadTemplate'),
  depParseExcel:        (filePath)  => call('dep:parseExcel', filePath),
  depGetMappedLedgers:  (tbId)      => call('dep:getMappedLedgers', tbId),

  // Depreciation — Income Tax Act, 1961 block-wise basis ("Dep (IT)")
  depITBlocksMaster:    ()          => call('dep:itBlocksMaster'),
  depITBlocksCustom:    (entityId)  => call('dep:itBlocksCustom', entityId),
  depITSaveCustomBlock: (data)      => call('dep:saveCustomITBlock', data),
  depITGetLedgers:      (tbId)      => call('dep:getITLedgers', tbId),
  depITGet:             (tbId)      => call('dep:getIT', tbId),
  depITSave:            (data)      => call('dep:saveIT', data),

  // Depreciation — Companies Act 2013, Schedule II category-level basis ("Dep (Comp)")
  depCompGet:           (tbId)      => call('dep:getComp', tbId),
  depCompSave:          (data)      => call('dep:saveComp', data),

  // File dialog + write
  openFileDialog:    (opts)   => call('dialog:openFile', opts),
  saveFileDialog:    (opts)   => call('dialog:saveFile', opts),
  writeFile:         (path, buf) => call('file:write', path, buf),
  readFile:          (path)  => call('file:read', path),
}

export default fsgApi
