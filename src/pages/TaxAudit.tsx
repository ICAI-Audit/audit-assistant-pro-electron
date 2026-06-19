import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementType } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck,
  FileSpreadsheet,
  Lock,
  Paperclip,
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
import { SourceLinkChip } from '@/components/tax-audit/SourceLinkChip';
import { useEngagement } from '@/contexts/EngagementContext';
import { useTaxAudit } from '@/hooks/useTaxAudit';
import { useEvidenceFiles } from '@/hooks/useEvidenceFiles';
import { FORM_3CD_CLAUSES, FORM_3CD_GROUPS } from '@/data/taxAudit3CDClauses';
import { calculateApplicability, TaxAuditApplicabilityResult } from '@/lib/taxAuditApplicability';
import {
  TaxAuditAcceptanceCheck,
  TaxAuditAcceptanceChecklist,
  TaxAuditAcceptanceChecklistItem,
  TaxAuditAcceptanceStatus,
  TaxAuditChecklistResponse,
  TaxAuditClauseResponse,
  TaxAuditPrefillStatus,
  TaxAuditReviewStatus,
  TaxAuditSetup,
  TaxAuditSourceLink,
} from '@/types/taxAudit';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

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

const toBool = (value: unknown) => value === true || value === 1 || value === '1';

const numberValue = (value: unknown) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

type ClauseFilter = 'all' | 'attention' | 'evidence' | 'qualified' | 'reviewed';

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

