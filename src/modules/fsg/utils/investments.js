// Schedule III Division I, Part I, notes 6(K) and 6(N). Disclosure data never changes TB balances.
export const investmentKind = title => /^(non[ -]?current|long[ -]?term) investments?$/i.test(String(title).trim()) ? 'noncurrent'
  : /^(current|short[ -]?term) investments?$/i.test(String(title).trim()) ? 'current' : null
export const INVESTMENT_CATEGORIES = ['Shares', 'Preference shares', 'Debentures', 'Bonds', 'Government or trust securities', 'Mutual fund units', 'Investment property', 'Partnership firm', 'LLP', 'Share application money', 'Other']
export const INVESTMENT_RELATIONSHIPS = ['Holding', 'Subsidiary', 'Associate', 'Joint Venture', 'Controlled special purpose entity', 'None']
export const investmentLedgerKey = r => `${r.tb_id}:${r.tb_row_id}`
export const investmentSubclass = r => String(r.level3 || r.mapping3_resultant || 'Unclassified investments').trim()
const n = v => v === '' || v == null ? 0 : Number(v)
const moneyFields = ['amountCY', 'amountPY', 'marketCY', 'marketPY', 'diminutionCY', 'diminutionPY', 'faceValue', 'paidPerUnit', 'uncalled', 'firmCapitalCY', 'firmCapitalPY', 'companyCapitalCY', 'companyCapitalPY', 'redeemWithin12Months']
export function investmentGroups(rows = []) {
  const groups = new Map()
  for (const r of rows) {
    const subclass = investmentSubclass(r)
    if (!groups.has(subclass)) groups.set(subclass, [])
    groups.get(subclass).push(r)
  }
  return [...groups].map(([name, ledgers]) => ({ name, ledgers }))
}
export function investmentPeriodRows(note, previousRows) {
  const own = (note.rows || []).filter(r => r.tb_row_id != null)
  if (!previousRows) return own
  const prior = previousRows.filter(r => investmentKind(r.level2 || r.mapping2_resultant) === investmentKind(note.title))
  const identity = r => `${String(r.branch_name || '').toLowerCase()}|${String(r.ledger_code || r.ledger_name || r.name || '').trim().toLowerCase()}|${investmentSubclass(r).toLowerCase()}`
  const used = new Set()
  const out = own.map(r => {
    const matches = prior.filter(p => identity(p) === identity(r))
    // Ambiguous duplicate names are not silently merged or allocated.
    if (matches.length === 1 && own.filter(c => identity(c) === identity(r)).length === 1) {
      used.add(investmentLedgerKey(matches[0]))
      return { ...r, opening_balance: matches[0].closing_balance }
    }
    return { ...r, opening_balance: 0 }
  })
  for (const r of prior) if (!used.has(investmentLedgerKey(r))) out.push({ ...r, closing_balance: 0, opening_balance: r.closing_balance, investmentPYOnly: true })
  return out
}
export function defaultInvestment(r) {
  const subclass = investmentSubclass(r)
  const category = /partnership/i.test(subclass) ? 'Partnership firm' : /preference/i.test(subclass) ? 'Preference shares'
    : /equity|listed equit/i.test(subclass) ? 'Shares' : /debenture/i.test(subclass) ? 'Debentures' : /bond/i.test(subclass) ? 'Bonds'
      : /mutual/i.test(subclass) ? 'Mutual fund units' : /government|trust secur/i.test(subclass) ? 'Government or trust securities'
        : /property/i.test(subclass) ? 'Investment property' : 'Other'
  // FSG source assets have debit-negative balances; display assets as positive, preserving contra signs.
  return { ledgerKey: investmentLedgerKey(r), ledgerName: r.ledger_name || r.name, subclass, category,
    companyName: '', relationship: '', paidStatus: '', quotation: '', trade: '', valuation: '', nature: '',
    amountCY: -n(r.closing_balance), amountPY: -n(r.opening_balance), partners: [] }
}
export function prepareInvestmentDetails(saved, rows) {
  const out = { version: 1, categories: [], entries: [], ...(saved || {}) }
  out.entries = [...(out.entries || [])]
  const existing = new Set(out.entries.map(e => e.ledgerKey))
  for (const r of rows || []) if (!existing.has(investmentLedgerKey(r))) out.entries.push(defaultInvestment(r))
  return out
}
export function investmentIssues(details, rows, kind, note = null) {
  const issues = []
  const live = new Map((rows || []).map(r => [investmentLedgerKey(r), r]))
  const entries = details?.entries || []
  for (const [i, e] of entries.entries()) {
    const label = `Investment ${i + 1} (${e.companyName || e.ledgerName || 'unnamed'})`
    const r = live.get(e.ledgerKey)
    if (!r || investmentSubclass(r) !== e.subclass) issues.push(`${label}: ledger no longer belongs to this sub-classification; review or remove it.`)
    if (!e.companyName?.trim() || !e.category || !e.relationship || !e.quotation || !e.valuation?.trim()) issues.push(`${label}: complete investee name, category, relationship, quotation and valuation basis.`)
    if (kind === 'noncurrent' && !['Trade investments', 'Other investments'].includes(e.trade)) issues.push(`${label}: select trade or other investments.`)
    if (/shares|debentures/i.test(e.category)) {
      if (e.quantityCY === '' || e.quantityCY == null || !Number.isInteger(Number(e.quantityCY)) || Number(e.quantityCY) < 0) issues.push(`${label}: enter a valid current-year number of shares/debentures.`)
      if (n(e.amountPY) !== 0 && (e.quantityPY === '' || e.quantityPY == null)) issues.push(`${label}: enter the previous-year number of shares/debentures.`)
      if (!['Fully paid', 'Partly paid'].includes(e.paidStatus)) issues.push(`${label}: specify fully paid or partly paid.`)
      if (e.faceValue === '' || e.faceValue == null) issues.push(`${label}: enter face value per unit.`)
      if (e.paidStatus === 'Partly paid' && (e.paidPerUnit === '' || e.paidPerUnit == null)) issues.push(`${label}: enter amount paid per unit.`)
    }
    if (e.quotation === 'Quoted' && ((e.marketCY === '' || e.marketCY == null) && n(e.amountCY) !== 0 || (e.marketPY === '' || e.marketPY == null) && n(e.amountPY) !== 0)) issues.push(`${label}: enter market value for each non-zero quoted investment period.`)
    if (e.category === 'Other' && !e.nature?.trim()) issues.push(`${label}: specify the nature of the investment.`)
    if (kind === 'noncurrent' && n(e.redeemWithin12Months) > 0) issues.push(`${label}: ${e.redeemWithin12Months} is redeemable within 12 months; review the current/non-current mapping. No automatic transfer is made.`)
    if (e.category === 'Partnership firm') {
      if (!e.partners?.length || e.partners.some(p => !p.name?.trim())) issues.push(`${label}: enter all partners and their names.`)
      for (const period of ['CY', 'PY']) {
        if (!n(e[`amount${period}`]) && !n(e[`firmCapital${period}`])) continue
        if (e[`firmCapital${period}`] === '' || e[`firmCapital${period}`] == null) issues.push(`${label}: enter total firm capital (${period}).`)
        if (e[`companyCapital${period}`] === '' || e[`companyCapital${period}`] == null) issues.push(`${label}: enter the investing company's capital share (${period}).`)
        if (Math.abs((e.partners || []).reduce((s, p) => s + n(p[`profitShare${period}`]), 0) - 100) > 0.01) issues.push(`${label}: partners' profit shares (${period}) must total 100%.`)
        if (Math.abs((e.partners || []).reduce((s, p) => s + n(p[`capital${period}`]), 0) - n(e[`firmCapital${period}`])) > 0.01) issues.push(`${label}: partners' capital (${period}) must reconcile with total firm capital.`)
      }
      if (!e.capitalBasis?.trim() || !e.firmDate) issues.push(`${label}: enter the capital basis and firm reporting date.`)
    }
  }
  for (const [key, r] of live) {
    const related = entries.filter(e => e.ledgerKey === key && e.subclass === investmentSubclass(r))
    if (!related.length) issues.push(`${r.ledger_name || r.name}: investment details not entered.`)
    for (const [period, field] of [['CY', 'closing_balance'], ['PY', 'opening_balance']]) {
      if (period === 'PY' && note) continue // Separate comparative TB/manual PY is reconciled at note level.
      const sum = related.reduce((s, e) => s + n(e[`amount${period}`]), 0)
      if (Math.abs(sum + n(r[field])) > 0.01) issues.push(`${r.ledger_name || r.name}: ${period} detail amounts do not reconcile with the ledger.`)
    }
  }
  if (note && details) for (const [field, total, period] of [['amountCY', note.total, 'CY'], ['amountPY', note.prevTotal, 'PY']]) {
    if (Math.abs(entries.reduce((s, e) => s + n(e[field]), 0) - n(total)) > 0.01) issues.push(`${period} investment detail total does not reconcile with the financial statement note; review the allocations.`)
  }
  return issues
}
export function validateInvestmentInput(data) {
  if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 5000 || !Array.isArray(data.categories)) throw new Error('Invalid investment details format.')
  if (data.categories.some(c => typeof c !== 'string' || !c.trim()) || new Set(data.categories.map(c => c.toLowerCase())).size !== data.categories.length) throw new Error('Custom investment categories must be distinct non-empty names.')
  if (data.pyTBIds != null && (!Array.isArray(data.pyTBIds) || data.pyTBIds.length > 1000 || data.pyTBIds.some(id => !Number.isInteger(Number(id)) || Number(id) <= 0))) throw new Error('Invalid comparative trial balance IDs.')
  for (const e of data.entries) {
    if (!e || typeof e !== 'object' || !Array.isArray(e.partners) || e.partners.length > 1000) throw new Error('Invalid investment entry or partners.')
    if (![...INVESTMENT_CATEGORIES, ...data.categories].includes(e.category)) throw new Error('Select a valid investment category.')
    if (e.relationship && !INVESTMENT_RELATIONSHIPS.includes(e.relationship)) throw new Error('Invalid investment relationship.')
    if (e.quotation && !['Quoted', 'Unquoted'].includes(e.quotation)) throw new Error('Invalid quotation status.')
    if (e.paidStatus && !['Fully paid', 'Partly paid'].includes(e.paidStatus)) throw new Error('Invalid paid status.')
    for (const f of [...moneyFields, 'quantityCY', 'quantityPY']) if (e[f] !== '' && e[f] != null && !Number.isFinite(Number(e[f]))) throw new Error(`Invalid number: ${f}`)
    for (const f of ['quantityCY', 'quantityPY']) if (e[f] !== '' && e[f] != null && (!Number.isInteger(Number(e[f])) || Number(e[f]) < 0)) throw new Error('Security quantities must be non-negative whole numbers.')
    for (const p of e.partners) for (const f of ['capitalCY', 'capitalPY', 'profitShareCY', 'profitSharePY']) {
      if (p[f] !== '' && p[f] != null && (!Number.isFinite(Number(p[f])) || /profitShare/.test(f) && (Number(p[f]) < 0 || Number(p[f]) > 100))) throw new Error('Invalid partner capital or profit share.')
    }
    if (e.category === 'LLP' && /partnership/i.test(e.subclass)) throw new Error('LLP investments are bodies corporate; remap them to other investments before entering LLP details.')
  }
}

