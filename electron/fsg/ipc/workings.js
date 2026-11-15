// T-044: a Trial Balance's workings, kept when a new Trial Balance replaces it.
//
// Most of what a CA prepares in Financial Statement Review is stored against
// ONE Trial Balance (tb_id): Fill Details, disclosures, ITR details, remarks,
// the depreciation schedules, Stock, manual Previous Year figures, extra face
// lines, the P&L-closed / EPS settings, adjustments, journal entries and
// ledgers added on Mapped TB. A re-uploaded Trial Balance for the same year
// started without any of it. (Categorisation already carries forward through
// applyCarryForward and the learned ledger rules; Policy, Cash Flow, Tax,
// Deferred Tax, 3CD and Ratios belong to the year and are kept anyway.)
//
//   workings:summary    what a Trial Balance holds, per area
//   workings:carryOver  copy chosen areas to the new Trial Balance of the SAME year and branch
//   workings:export     every area (plus the client's learned ledger rules) as one Excel file
//   workings:import     the same file back into a Trial Balance (dryRun: preview only)
//
// Writes go through the existing handlers where they hold rules of their own
// (Stock: tb:saveStock; adjustments: mappedTB:setAdjustment; learned rules:
// learnedRules:upload), so nothing here bypasses them. Each carry-over or
// import runs in one transaction: it applies completely or not at all.
import XLSX from 'xlsx'
import { ipcMain, getRegisteredHandlers } from '../ipc-registry.js'
import { query, runInTransaction } from '../db/client.js'

export const WORKING_AREAS = [
  { key: 'notes', label: 'Notes - Fill Details' },
  { key: 'disclosures', label: 'Notes - disclosures' },
  { key: 'itr', label: 'ITR details' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'depBooks', label: 'Dep (Books) schedule' },
  { key: 'depIT', label: 'Dep (Income Tax) schedule' },
  { key: 'stock', label: 'Stock' },
  { key: 'manualPy', label: 'Manual Previous Year figures' },
  { key: 'faceLines', label: 'Extra Balance Sheet / P&L lines' },
  { key: 'settings', label: 'P&L closed to capital and EPS' },
  // Off by default: if they were since posted in the books, the new Trial Balance already contains them.
  { key: 'adjustments', label: 'Adjustments to ledgers', defaultOn: false },
  { key: 'manualLedgers', label: 'Journal entries and ledgers added on Mapped TB', defaultOn: false },
  { key: 'learnedRules', label: 'Learned ledger rules (whole client)', fileOnly: true },
]
const AREA = Object.fromEntries(WORKING_AREAS.map(a => [a.key, a]))
const STOCK_NATURES = ['Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)']
const ADDED_NATURES = ['Manual Ledger', 'Journal Passed Manually']
const FILE_VERSION = 1
const DATA_SHEET = 'Workings data'
const CHUNK = 30000   // an Excel cell holds at most 32,767 characters

const call = (channel, ...args) => getRegisteredHandlers().get(channel)(null, ...args)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const isTbId = (v) => Number.isInteger(Number(v)) && Number(v) > 0
const parseJson = (v) => { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v) } catch { return v } }

async function tbInfo(tbId) {
  if (!isTbId(tbId)) throw new Error('Choose one Trial Balance - not the Consolidated view.')
  const { rows: [tb] } = await query(
    `SELECT tb.*, e.name AS entity_name, fp.year_label
       FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id
       LEFT JOIN entity_periods ep ON ep.id = tb.entity_period_id
       LEFT JOIN financial_periods fp ON fp.id = ep.financial_period_id
      WHERE tb.id = $1`, [Number(tbId)])
  if (!tb) throw new Error('The Trial Balance was not found.')
  return tb
}

