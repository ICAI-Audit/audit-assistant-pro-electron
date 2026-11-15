// T-047 group C: the VERA Excel theme on the CFS, Tax Computation, Shareholder,
// Share Capital Details and Investments workbooks — opens on How to Fill, blue header,
// yellow inputs, dropdowns only for fixed lists, and every reader gets the same data back.
// Bundled with esbuild (xlsx-js-style / exceljs). Usage: node scripts/fsg-excel-theme-forms-checks.mjs [--samples <dir>]
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const samplesAt = process.argv.includes('--samples') ? process.argv[process.argv.indexOf('--samples') + 1] : null

const entry = `
import * as XLSX from 'xlsx-js-style'
import ExcelJS from 'exceljs'
import { finishWorkbook, dataSheetNames, firstDataSheet, HOW_TO_SHEET } from './src/modules/fsg/utils/veraExcel.js'
import { buildCfsWorkbook, parseCfsSheet, cfsExcelSpec, cfsSheetSpec, CFS_SHEET } from './src/modules/fsg/components/CFS/cfsWorkbook.js'
import { taxComputationExcelSpec } from './src/modules/fsg/components/TaxComputation/taxExcelSpec.js'
import { buildSavedWorkbook, parseSavedWorkbook } from './src/modules/fsg/utils/taxComputationIO.js'
import { SHAREHOLDER_SHEET, shareholderTemplateExcelSpec, shareCapitalDetailsSheetSpec, appendShareCapitalDetailsSheet, parseShareCapitalDetailsSheet } from './src/modules/fsg/components/Notes/shareCapitalDetailsWorkbook.js'
import { investmentSheetSpec, investmentToRows, investmentFromRows, INVESTMENT_HEADERS, INVESTMENT_FIELDS } from './src/modules/fsg/utils/investmentWorkbook.js'
export { XLSX, ExcelJS, finishWorkbook, dataSheetNames, firstDataSheet, HOW_TO_SHEET, buildCfsWorkbook, parseCfsSheet, cfsExcelSpec, cfsSheetSpec, CFS_SHEET,
  taxComputationExcelSpec, buildSavedWorkbook, parseSavedWorkbook, SHAREHOLDER_SHEET, shareholderTemplateExcelSpec, shareCapitalDetailsSheetSpec,
  appendShareCapitalDetailsSheet, parseShareCapitalDetailsSheet, investmentSheetSpec, investmentToRows, investmentFromRows, INVESTMENT_HEADERS, INVESTMENT_FIELDS }
`
const dir = mkdtempSync(path.join(tmpdir(), 'fsg-excel-forms-'))
const out = path.join(dir, 'bundle.mjs')
await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  // taxComputationIO imports api.js (window.*); never called here.
  define: { window: 'globalThis' },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
const m = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok  ', name) } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)) } }
const reopen = (bytes) => m.XLSX.read(bytes, { type: 'array' })
const exceljs = async (bytes) => { const w = new m.ExcelJS.Workbook(); await w.xlsx.load(bytes); return w }
const BLUE = 'FF1E40AF', YELLOW = 'FFFFF9DB'
const isHeader = (c) => c.fill?.fgColor?.argb === BLUE && c.font?.bold && c.font?.color?.argb === 'FFFFFFFF'
const isYellow = (c) => c.fill?.fgColor?.argb === YELLOW
const listOf = (c) => { const f = c.dataValidation?.formulae?.[0] || ''; return c.dataValidation?.type === 'list' && f.startsWith('"') ? f.slice(1, -1).split(',') : null }
const samples = {}

