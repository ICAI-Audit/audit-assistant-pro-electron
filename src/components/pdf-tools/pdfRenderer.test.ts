import { afterEach, describe, expect, it, vi } from 'vitest';

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
