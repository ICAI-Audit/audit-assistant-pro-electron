import { investmentKind, validateInvestmentInput } from './investments.js'
export const INVESTMENT_FIELDS = ['ledgerKey', 'subclass', 'ledgerName', 'companyName', 'category', 'relationship', 'trade', 'quotation', 'paidStatus', 'quantityCY', 'quantityPY', 'faceValue', 'paidPerUnit', 'uncalled', 'amountCY', 'amountPY', 'valuation', 'marketCY', 'marketPY', 'diminutionCY', 'diminutionPY', 'nature', 'firmCapitalCY', 'firmCapitalPY', 'companyCapitalCY', 'companyCapitalPY', 'firmDate', 'capitalBasis', 'dateDifference', 'redemptionDate', 'redeemWithin12Months', 'redemptionNote']
export const INVESTMENT_HEADERS = ['Row type', 'Investment row ID', ...INVESTMENT_FIELDS, 'Partner name', 'Partner capital CY', 'Partner capital PY', 'Partner profit share CY (%)', 'Partner profit share PY (%)']
export function investmentToRows(details, note) {
  const d = details || note?.investmentDetails
  if (!d) return [['INVESTMENT', '1']]
  const rows = (d.categories || []).map(c => ['CATEGORY', c])
  for (const [idx, e] of (d.entries || []).entries()) {
    rows.push(['INVESTMENT', String(idx + 1), ...INVESTMENT_FIELDS.map(f => e[f] ?? '')])
    for (const p of e.partners || []) rows.push(['PARTNER', String(idx + 1), ...INVESTMENT_FIELDS.map(() => ''), p.name || '', p.capitalCY ?? '', p.capitalPY ?? '', p.profitShareCY ?? '', p.profitSharePY ?? ''])
  }
  return rows.length ? rows : [['INVESTMENT', '1']]
}
export function investmentFromRows(rows) {
  const categories = rows.filter(r => r[0] === 'CATEGORY').map(r => String(r[1]).trim()).filter(Boolean)
  const entries = [], ids = new Set()
  for (const r of rows.filter(r => r[0] === 'INVESTMENT' && r.slice(2).some(v => v !== '' && v != null))) {
    const id = String(r[1])
    if (ids.has(id)) throw new Error('Duplicate investment row ID in workbook.')
    ids.add(id)
    const e = Object.fromEntries(INVESTMENT_FIELDS.map((f, i) => [f, r[i + 2] ?? '']))
    e.partners = rows.filter(p => p[0] === 'PARTNER' && String(p[1]) === id).map(p => Object.fromEntries(['name', 'capitalCY', 'capitalPY', 'profitShareCY', 'profitSharePY'].map((f, i) => [f, p[2 + INVESTMENT_FIELDS.length + i] ?? ''])))
    entries.push(e)
  }
  if (rows.some(r => r[0] === 'PARTNER' && !ids.has(String(r[1])))) throw new Error('Partner row has no matching investment row ID.')
  const data = { version: 1, entries, categories }
  validateInvestmentInput(data)
  return data
}
export const INVESTMENT_REGISTRY = ['noncurrent', 'current'].map(kind => ({
  key: `investments-${kind}`, match: t => investmentKind(t) === kind, sheetName: kind === 'current' ? 'Current investments' : 'Non-current investments',
  headerRow: INVESTMENT_HEADERS, toRows: investmentToRows, fromRows: investmentFromRows,
}))
