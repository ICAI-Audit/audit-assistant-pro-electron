import { describe, expect, it } from 'vitest';
import {
  FORM26_FIRST_TAX_YEAR_START,
  FORM26_RELEASED,
  chooseTaxAuditForm,
  form26WhySentence,
  parseEngagementYear,
} from '@/lib/taxAuditForm26Year';
import { deriveAssessmentYear, derivePreviousYearRange } from '@/utils/tax-audit/applicability';

// Every way a year reaches the engagement: the generated code (useFinancialYears: 'YYYY-YY'),
// the four-digit form the 3CD parsers also accept, and the display name ('FY YYYY-YY').
const FORM26_YEARS = ['2026-27', '2026-2027', '2027-28', ' 2026-27 ', 'FY 2026-27', 'fy 2026–27', 'FY2026-27', '2026–2027', '2099-00', '2030-31'];
const THREE_CD_YEARS = ['2025-26', '2025-2026', '2017-18', '2024-25', ' 2025-26 ', 'FY 2025-26', 'fy 2024–25', '1999-00', '1999-2000'];
const UNKNOWN_YEARS: (string | null | undefined)[] = [
  '2026-28', '2026', '2026/27', '', '   ', null, undefined, 'abc',
  '2026-26', '2027-26', '2026-2028', '2026-2026', '2026-027', '26-27', '2026-7', '2026 - 27', '2026 27',
  'AY 2027-28', 'TY 2026-27', 'FY', 'FY 2026', '2026-27 (revised)', 'x2026-27', '2026-27x', '2026-27-28',
  'Jan 2026 - Dec 2026', '01-01-2026 to 31-12-2026', '2026-04-01', 'CY 2026', '20266-27', '2026—27', '2026-२७',
];

describe('parseEngagementYear', () => {
  it('reads YYYY-YY and YYYY-YYYY', () => {
    expect(parseEngagementYear('2026-27')).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseEngagementYear('2026-2027')).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseEngagementYear('2025-26')).toEqual({ startYear: 2025, endYear: 2026 });
    expect(parseEngagementYear('2017-18')).toEqual({ startYear: 2017, endYear: 2018 });
  });

  it('trims, and accepts a leading FY in either case and an en dash', () => {
    expect(parseEngagementYear(' 2026-27 ')).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseEngagementYear('FY 2026-27')).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseEngagementYear('fy 2026–27')).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseEngagementYear('FY2026-27')).toEqual({ startYear: 2026, endYear: 2027 });
  });

  it('reads a year that crosses a century', () => {
    expect(parseEngagementYear('1999-00')).toEqual({ startYear: 1999, endYear: 2000 });
    expect(parseEngagementYear('2099-00')).toEqual({ startYear: 2099, endYear: 2100 });
  });

  it('gives null unless the end is the start plus one', () => {
    for (const year of UNKNOWN_YEARS) expect(parseEngagementYear(year), String(year)).toBeNull();
  });

  it('never throws on a value that is not text', () => {
    for (const odd of [2026, {}, [], true, Number.NaN]) {
      expect(parseEngagementYear(odd as unknown as string)).toBeNull();
    }
  });

  it('reads every year the generated list of financial years can hold', () => {
    for (let start = 2017; start <= 2040; start += 1) {
      const code = `${start}-${String(start + 1).slice(2)}`;   // useFinancialYears.generateFinancialYears
      expect(parseEngagementYear(code), code).toEqual({ startYear: start, endYear: start + 1 });
      expect(parseEngagementYear(`FY ${code}`), code).toEqual({ startYear: start, endYear: start + 1 });
    }
  });

  it('accepts every plain year the 3CD parsers accept when it is one April-to-March year', () => {
    for (const year of ['2024-25', '2025-2026', ' 2026-27 ', '2026-2027']) {
      expect(deriveAssessmentYear(year)).not.toBe('');
      expect(derivePreviousYearRange(year).from).not.toBe('');
      expect(parseEngagementYear(year), year).not.toBeNull();
    }
  });

  it('refuses a year the 3CD parsers accept without checking it (2026-28)', () => {
    expect(deriveAssessmentYear('2026-28')).toBe('2027-28');
    expect(parseEngagementYear('2026-28')).toBeNull();
  });
});

