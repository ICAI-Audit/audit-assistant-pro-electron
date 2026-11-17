// The one way the Watermark and Page numbers previews are drawn, in the dialog and over the page
// viewer: the page is copied out of the file (once per page: copying reads the whole file), the copy
// is marked by the same library call as the run, and pdf.js draws it. What is shown is therefore what
// the run makes on that page (previewAgreement.test.ts measures it within 1 pt on turned, cropped,
// unbalanced and /UserUnit pages).
import type { MarkReport } from '@/lib/pdf-tools/watermark';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { abortError } from '../renderQueue';

export interface MarkedPageDeps {
  /** A one-page copy of page `pageIndex` (from 0). */
  extract(file: Uint8Array, pageIndex: number, signal: AbortSignal): Promise<Uint8Array>;
  /** Draws page 1 of `file` as a PNG at `dpi` (or lower, for a very large page: `dpi` says what was used). */
  render(file: Uint8Array, dpi: 100 | 150 | 300, signal: AbortSignal): Promise<{ bytes: Uint8Array; width: number; height: number; dpi: number }>;
}

/** Marks a one-page copy: the library's own call on page 1 of it. */
export type MarkPage = (page: Uint8Array) => Promise<{ bytes: Uint8Array; report?: MarkReport }>;

export interface MarkedPage {
  png: Uint8Array;
  width: number;
  height: number;
  /** Image pixels per point of the page as displayed. */
  pxPerPt: number;
  report: MarkReport | null;
}

export async function drawMarkedPage(
  deps: MarkedPageDeps,
  file: Uint8Array,
  pageIndex: number,
  mark: MarkPage,
  dpi: 100 | 150 | 300,
  signal: AbortSignal,
): Promise<MarkedPage> {
  const check = () => {
    if (signal.aborted) throw abortError();
  };
  check();
  const page = await deps.extract(file, pageIndex, signal);
  check();
  const marked = await mark(page);
  check();
  const image = await deps.render(marked.bytes, dpi, signal);
  check();
  return { png: image.bytes, width: image.width, height: image.height, pxPerPt: image.dpi / 72, report: marked.report ?? null };
}

/** The library's codes for options that cannot work on this file: Run waits until they are changed. */
const OPTION_PROBLEMS = new Set(['invalid-watermark-options', 'invalid-number-options', 'unsupported-characters']);

/**
 * What the preview says when it could not be drawn. A problem with the options (a stamp that does not
 * fit, a character the fonts cannot write) blocks Run and names the real page; anything else only
 * means the preview failed, in a fixed sentence (never the library's or the browser's text).
 */
export function previewProblem(error: unknown, realPage: number): { message: string; blocking: boolean; code?: string } {
  if (error instanceof PdfToolsError && OPTION_PROBLEMS.has(error.code)) {
    // The copy's page 1 is the file's page `realPage` ("does not fit on page 1", "at the top of page 1").
    return { message: error.message.replace(/\b(on|of) page 1\b/g, `$1 page ${realPage}`), blocking: true, code: error.code };
  }
  return { message: 'The preview could not be drawn. The marks can still be added.', blocking: false };
}

/** The resolution that keeps the marked page sharp over the viewer's page box (CSS px per point × device pixel ratio). */
export function overlayDpi(cssScale: number, dpr: number): 100 | 150 | 300 {
  const needed = cssScale * dpr * 72;
  return needed <= 100 ? 100 : needed <= 150 ? 150 : 300;
}
