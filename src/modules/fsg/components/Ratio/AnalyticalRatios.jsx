import React, { useState } from 'react'
import { useFinancials } from '../../hooks/useFinancials'
import { computeAnalyticalRatios, fmtAnalytical } from '../../utils/analyticalRatios'
import { fmtRatioAmount } from '../../utils/ratios'
import { statementColumnLabels } from '../../utils/statementDates'

const BASIS_KEY = 'fsg.analyticalRatios.basis'
const readBasis = () => { try { return localStorage.getItem(BASIS_KEY) === 'average' ? 'average' : 'closing' } catch { return 'closing' } }

// Features > Ratio > Analytical Ratios: liquidity, solvency, activity,
// profitability, cost structure, growth and per-share ratios for financial
// analysis (utils/analyticalRatios.js). Worked out from the same figures as
// the Balance Sheet and Profit & Loss screens.
export default function AnalyticalRatios({ entity, activeTB, prevTB, activeRsId }) {
  const { data, loading, error } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const [basis, setBasisState] = useState(readBasis)
  const setBasis = (b) => { setBasisState(b); try { localStorage.setItem(BASIS_KEY, b) } catch { /* per-viewer convenience only */ } }
  const isCompany = parseInt(entity?.constitution) === 3
  const { cy: cyLabel, py: pyLabel } = statementColumnLabels(activeTB, prevTB)
  const groups = data ? computeAnalyticalRatios(data, { basis, isCompany }) : null

  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance first.</div>
  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="shrink-0 px-5 py-3 border-b border-gray-200 flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-base font-bold text-blue-900">Analytical Ratios</h1>
          <p className="text-xs text-gray-500 mt-0.5">Ratios for financial analysis, worked out from the Balance Sheet and Profit &amp; Loss as they stand now. Analytical aids for review, not statutory disclosures.</p>
        </div>
        <div className="flex items-center gap-1 text-xs shrink-0" role="group" aria-label="Basis for turnover ratios">
          <span className="text-gray-500 mr-1">Turnover ratios on</span>
          {[['closing', 'Closing balances'], ['average', 'Average balances']].map(([k, label]) => (
            <button key={k} onClick={() => setBasis(k)}
              className={`px-2 py-1 rounded border ${basis === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'}`}
              title={k === 'average' ? 'Average of opening and closing balances: Current Year only' : 'Closing balances: Current Year and Previous Year'}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        {!groups ? (
          <div className="text-sm text-gray-400">No financial statements to work from yet.</div>
        ) : (
          <table className="w-full text-xs border-collapse table-fixed" data-testid="analytical-ratios">
            <colgroup><col style={{ width: '20%' }} /><col style={{ width: '28%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /></colgroup>
            <thead className="sticky top-0 bg-white">
              <tr className="bg-blue-50 border-b-2 border-blue-800 text-blue-900 [&>th]:align-bottom">
                <th className="text-left py-1.5 px-2">Ratio</th>
                <th className="text-left py-1.5 px-2">Formula</th>
                <th className="fsg-wrap text-right py-1.5 px-2">Numerator (CY)</th>
                <th className="fsg-wrap text-right py-1.5 px-2">Denominator (CY)</th>
                <th className="fsg-dated-heading text-right py-1.5 px-2">{cyLabel}</th>
                <th className="fsg-dated-heading text-right py-1.5 px-2">{pyLabel}</th>
                <th className="fsg-wrap text-right py-1.5 px-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <React.Fragment key={g.key}>
                  <tr className="bg-gray-100"><td colSpan={7} className="py-1.5 px-2 font-bold text-gray-800">{g.label}</td></tr>
                  {g.rows.map(r => (
                    <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="fsg-wrap py-1.5 px-2 pl-4 font-medium text-gray-800">
                        {r.label}
                        {r.estimate && <span className="ml-1 text-[10px] text-amber-700" title="Best-effort: the app has no repayment schedule, so principal repaid is taken as the fall in borrowings.">(estimate)</span>}
                      </td>
                      <td className="fsg-wrap py-1.5 px-2 text-gray-600">{r.growth ? `(Current Year - Previous Year) / Previous Year, of ${r.nl}` : r.dl ?<>{r.nl} <span className="text-gray-400">/</span> {r.dl}</> : r.nl}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-600">{r.special === 'cash_cycle' ? '' : fmtRatioAmount(r.numCY)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-600">{r.special === 'cash_cycle' || !r.dl ? '' : (r.denCY === null || r.denCY === undefined ? '' : (r.special ? String(r.denCY) : fmtRatioAmount(r.denCY)))}</td>
                      <td className="py-1.5 px-2 text-right font-mono font-semibold text-gray-900">{fmtAnalytical(r.cy, r.fmt)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-500">{r.growth ? '' : fmtAnalytical(r.py, r.fmt)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-700">{r.changePct === null ? '' : `${r.changePct.toFixed(2)}%`}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        <ul className="mt-3 text-[11px] text-gray-400 list-disc pl-4 space-y-0.5">
          <li>Owners' / Shareholders' Funds = Total Equity and Liabilities less Non-current and Current Liabilities. Total Borrowings = Long-term + Short-term Borrowings.</li>
          <li>Cost of Goods Sold = Cost of materials consumed + Purchases of Stock-in-Trade + Changes in inventories. Capital Employed = Total Assets less Current Liabilities.</li>
          <li>Average balances need the opening balance, which is the Previous Year's closing balance; so on that basis there is no Previous Year figure. Blank = cannot be worked out (for example, a nil denominator).</li>
        </ul>
      </div>
    </div>
  )
}