// ── Collect ────────────────────────────────────────────────────────────────
export async function collectWorkings(tbId) {
  const tb = await tbInfo(tbId)
  const rows = async (sql) => (await query(sql, [tb.id])).rows
  const one = async (sql) => (await rows(sql))[0] || null

  const stockRows = await rows(`SELECT name, opening_balance, closing_balance, stock_head, upload_nature FROM tb_rows
                                 WHERE tb_id = $1 AND upload_nature IN ('Stock Entry', 'Stock Entry PY') ORDER BY id`)
  const stock = { opening: {}, closing: {}, pyOpening: {}, pyClosing: {}, heads: {} }
  for (const r of stockRows) {
    let m
    if ((m = /^Closing Stock - BS - (.+)$/.exec(r.name))) { stock.opening[m[1]] = -num(r.opening_balance); stock.closing[m[1]] = -num(r.closing_balance) }
    else if ((m = /^Opening Stock - (.+)$/.exec(r.name))) { if (stock.opening[m[1]] === undefined) stock.opening[m[1]] = -num(r.opening_balance) }
    else if ((m = /^Closing Stock - PL - (.+)$/.exec(r.name))) { if (stock.closing[m[1]] === undefined) stock.closing[m[1]] = num(r.closing_balance) }
    else if ((m = /^PY Opening Stock - (.+)$/.exec(r.name))) stock.pyOpening[m[1]] = -num(r.closing_balance)
    else if ((m = /^PY Closing Stock - (.+)$/.exec(r.name))) stock.pyClosing[m[1]] = -num(r.closing_balance)
    else continue
    if (r.stock_head) stock.heads[m[1]] = r.stock_head
  }
  for (const k of ['opening', 'closing', 'pyOpening', 'pyClosing']) for (const [t, v] of Object.entries(stock[k])) if (!v) delete stock[k][t]
  const stockCategories = new Set(['opening', 'closing', 'pyOpening', 'pyClosing'].flatMap(k => Object.keys(stock[k])))

  const added = await rows(`SELECT * FROM tb_rows WHERE tb_id = $1 AND upload_nature IN ('Manual Ledger', 'Journal Passed Manually') ORDER BY id`)
  const manualLedgers = []
  for (const r of added) {
    const { rows: [mt] } = await query('SELECT * FROM mapped_tb WHERE tb_row_id = $1', [r.id])
    const { id, tb_id, ...row } = r
    let mapped = null
    if (mt) { const { id: _i, tb_id: _t, tb_row_id: _r, ...rest } = mt; mapped = rest }
    manualLedgers.push({ row, mapped })
  }

  const settingsRow = { pl_closed_to_capital: !!tb.pl_closed_to_capital, eps_basic_cy: tb.eps_basic_cy, eps_basic_py: tb.eps_basic_py, eps_diluted_cy: tb.eps_diluted_cy, eps_diluted_py: tb.eps_diluted_py }
  const settingsSet = settingsRow.pl_closed_to_capital || ['eps_basic_cy', 'eps_basic_py', 'eps_diluted_cy', 'eps_diluted_py'].some(k => settingsRow[k] !== null && settingsRow[k] !== undefined)

  const learned = (await query('SELECT COUNT(*) AS c FROM learned_ledger_rules WHERE entity_id = $1', [tb.entity_id])).rows[0]
  const areas = {
    notes: (await rows('SELECT note_num, note_title, data FROM note_details WHERE tb_id = $1 ORDER BY note_num')).map(r => ({ ...r, data: parseJson(r.data) })),
    disclosures: await rows(`SELECT note_num, note_title, text FROM note_disclosures WHERE tb_id = $1 AND TRIM(COALESCE(text, '')) <> '' ORDER BY note_num`),
    itr: parseJson((await one('SELECT data FROM itr_details WHERE tb_id = $1'))?.data ?? null),
    remarks: await rows(`SELECT scope, scope_key, remark FROM remarks WHERE tb_id = $1 AND TRIM(COALESCE(remark, '')) <> '' ORDER BY scope, scope_key`),
    depBooks: parseJson((await one('SELECT data FROM dep_comp_schedules WHERE tb_id = $1'))?.data ?? null),
    depIT: parseJson((await one('SELECT data FROM dep_it_schedules WHERE tb_id = $1'))?.data ?? null),
    stock: stockCategories.size ? stock : null,
    manualPy: { enabled: !!tb.manual_py, entries: await rows('SELECT note_num, note_title, particular_label, py_amount, is_custom FROM manual_py_entries WHERE tb_id = $1 ORDER BY note_num, id') },
    faceLines: await rows('SELECT section, label, cy_amount, py_amount, sort_order FROM manual_face_lines WHERE tb_id = $1 ORDER BY section, sort_order, id'),
    settings: settingsSet ? settingsRow : null,
    adjustments: await rows(`SELECT name, ledger_code, branch, adj_debit, adj_credit FROM tb_rows
                              WHERE tb_id = $1 AND (COALESCE(adj_debit, 0) <> 0 OR COALESCE(adj_credit, 0) <> 0)
                                AND (upload_nature IS NULL OR upload_nature NOT IN ('Manual Ledger', 'Journal Passed Manually', 'Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)'))
                              ORDER BY id`),
    manualLedgers,
    learnedRulesCount: Number(learned?.c || 0),
  }
  return {
    version: FILE_VERSION,
    source: { tbId: tb.id, entityId: tb.entity_id, entityName: tb.entity_name, entityPeriodId: tb.entity_period_id, yearLabel: tb.year_label || '', branch: tb.branch_name || '', filename: tb.filename || '' },
    areas,
  }
}

