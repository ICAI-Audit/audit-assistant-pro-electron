// End-to-end check of Tax Audit (/tax-audit) in the real application: the chooser of task 19 and the
// Form No. 26 workspace (BUILD-PLAN tasks 19-20, 23-27: exports and the save file, the comparison, the
// conversion of a Form 3CD draft and a changed year, 250 rows in every table, a change made elsewhere while a
// field has the keyboard, the earlier years again at the end), with invented data only.
//
//   node scripts/test-tax-audit-ui.cjs                 against a normal (released) build: every scenario
//   node scripts/test-tax-audit-ui.cjs --short         against a normal build: 2024-25 and 2025-26 open Form 3CD
//                                                      exactly as the snapshot, 2026-27 opens Form No. 26
//   node scripts/test-tax-audit-ui.cjs --record        against a build of the page BEFORE the chooser:
//                                                      records scripts/tax-audit-form26/threecd-snapshot.json
//   option --axe <path to axe.min.js>                  also runs axe-core (wcag2a/aa, 21a/aa) on the workspace
//
// Build the renderer in a scratch copy of the repository (never into the repository's own dist) and run
// this file from that copy. It launches the production main process (electron/main.cjs) through
// scripts/fsg-electron-entry.cjs on a throw-away profile (the runtime folder name keeps that entry's
// isolation check), drives the renderer over the Chrome DevTools Protocol and the main process over its
// inspector (a real BrowserWindow.close(), as the window's close button does), and reads the database
// file of that profile directly. Run it under a short TEMP path. It leaves no process behind.
//
// Form No. 26 saves every file through the window's own "Save As" (window.showSaveFilePicker, FIX-T29). The
// native window itself cannot be driven from here: the picker is replaced in the page by a stand-in that
// answers as the real one does (a file handle; "cancelled" with an AbortError; a write that fails; or held open
// until released), and the bytes written are read back from the page. The real window is checked by hand.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const RECORD = args.includes('--record');
const SHORT = args.includes('--short');
const axeIndex = args.indexOf('--axe');
const axePath = axeIndex >= 0 ? args[axeIndex + 1] : '';
// Form No. 26 is released (task 28): there is no preview build any more, and no build in which 2026-27 opens
// Form 3CD. The former "--preview-off" run is "--short".
if (args.includes('--preview-off')) {
  console.error('--preview-off is gone: Form No. 26 is released and every build is the normal one. Use --short for the short run.');
  process.exit(2);
}
const MODE = RECORD ? 'record' : SHORT ? 'short' : 'full';

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icai-vera-fsg-ui-taxaudit-'));
const profilePath = path.join(runtimeRoot, 'user-data');
const downloadsPath = path.join(runtimeRoot, 'downloads');
const launchPath = path.join(runtimeRoot, 'electron-app');
const shotsPath = path.join(runtimeRoot, 'screenshots');
const databasePath = path.join(profilePath, 'audit_assistant.db');
const entryPath = path.join(__dirname, 'fsg-electron-entry.cjs');
const snapshotPath = path.join(__dirname, 'tax-audit-form26', 'threecd-snapshot.json');

const F26 = 'ITA_2025_FORM_26_RULE_47_NOTIF_22_2026';
// The stand-in for the window's "Save As" (see the head of this file). window.__f26Save.mode: 'save' | 'cancel' |
// 'fail' (the write fails); hold: true keeps the "window" open until release() is called.
const SAVE_STUB = `(() => {
  if (window.__f26Save) return;
  const state = { mode: 'save', hold: false, release: null, saved: {}, asked: [], removed: [] };
  window.__f26Save = state;
  window.showSaveFilePicker = async (options) => {
    state.asked.push({ suggestedName: options.suggestedName, id: options.id, types: options.types });
    if (state.hold) await new Promise((resolve) => { state.release = () => { state.release = null; resolve(); }; });
    if (state.mode === 'cancel') throw new DOMException('The user aborted a request.', 'AbortError');
    const name = options.suggestedName;
    return {
      name,
      getFile: async () => ({ size: state.saved[name] ? state.saved[name].length : 0 }),
      remove: async () => { state.removed.push(name); delete state.saved[name]; },
      createWritable: async () => {
        const chunks = [];
        return {
          write: async (data) => {
            if (state.mode === 'fail') throw new DOMException('There is not enough room.', 'QuotaExceededError');
            chunks.push(data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
          },
          close: async () => {
            const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
            chunks.reduce((at, c) => (bytes.set(c, at), at + c.length), 0);
            state.saved[name] = bytes;
          },
          abort: async () => {},
        };
      },
    };
  };
})();`;
const CLOSE_SAVED = 'All changes are saved. You can close the window now.';
const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1500)}`}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── The database file, read directly (read only) ────────────────────────────
function sql(queries) {
  const result = spawnSync(electronPath, ['-e', `
    const path = require('path');
    const Database = require(path.join(process.argv[1], 'node_modules', 'better-sqlite3'));
    const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
    const queries = JSON.parse(process.argv[3]);
    const out = {};
    for (const [name, [text, ...params]] of Object.entries(queries)) out[name] = db.prepare(text).all(...params);
    db.close();
    console.log(JSON.stringify(out));
  `, projectRoot, databasePath, JSON.stringify(queries)], { cwd: projectRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

// ── Electron + CDP plumbing (as in scripts/test-caat-ui.cjs), plus the main process's inspector ──
let child; let socket; let mainSocket; let nextId = 0; const pending = new Map(); let stdout = ''; let stderr = '';
const rendererErrors = [];
let errorPhase = 'start';

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
function connect(url, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('close', () => { for (const [id, p] of pending) if (p.ws === ws) { pending.delete(id); p.reject(new Error('connection closed')); } });
    ws.addEventListener('error', () => reject(new Error('connection failed')), { once: true });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      if (onEvent) onEvent(msg);
    });
  });
}
function send(ws, method, params = {}) {
  const id = ++nextId;
  // The timer also keeps Node alive: without it a reply that never comes ends the run silently.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out after 180 s`)); }, 180000);
    const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
    pending.set(id, { ws, resolve: done(resolve), reject: done(reject) });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const cdp = (method, params) => send(socket, method, params);
async function launch() {
  const port = await freePort();
  const mainPort = await freePort();
  stdout = ''; stderr = '';
  const env = { ...process.env, NODE_ENV: 'production', FSG_TEST_PROJECT_ROOT: projectRoot, FSG_TEST_USER_DATA: profilePath, FSG_TEST_DOWNLOADS: downloadsPath };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, [`--inspect=127.0.0.1:${mainPort}`, '--disable-gpu', `--remote-debugging-port=${port}`, launchPath], { cwd: projectRoot, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
  const end = Date.now() + 45000;
  let page; let main;
  while ((!page || !main) && Date.now() < end) {
    try { page = page || (await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* not yet */ }
    try { main = main || (await getJson(`http://127.0.0.1:${mainPort}/json/list`)).find((t) => t.webSocketDebuggerUrl); } catch { /* not yet */ }
    if (!page || !main) await sleep(200);
  }
  if (!page || !main) throw new Error(`No renderer page or main inspector. stdout=${stdout}\nstderr=${stderr}`);
  socket = await connect(page.webSocketDebuggerUrl, (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') rendererErrors.push(`[${errorPhase}] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') rendererErrors.push(`[${errorPhase}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 1500)}`);
  });
  mainSocket = await connect(main.webSocketDebuggerUrl);
  // The application has no download handler of its own (Electron would ask where to save): downloads of this
  // run go straight into the test profile's download folder, as scripts/pdf-tools-electron-entry.cjs does.
  await mainEval(`(() => { const { session } = process.mainModule.require('electron'); const path = process.mainModule.require('path'); session.defaultSession.on('will-download', (_event, item) => item.setSavePath(path.join(${JSON.stringify(downloadsPath)}, item.getFilename()))); return true; })()`);
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  // Form No. 26's "Save As" stand-in, in this document and every later one (reloads, restarts are new launches).
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: SAVE_STUB });
  await evaluate(`(${SAVE_STUB.replace(/;$/, '')}, true)`);
  // Blur and focus events fire even when another window is in front.
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await waitFor('Boolean(globalThis.electronAPI)', 20000);
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function mainEval(expression) {
  const r = await send(mainSocket, 'Runtime.evaluate', { expression: `(() => { const { BrowserWindow } = process.mainModule.require('electron'); return (${expression}); })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const v = await evaluate(expression); if (v) return v; } catch { /* retry */ }
    await sleep(200);
  }
  return false;
}
async function screenshot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = path.join(shotsPath, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}
const windowCount = () => mainEval('BrowserWindow.getAllWindows().length').catch(() => 0);
async function waitExit(ms) {
  const end = Date.now() + ms;
  let released = false;
  while (child && child.exitCode === null && Date.now() < end) {
    await sleep(100);
    // A connected inspector session keeps the main process from ending once its last window has gone:
    // let go of it then (the window close itself is what is being tested).
    if (!released && child.exitCode === null && (await windowCount()) === 0) { released = true; try { mainSocket.close(); } catch { /* closed */ } }
  }
  return child.exitCode !== null;
}
// A real close of the window (what its close button does); the application quits with its last window.
async function closeWindow() {
  return mainEval('(BrowserWindow.getAllWindows()[0]?.close(), BrowserWindow.getAllWindows().length)').catch((error) => `close failed: ${error.message}`);
}
async function closeApp() {
  const answer = await closeWindow();
  if (!(await waitExit(15000))) {
    console.log(`  (the window close did not end the application: ${answer}; windows now ${await windowCount()})`);
    try { socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} })); } catch { /* closed */ }
    if (!(await waitExit(10000))) child.kill();
    await waitExit(5000);
    return false;
  }
  return true;
}

// ── Input as a user gives it ────────────────────────────────────────────────
const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  F8: { key: 'F8', code: 'F8', windowsVirtualKeyCode: 119 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  y: { key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, text: 'y' },
  n: { key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, text: 'n' },
};
async function press(name, modifiers = 0) {
  const k = KEYS[name];
  await cdp('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', modifiers, ...k });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  await sleep(120);
}
async function type(text) { await cdp('Input.insertText', { text }); await sleep(80); }
async function focus(id) {
  return evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); return document.activeElement === el; })()`);
}
// Clear a box and type into it, as a user would (select all, then type over it).
async function typeInto(id, text) {
  if (!(await focus(id))) return false;
  await evaluate(`(() => { try { document.activeElement.select(); } catch { /* a box that cannot be selected */ } return true; })()`);
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await type(text);
  return true;
}
// A native select: choose the option and announce it as the browser does after a choice.
async function choose(id, value) {
  return evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false; el.focus(); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value === ${JSON.stringify(value)}; })()`);
}
// A real mouse click in the middle of the element the expression returns.
async function clickReal(finder) {
  const rect = await evaluate(`(() => { const el = (${finder}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!rect) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  await sleep(250);
  return true;
}
const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)})`;
const valueOf = (id) => evaluate(`document.getElementById(${JSON.stringify(id)})?.value ?? null`);
const saveLine = () => evaluate(`document.querySelector('[data-f26-save-state]')?.textContent || ''`);
const bodyText = () => evaluate('document.body.innerText');

async function openAsUser(email, password, engagement, hash) {
  await waitFor(`(() => { try { return /^(http|file|app)/.test(location.protocol) && !!localStorage } catch (_) { return false } })()`, 30000);
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

// ── Form 3CD as today: what a user sees, and what opening the page writes ──
// Things that differ between runs (times, dates, generated ids) are masked; nothing else.
const MASK = `((text) => String(text)
  .replace(/\\b\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?Z?/g, '<datetime>')
  .replace(/\\b\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}\\b/g, '<date>')
  .replace(/\\b\\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \\d{4}\\b/g, '<date>')
  .replace(/\\b\\d{1,2}:\\d{2}(:\\d{2})?(\\s?[ap]m)?\\b/gi, '<time>')
  .replace(/\\b[0-9a-f]{32}\\b/g, '<id>'))`;
async function stableMainText() {
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    const now = await evaluate(`${MASK}(document.querySelector('main')?.innerText || '')`);
    if (now === last && now.length > 0) return now;
    last = now;
    await sleep(700);
  }
  return last;
}
async function threeCdView(engagement) {
  const opened = await waitFor(`Boolean(${byText('[role="tab"]', '3CD Clause Workspace')})`, 30000);
  // The page creates and seeds its audit on opening: wait until the 49 clauses are there and the text rests.
  const deadline = Date.now() + 30000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = sql({ c: [`SELECT c.clause_key FROM tax_audit_clause_responses c JOIN tax_audit_engagements a ON a.id = c.tax_audit_id WHERE a.engagement_id = ?`, engagement.id] }).c;
    if (rows.length >= 49) break;
    await sleep(500);
  }
  const clausesText = await stableMainText();
  const tabs = await evaluate(`[...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim())`);
  await clickReal(byText('[role="tab"]', 'Overview'));
  await waitFor(`${byText('[role="tab"]', 'Overview')}?.getAttribute('data-state') === 'active'`, 5000);
  const overviewText = await stableMainText();
  await clickReal(byText('[role="tab"]', '3CD Clause Workspace'));
  const db = sql({
    audits: [`SELECT statutory_version, form_type, financial_year, assessment_year, review_status FROM tax_audit_engagements WHERE engagement_id = ? ORDER BY statutory_version`, engagement.id],
    clauses: [`SELECT c.clause_key, c.clause_no, c.prefill_status, c.review_status, c.statutory_version FROM tax_audit_clause_responses c JOIN tax_audit_engagements a ON a.id = c.tax_audit_id WHERE a.engagement_id = ? ORDER BY c.clause_key`, engagement.id],
  });
  return { opened: Boolean(opened), view: { tabs, clausesText, overviewText, audits: db.audits, clauses: db.clauses } };
}
function firstDifference(a, b) {
  const x = String(a).split('\n'); const y = String(b).split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if (x[i] !== y[i]) return `line ${i + 1}: recorded ${JSON.stringify(x[i])} / now ${JSON.stringify(y[i])}`;
  return 'none';
}
function compareThreeCd(label, snapshot, view) {
  if (!snapshot) { check(`${label}: a recorded snapshot exists`, false, snapshotPath); return; }
  check(`${label}: tabs as today`, JSON.stringify(view.tabs) === JSON.stringify(snapshot.tabs), { recorded: snapshot.tabs, now: view.tabs });
  check(`${label}: badges "Income-tax Act, 1961" and "Rule 6G"`, /Income-tax Act, 1961/.test(view.clausesText) && /Rule 6G/.test(view.clausesText));
  check(`${label}: Clauses tab text equals the snapshot`, view.clausesText === snapshot.clausesText, firstDifference(snapshot.clausesText, view.clausesText));
  check(`${label}: Overview tab text equals the snapshot`, view.overviewText === snapshot.overviewText, firstDifference(snapshot.overviewText, view.overviewText));
  check(`${label}: the audit row equals the snapshot (one row, the Form 3CD key)`, JSON.stringify(view.audits) === JSON.stringify(snapshot.audits) && view.audits.length === 1 && view.audits[0].statutory_version !== F26, { recorded: snapshot.audits, now: view.audits });
  check(`${label}: the 49 seeded rows equal the snapshot (key, number, prefill, review)`, JSON.stringify(view.clauses) === JSON.stringify(snapshot.clauses) && view.clauses.length === 49, { recorded: snapshot.clauses.length, now: view.clauses.length });
  check(`${label}: no row with the Form No. 26 key`, !view.audits.some((a) => a.statutory_version === F26) && !view.clauses.some((c) => c.statutory_version === F26));
}

// ── Form No. 26 helpers ─────────────────────────────────────────────────────
const workspaceOpen = () => waitFor(`Boolean(document.querySelector('[data-f26-workspace]')) && document.body.innerText.includes('Income-tax Act, 2025')`, 30000);
async function selectClause(unitKey) {
  const ok = await evaluate(`(() => { const b = document.querySelector('[data-entry-id="${unitKey}"]'); if (!b) return false; b.click(); return true; })()`);
  await waitFor(`Boolean(document.getElementById('f26-editor-${unitKey}-title'))`, 8000);
  await sleep(300);
  return ok;
}
// A row of a row list is opened by its line (a real click), unless it is open already.
async function openListedRow(tableId, r) {
  const line = `document.getElementById('f26-t-${tableId}-row-${r}')`;
  if (await evaluate(`${line}?.getAttribute('aria-expanded') === 'true'`)) return true;
  await clickReal(line);
  return waitFor(`${line}?.getAttribute('aria-expanded') === 'true'`, 3000);
}
async function auditOf(engagementId) {
  return sql({ a: [`SELECT * FROM tax_audit_engagements WHERE engagement_id = ?`, engagementId] }).a;
}
function rowsOf(engagementId) {
  return sql({ r: [`SELECT c.* FROM tax_audit_clause_responses c JOIN tax_audit_engagements a ON a.id = c.tax_audit_id WHERE a.engagement_id = ? AND a.statutory_version = ?`, engagementId, F26] }).r;
}
function rowOf(engagementId, clauseKey) {
  return sql({ r: [`SELECT c.* FROM tax_audit_clause_responses c JOIN tax_audit_engagements a ON a.id = c.tax_audit_id WHERE a.engagement_id = ? AND a.statutory_version = ? AND c.clause_key = ?`, engagementId, F26, clauseKey] }).r[0];
}
const parsed = (row) => { try { return JSON.parse(row?.response_json || '{}'); } catch { return {}; } };
async function waitStored(engagementId, clauseKey, test, ms = 8000) {
  const end = Date.now() + ms;
  let row;
  while (Date.now() < end) {
    row = rowOf(engagementId, clauseKey);
    try { if (row && test(parsed(row), row)) return row; } catch { /* not yet */ }
    await sleep(300);
  }
  return null;
}
const SAVED = /^Saved \d{2}:\d{2}$/;
// The count on a filter chip of the clause list ("Evidence 1" -> 1).
const chipCount = (label) => evaluate(`(() => { const b = [...document.querySelectorAll('[role="group"][aria-label="Show"] button')].find((el) => el.firstChild && el.firstChild.textContent.trim() === ${JSON.stringify(label)}); return b ? Number(b.querySelector('span')?.textContent) : null; })()`);
// The list's switches sit behind its "View" button (POLISH-2): open it, flip the switch, close it with Esc.
// Returns the switch's state after the click ('checked' / 'unchecked'). (A build before POLISH-2 drew the
// switches in the list itself: then the switch is clicked where it is.)
async function setViewSwitch(domId) {
  const menu = await evaluate(`Boolean(document.querySelector('[data-f26-view-button]'))`);
  if (menu) {
    await clickReal(`document.querySelector('[data-f26-view-button]')`);
    await waitFor(`Boolean(document.getElementById(${JSON.stringify(domId)}))`, 5000);
  }
  const before = await evaluate(`document.getElementById(${JSON.stringify(domId)})?.getAttribute('data-state') || null`);
  await clickReal(`document.getElementById(${JSON.stringify(domId)})`);
  const after = await waitFor(`(() => { const s = document.getElementById(${JSON.stringify(domId)})?.getAttribute('data-state'); return s && s !== ${JSON.stringify(before)} ? s : false; })()`, 5000);
  if (menu) {
    await press('Escape');
    await waitFor(`!document.querySelector('[role="dialog"][aria-label="View"]')`, 3000);
  }
  return after;
}
const viewMark = () => evaluate(`document.querySelector('[data-f26-view-mark]')?.textContent.replace(/\\s+/g, ' ').trim() || ''`);

// Nothing wider than the window, and no heading, label or wording cut or spilling out of its box.
const FIT_CHECK = `(() => {
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute('data-entry-id') ? '[' + el.getAttribute('data-entry-id') + ']' : '') + ' "' + (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 50) + '"';
  const bad = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth) bad.push('page ' + de.scrollWidth + ' > ' + de.clientWidth);
  // The window itself never scrolls (only the page's own area does).
  if (de.scrollHeight > de.clientHeight + 1) bad.push('window taller than the screen ' + de.scrollHeight + ' > ' + de.clientHeight);
  const main = document.querySelector('main');
  const root = document.querySelector('[data-f26-workspace]');
  if (!root) return ['no workspace'];
  for (const el of [main, ...root.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) bad.push('sideways scroll ' + name(el) + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
  }
  for (const el of root.querySelectorAll('h1, h2, h3, label, p, dt, dd, th, td, button, [id$="-wording"], [data-question-row] > div')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || el.clientWidth <= 1 || el.closest('.sr-only') || el.offsetParent === null) continue;
    if (el.scrollWidth > el.clientWidth + 1) bad.push('cut ' + name(el) + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
  }
  return bad.slice(0, 12);
})()`;

// From 1280 px (POLISH-1): the page itself does not scroll, the header ends above the panes, and the
// panes' own tops (search, filter chips, the clause's title and review bar) are seen, not covered.
const PANES_CHECK = `(() => {
  const bad = [];
  const main = document.querySelector('main');
  const root = document.querySelector('[data-f26-workspace]');
  if (!main || !root) return ['no workspace'];
  if (main.scrollHeight > main.clientHeight + 1) bad.push('the page scrolls: ' + main.scrollHeight + ' > ' + main.clientHeight);
  if (main.scrollTop !== 0) bad.push('the page is scrolled by ' + main.scrollTop);
  const header = root.querySelector(':scope > header');
  const panes = root.querySelector('[data-f26-panes]');
  if (!header || !panes) return ['no header or panes'];
  const h = header.getBoundingClientRect();
  const p = panes.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  if (h.bottom > p.top + 0.5) bad.push('header bottom ' + h.bottom + ' > panes top ' + p.top);
  for (const pane of panes.children) {
    const r = pane.getBoundingClientRect();
    if (r.top < h.bottom - 0.5 || r.bottom > m.bottom + 0.5) bad.push('pane outside the page room ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' (header ' + Math.round(h.bottom) + ', page ' + Math.round(m.bottom) + ')');
  }
  const seen = (el, what) => {
    if (!el) { bad.push('no ' + what); return; }
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
    if (!hit || !(el === hit || el.contains(hit))) bad.push(what + ' covered or out of view');
  };
  seen(root.querySelector('input[aria-label="Search clauses"]'), 'search box');
  seen(root.querySelector('[role="group"][aria-label="Show"] button'), 'first filter chip');
  seen(root.querySelector('section[aria-labelledby^="f26-editor-"] h2'), "the clause's title");
  seen(root.querySelector('section[aria-labelledby^="f26-editor-"] > header button'), "the clause's review bar");
  return bad;
})()`;

// No heading has a word broken inside itself (a line may break between words, or after "/" or "-"): every
// piece of a heading's text lies on one line (POLISH-1: "transactio n" was seen at 1280 x 720).
const WORD_SPLIT_CHECK = `(() => {
  const bad = [];
  const root = document.querySelector('[data-f26-workspace]');
  if (!root) return ['no workspace'];
  const headings = root.querySelectorAll('thead th, thead td, [id^="f26-t-"] > div > div[aria-hidden="true"] span, h1, h2, h3, [role="tab"]');
  for (const el of headings) {
    if (el.offsetParent === null || el.closest('.sr-only')) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent;
      const pieces = /[^\\s/-]+[/-]?/g;
      let m;
      while ((m = pieces.exec(text))) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const tops = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.top);
        if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 4) bad.push('word broken: "' + m[0] + '" in ' + (el.closest('[id^="f26-t-"]')?.id || el.tagName.toLowerCase()));
      }
    }
  }
  return bad.slice(0, 12);
})()`;

// FIX-T29 D1: every fixed row of every fixed table drawn in the editor shows its pre-printed labels: in a row
// list on its line (whole, no word broken inside itself) and at the top of the row when it is open; in a grid
// in its first cells. EXPECTED = { tableId: [labels of row 1, …] } from the definition.
const FIXED_LABELS_CHECK = (expected) => `((expected) => {
  const out = { problems: [], rowList: 0, grid: 0, open: 0 };
  const norm = (t) => String(t || '').replace(/\\s+/g, ' ').trim();
  for (const [id, labels] of Object.entries(expected)) {
    const host = document.getElementById('f26-t-' + id);
    if (!host || !host.closest('[data-f26-editor-body]')) continue;
    const grid = host.querySelector('table');
    if (grid) {
      const rows = [...grid.querySelectorAll('tbody tr')];
      labels.forEach((label, r) => { if (!norm(rows[r] && rows[r].innerText).startsWith(label)) out.problems.push(id + '#' + r + ' grid: ' + norm(rows[r] && rows[r].innerText).slice(0, 60)); else out.grid += 1; });
      continue;
    }
    labels.forEach((label, r) => {
      const el = document.querySelector('#f26-t-' + id + '-row-' + r + ' [data-f26-row-labels]');
      if (!el) { out.problems.push(id + '#' + r + ': no labels on its line'); return; }
      if (norm(el.innerText) !== label) out.problems.push(id + '#' + r + ': "' + norm(el.innerText) + '"');
      const box = el.getBoundingClientRect();
      if (box.width < 1 || el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis') out.problems.push(id + '#' + r + ': cut');
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const pieces = /[^\\s/-]+[/-]?/g;
        let m;
        while ((m = pieces.exec(node.textContent))) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const tops = [...range.getClientRects()].filter((x) => x.width > 0).map((x) => x.top);
          if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 4) out.problems.push(id + '#' + r + ': word broken "' + m[0] + '"');
        }
      }
      out.rowList += 1;
      const form = document.getElementById('f26-t-' + id + '-row-' + r + '-form');
      if (form) {
        const title = form.querySelector('[data-f26-row-title]');
        if (!title || form.firstElementChild !== title || norm(title.innerText) !== label || form.getAttribute('aria-label') !== label) out.problems.push(id + '#' + r + ': open row title "' + norm(title && title.innerText) + '"');
        else out.open += 1;
      }
    });
  }
  return out;
})(${JSON.stringify(expected)})`;
// The fixed tables' labels as the definition holds them (src bundled on the fly with esbuild, as storedSaveFile does).
let fixedLabelsHeld = null;
function fixedLabels() {
  if (!fixedLabelsHeld) {
    const esbuild = require(path.join(projectRoot, 'node_modules', 'esbuild'));
    const contents = `import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
      export const labels = Object.fromEntries(DEF.tables.filter((t) => t.fixedRows && !t.dep).map((t) => [t.id, t.fixedRows.map((row) => row.join(' '))]));`;
    const out = esbuild.buildSync({ stdin: { contents, resolveDir: path.join(projectRoot, 'src'), loader: 'ts', sourcefile: 'fixed-labels.ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, alias: { '@': path.join(projectRoot, 'src') }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
    const holder = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(holder, holder.exports, require);
    fixedLabelsHeld = holder.exports.labels;
  }
  return fixedLabelsHeld;
}

// Focus a control deep in the clause (the last one of the editor) the way a jump does - brought into view
// with scrollIntoView, as the product's own focus helpers and this script's focus() do - then the clause's
// title and review bar must still be in view, and neither the page nor the editor's frame scrolled.
const DEEP_FOCUS_CHECK = `(() => {
  const bad = [];
  const body = document.querySelector('[data-f26-editor-body]');
  const section = body?.closest('section');
  const main = document.querySelector('main');
  const controls = body ? [...body.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((el) => el.offsetParent !== null) : [];
  const el = controls[controls.length - 1];
  if (!el) return ['no control to focus'];
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (document.activeElement !== el) bad.push('the control did not take focus');
  if (main.scrollTop !== 0) bad.push('the page scrolled by ' + main.scrollTop);
  if (section.scrollTop !== 0) bad.push("the editor's frame scrolled by " + section.scrollTop);
  const s = section.getBoundingClientRect();
  const header = section.querySelector(':scope > header');
  const h = header.getBoundingClientRect();
  if (h.top < s.top - 0.5 || h.bottom > s.bottom + 0.5) bad.push("the clause's heading left its frame");
  for (const [what, target] of [["the clause's title", header.querySelector('h2')], ["the clause's review bar", header.querySelector('button')]]) {
    const r = target.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
    if (!hit || !(target === hit || target.contains(hit))) bad.push(what + ' not in view');
  }
  const f = el.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  if (f.top < b.top - 0.5 || f.bottom > b.bottom + 0.5) bad.push('the focused control is not in view');
  return bad;
})()`;

// The working room (POLISH-2): how many list entries are seen whole in the list, and how tall the editor's
// scrolling body is on screen.
const ROOM_CHECK = `(() => {
  const nav = document.querySelector('nav[aria-label="Form No. 26 clauses"]');
  const body = document.querySelector('[data-f26-editor-body]');
  if (!nav || !body) return null;
  const n = nav.getBoundingClientRect();
  const entries = [...nav.querySelectorAll('[data-entry-id]')].filter((el) => el.offsetParent !== null);
  const whole = entries.filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= n.top - 0.5 && r.bottom <= n.bottom + 0.5; }).length;
  // Also those with at least one line (16 px) of their label on screen.
  const seen = entries.filter((el) => { const r = el.getBoundingClientRect(); return Math.min(r.bottom, n.bottom) - Math.max(r.top, n.top) >= 16; }).length;
  const b = body.getBoundingClientRect();
  return { entries: whole, seen, list: Math.round(n.height), editor: Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, 0)) };
})()`;

// ── The run ─────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(profilePath); fs.mkdirSync(downloadsPath); fs.mkdirSync(launchPath); fs.mkdirSync(shotsPath);
  fs.writeFileSync(path.join(launchPath, 'package.json'), JSON.stringify({ name: 'icai-vera-fsg-ui-tax-audit-harness', version: '1.0.0', main: entryPath }));
  console.log(`mode: ${MODE}`);

  await launch();
  await sleep(1500);
  check('schema applied without a start-up error', !/Database Initialization Error/.test(stdout), stdout.split('\n').filter((l) => /Error/.test(l)).join(' | '));

  const password = 'Invented-Tax-Audit-Password-Not-For-Use';
  const adminEmail = 'tax-audit-admin@example.invalid';
  const signup = await evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action: 'signup', email: adminEmail, password, fullName: 'Invented Tax Audit Admin' })})`);
  check('invented admin signed up', !signup.error && signup.data.role === 'admin', signup);
  const insert = async (table, data) => {
    let r = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table, action: 'insert', data })})`);
    // The application's own start-up can sign out (no stored session) just after the signup above: the session
    // is then gone and the insert refused. Seen in 3 of 6 runs on 22 Nov 2026 (POLISH-1). Sign in again, once.
    if (r.error && /Authentication required/.test(r.error.message)) {
      const login = await evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action: 'login', email: adminEmail, password })})`);
      if (login.error) throw new Error(`sign-in again: ${login.error.message}`);
      r = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table, action: 'insert', data })})`);
    }
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data[0];
  };
  const client = await insert('clients', { name: 'Invented Traders Private Limited', constitution: 'company', pan: 'AAAAA0000A' });
  const engagement = (year, name) => insert('engagements', { name, client_id: client.id, client_name: client.name, financial_year: year, engagement_type: 'tax', created_by: signup.data.user_id });
  const e24 = await engagement('2024-25', 'Tax audit 2024-25');
  const e25 = await engagement('2025-26', 'Tax audit 2025-26');
  const e26 = await engagement('2026-27', 'Tax audit 2026-27');
  const open = (eng) => openAsUser(adminEmail, password, eng, '#/tax-audit');

  // ── Scenario 1: Form 3CD exactly as today ──────────────────────────────
  // A build of the page before the chooser (--record) shows Form 3CD for 2026-27 too; it is recorded with the rest.
  errorPhase = '3cd';
  const threeCdEngagements = RECORD ? [e24, e25, e26] : [e24, e25];
  const recorded = RECORD ? {} : (fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : null);
  for (const eng of threeCdEngagements) {
    check(`signed in for ${eng.financial_year}`, await open(eng));
    if (!RECORD && eng === e24) {
      // The start-up label (task 28): the header's box names this update.
      const label = await evaluate(`document.querySelector('[data-testid="build-info-label"]')?.innerText.replace(/\\s+/g, ' ').trim() || ''`);
      check('the start-up label reads "Update: Tax Audit: Form No. 26"', label.includes('Update: Tax Audit: Form No. 26'), label);
      await screenshot('startup-label');
    }
    const { opened, view } = await threeCdView(eng);
    check(`${eng.financial_year} opens the Form 3CD screens`, opened);
    await screenshot(`3cd-${eng.financial_year}`);
    if (RECORD) recorded[eng.financial_year] = view;
    else compareThreeCd(`3CD ${eng.financial_year}`, recorded && recorded[eng.financial_year], view);
  }
  if (RECORD) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    const note = 'Recorded by scripts/test-tax-audit-ui.cjs --record from a build of src/pages/TaxAudit.tsx before the Form No. 26 chooser (task 19). Invented data only; dates, times and ids masked.';
    fs.writeFileSync(snapshotPath, `${JSON.stringify({ note, ...recorded }, null, 2)}\n`);
    check('snapshot written', fs.existsSync(snapshotPath), snapshotPath);
  }

  if (MODE === 'short') {
    // The released build: 2026-27 opens Form No. 26 (it opened Form 3CD while the switch was off).
    errorPhase = 'form26-short';
    check('signed in for 2026-27', await open(e26));
    const opened = await workspaceOpen();
    const text = await bodyText();
    check('2026-27 opens the Form No. 26 workspace, not the Form 3CD screens', opened && !text.includes('3CD Clause Workspace') && text.includes('Form No. 26 applies to tax years from 2026-27. This engagement is for 2026-27.'));
    await screenshot('f26-short-2026-27');
  }

  if (MODE === 'full') {
    await form26Scenarios({ open, insert, password, adminEmail, signup, client, e25, e26, engagement });
    // ── Scenario 18 (task 27): the earlier-year engagements again, after all of the Form No. 26 work ──
    errorPhase = '3cd-again';
    for (const eng of [e24, e25]) {
      check(`again at the end: signed in for ${eng.financial_year}`, await open(eng));
      const { opened, view } = await threeCdView(eng);
      check(`again at the end: ${eng.financial_year} opens the Form 3CD screens`, opened);
      await screenshot(`3cd-${eng.financial_year}-again`);
      compareThreeCd(`3CD ${eng.financial_year} again at the end`, recorded && recorded[eng.financial_year], view);
    }
  }

  errorPhase = 'end';
  const clean = await closeApp();
  check('the application closed through its window (no process left)', clean && child.exitCode !== null);
  const final = sql({ integrity: ['PRAGMA integrity_check'], fk: ['PRAGMA foreign_key_check'] });
  check('database integrity and foreign keys', final.integrity[0].integrity_check === 'ok' && final.fk.length === 0, final);

  // Failures this run forces on purpose (a write that fails, a refused save) are logged by the application as
  // errors; they are counted apart. Any other error fails the run.
  const forced = rendererErrors.filter((e) => String(e).startsWith('[form26-forced-failure]'));
  const unexpected = rendererErrors.filter((e) => !String(e).startsWith('[form26-forced-failure]'));
  if (forced.length) console.log(`  errors logged by the failures forced on purpose: ${forced.length}`);
  if (!RECORD) check('no renderer console errors (apart from the failures forced on purpose)', unexpected.length === 0, unexpected.slice(0, 5));
  const failed = results.filter((r) => !r.pass);
  if (rendererErrors.length) {
    console.log(`\nRenderer errors (${rendererErrors.length}, first 15):`);
    for (const e of rendererErrors.slice(0, 15)) console.log(`  - ${String(e).split('\n').slice(0, 4).join(' | ')}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`Screenshots and profile: ${runtimeRoot}`);
  process.exitCode = failed.length ? 1 : 0;
}

