import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ExternalLink, Pencil, Plus, Users } from 'lucide-react';
import type { HistoryChange, HistoryRecord, PermanentDocument, PermanentFileData, PermanentFileRequest } from './types';
import { exportHistoryExcel, exportHistoryPdf } from './report';
import { todayLocal } from './date';
import { displayReference } from './display';
import { OWNERSHIP_KINDS, formatDisplayDate, kindLabel } from './format';
import { validateOwnershipDates } from './validation';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, Td, Th, Tr } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalCancel, ModalFooter } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import { SectionCard, SectionCardBody, SectionCardHeader } from '@/components/ui/section-card';
import { toast } from '@/components/ui/sonner';

type Props = {
  clientId: string;
  clientName: string;
  documents: PermanentDocument[];
  request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  reportOpen: boolean;
  onReportOpenChange: (open: boolean) => void;
  onPreview: (versionId: string) => void;
};

type Form = { kind: string; name: string; details: string; from: string; until: string; versionId: string };
const blank: Form = { kind: 'director', name: '', details: '', from: '', until: '', versionId: '' };

export default function History({ clientId, clientName, documents, request, reportOpen, onReportOpenChange, onPreview }: Props) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [reportError, setReportError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [predecessorId, setPredecessorId] = useState('');
  const [form, setForm] = useState<Form>(blank);
  const [initial, setInitial] = useState<Form>(blank);
  const [attempted, setAttempted] = useState<'save' | 'end' | null>(null);
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
      .catch((cause: unknown) => { if (active) setLoadError(cause instanceof Error ? cause.message : 'Unable to load history.'); });
    return () => { active = false; };
  }, [load]);

  const patch = (changes: Partial<Form>) => setForm((old) => ({ ...old, ...changes }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function openForm(next: Form, predecessor = '') {
    setForm(next); setInitial(next); setPredecessorId(predecessor);
    setAttempted(null); setFormError(''); setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false); setPredecessorId(''); setAttempted(null); setFormError('');
  }

  const dateErrors = validateOwnershipDates({ from: form.from, until: form.until, today: todayLocal() });
  const nameError = attempted && !form.name.trim() ? 'Enter a name.' : undefined;
  const fromError = dateErrors.from ?? (attempted && !form.from
    ? (attempted === 'end' ? 'Enter the end date in Effective from.' : 'Choose the effective start date.') : undefined);

  async function save() {
    setAttempted('save');
    setFormError('');
    if (!form.name.trim() || !form.from || dateErrors.from || dateErrors.until) return;
    const predecessor = history.find((row) => row.id === predecessorId);
    setBusy(true);
    try {
      const result = await request({
        action: 'addHistory', clientId, entry: {
          kind: predecessor?.kind ?? form.kind,
          subjectId: predecessor?.subjectId ?? crypto.randomUUID(),
          predecessorId: predecessor?.id,
          effectiveFrom: form.from, effectiveUntil: form.until || null,
          attributes: { name: form.name.trim(), details: form.details.trim(), ...(form.versionId ? { documentVersionId: form.versionId } : {}) },
        },
      });
      if (!('historyId' in result)) throw new Error('Unexpected save response.');
      setHistory(await load());
      setReport(null);
      closeForm();
      toast.success('Ownership or management record saved.');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to save record.');
    } finally { setBusy(false); }
  }

  async function endRecord() {
    setAttempted('end');
    setFormError('');
    if (!predecessorId || !form.from || dateErrors.from) return;
    setBusy(true);
    try {
      const result = await request({ action: 'endHistory', clientId, historyId: predecessorId, effectiveUntil: form.from });
      if (!('ended' in result)) throw new Error('Unexpected end record response.');
      setHistory(await load());
      setReport(null);
      closeForm();
      toast.success('Record ended; its history was retained.');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to end record.');
    } finally { setBusy(false); }
  }

  async function compare() {
    setReportError('');
    setReport(null);
    setBusy(true);
    try {
      const result = await request({ action: 'compareHistory', clientId, previousDate, currentDate });
      if (!('changes' in result)) throw new Error('Unexpected comparison response.');
      setReport({ changes: result.changes, records: result.records, date: currentDate });
    } catch (cause) {
      setReportError(cause instanceof Error ? cause.message : 'Unable to compare records.');
    } finally { setBusy(false); }
  }

  const addButton = <Button type="button" onClick={() => openForm(blank)}><Plus aria-hidden="true" /> Add record</Button>;

  return <SectionCard>
    <SectionCardHeader title="Ownership & Management History"
      description="End dates are exclusive. Select an open record to record a change."
      actions={addButton} />
    <SectionCardBody className="space-y-3">
      {loadError && <p role="alert" className="text-body-sm text-destructive">{loadError}</p>}
      {history.length === 0 && !loadError && <EmptyState icon={Users} title="No ownership or management records saved"
        description="Record directors, shareholders, partners and other people with an effective-dated role." action={addButton} />}
      {history.length > 0 && <>
        <DataTable label="Ownership and management history" minWidth={560}>
          <thead><tr>
            <Th className="w-14">Sl. No.</Th><Th>Name</Th><Th>Category</Th><Th>Effective from</Th><Th>Until</Th><Th className="text-right">Action</Th>
          </tr></thead>
          <tbody>{history.map((row, index) => {
            const documentVersionId = row.attributes.documentVersionId;
            const kind = OWNERSHIP_KINDS[row.kind];
            return <Tr key={row.id}>
              <Td className="tabular-nums text-subtle">{index + 1}</Td>
              <Td className="min-w-[9rem]">
                <span className="font-medium">{row.attributes.name}</span>
                {row.attributes.details && <span className="mt-0.5 line-clamp-2 block text-xs text-subtle">{row.attributes.details}</span>}
              </Td>
              <Td><Badge variant={kind?.tone ?? 'neutral'} className="text-center">{kindLabel(row.kind)}</Badge></Td>
              <Td className="!whitespace-nowrap tabular-nums">{formatDisplayDate(row.effectiveFrom)}</Td>
              <Td className="!whitespace-nowrap tabular-nums">{row.effectiveUntil ? formatDisplayDate(row.effectiveUntil)
                : <Badge variant="success" className="whitespace-nowrap"><span aria-hidden="true" className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success" />Open</Badge>}</Td>
              <Td><div className="flex items-center justify-end gap-1">
                {documentVersionId && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-primary"
                  aria-label={`View document for ${row.attributes.name}`} onClick={() => onPreview(documentVersionId)}>
                  View doc <ExternalLink aria-hidden="true" /></Button>}
                {!row.effectiveUntil && <Button type="button" variant="ghost" size="sm" className="h-8 px-2" aria-label={`Edit ${row.attributes.name}`}
                  onClick={() => openForm({ ...blank, name: row.attributes.name, details: row.attributes.details ?? '', versionId: documentVersionId ?? '' }, row.id)}>
                  <Pencil aria-hidden="true" /> Edit</Button>}
              </div></Td>
            </Tr>;
          })}</tbody>
        </DataTable>
        <p className="text-xs text-subtle">{history.length} record{history.length === 1 ? '' : 's'} · Saved history</p>
      </>}
    </SectionCardBody>

    <Modal open={formOpen} onOpenChange={(open) => { if (!open) closeForm(); }} dirty={dirty} onSubmit={() => void save()}
      title={predecessorId ? 'Edit ownership record' : 'Add ownership record'}
      description="Save a new effective-dated record or end an open tenure."
      footer={<ModalFooter>
        <ModalCancel />
        {predecessorId && <Button type="button" variant="outline" disabled={busy} onClick={() => void endRecord()}>End record on Effective from date</Button>}
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save record'}</Button>
      </ModalFooter>}>
      {formError && <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-body-sm text-danger-ink">{formError}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {predecessorId
          ? <p className="text-body-sm text-subtle sm:col-span-2">Recording a change to the selected open record.</p>
          : <Field label="Category" required>{(c) => <NativeSelect {...c} value={form.kind} onChange={(e) => patch({ kind: e.target.value })}>
            {Object.entries(OWNERSHIP_KINDS).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
          </NativeSelect>}</Field>}
        <Field label="Name" required error={nameError}>{(c) => <Input {...c} placeholder="Full name" value={form.name} onChange={(e) => patch({ name: e.target.value })} />}</Field>
      </div>
      <Field label="Details">{(c) => <AutoGrowTextarea {...c} placeholder="Role, ownership, relationship or basis" value={form.details} onChange={(e) => patch({ details: e.target.value })} />}</Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Effective from" required error={fromError}>{(c) => <Input {...c} type="date" max={todayLocal()} value={form.from} onChange={(e) => patch({ from: e.target.value })} />}</Field>
        <Field label="Until (exclusive)" error={dateErrors.until} hint="Leave blank if the record is still open.">{(c) => <Input {...c} type="date" max={todayLocal()} value={form.until} onChange={(e) => patch({ until: e.target.value })} />}</Field>
      </div>
      <Field label="Supporting document version" optional>{(c) => <NativeSelect {...c} value={form.versionId} onChange={(e) => patch({ versionId: e.target.value })}>
        <option value="">None</option>
        {documents.map((document) => <option key={document.versionId} value={document.versionId}>{document.name} — {displayReference(document)}</option>)}
      </NativeSelect>}</Field>
    </Modal>

    <Modal open={reportOpen} onOpenChange={onReportOpenChange} size="lg" title="Year-End Comparison Report"
      description="Compare effective records at two financial year-end dates."
      onSubmit={() => void compare()}
      footer={<ModalFooter note={!previousDate || !currentDate ? 'Choose both year-end dates to generate the report.' : undefined}>
        <ModalCancel>Close</ModalCancel>
        <Button type="submit" disabled={busy || !previousDate || !currentDate}><BarChart3 aria-hidden="true" /> Generate report</Button>
      </ModalFooter>}>
      {reportError && <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-body-sm text-danger-ink">{reportError}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Previous financial year-end" required>{(c) => <Input {...c} type="date" max={todayLocal()} value={previousDate} onChange={(e) => { setPreviousDate(e.target.value); setReport(null); }} />}</Field>
        <Field label="Current financial year-end" required>{(c) => <Input {...c} type="date" max={todayLocal()} value={currentDate} onChange={(e) => { setCurrentDate(e.target.value); setReport(null); }} />}</Field>
      </div>
      {report && <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => {
            try { exportHistoryPdf(clientName, previousDate, report.date, report.records, report.changes); }
            catch (cause) { setReportError(cause instanceof Error ? cause.message : 'PDF export failed.'); }
          }}>Export PDF</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            try { exportHistoryExcel(clientName, previousDate, report.date, report.records, report.changes); }
            catch (cause) { setReportError(cause instanceof Error ? cause.message : 'Excel export failed.'); }
          }}>Export Excel</Button>
        </div>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Records effective on {formatDisplayDate(report.date)}</h3>
          {report.records.length === 0 && <p className="text-body-sm text-subtle">No records effective at this date.</p>}
          <ul className="space-y-1.5">{report.records.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
            <Badge variant={OWNERSHIP_KINDS[row.kind]?.tone ?? 'neutral'}>{kindLabel(row.kind)}</Badge>
            <span className="font-medium">{row.attributes.name}</span>
            {row.attributes.details && <span className="text-subtle">— {row.attributes.details}</span>}
          </li>)}</ul>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Changes since {formatDisplayDate(previousDate)}</h3>
          {report.changes.length === 0 && <p className="text-body-sm text-subtle">No changes at the selected year-ends.</p>}
          <ul className="space-y-1.5">{report.changes.map((change) => <li key={`${change.kind}-${change.subjectId}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
            <Badge variant={OWNERSHIP_KINDS[change.kind]?.tone ?? 'neutral'}>{kindLabel(change.kind)}</Badge>
            <span className="font-medium">{change.after?.name ?? change.before?.name}</span>
            <Badge variant={change.change === 'added' ? 'success' : change.change === 'removed' ? 'danger' : 'warning'}>{change.change}</Badge>
            {change.change === 'changed' && <span className="text-subtle">(before: {change.before?.details ?? ''}; after: {change.after?.details ?? ''})</span>}
          </li>)}</ul>
        </section>
      </div>}
    </Modal>
  </SectionCard>;
}
