import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Each test imports the renderer afresh; on a loaded machine the first imports took over 5 s, and a
// test that ran out of time went on drawing into the next one's mocks.
vi.setConfig({ testTimeout: 30_000 });

// The first import transforms the renderer's modules (6.6 s in WRAP's loaded survey): paid once here,
// outside any test's limit. A hang guard only.
beforeAll(async () => {
  await import('./pdfRenderer');
}, 120_000);

/** Waits (by condition, not by a fixed sleep) until `started` is true: a mocked drawing or read has begun. */
const until = (started: () => boolean) =>
  vi.waitFor(
    () => {
      if (!started()) throw new Error('not started yet');
    },
    { timeout: 20_000, interval: 2 },
  );

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  VerbosityLevel: { ERRORS: 0 },
  PDFWorker: { create: vi.fn(() => ({ destroyed: false, destroy: vi.fn() })) },
  getDocument: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('how a failed open is labelled', () => {
  it('a time limit, a restart and running out of memory are not "damaged"', async () => {
    const { openFailure, openTimeoutError, OPEN_TIMEOUT, RENDERER_RESTARTED } = await import('./pdfRenderer');
    expect(openTimeoutError()).toMatchObject({ code: OPEN_TIMEOUT });
    expect(openFailure(new Error('The page renderer was restarted.'), true)).toMatchObject({ code: RENDERER_RESTARTED });
    expect(openFailure(new RangeError('Array buffer allocation failed'), false)).toMatchObject({ code: 'out-of-memory' });
    // A genuine parse failure keeps its code (the file may be damaged).
    expect(openFailure(new Error('Invalid PDF structure.'), false)).toMatchObject({ code: 'render-failed', message: 'This file could not be opened for preview.' });
    const unavailable = new (await import('@/lib/pdf-tools/types')).PdfToolsError('render-unavailable', 'x');
    expect(openFailure(unavailable, true)).toBe(unavailable);
  });
});

describe('how a failed page drawing is labelled', () => {
  it('a renderer restart while the page was drawn says so; memory and the page\'s own errors keep theirs', async () => {
    const { pageFailure, RENDERER_RESTARTED } = await import('./pdfRenderer');
    const { abortError } = await import('./renderQueue');
    const { PdfToolsError } = await import('@/lib/pdf-tools/types');
    // The worker was dropped while this page was being drawn (pdf.js only says its worker went away).
    expect(pageFailure(new Error('Worker was destroyed'), true)).toMatchObject({ code: RENDERER_RESTARTED });
    // No restart: the raw error is left for the caller, except memory running out.
    const raw = new Error('Something in the page');
    expect(pageFailure(raw, false)).toBe(raw);
    expect(pageFailure(new RangeError('Array buffer allocation failed'), false)).toMatchObject({ code: 'out-of-memory' });
    // A cancel stays a cancel, and the renderer's own labels stay, even across a restart.
    const cancelled = abortError();
    expect(pageFailure(cancelled, true)).toBe(cancelled);
    const noPage = new PdfToolsError('render-failed', 'This file has no page 9.');
    expect(pageFailure(noPage, true)).toBe(noPage);
  });
});

