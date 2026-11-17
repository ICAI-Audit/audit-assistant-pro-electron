// ── Analytical ratios (Features > Ratio > Analytical Ratios) ──────────────
// A wider set of financial-analysis ratios (liquidity, solvency, activity,
// profitability, cost structure, growth and, for a Company, per-share
// figures), worked out from the same processed financials object that the
// Balance Sheet and Profit & Loss screens use (useFinancials's `data`).
//
// The Balance Sheet line items come through matchToBuckets, the Schedule III
// line matching that the BS screen uses. Group totals (current assets, current
// liabilities, non-current liabilities) also include the uncategorised ledgers
// routed into that group, as the BS face does. Owners' / Shareholders' funds
// are taken as Total Equity and Liabilities less Non-current and Current
// liabilities, so the same rule works for a Company, LLP, firm or proprietor.
//
// Turnover ratios can be worked on average balances (Current Year only: the
// Previous Year average needs the year before it, which the app does not
// hold) or on closing balances (both years). The screen lets the user choose.
// These are analytical aids for the auditor, not statutory disclosures; the
// Schedule III ratios stay in utils/ratios.js.

import { BS_STRUCTURE, matchToBuckets, buildUncatBuckets, elGroupOf, assetGroupOf } from './bsStructure'

const Z = { total: 0, prevTotal: 0 }
const v = (x) => ({ total: x?.total || 0, prevTotal: x?.prevTotal || 0 })
const add = (...xs) => ({ total: xs.reduce((s, x) => s + (x?.total || 0), 0), prevTotal: xs.reduce((s, x) => s + (x?.prevTotal || 0), 0) })
const sub = (a, b) => ({ total: (a?.total || 0) - (b?.total || 0), prevTotal: (a?.prevTotal || 0) - (b?.prevTotal || 0) })
const safeDiv = (n, d) => (n === null || n === undefined || d === null || d === undefined || isNaN(n) || isNaN(d) || Math.abs(d) < 0.005) ? null : n / d

function groupTotal(structure, buckets, uncatByGroup, num) {
  const g = structure.find(x => x.num === num)
  if (!g) return Z
  const keys = g.lines.map(l => l.key)
  const u = uncatByGroup[num]
  return {
    total: keys.reduce((s, k) => s + (buckets[k]?.total || 0), 0) + (u ? u.total : 0),
    prevTotal: keys.reduce((s, k) => s + (buckets[k]?.prevTotal || 0), 0) + (u ? u.prevTotal : 0),
  }
}

const sumSecs = (sections, rx) => (sections || []).filter(s => rx.test((s.level1 || '').trim()))
  .reduce((a, s) => ({ total: a.total + (s.total || 0), prevTotal: a.prevTotal + (s.prevTotal || 0) }), { total: 0, prevTotal: 0 })
const sumAll = (sections) => (sections || []).reduce((a, s) => ({ total: a.total + (s.total || 0), prevTotal: a.prevTotal + (s.prevTotal || 0) }), { total: 0, prevTotal: 0 })

const REVENUE_RX = /revenue from operation/i
const CLOSING_STOCK_RX = /closing stock/i
const TAX_RX = /tax expense/i
const FINANCE_RX = /finance cost|finance charge|interest (and|&) finance/i
const DEP_RX = /depreciation|amortis|amortiz/i
const EMPLOYEE_RX = /employee benefit|salar|wages/i
const MATERIAL_RX = /cost of materials? consumed|purchases? of stock.in.trade|^purchases?\b/i
const CHANGES_RX = /changes in inventor|opening stock/i
const EXCEPTIONAL_RX = /exceptional|extraordinary|discontinu/i

/**
 * The figures every analytical ratio is built from, each { total, prevTotal }
 * (Current Year, Previous Year). Null when there is nothing to work from.
 */
