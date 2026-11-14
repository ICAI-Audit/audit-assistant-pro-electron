# Validation and UAT

## Evidence levels

Static inspection proves only the observed code path. Unit tests verify stated behaviours in their harness. An Electron smoke test verifies a running bridge and native runtime. A packaged installer test verifies the produced artefact on the stated machine. Owner UAT verifies agreed business scenarios. None alone establishes professional correctness of all statutory content.

## Select checks by change

| Change | Minimum relevant checks |
| --- | --- |
| Documentation only | npm run docs:check; inspect claims, links and handoff against source |
| Route, schema, IPC or test inventory | npm run docs:inventory; review diff; npm run docs:check |
| Tax-audit rule or builder | Focused Vitest tests, boundary examples, explicit app typecheck and renderer build; professional source review for legal changes |
| Financial calculations or classification | Source-to-output reconciliation, signs and rounding, changed-rule regression, override precedence and export consistency |
| Persistent screen | CRUD, validation failure, save/reopen, engagement switch, forbidden role and stale state |
| Database upgrade | Fresh database and old-version fixtures, idempotence, interruption/recovery, key counts and totals |
| IPC, auth or evidence | Direct backend negative tests plus allowed operations and lock checks |
| Report export | Compare saved inputs, preview and each format; reopen and visually inspect exported pages and tables |
| PDF Tools (T-031) | Unit tests for the PDF functions and the screen logic; the production application test in an isolated profile (`npm run test:pdf-tools-ui`); then a manual run in `npm run electron:dev` and the installed package with synthetic files: every tool and option, each destination, the native save and folder windows (cancel each; choose Desktop, Documents and Downloads themselves and a folder inside them), drag and drop, cancel mid-operation, a protected file, a signed file, a file with form fields, a large scan, mixed page sizes and rotations, a screen-reader pass; open the results in a second PDF reader |
| Electron or packaging | Native rebuild, dev launch, production launch and target-platform installer smoke |

## Application checks and current evidence

Use `npx tsc -p tsconfig.app.json --noEmit` to explicitly check the application source. Root tsconfig uses references; do not assume a root noEmit command proves every referenced project was checked. Use `npx vitest run src/lib` for the existing tax-audit helpers, and select other Vitest-style files as applicable. package.json has no generic npm test command. It also runs the PDF Tools library tests; the PDF Tools screen tests are run with `npx vitest run src/components/pdf-tools`.

Financial Statement Review (T-019): `npm run test:fsg` runs the main-process integration test (Electron main process, in-memory database, synthetic data). `npm run test:fsg-ui` builds the renderer and drives the production app in an isolated profile seeded with an upgrade database, including a restart. Neither touches a real audit_assistant.db. `test:classification` and `test:bulk-update` were removed with the code they tested.

PDF Tools (T-031): `npx vitest run src/lib src/components/pdf-tools` runs the unit tests of `src/lib/pdf-tools` and `src/components/pdf-tools`. Run it from the upper-case path `C:\Users\ASUS\Desktop\audit-assistant-pro-electron`; on that machine vitest finds no tests from the lower-case `c:\` spelling. All test PDFs and images are generated inside the tests. `npm run test:pdf-tools-ui` builds the renderer and drives the production application on a throw-away profile with synthetic data (32 checks: see PDF_TOOLS.md section 9); `PDF_TOOLS_TEST_APP=<path to the packaged ICAI-VERA.exe> node scripts/test-pdf-tools-ui.cjs` runs it against a packaged build. Unset `ELECTRON_RUN_AS_NODE` before any Electron command. The native save and folder windows, Save as ZIP and drag and drop cannot be driven by that test and are checked by hand; it also does not observe the main process's network use. The Split and Delete pages leak tests (`src/lib/pdf-tools/organiseLeaks.test.ts`) search the result's decoded bytes for markers of left-out pages and compare each kept page's pdf.js drawing and text with the source's; results were compared in pdf.js only. Result: see [CURRENT_STATUS.md](CURRENT_STATUS.md#t-031-pdf-tools-phase-1-14-november-2026). Lesson from 14 November 2026: the native folder window is replaced by a stand-in in the automated test, and a real defect (a restricted folder such as Desktop never answering) was found only by the owner's hand check; run the manual native-window checks before calling a save feature verified.

T-002 verified `npm ci --no-audit --no-fund` with normal postinstall twice in separate clean Windows worktrees on Node.js 24.12.0/npm 11.6.2 (historical, before the T-019 dependency additions). `npm run test:native` and `npm run build` passed then. The current application typecheck fails with 76 diagnostics across 18 files and `npm run lint` reports 475 errors and 71 warnings (T-020). These failures are tracked separately in NEXT_TASKS.md. See CURRENT_STATUS.md and SESSION_HANDOFF.md for the complete boundary and exact result classification. Do not conceal existing failures or claim a passing application typecheck/lint. The T-031 dependencies were checked with `npx -y npm@11.6.2 ci --dry-run` and a full clean `npx -y npm@11.6.2 ci` in a scratch copy; see CURRENT_STATUS.md.

Documentation checks: `npm run docs:check` and `node --test scripts/check-project-docs.test.mjs`. They must pass in a fresh checkout; the source inventory tolerates a `tests/` directory that does not exist.

## Synthetic engagement scenarios

- UAT-001: first local user, subsequent staff, incorrect password, inactive account and restart sign-in.
- UAT-002: two clients, years and engagements; switch users and engagements without stale balances, evidence or report data.
- UAT-003: balanced TB with assets, liabilities, income, expenses, stock and negative balances; import, map, override, save, reopen and export. Check total reconciliation and units.
- UAT-004: applicability values below, equal to and above each approved threshold; correct entity and year; saved rationale and manual override where allowed.
- UAT-005: materiality benchmark, performance and trivial levels with reviewed percentages and rounding; reload and export match.
- UAT-006: procedure, evidence upload and review, forbidden edit, failed file write, missing bytes, and reopen. Verify both metadata and file content.
- UAT-007: tax-audit setup, acceptance, representative simple and table clauses, programme, disclaimer, readiness and draft exports; include mismatched AY and missing evidence.
- UAT-008: edited report content appears in preview and exports with correct client, period, signatory and draft status.
- UAT-009: forbidden direct IPC and file operations are rejected. Prove locks on the backend, not only disabled buttons.
- UAT-010: full backup and restore with database, files and required configuration; totals and evidence remain available.
- UAT-011: fresh and upgraded installer, native module loading, restart persistence, test update and safe failure handling.

UAT-009 and UAT-010 describe required acceptance coverage, not currently verified facilities. Misstatements and Completion need implementation before their production scenarios can pass. For every result record feature/task IDs, source commit, installed artefact version, OS and toolchain, fixture identifier, exact action, expected versus actual result, evidence and reviewer. Never store client secrets or confidential records in public test evidence.
