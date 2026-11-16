// T-047: the VERA Excel theme on the Trial Balance template, the Mapping Rules file, the
// Learned Ledger Rules file and the "all workings" backup. Each file is built by the
// real main-process code (database, Electron and IPC stubbed), themed as the renderer
// does at save time (utils/tbExcelSpecs.js), and read back by the real upload reader.
// Usage: node scripts/fsg-excel-theme-tb-checks.mjs [--samples <dir>]
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const samplesAt = process.argv.includes('--samples') ? process.argv[process.argv.indexOf('--samples') + 1] : null

// Stubs: the database answers from globalThis.__fsgDb, IPC handlers are collected.
const STUBS = {
  'db/client.js': `export const query = (...a) => globalThis.__fsgDb.query(...a); export const runInTransaction = async (fn) => fn(); export const getDB = () => null`,
  'db/schema.js': `export const tryClaimMigration = async () => false`,
  'paths.js': `export const assetPath = (n) => n; export const userDataPath = (n) => n`,
  'db/level1-fallbacks.js': `export const ensureLevel1Fallbacks = async () => {}; export const PRE_FALLBACK_WORKBOOK_HASH = ''; export const FALLBACK_WORKBOOK_HASH = ''`,
  'ipc-registry.js': `const h = new Map(); globalThis.__fsgHandlers = h; export const ipcMain = { handle: (c, f) => h.set(c, f) }; export const getRegisteredHandlers = () => h`,
  'services/mapping-engine.js': `export const runMappingEngine = async () => ({}); export const persistMappingResults = async () => {}`,
  'electron': `export const dialog = {}; export default {}`,
}
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      const hit = Object.keys(STUBS).find(k => a.path === k || a.path.endsWith('/' + k))
      return hit && (a.path === 'electron' || a.path.startsWith('.')) ? { path: hit, namespace: 'stub' } : undefined
    })
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }))
  },
}

const entry = `
import * as XLSX from 'xlsx-js-style'
import ExcelJS from 'exceljs'
import { finishWorkbook, HOW_TO_SHEET } from './src/modules/fsg/utils/veraExcel.js'
import { tbTemplateExcelSpec, mappingRulesExcelSpec, learnedRulesExcelSpec, workingsExcelSpec } from './src/modules/fsg/utils/tbExcelSpecs.js'
import { parseTBExcel, generateTBTemplate, exportMappingToExcel, readMappingFile } from './electron/fsg/services/excel.js'
import { registerMappedTBHandlers } from './electron/fsg/ipc/mapped-tb.js'
import { readWorkingsWorkbook } from './electron/fsg/ipc/workings.js'

export { XLSX, ExcelJS, finishWorkbook, HOW_TO_SHEET, tbTemplateExcelSpec, mappingRulesExcelSpec, learnedRulesExcelSpec, workingsExcelSpec,
  parseTBExcel, generateTBTemplate, exportMappingToExcel, readMappingFile, registerMappedTBHandlers, readWorkingsWorkbook }
`
const dir = mkdtempSync(path.join(tmpdir(), 'fsg-excel-theme-tb-'))
const out = path.join(dir, 'bundle.mjs')
await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  plugins: [stubPlugin], banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
const m = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok  ', name) } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)) } }
const exceljs = async (bytes) => { const w = new m.ExcelJS.Workbook(); await w.xlsx.load(bytes); return w }
const BLUE = 'FF1E40AF', INPUT = 'FFFFF9DB'
const toBuf = (u8) => Buffer.from(u8)
const opensOnGuide = (bytes) => m.XLSX.read(bytes, { type: 'array' }).SheetNames[0] === m.HOW_TO_SHEET

