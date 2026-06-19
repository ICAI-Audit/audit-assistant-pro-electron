# Trial Balance New Fixes Branch - Dependencies & Related Files

## Branch: `trial-balance-new-fixes`

Last Updated: January 18, 2026

---

## NPM Dependencies

### Core React & Framework
- **react**: ^18.3.1 - UI library
- **react-dom**: ^18.3.1 - React DOM rendering
- **react-router-dom**: ^6.30.1 - Client-side routing
- **react-hook-form**: ^7.61.1 - Form state management
- **@hookform/resolvers**: ^3.10.0 - Form validation resolvers

### UI Component Libraries (Radix UI)
- @radix-ui/react-accordion: ^1.2.11
- @radix-ui/react-alert-dialog: ^1.1.14
- @radix-ui/react-checkbox: ^1.3.2
- @radix-ui/react-dialog: ^1.1.14
- @radix-ui/react-dropdown-menu: ^2.1.15
- @radix-ui/react-label: ^2.1.7
- @radix-ui/react-popover: ^1.1.14
- @radix-ui/react-select: ^2.2.5
- @radix-ui/react-tabs: ^1.1.12
- @radix-ui/react-tooltip: ^1.2.7
- @radix-ui/react-scroll-area: ^1.2.9
- @radix-ui/react-switch: ^1.2.5
- @radix-ui/react-slider: ^1.3.5
- @radix-ui/react-progress: ^1.1.7

### Styling & UI
- **tailwindcss**: ^3.4.17 - Utility-first CSS framework
- **tailwind-merge**: ^2.6.0 - Merge Tailwind classes
- **tailwindcss-animate**: ^1.0.7 - Animation utilities
- **clsx**: ^2.1.1 - Utility for constructing class names
- **class-variance-authority**: ^0.7.1 - Component variant management
- **lucide-react**: ^0.462.0 - Icon library

### Data & State Management
- **@tanstack/react-query**: ^5.83.0 - Server state management
- **zod**: ^3.25.76 - TypeScript-first schema validation
- **react-window**: ^1.8.10 - Virtualized list rendering
- **react-resizable-panels**: ^2.1.9 - Resizable panel layout

### Backend & API
- **@supabase/supabase-js**: ^2.89.0 - Supabase client library
- **odbc**: ^2.4.9 - ODBC database connections for Tally

### File & Data Processing
- **exceljs**: ^4.4.0 - Excel file manipulation
- **xlsx**: ^0.18.5 - Excel read/write
- **jspdf**: ^4.0.0 - PDF generation
- **jspdf-autotable**: ^5.0.2 - PDF table generation
- **pdf-lib**: ^1.17.1 - PDF creation & manipulation
- **pdf-parse**: ^2.4.5 - PDF parsing
- **docx**: ^9.5.1 - Word document generation
- **mammoth**: ^1.11.0 - DOCX to HTML conversion
- **jszip**: ^3.10.1 - ZIP file handling

### Date & Utilities
- **date-fns**: ^3.6.0 - Date utility library
- **markdown-it**: ^14.1.0 - Markdown parser
- **react-markdown**: ^10.1.0 - React markdown renderer
- **sonner**: ^1.7.4 - Toast notifications
- **cmdk**: ^1.1.1 - Command menu component
- **vaul**: ^0.9.9 - Drawer component
- **next-themes**: ^0.3.0 - Theme provider
- **recharts**: ^2.15.4 - React charting library

### Build & Development Tools
- **vite**: ^5.4.19 - Build tool & dev server
- **@vitejs/plugin-react-swc**: ^3.11.0 - Vite React plugin
- **typescript**: ^5.8.3 - TypeScript compiler
- **eslint**: ^9.32.0 - JavaScript linter
- **electron**: ^39.2.7 - Desktop app framework
- **electron-builder**: ^26.0.12 - Electron app builder
- **concurrently**: ^9.2.1 - Run multiple commands
- **ts-node**: ^10.9.1 - TypeScript execution for Node.js

---

## Source Code Structure

