// End-to-end check of CAAT Tools (/caat-tools) in the real application.
//
//   npm run test:caat-ui     (builds the renderer, then runs this file with Node)
//
// Launches the production main process (electron/main.cjs) on a throw-away
// profile through scripts/fsg-electron-entry.cjs (the runtime folder name keeps
// that entry's isolation check) and drives the real renderer and the embedded
// CAAT Tools frame over the Chrome DevTools Protocol, with synthetic data only:
//   1. new database gets the CAAT tables; the page and embedded tool open;
//   2. demo data, all 11 tests, a changed test parameter, a sample selected
//      without a fixed seed and an audited value are saved to the engagement;
//   3. a 150,000-row ledger opens the Overview without the former call-stack
//      crash and is saved to a second engagement;
//   4. after a restart both workspaces come back: same results, same sample,
//      same audited value; removing files deletes them from the database.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icai-vera-fsg-ui-caat-'));
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

function inspectDatabase() {
  const result = spawnSync(electronPath, ['-e', `
    const path = require('path');
    const Database = require(path.join(process.argv[1], 'node_modules', 'better-sqlite3'));
    const db = new Database(process.argv[2], { readonly: true });
    const out = {
      workspaces: db.prepare('SELECT engagement_id, length(state) n FROM caat_workspaces').all(),
      files: db.prepare('SELECT engagement_id, file_name, size_bytes FROM caat_source_files').all(),
      fk: db.prepare('PRAGMA foreign_key_check').all().length,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
    db.close();
    console.log(JSON.stringify(out));
  `, projectRoot, databasePath], { cwd: projectRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

// ── Electron + CDP plumbing (as in scripts/test-fsg-ui.cjs) ────────────────
let child; let socket; let nextId = 0; const pending = new Map(); let stdout = ''; let stderr = '';
const rendererErrors = [];
const contexts = new Map(); // frameId -> default execution context id

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
  stdout = ''; stderr = ''; contexts.clear();
  const env = { ...process.env, NODE_ENV: 'production', FSG_TEST_PROJECT_ROOT: projectRoot, FSG_TEST_USER_DATA: profilePath, FSG_TEST_DOWNLOADS: downloadsPath };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, ['--disable-gpu', `--remote-debugging-port=${port}`, launchPath], { cwd: projectRoot, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    ws.addEventListener('close', () => { for (const p of pending.values()) p.reject(new Error('CDP connection closed')); pending.clear(); });
    ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      if (msg.method === 'Runtime.executionContextCreated') {
        const c = msg.params.context;
        if (c.auxData && c.auxData.isDefault) contexts.set(c.auxData.frameId, c.id);
      }
      if (msg.method === 'Runtime.executionContextDestroyed') {
        for (const [k, v] of contexts) if (v === msg.params.executionContextId) contexts.delete(k);
      }
      if (msg.method === 'Runtime.executionContextsCleared') contexts.clear();
      if (msg.method === 'Runtime.exceptionThrown') rendererErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') rendererErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 1500));
    });
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await waitFor('Boolean(globalThis.electronAPI)', 20000);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression, contextId) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, timeoutMs = 20000, ctx) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const c = typeof ctx === 'function' ? await ctx() : ctx;
      const v = await evaluate(expression, c);
      if (v) return v;
    } catch { /* retry */ }
    await sleep(250);
  }
  return false;
}
async function screenshot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotsPath, `${name}.png`), Buffer.from(r.data, 'base64'));
}
async function closeApp() {
  try { socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} })); } catch { /* closed */ }
  const end = Date.now() + 15000;
  while (child && child.exitCode === null && Date.now() < end) await sleep(100);
  if (child && child.exitCode === null) child.kill();
}
async function openAsUser(email, password, engagement, hash) {
  await evaluate(`(localStorage.setItem('auditpro_current_engagement', ${JSON.stringify(JSON.stringify(engagement))}), location.hash = '#/auth', location.reload(), true)`);
  await sleep(2000);
  await waitFor(`Boolean(document.querySelector('#login-email'))`, 30000);
  await evaluate(`(() => {
    const set = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
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

// The embedded tool runs in its own frame: find its execution context.
async function caatContext() {
  const tree = await cdp('Page.getFrameTree');
  const find = (node) => {
    if (node.frame.url.includes('caat/caat-tools.html')) return node.frame.id;
    for (const c of node.childFrames || []) { const f = find(c); if (f) return f; }
    return null;
  };
  const frameId = find(tree.frameTree);
  return frameId ? contexts.get(frameId) : undefined;
}
async function inCaat(expression) { return evaluate(expression, await caatContext()); }
const waitCaat = (expression, timeoutMs = 30000) => waitFor(expression, timeoutMs, caatContext);
const pageStatus = () => evaluate(`document.querySelector('[role="status"]')?.textContent || ''`);
async function waitSaved(label) {
  // Let the bridge notice the change, then wait for the host page to confirm the write.
  await sleep(2500);
  const ok = await waitFor(`/Saved to this engagement at/.test(document.querySelector('[role="status"]')?.textContent || '')`, 30000);
  check(`${label}: saved to the engagement`, ok, await pageStatus());
}

// Snapshot of what must survive a restart.
const FINGERPRINT = `(() => ({
  rows: S.rows.length,
  mapped: S.mapped,
  tests: Object.keys(S.results).sort(),
  flags: Object.fromEntries(Object.entries(S.results).map(([k, r]) => [k, r.flag])),
  rsfThr: S.params.rsf && S.params.rsf.thr,
  sampleRows: S.samp && S.samp.res ? S.samp.res.items.map((x) => x._r) : null,
  seed: S.samp && S.samp.res ? S.samp.res.seed : null,
  useSeed: S.samp ? S.samp.p.useSeed : null,
  audit: S.samp ? S.samp.audit : null,
  keyMis: S.samp && S.samp.res && spEval() ? Math.round(spEval().total * 100) / 100 : null,
  ent: document.getElementById('eEnt').value,
}))()`;

async function main() {
  fs.mkdirSync(profilePath); fs.mkdirSync(downloadsPath); fs.mkdirSync(launchPath); fs.mkdirSync(shotsPath);
  fs.writeFileSync(path.join(launchPath, 'package.json'), JSON.stringify({ name: 'icai-vera-caat-ui-harness', version: '1.0.0', main: entryPath }));

  // ── First launch ────────────────────────────────────────────────────────
  await launch();
  await sleep(1500);
  check('schema applied without errors (11_caat_tables.sql)', /11_caat_tables\.sql/.test(stdout) && !/Error in 11_caat_tables|Database Initialization Error/.test(stdout),
    stdout.split('\n').filter((l) => /caat|Error|❌/i.test(l)).join(' | '));

  const password = 'Synthetic-CAAT-Password-Not-For-Use';
  const signup = await evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action: 'signup', email: 'caat-admin@example.invalid', password, fullName: 'Synthetic CAAT Admin' })})`);
  check('synthetic admin signed up', !signup.error && signup.data.role === 'admin', signup);
  const insert = async (table, data) => {
    const r = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table, action: 'insert', data })})`);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data[0];
  };
  const client = await insert('clients', { name: 'Synthetic Traders Private Limited', constitution: 'company' });
  const eng1 = await insert('engagements', { name: 'Statutory audit FY 2025-26', client_id: client.id, client_name: client.name, financial_year: '2025-26', engagement_type: 'statutory', created_by: signup.data.user_id });
  const eng2 = await insert('engagements', { name: 'Internal audit FY 2025-26', client_id: client.id, client_name: client.name, financial_year: '2025-26', engagement_type: 'internal', created_by: signup.data.user_id });

  check('signed in', await openAsUser('caat-admin@example.invalid', password, eng1, '#/caat-tools'));
  const sidebar = await evaluate(`[...document.querySelectorAll('nav a, aside a')].map((a) => a.textContent.trim()).filter(Boolean)`);
  check('sidebar shows CAAT Tools after VERA Tools', sidebar.indexOf('CAAT Tools') === sidebar.indexOf('VERA Tools') + 1 && sidebar.includes('CAAT Tools'), sidebar);
  const toolOpen = await waitCaat(`typeof S === 'object' && Boolean(document.querySelector('#bDemo')) && typeof XLSX === 'object'`);
  check('embedded CAAT Tools frame loads with SheetJS', toolOpen);
  check('bundled SheetJS is 0.20.3', (await inCaat('XLSX.version')) === '0.20.3', await inCaat('XLSX.version'));
  await waitFor(`/saved automatically/.test(document.querySelector('[role="status"]')?.textContent || '')`, 20000);
  check('new workspace is pre-filled from the engagement', (await inCaat(`document.getElementById('eEnt').value`)) === client.name, await inCaat(`document.getElementById('eEnt').value`));

  // Demo data → all tests → parameter change → sample → audited value
  await inCaat(`(document.querySelector('#bDemo').click(), true)`);
  check('demo data loaded and mapped', await waitCaat(`S.mapped && S.rows.length > 2000`));
  await inCaat(`(document.querySelector('#bAll').click(), true)`);
  const nTests = await waitCaat(`Object.keys(S.results).length === TESTS.length && TESTS.length`);
  check('Run all tests completes all 11 tests', nTests === 11, nTests);
  await inCaat(`(document.querySelector('#nav a[data-v="rsf"]').click(), true)`);
  await inCaat(`(() => { const e = document.querySelector('[data-p="thr"]'); e.value = '5'; document.querySelector('#bRun').click(); return true })()`);
  check('RSF re-run with threshold 5', (await inCaat('S.params.rsf.thr')) === 5);
  await inCaat(`(document.querySelector('#nav a[data-v="sampling"]').click(), true)`);
  await waitCaat(`Boolean(document.querySelector('[data-sp="tm"]'))`);
  await inCaat(`(() => { const e = document.querySelector('[data-sp="tm"]'); e.value = '500000'; e.dispatchEvent(new Event('change')); return true })()`);
  await inCaat(`(() => { const e = document.querySelector('[data-sp="useSeed"]'); e.checked = false; e.dispatchEvent(new Event('change')); return true })()`);
  await inCaat(`(document.querySelector('#spGo').click(), true)`);
  const sampled = await waitCaat(`S.samp.res && S.samp.res.items.length`);
  check('sample selected (no fixed seed)', sampled > 0 && (await inCaat('S.samp.p.useSeed')) === false, sampled);
  await inCaat(`(() => { const x = S.samp.res.items.find((i) => i._type === 'Sample'); const e = document.querySelector('[data-av="' + x._r + '"]'); e.value = String(Math.round((x._amt - 100) * 100) / 100); e.dispatchEvent(new Event('change')); return true })()`);
  check('evaluation shows the misstatement entered', (await inCaat('Math.round(spEval().total * 100) / 100')) !== 0);
  check('working-paper workbook can be written with SheetJS 0.20.3', (await inCaat(`(() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 1]]), 'S'); return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }).byteLength })()`)) > 1000);
  await screenshot('01-sampling');
  await waitSaved('engagement 1');
  const before = await inCaat(FINGERPRINT);

  // Large ledger in engagement 2
  await openAsUser('caat-admin@example.invalid', password, eng2, '#/caat-tools');
  await waitCaat(`typeof S === 'object' && Boolean(document.querySelector('#bDemo'))`);
  await waitFor(`/saved automatically/.test(document.querySelector('[role="status"]')?.textContent || '')`, 20000);
  check('engagement 2 starts with an empty workspace', (await inCaat('S.files.length')) === 0);
  const bigRows = 150000;
  await inCaat(`(async () => {
    const lines = ['Voucher No,Date,Party Name,Amount'];
    for (let i = 1; i <= ${bigRows}; i++) lines.push('JV/' + i + ',' + String(1 + (i % 28)).padStart(2, '0') + '-0' + (1 + (i % 9)) + '-2025,Party ' + (i % 900) + ',' + ((i * 7919) % 250000 + 12.5));
    await addFiles([new File([lines.join('\\n')], 'large-ledger.csv')]);
    return true;
  })()`);
  await waitCaat(`S.raw.length === ${bigRows}`, 60000);
  const overview = await inCaat(`(() => { try { document.querySelector('#bApply').click(); return S.view + '|' + document.querySelector('#main').innerText.includes('Largest / smallest') } catch (e) { return 'error: ' + e.message } })()`);
  check(`${bigRows.toLocaleString('en-IN')}-row ledger opens the Overview (fix 1)`, overview === 'overview|true', overview);
  await inCaat(`(document.querySelector('#nav a[data-v="strat"]').click(), document.querySelector('#bRun').click(), true)`);
  check('stratification runs on the large ledger', await waitCaat(`Boolean(S.results.strat)`));
  await screenshot('02-large-ledger');
  await waitSaved('engagement 2');
  const before2 = await inCaat(`({ rows: S.rows.length, tests: Object.keys(S.results) })`);
  await closeApp();

  let db = inspectDatabase();
  check('database holds one workspace per engagement', db.workspaces.length === 2, db.workspaces);
  check('source file of the large ledger is stored', db.files.some((f) => f.engagement_id === eng2.id && f.file_name === 'large-ledger.csv'), db.files);

  // ── Second launch: restore ──────────────────────────────────────────────
  await launch();
  await sleep(1500);
  await openAsUser('caat-admin@example.invalid', password, eng1, '#/caat-tools');
  await waitCaat(`typeof S === 'object' && S.mapped && S.samp && S.samp.res`, 45000);
  const after = await inCaat(FINGERPRINT);
  check('tests, parameters and flags restored', JSON.stringify([after.rows, after.tests, after.flags, after.rsfThr]) === JSON.stringify([before.rows, before.tests, before.flags, before.rsfThr]), { before: before.flags, after: after.flags });
  check('same sample re-selected (same items and seed)', JSON.stringify(after.sampleRows) === JSON.stringify(before.sampleRows) && after.seed === before.seed && after.useSeed === false, { before: before.seed, after: after.seed });
  check('audited value and evaluation restored', JSON.stringify(after.audit) === JSON.stringify(before.audit) && after.keyMis === before.keyMis, { before: before.keyMis, after: after.keyMis });
  check('entity name restored', after.ent === before.ent);
  check('sampling plan still records the seed as drawn for the run', await inCaat(`S.samp.res.plan.some(([k, v]) => k === 'Seed setting' && /^Off/.test(v))`));
  await screenshot('03-restored');

  await openAsUser('caat-admin@example.invalid', password, eng2, '#/caat-tools');
  await waitCaat(`typeof S === 'object' && S.mapped && S.results.strat`, 60000);
  const after2 = await inCaat(`({ rows: S.rows.length, tests: Object.keys(S.results) })`);
  check('large-ledger workspace restored in engagement 2', JSON.stringify(after2) === JSON.stringify(before2), after2);
  await inCaat(`(document.querySelector('#nav a[data-v="data"]').click(), document.querySelector('#bClr').click(), true)`);
  await waitSaved('engagement 2 after removing files');
  await closeApp();

  db = inspectDatabase();
  check('removed files are deleted from the database', !db.files.some((f) => f.engagement_id === eng2.id) && db.files.length === 0, db.files);
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
