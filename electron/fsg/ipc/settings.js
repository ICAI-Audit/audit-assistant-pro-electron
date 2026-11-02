import { dialog, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { ipcMain } from '../ipc-registry.js'
import { query } from '../db/client.js'
import { exportTablesToFiles, FSG_EXPORT_TABLES } from '../services/dbExport.js'
import { assetPath, userDataPath } from '../paths.js'

const tallyConfigPath = () => userDataPath('tally-config.json')

// Prescribed Format Reference — bundled static HTML (electron/fsg/assets).
function findFormatReferenceFile() {
  return assetPath('Prescribed_Format_Reference.html')
}

// FSG_Bharat connected to a PostgreSQL server configured here. In ICAI VERA the
// statements live in VERA's local SQLite database, opened and migrated by VERA
// itself, so there is nothing to configure: the settings channels only describe
// the store and report success.
const LOCAL_STORE_SETTINGS = Object.freeze({ engine: 'sqlite', managedBy: 'ICAI VERA' })

function readTallyConfig() {
  try {
    if (existsSync(tallyConfigPath())) {
      return JSON.parse(readFileSync(tallyConfigPath(), 'utf8'))
    }
  } catch (_) {}
  return { host: 'localhost', port: 9000 }
}

function writeTallyConfig(cfg) {
  writeFileSync(tallyConfigPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', () => {
    return { ...LOCAL_STORE_SETTINGS }
  })

  ipcMain.handle('settings:save', async () => {
    return { ok: true }
  })

  ipcMain.handle('settings:testConnection', async () => {
    return { ok: true }
  })

  ipcMain.handle('dialog:openFile', async (_, opts) => {
    const result = await dialog.showOpenDialog(opts || {})
    return result
  })

  ipcMain.handle('dialog:saveFile', async (_, opts) => {
    const result = await dialog.showSaveDialog(opts || {})
    return result
  })

  ipcMain.handle('file:write', async (_, filePath, bufferArray) => {
    writeFileSync(filePath, Buffer.from(bufferArray))
    return true
  })

  ipcMain.handle('file:read', async (_, filePath) => {
    return Array.from(readFileSync(filePath))
  })

  // ── Export the FSG tables' raw data (one sheet per table) ──────────────────
  // VERA's database also holds users, credentials and all other audit data, so
  // only the FSG module's own tables (services/dbExport.js FSG_EXPORT_TABLES)
  // are exported.
  // Asks for the file, then reads the tables a page at a time and writes the workbook
  // right here — see services/dbExport.js for why the file never travels through IPC
  // as an array (that was "Export failed: Invalid array length" on a large database).
  ipcMain.handle('db:exportAllTablesToFile', async (event, { defaultPath } = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const pick = await dialog.showSaveDialog(win, {
        defaultPath: defaultPath || 'FSG_Bharat_Database_Export.xlsx',
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      })
      if (pick.canceled || !pick.filePath) return { ok: true, canceled: true }
      const { rows: tables } = await query(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name IN (SELECT value FROM json_each($1))
          ORDER BY name`,
        [FSG_EXPORT_TABLES]
      )
      const quote = (n) => `"${String(n).replace(/"/g, '""')}"`
      const result = await exportTablesToFiles({
        filePath: pick.filePath,
        tables: tables.map(t => t.name),
        fetchPage: async (table, offset, limit) =>
          (await query(`SELECT * FROM ${quote(table)} ORDER BY rowid LIMIT $1 OFFSET $2`, [limit, offset])).rows,
      })
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('format:getReference', () => {
    try {
      return { ok: true, html: readFileSync(findFormatReferenceFile(), 'utf8') }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('tally:getConfig', () => readTallyConfig())

  ipcMain.handle('tally:saveConfig', (_, cfg) => {
    writeTallyConfig({ host: cfg.host || 'localhost', port: cfg.port || 9000 })
    return { ok: true }
  })
}
