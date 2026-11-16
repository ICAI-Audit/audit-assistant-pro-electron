// Split, Delete pages and Merge carry bookmarks (design 5.10): checked with the real functions, by
// what pdf.js reads from the result, by the text of the page each bookmark opens, and by the result's
// raw bytes (a bookmark of a left-out page must leave no title behind, in any form).
import { PDFDocument, PDFName } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { deletePages, extractPages, mergePdfs, splitEvery, type BookmarkReport } from './organise';
import { readOutline } from './outline';
import { rawHaystack } from './testLeakPdf';
import {
  baseDoc,
  bookmarkPageTexts,
  buildOutline,
  fit,
  makeEightPageOutlinePdf,
  makeNamedDestOutlinePdf,
  makeOutlinePdf,
  pdfjsOutline,
  titleForms,
} from './testOutlinePdf';
import { danglingReferences, everythingIn, pageTexts } from './testPdf';

vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

/** The title appears nowhere in the file: not plain, not in either UTF-16 form, not decoded from a hex string, not in any object. */
async function expectTitleAbsent(bytes: Uint8Array, title: string, label: string) {
  const haystack = rawHaystack(bytes);
  const objects = await everythingIn(bytes);
  for (const form of titleForms(title)) {
    expect(haystack.toLowerCase().includes(form.toLowerCase()), `${label}: raw ${title}`).toBe(false);
    expect(objects.toLowerCase().includes(form.toLowerCase()), `${label}: objects ${title}`).toBe(false);
  }
}

describe("bookmarks carried through the real tools: the trial's outline file", () => {
  it('Delete pages 2 and 3: 1.2.1 moves up into 1.2, the web link stays, the script goes, 3 dropped', async () => {
    const source = await makeOutlinePdf();
    const report: BookmarkReport = {};
    const result = await deletePages(source, [1, 2], { report });
    expect(await pdfjsOutline(result)).toEqual([
      [0, '1 Introduction', 0],
      [1, '1.2.1 Deep, old Dests', 3],
      [0, '2 Web link', null],
      [0, '4 Page five', 2],
      [0, '5 Page index as a number', 1],
    ]);
    expect(report).toEqual({ bookmarksDropped: 3, bookmarksLeftOut: 2, bookmarksNotCarried: 1, bookmarksInOtherParts: 0 });
    expect(await pageTexts(result)).toEqual(['Page 1', 'Page 4', 'Page 5', 'Page 6']);
    for (const title of ['1.1 करदाता (Hindi)', '1.2 Named, by GoTo', '3 Script', 'app.alert']) await expectTitleAbsent(result, title, 'delete');
    expect(await danglingReferences(result)).toEqual([]);
    // the web address bookmark is the same
    const read = readOutline(await PDFDocument.load(result));
    expect(read.items[1].uri).toBe('https://example.in/');
    // 1 Introduction was open, its view kept
    expect(read.items[0]).toMatchObject({ open: true, view: { kind: 'XYZ' } });
  });

  it('Split pages 4 to 6: 1.2.1 comes up to the top level, 4 dropped', async () => {
    const source = await makeOutlinePdf();
    const report: BookmarkReport = {};
    const result = await extractPages(source, [3, 4, 5], { report });
    expect(await pdfjsOutline(result)).toEqual([
      [0, '1.2.1 Deep, old Dests', 2],
      [0, '2 Web link', null],
      [0, '4 Page five', 1],
      [0, '5 Page index as a number', 0],
    ]);
    expect(report).toEqual({ bookmarksDropped: 4, bookmarksLeftOut: 3, bookmarksNotCarried: 1, bookmarksInOtherParts: 0 });
    for (const title of ['1 Introduction', '1.1 करदाता (Hindi)', '1.2 Named, by GoTo', '3 Script']) await expectTitleAbsent(result, title, 'split');
  });

  it('keeping every bookmarked page drops nothing, except what opens no page', async () => {
    const source = await makeOutlinePdf();
    const report: BookmarkReport = {};
    await extractPages(source, [0, 1, 2, 3, 4, 5], { report });
    expect(report.bookmarksDropped).toBe(1); // the script
  });

  it('a broken outline is carried as far as it could be read', async () => {
    for (const broken of ['cycle', 'no-count', 'self-first'] as const) {
      const report: BookmarkReport = {};
      const result = await deletePages(await makeOutlinePdf(broken), [1, 2], { report });
      expect((await pdfjsOutline(result)).map(([, t]) => t), broken).toEqual(['1 Introduction', '1.2.1 Deep, old Dests', '2 Web link', '4 Page five', '5 Page index as a number']);
    }
  });
});

