import React, { useState } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

/**
 * T-044: choose which workings to bring into a Trial Balance - when a new Trial
 * Balance replaces the old one of the same year (carry-over), or when a
 * "Download all workings" file is uploaded back. Only areas that hold
 * something are listed; adjustments and journal entries start unticked.
 */
export default function WorkingsModal({ title, intro, warning = '', areas, confirmLabel, onConfirm, onClose }) {
  const available = (areas || []).filter(a => a.count > 0)
  const [chosen, setChosen] = useState(() => new Set(available.filter(a => a.defaultOn).map(a => a.key)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (key) => setChosen(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const confirm = async () => {
    if (busy || !chosen.size) return
    setBusy(true); setError('')
    try { await onConfirm([...chosen]) } catch (e) { setError(String(e?.message || e)); setBusy(false) }
  }
  const containerRef = useModalKeys({ onClose: busy ? () => {} : onClose, onConfirm: confirm })

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal-box max-w-lg fsg-workings-modal" ref={containerRef} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">{title}</h2>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-600 text-xl" aria-label="Close">&times;</button>
        </div>
        {intro && <p className="text-xs text-gray-600 mb-3">{intro}</p>}
        {warning && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">{warning}</p>}
        <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
          {available.map(a => (
            <label key={a.key} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={chosen.has(a.key)} onChange={() => toggle(a.key)} className="rounded border-gray-300" data-area={a.key} />
              <span className="flex-1 text-gray-800">{a.label}</span>
              <span className="text-xs text-gray-500">{a.count} item{a.count !== 1 ? 's' : ''}</span>
            </label>
          ))}
        </div>
        {available.some(a => !a.defaultOn) && (
          <p className="text-[11px] text-gray-500 mt-2">
            Adjustments and journal entries are not ticked: if they have since been posted in the books, the new Trial Balance already contains them and ticking would count them twice.
          </p>
        )}
        {error && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Skip</button>
          <button onClick={confirm} disabled={busy || !chosen.size}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Plain-language result of a carry-over or upload, for an alert. */
export function workingsResultText({ carried = [], skipped = [] } = {}) {
  const lines = carried.length ? ['Brought over:', ...carried.map(c => `  • ${c.label} (${c.count})`)] : ['Nothing was brought over.']
  for (const s of skipped) {
    lines.push('', `${s.label}: ${s.reason}`)
    if (s.items?.length) lines.push(`  ${s.items.join(', ')}${s.more ? ` and ${s.more} more` : ''}`)
  }
  return lines.join('\n')
}
