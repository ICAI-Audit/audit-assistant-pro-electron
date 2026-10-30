const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const profilePath = process.env.T003_USER_DATA;
const downloadsPath = process.env.T003_DOWNLOADS;
const projectRoot = process.env.T003_PROJECT_ROOT;

if (!profilePath || !downloadsPath || !projectRoot) {
  throw new Error('T-003 harness paths are required.');
}

const resolvedProfile = path.resolve(profilePath);
const resolvedDownloads = path.resolve(downloadsPath);
const databasePath = path.join(resolvedProfile, 'audit_assistant.db');

if (fs.existsSync(databasePath) || fs.existsSync(`${databasePath}-wal`) || fs.existsSync(`${databasePath}-shm`)) {
  throw new Error(`Refusing to start with an existing test database: ${databasePath}`);
}

app.setPath('userData', resolvedProfile);
app.setPath('downloads', resolvedDownloads);

if (path.resolve(app.getPath('userData')) !== resolvedProfile) {
  throw new Error(`Electron userData did not resolve to the isolated profile: ${app.getPath('userData')}`);
}

if (path.resolve(app.getPath('downloads')) !== resolvedDownloads) {
  throw new Error(`Electron downloads did not resolve to the isolated directory: ${app.getPath('downloads')}`);
}

if (fs.existsSync(databasePath)) {
  throw new Error(`A test database appeared before production main was loaded: ${databasePath}`);
}

console.log(`T003_PROFILE_ISOLATED ${JSON.stringify({
  userData: resolvedProfile,
  downloads: resolvedDownloads,
  databaseExisted: false,
})}`);

app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
require(path.join(projectRoot, 'electron', 'main.cjs'));
