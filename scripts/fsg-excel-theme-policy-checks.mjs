// T-047: the VERA Excel theme on the Policy format and the Financial Ratios template
// (blank and filled). Each finished file opens on "How to Fill", keeps its data where
// the upload reader expects it, has a blue header and yellow input cells; the Policy's
// Type column is a dropdown (a fixed list). Bundled with esbuild (xlsx-js-style / exceljs).
// Usage: node scripts/fsg-excel-theme-policy-checks.mjs [--samples <dir>]
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
import { buildPolicyBlankWorkbook, buildPolicyFilledWorkbook, parsePolicyWorkbook, policyExcelSpec, withoutLegacyPolicyGuide } from './src/modules/fsg/utils/policyWorkbook.js'
import { buildRatioBlankTemplate, buildRatioFilledWorkbook, parseRatioWorkbook, ratioExcelSpec } from './src/modules/fsg/components/GeneralNotes/ratioWorkbook.js'
import { RATIO_ROWS_META } from './src/modules/fsg/utils/ratios.js'
export { XLSX, ExcelJS, finishWorkbook, dataSheetNames, HOW_TO_SHEET, buildPolicyBlankWorkbook, buildPolicyFilledWorkbook, parsePolicyWorkbook, policyExcelSpec, withoutLegacyPolicyGuide,
  buildRatioBlankTemplate, buildRatioFilledWorkbook, parseRatioWorkbook, ratioExcelSpec, RATIO_ROWS_META }
