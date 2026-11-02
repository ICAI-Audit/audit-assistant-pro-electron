import { ipcMain } from '../ipc-registry.js'
import { query } from '../db/client.js'

// SQLite keeps the JSON document as TEXT; node-pg returned the JSONB column
// already parsed. A missing or unreadable value reads as null (no saved data).
function parseJsonColumn(v) {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch (_) { return null }
}

// Ratio tab (Form 3CD Gross Profit row) — Trading-Account item selection,
// one JSON blob per (entity, period): { income: [key,...], expense: [key,...] }.
// See schema.js's ratio_gp_selection table doc comment for the key format.
export function registerRatioHandlers() {
  ipcMain.handle('ratio:getGPSelection', async (_, entityId, entityPeriodId) => getGPSelection(entityId, entityPeriodId))
  ipcMain.handle('ratio:saveGPSelection', async (_, entityId, entityPeriodId, selection) => saveGPSelection(entityId, entityPeriodId, selection))
}

export async function getGPSelection(entityId, entityPeriodId) {
  if (!entityId || !entityPeriodId) return null
  const { rows } = await query(
    `SELECT data FROM ratio_gp_selection WHERE entity_id = $1 AND entity_period_id = $2`,
    [entityId, entityPeriodId]
  )
  return rows[0] ? parseJsonColumn(rows[0].data) : null
}

export async function saveGPSelection(entityId, entityPeriodId, selection) {
  if (!entityId || !entityPeriodId) throw new Error('Missing entity/period')
  await query(
    `INSERT INTO ratio_gp_selection (entity_id, entity_period_id, data, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT(entity_id, entity_period_id) DO UPDATE SET
       data = EXCLUDED.data,
       updated_at = now()`,
    [entityId, entityPeriodId, JSON.stringify(selection)]
  )
  return { ok: true }
}