// ── CFS ─────────────────────────────────────────────────────────────────────
{
  const rows = [
    { id: 'h_op', kind: 'head', label: 'A. Cash flow from operating activities' },
    { id: 'pbt', kind: 'item', label: 'Net profit before tax', cy: 100000, py: 80000, calc: true },
    { id: 'dep', kind: 'item', label: 'Depreciation', cy: 12000, py: 10000 },
    { id: 's_opbwc', kind: 'sub', label: 'Operating profit before working capital changes', cy: 112000, py: 90000 },
    { id: 'tr', kind: 'item', label: '(Increase) / decrease in trade receivables', cy: -5000, py: 2000 },
    { id: 't_op', kind: 'total', label: 'Net cash from operating activities', cy: 107000, py: 92000 },
  ]
  const cc = { rows: [{ id: 'cc_cash', label: 'Cash on hand', cy: 5000, py: 4000 }], totalCY: 5000, totalPY: 4000, bsCY: 5000, bsPY: 4000 }
  const bytes = await m.finishWorkbook(m.buildCfsWorkbook(rows, { cc }), m.cfsExcelSpec('filled', rows, { cc }))
  samples['CFS Filled'] = bytes
  const wb = reopen(bytes)
  check('CFS opens on How to Fill', wb.SheetNames[0] === m.HOW_TO_SHEET, wb.SheetNames)
  const x = await exceljs(bytes); const s = x.getWorksheet('CFS')
  check('CFS header row (row 4) is VERA blue', isHeader(s.getCell('A4')) && isHeader(s.getCell('D4')))
  // rows: 5 head, 6 pbt, 7 dep, 8 New row A1, 9 sub, 10 tr, 11 New row A, 12 total
  check('CFS: an item\'s Current and Previous Year are yellow', isYellow(s.getCell('B7')) && isYellow(s.getCell('C7')))
  check('CFS: profit before tax takes only a Previous Year figure', !isYellow(s.getCell('B6')) && isYellow(s.getCell('C6')))
  check('CFS: a "New row" line takes a description and figures', isYellow(s.getCell('A8')) && isYellow(s.getCell('B8')) && isYellow(s.getCell('C8')), s.getCell('A8').value)
  check('CFS: subtotals, totals and Row IDs are not inputs', !isYellow(s.getCell('B9')) && !isYellow(s.getCell('B12')) && !isYellow(s.getCell('D7')))
  check('CFS: the cash components after the blank row are styled as the table, not as notes', s.getCell('A15').font?.italic !== true && isYellow(s.getCell('B15')), s.getCell('A15').value)
  check('CFS has no dropdowns (nothing is a fixed choice)', !s.getCell('B7').dataValidation && !x.getWorksheet('Lists'))
  check('CFS figures are numbers in Excel', s.getCell('B7').value === 12000)
  const before = m.parseCfsSheet(m.buildCfsWorkbook(rows, { cc }))
  check('CFS styled file reads back the same as the unstyled one', JSON.stringify(m.parseCfsSheet(wb)) === JSON.stringify(before), m.parseCfsSheet(wb))
  check('CFS sheet spec for Fill Details is the same as the CFS tab\'s', JSON.stringify(m.cfsSheetSpec(rows, { cc })) === JSON.stringify(m.cfsExcelSpec('template', rows, { cc }).sheets[m.CFS_SHEET]))
}

// ── Tax Computation ─────────────────────────────────────────────────────────
{
  const lines = [{ a: 'Profit before tax as per Profit & Loss account', b: 250000 }, { a: 'Add:', b: null }, { a: '   Depreciation as per books', b: 40000 }, { a: 'Total income', b: 290000 }]
  const saved = { ov: { pbt: 250000 }, rate: 25, presumptive: true, dueDate: '2026-10-31', advance: [10000, null, null, null], additions: [{ label: 'Disallowance u/s 37', amount: 1500 }], deductions: [] }
  const raw = m.buildSavedWorkbook({ entityName: 'Sample Pvt Ltd', title: 'Computation of Total Income and Tax', subtitle: 'Company', lines, saved })
  const bytes = await m.finishWorkbook(raw, m.taxComputationExcelSpec(lines.length))
  samples['Tax Computation'] = bytes
  const wb = reopen(bytes)
  check('Tax Computation opens on How to Fill', wb.SheetNames[0] === m.HOW_TO_SHEET && wb.SheetNames.includes('Inputs (do not edit)'), wb.SheetNames)
  const x = await exceljs(bytes); const s = x.getWorksheet('Tax Computation')
  check('Tax Computation header (row 5) is VERA blue', isHeader(s.getCell('A5')) && isHeader(s.getCell('B5')))
  check('Tax Computation amounts are formatted, nothing is yellow', s.getCell('B6').numFmt?.includes('#,##0.00') && !isYellow(s.getCell('B6')))
  check('Tax Computation restores the same saved figures', JSON.stringify(m.parseSavedWorkbook(wb)) === JSON.stringify(m.parseSavedWorkbook(raw)) && m.parseSavedWorkbook(wb).ov.pbt === 250000, m.parseSavedWorkbook(wb))
}

