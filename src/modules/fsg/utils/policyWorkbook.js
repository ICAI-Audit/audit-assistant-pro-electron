// T-043: the Policy note (formerly General Notes) as an Excel format a firm can
// download, fill in its own wording and upload back.
//
// One row per paragraph or bullet line, in three columns:
//   Section heading | Type (Paragraph / Bullet / Table) | Text
// A filled "Section heading" starts a new section; rows with a blank heading
// continue the section above. The app letters the sections (a), (b), (c) ...
// itself (utils/pointLabel.js), so any "(b)" or "2." typed before a heading is
// removed. A table cannot be typed in one Excel cell: a "Table" row stands for
// the table of the same-named section as it already is in the app (for example
// the Financial Ratios table, or the related-party grids) and keeps it.
import * as XLSX from 'xlsx-js-style'

export const POLICY_SHEET = 'Policy'
export const POLICY_HEADERS = ['Section heading', 'Type', 'Text']
const TABLE_TEXT = '[Table - kept as it is in the app]'

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&')
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const toText = (html) => decode(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
  .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').trim()
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The blocks of a point's text, in order: paragraphs, bullet lines and tables. */
export function policyBlocks(html) {
  const out = []
  const rx = /<table\b[\s\S]*?<\/table>|<li\b[^>]*>([\s\S]*?)<\/li>|<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\2>/gi
  let m
  while ((m = rx.exec(String(html || ''))) !== null) {
    if (/^<table/i.test(m[0])) out.push({ type: 'Table', text: TABLE_TEXT, html: m[0] })
    else if (m[1] !== undefined) out.push({ type: 'Bullet', text: toText(m[1]) })
    else out.push({ type: 'Paragraph', text: toText(m[3]) })
  }
  return out.filter(b => b.type === 'Table' || b.text !== '')
}

/** Rows for the workbook from the Policy's points (the heading only on a section's first row). */
export function policyRowsFromPoints(points) {
  const rows = []
  for (const pt of points || []) {
    const blocks = policyBlocks(pt.contentHtml)
    if (!blocks.length) { rows.push([pt.header || '', 'Paragraph', '']); continue }
    blocks.forEach((b, i) => rows.push([i === 0 ? (pt.header || '') : '', b.type, b.text]))
  }
  return rows
}

/** "(b) Basis of ..." / "2. Basis ..." / "ii) Basis ..." -> "Basis ..." */
export function stripSectionNumbering(heading) {
  return String(heading || '')
    .replace(/^\s*(?:\(\s*(?:[a-z]{1,2}|[ivxlcdm]{1,6}|\d{1,3})\s*\)|(?:[a-z]{1,2}|[ivxlcdm]{1,6}|\d{1,3})[.)])\s*/i, '')
    .replace(/\s+/g, ' ').trim()
}

const typeOf = (v) => {
  const s = norm(v)
  if (/^bullet|^point|^list/.test(s)) return 'Bullet'
  if (/^table/.test(s)) return 'Table'
  return 'Paragraph'
}

/**
 * Rebuilds the Policy's points from workbook rows ([heading, type, text]).
 * existingPoints supplies the tables kept by "Table" rows (matched by heading).
 * Returns { points, warnings, errors }; nothing is saved here.
 */
export function pointsFromPolicyRows(rows, existingPoints = [], newId = (i) => `pt_upload_${Date.now()}_${i}`) {
  const errors = [], warnings = []
  const sections = []
  rows.forEach((row, i) => {
    const [heading, type, text] = [row[0], row[1], row[2]].map(v => (v === null || v === undefined ? '' : String(v)))
    if (!heading.trim() && !text.trim() && !type.trim()) return
    if (heading.trim()) {
      const clean = stripSectionNumbering(heading)
      if (!clean) { errors.push(`Row ${i + 2}: the section heading is only a number.`); return }
      sections.push({ header: clean, items: [] })
    } else if (!sections.length) {
      errors.push(`Row ${i + 2}: text without a section heading above it.`)
      return
    }
    if (text.trim() || typeOf(type) === 'Table') sections[sections.length - 1].items.push({ type: typeOf(type), text: text.replace(/\r\n/g, '\n') })
  })
  if (!sections.length && !errors.length) errors.push('No section headings were found in the "Section heading" column.')

  const tablesOf = (header) => {
    const pt = (existingPoints || []).find(p => norm(p.header) === norm(header))
    return pt ? policyBlocks(pt.contentHtml).filter(b => b.type === 'Table').map(b => b.html) : []
  }
  const points = sections.map((s, si) => {
    const tables = tablesOf(s.header)
    let html = '', bullets = [], tableIdx = 0
    const flush = () => { if (bullets.length) { html += `<ul>${bullets.map(b => `<li><p>${b}</p></li>`).join('')}</ul>`; bullets = [] } }
    for (const it of s.items) {
      if (it.type === 'Bullet') {
        for (const line of it.text.split('\n').map(l => l.trim()).filter(Boolean)) bullets.push(escapeHtml(line))
        continue
      }
      flush()
      if (it.type === 'Table') {
        if (tables[tableIdx]) html += tables[tableIdx++]
        else warnings.push(`"${s.header}": a Table row was skipped because the app has no table under this heading to keep.`)
        continue
      }
      for (const para of it.text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)) {
        html += `<p>${para.split('\n').map(l => escapeHtml(l.trim())).join('<br>')}</p>`
      }
    }
    flush()
    return { id: newId(si), header: s.header, contentHtml: html || '<p></p>' }
  })
  return { points, warnings, errors }
}

