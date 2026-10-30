# Security and audit controls

This record is code-grounded verification against active Electron handlers. It is not a penetration test or legal certification.

## Active path and remediation scope

- Active handlers: `electron/main.cjs` + `electron/preload.cjs`.
- Data path: renderer IPC to local SQLite (`audit_assistant.db` under Electron `userData`) and local evidence files under `userData/files`.
- Remediation delivered in `electron/main.cjs` and `electron/sqlite-authorization.cjs`.
- Isolated evidence harness: `scripts/t003-electron-entry.cjs`, `scripts/test-t003-authorization.cjs`.

## Current control matrix (post-remediation)

| Case | Expected policy | Actual behavior | Classification |
| --- | --- | --- | --- |
| Unauthenticated and post-logout SQLite reads | Deny protected table access | `sqlite-query` returns `Authentication required.` | Enforced |
| Role-protected core updates | Staff denied; manager/admin allowed per approved mapping | Staff client update denied; manager and admin update allowed | Enforced (per scoped policy) |
| Cross-engagement list/read/write | Restrict non-partner/admin users to assigned engagements | Staff list is filtered to assigned engagement; forged cross-engagement update/delete denied | Enforced |
| Protected role-field changes | Deny non-admin role edits and self-escalation | Staff self-role escalation denied | Enforced |
| Indirect evidence links | Prevent cross-engagement procedure↔evidence links | Cross-engagement insert blocked; cross-engagement read path blocked | Enforced |
| Unfiltered bulk update/delete | Deny update/delete without filters | Both operations rejected with filtered-only error | Enforced |
| Evidence file path/save/download/delete | Require auth + engagement ownership metadata | All four operations denied when unauthenticated; engagement ownership enforced | Enforced |
| Locked/approved evidence writes | Requires explicit product-approved transition policy | Assigned manager writes to locked/approved records still observed as allowed | Policy unresolved |
| Export while logged out | Requires explicit export authorization policy | Export currently succeeds to local downloads path | Policy unresolved |
| Profile isolation during tests | Must not touch real user profile | Harness verifies temporary profile before main import; only synthetic data used | Enforced in harness |

## Implemented backend controls

- Fail-closed check for authenticated principal before `sqlite-query` and evidence-file IPC handlers.
- Central authorization helper for table/action validation and engagement-scoped checks.
- Row-level ownership checks for update/delete and sensitive inserts.
- Explicit denial for unfiltered update/delete.
- Role-change protection for `user_roles` and protected-field checks.
- Evidence file handlers now resolve evidence metadata and enforce caller engagement access.

## Remaining policy decisions

1. Final export authorization model (including post-logout behavior).
2. Evidence approval/review/lock/reopen state-transition policy.
3. Long-term role policy confirmation for `admin`, and mapping for `viewer`/`user`.

## Validation evidence

- `node --test scripts/test-t003-authorization.cjs`: **20 passed, 0 failed**.
- Uses synthetic users/data and temporary Electron `userData`/downloads paths only.
