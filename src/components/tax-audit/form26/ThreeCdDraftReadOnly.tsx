// "View the earlier 3CD draft" (BUILD-PLAN task 26): the engagement's Form 3CD draft as it was kept, read
// only. It lists the 49 Form 3CD clauses with the application's short titles, their review state and their
// answers as plain lines (`threeCdAnswerLines`, through the 3CD field schemas). It is drawn from rows that
// were SELECTED (`loadThreeCdSnapshot`); the Form 3CD page itself is never mounted for it (it writes when it
// opens). There is no box, no button that changes anything, nothing to copy across.
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FORM26_THREE_CD_DRAFT_TEXT, threeCdDraftList, type ThreeCdSnapshot } from '@/lib/taxAuditForm26Conversion';

export type ThreeCdDraftReadOnlyProps = { snapshot: ThreeCdSnapshot };

/** The 49 clauses of the earlier draft, as text. */
export function ThreeCdDraftReadOnly({ snapshot }: ThreeCdDraftReadOnlyProps): JSX.Element {
  const clauses = threeCdDraftList(snapshot);
  return (
    <ol aria-label="Clauses of the earlier Form 3CD draft" className="space-y-2" data-f26-3cd-draft="">
      {clauses.map((clause) => (
        <li key={clause.key} className="rounded-md border border-border p-2.5" data-f26-3cd-draft-clause={clause.key}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="min-w-0 break-words text-sm font-semibold">{clause.heading}</h3>
            <span className="text-xs text-subtle">{clause.state}</span>
          </div>
          {clause.lines.length > 0 ? (
            <dl className="mt-1.5 space-y-1.5">
              {clause.lines.map((line, index) => (
                <div key={`${line.label}-${index}`}>
                  <dt className="break-words text-xs text-subtle">{line.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-sm">{line.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-1 text-xs text-subtle">No answer was recorded.</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The dialog that holds it: opened from the notice, the Review Summary and the "3CD draft" tab. */
export function ThreeCdDraftDialog(props: { open: boolean; onOpenChange(open: boolean): void; snapshot: ThreeCdSnapshot | null; failed?: boolean; onRetry?(): void }): JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{FORM26_THREE_CD_DRAFT_TEXT.dialogTitle}</DialogTitle>
          <DialogDescription>{FORM26_THREE_CD_DRAFT_TEXT.dialogNote}</DialogDescription>
        </DialogHeader>
        {/* `relative`: anything placed out of the flow inside scrolls with the list. */}
        <div className="relative min-h-0 flex-1 overflow-y-auto pr-1">
          {props.snapshot ? (
            <ThreeCdDraftReadOnly snapshot={props.snapshot} />
          ) : props.failed ? (
            <div className="space-y-2 text-sm" role="status">
              <p>The earlier Form 3CD draft could not be read.</p>
              {props.onRetry && (
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={props.onRetry}>
                  Try again
                </Button>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-subtle" role="status">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Opening the earlier Form 3CD draft.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
