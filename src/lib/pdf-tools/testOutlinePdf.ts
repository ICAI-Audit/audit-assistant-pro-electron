// Test helper only: files with bookmarks built from low-level objects, so the reader is tried on the
// forms real files take (and on broken ones) without any file on disk. Not imported by production code.
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, type PDFObject } from 'pdf-lib';

export const hex = (bytes: number[]) => PDFHexString.of(bytes.map((b) => b.toString(16).padStart(2, '0')).join(''));

/** UTF-16BE (with a byte-order mark by default) as a hex string. */
export const utf16be = (text: string, bom = true) => {
  const b: number[] = bom ? [0xfe, 0xff] : [];
  for (let i = 0; i < text.length; i++) b.push(text.charCodeAt(i) >> 8, text.charCodeAt(i) & 255);
  return hex(b);
};
export const utf16le = (text: string) => {
  const b: number[] = [0xff, 0xfe];
  for (let i = 0; i < text.length; i++) b.push(text.charCodeAt(i) & 255, text.charCodeAt(i) >> 8);
  return hex(b);
};
export const utf8bom = (text: string) => hex([0xef, 0xbb, 0xbf, ...Buffer.from(text, 'utf8')]);

export interface Spec {
  title: PDFObject | string;
  /** Value of /Dest. */
  dest?: PDFObject;
  /** Value of /A. */
  action?: PDFObject;
  open?: boolean;
  children?: Spec[];
  extra?: Record<string, PDFObject | number | string>;
}

/** A document of `pageCount` pages, each saying "<label> p<n>". */
export async function baseDoc(pageCount: number, label = 'P'): Promise<{ doc: PDFDocument; pages: ReturnType<PDFDocument['getPages']> }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) doc.addPage([300, 400]).drawText(`${label} p${i}`, { x: 20, y: 200, size: 18, font });
  return { doc, pages: doc.getPages() };
}

export const fit = (doc: PDFDocument, pageIndex: number, how: 'Fit' | 'XYZ' | 'FitH' = 'Fit') => {
  const ref = doc.getPage(pageIndex).ref;
  if (how === 'XYZ') return doc.context.obj([ref, 'XYZ', 10, 380, 1.5]);
  if (how === 'FitH') return doc.context.obj([ref, 'FitH', 300]);
  return doc.context.obj([ref, 'Fit']);
};

/** Builds a correctly linked outline from a spec; returns the item refs in document order. */
export function buildOutline(doc: PDFDocument, specs: Spec[]): { root: PDFRef; items: PDFRef[] } {
  const ctx = doc.context;
  const root = ctx.nextRef();
  const items: PDFRef[] = [];
  const level = (list: Spec[], parent: PDFRef): { first: PDFRef; last: PDFRef; visible: number } => {
    const refs = list.map(() => ctx.nextRef());
    let visible = 0;
    list.forEach((s, i) => {
      items.push(refs[i]);
      const d: Record<string, PDFObject | number | string> = { Title: typeof s.title === 'string' ? PDFString.of(s.title) : s.title, Parent: parent };
      if (i > 0) d.Prev = refs[i - 1];
      if (i < list.length - 1) d.Next = refs[i + 1];
      if (s.dest) d.Dest = s.dest;
      if (s.action) d.A = s.action;
      visible += 1;
      if (s.children?.length) {
        const sub = level(s.children, refs[i]);
        d.First = sub.first;
        d.Last = sub.last;
        d.Count = s.open ? sub.visible : -sub.visible;
        if (s.open) visible += sub.visible;
      }
      Object.assign(d, s.extra ?? {});
      ctx.assign(refs[i], ctx.obj(d));
    });
    return { first: refs[0], last: refs[refs.length - 1], visible };
  };
  const top = level(specs, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.visible }));
  doc.catalog.set(PDFName.of('Outlines'), root);
  return { root, items };
}

export const dictAt = (doc: PDFDocument, ref: PDFRef) => doc.context.lookup(ref, PDFDict);

export interface OutlineFixture {
  name: string;
  doc: PDFDocument;
  /** Expected [depth, title, page index or null] in document order; empty when the test checks something else. */
  expect: [number, string, number | null][];
}

