// Make searchable's words and rules (T-064, OCR; design 5.12; contract section 6 and decisions 15, 16). Pure: what the
// dialog says, why Run waits, the record and the result's message. The message is honest in plain words: how many
// pages were recognised, that recognised text can be wrong, how many numbers to check and where, which pages look
// faint or ran out of time. It never gives a single reassuring percentage (owner, 18 November 2026; the trial found
// the engine's confidence unreliable). The record holds counts only, never a recognised word.
import { cleanFileName, cutMiddle, stripExtension } from '@/lib/pdf-tools/fileNames';
import type { OcrPlan } from '@/lib/pdf-tools/ocrPlan';
import type { OcrReport } from '@/lib/pdf-tools/ocrQuality';
import { SECONDS_PER_PAGE } from '@/lib/pdf-tools/ocrTypes';
import { plural } from '../format';
import type { Description } from '../toolStep';

/** The dialog's sentences on what will be made. */
export const DESCRIPTION = 'Adds the text of scanned pages, read on this computer, so the file can be searched, selected and redacted. The pages look the same. English text only.';

/** Contract decision 15: the dialog's own signed-file notice. */
export const SIGNED_WARNING = 'This file is signed. The result is a new file; the signed original is unchanged.';

export const RUN_LABEL = 'Make searchable';
export const CHECKING_LABEL = (page: number, total: number) => `Looking for pages without text: page ${page} of ${total}…`;
export const STARTING_LABEL = 'Getting the text reader ready…';
/** "about 40 seconds left", "about 3 minutes left", "a few seconds left": from the pages measured so far, never a promise. */
export function timeLeft(seconds: number): string {
  if (seconds < 8) return 'a few seconds left';
  if (seconds < 55) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} seconds left`;
  return `about ${plural(Math.max(1, Math.round(seconds / 60)), 'minute')} left`;
}

/**
 * While a page is recognised: its page number, how far through the pages to recognise and, once a page has been
 * measured, about how long the rest will take (`secondsLeft`).
 */
export const RECOGNISING_LABEL = (pageNumber: number, done: number, total: number, secondsLeft?: number) =>
  `Reading the text of page ${pageNumber} (${done} of ${total})${secondsLeft !== undefined && Number.isFinite(secondsLeft) ? `, ${timeLeft(secondsLeft)}` : ''}…`;
export const WRITING_LABEL = 'Adding the text to the file…';

/** The text reader could not start (part B: a missing or damaged engine file). */
export const ENGINE_FAILED_MESSAGE = 'The text reader could not start, and nothing was added. Restart the application and try again.';

/** Every page to recognise failed (the engine on each, or its drawing): no result (ruling of 18 November 2026). */
export const ALL_PAGES_FAILED_MESSAGE = 'No page could be read, and nothing was added. Try again; if it fails again, restart the application.';

/** No word was read on any page that was recognised (or every one ran out of time): no result. */
export const NOTHING_READ_MESSAGE = 'No words could be read on the pages without text, and nothing was added. They may be blank, too faint or not in English.';

/** Record summary; INT adds the same to resultNames.ts operationSummary('ocr'). */
export const SUMMARY = 'Made searchable';

/** Contract decision 16: the result's name ending. */
export const RESULT_SUFFIX = '_searchable';
const MAX_NAME_LENGTH = 120;

/** `<name>_searchable.pdf`, cleaned and cut in the middle when long (as resultNames.ts does for the other tools). */
export function searchableName(sourceName: string): string {
  const ending = `${RESULT_SUFFIX}.pdf`;
  const stem = stripExtension(sourceName);
  return cleanFileName(`${cutMiddle(stem.replace(/^[. ]+|[. ]+$/g, '') === '' ? 'document' : stem, MAX_NAME_LENGTH - ending.length)}${RESULT_SUFFIX}`, 'pdf');
}

/** The result's file name from the name field's stem. */
export function searchableFileName(stem: string): string {
  return cleanFileName(stem, 'pdf');
}

/**
 * A time as a range in plain units: "about 5 to 20 seconds", "about 1 to 3 minutes", "about 1 to 3 hours"; one
 * figure when both ends come to the same ("about 2 minutes"). Seconds to the nearest 5; minutes and hours with the
 * low end rounded and the high end rounded up, so the range is never narrower than what was worked out.
 */
export function timeRange(lowSeconds: number, highSeconds: number): string {
  const range = (low: number, high: number, unit: string) => (low >= high ? `about ${plural(high, unit)}` : `about ${low} to ${plural(high, unit)}`);
  if (highSeconds < 90) {
    const five = (s: number) => Math.max(5, Math.round(s / 5) * 5);
    return range(five(lowSeconds), five(highSeconds), 'second');
  }
  const part = (size: number) => range(Math.max(1, Math.round(lowSeconds / size)), Math.ceil(highSeconds / size), size === 60 ? 'minute' : 'hour');
  return Math.ceil(highSeconds / 60) < 120 ? part(60) : part(3600);
}

/**
 * "8 of 12 pages have little or no text and will be recognised, about 5 to 20 seconds a page (about 1 to 3 minutes
 * in all).", or null when none will be. The count is `plan.toRecognise`: exactly the pages the run recognises.
 */
export function planLine(plan: OcrPlan): string | null {
  const n = plan.toRecognise.length;
  if (n === 0) return null;
  const { low, high } = SECONDS_PER_PAGE;
  if (n === 1) {
    const which = plan.total === 1 ? 'The page has' : `1 of ${plan.total} pages has`;
    return `${which} little or no text and will be recognised, in ${timeRange(low, high)}.`;
  }
  const which = n === plan.total ? `All ${n} pages have` : `${n} of ${plan.total} pages have`;
  return `${which} little or no text and will be recognised, ${timeRange(low, high)} a page (${timeRange(n * low, n * high)} in all).`;
}

/** The one sentence for a file with no page to recognise: every page has text already, or has nothing drawn on it. */
export function nothingToRecogniseMessage(plan: OcrPlan): string {
  if (plan.withText === plan.total) return 'Every page already has text; nothing to recognise.';
  return plan.withText === 0 && plan.unread === 0 ? 'Every page is blank; nothing to recognise.' : 'Every page already has text or is blank; nothing to recognise.';
}

/** Why Run waits, or null when it can be pressed. While the pages are still being looked at (`plan` null) it never waits: the run looks again itself. */
export function blockedReason(plan: OcrPlan | null): string | null {
  if (plan && plan.toRecognise.length === 0) return nothingToRecogniseMessage(plan);
  return null;
}

/** "page 3", "pages 3 and 9", "pages 1, 2, 3, 4 and 5", and past five, "6 pages". */
export function pageList(pages: readonly number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  if (pages.length > 5) return `${pages.length} pages`;
  return `pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const leftAsItWas = (pages: readonly number[], what: string) =>
  pages.length === 1 ? `${capital(pageList(pages))} ${what} and was left as it was.` : `${capital(pageList(pages))} ${what} and were left as they were.`;

