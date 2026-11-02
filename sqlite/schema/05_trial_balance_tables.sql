-- SQLite Schema Migration - Trial Balance Tables
-- Generated: 2026-01-20

-- ============================================================================
-- TRIAL BALANCE TABLES
-- ============================================================================

-- Trial Balance Lines (v1 - Schedule III focused)
CREATE TABLE IF NOT EXISTS trial_balance_lines (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    account_code TEXT NOT NULL,
    account_name TEXT NOT NULL,
    opening_balance REAL NOT NULL DEFAULT 0,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    closing_balance REAL NOT NULL DEFAULT 0,
    fs_area TEXT,
    aile TEXT,
    face_group TEXT,
    note_group TEXT,
    sub_note TEXT,
    level4_group TEXT,
    level5_detail TEXT,
    schedule_iii_code TEXT,
    ledger_primary_group TEXT,
    ledger_parent TEXT,
    period_type TEXT DEFAULT 'current',
    version INTEGER NOT NULL DEFAULT 1,
    applied_rule_id TEXT,
    validation_flags TEXT, -- JSON array stored as TEXT
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trial_balance_lines_engagement_id ON trial_balance_lines(engagement_id);
CREATE INDEX IF NOT EXISTS idx_trial_balance_lines_account_code ON trial_balance_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_trial_balance_lines_aile ON trial_balance_lines(aile);

-- schedule_iii_config and the six tb_new_* tables (tb_new_entity_info, tb_new_ledgers,
-- tb_new_stock_items, tb_new_classification_mappings, tb_new_sessions) were removed in T-019:
-- they had no reader or writer. Existing databases drop them at start-up only when they are
-- empty, after a backup (electron/main.cjs, runLegacyTrialBalanceTableCleanup).

-- Engagement Trial Balance Header (one per engagement + period type + financial year)
CREATE TABLE IF NOT EXISTS engagement_trial_balance_header (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    period_type TEXT NOT NULL CHECK (period_type IN ('CY', 'PY')),
    financial_year TEXT NOT NULL,
    source_type TEXT,
    imported_at TEXT,
    imported_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (imported_by) REFERENCES profiles(user_id) ON DELETE SET NULL,
    UNIQUE (engagement_id, financial_year, period_type)
);

CREATE INDEX IF NOT EXISTS idx_engagement_tb_header_engagement ON engagement_trial_balance_header(engagement_id);
CREATE INDEX IF NOT EXISTS idx_engagement_tb_header_period ON engagement_trial_balance_header(engagement_id, financial_year, period_type);

-- Engagement Trial Balance Lines (ledger-wise)
CREATE TABLE IF NOT EXISTS engagement_trial_balance_lines (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tb_header_id TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    ledger_name TEXT NOT NULL,
    ledger_guid TEXT,
    primary_group TEXT,
    parent_group TEXT,
    composite_key TEXT NOT NULL,
    opening REAL NOT NULL DEFAULT 0,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    closing REAL NOT NULL DEFAULT 0,
    dr_cr TEXT,
    is_revenue INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tb_header_id) REFERENCES engagement_trial_balance_header(id) ON DELETE CASCADE,
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    UNIQUE (tb_header_id, composite_key)
);

CREATE INDEX IF NOT EXISTS idx_engagement_tb_lines_header ON engagement_trial_balance_lines(tb_header_id);
CREATE INDEX IF NOT EXISTS idx_engagement_tb_lines_engagement ON engagement_trial_balance_lines(engagement_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS update_trial_balance_lines_timestamp
AFTER UPDATE ON trial_balance_lines
BEGIN
    UPDATE trial_balance_lines SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_engagement_trial_balance_header_timestamp
AFTER UPDATE ON engagement_trial_balance_header
BEGIN
    UPDATE engagement_trial_balance_header SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_engagement_trial_balance_lines_timestamp
AFTER UPDATE ON engagement_trial_balance_lines
BEGIN
    UPDATE engagement_trial_balance_lines SET updated_at = datetime('now') WHERE id = NEW.id;
END;
