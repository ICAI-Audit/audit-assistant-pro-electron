# RSF pre-commit review ? 13 November 2026

## Owner confirmation superseding the review gate

On 13 November 2026, after discussing the typecheck error list and recommendation to retain unrelated debt, the owner instructed "so proceed". This authorises the reviewed source/docs/master-workbook commit on RSF, including this review and the complete commit message. It does not authorise pushing, releases, client-data uploads, history rewriting, unrelated module fixes or UAT acceptance. Earlier pending-confirmation language below describes the pre-approval review. Fresh fetch and app-health checks were repeated before staging; app returned HTTP 200 with responding Electron processes. Commit identity is the commit containing this entry (git log -1).

## Decision and scope

Task T-029, features F-007/F-009 and the existing T-023 Firm Place dependency. Owner requested review of all pending branch changes, remote currency/conflict checks, a running application, documentation and a complete commit writeup. **No commit, push, merge, rebase, release or branch switch has been performed. Commit requires the owner's subsequent explicit confirmation.** Continue on RSF after that commit.

Branch/base: `RSF`, `26d3b9f37a9f3aadd8b3d5bf456538e195a60a67`. A fresh `git fetch origin` succeeded on 13 November 2026; `HEAD` and `origin/main` both resolve to this commit (ahead/behind 0/0). `git ls-remote --heads origin RSF` returned no remote RSF branch. No unmerged index entries; nothing staged. Remote currency is a point-in-time result and must be refreshed before the eventual commit/push. No pull was necessary and the dirty tree was not stashed, reset or rebased.

Scope is the pending T-023 through T-028 work. No new application implementation was made during T-029. The shared Settings pages, firm-settings hook, core schema and main startup edits are the specifically authorised T-023 Firm Place dependency, not a broader module redesign. Preserve the rest of the existing branch work.

## Complete change summary

### T-023 ? firm signing place

- Add optional Firm Place to VERA Settings and Admin Settings and read/write it through the shared firm-settings hook.
- Add nullable `firm_settings.place` to the fresh schema and run an additive, transactional, retryable upgrade for older databases. Write a SQLite backup before alteration; failure leaves the old schema intact. Restoration/retry and idempotence are tested. No database reset.
- Default financial export Signing Place from that profile, replacing hard-coded Siliguri and the global last-used setting. Allow an export override scoped to the current auditor/client/year. Require manual entry if the firm place is blank. Keep recorded place/date for finalised years.

### T-024 ? known-ALIE Level 1 fallbacks

- Append exactly five terminal LevelFormat rows to Mapping_v2.xlsx: constitution 3 Equity and Liabilities, Income and Expenses; constitution 1 Equity and Liabilities and Expenses. Levels 2?7 remain blank. Canonical captions are Uncategorised Equity and Liabilities, Uncategorised Income and Uncategorised Expenses.
- Original 679 LevelFormat rows and all Map1/Map2/Map3 rows remain unchanged. Workbook ZIP comparison changes only sheet1 XML and workbook range metadata; LevelFormat now has 684 data rows.
- Use the matching constitution/master ID when ALIE is known but no Map1 rule matches; retain auto_low/low confidence without inventing lower hierarchy. Align BS fallback captions.
- Add missing master rows to supported existing rule sets after backup. Recognise the exact old/new workbook hashes for an additive upgrade instead of destructive reseeding. Preserve identifiers, balances, overrides and existing mappings; remapping remains explicit. Arbitrary custom workbook replacements are not covered by this special upgrade.

### T-025 ? investment Fill Details

- Add current/non-current investment forms for populated mapped sub-classifications. Restrict ledger dropdowns to the corresponding subclass with TB/row identity, branch labels and comparative-only entries. Support splitting a ledger between investees and warn on amount mismatch.
- Capture printed investee names, built-in/custom categories, holding/subsidiary/associate/joint venture/controlled special purpose entity/none relationships, quoted/unquoted status, valuation, carrying/market amounts and diminution.
- Capture shares/debentures and other securities quantities, face value, fully/partly paid status, paid-per-unit and uncalled amounts. Record redemption information and flag current/non-current review without automatically moving balances.
- Non-current disclosures include trade/other classification; current disclosures omit that split. Partnership disclosures include all partners, capital/profit shares, company share, firm capital, reporting date, basis and reporting-date adjustments. LLPs remain corporate investments, separate from partnership schedules.
- Persist details in existing note stores with reserved year-scoped keys and explicit TB/consolidated scope. Main-process checks enforce permissions, selected year, actual ledger/subclass membership, numeric validity, comparative-client/year boundaries and locked/final-year restrictions. Protect reserved investment keys against generic note-save bypasses.
- Share disclosure tables and review warnings across Notes, financial PDF and Excel. Extend Fill Details workbook export/import with investment rows, partner IDs and custom categories; import routes through the validated handler. Import is not all-or-nothing across sheets: failures explicitly warn that preceding sheets may have saved.
- Preserve source amounts and measurement rules; do not deduct diminution twice or plug reconciliation differences. Statutory source/professional-review boundaries remain in T025_INVESTMENT_DISCLOSURES.md.

