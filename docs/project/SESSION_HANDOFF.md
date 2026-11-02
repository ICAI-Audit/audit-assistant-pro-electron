# Latest session handoff

## Session identity

- Date: 2 November 2026.
- Agent: Copilot SDK in VS Code.
- Requested outcome: scoped cleanup after the Financial Statement Review replacement; repair the documentation checker; correct stale records.
- Task: T-020. Features: none changed. Related: T-019 (merged), T-012, T-021, T-022.
- Branch: `chore/remove-unused-code`. Base and starting commit: `main` = `origin/main` = `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4` (the commit the earlier review examined; unchanged). Resolve the branch head with `git rev-parse HEAD`.
- Not merged and not released. CA Venugopal Gella reviews, tests and merges.
- The previous handoff (T-019) is in git history at the base commit; its work is merged as PR #105.

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
- `useTrialBalance`, `trial_balance_lines`, `engagement_trial_balance_*` and their readers (Dashboard via `useEngagementDashboardData`, Audit Report setup, `DataIntegrityPanel`): out of scope; see T-021.
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
- T-021 reconnection of old trial-balance readers; T-022 duplicate tools and placeholders; T-012 duplicate `/feedback` route.
- Materiality logs "Failed to load materiality risk assessment" when no record exists (unchanged catch block in `src/pages/Materiality.tsx`).

## First executable next step

Reviewer: `git fetch`, check out `chore/remove-unused-code`, run `npm run docs:check`, `npm run build` and `npm run test:fsg-ui`, then confirm the removals in the table above by launching the app (`npm run electron`) and opening Dashboard, Audit Report setup, VERA Tools and Financial Statement Review. Merge only after that review.
