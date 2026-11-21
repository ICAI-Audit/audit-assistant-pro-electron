import { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { blockedReason, DESCRIPTION, EARLIER_LABEL, LATER_LABEL, signedWarning, SWAP_LABEL, versions } from '../review/compareForm';
import { FileChip, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

/** One of the two versions: its label, then the file. */
function Version({ label, file, testId }: { label: string; file: WorkingFile; testId: string }) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <p className="text-sm font-medium leading-none">{label}</p>
      <FileChip file={file} />
    </div>
  );
}

/**
 * Compare (design 5.13; contract T-064 decisions 3 and 4): the two ticked PDFs as "Earlier version" and
 * "Later version". The list order decides which is which; one Swap button changes it. Nothing else to set
 * but the report's name, which follows the later version until it is typed.
 */
export default function CompareDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const run = useToolRun('compare', props);
  const [earlierId, setEarlierId] = useState(files[0]?.id ?? '');
  const pair = versions(files, earlierId);
  const laterName = pair?.later.name ?? files[files.length - 1]?.name ?? 'document.pdf';
  const stem = useResultName(stripExtension(defaultResultName('compare', laterName)), 'stem');
  const reason = blockedReason(files);

  return (
    <ToolDialog
      tool="compare"
      files={files}
      run={run}
      description={DESCRIPTION}
      runLabel="Compare"
      blocked={reason !== null || pair === null}
      blockedReason={reason}
      signedWarning={signedWarning(files)}
      onRun={() => {
        if (pair) run.start({ earlierId: pair.earlier.id, name: stem.resolved });
      }}
      onClose={onClose}
    >
      {pair && (
        <div className="space-y-2">
          <Version label={EARLIER_LABEL} file={pair.earlier} testId="pdf-tools-compare-earlier" />
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="pdf-tools-compare-swap"
              aria-label="Swap the earlier and later versions"
              onClick={() => {
                setEarlierId(pair.later.id);
                run.clearMessages();
              }}
            >
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {SWAP_LABEL}
            </Button>
          </div>
          <Version label={LATER_LABEL} file={pair.later} testId="pdf-tools-compare-later" />
        </div>
      )}

      <ResultNameField name={stem} hint={<>Will be saved as {stem.resolved}.pdf</>} />
    </ToolDialog>
  );
}
