# Latest session handoff

## Session identity

- Date: 29 October 2026.
- Agent: AI assistant using Copilot SDK in VS Code.
- Requested task: T-002, reproducible installation and supported toolchain.
- Branch: `docs/t002-reproducible-install-2026-10-29`, created separately from the published T-001 documentation branch.
- Source/base application commit: `main` at `c0ea50820094952b3bad9c83b45cc00cbff0381c`.
- Application package version: 0.9.1.
- Verified local toolchain: Windows x64, Node.js 24.12.0, npm 11.6.2.
- Current branch HEAD: use `git rev-parse HEAD`; compare with `git ls-remote origin refs/heads/docs/t002-reproducible-install-2026-10-29`. This handoff intentionally does not embed its own commit SHA.

## T-001 status and client evidence

T-001 remains **partial**. Its remaining client checks are non-blocking for T-002.

- This assistant explicitly read AGENTS.md and the requested project records. That is manual reading, not evidence of automatic repository-instruction loading.
- VS Code evidence recorded for T-001: version 1.143.1 (`e646868227c3e3a9e3f24277c8c7220be42c0be7`, x64). The installed extension list included `openai.chatgpt@26.1021.22027`, `openai.codex-audio@26.1021.22027`, and `anthropic.claude-code@2.1.312`; installed extensions do not identify which client hosted the assistant.
- No standalone Codex executable or direct Codex client version/session evidence was available. Automatic instruction loading is unverified.
- Claude was not exercised; its check remains pending.

## T-002 findings and changes

Before editing, `npm ci --ignore-scripts --no-audit --no-fund` was run in a clean worktree and reproduced npm EUSAGE. The lockfile had `@emnapi/wasi-threads` 1.2.2 while 1.2.3 was required, and 26 Vitest optional platform `@esbuild/*` entries at 0.28.1 while 0.28.2 was required.

The lock metadata was regenerated with `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Review found stale platform entries, the emnapi mismatch, and an `iconv-lite` optional/dev flag change. Root dependency metadata and direct dependency versions did not change. The release workflow was updated from Node 18 to Node 24 because the locked `@electron/rebuild` requires Node >=22.12.0 and Node 18 is EOL. The locked `better-sqlite3` supports Node 20.x and 22.x–25.x. `package.json` adds only the `test:native` script; the script uses synthetic inputs and a temporary Electron profile.

The earlier installation fix is committed on this branch. This task's final documentation change is limited to project guidance, status, task tracking and handoff. No application source behavior or direct dependency version was changed.

## Validation results

**Passed**

- `npm ci --no-audit --no-fund`, with normal postinstall, in two separate clean worktrees on Windows x64 with Node.js 24.12.0/npm 11.6.2. Electron rebuild completed in both.
- `npm run test:native` after both installs. Electron loaded SQLite using `:memory:` and bcrypt processed a synthetic password; Electron used a unique temporary userData directory. Existing client databases and evidence files were not accessed.
- `npx vitest run src/lib`: 8 files and 37 tests passed.
- `npm run test:classification`: passed.
- `npm run test:bulk-update`: passed.
- `npm run build`: passed; existing stale Browserslist, dynamic-import/chunk, and large-chunk warnings remain.
- `npm run docs:inventory`: passed; refreshed and reported 31 routes, 9 schema files, and 13 test files. Generated diff was reviewed.
- `npm run docs:check`: passed.
- `node --test scripts/check-project-docs.test.mjs`: 1 test passed, 0 failures.
- `git diff --check`: passed. Run `git diff --cached --check` after staging and before commit.

**Failed**

- `npx tsc -p tsconfig.app.json --noEmit`: 114 diagnostics across 28 files. Tracked as T-013; no application source was changed.
- `npm run lint`: 515 errors and 101 warnings. Tracked as T-014; no application source was changed.

**Skipped / not established**

- Electron development and production launch, installer/package build, ODBC/Tally integration, cross-platform installation, restart persistence, and owner UAT were not tested.
- npm reported existing transitive deprecations; unrelated package upgrades were out of scope.

## Changed records and task state

The branch contains the install/toolchain fix and native smoke-test harness, plus updated records in AGENTS.md, README.md, START_HERE.md, DEVELOPMENT_GUIDE.md, CURRENT_STATUS.md, NEXT_TASKS.md, SESSION_HANDOFF.md, DECISIONS.md, DOCUMENTATION_AUDIT.md, FEATURE_REGISTER.md, TESTING.md, and the desktop-validation workflow.

T-002 is complete within its documented scope. T-001 remains partial. T-003 was not started. T-013 and T-014 capture the existing typecheck and lint failures. No merge, release, installer publication, or application behavior change was performed.

## Next recommended activity

T-003 is the next recommended application task: verify backend authorization and locking using synthetic users and engagements before relying on role or engagement restrictions. Start it only with an explicit task request. The pending Codex instruction-loading and Claude checks remain available to complete T-001 independently.