### T-026 ? missing-ALIE diagnostics, with final rollback retained

- Query source rows, including ledgers with no mapping record, using financial-query ALIE precedence. Warn for missing/invalid ALIE only when the relevant CY closing or PY comparative/opening amount is nonzero; fully nil rows remain available in Mapping without statement warnings.
- Display bold red notices at the beginning/end of BS and P&L, with item counts and gross debit/credit/net rupee amounts, and a visible ledger list and correction routes. Include diagnostics in Annexures and normal/columnar PDF/Excel. A diagnostic failure remains explicit; generation stays available.
- Exclude separately entered `Stock Entry PY` disclosure rows by provenance, without filtering genuine imported stock ledgers by name or changing stock values/calculations.
- Scope branch export retrieval to the selected consolidation TB IDs, preventing accidental inclusion of other years while collecting diagnostics.
- **Final owner decision: provisional ALIE MISSING liability allocation was rolled back.** No diagnostic balancing row enters BS/P&L totals. Unresolved amounts remain excluded pending classification and the warning says statements can be incomplete or unbalanced. Do not describe the earlier provisional-liability implementation as the final result.
- Replace earlier screenshot-derived fixture amounts with invented synthetic numbers; do not commit client TB data.

### T-027 ? reporting-date headings

- Share reporting-date parsing/formatting for explicit ISO/day-first periods and April?March FY labels. Honour selected comparative/custom dates, otherwise derive the preceding year end, including leap-day handling. Missing/invalid dates retain generic column labels.
- BS face/supporting notes use As at; P&L face/supporting notes use For the year ended. Extend dates to ledger Annexures and relevant investment, ageing, cash/bank, reconciliation, ratios and comparative schedule headings on screen and normal PDF/Excel.
- Repeat per-note headings in shared Excel sheets while keeping formula columns, note links and dynamic row references intact. Preserve movement Opening/Closing meanings, ledger names, narratives and workbook import field keys. Branch-name columnar axes remain branch names.
- Wrap long date headings using FSG-local styles and fixed annexure table layout; do not alter the global table style or other modules.

### T-028 ? remove Cloudtail MCA publishing

- Remove the pictured Cloudtail banner, publication status, Publish button, history refresh and publication state.
- Remove automatic publication on final exports, renderer snapshot methods, backend handler registration and authorization entries. Delete the retired snapshot handler and serializer and replace obsolete tests with absence/storage-retention checks.
- Retain historical fs_snapshots storage/records without migration or deletion. Normal finalisation, signing and financial PDF/Excel continue to work. Restart loads the retired-handler change.

### Tests and documentation

- Extend synthetic integration and real Electron UI suites for migration recovery, mapping additions, three constitutions, investments, direct permission/lock/forged-ID checks, missing-ALIE diagnostics, stock exclusion, date labels, reopened Excel, actual PDF, Cloudtail absence and restart persistence.
- Update feature/status/task/handoff, data model, field catalogue, FSG module record, open gaps and generated source inventory. Add bounded T-023/T-024/T-025/T-026 contracts. Preserve historical guidance with newer authoritative entries.

## Findings and limits requiring an informed decision

