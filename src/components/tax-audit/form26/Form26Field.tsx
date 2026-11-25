// The answer controls of Form No. 26, each the office's fillable file's control in the application's look:
// yes/no and choices as selects, the groups of options as radio buttons, text, long text, dates, amounts
// and the e-mail box. An answer keeps its draft while focused and is handed on when it is left (a select
// or an option: when chosen). Nothing here saves: values and callbacks come in as props.
import * as React from 'react';
import { Check, Plus } from 'lucide-react';

import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import type { Form26ColumnType, Form26Field as Form26FieldDef } from '@/data/taxAuditForm26Types';
import {
  fieldConflictLine,
  form26LeaveAction,
  FORM26_CONFLICT_ACTION_LABEL,
  FORM26_PROVENANCE_LABEL,
  form26FieldAccessibleName,
  form26FieldDomId,
  yesNoForKey,
} from '@/lib/taxAuditForm26EditorModel';
import { rowLimitText } from '@/lib/taxAuditForm26Layout';
import { cn } from '@/lib/utils';

export type Form26FieldProps = {
  field: Form26FieldDef;
  value: string;
  locked: boolean;
  unfilled: boolean;
  highlight: boolean;
  conflict?: { theirs: string; at: string };
  provenance?: 'client-master' | 'brought-from-3cd' | null;
  onCommit(value: string): void;
  onDraft?(value: string): void;
  onConfirm?(): void;
  onResolve?(keep: 'mine' | 'theirs'): void;
  inputRef?: React.Ref<HTMLElement>;
  /** Ids of the visible words that name this answer (the question's wording, the words beside it). Without it the control is named by the form's own words. */
  labelledBy?: string;
  /** Inside a sentence of Parts A and B: the control sits in the line of text. */
  inline?: boolean;
};

/** The shared look of a compact control, in step with the Tax Audit screens. */
export const FORM26_CONTROL = 'h-8 rounded-md border-input bg-background px-2 text-sm text-foreground md:text-sm';
/** "Highlight unfilled": the file's tint in the soft warning colour, and a dashed edge so colour is not the only sign. */
export const FORM26_UNFILLED_TINT = 'border-dashed border-warning/70 bg-warning-soft';
/** A read-only control after approval: calm, readable, still focusable where the control allows it. */
export const FORM26_LOCKED = 'bg-muted/40 disabled:cursor-default disabled:opacity-100';
// The global stylesheet forces every table cell to nowrap, 11 px and a 250 px cut with `!important`
// (src/index.css 190-209). These overrides keep Form 26 headings and cells whole, as ui/data-table.tsx does.
export const FORM26_TH = '!whitespace-normal !px-2 !py-1.5 !text-xs !leading-4 border-b border-r border-border bg-muted/60 text-center align-bottom font-semibold text-subtle last:border-r-0';
export const FORM26_TD = '!max-w-none !overflow-visible !whitespace-normal !p-1 !text-[13px] !leading-5 border-b border-r border-border align-top last:border-r-0';
const NUMBER = 'text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/** A number box ignores the mouse wheel: the wheel scrolls the page instead of changing the figure. */
function leaveOnWheel(event: React.WheelEvent<HTMLInputElement>) {
  if (typeof document !== 'undefined' && document.activeElement === event.currentTarget) event.currentTarget.blur();
}

function setRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<T | null>).current = node;
}

