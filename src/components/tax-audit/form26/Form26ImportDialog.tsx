// "Load a save file" (BUILD-PLAN task 23), in the pattern of the PDF Tools dialogs: what the file holds and
// what will happen is shown BEFORE anything is written — the file's name, its counts, a plain warning when it is
// for another PAN or name, and what will not be taken (one sentence each, with its list) — then "Replace the
// answers" or "Cancel". While it writes, progress ("38 of 120") and no way to close; a failure says how far it
// got in one sentence and the button can be used again (running it again completes the load).
import * as React from 'react';
import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { Form26ImportSummary } from '@/lib/taxAuditForm26Import';
import { cn } from '@/lib/utils';

export type Form26ImportDialogState =
  /** `notice`: why the last "Replace the answers" did not go ahead (the copy of the present answers was not saved). */
  | { phase: 'review'; notice?: string }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'failed'; message: string };

export type Form26ImportDialogProps = {
  open: boolean;
  fileName: string;
  summary: Form26ImportSummary;
  /** Rows the file changes (0: the audit already holds this file). */
  changes: number;
  state: Form26ImportDialogState;
  onConfirm(): void;
  onCancel(): void;
};

const count = (n: number) => n.toLocaleString('en-IN');

/** The dialog's content (also drawn by the static-render test: a dialog's portal is not drawn there). */
export function Form26ImportDialogBody({ fileName, summary, changes, state }: Pick<Form26ImportDialogProps, 'fileName' | 'summary' | 'changes' | 'state'>): JSX.Element {
  const running = state.phase === 'running';
  return (
    <div className="space-y-3 text-sm" data-f26-import="">
      <p>
        <span className="font-medium break-words">{fileName}</span>
      </p>
      <p data-f26-import-counts="">{summary.counts}</p>
      {summary.identity.length > 0 && (
        <div role="alert" className="flex gap-2.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5" data-f26-import-identity="">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 space-y-0.5">
            {summary.identity.map((line) => (
              <p key={line} className="break-words">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
      {summary.notes.length > 0 && (
        <ul className="space-y-1" aria-label="What will not be taken" data-f26-import-notes="">
          {summary.notes.map((note) => (
            <li key={note.kind}>
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-start gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-f26-import-note={note.kind}>
                  <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="min-w-0 break-words">{note.text}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="relative ml-6 mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs text-subtle">
                    {note.items.map((item, index) => (
                      <li key={`${index}-${item}`} className="break-words">
                        {item}
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
      )}
      <p className="text-subtle">
        {changes === 0
          ? 'The answers in this audit already match this file.'
          : 'The answers in this audit are replaced by those in the file. First you choose where to save a copy of the present answers; nothing is replaced unless that copy is saved.'}
      </p>
      {state.phase === 'review' && state.notice && (
        <p role="status" className="font-medium" data-f26-import-notice="">
          {state.notice}
        </p>
      )}
      {running && (
        <div className="space-y-1" data-f26-import-progress="">
          <Progress value={state.total === 0 ? 100 : (100 * state.done) / state.total} className="h-2" aria-label="Loading the save file" />
          <p role="status" className="text-xs tabular-nums text-subtle">
            {`${count(state.done)} of ${count(state.total)}`}
          </p>
        </div>
      )}
      {state.phase === 'failed' && (
        <p role="alert" className="text-destructive" data-f26-import-failed="">
          {state.message}
        </p>
      )}
    </div>
  );
}

export function Form26ImportDialog(props: Form26ImportDialogProps): JSX.Element {
  const { open, state, onConfirm, onCancel } = props;
  const running = state.phase === 'running';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never closed while it writes.
        if (!next && !running) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg" onEscapeKeyDown={(event) => running && event.preventDefault()} onInteractOutside={(event) => running && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Load a save file</DialogTitle>
          <DialogDescription>Nothing is changed until you choose "Replace the answers".</DialogDescription>
        </DialogHeader>
        <Form26ImportDialogBody fileName={props.fileName} summary={props.summary} changes={props.changes} state={state} />
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} aria-disabled={running || undefined} className={cn(running && 'opacity-50')} data-f26-import-cancel="">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!running) onConfirm();
            }}
            aria-disabled={running || undefined}
            className="gap-1.5"
            data-f26-import-confirm=""
          >
            {running && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {running ? 'Loading…' : 'Replace the answers'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
