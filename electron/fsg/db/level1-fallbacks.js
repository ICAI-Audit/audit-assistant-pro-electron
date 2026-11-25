import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getDB, query, runInTransaction } from './client.js'
import { userDataPath } from '../paths.js'

// T-024: exact workbook versions for the five-row, additive-only update.
// Other workbook versions continue through the existing refresh mechanism.
export const PRE_FALLBACK_WORKBOOK_HASH = 'a4745f2076d15f1007be17ca94daced96c5f5b97baee8419c2af9d2d64c993b6'
export const FALLBACK_WORKBOOK_HASH = '1c765a6aa581b572edaf50837809454a73029ab3cf70714b4856a7eaa37a7862'

export const LEVEL1_FALLBACK_ADDITIONS = [
  [3, 'EQUITY AND LIABILITIES', 'Uncategorised Equity and Liabilities'],
  [3, 'Income', 'Uncategorised Income'],
  [3, 'Expenses', 'Uncategorised Expenses'],
  [1, 'EQUITY AND LIABILITIES', 'Uncategorised Equity and Liabilities'],
  [1, 'Expenses', 'Uncategorised Expenses'],
]

// Add only missing terminal master rows to existing rule sets that already
// support that constitution. Never rewrite mapped ledgers or user overrides.
// seedHash is supplied only for the known additive workbook upgrade, so its
// marker and the additions commit together (failure remains retryable).
export async function ensureLevel1Fallbacks({ seedHash = null } = {}) {
  const { rows: formats } = await query('SELECT rule_set_id, constitution, alie, level1, level2, level3, level4, level5, level6, level7, sort_order FROM level_format')
  const norm = v => String(v || '').trim().toLowerCase()
  const plan = []
  const ruleSets = [...new Set(formats.map(r => r.rule_set_id))]
  for (const ruleSetId of ruleSets) {
    for (const [constitution, alie, level1] of LEVEL1_FALLBACK_ADDITIONS) {
      const own = formats.filter(r => r.rule_set_id === ruleSetId && r.constitution === constitution)
      if (!own.length) continue
      const present = own.some(r => norm(r.alie) === norm(alie) && norm(r.level1) === norm(level1)
        && [r.level2, r.level3, r.level4, r.level5, r.level6, r.level7].every(v => !norm(v)))
      if (!present) plan.push([ruleSetId, constitution, alie, level1, Math.max(0, ...own.map(r => Number(r.sort_order) || 0)) + 1])
    }
  }
  if (!plan.length && !seedHash) return { inserted: 0, backupPath: null }
  const db = getDB()
  let backupPath = null
  if (db.name !== ':memory:') {
    const backupDir = userDataPath('backups')
    mkdirSync(backupDir, { recursive: true })
    backupPath = join(backupDir, `audit_assistant-before-T024-level1-fallbacks-${Date.now()}.db`)
    db.prepare('VACUUM INTO ?').run(backupPath)
  }
  await runInTransaction(async () => {
    for (const params of plan) {
      await query(`INSERT INTO level_format (rule_set_id, constitution, alie, level1, sort_order)
        VALUES ($1, $2, $3, $4, $5)`, params)
    }
    if (seedHash) await query(`INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, [`mapping_seed:${seedHash}`])
  })
  return { inserted: plan.length, backupPath }
}
