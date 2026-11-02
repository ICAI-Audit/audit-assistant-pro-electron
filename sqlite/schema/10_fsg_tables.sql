-- ============================================================================
-- Financial Statement Review (FSG) module tables
-- ============================================================================
-- SQLite conversion of the FSG_Bharat 0.1.137 PostgreSQL schema
-- (src/main/db/schema.js). Each table is declared once in its final 0.1.137
-- form: the PostgreSQL "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" history is
-- folded into the CREATE statement. Conversions:
--   SERIAL PRIMARY KEY      -> INTEGER PRIMARY KEY AUTOINCREMENT
--   BOOLEAN                 -> INTEGER 0/1 (CHECK IN (0,1)); returned as
--                              true/false by electron/fsg/db/client.js
--   TIMESTAMPTZ DEFAULT now() -> TEXT ISO-8601 UTC default
--   NUMERIC                 -> NUMERIC affinity (see tb_rows CHECK below)
--   JSONB                   -> TEXT holding JSON (CHECK json_valid)
--   ADD CONSTRAINT CHECK    -> declared inline
--
-- Integration with ICAI VERA (owner decision 2026-11-02, T-019):
--   entities.client_id -> clients(id): an FSG entity is a VERA client.
--   entity_periods is one financial year of that client. VERA can hold more
--   than one engagement for the same client and year (e.g. statutory and tax
--   audit); they share the one set of statements, as FSG keeps exactly one
--   period per entity and year. entity_periods.engagement_id records the
--   engagement that first opened the year and is informational: access is
--   decided from the user's engagements for that client and year
--   (electron/fsg/authorization.js). Deleting an engagement keeps the shared
--   statements (SET NULL). Deleting a client that still has statement data is
--   refused (RESTRICT) instead of silently destroying it.
-- Table names are FSG's own; none collide with other VERA tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    key        TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── Entity (Auditee) = VERA client ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
    id                                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id                         TEXT UNIQUE REFERENCES clients(id) ON DELETE RESTRICT,
    name                              TEXT NOT NULL,
    constitution                      INTEGER NOT NULL CHECK (constitution IN (1, 2, 3)),
    constitution_display              TEXT NOT NULL,
    business_type                     TEXT,
    has_branches                      INTEGER NOT NULL DEFAULT 0 CHECK (has_branches IN (0, 1)),
    address                           TEXT,
    cin                               TEXT,
    pan                               TEXT,
    consolidated_manual_py            INTEGER NOT NULL DEFAULT 0 CHECK (consolidated_manual_py IN (0, 1)),
    consolidated_pl_closed_to_capital INTEGER NOT NULL DEFAULT 0 CHECK (consolidated_pl_closed_to_capital IN (0, 1)),
    consolidated_eps_basic_cy         NUMERIC,
    consolidated_eps_basic_py         NUMERIC,
    consolidated_eps_diluted_cy       NUMERIC,
    consolidated_eps_diluted_py       NUMERIC,
    created_at                        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at                        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── Mapping rules (global default set seeded from Mapping_v2.xlsx; custom
--    per-entity sets) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mapping_rule_sets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    is_default INTEGER DEFAULT 0 CHECK (is_default IN (0, 1)),
    entity_id  INTEGER REFERENCES entities(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS level_format (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_set_id  INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
    constitution INTEGER NOT NULL,
    alie         TEXT,
    level1       TEXT,
    level2       TEXT,
    level3       TEXT,
    level4       TEXT,
    level5       TEXT,
    level6       TEXT,
    level7       TEXT,
    sort_order   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS map1 (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_set_id        INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
    constitution       INTEGER NOT NULL,
    tally_pre_primary  TEXT,
    mapping1_resultant TEXT
);

CREATE TABLE IF NOT EXISTS map2 (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_set_id        INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
    constitution       INTEGER NOT NULL,
    keywords           TEXT,
    mapping2_resultant TEXT,
    mapping1_resultant TEXT,
    priority           INTEGER DEFAULT 1,
    notes              TEXT
);

CREATE TABLE IF NOT EXISTS map3 (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_set_id        INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
    constitution       INTEGER NOT NULL,
    keywords           TEXT,
    mapping1_resultant TEXT,
    mapping2_resultant TEXT,
    mapping3_resultant TEXT,
    priority           INTEGER DEFAULT 1,
    notes              TEXT
);

-- ── Financial periods; Auditee-FY = VERA engagement ────────────────────────
CREATE TABLE IF NOT EXISTS financial_periods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    year_label TEXT NOT NULL,
    date_from  TEXT NOT NULL,
    date_till  TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (date_from, date_till)
);

CREATE TABLE IF NOT EXISTS entity_periods (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id           INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    financial_period_id INTEGER NOT NULL REFERENCES financial_periods(id),
    engagement_id       TEXT REFERENCES engagements(id) ON DELETE SET NULL,
    locked              INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    locked_at           TEXT,
    created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    prev_tb_id          INTEGER REFERENCES trial_balances(id) ON DELETE SET NULL,
    py_mode             TEXT NOT NULL DEFAULT 'required',
    is_final            INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
    final_sign_place    TEXT,
    final_sign_date     TEXT,
    finalised_at        TEXT,
    UNIQUE (entity_id, financial_period_id)
);

-- ── Trial balances ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trial_balances (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id                 INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    period                    TEXT,
    filename                  TEXT,
    uploaded_at               TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    row_count                 INTEGER DEFAULT 0,
    branch_name               TEXT NOT NULL DEFAULT '',
    entity_period_id          INTEGER REFERENCES entity_periods(id) ON DELETE CASCADE,
    manual_py                 INTEGER NOT NULL DEFAULT 0 CHECK (manual_py IN (0, 1)),
    tally_closing_stock_total REAL,
    tally_opening_stock_total REAL,
    tally_company             TEXT,
    pl_closed_to_capital      INTEGER NOT NULL DEFAULT 0,
    eps_basic_cy              NUMERIC,
    eps_basic_py              NUMERIC,
    eps_diluted_cy            NUMERIC,
    eps_diluted_py            NUMERIC
);

-- closing_balance carries the revised balance:
--   closing_balance = imported_closing_balance + adj_credit - adj_debit
-- PostgreSQL enforced this exactly on NUMERIC. SQLite stores REAL, so the
-- identity is checked to half a paisa.
CREATE TABLE IF NOT EXISTS tb_rows (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id                    INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    period                   TEXT,
    branch                   TEXT,
    ledger_code              TEXT,
    name                     TEXT,
    opening_balance          NUMERIC DEFAULT 0,
    debit                    NUMERIC DEFAULT 0,
    credit                   NUMERIC DEFAULT 0,
    closing_balance          NUMERIC DEFAULT 0,
    is_revenue               INTEGER CHECK (is_revenue IN (0, 1)),
    is_deemed_positive       INTEGER CHECK (is_deemed_positive IN (0, 1)),
    trail_balance            NUMERIC DEFAULT 0,
    parent                   TEXT,
    group_parent             TEXT,
    group_parent_1           TEXT,
    group_parent_2           TEXT,
    group_parent_3           TEXT,
    group_parent_4           TEXT,
    group_parent_5           TEXT,
    group_parent_6           TEXT,
    group_parent_7           TEXT,
    group_parent_8           TEXT,
    trial_balance_type       TEXT,
    upload_nature            TEXT DEFAULT 'Excel Upload',
    adj_debit                NUMERIC,
    adj_credit               NUMERIC,
    imported_closing_balance NUMERIC,
    stock_head               TEXT,
    CONSTRAINT tb_rows_adjusted_closing_chk CHECK (
        ABS(COALESCE(closing_balance, 0)
            - (COALESCE(imported_closing_balance, closing_balance, 0)
               + COALESCE(adj_credit, 0) - COALESCE(adj_debit, 0))) < 0.005
    )
);

CREATE TABLE IF NOT EXISTS mapped_tb (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id                  INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    tb_row_id              INTEGER NOT NULL REFERENCES tb_rows(id) ON DELETE CASCADE,
    rule_set_id            INTEGER REFERENCES mapping_rule_sets(id),
    mapping1_resultant     TEXT,
    mapping2_resultant     TEXT,
    mapping3_resultant     TEXT,
    level_format_id        INTEGER REFERENCES level_format(id),
    level4_value           TEXT,
    level5_value           TEXT,
    level6_value           TEXT,
    level7_value           TEXT,
    alie                   TEXT,
    status                 TEXT DEFAULT 'auto_high',
    confidence             TEXT DEFAULT 'high',
    conflict_candidates    TEXT,
    conflict_stage         INTEGER,
    discrepancy_suggestion TEXT,
    override_note          TEXT,
    mapped_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    hand_fixed             INTEGER NOT NULL DEFAULT 0 CHECK (hand_fixed IN (0, 1)),
    UNIQUE (tb_id, tb_row_id)
);

CREATE INDEX IF NOT EXISTS idx_tb_rows_tb_id      ON tb_rows(tb_id);
CREATE INDEX IF NOT EXISTS idx_mapped_tb_tb_id    ON mapped_tb(tb_id);
CREATE INDEX IF NOT EXISTS idx_level_format_const ON level_format(rule_set_id, constitution);
CREATE INDEX IF NOT EXISTS idx_lf_level2_clean    ON level_format(rule_set_id, LOWER(TRIM(REPLACE(level2, '(specify nature)', ''))));
CREATE INDEX IF NOT EXISTS idx_lf_level3_clean    ON level_format(rule_set_id, LOWER(TRIM(REPLACE(level3, '(specify nature)', ''))));
CREATE INDEX IF NOT EXISTS idx_map2_const         ON map2(rule_set_id, constitution);
CREATE INDEX IF NOT EXISTS idx_map3_const         ON map3(rule_set_id, constitution);
CREATE INDEX IF NOT EXISTS idx_entity_periods_entity ON entity_periods(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_periods_engagement ON entity_periods(engagement_id);
CREATE INDEX IF NOT EXISTS idx_trial_balances_entity ON trial_balances(entity_id);
CREATE INDEX IF NOT EXISTS idx_trial_balances_period ON trial_balances(entity_period_id);

-- ── Auditors and signatories ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditors (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id           INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    firm_name           TEXT,
    frn                 TEXT,
    name                TEXT NOT NULL,
    designation         TEXT,
    membership_number   TEXT NOT NULL,
    is_active           INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    membership_category TEXT,
    pan                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_auditors_entity ON auditors(entity_id);

CREATE TABLE IF NOT EXISTS signatories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    din         TEXT,
    designation TEXT,
    is_active   INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    id_type     TEXT
);
CREATE INDEX IF NOT EXISTS idx_signatories_entity ON signatories(entity_id);

CREATE TABLE IF NOT EXISTS auditor_firms (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_name  TEXT NOT NULL,
    frn        TEXT,
    is_active  INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    pan        TEXT,
    address    TEXT,
    email      TEXT
);

CREATE TABLE IF NOT EXISTS global_signatories (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id             INTEGER REFERENCES auditor_firms(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    din                 TEXT,
    designation         TEXT,
    membership_number   TEXT,
    is_active           INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    address             TEXT,
    email               TEXT,
    membership_category TEXT
);

-- ── Notes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_details (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    note_num   INTEGER NOT NULL,
    note_title TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tb_id, note_num)
);

CREATE TABLE IF NOT EXISTS itr_details (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tb_id)
);

CREATE TABLE IF NOT EXISTS note_disclosures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    note_num   INTEGER NOT NULL,
    note_title TEXT NOT NULL,
    text       TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tb_id, note_num)
);