// The page viewer's renders: a fresh renderer whose queue records each job's priority, on stand-in
// pdf.js documents (one per file, told apart by their first byte), pages, worker and canvases
// (Node has none of them).
async function viewerRenderer(page: { rotate: number; view: number[]; userUnit?: number; [more: string]: unknown }) {
  vi.resetModules();
  const scheduled: { priority?: string; dispose?: (value: unknown) => void }[] = [];
  vi.doMock('./renderQueue', async (importOriginal) => {
    const real = await importOriginal<typeof import('./renderQueue')>();
    return {
      ...real,
      createRenderQueue: (options: Parameters<typeof real.createRenderQueue>[0]) => {
        const queue = real.createRenderQueue(options);
        return {
          schedule: (run: Parameters<typeof queue.schedule>[0], opts: Parameters<typeof queue.schedule>[1] = {}) => {
            scheduled.push({ priority: opts.priority, dispose: opts.dispose as (value: unknown) => void });
            return queue.schedule(run, opts);
          },
          get pending() {
            return queue.pending;
          },
          get busy() {
            return queue.busy;
          },
        };
      },
    };
  });
  const getViewport = vi.fn(({ scale, rotation }: { scale: number; rotation: number }) => {
    const [x0, y0, x1, y1] = page.view;
    const unit = page.userUnit ?? 1;
    const w = (x1 - x0) * scale * unit;
    const h = (y1 - y0) * scale * unit;
    const quarter = rotation % 180 === 90;
    // The transform only for rotation 0 (all the tests below ask for).
    const transform = [scale * unit, 0, 0, -scale * unit, 0 - x0 * scale * unit, y1 * scale * unit];
    return { width: quarter ? h : w, height: quarter ? w : h, rotation, scale, transform };
  });
  const render = vi.fn((_params: Record<string, unknown>) => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  // Pages by file and index, each with its own cleanup.
  const pages = new Map<string, { cleanup: ReturnType<typeof vi.fn> }>();
  const pageOf = (file: number, index: number) => {
    const key = `${file}:${index}`;
    if (!pages.has(key)) pages.set(key, { ...page, userUnit: page.userUnit ?? 1, getViewport, render, cleanup: vi.fn() } as never);
    return pages.get(key)!;
  };
  const opens: { file: number; destroy: ReturnType<typeof vi.fn>; params: Record<string, unknown> }[] = [];
  const pdfjs = (await import('pdfjs-dist')) as unknown as { getDocument: ReturnType<typeof vi.fn> };
  pdfjs.getDocument.mockImplementation((params: { data: Uint8Array }) => {
    const file = params.data[0];
    const destroy = vi.fn(async () => undefined);
    opens.push({ file, destroy, params });
    return { promise: Promise.resolve({ numPages: 9, getPage: vi.fn(async (n: number) => pageOf(file, n - 1)) }), destroy };
  });
  const contexts: { options?: unknown; getImageData: ReturnType<typeof vi.fn> }[] = [];
  const canvases: { width: number; height: number }[] = [];
  const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('document', {
    baseURI: 'file:///app/index.html',
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext(_kind: string, options?: unknown) {
          const context = {
            options,
            canvas,
            // White, as a page drawn on white; a copy taken at the time of reading.
            getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h })),
          };
          contexts.push(context);
          return context;
        },
        toBlob(done: (blob: Blob) => void) {
          done(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  vi.stubGlobal(
    'Worker',
    class {
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    },
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: { width: number; height: number }) => {
      const bitmap = { width: source.width, height: source.height, close: vi.fn() };
      bitmaps.push(bitmap);
      return bitmap;
    }),
  );
  const renderer = await import('./pdfRenderer');
  return { renderer, scheduled, getViewport, render, pageOf, opens, contexts, canvases, bitmaps };
}

