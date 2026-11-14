-- ============================================================================
-- CAAT Tools (data analytics tests and SA 530 sampling) - engagement workspace
-- ============================================================================
-- The CAAT Tools page (/caat-tools) embeds the standalone CAAT Tools HTML.
-- One workspace row per engagement holds the tool's settings and inputs as
-- JSON: column mapping, row filters, test parameters, which tests were run,
-- the sampling plan (including the seed used) and the audited values or
-- control results entered by the auditor. Results are not stored; they are
-- re-computed from the saved source files and settings when the page opens,
-- which reproduces the same tests and the same sample selection.
-- The source files themselves are kept in caat_source_files (base64 text).

CREATE TABLE IF NOT EXISTS caat_workspaces (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL DEFAULT '{}', -- JSON object
    state_version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_caat_workspaces_engagement ON caat_workspaces(engagement_id);

CREATE TABLE IF NOT EXISTS caat_source_files (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    file_key TEXT NOT NULL, -- SHA-256 of the file content plus file name
    file_name TEXT NOT NULL,
    file_kind TEXT NOT NULL, -- 'csv' or 'xlsx'
    sha256 TEXT,
    size_bytes INTEGER,
    content_base64 TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (engagement_id, file_key),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_caat_source_files_engagement ON caat_source_files(engagement_id);

CREATE TRIGGER IF NOT EXISTS update_caat_workspaces_timestamp
AFTER UPDATE ON caat_workspaces
BEGIN
    UPDATE caat_workspaces SET updated_at = datetime('now') WHERE id = NEW.id;
END;
