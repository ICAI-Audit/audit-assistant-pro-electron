-- SQLite Schema Migration - Audit Program Tables
-- Generated: 2026-01-20

-- ============================================================================
-- AUDIT PROGRAM TABLES
-- ============================================================================

-- Audit Programs
CREATE TABLE IF NOT EXISTS audit_programs_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    client_id TEXT,
    financial_year_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    workpaper_reference TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    prepared_by TEXT,
    prepared_at TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_programs_new_engagement_id ON audit_programs_new(engagement_id);
CREATE INDEX IF NOT EXISTS idx_audit_programs_new_client_id ON audit_programs_new(client_id);

-- Audit Program Sections
CREATE TABLE IF NOT EXISTS audit_program_sections (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    audit_program_id TEXT NOT NULL,
    name TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    is_expanded INTEGER DEFAULT 0,
    is_applicable INTEGER DEFAULT 1,
    status TEXT,
    locked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (audit_program_id) REFERENCES audit_programs_new(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_program_sections_audit_program_id ON audit_program_sections(audit_program_id);

-- Audit Program Boxes
CREATE TABLE IF NOT EXISTS audit_program_boxes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    section_id TEXT NOT NULL,
    header TEXT NOT NULL,
    content TEXT DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    status TEXT,
    locked INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (section_id) REFERENCES audit_program_sections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_program_boxes_section_id ON audit_program_boxes(section_id);

-- Audit Program Attachments
CREATE TABLE IF NOT EXISTS audit_program_attachments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    audit_program_id TEXT NOT NULL,
    section_id TEXT,
    box_id TEXT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    description TEXT,
    is_evidence INTEGER DEFAULT 0,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (audit_program_id) REFERENCES audit_programs_new(id) ON DELETE CASCADE,
    FOREIGN KEY (section_id) REFERENCES audit_program_sections(id) ON DELETE CASCADE,
    FOREIGN KEY (box_id) REFERENCES audit_program_boxes(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_program_attachments_audit_program_id ON audit_program_attachments(audit_program_id);
CREATE INDEX IF NOT EXISTS idx_audit_program_attachments_section_id ON audit_program_attachments(section_id);
CREATE INDEX IF NOT EXISTS idx_audit_program_attachments_box_id ON audit_program_attachments(box_id);

-- Engagement Letter Templates
CREATE TABLE IF NOT EXISTS engagement_letter_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    template_type TEXT NOT NULL CHECK (template_type IN ('statutory_audit_company_without_ifc', 'statutory_audit_company_with_ifc', 'tax_audit_partnership_3ca', 'tax_audit_partnership_3cb')),
    template_name TEXT NOT NULL,
    template_description TEXT,
    file_content TEXT NOT NULL, -- Base64 encoded
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER,
    mime_type TEXT,
    available_variables TEXT, -- JSON object
    version_number INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    admin_notes TEXT,
    FOREIGN KEY (uploaded_by) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engagement_letter_templates_type ON engagement_letter_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_engagement_letter_templates_active ON engagement_letter_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_engagement_letter_templates_uploaded_by ON engagement_letter_templates(uploaded_by);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS update_audit_programs_new_timestamp
AFTER UPDATE ON audit_programs_new
BEGIN
    UPDATE audit_programs_new SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_audit_program_sections_timestamp
AFTER UPDATE ON audit_program_sections
BEGIN
    UPDATE audit_program_sections SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_audit_program_boxes_timestamp
AFTER UPDATE ON audit_program_boxes
BEGIN
    UPDATE audit_program_boxes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_engagement_letter_templates_timestamp
AFTER UPDATE ON engagement_letter_templates
BEGIN
    UPDATE engagement_letter_templates SET updated_at = datetime('now') WHERE id = NEW.id;
END;
