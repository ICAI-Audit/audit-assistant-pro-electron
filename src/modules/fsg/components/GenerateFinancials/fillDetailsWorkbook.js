// ── Consolidated Fill Details Excel — one sheet per note ────────────────────
// Downloadable template pre-filled with each note's currently-saved Fill
// Details data (or blank rows if none saved yet), editable in Excel, and
// re-uploadable to bulk-save Fill Details without opening each note's form
// individually. Driven entirely by utils/fillDetailsRegistry.js — add an
// entry there for a new note type and it appears here automatically.
import * as XLSX from 'xlsx-js-style'
import { FILL_DETAILS_REGISTRY } from '../../utils/fillDetailsRegistry'
import { appendDepITTemplateSheets, depITExcelSpec } from '../DepreciationIT/depITWorkbook'
import { appendDepCompTemplateSheets, depCompExcelSpec } from '../DepreciationComp/depCompWorkbook'
import { buildStockBlankTemplate, buildStockFilledWorkbook, parseStockWorkbook, stockExcelSpec } from '../Stock/stockWorkbook'
import { appendShareCapitalDetailsSheet, shareCapitalDetailsSheetSpec } from '../Notes/shareCapitalDetailsWorkbook'
import { appendCfsSheet, cfsSheetSpec, CFS_SHEET } from '../CFS/cfsWorkbook'
import { INVESTMENT_FIELDS } from '../../utils/investmentWorkbook'
import { TP_AGEING_ROWS, TP_AGEING_BUCKETS, tpCellBlocked } from '../Notes/TradePayablesDisclosureForm'
import { TR_AGEING_ROWS, TR_AGEING_BUCKETS, trCellBlocked } from '../Notes/TradeReceivablesAgingForm'
import { INVESTMENT_CATEGORIES, INVESTMENT_RELATIONSHIPS } from '../../utils/investments'
import { HOW_TO_SHEET, LISTS_SHEET } from '../../utils/veraExcel'

// Cell-by-cell equality (stringified, trimmed, blank/0 treated the same) used
// to detect an untouched sheet — compares uploaded rows against the exact
// blank baseline that entry.toRows(null) itself produces, so a form's own
// default placeholder values (e.g. Share Capital's "Equity Shares" name,
// face value 10) are correctly still "blank" rather than false-positiving as
// filled-in data.
const cellStr = (c) => {
  const s = (c ?? '').toString().trim()
  return (s === '0' || s === '0.00') ? '' : s
}
function rowsEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ra = a[i] || [], rb = b[i] || []
    const len = Math.max(ra.length, rb.length)
    for (let j = 0; j < len; j++) {
      if (cellStr(ra[j]) !== cellStr(rb[j])) return false
    }
  }
  return true
}

// Row 1: note number (parsed back on import so re-ordering/renaming a sheet
// tab doesn't break the round-trip). Row 2: note title (human reference
// only). Row 3: blank. Row 4: column header. Row 5+: data.
const NOTE_NUM_ROW = 0
const TITLE_ROW = 1
const HEADER_ROW = 3
const DATA_START_ROW = 4

// Sheets with their OWN dedicated parser (parseFillDetailsStockSheet,
// parseDepITWorkbook, parseDepCompWorkbook, parseShareCapitalDetailsSheet)
// must be excluded from the generic per-registry-entry loop below. Most
// bolted-on sheets (Stock, Dep (IT)/(Comp) templates) don't carry a "Note N"
// row-1 anchor at all, so they already fail that check harmlessly — but
// "Share Capital - Details" DOES (for renumbering resilience, same as every
// registry sheet) AND its title contains "share capital", which the
// share-capital registry entry's own match() also accepts. Left unexcluded,
// the generic loop would ALSO "recognise" it as a second Classes sheet and
// mis-map every shareholder row as a class (Sl No → class name, Folio No →
// face value, etc.), then overwrite the real Classes data since this sheet
// is always appended after it. Name-prefix exclusion, not content-based,
// since content-based (e.g. "does the title also match a registry entry")
// is exactly the ambiguity that caused this.
const BOLT_ON_SHEET_PREFIXES = ['Share Capital - Details', 'CFS']

