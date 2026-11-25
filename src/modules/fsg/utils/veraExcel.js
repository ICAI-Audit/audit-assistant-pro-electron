// T-047: one look for every Excel file Financial Statement Review hands out.
//
// The template builders keep producing their SheetJS workbook exactly as before
// (so every upload reader keeps finding its data in the same cells); this module
// is the finishing step at save time. It re-opens that workbook with ExcelJS and:
//   - puts a "How to Fill" sheet first (what the file is, steps, a column guide,
//     the dropdowns, tips) in the VERA blue;
//   - gives each data sheet a blue header row, frozen panes, borders, banded rows,
//     amount formats, and pale-yellow cells where the user is expected to type;
//   - adds real dropdowns (Excel data validation) where a column has a fixed list.
// SheetJS cannot write dropdowns, which is why this step uses ExcelJS.
//
// Dropdown policy (owner, 15 Nov 2026): a dropdown only where the choices are a
// fixed, predefined list (Yes/No, asset blocks, nature of item, ...). A column whose
// choices are long and built from the client's own data (ledger names, note lines)
// stays free text: no dropdown.
//
// Readers: use dataSheetNames(wb) (or skip HOW_TO_SHEET / LISTS_SHEET) when a
// reader would otherwise take the first sheet of an uploaded file.
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx-js-style'

export const HOW_TO_SHEET = 'How to Fill'
export const LISTS_SHEET = 'Lists'

// The VERA blues (Tailwind blue-800 / blue-900 / blue-50 / blue-100).
const BLUE = 'FF1E40AF'
const NAVY = 'FF1E3A8A'
const PALE = 'FFEFF6FF'
const PALE_2 = 'FFDBEAFE'
const INPUT = 'FFFFF9DB'      // a cell the user fills in
const GREY_TEXT = 'FF64748B'
const LINE = 'FFCBD5E1'
const WHITE = 'FFFFFFFF'

const thin = { style: 'thin', color: { argb: LINE } }
const BORDER = { top: thin, left: thin, bottom: thin, right: thin }

/** Sheet names of an uploaded workbook that hold data (not the guide or the lists). */
export function dataSheetNames(wb) {
  return (wb?.SheetNames || []).filter(n => n !== HOW_TO_SHEET && n !== LISTS_SHEET)
}

/** The first data sheet of an uploaded SheetJS workbook (skips How to Fill / Lists). */
export function firstDataSheet(wb) {
  const name = dataSheetNames(wb)[0]
  return name ? wb.Sheets[name] : undefined
}

const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const colNumber = (letters) => [...String(letters).toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
const cellText = (c) => {
  const v = c?.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return v.richText ? v.richText.map(t => t.text).join('') : (v.text ?? v.result ?? '')
  return String(v)
}

// The header row of a sheet: the first of its top rows with at least two filled cells.
function guessHeaderRow(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    const row = ws.getRow(r)
    let filled = 0
    row.eachCell({ includeEmpty: false }, c => { if (cellText(c).trim()) filled++ })
    if (filled >= 2) return r
  }
  return 1
}

function lastUsedColumn(ws, headerRow) {
  let last = 0
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c, n) => { if (cellText(c).trim()) last = Math.max(last, n) })
  return last || ws.columnCount || 1
}

// Rows under the header that belong to the table: stop at the first fully blank row.
function lastTableRow(ws, headerRow, lastCol, minRows = 0) {
  let r = headerRow
  while (r < ws.rowCount) {
    const row = ws.getRow(r + 1)
    let any = false
    for (let c = 1; c <= lastCol; c++) if (cellText(row.getCell(c)).trim()) { any = true; break }
    if (!any) break
    r++
  }
  return Math.max(r, headerRow + minRows)
}

function styleHeaderCell(cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
  cell.font = { bold: true, color: { argb: WHITE }, size: 10, name: 'Calibri' }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  cell.border = { top: { style: 'thin', color: { argb: NAVY } }, left: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } }, right: { style: 'thin', color: { argb: NAVY } } }
}

/**
 * Lists longer than Excel's 255-character inline limit (or with commas) go on a hidden
 * "Lists" sheet; returns the formula a validation should use.
 */
function listFormula(wbx, list, state) {
  const inline = `"${list.join(',')}"`
  if (inline.length <= 250 && !list.some(v => String(v).includes(','))) return inline
  let ls = wbx.getWorksheet(LISTS_SHEET)
  if (!ls) { ls = wbx.addWorksheet(LISTS_SHEET, { state: 'veryHidden' }); state.listCol = 0 }
  state.listCol += 1
  const col = colLetter(state.listCol)
  list.forEach((v, i) => { ls.getCell(`${col}${i + 1}`).value = String(v) })
  return `'${LISTS_SHEET}'!$${col}$1:$${col}$${list.length}`
}

