// Default import: xlsx is CommonJS, and Node's ESM namespace import of it does
// not expose readFile (electron-vite's bundle did). The default export is the
// full module.
import XLSX from 'xlsx'
import { createHash } from 'crypto'
import { query, runInTransaction } from '../db/client.js'
import { tryClaimMigration } from '../db/schema.js'
import { assetPath } from '../paths.js'
import { ensureLevel1Fallbacks, PRE_FALLBACK_WORKBOOK_HASH, FALLBACK_WORKBOOK_HASH } from '../db/level1-fallbacks.js'

// Primary mapping file: Mapping_v2.xlsx, bundled with VERA in
// electron/fsg/assets/ (see paths.js).
import { readFileSync as readFileBytes } from 'fs'

const SOURCE_MAPPING = assetPath('Mapping_v2.xlsx')

const TB_HEADERS = [
  'Period','Branch','Ledger Code','Name',
  'OpeningBalance','Debit','Credit','ClosingBalance',
  'IsRevenue','IsDeemedPositive','TrailBalance','Parent',
  'Group.$Parent','Group.$Parent.1','Group.$Parent.2','Group.$Parent.3',
  'Group.$Parent.4','Group.$Parent.5','Group.$Parent.6','Group.$Parent.7','Group.$Parent.8'
]

// ── Read Mapping.xlsx and return parsed data ─────────────────────────────────
export function readMappingFile(filePath = SOURCE_MAPPING) {
  const wb = XLSX.readFile(filePath)

  const clean = (v) => (v === null || v === undefined || v === '' ? null : String(v).trim())

  // Normalize the "Constitution" header to a consistent case — some sheets
  // (seen in the wild: Map1/Map2/Map3 using lowercase "constitution" while
  // LevelFormat uses "Constitution") use different casing, which otherwise
  // makes downstream `row['Constitution']` lookups silently come back undefined.
  const normalizeKey = (k) => (String(k).trim().toLowerCase() === 'constitution' ? 'Constitution' : k)

  const readSheet = (name) => {
    const ws = wb.Sheets[name]
    if (!ws) return []
    return XLSX.utils.sheet_to_json(ws, { defval: null })
      .map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeKey(k), clean(v)])))
  }

  return {
    levelFormat: readSheet('LevelFormat'),
    map1:        readSheet('Map1'),
    map2:        readSheet('Map2'),
    map3:        readSheet('Map3'),
  }
}

