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
    // The legacy tables no longer exist in HEAD's schema, so recreate empty stand-ins of an older install.
    db.exec(\`
      CREATE TABLE schedule_iii_config (id TEXT PRIMARY KEY, engagement_id TEXT);
      CREATE TABLE tb_new_entity_info (id TEXT PRIMARY KEY, engagement_id TEXT);
      CREATE TABLE tb_new_ledgers (id TEXT PRIMARY KEY, entity_info_id TEXT REFERENCES tb_new_entity_info(id));
      CREATE TABLE tb_new_stock_items (id TEXT PRIMARY KEY, entity_info_id TEXT REFERENCES tb_new_entity_info(id));
      CREATE TABLE tb_new_classification_mappings (id TEXT PRIMARY KEY, entity_info_id TEXT REFERENCES tb_new_entity_info(id));
      CREATE TABLE tb_new_sessions (id TEXT PRIMARY KEY, engagement_id TEXT);
    \`);
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

async function setInputValue(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(250);
}

const firmPlace = () => evaluate(`globalThis.electronAPI.sqliteQuery({table:'firm_settings',action:'select',columns:'*'}).then(r => r.data?.[0]?.place)`);

async function openSigningDialog() {
  await waitFor(`(() => {
    const b = [...document.querySelectorAll('.fsg-root button')].find(x => x.textContent.trim() === 'Download Excel (.xlsx)');
    return b && !b.disabled;
  })()`);
  await clickFsgButton('Download Excel (.xlsx)');
  return waitFor(`Boolean(document.querySelector('#fsg-signing-place'))`);
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
  check('existing database receives a backup before the firm Place upgrade', backups.some((f) => f.startsWith('audit_assistant-before-T023-firm-place-')), backups);

  const password = 'Synthetic-FSG-Password-Not-For-Use';
  const signup = await evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action: 'signup', email: 'fsg-admin@example.invalid', password, fullName: 'Synthetic FSG Admin' })})`);
  check('synthetic admin signed up', !signup.error && signup.data.role === 'admin', signup);
  const insert = async (table, data) => {
    const r = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table, action: 'insert', data })})`);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data[0];
  };
  const client = await insert('clients', { name: 'Synthetic Manufacturing Private Limited', constitution: 'company', pan: 'AAACS1234A', cin: 'U12345KA2020PTC000001', address: '1 Example Road, Bengaluru' });
  await insert('firm_settings', { firm_name: 'Synthetic Auditor Firm', place: 'Kolkata' });
  const engagement = await insert('engagements', { name: 'Statutory audit FY 2024-25', client_id: client.id, client_name: client.name, financial_year: '2024-25', engagement_type: 'statutory', created_by: signup.data.user_id });

  const signedIn = await openAsUser('fsg-admin@example.invalid', password, engagement, '#/financial-statement-review');
  check('signed in through the login screen', signedIn);
  await goto('#/settings');
  await waitFor(`document.querySelector('#firm-place')?.value === 'Kolkata'`);
  await setInputValue('#firm-place', 'Bengaluru');
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save Changes').click(), true)`);
  await waitFor(`globalThis.electronAPI.sqliteQuery({table:'firm_settings',action:'select',columns:'*'}).then(r => r.data?.[0]?.place === 'Bengaluru')`);
  check('Settings saves the firm Place', await firmPlace() === 'Bengaluru');
  await goto('#/admin/settings');
  await waitFor(`document.querySelector('#admin-firm-place')?.value === 'Bengaluru'`);
  check('Admin Settings loads the same firm Place', await evaluate(`document.querySelector('#admin-firm-place')?.value === 'Bengaluru'`));
  await setInputValue('#admin-firm-place', 'Chennai');
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save Firm Settings').click(), true)`);
  await waitFor(`globalThis.electronAPI.sqliteQuery({table:'firm_settings',action:'select',columns:'*'}).then(r => r.data?.[0]?.place === 'Chennai')`);
  check('Admin Settings saves the shared firm Place', await firmPlace() === 'Chennai');
  await evaluate(`(localStorage.setItem('fsg.signPlace', 'Siliguri'), true)`);
  await goto('#/financial-statement-review');
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
  const up = await fsg('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, period: '2024-04-01 To 2025-03-31', fileName: 'synthetic-tb.xlsx', tbRows: [
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
  check('T-027 Balance Sheet columns show reporting dates', await waitFor(`[...document.querySelectorAll('th')].some(t=>t.textContent.trim()==='As at 31 March 2025') && [...document.querySelectorAll('th')].some(t=>t.textContent.trim()==='As at 31 March 2024')`));
  await screenshot('02-balance-sheet');
  check('Balance Sheet renders mapped figures', bs, (await evaluate(`document.querySelector('.fsg-root')?.innerText || ''`)).slice(0, 1200));
  check('PL tab can be opened', await clickFsgButton('PL'));
  const pl = await waitFor(`/Profit/i.test(document.querySelector('.fsg-root')?.innerText || '') && /Revenue from operations/i.test(document.querySelector('.fsg-root').innerText)`, 30000);
  check('T-027 P&L columns show year-ended dates', await waitFor(`[...document.querySelectorAll('th')].some(t=>t.textContent.trim()==='For the year ended 31 March 2025') && [...document.querySelectorAll('th')].some(t=>t.textContent.trim()==='For the year ended 31 March 2024')`));
  await screenshot('03-profit-and-loss');
  await clickFsgButton('Notes');
  check('T-027 BS and PL notes show their respective dated column headings', await waitFor(`[...document.querySelectorAll('.fsg-root th')].some(t=>t.textContent.trim()==='As at 31 March 2025') && [...document.querySelectorAll('.fsg-root th')].some(t=>t.textContent.trim()==='For the year ended 31 March 2025') && ![...document.querySelectorAll('.fsg-root th')].some(t=>/^(Current Year|Previous Year)$/.test(t.textContent.trim()))`));
  await evaluate(`([...document.querySelectorAll('.fsg-root button')].find(b=>b.textContent.trim()==='Reviewed, Close')?.click(),true)`);
  await screenshot('03b-notes-dated');
  await clickFsgButton('Annex & Reco');
  await waitFor(`document.querySelector('.fsg-root')?.innerText.includes('Each note with its individual ledger')`);
  await evaluate(`([...document.querySelectorAll('.fsg-root button')].filter(b=>/^Note [0-9]+:/.test(b.textContent.trim())).forEach(b=>b.click()),true)`);
  check('T-027 BS and PL ledger annexures show matching dates', await waitFor(`[...document.querySelectorAll('.fsg-root th')].some(t=>t.textContent.includes('As at 31 March 2025 - Ledger')) && [...document.querySelectorAll('.fsg-root th')].some(t=>t.textContent.includes('For the year ended 31 March 2025 - Ledger'))`));
  check('T-027 long dated annexure headings stay within their note card', await evaluate(`(document.querySelectorAll('.fsg-root table.table-fixed').length>0 && [...document.querySelectorAll('.fsg-root table.table-fixed')].every(t=>t.getBoundingClientRect().right<=t.parentElement.getBoundingClientRect().right+1 && [...t.querySelectorAll('th.fsg-dated-heading')].every(h=>getComputedStyle(h).whiteSpace==='normal' && h.scrollWidth<=h.clientWidth+1)))`));
  await screenshot('03c-annexures-dated');

  check('Statement of Profit and Loss renders', pl, (await evaluate(`document.querySelector('.fsg-root')?.innerText || ''`)).slice(0, 1200));
  check('Generate Financials tab can be opened', await clickFsgButton('Generate Financials'));
  const gen = await waitFor(`/PDF|Excel/.test(document.querySelector('.fsg-root')?.innerText || '')`, 20000);
  await screenshot('04-generate-financials');
  check('Generate Financials screen renders', gen);
  check('Cloudtail MCA publishing card and controls are removed', await evaluate(`!document.querySelector('.fsg-root').innerText.includes('Cloudtail') && ![...document.querySelectorAll('.fsg-root button')].some(b=>b.textContent.includes('Publish to'))`));
  await openSigningDialog();
  check('signing Place defaults to the VERA firm profile and ignores old global preference',
    await waitFor(`document.querySelector('#fsg-signing-place')?.value === 'Chennai'`));
  await setInputValue('#fsg-signing-place', 'Mumbai');
  check('signing Place is editable without changing the firm profile',
    await evaluate(`document.querySelector('#fsg-signing-place')?.value === 'Mumbai'`) && await firmPlace() === 'Chennai');
  await clickFsgButton('Cancel');
  await openSigningDialog();
  check('manual signing Place survives reopening the export dialog',
    await evaluate(`document.querySelector('#fsg-signing-place')?.value === 'Mumbai'`));
  await clickFsgButton('Cancel');
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
  await clickFsgButton('Generate Financials');
  await openSigningDialog();
  check('restart uses the saved firm Place instead of the previous export override',
    await waitFor(`document.querySelector('#fsg-signing-place')?.value === 'Chennai'`));
  await clickFsgButton('Cancel');
  await fsg('entityPeriod:finalise', periodId, 'Recorded final place', '2026-11-10');
  await openSigningDialog();
  check('finalised year retains its recorded signing Place',
    await waitFor(`document.querySelector('#fsg-signing-place')?.value === 'Recorded final place' && document.querySelector('#fsg-signing-place')?.disabled`));
  await clickFsgButton('Cancel');
  await fsg('entityPeriod:unlock', periodId);
  await goto('#/settings');
  await waitFor(`Boolean(document.querySelector('#firm-place'))`);
  await setInputValue('#firm-place', '');
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save Changes').click(), true)`);
  await waitFor(`globalThis.electronAPI.sqliteQuery({table:'firm_settings',action:'select',columns:'*'}).then(r => r.data?.[0]?.place === null)`);
  await goto('#/financial-statement-review');
  await clickFsgButton('Generate Financials');
  await openSigningDialog();
  check('missing firm Place stays blank and requires manual entry before export',
    await evaluate(`document.querySelector('#fsg-signing-place')?.value === '' && [...document.querySelectorAll('.fsg-root button')].some(b => b.textContent.trim() === 'Continue' && b.disabled)`));
  await clickFsgButton('Cancel');
  await closeApp();

  // ── Database file ───────────────────────────────────────────────────────
  const db = inspectDatabase();
  check('legacy schedule_iii_config / tb_new_* tables are gone', db.legacyTables.length === 0, db.legacyTables);
  check('shared trial balance tables are kept', db.sharedTables.length === 3, db.sharedTables);
  check('existing client data survived the upgrade', db.existingClient);
  check('FSG tables exist with the saved data', db.fsgTables === 6 && db.tbRows === 9 && db.mappedRows === 9, db);
  check('database integrity and foreign keys', db.integrity === 'ok' && db.fk === 0, db);

  // T-024: exercise fallback categories through the real preload and screens.
  await launch();
  await openAsUser('fsg-admin@example.invalid', password, engagement, '#/financial-statement-review');
  let fallbackEngagement;
  for (const constitution of ['company','partnership']) {
    const fc = await insert('clients', { name: `Synthetic Fallback ${constitution}`, constitution });
    fallbackEngagement = await insert('engagements', { name:`Fallback ${constitution} FY 2024-25`,client_id:fc.id,client_name:fc.name,financial_year:'2024-25',engagement_type:'statutory',created_by:signup.data.user_id });
    const context = await fsg('context:open',fallbackEngagement.id);
    const fallbackLedger = (name,amount,type) => ({ ...ledger(name,'ZZ Unrecognised hierarchy','ZZ Unrecognised hierarchy',amount),trial_balance_type:type });
    const trialRows = [fallbackLedger('ZZ asset',-130000,'assets'),fallbackLedger('ZZ liability',constitution==='company'?100000:99000,'liabilities'),fallbackLedger('ZZ income',60000,'income'),fallbackLedger('ZZ expense',-30000,'expenses')];
    if (constitution==='partnership') trialRows.push({...ledger('Capital','Capital Account','Capital Account',1000),trial_balance_type:'liabilities'});
    const upload = await fsg('tb:uploadRealBooks',{entityId:context.result.entity.id,entityPeriodId:context.result.entityPeriodId,fileName:'fallback.xlsx',tbRows:trialRows});
    await fsg('mappedTB:run',upload.result.tb.id,rs.id,{});
    const mappedFallback = await fsg('mappedTB:rows',upload.result.tb.id);
    check(`T-024 ${constitution}: known-ALIE rows persist as terminal low-confidence fallbacks`,mappedFallback.ok
      && mappedFallback.result.filter(r=>r.status==='auto_low' && !r.mapping2_resultant && !r.mapping3_resultant).length===4);
    await openAsUser('fsg-admin@example.invalid',password,fallbackEngagement,'#/financial-statement-review');
    await clickFsgButton('BS');
    check(`T-024 ${constitution}: Balance Sheet shows fallback equity and source figures`,await waitFor(`document.querySelector('.fsg-root')?.innerText.includes('Uncategorised Equity and Liabilities') && document.querySelector('.fsg-root')?.innerText.includes('1,30,000')`));
    await screenshot(`06-fallback-bs-${constitution}`);
    await clickFsgButton('PL');
    check(`T-024 ${constitution}: P&L shows unresolved income and expenses`,await waitFor(`document.querySelector('.fsg-root')?.innerText.includes('Uncategorised Income') && document.querySelector('.fsg-root')?.innerText.includes('Uncategorised Expenses')`));
    await screenshot(`07-fallback-pl-${constitution}`);
  }
  await closeApp();
  await launch();
  await openAsUser('fsg-admin@example.invalid',password,fallbackEngagement,'#/financial-statement-review');
  await clickFsgButton('BS');
  check('T-024 fallback data and labels survive application restart',await waitFor(`document.querySelector('.fsg-root')?.innerText.includes('Uncategorised Equity and Liabilities') && document.querySelector('.fsg-root')?.innerText.includes('1,30,000')`));
  // T-025: exercise investment tables with real mapped identities and controlled selections.
  const ic = await insert('clients', { name: 'Synthetic Investments Company', constitution: 'company' });
  const ie = await insert('engagements', { name: 'Investment disclosure FY 2024-25', client_id: ic.id, client_name: ic.name, financial_year: '2024-25', engagement_type: 'statutory', created_by: signup.data.user_id });
  const ictx = (await fsg('context:open', ie.id)).result;
  const iu = await fsg('tb:uploadRealBooks', { entityId: ictx.entity.id, entityPeriodId: ictx.entityPeriodId, fileName: 'investments.xlsx', tbRows: [
    ledger('UI Equity Ledger', 'Investments', 'Investments', -100000),
    ledger('UI Firm Ledger', 'Investments', 'Investments', -50000),
    ledger('UI Current Ledger', 'Investments', 'Investments', -20000),
    ledger('UI Capital', 'Capital Account', 'Capital Account', 170000),
  ] });
  await fsg('mappedTB:run', iu.result.tb.id, rs.id, {});
  const im = (await fsg('mappedTB:rows', iu.result.tb.id)).result;
  for (const [name, l1, l2, l3] of [
    ['UI Equity Ledger', 'Non-current assets', 'Non-current investments', 'Investments in Equity Instruments'],
    ['UI Firm Ledger', 'Non-current assets', 'Non-current investments', 'Investments in partnership firms'],
    ['UI Current Ledger', 'Current assets', 'Current investments', 'Investments in Mutual Funds'],
  ]) await fsg('mappedTB:override', im.find(r => r.ledger_name === name || r.name === name).id, { mapping1_resultant: l1, mapping2_resultant: l2, mapping3_resultant: l3, override_note: 'Synthetic T-025 UI fixture' });
  await openAsUser('fsg-admin@example.invalid', password, ie, '#/financial-statement-review');
  await clickFsgButton('Notes');
  const openInvestment = async noncurrent => {
    await waitFor(`Boolean([...document.querySelectorAll('[id^="note-"]')].find(n => /Note \\d+: ${noncurrent ? 'Non-current' : 'Current'} investments/i.test(n.querySelector('button')?.textContent || '')))`);
    await evaluate(`(() => {const n=[...document.querySelectorAll('[id^="note-"]')].find(n=>/Note \\d+: ${noncurrent ? 'Non-current' : 'Current'} investments/i.test(n.querySelector('button')?.textContent||'')); [...n.querySelectorAll('button')].find(b=>b.textContent.includes('Fill Details')).click(); return true})()`);
    return waitFor(`Boolean(document.querySelector('[role="dialog"] [data-testid="investment-entry"]'))`);
  };
  check('T-025 Investments Fill Details opens from the mapped note', await openInvestment(true));
  check('T-025 ledger dropdowns contain only the respective investment subclass', await evaluate(`(() => {const s=[...document.querySelectorAll('[role="dialog"] select[aria-label="Name of Ledger"]')];return s.length===2 && s.every(e=>e.options.length===1) && s.some(e=>e.options[0].text.includes('UI Equity Ledger')) && s.some(e=>e.options[0].text.includes('UI Firm Ledger'))})()`));
  await setInputValue('[aria-label="Printed investee name"]', 'Printed UI Company');
  await setInputValue('[aria-label="No of Shares CY"]', '1000');
  await setInputValue('[aria-label="New investment category"]', 'UI Custom Category');
  await evaluate(`([...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Add category')).click(),true)`);
  check('T-025 Add category updates category choices and partnership has Add partner', await evaluate(`document.querySelector('select[aria-label="Category"]').innerText.includes('UI Custom Category') && [...document.querySelectorAll('[role="dialog"] button')].some(b=>b.textContent.includes('Add partner'))`));
  await screenshot('09-investment-fill-details');
  await evaluate(`([...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==='Save draft details').click(),true)`);
  await waitFor(`!document.querySelector('[role="dialog"]')`);
  await openInvestment(true);
  check('T-025 saved investment details reopen with printed name and number of shares', await evaluate(`document.querySelector('[aria-label="Printed investee name"]').value==='Printed UI Company' && document.querySelector('[aria-label="No of Shares CY"]').value==='1000'`));
  await evaluate(`(document.querySelector('[aria-label="Close investments"]').click(),true)`);
  await openInvestment(false);
  check('T-025 current investment form has no trade/other field and no non-current ledgers', await evaluate(`!document.querySelector('[aria-label="Trade / other"]') && document.querySelector('select[aria-label="Name of Ledger"]').options.length===1 && document.querySelector('select[aria-label="Name of Ledger"]').innerText.includes('UI Current Ledger')`));
  await screenshot('10-current-investment-fill-details');
  await evaluate(`(document.querySelector('[aria-label="Close investments"]').click(),true)`);
  await fsg('entityPeriod:lock', ictx.entityPeriodId);
  await openInvestment(true);
  check('T-025 locked financial year opens investment details read-only', await evaluate(`document.querySelector('[role="dialog"] fieldset').disabled`));
  await closeApp();
  await launch();
  await openAsUser('fsg-admin@example.invalid', password, ie, '#/financial-statement-review');
  const persistedInvestments = await fsg('investments:list', { entityPeriodId: ictx.entityPeriodId, tbId: iu.result.tb.id });
  check('T-025 investment details persist after full application restart', persistedInvestments.ok && persistedInvestments.result.noncurrent.entries.some(e => e.companyName === 'Printed UI Company' && Number(e.quantityCY) === 1000));
  // T-026: missing ALIE stays prominently visible but never disables statement generation.
  const ac = await insert('clients', { name: 'Synthetic Missing ALIE Company', constitution: 'company' });
  const ae = await insert('engagements', { name: 'Missing ALIE FY 2024-25', client_id: ac.id, client_name: ac.name, financial_year: '2024-25', engagement_type: 'statutory', created_by: signup.data.user_id });
  const actx = (await fsg('context:open', ae.id)).result;
  const au = await fsg('tb:uploadRealBooks', { entityId: actx.entity.id, entityPeriodId: actx.entityPeriodId, fileName: 'missing-alie.xlsx', tbRows: [
    { ...ledger('ZZ ALIE debit', 'ZZ Unknown hierarchy', 'ZZ Unknown hierarchy', -100), trial_balance_type: 'unknown' },
    { ...ledger('ZZ ALIE credit', 'ZZ Unknown hierarchy', 'ZZ Unknown hierarchy', 250), trial_balance_type: 'unknown' },
    { ...ledger('ZZ ALIE zero', 'ZZ Unknown hierarchy', 'ZZ Unknown hierarchy', 0), trial_balance_type: 'unknown' },
    ledger('Cash', 'Cash-in-Hand', 'Current Assets', -1000),
    ledger('Equity Share Capital', 'Capital Account', 'Capital Account', 850),
  ] });
  await fsg('mappedTB:run', au.result.tb.id, rs.id, {});
  const stockSave = await fsg('tb:saveStock', { tbId: au.result.tb.id, stockData: { pyOpening: { 'Stock-in-Trade': 123456789.12 }, pyClosing: { 'Stock-in-Trade': 98765432.10 } } });
  check('T-026 separately entered PY stock is saved but not returned as missing ALIE', stockSave.ok && (await fsg('financials:getMissingAlie', au.result.tb.id)).result.length === 3);
  await openAsUser('fsg-admin@example.invalid', password, ae, '#/financial-statement-review');
  await clickFsgButton('BS');
  check('T-026 BS shows mandatory ALIE warning at top and bottom with gross debit/credit while excluding fully nil items', await waitFor(`document.querySelector('[data-testid="missing-alie-top"]')?.innerText.includes('ALIE classification missing for 2 ledgers.') && document.querySelector('[data-testid="missing-alie-top"]').innerText.includes('Debit 100.00') && document.querySelector('[data-testid="missing-alie-bottom"]')?.innerText.includes('Credit 250.00')`));
  check('T-026 missing-ALIE notice is bold red', await evaluate(`(() => {const s=getComputedStyle(document.querySelector('[data-testid="missing-alie-top"]'));return s.color==='rgb(185, 28, 28)' && Number(s.fontWeight)>=700})()`));
  check('T-026 missing ALIE remains a warning without a provisional liability head', await evaluate(`![...document.querySelectorAll('td')].some(c=>c.textContent.trim()==='ALIE MISSING') && document.querySelector('[data-testid="missing-alie-top"]').innerText.includes('excluded from the Balance Sheet and Profit and Loss')`));
  check('T-026 ledger names and closing balances are visible without expanding details', await evaluate(`(() => {const list=document.querySelector('[data-testid="missing-alie-ledgers"]');return !!list && list.getBoundingClientRect().height>0 && list.innerText.includes('ZZ ALIE debit') && list.innerText.includes('ZZ ALIE credit') && !list.innerText.includes('ZZ ALIE zero') && !list.innerText.includes('PY Opening Stock') && !list.innerText.includes('PY Closing Stock') && !document.querySelector('[data-testid="missing-alie-top"]').innerText.includes('P&L classification pending')})()`));
  await screenshot('11-missing-alie-bs');
  await clickFsgButton('PL');
  check('T-026 P&L also shows the ALIE warning at both ends', await waitFor(`!!document.querySelector('[data-testid="missing-alie-top"]') && !!document.querySelector('[data-testid="missing-alie-bottom"]')`));
  await screenshot('12-missing-alie-pl');
  await evaluate(`([...document.querySelectorAll('[data-testid="missing-alie-top"] button')].find(b=>b.textContent.includes('Resolve ALIE')).click(),true)`);
  check('T-026 Resolve ALIE opens the existing rectification workflow', await waitFor(`document.querySelector('.fsg-root')?.innerText.includes('ALIE missing') && document.querySelector('.fsg-root')?.innerText.includes('ZZ ALIE debit')`));
  await clickFsgButton('Annex & Reco');
  check('T-026 Annexures remain available and retain the ALIE exception warning', await waitFor(`!!document.querySelector('[data-testid="missing-alie-top"]')`));
  await clickFsgButton('Generate Financials');
  await openSigningDialog();
  check('T-026 missing ALIE does not block opening the Excel export flow', await waitFor(`Boolean(document.querySelector('#fsg-signing-place'))`));
  await clickFsgButton('Cancel');
  await clickFsgButton('Download PDF');
  check('T-026 missing ALIE does not block opening the PDF export flow', await waitFor(`Boolean(document.querySelector('#fsg-signing-place'))`));
  await clickFsgButton('Cancel');
  await closeApp();
  await launch();
  await openAsUser('fsg-admin@example.invalid', password, ae, '#/financial-statement-review');
  await clickFsgButton('BS');
  check('T-026 mandatory ALIE warning survives restart without a dismiss/acknowledge bypass', await waitFor(`document.querySelector('[data-testid="missing-alie-top"]')?.innerText.includes('ALIE classification missing for 2 ledgers.')`));
  const alieMapped = (await fsg('mappedTB:rows', au.result.tb.id)).result;
  for (const row of alieMapped.filter(r => (r.ledger_name || r.name || '').startsWith('ZZ ALIE') && !(r.ledger_name || r.name).includes('zero'))) {
    const credit = (row.ledger_name || row.name).includes('credit');
    await fsg('mappedTB:override', row.id, { mapping1_resultant: credit ? "Shareholders' funds" : 'Current assets', mapping2_resultant: credit ? 'Share capital' : 'Cash and bank balances', mapping3_resultant: '', override_note: 'Synthetic T-026 ALIE resolution' });
  }
  await clickFsgButton('PL');
  check('T-026 warning clears after all ALIE classifications are actually resolved', await waitFor(`!document.querySelector('[data-testid="missing-alie-top"]') && /Statement of Profit|Profit and Loss/i.test(document.querySelector('.fsg-root')?.innerText || '')`));
  await clickFsgButton('BS');
  check('T-026 resolving active balances removes the provisional BS head while nil ALIE remains in Mapping', await waitFor(`![...document.querySelectorAll('td')].some(c=>c.textContent.trim()==='ALIE MISSING')`) && (await fsg('financials:getMissingAlie', au.result.tb.id)).result.length === 1);
  await openAsUser('fsg-admin@example.invalid', password, ie, '#/financial-statement-review');
  await clickFsgButton('BS');
  check('T-026 switching to a classified client does not retain another client warning', await waitFor(`!document.querySelector('[data-testid="missing-alie-top"]') && document.querySelector('.fsg-root')?.innerText.includes('Synthetic Investments Company')`));
  await closeApp();

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