describe('page viewer renders', () => {
  afterEach(() => {
    vi.doUnmock('./renderQueue');
    vi.resetModules();
  });

  it("renderViewerPage schedules with priority 'view' and passes the rotation to getViewport", async () => {
    const { renderer, scheduled, getViewport, canvases, bitmaps } = await viewerRenderer({ rotate: 90, view: [0, 0, 600, 800] });
    const drawn = await renderer.renderViewerPage(new Uint8Array([1, 2, 3]), 2, 2, 90);
    expect(scheduled.map((s) => s.priority)).toEqual(['view']);
    // The view turn is added to the page's own /Rotate: 90 + 90.
    expect(getViewport).toHaveBeenCalledWith(expect.objectContaining({ scale: 2, rotation: 180 }));
    expect(drawn).toMatchObject({ widthPx: 1200, heightPx: 1600, pageWidthPt: 800, pageHeightPt: 600, rotate: 90, view: [0, 0, 600, 800] });
    expect(drawn.bitmap).toBe(bitmaps[0]);
    // The canvas it was drawn on is emptied once the picture has been taken from it.
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    // A drawing that arrives after it was cancelled is closed by the queue's dispose.
    scheduled[0].dispose?.(drawn);
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    await renderer.releaseViewerDocument();
    renderer.releasePdfRenderer();
  });

  it('renderViewerPage draws into its own { alpha: false } context, not one pdf.js makes', async () => {
    const { renderer, render, contexts } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800] });
    await renderer.renderViewerPage(new Uint8Array([1]), 0, 1, 0);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].options).toEqual({ alpha: false });
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ canvas: null, canvasContext: contexts[0] }));
    await renderer.releaseViewerDocument();
    renderer.releasePdfRenderer();
  });

  it("viewerPageInfo schedules with priority 'view' and gives the visible box, own turn and size", async () => {
    const { renderer, scheduled, render } = await viewerRenderer({ rotate: 270, view: [10, 20, 622, 812], userUnit: 2 });
    const info = await renderer.viewerPageInfo(new Uint8Array([1, 2, 3]), 0);
    expect(scheduled.map((s) => s.priority)).toEqual(['view']);
    expect(info).toEqual({ view: [10, 20, 622, 812], rotate: 270, userUnit: 2, widthPt: 792 * 2, heightPt: 612 * 2 });
    expect(render).not.toHaveBeenCalled();
    await renderer.releaseViewerDocument();
    renderer.releasePdfRenderer();
  });

  it('pages the viewer drew keep what pdf.js read of them until the viewer lets them go', async () => {
    const { renderer, pageOf } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800] });
    const bytes = new Uint8Array([7]);
    for (const index of [4, 5, 6]) await renderer.renderViewerPage(bytes, index, 1, 0);
    // Kept, so that the next zoom of a scan does not decode its picture again.
    for (const index of [4, 5, 6]) expect(pageOf(7, index).cleanup).not.toHaveBeenCalled();
    // Asking for a kept page's size does not clean it up; another page's size does.
    await renderer.viewerPageInfo(bytes, 5);
    await renderer.viewerPageInfo(bytes, 8);
    expect(pageOf(7, 5).cleanup).not.toHaveBeenCalled();
    expect(pageOf(7, 8).cleanup).toHaveBeenCalledTimes(1);
    // The pages that left the viewer's kept drawings are cleaned up, once.
    renderer.releaseViewerPages([5]);
    expect(pageOf(7, 4).cleanup).toHaveBeenCalledTimes(1);
    expect(pageOf(7, 6).cleanup).toHaveBeenCalledTimes(1);
    expect(pageOf(7, 5).cleanup).not.toHaveBeenCalled();
    renderer.releaseViewerPages([5]);
    expect(pageOf(7, 4).cleanup).toHaveBeenCalledTimes(1);
    // Letting the document go cleans the rest and destroys it.
    await renderer.releaseViewerDocument();
    expect(pageOf(7, 5).cleanup).toHaveBeenCalledTimes(1);
    renderer.releasePdfRenderer();
  });

  it('a drawing that finishes after the viewer let its document go keeps nothing of it', async () => {
    // Found in the application: a page drawn ahead was still drawing when an engagement change closed
    // the viewer; it then kept its page, and with it the destroyed document, until the next viewer.
    const { renderer, render, pageOf } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800] });
    let finish!: () => void;
    render.mockImplementationOnce(() => ({ promise: new Promise<void>((resolve) => (finish = resolve)), cancel: vi.fn() }));
    const drawing = renderer.renderViewerPage(new Uint8Array([3]), 1, 1, 0);
    await until(() => finish !== undefined); // the page has started drawing
    await renderer.releaseViewerDocument();
    finish();
    const drawn = await drawing;
    drawn.bitmap.close();
    // Not kept: cleaned up at once.
    expect(pageOf(3, 1).cleanup).toHaveBeenCalledTimes(1);
    renderer.releaseViewerPages([]);
    expect(pageOf(3, 1).cleanup).toHaveBeenCalledTimes(1);
    renderer.releasePdfRenderer();
  });

  for (const order of [['a', 'b'], ['b', 'a']] as const) {
    it(`two viewer slots hold two files at once; closing them ${order.join(' then ')} lets each go alone`, async () => {
      // Two viewer surfaces at once (the Redact review and a viewer opened from it): each its own slot.
      const { renderer, opens, pageOf } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800] });
      const slots = { a: renderer.createViewerSlot(), b: renderer.createViewerSlot() };
      const files = { a: new Uint8Array([11]), b: new Uint8Array([12]) };
      await renderer.renderViewerPage(files.a, 0, 1, 0, { slot: slots.a });
      await renderer.renderViewerPage(files.b, 0, 1, 0, { slot: slots.b });
      await renderer.renderViewerPage(files.a, 1, 1, 0, { slot: slots.a });
      await renderer.viewerPageInfo(files.b, 1, { slot: slots.b });
      expect(opens.map((o) => o.file)).toEqual([11, 12]);
      const doc = { a: opens[0], b: opens[1] };
      const [first, second] = order;
      await renderer.releaseViewerDocument(slots[first]);
      expect(doc[first].destroy).toHaveBeenCalledTimes(1);
      expect(doc[second].destroy).not.toHaveBeenCalled();
      // The other slot still draws from its own open document, and keeps its own pages parsed.
      expect(pageOf(files[second][0], 0).cleanup).not.toHaveBeenCalled();
      await renderer.renderViewerPage(files[second], 2, 1, 0, { slot: slots[second] });
      expect(opens).toHaveLength(2);
      await renderer.releaseViewerDocument(slots[second]);
      expect(doc[second].destroy).toHaveBeenCalledTimes(1);
      expect(pageOf(files[second][0], 0).cleanup).toHaveBeenCalledTimes(1);
      renderer.releasePdfRenderer();
    });
  }

  it("the viewer's document has its own slot: a run on another file neither reopens it nor closes it", async () => {
    const { renderer, opens } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800] });
    const viewed = new Uint8Array([1]);
    const other = new Uint8Array([2]);
    await renderer.renderViewerPage(viewed, 0, 1, 0);
    // A tool run's pages and thumbnails of another file, in between viewer drawings.
    await renderer.renderPage(other, 0, 100, 'png', { priority: 'run' });
    await renderer.renderViewerPage(viewed, 1, 1, 0);
    await renderer.renderPage(other, 1, 100, 'png', { priority: 'run' });
    await renderer.renderViewerPage(viewed, 0, 2, 0);
    expect(opens.map((o) => o.file)).toEqual([1, 2]);
    expect(opens[0].destroy).not.toHaveBeenCalled();
    // Both keep pdf.js's own JPEG decoder: the browser's decoder was pixel-equivalent and fast in a
    // bare trial page but made a 300 dpi scan's first page 10.5 s instead of 2.3 s in the
    // application (Task A1 report, decoder trial).
    expect(opens[0].params.isImageDecoderSupported).toBeUndefined();
    expect(opens[1].params.isImageDecoderSupported).toBeUndefined();
    // The shared slot opening the viewed file (its thumbnails) does not touch the viewer's.
    await renderer.renderPage(viewed, 0, 100, 'png', { priority: 'run' });
    expect(opens.map((o) => o.file)).toEqual([1, 2, 1]);
    expect(opens[1].destroy).toHaveBeenCalledTimes(1);
    expect(opens[0].destroy).not.toHaveBeenCalled();
    // Closing the viewer lets its document go.
    await renderer.releaseViewerDocument();
    expect(opens[0].destroy).toHaveBeenCalledTimes(1);
    renderer.releasePdfRenderer();
  });
});

