import { BrowserWindow } from 'electron'
import { ipcMain } from '../ipc-registry.js'
import { query } from '../db/client.js'
import { missingAlieRows } from '../services/missing-alie.js'

export function registerFinancialHandlers() {
  ipcMain.handle('financials:getMissingAlie', async (_, tbId) => missingAlieRows(null, [tbId]))
  ipcMain.handle('financials:getConsolidatedMissingAlie', async (_, entityId, tbIds) => {
    if (!Array.isArray(tbIds)) throw new Error('Select the Trial Balances of the Financial Year.')
    return missingAlieRows(entityId, tbIds)
  })
  ipcMain.handle('financials:getData', async (_, tbId) => {
    const { rows } = await query(`
      SELECT
        mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
        mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value, mt.status, mt.override_note,
        tr.name          AS ledger_name,
        tr.name,
        tr.ledger_code,
        mt.id            AS mapped_id,
        mt.tb_row_id,
        mt.tb_id,
        tr.opening_balance,
        tr.closing_balance,
        tr.trail_balance,
        tr.is_deemed_positive,
        tr.upload_nature,
        tr.stock_head,
        lf.id            AS lf_id,
        -- When a level_format row is matched, its alie is authoritative (e.g. lf.alie='ASSETS'
        -- for Cash and bank balances overrides mt.alie='EQUITY AND LIABILITIES' from wrong trial_balance_type)
        COALESCE(lf.alie, mt.alie, lf3.alie) as alie,
        COALESCE(lf.level1, mt.mapping1_resultant)  AS level1,
        COALESCE(lf.level2, mt.mapping2_resultant)  AS level2,
        COALESCE(lf.level3, mt.mapping3_resultant)  AS level3,
        lf.level4,
        lf.level5        AS lf_level5,
        lf.level6        AS lf_level6,
        lf.level7        AS lf_level7,
        -- Use lf.sort_order when level_format_id is set; otherwise look up by M1+M2
        -- so Share Capital (sort=0) always precedes Reserves and surplus (sort=1)
        COALESCE(lf.sort_order, lf_m2.sort_order, lf3.sort_order) AS sort_order
      FROM mapped_tb mt
      JOIN tb_rows tr ON tr.id = mt.tb_row_id
      LEFT JOIN level_format lf ON lf.id = mt.level_format_id
      LEFT JOIN level_format lf3 ON lf3.id = (
        SELECT id FROM level_format
        WHERE rule_set_id = mt.rule_set_id
          AND level1 = mt.mapping1_resultant
          AND alie IS NOT NULL
        LIMIT 1
      ) AND mt.alie IS NULL AND lf.alie IS NULL
      -- Lookup by M1+M2 to get per-L2 sort_order when level_format_id is NULL
      -- Use LOWER() for case-insensitive match (e.g. 'Share capital' vs 'Share Capital')
      LEFT JOIN level_format lf_m2 ON lf_m2.id = (
        SELECT id FROM level_format
        WHERE rule_set_id = mt.rule_set_id
          AND lower(level1) = lower(mt.mapping1_resultant)
          AND lower(level2) = lower(mt.mapping2_resultant)
        LIMIT 1
      ) AND lf.id IS NULL
      WHERE mt.tb_id = $1
        AND mt.status IN (
          'auto_high', 'auto_medium', 'auto_low',
          'user_approved', 'user_override'
        )
        AND COALESCE(lf.alie, mt.alie, lf3.alie) IS NOT NULL
      ORDER BY
        COALESCE(lf.sort_order, lf_m2.sort_order, lf3.sort_order) NULLS LAST,
        COALESCE(lf.alie, mt.alie),
        COALESCE(lf.level1, mt.mapping1_resultant),
        COALESCE(lf.level2, mt.mapping2_resultant),
        COALESCE(lf.level3, mt.mapping3_resultant)
    `, [tbId])
    return rows
  })

  // ── Consolidated financial data (all branch TBs for an entity) ──────────
  const FINANCIAL_SELECT = `
    SELECT
      mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
      mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value, mt.status, mt.override_note,
      tr.name AS ledger_name, tr.name, tr.ledger_code,
      mt.id AS mapped_id, mt.tb_row_id, mt.tb_id,
      tr.opening_balance, tr.closing_balance, tr.trail_balance, tr.is_deemed_positive, tr.upload_nature, tr.stock_head,
      lf.id AS lf_id,
      COALESCE(lf.alie, mt.alie, lf3.alie) AS alie,
      COALESCE(lf.level1, mt.mapping1_resultant)  AS level1,
      COALESCE(lf.level2, mt.mapping2_resultant)  AS level2,
      COALESCE(lf.level3, mt.mapping3_resultant)  AS level3,
      lf.level4,
      lf.level5  AS lf_level5,
      lf.level6  AS lf_level6,
      lf.level7  AS lf_level7,
      COALESCE(lf.sort_order, lf_m2.sort_order, lf3.sort_order) AS sort_order,
      tb.branch_name AS branch_name
    FROM mapped_tb mt
    JOIN tb_rows tr ON tr.id = mt.tb_row_id
    JOIN trial_balances tb ON tb.id = mt.tb_id
    LEFT JOIN level_format lf ON lf.id = mt.level_format_id
    LEFT JOIN level_format lf3 ON lf3.id = (
      SELECT id FROM level_format
      WHERE rule_set_id = mt.rule_set_id AND level1 = mt.mapping1_resultant AND alie IS NOT NULL
      LIMIT 1
    ) AND mt.alie IS NULL AND lf.alie IS NULL
    LEFT JOIN level_format lf_m2 ON lf_m2.id = (
      SELECT id FROM level_format
      WHERE rule_set_id = mt.rule_set_id
        AND lower(level1) = lower(mt.mapping1_resultant)
        AND lower(level2) = lower(mt.mapping2_resultant)
      LIMIT 1
    ) AND lf.id IS NULL
    WHERE tb.entity_id = $1
      AND ($2 IS NULL OR tb.id IN (SELECT value FROM json_each($2)))
      AND mt.status IN ('auto_high','auto_medium','auto_low','user_approved','user_override')
      AND COALESCE(lf.alie, mt.alie, lf3.alie) IS NOT NULL
    ORDER BY
      COALESCE(lf.sort_order, lf_m2.sort_order, lf3.sort_order) NULLS LAST,
      COALESCE(lf.alie, mt.alie),
      COALESCE(lf.level1, mt.mapping1_resultant),
      COALESCE(lf.level2, mt.mapping2_resultant),
      COALESCE(lf.level3, mt.mapping3_resultant)
  `

  // tbIds: the Trial Balances that make up this consolidation (one Financial Year's). Without it every Trial Balance of the Auditee,
  // of every year, was added together.
  ipcMain.handle('financials:getConsolidatedData', async (_, entityId, tbIds) => {
    const ids = Array.isArray(tbIds) ? tbIds.map(Number).filter(Number.isInteger) : null
    const { rows } = await query(FINANCIAL_SELECT, [entityId, ids])
    return rows
  })

  // ── Per-branch data for columnar view ────────────────────────────────────
  ipcMain.handle('financials:getBranchTBsData', async (_, entityId, tbIds = null) => {
    const { rows: tbs } = await query(
      `SELECT id, branch_name, period FROM trial_balances WHERE entity_id=$1
       AND ($2 IS NULL OR id IN (SELECT value FROM json_each($2))) ORDER BY branch_name`,
      [entityId, tbIds]
    )
    const result = []
    for (const tb of tbs) {
      const { rows } = await query(`
        SELECT
          mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
          mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value, mt.status, mt.override_note,
          tr.name AS ledger_name, tr.name, tr.ledger_code,
          mt.id AS mapped_id, mt.tb_row_id, mt.tb_id,
          tr.opening_balance, tr.closing_balance, tr.trail_balance, tr.is_deemed_positive, tr.upload_nature, tr.stock_head,
          lf.id AS lf_id,
          COALESCE(lf.alie, mt.alie, lf3.alie) AS alie,
          COALESCE(lf.level1, mt.mapping1_resultant) AS level1,
          COALESCE(lf.level2, mt.mapping2_resultant) AS level2,
          COALESCE(lf.level3, mt.mapping3_resultant) AS level3,
          lf.level4,
          lf.level5 AS lf_level5, lf.level6 AS lf_level6, lf.level7 AS lf_level7,
          COALESCE(lf.sort_order, lf_m2.sort_order, lf3.sort_order) AS sort_order
        FROM mapped_tb mt
        JOIN tb_rows tr ON tr.id = mt.tb_row_id
        LEFT JOIN level_format lf ON lf.id = mt.level_format_id
        LEFT JOIN level_format lf3 ON lf3.id = (
          SELECT id FROM level_format WHERE rule_set_id=mt.rule_set_id AND level1=mt.mapping1_resultant AND alie IS NOT NULL LIMIT 1
        ) AND mt.alie IS NULL AND lf.alie IS NULL
        LEFT JOIN level_format lf_m2 ON lf_m2.id = (
          SELECT id FROM level_format WHERE rule_set_id=mt.rule_set_id AND lower(level1)=lower(mt.mapping1_resultant) AND lower(level2)=lower(mt.mapping2_resultant) LIMIT 1
        ) AND lf.id IS NULL
        WHERE mt.tb_id=$1
          AND mt.status IN ('auto_high','auto_medium','auto_low','user_approved','user_override')
          AND COALESCE(lf.alie, mt.alie, lf3.alie) IS NOT NULL
        ORDER BY COALESCE(lf.sort_order, lf_m2.sort_order, lf3.sort_order) NULLS LAST,
          COALESCE(lf.alie, mt.alie), COALESCE(lf.level1, mt.mapping1_resultant),
          COALESCE(lf.level2, mt.mapping2_resultant), COALESCE(lf.level3, mt.mapping3_resultant)
      `, [tb.id])
      result.push({ tbId: tb.id, branchName: tb.branch_name || `Branch ${tb.id}`, period: tb.period, rows,
        missingAlieRows: await missingAlieRows(entityId, [tb.id]) })
    }
    return result
  })

  // ── PDF generation via Electron's printToPDF (A4, print-quality) ────────
  ipcMain.handle('financials:renderPDF', async (_, html) => {
    // Create a hidden window to render the HTML
    const pdfWindow = new BrowserWindow({
      show: false,
      width: 794,   // ~A4 width at 96dpi
      height: 1123, // ~A4 height
      // No preload, sandboxed. JavaScript stays on: the document's own
      // flowLayoutScript paginates the Notes/Annexures and the loop below polls
      // window.__flowDone through executeJavaScript.
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        offscreen: false,
      },
    })

    // The document may contain client-entered text: it must not navigate away
    // or open further windows.
    pdfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    pdfWindow.webContents.on('will-navigate', (navEvent) => navEvent.preventDefault())

    // Load the HTML via data URL
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    await pdfWindow.loadURL(dataUrl)

    // Wait a moment for rendering, then for the Notes / Annexures page layout
    // (buildHTML.js's flowLayoutScript) to finish measuring and filling pages.
    // Documents without flowing sections, or a script that never reports back,
    // print after a short wait / the 20s cap exactly as before.
    await new Promise(resolve => setTimeout(resolve, 300))
    const layoutDeadline = Date.now() + 20000
    while (Date.now() < layoutDeadline) {
      const ready = await pdfWindow.webContents.executeJavaScript(
        "!document.querySelector('.flow-section') || window.__flowDone === true"
      ).catch(() => true)
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    try {
      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        pageSize: 'A4',
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        printBackground: true,
        landscape: false,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      })
      return pdfBuffer
    } finally {
      pdfWindow.close()
    }
  })
}
