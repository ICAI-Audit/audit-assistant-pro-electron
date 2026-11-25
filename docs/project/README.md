# ICAI VERA project knowledge

This directory is the shared project record for developers, Copilot, Codex, and Claude. It separates observed implementation from approved requirements and proposed work. Latest documentation review: 30 October 2026, source commit `cc5c04729604fba7d05240a07f24682e0644665c`, package version `0.9.1`. The original source/inventory baseline remains identifiable in historical records.

## Owner review

Start with [the review guide](REVIEW_START_HERE.md) and [the assembled application review](APPLICATION_REVIEW.md). The current task is documentation completion and owner review. All 28 feature areas are mapped to 19 detailed modules (start at the [module index](MODULE_INDEX.md), then `modules/M-01.md` to `modules/M-19.md`); the [coverage matrix](MODULE_COVERAGE_MATRIX.md), [requirements traceability](REQUIREMENTS_TRACEABILITY.md), [field catalogue](SCHEMA_FIELD_CATALOG.md), [open gaps](OPEN_GAPS.md) and [owner decisions](OWNER_REVIEW_DECISIONS.md) supply the detail.

## Read first

1. [Product context](PRODUCT_CONTEXT.md) describes purpose, scope, and unresolved boundaries.
2. [Current status](CURRENT_STATUS.md) states what was actually inspected and tested.
3. [Next tasks](NEXT_TASKS.md) gives ordered work with acceptance criteria.
4. [Latest handoff](SESSION_HANDOFF.md) tells the next session where to resume.
5. [Workflow index](SKILLS_INDEX.md) selects repeatable procedures for the task.
6. [Handover checklist](HANDOVER_CHECKLIST.md) classifies every module (working, partial, placeholder, disconnected) with owner decisions.

## Find the detail

