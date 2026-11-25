import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { extractPages } from '@/lib/pdf-tools/organise';
import { parseRangeParts, rangePartName, SPLIT_MAX_FILES, uniqueNames } from '@/lib/pdf-tools/splitPlan';
import { baseDoc, buildOutline, fit, HINDI_TITLE, makeEightPageOutlinePdf, pdfjsOutline, utf16be } from '@/lib/pdf-tools/testOutlinePdf';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { runTool, type RunContext, type RunDeps } from './runTool';

vi.setConfig({ testTimeout: 60_000 });

let C5: Uint8Array;
let eight: Uint8Array;
beforeAll(async () => {
  C5 = await makePdf('C', 5);
  eight = await makeEightPageOutlinePdf();
  await pageTexts(C5); // pays the cold pdf.js import once
}, 60_000);
afterEach(() => {
  vi.useRealTimers();
});

let seq = 0;
function pdf(name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile {
  return { id: `in-${++seq}`, name, kind: 'pdf', mimeType: 'application/pdf', origin: 'computer', bytes, size: bytes.byteLength, pageCount, wasProtected: false, hasRestrictions: false, hasSignature: false, sentTo: [], ...extra };
}

function setup(options: { maxBytes?: number } = {}) {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const controller = new AbortController();
  const progress = vi.fn();
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: Partial<RunDeps> = { paint: async () => undefined, yieldToUi: async () => undefined, ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}) };
  return { store, controller, ctx, deps, progress, files: () => store.getState().files, labels: () => progress.mock.calls.map((c) => c[2] as string) };
}

