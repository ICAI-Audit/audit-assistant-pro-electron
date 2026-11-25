// "Review Summary" (BUILD-PLAN tasks 23 and 24), a tab of the Form No. 26 workspace. Top to bottom (side by side
// from 1280 px): "To finish" — what is left to fill or decide, grouped as the clause list groups it, each clause a
// link that opens it, then the review folded into one line per state with its count, each line opening the list of
// its clauses (POLISH-3); the downloads — Form No. 26 as Word and as PDF, the working-paper pack (Word), the save file of the
// office's fillable form (.json), and "Load a save file"; then the 57 clauses with their state, which doubles as
// the review queue. Every file goes through the window's own "Save As" (FIX-T29): the user chooses where first,
// then what waits is saved, the file is made ("Preparing…" on its button, the window painted first, the libraries
// loaded only then) and written; "saved" is said only once it is written, a cancel says "Not saved.", a failure
// is one plain sentence and the button can be used again. A load replaces the answers only after the copy of the
// present answers is saved. No output carries a draft notice (owner's ruling of 22 Nov 2026).
import * as React from 'react';
import { ChevronDown, ChevronRight, Download, FileJson, FileText, FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Form26ImportDialog, type Form26ImportDialogState } from '@/components/tax-audit/form26/Form26ImportDialog';
import type { Form26TabPanelProps } from '@/components/tax-audit/form26/Form26Workspace';
import { Button } from '@/components/ui/button';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { FORM26_REVIEW_LABEL } from '@/lib/taxAuditForm26EditorModel';
import { buildForm26ExportModel } from '@/lib/taxAuditForm26ExportModel';
import {
  form26UnitTitle,
  importSummary,
  importWrites,
  type Form26ImportablePlan,
  type Form26ImportSummary,
} from '@/lib/taxAuditForm26Import';
import { buildForm26Readiness, form26ToFinishView, isUnitInReport, type Form26ReviewKind } from '@/lib/taxAuditForm26Readiness';
import { form26BeforeImportLine, form26DownloadName, form26SaveLine, saveForm26As, type Form26SaveKind } from '@/lib/taxAuditForm26SaveAs';
import { FORM26_SAVE_FILE_MAX_CHARS, FORM26_SAVE_FILE_REFUSALS, planImport, serialiseSaveFile } from '@/lib/taxAuditForm26SaveFile';
import { form26ClauseKeyOfTable } from '@/data/taxAuditForm26Clauses';
import { cn } from '@/lib/utils';

// The application's global table rule cuts every cell with "…" (src/index.css): every heading and cell wraps here.
const TH = '!max-w-none !overflow-visible !whitespace-normal !px-2 !py-1.5 !text-xs !leading-4 break-words align-bottom text-left font-semibold';
const TD = '!max-w-none !overflow-visible !whitespace-normal !px-2 !py-1.5 !text-[13px] !leading-5 break-words align-top';

export type Form26DownloadId = 'word' | 'pdf' | 'pack' | 'json';
const DOWNLOADS: { id: Form26DownloadId; label: string; icon: typeof FileText }[] = [
  { id: 'word', label: 'Form No. 26 — Word', icon: FileText },
  { id: 'pdf', label: 'Form No. 26 — PDF', icon: FileText },
  { id: 'pack', label: 'Working-paper pack', icon: FileText },
  { id: 'json', label: 'Save file (.json)', icon: FileJson },
];
const KIND: Record<Form26DownloadId, Form26SaveKind> = { word: 'docx', pdf: 'pdf', pack: 'docx', json: 'json' };
const DONE: Record<Form26DownloadId, string> = {
  word: 'The Word file was saved.',
  pdf: 'The PDF was saved.',
  pack: 'The working-paper pack was saved.',
  json: 'The save file was saved.',
};
const FAILED: Record<Form26DownloadId, string> = {
  word: 'The Word file could not be made. Try again.',
  pdf: 'The PDF could not be made. Try again.',
  pack: 'The working-paper pack could not be made. Try again.',
  json: 'The save file could not be made. Try again.',
};
const NOT_SAVED = 'Some changes are not saved yet. Save them, or choose which entry to keep, then try again.';

