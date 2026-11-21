// Make searchable (T-064, OCR part A): what the user is told about how far recognised text can be relied on, from
// the OCR trial's findings (OCR-SPIKE-report.md section 5). There is deliberately no single percentage: the engine
// was 91% sure of a page it had read 0.5% of, so a figure would reassure where it should not.
//
// Per page:
// - words: words recognised, ruling-line marks left out;
// - low confidence: words below 80. In the trial, marking amounts below 80 caught 46 of 55 wrong amounts and also
//   marked 20 of 383 right ones (below 90: 52 of 55, but 69 right ones), so 80 points at the doubtful ones without
//   burying them; about one wrong amount in six is still above it, which is why the message always says to check
//   numbers against the page;
// - numbers to check: low-confidence words that hold a digit;
// - looks faint: a tenth or more of the words are below 80, or almost nothing was read for the page's size (fewer
//   than 0.1 words a square inch, under 10 words on A4). Every good trial page had at most 3.5% of its words below
//   80 (the lightly faded ledger 8%, which still read 61 of 70 amounts); every bad one had 11.4% or more (phone photo
//   of a ledger 12.4%, 65 of 70 amounts and 75% of characters; faint photocopy 46%, 22 of 70). Good pages held 2.5 to
//   3 words a square inch; the faint page read with the wrong threshold gave 2 words on A4 (0.02). A cover page with
//   a few words is also called faint: a cheap false alarm, it only asks the user to look;
// - no words: nothing was found (a blank back of a sheet, or a page too faint to read): said on its own, not as faint.
//
// Part C (T-064): the figures are made on the words that went into the searchable text, after the words the
// engine could not read were left out (ocrReadable.ts); `leftOut` is how many were. A real two-language scan
// was called "faint" on every page with "132 numbers to check": half of each page was in another script, and
// most of those numbers were digits inside nonsense. So:
// - partly read: a tenth or more of what the engine saw on the page was left out (PARTLY_READ_SHARE). Pages the
//   engine read well lose about 7% at most (26 of 28 clean pages and office scans measured; two office scans of
//   ruled pages lose about 14% and 32%); two-language pages lose 30% to 72%, faint photocopies up to 77%. The message says it in one sentence that names the likely reasons; such a page is not also
//   called faint, and a page where nothing at all could be kept is said this way too, not as "may be blank".
// - little read (T-064, after the last verification): a partly read page of which more was left out than kept, or on
//   which what was kept is thin for the page's size (under one word a square inch, LITTLE_READ_WORDS_PER_SQUARE_INCH:
//   under 97 words on A4). "Parts of the page could not be read" understated a faint photocopy of which 13 of 353
//   words were read right: the engine saw about 50 words there, doubted a sixth of them and kept the rest. On the 46
//   pages measured, every page read well kept 1.9 words a square inch or more (181 to 513 words on A4); the faint
//   photocopies that were mostly lost kept 46 to 93 words with 13% to 23% left out, and the two-language pages left
//   out more than they kept. The message then says that little could be read, and does not call the page recognised.
//   Only for a page that is partly read: a page of few words read without doubt (a cover page) is not said this way.
import type { OcrPlan } from './ocrPlan';
import { isRulingMark, type LayerReport, type RecognisedPage } from './ocrTypes';

export const LOW_CONFIDENCE = 80;
export const FAINT_LOW_SHARE = 0.1;
export const FAINT_WORDS_PER_SQUARE_INCH = 0.1;
export const PARTLY_READ_SHARE = 0.1;
export const LITTLE_READ_WORDS_PER_SQUARE_INCH = 1;
const POINTS_PER_INCH = 72;

export interface PageQuality {
  pageIndex: number;
  /** Words in the searchable text. */
  words: number;
  lowConfidence: number;
  numbersToCheck: number;
  /** Words the engine could not read, left out of the searchable text. */
  leftOut: number;
  partlyRead: boolean;
  /** Partly read, and more was left out than kept or what was kept is thin for the page's size. */
  littleRead: boolean;
  looksFaint: boolean;
  noWords: boolean;
}

/**
 * The figures of one recognised page: `recognised` holds the words kept for the searchable text, `leftOut` how
 * many were left out as unreadable (ocrReadable.ts), `shown` the page's size as displayed, in points.
 */
