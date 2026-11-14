import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngagement } from '@/contexts/EngagementContext';
import type { PermanentFileData, PermanentFileRequest } from '@/modules/permanent-file/types';
import History from '@/modules/permanent-file/History';
import DocumentMetadata from '@/modules/permanent-file/DocumentMetadata';
import Entity from '@/modules/permanent-file/Entity';
import { requireCurrentListResponse } from '@/modules/permanent-file/response';
import { displayReference } from '@/modules/permanent-file/display';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import '@/modules/permanent-file/permanent-file.css';

type ListData = Extract<PermanentFileData, { documents: unknown }>;

async function request(payload: PermanentFileRequest): Promise<PermanentFileData> {
  const result = await window.electronAPI.permanentFile.request(payload);
  if ('error' in result) throw new Error(result.error);
  return result.data;
}

export default function PermanentFile() {
  const { currentEngagement, refreshEngagements } = useEngagement();
  const clientId = currentEngagement?.client_id;
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('PF-01');
  const [documentId, setDocumentId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [searchYear, setSearchYear] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchEngagement, setSearchEngagement] = useState('');
  const [editing, setEditing] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; type: string } | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const token = ++generation.current;
    setData(null);
    setError('');
    if (!clientId) return;
    try {
      const response = requireCurrentListResponse(await request({ action: 'list', clientId }));
      if (token === generation.current) setData(response);
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to load permanent file.');
    }
  }, [clientId]);

  useEffect(() => {
    setFile(null);
    setName('');
    setDocumentId('');
    setSearch('');
    setSearchCategory(''); setSearchYear(''); setSearchStatus(''); setSearchEngagement(''); setEditing('');
    setMessage(''); setUploadOpen(false); setReportOpen(false); setPreview(null);
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  async function upload() {
    if (!clientId || !file) return;
    if (file.size === 0 || file.size > 25 * 1024 * 1024) {
      setError('Choose a non-empty document no larger than 25 MiB.');
      return;
    }
    if (!documentId && !name.trim()) {
      setError('Enter a document name.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    const token = generation.current;
    try {
      const bytes = await file.arrayBuffer();
      const result = await request({
        action: 'upload', clientId, documentId: documentId || undefined,
        category, name, fileName: file.name, bytes,
        engagementIds: currentEngagement?.id ? [currentEngagement.id] : [],
      });
      if (!('reference' in result)) throw new Error('Unexpected upload response.');
      if (token !== generation.current) return;
      setFile(null);
      setName('');
      setDocumentId('');
      setUploadOpen(false);
      setMessage('Document saved successfully.');
      await load();
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function openPreview(versionId: string) {
    if (!clientId) return;
    setError('');
    const token = generation.current;
    try {
      const result = await request({ action: 'download', clientId, versionId });
      if (token !== generation.current) return;
      if (!('bytes' in result)) throw new Error('Unexpected preview response.');
      const ext = result.fileName.split('.').pop()?.toLowerCase();
      const type = ext === 'pdf' ? 'application/pdf' :
        ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[ext ?? ''] ?? '';
      setPreview({ url: URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: type || 'application/octet-stream' })),
        name: result.fileName, type });
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : 'Preview failed.');
    }
  }

  async function download(versionId: string) {
    if (!clientId) return;
    setError('');
    const token = generation.current;
    try {
      const result = await request({ action: 'download', clientId, versionId });
      if (token !== generation.current) return;
      if (!('bytes' in result)) throw new Error('Unexpected download response.');
      const bytes = new Uint8Array(result.bytes);
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : 'Download failed.');
    }
  }

  const uniqueDocuments = data?.documents.filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index) ?? [];
  return (
    <main className="pf space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1>Permanent File / {data?.client.name ?? currentEngagement?.client_name ?? 'Not selected'} <span className="pf-badge">Beta</span></h1>
      <button type="button" disabled={!data} onClick={() => setReportOpen(true)}>Year-End Comparison Report</button></div>
      <p className="text-xs text-muted-foreground">Permanent File is under development. Use test data while verification continues.</p>
      {!clientId && <p role="alert">Select an engagement linked to a client.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {message && <p role="status">{message}</p>}
      {data?.storageWarning && <p role="alert" className="text-red-700">Some permanent-file storage requires administrator review. Do not delete files; check backups.</p>}
      {data && clientId && <Entity key={clientId} clientId={clientId} request={request} onMasterSaved={async (clientName) => {
        setData((old) => old && old.client.id === clientId ? { ...old, client: { ...old.client, name: clientName } } : old);
        await refreshEngagements();
      }} />}
      {data && clientId && (
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <History key={clientId} clientId={clientId} clientName={data.client.name} documents={data.documents} request={request}
            reportOpen={reportOpen} onReportOpenChange={setReportOpen} onPreview={(versionId) => void openPreview(versionId)} />
          <div className="space-y-3">
          <section className="pf-card space-y-3 h-full">
          <div className="flex items-center justify-between gap-2"><h2>Documents &amp; Versions</h2>
            <button type="button" className="pf-primary" onClick={() => { setError(''); setUploadOpen(true); }}>+ Add Document</button></div>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogContent className="pf-modal max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogTitle>Add document or version</DialogTitle><DialogDescription>Upload a new document or retain another version of an existing document.</DialogDescription>
            {error && <p role="alert" className="text-red-700">{error}</p>}
            <label className="block">Existing document for a new version
              <select className="block w-full rounded border p-2" value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                <option value="">New document</option>
                {uniqueDocuments.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.category})</option>)}
              </select>
            </label>
            {!documentId && <>
              <label className="block">Document name
                <input className="block w-full rounded border p-2" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="block">Category
                <select className="block w-full rounded border p-2" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {Object.entries(data.categories).map(([code, label]) => <option key={code} value={code}>{code} — {label}</option>)}
                </select>
              </label>
            </>}
            <label className="block">File (maximum 25 MiB)
              <input className="block" type="file" key={`${documentId}-${message}`} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <button type="button" className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" onClick={() => void upload()} disabled={busy || !file}>
              {busy ? 'Saving…' : 'Save document'}
            </button>
            <p className="text-sm">All uploaded versions are retained. The selected engagement is linked automatically.</p>
          </DialogContent></Dialog>
            <div className="grid gap-2 sm:grid-cols-4">
              <label>Search<input placeholder="Name, category or keyword" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              <label>Category<select className="block w-full rounded border p-1" value={searchCategory} onChange={(event) => setSearchCategory(event.target.value)}>
                <option value="">All categories</option>{Object.entries(data.categories).map(([code, label]) => <option key={code} value={code}>{code} — {label}</option>)}
              </select></label>
              <label>Year<input className="block w-full rounded border p-1" value={searchYear} onChange={(event) => setSearchYear(event.target.value)} /></label>
              <label>Status<select className="block w-full rounded border p-1" value={searchStatus} onChange={(event) => setSearchStatus(event.target.value)}>
                <option value="">All statuses</option><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="rejected">Rejected</option>
              </select></label>
            </div>
            <label>Engagement<select className="block w-full rounded border p-1" value={searchEngagement} onChange={(event) => setSearchEngagement(event.target.value)}>
              <option value="">All engagements</option>{data.engagements.map(({ id, name, financialYear }) => <option key={id} value={id}>{name} — {financialYear}</option>)}
            </select></label>
            {data.documents.length === 0 && <p>No documents have been added.</p>}
            <div><table className="w-full text-left">
              <thead><tr><th>Sl. No.</th><th>Document name</th><th>Category</th><th>Version</th><th>Uploaded on</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{data.documents.filter((row) => [row.name, row.category, data.categories[row.category] ?? '', displayReference(row), row.fileName, row.keywords ?? '']
              .some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
              && (!searchCategory || row.category === searchCategory)
              && (!searchYear || (row.documentYear ?? '').toLocaleLowerCase().includes(searchYear.trim().toLocaleLowerCase()))
              && (!searchStatus || row.verificationStatus === searchStatus)
              && (!searchEngagement || row.engagementIds.includes(searchEngagement)))
              .map((row, index) => <tr key={row.versionId}>
                <td>{index + 1}</td><td>{row.name}<br /><span className="text-xs">{displayReference(row)}</span></td>
                <td>{row.category}</td><td>{row.version}</td><td>{row.uploadedAt}</td><td>{row.verificationStatus}</td>
                <td><button type="button" className="text-blue-700 underline" onClick={() => void openPreview(row.versionId)}>View</button>
                {' · '}<button type="button" className="text-blue-700 underline" onClick={() => void download(row.versionId)}>Download</button>
                {' · '}<button type="button" className="text-blue-700 underline" onClick={() => setEditing(editing === row.versionId ? '' : row.versionId)}>✎ Edit</button></td>
              </tr>)}</tbody>
            </table></div>
            <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(''); }}>
              <DialogContent className="pf-modal max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogTitle>Edit document metadata</DialogTitle><DialogDescription>Changes to engagement links apply to every version.</DialogDescription>
                {data.documents.filter((row) => row.versionId === editing).map((row) => <div key={row.versionId} className="space-y-3">
                  <DocumentMetadata clientId={clientId} document={row} engagements={data.engagements}
                    request={request} onSaved={async () => { setEditing(''); await load(); }} />
                  <button type="button" className="rounded border" onClick={() => {
                    setDocumentId(row.id); setEditing(''); setUploadOpen(true);
                  }}>Upload new version</button>
                </div>)}
              </DialogContent>
            </Dialog>
          </section>
          </div>
        </div>
      )}
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="pf-modal max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogTitle>Document preview</DialogTitle><DialogDescription>{preview?.name}</DialogDescription>
          {preview?.type === 'application/pdf' ? <iframe title="Document preview" sandbox="" src={preview.url} className="h-[65vh] w-full border" /> :
            preview?.type ? <img src={preview.url} alt="Document preview" className="mx-auto max-h-[65vh] max-w-full object-contain" /> :
              <p>Preview is not available for this file type. Download it to view it.</p>}
          {preview && <a className="text-blue-700 underline" href={preview.url} download={preview.name}>Download document</a>}
        </DialogContent>
      </Dialog>
    </main>
  );
}
