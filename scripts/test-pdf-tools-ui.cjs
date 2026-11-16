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
// Phase 2 (T-048): the toolbar (its order, Organise pages, Watermark, Redact, Bookmarks and Protect usable,
// one Tab stop with arrow keys); bookmarks carried by Merge, Split and Delete pages
// (read back with pdf.js); the bookmark list beside the page panel; Protect (the protected row, its
// preview, refused as input, the vault note, the saved bytes open only with the password, the password
// wiped after a Stop and after a failed run, and found nowhere afterwards); the application's
// keyboard shortcuts kept out of open dialogs (real key events sent from the main process with
// webContents.sendInputEvent, through the entry script; a dialog's own keys still work); the layout at
// 1280 x 720; the "More options" fold; the attachments notes; the footer's reason for an unavailable Run.
// Phase 2, INT2: the focus after a confirmed Stop (no "Blocked aria-hidden"); Resize or crop pages; Compress's
// "Fit to a size"; Split into several files and at bookmarks; TIFF files (and HEIC refused); find and go to page in
// the viewer and the Bookmarks strip; the question before an engagement change throws away unsaved results.
// FIX-B (REV-B): the password prompt's field wiped after a wrong password; a fold opened by a problem stays open;
// a token chip goes into its own field; Organise pages keeps the focus and asks before throwing changes away.
// Redact (T-048, switched on): the find on a short statement made here (an invented PAN and e-mail address), a
// typed word that is not in the file, the confirmation, a Searchable run and its result read with pdf.js, the
// record (counts and choices only), a Stop during a run, and the values typed or redacted found nowhere afterwards;
// a group ticked by hand ticks its possible values too (a labelled name and address); "Add a box" with its two
// ways, the mouse (a real drag on the page) and the keyboard.
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
// every case. PDF_TOOLS_TEST_SHOTS=<folder> also copies the phase 2 screens (int-*: 1280 x 720 and
// 1920 x 1080, light and dark) there.

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
// INT stage 2: the password given to Protect; it must be found nowhere afterwards.
const PROTECT_PASSWORD = 'Synthetic-Protect-Pw-3vR8tY1';
// Invented for the wipe check (INT-19): typed, then stopped; typed, then failed; typed, then used.
const WIPE_PASSWORDS = { stop: 'Invented-Stop-Pw-6hJ2xQ', fail: 'Invented-Fail-Pw-9tB4kW', used: 'Invented-Used-Pw-2mN7rZ' };
// Redact (T-048): invented values written into the statements made here, and a word typed that no file holds.
const REDACT_PAN = 'QZXCV0000W';
const REDACT_EMAIL = 'accounts.invented@example.com';
const REDACT_ABSENT_WORD = 'Zephyrquill Marrow';
// A labelled name and address, which the find lists as possible matches (Balanced does not tick them).
const REDACT_NAME = 'Zorvane Quillfeather';
const REDACT_ADDRESS = 'Flat 12, Orchard Residency, Baner Road, Pune 411045';
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
  marked: 'Synthetic bookmarked.pdf',
  appendix: 'Synthetic appendix.pdf',
  cover: 'Synthetic cover.png',
  attached: 'Synthetic attached.pdf',
  mixed: 'Synthetic mixed sizes.pdf',
  many: 'Synthetic three hundred pages.pdf',
  // QA-FIX: a draft with a comment, an attachment, a title and an author; a file that only restricts
  // copying (it opens without a password); a 144-character name whose end tells it apart.
  carrying: 'Synthetic draft with a comment.pdf',
  restricted: 'Synthetic copy restricted.pdf',
  longName: 'Synthetic M-s Gamma Traders Private Limited - Tax Audit Report u-s 44AB - Form 3CA 3CD with Annexures for AY 2025-26 - final copy v3 revised.pdf',
  // INT2 (lane SPLIT): a 320-page ledger, and the same with ten main sections (each with one below it) and two links.
  ledger: 'Synthetic ledger 320.pdf',
  ledgerMarked: 'Synthetic ledger 320 sections.pdf',
  // INT2 (lane RC): Letter, Letter turned a quarter, A4, a receipt.
  bundle: 'Synthetic bundle.pdf',
  // INT2 (lane TIFF): written here (uncompressed or Deflate, as tiff.ts reads them); one refused colour form; HEIC.
  tiffFax: 'Synthetic fax scan.tif',
  tiffStatement: 'Synthetic statement.tif',
  tiffPhoto: 'Synthetic photo.tif',
  tiffStandard: 'Synthetic standard fax.tif',
  tiffCmyk: 'Synthetic CMYK.tif',
  heic: 'Synthetic phone photo.heic',
  // Redact (T-048): a two-page statement with an invented PAN and e-mail address; a longer one for a Stop.
  redactShort: 'Synthetic statement to redact.pdf',
  redactLong: 'Synthetic long statement to redact.pdf',
  redactLetter: 'Synthetic letter to redact.pdf',
};
// INT2 (lane SPLIT): the main sections of FILES.ledgerMarked (titles with characters a file name cannot hold, Hindi, a duplicate).
const SECTIONS = ['Sales & Receivables', 'Purchases: Payables', 'Bank/Cash', 'करदाता विवरण', 'Notes', 'Notes', 'Fixed assets', 'Payroll?', 'Taxes <GST>', 'Closing "entries"'];
const sectionStart = (k) => (k === 0 ? 2 : 32 * k); // page index of section k's main bookmark (the first starts on page 3)
const A4 = [595.28, 841.89];
const IMAGE_SIZES = { wide: [400, 300], tall: [300, 450] };
// Chromium stops drawing a covered window and slows its timers; the test window must not stall.
const KEEP_DRAWING_SWITCHES = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const BUILT_TOOLS = ['merge', 'split', 'delete-pages', 'compress', 'page-numbers', 'images-to-pdf', 'pdf-to-images'];
// The tools that stay "soon"; the phase 2 tools, all usable (a tool whose run module's BUILT is false goes into
// PHASE_TWO_SOON).
const SOON_TOOLS = ['pdf-to-excel', 'pdf-to-word', 'ocr', 'review'];
const PHASE_TWO_TOOLS = ['organise-pages', 'resize-crop', 'watermark', 'redact', 'bookmarks', 'protect'];
const PHASE_TWO_SOON = [];
// Stage 1b layout: in each group the usable tools in design order, then the quiet "soon" ones.
const DESIGN_GROUPS = [
  ['merge', 'split', 'delete-pages', 'organise-pages', 'resize-crop', 'compress'],
  ['page-numbers', 'watermark', 'redact', 'bookmarks', 'protect'],
  ['images-to-pdf', 'pdf-to-images', 'pdf-to-excel', 'pdf-to-word', 'ocr'],
  ['review'],
];
const expectedOrder = (usablePhaseTwo) => DESIGN_GROUPS.flatMap((g) => {
  const usable = g.filter((id) => BUILT_TOOLS.includes(id) || usablePhaseTwo.includes(id));
  return [...usable, ...g.filter((id) => !usable.includes(id))];
});
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

/** INT stage 1: four pages "Bookmarked p1..p4"; Chapter 1 -> p1 (child Section 1.1 -> p2), Chapter 2 -> p3, Chapter 3 -> p4. */
async function markedPdf() {
  const doc = await PDFDocument.load(await textPdf('Bookmarked', 4));
  const pages = doc.getPages();
  const ctx = doc.context;
  const root = ctx.nextRef();
  const [c1, s11, c2, c3] = [0, 1, 2, 3].map(() => ctx.nextRef());
  const dest = (i) => ctx.obj([pages[i].ref, 'Fit']);
  const title = (t) => pdfLib.PDFHexString.fromText(t);
  ctx.assign(c1, ctx.obj({ Title: title('Chapter 1'), Parent: root, Next: c2, First: s11, Last: s11, Count: 1, Dest: dest(0) }));
  ctx.assign(s11, ctx.obj({ Title: title('Section 1.1'), Parent: c1, Dest: dest(1) }));
  ctx.assign(c2, ctx.obj({ Title: title('Chapter 2'), Parent: root, Prev: c1, Next: c3, Dest: dest(2) }));
  ctx.assign(c3, ctx.obj({ Title: title('Chapter 3'), Parent: root, Prev: c2, Dest: dest(3) }));
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: c1, Last: c3, Count: 4 }));
  doc.catalog.set(pdfLib.PDFName.of('Outlines'), root);
  return doc.save();
}

/** INT stage 2: three pages with one attachment in the document's list (a synthetic text file). */
/** INT2 (lane SPLIT): the 320-page ledger with ten main bookmarks, each with one below it, and on page 1 links to pages 2 and 200. */
async function ledgerWithSections(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const ctx = doc.context;
  const dest = (i) => ctx.obj([pages[i].ref, 'Fit']);
  const title = (t) => pdfLib.PDFHexString.fromText(t);
  const root = ctx.nextRef();
  const tops = SECTIONS.map(() => ctx.nextRef());
  const kids = SECTIONS.map(() => ctx.nextRef());
  SECTIONS.forEach((name, k) => {
    ctx.assign(kids[k], ctx.obj({ Title: title(`${name} detail`), Parent: tops[k], Dest: dest(sectionStart(k) + 5) }));
    const entry = { Title: title(name), Parent: root, First: kids[k], Last: kids[k], Count: -1, Dest: dest(sectionStart(k)) };
    if (k > 0) entry.Prev = tops[k - 1];
    if (k < SECTIONS.length - 1) entry.Next = tops[k + 1];
    ctx.assign(tops[k], ctx.obj(entry));
  });
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: tops[0], Last: tops[tops.length - 1], Count: SECTIONS.length }));
  doc.catalog.set(pdfLib.PDFName.of('Outlines'), root);
  const link = (rect, to) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], Dest: dest(to) }));
  pages[0].node.set(pdfLib.PDFName.of('Annots'), ctx.obj([link([40, 700, 200, 720], 1), link([40, 670, 200, 690], 199)]));
  return doc.save();
}

/** INT2 (lane RC): Letter, Letter turned a quarter (shown landscape), A4, and a receipt (80 x 120 mm), each with its text. */
async function bundlePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes = [[612, 792], [612, 792], A4, [226.77, 340.16]];
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawText(`Bundle p${i + 1}`, { x: 24, y: h / 2, size: 16, font });
    if (i === 1) page.setRotation(pdfLib.degrees(90));
  });
  return doc.save();
}

/**
 * INT2 (lane TIFF): a classic little-endian TIFF, one strip a page, written here (no image library). Each page:
 * { width, height, photometric (0 white-is-zero 1-bit, 1 grey, 2 RGB, 5 CMYK), samples (the raw strip), dpi: [x, y],
 * deflate }. tiff.ts reads uncompressed and Deflate (8) strips.
 */
function tiffFile(pages) {
  const parts = [Buffer.from([0x49, 0x49, 42, 0, 0, 0, 0, 0])];
  let offset = 8;
  let previousNext = 4; // where the offset of the next IFD is written
  for (const page of pages) {
    const spp = { 0: 1, 1: 1, 2: 3, 5: 4 }[page.photometric];
    const bits = page.photometric === 0 ? 1 : 8;
    const strip = page.deflate ? zlib.deflateSync(page.samples) : Buffer.from(page.samples);
    const stripAt = offset;
    parts.push(strip);
    offset += strip.length + (strip.length % 2);
    if (strip.length % 2) parts.push(Buffer.alloc(1));
    // Values over 4 bytes: BitsPerSample (several samples) and the two resolutions.
    const extras = [];
    const extra = (buf) => {
      const at = offset;
      extras.push(buf);
      offset += buf.length;
      return at;
    };
    const bpsAt = spp > 1 ? extra(Buffer.from(new Uint16Array(Array(spp).fill(bits)).buffer)) : null;
    const rational = (n) => {
      const b = Buffer.alloc(8);
      b.writeUInt32LE(n, 0);
      b.writeUInt32LE(1, 4);
      return b;
    };
    const xAt = extra(rational(page.dpi[0]));
    const yAt = extra(rational(page.dpi[1]));
    parts.push(...extras);
    const entries = [
      [256, 4, 1, page.width],
      [257, 4, 1, page.height],
      [258, 3, spp, bpsAt ?? bits],
      [259, 3, 1, page.deflate ? 8 : 1],
      [262, 3, 1, page.photometric],
      [273, 4, 1, stripAt],
      [277, 3, 1, spp],
      [278, 4, 1, page.height],
      [279, 4, 1, strip.length],
      [282, 5, 1, xAt],
      [283, 5, 1, yAt],
      [296, 3, 1, 2],
    ];
    const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
    ifd.writeUInt16LE(entries.length, 0);
    entries.forEach(([tag, type, count, value], i) => {
      const at = 2 + i * 12;
      ifd.writeUInt16LE(tag, at);
      ifd.writeUInt16LE(type, at + 2);
      ifd.writeUInt32LE(count, at + 4);
      if (type === 3 && count === 1) ifd.writeUInt16LE(value, at + 8);
      else ifd.writeUInt32LE(value, at + 8);
    });
    const ifdAt = offset;
    parts.push(ifd);
    offset += ifd.length;
    const all = Buffer.concat(parts);
    all.writeUInt32LE(ifdAt, previousNext);
    parts.length = 0;
    parts.push(all);
    previousNext = ifdAt + 2 + entries.length * 12;
  }
  return parts[0];
}
/** A bilevel "scanned text" picture, one byte a pixel (1 = black): lines of word-like blocks. */
function textPicture(width, height, seed) {
  let state = seed;
  const rnd = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const px = new Uint8Array(width * height);
  for (let y = Math.round(height * 0.08); y < height * 0.92; y += 46) {
    for (let x = Math.round(width * 0.08); x < width * 0.9; ) {
      const w = 20 + Math.floor(rnd() * 90);
      for (let yy = y; yy < y + 22 && yy < height; yy++) for (let xx = x; xx < x + w && xx < width; xx++) if (rnd() > 0.15) px[yy * width + xx] = 1;
      x += w + 18;
    }
  }
  return px;
}
/** One byte a pixel to rows of bits, most significant first (each row padded to a byte). */
function packBits1(px, width, height) {
  const rowBytes = Math.ceil(width / 8);
  const out = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (px[y * width + x]) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}
/** Red on the left half, blue on the right: a colour mix-up shows at once. */
function halves(width, height) {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px.set(x < width / 2 ? [220, 30, 30] : [30, 30, 220], (y * width + x) * 3);
  return px;
}
// The picture of FILES.tiffFax, kept to compare results with it pixel for pixel.
let FAX_PICTURE = null;
function writeTiffFixtures(write) {
  FAX_PICTURE = textPicture(1654, 2339, 7);
  const fax = { width: 1654, height: 2339, photometric: 0, samples: packBits1(FAX_PICTURE, 1654, 2339), dpi: [200, 200], deflate: true };
  write(FILES.tiffFax, tiffFile([fax]));
  const grey = Buffer.alloc(1240 * 1754);
  for (let y = 0; y < 1754; y++) for (let x = 0; x < 1240; x++) grey[y * 1240 + x] = (x + y) % 256;
  write(FILES.tiffStatement, tiffFile([fax, { width: 1240, height: 1754, photometric: 1, samples: grey, dpi: [150, 150], deflate: true }, { width: 800, height: 600, photometric: 2, samples: halves(800, 600), dpi: [100, 100], deflate: true }]));
  write(FILES.tiffPhoto, tiffFile([{ width: 640, height: 480, photometric: 2, samples: halves(640, 480), dpi: [96, 96], deflate: true }]));
  const small = textPicture(1728, 1100, 9);
  write(FILES.tiffStandard, tiffFile([{ width: 1728, height: 1100, photometric: 0, samples: packBits1(small, 1728, 1100), dpi: [204, 98], deflate: true }]));
  write(FILES.tiffCmyk, tiffFile([{ width: 40, height: 30, photometric: 5, samples: Buffer.alloc(40 * 30 * 4), dpi: [72, 72], deflate: false }]));
  // An iPhone photo's first bytes are enough for PDF Tools to know it (and refuse it).
  write(FILES.heic, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(16)]));
}

async function attachedPdf() {
  const doc = await PDFDocument.load(await textPdf('Attached', 3));
  await doc.attach(Buffer.from('synthetic attachment body'), 'notes.txt', { mimeType: 'text/plain', description: 'synthetic' });
  return doc.save();
}

/** Redact (T-048): A4 pages of a statement; the invented PAN on every page, the invented e-mail address on the first. */
async function statementPdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(A4);
    const lines = [`Synthetic statement p${n}`, `PAN: ${REDACT_PAN}`, ...(n === 1 ? [`E-mail: ${REDACT_EMAIL}`] : []), 'Closing balance 12,345.00'];
    lines.forEach((line, i) => page.drawText(line, { x: 60, y: 760 - i * 28, size: 12, font }));
  }
  return doc.save();
}

/** Redact (T-048): one A4 page with a labelled name and address, the invented PAN, and words that stay. */
async function letterPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  const lines = ['Synthetic letter p1', `Name: ${REDACT_NAME}`, `Address: ${REDACT_ADDRESS}`, `PAN: ${REDACT_PAN}`, 'Closing balance 12,345.00'];
  lines.forEach((line, i) => page.drawText(line, { x: 60, y: 760 - i * 28, size: 12, font }));
  return doc.save();
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
  write(FILES.marked, await markedPdf());
  write(FILES.appendix, await textPdf('Appendix', 2));
  write(FILES.attached, await attachedPdf());
  write(FILES.cover, png(320, 240));
  // UX-GAP: a long file whose Split into single pages takes a while (a click lands while it runs).
  write(FILES.many, await textPdf('Many', 300));
  // UX-GAP: an A4 page, then a small one (a header that fits the first page does not fit the second).
  {
    const doc = await PDFDocument.load(await textPdf('Mixed', 1, A4));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 300]).drawText('Mixed p2', { x: 24, y: 150, size: 18, font });
    write(FILES.mixed, await doc.save());
  }
  write(FILES.scans, await imagePdf([1, 2].map((seed) => ({ width: 1200, height: 1700, pixels: photoPixels(1200, 1700, seed), flate: true }))));
  // About 31 MB of noise that no compression shrinks: a vault upload that takes a while.
  write(FILES.large, await imagePdf([1, 2, 3, 4].map(() => ({ width: 1600, height: 1600, pixels: crypto.randomBytes(1600 * 1600 * 3), flate: false }))));
  const encrypting = await EncryptingPDFDocument.load(await textPdf('Locked', 3), { updateMetadata: false });
  encrypting.encrypt({ userPassword: PDF_PASSWORD, algorithm: 'AES-128' });
  const locked = Buffer.from(await encrypting.save());
  if (!locked.includes('/Encrypt')) throw new Error('The protected fixture is not encrypted.');
  fs.writeFileSync(path.join(fixturesPath, FILES.locked), locked);
  // QA-FIX A: what a copy still carries.
  {
    const doc = await PDFDocument.load(await textPdf('Draft', 2));
    const note = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 300, 40, 320], Contents: pdfLib.PDFHexString.fromText('Synthetic reviewer note') }));
    doc.getPage(0).node.addAnnot(note);
    await doc.attach(Buffer.from('synthetic workings'), 'workings.txt', { mimeType: 'text/plain' });
    doc.setTitle('Synthetic draft title');
    doc.setAuthor('Synthetic author');
    write(FILES.carrying, await doc.save());
  }
  // QA-FIX E: restrictions only (an owner password; no password to open it).
  {
    const restricting = await EncryptingPDFDocument.load(await textPdf('Restricted', 2), { updateMetadata: false });
    restricting.encrypt({ userPassword: '', ownerPassword: 'Synthetic-Owner-Only-5pQ', permissions: { copying: false, modifying: false } });
    write(FILES.restricted, Buffer.from(await restricting.save()));
  }
  write(FILES.longName, await textPdf('Long name', 2));
  // INT2: the lanes' scenarios.
  const ledger = await textPdf('Ledger', 320, A4);
  write(FILES.ledger, ledger);
  write(FILES.ledgerMarked, await ledgerWithSections(ledger));
  write(FILES.bundle, await bundlePdf());
  writeTiffFixtures(write);
  write(FILES.redactShort, await statementPdf(2));
  write(FILES.redactLong, await statementPdf(16));
  write(FILES.redactLetter, await letterPdf());
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

/** INT stage 1: the outline as pdf.js reads it, [depth, title, page index or null, text of that page]. */
async function pdfOutline(bytes) {
  pdfjs ??= await import(pathToFileURL(path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const texts = [];
  for (let n = 1; n <= pdf.numPages; n++) texts.push((await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str || '').join(' ').replace(/\s+/g, ' ').trim());
  const out = [];
  const walk = async (items, depth) => {
    for (const it of items || []) {
      let page = null;
      try {
        const d = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
        if (d && d[0] != null) page = typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0]);
      } catch {
        page = null;
      }
      out.push([depth, it.title, page, page === null ? null : texts[page]]);
      await walk(it.items, depth + 1);
    }
  };
  await walk(await pdf.getOutline(), 0);
  await pdf.destroy();
  return out;
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
// Any native question of the page (alert, confirm), recorded and answered OK over the DevTools protocol. (With
// the Page domain enabled, Chromium makes window.confirm return true at once.) The question before an engagement
// change is no longer one of them: since FIX-C it is the application's own dialog, answered by
// switchEngagementFromHeader and scenarioLeaveQuestion.
const jsDialogs = [];
const jsDialogAnswer = true;

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
    case 'Page.javascriptDialogOpening':
      jsDialogs.push({ type: params.type, message: params.message, answered: jsDialogAnswer, step: currentStep });
      cdp('Page.handleJavaScriptDialog', { accept: jsDialogAnswer }).catch(() => undefined);
      break;
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
    PDF_TOOLS_TEST_KEYS: path.join(runtimeRoot, 'keys.json'),
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
    // The phase 2 screens, also kept outside the runtime folder when asked (PDF_TOOLS_TEST_SHOTS).
    if (name.startsWith('int-') && process.env.PDF_TOOLS_TEST_SHOTS) fs.copyFileSync(file, path.join(process.env.PDF_TOOLS_TEST_SHOTS, path.basename(file)));
    return file;
  } catch {
    return null; // no page to capture
  }
}

/** INT stage 1b: a screenshot at width x height, light or dark, then back to 1280 x 800 and light. */
async function shotAt(name, width, height, dark) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (dark) await evaluate(`(document.documentElement.classList.add('dark'), true)`);
  await sleep(500);
  await screenshot(`int-${name}-${width}x${height}-${dark ? 'dark' : 'light'}`);
  if (dark) await evaluate(`(document.documentElement.classList.remove('dark'), true)`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
}
async function shotsAll(name) {
  for (const [w, h] of [[1280, 720], [1920, 1080]]) for (const dark of [false, true]) await shotAt(name, w, h, dark);
}
/** Real key events from the main process (webContents.sendInputEvent), through the entry script's command file (PDF_TOOLS_TEST_KEYS). */
let keysId = 0;
async function keysFromMain(keys) {
  const file = path.join(runtimeRoot, 'keys.json');
  const id = ++keysId;
  const events = keys.flatMap(({ keyCode, modifiers = [] }) => [
    { type: 'keyDown', keyCode, modifiers },
    { type: 'keyUp', keyCode, modifiers },
  ]);
  fs.writeFileSync(file, JSON.stringify({ id, events }));
  const end = Date.now() + UI_MS;
  while (Date.now() < end) {
    if (fs.existsSync(`${file}.done`) && fs.readFileSync(`${file}.done`, 'utf8') === String(id)) return true;
    await sleep(100);
  }
  return false;
}

/** The result toast's buttons, by their words. */
const toastButton = (label) => `[...document.querySelectorAll('[data-sonner-toast] button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})`;

// ── Page helpers ────────────────────────────────────────────────────────────
const q = (selector) => JSON.stringify(selector);
const byTestId = (id) => `[data-testid="${id}"]`;
const exists = (selector) => evaluate(`Boolean(document.querySelector(${q(selector)}))`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); if (!el) throw new Error('Nothing to click: ' + ${q(selector)}); el.click(); return true; })()`);
const KEY_CODES = { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, Tab: 9, ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35 };
async function press(key) {
  const text = key === 'Enter' ? '\r' : undefined;
  await cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: KEY_CODES[key], ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: KEY_CODES[key] });
}
/** UX-GAP: a key with modifiers, as the keyboard sends it (CDP: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
const ALT = 1;
async function pressWith(key, modifiers) {
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: KEY_CODES[key], modifiers });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: KEY_CODES[key], modifiers });
}
/** UX-GAP: a real mouse click (or double-click) in the middle of the element, after scrolling it into view. */
async function mouseClick(selector, clickCount = 1) {
  const at = await evaluate(`(() => {
    const el = document.querySelector(${q(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!at) throw new Error(`Nothing to click: ${selector}`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  for (let n = 1; n <= clickCount; n++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: n });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: n });
  }
  return at;
}
/**
 * UX-GAP: a slow disk, simulated in the page. The build's module preloader waits on Promise.allSettled before
 * each lazy chunk with shared parts (the phase 2 dialogs and run modules); while `window.__uxSlowMs` is set,
 * that wait takes so much longer, with the window idle, as a slow disk or a busy virus scanner makes it.
 * Also records when PDF Tools' loading outline, the screen, a tool button's spinner and a dialog appear.
 */
