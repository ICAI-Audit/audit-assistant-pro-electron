# Verification evidence and limits

The review baseline is `cc5c04729604fba7d05240a07f24682e0644665c`, 30 October 2026. Separate source inspection, earlier reported execution, this documentation session's checks and owner acceptance. A test count has meaning only with the command, commit, environment and boundary.

| Evidence ID | Result and origin | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| EV-01 | Source checkout at cc5c0472 and static module/data inspection in this documentation pass | Named files, workflow paths, declarations and documented gaps at the pinned baseline | Running UI or installed client-data behaviour |
| EV-02 | T-002 VS Code reported two clean Windows x64 installs on Node 24.12.0/npm 11.6.2 with native rebuild | Reproducible installation in those recorded conditions | All platforms, every future dependency resolution or installer compatibility |
| EV-03 | Native smoke reported passing with in-memory SQLite/synthetic bcrypt/temporary Electron userData | Native module load and small synthetic operations | Full app launch, existing database upgrade, ODBC or recovery |
| EV-04 | VS Code reported tax helper suite: 8 files, 37 tests; classification/bulk helper tests and renderer build passing | Covered helper calculations and build boundary | Every formula, legal rule, screen or output format |
| EV-05 | Latest VS Code reported 26/26 Electron authorization cases after failing-before regressions | The exercised production preload/IPC scenarios with synthetic users/data | Real renderer upload/import, complete policy, multi-window or untrusted-renderer protection |
| EV-06 | VS Code reported existing typecheck failure: 114 diagnostics / 28 files; lint: 515 errors / 101 warnings | Known recorded quality baseline | New work is exempt from avoiding regressions |
| EV-07 | Prior structural docs checker passed; this pass reruns it and checks new-document links/coverage | File/link/inventory consistency within the check's scope | Correct professional judgement, automatic native skill loading or product completeness |
| EV-08 | Manual shared-context recovery in a VS Code Copilot SDK session | A prompted assistant could reconstruct project facts from documents | Automatic loading in actual Codex/Claude clients |
| EV-09 | No owner UAT acceptance recorded for this review | Acceptance remains to be performed and recorded | Permission to mark any feature signed off |

## Documentation-only execution in this pass

This session parses the nine declared SQLite schema files in memory to generate the 78-table/1,055-column catalogue. It does not import production Electron main code or open userData. It extracts literal caller/field definitions and validates source links, feature/requirement mapping and document structure. New application tests, install, typecheck, lint, renderer build, security remediation, migration and UI launch are outside scope. Exact final documentation check results are recorded in CURRENT_STATUS.md and SESSION_HANDOFF.md after execution.

## Acceptance evidence to collect later

Use each module's AC identifiers. Record source/build, environment, fixture, action, expected/actual result, supporting output and reviewer/date. An owner’s review of the specification can approve intended behaviour without asserting that the application already performs it. Statutory content requires a named professional review of source, period and interpretation.

## Documentation pass outcome

Documentation-only checks completed on Node.js 24.22.1: `node scripts/check-project-docs.mjs` passed, and `node --test scripts/check-project-docs.test.mjs` passed one regression test with zero failures. Additional review validation passed for 61 Markdown files, 617 local links, all 28 feature IDs, 19 module sections, 35 traced source statements, 60 unique proposed acceptance cases and 16 owner review groups. Source anchors exist and all 46 changed paths are Markdown or documentation JSON. `git diff --check` passed; staged/final diff is checked at commit. No application tests or legal review were rerun.
