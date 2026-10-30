# Data model and persistence

## Detailed field reference

The [schema field catalogue](SCHEMA_FIELD_CATALOG.md) records 78 declared tables and 1,055 columns from the nine current SQL files. The [caller catalogue](PERSISTENCE_CALLER_CATALOG.md) supplies literal targets and source paths; the [tax field catalogue](TAX_AUDIT_FIELD_CATALOG.md) covers configured clause/field objects with lexical extraction limits. These references are source facts, not a claim that installed databases match every UI/type model. T-017 records missing engagement_tb_classification and ifc_clause_library declarations.

## Ownership

One local SQLite database sits in Electron userData. It contains firm settings, users and roles, clients, engagements, audit work, templates and tax-audit content. Local evidence bytes and renderer localStorage are additional stores. Multi-firm tenancy and shared-network database access have not been established. Do not place the database on a mapped drive or invent a sync architecture as part of a documentation task.

## Schema families

| Schema file | Principal records | Relationship and review concern |
| --- | --- | --- |
| 01_core_tables.sql | firm_settings, profiles, user_roles, partners, clients, financial_years, engagements, engagement_assignments | Client and engagement IDs connect working records; active main-process authorization needs verification |
| 02_audit_workflow_tables.sql | audit_procedures, procedure_assignees, checklist items, evidence_files, evidence_links, risks, review_notes, compliance_applicability, materiality_risk_assessment, notifications | Procedures, evidence and review records must stay within the engagement |
| 03_audit_program_tables.sql | audit_programs_new, audit_program_sections, audit_program_boxes, audit_program_attachments, engagement_letter_templates | Program hierarchy and letter templates; do not confuse templates with engagement execution |
| 04_audit_report_tables.sql | setup, content, documents, versions, comments, evidence, exports, key audit matters, CARO libraries and responses, IFC content | Saved report sections and exports need a consistent source snapshot and review history |
| 05_trial_balance_tables.sql | trial_balance_lines, tb_new entity/ledgers/stock/mappings/sessions, engagement_trial_balance_header and lines | Multiple generations coexist; map active reads and writes before migration |
| 06_going_concern_tables.sql | workpapers, checklist items, net worth, profitability, borrowings, cash flows, ratios | Table presence does not verify a live completed workpaper flow |
| 07_rule_engine_tables.sql | AILE rule sets and mapping rules; group, keyword, override and validation rules | Distinguish stored rules from static classification data and user overrides |
| 08_template_system_tables.sql | standard programs/procedures, template checklist/evidence, FS templates, activity_logs, audit_trail, Tally bridge, feedback | Local mutable logs are not demonstrated immutable evidence |
| 09_tax_audit_tables.sql | client GSTINs, statutory versions, tax-audit engagements, clause responses/evidence, acceptance, qualifications, review notes, exports | Version key and assessment year affect interpretation and output |

The exact declared table names are in inventory.json. It is generated from SQL declarations and excludes tables created only by runtime migrations. Inspect main.cjs for the latter. This summary is complemented by the complete declared-schema field catalogue. It is not proof that effective runtime migrations, UI fields, foreign keys and indexes all agree or are adequate.

## Existing conventions

IDs are commonly text. Some objects and arrays cross IPC and are JSON-serialised. Boolean values can become SQLite integers. The active client's result wrapper returns data and error; some operations execute via a thenable chain and others call execute explicitly. Do not mix assumptions from client-ipc.ts with the active client.ts.

Auth stores password hashes with bcrypt. The active process tracks the signed-in user in memory. React's remembered email and selected engagement are convenience state, not authority to read records. Inspect each payload's engagement_id and ownership, including indirect links through procedure or report IDs.

## Required contract for a changed field

Document field name and type, nullability and default, owning table, foreign key, user meaning, source, units and sign, permitted values, read and write paths, validation, migration, and tests. For financial amounts state whether the number is source signed value, debit/credit movement, display magnitude, or scaled presentation. Do not apply display scaling to stored source balances.

## Upgrade and recovery

Startup CREATE TABLE IF NOT EXISTS does not upgrade an existing table's columns. Any schema change needs an idempotent upgrade path and a retained old-database fixture. Verify row counts, key relationships and financial totals before and after upgrade. Test interruption and rerun behaviour. Never delete audit_assistant.db to make an upgrade pass.

A recovery plan must cover the database consistently with WAL state, evidence files, and required renderer settings. A live file copy without SQLite-consistent backup handling can be incomplete. Restore into an isolated profile, open records and files, compare totals, and record the result. An approved backup/restore facility has not been established by this review.
