// "What changed" (BUILD-PLAN task 25), a tab of the workspace: Form No. 26 beside Form No. 3CD, clause by
// clause, from the mapping as shown (the rows corrected from the official texts). Chips All · New · Changed
// · Same · Not in Form 26 with their counts, the table of the chip, a Form 26 clause opens in "Clauses", and
// "Download briefing" gives the rows on screen as a Word file. No text of this view enters an exported form.
import * as React from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { Form26TabPanelProps } from '@/components/tax-audit/form26/Form26Workspace';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import {
  briefingFileName,
  briefingSubtitle,
  buildBriefingDocx,
  form26RefsText,
  FORM26_CHANGE_FILTERS,
  notInForm26Cells,
  whatChangedCells,
  whatChangedColumns,
  whatChangedRows,
  type Form26ChangeFilter,
} from '@/lib/taxAuditForm26Compare';
import { form26SaveLine, saveForm26As } from '@/lib/taxAuditForm26SaveAs';
import { cn } from '@/lib/utils';

const UNIT_OF_CLAUSE = new Map(FORM26_CLAUSE_UNITS.map((unit) => [unit.no, unit.key]));
// The application's global table rule keeps every cell on one line and cuts it with "…" (src/index.css):
// here every heading and cell wraps, whole words first.
const TH = '!max-w-none !overflow-visible !whitespace-normal !px-2 !py-1.5 !text-xs !leading-4 break-words align-bottom font-semibold';
const TD = '!max-w-none !overflow-visible !whitespace-normal !px-2 !py-1.5 !text-[13px] !leading-5 break-words align-top';
const TD_SMALL = '!text-xs !leading-5';

export function Form26WhatChanged({ openClause, initialFilter = 'all' }: Form26TabPanelProps & { initialFilter?: Form26ChangeFilter }): JSX.Element {
  const [filter, setFilter] = React.useState<Form26ChangeFilter>(initialFilter);
  const [busy, setBusy] = React.useState(false);
  const result = React.useMemo(() => whatChangedRows(filter), [filter]);
  const columns = React.useMemo(() => whatChangedColumns(filter), [filter]);

  // Straight from the click: the save window must open before anything is awaited (FIX-T29). A cancel says nothing.
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await saveForm26As({ name: briefingFileName(filter), kind: 'docx', make: () => buildBriefingDocx(filter) });
      if (result.outcome === 'failed') console.error('Form No. 26 briefing:', result.error);
      const shown = form26SaveLine(result, { done: 'The briefing was saved.', makeFailed: 'The briefing could not be made. Try again.', notReady: '' });
      if (!shown.toast) return;
      if (shown.failed) toast.error(shown.text);
      else toast.success(shown.text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="f26-what-changed-title" className="space-y-3 rounded-md border bg-background p-3" data-f26-what-changed="">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[12rem] flex-1">
          <h2 id="f26-what-changed-title" className="text-base font-semibold">
            What changed
          </h2>
          <p className="text-xs text-subtle">Form No. 26 beside Form No. 3CD, clause by clause.</p>
        </div>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void download()} aria-disabled={busy || undefined} data-f26-briefing="">
          <Download aria-hidden="true" className="h-4 w-4" />
          Download briefing
        </Button>
      </div>
      <div role="group" aria-label="Show changes" className="flex flex-wrap gap-1">
        {FORM26_CHANGE_FILTERS.map((chip) => (
          <Button
            key={chip.id}
            type="button"
            size="sm"
            variant={filter === chip.id ? 'default' : 'outline'}
            aria-pressed={filter === chip.id}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setFilter(chip.id)}
            data-f26-change-chip={chip.id}
          >
            {chip.label}
            <span className="text-[10px] tabular-nums opacity-75">{result.counts[chip.id]}</span>
          </Button>
        ))}
      </div>
      <table className="w-full table-fixed border-collapse text-sm" data-f26-change-table={filter}>
        <caption className="sr-only">{briefingSubtitle(filter)}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: `${column.share}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={TH}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filter === 'not-in-form26'
            ? result.notInForm26.map((entry) => (
                <tr key={entry.threeCd} className="border-b border-border/60 align-top">
                  {notInForm26Cells(entry).map((text, index) => (
                    <td key={index} className={cn(TD, index === 0 && 'font-medium tabular-nums')}>
                      {text}
                    </td>
                  ))}
                </tr>
              ))
            : result.rows.map((row) => {
                const cells = whatChangedCells(row, filter);
                return (
                  <tr key={row.id} className="border-b border-border/60 align-top" data-f26-change-row={row.id}>
                    <td className={cn(TD, 'tabular-nums')}>
                      <span className="flex flex-wrap gap-x-1">
                        {row.form26.map((ref, index) => {
                          const key = UNIT_OF_CLAUSE.get(ref.clause);
                          const one = form26RefsText({ ...row, form26: [ref] });
                          return (
                            <span key={`${ref.clause}-${index}`} className="whitespace-nowrap">
                              {key ? (
                                <Button
                                  type="button"
                                  variant="link"
                                  className="h-auto p-0 text-[13px] font-medium tabular-nums"
                                  onClick={() => openClause(key)}
                                  aria-label={`Open clause ${one}`}
                                  data-f26-open-clause={ref.clause}
                                >
                                  {one}
                                </Button>
                              ) : (
                                one
                              )}
                              {index < row.form26.length - 1 ? ',' : ''}
                            </span>
                          );
                        })}
                      </span>
                    </td>
                    {cells.slice(1).map((text, index) => (
                      <td key={index} className={cn(TD, (index === 1 || index === 2 || index === 3) && TD_SMALL)}>
                        {text}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </section>
  );
}