// ── Trial Balance template ─────────────────────────────────────────────────
const tbBytes = await m.finishWorkbook(new Uint8Array(m.generateTBTemplate()), m.tbTemplateExcelSpec())
check('TB template opens on How to Fill', opensOnGuide(tbBytes))
const tbx = await exceljs(tbBytes)
const tbs = tbx.getWorksheet('Trial Balance')
check('TB template keeps its "Trial Balance" sheet and headers', tbs && tbs.getCell('A1').value === 'Period' && tbs.getCell('U1').value === 'Group.$Parent.8')
check('TB template header is VERA blue', tbs.getCell('D1').fill?.fgColor?.argb === BLUE && tbs.getCell('D1').font?.bold)
check('TB template cells are yellow to fill in', tbs.getCell('D2').fill?.fgColor?.argb === INPUT && tbs.getCell('U150').fill?.fgColor?.argb === INPUT)
const dvI = tbs.getCell('I2').dataValidation, dvJ = tbs.getCell('J201').dataValidation
check('IsRevenue / IsDeemedPositive have a strict Yes/No dropdown', dvI?.type === 'list' && dvI.formulae[0] === '"Yes,No"' && dvI.errorStyle === 'stop' && dvJ?.formulae?.[0] === '"Yes,No"', { dvI, dvJ })
check('no dropdown on free-text columns (Name, Parent)', !tbs.getCell('D2').dataValidation && !tbs.getCell('L2').dataValidation)
// Fill two ledgers in the themed template, save in Excel style (ExcelJS), upload.
tbs.getCell('D2').value = 'Cash in hand'; tbs.getCell('H2').value = 15000.5; tbs.getCell('I2').value = 'No'; tbs.getCell('J2').value = 'Yes'; tbs.getCell('L2').value = 'Cash-in-Hand'
tbs.getCell('D3').value = 'Sales'; tbs.getCell('H3').value = -15000.5; tbs.getCell('I3').value = 'Yes'; tbs.getCell('J3').value = 'No'; tbs.getCell('L3').value = 'Sales Accounts'
const tbFilled = new Uint8Array(await tbx.xlsx.writeBuffer())
const tbRows = m.parseTBExcel(toBuf(tbFilled))
check('a filled themed TB template uploads exactly its 2 ledgers (blank styled rows ignored)', tbRows.length === 2, tbRows.length)
check('the uploaded ledgers keep name, amount and Yes/No', tbRows[0]?.name === 'Cash in hand' && tbRows[0].closing_balance === 15000.5 && tbRows[0].is_revenue === false && tbRows[0].is_deemed_positive === true && tbRows[1]?.closing_balance === -15000.5 && tbRows[1].is_revenue === true, tbRows)
{ // an old (unstyled) template still reads
  const wb = m.XLSX.read(m.generateTBTemplate(), { type: 'buffer' }); const ws = wb.Sheets['Trial Balance']
  m.XLSX.utils.sheet_add_aoa(ws, [['', '', '', 'Old ledger', 0, 0, 0, 5]], { origin: 'A2' })
  const r = m.parseTBExcel(Buffer.from(m.XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })))
  check('an old TB template without the guide still uploads', r.length === 1 && r[0].name === 'Old ledger' && r[0].closing_balance === 5, r)
}
{ // renderer TB parsers (Tally, Real Books) read the first sheet that is not the guide
  const src = readFileSync(path.join(root, 'src/modules/fsg/utils/tallyParsers.js'), 'utf8')
  check('renderer TB parsers skip "How to Fill" / "Lists"', (src.match(/wb\.Sheets\[firstDataSheetName\(wb\)\]/g) || []).length === 3 && !/wb\.Sheets\[wb\.SheetNames\[0\]\]/.test(src))
}

