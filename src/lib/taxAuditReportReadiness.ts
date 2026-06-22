import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { calculateApplicability } from '@/lib/taxAuditApplicability';
import { normalizeTaxAuditDisclaimerAcknowledgement } from '@/lib/taxAuditDisclaimer';
import { normalizeTaxAuditProgramme, summarizeTaxAuditProgramme } from '@/lib/taxAuditProgramme';
import { TaxAuditReviewSummaryCounts, TaxAuditReviewSummaryRow } from '@/lib/taxAuditReviewSummary';
import {
  TaxAuditAcceptanceCheck,
  TaxAuditChecklistResponse,
  TaxAuditComplianceTracker,
  TaxAuditComplianceWorkflowStatus,
  TaxAuditSetup,
} from '@/types/taxAudit';

export type TaxAuditReadinessLevel = 'not_ready' | 'needs_review' | 'ready';
export type TaxAuditReadinessSeverity = 'critical' | 'review_required' | 'advisory';
export type TaxAuditReadinessCheckStatus = 'complete' | 'needs_review' | 'missing';
export type TaxAuditReadinessActionTarget = 'overview' | 'setup' | 'acceptance' | 'compliance' | 'programme' | 'clause';

export type TaxAuditReadinessCheck = {
  label: string;
  status: TaxAuditReadinessCheckStatus;
  detail: string;
  severity?: TaxAuditReadinessSeverity;
  action?: {
    target: TaxAuditReadinessActionTarget;
    clauseKey?: string;
  };
};

export type TaxAuditReadinessSection = {
  title: string;
  checks: TaxAuditReadinessCheck[];
};

export type TaxAuditReadinessAttentionItem = {
  id: string;
  area: string;
  item: string;
  severity: TaxAuditReadinessSeverity;
  status: string;
  suggestedAction: string;
  action?: {
    target: TaxAuditReadinessActionTarget;
    clauseKey?: string;
  };
};

export type TaxAuditReportReadiness = {
  level: TaxAuditReadinessLevel;
  label: 'Not Ready' | 'Needs Review' | 'Ready for Report Preparation';
  reason: string;
  criticalCount: number;
  reviewRequiredCount: number;
  advisoryCount: number;
  sections: TaxAuditReadinessSection[];
  attentionItems: TaxAuditReadinessAttentionItem[];
};

type AcceptanceChecklistStats = {
  exists: boolean;
  total: number;
  completed: number;
  completionPercentage: number;
  negativeResponses: number;
};

type BuildTaxAuditReportReadinessInput = {
  setup: TaxAuditSetup;
  clientName?: string | null;
  acceptanceCheck: TaxAuditAcceptanceCheck | null;
  complianceTracker: TaxAuditComplianceTracker;
  reviewRows: TaxAuditReviewSummaryRow[];
  reviewCounts: TaxAuditReviewSummaryCounts;
};

const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

const toBool = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const completionLabel = (completed: number, total: number) =>
  total > 0 ? `${completed} of ${total} completed` : 'No checklist responses available';

const workflowStatusComplete = (value: TaxAuditComplianceWorkflowStatus) =>
  value === 'completed' || value === 'not_applicable';

const complianceStatusLabel = (value: TaxAuditComplianceWorkflowStatus) => {
  if (value === 'completed') return 'Completed';
  if (value === 'not_applicable') return 'Not applicable';
  return 'Pending';
};

const formatStatus = (value: string) =>
  value
    .split('_')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(' ');

const checkStatusForBoolean = (complete: boolean): TaxAuditReadinessCheckStatus =>
  complete ? 'complete' : 'missing';

