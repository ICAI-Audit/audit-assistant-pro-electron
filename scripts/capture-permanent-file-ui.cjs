// Screenshot, keyboard and accessibility capture for the Permanent File screen (T-032).
//
//   npm run build
//   node scripts/capture-permanent-file-ui.cjs --label before|after [--axe <path to axe.min.js>] [--out docs/ui-refresh]
//
// Launches the production main process on a throw-away profile through
// scripts/fsg-electron-entry.cjs, signs in as a synthetic admin, seeds two
// synthetic clients (one empty, one populated) and drives the real renderer over
// the Chrome DevTools Protocol. Writes PNGs to <out>/<label>/ and a JSON report.
//
// The desktop window cannot be narrower than 1024 px, so 768 and 390 are content
// width stress tests: the viewport is emulated and the sidebar is collapsed.
// Nothing here touches a real audit_assistant.db or any client data.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const label = option('label', 'run');
const axePath = option('axe', '');
const widths = option('widths', '1440,1024,768,390').split(',').map(Number);
const modalWidths = option('modal-widths', '1440,390').split(',').map(Number);

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.resolve(projectRoot, option('out', 'docs/ui-refresh'), label);
const electronPath = require('electron');
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icai-vera-fsg-ui-pf-'));
const profilePath = path.join(runtimeRoot, 'user-data');
const downloadsPath = path.join(runtimeRoot, 'downloads');
const launchPath = path.join(runtimeRoot, 'electron-app');
const entryPath = path.join(__dirname, 'fsg-electron-entry.cjs');

const report = { label, widths, checks: [], axe: [], focusOrder: {}, rendererErrors: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(name, condition, detail) {
  report.checks.push({ name, pass: Boolean(condition), detail: condition ? undefined : detail });
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ── Electron + CDP plumbing (as in scripts/test-fsg-ui.cjs) ─────────────────
let child; let socket; let nextId = 0; const pending = new Map(); let stdout = ''; let stderr = '';

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
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function launch() {
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: 'production', FSG_TEST_PROJECT_ROOT: projectRoot, FSG_TEST_USER_DATA: profilePath, FSG_TEST_DOWNLOADS: downloadsPath };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, ['--disable-gpu', `--remote-debugging-port=${port}`, launchPath], {
    cwd: projectRoot, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'],
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
      if (msg.method === 'Runtime.exceptionThrown') report.rendererErrors.push(String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text).slice(0, 600));
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        report.rendererErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 600));
      }
    });
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await waitFor('Boolean(globalThis.electronAPI)', 20000);
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await evaluate(expression); if (last) return last; } catch (e) { last = e.message; }
    await sleep(250);
  }
  return false;
}
async function closeApp() {
  try { socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} })); } catch { /* closed */ }
  const end = Date.now() + 15000;
  while (child && child.exitCode === null && Date.now() < end) await sleep(100);
  if (child && child.exitCode === null) child.kill();
}

// ── Page helpers ────────────────────────────────────────────────────────────
async function setViewport(width, height) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
}
async function shot(name) {
  await sleep(450);
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
}
async function openAsUser(email, password, engagement, hash) {
  await evaluate(`(localStorage.setItem('auditpro_current_engagement', ${JSON.stringify(JSON.stringify(engagement))}), location.hash = '#/auth', location.reload(), true)`);
  await sleep(2000);
  await waitFor(`Boolean(document.querySelector('#login-email'))`, 30000);
  await evaluate(`(() => {
    const set = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
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
// Leaves and re-enters the route: remounts the page without a reload (a reload signs the user out).
async function remountPage() {
  await evaluate(`(location.hash = '#/', true)`);
  await sleep(700);
  await evaluate(`(location.hash = '#/permanent-file', true)`);
  await sleep(900);
}
async function setSidebarCollapsed(collapsed) {
  const isCollapsed = await evaluate(`document.querySelector('aside').getBoundingClientRect().width < 100`);
  if (isCollapsed !== collapsed) {
    await evaluate(`(() => { const buttons = document.querySelectorAll('aside button'); buttons[buttons.length - 1].click(); return true; })()`);
    await sleep(500);
  }
}
const text = (value) => JSON.stringify(value);
// Clicks the first visible button, link or tab whose text matches the pattern.
const clickByText = (pattern, root = 'document') => evaluate(`(() => {
  const re = new RegExp(${text(pattern)}, 'i');
  const el = [...${root}.querySelectorAll('button, [role="button"], a, summary')]
    .find((x) => re.test((x.getAttribute('aria-label') || '') + ' ' + x.textContent.replace(/\\s+/g, ' ')) && x.offsetParent !== null);
  if (el) { el.click(); return true; } return false;
})()`);
const dialogOpen = () => evaluate(`Boolean(document.querySelector('[role="dialog"]'))`);
async function pressKey(key, code, keyCode) {
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  await sleep(120);
}
const describeFocus = () => evaluate(`(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return 'body';
  const name = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.placeholder || el.name || el.id || '';
  return el.tagName.toLowerCase() + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') + ': ' + name.replace(/\\s+/g, ' ').trim().slice(0, 50)
    + (el.closest('[role="dialog"]') ? ' (dialog)' : '');
})()`);
async function tabStops(count) {
  const stops = [];
  for (let i = 0; i < count; i += 1) { await pressKey('Tab', 'Tab', 9); stops.push(await describeFocus()); }
  return stops;
}

async function runAxe(name) {
  if (!axePath) return;
  await evaluate(`(() => { if (!window.axe) { (0, eval)(${text(fs.readFileSync(axePath, 'utf8'))}); } return true; })()`);
  const result = await evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }).then((r) => ({
    violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })),
    passes: r.passes.length, incomplete: r.incomplete.length }))`);
  report.axe.push({ screen: name, ...result });
  console.log(`axe ${name}: ${result.violations.length} violation rule(s), ${result.violations.reduce((n, v) => n + v.nodes, 0)} node(s); ${result.incomplete} need review`);
}

