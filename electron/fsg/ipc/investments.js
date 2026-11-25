import { ipcMain, getRegisteredHandlers } from '../ipc-registry.js'
import { query } from '../db/client.js'
import { noteStore } from '../db/noteStore.js'
import { investmentKind, investmentLedgerKey, investmentSubclass, validateInvestmentInput } from '../../../src/modules/fsg/utils/investments.js'

async function context({ entityPeriodId, tbId }) {
  const { rows: [ep] } = await query('SELECT * FROM entity_periods WHERE id=$1', [entityPeriodId])
  if (!ep) throw new Error('Select a Financial Year for investment details.')
  if (tbId != null) {
    const { rows: [tb] } = await query('SELECT entity_period_id FROM trial_balances WHERE id=$1', [tbId])
    if (!tb || Number(tb.entity_period_id) !== Number(ep.id)) throw new Error('Trial Balance does not belong to this Financial Year.')
  }
  return ep
}
const storedTitle = (ep, kind) => `Investment disclosure FY ${ep.id} ${kind}`
// Existing JSON store, reserved negative keys. Year and branch/consolidated scope remain explicit.
const storedNum = (ep, kind) => -3000000 - Number(ep.id) * 2 - (kind === 'current' ? 1 : 0)
export function registerInvestmentHandlers() {
  ipcMain.handle('investments:list', async (_, scope) => {
    const ep = await context(scope)
    const out = {}
    for (const kind of ['current', 'noncurrent']) {
      const row = await noteStore.find(scope.tbId ? 'note_details' : 'entity_note_details', scope.tbId || ep.entity_id, storedNum(ep, kind), storedTitle(ep, kind))
      if (row) out[kind] = JSON.parse(row.value)
    }
    return out
  })
  ipcMain.handle('investments:save', async (_, scope) => {
    const ep = await context(scope)
    if (ep.locked || ep.is_final) throw new Error('This Financial Period is locked or finalised. Unlock it before editing investments.')
    const kind = investmentKind(scope.noteTitle)
    if (!kind) throw new Error('Select a current or non-current investment note.')
    validateInvestmentInput(scope.data)
    let rows
    if (scope.tbId) rows = await getRegisteredHandlers().get('financials:getData')(_, scope.tbId)
    else {
      const { rows: tbs } = await query('SELECT id FROM trial_balances WHERE entity_period_id=$1', [ep.id])
      rows = tbs.length ? await getRegisteredHandlers().get('financials:getConsolidatedData')(_, ep.entity_id, tbs.map(t => t.id)) : []
    }
    const pyIds = [...new Set(scope.data.pyTBIds || [])].map(Number)
    for (const id of pyIds) {
      const { rows: [allowed] } = await query(`SELECT tb.id FROM trial_balances tb
        JOIN entity_periods old_ep ON old_ep.id=tb.entity_period_id
        JOIN financial_periods old_fp ON old_fp.id=old_ep.financial_period_id
        JOIN financial_periods cur_fp ON cur_fp.id=$1
        WHERE tb.id=$2 AND old_ep.entity_id=$3 AND old_fp.date_till < cur_fp.date_from
          AND old_fp.date_from >= date(cur_fp.date_from, '-1 year')`, [ep.financial_period_id, id, ep.entity_id])
      if (!allowed) throw new Error('Comparative investment ledgers must belong to this client and the immediately previous financial year.')
      rows.push(...await getRegisteredHandlers().get('financials:getData')(_, id))
    }
    const candidates = new Map(rows.filter(r => investmentKind(r.level2 || r.mapping2_resultant) === kind).map(r => [investmentLedgerKey(r), r]))
    const data = { ...scope.data, entries: scope.data.entries.map(e => {
      const r = candidates.get(e.ledgerKey)
      if (!r || investmentSubclass(r) !== e.subclass) throw new Error('An investment ledger is outside this note, sub-classification or Financial Year. Reopen Fill Details and review the row.')
      return { ...e, ledgerName: r.ledger_name || r.name, ...(kind === 'current' ? { trade: '' } : {}) }
    }) }
    await noteStore.save(scope.tbId ? 'note_details' : 'entity_note_details', scope.tbId || ep.entity_id,
      storedNum(ep, kind), storedTitle(ep, kind), JSON.stringify(data), undefined, true)
    return { ok: true }
  })
}
