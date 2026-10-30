# ICAI VERA application documentation review

Prepared for CA Venugopal Gella on 30 October 2026.

Source baseline: `cc5c04729604fba7d05240a07f24682e0644665c`. Package version: 0.9.1.

## Purpose of this review

This document describes what the application is intended to do, what exists in the reviewed code, the scope of recorded verification, and what still needs a decision or implementation. It brings the documentation work back to the original objective: one maintained product record that the owner and every new coding session can understand.

The current application is Electron desktop software using local SQLite and files, with selected external integrations. Installation/native smoke and selected helper/IPC checks have reported passing evidence. Much of the renderer workflow and professional content remains unaccepted. Misstatements and Completion are sample-driven prototypes. Missing classification/IFC schema, recovery, session identity, legacy evidence and policy questions remain visible.

This is a documentation-only change. No application behaviour, dependency, migration or security enforcement is changed. Source inspection and generated catalogues are not a claim of current-law validation or product acceptance. Owner decisions can approve intended behaviour without asserting that the implementation already satisfies it.

## How to review

Read the coverage overview, then the module descriptions relevant to the intended next release. All 16 decision groups are collected at the end. Record corrections, exclusions and approved choices by their review ID. The 1,055-column technical appendix is available separately; it need not interrupt the business review.

This assembled edition is derived from the canonical files in modules and the coverage/decision registers at this baseline. Later edits belong in those canonical records; reassemble the review edition when their content changes.

## Contents

- Coverage overview
- Modules M-01 to M-19
- Open gaps and acceptance limits
- Consolidated owner decisions
- Technical appendices and next documentation step


## Coverage overview


Documentation review date: 30 October 2026. Source baseline: `cc5c04729604fba7d05240a07f24682e0644665c`. Covers all 28 retained feature IDs in 19 module specifications. The source-derived requirement list is in [traceability](REQUIREMENTS_TRACEABILITY.md). Exact base-schema fields are in [field catalogue](SCHEMA_FIELD_CATALOG.md).

Code present means a source path exists. Partial means a known implementation/control/verification gap remains. Prototype means sample or non-persisting behaviour drives the screen. Reported automated evidence describes only the stated tests. No feature is marked owner-UAT accepted by this review. More rows or green tests do not establish legal or product completeness.

| Feature | Capability | Detailed module | Requirement source | Implementation state | Verification boundary | Existing evidence and remaining gap |
| --- | --- | --- | --- | --- | --- | --- |
| F-001 | Local account creation and sign-in | [M-01](modules/M-01.md) | Repository-derived | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify first admin, staff, inactive account, incorrect password and restart. Remembered email is not a remembered authenticated session |
| F-002 | Firm, partner, team and client masters | [M-02](modules/M-02.md) | REQ-P02, REQ-P03, REQ-P04 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; exercise create/update, validation, permissions, persistence and duplicate handling |
| F-003 | Engagement creation and selection | [M-03](modules/M-03.md) | REQ-P03, REQ-P04, REQ-P18 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify user access, selected-context reset, year and client consistency |
| F-004 | Appointment, eligibility and previous-auditor communication | [M-04](modules/M-04.md) | REQ-P08, REQ-P10, REQ-P25 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; compare master data, saved edits and generated letters; no legal approval inferred |
| F-005 | Engagement letter templates and generation | [M-04](modules/M-04.md) | REQ-P09, REQ-P25 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; test merge fields, custom template, missing data and exported document |
| F-006 | Threshold and reporting applicability | [M-05](modules/M-05.md) | REQ-P11, REQ-P12, REQ-P26 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; rules require period-specific source review and boundary tests |
| F-007 | TB import, classification and financial review | [M-06](modules/M-06.md) | REQ-P06, REQ-P07, REQ-P13, REQ-P14, REQ-P17, REQ-P18, REQ-P23 | Partial / scoped evidence | Reported classification/bulk helper tests and selected IPC TB checks. Renderer import and missing classification schema pending. | Code present; reconcile imported totals, signs, duplicates, overrides, period, save and reopen; multiple TB stores require mapping |
| F-008 | Tally and stock extraction | [M-06](modules/M-06.md) | REQ-P13 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; real driver and supported Tally setup required; confirm company, dates, row counts and totals |
| F-009 | Financial statement faces, notes and export | [M-07](modules/M-07.md) | REQ-P06, REQ-P07, REQ-P14, REQ-P15, REQ-P17, REQ-P18, REQ-P23, REQ-P27 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; scope conflicts with original Phase I; validate statement-to-TB ties and all exported formats |
| F-010 | Materiality and risk assessment | [M-08](modules/M-08.md) | REQ-P05, REQ-P17, REQ-P22, REQ-P23 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify selected benchmark, units, percentages, rationale and engagement persistence |
| F-011 | Risk register | [M-08](modules/M-08.md) | REQ-P22 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify risk linkage, updates and assignment restrictions |
| F-012 | Audit programmes and procedure workpapers | [M-09](modules/M-09.md) | REQ-P10, REQ-P16, REQ-P18, REQ-P24, REQ-P25, REQ-B04 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify template versus engagement copy, assignees, attachments and review state |
| F-013 | Evidence storage and review | [M-10](modules/M-10.md) | REQ-P10, REQ-P16, REQ-B07 | Partial / scoped evidence | Reported selected IPC suite: 26/26. Real UI upload, legacy migration and transition policy pending. | Backend now enforces authenticated, engagement-scoped file path/save/download access with canonical path ownership (path inside the engagement folder, unique, immutable), manager-level byte deletion, and a scoped uploader rollback IPC in active handlers. Evidence lock/approval/reopen transition policy remains unresolved; see SECURITY_AND_AUDIT.md |
| F-014 | Review notes | [M-11](modules/M-11.md) | Repository-derived | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify state transitions, reviewer roles, resolution evidence and engagement isolation |
| F-015 | Misstatement recording and evaluation | [M-11](modules/M-11.md) | Repository-derived | Prototype | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Prototype; sampleMisstatements and sampleMateriality drive results; Add closes dialog without persistence |
| F-016 | Completion, sign-off and file locking | [M-12](modules/M-12.md) | Repository-derived | Prototype | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Prototype; sampleCompletionChecklist drives progress; no verified durable whole-file finalization or export |
| F-017 | Activity and audit history | [M-12](modules/M-12.md) | REQ-B07 | Partial / scoped evidence | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Partial; database-backed logging paths exist, but complete coverage, immutable storage and log export are unproven |
| F-018 | Statutory audit report, CARO and IFC drafts | [M-13](modules/M-13.md) | REQ-P12, REQ-P26, REQ-B04 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify saved edits, annexures, approval, preview/export consistency and professional review |
| F-019 | Tax-audit setup, acceptance and clause workflow | [M-14](modules/M-14.md) | REQ-P26, REQ-B04, REQ-B05 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; library tagged AY 2025-26; verify structured clause fields, prefill provenance and saving |
| F-020 | Tax-audit readiness, programme and internal report pack | [M-14](modules/M-14.md) | Repository-derived | Code present | Reported tax helper suite: 8 files / 37 tests. No statutory approval. | `npx vitest run src/lib` passed (8 files, 37 tests) in the T-002 environment; statutory accuracy and full product acceptance remain unverified |
| F-021 | Draft Forms 3CA, 3CB and 3CD exports | [M-14](modules/M-14.md) | REQ-P26, REQ-B04 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; 3CD Word/Excel/PDF/HTML exporters exist, superseding older exclusion claims; signed form or portal acceptance not established |
| F-022 | GSTZen login, GSTIN session and GSTR-1 retrieval | [M-15](modules/M-15.md) | REQ-B06, REQ-B08 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; external connectivity, credentials, consent, pagination and error handling need integration tests |
| F-023 | Audit calculators | [M-16](modules/M-16.md) | REQ-P19, REQ-P20, REQ-P21 | Code present | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Code present; verify each calculator independently, including depreciation, deferred tax, current tax and ratio inputs and formula basis |
| F-024 | Feedback and administrative views | [M-02](modules/M-02.md) | Repository-derived | Partial / scoped evidence | Reported selected backend authorization checks; admin UI and final role-policy acceptance pending. | UI route guards remain secondary; active backend IPC now enforces authenticated and role/engagement-constrained operations for tested paths. Final role matrix decisions (`viewer`/`user`) remain open; see SECURITY_AND_AUDIT.md |
| F-025 | Desktop launch, installation and update | [M-17](modules/M-17.md) | REQ-P01, REQ-B03 | Partial / scoped evidence | Reported two clean Windows installs and native smoke. No installer or cross-platform acceptance. | Two clean Windows installs with native rebuild and synthetic SQLite/bcrypt Electron smoke passed on Node.js 24.12.0/npm 11.6.2; Electron launch, installer, other platforms and feed owner remain unverified |
| F-026 | Backup and restore of the complete audit file | [M-17](modules/M-17.md) | REQ-P01, REQ-B07 | Not established | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Not established; define consistent backup, restoration and failure recovery before claiming recoverability |
| F-027 | AI grounded guidance and anomaly detection | [M-18](modules/M-18.md) | REQ-P26, REQ-B01, REQ-B02, REQ-B03, REQ-B05, REQ-B08 | Not established | No feature-wide UI/UAT acceptance recorded. Code existence only unless stated in module. | Not established; scope decision and evaluation needed before implementation |
| F-028 | Shared session knowledge and repeatable workflows | [M-19](modules/M-19.md) | Repository-derived | Partial / scoped evidence | Structural docs checks and manual context recovery; automatic cross-client loading unverified. | Documentation implemented in this change; structural checks recorded in CURRENT_STATUS.md; actual IDE loading requires per-client smoke test |

