import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, Info, X } from 'lucide-react';
import { useEngagement } from '@/contexts/EngagementContext';
import type { ListData, PermanentFileData, PermanentFileRequest } from '@/modules/permanent-file/types';
import History from '@/modules/permanent-file/History';
import Documents from '@/modules/permanent-file/Documents';
import Entity from '@/modules/permanent-file/Entity';
import { requireCurrentListResponse } from '@/modules/permanent-file/response';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Modal, ModalCancel, ModalFooter } from '@/components/ui/modal';
import { SectionCard, SectionCardBody, SectionCardHeader } from '@/components/ui/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';

async function request(payload: PermanentFileRequest): Promise<PermanentFileData> {
  const result = await window.electronAPI.permanentFile.request(payload);
  if ('error' in result) throw new Error(result.error);
  return result.data;
}

// Dismissal lasts until the app is restarted: the notice says verification is still open.
let betaNoticeDismissed = false;

export default function PermanentFile() {
  const { currentEngagement, refreshEngagements } = useEngagement();
  const clientId = currentEngagement?.client_id;
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(betaNoticeDismissed);
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
    setReportOpen(false); setPreview(null);
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function openPreview(versionId: string) {
    if (!clientId) return;
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
      if (token === generation.current) toast.error(cause instanceof Error ? cause.message : 'Preview failed.');
    }
  }

  async function download(versionId: string) {
    if (!clientId) return;
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
      if (token === generation.current) toast.error(cause instanceof Error ? cause.message : 'Download failed.');
    }
  }

  const clientName = data?.client.name ?? currentEngagement?.client_name ?? 'Not selected';
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5 text-body-sm">
      <header className="space-y-3">
        <Breadcrumb>
          <BreadcrumbList className="text-xs text-subtle sm:gap-1.5">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/select-engagement">Clients</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><span className="max-w-[28ch] truncate">{clientName}</span></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Permanent File</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">Permanent File</h1>
              <Badge variant="info" className="px-2 py-0 text-[10px] font-semibold uppercase tracking-wider">Beta</Badge>
            </div>
            <p className="text-subtle">Standing records and documents kept for this client across engagements.</p>
          </div>
          <Button type="button" variant="outline" disabled={!data} onClick={() => setReportOpen(true)}>
            <BarChart3 aria-hidden="true" /> Year-End Comparison Report
          </Button>
        </div>
      </header>

      {!noticeDismissed && <div role="note" className="flex items-start gap-3 rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-info-ink">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="flex-1">Permanent File is under development. Use test data while verification continues.</p>
        <button type="button" aria-label="Dismiss notice" onClick={() => { betaNoticeDismissed = true; setNoticeDismissed(true); }}
          className="-m-1 rounded-md p-1 ring-offset-background transition-colors duration-150 hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>}

      {!clientId && <p role="alert" className="rounded-lg border bg-card p-6 text-center text-subtle">Select an engagement linked to a client.</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-4 text-danger-ink">{error}</p>}
      {data?.storageWarning && <div role="alert" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-warning-ink">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Some permanent-file storage requires administrator review. Do not delete files; check backups.</p>
      </div>}

      {clientId && !data && !error && <div className="space-y-5" aria-busy="true" aria-label="Loading permanent file">
        <SectionCard><SectionCardHeader title="Client Details" /><SectionCardBody className="space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/5" /></SectionCardBody></SectionCard>
        <SectionCard><SectionCardHeader title="Ownership & Management History" /><SectionCardBody className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></SectionCardBody></SectionCard>
        <SectionCard><SectionCardHeader title="Documents & Versions" /><SectionCardBody className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></SectionCardBody></SectionCard>
      </div>}

      {data && clientId && <>
        <Entity key={clientId} clientId={clientId} request={request} onMasterSaved={async (clientName) => {
          setData((old) => old && old.client.id === clientId ? { ...old, client: { ...old.client, name: clientName } } : old);
          await refreshEngagements();
        }} />
        <History key={clientId} clientId={clientId} clientName={data.client.name} documents={data.documents} request={request}
          reportOpen={reportOpen} onReportOpenChange={setReportOpen} onPreview={(versionId) => void openPreview(versionId)} />
        <Documents key={clientId} clientId={clientId} data={data} engagementId={currentEngagement?.id} request={request}
          onChanged={load} onPreview={(versionId) => void openPreview(versionId)} onDownload={(versionId) => void download(versionId)} />
      </>}

      <Modal open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }} size="xl" title="Document preview" description={preview?.name}
        footer={<ModalFooter>
          <ModalCancel>Close</ModalCancel>
          {preview && <Button asChild><a href={preview.url} download={preview.name}>Download document</a></Button>}
        </ModalFooter>}>
        {preview?.type === 'application/pdf' ? <iframe title="Document preview" sandbox="" src={preview.url} className="h-[65vh] w-full rounded-lg border" /> :
          preview?.type ? <img src={preview.url} alt="Document preview" className="mx-auto max-h-[65vh] max-w-full object-contain" /> :
            <p className="text-subtle">Preview is not available for this file type. Download it to view it.</p>}
      </Modal>
    </div>
  );
}
