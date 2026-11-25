import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  carryOutline,
  cleanTitle,
  mapOutline,
  OUTLINE_MAX_DEPTH,
  OUTLINE_MAX_ITEMS,
  outlineDepth,
  outlineOverLimits,
  readOutline,
  TITLE_READ_MAX,
  TITLE_TYPED_MAX,
  writeOutline,
  type OutlineItem,
} from './outline';
import { rawHaystack } from './testLeakPdf';
import {
  allOutlineFixtures,
  baseDoc,
  buildOutline,
  dictAt,
  fit,
  HINDI_TITLE,
  makeOutlinePdf,
  pdfjsOutline,
  utf16be,
  type OutlineFixture,
} from './testOutlinePdf';
import { makeFormPdf, pdfjsFieldValues, pageTexts } from './testPdf';

vi.setConfig({ testTimeout: 30_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

/** [depth, title, page] in document order. */
function flat(items: readonly OutlineItem[], depth = 0): [number, string, number | null][] {
  return items.flatMap((i): [number, string, number | null][] => [[depth, i.title, i.page], ...flat(i.children, depth + 1)]);
}

let fixtures: Map<string, OutlineFixture>;
beforeAll(async () => {
  fixtures = new Map((await allOutlineFixtures()).map((f) => [f.name, f]));
}, 60_000);
const fixture = (name: string) => fixtures.get(name)!;

describe('readOutline: the twelve reading cases', () => {
  it('reads nested three levels with pages', () => {
    const f = fixture('nested-3-levels');
    expect(flat(readOutline(f.doc).items)).toEqual(f.expect);
    const read = readOutline(f.doc);
    expect(read.count).toBe(7);
    expect(read.items[0].open).toBe(true);
    expect(read.items[1].open).toBe(false);
  });
  it('reads explicit /XYZ /Fit /FitH and GoTo destinations, keeping the view', () => {
    const f = fixture('explicit-dests-and-goto');
    const read = readOutline(f.doc);
    expect(flat(read.items)).toEqual(f.expect);
    expect(read.items[0].view).toEqual({ kind: 'XYZ', args: [10, 380, 1.5] });
    expect(read.items[1].view).toEqual({ kind: 'Fit', args: [] });
    expect(read.items[2].view).toEqual({ kind: 'FitH', args: [300] });
  });
  it('resolves named destinations from /Dests and the /Names tree; a missing name gives no page', () => {
    const f = fixture('named-destinations');
    const read = readOutline(f.doc);
    expect(flat(read.items)).toEqual(f.expect);
    expect(read.items[6].unresolved).toBe('named-missing');
  });
  it('keeps a web address; remote, launch and no-target items give no page (4 unresolved)', () => {
    const f = fixture('non-page-targets');
    const read = readOutline(f.doc);
    expect(flat(read.items)).toEqual(f.expect);
    expect(read.items[0].uri).toBe('https://example.org/x');
    expect(read.items[0].unresolved).toBeUndefined();
    expect(read.items.map((i) => i.unresolved)).toEqual([undefined, 'remote', 'other-action', 'no-target', 'remote', undefined]);
    expect(read.problems.unresolved).toBe(4);
  });
  it('decodes PDFDoc, UTF-16BE, UTF-16LE and UTF-8 titles, Hindi, the rupee sign and an emoji pair intact', () => {
    const f = fixture('title-encodings');
    expect(flat(readOutline(f.doc).items)).toEqual(f.expect);
    expect(readOutline(f.doc).items[2].title).toBe(HINDI_TITLE);
  });
  it('a destination page that is not in the page tree gives no page (pdf.js would say page 1)', () => {
    const f = fixture('dest-not-in-page-tree');
    const read = readOutline(f.doc);
    expect(flat(read.items)).toEqual(f.expect);
    expect(read.items[0].unresolved).toBe('badpage');
  });
  it('survives a missing and a wrong /Count and a missing /Last', () => {
    const f = fixture('missing-count-last');
    const read = readOutline(f.doc);
    expect(flat(read.items)).toEqual(f.expect);
    expect(read.count).toBe(4);
  });
  it('stops at a /Next loop (1) and at items that are their own first child (2), without hanging', () => {
    expect(readOutline(fixture('next-cycle').doc)).toMatchObject({ count: 3, problems: { cycles: 1 } });
    expect(readOutline(fixture('first-points-to-itself').doc)).toMatchObject({ count: 2, problems: { cycles: 2 } });
  });
  it('reads 5,000 flat bookmarks', () => {
    const read = readOutline(fixture('flat-5000').doc);
    expect(read.count).toBe(5000);
    expect(outlineOverLimits(read.problems)).toBe(false);
  });
  it('stops at 32 levels of 200 and says so', () => {
    const read = readOutline(fixture('depth-200').doc);
    expect(read.problems.truncatedDepth).toBe(true);
    expect(read.count).toBe(OUTLINE_MAX_DEPTH);
    expect(outlineDepth(read.items)).toBe(OUTLINE_MAX_DEPTH);
    expect(outlineOverLimits(read.problems)).toBe(true);
  });
  it('stops at 10,000 of 50,000 and says so', () => {
    const read = readOutline(fixture('flat-50000').doc);
    expect(read.count).toBe(OUTLINE_MAX_ITEMS);
    expect(read.problems.truncatedNodes).toBe(true);
    expect(outlineOverLimits(read.problems)).toBe(true);
  });
  it('exactly 10,000 bookmarks and exactly 32 levels are within the limits', async () => {
    const { doc } = await baseDoc(1);
    buildOutline(doc, Array.from({ length: OUTLINE_MAX_ITEMS }, (_, i) => ({ title: `B${i}`, dest: fit(doc, 0) })));
    expect(outlineOverLimits(readOutline(doc).problems)).toBe(false);
    const deep = await baseDoc(1);
    let spec: { title: string; dest: PDFArray; open?: boolean; children?: unknown[] } = { title: 'L32', dest: fit(deep.doc, 0) };
    for (let d = 31; d >= 1; d--) spec = { title: `L${d}`, dest: fit(deep.doc, 0), open: true, children: [spec] };
    buildOutline(deep.doc, [spec as never]);
    const read = readOutline(deep.doc);
    expect(read.problems.truncatedDepth).toBe(false);
    expect(outlineDepth(read.items)).toBe(32);
  });
  it('cuts a title at 1,000 characters when reading and counts it', async () => {
    const { doc } = await baseDoc(1);
    buildOutline(doc, [{ title: 'x'.repeat(5000), dest: fit(doc, 0) }]);
    const read = readOutline(doc);
    expect(read.items[0].title).toHaveLength(TITLE_READ_MAX);
    expect(read.problems.longTitles).toBe(1);
  });
  it('a file with no outline reads as empty', async () => {
    const { doc } = await baseDoc(2);
    expect(readOutline(doc)).toEqual({ items: [], count: 0, problems: { cycles: 0, truncatedNodes: false, truncatedDepth: false, longTitles: 0, unresolved: 0 } });
  });
  it('a page number the file has is that page; one it has not is remote', async () => {
    const { doc } = await baseDoc(3);
    buildOutline(doc, [{ title: 'in', dest: doc.context.obj([1, 'Fit']) }, { title: 'out', dest: doc.context.obj([3, 'Fit']) }, { title: 'neg', dest: doc.context.obj([-1, 'Fit']) }]);
    expect(readOutline(doc).items.map((i) => [i.page, i.unresolved])).toEqual([[1, undefined], [null, 'remote'], [null, 'remote']]);
  });

  it('agrees with pdf.js on every well-formed fixture', async () => {
    for (const name of ['nested-3-levels', 'explicit-dests-and-goto', 'named-destinations', 'title-encodings', 'missing-count-last', 'next-cycle', 'first-points-to-itself']) {
      const f = fixture(name);
      const bytes = await f.doc.save();
      const ours = flat(readOutline(await PDFDocument.load(bytes)).items);
      expect(ours, name).toEqual(await pdfjsOutline(bytes));
      expect(ours, name).toEqual(f.expect);
    }
  });
});

describe("the trial's outline file", () => {
  it('has 8 items in order, pages [0, 1, 2, 5, null, null, 4, 3], and 1.2 closed', async () => {
    const doc = await PDFDocument.load(await makeOutlinePdf());
    const read = readOutline(doc);
    expect(read.count).toBe(8);
    expect(flat(read.items).map(([, t]) => t)).toEqual([
      '1 Introduction',
      '1.1 करदाता (Hindi)',
      '1.2 Named, by GoTo',
      '1.2.1 Deep, old Dests',
      '2 Web link',
      '3 Script',
      '4 Page five',
      '5 Page index as a number',
    ]);
    expect(flat(read.items).map(([, , p]) => p)).toEqual([0, 1, 2, 5, null, null, 4, 3]);
    expect(read.items[0].children[1].open).toBe(false);
    expect(read.items[0].open).toBe(true);
    expect(read.items[1].uri).toBe('https://example.in/');
    expect(read.items[2].unresolved).toBe('other-action');
  });
  it('reads the three broken forms of it without a throw', async () => {
    for (const broken of ['cycle', 'no-count', 'self-first'] as const) {
      const read = readOutline(await PDFDocument.load(await makeOutlinePdf(broken)));
      expect(read.count, broken).toBe(8);
    }
    expect(readOutline(await PDFDocument.load(await makeOutlinePdf('cycle'))).problems.cycles).toBe(1);
    expect(readOutline(await PDFDocument.load(await makeOutlinePdf('self-first'))).problems.cycles).toBe(1);
  });
});

describe('damaged outlines never throw, and what was read can be written again', () => {
  const damage: [string, (doc: PDFDocument) => void][] = [
    ['/Outlines a number', (d) => d.catalog.set(PDFName.of('Outlines'), PDFNumber.of(3))],
    ['/Outlines an array', (d) => d.catalog.set(PDFName.of('Outlines'), d.context.obj([1, 2]))],
    ['/Outlines a dangling reference', (d) => d.catalog.set(PDFName.of('Outlines'), PDFRef.of(9999))],
    ['/First a number', (d) => dictAt(d, d.catalog.get(PDFName.of('Outlines')) as PDFRef).set(PDFName.of('First'), PDFNumber.of(7))],
    ['/First the root itself', (d) => dictAt(d, d.catalog.get(PDFName.of('Outlines')) as PDFRef).set(PDFName.of('First'), d.catalog.get(PDFName.of('Outlines')) as PDFRef)],
    ['/Title missing and a number', (d) => forItems(d, (item, i) => (i === 0 ? item.delete(PDFName.of('Title')) : item.set(PDFName.of('Title'), PDFNumber.of(5))))],
    ['/Dest an empty dictionary', (d) => forItems(d, (item) => item.set(PDFName.of('Dest'), d.context.obj({})))],
    ['/Dest an empty array', (d) => forItems(d, (item) => item.set(PDFName.of('Dest'), d.context.obj([])))],
    ['/Dest a name loop', (d) => forItems(d, (item) => item.set(PDFName.of('Dest'), PDFName.of('loop')))],
    ['name tree /Kids loop', (d) => {
      const node = d.context.obj({});
      const ref = d.context.register(node);
      node.set(PDFName.of('Kids'), d.context.obj([ref]));
      node.set(PDFName.of('Names'), d.context.obj([PDFString.of('a'), 3, PDFString.of('b')]));
      d.catalog.set(PDFName.of('Names'), d.context.obj({ Dests: ref }));
      forItems(d, (item) => item.set(PDFName.of('Dest'), PDFString.of('zzz')));
    }],
    ['/Count a string, /C wrong length, /F a name', (d) => forItems(d, (item) => {
      item.set(PDFName.of('Count'), PDFString.of('x'));
      item.set(PDFName.of('C'), d.context.obj([1]));
      item.set(PDFName.of('F'), PDFName.of('Bold'));
    })],
    ['/A a name', (d) => forItems(d, (item) => item.set(PDFName.of('A'), PDFName.of('GoTo')))],
  ];
  function forItems(doc: PDFDocument, f: (item: PDFDict, i: number) => void) {
    let i = 0;
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (object instanceof PDFDict && object.has(PDFName.of('Parent')) && object.has(PDFName.of('Title')) && !object.has(PDFName.of('Kids'))) f(object, i++);
    }
  }
  for (const [label, damageIt] of damage) {
    it(label, async () => {
      const { doc } = await baseDoc(3);
      buildOutline(doc, [{ title: 'a', dest: fit(doc, 0), open: true, children: [{ title: 'a.1', dest: fit(doc, 1) }] }, { title: 'b', dest: fit(doc, 2) }]);
      damageIt(doc);
      let read!: ReturnType<typeof readOutline>;
      expect(() => (read = readOutline(doc))).not.toThrow();
      expect(() => writeOutline(doc, read.items)).not.toThrow();
      await expect(doc.save()).resolves.toBeInstanceOf(Uint8Array);
    });
  }
  it('a document whose page tree is broken reads as empty', async () => {
    const { doc } = await baseDoc(2);
    buildOutline(doc, [{ title: 'a', dest: fit(doc, 0) }]);
    doc.getPages = () => {
      throw new Error('broken page tree');
    };
    expect(readOutline(doc).count).toBe(0);
  });
});

describe('writeOutline', () => {
  it('writes counts and links the PDF way, and pdf.js reads them back with bold, italic and colour', async () => {
    const { doc } = await baseDoc(5);
    writeOutline(doc, [
      { title: 'A', page: 0, open: true, bold: true, color: [1, 0, 0], children: [{ title: 'A.1', page: 1, open: false, italic: true, children: [{ title: 'A.1.a', page: 2, open: false, children: [] }] }, { title: 'A.2', page: 2, open: false, children: [] }] },
      { title: 'B', page: 3, open: false, children: [] },
      { title: 'Web', page: null, uri: 'https://example.org/a b', open: false, children: [] },
    ]);
    const root = dictAt(doc, doc.catalog.get(PDFName.of('Outlines')) as PDFRef);
    // visible: A, A.1, A.2 (A is open, A.1 closed), B, Web = 5
    expect((root.get(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(5);
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const read = readOutline(reloaded);
    expect(read.count).toBe(6);
    expect(read.items[0]).toMatchObject({ title: 'A', page: 0, open: true, bold: true, color: [1, 0, 0] });
    expect(read.items[0].children[0]).toMatchObject({ italic: true, open: false });
    expect(read.items[2].uri).toBe('https://example.org/a b'); // written back exactly as given
    // links consistent: Parent, Prev, Next, First, Last
    const outlines = dictAt(reloaded, reloaded.catalog.get(PDFName.of('Outlines')) as PDFRef);
    let ref = outlines.get(PDFName.of('First')) as PDFRef;
    expect(dictAt(reloaded, ref).get(PDFName.of('Parent'))).toBe(reloaded.catalog.get(PDFName.of('Outlines')));
    const seen: PDFRef[] = [];
    while (ref) {
      seen.push(ref);
      const item = dictAt(reloaded, ref);
      const next = item.get(PDFName.of('Next')) as PDFRef | undefined;
      if (next) expect(dictAt(reloaded, next).get(PDFName.of('Prev'))).toBe(ref);
      ref = next as PDFRef;
    }
    expect(outlines.get(PDFName.of('Last'))).toBe(seen[seen.length - 1]);
    const a = dictAt(reloaded, seen[0]);
    expect((a.get(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(2);
    const a1 = dictAt(reloaded, a.get(PDFName.of('First')) as PDFRef);
    expect((a1.get(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(-1);
    expect(a.get(PDFName.of('Last'))).toBe(a1.get(PDFName.of('Next')));
    // pdf.js
    const pdfjs = await pdfjsOutline(bytes);
    expect(pdfjs.map(([d, t, p]) => [d, t, p])).toEqual([[0, 'A', 0], [1, 'A.1', 1], [2, 'A.1.a', 2], [1, 'A.2', 2], [0, 'B', 3], [0, 'Web', null]]);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const outline = (await pdf.getOutline())!;
    expect(outline[0]).toMatchObject({ bold: true, color: expect.anything() });
    expect(outline[0].items[0]).toMatchObject({ italic: true });
    expect(outline[0].count).toBe(2);
    expect(outline[0].items[0].count).toBe(-1);
    await pdf.destroy();
  });

  it('keeps the view of an existing bookmark and gives a new one /XYZ at the top of its page', async () => {
    const { doc } = await baseDoc(2);
    writeOutline(doc, [
      { title: 'old', page: 0, open: false, children: [], view: { kind: 'FitH', args: [123] } },
      { title: 'new', page: 1, open: false, children: [] },
    ]);
    const read = readOutline(await PDFDocument.load(await doc.save()));
    expect(read.items[0].view).toEqual({ kind: 'FitH', args: [123] });
    expect(read.items[1].view).toEqual({ kind: 'XYZ', args: [0, 400, null] });
  });

  it('sets /PageMode only when the file does not ask for something else', async () => {
    const items: OutlineItem[] = [{ title: 'a', page: 0, open: false, children: [] }];
    const modeAfter = async (mode: string | undefined, list: OutlineItem[]) => {
      const { doc } = await baseDoc(1);
      if (mode) doc.catalog.set(PDFName.of('PageMode'), PDFName.of(mode));
      writeOutline(doc, list);
      return (doc.catalog.get(PDFName.of('PageMode')) as PDFName | undefined)?.decodeText();
    };
    expect(await modeAfter(undefined, items)).toBe('UseOutlines');
    expect(await modeAfter('UseNone', items)).toBe('UseOutlines');
    expect(await modeAfter('FullScreen', items)).toBe('FullScreen');
    expect(await modeAfter('UseThumbs', items)).toBe('UseThumbs');
    expect(await modeAfter('UseOutlines', [])).toBeUndefined();
    expect(await modeAfter('UseThumbs', [])).toBe('UseThumbs');
  });

  it('removes /Outlines when nothing is left, and never touches /Dests or /Names', async () => {
    const f = await allOutlineFixtures();
    const doc = f.find((x) => x.name === 'named-destinations')!.doc;
    const dests = doc.catalog.get(PDFName.of('Dests'));
    const names = doc.catalog.get(PDFName.of('Names'));
    const before = `${dests}${names}`;
    writeOutline(doc, []);
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(false);
    expect(`${doc.catalog.get(PDFName.of('Dests'))}${doc.catalog.get(PDFName.of('Names'))}`).toBe(before);
    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.catalog.has(PDFName.of('Dests'))).toBe(true);
  });

  it('writes titles safe for any Unicode, and they reload without corruption', async () => {
    const titles = ['Plain (parens) and \\ backslash', HINDI_TITLE, 'क्\u200dष ZWJ and ZWNJ \u200c', '\u{1F600}\u{1F4A1}', 'lone \ud800 surrogate', 'x'.repeat(40_000), '₹ 1,00,000', 'Café'];
    const { doc } = await baseDoc(1);
    writeOutline(doc, titles.map((t) => ({ title: t, page: 0, open: false, children: [] })));
    const bytes = await doc.save();
    const read = readOutline(await PDFDocument.load(bytes));
    expect(read.count).toBe(titles.length);
    expect(read.items.map((i) => i.title)).toEqual(titles.map((t) => cleanTitle(t, TITLE_READ_MAX)));
    expect(read.items[4].title).toBe('lone � surrogate');
    expect(read.items[2].title).toContain('\u200d');
    expect((await pdfjsOutline(bytes)).map(([, t]) => t)).toEqual(read.items.map((i) => i.title));
  });

  it('rejects a page index out of range and more than 32 levels with RangeError', async () => {
    const { doc } = await baseDoc(2);
    expect(() => writeOutline(doc, [{ title: 'x', page: 2, open: false, children: [] }])).toThrow(RangeError);
    expect(() => writeOutline(doc, [{ title: 'x', page: -1, open: false, children: [] }])).toThrow(RangeError);
    expect(() => writeOutline(doc, [{ title: 'x', page: 1.5, open: false, children: [] }])).toThrow(RangeError);
    let deep: OutlineItem = { title: 'd33', page: 0, open: true, children: [] };
    for (let d = 32; d >= 1; d--) deep = { title: `d${d}`, page: 0, open: true, children: [deep] };
    expect(() => writeOutline(doc, [deep])).toThrow(RangeError);
    expect(outlineDepth([deep])).toBe(33);
    // a refused write changes nothing
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(false);
  });

  it('writes 32 levels', async () => {
    const { doc } = await baseDoc(1);
    let deep: OutlineItem = { title: 'd32', page: 0, open: true, children: [] };
    for (let d = 31; d >= 1; d--) deep = { title: `d${d}`, page: 0, open: true, children: [deep] };
    writeOutline(doc, [deep]);
    const read = readOutline(await PDFDocument.load(await doc.save()));
    expect(outlineDepth(read.items)).toBe(32);
    expect(outlineOverLimits(read.problems)).toBe(false);
  });
});

describe('writeOutline: deleted titles are gone from the bytes', () => {
  const SECRETS = ['SECRETASCIILITERAL', 'SECRETUTF16HEXTITLE', 'SECRETINDIRECTSTRING', 'SECRETLASTONLYITEM'];

  async function sourceWithSecrets(): Promise<PDFDocument> {
    const { doc } = await baseDoc(3);
    const { root, items } = buildOutline(doc, [
      { title: SECRETS[0], dest: fit(doc, 0) },
      { title: utf16be(SECRETS[1]), dest: fit(doc, 1) },
      { title: doc.context.register(PDFString.of(SECRETS[2])), dest: fit(doc, 2) },
      { title: 'keeper', dest: fit(doc, 0) },
    ]);
    // an item reachable only through /Last and /Prev: cut it from the /Next chain
    const last = dictAt(doc, items[3]);
    const lastOnly = doc.context.nextRef();
    doc.context.assign(lastOnly, doc.context.obj({ Title: PDFString.of(SECRETS[3]), Parent: root, Prev: items[3], Dest: fit(doc, 1) }));
    dictAt(doc, root).set(PDFName.of('Last'), lastOnly);
    last.set(PDFName.of('Next'), PDFNumber.of(0)); // not a link: the item is only on /Last
    void last;
    return doc;
  }

  const forms = (secret: string) => {
    const utf16 = (s: string, le: boolean) => {
      const b: number[] = [];
      for (const ch of s) b.push(...(le ? [ch.charCodeAt(0), 0] : [0, ch.charCodeAt(0)]));
      return Buffer.from(b);
    };
    const be = utf16(secret, false);
    return [secret, be.toString('latin1'), `FEFF${be.toString('hex')}`.toLowerCase(), `FEFF${be.toString('hex')}`.toUpperCase(), utf16(secret, true).toString('latin1')];
  };

  for (const objectStreams of [false, true]) {
    it(`four secret titles are found in the source and absent from the written file (object streams: ${objectStreams})`, async () => {
      const doc = await sourceWithSecrets();
      const sourceBytes = await doc.save({ useObjectStreams: objectStreams });
      const sourceHay = rawHaystack(sourceBytes).toLowerCase();
      for (const secret of SECRETS) expect(sourceHay.includes(secret.toLowerCase()) || sourceHay.includes(forms(secret)[2]), secret).toBe(true);

      const loaded = await PDFDocument.load(sourceBytes);
      const result = writeOutline(loaded, [{ title: 'new title', page: 0, open: false, children: [] }]);
      expect(result.deletedObjects).toBeGreaterThanOrEqual(5);
      const out = await loaded.save({ useObjectStreams: objectStreams });
      const hay = rawHaystack(out);
      const hayLower = hay.toLowerCase();
      for (const secret of SECRETS) {
        for (const form of forms(secret)) expect(hayLower.includes(form.toLowerCase()), `${secret} as ${form.slice(0, 24)}`).toBe(false);
      }
    });
  }

  it('negative control: removing only /Outlines from the catalog leaves a title in the bytes', async () => {
    const doc = await sourceWithSecrets();
    const loaded = await PDFDocument.load(await doc.save());
    loaded.catalog.delete(PDFName.of('Outlines'));
    const hay = rawHaystack(await loaded.save({ useObjectStreams: false }));
    expect(SECRETS.some((s) => hay.includes(s))).toBe(true);
  });

  it('does not delete a page, the page tree or a form field a hostile /Next points at', async () => {
    const { doc } = await baseDoc(2);
    const { items } = buildOutline(doc, [{ title: 'a', dest: fit(doc, 0) }]);
    dictAt(doc, items[0]).set(PDFName.of('Next'), doc.getPage(1).ref);
    dictAt(doc, items[0]).set(PDFName.of('Prev'), doc.catalog.get(PDFName.of('Pages')) as PDFRef);
    writeOutline(doc, []);
    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.getPageCount()).toBe(2);
    expect(await pageTexts(await doc.save())).toEqual(['P p1', 'P p2']);
  });
});

describe('Bookmarks written into a form file change nothing else', () => {
  it('keeps the page texts and the field values', async () => {
    const source = await makeFormPdf({ bookmarks: true });
    const doc = await PDFDocument.load(source);
    const read = readOutline(doc);
    expect(read.count).toBe(3);
    writeOutline(doc, read.items);
    const out = await doc.save();
    expect(await pageTexts(out)).toEqual(await pageTexts(source));
    expect(await pdfjsFieldValues(out)).toEqual(await pdfjsFieldValues(source));
  });
});

describe('cleanTitle', () => {
  it('turns controls and separators into a space; removes direction marks, zero-width space and the byte-order mark; keeps the joiners', () => {
    expect(cleanTitle('a\u0000b\u001fc\u007fd\u0085e\u009ff\u2028g\u2029h')).toBe('a b c d e f g h');
    for (const ch of ['\u061c', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069', '\u200b', '\ufeff']) {
      expect(cleanTitle(`a${ch}b`), `U+${ch.charCodeAt(0).toString(16)}`).toBe('ab');
    }
    expect(cleanTitle('क\u200dष')).toBe('क\u200dष');
    expect(cleanTitle('a\u200cb')).toBe('a\u200cb');
  });
  it('replaces a lone surrogate with U+FFFD and keeps a pair', () => {
    expect(cleanTitle('a\ud800b')).toBe('a�b');
    expect(cleanTitle('a\udc00b')).toBe('a�b');
    expect(cleanTitle('\u{1F600}')).toBe('\u{1F600}');
  });
  it('cuts at 256 code points without splitting a pair', () => {
    const cut = cleanTitle('\u{1F600}'.repeat(300));
    expect([...cut]).toHaveLength(TITLE_TYPED_MAX);
    expect(cut.endsWith('\u{1F600}')).toBe(true);
    expect([...cleanTitle('a'.repeat(300))]).toHaveLength(256);
    expect([...cleanTitle('a'.repeat(300), 10)]).toHaveLength(10);
  });
  it('collapses runs of spaces, trims, and leaves the empty string empty', () => {
    expect(cleanTitle('  a   b \t\n c  ')).toBe('a b c');
    expect(cleanTitle('')).toBe('');
    expect(cleanTitle('   ')).toBe('');
    expect(cleanTitle('\u200b\ufeff')).toBe('');
  });
});

describe('carryOutline and mapOutline', () => {
  const leaf = (title: string, page: number | null, extra: Partial<OutlineItem> = {}): OutlineItem => ({ title, page, open: false, children: [], ...extra });
  const tree: OutlineItem[] = [
    { ...leaf('1', 0), open: true, children: [leaf('1.1', 1), { ...leaf('1.2', 2), children: [leaf('1.2.1', 5)] }] },
    leaf('web', null, { uri: 'https://example.in/' }),
    leaf('script', null, { unresolved: 'other-action' }),
    leaf('4', 4, { view: { kind: 'FitH', args: [380] }, bold: true }),
  ];
  const keep = [0, 3, 4, 5];
  const map = (old: number) => {
    const i = keep.indexOf(old);
    return i < 0 ? undefined : i;
  };

  it('points kept items at their new pages, promotes the kept children of a dropped item, and counts what was dropped', () => {
    const { items, dropped } = carryOutline(tree, map);
    expect(flat(items)).toEqual([[0, '1', 0], [1, '1.2.1', 3], [0, 'web', null], [0, '4', 2]]);
    expect(dropped).toBe(3); // 1.1, 1.2, script
    expect(items[1].uri).toBe('https://example.in/');
    expect(items[2]).toMatchObject({ view: { kind: 'FitH', args: [380] }, bold: true });
    expect(items[0].open).toBe(true);
  });
  it('does not change the tree it is given', () => {
    const before = JSON.stringify(tree);
    carryOutline(tree, map);
    expect(JSON.stringify(tree)).toBe(before);
  });
  it('drops an item with no carried page in its subtree, whole', () => {
    const { items, dropped } = carryOutline([{ ...leaf('gone', 1), children: [{ ...leaf('gone.1', 2), children: [leaf('gone.1.a', 1)] }] }], map);
    expect(items).toEqual([]);
    expect(dropped).toBe(3);
  });
  it('keeps outline order when pages are reordered, and a repeated page maps to its first copy', () => {
    const order = [6, 4, 4, 0]; // new index of old page: 6 -> 0, 4 -> 1, 0 -> 3
    const first = (old: number) => (order.indexOf(old) < 0 ? undefined : order.indexOf(old));
    const { items } = carryOutline([leaf('a', 0), leaf('b', 4), leaf('c', 6)], first);
    expect(items.map((i) => [i.title, i.page])).toEqual([['a', 3], ['b', 1], ['c', 0]]);
  });
  it('drops items that open another file or go nowhere, and counts them', () => {
    const { items, dropped } = carryOutline([leaf('r', null, { unresolved: 'remote' }), leaf('n', null, { unresolved: 'no-target' }), leaf('m', null, { unresolved: 'named-missing' }), leaf('b', null, { unresolved: 'badpage' }), leaf('ok', 0)], map);
    expect(items.map((i) => i.title)).toEqual(['ok']);
    expect(dropped).toBe(4);
  });
  it('mapOutline removes the items refused and moves what is under them up', () => {
    const { items, removed } = mapOutline(tree, (item) => item.title !== '1.2' && item.title !== 'web');
    expect(flat(items).map(([d, t]) => [d, t])).toEqual([[0, '1'], [1, '1.1'], [1, '1.2.1'], [0, 'script'], [0, '4']]);
    expect(removed).toBe(2);
  });
});

describe('performance', () => {
  it('500 pages and 2,000 bookmarks: read, carry and write in under a second', async () => {
    const { doc } = await baseDoc(500);
    const specs = Array.from({ length: 100 }, (_, c) => ({ title: `Chapter ${c}`, dest: fit(doc, c * 5), open: true, children: Array.from({ length: 19 }, (_, s) => ({ title: `Section ${c}.${s}`, dest: fit(doc, c * 5 + (s % 5)) })) }));
    buildOutline(doc, specs);
    // This thread's processor time, not the clock (which on a busy machine also counts other work).
    const t0 = process.threadCpuUsage();
    const read = readOutline(doc);
    const carried = carryOutline(read.items, (old) => (old % 5 === 4 ? undefined : old));
    writeOutline(doc, carried.items);
    const used = process.threadCpuUsage(t0);
    const ms = (used.user + used.system) / 1000;
    expect(read.count).toBe(2000);
    expect(carried.dropped).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });
});

describe('fix round 1: what is counted when a bookmark is not carried', () => {
  const leaf = (title: string, page: number | null, extra: Partial<OutlineItem> = {}): OutlineItem => ({ title, page, open: false, children: [], ...extra });
  const tree = [leaf('kept', 0), leaf('left out', 1), leaf('other part', 2), leaf('script', null, { unresolved: 'other-action' }), leaf('remote', null, { unresolved: 'remote' })];
  const map = (old: number) => (old === 0 ? 0 : undefined);

  it('tells apart bookmarks to no page, bookmarks of pages in no result, and bookmarks of pages in another result', () => {
    const carried = carryOutline(tree, map, (old) => old === 2);
    expect(carried.items.map((i) => i.title)).toEqual(['kept']);
    expect(carried).toMatchObject({ dropped: 4, droppedNoPage: 2, droppedLeftOut: 1, droppedOtherResult: 1 });
  });
  it('without a list of the other results every dropped page counts as left out', () => {
    expect(carryOutline(tree, map)).toMatchObject({ dropped: 4, droppedNoPage: 2, droppedLeftOut: 2, droppedOtherResult: 0 });
  });
  it('an untitled bookmark is read as untitled and its flag travels through carry and filter', () => {
    const items: OutlineItem[] = [leaf('', 0, { untitled: true })];
    expect(carryOutline(items, (p) => p).items[0].untitled).toBe(true);
    expect(mapOutline(items, () => true).items[0].untitled).toBe(true);
  });
});

describe('fix round 1: reader on shared items and loops in the name tree', () => {
  it('an item reached from two parents is read once and the second reach is counted as a loop', async () => {
    const { doc } = await baseDoc(2);
    const { items } = buildOutline(doc, [
      { title: 'a', dest: fit(doc, 0), open: true, children: [{ title: 'a1', dest: fit(doc, 1) }] },
      { title: 'b', dest: fit(doc, 1), open: true, children: [{ title: 'b1', dest: fit(doc, 1) }] },
    ]);
    // b's first child is the same dictionary as a's first child
    const a1 = dictAt(doc, items[0]).get(PDFName.of('First')) as PDFRef;
    dictAt(doc, items[2]).set(PDFName.of('First'), a1);
    const read = readOutline(doc);
    expect(flat(read.items).map(([, t]) => t)).toEqual(['a', 'a1', 'b']);
    expect(read.problems.cycles).toBe(1);
  });
  it('a name tree whose /Kids and /Limits point back at themselves gives no page, without a hang', async () => {
    const { doc } = await baseDoc(2);
    const node = doc.context.obj({});
    const ref = doc.context.register(node);
    node.set(PDFName.of('Kids'), doc.context.obj([ref, ref]));
    node.set(PDFName.of('Limits'), doc.context.obj([PDFString.of('a'), PDFString.of('z')]));
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: ref }));
    buildOutline(doc, [{ title: 'x', dest: PDFString.of('missing') }, { title: 'y', dest: fit(doc, 1) }]);
    const read = readOutline(doc);
    expect(read.items.map((i) => [i.page, i.unresolved])).toEqual([[null, 'named-missing'], [1, undefined]]);
  });
});

// REV-A B5 (15 November 2026): the bounded walk still takes a whole healthy outline of the largest size the tool edits.
describe('writeOutline: the old outline at its largest', () => {
  it('deletes 10,000 nested bookmarks whole and keeps none', async () => {
    const { doc } = await baseDoc(1);
    const specs = Array.from({ length: 2_000 }, (_, i) => ({ title: `Item ${i}`, dest: fit(doc, 0), children: Array.from({ length: 4 }, (_, k) => ({ title: `Sub ${i}.${k}`, dest: fit(doc, 0) })) }));
    buildOutline(doc, specs);
    const loaded = await PDFDocument.load(await doc.save());
    expect(readOutline(loaded).count).toBe(10_000);
    const result = writeOutline(loaded, []);
    expect(result.keptBookmarks).toBe(0);
    expect(result.deletedObjects).toBeGreaterThanOrEqual(10_001);
  });
});