1. **Existing T-026 functional gap:** financial queries still exclude `unmapped`, `conflict` and `discrepancy` statuses even when ALIE is known. T-024 terminal auto_low fallbacks do not fix every excluded-status case. Missing-ALIE warnings do not list known-ALIE exclusions. This contradicts the broader desired include-then-rectify workflow; remains open, not silently fixed in a review task. See financials.js accepted-status filters and the T-026 diagnosis in SESSION_HANDOFF.md.
2. **Existing GAP-18:** constitutions 1/2 with no classified capital/equity transfer target can retain a BS difference equal to untransferred profit/loss despite a balanced source TB. The existing PL transferred/closed control does not supply an absent target. No universal balancing guarantee, and no artificial balancing plug added.
3. **Existing repository privacy concern:** tracked paths already include `ref/Trial_Balance_2024-04-01_to_2025-03-31.xlsx`, `ref/GrpSum.xlsx`, `ref/~$GrpSum.xlsx`, `_archive/backups/tally_tb_database.db` and `.env`. These predate this change set; contents were not opened. Names alone do not establish whether they are anonymised, but they require owner disposition before any push. Removing files in a later commit does not erase historical copies. No history rewrite or deletion is authorised by this review. Do not use git add . or upload these artifacts. The current pending binary is only the master Mapping_v2.xlsx, whose original data was preserved and five additions checked.
4. **Existing typecheck debt:** explicit app typecheck fails with 76 diagnostics. An in-memory compiler-host comparison substituting HEAD versions of all three changed TypeScript files produces the same 76 diagnostics, with zero new diagnostic signatures. This establishes no newly introduced TS diagnostics, not a passing application typecheck.
5. Owner UAT, Schedule III professional approval, real-client/installed-profile migration, live Tally ODBC, packaged installer/release and arbitrary pagination remain unverified. Review is focused static inspection plus synthetic regression evidence, not complete financial or security certification. Existing unrelated backlog remains open.

## Fresh validation, 13 November 2026

| Check | Result |
| --- | --- |
| git fetch origin; compare HEAD/origin/main | Passed; same 26d3b9f commit, 0/0 divergence |
| Remote RSF lookup; unmerged/staged paths | No remote RSF; no unmerged entries; nothing staged |
| Workbook ZIP/original-row comparison | Passed; exactly five appended data rows, original rows intact |
| Pending-file artifact/credential-pattern check | Only Mapping_v2.xlsx is a pending data-like binary; no matched private-key/token patterns; not a comprehensive secret audit |
| npm.cmd run test:fsg | Passed 210/210; actual dated PDF and reopened Excel |
| npm.cmd run test:fsg-ui | Passed 81/81 including production build, finalisation, restart and surrounding screen smoke checks |
| npx.cmd tsc -p tsconfig.app.json --noEmit | Failed: existing 76 diagnostics; baseline comparison found zero new signatures |
| npm.cmd run docs:inventory / docs:check; git diff --check | Passed; refreshed inventory diff reviewed; existing LF/CRLF notices only |

Integration PDF fixture: `C:/Users/AMITESH/AppData/Local/Temp/vera-fsg-test-S4MWzB-dated-notes.pdf`. Desktop synthetic profile/screenshots: `C:/Users/AMITESH/AppData/Local/Temp/icai-vera-fsg-ui-5ZCqP3`. Existing PDF font warnings, bundle-size/mixed-import warnings and materiality risk-assessment renderer log were non-failing. Tests used temporary synthetic profiles; their fixtures/downloads are outside the repository.

## Running app and confirmation gate

VERA was launched with ELECTRON_RUN_AS_NODE cleared and `npm.cmd run electron:dev`; development server is http://localhost:8080. A final check detected that the foreground development session had exited; it was restarted using a hidden persistent cmd wrapper (PID 17364). Final check returned HTTP 200 and four responding Electron processes. Logs are outside the repository in OS TEMP `vera-rsf-review-dev-20261113.{out,err}.log`. There was a detected interruption; continuous uptime is not claimed. Main process reported Electron ready, loaded native SQLite/bcrypt and initialized its schema without errors. HTTP health returned 200. The separate synthetic desktop test starts/restarts/closes only its own isolated profile. Leave the development session running for owner review; do not stop all Electron/Node processes. Runtime availability is monitored during this session, not a guarantee after the host/session is closed.

The startup log selected a Cache-derived development database path. This review did not query its client records or change the storage-path logic; owner should verify the intended existing profile in the UI before entering real data. No credentials were read or invented for the owner's running app. Automated test credentials are synthetic and confined to temporary profiles.