## Coverage conclusion

The documentation now maps every retained feature and enumerated source requirement to a detailed module. Product gaps remain in sample-driven screens, missing classification/IFC tables, evidence migration, session identity, professional source validation, recovery and UI acceptance. These are documented implementation/decision items, not omissions silently filled by this documentation exercise.

Some feature-register rows describe older review history. Where a module records a newer scoped result at this baseline, retain both the historic observation and latest evidence date rather than rewriting an earlier test as if it ran later.


## M-01 Accounts and access

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-001. Requirement links: Repository-derived capability; no original Phase I requirement asserted.

### Purpose and current boundary

Provide a named local identity for audit work. Account authentication, global role, engagement assignment and evidence state are distinct controls. The current process stores one module-wide authenticated identity. This is not a verified multi-window session model.

### Source paths

- [src/pages/Auth.tsx](../../src/pages/Auth.tsx)
- [src/contexts/AuthContext.tsx](../../src/contexts/AuthContext.tsx)
- [electron/main.cjs](../../electron/main.cjs)
- [electron/sqlite-authorization.cjs](../../electron/sqlite-authorization.cjs)

### Observed workflow

1. Open sign-in or sign-up; enter local account details.

2. Validate and create the profile with a bcrypt password hash; the first local account receives admin and subsequent accounts receive staff in the active signup handler.

3. On login, load active profile and roles, then select an accessible engagement.

4. Clear the process identity on logout; AuthContext also signs out on startup. The remembered email is convenience state.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| email, password | Login inputs; profiles stores email and password_hash | Backend requires credentials and rejects inactive/invalid accounts. No password is documented as stored by Remember Me. |
| full_name, signupConfirmPassword | Sign-up UI and profile | Confirmation is a UI field; professional identity checks and onboarding policy need approval. |
| is_active | profiles integer flag | Authorization context rechecks active-account availability; recovery and deactivation workflows need UI verification. |
| role | user_roles; multiple role rows are possible | Backend supports admin, partner, manager, senior and staff; viewer/user policy remains open. |
| user_id, engagement_id | engagement_assignments | Non-global users are scoped through assignment; global access is currently granted to admin/partner. |

### Rules and permissions

- A renderer button or route guard does not grant backend access. Active sqlite-query and evidence handlers enforce the scoped T-003 controls.

- The renderer-trust check and module-wide session identity remain documented limitations. Do not describe the application as safe against an untrusted renderer.

- Password-reset screens and APIs must be separately exercised before treating local recovery as available.

### Outputs

Local sign-in state, profile and role context; activity attribution where the calling workflow logs it.

### Verification and gaps

IPC authentication and selected permission tests were reported passing. Automatic coding-agent context loading, recovery, multi-window identity and complete user-administration UAT are unverified.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-01-01: Sign up first admin and subsequent staff; login with correct, incorrect and inactive credentials.

- AC-M-01-02: After logout, direct protected query/file calls are denied; switching user removes stale engagement context.

- AC-M-01-03: Open a second window and document session behaviour before any multi-window support claim.

### Owner decisions

RV-03, RV-04. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-02 Firm client partner and team masters

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-002, F-024. Requirement links: REQ-P02, REQ-P03, REQ-P04.

### Purpose and current boundary

Maintain the identity and contact data used throughout engagements and generated documents. Firm identity, signing partner, application user and client are different records and should not be conflated.

### Source paths

- [src/pages/Settings.tsx](../../src/pages/Settings.tsx)
- [src/hooks/useFirmSettings.ts](../../src/hooks/useFirmSettings.ts)
- [src/hooks/useClients.ts](../../src/hooks/useClients.ts)
- [src/hooks/usePartners.ts](../../src/hooks/usePartners.ts)
- [src/hooks/useTeamMembers.ts](../../src/hooks/useTeamMembers.ts)
- [src/pages/AdminSettings.tsx](../../src/pages/AdminSettings.tsx)

### Observed workflow

1. Load firm settings and active clients, partners and team members.

2. Create or edit permitted master details in the relevant settings/client workflow.

3. Associate the selected client, partner and team with an engagement.

4. Reuse master values in appointment, tax-audit and report setup; review changed values before regeneration.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| firm_name, firm_registration_no, constitution | firm_settings | Firm-name fallback exists in the save hook; verify required identity before generating documents. |
| no_of_partners, icai_unique_sl_no, address | Firm settings hook/form | Some hook fields are not declared in the base schema; source contracts and startup migrations must be reconciled before asserting persistence. |
| name, industry, constitution, contact_person, contact_email, status | clients and active-client hook | Active-client list filters status=active; field-by-field validation and duplicate rules need owner review. |
| membership_number, date_of_joining, date_of_exit, is_active, user_id | partners | Partner master and login user are linked where configured; signing eligibility is a professional review matter. |
| full_name, email, phone, role | Settings team form, profiles/user_roles | UI role labels include viewer/user but their backend policy is unresolved; a role label is not working permission evidence. |
| GSTIN details | client_gstins | Keep client GST registration identity distinct from GSTZen external session identity. |

### Rules and permissions

- Backend core-table mutations currently require manager level for insert/update and partner-level for delete. Treat this as observed implementation, not final owner approval.

- Profile self-edit has a separate protected-field allowlist; administrator recovery and team operations need end-to-end verification.

- Do not let master edits silently change an already reviewed historical report without a recorded update policy.

### Outputs

Selected master records, reusable document values, team role views and administrative configuration.

### Verification and gaps

Code paths exist. Current tests do not certify every settings, invitation, role-change or master edit flow. Effective runtime schema parity is not established merely from TypeScript interfaces.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-02-01: Create and edit a synthetic client, firm and partner; reopen and compare every saved field.

- AC-M-02-02: Change a master value after generating a report and verify the agreed historical-versus-current-value treatment.

- AC-M-02-03: Confirm permitted and forbidden master edits for each approved role.

### Owner decisions

RV-03, RV-05. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-03 Engagement selection assignment and dashboards

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-003. Requirement links: REQ-P03, REQ-P04, REQ-P18.

### Purpose and current boundary

An engagement identifies the client, year, audit type, team and working context. It is the principal boundary for balances, procedures, evidence and report data. Dashboard counts summarise underlying records and do not independently prove completion.

### Source paths

- [src/pages/Engagements.tsx](../../src/pages/Engagements.tsx)
- [src/pages/SelectEngagement.tsx](../../src/pages/SelectEngagement.tsx)
- [src/contexts/EngagementContext.tsx](../../src/contexts/EngagementContext.tsx)
- [src/hooks/useEngagements.ts](../../src/hooks/useEngagements.ts)
- [src/pages/dashboard/EngagementDashboard.tsx](../../src/pages/dashboard/EngagementDashboard.tsx)

### Observed workflow

1. Create/open an engagement with its client, year and audit type.

2. Assign users and responsible partner/manager as permitted.

3. Select the engagement before entering engagement-protected screens.

4. Load refreshed engagement data and persist selection in auditpro_current_engagement; clear it on session reset.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| name, client_id, client_name | engagements | Name/client label required by declared schema; client_id can be null. Decide whether every production engagement must use a master client. |
| financial_year, engagement_type | engagements | Year is required; statutory is the schema default audit type. A display label does not establish supported methodology for every type. |
| status | engagements | Declared values: planning, fieldwork, review, completion. This is not a verified whole-file lock. |
| partner_id, manager_id, start_date, end_date | engagements | Ownership/assignment and chronology need agreed validations. |
| materiality_amount, performance_materiality, trivial_threshold | engagements | Other modules have their own stored materiality JSON. Confirm which amount is authoritative for downstream evaluation. |
| engagement_id, user_id, role, assigned_by | engagement_assignments | Unique engagement/user pair in schema; current backend checks assignments for non-global users. |

### Rules and permissions

- The backend auto-assigns an inserted engagement to its creator; verify that the UI can select and use it immediately.

- Changing selection or user must clear stale results and restrict every indirect record, not only the screen route.

- No year rollover, cloning or retention behaviour is accepted without a specified scope and scenario.

### Outputs

Accessible engagement list, selected working context, assignment records and dashboard summaries.

### Verification and gaps

Engagement filtering and selected IPC operations have automated evidence. Full create-to-report workflow, rollover and restart persistence require UI verification.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-03-01: Create two clients and two years, then switch between engagements and users without data carry-over.

- AC-M-03-02: Create an engagement as a permitted non-global user and verify creator access.

- AC-M-03-03: Check dashboard totals against known synthetic records and exclude sample-driven indicators.

### Owner decisions

RV-01, RV-03, RV-05. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-04 Appointment communications and engagement letters

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-004, F-005. Requirement links: REQ-P08, REQ-P09, REQ-P10, REQ-P25.

### Purpose and current boundary

Organise appointment documents, eligibility communication, previous-auditor communication and engagement-letter generation. Phase I asks for appointment/engagement documentation and upload of plan/scope, not automatic approval of appointment or audit independence.

### Source paths

- [src/pages/Appointment.tsx](../../src/pages/Appointment.tsx)
- [src/components/appointment/Letters.tsx](../../src/components/appointment/Letters.tsx)
- [src/types/engagementLetter.ts](../../src/types/engagementLetter.ts)
- [src/services/engagementLetterEngine.ts](../../src/services/engagementLetterEngine.ts)
- [src/services/engagementLetterDocxTemplate.ts](../../src/services/engagementLetterDocxTemplate.ts)
- [src/hooks/useEligibilityCertificate.ts](../../src/hooks/useEligibilityCertificate.ts)
- [src/hooks/usePreviousAuditorCommunication.ts](../../src/hooks/usePreviousAuditorCommunication.ts)

