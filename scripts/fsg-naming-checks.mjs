// T-042 synthetic checks, called by test-fsg-integration.mjs. No live profile.
// Users see one hierarchy, "Mapping 1" to "Mapping 7"; Excel downloads use those
// headers, and uploads still accept files with the older "Level n" headers.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { formatLevel } from '../electron/fsg/services/excel.js'
const require = createRequire(import.meta.url)

export async function checkNaming({ db, root, check, staff, entityId, defaultRs }) {
  const XLSX = require(join(root, 'node_modules', 'xlsx'))
  const headersOf = (bytes, sheet) => {
    const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' })
    const ws = wb.Sheets[sheet || wb.SheetNames[0]]
    return (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || []).map(String)
  }

  let r = await staff('mapping:download', defaultRs)
  const lfHeaders = r.ok ? headersOf(r.result, 'LevelFormat') : []
  check('T-042 Mapping Rules download heads the format columns Mapping 1 to Mapping 7',
    [1, 2, 3, 4, 5, 6, 7].every(n => lfHeaders.includes(`Mapping ${n}`)) && !lfHeaders.some(h => /^Level [1-7]$/.test(h)), lfHeaders)
  check('T-042 a Level Format row reads either header spelling', formatLevel({ 'Mapping 5': 'A / B' }, 5) === 'A / B' && formatLevel({ 'Level 5': 'C / D' }, 5) === 'C / D' && formatLevel({ 'Mapping 5': '', 'Level 5': 'E' }, 5) === 'E')

  // Learned Ledger Rules: an older file with "Level 4-7" headers still imports, and the download uses "Mapping 4-7".
  const legacy = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(legacy, XLSX.utils.json_to_sheet([{
    'Ledger Name': 'Zq Naming Ledger', 'ALIE': 'ASSETS', 'Mapping 1 (Broad)': 'Current assets', 'Mapping 2 (Category)': 'Trade receivables',
    'Mapping 3 (Specific)': '', 'Level 4': '', 'Level 5': 'Zq legacy nature', 'Level 6': '', 'Level 7': '',
  }]), 'Learned Ledger Rules')
  r = await staff('learnedRules:upload', entityId, Array.from(XLSX.write(legacy, { type: 'buffer', bookType: 'xlsx' })))
  const saved = db.prepare('SELECT level5_value FROM learned_ledger_rules WHERE entity_id = ? AND ledger_name = ?').get(entityId, 'Zq Naming Ledger')
  check('T-042 a Learned Ledger Rules file with older "Level 5" headers still imports', r.ok && saved?.level5_value === 'Zq legacy nature', { r, saved })
  r = await staff('learnedRules:download', entityId)
  const ruleHeaders = r.ok ? headersOf(r.result.buffer) : []
  check('T-042 Learned Ledger Rules download heads the columns Mapping 4 to Mapping 7',
    [4, 5, 6, 7].every(n => ruleHeaders.includes(`Mapping ${n}`)) && !ruleHeaders.some(h => /^Level [4-7]$/.test(h)), ruleHeaders)
  const renamed = XLSX.read(new Uint8Array(r.result.buffer), { type: 'array' })
  const sheet = renamed.Sheets[renamed.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet).map(x => x['Ledger Name'] === 'Zq Naming Ledger' ? { ...x, 'Mapping 5': 'Zq new nature' } : x)
  const fresh = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(fresh, XLSX.utils.json_to_sheet(rows), 'Learned Ledger Rules')
  r = await staff('learnedRules:upload', entityId, Array.from(XLSX.write(fresh, { type: 'buffer', bookType: 'xlsx' })))
  const again = db.prepare('SELECT level5_value FROM learned_ledger_rules WHERE entity_id = ? AND ledger_name = ?').get(entityId, 'Zq Naming Ledger')
  check('T-042 a Learned Ledger Rules file with the new "Mapping 5" header imports', r.ok && again?.level5_value === 'Zq new nature', { r, again })
  db.prepare('DELETE FROM learned_ledger_rules WHERE entity_id = ? AND ledger_name = ?').run(entityId, 'Zq Naming Ledger')
}
