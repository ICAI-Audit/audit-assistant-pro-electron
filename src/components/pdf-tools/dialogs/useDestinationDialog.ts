import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { vaultName, type BatchOptions, type BatchResult, type EvidenceType, type SummaryToast, type VaultForm } from '../destinations';
import { BatchRunner, type BatchView } from './batchRunner';

export type { BatchProgress } from './batchRunner';

/**
 * Starts a batch from the confirm click and follows it (see BatchRunner). When the dialog goes away
 * mid-batch (the screen is left, or the engagement changes), the batch is aborted: the file being
 * sent is finished and no further file is sent.
 */
export function useBatchRun() {
  const [view, setView] = useState<BatchView>({ phase: 'idle', progress: null, message: null });
  const runner = useRef<BatchRunner | null>(null);
  if (!runner.current) runner.current = new BatchRunner(setView);
  useEffect(() => {
    // A runner disposed by an earlier cleanup (a development remount) is replaced.
    if (!runner.current || runner.current.isDisposed) runner.current = new BatchRunner(setView);
    const active = runner.current;
    return () => active.dispose();
  }, []);

  const start = useCallback(
    (launch: (options: BatchOptions) => Promise<BatchResult> | null, finish: (result: BatchResult) => SummaryToast | null) => {
      runner.current?.start(launch, finish);
    },
    [],
  );
  const stop = useCallback(() => runner.current?.stop(), []);

  return { phase: view.phase, busy: view.phase !== 'idle', progress: view.progress, message: view.message, start, stop };
}

export type BatchRun = ReturnType<typeof useBatchRun>;

/** Form state for the vault fields: names typed per file, the evidence type and the reference. */
export function useVaultForm(files: readonly WorkingFile[], initialRef = '') {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(files.map((f) => [f.id, vaultName(f)])));
  const [fileType, setFileType] = useState<EvidenceType>('document');
  const [workpaperRef, setWorkpaperRef] = useState(initialRef);
  const refTouched = useRef(false);
  const form: VaultForm = useMemo(() => ({ names, fileType, workpaperRef }), [names, fileType, workpaperRef]);
  const suggestRef = useCallback((value: string) => {
    if (!refTouched.current) setWorkpaperRef(value);
  }, []);
  return {
    form,
    setName: (id: string, value: string) => setNames((current) => ({ ...current, [id]: value })),
    /** Cleans a name when its field is left, as the vault will store it. */
    commitName: (file: WorkingFile) => setNames((current) => ({ ...current, [file.id]: vaultName(file, current[file.id]) })),
    setFileType,
    setWorkpaperRef: (value: string) => {
      refTouched.current = true;
      setWorkpaperRef(value);
    },
    /** A suggested reference (the programme's) replaces the field only while the user has not typed in it. */
    suggestRef,
  };
}

export type VaultFormState = ReturnType<typeof useVaultForm>;
