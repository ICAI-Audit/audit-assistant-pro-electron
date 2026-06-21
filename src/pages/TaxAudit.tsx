import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementType } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck,
  FileSpreadsheet,
  Lock,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { StructuredClauseFields } from '@/components/tax-audit/StructuredClauseFields';
import { SourceLinkChip } from '@/components/tax-audit/SourceLinkChip';
import { useEngagement } from '@/contexts/EngagementContext';
import { useTaxAudit } from '@/hooks/useTaxAudit';
import { useEvidenceFiles } from '@/hooks/useEvidenceFiles';
import { FORM_3CD_CLAUSES, FORM_3CD_GROUPS } from '@/data/taxAudit3CDClauses';
import { TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE, TaxAuditStructuredTable } from '@/data/taxAudit3CDFieldSchemas';
import { calculateApplicability, TaxAuditApplicabilityResult } from '@/lib/taxAuditApplicability';
import {
  TaxAuditAcceptanceCheck,
  TaxAuditAcceptanceChecklist,
  TaxAuditAcceptanceChecklistItem,
  TaxAuditAcceptanceStatus,
  TaxAuditChecklistResponse,
  TaxAuditClauseResponse,
  TaxAuditComplianceTracker,
  TaxAuditComplianceWorkflowStatus,
  TaxAuditPrefillStatus,
  TaxAuditReviewStatus,
  TaxAuditSetup,
  TaxAuditSourceLink,
  TaxAuditSummary,
} from '@/types/taxAudit';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  calculateSpecifiedDateFromReturnDueDate,
  calculateUdinUpdateDueDate,
  normalizeTaxAuditComplianceTracker,
  summarizeTaxAuditComplianceTracker,
} from '@/lib/taxAuditComplianceTracker';
import {
  buildTaxAuditReviewSummaryCounts,
  buildTaxAuditReviewSummaryRows,
  TaxAuditReviewDataStatus,
} from '@/lib/taxAuditReviewSummary';

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const statusLabel: Record<TaxAuditPrefillStatus, string> = {
  not_attempted: 'Open',
  auto_filled: 'Auto-filled',
  partially_filled: 'Partial',
  needs_input: 'Needs input',
  source_conflict: 'Conflict',
  outdated_source: 'Outdated',
  manual_override: 'Manual',
};

const reviewLabel: Record<TaxAuditReviewStatus, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  reviewed: 'Reviewed',
  approved: 'Approved',
  locked: 'Locked',
};

const badgeClass = (status: TaxAuditPrefillStatus) =>
  cn(
    'text-[11px]',
    status === 'auto_filled' && 'border-emerald-300 bg-emerald-50 text-emerald-700',
    status === 'partially_filled' && 'border-amber-300 bg-amber-50 text-amber-700',
    status === 'needs_input' && 'border-slate-300 bg-slate-50 text-slate-700',
    status === 'source_conflict' && 'border-red-300 bg-red-50 text-red-700',
    status === 'outdated_source' && 'border-orange-300 bg-orange-50 text-orange-700',
    status === 'manual_override' && 'border-blue-300 bg-blue-50 text-blue-700'
  );

const compactStatusClass = (clause?: TaxAuditClauseResponse) => {
  if (!clause) return 'bg-slate-300';
  if (clause.prefill_status === 'source_conflict' || clause.validation_status === 'error') return 'bg-red-500';
  if (needsAttention(clause)) return 'bg-amber-500';
  if (clause.prefill_status === 'auto_filled') return 'bg-emerald-500';
  if (clause.prefill_status === 'manual_override') return 'bg-blue-500';
  return 'bg-slate-400';
};

const compactStatusLabel = (clause?: TaxAuditClauseResponse) => {
  if (!clause) return 'Open';
  if (clause.prefill_status === 'source_conflict' || clause.validation_status === 'error') return 'Conflict';
  if (needsAttention(clause)) return 'Needs input';
  return statusLabel[clause.prefill_status];
};

const toBool = (value: unknown) => value === true || value === 1 || value === '1';

const numberValue = (value: unknown) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

type ClauseFilter = 'all' | 'attention' | 'evidence' | 'qualified' | 'reviewed';
type ReviewSummaryFilter =
  | 'all'
  | 'not_started'
  | 'needs_attention'
  | 'in_progress'
  | 'prepared'
  | 'reviewed'
  | 'approved'
  | 'has_evidence'
  | 'has_remarks'
  | 'has_qualification';

type SetupClient = {
  pan?: string | null;
  address?: string | null;
};

const ACCEPTANCE_CHECKLIST_VERSION = 1 as const;

const acceptanceStatusLabel: Record<TaxAuditAcceptanceStatus, string> = {
  not_started: 'Acceptance pending',
  in_progress: 'In progress',
  completed: 'Completed',
  issue_noted: 'Issues noted',
  not_accepted: 'Not accepted',
};

const acceptanceStatusBadgeVariant: Record<TaxAuditAcceptanceStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  not_started: 'secondary',
  in_progress: 'outline',
  completed: 'default',
  issue_noted: 'outline',
  not_accepted: 'destructive',
};

const responseLabel: Record<Exclude<TaxAuditChecklistResponse, ''>, string> = {
  yes: 'Yes',
  no: 'No',
  na: 'NA',
};

const applicabilityBadgeVariant: Record<TaxAuditApplicabilityResult, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  Applicable: 'default',
  'Not applicable': 'secondary',
  'Review required': 'outline',
  'Not assessed': 'outline',
};

const complianceStatusLabel: Record<TaxAuditComplianceWorkflowStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  not_applicable: 'Not applicable',
};

const complianceStatusBadgeVariant: Record<TaxAuditComplianceWorkflowStatus, 'default' | 'secondary' | 'outline'> = {
  pending: 'outline',
  completed: 'default',
  not_applicable: 'secondary',
};

const TAX_AUDIT_ACCEPTANCE_SECTIONS: TaxAuditAcceptanceChecklist['sections'] = [
  {
    id: 'auditor_eligibility_288_2',
    title: 'A. Auditor eligibility under section 288(2)',
    items: [
      { id: 'valid_cop', label: 'Whether the signing auditor is a Chartered Accountant holding valid COP.', response: '', remarks: '' },
      { id: 'eligible_accountant_288_2', label: 'Whether the auditor is eligible to act as accountant under section 288(2).', response: '', remarks: '' },
      { id: 'relationship_disqualification', label: 'Whether the auditor is disqualified due to relationship with assessee.', response: '', remarks: '' },
      { id: 'officer_or_employee', label: 'Whether the auditor is an officer or employee of the assessee.', response: '', remarks: '' },
      { id: 'prohibited_interest', label: 'Whether the auditor or relative or partner has prohibited security, interest, indebtedness, guarantee, or business relationship.', response: '', remarks: '' },
      { id: 'fraud_conviction', label: 'Whether the auditor has been convicted by a court for an offence involving fraud and 10 years have not elapsed.', response: '', remarks: '' },
    ],
  },
  {
    id: 'company_audit_eligibility',
    title: 'B. Company audit eligibility where assessee is a company',
    items: [
      { id: 'companies_act_141_3', label: 'Whether the tax auditor is eligible under section 141(3) of the Companies Act, 2013, wherever applicable.', response: '', remarks: '' },
    ],
  },
  {
    id: 'books_internal_audit_restrictions',
    title: 'C. Books and internal audit restrictions',
    items: [
      { id: 'maintains_books', label: 'Whether the auditor or firm is responsible for writing or maintaining books of account of the assessee.', response: '', remarks: '' },
      { id: 'internal_auditor', label: 'Whether the auditor or firm is acting as internal auditor of the assessee.', response: '', remarks: '' },
    ],
  },
  {
    id: 'tax_audit_assignment_limit',
    title: 'D. Tax audit assignment limit',
    items: [
      { id: 'within_prescribed_limit', label: 'Whether the signing member is within the prescribed tax audit limit.', response: '', remarks: '' },
      { id: 'current_count', label: 'Capture current count.', response: '', remarks: '' },
      { id: 'proposed_count', label: 'Capture proposed count after accepting this engagement.', response: '', remarks: '' },
      { id: 'limit_conclusion', label: 'Record whether the audit falls within or outside the limit.', response: '', remarks: '' },
    ],
  },
  {
    id: 'previous_auditor_communication',
    title: 'E. Previous auditor communication',
    items: [
      { id: 'previous_tax_auditor_exists', label: 'Whether previous year tax auditor exists.', response: '', remarks: '' },
      { id: 'previous_auditor_name', label: 'Name of previous auditor.', response: '', remarks: '' },
      { id: 'communication_required', label: 'Whether communication with previous auditor is required.', response: '', remarks: '' },
      { id: 'communication_sent', label: 'Whether communication has been sent.', response: '', remarks: '' },
      { id: 'communication_date', label: 'Date of communication.', response: '', remarks: '' },
      { id: 'non_acceptance_reason_reported', label: 'Whether any professional reason for non-acceptance was reported.', response: '', remarks: '' },
    ],
  },
  {
    id: 'appointment_formalities',
    title: 'F. Appointment and engagement formalities',
    items: [
      { id: 'appointment_letter_obtained', label: 'Whether appointment letter is obtained.', response: '', remarks: '' },
      { id: 'engagement_letter_issued', label: 'Whether engagement letter is issued.', response: '', remarks: '' },
      { id: 'acceptance_letter_issued', label: 'Whether acceptance letter is issued.', response: '', remarks: '' },
      { id: 'tax_audit_register_updated', label: 'Whether tax audit register is updated.', response: '', remarks: '' },
    ],
  },
];

