// Owner points of 23 November 2026 (T-075 to T-079), called by test-fsg-integration.mjs:
//   T-075 Rectification / Recategorisation shows Dr / Cr beside the amount.
//   T-076 shareholding % on upload: over every Equity class, never over 1, commas read, promoters' % change.
//   T-077 Partnership / LLP Fill Details: the P&L profit divided by each partner's share %.
//   T-078 the P&L Deferred tax line carries the Balance Sheet's Deferred tax note number, only when it has a figure.
//   T-079 Dep (Books): depreciation as per the P&L compared with the schedule's Depreciation For Year.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

export async function checkOwnerPoints({ root, userData, check }) {
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export { drCrOf } from './src/modules/fsg/components/Exceptions/index.jsx';
    export { classifyShareholders, shareTotals, shareCount, parseShareCapitalDetailsSheet } from './src/modules/fsg/components/Notes/shareCapitalDetailsWorkbook.js';
    export { splitProfitByShare, profitSplitSummary } from './src/modules/fsg/components/Notes/OwnersCapitalAccountForm.jsx';
    export { taxLineNote, deferredTaxBsNoteNum } from './src/modules/fsg/utils/deferredTaxNote.js';
    export { computeNonCorpPLLayout } from './src/modules/fsg/utils/plStructureNonCorp.js';
    export { plDepreciation } from './src/modules/fsg/components/DepreciationComp/index.jsx';
    export * as XLSX from 'xlsx-js-style';
`, resolveDir: root, loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  loader: { '.js': 'jsx' }, external: ['electron'] })
  const path = join(userData, 'owner-points.cjs'); writeFileSync(path, bundle.outputFiles[0].contents)
  const m = require(path)

  // ── T-075 Dr / Cr ─────────────────────────────────────────────────────────
  check('T-075 a debit balance (stored negative) reads Dr, a credit Cr, nil blank',
    m.drCrOf({ closing_balance: -1500 }) === 'Dr' && m.drCrOf({ closing_balance: '2500.50' }) === 'Cr' && m.drCrOf({ closing_balance: 0 }) === '')
  const exc = readFileSync(join(root, 'src/modules/fsg/components/Exceptions/index.jsx'), 'utf8')
  check('T-075 the Dr/Cr column sits right after the amount, frozen with it, and can be filtered',
    /key: 'closing_balance'[^\n]*\n\s*\{ key: 'drcr'/.test(exc) && /drcr: 424/.test(exc) && /columnFilters\.drcr && drCrOf\(r\) !== columnFilters\.drcr/.test(exc))

  // ── T-076 shareholding % ──────────────────────────────────────────────────
  const cls = (type, cyOpen, cyIssued, pyOpen) => ({ type, faceValue: 10, cy: { openingShares: cyOpen, issuedDuringYear: cyIssued }, py: { openingShares: pyOpen } })
  const classes = [cls('Equity', 60000, 20000, 60000), cls('Equity', 20000, 0, 20000), cls('Preference', 5000, 0, 5000)]
  const eq = m.shareTotals(classes, 'Equity')
  const rows = [
    [1, 'A Promoter', 'F1', 30000, 40000, 'Promoter'],
    [2, 'B Holder', '', '4,000', '6,000', 'Non-Promoter'],     // text with commas
    [3, 'C Small', '', 1000, 4000, 'Non-Promoter'],             // 1.25% / 4.00%: below 5% both years
    [4, '', '', 999, 999, 'Non-Promoter'],                       // no name: skipped
  ]
  const r = m.classifyShareholders(rows, eq)
  const a = r.all.find(x => x.name === 'A Promoter'), b = r.all.find(x => x.name === 'B Holder')
  check('T-076 % is over every Equity class (40,000 / 1,00,000 = 40.00%; last year 30,000 / 80,000 = 37.50%)', a.cyPct === '40.00' && a.pyPct === '37.50', a)
  check('T-076 shares typed as text with commas are read in full (6,000 / 1,00,000 = 6.00%)', b.cyShares === 6000 && b.cyPct === '6.00', b)
  check('T-076 the 5% list holds only those at 5% or more this year or last', r.fivePct.map(x => x.name).join('|') === 'A Promoter|B Holder', r.fivePct.map(x => x.name))
  check('T-076 promoters get % of total and the change in % holding during the year (40.00 - 37.50 = 2.50)',
    r.promoters.length === 1 && r.promoters[0].pctTotal === '40.00' && r.promoters[0].pctChange === '2.50' && r.promoters[0].pyShares === 30000, r.promoters)
  const noCls = m.classifyShareholders(rows, { cy: 0, py: 0 })
  check('T-076 with no Share Classes the divisor is the shares listed (50,000), never 1 (no 4,00,000% figures)',
    noCls.basis.cyFrom === 'listed' && noCls.basis.totalCY === 50000 && noCls.all.find(x => x.name === 'A Promoter').cyPct === '80.00', noCls.basis)
  const over = m.classifyShareholders([[1, 'X', '', 0, 150000, 'Non-Promoter']], eq)
  check('T-076 a file listing more shares than the company has is flagged', over.basis.overCY === true && r.basis.overCY === false)
  // The Fill Details workbook route gives the same answer.
  const sheet = m.XLSX.utils.aoa_to_sheet([['Note 3'], ['Share Capital'], [], ['Sl No', 'Name', 'Folio', 'PY', 'CY', 'Category'], ...rows.slice(0, 3), []])
  const wb = m.XLSX.utils.book_new(); m.XLSX.utils.book_append_sheet(wb, sheet, 'Share Capital - Details')
  const parsed = m.parseShareCapitalDetailsSheet(wb, eq.cy, eq.py)
  check('T-076 the Fill Details upload works the % the same way (40.00%, 6.00%, promoter change 2.50)',
    parsed?.data.shareholders5pctEquity.map(x => x.cyPct).join('|') === '40.00|6.00' && parsed.data.promoters[0].pctChange === '2.50', parsed?.data)
  const nb = readFileSync(join(root, 'src/modules/fsg/components/Notes/index.jsx'), 'utf8')
  check('T-076 the Fill Details upload passes the total of every Equity class', /shareTotals\(existingSc\?\.classes, 'Equity'\)/.test(nb) && !/const cls0 = existingSc\?\.classes\?\.\[0\]/.test(nb))

  // ── T-077 partners' share of profit ───────────────────────────────────────
  const partners = [{ name: 'P1', sharePct: '50' }, { name: 'P2', sharePct: '30' }, { name: 'P3', sharePct: '20' }]
  const split = m.splitProfitByShare(partners, 100000.01)
  check('T-077 the P&L profit is divided by the share % (50 / 30 / 20 of 1,00,000.01), adding up exactly',
    split[0].shareOfProfit === 50000.01 && split[1].shareOfProfit === 30000 && split[2].shareOfProfit === 20000
    && Math.round(split.reduce((t, x) => t + x.shareOfProfit, 0) * 100) === 10000001, split.map(x => x.shareOfProfit))
  check('T-077 a loss is divided the same way (-60,000 at 50 / 50)', m.splitProfitByShare([{ sharePct: 50 }, { sharePct: 50 }], -60000).every(x => x.shareOfProfit === -30000))
  const manual = m.splitProfitByShare([{ sharePct: '60', shareOfProfit: '1000', profitManual: true }, { sharePct: '40' }], 50000)
  check('T-077 a share typed over is kept; the others still follow their %', manual[0].shareOfProfit === '1000' && manual[1].shareOfProfit === 20000, manual)
  const noPct = [{ name: 'Old', sharePct: '', shareOfProfit: '777' }]
  check('T-077 a partner with no % keeps the saved figure; nothing changes (same rows back)', m.splitProfitByShare(noPct, 5000) === noPct)
  const stable = m.splitProfitByShare(split, 100000.01)
  check('T-077 working it out again changes nothing (no endless re-render)', stable === split)
  const llp = m.splitProfitByShare([{ contrib: { sharePct: '70' }, current: { sharePct: '' } }, { contrib: {}, current: { sharePct: '30' } }], 10000, true)
  check('T-077 LLP: the share goes to the Current Account, by its own % or the Contribution %', llp[0].current.shareOfProfit === 7000 && llp[1].current.shareOfProfit === 3000 && llp[0].contrib.shareOfProfit === undefined, llp)
  const sum = m.profitSplitSummary([{ sharePct: 60, shareOfProfit: 6000 }, { sharePct: 30, shareOfProfit: 3000 }], 10000)
  check('T-077 the strip shows % total 90 and 1,000 not yet divided', sum.totalPct === 90 && sum.undivided === 1000, sum)

  // ── T-078 Deferred tax note number ────────────────────────────────────────
  const notes = {
    4: { num: 4, title: 'Deferred tax liabilities (Net)', isPL: false, total: 0, prevTotal: 0 },
    6: { num: 6, title: 'Deferred tax assets (Net)', isPL: false, total: 12000, prevTotal: 9000 },
    18: { num: 18, title: 'Tax expense', isPL: true, total: 50000, prevTotal: 40000 },
  }
  const sec = { level1: 'Tax expense', noteNum: 18 }
  check('T-078 the Deferred tax line with a figure carries the Deferred tax assets note (6), as a reference',
    JSON.stringify(m.taxLineNote({ level2: 'Deferred tax', total: -3000, prevTotal: 0 }, sec, notes)) === JSON.stringify({ num: 6, ref: true }))
  check('T-078 with no figure this year or last the line keeps the Tax expense note',
    JSON.stringify(m.taxLineNote({ level2: 'Deferred tax', total: 0, prevTotal: 0 }, sec, notes)) === JSON.stringify({ num: 18, ref: false }))
  check('T-078 Current tax is untouched', m.taxLineNote({ level2: 'Current tax', total: 47000 }, sec, notes).num === 18)
  check('T-078 with no Deferred tax note in the Balance Sheet the line keeps its own note',
    m.taxLineNote({ level2: 'Deferred tax', total: 500 }, sec, { 18: notes[18] }).num === 18)
  check('T-078 a nil Deferred tax liabilities note is not chosen; the one with a figure is', m.deferredTaxBsNoteNum(notes) === 6)
  const ncData = (dtCY) => ({ notes, incomeSections: [], expenseSections: [{ level1: 'Tax expense', total: 47000 + dtCY, prevTotal: 0, noteNum: 18,
    lines: [{ level2: 'Current tax', total: 47000, prevTotal: 0 }, { level2: 'Deferred tax', total: dtCY, prevTotal: 0 }] }] })
  const dtItem = (d) => m.computeNonCorpPLLayout(d, 'Partnership Firm', []).items.find(i => /deferred tax/i.test(i.label))
  check('T-078 non-corporate P&L: the Deferred tax line shows note 6 when it has a figure, none when nil',
    dtItem(ncData(-3000)).noteNum === 6 && dtItem(ncData(-3000)).noteRef === true && !dtItem(ncData(0)).noteNum)
  const xl = readFileSync(join(root, 'src/modules/fsg/components/GenerateFinancials/buildExcel.js'), 'utf8')
  check('T-078 Excel: the Deferred tax line links to the note but takes no formula from it (its amount is the charge, not the balance)',
    /if \(!ref\) formulaCells\.push/.test(xl) && /if \(!item\.noteRef\) formulaCells\.push/.test(xl))
  const html = readFileSync(join(root, 'src/modules/fsg/components/GenerateFinancials/buildHTML.js'), 'utf8')
  const pl = readFileSync(join(root, 'src/modules/fsg/components/PL/index.jsx'), 'utf8')
  check('T-078 the P&L screen and the PDF use the same rule', /taxLineNote\(line, sec, data\.notes\)/.test(html) && /taxLineNote\(line, sec, data\?\.notes\)/.test(pl))

  // ── T-079 Dep (Books) ──────────────────────────────────────────────────────
  const dep = m.plDepreciation({ expenseSections: [
    { level1: 'Depreciation and amortization expense', total: 84500, prevTotal: 70000 },
    { level1: 'Other expenses', total: 10000, prevTotal: 0 },
    { level1: 'Uncategorised Expenses - Depreciation', total: 5, prevTotal: 0 },
  ] })
  check('T-079 depreciation as per the P&L is the depreciation head only (84,500)', dep.cy === 84500 && dep.py === 70000 && dep.found === true, dep)
  check('T-079 no depreciation head: found is false (the screen says so)', m.plDepreciation({ expenseSections: [] }).found === false)
  const dc = readFileSync(join(root, 'src/modules/fsg/components/DepreciationComp/index.jsx'), 'utf8')
  check('T-079 Dep (Books) shows the P&L depreciation, the table For Year and the difference', /const depDiffCY = num\(totals\.depForYear\) - plDep\.cy/.test(dc) && /Depreciation as per P&L/.test(dc) && (dc.match(/Depreciation as per P&L/g) || []).length === 1)
}
