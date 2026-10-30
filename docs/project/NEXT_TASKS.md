# Next tasks

These are recommended tasks derived from the review. They do not grant approval to expand product scope or change professional rules. A new user instruction may select a different task. Record active work here and retain completed task IDs with evidence.

| ID | Priority | Status | Outcome | Dependencies |
| --- | --- | --- | --- | --- |
| T-001 | P1 | Partial verification | This VS Code assistant session manually read the shared records and retrieved the requested project facts. Automatic loading is unverified; an actual Codex session and Claude loading remain unverified. These client checks did not block T-002 or T-003 | Run a fresh session in the installed Codex client; verify automatic instructions with direct client evidence |
| T-002 | P1 | Complete (scoped) | Reproduced and repaired stale lock metadata; set release workflow to Node 24; two clean `npm ci` runs with postinstall and synthetic Electron native smoke passed. See DEVELOPMENT_GUIDE.md and SESSION_HANDOFF.md for evidence and limits | None |
| T-003 | P1 | Complete (verification + scoped remediation) | Active Electron IPC now enforces authentication, engagement-scoped query/file access, protected-role update denial, and filtered-only update/delete in production handlers. Remaining policy decisions: export authorization and evidence state transitions. | Product policy decisions for export and evidence-state transitions |
| T-004 | P1 | Decision required | Confirm release scope and deployment model | Product owner decisions D-001 to D-004 |
| T-005 | P2 | Ready for analysis | Detailed requirements-to-code coverage and UAT matrix | T-004 for acceptance boundaries |
| T-006 | P2 | Proposed implementation | Persist misstatements and connect real materiality | Confirm workflow and permissions; T-003 |
| T-007 | P2 | Design required | Durable completion and file finalization | T-003, T-006 and approved sign-off rules |
| T-008 | P2 | Ready for verification | Validate tax-audit content and draft exports | Reproducible environment and authoritative legal review |
| T-009 | P2 | Ready for investigation | Verified backup, restore and migration safety | Approved data retention and recovery requirements |
| T-010 | P2 | Ready for verification | Target-platform installer and updater smoke evidence | T-002; release destination and signing decision |
| T-012 | P2 | Ready for scoped correction | Resolve duplicate feedback route and document intended guard | Confirm route access policy |
| T-011 | P3 | Scope decision required | AI and knowledge integration specification | T-004; provider, privacy and evaluation approval |
| T-013 | P2 | Ready for investigation | Triage 114 existing TypeScript diagnostics across 28 files from `npx tsc -p tsconfig.app.json --noEmit`; establish baseline and resolve in scoped changes | None; preserve T-002 install/toolchain fixes |
| T-014 | P2 | Ready for investigation | Triage 515 lint errors and 101 warnings from `npm run lint`; establish baseline and resolve in scoped changes | None; preserve T-002 install/toolchain fixes |
| T-015 | P0 | Complete (scoped) | Implemented fail-closed backend checks for unauthenticated database/file IPC, engagement ownership enforcement, protected role-field checks, and unfiltered mutation denial with isolated regression evidence | Continue with T-016 policy decisions for remaining behavior |
| T-016 | P1 | Product decision required | Approve admin/partner/manager/senior/staff/viewer policy, engagement assignment/listing semantics, bulk mutation limits, export access, and evidence approval/lock/reopen transitions | Product owner decisions; T-003 control matrix |
| T-017 | P2 | Ready for investigation | Add missing `engagement_tb_classification` and `ifc_clause_library` definitions to `sqlite/schema` with upgrade evidence; callers currently fail with missing-table errors | Backup/upgrade approach from T-009 |

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
