# Open gaps and scope boundaries

Reviewed source `cc5c04729604fba7d05240a07f24682e0644665c`. Gaps below remain documented; this task does not implement them. The four findings reproduced in the earlier T-003 review were reported remediated at this baseline with 26 passing IPC tests. They are not automatically reopened or independently certified here. Known limitations, assumptions and untested workflows remain distinct.

| Gap | Area | Affected modules | Evidence or limit | Disposition |
| --- | --- | --- | --- | --- |
| GAP-01 | Missing declared tables | M-06, M-13 | engagement_tb_classification and ifc_clause_library are absent from sqlite/schema; latest VS Code report says their callers fail. | T-017; record intended model and migration before a separate implementation task. |
| GAP-02 | UI-to-persistence verification | M-01 to M-17 | Most module workflows have source code but no complete saved/reopened renderer UAT. Latest security tests are IPC-level. | Module acceptance cases; owner selects release-critical paths. |
| GAP-03 | Prototype misstatements | M-11 | Sample data and non-persisting Add behaviour drive the screen. | T-006 and RV-11. |
| GAP-04 | Prototype completion | M-12 | Sample checklist and no accepted durable whole-file finalization/export. | T-007 and RV-04/RV-11. |
| GAP-05 | Policy-dependent evidence and exports | M-10, M-12, M-13 | Lock/approval/reopen and post-logout export are observation-only; manager byte-delete and rollback timeout are assumptions requiring acceptance. | T-016 and RV-03/RV-04/RV-09. |
| GAP-06 | Legacy evidence compatibility | M-10, M-17 | Non-canonical paths become inaccessible through current handlers; no accepted migration performed. | RV-10 and T-009 recovery design. |
| GAP-07 | Session identity and renderer trust | M-01, M-10 | One module-wide authenticated user and weak renderer trust do not establish untrusted-renderer or multi-window safety. | Document limitation; separate control design after owner requirements. |
| GAP-08 | Professional/legal verification | M-04, M-05, M-07, M-13, M-14, M-16 | AY 2025-26 label, form fields, thresholds, wording and calculators are not a current-law approval. | RV-06, T-008 and named professional review. |
| GAP-09 | Original Phase I coverage | M-04, M-07, M-08, M-09, M-16 | Management-FS comparison, per-line workpaper/staff/materiality indicators, searchable MRL/checklist formats and some calculators are not fully established. | REQ-P15 to P25 and RV-02/RV-14. |
| GAP-10 | Backup and installed data | M-17 | Complete consistent backup/restore, retention and installed runtime schema parity are not demonstrated. | T-009, RV-10/RV-12. |
| GAP-11 | TypeScript and lint | Cross-cutting | Reported baseline: 114 TypeScript diagnostics in 28 files; 515 lint errors and 101 warnings. After T-019 removed the old Financial Review files: 76 diagnostics in 18 files; 492 lint errors and 72 warnings (2 November 2026). Lint covers .ts/.tsx only, so src/modules/fsg (JSX) is not linted. | T-013, T-014. |
| GAP-12 | Desktop integration and distribution | M-06, M-17 | Installer, live Tally/ODBC, cross-platform, update feed/signing and owner UAT remain unverified. | T-010, RV-15. |
| GAP-13 | Automatic client context loading | M-19 | Manual context recovery demonstrated; actual Codex/Claude automatic loading unverified. | T-001 remains partial and non-blocking for documentation review. |
| GAP-14 | Future AI and broad audit types | M-18 | No verified general AI/RAG workflow or complete broad audit-type implementation. | T-011 and RV-16. |
| GAP-15 | History completeness | M-12 | Activity logger reads up to 500 rows; immutable complete history and full log export are not demonstrated. | RV-04/RV-12 and module acceptance scenarios. |
| GAP-16 | Financial Statement Review parity and acceptance (T-019) | M-06, M-07 | Ported FSG_Bharat runs on SQLite with synthetic integration and UI evidence. Not established: same-TB figure comparison with FSG_Bharat on PostgreSQL, FSG_Bharat's PostgreSQL self-tests, PDF/Excel content review, live Tally, owner UAT. Money is stored as SQLite REAL (exact NUMERIC in PostgreSQL). | Owner comparison on an anonymised TB; [assumptions](FINANCIAL_STATEMENT_REVIEW.md#assumptions-awaiting-confirmation) need confirmation. |
| GAP-17 | Trial-balance consumers outside Financial Statement Review | M-06, M-13 | The dashboard snapshot still reads `engagement_trial_balance_*` (no writer) and the Audit Report setup cross-check reads `trial_balance_lines` (`fs_area`, no writer). Neither reads Financial Statement Review data. | Owner decision whether to point them at the FSG mapped trial balance. |

## Prior security findings

Canonical file ownership, prospective parent validation, active TB authorization mapping and scoped failed-upload rollback have reported before/after regression evidence. Their reported scope should be recorded accurately. They do not establish complete application security, UI acceptance, working missing schema or settled product permissions. No additional security fixes were undertaken during this documentation pass.
