// The Organise pages run step (organiseRun.ts, the step contract of toolStep.ts), driven through the
// real Run with the real inspectPdf and organisePages, and its results read back from their bytes with
// pdf.js by page content: order, rotation, where every link, field and bookmark lands, and nothing of a
// removed page left in the raw bytes. A turn-only run is checked to leave the file otherwise as it was.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFObject } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import type { PagePlan } from '@/lib/pdf-tools/pageOrder';
import { summaryWithNotes } from '@/lib/pdf-tools/resultNames';
import { rawFound, rawHaystack } from '@/lib/pdf-tools/testLeakPdf';
import { titleForms } from '@/lib/pdf-tools/testOutlinePdf';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { BUILT, step } from '../organiseRun';
import { Cancelled, Run, Stale, type RunContext, type StepDeps } from '../toolStep';
import { makeOrganiseFixture, readByContent, REMOVED_MARKERS } from './testOrganisePdf';

vi.setConfig({ testTimeout: 90_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);

async function workingFile(bytes: Uint8Array, name = 'Client ledger.pdf'): Promise<WorkingFile> {
  const info = await inspectPdf(bytes);
  return {
    id: 'source-1',
    name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'computer',
    bytes,
    size: bytes.byteLength,
    pageCount: info.pageCount,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: info.hasSignature,
    hasFormFields: info.hasFormFields,
    hasBookmarks: info.hasBookmarks,
    hasPageLinks: info.hasPageLinks,
    sentTo: [],
  };
}

function harness(source: WorkingFile, onProgress?: (done: number, total: number, label?: string) => void) {
  const state = { contextKey: 'engagement-1', session: 7, files: [source], selectedIds: [] as string[] };
  const controller = new AbortController();
  const labels: string[] = [];
  const ctx: RunContext = {
    contextKey: 'engagement-1',
    session: 7,
    store: { getState: () => state, addResults: () => true },
    signal: controller.signal,
    onProgress: (done, total, label) => {
      labels.push(label ?? '');
      onProgress?.(done, total, label);
    },
  };
  let ids = 0;
  const deps: StepDeps = { inspectPdf, paint: async () => {}, yieldToUi: async () => {}, newId: () => `result-${++ids}`, maxBytes: 300 * 1024 * 1024, warnBytes: 150 * 1024 * 1024 };
  return { run: new Run('organise-pages', ctx, deps), controller, labels, state };
}

const plan = (order: number[], turns: PagePlan['turns'] = {}): PagePlan => ({ order, turns });
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof PdfToolsError ? `${error.code}: ${error.message}` : `${(error as Error)?.constructor?.name}`),
  );

let fixture: Uint8Array;
let source: WorkingFile;
beforeAll(async () => {
  fixture = await makeOrganiseFixture();
  source = await workingFile(fixture);
}, 60_000);

it('is built', () => {
  expect(BUILT).toBe(true);
});

describe('the fixture (self-check)', () => {
  it('reads back as written, and holds every removed-page marker', async () => {
    const view = await readByContent(fixture);
    expect(view.pages.map((p) => p.text)).toEqual(['Org p1', 'Org p2', 'Org p3', 'Org p4', 'Org p5']);
    expect(view.pages.map((p) => p.links)).toEqual([['Org p4', 'Org p4'], ['Org p5'], [], ['Org p3'], ['Org p2']]);
    expect(view.pages[2].urls).toEqual(['https://example.invalid/MKREMOVEDLINKURI']);
    expect(view.pages[1].fields).toEqual({ fieldP2: 'Value on page 2', shared: 'Shared value' });
    expect(view.outline).toEqual([
      [0, 'Part A', 'Org p1'],
      [1, 'A.1', 'Org p2'],
      [1, 'MKREMOVEDBOOKMARK', 'Org p3'],
      [2, 'A.2.i', 'Org p4'],
      [0, 'Part B', 'Org p5'],
    ]);
    expect(view.labels).toEqual(['i', 'ii', '1', '2', '3']);
    expect(rawFound(fixture, REMOVED_MARKERS)).toEqual([...REMOVED_MARKERS]);
    expect(source).toMatchObject({ pageCount: 5, hasFormFields: true, hasBookmarks: true, hasPageLinks: true, hasSignature: false });
  });
});