const UX_WATCH = `(() => {
  if (window.__uxWatchInstalled) return;
  window.__uxWatchInstalled = true;
  window.__uxSlowMs = window.__uxSlowMs || 0;
  const settled = Promise.allSettled.bind(Promise);
  Promise.allSettled = (items) => settled(items).then((r) => (window.__uxSlowMs ? new Promise((done) => setTimeout(() => done(r), window.__uxSlowMs)) : r));
  let seen = {};
  window.__uxWatch = () => { seen = {}; window.__uxLog = []; };
  window.__uxWatch();
  const mark = (what) => { if (!seen[what]) { seen[what] = true; window.__uxLog.push([what, Math.round(performance.now())]); } };
  const look = () => {
    const loading = document.querySelector('[data-testid="pdf-tools-loading"]');
    if (loading) mark('loading');
    if (loading && loading.dataset.shown === 'true') mark('shown');
    if (!loading && seen.loading) mark('gone');
    if (document.querySelector('[data-testid="pdf-tools-root"]')) mark('root');
    const busy = document.querySelector('[data-pdf-toolbar] [data-loading="true"]');
    if (busy) mark('busy:' + busy.dataset.testid + ':' + busy.getAttribute('aria-busy'));
    if (!busy && Object.keys(seen).some((k) => k.startsWith('busy:'))) mark('unbusy');
    const dialog = document.querySelector('[data-testid="pdf-tools-dialog"]');
    if (dialog) mark('dialog:' + dialog.dataset.tool);
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-shown', 'data-loading'] });
  document.addEventListener('pointerdown', (event) => {
    const tool = event.target instanceof Element && event.target.closest('[data-pdf-toolbar] [data-testid^="pdf-tools-tool-"]');
    if (tool) mark('click:' + tool.dataset.testid);
  }, true);
})()`;
/** UX-GAP: the times recorded by UX_WATCH, by name; `busy` and `dialog` keep their suffix in `names`. */
const uxTimes = async () => {
  const log = (await evaluate('window.__uxLog || []')) || [];
  const at = (prefix) => log.find(([what]) => what === prefix || what.startsWith(`${prefix}:`))?.[1] ?? null;
  return { log, at };
};

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
  // With results not saved, the application asks first (its own dialog since FIX-C, no longer window.confirm):
  // these switches answer as a user who means to change engagement, as they always have.
  const changedOrAsked = `(document.querySelector('[data-testid="engagement-leave-question"]') ? 'asked' : '') || (document.querySelector('header')?.innerText.includes(${q(toClient)}) && ![...document.querySelectorAll('[role="menu"]')].length ? 'changed' : '')`;
  if ((await waitFor(changedOrAsked, UI_MS)) === 'asked') await click(byTestId('engagement-leave-go'));
  return waitFor(`document.querySelector('header')?.innerText.includes(${q(toClient)}) && ![...document.querySelectorAll('[role="menu"]')].length && !document.querySelector('[data-testid="engagement-leave-question"]')`, UI_MS);
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
  const marked = await waitFor(`/Download started/.test(document.querySelector('[data-testid="pdf-tools-row"][data-row-id=${q(fromImages.id)}]')?.innerText || '')`, UI_MS);
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
/**
 * INT-19: Protect wipes the password when a run ends with the dialog open (a Stop, a failure): not in the page,
 * not in the two fields' React fibers (current and alternate, memoized and pending props); the focus waits in the
 * new password field; typing (real text input), Show / Hide and Enter-to-run work afterwards.
 */
async function scenarioProtectWipe() {
  step('INT stage 3: Protect wipes the password after a Stop and after a failed run');
  const already = (await rows()).length;
  await addFromComputer([FILES.large]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${already + 1} && ${INTAKE_IDLE}`, WORK_MS, 'the large PDF');
  const large = (await rows()).filter((r) => r.name === FILES.large).pop();
  await selectOnly([large.id]);
  await openTool('protect');
  const PW = byTestId('pdf-tools-protect-password');
  const CONFIRM = byTestId('pdf-tools-protect-confirm');
  const running = `document.querySelector('[data-testid="pdf-tools-progress"]')?.dataset.phase === 'running'`;
  const confirmShown = `Boolean(document.querySelector('[data-testid="pdf-tools-stop-confirm"]'))`;
  const idleOpen = `!document.querySelector('[data-testid="pdf-tools-progress"]') && !${confirmShown} && Boolean(document.querySelector('[data-testid="pdf-tools-run"]'))`;
  const onPasswordField = `document.activeElement?.dataset.testid === 'pdf-tools-protect-password'`;
  const wipeState = (password) =>
    evaluate(`(() => {
      const pw = ${q(password)};
      const has = (v) => typeof v === 'string' && v.includes(pw);
      const propsHave = (p) => Boolean(p) && typeof p === 'object' && Object.values(p).some(has);
      const keyed = (el, prefix) => { const k = el && Object.keys(el).find((x) => x.startsWith(prefix)); return k ? el[k] : null; };
      const fields = ['pdf-tools-protect-password', 'pdf-tools-protect-confirm'].map((id) => {
        const el = document.querySelector('[data-testid="' + id + '"]');
        const f = keyed(el, '__reactFiber$');
        return {
          id,
          value: el ? has(el.value) || has(el.getAttribute('value')) : null,
          domProps: propsHave(keyed(el, '__reactProps$')),
          current: Boolean(f) && (propsHave(f.memoizedProps) || propsHave(f.pendingProps)),
          alternate: Boolean(f && f.alternate) && (propsHave(f.alternate.memoizedProps) || propsHave(f.alternate.pendingProps)),
        };
      });
      // A wider look, for the report: every element of the dialog, and the components above the field (props and hook states).
      const dialog = document.querySelector('[data-testid="pdf-tools-dialog"]');
      let elements = 0;
      for (const el of dialog ? dialog.querySelectorAll('*') : []) {
        const f = keyed(el, '__reactFiber$');
        for (const g of [f, f && f.alternate]) if (g && (propsHave(g.memoizedProps) || propsHave(g.pendingProps))) elements += 1;
      }
      let components = 0;
      for (let f = keyed(document.querySelector('[data-testid="pdf-tools-protect-password"]'), '__reactFiber$'), n = 0; f && n < 60; f = f.return, n += 1) {
        for (const g of [f, f.alternate]) {
          if (!g) continue;
          if (propsHave(g.memoizedProps)) components += 1;
          for (let h = g.memoizedState, m = 0; h && typeof h === 'object' && 'next' in h && m < 80; h = h.next, m += 1) {
            if (has(h.memoizedState) || propsHave(h.memoizedState)) components += 1;
          }
        }
      }
      return {
        inPage: document.documentElement.outerHTML.includes(pw) || [...document.querySelectorAll('input, textarea')].some((i) => has(i.value)),
        fields,
        elements,
        components,
        focus: document.activeElement?.dataset.testid ?? document.activeElement?.tagName ?? null,
      };
    })()`);
  const clean = (w) => !w.inPage && w.fields.every((f) => f.value === false && !f.domProps && !f.current && !f.alternate);
  const typeInto = async (selector, text) => {
    await evaluate(`(document.querySelector(${q(selector)}).focus(), true)`);
    await cdp('Input.insertText', { text });
  };

  // 1. Typed, then stopped (the run slowed down so Stop comes first).
  await typeInto(PW, WIPE_PASSWORDS.stop);
  await typeInto(CONFIRM, WIPE_PASSWORDS.stop);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-run"]')?.dataset.enabled === 'true'`, UI_MS, 'Run to be available');
  await cdp('Emulation.setCPUThrottlingRate', { rate: 12 });
  await click(byTestId('pdf-tools-run'));
  const started = await waitFor(running, UI_MS);
  if (started) await click(byTestId('pdf-tools-cancel-run'));
  const asked = Boolean(started) && (await waitFor(confirmShown, UI_MS));
  if (asked) await click(byTestId('pdf-tools-stop-confirm-yes'));
  const stopped = asked && (await waitFor(idleOpen, WORK_MS));
  await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
  // The focus is handed on to the field for a moment after the Stop question closes: it must end up there and stay.
  const focusAfterStop = (await waitFor(onPasswordField, UI_MS)) && (await sleep(500), await waitFor(onPasswordField, UI_MS));
  const afterStop = await wipeState(WIPE_PASSWORDS.stop);

  // 2. Typing works again (real text input into the new field), Show / Hide works, then Enter runs a run that fails.
  await cdp('Input.insertText', { text: WIPE_PASSWORDS.fail });
  await typeInto(CONFIRM, WIPE_PASSWORDS.fail);
  const typedAfterStop = await evaluate(`document.querySelector(${q(PW)}).value === ${q(WIPE_PASSWORDS.fail)} && document.querySelector(${q(CONFIRM)}).value === ${q(WIPE_PASSWORDS.fail)}`);
  await click(byTestId('pdf-tools-protect-show'));
  const shownType = await evaluate(`document.querySelector(${q(PW)}).type`);
  await click(byTestId('pdf-tools-protect-show'));
  const hiddenType = await evaluate(`document.querySelector(${q(PW)}).type`);
  // The encryption needs random bytes: refusing them makes the run fail (test only; put back right after).
  await evaluate(`(crypto.getRandomValues = () => { throw new Error('Synthetic failure for the test.'); }, true)`);
  await evaluate(`(document.querySelector(${q(CONFIRM)}).focus(), true)`);
  await press('Enter');
  const failed = await waitFor(`${idleOpen} && Boolean(document.querySelector('[data-testid="pdf-tools-dialog-error"]'))`, WORK_MS);
  await evaluate(`(delete crypto.getRandomValues, true)`);
  const failMessage = failed ? await evaluate(`document.querySelector('[data-testid="pdf-tools-dialog-error"]')?.innerText.trim() ?? null`) : null;
  const focusAfterFail = (await waitFor(onPasswordField, UI_MS)) && (await sleep(500), await waitFor(onPasswordField, UI_MS));
  const afterFail = await wipeState(WIPE_PASSWORDS.fail);
  const stopStillGone = await wipeState(WIPE_PASSWORDS.stop);

  // 3. Typed again and Enter from the password field: the run finishes and adds the protected copy.
  const beforeUsed = await unitIds();
  await cdp('Input.insertText', { text: WIPE_PASSWORDS.used });
  await typeInto(CONFIRM, WIPE_PASSWORDS.used);
  await evaluate(`(document.querySelector(${q(PW)}).focus(), true)`);
  await press('Enter');
  const closed = await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, WORK_MS);
  const made = closed ? await newUnit(beforeUsed, 'row') : null;
  check(
    'INT-19 Protect: after a Stop and after a failed run (dialog open) the typed password is in neither the page nor the two fields (DOM props, fiber and alternate, memoized and pending); focus waits in the new password field; typing, Show / Hide and Enter-to-run work, and the last run adds the protected copy',
    Boolean(stopped) && Boolean(focusAfterStop) && clean(afterStop) && typedAfterStop === true && shownType === 'text' && hiddenType === 'password' &&
      Boolean(failed) && Boolean(focusAfterFail) && clean(afterFail) && clean(stopStillGone) && Boolean(made),
    { started: Boolean(started), asked, stopped: Boolean(stopped), focusAfterStop: Boolean(focusAfterStop), afterStop, typedAfterStop, shownType, hiddenType, failed: Boolean(failed), failMessage, focusAfterFail: Boolean(focusAfterFail), afterFail, stopStillGone, made: made && made.name },
  );
  note(`INT-19 wider look (for the report): after the Stop ${afterStop.elements} element and ${afterStop.components} component holders; after the failure ${afterFail.elements} and ${afterFail.components}`);
}

