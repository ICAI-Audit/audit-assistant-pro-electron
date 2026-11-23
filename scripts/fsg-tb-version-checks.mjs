// T-069 to T-074 synthetic checks, called by test-fsg-integration.mjs. No live
// profile and no Tally connection: the Tally period logic is checked through
// its pure functions and the refusal paths that run before any request.
//   T-070  Tally import by period (dates compulsory, opening by period, books)
//   T-071  at most three versions (_v1 to _v3) per financial year and branch
//   T-072  carry the learned ledger rules to a new version, or not
//   T-073  the simple Excel format (Trial Balance and Groups in one workbook)
//   T-074  the manual ODBC-format upload is withdrawn from the format chooser
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as XLSX from 'xlsx'

export async function checkTbVersions({ db, root, check, staff, partner, entityId, defaultRs }) {
  const mod = (...p) => import(pathToFileURL(join(root, ...p)).href)
  const { periodiseTallyRows, parseCompanyBooks, tallyDate, parseTallyDate, dayBefore } = await mod('electron', 'fsg', 'services', 'tally-odbc.js')
  const { checkImportPeriod } = await mod('electron', 'fsg', 'ipc', 'tb.js')
  const { ensureTbVersionColumns } = await mod('electron', 'fsg', 'db', 'schema.js')
  const simple = await mod('src', 'modules', 'fsg', 'utils', 'simpleTbFormat.js')
  const { buildTBRowsFromTally } = await mod('src', 'modules', 'fsg', 'utils', 'tallyParsers.js')

  // The earlier year (2023-24), on a branch of its own: the earlier checks'
  // Trial Balances (some inserted straight into the database) do not count.
  const pid = db.prepare(`SELECT ep.id FROM entity_periods ep JOIN financial_periods fp ON fp.id = ep.financial_period_id
                          WHERE ep.entity_id = ? AND fp.year_label = '2023-24'`).get(entityId)?.id
  check('T-071 a second financial year is available for the version checks', !!pid)
  const rowsOf = (tag) => [
    { name: `Zv Capital ${tag}`, opening_balance: 0, debit: 0, credit: 1000, closing_balance: 1000, parent: 'Capital Account', group_parent: 'Capital Account' },
    { name: `Zv Bank ${tag}`, opening_balance: 0, debit: 1000, credit: 0, closing_balance: -1000, parent: 'Bank Accounts', group_parent: 'Current Assets' },
  ]
  const B = 'Zv Versions'
  const upload = (fileName, extra = {}) => staff('tb:uploadRealBooks', { entityId, entityPeriodId: pid, fileName, tbRows: rowsOf(fileName), branchName: B, ...extra })

  // ── T-071 versions ───────────────────────────────────────────────────────
  let r = await staff('tb:versionStatus', { entityPeriodId: pid, branchName: B })
  check('T-071 an empty year offers version 1', r.ok && r.result.next === 1 && !r.result.full && r.result.limit === 3, r)
  const made = []
  for (const name of ['zv-a.xlsx', 'zv-b.xlsx', 'zv-c.xlsx']) { r = await upload(name); made.push(r.ok ? r.result.tb : null) }
  check('T-071 three uploads of one year become _v1, _v2, _v3', made.map(t => t?.tb_version).join(',') === '1,2,3', made)
  r = await staff('tb:versionStatus', { entityPeriodId: pid, branchName: B })
  check('T-071 after three versions the year is full and the message gives the way out', r.ok && r.result.full && r.result.next === null
    && /\(branch Zv Versions\) already has 3 Trial Balances: _v1 \(zv-a\.xlsx\), _v2 \(zv-b\.xlsx\), _v3 \(zv-c\.xlsx\)/.test(r.result.message) && /Delete TB/.test(r.result.message), r)
  r = await upload('zv-d.xlsx')
  check('T-071 a fourth upload of the same year is refused, nothing saved', r.ok === false && /Only 3 versions are kept/.test(r.error)
    && !db.prepare(`SELECT 1 FROM trial_balances WHERE filename = 'zv-d.xlsx'`).get(), r)
  r = await upload('zv-branch.xlsx', { branchName: 'Zv Pune' })
  check('T-071 the limit counts per branch: another branch starts at _v1', r.ok && r.result.tb.tb_version === 1 && r.result.tb.branch_name === 'Zv Pune', r)
  r = await staff('tb:delete', made[1].id)
  r = await upload('zv-e.xlsx')
  check('T-071 after deleting _v2, the next upload takes the freed _v2', r.ok && r.result.tb.tb_version === 2, r)
  const vE = r.ok ? r.result.tb : null
  r = await staff('tally:fetchTB', {})
  check('T-070 a Tally import without dates is refused before Tally is asked', r.ok === false && /Enter both the From date and the To date/.test(r.error), r)

  // Locked year: no upload until it is unlocked.
  r = await staff('tb:delete', made[2].id)   // make room, so only the lock can refuse
  await staff('entityPeriod:lock', pid)
  r = await staff('tb:versionStatus', { entityPeriodId: pid, branchName: B })
  check('T-071 a locked year reports locked', r.ok && r.result.locked === true, r)
  r = await upload('zv-locked.xlsx')
  check('T-071 no upload into a locked year', r.ok === false && /locked/i.test(r.error || ''), r)
  await partner('entityPeriod:unlock', pid)
  r = await upload('zv-unlocked.xlsx')
  check('T-071 after unlocking, the upload goes ahead', r.ok && r.result.tb.tb_version === 3, r)

  // Upgrade of an installed database: Trial Balances without a number get one,
  // after the highest number already used; numbered ones keep theirs.
  const cols = db.prepare('PRAGMA table_info(trial_balances)').all().map(c => c.name)
  check('T-071/T-072 trial_balances has tb_version and carry_rules', cols.includes('tb_version') && cols.includes('carry_rules'), cols)
  db.prepare('UPDATE trial_balances SET tb_version = NULL WHERE id = ?').run(vE.id)
  await ensureTbVersionColumns()
  const after = db.prepare('SELECT id, tb_version FROM trial_balances WHERE entity_period_id = ? AND branch_name = ? ORDER BY id').all(pid, B)
  check('T-071 the upgrade numbers an unnumbered Trial Balance after the highest, and keeps the others',
    after.find(t => t.id === made[0].id)?.tb_version === 1 && after.find(t => t.id === vE.id)?.tb_version === 4, after)
  db.prepare('UPDATE trial_balances SET tb_version = 2 WHERE id = ?').run(vE.id)
  await ensureTbVersionColumns()
  check('T-071 the upgrade is idempotent', db.prepare('SELECT tb_version FROM trial_balances WHERE id = ?').get(vE.id).tb_version === 2)

  // ── T-072 learned ledger rules: carried, or not ──────────────────────────
  db.prepare(`INSERT INTO learned_ledger_rules (entity_id, ledger_name_key, ledger_name, mapping1_resultant, mapping2_resultant, alie)
              VALUES (?, 'zv rules ledger', 'Zv Rules Ledger', 'Other expenses', 'Zv Learned Line', 'Expenses')
              ON CONFLICT(entity_id, ledger_name_key) DO UPDATE SET mapping2_resultant = excluded.mapping2_resultant`).run(entityId)
  r = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: pid, fileName: 'zv-rules.xlsx', branchName: 'Zv Rules', tbRows: [
    { name: 'Zv Rules Ledger', opening_balance: 0, debit: 500, credit: 0, closing_balance: -500, parent: 'Indirect Expenses', group_parent: 'Indirect Expenses' },
    { name: 'Zv Rules Capital', opening_balance: 0, debit: 0, credit: 500, closing_balance: 500, parent: 'Capital Account', group_parent: 'Capital Account' }] })
  const rulesTb = r.ok ? r.result.tb.id : null
  const line = () => db.prepare(`SELECT mt.mapping2_resultant AS m2 FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = ? AND tr.name = 'Zv Rules Ledger'`).get(rulesTb)?.m2
  r = await staff('mappedTB:run', rulesTb, defaultRs, { carryRules: false })
  check('T-072 "No": the learned rule is not applied to the new version', r.ok && r.result.carryRules === false && line() !== 'Zv Learned Line', { r, m2: line() })
  check('T-072 the "No" is kept on the Trial Balance', db.prepare('SELECT carry_rules FROM trial_balances WHERE id = ?').get(rulesTb)?.carry_rules === 0)
  r = await staff('mappedTB:run', rulesTb, defaultRs, {})
  check('T-072 a later re-run honours the kept "No"', r.ok && r.result.carryRules === false && line() !== 'Zv Learned Line', { r, m2: line() })
  r = await staff('mappedTB:run', rulesTb, defaultRs, { carryRules: true })
  check('T-072 "Yes": the learned rule is applied, as before T-072', r.ok && r.result.carryRules === true && line() === 'Zv Learned Line', { r, m2: line() })

  // ── T-070 Tally period logic (pure) ──────────────────────────────────────
  check('T-070 dates go to Tally as YYYYMMDD and come back as YYYY-MM-DD',
    tallyDate('2024-04-01') === '20240401' && parseTallyDate('20230401') === '2023-04-01' && parseTallyDate('1-Apr-2023') === '2023-04-01' && parseTallyDate('') === null)
  check('T-070 the day before the period, across a leap day', dayBefore('2024-04-01') === '2024-03-31' && dayBefore('2024-03-01') === '2024-02-29')
  let threw = ''
  try { checkImportPeriod({ from: '2025-03-31', to: '2024-04-01' }) } catch (e) { threw = e.message }
  check('T-070 a From date after the To date is refused', /is after the To date/.test(threw), threw)
  const books = parseCompanyBooks('<ENVELOPE><COMPANY NAME="Zv One"><BOOKSFROM>20230401</BOOKSFROM></COMPANY><COMPANY NAME="Zv Two"><BOOKSFROM>20250401</BOOKSFROM></COMPANY></ENVELOPE>', 'Zv Two')
  check('T-070 the books-beginning date of the chosen company is read', books.name === 'Zv Two' && books.booksFrom === '2025-04-01', books)

  const A = (name, closing, debit, credit) => ({ name, closing_net: closing, debit, credit, opening_net: 0 })
  const res = periodiseTallyRows([
    A('Zv Bank', 150, 100, 50),          // Tally gave the period's totals
    A('Zv Debtor', 150, 300, 150),       // Tally gave totals from the books' start
    A('Zv Sales Reset', -500, 0, 500),   // income Tally already started afresh
    A('Zv Sales Carried', -1300, 0, 500),// income Tally carried over: keep the year only
    A('Zv Odd', 999, 10, 0),             // fits no reading
  ], [
    { name: 'Zv Bank', closing_net: 100, debit: 0, credit: 0 },
    { name: 'Zv Debtor', closing_net: 100, debit: 200, credit: 100 },
    { name: 'Zv Sales Reset', closing_net: -800, debit: 0, credit: 800 },
    { name: 'Zv Sales Carried', closing_net: -800, debit: 0, credit: 800 },
    { name: 'Zv Odd', closing_net: 5, debit: 0, credit: 0 },
  ], { 'zv sales reset': { isRevenue: true }, 'zv sales carried': { isRevenue: true } })
  const by = Object.fromEntries(res.rows.map(x => [x.name, x]))
  check('T-070 period totals: opening is the balance on the day before', by['Zv Bank'].opening_net === 100 && by['Zv Bank'].debit === 100 && by['Zv Bank'].closing_net === 150, by['Zv Bank'])
  check('T-070 totals from the books\' start: the period\'s totals are worked out', by['Zv Debtor'].opening_net === 100 && by['Zv Debtor'].debit === 100 && by['Zv Debtor'].credit === 50, by['Zv Debtor'])
  check('T-070 an income ledger starts the year at nil', by['Zv Sales Reset'].opening_net === 0 && by['Zv Sales Reset'].closing_net === -500
    && by['Zv Sales Carried'].opening_net === 0 && by['Zv Sales Carried'].closing_net === -500, [by['Zv Sales Reset'], by['Zv Sales Carried']])
  check('T-070 a ledger that fits no reading is reported, not hidden', res.report.unmatched === 1 && res.report.unmatchedNames[0] === 'Zv Odd', res.report)
  check('T-070 Dr / Cr columns follow the net figures', by['Zv Sales Carried'].closing_cr === 500 && by['Zv Sales Carried'].closing_dr === 0 && by['Zv Bank'].opening_dr === 100)

  // ── T-073 simple Excel format ────────────────────────────────────────────
  const book = (tbAoa, groupsAoa) => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tbAoa), simple.SIMPLE_TB_SHEET)
    if (groupsAoa) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(groupsAoa), simple.SIMPLE_GROUPS_SHEET)
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  }
  const H = simple.SIMPLE_TB_HEADERS
  const good = simple.parseSimpleTbWorkbook(book([H,
    ['Zs Capital', 'Capital Account', '', 100000, '', '', '', ''],
    ['Zs HDFC Bank', 'Zs Banks', '', '', 100000, '', '', ''],
    ['Zs Sales', 'Sales Accounts', '', '', '', '5,000', '', 5000],
    ['Zs Rent', 'Zs Office Costs', '', '', 5000, '', 5000, ''],
  ], [simple.SIMPLE_GROUP_HEADERS, ['Zs Banks', 'Bank Accounts', ''], ['Zs Office Costs', '', 'Expense']]))
  check('T-073 a filled workbook reads with no errors and tallies', good.errors.length === 0 && good.ledgerCount === 4 && Math.abs(good.totals.closingNet) < 1, good.errors)
  const bank = good.ledgerMap['zs hdfc bank'], sales = good.ledgerMap['zs sales'], rent = good.ledgerMap['zs rent']
  check('T-073 the group chain is built through the Groups sheet and Tally\'s standard groups', bank?.hierarchy.join(' > ') === 'Zs Banks > Bank Accounts > Current Assets' && bank.isDeemedPositive === true && bank.isRevenue === false, bank)
  check('T-073 nature comes from the top group: Sales is Income, a new top group with its own Nature works', sales?.isRevenue === true && sales.isDeemedPositive === false && rent?.isRevenue === true && rent.isDeemedPositive === true, { sales, rent })
  check('T-073 a blank closing is worked out as opening + debit - credit', good.rows.find(x => x.name === 'Zs HDFC Bank')?.closing_dr === 100000)
  const built = buildTBRowsFromTally(good.rows, good.ledgerMap)
  r = await staff('tb:uploadTally', { entityId, entityPeriodId: pid, branchName: 'Zv Simple', fileName: 'zs-simple.xlsx', tbRows: built })
  const saved = r.ok ? db.prepare('SELECT name, closing_balance, parent, group_parent, is_deemed_positive FROM tb_rows WHERE tb_id = ? ORDER BY id').all(r.result.tb.id) : []
  check('T-073 the simple workbook uploads with the app\'s signs (Cr +, Dr -) and groups', r.ok
    && saved.find(x => x.name === 'Zs Capital')?.closing_balance === 100000 && saved.find(x => x.name === 'Zs HDFC Bank')?.closing_balance === -100000
    && saved.find(x => x.name === 'Zs HDFC Bank')?.parent === 'Zs Banks', r.ok ? saved : r)
  const bad = simple.parseSimpleTbWorkbook(book([H,
    ['Zs One', 'Zs Mystery Group', 10, '', '', '', '', ''],
    ['Zs One', 'Capital Account', '', 10, '', '', '', ''],
    ['Zs Two', '', '', '', '', '', '', ''],
    ['Zs Three', 'Capital Account', 'abc', '', '', '', '', ''],
  ], [simple.SIMPLE_GROUP_HEADERS]))
  check('T-073 errors name the fix: unknown nature, ledger twice, missing group, bad amount',
    bad.errors.some(e => /nature of "Zs Mystery Group" is not known/.test(e)) && bad.errors.some(e => /already on row 2/.test(e))
    && bad.errors.some(e => /needs an "Under Group"/.test(e)) && bad.errors.some(e => /not amounts: row 5 Opening Dr/.test(e)), bad.errors)
  const tpl = XLSX.read(XLSX.write(simple.buildSimpleTbTemplate(), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
  const tplHead = XLSX.utils.sheet_to_json(tpl.Sheets[simple.SIMPLE_TB_SHEET], { header: 1 })[0]
  const tplGroups = XLSX.utils.sheet_to_json(tpl.Sheets[simple.SIMPLE_GROUPS_SHEET], { header: 1 })
  check('T-073 the blank format has both sheets, the headings, and Tally\'s standard groups with their nature',
    tplHead.join('|') === H.join('|') && tplGroups.some(g => g[0] === 'Sundry Debtors' && g[1] === 'Current Assets') && tplGroups.some(g => g[0] === 'Sales Accounts' && g[2] === 'Income'))

  // ── T-074 the ODBC-format upload is withdrawn; the simple format is first ─
  const ui = readFileSync(join(root, 'src', 'modules', 'fsg', 'components', 'TrialBalance', 'UploadTB.jsx'), 'utf8')
  check('T-074 the format chooser no longer offers the ODBC format; the simple format comes first',
    !ui.includes("onChoose('odbc')") && ui.indexOf("onChoose('simple')") > 0 && ui.indexOf("onChoose('simple')") < ui.indexOf("onChoose('tally')"))
}
