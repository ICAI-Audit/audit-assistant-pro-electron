// Runs one destination batch for a dialog and tells it what to show. No React here: the dialog's
// hook (useDestinationDialog.useBatchRun) wraps it, so start, Stop and the dialog going away are
// unit-tested.
import type { BatchOptions, BatchResult, SummaryToast } from '../destinations';

export interface BatchProgress {
  done: number;
  total: number;
  name: string;
}

export interface BatchView {
  phase: 'idle' | 'running' | 'stopping';
  progress: BatchProgress | null;
  /** Shown in the dialog when it stays open after a batch. */
  message: SummaryToast | null;
}

export const UNEXPECTED: SummaryToast = {
  tone: 'error',
  title: 'Sending stopped because of an unexpected problem.',
  description: 'Check the Evidence Vault and the badges in the list before trying again.',
};

export class BatchRunner {
  private control: AbortController | null = null;
  private disposed = false;
  private view: BatchView = { phase: 'idle', progress: null, message: null };

  constructor(private readonly publish: (view: BatchView) => void) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Starts a batch from the confirm click. `launch` captures the scope before anything is awaited
   * and returns null when it may not run. `finish` gets the result and returns a message to show
   * when the dialog stays open, or null. Returns whether a batch started.
   */
  start(launch: (options: BatchOptions) => Promise<BatchResult> | null, finish: (result: BatchResult) => SummaryToast | null): boolean {
    if (this.control || this.disposed) return false;
    const control = new AbortController();
    const running = launch({
      signal: control.signal,
      onProgress: (done, total, name) => {
        if (this.control === control && !this.disposed) this.set({ progress: { done, total, name } });
      },
    });
    if (!running) return false;
    this.control = control;
    this.set({ phase: 'running', progress: null, message: null });
    // The batch functions report every failure in their result; a throw is a defect, and the dialog
    // (if it is still there) says only that something went wrong.
    running.then(
      (result) => this.settle(control, finish(result)),
      () => this.settle(control, UNEXPECTED),
    );
    return true;
  }

  /** Stop: the file being sent is finished, the rest are not started. */
  stop(): void {
    if (!this.control || this.view.phase !== 'running') return;
    this.control.abort();
    this.set({ phase: 'stopping' });
  }

  /**
   * The dialog went away (the screen was left, or the engagement changed): no further file is sent
   * and nothing more is shown here. The batch still reports its result to `finish`, which decides
   * what may be said.
   */
  dispose(): void {
    this.disposed = true;
    this.control?.abort();
  }

  private settle(control: AbortController, message: SummaryToast | null): void {
    if (this.control === control) this.control = null;
    if (this.disposed) return;
    this.set({ phase: 'idle', progress: null, message });
  }

  private set(change: Partial<BatchView>): void {
    if (this.disposed) return;
    this.view = { ...this.view, ...change };
    this.publish(this.view);
  }
}
