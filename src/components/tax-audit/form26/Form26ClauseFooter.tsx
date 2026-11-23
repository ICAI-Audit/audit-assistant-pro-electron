// What follows a Form No. 26 clause in the editor: the review remarks (the present rich-text editor, kept in
// `auditor_remarks_html`, for the working papers only) and the qualification box (the tick and its text, as
// on Form 3CD), with "Add to the report's observations", which puts the clause number and the box's text
// into the observations table of the report's Part (decision A8). Each box is saved when it is left.
import * as React from 'react';
import { ChevronDown, ChevronRight, ListPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import type { Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Category } from '@/data/taxAuditForm26Types';
import { form26PlainText, isRowLocked, qualificationRow } from '@/lib/taxAuditForm26Review';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { Form26Row } from '@/lib/taxAuditForm26Values';
import { form26ObservationAction } from '@/lib/taxAuditForm26Workspace';

type RowPatch = Pick<Partial<Form26ClauseRow>, 'auditor_remarks_html' | 'qualification_required' | 'qualification_text_html'>;

export type Form26ClauseFooterProps = {
  row: Form26ClauseRow;
  unit: Form26ClauseUnit;
  category: '' | Form26Category;
  /** The rows of the observations table of the report's Part (A5 or B5) as on screen. */
  observationRows: Form26Row[] | undefined;
  /** The Part that holds the observations table is approved. */
  partLocked: boolean;
  onUpdate(patch: RowPatch): Promise<boolean | void>;
  onAddObservation(table: 'A5' | 'B5', plainText: string): void;
};

const truthy = (value: unknown) => value === true || value === 1 || value === '1';
/** A rich-text box with no words in it is stored as empty. */
const asStored = (html: string) => (form26PlainText(html) === '' ? '' : html);

/** The rich-text editor with a name for its text box (the shared editor has no label of its own). */
function NamedRichText(props: { labelId: string; value: string; disabled: boolean; placeholder: string; minHeight: string; onChange(html: string): void; onLeave(): void }): JSX.Element {
  const holder = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    holder.current?.querySelector('[role="textbox"]')?.setAttribute('aria-labelledby', props.labelId);
  });
  return (
    <div
      ref={holder}
      onBlur={(event) => {
        if (!holder.current?.contains(event.relatedTarget as Node | null)) props.onLeave();
      }}
    >
      <RichTextEditor value={props.value} onChange={props.onChange} placeholder={props.placeholder} disabled={props.disabled} className={props.minHeight} />
    </div>
  );
}

/** A box's text: kept here while the user writes (also across a fresh row arriving), saved when the box is left. */
function useBoxDraft(stored: string, save: (html: string) => void) {
  const [draft, setDraft] = React.useState(stored);
  const current = React.useRef(stored);
  const editing = React.useRef(false);
  React.useEffect(() => {
    if (editing.current) return;
    current.current = stored;
    setDraft(stored);
  }, [stored]);
  return {
    draft,
    onChange(html: string) {
      editing.current = true;
      current.current = html;
      setDraft(html);
    },
    onLeave() {
      editing.current = false;
      const next = asStored(current.current);
      if (next !== asStored(stored)) save(next);
    },
  };
}

export function Form26ClauseFooter({ row, unit, category, observationRows, partLocked, onUpdate, onAddObservation }: Form26ClauseFooterProps): JSX.Element {
  const locked = isRowLocked(row);
  const id = `f26-footer-${unit.key}`;
  const storedRemarks = row.auditor_remarks_html ?? '';
  const storedQualification = row.qualification_text_html ?? '';
  const qualified = truthy(row.qualification_required);
  const [remarksOpen, setRemarksOpen] = React.useState(form26PlainText(storedRemarks) !== '');
  const remarks = useBoxDraft(storedRemarks, (html) => void onUpdate({ auditor_remarks_html: html }));
  const qualification = useBoxDraft(storedQualification, (html) => void onUpdate({ qualification_text_html: html }));
  const plain = form26PlainText(qualification.draft);
  const action = form26ObservationAction({ clauseNo: unit.no, category, plainText: plain, rows: observationRows, locked, partLocked });
  // Only clauses 9 to 53 go into the report's observations (the table's own heading): elsewhere it is not offered.
  const showObservation = qualificationRow(unit.no, '', '1') !== null;

  return (
    <div className="space-y-3 border-t border-border px-3 py-3">
      <Collapsible open={remarksOpen} onOpenChange={setRemarksOpen} className="rounded-md border bg-background">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {remarksOpen ? <ChevronDown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-subtle" /> : <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />}
            <span className="min-w-0">
              <span id={`${id}-remarks`} className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Review remarks
                {form26PlainText(remarks.draft) !== '' && <span className="rounded-sm border bg-muted/40 px-1.5 py-0.5 text-[10px] font-normal text-subtle">Has remarks</span>}
              </span>
              <span className="mt-1 block text-xs text-subtle">For the working papers only. Not part of Form No. 26.</span>
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t p-3">
          <NamedRichText
            labelId={`${id}-remarks`}
            value={remarks.draft}
            disabled={locked}
            placeholder="Add review notes, review points or clarifications still pending."
            minHeight="[&_[role=textbox]]:min-h-[120px]"
            onChange={remarks.onChange}
            onLeave={remarks.onLeave}
          />
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-qualified`}
            checked={qualified}
            disabled={locked}
            onCheckedChange={(checked) => void onUpdate({ qualification_required: checked === true ? 1 : 0 })}
          />
          <label htmlFor={`${id}-qualified`} id={`${id}-qualified-label`} className="text-sm">
            Qualification or observation required in the report
          </label>
        </div>
        {qualified && (
          <div className="space-y-2 pl-6">
            <NamedRichText
              labelId={`${id}-qualified-label`}
              value={qualification.draft}
              disabled={locked}
              placeholder="Write the qualification or observation."
              minHeight="[&_[role=textbox]]:min-h-[100px]"
              onChange={qualification.onChange}
              onLeave={qualification.onLeave}
            />
            {showObservation && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  aria-disabled={!action.enabled}
                  aria-describedby={action.reason ? `${id}-observation-why` : undefined}
                  onClick={() => {
                    if (action.enabled && action.table) onAddObservation(action.table, plain);
                  }}
                >
                  <ListPlus aria-hidden="true" />
                  Add to the report&apos;s observations
                </Button>
                {action.reason && (
                  <span id={`${id}-observation-why`} className="text-xs text-subtle">
                    {action.reason}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
