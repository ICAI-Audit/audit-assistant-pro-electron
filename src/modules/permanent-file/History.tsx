import { useCallback, useEffect, useState } from 'react';
import type { HistoryChange, HistoryRecord, PermanentDocument, PermanentFileData, PermanentFileRequest } from './types';
import { exportHistoryExcel, exportHistoryPdf } from './report';
import { todayLocal } from './date';
import { displayReference } from './display';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const kinds: Record<string, string> = {
  director: 'Director', kmp: 'Key management personnel', partner: 'Partner',
  shareholder: 'Shareholder', beneficial_owner: 'Beneficial owner', related_party: 'Related party',
  group_company: 'Group company', committee: 'Board or committee', authorized_signatory: 'Authorised signatory',
};

type Props = {
  clientId: string;
  clientName: string;
  documents: PermanentDocument[];
  request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  reportOpen: boolean;
  onReportOpenChange: (open: boolean) => void;
  onPreview: (versionId: string) => void;
};

export default function History({ clientId, clientName, documents, request, reportOpen, onReportOpenChange, onPreview }: Props) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('director');
  const [predecessorId, setPredecessorId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [versionId, setVersionId] = useState('');
  const [previousDate, setPreviousDate] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [report, setReport] = useState<{ changes: HistoryChange[]; records: HistoryRecord[]; date: string } | null>(null);

  const load = useCallback(async () => {
    const result = await request({ action: 'history', clientId });
    if (!('history' in result)) throw new Error('Unexpected ownership history response.');
    return result.history;
  }, [clientId, request]);

  useEffect(() => {
    let active = true;
    load().then((rows) => { if (active) setHistory(rows); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load history.'); });
    return () => { active = false; };
  }, [load]);

  async function save() {
    setError('');
    setMessage('');
    if (!name.trim() || !from) {
      setError('Enter a name and effective start date.');
      return;
    }
    const predecessor = history.find((row) => row.id === predecessorId);
    setBusy(true);
    try {
      const result = await request({
        action: 'addHistory', clientId, entry: {
          kind: predecessor?.kind ?? kind,
          subjectId: predecessor?.subjectId ?? crypto.randomUUID(),
          predecessorId: predecessor?.id,
          effectiveFrom: from, effectiveUntil: until || null,
          attributes: { name: name.trim(), details: details.trim(), ...(versionId ? { documentVersionId: versionId } : {}) },
        },
      });
      if (!('historyId' in result)) throw new Error('Unexpected save response.');
      setHistory(await load());
      setName(''); setDetails(''); setFrom(''); setUntil(''); setVersionId(''); setPredecessorId('');
      setReport(null);
      setFormOpen(false);
      setMessage('Ownership or management record saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save record.');
    } finally { setBusy(false); }
  }

  async function compare() {
    setError('');
    setReport(null);
    setFormOpen(false);
    setBusy(true);
    try {
      const result = await request({ action: 'compareHistory', clientId, previousDate, currentDate });
      if (!('changes' in result)) throw new Error('Unexpected comparison response.');
      setReport({ changes: result.changes, records: result.records, date: currentDate });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to compare records.');
    } finally { setBusy(false); }
  }

  async function endRecord() {
    setError('');
    setMessage('');
    if (!predecessorId || !from) {
      setError('Select an open record and enter its exclusive end date in Effective from.');
      return;
    }
    setBusy(true);
    try {
      const result = await request({ action: 'endHistory', clientId, historyId: predecessorId, effectiveUntil: from });
      if (!('ended' in result)) throw new Error('Unexpected end record response.');
      setHistory(await load());
      setPredecessorId(''); setName(''); setDetails(''); setFrom(''); setUntil(''); setVersionId('');
      setReport(null);
      setFormOpen(false);
      setMessage('Record ended; its history was retained.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to end record.');
    } finally { setBusy(false); }
  }

  return <section className="pf-card space-y-3">
    <div className="flex items-center justify-between gap-2"><h2>Ownership &amp; Management History</h2>
    <button type="button" className="pf-primary" onClick={() => {
      setError(''); setPredecessorId(''); setName(''); setDetails(''); setFrom(''); setUntil(''); setVersionId(''); setFormOpen(true);
    }}>+ Add Record</button></div>
    <p className="text-xs text-muted-foreground">End dates are exclusive; select an open record to record a change.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status">{message}</p>}
    <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="pf-modal max-h-[85vh] overflow-y-auto sm:max-w-2xl">
    <DialogTitle>{predecessorId ? 'Edit ownership record' : 'Add ownership record'}</DialogTitle>
    <DialogDescription>Save a new effective-dated record or end an open tenure.</DialogDescription>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="grid gap-2 sm:grid-cols-3">
    {predecessorId && <p>Recording a change to the selected open record.</p>}
    {!predecessorId && <label className="block">Category
      <select className="block w-full rounded border bg-background p-1.5" value={kind} onChange={(event) => setKind(event.target.value)}>
        {Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>}
    <label className="block">Name<input className="block w-full rounded border bg-background p-1.5" value={name} onChange={(event) => setName(event.target.value)} /></label>
    </div>
    <label className="block">Details (role, ownership, relationship or basis)
      <textarea rows={2} className="block w-full rounded border bg-background p-1.5" value={details} onChange={(event) => setDetails(event.target.value)} />
    </label>
    <div className="grid gap-2 sm:grid-cols-3">
    <label className="block">Effective from<input className="block w-full rounded border bg-background p-1.5" type="date" max={todayLocal()} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
    <label className="block">Until (exclusive)<input className="block w-full rounded border bg-background p-1.5" type="date" max={todayLocal()} value={until} onChange={(event) => setUntil(event.target.value)} /></label>
    <label className="block">Supporting document version (optional)
      <select className="block w-full rounded border bg-background p-1.5" value={versionId} onChange={(event) => setVersionId(event.target.value)}>
        <option value="">None</option>
        {documents.map((document) => <option key={document.versionId} value={document.versionId}>{document.name} — {displayReference(document)}</option>)}
      </select>
    </label>
    </div>
    <button type="button" className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={() => void save()}>Save record</button>
    {predecessorId && <button type="button" className="ml-2 rounded border px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => void endRecord()}>End selected record on Effective from date</button>}
    <button type="button" className="ml-2 rounded border px-3 py-2" onClick={() => setFormOpen(false)}>Cancel</button>
    </DialogContent></Dialog>
    <h3 className="font-medium">Saved history</h3>
    {history.length === 0 && <p>No ownership or management records saved.</p>}
    {history.length > 0 && <div><table className="w-full text-left">
      <thead><tr><th>Sl. No.</th><th>Name</th><th>Category</th><th>Effective from</th><th>Until</th><th>Action</th></tr></thead>
      <tbody>{history.map((row, index) => <tr key={row.id}>
        <td>{index + 1}</td><td>{row.attributes.name}</td><td>{kinds[row.kind]}</td><td>{row.effectiveFrom}</td><td>{row.effectiveUntil ?? 'Open'}</td>
        <td><button type="button" disabled={!row.attributes.documentVersionId} onClick={() => row.attributes.documentVersionId && onPreview(row.attributes.documentVersionId)}>View Doc</button>
        {' '}{!row.effectiveUntil && <button type="button" aria-label={`Edit ${row.attributes.name}`} className="text-blue-700 underline" onClick={() => {
          setPredecessorId(row.id); setName(row.attributes.name); setDetails(row.attributes.details ?? '');
          setFrom(''); setUntil(''); setVersionId(row.attributes.documentVersionId ?? ''); setFormOpen(true);
        }}>✎ Edit</button>}</td>
      </tr>)}</tbody>
    </table></div>}
    <Dialog open={reportOpen} onOpenChange={onReportOpenChange}><DialogContent className="pf-modal max-h-[85vh] overflow-y-auto sm:max-w-2xl">
    <DialogTitle>Year-End Comparison Report</DialogTitle>
    <DialogDescription>Compare effective records at two financial year-end dates.</DialogDescription>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <label className="block">Previous financial year-end<input className="block rounded border p-2" type="date" max={todayLocal()} value={previousDate} onChange={(event) => { setPreviousDate(event.target.value); setReport(null); }} /></label>
    <label className="block">Current financial year-end<input className="block rounded border p-2" type="date" max={todayLocal()} value={currentDate} onChange={(event) => { setCurrentDate(event.target.value); setReport(null); }} /></label>
    <button type="button" className="rounded border px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => void compare()}>Generate report</button>
    {report && <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border bg-background px-2 py-1" onClick={() => {
          try { exportHistoryPdf(clientName, previousDate, report.date, report.records, report.changes); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF export failed.'); }
        }}>Export PDF</button>
        <button type="button" className="rounded border bg-background px-2 py-1" onClick={() => {
          try { exportHistoryExcel(clientName, previousDate, report.date, report.records, report.changes); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Excel export failed.'); }
        }}>Export Excel</button>
      </div>
      <h4 className="font-medium">Records effective on {report.date}</h4>
      {report.records.length === 0 && <p>No records effective at this date.</p>}
      {report.records.map((row) => <p key={row.id}>{kinds[row.kind]}: {row.attributes.name} — {row.attributes.details}</p>)}
      <h4 className="font-medium">Changes since {previousDate}</h4>
      {report.changes.length === 0 && <p>No changes at the selected year-ends.</p>}
      {report.changes.map((change) => <p key={`${change.kind}-${change.subjectId}`}>
        {kinds[change.kind]}: {change.after?.name ?? change.before?.name} — {change.change}
        {change.change === 'changed' && ` (before: ${change.before?.details ?? ''}; after: ${change.after?.details ?? ''})`}
      </p>)}
    </div>}
    </DialogContent></Dialog>
  </section>;
}
