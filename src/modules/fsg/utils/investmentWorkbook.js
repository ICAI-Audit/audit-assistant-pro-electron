import { investmentKind, validateInvestmentInput, INVESTMENT_CATEGORIES, INVESTMENT_RELATIONSHIPS } from './investments.js'
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

// T-047: the veraExcel sheet spec of an investments sheet of the Fill Details workbook
// (GenerateFinancials/fillDetailsWorkbook.js: row 1 note number, row 4 header, data from
// row 5). Key it by the registry entry's sheetName (or `${sheetName}*`). Cells are unchanged,
// so investmentFromRows reads old and new files alike. Dropdowns only for the fixed lists
// that validateInvestmentInput checks; Category also accepts the sheet's own CATEGORY rows,
// so it warns instead of refusing. Ledger, investee and partner names stay free text.
const colOf = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const fieldCol = (f) => colOf(3 + INVESTMENT_FIELDS.indexOf(f))
const INVESTMENT_MONEY = ['amountCY', 'amountPY', 'marketCY', 'marketPY', 'diminutionCY', 'diminutionPY', 'faceValue', 'paidPerUnit', 'uncalled', 'firmCapitalCY', 'firmCapitalPY', 'companyCapitalCY', 'companyCapitalPY', 'redeemWithin12Months']
const INVESTMENT_PREFILLED = ['ledgerKey', 'subclass', 'ledgerName']   // filled by VERA from the Trial Balance
export function investmentSheetSpec(kind = 'noncurrent', { headerRow = 4, toRow } = {}) {
  const firstRow = headerRow + 1
  const last = toRow || headerRow + 200
  const dd = (field, list, name, strict = true) => ({ col: fieldCol(field), fromRow: firstRow, toRow: last, list, name, strict,
    prompt: `Choose the ${name.toLowerCase()} from the list.`, error: strict ? `Please choose one of the listed values for ${name}.` : `This ${name.toLowerCase()} is not in the list. Keep it only if it is added as a CATEGORY row.` })
  const partnerCols = Array.from({ length: 5 }, (_, i) => colOf(3 + INVESTMENT_FIELDS.length + i))
  return {
    headerRow,
    lastCol: colOf(INVESTMENT_HEADERS.length),
    minRows: 1,
    inputCols: [...INVESTMENT_FIELDS.filter(f => !INVESTMENT_PREFILLED.includes(f)).map(fieldCol), ...partnerCols],
    amountCols: [...INVESTMENT_MONEY.map(fieldCol), partnerCols[1], partnerCols[2]],
    autoFilter: false,
    dropdowns: [
      { col: 'A', fromRow: firstRow, toRow: last, list: ['INVESTMENT', 'CATEGORY', 'PARTNER'], name: 'Row type', prompt: 'INVESTMENT, CATEGORY (an added category) or PARTNER (a partner of a firm above).', error: 'Row type must be INVESTMENT, CATEGORY or PARTNER.' },
      dd('category', INVESTMENT_CATEGORIES, 'Category', false),
      dd('relationship', INVESTMENT_RELATIONSHIPS, 'Relationship'),
      ...(kind === 'noncurrent' ? [dd('trade', ['Trade investments', 'Other investments'], 'Trade / other')] : []),
      dd('quotation', ['Quoted', 'Unquoted'], 'Quoted / unquoted'),
      dd('paidStatus', ['Fully paid', 'Partly paid'], 'Paid status'),
    ],
  }
}
