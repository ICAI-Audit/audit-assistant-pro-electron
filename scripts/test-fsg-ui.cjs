// T-019 end-to-end check of Financial Statement Review in the real application.
//
//   npm run test:fsg-ui     (builds the renderer, then runs this file with Node)
//
// 1. Seeds a throw-away profile with a database built from the schema files
//    committed at HEAD (an "upgrade" database, including the legacy
//    schedule_iii_config / tb_new_* tables and one existing client).
// 2. Launches the production main process (electron/main.cjs) on that profile
//    through scripts/fsg-electron-entry.cjs and drives the real renderer over
//    the Chrome DevTools Protocol, with synthetic users and data only.
// 3. Checks start-up, the new tab, a trial balance -> mapping -> statements
//    flow, the old route, other VERA screens, then restarts the app and checks
//    the data persisted. Finally inspects the database file.
// Screenshots are written to the runtime folder printed at the end.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icai-vera-fsg-ui-'));
const profilePath = path.join(runtimeRoot, 'user-data');
const downloadsPath = path.join(runtimeRoot, 'downloads');
const launchPath = path.join(runtimeRoot, 'electron-app');
const shotsPath = path.join(runtimeRoot, 'screenshots');
const databasePath = path.join(profilePath, 'audit_assistant.db');
const entryPath = path.join(__dirname, 'fsg-electron-entry.cjs');

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Database helpers (Electron as Node: better-sqlite3 is built for Electron) ─
function runInElectronNode(code, args = []) {
  const result = spawnSync(electronPath, ['-e', code, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Electron-as-Node script failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function seedUpgradeDatabase() {
  const files = ['01_core_tables.sql', '02_audit_workflow_tables.sql', '03_audit_program_tables.sql', '04_audit_report_tables.sql',
    '05_trial_balance_tables.sql', '06_going_concern_tables.sql', '07_rule_engine_tables.sql', '08_template_system_tables.sql',
    '09_tax_audit_tables.sql']
  const dir = path.join(runtimeRoot, 'head-schema');
  fs.mkdirSync(dir);
  for (const file of files) {
    const sql = spawnSync('git', ['show', `HEAD:sqlite/schema/${file}`], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (sql.status !== 0) throw new Error(`git show failed for ${file}: ${sql.stderr}`);
    fs.writeFileSync(path.join(dir, file), sql.stdout);
  }
  runInElectronNode(`
    const path = require('path'); const fs = require('fs');
    const Database = require(path.join(process.argv[1], 'node_modules', 'better-sqlite3'));
    const db = new Database(process.argv[2]);
    db.pragma('foreign_keys = ON');
    for (const f of fs.readdirSync(process.argv[3]).sort()) db.exec(fs.readFileSync(path.join(process.argv[3], f), 'utf8'));
    db.prepare("INSERT INTO clients (id, name, constitution) VALUES ('existing-client', 'Existing Client Before Upgrade', 'company')").run();
    db.close();
  `, [projectRoot, databasePath, dir]);
}

function inspectDatabase() {
  return JSON.parse(runInElectronNode(`
    const path = require('path');
    const Database = require(path.join(process.argv[1], 'node_modules', 'better-sqlite3'));
    const db = new Database(process.argv[2], { readonly: true });
    const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
    const out = {
      legacyTables: ['schedule_iii_config','tb_new_entity_info','tb_new_ledgers','tb_new_stock_items','tb_new_classification_mappings','tb_new_sessions'].filter(has),
      sharedTables: ['trial_balance_lines','engagement_trial_balance_header','engagement_trial_balance_lines'].filter(has),
      existingClient: Boolean(db.prepare("SELECT 1 FROM clients WHERE id='existing-client'").get()),
      fsgTables: db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('entities','entity_periods','trial_balances','tb_rows','mapped_tb','level_format')").get().c,
      tbRows: has('tb_rows') ? db.prepare('SELECT COUNT(*) c FROM tb_rows').get().c : -1,
      mappedRows: has('mapped_tb') ? db.prepare('SELECT COUNT(*) c FROM mapped_tb').get().c : -1,
      fk: db.prepare('PRAGMA foreign_key_check').all().length,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
    db.close();
    console.log(JSON.stringify(out));
  `, [projectRoot, databasePath]));
}

// ── Electron + CDP plumbing (as in scripts/test-t003-authorization.cjs) ─────
let child; let socket; let nextId = 0; const pending = new Map(); let stdout = ''; let stderr = '';
const rendererErrors = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function launch() {
  const port = await freePort();
  stdout = ''; stderr = '';
  // Electron treats ELECTRON_RUN_AS_NODE as set even when empty: remove it.
  const env = { ...process.env, NODE_ENV: 'production', FSG_TEST_PROJECT_ROOT: projectRoot, FSG_TEST_USER_DATA: profilePath, FSG_TEST_DOWNLOADS: downloadsPath };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, ['--disable-gpu', `--remote-debugging-port=${port}`, launchPath], {
    cwd: projectRoot,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
  const end = Date.now() + 45000;
  let page;
  while (!page && Date.now() < end) {
    try { page = (await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* not yet */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error(`No renderer page. stdout=${stdout}\nstderr=${stderr}`);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.addEventListener('open', () => { socket = ws; resolve(); });
    ws.addEventListener('close', () => {
      for (const p of pending.values()) p.reject(new Error('CDP connection closed'));
      pending.clear();
    });
    ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      if (msg.method === 'Runtime.exceptionThrown') {
        rendererErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        rendererErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 1500));
      }
    });
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await waitFor('Boolean(globalThis.electronAPI)', 20000, 'electronAPI');
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, timeoutMs = 20000, label = expression) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await evaluate(expression); if (last) return last; } catch (e) { last = e.message; }
    await sleep(250);
  }
  return false;
}
async function screenshot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotsPath, `${name}.png`), Buffer.from(r.data, 'base64'));
}
async function closeApp() {
  // Browser.close may never answer: the connection closes as the app exits.
  try { socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} })); } catch { /* closed */ }
  const end = Date.now() + 15000;
  while (child && child.exitCode === null && Date.now() < end) await sleep(100);
  if (child && child.exitCode === null) child.kill();
}
const bodyText = () => evaluate('document.body.innerText');
const fsg = (channel, ...args) => evaluate(`globalThis.electronAPI.fsg.invoke(${JSON.stringify(`fsg:${channel}`)}, ...${JSON.stringify(args)})`);
async function goto(hash) {
  await evaluate(`(location.hash = ${JSON.stringify(hash)}, true)`);
  await sleep(1500);
}
// VERA signs out whenever the renderer loads (AuthContext), so a screen is
// opened by reloading, signing in through the real login form, then routing.
// The saved engagement is restored by EngagementContext when the user signs in.
async function openAsUser(email, password, engagement, hash) {
  await evaluate(`(localStorage.setItem('auditpro_current_engagement', ${JSON.stringify(JSON.stringify(engagement))}), location.hash = '#/auth', location.reload(), true)`);
  await sleep(2000);
  await waitFor(`Boolean(document.querySelector('#login-email'))`, 30000);
  await evaluate(`(() => {
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.querySelector('#login-email'), ${JSON.stringify(email)});
    set(document.querySelector('#login-password'), ${JSON.stringify(password)});
    document.querySelector('#login-email').closest('form').requestSubmit();
    return true;
  })()`);
  const signedIn = await waitFor(`!location.hash.includes('/auth')`, 20000);
  await sleep(1000);
  await evaluate(`(location.hash = ${JSON.stringify(hash)}, true)`);
  await sleep(1500);
  return signedIn;
}

