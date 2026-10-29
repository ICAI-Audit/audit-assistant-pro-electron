# Upgrade data safely

## When to use

Use for schema, persistent field, data mapping, storage path or migration changes.

## Read before acting

Read DATA_MODEL, active getSqliteDb and startup migrations in main.cjs, affected schema files and actual query path. Identify database, file and localStorage dependencies.

## Procedure

1. Define old and new schema, defaults, nullability, relationships and how existing values migrate. Do not assume CREATE TABLE IF NOT EXISTS alters existing columns.

2. Prepare synthetic fresh and old-version databases in isolation. Define a consistent backup and recovery plan before executing destructive or irreversible migrations.

3. Make upgrades idempotent, detect partial state and define interruption behaviour. Preserve identifiers, source balances, file links and audit history.

4. Test fresh startup, old-data upgrade, repeat startup, failure/retry and restored backup. Compare counts, keys, representative records and financial totals.

5. Document field read/write ownership and retained compatibility. Refresh the inventory, update relevant feature/task and provide exact evidence. Never delete the live database as a repair strategy.

## Required result

Upgrade and recovery evidence against isolated fixtures. A fresh-database pass alone does not prove compatibility with existing client data.

## Shared records

Use the [project index](../README.md), [task template](../templates/TASK.md) and [handoff template](../templates/HANDOFF.md). Follow [shared instructions](../../../AGENTS.md).
