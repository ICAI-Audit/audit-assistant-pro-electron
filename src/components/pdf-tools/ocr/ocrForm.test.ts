// Make searchable's words (T-064, OCR part A): the dialog's sentences, the result's honest message, the record.
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { displayedPage } from '@/lib/pdf-tools/marks';
import { addTextLayer, prepareTextLayer } from '@/lib/pdf-tools/ocrLayer';
import { planPages, type PageKind } from '@/lib/pdf-tools/ocrPlan';
import { buildReport, pageQuality, type OcrReport, type PageOutcome } from '@/lib/pdf-tools/ocrQuality';
import { pacer } from '@/lib/pdf-tools/pace';
import { ocrFixture } from '@/lib/pdf-tools/testOcrPdf';
import {
  blockedReason,
  CHECKING_LABEL,
  DESCRIPTION,
  nothingToRecogniseMessage,
  NOTHING_READ_MESSAGE,
  pageList,
  planLine,
  RECOGNISING_LABEL,
  RECORD_KEYS,
  recordOptions,
  resultDescription,
  resultWorthAdding,
  searchableName,
  summary,
  timeRange,
} from './ocrForm';

const kinds = (scanned: number, text: number, empty = 0): PageKind[] => [
  ...Array<PageKind>(scanned).fill('scanned'),
  ...Array<PageKind>(text).fill('text'),
  ...Array<PageKind>(empty).fill('empty'),
];

const report = (over: Partial<OcrReport> = {}): OcrReport => ({
  pages: 12,
  pagesRecognised: 8,
  pagesWithText: 4,
  pagesEmpty: 0,
  pagesUnread: 0,
  pagesSkipped: 4,
  pagesTimedOut: 0,
  pagesFaint: 0,
  pagesNoWords: 0,
  words: 2104,
  lowConfidenceWords: 0,
  numbersToCheck: 0,
  charactersDropped: 0,
  wordsLeftOut: 0,
  pagesPartlyRead: 0,
  timedOutPages: [],
  faintPages: [],
  partlyReadPages: [],
  littleReadPages: [],
  noWordPages: [],
  numberPages: [],
  unreadPages: [],
  ...over,
});