describe('pdfRenderer', () => {
  it('reports previews as unavailable when the worker cannot be created', async () => {
    vi.stubGlobal('document', { baseURI: 'file:///app/index.html' });
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Workers are blocked here');
        }
      },
    );
    const { renderThumbnail, RENDER_UNAVAILABLE } = await import('./pdfRenderer');
    await expect(renderThumbnail(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 0, 100)).rejects.toMatchObject({
      name: 'PdfToolsError',
      code: RENDER_UNAVAILABLE,
      message: 'Page previews could not be started. Restart the application and try again.',
    });
  });
});

// What the Redact run reads of a page (its find and its picture check): on the shared slot, as a
// tool run's ('run') unless asked otherwise, cancellable, failures labelled as renderPage's, and
// nothing kept afterwards.
describe('page reads for Redact', () => {
  afterEach(() => {
    vi.doUnmock('./renderQueue');
    vi.resetModules();
  });

  it('pageTextContent gives the text items that have a string, and their styles; the page is cleaned up', async () => {
    const getTextContent = vi.fn(async () => ({
      items: [
        { str: 'Invoice', dir: 'ltr', transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10, fontName: 'g_d0_f1', hasEOL: false },
        { type: 'beginMarkedContent', id: 'mc0' },
        { str: '', dir: 'ltr', transform: [10, 0, 0, 10, 112, 700], width: 0, height: 10, fontName: 'g_d0_f1', hasEOL: true },
        { type: 'endMarkedContent' },
      ],
      styles: { g_d0_f1: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } },
      lang: null,
    }));
    const { renderer, scheduled, pageOf, opens, render } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800], getTextContent });
    const text = await renderer.pageTextContent(new Uint8Array([5]), 2);
    expect(getTextContent).toHaveBeenCalledTimes(1);
    expect(getTextContent.mock.calls[0]).toEqual([]);
    expect(text.items).toEqual([
      { str: 'Invoice', transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10, fontName: 'g_d0_f1', hasEOL: false },
      { str: '', transform: [10, 0, 0, 10, 112, 700], width: 0, height: 10, fontName: 'g_d0_f1', hasEOL: true },
    ]);
    expect(text.styles).toEqual({ g_d0_f1: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } });
    expect(scheduled.map((j) => j.priority)).toEqual(['run']);
    expect(pageOf(5, 2).cleanup).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    // The shared slot: the viewer's is not opened.
    expect(opens).toHaveLength(1);
    await renderer.pageTextContent(new Uint8Array([5]), 3, { priority: 'high' });
    expect(scheduled.map((j) => j.priority)).toEqual(['run', 'high']);
    renderer.releasePdfRenderer();
  });

  it('pageGeometries reads every page in order in one job, without drawing or reading text', async () => {
    const getTextContent = vi.fn();
    const getAnnotations = vi.fn();
    const { renderer, scheduled, pageOf, render } = await viewerRenderer({ rotate: 90, view: [0, 0, 612, 792], userUnit: 2, getTextContent, getAnnotations });
    const geometries = await renderer.pageGeometries(new Uint8Array([6]));
    expect(geometries).toHaveLength(9);
    expect(geometries[0]).toEqual({ view: [0, 0, 612, 792], rotate: 90, userUnit: 2 });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].priority).toBe('run');
    for (let i = 0; i < 9; i++) expect(pageOf(6, i).cleanup).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect(getTextContent).not.toHaveBeenCalled();
    expect(getAnnotations).not.toHaveBeenCalled();
    renderer.releasePdfRenderer();
  });

  it('pageAnnotationTexts gives each annotation its kind, box, flags and every string a reader can see', async () => {
    const getAnnotations = vi.fn(async () => [
      {
        subtype: 'Text',
        rect: [10, 20, 30, 40],
        annotationFlags: 4,
        contentsObj: { str: 'Client: Rao & Co' },
        titleObj: { str: 'Auditor' },
      },
      { subtype: 'FreeText', rect: [0, 0, 1, 1], textContent: ['PAN ABCDE1234F', ''], contentsObj: { str: '' } },
      { subtype: 'Widget', rect: [1, 2, 3, 4], fieldValue: ['Rao', 'Iyer'], alternativeText: 'Partner name' },
      {
        subtype: 'Widget',
        rect: [5, 6, 7, 8],
        fieldValue: 'IN',
        options: [
          { displayValue: 'India', exportValue: 'IN' },
          { displayValue: 'Nepal', exportValue: 'NP' },
        ],
      },
      { subtype: 'Link', rect: [9, 9, 9, 9], url: 'https://example.test/a', unsafeUrl: 'https://example.test/a?b' },
      { subtype: 'Popup' },
    ]);
    const { renderer, scheduled, pageOf } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800], getAnnotations });
    const annotations = await renderer.pageAnnotationTexts(new Uint8Array([7]), 1);
    expect(getAnnotations).toHaveBeenCalledWith({ intent: 'display' });
    expect(annotations).toEqual([
      { subtype: 'Text', rect: [10, 20, 30, 40], flags: 4, texts: ['Client: Rao & Co', 'Auditor'] },
      { subtype: 'FreeText', rect: [0, 0, 1, 1], flags: 0, texts: ['PAN ABCDE1234F'] },
      { subtype: 'Widget', rect: [1, 2, 3, 4], flags: 0, texts: ['Rao', 'Iyer', 'Partner name'] },
      { subtype: 'Widget', rect: [5, 6, 7, 8], flags: 0, texts: ['IN', 'India', 'IN', 'Nepal', 'NP'] },
      { subtype: 'Link', rect: [9, 9, 9, 9], flags: 0, texts: ['https://example.test/a', 'https://example.test/a?b'] },
      { subtype: 'Popup', rect: [0, 0, 0, 0], flags: 0, texts: [] },
    ]);
    expect(scheduled.map((j) => j.priority)).toEqual(['run']);
    expect(pageOf(7, 1).cleanup).toHaveBeenCalledTimes(1);
    renderer.releasePdfRenderer();
  });

  it("renderPagePixels draws the page unturned on white and gives its pixels; the canvas is let go first", async () => {
    // /Rotate 90 is not applied: the picture is in the page's own (unturned) axes.
    const { renderer, scheduled, getViewport, render, canvases, contexts, pageOf } = await viewerRenderer({ rotate: 90, view: [0, 0, 600, 800] });
    const drawn = await renderer.renderPagePixels(new Uint8Array([8]), 0, 2.0001);
    expect(getViewport).toHaveBeenCalledWith({ scale: 2.0001, rotation: 0 });
    expect(drawn.width).toBe(1200);
    expect(drawn.height).toBe(1600);
    expect(drawn.scale).toBe(2.0001);
    expect(drawn.view).toEqual([0, 0, 600, 800]);
    expect(drawn.userUnit).toBe(1);
    expect(drawn.transform).toEqual([2.0001, 0, 0, -2.0001, 0, 800 * 2.0001]);
    expect(drawn.data).toHaveLength(1200 * 1600 * 4);
    const params = render.mock.calls[0][0];
    expect(params.background).toBe('rgb(255,255,255)');
    expect(params.intent ?? 'display').toBe('display');
    // Default annotation mode: appearances and form fields drawn as on screen.
    expect(params.annotationMode).toBeUndefined();
    // Read from a context made for reading back, and the canvas emptied before the result.
    expect(contexts[0].options).toEqual({ willReadFrequently: true });
    expect(contexts[0].getImageData).toHaveBeenCalledWith(0, 0, 1200, 1600);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(scheduled.map((j) => j.priority)).toEqual(['run']);
    expect(pageOf(8, 0).cleanup).toHaveBeenCalledTimes(1);
    renderer.releasePdfRenderer();
  });

  it('renderPagePixels holds the scale within the canvas limits and says which it used', async () => {
    const { renderer } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800] });
    // 30 x 800 = 24,000 px: held within 8,192 px a side and 50 megapixels (here the area decides).
    const drawn = await renderer.renderPagePixels(new Uint8Array([8]), 0, 30);
    expect(drawn.scale).toBeCloseTo(Math.sqrt(50_000_000 / (600 * 800)), 9);
    expect(drawn.height).toBe(Math.floor(800 * drawn.scale));
    expect(drawn.height).toBeLessThanOrEqual(8192);
    expect(drawn.width * drawn.height).toBeLessThanOrEqual(50_000_000);
    renderer.releasePdfRenderer();
  });

  it('a read cancelled before it starts is rejected as cancelled, and memory running out is labelled', async () => {
    const getTextContent = vi.fn(async () => {
      throw new RangeError('Array buffer allocation failed');
    });
    const { renderer } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800], getTextContent });
    const { isAbortError } = await import('./renderQueue');
    await expect(renderer.pageGeometries(new Uint8Array([9]), { signal: AbortSignal.abort() })).rejects.toSatisfy(isAbortError);
    await expect(renderer.renderPagePixels(new Uint8Array([9]), 0, 1, { signal: AbortSignal.abort() })).rejects.toSatisfy(isAbortError);
    await expect(renderer.pageTextContent(new Uint8Array([9]), 0)).rejects.toMatchObject({ code: 'out-of-memory' });
    await expect(renderer.pageAnnotationTexts(new Uint8Array([9]), 99)).rejects.toMatchObject({ code: 'render-failed' });
    renderer.releasePdfRenderer();
  });

  it('a read cancelled while it runs stops', async () => {
    let finish!: (value: unknown) => void;
    const getAnnotations = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { renderer, pageOf } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800], getAnnotations });
    const { isAbortError } = await import('./renderQueue');
    const controller = new AbortController();
    const reading = renderer.pageAnnotationTexts(new Uint8Array([4]), 0, { signal: controller.signal });
    await until(() => getAnnotations.mock.calls.length > 0); // the read has started
    controller.abort();
    await expect(reading).rejects.toSatisfy(isAbortError);
    finish([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(pageOf(4, 0).cleanup).toHaveBeenCalledTimes(1);
    renderer.releasePdfRenderer();
  });
});

