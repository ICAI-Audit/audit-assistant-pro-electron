import { describe, expect, it } from 'vitest';
import type { OutlineItem } from './outline';
import { parsePageList } from './pageList';
import { defaultResultName } from './resultNames';
import {
  bookmarkPartName,
  bookmarkPlan,
  bookmarkSplitError,
  parseRangeParts,
  partCoverage,
  partIndices,
  partPageCount,
  partSummary,
  partText,
  rangePartName,
  SPLIT_MAX_FILES,
  uniqueNames,
} from './splitPlan';

const item = (title: string, page: number | null, children: OutlineItem[] = [], extra: Partial<OutlineItem> = {}): OutlineItem => ({ title, page, children, open: false, ...extra });
const parserMessage = (text: string, pageCount: number) => {
  try {
    parsePageList(text, pageCount);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

describe('ranges, one file each', () => {
  it('makes one part per comma item, in the order typed', () => {
    expect(parseRangeParts('1-32, 65-96', 320)).toEqual([
      { from: 1, to: 32 },
      { from: 65, to: 96 },
    ]);
    expect(parseRangeParts(' 65 - 96 ,1-32,7 ', 320)).toEqual([
      { from: 65, to: 96 },
      { from: 1, to: 32 },
      { from: 7, to: 7 },
    ]);
  });

  it("refuses a bad list with the page parser's own message", () => {
    for (const bad of ['', '1-32; 65-96', '400', '1-400', '32-1', '1,,3', 'a-b', '0']) {
      const expected = parserMessage(bad, 320);
      expect(expected, bad).not.toBeNull();
      expect(() => parseRangeParts(bad, 320), bad).toThrow(expected!);
      try {
        parseRangeParts(bad, 320);
      } catch (error) {
        expect((error as { code: string }).code, bad).toBe('invalid-page-list');
      }
    }
    expect(() => parseRangeParts('32-1', 320)).toThrow('"32-1" is backwards: the first page must not be after the last');
    expect(() => parseRangeParts('5, 321', 320)).toThrow("Page 321 is outside this file's 320 pages");
  });

  it(`makes at most ${SPLIT_MAX_FILES} files in one run, and says so plainly`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => String((i % 300) + 1)).join(', ');
    expect(parseRangeParts(many(SPLIT_MAX_FILES), 300)).toHaveLength(SPLIT_MAX_FILES);
    expect(() => parseRangeParts(many(SPLIT_MAX_FILES + 1), 300)).toThrow(`These ranges would make ${SPLIT_MAX_FILES + 1} files; Split makes at most ${SPLIT_MAX_FILES} at a time.`);
    try {
      parseRangeParts(many(SPLIT_MAX_FILES + 1), 300);
    } catch (error) {
      expect((error as { code: string }).code).toBe('too-many-files');
    }
  });

  it('says which pages are in no file and which are in more than one', () => {
    expect(partCoverage(parseRangeParts('1-32, 65-96', 320), 320)).toEqual({
      missing: [
        { from: 33, to: 64 },
        { from: 97, to: 320 },
      ],
      repeated: [],
    });
    expect(partCoverage(parseRangeParts('1-40, 20-60, 30-35, 61-100', 100), 100)).toEqual({ missing: [], repeated: [{ from: 20, to: 40 }] });
    expect(partCoverage(parseRangeParts('3, 3, 5', 5), 5)).toEqual({
      missing: [
        { from: 1, to: 2 },
        { from: 4, to: 4 },
      ],
      repeated: [{ from: 3, to: 3 }],
    });
    expect(partCoverage(parseRangeParts('1-5', 5), 5)).toEqual({ missing: [], repeated: [] });
  });

  it('counts, lists and writes a part', () => {
    expect(partPageCount({ from: 65, to: 96 })).toBe(32);
    expect(partIndices({ from: 3, to: 5 })).toEqual([2, 3, 4]);
    expect(partText({ from: 3, to: 5 })).toBe('3-5');
    expect(partText({ from: 7, to: 7 })).toBe('7');
  });
});

