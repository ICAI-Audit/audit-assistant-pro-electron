# Specify and implement a bounded feature change

## When to use

Use for a new capability, behavioural change, or defect fix.

## Read before acting

Read FEATURE_REGISTER, PRODUCT_CONTEXT, relevant decisions, architecture and data model. Inspect the active route, component, hook, preload, main handler, SQL and existing tests for the affected path.

## Procedure

1. Use the task template to record current and intended behaviour, inputs, validations, roles, states, storage, outputs and acceptance examples. Reproduce a defect before fixing it.

2. Trace the whole active path. Distinguish legacy files and sample-data screens from persisted production paths. List compatibility and migration impact.

3. Implement the smallest coherent change within the request. Reuse existing components. Preserve ledger signs, units and professional versioning; do not broaden the audit scope.

4. Exercise normal, empty, invalid, duplicate and cancellation cases. For persistence, save, reopen, switch engagement and test forbidden actions at the main-process boundary.

5. Update the feature record and task with code and test evidence. Refresh source inventory only if declarations changed. Close using the session workflow.

## Required result

A reviewable implementation or a precise blocked task, with acceptance evidence. Do not call a route complete merely because it renders.

## Shared records

Use the [project index](../README.md), [task template](../templates/TASK.md) and [handoff template](../templates/HANDOFF.md). Follow [shared instructions](../../../AGENTS.md).
