import { describe, expect, it, vi } from 'vitest';
import { createRenderQueue, isAbortError, RenderTimeoutError, type JobContext } from './renderQueue';

const now = () => Promise.resolve();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('render queue', () => {
  it("serves a tool run's job next, ahead of page tiles already waiting", async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const log: string[] = [];
    const inFlight = deferred<void>();
    const tiles: Promise<unknown>[] = [];
    tiles.push(
      queue.schedule(async () => {
        log.push('tile 0');
        await inFlight.promise;
      }, { priority: 'high' }),
    );
    await settle(); // tile 0 is now running
    for (let i = 1; i <= 20; i++) tiles.push(queue.schedule(async () => log.push(`tile ${i}`), { priority: 'high' }));
    const page = queue.schedule(async () => log.push('run page 1'), { priority: 'run' });
    inFlight.resolve();
    await page;
    await Promise.all(tiles);
    expect(log.slice(0, 3)).toEqual(['tile 0', 'run page 1', 'tile 1']);
  });

  it("serves a queued page-viewer job before a tool run's, the page panel's and the list's", async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const log: string[] = [];
    const inFlight = deferred<void>();
    const all: Promise<unknown>[] = [
      queue.schedule(async () => {
        log.push('in flight');
        await inFlight.promise;
      }, { priority: 'normal' }),
    ];
    await settle();
    all.push(queue.schedule(async () => log.push('list'), { priority: 'normal' }));
    all.push(queue.schedule(async () => log.push('panel'), { priority: 'high' }));
    all.push(queue.schedule(async () => log.push('run'), { priority: 'run' }));
    all.push(queue.schedule(async () => log.push('viewer'), { priority: 'view' }));
    inFlight.resolve();
    await Promise.all(all);
    expect(log).toEqual(['in flight', 'viewer', 'run', 'panel', 'list']);
  });

  it('a cancelled page-viewer job gives its place up at once', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const log: string[] = [];
    const inFlight = deferred<void>();
    const first = queue.schedule(async () => {
      await inFlight.promise;
    });
    await settle();
    const controller = new AbortController();
    const viewer = queue.schedule(async () => log.push('viewer'), { priority: 'view', signal: controller.signal });
    const run = queue.schedule(async () => log.push('run'), { priority: 'run' });
    expect(queue.pending).toBe(2);
    controller.abort();
    await expect(viewer).rejects.toSatisfy(isAbortError);
    expect(queue.pending).toBe(1);
    inFlight.resolve();
    await first;
    await run;
    expect(log).toEqual(['run']);
  });

  it('a job cancelled while running that never ends is treated as stuck after the grace time', async () => {
    // The queue moves on at once; but work that never ends (a worker that stopped answering) must
    // still lead to a restart, even though nobody waits for it any more (lane V review, item 7).
    const onTimeout = vi.fn();
    const queue = createRenderQueue({ timeoutMs: 1000, stuckAfterCancelMs: 30, between: now, onTimeout });
    const controller = new AbortController();
    const stuck = queue.schedule(() => new Promise<string>(() => undefined), { signal: controller.signal });
    await settle();
    controller.abort();
    await expect(stuck).rejects.toSatisfy(isAbortError);
    expect(onTimeout).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("a job's own onStuck is called instead, so the caller can tell whether its worker is still the one in use", async () => {
    const onTimeout = vi.fn();
    const onStuck = vi.fn();
    const queue = createRenderQueue({ timeoutMs: 1000, stuckAfterCancelMs: 30, between: now, onTimeout });
    const controller = new AbortController();
    const stuck = queue.schedule(() => new Promise<string>(() => undefined), { signal: controller.signal, onStuck });
    await settle();
    controller.abort();
    await expect(stuck).rejects.toSatisfy(isAbortError);
    await new Promise((r) => setTimeout(r, 60));
    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('a job cancelled while running that ends in time is not treated as stuck', async () => {
    const onTimeout = vi.fn();
    const queue = createRenderQueue({ timeoutMs: 1000, stuckAfterCancelMs: 30, between: now, onTimeout });
    const controller = new AbortController();
    const gate = deferred<string>();
    const job = queue.schedule(() => gate.promise, { signal: controller.signal });
    await settle();
    controller.abort();
    await expect(job).rejects.toSatisfy(isAbortError);
    gate.resolve('late');
    await new Promise((r) => setTimeout(r, 60));
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('runs jobs one at a time in order', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const log: string[] = [];
    const first = deferred<string>();
    const a = queue.schedule(async () => {
      log.push('a start');
      const v = await first.promise;
      log.push('a end');
      return v;
    });
    const b = queue.schedule(async () => {
      log.push('b start');
      return 'b';
    });
    await settle();
    expect(log).toEqual(['a start']);
    first.resolve('a');
    expect(await a).toBe('a');
    expect(await b).toBe('b');
    expect(log).toEqual(['a start', 'a end', 'b start']);
  });

  it('removes a job aborted before it starts', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const gate = deferred<void>();
    const ran: string[] = [];
    void queue.schedule(async () => {
      await gate.promise;
      ran.push('first');
    });
    const controller = new AbortController();
    const second = queue.schedule(async () => {
      ran.push('second');
    }, { signal: controller.signal });
    controller.abort();
    await expect(second).rejects.toSatisfy(isAbortError);
    gate.resolve();
    await settle();
    await settle();
    expect(ran).toEqual(['first']);
    expect(queue.pending).toBe(0);
  });

  it('rejects at once when the signal has already fired', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const run = vi.fn(async () => 'x');
    await expect(queue.schedule(run, { signal: AbortSignal.abort() })).rejects.toSatisfy(isAbortError);
    expect(run).not.toHaveBeenCalled();
  });

  it('stops a running job on abort, cancels it, and goes on with the next', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const controller = new AbortController();
    const cancel = vi.fn();
    let seen: JobContext | null = null;
    const stuck = queue.schedule(
      (ctx) => {
        seen = ctx;
        ctx.setCancel(cancel);
        return new Promise<string>(() => undefined); // never settles by itself
      },
      { signal: controller.signal },
    );
    const next = queue.schedule(async () => 'next');
    await settle();
    controller.abort();
    await expect(stuck).rejects.toSatisfy(isAbortError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(seen!.signal.aborted).toBe(true);
    expect(await next).toBe('next');
  });

  it('cancels straight away when the cancel function is set after the abort', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const controller = new AbortController();
    const cancel = vi.fn();
    const job = queue.schedule(
      async (ctx) => {
        controller.abort();
        ctx.setCancel(cancel);
        return 'late';
      },
      { signal: controller.signal },
    );
    await expect(job).rejects.toSatisfy(isAbortError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('disposes a result that arrives after the abort', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const controller = new AbortController();
    const gate = deferred<string>();
    const dispose = vi.fn();
    const job = queue.schedule(() => gate.promise, { signal: controller.signal, dispose });
    await settle();
    controller.abort();
    await expect(job).rejects.toSatisfy(isAbortError);
    gate.resolve('blob:late');
    await settle();
    expect(dispose).toHaveBeenCalledWith('blob:late');
  });

  it('times a job out, frees the queue, and disposes its late result', async () => {
    const onTimeout = vi.fn();
    const queue = createRenderQueue({ timeoutMs: 20, between: now, onTimeout });
    const gate = deferred<string>();
    const dispose = vi.fn();
    const cancel = vi.fn();
    const slow = queue.schedule(
      (ctx) => {
        ctx.setCancel(cancel);
        return gate.promise;
      },
      { dispose },
    );
    const next = queue.schedule(async () => 'next');
    await expect(slow).rejects.toBeInstanceOf(RenderTimeoutError);
    expect(cancel).toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(await next).toBe('next');
    gate.resolve('blob:slow');
    await settle();
    expect(dispose).toHaveBeenCalledWith('blob:slow');
  });

  it('wave 4 (RX-RUN2): a job that keeps giving signs of work is not out of time however long it runs; silence still times it out', async () => {
    const onTimeout = vi.fn();
    const queue = createRenderQueue({ timeoutMs: 40, between: now, onTimeout });
    // A drawing that goes on for five times the limit, giving a sign of work every 10 ms (a busy machine).
    const busy = queue.schedule(async (ctx) => {
      for (let k = 0; k < 20; k++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        ctx.alive();
      }
      return 'drawn';
    });
    expect(await busy).toBe('drawn');
    expect(onTimeout).not.toHaveBeenCalled();
    // Silent for longer than the limit after one sign of work: out of time, as before.
    const gate = deferred<string>();
    const silent = queue.schedule((ctx) => {
      ctx.alive();
      return gate.promise;
    });
    await expect(silent).rejects.toBeInstanceOf(RenderTimeoutError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    gate.resolve('late');
  });

  it('starts high-priority jobs before normal ones', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const gate = deferred<void>();
    const order: string[] = [];
    const job = (name: string) => async () => {
      order.push(name);
    };
    const all = [
      queue.schedule(async () => {
        await gate.promise;
        order.push('running');
      }),
      queue.schedule(job('row 1')),
      queue.schedule(job('page 1'), { priority: 'high' }),
      queue.schedule(job('row 2')),
      queue.schedule(job('page 2'), { priority: 'high' }),
    ];
    gate.resolve();
    await Promise.all(all);
    expect(order).toEqual(['running', 'page 1', 'page 2', 'row 1', 'row 2']);
  });

  it('tells when a job starts', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const onStart = vi.fn();
    await queue.schedule(async () => 1, { onStart });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('reports drained only once every job has finished', async () => {
    const onDrained = vi.fn();
    const queue = createRenderQueue({ timeoutMs: 1000, between: now, onDrained });
    const gate = deferred<void>();
    const a = queue.schedule(() => gate.promise);
    const b = queue.schedule(async () => undefined);
    await settle();
    expect(queue.busy).toBe(true);
    expect(onDrained).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([a, b]);
    await settle();
    expect(onDrained).toHaveBeenCalledTimes(1);
    expect(queue.busy).toBe(false);
  });

  it('passes a failure through and keeps going', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const failing = queue.schedule(async () => {
      throw new Error('broken page');
    });
    const ok = queue.schedule(async () => 'ok');
    await expect(failing).rejects.toThrow('broken page');
    expect(await ok).toBe('ok');
  });
});

describe('a dialog\'s own pages come before the page panel behind it (QA-FIX C)', () => {
  it("serves 'dialog' jobs after the viewer and a run, before the page panel's and the list's", async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const log: string[] = [];
    const inFlight = deferred<void>();
    const all: Promise<unknown>[] = [
      queue.schedule(async () => {
        log.push('in flight');
        await inFlight.promise;
      }, { priority: 'high' }),
    ];
    await settle();
    for (let i = 1; i <= 5; i++) all.push(queue.schedule(async () => log.push(`panel ${i}`), { priority: 'high' }));
    all.push(queue.schedule(async () => log.push('list'), { priority: 'normal' }));
    all.push(queue.schedule(async () => log.push('organise 1'), { priority: 'dialog' }));
    all.push(queue.schedule(async () => log.push('run'), { priority: 'run' }));
    inFlight.resolve();
    await Promise.all(all);
    expect(log.slice(0, 4)).toEqual(['in flight', 'run', 'organise 1', 'panel 1']);
  });

  it('a waiting job can be raised to a higher priority, and is then served in that turn', async () => {
    const queue = createRenderQueue({ timeoutMs: 1000, between: now });
    const log: string[] = [];
    const inFlight = deferred<void>();
    const all: Promise<unknown>[] = [
      queue.schedule(async () => {
        log.push('in flight');
        await inFlight.promise;
      }, { priority: 'high' }),
    ];
    await settle();
    let raise: ((priority: 'view' | 'run' | 'dialog' | 'high' | 'normal') => void) | null = null;
    for (let i = 1; i <= 5; i++) all.push(queue.schedule(async () => log.push(`panel ${i}`), { priority: 'high' }));
    all.push(queue.schedule(async () => log.push('panel page 6'), { priority: 'high', onQueued: (up) => (raise = up) }));
    expect(raise).not.toBeNull();
    raise!('dialog');
    raise!('normal'); // never lowered
    inFlight.resolve();
    await Promise.all(all);
    expect(log.slice(0, 3)).toEqual(['in flight', 'panel page 6', 'panel 1']);
  });
});
