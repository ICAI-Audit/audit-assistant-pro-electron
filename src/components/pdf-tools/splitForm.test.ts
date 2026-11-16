import { describe, expect, it } from 'vitest';
import { bookmarkPlan, SPLIT_MAX_FILES } from '@/lib/pdf-tools/splitPlan';
import type { OutlineItem } from '@/lib/pdf-tools/outline';
import { bookmarkNotes, pagesInNoFile, pagesInSeveralFiles, plannedFiles, previewHeading, rangeNotes, readRanges } from './splitForm';
import { readPageList } from './pageSelection';

const item = (title: string, page: number | null): OutlineItem => ({ title, page, children: [], open: false });

describe('the Split dialog, a separate file for each range', () => {
  it('reads one file per range, says nothing while the field is empty, and uses the same words as one file', () => {
    expect(readRanges('1-32, 65-96', 320)).toEqual({
      parts: [
        { from: 1, to: 32 },
        { from: 65, to: 96 },
      ],
      error: null,
    });
    expect(readRanges('  ', 320)).toEqual({ parts: null, error: null });
    for (const bad of ['32-1', '1-400', '1;2', '1,,2']) expect(readRanges(bad, 320), bad).toEqual({ parts: null, error: readPageList(bad, 320, 'as-written').error });
    const many = Array.from({ length: SPLIT_MAX_FILES + 1 }, () => '1').join(',');
    expect(readRanges(many, 3)).toEqual({ parts: null, error: `These ranges would make ${SPLIT_MAX_FILES + 1} files; Split makes at most ${SPLIT_MAX_FILES} at a time.` });
  });

  it('says in one short sentence which pages are in no file, and which in more than one', () => {
    expect(pagesInNoFile([{ from: 33, to: 64 }])).toBe('Pages 33–64 are in no file.');
    expect(pagesInNoFile([{ from: 3, to: 3 }])).toBe('Page 3 is in no file.');
    expect(
      pagesInNoFile([
        { from: 33, to: 64 },
        { from: 97, to: 320 },
      ]),
    ).toBe('Pages 33–64 and 97–320 are in no file.');
    expect(pagesInNoFile([1, 3, 5, 7, 9, 11, 13].map((p) => ({ from: p, to: p })))).toBe('Pages 1, 3, 5, 7, 9 and 2 more are in no file.');
    expect(pagesInNoFile([])).toBeNull();
    expect(pagesInSeveralFiles([{ from: 20, to: 32 }])).toBe('Pages 20–32 are in more than one file.');
    expect(pagesInSeveralFiles([{ from: 4, to: 4 }])).toBe('Page 4 is in more than one file.');
    expect(rangeNotes(readRanges('1-40, 30-50', 60).parts!, 60)).toEqual(['Pages 51–60 are in no file.', 'Pages 30–40 are in more than one file.']);
    expect(rangeNotes(readRanges('1-30, 31-60', 60).parts!, 60)).toEqual([]);
  });

  it('lists what will be made, plainly', () => {
    const parts = readRanges('1-32, 5', 40).parts!;
    expect(plannedFiles(['L_pages_1-32.pdf', 'L_page_5.pdf'], parts)).toEqual([
      { name: 'L_pages_1-32.pdf', pages: 'pages 1–32' },
      { name: 'L_page_5.pdf', pages: 'page 5' },
    ]);
    expect(previewHeading(1)).toBe('This makes 1 file:');
    expect(previewHeading(12)).toBe('This makes 12 files:');
  });
});

describe('the Split dialog, at bookmarks', () => {
  it('says in one short sentence what happens to pages before the first bookmark and to bookmarks that make no file', () => {
    expect(bookmarkNotes(bookmarkPlan([item('A', 0), item('B', 4)], 9))).toEqual([]);
    expect(bookmarkNotes(bookmarkPlan([item('A', 2), item('B', 4)], 9))).toEqual(['Pages 1–2 come before the first bookmark and go into the first file.']);
    expect(bookmarkNotes(bookmarkPlan([item('A', 1), item('Same', 1), item('Web', null)], 9))).toEqual([
      'Page 1 comes before the first bookmark and goes into the first file.',
      'One bookmark opens the same page as another, so it gets no file of its own.',
      'One bookmark opens no page in this file, so it gets no file.',
    ]);
    expect(bookmarkNotes(bookmarkPlan([item('A', 0), item('B', 0), item('C', 0), item('W', null), item('X', null)], 9))).toEqual([
      '2 bookmarks open the same page as another, so they get no file of their own.',
      '2 bookmarks open no page in this file, so they get no file.',
    ]);
  });
});
