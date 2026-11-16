// Redact's record and words (design 5.9 "Result and record"): counts and choices only, the twelve keys
// the activity record keeps, the summary line, and sentences that never hold a value.
import { describe, expect, it } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { summaryWithNotes } from '@/lib/pdf-tools/resultNames';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { KIND_LABELS } from '@/lib/pdf-tools/redactPatterns';
import type { Proposal } from '@/lib/pdf-tools/redactFind';
import { choicesError, confirmFacts, confirmSentence, DEFAULT_CHOICES } from './redactChoices';
import { initialReview, reviewReducer } from './reviewState';
import {
  COUNT_NAMES,
  countsText,
  DEFAULT_TOKEN,
  estimateBytes,
  flattenDeclined,
  flattenQuestion,
  notVerified,
  REDACT_LIMITS,
  REDACTED_NAME,
  textCoveredSentence,
  redactRecord,
  replacementRecord,
  resultNotes,
  safeResultName,
  tokenError,
  WITHHELD_NAME,
  type RedactOutcome,
} from './redactRecord';

const TWELVE = ['areas', 'pagesRebuilt', 'pagesRebuiltHidden', 'counts', 'mode', 'replacement', 'output', 'dpi', 'valuesLeftVisible', 'textLayerCharsOmitted', 'autoBoxesDropped', 'bookmarksRemoved'];

const outcome = (over: Partial<RedactOutcome> = {}): RedactOutcome => ({
  areas: 14,
  pagesWithAreas: 3,
  pagesRebuilt: 3,
  pagesRebuiltHidden: 0,
  pagesFlattened: 0,
  counts: { pan: 6, aadhaar: 2, typed: 3, drawn: 3 },
  mode: 'remove',
  replacement: 'token-default',
  output: 'searchable',
  dpi: 200,
  valuesLeftVisible: 0,
  textLayerCharsOmitted: 18,
  autoBoxesDropped: 0,
  bookmarksRemoved: 0,
  ...over,
});

function resultFile(record: { summary: string; options: Record<string, string | number> }, flags: Record<string, boolean> = {}): WorkingFile {
  return {
    id: 'r1',
    name: 'Letter_redacted.pdf',
    bytes: new Uint8Array([1]),
    kind: 'pdf',
    mimeType: 'application/pdf',
    pageCount: 4,
    size: 1,
    origin: 'result',
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
    operation: { tool: 'redact', summary: summaryWithNotes(record.summary, flags), sources: [{ name: 'Letter.pdf', origin: 'computer' }], options: record.options, flags },
  } as WorkingFile;
}

