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
  await new Promise((resolve) => setTimeout(resolve, 1500));
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

  await login(adminEmail, password);
  const managerRoleChange = await query({
    table: 'user_roles',
    action: 'update',
    filters: [{ column: 'user_id', value: manager.user_id }],
    data: { role: 'manager' },
  });
  assert.equal(managerRoleChange.error, null, 'failed to assign synthetic manager role');

  await login(adminEmail, password);
  const clientA = await insert('clients', { id: 't003-client-a', name: 'Synthetic Client A' });
  const clientB = await insert('clients', { id: 't003-client-b', name: 'Synthetic Client B' });
  await login(adminEmail, password);
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

  await login(adminEmail, password);
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
    file_path: 't003-engagement-a/locked.bin',
    file_type: 'application/octet-stream',
    file_size: 4,
    uploaded_by: admin.user_id,
    locked: 1,
  });
  const approvedEvidence = await insert('evidence_files', {
    id: 't003-evidence-approved',
    engagement_id: engagementA.id,
    name: 'Synthetic approved evidence',
    file_path: 't003-engagement-a/approved.bin',
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
    file_path: 't003-engagement-b/private.bin',
    file_type: 'application/octet-stream',
    file_size: 4,
    uploaded_by: admin.user_id,
  });
  const crossLink = await query({
    table: 'evidence_links',
    action: 'insert',
    data: {
      id: 't003-cross-link',
      procedure_id: procedureA.id,
      evidence_id: foreignEvidence.id,
      linked_by: admin.user_id,
    },
  });

  await login(adminEmail, password);
  const fileSave = await evaluate(`globalThis.electronAPI.saveFile({
    bucket: 'evidence',
    path: 't003-engagement-b/private.bin',
    buffer: Uint8Array.from([84, 51, 45, 66])
  })`);
  assert.equal(fileSave, 't003-engagement-b/private.bin', 'failed to create synthetic evidence bytes');

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

  await t.test('admin role follows partner-level core update permissions', async () => {
    await login(adminEmail, password);
    const result = await query({
      table: 'clients',
      action: 'update',
      filters: [{ column: 'id', value: clientB.id }],
      data: { name: 'Synthetic Client B Updated by Admin' },
    });
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] admin client update; policy=admin mapped to partner permissions; error=${result.error?.message || 'none'}`);
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
      filters: [{ column: 'id', value: 't003-cross-link' }],
    });
    const linkedEvidenceIds = result.data?.map((row) => row.evidence_id) || [];
    console.log(`[T003 ${result.error ? 'DENIED' : 'ALLOWED'}] indirect evidence link; insertError=${crossLink.error?.message || 'none'}; procedureEngagement=${engagementA.id}; evidenceEngagement=${engagementB.id}; evidenceIds=${JSON.stringify(linkedEvidenceIds)}`);
    assert.ok(crossLink.error || result.error || !linkedEvidenceIds.includes(foreignEvidence.id), 'staff followed a link from an assigned procedure to another engagement’s evidence');
  });

  await t.test('file path lookup enforces engagement ownership', async () => {
    await evaluate('globalThis.electronAPI.sqliteAuth({ action: "logout" })');
    const result = await evaluate(`(async () => {
      try {
        return { allowed: true, path: await globalThis.electronAPI.getFilePath('evidence', 't003-engagement-b/private.bin') };
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
          path: 't003-engagement-b/unauthorized.bin',
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
        const file = await globalThis.electronAPI.downloadFile('evidence', 't003-engagement-b/private.bin');
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
        await globalThis.electronAPI.deleteFile('evidence', 't003-engagement-b/private.bin');
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
      engagement_id: engagementA.id,
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

  const fileCall = (expression) => evaluate(`(async () => {
    try {
      return { allowed: true, value: await ${expression} };
    } catch (error) {
      return { allowed: false, error: error.message };
    }
  })()`);
  const bytesOf = (...values) => `Uint8Array.from([${values.join(',')}])`;

  await t.test('review finding 1: evidence metadata cannot claim another engagement’s file path', async () => {
    await login(adminEmail, password);
    const orphan = await insert('evidence_files', {
      id: 't003-evidence-orphan',
      engagement_id: engagementB.id,
      name: 'Synthetic engagement B orphan',
      file_path: 't003-engagement-b/orphan.bin',
      file_type: 'application/octet-stream',
      file_size: 4,
      uploaded_by: admin.user_id,
    });
    const saved = await fileCall(`globalThis.electronAPI.saveFile({ bucket: 'evidence', path: '${orphan.file_path}', buffer: ${bytesOf(79, 82, 80, 72)} })`);
    assert.equal(saved.allowed, true, 'failed to create synthetic orphan bytes');
    const removed = await query({ table: 'evidence_files', action: 'delete', filters: [{ column: 'id', value: orphan.id }] });
    assert.equal(removed.error, null);

    await login(staffEmail, password);
    const claim = await query({
      table: 'evidence_files',
      action: 'insert',
      data: {
        id: 't003-evidence-claim',
        engagement_id: engagementA.id,
        name: 'Synthetic claim on engagement B path',
        file_path: orphan.file_path,
        file_type: 'application/octet-stream',
        file_size: 4,
        uploaded_by: staff.user_id,
      },
    });
    const download = await fileCall(`globalThis.electronAPI.downloadFile('evidence', '${orphan.file_path}')`);
    const overwrite = await fileCall(`globalThis.electronAPI.saveFile({ bucket: 'evidence', path: '${orphan.file_path}', buffer: ${bytesOf(66, 65, 68)} })`);
    console.log(`[T003 REVIEW-1] insertError=${claim.error?.message || 'none'}; downloadAllowed=${download.allowed}; overwriteAllowed=${overwrite.allowed}`);
    assert.ok(claim.error, 'own-engagement metadata was accepted for another engagement’s file path');
    assert.equal(download.allowed, false, 'staff downloaded another engagement’s file through own metadata');
    assert.equal(overwrite.allowed, false, 'staff overwrote another engagement’s file through own metadata');
  });

  await t.test('review finding 1: evidence file_path cannot be re-pointed or made non-canonical', async () => {
    await login(staffEmail, password);
    const own = await query({
      table: 'evidence_files',
      action: 'insert',
      data: {
        id: 't003-evidence-own',
        engagement_id: engagementA.id,
        name: 'Synthetic own upload',
        file_path: `${engagementA.id}/${staff.user_id}/own.bin`,
        file_type: 'application/octet-stream',
        file_size: 4,
        uploaded_by: staff.user_id,
      },
    });
    assert.equal(own.error, null, `legitimate canonical upload metadata was rejected: ${own.error?.message}`);
    const repoint = await query({
      table: 'evidence_files',
      action: 'update',
      filters: [{ column: 'id', value: 't003-evidence-own' }],
      data: { file_path: 't003-engagement-b/private.bin' },
    });
    const traversal = await query({
      table: 'evidence_files',
      action: 'insert',
      data: {
        id: 't003-evidence-traversal',
        engagement_id: engagementA.id,
        name: 'Synthetic traversal',
        file_path: `${engagementA.id}/../${engagementB.id}/private.bin`,
        file_type: 'application/octet-stream',
        file_size: 4,
        uploaded_by: staff.user_id,
      },
    });
    const duplicate = await query({
      table: 'evidence_files',
      action: 'insert',
      data: {
        id: 't003-evidence-duplicate',
        engagement_id: engagementA.id,
        name: 'Synthetic duplicate path',
        file_path: `${engagementA.id}/${staff.user_id}/own.bin`,
        file_type: 'application/octet-stream',
        file_size: 4,
        uploaded_by: staff.user_id,
      },
    });
    console.log(`[T003 REVIEW-1] repoint=${repoint.error?.message || 'ALLOWED'}; traversal=${traversal.error?.message || 'ALLOWED'}; duplicate=${duplicate.error?.message || 'ALLOWED'}`);
    assert.ok(repoint.error, 'file_path was re-pointed at another engagement');
    assert.ok(traversal.error, 'path traversal was accepted in metadata');
    assert.ok(duplicate.error, 'duplicate file_path was accepted');
  });

  await t.test('review finding 1: file operations stay bound to the canonical owner', async () => {
    await login(staffEmail, password);
    const save = await fileCall(`globalThis.electronAPI.saveFile({ bucket: 'evidence', path: '${engagementA.id}/${staff.user_id}/own.bin', buffer: ${bytesOf(79, 75)} })`);
    const download = await fileCall(`globalThis.electronAPI.downloadFile('evidence', '${engagementA.id}/${staff.user_id}/own.bin')`);
    const crossDownload = await fileCall(`globalThis.electronAPI.downloadFile('evidence', 't003-engagement-b/private.bin')`);
    const crossPath = await fileCall(`globalThis.electronAPI.getFilePath('evidence', 't003-engagement-b/private.bin')`);
    const traversal = await fileCall(`globalThis.electronAPI.downloadFile('evidence', '${engagementA.id}/../t003-engagement-b/private.bin')`);
    const staffDelete = await fileCall(`globalThis.electronAPI.deleteFile('evidence', '${engagementA.id}/${staff.user_id}/own.bin')`);
    console.log(`[T003 FILES] ownSave=${save.allowed}; ownDownload=${download.allowed}; crossDownload=${crossDownload.allowed}; crossPath=${crossPath.allowed}; traversal=${traversal.allowed}; staffByteDelete=${staffDelete.allowed}`);
    assert.equal(save.allowed, true, save.error);
    assert.equal(download.allowed, true, download.error);
    assert.equal(crossDownload.allowed, false);
    assert.equal(crossPath.allowed, false);
    assert.equal(traversal.allowed, false);
    assert.equal(staffDelete.allowed, false, 'staff removed evidence bytes without manager-level evidence deletion rights');
    await login(managerEmail, password);
    const managerDownload = await fileCall(`globalThis.electronAPI.downloadFile('evidence', 't003-engagement-b/private.bin')`);
    assert.equal(managerDownload.allowed, false, 'manager assigned only to engagement A reached engagement B bytes');
  });

  await t.test('review finding 2: child parent keys cannot move rows into an inaccessible engagement', async () => {
    await login(adminEmail, password);
    const checklist = await insert('procedure_checklist_items', {
      id: 't003-checklist-a',
      procedure_id: procedureA.id,
      text: 'Synthetic checklist item',
    });
    const link = await insert('evidence_links', {
      id: 't003-link-a',
      procedure_id: procedureA.id,
      evidence_id: approvedEvidence.id,
      linked_by: admin.user_id,
    });
    await login(staffEmail, password);
    const moveChecklist = await query({
      table: 'procedure_checklist_items',
      action: 'update',
      filters: [{ column: 'id', value: checklist.id }],
      data: { procedure_id: procedureB.id },
    });
    const moveLinkProcedure = await query({
      table: 'evidence_links',
      action: 'update',
      filters: [{ column: 'id', value: link.id }],
      data: { procedure_id: procedureB.id },
    });
    const moveLinkEvidence = await query({
      table: 'evidence_links',
      action: 'update',
      filters: [{ column: 'id', value: link.id }],
      data: { evidence_id: foreignEvidence.id },
    });
    const upsertMove = await query({
      table: 'procedure_checklist_items',
      action: 'upsert',
      onConflict: 'id',
      data: { id: checklist.id, procedure_id: procedureB.id, text: 'Moved by upsert' },
    });
    const legitimate = await query({
      table: 'procedure_checklist_items',
      action: 'update',
      filters: [{ column: 'id', value: checklist.id }],
      data: { text: 'Updated within engagement', status: 'completed' },
    });
    await login(adminEmail, password);
    const after = (await query({ table: 'procedure_checklist_items', action: 'select', filters: [{ column: 'id', value: checklist.id }] })).data[0];
    console.log(`[T003 REVIEW-2] checklistMove=${moveChecklist.error?.message || 'ALLOWED'}; linkProcedure=${moveLinkProcedure.error?.message || 'ALLOWED'}; linkEvidence=${moveLinkEvidence.error?.message || 'ALLOWED'}; upsertMove=${upsertMove.error?.message || 'ALLOWED'}; legitimate=${legitimate.error?.message || 'ok'}; finalProcedure=${after.procedure_id}`);
    assert.ok(moveChecklist.error, 'checklist item moved to another engagement’s procedure');
    assert.ok(moveLinkProcedure.error, 'evidence link moved to another engagement’s procedure');
    assert.ok(moveLinkEvidence.error, 'evidence link re-pointed at another engagement’s evidence');
    assert.ok(upsertMove.error, 'upsert moved a child row to another engagement');
    assert.equal(legitimate.error, null, `in-engagement child update was rejected: ${legitimate.error?.message}`);
    assert.equal(after.procedure_id, procedureA.id);
  });

  await t.test('review finding 3: engagement trial balance workflow is authorized for assigned staff only', async () => {
    await login(staffEmail, password);
    const headerA = await query({
      table: 'engagement_trial_balance_header',
      action: 'insert',
      data: { id: 't003-tb-header-a', engagement_id: engagementA.id, period_type: 'CY', financial_year: '2025-26', imported_by: staff.user_id },
    });
    assert.equal(headerA.error, null, `legitimate TB header insert rejected: ${headerA.error?.message}`);
    const lineInsert = await query({
      table: 'engagement_trial_balance_lines',
      action: 'insert',
      data: [{ id: 't003-tb-line-a', tb_header_id: 't003-tb-header-a', engagement_id: engagementA.id, ledger_name: 'Synthetic Cash', composite_key: 'cash|asset', closing: 100 }],
    });
    assert.equal(lineInsert.error, null, `legitimate TB line insert rejected: ${lineInsert.error?.message}`);
    const lineUpsert = await query({
      table: 'engagement_trial_balance_lines',
      action: 'upsert',
      onConflict: 'tb_header_id,composite_key',
      data: [{ tb_header_id: 't003-tb-header-a', engagement_id: engagementA.id, ledger_name: 'Synthetic Cash', composite_key: 'cash|asset', closing: 150 }],
    });
    assert.equal(lineUpsert.error, null, `legitimate TB line upsert rejected: ${lineUpsert.error?.message}`);
    assert.equal(lineUpsert.data[0].closing, 150);
    const read = await query({ table: 'engagement_trial_balance_lines', action: 'select', filters: [{ column: 'tb_header_id', value: 't003-tb-header-a' }] });
    assert.equal(read.error, null);
    assert.equal(read.data.length, 1);

    await login(adminEmail, password);
    await insert('engagement_trial_balance_header', { id: 't003-tb-header-b', engagement_id: engagementB.id, period_type: 'CY', financial_year: '2025-26' });
    await login(staffEmail, password);
    const crossRead = await query({ table: 'engagement_trial_balance_header', action: 'select' });
    const crossHeader = await query({
      table: 'engagement_trial_balance_header',
      action: 'insert',
      data: { id: 't003-tb-header-x', engagement_id: engagementB.id, period_type: 'PY', financial_year: '2025-26' },
    });
    const mismatchedLine = await query({
      table: 'engagement_trial_balance_lines',
      action: 'insert',
      data: { id: 't003-tb-line-x', tb_header_id: 't003-tb-header-b', engagement_id: engagementA.id, ledger_name: 'Synthetic', composite_key: 'x|y' },
    });
    const moveLine = await query({
      table: 'engagement_trial_balance_lines',
      action: 'update',
      filters: [{ column: 'id', value: 't003-tb-line-a' }],
      data: { tb_header_id: 't003-tb-header-b' },
    });
    console.log(`[T003 REVIEW-3] visibleHeaders=${JSON.stringify(crossRead.data?.map((row) => row.id))}; crossHeader=${crossHeader.error?.message || 'ALLOWED'}; mismatchedLine=${mismatchedLine.error?.message || 'ALLOWED'}; moveLine=${moveLine.error?.message || 'ALLOWED'}`);
    assert.deepEqual(crossRead.data.map((row) => row.id), ['t003-tb-header-a']);
    assert.ok(crossHeader.error);
    assert.ok(mismatchedLine.error, 'TB line accepted a header from another engagement');
    assert.ok(moveLine.error, 'TB line moved to another engagement’s header');

    const deleteLines = await query({ table: 'engagement_trial_balance_lines', action: 'delete', filters: [{ column: 'tb_header_id', value: 't003-tb-header-a' }] });
    assert.equal(deleteLines.error, null, `legitimate TB line replacement delete rejected: ${deleteLines.error?.message}`);
    const deleteHeader = await query({ table: 'engagement_trial_balance_header', action: 'delete', filters: [{ column: 'id', value: 't003-tb-header-a' }] });
    assert.equal(deleteHeader.error, null, `legitimate TB header delete rejected: ${deleteHeader.error?.message}`);
  });

  await t.test('review finding 4: failed staff upload can roll back only its own fresh metadata', async () => {
    await login(staffEmail, password);
    const upload = await query({
      table: 'evidence_files',
      action: 'insert',
      data: {
        id: 't003-evidence-rollback',
        engagement_id: engagementA.id,
        name: 'Synthetic failed upload',
        file_path: `${engagementA.id}/${staff.user_id}/rollback.bin`,
        file_type: 'application/octet-stream',
        file_size: 4,
        uploaded_by: staff.user_id,
      },
    });
    assert.equal(upload.error, null, upload.error?.message);
    const currentCleanup = await query({ table: 'evidence_files', action: 'delete', filters: [{ column: 'id', value: 't003-evidence-rollback' }] });
    console.log(`[T003 REVIEW-4] general staff evidence delete=${currentCleanup.error?.message || 'ALLOWED'}`);
    assert.ok(currentCleanup.error, 'staff must not gain general evidence deletion');

    const rollbackOther = await fileCall(`globalThis.electronAPI.rollbackEvidenceUpload('${approvedEvidence.id}')`);
    const rollbackForeign = await fileCall(`globalThis.electronAPI.rollbackEvidenceUpload('${foreignEvidence.id}')`);
    const rollback = await fileCall(`globalThis.electronAPI.rollbackEvidenceUpload('t003-evidence-rollback')`);
    const remaining = (await query({ table: 'evidence_files', action: 'select', filters: [{ column: 'id', value: 't003-evidence-rollback' }] })).data;
    console.log(`[T003 REVIEW-4] rollbackOther=${rollbackOther.allowed}; rollbackForeign=${rollbackForeign.allowed}; rollbackOwn=${rollback.allowed}; remaining=${remaining?.length}`);
    assert.equal(rollbackOther.allowed, false, 'rollback removed evidence uploaded by another user');
    assert.equal(rollbackForeign.allowed, false, 'rollback removed evidence in another engagement');
    assert.equal(rollback.allowed, true, rollback.error);
    assert.equal(remaining.length, 0);

    await login(adminEmail, password);
    await query({ table: 'evidence_links', action: 'insert', data: { id: 't003-link-own', procedure_id: procedureA.id, evidence_id: 't003-evidence-own', linked_by: admin.user_id } });
    await login(staffEmail, password);
    const linkedRollback = await fileCall(`globalThis.electronAPI.rollbackEvidenceUpload('t003-evidence-own')`);
    console.log(`[T003 REVIEW-4] rollbackOwnLinked=${linkedRollback.allowed}`);
    assert.equal(linkedRollback.allowed, false, 'rollback removed evidence that is already linked to a procedure');
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
        child.kill('SIGKILL');
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
