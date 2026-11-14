// T-024 synthetic checks, called by test-fsg-integration.mjs. No live profile.
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { attachDatabase, query } from '../electron/fsg/db/client.js'
import { seedDefaultMapping } from '../electron/fsg/services/excel.js'
import { runMappingEngine, persistMappingResults } from '../electron/fsg/services/mapping-engine.js'
import { ensureLevel1Fallbacks, LEVEL1_FALLBACK_ADDITIONS, PRE_FALLBACK_WORKBOOK_HASH, FALLBACK_WORKBOOK_HASH } from '../electron/fsg/db/level1-fallbacks.js'
import { getRegisteredHandlers } from '../electron/fsg/ipc-registry.js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

export async function checkLevel1Fallbacks({ Database, root, userData, originalDb, check, renderPdf }) {
  const bytes = readFileSync(join(root, 'electron/fsg/assets/Mapping_v2.xlsx'))
  const workbook = XLSX.read(bytes)
  const sheet = name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null })
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const levelRows = sheet('LevelFormat')
  check('T-024 workbook adds exactly five terminal fallback rows', levelRows.length === 684
    && LEVEL1_FALLBACK_ADDITIONS.every(([c,a,l]) => levelRows.filter(r => r.Constitution === c && r.ALIE === a && r['Level 1'] === l
      && [2,3,4,5,6,7].every(n => r[`Level ${n}`] === null)).length === 1))
  check('T-024 original LevelFormat rows and Map1/2/3 rules remain unchanged',
    hash(levelRows.slice(0,679)) === '0a0f36d9d99bd4def7dee41ce485958842a72717d136c444e23410967d70e974'
    && hash(sheet('Map1')) === '0c8af4ac090586064d60f5162075654d92d87cb6a65928ca8694f2ea128a6121'
    && hash(sheet('Map2')) === '1d6f95fe60ff96ff373f6459e5d9df5e11626d39f2b2321feca7969a1fffd245'
    && hash(sheet('Map3')) === '9deedb94cf057005b85e997075214fb26ae9474a2075b5bd5ea7391ffb396dbe')
  check('T-024 additive upgrade fingerprint matches the shipped workbook',
    createHash('sha256').update(bytes).digest('hex') === FALLBACK_WORKBOOK_HASH)

  const fixturePath = join(userData, 'fallback-upgrade.db')
  const db = new Database(fixturePath)
  try {
    db.pragma('foreign_keys = ON')
    for (const f of readdirSync(join(root,'sqlite/schema')).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(root,'sqlite/schema',f),'utf8'))
    attachDatabase(db)
    const rsId = await seedDefaultMapping()
    for (const [c,a,l] of LEVEL1_FALLBACK_ADDITIONS) db.prepare('DELETE FROM level_format WHERE constitution=? AND alie=? AND level1=?').run(c,a,l)
    db.prepare('DELETE FROM schema_migrations WHERE key=?').run(`mapping_seed:${FALLBACK_WORKBOOK_HASH}`)
    db.prepare('INSERT INTO schema_migrations (key) VALUES (?)').run(`mapping_seed:${PRE_FALLBACK_WORKBOOK_HASH}`)
    db.exec(`INSERT INTO clients (id,name,constitution) VALUES ('fallback-owner','Synthetic Fallback Company','company');
      INSERT INTO entities (client_id,name,constitution,constitution_display) VALUES ('fallback-owner','Synthetic Fallback Company',3,'Company');
      INSERT INTO financial_periods (year_label,date_from,date_till) VALUES ('2024-25','2024-04-01','2025-03-31');
      INSERT INTO entity_periods (entity_id,financial_period_id,locked,is_final,final_sign_place) VALUES (1,1,1,1,'Recorded place');
      INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (1,1,'2024-25');
      INSERT INTO tb_rows (tb_id,name,closing_balance,imported_closing_balance) VALUES (1,'Existing ledger',-100.25,-100.25);
      INSERT INTO note_details (tb_id,note_num,note_title,data) VALUES (1,1,'Saved disclosure','{"value":"preserve"}');`)
    const lfId = db.prepare('SELECT id FROM level_format WHERE rule_set_id=? AND constitution=3 LIMIT 1').get(rsId).id
    db.prepare(`INSERT INTO mapped_tb (tb_id,tb_row_id,rule_set_id,level_format_id,alie,mapping1_resultant,status,hand_fixed,override_note)
      VALUES (1,1,?,?,'EQUITY AND LIABILITIES','User chosen category','user_override',1,'User basis')`).run(rsId,lfId)
    const customId = db.prepare(`INSERT INTO mapping_rule_sets (name,entity_id) VALUES ('Custom rules',1) RETURNING id`).get().id
    db.prepare(`INSERT INTO level_format (rule_set_id,constitution,alie,level1,level2,sort_order) VALUES (?,3,'ASSETS','Custom assets','Custom line',42)`).run(customId)
    const snapshot = () => Object.fromEntries(['mapped_tb','tb_rows','trial_balances','entity_periods','note_details','map1','map2','map3'].map(t => [t,db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]))
    const before = snapshot()
    const beforeFormats = db.prepare('SELECT * FROM level_format ORDER BY id').all()
    // Interrupt after some inserts: neither partial additions nor seed marker may survive.
    db.exec(`CREATE TRIGGER fail_fallback BEFORE INSERT ON level_format WHEN NEW.level1='Uncategorised Expenses'
      BEGIN SELECT RAISE(ABORT,'Synthetic fallback upgrade failure'); END;`)
    let failed = false
    try { await seedDefaultMapping() } catch (_) { failed = true }
    check('T-024 failed upgrade rolls back all additions and the seed marker', failed
      && JSON.stringify(db.prepare('SELECT * FROM level_format ORDER BY id').all()) === JSON.stringify(beforeFormats)
      && !db.prepare('SELECT key FROM schema_migrations WHERE key=?').get(`mapping_seed:${FALLBACK_WORKBOOK_HASH}`))
    db.exec('DROP TRIGGER fail_fallback')
    const backupsDir = join(userData,'fsg/backups')
    const previousBackups = new Set(readdirSync(backupsDir))
    await seedDefaultMapping()
    const upgradeBackup = readdirSync(backupsDir).find(f => !previousBackups.has(f) && f.startsWith('audit_assistant-before-T024-'))
    check('T-024 existing default and client rule sets receive only missing fallbacks', db.prepare('SELECT COUNT(*) n FROM level_format').get().n === beforeFormats.length + 8)
    const originalIds = new Set(beforeFormats.map(r => r.id))
    check('T-024 additive upgrade preserves master IDs, overrides, signed balances, notes and final years',
      JSON.stringify(db.prepare('SELECT * FROM level_format ORDER BY id').all().filter(r => originalIds.has(r.id))) === JSON.stringify(beforeFormats)
      && JSON.stringify(snapshot()) === JSON.stringify(before))
    const countAfter = db.prepare('SELECT COUNT(*) n FROM level_format').get().n
    await seedDefaultMapping()
    const repeat = await ensureLevel1Fallbacks()
    check('T-024 restart is idempotent without replacing mapping IDs', repeat.inserted === 0 && repeat.backupPath === null
      && db.prepare('SELECT COUNT(*) n FROM level_format').get().n === countAfter && JSON.stringify(snapshot()) === JSON.stringify(before))
    const restoredPath = join(userData,'fallback-restored.db')
    copyFileSync(join(backupsDir,upgradeBackup),restoredPath)
    const restored = new Database(restoredPath)
    attachDatabase(restored)
    check('T-024 upgrade backup restores the original rules and signed balance',
      JSON.stringify(restored.prepare('SELECT * FROM level_format ORDER BY id').all()) === JSON.stringify(beforeFormats)
      && restored.prepare('SELECT closing_balance FROM tb_rows WHERE id=1').get().closing_balance === -100.25)
    await seedDefaultMapping()
    check('T-024 restored database can retry the additive upgrade', restored.prepare('SELECT COUNT(*) n FROM level_format').get().n === countAfter
      && restored.pragma('integrity_check',{simple:true}) === 'ok')
    restored.close()
    attachDatabase(db)

    // Exercise the same renderer processors and export builders used by the UI.
    const bundled = require('esbuild').buildSync({ stdin: { contents: `
      export { processRows } from './src/modules/fsg/hooks/useFinancials.js';
      export { computeCompanyBSLayout, computeDynamicBSLayout } from './src/modules/fsg/utils/bsStructure.js';
      export { buildFinancialsHTML } from './src/modules/fsg/components/GenerateFinancials/buildHTML.js';
      export { buildFinancialsWorkbook } from './src/modules/fsg/components/GenerateFinancials/buildExcel.js';`, resolveDir: root },
      absWorkingDir: root, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
    const rendererPath = join(userData,'fallback-renderer.cjs')
    writeFileSync(rendererPath,bundled.outputFiles[0].contents)
    const renderer = require(rendererPath)
    const getFinancials = getRegisteredHandlers().get('financials:getData')
    const fmt = n => Number(n).toLocaleString('en-IN',{maximumFractionDigits:0})
    for (const c of [3,1,2]) {
      const client = `fallback-${c}`
      db.prepare('INSERT INTO clients (id,name,constitution) VALUES (?,?,?)').run(client,`Synthetic ${c}`,c===3?'company':c===2?'llp':'partnership')
      const entity = db.prepare('INSERT INTO entities (client_id,name,constitution,constitution_display) VALUES (?,?,?,?) RETURNING *').get(client,`Synthetic ${c}`,c,c===3?'Company':c===2?'LLP':'Partnership')
      const ep = db.prepare('INSERT INTO entity_periods (entity_id,financial_period_id) VALUES (?,1) RETURNING id').get(entity.id).id
      const tb = db.prepare('INSERT INTO trial_balances (entity_id,entity_period_id,period) VALUES (?,?,?) RETURNING *').get(entity.id,ep,'2024-25')
      const insertRow = db.prepare(`INSERT INTO tb_rows (tb_id,name,parent,closing_balance,opening_balance,trial_balance_type)
        VALUES (?,?,'ZZ Unrecognised hierarchy',?,?,?)`)
      const fixtures = [['ZZ asset',-130000,'assets'],['ZZ liability',100000,'liabilities'],['ZZ income',60000,'income'],['ZZ expense',-30000,'expenses'],['ZZ zero',0,'expenses']]
      for (const [name,amount,type] of fixtures) insertRow.run(tb.id,name,amount,amount/2,type)
      const results = await runMappingEngine(tb.id,rsId,c)
      await persistMappingResults(results)
      check(`T-024 constitution ${c}: known-ALIE fallback is terminal, low-confidence and linked to its master`, results.length === 5 && results.every(r =>
        r.status === 'auto_low' && r.confidence === 'low' && r.level_format_id && r.mapping2_resultant === null && r.mapping3_resultant === null))
      const rows = await getFinancials({},tb.id)
      const lf = db.prepare('SELECT * FROM level_format WHERE rule_set_id=? AND constitution=?').all(rsId,c)
      const processed = renderer.processRows(rows,null,c,[],null,false,false,null,lf)
      processed.levelFormat = lf
      processed.generalNotes = { points: [] }
      const unresolvedProfitGap = c === 3 ? 0 : 30000
      check(c === 3 ? 'T-024 company: balanced all-fallback TB reconciles including P&L and PY figures'
        : `T-024 constitution ${c}: all-fallback equity leaves the existing unresolved profit transfer visible`,
        Math.abs((processed.totalAssets - processed.totalEL) - unresolvedProfitGap) < .005 && processed.totalIncome === 60000
        && processed.totalExpenses === 30000 && processed.netProfit === 30000 && processed.prevNetProfit === 15000
        && rows.length === fixtures.length,
        {assets:processed.totalAssets,equityLiabilities:processed.totalEL,profit:processed.netProfit,expectedGap:unresolvedProfitGap})
      const options = { entity,activeTB:tb,data:processed,levelFormat:lf,signatories:[],signPlace:'Synthetic place',signDate:'2026-11-10',denomination:'no_dec' }
      const html = renderer.buildFinancialsHTML(options)
      const wb = renderer.buildFinancialsWorkbook(options)
      const excelBytes = require('xlsx-js-style').write(wb,{type:'buffer',bookType:'xlsx'})
      const reopened = XLSX.read(excelBytes)
      const excelRows = reopened.SheetNames.flatMap(n => XLSX.utils.sheet_to_json(reopened.Sheets[n],{header:1}))
      const labels = ['Uncategorised Equity and Liabilities','Uncategorised Income','Uncategorised Expenses']
      check(`T-024 constitution ${c}: HTML/PDF source and reopened Excel retain fallback captions and figures`,
        labels.every(l => html.includes(l) && excelRows.some(row => row.some(v => String(v).includes(l))))
        && [100000,60000,30000].every(n => html.includes(fmt(n)) && excelRows.some(row => row.some(v => Number(v) === n))),
        { labels: labels.map(l => ({ label:l,html:html.includes(l),excel:excelRows.some(row=>row.some(v=>String(v).includes(l))) })),
          figures: [100000,60000,30000].map(n=>({n,html:html.includes(fmt(n)),excel:excelRows.some(row=>row.some(v=>Number(v)===n))})) })
      if (c === 3) {
        const pdfResult = await renderPdf(html)
        if (!pdfResult.ok) throw new Error(pdfResult.error)
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const document = await pdfjs.getDocument({data:new Uint8Array(pdfResult.result),useSystemFonts:true}).promise
        let content = ''
        for (let p = 1;p<=document.numPages;p++) content += (await (await document.getPage(p)).getTextContent()).items.map(i=>i.str).join(' ') + ' '
        check('T-024 actual PDF contains the unresolved fallback categories and figures',labels.every(l => content.includes(l))
          && [100000,60000,30000].every(n => content.includes(fmt(n))))
        await document.destroy()
      }
      if (c !== 3) {
        // The original non-corporate profit-transfer rule requires an actual
        // classified equity heading. Supply it explicitly, without a plug.
        insertRow.run(tb.id,'ZZ classified capital',1000,500,'liabilities')
        db.prepare("UPDATE tb_rows SET parent='Capital Account',group_parent='Capital Account' WHERE tb_id=? AND name='ZZ classified capital'").run(tb.id)
        db.prepare("UPDATE tb_rows SET closing_balance=99000,opening_balance=49500 WHERE tb_id=? AND name='ZZ liability'").run(tb.id)
        await persistMappingResults(await runMappingEngine(tb.id,rsId,c))
        const withEquity = renderer.processRows(await getFinancials({},tb.id),null,c,[],null,false,false,null,lf)
        check(`T-024 constitution ${c}: balanced TB with an identified equity heading and other fallback ledgers reconciles`,
          Math.abs(withEquity.totalAssets-withEquity.totalEL) < .005 && withEquity.netProfit === 30000,
          {assets:withEquity.totalAssets,equityLiabilities:withEquity.totalEL})
      }
      // A one-unit source imbalance must stay visible, never be plugged away.
      db.prepare('UPDATE tb_rows SET closing_balance=-130001 WHERE tb_id=? AND name=?').run(tb.id,'ZZ asset')
      const unbalancedRows = await getFinancials({},tb.id)
      const unbalanced = renderer.processRows(unbalancedRows,null,c,[],null,false,false,null,lf)
      check(`T-024 constitution ${c}: unbalanced TB remains unbalanced by its source difference`,
        Math.abs((unbalanced.totalAssets-unbalanced.totalEL)-1) < .005)
      db.prepare('UPDATE tb_rows SET closing_balance=-70000 WHERE tb_id=? AND name=?').run(tb.id,'ZZ asset')
      db.prepare('UPDATE tb_rows SET closing_balance=20000 WHERE tb_id=? AND name=?').run(tb.id,'ZZ income')
      db.prepare('UPDATE tb_rows SET closing_balance=-50000 WHERE tb_id=? AND name=?').run(tb.id,'ZZ expense')
      const loss = renderer.processRows(await getFinancials({},tb.id),null,c,[],null,false,false,null,lf)
      check(`T-024 constitution ${c}: fallback loss flows to equity without changing source balances`,
        loss.netProfit === -30000 && Math.abs(loss.totalAssets-loss.totalEL) < .005)
      db.prepare("UPDATE tb_rows SET closing_balance=-130000 WHERE tb_id=? AND name='ZZ asset'").run(tb.id)
      db.prepare("UPDATE tb_rows SET closing_balance=60000 WHERE tb_id=? AND name='ZZ income'").run(tb.id)
      db.prepare("UPDATE tb_rows SET closing_balance=-30000 WHERE tb_id=? AND name='ZZ expense'").run(tb.id)
      insertRow.run(tb.id,'Accumulated Depreciation',5000,0,'assets')
      insertRow.run(tb.id,'ZZ contra income',-5000,0,'income')
      await persistMappingResults(await runMappingEngine(tb.id,rsId,c))
      const contra = renderer.processRows(await getFinancials({},tb.id),null,c,[],null,false,false,null,lf)
      check(`T-024 constitution ${c}: contra source signs and existing abnormal-income reclassification are preserved`,
        contra.totalAssets === 125000 && contra.totalIncome === 60000 && contra.totalExpenses === 35000 && contra.netProfit === 25000
        && Math.abs(contra.totalAssets-contra.totalEL) < .005
        && db.prepare("SELECT closing_balance FROM tb_rows WHERE tb_id=? AND name='Accumulated Depreciation'").get(tb.id).closing_balance === 5000
        && db.prepare("SELECT closing_balance FROM tb_rows WHERE tb_id=? AND name='ZZ contra income'").get(tb.id).closing_balance === -5000,
        {assets:contra.totalAssets,equityLiabilities:contra.totalEL,income:contra.totalIncome,expenses:contra.totalExpenses,profit:contra.netProfit})
      insertRow.run(tb.id,'ZZ unknown ALIE',0,0,null)
      const unknown = (await runMappingEngine(tb.id,rsId,c)).find(r => !r.alie)
      check(`T-024 constitution ${c}: unknown ALIE is not guessed or marked as a classified fallback`,unknown?.status === 'unmapped' && unknown.confidence === 'none')
    }
  } finally {
    db.close()
    attachDatabase(originalDb)
  }
}
