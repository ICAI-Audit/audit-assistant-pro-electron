# Developer handover checklist (2 November 2026)

Prepared for CA Venugopal Gella's review. This is a reconciliation of the repository and a classification of each visible module from the code, the feature register and the automated harnesses. It is **not** UAT, not a claim that the application is complete, and not a release. Runtime behaviour in the packaged or running desktop application was **not** exercised by this work; only the synthetic harnesses named below were.

Classification: **Working** = implementation path and automated evidence exist for the stated boundary; **Partial** = works with a stated gap; **Placeholder** = visible but its core action is a notice, sample data or not implemented; **Disconnected** = reads or writes data that the rest of the application no longer uses.

Related: [FEATURE_REGISTER.md](FEATURE_REGISTER.md), [CURRENT_STATUS.md](CURRENT_STATUS.md), [NEXT_TASKS.md](NEXT_TASKS.md), [SESSION_HANDOFF.md](SESSION_HANDOFF.md), [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md).

## Repository position

- `origin/main` = `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4`. Every other remote branch (`TaxAuditCleanUp`, `restore-tax-audit-cleanup`, `docs/*`, `fix/t003-*`, `work/developer-task`) is already an ancestor of `main`; nothing there needs merging.
- Included in the handover baseline: `chore/remove-unused-code` (T-020, commits `685a4c8`, `04d0c9f`) and `feat/t021-reconnect-tb-readers` (T-021 and T-012), stacked as `integration/handover-2026-11-02`.
- Excluded and preserved, never committed: the local modification of `package-lock.json`, untracked `ICAI-VERA-Context-Pack/` and `ICAI-VERA-Documentation-Review/`, and `stash@{0}`.

## Module classification