// ── Mapping Rules ──────────────────────────────────────────────────────────
// A realistic size: about 700 LevelFormat lines and 300 rules per Map sheet.
const lfRows = Array.from({ length: 700 }, (_, i) => ({ constitution: 1 + (i % 3), alie: ['ASSETS', 'EQUITY AND LIABILITIES', 'Income', 'Expenses'][i % 4], level1: 'Head ' + (i % 20), level2: 'Sub ' + i, level3: 'Line ' + i, level4: '', level5: 'Opt A/Opt B', level6: null, level7: null }))
const mapRows = (n, extra) => Array.from({ length: n }, (_, i) => ({ constitution: 1 + (i % 3), ...extra(i) }))
globalThis.__fsgDb = { query: async (sql) => {
  if (/FROM level_format/.test(sql)) return { rows: lfRows }
  if (/FROM map1/.test(sql)) return { rows: mapRows(280, i => ({ 'Tally Pre-Primary': 'Group ' + i, 'Mapping1 Resultant': 'Head ' + (i % 20) })) }
  if (/FROM map2/.test(sql)) return { rows: mapRows(240, i => ({ Keyword: 'kw' + i, 'Mapping2 Resultant': 'Sub ' + i, 'Mapping1 Resultant': 'Head 1', Priority: 1, 'Notes for understanding': 'note, with a comma' })) }
  if (/FROM map3/.test(sql)) return { rows: mapRows(320, i => ({ Keyword: 'kw' + i, 'Mapping1 Resultant': 'Head 1', 'Mapping2 Resultant': 'Sub 1', 'Mapping3 Resultant': 'Line ' + i, Priority: 2, 'Notes for understanding': '' })) }
  return { rows: [] }
} }
const t0 = Date.now()
const mapBytes = await m.finishWorkbook(new Uint8Array(await m.exportMappingToExcel(7)), m.mappingRulesExcelSpec())
const ms = Date.now() - t0
check(`Mapping Rules file (about 1,540 rows) is themed quickly (${ms} ms, limit 3000)`, ms < 3000, ms)
check('Mapping Rules file opens on How to Fill', opensOnGuide(mapBytes))
const mx = await exceljs(mapBytes)
const lfs = mx.getWorksheet('LevelFormat')
check('Mapping Rules keeps LevelFormat / Map1 / Map2 / Map3', ['LevelFormat', 'Map1', 'Map2', 'Map3'].every(n => mx.getWorksheet(n)))
check('Mapping Rules headers are VERA blue', ['LevelFormat', 'Map1', 'Map2', 'Map3'].every(n => mx.getWorksheet(n).getCell('A1').fill?.fgColor?.argb === BLUE))
check('Constitution has a strict 1/2/3 dropdown on every Map sheet', ['LevelFormat', 'Map1', 'Map2', 'Map3'].every(n => { const d = mx.getWorksheet(n).getCell('A3').dataValidation; return d?.type === 'list' && d.formulae[0] === '"1,2,3"' && d.errorStyle === 'stop' }))
check('ALIE has a strict dropdown of the four heads on LevelFormat', lfs.getCell('B701').dataValidation?.formulae?.[0] === '"EQUITY AND LIABILITIES,ASSETS,Income,Expenses"')
check('no dropdown on the Mapping 1-7 captions (long, client-specific)', !lfs.getCell('C2').dataValidation && !lfs.getCell('H2').dataValidation)
const mapFile = path.join(dir, 'Mapping_Rules.xlsx'); writeFileSync(mapFile, mapBytes)
const read = m.readMappingFile(mapFile)
check('the themed Mapping Rules file reads back every row', read.levelFormat.length === 700 && read.map1.length === 280 && read.map2.length === 240 && read.map3.length === 320, [read.levelFormat.length, read.map1.length, read.map2.length, read.map3.length])
check('the themed Mapping Rules file reads back the same values', read.levelFormat[5].Constitution === '3' && read.levelFormat[5].ALIE === 'EQUITY AND LIABILITIES' && read.levelFormat[5]['Mapping 5'] === 'Opt A/Opt B' && read.map2[3].Keyword === 'kw3' && read.map2[3]['Notes for understanding'] === 'note, with a comma', [read.levelFormat[5], read.map2[3]])

// ── Learned Ledger Rules ───────────────────────────────────────────────────
m.registerMappedTBHandlers()
const H = globalThis.__fsgHandlers
const inserts = []
globalThis.__fsgDb = { query: async (sql, p) => {
  if (/FROM learned_ledger_rules WHERE entity_id/.test(sql)) return { rows: [
    { ledger_name: 'HDFC Bank', mapping1_resultant: 'Current assets', mapping2_resultant: 'Cash and cash equivalents', mapping3_resultant: 'Balances with banks', level4_value: 'Current account', alie: 'ASSETS', source_branch_name: '', updated_at: '2026-11-01T10:00:00Z' },
    { ledger_name: 'Rent', mapping1_resultant: 'Other expenses', mapping2_resultant: 'Rent', alie: 'Expenses', source_branch_name: 'Pune', updated_at: '2026-11-02T10:00:00Z' }] }
  if (/SELECT constitution FROM entities/.test(sql)) return { rows: [{ constitution: 3 }] }
  if (/INSERT INTO learned_ledger_rules/.test(sql)) { inserts.push(p); return { rows: [] } }
  return { rows: [] }
} }
const { buffer: lrBuf, count } = await H.get('learnedRules:download')(null, 9)
const lrBytes = await m.finishWorkbook(new Uint8Array(lrBuf), m.learnedRulesExcelSpec())
check('Learned Ledger Rules file opens on How to Fill', opensOnGuide(lrBytes) && count === 2)
const lx = await exceljs(lrBytes)
check('Learned Ledger Rules header is VERA blue', lx.getWorksheet('Learned Ledger Rules').getCell('A1').fill?.fgColor?.argb === BLUE)
await H.get('learnedRules:upload')(null, 9, Array.from(lrBytes))
check('the themed Learned Ledger Rules file uploads both ledgers with their mapping', inserts.length === 2 && inserts[0][2] === 'HDFC Bank' && inserts[0][3] === 'Current assets' && inserts[0][6] === 'Current account' && inserts[1][2] === 'Rent', inserts.map(p => p.slice(2, 7)))

