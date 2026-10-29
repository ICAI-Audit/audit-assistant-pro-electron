# Resume and close a coding session

## When to use

Use at every new coding session, context reset, agent switch, and task close.

## Read before acting

Read AGENTS.md, project README, PRODUCT_CONTEXT, CURRENT_STATUS, NEXT_TASKS and SESSION_HANDOFF. Read Git status, branch and recent history. Compare the checkout to the recorded baseline. Read only the feature and workflow detail relevant to the task.

## Procedure

1. Identify the explicit user request, selected task ID and affected feature IDs. Separate current facts, proposed changes and unresolved decisions.

2. Check for user changes and overlapping work. Preserve it. Reconcile changed source with stale notes before editing. Do not reset a working tree or infer the next task is authorised merely because it heads the backlog.

3. State the intended result, binding constraints and validation. If blocked, complete independent authorised work and record the exact missing input.

4. At close, update relevant features, status, task state, decisions and latest handoff. Record exact passed, failed and skipped commands and the first executable next action.

5. Run npm run docs:check. For an agent-switch smoke test, ask a fresh client to recover architecture, prototype gaps, failed install and next task from files without giving it the answers.

## Required result

A current handoff and a concise result identifying outcome, validation and remaining limits. Do not mark human UAT or cross-client loading complete from a link check.

## Shared records

Use the [project index](../README.md), [task template](../templates/TASK.md) and [handoff template](../templates/HANDOFF.md). Follow [shared instructions](../../../AGENTS.md).