describe('a mixed run: order 5, 1, 4, 2 with page 3 removed, page 5 turned 90 and page 4 turned 270', () => {
  let made: Awaited<ReturnType<typeof step>>;
  let result: WorkingFile;
  let labels: string[];
  beforeAll(async () => {
    const h = harness(source);
    made = await step(h.run, [source], { plan: plan([4, 0, 3, 1], { 4: 90, 3: 270, 2: 90 }), name: '' });
    result = made.files[0];
    labels = h.labels;
  }, 90_000);

  it('makes one result named <name>_organised.pdf, with the activity summary and metadata of design 5.15', () => {
    expect(made.files).toHaveLength(1);
    expect(result).toMatchObject({ name: 'Client ledger_organised.pdf', kind: 'pdf', pageCount: 4, origin: 'result', hasSignature: false });
    expect(result.operation).toMatchObject({
      tool: 'organise-pages',
      // the shared wording of the flag (resultNames.ts FLAG_NOTES) ends the line
      summary: summaryWithNotes('Organised pages: 2 moved, 2 rotated, 1 removed', { bookmarksDropped: true }),
      options: { order: '5, 1, 4, 2', moved: 2, turned: 2, removed: '3', method: 'page-copy' },
      flags: { bookmarksDropped: true },
    });
    expect(made.describe([result])).toEqual({ message: 'Made Client ledger_organised.pdf', detail: '2 moved, 2 rotated, 1 removed. 4 pages. 1 bookmark was not carried.' });
  });

  it('shows page-by-page progress while copying', () => {
    expect(labels[0]).toBe('Organising the pages…');
    expect(labels).toContain('Copying the pages (1 of 4)…');
    expect(labels).toContain('Checking every page against the original…');
  });

  it('pages in the new order, turned as asked (the turn on the removed page has no effect)', async () => {
    const view = await readByContent(result.bytes);
    expect(view.pages.map((p) => p.text)).toEqual(['Org p5', 'Org p1', 'Org p4', 'Org p2']);
    expect(view.pages.map((p) => p.rotate)).toEqual([90, 0, 270, 0]);
  });

  it('every kept link lands on the same page content as before; the link to the removed page is gone', async () => {
    const view = await readByContent(result.bytes);
    const linksOf = (text: string) => view.pages.find((p) => p.text === text)!.links;
    expect(linksOf('Org p1')).toEqual(['Org p4', 'Org p4']);
    expect(linksOf('Org p2')).toEqual(['Org p5']);
    expect(linksOf('Org p4')).toEqual([]);
    expect(linksOf('Org p5')).toEqual(['Org p2']);
  });

  it('every field stays on the same page content with its value; the removed page’s field is gone', async () => {
    const view = await readByContent(result.bytes);
    const fieldsOf = (text: string) => view.pages.find((p) => p.text === text)!.fields;
    expect(fieldsOf('Org p1')).toEqual({ fieldP1: 'Value on page 1' });
    expect(fieldsOf('Org p2')).toEqual({ fieldP2: 'Value on page 2', shared: 'Shared value' });
    expect(fieldsOf('Org p4')).toEqual({ fieldP4: 'Value on page 4', shared: 'Shared value' });
    expect(fieldsOf('Org p5')).toEqual({ fieldP5: 'Value on page 5' });
  });

  it('bookmarks keep their own order and open the same page content; the removed page’s bookmark is dropped and its child moves up', async () => {
    const view = await readByContent(result.bytes);
    expect(view.outline).toEqual([
      [0, 'Part A', 'Org p1'],
      [1, 'A.1', 'Org p2'],
      [1, 'A.2.i', 'Org p4'],
      [0, 'Part B', 'Org p5'],
    ]);
  });

  it('page labels stay with their pages (pageOrder.ts review fix round 1)', async () => {
    expect((await readByContent(result.bytes)).labels).toEqual(['3', 'i', '2', 'ii']);
  });

  it('nothing of the removed page is in the raw bytes (streams inflated, hex decoded, UTF-16 forms)', () => {
    expect(rawFound(result.bytes, REMOVED_MARKERS)).toEqual([]);
    const raw = Buffer.from(result.bytes).toString('latin1');
    const hay = rawHaystack(result.bytes);
    for (const marker of REMOVED_MARKERS) for (const form of titleForms(marker)) expect(raw.includes(form) || hay.includes(form), `${marker} as ${JSON.stringify(form)}`).toBe(false);
  });

  it('leaves the source unchanged', async () => {
    expect(Buffer.from(source.bytes).equals(Buffer.from(fixture))).toBe(true);
  });
});

/** The object numbers reachable from the trailer's /Root and /Info (an unreferenced object is not part of the file as read). */
function reachable(doc: PDFDocument): Set<number> {
  const seen = new Set<number>();
  const stack: PDFObject[] = [doc.context.trailerInfo.Root, doc.context.trailerInfo.Info].filter((x): x is PDFObject => Boolean(x));
  while (stack.length > 0) {
    const object = stack.pop()!;
    if (object instanceof PDFRef) {
      if (seen.has(object.objectNumber)) continue;
      seen.add(object.objectNumber);
      const target = doc.context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFDict) stack.push(...object.values());
    else if (object instanceof PDFArray) stack.push(...object.asArray());
    else if (object instanceof PDFStream) stack.push(...object.dict.values());
  }
  return seen;
}

