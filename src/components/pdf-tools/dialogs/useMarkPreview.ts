// The live preview of the Watermark and Page numbers dialogs: one page of the file, copied out, marked
// by the same library call as the run and drawn by pdf.js (marks/markedPage.ts). It waits for typing to
// pause; a newer change cancels an older drawing; the last good picture stays up while a new one is
// drawn. The picture is an object URL, revoked when it is replaced and when the dialog closes.
//
// Confidentiality: `isCurrent` (the dialog's scope captured when it opened) is checked after every
// await, before anything is shown; nothing is kept once the dialog has gone.
import { useEffect, useRef, useState } from 'react';
import { extractPages } from '@/lib/pdf-tools/organise';
import type { MarkReport } from '@/lib/pdf-tools/watermark';
import { drawMarkedPage, previewProblem, type MarkedPageDeps, type MarkPage } from '../marks/markedPage';
import { createOnePageCache } from '../onePageCache';
import { isAbortError, renderPage } from '../pdfRenderer';

export type MarkPreview =
  | {
      status: 'ready';
      url: string;
      width: number;
      height: number;
      /** Image pixels per point of the page as displayed. */
      pxPerPt: number;
      /** Counted from 0. */
      pageIndex: number;
      /** The library's report for this page (Watermark), or null. */
      report: MarkReport | null;
      /** The request this picture answers. */
      key: string;
    }
  | {
      status: 'error';
      message: string;
      /** The options cannot work on this file (the library refused them): Run must wait. */
      blocking: boolean;
      code?: string;
      pageIndex: number;
      key: string;
    };

/** One-page copies (kept one at a time: copying reads the whole file) and drawings at 'high' priority. */
export function createPreviewDeps(): MarkedPageDeps {
  const pages = createOnePageCache(extractPages);
  return {
    extract: (file, pageIndex) => pages.get(file, pageIndex),
    render: async (file, dpi, signal) => {
      const image = await renderPage(file, 0, dpi, 'png', { signal, priority: 'high' });
      return { bytes: image.bytes, width: image.width, height: image.height, dpi: image.dpi };
    },
  };
}

export interface MarkPreviewRequest {
  bytes: Uint8Array;
  /** Counted from 0. */
  pageIndex: number;
  /** What the marks depend on (the options, as JSON): a new key draws again; null draws nothing new. */
  key: string | null;
  /** Marks the one-page copy; read when the drawing starts. */
  mark: MarkPage;
  /** False once the list the dialog was opened for has moved on: nothing more is shown. */
  isCurrent: () => boolean;
}

export function useMarkPreview(request: MarkPreviewRequest, delayMs = 150): { preview: MarkPreview | null; pending: boolean } {
  const { bytes, pageIndex, key } = request;
  const [preview, setPreview] = useState<MarkPreview | null>(null);
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
      const { mark, isCurrent } = latest.current;
      try {
        const page = await drawMarkedPage(deps.current, bytes, pageIndex, mark, 100, signal);
        if (signal.aborted || !isCurrent()) return;
        const url = URL.createObjectURL(new Blob([page.png as BlobPart], { type: 'image/png' }));
        if (shown.current) URL.revokeObjectURL(shown.current);
        shown.current = url;
        setPreview({ status: 'ready', url, width: page.width, height: page.height, pxPerPt: page.pxPerPt, pageIndex, report: page.report, key });
      } catch (error) {
        if (signal.aborted || isAbortError(error) || !isCurrent()) return;
        setPreview({ status: 'error', ...previewProblem(error, pageIndex + 1), pageIndex, key });
      } finally {
        if (!signal.aborted) setPending(false);
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bytes, pageIndex, key, delayMs]);

  return { preview, pending };
}
