# Current status

## Snapshot

- Review date: 29 October 2026.
- Source repository: ICAI-Audit/audit-assistant-pro-electron.
- Source branch and base commit: `main`, `c0ea50820094952b3bad9c83b45cc00cbff0381c`.
- Application package version: 0.9.1.
- Documentation branch: `docs/t003-auth-lock-verification-2026-10-29`, based on published T-002 commit `229a098f375050be1c5d4cd45236b5e0ec903325`.
- Documentation branch HEAD: resolve with Git (`git rev-parse HEAD`); do not copy a commit's own SHA into its self-updating handoff.
- Local validation environment: Node.js 24.12.0 and npm 11.6.2.
- Scope: T-003 active-main-process authorization and locking verification with synthetic data; isolated Electron IPC regression harness; control matrix and remediation proposal. No production authorization or finalization rules were changed.

## What is established

Static inspection identified Electron main.cjs and preload.cjs as active entry points, local SQLite through IPC, multiple TB schema families, local evidence storage, retained renderer localStorage, report drafting/export code, and tax-audit content tagged AY 2025-26. Misstatements and Completion are sample-driven prototypes. The feature register distinguishes these states.

The shared project record now contains scope, architecture, data ownership, features, route map, decisions, development and test procedures, source governance, ranked next tasks and handoff. Copilot and Claude have small adapters to the same AGENTS.md. Portable workflows cover session continuity, changes, financial rules, statutory content, database upgrades, security review, export review and desktop validation.

T-001 remains partial: the current Copilot SDK assistant manually read project records, but automatic repository-instruction loading is unverified. A fresh Codex session and Claude client check remain pending and are non-blocking for T-002 and T-003.

T-002 remains complete within its documented installation/toolchain scope. Its lockfile repair, Node 24 workflow and two clean install/native smoke runs are retained on this branch.

## T-002 validation evidence

The pre-change clean install failure was reproduced in a clean worktree on Windows x64 with Node.js 24.12.0/npm 11.6.2 using `npm ci --ignore-scripts --no-audit --no-fund`. npm returned EUSAGE because the lockfile had stale `@emnapi/wasi-threads` and 26 Vitest platform `@esbuild/*` entries. A lock-only regeneration corrected the stale metadata and `iconv-lite` optional/dev flag; direct dependency versions and root dependency metadata did not change.

**Passed**

- `npm ci --no-audit --no-fund` with normal postinstall, in two separate clean worktrees on Windows x64, Node.js 24.12.0/npm 11.6.2. Electron native rebuild completed both times.
- `npm run test:native` in each install: Electron loaded `better-sqlite3` against `:memory:` and bcrypt processed a synthetic password using a unique temporary Electron userData directory. No existing client database or evidence files were opened.
- `npx vitest run src/lib`: 8 files, 37 tests passed.
- `npm run test:classification`: passed.
- `npm run test:bulk-update`: passed.
- `npm run build`: passed with existing Browserslist, dynamic-import/chunk, and large-chunk warnings.
- `npm run docs:inventory`: passed; refreshed and reported 31 routes, 9 schema files, and 13 test files. Generated diff was reviewed.
- `npm run docs:check`: passed; 31 required documents, local links, shared adapters, and source inventory.
- `node --test scripts/check-project-docs.test.mjs`: 1 test passed, 0 failures.
- `git diff --check`: passed. The staged-diff check is required before commit.

**Failed**

- `npx tsc -p tsconfig.app.json --noEmit`: 114 diagnostics across 28 files. Application source was not changed; follow-up task T-013 tracks triage.
- `npm run lint`: 515 errors and 101 warnings. Application source was not changed; follow-up task T-014 tracks triage.

**Skipped / not established**

- Development and production Electron launch, installer/package build, ODBC/Tally integration, cross-platform installation, restart persistence, and owner UAT were not run. Native smoke success does not establish these behaviors.
- npm emitted deprecation notices for existing transitive packages; they were not upgraded.

## T-003 authorization and locking evidence

The test harness launches the real Electron production `main.cjs` and `preload.cjs` in a newly-created OS temporary profile. `scripts/t003-electron-entry.cjs` sets and verifies `app.getPath('userData')` and the isolated downloads directory, asserts the database and SQLite sidecars do not exist, prints an isolation marker, and only then requires `electron/main.cjs`. The main process opens the test database and runs its normal schema initialization only after the first actual auth/query IPC call. Synthetic admin, manager and staff accounts, two engagements, assignments, procedures, evidence rows, an indirect cross-engagement link and files are used. No existing application profile or client data is loaded.

