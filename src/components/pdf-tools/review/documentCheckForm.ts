// The Document check dialog's words, its record and its result message (T-064, contract REV; design 5.13).
// Pure. The record holds counts and the protection choice only (RECORD_KEYS): never a property value, a
// signer's name, a reason, a place or a file's title. The facts themselves are shown on screen and in the
// report (documentCheck.ts factRows), which is what the tool is for.
import { SIGNATURE_CHECK_NOTE, type DocumentFacts } from '@/lib/pdf-tools/documentCheck';
import { OTHER_SCRIPT } from '@/lib/pdf-tools/checkReport';
import { plural } from '../format';
import type { Description } from '../toolStep';

/** The record's first words (resultNames.ts operationSummary('document-check') says the same). */
export const SUMMARY = 'Document check';

/** "Document check: 12 pages". */
export function summary(facts: Pick<DocumentFacts, 'pageCount'>): string {
  return `${SUMMARY}: ${plural(facts.pageCount, 'page')}`;
}

/** The only keys of the record's options (activity.ts RESTRICTED_OPTIONS for 'document-check' is built from these). */
export const RECORD_KEYS = ['pages', 'signatures', 'pagesWithText', 'pagesScanned', 'protection'] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];

/** Counts and one choice: what was checked, never what the file says. */
export function recordOptions(facts: DocumentFacts): Record<RecordKey, number | string> {
  return {
    pages: facts.pageCount,
    signatures: facts.signatures.length,
    pagesWithText: facts.text.pagesWithText,
    pagesScanned: facts.text.pagesScanned,
    protection: facts.protection,
  };
}

export const DESCRIPTION = 'See what this PDF holds, read on this computer. Add the facts to the list as a PDF report.';
export const RUN_LABEL = 'Add report to list';
/** Contract decision 15, word for word. */
export const SIGNED_WARNING = 'This file is signed. The result is a new file; the signed original is unchanged.';
export const REPORT_NAME_LABEL = 'Report name';
export const READING_FILE = 'Reading the file…';
export const WRITING_LABEL = 'Writing the report…';
export const CHECK_STOPPED = 'The check was stopped.';
export const CHECK_AGAIN = 'Check again';
export const BLOCKED_WHILE_READING = 'Wait for the check to finish, or stop it.';
/** For a result made from a signed file (signatureInvalid): a signature it still holds is not this copy's. */
export const MADE_FROM_SIGNED_NOTE = 'This copy was made in PDF Tools from a signed file. A signature still in it does not apply to this copy; check the signed original.';

export function readingLabel(page: number, total: number): string {
  return `Reading page ${page} of ${total}`;
}

/** The run's message: what was added; the signature note when the file has any; the words the report could not print. */
export function resultDescription(name: string, notes: { signatures: number; wordsNotShown: number }): Description {
  const parts: string[] = [];
  if (notes.signatures > 0) parts.push(SIGNATURE_CHECK_NOTE);
  if (notes.wordsNotShown > 0) {
    const n = notes.wordsNotShown;
    parts.push(`${plural(n, 'word')} in another script ${n === 1 ? 'is' : 'are'} shown as ${OTHER_SCRIPT}.`);
  }
  const description: Description = { message: `Report added: ${name}`, tone: 'success' };
  if (parts.length > 0) description.detail = parts.join(' ');
  return description;
}
