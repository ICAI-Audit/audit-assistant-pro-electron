import React from 'react'
import { hasMissingAlie, missingAlieMessages, missingAlieItems } from '../../utils/missingAlie'

export default function MissingAlieWarning({ report, onFix, position = 'top', tbId }) {
  if (!hasMissingAlie(report)) return null
  const items = missingAlieItems(report)
  const cyIds = [...new Set((report.cy?.items || []).map(r => r.mapped_id).filter(Boolean))]
  const pyIds = [...new Set((report.py?.items || []).map(r => r.mapped_id).filter(Boolean))]
  const fmt = v => Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return <div role="alert" data-testid={`missing-alie-${position}`} className="border-2 border-red-600 bg-red-50 rounded p-3 my-3 text-xs" style={{ color: '#b91c1c', fontWeight: 700 }}>
    {missingAlieMessages(report).map((m, i) => <p key={i}>{m}</p>)}
    {position === 'top' && <>
      {!!items.length && <div className="mt-2" data-testid="missing-alie-ledgers"><p>Ledgers requiring ALIE classification (amounts in rupees):</p><div className="max-h-64 overflow-auto"><table className="w-full"><thead><tr>{['Period', 'Branch / TB', 'Ledger', 'Debit (Rs)', 'Credit (Rs)'].map(h => <th key={h} className="text-left border-b p-1">{h}</th>)}</tr></thead><tbody>{items.map((r, i) => <tr key={i}><td className="p-1">{r.warningPeriod}</td><td className="p-1">{r.branch_name || `TB ${r.tb_id}`}</td><td className="p-1">{r.ledger_name} [#{r.tb_row_id}]</td><td className="p-1">{r.amount < 0 ? fmt(r.amount) : '0.00'}</td><td className="p-1">{r.amount > 0 ? fmt(r.amount) : '0.00'}</td></tr>)}</tbody></table></div></div>}
      {tbId === '__consolidated__' && <p>Resolve these items on each branch's Trial Balance in Mapping → Rectification / Recategorisation.</p>}
      {tbId !== '__consolidated__' && onFix && (cyIds.length > 0 || pyIds.length > 0) && <button className="border border-red-600 rounded px-2 py-1 my-2" onClick={() => onFix({ mappedIds: cyIds, pyMappedIds: pyIds }, 'ALIE missing — resolution required')}>Resolve ALIE in Mapping</button>}

      {items.some(r => !r.mapped_id) && <p className="mt-2">Next step: open Mapping &rarr; Mapped TB and run Auto-Mapping. Then assign the correct ALIE to the ledgers listed above.</p>}
      {!!items.length && <p>Choose Assets, Equity and Liabilities, Income or Expenses according to the ledger.</p>}
    </>}
  </div>
}