// One frame for the "Preparing…" state to be painted before the long work starts on this thread.
const letPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

type Rows<T> = { data: unknown; error: unknown } & { data: T[] | null };
async function namesAndFiles(engagementId: string, userIds: string[]): Promise<{ users: Record<string, string>; files: { id: string; name: string }[] }> {
  const db = getSQLiteClient();
  const [profiles, files] = await Promise.all([
    userIds.length > 0 ? (db.from('profiles').select('user_id, full_name').in('user_id', userIds).execute() as unknown as Promise<Rows<{ user_id: string; full_name: string | null }>>) : Promise.resolve({ data: [], error: null }),
    db.from('evidence_files').select('id, name').eq('engagement_id', engagementId).execute() as unknown as Promise<Rows<{ id: string; name: string }>>,
  ]);
  const users: Record<string, string> = {};
  for (const profile of profiles.data ?? []) if (profile.full_name) users[profile.user_id] = profile.full_name;
  return { users, files: (files.data ?? []).map((file) => ({ id: file.id, name: file.name })) };
}

const openLabel = (clause: { title: string; label: string }) => `Open ${clause.title === clause.label ? clause.title : `${clause.title}, ${clause.label}`}`;

type Loading = { fileName: string; plan: Form26ImportablePlan; summary: Form26ImportSummary; changes: number; state: Form26ImportDialogState };

