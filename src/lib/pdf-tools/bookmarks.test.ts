import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyBookmarks, readBookmarks } from './bookmarks';
import { cleanTitle, readOutline, type OutlineItem } from './outline';
import { rawHaystack } from './testLeakPdf';
import { baseDoc, buildOutline, dictAt, fit, HINDI_TITLE, makeOutlinePdf, pdfjsOutline, titleForms, utf16be } from './testOutlinePdf';
import { makeFormPdf, makePdf, pageTexts, pdfjsFieldValues } from './testPdf';

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

describe('readBookmarks', () => {
  it('reads the trial outline file: editable, with the script and no-page items counted as not carried', async () => {
    const file = await readBookmarks(await makeOutlinePdf());
    expect(file.editable).toBe(true);
    expect(file.items).toHaveLength(5);
    expect(file.notCarried).toBe(1); // the script; the web address and the page number are carried
    expect(file.problems.cycles).toBe(0);
  });
  it('a file with no bookmarks reads as empty and editable', async () => {
    expect(await readBookmarks(await makePdf('N', 2))).toMatchObject({ items: [], editable: true, notCarried: 0 });
  });
  it('a file over the limits is not editable (50,000 bookmarks)', async () => {
    const { doc } = await baseDoc(1);
    buildOutline(doc, Array.from({ length: 50_000 }, (_, i) => ({ title: `Bookmark ${i + 1}`, dest: fit(doc, 0) })));
    const file = await readBookmarks(await doc.save());
    expect(file.editable).toBe(false);
    expect(file.problems.truncatedNodes).toBe(true);
  });
  it('refuses what is not a PDF', async () => {
    await expect(readBookmarks(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'not-a-pdf' });
  });
});