// ── Shareholder template (Share Capital form) ──────────────────────────────
{
  const build = () => {
    const wb = m.XLSX.utils.book_new()
    m.XLSX.utils.book_append_sheet(wb, m.XLSX.utils.aoa_to_sheet([
      ['Sl No', 'Name of Shareholder', 'Folio No (Optional)', 'No. of Shares at Beginning (PY)', 'No. of Shares at End (CY)', 'Category'],
      ...[1, 2, 3, 4, 5].map(i => [i, '', '', '', '', 'Non-Promoter'])]), m.SHAREHOLDER_SHEET)
    return wb
  }
  const bytes = await m.finishWorkbook(build(), m.shareholderTemplateExcelSpec())
  samples['Shareholder Template'] = bytes
  const wb = reopen(bytes)
  check('Shareholder template opens on How to Fill', wb.SheetNames[0] === m.HOW_TO_SHEET, wb.SheetNames)
  // what ShareCapitalForm's import reads: the Shareholders sheet, never the guide
  const readSheet = (w) => w.Sheets[m.SHAREHOLDER_SHEET] || m.firstDataSheet(w)
  check('Shareholder import reads the Shareholders sheet, not How to Fill', readSheet(wb) === wb.Sheets[m.SHAREHOLDER_SHEET])
  const x = await exceljs(bytes); const s = x.getWorksheet(m.SHAREHOLDER_SHEET)
  check('Shareholder header is VERA blue', isHeader(s.getCell('A1')) && isHeader(s.getCell('F1')))
  check('Shareholder name and shares are yellow; Sl No is not', isYellow(s.getCell('B2')) && isYellow(s.getCell('E2')) && !isYellow(s.getCell('A2')))
  check('Category is a Promoter / Non-Promoter dropdown', JSON.stringify(listOf(s.getCell('F2'))) === '["Promoter","Non-Promoter"]', s.getCell('F2').dataValidation)
  check('Category dropdown refuses other values', s.getCell('F2').dataValidation?.showErrorMessage === true && s.getCell('F2').dataValidation?.errorStyle === 'stop')
  check('100 rows are ready, each with the Category dropdown', !!listOf(s.getCell('F101')) && isYellow(s.getCell('B101')) && !s.getCell('F102').dataValidation)
  check('Name has no dropdown (shareholders are the client\'s own list)', !s.getCell('B2').dataValidation)
  { const old = build(); check('an old unstyled Shareholder file is still read', readSheet(old) === old.Sheets[m.SHAREHOLDER_SHEET]) }
  // a file whose data sheet was renamed still never falls back to How to Fill
  const renamed = reopen(bytes); renamed.SheetNames = renamed.SheetNames.map(n => n === m.SHAREHOLDER_SHEET ? 'Sheet1' : n)
  renamed.Sheets.Sheet1 = renamed.Sheets[m.SHAREHOLDER_SHEET]; delete renamed.Sheets[m.SHAREHOLDER_SHEET]
  check('a renamed Shareholders sheet is still read, not How to Fill', readSheet(renamed) === renamed.Sheets.Sheet1)
}

// ── Share Capital Details (a Fill Details sheet) ───────────────────────────
{
  const details = { promoters: [{ name: 'A Sharma', shares: '6000' }], shareholders5pctEquity: [{ name: 'B Gupta', pyShares: '1000', cyShares: '2000' }], rights: 'One vote per share.', footnotes: ['Footnote one'] }
  const build = () => { const wb = m.XLSX.utils.book_new(); m.appendShareCapitalDetailsSheet(wb, 3, details, new Set()); return wb }
  const raw = build()
  const sheetName = raw.SheetNames[0]
  const bytes = await m.finishWorkbook(build(), { mode: 'filled', sheets: { 'Share Capital - Details*': m.shareCapitalDetailsSheetSpec(details) } })
  samples['Share Capital Details'] = bytes
  const x = await exceljs(bytes); const s = x.getWorksheet(sheetName)
  check('Share Capital Details header (row 4) is VERA blue', isHeader(s.getCell('B4')))
  check('Share Capital Details shareholder rows are yellow', isYellow(s.getCell('B5')) && isYellow(s.getCell('E6')))
  check('Share Capital Details Category is a dropdown on the shareholder rows only', JSON.stringify(listOf(s.getCell('F5'))) === '["Promoter","Non-Promoter"]' && !!listOf(s.getCell('F6')) && !s.getCell('F7').dataValidation)
  check('Share Capital Details text below the table is not wrapped', !s.getCell('A9').alignment?.wrapText, s.getCell('A9').value)
  const a = m.parseShareCapitalDetailsSheet(reopen(bytes), 10000, 10000), b = m.parseShareCapitalDetailsSheet(raw, 10000, 10000)
  check('Share Capital Details reads back the same as the unstyled sheet', JSON.stringify(a) === JSON.stringify(b) && a.data.promoters[0].name === 'A Sharma' && a.data.rights === 'One vote per share.', a)
}