function decorateDataSheet(wbx, ws, spec, mode, state) {
  const headerRow = spec.headerRow || guessHeaderRow(ws)
  const lastCol = spec.lastCol ? colNumber(spec.lastCol) : lastUsedColumn(ws, headerRow)
  const endRow = spec.lastRow || lastTableRow(ws, headerRow, lastCol, spec.minRows ?? (mode === 'template' ? 0 : 0))
  const inputCols = new Set((spec.inputCols || []).map(colNumber))
  const amountCols = new Set((spec.amountCols || []).map(colNumber))
  // Single cells to fill in (e.g. "F6"), for a column that is an input on some rows only.
  const inputCells = new Set((spec.inputCells || []).map(a => String(a).toUpperCase()))
  const firstInputRow = spec.firstInputRow || headerRow + 1

  // A loaded workbook shares one style object between cells of the same original style:
  // give every cell its own copy first, or colouring one cell would colour them all.
  const lastRowAll = Math.max(ws.rowCount, endRow, ...(spec.dropdowns || []).map(v => v.toRow || (v.openEnded ? headerRow + 200 : 0)))
  for (let r = 1; r <= lastRowAll; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= Math.max(lastCol, row.cellCount); c++) {
      const cell = row.getCell(c)
      cell.style = JSON.parse(JSON.stringify(cell.style || {}))
    }
  }

  ws.properties.tabColor = { argb: BLUE }
  // T-059: a SheetJS sheet comes in with no default row height; ExcelJS then writes <sheetFormatPr customHeight="1"/>
  // without the defaultRowHeight Excel requires, and Excel reports the sheet as damaged.
  if (!ws.properties.defaultRowHeight) ws.properties.defaultRowHeight = 15
  ws.views = [{ state: 'frozen', xSplit: spec.freezeCols || 0, ySplit: headerRow, showGridLines: false, zoomScale: 100 }]

  // Title rows above the header (note number, sheet title): keep, make them read as a title.
  for (let r = 1; r < headerRow; r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => {
      c.font = { bold: true, size: n === 1 && r === 1 ? 12 : 10, color: { argb: NAVY } }
    })
  }

  const hdr = ws.getRow(headerRow)
  hdr.height = Math.max(hdr.height || 0, spec.headerHeight || 30)
  for (let c = 1; c <= lastCol; c++) styleHeaderCell(hdr.getCell(c))

  for (let r = headerRow + 1; r <= endRow; r++) {
    const row = ws.getRow(r)
    const band = (r - headerRow) % 2 === 0
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c)
      cell.border = BORDER
      const isInput = (r >= firstInputRow && inputCols.has(c)) || inputCells.has(`${colLetter(c)}${r}`)
      if (isInput) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } }
      else if (band) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }
      const font = { size: 10, name: 'Calibri' }
      if (c === 1 && spec.boldFirstCol !== false) font.color = { argb: NAVY }
      cell.font = { ...(cell.font || {}), ...font }
      cell.alignment = { vertical: 'middle', wrapText: !amountCols.has(c), horizontal: amountCols.has(c) ? 'right' : (cell.alignment?.horizontal || 'left') }
      if (amountCols.has(c)) {
        // Numbers typed as text in a "filled" snapshot become real numbers, so they add up in Excel.
        const v = cell.value
        if (typeof v === 'string' && v.trim() !== '' && /^-?[\d,]*\.?\d+$/.test(v.trim())) cell.value = Number(v.replace(/,/g, ''))
        cell.numFmt = '#,##0.00;[Red]-#,##0.00;"-"'
      }
    }
  }

  // T-063: cells that take no entry (e.g. Trade Payables Unbilled / Not Due on an aged row): grey and locked by a
  // rule Excel enforces (any entry is refused). One validation per range, as for the dropdowns below (see T-059).
  for (const range of spec.blockedCells || []) {
    const [a, b = a] = String(range).toUpperCase().split(':')
    const from = ws.getCell(a), to = ws.getCell(b)
    for (let r = from.row; r <= to.row; r++) {
      for (let c = from.col; c <= to.col; c++) {
        const cell = ws.getRow(r).getCell(c)
        cell.value = null
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } }
      }
    }
    ws.dataValidations.add(`${a}:${b}`, {
      type: 'custom', allowBlank: false, formulae: ['FALSE'],
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'No entry here',
      error: 'This cell is not used in the schedule (grey). Enter the amount in a white or yellow cell of this row.',
    })
  }

  // Rows after the table (notes such as "Note: ..."): grey italic, never part of the table.
  for (let r = endRow + 1; r <= ws.rowCount; r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, c => { c.font = { italic: true, size: 9, color: { argb: GREY_TEXT } }; c.alignment = { wrapText: false } })
  }

  // Column widths: keep the builder's, but never narrower than the header needs.
  for (let c = 1; c <= lastCol; c++) {
    const col = ws.getColumn(c)
    const want = (spec.widths && spec.widths[c - 1]) || Math.min(60, Math.max(12, cellText(hdr.getCell(c)).length * 0.9 + 4))
    col.width = Math.max(col.width || 0, want)
  }

  if (spec.autoFilter !== false && mode === 'filled' && endRow > headerRow) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: endRow, column: lastCol } }
  }

  // Dropdowns. Range end defaults to the table end (templates: at least 200 rows for open-ended lists).
  for (const v of spec.dropdowns || []) {
    const col = v.col
    const from = v.fromRow || headerRow + 1
    const to = v.toRow || (v.openEnded ? Math.max(endRow, headerRow + 200) : endRow)
    const formula = listFormula(wbx, v.list, state)
    // T-059: one validation for the whole range. Set cell by cell, ExcelJS 4.4 squeezes the cells back into ranges
    // after sorting their addresses as text ("B10" before "B2"), so a dropdown crossing row 10 was written twice with
    // overlapping ranges (B10:B201 and B2:B201): Excel reported the file as damaged and dropped the dropdown on repair.
    // Excel also caps the prompt title at 32 characters and the prompt / error text at 255.
    ws.dataValidations.add(`${col}${from}:${col}${to}`, {
      type: 'list', allowBlank: true, formulae: [formula],
      showErrorMessage: v.strict !== false, errorStyle: v.strict === false ? 'warning' : 'stop',
      errorTitle: 'Choose from the list', error: String(v.error || `Pick one of the listed values for ${v.name || 'this column'}.`).slice(0, 255),
      showInputMessage: !!v.prompt, promptTitle: String(v.name || '').slice(0, 32), prompt: String(v.prompt || '').slice(0, 255),
    })
    for (let r = from; r <= to; r++) {
      const cell = ws.getCell(`${col}${r}`)
      if (v.openEnded && r > endRow) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } }
        cell.border = BORDER
      }
    }
  }
}

