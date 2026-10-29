# Development guide

## Baseline and environment

Reviewed source: c0ea50820094952b3bad9c83b45cc00cbff0381c. Package 0.9.1 uses React 18, Vite 5, TypeScript 5, Electron 40, better-sqlite3 12, bcrypt 5 and electron-builder 26 ranges. Inspect package-lock.json for exact resolutions. The release workflow selects Node 18; this does not establish compatibility with every current dependency. A supported Node/npm matrix remains a task.

The documentation tooling uses only Node built-ins and needs no dependency installation. Node 24.22.1 and npm 11.9.0 were available during this review. No supported desktop runtime matrix is claimed from that environment.

## Commands and observed status

| Purpose | Command | Baseline evidence |
| --- | --- | --- |
| Documentation integrity | npm run docs:check | Executed for this change; results in CURRENT_STATUS.md |
| Refresh source inventory | npm run docs:inventory | Rebuilds inventory; review diff and rerun docs:check |
| Dependency installation | npm ci | Normal command; review used the following safer diagnostic instead |
| Install diagnostic without lifecycle scripts | npm ci --ignore-scripts --no-audit --no-fund | Failed on package/lock mismatch under npm 11.9.0 |
| Rebuild native modules | npx electron-rebuild -f -w better-sqlite3,bcrypt | Defined in postinstall; not executed in this review |
| Desktop development | npm run electron:dev | Defined; not launched in this review |
| Production renderer build | npm run build | Defined; not executed in this review |
| Run built desktop | npm run electron | Requires dist from build; not executed in this review |
| Static typing | npx tsc -p tsconfig.app.json --noEmit | Explicit app config avoids claiming root project-reference invocation checks all source |
| Lint | npm run lint | Defined; not executed in this review |
| Tax-audit tests | npx vitest run src/lib | Existing tests; requires installed dependencies |
| Legacy regressions | npm run test:classification; npm run test:bulk-update | Custom script tests; validate runner compatibility before claiming success |
| Installer | npm run electron:build:win | Packaging step; not a routine documentation check |

## Installation failure

The clean-install diagnostic reported missing @emnapi/runtime and @emnapi/core 1.11.3, a wasi-threads resolution mismatch, and missing encoding and iconv-lite entries. This is an observed dependency/lockfile issue, not proof of an application logic defect. Do not replace npm ci with an undocumented npm install or silently rewrite the lockfile in unrelated work. Resolve in task T-002 using the agreed Node/npm version, review the lock diff, then test a clean install.

## Development sequence after dependencies are restored

1. Inspect Git status and shared instructions. Select one scoped task.
2. Install with the supported toolchain. Confirm postinstall rebuild succeeds for Electron. ODBC may need its native runtime/driver for Tally tests.
3. Use an isolated synthetic user-data profile before launching any code that can create or migrate a database. The current application has no documented dedicated test-profile environment variable; do not invent one. Establish the isolation mechanism in a separate scoped change if required.
4. Start npm run electron:dev. Vite serves port 8080. A Vite browser tab alone lacks the native bridge required by the active SQLite client.
5. Run focused tests, explicit app typecheck, lint as relevant, and renderer build for a code change. Record limitations from legacy failures.
6. Test persistence across restart and engagement switching. Desktop or installer changes need a packaged smoke test on the target OS.

## Release boundary

The release workflow runs on version tags, installs dependencies, builds the renderer, and packages on Windows and macOS. package.json publish configuration still names gellavenugopal while the repository is ICAI-Audit. Verify the intended release destination, assets, icons and update feed before any tag or publication. No release was created by this documentation task. Existing signature-verification claims must be checked against actual build settings, which currently disable Windows update code-signature verification.