/** Every reachable object of a file as text, streams decoded, by object number; a page's /Rotate left out. */
async function objectsOf(bytes: Uint8Array): Promise<Map<number, string>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const kept = reachable(doc);
  const out = new Map<number, string>();
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!kept.has(ref.objectNumber)) continue;
    let text = object instanceof PDFRawStream ? `${object.dict.toString()}\n${Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')}` : object.toString();
    if (object instanceof PDFDict && object.get(PDFName.of('Type'))?.toString() === '/Page') text = text.replace(/\n?\/Rotate -?\d+/g, '');
    out.set(ref.objectNumber, text);
  }
  return out;
}

describe('a turn-only run (pages 2 and 5 turned)', () => {
  let result: WorkingFile;
  beforeAll(async () => {
    const h = harness(source);
    result = (await step(h.run, [source], { plan: plan([0, 1, 2, 3, 4], { 1: 90, 4: 180 }) })).files[0];
  }, 90_000);

  it('is made in place: summary, metadata and no flag', () => {
    expect(result.pageCount).toBe(5);
    expect(result.operation).toMatchObject({ summary: 'Organised pages: 2 rotated', options: { order: '1-5', moved: 0, turned: 2, removed: '', method: 'in-place' } });
    expect(result.operation?.flags).toBeUndefined();
  });

  it('leaves the file otherwise identical: the same reachable objects, each the same except /Rotate on the turned pages and the document information', async () => {
    const before = await objectsOf(fixture);
    const after = await objectsOf(result.bytes);
    expect([...after.keys()].sort((a, b) => a - b)).toEqual([...before.keys()].sort((a, b) => a - b));
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const info = (doc.context.trailerInfo.Info as PDFRef).objectNumber;
    const changed = [...before.keys()].filter((n) => before.get(n) !== after.get(n));
    expect(changed).toEqual([info]);
    const rotations = doc.getPages().map((page) => page.node.get(PDFName.of('Rotate'))?.toString() ?? 'none');
    expect(rotations).toEqual(['none', '90', 'none', 'none', '180']);
  });

  it('keeps bookmarks, links, fields and labels exactly; only the rotations differ', async () => {
    const was = await readByContent(fixture);
    const now = await readByContent(result.bytes);
    expect(now.outline).toEqual(was.outline);
    expect(now.labels).toEqual(was.labels);
    expect(now.pages.map(({ rotate: _rotate, ...rest }) => rest)).toEqual(was.pages.map(({ rotate: _rotate, ...rest }) => rest));
    expect(now.pages.map((p) => p.rotate)).toEqual([0, 90, 0, 0, 180]);
  });
});

describe('pages that already show a rotation (review S3): the rotation is added to what the page shows', () => {
  let rotated: WorkingFile;
  beforeAll(async () => {
    // the page tree's root rotates every page 90 (inherited); page 2 has its own /Rotate 270
    const doc = await PDFDocument.load(fixture, { updateMetadata: false });
    doc.catalog.lookup(PDFName.of('Pages'), PDFDict).set(PDFName.of('Rotate'), doc.context.obj(90));
    doc.getPage(1).node.set(PDFName.of('Rotate'), doc.context.obj(270));
    rotated = await workingFile(await doc.save());
    expect((await readByContent(rotated.bytes)).pages.map((p) => p.rotate)).toEqual([90, 270, 90, 90, 90]); // self-check
  }, 60_000);

  it('moved: page 2 (own 270) rotated right shows 0; page 3 (inherited 90) rotated 180 shows 270; the others keep 90', async () => {
    const made = await step(harness(rotated).run, [rotated], { plan: plan([1, 0, 2, 3, 4], { 1: 90, 2: 180 }) });
    const view = await readByContent(made.files[0].bytes);
    expect(view.pages.map((p) => [p.text, p.rotate])).toEqual([['Org p2', 0], ['Org p1', 90], ['Org p3', 270], ['Org p4', 90], ['Org p5', 90]]);
  });

  it('in place: the same sums', async () => {
    const made = await step(harness(rotated).run, [rotated], { plan: plan([0, 1, 2, 3, 4], { 1: 90, 2: 180 }) });
    expect((await readByContent(made.files[0].bytes)).pages.map((p) => p.rotate)).toEqual([90, 0, 270, 90, 90]);
  });
});

