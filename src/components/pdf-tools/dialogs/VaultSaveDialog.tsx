import { Archive } from 'lucide-react';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import type { BatchOptions, BatchResult, SummaryToast, VaultForm } from '../destinations';
import { plural } from '../format';
import type { VaultFileRow } from '../vaultBytes';
import { DestinationFrame, VaultFormFields } from './DestinationFrame';
import { Notice } from './ToolDialog';
import { useBatchRun, useVaultForm } from './useDestinationDialog';

export interface VaultSaveDialogProps {
  /** The selected results, in list order. */
  files: WorkingFile[];
  /** Selected files that are not results, which this destination leaves out. */
  leftOut: number;
  vaultRows: readonly VaultFileRow[];
  engagementId: string | null;
  /** Starts the batch from the confirm click (the scope is captured there); null when it may not run. */
  run: (form: VaultForm, options: BatchOptions) => Promise<BatchResult> | null;
  /** Shows the outcome. Returns a message when the dialog stays open, else null (the screen closes it). */
  onFinished: (result: BatchResult) => SummaryToast | null;
  onClose: () => void;
  onReturnFocus: () => void;
}

/** Add to Evidence Vault: one form for the selected results, then each is uploaded in turn. */
export default function VaultSaveDialog({ files, leftOut, vaultRows, engagementId, run, onFinished, onClose, onReturnFocus }: VaultSaveDialogProps) {
  const state = useVaultForm(files);
  const batch = useBatchRun();
  const many = files.length > 1;

  return (
    <DestinationFrame
      testId="pdf-tools-vault-save"
      icon={Archive}
      title="Add to Evidence Vault"
      description={
        <>
          {many ? `${plural(files.length, 'result')} go` : 'The result goes'} into this engagement's Evidence Vault as a draft uploaded by you, like any other upload.
        </>
      }
      size={many ? 'lg' : 'md'}
      batch={batch}
      progressVerb="Adding"
      confirmLabel={many ? `Add ${files.length} files` : 'Add to Evidence Vault'}
      confirmTestId="pdf-tools-vault-save-confirm"
      onConfirm={() => batch.start((options) => run(state.form, options), onFinished)}
      onClose={onClose}
      onReturnFocus={onReturnFocus}
    >
      {leftOut > 0 && (
        <Notice tone="neutral" title={`${plural(leftOut, 'selected file')} ${leftOut === 1 ? 'is' : 'are'} left out`}>
          Only results made by a tool are added from here. Files from your computer or the Evidence Vault are added in the Evidence Vault itself.
        </Notice>
      )}
      <VaultFormFields files={files} state={state} vaultRows={vaultRows} engagementId={engagementId} showAlreadyInVault />
    </DestinationFrame>
  );
}
