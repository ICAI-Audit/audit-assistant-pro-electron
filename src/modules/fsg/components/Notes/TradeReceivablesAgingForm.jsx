/**
 * Trade Receivables Ageing Schedule Form (Schedule III)
 * Outstanding for following periods from due date of payment
 */
import React, { useState, useEffect } from 'react'
import { fsgApi } from '../../api.js'

// T-069: Trade Receivables ageing in the owner's layout. Columns Unbilled and Not
// Due, then the five periods from the due date, then Total. Rows (i) to (iv) take
// Not Due and the periods (Unbilled is grey: unbilled dues have their own rows);
// the two Unbilled Dues rows take Unbilled only; the provision row is open.
// Total Due and Total Trade Receivable are worked out, never typed.
export const TR_AGED_BUCKETS = [
  { key: 'less6m', label: 'Less than 6 months' },
  { key: '6m1y',   label: '6 months - 1 year' },
  { key: '1y2y',   label: '1-2 yrs.' },
  { key: '2y3y',   label: '2-3 yrs.' },
  { key: 'more3y', label: 'More than 3 yrs.' },
]
// Every amount column, in the order shown. `notAged` columns sit outside the
// "Outstanding for following periods from due date of payment" heading.
export const TR_AGEING_BUCKETS = [
  { key: 'unbilled', label: 'Unbilled', notAged: true },
  { key: 'notdue',   label: 'Not Due', notAged: true },
  ...TR_AGED_BUCKETS,
]

// Input rows + computed rows. Computed rows derive per-bucket values dynamically.
export const TR_AGEING_ROWS = [
  { key: 'undis_good',         label: '(i) Undisputed Trade receivables - considered good', kind: 'due' },
  { key: 'undis_doubtful',     label: '(ii) Undisputed Trade Receivables - considered doubtful', kind: 'due' },
  { key: 'dis_good',           label: '(iii) Disputed Trade Receivables considered good', kind: 'due' },
  { key: 'dis_doubtful',       label: '(iv) Disputed Trade Receivables considered doubtful', kind: 'due' },
  { key: 'total_due',          label: 'Total Due', computed: 'due', isTotal: true },
  { key: 'unbilled_good',      label: 'Unbilled Dues - considered good', kind: 'unbilled' },
  { key: 'unbilled_doubtful',  label: 'Unbilled Dues - considered doubtful', kind: 'unbilled' },
  { key: 'provision_doubtful', label: 'Less: Provision for doubtful debts', kind: 'provision', deduct: true },
  { key: 'total_tr',           label: 'Total Trade Receivable', computed: 'grand', isTotal: true },
]

// Rows summed into "Total Due" and into the grand total
export const TR_DUE_ROWS = ['undis_good', 'undis_doubtful', 'dis_good', 'dis_doubtful']
export const TR_ADD_ROWS = ['unbilled_good', 'unbilled_doubtful']   // added after Total Due
export const TR_DEDUCT_ROWS = ['provision_doubtful']                 // deducted from grand total

const num = (v) => parseFloat(v) || 0
const fmt = (n) => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `(${abs})` : abs
}

const trRowOf = (row) => (typeof row === 'string' ? TR_AGEING_ROWS.find(r => r.key === row) : row)

/** True when a cell of the ageing table takes no entry (grey in the form and the Fill Details Excel). */
export function trCellBlocked(row, colKey) {
  const r = trRowOf(row)
  if (!r || r.isTotal) return false
  if (!TR_AGEING_BUCKETS.some(b => b.key === colKey)) return true
  if (r.kind === 'due') return colKey === 'unbilled'
  if (r.kind === 'unbilled') return colKey !== 'unbilled'
  return false
}

/**
 * One period of saved ageing data as it is shown and printed: blocked cells
 * empty. Data saved before T-069 had no Unbilled / Not Due columns and kept the
 * Unbilled Dues rows in the period columns; such a row is moved into Unbilled.
 * Total Due / Total Trade Receivable stay computed (trComputedCell).
 */
