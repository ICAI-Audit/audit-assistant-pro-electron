-- SQLite Schema Migration - Audit Report Tables
-- Generated: 2026-01-20

-- ============================================================================
-- AUDIT REPORT TABLES
-- ============================================================================

-- Audit Report Setup
CREATE TABLE IF NOT EXISTS audit_report_setup (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL UNIQUE,
    company_type TEXT,
    company_cin TEXT,
    registered_office TEXT,
    nature_of_business TEXT,
    is_standalone INTEGER DEFAULT 1,
    accounting_framework TEXT DEFAULT 'AS',
    is_listed_company INTEGER DEFAULT 0,
    is_public_company INTEGER DEFAULT 0,
    is_public_unlisted_company INTEGER DEFAULT 0,
    is_private_company INTEGER DEFAULT 0,
    is_private_exceeding_threshold INTEGER DEFAULT 0,
    is_private_non_exceeding_threshold INTEGER DEFAULT 0,
    is_small_company INTEGER DEFAULT 0,
    is_opc INTEGER DEFAULT 0,
    private_turnover_above_50cr INTEGER DEFAULT 0,
    private_borrowing_above_25cr INTEGER DEFAULT 0,
    ifc_applicable INTEGER DEFAULT 1,
    caro_applicable_status TEXT DEFAULT 'pending',
    caro_exclusion_reason TEXT,
    caro_annexure_letter TEXT DEFAULT 'A',
    ifc_annexure_letter TEXT DEFAULT 'B',
    company_profit_or_loss TEXT,
    cash_flow_required INTEGER DEFAULT 1,
    has_branch_auditors INTEGER DEFAULT 0,
    branch_locations TEXT,
    has_predecessor_auditor INTEGER DEFAULT 0,
    predecessor_auditor_name TEXT,
    predecessor_report_date TEXT,
    has_subsidiaries INTEGER DEFAULT 0,
    paid_up_capital REAL DEFAULT 0,
    reserves_surplus REAL DEFAULT 0,
    borrowings_amount REAL DEFAULT 0,
    signing_partner_id TEXT,
    report_date TEXT,
    report_city TEXT,
    udin TEXT,
    setup_completed INTEGER DEFAULT 0,
    report_status TEXT DEFAULT 'draft',
    locked INTEGER DEFAULT 0,
    locked_at TEXT,
    locked_by TEXT,
    unlock_reason TEXT,
    unlocked_at TEXT,
    unlocked_by TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (signing_partner_id) REFERENCES partners(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_report_setup_engagement_id ON audit_report_setup(engagement_id);

-- Audit Report Main Content
CREATE TABLE IF NOT EXISTS audit_report_main_content (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL UNIQUE,
    opinion_type TEXT NOT NULL DEFAULT 'unqualified',
    basis_for_opinion TEXT,
    basis_for_opinion_is_example INTEGER DEFAULT 0,
    qualification_details TEXT,
    has_emphasis_of_matter INTEGER DEFAULT 0,
    emphasis_of_matter_items TEXT DEFAULT '[]', -- JSON array
    has_other_matter INTEGER DEFAULT 0,
    other_matter_items TEXT DEFAULT '[]', -- JSON array
    has_going_concern_uncertainty INTEGER DEFAULT 0,
    going_concern_details TEXT,
    going_concern_note_ref TEXT,
    include_kam INTEGER DEFAULT 0,
    is_finalized INTEGER DEFAULT 0,
    finalized_at TEXT,
    finalized_by TEXT,
    version_number INTEGER DEFAULT 1,
    board_report_status TEXT,
    board_report_misstatement_details TEXT,
    firm_name TEXT,
    firm_registration_no TEXT,
    partner_name TEXT,
    membership_no TEXT,
    
    -- Companies Act 2013 Section 143(3) clauses
    clause_143_3_a TEXT,
    clause_143_3_b TEXT,
    clause_143_3_c TEXT,
    clause_143_3_ca TEXT,
    clause_143_3_d TEXT,
    clause_143_3_e TEXT,
    clause_143_3_f TEXT,
    clause_143_3_g TEXT,
    clause_143_3_h TEXT,
    clause_143_3_i TEXT,
    clause_143_3_j TEXT,
    clause_143_3_a_status TEXT,
    clause_143_3_a_details TEXT,
    clause_143_3_b_audit_trail_status TEXT,
    clause_143_3_b_audit_trail_details TEXT,
    clause_143_3_b_server_outside_india INTEGER,
    clause_143_3_c_branch_returns TEXT,
    clause_143_3_e_going_concern_impact TEXT,
    clause_143_3_f_directors_disqualified INTEGER,
    clause_143_3_f_disqualified_details TEXT,
    clause_143_3_g_qualification_impact TEXT,
    clause_143_3_h_remuneration_status TEXT,
    clause_143_3_h_details TEXT,
    clause_143_3_i_ifc_qualification TEXT,
    
    -- Rule 11 clauses
    rule_11_a TEXT,
    rule_11_b TEXT,
    rule_11_c TEXT,
    rule_11_d TEXT,
    rule_11_e TEXT,
    rule_11_f TEXT,
    rule_11_g TEXT,
    rule_11_a_pending_litigations TEXT,
    rule_11_a_note_ref TEXT,
    rule_11_b_long_term_contracts TEXT,
    rule_11_b_note_ref TEXT,
    rule_11_c_iepf_status TEXT,
    rule_11_c_delay_amount REAL,
    rule_11_c_delay_details TEXT,
    rule_11_d_audit_procedures_status TEXT,
    rule_11_d_loan_fund_representations INTEGER,
    rule_11_d_modification_details TEXT,
    rule_11_d_receiving_fund_representations INTEGER,
    rule_11_e_dividend_status TEXT,
    rule_11_e_dividend_note_ref TEXT,
    rule_11_e_dividend_details TEXT,
    rule_11_e_interim_dividend_paid INTEGER,
    rule_11_e_interim_dividend_declared_not_paid INTEGER,
    rule_11_e_final_dividend_previous_year INTEGER,
    rule_11_e_final_dividend_proposed INTEGER,
    rule_11_e_final_dividend_amount REAL,
    rule_11_e_interim_dividend_amount REAL,
    rule_11_f_audit_trail_status TEXT,
    rule_11_f_audit_trail_details TEXT,
    rule_11_g_funds_advanced_status TEXT,
    rule_11_g_funds_advanced_details TEXT,
    
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_report_main_content_engagement_id ON audit_report_main_content(engagement_id);

-- Audit Report Documents
CREATE TABLE IF NOT EXISTS audit_report_documents (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    section_name TEXT NOT NULL,
    section_title TEXT,
    content_json TEXT DEFAULT '{}', -- JSON object
    content_html TEXT,
    version_number INTEGER DEFAULT 1,
    is_locked INTEGER DEFAULT 0,
    changed_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_report_documents_engagement_id ON audit_report_documents(engagement_id);
CREATE INDEX IF NOT EXISTS idx_audit_report_documents_section_name ON audit_report_documents(section_name);

-- Audit Report Document Versions
CREATE TABLE IF NOT EXISTS audit_report_document_versions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    content_json TEXT,
    content_html TEXT,
    change_reason TEXT,
    changed_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES audit_report_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_report_document_versions_document_id ON audit_report_document_versions(document_id);

-- Audit Report Comments
CREATE TABLE IF NOT EXISTS audit_report_comments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    document_id TEXT,
    clause_id TEXT,
    comment_text TEXT NOT NULL,
    comment_type TEXT,
    status TEXT DEFAULT 'open',
    assigned_to TEXT,
    response_text TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES audit_report_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES profiles(user_id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_report_comments_engagement_id ON audit_report_comments(engagement_id);
CREATE INDEX IF NOT EXISTS idx_audit_report_comments_document_id ON audit_report_comments(document_id);

-- Audit Report Evidence
CREATE TABLE IF NOT EXISTS audit_report_evidence (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    clause_id TEXT,
    evidence_file_id TEXT,
    working_paper_ref TEXT,
    description TEXT,
    notes TEXT,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_file_id) REFERENCES evidence_files(id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_report_evidence_engagement_id ON audit_report_evidence(engagement_id);

-- Audit Report Exports
CREATE TABLE IF NOT EXISTS audit_report_exports (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    export_type TEXT NOT NULL,
    export_version INTEGER NOT NULL,
    file_name TEXT,
    file_path TEXT,
    is_final INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_report_exports_engagement_id ON audit_report_exports(engagement_id);

-- Key Audit Matters
CREATE TABLE IF NOT EXISTS key_audit_matters (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    audit_response TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_key_audit_matters_engagement_id ON key_audit_matters(engagement_id);

-- CARO Clause Library
CREATE TABLE IF NOT EXISTS caro_clause_library (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    clause_id TEXT NOT NULL UNIQUE,
    clause_title TEXT NOT NULL,
    positive_wording TEXT,
    negative_wording TEXT,
    na_wording TEXT,
    questions TEXT, -- JSON array
    applicability_conditions TEXT, -- JSON object
    evidence_checklist TEXT, -- JSON array
    reviewer_prompts TEXT, -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_caro_clause_library_clause_id ON caro_clause_library(clause_id);

-- CARO Clause Responses
CREATE TABLE IF NOT EXISTS caro_clause_responses (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    clause_id TEXT NOT NULL,
    is_applicable INTEGER,
    conclusion_text TEXT,
    answers TEXT, -- JSON object
    table_data TEXT, -- JSON object
    status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
    prepared_by TEXT,
    prepared_at TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    UNIQUE(engagement_id, clause_id)
);

CREATE INDEX IF NOT EXISTS idx_caro_clause_responses_engagement_id ON caro_clause_responses(engagement_id);
CREATE INDEX IF NOT EXISTS idx_caro_clause_responses_clause_id ON caro_clause_responses(clause_id);

-- CARO Standard Answers
CREATE TABLE IF NOT EXISTS caro_standard_answers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    clause_id TEXT NOT NULL UNIQUE,
    positive_wording TEXT,
    negative_wording TEXT,
    na_wording TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_caro_standard_answers_clause_id ON caro_standard_answers(clause_id);

-- IFC Report Content (Internal Financial Controls Report)
CREATE TABLE IF NOT EXISTS audit_report_ifc_content (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL UNIQUE,
    opinion_type TEXT DEFAULT 'unmodified' CHECK (opinion_type IN ('unmodified', 'qualified', 'adverse', 'disclaimer')),
    opinion_paragraph TEXT,
    basis_for_opinion TEXT,
    management_responsibility_section TEXT,
    auditor_responsibility_section TEXT,
    ifc_meaning_section TEXT,
    inherent_limitations_section TEXT,
    has_material_weaknesses INTEGER DEFAULT 0,
    material_weaknesses TEXT DEFAULT '[]', -- JSON array
    has_significant_deficiencies INTEGER DEFAULT 0,
    significant_deficiencies TEXT DEFAULT '[]', -- JSON array
    additional_sections TEXT DEFAULT '[]', -- JSON array
    report_status TEXT DEFAULT 'draft',
    version_number INTEGER DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_report_ifc_content_engagement_id ON audit_report_ifc_content(engagement_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS update_audit_report_setup_timestamp
AFTER UPDATE ON audit_report_setup
BEGIN
    UPDATE audit_report_setup SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_audit_report_main_content_timestamp
AFTER UPDATE ON audit_report_main_content
BEGIN
    UPDATE audit_report_main_content SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_audit_report_documents_timestamp
AFTER UPDATE ON audit_report_documents
BEGIN
    UPDATE audit_report_documents SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_key_audit_matters_timestamp
AFTER UPDATE ON key_audit_matters
BEGIN
    UPDATE key_audit_matters SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_caro_clause_library_timestamp
AFTER UPDATE ON caro_clause_library
BEGIN
    UPDATE caro_clause_library SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_caro_clause_responses_timestamp
AFTER UPDATE ON caro_clause_responses
BEGIN
    UPDATE caro_clause_responses SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_caro_standard_answers_timestamp
AFTER UPDATE ON caro_standard_answers
BEGIN
    UPDATE caro_standard_answers SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_audit_report_ifc_content_timestamp
AFTER UPDATE ON audit_report_ifc_content
BEGIN
    UPDATE audit_report_ifc_content SET updated_at = datetime('now') WHERE id = NEW.id;
END;
