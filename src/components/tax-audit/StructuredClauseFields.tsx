import { useState } from 'react';
import { AlertCircle, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  TaxAudit3CDFieldSchema,
  TaxAuditStructuredField,
  TaxAuditStructuredTable,
  TaxAuditStructuredTableColumn,
} from '@/data/taxAudit3CDFieldSchemas';
import { TaxAuditClauseResponse } from '@/types/taxAudit';

type StructuredValue = string | number | boolean | null;
type StructuredRow = Record<string, StructuredValue>;
type StructuredValues = Record<string, StructuredValue | StructuredRow[]>;

type ParsedResponseJson = Record<string, unknown> & {
  structured?: StructuredValues;
};

type StructuredClauseFieldsProps = {
  clause: TaxAuditClauseResponse;
  schema: TaxAudit3CDFieldSchema;
  activeTableKey?: string;
  disabled?: boolean;
  onUpdate: (updates: Partial<TaxAuditClauseResponse>) => Promise<void>;
};

type RowEditorState = {
  tableKey: string;
  rowIndex: number | null;
  draft: StructuredRow;
};

const STRUCTURED_VALIDATION_PREFIX = 'Structured:';

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

const isValidPanOrAadhaar = (value: string) => {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalized) || /^[0-9]{12}$/.test(normalized);
};

const isValidDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const isNumericValue = (value: unknown) => {
  if (isBlank(value)) return true;
  return Number.isFinite(Number(value));
};

