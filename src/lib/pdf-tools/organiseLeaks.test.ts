// What of a left-out page can stay inside a Split or Delete pages result. Each result's bytes are
// searched with every stream inflated (the final re-review's search), and every kept page must draw
// exactly as in the source (pdf.js pixels and text), with no new pdf.js warning, unless the result
// says its resources were kept whole.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { deletePages, extractPages, splitEvery, type OrganiseReport } from './organise';
import {
  ADVERSARIAL_MARKERS,
  buildAdversarial,
  makeNameLookalikePdf,
  makeSharedResourcesPdf,
  makeSharedScan,
  markerPaths,
  rawFound,
  redrawCases,
  renderedPages,
  SHARED_MARKERS,
  type RenderedPage,
} from './testLeakPdf';

vi.setConfig({ testTimeout: 180_000 });

const ALL_PAGES = [1, 2, 3, 4] as const;
const sharedMarkersOf = (pages: readonly number[]) => pages.flatMap((p) => SHARED_MARKERS[p as 1 | 2 | 3 | 4]);
const ALL_SHARED = sharedMarkersOf(ALL_PAGES);

/** The result's pages draw like the source pages they came from, with no warning the source did not give. */
async function expectSameDrawing(result: Uint8Array, source: { pages: RenderedPage[]; warnings: string[] }, from: number[], label: string) {
  const drawn = await renderedPages(result);
  expect(drawn.pages.map((p) => p.text), label).toEqual(from.map((n) => source.pages[n - 1].text));
  expect(drawn.pages.map((p) => p.pixels), label).toEqual(from.map((n) => source.pages[n - 1].pixels));
  expect(drawn.warnings.filter((w) => !source.warnings.includes(w)), label).toEqual([]);
}

/** Leaked markers with the object path that carried each, for a readable failure. */
async function leaks(bytes: Uint8Array, forbidden: string[]): Promise<Record<string, string>> {
  const found = rawFound(bytes, forbidden);
  if (found.length === 0) return {};
  const paths = await markerPaths(bytes, found);
  return Object.fromEntries(found.map((id) => [id, paths[id] ?? '(raw bytes only)']));
}

