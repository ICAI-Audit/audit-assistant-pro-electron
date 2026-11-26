/**
 * T-086 Fill Details for Long-term / Short-term loans and advances (Company):
 * loans and advances due from directors, officers and entities in which directors
 * are interested. Layout, saved shape and checks: utils/directorLoans.js.
 */
import React, { useState, useEffect } from 'react'
import { DIRECTOR_LOANS_TITLE, DIRECTOR_LOANS_ROWS, directorLoansResolve, directorLoansIssues } from '../../utils/directorLoans'
import { fsgApi } from '../../api.js'

const dash = (n) => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `(${abs})` : abs
}

/** Read-only copy shown beneath the note (nil lines as "—"). */
export function DirectorLoansDisplayTable({ saved, periodLabels = { cy: 'Current Year', py: 'Previous Year' }, fmtAmount = dash }) {
  const v = directorLoansResolve(saved)
  const amt = (x) => (x ? fmtAmount(x) : '—')
  return (
    <div data-testid="director-loans-table">
      <h3 className="text-sm font-bold text-indigo-900 mb-2">{DIRECTOR_LOANS_TITLE}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-indigo-50">
              <th className="border border-indigo-200 px-2 py-1 text-left font-semibold text-indigo-900">Particulars</th>
              <th className="fsg-dated-heading border border-indigo-200 px-2 py-1 text-right font-semibold text-indigo-900 w-[18%]">{periodLabels.cy}</th>
              <th className="fsg-dated-heading border border-indigo-200 px-2 py-1 text-right font-semibold text-indigo-900 w-[18%]">{periodLabels.py}</th>
            </tr>
          </thead>
          <tbody>
            {DIRECTOR_LOANS_ROWS.map(r => (
              <tr key={r.key} className="bg-indigo-50/30">
                <td className="border border-indigo-200 px-2 py-1 text-left text-gray-700">{r.label}</td>
                <td className="border border-indigo-200 px-2 py-1 text-right font-mono text-gray-800">{amt(v.cy[r.key])}</td>
                <td className="border border-indigo-200 px-2 py-1 text-right font-mono text-gray-800">{amt(v.py[r.key])}</td>
              </tr>
            ))}
            <tr className="bg-indigo-50 font-semibold">
              <td className="border border-indigo-200 px-2 py-1 text-left text-gray-800">Total</td>
              <td className="border border-indigo-200 px-2 py-1 text-right font-mono text-gray-800">{amt(v.totals.cy)}</td>
              <td className="border border-indigo-200 px-2 py-1 text-right font-mono text-gray-800">{amt(v.totals.py)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DirectorLoansForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal = 0, notePrevTotal = 0, periodLabels = { cy: 'Current Year', py: 'Previous Year' }, onClose, onSaved }) {
  // A branch entity keeps Fill Details once for the whole entity (like the other forms).
  const scopeId = useEntityLevel ? entityId : tbId
  const [existing, setExisting] = useState({})   // the note's whole saved JSON, so saving never drops other keys
  const [cells, setCells] = useState({ cy: {}, py: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!scopeId || !noteNum) return
    setLoading(true)
    Promise.resolve(useEntityLevel
      ? fsgApi?.getEntityNoteDetails?.(entityId, noteNum, noteTitle)
      : fsgApi?.getNoteDetails?.(tbId, noteNum, noteTitle))
      .then(d => {
        const obj = d && typeof d === 'object' ? d : {}
        setExisting(obj)
        const v = directorLoansResolve(obj.directorLoans)
        setCells({ cy: { ...v.cy }, py: { ...v.py } })
      })
      .catch(err => setError(`Could not load the saved details: ${err.message || err}`))
      .finally(() => setLoading(false))
  }, [scopeId, useEntityLevel, noteNum, noteTitle])

  const setCell = (p, key, val) => { setSaved(false); setCells(prev => ({ ...prev, [p]: { ...prev[p], [key]: val } })) }
  const v = directorLoansResolve(cells)
  const issues = directorLoansIssues(cells)

  const handleSave = async () => {
    if (!scopeId || !noteNum || !noteTitle) { setError('Missing note or Trial Balance information'); return }
    const clean = directorLoansResolve(cells)
    const data = { ...existing, directorLoans: { cy: clean.cy, py: clean.py } }
    try {
      setLoading(true); setError('')
      if (useEntityLevel) await fsgApi?.saveEntityNoteDetails?.({ entityId, noteNum, noteTitle, data })
      else await fsgApi?.saveNoteDetails?.({ tbId, noteNum, noteTitle, data })
      setExisting(data)
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const input = (p, key) => (
    <input type="number" step="0.01" min="0" placeholder="0" aria-label={`${key} ${p}`}
      className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
      value={cells[p]?.[key] === 0 || cells[p]?.[key] === '' || cells[p]?.[key] == null ? '' : cells[p][key]}
      onChange={e => setCell(p, key, e.target.value)} />
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-label="Loans and advances Fill Details">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[92%] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-blue-600 text-white px-6 py-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">Note {noteNum}: {noteTitle}</h2>
            <p className="text-xs text-blue-100 mt-0.5">{DIRECTOR_LOANS_TITLE} · Amounts in rupees</p>
          </div>
          <button onClick={onClose} aria-label="Close loans and advances" className="text-blue-100 hover:text-white text-sm">✕</button>
        </div>

        <div className="p-6">
          {error && <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>}
          {saved && <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded text-xs text-green-700">Saved successfully.</div>}
          {!!issues.length && (
            <div className="mb-4 px-4 py-2 bg-red-50 border border-red-300 rounded text-xs text-red-700 flex items-start gap-2" data-testid="director-loans-issues">
              <span className="shrink-0 font-bold">⚠</span>
              <span>{issues.map((s, i) => <span key={i} className="block">{s}</span>)}</span>
            </div>
          )}

          {loading ? (
            <p className="text-center text-gray-400 py-8">Loading...</p>
          ) : (
            <>
              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold">Particulars</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold w-[22%]">{periodLabels.cy}</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold w-[22%]">{periodLabels.py}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIRECTOR_LOANS_ROWS.map(r => (
                      <tr key={r.key}>
                        <td className="border border-gray-300 px-2 py-1 text-left">{r.label}</td>
                        <td className="border border-gray-300 px-1 py-0.5">{input('cy', r.key)}</td>
                        <td className="border border-gray-300 px-1 py-0.5">{input('py', r.key)}</td>
                      </tr>
                    ))}
                    <tr className="bg-blue-50 font-semibold">
                      <td className="border border-gray-300 px-2 py-1.5 text-left">Total</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-right font-mono">{dash(v.totals.cy)}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-right font-mono">{dash(v.totals.py)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Leave a line blank if nil; it prints as “—”. This table is not checked against the Trial Balance.</p>
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:bg-gray-400">
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
