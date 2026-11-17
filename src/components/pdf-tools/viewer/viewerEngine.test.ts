import { describe, expect, it } from 'vitest';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { createViewerEngine, type Drawing, type EngineDeps, type PageInfo, type Painted, type ViewRequest } from './viewerEngine';
import { viewerKey } from './viewerCache';
import { renderPlan, RERENDER_DELAY_MS, type ViewRotation } from './viewerMath';

const A4: PageInfo = { geometry: { view: [0, 0, 595.28, 841.89], rotate: 0 }, widthPt: 595.28, heightPt: 841.89 };
const LANDSCAPE: PageInfo = { geometry: { view: [0, 0, 841.89, 595.28], rotate: 0 }, widthPt: 841.89, heightPt: 595.28 };
const FRAME = { width: 1220, height: 700 };

interface Bitmap {
  id: number;
  pageIndex: number;
  scale: number;
  turn: ViewRotation;
}

interface DrawCall {
  pageIndex: number;
  scale: number;
  turn: ViewRotation;
  signal: AbortSignal;
  ahead: boolean;
  resolve: () => Bitmap;
  reject: (error: unknown) => void;
}

function harness(options: { pageCount?: number; infoOf?: (pageIndex: number) => PageInfo; delayMs?: number } = {}) {
  const draws: DrawCall[] = [];
  const painted: Painted<Bitmap>[] = [];
  const failed: { pageIndex: number; error: unknown }[] = [];
  const released: Bitmap[] = [];
  const kept: number[][] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  let nextId = 0;
  const deps: EngineDeps<Bitmap> = {
    fileId: 'file-1',
    pageCount: options.pageCount ?? 10,
    info: async (pageIndex) => (options.infoOf ?? (() => A4))(pageIndex),
    draw: (pageIndex, scale, turn, signal, ahead) =>
      new Promise<Drawing<Bitmap>>((resolve, reject) => {
        const call: DrawCall = {
          pageIndex,
          scale,
          turn,
          signal,
          ahead,
          resolve: () => {
            const bitmap = { id: ++nextId, pageIndex, scale, turn };
            resolve({ bitmap, widthPx: 100, heightPx: 140 });
            return bitmap;
          },
          reject,
        };
        // A cancelled drawing rejects, as the render queue does.
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
        draws.push(call);
      }),
    release: (bitmap) => released.push(bitmap),
    onInfo: () => undefined,
    onPaint: (p) => painted.push(p),
    onFailed: (pageIndex, error) => failed.push({ pageIndex, error }),
    onKept: (pages) => kept.push(pages),
    delayMs: options.delayMs ?? RERENDER_DELAY_MS,
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (handle) => {
      (handle as { live: boolean }).live = false;
    },
  };
  const engine = createViewerEngine(deps);
  const flushTimers = async () => {
    for (const t of timers.splice(0)) if (t.live) t.fn();
    await settle();
  };
  const liveTimers = () => timers.filter((t) => t.live);
  return { engine, deps, draws, painted, failed, released, kept, flushTimers, liveTimers };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const view = (pageIndex: number, more: Partial<ViewRequest> = {}): ViewRequest => ({ pageIndex, turn: 0, zoom: { kind: 'fit-width' }, frame: FRAME, dpr: 1, ...more });
const fitWidthScale = renderPlan(595.28, 841.89, 1220 / 595.28, 1).scale;
const pending = (draws: DrawCall[]) => draws.filter((d) => !d.signal.aborted);

describe('viewer engine: what is drawn and when', () => {
  it('draws the current page first at zoom x pixel ratio, then the pages either side, next one first', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    expect(h.draws.map((d) => d.pageIndex)).toEqual([4]);
    expect(h.draws[0].scale).toBeCloseTo(fitWidthScale, 9);
    expect(h.draws[0].turn).toBe(0);
    h.draws[0].resolve();
    await settle();
    expect(h.painted.map((p) => p.pageIndex)).toEqual([4]);
    expect(h.painted[0].key).toBe(viewerKey('file-1', 4, fitWidthScale, 0));
    expect(h.draws.map((d) => d.pageIndex)).toEqual([4, 5, 3]);
    // Only the page shown keeps what pdf.js read of it; the pages either side are drawn ahead.
    expect(h.draws.map((d) => d.ahead)).toEqual([false, true, true]);
  });

  it('a page at the end of the file has one neighbour', async () => {
    const h = harness({ pageCount: 3 });
    h.engine.show(view(2));
    await settle();
    h.draws[0].resolve();
    await settle();
    expect(h.draws.map((d) => d.pageIndex)).toEqual([2, 1]);
  });

  it('fit width uses each page its own size', async () => {
    const h = harness({ infoOf: (i) => (i === 5 ? LANDSCAPE : A4) });
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    const next = h.draws.find((d) => d.pageIndex === 5)!;
    expect(next.scale).toBeCloseTo(renderPlan(841.89, 595.28, 1220 / 841.89, 1).scale, 9);
  });

  it('a new zoom is drawn 150 ms after the last change, once', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    const before = h.draws.length;
    h.engine.show(view(4, { zoom: { kind: 'percent', value: 1.25 } }));
    await settle();
    h.engine.show(view(4, { zoom: { kind: 'percent', value: 1.5 } }));
    await settle();
    expect(h.draws.length).toBe(before);
    expect(h.liveTimers().map((t) => t.ms)).toEqual([150]);
    await h.flushTimers();
    const fresh = h.draws.slice(before);
    // 150% is 1.5 x 96/72 = 2 CSS pixels per point; at pixel ratio 1, a drawing scale of 2.
    expect(fresh.map((d) => d.pageIndex)).toEqual([4]);
    expect(fresh[0].scale).toBeCloseTo(2, 9);
    // The neighbours' drawings at the old zoom are no longer wanted.
    expect(h.draws.slice(1, before).every((d) => d.signal.aborted)).toBe(true);
  });

  it('a page change draws at once when the page shown is drawn, and cancels drawings of pages no longer near', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    h.engine.show(view(8));
    await settle();
    // The pages either side of 4, still being drawn, are cancelled.
    expect(h.draws.slice(1, 3).map((d) => d.signal.aborted)).toEqual([true, true]);
    expect(pending(h.draws.slice(3)).map((d) => d.pageIndex)).toEqual([8]);
    expect(h.liveTimers()).toEqual([]);
  });

  it('page changes while a page is still being drawn wait 150 ms: a burst draws only the last page', async () => {
    // A scan: cancelling a drawing does not stop pdf.js decoding it, so starting each page of a
    // burst would back the worker up for seconds (spike-viewer 4.3).
    const h = harness();
    h.engine.show(view(0));
    await settle();
    for (const page of [1, 2, 3, 4, 5]) {
      h.engine.show(view(page));
      await settle();
    }
    expect(h.draws.map((d) => d.pageIndex)).toEqual([0]);
    expect(h.draws[0].signal.aborted).toBe(true);
    await h.flushTimers();
    expect(h.draws.map((d) => d.pageIndex)).toEqual([0, 5]);
  });

  it('the pages either side are asked for only after the page shown is painted', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    await settle();
    expect(h.draws.map((d) => d.pageIndex)).toEqual([4]);
  });

  it('turning the view draws again at once, with the turn', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    h.engine.show(view(4, { turn: 90 }));
    await settle();
    const turned = pending(h.draws).filter((d) => d.turn === 90);
    expect(turned.map((d) => d.pageIndex)).toEqual([4]);
    // A quarter turn: fit width now fits the page's height across the frame.
    expect(turned[0].scale).toBeCloseTo(renderPlan(841.89, 595.28, 1220 / 841.89, 1).scale, 9);
    expect(h.draws.filter((d) => d.turn === 0 && d.pageIndex !== 4).every((d) => d.signal.aborted)).toBe(true);
  });
});