describe('Split, a separate file for each range', () => {
  it('makes one file per range, named by its pages, in one group, each with its own record', async () => {
    const h = setup();
    const result = await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'ranges', pages: '1-2, 4-5' }, h.ctx, h.deps);
    expect(result).toMatchObject({ status: 'added', added: 2, message: 'Split C.pdf into 2 files', detail: 'C_pages_1-2.pdf to C_pages_4-5.pdf. Page 3 is in no file.' });
    const [first, second] = h.files();
    expect([first.name, second.name]).toEqual(['C_pages_1-2.pdf', 'C_pages_4-5.pdf']);
    expect([first.pageCount, second.pageCount]).toEqual([2, 2]);
    expect(await pageTexts(first.bytes)).toEqual(['C p1', 'C p2']);
    expect(await pageTexts(second.bytes)).toEqual(['C p4', 'C p5']);
    expect(first.groupId).toBeTruthy();
    expect(second.groupId).toBe(first.groupId);
    expect(first.operation).toMatchObject({ tool: 'split', summary: 'Split pages 1-2 (part 1 of 2)', options: { mode: 'ranges', pages: '1-2', part: 1, parts: 2, ranges: '1-2, 4-5' } });
    expect(second.operation).toMatchObject({ summary: 'Split pages 4-5 (part 2 of 2)', options: { mode: 'ranges', pages: '4-5', part: 2, parts: 2 } });
    expect(first.operation!.sources).toMatchObject([{ name: 'C.pdf', origin: 'computer' }]);
    expect(h.labels()).toEqual(expect.arrayContaining(['Splitting… part 1 of 2', 'Splitting… part 2 of 2', 'Checking part 2 of 2…']));
  });

  it('names the files from a typed stem, cleaned, and gives a range typed twice " (2)"', async () => {
    const h = setup();
    await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'ranges', pages: '3, 1-2, 1-2', stem: 'Bank: 2026' }, h.ctx, h.deps);
    expect(h.files().map((f) => f.name)).toEqual(['Bank_ 2026_page_3.pdf', 'Bank_ 2026_pages_1-2.pdf', 'Bank_ 2026_pages_1-2 (2).pdf']);
    expect(h.files()[0].operation!.summary).toBe('Split page 3 (part 1 of 3)');
  });

  it("names the files as the dialog's list does, and numbers a name the list already holds as every name is", async () => {
    const h = setup();
    const typed = '3, 1-2, 1-2';
    // what the dialog lists for this text and stem
    const listed = uniqueNames(parseRangeParts(typed, 5).map((part) => rangePartName('C', part)));
    await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'ranges', pages: typed }, h.ctx, h.deps);
    expect(h.files().map((f) => f.name)).toEqual(listed);
    expect(listed).toEqual(['C_page_3.pdf', 'C_pages_1-2.pdf', 'C_pages_1-2 (2).pdf']);
    // again: every name is taken, so each gets the next free number
    await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'ranges', pages: '1-2, 1-2' }, h.ctx, h.deps);
    expect(h.files().slice(3).map((f) => f.name)).toEqual(['C_pages_1-2 (3).pdf', 'C_pages_1-2 (4).pdf']);
  });

  it('a single range makes a single file, outside any group', async () => {
    const h = setup();
    const result = await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'ranges', pages: '2-3' }, h.ctx, h.deps);
    expect(result).toMatchObject({ added: 1, message: 'Made C_pages_2-3.pdf', detail: '2 pages from C.pdf.' });
    expect(h.files()[0].groupId).toBeUndefined();
  });

  it("refuses a list it cannot read with the page parser's words, and too many files, adding nothing", async () => {
    const h = setup();
    const c = pdf('C.pdf', C5, 5);
    await expect(runTool('split', [c], { mode: 'ranges', pages: '4-2' }, h.ctx, h.deps)).rejects.toThrow('"4-2" is backwards: the first page must not be after the last');
    await expect(runTool('split', [c], { mode: 'ranges', pages: '1, 7' }, h.ctx, h.deps)).rejects.toThrow("Page 7 is outside this file's 5 pages");
    await expect(runTool('split', [c], { mode: 'ranges', pages: '' }, h.ctx, h.deps)).rejects.toMatchObject({ code: 'invalid-page-list' });
    const many = Array.from({ length: SPLIT_MAX_FILES + 1 }, () => '1').join(',');
    await expect(runTool('split', [c], { mode: 'ranges', pages: many }, h.ctx, h.deps)).rejects.toThrow(`These ranges would make ${SPLIT_MAX_FILES + 1} files; Split makes at most ${SPLIT_MAX_FILES} at a time.`);
    expect(h.files()).toEqual([]);
  });

  it('says once, on the first file, that bookmarks of pages in no file were not carried', async () => {
    const h = setup();
    await runTool('split', [pdf('S.pdf', eight, 8, { hasBookmarks: true })], { mode: 'ranges', pages: '1-2, 7-8' }, h.ctx, h.deps);
    const [first, second] = h.files();
    expect(first.operation!.summary).toBe('Split pages 1-2 (part 1 of 2); some bookmarks not carried');
    expect(first.operation!.flags).toEqual({ bookmarksDropped: true });
    expect(second.operation!.summary).toBe('Split pages 7-8 (part 2 of 2)');
    expect(second.operation!.flags).toBeUndefined();
    expect(await pdfjsOutline(second.bytes)).toEqual([
      [0, 'Ch3 T7', 0],
      [0, 'Ch4 T8', 1],
      [1, 'Ch4.1 T8', 1],
    ]);
  });

  it('marks every file of a signed source, and carries the history of a result', async () => {
    const h = setup();
    const earlier = pdf('C_numbered.pdf', C5, 5, { origin: 'result', hasSignature: true, operation: { tool: 'page-numbers', summary: 'Added page numbers', sources: [{ name: 'C.pdf', origin: 'vault', evidenceId: 'ev-9' }], options: {} } });
    await runTool('split', [earlier], { mode: 'ranges', pages: '1, 2-5' }, h.ctx, h.deps);
    for (const made of h.files()) {
      expect(made.signatureInvalid).toBe(true);
      expect(made.operation!.flags).toEqual({ signatureInvalid: true });
    }
    const entry = buildActivityEntry({ file: h.files()[1], destination: 'computer', sha256: 'ab'.repeat(32) });
    expect(entry.details).toMatch(/^Split pages 2-5 \(part 2 of 2\); signature no longer valid → C_numbered_pages_2-5\.pdf \(4 pages, SHA-256 abababababab…\)\. Sources: C_numbered\.pdf \[result\]\. Earlier steps: Added page numbers → C_numbered\.pdf\. Original sources: C\.pdf \[vault\]\./);
    expect(entry.metadata).toMatchObject({ signatureInvalid: true });
  });

  it('can be stopped between files and between pages; nothing is added', async () => {
    for (const stopAt of ['Splitting… part 2 of 3', 'Splitting… part 1 of 3']) {
      const h = setup();
      let seen = 0;
      h.progress.mockImplementation((_done: number, _total: number, label?: string) => {
        if (label === stopAt && ++seen === (stopAt.endsWith('1 of 3') ? 2 : 1)) h.controller.abort();
      });
      const result = await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'ranges', pages: '1-2, 3-4, 5' }, h.ctx, h.deps);
      expect(result.status, stopAt).toBe('cancelled');
      expect(h.files(), stopAt).toEqual([]);
      expect(h.labels(), stopAt).not.toContain('Splitting… part 3 of 3');
    }
  });

  it('stops as soon as the files made would not fit in the list, and adds nothing', async () => {
    const one = await extractPages(C5, [0, 1]);
    // Room for about one file: the second one made takes the list over.
    const h = setup({ maxBytes: Math.floor(one.byteLength * 1.5) });
    await expect(runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'ranges', pages: '1-2, 3-4, 5' }, h.ctx, h.deps)).rejects.toThrow(
      /^The files would take the list over .+\. Nothing was added; make fewer files or remove some from the list\.$/,
    );
    expect(h.files()).toEqual([]);
    expect(h.labels()).not.toContain('Splitting… part 3 of 3');
  });
});