describe('pages that share or inherit one resource dictionary', () => {
  let source: Uint8Array;
  let drawn: { pages: RenderedPage[]; warnings: string[] };
  beforeAll(async () => {
    source = await makeSharedResourcesPdf();
    drawn = await renderedPages(source);
  }, 120_000);

  it('the source holds every marker and draws without warnings (self-check)', () => {
    expect(rawFound(source, ALL_SHARED)).toEqual(ALL_SHARED);
    expect(drawn.warnings).toEqual([]);
    expect(drawn.pages.map((p) => p.text)).toEqual([expect.stringContaining('PG1-TEXT'), expect.stringContaining('PG2-TEXT'), 'PG3-TEXT', expect.stringContaining('PG4-TEXT')]);
  });

  const cases: [string, (s: Uint8Array, report: OrganiseReport) => Promise<Uint8Array>, number[]][] = [
    ['Delete pages 2 and 4', (s, report) => deletePages(s, [1, 3], { report }), [1, 3]],
    ['Delete page 1', (s, report) => deletePages(s, [0], { report }), [2, 3, 4]],
    ['Split, page range 1-1', (s, report) => extractPages(s, [0], { report }), [1]],
    ['Split, page range 2-3', (s, report) => extractPages(s, [1, 2], { report }), [2, 3]],
    ['Split, selected pages 3, 1, 1', (s, report) => extractPages(s, [2, 0, 0], { report }), [3, 1, 1]],
  ];
  for (const [label, run, kept] of cases) {
    it(`${label}: no marker of the other pages in the bytes, and every kept page draws as before`, async () => {
      const before = source.slice();
      const report: OrganiseReport = {};
      const result = await run(source, report);
      const removed = sharedMarkersOf(ALL_PAGES.filter((p) => !kept.includes(p)));
      expect(await leaks(result, removed), label).toEqual({});
      expect(rawFound(result, sharedMarkersOf([...new Set(kept)])), label).toEqual(sharedMarkersOf([...new Set(kept)]));
      await expectSameDrawing(result, drawn, kept, label);
      expect(report.sharedResourcesKept).toBeFalsy();
      expect(source).toEqual(before);
    });
  }

  it('Split every N: each part holds only its own pages', async () => {
    for (const n of [1, 2, 3]) {
      const reports: OrganiseReport[] = [];
      const parts = await splitEvery(source, n, { reports });
      expect(parts).toHaveLength(Math.ceil(4 / n));
      expect(reports).toHaveLength(parts.length);
      for (const [i, part] of parts.entries()) {
        const kept = ALL_PAGES.slice(i * n, i * n + n) as unknown as number[];
        const label = `every ${n}, part ${i + 1}`;
        expect(await leaks(part, sharedMarkersOf(ALL_PAGES.filter((p) => !kept.includes(p)))), label).toEqual({});
        await expectSameDrawing(part, drawn, kept, label);
        expect(reports[i].sharedResourcesKept, label).toBeFalsy();
      }
    }
  });

  it('each kept page gets its own resources: inherited ones are written on the page, the implicit DefaultRGB is kept', async () => {
    const doc = await PDFDocument.load(await deletePages(source, [1, 3]));
    const [p1, p3] = doc.getPages();
    const names = (page: typeof p1, category: string) => page.node.lookup(PDFName.of('Resources'), PDFDict).lookupMaybe(PDFName.of(category), PDFDict)?.keys().map((k) => k.decodeText()).sort() ?? [];
    expect(names(p1, 'Font')).toEqual(['F sp', 'F1', 'T3']);
    expect(names(p1, 'XObject')).toEqual(['IM1', 'XK', 'XR']);
    expect(names(p1, 'ExtGState')).toEqual(['GS1']);
    expect(names(p1, 'ColorSpace')).toEqual(['CS1', 'DefaultRGB']);
    expect(names(p1, 'Pattern')).toEqual(['P1']);
    expect(names(p1, 'Shading')).toEqual([]);
    expect(names(p1, 'Properties')).toEqual(['OC1']);
    expect(names(p3, 'Font')).toEqual(['F1']);
    expect(names(p3, 'XObject')).toEqual([]);
    expect(p1.node.lookup(PDFName.of('Resources'))).not.toBe(p3.node.lookup(PDFName.of('Resources')));
  });

  it('carries the layers of the kept pages, with their default visibility, and no other layer', async () => {
    const result = await extractPages(source, [0, 2]);
    const doc = await PDFDocument.load(result);
    const oc = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    const ocgs = oc.lookup(PDFName.of('OCGs'), PDFArray).asArray().map((r) => doc.context.lookup(r, PDFDict).lookup(PDFName.of('Name')).toString());
    expect(ocgs).toEqual(['(PG1-OCG)']);
    const off = oc.lookup(PDFName.of('D'), PDFDict).lookup(PDFName.of('OFF'), PDFArray).asArray();
    expect(off).toHaveLength(1);
    expect(rawFound(result, ['PG2-OCG'])).toEqual([]);
    // page 3 alone uses no layer: no /OCProperties at all
    expect((await PDFDocument.load(await extractPages(source, [2]))).catalog.has(PDFName.of('OCProperties'))).toBe(false);
  });

  it('a page whose content cannot be read with certainty keeps all its resources, and says so', async () => {
    for (const variant of [{ predictorOnPage1: true }, { nonStreamContentOnPage1: true }]) {
      const odd = await makeSharedResourcesPdf(variant);
      const report: OrganiseReport = {};
      const result = await deletePages(odd, [1, 3], { report });
      expect(report.sharedResourcesKept, JSON.stringify(variant)).toBe(true);
      expect(rawFound(result, SHARED_MARKERS[1])).toEqual(SHARED_MARKERS[1]);
      expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
      // a page that can be read is still trimmed, and not flagged
      const page3: OrganiseReport = {};
      const alone = await extractPages(odd, [2], { report: page3 });
      expect(page3.sharedResourcesKept).toBeFalsy();
      expect(rawFound(alone, [...SHARED_MARKERS[2], ...SHARED_MARKERS[4]])).toEqual([]);
    }
    const predictor = await makeSharedResourcesPdf({ predictorOnPage1: true });
    await expectSameDrawing(await deletePages(predictor, [1, 3]), await renderedPages(predictor), [1, 3], 'predictor');
  });

  it('a name that only appears in a string or in inline image data keeps its resource (an extra keep, never a wrong drop)', async () => {
    const lookalike = await makeNameLookalikePdf();
    const result = await deletePages(lookalike, [1]);
    expect(rawFound(result, ['LOOK-F9', 'LOOK-IMX'])).toEqual(['LOOK-F9', 'LOOK-IMX']);
    expect(rawFound(result, ['LOOK-UNUSED', 'LOOK-P2'])).toEqual([]);
    await expectSameDrawing(result, await renderedPages(lookalike), [1], 'lookalike');
  });
});