export function countWorkings(snapshot) {
  const a = snapshot.areas || {}
  const nonEmptyJson = (v) => v && typeof v === 'object' && Object.keys(v).length > 0 ? 1 : 0
  return {
    notes: (a.notes || []).length,
    disclosures: (a.disclosures || []).length,
    itr: nonEmptyJson(a.itr),
    remarks: (a.remarks || []).length,
    depBooks: nonEmptyJson(a.depBooks),
    depIT: nonEmptyJson(a.depIT),
    stock: a.stock ? new Set(['opening', 'closing', 'pyOpening', 'pyClosing'].flatMap(k => Object.keys(a.stock[k] || {}))).size : 0,
    manualPy: (a.manualPy?.entries || []).length + (a.manualPy?.enabled ? 1 : 0),
    faceLines: (a.faceLines || []).length,
    settings: a.settings ? 1 : 0,
    adjustments: (a.adjustments || []).length,
    manualLedgers: (a.manualLedgers || []).length,
    learnedRules: Number(a.learnedRulesCount || (a.learnedRulesSheet ? a.learnedRulesSheet.length : 0)),
  }
}

function areaList(snapshot, { fileOnly = false } = {}) {
  const counts = countWorkings(snapshot)
  return WORKING_AREAS.filter(a => fileOnly || !a.fileOnly).map(a => ({ key: a.key, label: a.label, count: counts[a.key] || 0, defaultOn: a.defaultOn !== false }))
}

