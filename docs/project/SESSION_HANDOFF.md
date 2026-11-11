# Latest session handoff

## Session identity

- Date: 2 November 2026.
- Agent: Copilot SDK in VS Code.
- Requested outcome: developer handover preparation: reconcile branches, integrate T-020, reconnect the old trial-balance readers (T-021), resolve the duplicate feedback route (T-012), verify a fresh install and validate. Earlier in the day: T-020 scoped cleanup.
- Task: T-021 and T-012 (with T-020). Features: F-007 consumers, F-018 setup, F-024 route. Related: T-019 (merged), T-022 (recorded only).
- Branches: `chore/remove-unused-code` (T-020, `04d0c9fd33fc997805e112b91138b3d18d85304c`) → `feat/t021-reconnect-tb-readers` (T-021/T-012 on top) → `integration/handover-2026-11-02` (same head as the T-021 branch). Base: `main` = `origin/main` = `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4`. Resolve heads with `git rev-parse`.
- Not merged and not released. CA Venugopal Gella reviews, tests and merges; no acceptance is recorded yet.
- The previous handoff (T-019) is in git history at the base commit; its work is merged as PR #105.

## Current session: GSTIN validation and uppercase normalization (11 November 2026)

- Selected task ID: GSTIN validation and UI normalization across all GST-related entry points; no separate project feature ID was assigned in the current repo workflow.
- Requested outcome: keep the checksum/structure validation in the shared GSTIN validator, enforce it wherever GST numbers are entered or saved, and ensure every GSTIN input auto-normalizes to uppercase before save or as soon as the user types it.
- Validation approach: reuse the shared GSTIN validator already used in the GST number master and bulk GSTIN add flow, apply the same normalization at input and save boundaries across the main GST entry points, and record terminal execution limits separately from the focused fix.
- Updated implementation: `src/lib/gstinValidation.ts` now exports `formatGstinInput()` and keeps the required checksum wording; `src/components/tax-audit/StructuredClauseFields.tsx` normalizes and blocks invalid GST registrations when `law === 'GST'` and `registration_number` is entered; `src/pages/AuditTools.tsx` and `src/components/gstin/AddGstinDialog.tsx` now uppercase on input and before validation/save; `src/components/appointment/Letters.tsx` also normalizes the GSTIN field immediately while typing and on draft restore.
- Exact checks run in this session:
  - Workspace diagnostics on all changed files: `No errors found` for `src/lib/gstinValidation.ts`, `src/components/gstin/AddGstinDialog.tsx`, `src/pages/AuditTools.tsx`, `src/components/tax-audit/StructuredClauseFields.tsx`, and `src/components/appointment/Letters.tsx`.
  - Attempted terminal verification: the shell in this environment returned immediate exit-code errors with no useful output for direct commands such as `echo hi`, `cmd /c ...`, and `npm exec ...`, so no repo-level terminal test result is claimable from this session.
- Remaining failures / gaps in this session: the terminal-based `npm run docs:check` and `npx vitest run src/lib/gstinValidation.test.ts` checks could not be completed because the terminal execution environment is failing before command output is produced. The repo-wide `tsc` and `lint` baselines remain unchanged outside this scope and were not re-run here.
- Next executable step: run `npm run docs:check`, then `npx vitest run src/lib/gstinValidation.test.ts` (or `npx vitest run src/lib`), and finally re-check the repo-wide `tsc` and `lint` baselines in a working terminal before merging.

## Build-information label (after PR #106 merged at 7ef0bc3)

- Branch eat/build-info-label from origin/main 7ef0bc3da3b4be33238724e797e52ac72bffa9d6. Not merged; no acceptance recorded.
- Central message file: `src/config/buildMessage.ts` (`BUILD_MESSAGE.lines`, `updateNote` and optional `sourceBranch`). Edit it only there for each accepted merge; the login page (`src/pages/Auth.tsx`) and the common header (`src/components/layout/Header.tsx`, shown from the `md` breakpoint) both render it through `src/components/layout/BuildInfoLabel.tsx`.
- The short commit ID and the "Local changes present" flag are injected at build time by `vite.config.ts` (`git rev-parse --short HEAD`; `git status --porcelain --untracked-files=no`; `unknown` if git is unavailable). In `npm run dev` they are fixed when the dev server starts. Untracked files do not set the flag.
- The label shows static build facts only. There is no GitHub polling, updater or "latest code" claim. A local build here shows "Local changes present" because the preserved `package-lock.json` modification is tracked.
- Revision 2: the label is a red 2px bordered, rounded, light box showing the two message lines and "Update: <updateNote>" (currently "Initial developer handover"). Change only `updateNote` in `src/config/buildMessage.ts` for each merge. The commit ID, optional source branch and "Local changes present" moved into a "Build details" hover tooltip (`buildDetailLines()` in the same file). Not verified visually in a running window; header fit at 64px height is untested.
- Checks: `vitest src/lib` 41 passed (new `src/lib/buildInfoLabel.test.ts`: label text, commit, dirty flag, no "latest" claims, both screens use the shared component); `npm run build` passed and the bundle contains the message and `7ef0bc3`; `tsc` 76 diagnostics (unchanged baseline); eslint clean on the new files. Not verified: visual rendering in a running window.
## T-021 and T-012 (this session's change)

