// Organise pages (plan Task B1, design 5.15; spike-stamps.md section 3.7 and the lead's rulings of
// 14 November 2026). Results are read back with pdf.js (pages, text, rotation, links, bookmarks) and
// searched raw, as organiseLeaks.test.ts does for Split and Delete pages.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookmarkReport, OrganiseReport } from './organise';
import { newPositions, organiseNotes, organisePages, planMapping, type PagePlan, type PageOrderReport } from './pageOrder';
import { ADVERSARIAL_MARKERS, buildAdversarial, makeSharedResourcesPdf, makeSharedScan, markerPaths, rawFound, renderedPages, SHARED_MARKERS } from './testLeakPdf';
import { makeFormPdf, makePdf, pageTexts, pdfjsFieldValues } from './testPdf';
import { PHASE_TWO_ERROR_MESSAGES, PdfToolsError } from './types';

vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);

type Report = OrganiseReport & BookmarkReport;
const plan = (order: number[], turns: PagePlan['turns'] = {}): PagePlan => ({ order, turns });

/** pdf.js: per page its text, rotation and the pages (1-based) its links open; the bookmarks in order, flattened with their depth. */
async function readBack(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const pageOf = async (dest: unknown): Promise<number | null> => {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit[0] === null || explicit[0] === undefined) return null;
      return (typeof explicit[0] === 'number' ? explicit[0] : await pdf.getPageIndex(explicit[0])) + 1;
    };
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const links: (number | null)[] = [];
      for (const a of (await page.getAnnotations()) as { subtype: string; dest?: unknown }[]) if (a.subtype === 'Link' && a.dest) links.push(await pageOf(a.dest));
      const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join('').trim();
      pages.push({ text, rotate: page.rotate, links });
    }
    const outline: { title: string; page: number | null; depth: number }[] = [];
    const walk = async (items: { title: string; dest: unknown; items: unknown[] }[] | null, depth: number) => {
      for (const item of items ?? []) {
        outline.push({ title: item.title, page: await pageOf(item.dest), depth });
        await walk(item.items as typeof items, depth + 1);
      }
    };
    await walk((await pdf.getOutline()) as never, 0);
    return { pages, outline };
  } finally {
    await pdf.destroy();
  }
}

/** A page's content as drawn: its content streams decoded and joined. */
function contentOf(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.get(PDFName.of('Contents'));
  const looked = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  const refs = looked instanceof PDFArray ? looked.asArray() : [contents!];
  return refs.map((ref) => Buffer.from(decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode()).toString('latin1')).join('\n');
}

const boxesOf = (doc: PDFDocument, index: number) => {
  const page = doc.getPage(index);
  return { media: page.getMediaBox(), crop: page.getCropBox() };
};

const ownRotate = (doc: PDFDocument, index: number) => (doc.getPage(index).node.get(PDFName.of('Rotate')) as PDFNumber | undefined)?.asNumber();

/** Leaked markers with the object path that carried each, for a readable failure (organiseLeaks.test.ts). */
async function leaks(bytes: Uint8Array, forbidden: string[]): Promise<Record<string, string>> {
  const found = rawFound(bytes, forbidden);
  if (found.length === 0) return {};
  const paths = await markerPaths(bytes, found);
  return Object.fromEntries(found.map((id) => [id, paths[id] ?? '(raw bytes only)']));
}

const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof PdfToolsError ? `${error.code}: ${error.message}` : `not a PdfToolsError: ${String(error)}`),
  );

/** Three pages; bookmarks "Intro" (page 1), "Chapter" (page 2) holding "Section" (page 3). */
async function makeNestedOutlinePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf('N', 3));
  const ctx = doc.context;
  const pages = doc.getPages();
  const [root, intro, chapter, section] = [ctx.nextRef(), ctx.nextRef(), ctx.nextRef(), ctx.nextRef()];
  const dest = (i: number) => ctx.obj([pages[i].ref, 'Fit']);
  ctx.assign(intro, ctx.obj({ Title: PDFString.of('Intro'), Parent: root, Dest: dest(0), Next: chapter }));
  ctx.assign(chapter, ctx.obj({ Title: PDFString.of('Chapter'), Parent: root, Dest: dest(1), Prev: intro, First: section, Last: section, Count: 1 }));
  ctx.assign(section, ctx.obj({ Title: PDFHexString.fromText('Section करदाता'), Parent: chapter, Dest: dest(2) }));
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: intro, Last: chapter, Count: 3 }));
  doc.catalog.set(PDFName.of('Outlines'), root);
  return doc.save();
}

