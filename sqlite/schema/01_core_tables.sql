-- SQLite Schema Migration - Core Domain Tables
-- Generated: 2026-01-20
-- Based on DATABASE_ARCHITECTURE (2).md

-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- ============================================================================
-- CORE DOMAIN TABLES
-- ============================================================================

-- Firm Settings
CREATE TABLE IF NOT EXISTS firm_settings (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    firm_name TEXT NOT NULL,
    firm_registration_no TEXT,
    constitution TEXT,
    address TEXT,
    place TEXT,
    icai_unique_sl_no TEXT,
    no_of_partners INTEGER,
    created_by TEXT DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Profiles (User accounts)
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL UNIQUE,
    full_name TEXT,
    email TEXT NOT NULL UNIQUE,
    avatar_url TEXT,
    phone TEXT,
    membership_number TEXT,
    firm_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (firm_id) REFERENCES firm_settings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_firm_id ON profiles(firm_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- User Roles
CREATE TABLE IF NOT EXISTS user_roles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'partner', 'manager', 'senior', 'staff', 'viewer', 'user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
    UNIQUE(user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

-- Partners
CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    membership_number TEXT,
    email TEXT,
    phone TEXT,
    pan TEXT,
    date_of_joining TEXT,
    date_of_exit TEXT,
    user_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_partners_user_id ON partners(user_id);
CREATE INDEX IF NOT EXISTS idx_partners_membership_number ON partners(membership_number);

-- Clients
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    industry TEXT,
    constitution TEXT DEFAULT 'company',
    cin TEXT,
    pan TEXT,
    address TEXT,
    state TEXT,
    pin TEXT,
    contact_person TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    created_by TEXT DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- Financial Years
CREATE TABLE IF NOT EXISTS financial_years (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    year_code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_financial_years_year_code ON financial_years(year_code);

-- Engagements
CREATE TABLE IF NOT EXISTS engagements (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    client_id TEXT,
    client_name TEXT NOT NULL,
    engagement_type TEXT NOT NULL DEFAULT 'statutory',
    financial_year TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'fieldwork', 'review', 'completion')),
    partner_id TEXT,
    manager_id TEXT,
    firm_id TEXT,
    materiality_amount REAL,
    performance_materiality REAL,
    trivial_threshold REAL,
    start_date TEXT,
    end_date TEXT,
    notes TEXT,
    created_by TEXT DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (partner_id) REFERENCES profiles(user_id) ON DELETE SET NULL,
    FOREIGN KEY (manager_id) REFERENCES profiles(user_id) ON DELETE SET NULL,
    FOREIGN KEY (firm_id) REFERENCES firm_settings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_engagements_client_id ON engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_engagements_partner_id ON engagements(partner_id);
CREATE INDEX IF NOT EXISTS idx_engagements_manager_id ON engagements(manager_id);
CREATE INDEX IF NOT EXISTS idx_engagements_firm_id ON engagements(firm_id);
CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status);

-- Engagement Assignments
CREATE TABLE IF NOT EXISTS engagement_assignments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    engagement_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    assigned_by TEXT DEFAULT 'system',
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
    UNIQUE(engagement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_engagement_assignments_engagement_id ON engagement_assignments(engagement_id);
CREATE INDEX IF NOT EXISTS idx_engagement_assignments_user_id ON engagement_assignments(user_id);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS update_firm_settings_timestamp
AFTER UPDATE ON firm_settings
BEGIN
    UPDATE firm_settings SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_profiles_timestamp
AFTER UPDATE ON profiles
BEGIN
    UPDATE profiles SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_partners_timestamp
AFTER UPDATE ON partners
BEGIN
    UPDATE partners SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_clients_timestamp
AFTER UPDATE ON clients
BEGIN
    UPDATE clients SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_engagements_timestamp
AFTER UPDATE ON engagements
BEGIN
    UPDATE engagements SET updated_at = datetime('now') WHERE id = NEW.id;
END;