export function trPeriodView(pd) {
  if (!pd) return pd
  const out = {}
  for (const r of TR_AGEING_ROWS) {
    if (r.computed) continue
    const src = pd[r.key] || {}
    const cell = {}
    for (const b of TR_AGEING_BUCKETS) cell[b.key] = trCellBlocked(r, b.key) ? '' : (src[b.key] ?? '')
    if (r.kind === 'unbilled' && !num(src.unbilled)) {
      const legacy = Math.round(TR_AGED_BUCKETS.reduce((s, b) => s + num(src[b.key]), 0) * 100) / 100
      if (legacy) cell.unbilled = legacy
    }
    out[r.key] = cell
  }
  return out
}

/** Per-bucket value of a computed row, derived from the input rows. */
export function trComputedCell(periodData, computedType, bucketKey) {
  const cell = (rk) => num(periodData?.[rk]?.[bucketKey])
  const due = TR_DUE_ROWS.reduce((s, rk) => s + cell(rk), 0)
  if (computedType === 'due') return due
  return due + TR_ADD_ROWS.reduce((s, rk) => s + cell(rk), 0)
           - TR_DEDUCT_ROWS.reduce((s, rk) => s + cell(rk), 0)
}

/** Total Trade Receivable of one period (every column), as the form's Check and Check Control compare it. */
export function trScheduleTotal(pd) {
  const v = trPeriodView(pd || {})
  return TR_AGEING_BUCKETS.reduce((s, b) => s + trComputedCell(v, 'grand', b.key), 0)
}

function emptyPeriod() {
  const p = {}
  for (const r of TR_AGEING_ROWS) {
    if (!r.computed) p[r.key] = Object.fromEntries(TR_AGEING_BUCKETS.map(b => [b.key, '']))
  }
  return p
}

