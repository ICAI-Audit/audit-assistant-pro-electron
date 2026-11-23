// The clause list of the Form No. 26 workspace (the left pane), in the present Tax Audit list's look: the
// title row (with "View", the switches of the file and the Form 3CD notes behind one compact button), a
// search box, the filter chips with counts, then the groups of the form with an entry per clause and per
// schedule on screen. Labels wrap, never cut. One Tab stop: the arrow keys, Home and End move among the
// entries; Enter or Space opens one.
import * as React from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Flag, Lock, Paperclip, Search, SlidersHorizontal, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  FORM26_LIST_FILTERS,
  form26ViewSummary,
  listScrollFor,
  type Form26ListEntry,
  type Form26ListFilter,
  type Form26ListModel,
  type Form26ViewSummary,
  type Form26ViewSwitchId,
} from '@/lib/taxAuditForm26ListModel';
import { rovingTarget } from '@/lib/taxAuditForm26Workspace';
import { cn } from '@/lib/utils';

export type Form26ClauseListProps = {
  model: Form26ListModel;
  /** The entry shown as selected: a schedule entry when the user opened the clause through it, else the clause. */
  selectedId: string;
  filter: Form26ListFilter;
  onFilter(filter: Form26ListFilter): void;
  search: string;
  onSearch(search: string): void;
  highlightUnfilled: boolean;
  onHighlightUnfilled(on: boolean): void;
  showAllSchedules: boolean;
  onShowAllSchedules(on: boolean): void;
  onSelect(entry: Form26ListEntry): void;
  searchRef?: React.Ref<HTMLInputElement>;
  /** "Show Form 3CD notes" (task 25): the comparison line under each clause and the "Last year" tab. */
  showComparison?: boolean;
  onShowComparison?(on: boolean): void;
  /** Whether the notes are on by default for this year (2026-27): "View" marks only a change from it. */
  comparisonUsual?: boolean;
};

/** The switches behind "View", each labelled as it always was; drawn inside the popover. */
export function Form26ViewSwitches({ summary, onChange }: { summary: Form26ViewSummary; onChange(id: Form26ViewSwitchId, on: boolean): void }): JSX.Element {
  return (
    <div className="space-y-2.5">
      {summary.switches.map((entry) => (
        <div key={entry.id} className="flex items-center justify-between gap-3">
          <label htmlFor={entry.domId} className="text-xs text-foreground">
            {entry.label}
          </label>
          <Switch id={entry.domId} checked={entry.on} onCheckedChange={(on) => onChange(entry.id, on)} />
        </div>
      ))}
    </div>
  );
}

const VIEW_STATE_ID = 'f26-view-state';

