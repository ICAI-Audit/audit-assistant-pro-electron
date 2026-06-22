export type TaxAuditProgrammeLinkedTab = 'setup' | 'acceptance' | 'compliance' | 'clauses' | 'summary';

export type TaxAuditProgrammeChecklistItem = {
  id: string;
  group: string;
  title: string;
  description: string;
  suggestedEvidence: string;
  referenceArea: string;
  linkedTab: TaxAuditProgrammeLinkedTab;
  linkedClauseKey?: string;
  isRequiredByDefault: boolean;
  displayOrder: number;
};

export const TAX_AUDIT_PROGRAMME_GROUPS = [
  'A. Engagement Planning',
  'B. Auditor Acceptance and Eligibility',
  'C. Applicability and Form Selection',
  'D. Books of Account and Records',
  'E. Form 3CA / 3CB Readiness',
  'F. Form 3CD Clause Work',
  'G. Evidence and Documentation',
  'H. Review and Approval',
  'I. UDIN and Filing Follow-up',
] as const;

const item = (
  id: string,
  group: (typeof TAX_AUDIT_PROGRAMME_GROUPS)[number],
  title: string,
  description: string,
  suggestedEvidence: string,
  referenceArea: string,
  linkedTab: TaxAuditProgrammeLinkedTab,
  displayOrder: number,
  isRequiredByDefault = true,
  linkedClauseKey?: string
): TaxAuditProgrammeChecklistItem => ({
  id,
  group,
  title,
  description,
  suggestedEvidence,
  referenceArea,
  linkedTab,
  linkedClauseKey,
  isRequiredByDefault,
  displayOrder,
});