async function clickFsgButton(label) {
  return evaluate(`(() => { const b = [...document.querySelectorAll('.fsg-root button')].find((x) => x.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(label)}); if (b) { b.click(); return true } return false })()`);
}

// ── Test flow ───────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(profilePath); fs.mkdirSync(downloadsPath); fs.mkdirSync(launchPath); fs.mkdirSync(shotsPath);
  fs.writeFileSync(path.join(launchPath, 'package.json'), JSON.stringify({ name: 'icai-vera-fsg-ui-harness', version: '1.0.0', main: entryPath }));
  seedUpgradeDatabase();

  // ── First launch: upgrade an existing database ──────────────────────────
  await launch();
  await sleep(1500);
  check('start-up applied the schema without errors', !/Error in 10_fsg_tables\.sql|Database Initialization Error/.test(stdout), stdout.split('\n').filter((l) => /Error|❌/.test(l)).join(' | '))
  check('Financial Statement Review module started', /\[FSG\] Financial Statement Review ready: \d+ channels/.test(stdout), stdout.slice(-2000));
  check('empty legacy tables were removed after a backup', /Legacy trial balance tables removed/.test(stdout));
  const backups = fs.existsSync(path.join(profilePath, 'backups')) ? fs.readdirSync(path.join(profilePath, 'backups')) : [];
  check('database backup written before the legacy-table removal', backups.some((f) => f.startsWith('audit_assistant-before-T019-legacy-tb-cleanup-')), backups);

  const password = 'Synthetic-FSG-Password-Not-For-Use';
  const signup = await evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action: 'signup', email: 'fsg-admin@example.invalid', password, fullName: 'Synthetic FSG Admin' })})`);
  check('synthetic admin signed up', !signup.error && signup.data.role === 'admin', signup);
  const insert = async (table, data) => {
    const r = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table, action: 'insert', data })})`);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data[0];
  };
  const client = await insert('clients', { name: 'Synthetic Manufacturing Private Limited', constitution: 'company', pan: 'AAACS1234A', cin: 'U12345KA2020PTC000001', address: '1 Example Road, Bengaluru' });
  const engagement = await insert('engagements', { name: 'Statutory audit FY 2024-25', client_id: client.id, client_name: client.name, financial_year: '2024-25', engagement_type: 'statutory', created_by: signup.data.user_id });

  const signedIn = await openAsUser('fsg-admin@example.invalid', password, engagement, '#/financial-statement-review');
  check('signed in through the login screen', signedIn);
  const opened = await waitFor(`document.querySelector('.fsg-root') && document.body.innerText.includes('Statutory audit FY 2024-25') && document.body.innerText.includes('Generate Financials')`, 30000);
  await screenshot('01-financial-statement-review-opened');
  check('Financial Statement Review tab opens for the engagement', opened, (await bodyText()).slice(0, 800));
  if (!opened) {
    console.log(`  location: ${await evaluate('location.href')}; html length: ${await evaluate('document.getElementById("root")?.innerHTML.length')}`);
    for (const e of rendererErrors.slice(0, 10)) console.log(`  renderer error: ${String(e).split('\n').slice(0, 6).join(' | ')}`);
  }
  const sidebar = await evaluate(`[...document.querySelectorAll('nav a, aside a')].map((a) => a.textContent.trim()).filter(Boolean)`);
  const idxExec = sidebar.indexOf('Audit Execution');
  const idxFsr = sidebar.indexOf('Financial Statement Review');
  check('sidebar shows Financial Statement Review right after Audit Execution', idxExec >= 0 && idxFsr === idxExec + 1 && !sidebar.includes('Financial Review'), sidebar);

  // Trial balance -> mapping -> statements through the same bridge the screens use
  const ctx = await fsg('context:open', engagement.id);
  check('engagement context opened', ctx.ok && ctx.result.entity.name === client.name, ctx);
  const entityId = ctx.result.entity.id;
  const periodId = ctx.result.entityPeriodId;
  const ledger = (name, parent, primary, closing) => ({ period: '2024-25', name, opening_balance: 0, debit: closing < 0 ? -closing : 0, credit: closing > 0 ? closing : 0, closing_balance: closing, parent, group_parent: primary, group_parent_1: primary });
  const up = await fsg('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 'synthetic-tb.xlsx', tbRows: [
    ledger('Equity Share Capital', 'Capital Account', 'Capital Account', 500000),
    ledger('Plant and Machinery', 'Fixed Assets', 'Fixed Assets', -300000),
    ledger('Cash', 'Cash-in-Hand', 'Current Assets', -90000),
    ledger('ABC Traders', 'Sundry Debtors', 'Current Assets', -160000),
    ledger('XYZ Suppliers', 'Sundry Creditors', 'Current Liabilities', 70000),
    ledger('Sales', 'Sales Accounts', 'Sales Accounts', 400000),
    ledger('Purchases', 'Purchase Accounts', 'Purchase Accounts', -250000),
    ledger('Office Rent', 'Indirect Expenses', 'Indirect Expenses', -60000),
    ledger('Salaries', 'Indirect Expenses', 'Indirect Expenses', -110000),
  ] });
  check('trial balance uploaded', up.ok && up.result.rowCount === 9, up);
  const ruleSets = await fsg('mapping:ruleSets', entityId);
  const rs = ruleSets.ok ? (ruleSets.result.find((r) => r.is_default) || ruleSets.result[0]) : null;
  const run = await fsg('mappedTB:run', up.result.tb.id, rs && rs.id, {});
  check('mapping engine ran', run.ok, run);

  await openAsUser('fsg-admin@example.invalid', password, engagement, '#/financial-statement-review');
  await waitFor(`document.querySelector('.fsg-root') && document.body.innerText.includes('Generate Financials')`, 30000);
  await sleep(1500);
  check('BS tab can be opened', await clickFsgButton('BS'));
  const bs = await waitFor(`/Balance Sheet/i.test(document.querySelector('.fsg-root')?.innerText || '') && /Share capital|Shareholders/i.test(document.querySelector('.fsg-root').innerText)`, 30000);
  await screenshot('02-balance-sheet');
  check('Balance Sheet renders mapped figures', bs, (await evaluate(`document.querySelector('.fsg-root')?.innerText || ''`)).slice(0, 1200));
  check('PL tab can be opened', await clickFsgButton('PL'));
  const pl = await waitFor(`/Profit/i.test(document.querySelector('.fsg-root')?.innerText || '') && /Revenue from operations/i.test(document.querySelector('.fsg-root').innerText)`, 30000);
  await screenshot('03-profit-and-loss');
  check('Statement of Profit and Loss renders', pl, (await evaluate(`document.querySelector('.fsg-root')?.innerText || ''`)).slice(0, 1200));
  check('Generate Financials tab can be opened', await clickFsgButton('Generate Financials'));
  const gen = await waitFor(`/PDF|Excel/.test(document.querySelector('.fsg-root')?.innerText || '')`, 20000);
  await screenshot('04-generate-financials');
  check('Generate Financials screen renders', gen);
  const errorBoundary = await evaluate(`document.body.innerText.includes('Something went wrong')`);
  check('no error boundary inside the module', !errorBoundary);

  // Old route and shortcut
  await goto('#/financial-review');
  check('old /financial-review route redirects', (await evaluate('location.hash')).includes('/financial-statement-review'));
  await goto('#/');
  await evaluate(`(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })), true)`);
  await sleep(1200);
  check('Ctrl+B opens Financial Statement Review', (await evaluate('location.hash')).includes('/financial-statement-review'));

  // Other VERA screens still render
  for (const [hash, name, marker] of [
    ['#/', 'dashboard', /Dashboard|Engagement/i],
    ['#/audit-execution', 'audit-execution', /Audit|Program|Procedure/i],
    ['#/materiality', 'materiality', /Materiality/i],
    ['#/audit-report', 'audit-report', /Audit Report|Report/i],
    ['#/tax-audit', 'tax-audit', /Tax Audit|3CD/i],
    ['#/audit-tools', 'vera-tools', /Tally|Tools/i],
    ['#/evidence', 'evidence', /Evidence/i],
  ]) {
    await goto(hash);
    await sleep(800);
    const text = await bodyText();
    await screenshot(`10-${name}`);
    check(`${name} screen still renders`, marker.test(text) && !/Something went wrong|404|Page not found/i.test(text), text.slice(0, 300));
  }
  await closeApp();

  // ── Second launch: persistence ──────────────────────────────────────────
  await launch();
  await sleep(1500);
  check('no legacy-table work on the second start', !/Legacy trial balance tables removed/.test(stdout));
  const relogin = await openAsUser('fsg-admin@example.invalid', password, engagement, '#/financial-statement-review');
  check('login after restart', relogin);
  const tbs = await fsg('tb:list', entityId);
  check('trial balance persisted across restart', tbs.ok && tbs.result.length === 1 && tbs.result[0].row_count === 9, tbs);
  const mapped = await fsg('mappedTB:rows', up.result.tb.id);
  check('mapping persisted across restart', mapped.ok && mapped.result.length === 9, mapped.ok ? mapped.result.length : mapped);
  const reopened = await waitFor(`document.querySelector('.fsg-root') && document.body.innerText.includes('Generate Financials')`, 30000);
  await sleep(1500);
  await clickFsgButton('BS');
  const bsAgain = await waitFor(`/Share capital|Shareholders/i.test(document.querySelector('.fsg-root')?.innerText || '')`, 30000);
  await screenshot('05-balance-sheet-after-restart');
  check('Balance Sheet renders after restart', reopened && bsAgain);
  await closeApp();

  // ── Database file ───────────────────────────────────────────────────────
  const db = inspectDatabase();
  check('legacy schedule_iii_config / tb_new_* tables are gone', db.legacyTables.length === 0, db.legacyTables);
  check('shared trial balance tables are kept', db.sharedTables.length === 3, db.sharedTables);
  check('existing client data survived the upgrade', db.existingClient);
  check('FSG tables exist with the saved data', db.fsgTables === 6 && db.tbRows === 9 && db.mappedRows === 9, db);
  check('database integrity and foreign keys', db.integrity === 'ok' && db.fk === 0, db);

  const failed = results.filter((r) => !r.pass);
  if (rendererErrors.length) {
    console.log(`\nRenderer errors (${rendererErrors.length}, first 15):`);
    for (const e of rendererErrors.slice(0, 15)) console.log(`  - ${String(e).split('\n').slice(0, 4).join(' | ')}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`Screenshots and profile: ${runtimeRoot}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  console.error(`stdout tail:\n${stdout.slice(-3000)}\nstderr tail:\n${stderr.slice(-3000)}`);
  try { await closeApp(); } catch { /* already closed */ }
  process.exitCode = 1;
});