export function Form26ReviewSummary({ form26, openClause, clientName = '', financialYear = '', onViewThreeCdDraft }: Form26TabPanelProps): JSX.Element {
  const { def, values, rowsByKey, evidence, setup } = form26;
  const [busy, setBusy] = React.useState<Form26DownloadId | 'load' | null>(null);
  // The file is being made (after the user chose where): its button says "Preparing…".
  const [preparing, setPreparing] = React.useState(false);
  const [line, setLine] = React.useState<{ text: string; failed: boolean } | null>(null);
  const [loading, setLoading] = React.useState<Loading | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const latest = React.useRef(form26);
  latest.current = form26;

  const conflicts = React.useMemo(
    () => [...new Set([...Object.keys(form26.fieldConflicts).map((key) => FORM26_CLAUSE_UNITS.find((unit) => unit.fields.includes(key))?.key ?? ''), ...Object.keys(form26.tableConflicts).map(form26ClauseKeyOfTable)].filter(Boolean))],
    [form26.fieldConflicts, form26.tableConflicts],
  );
  const readiness = React.useMemo(
    () => buildForm26Readiness({ def, values, rowsByKey, unconfirmed: form26.unconfirmed, view: { showAllSchedules: setup.showAllSchedules }, conflicts }),
    [def, values, rowsByKey, form26.unconfirmed, setup.showAllSchedules, conflicts],
  );
  const toFinish = React.useMemo(() => form26ToFinishView(readiness.items), [readiness.items]);
  const [openStates, setOpenStates] = React.useState<ReadonlySet<Form26ReviewKind>>(() => new Set());
  const toggleState = (kind: Form26ReviewKind) =>
    setOpenStates((now) => {
      const next = new Set(now);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const evidenceByClause = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of evidence) counts.set(link.clause_key, (counts.get(link.clause_key) ?? 0) + 1);
    return counts;
  }, [evidence]);

  const say = (text: string, failed = false, withToast = true) => {
    setLine({ text, failed });
    if (!withToast) return;
    if (failed) toast.error(text);
    else toast.success(text);
  };

  // Called straight from the click: the save window must open before anything is awaited.
  const download = async (id: Form26DownloadId) => {
    if (busy) return;
    setBusy(id);
    setLine(null);
    try {
      const result = await saveForm26As({
        name: form26DownloadName(id, latest.current.values),
        kind: KIND[id],
        onPicked: () => setPreparing(true),
        ready: async () => {
          if (!(await latest.current.flush())) return false;
          await letPaint();
          return true;
        },
        make: () => makeFile(id),
      });
      if (result.outcome === 'failed') console.error(`Form No. 26 ${id} file:`, result.error);
      const shown = form26SaveLine(result, { done: DONE[id], makeFailed: FAILED[id], notReady: NOT_SAVED });
      say(shown.text, shown.failed, shown.toast);
    } finally {
      setPreparing(false);
      setBusy(null);
    }
  };
  const makeFile = async (id: Form26DownloadId): Promise<Blob | string> => {
    const form = latest.current;
    const generatedAt = new Date().toISOString();
    if (id === 'json') return serialiseSaveFile(form.def, form.values);
    if (id === 'pack') {
      const pack = await import('@/lib/taxAuditForm26Pack');
      const rows = [...form.rowsByKey.values()];
      const userIds = [...new Set(rows.flatMap((row) => [row.prepared_by, row.reviewed_by, row.approved_by]).filter((who): who is string => typeof who === 'string' && who !== ''))];
      const { users, files } = await namesAndFiles(form.audit?.engagement_id ?? '', userIds);
      const model = pack.buildForm26Pack({ def: form.def, values: form.values, rowsByKey: form.rowsByKey, evidence: form.evidence, files, users, clientName, financialYear, generatedAt, showAllSchedules: form.setup.showAllSchedules });
      return pack.buildForm26PackDocx(model);
    }
    const model = buildForm26ExportModel(form.def, form.values, { showAllSchedules: form.setup.showAllSchedules, generatedAt });
    if (id === 'word') return (await import('@/lib/taxAuditForm26Word')).buildForm26Docx(model);
    const pdf = await import('@/lib/taxAuditForm26Pdf');
    await letPaint();
    return pdf.buildForm26PdfBlob(model);
  };

  // ---- loading a save file: read and checked first; nothing is written before "Replace the answers".
  const chooseFile = () => {
    if (busy) return;
    setLine(null);
    fileInput.current?.click();
  };
  const fileChosen = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    // A file can hold at most four bytes for each character it has: one larger than that is refused unread.
    if (file.size > FORM26_SAVE_FILE_MAX_CHARS * 4) {
      say(FORM26_SAVE_FILE_REFUSALS.tooLarge, true);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      say(FORM26_SAVE_FILE_REFUSALS.couldNotRead, true);
      return;
    }
    const form = latest.current;
    const plan = planImport(form.def, text, form.values);
    if ('message' in plan) {
      say(plan.message, true);
      return;
    }
    const planned = importWrites(form.def, plan, form.rowsByKey, { category: form.setup.category });
    setLoading({ fileName: file.name, plan, summary: importSummary(form.def, plan, form.values, planned.skippedLocked), changes: planned.writes.length, state: { phase: 'review' } });
  };
  // Called straight from "Replace the answers": the save window for the copy must open before anything is awaited.
  const confirmLoad = async () => {
    const held = loading;
    if (!held || busy) return;
    setBusy('load');
    try {
      // The application keeps no backup of its own (L10): the present answers are saved first, where the user
      // chooses, and nothing is replaced unless that copy is written. A file the audit already matches replaces
      // nothing, so no copy is asked for.
      if (held.changes > 0) {
        const copy = await saveForm26As({
          name: form26DownloadName('before-import', latest.current.values),
          kind: 'json',
          ready: () => latest.current.flush(),
          make: async () => serialiseSaveFile(latest.current.def, latest.current.values),
        });
        if (copy.outcome === 'failed') console.error('Form No. 26 copy before a load:', copy.error);
        const stop = form26BeforeImportLine(copy, NOT_SAVED);
        if (stop !== null) {
          setLoading({ ...held, state: { phase: 'review', notice: stop } });
          return;
        }
      }
      setLoading({ ...held, state: { phase: 'running', done: 0, total: held.changes } });
      const form = latest.current;
      const outcome = await form.applyImport(held.plan, held.fileName, {
        onProgress: (done, total) => setLoading((now) => (now ? { ...now, state: { phase: 'running', done, total } } : now)),
      });
      if ('message' in outcome) {
        setLoading({ ...held, state: { phase: 'failed', message: outcome.message } });
        return;
      }
      setLoading(null);
      say(outcome.sentence);
    } finally {
      setBusy(null);
    }
  };

  const category = setup.category;
  return (
    <section aria-labelledby="f26-summary-title" className="space-y-3 rounded-md border bg-background p-3" data-f26-summary="">
      <h2 id="f26-summary-title" className="text-base font-semibold">
        Review Summary
      </h2>
      {onViewThreeCdDraft && (
        // Task 26: the engagement's earlier Form 3CD draft is kept; a quiet way to see it, read only.
        <p className="text-xs text-subtle" data-f26-summary-3cd-draft="">
          This engagement also holds an earlier Form 3CD draft, kept unchanged.{' '}
          <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={onViewThreeCdDraft} data-f26-view-3cd-draft="">
            View the earlier 3CD draft
          </Button>
        </p>
      )}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section aria-labelledby="f26-to-finish-title" className="min-w-0 space-y-2 rounded-md border p-3" data-f26-to-finish="">
          <h3 id="f26-to-finish-title" className="text-sm font-semibold">
            To finish
          </h3>
          {toFinish.toFill.length === 0 && toFinish.review.length === 0 ? (
            <p className="text-sm" data-f26-ready="">
              Nothing is left to finish.
            </p>
          ) : (
            <div className="space-y-2">
              {toFinish.toFill.map((group) => (
                <div key={group.id} className="space-y-1">
                  <h4 className="text-xs font-semibold text-subtle">{group.title}</h4>
                  <ul className="space-y-1">
                    {group.clauses.map((clause) => (
                      <li key={clause.clauseKey} className="text-[13px] leading-5" data-f26-finish-clause={clause.clauseKey}>
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-[13px] font-medium"
                          onClick={() => openClause(clause.clauseKey)}
                          aria-label={openLabel(clause)}
                          data-f26-finish-link={clause.clauseKey}
                        >
                          {clause.title}
                        </Button>
                        <span className="text-subtle">{` · ${clause.items.map((item) => item.text).join(' · ')}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {toFinish.review.length > 0 && (
                // POLISH-3: the review is said once per state, with its count; the line opens the list of its clauses.
                <div className="space-y-1" data-f26-finish-review-block="">
                  <h4 className="text-xs font-semibold text-subtle">Review</h4>
                  <ul className="space-y-1">
                    {toFinish.review.map((line) => {
                      const open = openStates.has(line.kind);
                      const listId = `f26-finish-review-${line.kind}`;
                      return (
                        <li key={line.kind} className="text-[13px] leading-5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-sm text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-expanded={open}
                            aria-controls={listId}
                            onClick={() => toggleState(line.kind)}
                            data-f26-finish-review={line.kind}
                          >
                            {open ? <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                            {line.text}
                          </button>
                          <ul id={listId} hidden={!open} className={cn('mt-1 flex-wrap gap-x-3 gap-y-0.5 pl-5', open && 'flex')} aria-label={line.text}>
                            {line.clauses.map((clause) => (
                              <li key={clause.clauseKey}>
                                <Button
                                  type="button"
                                  variant="link"
                                  className="h-auto p-0 text-[13px]"
                                  onClick={() => openClause(clause.clauseKey)}
                                  aria-label={openLabel(clause)}
                                  data-f26-finish-review-link={clause.clauseKey}
                                >
                                  {clause.title}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="f26-downloads-title" className="min-w-0 space-y-2 rounded-md border p-3 xl:self-start" data-f26-downloads="">
          <h3 id="f26-downloads-title" className="text-sm font-semibold">
            Downloads
          </h3>
          <div className="flex flex-col gap-1.5">
            {DOWNLOADS.map((entry) => {
              const Icon = entry.icon;
              const mine = busy === entry.id;
              return (
                <Button
                  key={entry.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn('h-auto min-h-8 justify-start gap-2 whitespace-normal py-1.5 text-left', busy && !mine && 'opacity-60')}
                  onClick={() => void download(entry.id)}
                  aria-disabled={busy !== null || undefined}
                  data-f26-download={entry.id}
                >
                  {mine && preparing ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" /> : <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
                  {mine && preparing ? 'Preparing…' : entry.label}
                </Button>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn('h-auto min-h-8 justify-start gap-2 whitespace-normal py-1.5 text-left', busy && busy !== 'load' && 'opacity-60')}
              onClick={chooseFile}
              aria-disabled={busy !== null || undefined}
              data-f26-load=""
            >
              <FileUp aria-hidden="true" className="h-4 w-4 shrink-0" />
              Load a save file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Save file to load"
              tabIndex={-1}
              onChange={(event) => void fileChosen(event.target.files?.[0])}
              data-f26-load-input=""
            />
          </div>
          <p role="status" aria-live="polite" className={cn('min-h-5 text-xs', line?.failed ? 'text-destructive' : 'text-subtle')} data-f26-download-line="">
            {line?.text ?? ''}
          </p>
        </section>
      </div>

      <section aria-labelledby="f26-clauses-title" className="space-y-2" data-f26-review-table="">
        <h3 id="f26-clauses-title" className="text-sm font-semibold">
          Clauses
        </h3>
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">The clauses of Form No. 26 with what is left to fill and their review state</caption>
          <colgroup>
            <col style={{ width: '13%' }} />
            <col style={{ width: '43%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {['Clause', 'Subject', 'Unfilled', 'State', 'Evidence', 'Qualified'].map((heading) => (
                <th key={heading} scope="col" className={TH}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FORM26_CLAUSE_UNITS.map((unit) => {
              const row = rowsByKey.get(unit.key);
              const inReport = isUnitInReport(unit, values);
              const toFill = form26.counts.clause[unit.key] ?? 0;
              const title = form26UnitTitle(unit);
              return (
                <tr key={unit.key} className="border-b border-border/60" data-f26-review-row={unit.key}>
                  <td className={cn(TD, 'tabular-nums')}>
                    <Button type="button" variant="link" className="h-auto whitespace-normal p-0 text-left text-[13px] font-medium" onClick={() => openClause(unit.key)} aria-label={`Open ${title === unit.label ? title : `${title}, ${unit.label}`}`}>
                      {title}
                    </Button>
                  </td>
                  <td className={TD}>{title === unit.label ? '' : unit.label}</td>
                  <td className={cn(TD, 'tabular-nums')}>{inReport ? (toFill > 0 ? toFill.toLocaleString('en-IN') : 'None') : `Not in a category (${category === '1' ? 'i' : 'ii'}) report`}</td>
                  <td className={TD}>{FORM26_REVIEW_LABEL[row?.review_status ?? 'draft']}</td>
                  <td className={cn(TD, 'tabular-nums')}>{(evidenceByClause.get(unit.key) ?? 0) > 0 ? (evidenceByClause.get(unit.key) ?? 0).toLocaleString('en-IN') : 'None'}</td>
                  <td className={TD}>{row?.qualification_required ? 'Yes' : 'No'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {loading && (
        <Form26ImportDialog
          open
          fileName={loading.fileName}
          summary={loading.summary}
          changes={loading.changes}
          state={loading.state}
          onConfirm={() => void confirmLoad()}
          onCancel={() => setLoading(null)}
        />
      )}
    </section>
  );
}
