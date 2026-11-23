> Historical schema document. The `tb_new_*` tables it describes were removed from the SQLite schema in T-019; an existing database drops them at start-up only when all of them are empty, after a backup. See [Financial Statement Review](project/FINANCIAL_STATEMENT_REVIEW.md) and [current status](project/CURRENT_STATUS.md).

# Trial Balance New - Database Schema Documentation

## Overview
This document describes all database tables required for the "Trial Balance New" module. These tables are completely independent from the old `trial_balance_lines` table.

## Table List

### 1. `tb_new_entity_info`
**Purpose**: Stores entity type, business type, and company information per engagement.

**Key Fields**:
- `engagement_id` - Links to engagements table
- `entity_type` - Type of entity (Company, LLP, Partnership, etc.)
- `entity_name` - Name of the entity
- `business_type` - Business type (Trading, Manufacturing, Service, etc.)
- `company_name` - Company name (from Tally)
- `company_address`, `company_state`, `company_pincode`, `company_gst` - Company details
- `period_from`, `period_to` - Financial period dates
- `odbc_port` - Tally ODBC port configuration
- `version` - Version number for historical tracking

**Relationships**:
- One-to-many with `tb_new_ledgers`
- One-to-many with `tb_new_stock_items`
- One-to-many with `tb_new_sessions`

---

### 2. `tb_new_ledgers`
**Purpose**: Main table storing trial balance ledger entries (LedgerRow structure).

**Key Fields**:
- `engagement_id` - Links to engagements table
- `entity_info_id` - Links to entity info (version tracking)
- `ledger_name` - Name of the ledger
- `primary_group` - Primary group from Tally
- `parent_group` - Parent group from Tally
- `composite_key` - Unique key: "LedgerName|PrimaryGroup"
- **Financial Data**:
  - `opening_balance`, `debit`, `credit`, `closing_balance`
- **Classification Hierarchy (H1-H5)**:
  - `h1` - Statement: Balance Sheet / P&L Account
  - `h2` - Category: Assets, Liabilities, Equity, Income, Expenses
  - `h3` - Sub-Category: e.g., PPE & IA (Net), Trade Receivables
  - `h4` - Line Item: e.g., Cash on Hand, Unsecured Considered Good
  - `h5` - Detail: Additional detail if required
- **Status and Validation**:
  - `status` - Mapped, Unmapped, or Error
  - `errors` - Validation errors
  - `verified` - Verification status
  - `notes` - User notes
- `sheet_name` - Sheet name (e.g., "TB CY")
- `version` - Version number for historical tracking

**Indexes**:
- `engagement_id`
- `entity_info_id`
- `composite_key`
- `status`
- `h1, h2` (for filtering)
- `engagement_id, version` (for version queries)

---

### 3. `tb_new_stock_items`
**Purpose**: Stores stock/inventory items with their classification.

**Key Fields**:
- `engagement_id` - Links to engagements table
- `entity_info_id` - Links to entity info
- `item_name` - Name of the stock item
- `stock_group` - Stock group from Tally
- `primary_group` - Primary group
- `opening_value` - Opening stock value
- `closing_value` - Closing stock value
- `stock_category` - Category: Raw Material, Finished Goods, Work-in-Progress, etc.
- `composite_key` - Unique key for the item
- `sheet_name` - Sheet name
- `version` - Version number

**Indexes**:
- `engagement_id`
- `entity_info_id`
- `composite_key`
- `stock_category`
- `engagement_id, version`

---

### 4. `tb_new_classification_mappings`
**Purpose**: Stores user-saved classification mappings that override default rules.

**Key Fields**:
- `engagement_id` - Links to engagements table
- `composite_key` - Unique key: "LedgerName|PrimaryGroup"
- `ledger_name` - Ledger name
- `primary_group` - Primary group
- **Classification Hierarchy**:
  - `h1`, `h2`, `h3`, `h4`, `h5` - Full classification path
- `is_active` - Whether mapping is active
- `created_by` - User who created the mapping

**Unique Constraint**: `(engagement_id, composite_key)` - One mapping per ledger per engagement

**Indexes**:
- `engagement_id`
- `composite_key`
- `engagement_id, is_active`

---

### 5. `tb_new_sessions`
**Purpose**: Stores saved sessions/workspaces for Trial Balance New.

**Key Fields**:
- `engagement_id` - Links to engagements table
- `session_name` - Name of the session
- `description` - Optional description
- `entity_info_id` - Links to entity info (snapshot)
- `is_default` - Whether this is the default session
- `is_active` - Whether session is active
- `created_by` - User who created the session

**Unique Constraint**: `(engagement_id, session_name)` - Unique session names per engagement

**Indexes**:
- `engagement_id`
- `engagement_id, is_default` (partial index)
- `engagement_id, is_active` (partial index)

---

## Relationships Diagram

```
engagements
    │
    ├── tb_new_entity_info (1:many)
    │       │
    │       ├── tb_new_ledgers (1:many)
    │       ├── tb_new_stock_items (1:many)
    │       └── tb_new_sessions (1:many)
    │
    ├── tb_new_classification_mappings (1:many)
    └── tb_new_sessions (1:many)
```

## Data Flow

1. **Entity Info Created**: User selects entity type, business type, and imports company info
2. **Ledgers Imported**: Ledgers are imported from Tally/Excel and stored in `tb_new_ledgers`
3. **Stock Items Imported**: Stock items imported and stored in `tb_new_stock_items`
4. **Classification Applied**: Auto-classification runs, uses `tb_new_classification_mappings` for overrides
5. **Session Saved**: User can save current state as a session in `tb_new_sessions`

## Versioning Strategy

- Each `tb_new_entity_info` record has a `version` number
- All related ledgers and stock items reference this version via `entity_info_id`
- This allows historical tracking and rollback capabilities
- Users can maintain multiple versions of trial balance data

## Security (RLS)

All tables use Row Level Security (RLS) with policies that:
- Allow users to view data for engagements they have access to
- Allow users to create/update data for their engagements
- Restrict deletion to partners/managers (except classification mappings which users can delete their own)

## Migration File

The complete migration is available at:
```
supabase/migrations/20250115000001_create_trial_balance_new_tables.sql
```

## Notes

- All tables use UUID primary keys
- All tables have `created_at` and `updated_at` timestamps
- All tables reference `engagements` table for multi-tenancy
- Classification mappings are engagement-specific (not global)
- Sessions allow users to save/load their work state