describe('the dialog', () => {
  it('says what it does in plain words', () => {
    expect(DESCRIPTION).toBe('Adds the text of scanned pages, read on this computer, so the file can be searched, selected and redacted. The pages look the same. English text only.');
  });

  it('says how many pages will be recognised and roughly how long it takes', () => {
    expect(planLine(planPages(kinds(8, 4)))).toBe('8 of 12 pages have little or no text and will be recognised, about 5 to 20 seconds a page (about 1 to 3 minutes in all).');
    expect(planLine(planPages(kinds(30, 0)))).toBe('All 30 pages have little or no text and will be recognised, about 5 to 20 seconds a page (about 3 to 10 minutes in all).');
    expect(planLine(planPages(kinds(1, 0)))).toBe('The page has little or no text and will be recognised, in about 5 to 20 seconds.');
    expect(planLine(planPages(kinds(1, 5)))).toBe('1 of 6 pages has little or no text and will be recognised, in about 5 to 20 seconds.');
    expect(planLine(planPages(kinds(3, 0)))).toBe('All 3 pages have little or no text and will be recognised, about 5 to 20 seconds a page (about 15 to 60 seconds in all).');
    expect(planLine(planPages(kinds(12, 0)))).toBe('All 12 pages have little or no text and will be recognised, about 5 to 20 seconds a page (about 1 to 4 minutes in all).');
    expect(planLine(planPages(kinds(500, 0)))).toBe('All 500 pages have little or no text and will be recognised, about 5 to 20 seconds a page (about 1 to 3 hours in all).');
    expect(planLine(planPages(kinds(0, 3)))).toBeNull();
  });

  it('gives a time as a range in plain units, and what is left of a run from the pages measured', () => {
    expect(timeRange(5, 15)).toBe('about 5 to 15 seconds');
    expect(timeRange(40, 120)).toBe('about 1 to 2 minutes');
    expect(timeRange(100, 110)).toBe('about 2 minutes');
    expect(timeRange(2500, 7500)).toBe('about 1 to 3 hours');
    expect(RECOGNISING_LABEL(7, 3, 8)).toBe('Reading the text of page 7 (3 of 8)…');
    expect(RECOGNISING_LABEL(7, 3, 8, 42)).toBe('Reading the text of page 7 (3 of 8), about 40 seconds left…');
    expect(RECOGNISING_LABEL(7, 3, 8, 3)).toBe('Reading the text of page 7 (3 of 8), a few seconds left…');
    expect(RECOGNISING_LABEL(7, 3, 80, 600)).toBe('Reading the text of page 7 (3 of 80), about 10 minutes left…');
    expect(RECOGNISING_LABEL(7, 3, 80, 61)).toBe('Reading the text of page 7 (3 of 80), about 1 minute left…');
    expect(CHECKING_LABEL(2, 9)).toBe('Looking for pages without text: page 2 of 9…');
  });

  it('gives no result and one sentence when nothing looks scanned', () => {
    expect(nothingToRecogniseMessage(planPages(kinds(0, 5)))).toBe('Every page already has text; nothing to recognise.');
    expect(nothingToRecogniseMessage(planPages(kinds(0, 2, 1)))).toBe('Every page already has text or is blank; nothing to recognise.');
    expect(nothingToRecogniseMessage(planPages(kinds(0, 0, 2)))).toBe('Every page is blank; nothing to recognise.');
    expect(blockedReason(planPages(kinds(0, 5)))).toBe('Every page already has text; nothing to recognise.');
    expect(blockedReason(planPages(kinds(2, 5)))).toBeNull();
    expect(blockedReason(null)).toBeNull(); // still looking: the run looks again itself
  });

  it('names the result <name>_searchable.pdf', () => {
    expect(searchableName('Stock register 2024-25.pdf')).toBe('Stock register 2024-25_searchable.pdf');
    expect(searchableName('scan.PDF')).toBe('scan_searchable.pdf');
    const long = searchableName(`${'a'.repeat(200)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('_searchable.pdf')).toBe(true);
  });
});

describe('the result', () => {
  it('says what was recognised, and always that the text can be wrong', () => {
    expect(resultDescription('Register_searchable.pdf', report())).toEqual({
      message: 'Made searchable: Register_searchable.pdf',
      detail: '8 of 12 pages recognised; 4 already had text. Recognised text can be wrong: check numbers against the page.',
      tone: 'success',
    });
  });

  it('names the numbers to check and the faint pages, with no percentage', () => {
    const d = resultDescription('R.pdf', report({ numbersToCheck: 37, numberPages: [2, 3, 5, 8, 9], pagesFaint: 2, faintPages: [3, 9], lowConfidenceWords: 120 }));
    expect(d.detail).toBe('8 of 12 pages recognised; 4 already had text. Recognised text can be wrong: check numbers against the page. 37 numbers to check on pages 2, 3, 5, 8 and 9; pages 3 and 9 look faint.');
    expect(d.tone).toBe('warning');
    expect(d.detail).not.toMatch(/%|percent|confiden/i);
    const many = resultDescription('R.pdf', report({ numbersToCheck: 1, numberPages: [4], pagesFaint: 7, faintPages: [1, 2, 3, 4, 5, 6, 7] }));
    expect(many.detail).toContain('1 number to check on page 4; 7 pages look faint.');
  });

  it('names pages that ran out of time, could not be read, or gave no words, and symbols left out', () => {
    const d = resultDescription('R.pdf', report({
      pages: 10, pagesRecognised: 6, pagesWithText: 1, pagesEmpty: 1, pagesUnread: 1, pagesSkipped: 3, pagesTimedOut: 1, timedOutPages: [7], unreadPages: [5], pagesNoWords: 2, noWordPages: [2, 4], charactersDropped: 3,
    }));
    expect(d.detail).toBe(
      '6 of 10 pages recognised; 1 already had text; 1 had nothing to recognise. Page 7 took too long and was left as it was. Page 5 could not be read and was left as it was. ' +
        'No words were found on pages 2 and 4; they may be blank or too faint. Recognised text can be wrong: check numbers against the page. 3 symbols could not be added to the searchable text and were left out.',
    );
    expect(d.tone).toBe('warning');
    const one = resultDescription('R.pdf', report({ pages: 1, pagesRecognised: 1, pagesWithText: 0, pagesSkipped: 0, pagesNoWords: 0, charactersDropped: 1 }));
    expect(one.detail).toBe('The page was recognised. Recognised text can be wrong: check numbers against the page. 1 symbol could not be added to the searchable text and was left out.');
    const all = resultDescription('R.pdf', report({ pagesRecognised: 12, pagesWithText: 0, pagesSkipped: 0, pagesTimedOut: 2, timedOutPages: [3, 4] }));
    expect(all.detail).toMatch(/^All 12 pages recognised\. Pages 3 and 4 took too long and were left as they were\./);
  });

  it('says which pages were only partly read, in one plain sentence, before the numbers to check', () => {
    const why = 'they may be faint, handwritten or not in English.';
    const d = resultDescription('R.pdf', report({ wordsLeftOut: 968, pagesPartlyRead: 5, partlyReadPages: [1, 2, 3, 4, 5], numbersToCheck: 7, numberPages: [1, 3] }));
    expect(d.detail).toBe(
      `8 of 12 pages recognised; 4 already had text. Parts of pages 1, 2, 3, 4 and 5 could not be read and were left out: ${why} ` +
        'Recognised text can be wrong: check numbers against the page. 7 numbers to check on pages 1 and 3.',
    );
    expect(d.tone).toBe('warning');
    expect(d.detail).not.toMatch(/%|percent|confiden|968/i);
    const one = resultDescription('R.pdf', report({ wordsLeftOut: 40, pagesPartlyRead: 1, partlyReadPages: [3] }));
    expect(one.detail).toContain(`Parts of page 3 could not be read and were left out: ${why.replace('they', 'it')}`);
    expect(one.tone).toBe('warning');
    const many = resultDescription('R.pdf', report({ wordsLeftOut: 400, pagesPartlyRead: 7, partlyReadPages: [1, 2, 3, 4, 5, 6, 7] }));
    expect(many.detail).toContain(`Parts of 7 pages could not be read and were left out: ${why}`);
    // A few words left out on good pages are not worth a sentence, and do not turn the message into a warning.
    const few = resultDescription('R.pdf', report({ wordsLeftOut: 6 }));
    expect(few.detail).toBe('8 of 12 pages recognised; 4 already had text. Recognised text can be wrong: check numbers against the page.');
    expect(few.tone).toBe('success');
  });

  it('says plainly when little could be read on a page, and does not call such a page recognised', () => {
    const why = 'it may be faint, handwritten or not in English.';
    // One page, nearly unread: no "The page was recognised."
    const one = resultDescription('R.pdf', report({ pages: 1, pagesRecognised: 1, pagesWithText: 0, pagesSkipped: 0, words: 37, wordsLeftOut: 9, pagesPartlyRead: 1, partlyReadPages: [1], littleReadPages: [1], numbersToCheck: 2, numberPages: [1] }));
    expect(one.detail).toBe(`Little could be read on page 1: ${why} Recognised text can be wrong: check numbers against the page. 2 numbers to check on page 1.`);
    expect(one.tone).toBe('warning');
    expect(one.detail).not.toMatch(/was recognised|Parts of|%|percent|confiden/i);
    // Among pages read well: the count stays, the page is named once, and not also as "parts of".
    const mixed = resultDescription('R.pdf', report({ wordsLeftOut: 300, pagesPartlyRead: 3, partlyReadPages: [2, 5, 6], littleReadPages: [5] }));
    expect(mixed.detail).toBe(
      '8 of 12 pages recognised; 4 already had text. Little could be read on page 5: ' + why +
        ' Parts of pages 2 and 6 could not be read and were left out: they may be faint, handwritten or not in English. Recognised text can be wrong: check numbers against the page.',
    );
    // Every recognised page nearly unread: none is called recognised.
    const all = resultDescription('R.pdf', report({ pages: 3, pagesRecognised: 3, pagesWithText: 0, pagesSkipped: 0, pagesPartlyRead: 3, partlyReadPages: [1, 2, 3], littleReadPages: [1, 2, 3] }));
    expect(all.detail).toBe('Little could be read on pages 1, 2 and 3: they may be faint, handwritten or not in English. Recognised text can be wrong: check numbers against the page.');
    const some = resultDescription('R.pdf', report({ pages: 3, pagesRecognised: 1, pagesWithText: 2, pagesSkipped: 2, pagesPartlyRead: 1, partlyReadPages: [2], littleReadPages: [2] }));
    expect(some.detail).toBe(`2 of 3 pages already had text. Little could be read on page 2: ${why} Recognised text can be wrong: check numbers against the page.`);
  });

  it('adds nothing when no word was read', () => {
    expect(resultWorthAdding(report())).toBe(true);
    expect(resultWorthAdding(report({ words: 0 }))).toBe(false);
    expect(NOTHING_READ_MESSAGE).toBe('No words could be read on the pages without text, and nothing was added. They may be blank, too faint or not in English.');
  });

  it('lists up to five pages and counts more', () => {
    expect(pageList([3])).toBe('page 3');
    expect(pageList([3, 9])).toBe('pages 3 and 9');
    expect(pageList([1, 2, 3, 4, 5])).toBe('pages 1, 2, 3, 4 and 5');
    expect(pageList([1, 2, 3, 4, 5, 6])).toBe('6 pages');
  });
});

describe('the record', () => {
  it('holds counts and choices only, never a recognised word', () => {
    expect(RECORD_KEYS).toEqual(['pages', 'pagesRecognised', 'pagesSkipped', 'pagesTimedOut', 'words', 'lowConfidenceWords', 'numbersToCheck', 'pagesFaint', 'charactersDropped', 'wordsLeftOut', 'pagesPartlyRead']);
    const r = report({ numbersToCheck: 37, numberPages: [2, 3], faintPages: [3], pagesFaint: 1, timedOutPages: [7], pagesTimedOut: 1 });
    const options = recordOptions(r);
    expect(Object.keys(options)).toEqual([...RECORD_KEYS]);
    for (const value of Object.values(options)) expect(Number.isInteger(value)).toBe(true);
    expect(options).toMatchObject({ pages: 12, pagesRecognised: 8, pagesSkipped: 4, pagesTimedOut: 1, numbersToCheck: 37, pagesFaint: 1 });
    expect(summary(r)).toBe('Made searchable: 8 of 12 pages recognised');
    expect(summary(report({ pages: 1, pagesRecognised: 1 }))).toBe('Made searchable: 1 of 1 page recognised');
  });
});

describe('from fixture to message', () => {
  it('runs plan, layer and figures on the mixed file, and no recognised word reaches the summary, record or message', async () => {
    const fixture = await ocrFixture('mixed');
    const doc = await PDFDocument.load(fixture.bytes);
    const plan = planPages(fixture.pages.map((p) => p.kind));
    const font = await prepareTextLayer(doc, pacer());
    const outcomes: PageOutcome[] = plan.toRecognise.map((i) => {
      const recognised = fixture.pages[i].recognised!;
      const page = doc.getPage(i);
      const layer = addTextLayer(doc, page, font, recognised);
      const shown = displayedPage(page);
      return { pageIndex: i, status: 'recognised', quality: pageQuality(i, recognised, shown), layer };
    });
    const r = buildReport(plan, outcomes);
    const d = resultDescription('Statement_searchable.pdf', r);
    expect(d.detail).toBe('1 of 3 pages recognised; 1 already had text; 1 had nothing to recognise. Recognised text can be wrong: check numbers against the page. Page 2 looks faint.'); // 8 words on A4: almost nothing for its size
    const said = [summary(r), JSON.stringify(recordOptions(r)), d.detail].join(' ');
    for (const page of fixture.pages) for (const word of page.recognised?.words ?? []) expect(said).not.toContain(word.text);
  });
});