// ── Seed / refresh default mapping from maintained mapping workbook ───────────
// Logic:
//   • If Mapping_v2.xlsx or Mapping_updated.xlsx exists → replace the default rule set with its
//     content exactly once per distinct file version (see fileHash below), keyed via
//     schema_migrations. This preserves the "edit Mapping_v2.xlsx, restart, see it reflected" dev
//     workflow while not re-wiping the shared default rule set on every one of 15 clients' launches
//     against an unchanged file (which would repeatedly null out level_format_id for every
//     already-mapped TB using the default rule set, mid-session, for everyone).
//   • If only the legacy Source/Mapping.xlsx exists and no default is in DB → seed once.
//   • Client-specific rule sets (entity_id IS NOT NULL) are never touched.
export async function seedDefaultMapping() {
  // Always refresh when using a maintained primary mapping file.
  const usingMaintainedMapping = SOURCE_MAPPING.includes('Mapping_v2')

  let data
  try {
    data = readMappingFile()
  } catch (err) {
    console.warn('Could not read default Mapping file:', err.message)
    // Fall back to existing DB default if file unreadable
    const { rows } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)
    return rows[0]?.id ?? null
  }

  const { rows: existing } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)

  if (existing.length > 0 && !usingMaintainedMapping) {
    // Legacy file and default already seeded — don't overwrite
    return existing[0].id
  }

  if (usingMaintainedMapping) {
    const fileHash = createHash('sha256').update(readFileBytes(SOURCE_MAPPING)).digest('hex')
    // This exact workbook revision adds only the five T-024 terminal rows.
    // Preserve existing master IDs and all ledger mappings on an old install.
    if (fileHash === FALLBACK_WORKBOOK_HASH && existing.length) {
      const { rows: oldSeed } = await query('SELECT key FROM schema_migrations WHERE key = $1', [`mapping_seed:${PRE_FALLBACK_WORKBOOK_HASH}`])
      if (oldSeed.length) {
        const { rows: newSeed } = await query('SELECT key FROM schema_migrations WHERE key = $1', [`mapping_seed:${fileHash}`])
        const result = await ensureLevel1Fallbacks({ seedHash: newSeed.length ? null : fileHash })
        if (result.backupPath) console.log('T-024 mapping backup:', result.backupPath)
        return existing[0].id
      }
    }
    const claimed = await tryClaimMigration(`mapping_seed:${fileHash}`)
    if (!claimed) {
      // This exact file content has already been seeded (by this client on a
      // prior launch, or by another client under the shared startup lock) —
      // don't wipe and rebuild the shared default rule set again.
      return existing[0]?.id ?? null
    }
  }

  // Refresh existing default rule set: clear child tables and refill.
  // We keep the rule set row itself so foreign keys from mapped_tb etc. stay valid.
  let rsId
  if (existing.length > 0) {
    rsId = existing[0].id
    await runInTransaction(async () => {
      // Null out level_format_id references in mapped_tb before deleting level_format rows
      // (mapped_tb.level_format_id FK → level_format.id)
      await query(`UPDATE mapped_tb SET level_format_id = NULL WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM level_format WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM map1         WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM map2         WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM map3         WHERE rule_set_id = $1`, [rsId])
    })
  } else {
    const { rows: [rs] } = await query(
      `INSERT INTO mapping_rule_sets (name, is_default) VALUES ($1, TRUE) RETURNING id`,
      ['Default Mapping']
    )
    rsId = rs.id
  }

  // Wrap all seed inserts in one transaction — avoids thousands of disk writes
  await runInTransaction(async () => {
    for (let i = 0; i < data.levelFormat.length; i++) {
      const r = data.levelFormat[i]
      await query(
        `INSERT INTO level_format
          (rule_set_id, constitution, alie, level1, level2, level3, level4, level5, level6, level7, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rsId, parseInt(r['Constitution']), r['ALIE'], r['Level 1'], r['Level 2'],
         r['Level 3'], r['Level 4'], r['Level 5'], r['Level 6'], r['Level 7'], i]
      )
    }
    for (const r of data.map1) {
      await query(
        `INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
         VALUES ($1,$2,$3,$4)`,
        [rsId, parseInt(r['Constitution']), r['Tally Pre-Primary'], r['Mapping1 Resultant']]
      )
    }
    for (const r of data.map2) {
      await query(
        `INSERT INTO map2
          (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [rsId, parseInt(r['Constitution']), r['Keyword'], r['Mapping2 Resultant'],
         r['Mapping1 Resultant'], parseInt(r['Priority']) || 1, r['Notes for understanding']]
      )
    }
    for (const r of data.map3) {
      await query(
        `INSERT INTO map3
          (rule_set_id, constitution, keywords, mapping1_resultant, mapping2_resultant, mapping3_resultant, priority, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rsId, parseInt(r['Constitution']), r['Keyword'], r['Mapping1 Resultant'],
         r['Mapping2 Resultant'], r['Mapping3 Resultant'], parseInt(r['Priority']) || 1,
         r['Notes for understanding']]
      )
    }
  })

  console.log('Default mapping seeded, rule_set_id =', rsId)
  return rsId
}

// ── Ensure stock categorisation entries exist in Level Format ────────────────
export async function ensureStockCategories() {
  const { rows } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)
  if (!rows.length) return
  const rsId = rows[0].id

  // For each constitution (1,2,3), ensure stock entries exist
  for (const c of [1, 2, 3]) {
    // 1. Opening Stock (PL) — Expenses
    const { rows: existOp } = await query(
      `SELECT id FROM level_format WHERE rule_set_id=$1 AND constitution=$2 AND level1='Opening Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existOp.length) {
      await query(
        `INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
         VALUES ($1, $2, 'Expenses', 'Opening Stock (PL)', 'Opening Stock', 'Opening Stock', 9990)`,
        [rsId, c]
      )
    }

    // 2. Closing Stock (PL) — Income
    const { rows: existClPL } = await query(
      `SELECT id FROM level_format WHERE rule_set_id=$1 AND constitution=$2 AND level1='Closing Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existClPL.length) {
      await query(
        `INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
         VALUES ($1, $2, 'Income', 'Closing Stock (PL)', 'Closing Stock', 'Closing Stock', 9991)`,
        [rsId, c]
      )
    }

    // 3. Closing Stock (BS) — Assets → Current assets → Inventories (check if Inventories exists)
    const { rows: existInv } = await query(
      `SELECT id FROM level_format WHERE rule_set_id=$1 AND constitution=$2 AND level2='Inventories' LIMIT 1`,
      [rsId, c]
    )
    if (!existInv.length) {
      await query(
        `INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
         VALUES ($1, $2, 'ASSETS', 'Current assets', 'Inventories', 'Closing Stock (BS)', 9992)`,
        [rsId, c]
      )
    }

    // Add Map1 entries for stock keywords
    const { rows: existM1Op } = await query(
      `SELECT id FROM map1 WHERE rule_set_id=$1 AND constitution=$2 AND tally_pre_primary='Opening Stock' LIMIT 1`,
      [rsId, c]
    )
    if (!existM1Op.length) {
      await query(
        `INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
         VALUES ($1, $2, 'Opening Stock', 'Opening Stock (PL)')`,
        [rsId, c]
      )
    }

    const { rows: existM1Cl } = await query(
      `SELECT id FROM map1 WHERE rule_set_id=$1 AND constitution=$2 AND tally_pre_primary='Closing Stock' LIMIT 1`,
      [rsId, c]
    )
    if (!existM1Cl.length) {
      await query(
        `INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
         VALUES ($1, $2, 'Closing Stock', 'Closing Stock (PL)')`,
        [rsId, c]
      )
    }

    // Add Map2 entries for stock keywords
    const { rows: existM2Op } = await query(
      `SELECT id FROM map2 WHERE rule_set_id=$1 AND constitution=$2 AND keywords='Opening Stock' AND mapping1_resultant='Opening Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existM2Op.length) {
      await query(
        `INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
         VALUES ($1, $2, 'Opening Stock', 'Opening Stock', 'Opening Stock (PL)', 1)`,
        [rsId, c]
      )
    }

    const { rows: existM2Cl } = await query(
      `SELECT id FROM map2 WHERE rule_set_id=$1 AND constitution=$2 AND keywords='Closing Stock - PL' AND mapping1_resultant='Closing Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existM2Cl.length) {
      await query(
        `INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
         VALUES ($1, $2, 'Closing Stock - PL', 'Closing Stock', 'Closing Stock (PL)', 1)`,
        [rsId, c]
      )
    }

    const { rows: existM2BS } = await query(
      `SELECT id FROM map2 WHERE rule_set_id=$1 AND constitution=$2 AND keywords='Closing Stock - BS' AND mapping1_resultant='Current assets' LIMIT 1`,
      [rsId, c]
    )
    if (!existM2BS.length) {
      await query(
        `INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
         VALUES ($1, $2, 'Closing Stock - BS', 'Inventories', 'Current assets', 1)`,
        [rsId, c]
      )
    }

    // Map3 entries for stock — so they don't fall into "Uncategorised"
    const m3Entries = [
      ['Opening Stock', 'Opening Stock (PL)', 'Opening Stock', 'Opening Stock'],
      ['Closing Stock - PL', 'Closing Stock (PL)', 'Closing Stock', 'Closing Stock'],
      ['Closing Stock - BS', 'Current assets', 'Inventories', 'Closing Stock (BS)'],
    ]
    for (const [kw, m1, m2, m3] of m3Entries) {
      const { rows: ex } = await query(
        `SELECT id FROM map3 WHERE rule_set_id=$1 AND constitution=$2 AND keywords=$3 AND mapping1_resultant=$4 AND mapping2_resultant=$5 LIMIT 1`,
        [rsId, c, kw, m1, m2]
      )
      if (!ex.length) {
        await query(
          `INSERT INTO map3 (rule_set_id, constitution, keywords, mapping1_resultant, mapping2_resultant, mapping3_resultant, priority)
           VALUES ($1, $2, $3, $4, $5, $6, 1)`,
          [rsId, c, kw, m1, m2, m3]
        )
      }
    }
  }
}

// ── Parse uploaded Trial Balance Excel ──────────────────────────────────────
export function parseTBExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null })

  // sheet_to_json keys each row off the header cell's FORMATTED display text
  // (.w), not its raw value (.v) — if a header cell picks up a number format
  // (e.g. a currency/accounting format accidentally applied to the whole
  // column including row 1), Excel renders it with alignment padding baked
  // in, e.g. "OpeningBalance" displays as " OpeningBalance ". The underlying
  // header text and every data cell stay perfectly clean, but the resulting
  // object key gains stray whitespace — so every r['OpeningBalance'] lookup
  // below silently misses (undefined → parsed as 0) with no error, even
  // though the column is visibly present and correctly named. Trim every key
  // so the exact-name lookups below are resilient to this regardless of
  // which column(s) it happens to hit.
  const rows = rawRows.map(r =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), v]))
  )

  return rows.map(r => {
    const clean = (k) => {
      const v = r[k]
      return v === null || v === undefined || v === '' ? null : v
    }
    const num = (k) => {
      const v = r[k]
      if (v === null || v === undefined || v === '') return 0
      const n = parseFloat(v)
      return isNaN(n) ? 0 : n
    }
    // Accepts every common spreadsheet Yes/No spelling a CA might type or an
    // export tool might produce — not just Excel's own TRUE/FALSE. A value
    // that doesn't match any recognised spelling is left null (unknown)
    // rather than silently defaulting to false, since "false" is a real,
    // meaningful classification (Cr-natured) that shouldn't be guessed at
    // from unrecognised text (e.g. this file's actual "Y"/blank spelling
    // previously fell through to `false` for every single row).
    const TRUE_VALS  = new Set(['true', 'yes', 'y', 't', '1'])
    const FALSE_VALS = new Set(['false', 'no', 'n', 'f', '0'])
    const bool = (k) => {
      const v = r[k]
      if (v === null || v === undefined || v === '') return null
      const s = String(v).trim().toLowerCase()
      if (TRUE_VALS.has(s)) return true
      if (FALSE_VALS.has(s)) return false
      return null
    }

    return {
      period:            clean('Period'),
      branch:            clean('Branch'),
      ledger_code:       clean('Ledger Code'),
      name:              clean('Name'),
      trial_balance_type: clean('TrialBalance'),
      opening_balance:   num('OpeningBalance'),
      debit:             num('Debit'),
      credit:            num('Credit'),
      closing_balance:   num('ClosingBalance'),
      is_revenue:        bool('IsRevenue'),
      is_deemed_positive: bool('IsDeemedPositive'),
      trail_balance:     num('TrailBalance'),
      parent:            clean('Parent'),
      group_parent:      clean('Group.$Parent'),
      group_parent_1:    clean('Group.$Parent.1'),
      group_parent_2:    clean('Group.$Parent.2'),
      group_parent_3:    clean('Group.$Parent.3'),
      group_parent_4:    clean('Group.$Parent.4'),
      group_parent_5:    clean('Group.$Parent.5'),
      group_parent_6:    clean('Group.$Parent.6'),
      group_parent_7:    clean('Group.$Parent.7'),
      group_parent_8:    clean('Group.$Parent.8'),
    }
  })
}

// ── Generate TB Template Excel ───────────────────────────────────────────────
export function generateTBTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([TB_HEADERS])
  // Style header row width
  ws['!cols'] = TB_HEADERS.map(() => ({ wch: 18 }))
  XLSX.utils.book_append_sheet(wb, ws, 'Trial Balance')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

// ── Export mapping rule set to Excel ────────────────────────────────────────
export async function exportMappingToExcel(rsId) {
  const wb = XLSX.utils.book_new()

  const { rows: lf } = await query(
    `SELECT constitution, alie, level1, level2, level3, level4, level5, level6, level7
     FROM level_format WHERE rule_set_id=$1 ORDER BY sort_order`, [rsId]
  )
  const { rows: m1 } = await query(
    `SELECT constitution, tally_pre_primary AS "Tally Pre-Primary",
            mapping1_resultant AS "Mapping1 Resultant"
     FROM map1 WHERE rule_set_id=$1`, [rsId]
  )
  const { rows: m2 } = await query(
    `SELECT constitution, keywords AS "Keyword",
            mapping2_resultant AS "Mapping2 Resultant",
            mapping1_resultant AS "Mapping1 Resultant",
            priority AS "Priority", notes AS "Notes for understanding"
     FROM map2 WHERE rule_set_id=$1`, [rsId]
  )
  const { rows: m3 } = await query(
    `SELECT constitution, keywords AS "Keyword",
            mapping1_resultant AS "Mapping1 Resultant",
            mapping2_resultant AS "Mapping2 Resultant",
            mapping3_resultant AS "Mapping3 Resultant",
            priority AS "Priority", notes AS "Notes for understanding"
     FROM map3 WHERE rule_set_id=$1`, [rsId]
  )

  const addSheet = (name, data) => {
    if (!data.length) return
    const ws = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  addSheet('LevelFormat', lf.map(r => ({
    Constitution: r.constitution, ALIE: r.alie,
    'Level 1': r.level1, 'Level 2': r.level2, 'Level 3': r.level3,
    'Level 4': r.level4, 'Level 5': r.level5, 'Level 6': r.level6, 'Level 7': r.level7
  })))
  addSheet('Map1', m1)
  addSheet('Map2', m2)
  addSheet('Map3', m3)

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