/** "View": one compact button in the list's title row; a mark when the view is not the usual one. */
function Form26ViewMenu({ summary, onChange }: { summary: Form26ViewSummary; onChange(id: Form26ViewSwitchId, on: boolean): void }): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" aria-describedby={VIEW_STATE_ID} data-f26-view-button="">
          <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
          View
          {summary.changed > 0 && (
            <span data-f26-view-mark="" className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground">
              {summary.changed}
              <span className="sr-only">{summary.mark.slice(String(summary.changed).length)}</span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <span id={VIEW_STATE_ID} hidden>
        {summary.description}
      </span>
      <PopoverContent align="end" className="w-64 p-3" aria-label="View">
        <Form26ViewSwitches summary={summary} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function EntryMarks({ entry }: { entry: Form26ListEntry }): JSX.Element {
  const reviewed = entry.reviewStatus === 'reviewed';
  const approved = entry.reviewStatus === 'approved' || entry.reviewStatus === 'locked';
  return (
    <span className="flex shrink-0 items-center gap-1">
      {entry.unfilled > 0 && (
        <span className="rounded-sm border bg-background px-1.5 text-[10px] leading-4 tabular-nums text-subtle">
          {entry.unfilled}
          <span className="sr-only"> unfilled</span>
        </span>
      )}
      {entry.hasEvidence && (
        <span title="Evidence linked">
          <Paperclip aria-hidden="true" className="h-3.5 w-3.5 text-subtle" />
          <span className="sr-only">Evidence linked</span>
        </span>
      )}
      {entry.qualified && (
        <span title="Marked for qualification">
          <Flag aria-hidden="true" className="h-3.5 w-3.5 text-subtle" />
          <span className="sr-only">Marked for qualification</span>
        </span>
      )}
      {entry.reviewStatus === 'prepared' && (
        <span title="Prepared">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-subtle" />
          <span className="sr-only">Prepared</span>
        </span>
      )}
      {reviewed && (
        <span title="Reviewed">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-success" />
          <span className="sr-only">Reviewed</span>
        </span>
      )}
      {approved && (
        <span title="Approved">
          <Lock aria-hidden="true" className="h-3.5 w-3.5 text-success" />
          <span className="sr-only">Approved</span>
        </span>
      )}
    </span>
  );
}

export function Form26ClauseList(props: Form26ClauseListProps): JSX.Element {
  const { model, selectedId, filter, search } = props;
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const navRef = React.useRef<HTMLElement>(null);
  const [focusId, setFocusId] = React.useState<string | null>(null);

  const groupOfEntry = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const group of model.groups) for (const entry of group.entries) map.set(entry.id, group.id);
    return map;
  }, [model.groups]);

  // The group of the selected entry is opened whenever the selection changes, and the entry brought into view.
  React.useEffect(() => {
    const group = groupOfEntry.get(selectedId);
    if (group) setCollapsed((prev) => (prev.has(group) ? new Set([...prev].filter((id) => id !== group)) : prev));
  }, [selectedId, groupOfEntry]);
  React.useEffect(() => {
    // Brought to the middle of the list when it is not seen whole, so the entries round it are seen too.
    const nav = navRef.current;
    const element = nav?.querySelector<HTMLElement>(`[data-entry-id="${selectedId}"]`);
    if (!nav || !element) return;
    const top = element.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
    const target = listScrollFor({ scrollTop: nav.scrollTop, viewHeight: nav.clientHeight, entryTop: top, entryHeight: element.offsetHeight });
    if (target !== null) nav.scrollTop = target;
  }, [selectedId]);

  const visibleIds = React.useMemo(
    () => model.groups.flatMap((group) => (collapsed.has(group.id) ? [] : group.entries.map((entry) => entry.id))),
    [model.groups, collapsed],
  );
  const tabStop = visibleIds.includes(focusId ?? '') ? focusId : visibleIds.includes(selectedId) ? selectedId : visibleIds[0] ?? null;

  const onListKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
    if (!from || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = rovingTarget(visibleIds, from, event.key);
    if (!target) return;
    event.preventDefault();
    setFocusId(target);
    navRef.current?.querySelector<HTMLElement>(`[data-entry-id="${target}"]`)?.focus();
  };

  const toggle = (groupId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const shown = model.groups.reduce((sum, group) => sum + group.entries.length, 0);
  const view = form26ViewSummary({
    highlightUnfilled: props.highlightUnfilled,
    showAllSchedules: props.showAllSchedules,
    showComparison: props.onShowComparison ? Boolean(props.showComparison) : undefined,
    comparisonUsual: props.comparisonUsual,
  });
  const onViewChange = (id: Form26ViewSwitchId, on: boolean) => {
    if (id === 'highlight-unfilled') props.onHighlightUnfilled(on);
    else if (id === 'show-all-schedules') props.onShowAllSchedules(on);
    else props.onShowComparison?.(on);
  };

  return (
    // `overflow-clip`: clipped to its frame, never scrolled itself (only the list below scrolls).
    <div className="flex h-full min-h-0 flex-col overflow-clip rounded-md border bg-background">
      <div className="shrink-0 space-y-2 border-b bg-background p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Form No. 26</p>
            <p className="text-xs text-subtle">{shown} shown</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Form26ViewMenu summary={view} onChange={onViewChange} />
            <Badge variant="outline">{model.totalEntries}</Badge>
          </div>
        </div>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-subtle" />
          <Input
            ref={props.searchRef}
            value={search}
            onChange={(event) => props.onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && search !== '') {
                event.preventDefault();
                event.stopPropagation();
                props.onSearch('');
              }
            }}
            placeholder="Search clause"
            aria-label="Search clauses"
            aria-keyshortcuts="/"
            className="h-8 pl-8 pr-8"
          />
          {search !== '' && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => props.onSearch('')}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-sm text-subtle hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {FORM26_LIST_FILTERS.map((chip) => (
            <Button
              key={chip.id}
              type="button"
              size="sm"
              variant={filter === chip.id ? 'default' : 'outline'}
              aria-pressed={filter === chip.id}
              className="h-6 gap-1 px-1.5 text-xs"
              onClick={() => props.onFilter(chip.id)}
            >
              {chip.label}
              <span className="text-[10px] tabular-nums opacity-75">{model.counts[chip.id]}</span>
            </Button>
          ))}
        </div>
      </div>
      <nav ref={navRef} aria-label="Form No. 26 clauses" className="relative min-h-0 flex-1 divide-y overflow-y-auto" onKeyDown={onListKeyDown}>
        {model.groups.map((group) => {
          const open = !collapsed.has(group.id);
          const listId = `f26-list-${group.id}`;
          return (
            <div key={group.id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(group.id)}
                className="flex w-full items-start gap-1.5 bg-muted/30 px-2.5 py-1.5 text-left text-[11px] font-semibold text-subtle hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {open ? <ChevronDown aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronRight aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 break-words leading-4">{group.title}</span>
                {group.unfilled > 0 && <span className="shrink-0 font-medium tabular-nums leading-4">{group.unfilled} unfilled</span>}
              </button>
              <ul id={listId} hidden={!open} className="py-0.5">
                {group.entries.map((entry) => {
                  const selected = entry.id === selectedId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        data-entry-id={entry.id}
                        tabIndex={entry.id === tabStop ? 0 : -1}
                        aria-current={selected ? 'true' : undefined}
                        onFocus={() => setFocusId(entry.id)}
                        onClick={() => props.onSelect(entry)}
                        className={cn(
                          'flex w-full items-start gap-2 border-l-2 border-transparent py-1 pr-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          entry.kind === 'schedule' ? 'pl-5' : 'pl-2.5',
                          selected && 'border-primary bg-primary/10',
                        )}
                      >
                        {/* The marks beside the number (as the 3CD list's dot), so the label has the width to the edge; */}
                        {/* the text's own line height (16 px at 12 px type): a long label takes fewer pixels. */}
                        <span className="flex w-16 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5">
                          <span className={cn('font-mono text-[11px] leading-4 text-subtle', selected && 'font-semibold text-primary')}>{entry.no}</span>
                          <EntryMarks entry={entry} />
                        </span>
                        <span className={cn('min-w-0 flex-1 break-words text-xs leading-4', selected && 'font-medium')}>{entry.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {model.empty && (
          <div className="space-y-2 p-6 text-center">
            <p className="text-sm text-subtle">{model.empty.message}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => (model.empty?.action.clears === 'search' ? props.onSearch('') : props.onFilter('all'))}
            >
              {model.empty.action.label}
            </Button>
          </div>
        )}
      </nav>
    </div>
  );
}