/** Whether the run adds a result: only when some word was read. */
export function resultWorthAdding(report: OcrReport): boolean {
  return report.words > 0;
}

/** "Made searchable: 8 of 12 pages recognised" */
export function summary(report: Pick<OcrReport, 'pages' | 'pagesRecognised'>): string {
  return `${SUMMARY}: ${report.pagesRecognised} of ${plural(report.pages, 'page')} recognised`;
}

/** The record's keys (activity.ts keeps only these for Make searchable): counts, never a recognised word. */
export const RECORD_KEYS = [
  'pages',
  'pagesRecognised',
  'pagesSkipped',
  'pagesTimedOut',
  'words',
  'lowConfidenceWords',
  'numbersToCheck',
  'pagesFaint',
  'charactersDropped',
  'wordsLeftOut',
  'pagesPartlyRead',
] as const satisfies readonly (keyof OcrReport)[];

export function recordOptions(report: OcrReport): Record<string, number> {
  const options: Record<string, number> = {};
  for (const key of RECORD_KEYS) options[key] = report[key];
  return options;
}

/**
 * The result's message, for example: "8 of 12 pages recognised; 4 already had text. Parts of page 6 could not be
 * read and were left out: it may be faint, handwritten or not in English. Recognised text can be wrong: check
 * numbers against the page. 37 numbers to check on pages 2, 3, 5, 8 and 9; pages 3 and 9 look faint."
 * A page of which little was read (ocrQuality.ts littleRead) is said so plainly, "Little could be read on page 6:
 * …", and when that is every page that was read, none is called recognised.
 */