export function pageQuality(pageIndex: number, recognised: RecognisedPage, shown: { width: number; height: number }, leftOut = 0): PageQuality {
  let words = 0;
  let lowConfidence = 0;
  let numbersToCheck = 0;
  for (const word of recognised.words) {
    const text = typeof word.text === 'string' ? word.text.trim() : '';
    if (text === '' || isRulingMark(text)) continue;
    words += 1;
    if (!(word.confidence >= LOW_CONFIDENCE)) {
      lowConfidence += 1;
      if (/\d/.test(text)) numbersToCheck += 1;
    }
  }
  const squareInches = (shown.width * shown.height) / (POINTS_PER_INCH * POINTS_PER_INCH);
  const out = Number.isFinite(leftOut) && leftOut > 0 ? Math.round(leftOut) : 0;
  const partlyRead = out > 0 && out >= PARTLY_READ_SHARE * (words + out);
  const looksFaint = !partlyRead && words > 0 && (lowConfidence >= FAINT_LOW_SHARE * words || (squareInches > 0 && words / squareInches < FAINT_WORDS_PER_SQUARE_INCH));
  const littleRead = partlyRead && (out > words || (squareInches > 0 && words / squareInches < LITTLE_READ_WORDS_PER_SQUARE_INCH));
  return { pageIndex, words, lowConfidence, numbersToCheck, leftOut: out, partlyRead, littleRead, looksFaint, noWords: words === 0 && !partlyRead };
}

/** What happened to one page that was to be recognised. */
export type PageOutcome =
  | { pageIndex: number; status: 'recognised'; quality: PageQuality; layer: LayerReport }
  | { pageIndex: number; status: 'timed-out' }
  /** The engine failed on the page, or the page could not be drawn: left exactly as it was (ruling of 18 November 2026). */
  | { pageIndex: number; status: 'failed' };

/** The run's figures. Counts go to the record (ocrForm.ts RECORD_KEYS); the page lists (numbered from 1) only to the message. */
export interface OcrReport {
  pages: number;
  /** Pages recognised, including those where no word was found. */
  pagesRecognised: number;
  pagesWithText: number;
  pagesEmpty: number;
  /** Pages left as they were because they could not be read: their text could not be counted, or recognising them failed. */
  pagesUnread: number;
  /** Pages left as they were without running out of time: with text, empty, unread, or failed. With pagesRecognised and pagesTimedOut it adds up to pages. */
  pagesSkipped: number;
  pagesTimedOut: number;
  pagesFaint: number;
  pagesNoWords: number;
  words: number;
  lowConfidenceWords: number;
  numbersToCheck: number;
  charactersDropped: number;
  /** Words the engine could not read, left out of the searchable text. */
  wordsLeftOut: number;
  /** Pages of which a tenth or more was left out. */
  pagesPartlyRead: number;
  timedOutPages: number[];
  faintPages: number[];
  partlyReadPages: number[];
  /** The partly read pages of which little was read (for the message only; they are in partlyReadPages too). */
  littleReadPages: number[];
  noWordPages: number[];
  /** Pages with at least one number to check. */
  numberPages: number[];
  unreadPages: number[];
}

export function buildReport(plan: OcrPlan, outcomes: readonly PageOutcome[]): OcrReport {
  const sorted = [...outcomes].sort((a, b) => a.pageIndex - b.pageIndex);
  const done = sorted.filter((o): o is Extract<PageOutcome, { status: 'recognised' }> => o.status === 'recognised');
  const pageNumbers = (list: readonly { pageIndex: number }[]) => list.map((o) => o.pageIndex + 1);
  const sum = (pick: (o: (typeof done)[number]) => number) => done.reduce((n, o) => n + pick(o), 0);
  const timedOut = sorted.filter((o) => o.status === 'timed-out');
  const failed = sorted.filter((o) => o.status === 'failed');
  const unreadPages = [...plan.pages.filter((p) => p.kind === 'unread' && !p.recognise).map((p) => p.pageIndex + 1), ...pageNumbers(failed)].sort((a, b) => a - b);
  const faint = done.filter((o) => o.quality.looksFaint);
  const noWords = done.filter((o) => o.quality.noWords);
  const partlyRead = done.filter((o) => o.quality.partlyRead);
  return {
    pages: plan.total,
    pagesRecognised: done.length,
    pagesWithText: plan.withText,
    pagesEmpty: plan.empty,
    pagesUnread: unreadPages.length,
    pagesSkipped: plan.total - plan.toRecognise.length + failed.length,
    pagesTimedOut: timedOut.length,
    pagesFaint: faint.length,
    pagesNoWords: noWords.length,
    words: sum((o) => o.quality.words),
    lowConfidenceWords: sum((o) => o.quality.lowConfidence),
    numbersToCheck: sum((o) => o.quality.numbersToCheck),
    charactersDropped: sum((o) => o.layer.charactersDropped),
    wordsLeftOut: sum((o) => o.quality.leftOut),
    pagesPartlyRead: partlyRead.length,
    timedOutPages: pageNumbers(timedOut),
    faintPages: pageNumbers(faint),
    partlyReadPages: pageNumbers(partlyRead),
    littleReadPages: pageNumbers(partlyRead.filter((o) => o.quality.littleRead)),
    noWordPages: pageNumbers(noWords),
    numberPages: pageNumbers(done.filter((o) => o.quality.numbersToCheck > 0)),
    unreadPages,
  };
}
