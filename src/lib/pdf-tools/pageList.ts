import { PdfToolsError } from './types';

const invalid = (message: string) => new PdfToolsError('invalid-page-list', message);

/** Parses a 1-based page list such as "1-5, 8" into 0-based indices, in the order written. */
export function parsePageList(input: string, pageCount: number, opts: { unique?: boolean } = {}): number[] {
  if (input.trim() === '') throw invalid('Enter the pages you want, for example 1-3, 5');

  const result: number[] = [];
  const seen = new Set<number>();
  const add = (page: number) => {
    if (page < 1 || page > pageCount) {
      throw invalid(`Page ${page} is outside this file's ${pageCount} pages`);
    }
    const index = page - 1;
    if (opts.unique) {
      if (seen.has(index)) return;
      seen.add(index);
    }
    result.push(index);
  };

  for (const rawToken of input.split(',')) {
    const token = rawToken.trim();
    const single = /^\d+$/.exec(token);
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (single) {
      add(Number(token));
    } else if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to) throw invalid(`"${token}" is backwards: the first page must not be after the last`);
      for (let page = from; page <= to; page++) add(page);
    } else {
      throw invalid(`"${token}" is not a page or page range. Use numbers like 3 or 2-6, separated by commas`);
    }
  }
  return result;
}

/** Formats 0-based indices as a 1-based list, collapsing consecutive runs: [0,1,2,7] -> "1-3, 8". */
export function formatPageList(indices: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < indices.length) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++;
    parts.push(j > i ? `${indices[i] + 1}-${indices[j] + 1}` : `${indices[i] + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}
