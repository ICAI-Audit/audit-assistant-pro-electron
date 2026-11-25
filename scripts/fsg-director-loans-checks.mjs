// T-086 checks, called by test-fsg-integration.mjs: Long-term / Short-term loans and advances (Company) carry the
// "Loans and advances due from directors, officers and entities in which directors are interested" table - nil
// until entered, saved under note_details.directorLoans, round-tripped by the Fill Details Excel.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

export async function checkDirectorLoans({ root, userData, check }) {
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export * from './src/modules/fsg/utils/directorLoans.js';
    export { FILL_DETAILS_REGISTRY } from './src/modules/fsg/utils/fillDetailsRegistry.js';
    export { attachNoteExtras } from './src/modules/fsg/hooks/useFinancials.js';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', loader: { '.js': 'jsx' } })
  const path = join(userData, 'director-loans.cjs'); writeFileSync(path, bundle.outputFiles[0].contents)
  const { DIRECTOR_LOANS_ROWS, hasDirectorLoans, directorLoansResolve, directorLoansIssues, FILL_DETAILS_REGISTRY, attachNoteExtras } = require(path)

  check('T-086 the table has the four Schedule III lines', DIRECTOR_LOANS_ROWS.map(r => r.label).join('|') ===
    'Directors of the Company, severally or jointly with any other person|Other officers of the Company, severally or jointly with any other person|Firms in which any director is a partner|Private companies in which any director is a director or a member')
  check('T-086 it applies to Long-term and Short-term loans and advances of a Company only',
    hasDirectorLoans(3, 'Long-term loans and advances') && hasDirectorLoans(3, 'Short-term Loans and Advances') && hasDirectorLoans('3', 'Short term loans & advances')
    && !hasDirectorLoans(1, 'Long-term loans and advances') && !hasDirectorLoans(2, 'Short-term loans and advances')
    && !hasDirectorLoans(3, 'Long-term borrowings') && !hasDirectorLoans(3, 'Loans and advances from related parties'))
  const nil = directorLoansResolve(null)
  check('T-086 nothing saved: every line and the total are nil', nil.totals.cy === 0 && nil.totals.py === 0 && Object.values(nil.cy).every(v => v === 0))
  const saved = { cy: { directors: '25,000', officers: 5000 }, py: { firms: 12000 } }
  const v = directorLoansResolve(saved)
  check('T-086 totals add the lines (CY 30,000, PY 12,000)', v.totals.cy === 30000 && v.totals.py === 12000, v.totals)
  check('T-086 no check against the Trial Balance: any total is accepted, only a negative amount is warned',
    directorLoansIssues({ cy: { directors: 99999999 } }).length === 0 && directorLoansIssues({ py: { firms: -1 } }).length === 1, directorLoansIssues({ cy: { directors: 99999999 } }))

  // The note carries the table for a Company (saved figures or nil), not for a Partnership.
  const notes = () => ({ notes: { a: { num: 7, title: 'Long-term loans and advances', isPL: false, lines: [], rows: [], total: 100000, prevTotal: 80000 },
    b: { num: 12, title: 'Short-term loans and advances', isPL: false, lines: [], rows: [], total: 50000, prevTotal: 0 } } })
  const company = notes()
  attachNoteExtras(company, [{ note_num: 7, note_title: 'Long-term loans and advances', data: JSON.stringify({ directorLoans: saved }) }], [], null, 3)
  check('T-086 a Company note carries the saved figures, and a note with nothing saved shows the nil table',
    company.notes.a.directorLoans?.saved?.cy?.officers === 5000 && !!company.notes.b.directorLoans && company.notes.b.directorLoans.saved === null, company.notes.a.directorLoans)
  const firm = notes()
  attachNoteExtras(firm, [{ note_num: 7, note_title: 'Long-term loans and advances', data: JSON.stringify({ directorLoans: saved }) }], [], null, 1)
  check('T-086 a Partnership does not show the table', !firm.notes.a.directorLoans && !firm.notes.b.directorLoans)

  // Fill Details Excel: one sheet each for Long and Short, rows matched back by label.
  const lt = FILL_DETAILS_REGISTRY.find(e => e.match('long-term loans and advances', 3))
  const st = FILL_DETAILS_REGISTRY.find(e => e.match('short-term loans and advances', 3))
  const none = FILL_DETAILS_REGISTRY.find(e => e.match('long-term loans and advances', 1))
  check('T-086 Fill Details Excel has a sheet for each note (Company only)', !!lt && !!st && lt !== st && lt.sheetName.length <= 31 && st.sheetName.length <= 31 && !none, [lt?.sheetName, st?.sheetName, none?.key])
  const rows = lt ? lt.toRows({ directorLoans: saved }) : []
  const back = lt ? lt.fromRows(rows) : {}
  check('T-086 the Excel sheet round-trips the figures', back.directorLoans?.cy?.directors === 25000 && back.directorLoans?.py?.firms === 12000 && back.directorLoans?.cy?.pvtCos === 0, back)
  check('T-086 a sheet with none of the four lines changes nothing', lt && Object.keys(lt.fromRows([['Something else', 1, 2]])).length === 0)
}