const reviewSteps: TaxAuditReviewStatus[] = ['draft', 'prepared', 'reviewed', 'approved'];

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

  const setupSourceLinks = parseJson<TaxAuditSourceLink[]>(draft.source_links_json, []);
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
    <Card>
      <CardHeader className="pb-3">
        {/* Tax Audit Setup heading and badges hidden as per user request */}
        {/* <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Tax Audit Setup</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Form {draft.form_type} + 3CD</Badge>
            <Badge variant={draft.applicability_result === 'Not applicable' ? 'secondary' : 'default'}>
              {draft.applicability_result || 'Not assessed'}
            </Badge>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save Setup'}
            </Button>
          </div>
        </div> */}
        <div className="flex items-center justify-end gap-2">
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
        {/* Source links removed as per user request - Client and Engagement buttons hidden */}
        {/* {setupSourceLinks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {setupSourceLinks.map((link, index) => (
              <SourceLinkChip key={`${link.label}-${index}`} link={link} />
            ))}
          </div>
        )} */}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Applicability Result</p>
              <p className="mt-1 text-sm text-muted-foreground">{applicability.overall.reason}</p>
            </div>
            <Badge variant={applicabilityBadgeVariant[applicability.overall.result]}>{applicability.overall.result}</Badge>
          </div>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Business</p>
              <p className="font-medium">{applicability.business.result || '-'}</p>
              <p className="text-xs text-muted-foreground">
                {applicability.business.thresholdApplied || '-'} {applicability.business.sectionReference ? `| ${applicability.business.sectionReference}` : ''}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Profession</p>
              <p className="font-medium">{applicability.profession.result || '-'}</p>
              <p className="text-xs text-muted-foreground">
                {applicability.profession.thresholdApplied || '-'} {applicability.profession.sectionReference ? `| ${applicability.profession.sectionReference}` : ''}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Recommended form</p>
              <p className="font-medium">{applicability.suggestedFormType || '-'}</p>
            </div>
          </div>
          {applicability.warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {applicability.warnings.map((warning) => (
                <p key={warning} className="text-xs text-amber-700">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
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
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1 md:col-span-2">
            <Label>Address</Label>
            <Input 
              value={draft.address || ''} 
              readOnly 
              className="bg-muted cursor-not-allowed"
              title="Auto-populated from Client Master"
            />
            <p className="text-xs text-muted-foreground">From Client Master</p>
          </div>
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
          <div className="space-y-1">
            <Label>Nature</Label>
            <Input value={draft.nature_of_business || ''} onChange={(e) => updateDraft({ nature_of_business: e.target.value })} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-6">
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
        </div>

        {auditedUnderOtherLaw && (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Other law</Label>
              <Input
                value={draft.other_law_name || ''}
                onChange={(e) => updateDraft({ other_law_name: e.target.value })}
                placeholder="e.g. Companies Act, 2013"
              />
            </div>
            <div className="md:col-span-2 pt-7 text-xs text-muted-foreground">
              Form 3CA is used where accounts are audited under another law. For companies, this is usually the Companies Act audit.
            </div>
          </div>
        )}

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
  );
}

function ClauseNavigator({
  selectedKey,
  clausesByKey,
  evidenceLinks,
  onSelect,
}: {
  selectedKey: string;
  clausesByKey: Map<string, TaxAuditClauseResponse>;
  evidenceLinks: ReturnType<typeof useTaxAudit>['evidenceLinks'];
  onSelect: (key: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClauseFilter>('all');
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
    const matchesSearch =
      !searchTerm ||
      definition.clauseNo.toLowerCase().includes(searchTerm) ||
      definition.title.toLowerCase().includes(searchTerm) ||
      definition.group.toLowerCase().includes(searchTerm);
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

  return (
    <div className="h-full overflow-y-auto rounded-md border bg-background">
      <div className="sticky top-0 z-10 space-y-3 border-b bg-background p-3">
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
            className="h-9 pl-8"
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
      <div className="divide-y">
        {FORM_3CD_GROUPS.map((group) => {
          const groupClauses = visibleClauses.filter((clause) => clause.group === group);
          if (groupClauses.length === 0) return null;
          return (
            <div key={group}>
              <div className="bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground">
                {group}
              </div>
              {groupClauses.map((definition) => {
              const clause = clausesByKey.get(definition.key);
              const selected = selectedKey === definition.key;
              const hasEvidence = Boolean(clause && evidenceClauseIds.has(clause.id));
              return (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => onSelect(definition.key)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50',
                    selected && 'bg-primary/10'
                  )}
                >
                  <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{definition.clauseNo}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2">{definition.title}</span>
                    {clause && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className={badgeClass(clause.prefill_status)}>
                          {statusLabel[clause.prefill_status]}
                        </Badge>
                        {clause.review_status !== 'draft' && (
                          <Badge variant="secondary" className="text-[11px]">
                            {reviewLabel[clause.review_status]}
                          </Badge>
                        )}
                        {hasEvidence && (
                          <Badge variant="outline" className="gap-1 text-[11px]">
                            <Paperclip className="h-3 w-3" />
                            Evidence
                          </Badge>
                        )}
                      </span>
                    )}
                  </span>
                </button>
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
  onUpdate,
  onStatus,
}: {
  clause: TaxAuditClauseResponse;
  onUpdate: (updates: Partial<TaxAuditClauseResponse>) => Promise<void>;
  onStatus: (status: TaxAuditReviewStatus) => Promise<void>;
}) {
  const locked = toBool(clause.locked) || clause.review_status === 'approved' || clause.review_status === 'locked';
  const sourceLinks = parseJson<TaxAuditSourceLink[]>(clause.source_links_json, []);
  const validationMessages = parseJson<string[]>(clause.validation_messages_json, []);
  const missingFields = parseJson<string[]>(clause.missing_fields_json, []);
  const currentReviewIndex =
    clause.review_status === 'locked'
      ? reviewSteps.length - 1
      : Math.max(0, reviewSteps.indexOf(clause.review_status));

  return (
    <div className="h-full overflow-y-auto rounded-md border bg-background">
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Clause {clause.clause_no}</Badge>
              <Badge variant="outline" className={badgeClass(clause.prefill_status)}>
                {statusLabel[clause.prefill_status]}
              </Badge>
              <Badge variant="secondary">{reviewLabel[clause.review_status]}</Badge>
              {locked && <Lock className="h-4 w-4 text-muted-foreground" />}
            </div>
            <h2 className="mt-2 text-lg font-semibold">{clause.clause_title}</h2>
            <div className="mt-2 flex flex-wrap gap-1">
              {sourceLinks.map((link, index) => (
                <SourceLinkChip key={`${link.label}-${index}`} link={link} />
              ))}
            </div>
            <div className="mt-3 grid max-w-xl grid-cols-4 gap-2">
              {reviewSteps.map((step, index) => {
                const reached = index <= currentReviewIndex;
                return (
                  <div
                    key={step}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
                      reached ? 'border-primary/30 bg-primary/10 text-primary' : 'bg-background text-muted-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                        reached ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="truncate">{reviewLabel[step]}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onStatus('prepared')} disabled={locked}>
              Mark Prepared
            </Button>
            <Button size="sm" variant="outline" onClick={() => onStatus('reviewed')} disabled={locked}>
              Mark Reviewed
            </Button>
            <Button size="sm" onClick={() => onStatus('approved')} disabled={locked}>
              Approve
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {(validationMessages.length > 0 || missingFields.length > 0) && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {[...validationMessages, ...missingFields].filter(Boolean).join(' | ')}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Clause Response / Particulars</Label>
            <Badge variant="outline">{clause.workpaper_ref || `TA-3CD-${clause.clause_no}`}</Badge>
          </div>
          <RichTextEditor
            value={clause.response_html || ''}
            onChange={(value) => onUpdate({ response_html: value })}
            placeholder="Enter clause response or review the prefilled particulars"
            disabled={locked}
          />
        </div>

        <div className="space-y-2">
          <Label>Auditor's Remarks</Label>
          <RichTextEditor
            value={clause.auditor_remarks_html || ''}
            onChange={(value) => onUpdate({ auditor_remarks_html: value })}
            placeholder="Add observation, qualification basis, explanation, or NIL reporting basis"
            disabled={locked}
          />
        </div>

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
}: {
  clause: TaxAuditClauseResponse;
  evidenceLinks: ReturnType<typeof useTaxAudit>['evidenceLinks'];
  onLink: (evidenceFileId: string) => Promise<void>;
  onUnlink: (linkId: string) => Promise<void>;
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
      <div className="border-b bg-muted/30 px-3 py-2 text-sm font-semibold">Sources, Evidence and Review</div>
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
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');

  const clausesByKey = useMemo(() => new Map(clauses.map((clause) => [clause.clause_key, clause])), [clauses]);
  const selectedClause = clausesByKey.get(selectedClauseKey) || clauses[0];
  const progress = summary.totalClauses ? Math.round(((summary.prepared + summary.reviewed + summary.approved) / summary.totalClauses) * 100) : 0;
  const openClause = (clauseKey: string) => {
    setSelectedClauseKey(clauseKey);
    setActiveTab('workspace');
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tax Audit</h1>
          <p className="text-muted-foreground">
            {currentEngagement.client_name} - {currentEngagement.financial_year}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Income-tax Act, 1961</Badge>
          <Badge variant="outline">Rule 6G</Badge>
          <Badge>Form {setup.form_type} + 3CD</Badge>
          {(setup.applicability_result === 'Review required' || setup.applicability_result === 'Not assessed') && (
            <Badge variant="outline">{setup.applicability_result}</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await refreshPrefill();
              toast({ title: 'Prefill refreshed', description: 'Draft clauses were refreshed from available source data.' });
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Prefill
          </Button>
          <Button variant="outline" size="sm" onClick={() => setReviewQueueOpen(true)}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Review Queue
          </Button>
        </div>
      </div>

      <SetupPanel setup={setup} saving={saving} onSave={updateSetup} client={client} />

      <div className="rounded-md border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Review Progress</p>
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
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Needs Input"
          value={summary.needsInput}
          detail="Missing or manual clauses"
          icon={AlertCircle}
          tone={summary.needsInput > 0 ? 'warning' : 'success'}
          onClick={() => setReviewQueueOpen(true)}
        />
        <MetricCard
          label="Source Conflicts"
          value={summary.conflicts}
          detail="Requires source review"
          icon={ShieldCheck}
          tone={summary.conflicts > 0 ? 'warning' : 'success'}
          onClick={() => setReviewQueueOpen(true)}
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
          onClick={() => setReviewQueueOpen(true)}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="acceptance">
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Acceptance and Eligibility
          </TabsTrigger>
          <TabsTrigger value="workspace">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Clause Workspace
          </TabsTrigger>
          <TabsTrigger value="summary">
            <FileCheck className="mr-2 h-4 w-4" />
            Review Summary
          </TabsTrigger>
        </TabsList>

        <TabsContent value="acceptance">
          <AcceptanceChecklistPanel
            acceptanceCheck={acceptanceCheck}
            saving={saving}
            onSave={saveAcceptanceCheck}
          />
        </TabsContent>

        <TabsContent value="workspace">
          {acceptanceCheck?.overall_status !== 'completed' && (
            <Alert className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Acceptance and eligibility checklist is not completed. Clause work remains available, but complete the checklist before finalizing the Tax Audit file.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] h-[800px]">
            <ClauseNavigator
              selectedKey={selectedClause?.clause_key || selectedClauseKey}
              clausesByKey={clausesByKey}
              evidenceLinks={evidenceLinks}
              onSelect={openClause}
            />
            {selectedClause ? (
              <div className="flex flex-col gap-4 min-h-0">
                <div className="flex-1 min-h-0">
                  <ClauseEditor
                    clause={selectedClause}
                    onUpdate={(updates) => updateClause(selectedClause.id, updates)}
                    onStatus={(status) => updateClauseStatus(selectedClause.id, status)}
                  />
                </div>
                <div className="h-[300px] shrink-0">
                  <EvidenceRail
                    clause={selectedClause}
                    evidenceLinks={evidenceLinks}
                    onLink={(evidenceFileId) => linkEvidence(selectedClause, evidenceFileId)}
                    onUnlink={unlinkEvidence}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-md border p-6 text-sm text-muted-foreground">No clause selected.</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="summary">
          <div className="rounded-md border bg-background">
            <div className="grid grid-cols-[80px_minmax(0,1fr)_140px_140px_120px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
              <span>Clause</span>
              <span>Particulars</span>
              <span>Prefill</span>
              <span>Review</span>
              <span>Evidence</span>
            </div>
            {FORM_3CD_CLAUSES.map((definition) => {
              const clause = clausesByKey.get(definition.key);
              const linked = clause ? evidenceLinks.some((link) => link.clause_response_id === clause.id) : false;
              return (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => openClause(definition.key)}
                  className="grid w-full grid-cols-[80px_minmax(0,1fr)_140px_140px_120px] items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted/40"
                >
                  <span className="font-mono text-xs">{definition.clauseNo}</span>
                  <span>{definition.title}</span>
                  <span>
                    <Badge variant="outline" className={clause ? badgeClass(clause.prefill_status) : 'text-[11px]'}>
                      {clause ? statusLabel[clause.prefill_status] : 'Open'}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[11px]">
                      {clause ? reviewLabel[clause.review_status] : 'Draft'}
                    </Badge>
                    {needsAttention(clause) && <AlertCircle className="h-4 w-4 text-amber-600" />}
                  </span>
                  <span className="flex items-center gap-2">
                    {linked ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : '-'}
                    <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </span>
                </button>
              );
            })}
          </div>
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