// ── Investments (a Fill Details sheet) ─────────────────────────────────────
{
  const details = { categories: ['Gold coins'], entries: [{ ledgerKey: 't:1', subclass: 'Investments in equity instruments', ledgerName: 'Investment in XYZ Ltd', companyName: 'XYZ Ltd', category: 'Shares', relationship: 'None', trade: 'Other investments', quotation: 'Quoted', paidStatus: 'Fully paid', quantityCY: '100', amountCY: '50000', amountPY: '45000', valuation: 'Cost', marketCY: '60000', marketPY: '50000', partners: [] }] }
  const build = () => {
    const aoa = [['Note 11'], ['Non-current investments'], [], m.INVESTMENT_HEADERS, ...m.investmentToRows(details)]
    const wb = m.XLSX.utils.book_new(); m.XLSX.utils.book_append_sheet(wb, m.XLSX.utils.aoa_to_sheet(aoa), 'Non-current investments'); return wb
  }
  const bytes = await m.finishWorkbook(build(), { mode: 'filled', sheets: { 'Non-current investments': m.investmentSheetSpec('noncurrent') } })
  samples['Investments'] = bytes
  const x = await exceljs(bytes); const s = x.getWorksheet('Non-current investments')
  const col = (f) => { const i = 3 + m.INVESTMENT_FIELDS.indexOf(f); let n = i, t = ''; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26) } return t }
  check('Investments header (row 4) is VERA blue', isHeader(s.getCell('A4')) && isHeader(s.getCell(`${col('redemptionNote')}4`)))
  check('Investments: Quoted / Unquoted is a strict dropdown', JSON.stringify(listOf(s.getCell(`${col('quotation')}5`))) === '["Quoted","Unquoted"]' && s.getCell(`${col('quotation')}5`).dataValidation.errorStyle === 'stop')
  check('Investments: Trade / Other, Paid status and Relationship are dropdowns', JSON.stringify(listOf(s.getCell(`${col('trade')}5`))) === '["Trade investments","Other investments"]'
    && JSON.stringify(listOf(s.getCell(`${col('paidStatus')}5`))) === '["Fully paid","Partly paid"]' && (listOf(s.getCell(`${col('relationship')}5`)) || []).includes('Joint Venture'))
  check('Investments: Category dropdown warns (own CATEGORY rows allowed)', s.getCell(`${col('category')}5`).dataValidation?.type === 'list' && s.getCell(`${col('category')}5`).dataValidation.errorStyle === 'warning')
  check('Investments: Row type is a dropdown', JSON.stringify(listOf(s.getCell('A6'))) === '["INVESTMENT","CATEGORY","PARTNER"]')
  check('Investments: ledger and investee names have no dropdown', !s.getCell(`${col('ledgerName')}5`).dataValidation && !s.getCell(`${col('companyName')}5`).dataValidation)
  check('Investments: ledger columns VERA fills are not yellow; investee name is', !isYellow(s.getCell(`${col('ledgerName')}6`)) && isYellow(s.getCell(`${col('companyName')}6`)))
  const sheetRows = (w) => m.XLSX.utils.sheet_to_json(w.Sheets['Non-current investments'], { header: 1, defval: '' }).slice(4)
  const a = m.investmentFromRows(sheetRows(reopen(bytes))), b = m.investmentFromRows(sheetRows(build()))
  const norm = (d) => JSON.stringify(d, (k, v) => (typeof v === 'number' ? String(v) : v))
  check('Investments read back the same as the unstyled sheet', norm(a) === norm(b) && a.entries[0].companyName === 'XYZ Ltd' && a.categories[0] === 'Gold coins', { a, b })
}

if (samplesAt) {
  for (const [name, bytes] of Object.entries(samples)) writeFileSync(path.join(samplesAt, `Sample - ${name}.xlsx`), bytes)
  console.log('samples written to', samplesAt)
}
rmSync(dir, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
