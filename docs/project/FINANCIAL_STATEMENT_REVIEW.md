# Financial Statement Review (T-019)

Authoritative record of the replacement of the former Financial Review screen with the FSG_Bharat financial statement generator, ported from PostgreSQL to ICAI VERA's SQLite database. It supersedes the financial-statement parts of [M-06](modules/M-06.md) and [M-07](modules/M-07.md) for current behaviour; those specifications are kept as the historical record of the removed screen.

## Request and decisions

On 2 November 2026 the user asked to remove the existing Financial Review and financial statement generation functionality and replace it with the supplied, tested FSG_Bharat 0.1.137 source, running on SQLite, under **Audit Execution → Financial Statement Review**. Answers given in that session:

| Question | Answer (2 November 2026, user) |
| --- | --- |
| FSG features to integrate | All of them. Only infrastructure specific to a shared PostgreSQL server is left out (see Differences). |
| Entity and period model | An FSG entity (Auditee) is a VERA client; an FSG entity period is the engagement's financial year. |
| Old tables | Drop only `schedule_iii_config` and the five `tb_new_*` tables, after a backup and only when they are empty. Keep `trial_balance_lines` and `engagement_trial_balance_*`. |
| Navigation | Same sidebar position (after Audit Execution, before Audit Report), labelled Financial Statement Review. |

This request answers D-002 in favour of statement **preparation** in the product (see [decisions](DECISIONS.md)).

