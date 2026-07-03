import type { TaxAuditFormType, TaxAuditReviewStatus } from '@/types/taxAudit';

type BooleanLike = boolean | number | string | null | undefined;

type TaxAuditReportSelectionInput = {
  constitution?: string | null;
  engagementType?: string | null;
};

type TaxAuditReportFormStateInput = {
  formType?: TaxAuditFormType | '' | null;
  booksAuditedUnderOtherLaw?: BooleanLike;
};

type TaxAuditDraftRepairInput = {
  form_type?: TaxAuditFormType | '' | null;
  books_audited_under_other_law?: BooleanLike;
  review_status?: TaxAuditReviewStatus | string | null;
};

const toBool = (value: BooleanLike) => value === true || value === 1 || value === '1' || value === 'true';

export const isCompanyConstitution = (value?: string | null) => {
  const normalized = (value || '').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('llp') || normalized.includes('limited liability partnership')) return false;
  return (
    normalized.includes('company') ||
    normalized.includes('private limited') ||
    normalized.includes('public limited') ||
    normalized.includes('one person company') ||
    normalized.includes('opc') ||
    normalized.includes('section 8')
  );
};

export const getDefaultTaxAuditReportSelection = ({
  constitution,
  engagementType,
}: TaxAuditReportSelectionInput) => {
  const companyAccountsAudited = isCompanyConstitution(constitution);
  const booksAuditedUnderOtherLaw = companyAccountsAudited || engagementType === 'statutory';

  return {
    formType: (booksAuditedUnderOtherLaw ? '3CA' : '3CB') as TaxAuditFormType,
    booksAuditedUnderOtherLaw,
    otherLawName: companyAccountsAudited ? 'Companies Act, 2013' : '',
  };
};

export const resolveTaxAuditReportFormState = ({
  formType,
  booksAuditedUnderOtherLaw,
}: TaxAuditReportFormStateInput) => {
  const selectedReportForm = (formType || (toBool(booksAuditedUnderOtherLaw) ? '3CA' : '3CB')) as TaxAuditFormType;

  return {
    selectedReportForm,
    auditedUnderOtherLaw: selectedReportForm === '3CA',
  };
};

export const shouldRepairTaxAuditDraftReportSelection = (setup: TaxAuditDraftRepairInput) =>
  setup.review_status === 'draft' &&
  toBool(setup.books_audited_under_other_law) &&
  setup.form_type !== '3CA';
