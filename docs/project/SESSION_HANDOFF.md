# Latest session handoff

## Session identity

- Date: 29 October 2026.
- Agent: AI assistant using Copilot SDK in VS Code.
- Requested task: T-003, backend authorization and locking verification.
- Branch: `docs/t003-auth-lock-verification-2026-10-29`, created from published T-002 branch commit `229a098f375050be1c5d4cd45236b5e0ec903325`.
- Application source baseline: `main` at `c0ea50820094952b3bad9c83b45cc00cbff0381c`; T-002 install/toolchain fixes are preserved.
- Local environment: Windows x64, Node.js 24.12.0, npm 11.6.2.
- Current branch HEAD: use `git rev-parse HEAD`; compare with `git ls-remote origin refs/heads/docs/t003-auth-lock-verification-2026-10-29`. Do not embed this handoff's own future commit SHA.

## Scope and boundaries

T-003 is complete as investigation, isolated regression evidence and remediation proposal only. No production authorization rule changed; no finalization behavior was implemented. The T-003 test profile contained only synthetic accounts, two engagements, records and files. No existing client database or evidence path was opened.

T-001 remains partial: automatic repository instruction loading is unverified; a fresh Codex client/version test and Claude client check remain pending. These were non-blocking for T-003. T-002 remains complete with its lock metadata repair, Node 24 workflow and installation evidence.

## Active-path evidence

- The real `electron/main.cjs` registers IPC handlers and creates the window with the real `electron/preload.cjs`.
- The preload exposes SQLite authentication/query, evidence-file and export APIs through `ipcRenderer.invoke`.
- `sqlite-auth` maintains a module-global `currentUserId`; `sqlite-query` does not consult the session, renderer sender, role or `AccessControl`.
- File handlers resolve bucket/path beneath userData storage, but do not consult an authenticated principal or evidence metadata/engagement assignment. Export writes renderer-supplied bytes to the downloads folder.
- `sqlite/access-control.ts` is not imported/called by active main or preload. Even if connected, its role enum omits database roles `admin`, `viewer`, and `user`; evidence-link lookup assumes an `engagement_id` field that the link table does not have; and the helper has no lock/approval-state check.

## Isolation and actual-handler harness

`npm run test:t003-authorization` runs the renderer build, then `node --test scripts/test-t003-authorization.cjs`. The test creates a fresh OS temp root and a temporary Electron app entry. `scripts/t003-electron-entry.cjs` sets and verifies Electron `userData` and downloads paths, checks the database and SQLite sidecars are absent, prints an isolation marker, and only then requires production `electron/main.cjs`. The test waits for the actual preload API and sends all probes through the actual Electron IPC handlers. The first database call initializes the synthetic test DB and startup schema only within the verified temp profile.

Final run evidence:

- The isolation marker was emitted before loading main; the test later confirmed `audit_assistant.db` and WAL files existed only under the temporary userData path, with no application profile selected.
- `npm run test:t003-authorization` built the Vite renderer successfully and exited 1 because expected-denial regression assertions failed. Nineteen behavioral subtests ran: 5 passed setup/observation checks and 14 failed security assertions. Node reports the failed parent suite as an additional failure (20 total, 5 pass, 15 fail).
- The failing assertions demonstrate: an anonymous database read before signup; a staff client update forbidden by the helper policy; database reads after logout; unfiltered cross-engagement procedure reads; forged-ID procedure update and delete across assignments; staff escalation of its own role; indirect A-to-B evidence link access; anonymous `file-get-path`, save, download and delete; and unfiltered bulk update/delete affecting all three synthetic records.
- Positive/observation checks demonstrated a permitted manager update, observed admin-role ambiguity, successful locked/approved evidence writes without a defined policy check, unauthenticated synthetic export limited to the temp downloads directory, and test-profile isolation.
- These failures are intentionally preserved in `scripts/test-t003-authorization.cjs`; do not weaken assertions to make the suite green. The summary and policy classifications are in `docs/project/SECURITY_AND_AUDIT.md`.

## Passed, failed and skipped checks

**Passed**

- `npm ci --no-audit --no-fund`: installed in the new isolated worktree on Node.js 24.12.0/npm 11.6.2; Electron native rebuild completed.
- Vite production renderer build within `npm run test:t003-authorization`: passed. Existing Browserslist, dynamic import/chunk and large chunk warnings remain.
- Five behavioral setup/observation subtests passed as described above; this does not mean authorization passed.
- `npm run docs:inventory`: passed; 31 routes, 9 schema files, 13 test files. The regenerated screen map and JSON inventory matched committed content.
- The first `npm run docs:check` and documentation regression-test attempts detected a stale screen map. After `npm run docs:inventory`, final `npm run docs:check` passed and `node --test scripts/check-project-docs.test.mjs` passed (1 test, 0 failures).
- `npx eslint scripts/t003-electron-entry.cjs scripts/test-t003-authorization.cjs`: passed.
- `node --check` passed for both harness files; package.json parsed as valid JSON.
- `git diff --check`: passed after documentation edits; run `git diff --cached --check` after staging and before commit.

**Failed**

- `npm run test:t003-authorization`: 14 of 19 authorization assertions failed by design; the node:test command exits 1 to preserve the evidence.
- `npx tsc -p tsconfig.app.json --noEmit`: exit 2, 114 existing diagnostics across 28 source files; tracked by T-013.
- `npm run lint`: exit 1, 515 existing errors and 101 warnings; tracked by T-014.

**Skipped / not established**

- No application permission fix, full role/assignment policy, lock-state policy, whole-file finalization, installer, cross-platform test, ODBC/Tally test, real-user profile test, restore test, multi-window identity test, external/untrusted renderer test, or owner UAT was performed.
- Export authorization after logout remains unspecified. Evidence approval/reopen rules and bulk-operation limits remain product decisions.

## Changed paths and task state

Scoped changes: `package.json` adds `test:t003-authorization`; `scripts/t003-electron-entry.cjs` provides pre-import profile isolation; `scripts/test-t003-authorization.cjs` invokes the production renderer bridge and preserves failing regressions; `docs/project/CURRENT_STATUS.md`, `NEXT_TASKS.md`, `SECURITY_AND_AUDIT.md`, `FEATURE_REGISTER.md`, and this handoff record evidence and the remediation proposal.

T-003 is complete as verification only. T-015 proposes the first separately authorized remediation: fail closed for unauthenticated database/file IPC and bind the principal to the invoking renderer, retaining explicit signup/login access. T-016 captures required role, engagement, bulk, export and evidence-state policy decisions. T-007 whole-file finalization remains separate. No production rule change, merge or release occurred.

## Next executable activity

Review the T-003 control matrix and decide whether to authorize T-015. Before implementing broader role/engagement checks, obtain the decisions listed in T-016. Continue to treat unauthenticated and cross-engagement IPC as a blocker to relying on current UI access guards. Keep all regression fixtures synthetic and run the test harness only in its temporary profile.