const buildDefaultAcceptanceChecklist = (): TaxAuditAcceptanceChecklist => ({
  version: ACCEPTANCE_CHECKLIST_VERSION,
  sections: TAX_AUDIT_ACCEPTANCE_SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item })),
  })),
});

const normalizeAcceptanceChecklist = (value: string | null | undefined): TaxAuditAcceptanceChecklist => {
  const fallback = buildDefaultAcceptanceChecklist();
  const parsed = parseJson<Partial<TaxAuditAcceptanceChecklist>>(value, fallback);
  const savedSections = Array.isArray(parsed.sections) ? parsed.sections : [];

  return {
    version: ACCEPTANCE_CHECKLIST_VERSION,
    sections: fallback.sections.map((section) => {
      const savedSection = savedSections.find((item) => item.id === section.id);
      const savedItems = Array.isArray(savedSection?.items) ? savedSection.items : [];
      return {
        ...section,
        items: section.items.map((item) => {
          const savedItem = savedItems.find((candidate) => candidate.id === item.id);
          return {
            ...item,
            response: savedItem?.response === 'yes' || savedItem?.response === 'no' || savedItem?.response === 'na' ? savedItem.response : '',
            remarks: typeof savedItem?.remarks === 'string' ? savedItem.remarks : '',
          };
        }),
      };
    }),
  };
};

const allChecklistItemsReviewed = (checklist: TaxAuditAcceptanceChecklist) =>
  checklist.sections.every((section) => section.items.every((item) => item.response === 'yes' || item.response === 'no' || item.response === 'na'));

const needsAttention = (clause?: TaxAuditClauseResponse) =>
  Boolean(
    clause &&
      (clause.prefill_status === 'needs_input' ||
        clause.prefill_status === 'source_conflict' ||
        clause.validation_status === 'warning' ||
        clause.validation_status === 'error' ||
        toBool(clause.qualification_required))
  );

const getStructuredRows = (clause: TaxAuditClauseResponse | undefined, tableKey: string) => {
  if (!clause) return [];
  const responseJson = parseJson<Record<string, unknown>>(clause.response_json, {});
  const structured =
    responseJson.structured && typeof responseJson.structured === 'object' && !Array.isArray(responseJson.structured)
      ? (responseJson.structured as Record<string, unknown>)
      : {};
  return Array.isArray(structured[tableKey]) ? structured[tableKey] : [];
};

const getStructuredTableWarnings = (clause: TaxAuditClauseResponse | undefined, table: TaxAuditStructuredTable) => {
  if (!clause) return [];
  const messages = parseJson<string[]>(clause.validation_messages_json, []);
  const markers = [table.shortLabel, table.label].filter(Boolean) as string[];
  return markers.length > 0
    ? messages.filter((message) => markers.some((marker) => message.includes(marker)))
    : [];
};

const getDefaultStructuredTableKey = (clauseKey: string) => {
  const fieldSchema = TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE.get(clauseKey);
  return fieldSchema?.tables?.[0]?.key || '';
};

const hasRichTextContent = (value: string | null | undefined) => {
  if (!value) return false;
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
};

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: ElementType;
  tone?: 'default' | 'warning' | 'success' | 'info';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        'rounded-md border bg-background p-4 text-left transition-colors',
        onClick && 'hover:bg-muted/40',
        tone === 'warning' && 'border-amber-200 bg-amber-50/60',
        tone === 'success' && 'border-emerald-200 bg-emerald-50/60',
        tone === 'info' && 'border-blue-200 bg-blue-50/50'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
    </button>
  );
}

function ComplianceStatusSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TaxAuditComplianceWorkflowStatus;
  onChange: (value: TaxAuditComplianceWorkflowStatus) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(nextValue: TaxAuditComplianceWorkflowStatus) => onChange(nextValue)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="not_applicable">Not applicable</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ComplianceTrackerCard({
  tracker,
  saving,
  onChange,
  onSave,
}: {
  tracker: TaxAuditComplianceTracker;
  saving: boolean;
  onChange: (updates: Partial<TaxAuditComplianceTracker>) => void;
  onSave: () => Promise<void>;
}) {
  const summary = summarizeTaxAuditComplianceTracker(tracker);
  const badgeVariant = summary.completed ? 'default' : 'outline';

  const updateReturnDueDate = (dueDate: string) => {
    const previousAutoSpecifiedDate = calculateSpecifiedDateFromReturnDueDate(tracker.due_date_for_return);
    const nextAutoSpecifiedDate = calculateSpecifiedDateFromReturnDueDate(dueDate);
    const shouldApplyAutoSpecifiedDate =
      !tracker.specified_date_for_tax_audit_report ||
      tracker.specified_date_for_tax_audit_report === previousAutoSpecifiedDate;

    onChange({
      due_date_for_return: dueDate,
      specified_date_for_tax_audit_report: shouldApplyAutoSpecifiedDate
        ? nextAutoSpecifiedDate
        : tracker.specified_date_for_tax_audit_report,
    });
  };

  const updateUdinGeneratedDate = (generatedDate: string) => {
    onChange({
      udin_generated_date: generatedDate,
      udin_update_due_date: generatedDate ? calculateUdinUpdateDueDate(generatedDate) : '',
    });
  };

  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Specified Date, Filing and UDIN Tracker</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Manual tracker for post-applicability compliance steps. Dates are editable for statutory extensions or engagement-specific facts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={badgeVariant}>{summary.badge}</Badge>
          <Button size="sm" variant="outline" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Tracker'}
          </Button>
        </div>
      </div>

      {summary.warnings.length > 0 && (
        <Alert className="mt-3">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {summary.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-md border bg-muted/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Specified date</p>
            <Badge variant={summary.specifiedDatePending ? 'outline' : 'secondary'}>
              {summary.specifiedDatePending ? 'Pending' : 'Captured'}
            </Badge>
          </div>
          <div className="space-y-1">
            <Label>Due date for return</Label>
            <Input
              type="date"
              value={tracker.due_date_for_return}
              onChange={(event) => updateReturnDueDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Specified date for tax audit report</Label>
            <Input
              type="date"
              value={tracker.specified_date_for_tax_audit_report}
              onChange={(event) => onChange({ specified_date_for_tax_audit_report: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">Default helper calculates one month before the return due date.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={tracker.is_transfer_pricing_applicable}
              onCheckedChange={(checked) => onChange({ is_transfer_pricing_applicable: checked === true })}
            />
            Transfer pricing applicable
          </label>
          <div className="space-y-1">
            <Label>Remarks</Label>
            <Textarea
              value={tracker.remarks}
              onChange={(event) => onChange({ remarks: event.target.value })}
              rows={3}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-md border bg-muted/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Filing workflow</p>
            <Badge variant={summary.filingPending ? 'outline' : 'secondary'}>
              {summary.filingPending ? 'Pending' : 'Completed'}
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <ComplianceStatusSelect
              label="Assigned by client"
              value={tracker.assigned_by_client_on_portal}
              onChange={(value) => onChange({ assigned_by_client_on_portal: value })}
            />
            <ComplianceStatusSelect
              label="Accepted by CA"
              value={tracker.accepted_by_ca_on_portal}
              onChange={(value) => onChange({ accepted_by_ca_on_portal: value })}
            />
            <ComplianceStatusSelect
              label="Form 3CA/3CB uploaded"
              value={tracker.form_3ca_3cb_uploaded}
              onChange={(value) => onChange({ form_3ca_3cb_uploaded: value })}
            />
            <ComplianceStatusSelect
              label="Form 3CD uploaded"
              value={tracker.form_3cd_uploaded}
              onChange={(value) => onChange({ form_3cd_uploaded: value })}
            />
            <ComplianceStatusSelect
              label="Financial statements uploaded"
              value={tracker.financial_statements_uploaded}
              onChange={(value) => onChange({ financial_statements_uploaded: value })}
            />
            <ComplianceStatusSelect
              label="Client accepted report"
              value={tracker.client_accepted_uploaded_report}
              onChange={(value) => onChange({ client_accepted_uploaded_report: value })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Acknowledgement reference</Label>
              <Input
                value={tracker.acknowledgement_reference}
                onChange={(event) => onChange({ acknowledgement_reference: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Acknowledgement date</Label>
              <Input
                type="date"
                value={tracker.acknowledgement_date}
                onChange={(event) => onChange({ acknowledgement_date: event.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border bg-muted/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">UDIN</p>
            <Badge variant={summary.udinPending ? 'outline' : 'secondary'}>
              {summary.udinPending ? 'Pending' : 'Completed'}
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <ComplianceStatusSelect
              label="UDIN required"
              value={tracker.udin_required}
              onChange={(value) => onChange({ udin_required: value })}
            />
            <ComplianceStatusSelect
              label="UDIN generated"
              value={tracker.udin_generated}
              onChange={(value) => onChange({ udin_generated: value })}
            />
            <ComplianceStatusSelect
              label="Updated on IT portal"
              value={tracker.udin_updated_on_income_tax_portal}
              onChange={(value) => onChange({ udin_updated_on_income_tax_portal: value })}
            />
            <div className="space-y-1">
              <Label>UDIN number</Label>
              <Input
                value={tracker.udin_number}
                onChange={(event) => onChange({ udin_number: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>UDIN generated date</Label>
              <Input
                type="date"
                value={tracker.udin_generated_date}
                onChange={(event) => updateUdinGeneratedDate(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>UDIN update due date</Label>
              <Input
                type="date"
                value={tracker.udin_update_due_date}
                onChange={(event) => onChange({ udin_update_due_date: event.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>UDIN remarks</Label>
            <Textarea
              value={tracker.udin_remarks}
              onChange={(event) => onChange({ udin_remarks: event.target.value })}
              rows={3}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['udin_required', 'udin_generated', 'udin_updated_on_income_tax_portal'] as const).map((field) => (
              <Badge key={field} variant={complianceStatusBadgeVariant[tracker[field]]}>
                {complianceStatusLabel[tracker[field]]}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupPanel({
  setup,
  saving,
  onSave,
  client,
}: {
  setup: TaxAuditSetup;
  saving: boolean;
  onSave: (updates: Partial<TaxAuditSetup>) => Promise<unknown>;
  client: SetupClient | null;
}) {
  const [draft, setDraft] = useState<TaxAuditSetup>(setup);

  useEffect(() => {
    setDraft(setup);
  }, [setup]);

  // Auto-populate PAN and Address from client master
  useEffect(() => {
    if (client) {
      setDraft((prev) => ({
        ...prev,
        pan: client.pan || prev.pan,
        address: client.address || prev.address,
      }));
    }
  }, [client]);

  const selectedReportForm = draft.form_type || (toBool(draft.books_audited_under_other_law) ? '3CA' : '3CB');
  const auditedUnderOtherLaw = selectedReportForm === '3CA' || toBool(draft.books_audited_under_other_law);
  const setupJson = parseJson<Record<string, unknown>>(draft.setup_json, {});
  const savedApplicabilityInputs =
    setupJson.applicabilityInputs && typeof setupJson.applicabilityInputs === 'object'
      ? (setupJson.applicabilityInputs as Record<string, unknown>)
      : {};
  const hasStoredActivityProfile =
    savedApplicabilityInputs.has_business_activity !== undefined || savedApplicabilityInputs.has_professional_activity !== undefined;
  const hasBusinessActivity = hasStoredActivityProfile
    ? toBool(savedApplicabilityInputs.has_business_activity)
    : (draft.business_or_profession || 'business') === 'business';
  const hasProfessionalActivity = hasStoredActivityProfile
    ? toBool(savedApplicabilityInputs.has_professional_activity)
    : draft.business_or_profession === 'profession';
  const businessTurnover = numberValue(savedApplicabilityInputs.business_turnover ?? draft.turnover);
  const professionalGrossReceipts = numberValue(savedApplicabilityInputs.professional_gross_receipts ?? draft.gross_receipts);
  const applicability = calculateApplicability({
    ...draft,
    has_business_activity: hasBusinessActivity,
    has_professional_activity: hasProfessionalActivity,
    business_turnover: businessTurnover,
    professional_gross_receipts: professionalGrossReceipts,
    form_type: selectedReportForm,
    books_audited_under_other_law: auditedUnderOtherLaw ? 1 : 0,
  });

  const updateDraft = (updates: Partial<TaxAuditSetup>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  };

  const updateApplicabilityInputs = (updates: Record<string, unknown>) => {
    setDraft((prev) => {
      const prevJson = parseJson<Record<string, unknown>>(prev.setup_json, {});
      const prevInputs =
        prevJson.applicabilityInputs && typeof prevJson.applicabilityInputs === 'object'
          ? (prevJson.applicabilityInputs as Record<string, unknown>)
          : {};
      const nextInputs = { ...prevInputs, ...updates };
      return {
        ...prev,
        setup_json: JSON.stringify({
          ...prevJson,
          applicabilityInputs: nextInputs,
        }),
      };
    });
  };

  const save = async () => {
    const nextSetupJson = JSON.stringify({
      ...setupJson,
      applicabilityInputs: {
        has_business_activity: hasBusinessActivity,
        has_professional_activity: hasProfessionalActivity,
        business_turnover: businessTurnover,
        professional_gross_receipts: professionalGrossReceipts,
      },
    });
    await onSave({
      assessee_name: draft.assessee_name,
      pan: draft.pan,
      address: draft.address,
      status: draft.status,
      business_or_profession: draft.business_or_profession,
      nature_of_business: draft.nature_of_business,
      form_type: selectedReportForm,
      books_audited_under_other_law: auditedUnderOtherLaw ? 1 : 0,
      other_law_name: draft.other_law_name,
      turnover: businessTurnover,
      gross_receipts: professionalGrossReceipts,
      cash_receipts_percent: numberValue(draft.cash_receipts_percent),
      cash_payments_percent: numberValue(draft.cash_payments_percent),
      presumptive_taxation: draft.presumptive_taxation,
      lower_than_presumptive: draft.lower_than_presumptive,
      setup_json: nextSetupJson,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
        <div>
          <p className="text-sm font-semibold">Setup and Applicability</p>
          <p className="text-xs text-muted-foreground">Maintain assessee profile, activity thresholds, report form and applicability conclusion.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Form {selectedReportForm} + 3CD</Badge>
          <Badge variant={applicabilityBadgeVariant[applicability.overall.result]}>
            {applicability.overall.result}
          </Badge>
          <Button size="sm" variant="outline" onClick={save} disabled={saving}>
            Recalculate Applicability
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save Setup'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Assessee Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label>Assessee</Label>
                <Input value={draft.assessee_name || ''} onChange={(e) => updateDraft({ assessee_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>PAN</Label>
                <Input
                  value={draft.pan || ''}
                  readOnly
                  className="bg-muted cursor-not-allowed"
                  title="Auto-populated from Client Master"
                />
                <p className="text-xs text-muted-foreground">From Client Master</p>
              </div>
              <div className="space-y-1">
                <Label>Assessment Year</Label>
                <Input value={draft.assessment_year || ''} disabled />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Input value={draft.status || ''} onChange={(e) => updateDraft({ status: e.target.value })} />
              </div>
              <div className="space-y-1 md:col-span-3">
                <Label>Address</Label>
                <Input
                  value={draft.address || ''}
                  readOnly
                  className="bg-muted cursor-not-allowed"
                  title="Auto-populated from Client Master"
                />
                <p className="text-xs text-muted-foreground">From Client Master</p>
              </div>
              <div className="space-y-1">
                <Label>Nature</Label>
                <Input value={draft.nature_of_business || ''} onChange={(e) => updateDraft({ nature_of_business: e.target.value })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity and Thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Activity Profile</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={hasBusinessActivity}
                      onCheckedChange={(checked) => {
                        updateDraft({ business_or_profession: checked === true ? 'business' : hasProfessionalActivity ? 'profession' : draft.business_or_profession });
                        updateApplicabilityInputs({ has_business_activity: checked === true });
                      }}
                    />
                    Business activity
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={hasProfessionalActivity}
                      onCheckedChange={(checked) => {
                        updateDraft({ business_or_profession: checked === true && !hasBusinessActivity ? 'profession' : draft.business_or_profession });
                        updateApplicabilityInputs({ has_professional_activity: checked === true });
                      }}
                    />
                    Professional activity
                  </label>
                </div>
                {hasBusinessActivity && (
                  <div className="space-y-1">
                    <Label>Business Turnover</Label>
                    <Input
                      type="number"
                      value={businessTurnover}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        updateDraft({ turnover: value });
                        updateApplicabilityInputs({ business_turnover: value });
                      }}
                    />
                  </div>
                )}
                {hasProfessionalActivity && (
                  <div className="space-y-1">
                    <Label>Professional Gross Receipts</Label>
                    <Input
                      type="number"
                      value={professionalGrossReceipts}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        updateDraft({ gross_receipts: value });
                        updateApplicabilityInputs({ professional_gross_receipts: value });
                      }}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Cash Receipts %</Label>
                  <Input type="number" value={draft.cash_receipts_percent ?? 0} onChange={(e) => updateDraft({ cash_receipts_percent: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label>Cash Payments %</Label>
                  <Input type="number" value={draft.cash_payments_percent ?? 0} onChange={(e) => updateDraft({ cash_payments_percent: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={toBool(draft.presumptive_taxation)}
                    onCheckedChange={(checked) => updateDraft({ presumptive_taxation: checked === true ? 1 : 0 })}
                  />
                  Presumptive taxation opted
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={toBool(draft.lower_than_presumptive)}
                    onCheckedChange={(checked) => updateDraft({ lower_than_presumptive: checked === true ? 1 : 0 })}
                  />
                  Income lower than presumptive threshold
                </label>
                <div className="text-xs text-muted-foreground">
                  {draft.applicability_reason || 'Save setup to evaluate applicability.'}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Audit Report Selection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label>Tax Audit Report</Label>
                  <Select
                    value={selectedReportForm}
                    onValueChange={(value: '3CA' | '3CB') => {
                      updateDraft({
                        form_type: value,
                        books_audited_under_other_law: value === '3CA' ? 1 : 0,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3CA">Form 3CA - audited under other law</SelectItem>
                      <SelectItem value="3CB">Form 3CB - tax audit only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 pt-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={auditedUnderOtherLaw}
                      onCheckedChange={(checked) =>
                        updateDraft({
                          form_type: checked === true ? '3CA' : '3CB',
                          books_audited_under_other_law: checked === true ? 1 : 0,
                        })
                      }
                    />
                    Audited under other law
                  </label>
                </div>
                {auditedUnderOtherLaw && (
                  <div className="space-y-1">
                    <Label>Other law</Label>
                    <Input
                      value={draft.other_law_name || ''}
                      onChange={(e) => updateDraft({ other_law_name: e.target.value })}
                      placeholder="e.g. Companies Act, 2013"
                    />
                  </div>
                )}
              </div>
              {auditedUnderOtherLaw && (
                <p className="text-xs text-muted-foreground">
                  Form 3CA is used where accounts are audited under another law. For companies, this is usually the Companies Act audit.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-base">Applicability Result</CardTitle>
              <Badge variant={applicabilityBadgeVariant[applicability.overall.result]}>{applicability.overall.result}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{applicability.overall.reason}</p>
            <div className="grid gap-3 text-sm sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">Business</p>
                <p className="font-medium">{applicability.business.result || '-'}</p>
                <p className="text-xs text-muted-foreground">
                  {applicability.business.thresholdApplied || '-'} {applicability.business.sectionReference ? `| ${applicability.business.sectionReference}` : ''}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">Profession</p>
                <p className="font-medium">{applicability.profession.result || '-'}</p>
                <p className="text-xs text-muted-foreground">
                  {applicability.profession.thresholdApplied || '-'} {applicability.profession.sectionReference ? `| ${applicability.profession.sectionReference}` : ''}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">Recommended form</p>
                <p className="font-medium">{applicability.suggestedFormType || '-'}</p>
              </div>
            </div>
            {applicability.warnings.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                {applicability.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-amber-700">
                    {warning}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ComplianceTrackerPanel({
  setup,
  saving,
  onSave,
}: {
  setup: TaxAuditSetup;
  saving: boolean;
  onSave: (updates: Partial<TaxAuditSetup>) => Promise<unknown>;
}) {
  const [draftSetupJson, setDraftSetupJson] = useState(setup.setup_json || '{}');

  useEffect(() => {
    setDraftSetupJson(setup.setup_json || '{}');
  }, [setup.setup_json]);

  const setupJson = parseJson<Record<string, unknown>>(draftSetupJson, {});
  const complianceTracker = normalizeTaxAuditComplianceTracker(setupJson.complianceTracker);

  const updateComplianceTracker = (updates: Partial<TaxAuditComplianceTracker>) => {
    setDraftSetupJson((prev) => {
      const prevJson = parseJson<Record<string, unknown>>(prev, {});
      const prevTracker = normalizeTaxAuditComplianceTracker(prevJson.complianceTracker);
      return JSON.stringify({
        ...prevJson,
        complianceTracker: {
          ...prevTracker,
          ...updates,
        },
      });
    });
  };

  const saveComplianceTracker = async () => {
    await onSave({
      setup_json: JSON.stringify({
        ...setupJson,
        complianceTracker,
      }),
    });
  };

  return (
    <ComplianceTrackerCard
      tracker={complianceTracker}
      saving={saving}
      onChange={updateComplianceTracker}
      onSave={saveComplianceTracker}
    />
  );
}

function ClauseNavigator({
  selectedKey,
  selectedStructuredTableKey,
  clausesByKey,
  evidenceLinks,
  onSelect,
}: {
  selectedKey: string;
  selectedStructuredTableKey?: string;
  clausesByKey: Map<string, TaxAuditClauseResponse>;
  evidenceLinks: ReturnType<typeof useTaxAudit>['evidenceLinks'];
  onSelect: (key: string, tableKey?: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClauseFilter>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const evidenceClauseIds = useMemo(
    () => new Set(evidenceLinks.map((link) => link.clause_response_id)),
    [evidenceLinks]
  );

  const clauseMatchesFilter = (definition: (typeof FORM_3CD_CLAUSES)[number]) => {
    const clause = clausesByKey.get(definition.key);
    if (filter === 'attention') return needsAttention(clause);
    if (filter === 'evidence') return Boolean(clause && evidenceClauseIds.has(clause.id));
    if (filter === 'qualified') return toBool(clause?.qualification_required);
    if (filter === 'reviewed') return clause?.review_status === 'reviewed' || clause?.review_status === 'approved';
    return true;
  };

  const searchTerm = search.trim().toLowerCase();
  const visibleClauses = FORM_3CD_CLAUSES.filter((definition) => {
    const fieldSchema = TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE.get(definition.key);
    const matchesSearch =
      !searchTerm ||
      definition.clauseNo.toLowerCase().includes(searchTerm) ||
      definition.title.toLowerCase().includes(searchTerm) ||
      definition.group.toLowerCase().includes(searchTerm) ||
      Boolean(fieldSchema?.tables?.some((table) => table.label.toLowerCase().includes(searchTerm) || table.shortLabel?.toLowerCase().includes(searchTerm)));
    return matchesSearch && clauseMatchesFilter(definition);
  });

  const filterItems: Array<{ key: ClauseFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: FORM_3CD_CLAUSES.length },
    {
      key: 'attention',
      label: 'Attention',
      count: FORM_3CD_CLAUSES.filter((definition) => needsAttention(clausesByKey.get(definition.key))).length,
    },
    {
      key: 'evidence',
      label: 'Evidence',
      count: FORM_3CD_CLAUSES.filter((definition) => {
        const clause = clausesByKey.get(definition.key);
        return Boolean(clause && evidenceClauseIds.has(clause.id));
      }).length,
    },
    {
      key: 'qualified',
      label: 'Remarks',
      count: FORM_3CD_CLAUSES.filter((definition) => toBool(clausesByKey.get(definition.key)?.qualification_required)).length,
    },
    {
      key: 'reviewed',
      label: 'Reviewed',
      count: FORM_3CD_CLAUSES.filter((definition) => {
        const clause = clausesByKey.get(definition.key);
        return clause?.review_status === 'reviewed' || clause?.review_status === 'approved';
      }).length,
    },
  ];

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  return (
    <div className="h-full overflow-hidden rounded-md border bg-background">
      <div className="space-y-2 border-b bg-background p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Form 3CD Clauses</p>
            <p className="text-xs text-muted-foreground">{visibleClauses.length} visible</p>
          </div>
          <Badge variant="outline">{FORM_3CD_CLAUSES.length}</Badge>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clause"
            className="h-8 pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {filterItems.map((item) => (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant={filter === item.key ? 'default' : 'outline'}
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span className="text-[10px] opacity-75">{item.count}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="h-[calc(100%-116px)] overflow-y-auto divide-y">
        {FORM_3CD_GROUPS.map((group) => {
          const groupClauses = visibleClauses.filter((clause) => clause.group === group);
          const allGroupClauses = FORM_3CD_CLAUSES.filter((clause) => clause.group === group);
          const pendingCount = allGroupClauses.filter((definition) => needsAttention(clausesByKey.get(definition.key))).length;
          const isCollapsed = collapsedGroups.has(group);
          if (groupClauses.length === 0) return null;
          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="flex w-full items-center gap-1.5 bg-muted/30 px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase text-muted-foreground hover:bg-muted/50"
                title={isCollapsed ? `Expand ${group}` : `Collapse ${group}`}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span className="min-w-0 flex-1 truncate">{group}</span>
                <span className="shrink-0 font-medium normal-case">
                  {allGroupClauses.length} clauses{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
                </span>
              </button>
              {!isCollapsed &&
                groupClauses.map((definition) => {
                  const clause = clausesByKey.get(definition.key);
                  const fieldSchema = TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE.get(definition.key);
                  const subClauseTables = fieldSchema?.tables || [];
                  const selected = selectedKey === definition.key;
                  const hasEvidence = Boolean(clause && evidenceClauseIds.has(clause.id));
                  const statusText = compactStatusLabel(clause);
                  const title = `${definition.clauseNo} ${definition.title}${clause ? ` | ${statusText} | ${reviewLabel[clause.review_status]}` : ''}`;
                  return (
                    <div key={definition.key}>
                      <button
                        type="button"
                        onClick={() => onSelect(definition.key)}
                        title={title}
                        className={cn(
                          'flex w-full items-center gap-2 border-l-2 border-transparent px-2.5 py-1 text-left text-sm hover:bg-muted/50',
                          selected && 'border-primary bg-primary/10'
                        )}
                      >
                        <span className={cn('w-8 shrink-0 font-mono text-[11px] text-muted-foreground', selected && 'font-semibold text-primary')}>
                          {definition.clauseNo}
                        </span>
                        <span
                          className={cn('h-2 w-2 shrink-0 rounded-full', compactStatusClass(clause))}
                          title={statusText}
                          aria-label={statusText}
                        />
                        <span className={cn('min-w-0 flex-1 truncate text-xs leading-6', selected && 'font-medium')}>
                          {definition.title}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {selected && clause && (
                            <span className="rounded-sm border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {statusText}
                            </span>
                          )}
                          {hasEvidence && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                          {clause?.review_status === 'reviewed' || clause?.review_status === 'approved' || clause?.review_status === 'locked' ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          ) : null}
                        </span>
                      </button>
                      {subClauseTables.length > 0 && (
                        <div className="bg-muted/10 pb-1">
                          {subClauseTables.map((table) => {
                            const rowCount = getStructuredRows(clause, table.key).length;
                            const warningCount = getStructuredTableWarnings(clause, table).length;
                            const subClauseSelected = selected && selectedStructuredTableKey === table.key;
                            return (
                              <button
                                key={table.key}
                                type="button"
                                onClick={() => onSelect(definition.key, table.key)}
                                className={cn(
                                  'flex w-full items-center gap-2 border-l-2 border-transparent py-1 pl-10 pr-2 text-left hover:bg-muted/50',
                                  subClauseSelected && 'border-primary bg-primary/5'
                                )}
                                title={table.label}
                              >
                                <span className={cn('w-10 shrink-0 font-mono text-[10px] text-muted-foreground', subClauseSelected && 'font-semibold text-primary')}>
                                  {table.shortLabel || definition.clauseNo}
                                </span>
                                <span className={cn('min-w-0 flex-1 truncate text-[11px]', subClauseSelected && 'font-medium')}>
                                  {table.label.replace(`${table.shortLabel || ''} `, '')}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {rowCount} row{rowCount === 1 ? '' : 's'}
                                  {warningCount > 0 ? ` · ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {visibleClauses.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No clauses match the current view.</div>
        )}
      </div>
    </div>
  );
}

function ClauseEditor({
  clause,
  activeStructuredTableKey,
  onUpdate,
  onStatus,
}: {
  clause: TaxAuditClauseResponse;
  activeStructuredTableKey?: string;
  onUpdate: (updates: Partial<TaxAuditClauseResponse>) => Promise<void>;
  onStatus: (status: TaxAuditReviewStatus) => Promise<void>;
}) {
  const locked = toBool(clause.locked) || clause.review_status === 'approved' || clause.review_status === 'locked';
  const sourceLinks = parseJson<TaxAuditSourceLink[]>(clause.source_links_json, []);
  const validationMessages = parseJson<string[]>(clause.validation_messages_json, []);
  const missingFields = parseJson<string[]>(clause.missing_fields_json, []);
  const fieldSchema = TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE.get(clause.clause_key);
  const activeStructuredTable = fieldSchema?.tables?.find((table) => table.key === activeStructuredTableKey);
  const headerClauseNo = activeStructuredTable?.shortLabel || clause.clause_no;
  const headerTitle = activeStructuredTable?.label.replace(`${activeStructuredTable.shortLabel || ''} `, '') || clause.clause_title;
  const hasStructuredParticulars = Boolean(fieldSchema?.fields?.length || fieldSchema?.table || fieldSchema?.tables?.length);
  const hasAdditionalParticulars = hasRichTextContent(clause.response_html);
  const hasInternalRemarks = hasRichTextContent(clause.auditor_remarks_html);
  const [additionalParticularsOpen, setAdditionalParticularsOpen] = useState(!hasStructuredParticulars);
  const [internalRemarksOpen, setInternalRemarksOpen] = useState(false);

  useEffect(() => {
    setAdditionalParticularsOpen(!hasStructuredParticulars);
    setInternalRemarksOpen(false);
  }, [clause.id, hasStructuredParticulars]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-background">
      <div className="sticky top-0 z-10 shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-semibold leading-snug">
                Clause {headerClauseNo} <span className="font-normal text-muted-foreground">·</span> {headerTitle}
              </h2>
              {locked && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
            {activeStructuredTable?.description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{activeStructuredTable.description}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn('h-2 w-2 rounded-full', compactStatusClass(clause))}
                title={statusLabel[clause.prefill_status]}
                aria-label={statusLabel[clause.prefill_status]}
              />
              <span className={cn(clause.prefill_status === 'auto_filled' && 'text-emerald-700')}>
                {statusLabel[clause.prefill_status]}
              </span>
              <span aria-hidden="true">·</span>
              <span>{reviewLabel[clause.review_status]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px]">{clause.workpaper_ref || `TA-3CD-${clause.clause_no}`}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onStatus('prepared')} disabled={locked}>
              Prepared
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onStatus('reviewed')} disabled={locked}>
              Reviewed
            </Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => onStatus('approved')} disabled={locked}>
              Approve
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {(validationMessages.length > 0 || missingFields.length > 0) && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {[...validationMessages, ...missingFields].filter(Boolean).join(' | ')}
            </AlertDescription>
          </Alert>
        )}

        {sourceLinks.length > 0 && (
          <details className="rounded-md border bg-muted/20">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
              Clause guidance and source links
            </summary>
            <div className="flex flex-wrap gap-1 border-t px-3 py-2">
              {sourceLinks.map((link, index) => (
                <SourceLinkChip key={`${link.label}-${index}`} link={link} />
              ))}
            </div>
          </details>
        )}

        {fieldSchema && (
          <StructuredClauseFields
            clause={clause}
            schema={fieldSchema}
            activeTableKey={activeStructuredTableKey}
            disabled={locked}
            onUpdate={onUpdate}
          />
        )}

        <Collapsible open={additionalParticularsOpen} onOpenChange={setAdditionalParticularsOpen} className="rounded-md border bg-background">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
              title="Use this only for additional narrative, explanation, or particulars that may be considered for Form 3CD reporting where the structured fields are not sufficient."
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {additionalParticularsOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">Additional Report Particulars</span>
                  {hasAdditionalParticulars && (
                    <span className="rounded-sm border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">Contains text</span>
                  )}
                </div>
                <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">
                  Optional report-facing narrative when structured fields are not sufficient.
                </p>
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <RichTextEditor
              value={clause.response_html || ''}
              onChange={(value) => onUpdate({ response_html: value })}
              placeholder="Add any additional narrative or report-facing explanation, only if required."
              disabled={locked}
              className="[&_[role=textbox]]:min-h-[180px]"
            />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={internalRemarksOpen} onOpenChange={setInternalRemarksOpen} className="rounded-md border bg-background">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
              title="Use this for internal audit notes, review points, basis of conclusion, pending clarification, or working paper remarks. This is not intended to be part of Form 3CD unless specifically used later."
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {internalRemarksOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">Internal Audit Remarks</span>
                  {hasInternalRemarks && (
                    <span className="rounded-sm border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">Has remarks</span>
                  )}
                </div>
                <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">
                  Optional internal working paper notes and review observations.
                </p>
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <RichTextEditor
              value={clause.auditor_remarks_html || ''}
              onChange={(value) => onUpdate({ auditor_remarks_html: value })}
              placeholder="Add internal audit notes, review points, or pending clarifications."
              disabled={locked}
              className="[&_[role=textbox]]:min-h-[160px]"
            />
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={toBool(clause.qualification_required)}
              disabled={locked}
              onCheckedChange={(checked) => onUpdate({ qualification_required: checked === true ? 1 : 0 })}
            />
            Qualification / observation required in report
          </label>
          {toBool(clause.qualification_required) && (
            <RichTextEditor
              value={clause.qualification_text_html || ''}
              onChange={(value) => onUpdate({ qualification_text_html: value })}
              placeholder="Enter qualification or observation wording"
              disabled={locked}
              className="[&_[role=textbox]]:min-h-[140px]"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AcceptanceChecklistPanel({
  acceptanceCheck,
  saving,
  onSave,
}: {
  acceptanceCheck: TaxAuditAcceptanceCheck | null;
  saving: boolean;
  onSave: (updates: Omit<TaxAuditAcceptanceCheck, 'tax_audit_id'>) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const [checklist, setChecklist] = useState<TaxAuditAcceptanceChecklist>(() =>
    normalizeAcceptanceChecklist(acceptanceCheck?.checklist_json)
  );
  const [overallStatus, setOverallStatus] = useState<TaxAuditAcceptanceStatus>(acceptanceCheck?.overall_status || 'not_started');
  const [remarks, setRemarks] = useState(acceptanceCheck?.remarks_html || '');
  const [reviewedBy, setReviewedBy] = useState(acceptanceCheck?.reviewed_by || '');
  const [reviewedAt, setReviewedAt] = useState(acceptanceCheck?.reviewed_at || '');
  const [approvedBy, setApprovedBy] = useState(acceptanceCheck?.approved_by || '');
  const [approvedAt, setApprovedAt] = useState(acceptanceCheck?.approved_at || '');

  useEffect(() => {
    setChecklist(normalizeAcceptanceChecklist(acceptanceCheck?.checklist_json));
    setOverallStatus(acceptanceCheck?.overall_status || 'not_started');
    setRemarks(acceptanceCheck?.remarks_html || '');
    setReviewedBy(acceptanceCheck?.reviewed_by || '');
    setReviewedAt(acceptanceCheck?.reviewed_at || '');
    setApprovedBy(acceptanceCheck?.approved_by || '');
    setApprovedAt(acceptanceCheck?.approved_at || '');
  }, [acceptanceCheck]);

  const reviewedCount = checklist.sections.reduce(
    (count, section) => count + section.items.filter((item) => item.response === 'yes' || item.response === 'no' || item.response === 'na').length,
    0
  );
  const totalCount = checklist.sections.reduce((count, section) => count + section.items.length, 0);
  const isComplete = totalCount > 0 && reviewedCount === totalCount;

  const updateItem = (
    sectionId: string,
    itemId: string,
    updates: Partial<Pick<TaxAuditAcceptanceChecklistItem, 'response' | 'remarks'>>
  ) => {
    setChecklist((prev) => ({
      ...prev,
      sections: prev.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) => (item.id === itemId ? { ...item, ...updates } : item)),
            }
          : section
      ),
    }));
    if (overallStatus === 'not_started') {
      setOverallStatus('in_progress');
    }
  };

  const save = async () => {
    if (overallStatus === 'completed' && !allChecklistItemsReviewed(checklist)) {
      toast({
        title: 'Checklist incomplete',
        description: 'Select Yes, No, or NA for every checklist item before marking it completed.',
        variant: 'destructive',
      });
      return;
    }

    const now = new Date().toISOString();
    const nextReviewedAt =
      (overallStatus === 'completed' || overallStatus === 'issue_noted' || overallStatus === 'not_accepted') && !reviewedAt
        ? now
        : reviewedAt || null;
    const nextApprovedAt = approvedBy.trim() && !approvedAt ? now : approvedAt || null;

    await onSave({
      id: acceptanceCheck?.id,
      checklist_json: JSON.stringify(checklist),
      overall_status: overallStatus,
      remarks_html: remarks,
      reviewed_by: reviewedBy.trim() || null,
      reviewed_at: nextReviewedAt,
      approved_by: approvedBy.trim() || null,
      approved_at: nextApprovedAt,
    });

    if (nextReviewedAt) setReviewedAt(nextReviewedAt);
    if (nextApprovedAt) setApprovedAt(nextApprovedAt);
    toast({ title: 'Acceptance checklist saved' });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Acceptance and Eligibility</p>
            <p className="text-xs text-muted-foreground">
              {reviewedCount} of {totalCount} checklist items reviewed
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={acceptanceStatusBadgeVariant[overallStatus]}>
              {acceptanceStatusLabel[overallStatus]}
            </Badge>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save Checklist'}
            </Button>
          </div>
        </div>
        <Progress value={totalCount ? Math.round((reviewedCount / totalCount) * 100) : 0} className="mt-3 h-2" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {checklist.sections.map((section) => (
            <div key={section.id} className="rounded-md border bg-background">
              <div className="border-b bg-muted/40 px-4 py-3">
                <p className="text-sm font-semibold">{section.title}</p>
              </div>
              <div className="divide-y">
                {section.items.map((item) => (
                  <div key={item.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_120px_minmax(180px,260px)]">
                    <p className="text-sm">{item.label}</p>
                    <Select
                      value={item.response || 'unanswered'}
                      onValueChange={(value) =>
                        updateItem(section.id, item.id, {
                          response: value === 'unanswered' ? '' : (value as TaxAuditChecklistResponse),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unanswered">Select</SelectItem>
                        <SelectItem value="yes">{responseLabel.yes}</SelectItem>
                        <SelectItem value="no">{responseLabel.no}</SelectItem>
                        <SelectItem value="na">{responseLabel.na}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={item.remarks}
                      onChange={(event) => updateItem(section.id, item.id, { remarks: event.target.value })}
                      placeholder="Remarks"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Checklist Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Overall status</Label>
                <Select value={overallStatus} onValueChange={(value: TaxAuditAcceptanceStatus) => setOverallStatus(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">Not started</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="completed" disabled={!isComplete}>
                      Completed
                    </SelectItem>
                    <SelectItem value="issue_noted">Issue noted</SelectItem>
                    <SelectItem value="not_accepted">Not accepted</SelectItem>
                  </SelectContent>
                </Select>
                {!isComplete && (
                  <p className="text-xs text-muted-foreground">Complete all checklist responses before selecting Completed.</p>
                )}
              </div>

              <div className="space-y-1">
                <Label>Overall remarks</Label>
                <Textarea
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  placeholder="Document acceptance conclusion, issues noted, or basis for non-acceptance"
                  rows={5}
                />
              </div>

              <div className="space-y-1">
                <Label>Reviewed by</Label>
                <Input value={reviewedBy} onChange={(event) => setReviewedBy(event.target.value)} placeholder="Reviewer name" />
                {reviewedAt && <p className="text-xs text-muted-foreground">Reviewed at {new Date(reviewedAt).toLocaleString()}</p>}
              </div>

              <div className="space-y-1">
                <Label>Approved by</Label>
                <Input value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} placeholder="Approver name" />
                {approvedAt && <p className="text-xs text-muted-foreground">Approved at {new Date(approvedAt).toLocaleString()}</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function EvidenceRail({
  clause,
  evidenceLinks,
  onLink,
  onUnlink,
  onCollapse,
}: {
  clause: TaxAuditClauseResponse;
  evidenceLinks: ReturnType<typeof useTaxAudit>['evidenceLinks'];
  onLink: (evidenceFileId: string) => Promise<void>;
  onUnlink: (linkId: string) => Promise<void>;
  onCollapse?: () => void;
}) {
  const { currentEngagement } = useEngagement();
  const { files, uploadFile, downloadFile } = useEvidenceFiles(currentEngagement?.id);
  const { toast } = useToast();
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const linksForClause = evidenceLinks.filter((link) => link.clause_response_id === clause.id);
  const linkedFiles = linksForClause
    .map((link) => ({
      link,
      file: files.find((file) => file.id === link.evidence_file_id),
    }))
    .filter((item) => item.file);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, {
        name: file.name,
        file_type: 'document',
        workpaper_ref: clause.workpaper_ref || `TA-3CD-${clause.clause_no}`,
      });
      if (uploaded?.id) {
        await onLink(uploaded.id);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="h-full overflow-y-auto rounded-md border bg-background">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div>
          <p className="text-sm font-semibold">Sources, Evidence and Review</p>
          <p className="text-xs text-muted-foreground">{linkedFiles.length} linked evidence file(s)</p>
        </div>
        {onCollapse && (
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={onCollapse} title="Collapse evidence pane">
            <PanelRightClose className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="space-y-4 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Linked Evidence</Label>
            <Badge variant={linkedFiles.length > 0 ? 'default' : 'outline'}>
              {linkedFiles.length}
            </Badge>
          </div>
          {linkedFiles.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No evidence linked to this clause.
            </div>
          ) : (
            <div className="space-y-2">
              {linkedFiles.map(({ link, file }) => (
                <div key={link.id} className="rounded-md border p-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{file?.name}</p>
                      <p className="text-xs text-muted-foreground">{link.workpaper_ref}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => file && downloadFile(file)}>
                      View
                    </Button>
                  </div>
                  <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => onUnlink(link.id)}>
                    Remove link
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Attach Existing Evidence</Label>
          <Select value={selectedEvidenceId} onValueChange={setSelectedEvidenceId}>
            <SelectTrigger>
              <SelectValue placeholder="Select evidence file" />
            </SelectTrigger>
            <SelectContent>
              {files.map((file) => (
                <SelectItem key={file.id} value={file.id}>
                  {file.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!selectedEvidenceId}
            onClick={async () => {
              await onLink(selectedEvidenceId);
              setSelectedEvidenceId('');
              toast({ title: 'Evidence linked', description: `Linked to Clause ${clause.clause_no}` });
            }}
          >
            <Paperclip className="mr-2 h-4 w-4" />
            Attach
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Upload New Evidence</Label>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => handleUpload(event.target.files?.[0] || null)}
          />
          <Button size="sm" variant="outline" className="w-full" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload and Link'}
          </Button>
        </div>

        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          Evidence files stay in the central Evidence Vault. Tax Audit stores only clause-level links and workpaper references.
        </div>
      </div>
    </div>
  );
}

function TaxAuditPageHeader({
  clientName,
  financialYear,
  setup,
  onRefreshPrefill,
  onOpenReviewQueue,
}: {
  clientName: string;
  financialYear: string;
  setup: TaxAuditSetup;
  onRefreshPrefill: () => Promise<void>;
  onOpenReviewQueue: () => void;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-1 border-b bg-background/95 px-1 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">Tax Audit</h1>
          <p className="truncate text-sm text-muted-foreground">
            {clientName} - {financialYear}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline">Income-tax Act, 1961</Badge>
          <Badge variant="outline">Rule 6G</Badge>
          <Badge>Form {setup.form_type} + 3CD</Badge>
          <Badge variant={setup.applicability_result === 'Applicable' ? 'default' : 'outline'}>
            {setup.applicability_result || 'Not assessed'}
          </Badge>
          <Button variant="outline" size="sm" onClick={onRefreshPrefill}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Prefill
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenReviewQueue}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Review Queue
          </Button>
        </div>
      </div>
    </div>
  );
}

function TaxAuditOverview({
  setup,
  acceptanceCheck,
  complianceSummary,
  summary,
  progress,
  onOpenReviewQueue,
}: {
  setup: TaxAuditSetup;
  acceptanceCheck: TaxAuditAcceptanceCheck | null;
  complianceSummary: ReturnType<typeof summarizeTaxAuditComplianceTracker>;
  summary: TaxAuditSummary;
  progress: number;
  onOpenReviewQueue: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Applicability"
          value={setup.applicability_result || 'Not assessed'}
          detail={setup.form_type ? `Form ${setup.form_type} + 3CD` : 'Report form pending'}
          icon={ShieldCheck}
          tone={setup.applicability_result === 'Applicable' ? 'success' : 'warning'}
        />
        <MetricCard
          label="Acceptance"
          value={acceptanceStatusLabel[acceptanceCheck?.overall_status || 'not_started']}
          detail="Eligibility checklist"
          icon={ClipboardCheck}
          tone={acceptanceCheck?.overall_status === 'completed' ? 'success' : 'warning'}
        />
        <MetricCard
          label="Compliance Tracker"
          value={complianceSummary.badge}
          detail={complianceSummary.warnings.length > 0 ? `${complianceSummary.warnings.length} warning(s)` : 'Specified date, filing and UDIN'}
          icon={FileCheck}
          tone={complianceSummary.completed ? 'success' : 'warning'}
        />
        <MetricCard
          label="Clause Progress"
          value={`${progress}%`}
          detail={`${summary.prepared + summary.reviewed + summary.approved} of ${summary.totalClauses} clauses moved from draft`}
          icon={FileSpreadsheet}
          tone={progress === 100 ? 'success' : 'info'}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Needs Input"
          value={summary.needsInput}
          detail="Missing or manual clauses"
          icon={AlertCircle}
          tone={summary.needsInput > 0 ? 'warning' : 'success'}
          onClick={onOpenReviewQueue}
        />
        <MetricCard
          label="Source Conflicts"
          value={summary.conflicts}
          detail="Requires source review"
          icon={ShieldCheck}
          tone={summary.conflicts > 0 ? 'warning' : 'success'}
          onClick={onOpenReviewQueue}
        />
        <MetricCard
          label="Evidence Linked"
          value={summary.evidenceLinked}
          detail="Clause workpapers attached"
          icon={Paperclip}
          tone="info"
        />
        <MetricCard
          label="Auditor Remarks"
          value={summary.qualifications}
          detail="Qualification or observation flags"
          icon={ClipboardCheck}
          tone={summary.qualifications > 0 ? 'warning' : 'default'}
          onClick={onOpenReviewQueue}
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">3CD Review Progress</p>
              <p className="text-xs text-muted-foreground">
                {summary.prepared + summary.reviewed + summary.approved} of {summary.totalClauses} clauses moved from draft
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold">{progress}%</p>
              <p className="text-xs text-muted-foreground">prepared / reviewed / approved</p>
            </div>
          </div>
          <Progress value={progress} className="mt-3 h-2" />
        </CardContent>
      </Card>
    </div>
  );
}

function ClauseWorkspacePanel({
  selectedClause,
  selectedClauseKey,
  selectedStructuredTableKey,
  clausesByKey,
  evidenceLinks,
  acceptanceCheck,
  onOpenClause,
  onUpdateClause,
  onUpdateClauseStatus,
  onLinkEvidence,
  onUnlinkEvidence,
}: {
  selectedClause: TaxAuditClauseResponse | undefined;
  selectedClauseKey: string;
  selectedStructuredTableKey?: string;
  clausesByKey: Map<string, TaxAuditClauseResponse>;
  evidenceLinks: ReturnType<typeof useTaxAudit>['evidenceLinks'];
  acceptanceCheck: TaxAuditAcceptanceCheck | null;
  onOpenClause: (clauseKey: string, tableKey?: string) => void;
  onUpdateClause: (clauseId: string, updates: Partial<TaxAuditClauseResponse>) => Promise<void>;
  onUpdateClauseStatus: (clauseId: string, status: TaxAuditReviewStatus) => Promise<void>;
  onLinkEvidence: (clause: TaxAuditClauseResponse, evidenceFileId: string) => Promise<void>;
  onUnlinkEvidence: (linkId: string) => Promise<void>;
}) {
  const [evidencePaneOpen, setEvidencePaneOpen] = useState(true);
  const linkedEvidenceCount = selectedClause
    ? evidenceLinks.filter((link) => link.clause_response_id === selectedClause.id).length
    : 0;

  return (
    <div className="space-y-3">
      {acceptanceCheck?.overall_status !== 'completed' && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Acceptance checklist is not completed. Clause work remains available.
          </AlertDescription>
        </Alert>
      )}
      <div
        className={cn(
          'grid min-h-[620px] gap-3 lg:h-[calc(100vh-245px)] lg:grid-cols-[280px_minmax(0,1fr)]',
          evidencePaneOpen
            ? 'xl:grid-cols-[280px_minmax(0,1fr)_300px] 2xl:grid-cols-[300px_minmax(0,1fr)_320px]'
            : 'xl:grid-cols-[280px_minmax(0,1fr)_56px] 2xl:grid-cols-[300px_minmax(0,1fr)_56px]'
        )}
      >
        <ClauseNavigator
          selectedKey={selectedClause?.clause_key || selectedClauseKey}
          selectedStructuredTableKey={selectedStructuredTableKey}
          clausesByKey={clausesByKey}
          evidenceLinks={evidenceLinks}
          onSelect={onOpenClause}
        />
        {selectedClause ? (
          <>
            <div className="min-h-0">
              <ClauseEditor
                clause={selectedClause}
                activeStructuredTableKey={selectedStructuredTableKey}
                onUpdate={(updates) => onUpdateClause(selectedClause.id, updates)}
                onStatus={(status) => onUpdateClauseStatus(selectedClause.id, status)}
              />
            </div>
            <div className="min-h-[320px] lg:col-start-2 xl:col-start-auto xl:min-h-0">
              {evidencePaneOpen ? (
                <EvidenceRail
                  clause={selectedClause}
                  evidenceLinks={evidenceLinks}
                  onLink={(evidenceFileId) => onLinkEvidence(selectedClause, evidenceFileId)}
                  onUnlink={onUnlinkEvidence}
                  onCollapse={() => setEvidencePaneOpen(false)}
                />
              ) : (
                <div className="flex h-full flex-col items-center gap-3 rounded-md border bg-background p-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setEvidencePaneOpen(true)}
                    title="Expand evidence pane"
                  >
                    <PanelRightOpen className="h-4 w-4" />
                  </Button>
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Paperclip className="h-4 w-4" />
                    <Badge variant={linkedEvidenceCount > 0 ? 'default' : 'outline'} className="px-1.5 text-[10px]">
                      {linkedEvidenceCount}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">No clause selected.</div>
        )}
      </div>
    </div>
  );
}

function ReviewSummaryPanel({
  clausesByKey,
  evidenceLinks,
  onOpenClause,
}: {
  clausesByKey: Map<string, TaxAuditClauseResponse>;
  evidenceLinks: ReturnType<typeof useTaxAudit>['evidenceLinks'];
  onOpenClause: (clauseKey: string) => void;
}) {
  const [filter, setFilter] = useState<ReviewSummaryFilter>('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => buildTaxAuditReviewSummaryRows(clausesByKey, evidenceLinks), [clausesByKey, evidenceLinks]);
  const counts = useMemo(() => buildTaxAuditReviewSummaryCounts(rows), [rows]);
  const normalizedSearch = search.trim().toLowerCase();

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (normalizedSearch) {
          const haystack = `${row.clauseNo} ${row.clauseTitle}`.toLowerCase();
          if (!haystack.includes(normalizedSearch)) return false;
        }

        if (filter === 'all') return true;
        if (filter === 'not_started') return row.dataStatus === 'not_started';
        if (filter === 'needs_attention') return row.dataStatus === 'needs_attention';
        if (filter === 'in_progress') return row.dataStatus === 'in_progress';
        if (filter === 'prepared') return row.reviewStatus === 'prepared';
        if (filter === 'reviewed') return row.reviewStatus === 'reviewed';
        if (filter === 'approved') return row.reviewStatus === 'approved' || row.reviewStatus === 'locked';
        if (filter === 'has_evidence') return row.evidenceCount > 0;
        if (filter === 'has_remarks') return row.hasAdditionalParticulars || row.hasInternalRemarks;
        if (filter === 'has_qualification') return row.hasObservation;
        return true;
      }),
    [filter, normalizedSearch, rows]
  );

  const dataStatusLabel: Record<TaxAuditReviewDataStatus, string> = {
    not_started: 'Not started',
    in_progress: 'In progress',
    needs_attention: 'Needs attention',
    prepared: 'Prepared',
    reviewed: 'Reviewed',
    approved: 'Approved',
  };

  const dataStatusBadgeClass = (status: TaxAuditReviewDataStatus) =>
    cn(
      'text-[11px]',
      status === 'not_started' && 'border-slate-300 bg-slate-50 text-slate-700',
      status === 'in_progress' && 'border-blue-300 bg-blue-50 text-blue-700',
      status === 'needs_attention' && 'border-amber-300 bg-amber-50 text-amber-700',
      status === 'prepared' && 'border-emerald-300 bg-emerald-50 text-emerald-700',
      status === 'reviewed' && 'border-teal-300 bg-teal-50 text-teal-700',
      status === 'approved' && 'border-violet-300 bg-violet-50 text-violet-700'
    );

  const filterButtons: Array<{ key: ReviewSummaryFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: counts.totalActiveClauses },
    { key: 'not_started', label: 'Not started', count: counts.notStarted },
    { key: 'needs_attention', label: 'Needs attention', count: counts.needsAttention },
    { key: 'in_progress', label: 'In progress', count: counts.inProgress },
    { key: 'prepared', label: 'Prepared', count: counts.prepared },
    { key: 'reviewed', label: 'Reviewed', count: counts.reviewed },
    { key: 'approved', label: 'Approved', count: counts.approved },
    { key: 'has_evidence', label: 'Has evidence', count: counts.clausesWithEvidence },
    { key: 'has_remarks', label: 'Has remarks', count: rows.filter((row) => row.hasAdditionalParticulars || row.hasInternalRemarks).length },
    { key: 'has_qualification', label: 'Has qualification', count: counts.clausesWithQualification },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total active clauses" value={counts.totalActiveClauses} detail="Active Form 3CD clauses only" icon={FileSpreadsheet} onClick={() => setFilter('all')} />
        <MetricCard label="Not started" value={counts.notStarted} icon={ClipboardCheck} tone={counts.notStarted > 0 ? 'warning' : 'default'} onClick={() => setFilter('not_started')} />
        <MetricCard label="In progress" value={counts.inProgress} icon={RefreshCw} tone={counts.inProgress > 0 ? 'info' : 'default'} onClick={() => setFilter('in_progress')} />
        <MetricCard label="Needs attention" value={counts.needsAttention} icon={AlertCircle} tone={counts.needsAttention > 0 ? 'warning' : 'default'} onClick={() => setFilter('needs_attention')} />
        <MetricCard label="Prepared" value={counts.prepared} icon={FileCheck} tone={counts.prepared > 0 ? 'success' : 'default'} onClick={() => setFilter('prepared')} />
        <MetricCard label="Reviewed" value={counts.reviewed} icon={ClipboardCheck} tone={counts.reviewed > 0 ? 'success' : 'default'} onClick={() => setFilter('reviewed')} />
        <MetricCard label="Approved" value={counts.approved} icon={ShieldCheck} tone={counts.approved > 0 ? 'success' : 'default'} onClick={() => setFilter('approved')} />
        <MetricCard label="Clauses with evidence" value={counts.clausesWithEvidence} icon={Paperclip} onClick={() => setFilter('has_evidence')} />
        <MetricCard label="Clauses with internal remarks" value={counts.clausesWithInternalRemarks} icon={FileSpreadsheet} onClick={() => setFilter('has_remarks')} />
        <MetricCard label="Clauses with qualification / observation" value={counts.clausesWithQualification} icon={AlertCircle} tone={counts.clausesWithQualification > 0 ? 'warning' : 'default'} onClick={() => setFilter('has_qualification')} />
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-background p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filterButtons.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={filter === item.key ? 'default' : 'outline'}
                className="h-8 gap-2"
                onClick={() => setFilter(item.key)}
              >
                {item.label}
                <Badge variant={filter === item.key ? 'secondary' : 'outline'} className="px-1.5 text-[10px]">
                  {item.count}
                </Badge>
              </Button>
            ))}
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search clause number or title"
              className="h-9 pl-8"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <div className="grid min-w-[1180px] grid-cols-[88px_minmax(0,1.5fr)_128px_96px_96px_120px_150px_120px_92px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            <span>Clause No.</span>
            <span>Clause title</span>
            <span>Data status</span>
            <span>Warnings</span>
            <span>Evidence</span>
            <span>Review status</span>
            <span>Remarks</span>
            <span>Qualification</span>
            <span>Action</span>
          </div>
          {filteredRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No clauses match the current filter.</div>
          ) : (
            filteredRows.map((row) => (
              <button
                key={row.clauseKey}
                type="button"
                onClick={() => onOpenClause(row.clauseKey)}
                className="grid min-w-[1180px] w-full grid-cols-[88px_minmax(0,1.5fr)_128px_96px_96px_120px_150px_120px_92px] items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted/40"
              >
                <span className="font-mono text-xs">{row.clauseNo}</span>
                <span className="truncate">{row.clauseTitle}</span>
                <span>
                  <Badge variant="outline" className={dataStatusBadgeClass(row.dataStatus)}>
                    {dataStatusLabel[row.dataStatus]}
                  </Badge>
                </span>
                <span>
                  {row.warningCount > 0 ? (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[11px] text-amber-700">
                      {row.warningCount}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </span>
                <span>
                  {row.evidenceCount > 0 ? (
                    <Badge variant="outline" className="text-[11px]">
                      {row.evidenceCount}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </span>
                <span>
                  <Badge variant="secondary" className="text-[11px]">
                    {reviewLabel[row.reviewStatus]}
                  </Badge>
                </span>
                <span className="flex flex-wrap gap-1">
                  {row.hasAdditionalParticulars && <Badge variant="outline" className="text-[10px]">Report</Badge>}
                  {row.hasInternalRemarks && <Badge variant="outline" className="text-[10px]">Internal</Badge>}
                  {!row.hasAdditionalParticulars && !row.hasInternalRemarks && <span className="text-muted-foreground">-</span>}
                </span>
                <span>
                  {row.hasObservation ? (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[11px] text-amber-700">
                      Present
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </span>
                <span className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Open</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function TaxAudit() {
  const { currentEngagement } = useEngagement();
  const { toast } = useToast();
  const {
    setup,
    acceptanceCheck,
    clauses,
    evidenceLinks,
    client,
    loading,
    saving,
    summary,
    updateSetup,
    saveAcceptanceCheck,
    refreshPrefill,
    updateClause,
    updateClauseStatus,
    linkEvidence,
    unlinkEvidence,
  } = useTaxAudit(currentEngagement);
  const [selectedClauseKey, setSelectedClauseKey] = useState('clause_1');
  const [selectedStructuredTableByClause, setSelectedStructuredTableByClause] = useState<Record<string, string>>({});
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('clauses');

  const clausesByKey = useMemo(() => new Map(clauses.map((clause) => [clause.clause_key, clause])), [clauses]);
  const selectedClause = clausesByKey.get(selectedClauseKey) || clauses[0];
  const selectedStructuredTableKey =
    selectedStructuredTableByClause[selectedClauseKey] || getDefaultStructuredTableKey(selectedClauseKey);
  const progress = summary.totalClauses ? Math.round(((summary.prepared + summary.reviewed + summary.approved) / summary.totalClauses) * 100) : 0;
  const setupJson = parseJson<Record<string, unknown>>(setup?.setup_json, {});
  const complianceTracker = normalizeTaxAuditComplianceTracker(setupJson.complianceTracker);
  const complianceSummary = summarizeTaxAuditComplianceTracker(complianceTracker);
  const openClause = (clauseKey: string, tableKey?: string) => {
    const defaultTableKey = getDefaultStructuredTableKey(clauseKey);
    if (tableKey || defaultTableKey) {
      setSelectedStructuredTableByClause((prev) => ({
        ...prev,
        [clauseKey]: tableKey || prev[clauseKey] || defaultTableKey,
      }));
    }
    setSelectedClauseKey(clauseKey);
    setActiveTab('clauses');
  };

  if (!currentEngagement) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Tax Audit</h1>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Please select an engagement before opening Tax Audit.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading || !setup) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
        </div>
      </div>
    );
  }

  const reviewQueue = clauses.filter(
    (clause) =>
      clause.prefill_status === 'needs_input' ||
      clause.prefill_status === 'source_conflict' ||
      clause.validation_status === 'warning' ||
      clause.validation_status === 'error' ||
      toBool(clause.qualification_required)
  );

  return (
    <div className="space-y-4">
      <TaxAuditPageHeader
        clientName={currentEngagement.client_name}
        financialYear={currentEngagement.financial_year}
        setup={setup}
        onRefreshPrefill={async () => {
          await refreshPrefill();
          toast({ title: 'Prefill refreshed', description: 'Draft clauses were refreshed from available source data.' });
        }}
        onOpenReviewQueue={() => setReviewQueueOpen(true)}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="setup">Setup and Applicability</TabsTrigger>
          <TabsTrigger value="acceptance">Acceptance and Eligibility</TabsTrigger>
          <TabsTrigger value="compliance">Compliance Tracker</TabsTrigger>
          <TabsTrigger value="clauses">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            3CD Clause Workspace
          </TabsTrigger>
          <TabsTrigger value="summary">Review Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <TaxAuditOverview
            setup={setup}
            acceptanceCheck={acceptanceCheck}
            complianceSummary={complianceSummary}
            summary={summary}
            progress={progress}
            onOpenReviewQueue={() => setReviewQueueOpen(true)}
          />
        </TabsContent>

        <TabsContent value="setup" className="mt-0">
          <SetupPanel setup={setup} saving={saving} onSave={updateSetup} client={client} />
        </TabsContent>

        <TabsContent value="acceptance" className="mt-0 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
          <AcceptanceChecklistPanel
            acceptanceCheck={acceptanceCheck}
            saving={saving}
            onSave={saveAcceptanceCheck}
          />
        </TabsContent>

        <TabsContent value="compliance" className="mt-0">
          <ComplianceTrackerPanel setup={setup} saving={saving} onSave={updateSetup} />
        </TabsContent>

        <TabsContent value="clauses" className="mt-0">
          <ClauseWorkspacePanel
            selectedClause={selectedClause}
            selectedClauseKey={selectedClauseKey}
            selectedStructuredTableKey={selectedStructuredTableKey}
            clausesByKey={clausesByKey}
            evidenceLinks={evidenceLinks}
            acceptanceCheck={acceptanceCheck}
            onOpenClause={openClause}
            onUpdateClause={updateClause}
            onUpdateClauseStatus={updateClauseStatus}
            onLinkEvidence={linkEvidence}
            onUnlinkEvidence={unlinkEvidence}
          />
        </TabsContent>

        <TabsContent value="summary" className="mt-0">
          <ReviewSummaryPanel
            clausesByKey={clausesByKey}
            evidenceLinks={evidenceLinks}
            onOpenClause={openClause}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={reviewQueueOpen} onOpenChange={setReviewQueueOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review Queue</DialogTitle>
            <DialogDescription>Clauses that need input, evidence, validation review, or qualification review.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y rounded-md border">
            {reviewQueue.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No review queue items.</div>
            ) : (
              reviewQueue.map((clause) => (
                <button
                  key={clause.id}
                  type="button"
                  className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/40"
                  onClick={() => {
                    openClause(clause.clause_key);
                    setReviewQueueOpen(false);
                  }}
                >
                  <Badge variant="outline">Clause {clause.clause_no}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{clause.clause_title}</p>
                    <p className="text-xs text-muted-foreground">
                      {statusLabel[clause.prefill_status]} | {reviewLabel[clause.review_status]} | {clause.validation_status}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