/** INT stage 1: Merge with the two bookmark options; Split and Delete pages of a bookmarked file; all read back from the saved BYTES with pdf.js. */
async function scenarioBookmarksStageOne() {
  step('INT stage 1: bookmarks carried by Merge, Split and Delete pages');
  const already = (await rows()).length;
  await addFromComputer([FILES.cover, FILES.marked, FILES.appendix]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${already + 3} && ${INTAKE_IDLE}`, WORK_MS, 'the three bookmark fixtures');
  const list = await rows();
  const [cover, marked, appendix] = [FILES.cover, FILES.marked, FILES.appendix].map((name) => list.filter((r) => r.name === name).pop());
  const ticked = list.filter((r) => r.checked).map((r) => r.id).sort();
  check(
    'INT-5 the files just added are ticked, and only they (UX audit C1.1): Merge is ready at once',
    same(ticked, [cover.id, marked.id, appendix.id].sort()) && (await evaluate(`document.querySelector('[data-testid="pdf-tools-tool-merge"]')?.dataset.enabled`)) === 'true',
    { ticked, want: [cover.id, marked.id, appendix.id] },
  );
  await shotsAll('list-ready');

  // Merge, both options as the dialog opens them (on): a bookmark per file, images included, each file's own under it.
  let before = await unitIds();
  await selectOnly([cover.id, marked.id, appendix.id]);
  let defaults = null;
  let notCarriedNote = null;
  const mergeOutcome = await runTool('merge', async () => {
    defaults = await evaluate(`({
      file: document.querySelector('[data-testid="pdf-tools-merge-file-bookmarks"]')?.dataset.state,
      keep: document.querySelector('[data-testid="pdf-tools-merge-keep-bookmarks"]')?.dataset.state,
      keepDisabled: document.querySelector('[data-testid="pdf-tools-merge-keep-bookmarks"]')?.disabled,
    })`);
    await screenshot('int-merge-dialog-options');
    await shotsAll('merge-dialog');
    await evaluate(`(document.documentElement.classList.add('dark'), true)`);
    await sleep(300);
    await screenshot('int-merge-dialog-options-dark');
    await evaluate(`(document.documentElement.classList.remove('dark'), true)`);
    await sleep(300);
  });
  const merged = await saveAndRead(await newUnit(before, 'row'));
  const mergedOutline = merged.file ? await pdfOutline(merged.file.bytes) : null;
  const expectMerged = [
    [0, 'Synthetic cover', 0, ''],
    [0, 'Synthetic bookmarked', 1, 'Bookmarked p1'],
    [1, 'Chapter 1', 1, 'Bookmarked p1'],
    [2, 'Section 1.1', 2, 'Bookmarked p2'],
    [1, 'Chapter 2', 3, 'Bookmarked p3'],
    [1, 'Chapter 3', 4, 'Bookmarked p4'],
    [0, 'Synthetic appendix', 5, 'Appendix p1'],
  ];
  check(
    'INT-1 Merge (image, bookmarked PDF, plain PDF) with both bookmark options on by default: the saved bytes hold a bookmark per file in list order, the image included, and the file\'s own bookmarks under it, each opening the right page (pdf.js)',
    mergeOutcome === 'closed' && defaults?.file === 'checked' && defaults?.keep === 'checked' && !defaults?.keepDisabled && same(mergedOutline, expectMerged),
    { mergeOutcome, defaults, mergedOutline },
  );

  // Merge with "keep each file's own bookmarks" off: per-file bookmarks only, and the dialog says the files' own are not carried.
  before = await unitIds();
  await selectOnly([cover.id, marked.id, appendix.id]);
  const perFileOutcome = await runTool('merge', async () => {
    await click(byTestId('pdf-tools-merge-keep-bookmarks'));
    await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-merge-keep-bookmarks"]')?.dataset.state === 'unchecked'`, UI_MS, 'keep-own to be off');
    await screenshot('int-merge-dialog-keep-off');
    notCarriedNote = await evaluate(`document.querySelector('[data-testid="pdf-tools-not-carried"]')?.innerText.replace(/\\s+/g, ' ') || ''`);
    // and unticking the first option disables the second
    await click(byTestId('pdf-tools-merge-file-bookmarks'));
    await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-merge-keep-bookmarks"]')?.disabled === true`, UI_MS, 'keep-own to be disabled');
    await click(byTestId('pdf-tools-merge-file-bookmarks'));
    await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-merge-keep-bookmarks"]')?.disabled === false && document.querySelector('[data-testid="pdf-tools-merge-keep-bookmarks"]')?.dataset.state === 'unchecked'`, UI_MS, 'keep-own enabled again, still off');
  });
  const perFile = await saveAndRead(await newUnit(before, 'row'));
  const perFileOutline = perFile.file ? await pdfOutline(perFile.file.bytes) : null;
  check(
    'INT-2 Merge with only "a bookmark for each file": the bytes hold three bookmarks, one per file at its first page, and the dialog said the files\' own bookmarks are not carried',
    perFileOutcome === 'closed' &&
      same(perFileOutline, [[0, 'Synthetic cover', 0, ''], [0, 'Synthetic bookmarked', 1, 'Bookmarked p1'], [0, 'Synthetic appendix', 5, 'Appendix p1']]) &&
      notCarriedNote.includes('Bookmarks are not carried into the merged file.'),
    { perFileOutcome, perFileOutline, notCarriedNote },
  );

  // Split pages 2-3: Chapter 1's page is left out, so it goes and Section 1.1 moves up; Chapter 3 goes.
  before = await unitIds();
  await selectOnly([marked.id]);
  let splitNote = null;
  const splitOutcome = await runTool('split', async () => {
    await choose(byTestId('pdf-tools-split-mode-range'));
    await setInput(byTestId('pdf-tools-split-from'), '2');
    await setInput(byTestId('pdf-tools-split-to'), '3');
    splitNote = await evaluate(`document.querySelector('[data-testid="pdf-tools-not-carried"]')?.innerText.replace(/\\s+/g, ' ') || ''`);
  });
  const split = await saveAndRead(await newUnit(before, 'row'));
  const splitOutline = split.file ? await pdfOutline(split.file.bytes) : null;
  // Delete page 3: Chapter 2 goes; Chapter 1 keeps its child.
  before = await unitIds();
  await selectOnly([marked.id]);
  const deleteOutcome = await runTool('delete-pages', () => setInput(byTestId('pdf-tools-page-list'), '3'));
  const deleted = await saveAndRead(await newUnit(before, 'row'));
  const deletedOutline = deleted.file ? await pdfOutline(deleted.file.bytes) : null;
  // INT-4: the result message offers the next step (UX audit C6.10).
  before = await unitIds();
  await selectOnly([marked.id]);
  await runTool('delete-pages', () => setInput(byTestId('pdf-tools-page-list'), '1'));
  let madeForSave = await newUnit(before, 'row');
  const buttons = await waitFor(`(() => { const t = document.querySelector('[data-sonner-toast]'); return t ? [...t.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean) : null; })()`, UI_MS);
  // The toast stays 10 s: two quick shots only, then its button is used.
  await shotAt('result-toast', 1280, 720, false);
  await shotAt('result-toast', 1920, 1080, true);
  if (!(await evaluate(`Boolean(${toastButton('Save to computer')})`))) {
    // INT3: on a very busy machine the two pictures outlasted the message's 10 s; the same result is made again
    // and its message's button used at once (what is checked is that the button saves its own result).
    note('INT-4: the result message had gone during the pictures (a busy machine); the result is made again');
    before = await unitIds();
    await selectOnly([marked.id]);
    await runTool('delete-pages', () => setInput(byTestId('pdf-tools-page-list'), '1'));
    madeForSave = await newUnit(before, 'row');
    await waitFor(`Boolean(${toastButton('Save to computer')})`, UI_MS);
  }
  await evaluate(`(window.__pdfToolsTestSaved.length = 0, true)`);
  await evaluate(`(${toastButton('Save to computer')}.click(), true)`);
  const savedFromToast = await waitFor(`window.__pdfToolsTestSaved.length === 1 && window.__pdfToolsTestSaved[0].name`, WORK_MS);
  before = await unitIds();
  await selectOnly([marked.id]);
  await runTool('delete-pages', () => setInput(byTestId('pdf-tools-page-list'), '2'));
  const madeForVault = await newUnit(before, 'row');
  await waitFor(`Boolean(${toastButton('Add to Evidence Vault')})`, UI_MS);
  await evaluate(`(${toastButton('Add to Evidence Vault')}.click(), true)`);
  const vaultNames = await waitFor(`(() => { const d = document.querySelector('[data-testid="pdf-tools-vault-save"]'); return d ? [...d.querySelectorAll('[data-testid="pdf-tools-vault-name"]')].map((i) => i.value) : null; })()`, UI_MS);
  await screenshot('int-vault-from-toast');
  await press('Escape');
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-vault-save"]')`, UI_MS, 'the vault form to close');
  check(
    'INT-4 the result message has "Add to Evidence Vault" and "Save to computer": Save saves that result, Add opens the vault form for that result',
    Array.isArray(buttons) && [...buttons].sort().join('|') === 'Add to Evidence Vault|Save to computer' && savedFromToast === madeForSave?.name && vaultNames?.length === 1,
    { buttons, savedFromToast, madeForSave: madeForSave?.name, vaultNames, madeForVault: madeForVault?.name },
  );

  // INT-6: a click on an unavailable tool or destination says why (UX audit C1.2, C4.2).
  await selectOnly([]);
  const idleLine = await waitFor(`document.querySelector('[data-testid="pdf-tools-why"]')?.innerText.trim() || null`, UI_MS);
  await click(byTestId('pdf-tools-tool-merge'));
  const mergeWhy = await waitFor(`(() => { const t = document.querySelector('[data-testid="pdf-tools-why"]')?.innerText.trim(); return t && t.startsWith('Select at least two') ? t : null; })()`, UI_MS);
  await selectOnly([appendix.id]);
  await click(byTestId('pdf-tools-dest-vault'));
  const vaultWhy = await waitFor(`(() => { const t = document.querySelector('[data-testid="pdf-tools-why"]')?.innerText.trim(); return t && t.startsWith('Only results') ? t : null; })()`, UI_MS);
  await screenshot('int-why-line');
  check(
    'INT-6 nothing ticked: the line under the toolbar asks to tick files; a click on a grey tool or destination shows its reason there',
    idleLine === 'Tick files in the list to use a tool.' && mergeWhy === 'Select at least two files to merge. Images are added as pages.' && Boolean(vaultWhy),
    { idleLine, mergeWhy, vaultWhy },
  );

  // INT-7: Tab leaves a result name that is cleaned on leaving and reaches the next control (W2-OG's focus-trap finding).
  await selectOnly([cover.id, appendix.id]);
  await openTool('merge');
  await setInput(byTestId('pdf-tools-result-name'), 'Odd/name');
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-result-name"]').focus(), true)`);
  await press('Tab');
  // INT3: until the name is cleaned (a fixed 300 ms was not enough on a very busy machine), then a moment for the focus.
  await waitFor(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value === 'Odd_name.pdf'`, UI_MS);
  await sleep(300);
  const afterTab = await evaluate(`({ id: document.activeElement?.dataset.testid || document.activeElement?.getAttribute('role') || document.activeElement?.tagName, name: document.querySelector('[data-testid="pdf-tools-result-name"]').value })`);
  await press('Escape');
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the Merge dialog to close');
  // The same from Split's and Compress's name fields: real Tab key events, focus must move on inside the dialog.
  const tabFrom = async (tool, prepare) => {
    await selectOnly([marked.id]);
    await openTool(tool);
    if (prepare) await prepare();
    await setInput(byTestId('pdf-tools-result-name'), 'Odd/name');
    await evaluate(`(document.querySelector('[data-testid="pdf-tools-result-name"]').focus(), true)`);
    await press('Tab');
    await waitFor(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value === 'Odd_name.pdf'`, UI_MS);
    await sleep(300);
    const where = await evaluate(`(() => {
      const d = document.querySelector('[data-testid="pdf-tools-dialog"]');
      const a = document.activeElement;
      return { inDialog: Boolean(d && a && d.contains(a)), isDialog: a === d, isName: a?.dataset.testid === 'pdf-tools-result-name', what: a?.dataset.testid || a?.getAttribute('aria-label') || a?.tagName, name: document.querySelector('[data-testid="pdf-tools-result-name"]').value };
    })()`);
    await press('Escape');
    await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, `the ${tool} dialog to close`);
    return where;
  };
  const splitTab = await tabFrom('split', () => choose(byTestId('pdf-tools-split-mode-range')));
  const compressTab = await tabFrom('compress');
  const movedOn = (w) => w.inDialog && !w.isDialog && !w.isName && w.name === 'Odd_name.pdf';
  check(
    'INT-7 a real Tab from the result name (cleaned on leaving) reaches the next control in Merge, Split and Compress; focus is not pulled back to the dialog',
    afterTab.id === 'pdf-tools-merge-file-bookmarks' && afterTab.name === 'Odd_name.pdf' && movedOn(splitTab) && movedOn(compressTab),
    { merge: afterTab, split: splitTab, compress: compressTab },
  );

  // INT-8: the read-only bookmark list beside the page panel; choosing a bookmark shows its page.
  await selectOnly([marked.id]);
  const listShown = await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-bookmark-item-3"]'))`, WORK_MS);
  const items = await evaluate(`[...document.querySelectorAll('[data-testid^="pdf-tools-bookmark-item-"]')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
  if (listShown) await click(byTestId('pdf-tools-bookmark-item-3'));
  const shownPage = await waitFor(`document.querySelector('li[data-marked="true"] [data-page]')?.dataset.page || null`, UI_MS);
  await shotsAll('bookmark-list');
  check(
    'INT-8 a bookmarked PDF selected alone shows its bookmarks beside the page panel; choosing "Chapter 2" marks page 3 there',
    Boolean(listShown) && items.some((t) => t.includes('Chapter 2')) && shownPage === '3',
    { listShown: Boolean(listShown), items, shownPage },
  );

  // INT-9: Protect, then the protected result in the list, refused as input, noted in the vault form, and saved encrypted.
  before = await unitIds();
  await selectOnly([appendix.id]);
  const protectOutcome = await runTool('protect', async () => {
    await setInput(byTestId('pdf-tools-protect-password'), PROTECT_PASSWORD);
    await setInput(byTestId('pdf-tools-protect-confirm'), PROTECT_PASSWORD);
  });
  const locked = await newUnit(before, 'row');
  const badge = locked ? await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-row"][data-row-id=${q(locked.id)}] [data-testid="pdf-tools-file-protected"]'))`, UI_MS) : false;
  const thumbDrawn = locked ? await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-row"][data-row-id=${q(locked.id)}] img[data-testid="pdf-tools-thumb"]'))`, WORK_MS) : false;
  if (locked) await selectOnly([locked.id]);
  const splitEnabled = await evaluate(`document.querySelector('[data-testid="pdf-tools-tool-split"]')?.dataset.enabled`);
  await click(byTestId('pdf-tools-tool-split'));
  const refusedWhy = await waitFor(`(() => { const t = document.querySelector('[data-testid="pdf-tools-why"]')?.innerText.trim(); return t && t.startsWith('This file is protected') ? t : null; })()`, UI_MS);
  // Both pages drawn (the panel draws them one after the other: waiting for "any" would stop at the first).
  const panelThumbs = await waitFor(`(() => { const n = document.querySelectorAll('section[aria-label^="Pages of"] img[data-testid="pdf-tools-thumb"]').length; return n >= 2 ? n : null; })()`, WORK_MS);
  await shotsAll('protected-row');
  await click(byTestId('pdf-tools-dest-vault'));
  const vaultNote = await waitFor(`document.querySelector('[data-testid="pdf-tools-vault-protected-note"]')?.innerText.replace(/\\s+/g, ' ').trim() || null`, UI_MS);
  await screenshot('int-vault-protected-note');
  await press('Escape');
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-vault-save"]')`, UI_MS, 'the vault form to close');
  let lockedSaved = null;
  if (locked) {
    await selectOnly([locked.id]);
    lockedSaved = await saveSelected(1).then(([file]) => ({ file })).catch((e) => ({ error: String(e) }));
  }
  pdfjs ??= await import(pathToFileURL(path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  let refusedWithout = null;
  let openedWith = null;
  if (lockedSaved?.file) {
    try {
      await pdfjs.getDocument({ data: new Uint8Array(lockedSaved.file.bytes), isEvalSupported: false, verbosity: 0 }).promise;
      refusedWithout = false;
    } catch (e) {
      refusedWithout = e?.name === 'PasswordException';
    }
    try {
      const d = await pdfjs.getDocument({ data: new Uint8Array(lockedSaved.file.bytes), password: PROTECT_PASSWORD, isEvalSupported: false, verbosity: 0 }).promise;
      openedWith = d.numPages;
      await d.destroy();
    } catch {
      openedWith = null;
    }
  }
  check(
    'INT-9 Protect: the result row says "Protected" and shows its pages (from the unprotected preview); every tool refuses it and says why; the vault form says reviewers need the password; the saved bytes open only with the password',
    protectOutcome === 'closed' && Boolean(badge) && Boolean(thumbDrawn) && splitEnabled === 'false' &&
      refusedWhy === 'This file is protected by PDF Tools. Use the file it was made from.' && Number(panelThumbs) >= 2 &&
      typeof vaultNote === 'string' && vaultNote.includes('Reviewers will need the password') && refusedWithout === true && openedWith === 2,
    { protectOutcome, badge: Boolean(badge), thumbDrawn: Boolean(thumbDrawn), splitEnabled, refusedWhy, panelThumbs, vaultNote, refusedWithout, openedWith, saveError: lockedSaved?.error },
  );

  // INT-11: the toolbar is one Tab stop; the arrow keys, Home and End move along it (UX audit C11).
  const toolbarKeys = async () => {
    const stops = await evaluate(`document.querySelectorAll('[data-pdf-toolbar] [data-toolbar-item][tabindex="0"]').length`);
    await evaluate(`(document.querySelector('[data-pdf-toolbar] [data-toolbar-item][tabindex="0"]').focus(), true)`);
    const at = () => evaluate(`document.activeElement?.dataset.testid || document.activeElement?.dataset.soonTool || null`);
    await press('Home');
    const first = await at();
    await press('ArrowRight');
    const second = await at();
    await press('End');
    const last = await at();
    await press('Home');
    const home = await at();
    await press('ArrowLeft');
    const stays = await at();
    const tabbable = await evaluate(`[...document.querySelectorAll('[data-pdf-toolbar] button')].filter((b) => b.tabIndex >= 0).length`);
    return { stops, first, second, last, home, stays, tabbable };
  };
  const keysResult = await toolbarKeys();
  check(
    'INT-11 the toolbar is one Tab stop; Right moves to the next tool, End to the last ("Review · soon"), Home back to Merge, and Left stops at the start',
    keysResult.stops === 1 && keysResult.tabbable === 1 && keysResult.first === 'pdf-tools-tool-merge' && keysResult.second === 'pdf-tools-tool-split' &&
      keysResult.last === 'review' && keysResult.home === 'pdf-tools-tool-merge' && keysResult.stays === 'pdf-tools-tool-merge',
    keysResult,
  );

  // INT-12: the small-laptop layout at 1280 x 720 (UX audit C13).
  await selectOnly([cover.id]);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const layout = await evaluate(`(() => {
    for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0;
    window.scrollTo(0, 0);
    const tops = new Set([...document.querySelectorAll('[data-pdf-toolbar] [data-toolbar-item]')].map((b) => Math.round(b.getBoundingClientRect().top)));
    const bar = document.querySelector('[data-testid="pdf-tools-dest-computer"]').closest('.sticky');
    const rows = [...document.querySelectorAll('[data-testid="pdf-tools-row"]:not([data-member])')];
    const inView = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; }).length;
    return {
      toolbarRows: tops.size,
      barHeight: Math.round(bar.getBoundingClientRect().height),
      rowHeight: Math.round(rows[0].getBoundingClientRect().height),
      rowsInView: inView,
      firstRowTop: Math.round(rows[0].getBoundingClientRect().top),
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  })()`);
  await screenshot('int-layout-1280x720');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  note(`INT-12 layout at 1280x720: ${JSON.stringify(layout)}`);
  check(
    'INT-12 at 1280 x 720: the toolbar is at most 3 rows, the list bar one line (under 50 px), rows under 60 px with at least 5 in view, nothing sideways',
    layout.toolbarRows <= 3 && layout.barHeight < 50 && layout.rowHeight < 60 && layout.rowsInView >= 5 && !layout.sideways,
    layout,
  );

  // INT-14: the application's shortcuts do not act behind an open PDF Tools dialog (keys sent from the main process).
  if (PACKAGED_APP) skip('INT-14 the application\'s shortcuts do not act behind an open dialog', 'a packaged app has no entry script to send key events from the main process');
  else {
  // A watcher notes whether PDF Tools went from the page at any moment (a VERA Tools tab switch takes it away with the
  // open dialog and what was typed in it; since main's a15b4c3 the other tab stays, as the address's ?tab= is followed
  // only when it changes, so the way back is the PDF Tools tab itself).
  const watchRoot = () =>
    evaluate(`(() => {
      window.__pdfRootGone = false;
      window.__pdfRootObserver?.disconnect();
      window.__pdfRootObserver = new MutationObserver(() => { if (!document.querySelector('[data-testid="pdf-tools-root"]')) window.__pdfRootGone = true; });
      window.__pdfRootObserver.observe(document.body, { childList: true, subtree: true });
      return true;
    })()`);
  const rootGone = async () => (await evaluate('window.__pdfRootGone === true')) === true;
  const backToPdfTools = async (hash) => {
    if (!(await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-root"]')) && location.hash === ${q(hash)}`, 3000))) {
      // Another screen: back by the address. Another VERA Tools tab (same address): a click on the PDF Tools tab
      // (Radix tabs take the press, not a page click()).
      const pdfTab = '[role="tab"][id$="-trigger-pdf"]';
      if ((await evaluate('location.hash')) !== hash) await evaluate(`(location.hash = ${q(hash)}, true)`);
      else if (await exists(pdfTab)) await mouseClick(pdfTab);
      if (!(await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-root"]'))`, UI_MS))) {
        await mustWaitFor(`Boolean(document.querySelector(${q(pdfTab)}))`, UI_MS, 'the PDF Tools tab');
        await mouseClick(pdfTab);
      }
    }
    await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-root"]'))`, WORK_MS, 'PDF Tools again');
  };
  // Controls: with no dialog open, the same keys do reach the application.
  await selectOnly([]);
  const hashAtStart = await evaluate('location.hash');
  // From a toolbar button: the toolbar's own arrow keys must leave Alt + an arrow to the application.
  const focusToolbar = () => evaluate(`(document.querySelector('[data-pdf-toolbar] [data-toolbar-item][tabindex="0"]').focus(), true)`);
  await focusToolbar();
  await watchRoot();
  const controlAltSent = await keysFromMain([{ keyCode: 'Right', modifiers: ['alt'] }]);
  await sleep(800);
  const controlAltActed = await rootGone();
  await backToPdfTools(hashAtStart);
  await focusToolbar();
  // Ctrl+E (Engagements): Ctrl+Y goes to /my-dashboard, which the application has no route for (its 404 page logs an error).
  const controlYSent = await keysFromMain([{ keyCode: 'E', modifiers: ['control'] }]);
  const controlYActed = Boolean(await waitFor(`location.hash !== ${q(hashAtStart)}`, UI_MS));
  const controlYHash = await evaluate('location.hash');
  await backToPdfTools(hashAtStart);
  // Every key VERA uses: its tab switch (Alt + arrows, Ctrl + a digit), its screens (Ctrl + a letter), the
  // sidebar (Ctrl+B) and the shortcut list (Ctrl+/).
  const APP_KEYS = [
    { keyCode: 'Right', modifiers: ['alt'] },
    { keyCode: 'Left', modifiers: ['alt'] },
    { keyCode: 'Y', modifiers: ['control'] },
    { keyCode: 'D', modifiers: ['control'] },
    { keyCode: 'O', modifiers: ['control'] },
    { keyCode: '3', modifiers: ['control'] },
    { keyCode: 'B', modifiers: ['control'] },
    { keyCode: '/', modifiers: ['control'] },
  ];
  const sidebarState = () => evaluate(`document.querySelector('[data-side][data-state]')?.dataset.state ?? null`);
  const shortcutList = () => evaluate(`[...document.querySelectorAll('[role="dialog"]')].some((d) => d.innerText.includes('Keyboard Shortcuts'))`);
  const sidebarAtStart = await sidebarState();
  const POSITIONS = {
    dialog: `(document.querySelector('[data-testid="pdf-tools-dialog"], [role="dialog"]').focus(), true)`,
    text: null, // the name box, below
    nowhere: `(document.activeElement?.blur(), true)`,
  };
  const keptIn = async (label, open, nameSelector) => {
    await open();
    // A name inside a closed "More options" fold: open the folds first.
    await evaluate(`([...document.querySelectorAll('[role="dialog"] button[aria-expanded="false"][data-testid$="-more"]')].forEach((b) => b.click()), true)`);
    await setInput(nameSelector, 'Kept-name');
    const results = [];
    for (const [position, focus] of Object.entries(POSITIONS)) {
      await evaluate(focus ?? `(document.querySelector(${q(nameSelector)}).focus(), true)`);
      const focused = await evaluate(`document.activeElement === document.body ? 'body' : (document.activeElement?.dataset.testid || document.activeElement?.tagName || null)`);
      await watchRoot();
      const sent = await keysFromMain(APP_KEYS);
      await sleep(700);
      const after = await evaluate(`({ dialog: Boolean(document.querySelector('[role="dialog"]')), name: document.querySelector(${q(nameSelector)})?.value ?? null, hash: location.hash })`);
      const gone = await rootGone();
      const sidebar = await sidebarState();
      const list = await shortcutList();
      results.push({ position, focused, sent, rootGone: gone, sidebar, shortcutList: list, ...after });
      if (!after.dialog || gone || after.hash !== hashAtStart) break;
    }
    await press('Escape');
    await waitFor(`!document.querySelector('[role="dialog"]')`, UI_MS);
    const last = results[results.length - 1];
    if (last.rootGone || last.hash !== hashAtStart) await backToPdfTools(hashAtStart);
    if (last.shortcutList) await press('Escape');
    return { label, results };
  };
  const mergedRow = (await rows()).find((r) => r.origin === 'result');
  const NAME = byTestId('pdf-tools-result-name');
  const keyRuns = [
    await keptIn('merge', async () => { await selectOnly([cover.id, appendix.id]); await openTool('merge'); }, NAME),
    await keptIn('split', async () => { await selectOnly([marked.id]); await openTool('split'); await choose(byTestId('pdf-tools-split-mode-range')); }, NAME),
    await keptIn('compress', async () => { await selectOnly([marked.id]); await openTool('compress'); }, NAME),
    await keptIn('watermark', async () => { await selectOnly([marked.id]); await openTool('watermark'); }, NAME),
    await keptIn('organise-pages', async () => { await selectOnly([marked.id]); await openTool('organise-pages'); }, NAME),
    await keptIn('protect', async () => { await selectOnly([marked.id]); await openTool('protect'); }, NAME),
    await keptIn('vault', async () => {
      await selectOnly([mergedRow.id]);
      await click(byTestId('pdf-tools-dest-vault'));
      await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-vault-name"]'))`, UI_MS, 'the vault form');
    }, byTestId('pdf-tools-vault-name')),
  ];
  await evaluate('(window.__pdfRootObserver?.disconnect(), true)');
  const keyFailures = keyRuns.flatMap((run) =>
    run.results.length === 3
      ? run.results.filter((r) => !(r.sent && r.dialog && String(r.name).startsWith('Kept-name') && r.hash === hashAtStart && !r.rootGone && r.sidebar === sidebarAtStart && !r.shortcutList)).map((r) => ({ label: run.label, ...r }))
      : [{ label: run.label, stoppedAfter: run.results }],
  );
  note(`INT-14 keys from the main process: ${keyRuns.map((run) => `${run.label}: ${run.results.map((r) => `${r.position}(${r.focused})`).join(', ')}`).join('; ')}`);
  check(
    'INT-14 in Merge, Split, Compress, Watermark, Organise pages, Protect and the vault form, from the dialog, its name box and with the focus nowhere: Alt+Right, Alt+Left, Ctrl+Y, Ctrl+D, Ctrl+O, Ctrl+3, Ctrl+B and Ctrl+/ sent from the main process leave the dialog open with its typed name; PDF Tools never leaves the page, the address, the sidebar and the shortcut list stay (controls: with no dialog, Alt+Right switches the VERA Tools tab and Ctrl+E opens Engagements)',
    controlAltSent && controlAltActed && controlYSent && controlYActed && keyFailures.length === 0,
    { control: { controlAltSent, controlAltActed, controlYSent, controlYActed, controlYHash }, hashAtStart, sidebarAtStart, keyFailures },
  );

  }

  // INT-15: the shared fold hides its summary when open (UX: the Watermark lane's finding).
  await selectOnly([cover.id]);
  await openTool('images-to-pdf');
  await click(byTestId('pdf-tools-images-more'));
  await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-image-margin"]')?.offsetParent)`, UI_MS);
  const summaryWhenOpen = await evaluate(`getComputedStyle(document.querySelector('[data-testid="pdf-tools-images-more-summary"]')).display`);
  // and a margin that is wrong blocks Run; fixed, Run is available again
  await setInput(byTestId('pdf-tools-image-margin'), '999');
  const blockedRun = await evaluate(`document.querySelector('[data-testid="pdf-tools-run"]')?.disabled`);
  await setInput(byTestId('pdf-tools-image-margin'), '20');
  const freedRun = await evaluate(`document.querySelector('[data-testid="pdf-tools-run"]')?.disabled`);
  await press('Escape');
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the Images to PDF dialog to close');
  check(
    'INT-15 the open "More options" fold hides its summary line; a wrong margin blocks Run and the fixed one frees it',
    summaryWhenOpen === 'none' && blockedRun === true && freedRun === false,
    { summaryWhenOpen, blockedRun, freedRun },
  );

  // INT-16: attachments in the document's list are noticed when the file is added; Split says they are not
  // carried, Organise pages (which keeps them) says so once a page is removed.
  const beforeAttached = (await rows()).length;
  await addFromComputer([FILES.attached]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${beforeAttached + 1} && ${INTAKE_IDLE}`, WORK_MS, 'the attached fixture');
  const attachedRow = (await rows()).filter((r) => r.name === FILES.attached).pop();
  await selectOnly([attachedRow.id]);
  await openTool('split');
  await choose(byTestId('pdf-tools-split-mode-range'));
  const attachSplitNote = await evaluate(`document.querySelector('[data-testid="pdf-tools-not-carried"]')?.innerText.trim() ?? null`);
  await press('Escape');
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the Split dialog to close');
  await openTool('organise-pages');
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-organise-tile-1"]'))`, WORK_MS, 'the Organise pages tiles');
  const keptBefore = await evaluate(`Boolean(document.querySelector('[data-testid="pdf-tools-organise-attachments-kept"]'))`);
  // Nothing changed yet: Run is unavailable and a click on it says why in the footer.
  const whyText = `document.querySelector('[data-testid="pdf-tools-dialog-why"]')?.innerText.trim() ?? ''`;
  const runAtOpen = await evaluate(`document.querySelector('[data-testid="pdf-tools-run"]')?.dataset.enabled ?? null`);
  await click(byTestId('pdf-tools-run'));
  const whyAtOpen = await waitFor(`(${whyText}) || null`, UI_MS);
  await click(byTestId('pdf-tools-organise-tile-1'));
  await click(byTestId('pdf-tools-organise-remove'));
  const keptLine = await waitFor(`document.querySelector('[data-testid="pdf-tools-organise-attachments-kept"]')?.innerText.trim() || null`, UI_MS);
  // The problem is fixed (a page removed): Run is available and the old reason has gone from the footer.
  const runAfterFix = await evaluate(`document.querySelector('[data-testid="pdf-tools-run"]')?.dataset.enabled ?? null`);
  const whyAfterFix = await evaluate(whyText);
  await shotsAll('organise-attachments');
  await escapeOrganise();
  check(
    'INT-16 a file with attachments: Split says "Attachments in the document\'s list are not carried."; Organise pages says they are kept once a page is removed (not before)',
    typeof attachSplitNote === 'string' && attachSplitNote.includes("Attachments in the document's list are not carried.") &&
      !keptBefore && keptLine === "Attachments in the document's list are kept when pages are removed.",
    { attachSplitNote, keptBefore, keptLine },
  );
  check(
    'INT-17 Organise pages: Run unavailable at first, a click on it says why in the footer; once a page is removed Run is available and the old reason is gone',
    runAtOpen === 'false' && typeof whyAtOpen === 'string' && whyAtOpen.startsWith('Nothing to do yet') && runAfterFix === 'true' && whyAfterFix === '',
    { runAtOpen, whyAtOpen, runAfterFix, whyAfterFix },
  );

  if (PACKAGED_APP) skip('INT-18 the shared key guard leaves Organise pages\' own keys working', 'a packaged app has no entry script to send key events from the main process');
  else {
  // INT-18: the frame's key guard leaves a dialog's own keys alone: Organise pages' Alt+Right moves the chosen page
  // and Ctrl+Z undoes it (keys from the main process, the focus on the page).
  await openTool('organise-pages');
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-organise-tile-1"]'))`, WORK_MS, 'the Organise pages tiles');
  const organiseSummary = `document.querySelector('[data-testid="pdf-tools-organise-summary"]')?.innerText.trim() ?? null`;
  await click(byTestId('pdf-tools-organise-tile-1'));
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-organise-tile-1"]').focus(), true)`);
  const summaryBefore = await evaluate(organiseSummary);
  const ownHash = await evaluate('location.hash');
  await keysFromMain([{ keyCode: 'Right', modifiers: ['alt'] }]);
  const summaryMoved = await waitFor(`(() => { const t = ${organiseSummary}; return t && t !== ${q(summaryBefore)} ? t : null; })()`, UI_MS);
  await keysFromMain([{ keyCode: 'Z', modifiers: ['control'] }]);
  const summaryUndone = await waitFor(`(() => { const t = ${organiseSummary}; return t === ${q(summaryBefore)} ? t : null; })()`, UI_MS);
  const ownAfter = await evaluate(`({ dialog: Boolean(document.querySelector('[data-testid="pdf-tools-dialog"]')), hash: location.hash })`);
  await escapeOrganise();
  check(
    "INT-18 the shared key guard leaves Organise pages' own keys working: Alt+Right moves the chosen page, Ctrl+Z undoes it, and the application does not act",
    typeof summaryMoved === 'string' && /moved/i.test(summaryMoved) && summaryUndone === summaryBefore && ownAfter.dialog && ownAfter.hash === ownHash,
    { summaryBefore, summaryMoved, summaryUndone, ownAfter },
  );
  }

  const logs = await pdfToolsLogs();
  const splitLog = logs.find((l) => String(l.details).includes(split.file?.name ?? '\u0000'));
  const deleteLog = logs.find((l) => String(l.details).includes(deleted.file?.name ?? '\u0000'));
  const meta = (l) => (l ? (typeof l.metadata === 'string' ? JSON.parse(l.metadata) : l.metadata) : null);
  check(
    'INT-3 Split pages 2-3 and Delete page 3 of the bookmarked file: the bytes carry the bookmarks of the pages kept (a left-out parent goes, its child moves up), and the records say "; some bookmarks not carried"',
    splitOutcome === 'closed' &&
      deleteOutcome === 'closed' &&
      same(splitOutline, [[0, 'Section 1.1', 0, 'Bookmarked p2'], [0, 'Chapter 2', 1, 'Bookmarked p3']]) &&
      same(deletedOutline, [[0, 'Chapter 1', 0, 'Bookmarked p1'], [1, 'Section 1.1', 1, 'Bookmarked p2'], [0, 'Chapter 3', 2, 'Bookmarked p4']]) &&
      splitNote.includes('Bookmarks of pages that are left out are not carried.') &&
      String(splitLog?.details).includes('Split pages 2-3; some bookmarks not carried') &&
      String(deleteLog?.details).includes('Deleted page 3; some bookmarks not carried') &&
      meta(splitLog)?.bookmarksDropped === true &&
      meta(deleteLog)?.bookmarksDropped === true,
    { splitOutcome, deleteOutcome, splitOutline, deletedOutline, splitNote, splitLog: splitLog?.details, deleteLog: deleteLog?.details },
  );
}

/**
 * UX-GAP (T-048): a click on a shown page or on a row's thumbnail opens the viewer (T1-11), while Split's
 * chosen pages and Delete pages keep a click for choosing and a running tool keeps the viewer closed (and
 * says why); the order inside Images to PDF (T2-6); Page numbers' refusal says "Nothing was added."; the
 * Rotate wording. Mouse clicks and keys are real input events (CDP).
 */
/**
 * QA-FIX (user QA of 15 November 2026): what a copy still carries is said in the run's message and on the
 * row (A); a file with no bookmarks is read quickly and never said to have bookmarks that "could not be
 * read" (B); a file that only restricts copying is not "password-protected", and a result made from an
 * unlocked file is not either (E); no tooltip pops up over the success message (F); a long name keeps its
 * end (G).
 */
async function scenarioQaFix() {
  step('QA-FIX: carried content, bookmarks of a long file, protection wording, focus after a run, long names');
  const already = (await rows()).length;
  await addFromComputer([FILES.carrying, FILES.restricted, FILES.longName, FILES.many, FILES.two]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${already + 5} && ${INTAKE_IDLE}`, WORK_MS, 'the QA-FIX files');
  const list = await rows();
  const [carrying, restricted, longName, many, two] = [FILES.carrying, FILES.restricted, FILES.longName, FILES.many, FILES.two].map((name) => list.filter((r) => r.name === name).pop());
  const toastText = () => evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText.replace(/\\s+/g, ' ')).join(' | ')`);
  const closeDialog = async () => {
    await press('Escape');
    await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the dialog to close');
  };

  // A: Page numbers on the draft: the message and the row say what the copy still carries.
  await selectOnly([carrying.id]);
  let before = await unitIds();
  const numbered = await runTool('page-numbers');
  const made = numbered === 'closed' ? await newUnit(before) : null;
  const message = await toastText();
  const tag = made ? await evaluate(`document.querySelector('[data-testid="pdf-tools-row"][data-row-id="${made.id}"] [data-testid="pdf-tools-file-carried"]')?.innerText.trim() ?? null`) : null;
  // F: the focus is back on the tool's button, and no tooltip sits over the message.
  await sleep(800);
  const afterRun = await evaluate(`({ focus: document.activeElement?.dataset?.testid ?? null, tooltips: [...document.querySelectorAll('[role="tooltip"]')].map((t) => t.innerText.trim()).filter(Boolean) })`);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('qa-carried-result');
  check(
    'QA-A the result of a draft with a comment, an attachment, a title and an author says so in one sentence, in the message and on its row',
    numbered === 'closed' && message.includes('This copy still carries 1 comment, 1 attachment and its title and author.') && tag === 'Still carries 1 comment, 1 attachment and its title and author',
    { numbered, message, tag },
  );
  check('QA-F after the run the focus is back on the tool button and no tooltip pops up over the success message', afterRun.focus === 'pdf-tools-tool-page-numbers' && afterRun.tooltips.length === 0, afterRun);

  // A: a result that carries nothing says nothing.
  await selectOnly([two.id]);
  before = await unitIds();
  const plain = await runTool('page-numbers');
  const plainMade = plain === 'closed' ? await newUnit(before) : null;
  const plainMessage = await toastText();
  const plainTag = plainMade ? await evaluate(`Boolean(document.querySelector('[data-testid="pdf-tools-row"][data-row-id="${plainMade.id}"] [data-testid="pdf-tools-file-carried"]'))`) : null;
  check('QA-A2 a result that carries nothing gets no such line, in the message or on its row', plain === 'closed' && !/still carr/i.test(plainMessage) && plainTag === false, { plain, plainMessage, plainTag });

  // E: restrictions, not a password; a result is never "password-protected".
  const restrictedTag = restricted.text;
  await selectOnly([restricted.id]);
  await openTool('split');
  const restrictedNotice = await evaluate(`document.querySelector('[data-testid="pdf-tools-protection-notice"]')?.innerText.replace(/\\s+/g, ' ') ?? null`);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('qa-restricted-split');
  await closeDialog();
  check(
    'QA-E1 a file that opens without a password but restricts copying is shown as "Restrictions removed", and Split says it has restrictions the result will not have, never "password-protected"',
    restrictedTag.includes('Restrictions removed') &&
      typeof restrictedNotice === 'string' &&
      restrictedNotice.includes('has restrictions (for example on copying or printing). The result will not have them.') &&
      !/password-protected/.test(restrictedNotice),
    { restrictedTag, restrictedNotice },
  );
  await selectOnly([restricted.id, two.id]);
  before = await unitIds();
  const merged = await runTool('merge');
  const mergedRow = merged === 'closed' ? await newUnit(before) : null;
  let laterNotice = 'not opened';
  if (mergedRow) {
    await selectOnly([mergedRow.id]);
    await openTool('page-numbers');
    laterNotice = await evaluate(`document.querySelector('[data-testid="pdf-tools-protection-notice"]')?.innerText ?? null`);
    await closeDialog();
  }
  check(
    'QA-E2 a result made from that file has no protection tag and later dialogs do not call it "password-protected" or restricted',
    merged === 'closed' && mergedRow && !/Protection removed|Restrictions removed|Unlocked/.test(mergedRow.text) && laterNotice === null,
    { merged, mergedRow: mergedRow?.text, laterNotice },
  );

  // G: the 144-character name keeps its end, in the default result name and on screen.
  await selectOnly([longName.id]);
  await openTool('split');
  const splitName = await evaluate(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value ?? null`);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('qa-long-name-split');
  await closeDialog();
  const rowName = await evaluate(`(() => { const row = document.querySelector('[data-testid="pdf-tools-row"][data-row-id="${longName.id}"]'); const named = row?.querySelector('[title]'); return named ? { title: named.getAttribute('title'), text: named.innerText.replace(/\\s+/g, ' ') } : null; })()`);
  check(
    'QA-G a long name keeps its end: the default Split name is cut in the middle (at most 120 characters, ending "final copy v3 revised_pages_1-2.pdf"), and the row keeps the end in view with the whole name as its title',
    typeof splitName === 'string' && splitName.length <= 120 && splitName.endsWith('final copy v3 revised_pages_1-2.pdf') && splitName.startsWith('Synthetic M-s Gamma Traders') &&
      rowName?.title === FILES.longName && rowName.text === FILES.longName,
    { splitName, length: splitName?.length, rowName },
  );

  // B: a 300-page file without bookmarks: read quickly; never "could not be read".
  await selectOnly([many.id]);
  const opened = Date.now();
  await openTool('bookmarks');
  const states = [];
  let emptyAt = null;
  for (let i = 0; i < 120; i++) {
    const s = await evaluate(`({ error: document.querySelector('[data-testid="pdf-tools-bookmarks-read-error"]')?.innerText.replace(/\\s+/g, ' ') ?? null, empty: Boolean(document.querySelector('[data-testid="pdf-tools-bookmarks-empty"]')), why: [...document.querySelectorAll('[data-testid="pdf-tools-dialog"] *')].some((e) => e.childElementCount === 0 && /could not be read/.test(e.textContent || '')) })`);
    states.push(s);
    if (s.empty || s.error) {
      if (s.empty) emptyAt = (Date.now() - opened) / 1000;
      break;
    }
    await sleep(500);
  }
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('qa-bookmarks-no-bookmarks');
  await closeDialog();
  note(`QA-B: the bookmarks of the 300-page file without bookmarks were read in ${emptyAt ?? '?'} s (machine load varies)`);
  check(
    'QA-B a 300-page file without bookmarks shows "no bookmarks yet" within a minute, and nothing on screen ever says the bookmarks "could not be read"',
    emptyAt !== null && emptyAt < 60 && states.every((s) => !s.error && !s.why),
    { emptyAt, last: states[states.length - 1], errors: states.filter((s) => s.error || s.why).length },
  );
}

async function scenarioUxGap() {
  step('UX-GAP: click to view, reorder in Images to PDF, Page numbers refusal, wording');
  const already = (await rows()).length;
  await addFromComputer([FILES.five, FILES.mixed, FILES.wide, FILES.tall]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${already + 4} && ${INTAKE_IDLE}`, WORK_MS, 'the four UX-GAP files');
  const list = await rows();
  const [five, mixed, wide, tall] = [FILES.five, FILES.mixed, FILES.wide, FILES.tall].map((name) => list.filter((r) => r.name === name).pop());
  const VIEWER = byTestId('pdf-tools-viewer');
  const viewerPage = `document.querySelector('[data-testid="pdf-tools-viewer"]') ? document.querySelector('[data-testid="pdf-tools-viewer-page-input"]')?.value ?? 'image' : null`;
  const viewers = () => evaluate(`document.querySelectorAll(${q(VIEWER)}).length`);
  const closeViewer = async () => {
    await press('Escape');
    await mustWaitFor(`!document.querySelector(${q(VIEWER)})`, UI_MS, 'the viewer to close');
  };
  const closeDialog = async () => {
    await press('Escape');
    await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the dialog to close');
  };

  // UX-5: the page panel of one PDF (pages only shown): click, double-click, Enter and the corner icon.
  await selectOnly([five.id]);
  const panel = `section[aria-label=${q(`Pages of ${FILES.five}`)}]`;
  const tile = (n) => `${panel} [data-page="${n}"]`;
  await mustWaitFor(`Boolean(document.querySelector(${q(tile(5))}))`, WORK_MS, 'the page panel of the 5-page file');
  const hint = await evaluate(`document.querySelector(${q(`${panel} [data-testid="pdf-tools-pages-hint"]`)})?.innerText.replace(/^·\\s*/, '').trim() ?? null`);
  await mouseClick(tile(2));
  const clicked = await waitFor(viewerPage, UI_MS);
  await sleep(300);
  const clickedViewers = await viewers();
  const turnHint = await evaluate(`document.querySelector('[data-testid="pdf-tools-viewer-turn-left"]')?.getAttribute('aria-label') ?? null`);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('ux-viewer-from-page-click');
  await closeViewer();
  const focusBack = await waitFor(`document.activeElement?.dataset.page === '2'`, UI_MS);
  await mouseClick(tile(4), 2);
  const doubled = await waitFor(viewerPage, UI_MS);
  await sleep(500);
  const doubledViewers = await viewers();
  await closeViewer();
  await evaluate(`(document.querySelector(${q(tile(3))}).focus(), true)`);
  await press('Enter');
  const entered = await waitFor(viewerPage, UI_MS);
  await closeViewer();
  await mouseClick(`${panel} [data-testid="pdf-tools-page-expand-5"]`);
  const iconed = await waitFor(viewerPage, UI_MS);
  await closeViewer();
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('ux-page-panel-hint');
  check(
    'UX-5 page panel (T1-11): its line reads "Click a page to view it larger."; one mouse click on page 2 opens the viewer there (one viewer; Escape gives the focus back to the page); a double-click on page 4 opens one viewer; Enter on page 3 and the corner icon of page 5 still open it; the viewer\'s turn hint says "To rotate pages in the file, use Organise pages."',
    hint === 'Click a page to view it larger.' && clicked === '2' && clickedViewers === 1 && Boolean(focusBack) && doubled === '4' && doubledViewers === 1 && entered === '3' && iconed === '5' &&
      typeof turnHint === 'string' && turnHint.includes('To rotate pages in the file, use Organise pages.'),
    { hint, clicked, clickedViewers, focusBack: Boolean(focusBack), doubled, doubledViewers, entered, iconed, turnHint },
  );

  // UX-6: a row's thumbnail (mouse) opens that file's viewer at page 1; the focus comes back to the row's View button.
  const rowOf = (id) => `[data-testid="pdf-tools-row"][data-row-id=${q(id)}]`;
  await mouseClick(`${rowOf(mixed.id)} [data-testid="pdf-tools-row-thumb"]`);
  const rowViewer = await waitFor(`document.querySelector(${q(VIEWER)})?.innerText.includes(${q(FILES.mixed)}) && (${viewerPage})`, UI_MS);
  await closeViewer();
  const rowFocus = await waitFor(`document.activeElement?.dataset.action === 'view' && document.activeElement.closest('[data-testid="pdf-tools-row"]')?.dataset.rowId === ${q(mixed.id)}`, UI_MS);
  await mouseClick(`${rowOf(wide.id)} [data-testid="pdf-tools-row-thumb"]`);
  const imageViewer = await waitFor(`document.querySelector(${q(VIEWER)})?.dataset.fileKind === 'image' && document.querySelector(${q(VIEWER)}).innerText.includes(${q(FILES.wide)})`, UI_MS);
  await closeViewer();
  await press('Enter'); // the View button, focused again: the keyboard's way is unchanged
  const keyViewer = await waitFor(`document.querySelector(${q(VIEWER)})?.innerText.includes(${q(FILES.wide)})`, UI_MS);
  await closeViewer();
  check(
    'UX-6 file list (T1-11): one click on a row\'s thumbnail opens the viewer on that file (a PDF at page 1, an image as an image); Escape gives the focus to the row\'s View button, and Enter there opens it as before',
    rowViewer === '1' && Boolean(rowFocus) && Boolean(imageViewer) && Boolean(keyViewer),
    { rowViewer, rowFocus: Boolean(rowFocus), imageViewer: Boolean(imageViewer), keyViewer: Boolean(keyViewer) },
  );

  // UX-7: while Split runs (one part per page of 300, slowed), a click on a shown page does not open the viewer, and the panel says why.
  const count = (await rows()).length;
  await addFromComputer([FILES.many]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${count + 1} && ${INTAKE_IDLE}`, WORK_MS, 'the 300-page PDF');
  const longer = (await rows()).filter((r) => r.name === FILES.many).pop();
  await selectOnly([longer.id]);
  await openTool('split');
  const dialogPanel = `[data-testid="pdf-tools-dialog"] section[aria-label^="Pages of"]`;
  const dialogTile = (n) => `${dialogPanel} [data-page="${n}"]`;
  const dialogHint = `document.querySelector(${q(`${dialogPanel} [data-testid="pdf-tools-pages-hint"]`)})?.innerText.replace(/^·\\s*/, '').trim() ?? null`;
  await mustWaitFor(`Boolean(document.querySelector(${q(dialogTile(2))}))`, WORK_MS, 'the Split dialog\'s pages');
  await choose(byTestId('pdf-tools-split-mode-every'));
  await setInput(byTestId('pdf-tools-split-every'), '1');
  await mouseClick(dialogTile(2));
  const beforeRun = await waitFor(viewerPage, UI_MS);
  await closeViewer();
  const dialogKept = await exists(byTestId('pdf-tools-dialog'));
  const running = `document.querySelector('[data-testid="pdf-tools-progress"]')?.dataset.phase === 'running'`;
  // What the panel shows while the run goes on, recorded in the page (the run may end quickly).
  await evaluate(`(() => {
    const seen = (window.__uxRun = { running: false, hint: null, said: null, label: null, viewer: false, asked: 0 });
    const look = () => {
      if (!(${running})) return;
      seen.running = true;
      seen.hint = ${dialogHint} ?? seen.hint;
      const said = document.querySelector(${q(`${dialogPanel} [data-testid="pdf-tools-pages-why"]`)});
      if (said && said.innerText.trim()) seen.said = said.innerText.trim();
      seen.asked = Math.max(seen.asked, Number(said?.dataset.count || 0));
      seen.label = document.querySelector(${q(dialogTile(2))})?.getAttribute('aria-label') ?? seen.label;
      if (document.querySelector(${q(VIEWER)})) seen.viewer = true;
    };
    window.__uxRunObserver?.disconnect();
    window.__uxRunObserver = new MutationObserver(look);
    window.__uxRunObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    return true;
  })()`);
  await cdp('Emulation.setCPUThrottlingRate', { rate: 8 });
  await click(byTestId('pdf-tools-run'));
  const started = await waitFor(`${running} || Boolean(window.__uxRun?.running)`, UI_MS);
  // The panel follows the dialog's locked options a moment later (useInDisabledFieldset). The page's place is
  // taken then: the dialog's footer changes with the run and the dialog, centred, moves with it.
  if (started) await waitFor(`!(${running}) || ${dialogHint} === 'Wait for the tool to finish to view pages larger.'`, UI_MS);
  if (started && (await evaluate(running))) {
    await mouseClick(dialogTile(2));
    await sleep(300);
    if (process.env.PDF_TOOLS_TEST_SHOTS && (await evaluate(running))) {
      await shotAt('ux-split-running-why', 1280, 720, false);
      await shotAt('ux-split-running-why', 1280, 720, true);
    }
    if (await exists(byTestId('pdf-tools-cancel-run'))) {
      await click(byTestId('pdf-tools-cancel-run'));
      if (await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-stop-confirm"]'))`, UI_MS)) await click(byTestId('pdf-tools-stop-confirm-yes'));
    }
  }
  // Stopped (the dialog stays open) or finished (the dialog closes and the parts are added).
  const ended = await waitFor(`(!document.querySelector('[data-testid="pdf-tools-progress"]') && Boolean(document.querySelector('[data-testid="pdf-tools-run"]'))) || !document.querySelector('[data-testid="pdf-tools-dialog"]')`, WORK_MS);
  await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
  const during = await evaluate(`(window.__uxRunObserver?.disconnect(), window.__uxRun ?? null)`);
  // After the run a click opens the viewer again (in the same dialog, or a new one if the run had finished).
  if (!(await exists(byTestId('pdf-tools-dialog')))) {
    await selectOnly([longer.id]);
    await openTool('split');
    await mustWaitFor(`Boolean(document.querySelector(${q(dialogTile(3))}))`, WORK_MS, 'the Split dialog\'s pages again');
  }
  const hintAfter = await evaluate(dialogHint);
  await mouseClick(dialogTile(3));
  const afterRun = await waitFor(viewerPage, UI_MS);
  if (afterRun) await closeViewer();
  await closeDialog();
  const why = 'Wait for the tool to finish to view pages larger.';
  check(
    'UX-7 viewer availability (T1-11): in Split\'s page panel a click opens the viewer and Escape closes only the viewer; a real click while the run goes on opens nothing, and the panel\'s line, the page\'s name and the polite status say why ("Wait for the tool to finish to view pages larger."); after the run a click opens it again',
    beforeRun === '2' && dialogKept && Boolean(started) && Boolean(during) && during.running && !during.viewer && during.asked >= 1 && during.hint === why && during.said === why && String(during.label).endsWith(why) &&
      Boolean(ended) && hintAfter === 'Click a page to view it larger.' && afterRun === '3',
    { beforeRun, dialogKept, started: Boolean(started), during, ended: Boolean(ended), hintAfter, afterRun },
  );

  // UX-8: where pages are chosen (Split's "Chosen pages", Delete pages), a click still chooses and opens nothing.
  await selectOnly([five.id]);
  await openTool('split');
  await choose(byTestId('pdf-tools-split-mode-selected'));
  await mustWaitFor(`Boolean(document.querySelector(${q(`${dialogPanel} button[data-page="3"]`)}))`, UI_MS, 'Split\'s pages as toggles');
  await mouseClick(`${dialogPanel} button[data-page="3"]`);
  const splitChosen = await waitFor(`document.querySelector(${q(`${dialogPanel} button[data-page="3"]`)})?.getAttribute('aria-pressed') === 'true'`, UI_MS);
  await sleep(400);
  const splitViewer = await exists(VIEWER);
  const splitHint = await exists(`${dialogPanel} [data-testid="pdf-tools-pages-hint"]`);
  await closeDialog();
  await openTool('delete-pages');
  await mustWaitFor(`Boolean(document.querySelector(${q(`${dialogPanel} button[data-page="2"]`)}))`, UI_MS, 'Delete pages\' pages');
  await mouseClick(`${dialogPanel} button[data-page="2"]`);
  const deleteMarked = await waitFor(`document.querySelector(${q(`${dialogPanel} button[data-page="2"]`)})?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-testid="pdf-tools-page-list"]')?.value === '2'`, UI_MS);
  await sleep(400);
  const deleteViewer = await exists(VIEWER);
  await closeDialog();
  check(
    'UX-8 Split\'s chosen pages and Delete pages keep a click for choosing (UX audit C5.2): the page is chosen or marked, no viewer opens, and their panels have no "click to view" line',
    Boolean(splitChosen) && !splitViewer && !splitHint && Boolean(deleteMarked) && !deleteViewer,
    { splitChosen: Boolean(splitChosen), splitViewer, splitHint, deleteMarked: Boolean(deleteMarked), deleteViewer },
  );

  // UX-4: Images to PDF, the order changed inside the dialog (keyboard, then mouse), read back from the saved bytes.
  const IMAGES = 'pdf-tools-image-order';
  const imagesAre = (names) => `[...document.querySelectorAll('[data-testid="${IMAGES}"] [data-testid="pdf-tools-order-row"]')].map((r) => r.dataset.name).join('|') === ${q(names.join('|'))}`;
  const imageArrow = (name, action) => `[data-testid="${IMAGES}"] [data-testid="pdf-tools-order-row"][data-name=${q(name)}] [data-action="${action}"]`;
  const said = () => evaluate(`document.querySelector('[data-testid="pdf-tools-order-announce"]')?.innerText.trim() ?? ''`);
  let before = await unitIds();
  await selectOnly([wide.id, tall.id]);
  let imageOrder = null;
  const imagesOutcome = await runTool('images-to-pdf', async () => {
    const start = await evaluate(imagesAre([FILES.wide, FILES.tall]));
    await evaluate(`(document.querySelector(${q(imageArrow(FILES.wide, 'down'))}).focus(), true)`);
    await pressWith('ArrowDown', ALT);
    const byKey = await waitFor(imagesAre([FILES.tall, FILES.wide]), UI_MS);
    const saidKey = await said();
    const focusKey = await evaluate(`document.activeElement?.dataset.action ?? null`);
    await mouseClick(imageArrow(FILES.wide, 'up'));
    const byMouseUp = await waitFor(imagesAre([FILES.wide, FILES.tall]), UI_MS);
    await mouseClick(imageArrow(FILES.wide, 'down'));
    const byMouseDown = await waitFor(imagesAre([FILES.tall, FILES.wide]), UI_MS);
    // The name follows its default a render after the order changes.
    await waitFor(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value === 'Synthetic tall.pdf'`, UI_MS);
    const nameNow = await evaluate(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value ?? null`);
    if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('ux-images-order');
    imageOrder = { start, byKey: Boolean(byKey), saidKey, focusKey, byMouseUp: Boolean(byMouseUp), byMouseDown: Boolean(byMouseDown), nameNow };
  });
  const fromImages = await saveAndRead(await newUnit(before, 'row'));
  const shapes = (fromImages.pdf?.pages ?? []).map((p) => ({ portrait: p.height > p.width, images: p.images }));
  check(
    'UX-4 Images to PDF order inside the dialog (T2-6): Alt+Down moves the first image down (announced, focus kept on the row), the arrows by mouse move it back and down again, the default name follows the new first image, and the saved PDF has the tall image first, then the wide one',
    imagesOutcome === 'closed' && Boolean(imageOrder) && imageOrder.start === true && imageOrder.byKey && imageOrder.saidKey === `${FILES.wide} moved to position 2 of 2.` && imageOrder.focusKey === 'up' &&
      imageOrder.byMouseUp && imageOrder.byMouseDown && imageOrder.nameNow === 'Synthetic tall.pdf' &&
      same(shapes, [{ portrait: true, images: [{ width: IMAGE_SIZES.tall[0], height: IMAGE_SIZES.tall[1] }] }, { portrait: false, images: [{ width: IMAGE_SIZES.wide[0], height: IMAGE_SIZES.wide[1] }] }]),
    { imagesOutcome, imageOrder, shapes },
  );

  // UX-9: Page numbers: a header that fits page 1 but not the smaller page 2 is refused at Run, ending "Nothing was added."
  before = await unitIds();
  await selectOnly([mixed.id]);
  const organiseWords = await evaluate(`document.querySelector('[data-testid="pdf-tools-tool-organise-pages"]')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  await openTool('page-numbers');
  await click(byTestId('pdf-tools-number-texts'));
  await setInput(byTestId('pdf-tools-number-text-top-left'), 'Synthetic header that is far too wide for the small page');
  await mustWaitFor(`(() => { const b = document.querySelector('[data-testid="pdf-tools-run"]'); return Boolean(b) && !b.disabled && b.dataset.enabled !== 'false'; })()`, WORK_MS, 'Page numbers\' Run to be available');
  await click(byTestId('pdf-tools-run'));
  const refusal = await waitFor(`document.querySelector('[data-testid="pdf-tools-dialog-error"]')?.innerText.replace(/\\s+/g, ' ').trim() || null`, WORK_MS);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('ux-page-numbers-refusal');
  await closeDialog();
  const nothingAdded = same(await unitIds(), before);
  check(
    'UX-9 wording: Page numbers\' refusal at Run names the page and ends "Nothing was added." (nothing is added); Organise pages is described as "Reorder, rotate and remove the pages of one PDF."',
    typeof refusal === 'string' && /page 2\b/.test(refusal) && refusal.endsWith('Nothing was added.') && nothingAdded && organiseWords.includes('Reorder, rotate and remove the pages of one PDF.'),
    { refusal, nothingAdded, organiseWords },
  );
}

// ── INT2: the lanes' scenarios (Stop focus, Resize or crop pages, Fit to a size, Split into files, TIFF, viewer search) ──
/**
 * An arrow key held as a finger holds it: Radix moves the focus on a timer and checks a radio only while the key is
 * down. Held until the focus has moved (at most 2 s), then a moment longer: on a loaded machine a fixed 150 ms ended
 * before the focus moved, and the radio was focused but not checked.
 */
async function pressHeld(key) {
  const from = await focusedTestId();
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: KEY_CODES[key] });
  await waitFor(`(document.activeElement?.dataset?.testid ?? document.activeElement?.tagName ?? null) !== ${q(from)}`, 2000);
  await sleep(150);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: KEY_CODES[key] });
}
/** Presses Tab until the focused element's test id is `testId` (at most `max` presses). */
async function tabTo(testId, max = 30) {
  for (let i = 0; i < max; i++) {
    if ((await evaluate(`document.activeElement?.dataset?.testid ?? null`)) === testId) return true;
    await press('Tab');
    await sleep(120);
  }
  return (await evaluate(`document.activeElement?.dataset?.testid ?? null`)) === testId;
}
const focusedTestId = () => evaluate(`document.activeElement?.dataset?.testid ?? document.activeElement?.tagName ?? null`);
/** The focus is on `testId` and still there a moment later (focus is handed on after a question closes). */
async function focusSettlesOn(testId) {
  const arrived = await waitFor(`document.activeElement?.dataset?.testid === ${q(testId)}`, UI_MS);
  await sleep(600);
  return Boolean(arrived) && (await focusedTestId()) === testId;
}
const dialogText = (testId) => evaluate(`document.querySelector(${q(byTestId(testId))})?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
const runLabel = () => evaluate(`document.querySelector('[data-testid="pdf-tools-run"]')?.innerText.split('\\n')[0].trim() ?? null`);
const runWaits = () => evaluate(`document.querySelector('[data-testid="pdf-tools-run"]')?.getAttribute('aria-disabled') === 'true' || document.querySelector('[data-testid="pdf-tools-run"]')?.disabled === true`);
const toastsText = () => evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText.replace(/\\s+/g, ' ')).join(' | ')`);
async function addAndWait(names, what) {
  const already = (await rows()).length;
  await addFromComputer(names);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${already + names.length} && ${INTAKE_IDLE}`, WORK_MS, what);
  const list = await rows();
  return names.map((name) => list.filter((r) => r.name === name).pop());
}
/** FIX-B (REV-B S4): Organise pages asks before it throws changes away; these checks close it without keeping them. */
async function escapeOrganise() {
  await press('Escape');
  await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-organise-close-confirm"]')) || !document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS);
  if (await exists(byTestId('pdf-tools-organise-close-confirm'))) await click(byTestId('pdf-tools-organise-close-confirm-yes'));
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the Organise pages dialog to close');
}
async function closeToolDialog() {
  if (!(await exists(byTestId('pdf-tools-dialog')))) return;
  await press('Escape');
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the dialog to close');
}