### Observed workflow

1. Select engagement and collect appointment documents.

2. Review entity, period, auditor and commercial details.

3. Select the appropriate letter variation and template; populate conditional sections.

4. Preview, edit as supported, generate the Word output and retain supporting evidence.

5. Upload plan/scope documents using the evidence flow; exact Phase I indexing remains a review item.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| entity_name, entity_type, entity_status, registration_no, pan, gstin | EntityDetails contract | Entity type union includes Company, Partnership, LLP and Trust. Domain coverage beyond these values is not implied. |
| financial_year, assessment_year, balance_sheet_date, appointment_date | EngagementPeriod | Dates are string contracts; legal appointment validity and chronology need professional review. |
| firm_name, firm_reg_no, partner_name, partner_mem_no, place, letter_date | AuditorDetails | Reconcile generated identity with selected firm and signing partner. |
| professional_fees, taxes_extra, payment_terms, out_of_pocket_exp | CommercialTerms | Currency defaults are described by the contract; commercial choices remain owner/client input. |
| mgmt_responsibility_ack, books_responsibility_ack, internal_control_ack, fraud_prevention_ack | ManagementResponsibilities | Acknowledgements in a data model do not prove executed engagement acceptance. |
| ifc_applicable, caro_applicable, ind_as_applicable, tax_audit_form | Conditional letter configuration | Variations include company with/without IFC and partnership tax audit 3CA/3CB; validate selected wording. |

### Rules and permissions

- Preserve the distinction between an uploaded appointment letter, generated engagement draft and signed client acceptance.

- Missing merge fields, unsupported template combinations and changed master values must be visible to the reviewer.

- Searchable MRL library coverage is not established by the existence of engagement-letter templates.

### Outputs

Word letter drafts, previews, stored template metadata, appointment evidence and communication documents.

### Verification and gaps

Generators and hooks are present. Export content, pagination, persistence of every communication and professional wording require review. Current evidence upload restrictions apply to appointment attachments too.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-04-01: Generate each configured letter variation from one synthetic client and compare all substituted values.

- AC-M-04-02: Use a custom template with a missing field; verify the reviewer can identify the omission.

- AC-M-04-03: Save edited communication, reopen, export and compare; separately record signed acceptance.

### Owner decisions

RV-02, RV-05, RV-06. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-05 Applicability and reporting requirements

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-006. Requirement links: REQ-P11, REQ-P12, REQ-P26.

### Purpose and current boundary

Collect entity and financial facts to assist evaluation of reporting requirements. Statutory applicability and tax-audit applicability have separate code paths. This specification records their inputs and implementation; it does not validate current legal thresholds.

### Source paths

- [src/pages/ComplianceApplicability.tsx](../../src/pages/ComplianceApplicability.tsx)
- [src/lib/taxAuditApplicability.ts](../../src/lib/taxAuditApplicability.ts)
- [src/lib/taxAuditReportFormSelection.ts](../../src/lib/taxAuditReportFormSelection.ts)

### Observed workflow

1. Set engagement, entity class and denomination.

2. Enter current/prior financial facts, constitution and relevant yes/no conditions.

3. Evaluate and review result reasons and source references.

4. Save inputs/results and apply the relevant tax-audit form selection where required.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| denomination | Compliance UI unit map | Ones, thousands, lakhs and crores scale entered values; test conversion before threshold comparison. |
| cyTurnover, cyCapital, pyTurnover, pyNetworth, pyBorrowings, pyNetprofit | Compliance UI payload | Confirm the year and balance/date basis for each input. |
| entityClass, constitution, subConstitution, dormant | Compliance UI payload | Company and non-company classifications drive different branches; unsupported forms must not be inferred. |
| has_business_activity, has_professional_activity, business_turnover, professional_gross_receipts | TaxAuditApplicabilitySetup | New business/profession flags coexist with legacy fields; resolve source precedence explicitly. |
| cash_receipts_percent, cash_payments_percent, presumptive_section, lower_than_presumptive | Tax applicability input | Helper normalises invalid/negative numeric input to zero and caps percentages above 100 with a warning; this is observed code behaviour, not approved data-entry policy. |
| inputs, results, reasons | compliance_applicability JSON text | Persist both source facts and explanatory output; current-law source/version review remains open. |

### Rules and permissions

- Tax helper result vocabulary includes Applicable, Not applicable, Review required and Not assessed. Unknown data must be reviewed separately from a true zero.

- Code constants and links are not proof that the law is current or applicable to the engagement year.

- Before approving legal logic, reconcile the Act/Rules/form version, effective period, facts and professional interpretation.

### Outputs

Applicability result, reasons, warnings and suggested tax-audit form, subject to professional review.

### Verification and gaps

Tax helper tests were reported passing. Complete legal accuracy, all entity combinations and UI-to-save behaviour remain unverified.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-05-01: Run values below, equal to and above every configured threshold with correct denomination and year.

- AC-M-05-02: Test missing facts, mixed business/profession and presumptive cases without silently treating unknown as zero.

- AC-M-05-03: Save/reopen inputs and confirm result reasons and form selection remain consistent.

### Owner decisions

RV-01, RV-06, RV-07. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-06 Trial balance classification and Tally ingestion

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-007, F-008. Requirement links: REQ-P06, REQ-P07, REQ-P13, REQ-P14, REQ-P17, REQ-P18, REQ-P23.

### Purpose and current boundary

Import and classify financial data while preserving its source figures. The active FinancialReview page is selected by both trial-balance and financial-review routes. Legacy and newer TB structures coexist; migration and source-of-truth ownership must be explicit.

### Source paths

- [src/pages/FinancialReview.tsx](../../src/pages/FinancialReview.tsx)
- [src/hooks/useEngagementTrialBalance.ts](../../src/hooks/useEngagementTrialBalance.ts)
- [src/services/trialBalanceNewClassification.ts](../../src/services/trialBalanceNewClassification.ts)
- [src/utils/classificationRules.ts](../../src/utils/classificationRules.ts)
- [src/hooks/useTallyODBC.ts](../../src/hooks/useTallyODBC.ts)
- [electron/main.cjs](../../electron/main.cjs)

### Observed workflow

1. Select client/engagement, current or prior period, financial year and source.

2. For Tally, confirm connectivity, target company and date range; for spreadsheet input inspect the selected file/columns.

3. Import ledger movements/balances and stock data through the supported path.

4. Assign classification groups, apply reviewed overrides, and inspect unmapped/exception rows.

5. Save and reopen the engagement data; reconcile source row counts and balances before statement use.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| engagement_id, period_type, financial_year, source_type, imported_at, imported_by | engagement_trial_balance_header | Unique engagement/year/period tuple; declared period values CY/PY. |
| ledger_name, ledger_guid, primary_group, parent_group, composite_key | engagement_trial_balance_lines | Unique header/composite-key pair; verify key generation and repeated-import handling. |
| opening, debit, credit, closing, dr_cr, is_revenue | Saved ledger lines | Preserve source signs and units; data display scaling is separate from stored amounts. |
| H1 to H5 and custom group settings | Classification code, mapping tables and renderer storage | Determine current versus global overrides and persistence location before interpreting output. |
| opening_qty/value, closing_qty/value, unit | tb_new_stock_items plus renderer localStorage | Stock and entity state also have renderer storage paths; database-only recovery is incomplete. |
| engagement_tb_classification | Called by active TB hook; missing from declared schema | T-017 records missing-table behaviour. Authorization mapping is forward-looking, not proof classification persistence works. |

### Rules and permissions

- New authorization coverage includes TB headers/lines and requires a line to match its header engagement. Reported IPC tests do not exercise the full renderer import.

- Existing classification and bulk-update regressions passed; they do not prove every industry mapping or data import.

- Tally extraction is an external/native integration with driver, company and period preconditions. A cached connection flag is not current connectivity proof.

### Outputs

Actual and classified TB views, stock data, exceptions, grouping inputs and spreadsheet exports where wired.

### Verification and gaps

Missing classification schema, UI import/reopen, live Tally/ODBC and full reconciliation remain open. No sample client data was imported in this documentation pass.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-06-01: Import a balanced synthetic current/prior TB and check ledger count, debits/credits, signs and totals after reopen.

- AC-M-06-02: Repeat import with duplicates, zero rows and changed classifications; verify deterministic replacement/merge behaviour.

- AC-M-06-03: Attempt cross-engagement TB mutation and mismatched header/line; prove permitted own-engagement import still succeeds.

- AC-M-06-04: Exercise Tally unavailable, wrong company and interrupted import without partial silent success.

### Owner decisions

RV-01, RV-02, RV-05, RV-08. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-07 Financial statements notes and layouts

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-009. Requirement links: REQ-P06, REQ-P07, REQ-P14, REQ-P15, REQ-P17, REQ-P18, REQ-P23, REQ-P27.

### Purpose and current boundary

Present classified balances as statement faces and notes, with entity-specific labels and editable layout/formula configuration. The current implementation goes beyond the original Phase I exclusion of financial-statement preparation. Preserve the code while the owner confirms the release boundary.

### Source paths

