// A one-at-a-time job queue for page renders. No pdfjs or DOM here, so it can be unit-tested.
//
// - Jobs run strictly one after another: the page viewer's drawings ('view') first, then a tool
//   run's pages ('run'), then a tool dialog's own pages ('dialog': the Organise pages grid, which sits
//   over the page panel; QA-FIX C), then the page panel ('high'), then list thumbnails ('normal'). A job
//   still waiting can be raised to a higher priority (`onQueued`), for example when a dialog asks for a
//   page the panel behind it is already waiting for. The viewer
//   goes first because the user is looking at it (design section 4); it asks for at most the page
//   shown and the pages either side and cancels what it no longer needs, so a run waits at most for
//   the job in flight and a few viewer drawings, and is served before every tile and thumbnail.
// - Each job gets an AbortSignal. A job aborted before it starts is dropped; one aborted while
//   running has its cancel function called and the queue moves on at once, without waiting for
//   it. A result that still arrives afterwards is passed to `dispose` (for example to revoke a
//   blob URL).
// - Each job has a time limit. When it runs out the job is cancelled, rejected with
//   RenderTimeoutError, and the queue moves on.

export type Priority = 'view' | 'run' | 'dialog' | 'high' | 'normal';

/** Highest first. */
const ORDER: readonly Priority[] = ['view', 'run', 'dialog', 'high', 'normal'];

export interface JobContext {
  signal: AbortSignal;
  /** Registers how to stop the job's work. Called at once if the job has already been aborted. */
  setCancel(cancel: () => void): void;
  /**
   * A sign that the job's work is going on (wave 4, RX-RUN2): its time limit starts again. A job on a busy machine
   * that keeps working is never out of time; one that goes silent for the limit still is. Jobs that never call it
   * keep the limit counted from their start, as before.
   */
  alive(): void;
}

export interface ScheduleOptions<T> {
  signal?: AbortSignal;
  priority?: Priority;
  dispose?: (value: T) => void;
  onStart?: () => void;
  /** Called once the job is queued, with a way to raise its priority while it still waits (never lowered). */
  onQueued?: (raise: (priority: Priority) => void) => void;
  /**
   * Called instead of the queue's onTimeout when this job was cancelled while running and its work
   * had not ended `stuckAfterCancelMs` later (see RenderQueueOptions).
   */
  onStuck?: () => void;
}

export interface RenderQueue {
  schedule<T>(run: (ctx: JobContext) => Promise<T>, options?: ScheduleOptions<T>): Promise<T>;
  /** Jobs waiting to start. */
  readonly pending: number;
  /** True while a job is waiting or running. */
  readonly busy: boolean;
}

export interface RenderQueueOptions {
  timeoutMs: number;
  /** Awaited between jobs so the window can handle input. */
  between?: () => Promise<void>;
  /** Called each time the last job has finished and nothing is waiting. */
  onDrained?: () => void;
  /** Called when a job ran out of time, or was cancelled and its work did not end in time (below). */
  onTimeout?: () => void;
  /**
   * A job cancelled while running is let go at once, but its work may never end (a worker that has
   * stopped answering). When the work has not ended this long after the cancel, `onTimeout` is
   * called as for a job out of time (or the job's own onStuck), so the worker is restarted although
   * nobody waits for the job (lane V review, item 7). Unset: not watched.
   */
  stuckAfterCancelMs?: number;
}

export class RenderTimeoutError extends Error {
  constructor() {
    super('Rendering this page took too long.');
    this.name = 'RenderTimeoutError';
  }
}

