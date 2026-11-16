// Redact: from the review (reviewState.ts) and the dialog's choices to what the run takes
// (RedactRunOptions), and the confirmation step's facts (design 5.9 "What the user sees", step 3).
// Pure; the dialog and the tests use the same mapping.
//
// Confidentiality: the options carry values (areas' keys, targets, the find's page texts) to the run in
// memory. The confirmation's facts are counts and page numbers; the "stays visible" warning's values are
// shown to the user by the dialog (that is its purpose) and go nowhere else.
import type { PageTextModel } from '@/lib/pdf-tools/pageText';
import { MAX_PLACES } from '@/lib/pdf-tools/redactFind';
import type { RedactRunOptions } from './redactRun';
import { estimateBytes, pagesInWords, tokenError, type RedactDpi, type RedactMode, type RedactOutput, type ReplacementStyle } from './redactRecord';
import { areasToRedact, checkTargets, confirmSummary, tickedCount, type ReviewState } from './reviewState';

export interface RedactChoices {
  mode: RedactMode;
  style: ReplacementStyle;
  token: string;
  output: RedactOutput;
  dpi: RedactDpi;
}

export const DEFAULT_CHOICES: RedactChoices = { mode: 'remove', style: 'token', token: '[REDACTED]', output: 'searchable', dpi: 200 };

/**
 * Why Redact cannot run with these choices and this review, or null. Never repeats a value or a token. `searching`
 * (wave 6, T-048): a typed word is still being searched, so the review does not yet hold its places.
 */
export function choicesError(choices: RedactChoices, state: ReviewState, searching = false): string | null {
  if (searching) return 'Wait until your words have been searched.';
  if (choices.mode === 'replace' && choices.style === 'token') {
    const problem = tokenError(choices.token);
    if (problem) return problem;
  }
  const ticked = tickedCount(state);
  if (ticked > MAX_PLACES) return `${ticked.toLocaleString('en-IN')} places are ticked. Redact can remove at most ${MAX_PLACES.toLocaleString('en-IN')} in one run: untick a kind of data, or the places on some pages, and redact the rest in a second run.`;
  if (ticked === 0 && state.drawn.length === 0) return 'Tick or draw at least one area to redact.';
  return null;
}

/** The run's options from the review: built when the user confirms, never kept after the run. */
export function runOptionsFrom(
  state: ReviewState,
  found: { models: PageTextModel[]; autoBoxesDropped: number },
  choices: RedactChoices,
  fileId: string,
  extra: Pick<RedactRunOptions, 'confirmFlatten' | 'name'> = {},
): RedactRunOptions {
  const summary = confirmSummary(state);
  return {
    fileId,
    areas: areasToRedact(state),
    models: found.models,
    targets: checkTargets(state),
    mode: choices.mode,
    replacement: { style: choices.style, token: choices.token.trim() },
    output: choices.output,
    dpi: choices.dpi,
    counts: summary.countsByKind,
    ticked: tickedCount(state),
    valuesLeftVisible: summary.leftVisible.length,
    autoBoxesDropped: found.autoBoxesDropped,
    ...extra,
  };
}

/** The confirmation step's facts (design 5.9): areas, pages made pictures, pages copied unchanged, the size estimate. */
export interface ConfirmFacts {
  areas: number;
  /** 0-based pages that become pictures. */
  pages: number[];
  /** Wave 6 (T-048, ruling M): 0-based pages without an area that will be made pictures too, because they may not be copied. */
  pagesAlso: number[];
  /** Wave 6: which pages may not be copied is not known yet (the file is still being read): more pages may become pictures. */
  alsoUnknown: boolean;
  pagesUnchanged: number;
  /** Rebuilt pages without text: only their drawn boxes remove anything. */
  pagesWithoutText: number[];
  estimate: number;
}

/**
 * `charsOf` (wave 4): the characters on a page (white space aside), for the size estimate; absent, an ordinary page is
 * assumed. `notPlain` (wave 6, T-048): the pages that may not be copied (redactCheck.ts pageDrawingsAndVerdicts,
 * `plain: false`): those without an area are made pictures too, and counted in the size; `null` while they are not
 * known yet; absent, none.
 */
export function confirmFacts(
  state: ReviewState,
  pageCount: number,
  pagesWithoutText: readonly number[],
  dpi: RedactDpi,
  charsOf?: (page: number) => number,
  notPlain?: readonly number[] | null,
): ConfirmFacts {
  const summary = confirmSummary(state);
  const noText = new Set(pagesWithoutText);
  const chosen = new Set(summary.pages);
  const also = [...new Set(notPlain ?? [])].filter((p) => !chosen.has(p) && p >= 0 && p < pageCount).sort((a, b) => a - b);
  const rebuilt = [...summary.pages, ...also];
  const scans = summary.pages.filter((p) => noText.has(p));
  const textPages = rebuilt.filter((p) => !noText.has(p));
  return {
    areas: summary.areas,
    pages: summary.pages,
    pagesAlso: also,
    alsoUnknown: notPlain === null,
    pagesUnchanged: Math.max(0, pageCount - rebuilt.length),
    pagesWithoutText: scans,
    estimate: estimateBytes(textPages.length, rebuilt.filter((p) => noText.has(p)).length, dpi, charsOf ? textPages.reduce((n, p) => n + charsOf(p), 0) : undefined),
  };
}

/**
 * "14 areas on 3 pages will be removed. Pages 2, 5 and 7 will become pictures of the page; the other 37 pages are copied
 * unchanged." Wave 6 (T-048): pages made pictures because they may not be copied are named ("pages 8-20 will also
 * become pictures, to be safe"); while that is not known, the sentence says some pages may, and claims no page is copied.
 */
export function confirmSentence(facts: ConfirmFacts): string {
  const n = facts.pages.length;
  const list = facts.pages.map((p) => p + 1);
  const pagesText = n === 1 ? `Page ${list[0]} will become a picture of the page` : `Pages ${list.slice(0, -1).join(', ')} and ${list[n - 1]} will become pictures of the page`;
  const also = facts.pagesAlso.length === 0 ? '' : `; ${pagesInWords(facts.pagesAlso)} will also become ${facts.pagesAlso.length === 1 ? 'a picture' : 'pictures'}, to be safe`;
  const rest = facts.alsoUnknown
    ? '; some other pages may also be made pictures, to be safe'
    : facts.pagesUnchanged === 0
      ? ''
      : `; the other ${facts.pagesUnchanged === 1 ? 'page is' : `${facts.pagesUnchanged} pages are`} copied unchanged`;
  return `${facts.areas} ${facts.areas === 1 ? 'area' : 'areas'} on ${n} ${n === 1 ? 'page' : 'pages'} will be removed. ${pagesText}${also}${rest}.`;
}
