# Verify authorization and evidence controls

## When to use

Use for authentication, role/assignment access, IPC, evidence, report approval, locking or audit-trail changes.

## Read before acting

Read SECURITY_AND_AUDIT, active main/preload handlers, UI guards, affected hooks and schemas. Compare separate access-control code with what the active handler actually calls.

## Procedure

1. Define actor, role, assignment, record owner, permitted operations, fields returned and state/lock restrictions. Trace indirect ownership through linked IDs.

2. Test synthetic unauthenticated users and admin/manager/staff users against two distinct engagements. Invoke the backend boundary directly rather than relying only on hidden buttons.

3. Test forged IDs, cross-engagement records/files, bulk mutations, inactive sessions, unsafe paths and writes after approval/lock. Record expected versus actual rejection.

4. For a scoped fix, enforce decisions in main-process handlers, validate payload and sender as required by the design, and retain permitted workflows. Avoid logging secrets or excessive client data.

5. Check audit events and controlled reopening reasons. Mark encryption, immutable history, role isolation or lock claims unverified until tests prove the exact boundary.

## Required result

A control matrix with positive and negative regression evidence, or precise findings linked to tasks. Do not describe a UI guard as complete backend authorization.

## Shared records

Use the [project index](../README.md), [task template](../templates/TASK.md) and [handoff template](../templates/HANDOFF.md). Follow [shared instructions](../../../AGENTS.md).