/** Pages with their own /Rotate 0, 90, 180, 270, 45 (not a multiple of 90: read as 0), -90 (270) and 450 (90). */
async function makeRotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf('R', 7));
  [0, 90, 180, 270, 45, -90, 450].forEach((angle, i) => doc.getPage(i).node.set(PDFName.of('Rotate'), PDFNumber.of(angle)));
  return doc.save();
}

/** Two pages that inherit /Rotate 90 and their media box from the page tree's root. */
async function makeInheritedRotationPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf('I', 2, { size: [300, 400] }));
  const root = doc.context.lookup(doc.catalog.get(PDFName.of('Pages')), PDFDict);
  root.set(PDFName.of('Rotate'), PDFNumber.of(90));
  root.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, 300, 400]));
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of('Rotate'));
    page.node.delete(PDFName.of('MediaBox'));
  }
  return doc.save();
}

describe('the trial file: a three-page form with links between pages and bookmarks', () => {
  let form: Uint8Array;
  let before: Awaited<ReturnType<typeof readBack>>;
  beforeAll(async () => {
    form = await makeFormPdf({ links: true, bookmarks: true });
    before = await readBack(form);
  });

  it('self-check: page 1 links to pages 2 and 3; one bookmark per page', () => {
    expect(before.pages.map((p) => p.links)).toEqual([[2, 3], [], []]);
    expect(before.outline).toEqual([1, 2, 3].map((n) => ({ title: `Page ${n}`, page: n, depth: 0 })));
  });

  it('order 3, 1, 2 with the new first page turned: text, rotation, links, bookmarks in their own order, every field value', async () => {
    const report: Report = {};
    const result = await organisePages(form, plan([2, 0, 1], { 2: 90 }), { report });
    const after = await readBack(result);
    expect(after.pages.map((p) => p.text)).toEqual(['Form p3', 'Form p1', 'Form p2']);
    expect(after.pages.map((p) => p.rotate)).toEqual([90, 0, 0]);
    // the links of old page 1 (now page 2) still open old pages 2 and 3, now pages 3 and 1
    expect(after.pages[1].links).toEqual([3, 1]);
    // bookmarks keep their own order (lead ruling 2), each at its page's new place
    expect(after.outline).toEqual([
      { title: 'Page 1', page: 2, depth: 0 },
      { title: 'Page 2', page: 3, depth: 0 },
      { title: 'Page 3', page: 1, depth: 0 },
    ]);
    expect(await pdfjsFieldValues(result)).toEqual(await pdfjsFieldValues(form));
    expect(report.bookmarksDropped ?? 0).toBe(0);
    expect(report.sharedResourcesKept).toBeFalsy();
  });

  it('removing page 2 drops its bookmark (and says so), its fields and the link to it; the other link follows its page', async () => {
    const report: Report = {};
    const result = await organisePages(form, plan([0, 2]), { report });
    const after = await readBack(result);
    expect(after.pages.map((p) => p.text)).toEqual(['Form p1', 'Form p3']);
    expect(after.pages[0].links).toEqual([2]);
    expect(after.outline).toEqual([
      { title: 'Page 1', page: 1, depth: 0 },
      { title: 'Page 3', page: 2, depth: 0 },
    ]);
    expect(report.bookmarksDropped).toBe(1);
    expect(Object.keys(await pdfjsFieldValues(result))).not.toContain('address.city');
  });

  it('turning pages without moving or removing any is done in place: links, fields, bookmarks and the signature field all stay', async () => {
    const signed = await makeFormPdf({ links: true, bookmarks: true, signature: true });
    const report: Report = {};
    const result = await organisePages(signed, plan([0, 1, 2], { 1: 270 }), { report });
    const after = await readBack(result);
    const source = await readBack(signed);
    expect(after.pages.map((p) => p.rotate)).toEqual([0, 270, 0]);
    expect(after.pages.map((p) => ({ ...p, rotate: 0 }))).toEqual(source.pages.map((p) => ({ ...p, rotate: 0 })));
    expect(after.outline).toEqual(source.outline);
    expect(await pdfjsFieldValues(result)).toEqual(await pdfjsFieldValues(signed));
    const doc = await PDFDocument.load(result, { updateMetadata: false });
    const fields = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('Fields'), PDFArray).asArray();
    expect(fields.some((ref) => doc.context.lookup(ref, PDFDict).get(PDFName.of('FT')) === PDFName.of('Sig'))).toBe(true);
    expect(report).toEqual({});
    expect(doc.getProducer()).toBe('ICAI VERA');
  });

  it('a bookmark whose page is removed goes; the bookmarks under it move up into its place (lead ruling 1)', async () => {
    const nested = await makeNestedOutlinePdf();
    expect((await readBack(nested)).outline).toEqual([
      { title: 'Intro', page: 1, depth: 0 },
      { title: 'Chapter', page: 2, depth: 0 },
      { title: 'Section करदाता', page: 3, depth: 1 },
    ]);
    const report: Report = {};
    const result = await organisePages(nested, plan([2, 0]), { report });
    expect((await readBack(result)).outline).toEqual([
      { title: 'Intro', page: 2, depth: 0 },
      { title: 'Section करदाता', page: 1, depth: 0 },
    ]);
    expect(report.bookmarksDropped).toBe(1);
    expect(rawFound(result, ['Chapter'])).toEqual([]);
  });
});