describe('viewer engine: kept drawings', () => {
  it('the next page uses the drawing already under way for it', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    const drawsBefore = h.draws.length;
    h.engine.show(view(5));
    await settle();
    expect(h.draws.length).toBe(drawsBefore);
    const next = h.draws.find((d) => d.pageIndex === 5)!;
    expect(next.signal.aborted).toBe(false);
    next.resolve();
    await settle();
    expect(h.painted.map((p) => p.pageIndex)).toEqual([4, 5]);
  });

  it('a page drawn before is shown again without drawing it again', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    for (const d of h.draws.slice(1)) d.resolve();
    await settle();
    const drawsBefore = h.draws.length;
    h.engine.show(view(5));
    expect(h.painted.map((p) => p.pageIndex)).toEqual([4, 5]);
    await settle();
    // Only page 6 is new; 4 is kept as the previous page.
    expect(h.draws.slice(drawsBefore).map((d) => d.pageIndex)).toEqual([6]);
    const page3 = h.released.filter((b) => b.pageIndex === 3);
    expect(page3).toHaveLength(1);
    // The renderer is told which pages to keep parsed: those of the kept drawings.
    expect(h.kept.at(-1)).toEqual([4, 5, 6]);
  });

  it('keeps at most three drawings and releases every other one exactly once', async () => {
    const h = harness({ pageCount: 12 });
    const made: Bitmap[] = [];
    for (let p = 0; p < 10; p++) {
      h.engine.show(view(p));
      await settle();
      for (const d of pending(h.draws)) {
        if (!(d as { done?: boolean }).done) {
          (d as { done?: boolean }).done = true;
          made.push(d.resolve());
        }
      }
      await settle();
      for (const d of pending(h.draws)) {
        if (!(d as { done?: boolean }).done) {
          (d as { done?: boolean }).done = true;
          made.push(d.resolve());
        }
      }
      await settle();
      expect(h.engine.cachedKeys.length).toBeLessThanOrEqual(3);
    }
    const kept = h.engine.cachedKeys.length;
    expect(h.released.length).toBe(made.length - kept);
    h.engine.close();
    expect(h.released.length).toBe(made.length);
    expect(new Set(h.released.map((b) => b.id)).size).toBe(made.length);
  });
});