// ── Apply ──────────────────────────────────────────────────────────────────
async function upsertJson(table, tbId, data) {
  await query(`INSERT INTO ${table} (tb_id, data) VALUES ($1, $2)
               ON CONFLICT (tb_id) DO UPDATE SET data = EXCLUDED.data, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [tbId, typeof data === 'string' ? data : JSON.stringify(data)])
}

export async function applyWorkings(toTbId, snapshot, include) {
  const target = await tbInfo(toTbId)
  const want = new Set(include || [])
  const a = snapshot.areas || {}
  const counts = countWorkings(snapshot)
  const carried = [], skipped = []
  const done = (key, count) => { if (count) carried.push({ key, label: AREA[key].label, count }) }
  const skip = (key, reason, items = []) => skipped.push({ key, label: AREA[key].label, reason, items: items.slice(0, 20), more: Math.max(0, items.length - 20) })
  const samePeriod = snapshot.source?.entityPeriodId != null && Number(snapshot.source.entityPeriodId) === Number(target.entity_period_id)

  await runInTransaction(async () => {
    if (want.has('notes') && counts.notes) {
      let n = 0
      const yearScoped = []
      for (const r of a.notes) {
        // Investment details live under reserved negative note numbers tied to their own year.
        if (Number(r.note_num) < 0 && !samePeriod) { yearScoped.push(r.note_title); continue }
        await query(`INSERT INTO note_details (tb_id, note_num, note_title, data) VALUES ($1, $2, $3, $4)
                     ON CONFLICT (tb_id, note_num) DO UPDATE SET note_title = EXCLUDED.note_title, data = EXCLUDED.data, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          [target.id, r.note_num, r.note_title, typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? {})])
        n++
      }
      done('notes', n)
      if (yearScoped.length) skip('notes', 'Investment details belong to the financial year they were entered for, so they are not moved to another year.', yearScoped)
    }
    if (want.has('disclosures') && counts.disclosures) {
      for (const r of a.disclosures) {
        await query(`INSERT INTO note_disclosures (tb_id, note_num, note_title, text) VALUES ($1, $2, $3, $4)
                     ON CONFLICT (tb_id, note_num) DO UPDATE SET note_title = EXCLUDED.note_title, text = EXCLUDED.text, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          [target.id, r.note_num, r.note_title, r.text])
      }
      done('disclosures', a.disclosures.length)
    }
    if (want.has('itr') && counts.itr) { await upsertJson('itr_details', target.id, a.itr); done('itr', 1) }
    if (want.has('remarks') && counts.remarks) {
      for (const r of a.remarks) {
        await query(`INSERT INTO remarks (tb_id, scope, scope_key, remark) VALUES ($1, $2, $3, $4)
                     ON CONFLICT (tb_id, scope, scope_key) DO UPDATE SET remark = EXCLUDED.remark, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          [target.id, r.scope, r.scope_key, r.remark])
      }
      done('remarks', a.remarks.length)
    }
    if (want.has('depBooks') && counts.depBooks) { await upsertJson('dep_comp_schedules', target.id, a.depBooks); done('depBooks', 1) }
    if (want.has('depIT') && counts.depIT) { await upsertJson('dep_it_schedules', target.id, a.depIT); done('depIT', 1) }
    if (want.has('stock') && counts.stock) {
      await call('tb:saveStock', { tbId: target.id, stockData: a.stock })
      done('stock', counts.stock)
    }
    if (want.has('manualPy') && counts.manualPy) {
      await query('UPDATE trial_balances SET manual_py = $1 WHERE id = $2', [a.manualPy.enabled ? 1 : 0, target.id])
      for (const r of a.manualPy.entries || []) {
        await query(`INSERT INTO manual_py_entries (tb_id, note_num, note_title, particular_label, py_amount, is_custom) VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (tb_id, note_num, particular_label) DO UPDATE SET note_title = EXCLUDED.note_title, py_amount = EXCLUDED.py_amount, is_custom = EXCLUDED.is_custom, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          [target.id, r.note_num, r.note_title || '', r.particular_label || '', num(r.py_amount), r.is_custom ? 1 : 0])
      }
      done('manualPy', counts.manualPy)
    }
    if (want.has('faceLines') && counts.faceLines) {
      // The lines replace the target's own: carried twice, they would otherwise be counted twice.
      await query('DELETE FROM manual_face_lines WHERE tb_id = $1', [target.id])
      for (const r of a.faceLines) {
        await query('INSERT INTO manual_face_lines (tb_id, section, label, cy_amount, py_amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
          [target.id, r.section, r.label || '', num(r.cy_amount), num(r.py_amount), Number(r.sort_order) || 0])
      }
      done('faceLines', a.faceLines.length)
    }
    if (want.has('settings') && counts.settings) {
      const s = a.settings
      await query(`UPDATE trial_balances SET pl_closed_to_capital = $1, eps_basic_cy = $2, eps_basic_py = $3, eps_diluted_cy = $4, eps_diluted_py = $5 WHERE id = $6`,
        [s.pl_closed_to_capital ? 1 : 0, s.eps_basic_cy ?? null, s.eps_basic_py ?? null, s.eps_diluted_cy ?? null, s.eps_diluted_py ?? null, target.id])
      done('settings', 1)
    }
    if (want.has('adjustments') && counts.adjustments) {
      const notFound = []
      let n = 0
      for (const adj of a.adjustments) {
        const code = String(adj.ledger_code || '').trim()
        const { rows: [hit] } = await query(
          `SELECT mt.id FROM tb_rows tr JOIN mapped_tb mt ON mt.tb_row_id = tr.id
            WHERE tr.tb_id = $1 AND COALESCE(tr.branch, '') = $2
              AND (tr.upload_nature IS NULL OR tr.upload_nature NOT IN ('Manual Ledger', 'Journal Passed Manually', 'Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)'))
              AND (${code ? `TRIM(COALESCE(tr.ledger_code, '')) = $3` : `LOWER(TRIM(tr.name)) = LOWER(TRIM($3))`})
            ORDER BY tr.id LIMIT 1`,
          [target.id, adj.branch || '', code || adj.name])
        if (!hit) { notFound.push(adj.name); continue }
        await call('mappedTB:setAdjustment', hit.id, { debit: num(adj.adj_debit) || null, credit: num(adj.adj_credit) || null })
        n++
      }
      done('adjustments', n)
      if (notFound.length) skip('adjustments', 'These ledgers are not in the new Trial Balance (or are not mapped yet), so their adjustments were not applied.', notFound)
    }
    if (want.has('manualLedgers') && counts.manualLedgers) {
      let n = 0
      const already = []
      for (const { row, mapped } of a.manualLedgers) {
        const { rows: [dup] } = await query(
          'SELECT id FROM tb_rows WHERE tb_id = $1 AND name = $2 AND upload_nature = $3 AND ABS(COALESCE(closing_balance, 0) - $4) < 0.005 LIMIT 1',
          [target.id, row.name, row.upload_nature, num(row.closing_balance)])
        if (dup) { already.push(row.name); continue }
        const cols = Object.keys(row).filter(k => /^[a-z0-9_]+$/.test(k))
        const { rows: [ins] } = await query(
          `INSERT INTO tb_rows (tb_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
          [target.id, ...cols.map(k => row[k])])
        if (mapped) {
          const mcols = Object.keys(mapped).filter(k => /^[a-z0-9_]+$/.test(k))
          await query(
            `INSERT INTO mapped_tb (tb_id, tb_row_id, ${mcols.join(', ')}) VALUES ($1, $2, ${mcols.map((_, i) => `$${i + 3}`).join(', ')})
             ON CONFLICT (tb_id, tb_row_id) DO NOTHING`,
            [target.id, ins.id, ...mcols.map(k => (mapped[k] !== null && typeof mapped[k] === 'object') ? JSON.stringify(mapped[k]) : mapped[k])])
        }
        n++
      }
      if (n) await query('UPDATE trial_balances SET row_count = (SELECT COUNT(*) FROM tb_rows WHERE tb_id = $1) WHERE id = $1', [target.id])
      done('manualLedgers', n)
      if (already.length) skip('manualLedgers', 'Already present in this Trial Balance with the same amount, so not added again.', already)
    }
  })

  if (want.has('learnedRules') && a.learnedRulesSheet && a.learnedRulesSheet.length) {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.learnedRulesSheet), 'Learned Ledger Rules')
    await call('learnedRules:upload', target.entity_id, Array.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })))
    done('learnedRules', a.learnedRulesSheet.length)
  }
  return { carried, skipped }
}

