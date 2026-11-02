// Financial Statement Review (FSG) module — main-process entry point.
//
// Loaded by electron/main.cjs with `await import('./fsg/index.js')` once the
// SQLite database is open and VERA's schema files (including
// sqlite/schema/10_fsg_tables.sql) have been applied. It:
//   1. attaches the FSG data-access adapter to VERA's better-sqlite3 connection;
//   2. runs FSG's start-up data routines (default mapping seed from
//      assets/Mapping_v2.xlsx, mapping patches, one-time repairs);
//   3. registers every FSG handler as `fsg:<channel>` behind VERA's
//      authentication and the scope checks in ./authorization.js;
//   4. adds `fsg:context:open`, which links the selected VERA engagement to
//      its FSG entity (the client) and entity period (the financial year).

import { attachDatabase, query, runInTransaction } from './db/client.js'
import { ensureSchema } from './db/schema.js'
import { migrateMappingV3Captions, migrateMappingV3CaptionsPass2 } from './db/mapping-v3-migration.js'
import { seedDefaultMapping, ensureStockCategories } from './services/excel.js'
import { getRegisteredHandlers } from './ipc-registry.js'
import { registerTBHandlers } from './ipc/tb.js'
import { registerMappingHandlers, applyMappingPatches } from './ipc/mapping.js'
import { registerMappedTBHandlers } from './ipc/mapped-tb.js'
import { registerSettingsHandlers } from './ipc/settings.js'
import { registerFinancialHandlers } from './ipc/financials.js'
import { registerMastersHandlers } from './ipc/masters.js'
import { registerDepreciationHandlers } from './ipc/depreciation.js'
import { registerNotesHandlers } from './ipc/notes.js'
import { registerFinancialPeriodHandlers } from './ipc/financial-periods.js'
import { registerForm3CDHandlers } from './ipc/form-3cd.js'
import { registerPPEHandlers } from './ipc/ppe.js'
import { registerRatioHandlers } from './ipc/ratio.js'
import { registerGeneralNotesHandlers } from './ipc/general-notes.js'
import { registerCfsHandlers } from './ipc/cfs.js'
import { registerFsSnapshotHandlers } from './ipc/fs-snapshot.js'
import { summarizeEngagement } from './engagement-summary.js'
import { AuthorizationError, CHANNEL_POLICY, authorizeCall, createPathGuard, filterResult } from './authorization.js'

export const CHANNEL_PREFIX = 'fsg:'

// ── VERA client / engagement → FSG entity / period ─────────────────────────

// VERA client constitution -> FSG constitution code and display label.
// FSG produces Schedule III (Company), LLP and non-corporate
// (Proprietorship / Partnership / Individual) formats only.
const CONSTITUTION_MAP = {
  company: { code: 3, display: 'Company' },
  llp: { code: 2, display: 'LLP' },
  partnership: { code: 1, display: 'Partnership' },
  proprietorship: { code: 1, display: 'Proprietorship' },
}

export function mapClientConstitution(value) {
  return CONSTITUTION_MAP[String(value || 'company').trim().toLowerCase()] || null
}

// '2024-25' / 'FY 2024-25' / '2024-2025' -> Indian financial year 1 April - 31 March.
export function financialYearFromEngagement(value) {
  const m = String(value || '').match(/(\d{4})\s*-\s*(\d{2,4})/)
  if (!m) return null
  const start = Number(m[1])
  const end = start + 1
  const tail = m[2].length === 2 ? m[2] : m[2].slice(2)
  if (tail !== String(end).slice(2)) return null
  return {
    year_label: `${start}-${String(end).slice(2)}`,
    date_from: `${start}-04-01`,
    date_till: `${end}-03-31`,
  }
}

async function ensureFinancialPeriod(fy) {
  const { rows: [existing] } = await query(
    `SELECT * FROM financial_periods WHERE date_from = $1 AND date_till = $2`, [fy.date_from, fy.date_till])
  if (existing) return existing
  const { rows: [created] } = await query(
    `INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1, $2, $3) RETURNING *`,
    [fy.year_label, fy.date_from, fy.date_till])
  return created
}

