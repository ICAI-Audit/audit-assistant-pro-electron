// The Form No. 26 draft of an engagement whose year was changed back to before 2026-27 (BUILD-PLAN task 26):
// shown read only, as the Word export lays it out (the one export model, task 21), with "Save file (.json)"
// so its answers can be kept or loaded elsewhere. The rows are only SELECTED (`readForm26Draft`); nothing on
// this view writes: no box, no choice, no review control. Loaded lazily from Form26DraftNotice (the Tax Audit
// page's start-up bundle never carries the definition).
import * as React from 'react';
import { FileJson, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { buildForm26ExportModel, type Form26ExportBlock, type Form26ExportModel, type Form26Run } from '@/lib/taxAuditForm26ExportModel';
import { saveFileName, serialiseSaveFile } from '@/lib/taxAuditForm26SaveFile';
import { form26SaveLine, saveForm26As } from '@/lib/taxAuditForm26SaveAs';
import { createForm26Store, type Form26Draft } from '@/lib/taxAuditForm26Store';
import { cn } from '@/lib/utils';

// Every cell overrides the application's global table rule (one line, cut with "…"): nothing is cut here.
const CELL = '!max-w-none !overflow-visible !whitespace-normal break-words border border-border px-1.5 py-1 align-top text-xs';

function Runs({ runs }: { runs: Form26Run[] }): JSX.Element {
  return (
    <>
      {runs.map((run, index) => (
        <React.Fragment key={index}>
          <span className={cn('whitespace-pre-wrap', run.bold && 'font-semibold', run.italic && 'italic', run.underline && 'underline', run.small && 'text-xs')}>{run.text}</span>
          {run.breakAfter && <br />}
        </React.Fragment>
      ))}
    </>
  );
}

function Block({ block }: { block: Form26ExportBlock }): JSX.Element | null {
  switch (block.kind) {
    case 'heading': {
      const Tag = block.level <= 2 ? 'h3' : 'h4';
      return <Tag className={cn('font-semibold', block.level <= 2 ? 'text-sm' : 'text-[13px]', block.centred && 'text-center', block.underlined && 'underline')}>{block.text}</Tag>;
    }
    case 'para':
      return (
        <p className={cn('text-sm leading-5', block.centred && 'text-center', block.indent && 'pl-6', block.small && 'text-xs text-subtle')}>
          <Runs runs={block.runs} />
        </p>
      );
    case 'questions':
      return (
        <div className="divide-y divide-border/60 rounded-md border border-border">
          {block.rows.map((row) =>
            row.fullWidth ? (
              <div key={row.index} className="space-y-2 p-2">
                {row.fullWidth.map((inner, index) => <Block key={index} block={inner} />)}
              </div>
            ) : (
              <div key={row.index} className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,40%)] gap-2 p-2 text-sm">
                <span className="font-semibold tabular-nums">{row.no}</span>
                <span className="min-w-0 break-words">
                  <Runs runs={row.wording} />
                </span>
                <span className="min-w-0 break-words">
                  <Runs runs={row.answer} />
                </span>
              </div>
            ),
          )}
        </div>
      );
    case 'table':
      return (
        <table className="w-full border-collapse" data-f26-readonly-table={block.id || undefined}>
          <thead>
            {block.head.map((cells, r) => (
              <tr key={r}>
                {cells.map((cell, c) =>
                  cell.tag === 'th' ? (
                    <th key={c} colSpan={cell.colspan} rowSpan={cell.rowspan} className={cn(CELL, 'bg-muted/40 text-left font-semibold')}>
                      {cell.text}
                    </th>
                  ) : (
                    <td key={c} colSpan={cell.colspan} rowSpan={cell.rowspan} className={cn(CELL, 'bg-muted/20 text-center')}>
                      {cell.text}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {block.body.map((cells, r) => (
              <tr key={r}>
                {cells.map((cell, c) => (
                  <td key={c} className={CELL}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {block.total && (
              <tr>
                {block.total.map((cell, c) => (
                  <td key={c} colSpan={c === 0 ? block.totalSpan : undefined} className={cn(CELL, 'font-semibold')}>
                    {cell}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      );
    case 'signature':
      return (
        <dl className="grid gap-x-6 gap-y-1 rounded-md border border-border p-2 text-sm sm:grid-cols-2">
          {block.lines.map((line, index) => (
            <div key={index} className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-subtle">{line.label}</dt>
              <dd className="min-w-0 break-words">{line.value}</dd>
            </div>
          ))}
          {block.closing && <p className="text-right italic sm:col-span-2">{block.closing}</p>}
        </dl>
      );
    case 'notes':
      return (
        <div className="space-y-1 rounded-md border border-border bg-muted/20 p-2 text-xs">
          <p className="font-semibold">{block.title}</p>
          <ol className="list-decimal space-y-1 pl-5">
            {block.items.map((item, index) => (
              <li key={index} className="space-y-1">
                {item.map((inner, innerIndex) => <Block key={innerIndex} block={inner} />)}
              </li>
            ))}
          </ol>
        </div>
      );
  }
}

/** The export model drawn as text and tables (the static-render test draws this). */
export function Form26ReadOnlyBody({ model }: { model: Form26ExportModel }): JSX.Element {
  return (
    <div className="space-y-3" data-f26-readonly="">
      {model.portrait.map((block, index) => <Block key={`p${index}`} block={block} />)}
      {model.landscape.length > 0 && (
        <div className="space-y-3 border-t border-border pt-3">
          {model.landscape.map((block, index) => <Block key={`l${index}`} block={block} />)}
        </div>
      )}
    </div>
  );
}

type Read = { state: 'loading' } | { state: 'none' } | { state: 'error' } | { state: 'found'; draft: Form26Draft };

/** The draft of this engagement, read when the view opens. */
export default function Form26ReadOnlyView({ engagementId }: { engagementId: string }): JSX.Element {
  const [read, setRead] = React.useState<Read>({ state: 'loading' });
  const [attempt, setAttempt] = React.useState(0);
  const [saved, setSaved] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setRead({ state: 'loading' });
    createForm26Store(getSQLiteClient())
      .readForm26Draft(engagementId)
      .then(
        (draft) => alive && setRead(draft ? { state: 'found', draft } : { state: 'none' }),
        () => alive && setRead({ state: 'error' }),
      );
    return () => {
      alive = false;
    };
  }, [engagementId, attempt]);

  const model = React.useMemo(
    () => (read.state === 'found' ? buildForm26ExportModel(FORM26_DEFINITION, read.draft.values, { showAllSchedules: read.draft.setup.showAllSchedules, generatedAt: new Date().toISOString() }) : null),
    [read],
  );

  if (read.state === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-subtle" role="status">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Opening the Form No. 26 draft.
      </p>
    );
  }
  if (read.state === 'none') return <p className="text-sm" role="status">This engagement holds no Form No. 26 draft.</p>;
  if (read.state === 'error' || !model) {
    return (
      <div className="space-y-2 text-sm" role="status">
        <p>The Form No. 26 draft could not be read.</p>
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  const values = read.draft.values;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-2"
          onClick={async () => {
            // Straight from the click: the save window must open before anything is awaited (FIX-T29).
            if (saving) return;
            setSaving(true);
            setSaved('');
            const result = await saveForm26As({ name: saveFileName(values), kind: 'json', make: async () => serialiseSaveFile(FORM26_DEFINITION, values) });
            if (result.outcome === 'failed') console.error('Form No. 26 save file:', result.error);
            setSaved(form26SaveLine(result, { done: 'The save file was saved.', makeFailed: 'The save file could not be made. Try again.', notReady: '' }).text);
            setSaving(false);
          }}
          aria-disabled={saving || undefined}
          data-f26-readonly-save=""
        >
          <FileJson aria-hidden="true" className="h-4 w-4" />
          Save file (.json)
        </Button>
        <span role="status" aria-live="polite" className="text-xs text-subtle">
          {saved}
        </span>
      </div>
      <Form26ReadOnlyBody model={model} />
    </div>
  );
}