// ── Seed data (synthetic) ───────────────────────────────────────────────────
const pf = (payload) => evaluate(`globalThis.electronAPI.permanentFile.request(${text(payload)})`);
async function seedPopulatedClient(clientId, engagementId) {
  const requests = [
    { action: 'saveClientMaster', clientId, master: { name: 'Synthetic Manufacturing Private Limited', industry: 'Manufacturing', constitution: 'company',
      cin: 'U12345KA2020PTC000001', pan: 'AAACS1234A', address: '1 Example Road, Bengaluru', state: 'Karnataka', pin: '560001' } },
    { action: 'saveEntity', clientId, details: { tradeName: 'Synthetic Mfg', incorporationDate: '2020-04-01', incorporationPlace: '', tan: 'BLRS12345A',
      branches: ['Plot 4, Example Industrial Area, Pune', 'Unit 2, Sample Park, Chennai'], groupDetails: 'Synthetic Group', auditPartner: 'Synthetic Partner', keyPersonnel: '' } },
  ];
  const people = [
    ['director', 'Asha Synthetic', 'Managing director, DIN pending', '2020-04-01', null],
    ['director', 'Ravi Example', 'Non-executive director', '2020-04-01', '2024-03-31'],
    ['shareholder', 'Synthetic Holdings LLP', '60% of paid-up capital', '2020-04-01', null],
    ['kmp', 'Meera Sample', 'Chief financial officer', '2021-07-15', null],
    ['related_party', 'Example Traders Pvt Ltd', 'Common directorship', '2022-01-01', null],
  ];
  for (const request of requests) {
    const result = await pf(request);
    if (result.error) throw new Error(`${request.action}: ${result.error}`);
  }
  for (const [kind, name, details, effectiveFrom, effectiveUntil] of people) {
    const subjectId = await evaluate('crypto.randomUUID()');
    const result = await pf({ action: 'addHistory', clientId, entry: { kind, subjectId, effectiveFrom, effectiveUntil, attributes: { name, details } } });
    if (result.error) throw new Error(`addHistory: ${result.error}`);
  }
  const files = [
    ['Certificate of Incorporation', 'PF-01', 'coi.pdf', 'verified'],
    ['Memorandum of Association with a deliberately long document name to test wrapping in narrow columns', 'PF-01', 'moa.pdf', 'unverified'],
    ['PAN card', 'PF-02', 'pan.png', 'rejected'],
  ];
  for (const [name, category, fileName, status] of files) {
    const up = await evaluate(`globalThis.electronAPI.permanentFile.request({
      action: 'upload', clientId: ${text(clientId)}, category: ${text(category)}, name: ${text(name)}, fileName: ${text(fileName)},
      bytes: new Uint8Array([37, 80, 68, 70, 45]).buffer, engagementIds: [${text(engagementId)}] })`);
    if (up.error) throw new Error(`upload: ${up.error}`);
    const meta = await pf({ action: 'updateMetadata', clientId, versionId: up.data.versionId, verificationStatus: status,
      reviewedDate: status === 'verified' ? '2024-04-10' : null, expiryDate: null, documentYear: '2024', keywords: 'synthetic', engagementIds: [engagementId] });
    if (meta.error) throw new Error(`updateMetadata: ${meta.error}`);
  }
}

// ── Flow ────────────────────────────────────────────────────────────────────
async function capturePage(prefix, width, tall) {
  await setViewport(width, tall ? (width >= 1024 ? 1100 : 2400) : 900);
  await setSidebarCollapsed(width <= 768);
  await shot(`${prefix}-${width}`);
}

