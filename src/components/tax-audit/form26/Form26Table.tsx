// A table of Form No. 26 in the clause editor. The layout comes from the room there is (task 13): a real
// table when every column gets its minimum width, otherwise a row list (one row open as a small form), and
// for the two depreciation tables one rate column at a time. Nothing scrolls sideways and nothing is cut.
// Headings, fixed rows, the Total line, calculated cells and the rows a table opens with are the office's
// fillable file's; every table of added rows can delete a row (decision A3).
import * as React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Form26AddRow, Form26CellInput, FORM26_TD, FORM26_TH } from '@/components/tax-audit/form26/Form26Field';
import { Form26DepreciationTable } from '@/components/tax-audit/form26/Form26DepreciationTable';
import { Form26RowList } from '@/components/tax-audit/form26/Form26RowList';
import type { Form26Column, Form26Table as Form26TableDef } from '@/data/taxAuditForm26Types';
import { tableTotals } from '@/lib/taxAuditForm26Calc';
import { form26CellDomId, form26TableDomId } from '@/lib/taxAuditForm26EditorModel';
import {
  cellAccessibleName,
  FORM26_MIN_COLUMN_PX,
  FORM26_ROW_ACTION_PX,
  rowListEnterAction,
  showsDeleteColumn,
  tableAnnouncement,
  type Form26TableLayout,
} from '@/lib/taxAuditForm26Layout';
import { addRow, canAddRows, deleteRow, isUnfilledCell, normaliseRows, rowLimitReached, setCell, unfilledCellsByRow } from '@/lib/taxAuditForm26TableOps';
import type { Form26UnfilledItem } from '@/lib/taxAuditForm26Unfilled';
import type { Form26Row } from '@/lib/taxAuditForm26Values';
import { cn } from '@/lib/utils';

export type Form26TableProps = {
  table: Form26TableDef;
  rows: Form26Row[];
  locked: boolean;
  unfilled: Form26UnfilledItem[];
  highlight: boolean;
  layout: Form26TableLayout;
  onChange(rows: Form26Row[]): void;
  onLeave(): void;
  focus: { row: number; column: string } | null;
  /** Says a row was added, deleted or cleared (for the workspace's one polite live region). */
  onAnnounce?(message: string): void;
  /** The width the table has (px); a row list sums its rows up in fewer columns when it is narrow. */
  room?: number;
};

/** Focus a control by id once it is on screen, without a jump, and bring it into view. */
function focusById(id: string): boolean {
  if (typeof document === 'undefined') return false;
  const element = document.getElementById(id);
  if (!element) return false;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'center' });
  return true;
}

type GridRowProps = {
  table: Form26TableDef;
  row: Form26Row;
  r: number;
  locked: boolean;
  highlight: boolean;
  unfilledCells: string | undefined;
  deletable: boolean;
  hintId: string;
  onCell(r: number, c: string, value: string): void;
  onDelete(r: number): void;
  onKey(r: number, c: string, event: React.KeyboardEvent<HTMLElement>): void;
};

/** One row of the grid. Drawn again only when its own values or marks change, so long tables stay quick. */
const GridRow = React.memo(function GridRow({ table, row, r, locked, highlight, unfilledCells, deletable, hintId, onCell, onDelete, onKey }: GridRowProps) {
  let fixedIndex = 0;
  return (
    <tr className="bg-card">
      {table.columns.map((column) => {
        if (column.type === 'sl') {
          return (
            <td key={column.c} className={cn(FORM26_TD, 'text-center tabular-nums text-subtle !pt-2')}>
              {r + 1}
            </td>
          );
        }
        if (column.type === 's') {
          const text = table.fixedRows?.[r]?.[fixedIndex] ?? '';
          fixedIndex += 1;
          return (
            <td key={column.c} className={cn(FORM26_TD, '!px-2 !pt-2')}>
              {text}
            </td>
          );
        }
        return (
          <td key={column.c} className={FORM26_TD}>
            <Form26CellInput
              id={form26CellDomId(table.id, r, column.c)}
              type={column.type}
              options={column.options}
              value={row[column.c] ?? ''}
              label={cellAccessibleName(table, column.c, r)}
              locked={locked}
              unfilled={isUnfilledCell(unfilledCells, column.c)}
              highlight={highlight}
              calculated={column.type === 'calc'}
              describedBy={hintId}
              onChange={(value) => onCell(r, column.c, value)}
              onKeyDown={(event) => onKey(r, column.c, event)}
            />
          </td>
        );
      })}
      {deletable && (
        <td className={cn(FORM26_TD, 'text-center')}>
          {!locked && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-subtle hover:text-foreground" aria-label={`Delete row ${r + 1}`} title="Delete row" onClick={() => onDelete(r)}>
              <X aria-hidden="true" />
            </Button>
          )}
        </td>
      )}
    </tr>
  );
});

