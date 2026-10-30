# Declared schema field catalogue

Source baseline `cc5c04729604fba7d05240a07f24682e0644665c`, reviewed 30 October 2026. All nine sqlite/schema files were parsed by SQLite in memory, without importing the application or opening a client database. The catalogue contains 78 declared tables and 1055 columns. It records declarations, not effective installed-database state or verified UI bindings. Runtime migrations in main.cjs may add or alter fields. Nullability here describes explicit NOT NULL and PK metadata; SQLite primary-key semantics must be read with the actual DDL.

The known missing engagement_tb_classification and ifc_clause_library declarations remain T-017. Other UI/type-to-schema differences are evidence to reconcile, not licence to add tables during documentation.

## Table index

- [activity_logs](#activity_logs)
- [aile_mapping_rules](#aile_mapping_rules)
- [aile_rule_sets](#aile_rule_sets)
- [audit_procedures](#audit_procedures)
- [audit_program_attachments](#audit_program_attachments)
- [audit_program_boxes](#audit_program_boxes)
- [audit_program_sections](#audit_program_sections)
- [audit_programs_new](#audit_programs_new)
- [audit_report_comments](#audit_report_comments)
- [audit_report_document_versions](#audit_report_document_versions)
- [audit_report_documents](#audit_report_documents)
- [audit_report_evidence](#audit_report_evidence)
- [audit_report_exports](#audit_report_exports)
- [audit_report_ifc_content](#audit_report_ifc_content)
- [audit_report_main_content](#audit_report_main_content)
- [audit_report_setup](#audit_report_setup)
- [audit_trail](#audit_trail)
- [caro_clause_library](#caro_clause_library)
- [caro_clause_responses](#caro_clause_responses)
- [caro_standard_answers](#caro_standard_answers)
- [client_gstins](#client_gstins)
- [clients](#clients)
- [compliance_applicability](#compliance_applicability)
- [engagement_assignments](#engagement_assignments)
- [engagement_letter_templates](#engagement_letter_templates)
- [engagement_trial_balance_header](#engagement_trial_balance_header)
- [engagement_trial_balance_lines](#engagement_trial_balance_lines)
- [engagements](#engagements)
- [evidence_files](#evidence_files)
- [evidence_links](#evidence_links)
- [feedback_attachments](#feedback_attachments)
- [feedback_reports](#feedback_reports)
- [financial_years](#financial_years)
- [firm_settings](#firm_settings)
- [fs_templates](#fs_templates)
- [gc_annexure_borrowings](#gc_annexure_borrowings)
- [gc_annexure_cash_flows](#gc_annexure_cash_flows)
- [gc_annexure_net_worth](#gc_annexure_net_worth)
- [gc_annexure_profitability](#gc_annexure_profitability)
- [gc_annexure_ratios](#gc_annexure_ratios)
- [going_concern_checklist_items](#going_concern_checklist_items)
- [going_concern_workpapers](#going_concern_workpapers)
- [key_audit_matters](#key_audit_matters)
- [materiality_risk_assessment](#materiality_risk_assessment)
- [notifications](#notifications)
- [partners](#partners)
- [procedure_assignees](#procedure_assignees)
- [procedure_checklist_items](#procedure_checklist_items)
- [procedure_evidence_requirements](#procedure_evidence_requirements)
- [procedure_template_checklist_items](#procedure_template_checklist_items)
- [procedure_template_evidence_requirements](#procedure_template_evidence_requirements)
- [profiles](#profiles)
- [review_notes](#review_notes)
- [risks](#risks)
- [rule_engine_group_rules](#rule_engine_group_rules)
- [rule_engine_keyword_rules](#rule_engine_keyword_rules)
- [rule_engine_override_rules](#rule_engine_override_rules)
- [rule_engine_validation_rules](#rule_engine_validation_rules)
- [schedule_iii_config](#schedule_iii_config)
- [standard_procedures](#standard_procedures)
- [standard_programs](#standard_programs)
- [tally_bridge_requests](#tally_bridge_requests)
- [tally_bridge_sessions](#tally_bridge_sessions)
- [tax_audit_acceptance_checks](#tax_audit_acceptance_checks)
- [tax_audit_clause_evidence](#tax_audit_clause_evidence)
- [tax_audit_clause_responses](#tax_audit_clause_responses)
- [tax_audit_engagements](#tax_audit_engagements)
- [tax_audit_exports](#tax_audit_exports)
- [tax_audit_qualifications](#tax_audit_qualifications)
- [tax_audit_review_notes](#tax_audit_review_notes)
- [tax_audit_statutory_versions](#tax_audit_statutory_versions)
- [tb_new_classification_mappings](#tb_new_classification_mappings)
- [tb_new_entity_info](#tb_new_entity_info)
- [tb_new_ledgers](#tb_new_ledgers)
- [tb_new_sessions](#tb_new_sessions)
- [tb_new_stock_items](#tb_new_stock_items)
- [trial_balance_lines](#trial_balance_lines)
- [user_roles](#user_roles)

## activity_logs

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| user_id | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| user_name | TEXT | yes | none | none | none |
| action | TEXT | yes | none | none | none |
| entity | TEXT | yes | none | none | none |
| entity_id | TEXT | no | none | none | none |
| engagement_id | TEXT | no | none | none | engagements.id; on delete SET NULL |
| details | TEXT | no | none | none | none |
| metadata | TEXT | no | '{}' | none | none |
| ip_address | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## aile_mapping_rules

Source: sqlite/schema/07_rule_engine_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| rule_set_id | TEXT | yes | none | none | aile_rule_sets.id; on delete CASCADE |
| match_field | TEXT | yes | none | none | none |
| match_pattern | TEXT | yes | none | none | none |
| match_type | TEXT | yes | none | none | none |
| target_aile | TEXT | no | none | none | none |
| target_fs_area | TEXT | no | none | none | none |
| target_face_group | TEXT | no | none | none | none |
| target_note_group | TEXT | no | none | none | none |
| target_sub_note | TEXT | no | none | none | none |
| target_level4 | TEXT | no | none | none | none |
| target_level5 | TEXT | no | none | none | none |
| priority | INTEGER | yes | 0 | none | none |
| has_balance_logic | INTEGER | yes | 0 | none | none |
| debit_aile | TEXT | no | none | none | none |
| credit_aile | TEXT | no | none | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `match_type IN ('contains', 'exact', 'regex', 'starts_with', 'ends_with')`.

## aile_rule_sets

Source: sqlite/schema/07_rule_engine_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| name | TEXT | yes | none | none | none |
| description | TEXT | no | none | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| is_default | INTEGER | yes | 0 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_procedures

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| procedure_name | TEXT | yes | none | none | none |
| description | TEXT | no | none | none | none |
| area | TEXT | yes | none | none | none |
| assertion | TEXT | no | none | none | none |
| status | TEXT | yes | 'not_started' | none | none |
| approval_stage | TEXT | yes | 'draft' | none | none |
| assigned_to | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| due_date | TEXT | no | none | none | none |
| completed_date | TEXT | no | none | none | none |
| conclusion | TEXT | no | none | none | none |
| conclusion_prompt | TEXT | no | none | none | none |
| workpaper_ref | TEXT | no | none | none | none |
| template_id | TEXT | no | none | none | standard_procedures.id; on delete SET NULL |
| checklist_items | TEXT | yes | '[]' | none | none |
| evidence_requirements | TEXT | yes | '[]' | none | none |
| prepared_by | TEXT | no | none | none | none |
| prepared_at | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| locked | INTEGER | yes | 0 | none | none |
| locked_by | TEXT | no | none | none | none |
| locked_at | TEXT | no | none | none | none |
| unlocked_by | TEXT | no | none | none | none |
| unlocked_at | TEXT | no | none | none | none |
| unlock_reason | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `status IN ('not_started', 'in_progress', 'done', 'reviewed')`; `approval_stage IN ('draft', 'prepared', 'reviewed', 'approved')`.

## audit_program_attachments

Source: sqlite/schema/03_audit_program_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| audit_program_id | TEXT | yes | none | none | audit_programs_new.id; on delete CASCADE |
| section_id | TEXT | no | none | none | audit_program_sections.id; on delete CASCADE |
| box_id | TEXT | no | none | none | audit_program_boxes.id; on delete CASCADE |
| file_name | TEXT | yes | none | none | none |
| file_path | TEXT | yes | none | none | none |
| file_type | TEXT | yes | none | none | none |
| file_size | INTEGER | yes | none | none | none |
| description | TEXT | no | none | none | none |
| is_evidence | INTEGER | no | 0 | none | none |
| uploaded_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| uploaded_at | TEXT | no | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_program_boxes

Source: sqlite/schema/03_audit_program_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| section_id | TEXT | yes | none | none | audit_program_sections.id; on delete CASCADE |
| header | TEXT | yes | none | none | none |
| content | TEXT | no | '' | none | none |
| order | INTEGER | yes | 0 | none | none |
| status | TEXT | no | none | none | none |
| locked | INTEGER | no | 0 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | no | datetime('now') | none | none |
| updated_at | TEXT | no | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_program_sections

Source: sqlite/schema/03_audit_program_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| audit_program_id | TEXT | yes | none | none | audit_programs_new.id; on delete CASCADE |
| name | TEXT | yes | none | none | none |
| order | INTEGER | yes | 0 | none | none |
| is_expanded | INTEGER | no | 0 | none | none |
| is_applicable | INTEGER | no | 1 | none | none |
| status | TEXT | no | none | none | none |
| locked | INTEGER | no | 0 | none | none |
| created_at | TEXT | no | datetime('now') | none | none |
| updated_at | TEXT | no | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_programs_new

Source: sqlite/schema/03_audit_program_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| client_id | TEXT | no | none | none | clients.id; on delete SET NULL |
| financial_year_id | TEXT | no | none | none | financial_years.id; on delete SET NULL |
| name | TEXT | yes | none | none | none |
| description | TEXT | no | none | none | none |
| workpaper_reference | TEXT | no | none | none | none |
| status | TEXT | yes | 'draft' | none | none |
| prepared_by | TEXT | no | none | none | none |
| prepared_at | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | no | datetime('now') | none | none |
| updated_at | TEXT | no | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_report_comments

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| document_id | TEXT | no | none | none | audit_report_documents.id; on delete CASCADE |
| clause_id | TEXT | no | none | none | none |
| comment_text | TEXT | yes | none | none | none |
| comment_type | TEXT | no | none | none | none |
| status | TEXT | no | 'open' | none | none |
| assigned_to | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| response_text | TEXT | no | none | none | none |
| resolved_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| resolved_at | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_report_document_versions

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| document_id | TEXT | yes | none | none | audit_report_documents.id; on delete CASCADE |
| version_number | INTEGER | yes | none | none | none |
| content_json | TEXT | no | none | none | none |
| content_html | TEXT | no | none | none | none |
| change_reason | TEXT | no | none | none | none |
| changed_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_report_documents

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| section_name | TEXT | yes | none | none | none |
| section_title | TEXT | no | none | none | none |
| content_json | TEXT | no | '{}' | none | none |
| content_html | TEXT | no | none | none | none |
| version_number | INTEGER | no | 1 | none | none |
| is_locked | INTEGER | no | 0 | none | none |
| changed_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_report_evidence

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| clause_id | TEXT | no | none | none | none |
| evidence_file_id | TEXT | no | none | none | evidence_files.id; on delete SET NULL |
| working_paper_ref | TEXT | no | none | none | none |
| description | TEXT | no | none | none | none |
| notes | TEXT | no | none | none | none |
| uploaded_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| uploaded_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_report_exports

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| export_type | TEXT | yes | none | none | none |
| export_version | INTEGER | yes | none | none | none |
| file_name | TEXT | no | none | none | none |
| file_path | TEXT | no | none | none | none |
| is_final | INTEGER | no | 0 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## audit_report_ifc_content

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| opinion_type | TEXT | no | 'unmodified' | none | none |
| opinion_paragraph | TEXT | no | none | none | none |
| basis_for_opinion | TEXT | no | none | none | none |
| management_responsibility_section | TEXT | no | none | none | none |
| auditor_responsibility_section | TEXT | no | none | none | none |
| ifc_meaning_section | TEXT | no | none | none | none |
| inherent_limitations_section | TEXT | no | none | none | none |
| has_material_weaknesses | INTEGER | no | 0 | none | none |
| material_weaknesses | TEXT | no | '[]' | none | none |
| has_significant_deficiencies | INTEGER | no | 0 | none | none |
| significant_deficiencies | TEXT | no | '[]' | none | none |
| additional_sections | TEXT | no | '[]' | none | none |
| report_status | TEXT | no | 'draft' | none | none |
| version_number | INTEGER | no | 1 | none | none |
| created_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id; id.

Check expressions as declared: `opinion_type IN ('unmodified', 'qualified', 'adverse', 'disclaimer')`.

## audit_report_main_content

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| opinion_type | TEXT | yes | 'unqualified' | none | none |
| basis_for_opinion | TEXT | no | none | none | none |
| basis_for_opinion_is_example | INTEGER | no | 0 | none | none |
| qualification_details | TEXT | no | none | none | none |
| has_emphasis_of_matter | INTEGER | no | 0 | none | none |
| emphasis_of_matter_items | TEXT | no | '[]' | none | none |
| has_other_matter | INTEGER | no | 0 | none | none |
| other_matter_items | TEXT | no | '[]' | none | none |
| has_going_concern_uncertainty | INTEGER | no | 0 | none | none |
| going_concern_details | TEXT | no | none | none | none |
| going_concern_note_ref | TEXT | no | none | none | none |
| include_kam | INTEGER | no | 0 | none | none |
| is_finalized | INTEGER | no | 0 | none | none |
| finalized_at | TEXT | no | none | none | none |
| finalized_by | TEXT | no | none | none | none |
| version_number | INTEGER | no | 1 | none | none |
| board_report_status | TEXT | no | none | none | none |
| board_report_misstatement_details | TEXT | no | none | none | none |
| firm_name | TEXT | no | none | none | none |
| firm_registration_no | TEXT | no | none | none | none |
| partner_name | TEXT | no | none | none | none |
| membership_no | TEXT | no | none | none | none |
| clause_143_3_a | TEXT | no | none | none | none |
| clause_143_3_b | TEXT | no | none | none | none |
| clause_143_3_c | TEXT | no | none | none | none |
| clause_143_3_ca | TEXT | no | none | none | none |
| clause_143_3_d | TEXT | no | none | none | none |
| clause_143_3_e | TEXT | no | none | none | none |
| clause_143_3_f | TEXT | no | none | none | none |
| clause_143_3_g | TEXT | no | none | none | none |
| clause_143_3_h | TEXT | no | none | none | none |
| clause_143_3_i | TEXT | no | none | none | none |
| clause_143_3_j | TEXT | no | none | none | none |
| clause_143_3_a_status | TEXT | no | none | none | none |
| clause_143_3_a_details | TEXT | no | none | none | none |
| clause_143_3_b_audit_trail_status | TEXT | no | none | none | none |
| clause_143_3_b_audit_trail_details | TEXT | no | none | none | none |
| clause_143_3_b_server_outside_india | INTEGER | no | none | none | none |
| clause_143_3_c_branch_returns | TEXT | no | none | none | none |
| clause_143_3_e_going_concern_impact | TEXT | no | none | none | none |
| clause_143_3_f_directors_disqualified | INTEGER | no | none | none | none |
| clause_143_3_f_disqualified_details | TEXT | no | none | none | none |
| clause_143_3_g_qualification_impact | TEXT | no | none | none | none |
| clause_143_3_h_remuneration_status | TEXT | no | none | none | none |
| clause_143_3_h_details | TEXT | no | none | none | none |
| clause_143_3_i_ifc_qualification | TEXT | no | none | none | none |
| rule_11_a | TEXT | no | none | none | none |
| rule_11_b | TEXT | no | none | none | none |
| rule_11_c | TEXT | no | none | none | none |
| rule_11_d | TEXT | no | none | none | none |
| rule_11_e | TEXT | no | none | none | none |
| rule_11_f | TEXT | no | none | none | none |
| rule_11_g | TEXT | no | none | none | none |
| rule_11_a_pending_litigations | TEXT | no | none | none | none |
| rule_11_a_note_ref | TEXT | no | none | none | none |
| rule_11_b_long_term_contracts | TEXT | no | none | none | none |
| rule_11_b_note_ref | TEXT | no | none | none | none |
| rule_11_c_iepf_status | TEXT | no | none | none | none |
| rule_11_c_delay_amount | REAL | no | none | none | none |
| rule_11_c_delay_details | TEXT | no | none | none | none |
| rule_11_d_audit_procedures_status | TEXT | no | none | none | none |
| rule_11_d_loan_fund_representations | INTEGER | no | none | none | none |
| rule_11_d_modification_details | TEXT | no | none | none | none |
| rule_11_d_receiving_fund_representations | INTEGER | no | none | none | none |
| rule_11_e_dividend_status | TEXT | no | none | none | none |
| rule_11_e_dividend_note_ref | TEXT | no | none | none | none |
| rule_11_e_dividend_details | TEXT | no | none | none | none |
| rule_11_e_interim_dividend_paid | INTEGER | no | none | none | none |
| rule_11_e_interim_dividend_declared_not_paid | INTEGER | no | none | none | none |
| rule_11_e_final_dividend_previous_year | INTEGER | no | none | none | none |
| rule_11_e_final_dividend_proposed | INTEGER | no | none | none | none |
| rule_11_e_final_dividend_amount | REAL | no | none | none | none |
| rule_11_e_interim_dividend_amount | REAL | no | none | none | none |
| rule_11_f_audit_trail_status | TEXT | no | none | none | none |
| rule_11_f_audit_trail_details | TEXT | no | none | none | none |
| rule_11_g_funds_advanced_status | TEXT | no | none | none | none |
| rule_11_g_funds_advanced_details | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | no | datetime('now') | none | none |
| updated_at | TEXT | no | datetime('now') | none | none |

Declared unique index column groups: engagement_id; id.

## audit_report_setup

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| company_type | TEXT | no | none | none | none |
| company_cin | TEXT | no | none | none | none |
| registered_office | TEXT | no | none | none | none |
| nature_of_business | TEXT | no | none | none | none |
| is_standalone | INTEGER | no | 1 | none | none |
| accounting_framework | TEXT | no | 'AS' | none | none |
| is_listed_company | INTEGER | no | 0 | none | none |
| is_public_company | INTEGER | no | 0 | none | none |
| is_public_unlisted_company | INTEGER | no | 0 | none | none |
| is_private_company | INTEGER | no | 0 | none | none |
| is_private_exceeding_threshold | INTEGER | no | 0 | none | none |
| is_private_non_exceeding_threshold | INTEGER | no | 0 | none | none |
| is_small_company | INTEGER | no | 0 | none | none |
| is_opc | INTEGER | no | 0 | none | none |
| private_turnover_above_50cr | INTEGER | no | 0 | none | none |
| private_borrowing_above_25cr | INTEGER | no | 0 | none | none |
| ifc_applicable | INTEGER | no | 1 | none | none |
| caro_applicable_status | TEXT | no | 'pending' | none | none |
| caro_exclusion_reason | TEXT | no | none | none | none |
| caro_annexure_letter | TEXT | no | 'A' | none | none |
| ifc_annexure_letter | TEXT | no | 'B' | none | none |
| company_profit_or_loss | TEXT | no | none | none | none |
| cash_flow_required | INTEGER | no | 1 | none | none |
| has_branch_auditors | INTEGER | no | 0 | none | none |
| branch_locations | TEXT | no | none | none | none |
| has_predecessor_auditor | INTEGER | no | 0 | none | none |
| predecessor_auditor_name | TEXT | no | none | none | none |
| predecessor_report_date | TEXT | no | none | none | none |
| has_subsidiaries | INTEGER | no | 0 | none | none |
| paid_up_capital | REAL | no | 0 | none | none |
| reserves_surplus | REAL | no | 0 | none | none |
| borrowings_amount | REAL | no | 0 | none | none |
| signing_partner_id | TEXT | no | none | none | partners.id; on delete SET NULL |
| report_date | TEXT | no | none | none | none |
| report_city | TEXT | no | none | none | none |
| udin | TEXT | no | none | none | none |
| setup_completed | INTEGER | no | 0 | none | none |
| report_status | TEXT | no | 'draft' | none | none |
| locked | INTEGER | no | 0 | none | none |
| locked_at | TEXT | no | none | none | none |
| locked_by | TEXT | no | none | none | none |
| unlock_reason | TEXT | no | none | none | none |
| unlocked_at | TEXT | no | none | none | none |
| unlocked_by | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id; id.

## audit_trail

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| entity_type | TEXT | yes | none | none | none |
| entity_id | TEXT | yes | none | none | none |
| action | TEXT | yes | none | none | none |
| old_value | TEXT | no | none | none | none |
| new_value | TEXT | no | none | none | none |
| reason | TEXT | no | none | none | none |
| performed_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| performed_at | TEXT | yes | datetime('now') | none | none |
| metadata | TEXT | no | '{}' | none | none |

Declared unique index column groups: id.

## caro_clause_library

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| clause_id | TEXT | yes | none | none | none |
| clause_title | TEXT | yes | none | none | none |
| positive_wording | TEXT | no | none | none | none |
| negative_wording | TEXT | no | none | none | none |
| na_wording | TEXT | no | none | none | none |
| questions | TEXT | no | none | none | none |
| applicability_conditions | TEXT | no | none | none | none |
| evidence_checklist | TEXT | no | none | none | none |
| reviewer_prompts | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: clause_id; id.

## caro_clause_responses

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| clause_id | TEXT | yes | none | none | none |
| is_applicable | INTEGER | no | none | none | none |
| conclusion_text | TEXT | no | none | none | none |
| answers | TEXT | no | none | none | none |
| table_data | TEXT | no | none | none | none |
| status | TEXT | no | 'not_started' | none | none |
| prepared_by | TEXT | no | none | none | none |
| prepared_at | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id, clause_id; id.

Check expressions as declared: `status IN ('not_started', 'in_progress', 'completed')`.

## caro_standard_answers

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| clause_id | TEXT | yes | none | none | none |
| positive_wording | TEXT | no | none | none | none |
| negative_wording | TEXT | no | none | none | none |
| na_wording | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: clause_id; id.

## client_gstins

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| client_id | TEXT | yes | none | none | clients.id; on delete CASCADE |
| gstin | TEXT | yes | none | none | none |
| name | TEXT | no | none | none | none |
| taxpayer_type | TEXT | no | none | none | none |
| created_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: client_id, gstin; id.

## clients

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| name | TEXT | yes | none | none | none |
| industry | TEXT | no | none | none | none |
| constitution | TEXT | no | 'company' | none | none |
| cin | TEXT | no | none | none | none |
| pan | TEXT | no | none | none | none |
| address | TEXT | no | none | none | none |
| state | TEXT | no | none | none | none |
| pin | TEXT | no | none | none | none |
| contact_person | TEXT | no | none | none | none |
| contact_email | TEXT | no | none | none | none |
| contact_phone | TEXT | no | none | none | none |
| status | TEXT | yes | 'active' | none | none |
| notes | TEXT | no | none | none | none |
| created_by | TEXT | no | 'system' | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## compliance_applicability

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| inputs | TEXT | yes | '{}' | none | none |
| results | TEXT | yes | '[]' | none | none |
| reasons | TEXT | yes | '[]' | none | none |
| created_by | TEXT | no | none | none | none |
| updated_by | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id; id.

## engagement_assignments

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| user_id | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| role | TEXT | yes | none | none | none |
| assigned_by | TEXT | no | 'system' | none | none |
| assigned_at | TEXT | yes | datetime('now') | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id, user_id; id.

## engagement_letter_templates

Source: sqlite/schema/03_audit_program_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| template_type | TEXT | yes | none | none | none |
| template_name | TEXT | yes | none | none | none |
| template_description | TEXT | no | none | none | none |
| file_content | TEXT | yes | none | none | none |
| file_name | TEXT | yes | none | none | none |
| file_size_bytes | INTEGER | no | none | none | none |
| mime_type | TEXT | no | none | none | none |
| available_variables | TEXT | no | none | none | none |
| version_number | INTEGER | yes | 1 | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| uploaded_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| uploaded_at | TEXT | yes | datetime('now') | none | none |
| updated_by | TEXT | no | none | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |
| admin_notes | TEXT | no | none | none | none |

Declared unique index column groups: id.

Check expressions as declared: `template_type IN ('statutory_audit_company_without_ifc', 'statutory_audit_company_with_ifc', 'tax_audit_partnership_3ca', 'tax_audit_partnership_3cb')`.

## engagement_trial_balance_header

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| period_type | TEXT | yes | none | none | none |
| financial_year | TEXT | yes | none | none | none |
| source_type | TEXT | no | none | none | none |
| imported_at | TEXT | no | none | none | none |
| imported_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id, financial_year, period_type; id.

Check expressions as declared: `period_type IN ('CY', 'PY')`.

## engagement_trial_balance_lines

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| tb_header_id | TEXT | yes | none | none | engagement_trial_balance_header.id; on delete CASCADE |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| ledger_name | TEXT | yes | none | none | none |
| ledger_guid | TEXT | no | none | none | none |
| primary_group | TEXT | no | none | none | none |
| parent_group | TEXT | no | none | none | none |
| composite_key | TEXT | yes | none | none | none |
| opening | REAL | yes | 0 | none | none |
| debit | REAL | yes | 0 | none | none |
| credit | REAL | yes | 0 | none | none |
| closing | REAL | yes | 0 | none | none |
| dr_cr | TEXT | no | none | none | none |
| is_revenue | INTEGER | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: tb_header_id, composite_key; id.

## engagements

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| name | TEXT | yes | none | none | none |
| client_id | TEXT | no | none | none | clients.id; on delete SET NULL |
| client_name | TEXT | yes | none | none | none |
| engagement_type | TEXT | yes | 'statutory' | none | none |
| financial_year | TEXT | yes | none | none | none |
| status | TEXT | yes | 'planning' | none | none |
| partner_id | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| manager_id | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| firm_id | TEXT | no | none | none | firm_settings.id; on delete SET NULL |
| materiality_amount | REAL | no | none | none | none |
| performance_materiality | REAL | no | none | none | none |
| trivial_threshold | REAL | no | none | none | none |
| start_date | TEXT | no | none | none | none |
| end_date | TEXT | no | none | none | none |
| notes | TEXT | no | none | none | none |
| created_by | TEXT | no | 'system' | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `status IN ('planning', 'fieldwork', 'review', 'completion')`.

## evidence_files

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | no | none | none | engagements.id; on delete CASCADE |
| name | TEXT | yes | none | none | none |
| file_path | TEXT | yes | none | none | none |
| file_type | TEXT | yes | none | none | none |
| mime_type | TEXT | no | none | none | none |
| file_size | INTEGER | yes | none | none | none |
| linked_procedure | TEXT | no | none | none | none |
| workpaper_ref | TEXT | no | none | none | none |
| approval_stage | TEXT | yes | 'draft' | none | none |
| uploaded_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| prepared_by | TEXT | no | none | none | none |
| prepared_at | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| locked | INTEGER | yes | 0 | none | none |
| locked_by | TEXT | no | none | none | none |
| locked_at | TEXT | no | none | none | none |
| unlocked_by | TEXT | no | none | none | none |
| unlocked_at | TEXT | no | none | none | none |
| unlock_reason | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## evidence_links

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| procedure_id | TEXT | yes | none | none | audit_procedures.id; on delete CASCADE |
| evidence_id | TEXT | yes | none | none | evidence_files.id; on delete CASCADE |
| evidence_requirement_id | TEXT | no | none | none | procedure_evidence_requirements.id; on delete SET NULL |
| linked_by | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| linked_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## feedback_attachments

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| feedback_id | TEXT | yes | none | none | feedback_reports.id; on delete CASCADE |
| file_name | TEXT | yes | none | none | none |
| file_path | TEXT | yes | none | none | none |
| file_type | TEXT | yes | none | none | none |
| file_size | INTEGER | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## feedback_reports

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| user_id | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| feedback_type | TEXT | yes | none | none | none |
| title | TEXT | yes | none | none | none |
| description | TEXT | yes | none | none | none |
| priority | TEXT | no | 'medium' | none | none |
| status | TEXT | yes | 'open' | none | none |
| response | TEXT | no | none | none | none |
| resolved_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| resolved_at | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `feedback_type IN ('bug', 'feature', 'improvement', 'question')`; `priority IN ('low', 'medium', 'high', 'critical')`; `status IN ('open', 'in_progress', 'resolved', 'closed')`.

## financial_years

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| year_code | TEXT | yes | none | none | none |
| display_name | TEXT | yes | none | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | no | 'system' | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## firm_settings

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| firm_name | TEXT | yes | none | none | none |
| firm_registration_no | TEXT | no | none | none | none |
| constitution | TEXT | no | none | none | none |
| address | TEXT | no | none | none | none |
| icai_unique_sl_no | TEXT | no | none | none | none |
| no_of_partners | INTEGER | no | none | none | none |
| created_by | TEXT | no | 'system' | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## fs_templates

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| constitution_type | TEXT | yes | none | none | none |
| level1 | TEXT | no | none | none | none |
| level2 | TEXT | no | none | none | none |
| level3 | TEXT | no | none | none | none |
| level4 | TEXT | no | none | none | none |
| level5 | TEXT | no | none | none | none |
| sort_order | INTEGER | yes | 0 | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## gc_annexure_borrowings

Source: sqlite/schema/06_going_concern_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| workpaper_id | TEXT | yes | none | none | going_concern_workpapers.id; on delete CASCADE |
| particulars | TEXT | yes | none | none | none |
| current_year | REAL | no | 0 | none | none |
| previous_year | REAL | no | 0 | none | none |
| sort_order | INTEGER | no | 0 | none | none |
| is_total | INTEGER | no | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## gc_annexure_cash_flows

Source: sqlite/schema/06_going_concern_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| workpaper_id | TEXT | yes | none | none | going_concern_workpapers.id; on delete CASCADE |
| particulars | TEXT | yes | none | none | none |
| current_year | REAL | no | 0 | none | none |
| previous_year | REAL | no | 0 | none | none |
| sort_order | INTEGER | no | 0 | none | none |
| is_total | INTEGER | no | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## gc_annexure_net_worth

Source: sqlite/schema/06_going_concern_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| workpaper_id | TEXT | yes | none | none | going_concern_workpapers.id; on delete CASCADE |
| particulars | TEXT | yes | none | none | none |
| current_year | REAL | no | 0 | none | none |
| previous_year | REAL | no | 0 | none | none |
| sort_order | INTEGER | no | 0 | none | none |
| is_total | INTEGER | no | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## gc_annexure_profitability

Source: sqlite/schema/06_going_concern_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| workpaper_id | TEXT | yes | none | none | going_concern_workpapers.id; on delete CASCADE |
| particulars | TEXT | yes | none | none | none |
| current_year | REAL | no | 0 | none | none |
| previous_year | REAL | no | 0 | none | none |
| sort_order | INTEGER | no | 0 | none | none |
| is_total | INTEGER | no | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## gc_annexure_ratios

Source: sqlite/schema/06_going_concern_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| workpaper_id | TEXT | yes | none | none | going_concern_workpapers.id; on delete CASCADE |
| ratio_name | TEXT | yes | none | none | none |
| current_year | REAL | no | 0 | none | none |
| previous_year | REAL | no | 0 | none | none |
| variance | REAL | no | 0 | none | none |
| sort_order | INTEGER | no | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## going_concern_checklist_items

Source: sqlite/schema/06_going_concern_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| workpaper_id | TEXT | yes | none | none | going_concern_workpapers.id; on delete CASCADE |
| section_number | TEXT | no | none | none | none |
| item_number | TEXT | no | none | none | none |
| description | TEXT | yes | none | none | none |
| findings | TEXT | no | none | none | none |
| working | TEXT | no | none | none | none |
| annexure_ref | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## going_concern_workpapers

Source: sqlite/schema/06_going_concern_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| procedure_id | TEXT | no | none | none | audit_procedures.id; on delete SET NULL |
| chapter_no | TEXT | no | '4.1' | none | none |
| topic | TEXT | no | 'Going Concern' | none | none |
| conclusion | TEXT | no | none | none | none |
| status | TEXT | no | 'draft' | none | none |
| prepared_by | TEXT | no | none | none | none |
| prepared_at | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id; id.

## key_audit_matters

Source: sqlite/schema/04_audit_report_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| title | TEXT | yes | none | none | none |
| description | TEXT | yes | none | none | none |
| audit_response | TEXT | yes | none | none | none |
| sort_order | INTEGER | no | 0 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## materiality_risk_assessment

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| risk_state | TEXT | yes | '{}' | none | none |
| materiality_state | TEXT | yes | '{}' | none | none |
| created_by | TEXT | no | none | none | none |
| updated_by | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id; id.

## notifications

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| user_id | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| title | TEXT | yes | none | none | none |
| message | TEXT | yes | none | none | none |
| type | TEXT | yes | none | none | none |
| link | TEXT | no | none | none | none |
| is_read | INTEGER | yes | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## partners

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| name | TEXT | yes | none | none | none |
| membership_number | TEXT | no | none | none | none |
| email | TEXT | no | none | none | none |
| phone | TEXT | no | none | none | none |
| pan | TEXT | no | none | none | none |
| date_of_joining | TEXT | no | none | none | none |
| date_of_exit | TEXT | no | none | none | none |
| user_id | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | no | 'system' | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## procedure_assignees

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| procedure_id | TEXT | yes | none | none | audit_procedures.id; on delete CASCADE |
| user_id | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| assigned_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: procedure_id, user_id; id.

## procedure_checklist_items

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| procedure_id | TEXT | yes | none | none | audit_procedures.id; on delete CASCADE |
| text | TEXT | yes | none | none | none |
| status | TEXT | yes | 'pending' | none | none |
| is_required | INTEGER | yes | 0 | none | none |
| sort_order | INTEGER | yes | 0 | none | none |
| remarks | TEXT | no | none | none | none |
| completed_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| completed_at | TEXT | no | none | none | none |
| template_item_id | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `status IN ('pending', 'completed', 'na')`.

## procedure_evidence_requirements

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| procedure_id | TEXT | yes | none | none | audit_procedures.id; on delete CASCADE |
| title | TEXT | yes | none | none | none |
| is_required | INTEGER | yes | 0 | none | none |
| wp_ref | TEXT | no | none | none | none |
| allowed_file_types | TEXT | no | none | none | none |
| sort_order | INTEGER | yes | 0 | none | none |
| template_requirement_id | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## procedure_template_checklist_items

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| template_id | TEXT | yes | none | none | standard_procedures.id; on delete CASCADE |
| text | TEXT | yes | none | none | none |
| is_required | INTEGER | yes | 0 | none | none |
| sort_order | INTEGER | yes | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## procedure_template_evidence_requirements

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| template_id | TEXT | yes | none | none | standard_procedures.id; on delete CASCADE |
| title | TEXT | yes | none | none | none |
| is_required | INTEGER | yes | 0 | none | none |
| allowed_file_types | TEXT | no | none | none | none |
| sort_order | INTEGER | yes | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## profiles

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| user_id | TEXT | yes | none | none | none |
| full_name | TEXT | no | none | none | none |
| email | TEXT | yes | none | none | none |
| avatar_url | TEXT | no | none | none | none |
| phone | TEXT | no | none | none | none |
| membership_number | TEXT | no | none | none | none |
| firm_id | TEXT | no | none | none | firm_settings.id; on delete SET NULL |
| is_active | INTEGER | yes | 1 | none | none |
| password_hash | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: email; user_id; id.

## review_notes

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| procedure_id | TEXT | no | none | none | audit_procedures.id; on delete SET NULL |
| title | TEXT | yes | none | none | none |
| content | TEXT | yes | none | none | none |
| status | TEXT | yes | 'open' | none | none |
| priority | TEXT | yes | 'medium' | none | none |
| response | TEXT | no | none | none | none |
| assigned_to | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| resolved_by | TEXT | no | none | none | none |
| resolved_at | TEXT | no | none | none | none |
| approval_stage | TEXT | yes | 'draft' | none | none |
| locked | INTEGER | yes | 0 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `status IN ('open', 'responded', 'resolved')`.

## risks

Source: sqlite/schema/02_audit_workflow_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| risk_area | TEXT | yes | none | none | none |
| description | TEXT | yes | none | none | none |
| risk_type | TEXT | yes | 'significant' | none | none |
| inherent_risk | TEXT | yes | 'medium' | none | none |
| control_risk | TEXT | yes | 'medium' | none | none |
| combined_risk | TEXT | yes | 'medium' | none | none |
| key_controls | TEXT | no | none | none | none |
| audit_response | TEXT | no | none | none | none |
| status | TEXT | yes | 'open' | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `status IN ('open', 'mitigated', 'closed')`.

## rule_engine_group_rules

Source: sqlite/schema/07_rule_engine_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| rule_set_id | TEXT | yes | none | none | aile_rule_sets.id; on delete CASCADE |
| tally_group | TEXT | yes | none | none | none |
| schedule_iii_code | TEXT | yes | none | none | none |
| h1 | TEXT | no | none | none | none |
| h2 | TEXT | no | none | none | none |
| h3 | TEXT | no | none | none | none |
| h4 | TEXT | no | none | none | none |
| h5 | TEXT | no | none | none | none |
| priority | INTEGER | yes | 0 | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## rule_engine_keyword_rules

Source: sqlite/schema/07_rule_engine_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| rule_set_id | TEXT | yes | none | none | aile_rule_sets.id; on delete CASCADE |
| keyword | TEXT | yes | none | none | none |
| match_type | TEXT | yes | none | none | none |
| h1 | TEXT | no | none | none | none |
| h2 | TEXT | no | none | none | none |
| h3 | TEXT | no | none | none | none |
| h4 | TEXT | no | none | none | none |
| h5 | TEXT | no | none | none | none |
| priority | INTEGER | yes | 0 | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `match_type IN ('contains', 'exact', 'regex', 'starts_with', 'ends_with')`.

## rule_engine_override_rules

Source: sqlite/schema/07_rule_engine_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| ledger_name | TEXT | yes | none | none | none |
| h1 | TEXT | no | none | none | none |
| h2 | TEXT | no | none | none | none |
| h3 | TEXT | no | none | none | none |
| h4 | TEXT | no | none | none | none |
| h5 | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## rule_engine_validation_rules

Source: sqlite/schema/07_rule_engine_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| rule_set_id | TEXT | yes | none | none | aile_rule_sets.id; on delete CASCADE |
| rule_name | TEXT | yes | none | none | none |
| rule_description | TEXT | no | none | none | none |
| validation_type | TEXT | yes | none | none | none |
| validation_config | TEXT | no | none | none | none |
| severity | TEXT | yes | 'warning' | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `severity IN ('error', 'warning', 'info')`.

## schedule_iii_config

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| start_note_number | INTEGER | yes | 1 | none | none |
| include_contingent_liabilities | INTEGER | yes | 1 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id; id.

## standard_procedures

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| program_id | TEXT | yes | none | none | standard_programs.id; on delete CASCADE |
| procedure_name | TEXT | yes | none | none | none |
| area | TEXT | yes | none | none | none |
| assertion | TEXT | no | none | none | none |
| description | TEXT | no | none | none | none |
| checklist_items | TEXT | no | '[]' | none | none |
| evidence_requirements | TEXT | no | '[]' | none | none |
| is_standalone | INTEGER | yes | 0 | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## standard_programs

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| name | TEXT | yes | none | none | none |
| audit_area | TEXT | yes | none | none | none |
| engagement_type | TEXT | yes | 'statutory' | none | none |
| description | TEXT | no | none | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## tally_bridge_requests

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| session_id | TEXT | yes | none | none | tally_bridge_sessions.id; on delete CASCADE |
| request_type | TEXT | yes | none | none | none |
| request_xml | TEXT | yes | none | none | none |
| response_xml | TEXT | no | none | none | none |
| status | TEXT | yes | 'pending' | none | none |
| error_message | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| completed_at | TEXT | no | none | none | none |

Declared unique index column groups: id.

Check expressions as declared: `status IN ('pending', 'processing', 'completed', 'failed')`.

## tally_bridge_sessions

Source: sqlite/schema/08_template_system_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | no | none | none | engagements.id; on delete SET NULL |
| session_key | TEXT | yes | none | none | none |
| status | TEXT | yes | 'active' | none | none |
| company_name | TEXT | no | none | none | none |
| tally_version | TEXT | no | none | none | none |
| last_ping | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| expires_at | TEXT | no | none | none | none |

Declared unique index column groups: session_key; id.

## tax_audit_acceptance_checks

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| tax_audit_id | TEXT | yes | none | none | tax_audit_engagements.id; on delete CASCADE |
| checklist_json | TEXT | yes | '{}' | none | none |
| overall_status | TEXT | yes | 'not_started' | none | none |
| remarks_html | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: tax_audit_id; id.

Check expressions as declared: `overall_status IN ('not_started', 'in_progress', 'completed', 'issue_noted', 'not_accepted')`.

## tax_audit_clause_evidence

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| tax_audit_id | TEXT | yes | none | none | tax_audit_engagements.id; on delete CASCADE |
| clause_response_id | TEXT | yes | none | none | tax_audit_clause_responses.id; on delete CASCADE |
| clause_key | TEXT | yes | none | none | none |
| evidence_file_id | TEXT | yes | none | none | evidence_files.id; on delete CASCADE |
| workpaper_ref | TEXT | no | none | none | none |
| notes_html | TEXT | no | none | none | none |
| linked_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| linked_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: clause_response_id, evidence_file_id; id.

## tax_audit_clause_responses

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| tax_audit_id | TEXT | yes | none | none | tax_audit_engagements.id; on delete CASCADE |
| clause_key | TEXT | yes | none | none | none |
| clause_no | TEXT | yes | none | none | none |
| clause_title | TEXT | yes | none | none | none |
| statutory_version | TEXT | yes | 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025' | none | none |
| applicability_status | TEXT | yes | 'applicable' | none | none |
| response_json | TEXT | no | '{}' | none | none |
| response_html | TEXT | no | none | none | none |
| auditor_remarks_html | TEXT | no | none | none | none |
| prefill_status | TEXT | yes | 'not_attempted' | none | none |
| source_links_json | TEXT | no | '[]' | none | none |
| source_conflicts_json | TEXT | no | '[]' | none | none |
| missing_fields_json | TEXT | no | '[]' | none | none |
| last_source_hash | TEXT | no | none | none | none |
| validation_status | TEXT | yes | 'not_run' | none | none |
| validation_messages_json | TEXT | no | '[]' | none | none |
| qualification_required | INTEGER | yes | 0 | none | none |
| qualification_text_html | TEXT | no | none | none | none |
| workpaper_ref | TEXT | no | none | none | none |
| review_status | TEXT | yes | 'draft' | none | none |
| prepared_by | TEXT | no | none | none | none |
| prepared_at | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| locked | INTEGER | yes | 0 | none | none |
| locked_by | TEXT | no | none | none | none |
| locked_at | TEXT | no | none | none | none |
| unlock_reason | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: tax_audit_id, clause_key; id.

Check expressions as declared: `applicability_status IN ('applicable', 'not_applicable', 'not_assessed')`; `prefill_status IN ('not_attempted', 'auto_filled', 'partially_filled', 'needs_input', 'source_conflict', 'outdated_source', 'manual_override')`; `validation_status IN ('not_run', 'valid', 'warning', 'error')`; `review_status IN ('draft', 'prepared', 'reviewed', 'approved', 'locked')`.

## tax_audit_engagements

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| client_id | TEXT | no | none | none | clients.id; on delete SET NULL |
| statutory_version | TEXT | yes | 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025' | none | none |
| form_type | TEXT | yes | '3CB' | none | none |
| financial_year | TEXT | no | none | none | none |
| assessment_year | TEXT | no | none | none | none |
| previous_year_from | TEXT | no | none | none | none |
| previous_year_to | TEXT | no | none | none | none |
| assessee_name | TEXT | no | none | none | none |
| pan | TEXT | no | none | none | none |
| address | TEXT | no | none | none | none |
| status | TEXT | no | none | none | none |
| business_or_profession | TEXT | no | 'business' | none | none |
| nature_of_business | TEXT | no | none | none | none |
| books_audited_under_other_law | INTEGER | yes | 0 | none | none |
| other_law_name | TEXT | no | none | none | none |
| turnover | REAL | no | 0 | none | none |
| gross_receipts | REAL | no | 0 | none | none |
| cash_receipts_percent | REAL | no | 0 | none | none |
| cash_payments_percent | REAL | no | 0 | none | none |
| presumptive_taxation | INTEGER | yes | 0 | none | none |
| lower_than_presumptive | INTEGER | yes | 0 | none | none |
| applicability_result | TEXT | no | none | none | none |
| applicability_reason | TEXT | no | none | none | none |
| setup_json | TEXT | no | '{}' | none | none |
| source_links_json | TEXT | no | '[]' | none | none |
| status_summary_json | TEXT | no | '{}' | none | none |
| review_status | TEXT | yes | 'draft' | none | none |
| prepared_by | TEXT | no | none | none | none |
| prepared_at | TEXT | no | none | none | none |
| reviewed_by | TEXT | no | none | none | none |
| reviewed_at | TEXT | no | none | none | none |
| approved_by | TEXT | no | none | none | none |
| approved_at | TEXT | no | none | none | none |
| locked | INTEGER | yes | 0 | none | none |
| locked_by | TEXT | no | none | none | none |
| locked_at | TEXT | no | none | none | none |
| unlock_reason | TEXT | no | none | none | none |
| created_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: engagement_id, statutory_version; id.

Check expressions as declared: `form_type IN ('3CA', '3CB')`; `review_status IN ('draft', 'prepared', 'reviewed', 'approved', 'locked')`.

## tax_audit_exports

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| tax_audit_id | TEXT | yes | none | none | tax_audit_engagements.id; on delete CASCADE |
| export_type | TEXT | yes | none | none | none |
| file_name | TEXT | no | none | none | none |
| file_path | TEXT | no | none | none | none |
| exported_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| exported_at | TEXT | yes | datetime('now') | none | none |
| export_metadata_json | TEXT | no | '{}' | none | none |

Declared unique index column groups: id.

Check expressions as declared: `export_type IN ('pdf', 'excel', 'json', 'working_paper')`.

## tax_audit_qualifications

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| tax_audit_id | TEXT | yes | none | none | tax_audit_engagements.id; on delete CASCADE |
| clause_response_id | TEXT | no | none | none | tax_audit_clause_responses.id; on delete SET NULL |
| clause_key | TEXT | no | none | none | none |
| qualification_html | TEXT | yes | none | none | none |
| severity | TEXT | yes | 'observation' | none | none |
| include_in_report | INTEGER | yes | 1 | none | none |
| created_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `severity IN ('observation', 'qualification', 'adverse')`.

## tax_audit_review_notes

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| tax_audit_id | TEXT | yes | none | none | tax_audit_engagements.id; on delete CASCADE |
| clause_response_id | TEXT | no | none | none | tax_audit_clause_responses.id; on delete CASCADE |
| clause_key | TEXT | no | none | none | none |
| note_html | TEXT | yes | none | none | none |
| status | TEXT | yes | 'open' | none | none |
| assigned_to | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| created_by | TEXT | no | none | none | profiles.user_id; on delete SET NULL |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

Check expressions as declared: `status IN ('open', 'responded', 'resolved')`.

## tax_audit_statutory_versions

Source: sqlite/schema/09_tax_audit_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| version_key | TEXT | yes | none | none | none |
| display_name | TEXT | yes | none | none | none |
| act_name | TEXT | yes | none | none | none |
| rule_reference | TEXT | no | none | none | none |
| form_set | TEXT | yes | none | none | none |
| effective_from | TEXT | no | none | none | none |
| effective_to | TEXT | no | none | none | none |
| is_active | INTEGER | yes | 1 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: version_key; id.

## tb_new_classification_mappings

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| entity_info_id | TEXT | yes | none | none | tb_new_entity_info.id; on delete CASCADE |
| ledger_name | TEXT | yes | none | none | none |
| custom_h1 | TEXT | no | none | none | none |
| custom_h2 | TEXT | no | none | none | none |
| custom_h3 | TEXT | no | none | none | none |
| custom_h4 | TEXT | no | none | none | none |
| custom_h5 | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## tb_new_entity_info

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| entity_name | TEXT | no | none | none | none |
| entity_type | TEXT | no | none | none | none |
| business_type | TEXT | no | none | none | none |
| period_from | TEXT | no | none | none | none |
| period_to | TEXT | no | none | none | none |
| company_name | TEXT | no | none | none | none |
| company_cin | TEXT | no | none | none | none |
| company_pan | TEXT | no | none | none | none |
| company_address | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## tb_new_ledgers

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| entity_info_id | TEXT | yes | none | none | tb_new_entity_info.id; on delete CASCADE |
| ledger_name | TEXT | yes | none | none | none |
| primary_group | TEXT | no | none | none | none |
| h1 | TEXT | no | none | none | none |
| h2 | TEXT | no | none | none | none |
| h3 | TEXT | no | none | none | none |
| h4 | TEXT | no | none | none | none |
| h5 | TEXT | no | none | none | none |
| opening_balance | REAL | no | 0 | none | none |
| closing_balance | REAL | no | 0 | none | none |
| debit | REAL | no | 0 | none | none |
| credit | REAL | no | 0 | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## tb_new_sessions

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| session_name | TEXT | yes | none | none | none |
| session_data | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## tb_new_stock_items

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| entity_info_id | TEXT | yes | none | none | tb_new_entity_info.id; on delete CASCADE |
| item_name | TEXT | yes | none | none | none |
| opening_qty | REAL | no | 0 | none | none |
| opening_value | REAL | no | 0 | none | none |
| closing_qty | REAL | no | 0 | none | none |
| closing_value | REAL | no | 0 | none | none |
| unit | TEXT | no | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## trial_balance_lines

Source: sqlite/schema/05_trial_balance_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| engagement_id | TEXT | yes | none | none | engagements.id; on delete CASCADE |
| account_code | TEXT | yes | none | none | none |
| account_name | TEXT | yes | none | none | none |
| opening_balance | REAL | yes | 0 | none | none |
| debit | REAL | yes | 0 | none | none |
| credit | REAL | yes | 0 | none | none |
| closing_balance | REAL | yes | 0 | none | none |
| fs_area | TEXT | no | none | none | none |
| aile | TEXT | no | none | none | none |
| face_group | TEXT | no | none | none | none |
| note_group | TEXT | no | none | none | none |
| sub_note | TEXT | no | none | none | none |
| level4_group | TEXT | no | none | none | none |
| level5_detail | TEXT | no | none | none | none |
| schedule_iii_code | TEXT | no | none | none | none |
| ledger_primary_group | TEXT | no | none | none | none |
| ledger_parent | TEXT | no | none | none | none |
| period_type | TEXT | no | 'current' | none | none |
| version | INTEGER | yes | 1 | none | none |
| applied_rule_id | TEXT | no | none | none | none |
| validation_flags | TEXT | no | none | none | none |
| created_by | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: id.

## user_roles

Source: sqlite/schema/01_core_tables.sql. No feature-level runtime acceptance is inferred.

| Column | Declared type | Explicit NOT NULL | Default SQL | PK position | Foreign key |
| --- | --- | --- | --- | --- | --- |
| id | TEXT | no | lower(hex(randomblob(16))) | 1 | none |
| user_id | TEXT | yes | none | none | profiles.user_id; on delete CASCADE |
| role | TEXT | yes | none | none | none |
| created_at | TEXT | yes | datetime('now') | none | none |
| updated_at | TEXT | yes | datetime('now') | none | none |

Declared unique index column groups: user_id, role; id.

Check expressions as declared: `role IN ('admin', 'partner', 'manager', 'senior', 'staff', 'viewer', 'user')`.
