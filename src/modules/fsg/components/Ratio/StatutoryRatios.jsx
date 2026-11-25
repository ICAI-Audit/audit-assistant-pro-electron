import React from 'react'
import { useFinancials } from '../../hooks/useFinancials'
import { computeRatios, fmtRatioCell, fmtVariance, fmtRatioAmount } from '../../utils/ratios'
import { statementColumnLabels } from '../../utils/statementDates'

// Features > Ratio > Company Additional Disclosure Ratio: the eleven ratios
// Schedule III (Division I, Additional Regulatory Information) asks a Company
// to disclose. Same computation as the Financial Ratios table in Policy
// (utils/ratios.js computeRatios), shown here as a working view. The
// explanation for a change of more than 25% is written in Policy, under the
// Financial Ratios table ("Comments on Ratios").
export default function StatutoryRatios({ entity, activeTB, prevTB, activeRsId }) {
  const { data, loading, error } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const isCompany = parseInt(entity?.constitution) === 3
  const { cy: cyLabel, py: pyLabel } = statementColumnLabels(activeTB, prevTB)
  const rows = data ? computeRatios(data) : null

  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance first.</div>
  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="shrink-0 px-5 py-3 border-b border-gray-200">
        <h1 className="text-base font-bold text-blue-900">Company Additional Disclosure Ratio</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Ratios to be disclosed by a Company under Schedule III (Division I), Additional Regulatory Information. These are the same figures as the Financial Ratios table in <strong>Policy</strong>; write the reason for any change of more than 25% there, under "Comments on Ratios".
        </p>
        {!isCompany && (
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            This Auditee is not a Company, so these ratios are not a statutory disclosure for it. They are shown for reference only.
          </p>
        )}
      </div>
      <div className="flex-1 overflow-auto p-5">
        {!rows ? (
          <div className="text-sm text-gray-400">No financial statements to work from yet.</div>
        ) : (
          <table className="w-full text-xs border-collapse" data-testid="statutory-ratios">
            <thead>
              <tr className="bg-blue-50 border-b-2 border-blue-800 text-blue-900">
                <th className="text-left py-1.5 px-2 w-8">#</th>
                <th className="text-left py-1.5 px-2">Ratio</th>
                <th className="text-left py-1.5 px-2">Numerator</th>
                <th className="text-left py-1.5 px-2">Denominator</th>
                <th className="text-right py-1.5 px-2">Numerator value</th>
                <th className="text-right py-1.5 px-2">Denominator value</th>
                <th className="fsg-dated-heading text-right py-1.5 px-2">{cyLabel}</th>
                <th className="fsg-dated-heading text-right py-1.5 px-2">{pyLabel}</th>
                <th className="text-right py-1.5 px-2">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const big = r.variancePct !== null && Math.abs(r.variancePct) > 25
                return (
                  <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 px-2 text-gray-500">{i + 1}</td>
                    <td className="fsg-wrap py-1.5 px-2 font-medium text-gray-800">
                      {r.label}
                      {r.isEstimate && <span className="ml-1 text-[10px] text-amber-700" title="Best-effort figure: the app has no exact source for one of its inputs. Review before relying on it.">(estimate)</span>}
                    </td>
                    <td className="fsg-wrap py-1.5 px-2 text-gray-600">{r.numeratorLabel}</td>
                    <td className="fsg-wrap py-1.5 px-2 text-gray-600">{r.denominatorLabel}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-gray-700">{fmtRatioAmount(r.numeratorValue)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-gray-700">{fmtRatioAmount(r.denominatorValue)}</td>
                    <td className="py-1.5 px-2 text-right font-mono font-semibold text-gray-900">{fmtRatioCell(r.cy, r.format)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-gray-500">{fmtRatioCell(r.py, r.format)}</td>
                    <td className={`py-1.5 px-2 text-right font-mono ${big ? 'text-red-700 font-semibold' : 'text-gray-700'}`}
                      title={big ? 'Change of more than 25%: Schedule III asks for the reason. Write it in Policy > Financial Ratios.' : undefined}>
                      {fmtVariance(r.variancePct)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-[11px] text-gray-400">Ratios with an "Average" denominator have no Previous Year figure: the average for that year needs the year before it. Variance in red is more than 25%.</p>
      </div>
    </div>
  )
}