describe('turning changes /Rotate only', () => {
  it('adds the turn to the rotation each page has (normalised to 0, 90, 180 or 270), in place and when pages move', async () => {
    const rotated = await makeRotatedPdf();
    expect((await readBack(rotated)).pages.map((p) => p.rotate)).toEqual([0, 90, 180, 270, 0, 270, 90]); // self-check: pdf.js reads them so
    const turns: PagePlan['turns'] = { 0: 90, 1: 180, 2: 270, 3: 90, 4: 90, 5: 180, 6: 270 };
    const expected = [90, 270, 90, 0, 90, 90, 0];
    const inPlace = await organisePages(rotated, plan([0, 1, 2, 3, 4, 5, 6], turns));
    expect((await readBack(inPlace)).pages.map((p) => p.rotate)).toEqual(expected);
    const reversed = await organisePages(rotated, plan([6, 5, 4, 3, 2, 1, 0], turns));
    expect((await readBack(reversed)).pages.map((p) => p.rotate)).toEqual([...expected].reverse());
    // written on the page itself, as a number from 0 to 270
    const doc = await PDFDocument.load(inPlace);
    expect(doc.getPages().map((_, i) => ownRotate(doc, i))).toEqual(expected);
  });

  it('a page with /Rotate 270 turned by 90 comes out at 0', async () => {
    const page = await makePdf('T', 2, { rotate: 270 });
    for (const order of [[0, 1], [1, 0]]) {
      const result = await organisePages(page, plan(order, { 0: 90 }));
      const rotations = (await readBack(result)).pages.map((p) => p.rotate);
      expect(rotations[order.indexOf(0)]).toBe(0);
      expect(rotations[order.indexOf(1)]).toBe(270);
    }
  });

  it('a rotation inherited from the page tree counts: 90 inherited and turned by 270 gives 0 written on the page', async () => {
    const inherited = await makeInheritedRotationPdf();
    expect((await readBack(inherited)).pages.map((p) => p.rotate)).toEqual([90, 90]); // self-check
    for (const order of [[0, 1], [1, 0]]) {
      const result = await organisePages(inherited, plan(order, { 0: 270 }));
      const doc = await PDFDocument.load(result);
      const at = order.indexOf(0);
      expect((await readBack(result)).pages[at].rotate).toBe(0);
      expect(ownRotate(doc, at)).toBe(0);
      expect((await readBack(result)).pages[1 - at].rotate).toBe(90);
      const { width, height } = doc.getPage(at).getMediaBox();
      expect([width, height]).toEqual([300, 400]);
    }
  });

  it('every page keeps its content, media box and crop box byte for byte; pages not turned draw exactly as before', async () => {
    const source = await makePdf('C', 3, { cropBox: [10, 20, 200, 300] });
    const sourceDoc = await PDFDocument.load(source);
    const drawn = await renderedPages(source);
    for (const [label, order] of [['in place', [0, 1, 2]], ['reordered', [2, 0, 1]], ['one removed', [2, 0]]] as const) {
      const result = await organisePages(source, plan([...order], { 2: 90 }));
      const doc = await PDFDocument.load(result);
      const pixels = (await renderedPages(result)).pages;
      order.forEach((from, at) => {
        expect(contentOf(doc, at), `${label}: content of page ${from + 1}`).toBe(contentOf(sourceDoc, from));
        expect(boxesOf(doc, at), `${label}: boxes of page ${from + 1}`).toEqual(boxesOf(sourceDoc, from));
        if (from !== 2) expect(pixels[at].pixels, `${label}: page ${from + 1} draws as before`).toBe(drawn.pages[from].pixels);
      });
    }
  });
});

