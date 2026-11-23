// The opening state of Form No. 26 and the grid of its three panes. Kept apart from Form26States so that the
// chooser, which is loaded with the Tax Audit page, can show it without bringing the Form No. 26 definition.
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The grid of the three panes, as the present Tax Audit clause workspace (TaxAudit.tsx, ClauseWorkspacePanel).
 * From 1280 px (xl) the workspace is exactly as tall as the page's room and the panes take what the header
 * leaves (`xl:flex-1` in the workspace's column): the page never scrolls, each pane scrolls inside itself.
 * Below 1280 px the right pane goes under the editor and the page scrolls, as on Form 3CD.
 */
export const FORM26_PANES_GRID =
  'grid min-h-[620px] gap-3 lg:h-[calc(100vh-245px)] lg:grid-cols-[280px_minmax(0,1fr)] xl:h-auto xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(0,1fr)]';
export const FORM26_PANES_OPEN = 'xl:grid-cols-[280px_minmax(0,1fr)_300px] 2xl:grid-cols-[300px_minmax(0,1fr)_320px]';
export const FORM26_PANES_FOLDED = 'xl:grid-cols-[280px_minmax(0,1fr)_56px] 2xl:grid-cols-[300px_minmax(0,1fr)_56px]';
/** The workspace itself: a column as tall as the page's room from 1280 px (the header, then the panes). */
export const FORM26_WORKSPACE_COLUMN = 'flex flex-col gap-4 xl:h-full';

/** Opening: a skeleton shaped like the header and the three panes. It stays only as long as the load. */
export function Form26LoadingState(): JSX.Element {
  return (
    <div className={cn('relative', FORM26_WORKSPACE_COLUMN)} role="status" aria-live="polite">
      <span className="sr-only">Opening Form No. 26.</span>
      <div aria-hidden="true" className="shrink-0 space-y-2 border-b py-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div aria-hidden="true" className={cn(FORM26_PANES_GRID, FORM26_PANES_OPEN)}>
        <Skeleton className="h-full min-h-[520px] xl:min-h-0" />
        <Skeleton className="h-full min-h-[520px] xl:min-h-0" />
        <Skeleton className="hidden h-full min-h-[520px] xl:block xl:min-h-0" />
      </div>
    </div>
  );
}
