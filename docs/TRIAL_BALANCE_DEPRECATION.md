> Historical note. Both modules it describes were removed in T-019: `/trial-balance` now redirects to `/financial-statement-review`, and there is no `/trial-balance-new` route. See [Financial Statement Review](project/FINANCIAL_STATEMENT_REVIEW.md) and [current status](project/CURRENT_STATUS.md).

# Trial Balance Module Deprecation

## Overview
The old "Trial Balance" module has been replaced by "Trial Balance New" module. The old module is now hidden from navigation but remains accessible for backward compatibility.

## Status
- ✅ **Trial Balance New**: Active and in use
- ⚠️ **Trial Balance (Old)**: Hidden from navigation, route still accessible

## Changes Made

### 1. Navigation
- **Hidden**: Trial Balance menu item removed from sidebar navigation
- **Route**: `/trial-balance` route still exists and is accessible (for backward compatibility)
- **New Route**: `/trial-balance-new` is the active module

### 2. Database Tables (To Be Deleted Later)

The following database tables are related to the old Trial Balance module and should be deleted in the future:

#### Core Tables
- `trial_balance_lines` - Main table storing trial balance line items
- `schedule_iii_config` - Per-engagement Schedule III configuration

#### Rule Engine Tables
- `aile_rule_sets` - Rule sets container
- `aile_mapping_rules` - AILE/FS Area mapping rules
- `rule_engine_override_rules` - Override rules (Priority 1)
- `rule_engine_keyword_rules` - Keyword matching rules (Priority 2)
- `rule_engine_group_rules` - Group-based rules (Priority 3)
- `rule_engine_validation_rules` - Validation rules

### 3. Migration File
A migration file has been created at:
```
supabase/migrations/20250115000000_deprecate_old_trial_balance_tables.sql
```

**IMPORTANT**: This migration file is for **documentation purposes only**. Do NOT execute it yet. It contains:
- List of all tables to delete
- Verification queries to run before deletion
- Notes about dependencies and backups

### 4. Data Independence
- **Trial Balance New** uses in-memory state (`LedgerRow[]` format)
- **No database persistence** - Data is stored locally in component state
- **No links** to old database tables
- Uses `savedMappings` (in-memory) for classification overrides

## Deletion Checklist (Future)

Before deleting the old tables, ensure:

- [ ] No other modules depend on these tables
- [ ] All data has been backed up
- [ ] Critical data has been migrated (if needed)
- [ ] Stakeholder approval obtained
- [ ] Verification queries have been run
- [ ] Test environment deletion successful
- [ ] Production backup verified

## Verification Queries

Before deletion, run these queries to check dependencies and data:

```sql
-- Check foreign key dependencies
SELECT 
  tc.table_name, 
  kcu.column_name, 
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE constraint_type = 'FOREIGN KEY' 
  AND ccu.table_name IN ('trial_balance_lines', 'aile_rule_sets');

-- Check row counts (for backup reference)
SELECT 'trial_balance_lines' as table_name, COUNT(*) as row_count FROM public.trial_balance_lines
UNION ALL
SELECT 'aile_rule_sets', COUNT(*) FROM public.aile_rule_sets
UNION ALL
SELECT 'aile_mapping_rules', COUNT(*) FROM public.aile_mapping_rules
UNION ALL
SELECT 'schedule_iii_config', COUNT(*) FROM public.schedule_iii_config;
```

## Files Modified

1. `src/components/layout/AppSidebar.tsx` - Hidden Trial Balance menu item
2. `supabase/migrations/20250115000000_deprecate_old_trial_balance_tables.sql` - Documentation migration

## Files NOT Modified (Still Exist)

- `src/pages/TrialBalance.tsx` - Old module component (still accessible via route)
- `src/hooks/useTrialBalance.ts` - Old module hook
- `src/components/trial-balance/*` - Old module components
- Route `/trial-balance` in `src/App.tsx` - Still accessible

## Notes

- The old Trial Balance module can still be accessed directly via URL: `/trial-balance`
- The new module is completely independent and uses no database tables
- All classification mappings in Trial Balance New are stored in-memory
- Future persistence for Trial Balance New should use new tables, not the old ones