describe('bookmarks carried through the real tools: the eight-page file', () => {
  const expectOpensItsPage = (lines: string[]) => {
    for (const line of lines) {
      const match = /T(\d) -> S p(\d)$/.exec(line);
      expect(match, line).not.toBeNull();
      expect(match![1], line).toBe(match![2]);
    }
  };

  it('Delete pages 4 and 8: every bookmark opens the right page; Ch2 is gone and its children are promoted', async () => {
    const source = await makeEightPageOutlinePdf();
    const report: BookmarkReport = {};
    const result = await deletePages(source, [3, 7], { report });
    const lines = await bookmarkPageTexts(result);
    expect(lines).toEqual(['Ch1 T1 -> S p1', 'Ch1.1 T2 -> S p2', 'Ch1.1.a T3 -> S p3', 'Ch1.2 T3 -> S p3', 'Ch2.1 T5 -> S p5', 'Ch2.2 T6 -> S p6', 'Ch3 T7 -> S p7']);
    expectOpensItsPage(lines);
    expect((await pdfjsOutline(result)).map(([d]) => d)).toEqual([0, 1, 2, 1, 0, 0, 0]);
    expect(report.bookmarksDropped).toBe(3); // Ch2, Ch4, Ch4.1
    await expectTitleAbsent(result, 'Ch2 T4', 'delete');
    await expectTitleAbsent(result, 'Ch4 T8', 'delete');
    await expectTitleAbsent(result, 'Ch4.1 T8', 'delete');
  });

  it('Split every 3: each bookmark of each part opens a page of that part', async () => {
    const source = await makeEightPageOutlinePdf();
    const reports: BookmarkReport[] = [];
    const parts = await splitEvery(source, 3, { reports });
    expect(parts).toHaveLength(3);
    const lines = await Promise.all(parts.map(bookmarkPageTexts));
    for (const part of lines) expectOpensItsPage(part);
    expect(lines[0]).toEqual(['Ch1 T1 -> S p1', 'Ch1.1 T2 -> S p2', 'Ch1.1.a T3 -> S p3', 'Ch1.2 T3 -> S p3']);
    expect(lines[1]).toEqual(['Ch2 T4 -> S p4', 'Ch2.1 T5 -> S p5', 'Ch2.2 T6 -> S p6']);
    expect(lines[2]).toEqual(['Ch3 T7 -> S p7', 'Ch4 T8 -> S p8', 'Ch4.1 T8 -> S p8']);
    // a bookmark that belongs to another part is not "not carried" for this part: no part is flagged
    expect(reports.map((r) => r.bookmarksDropped)).toEqual([0, 0, 0]);
    expect(reports.map((r) => r.bookmarksInOtherParts)).toEqual([6, 7, 7]);
    expect(reports.map((r) => r.bookmarksLeftOut)).toEqual([0, 0, 0]);
    // the titles of the other parts' pages are in no part
    for (const title of ['Ch2 T4', 'Ch2.1 T5', 'Ch4 T8']) await expectTitleAbsent(parts[0], title, 'part 1');
    for (const title of ['Ch1 T1', 'Ch1.2 T3', 'Ch3 T7']) await expectTitleAbsent(parts[1], title, 'part 2');
    for (const title of ['Ch1 T1', 'Ch2 T4', 'Ch2.2 T6']) await expectTitleAbsent(parts[2], title, 'part 3');
  });

  it('reordering and repeating pages keeps the outline order and maps a repeated page to its first copy', async () => {
    const source = await makeEightPageOutlinePdf();
    const report: BookmarkReport = {};
    const result = await extractPages(source, [6, 4, 4, 0], { report });
    expect(await pageTexts(result)).toEqual(['S p7', 'S p5', 'S p5', 'S p1']);
    const lines = await bookmarkPageTexts(result);
    expect(lines).toEqual(['Ch1 T1 -> S p1', 'Ch2.1 T5 -> S p5', 'Ch3 T7 -> S p7']);
    expect((await pdfjsOutline(result)).map(([, , p]) => p)).toEqual([3, 1, 0]); // Ch2.1 opens the first of the two copies
    expect(report.bookmarksDropped).toBe(7);
  });
});