### Main Page Component
- **[src/pages/FinancialReview.tsx](src/pages/FinancialReview.tsx)** - Main page for trial balance review (7295 lines)
  - Contains: Trial Balance display, classification, notes management, bulk operations

### Core Components (Financial Review)
```
src/components/financial-review/
├── ActualTBTable.tsx              - Virtualized table for actual trial balance (412 lines)
├── ClassifiedTBTable.tsx          - Table for classified trial balance
├── FinancialReviewToolbar.tsx      - Toolbar with filters and operations
├── InlineCombobox.tsx             - Inline editing combobox component
└── TotalsBar.tsx                  - Status/totals bar component
```

### Utility Functions (Financial Review)
```
src/utils/financialReview/
├── filters.ts                     - Filtering logic
├── rows.ts                        - Row data manipulation
├── search.ts                      - Search functionality
├── selection.ts                   - Row selection management
└── totals.ts                      - Calculation of totals
```

### Trial Balance Utilities
```
src/utils/
├── noteFaceBuilder.ts             - Building note faces from note data
├── noteBuilder.ts                 - Building note structures
├── noteNumbering.ts               - Note number generation & management
├── classificationRules.ts         - Classification rule engine
├── bsplHeads.ts                   - Balance Sheet & P&L heads management
├── bulkUpdate.ts                  - Bulk update operations
├── trialBalanceNewAdapter.ts      - Trial balance data adapter
├── statementFormula.ts            - Formula evaluation for statements
├── tallyGroupMaster.ts            - Tally group master data
├── naturalBalance.ts              - Natural balance determination
├── computePLNoteValues.ts         - P&L note value calculations
└── balanceReclassification.ts     - Balance reclassification logic
```

### Core Services
```
src/services/
├── trialBalanceNewClassification.ts   - Classification service (Main service)
└── scheduleIIIRuleEngine.ts           - Schedule III rule processing
```

### Custom Hooks (Trial Balance Related)
```
src/hooks/
├── useTrialBalance.ts             - Trial balance data hook
├── useTallyConnection.ts          - Tally connection management
├── useTallyBridge.ts              - Tally bridge interface
├── useTallyODBC.ts                - ODBC connection for Tally
├── useDebouncedValue.ts           - Debounce utility hook
├── useMeasuredElementHeight.ts    - Measure element height hook
├── useResizableColumns.ts         - Column resize management
└── useKeyboardShortcuts.ts        - Keyboard shortcuts handling
```

### Contexts (State Management)
```
src/contexts/
├── AuthContext.tsx                - Authentication state
├── EngagementContext.tsx          - Engagement/client context
└── TallyContext.tsx               - Tally connection context
```

### Data Types
```
src/types/
├── financialStatements.ts         - Financial statement types
├── audit.ts                       - Audit types
└── (other domain-specific types)
```

---

## Key External Services/APIs

### Supabase Integration
- Location: `src/integrations/supabase/client.ts`
- Purpose: Backend database, authentication, real-time updates
- Tables Used: Trial balance data, classification rules, engagement data

### Tally ODBC Bridge
- Uses: `odbc` npm package
- Purpose: Real-time data fetch from Tally via ODBC
- Handler: Electron IPC handlers
  - `odbc-fetch-old-tally-ledgers`
  - `odbc-fetch-new-tally-ledgers`
  - `odbc-compare-opening-balances`
  - `odbc-fetch-month-wise-data`
  - `odbc-fetch-gst-not-feeded`

### Electron IPC Communication
- Location: `electron/` directory
- Purpose: Bridge between React frontend and desktop app backend
- Uses: ODBC connections, file I/O, system operations

---

## Configuration Files

```
Root Directory
├── package.json               - Project dependencies & scripts
├── tsconfig.json              - TypeScript configuration
├── tsconfig.app.json          - App-specific TS config
├── tsconfig.node.json         - Node-specific TS config
├── vite.config.ts             - Vite build configuration
├── tailwind.config.ts         - Tailwind CSS configuration
├── postcss.config.js          - PostCSS configuration
├── eslint.config.js           - ESLint configuration
├── components.json            - Component library config
└── tally_config.json          - Tally configuration
```

