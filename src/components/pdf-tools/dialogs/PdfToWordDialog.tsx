// The PDF to Word dialog (design 5.11; contract decisions 13–17): one PDF, no options. It says in two
// sentences what will be made, shows the result name and the main button. On opening it looks for text,
// page by page until it finds some: a file with no text on any page cannot be run ("it looks scanned").
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { blockedReason, DESCRIPTION, findText, nonSpaceChars, RUN_LABEL, SIGNED_WARNING, WORD_MAX_PAGES, wordFileName, type TextCheck } from '../convert/wordForm';
import { pageTextContent } from '../pdfRenderer';
import { Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

/** Whether the file has text on some page, read once when the dialog opens; stopped when it closes. */
function useTextCheck(file: Pick<WorkingFile, 'bytes' | 'pageCount'>): TextCheck {
  const [found, setFound] = useState<TextCheck>('checking');
  useEffect(() => {
    const pages = file.pageCount ?? 0;
    // Over the page limit the dialog says so already; nothing is read.
    if (pages > WORD_MAX_PAGES) return;
    const controller = new AbortController();
    setFound('checking');
    const chars = async (pageIndex: number) => nonSpaceChars((await pageTextContent(file.bytes, pageIndex, { signal: controller.signal, priority: 'dialog' })).items);
    void findText(pages, chars, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setFound(result);
    });
    return () => controller.abort();
  }, [file.bytes, file.pageCount]);
  return found;
}

export default function PdfToWordDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const run = useToolRun('pdf-to-word', props);
  const name = useResultName(stripExtension(file.name), 'stem');
  const text = useTextCheck(file);
  const reason = blockedReason(file, text);

  return (
    <ToolDialog
      tool="pdf-to-word"
      files={files}
      run={run}
      showFile
      description={DESCRIPTION}
      signedWarning={SIGNED_WARNING}
      runLabel={RUN_LABEL}
      blocked={reason !== null}
      blockedReason={reason}
      onRun={() => run.start({ name: name.resolved })}
      onClose={onClose}
    >
      {reason && (
        <Notice tone="warning" icon={AlertTriangle} role="status" testId="pdf-tools-word-blocked">
          {reason}
        </Notice>
      )}
      <ResultNameField name={name} hint={`Will be saved as ${wordFileName(name.resolved)}`} />
    </ToolDialog>
  );
}