const goto = (doc: PDFDocument, d: PDFObject) => doc.context.obj({ S: 'GoTo', D: d });

export const HINDI_TITLE = 'नमस्ते ₹100 \u{1F600}'; // Hindi, the rupee sign and an emoji (a surrogate pair)

/** The twelve fixtures of the bookmarks trial. The documents are not saved: tests save the ones they compare with pdf.js. */
export async function allOutlineFixtures(): Promise<OutlineFixture[]> {
  const out: OutlineFixture[] = [];
  const add = (name: string, doc: PDFDocument, expectList: OutlineFixture['expect']) => out.push({ name, doc, expect: expectList });

  {
    const { doc } = await baseDoc(8);
    buildOutline(doc, [
      { title: 'A', dest: fit(doc, 0), open: true, children: [
        { title: 'A.1', dest: fit(doc, 1), open: true, children: [{ title: 'A.1.a', dest: fit(doc, 2) }, { title: 'A.1.b', dest: fit(doc, 3) }] },
        { title: 'A.2', dest: fit(doc, 4) },
      ] },
      { title: 'B', dest: fit(doc, 5), children: [{ title: 'B.1', dest: fit(doc, 6) }] },
    ]);
    add('nested-3-levels', doc, [[0, 'A', 0], [1, 'A.1', 1], [2, 'A.1.a', 2], [2, 'A.1.b', 3], [1, 'A.2', 4], [0, 'B', 5], [1, 'B.1', 6]]);
  }
  {
    const { doc } = await baseDoc(5);
    buildOutline(doc, [
      { title: 'xyz', dest: fit(doc, 0, 'XYZ') },
      { title: 'fit', dest: fit(doc, 1, 'Fit') },
      { title: 'fith', dest: fit(doc, 2, 'FitH') },
      { title: 'goto-array', action: goto(doc, fit(doc, 3)) },
      { title: 'goto-ref-action', action: doc.context.register(goto(doc, fit(doc, 4))) },
    ]);
    add('explicit-dests-and-goto', doc, [[0, 'xyz', 0], [0, 'fit', 1], [0, 'fith', 2], [0, 'goto-array', 3], [0, 'goto-ref-action', 4]]);
  }
  {
    // /Dests dictionary (PDF 1.1) and /Names -> /Dests name tree (two levels with Kids and Limits)
    const { doc } = await baseDoc(6);
    const destsDict = doc.context.obj({ chap1: fit(doc, 1), chap2: doc.context.obj({ D: fit(doc, 2) }) });
    doc.catalog.set(PDFName.of('Dests'), destsDict);
    const leafA = doc.context.register(doc.context.obj({ Limits: [PDFString.of('alpha'), PDFString.of('beta')], Names: [PDFString.of('alpha'), fit(doc, 3), PDFString.of('beta'), doc.context.obj({ D: fit(doc, 4) })] }));
    const leafB = doc.context.register(doc.context.obj({ Limits: [PDFString.of('gamma'), PDFString.of('gamma')], Names: [hex([0x67, 0x61, 0x6d, 0x6d, 0x61]), fit(doc, 5)] }));
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: doc.context.obj({ Kids: [leafA, leafB] }) }));
    buildOutline(doc, [
      { title: 'dests-dict name', dest: PDFName.of('chap1') },
      { title: 'dests-dict name (dict /D)', dest: PDFName.of('chap2') },
      { title: 'name-tree string', dest: PDFString.of('alpha') },
      { title: 'name-tree string dict', dest: PDFString.of('beta') },
      { title: 'name-tree hex key', dest: PDFString.of('gamma') },
      { title: 'goto named', action: goto(doc, PDFString.of('alpha')) },
      { title: 'missing name', dest: PDFString.of('nope') },
      { title: 'name-in-Dests via string', dest: PDFString.of('chap1') },
    ]);
    add('named-destinations', doc, [[0, 'dests-dict name', 1], [0, 'dests-dict name (dict /D)', 2], [0, 'name-tree string', 3], [0, 'name-tree string dict', 4], [0, 'name-tree hex key', 5], [0, 'goto named', 3], [0, 'missing name', null], [0, 'name-in-Dests via string', 1]]);
  }
  {
    const { doc } = await baseDoc(3);
    buildOutline(doc, [
      { title: 'uri', action: doc.context.obj({ S: 'URI', URI: PDFString.of('https://example.org/x') }) },
      { title: 'gotor', action: doc.context.obj({ S: 'GoToR', F: PDFString.of('other.pdf'), D: [1, 'Fit'] }) },
      { title: 'launch', action: doc.context.obj({ S: 'Launch', F: PDFString.of('calc.exe') }) },
      { title: 'no target' },
      { title: 'remote page number', dest: doc.context.obj([9, 'Fit']) }, // a page number the file does not have
      { title: 'ok', dest: fit(doc, 2) },
    ]);
    add('non-page-targets', doc, [[0, 'uri', null], [0, 'gotor', null], [0, 'launch', null], [0, 'no target', null], [0, 'remote page number', null], [0, 'ok', 2]]);
  }
  {
    const { doc } = await baseDoc(2);
    buildOutline(doc, [
      { title: PDFString.of('Plain ASCII (with) parens'), dest: fit(doc, 0) },
      { title: hex([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0xa0]), dest: fit(doc, 0) }, // PDFDocEncoding: Cafe with an acute e, a bullet, a euro sign
      { title: utf16be(HINDI_TITLE), dest: fit(doc, 0) },
      { title: utf16le('₹ LE'), dest: fit(doc, 1) },
      { title: utf8bom('₹ नमस्ते UTF-8'), dest: fit(doc, 1) },
    ]);
    add('title-encodings', doc, [[0, 'Plain ASCII (with) parens', 0], [0, 'Café •€', 0], [0, HINDI_TITLE, 0], [0, '₹ LE', 1], [0, '₹ नमस्ते UTF-8', 1]]);
  }
  {
    const { doc } = await baseDoc(3);
    // a page-like object that is not in the page tree
    const orphan = doc.context.register(doc.context.obj({ Type: 'Page', MediaBox: [0, 0, 100, 100] }));
    buildOutline(doc, [{ title: 'orphan page', dest: doc.context.obj([orphan, 'Fit']) }, { title: 'ok', dest: fit(doc, 1) }]);
    add('dest-not-in-page-tree', doc, [[0, 'orphan page', null], [0, 'ok', 1]]);
  }
  {
    const { doc } = await baseDoc(4);
    const { root, items } = buildOutline(doc, [{ title: 'one', dest: fit(doc, 0), open: true, children: [{ title: 'one.a', dest: fit(doc, 1) }] }, { title: 'two', dest: fit(doc, 2) }, { title: 'three', dest: fit(doc, 3) }]);
    dictAt(doc, root).delete(PDFName.of('Count'));
    dictAt(doc, root).delete(PDFName.of('Last'));
    dictAt(doc, items[0]).delete(PDFName.of('Count')); // a parent with no count
    dictAt(doc, items[2]).set(PDFName.of('Count'), doc.context.obj(99)); // a wrong count on a leaf
    add('missing-count-last', doc, [[0, 'one', 0], [1, 'one.a', 1], [0, 'two', 2], [0, 'three', 3]]);
  }
  {
    const { doc } = await baseDoc(4);
    const { items } = buildOutline(doc, [{ title: 'a', dest: fit(doc, 0) }, { title: 'b', dest: fit(doc, 1) }, { title: 'c', dest: fit(doc, 2) }]);
    dictAt(doc, items[2]).set(PDFName.of('Next'), items[0]); // c -> a: a loop
    add('next-cycle', doc, [[0, 'a', 0], [0, 'b', 1], [0, 'c', 2]]);
  }
  {
    const { doc } = await baseDoc(4);
    const { items } = buildOutline(doc, [{ title: 'a', dest: fit(doc, 0) }, { title: 'b', dest: fit(doc, 1) }]);
    dictAt(doc, items[1]).set(PDFName.of('First'), items[1]); // an item that is its own first child
    dictAt(doc, items[0]).set(PDFName.of('First'), items[0]);
    add('first-points-to-itself', doc, [[0, 'a', 0], [0, 'b', 1]]);
  }
  {
    const { doc } = await baseDoc(1);
    buildOutline(doc, Array.from({ length: 5000 }, (_, i) => ({ title: `Bookmark ${i + 1}`, dest: fit(doc, 0) })));
    add('flat-5000', doc, []);
  }
  {
    const { doc } = await baseDoc(1);
    let spec: Spec = { title: 'L200', dest: fit(doc, 0) };
    for (let d = 199; d >= 1; d--) spec = { title: `L${d}`, dest: fit(doc, 0), open: true, children: [spec] };
    buildOutline(doc, [spec]);
    add('depth-200', doc, []);
  }
  {
    const { doc } = await baseDoc(1);
    buildOutline(doc, Array.from({ length: 50_000 }, (_, i) => ({ title: `Bookmark ${i + 1}`, dest: fit(doc, 0) })));
    add('flat-50000', doc, []);
  }
  return out;
}

