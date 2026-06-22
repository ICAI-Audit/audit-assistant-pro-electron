import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Scale, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TAX_AUDIT_DISCLAIMER_SECTIONS } from '@/data/taxAuditDisclaimers';
import {
  buildTaxAuditDisclaimerSetupJson,
  normalizeTaxAuditDisclaimerAcknowledgement,
  TaxAuditDisclaimerAcknowledgement,
} from '@/lib/taxAuditDisclaimer';
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

const formatAcceptedAt = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN');
};

export function ProfessionalResponsibilityPanel({
  setup,
  saving,
  currentUserName,
  onSave,
}: {
  setup: TaxAuditSetup;
  saving: boolean;
  currentUserName?: string | null;
  onSave: (updates: Partial<TaxAuditSetup>) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const setupJson = useMemo(() => parseJson<Record<string, unknown>>(setup.setup_json, {}), [setup.setup_json]);
  const acknowledgement = useMemo(
    () => normalizeTaxAuditDisclaimerAcknowledgement(setupJson.disclaimerAcknowledgement),
    [setupJson]
  );
  const defaultUserName = (currentUserName || '').trim();
  const [accepted, setAccepted] = useState(acknowledgement.accepted);
  const [acceptedBy, setAcceptedBy] = useState(acknowledgement.accepted_by || defaultUserName);

  useEffect(() => {
    setAccepted(acknowledgement.accepted);
    setAcceptedBy(acknowledgement.accepted_by || defaultUserName);
  }, [acknowledgement, defaultUserName]);

  const saveAcknowledgement = async () => {
    const nextAcknowledgement: TaxAuditDisclaimerAcknowledgement = {
      accepted,
      accepted_by: accepted ? acceptedBy.trim() || defaultUserName : '',
      accepted_at: accepted ? acknowledgement.accepted_at || new Date().toISOString() : '',
      version: acknowledgement.version,
    };

    await onSave({
      setup_json: buildTaxAuditDisclaimerSetupJson({
        currentSetupJson: setup.setup_json,
        acknowledgement: nextAcknowledgement,
      }),
    });

    toast({
      title: accepted ? 'Acknowledgement saved' : 'Acknowledgement cleared',
      description: accepted
        ? 'Professional Responsibility and Disclaimer acknowledgement was saved.'
        : 'Professional Responsibility acknowledgement was marked pending.',
    });
  };

  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Professional Responsibility and Disclaimer</p>
            <Badge
              variant="outline"
              className={
                acknowledgement.accepted
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-amber-300 bg-amber-50 text-amber-700'
              }
            >
              {acknowledgement.accepted ? 'Acknowledged' : 'Acknowledgement Pending'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Assistance Tool notice for Professional Judgment, Auditor Responsibility and Verification Required before report preparation.
          </p>
        </div>
        {acknowledgement.accepted && (
          <div className="rounded-md border bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Acknowledged
            </div>
            <p className="mt-1">
              {acknowledgement.accepted_by || 'Auditor'}{acknowledgement.accepted_at ? ` on ${formatAcceptedAt(acknowledgement.accepted_at)}` : ''}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {TAX_AUDIT_DISCLAIMER_SECTIONS.map((section) => (
          <Collapsible key={section.id}>
            <div className="rounded-md border">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
                  <span className="text-sm font-medium">{section.title}</span>
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="border-t px-3 py-2 text-sm text-muted-foreground">{section.statement}</p>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>

      <div className="mt-4 space-y-3 rounded-md border bg-muted/20 p-3">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} />
          <span>
            I acknowledge that this tool is an assistance tool and does not replace my professional judgment or responsibility as tax auditor.
          </span>
        </label>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1">
            <Label>Acknowledged by</Label>
            <Input
              value={acceptedBy}
              onChange={(event) => setAcceptedBy(event.target.value)}
              placeholder="Name of auditor or reviewer"
              disabled={!accepted}
            />
          </div>
          <Button type="button" onClick={saveAcknowledgement} disabled={saving}>
            {saving ? 'Saving...' : 'Save Acknowledgement'}
          </Button>
        </div>
      </div>
    </div>
  );
}