function writeHowTo(wbx, howTo, mode) {
  const ws = wbx.addWorksheet(HOW_TO_SHEET, { properties: { tabColor: { argb: NAVY } }, views: [{ showGridLines: false }] })
  ws.columns = [{ width: 3 }, { width: 30 }, { width: 70 }, { width: 22 }]
  let r = 2
  const band = (text, size = 16) => {
    ws.mergeCells(`B${r}:D${r}`)
    const c = ws.getCell(`B${r}`)
    c.value = text
    c.font = { bold: true, size, color: { argb: WHITE }, name: 'Calibri' }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
    c.alignment = { vertical: 'middle', indent: 1 }
    ws.getRow(r).height = size + 14
    r++
  }
  const heading = (text) => {
    r++
    ws.mergeCells(`B${r}:D${r}`)
    const c = ws.getCell(`B${r}`)
    c.value = text
    c.font = { bold: true, size: 11, color: { argb: NAVY } }
    c.border = { bottom: { style: 'medium', color: { argb: BLUE } } }
    r++
  }
  const para = (text, opts = {}) => {
    ws.mergeCells(`B${r}:D${r}`)
    const c = ws.getCell(`B${r}`)
    c.value = text
    c.font = { size: 10, color: { argb: opts.grey ? GREY_TEXT : 'FF1F2937' }, italic: !!opts.grey }
    c.alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(r).height = Math.max(16, Math.ceil(String(text).length / 105) * 15)
    r++
  }

  band(howTo.title || 'ICAI VERA template')
  ws.mergeCells(`B${r}:D${r}`)
  const sub = ws.getCell(`B${r}`)
  sub.value = `ICAI VERA · Financial Statement Review · ${mode === 'filled' ? 'Your saved data' : 'Blank template'}`
  sub.font = { size: 10, color: { argb: NAVY } }
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE_2 } }
  sub.alignment = { indent: 1 }
  r++

  if (howTo.purpose) { heading('What this file is for'); para(howTo.purpose) }

  if (howTo.steps?.length) {
    heading('How to fill it')
    howTo.steps.forEach((s, i) => {
      const n = ws.getCell(`B${r}`)
      n.value = `Step ${i + 1}`
      n.font = { bold: true, size: 10, color: { argb: BLUE } }
      n.alignment = { vertical: 'top' }
      ws.mergeCells(`C${r}:D${r}`)
      const t = ws.getCell(`C${r}`)
      t.value = s
      t.font = { size: 10 }
      t.alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = Math.max(16, Math.ceil(String(s).length / 85) * 15)
      r++
    })
  }

  if (howTo.columns?.length) {
    heading('Columns')
    const h1 = ws.getCell(`B${r}`); const h2 = ws.getCell(`C${r}`); const h3 = ws.getCell(`D${r}`)
    h1.value = 'Column'; h2.value = 'What to enter'; h3.value = 'Type'
    ;[h1, h2, h3].forEach(styleHeaderCell)
    ws.getRow(r).height = 20
    r++
    howTo.columns.forEach(([name, what, kind], i) => {
      const cells = [ws.getCell(`B${r}`), ws.getCell(`C${r}`), ws.getCell(`D${r}`)]
      cells[0].value = name; cells[1].value = what; cells[2].value = kind || ''
      cells.forEach((c, j) => {
        c.border = BORDER
        c.font = { size: 10, bold: j === 0, color: { argb: j === 0 ? NAVY : 'FF1F2937' } }
        c.alignment = { wrapText: true, vertical: 'top' }
        if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }
      })
      if (/dropdown/i.test(kind || '')) cells[2].font = { size: 10, bold: true, color: { argb: BLUE } }
      if (/fill in|you enter/i.test(kind || '')) cells[2].fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } }
      ws.getRow(r).height = Math.max(16, Math.ceil(String(what).length / 80) * 15)
      r++
    })
  }

  heading('Colours used in this file')
  const legend = [
    [BLUE, 'Blue header', 'Column headings. Do not rename or move them; VERA reads the file by these headings.', WHITE],
    [INPUT, 'Pale yellow cell', 'A cell for you to fill in (or pick from its dropdown).', 'FF1F2937'],
    [PALE, 'Light blue band', 'Alternate rows, only to make long tables easier to read.', 'FF1F2937'],
  ]
  for (const [fill, name, what, fontColor] of legend) {
    const a = ws.getCell(`B${r}`)
    a.value = name
    a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    a.font = { bold: true, size: 10, color: { argb: fontColor } }
    a.border = BORDER
    ws.mergeCells(`C${r}:D${r}`)
    const b = ws.getCell(`C${r}`)
    b.value = what
    b.font = { size: 10 }
    r++
  }

  if (howTo.tips?.length) {
    heading('Good to know')
    howTo.tips.forEach(t => para(`•  ${t}`))
  }

  r++
  para(`Generated by ICAI VERA on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Upload it back from the same screen it was downloaded from.`, { grey: true })
  return ws
}