/**
 * Six pages ("Page 1" to "Page 6"); an outline with nesting, named and explicit destinations, GoTo,
 * URI and script actions, UTF-16 titles and a page given as a number. In document order the items
 * are `1 Introduction` (page 1), `1.1 <Hindi>` (2), `1.2 Named, by GoTo` (3, closed), its child
 * `1.2.1 Deep, old Dests` (6), `2 Web link` (web address), `3 Script` (script), `4 Page five` (5),
 * `5 Page index as a number` (4). `broken` damages it: a loop through /Next, a missing /Count, an
 * item whose /First is itself.
 */
export async function makeOutlinePdf(broken: 'none' | 'cycle' | 'no-count' | 'self-first' = 'none'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = Array.from({ length: 6 }, (_, i) => {
    const p = doc.addPage([300, 400]);
    p.drawText(`Page ${i + 1}`, { x: 20, y: 360, size: 18, font });
    return p;
  });
  const ctx = doc.context;
  const root = ctx.nextRef();
  const [a, b, c, a1, a2, a21, d, e] = [0, 1, 2, 3, 4, 5, 6, 7].map(() => ctx.nextRef());
  const set = (ref: PDFRef, o: Record<string, unknown>) => ctx.assign(ref, ctx.obj(o as never));
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: { Names: [PDFString.of('chap2'), ctx.obj([pages[2].ref, PDFName.of('XYZ'), 0, 300, 0])] } }));
  doc.catalog.set(PDFName.of('Dests'), ctx.obj({ annex: ctx.obj({ D: [pages[5].ref, PDFName.of('Fit')] }) }));
  set(a, { Title: PDFString.of('1 Introduction'), Parent: root, Next: b, First: a1, Last: a2, Count: 3, Dest: [pages[0].ref, PDFName.of('XYZ'), 0, 400, 0] });
  set(a1, { Title: PDFHexString.fromText('1.1 करदाता (Hindi)'), Parent: a, Next: a2, Dest: [pages[1].ref, PDFName.of('Fit')] });
  set(a2, { Title: PDFString.of('1.2 Named, by GoTo'), Parent: a, Prev: a1, First: a21, Last: a21, Count: -1, A: { S: 'GoTo', D: PDFString.of('chap2') } });
  set(a21, { Title: PDFString.of('1.2.1 Deep, old Dests'), Parent: a2, Dest: PDFName.of('annex') });
  set(b, { Title: PDFString.of('2 Web link'), Parent: root, Prev: a, Next: c, A: { S: 'URI', URI: PDFString.of('https://example.in/') } });
  set(c, { Title: PDFString.of('3 Script'), Parent: root, Prev: b, Next: d, A: { S: 'JavaScript', JS: PDFString.of('app.alert(1)') } });
  set(d, { Title: PDFString.of('4 Page five'), Parent: root, Prev: c, Next: e, Dest: [pages[4].ref, PDFName.of('FitH'), 380] });
  set(e, { Title: PDFString.of('5 Page index as a number'), Parent: root, Prev: d, Dest: [PDFNumber.of(3), PDFName.of('Fit')] });
  set(root, { Type: 'Outlines', First: a, Last: e, Count: 6 });
  if (broken === 'cycle') ctx.lookup(e, PDFDict).set(PDFName.of('Next'), a);
  if (broken === 'no-count') ctx.lookup(a, PDFDict).delete(PDFName.of('Count'));
  if (broken === 'self-first') ctx.lookup(a1, PDFDict).set(PDFName.of('First'), a1);
  doc.catalog.set(PDFName.of('Outlines'), root);
  return doc.save();
}

