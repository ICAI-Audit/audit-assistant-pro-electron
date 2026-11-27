import React, { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, Briefcase, Lock, LockOpen, PenLine, Pencil, Plus, Settings } from 'lucide-react'
import AuditeeFormModal from './AuditeeFormModal'
import AuditeeReadModal from './AuditeeReadModal'
import AuditorManageModal from './AuditorManageModal'
import SignatoryManageModal from './SignatoryManageModal'
import UnlockConfirmModal from '../shared/UnlockConfirmModal'
import BranchMaster from '../BranchMaster'
import { fsgApi } from '../../api.js'

// T-088 (UI only): the Master page is one overview of the engagement's masters, as cards — Auditee (with its Financial
// Periods and their locks), Auditors, Signing authorities, Mapping rules and Branch Master. Every action is the one the
// page offered before (the same modals, the same lock/unlock calls and unlock confirmation as Auditee Details > Read);
// the former hover flyouts are now visible buttons. The Branch Master leaf still opens the full Branch Master screen.

// Master menu-bar dropdown leaf name → the modal it should open immediately (see App.jsx's TAB_GROUPS['Master']).
// 'Auditee Details' opens no modal — the page itself IS the Auditee Details view.
const LEAF_MODAL_TYPE = {
  'Auditor': 'auditor-manage',
  'Signatory': 'signatory-manage',
}

// '2025-04-01' → '01 Apr 2025' for display only; anything else is shown as stored.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const showDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m && MONTHS[+m[2] - 1] ? `${m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (iso || '')
}

const btnSecondary = 'fsr-secondary inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition disabled:opacity-40'