// ── One Excel file ─────────────────────────────────────────────────────────
function readableSheets(wb, snap) {
  const a = snap.areas
  const add = (name, rows) => { if (rows.length > 1) { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = rows[0].map(() => ({ wch: 24 })); XLSX.utils.book_append_sheet(wb, ws, name) } }
  add('Stock', [['Category', 'Opening', 'Closing', 'PY Opening', 'PY Closing', 'Other-expenses head'],
    ...[...new Set(['opening', 'closing', 'pyOpening', 'pyClosing'].flatMap(k => Object.keys(a.stock?.[k] || {})))].map(t =>
      [t, a.stock.opening[t] || 0, a.stock.closing[t] || 0, a.stock.pyOpening[t] || 0, a.stock.pyClosing[t] || 0, a.stock.heads[t] || ''])])
  add('Fill Details', [['Note No.', 'Note'], ...(a.notes || []).filter(n => Number(n.note_num) >= 0).map(n => [n.note_num, n.note_title])])
  add('Adjustments', [['Ledger', 'Ledger code', 'Branch', 'Adjustment (Debit)', 'Adjustment (Credit)'], ...(a.adjustments || []).map(r => [r.name, r.ledger_code || '', r.branch || '', num(r.adj_debit), num(r.adj_credit)])])
  add('Journal and added ledgers', [['Ledger', 'Kind', 'Closing balance (Cr +, Dr -)', 'Mapping 1', 'Mapping 2', 'Mapping 3'],
    ...(a.manualLedgers || []).map(({ row, mapped }) => [row.name, row.upload_nature, num(row.closing_balance), mapped?.mapping1_resultant || '', mapped?.mapping2_resultant || '', mapped?.mapping3_resultant || ''])])
  add('Manual PY', [['Note No.', 'Note', 'Particular', 'Previous Year amount'], ...(a.manualPy?.entries || []).map(r => [r.note_num, r.note_title, r.particular_label, num(r.py_amount)])])
  add('Extra face lines', [['Statement section', 'Line', 'Current Year', 'Previous Year'], ...(a.faceLines || []).map(r => [r.section, r.label, num(r.cy_amount), num(r.py_amount)])])
  add('Remarks', [['Where', 'Item', 'Remark'], ...(a.remarks || []).map(r => [r.scope, r.scope_key, r.remark])])
}