/** Eight pages "S p1" to "S p8", ten bookmarks over three levels, every title naming its page ("T1 ..."). */
export async function makeEightPageOutlinePdf(): Promise<Uint8Array> {
  const { doc } = await baseDoc(8, 'S');
  buildOutline(doc, [
    { title: 'Ch1 T1', dest: fit(doc, 0), open: true, children: [
      { title: 'Ch1.1 T2', dest: fit(doc, 1), open: true, children: [{ title: 'Ch1.1.a T3', dest: fit(doc, 2) }] },
      { title: 'Ch1.2 T3', dest: fit(doc, 2) },
    ] },
    { title: 'Ch2 T4', dest: fit(doc, 3), open: true, children: [{ title: 'Ch2.1 T5', dest: fit(doc, 4) }, { title: 'Ch2.2 T6', dest: fit(doc, 5) }] },
    { title: 'Ch3 T7', dest: fit(doc, 6) },
    { title: 'Ch4 T8', dest: fit(doc, 7), open: true, children: [{ title: 'Ch4.1 T8', dest: fit(doc, 7) }] },
  ]);
  return doc.save();
}

/** Three pages "N p1".."N p3" with named destinations only (the outline points at them by name). */
export async function makeNamedDestOutlinePdf(label = 'C', pageCount = 4): Promise<Uint8Array> {
  const { doc } = await baseDoc(pageCount, label);
  doc.catalog.set(PDFName.of('Dests'), doc.context.obj({ first: fit(doc, 0), third: doc.context.obj({ D: fit(doc, 2) }) }));
  buildOutline(doc, [{ title: `${label} first`, dest: PDFName.of('first') }, { title: `${label} named`, dest: PDFName.of('third') }]);
  return doc.save();
}

