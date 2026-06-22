import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardCheck, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TAX_AUDIT_PROGRAMME_CHECKLIST, TAX_AUDIT_PROGRAMME_GROUPS, TaxAuditProgrammeLinkedTab } from '@/data/taxAuditProgrammeChecklist';
import {
  AuditProgrammeFilterStatus,
  buildDefaultProgrammeItemState,
  buildTaxAuditProgrammeSetupJson,
  normalizeTaxAuditProgramme,
  summarizeTaxAuditProgramme,
  TAX_AUDIT_PROGRAMME_RESPONSE_OPTIONS,
  TAX_AUDIT_PROGRAMME_STATUS_OPTIONS,
  TaxAuditProgrammeItemState,
  TaxAuditProgrammeResponse,
  TaxAuditProgrammeState,
  TaxAuditProgrammeStatus,
} from '@/lib/taxAuditProgramme';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { TaxAuditSetup } from '@/types/taxAudit';

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function ProgrammeMetricCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'default' | 'warning' | 'success' | 'info';
}) {
  return (
    <Card
      className={cn(
        tone === 'warning' && 'border-amber-200 bg-amber-50/60',
        tone === 'success' && 'border-emerald-200 bg-emerald-50/60',
        tone === 'info' && 'border-blue-200 bg-blue-50/50'
      )}
    >
      <CardContent className="p-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}

const statusBadgeClass = (status: TaxAuditProgrammeStatus) =>
  cn(
    'text-[11px]',
    status === 'Not started' && 'border-slate-300 bg-slate-50 text-slate-700',
    status === 'In progress' && 'border-blue-300 bg-blue-50 text-blue-700',
    status === 'Completed' && 'border-emerald-300 bg-emerald-50 text-emerald-700',
    status === 'Reviewed' && 'border-teal-300 bg-teal-50 text-teal-700',
    status === 'Not applicable' && 'border-slate-300 bg-slate-50 text-slate-700'
  );

export function AuditProgrammePanel({
  setup,
  saving,
  onSave,
  onNavigate,
}: {
  setup: TaxAuditSetup;
  saving: boolean;
  onSave: (updates: Partial<TaxAuditSetup>) => Promise<unknown>;
  onNavigate: (tab: TaxAuditProgrammeLinkedTab, clauseKey?: string) => void;
}) {
  const { toast } = useToast();
  const setupJson = useMemo(() => parseJson<Record<string, unknown>>(setup.setup_json, {}), [setup.setup_json]);
  const [programme, setProgramme] = useState<TaxAuditProgrammeState>(() => normalizeTaxAuditProgramme(setupJson.auditProgramme));
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<AuditProgrammeFilterStatus>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setProgramme(normalizeTaxAuditProgramme(setupJson.auditProgramme));
  }, [setupJson]);

  const stats = useMemo(() => summarizeTaxAuditProgramme(programme), [programme]);

  const updateItem = (itemId: string, updates: Partial<TaxAuditProgrammeItemState>) => {
    setProgramme((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [itemId]: {
          ...(prev.items[itemId] || buildDefaultProgrammeItemState()),
          ...updates,
        },
      },
    }));
  };

  const saveProgramme = async () => {
    const savedAt = new Date().toISOString();
    const nextProgramme = {
      ...programme,
      last_updated_at: savedAt,
    };

    await onSave({
      setup_json: buildTaxAuditProgrammeSetupJson({
        currentSetupJson: setup.setup_json,
        programme: nextProgramme,
        updatedAt: savedAt,
      }),
    });
    setProgramme(nextProgramme);
    toast({ title: 'Audit Programme saved', description: 'Checklist responses and working references were saved.' });
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredItems = TAX_AUDIT_PROGRAMME_CHECKLIST.filter((item) => {
    const state = programme.items[item.id] || buildDefaultProgrammeItemState();
    if (groupFilter !== 'all' && item.group !== groupFilter) return false;
    if (statusFilter !== 'all' && state.status !== statusFilter) return false;
    if (normalizedSearch) {
      const haystack = `${item.title} ${item.description} ${item.suggestedEvidence} ${item.referenceArea}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return true;
  });

  const groupedItems = TAX_AUDIT_PROGRAMME_GROUPS.map((group) => ({
    group,
    items: filteredItems.filter((item) => item.group === group),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <ProgrammeMetricCard label="Total items" value={stats.total} detail="Checklist master items" />
        <ProgrammeMetricCard label="Not started" value={stats.notStarted} detail="Pending start" tone={stats.notStarted > 0 ? 'warning' : 'success'} />
        <ProgrammeMetricCard label="In progress" value={stats.inProgress} detail="Work started" tone={stats.inProgress > 0 ? 'info' : 'default'} />
        <ProgrammeMetricCard label="Completed" value={stats.completed} detail={`${stats.completionPercent}% complete`} tone={stats.completed > 0 ? 'success' : 'default'} />
        <ProgrammeMetricCard label="Reviewed" value={stats.reviewed} detail="Review status" tone={stats.reviewed > 0 ? 'success' : 'default'} />
        <ProgrammeMetricCard label="Not applicable" value={stats.notApplicable} detail="Scoped out" />
        <ProgrammeMetricCard label="Needs Review" value={stats.needsReview} detail="Review response or in progress" tone={stats.needsReview > 0 ? 'warning' : 'success'} />
      </div>

      <div className="rounded-md border bg-background p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold">Audit Programme</p>
            <p className="text-xs text-muted-foreground">
              Checklist-driven planning, execution, review and filing follow-up for the tax audit engagement.
            </p>
          </div>
          <Button type="button" size="sm" onClick={saveProgramme} disabled={saving}>
            {saving ? 'Saving...' : 'Save Programme'}
          </Button>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search checklist item, evidence or reference area"
              className="h-9 pl-8"
            />
          </div>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {TAX_AUDIT_PROGRAMME_GROUPS.map((group) => (
                <SelectItem key={group} value={group}>
                  {group}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value: AuditProgrammeFilterStatus) => setStatusFilter(value)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TAX_AUDIT_PROGRAMME_STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {groupedItems.length === 0 ? (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">No checklist items match the current filter.</div>
      ) : (
        groupedItems.map(({ group, items }) => (
          <Collapsible key={group} defaultOpen>
            <div className="rounded-md border bg-background">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left">
                  <div>
                    <p className="text-sm font-semibold">{group}</p>
                    <p className="text-xs text-muted-foreground">{items.length} checklist item(s)</p>
                  </div>
                  <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="divide-y">
                  {items.map((checklistItem) => {
                    const state = programme.items[checklistItem.id] || buildDefaultProgrammeItemState();
                    return (
                      <div key={checklistItem.id} className="space-y-3 p-3">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{checklistItem.title}</p>
                              <Badge variant="outline" className={statusBadgeClass(state.status)}>
                                {state.status}
                              </Badge>
                              {checklistItem.isRequiredByDefault && <Badge variant="outline" className="text-[10px]">Required</Badge>}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{checklistItem.description}</p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>Suggested Evidence: {checklistItem.suggestedEvidence}</span>
                              <span>|</span>
                              <span>Reference Area: {checklistItem.referenceArea}</span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => onNavigate(checklistItem.linkedTab, checklistItem.linkedClauseKey)}
                          >
                            Open Area
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="space-y-1">
                            <Label>Status</Label>
                            <Select value={state.status} onValueChange={(value: TaxAuditProgrammeStatus) => updateItem(checklistItem.id, { status: value })}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TAX_AUDIT_PROGRAMME_STATUS_OPTIONS.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {status}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Response</Label>
                            <Select value={state.response} onValueChange={(value: TaxAuditProgrammeResponse) => updateItem(checklistItem.id, { response: value })}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TAX_AUDIT_PROGRAMME_RESPONSE_OPTIONS.map((response) => (
                                  <SelectItem key={response} value={response}>
                                    {response}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Assigned to</Label>
                            <Input value={state.assigned_to} onChange={(event) => updateItem(checklistItem.id, { assigned_to: event.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label>Due date</Label>
                            <Input type="date" value={state.due_date} onChange={(event) => updateItem(checklistItem.id, { due_date: event.target.value })} />
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                          <div className="space-y-1">
                            <Label>Working Reference</Label>
                            <Input
                              value={state.working_reference}
                              onChange={(event) => updateItem(checklistItem.id, { working_reference: event.target.value })}
                              placeholder="Working paper reference"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Remarks</Label>
                            <Textarea
                              value={state.remarks}
                              onChange={(event) => updateItem(checklistItem.id, { remarks: event.target.value })}
                              rows={2}
                              placeholder="Checklist remarks or review note"
                            />
                          </div>
                        </div>

                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={Boolean(state.reviewed_at)}
                            onCheckedChange={(checked) =>
                              updateItem(checklistItem.id, {
                                status: checked === true ? 'Reviewed' : state.status === 'Reviewed' ? 'Completed' : state.status,
                                reviewed_by: checked === true ? state.reviewed_by || 'Reviewed' : '',
                                reviewed_at: checked === true ? new Date().toISOString() : '',
                              })
                            }
                          />
                          <span className="inline-flex items-center gap-1">
                            Review Status
                            {state.reviewed_at ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <RefreshCw className="h-4 w-4 text-muted-foreground" />}
                          </span>
                          {state.reviewed_at && <span className="text-xs text-muted-foreground">reviewed on {new Date(state.reviewed_at).toLocaleDateString('en-IN')}</span>}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))
      )}
    </div>
  );
}