- [src/pages/FinancialReview.tsx](../../src/pages/FinancialReview.tsx)
- [src/data/entityTypeConfig.ts](../../src/data/entityTypeConfig.ts)
- [src/utils/financialExport.ts](../../src/utils/financialExport.ts)
- [src/utils/noteBuilder.ts](../../src/utils/noteBuilder.ts)
- [src/utils/noteFaceBuilder.ts](../../src/utils/noteFaceBuilder.ts)
- [src/utils/statementFormula.ts](../../src/utils/statementFormula.ts)
- [src/utils/computePLNoteValues.ts](../../src/utils/computePLNoteValues.ts)

### Observed workflow

1. Choose the entity configuration and ensure classified current/prior data are reconciled.

2. Review balance-sheet and profit-and-loss faces and their note groupings.

3. Configure row labels, formulas, visibility, numbering and presentation as supported.

4. Preview and export supported formats; check every output against the same saved input snapshot.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| Entity category and label set | src/data/entityTypeConfig.ts | Company/NCE-oriented labels do not establish compliance for every entity or accounting framework. |
| Technical classification and row identifiers | Classification/layout utilities | Identifiers referenced by formulas and exports must remain stable when display labels change. |
| Current/prior values, number scale and rounding | FinancialReview and export utilities | Review sign, units and rounding consistency across faces, notes and exports. |
| Formula expressions and variables | statementFormula.ts and layout editor | Validate referenced rows/variables and error presentation; formulas are not evidence of financial correctness. |
| Note numbering and visibility | noteNumbering and note builders | Verify missing, duplicate, reordered and suppressed notes. |
| statement_layout_config and classification/group settings | Renderer localStorage plus relevant stored templates | Historical snapshot and backup treatment are unresolved. |

### Rules and permissions

- Statement preparation versus management-statement comparison is an open scope decision, not resolved by the existence of a layout editor.

- A statement must reconcile to source figures and approved adjustments. Never change source balances to eliminate a presentation difference.

- The old FINANCIAL_STATEMENTS_ARCHITECTURE document includes design references that require current-path validation.

### Outputs

Statement faces, notes, configured layouts and supported spreadsheet/document output paths. Exact format completeness must be demonstrated per output.

### Verification and gaps

Build and selected classification helpers passed. Statement-to-TB reconciliation, accounting-standard coverage, editable export fidelity and visual output acceptance remain pending.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-07-01: Tie each face and note total to one synthetic TB and preserve current/prior figures across format outputs.

- AC-M-07-02: Change labels without breaking formula identifiers, note references or import/export compatibility.

- AC-M-07-03: Test long notes, negative balances, zero values, suppressed rows and changed layout settings after restart.

### Owner decisions

RV-02, RV-05, RV-06, RV-08. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-08 Materiality and risk register

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-010, F-011. Requirement links: REQ-P05, REQ-P17, REQ-P22, REQ-P23.

### Purpose and current boundary

Document the auditor’s materiality judgement, risk-factor assessment and engagement risk register. System suggestions and percentages are aids; they are not professional conclusions.

### Source paths

- [src/pages/Materiality.tsx](../../src/pages/Materiality.tsx)
- [src/pages/RiskRegister.tsx](../../src/pages/RiskRegister.tsx)
- [src/hooks/useRisks.ts](../../src/hooks/useRisks.ts)

### Observed workflow

1. Load engagement header and current financial facts, including values sourced from applicability where implemented.

2. Assess risk factors, scores, system risk and auditor override/rationale.

3. Select a benchmark and percentage; calculate overall, performance and clearly trivial amounts.

4. Save JSON state and risk-register records, then review/export the working paper.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| profitBeforeTax, revenue, totalAssets, netWorth, othersAmount/Name | Materiality payload | Numeric input strips separators and non-numeric characters; negative and unknown input treatment requires review. |
| benchmark, percentage, omAmount | Materiality calculation | Overall amount follows selected base and percentage; code rounds to two decimals. Initial percentage is a UI default, not an approved methodology. |
| pmPercentage, pmAmount, ctPercentage, ctAmount | Materiality calculation | Performance and trivial amounts are percentages of overall materiality, rounded to two decimals. |
| riskFactors, riskItems, totalRiskScore, systemRisk, finalRisk, remarks | risk_state JSON | Auditor override is distinct from system risk and needs retained rationale. |
| materialityStage, preparedBy, reviewedBy, date, rationale | materiality_state JSON | Finalised risk/export controls exist in UI; state labels are not demonstrated backend finalization. |
| risk_area, description, risk_type, inherent_risk, control_risk, combined_risk, audit_response, status | risks | Declared statuses open, mitigated, closed; link risk response to actual procedures/evidence during acceptance. |

### Rules and permissions

- Keep the source and denomination of financial facts visible. Confirm which saved materiality values downstream modules use.

- The page contains a sample-derived initial rationale; decide whether production defaults must be blank or clearly marked guidance.

- Phase I weighting and line-level materiality indicators need an explicit coverage decision; a risk calculator alone does not demonstrate them.

### Outputs

Risk/materiality working paper, saved state, register entries and Excel export code.

### Verification and gaps

Full materiality mathematics, negative/zero inputs, authorisation, sample-default removal and downstream consistency have not been accepted by the owner.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-08-01: Check benchmark × percentage and both downstream amounts with independently calculated examples.

- AC-M-08-02: Test zero/loss-making and scaled input, auditor override, save/reopen and export consistency.

- AC-M-08-03: Verify changing one engagement does not affect another and risk-register status reflects saved records.

### Owner decisions

RV-05, RV-06, RV-07. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-09 Audit programmes procedures and workpapers

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-012. Requirement links: REQ-P10, REQ-P16, REQ-P18, REQ-P24, REQ-P25, REQ-B04.

### Purpose and current boundary

Provide structured workpaper programmes and procedure execution. Standard templates and engagement-specific work are separate records. The original Phase I limits advanced workflow; the implemented programme/review model needs scope confirmation.

### Source paths

- [src/pages/AuditExecution.tsx](../../src/pages/AuditExecution.tsx)
- [src/pages/ProcedureWorkpaper.tsx](../../src/pages/ProcedureWorkpaper.tsx)
- [src/hooks/useAuditExecution.ts](../../src/hooks/useAuditExecution.ts)
- [src/types/auditExecution.ts](../../src/types/auditExecution.ts)

### Observed workflow

1. Select/create an engagement programme or use the available standard programme path.

2. Organise sections and workpaper boxes such as purpose, source, procedure, tests and conclusion.

3. Record procedure/checklist responses and assign staff where supported.

4. Attach supporting material, route review and persist statuses.

5. Reopen the programme and verify links, ordering and evidence.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| name, description, workpaper_reference, engagement_id, client_id, financial_year_id | AuditExecutionProgram | Keep client/year consistent with the parent engagement. |
| audit_program_id, name, order, is_applicable, locked, status | AuditExecutionSection | BoxStatus values are not-commenced, in-progress, review and complete in the TS model; enforceable locks remain policy-dependent. |
| section_id, header, content, order, status, locked | AuditExecutionBox | Rich content and parent changes must remain in the authorised engagement. |
| procedure_name, area, conclusion, assignees | Procedure workflow tables | Audit procedure model and programme-box model coexist; do not imply automatic synchronization. |
| text, status, is_required, remarks, completed_by/at | procedure_checklist_items | Declared checklist statuses pending/completed/na; reason/evidence requirements need owner approval. |
| file_name, file_type, file_size, file_path, uploaded_by, is_evidence | AuditExecutionAttachment | A programme attachment is not automatically equivalent to a reviewed evidence-vault record. |

### Rules and permissions

- The T-003 remediation tests prospective parent ownership for selected checklist/link paths. This does not certify every attachment, section or template operation.

- Template edits must not silently rewrite an engagement copy or previously reviewed conclusion without an agreed policy.

- A downloadable checklist-format library and line-by-line TB links are distinct Phase I requirements needing explicit coverage.

### Outputs

Programme hierarchy, procedure workpapers, checklist status, conclusions and attachments. Complete report-pack export and register search need separate evidence.

### Verification and gaps

Implementation exists, but full UI execution, permitted template operations, attachment handling under new file restrictions and review/lock policy remain unverified.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-09-01: Create an engagement programme, edit/reorder sections and boxes, save/reopen and compare.

- AC-M-09-02: Record checklist responses, assignees and evidence; check linked parent consistency.

- AC-M-09-03: Change a standard template and verify the agreed effect on an existing engagement programme.

### Owner decisions

RV-01, RV-04, RV-09. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-10 Evidence storage review and rollback

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-013. Requirement links: REQ-P10, REQ-P16, REQ-B07.

### Purpose and current boundary

Store evidence metadata and local bytes with engagement-scoped access. Canonical ownership, rollback and basic access have reported IPC evidence. Approval, lock and reopen policy is not finalised.

### Source paths

- [src/pages/EvidenceVault.tsx](../../src/pages/EvidenceVault.tsx)
- [src/hooks/useEvidenceFiles.ts](../../src/hooks/useEvidenceFiles.ts)
- [electron/main.cjs](../../electron/main.cjs)
- [electron/preload.cjs](../../electron/preload.cjs)
- [electron/sqlite-authorization.cjs](../../electron/sqlite-authorization.cjs)

### Observed workflow

1. Choose an engagement and evidence type/reference.

2. Create metadata with a canonical immutable path inside its engagement folder.

3. Upload bytes through the authenticated backend; on upload failure invoke the scoped rollback IPC.

4. Link evidence to permitted procedures or tax-audit clauses and review its content.

