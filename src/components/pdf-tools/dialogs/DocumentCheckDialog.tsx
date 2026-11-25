// Document check (T-064, design 5.13; contract REV): tick one PDF, open the tool, and the dialog reads the
// file's facts at once ("Reading page N of M", with a Stop), then shows them as a short list, each with a
// one-line note only where the auditor needs one. The one option is the report's name; "Add report to list"
// adds `<name>_check.pdf` (review/documentCheckRun.ts), built from the facts already read.
//
// The facts live in this component's state only and go when it closes; nothing of them is logged, stored or
// put in a toast. Closing the dialog, or leaving the screen, stops the reading.
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, FileSignature, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckStopped, checkDocument, factRows, type DocumentFacts } from '@/lib/pdf-tools/documentCheck';
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import { plainMessage } from '../format';
import {
  BLOCKED_WHILE_READING,
  CHECK_AGAIN,
  CHECK_STOPPED,
  DESCRIPTION,
  MADE_FROM_SIGNED_NOTE,
  readingLabel,
  REPORT_NAME_LABEL,
  RUN_LABEL,
  SIGNED_WARNING,
} from '../review/documentCheckForm';
import { appReader } from '../review/documentCheckRun';
import { throttleProgress } from '../toolOptions';
import { Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

type Reading =
  | { state: 'reading'; done: number; total: number }
  | { state: 'done'; facts: DocumentFacts }
  | { state: 'stopped' }
  | { state: 'failed'; message: string };

const FAILED = 'This file could not be checked. Open the file in a PDF reader, save a fresh copy and add that.';

export default function DocumentCheckDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const run = useToolRun('document-check', props);
  const stem = useResultName(`${stripExtension(file.name)}_check`, 'stem');
  const [reading, setReading] = useState<Reading>({ state: 'reading', done: 0, total: file.pageCount ?? 0 });
  const [attempt, setAttempt] = useState(0);
  const current = useRef<AbortController | null>(null);

  // Read the facts on open (and again on "Check again"). A reading that is no longer the current one (the
  // dialog closed, or a development re-run of the effect) says nothing.
  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    const mine = () => current.current === controller;
    setReading({ state: 'reading', done: 0, total: file.pageCount ?? 0 });
    const report = throttleProgress((done, total) => {
      if (mine() && !controller.signal.aborted) setReading({ state: 'reading', done, total });
    });
    checkDocument(
      file.bytes,
      file,
      { pageChars: (i) => appReader.pageChars(file.bytes, i, { signal: controller.signal, priority: 'dialog' }) },
      { signal: controller.signal, onPage: (done, total) => report(done, total) },
    ).then(
      (facts) => {
        if (mine() && !controller.signal.aborted) setReading({ state: 'done', facts });
      },
      (error: unknown) => {
        if (!mine()) return;
        if (controller.signal.aborted || error instanceof CheckStopped) setReading({ state: 'stopped' });
        else setReading({ state: 'failed', message: plainMessage(error, FAILED) });
      },
    );
    return () => {
      controller.abort();
      if (current.current === controller) current.current = null;
    };
  }, [file, attempt]);

  const facts = reading.state === 'done' ? reading.facts : undefined;
  const blockedReason = reading.state === 'reading' ? BLOCKED_WHILE_READING : reading.state === 'failed' ? reading.message : null;

  return (
    <ToolDialog
      tool="document-check"
      files={files}
      run={run}
      size="lg"
      showFile
      description={DESCRIPTION}
      runLabel={RUN_LABEL}
      blocked={blockedReason !== null}
      blockedReason={blockedReason}
      signedWarning={SIGNED_WARNING}
      onRun={() => run.start({ name: stem.resolved, ...(facts ? { facts } : {}) })}
      onClose={onClose}
    >
      {file.signatureInvalid && (
        <Notice tone="warning" icon={FileSignature} testId="pdf-tools-check-made-from-signed">
          {MADE_FROM_SIGNED_NOTE}
        </Notice>
      )}

      {reading.state === 'reading' && <ReadingProgress done={reading.done} total={reading.total} onStop={() => current.current?.abort()} />}

      {reading.state === 'stopped' && (
        <Notice tone="neutral" role="status" testId="pdf-tools-check-stopped" title={CHECK_STOPPED}>
          <p>Check again, or add the report: it reads the whole file first.</p>
          <CheckAgain onClick={() => setAttempt((n) => n + 1)} />
        </Notice>
      )}

      {reading.state === 'failed' && (
        <Notice tone="error" icon={AlertCircle} role="alert" testId="pdf-tools-check-failed" title={reading.message}>
          <CheckAgain onClick={() => setAttempt((n) => n + 1)} />
        </Notice>
      )}

      {facts && <FactList facts={facts} />}

      <ResultNameField name={stem} label={REPORT_NAME_LABEL} id="pdf-tools-result-stem" hint={`Will be saved as ${stem.resolved}.pdf`} />
    </ToolDialog>
  );
}

function ReadingProgress({ done, total, onStop }: { done: number; total: number; onStop: () => void }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-4 rounded-md border bg-muted/30 px-3 py-2.5" data-testid="pdf-tools-check-reading">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs font-medium text-foreground">{readingLabel(Math.min(done + 1, Math.max(total, 1)), Math.max(total, 1))}</p>
        <Progress value={percent} className="h-2" aria-label="Document check progress" />
      </div>
      <Button type="button" variant="outline" size="sm" data-testid="pdf-tools-check-stop" onClick={onStop}>
        <Square aria-hidden="true" />
        Stop
      </Button>
    </div>
  );
}

function CheckAgain({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="mt-2" data-testid="pdf-tools-check-again" onClick={onClick}>
      <RotateCcw aria-hidden="true" />
      {CHECK_AGAIN}
    </Button>
  );
}

function FactList({ facts }: { facts: DocumentFacts }) {
  return (
    <dl className="divide-y rounded-md border text-sm" data-testid="pdf-tools-check-facts">
      {factRows(facts).map((row) => (
        <div key={row.label} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[10rem_1fr]" data-testid="pdf-tools-check-row" data-label={row.label}>
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words text-foreground">
            {row.value}
            {row.note && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{row.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