export function analyticalFigures(data) {
  if (!data || !Array.isArray(data.elSections) || !Array.isArray(data.assetSections)) return null
  const { buckets: elB, unmatched: elU } = matchToBuckets(data.elSections, BS_STRUCTURE.el)
  const { buckets: aB, unmatched: aU } = matchToBuckets(data.assetSections, BS_STRUCTURE.assets, data)
  const { byGroup: elUG } = buildUncatBuckets(elU, elGroupOf)
  const { byGroup: aUG } = buildUncatBuckets(aU, assetGroupOf)
  const b = (bk, k) => v(bk[k])

  const totalEL = sumAll(data.elSections)
  const totalAssets = sumAll(data.assetSections)
  const ncl = groupTotal(BS_STRUCTURE.el, elB, elUG, '3')
  const cl = groupTotal(BS_STRUCTURE.el, elB, elUG, '4')
  const nca = groupTotal(BS_STRUCTURE.assets, aB, aUG, '1')
  const ca = groupTotal(BS_STRUCTURE.assets, aB, aUG, '2')
  const equity = sub(sub(totalEL, ncl), cl)

  const ltb = b(elB, 'ltb'), stb = b(elB, 'stb')
  const totalDebt = add(ltb, stb)
  const inventories = b(aB, 'inventories')
  const tradeRec = b(aB, 'trade_rec')
  const tradePay = b(elB, 'trade_pay')
  const cash = b(aB, 'cash')
  const currInv = b(aB, 'curr_investments')
  const fixedAssets = add(b(aB, 'ppe_tangible'), b(aB, 'ppe_intangible'), b(aB, 'cwip'), b(aB, 'iad'))

  const inc = data.incomeSections || [], exp = data.expenseSections || []
  const incomeNoStock = inc.filter(s => !CLOSING_STOCK_RX.test(s.level1 || ''))
  const revenue = sumSecs(incomeNoStock, REVENUE_RX)
  const totalIncome = sumAll(incomeNoStock)
  const otherIncome = sub(totalIncome, revenue)
  const closingStockInc = sumSecs(inc, CLOSING_STOCK_RX)
  const tax = sumSecs(exp, TAX_RX)
  const finance = sumSecs(exp, FINANCE_RX)
  const depreciation = sumSecs(exp, DEP_RX)
  const employee = sumSecs(exp, EMPLOYEE_RX)
  const purchases = sumSecs(exp, MATERIAL_RX)
  const cogs = sub(add(purchases, sumSecs(exp, CHANGES_RX)), closingStockInc)
  const exceptional = sumSecs(exp, EXCEPTIONAL_RX)
  const totalExpenses = sub(sumAll(exp), closingStockInc)
  const pat = { total: data.netProfit || 0, prevTotal: data.prevNetProfit || 0 }
  const pbt = add(pat, tax)
  const ebit = add(pbt, finance)
  const ebitda = add(ebit, depreciation)
  const operatingProfit = sub(ebit, otherIncome)
  const otherExpenses = sub(sub(sub(sub(sub(sub(totalExpenses, tax), finance), depreciation), employee), cogs), exceptional)
  const operatingCost = sub(sub(sub(totalExpenses, tax), finance), exceptional)
  const workingCapital = sub(ca, cl)
  const capitalEmployed = sub(totalAssets, cl)
  const debtReduction = Math.max(0, (totalDebt.prevTotal || 0) - (totalDebt.total || 0))

  return {
    totalEL, totalAssets, ncl, cl, nca, ca, equity, ltb, stb, totalDebt, inventories, tradeRec, tradePay, cash, currInv,
    fixedAssets, revenue, totalIncome, otherIncome, tax, finance, depreciation, employee, purchases, cogs, exceptional,
    totalExpenses, pat, pbt, ebit, ebitda, operatingProfit, otherExpenses, operatingCost, workingCapital, capitalEmployed,
    totalLiabilities: add(ncl, cl), quickAssets: sub(ca, inventories), cashAndCurrInv: add(cash, currInv),
    defensiveAssets: add(cash, currInv, tradeRec), longTermFunds: add(equity, ltb),
    debtServiceCY: (finance.total || 0) + debtReduction,
    eps: data.eps || null,
  }
}

