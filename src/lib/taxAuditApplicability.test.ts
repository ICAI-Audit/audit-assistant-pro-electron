import { describe, expect, it } from 'vitest';
import { calculateApplicability } from '@/lib/taxAuditApplicability';

describe('calculateApplicability', () => {
  it('resolves business presumptive lower-income cases to section 44AB(e)', () => {
    const result = calculateApplicability({
      has_business_activity: true,
      has_professional_activity: false,
      business_turnover: 8_000_000,
      cash_receipts_percent: 20,
      cash_payments_percent: 20,
      presumptive_taxation: true,
      lower_than_presumptive: true,
      books_audited_under_other_law: false,
    });

    expect(result.overall.result).toBe('Applicable');
    expect(result.overall.sectionReference).toBe('44AB(e)');
    expect(result.presumptive.presumptiveSection).toBe('44AD');
    expect(result.suggestedFormType).toBe('3CB');
  });

  it('resolves professional presumptive lower-income cases to section 44AB(d)', () => {
    const result = calculateApplicability({
      has_business_activity: false,
      has_professional_activity: true,
      professional_gross_receipts: 3_000_000,
      presumptive_taxation: true,
      lower_than_presumptive: true,
      books_audited_under_other_law: false,
    });

    expect(result.overall.result).toBe('Applicable');
    expect(result.overall.sectionReference).toBe('44AB(d)');
    expect(result.presumptive.presumptiveSection).toBe('44ADA');
    expect(result.suggestedFormType).toBe('3CB');
  });

  it('resolves special presumptive lower-income cases to section 44AB(c) when explicitly selected', () => {
    const result = calculateApplicability({
      has_business_activity: false,
      has_professional_activity: false,
      presumptive_taxation: true,
      lower_than_presumptive: true,
      presumptive_section: '44AE',
      books_audited_under_other_law: false,
    });

    expect(result.overall.result).toBe('Applicable');
    expect(result.overall.sectionReference).toBe('44AB(c)');
    expect(result.presumptive.presumptiveSection).toBe('44AE');
    expect(result.suggestedFormType).toBe('3CB');
    expect(result.warnings).not.toContain('Select at least one activity type to assess applicability.');
  });

  it('keeps normal business threshold applicability unchanged', () => {
    const result = calculateApplicability({
      has_business_activity: true,
      has_professional_activity: false,
      business_turnover: 20_000_000,
      cash_receipts_percent: 10,
      cash_payments_percent: 10,
      books_audited_under_other_law: true,
    });

    expect(result.overall.result).toBe('Applicable');
    expect(result.overall.sectionReference).toBe('44AB(a)');
    expect(result.overall.thresholdApplied).toBe('Rs. 1 crore');
    expect(result.suggestedFormType).toBe('3CA');
  });
});
