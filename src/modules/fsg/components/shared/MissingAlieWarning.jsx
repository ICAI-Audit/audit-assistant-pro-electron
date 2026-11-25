import React from 'react'
import { hasMissingAlie, missingAlieMessages, missingAlieItems } from '../../utils/missingAlie'

// T-085 (owner, 24 November 2026): drawn in the warning style used across FSG (the red-50 box with a ⚠, as the
// Long-term Borrowings check on Notes and the Fix banners), instead of its own heavy border and all-bold text.
// The wording, the counts and the rupee totals are unchanged (the PDF and Excel print the same sentences).
const fmt = v => Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function MissingAlieWarning({ report, onFix, position = 'top', tbId }) {
  if (!hasMissingAlie(report)) return null
  const items = missingAlieItems(report)
  const cyIds = [...new Set((report.cy?.items || []).map(r => r.mapped_id).filter(Boolean))]
  const pyIds = [...new Set((report.py?.items || []).map(r => r.mapped_id).filter(Boolean))]
  const top = position === 'top'
  return (
    <div role="alert" data-testid={`missing-alie-${position}`}
      className={`my-3 px-4 py-2 bg-red-50 border border-red-300 rounded text-xs text-red-700 ${top ? '' : 'opacity-90'}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-bold">⚠</span>
        <div className="flex-1 space-y-1">
          <p className="font-bold text-red-800" data-testid="missing-alie-title">
            {report.error ? 'ALIE could not be verified' : 'ALIE not found — classification required'}
          </p>
          {missingAlieMessages(report).map((m, i) => <p key={i} className="leading-relaxed">{m}</p>)}
        </div>
        {top && tbId !== '__consolidated__' && onFix && (cyIds.length > 0 || pyIds.length > 0) && (
          <button onClick={() => onFix({ mappedIds: cyIds, pyMappedIds: pyIds }, 'ALIE missing — resolution required')}
            className="shrink-0 px-2 py-1 text-[11px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100 font-medium">
            Resolve ALIE in Mapping
          </button>
        )}
      </div>
      {top && <>
        {!!items.length && (
          <div className="mt-2 ml-5" data-testid="missing-alie-ledgers">
            <p className="font-semibold text-red-800 mb-1">Ledgers requiring ALIE classification (amounts in rupees):</p>
            <div className="max-h-64 overflow-auto border border-red-200 rounded bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-red-100 border-b border-red-200 text-red-900">
                    {['Period', 'Branch / TB', 'Ledger', 'Debit (Rs)', 'Credit (Rs)'].map(h => (
                      <th key={h} className={`py-1 px-2 font-semibold ${/\(Rs\)/.test(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={i} className="border-b border-red-50 hover:bg-red-50/60 text-gray-800">
                      <td className="py-1 px-2">{r.warningPeriod}</td>
                      <td className="py-1 px-2">{r.branch_name || `TB ${r.tb_id}`}</td>
                      <td className="py-1 px-2">{r.ledger_name} <span className="text-gray-400 text-[10px]">[#{r.tb_row_id}]</span></td>
                      <td className="py-1 px-2 text-right font-mono">{r.amount < 0 ? fmt(r.amount) : '0.00'}</td>
                      <td className="py-1 px-2 text-right font-mono">{r.amount > 0 ? fmt(r.amount) : '0.00'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="ml-5 mt-2 space-y-0.5 text-[11px]">
          {tbId === '__consolidated__' && <p>Resolve these items on each branch's Trial Balance in Mapping → Rectification / Recategorisation.</p>}
          {items.some(r => !r.mapped_id) && <p>Next step: open Mapping &rarr; Mapped TB and run Auto-Mapping. Then assign the correct ALIE to the ledgers listed above.</p>}
          {!!items.length && <p>Choose Assets, Equity and Liabilities, Income or Expenses according to the ledger.</p>}
        </div>
      </>}
    </div>
  )
}
