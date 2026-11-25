import { PdfToolsError } from '@/lib/pdf-tools/types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The message to show for a failure: a PdfToolsError's own words, never a library's raw text. */
export function plainMessage(error: unknown, fallback = 'This file could not be read. It may be damaged.'): string {
  return error instanceof PdfToolsError ? error.message : fallback;
}

/** "1 result not saved yet", "3 results not saved yet": the list bar's one amber line (UX audit C3.2). */
export function unsavedLine(count: number): string {
  return `${plural(count, 'result')} not saved yet`;
}

/**
 * What happens to results not saved, and how to keep them (QA-FIX K): the list is cleared when the
 * engagement or user changes (confidentiality) and when VERA closes; the list bar's count says so, and a
 * click on it saves them all.
 */
export function unsavedWarning(count: number): string {
  return count === 1
    ? '1 result is not saved. It is cleared when the engagement changes or VERA closes; click to save it.'
    : `${count} results are not saved. They are cleared when the engagement changes or VERA closes; click to save them all.`;
}

/** How long a run has taken: "12 s", "1 min", "2 min 26 s" (QA-FIX I: a long step must never look hung). */
export function elapsedText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** Characters a long name keeps in view at its end (about the last three or four words). */
const NAME_TAIL = 24;

/**
 * A name split for the screen (QA-FIX G): when the space is short, the start is cut with "…" and the end
 * stays in view, where names differ ("…final copy v3 revised.pdf"). The end starts at a word where one is
 * near. `head + tail` is always the whole name; a short name is all head.
 */
export function nameEnds(name: string): { head: string; tail: string } {
  if (name.length <= 40) return { head: name, tail: '' };
  let start = name.length - NAME_TAIL;
  const space = name.lastIndexOf(' ', start);
  // The end takes the space before its first word: a space at the end of the cut start would be dropped
  // by the browser, joining the two words ("Q1Apr-Jun").
  if (space >= 0 && start - space <= 10) start = space;
  if (/[\uDC00-\uDFFF]/.test(name[start] ?? '')) start -= 1;
  return { head: name.slice(0, start), tail: name.slice(start) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The application's date: "13 Nov 2026" (dd MMM yyyy, as the Evidence Vault shows it; UX audit C9),
 * in local time, whatever the system's locale. An invalid date gives ''.
 */
export function shortDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** A SQLite timestamp ("YYYY-MM-DD HH:MM:SS", written in UTC) as shortDate; '' when it cannot be read. */
export function shortDateOfStored(text: string): string {
  return shortDate(new Date(/Z|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`));
}