/**
 * Finishes a SheetJS workbook in the VERA style and returns the .xlsx bytes.
 *
 * @param {object|Uint8Array|ArrayBuffer|number[]} wb  SheetJS workbook from a template builder (unchanged layout), or the .xlsx bytes of one
 * @param {object} spec
 * @param {'template'|'filled'} spec.mode
 * @param {object} spec.howTo   { title, purpose, steps[], columns[[name, what, type]], tips[] } — omit for no guide sheet
 * @param {object} spec.sheets  { [sheetName | 'prefix*']: { headerRow, inputCols[], inputCells[], amountCols[], dropdowns[{col,list,name,prompt,openEnded,strict}], widths[], freezeCols, lastRow, lastCol, firstInputRow, autoFilter } }
 *                              A sheet not named (and no '*') is left exactly as built.
 * @returns {Promise<Uint8Array>}
 */
export async function finishWorkbook(wb, spec = {}) {
  const isBytes = wb instanceof Uint8Array || wb instanceof ArrayBuffer || Array.isArray(wb)
  const raw = isBytes ? (Array.isArray(wb) ? new Uint8Array(wb) : wb) : XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const wbx = new ExcelJS.Workbook()
  await wbx.xlsx.load(raw)
  wbx.creator = 'ICAI VERA'
  wbx.company = 'ICAI VERA — Financial Statement Review'
  wbx.created = new Date()

  const mode = spec.mode || 'filled'
  const state = { listCol: 0 }
  for (const ws of [...wbx.worksheets]) {
    if (ws.name === LISTS_SHEET || ws.name === HOW_TO_SHEET) continue
    const s = spec.sheets?.[ws.name] || Object.entries(spec.sheets || {}).find(([k]) => k.endsWith('*') && ws.name.startsWith(k.slice(0, -1)))?.[1]
    if (!s) continue
    decorateDataSheet(wbx, ws, s, mode, state)
  }

  if (spec.howTo) {
    const guide = writeHowTo(wbx, spec.howTo, mode)
    // Put the guide first (ExcelJS writes sheets in orderNo order); Excel opens on it.
    const others = wbx.worksheets.filter(w => w !== guide)
    guide.orderNo = 0
    others.forEach((w, i) => { w.orderNo = i + 1 })
    wbx.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }]
  }

  const out = await wbx.xlsx.writeBuffer()
  return new Uint8Array(out)
}
