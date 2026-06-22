import { describe, expect, it } from 'vitest';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { TAX_AUDIT_DISCLAIMER_VERSION } from '@/data/taxAuditDisclaimers';
import { TAX_AUDIT_PROGRAMME_CHECKLIST } from '@/data/taxAuditProgrammeChecklist';
import { DEFAULT_TAX_AUDIT_COMPLIANCE_TRACKER } from '@/lib/taxAuditComplianceTracker';
import { buildTaxAuditReportReadiness } from '@/lib/taxAuditReportReadiness';
import { buildTaxAuditReviewSummaryCounts, buildTaxAuditReviewSummaryRows, TaxAuditReviewSummaryRow } from '@/lib/taxAuditReviewSummary';
import { TaxAuditAcceptanceCheck, TaxAuditComplianceTracker, TaxAuditSetup } from '@/types/taxAudit';

const completedAuditProgramme = () => ({
  items: Object.fromEntries(
    TAX_AUDIT_PROGRAMME_CHECKLIST.map((item) => [
      item.id,
      {
        status: 'Reviewed',
        response: 'Yes',
        assigned_to: '',
        due_date: '',
        working_reference: 'WP',
        remarks: '',
        reviewed_by: 'Reviewer',
        reviewed_at: '2025-09-30T00:00:00.000Z',
      },
    ])
  ),
  last_updated_at: '2025-09-30T00:00:00.000Z',
});

const baseSetup: TaxAuditSetup = {
  engagement_id: 'engagement-1',
  statutory_version: 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
  form_type: '3CB',
  assessment_year: '2025-26',
  previous_year_from: '2024-04-01',
  previous_year_to: '2025-03-31',
  assessee_name: 'Sample Assessee',
  pan: 'ABCDE1234F',
  address: 'Sample address',
  business_or_profession: 'business',
  books_audited_under_other_law: false,
  turnover: 20_000_000,
  cash_receipts_percent: 10,
  cash_payments_percent: 10,
  applicability_result: 'Applicable',
  applicability_reason: 'Business turnover exceeds the applicable threshold.',
  setup_json: JSON.stringify({
    applicabilityInputs: {
      has_business_activity: true,
      has_professional_activity: false,
      business_turnover: 20_000_000,
    },
    auditProgramme: completedAuditProgramme(),
    disclaimerAcknowledgement: {
      accepted: true,
      accepted_by: 'Reviewer',
      accepted_at: '2025-09-30T00:00:00.000Z',
      version: TAX_AUDIT_DISCLAIMER_VERSION,
    },
  }),
  review_status: 'draft',
};

const completedAcceptance: TaxAuditAcceptanceCheck = {
  tax_audit_id: 'tax-audit-1',
  checklist_json: JSON.stringify({
    version: 1,
    sections: [
      {
        id: 'eligibility',
        title: 'Eligibility',
        items: [
          { id: 'valid_cop', label: 'Valid COP', response: 'yes', remarks: '' },
          { id: 'appointment', label: 'Appointment accepted', response: 'yes', remarks: '' },
        ],
      },
    ],
  }),
  overall_status: 'completed',
};

const completedCompliance: TaxAuditComplianceTracker = {
  ...DEFAULT_TAX_AUDIT_COMPLIANCE_TRACKER,
  due_date_for_return: '2025-10-31',
  specified_date_for_tax_audit_report: '2025-09-30',
  assigned_by_client_on_portal: 'completed',
  accepted_by_ca_on_portal: 'completed',
  form_3ca_3cb_uploaded: 'completed',
  form_3cd_uploaded: 'completed',
  financial_statements_uploaded: 'completed',
  client_accepted_uploaded_report: 'completed',
  acknowledgement_reference: 'ACK-1',
  acknowledgement_date: '2025-09-30',
  udin_required: 'completed',
  udin_generated: 'completed',
  udin_number: '123456789012345678',
  udin_generated_date: '2025-09-30',
  udin_updated_on_income_tax_portal: 'completed',
};