const getAcceptanceChecklistStats = (acceptanceCheck: TaxAuditAcceptanceCheck | null): AcceptanceChecklistStats => {
  if (!acceptanceCheck?.checklist_json) {
    return { exists: false, total: 0, completed: 0, completionPercentage: 0, negativeResponses: 0 };
  }

  const checklist = parseJson<{ sections?: Array<{ items?: Array<{ response?: TaxAuditChecklistResponse }> }> }>(
    acceptanceCheck.checklist_json,
    {}
  );
  const items = (checklist.sections || []).flatMap((section) => (Array.isArray(section.items) ? section.items : []));
  const completed = items.filter((item) => item.response === 'yes' || item.response === 'no' || item.response === 'na').length;
  const negativeResponses = items.filter((item) => item.response === 'no').length;

  return {
    exists: true,
    total: items.length,
    completed,
    completionPercentage: items.length > 0 ? Math.round((completed / items.length) * 100) : 0,
    negativeResponses,
  };
};

const addAttentionForCheck = (
  items: TaxAuditReadinessAttentionItem[],
  sectionTitle: string,
  check: TaxAuditReadinessCheck,
  index: number
) => {
  if (check.status === 'complete') return;

  items.push({
    id: `${sectionTitle}-${index}-${check.label}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    area: sectionTitle,
    item: check.label,
    severity: check.severity || (check.status === 'missing' ? 'critical' : 'review_required'),
    status: check.detail,
    suggestedAction:
      check.status === 'missing'
        ? 'Complete this item before report preparation.'
        : 'Review and resolve this item or document the auditor conclusion.',
    action: check.action,
  });
};

export const buildTaxAuditReportReadiness = ({
  setup,
  clientName,
  acceptanceCheck,
  complianceTracker,
  reviewRows,
  reviewCounts,
}: BuildTaxAuditReportReadinessInput): TaxAuditReportReadiness => {
  const attentionItems: TaxAuditReadinessAttentionItem[] = [];
  const setupJson = parseJson<Record<string, unknown>>(setup.setup_json, {});
  const applicabilityInputs =
    setupJson.applicabilityInputs && typeof setupJson.applicabilityInputs === 'object'
      ? (setupJson.applicabilityInputs as Record<string, unknown>)
      : {};
  const auditProgramme = normalizeTaxAuditProgramme(setupJson.auditProgramme);
  const auditProgrammeStats = summarizeTaxAuditProgramme(auditProgramme);
  const disclaimerAcknowledgement = normalizeTaxAuditDisclaimerAcknowledgement(setupJson.disclaimerAcknowledgement);
  const applicability = calculateApplicability({
    ...setup,
    ...applicabilityInputs,
  });
  const acceptanceStats = getAcceptanceChecklistStats(acceptanceCheck);
  const hasBooksAuditedResponse = setup.books_audited_under_other_law !== null && setup.books_audited_under_other_law !== undefined;
  const setupChecks: TaxAuditReadinessCheck[] = [
    {
      label: 'Assessment year',
      status: checkStatusForBoolean(!isBlank(setup.assessment_year)),
      detail: setup.assessment_year || 'Assessment year is pending',
      severity: 'critical',
      action: { target: 'setup' },
    },
    {
      label: 'Previous year',
      status: checkStatusForBoolean(!isBlank(setup.previous_year_from) && !isBlank(setup.previous_year_to)),
      detail:
        !isBlank(setup.previous_year_from) && !isBlank(setup.previous_year_to)
          ? `${setup.previous_year_from} to ${setup.previous_year_to}`
          : 'Previous year dates are pending',
      severity: 'critical',
      action: { target: 'setup' },
    },
    {
      label: 'Report form type',
      status: checkStatusForBoolean(!isBlank(setup.form_type)),
      detail: setup.form_type ? `Form ${setup.form_type} selected` : 'Report form type is pending',
      severity: 'critical',
      action: { target: 'setup' },
    },
    {
      label: 'Books audited under other law',
      status: hasBooksAuditedResponse ? 'complete' : 'missing',
      detail: hasBooksAuditedResponse ? (toBool(setup.books_audited_under_other_law) ? 'Yes' : 'No') : 'Response pending',
      severity: 'review_required',
      action: { target: 'setup' },
    },
    {
      label: 'Assessee details',
      status: checkStatusForBoolean(!isBlank(clientName || setup.assessee_name) && !isBlank(setup.pan) && !isBlank(setup.address)),
      detail:
        !isBlank(clientName || setup.assessee_name) && !isBlank(setup.pan) && !isBlank(setup.address)
          ? 'Name, PAN and address are available'
          : 'Name, PAN or address is pending',
      severity: 'review_required',
      action: { target: 'setup' },
    },
  ];

  const applicabilityChecks: TaxAuditReadinessCheck[] = [
    {
      label: 'Applicability result',
      status: checkStatusForBoolean(!isBlank(setup.applicability_result) && setup.applicability_result !== 'Not assessed'),
      detail: setup.applicability_result || 'Applicability is not assessed',
      severity: 'critical',
      action: { target: 'setup' },
    },
    {
      label: 'Applicability reason',
      status: checkStatusForBoolean(!isBlank(setup.applicability_reason)),
      detail: setup.applicability_reason || 'Applicability reason is pending',
      severity: 'review_required',
      action: { target: 'setup' },
    },
    {
      label: 'Suggested form type',
      status: applicability.suggestedFormType ? 'complete' : 'needs_review',
      detail: applicability.suggestedFormType ? `Suggested Form ${applicability.suggestedFormType}` : 'Suggested form type is not available',
      severity: 'advisory',
      action: { target: 'setup' },
    },
    {
      label: 'Saved form type agrees with suggested form',
      status:
        applicability.suggestedFormType && setup.form_type && applicability.suggestedFormType !== setup.form_type
          ? 'needs_review'
          : 'complete',
      detail:
        applicability.suggestedFormType && setup.form_type && applicability.suggestedFormType !== setup.form_type
          ? `Saved Form ${setup.form_type}; suggested Form ${applicability.suggestedFormType}`
          : 'No form type mismatch noted',
      severity: 'review_required',
      action: { target: 'setup' },
    },
  ];

  const acceptanceChecks: TaxAuditReadinessCheck[] = [
    {
      label: 'Acceptance checklist',
      status: acceptanceStats.exists ? 'complete' : 'missing',
      detail: acceptanceStats.exists ? 'Checklist is available' : 'Acceptance checklist is not available',
      severity: 'critical',
      action: { target: 'acceptance' },
    },
    {
      label: 'Checklist completion',
      status: acceptanceStats.total > 0 && acceptanceStats.completed === acceptanceStats.total ? 'complete' : 'needs_review',
      detail: `${completionLabel(acceptanceStats.completed, acceptanceStats.total)} (${acceptanceStats.completionPercentage}%)`,
      severity: 'review_required',
      action: { target: 'acceptance' },
    },
    {
      label: 'Overall acceptance status',
      status: acceptanceCheck?.overall_status === 'completed' ? 'complete' : 'needs_review',
      detail: acceptanceCheck?.overall_status ? formatStatus(acceptanceCheck.overall_status) : 'Overall status is pending',
      severity: acceptanceCheck?.overall_status === 'not_accepted' ? 'critical' : 'review_required',
      action: { target: 'acceptance' },
    },
    {
      label: 'Eligibility exceptions',
      status: acceptanceStats.negativeResponses > 0 || acceptanceCheck?.overall_status === 'issue_noted' ? 'needs_review' : 'complete',
      detail:
        acceptanceStats.negativeResponses > 0
          ? `${acceptanceStats.negativeResponses} checklist response(s) require review`
          : 'No checklist exception noted',
      severity: 'review_required',
      action: { target: 'acceptance' },
    },
  ];

  const filingComplete = [
    complianceTracker.assigned_by_client_on_portal,
    complianceTracker.accepted_by_ca_on_portal,
    complianceTracker.form_3ca_3cb_uploaded,
    complianceTracker.form_3cd_uploaded,
    complianceTracker.financial_statements_uploaded,
    complianceTracker.client_accepted_uploaded_report,
  ].every(workflowStatusComplete);
  const udinComplete =
    complianceTracker.udin_required === 'not_applicable' ||
    (
      workflowStatusComplete(complianceTracker.udin_required) &&
      workflowStatusComplete(complianceTracker.udin_generated) &&
      workflowStatusComplete(complianceTracker.udin_updated_on_income_tax_portal)
    );
  const complianceChecks: TaxAuditReadinessCheck[] = [
    {
      label: 'Return due date',
      status: checkStatusForBoolean(!isBlank(complianceTracker.due_date_for_return)),
      detail: complianceTracker.due_date_for_return || 'Return due date is pending',
      severity: 'review_required',
      action: { target: 'compliance' },
    },
    {
      label: 'Specified date',
      status: checkStatusForBoolean(!isBlank(complianceTracker.specified_date_for_tax_audit_report)),
      detail: complianceTracker.specified_date_for_tax_audit_report || 'Specified date is pending',
      severity: 'review_required',
      action: { target: 'compliance' },
    },
    {
      label: 'Tax audit filing workflow',
      status: filingComplete ? 'complete' : 'needs_review',
      detail: filingComplete ? 'Filing workflow is completed or not applicable' : 'One or more filing workflow steps are pending',
      severity: 'review_required',
      action: { target: 'compliance' },
    },
    {
      label: 'UDIN status',
      status: udinComplete ? 'complete' : 'needs_review',
      detail: `UDIN required: ${complianceStatusLabel(complianceTracker.udin_required)}; generated: ${complianceStatusLabel(complianceTracker.udin_generated)}`,
      severity: 'review_required',
      action: { target: 'compliance' },
    },
    {
      label: 'Portal acknowledgement',
      status:
        isBlank(complianceTracker.acknowledgement_reference) && isBlank(complianceTracker.acknowledgement_date)
          ? 'needs_review'
          : 'complete',
      detail:
        !isBlank(complianceTracker.acknowledgement_reference) || !isBlank(complianceTracker.acknowledgement_date)
          ? 'Acknowledgement details are captured'
          : 'Acknowledgement details are not linked',
      severity: 'advisory',
      action: { target: 'compliance' },
    },
  ];

  const warningRows = reviewRows.filter((row) => row.warningCount > 0);
  const needsAttentionRows = reviewRows.filter((row) => row.dataStatus === 'needs_attention');
  const notStartedRows = reviewRows.filter((row) => row.dataStatus === 'not_started');
  const notReviewedRows = reviewRows.filter((row) => row.reviewStatus !== 'reviewed' && row.reviewStatus !== 'approved' && row.reviewStatus !== 'locked');
  const evidenceExpectedKeys = new Set(FORM_3CD_CLAUSES.filter((clause) => clause.requiresEvidence).map((clause) => clause.key));
  const missingEvidenceRows = reviewRows.filter(
    (row) => evidenceExpectedKeys.has(row.clauseKey) && row.evidenceCount === 0 && row.dataStatus !== 'not_started'
  );
  const form3cdChecks: TaxAuditReadinessCheck[] = [
    {
      label: 'Total active clauses',
      status: reviewCounts.totalActiveClauses > 0 ? 'complete' : 'missing',
      detail: `${reviewCounts.totalActiveClauses} active clauses`,
      severity: 'critical',
    },
    {
      label: 'Not started clauses',
      status: reviewCounts.notStarted > Math.ceil(reviewCounts.totalActiveClauses * 0.25) ? 'missing' : reviewCounts.notStarted > 0 ? 'needs_review' : 'complete',
      detail: `${reviewCounts.notStarted} clause(s) not started`,
      severity: reviewCounts.notStarted > Math.ceil(reviewCounts.totalActiveClauses * 0.25) ? 'critical' : 'review_required',
      action: { target: 'clause', clauseKey: notStartedRows[0]?.clauseKey },
    },
    {
      label: 'Needs Attention clauses',
      status: reviewCounts.needsAttention > 0 ? 'needs_review' : 'complete',
      detail: `${reviewCounts.needsAttention} clause(s) marked Needs Attention`,
      severity: 'review_required',
      action: { target: 'clause', clauseKey: needsAttentionRows[0]?.clauseKey },
    },
    {
      label: 'Prepared / reviewed / approved',
      status: reviewCounts.prepared + reviewCounts.reviewed + reviewCounts.approved > 0 ? 'complete' : 'missing',
      detail: `${reviewCounts.prepared} prepared, ${reviewCounts.reviewed} reviewed, ${reviewCounts.approved} approved`,
      severity: 'critical',
    },
    {
      label: 'Validation warnings',
      status: warningRows.length > 0 ? 'needs_review' : 'complete',
      detail: `${warningRows.length} clause(s) with validation warnings`,
      severity: 'review_required',
      action: { target: 'clause', clauseKey: warningRows[0]?.clauseKey },
    },
    {
      label: 'Evidence / Working Reference',
      status: missingEvidenceRows.length > 0 ? 'needs_review' : 'complete',
      detail: `${reviewCounts.clausesWithEvidence} clause(s) with evidence linked`,
      severity: 'advisory',
      action: { target: 'clause', clauseKey: missingEvidenceRows[0]?.clauseKey },
    },
    {
      label: 'Qualification / Observation',
      status: reviewCounts.clausesWithQualification > 0 ? 'needs_review' : 'complete',
      detail: `${reviewCounts.clausesWithQualification} clause(s) with qualification or observation`,
      severity: 'review_required',
      action: { target: 'clause', clauseKey: reviewRows.find((row) => row.hasObservation)?.clauseKey },
    },
    {
      label: 'Internal Audit Remarks',
      status: reviewCounts.clausesWithInternalRemarks > 0 ? 'needs_review' : 'complete',
      detail: `${reviewCounts.clausesWithInternalRemarks} clause(s) with internal remarks`,
      severity: 'review_required',
      action: { target: 'clause', clauseKey: reviewRows.find((row) => row.hasInternalRemarks)?.clauseKey },
    },
  ];
  const auditProgrammeChecks: TaxAuditReadinessCheck[] = [
    {
      label: 'Audit Programme responses',
      status: auditProgrammeStats.hasResponses ? 'complete' : 'needs_review',
      detail: auditProgrammeStats.hasResponses
        ? `${auditProgrammeStats.completionPercent}% of checklist items completed, reviewed or not applicable`
        : 'Audit Programme checklist has no responses yet',
      severity: 'advisory',
      action: { target: 'programme' },
    },
    {
      label: 'Required Audit Programme items',
      status: auditProgrammeStats.requiredIncomplete > 0 ? 'needs_review' : 'complete',
      detail: `${auditProgrammeStats.requiredIncomplete} required checklist item(s) remain incomplete`,
      severity: 'review_required',
      action: { target: 'programme' },
    },
  ];
  const professionalResponsibilityChecks: TaxAuditReadinessCheck[] = [
    {
      label: 'Professional Responsibility acknowledgement',
      status: disclaimerAcknowledgement.accepted ? 'complete' : 'needs_review',
      detail: disclaimerAcknowledgement.accepted
        ? `Acknowledged${disclaimerAcknowledgement.accepted_by ? ` by ${disclaimerAcknowledgement.accepted_by}` : ''}`
        : 'Professional Responsibility and Disclaimer acknowledgement is pending',
      severity: 'review_required',
      action: { target: 'overview' },
    },
  ];

  const sections: TaxAuditReadinessSection[] = [
    { title: 'Engagement Setup', checks: setupChecks },
    { title: 'Applicability', checks: applicabilityChecks },
    { title: 'Professional Responsibility', checks: professionalResponsibilityChecks },
    { title: 'Acceptance and Eligibility', checks: acceptanceChecks },
    { title: 'Compliance Tracker', checks: complianceChecks },
    { title: 'Audit Programme', checks: auditProgrammeChecks },
    { title: 'Form 3CD Clause Completion', checks: form3cdChecks },
  ];

  sections.forEach((section) => {
    section.checks.forEach((check, index) => addAttentionForCheck(attentionItems, section.title, check, index));
  });

  warningRows.forEach((row) => {
    attentionItems.push({
      id: `warning-${row.clauseKey}`,
      area: `Clause ${row.clauseNo}`,
      item: 'Validation warnings',
      severity: 'review_required',
      status: `${row.warningCount} warning(s) unresolved`,
      suggestedAction: 'Review the warning and clear it or document the auditor conclusion.',
      action: { target: 'clause', clauseKey: row.clauseKey },
    });
  });

  needsAttentionRows.forEach((row) => {
    attentionItems.push({
      id: `attention-${row.clauseKey}`,
      area: `Clause ${row.clauseNo}`,
      item: row.clauseTitle,
      severity: 'review_required',
      status: 'Marked Needs Attention',
      suggestedAction: 'Complete the clause particulars or resolve the attention item.',
      action: { target: 'clause', clauseKey: row.clauseKey },
    });
  });

  reviewRows.filter((row) => row.hasObservation).forEach((row) => {
    attentionItems.push({
      id: `observation-${row.clauseKey}`,
      area: `Clause ${row.clauseNo}`,
      item: 'Qualification / Observation',
      severity: 'review_required',
      status: 'Report wording is present or required',
      suggestedAction: 'Review the qualification or observation wording before report preparation.',
      action: { target: 'clause', clauseKey: row.clauseKey },
    });
  });

  reviewRows.filter((row) => row.hasInternalRemarks).forEach((row) => {
    attentionItems.push({
      id: `internal-remarks-${row.clauseKey}`,
      area: `Clause ${row.clauseNo}`,
      item: 'Internal Audit Remarks',
      severity: 'review_required',
      status: 'Internal remarks are present',
      suggestedAction: 'Review internal remarks and decide whether report wording or further work is needed.',
      action: { target: 'clause', clauseKey: row.clauseKey },
    });
  });

  missingEvidenceRows.forEach((row) => {
    attentionItems.push({
      id: `evidence-${row.clauseKey}`,
      area: `Clause ${row.clauseNo}`,
      item: 'Evidence / Working Reference',
      severity: 'advisory',
      status: 'Evidence not linked',
      suggestedAction: 'Link evidence or document the working reference used for this clause.',
      action: { target: 'clause', clauseKey: row.clauseKey },
    });
  });

  notStartedRows.forEach((row) => {
    attentionItems.push({
      id: `not-started-${row.clauseKey}`,
      area: `Clause ${row.clauseNo}`,
      item: row.clauseTitle,
      severity: 'advisory',
      status: 'Not started',
      suggestedAction: 'Open the clause and record the applicable particulars or conclusion.',
      action: { target: 'clause', clauseKey: row.clauseKey },
    });
  });

  notReviewedRows.forEach((row) => {
    attentionItems.push({
      id: `not-reviewed-${row.clauseKey}`,
      area: `Clause ${row.clauseNo}`,
      item: row.clauseTitle,
      severity: 'advisory',
      status: 'Not reviewed',
      suggestedAction: 'Move the clause through prepared and reviewed status when audit work is complete.',
      action: { target: 'clause', clauseKey: row.clauseKey },
    });
  });

  const criticalCount = attentionItems.filter((item) => item.severity === 'critical').length;
  const reviewRequiredCount = attentionItems.filter((item) => item.severity === 'review_required').length;
  const advisoryCount = attentionItems.filter((item) => item.severity === 'advisory').length;
  const level: TaxAuditReadinessLevel =
    criticalCount > 0 ? 'not_ready' : reviewRequiredCount > 0 ? 'needs_review' : 'ready';
  const label =
    level === 'not_ready'
      ? 'Not Ready'
      : level === 'needs_review'
        ? 'Needs Review'
        : 'Ready for Report Preparation';
  const reason =
    level === 'not_ready'
      ? 'Critical setup, acceptance, clause, or attention items remain open.'
      : level === 'needs_review'
        ? 'Core work can move forward, but auditor review items remain visible.'
        : 'Base setup, acceptance, compliance, and clause review checks are complete.';

  return {
    level,
    label,
    reason,
    criticalCount,
    reviewRequiredCount,
    advisoryCount,
    sections,
    attentionItems,
  };
};
