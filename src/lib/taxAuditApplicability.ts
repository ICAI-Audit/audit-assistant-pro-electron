import { TaxAuditFormType } from '@/types/taxAudit';

export type TaxAuditApplicabilityResult = 'Applicable' | 'Not applicable' | 'Review required' | 'Not assessed';

export type TaxAuditApplicabilityInputs = {
  has_business_activity?: boolean | number | string | null;
  has_professional_activity?: boolean | number | string | null;
  business_turnover?: number | string | null;
  professional_gross_receipts?: number | string | null;
};

export type TaxAuditApplicabilitySetup = TaxAuditApplicabilityInputs & {
  // Legacy field retained for old records and older UI flows.
  business_or_profession?: 'business' | 'profession' | string | null;
  turnover?: number | string | null;
  gross_receipts?: number | string | null;
  cash_receipts_percent?: number | string | null;
  cash_payments_percent?: number | string | null;
  presumptive_taxation?: boolean | number | string | null;
  lower_than_presumptive?: boolean | number | string | null;
  books_audited_under_other_law?: boolean | number | string | null;
  form_type?: TaxAuditFormType | string | null;
  status?: string | null;
  financial_year?: string | null;
  assessment_year?: string | null;
};

export type ActivityApplicability = {
  result: TaxAuditApplicabilityResult | null;
  turnover?: number | null;
  grossReceipts?: number | null;
  thresholdApplied: 'Rs. 1 crore' | 'Rs. 10 crore' | 'Rs. 50 lakh' | null;
  sectionReference: '44AB(a)' | '44AB(b)' | null;
};

export type TaxAuditApplicabilityCalculation = {
  overall: {
    result: TaxAuditApplicabilityResult;
    reason: string;
  };
  business: {
    result: TaxAuditApplicabilityResult | null;
    turnover: number | null;
    thresholdApplied: 'Rs. 1 crore' | 'Rs. 10 crore' | null;
    sectionReference: '44AB(a)' | null;
  };
  profession: {
    result: TaxAuditApplicabilityResult | null;
    grossReceipts: number | null;
    thresholdApplied: 'Rs. 50 lakh' | null;
    sectionReference: '44AB(b)' | null;
  };
  suggestedFormType: TaxAuditFormType | null;
  warnings: string[];
};

const BUSINESS_THRESHOLD = 10_000_000;
const ENHANCED_BUSINESS_THRESHOLD = 100_000_000;
const PROFESSION_THRESHOLD = 5_000_000;

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const hasExplicitValue = (value: unknown) => value !== null && value !== undefined && value !== '';

const toBool = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';

const normalizePercent = (value: unknown, field: string, warnings: string[]) => {
  const parsed = toNumber(value);
  if (parsed > 100) {
    warnings.push(`${field} is above 100%; capped at 100 for threshold evaluation.`);
    return 100;
  }
  return parsed;
};

const formatMoney = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);

const buildDefaultBusinessResult = (): TaxAuditApplicabilityCalculation['business'] => ({
  result: null,
  turnover: null,
  thresholdApplied: null,
  sectionReference: null,
});

const buildDefaultProfessionResult = (): TaxAuditApplicabilityCalculation['profession'] => ({
  result: null,
  grossReceipts: null,
  thresholdApplied: null,
  sectionReference: null,
});

function resolveInputs(setupData: TaxAuditApplicabilitySetup) {
  const hasNewBusinessFlag = hasExplicitValue(setupData.has_business_activity);
  const hasNewProfessionFlag = hasExplicitValue(setupData.has_professional_activity);

  if (hasNewBusinessFlag || hasNewProfessionFlag) {
    return {
      hasBusinessActivity: toBool(setupData.has_business_activity),
      hasProfessionalActivity: toBool(setupData.has_professional_activity),
      businessTurnover: toNumber(setupData.business_turnover),
      professionalGrossReceipts: toNumber(setupData.professional_gross_receipts),
      usedLegacyMapping: false,
    };
  }

  const legacyActivity = setupData.business_or_profession === 'profession' ? 'profession' : 'business';
  return {
    hasBusinessActivity: legacyActivity === 'business',
    hasProfessionalActivity: legacyActivity === 'profession',
    businessTurnover: legacyActivity === 'business' ? toNumber(setupData.turnover) : 0,
    professionalGrossReceipts: legacyActivity === 'profession' ? toNumber(setupData.gross_receipts) : 0,
    usedLegacyMapping: true,
  };
}

