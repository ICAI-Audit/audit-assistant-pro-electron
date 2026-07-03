import { describe, expect, it } from 'vitest';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import {
  buildTaxAuditForm3CDExport,
  TAX_AUDIT_FORM_3CD_EMPTY_PARTICULARS,
  renderTaxAuditForm3CDHtml,
} from '@/lib/taxAuditForm3CDExport';
import { TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';

const setup: TaxAuditSetup = {
  engagement_id: 'engagement-1',
  statutory_version: 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
  form_type: '3CA',
  financial_year: '2025-26',
  assessment_year: '2026-27',
  previous_year_from: '2025-04-01',
  previous_year_to: '2026-03-31',
  assessee_name: 'Sample Company Private Limited',
  pan: 'ABCDE1234F',
  address: 'Sample address',
  status: 'Company',
  books_audited_under_other_law: 1,
  review_status: 'draft',
};

const clause = (overrides: Partial<TaxAuditClauseResponse>): TaxAuditClauseResponse => ({
  id: overrides.id || 'clause-response-1',
  tax_audit_id: 'tax-audit-1',
  clause_key: overrides.clause_key || 'clause_1',
  clause_no: overrides.clause_no || '1',
  clause_title: overrides.clause_title || 'Name of the assessee',
  statutory_version: 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
  applicability_status: 'applicable',
  response_json: '{}',
  response_html: '',
  auditor_remarks_html: '',
  prefill_status: 'auto_filled',
  validation_status: 'valid',
  qualification_required: 0,
  qualification_text_html: '',
  workpaper_ref: '',
  review_status: 'draft',
  locked: 0,
  ...overrides,
});

describe('taxAuditForm3CDExport', () => {
  it('exports all configured Form 3CD clauses', () => {
    const form = buildTaxAuditForm3CDExport({
      setup,
      clientName: 'Sample Company Private Limited',
      clausesByKey: new Map(),
      generatedAt: '2026-07-03T12:00:00.000Z',
    });

    expect(form.rows).toHaveLength(FORM_3CD_CLAUSES.length);
    expect(form.heading).toBe('Form No. 3CD');
    expect(form.draftNotice).toContain('Draft output generated');
    expect(form.assesseeDetailsHeading).toBe('Assessee and Report Details');
    expect(form.particularsHeading).toBe('Statement of Particulars');
    expect(form.assessee.formType).toBe('Form 3CA + 3CD');
    expect(form.rows.map((row) => row.clauseNo)).toContain('44');
    expect(form.rows[0].particulars).toBe(TAX_AUDIT_FORM_3CD_EMPTY_PARTICULARS);
  });

  it('includes structured data and separated qualification text in the rendered output', () => {
    const clausesByKey = new Map<string, TaxAuditClauseResponse>([
      [
        'clause_1',
        clause({
          response_json: JSON.stringify({ structured: { assessee_name: 'Sample Company Private Limited' } }),
          qualification_text_html: '<p>Observation requiring report wording.</p>',
        }),
      ],
    ]);
    const form = buildTaxAuditForm3CDExport({ setup, clausesByKey });
    const html = renderTaxAuditForm3CDHtml(form);

    expect(form.rows[0].particulars).toContain('Assessee Name: Sample Company Private Limited');
    expect(html).toContain('Draft review note:');
    expect(html).toContain('Statement of Particulars');
    expect(html).toContain('Qualification / Observation requiring reporting:');
    expect(html).toContain('Observation requiring report wording.');
  });
});
