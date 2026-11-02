import React, { useState } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import { fsgApi } from '../../api.js'

// ICAI VERA: the data lives in VERA's local SQLite database, so FSG_Bharat's
// PostgreSQL connection form is not shown. The two tools remain.
export default function SettingsModal({ onClose }) {
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const [refExporting, setRefExporting] = useState(false)
  const [refExportMsg, setRefExportMsg] = useState('')

  const containerRef = useModalKeys({ onClose })

  // Every Financial Statement Review table's raw data (all clients), one sheet
  // per table — for backup/audit/debugging; partners and admins only. The main process asks for the file,
  // reads the tables and writes the workbook itself (services/dbExport.js): the
  // file is never sent back through IPC, which is what used to fail with
  // "Invalid array length" once it passed ~134 MB. A very large database becomes
  // several files (<name>_part1.xlsx, _part2.xlsx, ...).
  const handleExportAllTables = async () => {
    setExporting(true); setExportMsg('')
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const r = await fsgApi?.exportAllTablesToFile({ defaultPath: `Financial_Statement_Review_Data_${stamp}.xlsx` })
      if (!r) { setExportMsg('Export failed: no response from the application.'); return }
      if (r.canceled) return
      if (!r.ok) { setExportMsg('Export failed: ' + r.error); return }
      if (!r.tables) { setExportMsg('No tables found.'); return }
      const where = r.files.length === 1
        ? `to ${r.files[0]}`
        : `to ${r.files.length} files (too large for one workbook): ${r.files.join(', ')}`
      const cut = r.cutCells ? ` ${r.cutCells} cell(s) longer than Excel allows were shortened and marked "[cut …]".` : ''
      setExportMsg(`Exported ${r.tables} tables (${r.rows.toLocaleString('en-IN')} rows) ${where}.${cut}`)
    } catch (err) {
      setExportMsg('Export failed: ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  // Bundled statutory reference: blank BS/PL/Notes shape for all three
  // constitutions plus every Fill-Details form shown as if completed —
  // ships alongside the app so it's available without network access.
  const handleDownloadFormatReference = async () => {
    setRefExporting(true); setRefExportMsg('')
    try {
      const r = await fsgApi?.getFormatReference()
      if (!r?.ok) { setRefExportMsg(r?.error || 'Reference file not found.'); return }
      const result = await fsgApi?.saveFileDialog({
        defaultPath: 'FSG_Bharat_Prescribed_Format_Reference.html',
        filters: [{ name: 'HTML Document', extensions: ['html'] }],
      })
      if (result?.filePath) {
        const bytes = Array.from(new TextEncoder().encode(r.html))
        await fsgApi?.writeFile(result.filePath, bytes)
        setRefExportMsg(`Saved to ${result.filePath}`)
      }
    } catch (err) {
      setRefExportMsg('Download failed: ' + (err?.message || err))
    } finally {
      setRefExporting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-md" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-blue-900">Tools</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-500">
          Financial Statement Review data is kept in ICAI VERA's local database with the rest of the audit file.
        </p>

        <div className="mt-5 pt-4 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 uppercase mb-1">Financial Statement Data Export</div>
          <p className="text-xs text-gray-400 mb-2">
            Downloads every Financial Statement Review table (all clients) as one Excel workbook, one sheet per
            table. Partners and admins only. This is not a backup of the whole VERA database.
          </p>
          <button
            onClick={handleExportAllTables}
            disabled={exporting}
            className="w-full py-2 border border-gray-300 text-gray-700 rounded font-medium text-sm hover:bg-gray-50 transition disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : '↓ Download All Tables (Excel)'}
          </button>
          {exportMsg && <p className="text-xs text-gray-500 mt-2 break-words">{exportMsg}</p>}
        </div>

        <div className="mt-5 pt-4 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 uppercase mb-1">Prescribed Format Reference</div>
          <p className="text-xs text-gray-400 mb-2">
            Blank BS, PL and Notes shape for all three constitutions, plus every Fill-Details form shown as if
            completed — a statutory-format checklist to verify saved output against.
          </p>
          <button
            onClick={handleDownloadFormatReference}
            disabled={refExporting}
            className="w-full py-2 border border-gray-300 text-gray-700 rounded font-medium text-sm hover:bg-gray-50 transition disabled:opacity-40"
          >
            {refExporting ? 'Preparing…' : '↓ Download Format Reference (HTML)'}
          </button>
          {refExportMsg && <p className="text-xs text-gray-500 mt-2 break-words">{refExportMsg}</p>}
        </div>
      </div>
    </div>
  )
}
