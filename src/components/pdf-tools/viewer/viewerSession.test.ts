import { describe, expect, it, vi, type Mock } from 'vitest';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { openViewerSession, type SessionCanvas, type ViewerRendererApi } from './viewerSession';
import type { ViewRequest } from './viewerEngine';

const A4_INFO = { view: [0, 0, 595.28, 841.89] as [number, number, number, number], rotate: 0 as const, userUnit: 1, widthPt: 595.28, heightPt: 841.89 };

interface FakeBitmap {
  id: number;
  close: Mock<() => void>;
}

function fakeRenderer() {
  let nextSlot = 0;
  let nextBitmap = 0;
  const draws: { pageIndex: number; slot: unknown; signal: AbortSignal; resolve: () => FakeBitmap; reject: (e: unknown) => void }[] = [];
  const renderer: ViewerRendererApi<FakeBitmap> = {
    createSlot: vi.fn(() => ({ id: ++nextSlot })),
    pageInfo: vi.fn(async () => A4_INFO),
    drawPage: vi.fn(
      (_bytes: Uint8Array, pageIndex: number, _scale: number, _turn: number, options: { signal: AbortSignal; slot: unknown }) =>
        new Promise<{ bitmap: FakeBitmap; widthPx: number; heightPx: number }>((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
          draws.push({
            pageIndex,
            slot: options.slot,
            signal: options.signal,
            resolve: () => {
              const bitmap = { id: ++nextBitmap, close: vi.fn<() => void>() };
              resolve({ bitmap, widthPx: 1189, heightPx: 1681 });
              return bitmap;
            },
            reject,
          });
        }),
    ),
    releasePages: vi.fn(),
    releaseSlot: vi.fn(async () => undefined),
  };
  return { renderer, draws };
}

