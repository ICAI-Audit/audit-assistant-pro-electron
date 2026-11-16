// T-047: the VERA Excel theme (src/modules/fsg/utils/veraExcel.js) — every finished
// file opens on "How to Fill", keeps its data where the upload reader expects it,
// has a blue header and real dropdowns. Bundled with esbuild (xlsx-js-style / exceljs).
// Usage: node scripts/fsg-excel-theme-checks.mjs [--samples <dir>]
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
import { finishWorkbook, dataSheetNames, HOW_TO_SHEET } from './src/modules/fsg/utils/veraExcel.js'
import { buildStockBlankTemplate, buildStockFilledWorkbook, parseStockWorkbook, stockExcelSpec } from './src/modules/fsg/components/Stock/stockWorkbook.js'
export { XLSX, ExcelJS, finishWorkbook, dataSheetNames, HOW_TO_SHEET, buildStockBlankTemplate, buildStockFilledWorkbook, parseStockWorkbook, stockExcelSpec }
`
const dir = mkdtempSync(path.join(tmpdir(), 'fsg-excel-theme-'))
const out = path.join(dir, 'bundle.mjs')
await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
const m = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok  ', name) } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)) } }
const reopen = (bytes) => m.XLSX.read(bytes, { type: 'array' })
const exceljs = async (bytes) => { const w = new m.ExcelJS.Workbook(); await w.xlsx.load(bytes); return w }

// Inventory — blank template
const heads = ['Consumption of stores and spare parts', 'Repairs and maintenance, other']
const blank = await m.finishWorkbook(m.buildStockBlankTemplate(), m.stockExcelSpec('template'))
const blankWb = reopen(blank)
check('Inventory template opens on How to Fill', blankWb.SheetNames[0] === m.HOW_TO_SHEET, blankWb.SheetNames)
check('Inventory template keeps its data sheet', m.dataSheetNames(blankWb).includes('Stock Template'), blankWb.SheetNames)
const bx = await exceljs(blank)
const st = bx.getWorksheet('Stock Template')
check('Inventory header is VERA blue with white bold text', st.getCell('A1').fill?.fgColor?.argb === 'FF1E40AF' && st.getCell('A1').font?.bold && st.getCell('A1').font?.color?.argb === 'FFFFFFFF')
check('Inventory amount cells are pale yellow to fill in', st.getCell('B2').fill?.fgColor?.argb === 'FFFFF9DB')
check('Inventory header row is frozen', st.views?.[0]?.state === 'frozen' && st.views[0].ySplit === 1)
const sRow = 2 + ['Raw Materials', 'Work in Progress', 'Finished Goods', 'Stock-in-Trade', 'Stores & Spares'].length - 1
// A list with a comma in a value lives on the hidden Lists sheet; resolve it either way.
const listValues = (dv) => {
  const f = dv?.formulae?.[0] || ''
  if (f.startsWith('"')) return f.slice(1, -1).split(',')
  const mm = f.match(/^'?([^'!]+)'?!\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)$/)
  if (!mm) return []
  const ls = bx.getWorksheet(mm[1]); const out = []
  for (let r = +mm[3]; r <= +mm[4]; r++) out.push(String(ls.getCell(`${mm[2]}${r}`).value))
  return out
}
void listValues
// Owner, 15 Nov 2026: no dropdown for a long, client-specific list (Other expenses lines).
check('"Adjusted in" is free text, no dropdown', !st.getCell(`F${sRow}`).dataValidation && !bx.getWorksheet('Lists'), st.getCell(`F${sRow}`).dataValidation)
check('"Adjusted in" is yellow only on the rows that take a head', st.getCell(`F${sRow}`).fill?.fgColor?.argb === 'FFFFF9DB' && st.getCell('F2').fill?.fgColor?.argb !== 'FFFFF9DB')
check('the Type of Inventory column is not yellow (it is fixed)', st.getCell('A2').fill?.fgColor?.argb !== 'FFFFF9DB')
check('the note under the table stays plain grey text', st.getCell(`A${2 + 8 + 1}`).font?.italic === true, st.getCell(`A${2 + 8 + 1}`).value)

// The dropdown mechanism itself, on a fixed list: a short list is written inline, a
// long one on the hidden Lists sheet; both are real list validations Excel shows.
{
  const wb = m.XLSX.utils.book_new()
  m.XLSX.utils.book_append_sheet(wb, m.XLSX.utils.aoa_to_sheet([['Item', 'Applicable?', 'Block'], ['A', '', ''], ['B', '', '']]), 'Data')
  const longList = Array.from({ length: 40 }, (_, i) => `Block ${i + 1} - plant and machinery, general rate`)
  const bytes = await m.finishWorkbook(wb, { mode: 'template', sheets: { Data: { headerRow: 1, inputCols: ['B', 'C'], dropdowns: [
    { col: 'B', list: ['Yes', 'No'], name: 'Applicable?' }, { col: 'C', list: longList, name: 'Block' }] } } })
  const x = await exceljs(bytes); const d = x.getWorksheet('Data')
  check('a short fixed list is an inline dropdown', d.getCell('B2').dataValidation?.type === 'list' && d.getCell('B2').dataValidation.formulae[0] === '"Yes,No"', d.getCell('B2').dataValidation)
  check('a short fixed list refuses other values', d.getCell('B3').dataValidation?.showErrorMessage === true && d.getCell('B3').dataValidation?.errorStyle === 'stop')
  check('a long fixed list is a dropdown from the hidden Lists sheet', d.getCell('C2').dataValidation?.type === 'list' && /^'Lists'!\$A\$1:\$A\$40$/.test(d.getCell('C2').dataValidation.formulae[0]) && x.getWorksheet('Lists')?.state === 'veryHidden', d.getCell('C2').dataValidation)
  check('finishWorkbook also takes .xlsx bytes', (await exceljs(await m.finishWorkbook(Array.from(new Uint8Array(m.XLSX.write(m.buildStockBlankTemplate(), { type: 'array', bookType: 'xlsx' }))), m.stockExcelSpec('template')))).worksheets[0].name === m.HOW_TO_SHEET)
}
const guide = bx.getWorksheet(m.HOW_TO_SHEET)
const guideText = []; guide.eachRow(r => r.eachCell(c => guideText.push(String(c.value ?? ''))))
check('How to Fill explains steps, columns and colours', ['How to fill it', 'Columns', 'Colours used in this file', 'Step 1'].every(t => guideText.includes(t)), guideText.slice(0, 12))

// Inventory — filled, round trip through the upload reader
const filled = await m.finishWorkbook(
  m.buildStockFilledWorkbook({ 'Raw Materials': '125000.50', 'Stores & Spares': '9000' }, { 'Raw Materials': '98000' }, { 'Finished Goods': '5000' }, {}, true, { 'Stores & Spares': heads[0] }),
  m.stockExcelSpec('filled', heads))
const parsed = m.parseStockWorkbook(reopen(filled))
check('filled Inventory file reads back the same figures', parsed.opening['Raw Materials'] === '125000.5' && parsed.closing['Raw Materials'] === '98000' && parsed.pyOpening['Finished Goods'] === '5000' && parsed.opening['Stores & Spares'] === '9000', parsed)
check('filled Inventory file reads back the Other expenses head', parsed.heads['Stores & Spares'] === heads[0], parsed.heads)
check('filled Inventory file has no unrecognised rows', parsed.unrecognised.length === 0, parsed.unrecognised)
const fx = await exceljs(filled)
check('filled amounts are real numbers in Excel', typeof fx.getWorksheet('Stock Filled').getCell('B2').value === 'number', fx.getWorksheet('Stock Filled').getCell('B2').value)
// An old (unstyled) file still reads
check('an old Inventory file without the guide still reads', m.parseStockWorkbook(m.buildStockFilledWorkbook({ 'Raw Materials': '1' }, {}, {}, {}, true, {})).opening['Raw Materials'] === '1')

if (samplesAt) {
  writeFileSync(path.join(samplesAt, 'Sample - Inventory Template.xlsx'), blank)
  writeFileSync(path.join(samplesAt, 'Sample - Inventory Filled.xlsx'), filled)
  console.log('samples written to', samplesAt)
}
rmSync(dir, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
