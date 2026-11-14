// A one-at-a-time job queue for page renders. No pdfjs or DOM here, so it can be unit-tested.
//
// - Jobs run strictly one after another: a tool run's pages ('run') first, then the page panel
//   ('high'), then list thumbnails ('normal'). A run waits at most for the job already in flight.
// - Each job gets an AbortSignal. A job aborted before it starts is dropped; one aborted while
//   running has its cancel function called and the queue moves on at once, without waiting for
//   it. A result that still arrives afterwards is passed to `dispose` (for example to revoke a
//   blob URL).
// - Each job has a time limit. When it runs out the job is cancelled, rejected with
//   RenderTimeoutError, and the queue moves on.

export type Priority = 'run' | 'high' | 'normal';

export interface JobContext {
  signal: AbortSignal;
  /** Registers how to stop the job's work. Called at once if the job has already been aborted. */
  setCancel(cancel: () => void): void;
}

export interface ScheduleOptions<T> {
  signal?: AbortSignal;
  priority?: Priority;
  dispose?: (value: T) => void;
  onStart?: () => void;
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
  onTimeout?: () => void;
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

export function createRenderQueue({ timeoutMs, between = nextTick, onDrained, onTimeout }: RenderQueueOptions): RenderQueue {
  const waiting: Record<Priority, Job[]> = { run: [], high: [], normal: [] };
  let running = false;
  const waitingCount = () => waiting.run.length + waiting.high.length + waiting.normal.length;

  const take = (): Job | undefined => waiting.run.shift() ?? waiting.high.shift() ?? waiting.normal.shift();

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
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
      onTimeout?.();
    }, timeoutMs);

    const ctx: JobContext = {
      signal: internal.signal,
      setCancel(fn) {
        cancel = fn;
        if (internal.signal.aborted) fn();
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
      // The job may still finish later; whatever it makes is released.
      void work.then((late) => {
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
        const list = waiting[options.priority ?? 'normal'];
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
