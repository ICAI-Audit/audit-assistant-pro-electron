import { COMPRESS_LEVELS, type CompressLevel } from './compress';
import { cleanFileName, stripExtension } from './fileNames';
import type { OperationFlags, ToolId } from './types';

const MAX_NAME_LENGTH = 120;

/** Cuts a stem so that `stem + ending` fits the name limit, never splitting a surrogate pair. */
function fitStem(stem: string, ending: string): string {
  const room = MAX_NAME_LENGTH - ending.length;
  let out = stem.length > room ? stem.slice(0, room) : stem;
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

const pdfName = (stem: string, suffix: string) => cleanFileName(fitStem(stem, `${suffix}.pdf`) + suffix, 'pdf');

/**
 * The suggested name of a tool's result (spec section 5), cleaned for use as a file name.
 * Split names a page range when `detail` gives one, otherwise the selected pages. For PDF to
 * images it is the stem each page image is named from (`<stem>_page_001.png`).
 */
export function defaultResultName(tool: ToolId, sourceName: string, detail?: { from?: number; to?: number }): string {
  const stem = stripExtension(sourceName);
  switch (tool) {
    case 'merge':
      return pdfName(stem, '_merged');
    case 'split':
      return detail?.from !== undefined && detail.to !== undefined
        ? pdfName(stem, `_pages_${detail.from}-${detail.to}`)
        : pdfName(stem, '_selected_pages');
    case 'delete-pages':
      return pdfName(stem, '_pages_removed');
    case 'compress':
      return pdfName(stem, '_compressed');
    case 'page-numbers':
      return pdfName(stem, '_numbered');
    case 'images-to-pdf':
      return pdfName(stem, '');
    case 'pdf-to-images':
      return stem;
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isSingle = (pages: string) => /^\s*\d+\s*$/.test(pages);

function levelLabel(level: string | number | undefined): string {
  const key = String(level ?? '');
  return Object.prototype.hasOwnProperty.call(COMPRESS_LEVELS, key) ? COMPRESS_LEVELS[key as CompressLevel].label : key;
}

/**
 * One line saying what a tool did, for the result's operation record and the activity log.
 * Expected `detail` keys: merge { files }; split { from, to } | { every, part, parts } | { pages };
 * delete-pages { pages }; compress { level, saved, from?, to? } (sizes as text); images-to-pdf
 * { images }; pdf-to-images { page, format, dpi }.
 */
export function operationSummary(tool: ToolId, detail: Record<string, string | number>): string {
  switch (tool) {
    case 'merge':
      return `Merged ${count(Number(detail.files), 'file')}`;
    case 'split':
      if (detail.every !== undefined) {
        return `Split every ${count(Number(detail.every), 'page')} (part ${detail.part} of ${detail.parts})`;
      }
      if (detail.pages !== undefined) {
        const pages = String(detail.pages);
        return `Extracted ${isSingle(pages) ? 'page' : 'pages'} ${pages.trim()}`;
      }
      return `Split pages ${detail.from}-${detail.to}`;
    case 'delete-pages': {
      const pages = String(detail.pages);
      return `Deleted ${isSingle(pages) ? 'page' : 'pages'} ${pages.trim()}`;
    }
    case 'compress': {
      const sizes = detail.from !== undefined && detail.to !== undefined ? `: ${detail.from} → ${detail.to}` : '';
      return `Compressed, ${levelLabel(detail.level)} (${detail.saved}% smaller${sizes})`;
    }
    case 'page-numbers':
      return 'Added page numbers';
    case 'images-to-pdf':
      return `Converted ${count(Number(detail.images), 'image')} to PDF`;
    case 'pdf-to-images':
      return `Converted page ${detail.page} to ${String(detail.format).toUpperCase()} at ${detail.dpi} dpi`;
  }
}

/** What a step's flags say, in words, in the order they are added to its summary. */
export const FLAG_NOTES: readonly [keyof OperationFlags, string][] = [
  ['formFieldsDropped', 'form fields not carried'],
  ['bookmarksDropped', 'bookmarks not carried'],
  ['signatureInvalid', 'signature no longer valid'],
  ['sharedResourcesKept', 'may still contain images or fonts of left-out pages'],
];

/** "Merged 2 files; form fields not carried": a summary with what the flags say. */
export function summaryWithNotes(summary: string, flags: OperationFlags): string {
  const notes = FLAG_NOTES.filter(([flag]) => flags[flag]).map(([, words]) => words);
  return notes.length > 0 ? `${summary}; ${notes.join('; ')}` : summary;
}
