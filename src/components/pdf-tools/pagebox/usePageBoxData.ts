// What the Resize or crop pages dialog loads besides its options: every page's size as displayed (read by
// pdf.js in its worker, so the dialog can count the pages that change and check a trim on every chosen
// page before Run), and the preview of one page. The preview is the run's own library call on a one-page
// copy (resize and margins), or the page as it is with the crop frame over it (trim), drawn by pdf.js.
//
// Confidentiality: `isCurrent` (the dialog's scope, captured when it opened) is checked after every await,
// before anything is shown; the picture is an object URL, revoked when replaced and when the dialog closes.
import { useEffect, useRef, useState } from 'react';
import type { DisplayedPage } from '@/lib/pdf-tools/marks';
import { changePageBoxes, emptyPageBoxReport, type PageBoxOptions } from '@/lib/pdf-tools/pageBox';
import { createPreviewDeps } from '../dialogs/useMarkPreview';
import { drawMarkedPage, type MarkedPageDeps } from '../marks/markedPage';
import { isAbortError, pageGeometries } from '../pdfRenderer';
import { onePageOptions, shapeOf } from './pageBoxForm';

/** Every page's shape, or null while they are read (or when they cannot be: the run still checks every page). */
export function usePageShapes(bytes: Uint8Array, isCurrent: () => boolean): DisplayedPage[] | null {
  const [shapes, setShapes] = useState<{ bytes: Uint8Array; shapes: DisplayedPage[] } | null>(null);
  const current = useRef(isCurrent);
  current.current = isCurrent;
  useEffect(() => {
    const controller = new AbortController();
    pageGeometries(bytes, { signal: controller.signal, priority: 'high' }).then(
      (read) => {
        if (!controller.signal.aborted && current.current()) setShapes({ bytes, shapes: read.map(shapeOf) });
      },
      () => undefined, // without the sizes the dialog counts nothing; the run checks every page itself
    );
    return () => controller.abort();
  }, [bytes]);
  return shapes?.bytes === bytes ? shapes.shapes : null;
}

export type BoxPreview =
  | {
      status: 'ready';
      url: string;
      width: number;
      height: number;
      /** Image pixels per point of the page as displayed. */
      pxPerPt: number;
      /** Counted from 0. */
      pageIndex: number;
      /** The request this picture answers. */
      key: string;
      /** The page is already the paper size: the run leaves it as it is. */
      unchanged: boolean;
    }
  | { status: 'error'; message: string; pageIndex: number; key: string };

export interface BoxPreviewRequest {
  bytes: Uint8Array;
  /** Counted from 0. */
  pageIndex: number;
  /** The options as the run will get them; null shows nothing new. Trim shows the page as it is. */
  options: PageBoxOptions | null;
  isCurrent: () => boolean;
}

/**
 * The preview of one page: drawn after typing pauses, a newer request cancels an older drawing, the last
 * picture stays up meanwhile. `key` is the request being answered now: a picture whose key differs is an
 * older one (for example the resized page, while the page as it is for a trim is being drawn), and nothing
 * may be drawn over it as if it were the new one.
 */
export function usePageBoxPreview(request: BoxPreviewRequest, delayMs = 150): { preview: BoxPreview | null; pending: boolean; key: string | null } {
  const { bytes, pageIndex, options } = request;
  // Trim draws the page as it is (the frame is drawn over it), so its edges do not draw the page again.
  const key = options === null ? null : JSON.stringify(options.mode === 'trim' ? { mode: 'trim', pageIndex } : { ...onePageOptions(options, pageIndex + 1), pageIndex });
  const [preview, setPreview] = useState<BoxPreview | null>(null);
  const [pending, setPending] = useState(false);
  const shown = useRef<string | null>(null);
  const deps = useRef<MarkedPageDeps | null>(null);
  const latest = useRef(request);
  latest.current = request;

  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = null;
    },
    [],
  );

  useEffect(() => {
    if (key === null) {
      setPending(false);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    setPending(true);
    const timer = setTimeout(async () => {
      deps.current ??= createPreviewDeps();
      const { isCurrent, options: wanted } = latest.current;
      if (!wanted) return;
      let unchanged = false;
      const mark = async (one: Uint8Array) => {
        if (wanted.mode === 'trim') return { bytes: one };
        const report = emptyPageBoxReport();
        const out = await changePageBoxes(one, onePageOptions(wanted, pageIndex + 1), { report });
        unchanged = report.unchanged.length > 0;
        return { bytes: out };
      };
      try {
        const page = await drawMarkedPage(deps.current, bytes, pageIndex, mark, 100, signal);
        if (signal.aborted || !isCurrent()) return;
        const url = URL.createObjectURL(new Blob([page.png as BlobPart], { type: 'image/png' }));
        if (shown.current) URL.revokeObjectURL(shown.current);
        shown.current = url;
        setPreview({ status: 'ready', url, width: page.width, height: page.height, pxPerPt: page.pxPerPt, pageIndex, key, unchanged });
      } catch (error) {
        if (signal.aborted || isAbortError(error) || !isCurrent()) return;
        // Never the library's or the browser's words: the run checks the options itself.
        setPreview({ status: 'error', message: 'The preview could not be drawn. The pages can still be changed.', pageIndex, key });
      } finally {
        if (!signal.aborted) setPending(false);
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bytes, pageIndex, key, delayMs]);

  return { preview, pending, key };
}