function safeSheetName(name, used) {
  let base = (name || 'Sheet').replace(/[\\/*?:[\]]/g, ' ').slice(0, 28).trim() || 'Sheet'
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) { candidate = `${base} (${i++})`.slice(0, 31) }
  used.add(candidate.toLowerCase())
  return candidate
}

/**
 * @param {object[]} activeNotes - data.activeNotes from useFinancials
 * @param {Map<number, object>} noteDetailsMap - note_num -> saved Fill Details data (may be missing/empty)
 * @param {object[]} [depITBlocks] - current IT Act blocks (master+custom); when
 *   provided, a Dep (IT) template + Block reference sheet is appended too
 * @param {object} [opts]
 * @param {boolean} [opts.blank] - ignore noteDetailsMap/stockData entirely and
 *   emit every sheet with default/empty rows, regardless of what's saved —
 *   for a guaranteed pristine template independent of current progress.
 * @param {object} [opts.stockData] - {opening, closing, pyOpening, pyClosing}
 *   from the Stock tab; when provided (and not blank) a "Stock" sheet is
 *   appended too, in the same layout Stock's own standalone Excel uses.
 * @param {object[]} [opts.depCompScheduleII] - Schedule II category-name
 *   reference list (from dep:scheduleII); when provided, a Dep (Comp)
 *   fillable-form template + reference sheet is appended too.
 * @returns {XLSX.WorkBook}
 */
export function buildFillDetailsWorkbook(activeNotes, noteDetailsMap, depITBlocks = null, opts = {}) {
  const { blank = false, stockData = null, depCompScheduleII = null, constitution = null, cfsRows = null, cfsCc = null } = opts
  const wb = XLSX.utils.book_new()
  const used = new Set()
  let anySheet = false
  // T-047: the veraExcel look of each sheet, by its final name (see fillDetailsExcelSpec).
  const sheetSpecs = {}
  const contents = []
  // Runs `append`, then gives every sheet it added the spec `pick(name)` returns.
  const track = (append, pick) => {
    const before = new Set(wb.SheetNames)
    append()
    for (const n of wb.SheetNames) if (!before.has(n)) { const s = pick(n); if (s) sheetSpecs[n] = s }
  }

  for (const note of activeNotes || []) {
    // constitution picks between entries for the same note title — Trade
    // Receivables is Company's Schedule III schedule, or the simpler ageing
    // table of a Proprietorship / Partnership / LLP.
    const entry = FILL_DETAILS_REGISTRY.find(e => e.match((note.title || '').toLowerCase(), constitution))
    if (!entry) continue
    const details = blank ? null : (noteDetailsMap.get(Number(note.num)) || null)
    // The live note goes along (never for the blank template) so a sheet can show
    // what the app itself shows before anything is saved — see the ageing entry.
    const dataRows = entry.toRows(details, blank ? null : note)
    if (!dataRows.length) continue  // e.g. LLP capital account: registry opts out

    const aoa = []
    aoa[NOTE_NUM_ROW] = [`Note ${note.num}`]
    aoa[TITLE_ROW] = [note.title]
    aoa[2] = []
    aoa[HEADER_ROW] = entry.headerRow
    for (const r of dataRows) aoa.push(r)

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // Column 0 (name/label) always wide; others size to fit their own header
    // text (capped at 40) so a long clarifying header — e.g. "CY Issued This
    // Year Only (not cumulative)" — isn't visually truncated at a flat 16.
    ws['!cols'] = entry.headerRow.map((h, i) => ({ wch: i === 0 ? 32 : Math.min(40, Math.max(16, (h || '').length + 2)) }))
    const sheetName = safeSheetName(`N${note.num} ${entry.sheetName}`, used)
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    sheetSpecs[sheetName] = registrySheetSpec(entry, dataRows)
    contents.push(`${sheetName}: ${note.title} (Note ${note.num})`)
    anySheet = true

    // Share Capital carries more than the Classes table this registry entry
    // round-trips (5% Shareholders, Promoters, Rights, Footnotes — see
    // ShareCapitalForm.jsx's other tabs) — bolted on as its own sheet right
    // after the Classes one, keyed to the same note number.
    if (entry.key === 'share-capital') {
      track(() => appendShareCapitalDetailsSheet(wb, note.num, details, used), () => shareCapitalDetailsSheetSpec(details))
      contents.push('Share Capital - Details: shareholders, promoters, rights, disclosures and footnotes of Share Capital')
      anySheet = true
    }
  }

  // Stock — bolted on as an additional sheet (not registry-driven, since it
  // has no "Note {num}" anchor). Stock's OWN standalone Excel in the Stock
  // tab is untouched; this just embeds the same layout here too so one
  // consolidated file covers everything. Sheet name is "Stock"-prefixed so
  // parseStockWorkbook (reused on upload) finds it.
  if (!blank && stockData) {
    const { opening, closing, pyOpening, pyClosing, heads } = stockData
    const srcWb = buildStockFilledWorkbook(opening, closing, pyOpening, pyClosing, true, heads || {})
    const srcName = srcWb.SheetNames[0]
    const name = safeSheetName('Stock', used)
    XLSX.utils.book_append_sheet(wb, srcWb.Sheets[srcName], name)
    sheetSpecs[name] = stockExcelSpec('filled').sheets['Stock*']
    contents.push(`${name}: Opening and Closing inventory by type (as on the Inventory screen)`)
    anySheet = true
  } else if (blank) {
    const srcWb = buildStockBlankTemplate()
    const srcName = srcWb.SheetNames[0]
    const name = safeSheetName('Stock', used)
    XLSX.utils.book_append_sheet(wb, srcWb.Sheets[srcName], name)
    sheetSpecs[name] = stockExcelSpec('template').sheets['Stock*']
    contents.push(`${name}: Opening and Closing inventory by type (as on the Inventory screen)`)
    anySheet = true
  }

  // Cash Flow Statement (CFS tab): the figures as the tab shows them, to fill in or correct here and upload again (see CFS/cfsWorkbook.js)
  if (cfsRows && cfsRows.length) {
    track(() => appendCfsSheet(wb, cfsRows, { blank, cc: cfsCc }), n => n === CFS_SHEET ? cfsSheetSpec(cfsRows, { blank, cc: cfsCc }) : null)
    contents.push(`${CFS_SHEET}: the Cash Flow Statement (as on the CFS screen)`)
    anySheet = true
  }

  if (!anySheet) {
    const ws = XLSX.utils.aoa_to_sheet([['No Fill Details forms are registered for the notes in this Trial Balance yet.']])
    XLSX.utils.book_append_sheet(wb, ws, 'Info')
  }

  // The Dep templates in this file are always blank (one row per asset, typed in).
  if (depITBlocks) {
    const s = depITExcelSpec('template', depITBlocks).sheets
    track(() => appendDepITTemplateSheets(wb, depITBlocks, used), n => pickSheetSpec(s, n))
    contents.push('Dep (IT) Template, Dep (IT) - WIP, IT Blocks Reference: Income-tax depreciation inputs (as on the Dep (Income Tax) screen)')
  }
  if (depCompScheduleII) {
    const s = depCompExcelSpec('template', depCompScheduleII).sheets
    track(() => appendDepCompTemplateSheets(wb, depCompScheduleII, used), n => pickSheetSpec(s, n))
    contents.push('Dep (Comp) Template, Schedule II Reference: Companies Act depreciation schedule (as on the Dep (Books) screen)')
  }

  SPECS.set(wb, { sheets: sheetSpecs, contents, blank })
  return wb
}

// ── T-047: the VERA Excel look (utils/veraExcel.js) ─────────────────────────
// buildFillDetailsWorkbook records here how each sheet is finished; the Notes
// screen calls finishWorkbook(wb, fillDetailsExcelSpec(wb)) at save time. Cell
// positions and sheet names are unchanged, so every parser reads old and new files.
const SPECS = new WeakMap()

// The same lookup veraExcel uses: exact name, else a 'prefix*' key.
function pickSheetSpec(sheets, name) {
  if (sheets[name]) return sheets[name]
  const hit = Object.entries(sheets).find(([k]) => k.endsWith('*') && name.startsWith(k.slice(0, -1)))
  return hit ? hit[1] : null
}

const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const L = (i) => colLetter(i + 1)          // 0-based column index -> letter
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

// Fixed, predefined lists — the only columns that get a dropdown (owner, 15 Nov 2026).
// Kept the same as the forms' own <select> options (LongTermBorrowingsForm.jsx,
// ShortTermBorrowingsForm.jsx, ShareCapitalForm.jsx, InvestmentsForm.jsx); the
// checks script compares them with those files.
export const FILL_DETAILS_LISTS = {
  yesNo: ['Yes', 'No'],
  shareType: ['Equity', 'Preference'],
  securedUnsecured: ['Secured', 'Unsecured'],
  ltbNature: ['Bonds / Debentures', 'Term Loans from Banks', 'Term Loans from Other Parties', 'Deferred Payment Liabilities', 'Deposits',
    'Loans and Advances from Related Parties', 'Long-term Maturities of Finance Lease Obligations', 'Other Loans and Advances'],
  ltbFrequency: ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'Bullet', 'Irregular'],
  stbNature: ['Cash Credit / Overdraft from Banks', 'Short-Term Loans from Banks', 'Short-Term Loans from Other Parties', 'Commercial Paper', 'Deposits',
    'Loans and Advances from Related Parties', 'Bills Discounted / Bills Payable', 'Other Short-Term Borrowings'],
  investmentRowType: ['INVESTMENT', 'PARTNER', 'CATEGORY'],
  investmentTrade: ['Trade investments', 'Other investments'],
  investmentQuotation: ['Quoted', 'Unquoted'],
  investmentPaidStatus: ['Fully paid', 'Partly paid'],
}

const SPARE_ROWS = 10   // empty yellow rows under a table that takes any number of rows

/**
 * How one registry sheet is finished. Row 4 is the header, data from row 5.
 * Labels the app fixes (Particulars, Period, Section) are not yellow; the cells
 * the user types in are. Ledger and lender names are free text (no dropdown).
 */
function registrySheetSpec(entry, dataRows) {
  const header = entry.headerRow || []
  const lastColIdx = header.length - 1
  const first = DATA_START_ROW + 1
  let rows = dataRows.length
  const inputCells = []
  const dropdowns = []
  let amount = []
  const blocked = []   // ranges such as "D7:E7" that take no entry
  const cells = (r, cols) => cols.forEach(c => inputCells.push(`${L(c)}${r}`))
  const pick = (col, list, name, fromRow, toRow, extra = {}) => dropdowns.push({ col: L(col), list, name, fromRow, toRow, prompt: `Choose ${name.toLowerCase()} from the list.`, error: `Choose one of the listed values for ${name}.`, ...extra })
  const label = (row, i) => String(row?.[i] ?? '').trim()
  const growing = () => { rows = dataRows.length + SPARE_ROWS }   // a list the user may extend
  const lastOf = () => first + rows - 1

  switch (entry.key) {
    case 'share-capital': {
      growing()
      for (let r = first; r <= lastOf(); r++) cells(r, range(0, lastColIdx))
      amount = range(2, lastColIdx)
      pick(1, FILL_DETAILS_LISTS.shareType, 'Type', first, lastOf())
      break
    }
    case 'owners-capital-account': {
      dataRows.forEach((row, i) => cells(first + i, /^previous year/i.test(label(row, 0)) ? range(1, lastColIdx) : range(0, lastColIdx)))
      amount = range(2, lastColIdx)
      break
    }
    case 'long-term-borrowings':
    case 'short-term-borrowings': {
      growing()
      const lt = entry.key === 'long-term-borrowings'
      for (let r = first; r <= lastOf(); r++) cells(r, range(0, lastColIdx))
      amount = lt ? [4, 5, 6, 7, 9] : [4, 5]
      pick(2, lt ? FILL_DETAILS_LISTS.ltbNature : FILL_DETAILS_LISTS.stbNature, 'Nature', first, lastOf())
      pick(3, FILL_DETAILS_LISTS.securedUnsecured, 'Secured/Unsecured', first, lastOf())
      if (lt) pick(10, FILL_DETAILS_LISTS.ltbFrequency, 'Frequency', first, lastOf())
      break
    }
    case 'cash-bank-details': {
      dataRows.forEach((_, i) => cells(first + i, [1, 2]))
      amount = [1]
      break
    }
    case 'trade-receivables-aging': {
      dataRows.forEach((row, i) => {
        const r = first + i
        if (/^include in output/i.test(label(row, 1))) { cells(r, [2]); pick(2, FILL_DETAILS_LISTS.yesNo, 'Include in Output', r, r); return }
        // T-069: grey, locked cells where the schedule takes no entry (rows (i) to (iv): Unbilled;
        // Unbilled Dues rows: Not Due and the five periods).
        const ageRow = TR_AGEING_ROWS.find(x => x.label.toLowerCase() === label(row, 1).toLowerCase())
        if (!ageRow || ageRow.computed) return
        const open = [], shut = []
        TR_AGEING_BUCKETS.forEach((b, j) => (trCellBlocked(ageRow, b.key) ? shut : open).push(2 + j))
        cells(r, open)
        shut.forEach((c, k) => { if (k === 0 || shut[k - 1] !== c - 1) { let e = c; while (shut.includes(e + 1)) e++; blocked.push(`${L(c)}${r}:${L(e)}${r}`) } })
      })
      amount = range(2, lastColIdx)
      break
    }
    case 'trade-receivables-ageing-noncorp': {
      // The last row is the Trial Balance figure, for reference only.
      dataRows.forEach((row, i) => { if (label(row, 0)) cells(first + i, [2]) })
      amount = [2]
      break
    }
    case 'trade-payables-disclosure': {
      dataRows.forEach((row, i) => {
        const r = first + i
        const section = label(row, 0).toUpperCase()
        if (section === 'AGEING') {
          // T-063: grey, locked cells where the schedule takes no entry; Total Due / Total are worked out.
          const ageRow = TP_AGEING_ROWS.find(x => x.label.toLowerCase() === label(row, 2).toLowerCase())
          if (!ageRow || ageRow.isTotal) return
          const open = [], shut = []
          TP_AGEING_BUCKETS.forEach((b, j) => (tpCellBlocked(ageRow, b.key) ? shut : open).push(3 + j))
          cells(r, open)
          // One range per run of side-by-side grey cells (an Undue row: Unbilled, then the four periods).
          shut.forEach((c, k) => { if (k === 0 || shut[k - 1] !== c - 1) { let e = c; while (shut.includes(e + 1)) e++; blocked.push(`${L(c)}${r}:${L(e)}${r}`) } })
        }
        else if (section === 'FLAGS') { cells(r, [3]); pick(3, FILL_DETAILS_LISTS.yesNo, label(row, 2).replace(/\s*\(yes\/no\)\s*$/i, '') || 'Yes/No', r, r) }
        else cells(r, [3])
      })
      amount = range(3, lastColIdx)
      break
    }
    default: {
      if (entry.key.startsWith('investments-')) {
        growing()
        for (let r = first; r <= lastOf(); r++) cells(r, range(0, lastColIdx))
        const col = (f) => 2 + INVESTMENT_FIELDS.indexOf(f)
        const P = 2 + INVESTMENT_FIELDS.length   // partner columns follow the fields
        amount = ['amountCY', 'amountPY', 'marketCY', 'marketPY', 'diminutionCY', 'diminutionPY', 'faceValue', 'paidPerUnit', 'uncalled',
          'firmCapitalCY', 'firmCapitalPY', 'companyCapitalCY', 'companyCapitalPY', 'redeemWithin12Months'].map(col).concat([P + 1, P + 2])
        pick(0, FILL_DETAILS_LISTS.investmentRowType, 'Row type', first, lastOf())
        // Category: the Schedule III list plus this file's own CATEGORY rows; a new
        // category is allowed after a warning, since a CATEGORY row may add it.
        const custom = dataRows.filter(r => label(r, 0) === 'CATEGORY').map(r => label(r, 1)).filter(Boolean)
        pick(col('category'), [...new Set([...INVESTMENT_CATEGORIES, ...custom])], 'Category', first, lastOf(),
          { strict: false, error: 'This category is not in the list. Keep it only if a CATEGORY row of this sheet adds it.' })
        pick(col('relationship'), INVESTMENT_RELATIONSHIPS, 'Relationship', first, lastOf())
        pick(col('quotation'), FILL_DETAILS_LISTS.investmentQuotation, 'Quoted/Unquoted', first, lastOf())
        pick(col('paidStatus'), FILL_DETAILS_LISTS.investmentPaidStatus, 'Paid status', first, lastOf())
        if (entry.key === 'investments-noncurrent') pick(col('trade'), FILL_DETAILS_LISTS.investmentTrade, 'Trade / other', first, lastOf())
      } else {
        // A registry entry added later: every column after the first is typed in.
        dataRows.forEach((_, i) => cells(first + i, range(1, lastColIdx)))
      }
    }
  }
  return {
    headerRow: HEADER_ROW + 1,
    lastRow: Math.max(HEADER_ROW + 1, lastOf()),
    lastCol: L(lastColIdx),
    inputCells,
    blockedCells: blocked,
    amountCols: amount.map(L),
    dropdowns,
    freezeCols: 1,
    autoFilter: false,
    widths: header.map((h, i) => i === 0 ? 32 : Math.min(40, Math.max(16, String(h || '').length + 2))),
  }
}

/**
 * The finishWorkbook spec of a workbook built by buildFillDetailsWorkbook.
 * @param {XLSX.WorkBook} wb
 */
export function fillDetailsExcelSpec(wb) {
  const meta = SPECS.get(wb) || { sheets: {}, contents: [], blank: true }
  const mode = meta.blank ? 'template' : 'filled'
  return {
    mode,
    sheets: meta.sheets,
    howTo: {
      title: mode === 'filled' ? 'Fill Details — saved data' : 'Fill Details — template',
      purpose: mode === 'filled'
        ? 'The Fill Details of the notes of this Trial Balance as saved in VERA, one sheet per note, with Inventory, Cash Flow and Depreciation. Keep it as a backup, or correct it here and upload it back to save every note at once.'
        : 'One sheet per note that needs details, with Inventory, Cash Flow and Depreciation. Fill in what applies and upload it back on the Notes screen to save every note at once.',
      steps: [
        'Open the sheet of a note (the sheets are listed below). Rows 1 and 2 name the note; do not change them.',
        'Type in the pale-yellow cells. Amounts are in rupees (for example 125000.50). Where a cell has a dropdown, pick from it.',
        'Leave a sheet as it is if that note has nothing to fill in: an untouched sheet is skipped and changes nothing in VERA.',
        'Save the file, then on VERA\'s Notes screen, under Fill Details Excel, click "⬆ Upload" and pick it.',
      ],
      columns: [
        ['Rows 1 and 2 of a note sheet', 'The note number and title. VERA finds the note by them.', 'Fixed'],
        ['Row 4 (blue)', 'The column headings of that note.', 'Fixed'],
        ['Labels (Particulars, Period, Section, Item)', 'The lines VERA expects, in its own words.', 'Fixed'],
        ['Pale-yellow cells', 'The figures and text for you to enter.', 'Fill in'],
        ['Cells with a list', 'A fixed choice: Yes/No, Secured/Unsecured, Nature, Frequency, Category, Type.', 'Dropdown'],
      ],
      tips: [
        ...meta.contents.map(c => `Sheet ${c}`),
        'Do not rename, reorder or delete the sheets or their header rows. VERA finds each note by the "Note N" in row 1 and its title in row 2.',
        'Ledger and lender names are typed in, not picked from a list.',
        'The reference sheets (IT Blocks Reference, Schedule II Reference) are only for reading.',
      ],
    },
  }
}

/**
 * @param {XLSX.WorkBook} wb
 * @returns {{noteNum:number, noteTitle:string, data:object}[], skippedBlank:number}}
 */
export function parseFillDetailsWorkbook(wb, { constitution = null } = {}) {
  const results = []
  let skippedBlank = 0
  for (const sheetName of wb.SheetNames) {
    if (sheetName === HOW_TO_SHEET || sheetName === LISTS_SHEET) continue  // T-047 guide / dropdown lists
    if (BOLT_ON_SHEET_PREFIXES.some(p => sheetName.startsWith(p))) continue
    const ws = wb.Sheets[sheetName]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (!aoa.length) continue
    const noteNumCell = (aoa[NOTE_NUM_ROW]?.[0] || '').toString()
    const m = noteNumCell.match(/note\s*(\d+)/i)
    if (!m) continue  // not a recognised Fill Details sheet (e.g. the Info sheet)
    const noteNum = parseInt(m[1], 10)
    const noteTitle = (aoa[TITLE_ROW]?.[0] || '').toString()
    const dataRows = aoa.slice(DATA_START_ROW).filter(r => r.some(c => (c ?? '') !== ''))

    const entry = FILL_DETAILS_REGISTRY.find(e => e.match(noteTitle.toLowerCase(), constitution))
    if (!entry) continue

    // Blank sheet → not filled → skip entirely, don't touch whatever's
    // already saved for this note. Compared against the exact blank
    // baseline this same entry would emit, not just "every cell empty",
    // since some forms default a placeholder row (e.g. Share Capital).
    const blankRows = entry.toRows(null)
    if (rowsEqual(dataRows, blankRows)) { skippedBlank++; continue }

    try {
      const data = entry.fromRows(dataRows, aoa[HEADER_ROW] || [])
      results.push({ noteNum, noteTitle, data })
    } catch (e) {
      if (entry.key.startsWith('investments-')) throw new Error(`Invalid investment sheet "${sheetName}": ${e.message}`)
      console.error(`Failed to parse Fill Details sheet "${sheetName}":`, e)
    }
  }
  return { results, skippedBlank }
}

/**
 * Parses the bolted-on "Stock"-prefixed sheet, if present, applying the same
 * blank-sheet-means-not-filled rule as parseFillDetailsWorkbook. Returns
 * null if no Stock sheet exists, or if it's present but entirely blank.
 */
export function parseFillDetailsStockSheet(wb) {
  if (!wb.SheetNames.some(n => n.startsWith('Stock'))) return null
  const parsed = parseStockWorkbook(wb)
  if (!parsed) return null
  const isBlank = (obj) => Object.values(obj || {}).every(v => !parseFloat(v))
  if (isBlank(parsed.opening) && isBlank(parsed.closing) && isBlank(parsed.pyOpening) && isBlank(parsed.pyClosing)) return null
  return parsed
}
