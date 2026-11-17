// Redact's review list (design 5.9 "The list and the review", "Every occurrence"): each value found,
// with its kind, its places and pages, ticked as a whole or place by place; the boxes the user drew;
// and the possible matches no profile ticks, held by kind with counts and shown fifty at a time on
// request (an ordinary 200-page bank statement holds thousands of them).
//
// Confidentiality: the list shows the matched text: that is its purpose. Ids, keys, test ids, titles and
// accessible names hold page numbers, positions and kinds only (the value is the row's visible text).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { HeldKindCount, HeldValueRow, Proposal } from '@/lib/pdf-tools/redactFind';
import type { RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { cn } from '@/lib/utils';
import { pagesShort, placeNote, tickState, type ValueRow } from './redactView';
import type { DrawnBox, ReviewAction, ReviewState } from './reviewState';

const PAGE_OF_ROWS = 200;
const HELD_PAGE = 50;
/** The longest text under a drawn box shown beside "Redact this text everywhere"; a longer run gets a plain label. */
const BOX_TOKEN_SHOWN = 40;

/**
 * A callback ref that keeps the filter field's node, to be wiped as it goes (the filter can hold a
 * typed value; React DOM keeps the last focused field after it is removed). Made at module level so it
 * holds the node set only (RedactOptions.tsx does the same for the word and token fields).
 */
function keepNode(nodes: Set<HTMLInputElement>) {
  return (node: HTMLInputElement | null) => {
    if (node) nodes.add(node);
  };
}

/** Colour of a kind's label (a quiet tint; the words carry the meaning). */
function kindTone(kind: RedactKind): string {
  if (kind === 'typed' || kind === 'same-text') return 'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-100';
  if (kind === 'drawn' || kind === 'marked') return 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100';
  if (['email', 'mobile'].includes(kind)) return 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100';
  if (['bank-account', 'ifsc', 'micr', 'itr-ack', 'evc'].includes(kind)) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100';
  if (['name', 'address', 'addressee', 'ip'].includes(kind)) return 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100';
  return 'bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100';
}

function Tri({ state, onChange, testId, label, disabled }: { state: 'all' | 'some' | 'none'; onChange: (on: boolean) => void; testId: string; label: string; disabled?: boolean }) {
  return (
    <Checkbox
      data-testid={testId}
      aria-label={label}
      disabled={disabled}
      checked={state === 'all' ? true : state === 'some' ? 'indeterminate' : false}
      onCheckedChange={() => onChange(state !== 'all')}
      className="mt-0.5 data-[state=indeterminate]:bg-primary/40"
    />
  );
}

export interface RedactListProps {
  state: ReviewState;
  dispatch: (action: ReviewAction) => void;
  rows: ValueRow[];
  held: HeldKindCount[];
  heldRows: (kind: RedactKind, from: number, count: number) => HeldValueRow[];
  /** Ticks or unticks every place of a value (a possible value's other places are searched when it is ticked). */
  onTickValue: (places: readonly Proposal[], on: boolean) => void;
  /** Ticks a held value: its places are built and join the review. */
  onPromote: (index: number) => void;
  /** Shows a place or a drawn box on the page surface (and selects it). */
  onShow: (page: number, id: string) => void;
  /** The word under each drawn box that may be redacted everywhere, by box id (null: the box redacts its area only). */
  boxTokens: ReadonlyMap<string, string | null>;
  onBoxEverywhere: (box: DrawnBox, on: boolean) => void;
  currentPage: number;
  disabled: boolean;
}

export default function RedactList(props: RedactListProps) {
  const { state, dispatch, rows, held, disabled, onShow, currentPage } = props;
  const [limit, setLimit] = useState(PAGE_OF_ROWS);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [heldOpen, setHeldOpen] = useState<Record<string, number>>({});
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // The selected place's value opens, and its row comes into view (a box chosen on the page).
  const selectedRow = useMemo(() => rows.find((r) => r.places.some((p) => p.id === state.selected))?.id ?? null, [rows, state.selected]);
  useEffect(() => {
    if (!state.selected) return;
    if (selectedRow) setOpen((o) => (o.has(selectedRow) ? o : new Set([...o, selectedRow])));
    const index = rows.findIndex((r) => r.id === selectedRow);
    if (index >= limit) setLimit(index + 1);
    const frame = requestAnimationFrame(() => rowRefs.current.get(state.selected!)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [state.selected, selectedRow, rows, limit]);

  const pageIds = state.proposals.filter((p) => p.page === currentPage).map((p) => p.id);
  const allIds = state.proposals.map((p) => p.id);
  const ticked = allIds.filter((id) => state.ticked[id]).length;
  const anything = state.proposals.length > 0 || held.length > 0;
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ref = (id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };
  const [filterField] = useState(() => {
    const nodes = new Set<HTMLInputElement>();
    return { nodes, ref: keepNode(nodes) };
  });
  useLayoutEffect(
    () => () => {
      for (const node of filterField.nodes) {
        node.value = '';
        node.removeAttribute('value');
      }
      filterField.nodes.clear();
    },
    [filterField],
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {anything && (
        <>
          <div className="flex items-center gap-2">
            <Input
              ref={filterField.ref}
              data-testid="pdf-tools-redact-filter"
              aria-label="Filter the list by kind, text or page number"
              placeholder="Filter: kind, text or page"
              value={state.filter}
              disabled={disabled}
              onChange={(event) => dispatch({ type: 'filter', text: event.target.value })}
              className="h-8 text-xs"
            />
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-foreground">
              <Checkbox data-testid="pdf-tools-redact-show-unticked" checked={state.showUnticked} disabled={disabled} onCheckedChange={(on) => dispatch({ type: 'show-unticked', on: on === true })} />
              Show unticked
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-auto text-muted-foreground" data-testid="pdf-tools-redact-ticked-count">
              {ticked.toLocaleString('en-IN')} of {allIds.length.toLocaleString('en-IN')} places ticked
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled || allIds.length === 0} data-testid="pdf-tools-redact-tick-all" onClick={() => dispatch({ type: 'tick-all', on: true })}>
              Tick all
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled || allIds.length === 0} data-testid="pdf-tools-redact-untick-all" onClick={() => dispatch({ type: 'tick-all', on: false })}>
              Untick all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={disabled || pageIds.length === 0}
              data-testid="pdf-tools-redact-tick-page"
              onClick={() => dispatch({ type: 'tick', ids: pageIds, on: tickState(pageIds, state.ticked) !== 'all' })}
            >
              {tickState(pageIds, state.ticked) === 'all' ? `Untick page ${currentPage + 1}` : `Tick page ${currentPage + 1}`}
            </Button>
          </div>
        </>
      )}

      <div role="list" aria-label="Found on the pages" className="space-y-1" data-testid="pdf-tools-redact-list">
        {rows.length === 0 && state.drawn.length === 0 && held.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            {state.filter ? 'Nothing matches the filter.' : 'Nothing was found. Use Add a box to cover what must be removed, or add your own words above.'}
          </p>
        )}
        {rows.slice(0, limit).map((row, index) => {
          const expanded = open.has(row.id);
          return (
            <div key={row.id} role="listitem" className={cn('rounded-md border px-2 py-1.5', row.tick === 'none' ? 'bg-background' : 'bg-primary/5', row.id === selectedRow && 'ring-1 ring-primary')}>
              <div className="flex items-start gap-2">
                <Tri state={row.tick} disabled={disabled} testId={`pdf-tools-redact-value-tick-${index}`} label={`Tick every place of value ${index + 1}`} onChange={(on) => props.onTickValue(row.places, on)} />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={expanded}
                  onClick={() => {
                    toggle(row.id);
                    onShow(row.shown[0].page, row.shown[0].id);
                  }}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('rounded px-1.5 text-[11px] font-medium leading-5', kindTone(row.kind))}>{row.label}</span>
                    <span className="break-all font-mono text-xs text-foreground">{row.value.replace(/\s+/g, ' ')}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {expanded ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                    {row.places.length === 1 ? '1 place' : `${row.places.length} places`}, {pagesShort(row.pages)}
                    {row.confidence === 'possible' && row.reason ? ` · possible: ${row.reason}` : ''}
                  </span>
                </button>
              </div>
              {expanded && (
                <ul className="mt-1 space-y-0.5 pl-6">
                  {row.places.map((p) => (
                    <li key={p.id} ref={ref(p.id)} data-testid={`pdf-tools-redact-row-${p.id}`} className={cn('flex items-center gap-2 rounded px-1 py-0.5 text-xs', state.selected === p.id && 'bg-primary/10')}>
                      <Checkbox data-testid={`pdf-tools-redact-row-tick-${p.id}`} aria-label={`Tick the place on page ${p.page + 1}`} disabled={disabled} checked={state.ticked[p.id] === true} onCheckedChange={(on) => dispatch({ type: 'tick', ids: [p.id], on: on === true })} />
                      <button type="button" className="min-w-0 flex-1 text-left text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onShow(p.page, p.id)}>
                        Page {p.page + 1}
                        <span className="text-muted-foreground">
                          {p.source !== 'text' ? ` · in a ${p.source === 'field' ? 'form field' : p.source === 'link' ? 'link' : p.source === 'marked' ? 'redaction mark' : 'comment'}` : ''}
                          {placeNote(p)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {rows.length > limit && (
          <Button type="button" variant="outline" size="sm" className="w-full text-xs" onClick={() => setLimit((n) => n + PAGE_OF_ROWS)}>
            Show {Math.min(PAGE_OF_ROWS, rows.length - limit)} more of {rows.length - limit}
          </Button>
        )}

        {state.drawn.length > 0 && (
          <div className="pt-2">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">Boxes you drew ({state.drawn.length})</p>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled} data-testid="pdf-tools-redact-clear-drawn" onClick={() => dispatch({ type: 'clear-drawn' })}>
                Clear all drawn boxes
              </Button>
            </div>
            <ul className="space-y-1">
              {state.drawn.map((d, i) => {
                const token = props.boxTokens.get(d.id) ?? null;
                return (
                  <li key={d.id} ref={ref(d.id)} data-testid={`pdf-tools-redact-row-${d.id}`} className={cn('rounded-md border px-2 py-1.5 text-xs', state.selected === d.id && 'ring-1 ring-primary')}>
                    <div className="flex items-center gap-2">
                      <span className={cn('rounded px-1.5 text-[11px] font-medium leading-5', kindTone('drawn'))}>Drawn</span>
                      <button type="button" className="min-w-0 flex-1 text-left text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onShow(d.page, d.id)}>
                        Box {i + 1} · page {d.page + 1}
                      </button>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled} aria-label={`Remove drawn box ${i + 1}`} data-testid={`pdf-tools-redact-delete-${d.id}`} onClick={() => dispatch({ type: 'delete-drawn', ids: [d.id] })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {token !== null && (
                      <label className="mt-1 flex cursor-pointer items-start gap-2 pl-1 text-[11px] text-muted-foreground">
                        <Checkbox data-testid={`pdf-tools-redact-everywhere-${d.id}`} checked={d.everywhere === true} disabled={disabled} onCheckedChange={(on) => props.onBoxEverywhere(d, on === true)} className="mt-0.5" />
                        {/* A long run under the box (a barcode's printed string, a whole line) means nothing to read: a plain label then. */}
                        {token.length <= BOX_TOKEN_SHOWN ? (
                          <span>
                            Redact this text everywhere: <span className="font-mono text-foreground">{token}</span>
                          </span>
                        ) : (
                          <span>Redact the text under this box everywhere</span>
                        )}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {held.length > 0 && (
          <div className="pt-2" data-testid="pdf-tools-redact-held">
            <p className="text-xs font-medium text-foreground">Possible matches, not ticked</p>
            <p className="mb-1 text-[11px] leading-snug text-muted-foreground">These are usually part, branch or reference numbers. Open a kind to tick the ones that must go.</p>
            <ul className="space-y-1">
              {held.map((h) => {
                const shownCount = heldOpen[h.kind] ?? 0;
                const list = shownCount > 0 ? props.heldRows(h.kind, 0, shownCount) : [];
                return (
                  <li key={h.kind} className="rounded-md border px-2 py-1.5 text-xs">
                    <button
                      type="button"
                      data-testid={`pdf-tools-redact-held-${h.kind}`}
                      aria-expanded={shownCount > 0}
                      className="flex w-full items-center gap-1.5 text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setHeldOpen((o) => ({ ...o, [h.kind]: shownCount > 0 ? 0 : HELD_PAGE }))}
                    >
                      {shownCount > 0 ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                      <span className={cn('rounded px-1.5 text-[11px] font-medium leading-5', kindTone(h.kind))}>{h.label}</span>
                      <span className="text-muted-foreground">
                        {h.places.toLocaleString('en-IN')} {h.places === 1 ? 'place' : 'places'}, {h.values.toLocaleString('en-IN')} {h.values === 1 ? 'value' : 'values'}
                      </span>
                    </button>
                    {list.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-5">
                        {list.map((r) => (
                          <li key={`h-${r.index}`} className="flex items-start gap-2">
                            <Checkbox data-testid={`pdf-tools-redact-held-tick-${r.index}`} aria-label={`Tick possible value ${r.index + 1}`} disabled={disabled} checked={false} onCheckedChange={() => props.onPromote(r.index)} className="mt-0.5" />
                            <span className="min-w-0">
                              <span className="break-all font-mono text-foreground">{r.key}</span>
                              <span className="block text-[11px] text-muted-foreground">
                                {r.places === 1 ? '1 place' : `${r.places} places`}, {pagesShort(r.pages)}
                                {r.reason ? ` · ${r.reason}` : ''}
                              </span>
                            </span>
                          </li>
                        ))}
                        {list.length >= shownCount && h.values > shownCount && (
                          <li>
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setHeldOpen((o) => ({ ...o, [h.kind]: shownCount + HELD_PAGE }))}>
                              Show {HELD_PAGE} more
                            </Button>
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