describe('chooseTaxAuditForm', () => {
  it('the first tax year of Form No. 26 starts in 2026', () => {
    expect(FORM26_FIRST_TAX_YEAR_START).toBe(2026);
  });

  it('2025-26 → 3cd', () => expect(chooseTaxAuditForm('2025-26')).toBe('3cd'));
  it('2026-27 → form26', () => expect(chooseTaxAuditForm('2026-27')).toBe('form26'));
  it('2026-2027 → form26', () => expect(chooseTaxAuditForm('2026-2027')).toBe('form26'));
  it('2027-28 → form26', () => expect(chooseTaxAuditForm('2027-28')).toBe('form26'));
  it('2017-18 → 3cd', () => expect(chooseTaxAuditForm('2017-18')).toBe('3cd'));
  it("' 2026-27 ' → form26", () => expect(chooseTaxAuditForm(' 2026-27 ')).toBe('form26'));
  it("'FY 2026-27' and 'fy 2026–27' → form26", () => {
    expect(chooseTaxAuditForm('FY 2026-27')).toBe('form26');
    expect(chooseTaxAuditForm('fy 2026–27')).toBe('form26');
  });
  it("'2026-28', '2026', '2026/27', '', null, undefined, 'abc' → unknown", () => {
    for (const year of ['2026-28', '2026', '2026/27', '', null, undefined, 'abc']) {
      expect(chooseTaxAuditForm(year), String(year)).toBe('unknown');
    }
  });

  it('every year from 2026-27 onwards is Form No. 26', () => {
    for (const year of FORM26_YEARS) expect(chooseTaxAuditForm(year), year).toBe('form26');
  });
  it('every earlier year is Forms 3CA/3CB/3CD', () => {
    for (const year of THREE_CD_YEARS) expect(chooseTaxAuditForm(year), year).toBe('3cd');
  });
  it('a missing, malformed or non-April year is unknown, never a silent default', () => {
    for (const year of UNKNOWN_YEARS) expect(chooseTaxAuditForm(year), String(year)).toBe('unknown');
  });
  it('an assessment-year label is not read as a financial year', () => {
    expect(chooseTaxAuditForm('AY 2027-28')).toBe('unknown');
    expect(chooseTaxAuditForm('AY 2025-26')).toBe('unknown');
  });
  it('the boundary is exactly the year that starts on 1 April 2026', () => {
    expect(chooseTaxAuditForm('2025-2026')).toBe('3cd');
    expect(chooseTaxAuditForm('2026-2027')).toBe('form26');
    expect(parseEngagementYear('2026-27')?.startYear).toBe(FORM26_FIRST_TAX_YEAR_START);
  });
});

describe('chooseTaxAuditForm, the released build', () => {
  it('Form No. 26 is switched on: the year alone decides, with no build setting to change it', () => {
    expect(FORM26_RELEASED).toBe(true);
    expect(chooseTaxAuditForm.length).toBe(1);
    expect(chooseTaxAuditForm('2026-27')).toBe('form26');
    expect(chooseTaxAuditForm('2027-28')).toBe('form26');
    expect(chooseTaxAuditForm('2025-26')).toBe('3cd');
    expect(chooseTaxAuditForm('2024-25')).toBe('3cd');
    for (const year of ['', null, undefined, 'abc']) expect(chooseTaxAuditForm(year), String(year)).toBe('unknown');
  });
});

describe('form26WhySentence', () => {
  it('the sentence names the year as given', () => {
    expect(form26WhySentence('2026-27')).toBe('Form No. 26 applies to tax years from 2026-27. This engagement is for 2026-27.');
    expect(form26WhySentence('2027-2028')).toBe('Form No. 26 applies to tax years from 2026-27. This engagement is for 2027-2028.');
    expect(form26WhySentence(' FY 2026-27 ')).toBe('Form No. 26 applies to tax years from 2026-27. This engagement is for FY 2026-27.');
  });
});