describe('nothing of a removed page stays in the result (as organiseLeaks.test.ts for Split and Delete pages)', () => {
  const sharedOf = (pages: number[]) => pages.flatMap((p) => SHARED_MARKERS[p as 1 | 2 | 3 | 4]);

  it('pages that share or inherit one resource dictionary: removed pages leave no marker, kept pages draw as before', async () => {
    const source = await makeSharedResourcesPdf();
    const drawn = await renderedPages(source);
    for (const turns of [{}, { 2: 90 as const, 0: 180 as const }]) {
      const report: Report = {};
      const result = await organisePages(source, plan([2, 0], turns), { report });
      expect(await leaks(result, sharedOf([2, 4]))).toEqual({});
      expect(rawFound(result, sharedOf([1, 3]))).toEqual(sharedOf([1, 3]));
      expect(report.sharedResourcesKept).toBeFalsy();
      if (Object.keys(turns).length === 0) {
        const after = await renderedPages(result);
        expect(after.pages.map((p) => p.pixels)).toEqual([drawn.pages[2].pixels, drawn.pages[0].pixels]);
        expect(after.warnings.filter((w) => !drawn.warnings.includes(w))).toEqual([]);
      }
    }
  });

  for (const objectStreams of [false, true]) {
    it(`the re-review's adversarial file: no marker of a removed page, and the kept pages' own (object streams: ${objectStreams})`, async () => {
      const source = await buildAdversarial({ objectStreams, sd: true });
      const before = source.slice();
      const result = await organisePages(source, plan([2, 0], { 2: 180, 0: 90 }));
      const removed = ADVERSARIAL_MARKERS.filter((m) => m.page === 2 || m.page === 4).map((m) => m.id);
      expect(await leaks(result, removed)).toEqual({});
      expect(rawFound(result, ['DOC-XMP', 'DOC-THREADTITLE'])).toEqual([]);
      const kept = ['PG1-TEXT', 'PG1-XOBJ', 'PG1-FIELDVAL', 'PG1-CITY', 'PG1-REPLY', 'PG1-RADIOAP', 'PG1-THUMB', 'PG1-SIGAP', 'PG1-ORPHVAL', 'PG3-TEXT'];
      expect(rawFound(result, kept)).toEqual(kept);
      expect((await pageTexts(result)).map((t) => t.slice(0, 8))).toEqual(['PG3-TEXT', 'PG1-TEXT']);
      expect(source).toEqual(before);
    });
  }
});

describe('the plan is checked before anything is made', () => {
  let three: Uint8Array;
  beforeAll(async () => {
    three = await makePdf('E', 3);
  });

  it('refuses removing every page, a page outside the file, a repeated page, and a turn that is not a quarter', async () => {
    expect(await codeOf(organisePages(three, plan([])))).toBe(`organise-all-removed: ${PHASE_TWO_ERROR_MESSAGES['organise-all-removed']}`);
    expect(await codeOf(organisePages(three, plan([0, 3])))).toBe("invalid-page-list: Page 4 is outside this file's 3 pages.");
    expect(await codeOf(organisePages(three, plan([0, -1])))).toBe('invalid-page-list: Page numbers must be whole numbers from 1 to 3.');
    expect(await codeOf(organisePages(three, plan([0, 1.5])))).toBe('invalid-page-list: Page numbers must be whole numbers from 1 to 3.');
    expect(await codeOf(organisePages(three, plan([0, 1, 0])))).toBe('duplicate-page: Page 1 is in the new order twice. Each page can be kept once.');
    expect(await codeOf(organisePages(three, plan([0, 1, 2], { 1: 45 as never })))).toBe('invalid-rotation: Pages turn in steps of 90 degrees.');
    expect(await codeOf(organisePages(three, plan([0, 1, 2], { 7: 90 })))).toBe("invalid-page-list: Page 8 is outside this file's 3 pages.");
  });

  it('refuses a protected file and a file that is not a PDF', async () => {
    const { PDFDocument: Cantoo } = await import('@cantoo/pdf-lib');
    const protectedDoc = await Cantoo.load(three);
    protectedDoc.encrypt({ userPassword: 'Organise-Pw-1', ownerPassword: 'Organise-Pw-1', algorithm: 'AES-256' });
    const locked = await protectedDoc.save();
    expect(await codeOf(organisePages(locked, plan([1, 0, 2])))).toBe('encrypted: This file is password-protected. Unlock it first.');
    expect(await codeOf(organisePages(new Uint8Array([1, 2, 3]), plan([0])))).toMatch(/^not-a-pdf: /);
  });

  it('a turn on a page that is removed has no effect', async () => {
    const result = await organisePages(three, plan([1, 0], { 2: 90 }));
    expect((await readBack(result)).pages.map((p) => [p.text, p.rotate])).toEqual([['E p2', 0], ['E p1', 0]]);
  });

  it('leaves the source unchanged', async () => {
    const before = three.slice();
    await organisePages(three, plan([2, 1], { 1: 90 }));
    await organisePages(three, plan([0, 1, 2], { 1: 90 }));
    expect(three).toEqual(before);
  });
});

