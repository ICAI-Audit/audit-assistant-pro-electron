-- Generated: 2026-04-21

-- ============================================================================
-- TAX AUDIT TABLES
-- ============================================================================

-- Cross-module support: GSTIN master is used by GST tools and Tax Audit clause prefill.
CREATE TABLE IF NOT EXISTS client_gstins (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    client_id TEXT NOT NULL,
    gstin TEXT NOT NULL,
    name TEXT,
    taxpayer_type TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_client_gstins_client_id_gstin ON client_gstins(client_id, gstin);
CREATE INDEX IF NOT EXISTS idx_client_gstins_client_id ON client_gstins(client_id);

CREATE TABLE IF NOT EXISTS tax_audit_statutory_versions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    version_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    act_name TEXT NOT NULL,
    rule_reference TEXT,
    form_set TEXT NOT NULL,
    effective_from TEXT,
    effective_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO tax_audit_statutory_versions (
    version_key,
    display_name,
    act_name,
    rule_reference,
    form_set,
    effective_from,
    is_active
) VALUES (
    'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
    'Income-tax Act, 1961 - Rule 6G - Forms 3CA/3CB/3CD - AY 2025-26',
    'Income-tax Act, 1961',
    'Rule 6G, Income-tax Rules, 1962; Notification No. 23/2025',
    '3CA/3CB/3CD',
    '2025-04-01',
    1
);

CREATE TABLE IF NOT EXISTS tax_audit_engagements (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    client_id TEXT,
    statutory_version TEXT NOT NULL DEFAULT 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
    form_type TEXT NOT NULL DEFAULT '3CB' CHECK (form_type IN ('3CA', '3CB')),
    financial_year TEXT,
    assessment_year TEXT,
    previous_year_from TEXT,
    previous_year_to TEXT,
    assessee_name TEXT,
    pan TEXT,
    address TEXT,
    status TEXT,
    business_or_profession TEXT DEFAULT 'business',
    nature_of_business TEXT,
    books_audited_under_other_law INTEGER NOT NULL DEFAULT 0,
    other_law_name TEXT,
    turnover REAL DEFAULT 0,
    gross_receipts REAL DEFAULT 0,
    cash_receipts_percent REAL DEFAULT 0,
    cash_payments_percent REAL DEFAULT 0,
    presumptive_taxation INTEGER NOT NULL DEFAULT 0,
    lower_than_presumptive INTEGER NOT NULL DEFAULT 0,
    applicability_result TEXT,
    applicability_reason TEXT,
    setup_json TEXT DEFAULT '{}',
    source_links_json TEXT DEFAULT '[]',
    status_summary_json TEXT DEFAULT '{}',
    review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'prepared', 'reviewed', 'approved', 'locked')),
    prepared_by TEXT,
    prepared_at TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    locked_by TEXT,
    locked_at TEXT,
    unlock_reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_audit_engagement_version ON tax_audit_engagements(engagement_id, statutory_version);
