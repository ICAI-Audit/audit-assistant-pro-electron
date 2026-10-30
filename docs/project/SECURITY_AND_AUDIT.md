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
| Evidence metadata claiming another engagement's path (review finding 1) | `file_path` must be relative, normalized, unique (case-insensitive) and inside `<engagement_id>/`; `file_path` is immutable | Reproduced before the fix (insert, re-point, traversal, duplicate accepted; foreign bytes downloaded and overwritten). Now rejected; file handlers resolve only a single canonical record | Enforced |
| Child parent-key moves (review finding 2) | Prospective post-change row must stay in an accessible engagement; applies to update and upsert | Reproduced before the fix (checklist item and evidence link moved to engagement B). Now rejected; same-value key writes still pass | Enforced |
| Trial balance tables (review finding 3) | Assigned users read/write their engagement's `engagement_trial_balance_header`/`_lines`; header and line engagement must match | Reproduced before the fix (absent from mapping, legitimate insert denied). Now authorized, scoped, and cross-engagement/mismatched-header writes denied | Enforced |
| Failed upload rollback (review finding 4) | Uploader may remove only own fresh unlocked draft unlinked metadata; no general staff evidence deletion | Reproduced before the fix (rollback denied). New `evidence-upload-rollback` IPC passes; other users' rows, other engagements, linked rows and staff general delete remain denied | Enforced |
| Evidence byte deletion (`file-delete`) | Manager-level, matching evidence metadata deletion | Staff byte deletion now denied (previously permitted for any assigned user) | Enforced; policy assumption mirrors existing `MANAGER_DELETE_TABLES` |
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
- Canonical evidence ownership: a path must be inside its own engagement folder, unique and immutable; handlers accept only a single matching record.
- Prospective-row validation on update and upsert; upsert now requires explicit conflict columns and no longer uses `OR REPLACE`.
- Authorization coverage review against all `.from('<table>')` callers added `engagement_trial_balance_header`, `engagement_trial_balance_lines`, `engagement_tb_classification` (parent-scoped) and read-only `ifc_clause_library`.

## Known gaps found by the coverage review

- `engagement_tb_classification` and `ifc_clause_library` have no definition in `sqlite/schema` (only in `_archive` Supabase migrations); callers fail with a missing-table error. This is a schema defect outside this task, not an authorization result. The mapping is forward-looking only.
- Session identity is still one module-global user, and `isTrustedRendererEvent` is not a frame check; this does not protect against an untrusted renderer or multiple windows.
- Legacy evidence rows whose `file_path` is not under `<engagement_id>/` become inaccessible through file handlers.

## Remaining policy decisions

1. Final export authorization model (including post-logout behavior).
2. Evidence approval/review/lock/reopen state-transition policy.
3. Long-term role policy confirmation for `admin`, and mapping for `viewer`/`user`.

## Validation evidence

- `node --test scripts/test-t003-authorization.cjs`: **26 passed, 0 failed**. Before the fixes the new regressions failed (5 failing review subtests plus the rollback subtest; 19 passed), recorded as reproduction evidence.
- Uses synthetic users/data and temporary Electron `userData`/downloads paths only.