describe('the page mapping (for bookmarks and anything else that follows pages)', () => {
  it('old index to new index, or null when the page is removed', () => {
    const order = [4, 0, 8];
    const expected: (number | null)[] = Array.from({ length: 17 }, () => null);
    expected[4] = 0;
    expected[0] = 1;
    expected[8] = 2;
    expect(newPositions(plan(order), 17)).toEqual(expected);
    const map = planMapping(plan(order));
    expect([map(4), map(0), map(8), map(1)]).toEqual([0, 1, 2, undefined]);
    expect(newPositions(plan([0, 1, 2], { 1: 90 }), 3)).toEqual([0, 1, 2]);
  });
});

describe('progress and Stop', () => {
  for (const [label, order] of [['in place', [0, 1, 2]], ['with a copy', [2, 1, 0]]] as const) {
    it(`reports each page and stops when the callback throws (${label})`, async () => {
      const source = await makePdf('S', 3);
      const seen: [number, number][] = [];
      await organisePages(source, plan([...order], { 0: 90 }), { onPage: (done, total) => void seen.push([done, total]) });
      expect(seen).toEqual([[0, 3], [1, 3], [2, 3]]);
      const stop = new Error('stopped');
      const error = await organisePages(source, plan([...order], { 0: 90 }), {
        onPage: (done) => {
          if (done === 1) throw stop;
        },
      }).catch((e: unknown) => e);
      expect(error).toBe(stop);
    });
  }
});

// ---- review fix round 1 ---------------------------------------------------------------------------

/** pdf.js: attachments (name to content), named destinations (name to page, 1-based), page labels, and /Lang. */
async function documentView(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const attachments = Object.fromEntries(
      Object.entries(((await pdf.getAttachments()) ?? {}) as Record<string, { content: Uint8Array }>).map(([name, a]) => [name, Buffer.from(a.content).toString('latin1')]),
    );
    const destinations: Record<string, number> = {};
    for (const [name, dest] of Object.entries((await pdf.getDestinations()) ?? {})) {
      destinations[name] = (await pdf.getPageIndex((dest as unknown[])[0] as never)) + 1;
    }
    const { info } = await pdf.getMetadata();
    return { attachments, destinations, labels: await pdf.getPageLabels(), lang: (info as { Language?: string }).Language ?? null };
  } finally {
    await pdf.destroy();
  }
}

/**
 * Four pages with document-level parts: /Lang; an attachment; named destinations in the name tree and
 * in the old /Dests dictionary, to kept and to removed pages; a link on page 1 by name to page 3; page
 * labels i, ii, Sec-5, Sec-6; and parts the copy does not carry (XMP, structure tags, an opening view,
 * viewer settings, a document script).
 */
