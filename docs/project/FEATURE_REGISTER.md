# Feature register

F-007/F-009, 13 November 2026: owner confirmed the reviewed T-023 through T-028 source commit on RSF after typecheck-debt disclosure. No further feature changes or UAT acceptance; known gaps remain. Full scope and validation: [RSF review](RSF_PRE_COMMIT_REVIEW.md).

F-007/F-009 pre-commit verification, 13 November 2026:

T-029 reviewed pending T-023?T-028 together: fresh integration 210/210, desktop 81/81 and no new TS diagnostic signatures relative to HEAD (76 existing errors remain). No new feature behaviour or UAT acceptance. Known-ALIE status omissions, GAP-18 and older tracked data-artifact disposition remain explicit in [the review](RSF_PRE_COMMIT_REVIEW.md). Commit awaits owner confirmation.

F-009 updates, 13 November 2026:

T-027 dated headings now extend to underlying Notes/Annexures on screen and normal PDF/Excel, including per-note BS/P&L basis, selected comparative dates and relevant disclosure tables. Opening/Closing movement captions and stored fields/calculations remain unchanged. T-028 removes the owner-identified Cloudtail MCA publishing feature end to end: controls, automatic publish, renderer API and backend channels/implementation. Historical snapshot records/table remain preserved. Integration 210/210 and desktop 81/81 passed, including production build and FSG-scoped date-heading wrapping; owner UAT pending.

F-007/F-009 owner rollback, 12 November 2026:

T-026 provisional ALIE MISSING liability placement is removed at the owner's explicit instruction. Unresolved amounts remain in warnings/review lists and are excluded pending proper classification; generation remains available with an incompleteness/unbalanced warning. Nil filtering and PY stock-input exclusion are retained. Earlier provisional-head descriptions below are historical. Source balances, existing saved snapshots and client data remain unchanged; new exports/snapshots no longer allocate diagnostic amounts. Integration 201/201, desktop 77/77 and build/docs checks passed; owner UAT pending.

F-007/F-009 fix, 12 November 2026:

T-026 excludes Stock-form comparative disclosure rows (`Stock Entry PY`) from missing ALIE detection and its provisional liability head. This corrects the owner screenshot false positive for PY Opening Stock / PY Closing Stock. It preserves saved stock, ordinary imported stock-ledger checks, current stock mappings and financial stock calculations. Integration 201/201 and desktop 77/77 passed, including build/restart and stock-preservation checks; owner UAT pending.

F-007/F-009 wording follow-up, 12 November 2026:

T-026 missing-ALIE notices now explain missing ledger classification, actual provisional debit/credit sign and the next correction step without assuming P&L. Ledger names/balances are visible directly below the screen notice. Shared PDF/Excel notices and exception captions are aligned; source/status/math are unchanged. Owner approved this correction in the conversation. Integration 197/197, desktop 76/76 and build/docs checks passed; owner UAT pending.

F-009 update, 12 November 2026: T-027 dated statement columns

BS and P&L screens and normal PDF/Excel now derive reporting-date titles/columns from the selected TB period. BS uses **As at**; P&L uses **For the year ended**. FY 2025-26 produces 31 March 2026 and comparative 31 March 2025. Explicit comparative/custom reporting dates take precedence over a preceding-year fallback. Integration 190/190 and desktop 75/75 passed, with screen/PDF visual checks; owner UAT pending. No source amounts/calculations changed.

F-007/F-009 follow-up, 12 November 2026:

T-026 now provisionally includes missing-ALIE signed net balances under **ALIE MISSING** on the BS Equity and Liabilities side, preserving source data and mandatory notices. Fully nil items remain in Mapping without financial warnings; comparative-only balances affect PY only. Integration 171/171 and desktop 73/73 passed. [Contract](T026_MISSING_ALIE_WARNINGS.md). This supersedes the warning-only presentation below; wider unresolved-status/profit-transfer gaps remain open.

F-007/F-009 update, 12 November 2026: [T-026 missing-ALIE warnings](T026_MISSING_ALIE_WARNINGS.md) implements the owner's first requested part: non-blocking red bold beginning/end BS/P&L notices, source-item counts and gross debit/credit/net closing figures, scope-correct comparatives, correction links and ledger-wise exceptions in screen/PDF/Excel plus snapshot evidence. Integration 147/147 passed. The separate known-ALIE unresolved-status omission and GAP-18 are not fixed by this part. Owner UAT remains pending.