export const TAX_AUDIT_PROGRAMME_CHECKLIST: TaxAuditProgrammeChecklistItem[] = [
  item('planning_client_assessment_year', TAX_AUDIT_PROGRAMME_GROUPS[0], 'Confirm client and assessment year details.', 'Verify assessee name, PAN, address and assessment year before detailed work starts.', 'Client master and engagement setup', 'Setup and Applicability', 'setup', 10),
  item('planning_previous_year', TAX_AUDIT_PROGRAMME_GROUPS[0], 'Confirm previous year and relevant financial period.', 'Check previous year start and end dates for the tax audit engagement.', 'Engagement financial year details', 'Setup and Applicability', 'setup', 20),
  item('planning_engagement_scope', TAX_AUDIT_PROGRAMME_GROUPS[0], 'Confirm engagement scope and nature of tax audit.', 'Record whether the engagement covers business, profession, or both activity profiles.', 'Engagement scope note', 'Setup and Applicability', 'setup', 30),
  item('planning_engagement_letter', TAX_AUDIT_PROGRAMME_GROUPS[0], 'Obtain appointment / engagement letter.', 'Confirm appointment and engagement terms are available for the tax audit.', 'Appointment letter / engagement letter', 'Acceptance and Eligibility', 'acceptance', 40),
  item('planning_other_law_audit', TAX_AUDIT_PROGRAMME_GROUPS[0], 'Identify whether audit under any other law is applicable.', 'Review whether Form 3CA or Form 3CB route is applicable.', 'Other-law audit details and financial statements', 'Setup and Applicability', 'setup', 50),

  item('acceptance_checklist_complete', TAX_AUDIT_PROGRAMME_GROUPS[1], 'Complete acceptance and eligibility checklist.', 'Complete the acceptance checklist before relying on clause work.', 'Acceptance checklist responses', 'Acceptance and Eligibility', 'acceptance', 110),
  item('acceptance_independence', TAX_AUDIT_PROGRAMME_GROUPS[1], 'Confirm independence and eligibility.', 'Confirm the signing auditor is eligible and independent for the engagement.', 'Eligibility declaration and independence confirmation', 'Acceptance and Eligibility', 'acceptance', 120),
  item('acceptance_assignment_ceiling', TAX_AUDIT_PROGRAMME_GROUPS[1], 'Confirm tax audit assignment ceiling.', 'Review whether the signing member remains within the prescribed tax audit limit.', 'Assignment count working', 'Acceptance and Eligibility', 'acceptance', 130),
  item('acceptance_previous_auditor', TAX_AUDIT_PROGRAMME_GROUPS[1], 'Confirm communication with previous auditor, where applicable.', 'Document previous auditor communication or reason why it is not applicable.', 'Previous auditor communication record', 'Acceptance and Eligibility', 'acceptance', 140),
  item('acceptance_management_acknowledgment', TAX_AUDIT_PROGRAMME_GROUPS[1], 'Obtain management responsibility acknowledgment.', 'Confirm management responsibility for particulars and records has been acknowledged.', 'Management representation or acknowledgement', 'Acceptance and Eligibility', 'acceptance', 150),

  item('applicability_assessment', TAX_AUDIT_PROGRAMME_GROUPS[2], 'Complete applicability assessment.', 'Conclude whether tax audit is applicable based on available facts.', 'Applicability calculation and reason', 'Setup and Applicability', 'setup', 210),
  item('applicability_thresholds', TAX_AUDIT_PROGRAMME_GROUPS[2], 'Review turnover / gross receipts threshold.', 'Review thresholds for business turnover and professional gross receipts.', 'Turnover / gross receipts working', 'Setup and Applicability', 'setup', 220),
  item('applicability_activity_profile', TAX_AUDIT_PROGRAMME_GROUPS[2], 'Review business / profession / presumptive taxation position.', 'Confirm activity profile, presumptive taxation and lower-income positions.', 'Applicability inputs and tax computation summary', 'Setup and Applicability', 'setup', 230),
  item('applicability_form_type', TAX_AUDIT_PROGRAMME_GROUPS[2], 'Confirm applicable form: 3CA or 3CB.', 'Confirm selected report form aligns with other-law audit status.', 'Form selection basis', 'Setup and Applicability', 'setup', 240),
  item('applicability_reason', TAX_AUDIT_PROGRAMME_GROUPS[2], 'Document reason for form selection.', 'Document why the selected form applies to the engagement.', 'Applicability reason note', 'Setup and Applicability', 'setup', 250),

  item('books_maintained', TAX_AUDIT_PROGRAMME_GROUPS[3], 'Confirm books of account maintained.', 'Confirm books maintained under applicable law and business practice.', 'Books maintained list', '3CD Clause Workspace', 'clauses', 310, true, 'clause_11'),
  item('books_examined', TAX_AUDIT_PROGRAMME_GROUPS[3], 'Confirm books examined.', 'Document books and records examined for tax audit purposes.', 'Books examined list', '3CD Clause Workspace', 'clauses', 320, true, 'clause_11'),
  item('books_locations', TAX_AUDIT_PROGRAMME_GROUPS[3], 'Confirm principal place and additional places of books.', 'Review the places where books of account are kept.', 'Books location details', '3CD Clause Workspace', 'clauses', 330, true, 'clause_11'),
  item('books_accounting_method', TAX_AUDIT_PROGRAMME_GROUPS[3], 'Confirm accounting method.', 'Review accounting method and changes, if any.', 'Accounting policy note', '3CD Clause Workspace', 'clauses', 340, true, 'clause_13'),
  item('books_stock_records', TAX_AUDIT_PROGRAMME_GROUPS[3], 'Confirm stock records, if applicable.', 'Review stock records and valuation basis where inventory exists.', 'Stock records and valuation working', '3CD Clause Workspace', 'clauses', 350, false, 'clause_14'),
  item('books_supporting_records', TAX_AUDIT_PROGRAMME_GROUPS[3], 'Confirm supporting records for tax audit clauses.', 'Confirm source records are available for manually captured clauses.', 'Ledger extracts, computations and schedules', '3CD Clause Workspace', 'clauses', 360),

  item('form_readiness_financial_statements', TAX_AUDIT_PROGRAMME_GROUPS[4], 'Confirm financial statements are available.', 'Confirm signed or final financial statements are available for reporting.', 'Financial statements', 'Compliance Tracker', 'compliance', 410),
  item('form_readiness_other_law_status', TAX_AUDIT_PROGRAMME_GROUPS[4], 'Confirm audit under other law status.', 'Confirm audit under other law status for Form 3CA / 3CB selection.', 'Other-law audit report or management confirmation', 'Setup and Applicability', 'setup', 420),
  item('form_readiness_observations', TAX_AUDIT_PROGRAMME_GROUPS[4], 'Confirm observations / qualifications, if any.', 'Review whether report observations or qualifications are required.', 'Observation / qualification working', 'Review Summary', 'summary', 430),
  item('form_readiness_annexures', TAX_AUDIT_PROGRAMME_GROUPS[4], 'Confirm annexures and Form 3CD linkage.', 'Confirm Form 3CD is linked to the appropriate main report form.', 'Annexure review note', 'Review Summary', 'summary', 440),
  item('form_readiness_management_authentication', TAX_AUDIT_PROGRAMME_GROUPS[4], 'Confirm management authentication of particulars.', 'Confirm management has authenticated particulars furnished for the audit.', 'Management authentication / representation', 'Acceptance and Eligibility', 'acceptance', 450),

  item('clauses_complete_active', TAX_AUDIT_PROGRAMME_GROUPS[5], 'Complete all active Form 3CD clauses.', 'Ensure every active Form 3CD clause has been started, prepared or reviewed as applicable.', 'Review Summary clause table', 'Review Summary', 'summary', 510),
  item('clauses_resolve_attention', TAX_AUDIT_PROGRAMME_GROUPS[5], 'Resolve clauses marked Needs Attention.', 'Review and resolve clauses requiring attention.', 'Review Summary attention filter', 'Review Summary', 'summary', 520),
  item('clauses_validation_warnings', TAX_AUDIT_PROGRAMME_GROUPS[5], 'Review clauses with validation warnings.', 'Review warnings and document the auditor conclusion.', 'Validation warning list', 'Review Summary', 'summary', 530),
  item('clauses_internal_remarks', TAX_AUDIT_PROGRAMME_GROUPS[5], 'Review clauses with internal remarks.', 'Clear or carry forward internal remarks as appropriate.', 'Internal Audit Remarks', 'Review Summary', 'summary', 540),
  item('clauses_qualifications', TAX_AUDIT_PROGRAMME_GROUPS[5], 'Review clauses with qualifications or observations.', 'Review report-level observation wording for applicable clauses.', 'Qualification / observation wording', 'Review Summary', 'summary', 550),
  item('clauses_omitted_inactive', TAX_AUDIT_PROGRAMME_GROUPS[5], 'Confirm omitted/inactive clauses are not included.', 'Confirm Clause 28, Clause 29 and inactive Clause 36 are not included for AY 2025-26.', 'Active clause list review', 'Review Summary', 'summary', 560),

  item('evidence_key_clauses', TAX_AUDIT_PROGRAMME_GROUPS[6], 'Link evidence / working papers to key clauses.', 'Link evidence or working references to key tax audit clauses.', 'Evidence links / working paper index', '3CD Clause Workspace', 'clauses', 610),
  item('evidence_structured_no_evidence', TAX_AUDIT_PROGRAMME_GROUPS[6], 'Review clauses with structured data but no evidence.', 'Review clauses where particulars exist but evidence is not linked.', 'Review Summary evidence filter', 'Review Summary', 'summary', 620),
  item('evidence_management_representations', TAX_AUDIT_PROGRAMME_GROUPS[6], 'Review management representations.', 'Confirm representations support manual assertions and judgements.', 'Management representation letter', 'Acceptance and Eligibility', 'acceptance', 630),
  item('evidence_working_references', TAX_AUDIT_PROGRAMME_GROUPS[6], 'Confirm working paper references are adequate.', 'Confirm working references are understandable and traceable.', 'Working paper index', 'Review Summary', 'summary', 640),
  item('evidence_manual_computations', TAX_AUDIT_PROGRAMME_GROUPS[6], 'Confirm basis of manual computations / classifications.', 'Document the basis for manual computations and classifications.', 'Manual computation workings', '3CD Clause Workspace', 'clauses', 650),

  item('review_mark_prepared', TAX_AUDIT_PROGRAMME_GROUPS[7], 'Mark prepared clauses.', 'Mark clauses as prepared after audit work is completed.', 'Clause review status', 'Review Summary', 'summary', 710),
  item('review_prepared_clauses', TAX_AUDIT_PROGRAMME_GROUPS[7], 'Review prepared clauses.', 'Review prepared clauses before report preparation.', 'Reviewer notes', 'Review Summary', 'summary', 720),
  item('review_approve_clauses', TAX_AUDIT_PROGRAMME_GROUPS[7], 'Approve completed clauses.', 'Approve or lock clauses after review is complete.', 'Approval status', 'Review Summary', 'summary', 730),
  item('review_report_readiness', TAX_AUDIT_PROGRAMME_GROUPS[7], 'Review Report Readiness panel.', 'Review readiness status and attention items before report preparation.', 'Report Readiness panel', 'Review Summary', 'summary', 740),
  item('review_resolve_critical', TAX_AUDIT_PROGRAMME_GROUPS[7], 'Resolve critical readiness items.', 'Resolve critical readiness items or document why they remain open.', 'Readiness attention list', 'Review Summary', 'summary', 750),
  item('review_unresolved_matters', TAX_AUDIT_PROGRAMME_GROUPS[7], 'Document unresolved review matters.', 'Document unresolved matters requiring partner or management attention.', 'Review notes and internal remarks', 'Review Summary', 'summary', 760),

  item('filing_specified_date', TAX_AUDIT_PROGRAMME_GROUPS[8], 'Confirm specified date.', 'Confirm return due date and specified date for tax audit report.', 'Compliance tracker date fields', 'Compliance Tracker', 'compliance', 810),
  item('filing_udin_status', TAX_AUDIT_PROGRAMME_GROUPS[8], 'Confirm UDIN status.', 'Confirm whether UDIN is required, generated and updated where applicable.', 'UDIN details', 'Compliance Tracker', 'compliance', 820),
  item('filing_upload_status', TAX_AUDIT_PROGRAMME_GROUPS[8], 'Confirm tax audit report upload status.', 'Track Form 3CA/3CB and Form 3CD upload status.', 'Filing workflow status', 'Compliance Tracker', 'compliance', 830),
  item('filing_assessee_acceptance', TAX_AUDIT_PROGRAMME_GROUPS[8], 'Confirm assessee acceptance status.', 'Track client acceptance of uploaded report.', 'Client acceptance status', 'Compliance Tracker', 'compliance', 840),
  item('filing_acknowledgement', TAX_AUDIT_PROGRAMME_GROUPS[8], 'Record acknowledgement details.', 'Record acknowledgement reference and date where available.', 'Acknowledgement reference and date', 'Compliance Tracker', 'compliance', 850),
  item('filing_post_filing_remarks', TAX_AUDIT_PROGRAMME_GROUPS[8], 'Record post-filing remarks, if any.', 'Document post-filing notes and follow-up matters.', 'Post-filing remarks', 'Compliance Tracker', 'compliance', 860, false),
];
