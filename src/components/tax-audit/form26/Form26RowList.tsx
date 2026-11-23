// A table of many columns where there is not room for all of them side by side: its rows are listed with
// the values that sum each one up and where it stands ("Complete", "2 to fill"); one row at a time is open
// as a small form, every field labelled with its column's letter and full heading. A fixed row (12(d), 16(b), 20 …)
// is shown by its own pre-printed labels, on its line and at the top of the open row, as the file prints them
// (FIX-T29 D1); a row of added rows by its number. Only the open row's
// controls are on screen and each listed row is drawn again only when it changes, so a table of hundreds
// of rows stays quick. Nothing scrolls sideways.
import * as React from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Form26AddRow, Form26CellInput } from '@/components/tax-audit/form26/Form26Field';
import type { Form26TableProps } from '@/components/tax-audit/form26/Form26Table';
import type { Form26Column, Form26Table as Form26TableDef } from '@/data/taxAuditForm26Types';
import { tableTotals } from '@/lib/taxAuditForm26Calc';
import { form26CellDomId, form26TableDomId } from '@/lib/taxAuditForm26EditorModel';
import {
  cellAccessibleName,
  columnFullHeading,
  rowListEnterAction,
  rowListInitialOpen,
  rowListHeading,
  rowListLabels,
  rowListRowName,
  rowListSummaryColumns,
  rowListSummaryCount,
  rowListTemplate,
  rowListToggleLabel,
  rowStateText,
  showsDeleteColumn,
  summaryValue,
  tableAnnouncement,
} from '@/lib/taxAuditForm26Layout';
import { addRow, canAddRows, deleteRow, isUnfilledCell, normaliseRows, rowLimitReached, rowState, setCell, unfilledCellsByRow } from '@/lib/taxAuditForm26TableOps';
import type { Form26Row } from '@/lib/taxAuditForm26Values';
import { cn } from '@/lib/utils';

function focusById(id: string): boolean {
  if (typeof document === 'undefined') return false;
  const element = document.getElementById(id);
  if (!element) return false;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'center' });
  return true;
}

// Three fields across when there is room, fewer when there is not; never wider than the clause.
const THREE_ACROSS: React.CSSProperties = { gridTemplateColumns: 'repeat(auto-fill, minmax(max(11rem, calc((100% - 1.5rem) / 3)), 1fr))' };
const isFigure = (column: Form26Column) => column.type === 'num' || column.type === 'calc';

type RowLineProps = {
  table: Form26TableDef;
  row: Form26Row;
  r: number;
  open: boolean;
  summary: Form26Column[];
  template: React.CSSProperties;
  withDeleteColumn: boolean;
  canDelete: boolean;
  toggleId: string;
  formId: string;
  onToggle(r: number): void;
  onDelete(r: number): void;
};

/** A fixed row's pre-printed labels, whole, wrapping between words; the first of several ("(i)") quieter. */
function RowLabels({ labels }: { labels: string[] }): JSX.Element {
  return (
    <>
      {labels.map((label, index) => (
        <React.Fragment key={index}>
          {index > 0 && ' '}
          <span className={index === 0 && labels.length > 1 ? 'tabular-nums text-subtle' : undefined}>{label}</span>
        </React.Fragment>
      ))}
    </>
  );
}

/** One listed row: its number (a fixed row: its labels), its summing-up values, its state, and its delete control. */
const RowLine = React.memo(function RowLine({ table, row, r, open, summary, template, withDeleteColumn, canDelete, toggleId, formId, onToggle, onDelete }: RowLineProps) {
  const state = rowState(table, row);
  const labels = rowListLabels(table, r);
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        id={toggleId}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        aria-label={rowListToggleLabel(table, row, r)}
        onClick={() => onToggle(r)}
        className="grid flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] leading-5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={template}
      >
        {labels.length > 0 ? (
          // With summing-up columns the labels take the whole first line of the grid, above the values.
          <span className="min-w-0 break-words" style={summary.length > 0 ? { gridColumn: '1 / -1' } : undefined} data-f26-row-labels="">
            <RowLabels labels={labels} />
          </span>
        ) : (
          <span className="tabular-nums text-subtle">{r + 1}</span>
        )}
        {summary.map((column) => (
          <span key={column.c} className={cn('min-w-0 break-words', isFigure(column) && 'text-right tabular-nums')}>
            {summaryValue(column, row[column.c] ?? '')}
          </span>
        ))}
        <span>
          <span className={cn(badgeVariants({ variant: state.filled && state.toFill === 0 ? 'success' : 'neutral' }), 'px-1.5 py-0 text-[11px] font-medium')}>{rowStateText(state)}</span>
        </span>
        {open ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-subtle" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-subtle" />}
      </button>
      {withDeleteColumn && (
        <span className="flex w-9 shrink-0 items-center justify-center">
          {canDelete && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-subtle hover:text-foreground" aria-label={`Delete row ${r + 1}`} title="Delete row" onClick={() => onDelete(r)}>
              <X aria-hidden="true" />
            </Button>
          )}
        </span>
      )}
    </div>
  );
});

