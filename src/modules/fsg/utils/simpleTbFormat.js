// T-073: the simple Excel format for a Trial Balance and its masters.
//
// One workbook, two sheets, filled by hand or pasted from any accounting
// software:
//   "Trial Balance"  Ledger Name | Under Group | Opening Dr | Opening Cr |
//                    Debit | Credit | Closing Dr | Closing Cr
//   "Groups"         Group Name | Under Group | Nature
// Nature (Asset, Liability, Income or Expense) is needed only for a group at
// the top of a chain (one with no Under Group). Tally's reserved groups are
// known already, with their usual sub-groups, so a Tally user lists only the
// groups they created.
//
// The reader returns the same shapes as the Tally Excel + Master route
// (parseTallyTB rows and a ledgerMap like parseMasterJSON), so the rows are
// built by the same buildTBRowsFromTally and saved by tb:uploadTally.
import * as XLSX from 'xlsx'

export const SIMPLE_TB_SHEET = 'Trial Balance'
export const SIMPLE_GROUPS_SHEET = 'Groups'
export const SIMPLE_TB_HEADERS = ['Ledger Name', 'Under Group', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr']
export const SIMPLE_GROUP_HEADERS = ['Group Name', 'Under Group', 'Nature']
export const NATURES = ['Asset', 'Liability', 'Income', 'Expense']

// Tally's reserved primary groups and their nature.
export const TALLY_PRIMARY_GROUPS = {
  'Capital Account': 'Liability',
  'Loans (Liability)': 'Liability',
  'Current Liabilities': 'Liability',
  'Branch / Divisions': 'Liability',
  'Suspense A/c': 'Liability',
  'Fixed Assets': 'Asset',
  'Investments': 'Asset',
  'Current Assets': 'Asset',
  'Misc. Expenses (ASSET)': 'Asset',
  'Sales Accounts': 'Income',
  'Direct Incomes': 'Income',
  'Indirect Incomes': 'Income',
  'Purchase Accounts': 'Expense',
  'Direct Expenses': 'Expense',
  'Indirect Expenses': 'Expense',
}
// Tally's reserved sub-groups and the group each sits under.
export const TALLY_SUB_GROUPS = {
  'Reserves & Surplus': 'Capital Account',
  'Bank OD A/c': 'Loans (Liability)',
  'Secured Loans': 'Loans (Liability)',
  'Unsecured Loans': 'Loans (Liability)',
  'Duties & Taxes': 'Current Liabilities',
  'Provisions': 'Current Liabilities',
  'Sundry Creditors': 'Current Liabilities',
  'Bank Accounts': 'Current Assets',
  'Cash-in-Hand': 'Current Assets',
  'Deposits (Asset)': 'Current Assets',
  'Loans & Advances (Asset)': 'Current Assets',
  'Stock-in-Hand': 'Current Assets',
  'Sundry Debtors': 'Current Assets',
}

const key = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const text = (v) => String(v ?? '').trim().replace(/\s+/g, ' ')

/** An amount cell: a number, or text such as "1,25,000.50", "(500)" or "500 Cr". */
export function simpleAmount(v) {
  if (v === null || v === undefined || v === '') return { value: 0, ok: true }
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, ok: true } : { value: 0, ok: false }
  const raw = String(v).trim()
  if (!raw || raw === '-') return { value: 0, ok: true }
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw)
  const n = Number(raw.replace(/[₹,\s()]/g, '').replace(/^-/, '').replace(/(dr|cr)$/i, ''))
  if (!Number.isFinite(n)) return { value: 0, ok: false }
  return { value: negative ? -n : n, ok: true }
}

// Rows of a sheet as arrays, starting at the header row found by its first heading.
function sheetRows(wb, name, firstHeading) {
  const sheetName = wb.SheetNames.find(n => key(n) === key(name))
  if (!sheetName) return null
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true })
  const h = aoa.findIndex(r => (r || []).some(c => key(c) === key(firstHeading)))
  if (h < 0) return { header: null, rows: [] }
  const header = aoa[h].map(c => key(c))
  return { header, rows: aoa.slice(h + 1), headerRow: h + 1 }
}