const reviewedRows = (): TaxAuditReviewSummaryRow[] =>
  FORM_3CD_CLAUSES.map((clause) => ({
    clauseKey: clause.key,
    clauseNo: clause.clauseNo,
    clauseTitle: clause.title,
    dataStatus: 'reviewed',
    reviewStatus: 'reviewed',
    warningCount: 0,
    evidenceCount: clause.requiresEvidence ? 1 : 0,
    hasAdditionalParticulars: true,
    hasInternalRemarks: false,
    hasQualification: false,
    hasObservation: false,
  }));

describe('buildTaxAuditReportReadiness', () => {
  it('marks a blank engagement as Not Ready without crashing', () => {
    const rows = buildTaxAuditReviewSummaryRows(new Map(), []);
    const readiness = buildTaxAuditReportReadiness({
      setup: {
        engagement_id: 'engagement-1',
        statutory_version: 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
        form_type: '' as TaxAuditSetup['form_type'],
        review_status: 'draft',
      },
      acceptanceCheck: null,
      complianceTracker: DEFAULT_TAX_AUDIT_COMPLIANCE_TRACKER,
      reviewRows: rows,
      reviewCounts: buildTaxAuditReviewSummaryCounts(rows),
    });

    expect(readiness.level).toBe('not_ready');
    expect(readiness.criticalCount).toBeGreaterThan(0);
  });

  it('uses the active Form 3CD clause source and excludes omitted or inactive clauses', () => {
    const rows = buildTaxAuditReviewSummaryRows(new Map(), []);
    const clauseKeys = rows.map((row) => row.clauseKey);

    expect(clauseKeys).not.toContain('clause_28');
    expect(clauseKeys).not.toContain('clause_29');
    expect(clauseKeys).not.toContain('clause_36');
    expect(clauseKeys).toContain('clause_36a');
    expect(clauseKeys).toContain('clause_36b');
    expect(clauseKeys).toContain('clause_44');
    expect(rows).toHaveLength(FORM_3CD_CLAUSES.length);
  });

  it('treats missing evidence link input as zero linked evidence', () => {
    const rows = buildTaxAuditReviewSummaryRows(new Map(), undefined as never);

    expect(rows).toHaveLength(FORM_3CD_CLAUSES.length);
    expect(rows.every((row) => row.evidenceCount === 0)).toBe(true);
  });

  it('classifies unresolved validation warnings as Needs Review instead of Not Ready when base work is complete', () => {
    const rows = reviewedRows();
    rows[0] = {
      ...rows[0],
      dataStatus: 'needs_attention',
      warningCount: 1,
    };
    const readiness = buildTaxAuditReportReadiness({
      setup: baseSetup,
      acceptanceCheck: completedAcceptance,
      complianceTracker: completedCompliance,
      reviewRows: rows,
      reviewCounts: buildTaxAuditReviewSummaryCounts(rows),
    });

    expect(readiness.level).toBe('needs_review');
    expect(readiness.criticalCount).toBe(0);
    expect(readiness.reviewRequiredCount).toBeGreaterThan(0);
  });

  it('allows Ready for Report Preparation when base checks are complete and only advisory evidence context remains', () => {
    const rows = reviewedRows();
    const readiness = buildTaxAuditReportReadiness({
      setup: baseSetup,
      acceptanceCheck: completedAcceptance,
      complianceTracker: completedCompliance,
      reviewRows: rows,
      reviewCounts: buildTaxAuditReviewSummaryCounts(rows),
    });

    expect(readiness.level).toBe('ready');
    expect(readiness.label).toBe('Ready for Report Preparation');
    expect(readiness.criticalCount).toBe(0);
    expect(readiness.reviewRequiredCount).toBe(0);
  });

  it('shows Audit Programme guidance as advisory when no programme responses exist', () => {
    const rows = reviewedRows();
    const setupWithoutProgramme = {
      ...baseSetup,
      setup_json: JSON.stringify({
        applicabilityInputs: {
          has_business_activity: true,
          has_professional_activity: false,
          business_turnover: 20_000_000,
        },
        disclaimerAcknowledgement: {
          accepted: true,
          accepted_by: 'Reviewer',
          accepted_at: '2025-09-30T00:00:00.000Z',
          version: TAX_AUDIT_DISCLAIMER_VERSION,
        },
      }),
    };
    const readiness = buildTaxAuditReportReadiness({
      setup: setupWithoutProgramme,
      acceptanceCheck: completedAcceptance,
      complianceTracker: completedCompliance,
      reviewRows: rows,
      reviewCounts: buildTaxAuditReviewSummaryCounts(rows),
    });

    expect(readiness.attentionItems.some((item) => item.area === 'Audit Programme' && item.severity === 'advisory')).toBe(true);
    expect(readiness.criticalCount).toBe(0);
  });

  it('shows Review Required when required Audit Programme items are incomplete', () => {
    const rows = reviewedRows();
    const setupWithPartialProgramme = {
      ...baseSetup,
      setup_json: JSON.stringify({
        applicabilityInputs: {
          has_business_activity: true,
          has_professional_activity: false,
          business_turnover: 20_000_000,
        },
        auditProgramme: {
          items: {
            [TAX_AUDIT_PROGRAMME_CHECKLIST[0].id]: {
              status: 'Completed',
              response: 'Yes',
              assigned_to: '',
              due_date: '',
              working_reference: 'WP',
              remarks: '',
              reviewed_by: '',
              reviewed_at: '',
            },
          },
          last_updated_at: '2025-09-30T00:00:00.000Z',
        },
        disclaimerAcknowledgement: {
          accepted: true,
          accepted_by: 'Reviewer',
          accepted_at: '2025-09-30T00:00:00.000Z',
          version: TAX_AUDIT_DISCLAIMER_VERSION,
        },
      }),
    };
    const readiness = buildTaxAuditReportReadiness({
      setup: setupWithPartialProgramme,
      acceptanceCheck: completedAcceptance,
      complianceTracker: completedCompliance,
      reviewRows: rows,
      reviewCounts: buildTaxAuditReviewSummaryCounts(rows),
    });

    expect(readiness.attentionItems.some((item) => item.area === 'Audit Programme' && item.severity === 'review_required')).toBe(true);
    expect(readiness.criticalCount).toBe(0);
  });

  it('shows Review Required when Professional Responsibility acknowledgement is pending', () => {
    const rows = reviewedRows();
    const setupWithoutAcknowledgement = {
      ...baseSetup,
      setup_json: JSON.stringify({
        applicabilityInputs: {
          has_business_activity: true,
          has_professional_activity: false,
          business_turnover: 20_000_000,
        },
        auditProgramme: completedAuditProgramme(),
      }),
    };
    const readiness = buildTaxAuditReportReadiness({
      setup: setupWithoutAcknowledgement,
      acceptanceCheck: completedAcceptance,
      complianceTracker: completedCompliance,
      reviewRows: rows,
      reviewCounts: buildTaxAuditReviewSummaryCounts(rows),
    });

    expect(readiness.level).toBe('needs_review');
    expect(readiness.criticalCount).toBe(0);
    expect(
      readiness.attentionItems.some(
        (item) => item.area === 'Professional Responsibility' && item.severity === 'review_required'
      )
    ).toBe(true);
  });

  it('removes Professional Responsibility readiness item after acknowledgement is accepted', () => {
    const rows = reviewedRows();
    const readiness = buildTaxAuditReportReadiness({
      setup: baseSetup,
      acceptanceCheck: completedAcceptance,
      complianceTracker: completedCompliance,
      reviewRows: rows,
      reviewCounts: buildTaxAuditReviewSummaryCounts(rows),
    });

    expect(
      readiness.attentionItems.some((item) => item.area === 'Professional Responsibility')
    ).toBe(false);
  });
});