export function Form26Field(props: Form26FieldProps): JSX.Element {
  const { field, value, locked, unfilled, highlight, conflict, provenance, onCommit, onDraft, onConfirm, onResolve, inputRef, labelledBy, inline } = props;
  const id = form26FieldDomId(field.key);
  const hintId = `${id}-hint`;
  const lineId = `${id}-line`;
  const [draft, setDraft] = React.useState(value);
  const focused = React.useRef(false);
  // What the box showed when it took the keyboard: only a change from it is the user's own (form26LeaveAction).
  const atFocus = React.useRef(value);

  React.useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const showHint = unfilled && !locked;
  const tint = showHint && highlight;
  const line = conflict ? fieldConflictLine(conflict, locked) : null;
  const hasLine = provenance !== undefined || line !== null;
  const describedBy = [showHint ? hintId : null, line ? lineId : null].filter(Boolean).join(' ') || undefined;
  const naming = labelledBy
    ? { 'aria-labelledby': labelledBy }
    : { 'aria-label': form26FieldAccessibleName(FORM26_DEFINITION, field.key) };
  const shared = {
    id,
    ...naming,
    'aria-describedby': describedBy,
    'data-unfilled': unfilled ? 'true' : undefined,
  };

  const commit = (next: string) => {
    setDraft(next);
    if (next !== value) onCommit(next);
  };
  const typing = {
    value: draft,
    onFocus: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      focused.current = true;
      atFocus.current = event.target.value;
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      onDraft?.(event.target.value);
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      focused.current = false;
      const action = form26LeaveAction({ atFocus: atFocus.current, draft: event.target.value, value });
      if (action === 'commit') onCommit(event.target.value);
      else if (action === 'show-stored') setDraft(value);
    },
  };
  const box = cn(FORM26_CONTROL, inline ? 'inline-flex w-56 max-w-full align-baseline' : 'w-full', tint && FORM26_UNFILLED_TINT, locked && FORM26_LOCKED);

  let control: React.ReactNode;
  switch (field.kind) {
    case 'yesno':
    case 'choice': {
      const options = field.kind === 'yesno' ? ['Yes', 'No'] : field.options ?? [];
      control = (
        <div className={field.kind === 'yesno' ? 'w-28' : inline ? 'inline-block w-64 max-w-full align-baseline' : 'w-full'}>
          <NativeSelect
            {...shared}
            ref={(node) => setRef(inputRef, node)}
            value={value}
            disabled={locked}
            onChange={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (field.kind !== 'yesno' || event.altKey || event.ctrlKey || event.metaKey) return;
              const chosen = yesNoForKey(event.key);
              if (chosen) {
                event.preventDefault();
                commit(chosen);
              }
            }}
            className={cn(FORM26_CONTROL, 'pr-8', tint && FORM26_UNFILLED_TINT, locked && FORM26_LOCKED)}
          >
            <option value=""></option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </div>
      );
      break;
    }
    case 'radio':
      control = (
        <RadioGroup
          {...shared}
          ref={(node) => setRef(inputRef, node)}
          value={value}
          disabled={locked}
          onValueChange={(next) => commit(next)}
          className={cn('gap-2 rounded-md p-1', tint && cn('border', FORM26_UNFILLED_TINT))}
        >
          {(field.radioOptions ?? []).map((option, index) => (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupItem value={option.value} id={`${id}-o${index}`} className="mt-0.5 shrink-0" />
              <label htmlFor={`${id}-o${index}`} className="text-sm leading-5 text-foreground">
                {option.label}
              </label>
            </div>
          ))}
        </RadioGroup>
      );
      break;
    case 'longtext':
      control = (
        <AutoGrowTextarea
          {...shared}
          {...typing}
          ref={(node) => setRef(inputRef, node)}
          rows={field.rows ?? 2}
          readOnly={locked}
          style={{ minHeight: `${(field.rows ?? 2) * 20 + 14}px` }}
          className={cn('min-h-0 px-2 py-1.5 text-sm leading-5', tint && FORM26_UNFILLED_TINT, locked && FORM26_LOCKED)}
        />
      );
      break;
    default: {
      const type = field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : field.kind === 'email' ? 'email' : 'text';
      control = (
        <Input
          {...shared}
          {...typing}
          ref={(node) => setRef(inputRef, node)}
          type={type}
          step={type === 'number' ? 'any' : undefined}
          inputMode={type === 'number' ? 'decimal' : undefined}
          onWheel={type === 'number' ? leaveOnWheel : undefined}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          readOnly={locked}
          autoComplete="off"
          spellCheck={type === 'text' ? undefined : false}
          className={cn(box, type === 'number' && NUMBER, field.key === 'C.pan' && 'uppercase')}
        />
      );
    }
  }

  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper className={inline ? 'mx-1 inline-flex max-w-full flex-col align-baseline' : 'flex min-w-0 flex-col'} data-field={field.key}>
      {control}
      {showHint && (
        <span id={hintId} className="sr-only">
          Not filled yet.
        </span>
      )}
      {hasLine && (
        <span id={line ? lineId : undefined} role={line ? 'status' : undefined} className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 pt-1 text-xs leading-4">
          {line ? (
            <>
              <span className={locked ? 'text-danger-ink' : 'text-warning-ink'}>{line.text}</span>
              {line.actions.map((keep) => (
                <Button key={keep} type="button" variant="link" className="h-4 p-0 text-xs" onClick={() => onResolve?.(keep)}>
                  {FORM26_CONFLICT_ACTION_LABEL[keep]}
                </Button>
              ))}
            </>
          ) : provenance ? (
            <>
              <span className={cn(badgeVariants({ variant: provenance === 'client-master' ? 'neutral' : 'info' }), 'px-1.5 py-0 text-[11px] font-medium')}>
                {FORM26_PROVENANCE_LABEL[provenance]}
              </span>
              {provenance === 'brought-from-3cd' && !locked && (
                <Button type="button" variant="link" className="h-4 gap-1 p-0 text-xs" onClick={() => onConfirm?.()}>
                  <Check aria-hidden="true" className="!size-3" />
                  Confirm
                </Button>
              )}
            </>
          ) : null}
        </span>
      )}
    </Wrapper>
  );
}