/**
 * Reads the workbook. Returns { rows, ledgerMap, ledgerCount, groupCount,
 * errors, warnings, totals }. `errors` stop the upload; `warnings` are shown.
 */
export function parseSimpleTbWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: buffer instanceof ArrayBuffer ? 'array' : 'buffer' })
  const errors = [], warnings = []
  const tb = sheetRows(wb, SIMPLE_TB_SHEET, 'Ledger Name')
  if (!tb) return fail(`The workbook has no "${SIMPLE_TB_SHEET}" sheet. Use the format from "Download Template".`)
  if (!tb.header) return fail(`The "${SIMPLE_TB_SHEET}" sheet has no "Ledger Name" heading. Use the format from "Download Template".`)
  const col = (h) => tb.header.indexOf(key(h))
  const missingCols = SIMPLE_TB_HEADERS.filter(h => col(h) < 0)
  if (missingCols.length) return fail(`The "${SIMPLE_TB_SHEET}" sheet is missing the column${missingCols.length > 1 ? 's' : ''}: ${missingCols.join(', ')}.`)

  // ── Groups: the sheet, then Tally's reserved groups for anything not listed
  const parentOf = new Map(), natureOf = new Map(), display = new Map()
  for (const [g, p] of Object.entries(TALLY_SUB_GROUPS)) { parentOf.set(key(g), key(p)); display.set(key(g), g) }
  for (const [g, n] of Object.entries(TALLY_PRIMARY_GROUPS)) { natureOf.set(key(g), n); display.set(key(g), g) }
  const grp = sheetRows(wb, SIMPLE_GROUPS_SHEET, 'Group Name')
  let groupCount = 0
  if (grp?.header) {
    const gName = grp.header.indexOf(key('Group Name')), gUnder = grp.header.indexOf(key('Under Group')), gNature = grp.header.indexOf(key('Nature'))
    grp.rows.forEach((r, i) => {
      const name = text(r?.[gName])
      if (!name) return
      const under = gUnder >= 0 ? text(r?.[gUnder]) : ''
      const natureRaw = gNature >= 0 ? text(r?.[gNature]) : ''
      const nature = NATURES.find(n => key(n) === key(natureRaw))
      if (natureRaw && !nature) errors.push(`Groups row ${grp.headerRow + i + 1}: Nature "${natureRaw}" must be Asset, Liability, Income or Expense.`)
      if (key(under) === key(name)) { errors.push(`Groups row ${grp.headerRow + i + 1}: "${name}" cannot be under itself.`); return }
      groupCount++
      display.set(key(name), name)
      if (under) parentOf.set(key(name), key(under)); else parentOf.delete(key(name))
      if (nature) natureOf.set(key(name), nature)
      if (under && !display.has(key(under))) display.set(key(under), under)
    })
  } else {
    warnings.push(`No "${SIMPLE_GROUPS_SHEET}" sheet: only Tally's standard groups are known.`)
  }

  // The chain above a group, nearest first, and the nature found on the way.
  const chainOf = (g) => {
    const chain = [], seen = new Set()
    let cur = key(g), nature = null
    while (cur) {
      if (seen.has(cur)) return { chain, nature, loop: true }
      seen.add(cur)
      chain.push(display.get(cur) || cur)
      if (!nature && natureOf.has(cur)) nature = natureOf.get(cur)
      cur = parentOf.get(cur) || null
    }
    return { chain, nature, loop: false }
  }

  // ── Ledgers
  const rows = [], ledgerMap = {}, seenLedgers = new Map(), noGroup = [], noNature = new Set(), badAmounts = [], notAgreeing = []
  const totals = { openingNet: 0, closingNet: 0, debit: 0, credit: 0 }
  tb.rows.forEach((r, i) => {
    const rowNo = tb.headerRow + i + 1
    const name = text(r?.[col('Ledger Name')])
    if (!name || /^(grand\s+)?total$/i.test(name)) return
    if (seenLedgers.has(key(name))) { errors.push(`Trial Balance row ${rowNo}: ledger "${name}" is already on row ${seenLedgers.get(key(name))}. Each ledger once.`); return }
    seenLedgers.set(key(name), rowNo)
    const under = text(r?.[col('Under Group')])
    const amt = {}
    for (const h of ['Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr']) {
      const a = simpleAmount(r?.[col(h)])
      if (!a.ok) badAmounts.push(`row ${rowNo} ${h}`)
      amt[h] = a.value
    }
    // A negative figure in a Dr column is a credit, and the other way round.
    const opening = amt['Opening Dr'] - amt['Opening Cr']
    const debit = Math.abs(amt.Debit), credit = Math.abs(amt.Credit)
    const closingGiven = amt['Closing Dr'] !== 0 || amt['Closing Cr'] !== 0
    const worked = opening + debit - credit
    const closing = closingGiven ? amt['Closing Dr'] - amt['Closing Cr'] : worked
    if (closingGiven && Math.abs(closing - worked) >= 1) notAgreeing.push(name)

    if (!under) noGroup.push(`row ${rowNo} (${name})`)
    if (under && !display.has(key(under))) display.set(key(under), under)   // shown as typed
    const { chain, nature, loop } = under ? chainOf(under) : { chain: [], nature: null, loop: false }
    if (loop) errors.push(`The groups above "${under}" go round in a circle. Check "Under Group" on the Groups sheet.`)
    else if (under && !nature) noNature.add(chain[chain.length - 1] || under)

    rows.push({
      name,
      opening_dr: opening > 0 ? opening : 0, opening_cr: opening < 0 ? -opening : 0,
      debit, credit,
      closing_dr: closing > 0 ? closing : 0, closing_cr: closing < 0 ? -closing : 0,
    })
    ledgerMap[key(name)] = {
      name, parent: chain[0] || '', hierarchy: chain,
      isDeemedPositive: nature ? (nature === 'Asset' || nature === 'Expense') : null,
      isRevenue: nature ? (nature === 'Income' || nature === 'Expense') : null,
    }
    totals.openingNet += opening; totals.closingNet += closing; totals.debit += debit; totals.credit += credit
  })

  if (!rows.length) errors.push(`The "${SIMPLE_TB_SHEET}" sheet has no ledgers below its headings.`)
  if (noGroup.length) errors.push(`Every ledger needs an "Under Group". Missing on: ${listOf(noGroup)}.`)
  if (noNature.size) errors.push(`The nature of ${listOf([...noNature].map(g => `"${g}"`))} is not known. On the Groups sheet, give ${noNature.size === 1 ? 'this top group' : 'each of these top groups'} a Nature (Asset, Liability, Income or Expense), or put it under a group that has one.`)
  if (badAmounts.length) errors.push(`These cells are not amounts: ${listOf(badAmounts)}.`)
  if (notAgreeing.length) warnings.push(`For ${notAgreeing.length} ledger${notAgreeing.length > 1 ? 's' : ''}, opening + debit − credit does not equal the closing balance: ${listOf(notAgreeing)}. The closing balance is used as given.`)
  if (Math.abs(totals.closingNet) >= 1) warnings.push(`The closing balances do not tally: Dr and Cr differ by ${fmt(Math.abs(totals.closingNet))}.`)
  if (Math.abs(totals.openingNet) >= 1) warnings.push(`The opening balances do not tally: Dr and Cr differ by ${fmt(Math.abs(totals.openingNet))} (often the opening stock).`)
  return { rows, ledgerMap, ledgerCount: rows.length, groupCount, errors, warnings, totals }

  function fail(msg) { return { rows: [], ledgerMap: {}, ledgerCount: 0, groupCount: 0, errors: [msg], warnings: [], totals: null } }
}

