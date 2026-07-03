import { TAX_AUDIT_DISCLAIMER_VERSION } from '@/data/taxAuditDisclaimers';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { TAX_AUDIT_PROGRAMME_CHECKLIST } from '@/data/taxAuditProgrammeChecklist';
import { calculateApplicability } from '@/lib/taxAuditApplicability';
import { normalizeTaxAuditDisclaimerAcknowledgement } from '@/lib/taxAuditDisclaimer';
import { normalizeTaxAuditProgramme, summarizeTaxAuditProgramme } from '@/lib/taxAuditProgramme';
import { TaxAuditReportReadiness } from '@/lib/taxAuditReportReadiness';
import { TaxAuditReviewSummaryCounts, TaxAuditReviewSummaryRow } from '@/lib/taxAuditReviewSummary';
import {
  TaxAuditAcceptanceCheck,
  TaxAuditChecklistResponse,
  TaxAuditClauseEvidence,
  TaxAuditClauseResponse,
  TaxAuditComplianceTracker,
  TaxAuditReviewStatus,
  TaxAuditSetup,
} from '@/types/taxAudit';

export type TaxAuditReportPackClauseSummary = {
  clauseKey: string;
  clauseNo: string;
  title: string;
  status: string;
  reviewStatus: TaxAuditReviewStatus;
  warningCount: number;
  evidenceCount: number;
  workingReference: string;
  hasAdditionalReportParticulars: boolean;
  hasInternalAuditRemarks: boolean;
  hasQualificationOrObservation: boolean;
  structuredSummary: string[];
  warnings: string[];
  additionalReportParticulars: string;
  internalAuditRemarks: string;
  qualificationOrObservation: string;
};

export type TaxAuditReportPack = {
  generatedAt: string;
  engagementSummary: {
    assessmentYear: string;
    previousYear: string;
    formType: string;
    booksAuditedUnderOtherLaw: string;
    assesseeName: string;
    pan: string;
    address: string;
  };
  professionalResponsibility: {
    acknowledged: boolean;
    acknowledgedBy: string;
    acknowledgedAt: string;
    version: typeof TAX_AUDIT_DISCLAIMER_VERSION;
  };
  applicabilityAndFormSelection: {
    result: string;
    thresholdApplied: string;
    reason: string;
    suggestedFormType: string;
    selectedFormType: string;
    warnings: string[];
  };
  acceptanceAndEligibility: {
    overallStatus: string;
    totalItems: number;
    completedItems: number;
    pendingItems: number;
    completionSummary: string;
    reviewedBy: string;
    approvedBy: string;
  };
  complianceTracker: {
    specifiedDate: string;
    filingStatus: string;
    udinStatus: string;
    acknowledgementDetails: string;
    pendingActions: string[];
  };
  auditProgrammeSummary: {
    total: number;
    completed: number;
    reviewed: number;
    notApplicable: number;
    pendingOrInProgress: number;
    requiredIncomplete: number;
    keyOpenItems: string[];
  };
  reportReadiness: {
    label: string;
    reason: string;
    criticalCount: number;
    reviewRequiredCount: number;
    advisoryCount: number;
    topAttentionItems: Array<{
      area: string;
      item: string;
      severity: string;
      status: string;
    }>;
  };
  clauseSummaries: TaxAuditReportPackClauseSummary[];
  qualificationsOrObservations: TaxAuditReportPackClauseSummary[];
  internalRemarks: TaxAuditReportPackClauseSummary[];
  evidenceAndWorkingReferences: TaxAuditReportPackClauseSummary[];
};

export type BuildTaxAuditReportPackInput = {
  setup: TaxAuditSetup;
  clientName?: string | null;
  acceptanceCheck: TaxAuditAcceptanceCheck | null;
  complianceTracker: TaxAuditComplianceTracker;
  clausesByKey: Map<string, TaxAuditClauseResponse>;
  evidenceLinks?: TaxAuditClauseEvidence[];
  reviewRows: TaxAuditReviewSummaryRow[];
  reviewCounts: TaxAuditReviewSummaryCounts;
  readiness: TaxAuditReportReadiness;
  generatedAt?: string;
};

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

const yesNo = (value: unknown) =>
  value === true || value === 1 || value === '1' || value === 'true' ? 'Yes' : 'No';

const formatStatus = (value: string | null | undefined) =>
  value
    ? value
        .split('_')
        .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
        .join(' ')
    : 'Not available';

