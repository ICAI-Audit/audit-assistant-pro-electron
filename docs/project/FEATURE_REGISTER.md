# Feature register

Reviewed 29 October 2026 at source commit c0ea50820094952b3bad9c83b45cc00cbff0381c. This is an implementation and coverage register, not certification of audit compliance.

## Status vocabulary

- Code present: implementation path identified by inspection; runtime behaviour and full coverage remain to be verified.
- Partial: some implementation exists but a specific functional or control gap is visible.
- Prototype: active screen uses sample state or non-persisting controls for its core behaviour.
- Not established: no verified implementation path was identified in this bounded review. This is not an exhaustive proof of absence.
- Automated verified: named checks passed at a stated commit and environment. State the tested boundary.
- UAT accepted: a named reviewer accepted stated scenarios on a stated build. No application feature has this status from this review.

All rows below have runtime verification pending unless stated otherwise. Evidence paths are navigational pointers. For a changed feature, add its detailed contract using the task template, test evidence and owner acceptance.

| ID | Capability and user purpose | Implementation evidence | Status and next verification |
| --- | --- | --- | --- |
| F-001 | Local account creation and sign-in | src/pages/Auth.tsx; src/contexts/AuthContext.tsx; electron/main.cjs | Code present; verify first admin, staff, inactive account, incorrect password and restart. Remembered email is not a remembered authenticated session |
| F-002 | Firm, partner, team and client masters | src/pages/Settings.tsx; src/hooks/useFirmSettings.ts; src/hooks/useClients.ts; src/hooks/useTeamMembers.ts | Code present; exercise create/update, validation, permissions, persistence and duplicate handling |
| F-003 | Engagement creation and selection | src/pages/Engagements.tsx; src/pages/SelectEngagement.tsx; src/contexts/EngagementContext.tsx | Code present; verify user access, selected-context reset, year and client consistency |
| F-004 | Appointment, eligibility and previous-auditor communication | src/pages/Appointment.tsx; src/components/appointment; src/hooks/useEligibilityCertificate.ts; src/hooks/usePreviousAuditorCommunication.ts | Code present; compare master data, saved edits and generated letters; no legal approval inferred |
| F-005 | Engagement letter templates and generation | src/components/appointment/Letters.tsx; src/services/engagementLetterEngine.ts; src/services/engagementLetterDocxTemplate.ts | Code present; test merge fields, custom template, missing data and exported document |
| F-006 | Threshold and reporting applicability | src/pages/ComplianceApplicability.tsx; src/lib/taxAuditApplicability.ts | Code present; rules require period-specific source review and boundary tests |
| F-007 | TB import, classification and financial review | src/pages/FinancialReview.tsx; src/hooks/useEngagementTrialBalance.ts; src/services/trialBalanceNewClassification.ts; src/utils/classificationRules.ts | Code present; reconcile imported totals, signs, duplicates, overrides, period, save and reopen; multiple TB stores require mapping |
| F-008 | Tally and stock extraction | src/hooks/useTallyODBC.ts; electron/main.cjs; src/pages/FinancialReview.tsx | Code present; real driver and supported Tally setup required; confirm company, dates, row counts and totals |
| F-009 | Financial statement faces, notes and export | src/pages/FinancialReview.tsx; src/utils/financialExport.ts; src/utils/noteBuilder.ts; src/data/entityTypeConfig.ts | Code present; scope conflicts with original Phase I; validate statement-to-TB ties and all exported formats |
| F-010 | Materiality and risk assessment | src/pages/Materiality.tsx; materiality_risk_assessment schema | Code present; verify selected benchmark, units, percentages, rationale and engagement persistence |
| F-011 | Risk register | src/pages/RiskRegister.tsx; src/hooks/useRisks.ts | Code present; verify risk linkage, updates and assignment restrictions |
| F-012 | Audit programmes and procedure workpapers | src/pages/AuditExecution.tsx; src/pages/ProcedureWorkpaper.tsx; src/hooks/useAuditExecution.ts | Code present; verify template versus engagement copy, assignees, attachments and review state |
| F-013 | Evidence storage and review | src/hooks/useEvidenceFiles.ts; src/pages/EvidenceVault.tsx; electron/preload.cjs | T-003 actual Electron IPC tests showed unauthenticated path/save/download/delete access and writes to locked/approved metadata. Engagement binding and evidence-state policy are not enforced/defined; see SECURITY_AND_AUDIT.md |
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
| F-024 | Feedback and administrative views | src/pages/Feedback.tsx; src/pages/AdminDashboard.tsx; src/pages/AdminSettings.tsx | UI route guards exist, but T-003 showed direct IPC client updates and role changes are not constrained by those guards; see SECURITY_AND_AUDIT.md |
| F-025 | Desktop launch, installation and update | electron/run-electron.cjs; electron/main.cjs; electron/auto-updater.cjs; .github/workflows/release.yml | Two clean Windows installs with native rebuild and synthetic SQLite/bcrypt Electron smoke passed on Node.js 24.12.0/npm 11.6.2; Electron launch, installer, other platforms and feed owner remain unverified |
| F-026 | Backup and restore of the complete audit file | Database/file/localStorage stores identified in architecture | Not established; define consistent backup, restoration and failure recovery before claiming recoverability |
| F-027 | AI grounded guidance and anomaly detection | Supplied AI blueprint; no verified provider and RAG execution path in reviewed runtime | Not established; scope decision and evaluation needed before implementation |
| F-028 | Shared session knowledge and repeatable workflows | AGENTS.md; CLAUDE.md; .github/copilot-instructions.md; docs/project | Documentation implemented in this change; structural checks recorded in CURRENT_STATUS.md; actual IDE loading requires per-client smoke test |

## Coverage limits

The original Phase I also requests searchable audit checklist and MRL formats and line-item workpaper linkage. Programmes, templates and evidence exist, but their exact coverage against those original requirements is not established. Treat this as task T-005, not an assertion that these capabilities are complete. The tax guidance PDFs supplied in this conversation were not audited clause by clause during this documentation review.
