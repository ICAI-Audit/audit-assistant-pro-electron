import { COMPRESS_LEVELS, type CompressLevel } from './compress';
import { cleanFileName, cutMiddle, stripExtension } from './fileNames';
import type { AnyToolId, OperationFlags } from './types';

const MAX_NAME_LENGTH = 120;

/** Cuts a stem so that `stem + ending` fits the name limit: in the middle, so its end stays (QA-FIX G). */
function fitStem(stem: string, ending: string): string {
  return cutMiddle(stem, MAX_NAME_LENGTH - ending.length);
}

const pdfName = (stem: string, suffix: string) => {
  const base = suffix !== '' && stem.replace(/^[. ]+|[. ]+$/g, '') === '' ? 'document' : stem;
  return cleanFileName(fitStem(base, `${suffix}.pdf`) + suffix, 'pdf');
};

/**
 * The suggested name of a tool's result (spec section 5), cleaned for use as a file name.
 * Split names a page range when `detail` gives one, otherwise the selected pages. For PDF to
 * images it is the stem each page image is named from (`<stem>_page_001.png`).
 * Watermark is named `_stamped` when `stampOnly` (only the stamp or logo is on); Page numbers is
 * named `_header_footer` when `headerFooter` (header or footer text is used); Resize or crop pages is
 * `_resized`, `_cropped` (`pageBoxMode` 'trim') or `_with_margins` ('margin').
 */
export function defaultResultName(
  tool: AnyToolId,
  sourceName: string,
  detail?: { from?: number; to?: number; stampOnly?: boolean; headerFooter?: boolean; pageBoxMode?: 'resize' | 'trim' | 'margin' },
): string {
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
      return pdfName(stem, detail?.headerFooter ? '_header_footer' : '_numbered');
    case 'images-to-pdf':
      return pdfName(stem, '');
    case 'pdf-to-images':
      return stem;
    case 'redact':
      return pdfName(stem, '_redacted');
    case 'bookmarks':
      return pdfName(stem, '_bookmarked');
    case 'organise-pages':
      return pdfName(stem, '_organised');
    case 'watermark':
      return pdfName(stem, detail?.stampOnly ? '_stamped' : '_watermarked');
    case 'protect':
      return pdfName(stem, '_protected');
    case 'pdf-to-excel':
      return cleanFileName(fitStem(stem, '.xlsx'), 'xlsx');
    case 'pdf-to-word':
      return cleanFileName(fitStem(stem, '.docx'), 'docx');
    case 'document-check':
      return pdfName(stem, '_check');
    case 'compare':
      return pdfName(stem, '_changes');
    case 'ocr':
      return pdfName(stem, '_searchable');
    case 'resize-crop':
      return pdfName(stem, detail?.pageBoxMode === 'trim' ? '_cropped' : detail?.pageBoxMode === 'margin' ? '_with_margins' : '_resized');
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
 * { images }; pdf-to-images { page, format, dpi }; page-numbers { headerFooter?: 'with' | 'only' };
 * redact { areas, pages }; bookmarks { bookmarks }; organise-pages { moved?, turned?, removed? } (counts). Redact's
 * full record line (kinds, output, dpi) is composed by its own task from this one.
 */
export function operationSummary(tool: AnyToolId, detail: Record<string, string | number>): string {
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
      if (detail.headerFooter === 'only') return 'Added header and footer';
      return detail.headerFooter === 'with' ? 'Added page numbers, header and footer' : 'Added page numbers';
    case 'images-to-pdf':
      return `Converted ${count(Number(detail.images), 'image')} to PDF`;
    case 'pdf-to-images':
      return `Converted page ${detail.page} to ${String(detail.format).toUpperCase()} at ${detail.dpi} dpi`;
    case 'redact':
      return `Redacted ${count(Number(detail.areas), 'area')} on ${count(Number(detail.pages), 'page')}`;
    case 'bookmarks':
      return `Bookmarks edited: ${count(Number(detail.bookmarks), 'bookmark')}`;
    case 'organise-pages': {
      // The same line as Organise pages' own record (organise/organiseSummary.ts changeLine): "3 moved, 2 rotated, 1 removed".
      const parts = [
        Number(detail.moved) > 0 ? `${Number(detail.moved)} moved` : null,
        Number(detail.turned) > 0 ? `${Number(detail.turned)} rotated` : null,
        Number(detail.removed) > 0 ? `${Number(detail.removed)} removed` : null,
      ].filter((part): part is string => part !== null);
      return parts.length > 0 ? `Organised pages: ${parts.join(', ')}` : 'Organised pages';
    }
    case 'watermark':
      return 'Added watermark';
    case 'protect':
      return 'Protected with a password (AES-256)';
    case 'pdf-to-excel':
      return 'Converted to Excel';
    case 'pdf-to-word':
      return 'Converted to Word';
    case 'document-check':
      return 'Document check';
    case 'compare':
      return 'Compared 2 files';
    case 'ocr':
      return 'Made searchable';
    case 'resize-crop':
      // The run step writes its own record line (pagebox/pageBoxForm.ts pageBoxRecord); this keeps the switch whole.
      return detail.mode === 'trim' ? 'Trimmed pages' : detail.mode === 'margin' ? 'Added margins to pages' : 'Resized pages';
  }
}

/**
 * What a step's flags say, in words, in the order they are added to its summary. Every flag of
 * OperationFlags has a note (resultNames.test.ts checks it), and the activity record carries each as a
 * metadata key (activity.ts FLAG_KEYS is made from this list).
 */
export const FLAG_NOTES: readonly [keyof OperationFlags, string][] = [
  ['formFieldsDropped', 'form fields not carried'],
  // Split, Delete pages, Organise pages and Merge carry bookmarks from phase 2: the note says some were not (design 5.10).
  ['bookmarksDropped', 'some bookmarks not carried'],
  ['signatureInvalid', 'signature no longer valid'],
  ['sharedResourcesKept', 'may still contain images or fonts of left-out pages'],
  ['redactedValuesLeftVisible', 'some chosen values left visible'],
  ['textLayerIncomplete', 'some text on redacted pages is not searchable'],
  ['markMayBeMisplaced', 'a mark may be misplaced'],
  // A source opened with its password, or opened without one but with restrictions (QA-FIX E): the result has neither.
  ['protectionRemoved', 'protection removed'],
  ['oldBookmarksKept', 'some old bookmark titles may remain in the file'],
];

/** "Merged 2 files; form fields not carried": a summary with what the flags say. */
export function summaryWithNotes(summary: string, flags: OperationFlags): string {
  const notes = FLAG_NOTES.filter(([flag]) => flags[flag]).map(([, words]) => words);
  return notes.length > 0 ? `${summary}; ${notes.join('; ')}` : summary;
}
