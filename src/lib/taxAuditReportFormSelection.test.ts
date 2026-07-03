import { describe, expect, it } from 'vitest';
import {
  getDefaultTaxAuditReportSelection,
  isCompanyConstitution,
  resolveTaxAuditReportFormState,
  shouldRepairTaxAuditDraftReportSelection,
} from '@/lib/taxAuditReportFormSelection';

describe('tax audit report form selection', () => {
  it('identifies companies without treating LLP as a company', () => {
    expect(isCompanyConstitution('Private Limited Company')).toBe(true);
    expect(isCompanyConstitution('Section 8 Company')).toBe(true);
    expect(isCompanyConstitution('Limited Liability Partnership')).toBe(false);
    expect(isCompanyConstitution('LLP')).toBe(false);
  });

  it('defaults company tax audit setups to Form 3CA under the Companies Act', () => {
    const selection = getDefaultTaxAuditReportSelection({
      constitution: 'Private Limited Company',
      engagementType: 'tax_audit',
    });

    expect(selection.formType).toBe('3CA');
    expect(selection.booksAuditedUnderOtherLaw).toBe(true);
    expect(selection.otherLawName).toBe('Companies Act, 2013');
  });

  it('defaults non-company tax audit setups to Form 3CB', () => {
    const selection = getDefaultTaxAuditReportSelection({
      constitution: 'Partnership Firm',
      engagementType: 'tax_audit',
    });

    expect(selection.formType).toBe('3CB');
    expect(selection.booksAuditedUnderOtherLaw).toBe(false);
    expect(selection.otherLawName).toBe('');
  });

  it('keeps statutory audited non-company setups on Form 3CA without adding Companies Act text', () => {
    const selection = getDefaultTaxAuditReportSelection({
      constitution: 'Trust',
      engagementType: 'statutory',
    });

    expect(selection.formType).toBe('3CA');
    expect(selection.booksAuditedUnderOtherLaw).toBe(true);
    expect(selection.otherLawName).toBe('');
  });

  it('respects explicit user form selection instead of forcing Form 3CA from the books flag', () => {
    const state = resolveTaxAuditReportFormState({
      formType: '3CB',
      booksAuditedUnderOtherLaw: true,
    });

    expect(state.selectedReportForm).toBe('3CB');
    expect(state.auditedUnderOtherLaw).toBe(false);
  });

  it('derives Form 3CA when no explicit form exists but books are audited under another law', () => {
    const state = resolveTaxAuditReportFormState({
      formType: '',
      booksAuditedUnderOtherLaw: 1,
    });

    expect(state.selectedReportForm).toBe('3CA');
    expect(state.auditedUnderOtherLaw).toBe(true);
  });

  it('repairs only draft setups that still have audited-books flag with a non-3CA form', () => {
    expect(
      shouldRepairTaxAuditDraftReportSelection({
        form_type: '3CB',
        books_audited_under_other_law: 1,
        review_status: 'draft',
      })
    ).toBe(true);
    expect(
      shouldRepairTaxAuditDraftReportSelection({
        form_type: '3CB',
        books_audited_under_other_law: 1,
        review_status: 'reviewed',
      })
    ).toBe(false);
    expect(
      shouldRepairTaxAuditDraftReportSelection({
        form_type: '3CB',
        books_audited_under_other_law: 0,
        review_status: 'draft',
      })
    ).toBe(false);
  });
});
