import React, { useState, useEffect } from 'react'
import UnlockConfirmModal from './UnlockConfirmModal'
import { fsgApi } from '../../api.js'

/**
 * Shows a "this Financial Period is locked" banner with an Unlock action,
 * when the active TB's entity_period is locked. Renders nothing otherwise.
 * Used in the Categorisation and Mapped TB toolbars and, since T-035, above
 * every screen that holds the year's data (App.jsx LOCK_BANNER_TABS). The
 * main process refuses every change to a locked or final year; this banner
 * only explains it in advance.
 */
export default function LockBanner({ entity, activeTB, onUnlocked, refreshKey }) {
  const [period, setPeriod] = useState(null)
  const [showUnlock, setShowUnlock] = useState(false)
  const [unlockError, setUnlockError] = useState('')

  useEffect(() => {
    if (!entity?.id || !activeTB?.entity_period_id) { setPeriod(null); return }
    fsgApi?.listEntityPeriods(entity.id)
      .then(list => setPeriod((list || []).find(p => p.id === activeTB.entity_period_id) || null))
      .catch(() => setPeriod(null))
  }, [entity?.id, activeTB?.entity_period_id, activeTB?.id, refreshKey])

  if (!period?.locked && !period?.is_final) return null

  const doUnlock = async () => {
    try {
      await fsgApi?.unlockEntityPeriod(period.id)
    } catch (err) {
      setShowUnlock(false)
      setUnlockError(err?.message || 'The year could not be unlocked.')
      return
    }
    setUnlockError('')
    setPeriod(p => ({ ...p, locked: 0, is_final: 0 }))
    setShowUnlock(false)
    onUnlocked?.()
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border-b border-red-200 text-xs shrink-0">
        <span className="text-red-700 font-semibold">
          🔒 {period.is_final ? 'Final' : 'Locked'} — {period.year_label} ({period.date_from} To {period.date_till}) is {period.is_final ? 'final and locked' : 'locked'}. No changes are allowed to this year's trial balance, mapping, stock, depreciation, notes, cash flow or other statement data.
          {unlockError && <span className="block font-normal">{unlockError}</span>}
        </span>
        <button onClick={() => setShowUnlock(true)} className="ml-auto px-2.5 py-1 text-xs border border-red-400 text-red-700 rounded hover:bg-red-100 font-medium">
          Unlock
        </button>
      </div>
      {showUnlock && (
        <UnlockConfirmModal
          periodLabel={`${period.year_label} (${period.date_from} To ${period.date_till})`}
          onConfirm={doUnlock}
          onClose={() => setShowUnlock(false)}
        />
      )}
    </>
  )
}
