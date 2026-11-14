import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PermanentDocument, PermanentFileData, PermanentFileRequest } from './types';
import { groupCategories } from './format';
import { uploadBlocker, validateUpload } from './validation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { Input } from '@/components/ui/input';
import { Modal, ModalCancel, ModalFooter } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import { toast } from '@/components/ui/sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  engagementId?: string;
  documents: PermanentDocument[];
  categories: Record<string, string>;
  /** Preselects "new version of this document" when the dialog opens. */
  initialDocumentId: string;
  request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  onUploaded: () => Promise<void>;
};

export default function UploadDocumentDialog({ open, onOpenChange, clientId, engagementId, documents, categories, initialDocumentId, request, onUploaded }: Props) {
  const [documentId, setDocumentId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('PF-01');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDocumentId(initialDocumentId); setName(''); setCategory('PF-01'); setFile(null); setError('');
  }, [open, initialDocumentId]);

  const blocker = uploadBlocker({ file, existingDocumentId: documentId, name });
  const existing = documents.find((row) => row.id === documentId);

  async function upload() {
    if (!file) return;
    const problem = validateUpload(file);
    if (problem) { setError(problem); return; }
    if (!documentId && !name.trim()) { setError('Enter a document name.'); return; }
    setBusy(true);
    setError('');
    try {
      const bytes = await file.arrayBuffer();
      const result = await request({
        action: 'upload', clientId, documentId: documentId || undefined,
        category, name, fileName: file.name,
        bytes, engagementIds: engagementId ? [engagementId] : [],
      });
      if (!('reference' in result)) throw new Error('Unexpected upload response.');
      toast.success('Document saved successfully.');
      onOpenChange(false);
      await onUploaded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} dirty={Boolean(file) || name.trim() !== ''}
    onSubmit={() => void upload()} title="Add document or version"
    description="Upload a new document or retain another version of an existing one."
    footer={<ModalFooter note={blocker ?? undefined}>
      <ModalCancel disabled={busy} />
      <Button type="submit" disabled={busy || blocker !== null}>{busy ? <><Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> Saving…</> : 'Save document'}</Button>
    </ModalFooter>}>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-body-sm text-danger-ink">{error}</p>}
    <Field label="Existing document for a new version">{(c) => <NativeSelect {...c} value={documentId} disabled={busy} onChange={(e) => setDocumentId(e.target.value)}>
      <option value="">New document</option>
      {documents.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.category})</option>)}
    </NativeSelect>}</Field>
    {!documentId ? <>
      <Field label="Document name" required>{(c) => <Input {...c} placeholder="e.g. Certificate of Incorporation" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Category" required>{(c) => <NativeSelect {...c} value={category} disabled={busy} onChange={(e) => setCategory(e.target.value)}>
        {groupCategories(categories).map((group) => <optgroup key={group.label} label={group.label}>
          {group.options.map(([code, label]) => <option key={code} value={code}>{code} — {label}</option>)}
        </optgroup>)}
      </NativeSelect>}</Field>
    </> : existing && <p className="text-body-sm text-subtle">Adding a new version of <strong className="font-medium text-foreground">{existing.name}</strong>. Its name and category are kept.</p>}
    <Field label="File" required>{(c) => <FileDropzone {...c} file={file} onFileChange={setFile} validate={validateUpload} uploading={busy}
      hint="PDF, Word, Excel or images · maximum 25 MiB" />}</Field>
    <p className="text-xs text-subtle">All uploaded versions are retained. The selected engagement is linked automatically.</p>
  </Modal>;
}
