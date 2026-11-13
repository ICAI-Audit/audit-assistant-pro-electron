// T-019 integration test for the Financial Statement Review (FSG) module.
//
// Runs as an Electron main process (the FSG modules import 'electron'):
//   npm run test:fsg            (= electron scripts/test-fsg-integration.mjs)
// It uses a temporary userData folder and an in-memory SQLite database built
// from every sqlite/schema/*.sql file, seeds synthetic VERA users, clients and
// engagements, starts the production FSG module through initFsg() with a
// recording ipcMain, and drives the fsg:* channels exactly as the preload
// bridge would. No real client data, network or Tally connection is used.

import { app } from 'electron'
import { createRequire } from 'node:module'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkLevel1Fallbacks } from './fsg-fallback-checks.mjs'
import { checkInvestments } from './fsg-investment-checks.mjs'
import { checkMissingAlie } from './fsg-missing-alie-checks.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const userData = mkdtempSync(join(tmpdir(), 'vera-fsg-test-'))
app.setPath('userData', userData)

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`)
}

async function main() {
  await app.whenReady()
  const Database = require(join(root, 'node_modules', 'better-sqlite3'))
  const { getAuthorizationContext, hasEngagementAccess } = require(join(root, 'electron', 'sqlite-authorization.cjs'))
  const { ensureFirmPlace } = require(join(root, 'electron', 'firm-place-migration.cjs'))

  // T-023: installed databases must upgrade without replacing existing data.
  {
  const oldPath = join(userData, 'old-firm.db')
  const old = new Database(oldPath)
  old.exec(`CREATE TABLE firm_settings (id TEXT PRIMARY KEY, firm_name TEXT, address TEXT);
    INSERT INTO firm_settings VALUES ('firm-1', 'Synthetic Firm', 'Existing address');
    CREATE TABLE balances (id INTEGER PRIMARY KEY, amount NUMERIC);
    INSERT INTO balances VALUES (1, -12345.67);`)
  const before = old.prepare('SELECT * FROM firm_settings').get()
  const badDir = join(userData, 'not-a-directory')
  writeFileSync(badDir, 'blocked')
  let backupFailed = false
  try { ensureFirmPlace(old, badDir) } catch (_) { backupFailed = true }
  check('firm Place backup failure leaves the old schema and data intact', backupFailed
    && !old.prepare('PRAGMA table_info(firm_settings)').all().some(c => c.name === 'place')
    && JSON.stringify(old.prepare('SELECT * FROM firm_settings').get()) === JSON.stringify(before))
  // Failure during ALTER must roll back; the next startup can retry.
  let alterFailed = false
  try {
    ensureFirmPlace({ name: old.name, prepare: sql => old.prepare(sql), transaction: () => old.transaction(() => {
      old.exec('ALTER TABLE firm_settings ADD COLUMN place TEXT')
      throw new Error('synthetic migration interruption')
    }) }, join(userData, 'interrupted-backups'))
  } catch (_) { alterFailed = true }
  check('interrupted firm Place upgrade rolls back', alterFailed
    && !old.prepare('PRAGMA table_info(firm_settings)').all().some(c => c.name === 'place'))
  const backupPath = ensureFirmPlace(old, join(userData, 'backups'))
  const upgraded = old.prepare('SELECT * FROM firm_settings').get()
  check('firm Place upgrade preserves identifiers, details and signed balances', upgraded.place === null
    && upgraded.id === before.id && upgraded.firm_name === before.firm_name && upgraded.address === before.address
    && old.prepare('SELECT amount FROM balances').get().amount === -12345.67)
  old.prepare('UPDATE firm_settings SET place = ?').run('Bengaluru')
  check('firm Place upgrade is idempotent and preserves saved Place', ensureFirmPlace(old, join(userData, 'backups')) === null
    && old.prepare('SELECT place FROM firm_settings').get().place === 'Bengaluru')
  old.close()
  const restoredPath = join(userData, 'restored.db')
  copyFileSync(backupPath, restoredPath)
  const restored = new Database(restoredPath)
  check('pre-upgrade backup restores original firm details and balances',
    JSON.stringify(restored.prepare('SELECT * FROM firm_settings').get()) === JSON.stringify(before)
    && restored.prepare('SELECT amount FROM balances').get().amount === -12345.67
    && restored.pragma('integrity_check', { simple: true }) === 'ok')
  ensureFirmPlace(restored, join(userData, 'restored-backups'))
  check('restored old database upgrades successfully', restored.prepare('SELECT place FROM firm_settings').get().place === null)
  restored.close()
  }

  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  const schemaDir = join(root, 'sqlite', 'schema')
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(schemaDir, file), 'utf8'))
  }
  check('fresh firm schema has Place and needs no upgrade backup',
    db.prepare('PRAGMA table_info(firm_settings)').all().some(c => c.name === 'place')
    && ensureFirmPlace(db, join(userData, 'fresh-backups')) === null)

  // Table names of the FSG module must not collide with other VERA tables.
  const fsgSql = readFileSync(join(schemaDir, '10_fsg_tables.sql'), 'utf8')
  const otherSql = readdirSync(schemaDir).filter((f) => f.endsWith('.sql') && f !== '10_fsg_tables.sql')
    .map((f) => readFileSync(join(schemaDir, f), 'utf8')).join('\n')
  const names = (sql) => new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))
  const fsgTables = names(fsgSql)
  const collisions = [...names(otherSql)].filter((t) => fsgTables.has(t))
  check('FSG table names do not collide with other VERA tables', collisions.length === 0, collisions)
  check('legacy schedule_iii_config / tb_new_* tables are no longer declared',
    !/schedule_iii_config|tb_new_/.test(otherSql.replace(/^\s*--.*$/gm, '')))

  // ── Synthetic VERA data ──────────────────────────────────────────────────
  db.exec(`
    INSERT INTO profiles (id, user_id, full_name, email, is_active) VALUES
      ('p1', 'u-staff', 'Staff One', 'staff@example.test', 1),
      ('p2', 'u-partner', 'Partner One', 'partner@example.test', 1);
    INSERT INTO user_roles (user_id, role) VALUES ('u-staff', 'staff'), ('u-partner', 'partner');
    INSERT INTO clients (id, name, constitution, pan, cin) VALUES
      ('c1', 'Synthetic Industries Private Limited', 'company', 'AAACS1234A', 'U12345KA2020PTC000001'),
      ('c2', 'Other Client LLP', 'llp', NULL, NULL),
      ('c3', 'Example Trust', 'trust', NULL, NULL);
    INSERT INTO engagements (id, name, client_id, client_name, financial_year, engagement_type) VALUES
      ('e1', 'Statutory audit FY 2024-25', 'c1', 'Synthetic Industries Private Limited', '2024-25', 'statutory'),
      ('e1b', 'Tax audit FY 2024-25', 'c1', 'Synthetic Industries Private Limited', '2024-25', 'tax_audit'),
      ('e2', 'Statutory audit FY 2024-25', 'c2', 'Other Client LLP', '2024-25', 'statutory'),
      ('e3', 'Audit FY 2024-25', 'c3', 'Example Trust', '2024-25', 'statutory');
    INSERT INTO engagement_assignments (engagement_id, user_id, role) VALUES ('e1', 'u-staff', 'staff');
  `)

  // ── Start the production module with a recording ipcMain ──────────────────
  const handlers = new Map()
  const ipcMain = { handle: (channel, fn) => { if (handlers.has(channel)) throw new Error(`dup ${channel}`); handlers.set(channel, fn) } }
  const fsg = await import(pathToFileURL(join(root, 'electron', 'fsg', 'index.js')).href)
  const started = await fsg.initFsg({
    db,
    ipcMain,
    getAuthorizedSession: (conn, event) => {
      if (!event?.userId) throw new Error('Authentication required.')
      return getAuthorizationContext(conn, event.userId)
    },
    isTrustedRendererEvent: (event) => Boolean(event && event.trusted),
    hasEngagementAccess,
    appVersion: 'test',
    log: () => {},
  })
  check('module registers its channels', started.channels.length > 150, started.channels.length)
  check('Cloudtail MCA publishing and history IPC channels are not registered', !handlers.has('fsg:fsSnapshot:publish') && !handlers.has('fsg:fsSnapshot:list'))
  check('Retired snapshot storage is preserved without exposing Cloudtail', !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fs_snapshots'").get())

  const invoke = (userId, channel, ...args) => handlers.get(`fsg:${channel}`)({ userId, trusted: true }, ...args)
  const staff = (channel, ...args) => invoke('u-staff', channel, ...args)
  const partner = (channel, ...args) => invoke('u-partner', channel, ...args)

  // Default mapping is seeded from assets/Mapping_v2.xlsx.
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM mapping_rule_sets WHERE is_default = 1) AS rule_sets,
    (SELECT COUNT(*) FROM level_format) AS lf, (SELECT COUNT(*) FROM map1) AS m1,
    (SELECT COUNT(*) FROM map2) AS m2, (SELECT COUNT(*) FROM map3) AS m3`).get()
  check('default mapping seeded from Mapping_v2.xlsx', counts.rule_sets === 1 && counts.lf > 600 && counts.m1 > 200 && counts.m2 > 200 && counts.m3 > 200, counts)

  // ── Authentication and trusted frame ──────────────────────────────────────
  let r = await handlers.get('fsg:entity:getAll')({ trusted: true })
  check('unauthenticated call is refused', r.ok === false && r.denied === true, r)
  r = await handlers.get('fsg:entity:getAll')({ userId: 'u-staff', trusted: false })
  check('untrusted frame is refused', r.ok === false && r.denied === true, r)

  // ── Engagement context ────────────────────────────────────────────────────
  r = await staff('context:open', 'e1')
  check('context:open creates the entity and financial year from the engagement', r.ok
    && r.result.entity.client_id === 'c1'
    && r.result.entity.constitution === 3
    && r.result.entity.name === 'Synthetic Industries Private Limited'
    && r.result.financialPeriod.date_from === '2024-04-01'
    && r.result.financialPeriod.date_till === '2025-03-31', r)
  const ctx = r.result
  const entityId = ctx.entity.id
  const periodId = ctx.entityPeriodId

  r = await staff('context:open', 'e1')
  check('context:open is idempotent', r.ok && r.result.entity.id === entityId && r.result.entityPeriodId === periodId, r)
  r = await partner('context:open', 'e1b')
  check('a second engagement of the same client and year shares the financial year', r.ok && r.result.entityPeriodId === periodId, r)
  const periods = db.prepare('SELECT fp.year_label FROM entity_periods ep JOIN financial_periods fp ON fp.id = ep.financial_period_id WHERE ep.entity_id = ? ORDER BY fp.date_from').all(entityId)
  check('previous financial year is available for comparatives', periods.map((p) => p.year_label).join(',') === '2023-24,2024-25', periods)

  r = await staff('context:open', 'e2')
  check('context:open refuses an engagement outside the user access', r.ok === false && r.denied, r)
  r = await partner('context:open', 'e3')
  check('unsupported constitution is refused with a clear message', r.ok === false && /Company, LLP, Partnership or Proprietorship/.test(r.error), r)

  r = await partner('context:open', 'e2')
  const otherEntityId = r.result.entity.id
  r = await staff('entity:getAll')
  check('entity:getAll lists only clients within access', r.ok && r.result.length === 1 && r.result[0].id === entityId, r)
  r = await staff('tb:list', otherEntityId)
  check('reading another client is refused', r.ok === false && r.denied, r)

  // ── Disabled and file-path controls ───────────────────────────────────────
  r = await staff('entity:delete', entityId)
  check('entity:delete is disabled (clients are deleted in VERA)', r.ok === false && r.denied, r)
  r = await staff('entity:save', { name: 'New', constitution: 3, constitution_display: 'Company' })
  check('entity:save cannot create entities', r.ok === false && r.denied, r)
  r = await staff('entity:save', { ...ctx.entity, name: 'Renamed in FSG', has_branches: false, business_type: 'Manufacturer' })
  check('entity:save keeps VERA client identity and saves FSG fields', r.ok && r.result.name === 'Synthetic Industries Private Limited' && r.result.business_type === 'Manufacturer', r)
  r = await staff('file:read', join(root, 'package.json'))
  check('file:read refuses a path not chosen in a dialog', r.ok === false && r.denied, r)
  r = await staff('file:write', join(userData, 'x.txt'), [1, 2, 3])
  check('file:write refuses a path not chosen in a dialog', r.ok === false && r.denied, r)
  r = await staff('db:exportAllTablesToFile', {})
  check('full FSG export is limited to partners and admins', r.ok === false && r.denied, r)
  r = await staff('auditorFirm:save', { firm_name: 'X & Co' })
  check('global auditor master needs a manager or above', r.ok === false && r.denied, r)
  r = await staff('itr:exportExcel', { group: '../../../package', formValues: {}, detailsData: {} })
  check('ITR export rejects an unknown template group', r.ok === false && /Unknown ITR format/.test(r.error), r)

  // ── Trial balance → mapping → statements ──────────────────────────────────
  const ledger = (name, parent, primary, closing) => ({
    period: '2024-25', branch: '', ledger_code: '', name, opening_balance: 0,
    debit: closing < 0 ? -closing : 0, credit: closing > 0 ? closing : 0, closing_balance: closing,
    parent, group_parent: primary, group_parent_1: primary,
  })
  const tbRows = [
    ledger('Equity Share Capital', 'Capital Account', 'Capital Account', 100000),
    ledger('Cash', 'Cash-in-Hand', 'Current Assets', -60000),
    ledger('ABC Traders', 'Sundry Debtors', 'Current Assets', -70000),
    ledger('Sales', 'Sales Accounts', 'Sales Accounts', 60000),
    ledger('Office Rent', 'Indirect Expenses', 'Indirect Expenses', -30000),
  ]
  r = await staff('tb:uploadRealBooks', { entityId: otherEntityId, entityPeriodId: periodId, tbRows })
  check('upload naming two different clients is refused', r.ok === false && r.denied, r)
  r = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, tbRows, fileName: 'synthetic.xlsx' })
  check('trial balance upload', r.ok && r.result.rowCount === tbRows.length, r)
  const tbId = r.result.tb.id

  r = await staff('tb:rows', tbId)
  check('uploaded rows read back with signs preserved', r.ok && r.result.length === 5
    && r.result.find((x) => x.name === 'Cash').closing_balance === -60000, r.ok ? r.result.map((x) => [x.name, x.closing_balance]) : r)

  const defaultRs = db.prepare('SELECT id FROM mapping_rule_sets WHERE is_default = 1').get().id
  r = await staff('mappedTB:run', tbId, defaultRs, {})
  check('mapping engine runs', r.ok, r)
  r = await staff('mappedTB:rows', tbId)
  check('every ledger has a mapped row', r.ok && r.result.length === 5, r)
  const mapped = r.ok ? r.result : []
  check('ledgers receive a Level 1 classification', mapped.filter((m) => m.mapping1_resultant).length >= 3,
    mapped.map((m) => [m.name, m.mapping1_resultant, m.mapping2_resultant, m.status]))

  r = await staff('financials:getData', tbId)
  check('financial statement data loads', r.ok && r.result != null, r)

  // Adjustment path (rewritten PostgreSQL data-modifying CTE).
  const cash = mapped.find((m) => m.name === 'Cash')
  if (cash) {
    r = await staff('mappedTB:setAdjustment', cash.id, { debit: 1000.1 })
    const row = db.prepare('SELECT closing_balance, imported_closing_balance, adj_debit FROM tb_rows WHERE name = ? AND tb_id = ?').get('Cash', tbId)
    check('adjustment revises the closing balance and keeps the imported figure', r.ok
      && row.imported_closing_balance === -60000 && Math.abs(row.closing_balance - (-61000.1)) < 0.005, { r, row })
    const log = db.prepare('SELECT COUNT(*) AS c FROM tb_adjustment_log WHERE tb_id = ?').get(tbId)
    check('adjustment is logged', log.c === 1, log)
  }

  // Period lock is respected and only managers unlock.
  r = await staff('entityPeriod:lock', periodId)
  check('staff can lock their financial year', r.ok && r.result.locked === true, r)
  r = await staff('mappedTB:clearAll', tbId)
  check('locked year refuses changes', r.ok === false && /lock/i.test(r.error), r)
  r = await staff('entityPeriod:unlock', periodId)
  check('staff cannot unlock', r.ok === false && r.denied, r)
  r = await partner('entityPeriod:unlock', periodId)
  check('partner can unlock', r.ok && r.result.locked === false, r)

  // JSON documents (former JSONB columns) round-trip.
  r = await staff('cfs:save', entityId, periodId, { cy: { a: 1 }, py: {}, include: true })
  r = await staff('cfs:get', entityId, periodId)
  check('cash flow document round-trips as an object', r.ok && r.result && r.result.cy && r.result.cy.a === 1 && r.result.include === true, r)
  r = await staff('generalNotes:save', entityId, periodId, [{ id: 's1', noteNum: 1, header: 'Corporate information', contentHtml: '<p>Synthetic</p>' }])
  r = await staff('generalNotes:get', entityId, periodId)
  check('general notes round-trip as an array', r.ok && Array.isArray(r.result) && r.result[0].header === 'Corporate information', r)

  // ── Adapter: concurrent transactions are serialised ──────────────────────
  const client = await import(pathToFileURL(join(root, 'electron', 'fsg', 'db', 'client.js')).href)
  const order = []
  await Promise.all([1, 2, 3].map((n) => client.runInTransaction(async () => {
    order.push(`start${n}`)
    await client.query('SELECT 1')
    await client.query('SELECT 2')
    order.push(`end${n}`)
  })))
  check('concurrent transactions run one after another', order.join(',') === 'start1,end1,start2,end2,start3,end3', order)
  let rolledBack = false
  try {
    await client.runInTransaction(async () => {
      await client.query(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ('X', '1999-04-01', '2000-03-31')`)
      throw new Error('boom')
    })
  } catch (_) {
    rolledBack = !db.prepare(`SELECT 1 FROM financial_periods WHERE year_label = 'X'`).get()
  }
  check('failed transaction rolls back', rolledBack)

  // ── T-021: read-only engagement summary for Dashboard / Audit Report / Data Integrity ──
  r = await staff('engagement:summary', 'e1')
  check('engagement summary counts the FSG trial balance of the engagement year', r.ok
    && r.result.current.found && r.result.current.yearLabel === '2024-25'
    && r.result.current.totalRows === 5 && r.result.current.tbCount === 1
    && r.result.current.classifiedRows + r.result.current.unclassifiedRows === 5
    && r.result.current.classifiedRows >= 3, r)
  check('engagement summary reports no previous-year trial balance', r.ok
    && r.result.previous.yearLabel === '2023-24' && r.result.previous.found === false && r.result.previous.totalRows === 0, r)
  check('engagement summary returns the Share capital face-line amount', r.ok && r.result.amounts
    && r.result.amounts.paidUpCapital === 100000 && r.result.amounts.reservesSurplus === 0
    && r.result.amounts.borrowings === 0, r)
  r = await partner('engagement:summary', 'e1b')
  check('a second engagement of the same client and year reads the same data', r.ok && r.result.current.totalRows === 5
    && r.result.amounts && r.result.amounts.paidUpCapital === 100000, r)
  r = await staff('engagement:summary', 'e1b')
  check('engagement summary refuses an engagement the user is not assigned to', r.ok === false && r.denied === true, r)
  r = await staff('engagement:summary', 'e2')
  check('engagement summary does not cross to another client', r.ok === false && r.denied === true, r)
  r = await partner('engagement:summary', 'e2')
  check('engagement of a client without a trial balance reports none and no amounts', r.ok
    && r.result.current.found === false && r.result.current.totalRows === 0 && r.result.amounts === null, r)
  r = await partner('engagement:summary', 'e3')
  check('engagement of a client never opened in FSG reports none', r.ok && r.result.current.found === false && r.result.amounts === null, r)
  r = await handlers.get('fsg:engagement:summary')({ trusted: true }, 'e1')
  check('engagement summary needs authentication', r.ok === false && r.denied === true, r)
  const before = db.prepare('SELECT (SELECT COUNT(*) FROM entities) AS e, (SELECT COUNT(*) FROM entity_periods) AS p, (SELECT COUNT(*) FROM trial_balances) AS t').get()
  await partner('engagement:summary', 'e3')
  const after = db.prepare('SELECT (SELECT COUNT(*) FROM entities) AS e, (SELECT COUNT(*) FROM entity_periods) AS p, (SELECT COUNT(*) FROM trial_balances) AS t').get()
  check('engagement summary writes nothing', JSON.stringify(before) === JSON.stringify(after), { before, after })

  const beforeBranch = db.prepare('SELECT COUNT(*) AS c FROM trial_balances').get().c
  r = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 'branch.xlsx', tbRows: [
    { ...ledger('Term Loan from Bank', 'Secured Loans', 'Loans (Liability)', 40000), branch: 'B2' },
    { ...ledger('General Reserve', 'Reserves & Surplus', 'Reserves & Surplus', 25000), branch: 'B2' },
  ] })
  if (r.ok) {
    await staff('mappedTB:run', r.result.tb.id, defaultRs, {})
    const s = await staff('engagement:summary', 'e1')
    check('branch trial balances of the same year are added together', s.ok && s.result.current.tbCount === 2
      && s.result.current.totalRows === 7 && s.result.amounts.paidUpCapital === 100000
      && s.result.amounts.reservesSurplus === 25000 && s.result.amounts.borrowings === 40000, s)
  } else {
    check('branch trial balance upload for summary test', false, r)
  }
  check('summary test inserted one extra trial balance', db.prepare('SELECT COUNT(*) AS c FROM trial_balances').get().c === beforeBranch + 1)

  // ── Engagement / client deletion behaviour ───────────────────────────────
  db.prepare(`DELETE FROM engagements WHERE id = 'e1b'`).run()
  check('deleting one engagement keeps the shared financial statements', db.prepare('SELECT COUNT(*) AS c FROM trial_balances WHERE id = ?').get(tbId).c === 1)
  let restricted = false
  try { db.prepare(`DELETE FROM clients WHERE id = 'c1'`).run() } catch (e) { restricted = /FOREIGN KEY/.test(e.message) }
  check('deleting a client with statement data is refused', restricted)

  await checkMissingAlie({ db, root, userData, check, staff, partner, entityId, periodId, defaultRs })
  await checkInvestments({ db, root, userData, check, staff, partner, entityId, periodId, defaultRs,
    renderPdf: html => partner('financials:renderPDF', html) })
  await checkLevel1Fallbacks({ Database, root, userData, originalDb: db, check,
    renderPdf: html => partner('financials:renderPDF',html) })

  const failed = results.filter((x) => !x.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  db.close()
  try { rmSync(userData, { recursive: true, force: true }) } catch (_) { /* temp folder */ }
  app.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  app.exit(1)
})
