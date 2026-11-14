import { describe, expect, it, vi } from 'vitest';
import type { BatchOptions, BatchResult } from '../destinations';
import { BatchRunner, UNEXPECTED, type BatchView } from './batchRunner';

const done = (over: Partial<BatchResult> = {}): BatchResult => ({ status: 'done', succeeded: [], failed: [], addedToVault: [], droppedFromVault: [], logFailures: 0, notStarted: 0, ...over });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const views: BatchView[] = [];
  const runner = new BatchRunner((view) => views.push(view));
  return { runner, views, last: () => views[views.length - 1] };
}

describe('BatchRunner', () => {
  it('runs a batch: running, progress, then idle with the message the screen returns', async () => {
    const { runner, last } = setup();
    const gate = deferred<BatchResult>();
    let options!: BatchOptions;
    const finish = vi.fn(() => ({ tone: 'error' as const, title: 'Not added to the Evidence Vault' }));
    expect(
      runner.start((o) => {
        options = o;
        return gate.promise;
      }, finish),
    ).toBe(true);
    expect(last()).toEqual({ phase: 'running', progress: null, message: null });
    options.onProgress?.(1, 3, 'B.pdf');
    expect(last().progress).toEqual({ done: 1, total: 3, name: 'B.pdf' });
    gate.resolve(done());
    await vi.waitFor(() => expect(last().phase).toBe('idle'));
    expect(finish).toHaveBeenCalledTimes(1);
    expect(last()).toEqual({ phase: 'idle', progress: null, message: { tone: 'error', title: 'Not added to the Evidence Vault' } });
  });

  it('does not start when the screen refuses (no scope), nor twice', () => {
    const { runner, views } = setup();
    expect(runner.start(() => null, () => null)).toBe(false);
    expect(views).toEqual([]);
    const gate = deferred<BatchResult>();
    expect(runner.start(() => gate.promise, () => null)).toBe(true);
    const second = vi.fn(() => gate.promise);
    expect(runner.start(second, () => null)).toBe(false);
    expect(second).not.toHaveBeenCalled();
  });

  it('Stop aborts the signal and says Stopping', () => {
    const { runner, last } = setup();
    let signal!: AbortSignal;
    runner.start((o) => {
      signal = o.signal!;
      return new Promise(() => undefined);
    }, () => null);
    runner.stop();
    expect(signal.aborted).toBe(true);
    expect(last().phase).toBe('stopping');
  });

  it('when its dialog goes away: aborts (nothing more is sent), shows nothing more, and still reports the result', async () => {
    const { runner, views } = setup();
    const gate = deferred<BatchResult>();
    let options!: BatchOptions;
    const finish = vi.fn(() => null);
    runner.start((o) => {
      options = o;
      return gate.promise;
    }, finish);
    const shown = views.length;
    runner.dispose();
    expect(options.signal!.aborted).toBe(true);
    options.onProgress?.(1, 2, 'B.pdf');
    gate.resolve(done({ status: 'stopped', notStarted: 1 }));
    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(done({ status: 'stopped', notStarted: 1 })));
    expect(views).toHaveLength(shown);
    expect(runner.start(() => gate.promise, () => null)).toBe(false);
  });

  it('a batch that throws (a defect) ends with a plain message instead of hanging', async () => {
    const { runner, last } = setup();
    const gate = deferred<BatchResult>();
    const finish = vi.fn(() => null);
    runner.start(() => gate.promise, finish);
    gate.reject(new Error('boom'));
    await vi.waitFor(() => expect(last().phase).toBe('idle'));
    expect(last().message).toEqual(UNEXPECTED);
    expect(finish).not.toHaveBeenCalled();
  });
});
