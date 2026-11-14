# Current status

## T-033 Ledger Analysis on branch ledger-analysis (14 November 2026)

- Selected task: T-033; new feature F-031 (Ledger Analysis); F-008 VERA Tools path replaced; F-029 overlaps in part.
- Branch `ledger-analysis` from `main` at `b835def`, built step by step from an owner-tested local copy. Ledger Analysis is the first and default VERA Tools tab; the Tally Tools tab, its component and the hooks `useTallyODBC` / `useOpeningBalanceMatching` were removed (Opening Balance Matching dropped with the owner's agreement).
- Live check on the owner's TallyPrime test company: day book vs TB agreed for all 767 ledgers checked after two fetch fixes (collection instead of the one-day Day Book report; non-accounting voucher types left out). No database or schema change; results are not persisted.
- New finding T-034: the T-003 authorization test is timing-dependent on unchanged `main` (3 of 4 runs failed); not fixed.
- Validation and remaining limits: [latest handoff](SESSION_HANDOFF.md#t-033-ledger-analysis-on-branch-ledger-analysis-14-november-2026).

## T-032 sync latest main and refresh startup label (14 November 2026)

- Selected task: T-032; affected feature F-001 (startup build label), plus merged features F-030 (PDF Tools) and F-023 (GSTIN lookup/bulk).
- Fast-forwarded local `main` from `8ee2107` to fetched `origin/main` at `6e5da5e` (8 commits, including PR #111 PDF Tools and PR #112 GSTIN lookup/bulk). No merge conflicts.
- Preserved the pre-existing `package-lock.json` edit and both untracked documentation packs. Restored the lockfile edit after fast-forward; its root dependency map matches `package.json`.
- Startup label now identifies `origin/main` synced 14 November 2026 and names PDF Tools (PR #111) and GSTIN lookup/bulk (PR #112). It remains static build metadata, not live remote status.
- Validation and remaining limits are recorded in the [latest handoff](SESSION_HANDOFF.md#t-032-sync-latest-main-and-refresh-startup-label-14-november-2026).

## T-024 GSTIN integration with current main (14 November 2026)

- Selected task: T-024 GSTIN lookup, feature F-023. Merged current `origin/main` at `fb607b5` into `feat/gstin-lookup-bulk` at `6fab70a`; common ancestor `26d3b9f`.
- Resolved the four documentation/inventory conflicts by preserving both GSTIN and upstream records and combining the source inventory entries. The merged `AuditTools.tsx` retains GSTIN lookup/consent while mounting the new PDF Tools component; `electron/main.cjs` retains GSTIN IPC and includes upstream migration, CAAT schema, and restricted-folder handling changes.
- Task-number ambiguity remains: independent GSTIN and main-branch FSG/CAAT records use T-023/T-024. IDs were not renumbered as part of this merge.
- Passed after integration on Linux with Node.js 22.23.4/npm 10.9.9: GSTIN tests 8/8; GSTIN/build-label Vitest 14/14; build; PDF Tools unit tests 884/884 when excluding the Windows-path-specific test file; docs inventory/check; documentation regressions 3/3; Electron syntax checks. The PDF UI application test could not start because the Electron sandbox helper permissions are unavailable in this environment. Full PDF unit tests had three Windows-path-specific failures; two export option assertions likewise expect Windows separators. Exact commands/results and other limits are in the [latest handoff](SESSION_HANDOFF.md).

## T-024 consented GSTIN lookup and bulk validation (11 November 2026)

- Publication preparation on 13 November: the consent explanation now says `Only GSTINs that pass local structure and checksum checks are sent to API.` The fixed endpoint and actual data boundary remain unchanged. The team test plan is [GSTIN_TEAM_TEST_GUIDE.md](GSTIN_TEAM_TEST_GUIDE.md). At that time, fetched `origin/main` was at `8ee2107`, eight commits ahead of this branch base, with overlapping changes and a separate T-024; those commits had not yet been integrated.
- Investigation on 13 November: single and bulk lookups call the same IPC handler and provider; single reports the pictured error when the parsed response is invalid. The user reports that the same GSTIN was marked "Lookup confirmed" with a taxpayer name in bulk; the underlying response and reason for the difference remain unverified. A synthetic parser check found that a response without either recognized validity flag is currently treated as valid, so a bulk "Lookup confirmed" label alone is not reliable proof of provider confirmation. Do not query client GSTINs without appropriate authorization; provider response contract and this parser gap require follow-up.
- Working branch: `feat/gstin-lookup-bulk`, based on `origin/main` at `26d3b9f` (PR #108 already merged). See the [latest handoff](SESSION_HANDOFF.md) for publication and remaining worktree state.
- GST Number Master now has a consent-gated single lookup, CSV template download, local CSV/XLS/XLSX parsing, invalid-row reporting, sequential lookup of only locally valid unique GSTINs, progress/stop control, provider-confirmed GSTIN CSV download, and local bulk save. GSTZen `createGstin` is no longer a prerequisite for this master; GSTZen GSTR-1/session integration remains separate.
- UI polish: removed the GSTIN lookup callout and the “Detected from GSTIN character 14” placeholder; the derived type field stays blank until available, and single lookup shows explicit fetching/completion status. A provider `valid:false` response says local format/checksum passed but the provider did not confirm the registration; manual name entry/local save remain available.
- Downloads: CSV template and provider-confirmed bulk rows use the CSV save filter/extension; existing DOCX exports keep their default. The single GSTIN shown in the user's screenshot was locally valid but the provider returned `valid:false` and no name.
- Outbound data boundary: only a normalized GSTIN query is sent to the fixed `api.e-waybill.in` endpoint after the exact consent checkbox is accepted. Spreadsheet data stays local; main IPC requires the current authenticated renderer and explicit consent, and revalidates the GSTIN.
- Provider limitation: one synthetic structurally valid but unregistered GSTIN returned `valid:false`, blank name, and no taxpayer-type field. A successful registered response, provider terms and rate limits are unverified. Type is now derived locally from character 14, not from API response data.
- Structure: standard PAN-based registrations require numeric character 13 and a checksum at character 15; chart-specific F/I/N/R/M layouts validate their character-13 and fixed character-15 values. Character 14 uses the chart's allowed code set; S/C/D/F/I/R/M map to their supplied categories, other allowed codes default to Regular Dealer, and unsupported codes are rejected with a character-14 message.
- Passed: `node --test scripts/test-gstin-lookup.cjs` (8/8); `node --test scripts/test-export-file-options.cjs` (3/3); `vitest run src/lib/gstinValidation.test.ts src/lib/gstinSpreadsheet.test.ts` (9/9); `npm run build` (4,084 modules; existing import/chunk warnings); focused page lint with the unrelated baseline `prefer-const` rule suppressed; `npm run docs:inventory` (31 routes, 10 schema files, 11 test files); `npm run docs:check`; CRLF-aware `git diff --check`.
- Failed as pre-existing: `npx tsc -p tsconfig.app.json --noEmit` reports 49 diagnostics in 14 untouched files. This is down from the earlier 76/18 baseline after removing conflicting duplicate Electron API declarations; no T-024 source file has a diagnostic. Full ESLint on `AuditTools.tsx` still reports one unrelated `prefer-const` issue at line 3698; focused lint with that rule suppressed passes.
- Runtime startup: after the latest export-handler changes, fresh `npm run electron:dev` opened the updated `ICAI VERA` window; Vite is serving `http://localhost:8080`. Electron initialized 112 schema tables with zero SQL errors. The user's screenshot shows single lookup reached the provider but received `valid:false`; the UI now explains this is separate from local format/checksum validation.
- Not established: successful provider lookup for a registered test GSTIN, full UI flow, client persistence UAT or owner acceptance. The app uses standard userData rather than an isolated synthetic profile; the assistant did not repeat the screenshot's GSTIN query and did not inspect or save GST records. Do not query real client GSTINs for testing.
## T-031 PDF Tools phase 1 (14 November 2026)

- Request: the lead's instructions of 13 November 2026 after the VERA Tools meeting of 2 November (action point 6). Feature F-030, task T-031. Design, known limits and application problems found on the way: [PDF_TOOLS.md](PDF_TOOLS.md).
- Branch `feat/pdf-tools`, started from `main` at `26d3b9f37a9f3aadd8b3d5bf456538e195a60a67` and moved (fast-forward) to `main` at `8ee2107`. The work was committed on branch `feat/pdf-tools` (base `main` at `8ee2107`) as three commits, `feat(T-031): add PDF Tools organise, numbering and image conversion`, `test(T-031): add PDF Tools application test` and `docs(T-031): record PDF Tools phase 1 design, status and inventory`, and pushed to `origin` (see `git log origin/feat/pdf-tools`); it was later merged to `main` in PR #111 at `6e5da5e`. The owner gave the go-ahead to commit and push on 14 November 2026 after the folder-save defect was fixed and re-verified. The owner's own re-test of the fixed folder save and the rest of the hand-check list (single-file Save As including cancel, drag and drop, another PDF reader, real scans and Office exports, the destinations) have not been reported back and are still to be confirmed. Not owner-accepted; no UAT.
- Built: the PDF Tools tab of VERA Tools replaced by a new screen: file list with thumbnails and a page panel; Merge, Split, Delete pages, Compress at three levels, Page numbers, Images to PDF, PDF to images; opening password-protected files; Save to computer, Add to Evidence Vault, Attach to working paper, Add from Evidence Vault; an activity-log entry for each send. Nine not-yet-built tools stay visible as "Soon" (T-022). Phases 2 and 3 not started.
- New dependencies: `pdfjs-dist` 5.4.296 (rendering) and `@cantoo/pdf-lib` 2.11.1 (unlocking only), added by hand to `package.json` and `package-lock.json` (lock diff +52 lines, no deletions); `pdf-lib` 1.17.1 unchanged. `package.json` also gains the script `test:pdf-tools-ui`. `public/pdf-tools/pdfjs/` holds copied worker files (195 files).
- Changed paths: modified `package.json` (+3), `package-lock.json` (+52), `src/pages/AuditTools.tsx` (+2/-712), `electron/main.cjs` (one block of about 20 lines, owner decision of 14 November 2026); new `src/lib/pdf-tools/`, `src/components/pdf-tools/`, `public/pdf-tools/pdfjs/`, `scripts/sync-pdfjs-assets.mjs`, `scripts/test-pdf-tools-ui.cjs`, `scripts/pdf-tools-electron-entry.cjs`, `docs/project/PDF_TOOLS.md`, and the records updated by this change.
- Environment: Windows; Node 24.15.0 and npm 11.12.1 on the build machine, not the pinned 24.12.0 / 11.6.2. Installs used `npx -y npm@11.6.2`; the checks above ran on a clean copy installed that way, so they were not run on the pinned Node 24.12.0.

| Check | Result |
| --- | --- |
| `npx -y npm@11.6.2 ci --dry-run` | Passed: lockfile in sync. A full clean `npx -y npm@11.6.2 ci` also succeeded in a scratch copy. |
| `npx vitest run src/lib/pdf-tools src/components/pdf-tools` | Passed: 43 files, 892 tests. |
| `npx vitest run src/lib`, first run | **Failed**: 3 files failed, 2 tests and one set-up hook timed out (an unlock test, a 300-page timing test, a compress set-up). Each reported about 1,640 s for work that takes seconds, and another process on the machine stalled for 600 s in the same window. Assessed as a machine-wide pause (sleep or freeze) of about 27 minutes, not a code failure; this is an assessment, not proven. |
| `npx vitest run src/lib`, two runs straight after | Passed both times: 24 files, 527 tests (21 s and 27 s). |
| `npx vitest run src/components/pdf-tools` | Passed: 29 files, 410 tests. |
| `npx tsc -p tsconfig.app.json --noEmit` | 76 diagnostics, the existing baseline; none in the new folders. |
| ESLint on `src/lib/pdf-tools`, `src/components/pdf-tools` and the three new scripts | Clean (exit 0). |
| `node --test scripts/test-t003-authorization.cjs` | Passed: 26/26. |
| `npm run test:native` (after unsetting `ELECTRON_RUN_AS_NODE`) | Passed (Electron 40.9.1). |
| `npm run test:pdf-tools-ui` (production build, isolated profile, synthetic data) | Passed: 32/32 (64 s). |
| Windows package (`npm run electron:build:win`), scratch copy only | Built (exit 0); not installed, not published. |
| `PDF_TOOLS_TEST_APP=<unpacked exe> node scripts/test-pdf-tools-ui.cjs` | Passed: 31 checks, 1 skipped (the download fallback, which needs the test's entry script). |

- Reviews: per-task reviews, a whole-branch review and three re-reviews; the last was approved for commit.
- Finding, 14 November 2026: during the owner's own hand check, saving three files to a folder failed with "A save window is already open". With the real Electron 40.9.1 folder window the cause was reproduced: when the chosen folder is one that Chromium treats as restricted (Desktop, Documents or Downloads themselves, the profile root, AppData, Windows, Program Files), Electron raises the session event `file-system-access-restricted`. `electron/main.cjs` had no listener, so the pick never answered, the folder window stayed active internally and every later save failed until the application was restarted. A folder inside Desktop worked. Fix, by the owner's decision of the same day (asked explicitly; the owner chose to edit `electron/main.cjs`): one block (the one beginning `const fileAccessSession`, about 20 lines) accepts the user's own Desktop, Documents and Downloads folders and anything inside them, and refuses any other restricted folder, so the pick ends as "no folder" and the screen shows the quiet note "Nothing was saved - No folder was chosen. Windows and program folders cannot be used for saving; choose another folder, such as Desktop or Documents." (`FOLDER_NOT_CHOSEN` in `src/components/pdf-tools/savePlan.ts`). Verified with the real folder window by running the exact listener code in a throw-away Electron window: Desktop itself returned a folder, write permission was granted and a file was written; an AppData folder ended the pick at once with a cancel-type error and no hang. Not yet verified: the same through the full application screen (owner hand check), and the single-file Save As window into those folders (expected to be unaffected, because only the folder itself is restricted, not files inside). The automated tests did not catch this because they replace the native windows with stand-ins; it was found by hand after automated verification had passed.
- After the `electron/main.cjs` change: re-run on the clean copy the same day: `npx vitest run src/lib` 24 files / 527 passed; `src/components/pdf-tools` 29 files / 410 passed (PDF Tools 892 in all); TypeScript 76 diagnostics, none in the new folders; ESLint clean; `node --test scripts/test-t003-authorization.cjs` 26/26; `npm run test:native` passed; `npm run test:pdf-tools-ui` 32/32. The Windows package was not rebuilt after this change, so the packaged-build run (31/31, 1 skipped) predates it.
- Split and Delete pages give each kept page only the resources it uses; when a page cannot be read with certainty its resources are kept whole and the result is marked "May hold left-out pages' images" (`sharedResourcesKept`). This is not redaction (Redact is phase 2). Every result of a signed source is marked "Signature no longer valid". Compared in generated files and in pdf.js only.
- Measured during the build (single runs on the build machine, not repeated): a 20-page 300 dpi colour scan came out 70% or more smaller at Recommended; 100 pages of 143 MB came down to 30.4 MB in about 41 s; opening an 83 MB AES-256 scan took about 18.5 s on the main thread.
- Not verified: the native save and folder dialogs through the application screen (including cancel and the "name (2).pdf" numbering; choosing Desktop, Documents and Downloads themselves was verified only with the real folder window in a probe), and the single-file Save As window into those folders; drag and drop; a screen-reader pass; results in Acrobat or another reader (compared in pdf.js only); real Word, Excel and scanner files; the largest sizes (a 300 MB list, 500 pages, 200 images); the installed package; owner UAT. Known limits: [PDF_TOOLS.md section 11](PDF_TOOLS.md#11-known-limits-phase-1).
- Open owner decisions: the application problems in [PDF_TOOLS.md section 12](PDF_TOOLS.md#12-outside-this-feature-for-the-owner) (none changed by this work); instant clearing on engagement change (the owner chose on 13 November 2026 not to edit `src/contexts/EngagementContext.tsx`).

## T-030 main pull status on login (13 November 2026)

- `main` was fast-forwarded from `26d3b9f` to the fetched `origin/main` at `99324ea` (6 commits; PR #109 CAAT Tools and PR #110 FSG/RSF updates). The existing `package-lock.json` modification and untracked documentation packs were preserved.
- The shared login/header label identifies the snapshot as `origin/main` synced 13 November 2026 and names PRs #109/#110. Its tooltip reports the build-time branch, commit and tracked-local-change flag. This is static build information, not a live GitHub check and not evidence that other installed builds have updated.
- The scoped change was committed as `bf0b5bf` and pushed to `origin/main`. GitHub accepted the direct push while reporting that the pull-request-only rule was bypassed.
- Selected task: T-030; affected feature: F-001 (shared login/header build label). See [handoff](SESSION_HANDOFF.md#t-030-main-pull-status-on-login-13-november-2026) for validation and limits.

## RSF published to GitHub (13 November 2026)

Owner explicitly authorised push. Implementation commit b842642 is published on origin/RSF, and local RSF tracks it. Only the reviewed source/docs/mapping-master changes are new; older tracked data artifacts are unchanged from already-published main. No new client TB/database files, merge, release or unrelated fixes. App health HTTP 200 confirmed. Publication details and remaining issues are in the latest handoff.

## T-029 owner-confirmed RSF commit (13 November 2026)

Owner said "so proceed" after the review and explanation of the 76 existing typecheck diagnostics, authorising the scoped T-023 through T-028 commit. This record is included in that commit on RSF; obtain its ID with git log -1. Fresh fetch still has origin/main at base/source 26d3b9f; no merge needed. Preserve documented financial gaps and existing typecheck debt. No unrelated error fixes, push, release or branch switch authorised. Integration 210/210, desktop 81/81 and documentation/diff checks passed in the reviewed tree; app HTTP 200 and responding Electron processes rechecked. Explicit reviewed source/docs/master-workbook staging excludes client uploads and database files. See RSF_PRE_COMMIT_REVIEW.md and RSF_COMMIT_MESSAGE.txt for full scope and limitations. Continue on RSF after commit.

## T-029 pre-commit review (13 November 2026)

Owner requested all pending RSF changes be reviewed before an explicitly confirmed commit. Fresh fetch confirms HEAD equals origin/main at 26d3b9f (0/0); no remote RSF or merge conflicts. Integration 210/210 and desktop 81/81 passed again. Explicit typecheck remains failing with 76 diagnostics; compiler-host comparison with HEAD versions of the three changed TS files found zero new signatures. VERA development app remains running. Complete scope, changed-path manifest, existing functional gaps and older tracked data-artifact privacy concern: [RSF review](RSF_PRE_COMMIT_REVIEW.md); [proposed full commit message](RSF_COMMIT_MESSAGE.txt). Nothing staged/committed/pushed; owner confirmation pending. No new application implementation in this review.

## T-027 supporting dates and T-028 Cloudtail removal (13 November 2026)

Extended dated headings from BS/P&L faces to their Notes, ledger Annexures, applicable supporting disclosure/ageing/working tables and normal PDF/Excel. BS notes use As at; P&L notes use For the year ended, using the same current/comparative period dates. Per-note Excel headers preserve column positions/formula links; movement Opening/Closing headings remain. Investment disclosure headers are dated without changing saved field keys or import-workbook contracts. T-028 removes the Cloudtail banner/button, manual and automatic final-export publication, renderer snapshot methods, IPC handlers/policies and snapshot serializer. Historical fs_snapshots storage is retained without migration/deletion. Finalisation/signing and normal financial exports remain. Integration 210/210 passed, including actual paginated dated-notes PDF and reopened Excel across multiple years. Desktop 81/81 passed, including production build, wrapped dated headings, Cloudtail absence, exports, finalisation and restart regressions; owner UAT pending. No client data or trial balances staged, committed or pushed.

## T-026 owner rollback: provisional liability removed (12 November 2026)

The owner explicitly selected rollback of the provisional liability only. Missing-ALIE reports now remain diagnostics: unresolved amounts are excluded pending classification and no synthetic ALIE MISSING section/rows enter BS, P&L, normal/columnar exports or new snapshots. The red beginning/end warnings, directly visible ledger review list, correction actions, non-blocking generation, nil filtering and Stock Entry PY exclusion remain. Warning wording states that statements may be incomplete or unbalanced. This supersedes all earlier descriptions of provisional liability inclusion below. No source data or stock calculations changed. Tests use invented data, not client trial balance figures; no client data staged/committed/pushed. Integration 201/201 and desktop 77/77 passed, including production build and restart; docs/inventory/diff checks passed. Final warning visually inspected. Validation details and corrected test-reader assertions recorded in the latest handoff; owner UAT pending.

## T-026 stock-input false-positive fix (12 November 2026)

The owner screenshot identified PY Opening Stock / PY Closing Stock as false missing-ALIE exceptions. Source tracing confirms `tb:saveStock` deliberately saves these as `upload_nature = Stock Entry PY` without mapping records, for Stock-form comparative disclosure only. The shared missing-ALIE query now excludes this provenance before counts, messages, provisional liability totals and export/snapshot evidence are built. Genuine imported stock ledgers remain checked even with identical names; actual CY stock mappings and financial stock calculations are unchanged. Stock values are preserved. Integration 201/201 passed with actual saved Stock-form inputs, selected consolidated/branch data, real ledger negative control and all prior export/source-preservation regressions. Desktop 77/77 passed including build and restart; stock exclusion and unchanged real exception net visually checked. Docs/inventory/diff checks passed; owner UAT pending. Restart VERA to load the changed main-process service.

## T-026 warning wording correction (12 November 2026)

Owner approved simplifying the confusing missing-ALIE notice. It now says ALIE classification is missing for a number of ledgers, reports the period closing/opening balance and Dr/Cr/Nil, explains negative/positive/net-zero provisional presentation under ALIE MISSING on the BS liability side, and asks for correct ALIE. Gross debit/credit amounts remain. Removed the P&L-only implication. The screen shows ledger names and debit/credit balances directly below the notice without expanding a disclosure. For rows not yet mapped, a plain next step explains Auto-Mapping followed by ALIE review; the existing correction action remains. Shared PDF/Excel messages and ledger-list captions follow the new wording. No mapping, source amounts, financial math or generation permissions changed. Integration 197/197 and desktop 76/76 passed; production build/docs/diff checks passed. Screen/PDF wording and layout visually inspected. Evidence and earlier assertion/markup corrections are in the latest handoff; owner UAT pending.

## T-027 dated BS and P&L columns (12 November 2026)

Implemented the owner-requested date headings within Financial Statement Review (F-009): BS columns use **As at 31 March 2026** / **As at 31 March 2025** for FY 2025-26; P&L uses **For the year ended** with the same dates. A shared formatter derives dates from the active reporting period and selected comparative, or the preceding year when comparatives use opening/manual figures. Explicit custom year ends are retained; invalid/absent dates retain generic headings. Screen, normal PDF and Excel BS/P&L titles/columns are aligned for companies, partnerships and LLPs. Branch-wise columnar exports retain branch-name columns (they have no CY/PY columns). Source amounts and financial calculations are unchanged. Integration 190/190 passed, including FY 2022-23/2024-25/2025-26/2026-27, custom year end, selected comparative, invalid dates and leap-day fallback. Desktop 75/75 passed including production build and both date-heading assertions. Screen/PDF layouts visually checked; documentation/inventory/diff checks passed. Owner UAT pending.

## T-026 follow-up: ALIE MISSING provisional BS head (12 November 2026)

Owner-authorised default liability-side **ALIE MISSING** presentation now includes actual signed missing-ALIE balances in BS totals, alongside red bold warnings. Nil amounts are excluded independently per period; opening/selected comparative balances remain relevant only to PY. Source classifications/statuses and P&L calculations remain unchanged. Company, partnership, LLP and columnar exports use the provisional head; correction removes it on reload. Integration passed 171/171; desktop checks passed 73/73 including production build. Documentation and diff checks passed. [Current contract](T026_MISSING_ALIE_WARNINGS.md#owner-follow-up-provisional-liability-side-presentation-12-november-2026) supersedes the earlier warning-only description below. Known-ALIE unresolved statuses and GAP-18 remain open; owner UAT pending.

## T-026 missing-ALIE warning part (12 November 2026)

Owner-authorised non-blocking missing-ALIE warnings are implemented in Financial Statement Review only. Source-ledger detection includes absent mapping records and null/blank/invalid ALIE; red bold beginning/end BS/P&L messages show count, closing debit/credit and net in rupees, with separately labelled comparative data. Rectification links, ledger-wise Annexures/PDF/Excel exceptions, columnar warnings and snapshot evidence are included. Existing financial statement calculations and unresolved-status filters are unchanged. [Contract and boundaries](T026_MISSING_ALIE_WARNINGS.md).

Integration `npm.cmd run test:fsg` passed 147/147, including actual PDF, reopened company/partnership/LLP and columnar Excel, permissions, PY scope, source preservation and correction. `npm.cmd run test:fsg-ui` passed 71/71 with production build; actual PDF and final screen warnings visually inspected. Documentation checks passed. The latest handoff records exact evidence and the resolved test-navigation failure. Known-ALIE conflict/discrepancy inclusion and GAP-18 remain outstanding T-026 work; owner UAT is pending. Existing uncommitted prior tasks remain preserved.

## T-026 unresolved ledger diagnosis (11 November 2026)

Owner clarified that unresolved mapping must not remove ledger values from the statements. Source inspection confirms all three `electron/fsg/ipc/financials.js` query paths exclude `unmapped`, `conflict` and `discrepancy` statuses and require resolved ALIE, before fallback presentation runs. The T-024 known-ALIE fallback is `auto_low` and included, but it did not address these excluded statuses. This is an implementation gap against the clarified intent; earlier passing tests do not verify it. GAP-18 is a separate non-corporate profit-transfer target issue. [T-026 diagnosis and next executable step](SESSION_HANDOFF.md#t-026-diagnosis-unresolved-ledger-inclusion-11-november-2026). No application change in this explanation turn.

## T-025 investment disclosures (11 November 2026)

- On `RSF` at source `26d3b9f`, implemented the owner's investment Fill Details request within Financial Statement Review only (F-009). Existing uncommitted T-023/T-024 work is retained. [Contract, sources and flow](T025_INVESTMENT_DISCLOSURES.md).
- Current/non-current tables follow populated sub-classifications with restricted ledger choices; printed investee, custom categories, relationships, securities/paid/quotation/valuation details, partnership partners/capital/shares, aggregates and redemption disclosures persist by year and TB/consolidated scope. Current investments have no trade/other split. Main-process permissions, ledger membership and locked/final-year checks protect saves. No source balance or measurement rule changes.
- Integration `npm.cmd run test:fsg`: 121/121 passed, including actual PDF extraction, reopened financial/Fill Details Excel, comparative-only ledgers, snapshots, year/client isolation and lock/bypass rejection. UI `npm.cmd run test:fsg-ui`: 61/61 passed; final layout confirmation is recorded in the latest handoff. Production build passed. PDF review found and fixed a continued-table header issue; the regenerated aggregate table was visually checked. Form screenshot review found and fixed a scoped label-style conflict.
- `npx.cmd tsc -p tsconfig.app.json --noEmit` remains failing in previously recorded shared application files; this task changes no TypeScript files. Sandbox build failed loading the installed native compiler; elevated build passed. PDF.js font-program warnings and the existing no-record Materiality warning remain. Documentation/source checks and final UI evidence are recorded in [handoff](SESSION_HANDOFF.md). Professional review, real-client UAT and installer testing remain open; no commit/release or owner acceptance claimed.

## T-023 GSTIN merge and startup label (11 November 2026)

- User-authorized outcome: pull PR #108 and identify that code update on startup.
- PR #108 was already merged by the owner at `f4d559742e8bf969a0c49125156c65b5c09345d6`; its GitHub `documentation` check passed. PR #107 (shared build label) was also already merged. Local `main` was fast-forwarded to `origin/main`, retaining the existing lockfile modification and untracked documentation packs.
- The shared login/header label now reads `Code baseline: 11 November 2026` and `Update: GSTIN normalization and validation (PR #108)`. The tooltip identifies `main` and the build-time commit; it does not poll GitHub or certify that an installed build is current.
- Passed: `npx --no-install vitest run src\lib` (10 files, 45 tests, including GSTIN validation and five label tests); `npx --no-install eslint src\config\buildMessage.ts src\lib\buildInfoLabel.test.ts`; `npm run build`.
- Failed: `npx --no-install tsc -p tsconfig.app.json --noEmit` (76 diagnostics in the same 18 files listed in the prior baseline, none in the label changes).
- `npm run docs:inventory` regenerated the inventory and screen map with no substantive diff. Documentation closeout results and remaining verification limits are in [SESSION_HANDOFF.md](SESSION_HANDOFF.md#t-023-gstin-merge-and-startup-label-11-november-2026).
- Not established: GST screen persistence/UAT, Electron visual fit, installer or release. The attempted production browser preview could not render because the application requires Electron; its temporary server was stopped. No client database was accessed or migrated.

## T-024 known-ALIE fallback categories (10 November 2026)

Implemented within Financial Statement Review on `RSF`: five requested LevelFormat terminal rows (684 workbook data rows), canonical master-linked low-confidence fallback mapping, matching BS wording, and a backup-backed additive upgrade for the known old workbook version. Existing IDs, overrides and balances are retained. See [T024_LEVEL1_FALLBACKS.md](T024_LEVEL1_FALLBACKS.md). Integration passed 93/93; UI passed 54/54; production build, documentation and syntax checks passed. Actual company PDF text and reopened Excel for constitutions 1/2/3 contain the tested fallback captions and figures. Synthetic backup/restore/retry and source-imbalance checks passed; no real-profile upgrade or owner UAT is claimed.

No universal balancing guarantee: all-fallback non-corporate equity can leave the existing profit-transfer rule without an owners'/partners' heading (GAP-18); the difference remains visible. No plug or new professional rule is introduced. Earlier T-023 work is preserved; other modules are not changed by T-024.

## T-023 firm signing place (10 November 2026)

Implemented on `RSF` from `d86bd93`, per the user's request and clarification: Place in VERA Settings/Admin Settings → Firm supplies Financial Statement Review's editable signing-place default. The global Siliguri/last-used preference is no longer consulted. Finalised years retain their recorded place. Additive upgrade creates a SQLite backup before adding `firm_settings.place`. Scope and acceptance: [T023_FIRM_SIGNING_PLACE.md](T023_FIRM_SIGNING_PLACE.md). Owner UAT is pending; the older snapshots below remain historical.

Validation: FSG integration passed 60/60, including seven fresh/upgrade/recovery checks; production build passed. Updated UI harness passed 47/47, including both settings screens, override/cancellation, restart, empty Place and finalised-year preservation. First UI run passed 44/45 because its restart assertion clicked export before statement loading enabled the button; the corrected readiness wait passed on rerun. Documentation and whitespace checks passed. TypeScript remains at 76 diagnostics and focused lint at 15 errors/1 warning; source comparisons against HEAD show no new diagnostics. Details and skipped checks are recorded in the handoff. PDF/Excel file content was not inspected.

## Snapshot

- Documentation review date: 30 October 2026.
- Reviewed application baseline: `cc5c04729604fba7d05240a07f24682e0644665c`.
- Source repository: ICAI-Audit/audit-assistant-pro-electron.
- Source branch and base commit: `main`, `c0ea50820094952b3bad9c83b45cc00cbff0381c`.
- Application package version: 0.9.1.
- Source remediation branch: `fix/t003-backend-authorization-2026-10-29`.
- Current documentation branch: `docs/application-review-2026-10-30`.
- Verification branch retained: `docs/t003-auth-lock-verification-2026-10-29` from `229a098f375050be1c5d4cd45236b5e0ec903325`.
- Branch HEAD: resolve with Git (`git rev-parse HEAD`); do not copy a commit's own SHA into this document.
- Local validation environment: Node.js 24.12.0 and npm 11.6.2.
- Current scope: handover preparation (2 November 2026): T-020 cleanup plus T-021 and T-012, integrated on `integration/handover-2026-11-02` from `main` at `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4`. T-019 (Financial Statement Review) is merged to `main` as PR #105; see [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md). The T-018 documentation review and its open owner decisions otherwise stand. PDF Tools phase 1 (T-031) is committed and pushed on `feat/pdf-tools`; no pull request, not merged.

## T-021 handover result (2 November 2026)

Fresh clone of `feat/t021-reconnect-tb-readers` (Windows, Node.js 24.12.0/npm 11.6.2, synthetic data): `npm ci --no-audit --no-fund` with normal postinstall, then the checks below. Branches and decisions: [SESSION_HANDOFF.md](SESSION_HANDOFF.md); module classification: [HANDOVER_CHECKLIST.md](HANDOVER_CHECKLIST.md).

| Check | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed (exit 0; electron-rebuild of better-sqlite3 and bcrypt) |
| `npm run docs:check`; `node --test scripts/check-project-docs.test.mjs` | Passed; 3/3 |
| `npm run build` | Passed |
| `npm run test:native` | Passed (Electron 40.9.1) |
| `npm run test:fsg` | Passed, 53/53 (41 earlier + 12 for `fsg:engagement:summary`: counts, CY/PY, face-line amounts, branch trial balances, access refusal across engagements and clients, authentication, no writes) |
| `node scripts/test-fsg-ui.cjs` | Passed, 37/37 |
| `node --test scripts/test-t003-authorization.cjs` | Passed, 26/26 |
| `npx vitest run src/lib` | Passed; 8 files, 37 tests |
| `npx tsc -p tsconfig.app.json --noEmit` | **Failed**, 76 diagnostics in 18 files, same as the starting baseline (none in the T-021 files' own logic; none suppressed) |
| `npm run lint` | **Failed**, 545 problems (474 errors, 71 warnings); 546 before T-021 |

Skipped / not established: the three reconnected screens in the running application, PDF and Excel contents, sign-in and engagement switching through the UI, close and reopen through the UI, packaged launch, installer, live Tally, owner UAT. The engagement-isolation evidence is for the `fsg:engagement:summary` channel only.

## T-020 result (2 November 2026)

Windows, Node.js 24.12.0/npm 11.6.2, synthetic data only. Starting commit `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4` (origin/main, unchanged since the earlier review).

| Check | Baseline at start | After cleanup |
| --- | --- | --- |
| `npm run docs:check` | Failed: `ENOENT scandir tests` | Passed |
| `node --test scripts/check-project-docs.test.mjs` | Failed (same cause) | Passed, 3/3 |
| `npm run build` | Passed | Passed |
| `npm run test:fsg` | 41/41 | 41/41 |
| `node scripts/test-fsg-ui.cjs` (after build) | Failed, 35/37 (seed used `HEAD`'s schema, which no longer has the legacy tables) | 37/37 |
| `node --test scripts/test-t003-authorization.cjs` | 26/26 | 26/26 |
| `npm run test:native`, `npx vitest run src/lib` | not run at baseline | Passed; 8 files, 37 tests |
| `npx tsc -p tsconfig.app.json --noEmit` | 76 diagnostics | 76 diagnostics (unchanged) |
| `npm run lint` | 564 problems (492 errors, 72 warnings) | 546 problems (475 errors, 71 warnings) |

Not established: application behaviour beyond the synthetic harnesses, packaged launch, installer, live Tally, owner UAT. Removals and retained candidates are listed in [SESSION_HANDOFF.md](SESSION_HANDOFF.md). The T-019 snapshot below is historical.

## T-019 result (2 November 2026, historical; merged to `main` as PR #105)

Windows, Electron 40.9.1, SQLite 3.53.0, Node.js 22.14.0/npm 10.9.2, synthetic data only. Developed on `work/developer-task` from `03d1a46f16b36da16d3821cee2e1c3280897a78c`.

**Passed**
- `npm run docs:check` (31 documents, links, inventory) and `node --test scripts/check-project-docs.test.mjs` (2/2).
- `npm run test:fsg`: 41/41.
- `node scripts/test-fsg-ui.cjs` after `npm run build`: 37/37.
- `node --test scripts/test-t003-authorization.cjs`: 26/26.
- `npm run test:native`.
- `npx vitest run src/lib`: 8 files, 37 tests.
- `npm run build`.

**Failing as baseline, reduced**
- TypeScript: 76 diagnostics in 18 files, none new in changed files.
- Lint: 492 errors and 72 warnings; changed TypeScript files are clean.

**Not established**
- Same-TB comparison with FSG_Bharat on PostgreSQL.
- PDF/Excel content review.
- Live Tally.
- Installer.
- Upgrade of a real installed database.
- `npm ci` on Node 24.12 after adding 11 renderer packages.
- Owner UAT.

**Removed**
- `test:classification` and `test:bulk-update`, with the code they tested.

## What is established

- Active runtime remains Electron main/preload with renderer IPC to local SQLite under Electron `userData`.
- T-001 remains partial: automatic repository-instruction loading is still unverified.
- T-002 installation/toolchain fixes remain intact.
- T-003 now has implemented backend enforcement for the previously confirmed unauthenticated and cross-engagement IPC defects.

## Earlier T-003 reported remediation evidence

The following application execution results were reported by the prior VS Code session and retained at the reviewed baseline. They were not rerun as part of this documentation pass. Full UI behaviour and unresolved policies remain separate.


The harness runs the real production handlers (`electron/main.cjs`, `electron/preload.cjs`) in an isolated temporary profile via `scripts/t003-electron-entry.cjs` and `scripts/test-t003-authorization.cjs`. It verifies that the temporary database does not exist before loading main, then exercises the actual preload API with synthetic users/data.

Implemented backend changes:

- Added centralized authorization checks in `electron/sqlite-authorization.cjs`.
- `sqlite-query` now rejects unauthenticated access, validates table/action, enforces filtered-only update/delete, and applies engagement-scoped checks for select/update/delete/insert/upsert.
- Cross-engagement forged-ID mutations are denied.
- Protected role and sensitive field updates are denied.
- Cross-engagement `evidence_links` insertion/read paths are blocked.
- Evidence file path/save/download/delete handlers now require authentication and evidence metadata ownership checks.
- Admin behavior follows approved task choice: partner-equivalent permissions plus global engagement scope.

Latest isolated regression result:

- `node --test scripts/test-t003-authorization.cjs`: **passed** (26 tests, 26 passed, 0 failed), including four review-finding regressions that failed before the fixes (canonical file ownership, parent-key moves, trial balance authorization, scoped upload rollback).

Observation-only cases intentionally remain:

- Evidence `locked`/`approval_stage` transition policy is still unresolved and not yet enforced by finalized business rules.
- Export while logged out still succeeds to local downloads; export authorization policy remains unresolved.

## Validation summary (T-003 time; historical, `test:classification` and `test:bulk-update` were removed in T-019)

**Passed**

- `npm ci --no-audit --no-fund`
- `node --check electron/sqlite-authorization.cjs`
- `node --check electron/main.cjs`
- `node --check scripts/test-t003-authorization.cjs`
- `node --test scripts/test-t003-authorization.cjs` (26/26 pass)
- `npm run test:native`, `npx vitest run src/lib` (8 files, 37 tests), `npm run test:classification`, `npm run test:bulk-update`, `npm run build`

**Failed (existing baseline, tracked separately)**

- `npx tsc -p tsconfig.app.json --noEmit`: existing diagnostics baseline (T-013).
- `npm run lint`: existing lint baseline (T-014).

**Not established in this scope**

- Installer/release validation.
- Cross-platform runtime validation.
- ODBC/Tally integration validation.
- Owner UAT.

## Blocking or material gaps

1. Export authorization policy remains undefined at the backend boundary.
2. Evidence approval/review/lock/reopen transition rules require product decisions before final enforcement.
3. Long-term role mapping decisions for `viewer` and `user` remain open.
4. TypeScript and lint baselines remain failing and must be triaged separately.
5. Prototype feature gaps remain for Misstatements and Completion (T-007 scope continues separately).
6. Dashboard, Audit Report setup and Data Integrity now read Financial Statement Review data (T-021, awaiting owner acceptance); the legacy tables stay unread and untouched, and their fate is an open owner decision.
7. Duplicate deferred-tax tools and placeholder actions are recorded and unchanged (T-022). The duplicate `/feedback` route is resolved (T-012).

## Documentation review result

Prepared the owner review edition and 19 canonical module specifications covering all 28 feature IDs; traced 35 original Phase I statements/blueprint proposals; documented principal business fields, rules, outputs, permission boundaries and acceptance scenarios. Added a 78-table/1,055-column declared-schema catalogue, persistence caller catalogue and tax clause/field catalogue with extraction limits. Consolidated 16 owner review groups and known implementation/verification gaps.

Documentation-only checks completed on Node.js 24.22.1: `node scripts/check-project-docs.mjs` passed, and `node --test scripts/check-project-docs.test.mjs` passed one regression test with zero failures. Additional review validation passed for 61 Markdown files, 617 local links, all 28 feature IDs, 19 module sections, 35 traced source statements, 60 unique proposed acceptance cases and 16 owner review groups. Source anchors exist and all 46 changed paths are Markdown or documentation JSON. `git diff --check` passed; staged/final diff is checked at commit. No application tests or legal review were rerun.

## First next activity

T-019: the owner reviews [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md), answers the listed assumptions, and compares one anonymised trial balance in FSG_Bharat and in VERA. The T-018 activity below is unchanged.

The owner reviews REVIEW_START_HERE.md and APPLICATION_REVIEW.md and records decisions/corrections in OWNER_REVIEW_DECISIONS.md. Update the canonical modules and approved scope after that review. Do not automatically start export-policy implementation, schema repair, security remediation, typecheck or lint work from the previous handoff. Those remain documented pending tasks requiring a separate implementation request.
