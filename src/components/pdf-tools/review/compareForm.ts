// Compare's words and rules (design 5.13 "Compare two versions"; contract T-064 decisions 3, 4, 15 and 17).
// Pure: which file is the earlier version, why Compare cannot run, the signed-file notice, the progress
// lines, the messages, and the record. The record holds the comparison's counts only: never a word of
// either document.
import { MAX_DETAILED_PAGES } from '@/lib/pdf-tools/compareReport';
import { pagesThatDiffer, type Comparison } from '@/lib/pdf-tools/compareText';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import type { Description } from '../toolStep';

/** Decision 17: Compare takes files of up to 1,000 pages. */
export const MAX_COMPARE_PAGES = 1_000;

export const EARLIER_LABEL = 'Earlier version';
export const LATER_LABEL = 'Later version';
export const SWAP_LABEL = 'Swap';
export const DESCRIPTION = 'Finds the words that differ between two versions of a PDF and lists them in a report. The files are not changed.';

/** The record's summary starts so (resultNames.ts operationSummary('compare') says the same). */
export const SUMMARY = 'Compared 2 files';
export const NO_DIFFERENCES = 'No text differences found.';
const NOTHING_ADDED = 'Nothing was added.';

export const readingLabel = (which: 'earlier' | 'later', page: number, pages: number) => `Reading the ${which} version: page ${page} of ${pages}`;
export const COMPARING = 'Comparing the text…';
export const WRITING = 'Writing the report…';

/** Counts with their digits grouped as the other tools write them (1,000; 1,23,456). */
const grouped = (n: number) => n.toLocaleString('en-IN');
const count = (n: number, one: string, many = `${one}s`) => `${grouped(n)} ${n === 1 ? one : many}`;
const PICK_TWO = 'Select exactly two PDFs to compare.';

/** The earlier and later version: the file whose id is `earlierId`, and the other one; null unless there are exactly two. */
export function versions<T extends Pick<WorkingFile, 'id'>>(files: readonly T[], earlierId: string): { earlier: T; later: T } | null {
  if (files.length !== 2 || files[0].id === files[1].id) return null;
  const at = files.findIndex((f) => f.id === earlierId);
  if (at < 0) return null;
  return { earlier: files[at], later: files[1 - at] };
}

export const tooManyPagesMessage = (name: string) => `${name} has more than 1,000 pages. Compare takes files of up to 1,000 pages: split it first.`;

/** Why Compare cannot run, in one line, or null when it can. */
export function blockedReason(files: readonly Pick<WorkingFile, 'name' | 'kind' | 'pageCount'>[]): string | null {
  if (files.length !== 2 || files.some((f) => f.kind !== 'pdf' || f.pageCount === null)) return PICK_TWO;
  const big = files.find((f) => (f.pageCount ?? 0) > MAX_COMPARE_PAGES);
  return big ? tooManyPagesMessage(big.name) : null;
}

/** Decision 15: the report is a new file, the signed original is unchanged (undefined when neither is signed). */
export function signedWarning(files: readonly Pick<WorkingFile, 'name' | 'hasSignature'>[]): string | undefined {
  const signed = files.filter((f) => f.hasSignature);
  if (signed.length === 0) return undefined;
  if (signed.length > 1) return 'Both files are signed. The report is a new file; the signed originals are unchanged.';
  return `${signed[0].name} is signed. The report is a new file; the signed original is unchanged.`;
}

// ---- refusals -----------------------------------------------------------------------------------------

export const wrongFiles = () => new PdfToolsError('wrong-input', PICK_TWO);
export const tooManyPages = (name: string) => new PdfToolsError('compare-too-large', `${tooManyPagesMessage(name)} ${NOTHING_ADDED}`);
export const scannedMessage = (name: string) => `${name} has no text to read; it looks scanned. Make it searchable first. ${NOTHING_ADDED}`;
export const scanned = (name: string) => new PdfToolsError('compare-no-text', scannedMessage(name));
export const readFailed = (name: string) => new PdfToolsError('compare-read-failed', `${name} could not be read. Open it in a PDF reader, save a fresh copy and add that. ${NOTHING_ADDED}`);

// ---- message and record ---------------------------------------------------------------------------------

type Counts = Pick<Comparison, 'pagesDiffer' | 'pagesOnlyEarlier' | 'pagesOnlyLater' | 'pagesLater'>;

