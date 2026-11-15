// T-047: the VERA Excel theme on the Dep (Books) and Dep (Income Tax) templates —
// opens on "How to Fill", blue header, yellow input cells, fixed-list dropdowns
// (Schedule II category, Income-tax block), and the upload readers still read
// old and new files. Bundled with esbuild (xlsx-js-style / exceljs).
// Usage: node scripts/fsg-excel-theme-dep-checks.mjs [--samples <dir>]
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
import { finishWorkbook, dataSheetNames, HOW_TO_SHEET, LISTS_SHEET } from './src/modules/fsg/utils/veraExcel.js'
import { buildDepCompBlankTemplate, buildDepCompFilledWorkbook, parseDepCompWorkbook, depCompExcelSpec } from './src/modules/fsg/components/DepreciationComp/depCompWorkbook.js'
import { buildDepITBlankTemplate, buildDepITFilledWorkbook, parseDepITWorkbook, depITExcelSpec } from './src/modules/fsg/components/DepreciationIT/depITWorkbook.js'
export { XLSX, ExcelJS, finishWorkbook, dataSheetNames, HOW_TO_SHEET, LISTS_SHEET,
  buildDepCompBlankTemplate, buildDepCompFilledWorkbook, parseDepCompWorkbook, depCompExcelSpec,
  buildDepITBlankTemplate, buildDepITFilledWorkbook, parseDepITWorkbook, depITExcelSpec }