async function captureModals(prefix, width) {
  await setViewport(width, width >= 1024 ? 900 : 844);
  await setSidebarCollapsed(width <= 768);
  const flows = [
    ['modal-ownership', /add record|add ownership/, async () => {}],
    ['modal-document', /add document/, async () => {}],
    ['modal-report', /year-end comparison/, async () => {}],
  ];
  for (const [name, pattern] of flows) {
    const opened = await clickByText(pattern.source);
    await sleep(400);
    check(`${prefix}: ${name} opens at ${width}px`, opened && await dialogOpen());
    await shot(`${prefix}-${name}-${width}`);
    if (width === widths[0]) await runAxe(`${prefix} ${name}`);
    await pressKey('Escape', 'Escape', 27);
    await sleep(300);
    if (opened) check(`${prefix}: Esc closes ${name} (empty form) at ${width}px`, !(await dialogOpen()));
    else await remountPage();
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(profilePath); fs.mkdirSync(downloadsPath); fs.mkdirSync(launchPath);
  fs.writeFileSync(path.join(launchPath, 'package.json'), JSON.stringify({ name: 'icai-vera-pf-ui-capture', version: '1.0.0', main: entryPath }));
  await launch();
  await sleep(1500);

  const password = 'Synthetic-PF-Password-Not-For-Use';
  const email = 'pf-admin@example.invalid';
  const signup = await evaluate(`globalThis.electronAPI.sqliteAuth(${text({ action: 'signup', email, password, fullName: 'Synthetic PF Admin' })})`);
  check('synthetic admin signed up', !signup.error && signup.data.role === 'admin', signup);
  const insert = async (table, data) => {
    const r = await evaluate(`globalThis.electronAPI.sqliteQuery(${text({ table, action: 'insert', data })})`);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data[0];
  };
  const emptyClient = await insert('clients', { name: 'Synthetic Traders Private Limited', constitution: 'company' });
  const fullClient = await insert('clients', { name: 'Synthetic Manufacturing Private Limited', constitution: 'company' });
  const engagementOf = (client) => insert('engagements', { name: 'Statutory audit FY 2024-25', client_id: client.id, client_name: client.name,
    financial_year: '2024-25', engagement_type: 'statutory', created_by: signup.data.user_id });
  const emptyEngagement = await engagementOf(emptyClient);
  const fullEngagement = await engagementOf(fullClient);

  // Populated client first: seeding needs a signed-in session.
  check('signed in (populated client)', await openAsUser(email, password, fullEngagement, '#/permanent-file'));
  await waitFor(`document.body.innerText.includes('Documents')`, 20000);
  await seedPopulatedClient(fullClient.id, fullEngagement.id);
  await remountPage();
  check('populated page renders', await waitFor(`document.body.innerText.includes('Asha Synthetic')`, 15000), (await evaluate('document.body.innerText')).slice(0, 400));

  for (const width of widths) await capturePage('page-populated', width, true);
  await setViewport(1440, 1100);
  await setSidebarCollapsed(false);
  await runAxe('page-populated');

  // Keyboard order of the populated page, and of the document row actions.
  await remountPage();
  await evaluate(`(document.activeElement && document.activeElement.blur(), document.body.focus(), true)`);
  report.focusOrder.page = await tabStops(40);

  for (const width of modalWidths) {
    await remountPage();
    await captureModals('populated', width);
  }

  // Focus return and dirty-form behaviour of the ownership modal.
  await setViewport(1440, 900); await setSidebarCollapsed(false); await remountPage();
  if (await clickByText('add record|add ownership')) {
    await sleep(400);
    report.focusOrder.ownershipModal = await tabStops(12);
    await evaluate(`(() => { const el = document.querySelector('[role="dialog"] input:not([type="date"])'); el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Typed text');
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await pressKey('Escape', 'Escape', 27);
    await sleep(400);
    report.dirtyEscapeClosedDialog = !(await dialogOpen());
    console.log(`info  Esc on a dirty ownership form closed the dialog: ${report.dirtyEscapeClosedDialog}`);
    if (await dialogOpen()) {
      await clickByText('discard', 'document'); await sleep(300);
    }
    report.focusAfterClose = await describeFocus();
    console.log(`info  focus after closing the ownership modal: ${report.focusAfterClose}`);
  }

  // Client details edit mode and document metadata modal.
  await remountPage();
  for (const width of widths) {
    await setViewport(width, width >= 1024 ? 1100 : 2400);
    await setSidebarCollapsed(width <= 768);
    if (await clickByText('edit client')) { await shot(`client-edit-${width}`); if (width === widths[0]) await runAxe('client-edit'); }
    await remountPage();
  }
  await setViewport(1440, 900); await setSidebarCollapsed(false);
  if (await clickByText('^.{0,4}edit')) { await sleep(400); await shot('modal-metadata-1440'); await pressKey('Escape', 'Escape', 27); }

  // Empty client.
  check('signed in (empty client)', await openAsUser(email, password, emptyEngagement, '#/permanent-file'));
  await waitFor(`document.body.innerText.includes('Documents')`, 20000);
  for (const width of widths) await capturePage('page-empty', width, false);

  report.rendererErrorCount = report.rendererErrors.length;
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await closeApp();
  const failed = report.checks.filter((c) => !c.pass).length;
  console.log(`\n${report.checks.length - failed}/${report.checks.length} checks passed; ${report.rendererErrors.length} renderer error(s); output: ${outDir}`);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  try { fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  try { await closeApp(); } catch { /* best effort */ }
  process.exit(1);
});