describe('applyBookmarks', () => {
  it('writes an edited tree: one renamed, one added; pdf.js reads the new tree and the old title is gone from the bytes', async () => {
    const source = await makeOutlinePdf();
    const { items } = await readBookmarks(source);
    const edited: OutlineItem[] = structuredClone(items);
    edited[0].title = 'Chapter one, renamed';
    edited.push({ title: 'Added at the end', page: 5, open: false, children: [], view: { kind: 'XYZ', args: [0, 400, null] } });
    const result = await applyBookmarks(source, edited);
    expect(await pdfjsOutline(result)).toEqual([
      [0, 'Chapter one, renamed', 0],
      [1, '1.1 करदाता (Hindi)', 1],
      [1, '1.2 Named, by GoTo', 2],
      [2, '1.2.1 Deep, old Dests', 5],
      [0, '2 Web link', null],
      [0, '4 Page five', 4],
      [0, '5 Page index as a number', 3],
      [0, 'Added at the end', 5],
    ]);
    // the script bookmark was "not carried" and is not saved; neither is its action
    const haystack = rawHaystack(result);
    expect(haystack.includes('app.alert')).toBe(false);
    for (const form of titleForms('1 Introduction')) expect(haystack.toLowerCase().includes(form.toLowerCase()), form).toBe(false);
    for (const form of titleForms('3 Script')) expect(haystack.toLowerCase().includes(form.toLowerCase()), form).toBe(false);
    expect((await PDFDocument.load(result, { updateMetadata: false })).getProducer()).toBe('ICAI VERA');
    expect(await pageTexts(result)).toEqual(await pageTexts(source));
  });

  it('the old titles of a file are in the source (control) and not in the result of deleting them all', async () => {
    const source = await makeOutlinePdf();
    const before = rawHaystack(source).toLowerCase();
    expect(before.includes('1 introduction')).toBe(true);
    const result = await applyBookmarks(source, []);
    expect((await PDFDocument.load(result)).catalog.has(PDFName.of('Outlines'))).toBe(false);
    const after = rawHaystack(result).toLowerCase();
    for (const title of ['1 Introduction', '1.1', 'Named, by GoTo', 'Deep, old Dests', '2 Web link', 'Page five', 'Page index as a number', 'example.in']) {
      for (const form of titleForms(title)) expect(after.includes(form.toLowerCase()), `${title}`).toBe(false);
    }
  });

  it('keeps the page count, the page texts and the form values of a form file', async () => {
    const source = await makeFormPdf({ bookmarks: true });
    const { items } = await readBookmarks(source);
    const result = await applyBookmarks(source, [{ ...items[0], title: 'First page' }, items[2]]);
    expect(await pageTexts(result)).toEqual(await pageTexts(source));
    expect(await pdfjsFieldValues(result)).toEqual(await pdfjsFieldValues(source));
    expect((await pdfjsOutline(result)).map(([, t]) => t)).toEqual(['First page', 'Page 3']);
    expect((await PDFDocument.load(result)).getPageCount()).toBe(3);
  });

  it('a Hindi title with a zero-width joiner, a rupee sign and an emoji round-trips', async () => {
    const source = await makePdf('H', 2);
    const title = `क्\u200dष ${HINDI_TITLE}`;
    const result = await applyBookmarks(source, [{ title, page: 1, open: false, children: [] }]);
    const read = await readBookmarks(result);
    expect(read.items[0].title).toBe(cleanTitle(title));
    expect(read.items[0].title).toContain('\u200d');
    expect(read.items[0].page).toBe(1);
    expect((await pdfjsOutline(result))[0][1]).toBe(cleanTitle(title));
  });

  it('opens the bookmark panel when there are bookmarks', async () => {
    const result = await applyBookmarks(await makePdf('H', 2), [{ title: 'x', page: 0, open: false, children: [] }]);
    expect((await PDFDocument.load(result)).catalog.get(PDFName.of('PageMode'))).toBe(PDFName.of('UseOutlines'));
  });

  it('refuses an empty title and a page the file does not have, changing nothing', async () => {
    const source = await makePdf('H', 2);
    await expect(applyBookmarks(source, [{ title: ' \u200b ', page: 0, open: false, children: [] }])).rejects.toMatchObject({ code: 'bookmark-title-invalid', message: expect.stringContaining('A bookmark needs a title.') });
    await expect(applyBookmarks(source, [{ title: 'x', page: 2, open: false, children: [] }])).rejects.toMatchObject({ code: 'invalid-bookmarks' });
  });

  it('refuses a file over the limits, so nothing is lost', async () => {
    const { doc } = await baseDoc(1);
    buildOutline(doc, Array.from({ length: 10_001 }, (_, i) => ({ title: `B${i}`, dest: fit(doc, 0) })));
    await expect(applyBookmarks(await doc.save(), [{ title: 'x', page: 0, open: false, children: [] }])).rejects.toMatchObject({
      code: 'bookmarks-not-editable',
      message: 'This file has more bookmarks, or deeper levels, than PDF Tools can edit (10,000 bookmarks, 32 levels). Nothing was changed.',
    });
  });

  it('a signed file keeps its signature dictionary but its bytes change (the tool warns)', async () => {
    const source = await makeFormPdf({ signature: true, bookmarks: true });
    const result = await applyBookmarks(source, readOutline(await PDFDocument.load(source)).items);
    expect(result).not.toEqual(source);
    expect(rawHaystack(result).includes('/ByteRange')).toBe(true);
  });
});

describe('fix round 1: what a save keeps of the file own bookmarks', () => {
  it('a 500-character title the user did not touch survives a save unchanged', async () => {
    const { doc } = await baseDoc(2);
    const long = `${'abcdefghi '.repeat(50)}end`.slice(0, 500).trim();
    buildOutline(doc, [{ title: long, dest: fit(doc, 0) }, { title: 'other', dest: fit(doc, 1) }]);
    const source = await doc.save();
    const { items } = await readBookmarks(source);
    expect(items[0].title.length).toBeGreaterThan(256);
    const result = await applyBookmarks(source, items);
    expect((await readBookmarks(result)).items[0].title).toBe(items[0].title);
  });

  it('an untitled bookmark of the file can be saved as it is; a title the user left empty is refused and named by position', async () => {
    const { doc } = await baseDoc(2);
    buildOutline(doc, [{ title: 'first', dest: fit(doc, 0) }, { title: '', dest: fit(doc, 1) }]);
    const source = await doc.save();
    const { items } = await readBookmarks(source);
    expect(items[1]).toMatchObject({ title: '', untitled: true });
    const result = await applyBookmarks(source, items);
    expect((await readBookmarks(result)).items.map((i) => i.title)).toEqual(['first', '']);
    const edited = [items[0], { ...items[1], untitled: undefined }];
    await expect(applyBookmarks(source, edited)).rejects.toMatchObject({ code: 'bookmark-title-invalid', message: expect.stringContaining('Bookmark 2') });
  });
});

