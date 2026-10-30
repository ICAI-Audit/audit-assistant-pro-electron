# Requirements traceability

Reviewed 30 October 2026 against `cc5c04729604fba7d05240a07f24682e0644665c`. This maps supplied source requirements and current code areas. P items originate in the supplied Summary of Phase I Development. B items originate in the supplied AI blueprint/summary and remain proposal-only unless separately approved. Neither source is assumed to be the final accepted release specification.

All 35 identified source requirements/proposals below have feature and module mappings. This is traceability completeness for the enumerated source statements, not a percentage of product completion or statutory compliance. Requirements whose implementation is not established stay visible.

| Requirement | Source statement | Feature IDs | Module IDs | Current evidence and gap |
| --- | --- | --- | --- | --- |
| REQ-P01 | Offline local assistance and confidentiality | F-025, F-026 | M-17 | Electron/SQLite is implemented; external GST/update services exist. Recovery and data-use policy remain open. |
| REQ-P02 | Auditor and firm master | F-002 | M-02 | Firm and partner code exists; field persistence and professional identity UAT pending. |
| REQ-P03 | Client master and financial year | F-002, F-003 | M-02, M-03 | Master/engagement structures exist; exact validation, rollover and historical values need review. |
| REQ-P04 | Audit team members | F-002, F-003 | M-02, M-03 | Users, roles and assignments exist; approved role matrix and UI verification pending. |
| REQ-P05 | Materiality parameters and weights | F-010 | M-08 | Benchmark/risk state exists; original weighting-method equivalence not established. |
| REQ-P06 | FS notes master ledger master and GL grouping | F-007, F-009 | M-06, M-07 | Multiple classification/layout structures exist; approved code hierarchy and persistence contract need review. |
| REQ-P07 | Year-wise ledger to notes mapping | F-007, F-009 | M-06, M-07 | Period tables and mapping code exist; complete current/prior mapping and missing schema remain gaps. |
| REQ-P08 | Appointment details and supporting documents | F-004 | M-04 | Appointment screen and evidence flow exist; UI/acceptance workflow pending. |
| REQ-P09 | Engagement letter | F-005 | M-04 | Structured variations, templates and Word generators exist; professional wording and export UAT pending. |
| REQ-P10 | Upload audit plan and scope in Phase I | F-004, F-012, F-013 | M-04, M-09, M-10 | Uploads/programmes exist; exact plan/scope indexing and attachment compatibility need verification. |
| REQ-P11 | Threshold based financial statement reporting applicability | F-006 | M-05 | Applicability UI and stored results exist; period-specific legal and boundary review pending. |
| REQ-P12 | Threshold based auditor reporting applicability | F-006, F-018 | M-05, M-13 | Report setup and criteria exist; complete legal coverage not verified. |
| REQ-P13 | Trial balance upload | F-007, F-008 | M-06 | Excel/Tally paths present; real renderer import, persistence and live Tally acceptance pending. |
| REQ-P14 | Auditor judgement in ledger grouping | F-007, F-009 | M-06, M-07 | Classification and override code exists; override provenance and persisted mapping need acceptance. |
| REQ-P15 | Compare auditor assessment with management financial statements | F-009 | M-07 | Statement generation exists; a distinct management-FS comparison workflow is not established. |
| REQ-P16 | Working paper attachments to each TB or FS line | F-012, F-013 | M-09, M-10 | Evidence/programme links exist; complete TB/FS line coverage is unverified. |
| REQ-P17 | Colour materiality indicators at TB notes and FS face | F-007, F-009, F-010 | M-06, M-07, M-08 | Materiality and financial views exist; original per-line indicator coverage is not established. |
| REQ-P18 | Team personnel at each TB notes and FS face line without advanced workflow | F-003, F-007, F-009, F-012 | M-03, M-06, M-07, M-09 | Assignment/procedure structures exist; exact line-level assignment and Phase I limitation need review. |
| REQ-P19 | Depreciation cross-check calculator | F-023 | M-16 | Do not infer complete depreciation engine from tool labels; individual coverage unverified. |
| REQ-P20 | Deferred tax AS cross-check calculator | F-023 | M-16 | Deferred-tax component exists; formulas, recognition and professional acceptance pending. |
| REQ-P21 | Simplified income-tax provision cross-check | F-023 | M-16 | Exact Phase I current-tax provision coverage not established. |
| REQ-P22 | Risk assessment and overall performance trivial materiality | F-010, F-011 | M-08 | Stored risk/materiality code exists; units, defaults and method need review. |
| REQ-P23 | Manual or TB/FS financial parameters for materiality | F-007, F-009, F-010 | M-06, M-07, M-08 | Manual input and prefill paths exist; source precedence and reconciliation need acceptance. |
| REQ-P24 | Indexed searchable downloadable audit checklist formats | F-012 | M-09 | Programme/checklist structures exist; format-library indexing/search and download completeness unverified. |
| REQ-P25 | Indexed searchable downloadable MRL formats | F-004, F-005, F-012 | M-04, M-09 | Engagement-letter templates are not proof of a management representation library; coverage unverified. |
| REQ-P26 | Assistance preserves auditor judgement and excludes end-to-end guarantee | F-006, F-018, F-019, F-021, F-027 | M-05, M-13, M-14, M-18 | Human review described; actual report/AI boundary and disclaimer acceptance need approval. |
| REQ-P27 | No financial-statement preparation in original Phase I | F-009 | M-07 | Current statement preparation/export code exceeds that exclusion; owner scope decision D-002. |
| REQ-B01 | AI pre-assessment tailored prompts and standards citations | F-027 | M-18 | Blueprint proposal; verified provider/RAG path not established. |
| REQ-B02 | Full population analytics and anomaly/risk scoring | F-027 | M-18 | Blueprint proposal; no accepted end-to-end analytics/evaluation demonstrated. |
| REQ-B03 | Secure cloud collaboration and multilingual support | F-025, F-027 | M-17, M-18 | Proposal conflicting with original offline scope; not verified current functionality. |
| REQ-B04 | Working papers and report automation across broad audit types | F-012, F-018, F-019, F-021 | M-09, M-13, M-14 | Partial implementation for selected modules; full broader audit-type coverage unverified. |
| REQ-B05 | Versioned professional knowledge and continuous updates | F-019, F-027 | M-14, M-18 | Tax version label exists; full maintained source corpus/update mechanism not established. |
| REQ-B06 | GST books return reconciliation and annual reporting | F-022 | M-15 | GSTR-1 integration is not complete reconciliation/annual return preparation. |
| REQ-B07 | Immutable audit trail and privacy/security claims | F-013, F-017, F-026 | M-10, M-12, M-17 | Selected IPC controls tested; immutable history, full encryption and recovery not established. |
| REQ-B08 | Future GSTN Income-tax MCA APIs with consent | F-022, F-027 | M-15, M-18 | Proposed integrations; no general portal filing or comprehensive API coverage accepted. |

## Repository-derived capabilities

Tax-audit structured clauses and exports, advanced evidence review, misstatements, completion, external integration utilities and AI-agent continuity are also documented in the feature/module register. Their existence does not retroactively approve all scope expansion beyond original Phase I. Review them with the owner’s release decision.

## Scope conflicts to decide

Original Phase I excludes financial-statement preparation and advanced workflow, while the repository contains statement editing/export and review-state interfaces. The broader blueprint proposes web/cloud/AI capabilities while active deployment is Electron/local SQLite. Preserve current implementation and record a chosen next-release boundary in RV-01/RV-02 rather than silently treating either source as superseded.

## Future requirement changes

Add a stable requirement ID, source and approval date, affected feature/module, intended behaviour, implementation evidence and acceptance cases. Requirements should not be copied from competitor claims or an AI response into approved scope without the owner’s decision. See [owner review](OWNER_REVIEW_DECISIONS.md).
