// Electron entry for scripts/test-pdf-tools-ui.cjs (PDF Tools end-to-end test).
// Points userData and downloads at the test's throw-away folder before the production main
// process (electron/main.cjs) is loaded, so the test never touches a real audit_assistant.db.
//
// First start: refuses to run if a database already exists in that profile.
// Restart (PDF_TOOLS_TEST_RESTART=1): the test checks persistence, so its own database must
// already be there; it refuses to run if it is missing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const profilePath = process.env.PDF_TOOLS_TEST_USER_DATA;
const downloadsPath = process.env.PDF_TOOLS_TEST_DOWNLOADS;
const projectRoot = process.env.PDF_TOOLS_TEST_PROJECT_ROOT;
const restart = process.env.PDF_TOOLS_TEST_RESTART === '1';
if (!profilePath || !downloadsPath || !projectRoot) {
  throw new Error('PDF Tools test harness paths are required: PDF_TOOLS_TEST_USER_DATA, PDF_TOOLS_TEST_DOWNLOADS, PDF_TOOLS_TEST_PROJECT_ROOT.');
}

const resolvedProfile = path.resolve(profilePath);
const resolvedDownloads = path.resolve(downloadsPath);
const runtimeFolder = path.dirname(resolvedProfile);
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// Only a folder the test made under the system temp folder, with the downloads folder beside the profile.
if (!path.basename(runtimeFolder).startsWith('icai-vera-pdf-tools-ui-') || !samePath(path.dirname(runtimeFolder), path.resolve(os.tmpdir()))) {
  throw new Error(`Refusing to use a profile outside the PDF Tools test runtime folder: ${resolvedProfile}`);
}
if (!samePath(path.dirname(resolvedDownloads), runtimeFolder)) {
  throw new Error(`Refusing to use a downloads folder outside the PDF Tools test runtime folder: ${resolvedDownloads}`);
}

const databasePath = path.join(resolvedProfile, 'audit_assistant.db');
const databaseFiles = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
if (!restart && databaseFiles.some((file) => fs.existsSync(file))) {
  throw new Error(`Refusing to start with an existing database: ${databasePath}`);
}
if (restart && !fs.existsSync(databasePath)) {
  throw new Error(`Restart requested, but the test's database is missing: ${databasePath}`);
}

app.setPath('userData', resolvedProfile);
app.setPath('downloads', resolvedDownloads);
if (path.resolve(app.getPath('userData')) !== resolvedProfile) {
  throw new Error(`Electron userData did not resolve to the isolated profile: ${app.getPath('userData')}`);
}
if (path.resolve(app.getPath('downloads')) !== resolvedDownloads) {
  throw new Error(`Electron downloads did not resolve to the isolated folder: ${app.getPath('downloads')}`);
}

console.log(`PDF_TOOLS_PROFILE_ISOLATED ${JSON.stringify({ userData: resolvedProfile, downloads: resolvedDownloads, restart })}`);

app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
// The test window must keep drawing when other windows cover it or it loses focus: Chromium
// otherwise stops its frames and slows its timers, and previews and file reading stall.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// A download (Save to computer when no save picker is available) goes into the test's downloads
// folder instead of opening Electron's Save As dialog.
app.whenReady().then(() => {
  const { session } = require('electron');
  session.defaultSession.on('will-download', (_event, item) => item.setSavePath(path.join(resolvedDownloads, item.getFilename())));
});
require(path.join(projectRoot, 'electron', 'main.cjs'));