// Row definitions. `n`/`d` name the figures (or a function of the figures) behind
// the numerator and denominator; `avg` marks a balance-sheet denominator that may
// be averaged; `fmt` is ratio (times), percent, days or amount.
export const ANALYTICAL_GROUPS = [
  { key: 'liquidity', label: 'A. Liquidity ratios', rows: [
    { key: 'current', label: 'Current Ratio', nl: 'Current Assets', dl: 'Current Liabilities', n: 'ca', d: 'cl', fmt: 'ratio' },
    { key: 'quick', label: 'Quick (Acid-test) Ratio', nl: 'Current Assets less Inventories', dl: 'Current Liabilities', n: 'quickAssets', d: 'cl', fmt: 'ratio' },
    { key: 'cash', label: 'Cash Ratio', nl: 'Cash and Cash Equivalents + Current Investments', dl: 'Current Liabilities', n: 'cashAndCurrInv', d: 'cl', fmt: 'ratio' },
    { key: 'nwc', label: 'Net Working Capital', nl: 'Current Assets less Current Liabilities', dl: '', n: 'workingCapital', fmt: 'amount' },
    { key: 'defensive', label: 'Defensive Interval', nl: 'Cash + Current Investments + Trade Receivables', dl: 'Daily cash operating expenses', n: 'defensiveAssets', d: f => perDay(sub(f.operatingCost, f.depreciation)), fmt: 'days1' },
  ] },
  { key: 'solvency', label: 'B. Solvency / leverage ratios', rows: [
    { key: 'debt_equity', label: 'Debt-Equity Ratio', nl: 'Total Borrowings', dl: "Owners' / Shareholders' Funds", n: 'totalDebt', d: 'equity', fmt: 'ratio' },
    { key: 'lt_debt_equity', label: 'Long-term Debt to Equity', nl: 'Long-term Borrowings', dl: "Owners' / Shareholders' Funds", n: 'ltb', d: 'equity', fmt: 'ratio' },
    { key: 'tol_equity', label: 'Total Outside Liabilities to Equity', nl: 'Non-current + Current Liabilities', dl: "Owners' / Shareholders' Funds", n: 'totalLiabilities', d: 'equity', fmt: 'ratio' },
    { key: 'debt_ratio', label: 'Debt Ratio', nl: 'Non-current + Current Liabilities', dl: 'Total Assets', n: 'totalLiabilities', d: 'totalAssets', fmt: 'ratio' },
    { key: 'equity_ratio', label: 'Equity (Proprietary) Ratio', nl: "Owners' / Shareholders' Funds", dl: 'Total Assets', n: 'equity', d: 'totalAssets', fmt: 'ratio' },
    { key: 'fa_ltf', label: 'Fixed Assets to Long-term Funds', nl: 'Net Fixed Assets (PPE, intangibles, CWIP)', dl: 'Equity + Long-term Borrowings', n: 'fixedAssets', d: 'longTermFunds', fmt: 'ratio' },
    { key: 'interest_cover', label: 'Interest Coverage Ratio', nl: 'Earnings before Interest and Tax', dl: 'Finance Costs', n: 'ebit', d: 'finance', fmt: 'ratio' },
    { key: 'dscr', label: 'Debt Service Coverage Ratio (estimate)', nl: 'Profit after Tax + Depreciation + Finance Costs', dl: 'Finance Costs + reduction in Borrowings', n: f => add(f.pat, f.depreciation, f.finance), d: f => ({ total: f.debtServiceCY, prevTotal: null }), fmt: 'ratio', estimate: true },
  ] },
  { key: 'activity', label: 'C. Activity / turnover ratios', rows: [
    { key: 'inv_turnover', label: 'Inventory Turnover Ratio', nl: 'Cost of Goods Sold', dl: 'Inventories', n: 'cogs', d: 'inventories', avg: true, fmt: 'ratio' },
    { key: 'inv_days', label: 'Inventory Holding Period', nl: 'Inventories x 365', dl: 'Cost of Goods Sold', n: 'inventories', d: 'cogs', avgN: true, fmt: 'days' },
    { key: 'rec_turnover', label: 'Trade Receivables Turnover Ratio', nl: 'Revenue from Operations', dl: 'Trade Receivables', n: 'revenue', d: 'tradeRec', avg: true, fmt: 'ratio' },
    { key: 'rec_days', label: 'Average Collection Period', nl: 'Trade Receivables x 365', dl: 'Revenue from Operations', n: 'tradeRec', d: 'revenue', avgN: true, fmt: 'days' },
    { key: 'pay_turnover', label: 'Trade Payables Turnover Ratio', nl: 'Purchases / Cost of Materials Consumed', dl: 'Trade Payables', n: 'purchases', d: 'tradePay', avg: true, fmt: 'ratio' },
    { key: 'pay_days', label: 'Average Payment Period', nl: 'Trade Payables x 365', dl: 'Purchases / Cost of Materials Consumed', n: 'tradePay', d: 'purchases', avgN: true, fmt: 'days' },
    { key: 'cash_cycle', label: 'Operating (Cash Conversion) Cycle', nl: 'Inventory days + Collection days - Payment days', dl: '', special: 'cash_cycle', fmt: 'days' },
    { key: 'fa_turnover', label: 'Fixed Assets Turnover Ratio', nl: 'Revenue from Operations', dl: 'Net Fixed Assets', n: 'revenue', d: 'fixedAssets', avg: true, fmt: 'ratio' },
    { key: 'ta_turnover', label: 'Total Assets Turnover Ratio', nl: 'Revenue from Operations', dl: 'Total Assets', n: 'revenue', d: 'totalAssets', avg: true, fmt: 'ratio' },
    { key: 'wc_turnover', label: 'Working Capital Turnover Ratio', nl: 'Revenue from Operations', dl: 'Net Working Capital', n: 'revenue', d: 'workingCapital', avg: true, fmt: 'ratio' },
    { key: 'ce_turnover', label: 'Capital Employed Turnover Ratio', nl: 'Revenue from Operations', dl: 'Capital Employed (Total Assets - Current Liabilities)', n: 'revenue', d: 'capitalEmployed', avg: true, fmt: 'ratio' },
  ] },
  { key: 'profitability', label: 'D. Profitability ratios', rows: [
    { key: 'gp', label: 'Gross Profit Ratio', nl: 'Revenue from Operations - Cost of Goods Sold', dl: 'Revenue from Operations', n: f => sub(f.revenue, f.cogs), d: 'revenue', fmt: 'percent' },
    { key: 'ebitda_margin', label: 'EBITDA Margin', nl: 'Profit before Tax + Finance Costs + Depreciation', dl: 'Revenue from Operations', n: 'ebitda', d: 'revenue', fmt: 'percent' },
    { key: 'op_margin', label: 'Operating Profit Ratio', nl: 'EBIT less Other Income', dl: 'Revenue from Operations', n: 'operatingProfit', d: 'revenue', fmt: 'percent' },
    { key: 'pbt_margin', label: 'Profit before Tax Ratio', nl: 'Profit before Tax', dl: 'Revenue from Operations', n: 'pbt', d: 'revenue', fmt: 'percent' },
    { key: 'np', label: 'Net Profit Ratio', nl: 'Profit after Tax', dl: 'Revenue from Operations', n: 'pat', d: 'revenue', fmt: 'percent' },
    { key: 'roa', label: 'Return on Assets', nl: 'Profit after Tax', dl: 'Total Assets', n: 'pat', d: 'totalAssets', avg: true, fmt: 'percent' },
    { key: 'roe', label: 'Return on Equity', nl: 'Profit after Tax', dl: "Owners' / Shareholders' Funds", n: 'pat', d: 'equity', avg: true, fmt: 'percent' },
    { key: 'roce', label: 'Return on Capital Employed', nl: 'Earnings before Interest and Tax', dl: 'Capital Employed (Total Assets - Current Liabilities)', n: 'ebit', d: 'capitalEmployed', avg: true, fmt: 'percent' },
    { key: 'etr', label: 'Effective Tax Rate', nl: 'Tax Expense', dl: 'Profit before Tax', n: 'tax', d: 'pbt', fmt: 'percent' },
  ] },
  { key: 'cost', label: 'E. Cost structure (to Revenue from Operations)', rows: [
    { key: 'operating_ratio', label: 'Operating Ratio', nl: 'Expenses excluding Finance Costs, Tax and Exceptional items', dl: 'Revenue from Operations', n: 'operatingCost', d: 'revenue', fmt: 'percent' },
    { key: 'cogs_ratio', label: 'Material / Cost of Goods Sold Ratio', nl: 'Cost of Goods Sold', dl: 'Revenue from Operations', n: 'cogs', d: 'revenue', fmt: 'percent' },
    { key: 'employee_ratio', label: 'Employee Cost Ratio', nl: 'Employee Benefits Expense', dl: 'Revenue from Operations', n: 'employee', d: 'revenue', fmt: 'percent' },
    { key: 'finance_ratio', label: 'Finance Cost Ratio', nl: 'Finance Costs', dl: 'Revenue from Operations', n: 'finance', d: 'revenue', fmt: 'percent' },
    { key: 'dep_ratio', label: 'Depreciation Ratio', nl: 'Depreciation and Amortisation', dl: 'Revenue from Operations', n: 'depreciation', d: 'revenue', fmt: 'percent' },
    { key: 'other_exp_ratio', label: 'Other Expenses Ratio', nl: 'Other Expenses', dl: 'Revenue from Operations', n: 'otherExpenses', d: 'revenue', fmt: 'percent' },
    { key: 'other_income_share', label: 'Other Income to Total Income', nl: 'Other Income', dl: 'Total Income', n: 'otherIncome', d: 'totalIncome', fmt: 'percent' },
  ] },
  { key: 'growth', label: 'F. Growth (Current Year over Previous Year)', rows: [
    { key: 'g_revenue', label: 'Growth in Revenue from Operations', nl: 'Revenue from Operations', dl: 'Previous Year figure', growth: 'revenue', fmt: 'percent' },
    { key: 'g_ebitda', label: 'Growth in EBITDA', nl: 'EBITDA', dl: 'Previous Year figure', growth: 'ebitda', fmt: 'percent' },
    { key: 'g_pat', label: 'Growth in Profit after Tax', nl: 'Profit after Tax', dl: 'Previous Year figure', growth: 'pat', fmt: 'percent' },
    { key: 'g_assets', label: 'Growth in Total Assets', nl: 'Total Assets', dl: 'Previous Year figure', growth: 'totalAssets', fmt: 'percent' },
    { key: 'g_equity', label: "Growth in Owners' / Shareholders' Funds", nl: "Owners' / Shareholders' Funds", dl: 'Previous Year figure', growth: 'equity', fmt: 'percent' },
  ] },
  { key: 'share', label: 'G. Per-share figures (Company)', companyOnly: true, rows: [
    { key: 'eps', label: 'Earnings per Share (Basic)', nl: 'Profit after Tax', dl: 'Number of Equity Shares', special: 'eps', fmt: 'rupee' },
    { key: 'bvps', label: 'Book Value per Share', nl: "Shareholders' Funds", dl: 'Number of Equity Shares', special: 'bvps', fmt: 'rupee' },
  ] },
]