describe('viewer engine: closing and failures', () => {
  it('closing cancels drawings and releases everything; a late drawing is released, not shown', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    const neighbour = h.draws[1];
    h.engine.close();
    // The drawings still under way (the pages either side) are cancelled.
    expect(h.draws.slice(1).map((d) => d.signal.aborted)).toEqual([true, true]);
    expect(h.released.map((b) => b.pageIndex)).toEqual([4]);
    // The fake draw already rejected on abort; a drawing that still arrives (the queue would hand it
    // to its dispose) is never shown.
    neighbour.resolve();
    await settle();
    expect(h.painted.map((p) => p.pageIndex)).toEqual([4]);
    expect(h.engine.cachedKeys).toEqual([]);
    // Nothing happens after close.
    h.engine.show(view(6));
    await settle();
    expect(h.draws.filter((d) => d.pageIndex === 6)).toEqual([]);
  });

  it('a pending zoom is dropped on close', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    const before = h.draws.length;
    h.engine.show(view(4, { zoom: { kind: 'percent', value: 2 } }));
    await settle();
    h.engine.close();
    await h.flushTimers();
    expect(h.draws.length).toBe(before);
  });

  it("the current page's failure is reported; a neighbour's is not", async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    h.draws[1].reject(new Error('neighbour broke'));
    await settle();
    expect(h.failed).toEqual([]);
    h.engine.show(view(8));
    await settle();
    const eight = pending(h.draws).find((d) => d.pageIndex === 8)!;
    const error = new Error('page broke');
    eight.reject(error);
    await settle();
    expect(h.failed).toEqual([{ pageIndex: 8, error }]);
  });

  it("a page whose size cannot be read is reported, and does not make the next page wait", async () => {
    const h = harness({ infoOf: (i) => {
      if (i === 4) throw new Error('no page');
      return A4;
    } });
    h.engine.show(view(4));
    await settle();
    expect(h.failed.map((f) => f.pageIndex)).toEqual([4]);
    h.engine.show(view(6));
    await settle();
    expect(h.liveTimers()).toEqual([]);
    expect(pending(h.draws).map((d) => d.pageIndex)).toEqual([6]);
  });

  it('a low-memory retry lets every kept drawing go, keeps no page parsed and draws only the page shown from then on', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    const first = h.draws[0].resolve();
    await settle();
    const neighbours = h.draws.slice(1).map((d) => d.resolve());
    await settle();
    expect(h.engine.cachedKeys).toHaveLength(3);
    // A zoom whose drawing runs out of memory.
    h.engine.show(view(4, { zoom: { kind: 'percent', value: 4 } }));
    await h.flushTimers();
    const big = pending(h.draws).find((d) => d.scale > 5)!;
    big.reject(new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.'));
    await settle();
    expect(h.failed.map((f) => f.pageIndex)).toEqual([4]);
    const before = h.draws.length;
    h.engine.retry({ lowMemory: true });
    // Everything kept is released at once, each exactly once, and the renderer is told to keep no page.
    for (const bitmap of [first, ...neighbours]) expect(h.released.filter((b) => b.id === bitmap.id)).toHaveLength(1);
    expect(h.engine.cachedKeys).toEqual([]);
    expect(h.kept.at(-1)).toEqual([]);
    await settle();
    const again = h.draws.slice(before);
    expect(again.map((d) => d.pageIndex)).toEqual([4]);
    again[0].resolve();
    await settle();
    // No page either side is asked for, now or on the next page.
    expect(h.draws.slice(before).map((d) => d.pageIndex)).toEqual([4]);
    h.engine.show(view(5, { zoom: { kind: 'percent', value: 4 } }));
    await settle();
    await h.flushTimers();
    expect(pending(h.draws.slice(before + 1)).map((d) => d.pageIndex)).toEqual([5]);
  });

  it('Try again on a page drawn blank draws it afresh, not from the drawing kept', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    const shown = h.draws[0].resolve();
    await settle();
    for (const d of h.draws.slice(1)) d.resolve();
    await settle();
    const before = h.draws.length;
    h.engine.retry({ redraw: true });
    // The kept drawing of the page shown is let go, once; the pages either side stay.
    expect(h.released.filter((b) => b.id === shown.id)).toHaveLength(1);
    expect(h.released).toHaveLength(1);
    await settle();
    expect(h.draws.slice(before).map((d) => d.pageIndex)).toEqual([4]);
    h.draws[before].resolve();
    await settle();
    expect(h.painted.at(-1)?.pageIndex).toBe(4);
    expect(h.painted.at(-1)?.drawing.bitmap.id).not.toBe(shown.id);
  });

  it('a cancelled drawing is not a failure', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.engine.show(view(9));
    await settle();
    expect(h.failed).toEqual([]);
  });

  it('retry draws the current page again after a failure', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].reject(new Error('broke'));
    await settle();
    expect(h.failed).toHaveLength(1);
    h.engine.retry();
    await settle();
    expect(h.draws.slice(1).map((d) => d.pageIndex)).toEqual([4]);
  });

  it('a drawing finished after the zoom moved on is not shown as the current page', async () => {
    const h = harness();
    h.engine.show(view(4));
    await settle();
    h.draws[0].resolve();
    await settle();
    h.engine.show(view(4, { zoom: { kind: 'percent', value: 3 } }));
    await h.flushTimers();
    const atThree = pending(h.draws).find((d) => Math.abs(d.scale - 4) < 1e-9)!;
    h.engine.show(view(4, { zoom: { kind: 'percent', value: 0.5 } }));
    await settle();
    // The 300% drawing is cancelled by the new zoom once its delay has passed.
    await h.flushTimers();
    expect(atThree.signal.aborted).toBe(true);
    const atHalf = pending(h.draws).find((d) => Math.abs(d.scale - 2 / 3) < 1e-9)!;
    atHalf.resolve();
    await settle();
    expect(h.painted.map((p) => p.scale)).toHaveLength(2);
    expect(h.painted[0].scale).toBeCloseTo(fitWidthScale, 9);
    expect(h.painted[1].scale).toBeCloseTo(2 / 3, 9);
  });
});