5. Prepare/review/approve/lock through available UI actions, while treating final backend transition policy as unresolved.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| engagement_id, name, file_type, mime_type, file_size | evidence_files | Metadata and file bytes must be reconciled; size/type limits and malware handling are policy decisions. |
| file_path | evidence_files + userData/files/evidence | Relative forward-slash path under engagement_id; unsafe segments, non-canonical/duplicate paths rejected. Path cannot change after creation. |
| uploaded_by, created_at | evidence_files | Backend ties upload to the authenticated user; rollback requires uploader and freshness. |
| approval_stage, prepared/reviewed/approved fields, locked and reopen fields | Evidence model/schema | Fields exist; full allowed transition matrix and non-bypassable lock behaviour are not accepted. |
| procedure_id, evidence_id, evidence_requirement_id | evidence_links | Linked objects must share the permitted parent context; requirement must belong to the same procedure. |
| evidenceId for rollbackEvidenceUpload | evidence-upload-rollback IPC | Uploader only, under 10 minutes, draft, unlocked and unlinked. This is implemented behaviour awaiting product acceptance of the timeout. |

### Rules and permissions

- General staff deletion remains denied. Stored-byte deletion now requires manager level, an implementation assumption to be confirmed by the owner.

- Malformed or legacy paths outside engagement_id are inaccessible through current handlers. No migration has been performed in this documentation task.

- The session model and renderer-trust boundary remain limited; canonical paths do not resolve those concerns.

### Outputs

Saved evidence bytes and metadata, procedure/clause links, previews/downloads where supported, and activity/history entries.

### Verification and gaps

The 26-case IPC suite is reported passing. A real renderer upload, interrupted write recovery, legacy-path migration, full lock transitions and production evidence lifecycle UAT are unverified.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-10-01: Upload and download own-engagement evidence through the UI and compare bytes after restart.

- AC-M-10-02: Reject authenticated cross-engagement alias/repoint/traversal/duplicate attempts while permitting valid own uploads.

- AC-M-10-03: Force a write failure and confirm scoped rollback leaves no unintended record/bytes without granting general staff deletion.

- AC-M-10-04: Review legacy evidence inventory before changing paths or treating blocked files as lost.

### Owner decisions

RV-03, RV-04, RV-09, RV-10. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-11 Review notes and misstatements

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-014, F-015. Requirement links: Repository-derived capability; no original Phase I requirement asserted.

### Purpose and current boundary

Capture review questions, responses and resolution. Separately evaluate detected misstatements against actual engagement materiality. Review notes have persistence code; the Misstatements screen is a sample-driven prototype.

### Source paths

- [src/pages/ReviewNotes.tsx](../../src/pages/ReviewNotes.tsx)
- [src/hooks/useReviewNotes.ts](../../src/hooks/useReviewNotes.ts)
- [src/pages/Misstatements.tsx](../../src/pages/Misstatements.tsx)
- [src/data/sampleData.ts](../../src/data/sampleData.ts)

### Observed workflow

1. Create a review note in the selected engagement and optionally link its procedure.

2. Assign it, enter a response, review and resolve as permitted.

3. Retain author, timestamps and review history where implemented.

4. For Misstatements, recognise that the current displayed amounts come from sample records; Add currently closes a dialog rather than saving a real finding.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| title, content, priority, assigned_to, procedure_id | review_notes | Link/assignee ownership, required response and escalation rules need explicit agreement. |
| status, response, resolved_by, resolved_at | review_notes | Declared statuses open/responded/resolved. Check real notifications and resolution permissions. |
| approval_stage, locked and reviewer fields | ReviewNote TS model | Some model fields exceed base declarations; effective runtime parity and lock enforcement are not established. |
| Description, FS area, type, amount, adjusted | Misstatements form | UI/sample concepts only; there is no accepted persistent misstatement data contract in this baseline. |
| Overall materiality, adjusted and unadjusted totals | Misstatements sample calculations | SampleMateriality and sampleMisstatements drive current display; do not use it for an engagement conclusion. |

### Rules and permissions

- A resolved review query and a corrected financial misstatement are different events. Do not assume one automatically updates the other.

- Prospective misstatement requirements must define factual/judgemental/projected classification, adjustment history, sign/netting, tax effects, materiality link and reviewer response. These are review proposals, not implemented fields.

- Notification and audit-history coverage need scenario evidence, not just table existence.

### Outputs

Persisted review notes where the flow works; prototype misstatement list and sample totals. Production misstatement evaluation remains a gap.

### Verification and gaps

T-006 covers persisted misstatements. Review-state policies and UI acceptance remain pending. No production conclusion should depend on sample totals.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-11-01: Create/respond/resolve a review note, reopen and check assignee, engagement and history.

- AC-M-11-02: Verify notification target and that forbidden resolution attempts fail at the backend under approved rules.

- AC-M-11-03: For the future misstatement task, save real synthetic findings and reconcile totals to actual saved engagement materiality.

### Owner decisions

RV-04, RV-07, RV-11. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-12 Completion sign-off and audit history

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-016, F-017. Requirement links: REQ-B07.

### Purpose and current boundary

Assess completion and preserve a record of performed work. Completion and whole-file locking remain prototype capabilities. Activity logging exists, but it is not demonstrated immutable or complete.

### Source paths

- [src/pages/Completion.tsx](../../src/pages/Completion.tsx)
- [src/pages/AuditTrail.tsx](../../src/pages/AuditTrail.tsx)
- [src/hooks/useActivityLogs.ts](../../src/hooks/useActivityLogs.ts)
- [src/data/sampleData.ts](../../src/data/sampleData.ts)

### Observed workflow

1. Inspect engagement completion prerequisites and unresolved matters. The present Completion screen uses a sample checklist.

2. For logged operations, append activity/history records through the calling hook.

3. Display/search recent activity; the activity hook currently loads up to 500 records.

4. Do not infer a durable file lock, a finalization snapshot or a working complete-file export from the current Completion/AuditTrail buttons.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| sampleCompletionChecklist item/category/status/completedBy/completedAt | Sample data and Completion UI | Displayed progress is not based on an accepted persistent completion model. |
| action, entity, entity_id, user_id/name, engagement_id, details, metadata | activity_logs | Coverage depends on each caller invoking the logger; no complete automatic write audit is demonstrated. |
| entity_type, entity_id, action, old_value, new_value, reason, performed_by | audit_trail | Before/after entries exist for selected flows. Retention, tamper evidence and completeness need decisions and tests. |
| engagement status | engagements | Status=completion does not by itself block mutations across the audit file. |

### Rules and permissions

- Whole-file finalization must eventually define prerequisites, authorised reviewer, exceptions, immutable snapshot boundary, reopening reasons and permitted post-signing actions. This is T-007, not implemented by this documentation.

- Export logs must identify filters and include full required history rather than silently presenting a 500-row view as the whole audit trail.

- Local mutable history should not be labelled immutable, blockchain-backed or regulator-certified.

### Outputs

Activity/history screen and selected saved events; completion progress, lock and audit-file export are not accepted production controls.

### Verification and gaps

T-007 and T-009 remain open. The log export button and comprehensive event capture require validation. No whole-file sign-off UAT has been performed.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-12-01: Perform representative edits, evidence actions and role changes; reconcile emitted events with actual operations.

- AC-M-12-02: Specify and later test a finalization snapshot that survives restart and rejects all prohibited writes.

- AC-M-12-03: Export history with more than 500 synthetic events and confirm the approved completeness/filter policy.

### Owner decisions

RV-04, RV-11, RV-12. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-13 Statutory report CARO and IFC drafts

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-018. Requirement links: REQ-P12, REQ-P26, REQ-B04.

### Purpose and current boundary

Assemble editable statutory-audit report drafts and selected CARO/IFC annexures using engagement facts, responses and saved wording. Report generation is not professional approval or evidence that all report requirements are satisfied.

### Source paths

- [src/pages/AuditReport.tsx](../../src/pages/AuditReport.tsx)
- [src/hooks/useAuditReportSetup.ts](../../src/hooks/useAuditReportSetup.ts)
- [src/hooks/useAuditReportDocument.ts](../../src/hooks/useAuditReportDocument.ts)
- [src/hooks/useCAROClauseResponses.ts](../../src/hooks/useCAROClauseResponses.ts)
- [src/hooks/useIFCReportContent.ts](../../src/hooks/useIFCReportContent.ts)
- [src/components/audit-report/ReportExport.tsx](../../src/components/audit-report/ReportExport.tsx)

### Observed workflow

1. Complete report setup and selected framework/entity facts.

2. Review CARO/IFC applicability, clause responses, qualifications and key audit matters.

3. Generate and edit report sections through the saved document workflow.

4. Preview the selected report pack and generate PDF/Word outputs.

5. Compare exported content with the same reviewed inputs and saved edits.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| company_cin, registered_office, nature_of_business, company_type, accounting_framework | AuditReportSetup | Reconcile master facts and framework with the engagement; support breadth needs approval. |
| is_standalone, cash_flow_required, has_branch_auditors, branch_locations, has_predecessor_auditor | Report setup | Conditional sections must match actual engagement facts, not only template flags. |
| caro_applicable_status, caro_exclusion_reason, ifc_applicable and criteria flags | Report setup | Rules and statutory wording require period-specific professional validation. |
| signing_partner_id, report_date, report_city, udin | Report setup | Missing-signature UI warnings do not establish a complete signing/finalization control. |
| section_name, section_title, content_html, changed_by | audit_report_documents | Compare saved edited content with generated content precedence in preview/export. |
| ifc_clause_library and ifc_report_content | Active IFC hook calls | ifc_clause_library is absent from declared schema per T-017. ifc_report_content differs from audit_report_ifc_content declared name; effective runtime reconciliation remains required. |

