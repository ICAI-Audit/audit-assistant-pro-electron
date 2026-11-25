// T-086 (owner, 24 November 2026): Schedule III (Division I) disclosure under Long-term and Short-term loans and
// advances (Assets) — "Loans and advances due from directors, officers and entities in which directors are
// interested". Company only (the four lines name directors and officers). Entered in Fill Details on the note and
// shown beneath it on the Notes screen, in the PDF and in the Excel; until something is entered every line is nil ("—").
//
//   Particulars                                                        | As at CY | As at PY
//   Directors of the Company, severally or jointly with any other person |   —     |   —
//   Other officers of the Company, severally or jointly with any other person
//   Firms in which any director is a partner
//   Private companies in which any director is a director or a member
//   Total
//
// Saved inside the note's note_details JSON under `directorLoans`:
//   { directorLoans: { cy: { directors, officers, firms, pvtCos }, py: { ... } } }
// Not checked against the Trial Balance or the note figure (owner, 24 November 2026): the amounts need not agree.

export const DIRECTOR_LOANS_TITLE = 'Loans and advances due from directors, officers and entities in which directors are interested'

export const DIRECTOR_LOANS_ROWS = [
  { key: 'directors', label: 'Directors of the Company, severally or jointly with any other person' },
  { key: 'officers',  label: 'Other officers of the Company, severally or jointly with any other person' },
  { key: 'firms',     label: 'Firms in which any director is a partner' },
  { key: 'pvtCos',    label: 'Private companies in which any director is a director or a member' },
]

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }

/** Long-term or Short-term loans and advances (the Assets notes), for a Company. */
export const isLoansAdvancesNoteTitle = (title) => /\b(long|short)[\s-]*term\s+loans?\s*(and|&)\s*advances?\b/i.test(title || '')
  && !/\bfrom\b/i.test(title || '')
export const hasDirectorLoans = (constitution, title) => parseInt(constitution) === 3 && isLoansAdvancesNoteTitle(title)

/** Plain numbers for both periods (blank = 0), whatever was saved. */
export function directorLoansResolve(saved) {
  const out = { cy: {}, py: {}, totals: { cy: 0, py: 0 } }
  for (const p of ['cy', 'py']) {
    for (const r of DIRECTOR_LOANS_ROWS) {
      out[p][r.key] = num(saved?.[p]?.[r.key])
      out.totals[p] += out[p][r.key]
    }
  }
  return out
}

/** Lines that do not hold (a negative amount). Owner, 24 November 2026: the table is NOT checked against the
 *  Trial Balance / note figure - the amounts due need not agree with it. */
export function directorLoansIssues(saved) {
  const v = directorLoansResolve(saved)
  const issues = []
  for (const p of ['cy', 'py']) {
    const yr = p === 'cy' ? 'Current Year' : 'Previous Year'
    if (DIRECTOR_LOANS_ROWS.some(r => v[p][r.key] < 0)) issues.push(`${yr}: amounts cannot be negative.`)
  }
  return issues
}
