// PDF Tools end-to-end check in the real application.
//
//   npm run test:pdf-tools-ui     (builds the renderer, then runs this file with Node)
//
// Launches the production main process (electron/main.cjs) on a throw-away profile through
// scripts/pdf-tools-electron-entry.cjs and drives the real renderer over the Chrome DevTools
// Protocol. Everything is synthetic: one user, two clients and engagements, one audit programme,
// and PDFs and images generated here (pdf-lib; the password-protected PDF with @cantoo/pdf-lib).
//
//   PDF_TOOLS_TEST_APP=<path to win-unpacked\ICAI-VERA.exe> node scripts/test-pdf-tools-ui.cjs
// drives a packaged, unpacked build instead, on the same throw-away profile (--user-data-dir;
// the run stops unless the app reports opening its database there). The download check is then
// skipped: without the entry script a download opens Electron's own Save As dialog.
//
// Covers, first launch: opening PDF Tools in an engagement; adding files from the computer
// (thumbnails, a protected PDF and its password); Merge; PDF to images; Escape during a long run
// asks first; Add to Evidence Vault (record, stored bytes, activity hash); Attach to working paper
// (a box, the same vault file); Add from Evidence Vault; the PDF Tools activity entries; the
// password appearing nowhere (database, profile files, console); engagement isolation.
// After a restart: persistence; Split, Delete pages, Compress, Page numbers and Images to PDF,
// each result read back as bytes and checked; Save to computer marking and its activity entry,
// and the download fallback; Enter and Cancel during a long run (Keep running, Stop); an
// engagement change while PDF Tools is closed; an engagement change during a vault upload.
// Throughout: the renderer's network requests and errors.
//
// Result bytes are read the way the app saves them: the browser's save and folder pickers are
// replaced in the page by stubs that keep what is written (saveToComputer.ts looks them up at
// call time for this purpose). The list's contents after an engagement change are read from the
// renderer's heap (the working-list store's frozen state), as the store is not reachable otherwise.
//
// Cannot cover: the native save and folder pickers themselves, Save as ZIP, drag and drop from the
// desktop, a second application window (the upload switch is made the way another window would
// make it: the stored engagement changes and the window regains focus), and network use by the
// main process (only the renderer and its workers are observed, from the moment the debugger
// attaches; the sign-in reloads the page, so start-up requests are seen again). A packaged build's
// main process checks its update feed at start-up; that request is not seen here.
//
// A failed check prints FAIL with its detail and saves a screenshot in the temp folder printed at
// the end (kept only on failure; for renderer errors the screen is captured when the first one
// arrives). Skipped checks are listed apart. The profile is removed and Electron is stopped in
// every case.

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const pdfLib = require('pdf-lib');
const { PDFDocument: EncryptingPDFDocument } = require('@cantoo/pdf-lib');

const { PDFDocument, StandardFonts } = pdfLib;
const PACKAGED_APP = process.env.PDF_TOOLS_TEST_APP ? path.resolve(process.env.PDF_TOOLS_TEST_APP) : null;

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icai-vera-pdf-tools-ui-'));
const profilePath = path.join(runtimeRoot, 'user-data');
const downloadsPath = path.join(runtimeRoot, 'downloads');
const launchPath = path.join(runtimeRoot, 'electron-app');
const fixturesPath = path.join(runtimeRoot, 'fixtures');
const shotsPath = path.join(runtimeRoot, 'screenshots');
const databasePath = path.join(profilePath, 'audit_assistant.db');
const entryPath = path.join(__dirname, 'pdf-tools-electron-entry.cjs');

const USER = { email: 'pdf-tools-ui@example.invalid', password: 'Synthetic-Sign-In-Not-For-Use', fullName: 'Synthetic PDF Tools Tester' };
// Unique, so a search for it can only find this run's typing.
const PDF_PASSWORD = 'Synthetic-PDF-Lock-7Kq2Zx9';
const FILES = {
  two: 'Synthetic two pages.pdf',
  three: 'Synthetic three pages.pdf',
  locked: 'Synthetic protected.pdf',
  long: 'Synthetic forty pages.pdf',
  five: 'Synthetic five pages.pdf',
  scans: 'Synthetic scans.pdf',
  wide: 'Synthetic wide.png',
  tall: 'Synthetic tall.png',
  longer: 'Synthetic twenty-four pages.pdf',
  large: 'Synthetic large scan.pdf',
};
const A4 = [595.28, 841.89];
const IMAGE_SIZES = { wide: [400, 300], tall: [300, 450] };
// Chromium stops drawing a covered window and slows its timers; the test window must not stall.
const KEEP_DRAWING_SWITCHES = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const BUILT_TOOLS = ['merge', 'split', 'delete-pages', 'compress', 'page-numbers', 'images-to-pdf', 'pdf-to-images'];
const SOON_TOOLS = ['redact', 'bookmarks', 'watermark', 'pdf-to-excel', 'pdf-to-word', 'ocr', 'word-to-pdf', 'excel-to-pdf', 'review'];
const LOCAL_URL = /^(file|devtools|blob|data):/i;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
// Wait limits. Generous on purpose: a passing run never waits them out, and a busy machine can
// make reading, unlocking or rendering a file many times slower than usual.
const UI_MS = 15000; // a dialog opens, a button becomes available, a selection shows
const WORK_MS = 120000; // files are read, unlocked or rendered; a tool runs; the app starts or saves
const startedAt = Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

// ── Checks ──────────────────────────────────────────────────────────────────
const results = [];
const failureShots = [];
function check(name, condition, detail) {
  const pass = Boolean(condition);
  results.push({ name, pass });
  const shown = pass || detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${shown}`);
  if (!pass) failureShots.push(screenshot(`FAIL-${results.length}-${name}`));
  return pass;
}
const skipped = [];
function skip(name, reason) {
  skipped.push(name);
  console.log(`skip ${name} -- ${reason}`);
}
function note(text) {
  console.log(`NOTE ${text}`);
}
let currentStep = 'start-up';
function step(label) {
  currentStep = label;
  console.log(`\n── ${label} (at ${Math.round((Date.now() - startedAt) / 1000)} s)`);
}

// ── Synthetic PDFs ──────────────────────────────────────────────────────────
async function textPdf(label, pages, size = [300, 400]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(size);
    page.drawText(`${label} p${n}`, { x: 24, y: size[1] / 2, size: 18, font });
  }
  return doc.save();
}

/** Pixels like a scanned photo: smooth colour with grain, which JPEG stores far smaller than Flate. */
function photoPixels(width, height, seed) {
  let state = seed;
  const grain = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 50;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      pixels[i] = Math.max(0, Math.min(255, (x * 160) / width + 40 + grain()));
      pixels[i + 1] = Math.max(0, Math.min(255, 120 + 60 * Math.sin(y / 23) + grain()));
      pixels[i + 2] = Math.max(0, Math.min(255, (y * 180) / height + grain()));
    }
  }
  return pixels;
}

/** A PDF whose A4 pages are each one RGB image, stored as given (Flate) or raw (incompressible noise). */
async function imagePdf(images) {
  const { concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } = pdfLib;
  const doc = await PDFDocument.create();
  for (const { width, height, pixels, flate } of images) {
    const dict = { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 };
    const stream = flate ? doc.context.stream(zlib.deflateSync(pixels), { ...dict, Filter: 'FlateDecode' }) : doc.context.stream(pixels, dict);
    const page = doc.addPage(A4);
    const name = page.node.newXObject('Im', doc.context.register(stream));
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(A4[0], 0, 0, A4[1], 0, 0), drawObject(name), popGraphicsState());
  }
  return doc.save();
}

/** A truecolour PNG (written directly: no image library is needed). */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      raw[i] = Math.round((x / width) * 255);
      raw[i + 1] = Math.round((y / height) * 255);
      raw[i + 2] = 160;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function makeFixtures() {
  fs.mkdirSync(fixturesPath);
  const write = (name, bytes) => fs.writeFileSync(path.join(fixturesPath, name), bytes);
  write(FILES.two, await textPdf('Two', 2));
  write(FILES.three, await textPdf('Three', 3));
  write(FILES.five, await textPdf('Five', 5));
  // A4 pages: rendering many of them at 300 dpi takes long enough to act while the run goes on.
  write(FILES.long, await textPdf('Long', 40, A4));
  write(FILES.longer, await textPdf('Longer', 24, A4));
  write(FILES.wide, png(...IMAGE_SIZES.wide));
  write(FILES.tall, png(...IMAGE_SIZES.tall));
  write(FILES.scans, await imagePdf([1, 2].map((seed) => ({ width: 1200, height: 1700, pixels: photoPixels(1200, 1700, seed), flate: true }))));
  // About 31 MB of noise that no compression shrinks: a vault upload that takes a while.
  write(FILES.large, await imagePdf([1, 2, 3, 4].map(() => ({ width: 1600, height: 1600, pixels: crypto.randomBytes(1600 * 1600 * 3), flate: false }))));
  const encrypting = await EncryptingPDFDocument.load(await textPdf('Locked', 3), { updateMetadata: false });
  encrypting.encrypt({ userPassword: PDF_PASSWORD, algorithm: 'AES-128' });
  const locked = Buffer.from(await encrypting.save());
  if (!locked.includes('/Encrypt')) throw new Error('The protected fixture is not encrypted.');
  fs.writeFileSync(path.join(fixturesPath, FILES.locked), locked);
}

// ── Database read outside the app (Electron as Node: better-sqlite3 is built for Electron) ──
function runInElectronNode(code, args) {
  const result = spawnSync(electronPath, ['-e', code, ...args], { cwd: projectRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Electron-as-Node script failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

/** Every table, every value: where the text appears (read-only connection). */
function findInDatabase(text) {
  return JSON.parse(
    runInElectronNode(
      `
      const path = require('path');
      const Database = require(path.join(process.argv[1], 'node_modules', 'better-sqlite3'));
      const [, , file, needle] = process.argv;
      const db = new Database(file, { readonly: true, fileMustExist: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
      const hits = [];
      let values = 0;
      for (const table of tables) {
        for (const row of db.prepare('SELECT * FROM "' + table.replace(/"/g, '""') + '"').all()) {
          for (const [column, value] of Object.entries(row)) {
            values++;
            const found = typeof value === 'string' ? value.includes(needle) : Buffer.isBuffer(value) && value.includes(needle);
            if (found) hits.push(table + '.' + column);
          }
        }
      }
      db.close();
      console.log(JSON.stringify({ tables: tables.length, values, hits }));
      `,
      [projectRoot, databasePath, text],
    ),
  );
}

/** Files under a folder whose bytes hold the text (UTF-8 or UTF-16). */
function findInFiles(folder, text) {
  const needles = [Buffer.from(text, 'utf8'), Buffer.from(text, 'utf16le')];
  const hits = [];
  const unreadable = [];
  let files = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files++;
        try {
          const bytes = fs.readFileSync(full);
          if (needles.some((n) => bytes.includes(n))) hits.push(path.relative(folder, full));
        } catch (error) {
          unreadable.push(`${path.relative(folder, full)} (${error.code})`);
        }
      }
    }
  };
  walk(folder);
  return { files, hits, unreadable };
}

// ── Reading results ─────────────────────────────────────────────────────────
let pdfjs = null;

/** The image XObjects a page draws, with their pixel sizes. */
function imagesOn(page) {
  const { PDFDict, PDFName, PDFRawStream } = pdfLib;
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return [];
  return xobjects
    .values()
    .map((ref) => page.doc.context.lookup(ref))
    .filter((s) => s instanceof PDFRawStream && s.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    .map((s) => ({ width: s.dict.lookup(PDFName.of('Width')).asNumber(), height: s.dict.lookup(PDFName.of('Height')).asNumber() }));
}

/** Page count, Producer, and per page its size, images and text items (with positions, from pdf.js). */
async function readPdf(bytes) {
  pdfjs ??= await import(pathToFileURL(path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = content.items.filter((i) => 'str' in i && i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width }));
    const page = doc.getPage(n - 1);
    pages.push({ width: page.getWidth(), height: page.getHeight(), images: imagesOn(page), items, text: items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim() });
  }
  await pdf.destroy();
  return { pageCount: doc.getPageCount(), producer: doc.getProducer(), pages };
}

const pngSize = (bytes) => (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null);
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

// ── Electron + CDP plumbing (as in scripts/test-fsg-ui.cjs) ──────────────────
let child;
let socket;
let nextId = 0;
const pending = new Map();
let stdout = '';
let stderr = '';
const requests = []; // every request the renderer and its workers made
const consoleMessages = []; // every console message, any level (searched for the password)
const rendererErrors = [];
const networkLogs = []; // Log entries from the network source (failed loads)
const pdfToolsWindows = []; // { start, end } while PDF Tools was in use (check 13)

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}
function cdp(method, params = {}, sessionId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP connection closed (${method})`));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    // A page that stops answering fails the run instead of holding it for ever.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`No answer to ${method} within ${WORK_MS / 1000} s: the page may be hung.`));
    }, WORK_MS);
    const settle = (fn) => (value) => {
      clearTimeout(timer);
      fn(value);
    };
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}

