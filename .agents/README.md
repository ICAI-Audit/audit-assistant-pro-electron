# ICAI VERA agent workspace

This directory is a navigation entry for coding agents and developers. The shared repository instructions are in [AGENTS.md](../AGENTS.md) at the repository root. A previously empty .agents directory does not establish that the product has or lacks a capability.

## Start a session

Read [shared instructions](../AGENTS.md), the [project index](../docs/project/README.md), [product context](../docs/project/PRODUCT_CONTEXT.md), [current status](../docs/project/CURRENT_STATUS.md), [next tasks](../docs/project/NEXT_TASKS.md), and [latest handoff](../docs/project/SESSION_HANDOFF.md). Inspect the current Git branch and working tree. Select the workflow relevant to the user's request before editing.

## Reusable workflows

| Workflow | Read |
| --- | --- |
| Session start and handoff | [Session continuity](../docs/project/workflows/session-continuity.md) |
| Feature or defect work | [Feature change](../docs/project/workflows/feature-change.md) |
| Financial rules and totals | [Financial rules](../docs/project/workflows/financial-rules.md) |
| Legal sources and report wording | [Statutory content](../docs/project/workflows/statutory-content.md) |
| Schema and data upgrades | [Database change](../docs/project/workflows/database-change.md) |
| Permissions and evidence controls | [Security review](../docs/project/workflows/security-review.md) |
| Preview and document exports | [Report export](../docs/project/workflows/report-export.md) |
| Native runtime and packaging | [Desktop validation](../docs/project/workflows/desktop-validation.md) |

## Keep one maintained record

Maintain detailed instructions in docs/project and shared rules in the root AGENTS.md. Do not copy product state into competing files in this directory. Claude and Copilot have short root/client adapters to the same shared rules. This README is explicitly linked from AGENTS.md; its mere presence does not guarantee automatic loading by any particular IDE.

The listed workflows are portable Markdown runbooks. This package does not install personal ChatGPT skills or claim native SKILL.md discovery. If native IDE skills are added later, verify the installed client's documented discovery rules, keep their wrappers small and point them to the canonical workflows. Verify the actual loaded context in a fresh session.