const stripHtml = (value: string | null | undefined) =>
  (value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const compact = (value: string | null | undefined, fallback = 'Not available') => {
  const normalized = (value || '').trim();
  return normalized || fallback;
};

const structuredValueHasContent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.some((item) => structuredValueHasContent(item));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => structuredValueHasContent(item));
  }
  return false;
};

const getStructuredSummary = (clause?: TaxAuditClauseResponse) => {
  if (!clause) return [] as string[];
  const response = parseJson<Record<string, unknown>>(clause.response_json, {});
  const structured = isPlainObject(response.structured) ? response.structured : {};

  return Object.entries(structured)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        const usefulRows = value.filter((row) => structuredValueHasContent(row)).length;
        return usefulRows > 0 ? `${key.replace(/_/g, ' ')}: ${usefulRows} row(s)` : '';
      }
      return structuredValueHasContent(value) ? `${key.replace(/_/g, ' ')}: captured` : '';
    })
    .filter(Boolean);
};

const getAcceptanceStats = (acceptanceCheck: TaxAuditAcceptanceCheck | null) => {
  const checklist = parseJson<{ sections?: Array<{ items?: Array<{ response?: TaxAuditChecklistResponse }> }> }>(
    acceptanceCheck?.checklist_json,
    {}
  );
  const items = (checklist.sections || []).flatMap((section) => (Array.isArray(section.items) ? section.items : []));
  const completed = items.filter((item) => item.response === 'yes' || item.response === 'no' || item.response === 'na').length;

  return {
    total: items.length,
    completed,
    pending: Math.max(items.length - completed, 0),
  };
};

const getFilingStatus = (tracker: TaxAuditComplianceTracker) => {
  const filingSteps = [
    tracker.assigned_by_client_on_portal,
    tracker.accepted_by_ca_on_portal,
    tracker.form_3ca_3cb_uploaded,
    tracker.form_3cd_uploaded,
    tracker.financial_statements_uploaded,
    tracker.client_accepted_uploaded_report,
  ];
  const completed = filingSteps.filter((step) => step === 'completed' || step === 'not_applicable').length;
  return `${completed} of ${filingSteps.length} filing step(s) completed or not applicable`;
};

const getPendingComplianceActions = (tracker: TaxAuditComplianceTracker) => {
  const actions: string[] = [];
  if (isBlank(tracker.due_date_for_return)) actions.push('Return due date pending');
  if (isBlank(tracker.specified_date_for_tax_audit_report)) actions.push('Specified date pending');
  if (tracker.assigned_by_client_on_portal === 'pending') actions.push('Client assignment on portal pending');
  if (tracker.accepted_by_ca_on_portal === 'pending') actions.push('Acceptance by CA on portal pending');
  if (tracker.form_3ca_3cb_uploaded === 'pending') actions.push('Form 3CA/3CB upload pending');
  if (tracker.form_3cd_uploaded === 'pending') actions.push('Form 3CD upload pending');
  if (tracker.financial_statements_uploaded === 'pending') actions.push('Financial statements upload pending');
  if (tracker.client_accepted_uploaded_report === 'pending') actions.push('Client acceptance of uploaded report pending');
  if (tracker.udin_required === 'completed' && tracker.udin_generated === 'pending') actions.push('UDIN generation pending');
  if (tracker.udin_generated === 'completed' && tracker.udin_updated_on_income_tax_portal === 'pending') {
    actions.push('UDIN update on income tax portal pending');
  }
  return actions;
};

const getEvidenceCountByClauseId = (evidenceLinks: TaxAuditClauseEvidence[] = []) =>
  evidenceLinks.reduce<Map<string, number>>((result, link) => {
    result.set(link.clause_response_id, (result.get(link.clause_response_id) || 0) + 1);
    return result;
  }, new Map());