// Check 14 is decided after the app has closed, so the screen is captured when the first error arrives.
function recordRendererError(error) {
  rendererErrors.push(error);
  if (rendererErrors.length === 1) failureShots.push(screenshot('renderer-error-first'));
}
function argText(arg) {
  if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  return [arg.description, arg.preview ? JSON.stringify(arg.preview) : ''].filter(Boolean).join(' ');
}
function onMessage(msg) {
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
    return;
  }
  const where = msg.sessionId ? 'worker' : 'page';
  const params = msg.params || {};
  switch (msg.method) {
    case 'Network.requestWillBeSent':
      requests.push({ url: params.request.url, type: params.type || '', where, at: Date.now(), step: currentStep });
      break;
    case 'Runtime.consoleAPICalled': {
      const text = params.args.map(argText).join(' ');
      consoleMessages.push({ level: params.type, text, where });
      if (params.type === 'error' || params.type === 'assert') recordRendererError({ where, step: currentStep, text: text.slice(0, 600) });
      break;
    }
    case 'Runtime.exceptionThrown': {
      const text = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'exception';
      consoleMessages.push({ level: 'exception', text, where });
      recordRendererError({ where, step: currentStep, text: text.slice(0, 600) });
      break;
    }
    case 'Log.entryAdded': {
      const { entry } = params;
      consoleMessages.push({ level: `log-${entry.level}`, text: `${entry.text} ${entry.url || ''}`, where });
      if (entry.level !== 'error') break;
      // A failed load of the known Google Fonts request is reported with the font requests (check 13).
      if (entry.source === 'network' && FONT_HOSTS.includes(hostOf(entry.url || ''))) networkLogs.push(entry);
      else recordRendererError({ where, step: currentStep, text: `${entry.source}: ${entry.text} ${entry.url || ''}`.slice(0, 600) });
      break;
    }
    case 'Target.attachedToTarget':
      // Workers (the PDF renderer runs in one): their requests and console count too.
      cdp('Network.enable', {}, params.sessionId).catch(() => undefined);
      cdp('Runtime.enable', {}, params.sessionId).catch(() => undefined);
      break;
    default:
      break;
  }
}

async function launch({ restart }) {
  const port = await freePort();
  stdout = '';
  stderr = '';
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PDF_TOOLS_TEST_PROJECT_ROOT: projectRoot,
    PDF_TOOLS_TEST_USER_DATA: profilePath,
    PDF_TOOLS_TEST_DOWNLOADS: downloadsPath,
    PDF_TOOLS_TEST_RESTART: restart ? '1' : '0',
  };
  // Electron treats ELECTRON_RUN_AS_NODE as set even when empty: remove it.
  delete env.ELECTRON_RUN_AS_NODE;
  if (PACKAGED_APP) {
    // No entry script can run before a packaged app's own main: the guard is applied here instead.
    if (!restart && fs.existsSync(databasePath)) throw new Error(`Refusing to start with an existing database: ${databasePath}`);
    if (restart && !fs.existsSync(databasePath)) throw new Error(`Restart requested, but the test's database is missing: ${databasePath}`);
    const args = ['--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, ...KEEP_DRAWING_SWITCHES];
    child = spawn(PACKAGED_APP, args, { cwd: path.dirname(PACKAGED_APP), windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    child = spawn(electronPath, ['--disable-gpu', `--remote-debugging-port=${port}`, launchPath], { cwd: projectRoot, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => (stdout = (stdout + c).slice(-200000)));
  child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-200000)));

  const end = Date.now() + WORK_MS;
  let page;
  while (!page && Date.now() < end && appRunning()) {
    try {
      page = (await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* not listening yet */
    }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error(`The application did not open a page.\nstdout: ${stdout.slice(-3000)}\nstderr: ${stderr.slice(-3000)}`);
  if (PACKAGED_APP) {
    // The packaged main process says where it opened its database: it must be the throw-away one.
    await poll(async () => /SQLite database opened at: .+?\r?\n/.test(stdout), UI_MS);
    const opened = /SQLite database opened at: (.+?)\r?\n/.exec(stdout)?.[1]?.trim();
    if (!opened || path.resolve(opened).toLowerCase() !== path.resolve(databasePath).toLowerCase()) {
      await killApp();
      throw new Error(`The packaged app did not open its database in the throw-away profile (opened: ${opened ?? 'not reported'}).`);
    }
  } else if (!stdout.includes('PDF_TOOLS_PROFILE_ISOLATED')) {
    throw new Error(`The entry script did not confirm the isolated profile.\nstdout: ${stdout.slice(-2000)}`);
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.addEventListener('open', () => {
      socket = ws;
      resolve();
    });
    ws.addEventListener('close', () => {
      for (const p of pending.values()) p.reject(new Error('CDP connection closed'));
      pending.clear();
    });
    ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
    ws.addEventListener('message', (event) => onMessage(JSON.parse(event.data)));
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Log.enable');
  await cdp('DOM.enable');
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await mustWaitFor(`location.protocol === 'file:' && Boolean(globalThis.electronAPI) && (document.getElementById('root')?.children.length || 0) > 0`, WORK_MS, 'the application page to load');
}

const appRunning = () => Boolean(child) && child.exitCode === null && child.signalCode === null;
const appExited = () => new Promise((resolve) => (appRunning() ? child.once('exit', resolve) : resolve()));

async function closeApp() {
  if (!appRunning()) return;
  // Browser.close may never answer: the connection closes as the app exits.
  try {
    socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} }));
  } catch {
    /* already closed */
  }
  const timedOut = await Promise.race([appExited().then(() => false), sleep(15000).then(() => true)]);
  if (timedOut) await killApp();
}

async function killApp() {
  if (!appRunning()) return;
  const exited = appExited();
  // The whole process tree: Electron's renderer and GPU helpers too.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
  await Promise.race([exited, sleep(10000)]);
}

async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
/** Polls until the expression is truthy; returns its value, or false after the timeout. */
async function waitFor(expression, timeoutMs = UI_MS) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch {
      /* the page may be navigating */
    }
    if (Date.now() >= end) return false;
    await sleep(100);
  }
}
/** As waitFor, for a step the test cannot go on without: throws with what it was waiting for. */
async function mustWaitFor(expression, timeoutMs, what) {
  const value = await waitFor(expression, timeoutMs);
  if (!value) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}.`);
  return value;
}
/** Polls an async check in Node (for database rows); returns its value, or false after the timeout. */
async function poll(fn, timeoutMs = WORK_MS) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= end) return false;
    await sleep(200);
  }
}
async function screenshot(name) {
  try {
    fs.mkdirSync(shotsPath, { recursive: true });
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(shotsPath, `${name.replace(/[^A-Za-z0-9 _.-]+/g, '_').slice(0, 90)}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  } catch {
    return null; // no page to capture
  }
}

