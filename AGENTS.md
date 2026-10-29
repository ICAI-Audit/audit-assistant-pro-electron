# ICAI VERA project instructions

The [.agents index](.agents/README.md) points to the same maintained project workflows.

## Start every session

1. Read [project index](docs/project/README.md), [product context](docs/project/PRODUCT_CONTEXT.md), [current status](docs/project/CURRENT_STATUS.md), [next tasks](docs/project/NEXT_TASKS.md), and [latest handoff](docs/project/SESSION_HANDOFF.md).
2. Run `git status --short`, `git branch --show-current`, and `git log -5 --oneline`. Preserve existing work. Compare the checkout with the source baseline in the status document; investigate changed areas before relying on old conclusions.
3. State the requested outcome, binding constraints, affected feature IDs, selected task ID, and validation approach. Explicit user instructions for this session govern its scope. A recommended backlog item is not approval to build it.
4. Read the applicable workflow from [workflow index](docs/project/SKILLS_INDEX.md), then the relevant implementation and tests. Do not load every historical document into context.

## Application facts and boundaries

- ICAI VERA is an Electron desktop audit-assistance application. The active main process is `electron/main.cjs`; the active bridge is `electron/preload.cjs`. The `.js` siblings are not the selected package entry points.
- React and Vite render the UI. `src/integrations/sqlite/client.ts` proxies through IPC to local SQLite. Supabase-compatible method names and remaining files do not establish a Supabase production backend.
- The database is `audit_assistant.db` under Electron `userData`; evidence files are stored under its `files` directory. Renderer localStorage also holds some configuration and engagement data. Never claim a database-only backup is complete.
- `src/App.tsx` maps both `/trial-balance` and `/financial-review` to `FinancialReview`. Inspect this active path before editing the legacy TrialBalance page.
- Some routed screens use sample data. A route, table, button, or passing build alone does not prove a feature works. Use the status vocabulary in the feature register.
- Preserve source ledger values, signs, classification identifiers, periods, and engagement boundaries. Record user overrides and their basis. Do not change a financial or legal rule merely to make a test pass.
- Tax-audit content is tagged AY 2025-26 in code. Verify authoritative sources and effective dates before changing legal logic. A draft export is not evidence of portal acceptance or professional approval.
- The offline Phase I scope and broader AI/web blueprint conflict. Record unresolved decisions; do not silently expand scope, add an AI provider, or send client data externally.

## Work and validation

- Reuse existing components and inspect main-process enforcement for permissions and locks. Renderer controls are not sufficient authorization.
- Use synthetic or authorised anonymised data. Do not commit credentials, client records, database files, evidence, session tokens, or private chat transcripts.
- Do not reset an existing database to fix a schema problem. Changes need upgrade, backup, restore, and failure-recovery evidence.
- Run `npm run docs:check` for documentation changes. Use [testing guide](docs/project/TESTING.md) for code changes. Report failed and skipped checks separately from passed checks.
- Installation currently has a recorded lockfile failure. Do not describe installation, native modules, or packaged launch as validated until a fresh run proves it.
- Before closing a task, update the feature register if behaviour changed, current status, task state, and latest handoff. Record decisions and their approval source when applicable. Keep updates in the same reviewable change as the implementation.
- Preserve historical documents; add a warning and authoritative link when superseding guidance. Do not treat an old completion report as current verification.

## End every session

Record branch, base/source commit, changed paths, completed work, exact checks and outcomes, unresolved failures, uncommitted work, and the first executable next step in [latest handoff](docs/project/SESSION_HANDOFF.md). Link supporting evidence. Never mark UAT accepted without the product owner's recorded acceptance.
