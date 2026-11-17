// T-047: the VERA Excel theme on the Notes screen's files — the Fill Details workbook
// (blank and filled) and the Manual PY file. Each finished file opens on "How to Fill",
// keeps every sheet and cell where its upload reader expects it, has blue headers,
// yellow input cells, and dropdowns only where the choice is a fixed list.
// Bundled with esbuild. Usage: node scripts/fsg-excel-theme-notes-checks.mjs [--samples <dir>]
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const samplesAt = process.argv.includes('--samples') ? process.argv[process.argv.indexOf('--samples') + 1] : null

const entry = `
import * as XLSX from 'xlsx-js-style'
import ExcelJS from 'exceljs'
import { finishWorkbook, HOW_TO_SHEET, LISTS_SHEET } from './src/modules/fsg/utils/veraExcel.js'
import { buildFillDetailsWorkbook, parseFillDetailsWorkbook, parseFillDetailsStockSheet, fillDetailsExcelSpec, FILL_DETAILS_LISTS } from './src/modules/fsg/components/GenerateFinancials/fillDetailsWorkbook.js'
import { buildManualPyFilledWorkbook, parseManualPyWorkbook, manualPyExcelSpec } from './src/modules/fsg/components/Notes/manualPyWorkbook.js'
import { parseShareCapitalDetailsSheet } from './src/modules/fsg/components/Notes/shareCapitalDetailsWorkbook.js'
import { parseDepITWorkbook } from './src/modules/fsg/components/DepreciationIT/depITWorkbook.js'
import { parseDepCompWorkbook } from './src/modules/fsg/components/DepreciationComp/depCompWorkbook.js'
export { XLSX, ExcelJS, finishWorkbook, HOW_TO_SHEET, LISTS_SHEET, buildFillDetailsWorkbook, parseFillDetailsWorkbook, parseFillDetailsStockSheet, fillDetailsExcelSpec, FILL_DETAILS_LISTS,
  buildManualPyFilledWorkbook, parseManualPyWorkbook, manualPyExcelSpec, parseShareCapitalDetailsSheet, parseDepITWorkbook, parseDepCompWorkbook }
`
const dir = mkdtempSync(path.join(tmpdir(), 'fsg-excel-theme-notes-'))
const out = path.join(dir, 'bundle.mjs')
await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
const m = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok  ', name) } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) } }
const reopen = (bytes) => m.XLSX.read(bytes, { type: 'array' })
const exceljs = async (bytes) => { const w = new m.ExcelJS.Workbook(); await w.xlsx.load(bytes); return w }
const BLUE = 'FF1E40AF', YELLOW = 'FFFFF9DB'
const isYellow = (c) => c.fill?.fgColor?.argb === YELLOW
const isHeader = (c) => c.fill?.fgColor?.argb === BLUE && c.font?.bold && c.font?.color?.argb === 'FFFFFFFF'
// A dropdown's values, inline or from the hidden Lists sheet.
const listOf = (x, cell) => {
  const dv = cell.dataValidation
  if (dv?.type !== 'list') return null
  const f = dv.formulae?.[0] || ''
  if (f.startsWith('"')) return f.slice(1, -1).split(',')
  const mm = f.match(/^'?([^'!]+)'?!\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)$/)
  if (!mm) return null
  const ls = x.getWorksheet(mm[1]); const vals = []
  for (let r = +mm[3]; r <= +mm[4]; r++) vals.push(String(ls.getCell(`${mm[2]}${r}`).value))
  return vals
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// Loans carry a fresh random id on every parse.
const stable = (parsed) => JSON.parse(JSON.stringify(parsed, (k, v) => k === 'id' ? undefined : v))

// ── synthetic notes (no client data) ────────────────────────────────────────
const notes = [
  { num: 1, title: 'Share Capital', total: 100000 },
  { num: 2, title: 'Long-Term Borrowings', total: 500000 },
  { num: 3, title: 'Short-Term Borrowings', total: 200000 },
  { num: 4, title: 'Trade Payables', total: 80000 },
  { num: 5, title: 'Non-current investments', total: 0 },
  { num: 6, title: 'Trade Receivables', total: 90000 },
  { num: 7, title: 'Cash and Bank Balances', total: 15000 },
]
const blocks = [{ majorCategory: 'Plant and machinery', block: 'Plant & Machinery - 15%', rate: 15 }, { majorCategory: 'Building', block: 'Building (Residential) - 5%', rate: 5 }]
const scheduleII = [{ category: 'Buildings - Factory' }, { category: 'Plant and Machinery - General' }, { category: 'Computers' }]
const cfsRows = [
  { id: 'h_op', kind: 'head', label: 'A. Cash flow from operating activities' },
  { id: 'i_dep', kind: 'item', label: 'Depreciation', cy: 1000, py: 800 },
  { id: 's_opbwc', kind: 'sub', label: 'Operating profit before working capital changes', cy: 1000, py: 800 },
]
const opts = { depCompScheduleII: scheduleII, constitution: 3, cfsRows }

