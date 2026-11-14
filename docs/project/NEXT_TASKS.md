# Next tasks

These are recommended tasks derived from the review. They do not grant approval to expand product scope or change professional rules. A new user instruction may select a different task. Record active work here and retain completed task IDs with evidence.

| ID | Priority | Status | Outcome | Dependencies |
| --- | --- | --- | --- | --- |
| T-032 | P2 | Complete (scoped); fast-forwarded to `origin/main`; startup label updated; owner desktop verification pending | Sync local `main` to `6e5da5e` (PR #111 PDF Tools and PR #112 GSTIN lookup/bulk) and identify that snapshot on the shared startup label. Preserve and reconcile the existing lockfile edit and untracked documentation packs. Checks and limits: [CURRENT_STATUS.md](CURRENT_STATUS.md#t-032-sync-latest-main-and-refresh-startup-label-14-november-2026) and [SESSION_HANDOFF.md](SESSION_HANDOFF.md#t-032-sync-latest-main-and-refresh-startup-label-14-november-2026). | Explicit user request, 14 November 2026 |
| T-031 | P2 | Phase 1 implemented and merged to `main` in PR #111; owner's hand check to be reported back; owner UAT pending | PDF Tools (F-030): merge, split, delete pages, compress, page numbers, images to PDF, PDF to images, password-protected input; save to computer, Evidence Vault and working-paper destinations; activity-log entry for each send. Design, known limits and application problems found on the way: [PDF_TOOLS.md](PDF_TOOLS.md). Evidence: [CURRENT_STATUS.md](CURRENT_STATUS.md#t-031-pdf-tools-phase-1-14-november-2026) | Owner hand check and decisions in the T-031 section below |
| T-030 | P2 | Complete and pushed to `origin/main` (`bf0b5bf`); desktop visual verification pending | Fast-forward `main` to fetched `origin/main` and update the shared login/header label to identify the pulled 13 November snapshot and PRs #109/#110. Focused test, lint, production build, bundle string check and docs checks passed. The tooltip retains the build commit; no live remote polling or claim about other installed builds. | Explicit user request, 13 November 2026 |
| T-029 | P2 | Reviewed; committed and published on RSF | Review T-023?T-028 on RSF, fresh remote/conflict and data checks, full commit draft and running app. Integration 210/210; desktop 81/81; existing 76 TS diagnostics with none added. [Review and remaining findings](RSF_PRE_COMMIT_REVIEW.md) | Owner confirmed commit and later explicitly requested GitHub push, 13 November 2026; release not authorised |
| T-028 | P2 | Implemented; desktop 81/81 passed; owner UAT pending | Removed Cloudtail MCA publishing card, automatic final-export publication and renderer/backend publishing interface; historical snapshot storage preserved. Integration 210/210 | Explicit owner request and screenshot, 13 November 2026; FSG-only application scope |
| T-027 | P2 | Supporting dates implemented; desktop 81/81 passed; owner UAT pending | Dated BS/P&L faces plus underlying Notes, ledger Annexures and relevant disclosure tables on screen and PDF/Excel; correct per-note reporting basis and unchanged formulas/figures. Integration 210/210 | Explicit owner follow-up, 13 November 2026; supersedes earlier face-only scope |
| T-026 | P1 | Warnings retained; provisional liability rolled back; broader reconciliation outstanding | Owner explicitly removed only provisional ALIE MISSING liability placement. Keep non-blocking red warnings, ledger lists/correction actions, nil filtering and PY stock-disclosure exclusion. Unknown ALIE amounts remain excluded pending classification; statements may be incomplete/unbalanced. [Current contract](T026_MISSING_ALIE_WARNINGS.md). Known-ALIE unresolved-status inclusion and GAP-18 remain separate open work | Explicit owner rollback clarification, 12 November 2026; no source reclassification or balancing plug |
| T-025 | P2 | Implemented; professional review and owner UAT pending | Investment Fill Details by populated sub-classification; scoped ledger choices, extensible categories, securities/relationship/valuation/partnership disclosures, year-scoped save, PDF/Excel and workbook round-trip. Integration 121/121 and UI 61/61; [contract and evidence](T025_INVESTMENT_DISCLOSURES.md) | Explicit owner request and supplied Schedule III Division I screenshots, 11 November 2026; owner review with an anonymised investment TB |
| T-024 | P2 | Implemented and automated verified in scope; owner UAT pending | Five missing known-ALIE Level 1 fallback rows, terminal master-linked mapping and additive upgrade in Financial Statement Review only. Integration 93/93; UI 54/54; build/docs passed. Balances/user decisions preserved; no universal BS balancing guarantee. [Contract and GAP-18](T024_LEVEL1_FALLBACKS.md) | Explicit user request, 10 November 2026; separate owner review needed for non-corporate profit transfer without a classified equity heading |
| T-023 | P2 | Implemented and automated verified in scope; owner UAT pending | Use VERA Settings/Admin Settings Firm Place as the editable Financial Statement Review signing default, replacing hard-coded Siliguri/global last-used preference. Nullable field and backup-before-upgrade; finalised years preserved. Integration 60/60 and UI 47/47 passed. [Contract](T023_FIRM_SIGNING_PLACE.md) | User request and profile-source clarification, 10 November 2026 |
| T-001 | P1 | Partial verification | This VS Code assistant session manually read the shared records and retrieved the requested project facts. Automatic loading is unverified; an actual Codex session and Claude loading remain unverified. These client checks did not block T-002 or T-003 | Run a fresh session in the installed Codex client; verify automatic instructions with direct client evidence |
| T-002 | P1 | Complete (scoped) | Reproduced and repaired stale lock metadata; set release workflow to Node 24; two clean `npm ci` runs with postinstall and synthetic Electron native smoke passed. See DEVELOPMENT_GUIDE.md and SESSION_HANDOFF.md for evidence and limits | None |
| T-003 | P1 | Complete (verification + scoped remediation) | Active Electron IPC now enforces authentication, engagement-scoped query/file access, protected-role update denial, and filtered-only update/delete in production handlers. Remaining policy decisions: export authorization and evidence state transitions. | Product policy decisions for export and evidence-state transitions |
| T-004 | P1 | Decision required | Confirm release scope and deployment model | Product owner decisions D-001 to D-004 |
| T-005 | P2 | Documentation prepared for owner review | 28 feature areas, 19 module specifications, 35 traced source statements/proposals, declared field/caller catalogues and proposed acceptance cases completed at cc5c0472; approval and later UI/UAT remain open | Owner review; T-004 for accepted release boundary |
| T-006 | P2 | Proposed implementation | Persist misstatements and connect real materiality | Confirm workflow and permissions; T-003 |
| T-007 | P2 | Design required | Durable completion and file finalization | T-003, T-006 and approved sign-off rules |
| T-008 | P2 | Ready for verification | Validate tax-audit content and draft exports | Reproducible environment and authoritative legal review |
| T-009 | P2 | Ready for investigation | Verified backup, restore and migration safety | Approved data retention and recovery requirements |
| T-010 | P2 | Ready for verification | Target-platform installer and updater smoke evidence | T-002; release destination and signing decision |
| T-012 | P2 | Done on `feat/t021-reconnect-tb-readers`, awaiting owner merge | Duplicate `/feedback` removed: one route remains, guarded by `ProtectedEngagementRoute` (owner decision 2 November 2026: feedback is engagement-scoped; the first declaration already took effect, so behaviour is unchanged) | Owner acceptance |
| T-011 | P3 | Scope decision required | AI and knowledge integration specification | T-004; provider, privacy and evaluation approval |
| T-013 | P2 | Ready for investigation | Triage the 76 existing TypeScript diagnostics across 18 files (114 across 28 before T-019) from `npx tsc -p tsconfig.app.json --noEmit`; establish baseline and resolve in scoped changes | None; preserve T-002 install/toolchain fixes |
| T-014 | P2 | Ready for investigation | Triage 475 lint errors and 71 warnings (515/101 before T-019) from `npm run lint`; establish baseline and resolve in scoped changes | None; preserve T-002 install/toolchain fixes |
| T-015 | P0 | Complete (scoped) | Implemented fail-closed backend checks for unauthenticated database/file IPC, engagement ownership enforcement, protected role-field checks, and unfiltered mutation denial with isolated regression evidence | Continue with T-016 policy decisions for remaining behavior |
| T-016 | P1 | Product decision required | Approve admin/partner/manager/senior/staff/viewer policy, engagement assignment/listing semantics, bulk mutation limits, export access, and evidence approval/lock/reopen transitions | Product owner decisions; T-003 control matrix |
| T-018 | P1 | Ready for owner review | Complete documentation baseline and consolidated owner review; no application fixes | Owner decisions and corrections |
| T-017 | P2 | Ready for investigation | Add missing `engagement_tb_classification` and `ifc_clause_library` definitions to `sqlite/schema` with upgrade evidence; callers currently fail with missing-table errors | Backup/upgrade approach from T-009 |
| T-019 | P1 | Merged to `main` (PR #105, `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4`); owner confirmation and UAT pending | Replace Financial Review with Financial Statement Review (FSG_Bharat ported to SQLite). Synthetic integration (41/41) and UI (37/37) evidence; see [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md) | Owner answers to the listed assumptions; same-TB comparison with FSG_Bharat; owner UAT |
| T-020 | P2 | Complete (scoped), awaiting owner review and merge | Remove files demonstrated unused after T-019, repair the documentation checker for a fresh checkout and correct current records. See [SESSION_HANDOFF.md](SESSION_HANDOFF.md) | None |
| T-021 | P2 | Implemented on `feat/t021-reconnect-tb-readers`, awaiting owner acceptance | Dashboard, Audit Report setup and Data Integrity now read Financial Statement Review data through the read-only `fsg:engagement:summary` channel; legacy tables are untouched and unread (owner decision 2 November 2026). Mapping and sign rules: [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md#engagement-summary-for-dashboard-audit-report-setup-and-data-integrity-t-021). Evidence: `npm run test:fsg` (53 checks incl. engagement isolation, CY/PY, branch trial balances, face-line amounts). Not verified: screens in the running application | Owner UAT of the three screens with a real mapped trial balance; owner confirmation that absolute closing balances of Share capital, Reserves and surplus and Borrowings are the intended cross-check |
| T-022 | P3 | Findings recorded; owner decision required | Duplicate tools, placeholders and routes found during T-020, none changed: three deferred-tax implementations (`src/components/audit/DeferredTax.tsx` and `DeferredTaxCalculator.tsx`, both mounted in `AuditTools.tsx`, and the FSG module `src/modules/fsg/components/DeferredTax`); placeholder actions that only show a notice (`AuditTools.tsx` "Coming Soon" Excel import, GST portal authentication and file-processing toasts; "not yet implemented" email invitation and admin password reset in `BulkTeamImportDialog.tsx`, `PartnersTabContent.tsx`, `AdminDashboard.tsx` and `AdminSettings.tsx`; `ProcedureWorkpaper.tsx` stub); the duplicate `/feedback` route is resolved under T-012. Owner decision 2 November 2026: record only; nothing visible is removed. Decide which tool is canonical and which placeholders to build or hide before any consolidation | Owner decisions | The PDF tab's placeholder cards were replaced by PDF Tools (T-031); its not-yet-built tools stay visible as "Soon".
| T-023 (GSTIN; collides with an existing FSG task ID) | P1 | Complete; merged in PR #108 | GSTIN normalization/checksum validation across entry points, plus the 11 November startup label update. See [current status](CURRENT_STATUS.md#t-023-gstin-merge-and-startup-label-11-november-2026) | Owner UAT of the GST entry flows remains separate |
| T-024 (GSTIN; ID also used by FSG/CAAT tasks) | P1 | Core flow implemented and merged with current `main`; provider/runtime confirmation pending | Add consent-gated taxpayer lookup, CSV template and lookup results downloads, and CSV/XLS/XLSX validation; only locally valid GSTINs go to the fixed e-waybill API. Taxpayer type derives from character 14 per the supplied chart; GSTZen create is no longer a local-save prerequisite. Specification: [T-024](tasks/T-024-gstin-lookup-bulk.md); team guide: [GSTIN testing](GSTIN_TEAM_TEST_GUIDE.md). Task-number collisions remain unresolved and were not renumbered in this merge. | Resolve response parser confirmation gap, compare single/bulk provider responses, confirm provider terms and complete owner UAT |
| T-024 | P2 | Implemented on local branch `feature/caat-tools` (not pushed), awaiting owner UAT | Embed CAAT Tools (data analytics tests and SA 530 sampling) at `/caat-tools` with per-engagement saving; large-ledger crash, SheetJS upgrade and wording fixed. Evidence: `npm run test:caat-ui` 29/29. See [CAAT_TOOLS.md](CAAT_TOOLS.md) | Owner UAT with real client ledgers; decision on filing CAAT exports in the Evidence Vault |

## Current activity and scope

T-032 (14 November 2026, explicit user request): local `main` was fast-forwarded from `8ee2107` to fetched `origin/main` at `6e5da5e`, including PR #111 PDF Tools and PR #112 GSTIN lookup/bulk. The shared startup/header label identifies this snapshot. Existing `package-lock.json` edits and untracked documentation packs were preserved. See [current status](CURRENT_STATUS.md#t-032-sync-latest-main-and-refresh-startup-label-14-november-2026) and [handoff](SESSION_HANDOFF.md#t-032-sync-latest-main-and-refresh-startup-label-14-november-2026). The label is static build metadata; desktop visual fit remains unverified.

T-031 (14 November 2026, the lead's request after the VERA Tools meeting of 2 November): PDF Tools phase 1 is implemented on `feat/pdf-tools`, which sits on `main` at `8ee2107`. It is committed on branch `feat/pdf-tools` (base `main` at `8ee2107`) as three commits, `feat(T-031): add PDF Tools organise, numbering and image conversion`, `test(T-031): add PDF Tools application test` and `docs(T-031): record PDF Tools phase 1 design, status and inventory`, and the branch is pushed to `origin` (see `git log origin/feat/pdf-tools`). It was merged to `main` in PR #111 at `6e5da5e`. The owner gave the go-ahead to commit and push on 14 November 2026 after the folder-save defect was fixed and re-verified. The owner's own re-test of the fixed folder save and the rest of the hand-check list (single-file Save As including cancel, drag and drop, another PDF reader, real scans and Office exports, the destinations) have not been reported back and are still to be confirmed. Not owner-accepted; no UAT. The hand check is listed in the T-031 section below. See [current status](CURRENT_STATUS.md#t-031-pdf-tools-phase-1-14-november-2026) and [handoff](SESSION_HANDOFF.md#t-031-pdf-tools-phase-1-14-november-2026).

T-030 (13 November 2026, explicit user request): local `main` fast-forwarded to fetched `origin/main` at `99324ea`; the shared login/header label now identifies the 13 November source sync and PR #109/#110. Commit `bf0b5bf` is pushed to `origin/main`; focused label tests, targeted ESLint, production build and docs checks passed. Docs closeout is recorded in [current status](CURRENT_STATUS.md#t-030-main-pull-status-on-login-13-november-2026) and [handoff](SESSION_HANDOFF.md#t-030-main-pull-status-on-login-13-november-2026). The label is static build metadata, not live remote polling. Other installed builds do not change until separately rebuilt/distributed.

T-024 (GSTIN, 14 November 2026): the consented lookup and bulk-validation branch is now merged with current `main`. The GST Master save path is local and no longer requires GSTZen creation; GSTZen GSTR-1/session integration is retained separately. Provider-response confirmation, provider terms, runtime lookup verification and owner UAT remain pending. T-024 is also used for independent FSG/CAAT work; the identifier collision is recorded, not silently renumbered. See [task specification](tasks/T-024-gstin-lookup-bulk.md), [current status](CURRENT_STATUS.md#t-024-gstin-integration-with-current-main-14-november-2026) and [handoff](SESSION_HANDOFF.md#t-024-gstin-merge-with-current-main-14-november-2026).

T-019 (2 November 2026) was merged to `main` as PR #105 (`cad1727eeb2500c8ecd06d9ffa3a86664a9246b4`); owner confirmation and UAT remain pending. T-020 is a scoped cleanup on `chore/remove-unused-code` from that commit. T-018 documentation review otherwise remains in place: review the assembled application document and consolidated decisions before selecting more code work.

## T-019 Financial Statement Review

Delivered:
- old Financial Review code, tests and the unused legacy tables removed, the tables only when empty and after a backup;
- `sqlite/schema/10_fsg_tables.sql`;
- the `electron/fsg` main-process module with authorised `fsg:*` channels;
- the `src/modules/fsg` screens;
- the route, sidebar and shortcut;
- `npm run test:fsg` and `npm run test:fsg-ui`.

Accept when:
- the owner confirms or changes the [assumptions](FINANCIAL_STATEMENT_REVIEW.md#assumptions-awaiting-confirmation);
- the same anonymised trial balance gives identical mapped TB, statements and exports in FSG_Bharat and in VERA;
- PDF/Excel outputs are inspected;
- a real-profile upgrade is rehearsed on a copy of an installed database;
- the owner records UAT.

Follow-ups (owner decision): GAP-17 is now T-021 (dashboard and Audit Report TB consumers); whether to port FSG_Bharat's PostgreSQL self-tests to SQLite; re-verify `npm ci` on Node 24.12 after the dependency additions.

## T-031 PDF Tools

Delivered in phase 1 (verification is in the status and handoff): the screen; seven tools; password-protected input; Save to computer, Add to Evidence Vault and Attach to working paper; an activity-log entry for each send.

Owner hand check, not yet done (the automated test cannot do these; PDF_TOOLS.md section 9):

1. The native save and folder windows in `npm run electron:dev` and in an installed package: save one result and several results; cancel each window; check the "name (2).pdf" numbering; choose Desktop, Documents and Downloads themselves as the folder (accepted since the `electron/main.cjs` listener of 14 November 2026; confirm it in the application), a folder inside one of them, and a folder that must be refused, such as one under AppData (the quiet note should appear). Also confirm the single-file Save As window into those folders.
2. Drag files in from the desktop.
3. A screen-reader pass over the dialogs.
4. Open the results in Acrobat or another PDF reader, including a file with filled-in form fields after Split or Delete pages, and page numbers on a rotated scan. Try real Word, Excel and scanner files.
5. Try the largest sizes once: a 300 MB list, a 500-page PDF to images at 300 dpi, 200 images to PDF.
6. Record the outcome in the handoff, then decide on opening a pull request to `main`. Owner UAT is separate.

Follow-ups, none started:

1. **Owner decision: the Inter font from Google Fonts** (`src/index.css`). See PDF_TOOLS.md section 12.
2. **Owner decision: the other application problems in PDF_TOOLS.md section 12** (locks not enforced in the main process, vault deletion leaving attachments, upload order, the stray "0", truncated Audit Trail details, and the rest). None was changed.
3. **Owner decision: instant clearing on engagement change.** A one-line notification in `src/contexts/EngagementContext.tsx` would make it immediate; the owner decided on 13 November 2026 not to edit that shared file for now.
4. **Warning when quitting with results not saved.** Needs a main-process change.
5. **Unlock in a background worker.** Opening an 83 MB AES-256 scan blocks the screen for about 18.5 s.
6. **Phase 2: Redact and Bookmarks** (PDF_TOOLS.md sections 5.9 and 5.10), after a build check against the document.
7. **Phase 3: PDF to Excel, PDF to Word, Make searchable (OCR) and Review** (sections 5.11 to 5.13). The owner must define Review.
8. **Verification gaps in PDF_TOOLS.md section 11:** protected files with no `/ID`; non-Latin passwords on older-protection files; a real linearised protected file; certificate-protected linearised files.

## T-001 Session continuity

Open the same documentation branch from the repository root in each installed coding client. Start a fresh session using START_HERE.md. Ask it to identify product, active database path, sample screens, the recorded installation/toolchain result, selected task and next executable step. Require it to name the files it actually read. Do not provide those answers in the prompt. Verify settings permit repository instructions, and capture client version and direct evidence of automatically loaded instructions. Distinguish files the client reports loading automatically from files manually requested during the test; if direct evidence is unavailable, mark automatic loading unverified. Read-only verification must not invent a new implementation task. A structural docs check is not a substitute for this test. Accept only the clients actually tested; leave other installed clients pending.

### T-001 evidence recorded 29 October 2026

The current assistant session is hosted by the Copilot SDK in VS Code. `code --version` reported VS Code 1.143.1 (`e646868227c3e3a9e3f24277c8c7220be42c0be7`, x64). The installed extension list included `openai.chatgpt@26.1021.22027`, `openai.codex-audio@26.1021.22027`, and `anthropic.claude-code@2.1.312`; these inventory entries do not establish which extension hosted this session. No standalone `codex` executable or Copilot CLI was available. Therefore no Codex client version or fresh Codex-session result is claimed. Claude was not exercised.

This assistant explicitly opened AGENTS.md and the project records with workspace file-reading tools. No direct session discovery log or other client evidence identifying automatically loaded repository instructions was available. Automatic loading is unverified, not failed. In this manually requested read, the assistant recovered the product purpose, active Electron/React/SQLite design and storage, sample-driven Misstatements and Completion gaps, validation limits, and next activity; the supporting paths and detail are recorded in SESSION_HANDOFF.md. This is a partial manual continuity check only.

## T-002 Reproducible install

Completed on the T-002 branch. The pre-change EUSAGE lock mismatch was reproduced; lock metadata was repaired without direct dependency upgrades. The workflow now uses Node 24. Two separate clean worktrees passed `npm ci --no-audit --no-fund` with normal postinstall and `npm run test:native` on Windows x64 with Node.js 24.12.0/npm 11.6.2. `npx vitest run src/lib` (8 files, 37 tests), `npm run test:classification`, `npm run test:bulk-update`, and `npm run build` passed. The explicit application typecheck failed with 114 diagnostics across 28 files; lint failed with 515 errors and 101 warnings. T-013 and T-014 track those separate follow-ups. Electron launch, installer, cross-platform support, ODBC/Tally and owner UAT remain unverified; see CURRENT_STATUS.md and DEVELOPMENT_GUIDE.md. No unrelated package versions were upgraded.

## T-003 Authorization and locks

Completed with scoped remediation on `fix/t003-backend-authorization-2026-10-29`. The harness still launches the real production Electron main and preload in a temporary profile and exercises the actual preload IPC API with synthetic users/data. Current result: `node --test scripts/test-t003-authorization.cjs` passes 26/26 tests. Enforced paths include unauthenticated denial, engagement-scoped query/file access, protected role update denial, cross-engagement forged-ID denial, filtered-only update/delete, canonical evidence file ownership, parent-key move prevention, trial balance table authorization, and a scoped staff upload rollback. Observation-only checks remain for export authorization and evidence lock/approval transitions pending product decisions (T-016). Missing `engagement_tb_classification` and `ifc_clause_library` schema definitions are a separate follow-up. Whole-file finalization remains T-007.

## T-004 Release scope

Obtain decisions on desktop/offline versus web/cloud, less-complex-entity assistance versus full audit workflow, financial statement preparation versus comparison, and target release focus between statutory and tax audit. Record decision owner, date, source and exclusions. Preserve existing implementation while documenting the approved boundary. Accept when a release capability list and non-goals can be traced to recorded decisions.

## T-005 Coverage matrix

Expand each in-scope feature into fields, validation, persistence, role rules, calculations, legal sources, outputs, error paths and acceptance cases. Trace source requirement to feature ID, screen, code, table and test. Include line-item working-paper links, checklist/MRL search, calculators and original materiality requirements. Mark unimplemented and sample-driven items explicitly. Accept when every approved requirement has an implementation/test link or a named backlog task, with no unsupported completeness percentage.

## T-006 Misstatements

Replace sample amounts only after agreeing fields, classifications, adjusted status, materiality link and permissions. Define engagement/year ownership, adjustment history and review. Implement create, edit, delete, totals and persisted status with appropriate audit events. Test restart, duplicate submission, zero/negative amounts as business rules require, and another engagement. Accept when results use saved engagement records and no sample data drives production conclusions.

## T-007 Completion

Specify prerequisites, review roles, signing authority, unresolved exceptions, lock scope and controlled reopening with reasons. Enforce state transitions and locks in the backend and preserve a finalization snapshot and history. Completion is not just a checkbox page. Accept when the saved file remains locked after restart and all affected write paths reject unauthorised changes, with regression coverage and owner UAT.

## T-008 Tax-audit verification

Reconcile older pilot notes with current 3CA/3CB editors and 3CD Word, Excel, PDF and HTML outputs. Confirm target assessment years. Check guidance and notification versions through authoritative sources, then review field coverage, applicability, prefill provenance, missing values and reviewed wording. Test AY mismatch warnings, representative structured clauses, saved/reopened data, escaping and matching preview/export figures. Visually inspect exports. Accept professional content only with a named reviewer; portal compatibility needs its own schema validation and submission scope.

## T-009 Recovery

Inventory SQLite, WAL handling, evidence bytes and localStorage dependencies. Specify supported backup method, encryption/access, retention, recovery point and recovery time requirements with the owner. Restore into an isolated profile and verify records, links, totals and files. Test fresh and upgraded databases and an interrupted migration. Accept when the documented recovery exercise is repeatable without resetting live data.

## T-010 Desktop distribution

Confirm repository owner/feed and required signing policy. Verify icons and installer resources exist, build on target Windows and macOS environments as supported, test native modules, fresh/upgrade launch, persistence and restart. Exercise an update on a test channel with synthetic data. No automatic tag, publication or rollout is authorised by this task list. Accept when installer and update evidence identify exact commit, version and checks.

## T-011 AI specification

If selected, document AI use cases, deterministic boundaries, provider contract, data minimisation and consent, source corpus and effective dates, retrieval citations, evaluation datasets, human review, cost/failure limits and output logging. Do not describe full-population analytics as audit assurance or an AI risk score as an auditor's conclusion. Accept a scoped specification before implementing provider calls.

## T-012 Route guard consistency

src/App.tsx declares /feedback twice, once with ProtectedEngagementRoute and once with ProtectedRoute. Determine whether feedback requires a selected engagement, preserve intended access, remove the duplicate declaration and test unauthenticated and authenticated navigation with and without an engagement. Refresh inventory and screen map. Accept when one route expresses the approved policy and navigation has regression evidence.

## T-018 Documentation review

The documentation-only pass is prepared against cc5c04729604fba7d05240a07f24682e0644665c. Start with REVIEW_START_HERE.md and APPLICATION_REVIEW.md. Coverage includes every retained feature, the enumerated original requirements/proposals, principal module fields/workflows/outputs, declared schema fields and proposed acceptance scenarios. OWNER_REVIEW_DECISIONS.md collects unresolved scope and policy in one place. Code fixes, migration, legal-content approval and owner UAT are not claimed complete. After owner review, record precise answers, update canonical specifications and agree the next implementation or verification task.
