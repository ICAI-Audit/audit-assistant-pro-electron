// The page pictures and text counts Make searchable reads (ocrRender.ts), over a stand-in for the renderer: each
// page is asked for whole, as displayed, at 300 dpi, as a PNG, as a tool run's job; nothing is kept.
import { describe, expect, it, vi } from 'vitest';
import { OCR_RENDER_DPI } from '@/lib/pdf-tools/ocrTypes';
import { createPageSource } from './ocrRender';

const FILE = new Uint8Array([1, 2, 3]);

function fakeRenderer(picture = { bytes: new Uint8Array([9]), width: 2480, height: 3508, mimeType: 'image/png' as const, dpi: 300, reduced: false }) {
  const renderPage = vi.fn(async () => picture);
  const pageTextContent = vi.fn(async () => ({ items: [{ str: 'Page 7 ' }, { str: ' of 9' }], styles: {} }));
  // Only what the page source calls and reads is stood in for.
  return { renderPage, pageTextContent, source: createPageSource({ renderPage, pageTextContent } as unknown as Parameters<typeof createPageSource>[0]) };
}

describe('page pictures for recognition', () => {
  it('asks the renderer for the whole page as displayed, at 300 dpi, as a PNG, as a run job', async () => {
    const renderer = fakeRenderer();
    const controller = new AbortController();
    const picture = await renderer.source.picture(FILE, 4, { signal: controller.signal });
    expect(OCR_RENDER_DPI).toBe(300);
    expect(renderer.renderPage).toHaveBeenCalledWith(FILE, 4, 300, 'png', { signal: controller.signal, priority: 'run' });
    expect(picture).toEqual({ image: new Uint8Array([9]), widthPx: 2480, heightPx: 3508, dpi: 300 });
  });

  it('says so when a very large page was drawn at a lower resolution', async () => {
    const renderer = fakeRenderer({ bytes: new Uint8Array([9]), width: 8192, height: 5461, mimeType: 'image/png', dpi: 164, reduced: true });
    expect((await renderer.source.picture(FILE, 0)).dpi).toBe(164);
  });

  it('passes a failure of the renderer on as it is', async () => {
    const renderer = fakeRenderer();
    const failure = new Error('out of memory');
    renderer.renderPage.mockRejectedValueOnce(failure);
    await expect(renderer.source.picture(FILE, 0)).rejects.toBe(failure);
  });
});

describe('text counts for the page plan', () => {
  it('counts non-space characters as Document check does, as a run job unless the dialog asks', async () => {
    const renderer = fakeRenderer();
    const pages = renderer.source;
    expect(await pages.pageChars(FILE, 2)).toBe(8); // "Page7of9"
    expect(renderer.pageTextContent).toHaveBeenLastCalledWith(FILE, 2, { signal: undefined, priority: 'run' });
    const controller = new AbortController();
    await pages.pageChars(FILE, 0, { signal: controller.signal, priority: 'dialog' });
    expect(renderer.pageTextContent).toHaveBeenLastCalledWith(FILE, 0, { signal: controller.signal, priority: 'dialog' });
  });
});