async function makeDocumentLevelPdf(labels: Record<string, unknown> = { Nums: [0, { S: 'r' }, 2, { S: 'D', P: PDFString.of('Sec-'), St: 5 }] }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf('D', 4));
  const ctx = doc.context;
  const pages = doc.getPages();
  const S = (text: string) => PDFString.of(text);
  doc.catalog.set(PDFName.of('Lang'), S('MK-LANG-ORG'));
  const file = ctx.register(ctx.flateStream('ATTACHMENT-BODY for the record', { Type: 'EmbeddedFile' }));
  const spec = ctx.register(ctx.obj({ Type: 'Filespec', F: S('notes.txt'), UF: PDFHexString.fromText('notes.txt'), EF: { F: file } }));
  const script = ctx.register(ctx.obj({ S: 'JavaScript', JS: S('app.alert(1)') }));
  doc.catalog.set(
    PDFName.of('Names'),
    ctx.obj({
      Dests: { Names: [S('dest-p1'), [pages[0].ref, 'Fit'], S('dest-p2'), [pages[1].ref, 'Fit'], S('dest-p3'), [pages[2].ref, 'XYZ', 0, 400, null]] },
      EmbeddedFiles: { Names: [S('notes.txt'), spec] },
      JavaScript: { Names: [S('doc-script'), script] },
    }),
  );
  doc.catalog.set(PDFName.of('Dests'), ctx.obj({ 'olddest-p4': [pages[3].ref, 'Fit'], 'olddest-p2': { D: [pages[1].ref, 'Fit'] } }));
  pages[0].node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], Border: [0, 0, 0], Dest: S('dest-p3') }))]));
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj(labels as never));
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.flateStream('<x:xmpmeta>MK-ORG-XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
  doc.catalog.set(PDFName.of('StructTreeRoot'), ctx.register(ctx.obj({ Type: 'StructTreeRoot', K: [] })));
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
  doc.catalog.set(PDFName.of('OpenAction'), ctx.obj([pages[0].ref, 'Fit']));
  doc.catalog.set(PDFName.of('ViewerPreferences'), ctx.obj({ HideToolbar: true }));
  return doc.save();
}

describe('what moving or removing pages carries, and says it does not (review F3)', () => {
  let source: Uint8Array;
  beforeAll(async () => {
    source = await makeDocumentLevelPdf();
    const view = await documentView(source); // self-check
    expect(view).toEqual({
      attachments: { 'notes.txt': 'ATTACHMENT-BODY for the record' },
      destinations: { 'dest-p1': 1, 'dest-p2': 2, 'dest-p3': 3, 'olddest-p2': 2, 'olddest-p4': 4 },
      labels: ['i', 'ii', 'Sec-5', 'Sec-6'],
      lang: 'MK-LANG-ORG',
    });
  });

  for (const turns of [{}, { 2: 90 as const }]) {
    it(`order 4, 1, 3 (page 2 removed${Object.keys(turns).length ? ', page 3 turned' : ''}): language, attachment, destinations of kept pages and their labels come along`, async () => {
      const report: PageOrderReport = {};
      const result = await organisePages(source, plan([3, 0, 2], turns), { report });
      expect(await documentView(result)).toEqual({
        attachments: { 'notes.txt': 'ATTACHMENT-BODY for the record' },
        destinations: { 'dest-p1': 2, 'dest-p3': 3, 'olddest-p4': 1 },
        labels: ['Sec-6', 'i', 'Sec-5'],
        lang: 'MK-LANG-ORG',
      });
      // the link of old page 1 by name still opens old page 3, now page 3
      expect((await readBack(result)).pages[1].links).toEqual([3]);
      expect(report.namedDestinationsDropped).toBe(2);
      expect(report.pageLabelsDropped).toBeUndefined();
      expect([...(report.notCarried ?? [])].sort()).toEqual(['accessibility-tags', 'document-scripts', 'opening-view', 'viewer-settings', 'xmp-metadata']);
      expect(rawFound(result, ['dest-p2', 'olddest-p2', 'MK-ORG-XMP', 'app.alert'])).toEqual([]);
      const notes = organiseNotes(report);
      expect(notes.join(' ')).toMatch(/2 named destinations/);
      expect(notes.join(' ')).toMatch(/XMP metadata/);
    });
  }

  it('turning pages in place keeps every document-level part and reports nothing', async () => {
    const report: PageOrderReport = {};
    const result = await organisePages(source, plan([0, 1, 2, 3], { 1: 90 }), { report });
    expect(await documentView(result)).toEqual(await documentView(source));
    expect(report).toEqual({});
    expect(organiseNotes(report)).toEqual([]);
  });

  it('page labels that cannot be read exactly are dropped, and the result says so', async () => {
    for (const labels of [{ Nums: [0, { S: 'Q' }] }, { Nums: [0, { S: 'D', St: 0 }] }, { Nums: [0, 7] }]) {
      const bad = await makeDocumentLevelPdf(labels);
      const report: PageOrderReport = {};
      const result = await organisePages(bad, plan([1, 0]), { report });
      expect(report.pageLabelsDropped, JSON.stringify(labels)).toBe(true);
      expect((await PDFDocument.load(result)).catalog.has(PDFName.of('PageLabels'))).toBe(false);
      expect(organiseNotes(report).join(' ')).toMatch(/[Pp]age labels/);
    }
  });

  it('labels stay exact through a reorder: every kept page shows the label it had', async () => {
    const labelled = await makeDocumentLevelPdf({ Nums: [0, { S: 'A', P: PDFHexString.fromText('Annex-') }, 2, { P: PDFString.of('Cover') }, 3, { S: 'R', St: 4 }] });
    const before = (await documentView(labelled)).labels!;
    expect(before).toEqual(['Annex-A', 'Annex-B', 'Cover', 'IV']); // self-check
    for (const order of [[3, 2, 1, 0], [1, 3], [0, 1, 2, 3].reverse().slice(1)]) {
      const result = await organisePages(labelled, plan(order));
      expect((await documentView(result)).labels, JSON.stringify(order)).toEqual(order.map((i) => before[i]));
    }
  });
});

