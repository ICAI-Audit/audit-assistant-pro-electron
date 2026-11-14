import { fsgApi } from '../api.js'
import { buildMissingAlieReport } from './missingAlie.js'
import { resolveConsolidationSelection } from './consolidationSelection'
export async function attachMissingAlie(processed, activeTB, prevTB = null) {
  try {
    let cy, py = null
    const mode = processed.pyMode || (activeTB.entity_period_id ? (await fsgApi.getEntityPeriod(activeTB.entity_period_id))?.py_mode : 'required') || 'required'
    const pyOff = mode !== 'required'
    if (activeTB.id === '__consolidated__') {
      const sel = processed.consolidationBasis || await resolveConsolidationSelection(activeTB.entity_id, activeTB.entity_period_id)
      ;[cy, py] = await Promise.all([
        fsgApi.getConsolidatedMissingAlie(activeTB.entity_id, sel.cyIds),
        !pyOff && sel.pyIds.length ? fsgApi.getConsolidatedMissingAlie(activeTB.entity_id, sel.pyIds) : Promise.resolve(null),
      ])
    } else {
      ;[cy, py] = await Promise.all([fsgApi.getMissingAlie(activeTB.id),
        !pyOff && prevTB?.id ? fsgApi.getMissingAlie(prevTB.id) : Promise.resolve(null)])
    }
    processed.missingAlie = buildMissingAlieReport(cy, py, pyOff)
  } catch (_) {
    // A failed diagnostic must not appear clean or prevent generating a draft.
    processed.missingAlie = { error: true }
  }
  return processed
}
