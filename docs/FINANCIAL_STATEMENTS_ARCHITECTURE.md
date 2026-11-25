> Historical design document. None of the source files it names exists in the application today (checked on 21 November 2026); the current engine is Financial Statement Review. See [Financial Statement Review](project/FINANCIAL_STATEMENT_REVIEW.md) and [current status](project/CURRENT_STATUS.md).

# Unified Financial Statements Report Engine - Architecture Documentation

## Executive Summary

This document describes the comprehensive architectural design for a unified Financial Statements Report Engine that supports both **Corporate (Schedule III)** and **Non-Corporate Entities (NCE)** using a single codebase, common reporting hierarchy, and stable technical identifiers.

## Core Design Principles

### 1. **Stable Technical Codes**
- **Technical codes NEVER change** - they are immutable identifiers
- Examples: `EQUITY_HEAD`, `SHARE_CAPITAL`, `EQUITY_SHARE_CAPITAL`, `CURRENT_ACCOUNT`
- Used for database storage, Excel exports, pivot tables, Power Query connections
- Ensures complete backward compatibility with existing integrations

### 2. **Dynamic Display Labels**
- Display labels adapt based on entity type (Corporate vs NCE)
- Same technical code can have different labels:
  - `EQUITY_HEAD`: "Shareholders' Funds" (Corporate) vs "Owners' Fund" (NCE)
  - `SHARE_CAPITAL`: "Share Capital" (Corporate) vs "Capital Account" (NCE)
  - `EQUITY_SHARE_CAPITAL`: "Equity Share Capital" (Corporate) vs "Proprietor's Capital / Partners' Capital" (NCE)

### 3. **Single Rule Engine**
- One classification logic serves all entity types
- Same hierarchy structure for both Schedule III and NCE
- Entity-specific items marked with `showInBothEntityTypes: false`

### 4. **Backward Compatibility**
- All existing Excel exports remain valid
- Existing pivot tables continue to work
- Power Query connections unchanged
- Technical codes added as additional columns, not replacements

## Entity Type Configuration

### File: `src/data/entityTypeConfig.ts`

```typescript
export type EntityCategory = 
  | 'company'
  | 'llp'
  | 'partnership'
  | 'proprietorship'
  | 'trust'
  | 'society'
  | 'nce'; // Generic non-corporate entity

export interface EntityTypeConfig {
  category: EntityCategory;
  displayName: string;
  isScheduleIII: boolean;
  labelSet: 'corporate' | 'nce';
}
```

### Entity Type Mappings

| Constitution | Category | Schedule III | Label Set |
|-------------|----------|--------------|-----------|
| Company | company | ✅ Yes | corporate |
| LLP | llp | ❌ No | nce |
| Partnership | partnership | ❌ No | nce |
| Proprietorship | proprietorship | ❌ No | nce |
| Trust | trust | ❌ No | nce |
| Society | society | ❌ No | nce |

### Label Mapping Structure

```typescript
export interface LabelMapping {
  technicalCode: string;        // STABLE - Never changes
  corporateLabel: string;       // For companies
  nceLabel: string;             // For NCE
  displayOrder: number;
}
```

### Example Label Mappings

#### Balance Sheet Sections

| Technical Code | Corporate Label | NCE Label |
|---------------|----------------|-----------|
| `EQUITY_HEAD` | Shareholders' Funds | Owners' Fund |
| `SHARE_CAPITAL` | Share Capital | Capital Account |
| `EQUITY_SHARE_CAPITAL` | Equity Share Capital | Proprietor's Capital / Partners' Capital |
| `PREFERENCE_SHARE_CAPITAL` | Preference Share Capital | N/A (not applicable) |
| `CURRENT_ACCOUNT` | N/A (not applicable) | Current Accounts |
| `DRAWINGS` | N/A (not applicable) | Less: Drawings |
| `SECURITIES_PREMIUM` | Securities Premium | N/A (not applicable) |
| `RETAINED_EARNINGS` | Surplus (P&L Account) | Surplus (P&L Account) |

#### P&L Sections

| Technical Code | Corporate Label | NCE Label |
|---------------|----------------|-----------|
| `REVENUE_OPS` | Revenue from Operations | Revenue from Operations |
| `COST_MATERIALS` | Cost of Materials Consumed | Cost of Materials Consumed |
| `PURCHASES_STOCK` | Purchases of Stock-in-Trade | Purchases of Stock-in-Trade |
| `CHANGES_INVENTORY` | Changes in Inventories of FG, WIP and Stock-in-Trade | Changes in Inventories |

## Enhanced Hierarchy Structure

### File: `src/data/enhancedFSHierarchy.ts`