describe('fix round 1: the objects of a deleted bookmark leave the bytes', () => {
  const SECRETS = ['SECRETURL', 'SECRETFILE', 'SECRETJS', 'SECRETJSSTREAM', 'SECRETNAMEDDEST', 'SECRETHEXURL', 'SECRETUTF16FILE'];
  const asHex = (text: string) => PDFHexString.of(Buffer.from(text, 'latin1').toString('hex'));

  async function source(): Promise<Uint8Array> {
    const { doc } = await baseDoc(3);
    const ctx = doc.context;
    const ref = (o: Parameters<typeof ctx.register>[0]) => ctx.register(o);
    const urlAction = ref(ctx.obj({ S: 'URI', URI: PDFString.of('https://SECRETURL.example/') }));
    const hexUrlAction = ref(ctx.obj({ S: 'URI', URI: asHex('https://SECRETHEXURL.example/') }));
    const fileAction = ref(ctx.obj({ S: 'GoToR', F: PDFString.of('SECRETFILE.pdf'), D: [0, 'Fit'] }));
    const utf16File = ref(ctx.obj({ S: 'GoToR', F: utf16be('SECRETUTF16FILE'), D: [0, 'Fit'] }));
    const jsAction = ref(ctx.obj({ S: 'JavaScript', JS: PDFString.of('SECRETJS()') }));
    const jsStream = ref(ctx.flateStream('SECRETJSSTREAM()'));
    const jsStreamAction = ref(ctx.obj({ S: 'JavaScript', JS: jsStream }));
    const namedAction = ref(ctx.obj({ S: 'GoTo', D: PDFString.of('SECRETNAMEDDEST') }));
    const indirectDest = ref(ctx.obj([doc.getPage(2).ref, 'Fit']));
    buildOutline(doc, [
      { title: 'keeper', dest: fit(doc, 0) },
      { title: 'u', action: urlAction },
      { title: 'h', action: hexUrlAction },
      { title: 'f', action: fileAction },
      { title: 'f16', action: utf16File },
      { title: 'j', action: jsAction },
      { title: 'js', action: jsStreamAction },
      { title: 'n', action: namedAction },
      { title: 'd', dest: indirectDest },
    ]);
    return doc.save({ useObjectStreams: false });
  }
  const found = (bytes: Uint8Array, secret: string) => {
    const hay = rawHaystack(bytes).toLowerCase();
    return titleForms(secret).some((form) => hay.includes(form.toLowerCase()));
  };

  it('the secrets are in the source, and in no form in the result of deleting their bookmarks', async () => {
    const bytes = await source();
    for (const secret of SECRETS) expect(found(bytes, secret), `source ${secret}`).toBe(true);
    const { items } = await readBookmarks(bytes);
    const result = await applyBookmarks(bytes, [items[0]]);
    for (const secret of SECRETS) expect(found(result, secret), `result ${secret}`).toBe(false);
    expect(await pageTexts(result)).toEqual(['P p1', 'P p2', 'P p3']);
  });

  it('an action that something else still uses stays, and so do named destinations', async () => {
    const { doc } = await baseDoc(2);
    const shared = doc.context.register(doc.context.obj({ S: 'URI', URI: PDFString.of('https://SHAREDURL.example/') }));
    doc.getPage(0).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: shared })));
    doc.catalog.set(PDFName.of('Dests'), doc.context.obj({ SHAREDNAME: fit(doc, 1) }));
    buildOutline(doc, [{ title: 'shared', action: shared }, { title: 'by name', dest: PDFName.of('SHAREDNAME') }]);
    const bytes = await doc.save({ useObjectStreams: false });
    const result = await applyBookmarks(bytes, []);
    expect(found(result, 'SHAREDURL')).toBe(true);
    expect(found(result, 'SHAREDNAME')).toBe(true);
    const link = (await PDFDocument.load(result)).getPage(0).node.Annots()!.lookup(0, PDFDict);
    expect(link.lookup(PDFName.of('A'), PDFDict).get(PDFName.of('S'))).toBe(PDFName.of('URI'));
  });
});