export const buildTaxAuditReportPack = ({
  setup,
  clientName,
  acceptanceCheck,
  complianceTracker,
  clausesByKey,
  evidenceLinks = [],
  reviewRows,
  reviewCounts,
  readiness,
  generatedAt = new Date().toISOString(),
}: BuildTaxAuditReportPackInput): TaxAuditReportPack => {
  const setupJson = parseJson<Record<string, unknown>>(setup.setup_json, {});
  const disclaimer = normalizeTaxAuditDisclaimerAcknowledgement(setupJson.disclaimerAcknowledgement);
  const auditProgramme = normalizeTaxAuditProgramme(setupJson.auditProgramme);
  const auditProgrammeStats = summarizeTaxAuditProgramme(auditProgramme);
  const applicabilityInputs = isPlainObject(setupJson.applicabilityInputs) ? setupJson.applicabilityInputs : {};
  const applicability = calculateApplicability({ ...setup, ...applicabilityInputs });
  const acceptanceStats = getAcceptanceStats(acceptanceCheck);
  const evidenceCountByClauseId = getEvidenceCountByClauseId(evidenceLinks);
  const rowByClauseKey = new Map(reviewRows.map((row) => [row.clauseKey, row]));

  const checklistTitleById = new Map(TAX_AUDIT_PROGRAMME_CHECKLIST.map((item) => [item.id, item.title]));
  const keyOpenItems = Object.entries(auditProgramme.items)
    .filter(([, state]) => state.status === 'Not started' || state.status === 'In progress' || state.response === 'No')
    .slice(0, 8)
    .map(([itemId, state]) => `${checklistTitleById.get(itemId) || itemId.replace(/_/g, ' ')}: ${state.status}, ${state.response}`);

  const clauseSummaries = FORM_3CD_CLAUSES.map<TaxAuditReportPackClauseSummary>((definition) => {
    const clause = clausesByKey.get(definition.key);
    const row = rowByClauseKey.get(definition.key);
    const warnings = clause ? parseJson<string[]>(clause.validation_messages_json, []) : [];
    const evidenceCount = clause ? evidenceCountByClauseId.get(clause.id) || row?.evidenceCount || 0 : row?.evidenceCount || 0;
    const additionalReportParticulars = stripHtml(clause?.response_html);
    const internalAuditRemarks = stripHtml(clause?.auditor_remarks_html);
    const qualificationOrObservation = stripHtml(clause?.qualification_text_html);

    return {
      clauseKey: definition.key,
      clauseNo: definition.clauseNo,
      title: definition.title,
      status: formatStatus(row?.dataStatus || clause?.prefill_status || 'not_started'),
      reviewStatus: row?.reviewStatus || clause?.review_status || 'draft',
      warningCount: row?.warningCount || warnings.length,
      evidenceCount,
      workingReference: clause?.workpaper_ref || '',
      hasAdditionalReportParticulars: row?.hasAdditionalParticulars || Boolean(additionalReportParticulars),
      hasInternalAuditRemarks: row?.hasInternalRemarks || Boolean(internalAuditRemarks),
      hasQualificationOrObservation: row?.hasObservation || Boolean(qualificationOrObservation),
      structuredSummary: getStructuredSummary(clause),
      warnings,
      additionalReportParticulars,
      internalAuditRemarks,
      qualificationOrObservation,
    };
  });

  return {
    generatedAt,
    engagementSummary: {
      assessmentYear: compact(setup.assessment_year),
      previousYear:
        setup.previous_year_from && setup.previous_year_to
          ? `${setup.previous_year_from} to ${setup.previous_year_to}`
          : 'Not available',
      formType: setup.form_type ? `Form ${setup.form_type}` : 'Not selected',
      booksAuditedUnderOtherLaw: yesNo(setup.books_audited_under_other_law),
      assesseeName: compact(clientName || setup.assessee_name),
      pan: compact(setup.pan),
      address: compact(setup.address),
    },
    professionalResponsibility: {
      acknowledged: disclaimer.accepted,
      acknowledgedBy: disclaimer.accepted_by,
      acknowledgedAt: disclaimer.accepted_at,
      version: disclaimer.version,
    },
    applicabilityAndFormSelection: {
      result: compact(setup.applicability_result, 'Not assessed'),
      thresholdApplied:
        applicability.overall.thresholdApplied ||
        applicability.overall.sectionReference ||
        'Review required',
      reason: compact(setup.applicability_reason),
      suggestedFormType: applicability.suggestedFormType ? `Form ${applicability.suggestedFormType}` : 'Not available',
      selectedFormType: setup.form_type ? `Form ${setup.form_type}` : 'Not selected',
      warnings: applicability.warnings,
    },
    acceptanceAndEligibility: {
      overallStatus: formatStatus(acceptanceCheck?.overall_status || 'not_started'),
      totalItems: acceptanceStats.total,
      completedItems: acceptanceStats.completed,
      pendingItems: acceptanceStats.pending,
      completionSummary:
        acceptanceStats.total > 0
          ? `${acceptanceStats.completed} of ${acceptanceStats.total} checklist item(s) completed`
          : 'No acceptance checklist responses available',
      reviewedBy: compact(acceptanceCheck?.reviewed_by, ''),
      approvedBy: compact(acceptanceCheck?.approved_by, ''),
    },
    complianceTracker: {
      specifiedDate: compact(complianceTracker.specified_date_for_tax_audit_report),
      filingStatus: getFilingStatus(complianceTracker),
      udinStatus: `Required: ${formatStatus(complianceTracker.udin_required)}; Generated: ${formatStatus(complianceTracker.udin_generated)}`,
      acknowledgementDetails:
        complianceTracker.acknowledgement_reference || complianceTracker.acknowledgement_date
          ? `${compact(complianceTracker.acknowledgement_reference, 'Reference not captured')} ${compact(complianceTracker.acknowledgement_date, '')}`.trim()
          : 'Not available',
      pendingActions: getPendingComplianceActions(complianceTracker),
    },
    auditProgrammeSummary: {
      total: auditProgrammeStats.total,
      completed: auditProgrammeStats.completed,
      reviewed: auditProgrammeStats.reviewed,
      notApplicable: auditProgrammeStats.notApplicable,
      pendingOrInProgress: auditProgrammeStats.notStarted + auditProgrammeStats.inProgress,
      requiredIncomplete: auditProgrammeStats.requiredIncomplete,
      keyOpenItems,
    },
    reportReadiness: {
      label: readiness.label,
      reason: readiness.reason,
      criticalCount: readiness.criticalCount,
      reviewRequiredCount: readiness.reviewRequiredCount,
      advisoryCount: readiness.advisoryCount,
      topAttentionItems: readiness.attentionItems.slice(0, 12).map((item) => ({
        area: item.area,
        item: item.item,
        severity: formatStatus(item.severity),
        status: item.status,
      })),
    },
    clauseSummaries,
    qualificationsOrObservations: clauseSummaries.filter((clause) => clause.hasQualificationOrObservation),
    internalRemarks: clauseSummaries.filter((clause) => clause.hasInternalAuditRemarks),
    evidenceAndWorkingReferences: clauseSummaries.filter(
      (clause) => clause.evidenceCount > 0 || Boolean(clause.workingReference)
    ),
  };
};