export default function TradeReceivablesAgingForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal = 0, notePrevTotal = 0, periodLabels, onClose, onSaved }) {
  // A branch entity keeps this schedule once for the whole entity (like the
  // other statutory forms), so it has no Trial Balance id to save against.
  const scopeId = useEntityLevel ? entityId : tbId
  const [data, setData] = useState({
    cy: emptyPeriod(),
    py: emptyPeriod(),
    includeInOutput: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!scopeId || !noteNum) return
    setLoading(true)
    Promise.resolve(useEntityLevel
      ? fsgApi?.getEntityNoteDetails?.(entityId, noteNum, noteTitle)
      : fsgApi?.notesGetTradeReceivablesAging?.(tbId, noteNum, noteTitle))
      .then(d => {
        if (!d || !d.cy) return
        setData(prev => ({
          ...prev,
          ...d,
          cy: { ...emptyPeriod(), ...trPeriodView(d.cy) },
          py: { ...emptyPeriod(), ...trPeriodView(d.py || {}) },
        }))
      })
      .catch(err => console.error('Load Trade Receivables ageing failed:', err))
      .finally(() => setLoading(false))
  }, [scopeId, useEntityLevel, noteNum, noteTitle])

  const setCell = (period, rowKey, bucketKey, val) => {
    setSaved(false)
    setData(prev => ({
      ...prev,
      [period]: {
        ...prev[period],
        [rowKey]: { ...prev[period]?.[rowKey], [bucketKey]: val }
      }
    }))
  }

  // Value of one bucket cell for a row (blocked cells are nil; computed rows derive)
  const view = { cy: trPeriodView(data.cy), py: trPeriodView(data.py) }
  const cellValue = (period, row, bucketKey) =>
    row.computed ? trComputedCell(view[period], row.computed, bucketKey) : num(view[period]?.[row.key]?.[bucketKey])

  const rowTotal = (period, row) =>
    TR_AGEING_BUCKETS.reduce((s, b) => s + cellValue(period, row, b.key), 0)

  const grandTotal = (period) =>
    rowTotal(period, TR_AGEING_ROWS.find(r => r.key === 'total_tr'))

  const handleSave = async () => {
    if (!scopeId || !noteNum || !noteTitle) {
      setError('Missing note or TB information')
      return
    }
    try {
      setLoading(true)
      setError('')
      const toSave = { ...data, cy: trPeriodView(data.cy), py: trPeriodView(data.py) }
      if (useEntityLevel) await fsgApi?.saveEntityNoteDetails?.({ entityId, noteNum, noteTitle, data: toSave })
      else await fsgApi?.notesSaveTradeReceivablesAging?.(tbId, noteNum, noteTitle, toSave)
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const renderTable = (period, heading) => (
    <div className="mb-4">
      <p className="text-sm font-bold text-blue-900 mb-2">
        Trade Receivables ageing schedule ({heading}) <span className="font-semibold">— Outstanding for following periods from due date of payment</span>
      </p>
      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="w-full text-xs border-collapse" data-tr-ageing={period}>
          <thead>
            <tr className="bg-blue-50">
              <th className="border border-gray-300 px-2 py-1 text-left font-semibold w-[26%]">Particulars</th>
              {TR_AGEING_BUCKETS.map(b => <th key={b.key} className="border border-gray-300 px-2 py-1 text-right font-semibold whitespace-nowrap">{b.label}</th>)}
              <th className="border border-gray-300 px-2 py-1 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {TR_AGEING_ROWS.map(row => (
              <tr key={row.key} className={row.isTotal ? 'bg-blue-50 font-semibold border-t-2 border-b-2 border-gray-500' : 'hover:bg-gray-50'}>
                <td className="border border-gray-200 px-2 py-1">{row.label}</td>
                {TR_AGEING_BUCKETS.map(b => {
                  if (row.computed) {
                    return <td key={b.key} className="border border-gray-200 px-2 py-1 text-right font-mono" title="Worked out from the rows above">{fmt(cellValue(period, row, b.key))}</td>
                  }
                  if (trCellBlocked(row, b.key)) {
                    return <td key={b.key} className="border border-gray-300 bg-gray-300" data-blocked="1" aria-label={`${row.label}, ${b.label}: not applicable`} />
                  }
                  return (
                    <td key={b.key} className="border border-gray-200 px-1 py-0.5">
                      <input
                        type="number"
                        className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        aria-label={`${row.label}, ${b.label}`}
                        value={data[period]?.[row.key]?.[b.key] || ''}
                        onChange={e => setCell(period, row.key, b.key, e.target.value)}
                        placeholder="0"
                        step="0.01"
                      />
                    </td>
                  )
                })}
                <td className="border border-gray-200 px-2 py-1 text-right font-mono font-semibold">{fmt(rowTotal(period, row))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">Grey cells take no entry. Total Due and Total Trade Receivable are worked out from the rows above. Provision for doubtful debts is deducted from the Total (enter as a positive amount).</p>
    </div>
  )

  const renderCheck = (period, tbNoteTotal) => {
    const sched = grandTotal(period)
    const tb = num(tbNoteTotal)
    const diff = tb - sched
    return (
      <div className="mb-8">
        <p className="text-xs font-bold text-gray-800 mb-2 underline">Check</p>
        <table className="w-auto min-w-[45%] text-xs border-collapse">
          <tbody>
            <tr>
              <td className="border border-gray-300 px-2 py-1 w-[55%]">As per Above Schedule</td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmt(sched)}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">As per Trial Balance</td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono bg-gray-50" title="Auto-pulled from the Trial Balance note total">{fmt(tb)}</td>
            </tr>
            <tr className="bg-gray-50 font-semibold">
              <td className="border border-gray-300 px-2 py-1">Difference</td>
              <td className={`border border-gray-300 px-2 py-1 text-right font-mono ${Math.abs(diff) < 0.005 ? 'text-green-600' : 'text-red-600'}`}>{fmt(diff)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] text-gray-400 mt-1">Trial Balance figure is auto-pulled from the note total.</p>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-blue-600 text-white px-6 py-3">
          <h2 className="text-base font-bold">Note {noteNum}: {noteTitle}</h2>
          <p className="text-xs text-blue-100 mt-0.5">Trade Receivables ageing schedule — Outstanding for following periods from due date of payment</p>
        </div>

        <div className="p-6">
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>}
          {saved && <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded text-xs text-green-700">Saved successfully.</div>}

          {loading ? (
            <p className="text-center text-gray-400 py-8">Loading...</p>
          ) : (
            <>
              {renderTable('cy', periodLabels?.cy || 'Current Year')}
              {renderCheck('cy', noteTotal)}

              {renderTable('py', periodLabels?.py || 'Previous Year')}
              {renderCheck('py', notePrevTotal)}

              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={data.includeInOutput || false}
                    onChange={e => { setSaved(false); setData(prev => ({ ...prev, includeInOutput: e.target.checked })) }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs font-medium text-gray-700">Always include in PDF & Excel (even if all zeros)</span>
                </label>
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium">Close</button>
          <button onClick={handleSave} disabled={loading} className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:bg-gray-400">
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
