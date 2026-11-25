// T-072: after a new version of a year's Trial Balance (_v2, _v3) is uploaded,
// two questions, answered before the new version is mapped:
//   1. Copy the details entered by hand on an earlier version (Stock, Dep
//      (Books), Dep (Income Tax), Fill Details of the Notes, remarks, manual
//      Previous Year figures, extra lines, EPS)? Copied by workings:carryOver.
//   2. Carry the Learned Ledger Rules (and the categorisation changed by hand)
//      forward? Yes: mapping reuses them, as before. No: the new version is
//      mapped on the default rules only, and stays so on every re-run.
import React, { useEffect, useState } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import { tbDisplayName } from '../../utils/tbVersions'

function YesNo({ name, value, onChange }) {
  return (
    <div className="flex gap-4 mt-1">
      {[['yes', 'Yes'], ['no', 'No']].map(([v, label]) => (
        <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name={name} value={v} checked={value === (v === 'yes')} onChange={() => onChange(v === 'yes')} data-answer={`${name}-${v}`} />
          {label}
        </label>
      ))}
    </div>
  )
}

export default function VersionCarryModal({ newTb, priorVersions, loadAreas, onConfirm }) {
  const [fromId, setFromId] = useState(priorVersions[0]?.id)
  const [areas, setAreas] = useState(null)
  const [copyDetails, setCopyDetails] = useState(true)
  const [chosen, setChosen] = useState(new Set())
  const [carryRules, setCarryRules] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setAreas(null)
    loadAreas(fromId).then(list => {
      if (!live) return
      const available = (list || []).filter(a => a.count > 0)
      setAreas(available)
      setChosen(new Set(available.filter(a => a.defaultOn).map(a => a.key)))
    }).catch(() => live && setAreas([]))
    return () => { live = false }
  }, [fromId])

  const from = priorVersions.find(t => t.id === fromId) || priorVersions[0]
  const hasDetails = (areas || []).length > 0
  const toggle = (k) => setChosen(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const confirm = async () => {
    if (busy || areas === null) return
    setBusy(true); setError('')
    try {
      await onConfirm({ fromTbId: from.id, include: copyDetails && hasDetails ? [...chosen] : [], carryRules })
    } catch (e) { setError(String(e?.message || e)); setBusy(false) }
  }
  const containerRef = useModalKeys({ onClose: () => {}, onConfirm: confirm })

  return (
    <div className="modal-backdrop">
      <div className="modal-box max-w-lg fsg-version-carry" ref={containerRef} role="dialog" aria-modal="true" aria-label="Bring your work to the new version" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold text-blue-900 mb-1">New version uploaded: {tbDisplayName(newTb)}</h2>
        <p className="text-xs text-gray-600 mb-3">
          Bring your work from an earlier version of this year, so nothing has to be downloaded and uploaded again.
          The earlier version is kept as it is.
        </p>

        {priorVersions.length > 1 && (
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Copy from</label>
            <select value={fromId} onChange={e => setFromId(Number(e.target.value))} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {priorVersions.map(t => <option key={t.id} value={t.id}>{tbDisplayName(t)}</option>)}
            </select>
          </div>
        )}

        <div className="border border-gray-200 rounded p-3 mb-3">
          <div className="text-sm font-semibold text-gray-800">1. Copy the details entered manually from {tbDisplayName(from)}?</div>
          {areas === null && <div className="text-xs text-gray-400 mt-1">Reading {tbDisplayName(from)}…</div>}
          {areas !== null && !hasDetails && <div className="text-xs text-gray-500 mt-1">{tbDisplayName(from)} has no manually entered details to copy.</div>}
          {hasDetails && (
            <>
              <YesNo name="copy-details" value={copyDetails} onChange={setCopyDetails} />
              {copyDetails && (
                <div className="mt-2 border border-gray-100 rounded divide-y divide-gray-100 max-h-[32vh] overflow-y-auto">
                  {areas.map(a => (
                    <label key={a.key} className="flex items-center gap-3 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={chosen.has(a.key)} onChange={() => toggle(a.key)} data-area={a.key} />
                      <span className="flex-1 text-gray-800">{a.label}</span>
                      <span className="text-xs text-gray-500">{a.count} item{a.count !== 1 ? 's' : ''}</span>
                    </label>
                  ))}
                </div>
              )}
              {copyDetails && areas.some(a => !a.defaultOn) && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Adjustments and journal entries are not ticked: if they have since been posted in the books, the new version already contains them.
                </p>
              )}
            </>
          )}
        </div>

        <div className="border border-gray-200 rounded p-3">
          <div className="text-sm font-semibold text-gray-800">2. Carry the Learned Ledger Rules forward to {tbDisplayName(newTb)}?</div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Yes: ledgers you categorised by hand (on an earlier version or any year) are mapped the same way again.
            No: this version is mapped on the default rules only.
          </p>
          <YesNo name="carry-rules" value={carryRules} onChange={setCarryRules} />
        </div>

        {error && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
        <div className="flex mt-4">
          <button onClick={confirm} disabled={busy || areas === null}
            className="fsg-version-carry-confirm flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
            {busy ? 'Working…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
