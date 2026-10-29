# Architecture

## Active runtime

The package entry is electron/main.cjs. npm run electron uses electron/run-electron.cjs, which removes ELECTRON_RUN_AS_NODE and spawns Electron. Development runs Vite on port 8080 and supplies VITE_DEV_SERVER_URL. Production loads dist/index.html. The active BrowserWindow selects electron/preload.cjs, disables nodeIntegration, and enables contextIsolation and webSecurity. These settings do not by themselves establish secure IPC authorization.

src/main.tsx mounts src/App.tsx. HashRouter supports packaged local-file navigation. React Query handles query state. AuthContext, EngagementContext, TallyContext, and ExportedFileDialogContext provide session, engagement, integration, and export state. src/components/layout holds the shared navigation and layout.

## Data path

A page or hook calls src/integrations/sqlite/client.ts. Its Supabase-shaped chain sends a structured payload through window.electronAPI.sqliteQuery. The preload invokes sqlite-query. The main handler builds and executes SQLite queries through better-sqlite3. Authentication uses sqlite-auth and an in-memory currentUserId. Profiles and roles are loaded into React after sign-in. AuthContext deliberately signs out on startup.

The active handler is inline in main.cjs. sqlite/database-manager.ts and sqlite/access-control.ts define a different abstraction; their presence is not proof that the active IPC path enforces their checks. The generic handler needs the authorization verification task in NEXT_TASKS.md.

The database opens under app.getPath('userData') as audit_assistant.db, with foreign keys enabled and WAL journalling. Startup reads sqlite/schema SQL and runs additional report, template, and tax-audit backfills in main.cjs. Migration scripts in scripts and Supabase artefacts must be classified before reuse; they are not interchangeable with desktop startup migrations.

## File path

Evidence metadata uses evidence_files and linking tables. src/hooks/useEvidenceFiles.ts calls the storage wrapper in the active SQLite client; preload forwards file-save, file-download, file-delete, and file-get-path. Main stores bytes below userData/files/bucket and normalises file paths. App exports use separate app:exportFile and app:openPath handlers. Check path validation, engagement authorization, cleanup on failed metadata writes, and backup completeness before relying on the evidence vault.

## Modules and integrations

FinancialReview is the active TB and statement workspace. Both /trial-balance and /financial-review route there. Multiple TB table families exist; follow its imports and hooks rather than assuming the legacy TrialBalance page is active. LocalStorage retains entity details, stock, classification settings, and layouts in parts of this module.

TaxAudit uses useTaxAudit, clause definitions and field schemas, readiness and report-pack builders, statutory-version checks, and report editors. Draft 3CD Word, Excel, PDF and HTML exporters are in TaxAudit.tsx. Draft 3CA and 3CB editors have persisted report-document hooks. The portal submission path has not been established.

Tally uses local ODBC and other connection hooks; ODBC loading is optional. GSTZen requests cross preload and main-process HTTP handlers and use external sessions. The updater uses electron/auto-updater.cjs and GitHub release configuration. No verified general-purpose AI execution path is included in this baseline.

## Change boundaries

| Change | Inspect together |
| --- | --- |
| Persisted screen data | Page, hook, IPC payload, main handler, SQL schema, reload and engagement-switch behaviour |
| Permissions | Auth context, UI guards, active main handler, role/assignment lookup, negative tests |
| Financial figures | Import adapter, classification rules, calculations, note builders, export and reconciliation tests |
| Reports | Inputs, saved editable content, preview, export builders, period and source metadata |
| Desktop packaging | package.json, run-electron.cjs, main.cjs, preload.cjs, native rebuild and release workflow |
| Legal amendment | Source register, effective-period rule, clause schema, applicability, wording, exports and boundary tests |

## Known uncertainties

No complete runtime dependency graph or end-to-end validation was performed. Browser-only use fails where module-level getSQLiteClient requires electronAPI. LAN, multi-device concurrency, encryption at rest, complete audit-event coverage, and finalization enforcement remain unverified. The generated inventory records lexical declarations, not runtime reachability.
