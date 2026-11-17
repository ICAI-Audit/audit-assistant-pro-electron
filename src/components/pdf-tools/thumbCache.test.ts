import { describe, expect, it, vi } from 'vitest';
import type { Priority } from './renderQueue';
import { createThumbCache, type ThumbRender } from './thumbCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const abortError = () => new DOMException('The render was cancelled.', 'AbortError');

/** A stand-in renderer: each call waits until the test settles it; it records what it was asked. */
function renderer() {
  const calls: { signal: AbortSignal; priority: Priority; raised: Priority[]; done: ReturnType<typeof deferred<string>>; onStart: () => void }[] = [];
  const render: ThumbRender = ({ signal, priority, onStart, onQueued }) => {
    const done = deferred<string>();
    const call = { signal, priority, raised: [] as Priority[], done, onStart };
    onQueued((up) => call.raised.push(up));
    signal.addEventListener('abort', () => done.reject(abortError()), { once: true });
    calls.push(call);
    return done.promise;
  };
  return { render, calls };
}

describe('thumbCache: a page drawn once is shown wherever it is asked for at that size (QA-FIX C)', () => {
  it('a drawing made for the page panel is reused at once by the Organise grid: one render, two users', async () => {
    const revoke = vi.fn();
    const cache = createThumbCache({ maxIdle: 10, revoke });
    const bytes = new Uint8Array([1]);
    const { render, calls } = renderer();
    const panel = cache.draw(bytes, '0:208', render, { priority: 'high', signal: new AbortController().signal });
    calls[0].done.resolve('blob:page-1');
    expect(await panel).toBe('blob:page-1');
    expect(cache.take(bytes, '0:208')).toBe('blob:page-1'); // the grid: no second render
    expect(calls).toHaveLength(1);
    cache.give(bytes, '0:208');
    cache.give(bytes, '0:208');
    expect(revoke).not.toHaveBeenCalled(); // kept for the next one who asks
  });

  it('a request for a page already waiting joins that drawing and raises its priority', async () => {
    const cache = createThumbCache({ maxIdle: 10, revoke: vi.fn() });
    const bytes = new Uint8Array([1]);
    const { render, calls } = renderer();
    const panel = cache.draw(bytes, '2:208', render, { priority: 'high', signal: new AbortController().signal });
    const grid = cache.draw(bytes, '2:208', render, { priority: 'dialog', signal: new AbortController().signal });
    expect(calls).toHaveLength(1);
    expect(calls[0].raised).toEqual(['dialog']);
    calls[0].done.resolve('blob:page-3');
    expect(await Promise.all([panel, grid])).toEqual(['blob:page-3', 'blob:page-3']);
  });

  it('the drawing is stopped only when every one waiting for it has left', async () => {
    const cache = createThumbCache({ maxIdle: 10, revoke: vi.fn() });
    const bytes = new Uint8Array([1]);
    const { render, calls } = renderer();
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.draw(bytes, '0:208', render, { priority: 'high', signal: a.signal });
    const second = cache.draw(bytes, '0:208', render, { priority: 'high', signal: b.signal });
    a.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls[0].signal.aborted).toBe(false);
    b.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls[0].signal.aborted).toBe(true);
    // Asked again later: drawn afresh.
    void cache.draw(bytes, '0:208', render, { priority: 'high', signal: new AbortController().signal });
    expect(calls).toHaveLength(2);
  });

  it('a failed drawing is not kept: the next request (Try again) draws again', async () => {
    const cache = createThumbCache({ maxIdle: 10, revoke: vi.fn() });
    const bytes = new Uint8Array([1]);
    const { render, calls } = renderer();
    const first = cache.draw(bytes, '0:208', render, { priority: 'high', signal: new AbortController().signal });
    calls[0].done.reject(new Error('timed out'));
    await expect(first).rejects.toThrow('timed out');
    expect(cache.take(bytes, '0:208')).toBeNull();
    void cache.draw(bytes, '0:208', render, { priority: 'high', signal: new AbortController().signal });
    expect(calls).toHaveLength(2);
  });

  it('keeps at most maxIdle drawings nobody shows, letting the oldest go; a shown one is never let go', async () => {
    const revoke = vi.fn();
    const cache = createThumbCache({ maxIdle: 2, revoke });
    const bytes = new Uint8Array([1]);
    const { render, calls } = renderer();
    for (let page = 0; page < 4; page++) {
      const drawing = cache.draw(bytes, `${page}:208`, render, { priority: 'high', signal: new AbortController().signal });
      calls[page].done.resolve(`blob:${page}`);
      await drawing;
      if (page !== 1) cache.give(bytes, `${page}:208`); // page 2 (index 1) stays on screen
    }
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(['blob:0']);
    expect(cache.take(bytes, '1:208')).toBe('blob:1');
  });

  it('clear() lets every drawing go (engagement changed): shown ones when they are given back', async () => {
    const revoke = vi.fn();
    const cache = createThumbCache({ maxIdle: 10, revoke });
    const bytes = new Uint8Array([1]);
    const { render, calls } = renderer();
    const shown = cache.draw(bytes, '0:208', render, { priority: 'high', signal: new AbortController().signal });
    calls[0].done.resolve('blob:shown');
    await shown;
    const idle = cache.draw(bytes, '1:208', render, { priority: 'high', signal: new AbortController().signal });
    calls[1].done.resolve('blob:idle');
    await idle;
    cache.give(bytes, '1:208');
    cache.clear();
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(['blob:idle']);
    expect(cache.take(bytes, '0:208')).toBeNull();
    cache.give(bytes, '0:208');
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(['blob:idle', 'blob:shown']);
  });

  it('tells each waiting caller when its drawing starts', async () => {
    const cache = createThumbCache({ maxIdle: 10, revoke: vi.fn() });
    const bytes = new Uint8Array([1]);
    const { render, calls } = renderer();
    const started: string[] = [];
    void cache.draw(bytes, '0:208', render, { priority: 'high', signal: new AbortController().signal, onStart: () => started.push('panel') });
    calls[0].onStart();
    void cache.draw(bytes, '0:208', render, { priority: 'dialog', signal: new AbortController().signal, onStart: () => started.push('grid') });
    expect(started).toEqual(['panel', 'grid']);
  });
});
