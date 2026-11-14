import { describe, expect, it, vi, type Mock } from 'vitest';
import { createDocOpener, type StartedOpen } from './docOpener';

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

function setup() {
  let worker = 'w1';
  const tasks: FakeTask[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const dropWorker = vi.fn(() => {
    worker = `w${Number(worker.slice(1)) + 1}`;
  });
  const opener = createDocOpener<string, string>({
    start: async (bytes): Promise<StartedOpen<string, string>> => {
      const task: FakeTask = { bytes, worker, load: deferred<string>(), destroy: vi.fn(async () => undefined) };
      tasks.push(task);
      return { promise: task.load.promise, destroy: task.destroy, worker: task.worker };
    },
    currentWorker: () => worker,
    dropWorker,
    timeoutMs: 25_000,
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