| Subject | Authoritative project record |
| --- | --- |
| Agent workspace index | [Agent index](../../.agents/README.md) |
| Product capabilities and gaps | [Feature register](FEATURE_REGISTER.md) |
| Entry points and data flow | [Architecture](ARCHITECTURE.md) |
| Tables and persistence ownership | [Data model](DATA_MODEL.md) |
| Trial balance, mapping and financial statements (T-019) | [Financial Statement Review](FINANCIAL_STATEMENT_REVIEW.md) |
| Ledger analysis and live Tally day book (T-033) | [Ledger Analysis](LEDGER_ANALYSIS.md) |
| Tax Audit Form No. 26 (T-067, F-032): how the form is chosen, the workspace, outputs, conversion and limits | [Module M-14](modules/M-14.md#form-no-26-t-067-23-november-2026) and the [feature register](FEATURE_REGISTER.md) |
| Tax Audit Form No. 26: points awaiting the domain team's review (T-067, D-014) | [Form 26 domain review](TAX_AUDIT_FORM26_DOMAIN_REVIEW.md) |
| Screens and guards | [Screen map](SCREEN_MAP.md) |
| Setup and commands | [Development guide](DEVELOPMENT_GUIDE.md) |
| Check selection and UAT | [Testing guide](TESTING.md) |
| Security and evidence controls | [Security and audit](SECURITY_AND_AUDIT.md) |
| Scope decisions | [Decision register](DECISIONS.md) |
| Legal content and document provenance | [Source and rule register](SOURCES_AND_RULES.md) |
| Documentation defects and resolution | [Documentation audit](DOCUMENTATION_AUDIT.md) |
| Machine-checkable source inventory | [Inventory](inventory.json) |
| New task specification | [Task template](templates/TASK.md) |
| Session closeout | [Handoff template](templates/HANDOFF.md) |

## Maintain one source

The user supplies intent and approvals. Code establishes current behaviour, including defects. Product documents establish intended behaviour only where the decision is supported. Never use existing code as proof that a scope expansion was approved. When intent and behaviour differ, record both and create a task. New explicit user decisions supersede older decisions only within the stated scope.

Root AGENTS.md contains shared working rules. CLAUDE.md and the Copilot instruction file are small adapters. Workflows live here as portable Markdown runbooks; their use does not depend on automatic native skill discovery. They are not installed personal ChatGPT skills.

Run `npm run docs:check` before closing a change. If routes, schema declarations, main-process channels, or tests change, refresh `npm run docs:inventory` and review the resulting diff. Refreshing metadata does not verify functionality.

## Historical material

Existing AboutApplication.md, USER_GUIDE.md, updater guides, and archived development reports remain useful historical references. They do not override this baseline where they conflict. The financial-statements architecture document includes design references that require revalidation against current files. Tax-audit pilot limitations have been superseded in part by draft export code. See the documentation audit before reusing their claims.

### Historical documents in `docs/`

Fifteen documents in `docs/` are kept as history (T-066, 21 November 2026). Each carries a banner in its first line. None is moved, renamed or deleted, and none describes the application as it is now.

| File | Area | What replaces it |
| --- | --- | --- |
| [`AUTO_UPDATER_IMPLEMENTATION.md`](../AUTO_UPDATER_IMPLEMENTATION.md) | Updater | [Architecture](ARCHITECTURE.md), [module M-17](modules/M-17.md) and [current status](CURRENT_STATUS.md) |
| [`AUTO_UPDATER_QUICK_REFERENCE.md`](../AUTO_UPDATER_QUICK_REFERENCE.md) | Updater | [Architecture](ARCHITECTURE.md), [module M-17](modules/M-17.md) and [current status](CURRENT_STATUS.md) |
| [`AUTO_UPDATER_SETUP.md`](../AUTO_UPDATER_SETUP.md) | Updater | [Architecture](ARCHITECTURE.md), [module M-17](modules/M-17.md) and [current status](CURRENT_STATUS.md) |
| [`AUTO_UPDATER_SUMMARY.md`](../AUTO_UPDATER_SUMMARY.md) | Updater | [Architecture](ARCHITECTURE.md), [module M-17](modules/M-17.md) and [current status](CURRENT_STATUS.md) |
| [`FILE_REFERENCE.md`](../FILE_REFERENCE.md) | Updater | [Architecture](ARCHITECTURE.md), [module M-17](modules/M-17.md) and [current status](CURRENT_STATUS.md) |
| [`IMPLEMENTATION_CHECKLIST.md`](../IMPLEMENTATION_CHECKLIST.md) | Updater | [Architecture](ARCHITECTURE.md), [module M-17](modules/M-17.md) and [current status](CURRENT_STATUS.md) |
| [`IMPLEMENTATION_COMPLETE.md`](../IMPLEMENTATION_COMPLETE.md) | Updater | [Architecture](ARCHITECTURE.md), [module M-17](modules/M-17.md) and [current status](CURRENT_STATUS.md) |
| [`UPDATER_START_HERE_LEGACY.md`](../UPDATER_START_HERE_LEGACY.md) | Updater (the old start page) | This index and [current status](CURRENT_STATUS.md) |
| [`RUN_MIGRATION.md`](../RUN_MIGRATION.md) | Database migration of the Supabase period | [Data model](DATA_MODEL.md) and [current status](CURRENT_STATUS.md); its helper scripts were removed in T-020 |
| [`tax-audit-beta-pilot-checklist.md`](../tax-audit-beta-pilot-checklist.md) | Tax Audit beta of June 2026 | [Module M-14](modules/M-14.md) and the [feature register](FEATURE_REGISTER.md) |
| [`tax-audit-beta-v0.1-rc1-release-notes.md`](../tax-audit-beta-v0.1-rc1-release-notes.md) | Tax Audit beta of June 2026 | [Module M-14](modules/M-14.md) and the [feature register](FEATURE_REGISTER.md) |
| [`tax-audit-packaging-handoff.md`](../tax-audit-packaging-handoff.md) | Tax Audit beta of June 2026 | [Module M-14](modules/M-14.md) and the [feature register](FEATURE_REGISTER.md) |
| [`FINANCIAL_STATEMENTS_ARCHITECTURE.md`](../FINANCIAL_STATEMENTS_ARCHITECTURE.md) | Financial statements (an earlier design) | [Financial Statement Review](FINANCIAL_STATEMENT_REVIEW.md) |
| [`TRIAL_BALANCE_DEPRECATION.md`](../TRIAL_BALANCE_DEPRECATION.md) | Trial balance (the two earlier modules) | [Financial Statement Review](FINANCIAL_STATEMENT_REVIEW.md) |
| [`TRIAL_BALANCE_NEW_DATABASE_SCHEMA.md`](../TRIAL_BALANCE_NEW_DATABASE_SCHEMA.md) | Trial balance (the removed `tb_new_*` tables) | [Financial Statement Review](FINANCIAL_STATEMENT_REVIEW.md) and [data model](DATA_MODEL.md) |

`docs/ui-refresh/` is not historical: it is the current evidence for T-032 (the Permanent File refresh).
