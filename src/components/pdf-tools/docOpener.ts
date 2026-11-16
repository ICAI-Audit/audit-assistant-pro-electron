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
// - The worker is watched for failure only while an open is in progress: the watch is removed the
//   moment the open settles, however it settles. (Waiting on a shared failure promise instead left
//   a reaction on it for every open, and with it every opened document, until the worker stopped:
//   about 2.8 MB per open of a 200-page file, spike-viewer 4.8.)
// - With `abandonMs` set, work let go is watched (lane V review, item 7): an open its last caller
//   left, an open in progress when the opener is closed, and the open document when it is closed
//   or replaced are destroyed at once, and if that has not finished `abandonMs` later (and, when
//   the worker can be heard, the worker has said nothing since), the worker is taken to have
//   stopped answering and is dropped, if it is still the worker the work ran on. Without it, a
//   viewer closed while its file was opening on a stuck worker cleared the open's time limit, so
//   nothing ever restarted the worker and every later viewer hung on it.

/**
 * The watches of work let go, shared by the openers on one worker. When the renderer drops that
 * worker, it ends them all at once: a watch would otherwise keep the dead worker, and through its
 * listeners every document it had opened, until its time limit (seen in the application).
 */
export interface LetGoWatches {
  add(end: () => void): void;
  delete(end: () => void): void;
  /** Ends every watch now, without dropping anything (the worker has already gone). */
  endAll(): void;
}

export function createLetGoWatches(): LetGoWatches {
  const all = new Set<() => void>();
  return {
    add: (end) => void all.add(end),
    delete: (end) => void all.delete(end),
    endAll: () => {
      const ending = [...all];
      all.clear();
      for (const end of ending) end();
    },
  };
}

export interface StartedOpen<D, W> {
  promise: Promise<D>;
  destroy: () => Promise<void> | void;
  /** The worker the task runs on. */
  worker: W;
  /** Calls `onFailure` if the worker fails; returns how to stop watching (called when the open settles). */
  watchFailure?: (onFailure: (error: Error) => void) => () => void;
  /**
   * Calls `onAnswer` the next time the worker sends anything; returns how to stop listening. A
   * task destroyed before the worker answered its open is let go without asking the worker (pdf.js
   * has nothing to tell it), so only an answer shows that the worker still works.
   */
  watchAnswer?: (onAnswer: () => void) => () => void;
}

export interface DocOpenerOptions<D, W> {
  start(bytes: Uint8Array): Promise<StartedOpen<D, W>>;
  currentWorker(): W | null;
  dropWorker(): void;
  timeoutMs: number;
  /** How long work let go may take before its worker is taken to be stuck (see the header). Unset: not watched. */
  abandonMs?: number;
  /** Where those watches are kept, so that dropping the worker ends them (see LetGoWatches). */
  watches?: LetGoWatches;
  timeoutError(): Error;
  /** The error a caller sees when an open fails (never a library's raw text). */
  failure(error: unknown): Error;
  abortError(): Error;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DocOpener<D> {
  open(bytes: Uint8Array, signal: AbortSignal): Promise<D>;
  /**
   * Destroys the open document (after a quiet spell, or when the viewer closes). An open in
   * progress is let go as well: its callers are told it was cancelled.
   */
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
  /** Stops watching the worker for this open. */
  unwatch: (() => void) | null;
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
  let opened: { bytes: Uint8Array; doc: D; started: StartedOpen<D, W> } | null = null;
  let pending: Pending<D, W> | null = null;

  /**
   * Destroys work that is no longer wanted. With `abandonMs`, watches it being let go (see the
   * header); resolves when it has been, or when the watch gave up on the worker. Destroying an
   * opened document asks the worker to drop it, so its end is the worker's answer; an open still in
   * progress may be let go without a word to the worker, so the worker must also be heard from.
   */
  function letGo(started: StartedOpen<D, W>, loaded: boolean): Promise<void> {
    const destroyed = destroyQuietly(started.destroy);
    const limit = o.abandonMs;
    if (limit === undefined) return destroyed;
    // The watch keeps only the worker and how to hear it: never the task or its document, which a
    // worker that does not answer would otherwise keep in memory until the watch ends.
    return watchLetGo(destroyed, started.worker, loaded ? undefined : started.watchAnswer, limit);
  }

  function watchLetGo(destroyed: Promise<void>, worker: W, watchAnswer: StartedOpen<D, W>['watchAnswer'], limit: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let over = false;
      let isDestroyed = false;
      let heard = !watchAnswer;
      let unwatch: (() => void) | null = null;
      const end = () => {
        if (over) return;
        over = true;
        o.watches?.delete(end);
        clearTimer(timer);
        const stop = unwatch;
        unwatch = null;
        stop?.();
        resolve();
      };
      const check = () => {
        if (!over && isDestroyed && heard) end();
      };
      const timer = setTimer(() => {
        if (over) return;
        end();
        if (o.currentWorker() === worker) o.dropWorker();
      }, limit);
      o.watches?.add(end);
      if (!heard) {
        unwatch =
          watchAnswer?.(() => {
            heard = true;
            check();
          }) ?? null;
      }
      void destroyed.then(() => {
        isDestroyed = true;
        check();
      });
    });
  }

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
      unwatch: null,
      timer: null,
      promise,
      settle(result) {
        if (p.done) return;
        p.done = true;
        clearTimer(p.timer);
        const unwatch = p.unwatch;
        p.unwatch = null;
        unwatch?.();
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
    // Started here, not awaited with `previous` in reach: a worker that does not answer would keep it.
    const previousGone = previous ? letGo(previous.started, true) : null;
    void (async () => {
      if (previousGone) await previousGone;
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
        void letGo(started, false);
        return;
      }
      p.started = started;
      try {
        const doc = await new Promise<D>((resolve, reject) => {
          p.unwatch = started.watchFailure?.(reject) ?? null;
          started.promise.then(resolve, reject);
        });
        if (p.done) {
          void letGo(started, true);
          return;
        }
        if (opened && opened.started.destroy !== started.destroy) void letGo(opened.started, true);
        opened = { bytes, doc, started };
        p.settle({ doc });
      } catch (error) {
        if (p.done) return;
        void destroyQuietly(started.destroy);
        p.settle({ error: o.failure(error) });
      }
    })();
    return p;
  }

  /** Nobody wants `p` any more: its callers are told it was cancelled, and what it started is let go. */
  function abandon(p: Pending<D, W>): Promise<void> {
    const started = p.started;
    p.settle({ error: o.abortError() });
    // Not started yet: the open lets its task go itself once it has started (above).
    return started ? letGo(started, false) : Promise.resolve();
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
        if (p.waiters === 0 && !p.done) void abandon(p);
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

    close() {
      const current = opened;
      opened = null;
      const p = pending;
      // Not an async function: a close waiting on a worker that does not answer keeps nothing of the document.
      return Promise.all([current ? letGo(current.started, true) : undefined, p && !p.done ? abandon(p) : undefined]).then(() => undefined);
    },

    reset() {
      const current = opened;
      opened = null;
      if (current) void destroyQuietly(current.started.destroy);
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