// ── Fill Details: blank template ────────────────────────────────────────────
const blankWb = m.buildFillDetailsWorkbook(notes, new Map(), blocks, { ...opts, blank: true })
const blankNames = [...blankWb.SheetNames]
const blankBytes = await m.finishWorkbook(blankWb, m.fillDetailsExcelSpec(blankWb))
const blankBack = reopen(blankBytes)
check('Fill Details template opens on How to Fill', blankBack.SheetNames[0] === m.HOW_TO_SHEET, blankBack.SheetNames)
check('Fill Details template keeps every sheet, in order', same(blankBack.SheetNames.filter(n => n !== m.HOW_TO_SHEET && n !== m.LISTS_SHEET), blankNames), blankBack.SheetNames)
const bx = await exceljs(blankBytes)
const sheet = (x, prefix) => x.worksheets.find(w => w.name.startsWith(prefix))
const ltb = sheet(bx, 'N2 ')
check('a note sheet keeps "Note N" and its title in rows 1-2', ltb.getCell('A1').value === 'Note 2' && ltb.getCell('A2').value === 'Long-Term Borrowings', [ltb.getCell('A1').value, ltb.getCell('A2').value])
check('a note sheet header (row 4) is VERA blue', isHeader(ltb.getCell('A4')) && isHeader(ltb.getCell('E4')))
check('borrowings: ledger, lender and amounts are yellow to fill in', isYellow(ltb.getCell('A5')) && isYellow(ltb.getCell('B5')) && isYellow(ltb.getCell('E5')))
check('borrowings: no dropdown on the TB ledger or lender name (client-specific)', !ltb.getCell('A5').dataValidation && !ltb.getCell('B5').dataValidation)
check('borrowings: Secured/Unsecured is a strict dropdown', same(listOf(bx, ltb.getCell('D5')), ['Secured', 'Unsecured']) && ltb.getCell('D5').dataValidation.errorStyle === 'stop')
check('long-term borrowings: Nature dropdown is the form\'s list', same(listOf(bx, ltb.getCell('C5')), m.FILL_DETAILS_LISTS.ltbNature), listOf(bx, ltb.getCell('C5')))
check('long-term borrowings: Frequency dropdown', same(listOf(bx, ltb.getCell('K5')), m.FILL_DETAILS_LISTS.ltbFrequency))
check('borrowings: spare yellow rows with the dropdown, to add more loans', isYellow(ltb.getCell('A14')) && same(listOf(bx, ltb.getCell('D14')), ['Secured', 'Unsecured']))
const stb = sheet(bx, 'N3 ')
check('short-term borrowings: Nature dropdown is the form\'s list', same(listOf(bx, stb.getCell('C5')), m.FILL_DETAILS_LISTS.stbNature))
const sc = sheet(bx, 'N1 ')
check('share capital: Type dropdown Equity / Preference', same(listOf(bx, sc.getCell('B5')), ['Equity', 'Preference']))
check('share capital: no dropdown on the class name', !sc.getCell('A5').dataValidation)
const tp = sheet(bx, 'N4 ')
const tpRows = []; tp.eachRow((r, n) => tpRows.push([n, String(r.getCell(1).value ?? ''), String(r.getCell(3).value ?? '')]))
const flagRow = tpRows.find(r => r[1] === 'FLAGS')?.[0]
const ageRow = tpRows.find(r => r[1] === 'AGEING')?.[0]
check('trade payables: Section / Period / Particulars are fixed (not yellow)', !isYellow(tp.getCell(`A${ageRow}`)) && !isYellow(tp.getCell(`C${ageRow}`)) && isYellow(tp.getCell(`D${ageRow}`)))
check('trade payables: "Include in Output" is a Yes/No dropdown', same(listOf(bx, tp.getCell(`D${flagRow}`)), ['Yes', 'No']) && !tp.getCell(`D${ageRow}`).dataValidation)
const tr = sheet(bx, 'N6 ')
check('trade receivables ageing: buckets yellow, labels fixed', isYellow(tr.getCell('C5')) && !isYellow(tr.getCell('B5')))
const inv = sheet(bx, 'N5 ')
check('investments: Row type dropdown', same(listOf(bx, inv.getCell('A5')), m.FILL_DETAILS_LISTS.investmentRowType))
const hdr = []; inv.getRow(4).eachCell((c, n) => hdr[n] = String(c.value))
const invCol = (h) => hdr.findIndex(v => v === h)
const L = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }
check('investments: Quoted/Unquoted and Paid status dropdowns', same(listOf(bx, inv.getCell(`${L(invCol('quotation'))}5`)), ['Quoted', 'Unquoted']) && same(listOf(bx, inv.getCell(`${L(invCol('paidStatus'))}5`)), ['Fully paid', 'Partly paid']))
check('investments: Category dropdown warns (custom categories allowed)', listOf(bx, inv.getCell(`${L(invCol('category'))}5`))?.includes('Mutual fund units') && inv.getCell(`${L(invCol('category'))}5`).dataValidation.errorStyle === 'warning')
const cb = sheet(bx, 'N7 ')
check('cash & bank: item text fixed, amount yellow', !isYellow(cb.getCell('A5')) && isYellow(cb.getCell('B5')))
const depIT = bx.getWorksheet('Dep (IT) Template')
check('Dep (IT) Template: Asset Block dropdown of the IT blocks', same(listOf(bx, depIT.getCell('B2')), blocks.map(b => b.block)), listOf(bx, depIT.getCell('B2')))
check('Dep (IT) Template: no dropdown on the ledger name', !depIT.getCell('A2').dataValidation)
const depComp = bx.getWorksheet('Dep (Comp) Template')
check('Dep (Comp) Template: Asset Category dropdown of Schedule II', same(listOf(bx, depComp.getCell('A2')), scheduleII.map(r => r.category)))
check('Stock sheet is themed', isHeader(bx.getWorksheet('Stock').getCell('A1')) && isYellow(bx.getWorksheet('Stock').getCell('B2')))
check('CFS sheet is themed', isHeader(bx.getWorksheet('CFS').getCell('A4')))
const scd = sheet(bx, 'Share Capital - Details')
check('Share Capital - Details: Category is a Promoter / Non-Promoter dropdown', same(listOf(bx, scd.getCell('F5')), ['Promoter', 'Non-Promoter']))
const guide = bx.getWorksheet(m.HOW_TO_SHEET); const guideText = []
guide.eachRow(r => r.eachCell(c => guideText.push(String(c.value ?? ''))))
check('How to Fill lists the sheets of this file', guideText.some(t => t.includes('N2 Long-Term Borrowings')) && guideText.some(t => t.includes('Dep (IT) Template')), guideText.filter(t => t.includes('Sheet')).slice(0, 4))
const bp0 = m.parseFillDetailsWorkbook(blankWb, { constitution: 3 }), bp1 = m.parseFillDetailsWorkbook(blankBack, { constitution: 3 })
check('blank template uploaded untouched saves nothing (same as before)', bp1.results.length === 0 && bp1.skippedBlank === bp0.skippedBlank, { before: bp0.skippedBlank, after: bp1 })
check('the guide and Lists sheets are never read as a note', !bp1.results.some(r => /how to fill|lists/i.test(r.noteTitle)))

