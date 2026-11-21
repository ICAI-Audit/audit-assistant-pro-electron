// Make searchable, what the user is told about reliability (T-064, OCR part A). From the OCR trial: amounts below
// confidence 80 catch 46 of 55 wrong amounts, so low-confidence words with digits are "numbers to check"; a page
// is "faint" when a tenth or more of its words are below 80 (every good trial page had 3.5% or less, every bad
// one 11.4% or more), or when almost nothing was read for the page's size. No single percentage is given.
import { describe, expect, it } from 'vitest';
import { planPages } from './ocrPlan';
import { buildReport, FAINT_LOW_SHARE, FAINT_WORDS_PER_SQUARE_INCH, LOW_CONFIDENCE, pageQuality, PARTLY_READ_SHARE, type PageOutcome } from './ocrQuality';
import { emptyLayerReport } from './ocrTypes';
import { A4, wordsPage } from './testOcrPdf';

const A4_SHOWN = { width: A4[0], height: A4[1] };
const good = (n: number) => Array.from({ length: n }, (_, i) => ({ text: i % 5 === 0 ? `${1000 + i}.00` : `word${i}`, confidence: 93 }));

describe('pageQuality', () => {
  it('counts words, low-confidence words and the numbers among them; ruling marks are not words', () => {
    const page = wordsPage([
      ...good(40),
      { text: '|', confidence: 20 },
      { text: '____', confidence: 10 },
      { text: 'Nirvexa', confidence: 79.9 },
      { text: '8,11,563,122.79', confidence: 61 },
      { text: 'NX/2291', confidence: 70 },
      { text: '37.45,120.50', confidence: 80 },
    ]);
    const q = pageQuality(4, page, A4_SHOWN);
    expect(q).toEqual({ pageIndex: 4, words: 44, lowConfidence: 3, numbersToCheck: 2, leftOut: 0, partlyRead: false, littleRead: false, looksFaint: false, noWords: false });
    expect(LOW_CONFIDENCE).toBe(80);
  });

  it('calls a page faint when a tenth or more of its words are below 80', () => {
    expect(FAINT_LOW_SHARE).toBe(0.1);
    const words = (low: number) => [...good(100 - low), ...Array.from({ length: low }, (_, i) => ({ text: `doubt${i}`, confidence: 55 }))];
    expect(pageQuality(0, wordsPage(words(9)), A4_SHOWN).looksFaint).toBe(false); // the trial's lightly faded ledger had 8%
    expect(pageQuality(0, wordsPage(words(10)), A4_SHOWN).looksFaint).toBe(true); // its phone photo 12.4%, faint photocopy 46%
  });

  it('calls a page faint when almost nothing was read for its size, and says when nothing was', () => {
    expect(FAINT_WORDS_PER_SQUARE_INCH).toBe(0.1);
    // A4 is 96.7 square inches: under 10 words is "almost nothing" (good trial pages had 2.5 to 3 words a square inch).
    expect(pageQuality(0, wordsPage(good(9)), A4_SHOWN).looksFaint).toBe(true);
    expect(pageQuality(0, wordsPage(good(10)), A4_SHOWN).looksFaint).toBe(false);
    // Twice the area needs twice the words.
    expect(pageQuality(0, wordsPage(good(15), [A4[1], A4[0] * 2]), { width: A4[1], height: A4[0] * 2 }).looksFaint).toBe(true);
    const none = pageQuality(0, wordsPage([{ text: '|', confidence: 90 }]), A4_SHOWN);
    expect(none).toMatchObject({ words: 0, noWords: true, looksFaint: false });
  });

  it('says a page was partly read when a tenth or more of what the engine saw was left out, and then does not also call it faint', () => {
    expect(PARTLY_READ_SHARE).toBe(0.1);
    // 90 words kept, 9 left out: 9 of 99 is under a tenth. 10 left out: a tenth.
    expect(pageQuality(0, wordsPage(good(90)), A4_SHOWN, 9)).toMatchObject({ words: 90, leftOut: 9, partlyRead: false, looksFaint: false });
    expect(pageQuality(0, wordsPage(good(90)), A4_SHOWN, 10)).toMatchObject({ words: 90, leftOut: 10, partlyRead: true, looksFaint: false });
    // A page half in another script: the few words kept would be "almost nothing for its size", but the one sentence says it.
    expect(pageQuality(0, wordsPage(good(8)), A4_SHOWN, 60)).toMatchObject({ words: 8, leftOut: 60, partlyRead: true, looksFaint: false, noWords: false });
    // A tenth of the kept words doubtful as well: still one flag, not two.
    const doubtful = [...good(45), ...Array.from({ length: 5 }, (_, i) => ({ text: `doubt${i}`, confidence: 55 }))];
    expect(pageQuality(0, wordsPage(doubtful), A4_SHOWN, 0)).toMatchObject({ partlyRead: false, looksFaint: true });
    expect(pageQuality(0, wordsPage(doubtful), A4_SHOWN, 30)).toMatchObject({ partlyRead: true, looksFaint: false });
    // Nothing kept at all, but something was there: not "no words found, it may be blank"; the same one sentence says it.
    expect(pageQuality(0, wordsPage([]), A4_SHOWN, 40)).toMatchObject({ words: 0, leftOut: 40, noWords: false, partlyRead: true, looksFaint: false });
    expect(pageQuality(0, wordsPage([]), A4_SHOWN, 0)).toMatchObject({ words: 0, leftOut: 0, noWords: true, partlyRead: false, looksFaint: false });
  });

  it('says little was read when more was left out than kept, or when what was kept of a partly read page is thin for its size', () => {
    // A4 is about 96.7 square inches: under one kept word a square inch is under 97 words.
    // More left out than kept, however many were kept.
    expect(pageQuality(0, wordsPage(good(120)), A4_SHOWN, 121)).toMatchObject({ partlyRead: true, littleRead: true });
    expect(pageQuality(0, wordsPage(good(120)), A4_SHOWN, 120)).toMatchObject({ partlyRead: true, littleRead: false });
    // A faint page: the engine saw little, doubted a part of it, and kept a few dozen words.
    expect(pageQuality(0, wordsPage(good(37)), A4_SHOWN, 9)).toMatchObject({ partlyRead: true, littleRead: true, looksFaint: false });
    expect(pageQuality(0, wordsPage(good(96)), A4_SHOWN, 27)).toMatchObject({ partlyRead: true, littleRead: true });
    expect(pageQuality(0, wordsPage(good(97)), A4_SHOWN, 27)).toMatchObject({ partlyRead: true, littleRead: false });
    // Nothing kept at all of what was seen.
    expect(pageQuality(0, wordsPage([]), A4_SHOWN, 40)).toMatchObject({ partlyRead: true, littleRead: true });
    // Never without a part left out: a page of few words read well (a cover page) is not said to be badly read,
    // and neither is a page that lost a few words.
    expect(pageQuality(0, wordsPage(good(37)), A4_SHOWN, 0)).toMatchObject({ partlyRead: false, littleRead: false });
    expect(pageQuality(0, wordsPage(good(37)), A4_SHOWN, 4)).toMatchObject({ partlyRead: false, littleRead: false });
    // The same share on a small page: 30 words on a slip of 20 square inches are not thin.
    expect(pageQuality(0, wordsPage(good(30)), { width: 360, height: 288 }, 6)).toMatchObject({ partlyRead: true, littleRead: false });
  });
});

