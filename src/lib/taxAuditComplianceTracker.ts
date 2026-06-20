import {
  TaxAuditComplianceTracker,
  TaxAuditComplianceWorkflowStatus,
} from '@/types/taxAudit';

export type TaxAuditComplianceBadge =
  | 'Specified date pending'
  | 'Filing pending'
  | 'UDIN pending'
  | 'Completed';

export type TaxAuditComplianceTrackerSummary = {
  badge: TaxAuditComplianceBadge;
  specifiedDatePending: boolean;
  filingPending: boolean;
  udinPending: boolean;
  completed: boolean;
  warnings: string[];
};

const STATUS_VALUES: TaxAuditComplianceWorkflowStatus[] = ['pending', 'completed', 'not_applicable'];

const FILING_STATUS_FIELDS: Array<keyof TaxAuditComplianceTracker> = [
  'assigned_by_client_on_portal',
  'accepted_by_ca_on_portal',
  'form_3ca_3cb_uploaded',
  'form_3cd_uploaded',
  'financial_statements_uploaded',
  'client_accepted_uploaded_report',
];

export const DEFAULT_TAX_AUDIT_COMPLIANCE_TRACKER: TaxAuditComplianceTracker = {
  version: 1,
  due_date_for_return: '',
  specified_date_for_tax_audit_report: '',
  is_transfer_pricing_applicable: false,
  remarks: '',
  assigned_by_client_on_portal: 'pending',
  accepted_by_ca_on_portal: 'pending',
  form_3ca_3cb_uploaded: 'pending',
  form_3cd_uploaded: 'pending',
  financial_statements_uploaded: 'pending',
  client_accepted_uploaded_report: 'pending',
  acknowledgement_reference: '',
  acknowledgement_date: '',
  udin_required: 'pending',
  udin_generated: 'pending',
  udin_number: '',
  udin_generated_date: '',
  udin_updated_on_income_tax_portal: 'pending',
  udin_update_due_date: '',
  udin_remarks: '',
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isValidStatus = (value: unknown): value is TaxAuditComplianceWorkflowStatus =>
  STATUS_VALUES.includes(value as TaxAuditComplianceWorkflowStatus);

const toStatus = (value: unknown): TaxAuditComplianceWorkflowStatus =>
  isValidStatus(value) ? value : 'pending';

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '');

const isDateInputValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDateInput = (value: string) => {
  if (!isDateInputValue(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const formatDateInput = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const daysInUtcMonth = (year: number, zeroBasedMonth: number) =>
  new Date(Date.UTC(year, zeroBasedMonth + 1, 0)).getUTCDate();

export function calculateSpecifiedDateFromReturnDueDate(dueDateForReturn: string) {
  const date = parseDateInput(dueDateForReturn);
  if (!date) return '';

  const targetMonth = date.getUTCMonth() - 1;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, normalizedMonth));
  return formatDateInput(new Date(Date.UTC(targetYear, normalizedMonth, day)));
}

export function calculateUdinUpdateDueDate(udinGeneratedDate: string) {
  const date = parseDateInput(udinGeneratedDate);
  if (!date) return '';
  const dueDate = new Date(date);
  dueDate.setUTCDate(dueDate.getUTCDate() + 60);
  return formatDateInput(dueDate);
}

export function normalizeTaxAuditComplianceTracker(value: unknown): TaxAuditComplianceTracker {
  if (!isPlainObject(value)) return { ...DEFAULT_TAX_AUDIT_COMPLIANCE_TRACKER };

  return {
    version: 1,
    due_date_for_return: toStringValue(value.due_date_for_return),
    specified_date_for_tax_audit_report: toStringValue(value.specified_date_for_tax_audit_report),
    is_transfer_pricing_applicable: value.is_transfer_pricing_applicable === true,
    remarks: toStringValue(value.remarks),
    assigned_by_client_on_portal: toStatus(value.assigned_by_client_on_portal),
    accepted_by_ca_on_portal: toStatus(value.accepted_by_ca_on_portal),
    form_3ca_3cb_uploaded: toStatus(value.form_3ca_3cb_uploaded),
    form_3cd_uploaded: toStatus(value.form_3cd_uploaded),
    financial_statements_uploaded: toStatus(value.financial_statements_uploaded),
    client_accepted_uploaded_report: toStatus(value.client_accepted_uploaded_report),
    acknowledgement_reference: toStringValue(value.acknowledgement_reference),
    acknowledgement_date: toStringValue(value.acknowledgement_date),
    udin_required: toStatus(value.udin_required),
    udin_generated: toStatus(value.udin_generated),
    udin_number: toStringValue(value.udin_number),
    udin_generated_date: toStringValue(value.udin_generated_date),
    udin_updated_on_income_tax_portal: toStatus(value.udin_updated_on_income_tax_portal),
    udin_update_due_date: toStringValue(value.udin_update_due_date),
    udin_remarks: toStringValue(value.udin_remarks),
  };
}

export function summarizeTaxAuditComplianceTracker(
  tracker: TaxAuditComplianceTracker,
  today: Date = new Date()
): TaxAuditComplianceTrackerSummary {
  const warnings: string[] = [];
  const specifiedDatePending = !tracker.due_date_for_return || !tracker.specified_date_for_tax_audit_report;
  const filingPending = FILING_STATUS_FIELDS.some((field) => tracker[field] === 'pending');
  const udinPending =
    tracker.udin_required !== 'not_applicable' &&
    (tracker.udin_required === 'pending' ||
      tracker.udin_generated === 'pending' ||
      tracker.udin_updated_on_income_tax_portal === 'pending');

  const specifiedDate = parseDateInput(tracker.specified_date_for_tax_audit_report);
  const todayOnly = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const reportUploaded =
    tracker.form_3ca_3cb_uploaded === 'completed' && tracker.form_3cd_uploaded === 'completed';

  if (specifiedDate && specifiedDate.getTime() < todayOnly && !reportUploaded) {
    warnings.push('Specified date has passed and the tax audit report upload is not marked completed.');
  }

  if (tracker.udin_generated === 'completed' && !tracker.udin_number.trim()) {
    warnings.push('UDIN is marked generated, but UDIN number is blank.');
  }

  const completed = !specifiedDatePending && !filingPending && !udinPending;
  const badge: TaxAuditComplianceBadge = specifiedDatePending
    ? 'Specified date pending'
    : filingPending
      ? 'Filing pending'
      : udinPending
        ? 'UDIN pending'
        : 'Completed';

  return {
    badge,
    specifiedDatePending,
    filingPending,
    udinPending,
    completed,
    warnings,
  };
}