CREATE INDEX IF NOT EXISTS idx_tax_audit_engagements_engagement_id ON tax_audit_engagements(engagement_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_engagements_client_id ON tax_audit_engagements(client_id);

CREATE TABLE IF NOT EXISTS tax_audit_clause_responses (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tax_audit_id TEXT NOT NULL,
    clause_key TEXT NOT NULL,
    clause_no TEXT NOT NULL,
    clause_title TEXT NOT NULL,
    statutory_version TEXT NOT NULL DEFAULT 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
    applicability_status TEXT NOT NULL DEFAULT 'applicable' CHECK (applicability_status IN ('applicable', 'not_applicable', 'not_assessed')),
    response_json TEXT DEFAULT '{}',
    response_html TEXT,
    auditor_remarks_html TEXT,
    prefill_status TEXT NOT NULL DEFAULT 'not_attempted' CHECK (prefill_status IN ('not_attempted', 'auto_filled', 'partially_filled', 'needs_input', 'source_conflict', 'outdated_source', 'manual_override')),
    source_links_json TEXT DEFAULT '[]',
    source_conflicts_json TEXT DEFAULT '[]',
    missing_fields_json TEXT DEFAULT '[]',
    last_source_hash TEXT,
    validation_status TEXT NOT NULL DEFAULT 'not_run' CHECK (validation_status IN ('not_run', 'valid', 'warning', 'error')),
    validation_messages_json TEXT DEFAULT '[]',
    qualification_required INTEGER NOT NULL DEFAULT 0,
    qualification_text_html TEXT,
    workpaper_ref TEXT,
    review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'prepared', 'reviewed', 'approved', 'locked')),
    prepared_by TEXT,
    prepared_at TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    locked_by TEXT,
    locked_at TEXT,
    unlock_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tax_audit_id) REFERENCES tax_audit_engagements(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_audit_clause_response ON tax_audit_clause_responses(tax_audit_id, clause_key);
CREATE INDEX IF NOT EXISTS idx_tax_audit_clause_responses_tax_audit_id ON tax_audit_clause_responses(tax_audit_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_clause_responses_review_status ON tax_audit_clause_responses(review_status);

CREATE TABLE IF NOT EXISTS tax_audit_clause_evidence (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tax_audit_id TEXT NOT NULL,
    clause_response_id TEXT NOT NULL,
    clause_key TEXT NOT NULL,
    evidence_file_id TEXT NOT NULL,
    workpaper_ref TEXT,
    notes_html TEXT,
    linked_by TEXT,
    linked_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tax_audit_id) REFERENCES tax_audit_engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (clause_response_id) REFERENCES tax_audit_clause_responses(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_file_id) REFERENCES evidence_files(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_audit_clause_evidence ON tax_audit_clause_evidence(clause_response_id, evidence_file_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_clause_evidence_tax_audit_id ON tax_audit_clause_evidence(tax_audit_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_clause_evidence_file_id ON tax_audit_clause_evidence(evidence_file_id);

CREATE TABLE IF NOT EXISTS tax_audit_acceptance_checks (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tax_audit_id TEXT NOT NULL UNIQUE,
    checklist_json TEXT NOT NULL DEFAULT '{}',
    overall_status TEXT NOT NULL DEFAULT 'not_started' CHECK (overall_status IN ('not_started', 'in_progress', 'completed', 'issue_noted', 'not_accepted')),
    remarks_html TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tax_audit_id) REFERENCES tax_audit_engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tax_audit_acceptance_checks_tax_audit_id ON tax_audit_acceptance_checks(tax_audit_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_acceptance_checks_overall_status ON tax_audit_acceptance_checks(overall_status);

CREATE TABLE IF NOT EXISTS tax_audit_qualifications (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tax_audit_id TEXT NOT NULL,
    clause_response_id TEXT,
    clause_key TEXT,
    qualification_html TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'observation' CHECK (severity IN ('observation', 'qualification', 'adverse')),
    include_in_report INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tax_audit_id) REFERENCES tax_audit_engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (clause_response_id) REFERENCES tax_audit_clause_responses(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tax_audit_qualifications_tax_audit_id ON tax_audit_qualifications(tax_audit_id);

CREATE TABLE IF NOT EXISTS tax_audit_review_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tax_audit_id TEXT NOT NULL,
    clause_response_id TEXT,
    clause_key TEXT,
    note_html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responded', 'resolved')),
    assigned_to TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tax_audit_id) REFERENCES tax_audit_engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (clause_response_id) REFERENCES tax_audit_clause_responses(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES profiles(user_id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tax_audit_review_notes_tax_audit_id ON tax_audit_review_notes(tax_audit_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_review_notes_clause_response_id ON tax_audit_review_notes(clause_response_id);

CREATE TABLE IF NOT EXISTS tax_audit_exports (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tax_audit_id TEXT NOT NULL,
    export_type TEXT NOT NULL CHECK (export_type IN ('pdf', 'excel', 'json', 'working_paper')),
    file_name TEXT,
    file_path TEXT,
    exported_by TEXT,
    exported_at TEXT NOT NULL DEFAULT (datetime('now')),
    export_metadata_json TEXT DEFAULT '{}',
    FOREIGN KEY (tax_audit_id) REFERENCES tax_audit_engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (exported_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tax_audit_exports_tax_audit_id ON tax_audit_exports(tax_audit_id);

CREATE TRIGGER IF NOT EXISTS update_tax_audit_statutory_versions_timestamp
AFTER UPDATE ON tax_audit_statutory_versions
BEGIN
    UPDATE tax_audit_statutory_versions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_tax_audit_engagements_timestamp
AFTER UPDATE ON tax_audit_engagements
BEGIN
    UPDATE tax_audit_engagements SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_tax_audit_clause_responses_timestamp
AFTER UPDATE ON tax_audit_clause_responses
BEGIN
    UPDATE tax_audit_clause_responses SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_tax_audit_acceptance_checks_timestamp
AFTER UPDATE ON tax_audit_acceptance_checks
BEGIN
    UPDATE tax_audit_acceptance_checks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_tax_audit_qualifications_timestamp
AFTER UPDATE ON tax_audit_qualifications
BEGIN
    UPDATE tax_audit_qualifications SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_tax_audit_review_notes_timestamp
AFTER UPDATE ON tax_audit_review_notes
BEGIN
    UPDATE tax_audit_review_notes SET updated_at = datetime('now') WHERE id = NEW.id;
END;
