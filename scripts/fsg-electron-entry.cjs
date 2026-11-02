// Electron entry for scripts/test-fsg-ui.cjs (T-019).
// Points userData and downloads at a throw-away profile before the production
// main process (electron/main.cjs) is loaded, so the test never touches a real
// audit_assistant.db. Unlike t003-electron-entry.cjs it accepts an existing
// database in that profile: the FSG test seeds an "upgrade" database first and
// restarts the app to check persistence.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const profilePath = process.env.FSG_TEST_USER_DATA;
const downloadsPath = process.env.FSG_TEST_DOWNLOADS;
const projectRoot = process.env.FSG_TEST_PROJECT_ROOT;
if (!profilePath || !downloadsPath || !projectRoot) {
  throw new Error('FSG test harness paths are required.');
}

const resolvedProfile = path.resolve(profilePath);
if (!path.basename(path.dirname(resolvedProfile)).startsWith('icai-vera-fsg-ui-')) {
  throw new Error(`Refusing to use a profile outside the FSG test runtime folder: ${resolvedProfile}`);
}
app.setPath('userData', resolvedProfile);
app.setPath('downloads', path.resolve(downloadsPath));
if (path.resolve(app.getPath('userData')) !== resolvedProfile) {
  throw new Error(`Electron userData did not resolve to the isolated profile: ${app.getPath('userData')}`);
}
console.log(`FSG_PROFILE_ISOLATED ${JSON.stringify({ userData: resolvedProfile, databaseExisted: fs.existsSync(path.join(resolvedProfile, 'audit_assistant.db')) })}`);

app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
require(path.join(projectRoot, 'electron', 'main.cjs'));