function fakeCanvas() {
  const drawImage = vi.fn();
  const canvas: SessionCanvas & { drawImage: typeof drawImage } = { width: 300, height: 150, getContext: () => ({ drawImage }), drawImage };
  return canvas;
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const view = (pageIndex: number): ViewRequest => ({ pageIndex, turn: 0, zoom: { kind: 'fit-width' }, frame: { width: 1189.6, height: 600 }, dpr: 1 });

function session(options: { bytes?: () => Uint8Array | null } = {}) {
  const { renderer, draws } = fakeRenderer();
  const canvas = fakeCanvas();
  const painted: unknown[] = [];
  const failed: unknown[] = [];
  const s = openViewerSession({
    fileId: 'f1',
    pageCount: 5,
    currentBytes: options.bytes ?? (() => new Uint8Array([1])),
    renderer,
    canvas: () => canvas,
    onInfo: () => undefined,
    onPainted: (drawn) => painted.push(drawn),
    onFailed: (pageIndex, error) => failed.push({ pageIndex, error }),
  });
  return { s, renderer, draws, canvas, painted, failed };
}

describe('a viewer session', () => {
  it('has a document slot of its own, used for every lookup and drawing', async () => {
    const { s, renderer, draws } = session();
    s.show(view(0));
    await settle();
    expect(renderer.createSlot).toHaveBeenCalledTimes(1);
    const slot = (renderer.createSlot as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(draws[0].slot).toBe(slot);
    expect((renderer.pageInfo as ReturnType<typeof vi.fn>).mock.calls[0][2].slot).toBe(slot);
    s.close();
  });

  it('paints a drawing into the canvas at its own size', async () => {
    const { s, draws, canvas, painted } = session();
    s.show(view(0));
    await settle();
    const bitmap = draws[0].resolve();
    await settle();
    expect([canvas.width, canvas.height]).toEqual([1189, 1681]);
    expect(canvas.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(painted).toEqual([expect.objectContaining({ pageIndex: 0, widthPx: 1189, heightPx: 1681 })]);
    s.close();
  });

  it('closing cancels every drawing, lets its document and parsed pages go, and empties the canvas', async () => {
    const { s, renderer, draws, canvas } = session();
    s.show(view(0));
    await settle();
    draws[0].resolve();
    await settle();
    // The pages either side are being drawn when the viewer closes.
    expect(draws.length).toBeGreaterThan(1);
    const slot = (renderer.createSlot as ReturnType<typeof vi.fn>).mock.results[0].value;
    s.close();
    expect(draws.slice(1).every((d) => d.signal.aborted)).toBe(true);
    expect(renderer.releaseSlot).toHaveBeenCalledTimes(1);
    expect(renderer.releaseSlot).toHaveBeenCalledWith(slot);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(s.closed).toBe(true);
    // Closing twice does nothing more.
    s.close();
    expect(renderer.releaseSlot).toHaveBeenCalledTimes(1);
  });

  it('closes the bitmaps it kept, once each', async () => {
    const { s, draws } = session();
    s.show(view(1));
    await settle();
    const made = [draws[0].resolve()];
    await settle();
    for (const d of draws.slice(1)) made.push(d.resolve());
    await settle();
    s.close();
    for (const bitmap of made) expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('two sessions open and close in either order without touching each other', async () => {
    const a = session();
    const b = session();
    a.s.show(view(0));
    b.s.show(view(0));
    await settle();
    b.s.close();
    expect(a.renderer.releaseSlot).not.toHaveBeenCalled();
    expect(a.draws[0].signal.aborted).toBe(false);
    a.s.close();
    expect(a.renderer.releaseSlot).toHaveBeenCalledTimes(1);
  });

  it('a low-memory retry empties the canvas and keeps no page parsed before drawing the one page again', async () => {
    const { s, renderer, draws, canvas, failed } = session();
    s.show(view(0));
    await settle();
    draws[0].reject(new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.'));
    await settle();
    expect(failed).toHaveLength(1);
    canvas.width = 1189;
    const before = draws.length;
    s.retry(true);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(renderer.releasePages).toHaveBeenLastCalledWith([], expect.anything());
    await settle();
    expect(draws.slice(before).map((d) => d.pageIndex)).toEqual([0]);
    s.close();
  });

  it('says when a drawing shows nothing, looks once per page, and Try again draws it afresh and looks again', async () => {
    const { renderer, draws } = fakeRenderer();
    const canvas = fakeCanvas();
    const painted: { pageIndex: number; blank: boolean }[] = [];
    let white = true;
    const sample = vi.fn(() => new Uint8ClampedArray(16).fill(white ? 255 : 0));
    const s = openViewerSession({
      fileId: 'f1',
      pageCount: 5,
      currentBytes: () => new Uint8Array([1]),
      renderer,
      canvas: () => canvas,
      sample,
      onInfo: () => undefined,
      onPainted: (p) => painted.push(p),
      onFailed: () => undefined,
    });
    s.show(view(0));
    await settle();
    draws[0].resolve();
    await settle();
    expect(painted.at(-1)).toMatchObject({ pageIndex: 0, blank: true });
    expect(sample).toHaveBeenCalledTimes(1);
    // The same page at another zoom is not looked at again.
    s.show({ ...view(0), zoom: { kind: 'percent', value: 2 } });
    await settle();
    await new Promise((r) => setTimeout(r, 200));
    await settle();
    const zoomed = draws.find((d) => d !== draws[0] && d.pageIndex === 0 && !d.signal.aborted);
    zoomed?.resolve();
    await settle();
    expect(sample).toHaveBeenCalledTimes(1);
    // Try again: drawn afresh and looked at again.
    white = false;
    const before = draws.length;
    s.retry(false, true);
    await settle();
    const fresh = draws.slice(before).filter((d) => d.pageIndex === 0);
    expect(fresh).toHaveLength(1);
    fresh[0].resolve();
    await settle();
    expect(sample).toHaveBeenCalledTimes(2);
    expect(painted.at(-1)).toMatchObject({ pageIndex: 0, blank: false });
    s.close();
  });

  it('draws nothing once the list has moved on (no bytes to read)', async () => {
    let live = true;
    const { s, renderer, failed } = session({ bytes: () => (live ? new Uint8Array([1]) : null) });
    live = false;
    s.show(view(0));
    await settle();
    expect(renderer.drawPage).not.toHaveBeenCalled();
    expect(failed).toEqual([]);
    s.close();
  });
});

describe("a viewer session's page text, for the search", () => {
  const TEXT = { items: [{ str: 'Cash', transform: [10, 0, 0, 10, 72, 700], width: 20, height: 10, fontName: 'f1', hasEOL: false }], styles: {} };

  it("reads a page's text through the session's own slot, cancellable", async () => {
    const { s, renderer } = session();
    const pageText = vi.fn(async (_bytes: Uint8Array, _pageIndex: number, _options: { signal: AbortSignal; slot: unknown }) => TEXT);
    renderer.pageText = pageText;
    const controller = new AbortController();
    await expect(s.readText(3, controller.signal)).resolves.toEqual(TEXT);
    const slot = (renderer.createSlot as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(pageText.mock.calls[0][1]).toBe(3);
    expect(pageText.mock.calls[0][2]).toEqual({ signal: controller.signal, slot });
    s.close();
  });

  it('reads nothing once the list has moved on or the session has closed', async () => {
    let live = true;
    const { s, renderer } = session({ bytes: () => (live ? new Uint8Array([1]) : null) });
    const pageText = vi.fn(async () => TEXT);
    renderer.pageText = pageText;
    live = false;
    await expect(s.readText(0, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
    live = true;
    s.close();
    await expect(s.readText(0, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(pageText).not.toHaveBeenCalled();
  });
});
