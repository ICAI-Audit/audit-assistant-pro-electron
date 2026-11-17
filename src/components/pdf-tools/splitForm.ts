// The Split dialog's words for its several-file choices (design 5.3, phase 2): reading the typed ranges,
// the short list of what will be made, and one short sentence for each thing worth knowing first (pages in
// no file, pages in two files, what happens at the bookmarks). Plain words, no React.
import { parseRangeParts, partPageCount, partCoverage, type BookmarkPlan, type PagePart } from '@/lib/pdf-tools/splitPlan';
import { PdfToolsError } from '@/lib/pdf-tools/types';

/** The tick box beside the page list, and the hint the list shows while it is ticked. */
export const SEPARATE_FILES_LABEL = 'A separate file for each range';
export const SEPARATE_FILES_HINT = 'Type each range, separated by commas, for example 1-32, 65-96. Clicking a page below only shows it larger.';

/** The "At bookmarks" choice: shown only for a file that has bookmarks. */
export const BOOKMARKS_LABEL = 'At bookmarks';
export const BOOKMARKS_DESCRIPTION = 'One file for each main bookmark.';
export const BOOKMARKS_READING = 'Reading the bookmarks…';
export const BOOKMARKS_UNREADABLE = 'The bookmarks could not be read, so this file cannot be split at them.';

/** How many files the list shows before "Show all". */
export const PREVIEW_SHOWN = 5;

export interface RangeReading {
  /** One part per range, or null while the field is empty or not valid. */
  parts: PagePart[] | null;
  /** What is wrong, in the page list's own words; null while the field is empty. */
  error: string | null;
}

export function readRanges(text: string, pageCount: number): RangeReading {
  if (text.trim() === '') return { parts: null, error: null };
  try {
    return { parts: parseRangeParts(text, pageCount), error: null };
  } catch (error) {
    return { parts: null, error: error instanceof PdfToolsError ? error.message : 'Enter the pages you want, for example 1-3, 5' };
  }
}

const runText = (run: PagePart) => (run.from === run.to ? `${run.from}` : `${run.from}–${run.to}`);

/** "33–64", "33–64 and 97–320", "1, 3, 5, 7, 9 and 2 more" (pages). */
function runsText(runs: readonly PagePart[]): string {
  const shown = runs.slice(0, PREVIEW_SHOWN).map(runText);
  const rest = runs.slice(PREVIEW_SHOWN).reduce((sum, run) => sum + partPageCount(run), 0);
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
}

const onePage = (runs: readonly PagePart[]) => runs.length === 1 && runs[0].from === runs[0].to;

/** "Pages 33–64 are in no file.", or null when every page is in a file. */
export function pagesInNoFile(runs: readonly PagePart[]): string | null {
  if (runs.length === 0) return null;
  return onePage(runs) ? `Page ${runs[0].from} is in no file.` : `Pages ${runsText(runs)} are in no file.`;
}

/** "Pages 20–32 are in more than one file.", or null. */
export function pagesInSeveralFiles(runs: readonly PagePart[]): string | null {
  if (runs.length === 0) return null;
  return onePage(runs) ? `Page ${runs[0].from} is in more than one file.` : `Pages ${runsText(runs)} are in more than one file.`;
}

/** What to know about the ranges before running: never a reason not to run. */
export function rangeNotes(parts: readonly PagePart[], pageCount: number): string[] {
  const { missing, repeated } = partCoverage(parts, pageCount);
  return [pagesInNoFile(missing), pagesInSeveralFiles(repeated)].filter((note): note is string => note !== null);
}

/** What to know about the bookmarks before running. */
export function bookmarkNotes(plan: BookmarkPlan): string[] {
  const notes: string[] = [];
  if (plan.before === 1) notes.push('Page 1 comes before the first bookmark and goes into the first file.');
  else if (plan.before > 1) notes.push(`Pages 1–${plan.before} come before the first bookmark and go into the first file.`);
  if (plan.samePage === 1) notes.push('One bookmark opens the same page as another, so it gets no file of its own.');
  else if (plan.samePage > 1) notes.push(`${plan.samePage} bookmarks open the same page as another, so they get no file of their own.`);
  if (plan.noPage === 1) notes.push('One bookmark opens no page in this file, so it gets no file.');
  else if (plan.noPage > 1) notes.push(`${plan.noPage} bookmarks open no page in this file, so they get no file.`);
  return notes;
}

export interface PlannedFile {
  name: string;
  /** "pages 1–32", or "page 5". */
  pages: string;
}

/** The rows of the list of what will be made. */
export function plannedFiles(names: readonly string[], parts: readonly PagePart[]): PlannedFile[] {
  return parts.map((part, i) => ({ name: names[i], pages: part.from === part.to ? `page ${part.from}` : `pages ${part.from}–${part.to}` }));
}

export const previewHeading = (count: number): string => (count === 1 ? 'This makes 1 file:' : `This makes ${count} files:`);
