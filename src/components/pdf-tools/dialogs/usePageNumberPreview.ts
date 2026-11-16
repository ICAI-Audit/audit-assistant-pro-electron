import { useMemo } from 'react';
import { addPageNumbers, pageNumberLabel, type PageNumberRunOptions } from '@/lib/pdf-tools/pageNumbers';
import { numberPreviewFor } from '../marks/pageNumberText';
import { useMarkPreview } from './useMarkPreview';

export type PagePreview =
  | { status: 'ready'; url: string; width: number; height: number; pxPerPt: number; page: number; label: string; options: PageNumberRunOptions }
  | {
      status: 'error';
      message: string;
      /** The numbers cannot be added with these options (the lib's own check): Run must wait. */
      blocking: boolean;
      /** addPageNumbers's code: 'unsupported-characters' or 'invalid-number-options' (does not fit). */
      code?: string;
    };

/** The page of the range a preview shows: the one asked for, else the first numbered page. */
export function previewPageOf(options: Pick<PageNumberRunOptions, 'fromPage' | 'toPage'>, page?: number): number {
  return page !== undefined && page >= options.fromPage && page <= options.toPage ? page : options.fromPage;
}

/**
 * A preview of one numbered page (the first, or `page`): that page alone is copied out and numbered
 * with addPageNumbers exactly as the run numbers it (marks/pageNumberText.ts numberPreviewFor: its
 * own number, the run's total in "of N" and {pages}), then drawn. Shared with the Watermark preview
 * (useMarkPreview.ts), so there is one way of drawing a preview.
 */
export function usePageNumberPreview(
  bytes: Uint8Array,
  options: PageNumberRunOptions | null,
  opts: { page?: number; isCurrent?: () => boolean; delayMs?: number } = {},
): { preview: PagePreview | null; pending: boolean } {
  const page = options ? previewPageOf(options, opts.page) : 1;
  const key = options ? JSON.stringify({ options, page }) : null;
  // Read when the drawing starts (the hook keeps the latest), so it always matches the key drawn.
  const plan = options ? numberPreviewFor(options, page) : null;
  const { preview, pending } = useMarkPreview(
    {
      bytes,
      pageIndex: page - 1,
      key: plan ? key : null,
      mark: async (one) => ({ bytes: await addPageNumbers(one, plan!) }),
      isCurrent: opts.isCurrent ?? (() => true),
    },
    opts.delayMs ?? 250,
  );

  const shown = useMemo<PagePreview | null>(() => {
    if (!preview) return null;
    if (preview.status === 'error') return { status: 'error', message: preview.message, blocking: preview.blocking, code: preview.code };
    const drawn = JSON.parse(preview.key) as { options: PageNumberRunOptions; page: number };
    const total = drawn.options.toPage - drawn.options.fromPage + drawn.options.startNumber;
    const n = drawn.options.startNumber + drawn.page - drawn.options.fromPage;
    return { status: 'ready', url: preview.url, width: preview.width, height: preview.height, pxPerPt: preview.pxPerPt, page: drawn.page, label: pageNumberLabel(drawn.options, n, total), options: drawn.options };
  }, [preview]);

  return { preview: shown, pending };
}
