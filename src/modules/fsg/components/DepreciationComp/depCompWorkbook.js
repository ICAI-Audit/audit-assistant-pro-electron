// ── Dep (Comp) Excel round-trip — category-level fillable-form template ─────
// One row per Asset Category (not per ledger) — every figure is a plain
// typed value, nothing computed (see DepreciationComp/index.jsx's file
// header comment). "Blank" is a generic, reusable template (headers + a
// Schedule II category-name reference sheet). "Filled" is a snapshot of the
// CURRENT category rows, for backup/restore across a Trial Balance
// re-upload (dep_comp_schedules is keyed by tb_id, so a fresh TB starts
// empty) — rows are matched back by Asset Category name.
import * as XLSX from 'xlsx-js-style'
import { dataSheetNames } from '../../utils/veraExcel'

const HEADER_ROW = [
  'Asset Category', 'Gross Opening', 'Additions', 'Deductions', 'Gross Closing',
  'Depreciation Opening', 'Depreciation For Year', 'Depreciation On Disposal', 'Depreciation Closing',
  'Net Block Opening', 'Net Block Closing',
]
const COL_WIDTHS = [
  { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
  { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
]
const FIELDS = ['grossOpen', 'additions', 'deductions', 'grossClose', 'depOpen', 'depForYear', 'depOnDisposal', 'depClose', 'netBlockOpen', 'netBlockClose']

function scheduleIIReferenceSheet(scheduleII) {
  const aoa = [['Asset Category (type exactly as shown here into the "Asset Category" column)']]
  for (const r of scheduleII || []) aoa.push([r.category])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 55 }]
  return ws
}

export function buildDepCompBlankTemplate(scheduleII) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, Array(HEADER_ROW.length).fill('')]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (Comp) Template')
  XLSX.utils.book_append_sheet(wb, scheduleIIReferenceSheet(scheduleII), 'Schedule II Reference')
  return wb
}

export function buildDepCompFilledWorkbook(categoryRows, scheduleII) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW]
  for (const r of categoryRows || []) {
    aoa.push([r.category || '', ...FIELDS.map(f => r[f] || '')])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (Comp) Filled')
  XLSX.utils.book_append_sheet(wb, scheduleIIReferenceSheet(scheduleII), 'Schedule II Reference')
  return wb
}

// Appends a blank Dep (Comp) template sheet + Schedule II reference sheet
// onto an already-built workbook — used to merge the template into the
// Notes tab's consolidated Fill Details download, mirroring
// appendDepITTemplateSheets in ../DepreciationIT/depITWorkbook.js.
export function appendDepCompTemplateSheets(wb, scheduleII, usedNames) {
  const safeName = (name) => {
    let base = name.slice(0, 28)
    let candidate = base, i = 2
    while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${i++})`.slice(0, 31)
    usedNames.add(candidate.toLowerCase())
    return candidate
  }
  const aoa = [HEADER_ROW, Array(HEADER_ROW.length).fill('')]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, safeName('Dep (Comp) Template'))
  XLSX.utils.book_append_sheet(wb, scheduleIIReferenceSheet(scheduleII), safeName('Schedule II Reference'))
}

/**
 * T-047: how utils/veraExcel.js finishes these files — How to Fill guide, blue header,
 * yellow cells to fill in, amount formats, and an Asset Category dropdown of the
 * Schedule II categories (a fixed list). Sheet names and cell positions are unchanged,
 * so parseDepCompWorkbook reads old and new files alike.
 * @param {'template'|'filled'} mode
 * @param {{category:string}[]} scheduleII
 */
export function depCompExcelSpec(mode, scheduleII = []) {
  const categories = [...new Set((scheduleII || []).map(r => String(r.category || '').trim()).filter(Boolean))]
  const sheet = {
    headerRow: 1,
    lastCol: 'K',
    minRows: mode === 'template' ? 30 : 0,
    inputCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
    amountCols: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
    freezeCols: 1,
    widths: [44, 16, 16, 14, 16, 18, 18, 18, 18, 16, 16],
    autoFilter: false,
    dropdowns: categories.length ? [{
      col: 'A', list: categories, openEnded: true, name: 'Asset Category',
      prompt: 'Pick the Schedule II asset category.',
      error: 'Pick an Asset Category from the list (the Schedule II Reference sheet shows them all).',
    }] : [],
  }
  return {
    mode,
    sheets: {
      'Dep (Comp)*': sheet,
      'Schedule II Reference': { headerRow: 1, lastCol: 'A', widths: [60], autoFilter: false },
    },
    howTo: {
      title: mode === 'filled' ? 'Depreciation (Books) — saved schedule' : 'Depreciation (Books) — template',
      purpose: mode === 'filled'
        ? 'The Companies Act depreciation schedule saved in VERA for this Trial Balance, one row per Asset Category. Keep it as a backup before re-uploading a Trial Balance, or correct it here and upload it back.'
        : 'Enter the Companies Act (Schedule II) depreciation schedule, one row per Asset Category, and upload it on the Dep (Books) screen.',
      steps: [
        'Go to the "' + (mode === 'filled' ? 'Dep (Comp) Filled' : 'Dep (Comp) Template') + '" sheet.',
        'In the Asset Category column, pick the category from the dropdown (one row per category).',
        'Enter the amounts in the pale-yellow cells, in rupees (for example 125000.50). Every figure is typed; VERA does not recalculate them from each other.',
        'Save the file, then on VERA\'s Dep (Books) screen click "Upload Filled" and pick it. Rows are matched by Asset Category.',
      ],
      columns: [
        ['Asset Category', 'The Schedule II category of the asset.', categories.length ? 'Dropdown' : 'Text — fill in'],
        ['Gross Opening / Additions / Deductions / Gross Closing', 'Gross block of the category for the year.', 'Amount — fill in'],
        ['Depreciation Opening / For Year / On Disposal / Closing', 'Accumulated depreciation of the category.', 'Amount — fill in'],
        ['Net Block Opening / Closing', 'Written-down value at the start and end of the year.', 'Amount — fill in'],
      ],
      tips: [
        'The "Schedule II Reference" sheet lists every category the dropdown offers.',
        'Use one row per category; leave a cell blank when it has no amount.',
      ],
    },
  }
}

/**
 * @param {XLSX.WorkBook} wb
 * @returns {{ rows: object[], matched: number }}
 */
export function parseDepCompWorkbook(wb) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Dep (Comp)')) || dataSheetNames(wb).find(n => n !== 'Schedule II Reference')
  const ws = wb.Sheets[sheetName]
  if (!ws) return { rows: [], matched: 0 }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const dataRows = aoa.slice(1).filter(r => (r[0] || '').toString().trim())

  const rows = dataRows.map(r => {
    const row = { category: (r[0] || '').toString().trim() }
    FIELDS.forEach((f, i) => { row[f] = r[i + 1] !== '' ? String(r[i + 1]) : '' })
    return row
  })
  return { rows, matched: rows.length }
}
