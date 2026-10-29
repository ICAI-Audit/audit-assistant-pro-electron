const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icai-vera-t003-'));
const profilePath = path.join(runtimeRoot, 'user-data');
const downloadsPath = path.join(runtimeRoot, 'downloads');
const launchPath = path.join(runtimeRoot, 'electron-app');
const entryPath = path.join(__dirname, 't003-electron-entry.cjs');
const databasePath = path.join(profilePath, 'audit_assistant.db');
let child;
let socket;
let nextCdpId = 0;
const pendingCdp = new Map();
let cdpReady;
let stdout = '';
let stderr = '';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForChildExit(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => reject(new Error('Electron did not exit after CDP Browser.close')), timeoutMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`CDP endpoint returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function waitForPage(port, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const targets = await requestJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Electron renderer did not expose a CDP page. stdout=${stdout}\nstderr=${stderr}`);
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Electron CDP')), 10000);

    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      socket = ws;
      ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pendingCdp.has(message.id)) {
          const { resolve: resolveCall, reject: rejectCall } = pendingCdp.get(message.id);
          pendingCdp.delete(message.id);
          if (message.error) {
            rejectCall(new Error(message.error.message));
          } else {
            resolveCall(message.result);
          }
        }
      });
      ws.addEventListener('close', () => {
        for (const { reject: rejectCall } of pendingCdp.values()) {
          rejectCall(new Error('Electron CDP connection closed'));
        }
        pendingCdp.clear();
      });
      resolve();
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Electron CDP connection failed'));
    }, { once: true });
  });
}

