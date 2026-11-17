import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from './inspect';
import { extractPages, splitAtBookmarks, splitParts, type BookmarkReport, type OrganiseReport } from './organise';
import { SPLIT_MAX_FILES, type PagePart } from './splitPlan';
import { makeSharedResourcesPdf, makeSharedScan, rawFound, rawHaystack, SHARED_MARKERS } from './testLeakPdf';
import { baseDoc, bookmarkPageTexts, buildOutline, fit, HINDI_TITLE, makeEightPageOutlinePdf, pdfjsOutline, titleForms, utf16be } from './testOutlinePdf';
import { makeFormPdf, makePdf, pageTexts } from './testPdf';

// pdf.js is imported cold once here; the machine may be busy with other suites.
vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);
afterEach(() => {
  vi.useRealTimers();
});

const texts = (parts: Uint8Array[]) => Promise.all(parts.map(pageTexts));

/** Where each link of a page goes: the page number in its file, or null when it goes nowhere in it. */
async function linkTargets(bytes: Uint8Array, pageIndex: number): Promise<(number | null)[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageRefs = doc.getPages().map((p) => p.ref);
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const targets: (number | null)[] = [];
  for (const entry of annots?.asArray() ?? []) {
    const annot = doc.context.lookup(entry, PDFDict);
    if (annot.get(PDFName.of('Subtype')) !== PDFName.of('Link')) continue;
    const target = annot.lookup(PDFName.of('Dest'), PDFArray).get(0);
    const at = target instanceof PDFRef ? pageRefs.indexOf(target) : -1;
    targets.push(at >= 0 ? at + 1 : null);
  }
  return targets;
}