describe('buildReport', () => {
  const recognised = (pageIndex: number, words: { text: string; confidence: number }[], dropped = 0): PageOutcome => ({
    pageIndex,
    status: 'recognised',
    quality: pageQuality(pageIndex, wordsPage(words), A4_SHOWN),
    layer: { ...emptyLayerReport(), wordsPlaced: words.length, charactersDropped: dropped },
  });

  it('adds the pages up, with page numbers from 1 for the message and counts only for the record', () => {
    const plan = planPages(['text', 'scanned', 'scanned', 'empty', 'scanned', 'scanned', 'unread', 'scanned']);
    const faint = [...good(20), ...Array.from({ length: 5 }, (_, i) => ({ text: `${i}9,000.0`, confidence: 40 }))];
    const report = buildReport(plan, [
      recognised(1, good(50), 2),
      recognised(2, faint),
      { pageIndex: 4, status: 'timed-out' },
      recognised(5, [{ text: '|', confidence: 99 }]),
      recognised(7, [...good(30), { text: '1,250', confidence: 70 }], 1),
    ]);
    expect(report).toEqual({
      pages: 8,
      pagesRecognised: 4,
      pagesWithText: 1,
      pagesEmpty: 1,
      pagesUnread: 1,
      pagesSkipped: 3,
      pagesTimedOut: 1,
      pagesFaint: 1,
      pagesNoWords: 1,
      words: 50 + 25 + 0 + 31,
      lowConfidenceWords: 6,
      numbersToCheck: 6,
      charactersDropped: 3,
      wordsLeftOut: 0,
      pagesPartlyRead: 0,
      timedOutPages: [5],
      faintPages: [3],
      partlyReadPages: [],
      littleReadPages: [],
      noWordPages: [6],
      numberPages: [3, 8],
      unreadPages: [7],
    });
  });

  it('counts a page that failed (the engine, or its drawing) with the pages that could not be read: left as it was, named, never recognised', () => {
    const plan = planPages(['scanned', 'scanned', 'unread', 'scanned', 'text']);
    const report = buildReport(plan, [recognised(0, [{ text: 'Freight', confidence: 95 }]), { pageIndex: 1, status: 'failed' }, { pageIndex: 3, status: 'timed-out' }]);
    expect(report).toMatchObject({ pages: 5, pagesRecognised: 1, pagesUnread: 2, pagesSkipped: 3, pagesTimedOut: 1, pagesWithText: 1, unreadPages: [2, 3], timedOutPages: [4] });
    // every page is in exactly one of the record's three counts
    expect(report.pagesRecognised + report.pagesSkipped + report.pagesTimedOut).toBe(report.pages);
  });

  it('adds up the words left out and names the pages partly read', () => {
    const plan = planPages(['scanned', 'scanned', 'scanned']);
    const page = (pageIndex: number, kept: number, leftOut: number): PageOutcome => ({
      pageIndex,
      status: 'recognised',
      quality: pageQuality(pageIndex, wordsPage(good(kept)), A4_SHOWN, leftOut),
      layer: { ...emptyLayerReport(), wordsPlaced: kept },
    });
    const report = buildReport(plan, [page(0, 200, 3), page(1, 120, 110), page(2, 0, 25)]);
    expect(report).toMatchObject({ words: 320, wordsLeftOut: 138, pagesPartlyRead: 2, partlyReadPages: [2, 3], pagesFaint: 0, faintPages: [], pagesNoWords: 0, noWordPages: [] });
  });

  it('names the pages of which little was read, among the pages partly read', () => {
    const plan = planPages(['scanned', 'scanned', 'scanned', 'scanned']);
    const page = (pageIndex: number, kept: number, leftOut: number): PageOutcome => ({
      pageIndex,
      status: 'recognised',
      quality: pageQuality(pageIndex, wordsPage(good(kept)), A4_SHOWN, leftOut),
      layer: { ...emptyLayerReport(), wordsPlaced: kept },
    });
    const report = buildReport(plan, [page(0, 300, 2), page(1, 400, 140), page(2, 37, 9), page(3, 50, 80)]);
    expect(report).toMatchObject({ pagesPartlyRead: 3, partlyReadPages: [2, 3, 4], littleReadPages: [3, 4] });
  });

  it('counts a page with no words found as recognised, and not as faint', () => {
    const report = buildReport(planPages(['scanned']), [recognised(0, [])]);
    expect(report).toMatchObject({ pagesRecognised: 1, pagesNoWords: 1, pagesFaint: 0, words: 0 });
  });
});