async function form26Scenarios({ open, insert, password, adminEmail, signup, client, e25, e26, engagement }) {
  // Last year (task 25): the 2025-26 Form 3CD audit of the same invented client, created when scenario 1
  // opened it, gets invented answers in its clause 13 (method of accounting) before Form No. 26 is opened.
  const audit25 = sql({ a: ['SELECT id FROM tax_audit_engagements WHERE engagement_id = ?', e25.id] }).a[0];
  const answers25 = JSON.stringify({ structured: { method_of_accounting: 'Mercantile', whether_change_in_method: 'no', change_details: 'Invented: no change in 2025-26' } });
  const seeded25 = audit25 && await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table: 'tax_audit_clause_responses', action: 'update', data: { response_json: answers25 }, filters: [{ column: 'tax_audit_id', operator: 'eq', value: audit25.id }, { column: 'clause_key', operator: 'eq', value: 'clause_13' }] })})`);
  check('last year: the 2025-26 Form 3CD audit of the same client holds invented clause 13 answers', audit25 && seeded25 && !seeded25.error && sql({ r: ["SELECT response_json FROM tax_audit_clause_responses WHERE tax_audit_id = ? AND clause_key = 'clause_13'", audit25.id] }).r[0]?.response_json === answers25, seeded25 && seeded25.error);
  const rows25 = () => sql({ r: ['SELECT c.id, c.clause_key, c.response_json, c.review_status, c.updated_at FROM tax_audit_clause_responses c JOIN tax_audit_engagements a ON a.id = c.tax_audit_id WHERE a.engagement_id = ? ORDER BY c.clause_key', e25.id], a: ['SELECT id, statutory_version, updated_at, setup_json FROM tax_audit_engagements WHERE engagement_id = ?', e25.id] });
  const before25 = JSON.stringify(rows25());
  const eYear = await engagement('Year 26', 'Tax audit, year typed by hand');
  const eKeys = await engagement('2026-27', 'Tax audit 2026-27 (keyboard and fit)');
  const evidence = await insert('evidence_files', { engagement_id: e26.id, name: 'Invented penalty order.pdf', file_path: `${e26.id}/invented-penalty-order.pdf`, file_type: 'document', mime_type: 'application/pdf', file_size: 1024, uploaded_by: signup.data.user_id });

  // ── Scenario 2: Form No. 26 opens ──────────────────────────────────────
  errorPhase = 'form26-open';
  await open(e26);
  check('2026-27 opens the Form No. 26 workspace', await workspaceOpen());
  const header = await evaluate(`[...document.querySelectorAll('[data-f26-workspace] header .inline-flex, [data-f26-workspace] header [class*="badge"]')].map((b) => b.textContent.trim())`);
  const text = await bodyText();
  for (const badge of ['Form No. 26', 'Income-tax Act, 2025', 'Rule 47', 'Category (ii)']) check(`header badge "${badge}"`, header.includes(badge) || text.includes(badge), header);
  check('the sentence of why Form No. 26 applies', text.includes('Form No. 26 applies to tax years from 2026-27. This engagement is for 2026-27.'));
  check('"Next unfilled" shows 42 (45 less the three prefilled particulars)', /Next unfilled · 42\b/.test(text), (text.match(/Next unfilled[^\n]*/) || [''])[0]);
  const groups = await evaluate(`[...document.querySelectorAll('nav[aria-label="Form No. 26 clauses"] > div > button')].map((b) => b.textContent.replace(/\\d+ unfilled/, '').trim())`);
  check('the list shows the groups of the form', groups.length >= 12 && groups[0] === 'Audit report', groups);
  await screenshot('f26-01-open');
  // POLISH-2: "Clauses · What changed" sits in the header beside the title (same line), no band of its own;
  // the arrow keys move between them; the list's three switches are behind "View".
  const views = await evaluate(`(() => {
    const root = document.querySelector('[data-f26-workspace]');
    const header = root.querySelector(':scope > header');
    const list = header?.querySelector('[role="tablist"]');
    const h1 = header?.querySelector('h1');
    if (!list || !h1) return null;
    const l = list.getBoundingClientRect(); const h = h1.getBoundingClientRect();
    const between = [...root.children].filter((el) => el !== header && el.getAttribute('role') === 'tablist').length;
    return { tabs: [...list.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()), sameLine: l.top >= h.top - 4 && l.bottom <= h.bottom + 4, right: l.left > h.right, height: Math.round(l.height), between, name: list.getAttribute('aria-label') };
  })()`);
  check('the views "Clauses · What changed · Review Summary" sit in the header beside the title, in its line, 28 px high; no tab band under the header', views && JSON.stringify(views.tabs) === JSON.stringify(['Clauses', 'What changed', 'Review Summary']) && views.sameLine && views.right && views.height <= 28 && views.between === 0, views);
  await evaluate(`(document.querySelector('[data-f26-workspace] header [role="tab"][data-state="active"]')?.focus(), true)`);
  await press('ArrowRight');
  const viaKeys = await waitFor(`${byText('[data-f26-workspace] header [role="tab"]', 'What changed')}?.getAttribute('data-state') === 'active' && document.activeElement?.textContent.trim() === 'What changed' && Boolean(document.querySelector('[data-f26-what-changed]'))`, 5000);
  await press('ArrowLeft');
  const backViaKeys = await waitFor(`${byText('[data-f26-workspace] header [role="tab"]', 'Clauses')}?.getAttribute('data-state') === 'active' && Boolean(document.querySelector('[data-f26-editor-body]'))`, 5000);
  check('the views by keyboard: Right arrow opens "What changed", Left arrow goes back to "Clauses"', viaKeys && backViaKeys);
  const viewButton = await evaluate(`(() => { const b = document.querySelector('[data-f26-view-button]'); if (!b) return null; const d = document.getElementById(b.getAttribute('aria-describedby')); const t = b.closest('div.flex')?.parentElement; return { text: b.textContent.trim(), popup: b.getAttribute('aria-haspopup'), expanded: b.getAttribute('aria-expanded'), described: d?.textContent, mark: Boolean(b.querySelector('[data-f26-view-mark]')), switchesInList: document.querySelectorAll('nav[aria-label="Form No. 26 clauses"] ~ * [role="switch"], [data-f26-workspace] [role="switch"]').length }; })()`);
  check('"View" in the list\'s title row: a popup button, its state in words, no mark in the usual view, no switch drawn in the list', viewButton && viewButton.text === 'View' && viewButton.popup === 'dialog' && viewButton.expanded === 'false' && viewButton.described === 'Highlight unfilled: on. Show all schedules: off. Show Form 3CD notes: on.' && !viewButton.mark && viewButton.switchesInList === 0, viewButton);
  await evaluate(`(document.querySelector('[data-f26-view-button]')?.focus(), true)`);
  await press('Enter');
  const viewOpen = await waitFor(`(() => { const d = document.querySelector('[role="dialog"][aria-label="View"]'); if (!d) return false; const labels = [...d.querySelectorAll('label')].map((l) => l.textContent.trim()); const states = [...d.querySelectorAll('[role="switch"]')].map((x) => x.id + '=' + x.getAttribute('aria-checked')); return labels.length === 3 && d.contains(document.activeElement) ? { labels, states, focused: document.activeElement.id } : false; })()`, 5000);
  check('"View" opens by keyboard: the three switches labelled as before, with their states, the keyboard inside', viewOpen && JSON.stringify(viewOpen.labels) === JSON.stringify(['Highlight unfilled', 'Show all schedules', 'Show Form 3CD notes']) && JSON.stringify(viewOpen.states) === JSON.stringify(['f26-highlight-unfilled=true', 'f26-show-all-schedules=false', 'f26-show-comparison=true']), viewOpen);
  await screenshot('f26-12-view-open');
  await press('Escape');
  check('Esc closes "View" and puts the keyboard back on its button', await waitFor(`!document.querySelector('[role="dialog"][aria-label="View"]') && document.activeElement?.hasAttribute('data-f26-view-button')`, 3000));
  let audits = await auditOf(e26.id);
  let rows = rowsOf(e26.id);
  check('one audit row with the Form No. 26 key and form_type 3CB', audits.length === 1 && audits[0].statutory_version === F26 && audits[0].form_type === '3CB', audits.map((a) => [a.statutory_version, a.form_type]));
  check('122 clause rows, every one with the Form No. 26 key', rows.length === 122 && rows.every((r) => r.statutory_version === F26 && r.clause_key.startsWith('f26_')), rows.length);
  const auditId = audits[0] && audits[0].id;

  // ── Scenario 11: the comparison with Form 3CD (task 25) ───────────────
  errorPhase = 'form26-compare';
  await selectClause('f26_c15');
  const line15 = await evaluate(`[...document.querySelectorAll('[data-f26-editor-body] [data-f26-comparison]')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())`);
  check('the line under clause 15: "Was Form 3CD clause 13(a)–(c) · No change in substance." with "Last year"', line15.length === 1 && line15[0] === 'Was Form 3CD clause 13(a)–(c) · No change in substance. Last year', line15);
  await selectClause('f26_c39');
  const line39 = await evaluate(`[...document.querySelectorAll('[data-f26-editor-body] [data-f26-comparison]')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())`);
  check('the line under the new clause 39: "New in Form No. 26." and no "Last year" link', line39.length === 1 && line39[0] === 'New in Form No. 26.' && !(await evaluate(`Boolean(document.querySelector('[data-f26-last-year-link]'))`)), line39);
  await screenshot('f26-08-line-new-clause-39');
  await selectClause('f26_c14');
  const line14 = await evaluate(`[...document.querySelectorAll('[data-f26-editor-body] [data-f26-comparison]')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())`);
  check('clause 14: the line of "13, 14(a)" under 14(a), and the new 14(b)–(e) under 14(b)', line14.length === 2 && line14[0].startsWith('Was Form 3CD clause 11 · ') && line14[1] === 'New in Form No. 26. Digital trail of books is now a reporting item.', line14);

  await selectClause('f26_c15');
  await clickReal(`document.querySelector('[data-f26-editor-body] [data-f26-last-year-link]')`);
  const lastYearShown = await waitFor(`(() => { const block = document.querySelector('[data-f26-last-year-answers="clause_13"]'); return block && /Method of accounting\\s+Mercantile/.test(block.innerText) && /Change in method\\s+No/.test(block.innerText) ? block.innerText : false; })()`, 15000);
  check('"Last year" opens the pane\'s tab: 2025-26 Form 3CD clause 13 answers of the same client, as text', lastYearShown, await evaluate(`document.querySelector('[data-f26-last-year]')?.innerText || 'no pane'`));
  const lastYearPane = await evaluate(`(() => { const pane = document.querySelector('[data-f26-last-year]'); if (!pane) return null; return { text: pane.innerText, controls: pane.querySelectorAll('input, select, textarea').length, buttons: [...pane.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()), tabActive: document.querySelector('[data-f26-pane-tab="last-year"]')?.getAttribute('data-state'), focused: document.activeElement?.getAttribute('data-f26-pane-tab') }; })()`);
  check('"Last year": headed "Form 3CD of 2025-26", with Form 3CD clause 13(a)–(c) and both sections', lastYearPane && lastYearPane.text.includes('Form 3CD of 2025-26') && lastYearPane.text.includes('Form 3CD clause 13(a)–(c)') && lastYearPane.text.includes('Section (1961 Act): 145'), lastYearPane);
  check('"Last year" is read only: no box, no copy, no button (the fold is in the pane\'s title row); its tab is active and has the keyboard', lastYearPane && lastYearPane.controls === 0 && lastYearPane.buttons.length === 0 && !/copy/i.test(lastYearPane.text) && lastYearPane.tabActive === 'active' && lastYearPane.focused === 'last-year', lastYearPane);
  const paneTitle = await evaluate(`(() => { const row = document.querySelector('[data-f26-pane-title]'); if (!row) return null; const tabs = row.querySelector('[role="tablist"]').getBoundingClientRect(); const fold = row.querySelector('button[aria-label="Collapse evidence pane"]'); const f = fold?.getBoundingClientRect(); const pane = row.closest('section'); return { name: pane?.getAttribute('aria-label'), firstInPane: pane?.querySelector('[data-f26-pane-title]') === row && row.getBoundingClientRect().top - pane.getBoundingClientRect().top <= 2, height: Math.round(row.getBoundingClientRect().height), sameRow: Boolean(f) && Math.abs((f.top + f.bottom) / 2 - (tabs.top + tabs.bottom) / 2) <= 2 }; })()`);
  check('the pane\'s tabs "Evidence · Last year" are its title row (top of the pane, with the fold button, at most 48 px); the pane is still named "Sources, Evidence and Review"', paneTitle && paneTitle.name === 'Sources, Evidence and Review' && paneTitle.firstInPane && paneTitle.sameRow && paneTitle.height <= 48, paneTitle);
  check('reading last year wrote nothing to the 2025-26 audit', JSON.stringify(rows25()) === before25);
  await screenshot('f26-09-last-year-clause-15');
  await selectClause('f26_c39');
  check('"Last year" for the new clause 39 says so plainly', await waitFor(`document.querySelector('[data-f26-last-year]')?.innerText.includes('Clause 39 is new in Form No. 26. There is no Form 3CD answer for it.')`, 5000));
  await clickReal(`document.querySelector('[data-f26-pane-tab="evidence"]')`);
  check('the pane goes back to "Evidence"', await waitFor(`document.querySelector('[data-f26-pane-tab="evidence"]')?.getAttribute('data-state') === 'active' && document.querySelector('[data-f26-workspace]').innerText.includes('Linked Evidence')`, 5000));
  // The page's rail draws its body only under the pane's title row: its own title row and frame are not shown.
  const railBody = await evaluate(`(() => { const panel = document.querySelector('section[aria-label="Sources, Evidence and Review"] [role="tabpanel"][data-state="active"]'); const rail = panel?.firstElementChild; if (!rail) return null; const own = rail.firstElementChild; return { ownTitleShown: own ? getComputedStyle(own).display !== 'none' : null, ownText: own?.textContent.trim().slice(0, 60), border: getComputedStyle(rail).borderTopWidth, text: panel.innerText.slice(0, 40) }; })()`);
  check('in "Evidence" the rail starts at "Linked Evidence": its own title row and frame give way to the pane\'s', railBody && railBody.ownTitleShown === false && /^Sources, Evidence and Review/.test(railBody.ownText) && railBody.border === '0px' && railBody.text.startsWith('Linked Evidence'), railBody);

  // "What changed": the tab, its chips and counts, a filter, the briefing, a clause opened from it.
  await clickReal(byText('[data-f26-workspace] [role="tab"]', 'What changed'));
  check('"What changed" opens from its tab', await waitFor(`Boolean(document.querySelector('[data-f26-what-changed]'))`, 8000));
  const chips = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-f26-change-chip]')].map((b) => [b.getAttribute('data-f26-change-chip'), Number(b.querySelector('span')?.textContent)]))`);
  const listed = async () => evaluate(`document.querySelectorAll('[data-f26-what-changed] tbody tr').length`);
  check('chips count right: All 52, New 6, Changed 33, Same 13, Not in Form 26 15; All lists 52', JSON.stringify(chips) === JSON.stringify({ all: 52, new: 6, changed: 33, same: 13, 'not-in-form26': 15 }) && (await listed()) === 52, { chips, listed: await listed() });
  await clickReal(`document.querySelector('[data-f26-change-chip="new"]')`);
  const newRows = await waitFor(`(() => { const rows = [...document.querySelectorAll('[data-f26-what-changed] tbody tr')]; return rows.length === 6 ? rows.map((r) => r.getAttribute('data-f26-change-row')) : false; })()`, 5000);
  check('the New filter lists its 6 rows', JSON.stringify(newRows) === JSON.stringify(['m14be', 'm39', 'm42', 'm43', 'm44', 'm51bd']), newRows);
  await clickReal(`document.querySelector('[data-f26-change-chip="not-in-form26"]')`);
  check('the "Not in Form 26" filter lists 15 Form 3CD clauses', await waitFor(`document.querySelectorAll('[data-f26-what-changed] tbody tr').length === 15 && document.querySelector('[data-f26-what-changed]').innerText.includes('Where it is now')`, 5000));
  await clickReal(`document.querySelector('[data-f26-change-chip="new"]')`);
  await waitFor(`document.querySelectorAll('[data-f26-what-changed] tbody tr').length === 6`, 5000);
  const briefingName = 'Form26_vs_Form3CD_what_changed_new.docx';
  await forget(briefingName);
  await clickReal(`document.querySelector('[data-f26-briefing]')`);
  const briefing = await downloaded(briefingName, 15000);
  const briefingAsked = (await saveAsked()).filter((a) => a.suggestedName === briefingName);
  check('the briefing asks "Save As" with its own name and the Word type', briefingAsked.length === 1 && briefingAsked[0].types[0].description === 'Word document' && JSON.stringify(briefingAsked[0].types[0].accept) === JSON.stringify({ 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }), briefingAsked);
  let briefingText = '';
  if (briefing) {
    const JSZip = require(path.join(projectRoot, 'node_modules', 'jszip'));
    const zip = await JSZip.loadAsync(briefing);
    const xml = await zip.file('word/document.xml').async('string');
    briefingText = (xml.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]*>/g, '')).join(' ');
  }
  check(`the briefing is saved through "Save As" (${briefingName})`, Boolean(briefing));
  check('the briefing holds the title and the six New rows, no hedging', briefingText.startsWith('Form No. 26 and Form No. 3CD: what changed') && briefingText.includes('Digital trail of books is now a reporting item.') && briefingText.includes('Reversal reporting.') && !/our reading|to be verified|†/i.test(briefingText), briefingText.slice(0, 300));
  await screenshot('f26-10-what-changed-new');
  for (const [width, height] of [[1280, 720], [1600, 900]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    for (const chip of ['all', 'not-in-form26']) {
      await clickReal(`document.querySelector('[data-f26-change-chip="${chip}"]')`);
      await sleep(400);
      const bad = await evaluate(FIT_CHECK);
      const split = await evaluate(WORD_SPLIT_CHECK);
      check(`"What changed" (${chip}) at ${width}x${height}: no sideways scroll, window not scrolled, nothing cut, no heading word broken`, bad.length === 0 && split.length === 0, { bad, split });
      await screenshot(`f26-11-what-changed-${chip}-${width}x${height}`);
    }
  }
  await cdp('Emulation.clearDeviceMetricsOverride');
  await sleep(500);
  await clickReal(`document.querySelector('[data-f26-change-chip="all"]')`);
  await clickReal(`document.querySelector('[data-f26-open-clause="22"]')`);
  check('a Form 26 clause in "What changed" opens it in "Clauses"', await waitFor(`Boolean(document.getElementById('f26-editor-f26_c22-title')) && ${byText('[data-f26-workspace] [role="tab"]', 'Clauses')}?.getAttribute('data-state') === 'active'`, 8000));

  // The one switch: off removes the line and the "Last year" tab; on brings them back.
  const notesOff = await setViewSwitch('f26-show-comparison');
  check('"Show Form 3CD notes" switched off through "View"; the button now carries the mark "1"', notesOff === 'unchecked' && (await viewMark()) === '1 setting changed', { notesOff, mark: await viewMark() });
  check('"Show Form 3CD notes" off: no line under clause 22, no "Last year" tab; "What changed" stays', await waitFor(`!document.querySelector('[data-f26-comparison]') && !document.querySelector('[data-f26-pane-tab]') && Boolean(${byText('[data-f26-workspace] [role="tab"]', 'What changed')})`, 5000));
  check('"Show Form 3CD notes" on again through "View"; no mark', (await setViewSwitch('f26-show-comparison')) === 'checked' && (await viewMark()) === '');
  check('"Show Form 3CD notes" on again: the line and the tab are back', await waitFor(`Boolean(document.querySelector('[data-f26-comparison]')) && Boolean(document.querySelector('[data-f26-pane-tab="last-year"]'))`, 5000));
  check('the comparison wrote nothing to the database (no Form 26 row changed, no 3CD row changed)', JSON.stringify(rows25()) === before25 && rowsOf(e26.id).every((r) => r.updated_at === r.created_at || r.clause_key === 'f26_category'), rowsOf(e26.id).filter((r) => r.updated_at !== r.created_at).map((r) => r.clause_key));

  // ── Scenario 3: fill answers of different kinds; each is stored on leaving ──
  errorPhase = 'form26-fill';
  await selectClause('f26_p2');
  await typeInto('f26-f-C-a3', 'Invented Road 1');
  await press('Tab');
  let stored = await waitStored(e26.id, 'f26_p2', (p) => p.f['C.a3'] === 'Invented Road 1');
  check('text: item 2 "Road/Street/Block/Sector" stored on leaving the box', stored, parsed(rowOf(e26.id, 'f26_p2')));
  check('header reads "Saved HH:MM"', SAVED.test(await saveLine()), await saveLine());

  await selectClause('f26_c14');
  await focus('f26-f-c14d');
  await press('n');
  stored = await waitStored(e26.id, 'f26_c14', (p) => p.f.c14d === 'No');
  check('yes/no: 14(d) set to No and stored', stored && (await valueOf('f26-f-c14d')) === 'No', parsed(rowOf(e26.id, 'f26_c14')));
  check('14(e) stays asked after 14(d) No', await evaluate(`Boolean(document.getElementById('f26-f-c14e'))`));

  await selectClause('f26_c28');
  await focus('f26-f-c28');
  await press('y');
  check('yes/no opening a schedule: 28 Yes shows schedule 28 with two rows', await waitFor(`Boolean(document.getElementById('f26-t-S28-1-1')) && !document.getElementById('f26-t-S28-2-1')`, 5000));
  await typeInto('f26-t-S28-0-1', 'Invented Law A');
  await typeInto('f26-t-S28-0-2', '1');
  await typeInto('f26-t-S28-0-3', '700');
  await typeInto('f26-t-S28-1-1', 'Invented Law B');
  await typeInto('f26-t-S28-1-2', '2');
  await typeInto('f26-t-S28-1-3', '300');
  await focus('f26-f-c28');                                 // leave the table
  const total28 = await waitFor(`(() => { const t = [...document.querySelectorAll('#f26-t-S28 tfoot td, #f26-t-S28 dd')].map((c) => c.textContent.trim()).filter(Boolean); return t.includes('1,000') ? t : false; })()`, 5000);
  check('table total reads "1,000"', total28, await evaluate(`[...document.querySelectorAll('#f26-t-S28 tfoot td, #f26-t-S28 dd')].map((c) => c.textContent.trim())`));
  stored = await waitStored(e26.id, 'f26_t_S28', (p) => p.rows[0]['3'] === '700' && p.rows[1]['3'] === '300' && p.rows[1]['1'] === 'Invented Law B');
  check('table rows of schedule 28 stored (its own row)', stored, parsed(rowOf(e26.id, 'f26_t_S28')));
  check('answer 28 Yes stored in the clause row', parsed(rowOf(e26.id, 'f26_c28')).f?.c28 === 'Yes');
  check('header reads "Saved HH:MM" after the table', SAVED.test(await saveLine()), await saveLine());

  await selectClause('f26_c15');
  await focus('f26-f-c15b');
  await press('y');
  check('15(b) Yes opens its schedule', await waitFor(`Boolean(document.getElementById('f26-t-S15b-0-2'))`, 5000));
  await typeInto('f26-t-S15b-0-1', 'Invented change of method');
  await typeInto('f26-t-S15b-0-2', '1234.567');
  await typeInto('f26-t-S15b-0-3', '234.561');
  await sleep(200);
  const net = await valueOf('f26-t-S15b-0-4');
  check('calculation: net effect reads 1000.01', net === '1000.01', net);
  await focus('f26-f-c15b');
  const totals15 = await evaluate(`[...document.querySelectorAll('#f26-t-S15b tfoot td, #f26-t-S15b dd')].map((c) => c.textContent.trim())`);
  check('totals of schedule 15(b) shown (net 1,000.01)', totals15.some((t) => t === '1,000.01'), totals15);
  stored = await waitStored(e26.id, 'f26_t_S15b', (p) => p.rows[0]['4'] === '1000.01' && p.rows[0]['2'] === '1234.567');
  check('schedule 15(b) stored with its calculated figure', stored, parsed(rowOf(e26.id, 'f26_t_S15b')).rows?.[0]);

  await selectClause('f26_c45');
  await focus('f26-f-c45a');
  await press('y');
  check('45(a) Yes shows its row list (first row open)', await waitFor(`Boolean(document.getElementById('f26-t-S45a-0-9'))`, 5000));
  await choose('f26-t-S45a-0-1', 'Loan');
  await typeInto('f26-t-S45a-0-2', 'Invented Payer');
  await typeInto('f26-t-S45a-0-3', 'AAAAA0000A');
  await typeInto('f26-t-S45a-0-5', '5000');
  await choose('f26-t-S45a-0-6', 'Yes');
  await choose('f26-t-S45a-0-7', 'No');
  await typeInto('f26-t-S45a-0-8', '5000');
  await choose('f26-t-S45a-0-9', 'A - Cash payment');
  await focus('f26-f-c45a');
  stored = await waitStored(e26.id, 'f26_t_S45a', (p) => p.rows[0]['1'] === 'Loan' && p.rows[0]['9'] === 'A - Cash payment' && p.rows[0]['2'] === 'Invented Payer');
  check('a row of the ten-column table 45(a) filled and stored', stored, parsed(rowOf(e26.id, 'f26_t_S45a')).rows?.[0]);
  await screenshot('f26-02-clause45-filled');
  check('still 122 rows after filling', rowsOf(e26.id).length === 122);

  // ── Scenario 6: evidence on clause 28 ─────────────────────────────────
  errorPhase = 'form26-evidence';
  await selectClause('f26_c28');
  await clickReal(`[...document.querySelectorAll('[role="combobox"]')].find((el) => el.closest('[data-f26-workspace]'))`);
  await waitFor(`Boolean(${byText('[role="option"]', 'Invented penalty order.pdf')})`, 5000);
  await clickReal(byText('[role="option"]', 'Invented penalty order.pdf'));
  await clickReal(byText('[data-f26-workspace] button', 'Attach'));
  let links = [];
  for (let i = 0; i < 20 && links.length === 0; i += 1) { await sleep(300); links = sql({ l: ['SELECT * FROM tax_audit_clause_evidence WHERE tax_audit_id = ?', auditId] }).l; }
  check('evidence linked to clause 28 (clause key, working paper, linked by)', links.length === 1 && links[0].clause_key === 'f26_c28' && links[0].workpaper_ref === 'TA-F26-28' && links[0].evidence_file_id === evidence.id && links[0].linked_by === signup.data.user_id, links);
  check('the pane lists the linked file', await waitFor(`(() => { const t = document.querySelector('section[aria-label="Sources, Evidence and Review"]')?.innerText || document.querySelector('[data-f26-workspace]').innerText; return t.includes('Invented penalty order.pdf') && t.includes('Remove link'); })()`, 5000));
  // Clause 28 and its schedule entry 28 are both listed; the one link counts once (POLISH-1: it read "Evidence 2").
  check('one link: the "Evidence" chip reads 1 although clause 28 and its schedule are both listed', (await chipCount('Evidence')) === 1 && (await evaluate(`Boolean(document.querySelector('[data-entry-id="s28"]'))`)), { evidence: await chipCount('Evidence') });
  await screenshot('f26-03-evidence-linked');
  await clickReal(byText('[data-f26-workspace] button', 'Remove link'));
  for (let i = 0; i < 20 && links.length > 0; i += 1) { await sleep(300); links = sql({ l: ['SELECT * FROM tax_audit_clause_evidence WHERE tax_audit_id = ?', auditId] }).l; }
  check('evidence unlinked (row removed)', links.length === 0, links);
  check('the pane says no evidence is linked', await waitFor(`document.querySelector('[data-f26-workspace]').innerText.includes('No evidence linked to this clause.')`, 5000));

  // ── Scenario 4: restart ───────────────────────────────────────────────
  errorPhase = 'form26-restart';
  check('the application closes with nothing waiting (no hold)', await closeApp());
  await launch();
  await sleep(1500);
  await open(e26);
  check('after a restart the workspace opens again', await workspaceOpen());
  await selectClause('f26_p2');
  check('after restart: item 2 road on screen', (await valueOf('f26-f-C-a3')) === 'Invented Road 1', await valueOf('f26-f-C-a3'));
  await selectClause('f26_c14');
  check('after restart: 14(d) No on screen', (await valueOf('f26-f-c14d')) === 'No');
  await selectClause('f26_c28');
  check('after restart: 28 Yes and its two rows on screen', (await valueOf('f26-f-c28')) === 'Yes' && (await valueOf('f26-t-S28-0-3')) === '700' && (await valueOf('f26-t-S28-1-1')) === 'Invented Law B');
  await selectClause('f26_c15');
  // A row list opens the first row that still needs something; a complete row is opened by its line.
  check('after restart: the 15(b) row is listed as complete', await evaluate(`/Complete/.test(document.getElementById('f26-t-S15b-row-0')?.getAttribute('aria-label') || '')`));
  await openListedRow('S15b', 0);
  check('after restart: 15(b) figures and net on screen', (await valueOf('f26-t-S15b-0-2')) === '1234.567' && (await valueOf('f26-t-S15b-0-4')) === '1000.01', [await valueOf('f26-t-S15b-0-2'), await valueOf('f26-t-S15b-0-4')]);
  await selectClause('f26_c45');
  await openListedRow('S45a', 0);
  check('after restart: the 45(a) row on screen', (await valueOf('f26-t-S45a-0-2')) === 'Invented Payer' && (await valueOf('f26-t-S45a-0-9')) === 'A - Cash payment', [await valueOf('f26-t-S45a-0-2'), await valueOf('f26-t-S45a-0-9')]);
  rows = rowsOf(e26.id);
  audits = await auditOf(e26.id);
  check('after restart: still one audit row and 122 clause rows (nothing inserted again)', audits.length === 1 && rows.length === 122, [audits.length, rows.length]);

  // ── Scenario 5: review and lock clause 28 ─────────────────────────────
  errorPhase = 'form26-review';
  await selectClause('f26_c28');
  const mark = async (label, status) => {
    await clickReal(byText('[data-f26-workspace] section header button', label));
    let row;
    for (let i = 0; i < 25; i += 1) { row = rowOf(e26.id, 'f26_c28'); if (row.review_status === status) break; await sleep(300); }
    return row;
  };
  let r28 = await mark('Prepared', 'prepared');
  check('Prepared stored with its stamp', r28.review_status === 'prepared' && r28.prepared_by === signup.data.user_id && r28.prepared_at, [r28.review_status, r28.prepared_by]);
  r28 = await mark('Reviewed', 'reviewed');
  check('Reviewed stored with its stamp', r28.review_status === 'reviewed' && r28.reviewed_by === signup.data.user_id && r28.reviewed_at);
  r28 = await mark('Approve', 'approved');
  check('Approve stored: approved, locked 1, stamps set', r28.review_status === 'approved' && Number(r28.locked) === 1 && r28.approved_by === signup.data.user_id && r28.approved_at, [r28.review_status, r28.locked, r28.approved_by]);
  await sleep(500);
  const readOnly = await evaluate(`(() => { const a = document.getElementById('f26-f-c28'); const cells = [...document.querySelectorAll('#f26-t-S28 input, #f26-t-S28 select')]; return { answer: a && a.disabled, cells: cells.length > 0 && cells.every((c) => c.disabled || c.readOnly), edit: Boolean(${byText('[data-f26-workspace] section header button', 'Edit')}) }; })()`);
  check('approved: the answer and schedule 28 are read-only, "Edit" offered', readOnly.answer && readOnly.cells && readOnly.edit, readOnly);
  // No empty column at the right edge of the locked table (POLISH-1): every column has its heading and its
  // cells, the last cell of each row holds a figure box, and the table's last column is the file's (D).
  const lockedTable = await evaluate(`(() => {
    const t = document.querySelector('#f26-t-S28 table');
    if (!t) return null;
    const lastCells = [...t.querySelectorAll('tbody tr')].map((tr) => tr.lastElementChild);
    return {
      cols: t.querySelectorAll('col').length,
      deleteHeading: Boolean(t.querySelector('thead .sr-only')),
      lastCellsFilled: lastCells.length > 0 && lastCells.every((td) => Boolean(td.querySelector('input'))),
      lastHeading: t.querySelector('thead tr:last-child')?.lastElementChild?.textContent.trim(),
      rightGap: Math.round(t.getBoundingClientRect().right - lastCells[0].getBoundingClientRect().right),
    };
  })()`);
  check('approved: no empty column reserved at the right of the locked table', lockedTable && lockedTable.cols === 4 && !lockedTable.deleteHeading && lockedTable.lastCellsFilled && lockedTable.lastHeading === '(D)' && lockedTable.rightGap <= 1, lockedTable);
  check('approved: the "Reviewed" chip counts clause 28 once (its schedule entry is listed too)', (await chipCount('Reviewed')) === 1, { reviewed: await chipCount('Reviewed') });
  await screenshot('f26-04-clause28-approved');
  await clickReal(byText('[data-f26-workspace] section header button', 'Edit'));
  await waitFor(`Boolean(document.querySelector('[role="dialog"] textarea'))`, 5000);
  await focus(await evaluate(`document.querySelector('[role="dialog"] textarea').id`));
  await type('Invented reason');
  await clickReal(byText('[role="dialog"] button', 'Enable Edit'));
  for (let i = 0; i < 25; i += 1) { r28 = rowOf(e26.id, 'f26_c28'); if (Number(r28.locked) === 0) break; await sleep(300); }
  check('unlocked with the reason stored', Number(r28.locked) === 0 && r28.unlock_reason === 'Invented reason' && r28.review_status !== 'approved', [r28.locked, r28.unlock_reason, r28.review_status]);
  check('editable again after unlocking', await waitFor(`!document.getElementById('f26-f-c28').disabled && !document.getElementById('f26-t-S28-0-1').disabled && !document.getElementById('f26-t-S28-0-1').readOnly`, 5000));

  // ── Window close (lead's ruling): held, saved, announced; the second close goes through ──
  errorPhase = 'form26-close';
  await selectClause('f26_p2');
  await typeInto('f26-f-C-a4', 'Invented Area');            // typed, the box NOT left
  await closeWindow();
  const heldMessage = await waitFor(`document.body.innerText.includes(${JSON.stringify(CLOSE_SAVED)})`, 8000);
  check('close with a typed box not left: the window stays open', (await windowCount()) === 1);
  check(`close held, then "${CLOSE_SAVED}" shown`, heldMessage);
  check('live region carries the sentence too', await evaluate(`[...document.querySelectorAll('[data-f26-workspace] [role="status"][aria-live="polite"]')].some((el) => el.textContent.includes(${JSON.stringify(CLOSE_SAVED)}))`));
  stored = await waitStored(e26.id, 'f26_p2', (p) => p.f['C.a4'] === 'Invented Area');
  check('the typed value was saved while the close was held', stored, parsed(rowOf(e26.id, 'f26_p2')).f);
  await screenshot('f26-05-close-held');

  await selectClause('f26_c28');
  await typeInto('f26-t-S28-0-2', '1A');                     // inside the 800 ms wait of a table
  await closeWindow();
  check('close within the table wait: held and announced', await waitFor(`document.body.innerText.includes(${JSON.stringify(CLOSE_SAVED)})`, 8000) && (await windowCount()) === 1);
  stored = await waitStored(e26.id, 'f26_t_S28', (p) => p.rows[0]['2'] === '1A');
  check('the table edit was saved while the close was held', stored, parsed(rowOf(e26.id, 'f26_t_S28')).rows?.[0]);

  // A reload from the menu cannot be told from a close: it is held the same way, and the page stays.
  await selectClause('f26_p2');
  await evaluate(`(window.__taxAuditTestMark = 'kept', true)`);
  await typeInto('f26-f-C-a5', 'Invented Town');
  await mainEval(`(BrowserWindow.getAllWindows()[0].webContents.reload(), true)`);
  await sleep(1500);
  const kept = await evaluate(`window.__taxAuditTestMark === 'kept'`).catch(() => false);
  check('View > Reload with a typed box: held, the page stays, the value is saved', kept && (await waitStored(e26.id, 'f26_p2', (p) => p.f['C.a5'] === 'Invented Town')));

  await closeWindow();
  check('the second close (nothing waiting) closes the window and the application', await waitExit(15000));
  await launch();
  await sleep(1500);
  await open(e26);
  await workspaceOpen();
  await selectClause('f26_p2');
  check('after the closes and a restart: nothing lost', (await valueOf('f26-f-C-a4')) === 'Invented Area' && (await valueOf('f26-f-C-a5')) === 'Invented Town' && (await valueOf('f26-f-C-a3')) === 'Invented Road 1');

  // ── Scenarios 12-13 (tasks 23-24): Review Summary, downloads, the save file and loading one ──
  await reviewSummaryScenarios({ open, insert, e26, userId: signup.data.user_id });

  // ── Scenario 14 (task 27): 250 rows in every add/delete table, loaded, then typed into ──
  await hundredsOfRowsScenario({ open, insert, userId: signup.data.user_id });

  // ── Scenario 10: a year not understood ────────────────────────────────
  errorPhase = 'form26-year';
  await open(eYear);
  const yearShown = await waitFor(`document.body.innerText.includes('The tax audit form cannot be chosen') && document.body.innerText.includes('("Year 26")')`, 15000);
  check('a year typed as "Year 26" shows the plain message with a link to Engagements', yearShown && (await evaluate(`Boolean(document.querySelector('main a[href$="/engagements"], main a[href*="engagements"]'))`)));
  await screenshot('f26-06-year-unknown');
  await sleep(1500);
  check('nothing is created for that engagement', sql({ a: ['SELECT id FROM tax_audit_engagements WHERE engagement_id = ?', eYear.id] }).a.length === 0);

  // ── Scenario 8: keyboard (a fresh engagement) ─────────────────────────
  errorPhase = 'form26-keyboard';
  await open(eKeys);
  await workspaceOpen();
  await evaluate(`(document.querySelector('[data-f26-workspace] h1')?.focus(), document.activeElement?.blur(), true)`);
  const landed = [];
  for (let i = 0; i < 5; i += 1) {
    await press('F8');
    await sleep(700);
    landed.push(await evaluate(`(() => { const el = document.activeElement; if (!el || el === document.body) return null; const r = el.getBoundingClientRect(); const unfilledHere = el.getAttribute('data-unfilled') === 'true' || Boolean(el.closest('[data-unfilled="true"]')) || Boolean(el.querySelector?.('[data-unfilled="true"]')); return { id: el.id || el.getAttribute('data-entry-id') || el.tagName, visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight, unfilled: unfilledHere, inEditor: Boolean(el.closest('[data-f26-editor-body]')), titleSeen: (() => { const t = document.querySelector('section[aria-labelledby^="f26-editor-"] h2'); if (!t) return false; const q = t.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + Math.min(q.width / 2, 20), q.top + q.height / 2); return Boolean(hit && (t === hit || t.contains(hit))); })(), pageScrolled: document.querySelector('main').scrollTop }; })()`));
  }
  check('F8 five times: five different controls', new Set(landed.map((l) => l && l.id)).size === 5 && landed.every(Boolean), landed);
  check('each F8 landing is visible, in the editor and an unfilled item', landed.every((l) => l && l.visible && l.inEditor && l.unfilled), landed);
  check("each F8 landing keeps the clause's title in view and the page unscrolled", landed.every((l) => l && l.titleSeen && l.pageScrolled === 0), landed);

  const yesNoState = async () => ({
    focused: await evaluate(`document.activeElement?.id || document.activeElement?.tagName`),
    shown: await valueOf('f26-f-c14d'),
    saveLine: await saveLine(),
    stored: parsed(rowOf(eKeys.id, 'f26_c14')).f,
  });
  // 14(d) is a yes/no whose opening answer is "Yes" (the file's preset): N, then Y.
  check('clause 14 opened for the Y/N check', await selectClause('f26_c14'));
  const focused14d = await focus('f26-f-c14d');
  await press('n');
  check('N on a focused yes/no: "No" shown and saved', focused14d && (await valueOf('f26-f-c14d')) === 'No' && (await waitStored(eKeys.id, 'f26_c14', (p) => p.f.c14d === 'No')), await yesNoState());
  await press('y');
  check('Y on a focused yes/no: "Yes" shown and saved', (await valueOf('f26-f-c14d')) === 'Yes' && (await waitStored(eKeys.id, 'f26_c14', (p) => p.f.c14d === 'Yes')), await yesNoState());
  // Tab through the clause: forward in the order of the page, never lost to the page itself.
  const first = await evaluate(`(() => { const el = document.querySelector('[data-f26-editor-body] input, [data-f26-editor-body] select, [data-f26-editor-body] textarea, [data-f26-editor-body] button'); el.focus(); return el.id || el.tagName; })()`);
  const order = [first];
  let forward = true; let lost = false;
  for (let i = 0; i < 14; i += 1) {
    const before = await evaluate(`(window.__f26Prev = document.activeElement, true)`);
    await press('Tab');
    const step = await evaluate(`(() => { const el = document.activeElement; const prev = window.__f26Prev; return { id: el ? (el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName) : null, body: el === document.body, forward: prev && el ? Boolean(prev.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : false, inEditor: Boolean(el && el.closest('[data-f26-editor-body]')) }; })()`);
    if (!before) break;
    order.push(step.id);
    if (step.body) lost = true;
    if (!step.forward) forward = false;
    if (!step.inEditor) break;
  }
  check('Tab moves forward through clause 14 and on out of it, never to the page itself', forward && !lost && order.length >= 5, order);
  // The plan's F8 counts on stored values: still nothing typed into this audit apart from 14(b).
  check('no Form 3CD row was written for the 2026-27 engagements', sql({ a: ['SELECT id FROM tax_audit_engagements WHERE engagement_id IN (?, ?) AND statutory_version <> ?', e26.id, eKeys.id, F26] }).a.length === 0);

  // ── Scenario 9: fit at 1280 x 720 and 1600 x 900, pane open and closed, every schedule shown ──
  errorPhase = 'form26-fit';
  check('"Show all schedules" switched on (through "View")', (await setViewSwitch('f26-show-all-schedules')) === 'checked');
  check('"View" carries the mark "1" while schedules are all shown', (await viewMark()) === '1 setting changed', await viewMark());
  const shots = [];
  for (const [width, height] of [[1280, 720], [1600, 900]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    for (const pane of ['open', 'closed']) {
      const paneIsOpen = await evaluate(`!document.getElementById('f26-evidence-pane-open')`);
      if ((pane === 'open') !== paneIsOpen) {
        if (pane === 'closed') await clickReal(`document.querySelector('[data-f26-workspace] button[title="Collapse evidence pane"]')`);
        else await clickReal(`document.getElementById('f26-evidence-pane-open')`);
        await sleep(500);
      }
      const units = await evaluate(`[...document.querySelectorAll('[data-entry-id^="f26_"]')].map((b) => b.getAttribute('data-entry-id'))`);
      const problems = {};
      const paneProblems = {};
      const splitWords = {};
      const deepFocus = {};
      const room = {};
      let rowLists = 0;
      const fixed = { problems: {}, rowList: 0, grid: 0, open: 0 };
      const expectedLabels = fixedLabels();
      for (const unit of units) {
        await selectClause(unit);
        const bad = await evaluate(FIT_CHECK);
        if (bad.length) problems[unit] = bad;
        const labelled = await evaluate(FIXED_LABELS_CHECK(expectedLabels));
        if (labelled.problems.length) fixed.problems[unit] = labelled.problems.slice(0, 8);
        fixed.rowList += labelled.rowList; fixed.grid += labelled.grid; fixed.open += labelled.open;
        const fixedShot = { '12': 'P12d', '16': 'S16b', '20': 'S20' }[unit.replace(/^f26_c/, '')];
        if (fixedShot && pane === 'open') {
          await evaluate(`(document.getElementById('f26-t-${fixedShot}')?.scrollIntoView({ block: 'start' }), true)`);
          await sleep(300);
          shots.push(await screenshot(`fixed-rows-${width}x${height}-pane-open-${fixedShot}`));
          if (await evaluate(`Boolean(document.getElementById('f26-t-${fixedShot}-row-1'))`)) {
            await openListedRow(fixedShot, 1);
            await sleep(300);
            const opened = await evaluate(FIXED_LABELS_CHECK({ [fixedShot]: expectedLabels[fixedShot] }));
            if (opened.open !== 1 || opened.problems.length) fixed.problems[`${unit} open row 2`] = opened;
            else fixed.open += 1;
            await evaluate(`(document.getElementById('f26-t-${fixedShot}-row-1')?.scrollIntoView({ block: 'start' }), true)`);
            await sleep(300);
            shots.push(await screenshot(`fixed-rows-${width}x${height}-pane-open-${fixedShot}-row-2-open`));
          }
        }
        const panesBad = await evaluate(PANES_CHECK);
        if (panesBad.length) paneProblems[unit] = panesBad;
        const split = await evaluate(WORD_SPLIT_CHECK);
        if (split.length) splitWords[unit] = split;
        rowLists += await evaluate(`document.querySelectorAll('[data-f26-editor-body] [id^="f26-t-"] > div > div[aria-hidden="true"]').length`);
        room[unit] = await evaluate(ROOM_CHECK);
        const no = unit.replace(/^f26_c/, '');
        const shot = pane === 'open' && ['14', '36', '45', '47', '50', '53'].includes(no);
        if (shot) shots.push(await screenshot(`fit-${width}x${height}-pane-${pane}-clause-${no}`));
        // Every clause with a table: focus its last control the way a jump does (POLISH-1, the T19-20 open point).
        if (await evaluate(`Boolean(document.querySelector('[data-f26-editor-body] [id^="f26-t-"]'))`)) {
          const focusBad = await evaluate(DEEP_FOCUS_CHECK);
          if (focusBad.length) deepFocus[unit] = focusBad;
          if (shot) shots.push(await screenshot(`fit-${width}x${height}-pane-${pane}-clause-${no}-deep-focus`));
          await evaluate(`(document.activeElement?.blur(), true)`);
        }
        if (shot) {
          await evaluate(`(document.querySelector('[data-f26-editor-body] section[id^="f26-s-"]')?.scrollIntoView({ block: 'start' }), true)`);
          await sleep(300);
          shots.push(await screenshot(`fit-${width}x${height}-pane-${pane}-clause-${no}-schedule`));
        }
      }
      check(`fit ${width}x${height}, pane ${pane}: the page does not scroll, the header ends above the panes, search, chips, title and review bar seen`, Object.keys(paneProblems).length === 0, paneProblems);
      // FIX-T29 D1: 93 fixed rows in 11 tables, each seen once (in a row list or a grid); at 1280 x 720 with the
      // pane open the narrow ones are row lists.
      const fixedRowsAll = Object.values(expectedLabels).reduce((n, labels) => n + labels.length, 0);
      check(`fixed rows ${width}x${height}, pane ${pane}: every fixed row shows its own labels (${fixed.rowList} in row lists, ${fixed.grid} in grids, of ${fixedRowsAll}), whole, no word broken; open rows titled by them (${fixed.open})`, fixedRowsAll === 93 && fixed.rowList + fixed.grid === fixedRowsAll && Object.keys(fixed.problems).length === 0 && (width !== 1280 || pane !== 'open' || (fixed.rowList > 0 && fixed.open > 0)), fixed.problems);
      check(`fit ${width}x${height}, pane ${pane}: no heading has a word broken inside itself (${rowLists} row lists among the tables)`, rowLists > 0 && Object.keys(splitWords).length === 0, splitWords);
      check(`fit ${width}x${height}, pane ${pane}: focusing a control deep in a clause keeps its title and review bar in view (page and frame not scrolled)`, Object.keys(deepFocus).length === 0, deepFocus);
      // POLISH-2: the working room, for every entry (the list scrolled to the selected one).
      const roomValues = Object.values(room).filter(Boolean);
      const least = { entries: Math.min(...roomValues.map((r) => r.entries)), editor: Math.min(...roomValues.map((r) => r.editor)) };
      const worst = Object.entries(room).filter(([, r]) => !r || r.seen < 6 || r.editor < 300).slice(0, 12);
      const sorted = roomValues.map((r) => r.entries).sort((x, y) => x - y);
      console.log(`  room ${width}x${height} pane ${pane}: list entries seen whole min ${least.entries} median ${sorted[Math.floor(sorted.length / 2)]} (clause 14: ${room.f26_c14?.entries} whole, ${room.f26_c14?.seen} with a line seen, list ${room.f26_c14?.list} px), editor body min ${least.editor} px (clause 14: ${room.f26_c14?.editor} px); below 6 whole: ${Object.entries(room).filter(([, r]) => r && r.entries < 6).map(([k, r]) => k.replace('f26_', '') + '=' + r.entries + '/' + r.seen).join(' ') || 'none'}`);
      // The bar at the smallest window (1280 x 720, pane open), for every entry opened in turn: the editor's body
      // at least 300 px; the list shows at least 6 entries (a line or more of each) for 8 entries in 10 and never
      // fewer than 4. Where the labels are longest (clauses 12-14, 51-53: up to eight lines each in the 280 px
      // pane) six whole entries cannot fit; the counts are logged above for the lead.
      if (width === 1280 && pane === 'open') {
        const sixSeen = roomValues.filter((r) => r.seen >= 6).length;
        const leastSeen = Math.min(...roomValues.map((r) => r.seen));
        check(`room 1280x720, pane open: editor body >= 300 px for every entry (least ${least.editor} px); list shows >= 6 entries for ${sixSeen} of ${roomValues.length} entries (>= 80%), never fewer than 4 (least ${leastSeen})`, roomValues.length === units.length && least.editor >= 300 && sixSeen >= 0.8 * roomValues.length && leastSeen >= 4, worst);
      }
      if (pane === 'closed') {
        await selectClause('f26_c45');
        shots.push(await screenshot(`fit-${width}x${height}-pane-closed-clause-45`));
      }
      // 57 entries less Part A, which the file shows only for category (i) (this audit is in category (ii)).
      check(`fit ${width}x${height}, pane ${pane}: every one of ${units.length} entries, no sideways scroll, window not scrolled, nothing cut`, units.length === 56 && !units.includes('f26_part_a') && Object.keys(problems).length === 0, problems);
    }
  }
  await cdp('Emulation.clearDeviceMetricsOverride');
  console.log(`screenshots: ${shots.length}`);

  if (axePath) {
    await evaluate(`(() => { if (!window.axe) { (0, eval)(${JSON.stringify(fs.readFileSync(axePath, 'utf8'))}); } return true; })()`);
    await selectClause('f26_c45');
    const axe = await evaluate(`axe.run(document.querySelector('[data-f26-workspace]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }).then((r) => r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))`);
    check('axe: no violations in the Form No. 26 workspace (clause 45, every schedule shown)', axe.length === 0, axe);
  }

  // ── Scenarios 15-16 (task 26): a Form 3CD draft brought across; a changed year ──
  await conversionScenarios({ open, insert, client, engagement, userId: signup.data.user_id });

  // ── Scenario 17 (task 27): a change made elsewhere while a field has the keyboard ──
  await concurrentScenarios({ open, engagement, userId: signup.data.user_id });

  // ── Scenario 7: a user who is not on the engagement ───────────────────
  errorPhase = 'form26-access';
  const staffEmail = 'tax-audit-staff@example.invalid';
  const staff = await evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action: 'signup', email: staffEmail, password, fullName: 'Invented Staff Member' })})`);
  check('a second invented user (staff, not assigned) signed up', !staff.error && staff.data.role === 'staff', staff);
  await openAsUser(staffEmail, password, e26, '#/tax-audit').catch(() => false);
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    const t = await bodyText().catch(() => '');
    if (t.includes('You are not assigned to this engagement')) seen.add('no-access');
    if (t.includes('Please select an engagement before opening Tax Audit.')) seen.add('no-engagement');
    if (t.includes('Select Engagement')) seen.add('select-engagement page');
    if (t.includes('Income-tax Act, 2025') || t.includes('Invented Road 1') || t.includes('Penalty levied')) seen.add('FORM 26 CONTENT');
    await sleep(150);
  }
  await screenshot('f26-07-no-access');
  check('no Form No. 26 content is shown to a user without access', !seen.has('FORM 26 CONTENT'), [...seen]);
  // The application drops an engagement the user is not on from the chosen engagement before any page opens,
  // so the user lands on "Select Engagement"; the workspace's own "no access" state is the guard behind it.
  check('the user without access is stopped: "Select Engagement", or the "no access" / "select an engagement" state', seen.has('select-engagement page') || seen.has('no-access') || seen.has('no-engagement'), [...seen]);
  console.log(`  states seen by the user without access: ${[...seen].join(', ') || 'none'}`);
  const direct = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table: 'tax_audit_clause_responses', action: 'select', columns: '*', filters: [{ column: 'tax_audit_id', operator: 'eq', value: auditId }] })})`);
  check('a direct select of the clause rows by that user returns nothing', !direct.error ? (direct.data || []).length === 0 : true, { error: direct.error, n: (direct.data || []).length });
  const directAudit = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify({ table: 'tax_audit_engagements', action: 'select', columns: '*', filters: [{ column: 'engagement_id', operator: 'eq', value: e26.id }] })})`);
  check('a direct select of the audit row by that user returns nothing', !directAudit.error ? (directAudit.data || []).length === 0 : true);
  const after = sql({ a: ['SELECT id FROM tax_audit_engagements WHERE engagement_id = ?', e26.id], c: ['SELECT count(*) n FROM tax_audit_clause_responses WHERE tax_audit_id = ?', auditId] });
  check('the user without access created nothing', after.a.length === 1 && after.c[0].n === 122, after);
  check('end: no Form 3CD row for any 2026-27 engagement', sql({ a: ['SELECT id FROM tax_audit_engagements WHERE engagement_id IN (?, ?) AND statutory_version <> ?', e26.id, eKeys.id, F26] }).a.length === 0);
  void client;
}

// ── Helpers of scenarios 12-13 (tasks 23-24) ───────────────────────────────
const REMARK = 'Invented review remark: confirm the penalty order with the client.';
// Words of the comparison with Form 3CD (task 25): never in an exported form (L9).
const COMPARISON_TEXT = /Was Form 3CD|New in Form No\. 26|No Form 3CD clause|Show Form 3CD notes/;
const officeFilePath = path.join(runtimeRoot, 'for-the-office-file');
// The review lines "To finish" should show, from the stored rows: one per state, with its count (POLISH-3).
function reviewLinesOf(engagementId) {
  const units = seedHelpers().unitsInReport;
  const byKey = new Map(rowsOf(engagementId).map((r) => [r.clause_key, r]));
  const kinds = { draft: 'not-prepared', prepared: 'not-reviewed', reviewed: 'not-approved' };
  const words = { 'not-prepared': 'not prepared yet', 'not-reviewed': 'prepared, not reviewed yet', 'not-approved': 'reviewed, not approved yet' };
  const counts = { 'not-prepared': 0, 'not-reviewed': 0, 'not-approved': 0 };
  for (const key of units) {
    const row = byKey.get(key);
    if (!row || Number(row.locked) === 1 || row.review_status === 'approved' || row.review_status === 'locked') continue;
    counts[kinds[row.review_status] || 'not-prepared'] += 1;
  }
  return Object.entries(counts).filter(([, n]) => n > 0).map(([kind, n]) => ({ kind, count: n, text: `${n} ${n === 1 ? 'clause' : 'clauses'} ${words[kind]}` }));
}
// The owner's ruling of 22 Nov 2026: no draft notice on any Form No. 26 output or on the Review Summary.
const NO_NOTICE = /Draft review note|Draft prepared in ICAI VERA|draft for review/i;
const fixturePath = path.join(projectRoot, 'src', 'lib', '__fixtures__', 'taxAuditForm26', 'save-everything-3-rows.json');
const noSpace = (text) => String(text).replace(/\s+/g, '');
// A file the application saved through "Save As" (the stand-in), read back from the page in 1 MB slices and
// kept in the profile's download folder; null when nothing was saved under that name in time.
async function downloaded(name, ms = 90000) {
  const key = JSON.stringify(name);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const size = await evaluate(`window.__f26Save && window.__f26Save.saved[${key}] ? window.__f26Save.saved[${key}].length : -1`).catch(() => -1);
    if (size >= 0) {
      const parts = [];
      for (let at = 0; at < size; at += 1_000_000) {
        const base64 = await evaluate(`(() => { const u8 = window.__f26Save.saved[${key}].subarray(${at}, ${at + 1_000_000}); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); })()`);
        parts.push(Buffer.from(base64, 'base64'));
      }
      const bytes = Buffer.concat(parts);
      fs.writeFileSync(path.join(downloadsPath, name), bytes);
      await evaluate(`(delete window.__f26Save.saved[${key}], true)`);
      return bytes;
    }
    await sleep(300);
  }
  return null;
}
async function forget(name) {
  try { fs.rmSync(path.join(downloadsPath, name), { force: true }); } catch { /* none */ }
  await evaluate(`(window.__f26Save && delete window.__f26Save.saved[${JSON.stringify(name)}], true)`).catch(() => false);
}
// How the stand-in "Save As" answers next (see SAVE_STUB).
const saveWindow = (mode, hold = false) => evaluate(`(window.__f26Save.mode = ${JSON.stringify(mode)}, window.__f26Save.hold = ${hold}, true)`);
const releaseSaveWindow = () => evaluate(`(window.__f26Save.release ? (window.__f26Save.release(), true) : false)`);
const saveAsked = () => evaluate(`window.__f26Save.asked.slice()`);
async function docxText(buffer) {
  const JSZip = require(path.join(projectRoot, 'node_modules', 'jszip'));
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
// The text of a PDF, read with pdfjs-dist (read only).
async function pdfText(buffer) {
  const { pathToFileURL } = require('node:url');
  const pdfjs = await import(pathToFileURL(path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n += 1) text += (await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str || '').join('') + '\n';
  const pages = doc.numPages;
  await doc.destroy();
  return { text, pages };
}
// What the application's own serialiseSaveFile gives for the answers stored for an engagement: the libraries
// of src bundled on the fly with esbuild (already installed with Vite), run on the database's rows.
let storedSerialiser = null;
function storedSaveFile(engagementId) {
  if (!storedSerialiser) {
    const esbuild = require(path.join(projectRoot, 'node_modules', 'esbuild'));
    const contents = `import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
      import { serialiseSaveFile } from '@/lib/taxAuditForm26SaveFile';
      import { readSetup, valuesFromRows } from '@/lib/taxAuditForm26Storage';
      export const fromRows = (setupJson: string, rows: never[]) => serialiseSaveFile(DEF, valuesFromRows(DEF, readSetup(setupJson), rows));`;
    const out = esbuild.buildSync({ stdin: { contents, resolveDir: path.join(projectRoot, 'src'), loader: 'ts', sourcefile: 'stored-save-file.ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, alias: { '@': path.join(projectRoot, 'src') }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
    const holder = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(holder, holder.exports, require);
    storedSerialiser = holder.exports;
  }
  const audit = sql({ a: ['SELECT setup_json FROM tax_audit_engagements WHERE engagement_id = ? AND statutory_version = ?', engagementId, F26] }).a[0];
  return storedSerialiser.fromRows(audit ? audit.setup_json : null, rowsOf(engagementId));
}
// A file put into a file box the way a user picks one (DevTools Protocol), which fires its change event.
async function setFile(selector, file) {
  const { root } = await cdp('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return false;
  await cdp('DOM.setFileInputFiles', { files: [file], nodeId });
  return true;
}
const stamps = (engagementId) => JSON.stringify(rowsOf(engagementId).map((r) => [r.clause_key, r.updated_at, r.response_json]).sort());
const downloadLine = () => evaluate(`document.querySelector('[data-f26-download-line]')?.textContent.trim() || ''`);
async function openSummary() {
  await clickReal(byText('[data-f26-workspace] [role="tab"]', 'Review Summary'));
  return waitFor(`Boolean(document.querySelector('[data-f26-summary]')) && ${byText('[data-f26-workspace] [role="tab"]', 'Review Summary')}?.getAttribute('data-state') === 'active'`, 8000);
}
// One download from the Review Summary: clicked, "Preparing…" seen on its button (or done too fast to see),
// the file arrives, and the line says so.
async function downloadFrom(id, name, ms = 90000) {
  await forget(name);
  const states = await evaluate(`new Promise((resolve) => {
    const button = document.querySelector('[data-f26-download="${id}"]');
    if (!button) { resolve(null); return; }
    const seen = [];
    const look = () => { const t = button.textContent.trim(); if (!seen.includes(t)) seen.push(t); };
    const timer = setInterval(look, 10);
    button.click();
    look();
    setTimeout(() => { clearInterval(timer); look(); resolve(seen); }, 3000);
  })`);
  const file = await downloaded(name, ms);
  const line = await waitFor(`(() => { const t = document.querySelector('[data-f26-download-line]')?.textContent.trim(); return t && t !== '' ? t : false; })()`, ms);
  return { file, states, line };
}

async function reviewSummaryScenarios({ open, insert, e26, userId }) {
  // Review remarks on clause 28 (task 27, item 11): they belong in the working-paper pack only, never in the form.
  errorPhase = 'form26-remarks';
  await selectClause('f26_c28');
  await clickReal(`document.getElementById('f26-footer-f26_c28-remarks')?.closest('button')`);
  const remarksBox = await waitFor(`(() => { const box = document.querySelector('[data-f26-editor-body] [role="textbox"][aria-labelledby="f26-footer-f26_c28-remarks"]'); if (!box) return false; box.scrollIntoView({ block: 'center' }); box.focus(); return document.activeElement === box; })()`, 5000);
  await type(REMARK);
  await evaluate(`(document.activeElement?.blur(), true)`);
  const remarked = await waitStored(e26.id, 'f26_c28', (_p, row) => (row.auditor_remarks_html || '').includes(REMARK));
  check('review remarks typed on clause 28 and stored when the box is left', remarksBox && remarked, rowOf(e26.id, 'f26_c28')?.auditor_remarks_html);

  // ── Scenario 12: the Review Summary of the 2026-27 audit filled in scenario 3 ──
  errorPhase = 'form26-summary';
  check('"Review Summary" opens from its view beside the title', await openSummary());
  const finish = await evaluate(`[...document.querySelectorAll('[data-f26-finish-clause]')].map((li) => li.getAttribute('data-f26-finish-clause'))`);
  check('"To finish" lists what is left to fill, by clause (clause 12 among them, Part A not: category (ii))', finish.length >= 5 && finish.includes('f26_c12') && !finish.includes('f26_part_a'), finish.slice(0, 12));
  // POLISH-3: the review is folded into one line per state, with its count; no "Not prepared yet" register.
  const expectedReview = reviewLinesOf(e26.id);
  const folded = await evaluate(`(() => {
    const block = document.querySelector('[data-f26-to-finish]');
    const listOf = (b) => document.getElementById(b.getAttribute('aria-controls'));
    const lines = [...block.querySelectorAll('[data-f26-finish-review]')].map((b) => ({ kind: b.getAttribute('data-f26-finish-review'), text: b.textContent.replace(/\\s+/g, ' ').trim(), expanded: b.getAttribute('aria-expanded'), listHidden: listOf(b)?.hidden === true && listOf(b).offsetParent === null && getComputedStyle(listOf(b)).display === 'none', links: listOf(b)?.querySelectorAll('[data-f26-finish-review-link]').length }));
    const fillText = [...block.querySelectorAll('[data-f26-finish-clause]')].map((li) => li.textContent).join(' | ');
    const firstReview = block.querySelector('[data-f26-finish-review]');
    const lastFill = [...block.querySelectorAll('[data-f26-finish-clause]')].pop();
    return { lines, register: /Not prepared yet|not reviewed yet|not approved yet/i.test(fillText), reviewBelowFill: !firstReview || !lastFill || lastFill.getBoundingClientRect().bottom <= firstReview.getBoundingClientRect().top };
  })()`);
  check('"To finish" reads as a to-do: the things to fill first, then one line per review state with its count (as stored), each folded', folded && !folded.register && folded.reviewBelowFill && expectedReview.length > 0 && JSON.stringify(folded.lines.map((l) => [l.kind, l.text, l.links])) === JSON.stringify(expectedReview.map((l) => [l.kind, l.text, l.count])) && folded.lines.every((l) => l.expanded === 'false' && l.listHidden === true), { folded, expectedReview });
  const tableRows = await evaluate(`document.querySelectorAll('[data-f26-review-table] tbody tr').length`);
  check('the table lists all 57 clauses', tableRows === 57, tableRows);
  const summaryText = await evaluate(`document.querySelector('[data-f26-summary]')?.innerText || ''`);
  check('the Review Summary says nothing of a draft notice (owner, 22 Nov 2026)', summaryText.length > 0 && !NO_NOTICE.test(summaryText), (summaryText.match(NO_NOTICE) || [])[0]);
  await screenshot('f26-13-review-summary');
  await clickReal(`document.querySelector('[data-f26-finish-review="not-prepared"]')`);
  const unfolded = await waitFor(`(() => { const b = document.querySelector('[data-f26-finish-review="not-prepared"]'); const list = b && document.getElementById(b.getAttribute('aria-controls')); return b?.getAttribute('aria-expanded') === 'true' && list && !list.hidden && list.offsetParent !== null ? [...list.querySelectorAll('[data-f26-finish-review-link]')].map((a) => a.getAttribute('data-f26-finish-review-link')) : false; })()`, 5000);
  check('the "not prepared yet" line opens the list of its clauses, each a link (clause 9 among them)', Array.isArray(unfolded) && unfolded.length === (expectedReview.find((l) => l.kind === 'not-prepared') || { count: -1 }).count && unfolded.includes('f26_c9'), unfolded);
  await screenshot('f26-13-to-finish-unfolded');
  await clickReal(`document.querySelector('[data-f26-finish-review-link="f26_c9"]')`);
  check('a clause in the unfolded line opens it in "Clauses"', await waitFor(`Boolean(document.getElementById('f26-editor-f26_c9-title')) && ${byText('[data-f26-workspace] [role="tab"]', 'Clauses')}?.getAttribute('data-state') === 'active'`, 8000));
  await openSummary();
  await clickReal(`document.querySelector('[data-f26-finish-link="f26_c12"]')`);
  check('a "To finish" link opens its clause in "Clauses"', await waitFor(`Boolean(document.getElementById('f26-editor-f26_c12-title')) && ${byText('[data-f26-workspace] [role="tab"]', 'Clauses')}?.getAttribute('data-state') === 'active'`, 8000));
  await openSummary();
  for (const [width, height] of [[1280, 720], [1600, 900]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    const bad = await evaluate(FIT_CHECK);
    const split = await evaluate(WORD_SPLIT_CHECK);
    const header = await evaluate(`(() => { const header = document.querySelector('[data-f26-workspace] > header'); const list = header?.querySelector('[role="tablist"]'); const h1 = header?.querySelector('h1'); if (!list || !h1) return null; const l = list.getBoundingClientRect(); const h = h1.getBoundingClientRect(); return { sameLine: l.top >= h.top - 4 && l.bottom <= h.bottom + 4, height: Math.round(l.height), tabs: [...list.querySelectorAll('[role="tab"]')].map((t) => Math.round(t.getBoundingClientRect().height)) }; })()`);
    check(`Review Summary at ${width}x${height}: no sideways scroll, window not scrolled, nothing cut, no heading word broken; the three views stay beside the title on one line`, bad.length === 0 && split.length === 0 && header && header.sameLine && header.height <= 28 && header.tabs.every((h) => h <= 24), { bad, split, header });
    await screenshot(`f26-13-review-summary-${width}x${height}`);
    await evaluate(`(document.querySelector('[data-f26-downloads]')?.scrollIntoView({ block: 'start' }), true)`);
    await sleep(200);
    await screenshot(`f26-13-review-summary-downloads-${width}x${height}`);
  }
  await cdp('Emulation.clearDeviceMetricsOverride');
  await sleep(500);

  // FIX-T29 D2: every file through "Save As". A cancel saves nothing and says only "Not saved."; while the save
  // window is open nothing is said and the button does not claim to be preparing; a failed write is one sentence.
  await saveWindow('cancel');
  await forget('Form26_AAAAA0000A.docx');
  await clickReal(`document.querySelector('[data-f26-download="word"]')`);
  const cancelLine = await waitFor(`document.querySelector('[data-f26-download-line]')?.textContent.trim() || false`, 10000);
  check('a cancelled "Save As" (Word): the line says only "Not saved.", nothing is written', cancelLine === 'Not saved.' && (await downloaded('Form26_AAAAA0000A.docx', 1500)) === null, cancelLine);
  const asked = (await saveAsked()).filter((a) => a.suggestedName === 'Form26_AAAAA0000A.docx');
  check('"Save As" is asked with a proper name and type (Form26_AAAAA0000A.docx, Word document), never "blob:…"', asked.length === 1 && asked[0].id === 'vera-form26' && asked[0].types[0].description === 'Word document', asked);
  await saveWindow('save', true);
  await clickReal(`document.querySelector('[data-f26-download="json"]')`);
  await sleep(1500);
  const whileOpen = await evaluate(`({ line: document.querySelector('[data-f26-download-line]')?.textContent.trim() || '', button: document.querySelector('[data-f26-download="json"]')?.textContent.trim(), held: Boolean(window.__f26Save.release) })`);
  check('while "Save As" is open: no sentence yet, the button keeps its name (not "Preparing…")', whileOpen.held && whileOpen.line === '' && whileOpen.button === 'Save file (.json)', whileOpen);
  const phaseBefore = errorPhase;
  errorPhase = 'form26-forced-failure';
  await saveWindow('fail', true);
  await releaseSaveWindow();
  const failLine = await waitFor(`(() => { const t = document.querySelector('[data-f26-download-line]')?.textContent.trim(); return t && t !== '' ? t : false; })()`, 15000);
  check('a write that fails: one plain sentence, no "saved"', failLine === 'The file could not be saved. Check that the folder can be written to and has free space, then try again.', failLine);
  await saveWindow('save');
  errorPhase = phaseBefore;
  await forget('Form26_AAAAA0000A.json');
  await screenshot('f26-13-save-failed-line');

  // The downloads: Word, PDF, the working-paper pack and the save file, each opened and read.
  const word = await downloadFrom('word', 'Form26_AAAAA0000A.docx');
  const wordText = word.file ? await docxText(word.file) : '';
  check('Word: Form26_AAAAA0000A.docx is saved (50 4B), says "The Word file was saved."', word.file && word.file[0] === 0x50 && word.file[1] === 0x4b && word.line === 'The Word file was saved.', { line: word.line, states: word.states });
  check('Word: no draft notice (it opens with "FORM NO. 26"), the answers filled earlier (road, the penalty table), no "AuditPro"', wordText.trim().startsWith('FORM NO. 26') && !NO_NOTICE.test(wordText) && wordText.includes('Invented Road 1') && wordText.includes('Invented Law B') && wordText.includes('1,000') && !wordText.includes('AuditPro'), wordText.slice(0, 300));
  check('Word: no review remarks and no comparison text in the form', wordText.length > 0 && !wordText.includes(REMARK) && !COMPARISON_TEXT.test(wordText), (wordText.match(COMPARISON_TEXT) || [])[0]);
  const pdf = await downloadFrom('pdf', 'Form26_AAAAA0000A.pdf');
  const pdfRead = pdf.file ? await pdfText(pdf.file) : { text: '', pages: 0 };
  check('PDF: Form26_AAAAA0000A.pdf is saved (%PDF), "Preparing…" was on its button, says "The PDF was saved."', pdf.file && pdf.file.slice(0, 4).toString() === '%PDF' && pdf.states && pdf.states.includes('Preparing…') && pdf.line === 'The PDF was saved.', { line: pdf.line, states: pdf.states });
  check('PDF: read back with pdfjs: no draft notice (it opens with "FORM NO. 26"), the answers filled earlier, no "[X]" / "[ ]"', noSpace(pdfRead.text).startsWith('FORMNO.26') && !NO_NOTICE.test(pdfRead.text) && noSpace(pdfRead.text).includes('InventedRoad1') && noSpace(pdfRead.text).includes('InventedLawB') && !/\[X\]|\[ \]/.test(pdfRead.text) && pdfRead.pages >= 3, { pages: pdfRead.pages, start: pdfRead.text.slice(0, 200) });
  check('PDF: no review remarks and no comparison text in the form', pdfRead.text.length > 0 && !noSpace(pdfRead.text).includes(noSpace(REMARK)) && !COMPARISON_TEXT.test(pdfRead.text), (pdfRead.text.match(COMPARISON_TEXT) || [])[0]);
  const pack = await downloadFrom('pack', 'Form26_AAAAA0000A_working-papers.docx');
  const packText = pack.file ? await docxText(pack.file) : '';
  check('working-paper pack: Form26_AAAAA0000A_working-papers.docx is saved, says "The working-paper pack was saved."', pack.file && pack.file[0] === 0x50 && pack.line === 'The working-paper pack was saved.', { line: pack.line });
  check('working-paper pack: title, no draft notice, clause 28 with who prepared and approved it, its table, the road', packText.startsWith('Form No. 26: working papers') && !NO_NOTICE.test(packText) && /Clause 28 · /.test(packText) && packText.includes('Prepared by Invented Tax Audit Admin on ') && packText.includes('Invented Law B') && packText.includes('Invented Road 1') && !packText.includes('AuditPro'), packText.slice(0, 400));
  check('working-paper pack: the review remarks of clause 28 are in it (under clause 28), no comparison text', packText.includes(REMARK) && packText.indexOf(REMARK) > packText.search(/Clause 28 · /) && !COMPARISON_TEXT.test(packText), (packText.match(COMPARISON_TEXT) || [])[0]);
  const json = await downloadFrom('json', 'Form26_AAAAA0000A.json');
  const expected = storedSaveFile(e26.id);
  check('"Save file (.json)": Form26_AAAAA0000A.json is byte-equal to serialiseSaveFile of the stored answers', json.file && json.file.toString('utf8') === expected && json.line === 'The save file was saved.', { line: json.line, size: json.file && json.file.length, expected: expected.length });
  const parsedJson = json.file ? JSON.parse(json.file.toString('utf8')) : null;
  check('the save file parses: 65 tables, the answers, v 1', parsedJson && Object.keys(parsedJson.t).length === 65 && parsedJson.v === 1 && parsedJson.f['C.a3'] === 'Invented Road 1', parsedJson && Object.keys(parsedJson.f).length);
  const saveShape = seedHelpers().saveShape;
  const missingRadios = parsedJson ? saveShape.radioKeys.filter((k) => !(k in parsedJson.f)) : [];
  check(`the save file holds 142 answers less the groups of options not chosen (${missingRadios.length}: ${missingRadios.join(', ') || 'none'}), every other answer key in the form's order`, parsedJson && saveShape.fieldOrder.length === 142 && JSON.stringify(Object.keys(parsedJson.f)) === JSON.stringify(saveShape.fieldOrder.filter((k) => !missingRadios.includes(k))), parsedJson && Object.keys(parsedJson.f).length);
  // Task 27 item 12 is run by the lead (the office's own file reads this export): the file is kept in the run folder.
  if (json.file) {
    fs.mkdirSync(officeFilePath, { recursive: true });
    fs.writeFileSync(path.join(officeFilePath, 'Form26_AAAAA0000A.json'), json.file);
    console.log(`  for the office's fillable file (item 12): ${path.join(officeFilePath, 'Form26_AAAAA0000A.json')}`);
  }

  // ── Scenario 13: "Load a save file" with a file saved by the office's form (invented data) ──
  errorPhase = 'form26-load';
  const loadDir = path.join(runtimeRoot, 'files');
  fs.mkdirSync(loadDir, { recursive: true });
  const loadFile = path.join(loadDir, 'save-everything-3-rows.json');
  fs.copyFileSync(fixturePath, loadFile);
  const fixtureText = fs.readFileSync(fixturePath, 'utf8');
  const client2 = await insert('clients', { name: 'Invented Import Traders Private Limited', constitution: 'company', pan: 'AAAAB1111B' });
  const eLoad = await insert('engagements', { name: 'Tax audit 2026-27 (save file)', client_id: client2.id, client_name: client2.name, financial_year: '2026-27', engagement_type: 'tax', created_by: userId });
  await open(eLoad);
  check('the engagement for the load opens Form No. 26', await workspaceOpen());
  await openSummary();
  const before = stamps(eLoad.id);
  check('the file is picked through the "Load a save file" box', await setFile('[data-f26-load-input]', loadFile));
  const dialog = await waitFor(`(() => { const d = document.querySelector('[role="dialog"] [data-f26-import]'); return d ? d.innerText : false; })()`, 15000);
  check('the dialog shows the file name and "142 answers and 65 tables (… cells)" before anything is written', dialog && dialog.includes('save-everything-3-rows.json') && /142 answers and 65 tables \([\d,]+ cells\)/.test(dialog), dialog);
  check('the dialog warns plainly: another PAN and another name', dialog && dialog.includes('This file is for PAN AAAAA0000A. This audit is for PAN AAAAB1111B.') && dialog.includes('This file is for Invented C.name. This audit is for Invented Import Traders Private Limited.'), dialog);
  check('nothing was written while the dialog is open', stamps(eLoad.id) === before);
  await screenshot('f26-14-load-dialog');
  await forget('Form26_AAAAB1111B_before-import.json');
  // FIX-T29 D2: "Replace the answers" asks where to save the copy of the present answers first; a cancel or a
  // failed write replaces nothing and says so in one sentence; while that window is open nothing is written.
  const NOTHING_CHANGED = 'Nothing was changed: the copy of the present answers was not saved.';
  await saveWindow('cancel');
  await clickReal(`document.querySelector('[data-f26-import-confirm]')`);
  const cancelled = await waitFor(`document.querySelector('[data-f26-import-notice]')?.textContent.trim() || false`, 10000);
  await sleep(1000);
  check('load: the copy\'s "Save As" cancelled: nothing replaced, the dialog stays and says "' + NOTHING_CHANGED + '"', cancelled === NOTHING_CHANGED && stamps(eLoad.id) === before && Boolean(await evaluate(`Boolean(document.querySelector('[data-f26-import]'))`)), cancelled);
  const copyAsked = (await saveAsked()).filter((a) => a.suggestedName === 'Form26_AAAAB1111B_before-import.json');
  check('load: the copy is asked for as Form26_AAAAB1111B_before-import.json (save file type)', copyAsked.length === 1 && copyAsked[0].types[0].description === 'Form No. 26 save file', copyAsked);
  await screenshot('f26-14-load-copy-not-saved');
  const loadPhase = errorPhase;
  errorPhase = 'form26-forced-failure';
  await saveWindow('fail');
  await clickReal(`document.querySelector('[data-f26-import-confirm]')`);
  const failedCopy = await waitFor(`(() => { const t = document.querySelector('[data-f26-import-notice]')?.textContent.trim(); return t && t !== ${JSON.stringify(NOTHING_CHANGED)} ? t : false; })()`, 10000);
  check('load: the copy could not be written: nothing replaced, "Nothing was changed: the copy of the present answers could not be saved."', failedCopy === 'Nothing was changed: the copy of the present answers could not be saved.' && stamps(eLoad.id) === before, failedCopy);
  errorPhase = loadPhase;
  await saveWindow('save', true);
  await clickReal(`document.querySelector('[data-f26-import-confirm]')`);
  await sleep(2000);
  check('load: while the copy\'s "Save As" is open, nothing is written and nothing is said to be loaded', stamps(eLoad.id) === before && !(await downloadLine()).startsWith('Loaded') && (await evaluate(`Boolean(window.__f26Save.release)`)));
  await releaseSaveWindow();
  await saveWindow('save');
  const loaded = await waitFor(`(() => { const t = document.querySelector('[data-f26-download-line]')?.textContent.trim(); return t && t.startsWith('Loaded') ? t : false; })()`, 90000);
  check('after "Replace the answers": one sentence "Loaded 142 answers and 65 tables from save-everything-3-rows.json."', loaded === 'Loaded 142 answers and 65 tables from save-everything-3-rows.json.', loaded || (await evaluate(`document.querySelector('[data-f26-import]')?.innerText || ''`)));
  check('the dialog closed', await waitFor(`!document.querySelector('[data-f26-import]')`, 5000));
  const backup = await downloaded('Form26_AAAAB1111B_before-import.json', 15000);
  check('the present answers were saved first (Form26_AAAAB1111B_before-import.json, the PAN of this audit)', backup && JSON.parse(backup.toString('utf8')).f['C.pan'] === 'AAAAB1111B');
  check('the database holds the file: serialiseSaveFile of the stored answers is byte-equal to the file loaded', storedSaveFile(eLoad.id) === fixtureText);
  const setupAfter = JSON.parse((await auditOf(eLoad.id))[0].setup_json).form26;
  check('the setup records where the answers came from (importedFrom)', setupAfter.importedFrom && setupAfter.importedFrom.fileName === 'save-everything-3-rows.json');
  await screenshot('f26-15-loaded');
  await clickReal(byText('[data-f26-workspace] [role="tab"]', 'Clauses'));
  await waitFor(`Boolean(document.querySelector('[data-f26-editor-body]'))`, 8000);
  const fileAnswers = JSON.parse(fixtureText).f;
  await selectClause('f26_p2');
  const roadShown = await valueOf('f26-f-C-a3');
  await selectClause('f26_p1');
  const nameShown = await valueOf('f26-f-C-name');
  check('the loaded values are on screen at once (no reload): item 2 road, item 1 name', roadShown === fileAnswers['C.a3'] && nameShown === fileAnswers['C.name'], { roadShown, nameShown });
  await openSummary();
  await forget('Form26_AAAAA0000A.json');
  const again = await downloadFrom('json', 'Form26_AAAAA0000A.json');
  check('"Save file (.json)" after the load gives back the file loaded, byte for byte', again.file && again.file.toString('utf8') === fixtureText);
  // The same file a second time: the dialog says the audit already holds it, and no row is written.
  const held = stamps(eLoad.id);
  await setFile('[data-f26-load-input]', loadFile);
  const second = await waitFor(`(() => { const d = document.querySelector('[role="dialog"] [data-f26-import]'); return d ? d.innerText : false; })()`, 15000);
  check('a second load of the same file: the dialog says the answers already match', second && second.includes('The answers in this audit already match this file.'), second);
  await clickReal(`document.querySelector('[data-f26-import-confirm]')`);
  await waitFor(`!document.querySelector('[data-f26-import]')`, 30000);
  check('a second load of the same file writes no clause or table row', stamps(eLoad.id) === held);

  // After a restart the loaded values are still there.
  check('the application closes after the load (nothing waiting)', await closeApp());
  await launch();
  await sleep(1500);
  await open(eLoad);
  await workspaceOpen();
  await selectClause('f26_p2');
  check('after a restart the loaded values persist', (await valueOf('f26-f-C-a3')) === fileAnswers['C.a3'] && storedSaveFile(eLoad.id) === fixtureText);
  await open(e26);
  await workspaceOpen();
}

