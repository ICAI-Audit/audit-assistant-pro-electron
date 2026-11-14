import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { WorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type ToolId, type WorkingFile } from '@/lib/pdf-tools/types';
import { runTool, type RunResult, type ToolRunOptions } from '../runTool';
import { resolveResultName, resolveStem, throttleProgress } from '../toolOptions';
import { toolInfo } from '../toolRules';

/** The list's context and session as the screen may see them (its guarded state). */
export interface RunScope {
  contextKey: string | null;
  session: number;
}

/** What every tool dialog gets from the screen. */
export interface ToolDialogProps {
  /** The selected files, in list order, when the tool was chosen. */
  files: WorkingFile[];
  /** Read when Run is pressed, before anything is awaited. */
  scope: () => RunScope;
  store: WorkingListStore;
  /** Bytes the list holds now (PDF to images checks its size limit with it). */
  listBytes: number;
  /** Called with what was added; the screen closes the dialog, selects and shows the results. */
  onFinished: (result: RunResult, session: number) => void;
  onClose: () => void;
}

export interface RunProgress {
  done: number;
  /** 0 when the step cannot be measured. */
  total: number;
  label?: string;
}

export interface ToolRun<T extends ToolId> {
  phase: 'idle' | 'running' | 'stopping';
  progress: RunProgress | null;
  /** Why the last run failed, in plain words. */
  error: string | null;
  /** A run that worked but made nothing (already compact), or a stopped run. */
  notice: { title: string; detail?: string } | null;
  clearMessages(): void;
  start(options: ToolRunOptions[T]): void;
  /** Cancels the run; with `thenClose` the dialog closes once it has stopped. */
  stop(thenClose: boolean): void;
}

/**
 * Runs a tool for its dialog. The context key and session are taken from the screen's guarded
 * state the moment Run is pressed. Closing the dialog or leaving the screen cancels the run; if
 * the engagement has not changed, leaving says that nothing was added (without naming a file).
 */
export function useToolRun<T extends ToolId>(tool: T, props: ToolDialogProps): ToolRun<T> {
  const [phase, setPhase] = useState<ToolRun<T>['phase']>('idle');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ToolRun<T>['notice']>(null);
  const active = useRef<{ controller: AbortController; session: number } | null>(null);
  const closeWhenStopped = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const run = active.current;
      active.current = null;
      if (!run || run.controller.signal.aborted) return;
      run.controller.abort();
      // Unmounted with the same session: the user left the screen; a change of engagement is silent.
      // Checked a moment later: in development, Fast Refresh and StrictMode run this cleanup and set
      // the effect up again at once, without the dialog going away, and then nothing is said.
      setTimeout(() => {
        if (mounted.current) return;
        if (latest.current.store.getState().session === run.session) {
          toast.warning(`${toolInfo(tool).label} stopped when you left PDF Tools. Nothing was added.`);
        }
      }, 0);
    };
  }, [tool]);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const start = useCallback(
    (options: ToolRunOptions[T]) => {
      if (active.current) return;
      const { contextKey, session } = latest.current.scope();
      if (!contextKey) return;
      const controller = new AbortController();
      const run = { controller, session };
      active.current = run;
      closeWhenStopped.current = false;
      setPhase('running');
      setError(null);
      setNotice(null);
      setProgress({ done: 0, total: 0, label: 'Starting…' });
      const report = throttleProgress((done, total, label) => {
        if (mounted.current && active.current === run) setProgress({ done, total, label });
      });
      const { files, store } = latest.current;

      // False when nothing more should be shown for this run. A run that is no longer the active one
      // was abandoned by the effect cleanup (unmount, or an effect re-run in development): it is
      // dropped quietly, never reported as "Stopped". If a newer run has started meanwhile, it is left alone.
      const settle = () => {
        if (active.current !== run) {
          if (mounted.current && active.current === null) {
            setPhase('idle');
            setProgress(null);
          }
          return false;
        }
        active.current = null;
        return mounted.current;
      };
      runTool(tool, files, options, { contextKey, session, store, signal: controller.signal, onProgress: report }).then(
        (result) => {
          if (!settle()) return;
          if (result.status === 'added') {
            latest.current.onFinished(result, session);
            return;
          }
          if (result.status === 'stale' || (result.status === 'cancelled' && closeWhenStopped.current)) {
            latest.current.onClose();
            return;
          }
          setPhase('idle');
          setProgress(null);
          setNotice(
            result.status === 'nothing'
              ? { title: result.message ?? 'Nothing was made.', detail: result.detail }
              : { title: 'Stopped. Nothing was added.' },
          );
        },
        (failure: unknown) => {
          if (!settle()) return;
          if (closeWhenStopped.current) {
            latest.current.onClose();
            return;
          }
          setPhase('idle');
          setProgress(null);
          setError(failure instanceof PdfToolsError ? failure.message : 'The tool could not finish. Try again.');
        },
      );
    },
    [tool],
  );

  const stop = useCallback((thenClose: boolean) => {
    const run = active.current;
    if (!run) {
      if (thenClose) latest.current.onClose();
      return;
    }
    closeWhenStopped.current = thenClose;
    setPhase('stopping');
    setProgress((p) => (p ? { ...p, label: 'Stopping…' } : p));
    run.controller.abort();
  }, []);

  return { phase, progress, error, notice, clearMessages, start, stop };
}

/** A tool's name inside a sentence: a capitalised first word is lowered, an acronym is kept ("Stop PDF to images?"). */
export function toolNameInSentence(tool: ToolId): string {
  return toolInfo(tool).label.replace(/^[A-Z](?=[a-z])/, (first) => first.toLowerCase());
}

/**
 * An editable result name that follows its default (for example a page range) until the user
 * types, and is cleaned when the field is left. `kind: 'stem'` is for the names parts and page
 * images are made from.
 */
export function useResultName(fallback: string, kind: 'pdf' | 'stem' = 'pdf') {
  const [value, setValue] = useState(fallback);
  const edited = useRef(false);
  const resolve = useCallback((text: string) => (kind === 'stem' ? resolveStem(text, fallback) : resolveResultName(text, fallback, 'pdf')), [fallback, kind]);

  useEffect(() => {
    if (!edited.current) setValue(fallback);
  }, [fallback]);

  const change = useCallback((text: string) => {
    edited.current = true;
    setValue(text);
  }, []);

  /** On leaving the field: clean it, and follow the default again if that is what it now holds. */
  const commit = useCallback(() => {
    setValue((text) => {
      const cleaned = resolve(text);
      edited.current = cleaned !== fallback;
      return cleaned;
    });
  }, [resolve, fallback]);

  return { value, change, commit, resolved: resolve(value), fallback };
}