### Rules and permissions

- Separate draft generation, review approval, signing and portal/regulatory use. A saved HTML section is not a signed report.

- Do not automatically derive an opinion solely from an exception flag; professional judgement and consistency across annexures need review.

- Report export while logged out and complete lock/reopen policy remain unresolved.

### Outputs

Main report and annexure preview, PDF/Word export code, saved sections, comments and selected export metadata.

### Verification and gaps

Full report-content correctness, IFC runtime schema, saved-edit precedence in all outputs, long-table pagination and signed-pack completeness have not been accepted.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-13-01: Complete one synthetic report with CARO/IFC on and off and compare all intended sections.

- AC-M-13-02: Edit a saved paragraph, reopen and verify that preview and each export retain it.

- AC-M-13-03: Verify correct client/year/framework/signatory and consistent qualification wording across main report and annexures.

### Owner decisions

RV-02, RV-04, RV-06, RV-08. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-14 Tax audit clauses programme readiness and outputs

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-019, F-020, F-021. Requirement links: REQ-P26, REQ-B04, REQ-B05.

### Purpose and current boundary

Provide structured tax-audit preparation, clause capture, review/readiness, programme/disclaimer and draft report outputs. The configured library is tagged AY 2025-26. Field availability and helper-test success do not establish current statutory accuracy.

### Source paths

- [src/pages/TaxAudit.tsx](../../src/pages/TaxAudit.tsx)
- [src/hooks/useTaxAudit.ts](../../src/hooks/useTaxAudit.ts)
- [src/types/taxAudit.ts](../../src/types/taxAudit.ts)
- [src/data/taxAudit3CDClauses.ts](../../src/data/taxAudit3CDClauses.ts)
- [src/data/taxAudit3CDFieldSchemas.ts](../../src/data/taxAudit3CDFieldSchemas.ts)
- [src/lib/taxAuditReportReadiness.ts](../../src/lib/taxAuditReportReadiness.ts)
- [src/lib/taxAuditReportPack.ts](../../src/lib/taxAuditReportPack.ts)
- [src/lib/taxAuditForm3CDExport.ts](../../src/lib/taxAuditForm3CDExport.ts)
- [src/hooks/useForm3CADocument.ts](../../src/hooks/useForm3CADocument.ts)
- [src/hooks/useForm3CBDocument.ts](../../src/hooks/useForm3CBDocument.ts)

### Observed workflow

1. Set client, financial/assessment year, business/profession facts, applicability and 3CA/3CB selection.

2. Complete acceptance and manually maintained compliance tracker.

3. Review prefilled clause values and sources, enter structured fields/tables and retain overrides.

4. Link supporting evidence and document internal review notes or report-facing qualifications.

5. Review programme, responsibility acknowledgement and readiness exceptions.

6. Generate internal Markdown report pack and draft 3CA/3CB sections and 3CD Word/Excel/PDF/HTML paths as supported.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| assessment_year, financial_year, statutory_version, form_type | Tax setup and clause records | Supported version warning remains tied to AY 2025-26; a mismatched year is not silently approved. |
| business/profession flags, turnover, gross receipts, cash percentages, presumptive section | Applicability/setup contracts | Preserve original facts and source precedence; legal boundary tests need reviewer approval. |
| clause_key, response_json, response_html, auditor_remarks_html, qualification_text_html | Clause response model | Structured field/table keys are defined per clause; the catalogue lists observed keys and required/type flags. |
| prefill_status, source module/link, review_status, validation_status | TaxAudit TS model | Prefill vocab includes auto-filled, needs-input, source-conflict, outdated-source and manual-override. Type labels alone do not prove all transitions are enforced. |
| acceptance response, remarks and review fields | tax_audit_acceptance_checks | Accepted engagement and completed checklist must remain distinguishable from no issue noted. |
| portal assignment/upload/acceptance, acknowledgement, UDIN statuses and dates | Compliance tracker inside setup JSON | Manual tracker fields do not perform filing, portal acceptance or UDIN generation. |
| programme item state and disclaimer acknowledgement | setup JSON helper contracts | Save/reopen and link to report-readiness calculation; professional responsibility remains with auditor. |

### Rules and permissions

- The exact configured clause definitions and structured field keys are extracted into the tax field catalogue. Deleted/renumbered historic clauses and all subclause coverage need a legal reviewer, not assumed numeric continuity.

- The working-paper Markdown pack and statutory-form drafts have different purposes. Draft formats do not imply portal-schema compatibility.

- Internal remarks, qualifications and report-facing narratives must follow approved inclusion/exclusion rules.

### Outputs

Clause review summary, readiness attention items, internal report pack, draft 3CA/3CB content and draft 3CD Word/Excel/PDF/HTML export code.

### Verification and gaps

Reported tax-helper regressions: 8 files, 37 tests passed. No clause-level legal audit, real renderer end-to-end acceptance, signed form or portal filing is established. T-008 remains a verification task.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-14-01: Exercise basic, financial, table-heavy and evidence-heavy clauses with missing, zero, not-applicable and override cases.

- AC-M-14-02: Save/reopen setup, acceptance, programme, acknowledgement and clause data; compare every output to the same snapshot.

- AC-M-14-03: Check AY mismatch warnings, source conflicts and separation of internal notes from intended report wording.

- AC-M-14-04: Obtain named professional approval of target-year clause/form coverage before final statutory use.

### Owner decisions

RV-01, RV-06, RV-07, RV-08. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-15 GSTZen sessions and GST data

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-022. Requirement links: REQ-B06, REQ-B08.

### Purpose and current boundary

Connect to GSTZen for external authentication, GSTIN session steps and GSTR-1 retrieval. This is an online integration. It does not establish the broader blueprint’s complete books-to-returns reconciliation or annual return preparation.

### Source paths

- [src/services/gstzen-api.ts](../../src/services/gstzen-api.ts)
- [src/pages/GstzenIntegration.tsx](../../src/pages/GstzenIntegration.tsx)
- [src/pages/GstzenLogin.tsx](../../src/pages/GstzenLogin.tsx)
- [src/pages/Gstr1Dashboard.tsx](../../src/pages/Gstr1Dashboard.tsx)
- [src/hooks/useGstins.ts](../../src/hooks/useGstins.ts)
- [src/hooks/useGstr1Download.ts](../../src/hooks/useGstr1Download.ts)
- [electron/main.cjs](../../electron/main.cjs)

### Observed workflow

1. Choose external account and authenticate against the configured endpoint.

2. Select the relevant customer/GSTIN and perform OTP/session steps as required by the provider.

3. Request the selected return period/data and handle provider responses.

4. Review the dashboard/downloaded results and retain the client/period/source context.

5. Clear external authentication state on logout as implemented; verify expiry and retry behaviour.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| External login credentials and auth token | GSTZen API client | Token is retained in renderer localStorage by current code. This is distinct from local SQLite authentication. |
| API base URL and environment overrides | GSTZen service/main HTTP handlers | Different default branches/endpoints exist in source; confirm production/staging configuration before use. |
| GSTIN, provider customer identifiers and GST username/session | GSTZen types/hooks | A selected provider entity must reconcile to the client’s registration. |
| OTP, return period, download status and provider errors | Integration hooks and API responses | Transient secrets, pagination and retry/duplicate rules need verification. |
| client_id and GSTIN registration metadata | client_gstins | No inference of live GST registration status is made from a saved record. |

### Rules and permissions

- External sessions, consent, credential handling, provider retention and connectivity need an approved data-use policy.

- Do not describe the current integration as complete GSTR-1/3B/2B/books or GSTR-9/9C reconciliation. Those are separate proposed requirements.

- Data provenance should identify provider, GSTIN, return period, fetch time and status; exact retained metadata coverage needs validation.

### Outputs

External login/session UI, GSTIN selection, GSTR-1 dashboard and download paths where wired.

### Verification and gaps

No live provider, GSTN, OTP, consent, pagination, failure or reconciliation scenario was exercised. API and token behaviour are code observations only.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-15-01: Use authorised test credentials to verify client/GSTIN/period selection and response handling.

- AC-M-15-02: Test expired token, invalid OTP, provider failure, repeated request and incomplete data without silent success.

- AC-M-15-03: Confirm external token logout/storage behaviour and that no client credentials enter logs or public commits.

### Owner decisions

RV-01, RV-06, RV-13. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-16 Audit tools calculators and utilities

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-023. Requirement links: REQ-P19, REQ-P20, REQ-P21.

### Purpose and current boundary

Offer auxiliary analysis and utilities. AuditTools has Tally, GST, MCA, income-tax, PDF and analytics tabs. A named card or external-link tool is not automatically a working calculation or a persisted audit workpaper.

### Source paths

- [src/pages/AuditTools.tsx](../../src/pages/AuditTools.tsx)
- [src/components/audit/DeferredTaxCalculator.tsx](../../src/components/audit/DeferredTaxCalculator.tsx)
- [src/components/audit/RatioAnalysisCalculator.tsx](../../src/components/audit/RatioAnalysisCalculator.tsx)

### Observed workflow

1. Select the tool and confirm whether it is a native calculation, external service, file utility or placeholder.

2. Enter the relevant amounts, periods and assumptions or select supported files.

3. Calculate/process and inspect the result and source basis.