/** The outline of a file as pdf.js reads it: [depth, title, page index or null] in document order. */
export async function pdfjsOutline(bytes: Uint8Array): Promise<[number, string, number | null][]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const flat: [number, string, number | null][] = [];
  const walk = async (items: Awaited<ReturnType<typeof pdf.getOutline>>, depth: number): Promise<void> => {
    for (const it of items ?? []) {
      let page: number | null = null;
      try {
        const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
        if (dest && dest[0] !== undefined && dest[0] !== null) page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      } catch {
        page = null;
      }
      flat.push([depth, it.title, page]);
      await walk(it.items as never, depth + 1);
    }
  };
  await walk(await pdf.getOutline(), 0);
  await pdf.destroy();
  return flat;
}

/** Every form a title can take inside a saved file: plain, UTF-16BE raw and as hex (either case), UTF-16LE raw. */
export function titleForms(text: string): string[] {
  const units: number[] = [];
  for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
  const be = Buffer.from(units.flatMap((u) => [u >> 8, u & 255]));
  const le = Buffer.from(units.flatMap((u) => [u & 255, u >> 8]));
  const hexBe = be.toString('hex');
  return [text, be.toString('latin1'), hexBe.toLowerCase(), hexBe.toUpperCase(), le.toString('latin1')];
}

/** The page text of the page a bookmark opens, for every item of a file's outline as pdf.js reads it ("title -> text"). */
export async function bookmarkPageTexts(bytes: Uint8Array): Promise<string[]> {
  const texts = await (await import('./testPdf')).pageTexts(bytes);
  return (await pdfjsOutline(bytes)).map(([, title, page]) => `${title} -> ${page === null ? 'none' : texts[page]}`);
}
