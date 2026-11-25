import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { createDocOpener, createLetGoWatches, type StartedOpen } from './docOpener';

// The garbage-collection tests below can take seconds on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

interface FakeTask {
  bytes: Uint8Array;
  worker: string;
  load: ReturnType<typeof deferred<string>>;
  destroy: Mock<() => Promise<void>>;
}

function setup(options: { hangDestroy?: boolean; abandonMs?: number } = {}) {
  let worker = 'w1';
  const tasks: FakeTask[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const dropWorker = vi.fn(() => {
    worker = `w${Number(worker.slice(1)) + 1}`;
  });
  const opener = createDocOpener<string, string>({
    start: async (bytes): Promise<StartedOpen<string, string>> => {
      // A worker that stopped answering never finishes destroying a task either.
      const destroy = options.hangDestroy ? vi.fn(() => new Promise<void>(() => undefined)) : vi.fn(async () => undefined);
      const task: FakeTask = { bytes, worker, load: deferred<string>(), destroy };
      tasks.push(task);
      return { promise: task.load.promise, destroy: task.destroy, worker: task.worker };
    },
    currentWorker: () => worker,
    dropWorker,
    timeoutMs: 25_000,
    abandonMs: options.abandonMs,
    timeoutError: () => new Error('timeout'),
    failure: () => new Error('failed'),
    abortError: () => new DOMException('aborted', 'AbortError'),
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  const fire = (i: number) => {
    if (!timers[i].cleared) timers[i].fn();
  };
  return { opener, tasks, timers, fire, dropWorker, setWorker: (w: string) => (worker = w) };
}

const X = new Uint8Array([1]);
const Y = new Uint8Array([2]);

describe('createDocOpener', () => {
  it('opens a file once and reuses the open document', async () => {
    const { opener, tasks } = setup();
    const first = opener.open(X, new AbortController().signal);
    await flush();
    tasks[0].load.resolve('docX');
    expect(await first).toBe('docX');
    expect(await opener.open(X, new AbortController().signal)).toBe('docX');
    expect(tasks).toHaveLength(1);
  });

  it('joins an open in progress for the same bytes', async () => {
    const { opener, tasks } = setup();
    const a = opener.open(X, new AbortController().signal);
    const b = opener.open(X, new AbortController().signal);
    await flush();
    tasks[0].load.resolve('docX');
    expect(await Promise.all([a, b])).toEqual(['docX', 'docX']);
    expect(tasks).toHaveLength(1);
  });

  it('destroys the task and clears its timer at once when its only caller cancels', async () => {
    const { opener, tasks, timers, dropWorker } = setup();
    const controller = new AbortController();
    const open = opener.open(X, controller.signal);
    await flush();
    controller.abort();
    await expect(open).rejects.toMatchObject({ name: 'AbortError' });
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(timers[0].cleared).toBe(true);
    // The load finishing late changes nothing.
    tasks[0].load.resolve('docX');
    await flush();
    expect(dropWorker).not.toHaveBeenCalled();
  });

  it('keeps the task while another caller still waits for it', async () => {
    const { opener, tasks } = setup();
    const leaving = new AbortController();
    const a = opener.open(X, leaving.signal);
    const b = opener.open(X, new AbortController().signal);
    await flush();
    leaving.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(tasks[0].destroy).not.toHaveBeenCalled();
    tasks[0].load.resolve('docX');
    expect(await b).toBe('docX');
  });

  it('destroys a task that was still starting when its caller cancelled', async () => {
    const { opener, tasks } = setup();
    const controller = new AbortController();
    const open = opener.open(X, controller.signal);
    controller.abort(); // before start() has resolved
    await expect(open).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('drops the worker on a timeout only if it is still the worker the task was opened on', async () => {
    const stillCurrent = setup();
    const open1 = stillCurrent.opener.open(X, new AbortController().signal);
    await flush();
    stillCurrent.fire(0);
    await expect(open1).rejects.toThrow('timeout');
    expect(stillCurrent.dropWorker).toHaveBeenCalledTimes(1);

    const replaced = setup();
    const open2 = replaced.opener.open(X, new AbortController().signal);
    await flush();
    replaced.setWorker('w9'); // another worker took over meanwhile
    replaced.fire(0);
    await expect(open2).rejects.toThrow('timeout');
    expect(replaced.dropWorker).not.toHaveBeenCalled();
    expect(replaced.tasks[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('opens one file at a time: another file waits for the open in progress', async () => {
    const { opener, tasks } = setup();
    const x = opener.open(X, new AbortController().signal);
    const y = opener.open(Y, new AbortController().signal);
    await flush();
    expect(tasks.map((t) => t.bytes)).toEqual([X]);
    tasks[0].load.resolve('docX');
    expect(await x).toBe('docX');
    await flush();
    expect(tasks.map((t) => t.bytes)).toEqual([X, Y]);
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1); // the old document is closed before the next opens
    tasks[1].load.resolve('docY');
    expect(await y).toBe('docY');
  });

  it('a caller waiting for another file can cancel without starting anything', async () => {
    const { opener, tasks } = setup();
    opener.open(X, new AbortController().signal).catch(() => undefined);
    const controller = new AbortController();
    const y = opener.open(Y, controller.signal);
    await flush();
    controller.abort();
    await expect(y).rejects.toMatchObject({ name: 'AbortError' });
    tasks[0].load.resolve('docX');
    await flush();
    expect(tasks).toHaveLength(1);
  });

  it('turns a failed load into the caller-facing error and destroys the task', async () => {
    const { opener, tasks } = setup();
    const open = opener.open(X, new AbortController().signal);
    await flush();
    tasks[0].load.reject(new Error('raw pdfjs text'));
    await expect(open).rejects.toThrow('failed');
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(opener.current).toBeNull();
  });

  it('reset fails an open in progress and forgets the open document', async () => {
    const { opener, tasks } = setup();
    const x = opener.open(X, new AbortController().signal);
    await flush();
    tasks[0].load.resolve('docX');
    await x;
    const y = opener.open(Y, new AbortController().signal);
    await flush();
    opener.reset();
    await expect(y).rejects.toThrow('failed');
    expect(tasks[1].destroy).toHaveBeenCalled();
    expect(opener.current).toBeNull();
  });

  it('close destroys the open document', async () => {
    const { opener, tasks } = setup();
    const x = opener.open(X, new AbortController().signal);
    await flush();
    tasks[0].load.resolve('docX');
    await x;
    await opener.close();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(opener.current).toBeNull();
  });
});

// The worker the renderer shares has one failure source that never settles while the worker
// lives. An open that waited on it through a promise left a reaction on it for ever, and with it
// the document it opened: every opened-and-closed document stayed in memory until PDF Tools closed
// (about 2.8 MB per open of a 200-page file, spike-viewer 4.8). These tests rebuild that case.
// WeakRef is in the runtime (Node 24) but not in the application's TypeScript library setting.
type Weak<T extends object> = { deref(): T | undefined };
const WeakRefOf = (globalThis as unknown as { WeakRef: new <T extends object>(target: T) => Weak<T> }).WeakRef;

describe('createDocOpener: the worker failure watch', () => {
  function watched() {
    const listeners = new Set<(error: Error) => void>();
    // As the renderer's shared worker: a failure promise that never settles while it lives.
    const neverFails = new Promise<never>(() => undefined);
    let made = 0;
    const docs: Weak<object>[] = [];
    const opener = createDocOpener<object, string>({
      start: async () => {
        made += 1;
        const doc = { pages: new ArrayBuffer(1 << 20), n: made };
        docs.push(new WeakRefOf(doc));
        const load = deferred<object>();
        queueMicrotask(() => load.resolve(doc));
        // Built as a variable, so the old `failed` field can be offered beside the new watch.
        const started = {
          promise: load.promise,
          // A plain function: a mock would remember what it was called with and returned.
          destroy: async () => undefined,
          worker: 'w1',
          failed: neverFails,
          watchFailure: (onFailure: (error: Error) => void) => {
            listeners.add(onFailure);
            return () => listeners.delete(onFailure);
          },
        };
        return started;
      },
      currentWorker: () => 'w1',
      dropWorker: vi.fn(),
      timeoutMs: 25_000,
      timeoutError: () => new Error('timeout'),
      failure: (error) => new Error(`failed: ${error instanceof Error ? error.message : 'unknown'}`),
      abortError: () => new DOMException('aborted', 'AbortError'),
    });
    return { opener, listeners, docs };
  }

  it('documents opened and let go are not kept alive by the worker (fails while opens wait on a promise)', async () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const { opener, docs } = watched();
    for (let i = 0; i < 6; i++) {
      // A different file each time: the previous document is destroyed when the next one opens.
      await opener.open(new Uint8Array([i]), new AbortController().signal);
    }
    await opener.close();
    for (let i = 0; i < 5; i++) {
      await flush();
      gc();
    }
    const alive = docs.filter((d) => d.deref() !== undefined).length;
    expect(docs).toHaveLength(6);
    expect(alive).toBe(0);
  });

  it('a document let go on a worker that does not answer is not kept alive by the watch on it', async () => {
    // Seen in the application: after a worker stopped answering, the watches of documents the viewer
    // had let go held those documents (and their loading tasks) until each watch ran out.
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const docs: Weak<object>[] = [];
    // Timers that have not run, as the event loop holds them: a cleared one is let go.
    const timers = new Set<() => void>();
    const opener = createDocOpener<object, string>({
      start: async () => {
        const doc = { pages: new ArrayBuffer(1 << 20) };
        docs.push(new WeakRefOf(doc));
        // Never answered: the worker has stopped.
        return { promise: Promise.resolve(doc), destroy: () => new Promise<void>(() => undefined), worker: 'w1' };
      },
      currentWorker: () => 'w1',
      dropWorker: vi.fn(),
      timeoutMs: 25_000,
      abandonMs: 25_000,
      timeoutError: () => new Error('timeout'),
      failure: () => new Error('failed'),
      abortError: () => new DOMException('aborted', 'AbortError'),
      setTimer: (fn) => {
        timers.add(fn);
        return fn;
      },
      clearTimer: (handle) => {
        timers.delete(handle as () => void);
      },
    });
    await opener.open(X, new AbortController().signal);
    void opener.close();
    for (let i = 0; i < 5; i++) {
      await flush();
      gc();
    }
    // The watch is still running (its time limit has not come)...
    expect(timers.size).toBe(1);
    // ...but it holds nothing of the document.
    expect(docs).toHaveLength(1);
    expect(docs[0].deref()).toBeUndefined();
  });

  it('watches the worker only while an open is in progress', async () => {
    const { opener, listeners } = watched();
    // Success.
    const first = opener.open(X, new AbortController().signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(listeners.size).toBe(1);
    await first;
    expect(listeners.size).toBe(0);
    // Cancelled by its only caller.
    const controller = new AbortController();
    const second = opener.open(Y, controller.signal);
    controller.abort();
    await expect(second).rejects.toThrow('aborted');
    await flush();
    expect(listeners.size).toBe(0);
  });

  it('a worker failure during an open fails that open with its own label', async () => {
    const listeners = new Set<(error: Error) => void>();
    const opener = createDocOpener<string, string>({
      start: async () => ({
        promise: new Promise<string>(() => undefined),
        destroy: vi.fn(async () => undefined),
        worker: 'w1',
        watchFailure: (onFailure: (error: Error) => void) => {
          listeners.add(onFailure);
          return () => listeners.delete(onFailure);
        },
      }),
      currentWorker: () => 'w1',
      dropWorker: vi.fn(),
      timeoutMs: 25_000,
      timeoutError: () => new Error('timeout'),
      failure: (error) => new Error(`failed: ${error instanceof Error ? error.message : 'unknown'}`),
      abortError: () => new DOMException('aborted', 'AbortError'),
    });
    const open = opener.open(X, new AbortController().signal);
    await flush();
    expect(listeners.size).toBe(1);
    for (const fail of listeners) fail(new Error('worker crashed'));
    await expect(open).rejects.toThrow('failed: worker crashed');
    expect(listeners.size).toBe(0);
  });
});

// A worker that stops answering (a hostile or damaged file can loop it): a viewer that closed while
// its document was still opening, then reopened, kept hitting the dead worker, because the open's
// time limit was cleared when its last caller left (lane V review, item 7).
describe('createDocOpener: work let go on a worker that does not answer', () => {
  it('an open left by its last caller drops that worker if letting it go does not finish in time', async () => {
    const { opener, tasks, timers, dropWorker } = setup({ hangDestroy: true, abandonMs: 10_000 });
    const controller = new AbortController();
    const open = opener.open(X, controller.signal);
    await flush();
    controller.abort();
    await expect(open).rejects.toThrow('aborted');
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    const watch = timers.filter((t) => t.ms === 10_000 && !t.cleared);
    expect(watch).toHaveLength(1);
    expect(dropWorker).not.toHaveBeenCalled();
    watch[0].fn();
    expect(dropWorker).toHaveBeenCalledTimes(1);
  });

  it('but not when the worker answers', async () => {
    const { opener, timers, dropWorker } = setup({ abandonMs: 10_000 });
    const controller = new AbortController();
    const open = opener.open(X, controller.signal);
    await flush();
    controller.abort();
    await expect(open).rejects.toThrow('aborted');
    await flush();
    expect(timers.filter((t) => t.ms === 10_000 && !t.cleared)).toHaveLength(0);
    expect(dropWorker).not.toHaveBeenCalled();
  });

  it('nor when the worker was replaced meanwhile', async () => {
    const { opener, timers, dropWorker, setWorker } = setup({ hangDestroy: true, abandonMs: 10_000 });
    const controller = new AbortController();
    const open = opener.open(X, controller.signal);
    await flush();
    controller.abort();
    await expect(open).rejects.toThrow('aborted');
    setWorker('w9');
    timers.find((t) => t.ms === 10_000)!.fn();
    expect(dropWorker).not.toHaveBeenCalled();
  });

  it('close lets an open in progress go as well, and watches its document being let go', async () => {
    const { opener, tasks, timers, dropWorker } = setup({ hangDestroy: true, abandonMs: 10_000 });
    const open = opener.open(X, new AbortController().signal);
    await flush();
    void opener.close();
    await expect(open).rejects.toThrow('aborted');
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    timers.find((t) => t.ms === 10_000 && !t.cleared)!.fn();
    expect(dropWorker).toHaveBeenCalledTimes(1);
  });

  it('a worker dropped meanwhile ends every watch on it at once, so none keeps that worker in memory', async () => {
    // Seen in the application: each watch held the dead worker, and through it the documents it
    // had opened, for up to the time limit after the worker had already been replaced.
    const watches = createLetGoWatches();
    let worker = 'w1';
    const timers = new Set<{ fn: () => void; ms: number }>();
    const dropWorker = vi.fn();
    const opener = createDocOpener<string, string>({
      start: async () => ({ promise: Promise.resolve('doc'), destroy: () => new Promise<void>(() => undefined), worker }),
      currentWorker: () => worker,
      dropWorker,
      timeoutMs: 25_000,
      abandonMs: 10_000,
      watches,
      timeoutError: () => new Error('timeout'),
      failure: () => new Error('failed'),
      abortError: () => new DOMException('aborted', 'AbortError'),
      setTimer: (fn, ms) => {
        const timer = { fn, ms };
        timers.add(timer);
        return timer;
      },
      clearTimer: (handle) => {
        timers.delete(handle as { fn: () => void; ms: number });
      },
    });
    await opener.open(X, new AbortController().signal);
    let closed = false;
    void opener.close().then(() => (closed = true));
    await flush();
    expect([...timers].filter((t) => t.ms === 10_000)).toHaveLength(1);
    expect(closed).toBe(false);
    // The renderer drops the worker (for another reason) and ends the watches on it.
    worker = 'w2';
    watches.endAll();
    await flush();
    expect([...timers].filter((t) => t.ms === 10_000)).toHaveLength(0);
    expect(closed).toBe(true);
    expect(dropWorker).not.toHaveBeenCalled();
  });

  it('close of an open document on a worker that does not answer drops the worker in time', async () => {
    const { opener, tasks, timers, dropWorker } = setup({ hangDestroy: true, abandonMs: 10_000 });
    const open = opener.open(X, new AbortController().signal);
    await flush();
    tasks[0].load.resolve('docX');
    await open;
    void opener.close();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    timers.find((t) => t.ms === 10_000 && !t.cleared)!.fn();
    expect(dropWorker).toHaveBeenCalledTimes(1);
  });
});