describe('fix round 1: a web address is written back exactly as read', () => {
  it('keeps a space, %20 and non-ASCII bytes, through a save and through Split', async () => {
    const { doc } = await baseDoc(2);
    const bytes = [...Buffer.from('https://höst.example/a b%20c/', 'utf8')];
    buildOutline(doc, [{ title: 'web', action: doc.context.obj({ S: 'URI', URI: PDFHexString.of(bytes.map((b) => b.toString(16).padStart(2, '0')).join('')) }) }]);
    const source = await doc.save();
    const read = await readBookmarks(source);
    const original = read.items[0].uri!;
    expect(original).toContain(' ');
    expect(original).toContain('%20');
    expect(original.length).toBe(bytes.length);
    expect((await readBookmarks(await applyBookmarks(source, read.items))).items[0].uri).toBe(original);
    expect((await readBookmarks(await (await import('./organise')).extractPages(source, [0, 1]))).items[0].uri).toBe(original);
  });
});

describe('saving bookmarks into a long text file (user QA 2.18: 38 s for 320 pages on a busy machine)', () => {
  it('reads and writes without waiting for a timer every 50 or 100 objects', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 300; i++) doc.addPage([300, 400]).drawText(`Ledger page ${i + 1}`, { x: 20, y: 380, size: 10 });
    const source = await doc.save({ useObjectStreams: false });
    // The reads and writes wait by the clock (pace.ts, at least every 50 ms of work), which a busy machine
    // stretches; with the clock standing still only waits counted in objects are left (INT3).
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      const saved = await applyBookmarks(source, [{ title: 'Cash in hand', page: 0, children: [] }, { title: 'Bank accounts', page: 32, children: [] }] as OutlineItem[]);
      expect((await readBookmarks(saved)).items.map((i) => i.title)).toEqual(['Cash in hand', 'Bank accounts']);
      // About 1,200 objects: pdf-lib's defaults waited about 12 times to read and 24 to write, each time again to read back.
      expect(timers.mock.calls.length).toBeLessThan(10);
    } finally {
      timers.mockRestore();
      clock.mockRestore();
    }
  });
});