function listOf(items, max = 8) {
  return items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', ')
}
function fmt(n) { return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

/** The blank format: headings, and the Groups sheet pre-filled with Tally's standard groups. */
export function buildSimpleTbTemplate() {
  const wb = XLSX.utils.book_new()
  const tbWs = XLSX.utils.aoa_to_sheet([SIMPLE_TB_HEADERS])
  XLSX.utils.book_append_sheet(wb, tbWs, SIMPLE_TB_SHEET)
  const groups = [
    SIMPLE_GROUP_HEADERS,
    ...Object.entries(TALLY_PRIMARY_GROUPS).map(([g, n]) => [g, '', n]),
    ...Object.entries(TALLY_SUB_GROUPS).map(([g, p]) => [g, p, '']),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(groups), SIMPLE_GROUPS_SHEET)
  return wb
}

/** How utils/veraExcel.js finishes the blank format (VERA style, How to Fill, Nature dropdown). */
export function simpleTbTemplateSpec() {
  const rows = 500
  return {
    mode: 'template',
    sheets: {
      [SIMPLE_TB_SHEET]: {
        headerRow: 1, minRows: rows, inputCols: 'ABCDEFGH'.split(''), amountCols: ['C', 'D', 'E', 'F', 'G', 'H'],
        widths: [40, 30, 16, 16, 16, 16, 16, 16], autoFilter: false,
      },
      [SIMPLE_GROUPS_SHEET]: {
        headerRow: 1, minRows: 200, inputCols: ['A', 'B', 'C'], widths: [34, 30, 14], autoFilter: false,
        dropdowns: [{ col: 'C', fromRow: 2, toRow: 201, list: NATURES, name: 'Nature', prompt: 'Only for a top group (no Under Group): Asset, Liability, Income or Expense.' }],
      },
    },
    howTo: {
      title: 'Trial Balance and Masters — simple format',
      purpose: 'Enter a Trial Balance and its groups in one workbook, from any accounting software, and upload it on VERA\'s Upload TB screen.',
      steps: [
        'On the "Trial Balance" sheet, enter one ledger per row: its name, the group it is under, and its figures.',
        'Put each amount in its Dr or Cr column, in rupees without symbols (for example 125000.50). Leave the other column blank.',
        'Closing Dr / Cr may be left blank: VERA then works it out as opening + debit − credit.',
        'On the "Groups" sheet, Tally\'s standard groups are already listed. Add every group you created, with the group it is under.',
        'Give a Nature only to a group at the top (no Under Group): Asset, Liability, Income or Expense.',
        'Save the file, then on VERA\'s TB > Upload TB screen click "Upload Trial Balance", choose "Simple Excel Format" and pick it.',
      ],
      columns: [
        ['Ledger Name', 'The ledger as in the books. Each ledger once.', 'Text — required'],
        ['Under Group (Trial Balance)', 'The group the ledger is under, exactly as on the Groups sheet.', 'Text — required'],
        ['Opening Dr / Opening Cr', 'The balance at the start of the period, on its side.', 'Amount'],
        ['Debit / Credit', 'The period\'s total debits and credits.', 'Amount'],
        ['Closing Dr / Closing Cr', 'The balance at the end of the period. Optional.', 'Amount'],
        ['Group Name / Under Group (Groups)', 'Each group and the group above it. VERA builds the chain to the top group.', 'Text'],
        ['Nature', 'For a top group only: Asset, Liability, Income or Expense.', 'Dropdown'],
      ],
      tips: [
        'Do not rename the sheets or the column headings; VERA reads the file by them.',
        'VERA checks that the Trial Balance tallies and tells you before the upload if it does not.',
      ],
    },
  }
}