export function Form26RowList(props: Form26TableProps): JSX.Element {
  const { table, locked, unfilled, highlight, focus } = props;
  const rows = React.useMemo(() => normaliseRows(table, props.rows), [table, props.rows]);
  const totals = React.useMemo(() => tableTotals(table, rows), [table, rows]);
  const unfilledByRow = React.useMemo(() => unfilledCellsByRow(unfilled, table.id), [unfilled, table.id]);
  const [open, setOpen] = React.useState<number | null>(() => rowListInitialOpen(normaliseRows(table, props.rows).map((row) => rowState(table, row))));
  const pendingFocus = React.useRef<string | null>(null);

  const inputs = React.useMemo(() => table.columns.filter((column) => column.input), [table]);
  // No room is kept for a delete control that is not shown (a locked table).
  const withDeleteColumn = showsDeleteColumn(table, locked);
  // As many summing-up columns as the room holds with every heading word whole (a narrow editor shows one).
  const wanted = React.useMemo(
    () => rowListSummaryColumns(table).map((key) => table.columns.find((column) => column.c === key)).filter((column): column is Form26Column => column !== undefined),
    [table],
  );
  // A fixed table's lines carry no number column: its rows are shown by their pre-printed labels.
  const fixed = table.fixedRows !== undefined && !table.dep;
  const shown = rowListSummaryCount(props.room ?? Number.POSITIVE_INFINITY, wanted.map(rowListHeading), withDeleteColumn, fixed);
  const summary = React.useMemo(() => wanted.slice(0, shown), [wanted, shown]);
  const template = React.useMemo<React.CSSProperties>(() => ({ gridTemplateColumns: rowListTemplate(summary.length, fixed) }), [summary.length, fixed]);
  const serial = table.columns.find((column) => column.type === 'sl');
  const addable = canAddRows(table) && !locked;
  const tableId = form26TableDomId(table.id);
  const hintId = `${tableId}-hint`;
  const toggleId = React.useCallback((r: number) => `${tableId}-row-${r}`, [tableId]);
  const formId = (r: number) => `${tableId}-row-${r}-form`;
  const openRow = open !== null && open < rows.length ? open : null;

  // The latest rows and callbacks, so the handlers given to each listed row never change.
  const latest = React.useRef({ rows, onChange: props.onChange, onAnnounce: props.onAnnounce, openRow });
  latest.current = { rows, onChange: props.onChange, onAnnounce: props.onAnnounce, openRow };

  const add = React.useCallback(() => {
    const next = addRow(table, latest.current.rows);
    if (next === latest.current.rows) return;
    setOpen(next.length - 1);
    const first = table.columns.find((column) => column.input);
    if (first) pendingFocus.current = form26CellDomId(table.id, next.length - 1, first.c);
    latest.current.onChange(next);
    latest.current.onAnnounce?.(tableAnnouncement('added', next.length));
  }, [table]);

  const onDelete = React.useCallback((r: number) => {
    const before = latest.current.rows;
    const next = deleteRow(table, before, r);
    const current = latest.current.openRow;
    if (current !== null && current >= next.length) setOpen(next.length - 1);
    pendingFocus.current = toggleId(Math.min(r, next.length - 1));
    latest.current.onChange(next);
    latest.current.onAnnounce?.(tableAnnouncement(before.length === 1 ? 'cleared' : 'deleted', r + 1));
  }, [table, toggleId]);

  const onToggle = React.useCallback((r: number) => setOpen((current) => (current === r ? null : r)), []);

  const onKey = (r: number, fieldIndex: number, event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const action = rowListEnterAction({
      fieldIndex,
      fieldCount: inputs.length,
      rowIndex: r,
      rowCount: rows.length,
      canAdd: addable && !rowLimitReached(table, rows),
      multiline: inputs[fieldIndex]?.type === 'ta',
    });
    if (action === 'none') return;
    event.preventDefault();
    if (action === 'add-row') {
      add();
      return;
    }
    setOpen(r + 1);
    pendingFocus.current = form26CellDomId(table.id, r + 1, inputs[0].c);
  };

  React.useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusById(target);
  }, [openRow, rows]);

  React.useEffect(() => {
    if (!focus) return;
    const target = form26CellDomId(table.id, focus.row, focus.column);
    // Already open: focus now; otherwise once the row has opened.
    if (focusById(target)) return;
    pendingFocus.current = target;
    setOpen(focus.row);
  }, [focus, table.id]);

  return (
    <div
      id={tableId}
      className="space-y-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onLeave();
      }}
    >
      <div className="rounded-md border border-border bg-card">
        <div className="flex items-end border-b border-border bg-muted/60 text-xs font-semibold leading-4 text-subtle" aria-hidden="true">
          <div className="grid flex-1 items-end gap-2 px-2 py-1.5" style={template}>
            {(!fixed || summary.length === 0) && <span>{serial?.header ?? ''}</span>}
            {summary.map((column) => (
              // `break-words` is only a last guard: the column is chosen wide enough for the heading's widest word.
              <span key={column.c} className={cn('min-w-0 break-words', isFigure(column) && 'text-right')}>
                {rowListHeading(column)}
              </span>
            ))}
            <span>Row</span>
            <span />
          </div>
          {withDeleteColumn && <span className="w-9 shrink-0" />}
        </div>
        <ul className="divide-y divide-border">
          {rows.map((row, r) => {
            const isOpen = openRow === r;
            return (
              <li key={r} className={cn(isOpen && 'bg-muted/20')}>
                <RowLine
                  table={table}
                  row={row}
                  r={r}
                  open={isOpen}
                  summary={summary}
                  template={template}
                  withDeleteColumn={withDeleteColumn}
                  canDelete={!locked}
                  toggleId={toggleId(r)}
                  formId={formId(r)}
                  onToggle={onToggle}
                  onDelete={onDelete}
                />
                {isOpen && (
                  <div
                    id={formId(r)}
                    role="group"
                    aria-label={rowListRowName(table, r)}
                    className="border-t border-border px-3 pb-3 pt-2"
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(null);
                      pendingFocus.current = toggleId(r);
                    }}
                  >
                    {fixed && (
                      <p className="mb-2 break-words text-[13px] font-medium leading-5" data-f26-row-title="">
                        <RowLabels labels={rowListLabels(table, r)} />
                      </p>
                    )}
                    <div className="grid gap-x-3 gap-y-2" style={THREE_ACROSS}>
                      {inputs.map((column, fieldIndex) => {
                        const cellId = form26CellDomId(table.id, r, column.c);
                        return (
                          <div key={column.c} className="flex min-w-0 flex-col gap-1">
                            <label htmlFor={cellId} className="text-xs font-medium leading-4 text-foreground">
                              {column.letter && <span className="mr-1 font-normal text-subtle">{column.letter}</span>}
                              {columnFullHeading(column)}
                            </label>
                            <Form26CellInput
                              id={cellId}
                              type={column.type}
                              options={column.options}
                              value={row[column.c] ?? ''}
                              label={cellAccessibleName(table, column.c, r)}
                              locked={locked}
                              unfilled={isUnfilledCell(unfilledByRow[r], column.c)}
                              highlight={highlight}
                              calculated={column.type === 'calc'}
                              describedBy={hintId}
                              onChange={(value) => {
                                if (!locked) props.onChange(setCell(table, rows, r, column.c, value));
                              }}
                              onKeyDown={(event) => onKey(r, fieldIndex, event)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {table.total && (
          // The figures stand right-aligned in tabular figures, as in the grid's Total line (UX 3.12 item 11).
          <div className="border-t border-border bg-muted/30 px-3 py-2" data-f26-rowlist-total="">
            <p className="text-xs font-semibold">{table.total.label}</p>
            <dl className="mt-1 grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}>
              {table.total.columns.map((key) => {
                const column = table.columns.find((entry) => entry.c === key);
                return (
                  <div key={key} className="flex min-w-0 flex-col text-right">
                    <dt className="break-words text-xs leading-4 text-subtle">
                      {column?.letter ? `${column.letter} ` : ''}
                      {column ? columnFullHeading(column) : key}
                    </dt>
                    <dd className="min-h-5 text-right text-[13px] font-semibold tabular-nums">{totals[key] ?? ''}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>
      {addable && <Form26AddRow full={rowLimitReached(table, rows)} limitId={`${tableId}-limit`} onAdd={add} />}
      <span id={hintId} className="sr-only">
        Not filled yet.
      </span>
    </div>
  );
}
