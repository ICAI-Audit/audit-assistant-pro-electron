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
import { buildPolicyBlankWorkbook, buildPolicyFilledWorkbook, withoutLegacyPolicyGuide, policyExcelSpec } from './src/modules/fsg/utils/policyWorkbook.js'
import JSZip from 'jszip'
import { buildFillDetailsWorkbook, fillDetailsExcelSpec, parseFillDetailsWorkbook } from './src/modules/fsg/components/GenerateFinancials/fillDetailsWorkbook.js'
import { tpPeriodView } from './src/modules/fsg/components/Notes/TradePayablesDisclosureForm.jsx'
import { trPeriodView, trScheduleTotal, trComputedCell } from './src/modules/fsg/components/Notes/TradeReceivablesAgingForm.jsx'
export { buildFillDetailsWorkbook, fillDetailsExcelSpec, parseFillDetailsWorkbook, tpPeriodView, trPeriodView, trScheduleTotal, trComputedCell }
export { XLSX, ExcelJS, JSZip, finishWorkbook, dataSheetNames, HOW_TO_SHEET, buildStockBlankTemplate, buildStockFilledWorkbook, parseStockWorkbook, stockExcelSpec }
export { buildPolicyBlankWorkbook, buildPolicyFilledWorkbook, withoutLegacyPolicyGuide, policyExcelSpec }
`
const dir = mkdtempSync(path.join(tmpdir(), 'fsg-excel-theme-'))
const out = path.join(dir, 'bundle.mjs')
await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, loader: { '.js': 'jsx' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
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

// T-059: Excel opened the Policy format only after a repair, and dropped its Type dropdown. Two causes in the finished
// file: <sheetFormatPr> without its required defaultRowHeight, and the dropdown written twice with overlapping ranges
// (ExcelJS sorted the cells as text, "B10" before "B2"). Both are in veraExcel.js, so every FSG template is checked here.
const rowsOf = (ref) => { const [a, b] = ref.split(':'); const n = (x) => Number(x.replace(/^[A-Z]+/, '')); return [n(a), n(b || a), a.replace(/\d+/g, '')] }
const xmlCheck = async (label, bytes, wantRange) => {
  const zip = await m.JSZip.loadAsync(bytes)
  const xml = await Promise.all(Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).map(f => zip.file(f).async('string')))
  check(`T-059 ${label}: every sheet has the default row height Excel requires`, xml.every(x => !/<sheetFormatPr(?![^>]*defaultRowHeight)[^>]*>/.test(x)), xml.map(x => (x.match(/<sheetFormatPr[^>]*>/) || [''])[0]))
  const refs = xml.flatMap(x => [...x.matchAll(/<dataValidation [^>]*sqref="([^"]+)"/g)].map(r => r[1]))
  const ranges = refs.flatMap(r => r.split(' ')).map(rowsOf)
  const overlap = ranges.some((a, i) => ranges.some((b, j) => j > i && a[2] === b[2] && a[0] <= b[1] && b[0] <= a[1]))
  check(`T-059 ${label}: no two dropdowns overlap${wantRange ? `, and ${wantRange} is one range` : ''}`, !overlap && (!wantRange || refs.includes(wantRange)), refs)
}
const policyBlank = await m.finishWorkbook(m.withoutLegacyPolicyGuide(m.buildPolicyBlankWorkbook()), m.policyExcelSpec('template'))
await xmlCheck('Policy format (blank)', policyBlank, 'B2:B201')
await xmlCheck('Policy format (filled)', await m.finishWorkbook(m.withoutLegacyPolicyGuide(m.buildPolicyFilledWorkbook([{ header: 'Basis of preparation', contentHtml: '<p>One</p><ul><li><p>Two</p></li></ul>' }])), m.policyExcelSpec('filled')), 'B2:B201')
const policyTypes = (await exceljs(policyBlank)).getWorksheet('Policy')
check('T-059 Policy format: the Type dropdown offers Paragraph / Bullet / Table on row 2 and on row 150',
  ['B2', 'B150'].every(a => (policyTypes.getCell(a).dataValidation?.formulae || [])[0] === '"Paragraph,Bullet,Table"'), ['B2', 'B150'].map(a => policyTypes.getCell(a).dataValidation))
await xmlCheck('Inventory template', blank)
await xmlCheck('Inventory filled', filled)

// T-063: Trade Payables ageing in the owner's layout: Unbilled and Not Due before the four periods; grey cells refuse
// entries (rows (i) to (iv): Unbilled / Not Due; an Undue row takes Not Due only, an Unbilled row Unbilled only).
{
  const tpNotes = [{ num: 7, title: 'Trade Payables', total: 2100 }]
  const saved = { ageing: { cy: { msme: { less1y: 100, more3y: 2000 }, msme_undue: { less1y: 40 }, others_unbilled: { unbilled: 5 }, total_due: { less1y: 999 } }, py: {}, includeInOutput: true } }
  const v = m.tpPeriodView(saved.ageing.cy)
  check('T-063 old Undue figures move to Not Due; Total Due and Total are worked out',
    v.msme_undue.notdue === 40 && v.msme_undue.less1y === '' && v.total_due.less1y === 100 && v.total.notdue === 40 && v.total.unbilled === 5 && v.total.more3y === 2000, v)
  for (const blankFile of [true, false]) {
    const label = blankFile ? 'Trade Payables template' : 'Trade Payables filled'
    const wb = m.buildFillDetailsWorkbook(tpNotes, new Map([[7, saved]]), null, { blank: blankFile, constitution: 3 })
    const bytes = await m.finishWorkbook(wb, m.fillDetailsExcelSpec(wb))
    await xmlCheck(label, bytes)
    if (samplesAt) writeFileSync(path.join(samplesAt, `Sample - ${label}.xlsx`), bytes)
    const x = await exceljs(bytes)
    const ws = x.worksheets.find(w => /Trade Payables/.test(w.name))
    const hdr = ws.getRow(4).values.slice(1, 10).map(String)
    check(`T-063 ${label}: columns Unbilled, Not Due, then the four periods`, hdr.slice(3).join('|') === 'Unbilled|Not Due|Less than 1 yr.|1-2 yrs.|2-3 yrs.|More than 3 yrs.', hdr)
    const rowOf = (lbl) => { let at = 0; ws.eachRow((r, n) => { if (!at && r.getCell(3).value === lbl) at = n }); return at }
    const grey = (a) => ws.getCell(a).fill?.fgColor?.argb === 'FFBFBFBF'
    const shut = (a) => ws.getCell(a).dataValidation?.type === 'custom' && ws.getCell(a).dataValidation?.formulae?.[0] === 'FALSE'
    const i = rowOf('(i) MSME'), u = rowOf('MSME - Undue'), ub = rowOf('MSME - Unbilled dues'), td = rowOf('Total Due')
    check(`T-063 ${label}: (i) MSME Unbilled / Not Due grey and refuse entry; its periods open`, grey(`D${i}`) && grey(`E${i}`) && shut(`D${i}`) && shut(`E${i}`) && !grey(`F${i}`) && !shut(`I${i}`), [i, ws.getCell(`D${i}`).dataValidation])
    check(`T-063 ${label}: MSME - Undue takes Not Due only (Unbilled and periods grey, refuse entry)`, ['D', 'F', 'G', 'H', 'I'].every(c => grey(`${c}${u}`) && shut(`${c}${u}`)) && !grey(`E${u}`) && !shut(`E${u}`), u)
    check(`T-063 ${label}: MSME - Unbilled dues takes Unbilled only (Not Due and periods grey, refuse entry)`, ['E', 'F', 'G', 'H', 'I'].every(c => grey(`${c}${ub}`) && shut(`${c}${ub}`)) && !grey(`D${ub}`) && !shut(`D${ub}`), ub)
    check(`T-063 ${label}: Total Due is not an input cell`, ws.getCell(`F${td}`).fill?.fgColor?.argb !== 'FFFFF9DB' && !shut(`F${td}`), td)
    if (!blankFile) {
      const back = m.parseFillDetailsWorkbook(m.XLSX.read(bytes, { type: 'array' }), { constitution: 3 }).results[0]?.data?.ageing?.cy
      check('T-063 filled Trade Payables reads back: Not Due 40, Total 2,145', back?.msme_undue?.notdue === 40 && back?.total?.notdue === 40 && Math.round((back?.total ? Object.values(back.total).reduce((s, n) => s + n, 0) : 0)) === 2145, back)
    }
  }
  // A file downloaded before T-063 (four period columns only) still reads into the right columns.
  const old = m.XLSX.utils.aoa_to_sheet([['Note 7'], ['Trade Payables'], [], ['Section', 'Period', 'Particulars', 'Less than 1 yr.', '1-2 yrs.', '2-3 yrs.', 'More than 3 yrs.'],
    ['AGEING', 'CY', '(ii) Others', 10, 0, 0, 30], ['AGEING', 'CY', 'Others - Undue', 7, 0, 0, 0]])
  const owb = m.XLSX.utils.book_new(); m.XLSX.utils.book_append_sheet(owb, old, 'N7 Trade Payables')
  const ob = m.parseFillDetailsWorkbook(owb, { constitution: 3 }).results[0]?.data?.ageing?.cy
  check('T-063 an old four-column Trade Payables sheet still reads (Undue moves to Not Due)', ob?.others?.less1y === 10 && ob?.others?.more3y === 30 && ob?.others_undue?.notdue === 7 && ob?.total?.notdue === 7, ob)
}

// T-069: Trade Receivables ageing in the owner's layout: Unbilled and Not Due before the five periods; grey cells refuse
// entries (rows (i) to (iv): Unbilled; Unbilled Dues rows: Not Due and the periods); provision row open.
{
  const trNotes = [{ num: 9, title: 'Trade Receivables', total: 31000 }]
  const saved = { cy: { undis_good: { notdue: 30000, less6m: 1000, unbilled: 77 }, unbilled_good: { unbilled: 500 }, provision_doubtful: { less6m: 500 } }, py: {}, includeInOutput: true }
  const v = m.trPeriodView(saved.cy)
  check('T-069 (i) Unbilled is nil (grey); Not Due counts in Total Due and Total Trade Receivable',
    v.undis_good.unbilled === '' && m.trComputedCell(v, 'due', 'notdue') === 30000 && m.trScheduleTotal(saved.cy) === 31000, [v, m.trScheduleTotal(saved.cy)])
  const legacy = m.trPeriodView({ unbilled_doubtful: { less6m: 200, '1y2y': 50 }, dis_good: { more3y: 9 } })
  check('T-069 older Unbilled Dues figures (period columns) move to Unbilled; totals unchanged',
    legacy.unbilled_doubtful.unbilled === 250 && legacy.unbilled_doubtful.less6m === '' && legacy.dis_good.more3y === 9 && m.trScheduleTotal({ unbilled_doubtful: { less6m: 200, '1y2y': 50 }, dis_good: { more3y: 9 } }) === 259, legacy)
  for (const blankFile of [true, false]) {
    const label = blankFile ? 'Trade Receivables template' : 'Trade Receivables filled'
    const wb = m.buildFillDetailsWorkbook(trNotes, new Map([[9, saved]]), null, { blank: blankFile, constitution: 3 })
    const bytes = await m.finishWorkbook(wb, m.fillDetailsExcelSpec(wb))
    await xmlCheck(label, bytes)
    if (samplesAt) writeFileSync(path.join(samplesAt, `Sample - ${label}.xlsx`), bytes)
    const x = await exceljs(bytes)
    const ws = x.worksheets.find(w => /Trade Receivables/.test(w.name))
    const hdr = ws.getRow(4).values.slice(1, 10).map(String)
    check(`T-069 ${label}: columns Unbilled, Not Due, then the five periods`, hdr.slice(2).join('|') === 'Unbilled|Not Due|Less than 6 months|6 months - 1 year|1-2 yrs.|2-3 yrs.|More than 3 yrs.', hdr)
    const rowOf = (lbl) => { let at = 0; ws.eachRow((r, n) => { if (!at && r.getCell(2).value === lbl) at = n }); return at }
    const grey = (a) => ws.getCell(a).fill?.fgColor?.argb === 'FFBFBFBF'
    const shut = (a) => ws.getCell(a).dataValidation?.type === 'custom' && ws.getCell(a).dataValidation?.formulae?.[0] === 'FALSE'
    const i = rowOf('(i) Undisputed Trade receivables - considered good'), ub = rowOf('Unbilled Dues - considered good'), pr = rowOf('Less: Provision for doubtful debts')
    check(`T-069 ${label}: (i) Unbilled grey and refuses entry; Not Due and periods open`, i && grey(`C${i}`) && shut(`C${i}`) && !grey(`D${i}`) && !shut(`D${i}`) && !shut(`I${i}`), [i, ws.getCell(`C${i}`).dataValidation])
    check(`T-069 ${label}: Unbilled Dues takes Unbilled only (Not Due and periods grey, refuse entry)`, ub && ['D', 'E', 'F', 'G', 'H', 'I'].every(c => grey(`${c}${ub}`) && shut(`${c}${ub}`)) && !grey(`C${ub}`) && !shut(`C${ub}`), ub)
    check(`T-069 ${label}: provision row fully open`, pr && ['C', 'D', 'E', 'I'].every(c => !grey(`${c}${pr}`) && !shut(`${c}${pr}`)), pr)
    if (!blankFile) {
      const back = m.parseFillDetailsWorkbook(m.XLSX.read(bytes, { type: 'array' }), { constitution: 3 }).results[0]?.data?.cy
      check('T-069 filled Trade Receivables reads back: Not Due 30,000, Unbilled 500, total 31,000', back?.undis_good?.notdue === 30000 && back?.unbilled_good?.unbilled === 500 && !back?.undis_good?.unbilled && m.trScheduleTotal(back) === 31000, back)
    }
  }
  // A file downloaded before T-069 (five period columns only) still reads into the right columns.
  const old = m.XLSX.utils.aoa_to_sheet([['Note 9'], ['Trade Receivables Ageing'], [], ['Period', 'Particulars', 'Less than 6 months', '6 months - 1 year', '1-2 yrs.', '2-3 yrs.', 'More than 3 yrs.'],
    ['CY', '(i) Undisputed Trade receivables - considered good', 10, 0, 0, 0, 30], ['CY', 'Unbilled Dues - considered good', 7, 0, 0, 0, 0]])
  const owb = m.XLSX.utils.book_new(); m.XLSX.utils.book_append_sheet(owb, old, 'N9 Trade Receivables Ageing')
  const ob = m.parseFillDetailsWorkbook(owb, { constitution: 3 }).results[0]?.data?.cy
  check('T-069 an old five-column Trade Receivables sheet still reads (Unbilled Dues move to Unbilled)', ob?.undis_good?.less6m === 10 && ob?.undis_good?.more3y === 30 && ob?.unbilled_good?.unbilled === 7 && !ob?.unbilled_good?.less6m, ob)
}

if (samplesAt) {
  writeFileSync(path.join(samplesAt, 'Sample - Inventory Template.xlsx'), blank)
  writeFileSync(path.join(samplesAt, 'Sample - Inventory Filled.xlsx'), filled)
  console.log('samples written to', samplesAt)
}
rmSync(dir, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