/**
 * T-048: Redact, switched on. A two-page statement made here (the invented PAN on both pages, the invented e-mail
 * address on the first): the find, a typed word that is not in the file, the confirmation, a Searchable run whose
 * result is read back with pdf.js, the record, and a Stop during a run on a longer statement. No native window.
 */
async function scenarioRedact() {
  step('T-048: Redact');
  const RD = byTestId('pdf-tools-redact-dialog');
  const rd = (id) => byTestId(`pdf-tools-redact-${id}`);
  const text = (selector) => evaluate(`document.querySelector(${q(selector)})?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
  const openRedact = async (row) => {
    await selectOnly([row.id]);
    await mustWaitFor(`document.querySelector(${q(byTestId('pdf-tools-tool-redact'))})?.dataset.enabled === 'true'`, UI_MS, 'the Redact tool to be available');
    await click(byTestId('pdf-tools-tool-redact'));
    await mustWaitFor(`Boolean(document.querySelector(${q(RD)}))`, UI_MS, 'the Redact dialog');
    await mustWaitFor(`!document.querySelector(${q(rd('finding'))}) && Boolean(document.querySelector(${q(rd('list'))}))`, WORK_MS, 'the Redact find to end');
  };
  const runButton = () => evaluate(`(() => { const b = document.querySelector('[data-testid="pdf-tools-run"]'); return b ? { label: b.innerText.trim(), disabled: b.disabled } : null; })()`);
  // Which of the three (the PAN, the e-mail address, the typed word) these texts hold, spaces apart or not.
  const held = (list) => [REDACT_PAN, REDACT_EMAIL, REDACT_ABSENT_WORD].filter((v) => list.some((t) => String(t).includes(v) || String(t).replace(/\s+/g, '').includes(v.replace(/\s+/g, ''))));
  const [short, long] = await addAndWait([FILES.redactShort, FILES.redactLong], 'the two statements');
  const resultName = FILES.redactShort.replace(/\.pdf$/, '_redacted.pdf');

  // RD-1: the find.
  await openRedact(short);
  const opened = {
    title: await text(`${RD} header`),
    list: await text(rd('list')),
    run: await runButton(),
    searchable: await evaluate(`document.querySelector(${q(rd('output-searchable'))})?.dataset.state`),
    profile: await evaluate(`document.querySelector(${q(rd('profile'))})?.value`),
  };
  check(
    'RD-1 Redact opens on a two-page statement made here and its find lists the invented PAN (2 places) and e-mail address, both ticked: the button reads "Redact 3 areas"; Balanced and Searchable are chosen',
    Boolean(opened.title?.includes(FILES.redactShort)) && Boolean(opened.list?.includes(REDACT_PAN)) && Boolean(opened.list?.includes(REDACT_EMAIL)) && /2 places, /.test(opened.list || '') &&
      opened.run?.label === 'Redact 3 areas' && opened.run?.disabled === false && opened.searchable === 'checked' && opened.profile === 'balanced',
    opened,
  );

  // RD-2: a typed word that is in no page.
  await setInput(rd('term-input'), REDACT_ABSENT_WORD);
  await click(rd('term-add'));
  const notFound = await waitFor(`document.querySelector(${q(rd('not-found'))})?.innerText.trim()`, WORK_MS);
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-run"]')?.disabled === false`, WORK_MS, 'Redact to be available after the typed word was searched');
  const typed = { notFound, chip: await text(rd('term-not-found-0')), run: await runButton() };
  check(
    'RD-2 a typed word that is not in the file is said: "Not found: 1 typed word.", its chip marked "not found"; the areas stay 3 and Redact stays available',
    typed.notFound === 'Not found: 1 typed word.' && /not found/.test(typed.chip || '') && typed.run?.label === 'Redact 3 areas' && typed.run?.disabled === false,
    { ...typed, chip: typed.chip?.replace(REDACT_ABSENT_WORD, '<word>') },
  );

  // RD-3: the confirmation.
  await click(byTestId('pdf-tools-run'));
  await mustWaitFor(`Boolean(document.querySelector(${q(rd('confirm'))}))`, UI_MS, 'the confirmation');
  const confirm = { text: await text(rd('confirm')), notFound: await text(rd('confirm-not-found')) };
  check(
    'RD-3 the confirmation says what will happen before anything is made: "Check before redacting", pictures with the remaining words searchable at 200 dpi, the original unchanged, and "Not found: 1 typed word." again',
    Boolean(confirm.text?.includes('Check before redacting')) && /Black boxes; the pages become pictures with the remaining words searchable, at 200 dpi\./.test(confirm.text || '') &&
      Boolean(confirm.text?.includes('The original stays in the list, unchanged.')) && confirm.notFound === 'Not found: 1 typed word.',
    confirm,
  );

  // RD-4: the run; the result is added to the list.
  const before = await unitIds();
  await click(rd('confirm-redact'));
  const outcome = await waitFor(`(() => {
    if (!document.querySelector(${q(RD)})) return 'closed';
    if (document.querySelector(${q(rd('flatten'))})) return 'asked to flatten';
    const message = document.querySelector('[data-testid="pdf-tools-dialog-error"], [data-testid="pdf-tools-dialog-notice"]');
    return message ? message.innerText.replace(/\\s+/g, ' ') : '';
  })()`, 3 * WORK_MS);
  const message = await toastsText();
  const made = outcome === 'closed' ? await newUnit(before, 'row') : null;
  const names = (await rows()).map((r) => r.name);
  check(
    `RD-4 the Searchable run adds "${resultName}" to the list and says "3 areas removed on pages 1-2; those pages are now pictures with searchable text. The original stays in the list, unchanged."; the original is still in the list`,
    outcome === 'closed' && made?.name === resultName && message.includes(`Redacted: ${resultName}`) &&
      message.includes('3 areas removed on pages 1-2; those pages are now pictures with searchable text. The original stays in the list, unchanged.') && names.includes(FILES.redactShort),
    { outcome, name: made?.name, message },
  );

  // RD-5: the result, read with pdf.js and as bytes; the statement as it was made here, read the same way, holds both.
  const read = await saveAndRead(made);
  const source = await readPdf(fs.readFileSync(path.join(fixturesPath, FILES.redactShort)));
  const texts = pageTexts(read.pdf) || [];
  const inBytes = read.file ? [REDACT_PAN, REDACT_EMAIL].filter((v) => [Buffer.from(v, 'latin1'), Buffer.from(v, 'utf16le'), Buffer.from(v, 'utf16le').swap16()].some((n) => read.file.bytes.includes(n))) : null;
  check(
    'RD-5 the result read with pdf.js: 2 pages, each a picture, the PAN and the e-mail address in no page\'s text and not in the bytes; "Synthetic statement" and "Closing balance 12,345.00" still found on both pages (pdf.js reads both values in the statement as made)',
    read.pdf?.pageCount === 2 && read.pdf.pages.every((p) => p.images.length >= 1) && held(texts).length === 0 && same(inBytes, []) &&
      texts.every((t, i) => t.includes(`Synthetic statement p${i + 1}`) && t.includes('Closing balance 12,345.00')) &&
      same(held(pageTexts(source)), [REDACT_PAN, REDACT_EMAIL]),
    { pages: read.pdf?.pageCount, images: read.pdf?.pages.map((p) => p.images.length), left: held(texts).length, inBytes: inBytes?.length, kept: texts.map((t) => t.includes('Closing balance 12,345.00')), sourceHolds: held(pageTexts(source)).length },
  );

  // RD-6: the Audit Trail record (written when the result was saved): counts and choices only.
  const log = await poll(async () => (await pdfToolsLogs()).find((l) => String(l.details).includes(`→ ${resultName} (`)) || null, UI_MS);
  const options = log ? JSON.parse(log.metadata).options : null;
  const sorted = (o) => (o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : null);
  const logsHold = held((await pdfToolsLogs()).map((l) => JSON.stringify(l)));
  const inDatabase = [REDACT_PAN, REDACT_EMAIL, REDACT_ABSENT_WORD].map((v) => findInDatabase(v).hits.length);
  check(
    'RD-6 the Audit Trail record of the run holds counts and choices only: "Redacted 3 areas on 2 pages (PAN 2, email 1); searchable, 200 dpi", the twelve options and nothing else; the PAN, the e-mail address and the typed word are in no PDF Tools entry and nowhere in the database',
    String(log?.details).startsWith(`Redacted 3 areas on 2 pages (PAN 2, email 1); searchable, 200 dpi → ${resultName} (`) &&
      same(sorted(options), sorted({ areas: 3, pagesRebuilt: 2, pagesRebuiltHidden: 0, mode: 'remove', replacement: 'token-default', output: 'searchable', dpi: 200, valuesLeftVisible: 0, textLayerCharsOmitted: 0, autoBoxesDropped: 0, bookmarksRemoved: 0, counts: 'PAN 2, email 1' })) &&
      logsHold.length === 0 && same(inDatabase, [0, 0, 0]),
    { details: log?.details, options, logsHold: logsHold.length, inDatabase },
  );

  // RD-7: Stop during a run (16 pages, the PAN on each) leaves no result.
  await evaluate(`(document.querySelectorAll('[data-sonner-toast] button[aria-label="Close toast"]').forEach((b) => b.click()), true)`);
  await openRedact(long);
  const longRun = await runButton();
  const beforeStop = await unitIds();
  await click(byTestId('pdf-tools-run'));
  await mustWaitFor(`Boolean(document.querySelector(${q(rd('confirm-redact'))}))`, UI_MS, 'the confirmation of the long statement');
  await click(rd('confirm-redact'));
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-progress"]')?.dataset.phase === 'running'`, UI_MS, 'the Redact run to start');
  await click(byTestId('pdf-tools-cancel-run'));
  const asked = await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-stop-confirm-yes"]'))`, UI_MS);
  if (asked) await click(byTestId('pdf-tools-stop-confirm-yes'));
  const stopped = await waitFor(`document.querySelector(${q(`${RD} [data-testid="pdf-tools-dialog-notice"]`)})?.innerText.replace(/\\s+/g, ' ').trim()`, WORK_MS);
  const afterStop = { run: await runButton(), units: await unitIds(), toasts: await toastsText() };
  await click(byTestId('pdf-tools-dialog-cancel'));
  const closed = await waitFor(`!document.querySelector(${q(RD)})`, UI_MS);
  const afterClose = await unitIds();
  check(
    'RD-7 Stop during a Redact run on a 16-page statement (asked first, then confirmed) says "Stopped. Nothing was added.": no result in the list, no "Redacted" message, Redact available again, and Cancel closes the dialog',
    longRun?.label === 'Redact 17 areas' && Boolean(asked) && stopped === 'Stopped. Nothing was added.' && same(afterStop.units, beforeStop) && same(afterClose, beforeStop) &&
      !afterStop.toasts.includes('Redacted:') && afterStop.run?.label === 'Redact 17 areas' && afterStop.run?.disabled === false && Boolean(closed),
    { longRun, asked: Boolean(asked), stopped, added: afterClose.length - beforeStop.length, toasts: afterStop.toasts, run: afterStop.run, closed: Boolean(closed) },
  );

  // RD-9: a group ticked by hand ticks its possible values too (owner, 16 November 2026); the profile's start is unchanged.
  const [letter] = await addAndWait([FILES.redactLetter], 'the letter');
  const NAMES = rd('group-names');
  const areasOf = (label) => Number((/Redact ([\d,]+) areas?/.exec(label || '') || [0, '0'])[1].replace(/,/g, ''));
  const groupState = async () => ({
    names: await evaluate(`document.querySelector(${q(NAMES)})?.dataset.state ?? null`),
    areas: areasOf((await runButton())?.label),
    ticked: await text(rd('ticked-count')),
  });
  const setGroup = async (on) => {
    await click(NAMES);
    await mustWaitFor(`document.querySelector(${q(NAMES)})?.dataset.state === ${q(on ? 'checked' : 'unchecked')}`, UI_MS, `the Names and addresses box to be ${on ? 'ticked' : 'unticked'}`);
    await sleep(300);
  };
  await openRedact(letter);
  const listed = await text(rd('list'));
  const start = await groupState();
  await setGroup(true);
  const tickedByHand = await groupState();
  await setGroup(false);
  const untickedByHand = await groupState();
  await click(byTestId('pdf-tools-dialog-cancel'));
  await mustWaitFor(`!document.querySelector(${q(RD)})`, UI_MS, 'the Redact dialog to close');
  await openRedact(letter);
  const fresh = await groupState();
  // Ticked again and run: the name and the address are gone from the result, the other words stay.
  await setGroup(true);
  const beforeLetter = await unitIds();
  await click(byTestId('pdf-tools-run'));
  await mustWaitFor(`Boolean(document.querySelector(${q(rd('confirm-redact'))}))`, UI_MS, "the letter's confirmation");
  await click(rd('confirm-redact'));
  const letterOutcome = await waitFor(`!document.querySelector(${q(RD)}) ? 'closed' : (document.querySelector('[data-testid="pdf-tools-dialog-error"]')?.innerText.replace(/\\s+/g, ' ') || '')`, 3 * WORK_MS);
  const letterMade = letterOutcome === 'closed' ? await newUnit(beforeLetter, 'row') : null;
  const letterRead = await saveAndRead(letterMade);
  if (process.env.PDF_TOOLS_TEST_SHOTS && letterRead.file) fs.writeFileSync(path.join(process.env.PDF_TOOLS_TEST_SHOTS, 'int-redact-names-result.pdf'), letterRead.file.bytes);
  const letterText = (pageTexts(letterRead.pdf) || []).join(' ');
  const pieces = [...REDACT_NAME.split(' '), 'Orchard', 'Residency', 'Baner', '411045', REDACT_PAN];
  const leftInLetter = pieces.filter((w) => letterText.includes(w));
  await evaluate(`(document.querySelectorAll('[data-sonner-toast] button[aria-label="Close toast"]').forEach((b) => b.click()), true)`);
  check(
    'RD-9 Balanced lists the labelled name and address as possible and leaves them unticked ("Names and addresses" unticked, 1 area); ticking the group by hand ticks them (3 areas), unticking it unticks them (1 area); a dialog opened afresh starts unticked again; run with the group ticked, the result holds neither the name nor the address, and keeps the other words',
    Boolean(listed?.includes(REDACT_NAME)) && Boolean(listed?.includes('Orchard Residency')) && /possible/.test(listed || '') &&
      start.names === 'unchecked' && start.areas === 1 && tickedByHand.names === 'checked' && tickedByHand.areas === 3 &&
      untickedByHand.names === 'unchecked' && untickedByHand.areas === 1 && fresh.names === 'unchecked' && fresh.areas === 1 &&
      letterOutcome === 'closed' && letterMade?.name === FILES.redactLetter.replace(/\.pdf$/, '_redacted.pdf') && leftInLetter.length === 0 &&
      letterText.includes('Synthetic letter p1') && letterText.includes('Closing balance 12,345.00'),
    { possible: /possible/.test(listed || ''), start, tickedByHand, untickedByHand, fresh, letterOutcome, made: letterMade?.name, left: leftInLetter.length, kept: letterText.includes('Closing balance 12,345.00') },
  );

  // RD-10: "Add a box", one button that is on while a box is being added, and two ways beside it (the mouse, the
  // keyboard); changing the way while it is on carries on at once in the other way, and a keyboard box the user has
  // moved or resized is never lost by that (it is added, as Enter adds it). Real mouse clicks and real keys.
  await openRedact(letter);
  const ADD = rd('add-box');
  const DRAG_HINT = 'Drag on the page to draw a box.';
  const KEYS_HINT = 'New box: arrow keys move it';
  const boxState = async () => {
    await sleep(300);
    return evaluate(`(() => {
      const dialog = document.querySelector(${q(RD)});
      const pressed = (id) => dialog.querySelector('[data-testid="pdf-tools-redact-' + id + '"]')?.getAttribute('aria-pressed') === 'true';
      const hints = [...dialog.querySelectorAll('[role="status"]')].map((p) => p.innerText);
      const place = (el) => [el.style.left, el.style.top, el.style.width, el.style.height].map((v) => Math.round(parseFloat(v) * 10) / 10);
      const waiting = dialog.querySelector('[data-testid="pdf-tools-redact-pending-box"]');
      return {
        on: pressed('add-box'), mouse: pressed('box-by-mouse'), keys: pressed('box-by-keys'),
        drag: hints.some((t) => t.includes(${q(DRAG_HINT)})), place: hints.some((t) => t.includes(${q(KEYS_HINT)})),
        waiting: Boolean(waiting), at: waiting ? place(waiting) : null,
        drawn: dialog.querySelectorAll('[data-testid^="pdf-tools-redact-delete-"]').length,
        boxes: [...dialog.querySelectorAll('[data-testid="pdf-tools-redact-surface"] > button:not([class*="rounded-"])')].map(place),
      };
    })()`);
  };
  const is = (st, on, way, hint, drawn) =>
    st.on === on && st.mouse === (way === 'mouse') && st.keys === (way === 'keys') && st.drag === (hint === 'drag') && st.place === (hint === 'place') && st.waiting === (hint === 'place') && st.drawn === drawn && st.boxes.length === drawn;
  const sameSpot = (p, r) => Boolean(p && r) && p.every((v, i) => Math.abs(v - r[i]) <= 1.5);
  const steps = {};
  const toolbar = {
    add: await text(ADD),
    buttons: await evaluate(`[...document.querySelectorAll(${q(`${RD} button`)})].map((b) => b.innerText.trim()).filter((t) => /^(Add a box|Draw boxes)$/.test(t))`),
    oldIds: await evaluate(`document.querySelectorAll('[data-testid="pdf-tools-redact-draw-mode"], [data-testid="pdf-tools-redact-draw"]').length`),
  };
  steps.start = await boxState();
  // Off: either icon only changes the choice.
  await mouseClick(rd('box-by-keys'));
  steps.keysWhileOff = await boxState();
  await mouseClick(rd('box-by-mouse'));
  steps.mouseWhileOff = await boxState();
  // The button, the mouse chosen: drawing on; a drag on an empty part of the page adds one box and the button stays on.
  await mouseClick(ADD);
  steps.onByMouse = await boxState();
  await screenshot('int-redact-add-box-on-mouse');
  const from = await evaluate(`(() => {
    const r = document.querySelector(${q(rd('surface'))}).getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    return { x: Math.round(r.left + r.width * 0.2), y: Math.round(Math.max(top + (bottom - top) * 0.8, r.top + r.height * 0.35)) };
  })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 6; k++) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + k * 20, y: from.y + k * 5, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + 120, y: from.y + 30, button: 'left', buttons: 0, clickCount: 1 });
  await waitFor(`document.querySelectorAll(${q(`${RD} [data-testid^="pdf-tools-redact-delete-"]`)}).length === 1`, UI_MS);
  steps.afterDrag = await boxState();
  // On: the keyboard icon shows the box to place at once. Not touched, the mouse icon drops it and goes on drawing.
  await mouseClick(rd('box-by-keys'));
  steps.keysWhileOn = await boxState();
  await screenshot('int-redact-add-box-on-keys');
  await mouseClick(rd('box-by-mouse'));
  steps.mouseDropsUntouched = await boxState();
  // Moved and resized with the keys, the box is placed: the keyboard icon leaves it where it is, and the mouse icon
  // adds it there (as Enter would) and goes on drawing. Undo takes it away again, like any drawn box.
  await mouseClick(rd('box-by-keys'));
  steps.keysAgain = await boxState();
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown']) await press(key);
  await pressWith('ArrowRight', ALT);
  steps.moved = await boxState();
  await mouseClick(rd('box-by-keys'));
  steps.keysIconKeepsPlace = await boxState();
  await mouseClick(rd('box-by-mouse'));
  steps.mouseKeepsPlaced = await boxState();
  await screenshot('int-redact-add-box-kept');
  await mouseClick(rd('undo'));
  steps.afterUndo = await boxState();
  // Enter always adds the waiting box (here one not touched), and the button goes off.
  await mouseClick(rd('box-by-keys'));
  steps.keysThird = await boxState();
  await press('Enter');
  await waitFor(`document.querySelectorAll(${q(`${RD} [data-testid^="pdf-tools-redact-delete-"]`)}).length === 2`, UI_MS);
  steps.afterEnter = await boxState();
  // Escape always drops it, not touched or placed; the button goes off and the dialog stays.
  await mouseClick(ADD);
  steps.onByKeys = await boxState();
  await press('Escape');
  steps.escapeUntouched = await boxState();
  await mouseClick(ADD);
  await pressWith('ArrowLeft', 8);
  steps.movedForEscape = await boxState();
  await press('Escape');
  steps.escapePlaced = await boxState();
  const openAfterEscape = await exists(RD);
  // The button pressed while on switches off: a box not touched is dropped, a placed one is added where it stands.
  await mouseClick(ADD);
  steps.onUntouched = await boxState();
  await mouseClick(ADD);
  steps.offDropsUntouched = await boxState();
  await mouseClick(ADD);
  await press('ArrowUp');
  await press('ArrowUp');
  steps.movedForOff = await boxState();
  await mouseClick(ADD);
  steps.offKeepsPlaced = await boxState();
  // The mouse again: the button switches drawing on and off.
  await mouseClick(rd('box-by-mouse'));
  steps.mouseWhileOffAgain = await boxState();
  await mouseClick(ADD);
  steps.onByMouseAgain = await boxState();
  await mouseClick(ADD);
  steps.offByButtonMouse = await boxState();
  const end = { boxes: await evaluate(`[...document.querySelectorAll(${q(`${RD} p`)})].map((p) => p.innerText.trim()).find((t) => t.startsWith('Boxes you drew')) ?? null`), run: await runButton() };
  const wanted = {
    start: [false, 'mouse', null, 0],
    keysWhileOff: [false, 'keys', null, 0],
    mouseWhileOff: [false, 'mouse', null, 0],
    onByMouse: [true, 'mouse', 'drag', 0],
    afterDrag: [true, 'mouse', 'drag', 1],
    keysWhileOn: [true, 'keys', 'place', 1],
    mouseDropsUntouched: [true, 'mouse', 'drag', 1],
    keysAgain: [true, 'keys', 'place', 1],
    moved: [true, 'keys', 'place', 1],
    keysIconKeepsPlace: [true, 'keys', 'place', 1],
    mouseKeepsPlaced: [true, 'mouse', 'drag', 2],
    afterUndo: [true, 'mouse', 'drag', 1],
    keysThird: [true, 'keys', 'place', 1],
    afterEnter: [false, 'keys', null, 2],
    onByKeys: [true, 'keys', 'place', 2],
    escapeUntouched: [false, 'keys', null, 2],
    movedForEscape: [true, 'keys', 'place', 2],
    escapePlaced: [false, 'keys', null, 2],
    onUntouched: [true, 'keys', 'place', 2],
    offDropsUntouched: [false, 'keys', null, 2],
    movedForOff: [true, 'keys', 'place', 2],
    offKeepsPlaced: [false, 'keys', null, 3],
    mouseWhileOffAgain: [false, 'mouse', null, 3],
    onByMouseAgain: [true, 'mouse', 'drag', 3],
    offByButtonMouse: [false, 'mouse', null, 3],
  };
  const wrong = Object.keys(wanted).filter((k) => !is(steps[k], ...wanted[k]));
  const together = Object.keys(steps).filter((k) => steps[k].drag && steps[k].place);
  // Where the boxes are: a new box appears in the same spot each time; the keys moved it; the keyboard icon left it
  // there; the box added by the mouse icon, and the one added by switching off, stand where they were moved to.
  const spots = {
    movedAway: !sameSpot(steps.moved.at, steps.keysAgain.at) && steps.moved.at?.[2] > steps.keysAgain.at?.[2],
    iconKeepsIt: sameSpot(steps.keysIconKeepsPlace.at, steps.moved.at),
    mouseAddsItThere: steps.mouseKeepsPlaced.boxes.some((r) => sameSpot(steps.moved.at, r)),
    undoTakesItAway: !steps.afterUndo.boxes.some((r) => sameSpot(steps.moved.at, r)),
    newBoxInTheMiddleAgain: sameSpot(steps.keysThird.at, steps.keysAgain.at),
    enterAddsItThere: steps.afterEnter.boxes.some((r) => sameSpot(steps.keysThird.at, r)),
    escapeMovedBoxGone: !sameSpot(steps.movedForEscape.at, steps.onByKeys.at) && !steps.escapePlaced.boxes.some((r) => sameSpot(steps.movedForEscape.at, r)),
    offAddsItThere: !sameSpot(steps.movedForOff.at, steps.onUntouched.at) && steps.offKeepsPlaced.boxes.some((r) => sameSpot(steps.movedForOff.at, r)),
  };
  const spotsWrong = Object.keys(spots).filter((k) => spots[k] !== true);
  check(
    'RD-10 the Redact toolbar has one "Add a box" button (no "Draw boxes") and two ways beside it, the mouse chosen to start with; off, either icon only changes the choice; the button starts in the chosen way and is on while drawing is on or a box waits; a real drag adds one box and the button stays on; on, the keyboard icon shows the box to place at once; a waiting box not touched is dropped by the mouse icon and by switching off, one moved or resized with the keys is added where it stands by both (and stays put when the keyboard icon is clicked), and Undo takes it away; Enter always adds the waiting box and Escape always drops it, the button going off; the two hints never show together ("Boxes you drew (3)")',
    toolbar.add === 'Add a box' && same(toolbar.buttons, ['Add a box']) && toolbar.oldIds === 0 && wrong.length === 0 && together.length === 0 && spotsWrong.length === 0 &&
      openAfterEscape === true && end.boxes === 'Boxes you drew (3)' && end.run?.label === 'Redact 4 areas',
    { toolbar, wrong, together, spotsWrong, steps: Object.fromEntries([...wrong, ...(spotsWrong.length ? ['keysAgain', 'moved', 'keysIconKeepsPlace', 'mouseKeepsPlaced', 'afterUndo', 'keysThird', 'afterEnter', 'movedForEscape', 'escapePlaced', 'movedForOff', 'offKeepsPlaced'] : [])].map((k) => [k, steps[k]])), openAfterEscape, end },
  );
  await click(byTestId('pdf-tools-dialog-cancel'));
  await waitFor(`!document.querySelector(${q(RD)})`, UI_MS);
}

/**
 * INT2 item 4: a confirmed Stop puts the focus on Run (the dialog stays) or, when Stop closes the dialog, on the
 * tool's button, and Chromium logs no "Blocked aria-hidden ..." (the shared frame used to focus Run while the
 * closing question still hid the dialog). Two tools, by mouse and by keyboard; the CPU slowed so the runs last.
 */
async function scenarioStopFocus() {
  step('INT2: focus after a confirmed Stop (PDF to images and Watermark; mouse and keyboard)');
  const [longer, many] = await addAndWait([FILES.longer, FILES.many], 'the long files');
  const running = `document.querySelector('[data-testid="pdf-tools-progress"]')?.dataset.phase === 'running'`;
  const asked = `Boolean(document.querySelector('[data-testid="pdf-tools-stop-confirm"]'))`;
  const idleInDialog = `Boolean(document.querySelector('[data-testid="pdf-tools-dialog"]')) && !document.querySelector('[data-testid="pdf-tools-progress"]') && !${asked} && Boolean(document.querySelector('[data-testid="pdf-tools-run"]'))`;
  // Chromium's console message, and the state it is about: the focus landing inside an aria-hidden part of the page.
  await evaluate(`(() => {
    if (window.__focusHidden) return true;
    window.__focusHidden = [];
    document.addEventListener('focusin', (event) => {
      const el = event.target;
      if (el instanceof Element && el.closest('[aria-hidden="true"]')) window.__focusHidden.push(el.dataset?.testid || el.tagName);
    }, true);
    return true;
  })()`);
  const consoleHidden = (from) => consoleMessages.slice(from).filter((m) => /aria-hidden/i.test(String(m.text))).map((m) => String(m.text).slice(0, 200));
  let hiddenFrom = 0;
  const ariaHidden = (from) => [...consoleHidden(from), ...(hiddenFocus.slice(hiddenFrom).map((t) => `focus inside aria-hidden: ${t}`))];
  let hiddenFocus = [];
  const markHidden = async () => {
    hiddenFocus = await evaluate('window.__focusHidden.slice()');
    hiddenFrom = hiddenFocus.length;
  };
  const readHidden = async () => {
    hiddenFocus = await evaluate('window.__focusHidden.slice()');
  };
  const tools = [
    { tool: 'pdf-to-images', row: longer, prepare: () => choose(byTestId('pdf-tools-image-dpi-300')) },
    { tool: 'watermark', row: many, prepare: async () => undefined },
  ];
  // Slowed so that each run lasts while Stop is reached; the confirmed Stop itself at full speed, so the run ends inside
  // the question's closing animation as it does on an ordinary machine (where the warning was seen).
  const slowed = () => cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
  const fullSpeed = () => cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
  await slowed();
  try {
    for (const { tool, row, prepare } of tools) {
      await selectOnly([row.id]);
      await openTool(tool);
      await prepare();
      // Mouse: Stop in the footer, then the question's Stop.
      let from = consoleMessages.length;
      await markHidden();
      await mouseClick(byTestId('pdf-tools-run'));
      const ran = await waitFor(running, WORK_MS);
      if (ran) await mouseClick(byTestId('pdf-tools-cancel-run'));
      const askedNow = Boolean(ran) && (await waitFor(asked, UI_MS));
      if (askedNow) await fullSpeed();
      if (askedNow) await mouseClick(byTestId('pdf-tools-stop-confirm-yes'));
      const stopped = Boolean(askedNow) && (await waitFor(idleInDialog, WORK_MS));
      const onRun = Boolean(stopped) && (await focusSettlesOn('pdf-tools-run'));
      await sleep(500);
      await slowed();
      await readHidden();
      check(
        `INT2-S1 ${tool}, by mouse: after a confirmed Stop the dialog stays, the focus settles on Run, and no "Blocked aria-hidden" is logged`,
        Boolean(ran && askedNow && stopped && onRun) && ariaHidden(from).length === 0,
        { ran: Boolean(ran), asked: Boolean(askedNow), stopped: Boolean(stopped), focus: await focusedTestId(), warnings: ariaHidden(from) },
      );
      // Keyboard: Enter on Run, Enter on the footer's Stop (asks), Tab to the question's Stop, Enter.
      from = consoleMessages.length;
      await markHidden();
      await evaluate(`(document.querySelector('[data-testid="pdf-tools-run"]').focus(), true)`);
      await press('Enter');
      const ran2 = await waitFor(`${running} && document.activeElement?.dataset.testid === 'pdf-tools-cancel-run'`, WORK_MS);
      if (ran2) await press('Enter');
      const asked2 = Boolean(ran2) && (await waitFor(asked, UI_MS));
      if (asked2) await sleep(300);
      const onYes = Boolean(asked2) && (await tabTo('pdf-tools-stop-confirm-yes', 3));
      if (onYes) await fullSpeed();
      if (onYes) await press('Enter');
      const stopped2 = onYes && (await waitFor(idleInDialog, WORK_MS));
      const onRun2 = Boolean(stopped2) && (await focusSettlesOn('pdf-tools-run'));
      await sleep(500);
      await slowed();
      await readHidden();
      check(
        `INT2-S2 ${tool}, by keyboard (Enter, Enter, Tab, Enter): the dialog stays, the focus settles on Run, and no "Blocked aria-hidden" is logged`,
        Boolean(ran2 && asked2 && onYes && stopped2 && onRun2) && ariaHidden(from).length === 0,
        { ran: Boolean(ran2), asked: Boolean(asked2), onYes, stopped: Boolean(stopped2), focus: await focusedTestId(), warnings: ariaHidden(from) },
      );
      // Keyboard, closing: Escape during the run asks; Tab to Stop, Enter: the dialog closes, the focus is on the tool's button.
      from = consoleMessages.length;
      await markHidden();
      await evaluate(`(document.querySelector('[data-testid="pdf-tools-run"]').focus(), true)`);
      await press('Enter');
      const ran3 = await waitFor(running, WORK_MS);
      if (ran3) await press('Escape');
      const asked3 = Boolean(ran3) && (await waitFor(asked, UI_MS));
      if (asked3) await sleep(300);
      const onYes3 = Boolean(asked3) && (await tabTo('pdf-tools-stop-confirm-yes', 3));
      if (onYes3) await fullSpeed();
      if (onYes3) await press('Enter');
      const closed = onYes3 && (await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, WORK_MS));
      const onTool = Boolean(closed) && (await focusSettlesOn(`pdf-tools-tool-${tool}`));
      await sleep(500);
      await slowed();
      await readHidden();
      check(
        `INT2-S3 ${tool}, by keyboard (Escape, Tab, Enter): the dialog closes, the focus settles on its tool button, and no "Blocked aria-hidden" is logged`,
        Boolean(ran3 && asked3 && onYes3 && closed && onTool) && ariaHidden(from).length === 0,
        { ran: Boolean(ran3), asked: Boolean(asked3), onYes: onYes3, closed: Boolean(closed), focus: await focusedTestId(), warnings: ariaHidden(from) },
      );
      await closeToolDialog();
    }
  } finally {
    await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}

/** INT2 (lane RC): Resize or crop pages opens ready on the common case; its results read back from the bytes; keys move the crop frame. */
async function scenarioResizeCrop() {
  step('INT2 (lane RC): Resize or crop pages');
  const [bundle] = await addAndWait([FILES.bundle], 'the bundle');
  const PB = (id) => byTestId(`pdf-tools-page-box-${id}`);
  const technical = () => evaluate(`(document.querySelector('[data-testid="pdf-tools-dialog"]')?.innerText || '').match(/MediaBox|CropBox|TrimBox|UserUnit|\\bpt\\b|\\bpoints?\\b|content stream/gi) || []`);

  // RC2: by mouse; opens on "Make every page one size", A4, ready to run.
  await selectOnly([bundle.id]);
  await openTool('resize-crop');
  // The caption gains "→ the new size" once the preview of the result is drawn.
  await waitFor(`/^This page: .+ → /.test(document.querySelector(${q(PB('preview-caption'))})?.innerText || '') && Boolean(document.querySelector(${q(PB('same-note'))}))`, WORK_MS);
  const opened = await evaluate(`({
    run: document.querySelector('[data-testid="pdf-tools-run"]')?.innerText.trim(),
    same: document.querySelector(${q(PB('same-note'))})?.innerText.replace(/\\s+/g, ' ').trim(),
    paper: document.querySelector(${q(PB('paper'))})?.innerText.trim(),
    summary: document.querySelector(${q(PB('more-summary'))})?.innerText.trim(),
    caption: document.querySelector(${q(PB('preview-caption'))})?.innerText.trim(),
    directionShown: Boolean(document.querySelector(${q(PB('direction-keep'))})?.getClientRects().length),
    marginShown: Boolean(document.querySelector(${q(PB('margin-none'))})?.getClientRects().length),
  })`);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('rc-resize-opened');
  await click(PB('more'));
  await sleep(400);
  const wordsResize = await technical();
  check(
    'RC2 Resize or crop pages opens ready to run on the common case: "Resize 3 pages to A4", "1 page is already A4 and stays as it is.", one size drop-down "A4 (210 × 297 mm)", direction and margin folded under More options with their values, the page size before and after; no technical words (fold open)',
    opened.run === 'Resize 3 pages to A4' && opened.same === '1 page is already A4 and stays as it is.' && opened.paper === 'A4 (210 × 297 mm)' &&
      opened.summary === 'Each page keeps its direction, small pages keep their size, no margin' && !opened.directionShown && !opened.marginShown &&
      opened.caption === 'This page: 216 × 279 mm (Letter) → 210 × 297 mm (A4)' && wordsResize.length === 0,
    { opened, wordsResize },
  );
  // RC4: Run; the result's pages from its bytes, the record, the message.
  let before = await unitIds();
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-run"]')?.getAttribute('aria-disabled') !== 'true'`, UI_MS, 'Run to be available');
  await click(byTestId('pdf-tools-run'));
  const outcome = await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]') && 'closed'`, WORK_MS);
  const message = await toastsText();
  const made = outcome ? await newUnit(before, 'row') : null;
  const read = await saveAndRead(made);
  let shown = null;
  if (read.file) {
    const doc = await PDFDocument.load(read.file.bytes, { updateMetadata: false });
    shown = doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      const r = [width, height].map((v) => Math.round(v * 100) / 100);
      return p.getRotation().angle % 180 ? [r[1], r[0]] : r;
    });
  }
  const log = (await pdfToolsLogs()).find((l) => String(l.details).includes('→ Synthetic bundle_resized.pdf ('));
  const options = log ? JSON.parse(log.metadata).options : null;
  check(
    'RC4 Run makes "Synthetic bundle_resized.pdf": every page A4 as shown (the turned page A4 landscape), each keeping its text; the message says what changed; the record holds counts and choices only',
    outcome === 'closed' && made?.name === 'Synthetic bundle_resized.pdf' &&
      same(shown, [[595.28, 841.89], [841.89, 595.28], [595.28, 841.89], [595.28, 841.89]]) && same(pageTexts(read.pdf), ['Bundle p1', 'Bundle p2', 'Bundle p3', 'Bundle p4']) &&
      message.includes('3 pages resized to A4; 1 was already A4 and is unchanged.') &&
      String(log?.details).startsWith('Resized 3 pages to A4, 1 already A4 → Synthetic bundle_resized.pdf') &&
      same(options, { mode: 'resize', size: 'A4', direction: 'keep', enlarge: false, marginMm: 0, pages: 'all', changed: 3, unchanged: 1, pagesToCheck: 0 }),
    { outcome, name: made?.name, shown, texts: pageTexts(read.pdf), message, details: log?.details, options },
  );

  // RC5: keyboard only; "Crop the pages", then the frame's left edge with the arrow keys.
  await selectOnly([bundle.id]);
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-tool-resize-crop"]').focus(), true)`);
  await press('Enter');
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-dialog"][data-tool="resize-crop"]'))`, UI_MS, 'the Resize or crop pages dialog');
  await sleep(500);
  const onMode = await tabTo('pdf-tools-page-box-mode-resize', 25);
  if (onMode) await pressHeld('ArrowRight');
  const cropOn = onMode && (await waitFor(`document.querySelector(${q(PB('mode-crop'))})?.dataset.state === 'checked' && Boolean(document.querySelector(${q(PB('hidden-note'))}))`, UI_MS));
  const hiddenNote = cropOn ? await dialogText('pdf-tools-page-box-hidden-note') : null;
  await waitFor(`Boolean(document.querySelector(${q(PB('frame-left'))}))`, WORK_MS);
  const onLeft = await tabTo('pdf-tools-page-box-frame-left', 40);
  if (onLeft) for (let i = 0; i < 5; i++) await press('ArrowRight');
  await sleep(500);
  const edge = await evaluate(`({ left: document.querySelector(${q(PB('edge-left'))})?.value, said: document.querySelector(${q(PB('preview-announce'))})?.innerText.trim(), value: document.activeElement?.getAttribute('aria-valuetext') })`);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('rc-crop-keyboard');
  check(
    'RC5 keyboard only: Tab reaches the choice, an arrow key chooses "Crop the pages", which says trimming hides and does not remove; Tab reaches the frame\'s left edge and five Right arrows trim 15 mm, announced "Left edge: 15 mm trimmed"',
    Boolean(onMode && cropOn) && /Trimmed parts are hidden, not removed\. To remove content, use Redact\./.test(hiddenNote || '') && onLeft && edge.left === '15' && edge.said === 'Left edge: 15 mm trimmed' && edge.value === '15 mm trimmed',
    { onMode, cropOn: Boolean(cropOn), hiddenNote, onLeft, edge },
  );
  // RC8: a trim that leaves too little of a page is refused at the boxes, naming the page; Run waits.
  await setInput(PB('edge-left'), '150');
  const refusal = await waitFor(`document.querySelector('[data-testid="pdf-tools-dialog"] [data-testid="pdf-tools-field-error"]')?.innerText.trim()`, UI_MS);
  const waits = await runWaits();
  await click(PB('more'));
  await sleep(400);
  const wordsCrop = await technical();
  check(
    'RC8 150 mm off the left leaves less than 10 mm of the receipt: refused at the boxes, naming page 4, and Run waits; no technical words in crop mode (fold open)',
    /leaves less than 10 mm of page 4\. Use smaller values\./.test(refusal || '') && waits && wordsCrop.length === 0,
    { refusal, waits, wordsCrop },
  );
  await closeToolDialog();
}

