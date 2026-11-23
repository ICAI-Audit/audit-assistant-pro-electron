// Which tax-audit form an engagement gets, decided from the engagement's financial year alone.
// Three answers, never a silent default: Forms 3CA/3CB/3CD, Form No. 26, or "the year is not understood".

export type TaxAuditFormChoice = 'form26' | '3cd' | 'unknown';

// Form No. 26 applies to tax years commencing on or after 1 April 2026; Forms 3CA, 3CB and 3CD continue
// for previous years relevant to assessment years up to 2026-27 (department's FAQ on Form No. 26,
// questions 2 and 6: form26/SOURCES.md S-028).
export const FORM26_FIRST_TAX_YEAR_START = 2026;

// The release switch, on since the Form No. 26 work was completed (task 28). Set to false, every engagement
// would get the Form 3CD screens exactly as before Form No. 26 was built.
export const FORM26_RELEASED: boolean = true;

// 'YYYY-YY' or 'YYYY-YYYY', a hyphen or an en dash between, optionally preceded by 'FY'.
const YEAR_PATTERN = /^(?:FY\s*)?(\d{4})[-–](\d{2}|\d{4})$/i;

export function parseEngagementYear(financialYear: string | null | undefined): { startYear: number; endYear: number } | null {
  if (typeof financialYear !== 'string') return null;
  const match = YEAR_PATTERN.exec(financialYear.trim());
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = startYear + 1;
  const endGiven = Number(match[2]);
  const endExpected = match[2].length === 2 ? endYear % 100 : endYear;
  if (endGiven !== endExpected) return null;
  return { startYear, endYear };
}

export function chooseTaxAuditForm(financialYear: string | null | undefined): TaxAuditFormChoice {
  if (!FORM26_RELEASED) return '3cd';
  const year = parseEngagementYear(financialYear);
  if (!year) return 'unknown';
  return year.startYear >= FORM26_FIRST_TAX_YEAR_START ? 'form26' : '3cd';
}

export function form26WhySentence(financialYear: string): string {
  const first = `${FORM26_FIRST_TAX_YEAR_START}-${String((FORM26_FIRST_TAX_YEAR_START + 1) % 100).padStart(2, '0')}`;
  return `Form No. 26 applies to tax years from ${first}. This engagement is for ${String(financialYear ?? '').trim()}.`;
}