// ── Fill Details: filled ────────────────────────────────────────────────────
const details = new Map([
  [1, { classes: [{ name: 'Equity Shares', type: 'Equity', faceValue: 10, cy: { authorised: 20000, openingShares: 10000, issuedDuringYear: 0, deletedDuringYear: 0, subscribed: 10000 }, py: { authorised: 20000, openingShares: 10000, subscribed: 10000 } }],
    shareholders5pctEquity: [{ name: 'Synthetic Holder A', cyShares: 6000, pyShares: 6000 }], promoters: [], rights: 'One vote per share.', footnotes: ['Synthetic footnote'] }],
  [2, { loans: [{ tbLedger: 'Term loan ledger X', lenderPrintName: 'Bank X', nature: 'Term Loans from Banks', securedUnsecured: 'Secured', grossCY: 500000, grossPY: 600000, currentMaturityCY: 100000, currentMaturityPY: 100000, roi: '9.5', emi: '12000', frequency: 'Monthly', remainingInstalments: '40', finalMaturityDate: '2030-03-31' }] }],
  [7, { items: { a: { amount: 2500, remarks: 'Synthetic margin money' } } }],
])
const stockData = { opening: { 'Raw Materials': '125000.5' }, closing: { 'Raw Materials': '98000' }, pyOpening: {}, pyClosing: {}, heads: {} }
const filledWb = m.buildFillDetailsWorkbook(notes, details, blocks, { ...opts, stockData })
const filledBytes = await m.finishWorkbook(filledWb, m.fillDetailsExcelSpec(filledWb))
const filledBack = reopen(filledBytes)
const fp0 = m.parseFillDetailsWorkbook(filledWb, { constitution: 3 }), fp1 = m.parseFillDetailsWorkbook(filledBack, { constitution: 3 })
check('filled Fill Details reads back the same notes and data', same(stable(fp1), stable(fp0)) && fp1.results.length >= 3, { before: stable(fp0).results.map(r => r.noteNum), after: stable(fp1).results.map(r => r.noteNum) })
check('filled Fill Details reads back the loan as entered', fp1.results.find(r => r.noteNum === 2)?.data.loans[0].grossCY === 500000 && fp1.results.find(r => r.noteNum === 2)?.data.loans[0].finalMaturityDate === '2030-03-31', fp1.results.find(r => r.noteNum === 2)?.data.loans[0])
check('filled Fill Details reads back the same Inventory', same(m.parseFillDetailsStockSheet(filledBack), m.parseFillDetailsStockSheet(filledWb)))
check('filled Fill Details reads back the same shareholders, rights and footnotes', same(m.parseShareCapitalDetailsSheet(filledBack, 10000, 10000), m.parseShareCapitalDetailsSheet(filledWb, 10000, 10000)))
check('the Dep sheets read the same (blank template rows)', same(m.parseDepITWorkbook(filledBack, blocks).rows, m.parseDepITWorkbook(filledWb, blocks).rows) && same(m.parseDepCompWorkbook(filledBack).rows, m.parseDepCompWorkbook(filledWb).rows))
const fx = await exceljs(filledBytes)
check('filled amounts are real numbers in Excel', typeof sheet(fx, 'N2 ').getCell('E5').value === 'number', sheet(fx, 'N2 ').getCell('E5').value)
check('an old Fill Details file without the guide still reads', m.parseFillDetailsWorkbook(reopen(m.XLSX.write(m.buildFillDetailsWorkbook(notes, details, blocks, opts), { type: 'array', bookType: 'xlsx' })), { constitution: 3 }).results.length === fp0.results.length)

