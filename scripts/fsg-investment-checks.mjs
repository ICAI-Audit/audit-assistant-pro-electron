import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { investmentKind, investmentGroups, investmentLedgerKey, prepareInvestmentDetails, investmentIssues, investmentTables, investmentPeriodRows } from '../src/modules/fsg/utils/investments.js'
import { investmentToRows, investmentFromRows } from '../src/modules/fsg/utils/investmentWorkbook.js'
const require = createRequire(import.meta.url)
export async function checkInvestments({ db, root, userData, check, staff, partner, entityId, periodId, defaultRs, renderPdf }) {
  const tb = db.prepare('INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (?,?,?) RETURNING *').get(entityId, periodId, '2024-25')
  const fixtures = [
    ['Listed equity ledger', 'Non-current investments', 'Investments in Equity Instruments', -100000],
    ['Firm capital ledger', 'Non-current investments', 'Investments in partnership firms', -50000],
    ['Debenture ledger', 'Non-current investments', 'Investments in debentures or bonds', -20000],
    ['Mutual fund ledger', 'Current investments', 'Investments in Mutual Funds', -30000],
  ]
  for (const [name, l2, l3, balance] of fixtures) {
    const tr = db.prepare('INSERT INTO tb_rows (tb_id,name,closing_balance,opening_balance,imported_closing_balance) VALUES (?,?,?,?,?) RETURNING id').get(tb.id, name, balance, balance / 2, balance)
    db.prepare(`INSERT INTO mapped_tb (tb_id,tb_row_id,rule_set_id,alie,mapping1_resultant,mapping2_resultant,mapping3_resultant,status) VALUES (?,?,?,'ASSETS',?,?,?,'user_override')`).run(tb.id, tr.id, defaultRs, l2.startsWith('Non') ? 'Non-current assets' : 'Current assets', l2, l3)
  }
  const scope = { entityPeriodId: periodId, tbId: tb.id }
  const fr = await staff('financials:getData', tb.id)
  const rows = fr.result.filter(r => investmentKind(r.level2) === 'noncurrent').sort((a, b) => fixtures.findIndex(f => f[0] === a.name) - fixtures.findIndex(f => f[0] === b.name))
  check('T-025 each mapped investment subclass has only its own ledger candidates', investmentGroups(rows).length === 3 && investmentGroups(rows).every(g => g.ledgers.length === 1))
  const d = prepareInvestmentDetails(null, rows)
  for (const e of d.entries) Object.assign(e, { companyName: `Printed ${e.ledgerName}`, relationship: 'None', trade: 'Trade investments', quotation: 'Unquoted', valuation: 'At cost', diminutionCY: 0, diminutionPY: 0 })
  Object.assign(d.entries[0], { quotation: 'Quoted', marketCY: 120000, marketPY: 55000, quantityCY: 1000, quantityPY: 500, faceValue: 10, paidStatus: 'Partly paid', paidPerUnit: 6, uncalled: 4000 })
  Object.assign(d.entries[1], { firmCapitalCY: 100000, firmCapitalPY: 50000, companyCapitalCY: 50000, companyCapitalPY: 25000, firmDate: '2025-03-31', capitalBasis: 'Capital accounts only', partners: [
    { name: 'Investing company', capitalCY: 50000, capitalPY: 25000, profitShareCY: 50, profitSharePY: 50 },
    { name: 'Other partner', capitalCY: 50000, capitalPY: 25000, profitShareCY: 50, profitSharePY: 50 },
  ] })
  Object.assign(d.entries[2], { quantityCY: 20, quantityPY: 10, faceValue: 1000, paidStatus: 'Fully paid' })
  check('T-025 complete equity, debenture and partnership fixture reconciles CY and PY', investmentIssues(d, rows, 'noncurrent').length === 0, investmentIssues(d, rows, 'noncurrent'))
  let r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: d })
  check('T-025 year-scoped investment details save through authorised IPC', r.ok, r)
  r = await staff('investments:list', scope)
  check('T-025 save/reopen preserves partly paid shares, partnership partners and values', r.ok && JSON.stringify(r.result.noncurrent) === JSON.stringify(d), r)
  const bad = structuredClone(d); bad.entries[0].ledgerKey = d.entries[1].ledgerKey
  r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: bad })
  check('T-025 main process rejects a ledger from a different sub-classification', !r.ok && /sub-classification/.test(r.error), r)
  bad.entries[0].ledgerKey = '999999:999999'
  r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: bad })
  check('T-025 main process rejects forged/out-of-year ledger identity', !r.ok, r)
  const fractional = structuredClone(d); fractional.entries[0].quantityCY = 1.5
  r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: fractional })
  check('T-025 fractional share counts are rejected', !r.ok && /whole numbers/.test(r.error), r)
  const numeric = structuredClone(d); numeric.entries[1].partners[0].profitShareCY = 'NaN'
  r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: numeric })
  check('T-025 invalid partner numbers are rejected', !r.ok && /partner/.test(r.error), r)
  const mismatch = structuredClone(d); mismatch.entries[1].partners[0].profitShareCY = 40; mismatch.entries[0].amountCY = 99999
  const issues = investmentIssues(mismatch, rows, 'noncurrent')
  check('T-025 ledger allocation and partnership profit-share mismatches remain visible', issues.some(s => /reconcile/.test(s)) && issues.some(s => /100%/.test(s)))
  const changedMapping = [{ ...rows[0], level3: 'New classification' }, ...rows.slice(1)]
  check('T-025 changed mapping retains old details with an explicit review warning', investmentIssues(d, changedMapping, 'noncurrent').some(s => /no longer belongs/.test(s)))
  d.categories.push('Custom instrument')
  const round = investmentFromRows(investmentToRows(d))
  check('T-025 Fill Details workbook round-trips every field, custom category and all partners', d.entries.every((e, i) => Object.keys(e).every(k => JSON.stringify(round.entries[i][k]) === JSON.stringify(e[k]))) && round.categories[0] === 'Custom instrument', round)
  const currentRows = fr.result.filter(r => investmentKind(r.level2) === 'current')
  const current = prepareInvestmentDetails(null, currentRows)
  Object.assign(current.entries[0], { companyName: 'Printed mutual fund', category: 'Mutual fund units', relationship: 'None', quotation: 'Unquoted', valuation: 'Lower of cost and fair value', trade: 'Trade investments' })
  r = await staff('investments:save', { ...scope, noteTitle: 'Current investments', data: current })
  const curSaved = await staff('investments:list', scope)
  check('T-025 current investments strip trade classification and print no trade split', r.ok && curSaved.result.current.entries[0].trade === '' && !investmentTables(current, 'current').some(t => /Trade investments/.test(t.title)))
  const consolidated = { entityPeriodId: periodId, tbId: null }
  r = await staff('investments:save', { ...consolidated, noteTitle: 'Non-current investments', data: d })
  check('T-025 consolidated investments save independently of branch details', r.ok && (await staff('investments:list', scope)).result.noncurrent.categories.length === 0, r)
  const priorId = db.prepare('SELECT id FROM entity_periods WHERE entity_id=? AND id<>?').get(entityId, periodId).id
  r = await partner('investments:list', { entityPeriodId: priorId })
  check('T-025 another financial year does not inherit consolidated investment details', r.ok && !r.result.noncurrent, r)
  const pyTB = db.prepare('INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (?,?,?) RETURNING *').get(entityId, priorId, '2023-24')
  const pyLedger = db.prepare('INSERT INTO tb_rows (tb_id,name,closing_balance) VALUES (?,?,?) RETURNING id').get(pyTB.id, 'Disposed PY investment', -1234)
  db.prepare(`INSERT INTO mapped_tb (tb_id,tb_row_id,rule_set_id,alie,mapping1_resultant,mapping2_resultant,mapping3_resultant,status) VALUES (?,?,?,'ASSETS','Non-current assets','Non-current investments','Investments in Equity Instruments','user_override')`).run(pyTB.id, pyLedger.id, defaultRs)
  const pyRows = (await partner('financials:getData', pyTB.id)).result
  const periodRows = investmentPeriodRows({ title: 'Non-current investments', rows }, pyRows)
  check('T-025 separate comparative TB preserves disposed PY-only ledger identity and closing value', periodRows.some(p => p.investmentPYOnly && p.tb_row_id === pyLedger.id && p.closing_balance === 0 && p.opening_balance === -1234))
  const pyData = prepareInvestmentDetails(null, periodRows)
  pyData.pyTBIds = [pyTB.id]
  r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: pyData })
  check('T-025 main process accepts the same-client immediately preceding-year investment ledger', r.ok, r)
  r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: { ...pyData, pyTBIds: [tb.id] } })
  check('T-025 forged comparative source from the current financial year is rejected', !r.ok && /immediately previous/.test(r.error), r)
  await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: d })
  r = await staff('investments:list', { entityPeriodId: priorId, tbId: tb.id })
  check('T-025 mixed-year period/TB request is rejected', !r.ok, r)
  const other = await partner('context:open', 'e2')
  r = await staff('investments:list', { entityPeriodId: other.result.entityPeriodId })
  check('T-025 investment reads outside assigned client are denied', !r.ok && r.denied, r)
  await staff('entityPeriod:lock', periodId)
  r = await staff('investments:save', { ...scope, noteTitle: 'Non-current investments', data: d })
  check('T-025 direct investment IPC cannot edit a locked year', !r.ok && /locked/.test(r.error), r)
  r = await staff('noteDetails:save', { tbId: tb.id, noteNum: -3000000 - periodId * 2, noteTitle: `Investment disclosure FY ${periodId} noncurrent`, data: d })
  check('T-025 generic note save cannot bypass investment lock/validation', !r.ok && /year-scoped/.test(r.error), r)
  await partner('entityPeriod:unlock', periodId)
  const bundled = require('esbuild').buildSync({ stdin: { contents: `
    export { processRows } from './src/modules/fsg/hooks/useFinancials.js';
    export { buildFinancialsHTML } from './src/modules/fsg/components/GenerateFinancials/buildHTML.js';
    export { buildFinancialsWorkbook } from './src/modules/fsg/components/GenerateFinancials/buildExcel.js';
    export { buildFillDetailsWorkbook, parseFillDetailsWorkbook } from './src/modules/fsg/components/GenerateFinancials/fillDetailsWorkbook.js';`, resolveDir: root }, absWorkingDir: root, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const rendererPath = join(userData, 'investment-renderer.cjs'); writeFileSync(rendererPath, bundled.outputFiles[0].contents)
  const renderer = require(rendererPath), XLSX = require('xlsx-js-style')
  const lf = db.prepare('SELECT * FROM level_format WHERE rule_set_id=? AND constitution=3').all(defaultRs)
  const processed = renderer.processRows(fr.result, null, 3, [], null, false, false, null, lf)
  processed.levelFormat = lf; processed.generalNotes = { points: [] }
  for (const note of Object.values(processed.notes)) if (investmentKind(note.title)) {
    note.investmentDetails = investmentKind(note.title) === 'current' ? curSaved.result.current : d
    note.investmentIssues = []
  }
  const entity = db.prepare('SELECT * FROM entities WHERE id=?').get(entityId)
  const opts = { entity, activeTB: tb, data: processed, levelFormat: lf, signatories: [], signPlace: 'Synthetic place', signDate: '2026-11-11', denomination: 'lakhs' }
  const html = renderer.buildFinancialsHTML(opts)
  const escaped = renderer.buildFinancialsHTML({ ...opts, data: { ...processed, notes: Object.fromEntries(Object.entries(processed.notes).map(([k, note]) => [k, note.investmentDetails ? { ...note, investmentDetails: { ...note.investmentDetails, entries: note.investmentDetails.entries.map(e => ({ ...e, companyName: '<script>unsafe</script>' })) } } : note])), activeNotes: null } })
  check('T-025 investee names are escaped in PDF source', escaped.includes('&lt;script&gt;unsafe&lt;/script&gt;') && !escaped.includes('<script>unsafe</script>'))
  const wb = renderer.buildFinancialsWorkbook(opts)
  const reopened = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  const out = reopened.SheetNames.flatMap(s => XLSX.utils.sheet_to_json(reopened.Sheets[s], { header: 1 }))
  const labels = ['Printed Listed equity ledger', 'Other partner', 'Aggregate investment disclosures', 'Partly paid', 'Lower of cost and fair value']
  check('T-025 PDF source and reopened financial Excel include investees, paid status, partners and valuation', labels.every(s => html.includes(s) && out.some(r => r.includes(s))))
  check('T-025 denomination scales carrying values but preserves share counts and per-unit face value', html.includes('1.00') && out.some(r => r[0] === d.entries[0].companyName && Number(r[2]) === 1000 && Number(r[4]) === 10))
  const fill = renderer.buildFillDetailsWorkbook(Object.values(processed.notes), new Map(), null, { constitution: 3 })
  const fillReopened = XLSX.read(XLSX.write(fill, { type: 'buffer', bookType: 'xlsx' }))
  const parsed = renderer.parseFillDetailsWorkbook(fillReopened, { constitution: 3 })
  check('T-025 actual consolidated Fill Details workbook reopens with both investment notes and partners', parsed.results.filter(x => investmentKind(x.noteTitle)).length === 2 && parsed.results.find(x => investmentKind(x.noteTitle) === 'noncurrent').data.entries[1].partners.length === 2)
  const pdfResult = await renderPdf(html)
  if (!pdfResult.ok) throw new Error(pdfResult.error)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: new Uint8Array(pdfResult.result), useSystemFonts: true }).promise
  let content = ''
  for (let p = 1; p <= document.numPages; p++) content += (await (await document.getPage(p)).getTextContent()).items.map(i => i.str).join(' ') + ' '
  check('T-025 actual generated PDF contains the partnership and investment disclosures', labels.every(s => content.includes(s)))
  writeFileSync(`${userData}-investments.pdf`, new Uint8Array(pdfResult.result))
  console.log(`T-025 synthetic PDF: ${userData}-investments.pdf`)
  await document.destroy()
  const source = db.prepare('SELECT name,closing_balance,imported_closing_balance FROM tb_rows WHERE tb_id=? ORDER BY id').all(tb.id)
  check('T-025 disclosure saves leave source ledger signs and balances unchanged', fixtures.every((f, i) => source[i].name === f[0] && source[i].closing_balance === f[3] && source[i].imported_closing_balance === f[3]))
}
