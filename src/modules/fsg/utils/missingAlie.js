// Warning amounts always use absolute rupees, independently of statement denomination.
const amount = v => Number(v) || 0
const rupees = v => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function summary(rows, field) {
  const unique = [...new Map(rows.map(r => [`${r.tb_id}:${r.tb_row_id}`, r])).values()].filter(r => amount(r[field]) !== 0)
  const debit = unique.reduce((s, r) => s + Math.max(0, -amount(r[field])), 0)
  const credit = unique.reduce((s, r) => s + Math.max(0, amount(r[field])), 0)
  return { count: unique.length, debit, credit, signedNet: credit - debit,
    items: unique.map(r => ({ ...r, amount: amount(r[field]) })) }
}
export function buildMissingAlieReport(cyRows = [], pyRows = null, pyOff = false) {
  return { cy: summary(cyRows, 'closing_balance'),
    py: pyOff ? summary([], 'closing_balance') : summary(pyRows ?? cyRows, pyRows == null ? 'opening_balance' : 'closing_balance'),
    pyBasis: pyRows == null ? 'opening balances from the current TB' : 'closing balances from the comparative TB' }
}
export const hasMissingAlie = report => !!(report?.error || report?.cy?.count || report?.py?.count)
export function missingAlieMessages(report) {
  if (!hasMissingAlie(report)) return []
  if (report.error) return ['ALIE verification unavailable — resolution required. Item count and closing balances could not be verified. Generation remains available.']
  const result = []
  for (const [key, label] of [['cy', 'CY closing'], ['py', `PY (${report.pyBasis})`]]) {
    const s = report[key]
    if (!s?.count) continue
    const net = s.signedNet < 0 ? 'Dr' : s.signedNet > 0 ? 'Cr' : 'Nil'
    result.push(`ALIE classification missing for ${s.count} ${s.count === 1 ? 'ledger' : 'ledgers'}. ${label} balance: Rs ${rupees(Math.abs(s.signedNet))} ${net}. These unresolved amounts are excluded from the Balance Sheet and Profit and Loss pending classification. Statements may be incomplete or unbalanced. Review these ledgers and assign their correct ALIE. Gross balances (Rs): Debit ${rupees(s.debit)}; Credit ${rupees(s.credit)}.`)
  }
  return result
}
export function missingAlieItems(report) {
  return ['cy', 'py'].flatMap(period => (report?.[period]?.items || []).map(r => ({ ...r, warningPeriod: period.toUpperCase() })))
}
