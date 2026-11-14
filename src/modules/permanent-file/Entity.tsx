import { useEffect, useState } from 'react';
import type { ClientMaster, EntityData, EntityDetails, PermanentFileData, PermanentFileRequest } from './types';
import { todayLocal } from './date';
import { CONSTITUTION_TYPES } from '@/data/constitutionTypes';

const empty: EntityDetails = { tradeName: '', incorporationDate: '', incorporationPlace: '', tan: '',
  branches: [], groupDetails: '', auditPartner: '', keyPersonnel: '' };
type Props = { clientId: string; request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  onMasterSaved: (name: string) => Promise<void> };

export default function Entity({ clientId, request, onMasterSaved }: Props) {
  const [entity, setEntity] = useState<EntityData | null>(null);
  const [master, setMaster] = useState<ClientMaster | null>(null);
  const [editingMaster, setEditingMaster] = useState(false);
  const [details, setDetails] = useState(empty);
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    request({ action: 'entity', clientId }).then((result) => {
      if (!('entity' in result)) throw new Error('Unexpected entity response.');
      if (!active) return;
      setEntity(result.entity);
      setMaster({ name: result.entity.client.name, industry: result.entity.client.industry ?? '',
        constitution: result.entity.client.constitution ?? '', cin: result.entity.client.cin ?? '',
        pan: result.entity.client.pan ?? '', address: result.entity.client.address ?? '',
        state: result.entity.client.state ?? '', pin: result.entity.client.pin ?? '' });
      const source = result.entity.details;
      setDetails(source ? { ...empty, ...source, incorporationDate: source.incorporationDate ?? '' } : empty);
      setBranches(source?.branches ?? []);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load entity details.'); });
    return () => { active = false; };
  }, [clientId, request]);

  async function saveMaster() {
    if (!master) return;
    setBusy(true); setError(''); setMessage('');
    let savedSuccessfully = false;
    try {
      const saved = await request({ action: 'saveClientMaster', clientId, master });
      if (!('updated' in saved)) throw new Error('Unexpected save response.');
      savedSuccessfully = true;
      const result = await request({ action: 'entity', clientId });
      if (!('entity' in result)) throw new Error('Unexpected entity response.');
      setEntity(result.entity);
      setMaster({ name: result.entity.client.name, industry: result.entity.client.industry ?? '',
        constitution: result.entity.client.constitution ?? '', cin: result.entity.client.cin ?? '',
        pan: result.entity.client.pan ?? '', address: result.entity.client.address ?? '',
        state: result.entity.client.state ?? '', pin: result.entity.client.pin ?? '' });
      setEditingMaster(false);
      setMessage('Client master saved.');
      await onMasterSaved(result.entity.client.name);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'Unknown error.';
      setError(savedSuccessfully ? `Client master was saved, but refreshing failed: ${reason}` : `Unable to save client master: ${reason}`);
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request({ action: 'saveEntity', clientId, details: {
        ...details, branches: branches.map((line) => line.trim()).filter(Boolean),
      } });
      if (!('updated' in result)) throw new Error('Unexpected save response.');
      setMessage('Permanent-file entity details saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save entity details.');
    } finally { setBusy(false); }
  }
  return <details className="pf-card">
    <summary className="cursor-pointer"><span className="text-[15px] font-semibold">Client Details</span>
      {entity && <span className="ml-3 text-xs font-normal text-slate-600">
        {entity.client.name} · {entity.client.constitution || 'Constitution not recorded'} · PAN: {entity.client.pan || 'Not recorded'} · CIN/LLPIN: {entity.client.cin || 'Not recorded'} · {[entity.client.address, entity.client.state, entity.client.pin].filter(Boolean).join(', ') || 'Office not recorded'} · {entity.gstins.length} matching GSTIN(s)
      </span>}
      <span className="float-right text-blue-700">Edit Client Details</span>
    </summary>
    {(entity?.unmatchedGstins?.length ?? 0) > 0 && <p role="alert" className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-amber-900">
      Some linked GSTINs need reconciliation. Open Client Details to review them; PAN changes are blocked until they are resolved.
    </p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status">{message}</p>}
    {entity && <div className="space-y-2 pt-2">
      <p className="text-xs text-muted-foreground">Client master changes also update linked engagements. GSTIN matches are based on PAN, not external verification.</p>
      {editingMaster && master ? <div className="grid gap-4 md:grid-cols-3">
        {([
          ['name', 'Legal name'], ['industry', 'Industry'], ['pan', 'PAN'],
          ['address', 'Registered office address'], ['state', 'State'], ['pin', 'PIN'],
        ] as const).map(([key, label]) => <label key={key}>{label}
          <input className="block w-full rounded border p-1" value={master[key]}
            onChange={(event) => setMaster((old) => old ? { ...old, [key]: event.target.value } : old)} />
        </label>)}
        <label>Constitution
          <select className="block w-full rounded border p-1" value={master.constitution}
            onChange={(event) => setMaster((old) => old ? { ...old, constitution: event.target.value } : old)}>
            <option value="">Select constitution</option>
            {CONSTITUTION_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>CIN / LLPIN
          <input className="block w-full rounded border p-1" value={master.cin}
            onChange={(event) => setMaster((old) => old ? { ...old, cin: event.target.value } : old)} />
        </label>
        <div className="flex gap-2">
          <button type="button" className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50" disabled={busy} onClick={() => void saveMaster()}>Save master</button>
          <button type="button" className="rounded border px-3 py-1" disabled={busy} onClick={() => {
            setMaster({ name: entity.client.name, industry: entity.client.industry ?? '',
              constitution: entity.client.constitution ?? '', cin: entity.client.cin ?? '',
              pan: entity.client.pan ?? '', address: entity.client.address ?? '',
              state: entity.client.state ?? '', pin: entity.client.pin ?? '' });
            setEditingMaster(false);
          }}>Cancel</button>
        </div>
      </div> : <>
      <div className="grid gap-1 sm:grid-cols-2">
        <p>Legal name: {entity.client.name}</p>
        <p>Constitution: {entity.client.constitution || 'Not recorded'}</p><p>Industry: {entity.client.industry || 'Not recorded'}</p>
        <p>PAN: {entity.client.pan || 'Not recorded'}</p><p>CIN/LLPIN: {entity.client.cin || 'Not recorded'}</p>
        <p className="sm:col-span-2">Registered office: {[entity.client.address, entity.client.state, entity.client.pin].filter(Boolean).join(', ') || 'Not recorded'}</p>
      </div>
      {entity.canEditMaster ? <button type="button" className="rounded border px-2 py-1" onClick={() => setEditingMaster(true)}>Edit client master</button>
        : <p className="text-xs text-muted-foreground">A manager or above can edit client master details.</p>}
      </>}
      <p>GST registrations matching client PAN: {entity.gstins.join(', ') || 'None identified'}</p>
      {(entity.unmatchedGstins?.length ?? 0) > 0 && <div role="alert" className="rounded border border-amber-500 p-2">
        <p>These registrations cannot be identified as the client's own from the recorded PAN. They remain in the GST master and need reconciliation:</p>
        <p>{entity.unmatchedGstins.join(', ')}</p>
        <p>Unlinking while retaining the original records is not yet available.</p>
      </div>}
      <div className="grid gap-4 md:grid-cols-3">
        {([
          ['tradeName', 'Trade name', 'text'], ['incorporationDate', 'Date of incorporation', 'date'],
          ['tan', 'TAN', 'text'],
          ['groupDetails', 'Group details', 'text'], ['auditPartner', 'Audit partner', 'text'],
        ] as const).map(([key, label, type]) => <label key={key}>{label}
          <input className="block w-full rounded border p-1" type={type} max={type === 'date' ? todayLocal() : undefined} value={details[key] ?? ''}
            onChange={(event) => setDetails((old) => ({ ...old, [key]: event.target.value }))} />
        </label>)}
      </div>
      {branches.map((branch, index) => <div key={index} className="flex items-end gap-2">
        <label className="block flex-1">Branch address {index + 1}
          <input className="block w-full rounded border p-1" value={branch} onChange={(event) =>
            setBranches((old) => old.map((value, i) => i === index ? event.target.value : value))} />
        </label>
        <button type="button" className="rounded border px-2 py-1" onClick={() => setBranches((old) => old.filter((_, i) => i !== index))}>Remove</button>
      </div>)}
      <button type="button" className="rounded border px-2 py-1" onClick={() => setBranches((old) => [...old, ''])}>+ Add branch</button>
      <button type="button" className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50" disabled={busy} onClick={() => void save()}>Save client details</button>
    </div>}
  </details>;
}
