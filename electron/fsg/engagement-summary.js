// Read-only summary of Financial Statement Review (FSG) data for one VERA
// engagement (T-021). It feeds the Dashboard, the Audit Report setup
// cross-check and the Data Integrity screen, which used to read the legacy
// trial_balance_lines / engagement_trial_balance_* tables.
//
// It never creates or changes rows. An engagement maps to FSG data through
// client -> entities.client_id and financial year -> entity_periods; see
// docs/project/FINANCIAL_STATEMENT_REVIEW.md ("Engagement summary").

import { financialYearFromEngagement } from './index.js'

const ACCEPTED_STATUSES = ['auto_high', 'auto_medium', 'auto_low', 'user_approved', 'user_override']
const STATUS_LIST = ACCEPTED_STATUSES.map((s) => `'${s}'`).join(',')

// Balance Sheet face-line captions (Level 2) used by the Audit Report cross-check.
const SHARE_CAPITAL = ['share capital']
const RESERVES = ['reserves and surplus']
const BORROWINGS = ['long-term borrowings', 'short-term borrowings']

function previousYear(fy) {
  const start = Number(fy.date_from.slice(0, 4)) - 1
  return financialYearFromEngagement(`${start}-${String(start + 1).slice(2)}`)
}

function periodSummary(db, entityId, fy) {
  const empty = { yearLabel: fy ? fy.year_label : null, found: false, tbCount: 0, totalRows: 0, classifiedRows: 0, unclassifiedRows: 0 }
  if (!fy) return empty
  const period = db.prepare(`
    SELECT ep.id FROM entity_periods ep
      JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE ep.entity_id = ? AND fp.date_from = ? AND fp.date_till = ?`).get(entityId, fy.date_from, fy.date_till)
  if (!period) return empty
  const counts = db.prepare(`
    SELECT COUNT(DISTINCT tb.id) AS tb_count,
           COUNT(tr.id) AS total_rows,
           COUNT(CASE WHEN mt.id IS NOT NULL AND mt.status IN (${STATUS_LIST}) THEN 1 END) AS classified_rows
      FROM trial_balances tb
      LEFT JOIN tb_rows tr ON tr.tb_id = tb.id
      LEFT JOIN mapped_tb mt ON mt.tb_row_id = tr.id AND mt.tb_id = tb.id
     WHERE tb.entity_period_id = ?`).get(period.id)
  return {
    yearLabel: fy.year_label,
    found: counts.tb_count > 0,
    entityPeriodId: period.id,
    tbCount: counts.tb_count,
    totalRows: counts.total_rows,
    classifiedRows: counts.classified_rows,
    unclassifiedRows: counts.total_rows - counts.classified_rows,
  }
}

// Absolute closing balance per row, as the Audit Report cross-check used for
// the legacy table. Branch trial balances of the same year are added together.
function faceLineAmounts(db, entityPeriodId) {
  const rows = db.prepare(`
    SELECT lower(COALESCE(lf.level2, mt.mapping2_resultant)) AS caption,
           SUM(ABS(COALESCE(tr.closing_balance, 0))) AS amount
      FROM trial_balances tb
      JOIN mapped_tb mt ON mt.tb_id = tb.id
      JOIN tb_rows tr ON tr.id = mt.tb_row_id
      LEFT JOIN level_format lf ON lf.id = mt.level_format_id
     WHERE tb.entity_period_id = ? AND mt.status IN (${STATUS_LIST})
     GROUP BY 1`).all(entityPeriodId)
  const byCaption = new Map(rows.map((r) => [r.caption, Number(r.amount) || 0]))
  const total = (captions) => captions.reduce((sum, c) => sum + (byCaption.get(c) || 0), 0)
  return {
    paidUpCapital: total(SHARE_CAPITAL),
    reservesSurplus: total(RESERVES),
    borrowings: total(BORROWINGS),
  }
}

export function summarizeEngagement(db, engagementId) {
  const engagement = db.prepare('SELECT id, client_id, financial_year FROM engagements WHERE id = ?').get(engagementId)
  if (!engagement) throw new Error('The selected engagement was not found.')
  const fy = financialYearFromEngagement(engagement.financial_year)
  const base = {
    engagementId: engagement.id,
    financialYear: engagement.financial_year,
    current: { yearLabel: fy ? fy.year_label : null, found: false, tbCount: 0, totalRows: 0, classifiedRows: 0, unclassifiedRows: 0 },
    previous: { yearLabel: null, found: false, tbCount: 0, totalRows: 0, classifiedRows: 0, unclassifiedRows: 0 },
    amounts: null,
  }
  if (!engagement.client_id || !fy) return base
  const entity = db.prepare('SELECT id FROM entities WHERE client_id = ?').get(engagement.client_id)
  if (!entity) return base

  const current = periodSummary(db, entity.id, fy)
  const previous = periodSummary(db, entity.id, previousYear(fy))
  const amounts = current.found && current.classifiedRows > 0 ? faceLineAmounts(db, current.entityPeriodId) : null
  return { ...base, current, previous, amounts }
}