function perDay(x) { return { total: (x.total || 0) / 365, prevTotal: (x.prevTotal || 0) / 365 } }
const pick = (f, spec) => typeof spec === 'function' ? spec(f) : (spec ? f[spec] : null)
const average = (x) => ((x.total || 0) + (x.prevTotal || 0)) / 2

/**
 * Every analytical ratio, grouped. `basis` is 'closing' (Current and Previous
 * Year on closing balances) or 'average' (Current Year on the average of the
 * opening and closing balances; no Previous Year figure).
 * Returns null when there is nothing to work from, else
 *   [{ key, label, rows: [{ ...meta, numCY, denCY, cy, py, changePct }] }]
 */
export function computeAnalyticalRatios(data, { basis = 'closing', isCompany = false } = {}) {
  const f = analyticalFigures(data)
  if (!f) return null
  const useAvg = basis === 'average'
  const result = []
  const byKey = {}
  for (const group of ANALYTICAL_GROUPS) {
    if (group.companyOnly && !isCompany) continue
    const rows = []
    for (const meta of group.rows) {
      let numCY = null, denCY = null, cy = null, py = null
      if (meta.growth) {
        const x = f[meta.growth]
        numCY = x.total; denCY = x.prevTotal
        cy = safeDiv(x.total - x.prevTotal, Math.abs(x.prevTotal))
      } else if (meta.special === 'cash_cycle') {
        const days = (k) => byKey[k] || {}
        const a = days('inv_days'), r = days('rec_days'), p = days('pay_days')
        const combine = (y) => (a[y] === null || a[y] === undefined || r[y] === null || r[y] === undefined || p[y] === null || p[y] === undefined) ? null : a[y] + r[y] - p[y]
        cy = combine('cy'); py = combine('py')
      } else if (meta.special === 'eps') {
        const e = f.eps || {}
        cy = e.overrides?.basicCY ?? e.autoBasicCY ?? null
        py = e.overrides?.basicPY ?? e.autoBasicPY ?? null
        numCY = f.pat.total; denCY = e.sharesCY ?? null
      } else if (meta.special === 'bvps') {
        const e = f.eps || {}
        numCY = f.equity.total; denCY = e.sharesCY ?? null
        cy = e.sharesMissingCY ? null : safeDiv(f.equity.total, e.sharesCY)
        py = (e.sharesMissingPY || e.pyNotApplicable) ? null : safeDiv(f.equity.prevTotal, e.sharesPY)
      } else {
        const n = pick(f, meta.n)
        const d = meta.d ? pick(f, meta.d) : null
        if (!d) {
          numCY = n.total; cy = n.total; py = n.prevTotal
        } else if (useAvg && (meta.avg || meta.avgN)) {
          // Average basis: the balance-sheet side is averaged, CY only.
          const nv = meta.avgN ? average(n) : n.total
          const dv = meta.avg ? average(d) : d.total
          numCY = nv; denCY = dv; cy = safeDiv(nv, dv); py = null
        } else {
          numCY = n.total; denCY = d.total
          cy = safeDiv(n.total, d.total)
          py = (d.prevTotal === null || d.prevTotal === undefined) ? null : safeDiv(n.prevTotal, d.prevTotal)
        }
        if (meta.fmt === 'days') { cy = cy === null ? null : cy * 365; py = py === null ? null : py * 365 }
      }
      const changePct = (meta.growth || cy === null || py === null || Math.abs(py) < 1e-9) ? null : ((cy - py) / Math.abs(py)) * 100
      const row = { ...meta, numCY, denCY, cy, py, changePct }
      byKey[meta.key] = row
      rows.push(row)
    }
    result.push({ key: group.key, label: group.label, rows })
  }
  return result
}

/** A ratio cell as text: "2.35" (times), "18.42%", "45 days", rupee amounts in Indian grouping. */
export function fmtAnalytical(n, fmt) {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return ''
  if (fmt === 'percent') return (n * 100).toFixed(2) + '%'
  if (fmt === 'days' || fmt === 'days1') return `${Math.round(n)} days`
  if (fmt === 'amount') {
    const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return n < 0 ? `(${s})` : s
  }
  if (fmt === 'rupee') return n.toFixed(2)
  return n.toFixed(2)
}
