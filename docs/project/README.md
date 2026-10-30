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

## Find the detail

| Subject | Authoritative project record |
| --- | --- |
| Agent workspace index | [Agent index](../../.agents/README.md) |
| Product capabilities and gaps | [Feature register](FEATURE_REGISTER.md) |
| Entry points and data flow | [Architecture](ARCHITECTURE.md) |
| Tables and persistence ownership | [Data model](DATA_MODEL.md) |
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
