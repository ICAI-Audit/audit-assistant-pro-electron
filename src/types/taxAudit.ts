export type TaxAuditStatutoryVersion = 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025';

export type TaxAuditFormType = '3CA' | '3CB';

export type TaxAuditReviewStatus = 'draft' | 'prepared' | 'reviewed' | 'approved' | 'locked';

export type TaxAuditPrefillStatus =
  | 'not_attempted'
  | 'auto_filled'
  | 'partially_filled'
  | 'needs_input'
  | 'source_conflict'
  | 'outdated_source'
  | 'manual_override';

export type TaxAuditApplicabilityStatus = 'applicable' | 'not_applicable' | 'not_assessed';

export type TaxAuditValidationStatus = 'not_run' | 'valid' | 'warning' | 'error';

export type TaxAuditAcceptanceStatus = 'not_started' | 'in_progress' | 'completed' | 'issue_noted' | 'not_accepted';

export type TaxAuditChecklistResponse = 'yes' | 'no' | 'na' | '';

export type TaxAuditSourceModule =
  | 'client_master'
  | 'engagement'
  | 'financial_review'
  | 'gst'
  | 'tax_audit_setup'
  | 'compliance_applicability'
  | 'evidence'
  | 'manual';

export type TaxAuditSourceLink = {
  label: string;
  module: TaxAuditSourceModule;
  route?: string;
  entityId?: string | null;
  field?: string;
  anchor?: string;
  displayValue?: string | number | null;
};

export type TaxAuditClauseDefinition = {
  key: string;
  clauseNo: string;
  title: string;
  group: string;
  description?: string;
  requiresEvidence?: boolean;
  prefillStrategy?: 'master' | 'setup' | 'financial_review' | 'gst' | 'manual';
};

export type TaxAuditSetup = {
  id?: string;
  engagement_id: string;
  client_id?: string | null;
  statutory_version: TaxAuditStatutoryVersion;
  form_type: TaxAuditFormType;
  financial_year?: string | null;
  assessment_year?: string | null;
  previous_year_from?: string | null;
  previous_year_to?: string | null;
  assessee_name?: string | null;
  pan?: string | null;
  address?: string | null;
  status?: string | null;
  business_or_profession?: 'business' | 'profession';
  nature_of_business?: string | null;
  books_audited_under_other_law?: boolean | number;
  other_law_name?: string | null;
  turnover?: number | null;
  gross_receipts?: number | null;
  cash_receipts_percent?: number | null;
  cash_payments_percent?: number | null;
  presumptive_taxation?: boolean | number;
  lower_than_presumptive?: boolean | number;
  applicability_result?: string | null;
  applicability_reason?: string | null;
  setup_json?: string;
  source_links_json?: string;
  status_summary_json?: string;
  review_status: TaxAuditReviewStatus;
  locked?: boolean | number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaxAuditClauseResponse = {
  id: string;
  tax_audit_id: string;
  clause_key: string;
  clause_no: string;
  clause_title: string;
  statutory_version: TaxAuditStatutoryVersion;
  applicability_status: TaxAuditApplicabilityStatus;
  response_json?: string | null;
  response_html?: string | null;
  auditor_remarks_html?: string | null;
  prefill_status: TaxAuditPrefillStatus;
  source_links_json?: string | null;
  source_conflicts_json?: string | null;
  missing_fields_json?: string | null;
  last_source_hash?: string | null;
  validation_status: TaxAuditValidationStatus;
  validation_messages_json?: string | null;
  qualification_required: boolean | number;
  qualification_text_html?: string | null;
  workpaper_ref?: string | null;
  review_status: TaxAuditReviewStatus;
  prepared_by?: string | null;
  prepared_at?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  locked: boolean | number;
  locked_by?: string | null;
  locked_at?: string | null;
  unlock_reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaxAuditAcceptanceChecklistItem = {
  id: string;
  label: string;
  response: TaxAuditChecklistResponse;
  remarks: string;
};

export type TaxAuditAcceptanceChecklistSection = {
  id: string;
  title: string;
  items: TaxAuditAcceptanceChecklistItem[];
};

export type TaxAuditAcceptanceChecklist = {
  version: 1;
  sections: TaxAuditAcceptanceChecklistSection[];
};

export type TaxAuditAcceptanceCheck = {
  id?: string;
  tax_audit_id: string;
  checklist_json: string;
  overall_status: TaxAuditAcceptanceStatus;
  remarks_html?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaxAuditClauseEvidence = {
  id: string;
  tax_audit_id: string;
  clause_response_id: string;
  clause_key: string;
  evidence_file_id: string;
  workpaper_ref?: string | null;
  notes_html?: string | null;
  linked_by?: string | null;
  linked_at: string;
};

export type TaxAuditSummary = {
  totalClauses: number;
  prepared: number;
  reviewed: number;
  approved: number;
  needsInput: number;
  partial: number;
  conflicts: number;
  evidenceLinked: number;
  qualifications: number;
};
