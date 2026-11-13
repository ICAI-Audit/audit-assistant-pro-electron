import * as XLSX from 'xlsx-js-style'
import { hasMissingAlie, missingAlieMessages, missingAlieItems } from './missingAlie'
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function missingAlieHTML(report) {
  return missingAlieMessages(report).map(m => `<div class="missing-alie-warning" style="color:#b91c1c;font-weight:bold;font-size:10pt;border:1pt solid #b91c1c;padding:4pt;margin:4pt 0;overflow-wrap:anywhere">${esc(m)}</div>`).join('')
}
export function missingAlieLedgerRows(report) {
  return missingAlieItems(report).map(r => [r.warningPeriod, r.branch_name || `TB ${r.tb_id}`, `${r.ledger_name} [#${r.tb_row_id}]`, Math.max(0, -r.amount), Math.max(0, r.amount)])
}
export const MISSING_ALIE_HEADERS = ['Period', 'Branch / TB', 'Ledger', 'Debit (Rs)', 'Credit (Rs)']
export function missingAlieLedgerHTML(report) {
  const rows = missingAlieLedgerRows(report)
  if (!rows.length) return ''
  return `<h3>Ledgers requiring ALIE classification (amounts in rupees)</h3><table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>${MISSING_ALIE_HEADERS.map(h => `<th style="border:1px solid #aaa;padding:3pt">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td style="border:1px solid #aaa;padding:3pt;overflow-wrap:anywhere">${esc(typeof v === 'number' ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}
export function pushMissingAlieRows(rows, report, indices = []) {
  for (const message of missingAlieMessages(report)) { indices.push(rows.length); rows.push([message]) }
  return indices
}
export function styleMissingAlieRows(ws, indices, lastCol = 3) {
  ws['!merges'] = ws['!merges'] || []
  ws['!rows'] = ws['!rows'] || []
  for (const r of indices) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 })
    if (!ws[addr]) continue
    ws[addr].s = { font: { color: { rgb: 'B91C1C' }, bold: true, sz: 11 }, alignment: { wrapText: true, vertical: 'center' } }
    ws['!merges'].push({ s: { r, c: 0 }, e: { r, c: lastCol } })
    ws['!rows'][r] = { hpt: 60 }
  }
}
export function appendMissingAlieSheet(wb, report) {
  if (!hasMissingAlie(report)) return
  const rows = [['Missing ALIE classifications (amounts in rupees)']]
  const warnings = pushMissingAlieRows(rows, report)
  rows.push(MISSING_ALIE_HEADERS, ...missingAlieLedgerRows(report))
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 55 }, { wch: 22 }, { wch: 22 }]
  styleMissingAlieRows(ws, warnings, 4)
  for (const addr of Object.keys(ws)) if (/^[DE]\d+$/.test(addr) && ws[addr].t === 'n') ws[addr].z = '#,##0.00'
  XLSX.utils.book_append_sheet(wb, ws, 'ALIE Exceptions')
}
