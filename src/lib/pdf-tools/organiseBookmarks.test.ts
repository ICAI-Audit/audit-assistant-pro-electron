import { PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { deletePages, extractPages, mergePdfs, splitEvery, type BookmarkReport } from './organise';
import { pageMapping } from './pageCopy';
import { buildAdversarial, rawFound } from './testLeakPdf';
import { pdfjsOutline } from './testOutlinePdf';
import { danglingReferences, makeFormPdf, makePdf, pageTexts, pdfjsFieldValues } from './testPdf';

vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

const hasOutlines = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).catalog.has(PDFName.of('Outlines'));

describe('pageMapping', () => {
  it('maps a source page to its first copy, and a page that is left out to undefined', () => {
    const map = pageMapping([6, 4, 4, 0]);
    expect([0, 1, 4, 6, 7].map(map)).toEqual([3, undefined, 1, 0, undefined]);
    expect(pageMapping([])(0)).toBeUndefined();
  });
});

describe('a file without bookmarks', () => {
  it('gets no outline from Split, Delete pages or Merge, and no bookmark report', async () => {
    const source = await makePdf('B', 4);
    const report: BookmarkReport = {};
    expect(await hasOutlines(await extractPages(source, [0, 2], { report }))).toBe(false);
    expect(await hasOutlines(await deletePages(source, [1], { report }))).toBe(false);
    const reports: BookmarkReport[] = [];
    for (const part of await splitEvery(source, 2, { reports })) expect(await hasOutlines(part)).toBe(false);
    expect(reports).toEqual([{}, {}]);
    expect(await hasOutlines(await mergePdfs([source, source], { fileBookmarks: { titles: ['a', 'b'], keepOwn: true }, report }))).toBe(true); // the per-file bookmarks
    expect(report).toEqual({});
    expect(await hasOutlines(await mergePdfs([source, source]))).toBe(false);
  });
});

describe('a form with a bookmark for each page', () => {
  it('Delete pages 2 keeps the bookmarks of pages 1 and 3, the form values and the page texts', async () => {
    const source = await makeFormPdf({ bookmarks: true, links: true });
    const report: BookmarkReport = {};
    const result = await deletePages(source, [1], { report });
    expect(await pdfjsOutline(result)).toEqual([[0, 'Page 1', 0], [0, 'Page 3', 1]]);
    expect(report.bookmarksDropped).toBe(1);
    expect(await pageTexts(result)).toEqual((await pageTexts(source)).filter((_, i) => i !== 1));
    const values = await pdfjsFieldValues(result);
    const before = await pdfjsFieldValues(source);
    for (const name of ['balance', 'agree', 'merged']) expect(values[name], name).toEqual(before[name]);
  });
  it('Split keeping every page drops nothing', async () => {
    const report: BookmarkReport = {};
    await extractPages(await makeFormPdf({ bookmarks: true }), [0, 1, 2], { report });
    expect(report.bookmarksDropped).toBe(0);
  });
});

describe('a carried bookmark never brings back a left-out page', () => {
  for (const objectStreams of [false, true]) {
    it(`the adversarial file: PG1-BOOKMARK is carried, PG2-BOOKMARK and every other marker of a left-out page are not (object streams: ${objectStreams})`, async () => {
      const source = await buildAdversarial({ objectStreams, sd: true });
      const report: BookmarkReport = {};
      const results: [string, Uint8Array][] = [
        ['split 1 and 3', await extractPages(source, [0, 2], { report })],
        ['delete 2 and 4', await deletePages(source, [1, 3])],
        ...(await splitEvery(source, 1)).map((part, i): [string, Uint8Array] => [`every 1, part ${i + 1}`, part]),
      ];
      expect(report.bookmarksDropped).toBe(1);
      expect(rawFound(results[0][1], ['PG1-BOOKMARK', 'PG2-BOOKMARK'])).toEqual(['PG1-BOOKMARK']);
      expect(rawFound(results[1][1], ['PG1-BOOKMARK', 'PG2-BOOKMARK'])).toEqual(['PG1-BOOKMARK']);
      expect(rawFound(results[2][1], ['PG1-BOOKMARK', 'PG2-BOOKMARK'])).toEqual(['PG1-BOOKMARK']);
      expect(rawFound(results[3][1], ['PG1-BOOKMARK', 'PG2-BOOKMARK'])).toEqual(['PG2-BOOKMARK']);
      expect(rawFound(results[4][1], ['PG1-BOOKMARK', 'PG2-BOOKMARK'])).toEqual([]);
      for (const [label, bytes] of results) {
        expect(await danglingReferences(bytes), label).toEqual([]);
        // every destination of every bookmark is a page that is in the result
        const doc = await PDFDocument.load(bytes);
        const pages = new Set<PDFRef>(doc.getPages().map((p) => p.ref));
        for (const [, object] of doc.context.enumerateIndirectObjects()) {
          if (!(object instanceof PDFDict) || !object.has(PDFName.of('Parent')) || !object.has(PDFName.of('Title')) || object.has(PDFName.of('Kids'))) continue;
          const dest = doc.context.lookup(object.get(PDFName.of('Dest')));
          if (dest && 'get' in dest) expect(pages.has((dest as unknown as { get(i: number): PDFRef }).get(0)), label).toBe(true);
        }
      }
    });
  }
});