describe('Merge with bookmarks', () => {
  async function sources() {
    const a = await baseDoc(3, 'A');
    buildOutline(a.doc, [{ title: 'a1', dest: fit(a.doc, 0), open: true, children: [{ title: 'a2', dest: fit(a.doc, 1) }] }, { title: 'a3', dest: fit(a.doc, 2) }]);
    const b = await baseDoc(2, 'B');
    return [await a.doc.save(), await b.doc.save(), await makeNamedDestOutlinePdf('C', 4)];
  }
  const titles = ['Doc A', 'Doc B', 'Doc C'];

  it('one bookmark per file, each file own bookmarks nested under it with pages offset', async () => {
    const report: BookmarkReport = {};
    const result = await mergePdfs(await sources(), { fileBookmarks: { titles, keepOwn: true }, report });
    expect(await bookmarkPageTexts(result)).toEqual(['Doc A -> A p1', 'a1 -> A p1', 'a2 -> A p2', 'a3 -> A p3', 'Doc B -> B p1', 'Doc C -> C p1', 'C first -> C p1', 'C named -> C p3']);
    expect((await pdfjsOutline(result)).map(([d]) => d)).toEqual([0, 1, 2, 1, 0, 0, 1, 1]);
    expect(report.bookmarksDropped).toBe(0);
    const read = readOutline(await PDFDocument.load(result));
    expect(read.items.map((i) => i.open)).toEqual([false, false, false]);
  });

  it('one bookmark per file only', async () => {
    const report: BookmarkReport = {};
    const result = await mergePdfs(await sources(), { fileBookmarks: { titles, keepOwn: false }, report });
    expect(await bookmarkPageTexts(result)).toEqual(['Doc A -> A p1', 'Doc B -> B p1', 'Doc C -> C p1']);
    expect(report.bookmarksDropped).toBe(5);
    for (const title of ['a1', 'a2', 'C named']) await expectTitleAbsent(result, title, 'per file only');
  });

  it("each file's own bookmarks only, at the top level", async () => {
    const report: BookmarkReport = {};
    const result = await mergePdfs(await sources(), { fileBookmarks: { keepOwn: true }, report });
    expect(await bookmarkPageTexts(result)).toEqual(['a1 -> A p1', 'a2 -> A p2', 'a3 -> A p3', 'C first -> C p1', 'C named -> C p3']);
    expect((await pdfjsOutline(result)).map(([d]) => d)).toEqual([0, 1, 0, 0, 0]);
    expect(report.bookmarksDropped).toBe(0);
  });

  it('without the option no outline is written (phase 1), and the report counts what was not carried', async () => {
    const report: BookmarkReport = {};
    const result = await mergePdfs(await sources(), { report });
    expect((await PDFDocument.load(result)).catalog.has(PDFName.of('Outlines'))).toBe(false);
    expect(report.bookmarksDropped).toBe(5);
    expect((await PDFDocument.load(await mergePdfs(await sources()))).catalog.has(PDFName.of('Outlines'))).toBe(false);
  });

  it('a file name is cleaned, and an empty one becomes Untitled', async () => {
    const [a, b] = await sources();
    const result = await mergePdfs([a, b], { fileBookmarks: { titles: ['\u202eSecret\u200b  name\u0007', '   '], keepOwn: false } });
    expect((await pdfjsOutline(result)).map(([, t]) => t)).toEqual(['Secret name', 'Untitled']);
  });

  it('a source nested to the deepest level cannot go under its file bookmark: its bookmarks are dropped and counted', async () => {
    const deep = await baseDoc(1, 'D');
    let spec: { title: string; dest: ReturnType<typeof fit>; open?: boolean; children?: unknown[] } = { title: 'L32', dest: fit(deep.doc, 0) };
    for (let d = 31; d >= 1; d--) spec = { title: `L${d}`, dest: fit(deep.doc, 0), open: true, children: [spec] };
    buildOutline(deep.doc, [spec as never]);
    const [, b] = await sources();
    const report: BookmarkReport = {};
    const result = await mergePdfs([await deep.doc.save(), b], { fileBookmarks: { titles: ['Deep', 'B'], keepOwn: true }, report });
    expect((await pdfjsOutline(result)).map(([, t]) => t)).toEqual(['Deep', 'B']);
    expect(report.bookmarksDropped).toBe(32);
    // without a file bookmark the same source fits
    const flat = await mergePdfs([await deep.doc.save(), b], { fileBookmarks: { keepOwn: true } });
    expect((await pdfjsOutline(flat)).length).toBe(32);
  });
});

