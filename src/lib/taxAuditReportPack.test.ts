import { describe, expect, it } from 'vitest';
import { DEFAULT_TAX_AUDIT_COMPLIANCE_TRACKER } from '@/lib/taxAuditComplianceTracker';
import { buildTaxAuditReportPack, renderTaxAuditReportPackMarkdown } from '@/lib/taxAuditReportPack';
import { TaxAuditReportReadiness } from '@/lib/taxAuditReportReadiness';
import { buildTaxAuditReviewSummaryCounts, buildTaxAuditReviewSummaryRows } from '@/lib/taxAuditReviewSummary';
import { TaxAuditSetup } from '@/types/taxAudit';

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
  books_audited_under_other_law: false,
  applicability_result: 'Applicable',
  applicability_reason: 'Business turnover exceeds the applicable threshold.',
  setup_json: '{}',
  review_status: 'draft',
};

const baseReadiness: TaxAuditReportReadiness = {
  level: 'needs_review',
  label: 'Needs Review',
  reason: 'Core work can move forward, but auditor review items remain visible.',
  criticalCount: 0,
  reviewRequiredCount: 1,
  advisoryCount: 2,
  sections: [],
  attentionItems: [
    {
      id: 'attention-1',
      area: 'Professional Responsibility',
      item: 'Professional Responsibility acknowledgement',
      severity: 'review_required',
      status: 'Acknowledgement pending',
      suggestedAction: 'Review and resolve this item or document the auditor conclusion.',
      action: { target: 'overview' },
    },
  ],
};

const buildBlankPack = () => {
  const rows = buildTaxAuditReviewSummaryRows(new Map(), []);
  const counts = buildTaxAuditReviewSummaryCounts(rows);

  return buildTaxAuditReportPack({
    setup: baseSetup,
    clientName: 'Sample Assessee',
    acceptanceCheck: null,
    complianceTracker: DEFAULT_TAX_AUDIT_COMPLIANCE_TRACKER,
    clausesByKey: new Map(),
    evidenceLinks: [],
    reviewRows: rows,
    reviewCounts: counts,
    readiness: baseReadiness,
    generatedAt: '2025-10-01T10:00:00.000Z',
  });
};

describe('taxAuditReportPack', () => {
  it('builds a blank engagement Working Paper Report Pack safely', () => {
    const pack = buildBlankPack();

    expect(pack.engagementSummary.assessmentYear).toBe('2025-26');
    expect(pack.professionalResponsibility.acknowledged).toBe(false);
    expect(pack.auditProgrammeSummary.total).toBeGreaterThan(0);
    expect(pack.clauseSummaries.length).toBeGreaterThan(0);
  });

  it('excludes omitted or inactive clauses and includes active clauses 36A, 36B and 44', () => {
    const pack = buildBlankPack();
    const clauseKeys = pack.clauseSummaries.map((clause) => clause.clauseKey);

    expect(clauseKeys).not.toContain('clause_28');
    expect(clauseKeys).not.toContain('clause_29');
    expect(clauseKeys).not.toContain('clause_36');
    expect(clauseKeys).toContain('clause_36a');
    expect(clauseKeys).toContain('clause_36b');
    expect(clauseKeys).toContain('clause_44');
  });

  it('renders Report Readiness status in Markdown output', () => {
    const markdown = renderTaxAuditReportPackMarkdown(buildBlankPack());

    expect(markdown).toContain('## G. Report Readiness');
    expect(markdown).toContain('- Overall readiness status: Needs Review');
    expect(markdown).toContain('Professional Responsibility acknowledgement');
  });

  it('handles missing Audit Programme and Disclaimer data without crashing', () => {
    const pack = buildBlankPack();
    const markdown = renderTaxAuditReportPackMarkdown(pack);

    expect(pack.professionalResponsibility.acknowledged).toBe(false);
    expect(pack.professionalResponsibility.version).toBe('TAX_AUDIT_DISCLAIMER_V1');
    expect(markdown).toContain('## B. Professional Responsibility');
    expect(markdown).toContain('## F. Audit Programme Summary');
  });
});
