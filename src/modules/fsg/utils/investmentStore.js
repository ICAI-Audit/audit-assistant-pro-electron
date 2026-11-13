import { fsgApi } from '../api.js'
import { investmentKind, investmentIssues, investmentPeriodRows } from './investments.js'
export const investmentScope = tb => ({ entityPeriodId: tb?.entity_period_id, tbId: tb?.id === '__consolidated__' ? null : tb?.id })
export async function attachInvestmentDetails(processed, tb) {
  if (!tb?.entity_period_id || !Object.values(processed.notes || {}).some(n => investmentKind(n.title))) return processed
  const saved = await fsgApi.listInvestments(investmentScope(tb))
  for (const note of Object.values(processed.notes || {})) {
    const kind = investmentKind(note.title)
    if (!kind) continue
    note.investmentDetails = saved[kind] || null
    // The PY total may come from a separate TB or manual sub-head figures.
    // The preparer allocates that comparative to detail rows; never silently substitute CY opening.
    note.investmentRows = investmentPeriodRows(note, processed.investmentPreviousRows)
    note.investmentPYTBIds = [...new Set((processed.investmentPreviousRows || []).map(r => r.tb_id).filter(Boolean))]
    note.investmentIssues = investmentIssues(note.investmentDetails, note.investmentRows, kind, note)
  }
  return processed
}