/** "Add row" under a table; at the most rows a table can hold it stays focusable and says why it takes no more. */
export function Form26AddRow({ full, limitId, onAdd }: { full: boolean; limitId: string; onAdd(): void }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('h-7 gap-1 px-2 text-xs', full && 'cursor-default opacity-60 hover:bg-background hover:text-foreground')}
        aria-disabled={full || undefined}
        aria-describedby={full ? limitId : undefined}
        onClick={full ? undefined : onAdd}
      >
        <Plus aria-hidden="true" className="!size-3.5" />
        Add row
      </Button>
      {full && (
        <span id={limitId} className="text-xs text-subtle">
          {rowLimitText()}
        </span>
      )}
    </div>
  );
}

export type Form26CellInputProps = {
  id: string;
  type: Form26ColumnType;
  options?: string[];
  value: string;
  label: string;
  locked: boolean;
  unfilled: boolean;
  highlight: boolean;
  calculated?: boolean;
  describedBy?: string;
  onChange(value: string): void;
  onKeyDown?(event: React.KeyboardEvent<HTMLElement>): void;
  inputRef?: React.Ref<HTMLElement>;
};

/**
 * One cell of a table. A cell hands on every keystroke (the file works its calculations and totals out on
 * every input); the table's own save waits for a pause. Calculated cells are ordinary number boxes with a
 * soft background, as in the file.
 */
export function Form26CellInput(props: Form26CellInputProps): JSX.Element {
  const { id, type, options, value, label, locked, unfilled, highlight, calculated, describedBy, onChange, onKeyDown, inputRef } = props;
  const tint = unfilled && highlight && !locked;
  const shared = {
    id,
    'aria-label': label,
    'aria-describedby': unfilled && !locked ? describedBy : undefined,
    'data-unfilled': unfilled ? 'true' : undefined,
    onKeyDown,
  };
  const look = cn(FORM26_CONTROL, 'w-full min-w-0', calculated && 'bg-muted/60', tint && FORM26_UNFILLED_TINT, locked && FORM26_LOCKED);

  if (type === 'yn' || type === 'sel') {
    const list = type === 'yn' ? ['Yes', 'No'] : options ?? [];
    return (
      <NativeSelect
        {...shared}
        ref={(node) => setRef(inputRef, node)}
        value={value}
        disabled={locked}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (type === 'yn' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const chosen = yesNoForKey(event.key);
            if (chosen) {
              event.preventDefault();
              onChange(chosen);
              return;
            }
          }
          onKeyDown?.(event);
        }}
        className={cn(look, 'pr-8')}
      >
        <option value=""></option>
        {list.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </NativeSelect>
    );
  }
  if (type === 'ta') {
    return (
      <AutoGrowTextarea
        {...shared}
        ref={(node) => setRef(inputRef, node)}
        value={value}
        rows={1}
        readOnly={locked}
        onChange={(event) => onChange(event.target.value)}
        className={cn(look, 'h-auto min-h-8 py-1.5 leading-5')}
      />
    );
  }
  const numeric = type === 'num' || type === 'calc';
  return (
    <Input
      {...shared}
      ref={(node) => setRef(inputRef, node)}
      type={numeric ? 'number' : type === 'date' ? 'date' : 'text'}
      step={numeric ? 'any' : undefined}
      inputMode={numeric ? 'decimal' : undefined}
      onWheel={numeric ? leaveOnWheel : undefined}
      value={value}
      readOnly={locked}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      className={cn(look, numeric && NUMBER)}
    />
  );
}
