// The Make searchable dialog (T-064, design 5.12; OCR part B): one PDF, no options. It says what will be made,
// looks at the pages at once ("Looking for pages without text: page N of M…") and then says how many will be
// recognised and about how long that takes, shows the result name and the one main button. A file with no page
// with little text and something drawn on it cannot be run, and the dialog says why. "Recognise every page" is not offered.
//
// The look stops when the dialog closes. If it cannot be made, the dialog says nothing about the pages and the
// run looks itself. The pages' kinds go to the run, so that it does not look a second time.
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import type { OcrPlan } from '@/lib/pdf-tools/ocrPlan';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { blockedReason, CHECKING_LABEL, DESCRIPTION, planLine, RUN_LABEL, searchableFileName, searchableName, SIGNED_WARNING } from '../ocr/ocrForm';
import { appPages } from '../ocr/ocrRender';
import { lookAtPages } from '../ocr/ocrRun';
import { throttleProgress } from '../toolOptions';
import { Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

type Look = { state: 'looking'; done: number; total: number } | { state: 'done'; plan: OcrPlan } | { state: 'unknown' };

/** Which pages will be recognised (little text, something drawn), read once when the dialog opens; stopped when it closes. */
function usePagePlan(file: Pick<WorkingFile, 'bytes' | 'pageCount'>): Look {
  const total = file.pageCount ?? 0;
  const [look, setLook] = useState<Look>({ state: 'looking', done: 0, total });
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted;
    setLook({ state: 'looking', done: 0, total });
    const report = throttleProgress((done, of) => {
      if (current()) setLook({ state: 'looking', done, total: of });
    });
    lookAtPages(file.bytes, appPages, { signal: controller.signal, onPage: (done, of) => report(done, of) }).then(
      (plan) => {
        if (current()) setLook({ state: 'done', plan });
      },
      () => {
        if (current()) setLook({ state: 'unknown' });
      },
    );
    return () => controller.abort();
  }, [file.bytes, total]);
  return look;
}

export default function OcrDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const run = useToolRun('ocr', props);
  const name = useResultName(stripExtension(searchableName(file.name)), 'stem');
  const look = usePagePlan(file);
  const plan = look.state === 'done' ? look.plan : null;
  const reason = blockedReason(plan);

  return (
    <ToolDialog
      tool="ocr"
      files={files}
      run={run}
      showFile
      description={DESCRIPTION}
      signedWarning={SIGNED_WARNING}
      runLabel={RUN_LABEL}
      blocked={reason !== null}
      blockedReason={reason}
      onRun={() => run.start({ name: name.resolved, ...(plan ? { kinds: plan.pages.map((page) => page.kind) } : {}) })}
      onClose={onClose}
    >
      {look.state === 'looking' && (
        <Notice tone="neutral" role="status" testId="pdf-tools-ocr-looking">
          {CHECKING_LABEL(Math.min(look.done + 1, Math.max(look.total, 1)), Math.max(look.total, 1))}
        </Notice>
      )}
      {plan && reason === null && (
        <Notice tone="info" role="status" testId="pdf-tools-ocr-plan">
          {planLine(plan)}
        </Notice>
      )}
      {reason && (
        <Notice tone="warning" icon={AlertTriangle} role="status" testId="pdf-tools-ocr-blocked">
          {reason}
        </Notice>
      )}
      <ResultNameField name={name} hint={`Will be saved as ${searchableFileName(name.resolved)}`} />
    </ToolDialog>
  );
}
