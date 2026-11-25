import { describe, expect, it } from 'vitest';
import { emptyMarkReport, type MarkReport } from '@/lib/pdf-tools/watermark';
import { fieldsNote, markMayBeMisplaced, pageNumberRunNotes, previewNotes, scanNote, watermarkRunNotes } from './markNotes';

const report = (over: Partial<MarkReport>): MarkReport => ({ ...emptyMarkReport(), ...over });

/** UX principle 6: what happens and what to do, in at most two sentences. */
function twoSentences(note: string) {
  const sentences = note.split(/(?<=[.?!])\s+(?=[A-Z])/);
  expect(sentences.length, note).toBeLessThanOrEqual(2);
  expect(sentences.length, `${note}: says what to do`).toBe(2);
}

describe('notes after a watermark run', () => {
  it('says nothing when the report is empty', () => {
    expect(watermarkRunNotes(emptyMarkReport())).toEqual([]);
    expect(markMayBeMisplaced(emptyMarkReport())).toBe(false);
  });

  it('puts every warning of the report in plain words, naming the pages, each with what to do', () => {
    const notes = watermarkRunNotes(report({ hiddenBehind: [2, 3, 4], uncertain: [7], clipped: [1], damaged: [5], unverified: [9], underFields: [6] }));
    expect(notes).toEqual([
      'A watermark behind the page may not be visible on pages 2-4: a scan, a picture or a solid background covers it. Use In front to be sure it shows.',
      'A watermark behind the page may be hidden on page 7, but this could not be checked. Look at that page, or use In front.',
      'The watermark is larger than page 1 and is cut off. Choose Auto size or a smaller size.',
      "A mark may be misplaced on pages 5, 9: the page's own drawing instructions are damaged or could not be read. Check those pages.",
      "On page 6 the page's form fields are drawn over the marks and may cover part of them. Check that page, or place the marks away from the fields.",
    ]);
    notes.forEach(twoSentences);
  });

  it('flags a possibly misplaced mark for damaged or unreadable pages', () => {
    expect(markMayBeMisplaced(report({ damaged: [1] }))).toBe(true);
    expect(markMayBeMisplaced(report({ unverified: [4] }))).toBe(true);
    expect(markMayBeMisplaced(report({ hiddenBehind: [1], underFields: [2] }))).toBe(false);
  });

  it('writes one damaged page in the singular', () => {
    expect(watermarkRunNotes(report({ damaged: [12] }))).toEqual([
      "A mark may be misplaced on page 12: the page's own drawing instructions are damaged or could not be read. Check that page.",
    ]);
  });
});

describe('notes after a Page numbers run', () => {
  it('names the numbers, header and footer instead of the marks', () => {
    const notes = pageNumberRunNotes(report({ damaged: [3] }));
    expect(notes).toEqual([
      "A page number, header or footer may be misplaced on page 3: the page's own drawing instructions are damaged or could not be read. Check that page.",
    ]);
    notes.forEach(twoSentences);
  });

  it('does not speak of form fields: a number in the margin rarely meets one (M-review F14), so the note would be noise', () => {
    expect(pageNumberRunNotes(report({ underFields: [1, 2] }))).toEqual([]);
    expect(watermarkRunNotes(report({ underFields: [1, 2] }))).toHaveLength(1);
  });
});

describe('notes before the run', () => {
  it('counts the chosen scans for a watermark behind the page, in the design words, and says what to do', () => {
    expect(scanNote(12, 40)).toBe('On 12 of the chosen pages (scans) a watermark behind the page cannot be seen. Put it in front to show it there.');
    expect(scanNote(1, 40)).toBe('On 1 of the chosen pages (a scan) a watermark behind the page cannot be seen. Put it in front to show it there.');
    expect(scanNote(5, 5)).toBe('On all 5 chosen pages (scans) a watermark behind the page cannot be seen. Put it in front to show it there.');
    expect(scanNote(1, 1)).toBe('On the chosen page (a scan) a watermark behind the page cannot be seen. Put it in front to show it there.');
    expect(scanNote(0, 5)).toBeNull();
    twoSentences(scanNote(3, 9)!);
  });

  it('says where form fields will cover a mark in front, and what to do', () => {
    expect(fieldsNote([2], 'mark')).toBe('Page 2 has form fields, which are drawn over marks in front and may cover part of them. Place the marks away from the fields if they must show in full.');
    expect(fieldsNote([1, 2, 3], 'number')).toBe(
      'Pages 1-3 have form fields, which are drawn over page numbers, headers and footers and may cover part of them. Choose another place if they must show in full.',
    );
    expect(fieldsNote([], 'mark')).toBeNull();
    twoSentences(fieldsNote([4, 5], 'mark')!);
  });
});

describe('notes about the page in the preview', () => {
  it('speaks of "this page", says what to do, and leaves out what only the run can say', () => {
    const notes = previewNotes(report({ clipped: [1], hiddenBehind: [1], damaged: [1] }));
    expect(notes).toEqual([
      'The watermark is larger than this page and is cut off. Choose Auto size or a smaller size.',
      'Behind the page, the watermark may not be visible on this page: a scan, a picture or a solid background covers it. Put it in front to show it.',
      "A mark may be misplaced on this page: the page's own drawing instructions are damaged or could not be read. Check this page in the result.",
    ]);
    notes.forEach(twoSentences);
    expect(previewNotes(report({ uncertain: [1] }))).toEqual(['Behind the page, the watermark may be hidden on this page; this could not be checked. Look at it in the large view, or put it in front.']);
    expect(previewNotes(emptyMarkReport())).toEqual([]);
  });
});