Implementation choices made during the task and **awaiting owner confirmation** are listed under [Assumptions](#assumptions-awaiting-confirmation).

## What the screen does

The FSG workflow, unchanged from FSG_Bharat except where noted:

- **Master:** Auditee details (read and edit of FSG-only fields), auditors, signatories, mapping rules.
- **Trial Balance:** upload from Excel, Tally (live HTTP XML), Tally/RealBooks/Zoho/Busy exports, actual TB, journal entries, mapped TB with adjustments and an adjustment log.
- **Stock, Mapping:** the three-stage mapping engine (Map1 → Map2 → Map3 from `Mapping_v2.xlsx`), rectification/recategorisation, learned ledger rules, conflict and discrepancy resolution.
- **Depreciation:** Companies Act (Schedule II, feeds the PPE note), Income-tax Act block-wise, and the older ledger-level schedule.
- **Statements:** Balance Sheet, Statement of Profit and Loss, Cash Flow Statement, Notes (with Fill Details forms), General Notes, Annexures and reconciliations, Exceptions, branch and consolidated views.
- **Features:** ITR views and Excel export, tax computation, deferred tax, PPE import from Tally, ratios and Form 3CD figures, blank Schedule III formats.
- **Generate Financials:** PDF (full and without index/annexures) and Excel, optional "Final" with place and date of signing, which locks the financial year.

## Architecture

| Layer | Location | Notes |
| --- | --- | --- |
| Schema | `sqlite/schema/10_fsg_tables.sql` | 39 tables, applied by `electron/main.cjs` with the other schema files. |
| Main-process module | `electron/fsg/` (ES modules, loaded by `main.cjs` with `import()`) | `index.js` starts the module and registers channels; `db/client.js` is the SQLite adapter; `ipc/*.js` and `services/*.js` are the FSG handlers and services; `authorization.js` holds the channel policy; `assets/` holds `Mapping_v2.xlsx`, `itr-templates/` and the prescribed format reference. |
| IPC | `fsg:<channel>` | Every FSG handler registers into `ipc-registry.js`; `index.js` exposes it as `fsg:<channel>` behind authentication, trusted-frame and scope checks. Plus `fsg:context:open`, `fsg:app:getVersion` and `fsg:status` (in `main.cjs`). |
| Preload | `electron/preload.cjs` → `window.electronAPI.fsg.invoke` | Accepts only `fsg:*` channel names. |
| Renderer | `src/modules/fsg/` (JavaScript/JSX from FSG_Bharat) | `api.js` keeps FSG's `window.api` method names; `portalRoot.js` and `fsg.css` keep FSG styles inside `.fsg-root`; `App.jsx` is driven by the selected engagement. |
| Page and route | `src/pages/FinancialStatementReview.tsx`, `/financial-statement-review` | Lazily loaded behind `RouteErrorBoundary`; `/financial-review` and `/trial-balance` redirect here. Ctrl+B opens it. |
| Static files | `public/fsg/` | Schedule III reference PDFs. |

Start-up order: VERA schema files → existing migrations → legacy-table cleanup → FSG data routines (default mapping seed from `Mapping_v2.xlsx` when its hash changes, stock categories, mapping caption migrations, mapping patches, one-time repairs) → channel registration → window. A start-up failure of the module is reported on the screen through `fsg:status` and does not stop VERA.

## Data model

### VERA ↔ FSG mapping

| FSG | VERA source | Rule |
| --- | --- | --- |
| `entities` (Auditee) | `clients` | `entities.client_id` (unique). Name, constitution, address, CIN and PAN are copied from the client every time the screen opens and re-applied on every Auditee save; they are read-only in the screen. Branches and nature of business stay FSG fields. |
| Constitution | `clients.constitution` | company → 3 Company; llp → 2 LLP; partnership → 1 Partnership; proprietorship → 1 Proprietorship. Trust, society, AOP, HUF and cooperative are refused with a message (no FSG format). |
| `financial_periods` | `engagements.financial_year` (`2024-25`) | 1 April 2024 – 31 March 2025. |
| `entity_periods` | the client's engagements for that year | One per client and year, shared by every engagement of that client and year (e.g. statutory and tax audit). `engagement_id` records the engagement that first opened it. The previous year is created for comparatives and linked to that year's engagement when one exists. |

### Engagement summary for Dashboard, Audit Report setup and Data Integrity (T-021)

The three screens that used to read `engagement_trial_balance_*` / `trial_balance_lines` now call the read-only channel `fsg:engagement:summary` (`electron/fsg/engagement-summary.js`, renderer client `src/lib/fsgEngagementSummary.ts`). Owner decision (2 November 2026): read Financial Statement Review data only; legacy rows are neither read, migrated nor deleted.

| Aspect | Rule |
| --- | --- |
| Access | Same check as `fsg:context:open`: the main process requires an authenticated, trusted frame and `hasEngagementAccess` for the engagement. A user outside the engagement gets a refusal, so figures never cross clients or unassigned engagements. The channel writes nothing and does not open or create FSG records. |
| Client | `engagements.client_id` → `entities.client_id`. No entity (screen never opened for the client) → "no trial balance". |
| Engagement and year | `engagements.financial_year` (`2024-25`) → `financial_periods` (1 April – 31 March) → `entity_periods` of that entity. Statutory and tax-audit engagements of the same client and year read the same figures. CY is that year; PY is the year before it (the period created for comparatives). |
| Trial balances | Every `trial_balances` row of the entity period is included, so branch trial balances of one year are added together. |
| Classification | A `tb_rows` line counts as classified when its `mapped_tb` row has status `auto_high`, `auto_medium`, `auto_low`, `user_approved` or `user_override` (the statuses used by the Balance Sheet query in `electron/fsg/ipc/financials.js`). Unclassified = rows − classified. The Dashboard shows classification complete when rows exist and none is unclassified. |
| Amount | `tb_rows.closing_balance` after adjustments (revised balance), taken as an absolute value per ledger line and summed, exactly as the former cross-check did with `Math.abs(closing_balance)`. The ledger sign stays in `tb_rows` unchanged; the absolute value is used only for the cross-check. |
| Face lines | Level 2 caption of the mapped line, from `level_format.level2` (else `mapped_tb.mapping2_resultant`), compared case-insensitively: Paid-up capital = "Share capital"; Reserves and surplus = "Reserves and surplus"; Borrowings = "Long-term borrowings" + "Short-term borrowings" (Schedule III 2021 current maturities map into Short-term borrowings). Non-company constitutions use other captions ("Partners' capital" and similar) and therefore return 0 for Paid-up capital; the owner has not approved a mapping for them. |
| Data Integrity | The delete-engagement guard counts the FSG trial balance rows of the engagement's client and year. Those rows belong to the client and year, not the engagement, and survive engagement deletion (`engagement_id` is set to NULL), so the guard is conservative. |
| Legacy data | `trial_balance_lines` and `engagement_trial_balance_*` remain in the database untouched and are no longer read. Deleting an engagement still cascades to its legacy rows, as before. `useTrialBalance` is kept without a consumer. |

### Tables

Global masters: `schema_migrations`, `mapping_rule_sets`, `level_format`, `map1`, `map2`, `map3`, `auditor_firms`, `global_signatories`, `financial_periods`. Per client: `entities`, `auditors`, `signatories`, `entity_note_details`, `entity_note_disclosures`, `entity_manual_py_entries`, `it_blocks_custom`, `learned_ledger_rules`. Per year: `entity_periods`, `form_3cd`, `ppe_ledgers`, `ratio_gp_selection`, `fs_snapshots`, `general_notes`, `deferred_tax_computations`, `tax_computations`, `cash_flow_entries`. Per trial balance: `trial_balances`, `tb_rows`, `mapped_tb`, `note_details`, `note_disclosures`, `remarks`, `dep_schedules`, `dep_it_schedules`, `dep_comp_schedules`, `itr_details`, `manual_py_entries`, `tb_adjustment_log`, `manual_face_lines`. Column detail is in the schema file.

Deletion: deleting an engagement keeps the shared statements (`engagement_id` is set to NULL). Deleting a client that still has statement data is refused (foreign key RESTRICT). Inside FSG, deletions cascade as they did in PostgreSQL, with two additions so the cascade can run in SQLite: a trial balance's `entity_period_id` cascades with its period, and `entity_periods.prev_tb_id` is cleared when that trial balance is deleted.

### PostgreSQL → SQLite conversion

| PostgreSQL | SQLite |
| --- | --- |
| `SERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `BOOLEAN` | `INTEGER` 0/1 with CHECK; the adapter returns the known boolean columns as true/false |
| `TIMESTAMPTZ DEFAULT now()` | ISO-8601 UTC text; `now()` is a registered function returning the same format |
| `NUMERIC` | NUMERIC affinity (binary floating point). The `tb_rows` closing-balance identity CHECK allows a difference below half a paisa |
| `JSONB` | `TEXT` with `json_valid` CHECK; handlers parse on read |
| `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT`, catalog probes | Folded into one `CREATE TABLE` per table; CHECK inline |
| `$1..$n` | Rewritten to positional `?` by the adapter (reused numbers expanded) |
| Pool, `AsyncLocalStorage` transactions, advisory lock | One connection; `BEGIN IMMEDIATE` transactions serialised by the adapter; start-up lock removed |
| `regexp_replace`, `btrim`, `strpos`, `greatest`, `least` | Registered SQLite functions with PostgreSQL semantics |
| `ILIKE`, `!~*`, `::` casts | `LIKE` (ASCII case-insensitive), explicit `NOT LIKE`, `CAST(...)` or removed |
| `= ANY($n::int[])`, `unnest(string_to_array(...))` | `IN (SELECT value FROM json_each(...))`, recursive or `json_each` split |
| `DISTINCT ON` | `ROW_NUMBER() OVER (...) = 1` |
| Data-modifying CTEs with `FOR UPDATE` (Mapped TB adjustments, clear adjustments) | SELECT, UPDATE, INSERT inside one transaction |
| `UPDATE t alias` | `UPDATE t AS alias` |
| Unique violation `23505` | `SQLITE_CONSTRAINT_UNIQUE` |

Trial balance uploads (Excel, Tally, RealBooks, Zoho, Busy) now run in one transaction: a failed upload leaves no partial trial balance. No views, triggers, stored procedures or sequences existed in FSG_Bharat.

## Access control

FSG_Bharat had no users. In VERA every `fsg:*` call requires an authenticated, active user with a supported role from the main application frame, and a policy entry; unknown channels are refused. `electron/fsg/authorization.js`:

- **Read** of client data: access to at least one engagement of the client (partners and admins: every client).
- **Change** to a year's data (trial balances, mapping, notes, statements, lock, finalise): access to an engagement of that client for that year or the following year.
- **Change** to client-level data (auditors, signatories, custom mapping rules, learned rules, consolidated settings): client access.
- **Unlock** a financial year: manager, partner or admin.
- Global auditor firms and their signatories: manager, partner or admin. Default mapping rules cannot be changed through the screen.
- Export of every FSG table (all clients): partner or admin.
- Every id named in one call must belong to the same client.
- Files: a path is accepted only if the user chose it in an FSG open/save dialog in this session (or, for saving, a file written beside the chosen one with the chosen name as prefix and the same extension, as Generate Financials does for its second PDF). ITR template names are restricted to the bundled three. The hidden PDF window cannot navigate or open windows.
- Disabled in VERA: Auditee create/delete, Financial Period master, attach/detach of periods, PostgreSQL settings.

## Removed

- **Screens and code:** `src/pages/FinancialReview.tsx`, the unused legacy `src/pages/TrialBalance.tsx`, `src/components/financial-review/`, `src/components/trial-balance-new/`, `src/components/notes/`, classification and bulk-update services and utilities, the Schedule III head and Tally group data, note/face/formula builders, financial-review grid helpers and hooks, legacy export and adapter utilities, `useEngagementTrialBalance`, `ExportedFileDialogContext` and `openExportedFile`. A script confirmed that nothing outside this set imported it.
- **Tooling and assets:** `scripts/export-classification-logics.mjs` and both copies of `classification_logics.xlsx`.
- **Tests and scripts:** `test:classification` and `test:bulk-update`, and their tests. They tested only the removed classification code.
- **IPC:** `app:getDownloadsPath` and `app:openPath`, used only by the removed export dialog.
- **Database:** `schedule_iii_config`, `tb_new_entity_info`, `tb_new_ledgers`, `tb_new_stock_items`, `tb_new_classification_mappings` and `tb_new_sessions`. They had no reader or writer and were removed from `05_trial_balance_tables.sql` and the authorization lists. On an existing database they are dropped at start-up only if all are empty, after `VACUUM INTO <userData>/backups/audit_assistant-before-T019-legacy-tb-cleanup-<time>.db`; otherwise they are kept and a message is logged.
- **Kept, because other modules use them:** `trial_balance_lines` and `useTrialBalance` (Audit Report setup, admin data integrity), `engagement_trial_balance_*` (dashboard, T-003 test), and the Tally ODBC handlers, `useTallyODBC` and `TallyContext` (VERA Tools). The tax-audit source chips keep their stored key `financial_review` and now open Financial Statement Review.

## Differences from FSG_Bharat

- No PostgreSQL connection form, no cross-PC start-up lock, no multiple windows or pop-outs. The Settings button now opens Tools: the FSG data export and the format reference.
- Fs snapshots are kept locally. FSG_Bharat's external reader (Cloudtail MCA) read them from the shared server and cannot do so here. `created_by` remains the operating-system user name.
- The full-database export covers only the 39 FSG tables, and only partners and admins can run it.
- The window title, menu bar and zoom are VERA's. FSG's keyboard shortcuts (Ctrl+Shift+letter, Ctrl+Z/Y, Esc) apply only while the screen is open and take priority over VERA's global shortcuts there. Ctrl+T no longer opens a screen.
- Themes and styles apply only inside the screen. The screen stays light when VERA uses its dark theme.

## Assumptions awaiting confirmation

1. Trust, society, AOP, HUF and cooperative clients are refused, because FSG has no format for them.
2. The financial year is always 1 April to 31 March, derived from the engagement's `financial_year`.
3. One set of statements is shared per client and year across that year's engagements.
4. A year can be changed by the team of that year or of the following year.
5. Unlocking needs a manager or above.
6. Deleting a client with statements is refused.
7. Deleting an engagement keeps the statements.
8. The Tally ODBC fallback through a local Python/pyodbc installation is retained from FSG_Bharat. The HTTP XML path is the primary one.

## Verification

Run on Windows with Electron 40.9.1, SQLite 3.53.0, Node.js 22.14.0 (npm 10.9.2) on 2 November 2026, synthetic data only:

- `npm run test:fsg` (`scripts/test-fsg-integration.mjs`, Electron main process, in-memory database): **41/41 passed**. It covers:
  - schema and mapping seed (682 format rows; Map1 273, Map2 239, Map3 313);
  - authentication, trusted frame and the cross-client, disabled-channel, file-path, export, global-master and ITR-template refusals;
  - engagement context and the shared year;
  - upload → mapping → statement data;
  - adjustments and their log, and the period lock with manager-only unlock;
  - JSON documents;
  - transaction serialisation and rollback;
  - engagement and client deletion behaviour.
- `npm run test:fsg-ui` (`scripts/test-fsg-ui.cjs`, production renderer in an isolated profile): **37/37 passed**. It covers:
  - an upgrade database built from the schema at HEAD, with an existing client;
  - the legacy-table removal with its backup;
  - the new tab, sidebar position, Balance Sheet, Profit and Loss and Generate Financials screens;
  - the old-route redirect and Ctrl+B;
  - Dashboard, Audit Execution, Materiality, Audit Report, Tax Audit, VERA Tools and Evidence screens;
  - restart persistence;
  - database integrity and foreign-key checks.
- Also run: T-003 IPC suite 26/26; native smoke; `npx vitest run src/lib` 37/37; `npm run build`.

Not established: a figure-by-figure comparison with FSG_Bharat on PostgreSQL for the same trial balance; FSG_Bharat's ~70 self-tests (they need PostgreSQL and were not ported); live Tally; PDF/Excel file content review; installer; owner UAT.
