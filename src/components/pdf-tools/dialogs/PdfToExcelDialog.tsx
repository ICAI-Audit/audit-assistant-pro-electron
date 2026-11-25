// The PDF to Excel dialog (design 5.11; contract decisions 10, 11, 14, 15; T-064): a preview of the table
// found on a page, one choice of sheets (all pages on one sheet by default), the result name, and the main
// button. Run waits only for a file with no text on any page (it looks scanned) or of more than 1,000 pages.
import { useCallback, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SheetMode } from '@/lib/pdf-tools/excelBuild';
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import ExcelPreview from '../convert/ExcelPreview';
import { blockedReason, DESCRIPTION, MAX_PAGES, NAME_HINT, RUN_LABEL, SCANNED_MESSAGE, SHEET_CHOICES, SIGNED_WARNING, TOO_MANY_PAGES_MESSAGE, type TextState } from '../convert/excelForm';
import { useExcelPreview } from '../convert/useExcelPreview';
import { ChoiceCards, Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

export default function PdfToExcelDialog(props: ToolDialogProps) {
  const { files, onClose, store, scope } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('pdf-to-excel', props);
  const [sheets, setSheets] = useState<SheetMode>('one-sheet');
  const stem = useResultName(stripExtension(file.name), 'stem');

  // The list the dialog was opened for: the preview shows nothing once it has moved on.
  const opened = useRef(scope());
  const isCurrent = useCallback(() => {
    const now = store.getState();
    return now.session === opened.current.session && now.contextKey === opened.current.contextKey;
  }, [store]);
  const tooMany = pageCount > MAX_PAGES;
  const preview = useExcelPreview(file.bytes, pageCount, isCurrent, !tooMany);

  const text: TextState = preview.state.status;
  const reason = blockedReason(file, text);

  return (
    <ToolDialog
      tool="pdf-to-excel"
      files={files}
      run={run}
      size="2xl"
      showFile
      description={DESCRIPTION}
      runLabel={RUN_LABEL}
      blocked={reason !== null}
      blockedReason={reason}
      signedWarning={SIGNED_WARNING}
      onRun={() => run.start({ sheets, name: stem.resolved })}
      onClose={onClose}
    >
      {(tooMany || text === 'scanned') && (
        <Notice tone="warning" icon={AlertTriangle} role="status" testId="pdf-tools-excel-blocked">
          {tooMany ? TOO_MANY_PAGES_MESSAGE : SCANNED_MESSAGE}
        </Notice>
      )}

      {!tooMany && <ExcelPreview state={preview.state} onShow={preview.show} />}

      <ChoiceCards<SheetMode>
        label="Sheets"
        value={sheets}
        onChange={(next) => {
          setSheets(next);
          run.clearMessages();
        }}
        columns={2}
        compact
        testIdPrefix="pdf-tools-excel-sheets"
        choices={SHEET_CHOICES}
      />

      <ResultNameField name={stem} hint={NAME_HINT(stem.resolved)} />
    </ToolDialog>
  );
}