```typescript
export interface FSLineItemEnhanced {
  // Stable Technical Identifiers (NEVER CHANGE)
  technicalCode: string;        // Unique stable identifier
  headCode: string;             // Section code (EQUITY_HEAD, ASSETS_HEAD)
  noteCode?: string;            // Note number code
  sectionCode: string;          // Detailed section code
  
  // Hierarchy Levels
  level: number;                // 1=Major Head, 2=Sub-head, 3=Line item
  parentCode?: string;          // Parent technical code
  
  // Classification Metadata
  fsArea: string;               // For matching with trial balance
  statementType: 'bs' | 'pl';   // Balance Sheet or P&L
  section: 'equity' | 'liabilities' | 'assets' | 'income' | 'expenses';
  currentNonCurrent?: 'current' | 'non-current';
  
  // Display Properties (set at runtime based on entity type)
  displayLabel?: string;        // Populated from entityTypeConfig
  displayLabelCorporate: string;// For companies
  displayLabelNCE: string;      // For NCEs
  
  // Formatting
  isBold: boolean;
  isIndented: boolean;
  showInBothEntityTypes: boolean; // false if applicable to only one type
  
  // Excel Export Metadata
  excelColumnGroup?: string;
  excelFormatCode?: string;
  
  // Sorting and Display Order
  displayOrder: number;
}
```

## Excel Export Structure

### File: `src/utils/enhancedExcelExport.ts`

### Enhanced Export Features

1. **Metadata Columns** (Optional, enabled by default)
   - `Technical Code`: Stable identifier (e.g., `BS_EQUITY_CAPITAL`)
   - `Section Code`: Detailed section (e.g., `SHARE_CAPITAL`)
   - `Note Code`: Note reference (e.g., `NOTE_CAPITAL`)
   - `Display Label`: Entity-specific label
   - `Entity Type`: Constitution (company, llp, partnership, etc.)
   - `Label Set`: corporate or nce

2. **Backward Compatibility**
   - All existing columns preserved:
     - Particulars
     - Note No.
     - Current Year (₹)
     - Previous Year (₹)
     - H3, H4, H5 (hierarchy levels)
   - New columns added at end, not replacing existing ones

3. **Export Metadata Sheet**
   - Company Name
   - Financial Year
   - Entity Type
   - Label Set
   - Export Date
   - Statement Type

### Export Options

```typescript
export interface ExportOptions {
  companyName: string;
  financialYear: string;
  constitution: string;
  bsStartingNote?: number;        // Default: 3
  plStartingNote?: number;        // Default: 19
  includeMetadata?: boolean;      // Default: true
  includePreviousYear?: boolean;  // Default: true
  previousYearData?: LedgerRow[];
}
```

### Usage Example

```typescript
import { exportBalanceSheetWithNotes, downloadWorkbook } from '@/utils/enhancedExcelExport';

const exportOptions: ExportOptions = {
  companyName: 'ABC Pvt Ltd',
  financialYear: '2023-24',
  constitution: 'company',
  includeMetadata: true,
  includePreviousYear: true,
  previousYearData: previousYearLedgers
};

const workbook = exportBalanceSheetWithNotes(currentYearData, exportOptions);
downloadWorkbook(workbook, `BS_${companyName}_${financialYear}.xlsx`);
```

## Classification Logic Integration

### Current State

The existing classification engine in `src/services/trialBalanceNewClassification.ts` uses hardcoded labels:

```typescript
// Current approach (to be updated)
return {
  H2: "Equity",
  H3: "Share Capital",
  H4: "Equity Share Capital"
};
```

### Enhanced Approach (Next Step)

```typescript
// Enhanced approach with technical codes
import { getDisplayLabel } from '@/data/entityTypeConfig';

function classifyLedgerWithPriority(
  ledger: LedgerRow,
  businessType?: string,
  constitution?: string
): ClassificationResult {
  
  // ... classification logic ...
  
  // Instead of hardcoded labels, use technical codes
  return {
    H1: 'Balance Sheet',
    H2: 'Equity',
    H3: getDisplayLabel('SHARE_CAPITAL', constitution || 'company', 'bs'),
    H4: getDisplayLabel('EQUITY_SHARE_CAPITAL', constitution || 'company', 'bs'),
    technicalCode: 'BS_EQUITY_SHARES',
    headCode: 'EQUITY_HEAD',
    sectionCode: 'EQUITY_SHARE_CAPITAL',
    noteCode: 'NOTE_CAPITAL'
  };
}
```

## Implementation Roadmap

### Phase 1: Foundation (COMPLETED ✅)

- [x] Create `entityTypeConfig.ts` with label mappings
- [x] Create `enhancedFSHierarchy.ts` with technical codes
- [x] Create `enhancedExcelExport.ts` with metadata support
- [x] Update `ReportsTab.tsx` to use enhanced export functions