/** INT2 (lane CT): Compress's levels as before, and "Fit to a size": four quick picks and one box, a typed size checked, a run to 1 MB read back, a file already under. */
async function scenarioFitToSize() {
  step('INT2 (lane CT): Compress, Fit to a size');
  const [scans, two] = await addAndWait([FILES.scans, FILES.two], 'the files to compress');
  const scanSize = fs.statSync(path.join(fixturesPath, FILES.scans)).size;
  const pick = [10, 5, 2, 1].find((mb) => mb * 1e6 < scanSize) ?? 1;
  const nameValue = () => evaluate(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value ?? null`);
  await selectOnly([scans.id]);
  await openTool('compress');
  const levels = await evaluate(`({ text: document.querySelector('[data-testid="pdf-tools-dialog"]').innerText, balanced: document.querySelector('[data-testid="pdf-tools-level-recommended"]')?.dataset.state, fit: Boolean(document.querySelector('[data-testid="pdf-tools-level-fit"]')) })`);
  const levelName = await nameValue();
  const levelRun = await runLabel();
  check(
    'CT1 Compress opens with the three levels as before, Balanced chosen, and "Fit to a size" beside them; Run "Compress"; the name says the level; no "dpi" on screen',
    /Light: best quality/.test(levels.text) && /Balanced/.test(levels.text) && /Strong: smallest file/.test(levels.text) && levels.balanced === 'checked' && levels.fit && levelRun === 'Compress' &&
      levelName === 'Synthetic scans_compressed_balanced.pdf' && !/\bdpi\b/i.test(levels.text),
    { balanced: levels.balanced, fit: levels.fit, levelRun, levelName, dpi: /\bdpi\b/i.test(levels.text) },
  );
  await mouseClick(byTestId('pdf-tools-level-fit'));
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-fit-size-value"]'))`, UI_MS, 'the size line');
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('ct-fit-opened');
  const fit = await evaluate(`({
    on: [1, 2, 5, 10].filter((mb) => document.querySelector('[data-testid="pdf-tools-fit-size-' + mb + '"]')?.dataset.state === 'on'),
    buttons: document.querySelectorAll('[data-testid="pdf-tools-fit"] button').length,
    inputs: document.querySelectorAll('[data-testid="pdf-tools-fit"] input').length,
    text: document.querySelector('[data-testid="pdf-tools-fit"]').innerText,
    note: document.querySelector('[data-testid="pdf-tools-fit-note"]')?.innerText.trim(),
  })`);
  const fitRun = await runLabel();
  const fitName = await nameValue();
  check(
    `CT2 "Fit to a size" shows four quick picks and one box, the largest pick under the file chosen (${pick} MB), Run "Compress to fit ${pick} MB", the name says the size, one plain sentence, no technical words`,
    same(fit.on, [pick]) && fit.buttons === 4 && fit.inputs === 1 && fitRun === `Compress to fit ${pick} MB` && fitName === `Synthetic scans_compressed_${pick}MB.pdf` &&
      fit.note === 'How small a file can go depends on its images; that is known only by trying.' && !/dpi|quality|pass|bytes/i.test(fit.text),
    { fit, fitRun, fitName, pick },
  );
  await setInput(byTestId('pdf-tools-fit-size-value'), '1,5');
  const bad = await waitFor(`(() => { const box = document.querySelector('[data-testid="pdf-tools-fit-size-value"]'); const said = document.querySelector('[data-testid="pdf-tools-dialog"] [data-testid="pdf-tools-field-error"]'); return box?.getAttribute('aria-invalid') === 'true' && said ? { role: said.getAttribute('role'), text: said.innerText.trim() } : null; })()`, UI_MS);
  const waits = await runWaits();
  await mouseClick(byTestId('pdf-tools-run'));
  const why = await waitFor(`(document.querySelector('[data-testid="pdf-tools-dialog-why"]')?.innerText || '').includes('Enter a size in MB') && document.querySelector('[data-testid="pdf-tools-dialog-why"]').innerText.trim()`, UI_MS);
  check(
    'CT3 a size it cannot read ("1,5") is marked invalid and said in an alert; Run waits, and a click on it says why and starts nothing',
    bad?.role === 'alert' && bad.text === 'Enter a size in MB, such as 5 or 1.5.' && waits && Boolean(why) && !(await exists(byTestId('pdf-tools-progress'))),
    { bad, waits, why },
  );
  await mouseClick(byTestId('pdf-tools-fit-size-1'));
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-run"]')?.innerText.trim() === 'Compress to fit 1 MB'`, UI_MS, 'Run for 1 MB');
  const before = await unitIds();
  await mouseClick(byTestId('pdf-tools-run'));
  const outcome = await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]') && 'closed'`, WORK_MS);
  const message = await toastsText();
  const made = outcome ? await newUnit(before, 'row') : null;
  const read = await saveAndRead(made);
  const log = (await pdfToolsLogs()).find((l) => String(l.details).includes('→ Synthetic scans_compressed_1MB.pdf ('));
  const options = log ? JSON.parse(log.metadata).options : null;
  check(
    'CT4 a run to fit 1 MB: the result (read back) is at most 1,000,000 bytes, still 2 pages; the message says "under your 1 MB"; the record holds the target and the size reached',
    outcome === 'closed' && made?.name === 'Synthetic scans_compressed_1MB.pdf' && read.file && read.file.bytes.length <= 1_000_000 && read.pdf.pageCount === 2 &&
      /under your 1 MB/.test(message) && options?.targetBytes === 1_000_000 && options.fitsTarget === true && options.reachedBytes === read.file.bytes.length,
    { outcome, name: made?.name, size: read.file?.bytes.length, message, options },
  );
  await selectOnly([two.id]);
  await openTool('compress');
  await mouseClick(byTestId('pdf-tools-level-fit'));
  const under = await waitFor(`document.querySelector('[data-testid="pdf-tools-fit-note"]')?.innerText.trim()`, UI_MS);
  check(
    'CT5 a file already under the size is told so before any run ("This file is already under 1 MB (…); choose a level to make it smaller anyway.") and Run waits',
    /^This file is already under 1 MB \(.+\); choose a level to make it smaller anyway\.$/.test(under || '') && (await runWaits()),
    under,
  );
  await closeToolDialog();
}