describe('names written with lower-case escapes (review F4) and the check that every page draws as before', () => {
  /** Two pages; page 1 draws images named as written in `names` (e.g. Im#2d1, which readers read as Im-1). */
  async function makeNamedImagesPdf(names: string[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([200, 200]);
    doc.addPage([200, 200]);
    const pixels = new Uint8Array(Array.from({ length: 16 }, () => [255, 0, 0]).flat());
    const xobjects: Record<string, PDFRef> = {};
    let content = '';
    names.forEach((_, i) => {
      xobjects[`PLACEHOLDER${i}`] = doc.context.register(doc.context.stream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
      content += `q 40 0 0 40 ${20 + 60 * i} 80 cm /PLACEHOLDER${i} Do Q `;
    });
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: xobjects }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
    let text = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
    names.forEach((name, i) => (text = text.split(`/PLACEHOLDER${i}`).join(`/${name}`)));
    return new Uint8Array(Buffer.from(text, 'latin1'));
  }

  async function imagesPainted(bytes: Uint8Array, pageNumber: number): Promise<number> {
    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
    try {
      return (await (await pdf.getPage(pageNumber)).getOperatorList()).fnArray.filter((fn) => fn === OPS.paintImageXObject).length;
    } finally {
      await pdf.destroy();
    }
  }

  it('a page whose image is named /Im#2d1 keeps its image when turned in place and when moved', async () => {
    const source = await makeNamedImagesPdf(['Im#2d1', 'Caf#c3#a9']);
    expect(await imagesPainted(source, 1)).toBe(2); // self-check: pdf.js reads both names
    const turned = await organisePages(source, plan([0, 1], { 0: 90 }));
    expect(await imagesPainted(turned, 1)).toBe(2);
    const moved = await organisePages(source, plan([1, 0], { 1: 90 }));
    expect(await imagesPainted(moved, 2)).toBe(2);
    const removed = await organisePages(source, plan([0]));
    expect(await imagesPainted(removed, 1)).toBe(2);
  });

  it('a name with a real # in it (written #23) is kept as it is', async () => {
    const source = await makeNamedImagesPdf(['X#23b1']);
    expect(await imagesPainted(source, 1)).toBe(1); // self-check
    expect(await imagesPainted(await organisePages(source, plan([0, 1], { 0: 90 })), 1)).toBe(1);
    expect(await imagesPainted(await organisePages(source, plan([1, 0])), 2)).toBe(1);
  });

  it('a page that would lose an image whichever way its names are written is refused, and nothing is made', async () => {
    const source = await makeNamedImagesPdf(['Im#2d1', 'X#23b1']);
    expect(await imagesPainted(source, 1)).toBe(2); // self-check
    for (const p of [plan([0, 1], { 0: 90 }), plan([1, 0])]) {
      expect(await codeOf(organisePages(source, p))).toBe(
        'page-would-change: This file uses a name form that cannot be kept; page 1 would lose an image or font. Nothing was created.',
      );
    }
  });
});

describe('turning in place keeps no earlier revision (review F5, design 11a)', () => {
  it('a comment removed by an earlier incremental save is not in the result; every page still draws as before', async () => {
    const { PDFDocument: Cantoo, PDFName: CantooName } = await import('@cantoo/pdf-lib');
    const first = await PDFDocument.load(await makePdf('Rev', 2));
    const note = first.context.register(first.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('ORG-OLD-REVISION-NOTE') }));
    first.getPage(0).node.set(PDFName.of('Annots'), first.context.obj([note]));
    const later = await Cantoo.load(await first.save({ useObjectStreams: false }), { forIncrementalUpdate: true, updateMetadata: false });
    later.getPage(0).node.delete(CantooName.of('Annots'));
    const updated = await later.save();
    expect(rawFound(updated, ['ORG-OLD-REVISION-NOTE'])).toEqual(['ORG-OLD-REVISION-NOTE']); // self-check: still in the bytes
    const result = await organisePages(updated, plan([0, 1], { 0: 90 }));
    expect(rawFound(result, ['ORG-OLD-REVISION-NOTE'])).toEqual([]);
    const [a, b] = await Promise.all([PDFDocument.load(updated), PDFDocument.load(result)]);
    for (const i of [0, 1]) expect(contentOf(b, i)).toBe(contentOf(a, i));
    expect((await renderedPages(result)).pages[1].pixels).toBe((await renderedPages(updated)).pages[1].pixels);
  });
});

