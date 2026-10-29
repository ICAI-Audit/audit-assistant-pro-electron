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
| Electron or packaging | Native rebuild, dev launch, production launch and target-platform installer smoke |

## Application commands after install is restored

Use `npx tsc -p tsconfig.app.json --noEmit` to explicitly check the application source. Root tsconfig uses references; do not assume a root noEmit command proves every referenced project was checked. Use `npx vitest run src/lib` for the existing tax-audit helpers, and select other Vitest-style files as applicable. tests/classificationRules.test.ts and the bulk-update scripts are custom runners, not automatically Vitest suites. package.json has no generic npm test command. Validate the existing ts-node commands under the supported ESM toolchain rather than claiming they pass by inspection.

The review could not execute application checks because the clean dependency install failed. Do not turn a dependency or toolchain failure into an application test pass, and do not conceal an existing failure in a documentation update.

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
