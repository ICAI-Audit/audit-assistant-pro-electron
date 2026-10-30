const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'icai-vera-native-smoke-'));
app.setPath('userData', userDataPath);

async function smokeTest() {
  let database;

  try {
    const Database = require('better-sqlite3');
    const bcrypt = require('bcrypt');
    database = new Database(':memory:');
    database.exec('CREATE TABLE smoke_test (value TEXT NOT NULL)');
    database.prepare('INSERT INTO smoke_test (value) VALUES (?)').run('synthetic');
    assert.equal(database.prepare('SELECT value FROM smoke_test').get().value, 'synthetic');

    const passwordHash = await bcrypt.hash('synthetic-password', 4);
    assert.equal(await bcrypt.compare('synthetic-password', passwordHash), true);
    assert.equal(await bcrypt.compare('different-password', passwordHash), false);

    console.log(`Native module smoke test passed (Electron ${process.versions.electron}).`);
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

app.whenReady()
  .then(smokeTest)
  .then(() => app.quit())
  .catch((error) => {
    console.error('Native module smoke test failed:', error);
    app.exit(1);
  });