- New read-only channel `fsg:engagement:summary` (`electron/fsg/engagement-summary.js`, registered in `electron/fsg/index.js` with the same engagement-access check as `fsg:context:open`; renderer client `src/lib/fsgEngagementSummary.ts`). Mapping, sign and amount rules are in [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md#engagement-summary-for-dashboard-audit-report-setup-and-data-integrity-t-021).
- `useEngagementDashboardData`, `AuditReportSetup` and `DataIntegrityPanel` use it. Legacy tables are untouched and unread; no migration, no dropped table (owner decision).
- Duplicate `ProtectedRoute` `/feedback` declaration removed; the engagement-scoped one was already effective (owner decision). `check-project-docs.mjs` note and the screen map updated.
- Owner decisions recorded 2 November 2026: read FSG only; Audit Report cross-check on the FSG face lines with absolute closing balance (labelled "please confirm"); `/feedback` engagement-scoped; placeholders and duplicate deferred-tax tools recorded only.
- Checks: see [CURRENT_STATUS.md](CURRENT_STATUS.md#t-021-handover-result-2-november-2026) (fresh clone; all harnesses passed; `tsc` and lint unchanged baseline failures).
- Handover classification: [HANDOVER_CHECKLIST.md](HANDOVER_CHECKLIST.md).

## T-020 (earlier in the day)

## Preserved, not committed

The working tree already held a modified `package-lock.json` and untracked `ICAI-VERA-Context-Pack/` and `ICAI-VERA-Documentation-Review/` before this task, plus a stash ("backing untracked files before pulling main"). None of them was touched or committed.

## Removed (each had no import, route, IPC registration, package script, build setting, test or live documentation use)

| Files | Evidence |
| --- | --- |
| `src/components/audit/RatioAnalysisCalculator.tsx` | No importer or route; its only dependency, `useTrialBalance`, has other consumers and is kept |
| `src/modules/fsg/components/Notes/InventoryScheduleForm.jsx` | Name appears only in its own file; no component map, `import.meta.glob` or dynamic import in the module |
| `src/modules/fsg/components/Notes/TradePayablesAgingForm.jsx` | Not imported. The IPC channels it called (`notesGetTradePayablesAging`, `notesSaveTradePayablesAging`) stay: `TradePayablesDisclosureForm.jsx` uses them |
| `src/modules/fsg/components/shared/FixCategorisationModal.jsx` | Only a comment in `src/modules/fsg/App.jsx` names it |
| `electron/main.js`, `electron/preload.js` | `package.json` `main` is `electron/main.cjs`; `preload.cjs` is the loaded bridge; `run-electron.cjs` launches `.`. `main.js` uses `require` in a `"type": "module"` package, so it cannot load as a `.js` entry. Only historical updater guides (already marked historical) name them |
| `src/integrations/sqlite/client-ipc.ts` | No importer; `client.ts` is the only client used |
| `src/integrations/supabase/client.ts`, `types.ts` | Only commented-out imports remain (`TallyContext.tsx`, `useTallyBridge.ts`). `@supabase/supabase-js` stays: `AuthContext.tsx` imports its types |
| `src/hooks/useDashboardStats.ts`, `useTallyBridge.ts`, `useTallyConnection.ts` | No importer. Dashboards use `useEngagementDashboardData` and `useOverallDashboardData`; VERA Tools uses `useTallyODBC` |
| `scripts/apply-migration.cjs`, `batch-migrate-hooks.js`, `complete-migration.js`, `finalize-migration.js`, `migrate-to-sqlite.js`, `run-migration.js`, `run-migration-simple.js`, `run-tb-new-migration.js`, `run-migration-direct.ps1`, `run-migration-psql.ps1`, `setup-migration-helper.sql` | No npm script uses them. The `run-*` helpers read `supabase/migrations/…`, which does not exist (the files are under `_archive/`), target the `tb_new_*` tables removed in T-019, and import `dotenv`, which `package.json` does not declare. The four rewriters were one-shot Supabase-to-SQLite codemods; no Supabase client import remains for them to rewrite. `apply-migration.cjs` held a hard-coded Supabase URL and only printed manual instructions. The only manual-usage text is `docs/RUN_MIGRATION.md`, now marked historical |

## Retained

- `electron/auto-updater-preload.js`: `preload.cjs` mirrors it and the updater guides cite it.
- `sqlite/migrate-from-supabase.ts`, `sqlite/package.json.example`: documented in `sqlite/README.md`; legacy data migration was out of scope.
- `supabase/` (edge functions, config) and `_archive/`: not requested; not run.
- `useTrialBalance`, `trial_balance_lines`, `engagement_trial_balance_*`: kept in the schema and database; since T-021 no screen reads them (`useTrialBalance` has no consumer).
- `useTallyODBC`, `TallyContext`, `@supabase/supabase-js` and every npm dependency.
- Both deferred-tax tools, all visible prototype screens, permissions and route guards; no financial calculation changed.
- No table dropped, no stored data deleted, no migration run.

## Tooling and records repaired

- `scripts/check-project-docs.mjs`: the source scan skips directories that do not exist, so a fresh checkout without `tests/` passes; the screen-map comparison ignores CRLF line endings, which Git on Windows can introduce (found in a fresh clone, where it also failed). `scripts/check-project-docs.test.mjs` no longer requires every source directory to exist and has a regression test for a fixture without `tests/` and with a CRLF screen map.
- `scripts/test-fsg-ui.cjs`: the upgrade seed read `HEAD`'s schema, which no longer declares the legacy tables after T-019, so two checks failed (35/37). The seed now adds empty stand-ins for them; the cleanup under test is unchanged.
- Current records no longer call merged T-019 work uncommitted; `TESTING.md` and `DEVELOPMENT_GUIDE.md` no longer instruct running removed scripts; historical results keep their wording and are labelled.
- Inventory and screen map refreshed with `npm run docs:inventory`. The diff removes only the deleted paths.

## Checks and outcomes

Node.js 24.12.0, npm 11.6.2, Windows, synthetic data. See the table in [CURRENT_STATUS.md](CURRENT_STATUS.md#t-020-result-2-november-2026).

- Passed: `npm run docs:check`; `node --test scripts/check-project-docs.test.mjs` (3/3); `npm run build`; `npm run test:fsg` (41/41); `node scripts/test-fsg-ui.cjs` (37/37); `node --test scripts/test-t003-authorization.cjs` (26/26); `npm run test:native`; `npx vitest run src/lib` (37 tests).
- Failed, existing baseline: `npx tsc -p tsconfig.app.json --noEmit` (76 diagnostics in 18 files, same as the start); `npm run lint` (475 errors, 71 warnings; 492/72 at the start).
- Skipped / not established: packaged launch, installer, live Tally, owner UAT, behaviour beyond the harnesses. `npm ci` was not re-run in this working tree; the fresh-checkout check is in the section below.

## Fresh-checkout verification

Recorded in the final report of this session: a clean clone of the pushed branch (no `tests/` directory), then `npm run docs:check` and the documentation regression test. The first clone of commit 685a4c8 failed on a CRLF screen map; the follow-up commit fixes it and the re-check result is in the final report.

## Unresolved

- Owner assumptions in [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md#assumptions-awaiting-confirmation); T-019 UAT.
- T-021 is implemented but awaits owner acceptance; owner decisions listed in [HANDOVER_CHECKLIST.md](HANDOVER_CHECKLIST.md#owner-decisions-still-needed). T-022 duplicate tools and placeholders remain recorded only.
- Materiality logs "Failed to load materiality risk assessment" when no record exists (unchanged catch block in `src/pages/Materiality.tsx`).
- `tsc` (76) and lint (474 errors) baselines fail as at the start.

## First executable next step

Reviewer: `git fetch`, check out `integration/handover-2026-11-02`, run `npm ci --no-audit --no-fund`, `npm run docs:check`, `npm run build`, `npm run test:fsg`, `npm run test:fsg-ui`. Then in `npm run electron` with a synthetic client: open Financial Statement Review for an engagement, import and map a trial balance, then open Dashboard (readiness classification), Audit Report setup (Step with capital, reserves and borrowings: the cross-check must equal the Balance Sheet face lines) and Admin → Data Integrity; also open a second engagement of another client and confirm it shows no trial balance. Record acceptance in the owner decision log, then merge through GitHub.