function Card({ title, action, className = '', bodyClassName = '', children, testId }) {
  return (
    <section className={`fsr-card flex flex-col min-w-0 bg-white border border-slate-200 rounded-xl ${className}`} aria-label={title} data-testid={testId}>
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
        <h2 className="fsr-card-title text-slate-900">{title}</h2>
        {action}
      </header>
      <div className={`flex-1 min-h-0 px-5 py-4 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="flex h-full min-h-[6rem] flex-col items-center justify-center text-center px-4">
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  )
}

function PersonList({ people, describe, onManage, manageLabel }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-slate-100">
        {people.map(p => (
          <li key={p.id} className="py-2 first:pt-0">
            <div className="text-sm font-medium text-slate-800 truncate">{p.name}{p.designation ? `, ${p.designation}` : ''}</div>
            <div className="text-xs text-slate-500 truncate">{describe(p)}</div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onManage} className={`${btnSecondary} self-start`}>{manageLabel}</button>
    </div>
  )
}

// ICAI VERA: the Auditee is the client of the selected engagement and its financial years come from that client's
// engagements, so Auditee Select / Create / Delete and the Financial Period master are not offered here (T-019).
export default function Master({ entity, onEntityChange, onOpenMappingRules, activeLeaf, onPeriodLockChange, onBranchesChanged }) {
  const [modal, setModal] = useState(null) // { type: 'edit'|'read'|'auditor-*'|'signatory-*' }
  const [periods, setPeriods] = useState([])
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const [unlockTarget, setUnlockTarget] = useState(null)
  const [auditors, setAuditors] = useState(null)
  const [signatories, setSignatories] = useState(null)
  const [lockError, setLockError] = useState('')

  // Opens the matching modal when navigated here via a specific Master dropdown item (Auditor / Signatory) —
  // re-fires whenever the leaf changes, even though Master itself doesn't remount.
  useEffect(() => {
    const type = LEAF_MODAL_TYPE[activeLeaf]
    if (type) setModal({ type })
  }, [activeLeaf])

  const loadPeople = useCallback(() => {
    if (!entity?.id) return
    fsgApi?.listAuditors(entity.id).then(list => setAuditors(list || [])).catch(() => setAuditors([]))
    fsgApi?.listSignatories(entity.id).then(list => setSignatories(list || [])).catch(() => setSignatories([]))
  }, [entity?.id])

  const loadPeriods = useCallback(() => {
    if (!entity?.id) return
    fsgApi?.listEntityPeriods(entity.id)
      .then(list => setPeriods(list || []))
      .catch(() => {})
      .finally(() => setPeriodsLoading(false))
  }, [entity?.id])

  useEffect(() => {
    setPeriodsLoading(true)
    loadPeriods()
    loadPeople()
  }, [loadPeriods, loadPeople])

  // The cards are re-read whenever a dialog closes, so adds, edits, deletes and locks made there show at once.
  const close = () => { setModal(null); loadPeople(); loadPeriods() }

  const setLocked = (ep, locked) => {
    setPeriods(prev => prev.map(p => p.id === ep.id ? { ...p, locked } : p))
    onPeriodLockChange?.(ep.id, locked)
  }
  const doLock = async (ep) => {
    setLockError('')
    try { await fsgApi?.lockEntityPeriod(ep.id); setLocked(ep, 1) }
    catch (e) { setLockError(e?.message || 'The period could not be locked.') }
  }
  const doUnlock = async (ep) => {
    setLockError('')
    try { await fsgApi?.unlockEntityPeriod(ep.id); setLocked(ep, 0) }
    catch (e) { setLockError(e?.message || 'The period could not be unlocked.') }
    finally { setUnlockTarget(null) }
  }

  const auditorText = (a) =>
    `${a.firm_name ? `${a.firm_name} · ` : ''}M.No. ${a.membership_number}${a.frn ? ` · FRN ${a.frn}` : ''}`
  const signatoryText = (s) => (s.din ? `${s.id_type || 'DIN'}: ${s.din}` : '')

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-50" data-testid="master-page">
      {/* The cards fill the screen to the bottom: the grid grows to the window, columns stretch and their cards share it. */}
      <div className="mx-auto flex w-full max-w-[120rem] flex-1 flex-col p-4">
        {!entity ? (
          <p className="text-sm text-slate-500">Opening the engagement&apos;s client…</p>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
            <Card
              title="Auditee"
              testId="master-auditee"
              action={
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setModal({ type: 'read' })} className={btnSecondary} title="Read-only view of the Auditee Details">View</button>
                  <button type="button" onClick={() => setModal({ type: 'edit' })} className={btnSecondary}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                  </button>
                </div>
              }
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-slate-500">Name</dt><dd className="text-right font-medium text-slate-900 line-clamp-2 break-words" title={entity.name}>{entity.name}</dd>
                <dt className="text-slate-500">Constitution</dt><dd className="text-right text-slate-900">{entity.constitution_display || '—'}</dd>
                <dt className="text-slate-500">Nature of business</dt><dd className="text-right text-slate-900 truncate">{entity.business_type || '—'}</dd>
                <dt className="text-slate-500">Has branches</dt><dd className="text-right text-slate-900">{entity.has_branches ? 'Yes' : 'No'}</dd>
                <dt className="text-slate-500">PAN</dt><dd className="text-right text-slate-900 tracking-wide">{entity.pan || '—'}</dd>
                {['Company', 'LLP'].includes(entity.constitution_display) && (<>
                  <dt className="text-slate-500">{entity.constitution_display === 'LLP' ? 'LLPIN' : 'CIN'}</dt>
                  <dd className="text-right text-slate-900 truncate" title={entity.cin || ''}>{entity.cin || '—'}</dd>
                </>)}
                <dt className="text-slate-500">Address</dt><dd className="text-right text-slate-900 line-clamp-2 break-words" title={entity.address || ''}>{entity.address || '—'}</dd>
              </dl>

              <h3 className="fsr-group-label mt-5 mb-2 text-slate-500">Financial periods</h3>
              {lockError && <p role="alert" className="mb-2 text-xs text-red-700">{lockError}</p>}
              {periodsLoading ? (
                <p className="text-xs text-slate-400">Loading…</p>
              ) : periods.length === 0 ? (
                <p className="text-xs text-slate-500">No Financial Periods attached.</p>
              ) : (
                <ul className="space-y-2" aria-label="Financial periods">
                  {periods.map(ep => (
                    <li key={ep.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-slate-800"><span className="font-medium">{ep.year_label}</span> · {showDate(ep.date_from)} – {showDate(ep.date_till)}</span>
                      {ep.locked ? (
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> Locked</span>
                          <button type="button" onClick={() => setUnlockTarget(ep)} className="fsr-keep inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-blue-700 hover:bg-blue-50" aria-label={`Unlock ${ep.year_label}`}>
                            <LockOpen className="h-3.5 w-3.5" aria-hidden="true" /> Unlock
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => doLock(ep)} className="fsr-keep inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-sm text-slate-600 hover:bg-slate-100" aria-label={`Lock ${ep.year_label}`}>
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Lock
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="flex min-w-0 flex-col gap-4">
            <Card
              title="Auditors"
              testId="master-auditors"
              className="flex-1"
              action={
                <button type="button" onClick={() => setModal({ type: 'auditor-create' })} className={btnSecondary}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add auditor
                </button>
              }
            >
              {auditors === null ? <p className="text-xs text-slate-400">Loading…</p> : auditors.length === 0 ? (
                <EmptyState icon={Briefcase} title="No auditors added yet" text="Pick from the Global Auditor list or add one manually." />
              ) : (
                <PersonList people={auditors} describe={auditorText} onManage={() => setModal({ type: 'auditor-manage' })} manageLabel="Manage auditors" />
              )}
            </Card>

            <Card
              title="Signing authorities"
              testId="master-signatories"
              className="flex-1"
              action={
                <button type="button" onClick={() => setModal({ type: 'signatory-create' })} className={btnSecondary}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add signatory
                </button>
              }
            >
              {signatories === null ? <p className="text-xs text-slate-400">Loading…</p> : signatories.length === 0 ? (
                <EmptyState icon={PenLine} title="No signing authorities added yet" text="Add the people who sign the financial statements." />
              ) : (
                <PersonList people={signatories} describe={signatoryText} onManage={() => setModal({ type: 'signatory-manage' })} manageLabel="Manage signatories" />
              )}
            </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-4">

            {onOpenMappingRules && (
              <Card
                title="Mapping rules"
                testId="master-mapping-rules"
                action={
                  <button type="button" onClick={onOpenMappingRules} title="Open Mapping Rules (Ctrl+Shift+M, then M)" className={btnSecondary}>
                    <Settings className="h-3.5 w-3.5" aria-hidden="true" /> Open
                  </button>
                }
              >
                <p className="text-sm text-slate-600">Manage the mapping rules used for this engagement.</p>
              </Card>
            )}

            <Card title="Branch Master" testId="master-branches" className="flex-1">
              <BranchMaster entity={entity} onChanged={onBranchesChanged} embedded />
            </Card>
            </div>
          </div>
        )}
      </div>

      {modal?.type === 'edit' && entity && (
        <AuditeeFormModal mode="edit" editing={entity} onSaved={(e) => { onEntityChange(e); close() }} onClose={close} />
      )}
      {modal?.type === 'read' && entity && (
        <AuditeeReadModal entity={entity} onClose={close} />
      )}
      {modal?.type === 'auditor-create' && (
        <AuditorManageModal entity={entity} startInCreate onClose={close} />
      )}
      {modal?.type === 'auditor-manage' && (
        <AuditorManageModal entity={entity} onClose={close} />
      )}
      {modal?.type === 'signatory-create' && (
        <SignatoryManageModal entity={entity} startInCreate onClose={close} />
      )}
      {modal?.type === 'signatory-manage' && (
        <SignatoryManageModal entity={entity} onClose={close} />
      )}
      {unlockTarget && (
        <UnlockConfirmModal
          periodLabel={`${unlockTarget.year_label} (${unlockTarget.date_from} To ${unlockTarget.date_till})`}
          onConfirm={() => doUnlock(unlockTarget)}
          onClose={() => setUnlockTarget(null)}
        />
      )}
    </div>
  )
}
