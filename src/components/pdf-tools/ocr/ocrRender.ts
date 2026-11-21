// Make searchable (T-064, OCR part B): what the run reads of a page before it is recognised.
//
// - The page's picture: the whole page as displayed (pdf.js applies the page's own /Rotate and its crop box, as
//   the viewer and PDF to images do), on white, at OCR_RENDER_DPI (300), as a PNG. It is the renderer's own
//   PDF to images drawing (pdfRenderer.ts renderPage), so it is held within the canvas limits (8,192 px a side,
//   50 megapixels: a very large page is drawn at the highest resolution that fits, and `dpi` says which), goes
//   through the render queue as a tool run's job, and is cancellable. The trial read 70 of 70 amounts at 300 dpi
//   and 68 of 70 at 200 dpi, and handed the engine a PNG; encoding takes 0.2 to 0.5 s off the window's thread.
// - Memory: the renderer lets its canvas go as soon as the PNG is encoded and cleans the page up; nothing is
//   kept here. The run holds one page's PNG (1 to 6 MB) while that page is recognised, then drops it.
// - The page's text count for the page plan (ocrPlan.ts): non-space characters as pdf.js reads them, the same
//   count Document check makes (documentCheck.ts charsIn), so the two tools always agree on what is scanned.
import { charsIn } from '@/lib/pdf-tools/documentCheck';
import { OCR_RENDER_DPI } from '@/lib/pdf-tools/ocrTypes';
import * as renderer from '../pdfRenderer';
import type { Priority } from '../renderQueue';

/** A page's picture for the engine. */
export interface PagePicture {
  /** PNG bytes. */
  image: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** The resolution used: OCR_RENDER_DPI unless the page was too large to draw at it. */
  dpi: number;
}

export interface PageReadOptions {
  signal?: AbortSignal;
  /** 'run' unless the dialog asks ('dialog'). */
  priority?: Priority;
}

/** What Make searchable reads of a file's pages (a test passes a stand-in). */
export interface PageSource {
  /** Non-space characters of page `pageIndex` (from 0). */
  pageChars(file: Uint8Array, pageIndex: number, options?: PageReadOptions): Promise<number>;
  /** The page as displayed, at 300 dpi. Rejects as the renderer does (a PdfToolsError in plain words, or a cancel). */
  picture(file: Uint8Array, pageIndex: number, options?: PageReadOptions): Promise<PagePicture>;
}

type Renderer = Pick<typeof renderer, 'renderPage' | 'pageTextContent'>;

export function createPageSource(from: Renderer): PageSource {
  return {
    async pageChars(file, pageIndex, options = {}) {
      return charsIn((await from.pageTextContent(file, pageIndex, { signal: options.signal, priority: options.priority ?? 'run' })).items);
    },
    async picture(file, pageIndex, options = {}) {
      const drawn = await from.renderPage(file, pageIndex, OCR_RENDER_DPI, 'png', { signal: options.signal, priority: options.priority ?? 'run' });
      return { image: drawn.bytes, widthPx: drawn.width, heightPx: drawn.height, dpi: drawn.dpi };
    },
  };
}

/** The application's pages: pdf.js through the shared renderer. */
export const appPages: PageSource = createPageSource(renderer);
