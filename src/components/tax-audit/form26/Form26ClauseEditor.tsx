// The clause editor of the Form No. 26 workspace (the centre pane): the clause's heading and status line,
// then the blocks of task 13's model in the form's order - question rows as number | wording | answer on
// one grid, the tables and schedules under them, the text of Parts A and B, the signature and the notes.
// It draws the model and hands every change to its callbacks; it does not save by itself.
import * as React from 'react';
import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Form26Field } from '@/components/tax-audit/form26/Form26Field';
import { Form26Prose, Form26Wording } from '@/components/tax-audit/form26/Form26Prose';
import { Form26Table } from '@/components/tax-audit/form26/Form26Table';
import type { Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Definition, Form26QuestionRow } from '@/data/taxAuditForm26Types';
import {
  clauseProvenance,
  editorTitle,
  FORM26_REVIEW_LABEL,
  form26FieldDomId,
  form26FieldLabelId,
  form26FieldLocalLabel,
  form26ScheduleDomId,
  form26WordingId,
  proseFieldInline,
  signatureClosing,
  signatureFields,
  type Form26EditorBlock,
} from '@/lib/taxAuditForm26EditorModel';
import { chooseTableLayout, questionLayout, tableRoom } from '@/lib/taxAuditForm26Layout';
import { isRowLocked } from '@/lib/taxAuditForm26Review';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { Form26UnfilledItem } from '@/lib/taxAuditForm26Unfilled';
import { getField, type Form26Row, type Form26Values } from '@/lib/taxAuditForm26Values';
import { cn } from '@/lib/utils';
import type { TaxAuditReviewStatus } from '@/types/taxAudit';

export type Form26ClauseEditorProps = {
  def: Form26Definition;
  unit: Form26ClauseUnit;
  blocks: Form26EditorBlock[];
  values: Form26Values;
  row: Form26ClauseRow;
  lockedTables: ReadonlySet<string>;
  unfilled: Form26UnfilledItem[];
  highlightUnfilled: boolean;
  availableWidth: number;
  onField(fieldKey: string, value: string): void;
  onTable(tableId: string, rows: Form26Row[]): void;
  onTableLeft(tableId: string): void;
  onStatus(status: TaxAuditReviewStatus, options?: { unlockReason?: string }): Promise<void>;
  onRowUpdate(patch: Partial<Form26ClauseRow>): Promise<void>;
  onOpenLastYear(): void;
  focusTarget: { field?: string; table?: string; row?: number; column?: string } | null;
  /** The review bar (Prepared / Reviewed / Approve) beside the heading. */
  reviewBar?: React.ReactNode;
  /** What follows the clause: review remarks and the qualification box. */
  footer?: React.ReactNode;
  /** Answers that met someone else's change, by answer key. */
  conflicts?: Readonly<Record<string, { theirs: string; at: string }>>;
  onResolve?(fieldKey: string, keep: 'mine' | 'theirs'): void;
  onConfirm?(fieldKey: string): void;
  onFieldDraft?(fieldKey: string, value: string): void;
  onAnnounce?(message: string): void;
  /** A line under an answer (task 26: item 8 when the engagement's year has moved on), by answer key. */
  fieldNotes?: Readonly<Record<string, React.ReactNode>>;
  /** A quiet line at the top of the clause (task 26: the earlier Form 3CD draft has an answer for it). */
  bodyNotice?: React.ReactNode;
};

const NO_ROWS: Form26Row[] = [];
const NO_ITEMS: Form26UnfilledItem[] = [];
// Number | wording | answer on one grid, so every number, wording and answer starts on the same edge.
const COLUMNS = 'grid-cols-[3.25rem_minmax(0,1fr)_minmax(11rem,40%)]';
const STACKED = 'grid-cols-[3.25rem_minmax(0,1fr)]';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Bring a schedule into view and put the keyboard there (its heading area takes focus). */
function showSchedule(scheduleId: string) {
  if (typeof document === 'undefined') return;
  const element = document.getElementById(form26ScheduleDomId(scheduleId));
  if (!element) return;
  element.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  element.focus({ preventScroll: true });
}

/** Focus an answer by its id; a group of options takes the focus on its chosen (or first) option. */
function focusField(fieldKey: string) {
  if (typeof document === 'undefined') return;
  const element = document.getElementById(form26FieldDomId(fieldKey));
  if (!element) return;
  const target = element.matches('input, select, textarea, button')
    ? element
    : element.querySelector<HTMLElement>('[role="radio"][data-state="checked"]') ?? element.querySelector<HTMLElement>('[role="radio"]') ?? element;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center' });
}