describe('Split at bookmarks', () => {
  it('makes one file per main bookmark, named in page order from its title; the record holds pages, never a title', async () => {
    const h = setup();
    const result = await runTool('split', [pdf('Report.pdf', eight, 8, { hasBookmarks: true })], { mode: 'bookmarks' }, h.ctx, h.deps);
    expect(result).toMatchObject({ added: 4, message: 'Split Report.pdf into 4 files', detail: 'Report_01_Ch1 T1.pdf to Report_04_Ch4 T8.pdf.' });
    const files = h.files();
    expect(files.map((f) => f.name)).toEqual(['Report_01_Ch1 T1.pdf', 'Report_02_Ch2 T4.pdf', 'Report_03_Ch3 T7.pdf', 'Report_04_Ch4 T8.pdf']);
    expect(files.map((f) => f.pageCount)).toEqual([3, 3, 1, 1]);
    expect(files.map((f) => f.operation!.summary)).toEqual([
      'Split at bookmarks, pages 1-3 (part 1 of 4)',
      'Split at bookmarks, pages 4-6 (part 2 of 4)',
      'Split at bookmarks, page 7 (part 3 of 4)',
      'Split at bookmarks, page 8 (part 4 of 4)',
    ]);
    expect(files[1].operation!.options).toEqual({ mode: 'bookmarks', pages: '4-6', part: 2, parts: 4 });
    for (const f of files) {
      expect(JSON.stringify(f.operation)).not.toMatch(/Ch\d/);
      expect(f.hasBookmarks).toBe(true);
      expect(f.operation!.flags).toBeUndefined();
    }
    expect(new Set(files.map((f) => f.groupId)).size).toBe(1);
    expect(await pdfjsOutline(files[1].bytes)).toEqual([
      [0, 'Ch2 T4', 0],
      [1, 'Ch2.1 T5', 1],
      [1, 'Ch2.2 T6', 2],
    ]);
  });

  it('cleans titles into names, keeps Hindi, keeps duplicate titles apart, and uses the typed stem', async () => {
    const { doc } = await baseDoc(5, 'D');
    buildOutline(doc, [
      { title: 'Notes', dest: fit(doc, 0) },
      { title: 'Notes', dest: fit(doc, 1) },
      { title: 'Sch: A/B?', dest: fit(doc, 2) },
      { title: utf16be(HINDI_TITLE), dest: fit(doc, 3) },
    ]);
    const h = setup();
    await runTool('split', [pdf('D.pdf', await doc.save(), 5, { hasBookmarks: true })], { mode: 'bookmarks', stem: 'Bundle' }, h.ctx, h.deps);
    expect(h.files().map((f) => f.name)).toEqual(['Bundle_01_Notes.pdf', 'Bundle_02_Notes.pdf', 'Bundle_03_Sch_ A_B_.pdf', `Bundle_04_${HINDI_TITLE}.pdf`]);
    expect(h.files().map((f) => f.pageCount)).toEqual([1, 1, 1, 2]);
  });

  it('refuses a file without bookmarks and adds nothing', async () => {
    const h = setup();
    await expect(runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'bookmarks' }, h.ctx, h.deps)).rejects.toThrow('This file has no bookmarks, so it cannot be split at them.');
    expect(h.files()).toEqual([]);
  });

  it('says it is reading the bookmarks, then each file; a stop adds nothing', async () => {
    const h = setup();
    h.progress.mockImplementation((_done: number, _total: number, label?: string) => {
      if (label === 'Splitting… part 3 of 4') h.controller.abort();
    });
    const result = await runTool('split', [pdf('Report.pdf', eight, 8, { hasBookmarks: true })], { mode: 'bookmarks' }, h.ctx, h.deps);
    expect(result.status).toBe('cancelled');
    expect(h.files()).toEqual([]);
    expect(h.labels()[0]).toBe('Reading the bookmarks…');
  });
});

describe('One file with the chosen pages stays as it was', () => {
  it('a typed list, and a page range, give the same bytes as before (the same library call)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    const h = setup();
    await runTool('split', [pdf('S.pdf', eight, 8, { hasBookmarks: true })], { mode: 'selected', pages: '1-2, 7-8' }, h.ctx, h.deps);
    await runTool('split', [pdf('S.pdf', eight, 8, { hasBookmarks: true })], { mode: 'range', from: 3, to: 5 }, h.ctx, h.deps);
    const [selected, range] = h.files();
    expect(selected).toMatchObject({ name: 'S_selected_pages.pdf', pageCount: 4 });
    expect(selected.groupId).toBeUndefined();
    expect(selected.operation).toMatchObject({ summary: 'Extracted pages 1-2, 7-8; some bookmarks not carried', options: { mode: 'selected', pages: '1-2, 7-8' } });
    expect(selected.bytes).toEqual(await extractPages(eight, [0, 1, 6, 7]));
    expect(range.name).toBe('S_pages_3-5.pdf');
    expect(range.bytes).toEqual(await extractPages(eight, [2, 3, 4]));
  });
});