describe('a file that claims PDF/A-1, turned in place', () => {
  it('is written without object streams (PDF/A-1 does not allow them)', async () => {
    const doc = await PDFDocument.load(await makePdf('A1', 2));
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>1</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta>';
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.flateStream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
    const source = await doc.save({ useObjectStreams: false });
    const result = await organisePages(source, plan([0, 1], { 1: 90 }));
    expect(Buffer.from(result).toString('latin1')).not.toContain('/ObjStm');
    expect((await readBack(result)).pages.map((p) => p.rotate)).toEqual([0, 90]);
  });
});

describe('300 pages that name one shared image dictionary', () => {
  it('turn all in place, reverse, and reverse with every page turned each finish in reasonable time (times logged)', async () => {
    const source = await makeSharedScan(300, 200, { indirect: true });
    const all = Array.from({ length: 300 }, (_, i) => i);
    const turnAll = Object.fromEntries(all.map((i) => [i, 90 as const]));
    const runs: [string, PagePlan][] = [
      ['turn all in place', plan(all, turnAll)],
      ['reverse', plan([...all].reverse())],
      ['reverse and turn all', plan([...all].reverse(), turnAll)],
    ];
    const times: Record<string, number> = {};
    for (const [label, p] of runs) {
      const started = performance.now();
      const result = await organisePages(source, p);
      times[label] = Math.round(performance.now() - started);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount(), label).toBe(p.order.length);
    }
    console.warn(`Organise pages, 300 pages: ${JSON.stringify(times)} ms`);
    // Loose: catches work that grows out of proportion, not a busy machine (spike-stamps.md: 0.4 to 0.9 s
    // idle; 1.5 to 3.8 s here with the processor fully loaded; the whole suite in parallel is far slower).
    for (const [label, ms] of Object.entries(times)) expect(ms, label).toBeLessThan(120_000);
  }, 600_000);
});

// REV-A (15 November 2026): a page tree node that is its own parent overflowed the stack (S2).
describe('REV-A fixes in Organise pages', () => {
  it('S2: a page tree node that is its own parent is refused plainly, for a turn and for a move', async () => {
    const parts = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Parent 2 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'];
    let text = '%PDF-1.7\n';
    const offsets: number[] = [];
    parts.forEach((o, i) => {
      offsets.push(text.length);
      text += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = text.length;
    text += `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const file = Uint8Array.from(text, (c) => c.charCodeAt(0));
    for (const plan of [{ order: [0, 1], turns: { 0: 90 } }, { order: [1, 0], turns: {} }] as PagePlan[]) {
      await expect(organisePages(file, plan), JSON.stringify(plan)).rejects.toMatchObject({ name: 'PdfToolsError', code: 'not-a-pdf', message: 'This file could not be read as a PDF. It may be damaged.' });
    }
  });
});

// FIX-A2 follow-up (INT3 concern 1): a Stop pressed while the file is still being read ends the run within the
// read, with the run's own error, never "could not be read".
describe('Organise pages: Stop while the file is read', () => {
  class Stopped extends Error {}
  it('stops with the run’s own error, for a turn and for a move', async () => {
    let clock = 0;
    // A clock that runs 60 ms between two looks at it: every look finds a turn due, so the read waits often.
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60));
    try {
      const file = await makePdf('O', 4);
      for (const plan of [{ order: [0, 1, 2, 3], turns: { 1: 90 } }, { order: [1, 0, 2, 3], turns: {} }] as PagePlan[]) {
        const stop = new Stopped(JSON.stringify(plan));
        const error = await organisePages(file, plan, { check: () => { throw stop; } }).catch((e: unknown) => e);
        expect(error).toBe(stop);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