The run used the actual preload bridge and registered main-process handlers. The render-side API was available, the synthetic test database was created under the verified temporary userData path, and the runner cleaned that profile after the run. `npm run test:t003-authorization` includes the renderer build. Its 19 behavioral subtests produced 5 passing setup/observation checks and 14 failing security assertions; Node also marks the containing suite failed, so its summary reports 15 failures of 20 tests. These are preserved regression failures, not suppressed or treated as a successful security suite.

**Demonstrated enforcement gaps**

- `sqlite-query` returned all two engagements before login and after logout. Manager and staff calls both updated a client; staff changed its own `user_roles.role` to `partner`.
- Staff assigned only to engagement A selected both engagements' procedures, updated a procedure in B by its ID, and followed a link from an A procedure to B evidence. A manager assigned only to A deleted a B procedure by ID.
- Manager unfiltered update changed three synthetic procedure rows, and unfiltered delete removed all three.
- All four evidence file IPC operations were available without a session: path lookup, save, download and delete. The path was under the isolated userData root but was not checked against evidence metadata or engagement assignment.

The separate `sqlite/access-control.ts` helper is not imported or called by `electron/main.cjs` or `electron/preload.cjs`. Even wiring it directly would not fully address the gap: its role union omits the database's `admin`/`viewer`/`user` roles; `evidence_links` has no `engagement_id`, while its record resolver looks only for that column and returns null on failure; result filtering omits `evidence_links`. It also does not enforce evidence `locked` or `approval_stage` fields.

**Observed, but policy unresolved**

- The first `admin` account updated a client successfully, but the helper has no `admin` role definition, so no approved admin-vs-partner policy can be inferred.
- Writes to `locked=1` and `approval_stage='approved'` evidence records succeeded for an assigned manager. The implementation gap is demonstrated; who may approve, reopen or unlock and whether each stage is immutable require a product decision. Whole-file finalization remains T-007.
- Exporting a synthetic file while logged out succeeded and wrote only to the temporary downloads folder. Permission and post-logout export policy are not specified.
- The security contract requires bulk-operation rules and affected-row limits, but no approved bulk policy exists. Tests preserve fail-closed assertions while the observed unfiltered operations changed/deleted all three synthetic records.

The complete case-by-case matrix and prioritised remediation proposal are in SECURITY_AND_AUDIT.md.

**Baseline checks rerun**

- `npm ci --no-audit --no-fund`: passed on Node.js 24.12.0/npm 11.6.2; Electron native rebuild completed.
- Vite production renderer build: passed; existing stale Browserslist, dynamic import/chunk, and large chunk warnings remain.
- `npx tsc -p tsconfig.app.json --noEmit`: failed with 114 existing diagnostics across 28 files; tracked by T-013.
- `npm run lint`: failed with 515 existing errors and 101 warnings; tracked by T-014.
- `npm run docs:inventory`: passed; 31 routes, 9 schema files, 13 test files; refreshed outputs matched committed content.
- `npm run docs:check`: passed for 31 required documents, local links, shared adapters and source inventory.
- `node --test scripts/check-project-docs.test.mjs`: 1 passed, 0 failed.
- `npx eslint scripts/t003-electron-entry.cjs scripts/test-t003-authorization.cjs`: passed.
- `node --check` for both harness files and package.json JSON parsing: passed.
- `git diff --check`: passed; staged-diff check remains before commit.

## Blocking or material gaps

1. Main-process database and evidence file IPC currently permit unauthenticated, cross-engagement reads and writes. Do not rely on UI guards for client-data boundaries.
2. Role mapping, assignment semantics, bulk-write limits, export access and evidence-state transitions need product decisions before their authorization rules are implemented.
3. TypeScript and lint baselines fail as detailed above; resolve separately.
4. Misstatements and Completion are prototypes despite being routed screens. T-007 must define and implement whole-file finalization separately.
5. Complete backup, restore and audit-trail integrity remain unverified.
6. Tax-audit current-law verification for a new assessment year is outstanding.
7. Release destination and target-platform installer/update evidence remain unverified.

## First next activity

The first recommended remediation is to fail closed for unauthenticated database and evidence-file IPC calls, bind the authenticated principal to the invoking renderer, and preserve explicit signup/login access. Follow with approved role/engagement rules, safe table/action/field controls, indirect evidence ownership, and deny-by-default unfiltered writes. T-003 delivered verification and proposal only; implementation requires a separate task authorization. Keep evidence-state transitions separate from T-007 whole-file finalization.

## Review and publication state

The user authorised publishing the T-003 scoped tests and documentation to the public repository. Verify the branch push and remote HEAD with Git; do not embed a commit's own future SHA here. No production permission change, merge, or release was authorised by T-003.