function cdp(method, params = {}) {
  const id = ++nextCdpId;
  return new Promise((resolve, reject) => {
    pendingCdp.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', {
    expression: `(async () => (${expression}))()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitForApi() {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    try {
      if (await evaluate('Boolean(globalThis.electronAPI)')) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`electronAPI did not become available. stdout=${stdout}\nstderr=${stderr}`);
}

async function query(payload) {
  return evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify(payload)})`);
}

async function auth(action, email, password, fullName) {
  return evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action, email, password, fullName })})`);
}

async function login(email, password) {
  const result = await auth('login', email, password);
  assert.equal(result.error, null, `login failed for ${email}: ${result.error?.message}`);
  return result.data;
}

async function insert(table, row) {
  const result = await query({ table, action: 'insert', data: row });
  assert.equal(result.error, null, `insert ${table} failed: ${result.error?.message}`);
  return result.data[0];
}

async function assertDenied(t, label, policy, evidence, operation) {
  await t.test(label, async () => {
    const result = await operation();
    const denied = Boolean(result?.error);
    console.log(`[T003 ${denied ? 'DENIED' : 'ALLOWED'}] ${label}; expected=${policy}; evidence=${evidence}; result=${JSON.stringify(result)}`);
    assert.equal(denied, true, `${label} should have been rejected by the active main-process handler`);
  });
}

async function testHarness(t) {
  const port = await getFreePort();
  fs.mkdirSync(profilePath);
  fs.mkdirSync(downloadsPath);
  fs.mkdirSync(launchPath);
  fs.writeFileSync(path.join(launchPath, 'package.json'), JSON.stringify({
    name: 'icai-vera-t003-test-harness',
    version: '1.0.0',
    main: entryPath,
  }));

  child = spawn(electronPath, [
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    launchPath,
  ], {
    cwd: projectRoot,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      T003_PROJECT_ROOT: projectRoot,
      T003_USER_DATA: profilePath,
      T003_DOWNLOADS: downloadsPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const isolationMarker = `T003_PROFILE_ISOLATED ${JSON.stringify({
    userData: profilePath,
    downloads: downloadsPath,
    databaseExisted: false,
  })}`;
  const markerDeadline = Date.now() + 20000;
  while (!stdout.includes(isolationMarker) && Date.now() < markerDeadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(stdout.includes(isolationMarker), `Electron did not verify the isolated profile before loading main.cjs. stdout=${stdout}\nstderr=${stderr}`);
  assert.equal(fs.existsSync(databasePath), false, 'Production main opened the database before the isolation marker.');

  const page = await waitForPage(port);
  await connectCdp(page.webSocketDebuggerUrl);
  await cdp('Runtime.enable');
  await waitForApi();
  assert.equal(path.resolve(profilePath), path.resolve(JSON.parse(stdout.match(/T003_PROFILE_ISOLATED (.+)/)[1]).userData));

  await assertDenied(
    t,
    'anonymous database read before signup is denied',
    'deny unauthenticated access',
    'sqlite/access-control.ts AccessControl.canAccess returns Not authenticated for null users',
    async () => query({ table: 'engagements', action: 'select' }),
  );

  const adminEmail = 't003-admin@example.invalid';
  const managerEmail = 't003-manager@example.invalid';
  const staffEmail = 't003-staff@example.invalid';
  const password = 'Synthetic-T003-Password-Not-For-Use-Anywhere';

  const adminSignup = await auth('signup', adminEmail, password, 'Synthetic T003 Admin');
  assert.equal(adminSignup.error, null, `synthetic admin signup failed: ${adminSignup.error?.message}`);
  const admin = adminSignup.data;
  assert.equal(admin.role, 'admin', 'first synthetic account should receive the production first-user role');

  const managerSignup = await auth('signup', managerEmail, password, 'Synthetic T003 Manager');
  assert.equal(managerSignup.error, null, `synthetic manager signup failed: ${managerSignup.error?.message}`);
  const staffSignup = await auth('signup', staffEmail, password, 'Synthetic T003 Staff');
  assert.equal(staffSignup.error, null, `synthetic staff signup failed: ${staffSignup.error?.message}`);
  const manager = managerSignup.data;
  const staff = staffSignup.data;

  const managerRoleChange = await query({
    table: 'user_roles',
    action: 'update',
    filters: [{ column: 'user_id', value: manager.user_id }],
    data: { role: 'manager' },
  });
  assert.equal(managerRoleChange.error, null, 'failed to assign synthetic manager role');

  const clientA = await insert('clients', { id: 't003-client-a', name: 'Synthetic Client A' });
  const clientB = await insert('clients', { id: 't003-client-b', name: 'Synthetic Client B' });
  const engagementA = await insert('engagements', {
    id: 't003-engagement-a',
    name: 'Synthetic Engagement A',
    client_id: clientA.id,
    client_name: clientA.name,
    financial_year: '2025-26',
    created_by: admin.user_id,
  });
  const engagementB = await insert('engagements', {
    id: 't003-engagement-b',
    name: 'Synthetic Engagement B',
    client_id: clientB.id,
    client_name: clientB.name,
    financial_year: '2025-26',
    created_by: admin.user_id,
  });

  for (const [engagement, user] of [[engagementA, staff], [engagementA, manager]]) {
    await insert('engagement_assignments', {
      id: `t003-assignment-${engagement.id}-${user.user_id}`,
      engagement_id: engagement.id,
      user_id: user.user_id,
      role: user === staff ? 'staff' : 'manager',
    });
  }

  const procedureA = await insert('audit_procedures', {
    id: 't003-procedure-a',
    engagement_id: engagementA.id,
    procedure_name: 'Synthetic procedure A',
    area: 'Synthetic',
    created_by: admin.user_id,
  });
  const procedureB = await insert('audit_procedures', {
    id: 't003-procedure-b',
    engagement_id: engagementB.id,
    procedure_name: 'Synthetic procedure B',
    area: 'Synthetic',
    created_by: admin.user_id,
  });
  const lockedEvidence = await insert('evidence_files', {
    id: 't003-evidence-locked',
    engagement_id: engagementA.id,
    name: 'Synthetic locked evidence',
    file_path: 'engagement-a/locked.bin',
    file_type: 'application/octet-stream',
    file_size: 4,
    uploaded_by: admin.user_id,
    locked: 1,
  });
  const approvedEvidence = await insert('evidence_files', {
    id: 't003-evidence-approved',
    engagement_id: engagementA.id,
    name: 'Synthetic approved evidence',
    file_path: 'engagement-a/approved.bin',
    file_type: 'application/octet-stream',
    file_size: 4,
    uploaded_by: admin.user_id,
    approval_stage: 'approved',
    approved_by: admin.user_id,
    approved_at: '2026-10-29T00:00:00.000Z',
  });
  const foreignEvidence = await insert('evidence_files', {
    id: 't003-evidence-b',
    engagement_id: engagementB.id,
    name: 'Synthetic engagement B evidence',
    file_path: 'engagement-b/private.bin',
    file_type: 'application/octet-stream',
    file_size: 4,
    uploaded_by: admin.user_id,
  });
  const crossLink = await insert('evidence_links', {
    id: 't003-cross-link',
    procedure_id: procedureA.id,
    evidence_id: foreignEvidence.id,
    linked_by: admin.user_id,
  });

  const fileSave = await evaluate(`globalThis.electronAPI.saveFile({
    bucket: 'evidence',
    path: 'engagement-b/private.bin',
    buffer: Uint8Array.from([84, 51, 45, 66])
  })`);
  assert.equal(fileSave, 'engagement-b/private.bin', 'failed to create synthetic evidence bytes');

  await t.test('manager role allows helper-authorized core update', async () => {
    await login(managerEmail, password);
    const result = await query({
      table: 'clients',
      action: 'update',
      filters: [{ column: 'id', value: clientA.id }],
      data: { name: 'Synthetic Client A Updated by Manager' },
    });
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] manager client update; helper=allow; rows=${result.data?.length}; error=${result.error?.message || 'none'}`);
    assert.equal(result.error, null);
    assert.equal(result.data[0].name, 'Synthetic Client A Updated by Manager');
  });

  await t.test('admin role has no matching helper role definition', async () => {
    await login(adminEmail, password);
    const result = await query({
      table: 'clients',
      action: 'update',
      filters: [{ column: 'id', value: clientB.id }],
      data: { name: 'Synthetic Client B Updated by Admin' },
    });
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] admin client update; helper=undetermined because Role omits admin; error=${result.error?.message || 'none'}`);
    assert.equal(result.error, null);
  });

  await t.test('staff core update policy is rejected', async () => {
    await login(staffEmail, password);
    const result = await query({
      table: 'clients',
      action: 'update',
      filters: [{ column: 'id', value: clientA.id }],
      data: { name: 'Synthetic Client A Updated by Staff' },
    });
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] staff client update; helper=deny (manager+ required); error=${result.error?.message || 'none'}`);
    assert.ok(result.error, 'staff update succeeded although AccessControl requires manager+ for clients');
  });

  await t.test('anonymous read behavior after logout', async () => {
    await login(staffEmail, password);
    await evaluate('globalThis.electronAPI.sqliteAuth({ action: "logout" })');
    const result = await query({ table: 'engagements', action: 'select' });
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] database read after logout; expected=deny; rows=${result.data?.length}; error=${result.error?.message || 'none'}`);
    assert.ok(result.error, 'database read succeeded after logout');
  });

  await t.test('staff listing is filtered to assigned engagement', async () => {
    await login(staffEmail, password);
    const result = await query({ table: 'audit_procedures', action: 'select' });
    const ids = result.data?.map((row) => row.id) || [];
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] staff procedure list; expected only ${procedureA.id}; actual=${JSON.stringify(ids)}`);
    assert.equal(result.error, null);
    assert.deepEqual(ids, [procedureA.id]);
  });

  await assertDenied(
    t,
    'staff cannot update a forged cross-engagement record id',
    'deny cross-engagement update',
    'sqlite/access-control.ts checkEngagementBasedAccess resolves the record engagement and requires assignment',
    async () => query({
      table: 'audit_procedures',
      action: 'update',
      filters: [{ column: 'id', value: procedureB.id }],
      data: { description: 'Forged cross-engagement update' },
    }),
  );

  await t.test('staff cannot change protected role fields', async () => {
    await login(staffEmail, password);
    const roleRow = (await query({
      table: 'user_roles',
      action: 'select',
      filters: [{ column: 'user_id', value: staff.user_id }],
    })).data[0];
    let result;
    try {
      result = await query({
        table: 'user_roles',
        action: 'update',
        filters: [{ column: 'id', value: roleRow.id }],
        data: { role: 'partner' },
      });
      console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] staff role escalation; helper=deny (user_roles managed by triggers only); returned=${JSON.stringify(result.data)}`);
      assert.ok(result.error, 'staff changed its protected role record');
    } finally {
      await login(adminEmail, password);
      const restoredRole = await query({
        table: 'user_roles',
        action: 'update',
        filters: [{ column: 'id', value: roleRow.id }],
        data: { role: 'staff' },
      });
      assert.equal(restoredRole.error, null, 'failed to restore the synthetic staff role after the probe');
      assert.equal(restoredRole.data[0].role, 'staff');
      await login(staffEmail, password);
    }
  });

  await t.test('evidence link cannot cross engagement boundaries', async () => {
    await login(staffEmail, password);
    const result = await query({
      table: 'evidence_links',
      action: 'select',
      filters: [{ column: 'id', value: crossLink.id }],
    });
    const linkedEvidenceIds = result.data?.map((row) => row.evidence_id) || [];
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] indirect evidence link; procedureEngagement=${engagementA.id}; evidenceEngagement=${engagementB.id}; evidenceIds=${JSON.stringify(linkedEvidenceIds)}`);
    assert.ok(result.error || !linkedEvidenceIds.includes(foreignEvidence.id), 'staff followed a link from an assigned procedure to another engagement’s evidence');
  });

  await t.test('file path lookup enforces engagement ownership', async () => {
    await evaluate('globalThis.electronAPI.sqliteAuth({ action: "logout" })');
    const result = await evaluate(`(async () => {
      try {
        return { allowed: true, path: await globalThis.electronAPI.getFilePath('evidence', 'engagement-b/private.bin') };
      } catch (error) {
        return { allowed: false, error: error.message };
      }
    })()`);
    console.log(`[T003 ${result.allowed ? 'ALLOWED' : 'DENIED'}] anonymous file path lookup; expected=deny; result=${JSON.stringify(result)}`);
    assert.equal(result.allowed, false, 'anonymous renderer retrieved another engagement’s evidence path');
  });

  await t.test('file save enforces authentication and engagement ownership', async () => {
    const result = await evaluate(`(async () => {
      try {
        const path = await globalThis.electronAPI.saveFile({
          bucket: 'evidence',
          path: 'engagement-b/unauthorized.bin',
          buffer: Uint8Array.from([84, 51, 45, 85])
        });
        return { allowed: true, path };
      } catch (error) {
        return { allowed: false, error: error.message };
      }
    })()`);
    console.log(`[T003 ${result.allowed ? 'ALLOWED' : 'DENIED'}] anonymous file save; expected=deny; result=${JSON.stringify(result)}`);
    assert.equal(result.allowed, false, 'anonymous renderer wrote evidence into another engagement’s folder');
  });

  await t.test('file download enforces engagement ownership', async () => {
    await evaluate('globalThis.electronAPI.sqliteAuth({ action: "logout" })');
    const result = await evaluate(`(async () => {
      try {
        const file = await globalThis.electronAPI.downloadFile('evidence', 'engagement-b/private.bin');
        return { allowed: true, bytes: Array.from(file.buffer) };
      } catch (error) {
        return { allowed: false, error: error.message };
      }
    })()`);
    console.log(`[T003 ${result.allowed ? 'ALLOWED' : 'DENIED'}] anonymous file download; expected=deny and engagement-bound; result=${JSON.stringify(result)}`);
    assert.equal(result.allowed, false, 'anonymous renderer downloaded evidence from another engagement');
  });

  await t.test('file delete enforces authentication and engagement ownership', async () => {
    const result = await evaluate(`(async () => {
      try {
        await globalThis.electronAPI.deleteFile('evidence', 'engagement-b/private.bin');
        return { allowed: true };
      } catch (error) {
        return { allowed: false, error: error.message };
      }
    })()`);
    console.log(`[T003 ${result.allowed ? 'ALLOWED' : 'DENIED'}] anonymous file delete; expected=deny; result=${JSON.stringify(result)}`);
    assert.equal(result.allowed, false, 'anonymous renderer deleted another engagement’s evidence');
  });

  await t.test('writes to locked or approved evidence require a defined lock policy', async () => {
    await login(managerEmail, password);
    const lockedResult = await query({
      table: 'evidence_files',
      action: 'update',
      filters: [{ column: 'id', value: lockedEvidence.id }],
      data: { name: 'Changed locked evidence' },
    });
    const approvedResult = await query({
      table: 'evidence_files',
      action: 'update',
      filters: [{ column: 'id', value: approvedEvidence.id }],
      data: { name: 'Changed approved evidence' },
    });
    console.log(`[T003 OBSERVED] evidence lock writes; helper has no locked/approval-stage check; locked=${lockedResult.error ? 'denied' : 'allowed'}; approved=${approvedResult.error ? 'denied' : 'allowed'}`);
    assert.equal(lockedResult.error, null);
    assert.equal(approvedResult.error, null);
  });

  await assertDenied(
    t,
    'manager cannot delete a forged record from an unassigned engagement',
    'deny cross-engagement delete',
    'sqlite/access-control.ts checkEngagementBasedAccess resolves the record engagement before delete',
    async () => {
      await login(managerEmail, password);
      return query({
        table: 'audit_procedures',
        action: 'delete',
        filters: [{ column: 'id', value: procedureB.id }],
      });
    },
  );

  await t.test('bulk update without filters is rejected', async () => {
    await insert('audit_procedures', {
      id: 't003-procedure-bulk-a',
      engagement_id: engagementA.id,
      procedure_name: 'Synthetic bulk procedure A',
      area: 'Synthetic',
      created_by: admin.user_id,
    });
    await insert('audit_procedures', {
      id: 't003-procedure-bulk-b',
      engagement_id: engagementB.id,
      procedure_name: 'Synthetic bulk procedure B',
      area: 'Synthetic',
      created_by: admin.user_id,
    });
    await login(managerEmail, password);
    const result = await query({
      table: 'audit_procedures',
      action: 'update',
      data: { description: 'Bulk update without filter' },
    });
    const changed = (await query({
      table: 'audit_procedures',
      action: 'select',
      filters: [{ column: 'description', value: 'Bulk update without filter' }],
    })).data;
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] unfiltered update; expected=deny pending explicit bulk policy; changed=${changed.length}; error=${result.error?.message || 'none'}`);
    assert.ok(result.error, `unfiltered update changed ${changed.length} records`);
  });

  await t.test('bulk delete without filters is rejected', async () => {
    await login(managerEmail, password);
    const before = (await query({ table: 'audit_procedures', action: 'select' })).data.length;
    const result = await query({ table: 'audit_procedures', action: 'delete' });
    const after = (await query({ table: 'audit_procedures', action: 'select' })).data.length;
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] unfiltered delete; expected=deny pending explicit bulk policy; before=${before}; after=${after}; error=${result.error?.message || 'none'}`);
    assert.ok(result.error, `unfiltered delete removed ${before - after} records`);
  });

  await t.test('unauthenticated export remains inside isolated downloads directory', async () => {
    await evaluate('globalThis.electronAPI.sqliteAuth({ action: "logout" })');
    const exportedPath = await evaluate(`globalThis.electronAPI.app.exportFile({
      defaultFilename: 't003-synthetic-export',
      buffer: Uint8Array.from([84, 51, 45, 69]),
      showSaveDialog: false
    })`);
    console.log(`[T003 OBSERVED] export without session; path=${exportedPath}`);
    assert.equal(path.dirname(exportedPath), downloadsPath);
    assert.deepEqual([...fs.readFileSync(exportedPath)], [84, 51, 45, 69]);
  });

  await t.test('test profile remains isolated', async () => {
    assert.ok(stdout.includes('T003_PROFILE_ISOLATED'));
    assert.ok(path.resolve(databasePath).startsWith(path.resolve(profilePath) + path.sep));
    assert.ok(fs.existsSync(databasePath));
    const tempFiles = fs.readdirSync(profilePath);
    console.log(`[T003 ISOLATION] isolatedUserData=${profilePath}; files=${JSON.stringify(tempFiles)}; productionMainLoadedAfterPathVerification=true`);
    assert.ok(tempFiles.includes('audit_assistant.db'));
  });
}

test('T-003 production IPC authorization and locking verification', async (t) => {
  try {
    await testHarness(t);
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        await cdp('Browser.close');
      } catch (error) {
        console.error(`Electron Browser.close result: ${error.message}`);
      }
      socket.close();
    }

    if (child && child.exitCode === null) {
      try {
        await waitForChildExit();
      } catch (error) {
        console.error(`Electron process remains active; retaining synthetic profile at ${runtimeRoot}: ${error.message}`);
      }
    }

    if (!child || child.exitCode !== null) {
      try {
        fs.rmSync(runtimeRoot, { recursive: true, force: true });
      } catch (error) {
        console.error(`Unable to remove synthetic profile ${runtimeRoot}: ${error.message}`);
      }
    }
  }
});
