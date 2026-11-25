import { noteColumnLabels, datedPeriodLabel } from '../../utils/statementDates'
import React, { useEffect, useState } from 'react'
import { fsgApi } from '../../api.js'
import { investmentScope } from '../../utils/investmentStore'
import { INVESTMENT_CATEGORIES, INVESTMENT_RELATIONSHIPS, investmentKind, investmentGroups, investmentLedgerKey, prepareInvestmentDetails, defaultInvestment, investmentPendingIssues, investmentTables, validateInvestmentInput } from '../../utils/investments'

const inputClass = 'border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 bg-white w-full'
function Field({ label, value, onChange, options, type = 'text' }) {
  return <label className="text-xs text-gray-700" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, minWidth: 0 }}>{label}{options
    ? <select aria-label={label} className={inputClass} style={{ width: '100%', minWidth: 0 }} value={value ?? ''} onChange={e => onChange(e.target.value)}><option value="">Select...</option>{options.map(o => <option key={o}>{o}</option>)}</select>
    : <input aria-label={label} type={type} step={type === 'number' ? 'any' : undefined} className={inputClass} style={{ width: '100%', minWidth: 0 }} value={value ?? ''} onChange={e => onChange(e.target.value)} />}</label>
}
// T-084: what is still to be filled, in the warning style of the other notes (as the Long-term Borrowings check). On the
// note it is one line with the count, opened on a click; in the form it is open.
export function InvestmentPendingWarning({ issues = [], open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen)
  if (!issues.length) return null
  return <div className="px-4 py-2 bg-red-50 border border-red-300 rounded text-xs text-red-700" data-testid="investment-pending">
    <div className="flex items-start gap-2">
      <span className="shrink-0 font-bold">⚠</span>
      <span className="flex-1">
        <strong>Fill Details pending</strong> — {issues.length} item{issues.length !== 1 ? 's' : ''} to complete before this note can be finalised.
        {' '}<button type="button" onClick={() => setOpen(o => !o)} className="underline text-red-700 hover:text-red-900">{open ? 'Hide' : 'Show'} items</button>
      </span>
    </div>
    {open && <ul className="list-disc pl-9 mt-1 space-y-0.5">{issues.map((s, i) => <li key={i}>{s}</li>)}</ul>}
  </div>
}

const fmtCell = (v) => typeof v === 'number' ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v
export function InvestmentDisclosure({ details, kind, issues = [], periodLabels = { cy: 'Current Year', py: 'Previous Year' }, inForm = false }) {
  const tables = investmentTables(details, kind)
  if (!tables.length && !issues.length) return null
  return <div className={inForm ? 'space-y-4 text-xs' : 'mt-6 pt-6 border-t-2 border-indigo-300 px-4 pb-4 space-y-4 text-xs'} data-testid="investment-disclosure">
    {!inForm && <h3 className="text-sm font-bold text-indigo-900">Investment details</h3>}
    {!inForm && <InvestmentPendingWarning issues={issues} />}
    {tables.map((table, i) => <div key={i}>
      <h4 className="text-xs font-semibold text-blue-900 mb-1">{table.title}</h4>
      <div className="overflow-x-auto"><table className="w-full text-xs border border-blue-100">
        <thead><tr className="bg-blue-50 border-b border-blue-200">{table.headers.map(h => <th className="fsg-dated-heading py-1.5 px-2 text-left font-semibold text-blue-900" key={h}>{datedPeriodLabel(h, periodLabels)}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, j) => <tr key={j} className="border-b border-gray-100 hover:bg-gray-50">{r.map((v, k) => <td className={`py-1 px-2 ${typeof v === 'number' ? 'text-right font-mono' : 'text-gray-800'} ${/pending/i.test(String(v)) ? 'text-red-600 italic' : ''}`} key={k}>{fmtCell(v)}</td>)}</tr>)}</tbody>
      </table></div>
    </div>)}
  </div>
}