describe('Split into one file per range', () => {
  it('makes one file per range, in the order given, each with its pages', async () => {
    const c = await makePdf('C', 10);
    const parts = await splitParts(c, [
      { from: 6, to: 8 },
      { from: 1, to: 3 },
      { from: 10, to: 10 },
    ]);
    expect(await texts(parts)).toEqual([['C p6', 'C p7', 'C p8'], ['C p1', 'C p2', 'C p3'], ['C p10']]);
  });

  it('puts a page that is in two ranges into both files', async () => {
    const parts = await splitParts(await makePdf('C', 6), [
      { from: 1, to: 4 },
      { from: 3, to: 6 },
    ]);
    expect(await texts(parts)).toEqual([
      ['C p1', 'C p2', 'C p3', 'C p4'],
      ['C p3', 'C p4', 'C p5', 'C p6'],
    ]);
  });

  it('makes each file byte for byte what One range of pages makes for the same pages', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    const source = await makeEightPageOutlinePdf();
    const ranges: PagePart[] = [
      { from: 2, to: 3 },
      { from: 5, to: 8 },
    ];
    const parts = await splitParts(source, ranges);
    expect(parts[0]).toEqual(await extractPages(source, [1, 2]));
    expect(parts[1]).toEqual(await extractPages(source, [4, 5, 6, 7]));
    const [whole] = await splitParts(source, [{ from: 1, to: 8 }]);
    expect(whole).toEqual(await extractPages(source, [0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it("carries the bookmarks of each file's pages; one whose page is in no file is counted once, on the first file", async () => {
    const source = await makeEightPageOutlinePdf();
    const reports: (OrganiseReport & BookmarkReport)[] = [];
    const parts = await splitParts(
      source,
      [
        { from: 1, to: 2 },
        { from: 7, to: 8 },
      ],
      { reports },
    );
    expect(await pdfjsOutline(parts[0])).toEqual([
      [0, 'Ch1 T1', 0],
      [1, 'Ch1.1 T2', 1],
    ]);
    expect(await bookmarkPageTexts(parts[1])).toEqual(['Ch3 T7 -> S p7', 'Ch4 T8 -> S p8', 'Ch4.1 T8 -> S p8']);
    // pages 3 to 6 are in no file: Ch1.1.a, Ch1.2, Ch2, Ch2.1 and Ch2.2 are lost, once
    expect(reports).toEqual([
      { bookmarksDropped: 5, bookmarksNotCarried: 0, bookmarksLeftOut: 5, bookmarksInOtherParts: 3 },
      { bookmarksDropped: 0, bookmarksNotCarried: 0, bookmarksLeftOut: 0, bookmarksInOtherParts: 2 },
    ]);
  });

  it('keeps links to pages of the same file and drops links to pages of another file', async () => {
    const form = await makeFormPdf({ links: true }); // page 1 links to pages 2 and 3
    const [first, second] = await splitParts(form, [
      { from: 1, to: 2 },
      { from: 3, to: 3 },
    ]);
    expect(await linkTargets(first, 0)).toEqual([2]);
    expect(await pageTexts(second)).toEqual(['Form p3']);
    const [all] = await splitParts(form, [{ from: 1, to: 3 }]);
    expect(await linkTargets(all, 0)).toEqual([2, 3]);
  });

  it('gives each file only the resources its own pages draw with', async () => {
    const source = await makeSharedResourcesPdf();
    const all = Object.values(SHARED_MARKERS).flat();
    const [first, second] = await splitParts(source, [
      { from: 1, to: 1 },
      { from: 3, to: 4 },
    ]);
    expect(rawFound(first, all)).toEqual(SHARED_MARKERS[1]);
    expect(rawFound(second, all)).toEqual([...SHARED_MARKERS[3], ...SHARED_MARKERS[4]]);
    // a scan whose pages share one image dictionary: each file holds only its own pages' images
    const scan = await makeSharedScan(30, 2000);
    const files = await splitParts(scan, [
      { from: 1, to: 10 },
      { from: 21, to: 30 },
    ]);
    expect(rawFound(files[0], ['SCAN-IMG-1-', 'SCAN-IMG-10-', 'SCAN-IMG-11-', 'SCAN-IMG-21-'])).toEqual(['SCAN-IMG-1-', 'SCAN-IMG-10-']);
    expect(rawFound(files[1], ['SCAN-IMG-10-', 'SCAN-IMG-20-', 'SCAN-IMG-21-', 'SCAN-IMG-30-'])).toEqual(['SCAN-IMG-21-', 'SCAN-IMG-30-']);
  });

  it('keeps the title and author as Split does', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    for (let i = 0; i < 4; i++) doc.addPage([300, 400]);
    doc.setTitle('Synthetic Title');
    doc.setAuthor('Synthetic Author');
    for (const part of await splitParts(await doc.save(), [
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ])) {
      const out = await PDFDocument.load(part, { updateMetadata: false });
      expect([out.getTitle(), out.getAuthor(), out.getProducer(), out.getCreator()]).toEqual(['Synthetic Title', 'Synthetic Author', 'ICAI VERA', 'ICAI VERA']);
    }
  });

  it('refuses ranges outside the file, backwards, empty or too many, before making anything', async () => {
    const c = await makePdf('C', 5);
    const made = vi.fn();
    await expect(splitParts(c, [{ from: 4, to: 6 }], { onPartMade: made })).rejects.toThrow("Page 6 is outside this file's 5 pages.");
    await expect(splitParts(c, [{ from: 3, to: 2 }], { onPartMade: made })).rejects.toThrow('"3-2" is backwards: the first page must not be after the last');
    await expect(splitParts(c, [{ from: 0, to: 2 }], { onPartMade: made })).rejects.toThrow('Page numbers must be whole numbers from 1 to 5.');
    await expect(splitParts(c, [{ from: 1.5, to: 2 }], { onPartMade: made })).rejects.toMatchObject({ code: 'invalid-page-list' });
    await expect(splitParts(c, [], { onPartMade: made })).rejects.toMatchObject({ code: 'invalid-page-list' });
    const many = Array.from({ length: SPLIT_MAX_FILES + 1 }, () => ({ from: 1, to: 1 }));
    await expect(splitParts(c, many, { onPartMade: made })).rejects.toMatchObject({ code: 'too-many-files' });
    expect(made).not.toHaveBeenCalled();
  });

  it('says the plan first, then each file as it starts, each page, and each file made; a throw stops it', async () => {
    const c = await makePdf('C', 6);
    const seen: string[] = [];
    const parts = await splitParts(
      c,
      [
        { from: 1, to: 2 },
        { from: 5, to: 5 },
      ],
      {
        onPlan: (plan) => void seen.push(`plan ${plan.map((p) => `${p.from}-${p.to}`).join(' ')}`),
        onPart: (done, total) => void seen.push(`part ${done}/${total}`),
        onPage: (part, done, total) => void seen.push(`page ${part}:${done}/${total}`),
        onPartMade: (bytes, part) => void seen.push(`made ${part} ${bytes.byteLength > 0}`),
      },
    );
    expect(parts).toHaveLength(2);
    expect(seen).toEqual(['plan 1-2 5-5', 'part 0/2', 'page 0:0/2', 'page 0:1/2', 'made 0 true', 'part 1/2', 'page 1:0/1', 'made 1 true']);

    const stop = new Error('cancelled');
    const throwAt = (when: string) => async (...args: number[]) => {
      await Promise.resolve();
      if (args.join(':') === when) throw stop;
    };
    await expect(splitParts(c, [{ from: 1, to: 2 }, { from: 3, to: 6 }], { onPart: throwAt('1:2') })).rejects.toBe(stop);
    await expect(splitParts(c, [{ from: 1, to: 2 }, { from: 3, to: 6 }], { onPage: throwAt('1:2:4') })).rejects.toBe(stop);
    const made: number[] = [];
    await expect(
      splitParts(c, [{ from: 1, to: 2 }, { from: 3, to: 6 }], {
        onPartMade: (_bytes, part) => {
          made.push(part);
          if (part === 0) throw stop;
        },
      }),
    ).rejects.toBe(stop);
    expect(made).toEqual([0]);
  });

  it('refuses a protected file', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([300, 400]);
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
    await expect(splitParts(await doc.save(), [{ from: 1, to: 1 }])).rejects.toMatchObject({ code: 'encrypted' });
    await expect(splitAtBookmarks(await doc.save())).rejects.toMatchObject({ code: 'encrypted' });
  });
});

describe('Split at bookmarks', () => {
  it('makes one file per top-level bookmark, nested bookmarks and all, each opening the right page', async () => {
    const reports: (OrganiseReport & BookmarkReport)[] = [];
    const { plan, parts } = await splitAtBookmarks(await makeEightPageOutlinePdf(), { reports });
    expect(plan.sections).toEqual([
      { title: 'Ch1 T1', from: 1, to: 3 },
      { title: 'Ch2 T4', from: 4, to: 6 },
      { title: 'Ch3 T7', from: 7, to: 7 },
      { title: 'Ch4 T8', from: 8, to: 8 },
    ]);
    expect(await texts(parts)).toEqual([['S p1', 'S p2', 'S p3'], ['S p4', 'S p5', 'S p6'], ['S p7'], ['S p8']]);
    expect(await pdfjsOutline(parts[0])).toEqual([
      [0, 'Ch1 T1', 0],
      [1, 'Ch1.1 T2', 1],
      [2, 'Ch1.1.a T3', 2],
      [1, 'Ch1.2 T3', 2],
    ]);
    expect(await bookmarkPageTexts(parts[1])).toEqual(['Ch2 T4 -> S p4', 'Ch2.1 T5 -> S p5', 'Ch2.2 T6 -> S p6']);
    expect(await bookmarkPageTexts(parts[3])).toEqual(['Ch4 T8 -> S p8', 'Ch4.1 T8 -> S p8']);
    // every bookmark is in some file: nothing is said to be lost
    expect(reports.map((r) => r.bookmarksDropped)).toEqual([0, 0, 0, 0]);
    expect(reports.map((r) => r.bookmarksInOtherParts)).toEqual([6, 7, 9, 8]);
  });

  it('keeps duplicate, Hindi and odd titles as they are, and leaves out of each file the titles of the others', async () => {
    const { doc } = await baseDoc(6, 'D');
    buildOutline(doc, [
      { title: 'Notes', dest: fit(doc, 0) },
      { title: 'Notes', dest: fit(doc, 2) },
      { title: 'Sch: A/B? <1>', dest: fit(doc, 3) },
      { title: utf16be(HINDI_TITLE), dest: fit(doc, 4), children: [{ title: utf16be('करदाता विवरण'), dest: fit(doc, 5) }] },
    ]);
    const { plan, parts } = await splitAtBookmarks(await doc.save());
    expect(plan.sections.map((s) => [s.title, s.from, s.to])).toEqual([
      ['Notes', 1, 2],
      ['Notes', 3, 3],
      ['Sch: A/B? <1>', 4, 4],
      [HINDI_TITLE, 5, 6],
    ]);
    expect(await bookmarkPageTexts(parts[3])).toEqual([`${HINDI_TITLE} -> D p5`, 'करदाता विवरण -> D p6']);
    // the titles of the other files' bookmarks are not in a file's bytes, in any form (streams inflated)
    const hindi = titleForms('करदाता विवरण');
    expect(hindi.filter((form) => rawHaystack(parts[3]).includes(form))).not.toEqual([]);
    for (const part of parts.slice(0, 3)) expect(hindi.filter((form) => rawHaystack(part).includes(form))).toEqual([]);
    expect(rawHaystack(parts[2])).toContain('Sch: A/B? <1>');
    expect(rawHaystack(parts[0])).not.toContain('Sch: A/B? <1>');
  });

  it('puts the pages before the first bookmark into the first file', async () => {
    const { doc } = await baseDoc(5, 'F');
    buildOutline(doc, [
      { title: 'Second', dest: fit(doc, 3) },
      { title: 'First', dest: fit(doc, 2) },
    ]);
    const { plan, parts } = await splitAtBookmarks(await doc.save());
    expect(plan.before).toBe(2);
    expect(await texts(parts)).toEqual([['F p1', 'F p2', 'F p3'], ['F p4', 'F p5']]);
    expect(await pdfjsOutline(parts[0])).toEqual([[0, 'First', 2]]);
  });

  it('refuses a file with no bookmarks, or none at the top that opens a page, before making anything', async () => {
    const made = vi.fn();
    await expect(splitAtBookmarks(await makePdf('N', 3), { onPartMade: made })).rejects.toThrow('This file has no bookmarks, so it cannot be split at them.');
    const { doc } = await baseDoc(3);
    buildOutline(doc, [{ title: 'Web', action: doc.context.obj({ S: 'URI', URI: 'https://example.in/' }) }]);
    await expect(splitAtBookmarks(await doc.save(), { onPartMade: made })).rejects.toMatchObject({ code: 'no-bookmarks' });
    expect(made).not.toHaveBeenCalled();
  });

  it(`refuses more than ${SPLIT_MAX_FILES} files, and a file with more bookmarks than can be read`, async () => {
    const { doc } = await baseDoc(SPLIT_MAX_FILES + 1);
    buildOutline(
      doc,
      Array.from({ length: SPLIT_MAX_FILES + 1 }, (_, i) => ({ title: `B${i + 1}`, dest: fit(doc, i) })),
    );
    await expect(splitAtBookmarks(await doc.save())).rejects.toMatchObject({ code: 'too-many-files' });
    const big = await baseDoc(2);
    buildOutline(
      big.doc,
      Array.from({ length: 10_001 }, (_, i) => ({ title: `B${i + 1}`, dest: fit(big.doc, i % 2) })),
    );
    await expect(splitAtBookmarks(await big.doc.save())).rejects.toThrow('This file has too many bookmarks to read, so it cannot be split at them.');
  });

  it('gives its plan before making the files, and each file is a sound PDF', async () => {
    const seen: string[] = [];
    const { parts } = await splitAtBookmarks(await makeEightPageOutlinePdf(), { onPlan: (plan) => void seen.push(plan.map((p) => `${p.from}-${p.to}`).join(' ')), onPart: (done) => void seen.push(`part ${done}`) });
    expect(seen).toEqual(['1-3 4-6 7-7 8-8', 'part 0', 'part 1', 'part 2', 'part 3']);
    for (const part of parts) expect((await inspectPdf(part)).hasBookmarks).toBe(true);
  });
});
