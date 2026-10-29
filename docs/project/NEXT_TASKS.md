# Next tasks

These are recommended tasks derived from the review. They do not grant approval to expand product scope or change professional rules. A new user instruction may select a different task. Record active work here and retain completed task IDs with evidence.

| ID | Priority | Status | Outcome | Dependencies |
| --- | --- | --- | --- | --- |
| T-001 | P1 | Partial verification | This fresh VS Code assistant session retrieved the shared product, data-path, feature-gap, task, and next-step facts; automatic loading and fresh Codex/Claude sessions remain unverified | This documentation change available in the checkout |
| T-002 | P1 | Ready for scoped implementation | Reproducible dependency installation and supported toolchain | None; preserve package and lock provenance |
| T-003 | P1 | Ready for investigation | Verify and specify backend authorization and locking | Isolated executable environment for runtime tests |
| T-004 | P1 | Decision required | Confirm release scope and deployment model | Product owner decisions D-001 to D-004 |
| T-005 | P2 | Ready for analysis | Detailed requirements-to-code coverage and UAT matrix | T-004 for acceptance boundaries |
| T-006 | P2 | Proposed implementation | Persist misstatements and connect real materiality | Confirm workflow and permissions; T-003 |
| T-007 | P2 | Design required | Durable completion and file finalization | T-003, T-006 and approved sign-off rules |
| T-008 | P2 | Ready for verification | Validate tax-audit content and draft exports | Reproducible environment and authoritative legal review |
| T-009 | P2 | Ready for investigation | Verified backup, restore and migration safety | Approved data retention and recovery requirements |
| T-010 | P2 | Ready for verification | Target-platform installer and updater smoke evidence | T-002; release destination and signing decision |
| T-012 | P2 | Ready for scoped correction | Resolve duplicate feedback route and document intended guard | Confirm route access policy |
| T-011 | P3 | Scope decision required | AI and knowledge integration specification | T-004; provider, privacy and evaluation approval |

## T-001 Session continuity

Open the same documentation branch from the repository root in each installed coding client. Start a fresh session using START_HERE.md. Ask it to identify product, active database path, sample screens, current install failure, selected task and next executable step. Require it to name the files it actually read. Do not provide those answers in the prompt. Verify settings permit repository instructions, and capture client version and loaded files. Read-only verification must not invent a new implementation task. A structural docs check is not a substitute for this test. Accept when all clients recover the same facts and close a small authorised change with an updated handoff.

## T-002 Reproducible install

Inspect package.json, package-lock.json and the release workflow. Select and document supported Node/npm versions based on package engine requirements and target Electron tooling. Reproduce the lock failure. Correct only justified lock/dependency discrepancies, review resolution changes and native ABI implications, then demonstrate npm ci from a clean checkout with normal postinstall. Run tax-audit tests, legacy regressions, explicit app typecheck, lint and renderer build. Record existing failures separately. Accept when a second clean install succeeds with the documented toolchain and native modules load in Electron. Do not upgrade unrelated packages to make the task larger.

## T-003 Authorization and locks

Trace sqlite-query and file handlers in active main.cjs, then compare sqlite/access-control.ts. Build synthetic admin, manager and staff users and two engagements with distinct assignments. Test unauthenticated access, cross-engagement reads and writes, indirect evidence links, role changes, forged identifiers, bulk update/delete without filters, and writes to locked records. Record which restrictions are required versus already enforced. Inspect table/column/action validation and return-field exposure. Produce failing regression evidence before a scoped fix. Accept only when forbidden actions are rejected by the main process and permitted work still succeeds. Never use real engagement data for these tests.

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
