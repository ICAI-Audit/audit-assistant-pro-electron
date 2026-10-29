# Validate native desktop and packaging changes

## When to use

Use for Electron launch, preload, native dependencies, installation, updater or distribution work.

## Read before acting

Read DEVELOPMENT_GUIDE, TESTING, package.json, run-electron.cjs, main.cjs, preload.cjs, auto-updater.cjs and release workflow. Confirm supported toolchain and target OS.

## Procedure

1. Complete a clean install with the documented Node/npm version and successful native rebuild. T-002 records successful Windows checks and the repaired lock metadata; repeat on the target platform. Report any new failures rather than silently skipping them.

2. Use isolated synthetic data. Test development launch and built production launch separately. Verify no unexpected dev-server dependency in production.

3. Confirm native SQLite, bcrypt and required ODBC functionality, file dialogs, imports/exports and restart persistence. Exercise failure messages when optional integration prerequisites are missing.

4. For packaging, verify icons, resources and database upgrades on fresh and existing installations. Confirm intended update feed and signing policy from actual settings.

5. Test updates only in an approved test distribution context. Record exact build, OS, checks and failures. Do not create release tags, publish installers or roll out updates from a documentation-only task.

## Required result

Target-platform smoke evidence and reproducible commands. Local renderer build success alone does not validate an installer or native runtime.

## Shared records

Use the [project index](../README.md), [task template](../templates/TASK.md) and [handoff template](../templates/HANDOFF.md). Follow [shared instructions](../../../AGENTS.md).