/** "7 of 42": pages in both versions whose text differs, of the later version's pages (lead's ruling, round 2). */
const ofLater = (c: Counts) => `${grouped(c.pagesDiffer)} of ${count(c.pagesLater, 'page')} ${c.pagesDiffer === 1 ? 'differs' : 'differ'}`;

/** "1 page is only in the earlier version; 2 pages are only in the later version.", or null when there is none. */
export function onlyInSentence(c: Counts): string | null {
  const only: string[] = [];
  if (c.pagesOnlyEarlier > 0) only.push(`${count(c.pagesOnlyEarlier, 'page')} ${c.pagesOnlyEarlier === 1 ? 'is' : 'are'} only in the earlier version`);
  if (c.pagesOnlyLater > 0) only.push(`${count(c.pagesOnlyLater, 'page')} ${c.pagesOnlyLater === 1 ? 'is' : 'are'} only in the later version`);
  return only.length > 0 ? `${only.join('; ')}.` : null;
}

/**
 * The message: "7 of 42 pages differ." (pages in both versions, of the later version's pages). When no page in
 * both versions differs but some are in one version only, it leads with them.
 */
export function differLine(c: Counts): string {
  const only = onlyInSentence(c);
  if (c.pagesDiffer === 0 && only) return `No page that is in both versions differs. ${only}`;
  return `${ofLater(c)}.`;
}

/** The record's summary: "Compared 2 files: 7 of 42 pages differ", then any pages in one version only (counts). */
export function summary(c: Comparison): string {
  const only: string[] = [];
  if (c.pagesOnlyEarlier > 0) only.push(`${count(c.pagesOnlyEarlier, 'page')} only in the earlier version`);
  if (c.pagesOnlyLater > 0) only.push(`${count(c.pagesOnlyLater, 'page')} only in the later version`);
  return `${SUMMARY}: ${ofLater(c)}${only.length > 0 ? `; ${only.join(', ')}` : ''}`;
}

/** The comparison's counts, by name. */
const COUNT_KEYS = [
  'pagesEarlier',
  'pagesLater',
  'pagesDiffer',
  'pagesOnlyEarlier',
  'pagesOnlyLater',
  'wordsAdded',
  'wordsRemoved',
  'wordsChanged',
  'pagesWithoutText',
  'pagesComparedCoarsely',
] as const satisfies readonly (keyof Comparison)[];

/** The record's options: the comparison's counts, nothing else (contract section 3, CMP). Each is a count (a whole number from 0). */
export const RECORD_KEYS: readonly string[] = COUNT_KEYS;

export function recordOptions(c: Comparison): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of COUNT_KEYS) out[key] = c[key];
  return out;
}

/** What the run says when a report was made: the count, then what to keep in mind. */
export function resultDescription(c: Comparison, report: { wordsNotShown: number }, name: string): Description {
  const parts: string[] = [];
  // When no page in both versions differs, the message itself says this.
  const only = onlyInSentence(c);
  if (only && c.pagesDiffer > 0) parts.push(only);
  parts.push(`The report ${name} lists each change with the words around it.`);
  const rest = pagesThatDiffer(c) - MAX_DETAILED_PAGES;
  if (rest > 0) parts.push(`It details the first ${MAX_DETAILED_PAGES} pages that differ and counts the other ${grouped(rest)}.`);
  if (c.pagesComparedCoarsely > 0) {
    const n = c.pagesComparedCoarsely;
    parts.push(`${count(n, 'very long page')} ${n === 1 ? 'was' : 'were'} compared in larger pieces, so some changes there are shown as whole passages.`);
  }
  if (c.pagesWithoutText > 0) parts.push(`${count(c.pagesWithoutText, 'page')} ${c.pagesWithoutText === 1 ? 'has' : 'have'} no text to compare; ${c.pagesWithoutText === 1 ? 'it' : 'they'} may be scanned.`);
  if (report.wordsNotShown > 0) {
    const n = report.wordsNotShown;
    parts.push(`${count(n, 'word')} in another script could not be printed and ${n === 1 ? 'is' : 'are'} shown as [word in another script].`);
  }
  return { message: differLine(c), detail: parts.join(' '), tone: 'success' };
}

/** Identical text: no result. */
export function noDifferencesDescription(): Description {
  return { message: NO_DIFFERENCES, detail: `The two versions have the same words in the same order. ${NOTHING_ADDED}` };
}
