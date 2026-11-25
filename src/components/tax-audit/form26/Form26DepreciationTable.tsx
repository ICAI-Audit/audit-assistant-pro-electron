// The two depreciation tables of schedule 36 (plant and machinery; other assets). Where every rate column
// fits, the file's own table: its headings word for word, rows 3 to 21 with their labels, calculated rows
// shaded and worked out on every keystroke as the file does. Where it does not, one rate column at a time:
// a row of choices over the rate columns, and the rows listed under it with their full labels.
import * as React from 'react';

import { Form26CellInput, FORM26_TD, FORM26_TH } from '@/components/tax-audit/form26/Form26Field';
import type { Form26TableProps } from '@/components/tax-audit/form26/Form26Table';
import { form26CellDomId, form26TableDomId } from '@/lib/taxAuditForm26EditorModel';
import { cellAccessibleName, depreciationColumnLabels, FORM26_DEP_MIN_PX, segmentKeyTarget } from '@/lib/taxAuditForm26Layout';
import { isUnfilledCell, normaliseRows, setCell, unfilledCellsByRow } from '@/lib/taxAuditForm26TableOps';
import { cn } from '@/lib/utils';

function focusById(id: string): boolean {
  if (typeof document === 'undefined') return false;
  const element = document.getElementById(id);
  if (!element) return false;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'center' });
  return true;
}

export function Form26DepreciationTable(props: Form26TableProps): JSX.Element {
  const { table, locked, unfilled, highlight, focus, layout } = props;
  const dep = table.dep;
  const rows = React.useMemo(() => normaliseRows(table, props.rows), [table, props.rows]);
  const unfilledByRow = React.useMemo(() => unfilledCellsByRow(unfilled, table.id), [unfilled, table.id]);
  const labels = React.useMemo(() => (dep ? depreciationColumnLabels(table) : []), [dep, table]);
  const [column, setColumn] = React.useState(0);
  const pendingFocus = React.useRef<string | null>(null);
  const tableId = form26TableDomId(table.id);
  const hintId = `${tableId}-hint`;
  const tabId = (j: number) => `${tableId}-rate-${j}`;
  const panelId = `${tableId}-panel`;

  const edit = (r: number, key: string, value: string) => {
    if (!locked) props.onChange(setCell(table, rows, r, key, value));
  };

  React.useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusById(target);
  }, [column]);

  React.useEffect(() => {
    if (!focus || !dep) return;
    const target = form26CellDomId(table.id, focus.row, focus.column);
    if (focusById(target)) return;
    const j = dep.rows[focus.row]?.cells.indexOf(focus.column) ?? -1;
    if (j >= 0) {
      pendingFocus.current = target;
      setColumn(j);
    }
  }, [focus, dep, table.id]);

  if (!dep) return <></>;

  const cell = (r: number, key: string, calculated: boolean) => (
    <Form26CellInput
      id={form26CellDomId(table.id, r, key)}
      type="num"
      value={rows[r]?.[key] ?? ''}
      label={cellAccessibleName(table, key, r)}
      locked={locked}
      unfilled={isUnfilledCell(unfilledByRow[r], key)}
      highlight={highlight}
      calculated={calculated}
      describedBy={hintId}
      onChange={(value) => edit(r, key, value)}
    />
  );

  const leave = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onLeave();
  };

  if (layout === 'table') {
    const total = FORM26_DEP_MIN_PX.row + FORM26_DEP_MIN_PX.label + dep.rates.length * FORM26_DEP_MIN_PX.cell;
    const share = (px: number) => `${((px / total) * 100).toFixed(4)}%`;
    return (
      <div id={tableId} onBlur={leave}>
        <div className="rounded-md border border-border bg-card">
          <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
            <colgroup>
              <col style={{ width: share(FORM26_DEP_MIN_PX.row) }} />
              <col style={{ width: share(FORM26_DEP_MIN_PX.label) }} />
              {dep.rates.map((rate, j) => (
                <col key={j} style={{ width: share(FORM26_DEP_MIN_PX.cell) }} />
              ))}
            </colgroup>
            <thead>
              {table.headerRows.map((headerRow, index) => (
                <tr key={index}>
                  {headerRow.cells.map((headerCell, cellIndex) =>
                    headerCell.tag === 'td' || headerRow.letters ? (
                      <td key={cellIndex} colSpan={headerCell.colspan} rowSpan={headerCell.rowspan} className={cn(FORM26_TH, '!py-1 font-normal')}>
                        {headerCell.text}
                      </td>
                    ) : (
                      <th key={cellIndex} scope="col" colSpan={headerCell.colspan} rowSpan={headerCell.rowspan} className={FORM26_TH}>
                        {headerCell.text}
                      </th>
                    ),
                  )}
                </tr>
              ))}
            </thead>
            <tbody>
              {dep.rows.map((depRow, r) => (
                <tr key={depRow.no} className={depRow.calculated ? 'bg-muted/30' : 'bg-card'}>
                  <td className={cn(FORM26_TD, '!pt-2 text-center tabular-nums text-subtle')}>{depRow.no}</td>
                  <th scope="row" className={cn(FORM26_TD, '!px-2 !pt-2 text-left font-normal')}>
                    {depRow.label}
                  </th>
                  {depRow.cells.map((key) => (
                    <td key={key} className={FORM26_TD}>
                      {cell(r, key, depRow.calculated)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span id={hintId} className="sr-only">
          Not filled yet.
        </span>
      </div>
    );
  }

  return (
    <div id={tableId} className="space-y-2" onBlur={leave}>
      <div role="tablist" aria-label="Rate column" className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/40 p-1">
        {labels.map((label, j) => (
          <button
            key={j}
            type="button"
            role="tab"
            id={tabId(j)}
            aria-selected={j === column}
            aria-controls={panelId}
            tabIndex={j === column ? 0 : -1}
            onClick={() => setColumn(j)}
            onKeyDown={(event) => {
              const next = segmentKeyTarget(event.key, j, labels.length);
              if (next === null) return;
              event.preventDefault();
              setColumn(next);
              pendingFocus.current = tabId(next);
            }}
            className={cn(
              'rounded-sm px-2 py-1 text-left text-xs leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              j === column ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(column)} className="rounded-md border border-border bg-card">
        <ul className="divide-y divide-border">
          {dep.rows.map((depRow, r) => {
            const key = depRow.cells[column];
            const cellId = form26CellDomId(table.id, r, key);
            return (
              <li key={depRow.no} className={cn('grid grid-cols-[2.25rem_minmax(0,1fr)_8.5rem] items-start gap-2 px-2 py-1.5', depRow.calculated && 'bg-muted/30')}>
                <span className="pt-1.5 text-center text-[13px] tabular-nums text-subtle">{depRow.no}</span>
                <label htmlFor={cellId} className="min-w-0 break-words pt-1.5 text-[13px] leading-5">
                  {depRow.label}
                </label>
                {cell(r, key, depRow.calculated)}
              </li>
            );
          })}
        </ul>
      </div>
      <span id={hintId} className="sr-only">
        Not filled yet.
      </span>
    </div>
  );
}