describe('the record', () => {
  it('holds exactly the twelve keys, and the activity entry keeps all of them', () => {
    const record = redactRecord(outcome());
    expect(Object.keys(record.options).sort()).toEqual([...TWELVE].sort());
    const entry = buildActivityEntry({ file: resultFile(record), destination: 'computer', sha256: 'a'.repeat(64) });
    const kept = (entry.metadata as { options: Record<string, unknown> }).options;
    expect(Object.keys(kept).sort()).toEqual([...TWELVE].sort());
    expect(kept.counts).toBe('PAN 6, Aadhaar 2, typed 3, drawn 3');
  });

  it('says the summary of design 5.9, with the flags\' notes', () => {
    const record = redactRecord(outcome());
    expect(summaryWithNotes(record.summary, { textLayerIncomplete: true })).toBe(
      'Redacted 14 areas on 3 pages (PAN 6, Aadhaar 2, typed 3, drawn 3); searchable, 200 dpi; some text on redacted pages is not searchable',
    );
    expect(redactRecord(outcome({ output: 'picture', dpi: 300, areas: 1, pagesWithAreas: 1, counts: { drawn: 1 } })).summary).toBe('Redacted 1 area on 1 page (drawn 1); picture only, 300 dpi');
  });

  it('says when pages were flattened on the user\'s confirmation', () => {
    expect(redactRecord(outcome({ pagesFlattened: 2 })).summary).toMatch(/; 2 pages flattened on the user's confirmation$/);
  });

  it('every kind\'s count name passes the activity record\'s shape', () => {
    const all = { pan: 1, aadhaar: 1, gstin: 1, tan: 1, 'tax-din': 1, email: 1, mobile: 1, 'bank-account': 1, ifsc: 1, micr: 1, 'itr-ack': 1, evc: 1, ip: 1, name: 1, address: 1, addressee: 1, typed: 1, drawn: 1, 'same-text': 1, marked: 1 } as const;
    const record = redactRecord(outcome({ counts: all }));
    const entry = buildActivityEntry({ file: resultFile(record), destination: 'computer', sha256: 'b'.repeat(64) });
    expect((entry.metadata as { options: Record<string, unknown> }).options.counts).toBe(countsText(all));
    // A long list is cut to the record's 200 characters by summing its last kinds.
    const many = Object.fromEntries(Object.keys(all).map((k) => [k, 4999]));
    const text = countsText(many);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).toMatch(/, others \d+$/);
    const big = buildActivityEntry({ file: resultFile(redactRecord(outcome({ counts: many }))), destination: 'computer', sha256: 'c'.repeat(64) });
    expect((big.metadata as { options: Record<string, unknown> }).options.counts).toBe(text);
  });

  it('every kind the patterns know has a count name that passes the activity record (RX-PAT widened the kinds)', () => {
    const kinds = Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[];
    expect(kinds.length).toBeGreaterThan(20);
    for (const kind of kinds) expect(COUNT_NAMES[kind], kind).toMatch(/^[A-Za-z][A-Za-z .-]*$/);
    const counts = Object.fromEntries(kinds.map((k) => [k, 2]));
    const entry = buildActivityEntry({ file: resultFile(redactRecord(outcome({ counts }))), destination: 'computer', sha256: 'e'.repeat(64) });
    expect((entry.metadata as { options: Record<string, unknown> }).options.counts).toBe(countsText(counts));
    expect(countsText(counts)).not.toMatch(/undefined/);
  });

  it('a custom token is recorded only as "token-custom"; label and masked as themselves', () => {
    expect(replacementRecord('remove', 'token', DEFAULT_TOKEN)).toBe('token-default');
    expect(replacementRecord('replace', 'token', 'NOTE')).toBe('token-custom');
    expect(replacementRecord('replace', 'label', 'NOTE')).toBe('label');
    expect(replacementRecord('replace', 'masked', 'NOTE')).toBe('masked');
    const record = redactRecord(outcome({ mode: 'replace', replacement: replacementRecord('replace', 'token', 'NOTE') }));
    expect(JSON.stringify(record)).not.toContain('NOTE');
    expect(record.options.replacement).toBe('token-custom');
  });
});

describe('choices', () => {
  it('a token is 1 to 30 letters, digits, spaces and [ ] ( ) - / .; the reason never repeats it', () => {
    expect(tokenError('[REDACTED]')).toBeNull();
    expect(tokenError('Withheld (s.138)')).toBeNull();
    expect(tokenError('')).toMatch(/1 to 30/);
    expect(tokenError('x'.repeat(31))).toMatch(/1 to 30/);
    const bad = tokenError('PAN: SECRETVALUE#1');
    expect(bad).toMatch(/letters, digits/);
    expect(bad).not.toContain('SECRETVALUE');
  });

  it('wave 4 (T3-C should-fix 3): estimates a text page by its characters (20 KB and 80 bytes a character at 200 dpi), 800 KB a page without text; 0.6 and 2.3 times at 150 and 300', () => {
    // A dense statement page (about 2,260 characters): about 200 KB (the application made 168 KB; the old figure was 35 KB).
    expect(estimateBytes(1, 0, 200, 2260)).toBe(20_000 + 2260 * 80);
    // Twenty such pages: about 4 MB against 3.37 MB made (within 30%; the old figure, 0.8 MB, was four times too small).
    expect(estimateBytes(20, 0, 200, 20 * 2260) / 3_370_000).toBeGreaterThan(0.7);
    expect(estimateBytes(20, 0, 200, 20 * 2260) / 3_370_000).toBeLessThan(1.3);
    expect(estimateBytes(10, 1, 200, 0)).toBe(200_000 + 800_000);
    expect(estimateBytes(10, 0, 150, 10_000)).toBe(Math.round((200_000 + 800_000) * 0.6));
    expect(estimateBytes(10, 0, 300, 10_000)).toBe(Math.round((200_000 + 800_000) * 2.3));
    // Without a count of characters, a page of ordinary text (1,200 characters) is assumed.
    expect(estimateBytes(1, 0, 200)).toBe(20_000 + 1200 * 80);
  });
});

