import { useEffect, useId, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ClientMaster, EntityData, EntityDetails, PermanentFileData, PermanentFileRequest } from './types';
import { todayLocal } from './date';
import { formatConstitution, formatDisplayDate } from './format';
import { CONSTITUTION_TYPES } from '@/data/constitutionTypes';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SectionCard, SectionCardBody, SectionCardHeader } from '@/components/ui/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';

const empty: EntityDetails = { tradeName: '', incorporationDate: '', incorporationPlace: '', tan: '',
  branches: [], groupDetails: '', auditPartner: '', keyPersonnel: '' };
type Props = { clientId: string; request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  onMasterSaved: (name: string) => Promise<void> };

const masterOf = (client: EntityData['client']): ClientMaster => ({ name: client.name, industry: client.industry ?? '',
  constitution: client.constitution ?? '', cin: client.cin ?? '', pan: client.pan ?? '', address: client.address ?? '',
  state: client.state ?? '', pin: client.pin ?? '' });

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Muted placeholder for an unrecorded value. */
function EmptyValue({ soft = false }: { soft?: boolean }) {
  return <span className="font-normal text-subtle">
    {soft ? 'Not recorded' : <><span aria-hidden="true">—</span><span className="sr-only">Not recorded</span></>}
  </span>;
}

function Item({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={cn('min-w-0 space-y-1', className)}>
    <dt className="text-xs text-subtle">{label}</dt>
    <dd className="break-words text-body-sm font-medium text-foreground">{children}</dd>
  </div>;
}

export default function Entity({ clientId, request, onMasterSaved }: Props) {
  const [entity, setEntity] = useState<EntityData | null>(null);
  const [master, setMaster] = useState<ClientMaster | null>(null);
  const [masterBase, setMasterBase] = useState<ClientMaster | null>(null);
  const [details, setDetails] = useState(empty);
  const [detailsBase, setDetailsBase] = useState(empty);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesBase, setBranchesBase] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const panelId = useId();

  useEffect(() => {
    let active = true;
    request({ action: 'entity', clientId }).then((result) => {
      if (!('entity' in result)) throw new Error('Unexpected entity response.');
      if (!active) return;
      const next = masterOf(result.entity.client);
      const source = result.entity.details;
      const loaded = source ? { ...empty, ...source, incorporationDate: source.incorporationDate ?? '' } : empty;
      setEntity(result.entity);
      setMaster(next); setMasterBase(next);
      setDetails(loaded); setDetailsBase(loaded);
      setBranches(source?.branches ?? []); setBranchesBase(source?.branches ?? []);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load entity details.'); });
    return () => { active = false; };
  }, [clientId, request]);

  const masterDirty = master !== null && !same(master, masterBase);
  const detailsDirty = !same(details, detailsBase) || !same(branches, branchesBase);

  function cancel() {
    if (masterBase) setMaster(masterBase);
    setDetails(detailsBase);
    setBranches(branchesBase);
    setError('');
    setEditing(false);
  }

  async function saveAll() {
    if (!master || !entity) return;
    setBusy(true); setError('');
    try {
      if (entity.canEditMaster && masterDirty) {
        let saved = false;
        try {
          const result = await request({ action: 'saveClientMaster', clientId, master });
          if (!('updated' in result)) throw new Error('Unexpected save response.');
          saved = true;
          const fresh = await request({ action: 'entity', clientId });
          if (!('entity' in fresh)) throw new Error('Unexpected entity response.');
          const next = masterOf(fresh.entity.client);
          setEntity(fresh.entity); setMaster(next); setMasterBase(next);
          toast.success('Client master saved.');
          await onMasterSaved(fresh.entity.client.name);
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : 'Unknown error.';
          setError(saved ? `Client master was saved, but refreshing failed: ${reason}` : `Unable to save client master: ${reason}`);
          return;
        }
      }
      if (detailsDirty) {
        const cleaned = branches.map((line) => line.trim()).filter(Boolean);
        try {
          const result = await request({ action: 'saveEntity', clientId, details: { ...details, branches: cleaned } });
          if (!('updated' in result)) throw new Error('Unexpected save response.');
          setDetailsBase(details); setBranches(cleaned); setBranchesBase(cleaned);
          toast.success('Permanent-file entity details saved.');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Unable to save entity details.');
          return;
        }
      }
      setEditing(false);
    } finally { setBusy(false); }
  }

  const client = entity?.client;
  const unmatched = entity?.unmatchedGstins ?? [];
  const office = [client?.address, client?.state, client?.pin].filter(Boolean).join(', ');
  const canEditMaster = entity?.canEditMaster === true;
  const setMasterField = (key: keyof ClientMaster, value: string) => setMaster((old) => old ? { ...old, [key]: value } : old);
  const setDetail = (key: keyof EntityDetails, value: string) => setDetails((old) => ({ ...old, [key]: value }));

  const chips = client && <div className="flex min-w-0 flex-wrap items-center gap-1.5">
    <Badge variant="neutral" className="max-w-full whitespace-nowrap font-medium"><span className="truncate">{client.name}</span></Badge>
    {client.constitution && <Badge variant="neutral" className="max-w-full whitespace-nowrap font-medium">{formatConstitution(client.constitution)}</Badge>}
    {client.industry && <Badge variant="neutral" className="max-w-full whitespace-nowrap font-medium"><span className="truncate">{client.industry}</span></Badge>}
    {client.pan ? <Badge variant="neutral" className="max-w-full whitespace-nowrap font-medium">PAN {client.pan}</Badge>
      : <Badge variant="warning" className="max-w-full whitespace-nowrap font-medium">PAN not recorded</Badge>}
    <Badge variant="neutral" className="max-w-full whitespace-nowrap font-medium">{entity.gstins.length} matching GSTIN{entity.gstins.length === 1 ? '' : 's'}</Badge>
  </div>;

  return <SectionCard>
    <SectionCardHeader divider={expanded}
      title={<button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((open) => !open)}
        className="-ml-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1 py-0.5 ring-offset-background transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none">
        <ChevronDown aria-hidden="true" className={cn('h-4 w-4 text-subtle transition-transform duration-150 motion-reduce:transition-none', !expanded && '-rotate-90')} />
        Client Details
      </button>}
      meta={chips}
      actions={entity && !editing && <Button type="button" variant="outline" size="sm" onClick={() => { setExpanded(true); setEditing(true); }}>
        <Pencil aria-hidden="true" /> Edit client details
      </Button>} />
    <div id={panelId} hidden={!expanded}>
      {!entity && !error && <SectionCardBody className="space-y-3" aria-busy="true">
        <Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" />
      </SectionCardBody>}
      {error && !editing && <SectionCardBody><p role="alert" className="text-body-sm text-destructive">{error}</p></SectionCardBody>}
      {entity && client && <>
        <SectionCardBody className="space-y-5">
          {unmatched.length > 0 && <div role="status" className="flex gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-warning-ink">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1 text-body-sm">
              <p className="font-medium">Some linked GSTINs need reconciliation. Open Client Details to review them; PAN changes are blocked until they are resolved.</p>
              <p>These registrations cannot be identified as the client's own from the recorded PAN. They remain in the GST master and need reconciliation:</p>
              <p className="break-all font-mono text-xs">{unmatched.join(', ')}</p>
              <p>Unlinking while retaining the original records is not yet available.</p>
            </div>
          </div>}
          {error && editing && <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-body-sm text-danger-ink">{error}</p>}

          {!editing && <>
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-6 gap-y-5">
              <Item label="Legal name">{client.name}</Item>
              <Item label="Constitution">{client.constitution ? formatConstitution(client.constitution) : <EmptyValue soft />}</Item>
              <Item label="Industry">{client.industry || <EmptyValue soft />}</Item>
              <Item label="PAN">{client.pan || <EmptyValue soft />}</Item>
              <Item label="CIN / LLPIN">{client.cin || <EmptyValue soft />}</Item>
              <Item label="Trade name">{detailsBase.tradeName || <EmptyValue />}</Item>
              <Item label="Date of incorporation">{detailsBase.incorporationDate ? formatDisplayDate(detailsBase.incorporationDate) : <EmptyValue />}</Item>
              <Item label="TAN">{detailsBase.tan || <EmptyValue />}</Item>
              <Item label="Group details">{detailsBase.groupDetails || <EmptyValue />}</Item>
              <Item label="Audit partner">{detailsBase.auditPartner || <EmptyValue />}</Item>
              <Item label="Registered office" className="sm:col-span-2">{office || <EmptyValue soft />}</Item>
              <Item label="Branches" className="sm:col-span-full">
                {branchesBase.length > 0 ? <ul className="space-y-0.5">{branchesBase.map((branch, index) => <li key={index}>{branch}</li>)}</ul> : <EmptyValue />}
              </Item>
            </dl>
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 border-t pt-4 text-xs text-subtle">
              <p>GST registrations matching client PAN: <strong className="font-semibold text-foreground">{entity.gstins.join(', ') || 'None identified'}</strong>. Matches are based on PAN, not external verification.</p>
              <p>Client master changes also update linked engagements.{!canEditMaster && ' A manager or above can edit client master details.'}</p>
            </div>
          </>}

          {editing && master && <div className="space-y-6">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold text-foreground">Client master</legend>
              <p className="text-xs text-subtle">
                Client master changes also update linked engagements.{!canEditMaster && ' A manager or above can edit client master details.'}
              </p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
                <Field label="Legal name" required>{(c) => <Input {...c} value={master.name} disabled={!canEditMaster} onChange={(e) => setMasterField('name', e.target.value)} />}</Field>
                <Field label="Constitution">{(c) => <NativeSelect {...c} value={master.constitution} disabled={!canEditMaster} onChange={(e) => setMasterField('constitution', e.target.value)}>
                  <option value="">Select constitution</option>
                  {CONSTITUTION_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>}</Field>
                <Field label="Industry">{(c) => <Input {...c} value={master.industry} disabled={!canEditMaster} onChange={(e) => setMasterField('industry', e.target.value)} />}</Field>
                <Field label="PAN">{(c) => <Input {...c} value={master.pan} disabled={!canEditMaster} onChange={(e) => setMasterField('pan', e.target.value)} />}</Field>
                <Field label="CIN / LLPIN">{(c) => <Input {...c} value={master.cin} disabled={!canEditMaster} onChange={(e) => setMasterField('cin', e.target.value)} />}</Field>
                <Field label="Registered office address" className="sm:col-span-2">{(c) => <Input {...c} value={master.address} disabled={!canEditMaster} onChange={(e) => setMasterField('address', e.target.value)} />}</Field>
                <Field label="State">{(c) => <Input {...c} value={master.state} disabled={!canEditMaster} onChange={(e) => setMasterField('state', e.target.value)} />}</Field>
                <Field label="PIN">{(c) => <Input {...c} value={master.pin} disabled={!canEditMaster} onChange={(e) => setMasterField('pin', e.target.value)} />}</Field>
              </div>
            </fieldset>
            <fieldset className="space-y-4">
              <legend className="mb-1 text-sm font-semibold text-foreground">Additional details</legend>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
                <Field label="Trade name">{(c) => <Input {...c} value={details.tradeName} onChange={(e) => setDetail('tradeName', e.target.value)} />}</Field>
                <Field label="Date of incorporation">{(c) => <Input {...c} type="date" max={todayLocal()} value={details.incorporationDate} onChange={(e) => setDetail('incorporationDate', e.target.value)} />}</Field>
                <Field label="TAN">{(c) => <Input {...c} value={details.tan} onChange={(e) => setDetail('tan', e.target.value)} />}</Field>
                <Field label="Group details">{(c) => <Input {...c} value={details.groupDetails} onChange={(e) => setDetail('groupDetails', e.target.value)} />}</Field>
                <Field label="Audit partner">{(c) => <Input {...c} value={details.auditPartner} onChange={(e) => setDetail('auditPartner', e.target.value)} />}</Field>
              </div>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold text-foreground">Branches</legend>
              {branches.map((branch, index) => <div key={index} className="flex items-end gap-2">
                <Field label={`Branch address ${index + 1}`} className="flex-1">{(c) => <Input {...c} value={branch}
                  onChange={(e) => setBranches((old) => old.map((value, i) => i === index ? e.target.value : value))} />}</Field>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove branch address ${index + 1}`}
                  onClick={() => setBranches((old) => old.filter((_, i) => i !== index))}><Trash2 aria-hidden="true" /></Button>
              </div>)}
              <Button type="button" variant="outline" size="sm" onClick={() => setBranches((old) => [...old, ''])}><Plus aria-hidden="true" /> Add branch</Button>
            </fieldset>
          </div>}
        </SectionCardBody>
        {editing && <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-card/95 px-5 py-3 backdrop-blur">
          <p className="text-xs text-subtle" aria-live="polite">{masterDirty || detailsDirty ? 'You have unsaved changes.' : 'No changes to save.'}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={cancel}>Cancel</Button>
            <Button type="button" disabled={busy || !(masterDirty || detailsDirty)} onClick={() => void saveAll()}>{busy ? 'Saving…' : 'Save client details'}</Button>
          </div>
        </div>}
      </>}
    </div>
  </SectionCard>;
}