### Phase 2: Integration (IN PROGRESS ⚠️)

- [ ] Update `trialBalanceNewClassification.ts` to use technical codes
- [ ] Modify classification logic to return technical codes
- [ ] Add `constitution` parameter to classification functions
- [ ] Update `SCHEDULE_III_MAPPING` to use `technicalCode` instead of labels

### Phase 3: UI Components (PENDING)

- [ ] Update `ScheduleIIIBalanceSheet.tsx` to use `getDisplayLabel()`
- [ ] Update `ScheduleIIIProfitLoss.tsx` to use `getDisplayLabel()`
- [ ] Add entity type selector in UI
- [ ] Test label switching for different entity types

### Phase 4: Database Integration (PENDING)

- [ ] Add `technicalCode` column to `trial_balance_lines` table
- [ ] Add `constitution` column to `engagements` table
- [ ] Migrate existing data to add technical codes
- [ ] Update Supabase types

### Phase 5: Testing & Validation (PENDING)

- [ ] Test Excel export for Company entity
- [ ] Test Excel export for Partnership entity
- [ ] Verify backward compatibility (pivot tables, Power Query)
- [ ] Test label switching between entity types
- [ ] Validate technical codes remain stable

## Migration Strategy

### For Existing Data

1. **Preserve All Existing Columns**
   - No column deletions
   - No column renames
   - Only additions

2. **Add Technical Codes Retroactively**
   - Run migration script to add technical codes based on H3/H4/H5 matching
   - Use fuzzy matching for unmapped items
   - Log unmapped items for manual review

3. **Gradual Rollout**
   - Phase 1: Export with both old and new columns
   - Phase 2: Internal tools use technical codes
   - Phase 3: UI displays entity-specific labels
   - Phase 4: Database uses technical codes as primary identifier

## Usage Examples

### Example 1: Company (Schedule III)

```typescript
const constitution = 'company';
const label = getDisplayLabel('EQUITY_HEAD', constitution, 'bs');
// Returns: "Shareholders' Funds"
```

### Example 2: Partnership (NCE)

```typescript
const constitution = 'partnership';
const label = getDisplayLabel('EQUITY_HEAD', constitution, 'bs');
// Returns: "Owners' Fund"
```

### Example 3: Filtering Applicable Items

```typescript
const bsItems = filterByEntityType(ENHANCED_BS_HIERARCHY, 'company');
// Returns items where displayLabelCorporate !== 'N/A'

const nceItems = filterByEntityType(ENHANCED_BS_HIERARCHY, 'partnership');
// Returns items where displayLabelNCE !== 'N/A'
```

### Example 4: Enhanced Excel Export

```typescript
// Company export
const companyWorkbook = exportBalanceSheetWithNotes(data, {
  companyName: 'ABC Pvt Ltd',
  financialYear: '2023-24',
  constitution: 'company',
  includeMetadata: true
});

// Partnership export (same function, different labels)
const partnershipWorkbook = exportBalanceSheetWithNotes(data, {
  companyName: 'XYZ & Co',
  financialYear: '2023-24',
  constitution: 'partnership',
  includeMetadata: true
});
```

## Benefits

### 1. **Single Codebase**
- One set of components serves all entity types
- Reduced maintenance burden
- Consistent behavior across entity types

### 2. **Future-Proof**
- Easy to add new entity types
- Labels can be updated without code changes
- Technical codes provide stable reference

### 3. **Backward Compatible**
- Existing integrations continue to work
- Excel exports maintain all existing columns
- Pivot tables and Power Query unchanged

### 4. **Flexible**
- Easy to customize labels per entity type
- Can add region-specific variations
- Supports multi-language in future

### 5. **Maintainable**
- Clear separation of technical codes and display labels
- Configuration-driven approach
- Easy to test and validate

## Technical Considerations

### Performance
- Label resolution happens at runtime (minimal overhead)
- Hierarchy filtering happens once during initialization
- Excel export optimized with batch processing

### Type Safety
- Full TypeScript support
- Compile-time validation of technical codes
- Strong typing for entity configurations

### Extensibility
- Easy to add new technical codes
- Label mappings in configuration files
- No code changes required for new labels

## Conclusion

This unified Financial Statements Report Engine provides a robust, maintainable, and future-proof solution for handling both Corporate (Schedule III) and Non-Corporate Entities. The use of stable technical codes ensures backward compatibility, while dynamic display labels provide the flexibility needed for different entity types.

The architecture is designed to:
- ✅ Maintain backward compatibility
- ✅ Support multiple entity types
- ✅ Enable easy customization
- ✅ Ensure type safety
- ✅ Facilitate future enhancements

---

**Last Updated:** December 2024  
**Version:** 1.0  
**Status:** Foundation Complete, Integration In Progress
