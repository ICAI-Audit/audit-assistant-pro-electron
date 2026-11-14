import { useState } from 'react';
import type { PermanentDocument, PermanentFileData, PermanentFileRequest } from './types';
import { todayLocal } from './date';
import { VERIFICATION_STATUSES } from './format';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalCancel, ModalFooter } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import { toast } from '@/components/ui/sonner';

type Props = {
  clientId: string;
  document: PermanentDocument | null;
  engagements: { id: string; name: string; financialYear: string }[];
  request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  onSaved: () => Promise<void>;
  onClose: () => void;
  onUploadVersion: (documentId: string) => void;
};

type FormProps = Props & { document: PermanentDocument };

function MetadataDialog({ clientId, document, engagements, request, onSaved, onClose, onUploadVersion }: FormProps) {
  const initial = {
    status: document.verificationStatus, reviewed: document.reviewedDate ?? '', expiry: document.expiryDate ?? '',
    year: document.documentYear ?? '', keywords: document.keywords ?? '', links: document.engagementIds,
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = (changes: Partial<typeof initial>) => setForm((old) => ({ ...old, ...changes }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    setBusy(true); setError('');
    try {
      const result = await request({
        action: 'updateMetadata', clientId, versionId: document.versionId, verificationStatus: form.status,
        reviewedDate: form.reviewed || null, expiryDate: form.expiry || null, documentYear: form.year.trim() || null,
        keywords: form.keywords.trim() || null, engagementIds: form.links,
      });
      if (!('updated' in result)) throw new Error('Unexpected metadata response.');
      toast.success('Document details saved.');
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Metadata could not be saved.');
    } finally { setBusy(false); }
  }

  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} dirty={dirty} onSubmit={() => void save()}
    title="Edit document metadata" description="Changes to engagement links apply to every version."
    footer={<ModalFooter note={document.name}>
      <Button type="button" variant="outline" onClick={() => onUploadVersion(document.id)}>Upload new version</Button>
      <ModalCancel />
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save metadata'}</Button>
    </ModalFooter>}>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-body-sm text-danger-ink">{error}</p>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Status">{(c) => <NativeSelect {...c} value={form.status} onChange={(e) => patch({ status: e.target.value })}>
        {Object.entries(VERIFICATION_STATUSES).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect>}</Field>
      <Field label="Document year">{(c) => <Input {...c} placeholder="e.g. 2024" value={form.year} onChange={(e) => patch({ year: e.target.value })} />}</Field>
      <Field label="Reviewed date">{(c) => <Input {...c} type="date" max={todayLocal()} value={form.reviewed} onChange={(e) => patch({ reviewed: e.target.value })} />}</Field>
      <Field label="Expiry date">{(c) => <Input {...c} type="date" max={todayLocal()} value={form.expiry} onChange={(e) => patch({ expiry: e.target.value })} />}</Field>
    </div>
    <Field label="Keywords">{(c) => <Input {...c} value={form.keywords} onChange={(e) => patch({ keywords: e.target.value })} />}</Field>
    <fieldset className="space-y-2">
      <legend className="mb-2 text-body-sm font-medium">Linked engagements <span className="font-normal text-subtle">(applies to all versions)</span></legend>
      {engagements.map(({ id, name, financialYear }) => <label key={id} className="flex items-center gap-2 text-body-sm">
        <input type="checkbox" className="h-4 w-4 rounded border-input accent-primary" checked={form.links.includes(id)}
          onChange={(event) => patch({ links: event.target.checked ? [...form.links, id] : form.links.filter((item) => item !== id) })} />
        {name} — {financialYear}
      </label>)}
    </fieldset>
  </Modal>;
}

/** Mounts the form per document, so each edit starts from that document's saved values. */
export default function DocumentMetadata(props: Props) {
  const { document } = props;
  return document ? <MetadataDialog key={document.versionId} {...props} document={document} /> : null;
}