4. Export/save where implemented and retain evidence in the engagement through an explicit workflow.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| Temporary/permanent differences, tax rate and timing assumptions | DeferredTaxCalculator and deferred-tax types | AS-22 label is observed; recognition/recoverability and rate correctness require professional validation. |
| Financial numerators, denominators and period values | RatioAnalysisCalculator | Formula choices, zero denominators, negative figures and scaling require review. |
| Files, total pages, page range, split mode, specific pages | AuditTools PDF utility state | Range/every/specific split states exist; validate bounds, output integrity and unsupported/corrupt inputs. |
| TB dates, target month, connection mode and ODBC port | Tally tool state/hooks | Requires live supported Tally configuration; see M-06. |
| GSTIN, taxpayer type, CIN and PAN tool inputs | AuditTools state | Lookup/check tools are not independent verification of regulatory status or completeness. |

### Rules and permissions

- Sampling Calculator currently invokes a toast in the inspected analytics card. Do not count that card as a verified sampling engine.

- The Phase I asks for depreciation, deferred tax and simplified current-tax cross-checks. Deferred-tax and ratio components exist; full depreciation/current-tax coverage must be traced individually before inclusion is accepted.

- Tools that do not save to the engagement need explicit evidence capture if results support an audit conclusion.

### Outputs

Calculated or processed outputs where wired, PDF operations and selected external/native tool results. Persistent calculator history is not generally established.

### Verification and gaps

Tool-by-tool formula/edge-case/UAT evidence is pending. Some controls are placeholders or navigation. No assertion that all cards work is made.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-16-01: Independently calculate a known deferred-tax and ratio example, including zero/negative boundary cases.

- AC-M-16-02: Process a synthetic PDF through each implemented operation and reopen resulting files.

- AC-M-16-03: Classify every utility as working, external prerequisite, placeholder or missing against Phase I needs.

### Owner decisions

RV-01, RV-06, RV-14. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-17 Desktop operations distribution and recovery

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-025, F-026. Requirement links: REQ-P01, REQ-B03, REQ-B07.

### Purpose and current boundary

Provide a repeatable desktop runtime, native dependencies, release process and recoverable client data. Installation validation has a Windows scope. Complete audit-file recovery is not an implemented accepted facility.

### Source paths

- [package.json](../../package.json)
- [electron/run-electron.cjs](../../electron/run-electron.cjs)
- [electron/main.cjs](../../electron/main.cjs)
- [electron/preload.cjs](../../electron/preload.cjs)
- [electron/auto-updater.cjs](../../electron/auto-updater.cjs)
- [.github/workflows/release.yml](../../.github/workflows/release.yml)
- [scripts/smoke-native-modules.cjs](../../scripts/smoke-native-modules.cjs)

### Observed workflow

1. Install with the recorded supported Windows Node/npm toolchain and normal postinstall native rebuild.

2. Run synthetic native smoke and relevant checks before launching production data.

3. Launch development and built production modes separately; verify desktop/native resources.

4. Build a reviewed installer and exercise fresh/upgrade/update behaviour only in a controlled release task.

5. Back up and restore all data stores using an approved consistent recovery design.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| Package version, appId and productName | package.json | Current package version remains 0.9.1. A branch build or passing renderer build is not a released installer. |
| NODE_ENV, VITE_DEV_SERVER_URL and ELECTRON_RUN_AS_NODE | Desktop launch wrapper/main | Development server and production local-file paths differ; wrapper clears Electron-as-Node state. |
| SQLite database, WAL state and evidence bytes | Electron userData | Backup must be consistent across database and files; copying only the main DB may be insufficient. |
| Renderer localStorage and external tokens | Renderer profile | Determine which preferences/working data belong in backup and how secrets are protected. |
| Publish owner, release assets and signing flags | package.json/release workflow/updater | Publish owner still differs from current repository owner; Windows update-signature verification is disabled in current build flags. |
| Recovery point/time, retention and restoration location | Not yet approved operational policy | Document owner targets before implementing or claiming backup assurance. |

### Rules and permissions

- Two clean Windows x64 installs and native smoke were reported on Node 24.12.0/npm 11.6.2. This does not establish macOS/Linux or installer behaviour.

- Typecheck and lint remain failing baselines even though renderer build and selected tests pass.

- Legacy evidence-path restrictions require a migration/recovery decision. This documentation does not rename or move files.

### Outputs

Installed development environment, native smoke evidence, build artefacts where produced and documented release/recovery procedures.

### Verification and gaps

Installer, full launch/restart persistence, live ODBC, cross-platform operation and restore exercises remain unverified. T-009/T-010 and policy review remain open.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-17-01: Launch built desktop on an isolated synthetic profile, save data, restart and verify persistence.

- AC-M-17-02: Install/upgrade on each declared supported OS and test native modules and resource paths.

- AC-M-17-03: Restore a consistent backup into an isolated environment and compare records, files, links and financial totals.

### Owner decisions

RV-10, RV-12, RV-15. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-18 Proposed AI analytics and knowledge support

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-027. Requirement links: REQ-P26, REQ-B01, REQ-B02, REQ-B03, REQ-B05, REQ-B08.

### Purpose and current boundary

The supplied blueprint proposes grounded professional guidance, tailored checklists, anomaly analysis, multilingual drafting and broader audit types. No verified general-purpose AI provider/RAG workflow is established in this application baseline. This section specifies the decision boundary, not implemented behaviour.

### Source paths

- [docs/project/PRODUCT_CONTEXT.md](../../docs/project/PRODUCT_CONTEXT.md)
- [docs/project/SOURCES_AND_RULES.md](../../docs/project/SOURCES_AND_RULES.md)

### Observed workflow

1. If selected for a future release, define one scoped use case and its eligible input/data policy.

2. Select authoritative versioned content and professional review ownership.

3. Specify retrieval, source citations and deterministic-versus-generative responsibilities.

4. Evaluate outputs on synthetic or authorised test cases and require human review.

5. Record accepted/rejected outputs and failure handling before deployment.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| Provider, model, use case and permitted data | Future specification only | No provider/model is selected or approved by this review. |
| Source ID, jurisdiction, effective period, edition, paragraph and checked date | Required future knowledge metadata | A source URL or prior-year PDF alone does not establish applicability. |
| Prompt/input provenance, retrieved sources, output and reviewer decision | Proposed auditability contract | Retention, confidentiality and client-data disclosure need owner decisions. |
| Risk/anomaly score, explanation and threshold | Proposed analytics output | A statistical flag is not an audit finding, sufficient evidence or professional opinion. |
| Evaluation set, accuracy criteria, failure/cost limits | Proposed acceptance contract | Do not repeat unverified efficiency or accuracy targets as achieved metrics. |

### Rules and permissions

- Keep this module labelled proposed. No AI source corpus, integration API, model evaluation or nationwide regulatory acceptance is established.

- Broader statutory/GST/internal/NGO/PSU use cases remain scope proposals until the owner selects the release boundary.

- Reconstructing books or generating professional conclusions may introduce independence, quality and data-use questions that need deliberate decisions.

### Outputs

No accepted AI module output. Future deliverables would require a separately approved specification and evaluation evidence.

### Verification and gaps

T-011 remains a scope decision. Supplied vision documents and competitor comparisons do not establish current product capabilities.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-18-01: For a selected future use case, demonstrate source-grounded answers with effective-period citations and unsupported-question handling.

- AC-M-18-02: Measure agreed error cases and preserve human reviewer decisions.

- AC-M-18-03: Verify confidentiality and failure behaviour before any client-data use.

### Owner decisions

RV-01, RV-06, RV-13, RV-16. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## M-19 Agent instructions documentation and handoffs

Documentation snapshot: 30 October 2026. Reviewed source: `cc5c04729604fba7d05240a07f24682e0644665c`. Features: F-028. Requirement links: Repository-derived capability; no original Phase I requirement asserted.

### Purpose and current boundary

Keep application knowledge and next-task context in the repository so different coding assistants can resume without reconstructing prior chat. Shared instructions, detailed specifications, reported evidence and actual source must remain distinguishable.

### Source paths

- [AGENTS.md](../../AGENTS.md)
- [CLAUDE.md](../../CLAUDE.md)
- [.github/copilot-instructions.md](../../.github/copilot-instructions.md)
- [.agents/README.md](../../.agents/README.md)
- [docs/project/README.md](../../docs/project/README.md)
- [docs/project/SKILLS_INDEX.md](../../docs/project/SKILLS_INDEX.md)
- [scripts/check-project-docs.mjs](../../scripts/check-project-docs.mjs)

### Observed workflow

1. Open the intended repository branch and inspect current instructions and Git state.

2. Read the project index, product context, current status, next tasks and latest handoff.

3. Select the relevant feature/module and reusable workflow; identify the explicit authorised task.

4. Complete only that task, validate the change and update its evidence and handoff.

5. Push a reviewable branch if authorised; a new session must verify which branch actually contains the documentation.

### Principal fields and behaviour

This is the business-oriented field contract from inspected source models and paths. The [declared field catalogue](SCHEMA_FIELD_CATALOG.md) supplies every base-schema column, default and relationship. A TypeScript declaration, SQL constraint or described workflow is not proof that the entire UI flow has passed. Additional field-level parity questions remain explicitly open where stated.

| Field or group | Source and storage | Observed validation or review boundary |
| --- | --- | --- |
| Feature/module/requirement IDs | Coverage matrix and traceability | Every retained feature is mapped to a module and an evidence state. |
| Source baseline and documentation date | Review records | This review is pinned to cc5c0472; inventory’s historical source label must not be mistaken for the latest review baseline. |
| Task state, decisions and next executable step | CURRENT_STATUS/NEXT_TASKS/SESSION_HANDOFF | A recommended task is not automatically authorised implementation. |
| Passed, failed, skipped and owner-accepted evidence | Validation records | Separate prior VS Code reported results from checks actually rerun in this documentation session. |
| Client/version and automatic/manual loading evidence | T-001 | Manual fact recovery was demonstrated. Automatic loading across actual Codex/Claude clients remains unverified. |

