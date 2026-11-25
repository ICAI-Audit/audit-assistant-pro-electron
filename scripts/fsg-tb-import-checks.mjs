// T-037 synthetic checks, called by test-fsg-integration.mjs. No live profile, no Tally.
// The Excel TB upload keeps Group.$Parent.8 (ninth group level) and the
// TrialBalance column; ALIE comes from TrialBalance, or else from Tally's
// IsRevenue + IsDeemedPositive flags; the live Tally reader keeps IsRevenue
// and a ten-level group chain.
import { dialog } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseTallyMasterXml } from '../electron/fsg/services/tally-odbc.js'
import { buildTBRowsFromTally } from '../src/modules/fsg/utils/tallyParsers.js'
const require = createRequire(import.meta.url)

export async function checkTbImport({ db, root, userData, check, staff, entityId, periodId, defaultRs }) {
  const XLSX = require(join(root, 'node_modules', 'xlsx'))
  const levels = ['Parent', 'Group.$Parent', ...Array.from({ length: 8 }, (_, i) => `Group.$Parent.${i + 1}`)]
  const header = ['Name', 'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance', 'IsRevenue', 'IsDeemedPositive', 'TrialBalance', ...levels]
  // Group names deliberately match no mapping rule, so ALIE can only come from the source columns.
  const deepChain = ['Zq Deposit L0', 'Zq L1', 'Zq L2', 'Zq L3', 'Zq L4', 'Zq L5', 'Zq L6', 'Zq L7', 'Zq Top Group', 'Primary']
  const rows = [
    ['Zq Deep Deposit', 0, 5000, 0, -5000, 'No', 'Yes', '', ...deepChain],
    ['Zq Flag Liability', 0, 0, 4000, 4000, 'No', 'No', '', 'Zq Owed', 'Zq Owed Top', 'Primary'],
    ['Zq Flag Expense', 0, 3000, 0, -3000, 'Yes', 'Yes', '', 'Zq Spend', 'Zq Spend Top', 'Primary'],
    ['Zq Typed Income', 0, 0, 4000, 4000, '', '', 'Income', 'Zq Earn', 'Zq Earn Top', 'Primary'],
    ['Zq Unknown Nature', 0, 0, 0, 0, '', '', '', 'Zq Odd', 'Zq Odd Top', 'Primary'],
  ]
  const file = join(userData, 't037-tb.xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'TB')
  XLSX.writeFile(wb, file)

  // Stand in for the native file dialog so the path guard records this file as chosen.
  const original = dialog.showOpenDialog
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  let r
  try {
    r = await staff('dialog:openFile', {})
    r = await staff('tb:upload', { entityId, entityPeriodId: periodId, filePath: file, period: '2024-25' })
  } finally {
    dialog.showOpenDialog = original
  }
  check('T-037 Excel trial balance upload succeeds', r.ok, r)
  if (!r.ok) return
  const tbId = r.result.tb?.id ?? r.result.id
  const saved = Object.fromEntries(db.prepare('SELECT * FROM tb_rows WHERE tb_id = ?').all(tbId).map(x => [x.name, x]))
  check('T-037 Excel upload keeps the ninth group level (Group.$Parent.8)', saved['Zq Deep Deposit']?.group_parent_8 === 'Primary' && saved['Zq Deep Deposit']?.group_parent_7 === 'Zq Top Group', saved['Zq Deep Deposit'])
  check('T-037 Excel upload keeps the TrialBalance column', saved['Zq Typed Income']?.trial_balance_type === 'Income', saved['Zq Typed Income'])
  check('T-037 Excel upload keeps signs and amounts', saved['Zq Deep Deposit']?.closing_balance === -5000 && saved['Zq Flag Liability']?.closing_balance === 4000)

  r = await staff('mappedTB:run', tbId, defaultRs, {})
  check('T-037 mapping runs on the Excel trial balance', r.ok, r)
  const alie = Object.fromEntries(db.prepare(`SELECT tr.name, mt.alie FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = ?`).all(tbId).map(x => [x.name, x.alie]))
  check('T-037 ALIE from IsRevenue No + IsDeemedPositive Yes is ASSETS (ten-level chain found Primary)', alie['Zq Deep Deposit'] === 'ASSETS', alie)
  check('T-037 ALIE from IsRevenue No + IsDeemedPositive No is EQUITY AND LIABILITIES', alie['Zq Flag Liability'] === 'EQUITY AND LIABILITIES', alie)
  check('T-037 ALIE from IsRevenue Yes + IsDeemedPositive Yes is Expenses', alie['Zq Flag Expense'] === 'Expenses', alie)
  check('T-037 TrialBalance column still decides ALIE when present', alie['Zq Typed Income'] === 'Income', alie)
  check('T-037 ALIE is not guessed when neither the column nor the flags are known', !alie['Zq Unknown Nature'], alie)
  r = await staff('tb:delete', tbId)
  check('T-037 synthetic Excel trial balance removed', r.ok, r)

  // Live Tally reader: IsRevenue is inherited through groups like IsDeemedPositive.
  const groups = [['Zq Top Group', 'Primary', 'No', 'Yes'], ...deepChain.slice(0, 8).map((g, i) => [g, i === 7 ? 'Zq Top Group' : deepChain[i + 1], '', '']),
    ['Zq Sales Top', 'Primary', 'Yes', 'No'], ['Zq Sales', 'Zq Sales Top', '', '']]
  const xml = '<ENVELOPE>' + groups.map(([n, p, rev, dp]) => `<GROUP NAME="${n}"><PARENT>${p}</PARENT>${rev ? `<ISREVENUE>${rev}</ISREVENUE>` : ''}${dp ? `<ISDEEMEDPOSITIVE>${dp}</ISDEEMEDPOSITIVE>` : ''}</GROUP>`).join('')
    + '<LEDGER NAME="Zq Deep Deposit"><PARENT>Zq Deposit L0</PARENT></LEDGER><LEDGER NAME="Zq Sale Ledger"><PARENT>Zq Sales</PARENT></LEDGER></ENVELOPE>'
  const { ledgerMap } = parseTallyMasterXml(xml)
  check('T-037 live Tally master gives IsRevenue through the group chain', ledgerMap['zq deep deposit']?.isRevenue === false && ledgerMap['zq sale ledger']?.isRevenue === true && ledgerMap['zq sale ledger']?.isDeemedPositive === false, ledgerMap)
  const built = buildTBRowsFromTally([
    { name: 'Zq Deep Deposit', opening_dr: 0, opening_cr: 0, debit: 5000, credit: 0, closing_dr: 5000, closing_cr: 0 },
    { name: 'Zq Sale Ledger', opening_dr: 0, opening_cr: 0, debit: 0, credit: 900, closing_dr: 0, closing_cr: 900 },
    { name: 'Zq Not In Master', opening_dr: 0, opening_cr: 0, debit: 10, credit: 0, closing_dr: 10, closing_cr: 0 },
  ], ledgerMap)
  const deep = built[0]
  check('T-037 live Tally rows keep a ten-level chain with the top group in Group.$Parent.8',
    deep.parent === 'Zq Deposit L0' && deep.group_parent_6 === 'Zq L7' && deep.group_parent_7 === 'Zq Top Group' && deep.group_parent_8 === 'Primary', deep)
  check('T-037 live Tally rows carry IsRevenue from the master', deep.is_revenue === false && built[1].is_revenue === true, built.map(b => [b.name, b.is_revenue]))
  check('T-037 live Tally rows leave IsRevenue unknown when the master has no nature', built[2].is_revenue === null, built[2])
  const short = buildTBRowsFromTally([{ name: 'Zq Sale Ledger', opening_dr: 0, opening_cr: 0, debit: 0, credit: 900, closing_dr: 0, closing_cr: 900 }], ledgerMap)[0]
  check('T-037 short Tally chains keep their previous layout', short.group_parent_7 === 'Primary' && short.group_parent_8 === '', short)
}
