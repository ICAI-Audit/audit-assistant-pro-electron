// T-040 synthetic checks, called by test-fsg-integration.mjs. No live profile.
// The Rectification / Recategorisation queue must list exactly the ledgers the
// Notes screen still flags with Fix: a Level 4/5/6 option that is blank or not
// one of the options (even after the ledger was saved), and a sales ledger not
// split into Sale of Products / Sale of Services.
import { ledgerNeeds } from '../src/modules/fsg/utils/fixTargets.js'

export async function checkQueue({ db, check, staff, entityId, periodId, defaultRs }) {
  const constitution = db.prepare('SELECT constitution FROM entities WHERE id = ?').get(entityId)?.constitution
  const lfWith = (level) => db.prepare(`SELECT * FROM level_format WHERE rule_set_id = ? AND constitution = ?
    AND level${level} LIKE '%/%' AND level1 IS NOT NULL AND level2 IS NOT NULL ORDER BY id LIMIT 1`).get(defaultRs, constitution)
  const lf5 = lfWith(5)
  const lf6 = lfWith(6)
  const sale = db.prepare(`SELECT * FROM level_format WHERE rule_set_id = ? AND constitution = ?
    AND LOWER(level1) LIKE 'revenue from operation%' AND LOWER(TRIM(level2)) IN ('sale', 'sales') ORDER BY id LIMIT 1`).get(defaultRs, constitution)
  check('T-040 default mapping has Level 5 options and a Sale line to test with', !!lf5 && !!sale, { lf5: !!lf5, lf6: !!lf6, sale: !!sale })
  if (!lf5 || !sale) return

  const ledger = (name, closing) => ({ period: '2024-25', branch: '', ledger_code: '', name, opening_balance: 0,
    debit: closing < 0 ? -closing : 0, credit: closing > 0 ? closing : 0, closing_balance: closing, parent: 'Zq Queue', group_parent: 'Zq Queue' })
  let r = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 't040.xlsx',
    tbRows: [ledger('Zq Level5 Ledger', -1000), ledger('Zq Level6 Ledger', -1000), ledger('Zq Sale Ledger', 2000)] })
  check('T-040 synthetic trial balance uploaded', r.ok, r)
  if (!r.ok) return
  const tbId = r.result.tb.id
  r = await staff('mappedTB:run', tbId, defaultRs, {})
  const ids = Object.fromEntries(db.prepare('SELECT tr.name, mt.id FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = ?').all(tbId).map(x => [x.name, x.id]))
  const options = (cell) => String(cell).split('/').map(s => s.trim()).filter(Boolean)
  const save = (name, lf, extra = {}) => staff('mappedTB:override', ids[name], {
    mapping1_resultant: lf.level1, mapping2_resultant: lf.level2, mapping3_resultant: options(lf.level3 || '')[0] || null,
    level_format_id: lf.id, level4_value: options(lf.level4 || '').length > 1 ? options(lf.level4)[0] : null,
    level5_value: null, level6_value: null, level7_value: null, override_note: 'T-040', ...extra })
  const queued = async () => {
    const res = await staff('mappedTB:findByFilter', tbId, { uncategorised: true })
    return new Set((res.ok ? res.result : []).map(x => x.name))
  }
  const lfRows = db.prepare('SELECT * FROM level_format WHERE rule_set_id = ? AND constitution = ?').all(defaultRs, constitution)
  const rowOf = (name) => db.prepare('SELECT * FROM mapped_tb WHERE id = ?').get(ids[name])

  r = await save('Zq Level5 Ledger', lf5, { level6_value: options(lf5.level6 || '')[0] || null })
  check('T-040 saving a ledger with a blank Level 5 option succeeds (status user_override)', r.ok && rowOf('Zq Level5 Ledger').status === 'user_override', r)
  check('T-040 a saved ledger whose Level 5 option is still blank stays in the queue', (await queued()).has('Zq Level5 Ledger'))
  check('T-040 the queue and the Fix rule agree that Level 5 is still needed', ledgerNeeds(lfRows, rowOf('Zq Level5 Ledger')).some(n => n.what === 'Mapping 5'))
  r = await save('Zq Level5 Ledger', lf5, { level5_value: 'Zq not an option', level6_value: options(lf5.level6 || '')[0] || null })
  check('T-040 a Level 5 value that is not one of the options stays in the queue', r.ok && (await queued()).has('Zq Level5 Ledger'), r)
  r = await save('Zq Level5 Ledger', lf5, { level5_value: options(lf5.level5)[0], level6_value: options(lf5.level6 || '')[0] || null })
  check('T-040 choosing a Level 5 option takes the ledger out of the queue', r.ok && !(await queued()).has('Zq Level5 Ledger'), r)

  if (lf6) {
    r = await save('Zq Level6 Ledger', lf6, { level5_value: options(lf6.level5 || '')[0] || null })
    check('T-040 a saved ledger whose Level 6 option is blank stays in the queue', r.ok && (await queued()).has('Zq Level6 Ledger'), r)
    r = await save('Zq Level6 Ledger', lf6, { level5_value: options(lf6.level5 || '')[0] || null, level6_value: options(lf6.level6)[0] })
    check('T-040 choosing a Level 6 option takes the ledger out of the queue', r.ok && !(await queued()).has('Zq Level6 Ledger'), r)
  }

  r = await staff('mappedTB:override', ids['Zq Sale Ledger'], { mapping1_resultant: sale.level1, mapping2_resultant: sale.level2,
    mapping3_resultant: null, level_format_id: sale.id, override_note: 'T-040' })
  check('T-040 a sales ledger not split into Products / Services stays in the queue', r.ok && (await queued()).has('Zq Sale Ledger'), r)
  check('T-040 the Fix rule also asks to bifurcate that sales ledger', ledgerNeeds(lfRows, rowOf('Zq Sale Ledger')).some(n => n.what === 'Mapping 3'))
  const goods = db.prepare(`SELECT * FROM level_format WHERE rule_set_id = ? AND constitution = ? AND level1 = ? AND level2 = ?
    AND LOWER(level3) IN ('sale of products', 'sale of goods') ORDER BY id LIMIT 1`).get(defaultRs, constitution, sale.level1, sale.level2)
  if (goods) {
    r = await staff('mappedTB:override', ids['Zq Sale Ledger'], { mapping1_resultant: goods.level1, mapping2_resultant: goods.level2,
      mapping3_resultant: goods.level3, level_format_id: goods.id,
      level4_value: options(goods.level4 || '')[0] || null, level5_value: options(goods.level5 || '')[0] || null,
      level6_value: options(goods.level6 || '')[0] || null, override_note: 'T-040' })
    check('T-040 a sales ledger split into Sale of Products leaves the queue', r.ok && !(await queued()).has('Zq Sale Ledger'), r)
  }
  r = await staff('tb:delete', tbId)
  check('T-040 synthetic trial balance removed', r.ok, r)
}
