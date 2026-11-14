// useToolRun's run lifecycle. No DOM is installed, so React is replaced by a tiny single-component
// hook runtime that can render, unmount, and re-run every effect without unmounting (what Fast
// Refresh and StrictMode do in development).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Slot = { v?: unknown; current?: unknown; fn?: unknown; deps?: unknown[]; setup?: () => unknown; cleanup?: unknown };
  let slots: Slot[] = [];
  let index = 0;
  let queue: number[] = [];
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(init: unknown) {
      const k = index++;
      if (!slots[k]) slots[k] = { v: typeof init === 'function' ? (init as () => unknown)() : init };
      const slot = slots[k];
      return [slot.v, (next: unknown) => (slot.v = typeof next === 'function' ? (next as (p: unknown) => unknown)(slot.v) : next)];
    },
    useRef(init: unknown) {
      const k = index++;
      if (!slots[k]) slots[k] = { current: init };
      return slots[k];
    },
    useCallback(fn: unknown, deps: unknown[]) {
      const k = index++;
      if (slots[k] && same(slots[k].deps, deps)) return slots[k].fn;
      slots[k] = { fn, deps };
      return fn;
    },
    useEffect(setup: () => unknown, deps: unknown[]) {
      const k = index++;
      const previous = slots[k];
      if (previous && same(previous.deps, deps)) return;
      slots[k] = { deps, setup, cleanup: previous?.cleanup };
      queue.push(k);
    },
  };
  const runtime = {
    render<T>(hook: () => T): T {
      index = 0;
      const out = hook();
      for (const k of queue) {
        const slot = slots[k];
        if (typeof slot.cleanup === 'function') (slot.cleanup as () => void)();
        slot.cleanup = slot.setup!();
      }
      queue = [];
      return out;
    },
    unmount() {
      for (const slot of slots) if (slot && typeof slot.cleanup === 'function') (slot.cleanup as () => void)();
    },
    /** Clean up and set up every effect again, state kept: Fast Refresh, StrictMode's mount check. */
    rerunEffects() {
      for (const slot of slots) {
        if (!slot?.setup) continue;
        if (typeof slot.cleanup === 'function') (slot.cleanup as () => void)();
        slot.cleanup = slot.setup();
      }
    },
    reset() {
      slots = [];
      index = 0;
      queue = [];
    },
  };
  const toasts: string[] = [];
  return { react, runtime, toasts };
});

vi.mock('react', () => h.react);
vi.mock('sonner', () => ({ toast: { warning: (m: string) => h.toasts.push(m), success: () => undefined, error: () => undefined } }));
// Like the real runTool: an abort of its signal ends it as 'cancelled'.
vi.mock('../runTool', () => ({
  runTool: (_tool: string, _files: unknown, _options: unknown, ctx: { signal: AbortSignal }) =>
    new Promise((resolve) => {
      ctx.signal.addEventListener('abort', () => setTimeout(() => resolve({ status: 'cancelled', added: 0, ids: [] }), 0));
    }),
}));

const { useToolRun } = await import('./useToolRun');
const { createWorkingListStore } = await import('@/lib/pdf-tools/workingList');

const flush = () => new Promise((r) => setTimeout(r, 5));

function mountRunning() {
  h.runtime.reset();
  h.toasts.length = 0;
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const onClose = vi.fn();
  const props = {
    files: [],
    scope: () => ({ contextKey: 'u1:A', session: store.getState().session }),
    store,
    listBytes: 0,
    onFinished: vi.fn(),
    onClose,
  };
  const render = () => h.runtime.render(() => useToolRun('pdf-to-images', props as never));
  render().start({ pages: 'all', format: 'png', dpi: 300 });
  return { render, store, onClose };
}

beforeEach(() => {
  h.toasts.length = 0;
});

describe('useToolRun lifecycle', () => {
  it('a run abandoned by effects re-running (no unmount) is dropped quietly: no "Stopped", no "you left" toast', async () => {
    const m = mountRunning();
    expect(m.render().phase).toBe('running');
    h.runtime.rerunEffects();
    await flush();
    const after = m.render();
    expect(after.notice).toBeNull();
    expect(after.error).toBeNull();
    expect(after.phase).toBe('idle');
    expect(h.toasts).toEqual([]);
  });

  it('an abandoned run that ends while a newer run is going leaves the newer one running', async () => {
    const m = mountRunning();
    h.runtime.rerunEffects();
    // The abandoned run's result arrives a moment later; a new run has started in the meantime.
    m.render().start({ pages: 'all', format: 'png', dpi: 300 });
    await flush();
    const after = m.render();
    expect(after.phase).toBe('running');
    expect(after.progress).not.toBeNull();
  });

  it('leaving the screen mid-run says the run stopped and nothing was added', async () => {
    mountRunning();
    h.runtime.unmount();
    await flush();
    expect(h.toasts).toEqual(['PDF to images stopped when you left PDF Tools. Nothing was added.']);
  });

  it('a stop that keeps the dialog open says "Stopped. Nothing was added."', async () => {
    const m = mountRunning();
    m.render().stop(false);
    await flush();
    expect(m.render().notice?.title).toBe('Stopped. Nothing was added.');
    expect(h.toasts).toEqual([]);
  });

  it('a stop that closes the dialog closes it', async () => {
    const m = mountRunning();
    m.render().stop(true);
    await flush();
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a tool named inside a sentence', () => {
  it('lowers only a capitalised first word, so PDF stays PDF ("Stop PDF to images?")', async () => {
    const { toolNameInSentence } = await import('./useToolRun');
    expect(toolNameInSentence('pdf-to-images')).toBe('PDF to images');
    expect(toolNameInSentence('images-to-pdf')).toBe('images to PDF');
    expect(toolNameInSentence('merge')).toBe('merge');
    expect(toolNameInSentence('delete-pages')).toBe('delete pages');
    expect(toolNameInSentence('page-numbers')).toBe('page numbers');
  });
});
