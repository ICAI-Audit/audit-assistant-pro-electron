# Development guide

## Baseline and environment

Reviewed application source: c0ea50820094952b3bad9c83b45cc00cbff0381c. Package 0.9.1 uses React 18, Vite 5, TypeScript 5, Electron 40, better-sqlite3 12, bcrypt 5 and electron-builder 26 ranges. The supported install line is Node.js 24 LTS with its bundled npm 11. The exact locally validated pair was Node.js 24.12.0 and npm 11.6.2.

The locked `@electron/rebuild` 4.0.3 requires Node >=22.12.0; locked `better-sqlite3` 12.9.0 supports Node 20.x and 22.x through 25.x. Node 24 satisfies both. The release workflow's former Node 18 pin was below the rebuild requirement and Node 18 is EOL; CI now selects Node 24. The exact versions remain pinned by `package-lock.json`; do not run `npm install` as a substitute for the clean install.

Official references: [Node.js release status](https://nodejs.org/en/about/previous-releases), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci), [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), [@electron/rebuild requirements](https://github.com/electron/rebuild#usage), and [node-gyp installation requirements](https://github.com/nodejs/node-gyp#installation).

Electron native modules must match Electron's ABI. `postinstall` runs `electron-rebuild -f -w better-sqlite3,bcrypt`. When a native module must be compiled from source on Windows, node-gyp requires Python and Visual C++ build tools; successful rebuild/load must be verified, not inferred from a Node.js import.

## Commands and observed status

| Purpose | Command | Baseline evidence |
| --- | --- | --- |
| Documentation integrity | npm run docs:check | Executed for this change; results in CURRENT_STATUS.md |
| Refresh source inventory | npm run docs:inventory | Rebuilds inventory; review diff and rerun docs:check |
| Clean dependency installation | npm ci --no-audit --no-fund | Passed twice, in separate clean worktrees, on Node 24.12.0/npm 11.6.2; normal postinstall ran |
| Rebuild native modules | npm run postinstall | Passed during both clean installs; `electron-rebuild` reported Rebuild Complete |
| Electron native smoke test | npm run test:native | Passed on Electron 40.9.1 using an in-memory SQLite database, bcrypt synthetic password, and temporary userData directory |
| Desktop development | npm run electron:dev | Defined; not launched in this review |
| Production renderer build | npm run build | Passed; existing chunk-size, dynamic-import and stale Browserslist warnings remain |
| Run built desktop | npm run electron | Requires dist from build; not executed in this review |
| Static typing | npx tsc -p tsconfig.app.json --noEmit | Executed; currently fails with 114 existing diagnostics across 28 files; tracked separately |
| Lint | npm run lint | Executed; currently reports 515 errors and 101 warnings; tracked separately |
| Tax-audit/library tests | npx vitest run src/lib | Passed: 8 files, 37 tests |
| Classification regression | npm run test:classification | Passed |
| Bulk-update regressions | npm run test:bulk-update | Passed |
| Installer | npm run electron:build:win | Packaging step; not a routine documentation check |

The `npm run test:native` script is a synthetic smoke test, not an installer or application UAT. T-002 also ran the documentation checks, regression test, and Git whitespace checks; the exact results are in SESSION_HANDOFF.md.

## Reproducible installation result

Before edits, a clean-worktree `npm ci --ignore-scripts --no-audit --no-fund` failed with `EUSAGE`: the lock had `@emnapi/wasi-threads` 1.2.2 while the dependency required 1.2.3, and 26 Vitest platform `@esbuild/*` entries were locked at 0.28.1 while 0.28.2 was required. Regenerating only the lock metadata with `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` corrected those stale entries and an `iconv-lite` optional/dev flag. The lock's root dependency metadata did not change; no direct or unrelated dependency version was upgraded.

After that correction, `npm ci --no-audit --no-fund` passed in two separate clean worktrees on Node.js 24.12.0/npm 11.6.2 and ran the normal postinstall both times. npm still emits deprecation notices for existing transitive packages; they were not upgraded as part of this task.

For a second isolated verification on Windows PowerShell, use a fresh checkout/worktree of the commit being tested:

```powershell
git worktree add --detach ..\audit-assistant-pro-electron-clean <commit>
Set-Location ..\audit-assistant-pro-electron-clean
node --version
npm --version
npm ci --no-audit --no-fund
npm run test:native
```

`npm run test:native` launches Electron and tests `better-sqlite3` against `:memory:` and bcrypt against a synthetic password. It temporarily points Electron `userData` to a unique OS temp directory and removes that directory; it does not open the user's application database or evidence files.

## Development sequence after dependencies are restored

1. Inspect Git status and shared instructions. Select one scoped task.
2. Install with the supported toolchain. Confirm postinstall rebuild succeeds for Electron. ODBC may need its native runtime/driver for Tally tests.
3. Use an isolated synthetic user-data profile before launching any code that can create or migrate a database. The current application has no documented dedicated test-profile environment variable; do not invent one. Establish the isolation mechanism in a separate scoped change if required.
4. Start npm run electron:dev. Vite serves port 8080. A Vite browser tab alone lacks the native bridge required by the active SQLite client.
5. Run focused tests, explicit app typecheck, lint as relevant, and renderer build for a code change. Record limitations from legacy failures.
6. Test persistence across restart and engagement switching. Desktop or installer changes need a packaged smoke test on the target OS.

## Release boundary

The release workflow runs on version tags, installs dependencies, builds the renderer, and packages on Windows and macOS using Node 24. package.json publish configuration still names gellavenugopal while the repository is ICAI-Audit. Verify the intended release destination, assets, icons and update feed before any tag or publication. No release was created by T-002. Existing signature-verification claims must be checked against actual build settings, which currently disable Windows update code-signature verification.