const line = (label: string, value: string | number | boolean) => `- ${label}: ${String(value)}`;

const list = (items: string[], emptyText: string) =>
  items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${emptyText}`;

export const renderTaxAuditReportPackMarkdown = (pack: TaxAuditReportPack) => {
  const sections: string[] = [];

  sections.push(`# Working Paper Report Pack\n\nGenerated for review: ${pack.generatedAt}`);
  sections.push(
    [
      '## A. Engagement Summary',
      line('Assessment year', pack.engagementSummary.assessmentYear),
      line('Previous year', pack.engagementSummary.previousYear),
      line('Form type', pack.engagementSummary.formType),
      line('Books audited under other law', pack.engagementSummary.booksAuditedUnderOtherLaw),
      line('Assessee name', pack.engagementSummary.assesseeName),
      line('PAN', pack.engagementSummary.pan),
      line('Address', pack.engagementSummary.address),
    ].join('\n')
  );
  sections.push(
    [
      '## B. Professional Responsibility',
      line('Acknowledgement', pack.professionalResponsibility.acknowledged ? 'Accepted' : 'Pending'),
      line('Acknowledged by', pack.professionalResponsibility.acknowledgedBy || 'Not available'),
      line('Acknowledged at', pack.professionalResponsibility.acknowledgedAt || 'Not available'),
      line('Disclaimer version', pack.professionalResponsibility.version),
    ].join('\n')
  );
  sections.push(
    [
      '## C. Applicability and Form Selection',
      line('Applicability result', pack.applicabilityAndFormSelection.result),
      line('Threshold applied', pack.applicabilityAndFormSelection.thresholdApplied),
      line('Reason', pack.applicabilityAndFormSelection.reason),
      line('Suggested form type', pack.applicabilityAndFormSelection.suggestedFormType),
      line('Selected form type', pack.applicabilityAndFormSelection.selectedFormType),
      'Warnings:',
      list(pack.applicabilityAndFormSelection.warnings, 'No applicability warning noted'),
    ].join('\n')
  );
  sections.push(
    [
      '## D. Acceptance and Eligibility',
      line('Overall status', pack.acceptanceAndEligibility.overallStatus),
      line('Completion summary', pack.acceptanceAndEligibility.completionSummary),
      line('Pending items', pack.acceptanceAndEligibility.pendingItems),
      line('Reviewed by', pack.acceptanceAndEligibility.reviewedBy || 'Not available'),
      line('Approved by', pack.acceptanceAndEligibility.approvedBy || 'Not available'),
    ].join('\n')
  );
  sections.push(
    [
      '## E. Compliance Tracker',
      line('Specified date', pack.complianceTracker.specifiedDate),
      line('Filing status', pack.complianceTracker.filingStatus),
      line('UDIN status', pack.complianceTracker.udinStatus),
      line('Acknowledgement details', pack.complianceTracker.acknowledgementDetails),
      'Pending compliance actions:',
      list(pack.complianceTracker.pendingActions, 'No pending compliance action noted'),
    ].join('\n')
  );
  sections.push(
    [
      '## F. Audit Programme Summary',
      line('Total checklist items', pack.auditProgrammeSummary.total),
      line('Completed', pack.auditProgrammeSummary.completed),
      line('Reviewed', pack.auditProgrammeSummary.reviewed),
      line('Not applicable', pack.auditProgrammeSummary.notApplicable),
      line('Pending / in progress', pack.auditProgrammeSummary.pendingOrInProgress),
      line('Required items incomplete', pack.auditProgrammeSummary.requiredIncomplete),
      'Key open items:',
      list(pack.auditProgrammeSummary.keyOpenItems, 'No key open Audit Programme item noted'),
    ].join('\n')
  );
  sections.push(
    [
      '## G. Report Readiness',
      line('Overall readiness status', pack.reportReadiness.label),
      line('Reason', pack.reportReadiness.reason),
      line('Critical items', pack.reportReadiness.criticalCount),
      line('Review Required', pack.reportReadiness.reviewRequiredCount),
      line('Advisory', pack.reportReadiness.advisoryCount),
      'Top attention items:',
      pack.reportReadiness.topAttentionItems.length > 0
        ? pack.reportReadiness.topAttentionItems
            .map((item) => `- ${item.area}: ${item.item} (${item.severity}) - ${item.status}`)
            .join('\n')
        : '- No attention item noted',
    ].join('\n')
  );
  sections.push(
    [
      '## H. Form 3CD Clause Summary',
      ...pack.clauseSummaries.map((clause) =>
        [
          `### Clause ${clause.clauseNo} - ${clause.title}`,
          line('Status', clause.status),
          line('Review status', formatStatus(clause.reviewStatus)),
          line('Warnings', clause.warningCount),
          line('Evidence count', clause.evidenceCount),
          line('Working Reference', clause.workingReference || 'Not available'),
          line('Additional Report Particulars', clause.hasAdditionalReportParticulars ? 'Present' : 'Not noted'),
          line('Internal Audit Remarks', clause.hasInternalAuditRemarks ? 'Present' : 'Not noted'),
          line('Qualification / Observation', clause.hasQualificationOrObservation ? 'Present' : 'Not noted'),
          `Structured data summary:\n${list(clause.structuredSummary, 'No structured data summary available')}`,
          clause.warnings.length > 0 ? `Warnings:\n${list(clause.warnings, 'No warning noted')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      ),
    ].join('\n\n')
  );
  sections.push(
    [
      '## I. Qualifications / Observations Summary',
      pack.qualificationsOrObservations.length > 0
        ? pack.qualificationsOrObservations
            .map((clause) => `- Clause ${clause.clauseNo}: ${clause.qualificationOrObservation || 'Qualification / Observation present'}`)
            .join('\n')
        : '- No qualification or observation noted',
    ].join('\n')
  );
  sections.push(
    [
      '## J. Internal Remarks Summary',
      pack.internalRemarks.length > 0
        ? pack.internalRemarks
            .map((clause) => `- Clause ${clause.clauseNo}: ${clause.internalAuditRemarks || 'Internal Audit Remarks present'}`)
            .join('\n')
        : '- No internal audit remarks noted',
    ].join('\n')
  );
  sections.push(
    [
      '## K. Evidence / Working Reference Summary',
      pack.evidenceAndWorkingReferences.length > 0
        ? pack.evidenceAndWorkingReferences
            .map((clause) => `- Clause ${clause.clauseNo}: ${clause.evidenceCount} evidence item(s); ${clause.workingReference || 'Working Reference not available'}`)
            .join('\n')
        : '- No evidence or working reference noted',
    ].join('\n')
  );

  return sections.join('\n\n');
};
