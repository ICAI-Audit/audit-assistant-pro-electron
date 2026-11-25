import React, { useCallback, useEffect, useState } from 'react'
import { fsgApi } from '../../api.js'

// T-087 (owner, 24 November 2026): Master > Branch Master - the branches of an Auditee with branches. Add, rename
// (its Trial Balances take the new name, so their versions stay together) and delete (only a branch no Trial
// Balance uses). The same list is the Branch dropdown on every Trial Balance upload.
export default function BranchMaster({ entity, onChanged }) {
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!entity?.id) return
    setLoading(true)
    try { setBranches(await fsgApi.listBranchMaster(entity.id) || []) }
    catch (e) { setError(e.message || 'Could not load the branches.') }
    finally { setLoading(false) }
  }, [entity?.id])
  useEffect(() => { load() }, [load])

  const run = async (fn, okText) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fn()
      if (res?.branches) setBranches(res.branches)
      setNotice(okText(res))
      onChanged?.()
      return true
    } catch (e) { setError(e.message || 'That did not work.'); return false }
    finally { setBusy(false) }
  }

  const add = async () => {
    const name = newName.replace(/\s+/g, ' ').trim()
    if (!name) { setError('Enter the branch name.'); return }
    if (await run(() => fsgApi.addBranch({ entityId: entity.id, name }), r => `Branch "${r.name}" is on the Branch Master.`)) setNewName('')
  }
  const rename = async (b) => {
    if (await run(() => fsgApi.renameBranch({ entityId: entity.id, id: b.id, name: editName }),
      r => `"${b.name}" renamed to "${r.name}"${b.tb_count ? `; its ${b.tb_count} Trial Balance${b.tb_count > 1 ? 's' : ''} now show the new name` : ''}.`)) setEditId(null)
  }
  const remove = async (b) => {
    if (!window.confirm(`Delete the branch "${b.name}" from the Branch Master?`)) return
    await run(() => fsgApi.deleteBranch({ entityId: entity.id, id: b.id }), () => `Branch "${b.name}" deleted.`)
  }

  if (!entity) return <div className="p-6 text-sm text-gray-400">Select an Auditee first.</div>

  return (
    <div className="p-6 max-w-4xl" data-testid="branch-master">
      <h2 className="text-lg font-bold text-blue-900">Branch Master</h2>
      <p className="text-xs text-gray-500 mt-1 mb-4">
        The branches of {entity.name}. Each Trial Balance upload picks its branch from this list; a second upload of the same branch and year is that branch&apos;s next version (_v2, _v3).
      </p>

      {!entity.has_branches && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
          This Auditee is not set up with branches (Master &gt; Auditee Details). The branches below are used only when it is.
        </div>
      )}
      {error && <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded text-xs text-green-700">{notice}</div>}

      <div className="flex gap-2 mb-4">
        <input type="text" value={newName} aria-label="New branch name" placeholder="New branch, e.g. Head Office"
          onChange={e => { setNewName(e.target.value); setError('') }} onKeyDown={e => { if (e.key === 'Enter') add() }}
          className="w-72 border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
        <button onClick={add} disabled={busy} className="px-4 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:bg-gray-400">＋ Add branch</button>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : !branches.length ? (
        <p className="text-sm text-gray-400">No branches yet. Add one above, or on the Branch dropdown when uploading a Trial Balance.</p>
      ) : (
        <table className="w-full text-xs border border-blue-100">
          <thead>
            <tr className="bg-blue-50 border-b border-blue-200 text-blue-900">
              <th className="py-1.5 px-3 text-left font-semibold">Branch</th>
              <th className="py-1.5 px-3 text-right font-semibold w-36">Trial Balances</th>
              <th className="py-1.5 px-3 text-right font-semibold w-56">Actions</th>
            </tr>
          </thead>
          <tbody>
            {branches.map(b => (
              <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50" data-testid="branch-row">
                <td className="py-1.5 px-3">
                  {editId === b.id ? (
                    <input type="text" autoFocus value={editName} aria-label={`New name for ${b.name}`}
                      onChange={e => { setEditName(e.target.value); setError('') }}
                      onKeyDown={e => { if (e.key === 'Enter') rename(b); if (e.key === 'Escape') setEditId(null) }}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none" />
                  ) : <span className="text-gray-800 font-medium">{b.name}</span>}
                </td>
                <td className="py-1.5 px-3 text-right text-gray-700">
                  {b.tb_count || '—'}{b.locked_count ? <span className="ml-1 text-amber-700" title="In a locked or finalised year">({b.locked_count} locked)</span> : null}
                </td>
                <td className="py-1.5 px-3 text-right space-x-2 whitespace-nowrap">
                  {editId === b.id ? (<>
                    <button onClick={() => rename(b)} disabled={busy} className="px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400">Save</button>
                    <button onClick={() => setEditId(null)} className="px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100">Cancel</button>
                  </>) : (<>
                    <button onClick={() => { setEditId(b.id); setEditName(b.name); setError(''); setNotice('') }} disabled={busy || b.locked_count > 0}
                      title={b.locked_count ? 'Has a Trial Balance in a locked or finalised year' : 'Rename this branch and its Trial Balances'}
                      className="px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40">Rename</button>
                    <button onClick={() => remove(b)} disabled={busy || b.tb_count > 0}
                      title={b.tb_count ? 'Used by Trial Balances; delete them on TB > Upload TB first' : 'Delete this branch'}
                      className="px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40">Delete</button>
                  </>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[10px] text-gray-400 mt-2">A branch used by a Trial Balance cannot be deleted; rename it instead, or delete its Trial Balances on TB &gt; Upload TB first. A branch with a Trial Balance in a locked or finalised year cannot be renamed.</p>
    </div>
  )
}
