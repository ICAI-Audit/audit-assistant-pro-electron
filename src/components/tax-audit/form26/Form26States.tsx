// Every state of the Form No. 26 workspace that is not the workspace itself: opening, no engagement, no
// access, the year not understood, a Form 3CD draft waiting to be brought across, an error with "Try
// again", and the line for a table that met someone else's change. Plain sentences, the tool's own look.
import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarX2, FileStack, Lock, RefreshCw, type LucideIcon } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FORM26_CONFLICT_ACTION_LABEL } from '@/lib/taxAuditForm26EditorModel';
import { FORM26_STATE_TEXT, form26YearUnknownText } from '@/lib/taxAuditForm26Workspace';
import { cn } from '@/lib/utils';

// The opening state and the panes' grid live in a light file of their own (the chooser loads it with the page).
export { Form26LoadingState, FORM26_PANES_FOLDED, FORM26_PANES_GRID, FORM26_PANES_OPEN } from '@/components/tax-audit/form26/Form26Loading';

/** No engagement chosen: the present module's own words. */
export function Form26NoEngagementState(): JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tax Audit</h1>
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{FORM26_STATE_TEXT.noEngagement}</AlertDescription>
      </Alert>
    </div>
  );
}

function StatePanel(props: { icon: LucideIcon; title: string; children: React.ReactNode; tone?: 'info' | 'danger'; role?: 'alert' | 'status' }): JSX.Element {
  const Icon = props.icon;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Tax Audit</h1>
      <section role={props.role} className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-10 text-center shadow-sm">
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-xl', props.tone === 'danger' ? 'bg-danger-soft text-danger-ink' : 'bg-info-soft text-info-ink')}>
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        <h2 className="text-base font-semibold text-foreground">{props.title}</h2>
        {props.children}
      </section>
    </div>
  );
}

export function Form26NoAccessState(): JSX.Element {
  return (
    <StatePanel icon={Lock} title="This tax audit cannot be opened" role="status">
      <p className="max-w-md text-sm text-subtle">{FORM26_STATE_TEXT.noAccess}</p>
    </StatePanel>
  );
}

/** The engagement's year is not understood: a plain message and a way to correct it; nothing is created. */
export function Form26YearUnknownState(props: { financialYear: string }): JSX.Element {
  return (
    <StatePanel icon={CalendarX2} title={FORM26_STATE_TEXT.yearTitle} role="status">
      <p className="max-w-md text-sm text-subtle">{form26YearUnknownText(props.financialYear)}</p>
      <Button asChild variant="outline" size="sm" className="h-8">
        <Link to="/engagements">{FORM26_STATE_TEXT.yearLink}</Link>
      </Button>
    </StatePanel>
  );
}

/** A Form 3CD draft sits on this engagement and has not been brought across yet. */
export function Form26ConversionState(props: { onRetry(): void }): JSX.Element {
  return (
    <StatePanel icon={FileStack} title={FORM26_STATE_TEXT.conversionTitle} role="status">
      <p className="max-w-md text-sm text-subtle">{FORM26_STATE_TEXT.conversionText}</p>
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={props.onRetry}>
        <RefreshCw aria-hidden="true" />
        {FORM26_STATE_TEXT.errorRetry}
      </Button>
    </StatePanel>
  );
}

/** The load failed: what happened, and "Try again". */
export function Form26ErrorState(props: { message: string | null; onRetry(): void }): JSX.Element {
  return (
    <StatePanel icon={AlertCircle} title={FORM26_STATE_TEXT.errorTitle} tone="danger" role="alert">
      {props.message && <p className="max-w-md text-sm text-subtle">{props.message}</p>}
      <Button type="button" size="sm" className="h-8" onClick={props.onRetry}>
        <RefreshCw aria-hidden="true" />
        {FORM26_STATE_TEXT.errorRetry}
      </Button>
    </StatePanel>
  );
}

/** One line per table that met someone else's change, with the choices it allows (above the clause editor). */
export function Form26ConflictBanner(props: { lines: { id: string; text: string; actions: ('mine' | 'theirs')[] }[]; onResolve(id: string, keep: 'mine' | 'theirs'): void }): JSX.Element | null {
  if (props.lines.length === 0) return null;
  return (
    <div role="status" className="space-y-1.5 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
      {props.lines.map((line) => (
        <div key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{line.text}</span>
          <span className="flex shrink-0 gap-1">
            {line.actions.map((keep) => (
              <Button key={keep} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => props.onResolve(line.id, keep)}>
                {FORM26_CONFLICT_ACTION_LABEL[keep]}
              </Button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
