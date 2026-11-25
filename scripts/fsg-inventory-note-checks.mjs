// T-061 synthetic checks, called by test-fsg-integration.mjs: Raw Materials stock is always adjusted in
// "Cost of materials consumed" (never in "Changes in inventories of finished goods, WIP and Stock-in-Trade"),
// also when the entity has no purchase ledger mapped there; ledgers mapped to "Changes in inventories" that are
// not Opening / Closing Stock are labelled as such, flagged for review and still counted.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

export async function checkInventoryNote({ db, root, userData, check, staff, entityId, periodId, defaultRs }) {
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export { processRows, STOCK_OTHER_LEDGERS_LABEL } from './src/modules/fsg/hooks/useFinancials.js';
    export { plNoteLines, plNoteTotalLabel } from './src/modules/fsg/utils/annexureGrouping.js';
    export { notesFixTargets, plLineFix } from './src/modules/fsg/utils/notesFixQueue.js';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const path = join(userData, 'inventory-note.cjs'); writeFileSync(path, bundle.outputFiles[0].contents)
  const { processRows, STOCK_OTHER_LEDGERS_LABEL, plNoteLines, plNoteTotalLabel, notesFixTargets, plLineFix } = require(path)

  // A manufacturer with no purchase ledger: nothing maps to "Cost of materials consumed".
  const ledger = (name, closing, parent) => ({ period: '2024-25', branch: '', ledger_code: '', name, opening_balance: 0,
    debit: closing < 0 ? -closing : 0, credit: closing > 0 ? closing : 0, closing_balance: closing, parent, group_parent: parent })
  const up = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 't052.xlsx', tbRows: [
    ledger('Inv Capital', 100000, 'Capital Account'), ledger('Inv Bank', -100000, 'Bank Accounts'),
  ] })
  check('T-061 synthetic Trial Balance for the inventory checks', up.ok, up)
  if (!up.ok) return
  const tbId = up.result.tb.id
  await staff('mappedTB:run', tbId, defaultRs, {})
  const saved = await staff('tb:saveStock', { tbId, stockData: {
    opening: { 'Raw Materials': 40000, 'Finished Goods': 25000 },
    closing: { 'Raw Materials': 30000, 'Finished Goods': 35000 },
  } })
  check('T-061 Raw Materials and Finished Goods stock saved through the Stock tab', saved.ok, saved)
  const lf = db.prepare('SELECT * FROM level_format WHERE rule_set_id=? AND constitution=3').all(defaultRs)
  const source = (await staff('financials:getData', tbId)).result
  let p = processRows(source, null, 3, [], 'Manufacturer', false, false, null, lf)
  const find = (rx) => p.expenseSections.find(s => rx.test(s.level1 || ''))
  const notesOf = (rx) => Object.values(p.notes).find(n => rx.test(n.title || ''))
  const materials = find(/^cost of materials consumed/i)
  const changes = find(/changes in inventor/i)
  check('T-061 with no purchase ledger, Raw Materials go to a new "Cost of materials consumed" (Opening 40,000 - Closing 30,000 = 10,000)',
    !!materials && Math.abs(materials.total - 10000) < 0.01 && !!notesOf(/^cost of materials consumed/i), materials && { total: materials.total, lines: materials.lines.map(l => [l.level2, l.total]) })
  check('T-061 "Changes in inventories" holds only Finished Goods / WIP / Stock-in-Trade (25,000 - 35,000 = -10,000)',
    !!changes && Math.abs(changes.total + 10000) < 0.01, changes && { total: changes.total, lines: changes.lines.map(l => [l.level2, l.total]) })
  check('T-061 its captions no longer name Raw Materials', !!changes && changes.lines.every(l => !/raw material/i.test(l.level2 || '')), changes && changes.lines.map(l => l.level2))
  const rmLines = materials ? materials.lines.map(l => l.level2) : []
  check('T-061 the Raw Materials lines sit in "Cost of materials consumed"', rmLines.includes('Opening Stock of Raw Materials') && rmLines.includes('Less: Closing Stock of Raw Materials'), rmLines)
  check('T-061 profit is unchanged by the move: total expenses carry the whole stock movement once', Math.abs(p.totalExpenses - (10000 - 10000)) < 0.01, p.totalExpenses)

  // A ledger of the Trial Balance mapped to "Changes in inventories" that is neither Opening nor Closing Stock.
  const changesTitle = changes ? changes.level1 : 'Changes in inventories of finished goods, WIP and Stock-in-Trade'
  const stray = { ...source.find(r => r.alie === 'Expenses') || {}, id: 999901, tb_row_id: 999901, name: 'Stock adjustment', alie: 'Expenses',
    level1: changesTitle, mapping1_resultant: changesTitle, level2: 'Stock adjustment', mapping2_resultant: 'Stock adjustment', level3: '', mapping3_resultant: '',
    level5_value: '', upload_nature: null, closing_balance: -1500, opening_balance: 0, is_deemed_positive: true, status: 'auto_high' }
  p = processRows([...source, stray], null, 3, [], 'Manufacturer', false, false, null, lf)
  const ch2 = p.expenseSections.find(s => /changes in inventor/i.test(s.level1 || ''))
  const other = ch2 && ch2.lines.find(l => l.level2 === STOCK_OTHER_LEDGERS_LABEL)
  check('T-061 such a ledger is shown as "Add / (Less): Other ledgers mapped to this head", flagged for review, not as "Net Change in Inventory"',
    !!other && other.needsReview === true && /Stock tab/.test(other.reviewNote || '') && !ch2.lines.some(l => /^net change in inventory$/i.test(l.level2 || '')), ch2 && ch2.lines.map(l => [l.level2, l.total, l.needsReview]))
  check('T-061 it is still counted in the head (no ledger is dropped): -10,000 + 1,500 = -8,500', !!ch2 && Math.abs(ch2.total + 8500) < 0.01, ch2 && ch2.total)

  // T-081 (owner, 23 November 2026): Cost of materials consumed prints as the working - Opening Stock of Raw Materials,
  // Add: Purchases, Less: Closing Stock of Raw Materials, and the total captioned "Cost of materials consumed".
  const purchase = { ...stray, id: 999902, tb_row_id: 999902, name: 'Purchase of raw material', level1: 'Cost of materials consumed',
    mapping1_resultant: 'Cost of materials consumed', level2: 'Purchases', mapping2_resultant: 'Purchases', closing_balance: -100000 }
  p = processRows([...source, purchase], null, 3, [], 'Manufacturer', false, false, null, lf)
  const cmc = Object.values(p.notes).find(n => /^cost of materials consumed/i.test(n.title || ''))
  const printed = cmc ? plNoteLines(cmc) : []
  check('T-081 Cost of materials consumed reads Opening Stock, Add: Purchases, Less: Closing Stock, in that order',
    printed.map(x => x.display).join(' | ') === 'Opening Stock of Raw Materials | Add: Purchases | Less: Closing Stock of Raw Materials', printed.map(x => x.display))
  check('T-081 the line keeps its own label underneath (remarks, Manual PY and Annexure still find "Purchases")', printed[1]?.label === 'Purchases', printed.map(x => x.label))
  check('T-081 the total is captioned "Cost of materials consumed" and is unchanged (40,000 + 1,00,000 - 30,000 = 1,10,000)',
    !!cmc && plNoteTotalLabel(cmc) === 'Cost of materials consumed' && Math.abs(cmc.total - 110000) < 0.01, cmc && { total: cmc.total, label: plNoteTotalLabel(cmc) })
  const other2 = Object.values(p.notes).find(n => n.isPL && !/^cost of materials consumed/i.test(n.title || ''))
  check('T-081 other P&L notes keep "Total" and their own labels', !other2 || (plNoteTotalLabel(other2) === 'Total' && plNoteLines(other2).every(x => x.display === x.label)))

  // T-083 (owner, 24 November 2026): Recategorisation lists every ledger Notes shows Fix / Review for, from the same test,
  // and a ledger confirmed there (saved or approved) is not asked about again.
  const strayM = { ...stray, mapped_id: 999901, status: 'auto_high' }
  p = processRows([...source, strayM], null, 3, [], 'Manufacturer', false, false, null, lf)
  const chNote = Object.values(p.notes).find(n => /changes in inventor/i.test(n.title || ''))
  const reviewLine = chNote && chNote.lines.find(l => l.level2 === STOCK_OTHER_LEDGERS_LABEL)
  let targets = notesFixTargets(p)
  check('T-083 the Review line on Notes and the Recategorisation list come from one test (the ledger is on the list)',
    !!reviewLine && plLineFix(chNote, reviewLine) === 'Review' && targets.cy.includes(999901), { fix: reviewLine && plLineFix(chNote, reviewLine), cy: targets.cy })
  p = processRows([...source, { ...strayM, status: 'user_override' }], null, 3, [], 'Manufacturer', false, false, null, lf)
  const chNote2 = Object.values(p.notes).find(n => /changes in inventor/i.test(n.title || ''))
  const confirmed = chNote2 && chNote2.lines.find(l => l.level2 === STOCK_OTHER_LEDGERS_LABEL)
  targets = notesFixTargets(p)
  check('T-083 once saved on Recategorisation the line is not flagged and nothing is left on the list for it',
    !!confirmed && !confirmed.needsReview && plLineFix(chNote2, confirmed) === null && !targets.cy.includes(999901), { needsReview: confirmed && confirmed.needsReview, cy: targets.cy })
  check('T-083 the ledger is still counted in the head after it is confirmed (-10,000 + 1,500 = -8,500)', !!chNote2 && Math.abs(chNote2.total + 8500) < 0.01, chNote2 && chNote2.total)
  const uncatSale = { ...strayM, id: 999903, tb_row_id: 999903, mapped_id: 999903, name: 'Sales misc', alie: 'Income', level1: 'Revenue from operations',
    mapping1_resultant: 'Revenue from operations', level2: 'Sale', mapping2_resultant: 'Sale', level3: 'Uncategorised Sale', mapping3_resultant: 'Uncategorised Sale',
    closing_balance: 5000, is_deemed_positive: false, status: 'user_override' }
  p = processRows([...source, uncatSale], null, 3, [], 'Manufacturer', false, false, null, lf)
  targets = notesFixTargets(p)
  check('T-083 a sale not split into Goods / Services is on the list even when its status says it was saved', targets.cy.includes(999903) && targets.items.some(i => i.what === 'Bifurcate'), targets.items)
}