describe('a 300-page scan whose pages share one image dictionary', () => {
  it('one page is small, Split every page comes to about the size of the source, in reasonable time', async () => {
    const scan = await makeSharedScan(300, 4000);
    let t = performance.now();
    const one = await extractPages(scan, [149]);
    const oneMs = performance.now() - t;
    expect(one.length).toBeLessThan(50_000);
    expect(rawFound(one, ['SCAN-IMG-150-', 'SCAN-IMG-149-', 'SCAN-IMG-151-'])).toEqual(['SCAN-IMG-150-']);
    t = performance.now();
    const parts = await splitEvery(scan, 1);
    const splitMs = performance.now() - t;
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    expect(parts).toHaveLength(300);
    expect(total, `${total} bytes in ${Math.round(splitMs)} ms (source ${scan.length}, one page ${one.length} bytes in ${Math.round(oneMs)} ms)`).toBeLessThan(scan.length * 1.5);
    expect(splitMs).toBeLessThan(60_000);
  });
});

describe("the re-review's adversarial file", () => {
  const removedIds = (kept: number[]) => ADVERSARIAL_MARKERS.filter((m) => m.page !== 0 && !kept.includes(m.page)).map((m) => m.id);
  const KEPT_EXPECTED = ['PG1-TEXT', 'PG1-XOBJ', 'PG1-FIELDVAL', 'PG1-CITY', 'PG1-REPLY', 'PG1-RADIOAP', 'PG1-THUMB', 'PG1-SIGAP', 'PG1-ORPHVAL', 'PG3-TEXT'];

  for (const objectStreams of [false, true]) {
    it(`no marker of a removed page in any Split or Delete pages result (object streams: ${objectStreams})`, async () => {
      const source = await buildAdversarial({ objectStreams, sd: true });
      const before = source.slice();
      const results: [string, Uint8Array, number[]][] = [
        ['Delete pages 2 and 4', await deletePages(source, [1, 3]), [1, 3]],
        ['Split 1 and 3', await extractPages(source, [0, 2]), [1, 3]],
        ['Split 3, 1, 1', await extractPages(source, [2, 0, 0]), [1, 3]],
        ...(await splitEvery(source, 2)).map((part, i): [string, Uint8Array, number[]] => [`every 2, part ${i + 1}`, part, [2 * i + 1, 2 * i + 2]]),
        ...(await splitEvery(source, 1)).map((part, i): [string, Uint8Array, number[]] => [`every 1, part ${i + 1}`, part, [i + 1]]),
      ];
      for (const [label, result, kept] of results) {
        expect(await leaks(result, removedIds(kept)), label).toEqual({});
        expect(rawFound(result, ['DOC-XMP', 'DOC-THREADTITLE']), label).toEqual([]);
        // every field's /Kids holds only fields and widgets that exist
        const doc = await PDFDocument.load(result);
        for (const [, object] of doc.context.enumerateIndirectObjects()) {
          if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) === PDFName.of('Pages')) continue;
          const kids = object.lookupMaybe(PDFName.of('Kids'), PDFArray);
          for (const kid of kids?.asArray() ?? []) {
            expect(kid, label).toBeInstanceOf(PDFRef);
            expect(doc.context.lookup(kid), label).toBeInstanceOf(PDFDict);
          }
          expect(object.get(PDFName.of('IRT')) === PDFNull, label).toBe(false);
        }
      }
      const deleted = results[0][1];
      expect(rawFound(deleted, KEPT_EXPECTED)).toEqual(KEPT_EXPECTED);
      expect(source).toEqual(before);
    });
  }
});

