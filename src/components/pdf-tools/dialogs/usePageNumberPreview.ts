import { useEffect, useRef, useState } from 'react';
import { extractPages } from '@/lib/pdf-tools/organise';
import { addPageNumbers, type PageNumberOptions } from '@/lib/pdf-tools/pageNumbers';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { createOnePageCache } from '../onePageCache';
import { isAbortError, renderPage } from '../pdfRenderer';
import { previewMessage, previewPlan } from '../toolOptions';

export type PagePreview =
  | { status: 'ready'; url: string; width: number; height: number; pxPerPt: number; page: number; label: string; options: PageNumberOptions }
  | {
      status: 'error';
      message: string;
      /** The numbers cannot be added with these options (the lib's own check): Run must wait. */
      blocking: boolean;
      /** addPageNumbers's code: 'unsupported-characters' or 'invalid-number-options' (does not fit). */
      code?: string;
    };

// Codes addPageNumbers uses when the options cannot work on this file.
const OPTION_PROBLEMS = new Set(['invalid-number-options', 'unsupported-characters']);

/**
 * A preview of the first numbered page: that page alone is copied out, numbered with
 * addPageNumbers and drawn. Waits for typing to pause; a newer change cancels an older preview.
 */
export function usePageNumberPreview(bytes: Uint8Array, options: PageNumberOptions | null, delayMs = 250) {
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [pending, setPending] = useState(false);
  const shown = useRef<string | null>(null);
  // Copying the page out reads the whole file: done once per page, not on every change of options.
  const pages = useRef(createOnePageCache(extractPages));
  const key = options ? JSON.stringify(options) : null;

  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );

  useEffect(() => {
    if (!key) {
      setPending(false);
      return;
    }
    const wanted = JSON.parse(key) as PageNumberOptions;
    const controller = new AbortController();
    const { signal } = controller;
    setPending(true);
    const timer = setTimeout(async () => {
      const plan = previewPlan(wanted);
      try {
        const page = await pages.current.get(bytes, plan.pageIndex);
        if (signal.aborted) return;
        const numbered = await addPageNumbers(page, plan.options);
        if (signal.aborted) return;
        const image = await renderPage(numbered, 0, 100, 'png', { signal, priority: 'high' });
        if (signal.aborted) return;
        const url = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: 'image/png' }));
        if (shown.current) URL.revokeObjectURL(shown.current);
        shown.current = url;
        setPreview({ status: 'ready', url, width: image.width, height: image.height, pxPerPt: image.dpi / 72, page: plan.pageIndex + 1, label: plan.label, options: wanted });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        const blocking = error instanceof PdfToolsError && OPTION_PROBLEMS.has(error.code);
        setPreview({
          status: 'error',
          blocking,
          code: blocking ? (error as PdfToolsError).code : undefined,
          message: blocking ? previewMessage(error.message, plan.pageIndex + 1) : 'The preview could not be drawn. The numbers can still be added.',
        });
      } finally {
        if (!signal.aborted) setPending(false);
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bytes, key, delayMs]);

  return { preview, pending };
}
