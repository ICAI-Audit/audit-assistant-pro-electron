// T-044 synthetic checks, called by test-fsg-integration.mjs. No live profile.
// A re-uploaded Trial Balance of the same year receives the old one's workings
// (carry-over), and all workings travel as one Excel file and back.
export async function checkWorkings({ db, check, staff, partner, entityId, periodId, defaultRs }) {
  const ledger = (name, closing, code = '') => ({ period: '2024-25', branch: '', ledger_code: code, name, opening_balance: 0,
    debit: closing < 0 ? -closing : 0, credit: closing > 0 ? closing : 0, closing_balance: closing,
    parent: closing < 0 ? 'Current Assets' : 'Capital Account', group_parent: closing < 0 ? 'Current Assets' : 'Capital Account' })
  const upload = async (name, rows) => {
    const r = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: name, tbRows: rows })
    if (!r.ok) throw new Error(`upload ${name}: ${r.error}`)
    await staff('mappedTB:run', r.result.tb.id, defaultRs, {})
    return r.result.tb.id
  }
  const rows = [ledger('Zw Capital', 50000, 'C1'), ledger('Zw Bank', -30000, 'B1'), ledger('Zw Debtor', -20000)]
  const oldTb = await upload('t044-old.xlsx', rows)
  const mappedId = (tbId, name) => db.prepare('SELECT mt.id FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = ? AND tr.name = ?').get(tbId, name)?.id

  // Work done on the old Trial Balance.
  const work = [
    ['noteDetails:save', { tbId: oldTb, noteNum: 3, noteTitle: 'Share Capital', data: { authorised: 100000 } }],
    ['noteDisclosure:save', { tbId: oldTb, noteNum: 3, noteTitle: 'Share Capital', text: 'Zw disclosure' }],
    ['itrDetails:save', { tbId: oldTb, data: { zw: 1 } }],
    ['remarks:save', { tbId: oldTb, scope: 'notes', scope_key: 'Share Capital::x', remark: 'Zw remark' }],
    ['dep:saveComp', { tbId: oldTb, data: { categoryRows: [{ category: 'Zw Plant', netBlockClose: 5 }] } }],
    ['dep:saveIT', { tbId: oldTb, data: { blockSummary: [{ block: 'Zw 15%', closingWDV: 7 }] } }],
    ['tb:saveStock', { tbId: oldTb, stockData: { opening: { 'Finished Goods': 1000 }, closing: { 'Finished Goods': 1500 } } }],
    ['manualPY:set', oldTb, true],
    ['manualPyEntries:upsert', { tbId: oldTb, noteNum: 3, noteTitle: 'Share Capital', particularLabel: 'Zw PY line', py_amount: 900, is_custom: true }],
    ['manualFaceLines:add', { tbId: oldTb, section: 'el', label: 'Zw face line', cy_amount: 10, py_amount: 5 }],
    ['plClosedToCapital:set', oldTb, true],
    ['eps:set', oldTb, 'basicCY', 2.5],
    ['mappedTB:setAdjustment', mappedId(oldTb, 'Zw Bank'), { debit: 1000 }],
    ['mappedTB:setAdjustment', mappedId(oldTb, 'Zw Debtor'), { credit: 1000 }],
    ['tb:saveJournalEntry', { tbId: oldTb, date: '2025-03-31', entries: [
      { type: 'Dr', amount: 400, ledgerName: 'Zw Audit Fee', isNew: true, mapping1: 'Other expenses', mapping2: 'Audit Fees' },
      { type: 'Cr', amount: 400, ledgerName: 'Zw Audit Fee Payable', isNew: true, mapping1: 'Other current liabilities', mapping2: 'Others' }] }],
  ]
  const failed = []
  for (const [ch, ...args] of work) { const r = await staff(ch, ...args); if (!r.ok) failed.push({ ch, r }) }
  check('T-044 synthetic workings saved on the old Trial Balance', failed.length === 0, failed)

  let r = await staff('workings:summary', oldTb)
  const count = (res, key) => res.ok ? (res.result.areas.find(a => a.key === key)?.count || 0) : -1
  check('T-044 the summary lists every kind of working', r.ok && ['notes', 'disclosures', 'itr', 'remarks', 'depBooks', 'depIT', 'stock', 'manualPy', 'faceLines', 'settings', 'adjustments', 'manualLedgers'].every(k => count(r, k) > 0), r.ok ? r.result.areas : r)
  check('T-044 adjustments and journal entries are not ticked by default', r.ok && r.result.areas.filter(a => !a.defaultOn).map(a => a.key).join(',') === 'adjustments,manualLedgers', r.ok ? r.result.areas : r)

  // A new Trial Balance of the same year: carry the default areas over.
  const newRows = [ledger('Zw Capital', 52000, 'C1'), ledger('Zw Bank', -32000, 'B1'), ledger('Zw Other', -20000)]
  const newTb = await upload('t044-new.xlsx', newRows)
  const defaults = r.result.areas.filter(a => a.defaultOn).map(a => a.key)
  r = await staff('workings:carryOver', { fromTbId: oldTb, toTbId: newTb, include: defaults })
  check('T-044 carry-over to the re-uploaded Trial Balance succeeds', r.ok && r.result.carried.length === defaults.length, r)
  const one = (sql) => db.prepare(sql).get(newTb)
  check('T-044 Fill Details, disclosures, ITR, remarks and both depreciation schedules arrive', JSON.parse(one('SELECT data FROM note_details WHERE tb_id = ?')?.data || '{}').authorised === 100000
    && one('SELECT text FROM note_disclosures WHERE tb_id = ?')?.text === 'Zw disclosure' && !!one('SELECT 1 AS x FROM itr_details WHERE tb_id = ?')
    && one('SELECT remark FROM remarks WHERE tb_id = ?')?.remark === 'Zw remark'
    && one('SELECT data FROM dep_comp_schedules WHERE tb_id = ?')?.data.includes('Zw Plant') && one('SELECT data FROM dep_it_schedules WHERE tb_id = ?')?.data.includes('Zw 15%'))
  const stock = db.prepare(`SELECT name, opening_balance, closing_balance FROM tb_rows WHERE tb_id = ? AND upload_nature = 'Stock Entry' ORDER BY name`).all(newTb)
  check('T-044 Stock is rebuilt through the Stock save with the same figures', stock.some(s => s.name === 'Closing Stock - BS - Finished Goods' && s.opening_balance === -1000 && s.closing_balance === -1500), stock)
  check('T-044 manual PY, extra face lines, P&L-closed and EPS settings arrive',
    one('SELECT manual_py FROM trial_balances WHERE id = ?')?.manual_py === 1 && one('SELECT py_amount FROM manual_py_entries WHERE tb_id = ?')?.py_amount === 900
    && one('SELECT label FROM manual_face_lines WHERE tb_id = ?')?.label === 'Zw face line'
    && one('SELECT pl_closed_to_capital FROM trial_balances WHERE id = ?')?.pl_closed_to_capital === 1 && one('SELECT eps_basic_cy FROM trial_balances WHERE id = ?')?.eps_basic_cy === 2.5)
  check('T-044 unticked adjustments and journal entries are not carried', !one(`SELECT 1 AS x FROM tb_rows WHERE tb_id = ? AND (COALESCE(adj_debit,0) <> 0 OR upload_nature = 'Journal Passed Manually')`))
  check('T-044 the new Trial Balance keeps its own ledger balances', db.prepare("SELECT closing_balance FROM tb_rows WHERE tb_id = ? AND name = 'Zw Capital'").get(newTb)?.closing_balance === 52000)

  r = await staff('workings:carryOver', { fromTbId: oldTb, toTbId: newTb, include: ['adjustments', 'manualLedgers'] })
  check('T-044 ticked adjustments are applied to matching ledgers (by code, else name)', r.ok && db.prepare("SELECT adj_debit FROM tb_rows WHERE tb_id = ? AND name = 'Zw Bank'").get(newTb)?.adj_debit === 1000, r)
  check('T-044 an adjustment whose ledger is not in the new Trial Balance is reported', r.ok && r.result.skipped.some(s => s.key === 'adjustments' && s.items.includes('Zw Debtor')), r.ok ? r.result.skipped : r)
  check('T-044 journal entry ledgers arrive with their mapping', db.prepare(`SELECT COUNT(*) AS c FROM tb_rows tr JOIN mapped_tb mt ON mt.tb_row_id = tr.id WHERE tr.tb_id = ? AND tr.upload_nature = 'Journal Passed Manually'`).get(newTb).c === 2)
  r = await staff('workings:carryOver', { fromTbId: oldTb, toTbId: newTb, include: ['manualLedgers'] })
  check('T-044 carrying journal entries twice does not double them', r.ok && db.prepare(`SELECT COUNT(*) AS c FROM tb_rows WHERE tb_id = ? AND upload_nature = 'Journal Passed Manually'`).get(newTb).c === 2, r)

  // Safeguards.
  const prevPeriod = db.prepare(`SELECT ep.id FROM entity_periods ep JOIN financial_periods fp ON fp.id = ep.financial_period_id WHERE ep.entity_id = ? AND fp.year_label = '2023-24'`).get(entityId)?.id
  const pyTb = (await staff('tb:uploadRealBooks', { entityId, entityPeriodId: prevPeriod, fileName: 't044-py.xlsx', tbRows: rows })).result?.tb?.id
  r = await staff('workings:carryOver', { fromTbId: oldTb, toTbId: pyTb, include: defaults })
  check('T-044 carry-over to another financial year is refused', r.ok === false && /same client, financial year and branch/.test(r.error), r)
  await staff('entityPeriod:lock', periodId)
  r = await staff('workings:carryOver', { fromTbId: oldTb, toTbId: newTb, include: defaults })
  check('T-044 carry-over into a locked year is refused', r.ok === false && r.denied && /locked or final/.test(r.error), r)
  await partner('entityPeriod:unlock', periodId)

  // One Excel file out, and back into a third Trial Balance.
  r = await staff('workings:export', oldTb)
  check('T-044 all workings download as one Excel file', r.ok && Array.isArray(r.result.bytes) && /_Workings\.xlsx$/.test(r.result.filename), r.ok ? r.result.filename : r)
  const file = r.result.bytes
  const thirdTb = await upload('t044-third.xlsx', rows)
  r = await staff('workings:import', { tbId: thirdTb, bytes: file, dryRun: true })
  check('T-044 the file is previewed before anything is written', r.ok && r.result.sameClient && r.result.sameYear && r.result.areas.find(a => a.key === 'stock')?.count === 1
    && !db.prepare('SELECT 1 AS x FROM note_details WHERE tb_id = ?').get(thirdTb), r)
  r = await staff('workings:import', { tbId: thirdTb, bytes: file, include: ['notes', 'stock', 'depBooks', 'adjustments', 'manualLedgers'] })
  check('T-044 uploading the file restores the chosen workings', r.ok && !!db.prepare('SELECT 1 AS x FROM note_details WHERE tb_id = ?').get(thirdTb)
    && db.prepare("SELECT adj_credit FROM tb_rows WHERE tb_id = ? AND name = 'Zw Debtor'").get(thirdTb)?.adj_credit === 1000
    && db.prepare(`SELECT COUNT(*) AS c FROM tb_rows WHERE tb_id = ? AND upload_nature = 'Stock Entry'`).get(thirdTb).c > 0, r)
  check('T-044 areas not chosen are left alone', !db.prepare('SELECT 1 AS x FROM remarks WHERE tb_id = ?').get(thirdTb))
  r = await staff('workings:import', { tbId: thirdTb, bytes: [1, 2, 3] })
  check('T-044 a file that is not a workings file is refused', r.ok === false && /workbook|workings file/.test(r.error), r)
  const ctx2 = await partner('context:open', 'e2')
  const otherTb = (await partner('tb:uploadRealBooks', { entityId: ctx2.result.entity.id, entityPeriodId: ctx2.result.entityPeriodId, fileName: 't044-other.xlsx', tbRows: rows })).result?.tb?.id
  r = await partner('workings:import', { tbId: otherTb, bytes: file, include: ['notes'] })
  check('T-044 a workings file of another client is refused', r.ok === false && /belongs to/.test(r.error), r)
  r = await staff('workings:summary', '__consolidated__')
  check('T-044 the Consolidated view is refused', r.ok === false, r)

  for (const tb of [newTb, thirdTb, pyTb, oldTb]) await staff('tb:delete', tb)
  await partner('tb:delete', otherTb)
}