`
const dir = mkdtempSync(path.join(tmpdir(), 'fsg-excel-theme-policy-'))
const out = path.join(dir, 'bundle.mjs')
await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
const m = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok  ', name) } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)) } }
const reopen = (bytes) => m.XLSX.read(bytes, { type: 'array' })
const exceljs = async (bytes) => { const w = new m.ExcelJS.Workbook(); await w.xlsx.load(bytes); return w }
const BLUE = 'FF1E40AF', INPUT = 'FFFFF9DB'
const guideHas = (ws, texts) => { const t = []; ws.eachRow(r => r.eachCell(c => t.push(String(c.value ?? '')))); return texts.every(x => t.some(v => v.includes(x))) }

// ── Policy ────────────────────────────────────────────────────────────────
const points = [
  { id: 'p1', header: 'Basis of Preparation', contentHtml: '<p>Prepared under the historical cost convention.</p><ul><li><p>Going concern</p></li><li><p>Accrual</p></li></ul>' },
  { id: 'p2', header: 'Financial Ratios', contentHtml: '<p>The ratios are:</p><table><tr><td>x</td></tr></table>' },
]
const policyBlank = await m.finishWorkbook(m.withoutLegacyPolicyGuide(m.buildPolicyBlankWorkbook()), m.policyExcelSpec('template'))
const pbWb = reopen(policyBlank)
check('Policy format opens on How to Fill', pbWb.SheetNames[0] === m.HOW_TO_SHEET, pbWb.SheetNames)
check('Policy format has one guide sheet (the old "How to fill" is replaced)', pbWb.SheetNames.filter(n => n.toLowerCase() === 'how to fill').length === 1 && m.dataSheetNames(pbWb).join('|') === 'Policy', pbWb.SheetNames)
const pbx = await exceljs(policyBlank); const pws = pbx.getWorksheet('Policy')
check('Policy header is VERA blue with white bold text', pws.getCell('A1').fill?.fgColor?.argb === BLUE && pws.getCell('C1').font?.bold && pws.getCell('C1').font?.color?.argb === 'FFFFFFFF')
check('Policy heading, type and text cells are yellow to fill in', ['A2', 'B2', 'C2'].every(a => pws.getCell(a).fill?.fgColor?.argb === INPUT))
check('Policy has room below the example to add sections', pws.getCell('C40').fill?.fgColor?.argb === INPUT)
const dv = pws.getCell('B2').dataValidation
check('Policy Type is a strict dropdown of Paragraph / Bullet / Table', dv?.type === 'list' && dv.formulae?.[0] === '"Paragraph,Bullet,Table"' && dv.showErrorMessage === true && dv.errorStyle === 'stop', dv)
check('the Type dropdown also covers added rows', pws.getCell('B150').dataValidation?.type === 'list')
check('no dropdown on Section heading or Text (free wording)', !pws.getCell('A2').dataValidation && !pws.getCell('C2').dataValidation)
check('Policy has no Excel filter (sorting would scramble sections)', !pws.autoFilter)
check('Policy How to Fill explains steps, columns and the Type dropdown', guideHas(pbx.getWorksheet(m.HOW_TO_SHEET), ['How to fill it', 'Columns', 'Step 1', 'Type', 'Dropdown']))
const pbParsed = m.parsePolicyWorkbook(pbWb, [])
const pbOld = m.parsePolicyWorkbook(reopen(m.XLSX.write(m.buildPolicyBlankWorkbook(), { type: 'array', bookType: 'xlsx' })), [])
check('blank Policy format parses to the same example sections as before', JSON.stringify(pbParsed.points.map(p => [p.header, p.contentHtml])) === JSON.stringify(pbOld.points.map(p => [p.header, p.contentHtml])) && pbParsed.points.length === 2 && !pbParsed.errors.length, pbParsed)

const policyFilled = await m.finishWorkbook(m.withoutLegacyPolicyGuide(m.buildPolicyFilledWorkbook(points)), m.policyExcelSpec('filled'))
const pfParsed = m.parsePolicyWorkbook(reopen(policyFilled), points)
check('filled Policy file reads back the same sections, bullets and kept table', pfParsed.points.length === 2 && pfParsed.points[0].header === 'Basis of Preparation' &&
  pfParsed.points[0].contentHtml === points[0].contentHtml && pfParsed.points[1].contentHtml === points[1].contentHtml && !pfParsed.errors.length && !pfParsed.warnings.length, pfParsed)
check('an old (unstyled) Policy file still reads', m.parsePolicyWorkbook(reopen(m.XLSX.write(m.buildPolicyFilledWorkbook(points), { type: 'array', bookType: 'xlsx' })), points).points.length === 2)
{ // A file whose Policy sheet was renamed: the reader must not take the guide sheet.
  const w = reopen(policyFilled); const i = w.SheetNames.indexOf('Policy'); w.SheetNames[i] = 'My Policy'; w.Sheets['My Policy'] = w.Sheets.Policy; delete w.Sheets.Policy
  const r = m.parsePolicyWorkbook(w, points)
  check('a renamed Policy sheet is read, never the How to Fill guide', r.points.length === 2 && !r.errors.length, r)
}

// ── Financial Ratios ──────────────────────────────────────────────────────
const ratios = m.RATIO_ROWS_META.map((meta, i) => ({ ...meta, numeratorValue: 100000 + i, denominatorValue: 50000 + i, cy: meta.format === 'percent' ? 0.0913 : 1.81, py: meta.format === 'percent' ? 0.08 : 1.5, variancePct: 12.5 }))
const ratioBlank = await m.finishWorkbook(m.buildRatioBlankTemplate(), m.ratioExcelSpec('template'))
const rbWb = reopen(ratioBlank)
check('Ratio template opens on How to Fill', rbWb.SheetNames[0] === m.HOW_TO_SHEET && m.dataSheetNames(rbWb).join('|') === 'Financial Ratios', rbWb.SheetNames)
const rbx = await exceljs(ratioBlank); const rws = rbx.getWorksheet('Financial Ratios')
check('Ratio header is VERA blue', rws.getCell('A1').fill?.fgColor?.argb === BLUE && rws.getCell('H1').fill?.fgColor?.argb === BLUE)
check('Ratio figure cells are yellow; Particulars / Numerator / Denominator are not', ['C2', 'E2', 'F2', 'G2', 'H12'].every(a => rws.getCell(a).fill?.fgColor?.argb === INPUT) && ['A2', 'B2', 'D2'].every(a => rws.getCell(a).fill?.fgColor?.argb !== INPUT))
check('Ratio template has no dropdowns (no column is a list to choose from)', !rbx.getWorksheet('Lists') && !['A2', 'B2', 'C2', 'F2'].some(a => rws.getCell(a).dataValidation))
check('the note under the ratio table stays grey text', rws.getCell(`A${1 + 11 + 2}`).font?.italic === true, rws.getCell(`A${1 + 11 + 2}`).value)
check('Ratio How to Fill explains steps and columns', guideHas(rbx.getWorksheet(m.HOW_TO_SHEET), ['How to fill it', 'Columns', 'Particulars', 'Variance %']))
const rbParsed = m.parseRatioWorkbook(rbWb)
check('blank Ratio template parses to 11 matched, empty rows', rbParsed.matched === 11 && rbParsed.unmatched.length === 0 && rbParsed.extraRows.length === 0 && rbParsed.rows.every(r => r.cy === null), rbParsed)

const ratioFilled = await m.finishWorkbook(m.buildRatioFilledWorkbook(ratios), m.ratioExcelSpec('filled'))
const rfParsed = m.parseRatioWorkbook(reopen(ratioFilled))
const rfOld = m.parseRatioWorkbook(reopen(m.XLSX.write(m.buildRatioFilledWorkbook(ratios), { type: 'array', bookType: 'xlsx' })))
check('filled Ratio file reads back the same figures as an unstyled one', JSON.stringify(rfParsed) === JSON.stringify(rfOld) && rfParsed.matched === 11, { rfParsed: rfParsed.rows[3], rfOld: rfOld.rows[3] })
check('filled Ratio percentage rows round-trip (9.13% -> 0.0913)', Math.abs(rfParsed.rows.find(r => r.key === 'roe').cy - 0.0913) < 1e-9 && rfParsed.rows.find(r => r.key === 'current').numeratorValue === 100000)
const rfx = await exceljs(ratioFilled)
check('filled Ratio amounts are real numbers in Excel', typeof rfx.getWorksheet('Financial Ratios').getCell('C2').value === 'number')
{
  const w = reopen(ratioFilled); w.SheetNames = w.SheetNames.map(n => n === 'Financial Ratios' ? 'Ratios' : n); w.Sheets.Ratios = w.Sheets['Financial Ratios']; delete w.Sheets['Financial Ratios']
  check('a renamed Ratio sheet is read, never the How to Fill guide', m.parseRatioWorkbook(w).matched === 11)
}

if (samplesAt) {
  writeFileSync(path.join(samplesAt, 'Sample - Policy Format.xlsx'), policyBlank)
  writeFileSync(path.join(samplesAt, 'Sample - Policy Filled.xlsx'), policyFilled)
  writeFileSync(path.join(samplesAt, 'Sample - Financial Ratios Template.xlsx'), ratioBlank)
  writeFileSync(path.join(samplesAt, 'Sample - Financial Ratios Filled.xlsx'), ratioFilled)
  console.log('samples written to', samplesAt)
}
rmSync(dir, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