CREATE TABLE IF NOT EXISTS entity_note_disclosures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    note_num   INTEGER NOT NULL,
    note_title TEXT NOT NULL,
    text       TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, note_num)
);

CREATE TABLE IF NOT EXISTS entity_note_details (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    note_num   INTEGER NOT NULL,
    note_title TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, note_num)
);
CREATE INDEX IF NOT EXISTS idx_entity_note_details ON entity_note_details(entity_id);

CREATE TABLE IF NOT EXISTS remarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    scope      TEXT NOT NULL,
    scope_key  TEXT NOT NULL,
    remark     TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tb_id, scope, scope_key)
);
CREATE INDEX IF NOT EXISTS idx_remarks_tb ON remarks(tb_id);

-- ── Depreciation ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dep_schedules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tb_id)
);

CREATE TABLE IF NOT EXISTS dep_it_schedules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tb_id)
);

CREATE TABLE IF NOT EXISTS it_blocks_custom (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id      INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    major_category TEXT NOT NULL,
    block_name     TEXT NOT NULL,
    rate           REAL NOT NULL,
    created_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, block_name)
);

CREATE TABLE IF NOT EXISTS dep_comp_schedules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tb_id)
);

-- ── Manual previous-year figures, adjustments, face lines ──────────────────
CREATE TABLE IF NOT EXISTS manual_py_entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id            INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    note_num         INTEGER NOT NULL,
    particular_label TEXT NOT NULL DEFAULT '',
    py_amount        NUMERIC NOT NULL DEFAULT 0,
    is_custom        INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    note_title       TEXT NOT NULL DEFAULT '',
    UNIQUE (tb_id, note_num, particular_label)
);
CREATE INDEX IF NOT EXISTS idx_manual_py_entries_tb ON manual_py_entries(tb_id);

