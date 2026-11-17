// ── Dep (IT) Excel round-trip — blank template + filled snapshot ────────────
// "Blank" is a generic, reusable template (headers + a Block reference sheet)
// with no TB-specific data — safe to hand out once and reuse for any entity.
// "Filled" is a snapshot of the CURRENT ledgers/inputs, meant purely as a
// backup/restore mechanism: since a fresh Trial Balance upload gets a new
// tb_id (and dep_it_schedules is keyed by tb_id), a re-upload otherwise loses
// every Block assignment and figure entered here. Download Filled before
// re-uploading a TB, then Upload Filled afterwards to restore — rows are
// matched back onto the new TB's ledger list by ledger name.
import * as XLSX from 'xlsx-js-style'
import { dataSheetNames } from '../../utils/veraExcel'

const HEADER_ROW = ['Ledger / Asset Name', 'Asset Block', 'Opening WDV', 'Addition <180 Days', 'Addition >=180 Days', 'Deduction']
const COL_WIDTHS = [{ wch: 40 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]

function blockReferenceSheet(blocks) {
  const aoa = [['Major Category', 'Block Name (type exactly as shown here into the "Asset Block" column)', 'Rate %']]
  for (const b of blocks || []) aoa.push([b.majorCategory, b.block, b.rate])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 28 }, { wch: 70 }, { wch: 10 }]
  return ws
}

// ── Capital WIP / Intangible WIP — a fixed 3-row mini-table, separate from
// the ledger rows above (no depreciation, no Block) so it needs its own
// sheet: mixing it into the ledger sheet would make parseDepITWorkbook treat
// "Capital Work in Progress" as a stray unmatched ledger name. Leave every
// cell blank if the entity has no CWIP/Intangible-under-development at all —
// the app already hides these rows everywhere nothing was entered.
const WIP_SHEET = 'Dep (IT) - WIP'
const WIP_ROW_LABELS = ['Capital Work in Progress', 'Intangible Work in Progress', 'Total (Work in Progress) - Previous Year']

function wipSheet(wip) {
  const aoa = [
    ['Particulars', 'Amount'],
    [WIP_ROW_LABELS[0], wip?.capitalCY || ''],
    [WIP_ROW_LABELS[1], wip?.intangibleCY || ''],
    [WIP_ROW_LABELS[2], wip?.prevYearTotal || ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 45 }, { wch: 16 }]
  return ws
}

/** @returns {{capitalCY:string, intangibleCY:string, prevYearTotal:string}|null} */
export function parseDepITWipSheet(wb) {
  const ws = wb.Sheets[WIP_SHEET]
  if (!ws) return null
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const byLabel = {}
  for (const r of aoa.slice(1)) {
    const label = (r[0] || '').toString().trim()
    if (label) byLabel[label] = r[1] !== '' && r[1] != null ? String(r[1]) : ''
  }
  return {
    capitalCY: byLabel[WIP_ROW_LABELS[0]] || '',
    intangibleCY: byLabel[WIP_ROW_LABELS[1]] || '',
    prevYearTotal: byLabel[WIP_ROW_LABELS[2]] || '',
  }
}

export function buildDepITBlankTemplate(blocks) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, ['', '', '', '', '', '']]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (IT) Template')
  XLSX.utils.book_append_sheet(wb, wipSheet(null), WIP_SHEET)
  XLSX.utils.book_append_sheet(wb, blockReferenceSheet(blocks), 'IT Blocks Reference')
  return wb
}