describe('document parts a move does not carry', () => {
  it('are said in the message (the library’s own sentences) and listed in the record, by kind only', async () => {
    const doc = await PDFDocument.load(fixture, { updateMetadata: false });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.flateStream('<x:xmpmeta>MK-XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
    doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(doc.context.obj({ Type: 'StructTreeRoot', K: [] })));
    const withParts = await workingFile(await doc.save());
    const made = await step(harness(withParts).run, [withParts], { plan: plan([1, 0, 2, 3, 4]) });
    const result = made.files[0];
    expect(result.operation?.options).toMatchObject({ notCarried: 'xmp-metadata, accessibility-tags' });
    expect(result.operation?.summary).toBe('Organised pages: 1 moved; Not kept when pages are moved or removed: XMP metadata, accessibility tags');
    expect(made.describe([result]).detail).toBe('1 moved. 5 pages. Not kept when pages are moved or removed: XMP metadata, accessibility tags.');
    expect(JSON.stringify(result.operation)).not.toContain('MK-XMP');
  });

  it('a turn-only run keeps them and says nothing more', async () => {
    const doc = await PDFDocument.load(fixture, { updateMetadata: false });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.flateStream('<x:xmpmeta>MK-XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
    const withParts = await workingFile(await doc.save());
    const made = await step(harness(withParts).run, [withParts], { plan: plan([0, 1, 2, 3, 4], { 3: 90 }) });
    expect(made.files[0].operation?.options).not.toHaveProperty('notCarried');
    expect(made.describe(made.files).detail).toBe('1 rotated. 5 pages.');
    expect(rawFound(made.files[0].bytes, ['MK-XMP'])).toEqual(['MK-XMP']);
  });
});

describe('signed sources', () => {
  it('a move: the result says "signature no longer valid"', async () => {
    const signed = await workingFile(await makeOrganiseFixture({ signature: true }));
    expect(signed.hasSignature).toBe(true);
    const made = await step(harness(signed).run, [signed], { plan: plan([1, 0, 2, 3, 4]) });
    expect(made.files[0]).toMatchObject({ signatureInvalid: true, hasSignature: false });
    expect(made.files[0].operation?.summary).toBe('Organised pages: 1 moved; signature no longer valid');
  });
  it('a turn: the same', async () => {
    const signed = await workingFile(await makeOrganiseFixture({ signature: true }));
    const made = await step(harness(signed).run, [signed], { plan: plan([0, 1, 2, 3, 4], { 0: 90 }) });
    expect(made.files[0]).toMatchObject({ signatureInvalid: true });
    expect(made.files[0].operation?.summary).toBe('Organised pages: 1 rotated; signature no longer valid');
  });
});

describe('refusals and nothing to do', () => {
  it('removing every page, a page twice, a page outside the file, a 45° turn, a broken plan, two inputs', async () => {
    expect(await codeOf(step(harness(source).run, [source], { plan: plan([]) }))).toBe('organise-all-removed: You cannot remove every page. Keep at least one.');
    expect(await codeOf(step(harness(source).run, [source], { plan: plan([0, 0, 1]) }))).toMatch(/^duplicate-page: /);
    expect(await codeOf(step(harness(source).run, [source], { plan: plan([0, 9]) }))).toBe("invalid-page-list: Page 10 is outside this file's 5 pages.");
    expect(await codeOf(step(harness(source).run, [source], { plan: plan([0, 1], { 0: 45 as never }) }))).toMatch(/^invalid-rotation: /);
    expect(await codeOf(step(harness(source).run, [source], { plan: { order: 'all' } as never }))).toMatch(/^invalid-page-list: /);
    expect(await codeOf(step(harness(source).run, [source], {} as never))).toMatch(/^invalid-page-list: /);
    expect(await codeOf(step(harness(source).run, [source, source], { plan: plan([1, 0]) }))).toBe('wrong-input: Choose exactly one PDF.');
  });
  it('the file as it is: nothing made, and says so', async () => {
    const made = await step(harness(source).run, [source], { plan: plan([0, 1, 2, 3, 4], { 2: 0 }) });
    expect(made.files).toEqual([]);
    expect(made.describe([])).toEqual({ message: 'Nothing to change', detail: 'The pages are already in this order, and none is rotated or removed. Nothing was added.' });
  });
});

describe('stopping and the list moving on', () => {
  let long: WorkingFile;
  beforeAll(async () => {
    long = await workingFile(await makeOrganiseFixture({ pages: 60 }));
  }, 60_000);

  it('Stop during the copy stops between pages (Cancelled), nothing is made', async () => {
    const h: ReturnType<typeof harness> = harness(long, (done) => {
      if (done >= 3) h.controller.abort();
    });
    const order = Array.from({ length: 60 }, (_, i) => 59 - i);
    await expect(step(h.run, [long], { plan: plan(order) })).rejects.toBeInstanceOf(Cancelled);
  });

  it('an engagement change during the copy ends the run without a word (Stale)', async () => {
    const h: ReturnType<typeof harness> = harness(long, (done) => {
      if (done >= 3) h.state.session = 8;
    });
    await expect(step(h.run, [long], { plan: plan(Array.from({ length: 60 }, (_, i) => 59 - i)) })).rejects.toBeInstanceOf(Stale);
  });
});
