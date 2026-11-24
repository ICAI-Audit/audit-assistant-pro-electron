// ── Share Capital "Details" sheet — Shareholders / Rights / Footnotes ───────
// Bolted onto the consolidated Fill Details workbook alongside the existing
// per-note "Share Capital" (Classes) sheet built from fillDetailsRegistry.js
// (that registry entry only round-trips data.classes).
//
// The shareholder table uses the EXACT same flat layout as
// ShareCapitalForm.jsx's own "Shareholder_Template.xlsx" (downloadShareholderTemplate/
// importShareholdersFromExcel) — Sl No / Name / Folio No / PY Shares / CY
// Shares / Category(Promoter|Non-Promoter) — so a preparer sees one
// consistent format whether downloading it standalone from the form or
// bundled here. % holding and the ">=5%" shareholders list are NOT entered —
// they're auto-derived on parse from total CY/PY shares, mirroring
// importShareholdersFromExcel's own calculation exactly.
import * as XLSX from 'xlsx-js-style'
import { SC_DISCLOSURES, disclosureTexts, defaultDisclosureText } from '../../utils/shareCapitalDisclosures'

// ── Shareholding % (owner check, 23 November 2026) ──────────────────────────
// One calculation for both uploads (the form's "Import Excel" and the Fill Details workbook). Before, each upload divided by
// the FIRST share class only, so a company with two Equity classes got every % too high, and when that class was blank the
// divisor fell back to 1, so every holder came out far above 5% and was listed. A number typed as text with commas
// ("1,00,000") was read as 1.
export function shareCount(v) {
  const n = parseFloat(String(v ?? '').replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
// A class's closing shares: the Reconciliation (Opening + Issued - Bought back), as the Balance Sheet tally uses; else
// Subscribed & Fully Paid-up; else Subscribed; else Issued (T-053).
export function classClosingShares(cls, yr) {
  const c = (cls && cls[yr]) || {}
  return (shareCount(c.openingShares) + shareCount(c.issuedDuringYear) - shareCount(c.deletedDuringYear)) || shareCount(c.paidUp) || shareCount(c.subscribed) || shareCount(c.issued)
}
/** Total shares of one type (Equity / Preference) at the end of the year and of the previous year, across every class. */
export function shareTotals(classes, kind) {
  const list = (classes || []).filter(c => (c.type || 'Equity') === kind)
  return { cy: list.reduce((s, c) => s + classClosingShares(c, 'cy'), 0), py: list.reduce((s, c) => s + classClosingShares(c, 'py'), 0) }
}
/**
 * The uploaded shareholder rows ([Sl, Name, Folio, PY shares, CY shares, Category]) worked out against the company's total
 * Equity shares. When a total is not known (Share Classes not filled) the shares listed in the file are the divisor, and
 * basis says so. Promoters get the change in % holding during the year (percentage points, this year less last year).
 */
export function classifyShareholders(sheetRows, totals = {}) {
  const named = (sheetRows || []).filter(r => String(r?.[1] ?? '').trim())
  const listedCY = named.reduce((s, r) => s + shareCount(r[4]), 0)
  const listedPY = named.reduce((s, r) => s + shareCount(r[3]), 0)
  const totalCY = shareCount(totals.cy) || listedCY
  const totalPY = shareCount(totals.py) || listedPY
  const pct = (n, t) => (t ? (n / t) * 100 : 0)
  const all = named.map(r => {
    const cyShares = shareCount(r[4]), pyShares = shareCount(r[3])
    const cyPct = pct(cyShares, totalCY), pyPct = pct(pyShares, totalPY)
    return {
      name: String(r[1]).trim(), folioNo: String(r[2] ?? '').trim(),
      cyShares, cyPct: cyPct.toFixed(2), pyShares, pyPct: pyPct.toFixed(2),
      category: String(r[5] || 'Non-Promoter').trim(),
      _cyPct: cyPct, _pyPct: pyPct,
    }
  })
  const fivePct = all.filter(r => r._cyPct >= 5 - 1e-9 || r._pyPct >= 5 - 1e-9)
  const promoters = all.filter(r => r.category.toLowerCase() === 'promoter').map(r => ({
    name: r.name, class: 'Equity', shares: r.cyShares, pyShares: r.pyShares,
    pctTotal: r.cyPct, pctChange: (r._cyPct - r._pyPct).toFixed(2),
  }))
  return {
    all, fivePct, promoters,
    basis: {
      totalCY, totalPY, listedCY, listedPY,
      cyFrom: shareCount(totals.cy) ? 'classes' : 'listed', pyFrom: shareCount(totals.py) ? 'classes' : 'listed',
      // The file lists more shares than the company has: a typing slip in the file or in Share Classes.
      overCY: shareCount(totals.cy) > 0 && listedCY > shareCount(totals.cy) + 0.5,
      overPY: shareCount(totals.py) > 0 && listedPY > shareCount(totals.py) + 0.5,
    },
  }
}

const SHEET_PREFIX = 'Share Capital - Details'
const SHAREHOLDER_HEADER = ['Sl No', 'Name of Shareholder', 'Folio No (Optional)', 'No. of Shares at Beginning (PY)', 'No. of Shares at End (CY)', 'Category']
const COL_WIDTHS = [{ wch: 6 }, { wch: 40 }, { wch: 18 }, { wch: 30 }, { wch: 28 }, { wch: 18 }]
const FOOTNOTE_COUNT = 10
const DEFAULT_ROWS = 5

// Best-effort reconstruction for the "Filled" download — the live form only
// PERSISTS the disclosure-relevant subset (>=5% holders + Promoters, per
// Schedule III — everyone else genuinely isn't required to be listed), so a
// shareholder once below 5% and not a Promoter was never saved and can't be
// recovered here. Dedup by name; Promoter status (and its own Category tag)
// wins over a plain >=5% entry for the same person.
function reconstructShareholderRows(details) {
  const byName = new Map()
  for (const r of details?.shareholders5pctEquity || []) {
    byName.set(r.name, { name: r.name, folioNo: r.folioNo || '', pyShares: r.pyShares || '', cyShares: r.cyShares || '', category: 'Non-Promoter' })
  }
  for (const r of details?.shareholders5pctPreference || []) {
    byName.set(r.name, { name: r.name, folioNo: r.folioNo || '', pyShares: r.pyShares || '', cyShares: r.cyShares || '', category: 'Non-Promoter' })
  }
  for (const r of details?.promoters || []) {
    const existing = byName.get(r.name)
    byName.set(r.name, { name: r.name, folioNo: existing?.folioNo || '', pyShares: existing?.pyShares || '', cyShares: r.shares || existing?.cyShares || '', category: 'Promoter' })
  }
  return [...byName.values()]
}

function buildAoa(details) {
  const rows = [SHAREHOLDER_HEADER]
  const shRows = details ? reconstructShareholderRows(details) : []
  if (shRows.length) {
    shRows.forEach((r, i) => rows.push([i + 1, r.name, r.folioNo, r.pyShares, r.cyShares, r.category]))
  } else {
    for (let i = 1; i <= DEFAULT_ROWS; i++) rows.push([i, '', '', '', '', 'Non-Promoter'])
  }
  rows.push([]) // blank separator before Rights/Footnotes
  rows.push(['Rights, Preferences and Restrictions attached to shares'])
  rows.push([(details?.rights ?? '') || ''])
  rows.push([])
  // Company disclosures 1(e)-(l): text in column C (blank = left out).
  rows.push(['Disclosures (Company) — text in column C; clear it to leave the item out'])
  const texts = disclosureTexts(details || {})
  for (const s of SC_DISCLOSURES) rows.push([`(${s.key})`, s.heading, texts[s.key] || ''])
  rows.push([])
  rows.push(['Footnotes'])
  const footnotes = details?.footnotes?.length ? details.footnotes : Array(FOOTNOTE_COUNT).fill('')
  footnotes.forEach((fn, i) => rows.push([i + 1, fn || '']))
  return rows
}

// T-047: the shareholder table's look, shared by ShareCapitalForm's standalone
// Shareholder_Template.xlsx and this sheet. The only fixed choice is the Category
// (Promoter / Non-Promoter): a real Excel dropdown, refusing other values. SheetJS
// never wrote the old ws['!dataValidation'], so before T-047 there was no dropdown.
export const SHAREHOLDER_CATEGORIES = ['Promoter', 'Non-Promoter']
export const SHAREHOLDER_COLUMNS_GUIDE = [
  ['Sl No', 'Running number of the row.', 'Number'],
  ['Name of Shareholder', 'The shareholder\'s name as in the register of members.', 'Text — fill in'],
  ['Folio No (Optional)', 'Folio number, if any.', 'Text — fill in'],
  ['No. of Shares at Beginning (PY)', 'Shares held at the start of the year (end of the previous year).', 'Number — fill in'],
  ['No. of Shares at End (CY)', 'Shares held at the end of this year.', 'Number — fill in'],
  ['Category', 'Promoter or Non-Promoter. Promoters are listed in the promoters\' shareholding table.', 'Dropdown'],
]
export const shareholderCategoryDropdown = (fromRow, toRow) => ({
  col: 'F', fromRow, toRow, list: SHAREHOLDER_CATEGORIES, name: 'Category',
  prompt: 'Choose Promoter or Non-Promoter.', error: 'Please choose Promoter or Non-Promoter from the list.',
})

// T-047: the standalone Shareholder_Template.xlsx of ShareCapitalForm.jsx.
export const SHAREHOLDER_SHEET = 'Shareholders'
export function shareholderTemplateExcelSpec() {
  return {
    mode: 'template',
    sheets: {
      [SHAREHOLDER_SHEET]: {
        // 100 ready rows (the import skips a row without a name).
        headerRow: 1, lastRow: 101, lastCol: 'F', inputCols: ['B', 'C', 'D', 'E', 'F'], widths: [6, 40, 18, 30, 28, 18],
        autoFilter: false, boldFirstCol: false,
        dropdowns: [shareholderCategoryDropdown(2, 101)],
      },
    },
    howTo: {
      title: 'Shareholders — template',
      purpose: 'List the shareholders of the company with their shares at the beginning and end of the year. VERA works out the % holding, the shareholders holding 5% or more, and the promoters\' shareholding.',
      steps: [
        'Go to the "Shareholders" sheet.',
        'Enter one shareholder per row in the pale-yellow cells (up to 100 rows are ready; a row without a name is skipped).',
        'Choose the Category of each shareholder from the dropdown: Promoter or Non-Promoter.',
        'Save the file, then in the VERA Share Capital form click "Import Excel" and pick it.',
      ],
      columns: SHAREHOLDER_COLUMNS_GUIDE,
      tips: [
        'Enter the number of shares, not the amount. % holding is calculated by VERA from the total shares of the company.',
        'Only shareholders holding 5% or more (this year or last year) and promoters are shown in the note.',
      ],
    },
  }
}

/**
 * T-047: the veraExcel sheet spec of the Share Capital Details sheet, for the Fill Details
 * workbook — key it 'Share Capital - Details*' (the sheet may get a " (2)" suffix). Pass the
 * same `details` given to appendShareCapitalDetailsSheet. Rows are unchanged, so
 * parseShareCapitalDetailsSheet reads old and new files alike. The styled table is the
 * shareholder rows; the Rights, Disclosures and Footnotes below it are left as plain
 * notes (veraExcel's after-table style, unwrapped so their long text stays readable).
 */
export function shareCapitalDetailsSheetSpec(details) {
  const aoa = buildAoa(details)
  const headerRow = 4                            // three rows are put above the header
  const shCount = aoa.findIndex((r, i) => i > 0 && !r.length) - 1
  const firstSh = headerRow + 1, lastSh = headerRow + shCount
  return {
    headerRow, lastRow: lastSh, lastCol: 'F', inputCols: ['B', 'C', 'D', 'E', 'F'],
    widths: [6, 40, 18, 30, 28, 18], autoFilter: false, boldFirstCol: false,
    dropdowns: [shareholderCategoryDropdown(firstSh, lastSh)],
  }
}

/**
 * Appends the Share Capital Details sheet to `wb`. `details` is the note's
 * currently-saved Fill Details data (or null for a blank template).
 */
export function appendShareCapitalDetailsSheet(wb, noteNum, details, usedNames) {
  const aoa = buildAoa(details)
  // Row 1 carries the note number so the sheet survives renumbering/renaming
  // the same way the main registry-driven sheets do (see NOTE_NUM_ROW in
  // fillDetailsWorkbook.js) — inserted above the header.
  aoa.unshift([`Note ${noteNum}`], ['Share Capital — Shareholders, Rights & Footnotes'], [])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  ws['!dataValidation'] = [{
    sqref: 'F5:F500',
    type: 'list',
    formula1: '"Promoter,Non-Promoter"',
    showDropDown: false,
    showErrorMessage: true,
    errorTitle: 'Invalid',
    error: 'Please select Promoter or Non-Promoter',
  }]
  let base = SHEET_PREFIX.slice(0, 28)
  let candidate = base, i = 2
  while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${i++})`.slice(0, 31)
  usedNames.add(candidate.toLowerCase())
  XLSX.utils.book_append_sheet(wb, ws, candidate)
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {number|string} totalSharesCY - total Equity shares at the year end (every Equity class,
 *   shareTotals) — the denominator for % holding, same figure the form's Import Excel uses.
 * @param {number|string} totalSharesPY - previous-year closing shares
 * @returns {{ noteNum: number, data: object } | null} - null if the sheet
 *   isn't present, or present but entirely blank.
 */
export function parseShareCapitalDetailsSheet(wb, totalSharesCY, totalSharesPY) {
  const sheetName = wb.SheetNames.find(n => n.startsWith(SHEET_PREFIX))
  if (!sheetName) return null
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const noteNumCell = (aoa[0]?.[0] || '').toString()
  const m = noteNumCell.match(/note\s*(\d+)/i)
  const noteNum = m ? parseInt(m[1], 10) : null

  // Shareholder rows: from row 4 (0-indexed) up to the first fully-blank
  // row, which marks the start of the Rights/Footnotes block.
  let i = 4
  const shareholderRows = []
  while (i < aoa.length && aoa[i].some(c => (c ?? '') !== '')) { shareholderRows.push(aoa[i]); i++ }

  // Same derivation as ShareCapitalForm.jsx's importShareholdersFromExcel —
  // % holding and the ">=5% in CY or PY" list are computed, never typed. The
  // denominator is total shares OUTSTANDING (every shareholder, including
  // the below-5% ones this sheet doesn't list) — normally the Classes
  // sheet's own closing-share figure (passed in by the caller). If that's
  // unavailable/zero (e.g. Classes wasn't filled in this same upload), fall
  // back to the sum of whatever's actually listed here, so % still comes out
  // sane rather than 0/blank — an approximation, since it can't see holders
  // below 5% that were never listed either way.
  const { all, fivePct, promoters } = classifyShareholders(shareholderRows, { cy: totalSharesCY, py: totalSharesPY })

  // Rights + Footnotes, after the blank separator row.
  let rights = ''
  const footnotes = Array(FOOTNOTE_COUNT).fill('')
  // Only text that differs from the standard wording is kept as the CA's own
  // (the face value in (e)'s standard text is whatever the classes say).
  const disclosures = {}
  const std = (s) => String(s || '').trim().replace(/₹\s*[\d,.]+/g, '₹#')
  for (; i < aoa.length; i++) {
    const label = (aoa[i][0] || '').toString().trim().toLowerCase()
    if (label.startsWith('rights')) { rights = (aoa[i + 1]?.[0] || '').toString(); i++; continue }
    const dm = label.match(/^\(([e-l])\)$/)
    if (dm) {
      const text = (aoa[i][2] ?? '').toString()
      if (std(text) !== std(defaultDisclosureText(dm[1], null))) disclosures[dm[1]] = text
      continue
    }
    const idx = parseInt(aoa[i][0], 10)
    if (idx >= 1 && idx <= FOOTNOTE_COUNT) footnotes[idx - 1] = (aoa[i][1] || '').toString()
  }

  if (!all.length && !rights.trim() && !footnotes.some(f => f.trim())) return null
  return {
    noteNum,
    data: {
      shareholders5pctEquity: fivePct
        .map(r => ({ name: r.name, folioNo: r.folioNo, cyShares: r.cyShares, cyPct: r.cyPct, pyShares: r.pyShares, pyPct: r.pyPct })),
      // The flat template has no Equity/Preference distinction (same as the
      // live form's own import — everything lands in the Equity list).
      shareholders5pctPreference: [],
      promoters,
      rights, footnotes,
      ...(Object.keys(disclosures).length ? { disclosures } : {}),
    },
  }
}
