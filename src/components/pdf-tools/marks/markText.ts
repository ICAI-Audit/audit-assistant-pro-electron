// The words a mark may hold, checked as the user types, in the marks library's own words: the
// characters the built-in fonts can write, the tokens each kind of text accepts, and how a list of
// pages is written in a note. The library checks the same things again when it runs.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { unsupportedError } from '@/lib/pdf-tools/marks';
import { formatPageList } from '@/lib/pdf-tools/pageList';
import { fillMarkTokens } from '@/lib/pdf-tools/watermark';

export interface TokenHelpItem {
  token: string;
  meaning: string;
}

/** What a watermark or stamp text may use (design 5.16). */
export const MARK_TOKEN_HELP: readonly TokenHelpItem[] = [
  { token: '{date}', meaning: 'the date the tool runs' },
  { token: '{client}', meaning: "this engagement's client name" },
];

/** What a header or footer line may use (design 5.17). */
export const HEADER_TOKEN_HELP: readonly TokenHelpItem[] = [
  { token: '{page}', meaning: 'the page number, in the chosen style' },
  { token: '{pages}', meaning: 'the number of numbered pages' },
  { token: '{file}', meaning: 'the file name' },
  { token: '{name}', meaning: 'the file name without .pdf' },
  { token: '{date}', meaning: 'the date the tool runs' },
  { token: '{client}', meaning: "this engagement's client name" },
  { token: '{fy}', meaning: "this engagement's financial year" },
];

export const MARK_TEXT_MAX = 60;

export type MarkWhat = 'watermark' | 'stamp';

/** Whether `text` uses `{name}` (any letter case). */
export function usesToken(text: string, name: string): boolean {
  return text.toLowerCase().includes(`{${name.toLowerCase()}}`);
}

/**
 * Names the first brace token of a watermark or stamp text that is not `{date}` or `{client}`, in
 * the words of watermark.ts (whose own check is not exported). A brace that does not close is text.
 */
export function markTokenError(text: string, what: MarkWhat): string | null {
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!/^(date|client)$/i.test(m[1])) return `The ${what} text has {${m[1]}}, which is not a known name. Use {date} or {client}.`;
  }
  return null;
}

/** The characters of a text the built-in fonts cannot write, each once. */
export type CharacterCheck = (text: string) => string[];

let loading: Promise<CharacterCheck> | null = null;

/**
 * The character list of the standard fonts the marks use. Every one of them (Helvetica, Times and
 * Courier, in any weight) writes the same Windows Latin-1 set, so one font's list serves them all.
 * Loaded once; until it has, a check finds nothing and the library's own check still refuses.
 */
export function loadCharacterCheck(): Promise<CharacterCheck> {
  if (!loading) {
    loading = (async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const supported = new Set(font.getCharacterSet());
      return (text: string) => [...new Set([...text].filter((ch) => !supported.has(ch.codePointAt(0)!)))];
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** The library's message for characters it cannot print in `subject`, or null. */
export function charactersError(check: CharacterCheck | null, text: string, subject: string): string | null {
  if (!check) return null;
  const bad = check(text);
  return bad.length > 0 ? unsupportedError(subject, bad, text).message : null;
}

/**
 * The first problem with a watermark or stamp text, in the order and words of the library: its
 * length, its tokens, the characters typed, then the characters the date and client name bring in.
 */
export function markTextError(text: string, what: MarkWhat, check: CharacterCheck | null, tokens: { date: string; client: string }): string | null {
  if ([...text.trim()].length < 1 || [...text].length > MARK_TEXT_MAX) return `Enter ${what} text of 1 to ${MARK_TEXT_MAX} characters.`;
  const problem =
    markTokenError(text, what) ??
    charactersError(check, text, `${what} text`) ??
    charactersError(check, fillMarkTokens(text, tokens), `client name or date used in the ${what} text`);
  if (problem) return problem;
  // {client} with no client name would print nothing, and the run would say it added the mark (REV-B minor 9).
  if (fillMarkTokens(text, tokens).trim() === '') return `This engagement has no client name, so the ${what} would be empty. Type the text instead.`;
  return null;
}

/**
 * `token` put into `value` at the caret (or over the selection), with a space before it when it would
 * otherwise touch a word; the caret goes after it.
 */
export function insertToken(value: string, start: number | null, end: number | null, token: string): { value: string; caret: number } {
  const from = Math.min(start ?? value.length, value.length);
  const to = Math.max(from, Math.min(end ?? from, value.length));
  const before = value.slice(0, from);
  const spaced = before !== '' && /\S$/.test(before) ? ` ${token}` : token;
  return { value: `${before}${spaced}${value.slice(to)}`, caret: before.length + spaced.length };
}

const LIST_PARTS = 8;

/** "page 3", "pages 1-3, 8", or the first eight parts "and N more" for a long list. */
export function pagesInWords(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 1) return `page ${sorted[0]}`;
  const parts = formatPageList(sorted.map((p) => p - 1)).split(', ');
  if (parts.length <= LIST_PARTS) return `pages ${parts.join(', ')}`;
  const shown = parts.slice(0, LIST_PARTS);
  const listed = shown.reduce((n, part) => {
    const [a, b] = part.split('-').map(Number);
    return n + (b ? b - a + 1 : 1);
  }, 0);
  return `pages ${shown.join(', ')} and ${sorted.length - listed} more`;
}