### Rules and permissions

- Keep AGENTS and client adapters short; load detailed module/workflow documents only when relevant.

- Eight portable workflows exist: session, feature, financial rules, statutory content, database, security, export and desktop validation. They are not native installed personal skills.

- Documentation work must record code defects and owner decisions rather than automatically changing production logic.

### Outputs

Shared knowledge record, reusable runbooks, source inventory, coverage matrix, decision list and handoff for future sessions.

### Verification and gaps

Structural documentation checks pass on earlier records. This review adds content and consistency checks, not proof of automatic IDE loading or application acceptance. Changes remain branch-based until integrated.

Prior VS Code execution results are recorded as reported evidence in [validation record](VERIFICATION_EVIDENCE.md). This documentation pass does not rerun those application tests or grant owner UAT acceptance.

### Acceptance cases for later verification

These are proposed review/acceptance scenarios, not passed tests or new implementation authorisations.

- AC-M-19-01: Start a fresh used coding client and recover the same product facts and selected task from the maintained files.

- AC-M-19-02: Name automatically loaded versus manually opened files using actual available evidence; mark unknown if not observable.

- AC-M-19-03: Close a scoped documentation task with updated status/handoff and a clean reviewed diff.

### Owner decisions

RV-01. See the [consolidated review decisions](OWNER_REVIEW_DECISIONS.md). Decisions are unapproved until the owner records an answer. Keep code fixes outside this documentation task.

Return to the [review index](REVIEW_START_HERE.md) or [coverage matrix](MODULE_COVERAGE_MATRIX.md).


## Open gaps and scope boundaries

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
| GAP-11 | TypeScript and lint | Cross-cutting | Reported baseline: 114 TypeScript diagnostics in 28 files; 515 lint errors and 101 warnings. | T-013, T-014; no fixes in documentation pass. |
| GAP-12 | Desktop integration and distribution | M-06, M-17 | Installer, live Tally/ODBC, cross-platform, update feed/signing and owner UAT remain unverified. | T-010, RV-15. |
| GAP-13 | Automatic client context loading | M-19 | Manual context recovery demonstrated; actual Codex/Claude automatic loading unverified. | T-001 remains partial and non-blocking for documentation review. |
| GAP-14 | Future AI and broad audit types | M-18 | No verified general AI/RAG workflow or complete broad audit-type implementation. | T-011 and RV-16. |
| GAP-15 | History completeness | M-12 | Activity logger reads up to 500 rows; immutable complete history and full log export are not demonstrated. | RV-04/RV-12 and module acceptance scenarios. |

### Prior security findings

Canonical file ownership, prospective parent validation, active TB authorization mapping and scoped failed-upload rollback have reported before/after regression evidence. Their reported scope should be recorded accurately. They do not establish complete application security, UI acceptance, working missing schema or settled product permissions. No additional security fixes were undertaken during this documentation pass.


## Consolidated owner review decisions

All questions are collected here so the owner can review the application once. Proposed starting points are recommendations only. No blank, existing code behaviour or earlier AI-generated suggestion is treated as approval. Record the chosen answer, exclusions, owner/date and affected release in this file or the decision register after review.

| Review ID | Subject | Decision required | Proposed starting point for review | Linked records | Owner response |
| --- | --- | --- | --- | --- | --- |
| RV-01 | Next release and deployment | Choose target users, audit types and offline/online boundary. Phase I describes less-complex offline assistance; the blueprint proposes broad web/AI work. | Review the current desktop modules as the starting baseline; select the actual next-release scope explicitly. | D-001, D-003; M-03, M-05, M-06, M-09, M-14, M-15, M-18 | Awaiting owner review |
| RV-02 | Financial-statement responsibility | Confirm whether the release prepares financial statements, compares management statements, or supports both. Define the management/auditor responsibility boundary. | Retain current code while reviewing separate preparation and comparison acceptance cases. | D-002; M-04, M-07, M-13 | Awaiting owner review |
| RV-03 | Roles and access | Approve global admin/partner visibility, manager/senior/staff permissions, assignment rights, user administration and viewer/user treatment. | Use the implemented matrix as a proposal for review, not inferred approval. | D-007, T-016; M-01, M-02, M-03, M-10 | Awaiting owner review |
| RV-04 | Review locks sign-off and exports | Define who prepares, reviews, approves, locks and reopens each object; required reasons and history; whole-file finalization; export permission after logout. | Record one explicit transition matrix and distinguish evidence-level state from whole-file finalization. | T-007, T-016; M-09 to M-13 | Awaiting owner review |
| RV-05 | Authoritative master and historical values | Choose how master changes affect existing engagements/reports; identify source of truth for materiality, layouts, grouping and year data. | Keep reviewed historical values identifiable and make refresh/regeneration explicit. | M-02 to M-08 | Awaiting owner review |
| RV-06 | Professional content and target periods | Select supported entity/framework/audit combinations and tax years; appoint content reviewer; define source/version update and effective-date governance. | Do not infer current-law approval from AY labels, guidance files or helper tests. | T-008; M-04, M-05, M-07, M-13, M-14, M-16, M-18 | Awaiting owner review |
| RV-07 | Numeric defaults and professional judgement | Approve materiality method, percentages/weights, source selection, unknown/zero/negative treatment and rationale/override requirements. | Treat existing defaults and normalisation as implementation facts awaiting methodology review. | M-05, M-08, M-14 | Awaiting owner review |
| RV-08 | Import and report reconciliation | Define supported source columns, periods/currency, sign convention, repeated-import handling, stock and adjustment treatment, and preview/export acceptance. | Require a known synthetic current/prior fixture with reproducible source-to-output reconciliation. | M-06, M-07, M-13, M-14 | Awaiting owner review |
| RV-09 | Evidence deletion rollback and attachments | Confirm manager-level byte deletion, staff deletion limits, 10-minute rollback conditions, accepted files/limits and distinction between workpaper attachments and evidence. | Retain scoped safeguards while reviewing permitted user workflows; no general staff deletion by inference. | T-016; M-09, M-10 | Awaiting owner review |
| RV-10 | Legacy evidence migration | Choose how to inventory, preserve and migrate existing non-canonical file paths and duplicate ownership. | Preserve original records and bytes until a reviewed migration and recovery procedure exists. | M-10, M-17 | Awaiting owner review |
| RV-11 | Misstatements and completion design | Approve persisted misstatement fields, classifications, adjustment history, materiality relationship, review and completion prerequisites. | Keep the current sample-driven screens labelled prototypes until implementation and acceptance. | T-006, T-007; M-11, M-12 | Awaiting owner review |
| RV-12 | Backup retention and recovery | Set retention, supported backup contents, consistency, access/encryption, recovery point/time and restore verification requirements. | Cover SQLite/WAL, evidence and required renderer state together; do not accept a database-only copy as complete. | D-008, T-009; M-12, M-17 | Awaiting owner review |
| RV-13 | External services and data use | Approve GSTZen environments, credential/token storage, provider data use and any future AI disclosure/retention. | Separate essential local work from connectivity-dependent features and document actual external data flows. | D-004; M-15, M-18 | Awaiting owner review |
| RV-14 | Checklist MRL and calculator coverage | Confirm exact downloadable/searchable checklist and MRL library, depreciation, current-tax and other calculator scope. | Review tool cards individually; a label, toast or engagement-letter template does not satisfy the original requirement. | REQ-P19 to P25; M-04, M-09, M-16 | Awaiting owner review |
| RV-15 | Supported platforms and distribution | Choose supported OS/Tally configurations, installer/update destination, signing policy, pilot scope and acceptance owner. | Use recorded Windows toolchain results only for their tested boundary. | D-006, T-010; M-06, M-17 | Awaiting owner review |
| RV-16 | AI and future breadth | Choose whether AI, multilingual, cloud collaboration and broader NGO/internal/PSU work belong in the next release or later roadmap. | Keep these proposed until use cases, data policy, professional source and evaluation contracts are approved. | D-004, T-011; M-18 | Awaiting owner review |

### What is already authorised

The user directed completion of application documentation, consistent cross-session context, public branch publication of reviewed documentation, and later refocused the current work on documentation for one review. Current scope is documentation only. This does not approve implementing every recorded gap, changing professional rules, merging branches or publishing an application release.

### How to record review

For each review ID, record approved option or revised instruction, exact scope and exclusions, effective release/period, owner and date. An approval can apply to documentation wording without approving a code change. Link resulting development tasks only after the intended behaviour is settled. Keep unresolved questions open rather than filling them with guessed decisions.


## Technical appendices and next documentation step

The [schema field catalogue](SCHEMA_FIELD_CATALOG.md) records all declared fields. The [caller catalogue](PERSISTENCE_CALLER_CATALOG.md) identifies literal .from() targets. The [tax field catalogue](TAX_AUDIT_FIELD_CATALOG.md) records configured clause titles and literal field objects. [Requirements traceability](REQUIREMENTS_TRACEABILITY.md) distinguishes original Phase I statements from broader proposals. [Verification evidence](VERIFICATION_EVIDENCE.md) distinguishes source facts, prior reported tests, this documentation pass and owner acceptance.

The next activity is the owner's review of this specification and decision list. No development task should start automatically from the gap register. After corrections, approve a named documentation baseline and identify the next authorised development or UAT task.
