// Opens documents for the page renderer, one at a time, and keeps the latest one open. No pdfjs
// here: the renderer passes in how to start an open, so the bookkeeping is unit-tested.
//
// - One open runs at a time. A caller for the same bytes joins it; a caller for other bytes waits
//   until it has finished, so two documents are never parsed in the worker at once.
// - A caller that cancels stops waiting at once. When no caller is left, the loading task is
//   destroyed and its time limit cleared, so a forgotten open can never act later.
// - When the time limit runs out, the worker is dropped only if it is still the worker the open
//   started on; otherwise only that task is destroyed, and a later job's worker is left alone.
// - Only one document stays open: the previous one is destroyed before the next is opened, and
//   again when a document is kept, if it is not the same task.

export interface StartedOpen<D, W> {
  promise: Promise<D>;
  destroy: () => Promise<void> | void;
  /** The worker the task runs on. */
  worker: W;
  /** Rejects if the worker fails. */
  failed?: Promise<never>;
}

export interface DocOpenerOptions<D, W> {
  start(bytes: Uint8Array): Promise<StartedOpen<D, W>>;
  currentWorker(): W | null;
  dropWorker(): void;
  timeoutMs: number;
  timeoutError(): Error;
  /** The error a caller sees when an open fails (never a library's raw text). */
  failure(error: unknown): Error;
  abortError(): Error;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DocOpener<D> {
  open(bytes: Uint8Array, signal: AbortSignal): Promise<D>;
  /** Destroys the open document (after a quiet spell). */
  close(): Promise<void>;
  /** The worker went away: forget the open document and fail an open in progress. */
  reset(): void;
  /** The bytes of the open document, if any. */
  readonly current: Uint8Array | null;
}

interface Pending<D, W> {
  bytes: Uint8Array;
  waiters: number;
  done: boolean;
  started: StartedOpen<D, W> | null;
  timer: unknown;
  promise: Promise<D>;
  settle(result: { doc: D } | { error: Error }): void;
}

function destroyQuietly(destroy: () => Promise<void> | void): Promise<void> {
  try {
    return Promise.resolve(destroy()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

export function createDocOpener<D, W>(o: DocOpenerOptions<D, W>): DocOpener<D> {
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let opened: { bytes: Uint8Array; doc: D; destroy: () => Promise<void> | void } | null = null;
  let pending: Pending<D, W> | null = null;

  function startOpen(bytes: Uint8Array): Pending<D, W> {
    let settlePromise!: (result: { doc: D } | { error: Error }) => void;
    const promise = new Promise<D>((resolve, reject) => {
      settlePromise = (result) => ('doc' in result ? resolve(result.doc) : reject(result.error));
    });
    promise.catch(() => undefined);
    const p: Pending<D, W> = {
      bytes,
      waiters: 0,
      done: false,
      started: null,
      timer: null,
      promise,
      settle(result) {
        if (p.done) return;
        p.done = true;
        clearTimer(p.timer);
        if (pending === p) pending = null;
        settlePromise(result);
      },
    };
    pending = p;

    p.timer = setTimer(() => {
      if (p.done) return;
      const started = p.started;
      p.settle({ error: o.timeoutError() });
      if (started && o.currentWorker() === started.worker) o.dropWorker();
      else if (started) void destroyQuietly(started.destroy);
    }, o.timeoutMs);

    const previous = opened;
    opened = null;
    void (async () => {
      if (previous) await destroyQuietly(previous.destroy);
      if (p.done) return;
      let started: StartedOpen<D, W>;
      try {
        started = await o.start(bytes);
      } catch (error) {
        p.settle({ error: o.failure(error) });
        return;
      }
      if (p.done) {
        // Cancelled, timed out or reset while it was starting.
        void destroyQuietly(started.destroy);
        return;
      }
      p.started = started;
      try {
        const doc = await (started.failed ? Promise.race([started.promise, started.failed]) : started.promise);
        if (p.done) {
          void destroyQuietly(started.destroy);
          return;
        }
        if (opened && opened.destroy !== started.destroy) void destroyQuietly(opened.destroy);
        opened = { bytes, doc, destroy: started.destroy };
        p.settle({ doc });
      } catch (error) {
        if (p.done) return;
        void destroyQuietly(started.destroy);
        p.settle({ error: o.failure(error) });
      }
    })();
    return p;
  }

  /** Waits for `p` as one of its callers; leaving early destroys it if nobody else waits. */
  function join(p: Pending<D, W>, signal: AbortSignal): Promise<D> {
    p.waiters += 1;
    return new Promise<D>((resolve, reject) => {
      let left = false;
      const leave = () => {
        if (left) return false;
        left = true;
        p.waiters -= 1;
        signal.removeEventListener('abort', onAbort);
        return true;
      };
      const onAbort = () => {
        if (!leave()) return;
        reject(o.abortError());
        if (p.waiters === 0 && !p.done) {
          const started = p.started;
          p.settle({ error: o.abortError() });
          if (started) void destroyQuietly(started.destroy);
        }
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      p.promise.then(
        (doc) => leave() && resolve(doc),
        (error) => leave() && reject(error),
      );
    });
  }

  /** Resolves when `p` has finished either way; rejects only if the caller cancels first. */
  function settled(p: Pending<D, W>, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(o.abortError());
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      const done = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      p.promise.then(done, done);
    });
  }

  return {
    async open(bytes, signal) {
      for (;;) {
        if (signal.aborted) throw o.abortError();
        if (opened && opened.bytes === bytes) return opened.doc;
        if (pending && pending.bytes === bytes) return join(pending, signal);
        if (pending) {
          await settled(pending, signal);
          continue;
        }
        return join(startOpen(bytes), signal);
      }
    },

    async close() {
      const current = opened;
      opened = null;
      if (current) await destroyQuietly(current.destroy);
    },

    reset() {
      const current = opened;
      opened = null;
      if (current) void destroyQuietly(current.destroy);
      const p = pending;
      if (p && !p.done) {
        const started = p.started;
        p.settle({ error: o.failure(new Error('The page renderer was restarted.')) });
        if (started) void destroyQuietly(started.destroy);
      }
    },

    get current() {
      return opened?.bytes ?? null;
    },
  };
}
