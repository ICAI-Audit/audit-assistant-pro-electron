import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import MastersModal from '../shared/MastersModal'
import { fsrShellBridge } from '../../../../lib/fsrShellBridge'

const CONSTITUTION_LABEL = {
  1: 'Individual / Proprietorship / Partnership',
  2: 'LLP',
  3: 'Company',
}

const THEMES = [
  { key: 'blue',  label: 'Classic Blue',  swatch: '#1e40af' },
  { key: 'beige', label: 'Warm Beige',    swatch: '#92400e' },
  { key: 'green', label: 'Modern Green',  swatch: '#166534' },
  { key: 'pink',  label: 'Soft Pink',     swatch: '#9d174d' },
]

// The active tab names the page; the three statements use their full names.
const PAGE_TITLE = { BS: 'Balance Sheet', PL: 'Profit & Loss', CFS: 'Cash Flow Statement' }

// ICAI VERA: the Auditee is the selected engagement's client, so the bar shows
// the engagement and has no Auditee picker, database status or "New window".
// Auditee button (T-088, owner 27 Nov 2026): replaces the Master tab and goes straight to the Auditee page, which holds
// the auditee details, financial periods, auditors, signing authorities, mapping rules and branches. Ctrl+Shift+M does the same.
function AuditeeButton({ entity, items, activeTab, onOpen }) {
  const isActive = items.includes(activeTab)
  return (
    <button
      type="button"
      data-testid="fsr-auditee-button"
      aria-current={isActive ? 'page' : undefined}
      title="Auditee details, financial periods, auditors, signing authorities, branches and mapping rules (Ctrl+Shift+M)"
      onClick={() => onOpen?.('Auditee Details')}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition whitespace-nowrap ${
        isActive ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
    >
      {entity ? <>Auditee<span className="sr-only">: {entity.name}</span></> : 'Opening engagement…'}
    </button>
  )
}

export default function TopBar({ entity, engagement, activeTab, onOpenMaster, masterItems = [], onSettings, theme, onThemeChange, entityPeriods, currentEntityPeriodId, onEntityPeriodChange }) {
  const [showMastersModal, setShowMastersModal] = useState(false)
  const [showThemeMenu, setShowThemeMenu]     = useState(false)
  // The page-header band is gone: the controls below render into the VERA top bar (slot #vera-header-actions).
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById('vera-header-actions')) }, [])

  // What the band used to show goes to the top bar's client switcher: engagement and constitution as one context line, and
  // the financial-period list inside its menu. The period handler is the module's own.
  const context = useMemo(() => [
    engagement?.name,
    entity?.constitution_display ? `${entity.constitution_display}${entity.business_type ? ` · ${entity.business_type}` : ''}` : '',
  ].filter(Boolean).join(' · '), [engagement?.name, entity?.constitution_display, entity?.business_type])
  const periods = useMemo(() => (entityPeriods || []).map(p => ({
    id: p.id, label: p.year_label, range: `(${p.date_from} to ${p.date_till})`, locked: !!p.locked,
  })), [entityPeriods])
  useEffect(() => {
    fsrShellBridge.publish({ active: true, context, periods, selectedPeriodId: currentEntityPeriodId ?? null })
  }, [context, periods, currentEntityPeriodId])
  useEffect(() => fsrShellBridge.registerSelect((id) => onEntityPeriodChange?.(id)), [onEntityPeriodChange])
  useEffect(() => () => fsrShellBridge.reset(), [])

  const cluster = (
      <div className="flex items-center gap-1 shrink-0">

        {/* Current Auditee context — all create/select/edit is done via the Master tab. The client name is shown once, in the VERA top bar. */}
        <AuditeeButton entity={entity} items={masterItems} activeTab={activeTab} onOpen={onOpenMaster} />

        {/* Masters (Auditor / Signatories) — always visible */}
        <button
          onClick={() => setShowMastersModal(true)}
          className="p-1.5 rounded text-slate-600 hover:bg-slate-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-800"
          title="Masters — Auditor & Signatories"
          aria-label="Masters — Auditor & Signatories"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </button>

        {/* Theme picker */}
        <div className="relative">
          <button
            onClick={() => setShowThemeMenu(v => !v)}
            className="p-1.5 rounded text-slate-600 hover:bg-slate-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-800"
            title="Change theme"
            aria-label="Change theme"
            aria-expanded={showThemeMenu}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </button>
          {showThemeMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowThemeMenu(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-48 py-1">
                <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 font-semibold uppercase">Theme</div>
                {THEMES.map(t => (
                  <button
                    key={t.key}
                    onClick={() => { onThemeChange?.(t.key); setShowThemeMenu(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left ${
                      theme === t.key ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full border border-gray-300" style={{ background: t.swatch }} />
                    <span className="text-gray-800">{t.label}</span>
                    {theme === t.key && <span className="ml-auto text-green-600">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={onSettings}
          className="p-1.5 rounded text-slate-600 hover:bg-slate-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-800"
          title="Tools — data export and format reference"
          aria-label="Tools — data export and format reference"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

  )

  return (
    <>
      {/* The active tab names the page. One visually hidden heading keeps the screen named for assistive technology. */}
      <h1 className="sr-only">{PAGE_TITLE[activeTab] || activeTab || 'Financial Statement Review'}{entity?.name ? ` — ${entity.name}` : ''}</h1>
      {slot ? createPortal(cluster, slot) : <div className="flex justify-end border-b border-slate-200 bg-white px-3 py-1">{cluster}</div>}
      {showMastersModal && (
        <MastersModal
          entity={entity}
          onClose={() => setShowMastersModal(false)}
        />
      )}
    </>
  )
}