describe('the drawing check itself', () => {
  it('sees a warning pdf.js gives for a page that names a resource it does not have', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([100, 100]);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('/NoShading sh q 10 0 0 10 0 0 cm /NoImage Do Q')));
    const { warnings } = await renderedPages(await doc.save());
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// The second re-review drew these before and after (its probes wrongdrop.test.ts and wd2.test.ts).
const REDRAW = await redrawCases();

describe("the second re-review's structures: a kept page draws as before, or the result says its resources were kept whole", () => {
  for (const c of REDRAW) {
    it(c.label, async () => {
      const total = (await PDFDocument.load(c.bytes)).getPageCount();
      const removed = Array.from({ length: total }, (_, i) => i).filter((i) => !c.kept.includes(i));
      const split: OrganiseReport = {};
      const deleted: OrganiseReport = {};
      const runs: [string, Uint8Array, OrganiseReport][] = [
        ['Split', await extractPages(c.bytes, c.kept, { report: split }), split],
        ['Delete pages', await deletePages(c.bytes, removed, { report: deleted }), deleted],
      ];
      if (c.expect === 'flagged') {
        for (const [tool, , report] of runs) expect(report.sharedResourcesKept, tool).toBe(true);
        return;
      }
      const drawn = await renderedPages(c.bytes);
      for (const [tool, result, report] of runs) {
        expect(report.sharedResourcesKept, tool).toBeFalsy();
        await expectSameDrawing(result, drawn, [...c.kept].sort((a, b) => a - b).map((i) => i + 1), tool);
        expect(rawFound(result, c.absent), `${tool}: resources no kept page uses`).toEqual([]);
        if (c.keeps) {
          const page = (await PDFDocument.load(result)).getPage(0).node;
          const category = page.lookup(PDFName.of('Resources'), PDFDict).lookupMaybe(PDFName.of(c.keeps.category), PDFDict);
          expect(category?.has(PDFName.of(c.keeps.name)), `${tool}: keeps ${c.keeps.name}`).toBe(true);
        }
      }
    });
  }
});

describe('edges the second re-review found', () => {
  async function twoPlainPages() {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const [p1, p2] = [doc.addPage([300, 400]), doc.addPage([300, 400])];
    const ctx = doc.context;
    const reg = (o: PDFObject) => ctx.register(o);
    const obj = (o: unknown) => ctx.obj(o as never);
    const flate = (content: string | Uint8Array, dict: Record<string, unknown> = {}) => reg(ctx.flateStream(content, dict as never));
    const image = (marker: string) => {
      const bytes = new Uint8Array(64).fill(0x80);
      bytes.set(Buffer.from(marker, 'latin1'));
      return flate(bytes, { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
    };
    return { doc, p1, p2, ctx, reg, obj, flate, image };
  }
  /** Delete page 2, Split page 1, and the first part of Split every page, with their reports. */
  async function results(source: Uint8Array): Promise<[string, Uint8Array, OrganiseReport][]> {
    const deleted: OrganiseReport = {};
    const split: OrganiseReport = {};
    const reports: OrganiseReport[] = [];
    return [
      ['Delete pages', await deletePages(source, [1], { report: deleted }), deleted],
      ['Split', await extractPages(source, [0], { report: split }), split],
      ['Split every page, part 1', (await splitEvery(source, 1, { reports }))[0], reports[0]],
    ];
  }

  it("L1: a left-out page's widget that is only in its field's /Kids is not copied", async () => {
    const b = await twoPlainPages();
    const field = b.ctx.nextRef();
    const ap = (marker: string) => b.flate(`% ${marker}`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 20] });
    const widget = (marker: string, page?: PDFRef) => b.reg(b.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 50, 20], Parent: field, AP: { N: ap(marker) }, ...(page ? { P: page } : {}) }));
    const kept = widget('L1-KEPT-AP', b.p1.ref);
    const kids = [kept, widget('L1-P2-AP', b.p2.ref), widget('L1-NO-PAGE-AP')];
    b.ctx.assign(field, b.obj({ FT: 'Sig', T: PDFString.of('sig'), Kids: kids, V: b.obj({ Type: 'Sig', Name: PDFString.of('signer') }) }));
    b.p1.node.set(PDFName.of('Annots'), b.obj([kept]));
    b.doc.catalog.set(PDFName.of('AcroForm'), b.obj({ Fields: [field], SigFlags: 3 }));
    for (const [tool, result] of await results(await b.doc.save())) {
      expect(await leaks(result, ['L1-P2-AP', 'L1-NO-PAGE-AP']), tool).toEqual({});
      expect(rawFound(result, ['L1-KEPT-AP']), tool).toEqual(['L1-KEPT-AP']);
    }
  });

  it('L2: a layer setting this copy does not know is carried, and the result says so', async () => {
    const make = async (unknownKey: boolean) => {
      const b = await twoPlainPages();
      const [oc1, oc2] = ['L2-LAYER-P1', 'L2-LAYER-P2'].map((n) => b.reg(b.obj({ Type: 'OCG', Name: PDFString.of(n) })));
      const sr = b.reg(b.obj({ Properties: { OC1: oc1, OC2: oc2 } }));
      for (const p of [b.p1, b.p2]) p.node.set(PDFName.of('Resources'), sr);
      b.p1.node.set(PDFName.of('Contents'), b.flate('/OC /OC1 BDC 0 0 10 10 re f EMC'));
      b.p2.node.set(PDFName.of('Contents'), b.flate('/OC /OC2 BDC 0 0 10 10 re f EMC'));
      const config = { Order: [oc1, [PDFString.of('L2-GROUPLABEL-P2'), oc2]], OFF: [oc1], ...(unknownKey ? { XUnknown: [oc2] } : {}) };
      b.doc.catalog.set(PDFName.of('OCProperties'), b.obj({ OCGs: [oc1, oc2], D: config, Configs: [{ Name: PDFString.of('Alt'), ON: [oc2] }] }));
      return b.doc.save();
    };
    for (const [tool, , report] of await results(await make(true))) expect(report.sharedResourcesKept, tool).toBe(true);
    for (const [tool, result, report] of await results(await make(false))) {
      expect(report.sharedResourcesKept, tool).toBeFalsy();
      expect(rawFound(result, ['L2-LAYER-P2', 'L2-GROUPLABEL-P2']), tool).toEqual([]);
      expect(rawFound(result, ['L2-LAYER-P1']), tool).toEqual(['L2-LAYER-P1']);
    }
  });

  it('L3: a resource dictionary entry that is not a standard category keeps the resources whole, and the result says so', async () => {
    const b = await twoPlainPages();
    const sr = b.reg(b.obj({ XObject: { IM1: b.image('L3-IMG-P1') }, XExtra: { IM2: b.image('L3-IMG-P2') } }));
    for (const p of [b.p1, b.p2]) p.node.set(PDFName.of('Resources'), sr);
    b.p1.node.set(PDFName.of('Contents'), b.flate('q 10 0 0 10 0 0 cm /IM1 Do Q'));
    b.p2.node.set(PDFName.of('Contents'), b.flate('q 10 0 0 10 0 0 cm /IM2 Do Q'));
    for (const [tool, , report] of await results(await b.doc.save())) expect(report.sharedResourcesKept, tool).toBe(true);
  });
});

describe('a large file whose pages name one shared image dictionary', () => {
  it('Delete pages reads the shared names once per run, not once per page', async () => {
    const pages = 400;
    const source = await makeSharedScan(pages, 200, { indirect: true });
    const decoded = vi.spyOn(PDFName.prototype, 'decodeText');
    try {
      await deletePages(source, [0]);
      // Before: every page indexed the whole shared dictionary again (pages x pages names).
      expect(decoded.mock.calls.length).toBeLessThan(pages * 30);
    } finally {
      decoded.mockRestore();
    }
  });
});
