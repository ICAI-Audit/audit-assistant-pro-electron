// Keeps a typed page list ("1-5, 8") and the page thumbnails in step. The typed text is what the
// tool uses; a click on a thumbnail rewrites the text with formatPageList. No React here.
import { parsePageList } from '@/lib/pdf-tools/pageList';
import { PdfToolsError } from '@/lib/pdf-tools/types';

/**
 * 'as-written': the pages in the order typed, a page typed twice used twice (Split, selected pages).
 * 'sorted': a set of pages in page order (Delete pages, PDF to images).
 */
export type ListOrder = 'as-written' | 'sorted';

export interface PageListReading {
  /** 0-based page indices, or null when the text is not a valid list. */
  indices: number[] | null;
  /** The parser's own message when the text is not valid. */
  error: string | null;
}

export function readPageList(text: string, pageCount: number, order: ListOrder): PageListReading {
  try {
    const indices = parsePageList(text, pageCount, { unique: order === 'sorted' });
    return { indices: order === 'sorted' ? [...indices].sort((a, b) => a - b) : indices, error: null };
  } catch (error) {
    return { indices: null, error: error instanceof PdfToolsError ? error.message : 'Enter the pages you want, for example 1-3, 5' };
  }
}

/**
 * A click on page `index` (0-based): a chosen page is removed everywhere it appears; otherwise it is
 * added. In a sorted set it takes its place in page order; in an ordered list it goes just after the
 * nearest lower page already listed (its last occurrence), so a list that was ascending stays so.
 */
export function togglePage(indices: number[], index: number, order: ListOrder): number[] {
  if (indices.includes(index)) return indices.filter((i) => i !== index);
  if (order === 'sorted') return [...indices, index].sort((a, b) => a - b);
  let at = 0;
  let nearest = -1;
  indices.forEach((page, position) => {
    if (page < index && page >= nearest) {
      nearest = page;
      at = position + 1;
    }
  });
  return [...indices.slice(0, at), index, ...indices.slice(at)];
}

/** The 1-based page numbers shown as chosen on the thumbnails: each once, in page order. */
export function chosenPageNumbers(indices: number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b).map((i) => i + 1);
}
