// The "Last year" tab of the right pane (BUILD-PLAN task 25): for the selected clause, the Form 3CD clause(s)
// it came from with the mapping's subject and both sections, then last year's answer of the same client as
// plain lines, read only. Nothing is ever filled in from here and nothing offers to copy. Last year is read
// by `useForm26LastYear` (the store's select-only reader; the main process applies the access rules).
// In the right pane (no fold of its own) it has no title row: the pane's title row carries its tab and the
// fold, and the year's line opens the body (POLISH-2). Drawn on its own, it keeps its title row.
import { PanelRightClose } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FORM26_LAST_YEAR_TEXT, type Form26LastYearView } from '@/lib/taxAuditForm26ThreeCdText';
import { cn } from '@/lib/utils';

export type Form26LastYearProps = {
  view: Form26LastYearView;
  /** The selected clause as the editor names it ("Clause 15 · Method of accounting …"). */
  clauseTitle: string;
  onRetry(): void;
  /** Its own fold button and title row; without it the content sits under the pane's title row. */
  onCollapse?(): void;
};

export function Form26LastYear({ view, clauseTitle, onRetry, onCollapse }: Form26LastYearProps): JSX.Element {
  const titleId = 'f26-last-year-title';
  const embedded = !onCollapse;
  return (
    // `overflow-clip`, never `overflow-hidden`; the body below is the only part that scrolls (and is `relative`).
    <section aria-labelledby={titleId} className={cn('flex h-full min-h-0 flex-col overflow-clip bg-background', !embedded && 'rounded-md border')} data-f26-last-year="">
      {embedded ? (
        <h3 id={titleId} className="sr-only">
          {view.title}
        </h3>
      ) : (
        <div className="flex shrink-0 items-start justify-between gap-2 border-b bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <h3 id={titleId} className="text-sm font-semibold">
              {view.title}
            </h3>
            <p className="break-words text-xs text-subtle">{view.subtitle ?? clauseTitle}</p>
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onCollapse} title="Collapse evidence pane" aria-label="Collapse evidence pane">
            <PanelRightClose aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {embedded && view.subtitle && <p className="break-words text-xs text-subtle">{view.subtitle}</p>}
        {(embedded || view.subtitle) && <p className="break-words text-xs font-medium">{clauseTitle}</p>}
        {view.note && <p className="text-xs text-subtle">{view.note}</p>}
        {view.links.length > 0 && (
          <ul aria-label="Form 3CD clauses" className="space-y-2">
            {view.links.map((link) => (
              <li key={link.rowId} className="space-y-0.5 rounded-md border border-border p-2">
                <p className="text-xs text-subtle">Form 26 clause {link.form26}</p>
                <p className="break-words font-medium">{link.threeCd}</p>
                <p className="break-words">{link.subject}</p>
                <p className="break-words text-xs text-subtle">{link.sections}</p>
                <p className="break-words text-xs">{link.whatChanged}</p>
              </li>
            ))}
          </ul>
        )}
        {view.message && (
          <div className="space-y-2 rounded-md border border-dashed p-3 text-xs text-subtle" role="status">
            <p>{view.message}</p>
            {view.retry && (
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onRetry}>
                {FORM26_LAST_YEAR_TEXT.retry}
              </Button>
            )}
          </div>
        )}
        {view.answers.map((block) => (
          <div key={block.key} className="space-y-1.5" data-f26-last-year-answers={block.key}>
            <div>
              <h4 className="break-words text-xs font-semibold">{block.heading}</h4>
              {block.state && <p className="text-[11px] text-subtle">{block.state}</p>}
            </div>
            {block.lines.length > 0 ? (
              <dl className="space-y-1.5">
                {block.lines.map((line, index) => (
                  <div key={`${line.label}-${index}`}>
                    <dt className="break-words text-xs text-subtle">{line.label}</dt>
                    <dd className="whitespace-pre-wrap break-words">{line.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-subtle">{block.empty}</p>
            )}
          </div>
        ))}
        {view.notes.map((note) => (
          <p key={note} className="text-xs text-subtle">
            {note}
          </p>
        ))}
      </div>
    </section>
  );
}