// The page viewer's text search reads each page's text through the viewer's own slot, as a viewer job
// ('view'), one page per job, keeping nothing of the page unless the viewer keeps it drawn.
describe("page text for the viewer's search", () => {
  afterEach(() => {
    vi.doUnmock('./renderQueue');
    vi.resetModules();
  });

  it("viewerPageText reads through the viewer's slot as a 'view' job; the page is cleaned up unless the viewer keeps it", async () => {
    const getTextContent = vi.fn(async () => ({
      items: [
        { str: 'Suspense', dir: 'ltr', transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10, fontName: 'g_d0_f1', hasEOL: true },
        { type: 'beginMarkedContent', id: 'mc0' },
      ],
      styles: { g_d0_f1: { fontFamily: 'serif', ascent: 0.9, descent: -0.2, vertical: false } },
      lang: null,
    }));
    const { renderer, scheduled, pageOf, opens, render } = await viewerRenderer({ rotate: 0, view: [0, 0, 600, 800], getTextContent });
    const slot = renderer.createViewerSlot();
    const bytes = new Uint8Array([4]);
    // A page the viewer has drawn and keeps: reading its text does not clean it up.
    await renderer.renderViewerPage(bytes, 1, 1, 0, { slot });
    const kept = await renderer.viewerPageText(bytes, 1, { slot });
    expect(kept.items).toEqual([{ str: 'Suspense', transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10, fontName: 'g_d0_f1', hasEOL: true }]);
    expect(kept.styles).toEqual({ g_d0_f1: { fontFamily: 'serif', ascent: 0.9, descent: -0.2, vertical: false } });
    expect(pageOf(4, 1).cleanup).not.toHaveBeenCalled();
    // Any other page is cleaned up once read.
    await renderer.viewerPageText(bytes, 5, { slot });
    expect(pageOf(4, 5).cleanup).toHaveBeenCalledTimes(1);
    expect(scheduled.map((j) => j.priority)).toEqual(['view', 'view', 'view']);
    // The viewer's document, opened once; nothing drawn for the text.
    expect(opens).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    await expect(renderer.viewerPageText(bytes, 2, { slot, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await renderer.releaseViewerDocument(slot);
    // A slot let go reads nothing again.
    await expect(renderer.viewerPageText(bytes, 2, { slot })).rejects.toMatchObject({ name: 'AbortError' });
    expect(opens).toHaveLength(1);
    renderer.releasePdfRenderer();
  });
});