F-007/F-009 finding, 11 November 2026: T-026 source diagnosis confirms unresolved statuses (`unmapped`, `conflict`, `discrepancy`) are excluded from the single-TB, consolidated and branch financial-data queries, independently of fallback category availability. Owner clarified that values must remain under the last trusted hierarchy/appropriate uncategorised heading pending rectification. Implementation and reconciliation tests are outstanding; see [diagnosis](SESSION_HANDOFF.md#t-026-diagnosis-unresolved-ledger-inclusion-11-november-2026). No behavior change or acceptance claimed by this finding.

F-009 update, 11 November 2026: [T-025 investment disclosures](T025_INVESTMENT_DISCLOSURES.md) adds current/non-current investment Fill Details, mapped sub-classification ledger selection, securities and partnership disclosures, main-process year/lock validation, financial PDF/Excel, snapshots and consolidated Fill Details workbook support. Integration 121/121 and UI 61/61 passed; actual PDF text and reopened Excel checked. Division I professional review and owner UAT remain pending. Other modules are outside this task.

Reviewed for documentation on 30 October 2026 at source commit cc5c04729604fba7d05240a07f24682e0644665c. This is an implementation and coverage register, not certification of audit compliance.

See the [complete module coverage](MODULE_COVERAGE_MATRIX.md) and [detailed specification index](MODULE_INDEX.md). Each of the 28 features maps to a module; code facts, reported tests and owner acceptance remain separate.

## Status vocabulary

- Code present: implementation path identified by inspection; runtime behaviour and full coverage remain to be verified.
- Partial: some implementation exists but a specific functional or control gap is visible.
- Prototype: active screen uses sample state or non-persisting controls for its core behaviour.
- Not established: no verified implementation path was identified in this bounded review. This is not an exhaustive proof of absence.
- Automated verified: named checks passed at a stated commit and environment. State the tested boundary.
- UAT accepted: a named reviewer accepted stated scenarios on a stated build. No application feature has this status from this review.

All rows below have runtime verification pending unless stated otherwise. Evidence paths are navigational pointers. For a changed feature, add its detailed contract using the task template, test evidence and owner acceptance.

## T-023 update (11 November 2026)

PR #108 is merged: shared GSTIN normalization/validation is used by GST master/bulk entry and tax-audit registration rows; appointment-letter GSTIN entry and draft restore normalize uppercase. Related features: F-005, F-019 and F-023. Helper tests pass; this is not end-to-end persistence or statutory acceptance evidence. The F-001 login page and common header share the updated build label (`src/config/buildMessage.ts`, `src/components/layout/BuildInfoLabel.tsx`): `Code baseline: 11 November 2026`, `Update: GSTIN normalization and validation (PR #108)`, with source branch and build-time commit in the tooltip. Five label tests pass, including the exact displayed update and both mounting points. Desktop visual fit and owner UAT remain open. See [current validation](CURRENT_STATUS.md#t-023-gstin-merge-and-startup-label-11-november-2026).

| ID | Capability and user purpose | Implementation evidence | Status and next verification |
| --- | --- | --- | --- |
| F-001 | Local account creation and sign-in | src/pages/Auth.tsx; src/contexts/AuthContext.tsx; electron/main.cjs | Code present; verify first admin, staff, inactive account, incorrect password and restart. Remembered email is not a remembered authenticated session |
| F-002 | Firm, partner, team and client masters | src/pages/Settings.tsx; src/hooks/useFirmSettings.ts; src/hooks/useClients.ts; src/hooks/useTeamMembers.ts | Code present; exercise create/update, validation, permissions, persistence and duplicate handling |
| F-003 | Engagement creation and selection | src/pages/Engagements.tsx; src/pages/SelectEngagement.tsx; src/contexts/EngagementContext.tsx | Code present; verify user access, selected-context reset, year and client consistency |
| F-004 | Appointment, eligibility and previous-auditor communication | src/pages/Appointment.tsx; src/components/appointment; src/hooks/useEligibilityCertificate.ts; src/hooks/usePreviousAuditorCommunication.ts | Code present; compare master data, saved edits and generated letters; no legal approval inferred |
| F-005 | Engagement letter templates and generation | src/components/appointment/Letters.tsx; src/services/engagementLetterEngine.ts; src/services/engagementLetterDocxTemplate.ts | Code present; test merge fields, custom template, missing data and exported document |
| F-006 | Threshold and reporting applicability | src/pages/ComplianceApplicability.tsx; src/lib/taxAuditApplicability.ts | Code present; rules require period-specific source review and boundary tests |
| F-007 | TB import, mapping and classification (Financial Statement Review, T-019) | src/pages/FinancialStatementReview.tsx; src/modules/fsg; electron/fsg/ipc/tb.js; electron/fsg/ipc/mapped-tb.js; electron/fsg/services/mapping-engine.js; sqlite/schema/10_fsg_tables.sql | Replaced the former Financial Review on 2 November 2026 (see [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md)). Automated verified for synthetic upload, three-stage mapping, adjustments, lock and restart persistence (`npm run test:fsg` 41/41, `npm run test:fsg-ui` 37/37); real client trial balances, all upload formats and owner UAT pending |
| F-008 | Tally and stock extraction | Financial Statement Review: electron/fsg/services/tally-odbc.js (HTTP XML, Python ODBC fallback), electron/fsg/services/tally-ppe.js; VERA Tools: src/hooks/useTallyODBC.ts; electron/main.cjs ODBC handlers | Code present; live Tally and supported setup required for both paths; confirm company, dates, row counts, stock figures and totals |
| F-009 | Financial statement preparation: faces, notes, cash flow, annexures and PDF/Excel output | src/modules/fsg (BS, PL, CFS, Notes, GeneralNotes, Annexures, GenerateFinancials); electron/fsg/ipc/financials.js | In scope per D-002/D-010. Synthetic Balance Sheet, Profit and Loss and Generate Financials screens render from saved data (`npm run test:fsg-ui`); figure-by-figure comparison with FSG_Bharat, PDF/Excel content review, professional review and owner UAT pending |
| F-010 | Materiality and risk assessment | src/pages/Materiality.tsx; materiality_risk_assessment schema | Code present; verify selected benchmark, units, percentages, rationale and engagement persistence |
| F-011 | Risk register | src/pages/RiskRegister.tsx; src/hooks/useRisks.ts | Code present; verify risk linkage, updates and assignment restrictions |
| F-012 | Audit programmes and procedure workpapers | src/pages/AuditExecution.tsx; src/pages/ProcedureWorkpaper.tsx; src/hooks/useAuditExecution.ts | Code present; verify template versus engagement copy, assignees, attachments and review state |
| F-013 | Evidence storage and review | src/hooks/useEvidenceFiles.ts; src/pages/EvidenceVault.tsx; electron/preload.cjs; electron/main.cjs | Backend now enforces authenticated, engagement-scoped file path/save/download access with canonical path ownership (path inside the engagement folder, unique, immutable), manager-level byte deletion, and a scoped uploader rollback IPC in active handlers. Evidence lock/approval/reopen transition policy remains unresolved; see SECURITY_AND_AUDIT.md |
| F-014 | Review notes | src/pages/ReviewNotes.tsx; src/hooks/useReviewNotes.ts | Code present; verify state transitions, reviewer roles, resolution evidence and engagement isolation |
| F-015 | Misstatement recording and evaluation | src/pages/Misstatements.tsx | Prototype; sampleMisstatements and sampleMateriality drive results; Add closes dialog without persistence |
| F-016 | Completion, sign-off and file locking | src/pages/Completion.tsx | Prototype; sampleCompletionChecklist drives progress; no verified durable whole-file finalization or export |
| F-017 | Activity and audit history | src/pages/AuditTrail.tsx; src/hooks/useActivityLogs.ts; src/hooks/useEvidenceFiles.ts | Partial; database-backed logging paths exist, but complete coverage, immutable storage and log export are unproven |
| F-018 | Statutory audit report, CARO and IFC drafts | src/pages/AuditReport.tsx; src/components/audit-report/ReportExport.tsx; src/hooks/useAuditReportDocument.ts | Code present; verify saved edits, annexures, approval, preview/export consistency and professional review |
| F-019 | Tax-audit setup, acceptance and clause workflow | src/pages/TaxAudit.tsx; src/hooks/useTaxAudit.ts; src/data/taxAudit3CDClauses.ts; src/data/taxAudit3CDFieldSchemas.ts | Code present; library tagged AY 2025-26; verify structured clause fields, prefill provenance and saving |
| F-020 | Tax-audit readiness, programme and internal report pack | src/lib/taxAuditReportReadiness.ts; src/lib/taxAuditProgramme.ts; src/lib/taxAuditReportPack.ts | `npx vitest run src/lib` passed (8 files, 37 tests) in the T-002 environment; statutory accuracy and full product acceptance remain unverified |
| F-021 | Draft Forms 3CA, 3CB and 3CD exports | src/hooks/useForm3CADocument.ts; src/hooks/useForm3CBDocument.ts; src/lib/taxAuditForm3CDExport.ts; src/pages/TaxAudit.tsx | Code present; 3CD Word/Excel/PDF/HTML exporters exist, superseding older exclusion claims; signed form or portal acceptance not established |
| F-022 | GSTZen login, GSTIN session and GSTR-1 retrieval | src/services/gstzen-api.ts; src/pages/GstzenIntegration.tsx; src/pages/Gstr1Dashboard.tsx; electron/main.cjs | Code present; external connectivity, credentials, consent, pagination and error handling need integration tests |
| F-023 | Audit calculators | src/pages/AuditTools.tsx; src/components/audit | Code present; verify each calculator independently, including depreciation, deferred tax, current tax and ratio inputs and formula basis |
| F-024 | Feedback and administrative views | src/pages/Feedback.tsx; src/pages/AdminDashboard.tsx; src/pages/AdminSettings.tsx | UI route guards remain secondary; active backend IPC now enforces authenticated and role/engagement-constrained operations for tested paths. Final role matrix decisions (`viewer`/`user`) remain open; see SECURITY_AND_AUDIT.md |
| F-025 | Desktop launch, installation and update | electron/run-electron.cjs; electron/main.cjs; electron/auto-updater.cjs; .github/workflows/release.yml | Two clean Windows installs with native rebuild and synthetic SQLite/bcrypt Electron smoke passed on Node.js 24.12.0/npm 11.6.2; Electron launch, installer, other platforms and feed owner remain unverified |
| F-026 | Backup and restore of the complete audit file | Database/file/localStorage stores identified in architecture | Not established; define consistent backup, restoration and failure recovery before claiming recoverability |
| F-027 | AI grounded guidance and anomaly detection | Supplied AI blueprint; no verified provider and RAG execution path in reviewed runtime | Not established; scope decision and evaluation needed before implementation |
| F-028 | Shared session knowledge and repeatable workflows | AGENTS.md; CLAUDE.md; .github/copilot-instructions.md; docs/project | Documentation implemented in this change; structural checks recorded in CURRENT_STATUS.md; actual IDE loading requires per-client smoke test |
| F-029 | CAAT Tools: data analytics tests and SA 530 sampling (T-024) | src/pages/CaatTools.tsx; public/caat; sqlite/schema/11_caat_tables.sql | Owner-tested tool embedded with per-engagement saving; automated verified with synthetic data (`npm run test:caat-ui` 29/29, including restore after restart and a 150,000-row ledger); owner UAT with real ledgers pending. See [CAAT_TOOLS.md](CAAT_TOOLS.md) |

## Coverage limits

F-007/F-009 update, 10 November 2026: [T-024](T024_LEVEL1_FALLBACKS.md) adds the five requested known-ALIE Level 1 fallback categories, master-linked low-confidence classification and canonical BS display/export labels, with an additive backup-backed upgrade. Integration 93/93, UI 54/54 and build passed, including actual PDF text/reopened Excel synthetic content checks. The unresolved non-corporate equity/profit-transfer case is recorded as GAP-18; no universal balancing or owner-acceptance claim.

F-002/F-009 update, 10 November 2026: [T-023](T023_FIRM_SIGNING_PLACE.md) adds the nullable Firm Place in VERA Settings/Admin Settings and uses it as the editable Financial Statement Review signing default. Existing finalised signing records remain authoritative. FSG integration and upgrade/recovery checks passed 60/60; UI results are recorded in [current status](CURRENT_STATUS.md). Owner UAT and exported-file inspection remain pending.

The original Phase I also requests searchable audit checklist and MRL formats and line-item workpaper linkage. Programmes, templates and evidence exist, but their exact coverage against those original requirements is not established. T-005 now has a documented trace and gap register prepared for owner review; this does not mean these capabilities are implemented or accepted. The tax guidance PDFs supplied in this conversation were not audited clause by clause during this documentation review.