// Narrow tables keep the same content readable in Notes, PDF and Excel.
export function investmentTables(details, kind, scale = x => x) {
  if (!details?.entries?.length) return []
  const tables = []
  const groups = new Map()
  for (const e of details.entries) {
    const title = `${kind === 'noncurrent' ? (e.trade || 'Trade classification pending') + ' / ' : ''}${e.subclass}`
    if (!groups.has(title)) groups.set(title, [])
    groups.get(title).push(e)
  }
  const amt = v => v === '' || v == null ? '' : scale(n(v))
  for (const [title, entries] of groups) {
    tables.push({ title, headers: ['Name of company / investee', 'Category / nature', 'Relationship', 'Paid status', 'Quoted / unquoted', 'Carrying amount CY', 'Carrying amount PY'],
      rows: entries.map(e => [e.companyName || '[Name pending]', `${e.category}${e.nature ? ': ' + e.nature : ''}`, e.relationship, e.paidStatus || 'Not applicable', e.quotation, amt(e.amountCY), amt(e.amountPY)]) })
    const securities = entries.filter(e => /shares|debentures|bonds|units/i.test(e.category))
    if (securities.length) tables.push({ title: `${title} — nature and extent`, headers: ['Investee', 'Security', 'Number CY', 'Number PY', 'Face value per unit (Rs)', 'Paid per unit (Rs)', 'Uncalled liability'],
      rows: securities.map(e => [e.companyName, e.category, e.quantityCY ?? '', e.quantityPY ?? '', e.faceValue ?? '', e.paidPerUnit ?? '', amt(e.uncalled)]) })
    tables.push({ title: `${title} — valuation`, headers: ['Investee', 'Basis of valuation', 'Market value CY', 'Market value PY', 'Diminution CY', 'Diminution PY'],
      rows: entries.map(e => [e.companyName, e.valuation, amt(e.marketCY), amt(e.marketPY), amt(e.diminutionCY), amt(e.diminutionPY)]) })
    for (const e of entries) {
      if (e.category === 'Partnership firm') {
        tables.push({ title: `${e.companyName} — partnership firm`, headers: ['Particulars', 'CY', 'PY'], rows: [
          ['Total capital of firm', amt(e.firmCapitalCY), amt(e.firmCapitalPY)], ['Company share in capital', amt(e.companyCapitalCY), amt(e.companyCapitalPY)],
          ['Firm reporting date', e.firmDate || '', ''], ['Capital basis', e.capitalBasis || '', ''], ['Reporting-date differences / adjustments', e.dateDifference || '', ''],
        ] })
        tables.push({ title: `${e.companyName} — all partners`, headers: ['Partner name', 'Capital CY', 'Capital PY', 'Profit share CY (%)', 'Profit share PY (%)'],
          rows: (e.partners || []).map(p => [p.name, amt(p.capitalCY), amt(p.capitalPY), p.profitShareCY ?? '', p.profitSharePY ?? '']) })
      }
      if (e.redemptionDate || n(e.redeemWithin12Months)) tables.push({ title: `${e.companyName} — redemption`, headers: ['Redemption date', 'Amount redeemable within 12 months', 'Classification / explanation'], rows: [[e.redemptionDate || '', amt(e.redeemWithin12Months), e.redemptionNote || '']] })
    }
  }
  const sum = (field, quote) => details.entries.filter(e => !quote || e.quotation === quote).reduce((s, e) => s + n(e[field]), 0)
  tables.push({ title: 'Aggregate investment disclosures', headers: ['Particulars', 'CY', 'PY'], rows: [
    ['Quoted investments — carrying amount', scale(sum('amountCY', 'Quoted')), scale(sum('amountPY', 'Quoted'))],
    ['Market value of quoted investments', scale(sum('marketCY', 'Quoted')), scale(sum('marketPY', 'Quoted'))],
    ['Unquoted investments — carrying amount', scale(sum('amountCY', 'Unquoted')), scale(sum('amountPY', 'Unquoted'))],
    ['Aggregate provision / cumulative diminution in value', scale(sum('diminutionCY')), scale(sum('diminutionPY'))],
  ] })
  return tables
}