---

## Test Files

```
tests/
├── classificationRules.test.ts           - Classification rules tests
└── bulkUpdateDialog.integration.test.ts  - Bulk update integration tests
```

---

## Important File Relationships

### Data Flow: Tally → Application

```
Tally Database
    ↓
ODBC Connection (via electron/main.cjs)
    ↓
trialBalanceNewClassification.ts (Service)
    ↓
useTrialBalance.ts (Hook)
    ↓
FinancialReview.tsx (Main Page)
    ↓
ActualTBTable.tsx / ClassifiedTBTable.tsx (Display)
```

### Classification Flow

```
Raw Ledger Data
    ↓
classificationRules.ts (Apply rules)
    ↓
tallyGroupMaster.ts (Validate groups)
    ↓
bsplHeads.ts (Map to BS/PL heads)
    ↓
FinancialReview.tsx (Display results)
```

### Note Generation Flow

```
Trial Balance Data
    ↓
noteBuilder.ts (Build structure)
    ↓
noteNumbering.ts (Assign numbers)
    ↓
noteFaceBuilder.ts (Build faces)
    ↓
FinancialReview.tsx (Display in notes tabs)
```

---

## Current Branch Status

### Recent Changes (Latest Commit)
- Fixed: `noteSourceData` initialization order in FinancialReview.tsx
- Fixed: `toggleRowSelection` prop destructuring in ActualTBTable.tsx
- Removed: Trial-balance-new component imports (no longer used)
- Enhanced: Classification rules and note face building

### Active Features
- Trial balance import and classification
- Manual inventory entries
- Bulk updates on ledgers
- Balance Sheet and P&L notes generation
- Multi-tab interface (Actual TB, Classified TB, Notes BS, Notes PL)
- Table settings (column widths, fonts, row heights)
- Statement variables and formula support
- Keyboard shortcuts support

---

## Related Files Not in trial-balance-new-fixes

These are dependencies from other branches but used by this branch:
- `src/components/audit/` - Audit framework components
- `src/components/ui/` - Reusable UI components
- `src/components/layout/` - Layout components
- `src/components/auth/` - Authentication components
- `src/lib/utils.ts` - Utility functions
- All other utility and service files

---

## Build Artifacts

```
dist/                - Built Vite application
electron-dist/      - Packaged Electron app
node_modules/       - Installed dependencies (git-ignored)
```

---

## Environment Configuration

### Key Environment Variables
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_KEY` - Supabase anonymous key
- `VITE_DEV_SERVER_URL` - Development server URL (for Electron)
- `NODE_ENV` - Environment (development/production)

---

## Git Information

- **Current Branch**: trial-balance-new-fixes
- **Remote**: origin (https://github.com/ICAI-Audit/audit-assistant-pro-electron)
- **Related Branches**:
  - main - Production ready code
  - tally - Tally-specific features
  - Other feature branches

---

## Notes for Developers

### Key Performance Considerations
1. **Virtualization**: ActualTBTable uses react-window for handling large datasets
2. **Debouncing**: Searches are debounced to prevent excessive re-renders
3. **Memoization**: Components use React.memo for optimization
4. **Lazy Loading**: Modal dialogs and heavy components load on demand

### Common Development Tasks

**Adding a new classification rule:**
1. Modify `src/utils/classificationRules.ts`
2. Update `src/services/trialBalanceNewClassification.ts`
3. Test in `tests/classificationRules.test.ts`

**Modifying table display:**
1. Update `src/components/financial-review/ActualTBTable.tsx` or `ClassifiedTBTable.tsx`
2. Update `src/utils/financialReview/` utility files as needed
3. Adjust `tableSettings` state in `FinancialReview.tsx`

**Adding ODBC handlers:**
1. Add handler in `electron/main.cjs`
2. Create corresponding hook in `src/hooks/`
3. Integrate with `useTrialBalance` or `useTallyConnection`