/** INT2 (lane SPLIT): "A separate file for each range" and "At bookmarks"; the one-file case as before. Every file read back. */
async function scenarioSplitFiles() {
  step('INT2 (lane SPLIT): Split into several files');
  const [five, ledger, marked] = await addAndWait([FILES.five, FILES.ledger, FILES.ledgerMarked], 'the Split files');
  const STEM = 'Synthetic ledger 320';
  const planNames = () => evaluate(`[...document.querySelectorAll('[data-testid="pdf-tools-split-plan-item"]')].map((li) => [li.querySelector('span').innerText, li.querySelectorAll('span')[1].innerText])`);
  const pageList = byTestId('pdf-tools-page-list');
  const typeList = async (text) => {
    await evaluate(`(() => { const el = document.querySelector(${q(pageList)}); el.focus(); el.select(); return true; })()`);
    await cdp('Input.insertText', { text });
    await mustWaitFor(`document.querySelector(${q(pageList)})?.value === ${q(text)}`, UI_MS, 'the page list to read the text typed');
  };
  const runAndWait = async () => {
    await mouseClick(byTestId('pdf-tools-run'));
    return waitFor(`(() => { const d = document.querySelector('[data-testid="pdf-tools-dialog"]'); if (!d) return 'closed'; const m = d.querySelector('[data-testid="pdf-tools-dialog-error"], [data-testid="pdf-tools-dialog-notice"]'); return m ? m.innerText.replace(/\\s+/g, ' ') : ''; })()`, WORK_MS);
  };
  const readGroup = async (unit, withOutline = false) => {
    const parts = [];
    if (!unit?.groupId) return parts;
    await selectGroup(unit.groupId);
    for (const f of await saveSelected(unit.count)) parts.push({ name: f.name, bytes: f.bytes, pdf: await readPdf(f.bytes), outline: withOutline ? await pdfOutline(f.bytes) : null });
    return parts;
  };
  const first = (p) => p.pdf.pages[0].text;
  const last = (p) => p.pdf.pages[p.pdf.pageCount - 1].text;

  // S1, S2: a file without bookmarks: the three choices of before; one file with the chosen pages, a click still chooses.
  await selectOnly([five.id]);
  await openTool('split');
  const cards = await evaluate(`[...document.querySelectorAll('[data-testid^="pdf-tools-split-mode-"]')].map((e) => e.dataset.testid)`);
  check('S1 a file without bookmarks shows the three choices of before and no "At bookmarks"', same(cards, ['pdf-tools-split-mode-range', 'pdf-tools-split-mode-every', 'pdf-tools-split-mode-selected']), cards);
  await mouseClick(byTestId('pdf-tools-split-mode-selected'));
  await mustWaitFor(`document.querySelector(${q(byTestId('pdf-tools-split-mode-selected'))})?.dataset.state === 'checked'`, UI_MS, 'Chosen pages');
  await typeList('1-2, 5');
  await mouseClick('[data-testid="pdf-tools-dialog"] button[data-page="3"]');
  const toggled = await waitFor(`document.querySelector(${q(pageList)})?.value === '1-3, 5'`, UI_MS);
  const boxOff = await evaluate(`document.querySelector(${q(byTestId('pdf-tools-split-separate'))})?.dataset.state`);
  const oneLabel = await runLabel();
  const noPlan = !(await exists(byTestId('pdf-tools-split-plan')));
  let before = await unitIds();
  const one = await runAndWait();
  const oneRow = one === 'closed' ? await newUnit(before, 'row') : null;
  const oneRead = await saveAndRead(oneRow);
  check(
    'S2 one file with the chosen pages works as before: a click on page 3 adds it ("1-3, 5"), the box is unticked, Run "Split", no list; the result holds pages 1, 2, 3 and 5',
    Boolean(toggled) && boxOff === 'unchecked' && oneLabel === 'Split' && noPlan && one === 'closed' && /^Synthetic five pages_selected_pages( \(\d+\))?\.pdf$/.test(oneRow?.name || '') && same(pageTexts(oneRead.pdf), ['Five p1', 'Five p2', 'Five p3', 'Five p5']),
    { toggled: Boolean(toggled), boxOff, oneLabel, noPlan, one, row: oneRow?.name, texts: pageTexts(oneRead.pdf) },
  );

  // S3 to S6: a separate file for each range, the box by keyboard.
  await selectOnly([ledger.id]);
  await openTool('split');
  await mouseClick(byTestId('pdf-tools-split-mode-selected'));
  await typeList('1-32, 65-96');
  await press('Tab');
  const onBox = await focusedTestId();
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  const ticked = await waitFor(`document.querySelector(${q(byTestId('pdf-tools-split-separate'))})?.dataset.state === 'checked' && Boolean(document.querySelector(${q(byTestId('pdf-tools-split-plan'))}))`, UI_MS);
  const plan2 = await planNames();
  const heading2 = await evaluate(`document.querySelector(${q(byTestId('pdf-tools-split-plan'))})?.querySelector('p')?.innerText`);
  const notes2 = await dialogText('pdf-tools-split-notes');
  const label2 = await runLabel();
  const chosen2 = await dialogText('pdf-tools-pages-chosen');
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('split-separate-files');
  check(
    'S3 keyboard: Tab from the page list reaches "A separate file for each range" and Space ticks it; "This makes 2 files:" with names and pages, the gaps in one sentence, Run "Split into 2 files"',
    onBox === 'pdf-tools-split-separate' && Boolean(ticked) && heading2 === 'This makes 2 files:' && same(plan2, [[`${STEM}_pages_1-32.pdf`, 'pages 1–32'], [`${STEM}_pages_65-96.pdf`, 'pages 65–96']]) &&
      notes2 === 'Pages 33–64 and 97–320 are in no file.' && label2 === 'Split into 2 files' && chosen2 === '2 files',
    { onBox, ticked: Boolean(ticked), heading2, plan2, notes2, label2, chosen2 },
  );
  await mouseClick('[data-testid="pdf-tools-dialog"] [role="button"][data-page="40"]');
  const viewer = await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-viewer"]'))`, UI_MS);
  await press('Escape');
  await waitFor(`!document.querySelector('[data-testid="pdf-tools-viewer"]')`, UI_MS);
  const textAfter = await evaluate(`document.querySelector(${q(pageList)})?.value`);
  check('S4 here a click on a page opens it larger and leaves the ranges as typed; Escape closes only the viewer', Boolean(viewer) && textAfter === '1-32, 65-96' && (await exists(byTestId('pdf-tools-dialog'))), { viewer: Boolean(viewer), textAfter });
  before = await unitIds();
  const two = await runAndWait();
  const group2 = two === 'closed' ? await newUnit(before, 'group') : null;
  const parts2 = await readGroup(group2);
  check(
    'S5 Run makes two files of 32 pages, ledger pages 1-32 and 65-96, named by their ranges',
    two === 'closed' && group2?.count === 2 && same(parts2.map((p) => p.name), [`${STEM}_pages_1-32.pdf`, `${STEM}_pages_65-96.pdf`]) &&
      parts2.every((p) => p.pdf.pageCount === 32) && first(parts2[0]) === 'Ledger p1' && last(parts2[0]) === 'Ledger p32' && first(parts2[1]) === 'Ledger p65' && last(parts2[1]) === 'Ledger p96',
    { two, group: group2?.count, names: parts2.map((p) => p.name) },
  );
  const log2 = (await pdfToolsLogs()).find((l) => String(l.details).includes(`${STEM}_pages_65-96.pdf`));
  check('S6 each file has its own record: "Split pages 65-96 (part 2 of 2)", with its source', String(log2?.details).startsWith(`Split pages 65-96 (part 2 of 2) → ${STEM}_pages_65-96.pdf (32 pages`) && String(log2?.details).includes(`Sources: ${FILES.ledger} [computer]`), log2?.details);

  // S7 to S11: overlaps, the limit, a long list folded, ten parts, Stop.
  await selectOnly([ledger.id]);
  await openTool('split');
  await mouseClick(byTestId('pdf-tools-split-mode-selected'));
  await mouseClick(byTestId('pdf-tools-split-separate'));
  await typeList('1-40, 30-50');
  const notes3 = await dialogText('pdf-tools-split-notes');
  await typeList(Array.from({ length: 501 }, (_, i) => String((i % 320) + 1)).join(', '));
  const capError = await waitFor(`document.querySelector('[data-testid="pdf-tools-dialog"] [data-testid="pdf-tools-field-error"]')?.innerText`, UI_MS);
  const capWaits = await runWaits();
  await typeList('32-1');
  const backwards = await waitFor(`document.querySelector('[data-testid="pdf-tools-dialog"] [data-testid="pdf-tools-field-error"]')?.innerText`, UI_MS);
  const tenText = Array.from({ length: 10 }, (_, k) => `${32 * k + 1}-${32 * k + 32}`).join(', ');
  await typeList(tenText);
  const folded = (await planNames()).length;
  const moreText = await dialogText('pdf-tools-split-plan-more');
  await mouseClick(byTestId('pdf-tools-split-plan-more'));
  await waitFor(`document.querySelectorAll('[data-testid="pdf-tools-split-plan-item"]').length === 10`, UI_MS);
  const unfolded = (await planNames()).length;
  const lessText = await dialogText('pdf-tools-split-plan-more');
  check('S7 overlapping ranges and gaps are said in one sentence each, without blocking', notes3 === 'Pages 51–320 are in no file. Pages 30–40 are in more than one file.', notes3);
  check('S8 501 ranges are refused in one sentence and Run waits; a backwards range uses the page list\'s words', capError === 'These ranges would make 501 files; Split makes at most 500 at a time.' && capWaits && backwards === '"32-1" is backwards: the first page must not be after the last', { capError, capWaits, backwards });
  check('S9 ten files: the list shows five and "Show all 10 files"; a click shows all ten and "Show fewer"', folded === 5 && moreText === 'Show all 10 files' && unfolded === 10 && lessText === 'Show fewer', { folded, moreText, unfolded, lessText });
  before = await unitIds();
  const ten = await runAndWait();
  const group3 = ten === 'closed' ? await newUnit(before, 'group') : null;
  const parts3 = await readGroup(group3);
  check(
    'S10 320 pages into 10 files of 32: each file\'s first and last page are the right ledger pages',
    ten === 'closed' && parts3.length === 10 && parts3.every((p, k) => p.pdf.pageCount === 32 && first(p) === `Ledger p${32 * k + 1}` && last(p) === `Ledger p${32 * k + 32}`),
    { ten, files: parts3.length },
  );
  await selectOnly([ledger.id]);
  await openTool('split');
  await mouseClick(byTestId('pdf-tools-split-mode-selected'));
  await mouseClick(byTestId('pdf-tools-split-separate'));
  await typeList(tenText);
  before = await unitIds();
  await cdp('Emulation.setCPUThrottlingRate', { rate: 6 });
  let stopped = null;
  let midway = false;
  try {
    await mouseClick(byTestId('pdf-tools-run'));
    midway = Boolean(await waitFor(`/part [2-9] of 10/.test(document.querySelector('[data-testid="pdf-tools-progress"]')?.innerText || '')`, WORK_MS));
    await mouseClick(byTestId('pdf-tools-cancel-run'));
    await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-stop-confirm-yes"]'))`, UI_MS, 'the Stop question');
    await mouseClick(byTestId('pdf-tools-stop-confirm-yes'));
    stopped = await waitFor(`document.querySelector('[data-testid="pdf-tools-dialog-notice"]')?.innerText.replace(/\\s+/g, ' ')`, WORK_MS);
  } finally {
    await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  check('S11 Stop during the ten files (asked first) ends with "Stopped. Nothing was added." and the list unchanged', midway && /Stopped\. Nothing was added\./.test(stopped || '') && same(await unitIds(), before), { midway, stopped });
  await closeToolDialog();

  // S12 to S15: at bookmarks, by keyboard.
  await selectOnly([marked.id]);
  await openTool('split');
  const bmCard = await waitFor(`document.querySelector(${q(byTestId('pdf-tools-split-mode-bookmarks'))})?.disabled === false`, WORK_MS);
  await evaluate(`(document.querySelector(${q(byTestId('pdf-tools-split-mode-range'))}).focus(), true)`);
  const walked = [];
  for (const next of ['every', 'selected', 'bookmarks']) {
    await pressHeld('ArrowRight');
    walked.push(Boolean(await waitFor(`document.querySelector(${q(byTestId(`pdf-tools-split-mode-${next}`))})?.dataset.state === 'checked'`, UI_MS)));
  }
  await waitFor(`document.querySelectorAll('[data-testid="pdf-tools-split-plan-item"]').length === 5`, WORK_MS);
  await mouseClick(byTestId('pdf-tools-split-plan-more'));
  await waitFor(`document.querySelectorAll('[data-testid="pdf-tools-split-plan-item"]').length === 10`, UI_MS);
  const plan4 = await planNames();
  const notes4 = await dialogText('pdf-tools-split-notes');
  const label4 = await runLabel();
  const chosen4 = await dialogText('pdf-tools-pages-chosen');
  const marks4 = await evaluate(`[...document.querySelectorAll('[data-testid="pdf-tools-dialog"] li')].filter((li) => li.querySelector('span.font-semibold')).map((li) => Number(li.querySelector('[data-page]')?.dataset.page))`);
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('split-at-bookmarks');
  const bmStem = 'Synthetic ledger 320 sections';
  const expected = ['Sales & Receivables', 'Purchases_ Payables', 'Bank_Cash', 'करदाता विवरण', 'Notes', 'Notes', 'Fixed assets', 'Payroll_', 'Taxes _GST_', 'Closing _entries_'].map((t, k) => `${bmStem}_${String(k + 1).padStart(2, '0')}_${t}.pdf`);
  check(
    'S12 "At bookmarks" is offered for the file with bookmarks and chosen with the arrow keys; it lists ten files named in page order from the titles (cleaned, Hindi kept, the two "Notes" apart) with their pages, says where pages 1-2 go, and marks where each file starts',
    Boolean(bmCard) && walked.every(Boolean) && same(plan4.map((p) => p[0]), expected) && plan4[0]?.[1] === 'pages 1–32' && plan4[9]?.[1] === 'pages 289–320' &&
      notes4 === 'Pages 1–2 come before the first bookmark and go into the first file.' && label4 === 'Split into 10 files' && chosen4 === 'Each file starts at a marked page' && same(marks4, [3, 33, 65, 97, 129, 161, 193]),
    { bmCard: Boolean(bmCard), walked, plan4, notes4, label4, chosen4, marks4 },
  );
  before = await unitIds();
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-run"]').focus(), true)`);
  await press('Enter');
  const bmOutcome = await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]') && 'closed'`, WORK_MS);
  const group6 = bmOutcome ? await newUnit(before, 'group') : null;
  const parts6 = await readGroup(group6, true);
  check(
    'S13 Enter on Run makes ten files of 32 pages: the first holds pages 1-32 (pages 1-2 before its bookmark), each other starts at its bookmark\'s page; names as listed',
    bmOutcome === 'closed' && group6?.count === 10 && same(parts6.map((p) => p.name), expected) && parts6.every((p, k) => p.pdf.pageCount === 32 && first(p) === `Ledger p${32 * k + 1}`),
    { bmOutcome, names: parts6.map((p) => p.name) },
  );
  check(
    'S14 each file carries its own bookmark and the one under it, opening the right pages (pdf.js), and none of the others',
    parts6.length === 10 && parts6.every((p, k) => p.outline.length === 2 && p.outline[0][1] === SECTIONS[k] && p.outline[0][2] === (k === 0 ? 2 : 0) && p.outline[1][0] === 1 && p.outline[1][1] === `${SECTIONS[k]} detail` && p.outline[1][3] === `Ledger p${sectionStart(k) + 6}`),
    parts6.map((p) => p.outline),
  );
  let links = null;
  if (parts6.length) {
    const doc = await PDFDocument.load(parts6[0].bytes, { updateMetadata: false });
    const refs = doc.getPages().map((p) => p.ref);
    const annots = doc.getPage(0).node.lookupMaybe(pdfLib.PDFName.of('Annots'), pdfLib.PDFArray);
    links = (annots ? annots.asArray() : []).map((entry) => {
      const dest = doc.context.lookup(entry, pdfLib.PDFDict).lookup(pdfLib.PDFName.of('Dest'));
      const at = dest instanceof pdfLib.PDFArray ? refs.indexOf(dest.get(0)) : -1;
      return at >= 0 ? at + 1 : null;
    });
  }
  check('S15 links: on page 1 the link to page 2 (same file) still opens page 2; the link to page 200 (another file) is gone', same(links, [2]), links);
}