CREATE TABLE IF NOT EXISTS entity_manual_py_entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    note_num         INTEGER NOT NULL,
    particular_label TEXT NOT NULL DEFAULT '',
    py_amount        NUMERIC NOT NULL DEFAULT 0,
    is_custom        INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    note_title       TEXT NOT NULL DEFAULT '',
    UNIQUE (entity_id, note_num, particular_label)
);
CREATE INDEX IF NOT EXISTS idx_entity_manual_py_entries_entity ON entity_manual_py_entries(entity_id);

CREATE TABLE IF NOT EXISTS tb_adjustment_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id          INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    tb_row_id      INTEGER,
    ledger_name    TEXT,
    ledger_code    TEXT,
    old_adj_debit  NUMERIC,
    old_adj_credit NUMERIC,
    new_adj_debit  NUMERIC,
    new_adj_credit NUMERIC,
    closing_before NUMERIC,
    closing_after  NUMERIC,
    changed_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tb_adjustment_log_tb ON tb_adjustment_log(tb_id);

CREATE TABLE IF NOT EXISTS manual_face_lines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    section    TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    cy_amount  NUMERIC NOT NULL DEFAULT 0,
    py_amount  NUMERIC NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_manual_face_lines_tb ON manual_face_lines(tb_id, section);