const toFiniteNumber = (value: unknown) => {
  if (isBlank(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// These acceptance modes warrant a manual 269SS review once the monetary threshold is met.
const THRESHOLD_REVIEW_MODES = new Set([
  'Cash',
  'Bearer cheque',
  'Non-account payee cheque',
  'Non-account payee bank draft',
  'Journal entry',
  'Transfer of asset',
  'Conversion of liability',
  'Other',
]);

const getRows = (structured: StructuredValues, key: string): StructuredRow[] =>
  Array.isArray(structured[key]) ? (structured[key] as StructuredRow[]) : [];

const hasReportingDetails = (row: StructuredRow, keys: string[]) => keys.some((key) => !isBlank(row[key]));

const hasUsefulTableRow = (rows: StructuredRow[], columns: TaxAuditStructuredTableColumn[]) =>
  rows.some((row) => columns.some((column) => !isBlank(row[column.key])));

const createEmptyRow = (table: TaxAuditStructuredTable) =>
  table.columns.reduce<StructuredRow>((row, column) => {
    row[column.key] = column.type === 'checkbox' ? false : '';
    return row;
  }, {});

const getStructuredValues = (clause: TaxAuditClauseResponse): { parsed: ParsedResponseJson; structured: StructuredValues } => {
  const parsed = parseJson<ParsedResponseJson>(clause.response_json, {});
  const structured = parsed.structured && typeof parsed.structured === 'object' && !Array.isArray(parsed.structured)
    ? parsed.structured
    : {};
  return { parsed, structured };
};

const renderInput = ({
  field,
  value,
  disabled,
  onChange,
}: {
  field: TaxAuditStructuredField | TaxAuditStructuredTableColumn;
  value: StructuredValue;
  disabled?: boolean;
  onChange: (value: StructuredValue) => void;
}) => {
  if (field.type === 'textarea') {
    return (
      <Textarea
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        rows={3}
        disabled={disabled}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <Select value={String(value ?? '')} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={field.placeholder || 'Select'} />
        </SelectTrigger>
        <SelectContent>
          {(field.options || []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <Checkbox checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} disabled={disabled} />
        {field.label}
      </label>
    );
  }

  return (
    <Input
      type={field.type === 'number' || field.type === 'percentage' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={String(value ?? '')}
      onChange={(event) => onChange(field.type === 'number' || field.type === 'percentage' ? event.target.value : event.target.value)}
      placeholder={field.placeholder}
      disabled={disabled}
      min={field.type === 'percentage' ? 0 : undefined}
      max={field.type === 'percentage' ? 100 : undefined}
      step={field.type === 'percentage' ? '0.01' : undefined}
    />
  );
};

const getColumnDisplayValue = (column: TaxAuditStructuredTableColumn, row: StructuredRow) => {
  const value = row[column.key];
  if (isBlank(value)) return 'Not captured';
  if (column.type === 'checkbox') return value === true ? 'Yes' : 'No';
  const optionLabel = column.options?.find((option) => option.value === value)?.label;
  return optionLabel || String(value);
};

const getSummaryColumns = (table: TaxAuditStructuredTable) => {
  if (table.summaryFields?.length) {
    const configuredColumns = table.summaryFields
      .map((fieldKey) => table.columns.find((column) => column.key === fieldKey))
      .filter((column): column is TaxAuditStructuredTableColumn => Boolean(column));
    if (configuredColumns.length > 0) return configuredColumns;
  }
  return table.columns.filter((column) => column.key !== 'remarks').slice(0, 3);
};

const formatSourceHint = (value: string) =>
  value
    .replace(/\bTax Audit\b/g, 'Tax audit')
    .replace(/\btax Audit\b/g, 'Tax audit');

function CompactWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs text-amber-800">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="leading-5">{warnings.join(' ')}</span>
    </div>
  );
}

export function StructuredClauseFields({ clause, schema, activeTableKey, disabled, onUpdate }: StructuredClauseFieldsProps) {
  const { parsed, structured } = getStructuredValues(clause);
  const validationMessages = parseJson<string[]>(clause.validation_messages_json, []);
  const tables = schema.tables || (schema.table ? [schema.table] : []);
  // Clauses such as 34(a)/(b)/(c) intentionally use the table workbench even when only one
  // sub-clause exists so the navigator and editor stay on the same interaction pattern.
  const usesTableWorkbench = Boolean(schema.tables?.length);
  const [rowEditor, setRowEditor] = useState<RowEditorState | null>(null);
  const activeTable = tables.find((table) => table.key === activeTableKey) || tables[0];

  const buildWarnings = (nextStructured: StructuredValues) => {
    const warnings: string[] = [];

    (schema.fields || []).forEach((field) => {
      if (field.required && isBlank(nextStructured[field.key])) {
        warnings.push(`${field.label} is required.`);
      }
      const value = nextStructured[field.key];
      if (field.type === 'date' && !isBlank(value) && !isValidDateInput(String(value))) {
        warnings.push(`${field.label} should be a valid date.`);
      }
      if (field.type === 'number' && !isNumericValue(value)) {
        warnings.push(`${field.label} should be numeric.`);
      }
      if (field.type === 'percentage' && !isBlank(value)) {
        const percentage = Number(value);
        if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
          warnings.push(`${field.label} should be between 0 and 100.`);
        }
      }
    });

    const panOrAadhaar = nextStructured.pan_or_aadhaar;
    if (typeof panOrAadhaar === 'string' && panOrAadhaar.trim() && !isValidPanOrAadhaar(panOrAadhaar)) {
      warnings.push('PAN or Aadhaar number format should be a valid PAN or 12 digit Aadhaar.');
    }

    tables.forEach((table) => {
      if (table.required) {
        const rows = getRows(nextStructured, table.key);
        const hasUsefulRow = hasUsefulTableRow(rows, table.columns);
        if (!hasUsefulRow) {
          warnings.push(`${table.label} should have at least one useful row or be documented in the narrative response.`);
        }
      }

      const rows = getRows(nextStructured, table.key);
      rows.forEach((row, index) => {
        table.columns.forEach((column) => {
          if (column.required && !isBlank(row[column.key])) return;
          if (column.required) warnings.push(`Row ${index + 1}: ${column.label} is required.`);
          const value = row[column.key];
          if (column.type === 'date' && !isBlank(value) && !isValidDateInput(String(value))) {
            warnings.push(`Row ${index + 1}: ${column.label} should be a valid date.`);
          }
          if (column.type === 'number' && !isNumericValue(value)) {
            warnings.push(`Row ${index + 1}: ${column.label} should be numeric.`);
          }
          if (column.type === 'percentage' && !isBlank(value)) {
            const percentage = Number(value);
            if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
              warnings.push(`Row ${index + 1}: ${column.label} should be between 0 and 100.`);
            }
          }
        });
      });
    });

    if (schema.clauseKey === 'clause_15' && nextStructured.whether_any_capital_asset_converted_into_stock_in_trade === 'yes' && tables[0]) {
      const rows = getRows(nextStructured, tables[0].key);
      if (!hasUsefulTableRow(rows, tables[0].columns)) {
        warnings.push('At least one asset row should be captured when conversion is marked Yes.');
      }
    }

    if (schema.clauseKey === 'clause_16') {
      getRows(nextStructured, 'rows').forEach((row, index) => {
        if (!isBlank(row.amount) && isBlank(row.description)) {
          warnings.push(`Row ${index + 1}: Description is required when amount is entered.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_17') {
      getRows(nextStructured, 'rows').forEach((row, index) => {
        const consideration = Number(row.consideration_received_or_accrued);
        const stampValue = Number(row.value_adopted_or_assessed_or_assessable);
        if (Number.isFinite(consideration) && Number.isFinite(stampValue) && stampValue > consideration) {
          warnings.push(`Row ${index + 1}: Stamp value exceeds consideration. Review section 43CA / 50C impact manually.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_19') {
      getRows(nextStructured, 'deduction_rows').forEach((row, index) => {
        const debited = Number(row.amount_debited_to_profit_and_loss);
        const admissible = Number(row.amount_admissible_under_income_tax_act);
        const hasAmount = !isBlank(row.amount_debited_to_profit_and_loss) || !isBlank(row.amount_admissible_under_income_tax_act);
        if (hasAmount && isBlank(row.section)) {
          warnings.push(`Row ${index + 1}: Section should be selected when amount is entered.`);
        }
        if (Number.isFinite(debited) && Number.isFinite(admissible) && admissible > debited) {
          warnings.push(`Row ${index + 1}: Amount admissible exceeds amount debited to P&L. Review manually.`);
        }
        if (row.conditions_fulfilled === 'No' && !isBlank(row.amount_admissible_under_income_tax_act)) {
          warnings.push(`Row ${index + 1}: Conditions are marked No but admissible amount is entered.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_20') {
      getRows(nextStructured, 'employee_contribution_rows').forEach((row, index) => {
        const dueDate = typeof row.due_date_for_deposit === 'string' ? row.due_date_for_deposit : '';
        const actualDate = typeof row.actual_date_of_deposit === 'string' ? row.actual_date_of_deposit : '';
        const received = Number(row.amount_received_from_employees);
        const deposited = Number(row.amount_deposited);

        if (dueDate && actualDate && isValidDateInput(dueDate) && isValidDateInput(actualDate) && actualDate > dueDate) {
          warnings.push(`Employee contribution row ${index + 1}: Actual deposit date is after due date.`);
        }
        if (Number.isFinite(received) && Number.isFinite(deposited) && deposited < received) {
          warnings.push(`Employee contribution row ${index + 1}: Amount deposited is less than amount received from employees.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_21') {
      getRows(nextStructured, 'clause_21a_rows').forEach((row, index) => {
        const debited = Number(row.amount_debited_to_profit_and_loss);
        const inadmissible = Number(row.amount_inadmissible);
        const hasAmount =
          !isBlank(row.amount_debited_to_profit_and_loss) ||
          !isBlank(row.amount_inadmissible);

        if (!isBlank(row.category) && !hasAmount) {
          warnings.push(`21(a) row ${index + 1}: Amount should be entered when category is selected.`);
        }
        if (
          !isBlank(row.amount_debited_to_profit_and_loss) &&
          !isBlank(row.amount_inadmissible) &&
          Number.isFinite(debited) &&
          Number.isFinite(inadmissible) &&
          inadmissible > debited
        ) {
          warnings.push(`21(a) row ${index + 1}: Amount inadmissible exceeds amount debited to P&L. Review manually.`);
        }
      });

      getRows(nextStructured, 'clause_21b_rows').forEach((row, index) => {
        const taxDeducted = typeof row.tax_deducted === 'string' ? row.tax_deducted : '';
        const deducted = Number(row.tax_deducted_amount);
        const deposited = Number(row.tax_deposited_amount);

        if (taxDeducted === 'yes' && isBlank(row.tax_deducted_amount)) {
          warnings.push(`21(b) row ${index + 1}: Tax deducted amount should be entered when tax deducted is Yes.`);
        }
        if (
          !isBlank(row.tax_deducted_amount) &&
          !isBlank(row.tax_deposited_amount) &&
          Number.isFinite(deducted) &&
          Number.isFinite(deposited) &&
          deposited > deducted
        ) {
          warnings.push(`21(b) row ${index + 1}: Tax deposited amount exceeds tax deducted amount. Review manually.`);
        }
      });

      getRows(nextStructured, 'clause_21c_rows').forEach((row, index) => {
        const debited = Number(row.amount_debited_to_profit_and_loss);
        const inadmissible = Number(row.amount_inadmissible);

        if (
          !isBlank(row.amount_debited_to_profit_and_loss) &&
          !isBlank(row.amount_inadmissible) &&
          Number.isFinite(debited) &&
          Number.isFinite(inadmissible) &&
          inadmissible > debited
        ) {
          warnings.push(`21(c) row ${index + 1}: Amount inadmissible exceeds amount debited to P&L. Review manually.`);
        }
        if (row.payee_capacity === 'Partner' && isBlank(row.deed_or_authorisation_reference)) {
          warnings.push(`21(c) row ${index + 1}: Deed or authorisation reference should be entered for partner payments.`);
        }
      });

      getRows(nextStructured, 'clause_21d_rows').forEach((row, index) => {
        const amount = Number(row.amount);
        const inadmissible = Number(row.amount_inadmissible);

        if (row.mode_of_payment === 'Cash' && row.whether_covered_by_rule_6dd !== 'yes') {
          warnings.push(`21(d) row ${index + 1}: Cash payment should be reviewed for Rule 6DD coverage.`);
        }
        if (
          !isBlank(row.amount) &&
          !isBlank(row.amount_inadmissible) &&
          Number.isFinite(amount) &&
          Number.isFinite(inadmissible) &&
          inadmissible > amount
        ) {
          warnings.push(`21(d) row ${index + 1}: Amount inadmissible exceeds payment amount. Review manually.`);
        }
      });

      getRows(nextStructured, 'clause_21e_rows').forEach((row, index) => {
        if (row.basis === 'Provision only' && isBlank(row.amount_inadmissible)) {
          warnings.push(`21(e) row ${index + 1}: Amount inadmissible should be entered when basis is Provision only.`);
        }
      });

      getRows(nextStructured, 'clause_21f_rows').forEach((row, index) => {
        if (row.statutory_or_approved_basis === 'Not approved' && isBlank(row.amount_inadmissible)) {
          warnings.push(`21(f) row ${index + 1}: Amount inadmissible should be entered when basis is Not approved.`);
        }
      });

      getRows(nextStructured, 'clause_21g_rows').forEach((row, index) => {
        if (row.accounting_treatment === 'Debited to profit and loss account' && isBlank(row.amount)) {
          warnings.push(`21(g) row ${index + 1}: Amount should be entered when liability is debited to P&L.`);
        }
      });

      getRows(nextStructured, 'clause_21h_rows').forEach((row, index) => {
        if (!isBlank(row.exempt_income_amount) && isBlank(row.amount_inadmissible_under_14a)) {
          warnings.push(`21(h) row ${index + 1}: Amount inadmissible under section 14A should be reviewed when exempt income is entered.`);
        }
      });

      getRows(nextStructured, 'clause_21i_rows').forEach((row, index) => {
        if (!isBlank(row.interest_amount_debited) && isBlank(row.amount_inadmissible)) {
          warnings.push(`21(i) row ${index + 1}: Amount inadmissible should be reviewed when interest debited is entered.`);
        }
      });

    }

    if (schema.clauseKey === 'clause_22') {
      getRows(nextStructured, 'clause_22i_interest_rows').forEach((row, index) => {
        const interest = Number(row.amount_of_interest_paid_or_payable);
        const inadmissible = Number(row.amount_inadmissible_under_section_23);

        if (row.enterprise_type === 'Medium' && !isBlank(row.amount_inadmissible_under_section_23)) {
          warnings.push(`22(i) row ${index + 1}: Medium enterprise selected with MSMED section 23 inadmissible amount. Review applicability manually.`);
        }
        if (
          !isBlank(row.amount_of_interest_paid_or_payable) &&
          !isBlank(row.amount_inadmissible_under_section_23) &&
          Number.isFinite(interest) &&
          Number.isFinite(inadmissible) &&
          inadmissible > interest
        ) {
          warnings.push(`22(i) row ${index + 1}: Amount inadmissible exceeds interest paid or payable.`);
        }
      });

      getRows(nextStructured, 'clause_22ii_mse_payable_rows').forEach((row, index) => {
        if (row.enterprise_type === 'Medium') {
          warnings.push(`22(ii) row ${index + 1}: Clause 22(ii) is intended for micro and small enterprises. Review Medium classification.`);
        }
        if (row.enterprise_type === 'Not available' || row.enterprise_type === 'To be reviewed') {
          warnings.push(`22(ii) row ${index + 1}: Enterprise type should be confirmed for MSMED reporting.`);
        }
      });

      getRows(nextStructured, 'clause_22iii_payment_status_rows').forEach((row, index) => {
        const actualDate = typeof row.actual_payment_date === 'string' ? row.actual_payment_date : '';
        const dueDate = typeof row.due_date_under_section_15 === 'string' ? row.due_date_under_section_15 : '';
        const referredAmount = Number(row.amount_referred_to_in_22ii);
        const paidWithinTime = Number(row.amount_paid_within_time_under_section_15);
        const notPaidWithinTime = Number(row.amount_not_paid_within_time_under_section_15);

        if (actualDate && dueDate && isValidDateInput(actualDate) && isValidDateInput(dueDate) && actualDate > dueDate) {
          warnings.push(`22(iii) row ${index + 1}: Actual payment date is after the section 15 due date.`);
        }
        if (
          !isBlank(row.amount_referred_to_in_22ii) &&
          Number.isFinite(referredAmount) &&
          Number.isFinite(paidWithinTime) &&
          Number.isFinite(notPaidWithinTime) &&
          paidWithinTime + notPaidWithinTime > referredAmount
        ) {
          warnings.push(`22(iii) row ${index + 1}: Paid and unpaid amounts exceed the amount referred to in 22(ii).`);
        }
        if (!isBlank(row.amount_inadmissible_for_previous_year) && row.whether_claimed_as_deduction === 'No') {
          warnings.push(`22(iii) row ${index + 1}: Inadmissible amount entered though deduction is marked No. Review manually.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_23') {
      getRows(nextStructured, 'clause_23_rows').forEach((row, index) => {
        if (!isBlank(row.specified_person_name) && isBlank(row.amount_paid_or_payable)) {
          warnings.push(`Clause 23 row ${index + 1}: Amount should be entered when specified person name is captured.`);
        }
        if (row.auditor_view === 'Excessive or unreasonable' && isBlank(row.remarks)) {
          warnings.push(`Clause 23 row ${index + 1}: Remarks should be entered when auditor view is excessive or unreasonable.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_24') {
      getRows(nextStructured, 'clause_24_rows').forEach((row, index) => {
        if (!isBlank(row.section) && isBlank(row.amount)) {
          warnings.push(`Clause 24 row ${index + 1}: Amount should be entered when section is selected.`);
        }
        if (!isBlank(row.amount) && isBlank(row.computation_or_basis)) {
          warnings.push(`Clause 24 row ${index + 1}: Computation or basis should be entered when amount is captured.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_25') {
      getRows(nextStructured, 'clause_25_rows').forEach((row, index) => {
        if (!isBlank(row.amount_chargeable) && isBlank(row.computation_or_basis)) {
          warnings.push(`Clause 25 row ${index + 1}: Computation or basis should be entered when amount chargeable is captured.`);
        }
        if (!isBlank(row.section_41_reference) && isBlank(row.nature_of_liability_or_asset)) {
          warnings.push(`Clause 25 row ${index + 1}: Nature of liability or asset should be entered when section 41 reference is selected.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_26') {
      getRows(nextStructured, 'clause_26ia_opening_liability_rows').forEach((row, index) => {
        const outstanding = Number(row.amount_outstanding_on_first_day_of_previous_year);
        const paid = Number(row.amount_paid_during_previous_year);
        const remaining = Number(row.amount_remaining_unpaid_on_last_day_of_previous_year);
        const hasOutstandingSplit =
          !isBlank(row.amount_outstanding_on_first_day_of_previous_year) &&
          !isBlank(row.amount_paid_during_previous_year) &&
          !isBlank(row.amount_remaining_unpaid_on_last_day_of_previous_year);

        if (hasOutstandingSplit && Number.isFinite(outstanding) && Number.isFinite(paid) && Number.isFinite(remaining)) {
          if (paid + remaining > outstanding) {
            warnings.push(`26(i)(A) row ${index + 1}: Paid amount plus remaining unpaid amount exceeds opening outstanding amount.`);
          }
        }
        if (!isBlank(row.amount_paid_during_previous_year) && isBlank(row.date_of_payment)) {
          warnings.push(`26(i)(A) row ${index + 1}: Date of payment should be entered when paid amount is captured.`);
        }
        if (row.section_43b_category === '43B(h) Micro or small enterprise payable, to be reviewed with Clause 22') {
          warnings.push(`26(i)(A) row ${index + 1}: Cross-check micro or small enterprise payable with Clause 22.`);
        }
      });

      getRows(nextStructured, 'clause_26ib_current_year_liability_rows').forEach((row, index) => {
        const incurred = Number(row.amount_incurred_during_previous_year);
        const paidWithinDueDate = Number(row.amount_paid_on_or_before_due_date_under_section_139_1);
        const notPaidWithinDueDate = Number(row.amount_not_paid_on_or_before_due_date_under_section_139_1);
        const dueDate = typeof row.due_date_under_section_139_1 === 'string' ? row.due_date_under_section_139_1 : '';
        const actualDate = typeof row.actual_payment_date === 'string' ? row.actual_payment_date : '';
        const hasCurrentYearSplit =
          !isBlank(row.amount_incurred_during_previous_year) &&
          !isBlank(row.amount_paid_on_or_before_due_date_under_section_139_1) &&
          !isBlank(row.amount_not_paid_on_or_before_due_date_under_section_139_1);

        if (
          hasCurrentYearSplit &&
          Number.isFinite(incurred) &&
          Number.isFinite(paidWithinDueDate) &&
          Number.isFinite(notPaidWithinDueDate) &&
          paidWithinDueDate + notPaidWithinDueDate > incurred
        ) {
          warnings.push(`26(i)(B) row ${index + 1}: Paid and unpaid amounts exceed amount incurred during the previous year.`);
        }
        if (
          actualDate &&
          dueDate &&
          isValidDateInput(actualDate) &&
          isValidDateInput(dueDate) &&
          actualDate > dueDate &&
          !isBlank(row.amount_paid_on_or_before_due_date_under_section_139_1) &&
          Number.isFinite(paidWithinDueDate) &&
          paidWithinDueDate > 0
        ) {
          warnings.push(`26(i)(B) row ${index + 1}: Actual payment date is after the section 139(1) due date, but an amount is captured as paid within due date.`);
        }
        if (
          !isBlank(row.amount_not_paid_on_or_before_due_date_under_section_139_1) &&
          isBlank(row.amount_disallowable_or_to_be_reviewed)
        ) {
          warnings.push(`26(i)(B) row ${index + 1}: Disallowable / review amount should be entered when unpaid amount is captured.`);
        }
        if (row.section_43b_category === '43B(h) Micro or small enterprise payable, to be reviewed with Clause 22') {
          warnings.push(`26(i)(B) row ${index + 1}: Cross-check micro or small enterprise payable with Clause 22.`);
        }
      });

      getRows(nextStructured, 'clause_26ii_indirect_tax_rows').forEach((row, index) => {
        if (!isBlank(row.tax_or_levy_type) && isBlank(row.amount_passed_through_profit_and_loss)) {
          warnings.push(`26(ii) row ${index + 1}: Amount should be entered when tax or levy type is selected.`);
        }
        if (row.accounting_treatment === 'Balance sheet only') {
          warnings.push(`26(ii) row ${index + 1}: Verify whether balance sheet only treatment requires reporting under clause 26(ii).`);
        }
      });
    }

    if (schema.clauseKey === 'clause_27') {
      getRows(nextStructured, 'clause_27a_credit_rows').forEach((row, index) => {
        const hasCreditMovement =
          !isBlank(row.credit_availed_during_previous_year) || !isBlank(row.credit_utilised_during_previous_year);
        const hasAnyAmount =
          !isBlank(row.opening_balance) ||
          !isBlank(row.credit_availed_during_previous_year) ||
          !isBlank(row.credit_utilised_during_previous_year) ||
          !isBlank(row.closing_or_outstanding_balance);

        if (hasCreditMovement && isBlank(row.credit_type)) {
          warnings.push(`27(a) row ${index + 1}: Credit type should be selected when availed or utilised amount is captured.`);
        }
        if (row.applicability_view === 'Not applicable after GST' && hasAnyAmount) {
          warnings.push(`27(a) row ${index + 1}: Amounts are captured although applicability is marked not applicable after GST. Review manually.`);
        }
      });

      getRows(nextStructured, 'clause_27b_prior_period_rows').forEach((row, index) => {
        if (!isBlank(row.item_type) && isBlank(row.particulars)) {
          warnings.push(`27(b) row ${index + 1}: Particulars should be entered when item type is selected.`);
        }
        if (!isBlank(row.amount) && isBlank(row.prior_period_to_which_it_relates)) {
          warnings.push(`27(b) row ${index + 1}: Prior period should be entered when amount is captured.`);
        }
        if (
          row.whether_crystallised_during_current_year === 'Yes' &&
          row.auditor_view === 'Reportable as prior period item'
        ) {
          warnings.push(`27(b) row ${index + 1}: Item is marked crystallised during current year but auditor view says reportable as prior period item.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_29a') {
      getRows(nextStructured, 'clause_29a_rows').forEach((row, index) => {
        if (!isBlank(row.amount_forfeited) && isBlank(row.amount_chargeable_under_section_56_2_ix)) {
          warnings.push(`29A row ${index + 1}: Amount chargeable should be entered when forfeited amount is captured.`);
        }
        if (
          row.whether_negotiations_resulted_in_transfer === 'Yes' &&
          !isBlank(row.amount_chargeable_under_section_56_2_ix)
        ) {
          warnings.push(`29A row ${index + 1}: Negotiations are marked as resulting in transfer, but amount chargeable under section 56(2)(ix) is captured.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_29b') {
      getRows(nextStructured, 'clause_29b_money_rows').forEach((row, index) => {
        const amountReceived = Number(row.amount_received);
        const considerationPaid = Number(row.consideration_paid_if_any);
        const hasDifferenceReview =
          !isBlank(row.amount_received) &&
          !isBlank(row.consideration_paid_if_any) &&
          Number.isFinite(amountReceived) &&
          Number.isFinite(considerationPaid) &&
          amountReceived > considerationPaid;

        if (hasDifferenceReview && isBlank(row.amount_chargeable_under_section_56_2_x)) {
          warnings.push(`29B(a) row ${index + 1}: Amount chargeable should be reviewed when amount received exceeds consideration paid.`);
        }
        if (
          row.exception_or_exemption_claimed === 'None' &&
          hasDifferenceReview &&
          isBlank(row.amount_chargeable_under_section_56_2_x)
        ) {
          warnings.push(`29B(a) row ${index + 1}: No exception is claimed and value difference exists. Review amount chargeable manually.`);
        }
      });

      getRows(nextStructured, 'clause_29b_immovable_property_rows').forEach((row, index) => {
        const stampDutyValue = Number(row.stamp_duty_value);
        const considerationPaid = Number(row.consideration_paid);
        const hasValueDifference =
          !isBlank(row.stamp_duty_value) &&
          !isBlank(row.consideration_paid) &&
          Number.isFinite(stampDutyValue) &&
          Number.isFinite(considerationPaid) &&
          stampDutyValue > considerationPaid;

        if (hasValueDifference && isBlank(row.difference_or_amount_chargeable)) {
          warnings.push(`29B(b) row ${index + 1}: Difference or amount chargeable should be entered when stamp duty value exceeds consideration.`);
        }
        if (
          row.exception_or_exemption_claimed === 'None' &&
          hasValueDifference &&
          isBlank(row.difference_or_amount_chargeable)
        ) {
          warnings.push(`29B(b) row ${index + 1}: No exception is claimed and value difference exists. Review chargeability manually.`);
        }
      });

      getRows(nextStructured, 'clause_29b_other_property_rows').forEach((row, index) => {
        const fairMarketValue = Number(row.fair_market_value);
        const considerationPaid = Number(row.consideration_paid);
        const hasValueDifference =
          !isBlank(row.fair_market_value) &&
          !isBlank(row.consideration_paid) &&
          Number.isFinite(fairMarketValue) &&
          Number.isFinite(considerationPaid) &&
          fairMarketValue > considerationPaid;

        if (hasValueDifference && isBlank(row.difference_or_amount_chargeable)) {
          warnings.push(`29B(c) row ${index + 1}: Difference or amount chargeable should be entered when fair market value exceeds consideration.`);
        }
        if (
          row.exception_or_exemption_claimed === 'None' &&
          hasValueDifference &&
          isBlank(row.difference_or_amount_chargeable)
        ) {
          warnings.push(`29B(c) row ${index + 1}: No exception is claimed and value difference exists. Review chargeability manually.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_30') {
      getRows(nextStructured, 'clause_30_hundi_rows').forEach((row, index) => {
        const hasAnyAmount =
          !isBlank(row.amount_borrowed) || !isBlank(row.amount_repaid) || !isBlank(row.interest_amount);

        if (
          (row.mode_of_payment_or_repayment === 'Cash' || row.mode_of_payment_or_repayment === 'Bearer cheque') &&
          row.whether_otherwise_than_account_payee_cheque !== 'Yes'
        ) {
          warnings.push(`30 row ${index + 1}: Cash or bearer cheque mode should usually be marked as otherwise than account payee cheque.`);
        }
        if (row.whether_otherwise_than_account_payee_cheque === 'Yes' && !hasAnyAmount) {
          warnings.push(`30 row ${index + 1}: Amount should be entered when the transaction is marked otherwise than account payee cheque.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_30a') {
      getRows(nextStructured, 'clause_30a_primary_adjustment_rows').forEach((row, index) => {
        if (!isBlank(row.amount_of_primary_adjustment) && isBlank(row.basis_of_primary_adjustment)) {
          warnings.push(`30A row ${index + 1}: Basis of primary adjustment should be selected when amount of primary adjustment is captured.`);
        }
        if (row.whether_repatriation_required === 'Yes' && isBlank(row.prescribed_repatriation_due_date)) {
          warnings.push(`30A row ${index + 1}: Prescribed repatriation due date should be entered when repatriation is required.`);
        }
        if (row.whether_repatriation_required === 'Yes' && isBlank(row.amount_repatriated)) {
          warnings.push(`30A row ${index + 1}: Amount repatriated should be entered when repatriation is required.`);
        }
        if (!isBlank(row.balance_not_repatriated) && isBlank(row.imputed_interest_income)) {
          warnings.push(`30A row ${index + 1}: Imputed interest income should be reviewed when balance not repatriated is captured.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_30b') {
      getRows(nextStructured, 'clause_30b_summary_rows').forEach((row, index) => {
        const aggregateInterest = Number(row.aggregate_interest_or_similar_expenditure);

        if (
          !isBlank(row.aggregate_interest_or_similar_expenditure) &&
          Number.isFinite(aggregateInterest) &&
          aggregateInterest > 10000000 &&
          row.threshold_of_one_crore_exceeded !== 'Yes'
        ) {
          warnings.push(`30B(b) row ${index + 1}: Aggregate interest exceeds one crore, but threshold exceeded is not marked Yes.`);
        }
        if (row.threshold_of_one_crore_exceeded === 'Yes' && isBlank(row.ebitda_for_previous_year)) {
          warnings.push(`30B(b) row ${index + 1}: EBITDA should be entered when threshold exceeded is marked Yes.`);
        }
        if (!isBlank(row.excess_interest_expenditure) && isBlank(row.basis_of_computation)) {
          warnings.push(`30B(b) row ${index + 1}: Basis of computation should be entered when excess interest expenditure is captured.`);
        }
        if (!isBlank(row.interest_carried_forward_to_subsequent_years) && isBlank(row.remarks)) {
          warnings.push(`30B(b) row ${index + 1}: Remarks should be entered when interest is carried forward to subsequent years.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_30c') {
      getRows(nextStructured, 'clause_30c_arrangement_rows').forEach((row, index) => {
        if (
          row.whether_impermissible_avoidance_arrangement_identified === 'Yes' &&
          isBlank(row.section_96_condition)
        ) {
          warnings.push(`30C row ${index + 1}: Section 96 condition should be selected when an impermissible avoidance arrangement is identified.`);
        }
        if (
          row.whether_impermissible_avoidance_arrangement_identified === 'Yes' &&
          isBlank(row.amount_of_tax_benefit)
        ) {
          warnings.push(`30C row ${index + 1}: Amount of tax benefit should be entered when an impermissible avoidance arrangement is identified.`);
        }
        if (!isBlank(row.amount_of_tax_benefit) && isBlank(row.reporting_basis)) {
          warnings.push(`30C row ${index + 1}: Reporting basis should be entered when amount of tax benefit is captured.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_31') {
      getRows(nextStructured, 'clause_31a_loan_deposit_rows').forEach((row, index) => {
        const amount = Number(row.amount_of_loan_or_deposit);
        const amountAtThreshold = !isBlank(row.amount_of_loan_or_deposit) && Number.isFinite(amount) && amount >= 20000;

        if (amountAtThreshold && THRESHOLD_REVIEW_MODES.has(String(row.mode_of_acceptance))) {
          warnings.push(`31(a) row ${index + 1}: Amount is 20,000 or more and mode of acceptance requires manual review under section 269SS.`);
        }
        if (amountAtThreshold && row.whether_account_payee_or_prescribed_mode === 'No') {
          warnings.push(`31(a) row ${index + 1}: Amount is 20,000 or more and receipt mode is marked not account payee or prescribed mode.`);
        }
        if (!isBlank(row.lender_or_depositor_name) && isBlank(row.pan_or_aadhaar)) {
          warnings.push(`31(a) row ${index + 1}: PAN or Aadhaar should be entered when lender or depositor name is captured.`);
        }
      });

      getRows(nextStructured, 'clause_31b_specified_sum_rows').forEach((row, index) => {
        const amount = Number(row.amount_of_specified_sum);
        const amountAtThreshold = !isBlank(row.amount_of_specified_sum) && Number.isFinite(amount) && amount >= 20000;

        if (amountAtThreshold && THRESHOLD_REVIEW_MODES.has(String(row.mode_of_acceptance))) {
          warnings.push(`31(b) row ${index + 1}: Amount is 20,000 or more and mode of acceptance requires manual review under section 269SS.`);
        }
        if (amountAtThreshold && row.whether_account_payee_or_prescribed_mode === 'No') {
          warnings.push(`31(b) row ${index + 1}: Amount is 20,000 or more and receipt mode is marked not account payee or prescribed mode.`);
        }
        if (!isBlank(row.payer_name) && isBlank(row.pan_or_aadhaar)) {
          warnings.push(`31(b) row ${index + 1}: PAN or Aadhaar should be entered when payer name is captured.`);
        }
      });

      getRows(nextStructured, 'clause_31ba_receipt_other_than_permitted_mode_rows').forEach((row, index) => {
        const amount = Number(row.amount_received);
        const amountAtThreshold = !isBlank(row.amount_received) && Number.isFinite(amount) && amount >= 200000;

        if (amountAtThreshold && row.whether_permitted_mode === 'Yes') {
          warnings.push(`31(ba) row ${index + 1}: Amount is 2 lakh or more but receipt is marked as permitted mode. Review manually.`);
        }
        if (amountAtThreshold && isBlank(row.payer_pan_or_aadhaar)) {
          warnings.push(`31(ba) row ${index + 1}: PAN or Aadhaar should be entered when amount received is 2 lakh or more.`);
        }
      });

      getRows(nextStructured, 'clause_31bb_receipt_non_account_payee_rows').forEach((row, index) => {
        const amount = Number(row.amount_received);
        const amountAtThreshold = !isBlank(row.amount_received) && Number.isFinite(amount) && amount >= 200000;

        if (amountAtThreshold && row.whether_account_payee === 'Yes') {
          warnings.push(`31(bb) row ${index + 1}: Amount is 2 lakh or more but instrument is marked account payee. Review manually.`);
        }
        if (row.whether_account_payee === 'Cannot verify') {
          warnings.push(`31(bb) row ${index + 1}: Account payee status cannot be verified. Consider whether an auditor comment is required.`);
        }
      });

      getRows(nextStructured, 'clause_31bc_payment_other_than_permitted_mode_rows').forEach((row, index) => {
        const amount = Number(row.amount_paid);
        const amountAtThreshold = !isBlank(row.amount_paid) && Number.isFinite(amount) && amount >= 200000;

        if (amountAtThreshold && row.whether_permitted_mode === 'Yes') {
          warnings.push(`31(bc) row ${index + 1}: Amount is 2 lakh or more but payment is marked as permitted mode. Review manually.`);
        }
        if (amountAtThreshold && isBlank(row.payee_pan_or_aadhaar)) {
          warnings.push(`31(bc) row ${index + 1}: PAN or Aadhaar should be entered when amount paid is 2 lakh or more.`);
        }
      });

      getRows(nextStructured, 'clause_31bd_payment_non_account_payee_rows').forEach((row, index) => {
        const amount = Number(row.amount_paid);
        const amountAtThreshold = !isBlank(row.amount_paid) && Number.isFinite(amount) && amount >= 200000;

        if (amountAtThreshold && row.whether_account_payee === 'Yes') {
          warnings.push(`31(bd) row ${index + 1}: Amount is 2 lakh or more but instrument is marked account payee. Review manually.`);
        }
        if (row.whether_account_payee === 'Cannot verify') {
          warnings.push(`31(bd) row ${index + 1}: Account payee status cannot be verified. Consider whether an auditor comment is required.`);
        }
      });

      getRows(nextStructured, 'clause_31c_repayment_made_rows').forEach((row, index) => {
        const maximumOutstanding = Number(row.maximum_amount_outstanding_during_year);
        const thresholdReached =
          !isBlank(row.maximum_amount_outstanding_during_year) &&
          Number.isFinite(maximumOutstanding) &&
          maximumOutstanding >= 20000;

        if (thresholdReached && THRESHOLD_REVIEW_MODES.has(String(row.mode_of_repayment))) {
          warnings.push(`31(c) row ${index + 1}: Maximum amount outstanding is 20,000 or more and mode of repayment requires manual review under section 269T.`);
        }
        if (thresholdReached && row.whether_account_payee_if_cheque_or_draft === 'No') {
          warnings.push(`31(c) row ${index + 1}: Maximum amount outstanding is 20,000 or more and cheque or draft is marked non-account payee.`);
        }
        if (!isBlank(row.payee_name) && isBlank(row.payee_pan_or_aadhaar)) {
          warnings.push(`31(c) row ${index + 1}: PAN or Aadhaar should be entered when payee name is captured.`);
        }
        if (
          !isBlank(row.exception_or_excluded_counterparty_status) &&
          row.exception_or_excluded_counterparty_status !== 'No exception claimed' &&
          hasReportingDetails(row, [
            'payee_name',
            'amount_of_repayment',
            'date_of_repayment',
            'mode_of_repayment',
            'maximum_amount_outstanding_during_year',
          ])
        ) {
          warnings.push(`31(c) row ${index + 1}: An exception is selected. Review whether reporting is required for this counterparty.`);
        }
      });

      getRows(nextStructured, 'clause_31d_repayment_received_other_than_permitted_mode_rows').forEach((row, index) => {
        const amountReceived = Number(row.amount_received);
        const thresholdReached = !isBlank(row.amount_received) && Number.isFinite(amountReceived) && amountReceived >= 20000;

        if (
          thresholdReached &&
          [
            'Account payee cheque',
            'Account payee bank draft',
            'Electronic clearing system through bank account',
            'Other prescribed electronic mode',
          ].includes(String(row.mode_of_receipt))
        ) {
          warnings.push(`31(d) row ${index + 1}: Amount received is 20,000 or more but mode of receipt appears to be a permitted banking mode. Review manually.`);
        }
        if (thresholdReached && isBlank(row.payer_pan_or_aadhaar)) {
          warnings.push(`31(d) row ${index + 1}: PAN or Aadhaar should be entered when amount received is 20,000 or more.`);
        }
        if (
          !isBlank(row.exception_or_excluded_counterparty_status) &&
          row.exception_or_excluded_counterparty_status !== 'No exception claimed' &&
          hasReportingDetails(row, [
            'payer_name',
            'amount_received',
            'date_of_receipt',
            'mode_of_receipt',
            'maximum_amount_outstanding_during_year',
          ])
        ) {
          warnings.push(`31(d) row ${index + 1}: An exception is selected. Review whether reporting is required for this counterparty.`);
        }
      });

      getRows(nextStructured, 'clause_31e_repayment_received_non_account_payee_rows').forEach((row, index) => {
        const amountReceived = Number(row.amount_received);
        const thresholdReached = !isBlank(row.amount_received) && Number.isFinite(amountReceived) && amountReceived >= 20000;

        if (thresholdReached && row.whether_account_payee === 'Yes') {
          warnings.push(`31(e) row ${index + 1}: Amount received is 20,000 or more but instrument is marked account payee. Review manually.`);
        }
        if (row.whether_account_payee === 'Cannot verify') {
          warnings.push(`31(e) row ${index + 1}: Account payee status cannot be verified. Consider whether an auditor observation is required.`);
        }
        if (!isBlank(row.payer_name) && isBlank(row.payer_pan_or_aadhaar)) {
          warnings.push(`31(e) row ${index + 1}: PAN or Aadhaar should be entered when payer name is captured.`);
        }
        if (
          !isBlank(row.exception_or_excluded_counterparty_status) &&
          row.exception_or_excluded_counterparty_status !== 'No exception claimed' &&
          hasReportingDetails(row, [
            'payer_name',
            'amount_received',
            'date_of_receipt',
            'instrument_type',
            'maximum_amount_outstanding_during_year',
          ])
        ) {
          warnings.push(`31(e) row ${index + 1}: An exception is selected. Review whether reporting is required for this counterparty.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_32') {
      getRows(nextStructured, 'clause_32a_loss_depreciation_rows').forEach((row, index) => {
        const hasAmount =
          !isBlank(row.amount_as_returned) ||
          !isBlank(row.amount_not_allowed_under_115baa_115bac_115bad_115bae) ||
          !isBlank(row.amount_adjusted_by_withdrawal_of_additional_depreciation) ||
          !isBlank(row.amount_as_assessed) ||
          !isBlank(row.amount_available_for_carry_forward_or_setoff);

        if (hasAmount && isBlank(row.assessment_year)) {
          warnings.push(`32(a) row ${index + 1}: Assessment year should be entered when amount is captured.`);
        }
        if (!isBlank(row.amount_as_assessed) && isBlank(row.reference_to_relevant_order)) {
          warnings.push(`32(a) row ${index + 1}: Reference to relevant order should be entered when amount as assessed is captured.`);
        }
        if (!isBlank(row.amount_available_for_carry_forward_or_setoff) && isBlank(row.remarks)) {
          warnings.push(`32(a) row ${index + 1}: Remarks should be entered when amount available for carry forward or set-off is captured.`);
        }
      });

      getRows(nextStructured, 'clause_32b_shareholding_change_rows').forEach((row, index) => {
        if (
          row.whether_change_in_shareholding_during_previous_year === 'Yes' &&
          isBlank(row.section_79_view)
        ) {
          warnings.push(`32(b) row ${index + 1}: Section 79 view should be entered when change in shareholding is marked Yes.`);
        }
        if (row.section_79_view === 'Exception claimed' && isBlank(row.remarks)) {
          warnings.push(`32(b) row ${index + 1}: Remarks should be entered when section 79 exception is claimed.`);
        }
      });

      getRows(nextStructured, 'clause_32c_speculation_loss_rows').forEach((row, index) => {
        if (!isBlank(row.amount_of_speculation_loss) && isBlank(row.nature_of_speculation_business)) {
          warnings.push(`32(c) row ${index + 1}: Nature of speculation business should be entered when speculation loss is captured.`);
        }
      });

      getRows(nextStructured, 'clause_32d_specified_business_loss_rows').forEach((row, index) => {
        if (!isBlank(row.amount_of_specified_business_loss) && isBlank(row.specified_business_description)) {
          warnings.push(`32(d) row ${index + 1}: Specified business description should be entered when specified business loss is captured.`);
        }
      });

      getRows(nextStructured, 'clause_32e_deemed_speculation_rows').forEach((row, index) => {
        if (row.whether_company === 'Yes' && isBlank(row.whether_deemed_speculation_business)) {
          warnings.push(`32(e) row ${index + 1}: Deemed speculation business view should be entered when whether company is Yes.`);
        }
        if (
          row.whether_deemed_speculation_business === 'Yes' &&
          isBlank(row.basis_for_deemed_speculation_view)
        ) {
          warnings.push(`32(e) row ${index + 1}: Basis for deemed speculation view should be entered when deemed speculation business is marked Yes.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_33') {
      getRows(nextStructured, 'clause_33_deduction_rows').forEach((row, index) => {
        const claimedAmount = Number(row.amount_claimed_by_assessee);
        const admissibleAmount = Number(row.amount_admissible_as_per_act);

        if (!isBlank(row.section) && isBlank(row.amount_admissible_as_per_act)) {
          warnings.push(`33 row ${index + 1}: Amount admissible as per Act should be entered when section is selected.`);
        }
        if (
          !isBlank(row.amount_claimed_by_assessee) &&
          !isBlank(row.amount_admissible_as_per_act) &&
          Number.isFinite(claimedAmount) &&
          Number.isFinite(admissibleAmount) &&
          admissibleAmount > claimedAmount
        ) {
          warnings.push(`33 row ${index + 1}: Amount admissible as per Act exceeds amount claimed by assessee.`);
        }
        if (row.conditions_fulfilled === 'No' && !isBlank(row.amount_admissible_as_per_act)) {
          warnings.push(`33 row ${index + 1}: Conditions are marked No but admissible amount is captured.`);
        }
        if (
          row.whether_restricted_under_special_tax_regime === 'Yes' &&
          !isBlank(row.amount_admissible_as_per_act)
        ) {
          warnings.push(`33 row ${index + 1}: Special tax regime restriction is marked Yes but admissible amount is captured.`);
        }
        if (row.section === 'Other' && isBlank(row.remarks)) {
          warnings.push(`33 row ${index + 1}: Remarks should be entered when section is marked Other.`);
        }
      });
    }

    if (schema.clauseKey === 'clause_34') {
      // Clause 34 remains manual in this phase; warnings only flag obvious completeness issues
      // without attempting any statutory computation or reconciliation across sub-clauses.
      getRows(nextStructured, 'clause_34a_tds_tcs_summary_rows').forEach((row, index) => {
        const totalAmount = toFiniteNumber(row.total_amount_of_payment_or_receipt);
        const requiredAmount = toFiniteNumber(row.amount_on_which_tax_required_to_be_deducted_or_collected);
        const specifiedRateAmount = toFiniteNumber(row.amount_on_which_tax_deducted_or_collected_at_specified_rate) ?? 0;
        const lowerOrNilRateAmount = toFiniteNumber(row.amount_on_which_tax_deducted_or_collected_at_lower_or_nil_rate) ?? 0;
        const notDeductedAmount = toFiniteNumber(row.amount_on_which_tax_not_deducted_or_collected) ?? 0;
        const notDepositedAmount = toFiniteNumber(row.amount_on_which_tax_deducted_or_collected_but_not_deposited) ?? 0;
        const hasAmounts = [
          'total_amount_of_payment_or_receipt',
          'amount_on_which_tax_required_to_be_deducted_or_collected',
          'amount_on_which_tax_deducted_or_collected_at_specified_rate',
          'tax_deducted_or_collected_at_specified_rate',
          'amount_on_which_tax_deducted_or_collected_at_lower_or_nil_rate',
          'tax_deducted_or_collected_at_lower_or_nil_rate',
          'amount_on_which_tax_not_deducted_or_collected',
          'tax_not_deducted_or_collected',
          'amount_on_which_tax_deducted_or_collected_but_not_deposited',
          'tax_deducted_or_collected_but_not_deposited',
        ].some((key) => !isBlank(row[key]));

        if (hasAmounts && isBlank(row.tan)) {
          warnings.push(`34(a) row ${index + 1}: TAN should be entered when amounts are captured.`);
        }
        if (hasAmounts && isBlank(row.section)) {
          warnings.push(`34(a) row ${index + 1}: Section should be entered when amounts are captured.`);
        }
        if (
          totalAmount !== null &&
          requiredAmount !== null &&
          requiredAmount > totalAmount
        ) {
          warnings.push(`34(a) row ${index + 1}: Amount on which tax was required should not exceed total amount of payment or receipt.`);
        }

        const bucketAmountTotal =
          specifiedRateAmount +
          lowerOrNilRateAmount +
          notDeductedAmount +
          notDepositedAmount;

        if (requiredAmount !== null && bucketAmountTotal > requiredAmount) {
          warnings.push(`34(a) row ${index + 1}: Bucket amounts exceed the amount on which tax was required to be deducted or collected.`);
        }
        if (
          !isBlank(row.amount_on_which_tax_deducted_or_collected_at_lower_or_nil_rate) &&
          isBlank(row.lower_or_nil_rate_basis)
        ) {
          warnings.push(`34(a) row ${index + 1}: Lower or nil rate basis should be entered when lower or nil rate amount is captured.`);
        }
        if (
          !isBlank(row.amount_on_which_tax_not_deducted_or_collected) &&
          isBlank(row.reason_or_review_note)
        ) {
          warnings.push(`34(a) row ${index + 1}: Reason or review note should be entered when tax not deducted or collected is captured.`);
        }
        if (
          !isBlank(row.tax_deducted_or_collected_but_not_deposited) &&
          isBlank(row.reason_or_review_note)
        ) {
          warnings.push(`34(a) row ${index + 1}: Reason or review note should be entered when tax deducted or collected but not deposited is captured.`);
        }
      });

      getRows(nextStructured, 'clause_34b_statement_rows').forEach((row, index) => {
        const hasRowData = [
          'tan',
          'tds_or_tcs',
          'type_of_form',
          'quarter_or_period',
          'due_date_for_furnishing',
          'date_of_furnishing',
          'acknowledgment_number_or_token',
          'whether_statement_furnished',
          'whether_statement_contains_all_required_transactions',
          'details_of_transactions_not_reported',
          'reason_for_delay_or_omission',
          'evidence_or_working_reference',
          'remarks',
        ].some((key) => !isBlank(row[key]));
        const dueDate = typeof row.due_date_for_furnishing === 'string' ? row.due_date_for_furnishing : '';
        const furnishingDate = typeof row.date_of_furnishing === 'string' ? row.date_of_furnishing : '';

        if (hasRowData && isBlank(row.tan)) {
          warnings.push(`34(b) row ${index + 1}: TAN should be entered when a row is captured.`);
        }
        if (hasRowData && isBlank(row.type_of_form)) {
          warnings.push(`34(b) row ${index + 1}: Type of form should be entered when a row is captured.`);
        }
        if (row.whether_statement_furnished === 'Yes' && isBlank(row.date_of_furnishing)) {
          warnings.push(`34(b) row ${index + 1}: Date of furnishing should be entered when statement furnished is marked Yes.`);
        }
        if (
          dueDate &&
          furnishingDate &&
          isValidDateInput(dueDate) &&
          isValidDateInput(furnishingDate) &&
          furnishingDate > dueDate
        ) {
          warnings.push(`34(b) row ${index + 1}: Date of furnishing is later than due date for furnishing. Review delay manually.`);
        }
        if (row.whether_statement_furnished === 'No' && isBlank(row.reason_for_delay_or_omission)) {
          warnings.push(`34(b) row ${index + 1}: Reason for delay or omission should be entered when statement furnished is marked No.`);
        }
        if (
          row.whether_statement_contains_all_required_transactions === 'No' &&
          isBlank(row.details_of_transactions_not_reported)
        ) {
          warnings.push(`34(b) row ${index + 1}: Details of transactions not reported should be entered when completeness is marked No.`);
        }
        if (row.whether_statement_contains_all_required_transactions === 'Cannot verify') {
          warnings.push(`34(b) row ${index + 1}: Statement completeness cannot be verified. Consider whether an auditor observation is required.`);
        }
      });

      getRows(nextStructured, 'clause_34c_interest_rows').forEach((row, index) => {
        const payableAmount = toFiniteNumber(row.amount_of_interest_payable);
        const paidAmount = toFiniteNumber(row.amount_of_interest_paid);
        const balanceAmount = toFiniteNumber(row.balance_interest_payable);
        const hasAmounts =
          !isBlank(row.amount_of_interest_payable) ||
          !isBlank(row.amount_of_interest_paid) ||
          !isBlank(row.balance_interest_payable);
        const hasAnyChallanDetail =
          !isBlank(row.challan_bsr_code) ||
          !isBlank(row.challan_serial_number) ||
          !isBlank(row.challan_date);
        const hasIncompleteChallanDetail =
          hasAnyChallanDetail &&
          (isBlank(row.challan_bsr_code) || isBlank(row.challan_serial_number) || isBlank(row.challan_date));

        if (hasAmounts && isBlank(row.tan)) {
          warnings.push(`34(c) row ${index + 1}: TAN should be entered when amount details are captured.`);
        }
        if (hasAmounts && isBlank(row.interest_section)) {
          warnings.push(`34(c) row ${index + 1}: Interest section should be entered when amount details are captured.`);
        }
        if (
          payableAmount !== null &&
          paidAmount !== null &&
          paidAmount > payableAmount
        ) {
          warnings.push(`34(c) row ${index + 1}: Amount of interest paid should not exceed amount of interest payable.`);
        }
        if (!isBlank(row.amount_of_interest_paid) && isBlank(row.date_of_payment)) {
          warnings.push(`34(c) row ${index + 1}: Date of payment should be entered when amount of interest paid is captured.`);
        }
        if (hasIncompleteChallanDetail) {
          warnings.push(`34(c) row ${index + 1}: Challan details are partly entered. Review missing BSR code, serial number or challan date.`);
        }
        if (!isBlank(row.balance_interest_payable) && isBlank(row.remarks)) {
          warnings.push(`34(c) row ${index + 1}: Remarks should be entered when balance interest payable is captured.`);
        }
        if (row.default_type === 'To be reviewed' && hasAmounts) {
          warnings.push(`34(c) row ${index + 1}: Default type is marked To be reviewed while amount details are captured.`);
        }
      });
    }

    return warnings;
  };

  const persistStructured = async (nextStructured: StructuredValues) => {
    const structuredWarnings = buildWarnings(nextStructured);
    const otherMessages = validationMessages.filter((message) => !message.startsWith(STRUCTURED_VALIDATION_PREFIX));
    await onUpdate({
      response_json: JSON.stringify({
        ...parsed,
        structured: nextStructured,
      }),
      validation_messages_json: JSON.stringify([
        ...otherMessages,
        ...structuredWarnings.map((message) => `${STRUCTURED_VALIDATION_PREFIX} ${message}`),
      ]),
      validation_status: structuredWarnings.length > 0 ? 'warning' : clause.validation_status === 'error' ? 'error' : 'valid',
    });
  };

  const updateField = async (key: string, value: StructuredValue) => {
    await persistStructured({
      ...structured,
      [key]: value,
    });
  };

  const localWarnings = buildWarnings(structured);

  const getTableWarnings = (table: TaxAuditStructuredTable, nextStructured: StructuredValues = structured) => {
    const isolatedStructured = tables.reduce<StructuredValues>(
      (result, item) => ({
        ...result,
        [item.key]: item.key === table.key ? getRows(nextStructured, item.key) : [],
      }),
      { ...nextStructured }
    );
    return buildWarnings(isolatedStructured);
  };

  const openRowEditor = (table: TaxAuditStructuredTable, rowIndex: number | null) => {
    const rows = getRows(structured, table.key);
    setRowEditor({
      tableKey: table.key,
      rowIndex,
      draft: rowIndex === null ? createEmptyRow(table) : { ...rows[rowIndex] },
    });
  };

  const updateEditorField = (key: string, value: StructuredValue) => {
    setRowEditor((current) => current ? { ...current, draft: { ...current.draft, [key]: value } } : current);
  };

  const updateRow = async (tableKey: string, rowIndex: number, key: string, value: StructuredValue) => {
    const rows = getRows(structured, tableKey);
    const nextRows = rows.map((row, index) => (index === rowIndex ? { ...row, [key]: value } : row));
    await persistStructured({ ...structured, [tableKey]: nextRows });
  };

  const addRow = async (table: (typeof tables)[number]) => {
    const rows = getRows(structured, table.key);
    await persistStructured({ ...structured, [table.key]: [...rows, createEmptyRow(table)] });
  };

  const removeRow = async (tableKey: string, rowIndex: number) => {
    const rows = getRows(structured, tableKey);
    await persistStructured({
      ...structured,
      [tableKey]: rows.filter((_, index) => index !== rowIndex),
    });
  };

  const saveRowEditor = async () => {
    if (!rowEditor) return;
    const table = tables.find((item) => item.key === rowEditor.tableKey);
    if (!table) return;
    const rows = getRows(structured, table.key);
    const nextRows =
      rowEditor.rowIndex === null
        ? [...rows, rowEditor.draft]
        : rows.map((row, index) => (index === rowEditor.rowIndex ? rowEditor.draft : row));
    await persistStructured({ ...structured, [table.key]: nextRows });
    setRowEditor(null);
  };

  const editorTable = rowEditor ? tables.find((table) => table.key === rowEditor.tableKey) : undefined;
  const editorPreviewRows =
    rowEditor && editorTable
      ? rowEditor.rowIndex === null
        ? [...getRows(structured, editorTable.key), rowEditor.draft]
        : getRows(structured, editorTable.key).map((row, index) => (index === rowEditor.rowIndex ? rowEditor.draft : row))
      : [];
  const editorWarnings =
    rowEditor && editorTable
      ? getTableWarnings(editorTable, { ...structured, [editorTable.key]: editorPreviewRows })
      : [];

  const renderMultiTableWorkbench = () => {
    if (!activeTable) return null;
    const rows = getRows(structured, activeTable.key);
    const activeWarnings = getTableWarnings(activeTable);
    const summaryColumns = getSummaryColumns(activeTable);

    return (
      <div>
        <div className="rounded-md border bg-background">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{activeTable.label}</p>
              {activeTable.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{activeTable.description}</p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={() => openRowEditor(activeTable, null)}
              disabled={disabled}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Row
            </Button>
          </div>

          {activeWarnings.length > 0 && (
            <div className="border-b px-3 py-2">
              <CompactWarnings warnings={activeWarnings} />
            </div>
          )}

          <div className="divide-y">
            {rows.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No rows added for this sub-clause.</div>
            ) : (
              rows.map((row, rowIndex) => (
                <div key={rowIndex} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Row {rowIndex + 1}</div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {summaryColumns.map((column) => (
                        <div key={column.key} className="min-w-0">
                          <p className="truncate text-[11px] text-muted-foreground">{column.label}</p>
                          <p className="truncate text-sm" title={getColumnDisplayValue(column, row)}>
                            {getColumnDisplayValue(column, row)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => openRowEditor(activeTable, rowIndex)}
                      disabled={disabled}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => removeRow(activeTable.key, rowIndex)}
                      disabled={disabled}
                      title="Remove row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-md border bg-muted/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold">Form 3CD Particulars</p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="rounded-sm text-muted-foreground hover:text-foreground" aria-label="About Form 3CD particulars">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                Capture the particulars required for this clause. These details will support review and report preparation.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {!usesTableWorkbench && tables.length === 1 && (
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => addRow(tables[0])} disabled={disabled}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add Row
          </Button>
        )}
      </div>

      <div className="space-y-3 p-3">
        {tables.length <= 1 && localWarnings.length > 0 && (
          <CompactWarnings warnings={localWarnings} />
        )}

        {schema.fields && (
          <div className="grid gap-3 md:grid-cols-2">
            {schema.fields.map((field) => (
              <div key={field.key} className={field.type === 'textarea' ? 'space-y-1 md:col-span-2' : 'space-y-1'}>
                {field.type !== 'checkbox' && (
                  <div className="flex items-center justify-between gap-2">
                    <Label>{field.label}</Label>
                    {field.sourceHint && <span className="text-[10px] text-muted-foreground">Source: {formatSourceHint(field.sourceHint)}</span>}
                  </div>
                )}
                {renderInput({
                  field,
                  value: (structured[field.key] as StructuredValue) ?? (field.type === 'checkbox' ? false : ''),
                  disabled,
                  onChange: (value) => updateField(field.key, value),
                })}
              </div>
            ))}
          </div>
        )}

        {usesTableWorkbench ? renderMultiTableWorkbench() : tables.map((table) => {
          const rows = getRows(structured, table.key);
          return (
            <div key={table.key} className="space-y-2">
              <div className="overflow-x-auto rounded-md border bg-background">
                <div className="border-b bg-muted/20 px-2 py-1.5 text-sm font-medium">{table.label}</div>
                <div
                  className="grid min-w-[720px] gap-2 border-b bg-muted/30 px-2 py-1.5 text-xs font-semibold text-muted-foreground"
                  style={{ gridTemplateColumns: `${table.columns.map((column) => column.width || '1fr').join(' ')} 52px` }}
                >
                  {table.columns.map((column) => (
                    <span key={column.key}>{column.label}</span>
                  ))}
                  <span />
                </div>
                {rows.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No rows added.</div>
                ) : (
                  rows.map((row, rowIndex) => (
                    <div
                      key={rowIndex}
                      className="grid min-w-[720px] items-center gap-2 border-b px-2 py-2"
                      style={{ gridTemplateColumns: `${table.columns.map((column) => column.width || '1fr').join(' ')} 52px` }}
                    >
                      {table.columns.map((column) => (
                        <div key={column.key}>
                          {renderInput({
                            field: column,
                            value: row[column.key] ?? '',
                            disabled,
                            onChange: (value) => updateRow(table.key, rowIndex, column.key, value),
                          })}
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => removeRow(table.key, rowIndex)}
                        disabled={disabled}
                        title="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={Boolean(rowEditor)} onOpenChange={(open) => !open && setRowEditor(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{rowEditor?.rowIndex === null ? 'Add Row' : 'Edit Row'}</DialogTitle>
            <DialogDescription>{editorTable?.label}</DialogDescription>
          </DialogHeader>

          {editorWarnings.length > 0 && (
            <CompactWarnings warnings={editorWarnings} />
          )}

          {rowEditor && editorTable && (
            <div className="grid gap-3 md:grid-cols-2">
              {editorTable.columns.map((column) => (
                <div key={column.key} className={column.type === 'textarea' ? 'space-y-1 md:col-span-2' : 'space-y-1'}>
                  {column.type !== 'checkbox' && <Label>{column.label}</Label>}
                  {renderInput({
                    field: column,
                    value: rowEditor.draft[column.key] ?? '',
                    disabled,
                    onChange: (value) => updateEditorField(column.key, value),
                  })}
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRowEditor(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveRowEditor()} disabled={disabled || !rowEditor}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


