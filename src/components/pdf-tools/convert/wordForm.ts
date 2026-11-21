// PDF to Word's words and rules (design 5.11; contract decisions 13–17). Pure: what the dialog says, why Run
// waits, the check for text made when the dialog opens, the record and the result's message. The record
// holds the counts of RECORD_KEYS only, never text from the document.
import { cleanFileName } from '@/lib/pdf-tools/fileNames';
import { SCANNED_MAX_CHARS } from '@/lib/pdf-tools/layout';
import type { WordReport } from '@/lib/pdf-tools/wordBuild';
import { plural } from '../format';
import type { Description } from '../toolStep';

/** The dialog's one or two sentences on what will be made. */
export const DESCRIPTION =
  'A Word document that keeps the look of the pages: text, tables and pictures in their places, ready to edit. Fonts Word does not have are replaced by similar ones.';

/** Contract decision 15: the dialog's own signed-file notice. */
export const SIGNED_WARNING = 'This file is signed. The result is a new file; the signed original is unchanged.';

/** Contract decision 14: Run waits for a file with no text on any page. */
export const NO_TEXT_MESSAGE = 'This file has no text to read; it looks scanned. Make it searchable first.';

/** Contract decision 17. */
export const WORD_MAX_PAGES = 1000;
export const TOO_MANY_PAGES_MESSAGE = 'This file has more than 1,000 pages, too many to turn into a Word document. Split it into parts first.';

export const RUN_LABEL = 'Make Word document';
export const READING_LABEL = (page: number, total: number) => `Reading page ${page} of ${total}…`;
export const ARRANGING_LABEL = 'Putting the paragraphs and tables in order…';
export const WRITING_LABEL = 'Writing the Word document…';

/** Record summary; resultNames.ts operationSummary('pdf-to-word') says the same. */
export const SUMMARY = 'Converted to Word';

export function summary(report: Pick<WordReport, 'pages'>): string {
  return `${SUMMARY}: ${plural(report.pages, 'page')}`;
}

/** The record's keys (activity.ts keeps only these for PDF to Word): counts, never a word of the document. */
export const RECORD_KEYS = ['pages', 'paragraphs', 'headings', 'tables', 'pagesNoText', 'pagesFromScan'] as const satisfies readonly (keyof WordReport)[];

export function recordOptions(report: WordReport): Record<string, number> {
  const options: Record<string, number> = {};
  for (const key of RECORD_KEYS) {
    const value = report[key];
    if (value !== undefined) options[key] = value;
  }
  return options;
}

/** The result's name: `<name>.docx`, cleaned (decision 16). */
export function wordFileName(stem: string): string {
  return cleanFileName(stem, 'docx');
}

/** Pages under 20 characters (their few words are kept): what to do about them. */
export function littleTextNote(pages: number): string {
  return pages === 1
    ? '1 page has little or no text; it may be scanned. Make the file searchable to convert it.'
    : `${pages} pages have little or no text; they may be scanned. Make the file searchable to convert them.`;
}

/**
 * Pages that are scans with recognised text: their words were typed from the recognition and the scan picture was left
 * out, so that nothing is printed twice. Recognised numbers can be wrong, and nothing else in the result says so.
 */
export function scanNote(pages: number): string {
  return pages === 1
    ? '1 page is a scan: its text was typed from recognition and the scan picture was left out. Check numbers against the page.'
    : `${pages} pages are scans: their text was typed from recognition and the scan pictures were left out. Check numbers against the page.`;
}

/** "12 pages: 48 paragraphs, 6 headings, 3 tables.", then the pages with little or no text and the scanned pages when there are any. */
export function resultDescription(name: string, report: WordReport): Description {
  const made = [
    report.paragraphs > 0 ? plural(report.paragraphs, 'paragraph') : '',
    report.headings > 0 ? plural(report.headings, 'heading') : '',
    report.tables > 0 ? plural(report.tables, 'table') : '',
  ].filter((part) => part !== '');
  const detail = [`${plural(report.pages, 'page')}${made.length > 0 ? `: ${made.join(', ')}` : ''}.`];
  if (report.pagesNoText > 0) detail.push(littleTextNote(report.pagesNoText));
  const scans = report.pagesFromScan ?? 0;
  if (scans > 0) detail.push(scanNote(scans));
  return { message: `Made ${name}`, detail: detail.join(' '), tone: report.pagesNoText > 0 || scans > 0 ? 'warning' : 'success' };
}

/** What the check made on opening found: text on some page, none at all, still looking, or it could not tell. */
export type TextCheck = 'checking' | 'some' | 'none' | 'unknown';

/** Why Run waits, in one line, or null when it can be pressed (a check still running or one that failed never blocks: the run checks again). */
export function blockedReason(file: { pageCount: number | null }, text: TextCheck): string | null {
  if ((file.pageCount ?? 0) > WORD_MAX_PAGES) return TOO_MANY_PAGES_MESSAGE;
  if (text === 'none') return NO_TEXT_MESSAGE;
  return null;
}

/** The characters of a page's text items that are not white space. */
export function nonSpaceChars(items: readonly { str: string }[]): number {
  let n = 0;
  for (const item of items) n += item.str.replace(/\s/g, '').length;
  return n;
}

/**
 * Whether any page has text (SCANNED_MAX_CHARS characters or more, as layout.ts counts a page): page by page,
 * stopping at the first that has. 'unknown' when a page cannot be read or the check is stopped.
 */
export async function findText(pageCount: number, pageChars: (pageIndex: number) => Promise<number>, opts: { signal?: AbortSignal } = {}): Promise<'some' | 'none' | 'unknown'> {
  try {
    for (let i = 0; i < pageCount; i++) {
      if (opts.signal?.aborted) return 'unknown';
      if ((await pageChars(i)) >= SCANNED_MAX_CHARS) return 'some';
    }
  } catch {
    return 'unknown';
  }
  return opts.signal?.aborted ? 'unknown' : 'none';
}
