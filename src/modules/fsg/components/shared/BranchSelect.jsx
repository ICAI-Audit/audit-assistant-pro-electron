import React, { useEffect, useState } from 'react'
import { fsgApi } from '../../api.js'

// T-087 (owner, 24 November 2026): on every Trial Balance upload of an Auditee with branches the branch is picked
// from the Branch Master, with "+ Add new branch" for one not there yet. A second upload of branch A then stays
// branch A and becomes its next version (_v2), instead of a new branch typed as "A_v2".
const ADD = '__add__'

export const BRANCH_REQUIRED_MESSAGE = 'Choose the branch this Trial Balance belongs to, or add it with "+ Add new branch".'

export default function BranchSelect({ entityId, value, onChange }) {
  const [branches, setBranches] = useState([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    if (!entityId) return
    Promise.resolve(fsgApi?.listBranchMaster?.(entityId)).then(list => {
      if (!live) return
      setBranches(list || [])
      setLoaded(true)
      if (!(list || []).length) setAdding(true)   // first branch: straight to the name box
    }).catch(e => { if (live) { setError(e.message || 'Could not load the branches.'); setLoaded(true) } })
    return () => { live = false }
  }, [entityId])

  const add = async () => {
    const name = draft.replace(/\s+/g, ' ').trim()
    if (!name) { setError('Enter the branch name.'); return }
    const same = branches.find(b => b.name.toLowerCase() === name.toLowerCase())
    if (same) { onChange(same.name); setAdding(false); setDraft(''); setError(''); return }
    try {
      const res = await fsgApi.addBranch({ entityId, name })
      setBranches(res.branches || [])
      onChange(res.name)
      setAdding(false); setDraft(''); setError('')
    } catch (e) { setError(e.message || 'Could not add the branch.') }
  }

  return (
    <div data-testid="branch-select">
      <label className="block text-xs text-gray-600 mb-1">Branch <span className="text-red-600">*</span></label>
      {!adding ? (
        <select value={value || ''} aria-label="Branch"
          onChange={e => { if (e.target.value === ADD) { setAdding(true); setError('') } else onChange(e.target.value) }}
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none">
          <option value="">{loaded ? '— Select branch —' : 'Loading branches…'}</option>
          {branches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          <option value={ADD}>＋ Add new branch…</option>
        </select>
      ) : (
        <div className="flex gap-2">
          <input type="text" autoFocus value={draft} aria-label="New branch name" placeholder="e.g. Head Office, Delhi Branch"
            onChange={e => { setDraft(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
          <button type="button" onClick={add} className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium">Add branch</button>
          {branches.length > 0 && (
            <button type="button" onClick={() => { setAdding(false); setDraft(''); setError('') }}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100">Cancel</button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
      <p className="mt-1 text-[10px] text-gray-400">A second Trial Balance of the same branch and year is saved as that branch&apos;s next version (_v2, _v3), not as a new branch.</p>
    </div>
  )
}