-- ── Learned ledger rules (entity-scoped, survive TB deletion) ──────────────
CREATE TABLE IF NOT EXISTS learned_ledger_rules (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id          INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    ledger_name_key    TEXT NOT NULL,
    ledger_name        TEXT NOT NULL DEFAULT '',
    mapping1_resultant TEXT,
    mapping2_resultant TEXT,
    mapping3_resultant TEXT,
    level4_value       TEXT,
    level5_value       TEXT,
    level6_value       TEXT,
    level7_value       TEXT,
    alie               TEXT,
    updated_at         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    source_branch_name TEXT,
    UNIQUE (entity_id, ledger_name_key)
);
CREATE INDEX IF NOT EXISTS idx_learned_ledger_rules_entity ON learned_ledger_rules(entity_id);

-- ── Per Auditee-FY documents ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS form_3cd (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id            INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id     INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    cy_turnover          REAL,
    cy_gross_profit      REAL,
    cy_net_profit        REAL,
    cy_stock_in_trade    REAL,
    cy_material_consumed REAL,
    cy_finished_goods    REAL,
    py_turnover          REAL,
    py_gross_profit      REAL,
    py_net_profit        REAL,
    py_stock_in_trade    REAL,
    py_material_consumed REAL,
    py_finished_goods    REAL,
    updated_at           TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, entity_period_id)
);

CREATE TABLE IF NOT EXISTS ppe_ledgers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    ledger_name      TEXT NOT NULL,
    ledger_group     TEXT,
    opening_balance  REAL DEFAULT 0,
    additions_debit  REAL DEFAULT 0,
    credits          REAL DEFAULT 0,
    closing_balance  REAL DEFAULT 0,
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, entity_period_id, ledger_name)
);
CREATE INDEX IF NOT EXISTS idx_ppe_ledgers_group ON ppe_ledgers(ledger_group);

CREATE TABLE IF NOT EXISTS ratio_gp_selection (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    data             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, entity_period_id)
);

-- Versioned snapshots of finalised statements. In FSG_Bharat an external tool
-- (Cloudtail MCA) read these from the shared PostgreSQL server; in VERA they
-- are kept locally as the record of each publish.
CREATE TABLE IF NOT EXISTS fs_snapshots (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    version          INTEGER NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    app_version      TEXT,
    created_by       TEXT,
    payload          TEXT NOT NULL CHECK (json_valid(payload)),
    UNIQUE (entity_period_id, version)
);

CREATE TABLE IF NOT EXISTS general_notes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    segments         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(segments)),
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, entity_period_id)
);

CREATE TABLE IF NOT EXISTS deferred_tax_computations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    data             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, entity_period_id)
);

CREATE TABLE IF NOT EXISTS tax_computations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    data             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, entity_period_id)
);

CREATE TABLE IF NOT EXISTS cash_flow_entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
    data             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
    updated_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_id, entity_period_id)
);