export function resultDescription(name: string, report: OcrReport): Description {
  const parts: string[] = [];
  const little = report.littleReadPages;
  const noneReadWell = report.pagesRecognised > 0 && little.length === report.pagesRecognised;
  if (report.pagesRecognised === report.pages) {
    if (!noneReadWell) parts.push(report.pages === 1 ? 'The page was recognised.' : `All ${report.pages} pages recognised.`);
  } else {
    const clauses = noneReadWell ? [] : [`${report.pagesRecognised} of ${plural(report.pages, 'page')} recognised`];
    const of = noneReadWell ? ` of ${plural(report.pages, 'page')}` : '';
    if (report.pagesWithText > 0) clauses.push(`${report.pagesWithText}${clauses.length === 0 ? of : ''} already had text`);
    if (report.pagesEmpty > 0) clauses.push(`${report.pagesEmpty}${clauses.length === 0 ? of : ''} had nothing to recognise`);
    if (clauses.length > 0) parts.push(`${clauses.join('; ')}.`);
  }
  if (report.timedOutPages.length > 0) parts.push(leftAsItWas(report.timedOutPages, 'took too long'));
  if (report.unreadPages.length > 0) parts.push(leftAsItWas(report.unreadPages, 'could not be read'));
  if (report.noWordPages.length > 0) {
    const one = report.noWordPages.length === 1;
    parts.push(`No words were found on ${pageList(report.noWordPages)}; ${one ? 'it' : 'they'} may be blank or too faint.`);
  }
  // What the engine could not read was left out of the searchable text (ocrReadable.ts): said once, with the
  // likely reasons, for the pages where it is a tenth of the page or more. Never a count of words or a percentage.
  // A page of which little was read is not said to have "parts" missing: nearly all of it is.
  if (little.length > 0) parts.push(`Little could be read on ${pageList(little)}: ${little.length === 1 ? 'it' : 'they'} may be faint, handwritten or not in English.`);
  const partly = report.partlyReadPages.filter((page) => !little.includes(page));
  if (partly.length > 0) {
    const one = partly.length === 1;
    parts.push(`Parts of ${pageList(partly)} could not be read and were left out: ${one ? 'it' : 'they'} may be faint, handwritten or not in English.`);
  }
  parts.push('Recognised text can be wrong: check numbers against the page.');
  const doubts: string[] = [];
  if (report.numbersToCheck > 0) doubts.push(`${plural(report.numbersToCheck, 'number')} to check on ${pageList(report.numberPages)}`);
  if (report.faintPages.length > 0) doubts.push(`${pageList(report.faintPages)} ${report.faintPages.length === 1 ? 'looks' : 'look'} faint`);
  if (doubts.length > 0) parts.push(`${capital(doubts.join('; '))}.`);
  if (report.charactersDropped > 0) {
    parts.push(
      report.charactersDropped === 1
        ? '1 symbol could not be added to the searchable text and was left out.'
        : `${report.charactersDropped} symbols could not be added to the searchable text and were left out.`,
    );
  }
  const doubtful = report.pagesTimedOut + report.pagesUnread + report.pagesNoWords + report.pagesPartlyRead + report.pagesFaint + report.numbersToCheck + report.charactersDropped > 0;
  return { message: `${SUMMARY}: ${name}`, detail: parts.join(' '), tone: doubtful ? 'warning' : 'success' };
}