// ── Manual PY ───────────────────────────────────────────────────────────────
const entries = [
  { note_title: 'Other Expenses', particular_label: 'Rent', py_amount: 120000, is_custom: false },
  { note_title: 'Other Expenses', particular_label: 'Synthetic custom line', py_amount: 5000.5, is_custom: true },
]
const pyWb = m.buildManualPyFilledWorkbook(entries, { sheetLabel: 'Manual PY' })
const pyBytes = await m.finishWorkbook(pyWb, m.manualPyExcelSpec(entries.length))
const pyBack = reopen(pyBytes)
check('Manual PY opens on How to Fill', pyBack.SheetNames[0] === m.HOW_TO_SHEET && pyBack.SheetNames.includes('Manual PY'), pyBack.SheetNames)
check('Manual PY reads back the same entries', same(m.parseManualPyWorkbook(pyBack), m.parseManualPyWorkbook(pyWb)) && m.parseManualPyWorkbook(pyBack).entries.length === 2, m.parseManualPyWorkbook(pyBack))
const px = await exceljs(pyBytes); const py = px.getWorksheet('Manual PY')
check('Manual PY header is VERA blue, inputs yellow', isHeader(py.getCell('A1')) && isYellow(py.getCell('C2')) && isYellow(py.getCell('A12')))
check('Manual PY: Custom Row is a Y/N dropdown; note title and particular are free text', same(listOf(px, py.getCell('D2')), ['Y', 'N']) && !py.getCell('A2').dataValidation && !py.getCell('B2').dataValidation)
check('Manual PY: the parser never takes How to Fill as its sheet', m.parseManualPyWorkbook(pyBack).entries.every(e => e.note_title === 'Other Expenses'))
const pyEmpty = reopen(await m.finishWorkbook(m.buildManualPyFilledWorkbook([], {}), m.manualPyExcelSpec(0)))
check('an empty Manual PY file still reads as no entries', m.parseManualPyWorkbook(pyEmpty).entries.length === 0)

// ── the fixed lists match the forms' own options ────────────────────────────
const src = (p) => readFileSync(path.join(root, 'src/modules/fsg', p), 'utf8')
const optionsIn = (text, name) => { const mm = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`)); return mm ? [...mm[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null }
check('Long-term Nature / Frequency lists match LongTermBorrowingsForm.jsx', same(optionsIn(src('components/Notes/LongTermBorrowingsForm.jsx'), 'NATURE_OPTIONS'), m.FILL_DETAILS_LISTS.ltbNature) && same(optionsIn(src('components/Notes/LongTermBorrowingsForm.jsx'), 'FREQUENCY_OPTIONS'), m.FILL_DETAILS_LISTS.ltbFrequency))
check('Short-term Nature list matches ShortTermBorrowingsForm.jsx', same(optionsIn(src('components/Notes/ShortTermBorrowingsForm.jsx'), 'NATURE_OPTIONS'), m.FILL_DETAILS_LISTS.stbNature))

if (samplesAt) {
  writeFileSync(path.join(samplesAt, 'Sample - Fill Details Template.xlsx'), blankBytes)
  writeFileSync(path.join(samplesAt, 'Sample - Fill Details Filled.xlsx'), filledBytes)
  writeFileSync(path.join(samplesAt, 'Sample - Manual PY.xlsx'), pyBytes)
  console.log('samples written to', samplesAt)
}
rmSync(dir, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