// ── Page helpers ────────────────────────────────────────────────────────────
const q = (selector) => JSON.stringify(selector);
const byTestId = (id) => `[data-testid="${id}"]`;
const exists = (selector) => evaluate(`Boolean(document.querySelector(${q(selector)}))`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); if (!el) throw new Error('Nothing to click: ' + ${q(selector)}); el.click(); return true; })()`);
const KEY_CODES = { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 };
async function press(key) {
  const text = key === 'Enter' ? '\r' : undefined;
  await cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: KEY_CODES[key], ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: KEY_CODES[key] });
}
const rows = () =>
  evaluate(`[...document.querySelectorAll('[data-testid="pdf-tools-row"]')].map((r) => ({
    id: r.dataset.rowId, name: r.dataset.name, origin: r.dataset.origin,
    checked: r.querySelector('[data-testid="pdf-tools-row-check"]')?.dataset.state === 'checked',
    text: r.innerText.replace(/\\s+/g, ' ').trim() }))`);
const groups = () =>
  evaluate(`[...document.querySelectorAll('[data-testid="pdf-tools-group"]')].map((g) => ({ id: g.dataset.groupId, count: Number(g.dataset.count), text: g.innerText.replace(/\\s+/g, ' ').trim() }))`);
const INTAKE_IDLE = `!document.querySelector('[aria-label="Adding files"]')`;

/**
 * Selects exactly these rows (by row id) and no group: one click at a time, each followed by a
 * wait until the list shows it (a second click before that would undo the first).
 */
async function selectOnly(ids) {
  for (let clicks = 0; clicks < 20; clicks++) {
    const clicked = await evaluate(`(() => {
      const want = new Set(${JSON.stringify(ids)});
      for (const row of document.querySelectorAll('[data-testid="pdf-tools-row"]:not([data-member])')) {
        const box = row.querySelector('[data-testid="pdf-tools-row-check"]');
        const on = box.dataset.state === 'checked';
        if (on !== want.has(row.dataset.rowId)) {
          box.click();
          return { selector: '[data-testid="pdf-tools-row"][data-row-id="' + row.dataset.rowId + '"] [data-testid="pdf-tools-row-check"]', from: box.dataset.state };
        }
      }
      // A group's box: indeterminate becomes checked on a click, so it may take two.
      const group = [...document.querySelectorAll('[data-testid="pdf-tools-group"]')].find((g) => g.querySelector('[data-testid="pdf-tools-group-check"]').dataset.state !== 'unchecked');
      if (group) {
        const box = group.querySelector('[data-testid="pdf-tools-group-check"]');
        box.click();
        return { selector: '[data-testid="pdf-tools-group"][data-group-id="' + group.dataset.groupId + '"] [data-testid="pdf-tools-group-check"]', from: box.dataset.state };
      }
      return null;
    })()`);
    if (clicked === null) return;
    await mustWaitFor(`document.querySelector(${q(clicked.selector)})?.dataset.state !== ${q(clicked.from)}`, UI_MS, 'a selection click to show in the list');
  }
  throw new Error(`Could not select exactly ${JSON.stringify(ids)}.`);
}

async function addFromComputer(names) {
  const { root } = await cdp('DOM.getDocument', { depth: 1 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: byTestId('pdf-tools-file-input') });
  if (!nodeId) throw new Error('The PDF Tools file input is missing.');
  await cdp('DOM.setFileInputFiles', { nodeId, files: names.map((n) => path.join(fixturesPath, n)) });
}

/** Types into an input as React sees typing (the native value setter, then an input event). */
async function setInput(selector, value) {
  await mustWaitFor(`(() => { const el = document.querySelector(${q(selector)}); return Boolean(el) && !el.disabled; })()`, UI_MS, `${selector} to be editable`);
  await evaluate(`(() => {
    const el = document.querySelector(${q(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${q(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await mustWaitFor(`document.querySelector(${q(selector)})?.value === ${q(value)}`, UI_MS, `${selector} to read "${value}"`);
}

/** Clicks a radio (or checkbox) and waits until it shows as checked. */
async function choose(selector) {
  await click(selector);
  await mustWaitFor(`document.querySelector(${q(selector)})?.dataset.state === 'checked'`, UI_MS, `${selector} to be chosen`);
}

/** Ids of the list's top-level rows and groups. */
const unitIds = () => evaluate(`[...document.querySelectorAll('[data-testid="pdf-tools-row"]:not([data-member]), [data-testid="pdf-tools-group"]')].map((u) => u.dataset.rowId)`);
/** The one row or group that is not among `before`, once it is there. */
async function newUnit(before, kind) {
  const selector = kind === 'group' ? '[data-testid="pdf-tools-group"]' : '[data-testid="pdf-tools-row"]:not([data-member])';
  return waitFor(`(() => {
    const before = new Set(${JSON.stringify(before)});
    const found = [...document.querySelectorAll(${q(selector)})].filter((u) => !before.has(u.dataset.rowId));
    return found.length === 1 ? { id: found[0].dataset.rowId, groupId: found[0].dataset.groupId || null, name: found[0].dataset.name || null, count: Number(found[0].dataset.count || 1), text: found[0].innerText.replace(/\\s+/g, ' ') } : null;
  })()`, UI_MS);
}

/** Selects every file of one group and nothing else. */
async function selectGroup(groupId) {
  await selectOnly([]);
  const box = `[data-testid="pdf-tools-group"][data-group-id=${q(groupId)}] [data-testid="pdf-tools-group-check"]`;
  await click(box);
  await mustWaitFor(`document.querySelector(${q(box)})?.dataset.state === 'checked'`, UI_MS, 'the group to be selected');
}

/** Opens a tool's dialog on the current selection. */
async function openTool(tool) {
  await mustWaitFor(`document.querySelector(${q(byTestId(`pdf-tools-tool-${tool}`))})?.dataset.enabled === 'true'`, UI_MS, `the ${tool} tool to be available`);
  await click(byTestId(`pdf-tools-tool-${tool}`));
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-dialog"][data-tool="${tool}"]'))`, UI_MS, `the ${tool} dialog`);
}

// Save to computer, captured: the save and folder pickers are replaced by stubs that keep what is
// written, so the bytes the app would save can be read back. Without them a save falls back to a
// download (see the download check).
async function installSaveStubs() {
  await evaluate(`(() => {
    const saved = (window.__pdfToolsTestSaved = []);
    const fileHandle = (name) => ({
      kind: 'file',
      name,
      getFile: async () => new File([], name),
      createWritable: async () => {
        const chunks = [];
        return {
          write: async (data) => chunks.push(data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) : new Uint8Array(data)),
          close: async () => {
            const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
            chunks.reduce((at, c) => (bytes.set(c, at), at + c.length), 0);
            saved.push({ name, bytes });
          },
          abort: async () => {},
        };
      },
    });
    window.showSaveFilePicker = async (options) => fileHandle(options.suggestedName);
    window.showDirectoryPicker = async () => {
      const names = new Set();
      return {
        getFileHandle: async (name, options) => {
          if (!options?.create && !names.has(name.toLowerCase())) throw new DOMException('No such file', 'NotFoundError');
          names.add(name.toLowerCase());
          return fileHandle(name);
        },
      };
    };
    return true;
  })()`);
}
/** One captured file, read in 1 MB slices so that no protocol message is large. */
async function savedFile(index) {
  const { name, size } = await evaluate(`({ name: window.__pdfToolsTestSaved[${index}].name, size: window.__pdfToolsTestSaved[${index}].bytes.length })`);
  const parts = [];
  for (let at = 0; at < size; at += 1_000_000) {
    const base64 = await evaluate(`(() => {
      const u8 = window.__pdfToolsTestSaved[${index}].bytes.subarray(${at}, ${at + 1_000_000});
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    })()`);
    parts.push(Buffer.from(base64, 'base64'));
  }
  return { name, bytes: Buffer.concat(parts) };
}
/** Saves the selection through "Save to computer" (stubbed pickers) and returns the files written. */
async function saveSelected(count) {
  const button = byTestId('pdf-tools-dest-computer');
  await mustWaitFor(`document.querySelector(${q(button)})?.dataset.enabled === 'true'`, UI_MS, 'Save to computer to be available');
  await evaluate(`(window.__pdfToolsTestSaved.length = 0, true)`);
  await click(button);
  await mustWaitFor(`window.__pdfToolsTestSaved.length === ${count}`, WORK_MS, `${count} file(s) to be saved`);
  // Marking and the activity entries are done before the button is available again.
  await mustWaitFor(`document.querySelector(${q(button)})?.dataset.enabled === 'true'`, WORK_MS, 'the save to finish');
  const files = [];
  for (let i = 0; i < count; i++) files.push(await savedFile(i));
  return files;
}

/**
 * The working list as the store holds it, read from the renderer's heap after a garbage
 * collection: the store keeps frozen state objects, and each change of engagement starts a new
 * session. Returns every state of the newest session still in memory (the current one, and older
 * snapshots of the same session that React may still hold), with file count and bytes.
 */
async function workingListState() {
  const group = 'pdf-tools-test-heap';
  await cdp('HeapProfiler.enable');
  await cdp('HeapProfiler.collectGarbage');
  const proto = await cdp('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: group });
  const found = await cdp('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: group });
  const r = await cdp('Runtime.callFunctionOn', {
    objectId: found.objects.objectId,
    returnByValue: true,
    functionDeclaration: `function () {
      const states = this.filter((o) => o && Object.isFrozen(o) && 'contextKey' in o && typeof o.session === 'number' && Array.isArray(o.files) && Array.isArray(o.selectedIds));
      const newest = Math.max(...states.map((s) => s.session));
      return states.filter((s) => s.session === newest).map((s) => ({ contextKey: s.contextKey, session: s.session, files: s.files.length, bytes: s.files.reduce((n, f) => n + (f.size || 0), 0) }));
    }`,
  });
  await cdp('Runtime.releaseObjectGroup', { objectGroup: group });
  return r.result.value;
}

/** From the keyboard, as a keyboard user switches: Enter opens the header's engagement menu, the arrows reach the other engagement, Enter chooses it. */
async function switchEngagementFromHeader(fromClient, toClient) {
  await evaluate(`([...document.querySelectorAll('header button')].find((b) => b.innerText.includes(${q(fromClient)})).focus(), true)`);
  await press('Enter');
  await mustWaitFor(`[...document.querySelectorAll('[role="menuitem"]')].some((m) => m.innerText.includes(${q(toClient)}))`, UI_MS, `${toClient} in the engagement menu`);
  for (let i = 0; i < 10; i++) {
    const focused = await waitFor(`document.activeElement?.getAttribute('role') === 'menuitem' && document.activeElement.innerText`, UI_MS);
    if (focused && focused.includes(toClient)) break;
    await press('ArrowDown');
    await waitFor(`document.activeElement?.innerText !== ${q(focused || '')}`, UI_MS);
  }
  await press('Enter');
  return waitFor(`document.querySelector('header')?.innerText.includes(${q(toClient)}) && ![...document.querySelectorAll('[role="menu"]')].length`, UI_MS);
}

/** Opens a tool on the current selection, runs it, and returns 'closed' or the dialog's message. */
async function runTool(tool, prepare) {
  await openTool(tool);
  if (prepare) await prepare();
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-run"]')?.disabled === false`, UI_MS, `the ${tool} Run button`);
  await click(byTestId('pdf-tools-run'));
  return waitFor(`(() => {
    const d = document.querySelector('[data-testid="pdf-tools-dialog"]');
    if (!d) return 'closed';
    const message = d.querySelector('[data-testid="pdf-tools-dialog-error"], [data-testid="pdf-tools-dialog-notice"]');
    return message ? message.innerText.replace(/\\s+/g, ' ') : '';
  })()`, WORK_MS);
}

/** A Radix select, from the keyboard: open it, arrow to the option with this text, choose it. */
async function chooseOption(triggerId, text) {
  const trigger = byTestId(triggerId);
  const optionIndex = `[...document.querySelectorAll('[role="option"]')].findIndex((o) => o.innerText.trim() === ${q(text)})`;
  // The options may still be loading (a section's boxes arrive after the section is chosen): open
  // the list, and close it to look again until the option is there.
  const end = Date.now() + UI_MS;
  for (;;) {
    await mustWaitFor(`(() => { const t = document.querySelector(${q(trigger)}); return Boolean(t) && !t.disabled; })()`, UI_MS, `${triggerId} to be enabled`);
    await evaluate(`(document.querySelector(${q(trigger)}).focus(), true)`);
    await press('Enter');
    await mustWaitFor(`Boolean(document.querySelector('[role="option"][data-highlighted]'))`, UI_MS, `the ${triggerId} list to open`);
    if ((await evaluate(optionIndex)) >= 0) break;
    if (Date.now() >= end) throw new Error(`${triggerId} has no option "${text}".`);
    await press('Escape');
    await mustWaitFor(`!document.querySelector('[role="listbox"]')`, UI_MS, `the ${triggerId} list to close`);
    await sleep(200);
  }
  for (let i = 0; i < 20; i++) {
    const at = await evaluate(`({ target: ${optionIndex}, current: [...document.querySelectorAll('[role="option"]')].findIndex((o) => o.hasAttribute('data-highlighted')) })`);
    if (at.target === at.current) break;
    await press(at.target > at.current ? 'ArrowDown' : 'ArrowUp');
    await waitFor(`[...document.querySelectorAll('[role="option"]')].findIndex((o) => o.hasAttribute('data-highlighted')) !== ${at.current}`, UI_MS);
  }
  await press('Enter');
  await mustWaitFor(`!document.querySelector('[role="listbox"]') && document.querySelector(${q(trigger)}).innerText.trim() === ${q(text)}`, UI_MS, `${triggerId} to show "${text}"`);
}

/** VERA signs out whenever the renderer loads, so: reload, sign in through the real form, then route. */
async function signIn(engagement, hash, ready) {
  await evaluate(`(localStorage.setItem('auditpro_current_engagement', ${q(JSON.stringify(engagement))}), window.__pdfToolsTestOldPage = true, location.hash = '#/auth', location.reload(), true)`);
  await mustWaitFor(`!window.__pdfToolsTestOldPage && Boolean(document.querySelector('#login-email'))`, WORK_MS, 'the login form after the reload');
  await evaluate(`(() => {
    const set = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.querySelector('#login-email'), ${q(USER.email)});
    set(document.querySelector('#login-password'), ${q(USER.password)});
    document.querySelector('#login-email').closest('form').requestSubmit();
    return true;
  })()`);
  const signedIn = await waitFor(`!location.hash.includes('/auth') && document.querySelector('header')?.innerText.includes(${q(engagement.client_name)})`, WORK_MS);
  if (!signedIn) return false;
  await evaluate(`(location.hash = ${q(hash)}, true)`);
  return waitFor(ready, WORK_MS);
}

// ── Database through the application (as the renderer reads it) ─────────────
async function sql(payload) {
  const r = await evaluate(`globalThis.electronAPI.sqliteQuery(${JSON.stringify(payload)})`);
  if (r.error) throw new Error(`${payload.table} ${payload.action}: ${r.error.message}`);
  return r.data;
}
const insertRow = async (table, data) => (await sql({ table, action: 'insert', data }))[0];
const selectRows = (table, filters = {}) =>
  sql({ table, action: 'select', columns: '*', filters: Object.entries(filters).map(([column, value]) => ({ column, operator: 'eq', value })) });
const pdfToolsLogs = async () =>
  (await selectRows('activity_logs', { entity: 'PDF Tools' })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
const evidencePath = (filePath) => path.join(profilePath, 'files', 'evidence', ...String(filePath).split('/'));

// ── Scenarios after the restart (engagement A, starting from an empty list) ──
const pageTexts = (pdf) => (pdf ? pdf.pages.map((p) => p.text) : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rowText = (id) => evaluate(`document.querySelector('[data-testid="pdf-tools-row"][data-row-id=${q(id)}]')?.innerText.replace(/\\s+/g, ' ') || ''`);

/** Selects one row, saves it through the stubbed picker, and reads the PDF back. */
async function saveAndRead(unit) {
  if (!unit) return { file: null, pdf: null };
  await selectOnly([unit.id]);
  const [file] = await saveSelected(1);
  return { file, pdf: await readPdf(file.bytes) };
}

/** A: Split, Delete pages, Compress, Page numbers and Images to PDF, each result read back. */
async function scenarioOtherTools() {
  step('Other tools: Split, Delete pages, Compress, Page numbers, Images to PDF');
  await addFromComputer([FILES.five, FILES.scans, FILES.wide, FILES.tall]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length === 4 && ${INTAKE_IDLE}`, WORK_MS, 'four rows for the tools');
  const list = await rows();
  const [five, scans, wide, tall] = [FILES.five, FILES.scans, FILES.wide, FILES.tall].map((name) => list.find((r) => r.name === name));

  // Split every 2 pages of 5: one group of three parts.
  let before = await unitIds();
  await selectOnly([five.id]);
  const splitOutcome = await runTool('split', async () => {
    await choose(byTestId('pdf-tools-split-mode-every'));
    await setInput(byTestId('pdf-tools-split-every'), '2');
  });
  const splitGroup = await newUnit(before, 'group');
  const parts = [];
  if (splitGroup) {
    await selectGroup(splitGroup.groupId);
    for (const file of await saveSelected(splitGroup.count)) parts.push(await readPdf(file.bytes));
  }
  check(
    'A1 Split every 2 pages of a 5-page PDF: one group of three parts holding pages 1-2, 3-4 and 5 (read from the saved bytes)',
    splitOutcome === 'closed' && splitGroup?.count === 3 && same(parts.map(pageTexts), [['Five p1', 'Five p2'], ['Five p3', 'Five p4'], ['Five p5']]),
    { splitOutcome, group: splitGroup && splitGroup.count, parts: parts.map(pageTexts) },
  );

  // Delete pages 2 and 4.
  before = await unitIds();
  await selectOnly([five.id]);
  const deleteOutcome = await runTool('delete-pages', () => setInput(byTestId('pdf-tools-page-list'), '2, 4'));
  const deleted = await newUnit(before, 'row');
  const deletedRead = await saveAndRead(deleted);
  check(
    'A2 Delete pages 2 and 4 of 5: the result has 3 pages, pages 1, 3 and 5 in that order',
    deleteOutcome === 'closed' && deletedRead.pdf?.pageCount === 3 && same(pageTexts(deletedRead.pdf), ['Five p1', 'Five p3', 'Five p5']),
    { deleteOutcome, pages: pageTexts(deletedRead.pdf) },
  );

  // Compress at Recommended: two A4 pages of photo-like images.
  before = await unitIds();
  await selectOnly([scans.id]);
  const compressOutcome = await runTool('compress', () => choose(byTestId('pdf-tools-level-recommended')));
  const compressedRead = await saveAndRead(await newUnit(before, 'row'));
  const inputSize = fs.statSync(path.join(fixturesPath, FILES.scans)).size;
  check(
    'A3 Compress (Recommended) of a 2-page image PDF: the result is smaller, still 2 pages, Producer "ICAI VERA"',
    compressOutcome === 'closed' && compressedRead.file?.bytes.length < inputSize && compressedRead.pdf.pageCount === 2 && compressedRead.pdf.producer === 'ICAI VERA',
    { compressOutcome, inputSize, outputSize: compressedRead.file?.bytes.length, pages: compressedRead.pdf?.pageCount, producer: compressedRead.pdf?.producer },
  );

  // Page numbers "Page n of N", top right, on pages 2 to 4 only.
  before = await unitIds();
  await selectOnly([five.id]);
  const numbersOutcome = await runTool('page-numbers', async () => {
    await choose(byTestId('pdf-tools-position-top-right'));
    await chooseOption('pdf-tools-number-format', 'Page 1 of N');
    await choose(byTestId('pdf-tools-number-range-some'));
    await setInput(byTestId('pdf-tools-number-from'), '2');
    await setInput(byTestId('pdf-tools-number-to'), '4');
  });
  const numberedRead = await saveAndRead(await newUnit(before, 'row'));
  // pageNumbers.ts: right edge at the margin (28 pt); the top of a capital at the margin (10 pt, cap height 0.718).
  const placed = (numberedRead.pdf?.pages ?? []).map((p, i) => {
    const item = p.items.find((it) => /^Page \d+ of \d+$/.test(it.str.trim()));
    return {
      expected: i >= 1 && i <= 3 ? `Page ${i} of 3` : null,
      found: item ? item.str.trim() : null,
      inPlace: item ? near(item.x + item.width, p.width - 28) && near(item.y, p.height - 28 - 10 * 0.718) : null,
      ownText: p.text.includes(`Five p${i + 1}`),
    };
  });
  check(
    'A4 Page numbers "Page n of N" at the top right on pages 2-4: the text is on those pages at the expected position, and on no other page',
    numbersOutcome === 'closed' && placed.length === 5 && placed.every((p) => p.ownText && p.found === p.expected && (p.expected === null || p.inPlace)),
    { numbersOutcome, placed },
  );

  // Images to PDF: a landscape and a portrait image, A4 turned to suit each (the default).
  before = await unitIds();
  await selectOnly([wide.id, tall.id]);
  const imagesOutcome = await runTool('images-to-pdf');
  const fromImages = await newUnit(before, 'row');
  const fromImagesRead = await saveAndRead(fromImages);
  const pageShapes = (fromImagesRead.pdf?.pages ?? []).map((p) => ({ width: Math.round(p.width * 100) / 100, height: Math.round(p.height * 100) / 100, images: p.images }));
  check(
    'A5 Images to PDF of a landscape and a portrait image: one page per image, A4 landscape then A4 portrait, each holding its image at full pixel size',
    imagesOutcome === 'closed' &&
      pageShapes.length === 2 &&
      near(pageShapes[0].width, A4[1]) && near(pageShapes[0].height, A4[0]) &&
      near(pageShapes[1].width, A4[0]) && near(pageShapes[1].height, A4[1]) &&
      same(pageShapes.map((p) => p.images), [[{ width: IMAGE_SIZES.wide[0], height: IMAGE_SIZES.wide[1] }], [{ width: IMAGE_SIZES.tall[0], height: IMAGE_SIZES.tall[1] }]]),
    { imagesOutcome, pageShapes },
  );
  return { deleted: deleted && { ...deleted, bytes: deletedRead.file?.bytes }, fromImages: fromImages && { ...fromImages, bytes: fromImagesRead.file?.bytes } };
}

/** E: Save to computer marks the row and logs the destination as the app words it; then the download fallback. */
async function scenarioSaveMarking({ deleted, fromImages }, { engA }) {
  step('Save to computer: marking, activity entry, download fallback');
  if (!deleted?.bytes || !fromImages?.bytes) throw new Error('The tool results needed for the save checks are missing.');
  // The Delete pages result was saved through the save picker in A2.
  const findEntry = (action, name) => poll(async () => (await pdfToolsLogs()).find((l) => l.action === action && l.details.includes(`→ ${name} (`)) || null, UI_MS);
  const saved = await findEntry('Saved to computer', deleted.name);
  const savedTag = await rowText(deleted.id);
  check(
    'E1 a result saved to the computer is marked "Saved to computer" and logged for engagement A, details ending "Destination: Computer." with the saved bytes\' SHA-256',
    /Saved to computer/.test(savedTag) && saved && saved.engagement_id === engA.id && saved.details.endsWith('Destination: Computer.') && JSON.parse(saved.metadata).sha256 === sha256(deleted.bytes),
    { tag: savedTag, entry: saved && { engagement: saved.engagement_id === engA.id ? 'A' : saved.engagement_id, details: saved.details } },
  );

  const fallback = 'E2 with no save picker the result is downloaded: the file arrives with the same bytes, the row says "Sent to download" and the entry ends "Destination: Computer, by download (completion not confirmed)."';
  if (PACKAGED_APP) {
    skip(fallback, "a packaged app has no entry script to keep the download out of Electron's own Save As dialog");
    return;
  }
  await evaluate(`(window.__pdfToolsTestPicker = window.showSaveFilePicker, window.showSaveFilePicker = undefined, true)`);
  await selectOnly([fromImages.id]);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-dest-computer"]')?.dataset.enabled === 'true'`, UI_MS, 'Save to computer to be available');
  await click(byTestId('pdf-tools-dest-computer'));
  const arrived = await poll(async () => fs.readdirSync(downloadsPath).find((f) => !f.endsWith('.crdownload') && fs.readFileSync(path.join(downloadsPath, f)).equals(fromImages.bytes)) || null, WORK_MS);
  const marked = await waitFor(`/Sent to download/.test(document.querySelector('[data-testid="pdf-tools-row"][data-row-id=${q(fromImages.id)}]')?.innerText || '')`, UI_MS);
  const downloaded = await findEntry('Sent to download', fromImages.name);
  await evaluate(`(window.showSaveFilePicker = window.__pdfToolsTestPicker, true)`);
  check(
    fallback,
    arrived && marked && downloaded && downloaded.engagement_id === engA.id && downloaded.details.endsWith('Destination: Computer, by download (completion not confirmed).'),
    { arrived, tag: await rowText(fromImages.id), details: downloaded && downloaded.details },
  );
}

/** B: Enter at once after starting a long run asks first and the run goes on; Keep running finishes it. Cancel, then Stop, adds nothing. */
async function scenarioStopLongRun() {
  step('Stopping a long run: Enter and Keep running; Cancel and Stop');
  await addFromComputer([FILES.longer]);
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-row"][data-name=${q(FILES.longer)}]')) && ${INTAKE_IDLE}`, WORK_MS, 'the 24-page PDF row');
  const longer = (await rows()).find((r) => r.name === FILES.longer);
  const progressText = `(document.querySelector('[data-testid="pdf-tools-progress"]')?.innerText.replace(/\\s+/g, ' ') || '')`;
  const running = `document.querySelector('[data-testid="pdf-tools-progress"]')?.dataset.phase === 'running'`;
  const confirmShown = `Boolean(document.querySelector('[data-testid="pdf-tools-stop-confirm"]'))`;
  const openAt300dpi = async () => {
    await selectOnly([longer.id]);
    await openTool('pdf-to-images');
    await choose(byTestId('pdf-tools-image-dpi-300'));
    await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-run"]')?.disabled === false`, UI_MS, 'the Run button');
  };

  // Started from the keyboard; Enter again as soon as the run has begun lands on Cancel, which asks first.
  let before = await unitIds();
  await openAt300dpi();
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-run"]').focus(), true)`);
  await press('Enter');
  const onCancel = await waitFor(`${running} && document.activeElement?.dataset.testid === 'pdf-tools-cancel-run'`, UI_MS);
  if (onCancel) await press('Enter');
  const asked = Boolean(onCancel) && (await waitFor(confirmShown, UI_MS));
  const progressAtAsk = asked ? await evaluate(progressText) : null;
  const wentOn = asked && (await waitFor(`${confirmShown} && ${running} && ${progressText} !== ${q(progressAtAsk)}`, WORK_MS));
  check(
    'B1 Enter pressed as soon as a long run starts (PDF to images, 24 A4 pages at 300 dpi) asks "Stop…?", and the run goes on while it asks',
    onCancel && asked && wentOn,
    { focusOnCancel: Boolean(onCancel), asked, progressAtAsk, wentOn: Boolean(wentOn) },
  );
  if (asked) await evaluate(`([...document.querySelectorAll('[data-testid="pdf-tools-stop-confirm"] button')].find((b) => b.innerText.trim() === 'Keep running').click(), true)`);
  const finished = await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, WORK_MS);
  const imagesGroup = finished ? await newUnit(before, 'group') : null;
  let sizes = [];
  if (imagesGroup) {
    await selectGroup(imagesGroup.groupId);
    sizes = (await saveSelected(imagesGroup.count)).map((f) => pngSize(f.bytes));
  }
  // A4 at 300 dpi: 595.28 x 841.89 pt -> 2480 x 3508 px.
  check(
    'B2 "Keep running" lets the run finish: 24 images are added, each a PNG of an A4 page at 300 dpi (read from the saved bytes)',
    finished && imagesGroup?.count === 24 && sizes.length === 24 && sizes.every((s) => s && near(s.width, 2480, 2) && near(s.height, 3508, 2)),
    { finished: Boolean(finished), count: imagesGroup?.count, firstSize: sizes[0] },
  );

  // Cancel, then Stop: the dialog stays open, idle, and nothing is added. The heap may still hold
  // older snapshots of this session; as nothing was removed in it, the current one has the most files.
  const filesInStore = async () => Math.max(0, ...(await workingListState()).map((s) => s.files));
  before = await unitIds();
  const filesBefore = await filesInStore();
  await openAt300dpi();
  await click(byTestId('pdf-tools-run'));
  const started = await waitFor(running, UI_MS);
  if (started) await click(byTestId('pdf-tools-cancel-run'));
  const asked2 = Boolean(started) && (await waitFor(confirmShown, UI_MS));
  if (asked2) await click(byTestId('pdf-tools-stop-confirm-yes'));
  const stopped = asked2 && (await waitFor(`!document.querySelector('[data-testid="pdf-tools-progress"]') && !${confirmShown} && Boolean(document.querySelector('[data-testid="pdf-tools-run"]'))`, WORK_MS));
  const filesAfter = await filesInStore();
  const after = await unitIds();
  check(
    'B3 Cancel during a long run asks first; Stop ends the run, the dialog stays open, and nothing is added (list and store unchanged)',
    started && asked2 && stopped && same(after, before) && filesAfter === filesBefore,
    { started: Boolean(started), asked: asked2, stopped: Boolean(stopped), unitsAdded: after.length - before.length, filesBefore, filesAfter },
  );
  if (await exists(byTestId('pdf-tools-dialog'))) {
    await press('Escape');
    await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the PDF to images dialog to close');
  }
}

/** C: with files in A's list, leave PDF Tools, choose B, come back; then back to A. */
async function scenarioClosedScreenSwitch({ userId, engA, engB, clientA, clientB }) {
  step('Engagement change while PDF Tools is closed');
  const filesInA = Math.max(0, ...(await workingListState()).map((s) => s.files));
  await evaluate(`(location.hash = '#/evidence', true)`);
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-root"]') && location.hash.startsWith('#/evidence')`, UI_MS, 'PDF Tools to close');
  const toB = await switchEngagementFromHeader(clientA.name, clientB.name);
  await evaluate(`(location.hash = '#/audit-tools?tab=pdf', true)`);
  const pdfToolsReady = `Boolean(document.querySelector('[data-testid="pdf-tools-root"]')) && document.querySelector('[data-testid="pdf-tools-add-from-vault"]')?.dataset.enabled === 'true'`;
  await mustWaitFor(pdfToolsReady, WORK_MS, 'PDF Tools in engagement B');
  const screen = () => evaluate(`({ units: document.querySelectorAll('[data-testid="pdf-tools-row"], [data-testid="pdf-tools-group"]').length, thumbs: document.querySelectorAll('[data-testid="pdf-tools-thumb"]').length })`);
  const emptyFor = (states, engagement) => states.length > 0 && states.every((s) => s.files === 0 && s.bytes === 0 && s.contextKey === `${userId}:${engagement.id}`);
  const screenB = await screen();
  const stateB = await workingListState();
  check(
    'C1 files in A, PDF Tools left, engagement B chosen, PDF Tools opened again: no rows, no thumbnails, and the store holds no files (0 bytes) for B',
    filesInA > 0 && toB && screenB.units === 0 && screenB.thumbs === 0 && emptyFor(stateB, engB),
    { filesInA, switched: Boolean(toB), screenB, stateB: stateB.map((s) => ({ ...s, contextKey: s.contextKey && (s.contextKey.endsWith(engB.id) ? 'B' : 'other') })) },
  );
  const toA = await switchEngagementFromHeader(clientB.name, clientA.name);
  await mustWaitFor(pdfToolsReady, UI_MS, 'PDF Tools in engagement A');
  const screenA = await screen();
  const stateA = await workingListState();
  check(
    'C2 back in engagement A the list is still empty: cleared, not restored (screen and store)',
    toA && screenA.units === 0 && screenA.thumbs === 0 && emptyFor(stateA, engA),
    { switched: Boolean(toA), screenA, stateA: stateA.map((s) => ({ ...s, contextKey: s.contextKey && (s.contextKey.endsWith(engA.id) ? 'A' : 'other') })) },
  );
}

/** D: engagement B is chosen elsewhere while A's vault upload of a large result is awaiting. */
async function scenarioSwitchDuringUpload({ userId, engA, engB, clientA, clientB }) {
  step('Engagement change during a vault upload');
  await addFromComputer([FILES.large, FILES.two]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length === 2 && ${INTAKE_IDLE}`, WORK_MS, 'the large and the small PDF');
  const added = await rows();
  const [large, small] = [FILES.large, FILES.two].map((name) => added.find((r) => r.name === name));
  // The vault takes results only: drop the first page of each.
  const makeResult = async (row) => {
    const before = await unitIds();
    await selectOnly([row.id]);
    if ((await runTool('delete-pages', () => setInput(byTestId('pdf-tools-page-list'), '1'))) !== 'closed') throw new Error(`Delete pages failed on ${row.name}.`);
    return newUnit(before, 'row');
  };
  const big = await makeResult(large);
  const little = await makeResult(small);
  const order = await unitIds();
  if (!big || !little || order.indexOf(big.id) > order.indexOf(little.id)) throw new Error('The large result must come before the small one in the list (the batch goes in list order).');

  const vaultA0 = await selectRows('evidence_files', { engagement_id: engA.id });
  const vaultB0 = await selectRows('evidence_files', { engagement_id: engB.id });
  const logsB0 = await selectRows('activity_logs', { engagement_id: engB.id });
  await selectOnly([big.id, little.id]);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-dest-vault"]')?.dataset.enabled === 'true'`, UI_MS, 'Add to Evidence Vault to be available');
  await click(byTestId('pdf-tools-dest-vault'));
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-vault-save"] [data-testid="pdf-tools-vault-name"]').length === 2`, UI_MS, 'the vault form for two results');
  // Another window choosing B is what this window sees as: the stored engagement changes and the
  // window regains focus. It is done the moment the vault's own upload reports the large file
  // written ("File uploaded successfully"): its upload call is still awaiting the vault list.
  await evaluate(`(() => {
    const earlier = new Set(document.querySelectorAll('[data-sonner-toast]'));
    window.__pdfToolsTestSwitch = { at: 0 };
    const observer = new MutationObserver(() => {
      const uploaded = [...document.querySelectorAll('[data-sonner-toast]')].some((t) => !earlier.has(t) && /File uploaded successfully/.test(t.innerText));
      if (!uploaded || window.__pdfToolsTestSwitch.at) return;
      observer.disconnect();
      window.__pdfToolsTestSwitch.at = performance.now();
      localStorage.setItem('auditpro_current_engagement', ${q(JSON.stringify(engB))});
      window.dispatchEvent(new Event('focus'));
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return true;
  })()`);
  await click(byTestId('pdf-tools-vault-save-confirm'));
  const switched = await waitFor(`window.__pdfToolsTestSwitch.at > 0`, WORK_MS);
  const emptied = switched && (await waitFor(`!document.querySelector('[data-testid="pdf-tools-vault-save"]') && document.querySelectorAll('[data-testid="pdf-tools-row"], [data-testid="pdf-tools-group"]').length === 0`, UI_MS));

  // The upload that was under way finishes in A, and its entry is written there afterwards.
  const inA = await poll(async () => {
    const added = (await selectRows('evidence_files', { engagement_id: engA.id })).filter((r) => !vaultA0.some((v) => v.id === r.id));
    const entries = added.length ? (await pdfToolsLogs()).filter((l) => l.entity_id === added[0].id) : [];
    return added.length && entries.length ? { added, entries } : null;
  }, WORK_MS);
  const record = inA ? inA.added[0] : null;
  const stored = record && fs.existsSync(evidencePath(record.file_path)) ? fs.readFileSync(evidencePath(record.file_path)) : null;
  const storedPages = stored ? (await PDFDocument.load(stored, { updateMetadata: false })).getPageCount() : null;
  const entry = inA ? inA.entries[0] : null;
  check(
    'D1 the upload under way finishes in A: one new evidence_files row for A, its file complete under A\'s folder (3 pages), and an "Added to Evidence Vault" entry for it in A with the stored bytes\' SHA-256',
    switched && emptied && inA?.added.length === 1 && record.name === big.name && record.file_path.startsWith(`${engA.id}/`) && stored?.length === Number(record.file_size) && storedPages === 3 &&
      entry.action === 'Added to Evidence Vault' && entry.engagement_id === engA.id && JSON.parse(entry.metadata).sha256 === sha256(stored),
    { switched: Boolean(switched), emptied: Boolean(emptied), added: inA?.added.map((r) => r.name), storedSize: stored?.length, recordSize: record?.file_size, storedPages, entry: entry && entry.action },
  );

  // The app itself then shows B: nothing of A's there.
  const toB = await switchEngagementFromHeader(clientA.name, clientB.name);
  const listB = await waitFor(`document.querySelector('[data-testid="pdf-tools-add-from-vault"]')?.dataset.enabled === 'true' && document.querySelectorAll('[data-testid="pdf-tools-row"], [data-testid="pdf-tools-group"]').length === 0`, UI_MS);
  const stateB = await workingListState();
  const vaultB = await selectRows('evidence_files', { engagement_id: engB.id });
  const logsB = await selectRows('activity_logs', { engagement_id: engB.id });
  const littleSent = (await selectRows('evidence_files')).filter((r) => r.name === little.name);
  check(
    'D2 nothing for B (no new evidence_files or activity_logs rows, an empty list and store) and the next file of the batch was not sent',
    toB && listB && vaultB.length === vaultB0.length && logsB.length === logsB0.length && stateB.length > 0 && stateB.every((s) => s.files === 0 && s.contextKey === `${userId}:${engB.id}`) && littleSent.length === 0,
    { switched: Boolean(toB), listEmpty: Boolean(listB), newVaultRowsB: vaultB.length - vaultB0.length, newLogsB: logsB.length - logsB0.length, filesInB: stateB.map((s) => s.files), smallSent: littleSent.length },
  );
}

// ── Test flow ───────────────────────────────────────────────────────────────
async function main() {
  for (const dir of [profilePath, downloadsPath, launchPath, shotsPath]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(launchPath, 'package.json'), JSON.stringify({ name: 'icai-vera-pdf-tools-ui-harness', version: '1.0.0', main: entryPath }));
  await makeFixtures();
  await launch({ restart: false });

  step('Set-up');
  const signup = await evaluate(`globalThis.electronAPI.sqliteAuth(${JSON.stringify({ action: 'signup', ...USER })})`);
  if (signup.error) throw new Error(`Sign-up failed: ${JSON.stringify(signup.error)}`);
  const userId = signup.data.user_id;
  const clientA = await insertRow('clients', { name: 'Synthetic Alpha Private Limited', constitution: 'company' });
  const engA = await insertRow('engagements', { name: 'Statutory audit FY 2024-25', client_id: clientA.id, client_name: clientA.name, financial_year: '2024-25', engagement_type: 'statutory', created_by: userId });
  const clientB = await insertRow('clients', { name: 'Synthetic Beta LLP', constitution: 'llp' });
  const engB = await insertRow('engagements', { name: 'Tax audit FY 2024-25', client_id: clientB.id, client_name: clientB.name, financial_year: '2024-25', engagement_type: 'tax', created_by: userId });
  const programme = await insertRow('audit_programs_new', { engagement_id: engA.id, client_id: clientA.id, name: 'Synthetic Receivables programme', workpaper_reference: 'C.1', created_by: userId });
  const section = await insertRow('audit_program_sections', { audit_program_id: programme.id, name: 'Trade Receivables', order: 0, is_expanded: 0, is_applicable: 1, locked: 0, status: 'not-commenced' });
  const box = await insertRow('audit_program_boxes', { section_id: section.id, header: 'Procedure', content: '', order: 0, status: 'not-commenced', locked: 0, created_by: userId });
  check(
    '1 first user signed up (admin); clients A and B, engagements A and B, and A\'s programme with one section and one box created',
    signup.data.role === 'admin' && [clientA, engA, clientB, engB, programme, section, box].every((r) => r && r.id),
    { role: signup.data.role },
  );

  step('Sign-in to engagement A');
  const opened = await signIn(engA, '#/audit-tools?tab=pdf', `Boolean(document.querySelector('[data-testid="pdf-tools-root"]')) && document.querySelector('[data-testid="pdf-tools-add-from-vault"]')?.dataset.enabled === 'true'`);
  step('Engagement A: PDF Tools');
  pdfToolsWindows.push({ start: Date.now(), end: Infinity });
  check('2 #/audit-tools?tab=pdf opens PDF Tools (pdf-tools-root) in engagement A', opened, await evaluate('location.href'));
  if (!opened) throw new Error('PDF Tools did not open; the remaining steps need it.');

  const toolbar = await evaluate(`({
    built: ${JSON.stringify(BUILT_TOOLS)}.map((id) => Boolean(document.querySelector('[data-testid="pdf-tools-tool-' + id + '"]'))),
    soon: [...document.querySelectorAll('[data-soon-tool]')].map((b) => ({ key: b.dataset.soonTool, ariaDisabled: b.getAttribute('aria-disabled') })),
  })`);
  check(
    'extra: the seven built tools are present; every not-yet-built tool button is present and aria-disabled',
    toolbar.built.every(Boolean) &&
      JSON.stringify(toolbar.soon.map((s) => s.key).sort()) === JSON.stringify([...SOON_TOOLS].sort()) &&
      toolbar.soon.every((s) => s.ariaDisabled === 'true'),
    toolbar,
  );

  // ── 3: two PDFs and their thumbnails ─────────────────────────────────────
  await addFromComputer([FILES.two, FILES.three]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length === 2 && ${INTAKE_IDLE}`, WORK_MS, 'two rows after adding two PDFs');
  const added = await rows();
  const rowOf = (list, name, origin) => list.find((r) => r.name === name && (!origin || r.origin === origin));
  const thumbsFor = async (row, pages) => {
    await selectOnly([row.id]);
    const panel = `section[aria-label=${q(`Pages of ${row.name}`)}] img[data-testid="pdf-tools-thumb"]`;
    const loaded = (selector) => `[...document.querySelectorAll(${q(selector)})].filter((i) => i.complete && i.naturalWidth > 0).length`;
    await waitFor(`${loaded(panel)} === ${pages} && ${loaded('[data-testid="pdf-tools-row"] img[data-testid="pdf-tools-thumb"]')} === 2`, WORK_MS);
    return evaluate(`({ pages: ${loaded(panel)}, all: ${loaded('img[data-testid="pdf-tools-thumb"]')} })`);
  };
  const twoRow = rowOf(added, FILES.two, 'computer');
  const threeRow = rowOf(added, FILES.three, 'computer');
  const thumbsTwo = twoRow ? await thumbsFor(twoRow, 2) : null;
  const thumbsThree = threeRow ? await thumbsFor(threeRow, 3) : null;
  check(
    '3 two PDFs (2 and 3 pages) give two rows; selecting each shows a thumbnail for every page (2 + 3), with at least 5 thumbnails on screen for the 3-page file',
    added.length === 2 && thumbsTwo?.pages === 2 && thumbsThree?.pages === 3 && thumbsThree.all >= 5,
    { rows: added.map((r) => r.text), thumbsTwo, thumbsThree },
  );
  if (!twoRow || !threeRow) throw new Error('The two PDFs are not both in the list; the following steps need them.');

  // ── 4: a protected PDF ───────────────────────────────────────────────────
  await addFromComputer([FILES.locked]);
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-password-input"]'))`, WORK_MS, 'the password dialog');
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-password-input"]').focus(), true)`);
  await cdp('Input.insertText', { text: PDF_PASSWORD });
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-password-submit"]')?.disabled === false`, UI_MS, 'the password submit button');
  await click(byTestId('pdf-tools-password-submit'));
  const unlocked = await waitFor(`!document.querySelector('[data-testid="pdf-tools-password-input"]') && document.querySelectorAll('[data-testid="pdf-tools-row"]').length === 3 && ${INTAKE_IDLE}`, WORK_MS);
  const lockedRow = rowOf(await rows(), FILES.locked);
  check('4 the protected PDF opens with its password: its row appears with 3 pages', unlocked && lockedRow && /\b3 pages\b/.test(lockedRow.text), lockedRow?.text ?? (await rows()).map((r) => r.text));

  // ── 5: Merge ─────────────────────────────────────────────────────────────
  await selectOnly([twoRow.id, threeRow.id]);
  const mergeOutcome = await runTool('merge');
  const merged = (await rows()).find((r) => r.origin === 'result' && /_merged\.pdf$/.test(r.name));
  check('5 Merge of the first two gives a Result row named *_merged.pdf with 5 pages', mergeOutcome === 'closed' && merged && /\b5 pages\b/.test(merged.text), { mergeOutcome, merged });
  if (!merged) throw new Error('No merged result; the destination steps need it.');

  // ── 6: Add to Evidence Vault ─────────────────────────────────────────────
  await selectOnly([merged.id]);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-dest-vault"]')?.dataset.enabled === 'true'`, UI_MS, 'Add to Evidence Vault to be available');
  await click(byTestId('pdf-tools-dest-vault'));
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-vault-name"]')?.value === ${q(merged.name)}`, UI_MS, 'the vault form with the result name');
  await click(byTestId('pdf-tools-vault-save-confirm'));
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-vault-save"]')`, WORK_MS, 'the vault form to close');
  const vaultWritten = await poll(async () => {
    const records = await selectRows('evidence_files', { engagement_id: engA.id });
    const logs = await pdfToolsLogs();
    return records.length >= 1 && logs.length >= 1 ? { records, logs } : null;
  });
  const vaultRecords = vaultWritten ? vaultWritten.records : await selectRows('evidence_files', { engagement_id: engA.id });
  const vaultRecord = vaultRecords[0];
  const newestLog = vaultWritten ? vaultWritten.logs[0] : null;
  const loggedHash = newestLog ? JSON.parse(newestLog.metadata || '{}').sha256 : null;
  const storedFile = vaultRecord ? evidencePath(vaultRecord.file_path) : null;
  const storedHash = storedFile && fs.existsSync(storedFile) ? sha256(fs.readFileSync(storedFile)) : null;
  check(
    '6 Add to Evidence Vault: one evidence_files row for engagement A; its file exists under files/evidence and its SHA-256 equals the newest PDF Tools activity entry\'s',
    vaultRecords.length === 1 && vaultRecord.name === merged.name && storedHash !== null && storedHash === loggedHash,
    { records: vaultRecords.map((r) => [r.name, r.file_path]), storedHash, loggedHash, newestLog: newestLog && newestLog.action },
  );
  if (!vaultRecord) throw new Error('No vault record; the following steps need it.');

  // ── 7: Attach to working paper (the box) ─────────────────────────────────
  await selectOnly([merged.id]);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-dest-working-paper"]')?.dataset.enabled === 'true'`, UI_MS, 'Attach to working paper to be available');
  await click(byTestId('pdf-tools-dest-working-paper'));
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-wp-programme"]')?.innerText.includes(${q(programme.name)})`, UI_MS, 'the attach dialog with the programme chosen');
  await chooseOption('pdf-tools-wp-section', section.name);
  await chooseOption('pdf-tools-wp-box', box.header);
  await click(byTestId('pdf-tools-wp-confirm'));
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-wp-dialog"]')`, WORK_MS, 'the attach dialog to close');
  const attachments = (await poll(async () => {
    const found = await selectRows('audit_program_attachments', { audit_program_id: programme.id });
    return found.length > 0 ? found : null;
  })) || [];
  const recordsAfterAttach = await selectRows('evidence_files', { engagement_id: engA.id });
  check(
    '7 Attach to the programme\'s box: one audit_program_attachments row with the vault row\'s file_path; still exactly one evidence_files row',
    attachments.length === 1 && attachments[0].file_path === vaultRecord.file_path && attachments[0].box_id === box.id && attachments[0].section_id === section.id && recordsAfterAttach.length === 1,
    { attachments: attachments.map((a) => ({ file_path: a.file_path, section_id: a.section_id, box_id: a.box_id })), vaultFilePath: vaultRecord.file_path, records: recordsAfterAttach.length },
  );

  // ── 8: Add from Evidence Vault ───────────────────────────────────────────
  await click(byTestId('pdf-tools-add-from-vault'));
  const listed = await waitFor(`(() => {
    const items = [...document.querySelectorAll('[data-testid="pdf-tools-vault-item"]')].map((i) => i.dataset.name);
    return items.length > 0 ? items : null;
  })()`, UI_MS);
  const vaultItem = `[data-testid="pdf-tools-vault-item"][data-name=${q(merged.name)}] [data-testid="pdf-tools-vault-item-check"]`;
  if (listed && listed.includes(merged.name)) {
    await click(vaultItem);
    await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-vault-add"]')?.disabled === false`, UI_MS, 'the vault picker Add button');
    await click(byTestId('pdf-tools-vault-add'));
  }
  const fromVault = await waitFor(`!document.querySelector('[data-testid="pdf-tools-vault-picker"]') && Boolean(document.querySelector('[data-testid="pdf-tools-row"][data-origin="vault"][data-name=${q(merged.name)}]')) && ${INTAKE_IDLE}`, WORK_MS);
  check('8 Add from Evidence Vault lists the merged file and adds it to the list with origin "vault"', listed && listed.includes(merged.name) && fromVault, { listed, rows: (await rows()).map((r) => [r.name, r.origin]) });

  // ── 9: PDF to images ─────────────────────────────────────────────────────
  const groupsBefore = (await groups()).map((g) => g.id);
  await selectOnly([twoRow.id]);
  const imagesOutcome = await runTool('pdf-to-images');
  const imageGroup = (await waitFor(`(() => {
    const before = new Set(${JSON.stringify(groupsBefore)});
    const g = [...document.querySelectorAll('[data-testid="pdf-tools-group"]')].find((x) => !before.has(x.dataset.groupId));
    return g ? { count: Number(g.dataset.count), text: g.innerText.replace(/\\s+/g, ' ') } : null;
  })()`, UI_MS)) || null;
  check('9 PDF to images on the 2-page file gives 2 image results (one group of 2 images)', imagesOutcome === 'closed' && imageGroup && imageGroup.count === 2 && /2 PNG images/.test(imageGroup.text), { imagesOutcome, imageGroup });

  // ── extra: stopping a long run asks first (Escape; the Cancel button is not pressed) ──
  await addFromComputer([FILES.long]);
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-row"][data-name=${q(FILES.long)}]')) && ${INTAKE_IDLE}`, WORK_MS, 'the 40-page PDF row');
  const longRow = rowOf(await rows(), FILES.long);
  const listBeforeStop = JSON.stringify({ rows: (await rows()).map((r) => r.id), groups: (await groups()).map((g) => g.id) });
  await selectOnly([longRow.id]);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-tool-pdf-to-images"]')?.dataset.enabled === 'true'`, UI_MS, 'PDF to images to be available');
  await click(byTestId('pdf-tools-tool-pdf-to-images'));
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-image-dpi-300"]'))`, UI_MS, 'the PDF to images dialog');
  await click(byTestId('pdf-tools-image-dpi-300'));
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-image-dpi-300"]')?.dataset.state === 'checked' && document.querySelector('[data-testid="pdf-tools-run"]')?.disabled === false`, UI_MS, '300 dpi to be chosen');
  await click(byTestId('pdf-tools-run'));
  const running = await waitFor(`document.querySelector('[data-testid="pdf-tools-progress"]')?.dataset.phase === 'running'`, UI_MS);
  if (running) await press('Escape');
  const asked = running && (await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-stop-confirm"]'))`, UI_MS));
  // "Stop" in the confirmation stops the run and closes the tool's dialog.
  if (asked) await click(byTestId('pdf-tools-stop-confirm-yes'));
  const stopped = asked && (await waitFor(`!document.querySelector('[data-testid="pdf-tools-stop-confirm"]') && !document.querySelector('[data-testid="pdf-tools-dialog"]')`, WORK_MS));
  const listAfterStop = JSON.stringify({ rows: (await rows()).map((r) => r.id), groups: (await groups()).map((g) => g.id) });
  check(
    'extra: stopping a long run (Escape during PDF to images of 40 pages at 300 dpi) asks for confirmation first; Stop closes the dialog and adds nothing',
    running && asked && stopped && listAfterStop === listBeforeStop,
    { running: Boolean(running), asked: Boolean(asked), stopped: Boolean(stopped), listChanged: listAfterStop !== listBeforeStop },
  );
  if (await exists(byTestId('pdf-tools-dialog'))) {
    await press('Escape');
    await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, WORK_MS);
  }

  // ── 10: activity entries, and the password nowhere ───────────────────────
  // Only destinations write PDF Tools entries: adding files, unlocking, Merge, PDF to images, the
  // stopped run and Add from Evidence Vault write none. So exactly two, both for the one vault
  // record of engagement A: the vault add (step 6) and the attachment (step 7).
  const logs = await pdfToolsLogs();
  check(
    '10 exactly two PDF Tools activity entries: "Added to Evidence Vault" and "Attached to working paper", both engagement A, both for the vault record',
    JSON.stringify(logs.map((l) => l.action).sort()) === JSON.stringify(['Added to Evidence Vault', 'Attached to working paper']) &&
      logs.every((l) => l.engagement_id === engA.id && l.entity_id === vaultRecord.id),
    logs.map((l) => ({ action: l.action, engagement: l.engagement_id === engA.id ? 'A' : l.engagement_id, entity_id: l.entity_id })),
  );
  const inLogs = logs.filter((l) => JSON.stringify(l).includes(PDF_PASSWORD)).length;
  const inDatabase = findInDatabase(PDF_PASSWORD);
  const inConsole = consoleMessages.filter((m) => m.text.includes(PDF_PASSWORD)).length;
  check(
    `10 the PDF password is in no activity entry, no value of any table (${inDatabase.tables} tables, ${inDatabase.values} values) and no renderer console message (${consoleMessages.length})`,
    inLogs === 0 && inDatabase.hits.length === 0 && inConsole === 0,
    { inLogs, databaseHits: inDatabase.hits, inConsole },
  );

  // ── 11: engagement B ─────────────────────────────────────────────────────
  step('Engagement B');
  await switchEngagementFromHeader(clientA.name, clientB.name);
  const switched = await waitFor(`document.querySelector('header')?.innerText.includes(${q(clientB.name)}) && Boolean(document.querySelector('[data-testid="pdf-tools-root"]')) && document.querySelectorAll('[data-testid="pdf-tools-row"], [data-testid="pdf-tools-group"]').length === 0`, UI_MS);
  const rowsInB = await evaluate(`document.querySelectorAll('[data-testid="pdf-tools-row"], [data-testid="pdf-tools-group"]').length`);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-add-from-vault"]')?.dataset.enabled === 'true'`, UI_MS, 'Add from Evidence Vault in engagement B');
  await click(byTestId('pdf-tools-add-from-vault'));
  // The empty message shows only once the vault has loaded (or when it has nothing to list).
  const vaultEmptyInB = await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-vault-picker"] [data-testid="pdf-tools-vault-empty"]'))`, UI_MS);
  const itemsInB = await evaluate(`[...document.querySelectorAll('[data-testid="pdf-tools-vault-item"]')].map((i) => i.dataset.name)`);
  check('11 in engagement B the list has no rows, and Add from Evidence Vault lists nothing', switched && rowsInB === 0 && vaultEmptyInB && itemsInB.length === 0, { switched: Boolean(switched), rowsInB, itemsInB });
  await press('Escape');
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-vault-picker"]')`, UI_MS, 'the vault picker to close');
  pdfToolsWindows[0].end = Date.now();

  // ── 12: restart ──────────────────────────────────────────────────────────
  step('Restart and sign-in');
  await closeApp();
  await launch({ restart: true });
  const reopened = await signIn(engA, '#/audit-tools?tab=pdf', `Boolean(document.querySelector('[data-testid="pdf-tools-root"]'))`);
  const recordsAfterRestart = reopened ? await selectRows('evidence_files', { engagement_id: engA.id }) : [];
  const attachmentsAfterRestart = reopened ? await selectRows('audit_program_attachments', { audit_program_id: programme.id }) : [];
  const hashAfterRestart = fs.existsSync(storedFile) ? sha256(fs.readFileSync(storedFile)) : null;
  check(
    '12 after a restart and sign-in: the vault row, the file bytes and the attachment row are still there',
    reopened &&
      recordsAfterRestart.length === 1 &&
      recordsAfterRestart[0].id === vaultRecord.id &&
      recordsAfterRestart[0].file_path === vaultRecord.file_path &&
      hashAfterRestart === storedHash &&
      attachmentsAfterRestart.length === 1 &&
      attachmentsAfterRestart[0].id === attachments[0]?.id &&
      attachmentsAfterRestart[0].file_path === vaultRecord.file_path,
    { reopened: Boolean(reopened), records: recordsAfterRestart.length, attachments: attachmentsAfterRestart.length, sameBytes: hashAfterRestart === storedHash },
  );
  if (!reopened) throw new Error('The restarted application did not open PDF Tools; the remaining scenarios need it.');

  // ── After the restart, in engagement A: the other tools and the harder cases ──
  pdfToolsWindows.push({ start: Date.now(), end: Infinity });
  const people = { userId: signup.data.user_id, engA, engB, clientA, clientB };
  await installSaveStubs();
  const results5 = await scenarioOtherTools();
  await scenarioSaveMarking(results5, people);
  await scenarioStopLongRun();
  await scenarioClosedScreenSwitch(people);
  await scenarioSwitchDuringUpload(people);
  pdfToolsWindows[1].end = Date.now();
  await closeApp();

  // ── 13: network ──────────────────────────────────────────────────────────
  step('Network and errors');
  const duringPdfTools = (r) => pdfToolsWindows.some((w) => r.at >= w.start && r.at <= w.end);
  const nonLocal = requests.filter((r) => !LOCAL_URL.test(r.url));
  const otherHosts = nonLocal.filter((r) => !FONT_HOSTS.includes(hostOf(r.url)));
  const fontRequests = nonLocal.filter((r) => FONT_HOSTS.includes(hostOf(r.url)));
  const nonFontDuringPdfTools = fontRequests.filter((r) => duringPdfTools(r) && r.type !== 'Font');
  check(
    `13 the ${requests.length} recorded requests are local (file:, devtools:, blob:, data:) except the known Google Fonts ones, and none of those but font files came while PDF Tools was used`,
    otherHosts.length === 0 && nonFontDuringPdfTools.length === 0,
    { otherHosts: otherHosts.map((r) => `${r.url} (${r.step})`), nonFontDuringPdfTools: nonFontDuringPdfTools.map((r) => `${r.type} ${r.url}`) },
  );
  if (fontRequests.length) {
    note(`pre-existing: src/index.css imports Inter from Google Fonts. Font requests made (${fontRequests.length}):`);
    for (const r of fontRequests) {
      const inside = duringPdfTools(r);
      note(`  ${r.type || '?'} ${r.url.slice(0, 160)} (${inside ? 'while PDF Tools was used' : `outside PDF Tools: ${r.step}`})`);
    }
    for (const e of networkLogs) note(`  failed: ${e.text} ${e.url || ''}`);
  }

  // ── 14: renderer errors ──────────────────────────────────────────────────
  check('14 no renderer error was logged during the run (page and workers, both launches)', rendererErrors.length === 0, rendererErrors.slice(0, 10));

  // ── extra: the password in no file of the profile (read once the app has closed) ──
  const inProfile = findInFiles(profilePath, PDF_PASSWORD);
  check(`extra: the PDF password is in no file of the profile (${inProfile.files} files, read after the app closed)`, inProfile.hits.length === 0 && inProfile.unreadable.length === 0, inProfile);
}

// ── Run, report, clean up ───────────────────────────────────────────────────
let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) return;
  interrupted = true;
  console.log('\nInterrupted: stopping the application and removing the profile.');
  // The open connection fails, the run stops, and the clean-up below runs.
  killApp().catch(() => undefined);
});

main()
  .catch(async (error) => {
    console.error(`\nThe run stopped during "${currentStep}": ${error.message}`);
    console.error(`stdout tail:\n${stdout.slice(-2000)}\nstderr tail:\n${stderr.slice(-2000)}`);
    check('the test ran to the end', false, error.message);
  })
  .finally(async () => {
    await Promise.all(failureShots);
    await closeApp().catch(() => undefined);
    await killApp();
    try {
      socket?.close();
    } catch {
      /* closed */
    }
    const failed = results.filter((r) => !r.pass);
    // The profile goes in every case; the screenshots stay only when something failed.
    const keep = failed.length > 0 && fs.existsSync(shotsPath) && fs.readdirSync(shotsPath).length > 0;
    for (const entry of fs.readdirSync(runtimeRoot)) {
      if (keep && entry === 'screenshots') continue;
      fs.rmSync(path.join(runtimeRoot, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
    if (!keep) fs.rmSync(runtimeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    const profileRemoved = !fs.existsSync(profilePath);
    const skippedText = skipped.length ? `, ${skipped.length} skipped` : '';
    console.log(`\n${results.length - failed.length}/${results.length} checks passed${skippedText} in ${Math.round((Date.now() - startedAt) / 1000)} s (${PACKAGED_APP ? `packaged app ${PACKAGED_APP}` : 'dist + entry script'}); profile removed: ${profileRemoved}`);
    if (failed.length) console.log(`Failed:\n${failed.map((f) => `  - ${f.name}`).join('\n')}`);
    if (skipped.length) console.log(`Skipped:\n${skipped.map((name) => `  - ${name}`).join('\n')}`);
    if (keep) console.log(`Screenshots of the failures: ${shotsPath}`);
    process.exitCode = failed.length || !profileRemoved || interrupted ? 1 : 0;
  });
