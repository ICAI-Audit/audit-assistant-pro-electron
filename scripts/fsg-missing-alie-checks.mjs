import { statementDates, statementColumnLabels, noteColumnLabels } from '../src/modules/fsg/utils/statementDates.js'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMissingAlieReport, missingAlieMessages, hasMissingAlie } from '../src/modules/fsg/utils/missingAlie.js'
const require = createRequire(import.meta.url)
export async function checkMissingAlie({ db, root, userData, check, staff, partner, entityId, periodId, defaultRs }) {
  const tb = db.prepare('INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (?,?,?) RETURNING *').get(entityId, periodId, '2024-25')
  const add = (name, balance, alie, status, l1 = null, l2 = null) => {
    const r = db.prepare('INSERT INTO tb_rows (tb_id,name,closing_balance,opening_balance,imported_closing_balance) VALUES (?,?,?,?,?) RETURNING id').get(tb.id, name, balance, balance / 2, balance)
    if (status) db.prepare('INSERT INTO mapped_tb (tb_id,tb_row_id,rule_set_id,alie,mapping1_resultant,mapping2_resultant,status) VALUES (?,?,?,?,?,?,?)').run(tb.id, r.id, defaultRs, alie, l1, l2, status)
    return r.id
  }
  const noMap = add('Unresolved <ledger>', -100, null, null)
  add('Unresolved <ledger>', 100, '', 'conflict')
  add('Zero ALIE discrepancy', 0, ' ', 'discrepancy')
  add('Known cash', -1000, 'ASSETS', 'auto_high', 'Current assets', 'Cash and bank balances')
  add('Known capital', 1000, 'EQUITY AND LIABILITIES', 'auto_high', "Shareholders' funds", 'Share capital')
  const savedStock = await staff('tb:saveStock', { tbId: tb.id, stockData: { pyOpening: { 'Stock-in-Trade': 123456789.12 }, pyClosing: { 'Stock-in-Trade': 98765432.10 } } })
  const stockRows = db.prepare("SELECT * FROM tb_rows WHERE tb_id=? AND upload_nature='Stock Entry PY' ORDER BY id").all(tb.id)
  check('T-026 actual Stock form creates separate unmapped PY inputs with their source values intact', savedStock.ok && stockRows.length === 2 && stockRows[0].closing_balance === -123456789.12 && stockRows[1].closing_balance === -98765432.10)
  const stockTestTb = db.prepare('INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (?,?,?) RETURNING id').get(entityId, periodId, '2024-25').id
  db.prepare('INSERT INTO tb_rows (tb_id,name,closing_balance) VALUES (?,?,?)').run(stockTestTb, 'PY Opening Stock - Stock-in-Trade', -25)
  const genuineStock = await staff('financials:getMissingAlie', stockTestTb)
  check('T-026 a genuine imported stock ledger is still checked: exclusion uses provenance, never its name', genuineStock.ok && genuineStock.result.length === 1 && genuineStock.result[0].closing_balance === -25)
  const before = db.prepare('SELECT * FROM tb_rows WHERE tb_id=? ORDER BY id').all(tb.id)
  let r = await staff('financials:getMissingAlie', tb.id)
  check('T-026 missing ALIE includes unmapped source rows, blank/whitespace ALIE and zero balances', r.ok && r.result.length === 3 && r.result.some(x => x.tb_row_id === noMap && !x.mapped_id), r)
  let report = buildMissingAlieReport(r.result)
  check('T-026 offsetting balances retain count, debit and credit instead of disappearing in a nil net', report.cy.count === 2 && report.cy.debit === 100 && report.cy.credit === 100 && report.cy.signedNet === 0 && missingAlieMessages(report).some(s => s.includes('Debit 100.00') && s.includes('Credit 100.00')))
  check('T-026 PY fallback uses opening values and labels their basis', report.py.debit === 50 && /opening balances/.test(missingAlieMessages(report)[1]))
  check('T-026 warning discloses exclusion without allocating missing ALIE to liabilities', missingAlieMessages(report)[0].includes('ALIE classification missing for 2 ledgers.') && missingAlieMessages(report)[0].includes('excluded from the Balance Sheet and Profit and Loss') && !missingAlieMessages(report)[0].includes('P&L classification pending'))
  check('T-026 missing ALIE excludes Stock Entry PY inputs from counts and provisional totals', !r.result.some(x => stockRows.some(stock => stock.id === x.tb_row_id)) && report.cy.debit === 100 && report.cy.signedNet === 0)
  const cyMissing = r.result
  db.prepare("UPDATE mapped_tb SET alie='assets' WHERE tb_id=? AND alie='ASSETS'").run(tb.id)
  const invalidCase = await staff('financials:getMissingAlie', tb.id)
  check('T-026 a non-canonical ALIE value rejected by statement grouping remains an explicit exception', invalidCase.ok && invalidCase.result.length === 4)
  db.prepare("UPDATE mapped_tb SET alie='ASSETS' WHERE tb_id=? AND alie='assets'").run(tb.id)
  const cons = await staff('financials:getConsolidatedMissingAlie', entityId, [tb.id, tb.id])
  check('T-026 selected consolidated TBs do not duplicate or lose missing-ALIE identities', cons.ok && cons.result.length === 3)
  const none = await staff('financials:getConsolidatedMissingAlie', entityId, [])
  check('T-026 an empty consolidated selection does not include every year', none.ok && none.result.length === 0)
  const other = (await partner('context:open', 'e2')).result
  const foreign = db.prepare('INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (?,?,?) RETURNING id').get(other.entity.id, other.entityPeriodId, '2024-25').id
  r = await staff('financials:getConsolidatedMissingAlie', entityId, [tb.id, foreign])
  check('T-026 direct missing-ALIE reads refuse another client', !r.ok && r.denied, r)
  const priorId = db.prepare('SELECT id FROM entity_periods WHERE entity_id=? AND id<>?').get(entityId, periodId).id
  const pyTb = db.prepare('INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (?,?,?) RETURNING *').get(entityId, priorId, '2023-24')
  db.prepare('INSERT INTO tb_rows (tb_id,name,closing_balance,opening_balance) VALUES (?,?,?,?)').run(pyTb.id, 'Previous-year only missing ALIE', -75, -900)
  const pyMissing = (await staff('financials:getMissingAlie', pyTb.id)).result
  report = buildMissingAlieReport(cyMissing, pyMissing)
  check('T-026 separate PY warnings use that TB closing balance, not its opening or CY figures', report.py.count === 1 && report.py.debit === 75 && /closing balances/.test(missingAlieMessages(report)[1]))
  check('T-026 switching off PY removes only its warnings', buildMissingAlieReport([], pyMissing, true).py.count === 0 && !hasMissingAlie(buildMissingAlieReport([], pyMissing, true)))
  r = await staff('financials:getBranchTBsData', entityId, [tb.id])
  check('T-026 branch export keeps the selected year/TB missing rows alongside statement data', r.ok && r.result.length === 1 && r.result[0].missingAlieRows.length === 3, r)
  check('T-026 selected branch exports and consolidated reads exclude the PY stock disclosure rows', !r.result[0].missingAlieRows.some(x => stockRows.some(stock => stock.id === x.tb_row_id)) && !cons.result.some(x => stockRows.some(stock => stock.id === x.tb_row_id)))
  const branchData = r.result
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export { processRows, fetchFinancialsData } from './src/modules/fsg/hooks/useFinancials.js';
    export { computeCompanyBSLayout } from './src/modules/fsg/utils/bsStructure.js';
    export { attachMissingAlie } from './src/modules/fsg/utils/missingAlieStore.js';
    export { buildFinancialsHTML, buildColumnarHTML } from './src/modules/fsg/components/GenerateFinancials/buildHTML.js';
    export { buildFinancialsWorkbook, buildColumnarWorkbook } from './src/modules/fsg/components/GenerateFinancials/buildExcel.js';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const rendererPath = join(userData, 'missing-alie-renderer.cjs'); writeFileSync(rendererPath, bundle.outputFiles[0].contents)
  const renderer = require(rendererPath), XLSX = require('xlsx-js-style')
  const entity = db.prepare('SELECT * FROM entities WHERE id=?').get(entityId)
  const lf = db.prepare('SELECT * FROM level_format WHERE rule_set_id=? AND constitution=3').all(defaultRs)
  const source = (await staff('financials:getData', tb.id)).result
  const processed = renderer.processRows(source, null, 3, [], null, false, false, null, lf)
  Object.assign(processed, { levelFormat: lf, generalNotes: { points: [] }, missingAlie: report })
  check('T-026 offsetting exceptions remain warnings only, without a liability head', !renderer.computeCompanyBSLayout(processed).el.groups.some(g => g.label === 'ALIE MISSING') && report.cy.count === 2)
  const nilRows = [{ tb_id: 1, tb_row_id: 1, closing_balance: 0, opening_balance: -40 }, { tb_id: 1, tb_row_id: 2, closing_balance: 0, opening_balance: 0 }]
  const openingReport = buildMissingAlieReport(nilRows)
  check('T-026 nil CY excludes the warning while a nonzero comparative opening remains relevant', openingReport.cy.count === 0 && openingReport.py.count === 1 && openingReport.py.signedNet === -40 && !hasMissingAlie(buildMissingAlieReport(nilRows, null, true)))
  for (const constitution of [3, 1, 2]) for (const credit of [250, 25]) {
    const net = credit - 100
    const accepted = source.map(r => ({ ...r, closing_balance: r.alie === 'EQUITY AND LIABILITIES' ? 1000 - net : r.closing_balance }))
    const sourceCopy = JSON.stringify(accepted)
    const draft = renderer.processRows(accepted, null, constitution, [], null, false, false, null, lf)
    const profit = draft.netProfit
    draft.missingAlie = buildMissingAlieReport(cyMissing.map(r => ({ ...r, closing_balance: r.closing_balance > 0 ? credit : r.closing_balance })), null, true)
    check(`T-026 signed ${net}: warning states unresolved amounts are excluded`, missingAlieMessages(draft.missingAlie)[0].includes('excluded from the Balance Sheet and Profit and Loss') && !missingAlieMessages(draft.missingAlie)[0].includes('Temporarily included'))
    check(`T-026 constitution ${constitution}: unresolved ${net} does not change financial totals or profit`, !draft.elSections.some(s => s.level1 === 'ALIE MISSING') && draft.totalEL === 1000 - net && draft.totalAssets === 1000 && draft.netProfit === profit && JSON.stringify(accepted) === sourceCopy)
    const signedOptions = { entity: { ...entity, constitution }, activeTB: tb, data: draft, denomination: 'as_is', signatories: [] }
    const signedWb = renderer.buildFinancialsWorkbook(signedOptions)
    const reopened = XLSX.read(XLSX.write(signedWb, { type: 'buffer', bookType: 'xlsx' }), { sheetStubs: true })
    check(`T-026 constitution ${constitution}: Excel excludes provisional head ${net} and retains its live total formula`, !XLSX.utils.sheet_to_json(reopened.Sheets['Balance Sheet'], { header: 1 }).some(row => row.some(v => String(v).trim().replace(/^\([a-z]\)\s*/, '') === 'ALIE MISSING')) && Object.entries(reopened.Sheets['Balance Sheet']).some(([addr, cell]) => cell?.v === 'TOTAL EQUITY AND LIABILITIES' && /^SUM\(/.test(reopened.Sheets['Balance Sheet'][addr.replace(/^A/, 'C')]?.f || '')))
    if (constitution === 3) {
      const signedBranches = [{ ...branchData[0], rows: accepted, missingAlieRows: draft.missingAlie.cy.items }]
      const columnWb = renderer.buildColumnarWorkbook({ entity, branchTBsData: signedBranches, denomination: 'as_is', signatories: [] })
      check(`T-026 columnar Excel excludes provisional head ${net}`, !XLSX.utils.sheet_to_json(columnWb.Sheets['BS (Columnar)'], { header: 1 }).some(row => String(row[0]).trim() === 'ALIE MISSING'))
      const columnHTML = renderer.buildColumnarHTML({ entity, branchTBsData: signedBranches, denomination: 'as_is', signatories: [] })
      check(`T-026 columnar PDF excludes provisional ${net} on the BS face`, !columnHTML.includes('<td class="indent-1">ALIE MISSING</td>'))
    }
    draft.missingAlie = buildMissingAlieReport([], null, true)
    check(`T-026 constitution ${constitution}: resolved classifications remove provisional head ${net}`, !draft.elSections.some(s => s.isMissingAlie) && draft.totalEL === 1000 - net)
  }
  const datedNotesData = renderer.processRows([...source, {
    ledger_name: 'Synthetic service revenue', name: 'Synthetic service revenue', alie: 'Income',
    level1: 'Revenue from operations', level2: 'Revenue from operations', level3: 'Service revenue',
    mapping1_resultant: 'Revenue from operations', mapping2_resultant: 'Revenue from operations', mapping3_resultant: 'Service revenue',
    closing_balance: 200, opening_balance: 100,
  }], null, 3, [], null, false, false, null, lf)
  datedNotesData.levelFormat = lf
  for (const [fy, year] of [['2025-26', 2026], ['2024-25', 2025], ['2026-27', 2027], ['2022-23', 2023]]) {
    const current = { ...tb, period: fy }, previous = { ...pyTb, period: `${year - 2}-04-01 To ${year - 1}-03-31` }
    const dateOptions = { entity, activeTB: current, prevTB: previous, data: datedNotesData, denomination: 'as_is', signatories: [] }
    const dateHTML = renderer.buildFinancialsHTML(dateOptions)
    const dateWb = renderer.buildFinancialsWorkbook(dateOptions)
    if (fy === '2025-26') {
      const datedPdf = await partner('financials:renderPDF', dateHTML)
      if (!datedPdf.ok) throw new Error(datedPdf.error)
      writeFileSync(`${userData}-dated-notes.pdf`, new Uint8Array(datedPdf.result))
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const document = await pdfjs.getDocument({ data: new Uint8Array(datedPdf.result), useSystemFonts: true }).promise
      let text = ''
      for (let p = 1; p <= document.numPages; p++) text += (await (await document.getPage(p)).getTextContent()).items.map(x => x.str).join(' ')
      const compact = text.replace(/\s+/g, '')
      check('T-027 actual PDF notes and annexures retain dated BS and PL headings after pagination', compact.includes('Asat31March2026-Ledger') && compact.includes('Fortheyearended31March2026-Ledger') && compact.includes('31March2025-Sub-noteTotal'))
      await document.destroy()
      console.log(`T-027 dated notes PDF: ${userData}-dated-notes.pdf`)
    }

    const dateReopened = XLSX.read(XLSX.write(dateWb, { type: 'buffer', bookType: 'xlsx' }))
    for (const [kind, sheet] of [['bs', 'Balance Sheet'], ['pl', 'Profit & Loss']]) {
      const labels = statementColumnLabels(current, previous, kind)
      const prefix = kind === 'bs' ? 'As at' : 'For the year ended'
      check(`T-027 FY ${fy} ${kind}: labels use actual current and comparative dates`, labels.cy === `${prefix} 31 March ${year}` && labels.py === `${prefix} 31 March ${year - 1}`)
      check(`T-027 FY ${fy} ${kind}: PDF and reopened Excel use identical dated columns`, dateHTML.includes(`>${labels.cy}</th>`) && dateHTML.includes(`>${labels.py}</th>`) && XLSX.utils.sheet_to_json(dateReopened.Sheets[sheet], { header: 1 }).some(row => row.includes(labels.cy) && row.includes(labels.py)))
      check(`T-027 FY ${fy} ${kind}: underlying notes and ledger annexures carry the same reporting basis`,
        XLSX.utils.sheet_to_json(dateReopened.Sheets['Notes'], { header: 1 }).some(row => row.includes(labels.cy) && row.includes(labels.py)) &&
        XLSX.utils.sheet_to_json(dateReopened.Sheets['Annexures'], { header: 1 }).some(row => row.includes(`${labels.cy} - Ledger`) && row.includes(`${labels.py} - Ledger`)) &&
        dateHTML.includes(`>${labels.cy} - Ledger</th>`) && dateHTML.includes(`>${labels.py} - Sub-note Total</th>`))

    }
  }
  check('T-027 custom year-end and fallback comparatives preserve their actual reporting dates', statementDates({ period: '2025-01-01 To 2025-12-31' }).cy === '31 December 2025' && statementDates({ period: '2025-01-01 To 2025-12-31' }).py === '31 December 2024')
  check('T-027 selected comparative date takes precedence over automatic preceding year', statementDates({ period: '2025-26' }, { period: '30/09/2024' }).py === '30 September 2024')
  check('T-027 invalid or absent dates do not fabricate dates and leap-day fallback is valid', statementColumnLabels({ period: '2025-02-31' }).cy === 'Current Year' && statementColumnLabels(null).py === 'Previous Year' && statementDates({ period: '2024-02-29' }).py === '28 February 2023')
  const existingWindow = globalThis.window
  globalThis.window = { electronAPI: { fsg: { invoke: async (channel, ...args) => staff(channel.slice(4), ...args) } } }
  try {
    const data = await renderer.fetchFinancialsData(tb, pyTb, entity, defaultRs)
    check('T-026 actual statement loader attaches the source warning without blocking processing', data.missingAlie.cy.count === 2 && data.missingAlie.py.debit === 75 && data.totalAssets === 1000)
    const unchanged = { totalAssets: 123, notes: {}, pyMode: 'required' }
    globalThis.window.electronAPI.fsg.invoke = async () => { throw new Error('Synthetic diagnostic outage') }
    await renderer.attachMissingAlie(unchanged, tb)
    check('T-026 diagnostic failure remains a visible warning and does not block generation', unchanged.totalAssets === 123 && unchanged.missingAlie.error && missingAlieMessages(unchanged.missingAlie).some(s => /unavailable/.test(s)))
  } finally { globalThis.window = existingWindow }
  const options = { entity, activeTB: tb, prevTB: pyTb, data: processed, levelFormat: lf, denomination: 'lakhs', signatories: [], signPlace: 'Synthetic place', signDate: '2026-11-12' }
  const html = renderer.buildFinancialsHTML(options)
  const columnar = renderer.buildColumnarHTML({ entity, branchTBsData: branchData, denomination: 'lakhs', signatories: [] })
  check('T-026 PDF source repeats red bold ALIE counts/totals at both ends of BS and PL', (html.match(/class="missing-alie-warning"/g) || []).length >= 8 && html.includes('color:#b91c1c;font-weight:bold') && html.includes('Debit 100.00') && html.includes('Credit 100.00'))
  check('T-026 missing ledgers appear in PDF annexures and names are escaped', html.includes('Ledgers requiring ALIE classification') && html.includes('Unresolved &lt;ledger&gt;') && !html.includes('Unresolved <ledger>'))
  check('T-026 columnar PDF carries warnings and the ledger exception annexure', (columnar.match(/class="missing-alie-warning"/g) || []).length >= 4 && columnar.includes('Unresolved &lt;ledger&gt;'))
  for (const constitution of [3, 1, 2]) {
    const wb = renderer.buildFinancialsWorkbook({ ...options, entity: { ...entity, constitution, constitution_display: constitution === 3 ? 'Company' : constitution === 2 ? 'LLP' : 'Partnership' } })
    const reopened = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { cellStyles: true })
    check(`T-026 constitution ${constitution}: financial workbook still generates and retains exact warning counts/rupee amounts`, ['Balance Sheet', 'Profit & Loss'].every(name => XLSX.utils.sheet_to_json(reopened.Sheets[name], { header: 1 }).flat().filter(v => String(v).startsWith('ALIE classification missing')).length === 4) && reopened.SheetNames.includes('Annexures') && reopened.SheetNames.includes('ALIE Exceptions'))
    const warn = Object.entries(wb.Sheets['Balance Sheet']).find(([, c]) => typeof c?.v === 'string' && c.v.startsWith('ALIE classification missing'))
    check(`T-026 constitution ${constitution}: Excel warning is bold red and wrapped`, warn?.[1].s?.font?.bold && warn[1].s.font.color.rgb === 'B91C1C' && warn[1].s.alignment.wrapText)
  }
  const colWb = renderer.buildColumnarWorkbook({ entity, branchTBsData: branchData, denomination: 'as_is', signatories: [] })
  check('T-026 columnar Excel has warnings at both ends and an ALIE exception sheet', colWb.SheetNames.includes('ALIE Exceptions') && ['BS (Columnar)', 'PL (Columnar)'].every(n => XLSX.utils.sheet_to_json(colWb.Sheets[n], { header: 1 }).flat().filter(v => String(v).startsWith('ALIE classification missing')).length === 4))
  const pdf = await partner('financials:renderPDF', html)
  if (!pdf.ok) throw new Error(pdf.error)
  writeFileSync(`${userData}-missing-alie.pdf`, new Uint8Array(pdf.result))
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf.result), useSystemFonts: true }).promise
  const texts = []
  for (let p = 1; p <= doc.numPages; p++) texts.push((await (await doc.getPage(p)).getTextContent()).items.map(x => x.str).join(' '))
  check('T-026 actual PDF generates BS, PL and annexure while warnings remain', texts.some(t => /Balance Sheet/i.test(t) && t.replace(/\s+/g, '').includes('ALIEclassificationmissing')) && texts.some(t => /Profit and Loss/i.test(t) && t.replace(/\s+/g, '').includes('ALIEclassificationmissing')) && texts.join(' ').includes('Unresolved <ledger>'))
  await doc.destroy()
  console.log(`T-026 synthetic PDF: ${userData}-missing-alie.pdf`)
  const ids = cyMissing.filter(x => x.mapped_id).map(x => x.mapped_id)
  for (const id of ids) db.prepare("UPDATE mapped_tb SET alie='ASSETS' WHERE id=?").run(id)
  db.prepare("INSERT INTO mapped_tb (tb_id,tb_row_id,rule_set_id,alie,status) VALUES (?,?,?,'ASSETS','auto_low')").run(tb.id, noMap, defaultRs)
  const resolved = await staff('financials:getMissingAlie', tb.id)
  check('T-026 correcting all source ALIE values clears the warning without an acknowledgement override', resolved.ok && !hasMissingAlie(buildMissingAlieReport(resolved.result, [], true)))
  check('T-026 diagnostic reads/exports/corrections never change source signs or amounts', JSON.stringify(before) === JSON.stringify(db.prepare('SELECT * FROM tb_rows WHERE tb_id=? ORDER BY id').all(tb.id)))
}