export default function InvestmentsForm({ activeTB, prevTB, note, onClose, onSaved }) {
  const periodLabels = noteColumnLabels(activeTB, prevTB, note)
  const kind = investmentKind(note.title)
  const rows = note.investmentRows || note.rows || []
  const groups = investmentGroups(rows)
  const [details, setDetails] = useState(null)
  const [savedBefore, setSavedBefore] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [locked, setLocked] = useState(true)
  const [custom, setCustom] = useState('')
  useEffect(() => {
    let live = true
    Promise.all([fsgApi.listInvestments(investmentScope(activeTB)), fsgApi.getEntityPeriod(activeTB.entity_period_id)])
      .then(([saved, ep]) => { if (live) { setSavedBefore(saved[kind] || null); setDetails(prepareInvestmentDetails(saved[kind], rows)); setLocked(!!(ep.locked || ep.is_final)) } })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [activeTB.id, activeTB.entity_period_id, kind])
  const update = (idx, patch) => setDetails(d => ({ ...d, entries: d.entries.map((e, i) => i === idx ? { ...e, ...patch } : e) }))
  const remove = idx => setDetails(d => ({ ...d, entries: d.entries.filter((_, i) => i !== idx) }))
  // the same list the note shows (utils/investments.js investmentPendingIssues), worked out on what is typed so far
  const issues = details ? investmentPendingIssues(savedBefore, rows, kind, note, details) : []
  const save = async () => {
    setSaving(true); setError('')
    try { validateInvestmentInput(details); await fsgApi.saveInvestments({ ...investmentScope(activeTB), noteTitle: note.title, data: { ...details, pyTBIds: note.investmentPYTBIds || [] } }); onSaved() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  const unknown = details?.entries.filter(e => !rows.some(r => investmentLedgerKey(r) === e.ledgerKey && (r.level3 || r.mapping3_resultant || 'Unclassified investments').trim() === e.subclass)) || []
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div role="dialog" aria-label={`${note.title} Fill Details`} className="bg-white rounded-lg shadow-lg w-full max-w-7xl max-h-[90vh] overflow-y-auto">
    <div className="sticky top-0 z-10 bg-blue-600 text-white px-6 py-3 border-b border-blue-700 flex items-start justify-between gap-4">
      <div><h2 className="text-base font-bold">Note {note.num}: {note.displayTitle || note.title}</h2><p className="text-xs text-blue-100 mt-1">Schedule III Division I investment disclosures · Amounts in rupees</p></div>
      <button onClick={onClose} aria-label="Close investments" className="text-blue-100 hover:text-white text-sm">✕</button>
    </div>
    <div className="p-6 space-y-4">
      {error && <div role="alert" className="p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>}
      {!details && !error && <div className="p-6 text-center text-gray-400">Loading investment details...</div>}
      {locked && details && <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">This Financial Year is locked or finalised. Details are read-only.</div>}
      {details && <InvestmentPendingWarning issues={issues} open />}
      {details && <fieldset disabled={locked || saving} className="space-y-4">
        <p className="text-xs text-gray-600">Each table follows the mapped investment sub-classification. Add a row to split a ledger between investees; detail amounts must total that ledger. Current investments have no trade/other split. Diminution is disclosed separately and is not deducted again from carrying amounts. Remap any amount redeemable within 12 months using the classification screen.</p>
        <div className="flex items-end gap-2 max-w-lg"><Field label="New investment category" value={custom} onChange={setCustom}/><button className="border rounded p-1 text-xs whitespace-nowrap" onClick={() => { const v = custom.trim(); if (v && ![...INVESTMENT_CATEGORIES, ...details.categories].some(c => c.toLowerCase() === v.toLowerCase())) setDetails(d => ({ ...d, categories: [...d.categories, v] })); setCustom('') }}>+ Add category</button></div>
        {groups.map(group => <section className="border rounded p-3 space-y-3" key={group.name}><h3 className="font-bold text-blue-900">{group.name}</h3>
          {details.entries.map((e, idx) => e.subclass !== group.name ? null : <div className="border bg-gray-50 rounded p-3 space-y-3" key={idx} data-testid="investment-entry">
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Name of Ledger', 'Name of company / investee to print', 'Category of investment', 'Related party relationship', ...(kind === 'noncurrent' ? ['Trade / other investments'] : [])].map(h => <th className="fsg-dated-heading text-left p-1 min-w-[160px]" key={h}>{datedPeriodLabel(h, periodLabels)}</th>)}</tr></thead><tbody><tr>
              <td className="p-1"><select aria-label="Name of Ledger" value={e.ledgerKey} className={inputClass} onChange={event => { const r = group.ledgers.find(r => investmentLedgerKey(r) === event.target.value); if (r) update(idx, { ledgerKey: investmentLedgerKey(r), ledgerName: r.ledger_name || r.name }) }}>
                {!group.ledgers.some(r => investmentLedgerKey(r) === e.ledgerKey) && <option value={e.ledgerKey}>Ledger unavailable — review</option>}
                {group.ledgers.map(r => <option value={investmentLedgerKey(r)} key={investmentLedgerKey(r)}>{r.ledger_name || r.name}{r.branch_name ? ` (${r.branch_name})` : ''}{r.investmentPYOnly ? ' (PY only)' : ''} [#{r.tb_row_id}]</option>)}
              </select></td>
              <td className="p-1"><Field label="Printed investee name" value={e.companyName} onChange={v => update(idx, { companyName: v })}/></td>
              <td className="p-1"><Field label="Category" options={[...INVESTMENT_CATEGORIES, ...details.categories]} value={e.category} onChange={v => update(idx, { category: v })}/></td>
              <td className="p-1"><Field label="Relationship" options={INVESTMENT_RELATIONSHIPS} value={e.relationship} onChange={v => update(idx, { relationship: v })}/></td>
              {kind === 'noncurrent' && <td className="p-1"><Field label="Trade / other" options={['Trade investments', 'Other investments']} value={e.trade} onChange={v => update(idx, { trade: v })}/></td>}
            </tr></tbody></table></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Quoted / unquoted" options={['Quoted', 'Unquoted']} value={e.quotation} onChange={v => update(idx, { quotation: v })}/>
              <Field label="Nature / description" value={e.nature} onChange={v => update(idx, { nature: v })}/>
              <Field label="Basis of valuation" value={e.valuation} onChange={v => update(idx, { valuation: v })}/>
              {['amountCY', 'amountPY', 'marketCY', 'marketPY', 'diminutionCY', 'diminutionPY'].map((f, i) => <Field key={f} type="number" label={['Carrying amount CY', 'Carrying amount PY', 'Market value CY', 'Market value PY', 'Diminution provision / write-down CY', 'Diminution provision / write-down PY'][i]} value={e[f]} onChange={v => update(idx, { [f]: v })}/>)}
              {/shares|debentures|bonds|units/i.test(e.category) && <>
                <Field label={/debenture/i.test(e.category) ? 'No of Debentures CY' : /shares/i.test(e.category) ? 'No of Shares CY' : 'Number of units CY'} type="number" value={e.quantityCY} onChange={v => update(idx, { quantityCY: v })}/>
                <Field label="Number of securities PY" type="number" value={e.quantityPY} onChange={v => update(idx, { quantityPY: v })}/>
                <Field label="Paid status" options={['Fully paid', 'Partly paid']} value={e.paidStatus} onChange={v => update(idx, { paidStatus: v })}/>
                <Field label="Face value per unit (Rs)" type="number" value={e.faceValue} onChange={v => update(idx, { faceValue: v })}/>
                {e.paidStatus === 'Partly paid' && <><Field label="Paid per unit (Rs)" type="number" value={e.paidPerUnit} onChange={v => update(idx, { paidPerUnit: v })}/><Field label="Uncalled liability (Rs)" type="number" value={e.uncalled} onChange={v => update(idx, { uncalled: v })}/></>}
              </>}
              {/debentures|bonds/i.test(e.category) && <><Field label="Redemption date" type="date" value={e.redemptionDate} onChange={v => update(idx, { redemptionDate: v })}/><Field label="Amount redeemable within 12 months" type="number" value={e.redeemWithin12Months} onChange={v => update(idx, { redeemWithin12Months: v })}/><Field label="Redemption classification / explanation" value={e.redemptionNote} onChange={v => update(idx, { redemptionNote: v })}/></>}
            </div>
            {e.category === 'Partnership firm' && <div className="space-y-3 border-t pt-3"><h4 className="font-bold text-sm">Partnership firm — all partners</h4><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {['firmCapitalCY', 'firmCapitalPY', 'companyCapitalCY', 'companyCapitalPY'].map((f, i) => <Field key={f} label={['Total firm capital CY', 'Total firm capital PY', 'Company share in capital CY', 'Company share in capital PY'][i]} type="number" value={e[f]} onChange={v => update(idx, { [f]: v })}/>)}
              <Field label="Firm reporting date" type="date" value={e.firmDate} onChange={v => update(idx, { firmDate: v })}/><Field label="Capital basis (capital only / combined accounts and explanation)" value={e.capitalBasis} onChange={v => update(idx, { capitalBasis: v })}/><Field label="Reporting-date difference / significant adjustments" value={e.dateDifference} onChange={v => update(idx, { dateDifference: v })}/>
            </div><p className="text-xs">Include the investing company and every other partner. Enter each partner's capital and profit share at the Balance Sheet date. LLP investments belong under other investments, without this partnership schedule.</p>
              {(e.partners || []).map((p, pi) => <div className="flex gap-2 items-end" key={pi}>{['name', 'capitalCY', 'capitalPY', 'profitShareCY', 'profitSharePY'].map((f, i) => <Field key={f} label={['Partner name', 'Capital CY', 'Capital PY', 'Profit share CY (%)', 'Profit share PY (%)'][i]} type={f === 'name' ? 'text' : 'number'} value={p[f]} onChange={v => update(idx, { partners: e.partners.map((q, j) => j === pi ? { ...q, [f]: v } : q) })}/>)}<button className="text-xs text-red-700" onClick={() => update(idx, { partners: e.partners.filter((_, j) => j !== pi) })}>Remove partner</button></div>)}
              <button className="text-xs text-blue-700" onClick={() => update(idx, { partners: [...e.partners, { name: '', capitalCY: '', capitalPY: '', profitShareCY: '', profitSharePY: '' }] })}>+ Add partner</button>
            </div>}
            <button className="text-xs text-red-700" onClick={() => remove(idx)}>Remove investment row</button>
          </div>)}
          <button className="text-xs text-blue-700" onClick={() => setDetails(d => ({ ...d, entries: [...d.entries, { ...defaultInvestment(group.ledgers[0]), amountCY: '', amountPY: '' }] }))}>+ Add investment row</button>
        </section>)}
        {unknown.map(e => <div className="bg-amber-50 p-2 text-xs" key={details.entries.indexOf(e)}>Unavailable ledger: {e.ledgerName} / {e.subclass}. Saved details retained for review. <button className="text-red-700" onClick={() => remove(details.entries.indexOf(e))}>Remove stale row</button></div>)}
      </fieldset>}
      {details && <div className="border-t border-gray-200 pt-4"><h3 className="text-sm font-bold text-indigo-900 mb-2">Preview (as printed in the note)</h3><InvestmentDisclosure inForm periodLabels={noteColumnLabels(activeTB, prevTB, note)} details={details} kind={kind} /></div>}
    </div>
    <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
      <button onClick={onClose} className="px-4 py-2 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium">Cancel</button>
      <button disabled={!details || locked || saving} onClick={save} className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:bg-gray-400">{saving ? 'Saving...' : issues.length ? 'Save draft details' : 'Save details'}</button>
    </div>
  </div></div>
}