// ── Helpers of scenarios 15-16 (task 26) ───────────────────────────────────
const THREE_CD = 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025';
// The application's own lists and seeding (src bundled on the fly with esbuild, as storedSaveFile does).
let seedHelper = null;
function seedHelpers() {
  if (!seedHelper) {
    const esbuild = require(path.join(projectRoot, 'node_modules', 'esbuild'));
    const contents = `import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
      import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
      import { prefillParticulars, seedRows } from '@/lib/taxAuditForm26Storage';
      import { defaultValues } from '@/lib/taxAuditForm26Values';
      import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
      import { planImport, serialiseSaveFile } from '@/lib/taxAuditForm26SaveFile';
      export const threeCdClauses = FORM_3CD_CLAUSES.map((c) => ({ key: c.key, no: c.clauseNo, title: c.title }));
      export const saveShape = { fieldOrder: DEF.saveFile.fieldOrder, radioKeys: DEF.saveFile.radioKeys };
      // Category (ii) (the audits of this test): Part A is not part of the report.
      export const unitsInReport = FORM26_CLAUSE_UNITS.filter((u) => u.category !== '1').map((u) => u.key);
      // Task 27 item 14: every answer of the office's everything-file, and 250 rows in every add/delete table, every
      // input cell filled (as the save file's own size test does): 70,364 cells.
      export const bigSaveFile = (everythingText: string) => {
        const planned = planImport(DEF, everythingText, defaultValues(DEF));
        if ('message' in planned) throw new Error(planned.message);
        const values = { f: { ...planned.values.f }, t: {} as Record<string, Record<string, string>[]> };
        // Every answer that opens a schedule or a table is "Yes", so that all of them are on screen.
        const openers = new Set([...DEF.schedules.map((x) => x.showIf), ...DEF.tables.flatMap((x) => x.showIf)].filter(Boolean));
        for (const field of DEF.fields) if (field.kind === 'yesno' && openers.has(field.key)) values.f[field.key] = 'Yes';
        for (const t of DEF.tables) {
          if (t.kind === 'depreciation') { values.t[t.id] = t.dep!.rows.map((r, i) => Object.fromEntries(r.cells.map((c) => [c, String(i + 1)]))); continue; }
          const cols = t.columns.filter((c) => c.input);
          const count = t.kind === 'rows' ? 250 : t.startRows;
          values.t[t.id] = Array.from({ length: count }, (_, i) => Object.fromEntries(cols.map((c) => [c.c,
            c.type === 'num' || c.type === 'calc' ? String(i + 1) : c.type === 'date' ? '2026-04-15' : c.type === 'yn' ? 'Yes' : c.type === 'sel' ? c.options![0] : 'Invented ' + t.id + ' r' + (i + 1) + ' c' + c.c])));
        }
        const text = serialiseSaveFile(DEF, values);
        const again = planImport(DEF, text, defaultValues(DEF));
        return { text, cells: 'message' in again ? -1 : again.summary.cells, rowsTables: DEF.tables.filter((t) => t.kind === 'rows').length };
      };
      export const form26Seed = (auditId: string, name: string, pan: string, year: string) => {
        const p = prefillParticulars(defaultValues(DEF), { clientName: name, clientPan: pan, financialYear: year });
        return seedRows(DEF, auditId, p.values, p.prefilled);
      };`;
    const out = esbuild.buildSync({ stdin: { contents, resolveDir: path.join(projectRoot, 'src'), loader: 'ts', sourcefile: 'seed-helpers.ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, alias: { '@': path.join(projectRoot, 'src') }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
    const holder = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(holder, holder.exports, require);
    seedHelper = holder.exports;
  }
  return seedHelper;
}
const query = (q) => evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify(q)})`);
// A Form 3CD draft put on an engagement by hand, as the 3CD page leaves it (49 rows stamped once), with
// invented answers saved a day later on the clauses given.
async function seedThreeCdDraft(eng, client, userId, answers) {
  const audit = await query({ table: 'tax_audit_engagements', action: 'insert', data: { engagement_id: eng.id, client_id: client.id, statutory_version: THREE_CD, form_type: '3CB', financial_year: eng.financial_year, assessee_name: client.name, pan: client.pan, setup_json: '{}', review_status: 'draft', locked: 0, created_by: userId } });
  if (audit.error) throw new Error(`3CD audit: ${audit.error.message}`);
  const auditId = audit.data[0].id;
  const rows = seedHelpers().threeCdClauses.map((c) => ({
    tax_audit_id: auditId, clause_key: c.key, clause_no: c.no, clause_title: c.title, statutory_version: THREE_CD, applicability_status: 'applicable',
    response_json: JSON.stringify(answers[c.key] ? { structured: answers[c.key] } : c.key === 'clause_1' ? { structured: { assessee_name: client.name } } : {}),
    prefill_status: c.key === 'clause_1' ? 'auto_filled' : 'needs_input', validation_status: 'not_run', qualification_required: 0, workpaper_ref: `TA-3CD-${c.no}`,
    review_status: 'draft', locked: 0, created_at: '2026-11-20 09:00:00', updated_at: answers[c.key] ? '2026-11-21 11:30:00' : '2026-11-20 09:00:00',
  }));
  const inserted = await query({ table: 'tax_audit_clause_responses', action: 'insert', data: rows });
  if (inserted.error) throw new Error(`3CD rows: ${inserted.error.message}`);
  return auditId;
}
// Everything of a Form 3CD audit as stored (its row, clause rows, evidence links, acceptance check): byte for byte.
const threeCdBytes = (auditId) => JSON.stringify(sql({
  a: ['SELECT * FROM tax_audit_engagements WHERE id = ?', auditId],
  c: ['SELECT * FROM tax_audit_clause_responses WHERE tax_audit_id = ? ORDER BY id', auditId],
  e: ['SELECT * FROM tax_audit_clause_evidence WHERE tax_audit_id = ? ORDER BY id', auditId],
  k: ['SELECT * FROM tax_audit_acceptance_checks WHERE tax_audit_id = ? ORDER BY id', auditId],
}));
const form26Bytes = (engagementId) => JSON.stringify(sql({ r: ['SELECT c.* FROM tax_audit_clause_responses c JOIN tax_audit_engagements a ON a.id = c.tax_audit_id WHERE a.engagement_id = ? AND a.statutory_version = ? ORDER BY c.clause_key', engagementId, F26] }).r);
const f26AuditRow = (engagementId) => sql({ a: ['SELECT * FROM tax_audit_engagements WHERE engagement_id = ? AND statutory_version = ?', engagementId, F26] }).a;
const conversionOf = (engagementId) => { try { return JSON.parse(f26AuditRow(engagementId)[0]?.setup_json || '{}').form26?.conversion ?? null; } catch { return null; } };
const nextUnfilled = async () => Number(((await bodyText()).match(/Next unfilled · (\d+)/) || [])[1]);
const noticeText = () => evaluate(`document.querySelector('[data-f26-conversion-notice]')?.innerText.replace(/\\s+/g, ' ').trim() || ''`);
const DIALOG_CONTROLS = `document.querySelectorAll('[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea, [role="dialog"] [contenteditable="true"], [role="dialog"] [role="checkbox"], [role="dialog"] [role="radio"], [role="dialog"] [role="switch"]').length`;

async function conversionScenarios({ open, insert, client, engagement, userId }) {
  // ── Scenario 15 (task 26): a 2026-27 engagement that already holds a Form 3CD draft with answers ──
  errorPhase = 'form26-convert';
  const eConv = await engagement('2026-27', 'Tax audit 2026-27 (an earlier Form 3CD draft)');
  const convAudit = await seedThreeCdDraft(eConv, client, userId, {
    clause_8a: { opted_for_section_115_taxation: 'yes', selected_section_115_taxation: '115BAA' },
    clause_13: { method_of_accounting: 'Cash', whether_change_in_method: 'no', change_details: 'Invented: no change' },
    clause_31: { clause_31a_loan_deposit_rows: [{ lender_or_depositor_name: 'Invented Lender', amount_of_loan_or_deposit: '50000', transaction_type: 'Loan' }] },
  });
  const evidenceFile = await insert('evidence_files', { engagement_id: eConv.id, name: 'Invented loan confirmation.pdf', file_path: `${eConv.id}/invented-loan-confirmation.pdf`, file_type: 'document', mime_type: 'application/pdf', file_size: 1024, uploaded_by: userId });
  const row31 = sql({ r: ["SELECT id FROM tax_audit_clause_responses WHERE tax_audit_id = ? AND clause_key = 'clause_31'", convAudit] }).r[0];
  const link = await query({ table: 'tax_audit_clause_evidence', action: 'insert', data: { tax_audit_id: convAudit, clause_response_id: row31.id, clause_key: 'clause_31', evidence_file_id: evidenceFile.id, workpaper_ref: 'TA-3CD-31', linked_by: userId } });
  check('conversion: the Form 3CD draft (49 rows, answers in 8a, 13 and 31, one evidence link) is in place', !link.error && sql({ c: ['SELECT count(*) n FROM tax_audit_clause_responses WHERE tax_audit_id = ?', convAudit] }).c[0].n === 49, link.error);
  const convBefore = threeCdBytes(convAudit);

  await open(eConv);
  check('conversion: Tax Audit opens Form No. 26 at once (no question)', await workspaceOpen());
  await waitFor(`Boolean(document.querySelector('[data-f26-conversion-notice]'))`, 15000);
  const notice = await noticeText();
  check('conversion: the notice says in two sentences what happened, that the draft is kept and that its evidence stays in the Evidence Vault, with the link',
    notice === "This engagement's Form 3CD draft was brought into Form No. 26: 3 answers wait for your confirmation, and 5 clauses show the earlier answer beside them. The earlier draft is kept unchanged, and the evidence linked to it stays in the Evidence Vault. View the earlier 3CD draft", notice);
  const notTwice = await evaluate(`document.querySelectorAll('[data-f26-conversion-notice]').length`);
  check('conversion: one notice, at the top of the workspace (under the header, above the panes)', notTwice === 1 && (await evaluate(`(() => { const n = document.querySelector('[data-f26-conversion-notice]').getBoundingClientRect(); const h = document.querySelector('[data-f26-workspace] > header').getBoundingClientRect(); const p = document.querySelector('[data-f26-panes]').getBoundingClientRect(); return n.top >= h.bottom - 1 && n.bottom <= p.top + 1; })()`)));
  await screenshot('f26-15-conversion-notice');
  // Lead's addition (task 27): at 1280 x 720 the notice takes room above the panes until it is dismissed. With it
  // showing: the page does not scroll, the panes' tops are seen, the editor's body keeps at least 300 px and the
  // list shows at least 4 entries, for every entry opened in turn.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  const noticeUnits = await evaluate(`[...document.querySelectorAll('[data-entry-id^="f26_"]')].map((b) => b.getAttribute('data-entry-id'))`);
  const noticeRoom = {};
  const noticePanes = {};
  for (const unit of noticeUnits) {
    await selectClause(unit);
    const bad = await evaluate(PANES_CHECK);
    if (bad.length) noticePanes[unit] = bad;
    noticeRoom[unit] = await evaluate(ROOM_CHECK);
  }
  const noticeBox = await evaluate(`(() => { const n = document.querySelector('[data-f26-conversion-notice]'); const p = document.querySelector('[data-f26-panes]'); const h = document.querySelector('[data-f26-workspace] > header'); if (!n || !p || !h) return null; return { height: Math.round(n.getBoundingClientRect().height), taken: Math.round(p.getBoundingClientRect().top - h.getBoundingClientRect().bottom), text: n.innerText.replace(/\\s+/g, ' ').trim() }; })()`);
  const noticeValues = Object.values(noticeRoom).filter(Boolean);
  const noticeLeast = { editor: Math.min(...noticeValues.map((r) => r.editor)), seen: Math.min(...noticeValues.map((r) => r.seen)), whole: Math.min(...noticeValues.map((r) => r.entries)) };
  console.log(`  room 1280x720 with the conversion notice (${noticeBox && noticeBox.height} px high, ${noticeBox && noticeBox.taken} px between header and panes): editor body min ${noticeLeast.editor} px, list entries with a line seen min ${noticeLeast.seen}, seen whole min ${noticeLeast.whole}; editor < 300: ${Object.entries(noticeRoom).filter(([, r]) => r && r.editor < 300).map(([k, r]) => k.replace('f26_', '') + '=' + r.editor).join(' ') || 'none'}`);
  // The bar: the notice and its gaps take at most 60 px (110 before it was made compact); for EVERY entry the page
  // does not scroll and the panes' tops are seen; for 9 entries in 10 the editor body keeps at least 300 px and the
  // list shows at least 4 entries, and never less than 250 px / 3 entries. The exceptions are the entries that are
  // already at the edge without any notice (POLISH-2's ROOM): the clauses whose heading runs to three or four lines
  // (14, 27: about 313-335 px of editor) and the long list labels around 51-53 (clause 52: 4 entries seen).
  const noticeAbove300 = noticeValues.filter((r) => r.editor >= 300).length;
  const noticeFour = noticeValues.filter((r) => r.seen >= 4).length;
  check(`1280x720 with the conversion notice showing (${noticeBox && noticeBox.height} px, ${noticeBox && noticeBox.taken} px between header and panes): for all ${noticeUnits.length} entries page not scrolled and panes' tops seen; editor body >= 300 px for ${noticeAbove300} (least ${noticeLeast.editor} px), list >= 4 entries for ${noticeFour} (least ${noticeLeast.seen}); the notice's whole text there`,
    noticeBox && noticeBox.text === notice && noticeBox.taken <= 60 && noticeValues.length === noticeUnits.length && noticeUnits.length > 40 && Object.keys(noticePanes).length === 0
      && noticeAbove300 >= 0.9 * noticeValues.length && noticeLeast.editor >= 250 && noticeFour >= 0.9 * noticeValues.length && noticeLeast.seen >= 3,
    { noticeBox, panes: Object.entries(noticePanes).slice(0, 5), low: Object.entries(noticeRoom).filter(([, r]) => !r || r.editor < 300 || r.seen < 4).slice(0, 12) });
  console.log(`  below the bar of 300 px / 4 entries with the notice: ${Object.entries(noticeRoom).filter(([, r]) => r && (r.editor < 300 || r.seen < 4)).map(([k, r]) => `${k.replace('f26_', '')} editor ${r.editor} px, ${r.seen} entries`).join('; ') || 'none'}`);
  await selectClause('f26_c14');
  await screenshot('f26-15-conversion-notice-1280x720-clause-14');
  await cdp('Emulation.clearDeviceMetricsOverride');
  await sleep(500);
  check('conversion: 122 Form No. 26 rows; the conversion recorded as complete with c10, 15(a), 15(b) carried', rowsOf(eConv.id).length === 122 && Boolean(conversionOf(eConv.id)?.completedAt) && JSON.stringify(conversionOf(eConv.id)?.carried) === '["c10","c15a","c15b"]', conversionOf(eConv.id));
  check('conversion: every Form 3CD row, link and check is byte-equal to before', threeCdBytes(convAudit) === convBefore);

  await selectClause('f26_c10');
  const brought = await evaluate(`(() => { const body = document.querySelector('[data-f26-editor-body]'); return { text: body.innerText, confirm: [...body.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm'), value: document.getElementById('f26-f-c10')?.value }; })()`);
  check('conversion: clause 10 shows "Yes" brought from the 3CD draft, with "Confirm"', brought.value === 'Yes' && brought.text.includes('Brought from the 3CD draft') && brought.confirm, brought);
  const countBefore = await nextUnfilled();
  const clauseCount = await evaluate(`document.querySelector('[data-entry-id="f26_c10"]')?.innerText.replace(/\\s+/g, ' ').trim()`);
  check('conversion: a brought answer counts as unfilled (clause 10 shows 1 unfilled in the list)', /\b1\b/.test(clauseCount || '') , clauseCount);
  await screenshot('f26-15-brought-confirm');
  await clickReal(`[...document.querySelectorAll('[data-f26-editor-body] button')].find((b) => b.textContent.trim() === 'Confirm')`);
  const confirmed = await waitStored(eConv.id, 'f26_c10', (p) => p.f.c10 === 'Yes' && !p.brought);
  check('conversion: "Confirm" keeps "Yes" and takes the mark off in the database', confirmed, parsed(rowOf(eConv.id, 'f26_c10')));
  await waitFor(`!document.querySelector('[data-f26-editor-body]').innerText.includes('Brought from the 3CD draft')`, 5000);
  check('conversion: once confirmed it counts no more ("Next unfilled" one less)', (await nextUnfilled()) === countBefore - 1, { before: countBefore, now: await nextUnfilled() });
  check('conversion: the notice now says 2 answers wait', (await noticeText()).includes('2 answers wait for your confirmation'), await noticeText());

  await selectClause('f26_c45');
  check('conversion: clause 45 says quietly that the earlier draft has an answer for it', (await evaluate(`document.querySelector('[data-f26-3cd-answer-line]')?.innerText.replace(/\\s+/g, ' ').trim()`)) === 'The earlier Form 3CD draft has an answer for this clause. See it');
  await clickReal(`document.querySelector('[data-f26-3cd-answer-link]')`);
  const beside = await waitFor(`(() => { const tab = document.querySelector('[data-f26-pane-tab="three-cd-draft"]'); const block = document.querySelector('[data-f26-last-year-answers="clause_31"]'); return tab?.getAttribute('data-state') === 'active' && block && block.innerText.includes('Invented Lender') ? block.innerText : false; })()`, 8000);
  const besidePane = await evaluate(`(() => { const pane = document.querySelector('[data-f26-last-year]'); return pane ? { text: pane.innerText, controls: pane.querySelectorAll('input, select, textarea, [contenteditable="true"]').length, buttons: pane.querySelectorAll('button').length } : null; })()`);
  check('conversion: the right pane\'s "3CD draft" tab shows the old clause 31 rows of clause 45 as text, read only', beside && besidePane && besidePane.controls === 0 && besidePane.buttons === 0 && besidePane.text.includes("This engagement's earlier Form 3CD draft"), besidePane);
  await screenshot('f26-15-old-answer-beside-clause-45');
  const tabsFit = await evaluate(`(() => { const row = document.querySelector('[data-f26-pane-title]'); const list = row?.querySelector('[role="tablist"]'); if (!row || !list) return null; return { tabs: [...list.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()), fits: list.scrollWidth <= list.clientWidth + 1 && row.scrollWidth <= row.clientWidth + 1, height: Math.round(row.getBoundingClientRect().height) }; })()`);
  check('conversion: the pane\'s title row holds "Evidence · Last year · 3CD draft" and the fold on one line', tabsFit && JSON.stringify(tabsFit.tabs) === '["Evidence","Last year","3CD draft"]' && tabsFit.fits && tabsFit.height <= 48, tabsFit);

  await clickReal(`document.querySelector('[data-f26-conversion-notice] [data-f26-view-3cd-draft]')`);
  const listed = await waitFor(`document.querySelectorAll('[role="dialog"] [data-f26-3cd-draft-clause]').length === 49`, 8000);
  const dialog = await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? { text: d.innerText, controls: ${DIALOG_CONTROLS}, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')) } : null; })()`);
  check('"View the earlier 3CD draft" lists the 49 clauses read only (titles, state, answers; only the close button)', listed && dialog && dialog.controls === 0 && JSON.stringify(dialog.buttons) === '["Close"]' && dialog.text.includes('Clause 13 · Method of accounting and changes therein') && dialog.text.includes('Cash') && dialog.text.includes('Invented Lender'), dialog && { controls: dialog.controls, buttons: dialog.buttons });
  await screenshot('f26-15-3cd-draft-read-only');
  await press('Escape');
  check('the dialog closes with Esc', await waitFor(`!document.querySelector('[role="dialog"]')`, 5000));
  await clickReal(`document.querySelector('[data-f26-dismiss-notice]')`);
  check('the notice can be dismissed', await waitFor(`!document.querySelector('[data-f26-conversion-notice]')`, 5000));
  check('conversion: after all of it, every Form 3CD row, link and check is still byte-equal to before', threeCdBytes(convAudit) === convBefore);
  check('conversion: the evidence stays linked to the 3CD draft (the Form No. 26 audit has none)', sql({ e: ['SELECT tax_audit_id FROM tax_audit_clause_evidence WHERE evidence_file_id = ?', evidenceFile.id] }).e.map((r) => r.tax_audit_id).join() === convAudit);

  // ── 15, untouched: a Form 3CD draft as the 3CD page left it on opening, nothing more ──
  errorPhase = 'form26-convert-untouched';
  const eUnt = await engagement('2026-27', 'Tax audit 2026-27 (an untouched Form 3CD draft)');
  const untAudit = await seedThreeCdDraft(eUnt, client, userId, {});
  const untBefore = threeCdBytes(untAudit);
  await open(eUnt);
  check('untouched: Form No. 26 opens', await workspaceOpen());
  await sleep(1500);
  check('untouched: no notice, no "3CD draft" tab', !(await evaluate(`Boolean(document.querySelector('[data-f26-conversion-notice]')) || Boolean(document.querySelector('[data-f26-pane-tab="three-cd-draft"]'))`)));
  const untRows = rowsOf(eUnt.id);
  check('untouched: 122 rows exactly as a new audit (no brought mark; the presets and the three particulars)', untRows.length === 122 && untRows.every((r) => !parsed(r).brought) && parsed(rowOf(eUnt.id, 'f26_c10')).f.c10 === 'No' && conversionOf(eUnt.id)?.untouched === true && Boolean(conversionOf(eUnt.id)?.completedAt), conversionOf(eUnt.id));
  check('untouched: "Next unfilled" is 42, as for a new audit', (await nextUnfilled()) === 42, await nextUnfilled());
  await openSummary();
  check('untouched: the Review Summary has the quiet link "View the earlier 3CD draft"', (await evaluate(`document.querySelector('[data-f26-summary-3cd-draft]')?.innerText.replace(/\\s+/g, ' ').trim()`)) === 'This engagement also holds an earlier Form 3CD draft, kept unchanged. View the earlier 3CD draft');
  await screenshot('f26-15-untouched-summary-link');
  check('untouched: every Form 3CD row is byte-equal to before', threeCdBytes(untAudit) === untBefore);

  // ── 15, half-converted: an audit row with conversion.startedAt and 30 rows put in by hand ──
  errorPhase = 'form26-convert-half';
  const eHalf = await engagement('2026-27', 'Tax audit 2026-27 (a conversion left half done)');
  const halfAudit = await seedThreeCdDraft(eHalf, client, userId, { clause_8a: { opted_for_section_115_taxation: 'yes' } });
  const halfBefore = threeCdBytes(halfAudit);
  const setup = { form26: { v: 1, category: '2', showAllSchedules: false, conversion: { fromTaxAuditId: halfAudit, startedAt: '2026-11-22T09:00:00.000Z', untouched: false, carried: [] } } };
  const f26 = await query({ table: 'tax_audit_engagements', action: 'insert', data: { engagement_id: eHalf.id, client_id: client.id, statutory_version: F26, form_type: '3CB', financial_year: '2026-27', assessee_name: client.name, pan: client.pan, books_audited_under_other_law: 0, setup_json: JSON.stringify(setup), review_status: 'draft', created_by: userId } });
  const thirty = seedHelpers().form26Seed(f26.data?.[0]?.id, client.name, client.pan, '2026-27').slice(0, 30);
  const put = await query({ table: 'tax_audit_clause_responses', action: 'insert', data: thirty });
  check('half-converted: the Form No. 26 audit row and 30 of its rows (the row of clause 10 among them, as seeded) are in place', !f26.error && !put.error && rowsOf(eHalf.id).length === 30, f26.error || put.error);
  await open(eHalf);
  check('half-converted: Form No. 26 opens', await workspaceOpen());
  await waitFor(`Boolean(document.querySelector('[data-f26-conversion-notice]'))`, 15000);
  const halfRows = rowsOf(eHalf.id);
  const marks = halfRows.filter((r) => parsed(r).brought).map((r) => Object.keys(parsed(r).brought));
  check('half-converted: after opening, 122 rows; the carried value present once (10: "Yes", marked); the conversion complete', halfRows.length === 122 && new Set(halfRows.map((r) => r.clause_key)).size === 122 && JSON.stringify(marks) === '[["c10"]]' && parsed(rowOf(eHalf.id, 'f26_c10')).f.c10 === 'Yes' && Boolean(conversionOf(eHalf.id)?.completedAt), { n: halfRows.length, marks, conversion: conversionOf(eHalf.id) });
  check('half-converted: one Form No. 26 audit row', f26AuditRow(eHalf.id).length === 1);
  const halfAfter = form26Bytes(eHalf.id);
  await open(eHalf);
  await workspaceOpen();
  await sleep(1500);
  check('half-converted: opening it again writes nothing', form26Bytes(eHalf.id) === halfAfter);
  check('half-converted: every Form 3CD row is byte-equal to before', threeCdBytes(halfAudit) === halfBefore);

  // ── Scenario 16 (task 26): a changed year ─────────────────────────────
  errorPhase = 'form26-year-changed';
  const eMove = await engagement('2026-27', 'Tax audit 2026-27 (year changed back and forth)');
  await open(eMove);
  check('changed year: 2026-27 opens Form No. 26', await workspaceOpen());
  await selectClause('f26_c13');
  await typeInto('f26-f-c13', 'Invented books kept at the head office');
  await press('Tab');
  check('changed year: an answer typed in Form No. 26 is stored', await waitStored(eMove.id, 'f26_c13', (p) => p.f.c13 === 'Invented books kept at the head office'));
  await sleep(800);
  const moveBytes = form26Bytes(eMove.id);
  const setYear = async (year) => {
    const r = await query({ table: 'engagements', action: 'update', data: { financial_year: year }, filters: [{ column: 'id', operator: 'eq', value: eMove.id }] });
    if (r.error) throw new Error(`engagement year: ${r.error.message}`);
    return { ...eMove, financial_year: year };
  };
  const back = await setYear('2025-26');
  await open(back);
  const threeCdShown = await waitFor(`Boolean(${byText('[role="tab"]', '3CD Clause Workspace')})`, 30000);
  const draftNotice = await waitFor(`document.querySelector('[data-f26-draft-notice]')?.innerText.replace(/\\s+/g, ' ').trim()`, 15000);
  check('changed year: 2025-26 opens the Form 3CD screens, with the notice that the Form No. 26 draft is kept above them', threeCdShown && draftNotice === 'This engagement holds a Form No. 26 draft made when its year was 2026-27 or later. It is kept. View it', draftNotice);
  await screenshot('f26-16-year-back-3cd-with-notice');
  await clickReal(`document.querySelector('[data-f26-draft-view]')`);
  const readOnly = await waitFor(`(() => { const d = document.querySelector('[role="dialog"]'); return d && d.innerText.includes('Invented books kept at the head office') && d.querySelector('[data-f26-readonly-save]') ? true : false; })()`, 20000);
  const roDialog = await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? { controls: ${DIALOG_CONTROLS}, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')) } : null; })()`);
  check('changed year: "View it" shows the Form No. 26 draft read only (the answer typed; only "Save file (.json)" and the close button)', readOnly && roDialog && roDialog.controls === 0 && JSON.stringify(roDialog.buttons) === '["Save file (.json)","Close"]', roDialog);
  const roText = await evaluate(`document.querySelector('[role="dialog"]')?.innerText || ''`);
  check('changed year: the read-only view carries no draft notice (owner, 22 Nov 2026)', roText.includes('FORM NO. 26') && !NO_NOTICE.test(roText), (roText.match(NO_NOTICE) || [])[0]);
  await screenshot('f26-16-form26-draft-read-only');
  await forget('Form26_AAAAA0000A.json');
  await clickReal(`document.querySelector('[data-f26-readonly-save]')`);
  const savedFile = await downloaded('Form26_AAAAA0000A.json');
  let savedOk = false;
  try { savedOk = JSON.parse(savedFile.toString('utf8')).f?.c13 === 'Invented books kept at the head office'; } catch { savedOk = false; }
  check('changed year: its "Save file (.json)" saves the answers through "Save As"', savedOk);
  await press('Escape');
  await waitFor(`!document.querySelector('[role="dialog"]')`, 5000);
  await sleep(1500);
  check('changed year: under 2025-26 the Form No. 26 rows are unchanged (byte for byte)', form26Bytes(eMove.id) === moveBytes);
  check('changed year: the Form 3CD screens made their own audit, as today', sql({ a: ['SELECT id FROM tax_audit_engagements WHERE engagement_id = ? AND statutory_version <> ?', eMove.id, F26] }).a.length === 1);

  const forward = await setYear('2026-27');
  await open(forward);
  check('changed year: back to 2026-27 opens Form No. 26 with all its answers', (await workspaceOpen()) && (await selectClause('f26_c13')) && (await valueOf('f26-f-c13')) === 'Invented books kept at the head office');
  await sleep(1000);
  check('changed year: and nothing in its rows changed', form26Bytes(eMove.id) === moveBytes);
  check('changed year: no notice of a conversion (the audit was not converted)', !(await evaluate(`Boolean(document.querySelector('[data-f26-conversion-notice]'))`)));
  await openSummary();
  check('changed year: the Form 3CD draft made meanwhile is reachable from the Review Summary', await waitFor(`Boolean(document.querySelector('[data-f26-summary-3cd-draft]'))`, 8000));

  const later = await setYear('2027-28');
  await open(later);
  check('changed year: 2027-28 opens the same Form No. 26 audit', await workspaceOpen());
  await sleep(800);
  check('changed year: the audit row follows the year (2027-28)', f26AuditRow(eMove.id)[0]?.financial_year === '2027-28' && f26AuditRow(eMove.id).length === 1);
  check('changed year: the rows are unchanged until the user acts', form26Bytes(eMove.id) === moveBytes);
  await selectClause('f26_p8');
  const yearLine = await waitFor(`document.querySelector('[data-f26-year-update]')?.innerText.replace(/\\s+/g, ' ').trim()`, 5000);
  check('changed year: under item 8 "The engagement is now for 2027-28." with "Update"', yearLine === 'The engagement is now for 2027-28. Update', yearLine);
  await screenshot('f26-16-year-moved-on-item-8');
  await clickReal(`document.querySelector('[data-f26-year-update-button]')`);
  check('changed year: "Update" stores 2027-28 in item 8 and the line goes', (await waitStored(eMove.id, 'f26_p8', (p) => p.f['C.ty'] === '2027-28')) && (await waitFor(`!document.querySelector('[data-f26-year-update]')`, 5000)));
  void insert;
}

// ── Scenario 14 (task 27): hundreds of rows ─────────────────────────────────
// A file with 250 rows in every add/delete table (70,364 cells) is loaded into a new audit; clause 29 is opened at
// row 240 and 12 keys are typed: each key-to-paint (from the key's event to the frame after it, measured in the
// page with performance.now() and the next animation frame) must stay under 100 ms; the save after the table's
// wait updates exactly one database row (f26_t_S29), told by updated_at and response_json of every row.
const rowStamps = (engagementId) => new Map(rowsOf(engagementId).map((r) => [r.clause_key, `${r.updated_at}|${r.review_status}|${r.locked}|${r.response_json}`]));
const typedKey = (ch) => (ch === ' ' ? { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' } : { key: ch, code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0), text: ch });
const timings = {};

async function hundredsOfRowsScenario({ open, insert, userId }) {
  errorPhase = 'form26-250-rows';
  const big = seedHelpers().bigSaveFile(fs.readFileSync(fixturePath, 'utf8'));
  check(`a save file with 250 rows in each of the ${big.rowsTables} add/delete tables: 70,364 cells (${(big.text.length / 1e6).toFixed(1)} million characters)`, big.cells === 70364 && big.rowsTables === 52, big.cells);
  const loadDir = path.join(runtimeRoot, 'files');
  fs.mkdirSync(loadDir, { recursive: true });
  const bigFile = path.join(loadDir, 'Form26_250-rows.json');
  fs.writeFileSync(bigFile, big.text);
  const client3 = await insert('clients', { name: 'Invented Large Schedules Private Limited', constitution: 'company', pan: 'AAAAC2222C' });
  const eBig = await insert('engagements', { name: 'Tax audit 2026-27 (250 rows in every table)', client_id: client3.id, client_name: client3.name, financial_year: '2026-27', engagement_type: 'tax', created_by: userId });
  await open(eBig);
  check('250 rows: the engagement opens Form No. 26', await workspaceOpen());
  await openSummary();
  await setFile('[data-f26-load-input]', bigFile);
  const dialog = await waitFor(`(() => { const d = document.querySelector('[role="dialog"] [data-f26-import]'); return d ? d.innerText : false; })()`, 60000);
  check('250 rows: the dialog names "142 answers and 65 tables (70,364 cells)"', dialog && dialog.includes('142 answers and 65 tables (70,364 cells)'), dialog);
  await forget('Form26_AAAAC2222C_before-import.json');
  let started = Date.now();
  await clickReal(`document.querySelector('[data-f26-import-confirm]')`);
  const loaded = await waitFor(`(() => { const t = document.querySelector('[data-f26-download-line]')?.textContent.trim(); return t && t.startsWith('Loaded') ? t : false; })()`, 300000);
  timings.load = (Date.now() - started) / 1000;
  check(`250 rows: loaded in ${timings.load.toFixed(1)} s: "Loaded 142 answers and 65 tables from Form26_250-rows.json."`, loaded === 'Loaded 142 answers and 65 tables from Form26_250-rows.json.', loaded || (await evaluate(`document.querySelector('[data-f26-import]')?.innerText || ''`)));
  await waitFor(`!document.querySelector('[data-f26-import]')`, 10000);
  check('250 rows: the database holds the file byte for byte (serialiseSaveFile of the stored rows)', storedSaveFile(eBig.id) === big.text);
  const s29 = parsed(rowOf(eBig.id, 'f26_t_S29')).rows || [];
  check('250 rows: schedule 29 is one row of its own with 250 rows', s29.length === 250 && s29[239]['1'] === 'Invented S29 r240 c1', s29.length);

  await clickReal(byText('[data-f26-workspace] [role="tab"]', 'Clauses'));
  await waitFor(`Boolean(document.querySelector('[data-f26-editor-body]'))`, 8000);
  started = Date.now();
  await selectClause('f26_c29');
  const drawn = await waitFor(`document.querySelectorAll('[id^="f26-t-S29-row-"]').length || document.querySelectorAll('#f26-t-S29 tbody tr').length`, 30000);
  timings.openClause29 = (Date.now() - started) / 1000;
  const asRowList = await evaluate(`Boolean(document.getElementById('f26-t-S29-row-239'))`);
  if (asRowList) await openListedRow('S29', 239);
  const cellId = 'f26-t-S29-239-1';
  const cellBefore = await valueOf(cellId);
  check(`250 rows: clause 29 opens in ${timings.openClause29.toFixed(1)} s with its 250 rows (${asRowList ? 'row list' : 'grid'}); row 240 holds its value`, Number(drawn) >= 250 && cellBefore === 'Invented S29 r240 c1', { drawn, cellBefore });
  await sleep(1500);
  const before = rowStamps(eBig.id);
  const ready = await evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(cellId)});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    window.__keyToPaint = [];
    window.__keyToPaintOn = (event) => {
      const now = performance.now();
      const from = event.timeStamp > 0 && event.timeStamp <= now && now - event.timeStamp < 1000 ? event.timeStamp : now;
      requestAnimationFrame(() => { const channel = new MessageChannel(); channel.port1.onmessage = () => window.__keyToPaint.push(Math.round((performance.now() - from) * 10) / 10); channel.port2.postMessage(0); });
    };
    window.addEventListener('keydown', window.__keyToPaintOn, true);
    return document.activeElement === el;
  })()`);
  const typed = ' twelve keys';
  for (const ch of typed) {
    const k = typedKey(ch);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
    await sleep(150);
  }
  const keyToPaint = await waitFor(`window.__keyToPaint && window.__keyToPaint.length >= 12 ? window.__keyToPaint : false`, 10000);
  await evaluate(`(window.removeEventListener('keydown', window.__keyToPaintOn, true), true)`);
  const cellAfter = await valueOf(cellId);
  const sorted = Array.isArray(keyToPaint) ? [...keyToPaint].sort((a, b) => a - b) : [];
  timings.keyToPaint = sorted;
  console.log(`  key-to-paint in row 240 of S29 (ms, sorted): ${sorted.join(', ')}`);
  check(`250 rows: 12 keys typed in row 240 of S29, each key-to-paint under 100 ms (median ${sorted[6]} ms, most ${sorted[11]} ms)`, ready && sorted.length === 12 && sorted[11] < 100 && cellAfter === `Invented S29 r240 c1${typed}`, { ready, keyToPaint, cellAfter });
  await screenshot('f26-14-250-rows-row-240');
  // The keyboard stays in the cell: the save is the table's own after its wait.
  const savedRow = await waitStored(eBig.id, 'f26_t_S29', (p) => p.rows[239]['1'] === `Invented S29 r240 c1${typed}`, 20000);
  await sleep(2500);
  const after = rowStamps(eBig.id);
  const changed = [...after.keys()].filter((key) => after.get(key) !== before.get(key));
  const rowsNow = parsed(rowOf(eBig.id, 'f26_t_S29')).rows || [];
  const othersKept = rowsNow.length === 250 && rowsNow.every((row, i) => i === 239 || JSON.stringify(row) === JSON.stringify(s29[i]));
  check('250 rows: the save after the wait updated exactly one database row, f26_t_S29 (the other 249 rows of S29 as they were)', savedRow && JSON.stringify(changed) === '["f26_t_S29"]' && othersKept && after.size === 122, { changed, rows: rowsNow.length, othersKept });
  check('250 rows: the header reads "Saved HH:MM"', SAVED.test(await saveLine()), await saveLine());
  await evaluate(`(document.activeElement?.blur(), true)`);
  await sleep(1500);

  // The outputs of this audit, timed (the window's own thread does the work; "Preparing…" stays on its button).
  await openSummary();
  for (const [id, name, done] of [['word', 'Form26_AAAAA0000A.docx', 'The Word file was saved.'], ['pdf', 'Form26_AAAAA0000A.pdf', 'The PDF was saved.'], ['pack', 'Form26_AAAAA0000A_working-papers.docx', 'The working-paper pack was saved.'], ['json', 'Form26_AAAAA0000A.json', 'The save file was saved.']]) {
    started = Date.now();
    const got = await downloadFrom(id, name, 420000);
    timings[id] = (Date.now() - started) / 1000;
    const first = got.file ? (id === 'pdf' ? got.file.slice(0, 4).toString() : got.file.slice(0, 2).toString('hex')) : '';
    const sameAsStored = id !== 'json' || (got.file && got.file.toString('utf8') === storedSaveFile(eBig.id));
    check(`250 rows: ${name} made in ${timings[id].toFixed(1)} s and saved ("${done}")`, got.file && got.line === done && (id === 'pdf' ? first === '%PDF' : id === 'json' ? sameAsStored : first === '504b'), { line: got.line, first, size: got.file && got.file.length });
    if (id === 'json' && got.file) {
      fs.mkdirSync(officeFilePath, { recursive: true });
      fs.writeFileSync(path.join(officeFilePath, 'Form26_250-rows-app-export.json'), got.file);
    }
  }
  console.log(`  timings (s): load ${timings.load}, open clause 29 ${timings.openClause29}, Word ${timings.word}, PDF ${timings.pdf}, pack ${timings.pack}, save file ${timings.json}`);
}

// ── Scenario 17 (task 27): a change made elsewhere while a field has the keyboard ──
// Two windows on one profile are not possible here: the other user's change is written through the database client
// (sqliteQuery, as another window would), a second later than the row the screen holds.
async function concurrentScenarios({ open, engagement, userId }) {
  errorPhase = 'form26-elsewhere';
  const eTwo = await engagement('2026-27', 'Tax audit 2026-27 (a change made elsewhere)');
  await open(eTwo);
  check('elsewhere: the engagement opens Form No. 26', await workspaceOpen());
  await selectClause('f26_p2');
  const p2 = () => rowOf(eTwo.id, 'f26_p2');
  const elsewhere = async (fields, columns = {}) => {
    await sleep(1100);
    const row = p2();
    const data = { ...columns };
    if (fields) { const payload = parsed(row); payload.f = { ...(payload.f || {}), ...fields }; data.response_json = JSON.stringify(payload); }
    const r = await query({ table: 'tax_audit_clause_responses', action: 'update', data, filters: [{ column: 'id', operator: 'eq', value: row.id }] });
    if (r.error) throw new Error(`a change elsewhere: ${r.error.message}`);
    return p2().updated_at > row.updated_at;
  };
  const lineOf = (key) => evaluate(`(() => { const l = document.getElementById('f26-f-${key}-line'); return l ? { text: l.innerText.replace(/\\s+/g, ' ').trim(), buttons: [...l.querySelectorAll('button')].map((b) => b.textContent.trim()) } : { text: '', buttons: [] }; })()`);

  // A different field of the same row: both values end up stored.
  check('elsewhere: item 2 road typed while its box has the keyboard', await typeInto('f26-f-C-a3', 'Invented Road Mine'));
  const laterA = await elsewhere({ 'C.a4': 'Invented Area Theirs' });
  await press('Tab');
  const merged = await waitStored(eTwo.id, 'f26_p2', (p) => p.f['C.a3'] === 'Invented Road Mine' && p.f['C.a4'] === 'Invented Area Theirs');
  check('elsewhere, another field: on leaving the road, both values are in the database (theirs written a second later)', laterA && merged, parsed(p2()).f);
  check('elsewhere, another field: no clash line under the road', (await lineOf('C-a3')).text === '', await lineOf('C-a3'));
  const tabbedTo = await evaluate(`document.activeElement?.id || ''`);
  await press('Tab');
  await sleep(1500);
  const area = { tabbedTo, shown: await valueOf('f26-f-C-a4'), stored: parsed(p2()).f['C.a4'], line: (await lineOf('C-a4')).text };
  check('elsewhere, another field: the area box, entered by Tab and left without typing, shows their value and raises no clash', area.shown === 'Invented Area Theirs' && area.stored === 'Invented Area Theirs' && area.line === '', area);

  // The same field: "Keep mine".
  await typeInto('f26-f-C-a3', 'Invented Road Mine 2');
  await elsewhere({ 'C.a3': 'Invented Road Theirs 2' });
  await evaluate(`(document.activeElement?.blur(), true)`);
  let clash = await waitFor(`(() => { const l = document.getElementById('f26-f-C-a3-line'); const t = l?.innerText.replace(/\\s+/g, ' ').trim(); return t && t.startsWith('Changed by someone else') ? { text: t, buttons: [...l.querySelectorAll('button')].map((b) => b.textContent.trim()) } : false; })()`, 8000);
  check('elsewhere, the same field: on leaving, "Changed by someone else at HH:MM." with "Keep mine · Use theirs" under the road', clash && /^Changed by someone else at \d{2}:\d{2}\./.test(clash.text) && JSON.stringify(clash.buttons) === '["Keep mine","Use theirs"]', clash || (await lineOf('C-a3')));
  check('elsewhere, the same field: theirs stays stored until a choice is made; the header asks for one', parsed(p2()).f['C.a3'] === 'Invented Road Theirs 2' && (await saveLine()) === 'Someone else changed this clause. Choose which entry to keep.', { stored: parsed(p2()).f['C.a3'], header: await saveLine() });
  await screenshot('f26-17-conflict-line');
  await clickReal(byText('#f26-f-C-a3-line button', 'Keep mine'));
  let kept = await waitStored(eTwo.id, 'f26_p2', (p) => p.f['C.a3'] === 'Invented Road Mine 2');
  check('"Keep mine": mine is stored on top of theirs, the line goes, the box shows mine', kept && (await waitFor(`!document.getElementById('f26-f-C-a3-line')?.textContent.trim()`, 5000)) && (await valueOf('f26-f-C-a3')) === 'Invented Road Mine 2', { stored: parsed(p2()).f['C.a3'], line: await lineOf('C-a3') });

  // The same field: "Use theirs".
  await typeInto('f26-f-C-a3', 'Invented Road Mine 3');
  await elsewhere({ 'C.a3': 'Invented Road Theirs 3' });
  await evaluate(`(document.activeElement?.blur(), true)`);
  clash = await waitFor(`(() => { const t = document.getElementById('f26-f-C-a3-line')?.innerText; return t && t.includes('Changed by someone else') ? t : false; })()`, 8000);
  check('elsewhere, the same field again: the clash line appears', Boolean(clash), await lineOf('C-a3'));
  await clickReal(byText('#f26-f-C-a3-line button', 'Use theirs'));
  await sleep(1500);
  const theirs = { shown: await valueOf('f26-f-C-a3'), stored: parsed(p2()).f['C.a3'], line: (await lineOf('C-a3')).text, header: await saveLine() };
  check('"Use theirs": the box shows theirs, theirs stays stored, mine is not sent, the line goes', theirs.shown === 'Invented Road Theirs 3' && theirs.stored === 'Invented Road Theirs 3' && theirs.line === '' && !/Could not save|Someone else/.test(theirs.header), theirs);

  // Approved through another window while the user types: the entry is refused and the user told.
  const townBefore = parsed(p2()).f['C.a5'] ?? '';
  await typeInto('f26-f-C-a5', 'Invented Town Typed');
  const approvedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await elsewhere(null, { review_status: 'approved', locked: 1, approved_by: userId, approved_at: approvedAt });
  await evaluate(`(document.activeElement?.blur(), true)`);
  const refused = await waitFor(`(() => { const l = document.getElementById('f26-f-C-a5-line'); const t = l?.innerText.replace(/\\s+/g, ' ').trim(); return t && t.includes('approved') ? { text: t, buttons: [...l.querySelectorAll('button')].map((b) => b.textContent.trim()) } : false; })()`, 8000);
  check('approved while typing: "This clause was approved while you were typing. Your entry was not saved." with "Use theirs" only', refused && refused.text === 'This clause was approved while you were typing. Your entry was not saved. Use theirs' && JSON.stringify(refused.buttons) === '["Use theirs"]', refused || (await lineOf('C-a5')));
  const rowNow = p2();
  const approvedHeader = await saveLine();
  check('approved while typing: the header says so in the same sentence, not "Choose which entry to keep"', approvedHeader.includes('This clause was approved while you were typing. Your entry was not saved.') && !/Choose which entry|Someone else changed/.test(approvedHeader), approvedHeader);
  check('approved while typing: the entry is not in the database; the clause stays approved and locked', (parsed(rowNow).f['C.a5'] ?? '') === townBefore && rowNow.review_status === 'approved' && Number(rowNow.locked) === 1, { town: parsed(rowNow).f['C.a5'], status: rowNow.review_status, locked: rowNow.locked });
  await screenshot('f26-17-approved-while-typing');
  await clickReal(byText('#f26-f-C-a5-line button', 'Use theirs'));
  await sleep(1000);
  const lockedNow = await evaluate(`(() => { const boxes = ['f26-f-C-a3', 'f26-f-C-a4', 'f26-f-C-a5'].map((id) => document.getElementById(id)); return { town: boxes[2]?.value, readOnly: boxes.every((b) => b && (b.readOnly || b.disabled)), edit: Boolean(${byText('[data-f26-workspace] section header button', 'Edit')}), line: document.getElementById('f26-f-C-a5-line')?.textContent.trim() || '' }; })()`);
  check('approved while typing, "Use theirs": the stored town is shown, the clause is read only with "Edit" offered', lockedNow.town === townBefore && lockedNow.readOnly && lockedNow.edit && lockedNow.line === '', lockedNow);
  check('elsewhere: the clause row holds theirs and mine as chosen, nothing else written', parsed(p2()).f['C.a3'] === 'Invented Road Theirs 3' && parsed(p2()).f['C.a4'] === 'Invented Area Theirs' && rowsOf(eTwo.id).length === 122);

  // ── UX 3.12 item 10 (FIX-T29): the save-failed state, forced. The main process answers every update of a
  // clause row with an error while the switch is on (the store's own failure path), then lets them through again.
  errorPhase = 'form26-forced-failure';
  const wrapped = await mainEval(`(() => {
    const { ipcMain } = process.mainModule.require('electron');
    if (global.__f26FailWrap) return 'wrapped';
    const handlers = ipcMain._invokeHandlers;
    const original = handlers && handlers.get('sqlite-query');
    if (typeof original !== 'function') return 'no handler map';
    global.__f26FailSaves = false;
    ipcMain.removeHandler('sqlite-query');
    ipcMain.handle('sqlite-query', (event, payload) => (global.__f26FailSaves && payload && payload.table === 'tax_audit_clause_responses' && payload.action === 'update' ? { data: null, error: { message: 'Invented failure (application test)' } } : original(event, payload)));
    global.__f26FailWrap = true;
    return 'wrapped';
  })()`);
  check('save failed: the main process can refuse clause saves for the test', wrapped === 'wrapped', wrapped);
  await selectClause('f26_c14');
  const c14Before = parsed(rowOf(eTwo.id, 'f26_c14')).f?.c14b ?? '';
  await mainEval('(global.__f26FailSaves = true)');
  await typeInto('f26-f-c14b', 'Invented method kept on screen');
  await evaluate(`(document.activeElement?.blur(), true)`);
  const failedLine = await waitFor(`(() => { const t = document.querySelector('[data-f26-save-state]')?.textContent.trim(); return t && t.startsWith('Could not save') ? t : false; })()`, 15000);
  const onScreen = { line: failedLine, shown: await valueOf('f26-f-c14b'), stored: parsed(rowOf(eTwo.id, 'f26_c14')).f?.c14b ?? '', retry: await evaluate(`Boolean(${byText('[data-f26-workspace] header button', 'Try again')})`) };
  check('save failed: the header says "Could not save. Your entry is still on screen. Try again." with "Try again"; the entry stays on screen, nothing stored', onScreen.line === 'Could not save. Your entry is still on screen. Try again.' && onScreen.shown === 'Invented method kept on screen' && onScreen.stored === c14Before && onScreen.retry, onScreen);
  await screenshot('f26-18-save-failed');
  await mainEval('(global.__f26FailSaves = false)');
  errorPhase = 'form26-save-failed-healed';
  await clickReal(byText('[data-f26-workspace] header button', 'Try again'));
  const healed = await waitStored(eTwo.id, 'f26_c14', (payload) => payload.f.c14b === 'Invented method kept on screen', 15000);
  check('save failed, "Try again" once saving works: the entry is stored and the header reads "Saved HH:MM"', healed && (await waitFor(`/^Saved \\d{2}:\\d{2}$/.test(document.querySelector('[data-f26-save-state]')?.textContent.trim() || '')`, 10000)), await saveLine());
}

main().catch(async (err) => {
  console.error(err);
  console.error(`stdout tail:\n${stdout.slice(-3000)}\nstderr tail:\n${stderr.slice(-3000)}`);
  try { await closeApp(); } catch { /* already closed */ }
  try { if (child && child.exitCode === null) child.kill(); } catch { /* gone */ }
  console.log(`Screenshots and profile: ${runtimeRoot}`);
  process.exitCode = 1;
});