`
const dir = mkdtempSync(path.join(tmpdir(), 'fsg-excel-theme-dep-'))
const out = path.join(dir, 'bundle.mjs')
await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
const m = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok  ', name) } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)) } }
const reopen = (bytes) => m.XLSX.read(bytes, { type: 'array' })
const exceljs = async (bytes) => { const w = new m.ExcelJS.Workbook(); await w.xlsx.load(bytes); return w }
const BLUE = 'FF1E40AF', WHITE = 'FFFFFFFF', INPUT = 'FFFFF9DB'
// A list validation's values, inline or from the hidden Lists sheet.
const listValues = (wbx, dv) => {
  const f = dv?.formulae?.[0] || ''
  if (f.startsWith('"')) return f.slice(1, -1).split(',')
  const mm = f.match(/^'?([^'!]+)'?!\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)$/)
  if (!mm) return []
  const ls = wbx.getWorksheet(mm[1]); const vals = []
  for (let r = +mm[3]; r <= +mm[4]; r++) vals.push(String(ls.getCell(`${mm[2]}${r}`).value))
  return vals
}
const isBlueHeader = (c) => c.fill?.fgColor?.argb === BLUE && c.font?.bold && c.font?.color?.argb === WHITE
const isYellow = (c) => c.fill?.fgColor?.argb === INPUT

// Synthetic masters (the app loads them from the database).
const scheduleII = [
  { category: 'Buildings (other than factory buildings)' },
  { category: 'Plant and Machinery, general' },
  { category: 'Furniture and fittings' },
  { category: 'Computers and data processing units' },
]
const blocks = [
  { id: 'b1', majorCategory: 'Building', block: 'Building - residential, other than hotels', rate: 5 },
  { id: 'b2', majorCategory: 'Plant and machinery', block: 'Plant and machinery - general', rate: 15 },
  { id: 'b3', majorCategory: 'Plant and machinery', block: 'Computers including software', rate: 40 },
  { id: 'b4', majorCategory: 'Furniture', block: 'Furniture and fittings', rate: 10 },
]

// ── Dep (Books) ──────────────────────────────────────────────────────────────
{
  const blank = await m.finishWorkbook(m.buildDepCompBlankTemplate(scheduleII), m.depCompExcelSpec('template', scheduleII))
  const wb = reopen(blank)
  check('Dep (Books) template opens on How to Fill', wb.SheetNames[0] === m.HOW_TO_SHEET, wb.SheetNames)
  check('Dep (Books) template keeps its data and reference sheets', ['Dep (Comp) Template', 'Schedule II Reference'].every(n => m.dataSheetNames(wb).includes(n)), wb.SheetNames)
  const x = await exceljs(blank); const ws = x.getWorksheet('Dep (Comp) Template')
  check('Dep (Books) header is VERA blue with white bold text', isBlueHeader(ws.getCell('A1')) && isBlueHeader(ws.getCell('K1')))
  check('Dep (Books) category and amount cells are pale yellow', isYellow(ws.getCell('A2')) && isYellow(ws.getCell('B2')) && isYellow(ws.getCell('K20')))
  check('Dep (Books) header row and category column are frozen', ws.views?.[0]?.state === 'frozen' && ws.views[0].ySplit === 1 && ws.views[0].xSplit === 1)
  check('Dep (Books) amount cells use the amount format', /#,##0\.00/.test(ws.getCell('C2').numFmt || ''))
  const dv = ws.getCell('A2').dataValidation
  check('Dep (Books) Asset Category is a dropdown of the Schedule II categories', dv?.type === 'list' && JSON.stringify(listValues(x, dv)) === JSON.stringify(scheduleII.map(r => r.category)), dv)
  check('Dep (Books) Asset Category dropdown refuses other values', dv?.showErrorMessage === true && dv?.errorStyle === 'stop')
  check('Dep (Books) dropdown reaches far below the header (open-ended)', ws.getCell('A150').dataValidation?.type === 'list')
  check('Dep (Books) has no dropdown on amount columns', !ws.getCell('B2').dataValidation)
  check('Dep (Books) list sheet (categories have commas) is hidden', x.getWorksheet(m.LISTS_SHEET)?.state === 'veryHidden')
  check('Dep (Books) reference sheet has a blue header', isBlueHeader(x.getWorksheet('Schedule II Reference').getCell('A1')))
  const guideText = []; x.getWorksheet(m.HOW_TO_SHEET).eachRow(r => r.eachCell(c => guideText.push(String(c.value ?? ''))))
  check('Dep (Books) How to Fill explains steps, columns and colours', ['How to fill it', 'Columns', 'Colours used in this file', 'Step 1', 'Asset Category'].every(t => guideText.includes(t)))
  check('blank Dep (Books) template parses to no rows', m.parseDepCompWorkbook(wb).rows.length === 0, m.parseDepCompWorkbook(wb))

  const rows = [
    { category: 'Plant and Machinery, general', grossOpen: '500000', additions: '125000.5', deductions: '', grossClose: '625000.5', depOpen: '100000', depForYear: '60000', depOnDisposal: '', depClose: '160000', netBlockOpen: '400000', netBlockClose: '465000.5' },
    { category: 'Furniture and fittings', grossOpen: '80000', additions: '', deductions: '5000', grossClose: '75000', depOpen: '20000', depForYear: '7000', depOnDisposal: '1000', depClose: '26000', netBlockOpen: '60000', netBlockClose: '49000' },
  ]
  const filled = await m.finishWorkbook(m.buildDepCompFilledWorkbook(rows, scheduleII), m.depCompExcelSpec('filled', scheduleII))
  const parsed = m.parseDepCompWorkbook(reopen(filled))
  check('filled Dep (Books) file reads back the same rows', JSON.stringify(parsed.rows) === JSON.stringify(rows), parsed.rows)
  const fx = await exceljs(filled)
  check('filled Dep (Books) amounts are real numbers', typeof fx.getWorksheet('Dep (Comp) Filled').getCell('B2').value === 'number')
  check('filled Dep (Books) keeps the dropdown on its rows', fx.getWorksheet('Dep (Comp) Filled').getCell('A2').dataValidation?.type === 'list')
  check('old unstyled Dep (Books) file still parses', JSON.stringify(m.parseDepCompWorkbook(m.buildDepCompFilledWorkbook(rows, scheduleII)).rows) === JSON.stringify(rows))
  check('Dep (Books) without a Schedule II list has no dropdown', !(await exceljs(await m.finishWorkbook(m.buildDepCompBlankTemplate([]), m.depCompExcelSpec('template', [])))).getWorksheet('Dep (Comp) Template').getCell('A2').dataValidation)
  if (samplesAt) { writeFileSync(path.join(samplesAt, 'Sample - Dep Books Template.xlsx'), blank); writeFileSync(path.join(samplesAt, 'Sample - Dep Books Filled.xlsx'), filled) }
}

// ── Dep (Income Tax) ─────────────────────────────────────────────────────────
{
  const blank = await m.finishWorkbook(m.buildDepITBlankTemplate(blocks), m.depITExcelSpec('template', blocks))
  const wb = reopen(blank)
  check('Dep (IT) template opens on How to Fill', wb.SheetNames[0] === m.HOW_TO_SHEET, wb.SheetNames)
  check('Dep (IT) template keeps its data, WIP and reference sheets', ['Dep (IT) Template', 'Dep (IT) - WIP', 'IT Blocks Reference'].every(n => m.dataSheetNames(wb).includes(n)), wb.SheetNames)
  const x = await exceljs(blank); const ws = x.getWorksheet('Dep (IT) Template')
  check('Dep (IT) header is VERA blue with white bold text', isBlueHeader(ws.getCell('A1')) && isBlueHeader(ws.getCell('F1')))
  check('Dep (IT) ledger, block and amount cells are pale yellow', isYellow(ws.getCell('A2')) && isYellow(ws.getCell('B2')) && isYellow(ws.getCell('F10')))
  const dv = ws.getCell('B2').dataValidation
  check('Dep (IT) Asset Block is a dropdown of the Income-tax blocks', dv?.type === 'list' && JSON.stringify(listValues(x, dv)) === JSON.stringify(blocks.map(b => b.block)), dv)
  check('Dep (IT) Asset Block dropdown refuses other values', dv?.showErrorMessage === true && dv?.errorStyle === 'stop')
  check('Dep (IT) Ledger / Asset Name has no dropdown (client-specific)', !ws.getCell('A2').dataValidation)
  const wip = x.getWorksheet('Dep (IT) - WIP')
  check('Dep (IT) WIP sheet: blue header, yellow amounts, fixed labels not yellow', isBlueHeader(wip.getCell('A1')) && isYellow(wip.getCell('B2')) && isYellow(wip.getCell('B4')) && !isYellow(wip.getCell('A2')))
  check('Dep (IT) reference sheet has a blue header', isBlueHeader(x.getWorksheet('IT Blocks Reference').getCell('B1')))
  const parsedBlank = m.parseDepITWorkbook(wb, blocks)
  check('blank Dep (IT) template parses to no rows (never the guide sheet)', Object.keys(parsedBlank.rows).length === 0 && parsedBlank.unmatched.length === 0, parsedBlank)

  const ledgers = [{ ledger_name: 'Plant & Machinery' }, { ledger_name: 'Computers' }, { ledger_name: 'Furniture' }]
  const inputs = {
    'Plant & Machinery': { block: 'b2', openingWDV: '450000', addBefore180: '20000', addAfter180: '100000.75', deduction: '' },
    'Computers': { block: 'b3', openingWDV: '60000', addBefore180: '', addAfter180: '', deduction: '5000' },
    'Furniture': { block: '', openingWDV: '', addBefore180: '', addAfter180: '', deduction: '' },
  }
  const wipIn = { capitalCY: '250000', intangibleCY: '', prevYearTotal: '100000' }
  const filled = await m.finishWorkbook(m.buildDepITFilledWorkbook(ledgers, inputs, blocks, wipIn), m.depITExcelSpec('filled', blocks))
  const parsed = m.parseDepITWorkbook(reopen(filled), blocks)
  check('filled Dep (IT) file reads back the same rows', JSON.stringify(parsed.rows) === JSON.stringify(inputs), parsed.rows)
  check('filled Dep (IT) file reads back Work in Progress', JSON.stringify(parsed.wip) === JSON.stringify(wipIn), parsed.wip)
  check('filled Dep (IT) file has no unmatched blocks', parsed.unmatched.length === 0, parsed.unmatched)
  const fx = await exceljs(filled)
  check('filled Dep (IT) amounts are real numbers', typeof fx.getWorksheet('Dep (IT) Filled').getCell('C2').value === 'number')
  const old = m.parseDepITWorkbook(m.buildDepITFilledWorkbook(ledgers, inputs, blocks, wipIn), blocks)
  check('old unstyled Dep (IT) file still parses', JSON.stringify(old.rows) === JSON.stringify(inputs) && JSON.stringify(old.wip) === JSON.stringify(wipIn))
  if (samplesAt) { writeFileSync(path.join(samplesAt, 'Sample - Dep IT Template.xlsx'), blank); writeFileSync(path.join(samplesAt, 'Sample - Dep IT Filled.xlsx'), filled) }
}

if (samplesAt) console.log('samples written to', samplesAt)
rmSync(dir, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