| Area | What the user sees | What works (evidence) | Missing or limited | Blocks handover? | Owner decision |
| --- | --- | --- | --- | --- | --- |
| Authentication (F-001) | Sign-in and first-account screen | Backend authorization verified for roles, engagement scope and locks (`test-t003-authorization.cjs`, 26/26). Working | Screen behaviour (first admin, inactive user, restart) not exercised in the running app | No | None |
| Navigation and engagement selection (F-003) | Sidebar, engagement picker | Routes and guards listed in [SCREEN_MAP.md](SCREEN_MAP.md); FSG access follows engagement assignment (`test:fsg`). Partial | Selected-engagement reset and year/client consistency not verified in the UI | No | None |
| Clients, firm, team (F-002) | Settings, Engagements | Code present; client identity feeds FSG entities. Partial | CRUD, validation and duplicates unverified | No | Long-term roles `viewer`/`user` (open) |
| Appointment and engagement letter (F-004, F-005) | Appointment pages, letter generator | Code present | Merge fields, custom template and export unverified | No | None |
| Compliance applicability (F-006) | Applicability screen | Code present | Rules need period-specific source review | No | Legal review |
| Materiality, risks (F-010, F-011) | Materiality, risk register | Code present; Materiality logs a harmless "Failed to load" when no record exists | Persistence and assignment rules unverified | No | None |
| Audit execution, workpapers (F-012) | Programmes and procedures | Code present | `ProcedureWorkpaper` stub says "not implemented yet" (placeholder) | No | Build or hide (T-022) |
| Evidence (F-013) | Evidence vault | Backend path/ownership/deletion rules verified (T-003 harness). Working for the stated boundary | Approval, lock and reopen policy undefined | No | Evidence transition policy |
| Review notes, audit trail (F-014, F-017) | Notes, trail | Code present; logging paths exist | Immutable storage and export unproven | No | None |
| Misstatements, Completion (F-015, F-016) | Visible screens | **Placeholder**: sample data; Add closes the dialog without saving | Persistence, sign-off, file lock | Yes, for any claim of completed audit workflow | Scope (T-006, T-007) |
| Financial Statement Review (F-007, F-009) | Upload, mapping, adjustments, Balance Sheet, P&L, notes, cash flow, PDF/Excel | Synthetic upload, three-stage mapping, adjustments, lock, restart persistence, statements render: `test:fsg` 53/53, `test:fsg-ui` 37/37. Working for synthetic data | Real client trial balances, all upload formats, figure comparison with FSG_Bharat, PDF/Excel content review, owner UAT | No for handover; yes for production use | Assumptions in [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md) |
| Dashboard (readiness card) | Engagement dashboard | **T-021**: trial-balance classification now reads FSG data through `fsg:engagement:summary`; engagement isolation and counts verified by `test:fsg`. Partial | Screen not run in the app; the old reader showed empty results because `engagement_tb_classification` is not in the schema (T-017) | No | None |
| Audit Report setup cross-check | Share capital, Reserves, Borrowings vs TB | **T-021**: figures from FSG face lines (absolute closing, owner-selected); verified incl. branch trial balances. Partial | Non-company constitutions return 0 for Paid-up capital; owner to confirm the cross-check basis | No | Confirm basis; mapping for non-company |
| Audit Report document, CARO, IFC (F-018) | Report editor and export | Code present | Saved edits, annexures, approval and export consistency unverified; professional review | No | None |
| Data Integrity (admin) | Orphan engagements, delete guard | **T-021**: guard counts FSG rows of the client and year. Partial | Legacy rows are no longer counted, but still cascade on engagement delete (no data was migrated or deleted) | No | Legacy data fate (open) |
| Tax audit, Forms 3CA/3CB/3CD (F-019 to F-021) | Tax-audit screens, exports | Library tests pass (`vitest src/lib`, 37). Code present | AY 2025-26 only; signed form or portal acceptance not established | No | None |
| GSTZen / GSTR-1 (F-022) | Integration screens | Code present | Needs credentials and live connectivity; 21 type diagnostics in `gstzen-api.ts` | No | None |
| VERA Tools (F-023) | Calculators, Tally | Code present | "Coming Soon" actions (Excel import, GST portal authentication, file processing) are placeholders; three deferred-tax tools overlap (T-022) | No | Canonical tool; build or hide |
| Feedback (F-024) | Feedback screen | One route, engagement-scoped (T-012, owner decision) | None known | No | Done |
| Administration | Admin dashboard and settings | Guarded by `ProtectedAdminRoute`; authorization verified at the backend | Email invitation and admin password reset are "not yet implemented" (placeholder) | No | Build or hide (T-022) |
| Backup and restore (F-026) | None | Not established | No consistent backup of database, files and localStorage | **Yes** for production handling of client data | Approach (T-009) |
| Installation and desktop launch (F-025) | `npm ci`, `npm run electron` | Fresh clone: `npm ci --no-audit --no-fund` with postinstall, `test:native` (see below) | Packaged launch, installer, other platforms unverified | No | Release scope (T-004, T-010) |
| AI guidance (F-027) | None | Not established | Not specified | No | T-011 |

## Verification evidence

See the results table in [CURRENT_STATUS.md](CURRENT_STATUS.md#t-021-handover-result-2-november-2026). Not verified by any harness: screens in the running application, PDF and Excel file contents against a reference, closing and reopening the application through its UI, packaged launch, live Tally, owner UAT.

## Remaining limitations

- `tsc` 76 diagnostics and lint 475 errors / 71 warnings pre-date this work and are unchanged by it; none were disabled.
- Legacy tables (`trial_balance_lines`, `engagement_trial_balance_*`) stay in the database unread; `useTrialBalance` has no consumer.
- Placeholders and duplicate tools are recorded in T-022 and unchanged.

## Owner decisions still needed

1. Confirm the Audit Report cross-check basis (absolute closing balance of Share capital, Reserves and surplus, Long-term plus Short-term borrowings) and the mapping for non-company constitutions.
2. What happens to legacy trial-balance rows (kept untouched for now).
3. T-022: canonical deferred-tax tool and which placeholders to build or hide.
4. Backup approach (T-009), evidence transition policy, role mapping, release scope.