// REV-A B5 (15 November 2026): saving deletes only the old outline's own objects.
describe('REV-A B5: saving bookmarks never deletes what is not the outline’s own', () => {
  const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  function rawPdf(objects: string[]): Uint8Array {
    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return enc(out);
  }
  /** REV-A's file: the only bookmark's /Next runs into the page's own resource dictionary (object 5). */
  const intoResources = () =>
    rawPdf([
      '<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources 5 0 R >>',
      '<< /Length 44 >>\nstream\nBT /F1 24 Tf 100 700 Td (Hello World) Tj ET\nendstream',
      '<< /Font << /F1 8 0 R >> >>',
      '<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>',
      '<< /Title (Chapter 1) /Parent 6 0 R /Dest [3 0 R /Fit] /Next 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]);
  const resourcesOf = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    return doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Resources')));
  };

  it('the page keeps its resources and its text when the outline runs into them; the old title is gone', async () => {
    const src = intoResources();
    const read = await readBookmarks(src);
    const items = read.items.map((item) => (item.title === 'Chapter 1' ? { ...item, title: 'Renamed' } : item));
    const report: { oldBookmarksKept?: number } = {};
    const out = await applyBookmarks(src, items, { report });
    expect(await resourcesOf(out)).toBeInstanceOf(PDFDict);
    expect((await pageTexts(out))[0]).toContain('Hello World');
    expect(rawHaystack(out)).not.toContain('Chapter 1');
    expect((await readBookmarks(out)).items.map((item) => item.title)).toEqual(['Renamed']);
    expect(report.oldBookmarksKept).toBe(0); // the resources are not a bookmark: nothing old to warn about
  });

  it('variation: an item reached through /Prev that names the root as parent but is the document information is kept', async () => {
    const { doc } = await baseDoc(1);
    const info = doc.context.register(doc.context.obj({ Title: PDFString.of('Annual accounts'), Parent: doc.context.nextRef() }));
    doc.context.trailerInfo.Info = info;
    const { root, items } = buildOutline(doc, [{ title: 'Old one', dest: fit(doc, 0) }]);
    dictAt(doc, info).set(PDFName.of('Parent'), root);
    dictAt(doc, items[0]).set(PDFName.of('Prev'), info);
    const src = await doc.save();
    const report: { oldBookmarksKept?: number } = {};
    const out = await applyBookmarks(src, [{ title: 'New one', page: 0, open: false, children: [] }], { report });
    const saved = await PDFDocument.load(out, { updateMetadata: false });
    expect(saved.getTitle()).toBe('Annual accounts');
    // The information dictionary still names the old root as its parent, so the old outline stays whole
    // (unlinked), and both titled objects are counted: kept and said, never silent.
    expect(report.oldBookmarksKept).toBe(2);
    expect((await readBookmarks(out)).items.map((item) => item.title)).toEqual(['New one']);
  });

  it('variation: a title shared with a comment stays for the comment; a bookmark with no parent stays and is counted', async () => {
    const { doc } = await baseDoc(1);
    const shared = doc.context.register(PDFString.of('Shared words'));
    const { items } = buildOutline(doc, [{ title: shared, dest: fit(doc, 0) }, { title: 'Orphan title', dest: fit(doc, 0) }]);
    const note = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: shared }));
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([note]));
    dictAt(doc, items[1]).delete(PDFName.of('Parent'));
    const report: { oldBookmarksKept?: number } = {};
    const out = await applyBookmarks(await doc.save({ useObjectStreams: false }), [{ title: 'Only', page: 0, open: false, children: [] }], { report });
    const saved = await PDFDocument.load(out);
    const annot = saved.context.lookup((saved.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)).get(0), PDFDict);
    expect((saved.context.lookup(annot.get(PDFName.of('Contents'))) as PDFString).decodeText()).toBe('Shared words');
    expect(rawHaystack(out)).toContain('Orphan title'); // not provably the outline's: kept, unlinked
    // The orphan still names its neighbour (/Prev), so that one stays too: two old bookmarks, both counted.
    expect(report.oldBookmarksKept).toBe(2);
    expect((await readBookmarks(out)).items.map((item) => item.title)).toEqual(['Only']);
  });

  it('a healthy outline is deleted whole and nothing is reported', async () => {
    const report: { oldBookmarksKept?: number } = {};
    const src = await makeOutlinePdf();
    const before = await readBookmarks(src);
    const out = await applyBookmarks(src, before.items.map((item) => ({ ...item, title: `${item.title} (new)` })), { report });
    expect(report.oldBookmarksKept).toBe(0);
    const hay = rawHaystack(out);
    expect(hay).not.toContain('1 Introduction)');
    expect((await readBookmarks(out)).items[0].title).toBe('1 Introduction (new)');
  });
});

// FIX-A2 follow-up (INT3 concern 1): a Stop pressed while the file is still being read ends the run within the
// read, with the run's own error, never "could not be read".
describe('Bookmarks: Stop while the file is read', () => {
  class Stopped extends Error {}
  it('stops with the run’s own error, saving and reading back', async () => {
    let clock = 0;
    // A clock that runs 60 ms between two looks at it: every look finds a turn due, so the read waits often.
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60));
    try {
      const file = await makeOutlinePdf();
      const stop = new Stopped('bookmarks');
      const thrower = () => { throw stop; };
      expect(await applyBookmarks(file, [{ title: 'A', page: 0, open: false, children: [] }], { check: thrower }).catch((e: unknown) => e)).toBe(stop);
      expect(await readBookmarks(file, { check: thrower }).catch((e: unknown) => e)).toBe(stop);
    } finally {
      spy.mockRestore();
    }
  });
});