async function ensureEntityPeriod(entityId, financialPeriodId, engagementId) {
  const { rows: [existing] } = await query(
    `SELECT * FROM entity_periods WHERE entity_id = $1 AND financial_period_id = $2`, [entityId, financialPeriodId])
  if (existing) {
    if (!existing.engagement_id && engagementId) {
      const { rows: [linked] } = await query(
        `UPDATE entity_periods SET engagement_id = $1 WHERE id = $2 RETURNING *`, [engagementId, existing.id])
      return linked
    }
    return existing
  }
  const { rows: [created] } = await query(
    `INSERT INTO entity_periods (entity_id, financial_period_id, engagement_id) VALUES ($1, $2, $3) RETURNING *`,
    [entityId, financialPeriodId, engagementId || null])
  return created
}

function clientEntityFields(client) {
  const constitution = mapClientConstitution(client.constitution)
  const pan = String(client.pan || '').toUpperCase().replace(/\s+/g, '') || null
  return {
    name: client.name,
    constitution: constitution.code,
    constitution_display: constitution.display,
    address: client.address || null,
    cin: client.cin || null,
    // FSG validates PAN format on save; keep an invalid VERA value out of the entity.
    pan: pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : null,
  }
}

export async function openEngagementContext(db, engagementId) {
  const engagement = db.prepare(
    'SELECT id, name, client_id, client_name, financial_year FROM engagements WHERE id = ?').get(engagementId)
  if (!engagement) throw new Error('The selected engagement was not found.')
  if (!engagement.client_id) {
    throw new Error('This engagement is not linked to a client. Link it to a client in VERA to prepare financial statements.')
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(engagement.client_id)
  if (!client) throw new Error('The client of this engagement was not found.')
  if (!mapClientConstitution(client.constitution)) {
    throw new Error(
      `Financial Statement Review prepares statements for a Company, LLP, Partnership or Proprietorship. `
      + `This client's constitution is "${client.constitution}".`)
  }
  const fy = financialYearFromEngagement(engagement.financial_year)
  if (!fy) {
    throw new Error(`The engagement's financial year "${engagement.financial_year}" is not in the form 2024-25.`)
  }
  const previous = financialYearFromEngagement(`${Number(fy.date_from.slice(0, 4)) - 1}-${fy.date_from.slice(2, 4)}`)

  return runInTransaction(async () => {
    const fields = clientEntityFields(client)
    const { rows: [found] } = await query(`SELECT * FROM entities WHERE client_id = $1`, [client.id])
    let entity
    if (found) {
      const { rows: [updated] } = await query(
        `UPDATE entities SET name = $1, constitution = $2, constitution_display = $3, address = $4, cin = $5, pan = $6,
                updated_at = now()
          WHERE id = $7 RETURNING *`,
        [fields.name, fields.constitution, fields.constitution_display, fields.address, fields.cin, fields.pan, found.id])
      entity = updated
    } else {
      const { rows: [created] } = await query(
        `INSERT INTO entities (client_id, name, constitution, constitution_display, address, cin, pan)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [client.id, fields.name, fields.constitution, fields.constitution_display, fields.address, fields.cin, fields.pan])
      entity = created
    }

    const period = await ensureFinancialPeriod(fy)
    const entityPeriod = await ensureEntityPeriod(entity.id, period.id, engagement.id)

    // The previous financial year is available for comparatives even when VERA
    // has no engagement for it; it is linked to that engagement if one exists.
    if (previous) {
      const prevPeriod = await ensureFinancialPeriod(previous)
      const prevEngagement = db.prepare(
        `SELECT id, financial_year FROM engagements WHERE client_id = ? ORDER BY created_at`).all(client.id)
        .find((e) => financialYearFromEngagement(e.financial_year)?.date_from === previous.date_from)
      await ensureEntityPeriod(entity.id, prevPeriod.id, prevEngagement ? prevEngagement.id : null)
    }

    return {
      engagement: {
        id: engagement.id,
        name: engagement.name,
        financialYear: engagement.financial_year,
      },
      client: { id: client.id, name: client.name, constitution: client.constitution },
      entity,
      entityPeriodId: entityPeriod.id,
      financialPeriod: period,
    }
  })
}

// FSG fields that VERA owns: an Auditee's identity comes from the VERA client.
async function applyClientFieldsToEntitySave(db, args) {
  const e = args[0]
  if (!e || e.id == null) return args
  const row = db.prepare(
    'SELECT c.* FROM entities e JOIN clients c ON c.id = e.client_id WHERE e.id = ?').get(Number(e.id))
  if (!row || !mapClientConstitution(row.constitution)) return args
  return [{ ...e, ...clientEntityFields(row) }, ...args.slice(1)]
}

// ── Registration ───────────────────────────────────────────────────────────

function toErrorMessage(err) {
  return err && err.message ? err.message : String(err)
}

export async function initFsg({ db, ipcMain, getAuthorizedSession, isTrustedRendererEvent, hasEngagementAccess, appVersion, log = console.log }) {
  attachDatabase(db)

  // FSG start-up data routines, in FSG_Bharat's order.
  await ensureSchema()
  await seedDefaultMapping()
  await ensureStockCategories()
  await migrateMappingV3Captions()
  await migrateMappingV3CaptionsPass2()
  await applyMappingPatches()

  registerTBHandlers()
  registerMappingHandlers()
  registerMappedTBHandlers()
  registerSettingsHandlers()
  registerFinancialHandlers()
  registerMastersHandlers()
  registerDepreciationHandlers()
  registerNotesHandlers()
  registerFinancialPeriodHandlers()
  registerForm3CDHandlers()
  registerPPEHandlers()
  registerRatioHandlers()
  registerGeneralNotesHandlers()
  registerCfsHandlers()
  registerFsSnapshotHandlers()

  const handlers = getRegisteredHandlers()
  const missingPolicy = [...handlers.keys()].filter((channel) => !CHANNEL_POLICY[channel])
  if (missingPolicy.length) {
    // Fail closed: a handler without a policy would be unreachable anyway, but
    // this is a programming error that must be visible at start-up.
    throw new Error(`FSG channels without an authorization policy: ${missingPolicy.join(', ')}`)
  }

  const pathGuard = createPathGuard()

  const authorize = (event) => {
    if (!isTrustedRendererEvent(event)) {
      throw new AuthorizationError('Requests must originate from the main application frame.')
    }
    try {
      return getAuthorizedSession(db, event)
    } catch (err) {
      throw new AuthorizationError(toErrorMessage(err))
    }
  }

  for (const [channel, handler] of handlers) {
    ipcMain.handle(`${CHANNEL_PREFIX}${channel}`, async (event, ...rawArgs) => {
      try {
        const context = authorize(event)
        const policy = authorizeCall({ db, context, channel, args: rawArgs })
        pathGuard.check(policy, rawArgs)
        const args = channel === 'entity:save' ? await applyClientFieldsToEntitySave(db, rawArgs) : rawArgs
        const result = await handler(event, ...args)
        pathGuard.recordDialogResult(channel, result)
        return { ok: true, result: filterResult({ db, context, policy, result }) }
      } catch (err) {
        if (!(err instanceof AuthorizationError)) log(`[FSG] ${channel} failed: ${toErrorMessage(err)}`)
        return { ok: false, error: toErrorMessage(err), denied: err instanceof AuthorizationError }
      }
    })
  }

  ipcMain.handle(`${CHANNEL_PREFIX}context:open`, async (event, engagementId) => {
    try {
      const context = authorize(event)
      if (typeof engagementId !== 'string' || !engagementId) throw new AuthorizationError('Select an engagement first.')
      if (!hasEngagementAccess(db, context, engagementId)) {
        throw new AuthorizationError('This engagement is outside your engagement access.')
      }
      return { ok: true, result: await openEngagementContext(db, engagementId) }
    } catch (err) {
      if (!(err instanceof AuthorizationError)) log(`[FSG] context:open failed: ${toErrorMessage(err)}`)
      return { ok: false, error: toErrorMessage(err), denied: err instanceof AuthorizationError }
    }
  })

  // Read-only; same engagement-access rule as context:open.
  ipcMain.handle(`${CHANNEL_PREFIX}engagement:summary`, async (event, engagementId) => {
    try {
      const context = authorize(event)
      if (typeof engagementId !== 'string' || !engagementId) throw new AuthorizationError('Select an engagement first.')
      if (!hasEngagementAccess(db, context, engagementId)) {
        throw new AuthorizationError('This engagement is outside your engagement access.')
      }
      return { ok: true, result: summarizeEngagement(db, engagementId) }
    } catch (err) {
      if (!(err instanceof AuthorizationError)) log(`[FSG] engagement:summary failed: ${toErrorMessage(err)}`)
      return { ok: false, error: toErrorMessage(err), denied: err instanceof AuthorizationError }
    }
  })

  ipcMain.handle(`${CHANNEL_PREFIX}app:getVersion`, async () => ({ ok: true, result: appVersion }))

  log(`[FSG] Financial Statement Review ready: ${handlers.size} channels.`)
  return { channels: [...handlers.keys()] }
}
