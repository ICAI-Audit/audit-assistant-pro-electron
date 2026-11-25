// T-073: upload a Trial Balance and its masters from the simple Excel format
// (utils/simpleTbFormat.js): one workbook, "Trial Balance" and "Groups" sheets.
// The rows go through the same builder and save as the Tally Excel route
// (buildTBRowsFromTally, tb:uploadTally).
import BranchSelect, { BRANCH_REQUIRED_MESSAGE } from '../shared/BranchSelect'
import React, { useState } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import { buildTBRowsFromTally } from '../../utils/tallyParsers'
import { parseSimpleTbWorkbook, buildSimpleTbTemplate, simpleTbTemplateSpec } from '../../utils/simpleTbFormat'
import { finishWorkbook } from '../../utils/veraExcel'
import FinancialPeriodPicker from '../shared/FinancialPeriodPicker'
import { fsgApi } from '../../api.js'

/** Saves the blank simple format. Returns true when saved. */
export async function downloadSimpleTbTemplate() {
  const result = await fsgApi?.saveFileDialog({
    defaultPath: 'TrialBalance_and_Masters_Template.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (result?.canceled || !result?.filePath) return false
  const bytes = await finishWorkbook(buildSimpleTbTemplate(), simpleTbTemplateSpec())
  await fsgApi?.writeFile(result.filePath, Array.from(bytes))
  return true
}

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function SimpleTbUploadModal({ entity, entityId, hasBranches, confirmVersion, onUploaded, onCancel }) {
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [periodPick, setPeriodPick] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const containerRef = useModalKeys({ onClose: onCancel })

  const handleFile = async (e) => {
    setError(''); setParsed(null)
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    try {
      setParsed(parseSimpleTbWorkbook(await f.arrayBuffer()))
    } catch (err) {
      setError('The file could not be read: ' + (err?.message || err))
    }
  }

  const ready = !!(parsed && !parsed.errors.length && parsed.rows.length && entityId && periodPick?.entityPeriodId)

  const handleUpload = async () => {
    if (!ready || busy) return
    if (hasBranches && !branchName) { window.alert(BRANCH_REQUIRED_MESSAGE); return }
    const proceed = await confirmVersion(periodPick.entityPeriodId, branchName || '')
    if (!proceed) return
    setBusy(true); setError('')
    try {
      const rows = buildTBRowsFromTally(parsed.rows, parsed.ledgerMap)
      const res = await fsgApi?.uploadTallyTB({
        entityId, period: periodPick.periodText || '',
        fileName: file?.name || 'TrialBalance_Simple.xlsx',
        tbRows: rows,
        branchName: branchName || '',
        entityPeriodId: periodPick.entityPeriodId,
      })
      onUploaded(res.tb)
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-xl fsg-simple-tb-modal" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">Upload Trial Balance and Masters (Simple Excel Format)</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="space-y-3">
          <FinancialPeriodPicker entity={entity} value={periodPick} onChange={setPeriodPick} allowCustom={false} required label="Financial Year" />
          {hasBranches && <BranchSelect entityId={entityId} value={branchName} onChange={setBranchName} />}
          <div className="border border-gray-200 rounded p-3 bg-gray-50">
            <label className="block text-xs font-semibold text-blue-900 mb-1">Workbook with the "Trial Balance" and "Groups" sheets</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-xs" />
            <div className="mt-1 text-[11px] text-gray-500">
              No file yet?{' '}
              <button type="button" className="text-blue-700 underline" onClick={() => downloadSimpleTbTemplate().catch(e => setError(e.message))}>
                Download the blank format
              </button>
              {' '}(Tally&apos;s standard groups are already listed in it).
            </div>
            {file && parsed && (
              <div className="mt-1 text-[11px] text-gray-700">
                <span className="font-medium">{file.name}</span>
                <span className="ml-2 text-green-700">{parsed.ledgerCount} ledgers · {parsed.groupCount} groups of your own</span>
              </div>
            )}
          </div>
          {parsed?.totals && !parsed.errors.length && (
            <div className="text-[11px] text-gray-700 border border-gray-200 rounded p-2 grid grid-cols-2 gap-x-4">
              <span>Total debits: {fmt(parsed.totals.debit)}</span>
              <span>Total credits: {fmt(parsed.totals.credit)}</span>
              <span className={Math.abs(parsed.totals.closingNet) < 1 ? 'text-green-700' : 'text-red-600'}>
                {Math.abs(parsed.totals.closingNet) < 1 ? '✓ Closing balances tally' : `✗ Closing balances differ by ${fmt(Math.abs(parsed.totals.closingNet))}`}
              </span>
            </div>
          )}
          {parsed?.errors?.length > 0 && (
            <div className="fsg-simple-tb-errors text-xs px-2 py-1.5 rounded border bg-red-50 text-red-700 border-red-200 space-y-0.5">
              <div className="font-semibold">Correct the file and choose it again:</div>
              {parsed.errors.map((w, i) => <div key={i}>✗ {w}</div>)}
            </div>
          )}
          {parsed?.warnings?.length > 0 && (
            <div className="text-xs px-2 py-1.5 rounded border bg-amber-50 text-amber-800 border-amber-200 space-y-0.5">
              {parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          {error && <div className="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 text-xs">{error}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">Cancel</button>
          <button onClick={handleUpload} disabled={!ready || busy}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}