const EXAMPLE_ROWS = [
  ['Basis of Preparation of Financial Statements (AS-1)', 'Paragraph', 'The financial statements have been prepared and presented taking into consideration the Fundamental Accounting Assumptions as per Accounting Standard-1 (AS-1) issued by the Institute of Chartered Accountants of India.'],
  ['', 'Paragraph', 'The Fundamental Accounting Assumptions as per AS-1 which have been followed are:'],
  ['', 'Bullet', 'Assumption of Going Concern'],
  ['', 'Bullet', 'Adoption of Accrual System of Accounting'],
  ['', 'Bullet', 'Adoption of Rule of Consistency'],
  ['Revenue Recognition (AS-9)', 'Paragraph', 'Write your own wording here. Add as many rows as needed.'],
]
const GUIDE = [
  ['How to fill the Policy format'],
  [''],
  ['1. One row per paragraph or bullet line. Keep the three column headings on the Policy sheet exactly as they are.'],
  ['2. Write the Section heading only on the first row of a section. Leave it blank on the rows that continue that section.'],
  ['3. Do not number the sections: the app letters them (a), (b), (c) ... in the order they appear. A "(b)" or "2." typed before a heading is removed.'],
  ['4. Type: "Paragraph" for normal text (the default when blank), "Bullet" for a bullet line. Several lines in one Bullet cell become several bullets.'],
  ['5. Type "Table" keeps the table that the same-named section already has in the app (for example Financial Ratios). Tables cannot be typed in Excel.'],
  ['6. Uploading replaces every section of this year\'s Policy after you confirm. Bold, italics and alignment are not carried by Excel: set them in the app afterwards.'],
]

function styledWorkbook(rows) {
  const ws = XLSX.utils.aoa_to_sheet([POLICY_HEADERS, ...rows])
  ws['!cols'] = [{ wch: 45 }, { wch: 12 }, { wch: 110 }]
  for (let c = 0; c < POLICY_HEADERS.length; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
    if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A8A' } } }
  }
  for (let r = 1; r <= rows.length; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell) cell.s = { alignment: { wrapText: true, vertical: 'top' }, ...(c === 0 && cell.v ? { font: { bold: true } } : {}) }
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, POLICY_SHEET)
  const guide = XLSX.utils.aoa_to_sheet(GUIDE)
  guide['!cols'] = [{ wch: 130 }]
  XLSX.utils.book_append_sheet(wb, guide, 'How to fill')
  return wb
}

/** A blank format with a worked example (from the AS-1 basis-of-preparation paragraph). */
export function buildPolicyBlankWorkbook() { return styledWorkbook(EXAMPLE_ROWS) }

/** The Policy exactly as it currently reads. */
export function buildPolicyFilledWorkbook(points) { return styledWorkbook(policyRowsFromPoints(points)) }

/** Reads an uploaded Policy workbook (columns found by their headings). */
export function parsePolicyWorkbook(wb, existingPoints = []) {
  const name = wb.SheetNames.find(n => norm(n) === norm(POLICY_SHEET)) || wb.SheetNames[0]
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
  const headerIdx = aoa.findIndex(r => r.some(v => /section heading|^heading$/i.test(String(v).trim())))
  if (headerIdx < 0) return { points: [], warnings: [], errors: ['This is not a Policy format: no "Section heading" column was found.'] }
  const head = aoa[headerIdx].map(v => norm(v))
  const col = (rx, fallback) => { const i = head.findIndex(h => rx.test(h)); return i >= 0 ? i : fallback }
  const iH = col(/section heading|^heading$/, 0), iT = col(/^type$/, 1), iX = col(/^text$|paragraph|content/, 2)
  const rows = aoa.slice(headerIdx + 1).map(r => [r[iH], r[iT], r[iX]])
  return pointsFromPolicyRows(rows, existingPoints)
}
