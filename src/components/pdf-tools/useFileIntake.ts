import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LIST_MAX_BYTES, LIST_WARN_BYTES, newFileId, workingListStore } from '@/lib/pdf-tools/workingList';
import { nextPaint } from './canvasUtils';
import { formatBytes, plural } from './format';
import { prepareFile, type IntakeNotice } from './intake';
import { IntakeRunner, type FileLike, type IntakeProgress, type PasswordAnswer } from './intakeRunner';
import { decodeToPng, imageSize } from './pdfRenderer';

export type { IntakeProgress, IntakeStage, PasswordAnswer } from './intakeRunner';

/** What the password dialog needs. The password itself never leaves the dialog. */
export interface PasswordRequest {
  id: string;
  name: string;
  bytes: Uint8Array;
}

function notAdded(name: string, description: string): void {
  toast.error(`"${name}" was not added`, { description });
}

const NOTICES: Record<IntakeNotice, { title: (name: string) => string; description: string }> = {
  'opened-without-password': {
    title: (name) => `"${name}" opened without a password`,
    description: 'Its protection was removed in the copy in this list, and results made from it are not protected.',
  },
  'first-frame': {
    title: (name) => `"${name}" is animated`,
    description: 'Only its first frame was added.',
  },
};

/**
 * Adds files from the computer through IntakeRunner (one at a time, password prompts, list
 * limits). Exposes progress for the screen, a one-line summary for a polite live region, and the
 * password request for the dialog.
 */
export function useFileIntake(contextKey: string | null) {
  const [progress, setProgress] = useState<IntakeProgress | null>(null);
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);
  const [summary, setSummary] = useState('');
  const answerPassword = useRef<((answer: PasswordAnswer) => void) | null>(null);
  const currentKey = useRef(contextKey);

  const settlePassword = useCallback((answer: PasswordAnswer) => {
    const resolve = answerPassword.current;
    answerPassword.current = null;
    setPasswordRequest(null);
    resolve?.(answer);
  }, []);

  const runner = useRef<IntakeRunner | null>(null);
  if (!runner.current) {
    runner.current = new IntakeRunner({
      store: workingListStore,
      prepare: (source, hooks) => prepareFile(source, { decodeToPng, imageSize, ...hooks }),
      askPassword: (name, bytes) =>
        new Promise<PasswordAnswer>((resolve) => {
          answerPassword.current = resolve;
          setPasswordRequest({ id: newFileId(), name, bytes });
        }),
      cancelPassword: () => settlePassword(null),
      nextPaint: () => nextPaint(),
      onProgress: setProgress,
      report: {
        notAdded,
        notice: (name, notice) => toast.info(NOTICES[notice].title(name), { description: NOTICES[notice].description }),
        listLarge: () =>
          toast.warning('The file list is getting large', {
            description: `The files now come to more than ${formatBytes(LIST_WARN_BYTES)}. PDF Tools may slow down; the limit is ${formatBytes(LIST_MAX_BYTES)}.`,
          }),
        finished: ({ added, notAdded: refused }) =>
          setSummary(`Added ${plural(added, 'file')}${refused > 0 ? `, ${refused} not added` : ''}.`),
        stoppedOnLeave: (remaining) =>
          toast.warning(
            `Adding stopped when you left PDF Tools: ${remaining === 1 ? '1 file was' : `${remaining} files were`} not added.`,
          ),
      },
      maxBytes: LIST_MAX_BYTES,
      warnBytes: LIST_WARN_BYTES,
    });
  }

  // Another engagement or user: stop silently (nothing of the old one is named).
  useEffect(() => {
    if (currentKey.current === contextKey) return;
    currentKey.current = contextKey;
    runner.current?.abandon('context-changed');
  }, [contextKey]);

  // Leaving the screen: stop and say how many files were not added.
  useEffect(() => {
    const active = runner.current;
    return () => active?.abandon('left-screen');
  }, []);

  const addFiles = useCallback((files: FileLike[]) => {
    if (files.length === 0 || !currentKey.current) return;
    setSummary('');
    runner.current?.enqueue(files);
  }, []);

  return { progress, passwordRequest, addFiles, settlePassword, summary };
}