export function abortError(): DOMException {
  return new DOMException('The render was cancelled.', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

interface Job {
  run: (ctx: JobContext) => Promise<unknown>;
  options: ScheduleOptions<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  detach: () => void;
}

type Settled = { kind: 'done'; value: unknown } | { kind: 'failed'; error: unknown } | { kind: 'stopped' };

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createRenderQueue({ timeoutMs, between = nextTick, onDrained, onTimeout, stuckAfterCancelMs }: RenderQueueOptions): RenderQueue {
  const waiting: Record<Priority, Job[]> = { view: [], run: [], dialog: [], high: [], normal: [] };
  let running = false;
  const waitingCount = () => ORDER.reduce((sum, priority) => sum + waiting[priority].length, 0);

  const take = (): Job | undefined => {
    for (const priority of ORDER) {
      const job = waiting[priority].shift();
      if (job) return job;
    }
    return undefined;
  };

  async function runOne(job: Job): Promise<void> {
    const { options } = job;
    const internal = new AbortController();
    let cancel: (() => void) | null = null;
    let timedOut = false;

    const stop = () => {
      if (internal.signal.aborted) return;
      internal.abort();
      cancel?.();
    };
    const onOuterAbort = () => stop();
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });
    const expire = () => {
      timedOut = true;
      stop();
      onTimeout?.();
    };
    let timer = setTimeout(expire, timeoutMs);

    const ctx: JobContext = {
      signal: internal.signal,
      setCancel(fn) {
        cancel = fn;
        if (internal.signal.aborted) fn();
      },
      alive() {
        if (internal.signal.aborted) return;
        clearTimeout(timer);
        timer = setTimeout(expire, timeoutMs);
      },
    };

    options.onStart?.();
    let work: Promise<Settled>;
    try {
      work = job.run(ctx).then(
        (value): Settled => ({ kind: 'done', value }),
        (error): Settled => ({ kind: 'failed', error }),
      );
    } catch (error) {
      work = Promise.resolve({ kind: 'failed', error });
    }
    const stopped = new Promise<Settled>((resolve) => {
      if (internal.signal.aborted) resolve({ kind: 'stopped' });
      else internal.signal.addEventListener('abort', () => resolve({ kind: 'stopped' }), { once: true });
    });

    const first = await Promise.race([work, stopped]);
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
    job.detach();

    const failure = () => (timedOut ? new RenderTimeoutError() : abortError());
    if (first.kind === 'stopped') {
      // Cancelled (not out of time): work that never ends is a stuck worker all the same.
      const watchdog =
        !timedOut && stuckAfterCancelMs !== undefined
          ? setTimeout(() => (options.onStuck ?? onTimeout)?.(), stuckAfterCancelMs)
          : null;
      // The job may still finish later; whatever it makes is released.
      void work.then((late) => {
        if (watchdog) clearTimeout(watchdog);
        if (late.kind === 'done') options.dispose?.(late.value);
      });
      job.reject(failure());
    } else if (first.kind === 'done') {
      if (internal.signal.aborted) {
        options.dispose?.(first.value);
        job.reject(failure());
      } else {
        job.resolve(first.value);
      }
    } else {
      job.reject(internal.signal.aborted ? failure() : first.error);
    }
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (let job = take(); job; job = take()) {
        await runOne(job);
        await between();
      }
    } finally {
      running = false;
    }
    if (waitingCount() === 0) onDrained?.();
    else void pump();
  }

  return {
    schedule<T>(run: (ctx: JobContext) => Promise<T>, options: ScheduleOptions<T> = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(abortError());
          return;
        }
        let current: Priority = options.priority ?? 'normal';
        let list = waiting[current];
        const job: Job = {
          run,
          options: options as ScheduleOptions<unknown>,
          resolve: resolve as (value: unknown) => void,
          reject,
          detach: () => undefined,
        };
        const onAbortBeforeStart = () => {
          const at = list.indexOf(job);
          if (at < 0) return; // already started; the running job handles its own abort
          list.splice(at, 1);
          reject(abortError());
        };
        options.signal?.addEventListener('abort', onAbortBeforeStart, { once: true });
        job.detach = () => options.signal?.removeEventListener('abort', onAbortBeforeStart);
        list.push(job);
        options.onQueued?.((priority) => {
          const target = waiting[priority];
          if (ORDER.indexOf(priority) >= ORDER.indexOf(current)) return;
          const at = list.indexOf(job);
          if (at < 0) return; // already started
          list.splice(at, 1);
          target.push(job);
          list = target;
          current = priority;
        });
        void pump();
      });
    },
    get pending() {
      return waitingCount();
    },
    get busy() {
      return running || waitingCount() > 0;
    },
  };
}