export function Form26ClauseEditor(props: Form26ClauseEditorProps): JSX.Element {
  const { def, unit, blocks, values, row, lockedTables, unfilled, highlightUnfilled, availableWidth, focusTarget, conflicts } = props;
  const locked = isRowLocked(row);
  const title = editorTitle(unit);
  const titleId = `f26-editor-${unit.key}-title`;
  const layout = questionLayout(availableWidth);

  const fieldByKey = React.useMemo(() => new Map(def.fields.map((field) => [field.key, field])), [def]);
  const tableById = React.useMemo(() => new Map(def.tables.map((table) => [table.id, table])), [def]);
  const scheduleById = React.useMemo(() => new Map(def.schedules.map((schedule) => [schedule.id, schedule])), [def]);
  const groupById = React.useMemo(() => new Map(def.scheduleGroups.map((group) => [group.id, group])), [def]);
  const unfilledKeys = React.useMemo(() => new Set(unfilled.flatMap((item) => ('k' in item ? [item.k] : []))), [unfilled]);
  const unfilledByTable = React.useMemo(() => {
    const byTable: Record<string, Form26UnfilledItem[]> = {};
    for (const item of unfilled) if ('t' in item) (byTable[item.t] ??= []).push(item);
    return byTable;
  }, [unfilled]);
  const provenance = React.useMemo(() => clauseProvenance(row, unit.fields), [row, unit.fields]);
  const tableFocus = React.useMemo(
    () => (focusTarget?.table !== undefined && focusTarget.row !== undefined && focusTarget.column !== undefined ? { table: focusTarget.table, at: { row: focusTarget.row, column: focusTarget.column } } : null),
    [focusTarget],
  );

  React.useEffect(() => {
    if (focusTarget?.field) focusField(focusTarget.field);
  }, [focusTarget]);

  const renderField = (key: string, options: { labelledBy?: string; inline?: boolean } = {}) => {
    const field = fieldByKey.get(key);
    if (!field) return null;
    const note = props.fieldNotes?.[key];
    const control = (
      <Form26Field
        field={field}
        value={getField(values, key)}
        locked={locked}
        unfilled={unfilledKeys.has(key)}
        highlight={highlightUnfilled}
        conflict={conflicts?.[key]}
        provenance={provenance[key]}
        onCommit={(value) => props.onField(key, value)}
        onDraft={props.onFieldDraft ? (value) => props.onFieldDraft?.(key, value) : undefined}
        onConfirm={() => props.onConfirm?.(key)}
        onResolve={(keep) => props.onResolve?.(key, keep)}
        labelledBy={options.labelledBy}
        inline={options.inline}
      />
    );
    return note ? (
      <>
        {control}
        {note}
      </>
    ) : (
      control
    );
  };

  // An answer in a question row is named by the row's wording and the words beside it.
  const questionField = (questionRow: Form26QuestionRow, key: string) => {
    const local = form26FieldLocalLabel(def, key);
    const labelId = form26FieldLabelId(key);
    return (
      <>
        {local !== '' && (
          <span id={labelId} hidden>
            {local}
          </span>
        )}
        {renderField(key, { labelledBy: [form26WordingId(questionRow.index), local !== '' ? labelId : null].filter(Boolean).join(' ') })}
      </>
    );
  };

  const renderTable = (tableId: string, inSchedule: boolean) => {
    const table = tableById.get(tableId);
    if (!table) return null;
    return (
      <Form26Table
        table={table}
        rows={values.t[tableId] ?? NO_ROWS}
        locked={locked || lockedTables.has(tableId)}
        unfilled={unfilledByTable[tableId] ?? NO_ITEMS}
        highlight={highlightUnfilled}
        layout={chooseTableLayout(table, tableRoom(availableWidth, inSchedule))}
        room={tableRoom(availableWidth, inSchedule)}
        onChange={(rows) => props.onTable(tableId, rows)}
        onLeave={() => props.onTableLeft(tableId)}
        focus={tableFocus?.table === tableId ? tableFocus.at : null}
        onAnnounce={props.onAnnounce}
      />
    );
  };

  const renderBlock = (block: Form26EditorBlock, index: number): React.ReactNode => {
    switch (block.kind) {
      case 'question': {
        const rowUnfilled = !locked && block.row.fields.some((key) => unfilledKeys.has(key));
        return (
          <div key={`q${block.row.index}`} className={cn('grid gap-x-3 gap-y-2 py-2.5', layout === 'columns' ? COLUMNS : STACKED)} data-question-row={block.row.index}>
            <div className="flex items-start gap-1.5 pt-0.5 text-sm font-semibold tabular-nums leading-[1.375rem]">
              <span aria-hidden="true" className={cn('mt-[6px] h-2.5 w-2.5 shrink-0 rounded-full border-2', rowUnfilled ? 'border-subtle' : 'border-transparent')} />
              <span>{block.row.no}</span>
            </div>
            <Form26Wording id={form26WordingId(block.row.index)} html={block.row.wordingHtml ?? ''} className="pt-0.5" />
            <div className={cn('min-w-0', layout === 'stacked' && 'col-start-2')}>
              <Form26Prose nodes={block.answer} renderField={(key) => questionField(block.row, key)} onLink={showSchedule} className="space-y-1" />
            </div>
            {block.comparison.length > 0 && (
              // The quiet line(s) of the comparison with Form 3CD, under the wording (and the answer, in three
              // columns), with one small "Last year" where there is a Form 3CD answer to see.
              <div className={cn('col-start-2 space-y-1 text-xs leading-5 text-subtle', layout === 'columns' && 'col-span-2')} data-f26-comparison="">
                {block.comparison.map((line, lineIndex) => {
                  const lastWithThreeCd = block.comparison.map((entry) => entry.hasThreeCd).lastIndexOf(true);
                  return (
                    <p key={line.rowId} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0 break-words">{line.text}</span>
                      {lineIndex === lastWithThreeCd && (
                        <Button type="button" variant="link" className="h-4 p-0 text-xs" onClick={props.onOpenLastYear} data-f26-last-year-link="">
                          Last year
                        </Button>
                      )}
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        );
      }
      case 'table':
        if (!block.shown) return null;
        return (
          <div key={`t${block.tableId}`} className="py-2">
            {renderTable(block.tableId, false)}
          </div>
        );
      case 'schedule': {
        if (!block.shown) return null;
        const schedule = scheduleById.get(block.scheduleId);
        const group = schedule ? groupById.get(schedule.group) : undefined;
        const headingId = `${form26ScheduleDomId(block.scheduleId)}-title`;
        return (
          <section
            key={`s${block.scheduleId}`}
            id={form26ScheduleDomId(block.scheduleId)}
            aria-labelledby={headingId}
            tabIndex={-1}
            className="my-2 scroll-mt-3 rounded-md border border-border bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <header className="border-b border-border bg-muted/30 px-3 py-2">
              {group && <p className="text-xs leading-4 text-subtle">{group.title}</p>}
              <h3 id={headingId} className="text-sm font-semibold leading-5">
                {block.title}
              </h3>
            </header>
            <div className="space-y-2 p-2">
              {block.body.map((node, bodyIndex) =>
                typeof node !== 'string' && 'tbl' in node ? (
                  <React.Fragment key={`tbl${node.tbl}`}>{renderTable(node.tbl, true)}</React.Fragment>
                ) : (
                  <Form26Prose key={`p${bodyIndex}`} nodes={[node]} renderField={() => null} onLink={showSchedule} />
                ),
              )}
            </div>
          </section>
        );
      }
      case 'prose':
        return (
          <Form26Prose
            key={`p${index}`}
            nodes={block.nodes}
            onLink={showSchedule}
            className="py-2"
            renderField={(key) => {
              const field = fieldByKey.get(key);
              return field ? renderField(key, { inline: proseFieldInline(field) }) : null;
            }}
          />
        );
      case 'signature':
        return (
          <div key={`sign${block.prefix}`} className="my-2 rounded-md border border-border p-3">
            <div className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))' }}>
              {signatureFields(def, block.prefix).map((field) => {
                const nameId = `${form26FieldDomId(field.key)}-name`;
                return (
                  <div key={field.key} className="flex min-w-0 flex-col gap-1">
                    <label id={nameId} htmlFor={form26FieldDomId(field.key)} className="text-xs font-semibold leading-4">
                      {field.label}
                    </label>
                    {renderField(field.key, { labelledBy: nameId })}
                  </div>
                );
              })}
            </div>
            <p className="pt-3 text-right text-sm italic">{signatureClosing(def, block.prefix)}</p>
          </div>
        );
      case 'notes':
        return (
          <div key={`notes${index}`} className="my-2 rounded-md border border-border bg-muted/20 px-3 py-2">
            <Form26Prose nodes={block.nodes} renderField={() => null} className="text-xs leading-5" />
          </div>
        );
    }
  };

  return (
    // `overflow-clip`, not `overflow-hidden`: clipped to its rounded frame but not a scrolling box, so bringing a
    // control into view (scrollIntoView) scrolls only the body below and the title and review bar stay in view.
    <section aria-labelledby={titleId} className="flex h-full min-h-0 flex-col overflow-clip rounded-md border border-border bg-background">
      <header className="shrink-0 border-b border-border bg-background px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* 12rem at least: in a narrow editor the review bar goes under the title instead of squeezing it. */}
          <div className="min-w-[12rem] flex-1">
            <div className="flex items-start gap-2">
              <h2 id={titleId} className="text-base font-semibold leading-snug">
                {title.prefix && (
                  <>
                    {title.prefix} <span aria-hidden="true" className="font-normal text-subtle">·</span>{' '}
                  </>
                )}
                {title.label}
              </h2>
              {locked && <Lock aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-subtle" />}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-subtle">
              <span>{FORM26_REVIEW_LABEL[row.review_status] ?? FORM26_REVIEW_LABEL.draft}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px]">{row.workpaper_ref || unit.workpaperRef}</span>
              {locked && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Read-only</span>
                </>
              )}
            </p>
          </div>
          {props.reviewBar}
        </div>
      </header>
      {/* `availableWidth` is this body's clientWidth less its 24 px of side padding (the workspace measures it). */}
      {/* `relative`: what is placed out of the flow inside (the hidden labels) scrolls with the body, not the window. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto" data-f26-editor-body="">
        {props.bodyNotice && <div className="px-3 pt-2">{props.bodyNotice}</div>}
        <div className="divide-y divide-border/60 px-3 py-1">{blocks.map(renderBlock)}</div>
        {props.footer}
      </div>
    </section>
  );
}
