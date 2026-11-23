// The header of the Form No. 26 workspace: title (with the page's views "Clauses · What changed" beside it, in
// the title's own line: no band of its own), client and year, the badges of the form, the sentence of why this
// form applies, the save state and the main button "Next unfilled". It stays in the flow above the
// panes, which take the rest of the page's height from 1280 px: it is always in view and never covers them
// (sticky, as on Form 3CD, it slid over the panes' search and titles at 1280 x 720). The save state's line
// keeps its place whatever it says, so nothing moves.
import { AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Form26HeaderModel } from '@/lib/taxAuditForm26Workspace';
import { cn } from '@/lib/utils';

export type Form26HeaderProps = {
  model: Form26HeaderModel;
  onNext(): void;
  onRetry(): void;
  /** Extra actions beside the main button. */
  actions?: React.ReactNode;
  /** The switch between the page's views (a compact tab list), drawn beside the title in its line. */
  views?: React.ReactNode;
};

const TONE: Record<Form26HeaderModel['save']['tone'], string> = {
  quiet: 'text-subtle',
  warning: 'text-warning-ink',
  error: 'text-danger-ink',
};

export function Form26Header({ model, onNext, onRetry, actions, views }: Form26HeaderProps): JSX.Element {
  const [form, act, rule, category] = model.badges;
  return (
    <header className="shrink-0 border-b py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold text-foreground">{model.title}</h1>
            {views}
          </div>
          <p className="text-sm text-subtle">{model.subtitle}</p>
          <p className="mt-0.5 text-xs text-subtle">{model.why}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge>{form}</Badge>
            <Badge variant="outline">{act}</Badge>
            <Badge variant="outline">{rule}</Badge>
            <Badge variant="neutral">{category}</Badge>
          </div>
          <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
            {model.message && <span className="text-xs font-medium text-subtle">{model.message}</span>}
            {model.save.text !== '' && (
              <span className={cn('flex items-center gap-1.5 text-xs', TONE[model.save.tone])} data-f26-save-state="">
                {model.save.tone !== 'quiet' && <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                {model.save.text}
              </span>
            )}
            {model.save.retry && (
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            )}
            {actions}
            <Button type="button" size="sm" className="h-8 px-3 text-xs" onClick={onNext} aria-keyshortcuts={model.next.keys} aria-describedby="f26-next-count">
              {model.next.label}
              {/* The tool's "go to" arrow (as the Form 3CD lists' "Open"), after the words. */}
              <ArrowRight aria-hidden="true" />
            </Button>
            <span id="f26-next-count" hidden>
              {model.next.count}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