export function calculateApplicability(setupData: TaxAuditApplicabilitySetup): TaxAuditApplicabilityCalculation {
  const warnings: string[] = [];
  const resolved = resolveInputs(setupData);
  const cashReceiptsPercent = normalizePercent(setupData.cash_receipts_percent, 'Cash receipts percent', warnings);
  const cashPaymentsPercent = normalizePercent(setupData.cash_payments_percent, 'Cash payments percent', warnings);
  const presumptiveTaxation = toBool(setupData.presumptive_taxation);
  const lowerThanPresumptive = toBool(setupData.lower_than_presumptive);
  const booksAuditedUnderOtherLaw = toBool(setupData.books_audited_under_other_law);

  if (resolved.usedLegacyMapping) {
    warnings.push('Activity profile is derived from legacy business/profession selection.');
  }

  if (!resolved.hasBusinessActivity && !resolved.hasProfessionalActivity) {
    warnings.push('Select at least one activity type to assess applicability.');
  }

  let business = buildDefaultBusinessResult();
  let profession = buildDefaultProfessionResult();
  const reasons: string[] = [];

  if (resolved.hasBusinessActivity) {
    if (resolved.businessTurnover <= 0) {
      warnings.push('Business turnover is missing or zero.');
      business = {
        result: 'Not assessed',
        turnover: resolved.businessTurnover,
        thresholdApplied: null,
        sectionReference: '44AB(a)',
      };
      reasons.push('Business turnover is required to assess section 44AB(a).');
    } else {
      // Rs. 10 crore threshold applies only where both cash receipt and cash payment percentages are not more than 5 percent.
      const enhancedThresholdApplies = cashReceiptsPercent <= 5 && cashPaymentsPercent <= 5;
      const threshold = enhancedThresholdApplies ? ENHANCED_BUSINESS_THRESHOLD : BUSINESS_THRESHOLD;
      const thresholdLabel = enhancedThresholdApplies ? 'Rs. 10 crore' : 'Rs. 1 crore';
      const result: TaxAuditApplicabilityResult = resolved.businessTurnover > threshold ? 'Applicable' : 'Not applicable';

      business = {
        result,
        turnover: resolved.businessTurnover,
        thresholdApplied: thresholdLabel,
        sectionReference: '44AB(a)',
      };
      reasons.push(
        result === 'Applicable'
          ? `Business turnover of Rs. ${formatMoney(resolved.businessTurnover)} exceeds the ${thresholdLabel} threshold under section 44AB(a).`
          : `Business turnover of Rs. ${formatMoney(resolved.businessTurnover)} does not exceed the ${thresholdLabel} threshold under section 44AB(a).`
      );
    }
  }

  if (resolved.hasProfessionalActivity) {
    if (resolved.professionalGrossReceipts <= 0) {
      warnings.push('Professional gross receipts are missing or zero.');
      profession = {
        result: 'Not assessed',
        grossReceipts: resolved.professionalGrossReceipts,
        thresholdApplied: 'Rs. 50 lakh',
        sectionReference: '44AB(b)',
      };
      reasons.push('Professional gross receipts are required to assess section 44AB(b).');
    } else {
      const result: TaxAuditApplicabilityResult =
        resolved.professionalGrossReceipts > PROFESSION_THRESHOLD ? 'Applicable' : 'Not applicable';
      profession = {
        result,
        grossReceipts: resolved.professionalGrossReceipts,
        thresholdApplied: 'Rs. 50 lakh',
        sectionReference: '44AB(b)',
      };
      reasons.push(
        result === 'Applicable'
          ? `Professional gross receipts of Rs. ${formatMoney(resolved.professionalGrossReceipts)} exceed Rs. 50 lakh under section 44AB(b).`
          : `Professional gross receipts of Rs. ${formatMoney(resolved.professionalGrossReceipts)} do not exceed Rs. 50 lakh under section 44AB(b).`
      );
    }
  }

  const activityResults = [business.result, profession.result].filter(Boolean) as TaxAuditApplicabilityResult[];
  const hasApplicableActivity = activityResults.includes('Applicable');
  const hasNotAssessedActivity = activityResults.includes('Not assessed');
  const allActivitiesNotApplicable =
    activityResults.length > 0 && activityResults.every((result) => result === 'Not applicable');

  let overallResult: TaxAuditApplicabilityResult = 'Not assessed';
  if (hasApplicableActivity) {
    overallResult = 'Applicable';
  } else if (allActivitiesNotApplicable) {
    overallResult = 'Not applicable';
  } else if (hasNotAssessedActivity) {
    overallResult = 'Not assessed';
  }

  if (presumptiveTaxation && lowerThanPresumptive && !hasApplicableActivity) {
    overallResult = 'Review required';
    reasons.push(
      'Presumptive taxation is selected and income is reported lower than the presumptive threshold. Sections 44AD, 44ADA, 44AE, 44BB, and 44BBB require further auditor review before concluding applicability.'
    );
  }

  const suggestedFormType: TaxAuditFormType | null =
    overallResult === 'Applicable' ? (booksAuditedUnderOtherLaw ? '3CA' : '3CB') : null;

  return {
    overall: {
      result: overallResult,
      reason: reasons.length > 0 ? reasons.join(' ') : 'No business or professional activity has been selected for applicability assessment.',
    },
    business,
    profession,
    suggestedFormType,
    warnings,
  };
}