describe('fix round 1: links to a named destination of a left-out page', () => {
  const NAMES = ['TREENAME_SECRET', 'DICTNAME_SECRET', 'ACTIONNAME_SECRET', 'HEXNAME_SECRET'];

  async function source(): Promise<Uint8Array> {
    const { PDFString, PDFHexString } = await import('pdf-lib');
    const { baseDoc, fit, hex } = await import('./testOutlinePdf');
    const { doc } = await baseDoc(3);
    const ctx = doc.context;
    const link = (entry: Record<string, unknown>) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], Border: [0, 0, 0], ...entry } as never));
    // names that resolve to page 3 (left out) and to page 2 (kept), and one that resolves to nothing
    doc.catalog.set(PDFName.of('Dests'), ctx.obj({ DICTNAME_SECRET: fit(doc, 2), KEPTDICT: fit(doc, 1) }));
    const leaf = ctx.register(ctx.obj({ Names: [PDFString.of('TREENAME_SECRET'), fit(doc, 2), PDFString.of('ACTIONNAME_SECRET'), ctx.obj({ D: fit(doc, 2) }), hex([0x48, 0x45, 0x58, 0x4e, 0x41, 0x4d, 0x45, 0x5f, 0x53, 0x45, 0x43, 0x52, 0x45, 0x54]), fit(doc, 2), PDFString.of('KEPTTREE'), fit(doc, 1)] }));
    doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: ctx.obj({ Kids: [leaf] }) }));
    const links = [
      link({ Dest: PDFString.of('TREENAME_SECRET') }),
      link({ Dest: PDFName.of('DICTNAME_SECRET') }),
      link({ A: ctx.obj({ S: 'GoTo', D: PDFString.of('ACTIONNAME_SECRET') }) }),
      link({ Dest: PDFHexString.of(Buffer.from('HEXNAME_SECRET').toString('hex')) }),
      link({ Dest: PDFString.of('KEPTTREE') }),
      link({ Dest: PDFName.of('KEPTDICT') }),
      link({ Dest: PDFString.of('UNRESOLVABLE_NAME') }),
    ];
    for (const l of links) doc.getPage(0).node.addAnnot(l);
    return doc.save({ useObjectStreams: false });
  }
  const names = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.Annots();
    return [...Array(annots?.size() ?? 0).keys()].map((i) => {
      const a = annots!.lookup(i, PDFDict);
      const target = a.get(PDFName.of('Dest')) ?? (a.lookup(PDFName.of('A'), PDFDict)).get(PDFName.of('D'));
      return String(target);
    });
  };

  it('the names of a removed destination are gone from the bytes, the others stay (Delete pages, and Split)', async () => {
    const bytes = await source();
    const before = rawFound(bytes, NAMES);
    expect(before.length).toBe(NAMES.length);
    for (const result of [await deletePages(bytes, [2]), await extractPages(bytes, [0, 1])]) {
      expect(rawFound(result, NAMES)).toEqual([]);
      expect((await names(result)).join(' ')).toMatch(/KEPTTREE/);
      expect((await names(result)).join(' ')).toMatch(/KEPTDICT/);
      expect((await names(result)).join(' ')).toMatch(/UNRESOLVABLE_NAME/);
      expect(await names(result)).toHaveLength(3);
    }
  });
  it('keeping the page the names point at keeps the links', async () => {
    // page 3 kept, page 2 left out: the three names of page 3, the hex one, and the unresolvable one stay
    expect(await names(await extractPages(await source(), [0, 2]))).toHaveLength(5);
  });
});
