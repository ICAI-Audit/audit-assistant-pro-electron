> Historical Supabase-era guide. The `scripts/run-*migration*`, `setup-migration-helper.sql` and `apply-migration.cjs` helpers it names were removed in T-020 (they targeted the removed `tb_new_*` tables, read `supabase/migrations/` files that now live only under `_archive/`, and are not part of the SQLite application). See [current status](project/CURRENT_STATUS.md).

# Running Trial Balance New Migration

This guide explains how to run the database migration to create all tables for the Trial Balance New module.

## Migration File
The migration file is located at:
```
supabase/migrations/20250115000001_create_trial_balance_new_tables.sql
```

## Method 1: Supabase Dashboard (Recommended - Easiest)

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy the entire contents of `supabase/migrations/20250115000001_create_trial_balance_new_tables.sql`
6. Paste into the SQL Editor
7. Click **Run** (or press Ctrl+Enter)
8. Verify all tables were created successfully

## Method 2: Supabase CLI

If you have Supabase CLI installed:

```bash
# Link to your project (if not already linked)
supabase link --project-ref jrwfgfdxhlvwhzwqvwkl

# Push migrations
supabase db push
```

Or run the specific migration:

```bash
supabase migration up
```

## Method 3: PowerShell Script (Windows)

A PowerShell script is provided for Windows users:

```powershell
# Run the script (it will prompt for database password)
.\scripts\run-migration-psql.ps1

# Or provide password directly
.\scripts\run-migration-psql.ps1 -DbPassword "your-password"
```

**Requirements:**
- PostgreSQL client (`psql`) must be installed
- Database password from Supabase Dashboard

**To get database password:**
1. Go to Supabase Dashboard > Project Settings > Database
2. Find "Connection string" section
3. Copy the password from the connection string

## Method 4: Direct psql Connection

If you have PostgreSQL client installed:

```bash
# Set password (replace with your actual password)
export PGPASSWORD="your-database-password"

# Run migration
psql -h jrwfgfdxhlvwhzwqvwkl.supabase.co \
     -p 5432 \
     -U postgres \
     -d postgres \
     -f supabase/migrations/20250115000001_create_trial_balance_new_tables.sql
```

## Method 5: Node.js Script

A Node.js script is provided (requires service role key):

1. Add your Supabase Service Role Key to `.env`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

2. Run the script:
   ```bash
   node scripts/run-tb-new-migration.js
   ```

**To get service role key:**
1. Go to Supabase Dashboard > Project Settings > API
2. Copy the `service_role` key (keep this secret!)

## Verification

After running the migration, verify tables were created:

```sql
-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'tb_new_%'
ORDER BY table_name;

-- Expected output:
-- tb_new_classification_mappings
-- tb_new_entity_info
-- tb_new_ledgers
-- tb_new_sessions
-- tb_new_stock_items
```

## Troubleshooting

### Error: "relation already exists"
- The tables may already exist. Check if migration was already run.
- If you want to recreate, drop tables first (be careful!):
  ```sql
  DROP TABLE IF EXISTS tb_new_ledgers CASCADE;
  DROP TABLE IF EXISTS tb_new_stock_items CASCADE;
  DROP TABLE IF EXISTS tb_new_classification_mappings CASCADE;
  DROP TABLE IF EXISTS tb_new_sessions CASCADE;
  DROP TABLE IF EXISTS tb_new_entity_info CASCADE;
  ```

### Error: "permission denied"
- Make sure you're using the correct credentials
- For Supabase Dashboard, you're automatically authenticated
- For psql/CLI, use the database password from Dashboard

### Error: "function exec_sql does not exist"
- The Node.js script method requires a custom function
- Use Method 1 (Dashboard) or Method 2 (CLI) instead

## What Gets Created

The migration creates 5 tables:

1. **tb_new_entity_info** - Entity and company information
2. **tb_new_ledgers** - Main ledger entries with H1-H5 classification
3. **tb_new_stock_items** - Stock/inventory items
4. **tb_new_classification_mappings** - User-saved classification overrides
5. **tb_new_sessions** - Saved sessions/workspaces

All tables include:
- Row Level Security (RLS) policies
- Proper indexes for performance
- Foreign key relationships
- Version tracking support

## Next Steps

After migration:
1. Verify tables were created (see Verification section above)
2. Test the Trial Balance New module in the application
3. Import data and verify it saves correctly
4. Check RLS policies are working correctly

