// T-048 / T-049 synthetic checks, called by test-fsg-integration.mjs: Variance Analysis arithmetic and its saved
// reasons (BS, PL, Notes), and the Analytical / Company Additional Disclosure ratios (Features > Ratio).
// Renderer modules are bundled the way Vite does, as the other FSG checks do.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

const near = (a, b, eps = 1e-6) => a !== null && a !== undefined && Math.abs(a - b) < eps

export async function checkAnalyseChange({ root, userData, check, staff, entityId, periodId, defaultRs }) {
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export * from './src/modules/fsg/utils/changeAnalysis.js';
    export * from './src/modules/fsg/utils/analyticalRatios.js';
    export { computeRatios } from './src/modules/fsg/utils/ratios.js';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const bundlePath = join(userData, 'analyse-change.cjs'); writeFileSync(bundlePath, bundle.outputFiles[0].contents)
  const { computeChange, fmtChangePct, computeAnalyticalRatios, fmtAnalytical, computeRatios } = require(bundlePath)

  // ── Variance Analysis arithmetic ────────────────────────────────────────────
  let c = computeChange(1250, 1000)
  check('T-048 Amount of Change is Current Year minus Previous Year', c.amount === 250, c)
  check('T-048 Percentage of Change is the change over the Previous Year', near(c.pct, 25) && fmtChangePct(c) === '25.00%', c)
  c = computeChange(800, 1000)
  check('T-048 a fall shows as a negative change', c.amount === -200 && fmtChangePct(c) === '-20.00%', c)
  c = computeChange(-50, -100)
  check('T-048 a smaller loss reads as an improvement (Previous Year taken as an absolute value)', c.amount === 50 && near(c.pct, 50), c)
  c = computeChange(500, 0)
  check('T-048 a nil Previous Year gives N.A., not a division by zero', c.amount === 500 && c.pct === null && fmtChangePct(c) === 'N.A.', c)
  check('T-048 a line with no figure in either year has no change', computeChange(undefined, undefined) === null && fmtChangePct(computeChange(0, 0)) === '')
  check('T-048 a figure missing in one year is taken as nil', computeChange(undefined, 300).amount === -300 && computeChange(300, undefined).amount === 300)

  // ── Reason of Change is saved per Trial Balance ─────────────────────────
  const up = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 't048.xlsx', tbRows: [
    { period: '2024-25', branch: '', ledger_code: 'R1', name: 'Rc Capital', opening_balance: 0, debit: 0, credit: 1000, closing_balance: 1000, parent: 'Capital Account', group_parent: 'Capital Account' },
    { period: '2024-25', branch: '', ledger_code: 'R2', name: 'Rc Bank', opening_balance: 0, debit: 1000, credit: 0, closing_balance: -1000, parent: 'Current Assets', group_parent: 'Current Assets' },
  ] })
  check('T-048 synthetic Trial Balance for the reason checks', up.ok, up)
  if (up.ok) {
    const tbId = up.result.tb.id
    await staff('mappedTB:run', tbId, defaultRs, {})
    const saves = await Promise.all([
      staff('remarks:save', { tbId, scope: 'bs_change', scope_key: 'Trade Payables', remark: 'Higher purchases in Q4 2025' }),
      staff('remarks:save', { tbId, scope: 'pl_change', scope_key: 'Revenue from operations', remark: 'New product line A1' }),
      staff('remarks:save', { tbId, scope: 'notes_change', scope_key: 'Trade Payables::Total', remark: 'Credit period 45 to 60 days' }),
    ])
    check('T-048 a Reason of Change saves on BS, PL and Notes', saves.every(r => r.ok), saves)
    const list = await staff('remarks:listByTB', tbId)
    const got = (scope, key) => (list.ok ? list.result : []).find(r => r.scope === scope && r.scope_key === key)?.remark
    check('T-048 the saved reasons read back with their text (letters and numbers kept)', got('bs_change', 'Trade Payables') === 'Higher purchases in Q4 2025'
      && got('pl_change', 'Revenue from operations') === 'New product line A1' && got('notes_change', 'Trade Payables::Total') === 'Credit period 45 to 60 days', list)
    const sameKey = got('bs', 'Trade Payables')
    check('T-048 a reason does not overwrite the remark of the same line', sameKey === undefined)
    const cleared = await staff('remarks:save', { tbId, scope: 'bs_change', scope_key: 'Trade Payables', remark: '   ' })
    const after = await staff('remarks:listByTB', tbId)
    check('T-048 clearing the reason box deletes the reason', cleared.ok && !(after.result || []).some(r => r.scope === 'bs_change'), after)
    const bad = await staff('remarks:save', { tbId, scope: 'bs_changes', scope_key: 'x', remark: 'y' })
    check('T-048 an unknown remark scope is still refused', !bad.ok, bad)
  }

  // ── Analytical ratios on a synthetic Company ────────────────────────────
  const sec = (level1, lines) => ({ level1, total: lines.reduce((s, l) => s + l[1], 0), prevTotal: lines.reduce((s, l) => s + l[2], 0),
    lines: lines.map(([level2, total, prevTotal]) => ({ level2, total, prevTotal })) })
  const data = {
    elSections: [
      sec("Shareholders' funds", [['Share capital', 100, 100], ['Reserves and Surplus', 50, 30]]),
      sec('Non-current liabilities', [['Long-term borrowings', 80, 100]]),
      sec('Current liabilities', [['Trade Payables', 40, 30], ['Short-term borrowings', 20, 10]]),
    ],
    assetSections: [
      sec('Non-current assets', [['Tangible assets', 120, 110]]),
      sec('Current assets', [['Inventories', 50, 40], ['Trade receivables', 60, 70], ['Cash and cash equivalents', 60, 50]]),
    ],
    incomeSections: [sec('Revenue from operations', [['Sale of products', 500, 400]]), sec('Other income', [['Interest income', 20, 10]])],
    expenseSections: [
      sec('Cost of materials consumed', [['Raw material', 300, 250]]), sec('Employee benefits expense', [['Salaries', 50, 40]]),
      sec('Finance costs', [['Interest', 10, 12]]), sec('Depreciation and amortization expense', [['Depreciation', 15, 14]]),
      sec('Other expenses', [['Rent', 45, 34]]), sec('Tax expense', [['Current tax', 25, 15]]),
    ],
    netProfit: 75, prevNetProfit: 45,
    eps: { sharesCY: 10, sharesPY: 10, autoBasicCY: 7.5, autoBasicPY: 4.5, overrides: {} },
  }
  const flat = (groups) => Object.fromEntries(groups.flatMap(g => g.rows).map(r => [r.key, r]))
  const closing = flat(computeAnalyticalRatios(data, { basis: 'closing', isCompany: true }))
  check('T-049 liquidity: current 2.83 (PY 4.00), quick 2.00, cash 1.00', near(closing.current.cy, 170 / 60) && near(closing.current.py, 4) && near(closing.quick.cy, 2) && near(closing.cash.cy, 1), [closing.current, closing.quick, closing.cash])
  check('T-049 solvency: equity = total E&L less liabilities; debt-equity 0.67; interest cover 11', near(closing.debt_equity.cy, 100 / 150) && near(closing.debt_equity.py, 110 / 130) && near(closing.interest_cover.cy, 11) && near(closing.equity_ratio.cy, 150 / 290), [closing.debt_equity, closing.interest_cover])
  check('T-049 activity: inventory turnover 6, collection 43.8 days, cash cycle = inventory + collection - payment days',
    near(closing.inv_turnover.cy, 6) && near(closing.rec_days.cy, 43.8) && near(closing.cash_cycle.cy, 50 / 300 * 365 + 43.8 - 40 / 300 * 365) && fmtAnalytical(closing.rec_days.cy, 'days') === '44 days', [closing.inv_turnover, closing.rec_days, closing.cash_cycle])
  check('T-049 profitability: GP 40%, NP 15%, ROCE on total assets less current liabilities, effective tax 25%',
    near(closing.gp.cy, 0.4) && near(closing.np.cy, 0.15) && near(closing.roce.cy, 110 / 230) && near(closing.etr.cy, 0.25) && fmtAnalytical(closing.gp.cy, 'percent') === '40.00%', [closing.gp, closing.np, closing.roce])
  check('T-049 cost structure and growth: employee cost 10%, revenue growth 25%, PAT growth 66.67%',
    near(closing.employee_ratio.cy, 0.1) && near(closing.g_revenue.cy, 0.25) && near(closing.g_pat.cy, 30 / 45) && closing.g_revenue.py === null, [closing.employee_ratio, closing.g_revenue])
  check('T-049 per-share figures for a Company: EPS 7.50, book value 15.00', near(closing.eps.cy, 7.5) && near(closing.bvps.cy, 15) && near(closing.bvps.py, 13), [closing.eps, closing.bvps])
  const average = flat(computeAnalyticalRatios(data, { basis: 'average', isCompany: false }))
  check('T-049 average basis: Current Year on average balances, no Previous Year figure', near(average.inv_turnover.cy, 300 / 45) && average.inv_turnover.py === null && near(average.current.py, 4), average.inv_turnover)
  check('T-049 per-share figures are left out for a non-company', !('eps' in average) && !('bvps' in average))
  check('T-049 a nil denominator gives a blank, not Infinity', computeAnalyticalRatios({ ...data, expenseSections: data.expenseSections.filter(s => !/finance/i.test(s.level1)) }, {})
    .flatMap(g => g.rows).find(r => r.key === 'interest_cover').cy === null && fmtAnalytical(Infinity, 'ratio') === '')

  // ── Company Additional Disclosure Ratio = the Policy Financial Ratios ───
  const stat = computeRatios(data)
  check('T-049 the Company Additional Disclosure screen uses the eleven Schedule III ratios', stat.length === 11 && near(stat.find(r => r.key === 'current').cy, 170 / 60), stat.map(r => r.key))
}
