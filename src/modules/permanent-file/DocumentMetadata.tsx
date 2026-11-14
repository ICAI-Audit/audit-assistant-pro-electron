import { useState } from 'react';
import type { PermanentDocument, PermanentFileData, PermanentFileRequest } from './types';
import { todayLocal } from './date';

type Props = {
  clientId: string;
  document: PermanentDocument;
  engagements: { id: string; name: string; financialYear: string }[];
  request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  onSaved: () => Promise<void>;
};

export default function DocumentMetadata({ clientId, document, engagements, request, onSaved }: Props) {
  const [status, setStatus] = useState(document.verificationStatus);
  const [reviewed, setReviewed] = useState(document.reviewedDate ?? '');
  const [expiry, setExpiry] = useState(document.expiryDate ?? '');
  const [year, setYear] = useState(document.documentYear ?? '');
  const [keywords, setKeywords] = useState(document.keywords ?? '');
  const [links, setLinks] = useState(document.engagementIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await request({
        action: 'updateMetadata', clientId, versionId: document.versionId, verificationStatus: status,
        reviewedDate: reviewed || null, expiryDate: expiry || null, documentYear: year.trim() || null,
        keywords: keywords.trim() || null, engagementIds: links,
      });
      if (!('updated' in result)) throw new Error('Unexpected metadata response.');
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Metadata could not be saved.');
    } finally { setBusy(false); }
  }
  return <div className="space-y-2 rounded border p-2">
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="grid gap-2 sm:grid-cols-2">
      <label>Status<select className="block w-full rounded border p-1" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="unverified">Unverified</option><option value="verified">Verified</option><option value="rejected">Rejected</option>
      </select></label>
      <label>Document year<input className="block w-full rounded border p-1" value={year} onChange={(event) => setYear(event.target.value)} /></label>
      <label>Reviewed date<input className="block w-full rounded border p-1" type="date" max={todayLocal()} value={reviewed} onChange={(event) => setReviewed(event.target.value)} /></label>
      <label>Expiry date<input className="block w-full rounded border p-1" type="date" max={todayLocal()} value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
    </div>
    <label className="block">Keywords<input className="block w-full rounded border p-1" value={keywords} onChange={(event) => setKeywords(event.target.value)} /></label>
    <fieldset><legend>Linked engagements (applies to all versions)</legend>
      {engagements.map(({ id, name, financialYear }) => <label key={id} className="block">
        <input type="checkbox" checked={links.includes(id)} onChange={(event) => setLinks(event.target.checked ? [...links, id] : links.filter((item) => item !== id))} /> {name} — {financialYear}
      </label>)}
    </fieldset>
    <button type="button" className="rounded border px-2 py-1 disabled:opacity-50" onClick={() => void save()} disabled={busy}>Save metadata</button>
  </div>;
}
