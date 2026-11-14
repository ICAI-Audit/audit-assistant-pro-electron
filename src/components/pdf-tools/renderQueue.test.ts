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