/** A page drawn by pdf.js in Node into a canvas of exactly width x height pixels (RGBA). */
async function renderTo(bytes, pageNumber, width, height) {
  pdfjs ??= await import(pathToFileURL(path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const { context } = pdf.canvasFactory.create(width, height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    await page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
    return context.getImageData(0, 0, width, height).data;
  } finally {
    await pdf.destroy();
  }
}
/** The decoded samples of the first image a page draws (Flate). */
function imageSamples(doc, pageIndex) {
  const { PDFDict, PDFName, PDFRawStream } = pdfLib;
  const xobjects = doc.getPage(pageIndex).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  const stream = xobjects.values().map((ref) => doc.context.lookup(ref)).find((s) => s instanceof PDFRawStream);
  return zlib.inflateSync(Buffer.from(stream.contents));
}

/** INT2 (lane TIFF): TIFF files are accepted (picker, rows, viewer, Images to PDF, Merge, Save); CMYK and HEIC are refused in one sentence. */
async function scenarioTiff() {
  step('INT2 (lane TIFF): TIFF files');
  const accept = await evaluate(`document.querySelector('[data-testid="pdf-tools-file-input"]')?.getAttribute('accept') || ''`);
  check('T1 the file picker offers TIFF files (.tif, .tiff, image/tiff)', ['.tif', '.tiff', 'image/tiff'].every((a) => accept.split(',').includes(a)), accept);
  await evaluate(`(() => {
    window.__tiffProgress = [];
    // INT3: every message shown while the files are added, kept as it appears: a message lasts 4 s, and on a busy
    // machine the first ones can be gone by the time the last file is done (INT3's run: T6 failed with only the last
    // two messages on screen).
    window.__tiffToasts = [];
    const seen = new Set();
    window.__tiffObserver = new MutationObserver(() => {
      const el = document.querySelector('[aria-label="Adding files"]')?.parentElement;
      const text = el ? el.innerText.replace(/\\s+/g, ' ').trim() : '';
      if (text && !seen.has(text)) { seen.add(text); window.__tiffProgress.push(text); }
      for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
        const said = toast.innerText.replace(/\\s+/g, ' ').trim();
        if (said && !window.__tiffToasts.includes(said)) window.__tiffToasts.push(said);
      }
    });
    window.__tiffObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    return true;
  })()`);
  const tiffs = [FILES.tiffFax, FILES.tiffStatement, FILES.tiffPhoto, FILES.tiffStandard];
  const sourceHashes = [...tiffs, FILES.tiffCmyk].map((n) => sha256(fs.readFileSync(path.join(fixturesPath, n))));
  const already = (await rows()).length;
  await addFromComputer([...tiffs, FILES.tiffCmyk, FILES.heic]);
  await mustWaitFor(`document.querySelectorAll('[data-testid="pdf-tools-row"]').length >= ${already + 4} && ${INTAKE_IDLE}`, WORK_MS, 'four TIFF rows');
  await sleep(500);
  const progress = await evaluate('window.__tiffProgress');
  const shownToasts = await evaluate('window.__tiffToasts');
  await evaluate(`(window.__tiffObserver?.disconnect(), true)`);
  const list = (await rows()).filter((r) => tiffs.includes(r.name) || [FILES.tiffCmyk, FILES.heic].includes(r.name));
  const [fax, statement, photo, standard] = tiffs.map((n) => list.find((r) => r.name === n));
  const toasts = [...shownToasts, await toastsText()].join(' | ');
  check('T2 four rows, in order, each keeping its TIFF name; the CMYK TIFF and the HEIC photo are not added', same(list.map((r) => r.name), tiffs), list.map((r) => r.name));
  check(
    'T3 each row says it was converted, never "Image, PNG": the 3-page TIFF "Converted from a 3-page TIFF", the others "Converted from TIFF"',
    /Converted from a 3-page TIFF/.test(statement?.text || '') && [fax, photo, standard].every((r) => /Converted from TIFF/.test(r?.text || '') && !/Image, PNG/.test(r.text)),
    list.map((r) => r.text),
  );
  check('T4 the progress line named the page being converted', progress.some((p) => p.includes(`${FILES.tiffStatement} (page 2 of 3)`)), progress);
  check('T5 the CMYK TIFF was not added, with one sentence that says what to do', toasts.includes(`"${FILES.tiffCmyk}" was not added`) && toasts.includes('This TIFF is saved in a form PDF Tools cannot read; save it as PDF, JPG or PNG and add it again.'), toasts);
  check('T5b the HEIC photo was not added, with one sentence that says how to get a JPG from the phone', toasts.includes(`"${FILES.heic}" was not added`) && toasts.includes('iPhone photos (HEIC) cannot be used here; send the photo from the phone as a JPG, or set Camera > Formats > Most Compatible, and add it again.'), toasts);
  check('T6 the several-page TIFF was announced as converted to PDF', toasts.includes(`"${FILES.tiffStatement}" was converted to PDF`), toasts);

  const thumbsReady = await waitFor(`${JSON.stringify(list.map((r) => r.id))}.every((id) => { const img = document.querySelector('[data-testid="pdf-tools-row"][data-row-id="' + id + '"] img[data-testid="pdf-tools-thumb"]'); return img && img.complete && img.naturalWidth > 0; })`, WORK_MS);
  const thumbs = await evaluate(`Promise.all(${JSON.stringify(list.map((r) => r.id))}.map(async (id) => {
    const img = document.querySelector('[data-testid="pdf-tools-row"][data-row-id="' + id + '"] img[data-testid="pdf-tools-thumb"]');
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = (fx, fy) => Array.from(ctx.getImageData(Math.floor(fx * (c.width - 1)), Math.floor(fy * (c.height - 1)), 1, 1).data.slice(0, 3));
    const all = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < all.length; i += 4) if (all[i] + all[i + 1] + all[i + 2] < 3 * 235) ink++;
    return { left: px(0.2, 0.5), right: px(0.8, 0.5), ink };
  }))`);
  const [faxThumb, , photoThumb, standardThumb] = thumbs;
  check('T7 every TIFF row has its thumbnail drawn', Boolean(thumbsReady) && thumbs.every(Boolean), thumbs);
  check('T8 the colour TIFF\'s thumbnail is red on the left and blue on the right', photoThumb && photoThumb.left[0] > 180 && photoThumb.left[2] < 80 && photoThumb.right[2] > 180 && photoThumb.right[0] < 80, photoThumb);
  check('T9 the fax thumbnails show the text', faxThumb?.ink > 100 && standardThumb?.ink > 100, { faxThumb, standardThumb });
  if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('tiff-rows');

  // T10, T11: the viewer.
  await click(`[data-testid="pdf-tools-row"][data-row-id="${statement.id}"] [data-testid="pdf-tools-file-view"]`);
  await waitFor(`(document.querySelector('[data-testid="pdf-tools-viewer-canvas"]')?.width || 0) > 100`, WORK_MS);
  const canvasStats = `(() => {
    const src = document.querySelector('[data-testid="pdf-tools-viewer-canvas"]');
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d'); ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0, red = 0, blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] < 300) dark++;
      if (d[i] > 180 && d[i + 2] < 80) red++;
      if (d[i + 2] > 180 && d[i] < 80) blue++;
    }
    return { dark, red, blue, size: document.querySelector('[data-testid="pdf-tools-viewer-size"]')?.innerText };
  })()`;
  await sleep(1500);
  const page1 = await evaluate(canvasStats);
  for (const page of ['2', '3']) {
    await click(byTestId('pdf-tools-viewer-next'));
    await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-viewer-page-input"]')?.value === '${page}'`, UI_MS, `page ${page}`);
    await sleep(800);
  }
  await waitFor(`${canvasStats}.red > 1000`, WORK_MS);
  const page3 = await evaluate(canvasStats);
  check('T10 the viewer shows the converted TIFF: page 1 is A4 with the text, page 3 the colour picture in its own colours', /A4 portrait/.test(page1.size || '') && page1.dark > 1000 && page3.red > 1000 && page3.blue > 1000, { page1, page3 });
  await click(byTestId('pdf-tools-viewer-close'));
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-viewer"]')`, UI_MS, 'the viewer to close');
  await click(`[data-testid="pdf-tools-row"][data-row-id="${fax.id}"] [data-testid="pdf-tools-file-view"]`);
  const faxImage = await waitFor(`(() => { const i = document.querySelector('[data-testid="pdf-tools-viewer-image"]'); return i && i.complete && i.naturalWidth ? [i.naturalWidth, i.naturalHeight] : null; })()`, WORK_MS);
  check('T11 the one-page TIFF opens in the viewer as an image of its full size', same(faxImage, [1654, 2339]), faxImage);
  await click(byTestId('pdf-tools-viewer-close'));
  await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-viewer"]')`, UI_MS, 'the viewer to close');

  // T12, T13: Images to PDF only for the one-page TIFFs; the fax kept pixel for pixel.
  await selectOnly([statement.id]);
  const forStatement = await evaluate(`document.querySelector('[data-testid="pdf-tools-tool-images-to-pdf"]')?.dataset.enabled`);
  await selectOnly([fax.id, photo.id]);
  const forImages = await evaluate(`document.querySelector('[data-testid="pdf-tools-tool-images-to-pdf"]')?.dataset.enabled`);
  check('T12 Images to PDF: not for the several-page TIFF (a PDF), available for the one-page ones (images)', forStatement !== 'true' && forImages === 'true', { forStatement, forImages });
  let before = await unitIds();
  const imagesOutcome = await runTool('images-to-pdf');
  const imagesRead = await saveAndRead(imagesOutcome === 'closed' ? await newUnit(before, 'row') : null);
  let wrong = null;
  if (imagesRead.file) {
    const samples = imageSamples(await PDFDocument.load(imagesRead.file.bytes, { updateMetadata: false }), 0);
    const channels = samples.length === FAX_PICTURE.length ? 1 : 3;
    wrong = 0;
    for (let i = 0; i < FAX_PICTURE.length; i++) if (samples[i * channels] !== (FAX_PICTURE[i] ? 0 : 255)) wrong++;
  }
  check(
    'T13 Images to PDF of the two one-page TIFFs: 2 pages holding 1654 x 2339 and 640 x 480 pictures; the fax picture is its TIFF pixel for pixel',
    imagesOutcome === 'closed' && same(imagesRead.pdf?.pages.map((p) => p.images), [[{ width: 1654, height: 2339 }], [{ width: 640, height: 480 }]]) && wrong === 0 && imagesRead.pdf.producer === 'ICAI VERA',
    { imagesOutcome, images: imagesRead.pdf?.pages.map((p) => p.images), wrong },
  );

  // T14: Merge; the TIFF pages sized from their resolution; page 2 drawn by pdf.js is the fax.
  before = await unitIds();
  await selectOnly([fax.id, statement.id, photo.id]);
  const mergeOutcome = await runTool('merge');
  const mergedRead = await saveAndRead(mergeOutcome === 'closed' ? await newUnit(before, 'row') : null);
  const shapes = (mergedRead.pdf?.pages ?? []).map((p) => [Math.round(p.width * 100) / 100, Math.round(p.height * 100) / 100]);
  let page2Wrong = null;
  if (mergedRead.file) {
    const px = await renderTo(mergedRead.file.bytes, 2, 1654, 2339);
    page2Wrong = 0;
    for (let i = 0; i < FAX_PICTURE.length; i++) if ((px[i * 4] < 128 ? 1 : 0) !== FAX_PICTURE[i]) page2Wrong++;
  }
  check(
    'T14 Merge of the one-page TIFF, the 3-page TIFF and the photo TIFF: 5 pages; the TIFF pages sized from their resolution (A4 at 200 dpi, 1240 px at 150 dpi = 595.2 pt, 800 px at 100 dpi = 576 pt); page 2 drawn by pdf.js is the TIFF pixel for pixel',
    mergeOutcome === 'closed' && shapes.length === 5 && near(shapes[1][0], 595.44, 0.05) && near(shapes[1][1], 842.04, 0.05) && near(shapes[2][0], 595.2, 0.05) && near(shapes[3][0], 576, 0.05) && page2Wrong === 0,
    { mergeOutcome, shapes, page2Wrong },
  );

  // T15, T16: saving the converted row; the TIFF files themselves unchanged.
  await selectOnly([statement.id]);
  const [saved] = await saveSelected(1);
  const savedRead = saved ? await readPdf(saved.bytes) : null;
  const log = (await pdfToolsLogs()).find((l) => String(l.details).startsWith(`Copy of a file from the computer, converted from TIFF to PDF → ${FILES.tiffStatement}`));
  check('T15 saving the converted TIFF gives "Synthetic statement.pdf" (3 pages), and its record says it was converted from TIFF to PDF', saved?.name === 'Synthetic statement.pdf' && savedRead?.pageCount === 3 && Boolean(log), { name: saved?.name, pages: savedRead?.pageCount, details: log?.details });
  check('T16 the TIFF files on disk are unchanged', same([...tiffs, FILES.tiffCmyk].map((n) => sha256(fs.readFileSync(path.join(fixturesPath, n)))), sourceHashes));
}

/** INT2 (lane VS): Find in the viewer and go to page, with real keys from the main process; the Bookmarks strip's page box. */
async function scenarioViewerSearch() {
  step('INT2 (lane VS): find in the viewer, go to page; the Bookmarks strip');
  const PACKAGED = Boolean(PACKAGED_APP);
  if (PACKAGED) {
    skip('VS-1..VS-6 find and go to page with main-process keys', 'a packaged app has no entry script to send keys from the main process');
    return;
  }
  const [many] = await addAndWait([FILES.many], 'the 300-page file');
  const VIEWER = byTestId('pdf-tools-viewer');
  const S = (id) => byTestId(`pdf-tools-viewer-search${id ? `-${id}` : ''}`);
  const count = () => evaluate(`document.querySelector(${q(S('count'))})?.innerText ?? null`);
  await selectOnly([many.id]);
  // Opening the viewer is not what is checked here: the row is brought to the middle first (at the window's lower
  // edge a click once opened nothing on a loaded machine), and a second click is made if the first opened nothing.
  const viewButton = `[data-testid="pdf-tools-row"][data-row-id=${q(many.id)}] [data-testid="pdf-tools-file-view"]`;
  await evaluate(`(document.querySelector(${q(viewButton)})?.scrollIntoView({ block: 'center' }), true)`);
  await sleep(300);
  await mouseClick(viewButton);
  if (!(await waitFor(`Boolean(document.querySelector(${q(VIEWER)}))`, 5000))) {
    note('VS: the first click on View opened nothing; clicked again');
    await click(viewButton);
  }
  await mustWaitFor(`Boolean(document.querySelector(${q(VIEWER)}))`, UI_MS, 'the viewer');
  await evaluate(`(window.__vsCtrlF = 0, window.addEventListener('keydown', (e) => { if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) window.__vsCtrlF++; }), true)`);
  await keysFromMain([{ keyCode: 'F', modifiers: ['control'] }]);
  const boxOpen = await waitFor(`document.activeElement === document.querySelector(${q(S('input'))})`, UI_MS);
  check('VS-1 Ctrl + F opens the find box with the focus, and no listener behind the viewer sees the key', Boolean(boxOpen) && (await evaluate('window.__vsCtrlF')) === 0, { boxOpen: Boolean(boxOpen) });
  await cdp('Input.insertText', { text: 'Many' });
  const full = await waitFor(`/^\\d[\\d,]* of [\\d,]+$/.test(document.querySelector(${q(S('count'))})?.innerText || '') && document.querySelector(${q(S('count'))}).innerText`, WORK_MS);
  await keysFromMain([{ keyCode: 'Enter' }]);
  await sleep(500);
  const second = await count();
  await keysFromMain([{ keyCode: 'Enter', modifiers: ['shift'] }]);
  await sleep(500);
  const backAgain = await count();
  check('VS-2 every page\'s word is counted ("1 of 300"); Enter and Shift + Enter move to the next and previous match', full === '1 of 300' && second === '2 of 300' && backAgain === full, { full, second, backAgain });
  check('VS-3 the current match is drawn on the page', await exists('[data-testid="pdf-tools-viewer-search-hit"][data-current="true"]'));
  await keysFromMain([{ keyCode: 'Escape' }]);
  await sleep(500);
  check('VS-4 the first Escape closes only the find box', (await exists(VIEWER)) && !(await exists(S(''))));
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-viewer-page-input"]').focus(), true)`);
  await keysFromMain([{ keyCode: 'A', modifiers: ['control'] }]);
  await cdp('Input.insertText', { text: '212' });
  await keysFromMain([{ keyCode: 'Enter' }]);
  const at212 = await waitFor(`document.querySelector('[data-testid="pdf-tools-viewer-canvas"]')?.dataset.page === '212'`, WORK_MS);
  await keysFromMain([{ keyCode: 'A', modifiers: ['control'] }]);
  await cdp('Input.insertText', { text: '999' });
  await keysFromMain([{ keyCode: 'Enter' }]);
  const problem = await waitFor(`document.querySelector('[data-testid="pdf-tools-viewer-page-problem"]')?.innerText`, UI_MS);
  check('VS-5 go to page: 212 and Enter shows page 212; 999 says the range ("There is no page 999. Type a number from 1 to 300.")', Boolean(at212) && problem === 'There is no page 999. Type a number from 1 to 300.', { at212: Boolean(at212), problem });
  await keysFromMain([{ keyCode: 'Escape' }]);
  const viewerClosed = await waitFor(`!document.querySelector(${q(VIEWER)})`, UI_MS);
  await openTool('bookmarks');
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-bookmarks-page-input"]'))`, WORK_MS, 'the strip page box');
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-bookmarks-page-input"]').focus(), true)`);
  await keysFromMain([{ keyCode: 'A', modifiers: ['control'] }]);
  await cdp('Input.insertText', { text: '212' });
  await keysFromMain([{ keyCode: 'Enter' }]);
  const current = await waitFor(`document.querySelector('[data-testid="pdf-tools-bookmarks-page-212"]')?.getAttribute('aria-selected') === 'true'`, UI_MS);
  const addText = await evaluate(`document.querySelector('[data-testid="pdf-tools-bookmarks-add"]')?.innerText || ''`);
  check('VS-6 the viewer closes on the next Escape; in Bookmarks, 212 in the strip\'s page box makes page 212 current, and the Add button names it', Boolean(viewerClosed) && Boolean(current) && /212/.test(addText), { viewerClosed: Boolean(viewerClosed), current: Boolean(current), addText });
  await keysFromMain([{ keyCode: 'Escape' }]);
  await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS);
  await closeToolDialog();
}

/**
 * INT2 (owner, 15 November 2026): before an engagement change throws away results that are not saved, VERA asks
 * "Change engagement anyway? N results in PDF Tools are not saved and will be removed." (Log Out: "Log out
 * anyway? …"), in its own dialog since FIX-C (it was window.confirm), with Stay focused. Stay keeps the
 * engagement and the list (the header's switch, "View All Engagements", Log Out); with a tool dialog or the
 * viewer open the header cannot be reached; going on changes and clears the list; with nothing unsaved, no question.
 */
async function scenarioLeaveQuestion({ clientA, clientB }) {
  step('INT2: the question before an engagement change throws away unsaved results');
  // Whichever engagement the earlier scenarios left current ("here"), the other one is the one chosen ("there").
  const startsInA = await evaluate(`(document.querySelector('header')?.innerText || '').includes(${q(clientA.name)})`);
  const [here, there] = startsInA ? [clientA, clientB] : [clientB, clientA];
  const [two, three] = await addAndWait([FILES.two, FILES.three], 'two small files');
  await selectOnly([two.id, three.id]);
  const merged = await runTool('merge');
  const unsaved = Number(await waitFor(`Number(document.querySelector('[data-testid="pdf-tools-unsaved-count"]')?.dataset.count || 0)`, UI_MS));
  const question = (n, title = 'Change engagement anyway?') => `${title} ${n} ${n === 1 ? 'result in PDF Tools is' : 'results in PDF Tools are'} not saved and will be removed.`;
  // The question is the application's own dialog: read (title, sentence, Stay focused), then Stay or go on.
  const shown = [];
  let goOn = false;
  const headerMenu = async (trigger, item) => {
    await evaluate(`([...document.querySelectorAll('header button')].find((b) => b.innerText.includes(${q(trigger)})).focus(), true)`);
    await press('Enter');
    await mustWaitFor(`[...document.querySelectorAll('[role="menuitem"]')].some((m) => m.innerText.includes(${q(item)}))`, UI_MS, `"${item}" in the header menu`);
    await evaluate(`([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.innerText.includes(${q(item)})).click(), true)`);
    const asking = await waitFor(`(() => { const d = document.querySelector('[data-testid="engagement-leave-question"]'); return d ? { text: d.querySelector('h2').innerText + ' ' + d.querySelector('p').innerText, stay: document.activeElement?.dataset.testid === 'engagement-leave-stay' } : null; })()`, 3000);
    if (asking) {
      shown.push(asking.stay ? asking.text : `${asking.text} (Stay not focused)`);
      await click(byTestId(goOn ? 'engagement-leave-go' : 'engagement-leave-stay'));
      await waitFor(`!document.querySelector('[data-testid="engagement-leave-question"]')`, UI_MS);
    }
    await sleep(1000);
  };
  const where = () => evaluate(`({ here: (document.querySelector('header')?.innerText || '').includes(${q(here.name)}), there: (document.querySelector('header')?.innerText || '').includes(${q(there.name)}), hash: location.hash, rows: document.querySelectorAll('[data-testid="pdf-tools-row"]').length, root: Boolean(document.querySelector('[data-testid="pdf-tools-root"]')) })`);
  const rowsBefore = (await rows()).length;
  const answer = (value) => {
    goOn = value;
  };
  const asked = async () => shown.slice(from);
  let from = 0;
  const stays = [];
  for (const [trigger, item] of [[here.name, there.name], [here.name, 'View All Engagements'], [USER.fullName, 'Log Out']]) {
    from = shown.length;
    await headerMenu(trigger, item);
    await press('Escape'); // a menu left open
    stays.push({ item, asked: await asked(), ...(await where()) });
  }
  check(
    `LQ-1 with ${unsaved} results not saved, choosing the other engagement or "View All Engagements" asks "${question(unsaved)}", Log Out "${question(unsaved, 'Log out anyway?')}", with Stay focused; Stay keeps the engagement, PDF Tools and its list`,
    merged === 'closed' && unsaved > 0 && stays.every((s) => same(s.asked, [question(unsaved, s.item === 'Log Out' ? 'Log out anyway?' : undefined)]) && s.here && !s.there && s.root && s.rows === rowsBefore && s.hash.includes('audit-tools')),
    { merged, unsaved, startsInA, stays },
  );
  // A tool dialog or the viewer open: the header cannot be reached (modal), so nothing is asked and nothing breaks.
  // A click outside an idle tool dialog closes it, as it always has (only a running one stays); the viewer stays.
  from = shown.length;
  const headerButton = `[...document.querySelectorAll('header button')].find((b) => b.innerText.includes(${q(here.name)}))`;
  const clickHeader = async () => {
    const at = await evaluate(`(() => { const r = ${headerButton}.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(800);
    return evaluate(`({ menu: Boolean(document.querySelector('[role="menu"]')), dialog: Boolean(document.querySelector('[data-testid="pdf-tools-dialog"]')), viewer: Boolean(document.querySelector('[data-testid="pdf-tools-viewer"]')), question: Boolean(document.querySelector('[data-testid="engagement-leave-question"]')) })`);
  };
  await selectOnly([two.id]);
  await openTool('split');
  const withDialog = await clickHeader();
  await closeToolDialog();
  await click(`[data-testid="pdf-tools-row"][data-row-id="${two.id}"] [data-testid="pdf-tools-file-view"]`);
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-viewer"]'))`, UI_MS, 'the viewer');
  const withViewer = await clickHeader();
  await press('Escape');
  await waitFor(`!document.querySelector('[data-testid="pdf-tools-viewer"]')`, UI_MS);
  const after = await where();
  check(
    'LQ-2 with a tool dialog or the viewer open, a click on the header reaches no menu and asks nothing (the idle dialog closes as an outside click closes it; the viewer stays and closes on Escape); the engagement and the list stay',
    !withDialog.menu && !withViewer.menu && withViewer.viewer && !withDialog.question && !withViewer.question && (await asked()).length === 0 && after.here && after.rows === rowsBefore && !(await exists(byTestId('pdf-tools-dialog'))),
    { withDialog, withViewer, asked: await asked(), after },
  );
  // OK ("Change engagement"): the engagement changes and the list is cleared, as before.
  from = shown.length;
  answer(true);
  await headerMenu(here.name, there.name);
  const moved = await waitFor(`(document.querySelector('header')?.innerText || '').includes(${q(there.name)}) && document.querySelectorAll('[data-testid="pdf-tools-row"]').length === 0`, UI_MS);
  check('LQ-3 OK changes to the other engagement and the list is cleared (no row of the first is left)', Boolean(moved) && same(await asked(), [question(unsaved)]), { moved: Boolean(moved), asked: await asked(), now: await where() });
  // Nothing unsaved: no question.
  from = shown.length;
  await headerMenu(there.name, here.name);
  const back = await waitFor(`(document.querySelector('header')?.innerText || '').includes(${q(here.name)})`, UI_MS);
  check('LQ-4 with nothing unsaved the engagement changes without a question', Boolean(back) && (await asked()).length === 0, { back: Boolean(back), asked: await asked() });
}

/**
 * FIX-B (REV-B): the password prompt for a protected file wipes its field after a wrong password (B2); a fold
 * opened by a problem stays open once it is fixed (S1); a token chip goes into its own field (S2); Organise pages
 * keeps the focus where the user is (S5, S7) and asks before throwing changes away (S4).
 */
async function scenarioFixB() {
  step('FIX-B: password prompt wipe, fold, token chip, Organise focus and discard question');
  const activeId = () => evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY'; return a.dataset?.testid || a.getAttribute('role') || a.tagName; })()`);
  const typeKeys = async (text) => {
    for (const ch of text) {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
    await sleep(150);
  };

  // B2: a wrong password leaves nothing in the field, its fiber (current and alternate) or the dialog's state.
  const WRONG = 'Invented-Wrong-Prompt-Pw-5sD3';
  const FIELD = byTestId('pdf-tools-password-input');
  await addFromComputer([FILES.locked]);
  await mustWaitFor(`Boolean(document.querySelector(${q(FIELD)}))`, WORK_MS, 'the password prompt');
  await evaluate(`(document.querySelector(${q(FIELD)}).focus(), true)`);
  await typeKeys(WRONG);
  const typed = await evaluate(`document.querySelector(${q(FIELD)})?.value === ${q(WRONG)}`);
  await click(byTestId('pdf-tools-password-submit'));
  const refused = await waitFor(`document.querySelector('#pdf-tools-password-message')?.innerText.trim().length > 0 && document.querySelector(${q(FIELD)})?.disabled === false`, WORK_MS);
  const focusInField = await waitFor(`document.activeElement?.dataset?.testid === 'pdf-tools-password-input'`, UI_MS);
  const holds = await evaluate(`(() => {
    const pw = ${q(WRONG)};
    const has = (v) => typeof v === 'string' && v.includes(pw);
    const propsHave = (p) => Boolean(p) && typeof p === 'object' && Object.values(p).some(has);
    const keyed = (el, prefix) => { const k = el && Object.keys(el).find((x) => x.startsWith(prefix)); return k ? el[k] : null; };
    const el = document.querySelector('[data-testid="pdf-tools-password-input"]');
    const f = keyed(el, '__reactFiber$');
    let components = 0;
    for (let g0 = f, n = 0; g0 && n < 60; g0 = g0.return, n += 1) {
      for (const g of [g0, g0.alternate]) {
        if (!g) continue;
        if (propsHave(g.memoizedProps)) components += 1;
        for (let h = g.memoizedState, m = 0; h && typeof h === 'object' && 'next' in h && m < 80; h = h.next, m += 1) if (has(h.memoizedState) || propsHave(h.memoizedState)) components += 1;
      }
    }
    return {
      inPage: document.documentElement.outerHTML.includes(pw) || [...document.querySelectorAll('input')].some((i) => has(i.value)),
      value: el ? has(el.value) || has(el.getAttribute('value')) : null,
      current: Boolean(f) && (propsHave(f.memoizedProps) || propsHave(f.pendingProps)),
      alternate: Boolean(f && f.alternate) && (propsHave(f.alternate.memoizedProps) || propsHave(f.alternate.pendingProps)),
      components,
    };
  })()`);
  await press('Escape');
  const promptClosed = await waitFor(`!document.querySelector(${q(FIELD)})`, UI_MS);
  check(
    'FIXB-1 the password prompt for a protected file: after a wrong password the typed text is in neither the page, the field (value, attribute), its fiber (current and alternate) nor the dialog\'s state; the focus waits in the new field; Escape skips the file',
    typed === true && Boolean(refused) && Boolean(focusInField) && !holds.inPage && holds.value === false && !holds.current && !holds.alternate && holds.components === 0 && Boolean(promptClosed),
    { typed, refused: Boolean(refused), focusInField: Boolean(focusInField), holds, promptClosed: Boolean(promptClosed) },
  );

  const [five] = await addAndWait([FILES.five], 'a five-page file for FIX-B');
  await selectOnly([five.id]);

  // S1: Page numbers, a fold opened by a problem stays open once the problem is fixed.
  await openTool('page-numbers');
  const MORE = byTestId('pdf-tools-number-more');
  await click(MORE);
  await chooseOption('pdf-tools-number-style', 'Numbers in circles');
  await click(MORE);
  const closedByUser = await evaluate(`document.querySelector(${q(MORE)})?.getAttribute('aria-expanded')`);
  await chooseOption('pdf-tools-number-format', 'Page 1');
  const openedByProblem = await waitFor(`document.querySelector(${q(MORE)})?.getAttribute('aria-expanded') === 'true'`, UI_MS);
  await chooseOption('pdf-tools-number-style', '1, 2, 3');
  await sleep(600);
  const afterFix = { expanded: await evaluate(`document.querySelector(${q(MORE)})?.getAttribute('aria-expanded')`), focus: await activeId() };
  check(
    'FIXB-2 Page numbers: "More options" opened by a problem stays open once it is fixed, with the Select just used and the focus on it',
    closedByUser === 'false' && Boolean(openedByProblem) && afterFix.expanded === 'true' && afterFix.focus === 'pdf-tools-number-style',
    { closedByUser, openedByProblem: Boolean(openedByProblem), afterFix },
  );
  await closeToolDialog();

  // S2: Watermark, a token chip under "Stamp text" goes into the stamp text, after the watermark text was used.
  await openTool('watermark');
  await mouseClick(byTestId('pdf-tools-watermark-text'));
  await mouseClick(byTestId('pdf-tools-watermark-stamp-switch'));
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-watermark-stamp-text"]'))`, UI_MS, 'the stamp text');
  await mouseClick(byTestId('pdf-tools-watermark-stamp-text-tokens-date'));
  await sleep(400);
  const texts = await evaluate(`({ watermark: document.querySelector('[data-testid="pdf-tools-watermark-text"]').value, stamp: document.querySelector('[data-testid="pdf-tools-watermark-stamp-text"]').value })`);
  check('FIXB-3 Watermark: the {date} chip under "Stamp text" goes into the stamp text, not the watermark text used last', texts.watermark === 'DRAFT' && texts.stamp === 'VERIFIED {date}', texts);
  await closeToolDialog();

  // S5, S7, S4: Organise pages.
  await openTool('organise-pages');
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-organise-tile-3"]'))`, WORK_MS, 'the Organise tiles');
  await mouseClick(byTestId('pdf-tools-organise-tile-3'));
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, text: 'r', unmodifiedText: 'r' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-organise-tile-3"]')?.dataset.turn === '90'`, UI_MS, 'page 3 rotated');
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-organise-later"]').focus(), true)`);
  await press('Enter');
  await sleep(500);
  const afterLater = { focus: await activeId(), place: await evaluate(`document.querySelector('[data-testid="pdf-tools-organise-tile-3"]')?.dataset.place ?? null`) };
  const del = async () => {
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  };
  await mouseClick(byTestId('pdf-tools-organise-tile-2'));
  await del();
  await mustWaitFor(`document.querySelector('[data-testid="pdf-tools-organise-tile-2"]')?.dataset.removed === 'true'`, UI_MS, 'page 2 removed');
  await mouseClick(byTestId('pdf-tools-organise-tile-restore-2'));
  await sleep(400);
  const afterRestore = await activeId();
  await del();
  const removedAgain = await waitFor(`document.querySelector('[data-testid="pdf-tools-organise-tile-2"]')?.dataset.removed === 'true'`, UI_MS);
  await evaluate(`(document.querySelector('[data-testid="pdf-tools-organise-tile-1"]').focus(), true)`);
  await press('Escape');
  const asked = await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-organise-close-confirm"]'))`, UI_MS);
  await evaluate(`([...document.querySelectorAll('[data-testid="pdf-tools-organise-close-confirm"] button')].find((b) => b.innerText.trim() === 'Keep editing').click(), true)`);
  const kept = await waitFor(`!document.querySelector('[data-testid="pdf-tools-organise-close-confirm"]') && Boolean(document.querySelector('[data-testid="pdf-tools-dialog"]'))`, UI_MS);
  await sleep(500);
  const focusKept = await activeId();
  await press('Escape');
  await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-organise-close-confirm"]'))`, UI_MS, 'the discard question');
  await click(byTestId('pdf-tools-organise-close-confirm-yes'));
  const discarded = await waitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS);
  check(
    'FIXB-4 Organise pages: after R on a page, Enter on Later moves it and the focus stays on Later; Restore on a tile keeps the focus on that page and Delete works again; with changes Escape asks "Discard your changes?", Keep editing returns to the page, Discard changes closes',
    afterLater.focus === 'pdf-tools-organise-later' && afterLater.place === '3' && afterRestore === 'pdf-tools-organise-tile-2' && Boolean(removedAgain) && Boolean(asked) && Boolean(kept) && focusKept === 'pdf-tools-organise-tile-1' && Boolean(discarded),
    { afterLater, afterRestore, removedAgain: Boolean(removedAgain), asked: Boolean(asked), kept: Boolean(kept), focusKept, discarded: Boolean(discarded) },
  );
}

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
  // UX-1: the first load of PDF Tools is made slow (a slow disk, simulated: see UX_WATCH), and recorded.
  const uxScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__uxSlowMs = 1200; ${UX_WATCH}` });
  const opened = await signIn(engA, '#/audit-tools?tab=pdf', `Boolean(document.querySelector('[data-testid="pdf-tools-root"]')) && document.querySelector('[data-testid="pdf-tools-add-from-vault"]')?.dataset.enabled === 'true'`);
  const firstLoad = opened ? await uxTimes() : null;
  await evaluate(`(window.__uxSlowMs = 0, true)`).catch(() => undefined);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: uxScript.identifier });
  step('Engagement A: PDF Tools');
  pdfToolsWindows.push({ start: Date.now(), end: Infinity });
  check('2 #/audit-tools?tab=pdf opens PDF Tools (pdf-tools-root) in engagement A', opened, await evaluate('location.href'));
  if (!opened) throw new Error('PDF Tools did not open; the remaining steps need it.');

  // ── UX-1 (T1-10): a quiet outline while PDF Tools loads, never for a quick load ─────────────
  {
    const slow = { loading: firstLoad.at('loading'), shown: firstLoad.at('shown'), gone: firstLoad.at('gone'), root: firstLoad.at('root') };
    // Back to PDF Tools from another VERA Tools tab: its code is there, so it opens at once.
    await evaluate(`(location.hash = '#/audit-tools?tab=analytics', true)`);
    await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-root"]')`, UI_MS, 'another VERA Tools tab');
    await evaluate(`(window.__uxWatch(), location.hash = '#/audit-tools?tab=pdf', true)`);
    await mustWaitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-root"]'))`, UI_MS, 'PDF Tools again');
    await sleep(600);
    const again = await uxTimes();
    const quick = { loading: again.at('loading'), shown: again.at('shown'), root: again.at('root') };
    const simulated = slow.loading !== null && slow.root !== null && slow.root - slow.loading >= 1000;
    if (!simulated) {
      skip('UX-1 the loading outline of a slow first load', `the slow load could not be simulated (preloader changed?): ${JSON.stringify(firstLoad.log)}`);
    } else {
      check(
        'UX-1 PDF Tools loading (T1-10): a slow first load shows the quiet outline only after about 300 ms (nothing flashes) and the screen replaces it; coming back from another tab shows no outline at all',
        slow.shown !== null && slow.shown - slow.loading >= 280 && slow.gone !== null && slow.gone >= slow.shown && slow.root >= slow.shown && quick.shown === null && quick.root !== null,
        { slow, quick, firstLog: firstLoad.log, againLog: again.log },
      );
    }
  }

  await screenshot('int-toolbar');
  const toolbar = await evaluate(`({
    built: ${JSON.stringify(BUILT_TOOLS)}.map((id) => Boolean(document.querySelector('[data-testid="pdf-tools-tool-' + id + '"]'))),
    soon: [...document.querySelectorAll('[data-soon-tool]')].map((b) => ({ key: b.dataset.soonTool, ariaDisabled: b.getAttribute('aria-disabled'), text: b.innerText.replace(/\\s+/g, ' ') })),
    phaseTwo: ${JSON.stringify(PHASE_TWO_TOOLS)}.map((id) => ({ id, usable: Boolean(document.querySelector('[data-testid="pdf-tools-tool-' + id + '"]')), soon: Boolean(document.querySelector('[data-soon-tool="' + id + '"]')) })),
    order: [...document.querySelectorAll('[data-pdf-toolbar] button')].map((b) => b.dataset.soonTool || (b.dataset.testid || '').replace('pdf-tools-tool-', '')),
  })`);
  const soonKeys = toolbar.soon.map((s) => s.key);
  note(`INT stage 1: toolbar order ${toolbar.order.join(', ')}; phase 2 ${toolbar.phaseTwo.map((t) => `${t.id}=${t.usable ? 'usable' : 'Soon'}`).join(', ')}`);
  check(
    'extra (INT stage 1): the seven phase 1 tools are present; the four later tools are "soon"; Organise pages, Resize or crop pages, Watermark, Redact, Bookmarks and Protect are usable; every "soon" button is aria-disabled and says soon',
    toolbar.built.every(Boolean) &&
      SOON_TOOLS.every((k) => soonKeys.includes(k)) &&
      soonKeys.every((k) => SOON_TOOLS.includes(k) || PHASE_TWO_SOON.includes(k)) &&
      toolbar.phaseTwo.every((t) => (PHASE_TWO_SOON.includes(t.id) ? t.soon && !t.usable : t.usable && !t.soon)) &&
      // a "soon" button's text is the label, then the description kept for screen readers
      Boolean(toolbar.soon.find((s) => s.key === 'review')?.text.startsWith('Review \u00b7 soon .')) &&
      toolbar.soon.every((s) => s.ariaDisabled === 'true' && /Soon/i.test(s.text)) &&
      JSON.stringify(toolbar.order) === JSON.stringify(expectedOrder(toolbar.phaseTwo.filter((t) => t.usable).map((t) => t.id))),
    toolbar,
  );
  // INT2 (lane TIFF): the empty list says which files it takes, TIFF among them.
  const emptyHint = await evaluate(`document.querySelector('[data-testid="pdf-tools-root"]')?.innerText.replace(/\\s+/g, ' ') || ''`);
  check('T0 the empty list names the files it takes: "PDF, JPG, PNG, TIFF, WebP, BMP or GIF."', emptyHint.includes('PDF, JPG, PNG, TIFF, WebP, BMP or GIF.'), emptyHint.slice(0, 300));

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

  // ── UX-2 (T1-10): a tool's button shows a spinner while its dialog's code loads, only when that is slow ──
  {
    const OPEN = `Boolean(document.querySelector('[data-testid="pdf-tools-dialog"][data-tool="organise-pages"]'))`;
    const closeDialog = async () => {
      await escapeOrganise();
    };
    await selectOnly([twoRow.id]);
    await evaluate(`(${UX_WATCH}, window.__uxSlowMs = ${process.env.PDF_TOOLS_TEST_SHOTS ? 6000 : 1500}, window.__uxWatch(), true)`);
    await mouseClick(byTestId('pdf-tools-tool-organise-pages'));
    if (process.env.PDF_TOOLS_TEST_SHOTS && (await waitFor(`Boolean(document.querySelector('[data-pdf-toolbar] [data-loading="true"]'))`, UI_MS))) {
      await shotAt('ux-tool-spinner', 1280, 720, false);
      await shotAt('ux-tool-spinner', 1280, 720, true);
    }
    await mustWaitFor(OPEN, WORK_MS, 'the Organise pages dialog (slow load)');
    await sleep(300);
    const first = await uxTimes();
    await evaluate(`(window.__uxSlowMs = 0, true)`);
    await closeDialog();
    await evaluate(`(window.__uxWatch(), true)`);
    await mouseClick(byTestId('pdf-tools-tool-organise-pages'));
    await mustWaitFor(OPEN, WORK_MS, 'the Organise pages dialog (second open)');
    await sleep(300);
    const second = await uxTimes();
    await closeDialog();
    const slow = { click: first.at('click'), busy: first.at('busy'), unbusy: first.at('unbusy'), dialog: first.at('dialog') };
    const ariaBusy = first.log.some(([what]) => what === 'busy:pdf-tools-tool-organise-pages:true');
    if (slow.click === null || slow.dialog === null || slow.dialog - slow.click < 1000) {
      skip('UX-2 the spinner of a slow dialog load', `the slow load could not be simulated (preloader changed?): ${JSON.stringify(first.log)}`);
    } else {
      check(
        'UX-2 tool button while its dialog loads (T1-10): a slow first open shows a spinner on the Organise pages button (aria-busy) only after about 300 ms, gone when the dialog opens; the second open (code loaded) shows none',
        ariaBusy && slow.busy - slow.click >= 280 && slow.unbusy !== null && Math.abs(slow.unbusy - slow.dialog) < 500 && second.at('busy') === null && second.at('dialog') !== null,
        { slow, firstLog: first.log, secondLog: second.log },
      );
    }
  }

  // ── 5: Merge (UX-3, T2-6: the order changed inside the dialog, by mouse and by keyboard) ──
  await selectOnly([twoRow.id, threeRow.id]);
  const ORDER = 'pdf-tools-merge-order';
  const orderIs = (names) => `[...document.querySelectorAll('[data-testid="${ORDER}"] [data-testid="pdf-tools-order-row"]')].map((r) => r.dataset.name).join('|') === ${q(names.join('|'))}`;
  const saidIs = (text) => `document.querySelector('[data-testid="pdf-tools-order-announce"]')?.innerText.trim() === ${q(text)}`;
  const arrowOf = (name, action) => `[data-testid="${ORDER}"] [data-testid="pdf-tools-order-row"][data-name=${q(name)}] [data-action="${action}"]`;
  let mergeOrder = null;
  const mergeOutcome = await runTool('merge', async () => {
    const start = await evaluate(`[...document.querySelectorAll('[data-testid="${ORDER}"] [data-testid="pdf-tools-order-row"]')].map((r) => r.dataset.name)`);
    // Mouse: "Move up" on the second file; the focus stays on that file's other arrow (Move up is now unavailable).
    await mouseClick(arrowOf(FILES.three, 'up'));
    const byMouse = await waitFor(orderIs([FILES.three, FILES.two]), UI_MS);
    const saidMouse = await waitFor(saidIs(`${FILES.three} moved to position 1 of 2.`), UI_MS);
    const focusMouse = await evaluate(`({ action: document.activeElement?.dataset.action ?? null, name: document.activeElement?.closest('[data-testid="pdf-tools-order-row"]')?.dataset.name ?? null })`);
    if (process.env.PDF_TOOLS_TEST_SHOTS) await shotsAll('ux-merge-order');
    // Keyboard: Alt+Down, Alt+Up, then Alt+Up at the top (nothing moves; it says so; VERA Tools keeps its tab).
    await pressWith('ArrowDown', ALT);
    const byKeyDown = await waitFor(orderIs([FILES.two, FILES.three]), UI_MS);
    await pressWith('ArrowUp', ALT);
    const byKeyUp = await waitFor(orderIs([FILES.three, FILES.two]), UI_MS);
    await pressWith('ArrowUp', ALT);
    const saidTop = await waitFor(saidIs(`${FILES.three} is already first.`), UI_MS);
    const stayed = await evaluate(`location.hash.includes('tab=pdf') && Boolean(document.querySelector('[data-testid="pdf-tools-dialog"][data-tool="merge"]'))`);
    // The name follows its default a render after the order changes.
    await waitFor(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value === 'Synthetic three pages_merged.pdf'`, UI_MS);
    const nameNow = await evaluate(`document.querySelector('[data-testid="pdf-tools-result-name"]')?.value ?? null`);
    mergeOrder = { start, byMouse: Boolean(byMouse), saidMouse: Boolean(saidMouse), focusMouse, byKeyDown: Boolean(byKeyDown), byKeyUp: Boolean(byKeyUp), saidTop: Boolean(saidTop), stayed, nameNow };
  });
  const merged = (await rows()).find((r) => r.origin === 'result' && /_merged\.pdf$/.test(r.name));
  check('5 Merge of the first two gives a Result row named *_merged.pdf with 5 pages', mergeOutcome === 'closed' && merged && /\b5 pages\b/.test(merged.text), { mergeOutcome, merged });
  check(
    'UX-3 Merge order inside the dialog (T2-6): "Move up" by mouse and Alt+Down / Alt+Up by keyboard reorder the list shown, each move is announced ("moved to position 1 of 2", "is already first"), the focus stays on the moved file, VERA Tools keeps its tab, and the default name follows the new first file',
    Boolean(mergeOrder) &&
      same(mergeOrder.start, [FILES.two, FILES.three]) &&
      mergeOrder.byMouse && mergeOrder.saidMouse && mergeOrder.focusMouse.action === 'down' && mergeOrder.focusMouse.name === FILES.three &&
      mergeOrder.byKeyDown && mergeOrder.byKeyUp && mergeOrder.saidTop && mergeOrder.stayed === true &&
      mergeOrder.nameNow === 'Synthetic three pages_merged.pdf' && merged?.name === mergeOrder.nameNow,
    { mergeOrder, merged: merged?.name },
  );
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
  const storedPdf = storedFile && fs.existsSync(storedFile) ? await readPdf(fs.readFileSync(storedFile)) : null;
  check(
    'UX-3b the merged file holds the pages in the order the dialog showed: the 3-page file, then the 2-page file (read from the bytes stored in the Evidence Vault)',
    same(pageTexts(storedPdf), ['Three p1', 'Three p2', 'Three p3', 'Two p1', 'Two p2']),
    pageTexts(storedPdf),
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
  await scenarioBookmarksStageOne();
  {
    const marked = (await rows()).filter((r) => r.name === FILES.marked).pop();
    if (marked) {
      await selectOnly([marked.id]);
      await openTool('compress');
      await shotsAll('compress-dialog');
      await press('Escape');
      await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the Compress dialog to close');
    }
    const coverRow = (await rows()).filter((r) => r.name === FILES.cover).pop();
    if (coverRow) {
      await selectOnly([coverRow.id]);
      await openTool('images-to-pdf');
      const closed = await evaluate(`({ summary: document.querySelector('[data-testid="pdf-tools-images-more-summary"]')?.innerText.trim() || null, marginShown: Boolean(document.querySelector('[data-testid="pdf-tools-image-margin"]')?.offsetParent) })`);
      await shotsAll('images-fold-closed');
      await click(byTestId('pdf-tools-images-more'));
      const opened = await waitFor(`Boolean(document.querySelector('[data-testid="pdf-tools-image-margin"]')?.offsetParent)`, UI_MS);
      await shotsAll('images-fold-open');
      await press('Escape');
      await mustWaitFor(`!document.querySelector('[data-testid="pdf-tools-dialog"]')`, UI_MS, 'the Images to PDF dialog to close');
      check(
        'INT-13 Images to PDF: the margin sits under "More options", whose closed line shows its value; opening it shows the field',
        typeof closed.summary === 'string' && closed.summary.startsWith('Margin 28 pt') && !closed.marginShown && Boolean(opened),
        { closed, opened: Boolean(opened) },
      );
    }
  }
  await scenarioProtectWipe();
  await scenarioUxGap();
  await scenarioQaFix();
  // INT2: the lanes' scenarios (RC, CT, SPLIT, TIFF, VS) and the focus after a confirmed Stop.
  await scenarioStopFocus();
  await scenarioResizeCrop();
  await scenarioFitToSize();
  await scenarioSplitFiles();
  await scenarioTiff();
  await scenarioViewerSearch();
  await scenarioFixB();
  await scenarioRedact();
  await scenarioLeaveQuestion(people);
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
  const protectInProfile = findInFiles(profilePath, PROTECT_PASSWORD);
  check(
    `INT-10 the password given to Protect is in no file of the profile (${protectInProfile.files} files) and in no console message`,
    protectInProfile.hits.length === 0 && protectInProfile.unreadable.length === 0 && !consoleMessages.some((m) => String(m.text).includes(PROTECT_PASSWORD)),
    { hits: protectInProfile.hits, unreadable: protectInProfile.unreadable },
  );
  for (const [when, password] of Object.entries(WIPE_PASSWORDS)) {
    const found = findInFiles(profilePath, password);
    check(
      `INT-19b the password typed for Protect (${when}) is in no file of the profile (${found.files} files) and in no console message`,
      found.hits.length === 0 && found.unreadable.length === 0 && !consoleMessages.some((m) => String(m.text).includes(password)),
      { hits: found.hits, unreadable: found.unreadable },
    );
  }
  for (const [what, value] of [['the PAN redacted', REDACT_PAN], ['the e-mail address redacted', REDACT_EMAIL], ['the word typed into Redact', REDACT_ABSENT_WORD]]) {
    const found = findInFiles(profilePath, value);
    check(
      `RD-8 ${what} is in no file of the profile (${found.files} files) and in no console message`,
      found.hits.length === 0 && found.unreadable.length === 0 && !consoleMessages.some((m) => String(m.text).includes(value)),
      { hits: found.hits, unreadable: found.unreadable },
    );
  }
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