export async function buildWorkingsWorkbook(tbId) {
  const snap = await collectWorkings(tbId)
  const learned = snap.areas.learnedRulesCount ? await call('learnedRules:download', snap.source.entityId) : null
  const wb = XLSX.utils.book_new()
  const counts = countWorkings(snap)
  const readme = [
    ['ICAI VERA - Financial Statement Review: all workings of one Trial Balance'],
    [],
    ['Client', snap.source.entityName], ['Financial year', snap.source.yearLabel], ['Branch', snap.source.branch || '-'], ['Trial Balance file', snap.source.filename],
    ['Downloaded', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' (UTC)'],
    [],
    ['Contents', 'Items'], ...WORKING_AREAS.map(x => [x.label, counts[x.key] || 0]),
    [],
    ['To restore: open Financial Statement Review > Trial Balance > Upload TB, select the Trial Balance, and use "Upload all workings" with this file.'],
    ['The readable sheets are for reference only. The upload reads the "Workings data" sheet: do not edit or delete it.'],
  ]
  const r = XLSX.utils.aoa_to_sheet(readme); r['!cols'] = [{ wch: 48 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, r, 'Read me')
  readableSheets(wb, snap)
  if (learned) {
    const src = XLSX.read(new Uint8Array(learned.buffer), { type: 'buffer' })
    XLSX.utils.book_append_sheet(wb, src.Sheets[src.SheetNames[0]], 'Learned Ledger Rules')
  }
  const json = JSON.stringify(snap)
  const data = [['Part', 'Data (do not edit)']]
  for (let i = 0, p = 1; i < json.length; i += CHUNK, p++) data.push([p, json.slice(i, i + CHUNK)])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), DATA_SHEET)
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return {
    bytes: Array.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })),
    filename: `${safe(snap.source.entityName) || 'Client'}_${safe(snap.source.yearLabel) || 'FY'}${snap.source.branch ? '_' + safe(snap.source.branch) : ''}_Workings.xlsx`,
    counts,
  }
}

export function readWorkingsWorkbook(bytes) {
  let wb
  try { wb = XLSX.read(new Uint8Array(bytes), { type: 'array' }) } catch { throw new Error('This file could not be read as an Excel workbook.') }
  const ws = wb.Sheets[DATA_SHEET]
  if (!ws) throw new Error(`This is not a workings file: its "${DATA_SHEET}" sheet is missing.`)
  const parts = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).slice(1).filter(r => r[1] !== '')
    .sort((x, y) => Number(x[0]) - Number(y[0]))
  let snap
  try { snap = JSON.parse(parts.map(r => String(r[1])).join('')) } catch { throw new Error(`The "${DATA_SHEET}" sheet has been changed and can no longer be read.`) }
  if (!snap || snap.version !== FILE_VERSION || !snap.areas) throw new Error('This workings file is from an unknown version of the app.')
  const lr = wb.Sheets['Learned Ledger Rules']
  snap.areas.learnedRulesSheet = lr ? XLSX.utils.sheet_to_json(lr, { defval: '' }) : []
  return snap
}

// ── Channels ───────────────────────────────────────────────────────────────
export function registerWorkingsHandlers() {
  ipcMain.handle('workings:summary', async (_, tbId) => {
    const snap = await collectWorkings(tbId)
    return { source: snap.source, areas: areaList(snap) }
  })

  ipcMain.handle('workings:carryOver', async (_, { fromTbId, toTbId, include } = {}) => {
    const [from, to] = [await tbInfo(fromTbId), await tbInfo(toTbId)]
    if (from.id === to.id) throw new Error('Choose a different Trial Balance to carry the workings from.')
    if (from.entity_id !== to.entity_id || Number(from.entity_period_id) !== Number(to.entity_period_id) || (from.branch_name || '') !== (to.branch_name || '')) {
      throw new Error('Workings are carried over only between Trial Balances of the same client, financial year and branch.')
    }
    return applyWorkings(to.id, await collectWorkings(from.id), (include || []).filter(k => AREA[k] && !AREA[k].fileOnly))
  })

  ipcMain.handle('workings:export', async (_, tbId) => buildWorkingsWorkbook(tbId))

  ipcMain.handle('workings:import', async (_, { tbId, bytes, include, dryRun } = {}) => {
    const target = await tbInfo(tbId)
    const snap = readWorkingsWorkbook(bytes)
    const sameClient = Number(snap.source?.entityId) === Number(target.entity_id) || String(snap.source?.entityName || '').trim().toLowerCase() === String(target.entity_name || '').trim().toLowerCase()
    const sameYear = String(snap.source?.yearLabel || '') === String(target.year_label || '')
    if (dryRun) return { source: snap.source, sameClient, sameYear, areas: areaList(snap, { fileOnly: true }) }
    if (!sameClient) throw new Error(`This workings file belongs to "${snap.source?.entityName || 'another client'}", not to ${target.entity_name}.`)
    return applyWorkings(target.id, snap, (include || []).filter(k => AREA[k]))
  })
}