function GridTable(props: Form26TableProps): JSX.Element {
  const { table, locked, unfilled, highlight, focus } = props;
  const rows = React.useMemo(() => normaliseRows(table, props.rows), [table, props.rows]);
  const totals = React.useMemo(() => tableTotals(table, rows), [table, rows]);
  const unfilledByRow = React.useMemo(() => unfilledCellsByRow(unfilled, table.id), [unfilled, table.id]);
  // No column is kept for a delete control that is not shown (a locked table: nothing empty at the right edge).
  const deletable = showsDeleteColumn(table, locked);
  const addable = canAddRows(table) && !locked;
  const inputs = React.useMemo(() => table.columns.filter((column) => column.input), [table]);
  const tableId = form26TableDomId(table.id);
  const hintId = `${tableId}-hint`;

  // The latest rows and callbacks, so the handlers given to each row never change and rows stay memoised.
  const latest = React.useRef({ rows, onChange: props.onChange, onAnnounce: props.onAnnounce, locked });
  latest.current = { rows, onChange: props.onChange, onAnnounce: props.onAnnounce, locked };
  const pendingFocus = React.useRef<{ row: number; column: string } | null>(null);

  const onCell = React.useCallback((r: number, c: string, value: string) => {
    if (latest.current.locked) return;
    latest.current.onChange(setCell(table, latest.current.rows, r, c, value));
  }, [table]);

  const onAdd = React.useCallback(() => {
    const next = addRow(table, latest.current.rows);
    if (next === latest.current.rows) return;
    const first = table.columns.find((column) => column.input);
    if (first) pendingFocus.current = { row: next.length - 1, column: first.c };
    latest.current.onChange(next);
    latest.current.onAnnounce?.(tableAnnouncement('added', next.length));
  }, [table]);

  const onDelete = React.useCallback((r: number) => {
    const before = latest.current.rows;
    const next = deleteRow(table, before, r);
    const first = table.columns.find((column) => column.input);
    if (first) pendingFocus.current = { row: Math.min(r, next.length - 1), column: first.c };
    latest.current.onChange(next);
    latest.current.onAnnounce?.(tableAnnouncement(before.length === 1 ? 'cleared' : 'deleted', r + 1));
  }, [table]);

  const onKey = React.useCallback((r: number, c: string, event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const fieldIndex = inputs.findIndex((column) => column.c === c);
    const action = rowListEnterAction({
      fieldIndex,
      fieldCount: inputs.length,
      rowIndex: r,
      rowCount: latest.current.rows.length,
      canAdd: canAddRows(table) && !latest.current.locked && !rowLimitReached(table, latest.current.rows),
      multiline: inputs[fieldIndex]?.type === 'ta',
    });
    if (action === 'none') return;
    event.preventDefault();
    if (action === 'add-row') onAdd();
    else focusById(form26CellDomId(table.id, r + 1, inputs[0].c));
  }, [inputs, onAdd, table]);

  React.useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusById(form26CellDomId(table.id, target.row, target.column));
  }, [rows, table.id]);

  React.useEffect(() => {
    if (focus) focusById(form26CellDomId(table.id, focus.row, focus.column));
  }, [focus, table.id]);

  const total = table.columns.reduce((sum, column) => sum + FORM26_MIN_COLUMN_PX[column.type], 0) + (deletable ? FORM26_ROW_ACTION_PX : 0);
  const share = (px: number) => `${((px / total) * 100).toFixed(4)}%`;

  return (
    <div
      id={tableId}
      className="space-y-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onLeave();
      }}
    >
      <div className="rounded-md border border-border bg-card">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup>
            {table.columns.map((column) => (
              <col key={column.c} style={{ width: share(FORM26_MIN_COLUMN_PX[column.type]) }} />
            ))}
            {deletable && <col style={{ width: share(FORM26_ROW_ACTION_PX) }} />}
          </colgroup>
          <thead>
            {table.headerRows.map((headerRow, index) => (
              <tr key={index}>
                {headerRow.cells.map((cell, cellIndex) =>
                  cell.tag === 'td' || headerRow.letters ? (
                    <td key={cellIndex} colSpan={cell.colspan} rowSpan={cell.rowspan} className={cn(FORM26_TH, '!py-1 font-normal')}>
                      {cell.text}
                    </td>
                  ) : (
                    <th key={cellIndex} scope="col" colSpan={cell.colspan} rowSpan={cell.rowspan} className={FORM26_TH}>
                      {cell.text}
                    </th>
                  ),
                )}
                {index === 0 && deletable && (
                  <th scope="col" rowSpan={table.headerRows.length} className={FORM26_TH}>
                    <span className="sr-only">Delete row</span>
                  </th>
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <GridRow
                key={r}
                table={table}
                row={row}
                r={r}
                locked={locked}
                highlight={highlight}
                unfilledCells={unfilledByRow[r]}
                deletable={deletable}
                hintId={hintId}
                onCell={onCell}
                onDelete={onDelete}
                onKey={onKey}
              />
            ))}
          </tbody>
          {table.total && <TotalRow columns={table.columns} label={table.total.label} labelColspan={table.total.labelColspan} totals={totals} deletable={deletable} />}
        </table>
      </div>
      {addable && <Form26AddRow full={rowLimitReached(table, rows)} limitId={`${tableId}-limit`} onAdd={onAdd} />}
      <span id={hintId} className="sr-only">
        Not filled yet.
      </span>
    </div>
  );
}

function TotalRow({ columns, label, labelColspan, totals, deletable }: { columns: Form26Column[]; label: string; labelColspan: number; totals: Record<string, string>; deletable: boolean }) {
  return (
    <tfoot>
      <tr className="bg-muted/30">
        <td colSpan={labelColspan} className={cn(FORM26_TD, '!px-2 !py-1.5 text-right font-semibold')}>
          {label}
        </td>
        {columns.slice(labelColspan).map((column) => (
          <td key={column.c} className={cn(FORM26_TD, '!px-2 !py-1.5 text-right font-semibold tabular-nums')}>
            {totals[column.c] ?? ''}
          </td>
        ))}
        {deletable && <td className={FORM26_TD} />}
      </tr>
    </tfoot>
  );
}

/** A table of the form, drawn in the layout the room allows. */
export function Form26Table(props: Form26TableProps): JSX.Element {
  if (props.table.dep) return <Form26DepreciationTable {...props} />;
  if (props.layout === 'rowlist') return <Form26RowList {...props} />;
  return <GridTable {...props} />;
}