export function buildDepITFilledWorkbook(ledgers, inputs, blocks, wip) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW]
  for (const l of ledgers || []) {
    const inp = inputs[l.ledger_name] || {}
    const block = blocks.find(b => b.id === inp.block)
    aoa.push([
      (inp.label || '').trim() || l.ledger_name,   // a company's hand-added row: its description
      block ? block.block : '',
      inp.openingWDV || '', inp.addBefore180 || '', inp.addAfter180 || '', inp.deduction || '',
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (IT) Filled')
  XLSX.utils.book_append_sheet(wb, wipSheet(wip), WIP_SHEET)
  XLSX.utils.book_append_sheet(wb, blockReferenceSheet(blocks), 'IT Blocks Reference')
  return wb
}

// Appends a blank Dep (IT) template sheet + Block reference sheet onto an
// already-built workbook — used to merge the template into the Notes tab's
// consolidated Fill Details download.
export function appendDepITTemplateSheets(wb, blocks, usedNames) {
  const safeName = (name) => {
    let base = name.slice(0, 28)
    let candidate = base, i = 2
    while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${i++})`.slice(0, 31)
    usedNames.add(candidate.toLowerCase())
    return candidate
  }
  const aoa = [HEADER_ROW, ['', '', '', '', '', '']]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, safeName('Dep (IT) Template'))
  XLSX.utils.book_append_sheet(wb, wipSheet(null), safeName(WIP_SHEET))
  XLSX.utils.book_append_sheet(wb, blockReferenceSheet(blocks), safeName('IT Blocks Reference'))
}

/**
 * T-047: how utils/veraExcel.js finishes these files — How to Fill guide, blue header,
 * yellow cells to fill in, amount formats, and an Asset Block dropdown of the Income-tax
 * blocks (a fixed list). The Ledger / Asset Name column stays free text (the client's
 * own ledgers). Sheet names and cell positions are unchanged, so parseDepITWorkbook
 * reads old and new files alike.
 * @param {'template'|'filled'} mode
 * @param {{block:string}[]} blocks
 */
export function depITExcelSpec(mode, blocks = []) {
  const names = [...new Set((blocks || []).map(b => String(b.block || '').trim()).filter(Boolean))]
  const sheet = {
    headerRow: 1,
    lastCol: 'F',
    minRows: mode === 'template' ? 30 : 0,
    inputCols: ['A', 'B', 'C', 'D', 'E', 'F'],
    amountCols: ['C', 'D', 'E', 'F'],
    freezeCols: 1,
    widths: [40, 48, 16, 18, 18, 16],
    autoFilter: false,
    dropdowns: names.length ? [{
      col: 'B', list: names, openEnded: true, name: 'Asset Block',
      prompt: 'Pick the Income-tax block of this asset.',
      error: 'Pick an Asset Block from the list (the IT Blocks Reference sheet shows them with their rates).',
    }] : [],
  }
  return {
    mode,
    sheets: {
      [WIP_SHEET]: { headerRow: 1, lastRow: 4, lastCol: 'B', inputCols: ['B'], amountCols: ['B'], widths: [45, 18], autoFilter: false },
      'Dep (IT)*': sheet,
      'IT Blocks Reference': { headerRow: 1, lastCol: 'C', widths: [28, 70, 10], autoFilter: false },
    },
    howTo: {
      title: mode === 'filled' ? 'Depreciation (Income Tax) — saved figures' : 'Depreciation (Income Tax) — template',
      purpose: mode === 'filled'
        ? 'The Income-tax depreciation inputs saved in VERA for this Trial Balance, one row per ledger. Keep it as a backup before re-uploading a Trial Balance, or correct it here and upload it back.'
        : 'Enter the Income-tax depreciation inputs, one row per fixed-asset ledger, and upload it on the Dep (Income Tax) screen.',
      steps: [
        'Go to the "' + (mode === 'filled' ? 'Dep (IT) Filled' : 'Dep (IT) Template') + '" sheet.',
        'Type the ledger name exactly as it is in the Trial Balance, then pick its Asset Block from the dropdown.',
        'Enter the Opening WDV, additions (put to use before / after 180 days) and deductions in the pale-yellow cells, in rupees.',
        'On the "' + WIP_SHEET + '" sheet, enter Capital and Intangible Work in Progress, if any.',
        'Save the file, then on VERA\'s Dep (Income Tax) screen click "Upload Filled" and pick it. Rows are matched by ledger name.',
      ],
      columns: [
        ['Ledger / Asset Name', 'The fixed-asset ledger, as named in the Trial Balance.', 'Text — fill in'],
        ['Asset Block', 'The Income-tax block (and so the rate) of the asset.', names.length ? 'Dropdown' : 'Text — fill in'],
        ['Opening WDV', 'Written-down value at the start of the year.', 'Amount — fill in'],
        ['Addition <180 Days', 'Additions put to use for less than 180 days (half rate).', 'Amount — fill in'],
        ['Addition >=180 Days', 'Additions put to use for 180 days or more (full rate).', 'Amount — fill in'],
        ['Deduction', 'Sale value or other deductions from the block.', 'Amount — fill in'],
      ],
      tips: [
        'The "IT Blocks Reference" sheet lists every block with its rate.',
        'A ledger name not found in the Trial Balance is reported after upload; nothing else is changed.',
      ],
    },
  }
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {object[]} blocks - current master+custom blocks, to resolve block name -> id
 * @returns {{ rows: Record<string, {block:string, openingWDV:string, addBefore180:string, addAfter180:string, deduction:string}>, matched: number, unmatched: string[] }}
 */
export function parseDepITWorkbook(wb, blocks) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Dep (IT)') && n !== WIP_SHEET) || dataSheetNames(wb).find(n => n !== WIP_SHEET && n !== 'IT Blocks Reference')
  const ws = wb.Sheets[sheetName]
  if (!ws) return { rows: {}, matched: 0, unmatched: [] }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const dataRows = aoa.slice(1).filter(r => (r[0] || '').toString().trim())

  const blockByName = new Map((blocks || []).map(b => [b.block.trim().toLowerCase(), b.id]))
  const rows = {}
  const unmatched = []
  for (const r of dataRows) {
    const ledgerName = (r[0] || '').toString().trim()
    const blockName = (r[1] || '').toString().trim()
    const blockId = blockName ? (blockByName.get(blockName.toLowerCase()) || '') : ''
    if (blockName && !blockId) unmatched.push(`${ledgerName} (block "${blockName}" not found)`)
    rows[ledgerName] = {
      block: blockId,
      openingWDV: r[2] !== '' ? String(r[2]) : '',
      addBefore180: r[3] !== '' ? String(r[3]) : '',
      addAfter180: r[4] !== '' ? String(r[4]) : '',
      deduction: r[5] !== '' ? String(r[5]) : '',
    }
  }
  return { rows, matched: dataRows.length - unmatched.length, unmatched, wip: parseDepITWipSheet(wb) }
}