// T-053: shareholding % in Share Capital Fill Details.
export async function checkShareholding({ root, userData, check }) {
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export { withShareholdingPercent, shareTotals } from './src/modules/fsg/components/Notes/ShareCapitalForm.jsx';
`, resolveDir: root, loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', loader: { '.js': 'jsx' } })
  const path = join(userData, 'share-capital-form.cjs'); writeFileSync(path, bundle.outputFiles[0].contents)
  const { withShareholdingPercent, shareTotals } = require(path)
  const cls = (name, type, cyOpen, cyIssued, pyOpen, paidUpCY = '') => ({ name, type, faceValue: 10,
    cy: { openingShares: cyOpen, issuedDuringYear: cyIssued, deletedDuringYear: '', paidUp: paidUpCY },
    py: { openingShares: pyOpen, issuedDuringYear: '', deletedDuringYear: '', paidUp: '' } })
  const data = {
    classes: [cls('Equity A', 'Equity', 60000, 20000, 60000), cls('Equity B', 'Equity', 20000, 0, 20000), cls('8% Preference', 'Preference', 5000, 0, 5000)],
    shareholders5pctEquity: [{ name: 'Holder 1', cyShares: 25000, cyPct: '25.00', pyShares: 20000, pyPct: '' }],
    shareholders5pctPreference: [{ name: 'Pref holder', cyShares: 1000, cyPct: '1.00', pyShares: 1000, pyPct: '1.00' }],
    promoters: [{ name: 'Promoter', class: 'Equity', shares: 10000, pctTotal: '', pctChange: '' }],
  }
  const eq = shareTotals(data.classes, 'Equity')
  check('T-053 the Equity total adds every Equity class (80,000 + 20,000 = 1,00,000 at the year end; 80,000 last year)', eq.cy === 100000 && eq.py === 80000, eq)
  const out = withShareholdingPercent(data)
  check('T-053 an Equity holder % uses all Equity classes: 25,000 / 1,00,000 = 25.00%, last year 20,000 / 80,000 = 25.00%',
    out.shareholders5pctEquity[0].cyPct === '25.00' && out.shareholders5pctEquity[0].pyPct === '25.00', out.shareholders5pctEquity[0])
  check('T-053 a Preference holder % is over the Preference total (1,000 / 5,000 = 20.00%), not the Equity total',
    out.shareholders5pctPreference[0].cyPct === '20.00' && out.shareholders5pctPreference[0].pyPct === '20.00', out.shareholders5pctPreference[0])
  check('T-053 a promoter % of total is calculated from the shares (10,000 / 1,00,000 = 10.00%)', out.promoters[0].pctTotal === '10.00', out.promoters[0])
  const edited = withShareholdingPercent({ ...out, shareholders5pctEquity: [{ ...out.shareholders5pctEquity[0], cyShares: 40000 }] })
  check('T-053 changing a holder shares changes the % at once (40,000 / 1,00,000 = 40.00%)', edited.shareholders5pctEquity[0].cyPct === '40.00', edited.shareholders5pctEquity[0])
  const blank = withShareholdingPercent({ ...data, classes: [] })
  check('T-053 with no share classes filled the % is left blank, not a wrong figure', blank.shareholders5pctEquity[0].cyPct === '', blank.shareholders5pctEquity[0])
}

// T-058: the opening line of Reserves and Surplus reads "Opening Surplus / (Deficit)"; the Closing line still works.
export async function checkOpeningSurplusLabel({ db, root, userData, check, staff, entityId, periodId, defaultRs }) {
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export { processRows, attachNoteExtras, OPENING_SURPLUS_LABEL } from './src/modules/fsg/hooks/useFinancials.js';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const path = join(userData, 'opening-surplus.cjs'); writeFileSync(path, bundle.outputFiles[0].contents)
  const { processRows, attachNoteExtras, OPENING_SURPLUS_LABEL } = require(path)
  const ledger = (name, closing, opening, parent) => ({ period: '2024-25', branch: '', ledger_code: '', name, opening_balance: opening,
    debit: closing < 0 ? -closing : 0, credit: closing > 0 ? closing : 0, closing_balance: closing, parent, group_parent: parent })
  const up = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 't058.xlsx', tbRows: [
    ledger('Os Share Capital', 100000, 100000, 'Capital Account'), ledger('Profit & Loss A/c', 50000, 50000, 'Reserves & Surplus'),
    ledger('Os Bank', -150000, -150000, 'Bank Accounts'),
  ] })
  check('T-058 synthetic Trial Balance with an opening Profit & Loss ledger', up.ok, up)
  if (!up.ok) return
  await staff('mappedTB:run', up.result.tb.id, defaultRs, {})
  const lf = db.prepare('SELECT * FROM level_format WHERE rule_set_id=? AND constitution=3').all(defaultRs)
  const source = (await staff('financials:getData', up.result.tb.id)).result
  const p = processRows(source, null, 3, [], null, false, false, null, lf)
  attachNoteExtras(p, [], lf, null, 3)
  const note = Object.values(p.notes).find(n => /reserves?\s*(and|&)\s*surplus/i.test(n.title || ''))
  const rows = (note && (note.templateRowsAll || note.templateRows)) || []
  const opening = rows.find(r => /^opening profit\s*&?\s*loss$/i.test(r.label || ''))
  check('T-058 the opening line shows "Opening Surplus / (Deficit)" (its Mapping 3 stays "Opening Profit & Loss")',
    !!opening && opening.displayLabel === OPENING_SURPLUS_LABEL && OPENING_SURPLUS_LABEL === 'Opening Surplus / (Deficit)', rows.map(r => [r.label, r.displayLabel, r.cy]))
  check('T-058 the opening figure is unchanged (50,000)', !!opening && Math.abs(opening.cy - 50000) < 0.01, opening)
  check('T-058 the Closing line is still worked out', rows.some(r => /^closing profit/i.test(r.label || '')), rows.map(r => r.label))
}


// T-062: a specific Tally group rule beats the "Indirect Expenses" fallback; a real Level 2 tie is filed as
// "Uncategorised Other expenses" (still a Conflict, with its options) instead of a line with no caption.
export async function checkConflictFallback({ db, check, staff, entityId, periodId, defaultRs }) {
  const ledger = (name, closing, parent, group_parent) => ({ period: '2024-25', branch: '', ledger_code: '', name, opening_balance: 0,
    debit: closing < 0 ? -closing : 0, credit: closing > 0 ? closing : 0, closing_balance: closing, parent, group_parent })
  const up = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 't062.xlsx', tbRows: [
    ledger('BHARAT SEVASHRAM, BALLYGUNGE', -134200, 'Donation', 'Indirect Expenses'),
    ledger('RESCUE & RELIEF', -200000, 'Donation & Subscription', 'Indirect Expenses'),
    ledger('T062 Capital', 334200, 'Capital Account', 'Capital Account'),
  ] })
  check('T-062 synthetic Trial Balance with expense ledgers under specific groups', up.ok, up)
  if (!up.ok) return
  await staff('mappedTB:run', up.result.tb.id, defaultRs, {})
  const rows = db.prepare(`SELECT tr.name, mt.status, mt.mapping1_resultant m1, mt.mapping2_resultant m2, mt.conflict_candidates cc
    FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = ?`).all(up.result.tb.id)
  const of = (rx) => rows.find(r => rx.test(r.name))
  const bharat = of(/^BHARAT/), rescue = of(/^RESCUE/)
  check('T-062 a ledger under "Donation" inside "Indirect Expenses" maps to Donations, not Conflict',
    !!bharat && bharat.status !== 'conflict' && /^Donations/i.test(bharat.m2 || ''), bharat)
  check('T-062 a ledger whose group matches two Level 2 rules stays a Conflict but is filed as "Uncategorised Other expenses", with its options',
    !!rescue && rescue.status === 'conflict' && /^Uncategorised Other expenses$/i.test(rescue.m2 || '') && /Donations/.test(rescue.cc || '') && /Subscription/.test(rescue.cc || ''), rescue)
}