describe('words', () => {
  it('a result that cannot be verified names pages and places, says nothing was added, and gives a next step', () => {
    const error = notVerified({ pages: [3], elsewhere: ['bookmarks'] });
    expect(error.code).toBe('redact-check-failed');
    expect(error.message).toBe(
      'The redacted file could not be verified: redacted text was still found in it (page 4, bookmarks). Nothing was added. Draw a box over that text, or untick that value, and run Redact again.',
    );
  });

  it('the flatten question and its refusal name pages only', () => {
    expect(flattenQuestion([3, 6]).title).toBe('Flatten these 2 pages?');
    expect(flattenQuestion([3]).body).toMatch(/^Page 4 holds redacted text/);
    expect(flattenDeclined([3, 4, 5]).message).toMatch(/^Pages 4-6 still hold redacted text where no box can cover it, and they were not flattened\. Nothing was added\./);
  });

  it('B5: the question never says "nothing visible changes"; with alternative text it says the page may show the value, and how to box it', () => {
    for (const q of [flattenQuestion([1]), flattenQuestion([1, 2]), flattenQuestion([1], [1]), flattenQuestion([1, 2], [2])]) {
      expect(`${q.title} ${q.body}`).not.toMatch(/nothing visible changes/i);
      expect(q.body).toMatch(/Look at the page/);
    }
    const plain = flattenQuestion([1]).body;
    expect(plain).not.toMatch(/may show/);
    const may = flattenQuestion([1, 4], [4]).body;
    expect(may).toMatch(/Page 5 may show it in a form Redact cannot read/);
    expect(may).toMatch(/draw a box over it/);
    expect(flattenQuestion([4], [4]).body).toMatch(/This page may show it in a form Redact cannot read/);
    expect(flattenDeclined([1]).message).toMatch(/draw a box over it and run Redact again/);
  });

  it('non-blocking 6: a value in a font or resource name, or outside the pages, gets a next step that can help', () => {
    // Wave 2, ruling 3 (R4): no advice to draw a small box anywhere; a drawn value no box can place gets the
    // step that can help.
    expect(notVerified({ pages: [2], elsewhere: [] }, 'elsewhere').message).toBe(
      'The redacted file could not be verified: redacted text was still found in it (page 3). Nothing was added. Untick that value, or print the file to a new PDF and redact that copy.',
    );
    expect(notVerified({ pages: [], elsewhere: ['document properties'] }, 'elsewhere').message).toBe(
      'The redacted file could not be verified: redacted text was still found in it (document properties). Nothing was added. Untick that value, or print the file to a new PDF and redact that copy.',
    );
  });

  it('wave 2, ruling 7: at most one plain sentence when something was covered more widely than asked', () => {
    const base = { pagesRebuiltHidden: [], pagesFlattened: [], replacementsNotFitted: 0, boxesWidened: 0, textLayerCharsOmitted: 0, autoBoxesDropped: 0, valuesLeftVisible: 0, bookmarksRemoved: 0, output: 'searchable' as const };
    // True whatever drew it there (a stamp, a form, a drawing, or text reaching past its box): ruling 3.
    expect(resultNotes({ ...base, pagesCoveredMore: [1] })).toEqual(['On page 2, a chosen value also showed outside the places found; it was covered there too.']);
    expect(resultNotes({ ...base, pagesCoveredMore: [0, 4] })).toEqual(['On pages 1, 5, a chosen value also showed outside the places found; it was covered there too.']);
    expect(resultNotes({ ...base, pagesCoveredMore: [1], pagesCoveredWhole: [3] })).toEqual(['On pages 2, 4, text or a drawing that could not be read was covered whole, to be safe.']);
    expect(resultNotes(base)).toEqual([]);
  });

  it('the limits are one plain sentence, with the rest folded', () => {
    expect(REDACT_LIMITS.short).toBe('Redact removes the text it can read: look at every page of the result before you share it, and draw a box over anything still showing.');
    expect(REDACT_LIMITS.more).toMatch(/as the line under the word field says/);
    // Wave 3, ruling C: what still cannot be found, in one plain sentence (redact-fix-rules-3.md; RX-LIB's wording).
    expect(REDACT_LIMITS.more).toMatch(/^It cannot read text inside pictures, barcodes, QR codes or scanned pages, letters drawn as shapes, or a stamp set to print but not to show on screen\./);
    expect(REDACT_LIMITS.more).toMatch(/ A value split between two table cells or two columns, or a word broken at a line end without a hyphen, may not be found\. /);
    expect(REDACT_LIMITS.more).toMatch(/such as some bullets, are covered with small boxes on the pages it redacts/);
    expect(REDACT_LIMITS.more).not.toMatch(/stamps, signatures|out of order/);
    // Wave 4, ruling N: the font that hides its letters, in the same single-sentence style.
    expect(REDACT_LIMITS.more).toMatch(/ Text in a font that hides its letters \(it shows one letter and gives another when copied\) may not be found\. /);
  });

  it('wave 4, K1: before the run, one plain sentence names the pages where text Redact cannot read will be covered', () => {
    expect(textCoveredSentence([0])).toBe('On page 1, some text Redact cannot read will be covered too.');
    expect(textCoveredSentence([0, 2, 3])).toBe('On pages 1, 3-4, some text Redact cannot read will be covered too.');
    expect(textCoveredSentence([])).toBeNull();
  });

  it('wave 4: a page made a picture only because it could not be copied safely gets one plain sentence; "still visible" only where nothing was covered whole', () => {
    const base = { pagesRebuiltHidden: [], pagesFlattened: [], replacementsNotFitted: 0, boxesWidened: 0, textLayerCharsOmitted: 0, autoBoxesDropped: 0, valuesLeftVisible: 0, bookmarksRemoved: 0, output: 'searchable' as const };
    expect(resultNotes({ ...base, pagesMadePictures: [1] })).toEqual(['Page 2 was also made a picture, to be safe.']);
    expect(resultNotes({ ...base, pagesMadePictures: [1, 2, 4] })).toEqual(['Pages 2-3, 5 were also made pictures, to be safe.']);
    expect(resultNotes({ ...base, textLayerCharsOmitted: 4, pagesCoveredWhole: [0], omittedHindi: true })).toEqual([
      'On page 1, text or a drawing that could not be read was covered whole, to be safe.',
      'Some text on the redacted pages cannot be made searchable (for example Hindi and ₹).',
    ]);
  });

  it('wave 5, ruling R: "covered whole" only where a whole run was; letters covered by themselves get their own sentence; Hindi is named only where the pages have it', () => {
    const base = { pagesRebuiltHidden: [], pagesFlattened: [], replacementsNotFitted: 0, boxesWidened: 0, textLayerCharsOmitted: 0, autoBoxesDropped: 0, valuesLeftVisible: 0, bookmarksRemoved: 0, output: 'searchable' as const };
    expect(resultNotes({ ...base, pagesCoveredLetters: [0] })).toEqual(['On page 1, some letters that could not be read were covered, to be safe.']);
    // A page covered whole is said once, as covered whole; the letters sentence names the other pages only.
    expect(resultNotes({ ...base, pagesCoveredLetters: [0, 2], pagesCoveredWhole: [2] })).toEqual([
      'On page 3, text or a drawing that could not be read was covered whole, to be safe.',
      'On page 1, some letters that could not be read were covered, to be safe.',
    ]);
    // Arabic, Urdu or Hebrew pages (T4-B, H16 and N18): no word of Hindi.
    expect(resultNotes({ ...base, textLayerCharsOmitted: 3 })).toEqual(['Some scripts and symbols on the redacted pages cannot be made searchable. They are still visible.']);
    expect(resultNotes({ ...base, textLayerCharsOmitted: 3, omittedHindi: true })).toEqual(['Some text on the redacted pages cannot be made searchable (for example Hindi and ₹). It is still visible.']);
    expect(resultNotes({ ...base, textLayerCharsOmitted: 3, omittedHindi: true, pagesCoveredLetters: [0] })).toEqual([
      'On page 1, some letters that could not be read were covered, to be safe.',
      'Some text on the redacted pages cannot be made searchable (for example Hindi and ₹).',
    ]);
  });

  it('wave 6 (T-052): the confirmation names the pages that may not be copied and counts them in the size; while that is not known it says pages may be made pictures; Redact waits for words still being searched', () => {
    const pan: Proposal = { id: 't0-10-20-pan', kind: 'pan', key: 'QWXPT4821K', value: 'QWXPT4821K', page: 0, rects: [{ x0: 60, y0: 700, x1: 140, y1: 712 }], confidence: 'sure', source: 'text', outsideView: false, ranges: [[10, 20]], label: 'PAN', angle: 0 };
    const state = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: [pan] });
    const chars = () => 2000;
    const none = confirmFacts(state, 20, [], 200, chars);
    expect(confirmSentence(none)).toBe('1 area on 1 page will be removed. Page 1 will become a picture of the page; the other 19 pages are copied unchanged.');
    // T4-C's M-inline-20: every page has an inline image, so none may be copied.
    const all = confirmFacts(state, 20, [], 200, chars, Array.from({ length: 20 }, (_, i) => i));
    expect(confirmSentence(all)).toBe('1 area on 1 page will be removed. Page 1 will become a picture of the page; pages 2-20 will also become pictures, to be safe.');
    expect(all.pagesUnchanged).toBe(0);
    expect(all.estimate).toBeGreaterThan(19 * none.estimate);
    const one = confirmFacts(state, 20, [], 200, chars, [4]);
    expect(confirmSentence(one)).toBe('1 area on 1 page will be removed. Page 1 will become a picture of the page; page 5 will also become a picture, to be safe; the other 18 pages are copied unchanged.');
    const unknown = confirmFacts(state, 20, [], 200, chars, null);
    expect(unknown.alsoUnknown).toBe(true);
    expect(confirmSentence(unknown)).toBe('1 area on 1 page will be removed. Page 1 will become a picture of the page; some other pages may also be made pictures, to be safe.');
    expect(unknown.estimate).toBe(none.estimate);
    expect(choicesError(DEFAULT_CHOICES, state)).toBeNull();
    expect(choicesError(DEFAULT_CHOICES, state, true)).toBe('Wait until your words have been searched.');
  });

  it('B6: a result or source name that holds a chosen value is replaced by a neutral one', () => {
    const holds = (text: string) => text.includes('QWXPT4821K');
    expect(safeResultName('Form16_QWXPT4821K_redacted.pdf', holds)).toBe(REDACTED_NAME);
    expect(REDACTED_NAME).toBe('Redacted document.pdf');
    expect(safeResultName('Form16_redacted.pdf', holds)).toBe('Form16_redacted.pdf');
    expect(WITHHELD_NAME).toBe('Original file (name withheld)');
  });

  it('notes only what applies', () => {
    const none = resultNotes({ pagesRebuiltHidden: [], pagesFlattened: [], replacementsNotFitted: 0, boxesWidened: 0, textLayerCharsOmitted: 0, autoBoxesDropped: 0, valuesLeftVisible: 0, bookmarksRemoved: 0, output: 'searchable' });
    expect(none).toEqual([]);
    const all = resultNotes({ pagesRebuiltHidden: [3], pagesFlattened: [5], replacementsNotFitted: 3, boxesWidened: 1, textLayerCharsOmitted: 2, autoBoxesDropped: 1, valuesLeftVisible: 1, bookmarksRemoved: 2, output: 'searchable', omittedHindi: true });
    expect(all).toEqual([
      'Page 4 also held redacted text the review did not list. It was covered there too, and the page was made a picture.',
      'Page 6 was flattened, as you confirmed.',
      '3 replacements did not fit and were left as plain black boxes.',
      '1 box was widened to the whole line, to be sure nothing of the text shows.',
      'Some text on the redacted pages cannot be made searchable (for example Hindi and ₹). It is still visible.',
      '1 automatic box covered almost the whole page and was left out.',
      '1 chosen value stays visible where you unticked it.',
      '2 bookmarks holding redacted text were removed.',
    ]);
    // Picture only: the text-layer note does not apply.
    expect(resultNotes({ pagesRebuiltHidden: [], pagesFlattened: [], replacementsNotFitted: 0, boxesWidened: 0, textLayerCharsOmitted: 5, autoBoxesDropped: 0, valuesLeftVisible: 0, bookmarksRemoved: 0, output: 'picture' })).toEqual([]);
  });
});