describe('names of the files', () => {
  it('names a range part like the one-range result, and one page as a page', () => {
    expect(rangePartName('Ledger', { from: 1, to: 32 })).toBe('Ledger_pages_1-32.pdf');
    expect(rangePartName('Ledger', { from: 5, to: 5 })).toBe('Ledger_page_5.pdf');
  });

  it('cuts a long stem, never the range, and keeps the name within 120 characters', () => {
    const name = rangePartName('x'.repeat(200), { from: 1000, to: 2000 });
    expect(name.endsWith('_pages_1000-2000.pdf')).toBe(true);
    expect(name.length).toBe(120);
    expect(rangePartName('😀'.repeat(60), { from: 1, to: 2 })).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('cleans a stem as every name is cleaned', () => {
    expect(rangePartName('A:B?', { from: 1, to: 2 })).toBe('A_B__pages_1-2.pdf');
    expect(rangePartName('  ', { from: 1, to: 2 })).toBe('document_pages_1-2.pdf');
  });

  it('names a bookmark part with its place in page order and its title, cleaned', () => {
    expect(bookmarkPartName('Annual report', 1, 5, "Directors' Report")).toBe("Annual report_01_Directors' Report.pdf");
    expect(bookmarkPartName('AR', 12, 120, 'Notes')).toBe('AR_012_Notes.pdf');
    expect(bookmarkPartName('AR', 2, 5, 'Note 2: Revenue / Other income?')).toBe('AR_02_Note 2_ Revenue _ Other income_.pdf');
    expect(bookmarkPartName('AR', 3, 5, '<Schedule> "A" | B*.')).toBe('AR_03__Schedule_ _A_ _ B_.pdf');
    expect(bookmarkPartName('AR', 4, 5, 'Report.pdf')).toBe('AR_04_Report.pdf');
    expect(bookmarkPartName('AR', 5, 5, '')).toBe('AR_05_Untitled.pdf');
    expect(bookmarkPartName('AR', 5, 5, 'a\u0000b\u2028c')).toBe('AR_05_a_b_c.pdf');
  });

  it('keeps a Hindi title, and cuts a long one without splitting a letter from its marks', () => {
    expect(bookmarkPartName('बैंक विवरण', 1, 3, 'करदाता विवरण ₹')).toBe('बैंक विवरण_01_करदाता विवरण ₹.pdf');
    const long = 'क्षेत्रीय '.repeat(30);
    const name = bookmarkPartName('AR', 1, 3, long);
    expect(name.length).toBeLessThanOrEqual(120);
    const kept = name.slice('AR_01_'.length, -'.pdf'.length);
    expect(long.startsWith(kept)).toBe(true);
    expect(kept.length).toBeGreaterThan(80);
    // the cut never falls between a letter and its vowel sign, virama or joiner
    expect(long.slice(kept.length, kept.length + 1)).not.toMatch(/[\p{M}\u200c\u200d]/u);
    expect(bookmarkPartName('AR', 1, 3, '😀'.repeat(80))).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // exactly at the limit: "AR_01_" leaves 110 characters for the title, and the 111th is a vowel sign (or a
    // virama and a joiner) belonging to the 110th letter, so the cut goes before that letter
    const ka = 'क';
    const vowelSignI = String.fromCharCode(0x93f);
    const viramaJoiner = String.fromCharCode(0x94d, 0x200d);
    expect(bookmarkPartName('AR', 1, 3, ka.repeat(110) + vowelSignI + ' end')).toBe(`AR_01_${ka.repeat(109)}.pdf`);
    expect(bookmarkPartName('AR', 1, 3, ka.repeat(110) + viramaJoiner + ka)).toBe(`AR_01_${ka.repeat(109)}.pdf`);
    expect(bookmarkPartName('AR', 1, 3, ka.repeat(110) + ' end')).toBe(`AR_01_${ka.repeat(110)}.pdf`);
  });

  it('gives a name typed twice in one run " (2)", without regard to case', () => {
    expect(uniqueNames(['a_pages_1-5.pdf', 'A_pages_1-5.pdf', 'a_pages_6-9.pdf', 'a_pages_1-5.pdf'])).toEqual([
      'a_pages_1-5.pdf',
      'A_pages_1-5 (2).pdf',
      'a_pages_6-9.pdf',
      'a_pages_1-5 (3).pdf',
    ]);
  });
});

describe('split at bookmarks', () => {
  it('makes one file per top-level bookmark, from its page to the page before the next', () => {
    const items = [item('Directors', 0, [item('Annexure', 3)]), item('Auditors', 5), item('Accounts', 9, [item('Notes', 12, [item('Note 1', 13)])])];
    expect(bookmarkPlan(items, 20)).toEqual({
      sections: [
        { title: 'Directors', from: 1, to: 5 },
        { title: 'Auditors', from: 6, to: 9 },
        { title: 'Accounts', from: 10, to: 20 },
      ],
      before: 0,
      noPage: 0,
      samePage: 0,
    });
  });

  it('puts the pages before the first bookmark into the first file, and goes by page order', () => {
    expect(bookmarkPlan([item('Second', 7), item('First', 2)], 10)).toEqual({
      sections: [
        { title: 'First', from: 1, to: 7 },
        { title: 'Second', from: 8, to: 10 },
      ],
      before: 2,
      noPage: 0,
      samePage: 0,
    });
  });

  it('starts a top-level bookmark with no page of its own at the first page under it; one with none makes no file', () => {
    const items = [
      item('Part A', null, [item('Chapter 2', 4), item('Chapter 1', 2)]),
      item('Web', null, [], { uri: 'https://example.in/' }),
      item('Elsewhere', null, [item('Also elsewhere', null, [], { unresolved: 'remote' })], { unresolved: 'remote' }),
      item('Part B', 6),
    ];
    expect(bookmarkPlan(items, 8)).toEqual({
      sections: [
        { title: 'Part A', from: 1, to: 6 },
        { title: 'Part B', from: 7, to: 8 },
      ],
      before: 2,
      noPage: 2,
      samePage: 0,
    });
  });

  it('lets the first of two top-level bookmarks at the same page name the file; duplicate titles stay apart', () => {
    expect(bookmarkPlan([item('Notes', 0), item('Cover', 0), item('Notes', 3)], 5)).toEqual({
      sections: [
        { title: 'Notes', from: 1, to: 3 },
        { title: 'Notes', from: 4, to: 5 },
      ],
      before: 0,
      noPage: 0,
      samePage: 1,
    });
  });

  it('says why a file cannot be split at its bookmarks', () => {
    const none = { count: 0, overLimits: false };
    expect(bookmarkSplitError(none, bookmarkPlan([], 3))).toBe('This file has no bookmarks, so it cannot be split at them.');
    expect(bookmarkSplitError({ count: 12_000, overLimits: true }, bookmarkPlan([item('A', 0)], 3))).toBe('This file has too many bookmarks to read, so it cannot be split at them.');
    expect(bookmarkSplitError({ count: 1, overLimits: false }, bookmarkPlan([item('Web', null, [], { uri: 'https://example.in/' })], 3))).toBe(
      "This file's bookmarks do not open any of its pages, so it cannot be split at them.",
    );
    expect(bookmarkSplitError({ count: 2, overLimits: false }, bookmarkPlan([item('A', 0), item('B', 1)], 3))).toBeNull();
    const flat = Array.from({ length: SPLIT_MAX_FILES + 2 }, (_, i) => item(`B${i}`, i));
    expect(bookmarkSplitError({ count: flat.length, overLimits: false }, bookmarkPlan(flat, 600))).toBe(
      `Splitting at these bookmarks would make ${SPLIT_MAX_FILES + 2} files; Split makes at most ${SPLIT_MAX_FILES} at a time.`,
    );
    expect(bookmarkSplitError({ count: SPLIT_MAX_FILES, overLimits: false }, bookmarkPlan(flat.slice(0, SPLIT_MAX_FILES), 600))).toBeNull();
  });
});

describe('the record of each file', () => {
  it('says the pages and the part, never a title', () => {
    expect(partSummary('ranges', { from: 1, to: 32 }, 1, 2)).toBe('Split pages 1-32 (part 1 of 2)');
    expect(partSummary('ranges', { from: 5, to: 5 }, 2, 3)).toBe('Split page 5 (part 2 of 3)');
    expect(partSummary('bookmarks', { from: 13, to: 40 }, 2, 5)).toBe('Split at bookmarks, pages 13-40 (part 2 of 5)');
  });
});

// REV-A M1 (15 November 2026): a long source name is cut the same way for one range and for several.
describe('REV-A M1: one name for the same range', () => {
  const long = 'Statement of account for the year ended 31 March 2026 of Messrs Sharma and Sons Trading Company Private Limited - final copy v3 revised';
  it('the file of a several-range split is named as the one-range result, its end kept', () => {
    for (const part of [{ from: 1, to: 32 }, { from: 5, to: 5 }]) {
      const one = part.from === part.to ? null : defaultResultName('split', `${long}.pdf`, part);
      const several = rangePartName(long, part);
      if (one) expect(several).toBe(one);
      expect(several.length).toBeLessThanOrEqual(120);
      expect(several).toContain('final copy v3 revised');
    }
  });
  it('a bookmark part keeps the end of a long stem too', () => {
    const name = bookmarkPartName(long, 1, 3, 'Annexure A');
    expect(name).toContain('revised');
    expect(name.endsWith('_01_Annexure A.pdf')).toBe(true);
  });
});
