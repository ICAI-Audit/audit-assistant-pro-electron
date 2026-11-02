import { query } from './client.js'

// ICAI VERA (SQLite) port of FSG_Bharat's src/main/db/schema.js.
// All DDL (tables, columns, indexes, the tb_rows adjusted-closing CHECK) now
// lives in sqlite/schema/10_fsg_tables.sql, which VERA executes at start-up
// before any FSG code runs. ensureSchema() keeps only the data repairs and
// one-time migrations FSG ran on every boot, in their original order, with the
// SQL converted to SQLite. The PostgreSQL catalog probes (information_schema,
// pg_constraint) went with the DDL. The one-time hand_fixed backfill, which ran
// only when the column was first added, no longer applies: the column is
// created with the table.

// One-time migration marker. Used to gate work that must run exactly once
// against the shared database (not once per client boot) — e.g. reseeding
// the default mapping from Mapping_v2.xlsx. Plain idempotent statements
// below (CREATE TABLE IF NOT EXISTS, guarded UPDATE/INSERT...WHERE NOT
// EXISTS) don't need this: they're safe to run on every boot, and
// index.js's withStartupLock() serializes concurrent clients so there's no
// race even during first-ever setup.
export async function tryClaimMigration(key) {
  const { rows } = await query(
    `INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key]
  )
  return rows.length > 0
}

export async function ensureSchema() {
  // ── Backfill ALIE for rows that are missing it ───────────────────────────────
  await query(`
    UPDATE mapped_tb SET alie = (
      SELECT lf.alie FROM level_format lf
      WHERE lf.level1 = mapped_tb.mapping1_resultant
        AND lf.rule_set_id = mapped_tb.rule_set_id
        AND lf.alie IS NOT NULL
      LIMIT 1
    )
    WHERE alie IS NULL AND mapping1_resultant IS NOT NULL
  `)

  // ── Repair stock row mappings ────────────────────────────────────────────────
  // Guarded like the other backfills below: skip rows the user has already
  // reviewed/overridden, so this doesn't silently revert manual reclassification
  // of stock ledgers on every app boot.
  await query(`
    UPDATE mapped_tb SET
      alie = 'Expenses',
      mapping1_resultant = 'Opening Stock (PL)',
      mapping2_resultant = 'Opening Stock',
      mapping3_resultant = 'Opening Stock'
    WHERE status NOT IN ('user_override', 'user_approved')
      AND tb_row_id IN (
      SELECT id FROM tb_rows
      WHERE upload_nature = 'Stock Entry' AND name LIKE 'Opening Stock -%'
    )
  `)
  await query(`
    UPDATE mapped_tb SET
      alie = 'Income',
      mapping1_resultant = 'Closing Stock (PL)',
      mapping2_resultant = 'Closing Stock',
      mapping3_resultant = 'Closing Stock'
    WHERE status NOT IN ('user_override', 'user_approved')
      AND tb_row_id IN (
      SELECT id FROM tb_rows
      WHERE upload_nature = 'Stock Entry' AND name LIKE 'Closing Stock - PL -%'
    )
  `)
  await query(`
    UPDATE mapped_tb SET
      alie = 'ASSETS',
      mapping1_resultant = 'Current assets',
      mapping2_resultant = 'Inventories',
      mapping3_resultant = 'Closing Stock (BS)'
    WHERE status NOT IN ('user_override', 'user_approved')
      AND tb_row_id IN (
      SELECT id FROM tb_rows
      WHERE upload_nature = 'Stock Entry' AND name LIKE 'Closing Stock - BS -%'
    )
  `)

  // ── Backfill level_format_id on user-decided rows ────────────────────────────
  // Every categorisation screen used to send level_format_id = NULL whenever
  // its client-side lookup missed — always, for a terminal Level 1 such as
  // Finance Costs — so 827 of 1,381 user-decided rows on the dev database had
  // no format row and rendered with blank Level columns. mappedTB:override now
  // resolves the id server-side; this fills the gap for rows saved before that.
  // Strictly NULL -> id: rows that already carry an id are untouched, and rows
  // with no matching format row stay NULL. Preference: exact Level 3 > the
  // Level-2 row > the terminal Level-1 row, mirroring RESOLVE_LF_SQL.
  await query(`
    UPDATE mapped_tb AS mt SET level_format_id = (
      SELECT lf.id FROM level_format lf
      WHERE lf.rule_set_id = mt.rule_set_id
        AND LOWER(TRIM(REPLACE(lf.level1, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping1_resultant, '(specify nature)', '')))
        AND (
          (mt.mapping2_resultant IS NULL AND lf.level2 IS NULL)
          OR (mt.mapping2_resultant IS NOT NULL AND lf.level2 IS NOT NULL
              AND LOWER(TRIM(REPLACE(lf.level2, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping2_resultant, '(specify nature)', ''))))
        )
      ORDER BY
        CASE WHEN mt.mapping3_resultant IS NOT NULL AND lf.level3 IS NOT NULL
                  AND LOWER(TRIM(REPLACE(lf.level3, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping3_resultant, '(specify nature)', ''))) THEN 0
             WHEN lf.level3 IS NULL THEN 1
             ELSE 2 END,
        lf.id
      LIMIT 1
    )
    WHERE mt.level_format_id IS NULL
      AND mt.status IN ('user_override', 'user_approved')
      AND mt.mapping1_resultant IS NOT NULL
      AND mt.rule_set_id IS NOT NULL
  `)

  // ── Ensure Sale of Products / Sale of Services L3 entries exist ──────────────
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT DISTINCT lf.rule_set_id, lf.constitution, lf.alie, lf.level1, lf.level2,
                    'Sale of Products', lf.sort_order
    FROM level_format lf
    WHERE lf.level1 = 'Revenue from operations'
      AND lf.level2 = 'Sale'
      AND (lf.level3 IS NULL OR TRIM(lf.level3) = '')
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id
          AND lf2.constitution = lf.constitution
          AND lf2.level1 = lf.level1
          AND lf2.level2 = lf.level2
          AND lf2.level3 = 'Sale of Products'
      )
  `)
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT DISTINCT lf.rule_set_id, lf.constitution, lf.alie, lf.level1, lf.level2,
                    'Sale of Services', lf.sort_order
    FROM level_format lf
    WHERE lf.level1 = 'Revenue from operations'
      AND lf.level2 = 'Sale'
      AND (lf.level3 IS NULL OR TRIM(lf.level3) = '')
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id
          AND lf2.constitution = lf.constitution
          AND lf2.level1 = lf.level1
          AND lf2.level2 = lf.level2
          AND lf2.level3 = 'Sale of Services'
      )
  `)

  // ── Backfill Uncategorised Sale mapping3 ─────────────────────────────────────
  await query(`
    UPDATE mapped_tb
    SET mapping3_resultant = 'Uncategorised Sale'
    WHERE mapping1_resultant = 'Revenue from operations'
      AND mapping2_resultant = 'Sale'
      AND (mapping3_resultant IS NULL OR mapping3_resultant = '')
      AND status NOT IN ('user_override', 'user_approved')
  `)

  // ── Clear phantom Uncategorised L3 where L2 is terminal ──────────────────────
  await query(`
    UPDATE mapped_tb
    SET mapping3_resultant = NULL
    WHERE mapping3_resultant LIKE 'Uncategorised %'
      AND status NOT IN ('user_override', 'user_approved')
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf
        WHERE lf.rule_set_id = mapped_tb.rule_set_id
          AND lf.level1 = mapped_tb.mapping1_resultant
          AND lf.level2 = mapped_tb.mapping2_resultant
          AND lf.level3 IS NOT NULL
          AND TRIM(lf.level3) <> ''
          AND LOWER(lf.level3) NOT LIKE 'uncategorised%'
      )
  `)

  // Adjustments saved by 0.1.89 sat beside an UNTOUCHED closing balance. Fold them
  // in once (idempotent: it only ever matches rows that have not been folded in).
  await query(`
    UPDATE tb_rows
       SET imported_closing_balance = COALESCE(closing_balance, 0),
           closing_balance = COALESCE(closing_balance, 0) + COALESCE(adj_credit, 0) - COALESCE(adj_debit, 0)
     WHERE imported_closing_balance IS NULL AND (adj_debit IS NOT NULL OR adj_credit IS NOT NULL)
  `)

  // ── Standardize Secured/Unsecured/Doubtful template ──────────────────────────
  await query(`
    UPDATE level_format
    SET level5 = 'Secured, considered good / Unsecured, considered good / Doubtful'
    WHERE (
            LOWER(level2) LIKE '%loans and advances%'
         OR LOWER(level2) LIKE '%loan and advances%'
         OR level2 = 'Other non-current Assets'
         OR level2 = 'Trade receivables'
        )
      AND level5 IS NOT NULL
      AND level5 IN (
        'Secured / Unsecured',
        'Secured / Unsecured, considered good / Doubtful',
        'Secured considered good/ Unsecured/Doubtful'
      )
  `)

  // ── Trade Payables/Receivables nature: move Level 5 → Level 3 for non-corp
  // (constitution=1) and LLP (constitution=2), matching Company's
  // (constitution=3) structure exactly. The Notes screen's
  // buildNoteTemplateRows() groups ledgers by Level 3 (mapping3_resultant) to
  // build sub-line breakdowns — for Company, "Due to MSME" / "Due to
  // Creditors other than MSME" (and Trade Receivables' Secured/Unsecured/
  // Doubtful) already lives there and shows up automatically. For non-corp/
  // LLP it lived at Level 5 instead, so the exact same ledgers never
  // surfaced as a Notes sub-line breakdown even though every ledger was
  // still being classified (mapping-engine.js's applyTradeAssumption()
  // already handles both Level 3 and Level 5 generically at mapping time).
  // Runs after the Secured/Unsecured wording-standardization above so the
  // copied text is already canonical. Every rule set (not just the default)
  // is fixed in one pass since this only keys off constitution/level2.
  await query(`
    UPDATE level_format
    SET level3 = level5, level5 = NULL
    WHERE constitution IN (1, 2)
      AND level2 IN ('Trade payables', 'Trade receivables')
      AND level3 IS NULL
      AND level5 IS NOT NULL
  `)

  // Retroactively migrate already-mapped ledgers for entities mapped before
  // this fix: carry the classification value from level5_value over to
  // mapping3_resultant (now the correct field), and re-point level_format_id
  // at the corrected row so sort_order/alie stay right. Only touches rows
  // that haven't already been classified at Level 3.
  await query(`
    UPDATE mapped_tb
    SET mapping3_resultant = level5_value,
        level5_value = NULL,
        level_format_id = COALESCE(
          (SELECT lf.id FROM level_format lf
           WHERE lf.rule_set_id = mapped_tb.rule_set_id
             AND lf.level2 = mapped_tb.mapping2_resultant
             AND lf.level3 = mapped_tb.level5_value
           LIMIT 1),
          level_format_id
        )
    WHERE mapping2_resultant IN ('Trade payables', 'Trade receivables')
      AND level5_value IS NOT NULL
      AND (mapping3_resultant IS NULL OR mapping3_resultant = '')
  `)

  // ── Partners' Remuneration: give it its own terminal Level 1 (not nested
  // under Employee benefits expense / Other expenses) for Partnership
  // (constitution=1) and LLP (constitution=2) ──────────────────────────────
  // Previously: a Map2 rule (constitution=1) nested "Salary to Partner"-style
  // ledgers under Level 1 "Other expenses", and Map3 rules (constitution=1
  // and 2) routed the same keywords to Level 1 "Employee benefits expense" —
  // both wrong; Partners'/LLP members' remuneration is its own P&L face line
  // (see plStructureNonCorp.js's "Partners' remuneration" row), and
  // constitution=2 already had the correct terminal LevelFormat entry.
  // Mapping_v2.xlsx has been corrected the same way (Map1 refinement keyword
  // row added, the two wrong Map2/Map3 rules removed) so the default rule set
  // (id via seedDefaultMapping) gets this from the next reseed — this
  // migration additionally fixes any OTHER already-seeded rule set and any
  // ledger mapped before the fix.
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1)
    SELECT DISTINCT lf.rule_set_id, 1, 'Expenses', 'Partners'' Remuneration'
    FROM level_format lf
    WHERE lf.constitution = 1
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.constitution = 1 AND lf2.level1 = 'Partners'' Remuneration'
      )
  `)

  await query(`
    INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
    SELECT DISTINCT m.rule_set_id, c.constitution,
      'Rem to Partners | Rem to Partner | Remuneration to Partners | Remuneration to Partner | ' ||
      'Partners Remuneration | Partners'' Remuneration | Partner Remuneration | ' ||
      'Salary to Partner | Salary to Partners | Partners Salary | Partner Salary',
      'Partners'' Remuneration'
    FROM map1 m, (SELECT 1 AS constitution UNION ALL SELECT 2) c
    WHERE m.constitution = c.constitution
      AND NOT EXISTS (
        SELECT 1 FROM map1 m2
        WHERE m2.rule_set_id = m.rule_set_id AND m2.constitution = c.constitution
          AND m2.mapping1_resultant = 'Partners'' Remuneration'
      )
  `)

  // Guard Map2 rule scoped to the new terminal L1, so Stage 2 finds a hit and
  // never falls into the cross-Level-1 discrepancy check — which would
  // otherwise find the generic Employee-benefits "Salary" keyword rule as a
  // competing candidate for a ledger literally named "Salary to Partner" and
  // silently revert it back to Employee benefits expense.
  await query(`
    INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
    SELECT DISTINCT m.rule_set_id, c.constitution,
      'Rem to Partners | Rem to Partner | Remuneration to Partners | Remuneration to Partner | ' ||
      'Partners Remuneration | Partners'' Remuneration | Partner Remuneration | ' ||
      'Salary to Partner | Salary to Partners | Partners Salary | Partner Salary',
      NULL, 'Partners'' Remuneration', 1
    FROM map2 m, (SELECT 1 AS constitution UNION ALL SELECT 2) c
    WHERE m.constitution = c.constitution
      AND NOT EXISTS (
        SELECT 1 FROM map2 m2
        WHERE m2.rule_set_id = m.rule_set_id AND m2.constitution = c.constitution
          AND m2.mapping1_resultant = 'Partners'' Remuneration'
      )
  `)

  // Remove the old, wrong Map2/Map3 rules from every rule set (the ones that
  // sent these same keywords to Other expenses / Employee benefits expense).
  await query(`
    DELETE FROM map2
    WHERE constitution = 1 AND mapping2_resultant = 'Partners'' Remuneration' AND mapping1_resultant = 'Other expenses'
  `)
  await query(`
    DELETE FROM map3
    WHERE constitution IN (1, 2)
      AND mapping1_resultant = 'Employee benefits expense'
      AND mapping3_resultant = 'Partners'' Remuneration'
  `)

  // Retroactively fix ledgers mapped before this fix.
  await query(`
    UPDATE mapped_tb
    SET mapping1_resultant = 'Partners'' Remuneration',
        mapping2_resultant = NULL,
        mapping3_resultant = NULL,
        level_format_id = COALESCE(
          (SELECT lf.id FROM level_format lf
           WHERE lf.rule_set_id = mapped_tb.rule_set_id AND lf.level1 = 'Partners'' Remuneration'
           LIMIT 1),
          level_format_id
        )
    WHERE (mapping1_resultant = 'Employee benefits expense' AND mapping3_resultant = 'Partners'' Remuneration')
       OR (mapping1_resultant = 'Other expenses' AND mapping2_resultant = 'Partners'' Remuneration')
  `)

  // ── Trade Payables/Receivables sign-based reclassification ──────────────
  // See mapping-engine.js's post-pass (applies to every future mapping run,
  // any upload path, any constitution). LevelFormat needs the two new
  // sub-heads first: "Other current assets" currently has NO Level 3
  // breakdown at all in any constitution, so this also gives it one.
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT lf.rule_set_id, lf.constitution, 'ASSETS', lf.level1, 'Other current assets', 'Advance to Suppliers', MAX(lf.sort_order)
    FROM level_format lf
    WHERE lf.level2 = 'Other current assets'
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.level2 = 'Other current assets' AND lf2.level3 = 'Advance to Suppliers'
      )
    GROUP BY lf.rule_set_id, lf.constitution, lf.level1
  `)
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT lf.rule_set_id, lf.constitution, 'EQUITY AND LIABILITIES', lf.level1, 'Other current liabilities', 'Advance from Customers', MAX(lf.sort_order)
    FROM level_format lf
    WHERE lf.level2 = 'Other current liabilities'
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.level2 = 'Other current liabilities' AND lf2.level3 = 'Advance from Customers'
      )
    GROUP BY lf.rule_set_id, lf.constitution, lf.level1
  `)

  // Retroactively reclassify already-mapped ledgers sitting under Trade
  // Payables/Receivables with the abnormal sign, for entities mapped before
  // this fix. Sign check mirrors displayAmt(): Trade Payables (Cr-natured,
  // ALIE = EQUITY AND LIABILITIES) displays as its own raw closing_balance,
  // so a negative raw balance is the abnormal (debit) case; Trade
  // Receivables (Dr-natured, ALIE = ASSETS) displays as -closing_balance, so
  // a *positive* raw balance is the abnormal (credit) case.
  //
  // This is a one-time historical backfill (hence tryClaimMigration below) —
  // the ongoing version of this same reclassification, for every FRESH
  // mapping run, already lives in mapping-engine.js's runMappingEngine(),
  // which mappedTB:run protects with a snapshot-then-restore around manual
  // overrides. Before this guard, this block ran unconditionally on every
  // app launch (ensureSchema() is called from index.js on every
  // app.whenReady(), and again from settings:save) with no status check at
  // all — so it kept silently re-flipping a credit-balance Trade Receivable
  // (or debit-balance Trade Payable) a CA had deliberately re-categorised,
  // or that an uploaded/applied learned ledger rule had just set (both
  // correctly persist status='user_override') back to Advance from
  // Customers/Suppliers the next time the app happened to restart. The
  // status guard below is kept even now, as defense in depth — this one
  // remaining run must never touch a row already decided on.
  if (await tryClaimMigration('trade_payables_receivables_sign_reclassify_once')) {
    await query(`
      UPDATE mapped_tb
      SET alie = 'ASSETS',
          mapping1_resultant = (SELECT level1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current assets' AND level3 = 'Advance to Suppliers' LIMIT 1),
          mapping2_resultant = 'Other current assets',
          mapping3_resultant = 'Advance to Suppliers',
          level4_value = NULL, level5_value = NULL, level6_value = NULL, level7_value = NULL,
          level_format_id = (SELECT id FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current assets' AND level3 = 'Advance to Suppliers' LIMIT 1),
          override_note = 'Reclassified from Trade Payables (Dr balance — advance to supplier)'
      WHERE alie = 'EQUITY AND LIABILITIES' AND mapping2_resultant = 'Trade payables'
        AND status NOT IN ('user_override', 'user_approved')
        AND EXISTS (SELECT 1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current assets' AND level3 = 'Advance to Suppliers')
        AND tb_row_id IN (SELECT id FROM tb_rows WHERE closing_balance < 0)
    `)
    await query(`
      UPDATE mapped_tb
      SET alie = 'EQUITY AND LIABILITIES',
          mapping1_resultant = (SELECT level1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current liabilities' AND level3 = 'Advance from Customers' LIMIT 1),
          mapping2_resultant = 'Other current liabilities',
          mapping3_resultant = 'Advance from Customers',
          level4_value = NULL, level5_value = NULL, level6_value = NULL, level7_value = NULL,
          level_format_id = (SELECT id FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current liabilities' AND level3 = 'Advance from Customers' LIMIT 1),
          override_note = 'Reclassified from Trade Receivables (Cr balance — advance from customer)'
      WHERE alie = 'ASSETS' AND mapping2_resultant = 'Trade receivables'
        AND status NOT IN ('user_override', 'user_approved')
        AND EXISTS (SELECT 1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current liabilities' AND level3 = 'Advance from Customers')
        AND tb_row_id IN (SELECT id FROM tb_rows WHERE closing_balance > 0)
    `)
  }

  // ── Advance to Suppliers now sits under Short-term loans and advances (0.1.102) ──
  // The sub head is added to every rule set / constitution that has Short-term loans and advances ...
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT lf.rule_set_id, lf.constitution, 'ASSETS', lf.level1, 'Short-term loans and advances', 'Advance to Suppliers', MAX(lf.sort_order)
    FROM level_format lf
    WHERE lf.level2 = 'Short-term loans and advances'
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.constitution = lf.constitution
          AND lf2.level2 = 'Short-term loans and advances' AND lf2.level3 = 'Advance to Suppliers'
      )
    GROUP BY lf.rule_set_id, lf.constitution, lf.level1
  `)
  // Sub heads added by earlier patches were inserted with sort_order 0, which put their Level 1 ("Current assets" / "Current liabilities")
  // AHEAD of Non-current assets / liabilities in the statutory order the Balance Sheet follows. Put each at its siblings' position.
  // Idempotent: only rows still at 0 whose siblings have a position.
  await query(`
    UPDATE level_format AS lf
       SET sort_order = s.mx
      FROM (SELECT rule_set_id, constitution, level1, level2, MAX(sort_order) AS mx
              FROM level_format WHERE sort_order > 0 GROUP BY rule_set_id, constitution, level1, level2) AS s
     WHERE lf.sort_order = 0
       AND lf.level3 IN ('Advance to Suppliers', 'Advance from Customers')
       AND s.rule_set_id = lf.rule_set_id AND s.constitution = lf.constitution AND s.level1 = lf.level1 AND s.level2 = lf.level2
  `)
  // ... and the ledgers the system itself had moved from Trade Payables (a debit balance) are moved with it, once. Not touched: a ledger the
  // CA decided or fixed by hand, and any Financial Year that is locked (a locked year is immutable); mapping the Trial Balance again
  // after unlocking applies the new place.
  if (await tryClaimMigration('advance_to_suppliers_to_short_term_loans_once')) {
    await query(`
      UPDATE mapped_tb AS m
      SET mapping1_resultant = nf.level1, mapping2_resultant = 'Short-term loans and advances', mapping3_resultant = 'Advance to Suppliers',
          level_format_id = nf.id
      FROM level_format AS nf
      WHERE nf.rule_set_id = m.rule_set_id AND nf.level2 = 'Short-term loans and advances' AND nf.level3 = 'Advance to Suppliers'
        AND nf.constitution = (SELECT e.constitution FROM trial_balances t JOIN entities e ON e.id = t.entity_id WHERE t.id = m.tb_id)
        AND m.mapping2_resultant = 'Other current assets' AND m.mapping3_resultant = 'Advance to Suppliers'
        AND m.override_note LIKE 'Reclassified from Trade Payables%'
        AND m.status NOT IN ('user_override', 'user_approved')
        AND m.hand_fixed IS NOT TRUE
        AND m.tb_id NOT IN (SELECT t.id FROM trial_balances t JOIN entity_periods ep ON ep.id = t.entity_period_id WHERE ep.locked)
    `)
  }

  // Backfill from finalised mapped_tb rows. It was meant to run once but ran
  // on EVERY launch, rewriting each rule from whichever row was saved last
  // (carry-forward, propagation and bulk approve all touch mapped_at) — a
  // 2024-25 fix or a stale default replaced the rule a CA had just set, and
  // the next re-upload applied it. Now it runs once (0.1.72) and takes each
  // ledger's decision from its LATEST year, as recordLearnedRules does,
  // which also repairs rules an older year's save had overwritten.
  if (await tryClaimMigration('learned_rules_backfill_latest_year_0172')) await query(`
    INSERT INTO learned_ledger_rules
      (entity_id, ledger_name_key, ledger_name, mapping1_resultant, mapping2_resultant, mapping3_resultant,
       level4_value, level5_value, level6_value, level7_value, alie, updated_at)
    SELECT entity_id, ledger_name_key, ledger_name,
           mapping1_resultant, mapping2_resultant, mapping3_resultant,
           level4_value, level5_value, level6_value, level7_value, alie, mapped_at
    FROM (
      -- PostgreSQL DISTINCT ON (entity, ledger key) ... ORDER BY latest year first
      SELECT tb.entity_id AS entity_id, LOWER(TRIM(tr.name)) AS ledger_name_key, tr.name AS ledger_name,
             mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
             mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value, mt.alie, mt.mapped_at,
             ROW_NUMBER() OVER (
               PARTITION BY tb.entity_id, LOWER(TRIM(tr.name))
               ORDER BY fp.date_from DESC NULLS LAST, mt.mapped_at DESC
             ) AS rn
      FROM mapped_tb mt
      JOIN tb_rows tr ON tr.id = mt.tb_row_id
      JOIN trial_balances tb ON tb.id = mt.tb_id
      LEFT JOIN entity_periods ep ON ep.id = tb.entity_period_id
      LEFT JOIN financial_periods fp ON fp.id = ep.financial_period_id
      WHERE mt.status IN ('user_approved', 'user_override')
        AND TRIM(tr.name) <> ''
    ) AS latest
    WHERE rn = 1
    ON CONFLICT(entity_id, ledger_name_key) DO UPDATE SET
      ledger_name = excluded.ledger_name,
      mapping1_resultant = excluded.mapping1_resultant,
      mapping2_resultant = excluded.mapping2_resultant,
      mapping3_resultant = excluded.mapping3_resultant,
      level4_value = excluded.level4_value,
      level5_value = excluded.level5_value,
      level6_value = excluded.level6_value,
      level7_value = excluded.level7_value,
      alie = excluded.alie,
      updated_at = excluded.updated_at
  `)
}