describe('a source over the limits', () => {
  it('50,000 bookmarks: the result has no outline, and every bookmark read counts as dropped', async () => {
    const { doc } = await baseDoc(2);
    buildOutline(doc, Array.from({ length: 50_000 }, (_, i) => ({ title: `Bookmark ${i + 1}`, dest: fit(doc, 0) })));
    const source = await doc.save();
    const report: BookmarkReport = {};
    const result = await extractPages(source, [0], { report });
    expect((await PDFDocument.load(result)).catalog.has(PDFName.of('Outlines'))).toBe(false);
    expect(report).toMatchObject({ bookmarksDropped: 10_000, bookmarksNotCarried: 10_000 });
    await expectTitleAbsent(result, 'Bookmark 1', 'over limits');
    const merged: BookmarkReport = {};
    const mergedBytes = await mergePdfs([source, await (await baseDoc(1)).doc.save()], { fileBookmarks: { titles: ['One', 'Two'], keepOwn: true }, report: merged });
    expect((await pdfjsOutline(mergedBytes)).map(([, t]) => t)).toEqual(['One', 'Two']);
    expect(merged.bookmarksDropped).toBe(10_000);
  }, 240_000);
});

describe('fix round 1: which results are flagged', () => {
  it('Split every 3 of the trial file: the script bookmark belongs to no part and is counted once, on the first; the rest belong to other parts', async () => {
    const reports: BookmarkReport[] = [];
    await splitEvery(await makeOutlinePdf(), 3, { reports });
    expect(reports.map((r) => [r.bookmarksDropped, r.bookmarksNotCarried, r.bookmarksLeftOut])).toEqual([[1, 1, 0], [0, 0, 0]]);
  });
  it('an extracted range flags the bookmarks of pages that are in no result', async () => {
    const report: BookmarkReport = {};
    await extractPages(await makeEightPageOutlinePdf(), [0, 1, 2], { report });
    expect(report).toMatchObject({ bookmarksDropped: 6, bookmarksLeftOut: 6, bookmarksInOtherParts: 0 });
  });
  it('a source over the limits flags every part of a Split', async () => {
    const { doc } = await baseDoc(4);
    buildOutline(doc, Array.from({ length: 10_001 }, (_, i) => ({ title: `B${i}`, dest: fit(doc, 0) })));
    const reports: BookmarkReport[] = [];
    await splitEvery(await doc.save(), 2, { reports });
    expect(reports.map((r) => r.bookmarksDropped)).toEqual([10_000, 10_000]);
  });
});

describe('fix round 1: Merge never writes an outline the Bookmarks tool would refuse', () => {
  const bigSource = async (label: string, count: number) => {
    const { doc } = await baseDoc(1, label);
    buildOutline(doc, Array.from({ length: count }, (_, i) => ({ title: `${label}${i}`, dest: fit(doc, 0) })));
    return doc.save();
  };
  it('6,000 + 6,000: the per-file bookmarks are written, the first source fits, the second is dropped and counted; a later small source still fits', async () => {
    const small = await bigSource('S', 2);
    const report: BookmarkReport = {};
    const result = await mergePdfs([await bigSource('A', 6000), await bigSource('B', 6000), small], { fileBookmarks: { titles: ['One', 'Two', 'Three'], keepOwn: true }, report });
    const file = await (await import('./bookmarks')).readBookmarks(result);
    expect(file.editable).toBe(true);
    expect(file.items.map((i) => [i.title, i.children.length])).toEqual([['One', 6000], ['Two', 0], ['Three', 2]]);
    expect(report).toMatchObject({ bookmarksDropped: 6000, bookmarksNotCarried: 6000 });
  }, 240_000);
});