The full proposed commit message is [RSF_COMMIT_MESSAGE.txt](RSF_COMMIT_MESSAGE.txt). After explicit owner confirmation: re-fetch, inspect any newly changed remote overlap, recheck data/secret exclusions and the exact changed-path list, stage the reviewed source/docs/master workbook explicitly, inspect the staged diff, and commit on RSF using that message. Do not push without separate authorisation. Then continue work on RSF with the app running and record the new commit ID in the handoff.

## Changed-path manifest before review documentation

The following 59 pending paths were captured before adding this review and its commit-message draft. All remain unstaged; the two retired Cloudtail sources are deletions. Existing documentation changes are retained, including generated SCREEN_MAP metadata.

- `docs/project/CURRENT_STATUS.md` (M)
- `docs/project/DATA_MODEL.md` (M)
- `docs/project/FEATURE_REGISTER.md` (M)
- `docs/project/FINANCIAL_STATEMENT_REVIEW.md` (M)
- `docs/project/NEXT_TASKS.md` (M)
- `docs/project/OPEN_GAPS.md` (M)
- `docs/project/SCHEMA_FIELD_CATALOG.md` (M)
- `docs/project/SCREEN_MAP.md` (M)
- `docs/project/SESSION_HANDOFF.md` (M)
- `docs/project/inventory.json` (M)
- `electron/fsg/assets/Mapping_v2.xlsx` (M)
- `electron/fsg/authorization.js` (M)
- `electron/fsg/db/noteStore.js` (M)
- `electron/fsg/index.js` (M)
- `electron/fsg/ipc/financials.js` (M)
- `electron/fsg/ipc/fs-snapshot.js` (D)
- `electron/fsg/services/excel.js` (M)
- `electron/fsg/services/mapping-engine.js` (M)
- `electron/main.cjs` (M)
- `scripts/test-fsg-integration.mjs` (M)
- `scripts/test-fsg-ui.cjs` (M)
- `sqlite/schema/01_core_tables.sql` (M)
- `src/hooks/useFirmSettings.ts` (M)
- `src/modules/fsg/api.js` (M)
- `src/modules/fsg/components/Annexures/index.jsx` (M)
- `src/modules/fsg/components/BS/index.jsx` (M)
- `src/modules/fsg/components/GenerateFinancials/buildExcel.js` (M)
- `src/modules/fsg/components/GenerateFinancials/buildHTML.js` (M)
- `src/modules/fsg/components/GenerateFinancials/fillDetailsWorkbook.js` (M)
- `src/modules/fsg/components/GenerateFinancials/index.jsx` (M)
- `src/modules/fsg/components/Notes/index.jsx` (M)
- `src/modules/fsg/components/PL/index.jsx` (M)
- `src/modules/fsg/fsg.css` (M)
- `src/modules/fsg/hooks/useFinancials.js` (M)
- `src/modules/fsg/utils/bsStructure.js` (M)
- `src/modules/fsg/utils/fillDetailsRegistry.js` (M)
- `src/modules/fsg/utils/fsSnapshot.js` (D)
- `src/pages/AdminSettings.tsx` (M)
- `src/pages/Settings.tsx` (M)
- `docs/project/T023_FIRM_SIGNING_PLACE.md` (??)
- `docs/project/T024_LEVEL1_FALLBACKS.md` (??)
- `docs/project/T025_INVESTMENT_DISCLOSURES.md` (??)
- `docs/project/T026_MISSING_ALIE_WARNINGS.md` (??)
- `electron/firm-place-migration.cjs` (??)
- `electron/fsg/db/level1-fallbacks.js` (??)
- `electron/fsg/ipc/investments.js` (??)
- `electron/fsg/services/missing-alie.js` (??)
- `scripts/fsg-fallback-checks.mjs` (??)
- `scripts/fsg-investment-checks.mjs` (??)
- `scripts/fsg-missing-alie-checks.mjs` (??)
- `src/modules/fsg/components/Notes/InvestmentsForm.jsx` (??)
- `src/modules/fsg/components/shared/MissingAlieWarning.jsx` (??)
- `src/modules/fsg/utils/investmentStore.js` (??)
- `src/modules/fsg/utils/investmentWorkbook.js` (??)
- `src/modules/fsg/utils/investments.js` (??)
- `src/modules/fsg/utils/missingAlie.js` (??)
- `src/modules/fsg/utils/missingAlieExport.js` (??)
- `src/modules/fsg/utils/missingAlieStore.js` (??)
- `src/modules/fsg/utils/statementDates.js` (??)
