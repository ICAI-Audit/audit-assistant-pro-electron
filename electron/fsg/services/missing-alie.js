import { query } from '../db/client.js'

// Read every source row, including rows that have not been mapped. Match the
// financial query's ALIE precedence, without its accepted-status filter.
export async function missingAlieRows(entityId, tbIds) {
  const ids = [...new Set((tbIds || []).map(Number))]
  if (!ids.length) return []
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid Trial Balance selection.')
  const { rows } = await query(`SELECT tr.id AS tb_row_id, tr.tb_id, tr.name AS ledger_name,
    tr.ledger_code, tr.closing_balance, tr.opening_balance, mt.id AS mapped_id,
    mt.status, tb.branch_name, tb.period,
    COALESCE(lf.alie, mt.alie, lf3.alie) AS unresolved_alie
    FROM tb_rows tr
    JOIN trial_balances tb ON tb.id=tr.tb_id
    LEFT JOIN mapped_tb mt ON mt.tb_id=tr.tb_id AND mt.tb_row_id=tr.id
    LEFT JOIN level_format lf ON lf.id=mt.level_format_id
    LEFT JOIN level_format lf3 ON lf3.id=(SELECT id FROM level_format
      WHERE rule_set_id=mt.rule_set_id AND level1=mt.mapping1_resultant AND alie IS NOT NULL LIMIT 1)
      AND mt.alie IS NULL AND lf.alie IS NULL
    WHERE tb.id IN (SELECT value FROM json_each($1))
      AND ($2 IS NULL OR tb.entity_id=$2)
      -- Stock-form comparative inputs are disclosure data, deliberately not
      -- mapped ledgers. Their values are stored in closing_balance even though
      -- they describe PY; they must never become CY ALIE exceptions/liabilities.
      AND COALESCE(tr.upload_nature, '') <> 'Stock Entry PY'
      AND COALESCE(lf.alie, mt.alie, lf3.alie, '') NOT IN
        ('ASSETS','EQUITY AND LIABILITIES','Income','Expenses')
    ORDER BY tb.id, tr.id`, [ids, entityId ?? null])
  return rows
}