// ── All workings ───────────────────────────────────────────────────────────
// Built as buildWorkingsWorkbook builds it (its data needs a database): Read me, the
// readable copies, Learned Ledger Rules and the "Workings data" JSON in 30,000-character parts.
const snap = { version: 1, source: { entityId: 4, entityName: 'Synthetic & Co. <Test>', yearLabel: '2025-26' }, areas: {
  remarks: Array.from({ length: 900 }, (_, i) => ({ scope: 'note', scope_key: `  ${i} `, remark: `Remark ₹ ${i}, "quoted" & <tagged>  ` })) } }
const json = JSON.stringify(snap)
const wwb = m.XLSX.utils.book_new()
m.XLSX.utils.book_append_sheet(wwb, m.XLSX.utils.aoa_to_sheet([['ICAI VERA - all workings'], [], ['Client', 'Synthetic']]), 'Read me')
m.XLSX.utils.book_append_sheet(wwb, m.XLSX.utils.aoa_to_sheet([['Category', 'Opening', 'Closing', 'PY Opening', 'PY Closing', 'Other-expenses head'], ['Raw Materials', 1000, 2000, 0, 0, '']]), 'Stock')
m.XLSX.utils.book_append_sheet(wwb, m.XLSX.utils.aoa_to_sheet([['Where', 'Item', 'Remark'], ['note', '1', 'r']]), 'Remarks')
m.XLSX.utils.book_append_sheet(wwb, m.XLSX.utils.json_to_sheet([{ 'Ledger Name': 'HDFC Bank', 'Mapping 1 (Broad)': 'Current assets' }]), 'Learned Ledger Rules')
const parts = [['Part', 'Data (do not edit)']]
for (let i = 0, p = 1; i < json.length; i += 30000, p++) parts.push([p, json.slice(i, i + 30000)])
m.XLSX.utils.book_append_sheet(wwb, m.XLSX.utils.aoa_to_sheet(parts), 'Workings data')
const wBytes = await m.finishWorkbook(Array.from(m.XLSX.write(wwb, { type: 'buffer', bookType: 'xlsx' })), m.workingsExcelSpec())
check('workings file opens on How to Fill', opensOnGuide(wBytes))
const wx = await exceljs(wBytes)
check('workings readable sheets have the VERA header', wx.getWorksheet('Stock').getCell('A1').fill?.fgColor?.argb === BLUE && wx.getWorksheet('Remarks').getCell('A1').fill?.fgColor?.argb === BLUE)
const wd = wx.getWorksheet('Workings data')
check('the "Workings data" sheet is left unstyled', !wd.getCell('A1').fill?.fgColor && !wd.getCell('B2').numFmt && wx.getWorksheet('Read me').getCell('A1').fill?.fgColor === undefined)
check('the JSON is split over more than one part (multi-part round trip is tested)', parts.length > 2, parts.length)
const back = m.readWorkingsWorkbook(Array.from(wBytes))
check('the themed workings file reads back the identical snapshot', JSON.stringify({ ...back, areas: { ...back.areas, learnedRulesSheet: undefined } }) === JSON.stringify({ ...snap, areas: { ...snap.areas, learnedRulesSheet: undefined } }))
check('the themed workings file still carries its Learned Ledger Rules', back.areas.learnedRulesSheet.length === 1 && back.areas.learnedRulesSheet[0]['Ledger Name'] === 'HDFC Bank')
check('an old workings file without the guide still reads', m.readWorkingsWorkbook(Array.from(m.XLSX.write(wwb, { type: 'buffer', bookType: 'xlsx' }))).areas.remarks.length === 900)

if (samplesAt) {
  writeFileSync(path.join(samplesAt, 'Sample - TB Template.xlsx'), tbBytes)
  writeFileSync(path.join(samplesAt, 'Sample - Mapping Rules.xlsx'), mapBytes)
  writeFileSync(path.join(samplesAt, 'Sample - Learned Ledger Rules.xlsx'), lrBytes)
  writeFileSync(path.join(samplesAt, 'Sample - Workings.xlsx'), wBytes)
  console.log('samples written to', samplesAt)
}
rmSync(dir, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
