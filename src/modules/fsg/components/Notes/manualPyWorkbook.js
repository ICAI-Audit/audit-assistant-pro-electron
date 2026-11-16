// ── Manual Previous Year entries Excel round-trip — backup/restore across a
// Trial Balance re-upload ────────────────────────────────────────────────
// manual_py_entries is looked up by TITLE (see schema.js's note_title
// comment), but the table itself is keyed by tb_id, and every TB upload is a
// plain INSERT (see tb.js's tb:upload/tb:uploadTally) — a fresh tb_id, never
// the same row reused. So a branch's own Manual PY entries do NOT survive
// that branch's own Trial Balance being re-uploaded, unlike
// entity_manual_py_entries (the Consolidated view's entries — entity-scoped,
// unaffected by any one branch's re-upload). Same round-trip pattern as
// Stock/Dep (IT)/Dep (Comp): download a snapshot of what's currently saved
// before re-uploading, then Upload Filled afterwards to restore it — matched
// back by NOTE TITLE + PARTICULAR, never by the note number (which is only a
// recomputed position, not a stable identity — see allocNoteNum in
// useFinancials.js).
import * as XLSX from 'xlsx-js-style'

const HEADER_ROW = ['Note Title', 'Particular', 'Previous Year Amount', 'Custom Row (Y/N)']
const COL_WIDTHS = [{ wch: 42 }, { wch: 32 }, { wch: 20 }, { wch: 14 }]

export function buildManualPyFilledWorkbook(entries, { sheetLabel = 'Manual PY' } = {}) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, ...(entries || []).map(e => [
    e.note_title || '', e.particular_label || '', e.py_amount ?? '', e.is_custom ? 'Y' : '',
  ])]
  if (aoa.length === 1) aoa.push(['(nothing saved yet)'])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, sheetLabel.slice(0, 31))
  return wb
}

/**
 * T-047: how utils/veraExcel.js finishes the Manual PY file — How to Fill guide, blue
 * header, yellow cells and a Y/N dropdown on "Custom Row" (a fixed list). Note Title and
 * Particular stay free text (the client's own note lines). Sheet name and cells are
 * unchanged, so parseManualPyWorkbook reads old and new files alike.
 * @param {number} entryCount  rows in the file (spare yellow rows follow, to add more)
 */
export function manualPyExcelSpec(entryCount = 0) {
  const lastRow = 1 + Math.max(1, entryCount) + 10
  return {
    mode: 'filled',
    sheets: {
      'Manual PY*': {
        headerRow: 1, lastRow, lastCol: 'D',
        inputCols: ['A', 'B', 'C', 'D'], amountCols: ['C'],
        widths: [44, 34, 20, 16], autoFilter: false,
        dropdowns: [{ col: 'D', fromRow: 2, toRow: lastRow, list: ['Y', 'N'], name: 'Custom Row (Y/N)',
          prompt: 'Y if this is a row you added to the note yourself; otherwise N or blank.', error: 'Choose Y or N.' }],
      },
    },
    howTo: {
      title: 'Manual Previous Year figures',
      purpose: 'The Previous Year figures typed by hand on the Notes screen for this Trial Balance. Keep it safe before re-uploading a Trial Balance, then upload it back to restore them.',
      steps: [
        'Go to the "Manual PY" sheet.',
        'Correct or add a row: the note title and the line (Particular) exactly as the Notes screen shows them, and the Previous Year amount in rupees.',
        'Leave the amount blank to leave that line as it is in VERA.',
        'Save the file, then on VERA\'s Notes screen, under Previous Year, click "⬆ Manual PY" and pick it.',
      ],
      columns: [
        ['Note Title', 'The note the figure belongs to, as titled on the Notes screen. VERA matches it by this title, not the note number.', 'Text — fill in'],
        ['Particular', 'The line of that note.', 'Text — fill in'],
        ['Previous Year Amount', 'The Previous Year figure of that line.', 'Amount — fill in'],
        ['Custom Row (Y/N)', 'Y for a line you added to the note yourself.', 'Dropdown'],
      ],
      tips: ['A row whose note title no longer exists in the Notes is still saved by its title and shows again once that note is back.'],
    },
  }
}

/**
 * @param {XLSX.WorkBook} wb
 * @returns {{ entries: Array<{note_title: string, particular_label: string, py_amount: number, is_custom: boolean}> }}
 */
export function parseManualPyWorkbook(wb) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Manual PY')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const entries = []
  if (!ws) return { entries }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  for (const r of aoa.slice(1)) {
    const noteTitle = (r[0] || '').toString().trim()
    if (!noteTitle) continue
    const pyAmountRaw = r[2]
    // A blank amount is left untouched, not treated as "restore to zero" —
    // same "blank means not filled" convention as Fill Details/Stock uploads.
    if (pyAmountRaw === '' || pyAmountRaw == null) continue
    const particularLabel = (r[1] || '').toString().trim()
    const isCustom = /^y/i.test((r[3] || '').toString().trim())
    entries.push({ note_title: noteTitle, particular_label: particularLabel, py_amount: parseFloat(pyAmountRaw) || 0, is_custom: isCustom })
  }
  return { entries }
}
