import React, { createContext, useContext, useEffect, useState } from 'react'
import { fsgApi } from '../../api.js'
import { fmtINR } from '../../hooks/useFinancials'
import { computeChange, fmtChangePct } from '../../utils/changeAnalysis'

export { computeChange, fmtChangePct }

// T-048 "Variance Analysis" on BS, PL and Notes: three extra columns after the
// Previous Year column -
//   Amount of Change      = Current Year - Previous Year
//   Percentage of Change  = Amount of Change / Previous Year x 100 (taken on
//                           the Previous Year's absolute value, so an increase
//                           always shows as a positive percentage even when the
//                           Previous Year figure is negative, e.g. a loss)
//   Reason of Change      = free text typed by the user, saved per Trial Balance
//                           in the remarks table under scope "<screen>_change"
//                           (bs_change / pl_change / notes_change), so it follows
//                           the year lock and the workings carry-over / backup.
// The columns are on screen only; the PDF and Excel outputs are unchanged.

const Ctx = createContext({ on: false })

const storageKey = (screen) => `fsg.analyseChange.${screen}`

/** On/off state of the Variance Analysis columns for one screen, remembered on this computer. */
export function useAnalyseChangeToggle(screen) {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(storageKey(screen)) === '1' } catch { return false } })
  const set = (v) => { setOn(v); try { localStorage.setItem(storageKey(screen), v ? '1' : '0') } catch { /* per-viewer convenience only */ } }
  return [on, set]
}

export function AnalyseChangeButton({ on, onToggle, disabled = false, disabledTitle }) {
  return (
    <button type="button" onClick={() => !disabled && onToggle(!on)} disabled={disabled}
      data-testid="analyse-change"
      aria-pressed={on}
      title={disabled ? disabledTitle : on ? 'Hide the Amount, Percentage and Reason of Variance columns' : 'Show the Amount, Percentage and Reason of Variance columns after the Previous Year'}
      className={`px-2 py-1 text-xs rounded border transition disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}>
      {on ? '✓ Variance Analysis' : 'Variance Analysis'}
    </button>
  )
}

/** Wraps a statement so its rows can render the change columns. `scope` is bs, pl or notes. */
export function AnalyseChangeProvider({ on, tbId, scope, getRemark, onRemarkSaved, children }) {
  const value = { on: !!on, tbId, scope: `${scope}_change`, getRemark, onRemarkSaved }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAnalyseChange = () => useContext(Ctx)
/** Number of extra columns (3 when on, else 0) - add to a full-width row's colSpan. */
export const useChangeSpan = () => (useContext(Ctx).on ? 3 : 0)

export function ChangeCols() {
  const { on } = useContext(Ctx)
  if (!on) return null
  return (<><col style={{ width: '13%' }} /><col style={{ width: '8%' }} /><col style={{ width: '14%' }} /></>)
}

// `widths` (e.g. ['12%', '7%', '18%']) sizes the columns of a table that has no <colgroup> (PL, Notes).
export function ChangeHeads({ className = 'py-1.5 font-semibold text-blue-900 text-xs', widths }) {
  const { on } = useContext(Ctx)
  if (!on) return null
  const w = (i) => (widths ? { width: widths[i] } : undefined)
  return (
    <>
      <th style={w(0)} className={`${className} text-right pr-2 fsg-change-col`}>Amount of Variance</th>
      <th style={w(1)} className={`${className} text-right pr-2 fsg-change-col`}>% of Variance</th>
      <th style={w(2)} className={`${className} text-left pl-2 fsg-change-col`}>Reason of Variance</th>
    </>
  )
}

/**
 * The three change cells for one row. `rowKey` names the row for its saved
 * reason (defaults to nothing: no reason box). `blank` renders empty cells
 * (heading rows, EPS, input rows).
 */
export function ChangeCells({ cy, py, rowKey, blank = false, dark = false, bold = false }) {
  const { on, tbId, scope, getRemark, onRemarkSaved } = useContext(Ctx)
  if (!on) return null
  const change = blank ? null : computeChange(cy, py)
  const tone = dark ? 'text-white' : change && change.amount < -0.004 ? 'text-red-700' : 'text-gray-800'
  const weight = dark || bold ? 'font-bold' : ''
  return (
    <>
      <td className={`py-1 text-right font-mono text-xs pr-2 fsg-change-col ${tone} ${weight}`}>{change ? fmtINR(change.amount) : ''}</td>
      <td className={`py-1 text-right font-mono text-xs pr-2 fsg-change-col ${tone} ${weight}`}>{fmtChangePct(change)}</td>
      <td className="py-0.5 pl-2 pr-1 fsg-change-col">
        {!blank && rowKey && tbId ? (
          <ReasonInput tbId={tbId} scope={scope} scopeKey={rowKey} dark={dark}
            initial={getRemark?.(scope, rowKey) || ''} onSaved={onRemarkSaved} />
        ) : null}
      </td>
    </>
  )
}

function ReasonInput({ tbId, scope, scopeKey, initial, onSaved, dark }) {
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setText(initial) }, [initial])
  const commit = async () => {
    const next = text.trim()
    if (next === (initial || '').trim()) return
    setSaving(true)
    try {
      await fsgApi?.saveRemark({ tbId, scope, scope_key: scopeKey, remark: next })
      onSaved?.(scope, scopeKey, next)
    } catch (e) {
      window.alert('Could not save the reason: ' + (e?.message || e))
      setText(initial)
    } finally { setSaving(false) }
  }
  return (
    <input type="text" value={text} disabled={saving}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(initial); } }}
      placeholder="Reason..."
      title={text || 'Type the reason for the variance; it is saved when you leave the box'}
      aria-label={`Reason of variance: ${scopeKey}`}
      className={`w-full text-xs px-1.5 py-0.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-400 ${dark ? 'bg-blue-700 text-white placeholder:text-blue-200 border-blue-500' : 'bg-yellow-50 text-gray-800 border-gray-200 placeholder:text-gray-300'}`} />
  )
}
