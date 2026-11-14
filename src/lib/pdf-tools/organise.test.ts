import { PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFName, PDFRef, PDFSignature, PDFTextField } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from './inspect';
import { deletePages, extractPages, mergePdfs, splitEvery } from './organise';
import { danglingReferences, everythingIn, makeFormPdf, makePdf, pageTexts, pdfjsDrawnFieldText, pdfjsFieldValues } from './testPdf';

// The first pdfjs import is slow and the suite runs alongside others, so pay for it here, with room to spare.
vi.setConfig({ testTimeout: 30_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 30_000);

describe('organise', () => {
  it('merges in the order given', async () => {
    const a = await makePdf('A', 2);
    const b = await makePdf('B', 3);
    expect(await pageTexts(await mergePdfs([a, b]))).toEqual(['A p1', 'A p2', 'B p1', 'B p2', 'B p3']);
    expect(await pageTexts(await mergePdfs([b, a]))).toEqual(['B p1', 'B p2', 'B p3', 'A p1', 'A p2']);
  });
  it('keeps both copies of the same file supplied twice, in order', async () => {
    const a = await makePdf('A', 2);
    const b = await makePdf('B', 1);
    expect(await pageTexts(await mergePdfs([a, a]))).toEqual(['A p1', 'A p2', 'A p1', 'A p2']);
    expect(await pageTexts(await mergePdfs([a, b, a]))).toEqual(['A p1', 'A p2', 'B p1', 'A p1', 'A p2']);
  });
  it('needs at least two files', async () => {
    await expect(mergePdfs([await makePdf('A', 1)])).rejects.toMatchObject({ code: 'merge-needs-two' });
    await expect(mergePdfs([])).rejects.toMatchObject({ code: 'merge-needs-two' });
  });
  it('extracts pages in the order and with the duplicates given', async () => {
    const b = await makePdf('B', 3);
    expect(await pageTexts(await extractPages(b, [2, 0, 0]))).toEqual(['B p3', 'B p1', 'B p1']);
  });
  it('rejects empty or out-of-range extraction', async () => {
    const b = await makePdf('B', 3);
    await expect(extractPages(b, [])).rejects.toMatchObject({ code: 'invalid-page-list' });
    await expect(extractPages(b, [3])).rejects.toMatchObject({ code: 'invalid-page-list' });
    await expect(extractPages(b, [-1])).rejects.toMatchObject({ code: 'invalid-page-list' });
  });
  it('splits every n pages', async () => {
    const parts = await splitEvery(await makePdf('C', 5), 2);
    expect(await Promise.all(parts.map(pageTexts))).toEqual([['C p1', 'C p2'], ['C p3', 'C p4'], ['C p5']]);
  });
  it('rejects invalid split sizes', async () => {
    const b = await makePdf('B', 3);
    await expect(splitEvery(b, 3)).rejects.toMatchObject({ code: 'invalid-split-size' });
    await expect(splitEvery(b, 0)).rejects.toMatchObject({ code: 'invalid-split-size' });
    await expect(splitEvery(b, 1.5)).rejects.toMatchObject({ code: 'invalid-split-size' });
  });
  it('deletes pages and keeps the rest in order', async () => {
    const b = await makePdf('B', 3);
    expect(await pageTexts(await deletePages(b, [1]))).toEqual(['B p1', 'B p3']);
    await expect(deletePages(b, [0, 1, 2])).rejects.toMatchObject({ code: 'cannot-delete-all' });
    await expect(deletePages(b, [5])).rejects.toMatchObject({ code: 'invalid-page-list' });
  });
  it('Split and Delete pages say which page they copy, and stop when the caller throws between pages', async () => {
    const c = await makePdf('C', 5);
    const seen: string[] = [];
    const record = (tool: string) => (done: number, total: number) => void seen.push(`${tool} ${done}/${total}`);
    expect(await pageTexts(await extractPages(c, [4, 0], { onPage: record('split') }))).toEqual(['C p5', 'C p1']);
    expect(await pageTexts(await deletePages(c, [1, 3], { onPage: record('delete') }))).toEqual(['C p1', 'C p3', 'C p5']);
    expect(seen).toEqual(['split 0/2', 'split 1/2', 'delete 0/3', 'delete 1/3', 'delete 2/3']);
    const stop = new Error('cancelled');
    const stopAt = (page: number) => async (done: number) => {
      await Promise.resolve();
      if (done === page) throw stop;
    };
    await expect(deletePages(c, [0], { onPage: stopAt(2) })).rejects.toBe(stop);
    await expect(extractPages(c, [0, 1, 2], { onPage: stopAt(1) })).rejects.toBe(stop);
  });
  it('preserves page size and rotation', async () => {
    const r = await makePdf('R', 2, { size: [200, 500], rotate: 90 });
    const out = await PDFDocument.load(await extractPages(r, [1]));
    expect(out.getPage(0).getSize()).toEqual({ width: 200, height: 500 });
    expect(out.getPage(0).getRotation().angle).toBe(90);
  });
  it('never mutates the inputs and returns new bytes', async () => {
    const a = await makePdf('A', 2);
    const b = await makePdf('B', 3);
    const beforeA = a.slice();
    const beforeB = b.slice();
    const merged = await mergePdfs([a, b]);
    await extractPages(a, [0]);
    await splitEvery(b, 1);
    await deletePages(b, [0]);
    expect(a).toEqual(beforeA);
    expect(b).toEqual(beforeB);
    expect(merged).not.toBe(a);
  });
  describe('metadata', () => {
    const readMeta = async (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false });

    async function withMeta(): Promise<Uint8Array> {
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.addPage([300, 400]);
      doc.addPage([300, 400]);
      doc.addPage([300, 400]);
      doc.setTitle('Synthetic Title');
      doc.setAuthor('Synthetic Author');
      doc.setSubject('Synthetic Subject');
      doc.setKeywords(['alpha', 'beta']);
      doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));
      return doc.save();
    }

    async function expectStamped(bytes: Uint8Array, before: number) {
      const out = await readMeta(bytes);
      expect(out.getProducer()).toBe('ICAI VERA');
      expect(out.getCreator()).toBe('ICAI VERA');
      expect(out.getModificationDate()!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }

    async function expectCarried(bytes: Uint8Array) {
      const out = await readMeta(bytes);
      expect(out.getTitle()).toBe('Synthetic Title');
      expect(out.getAuthor()).toBe('Synthetic Author');
      expect(out.getSubject()).toBe('Synthetic Subject');
      expect(out.getKeywords()).toBe('alpha beta');
      expect(out.getCreationDate()!.toISOString()).toBe('2020-01-02T03:04:05.000Z');
    }

    it('stamps Creator, Producer and ModificationDate on every operation', async () => {
      const before = Date.now();
      const src = await withMeta();
      const b = await makePdf('B', 2);
      await expectStamped(await mergePdfs([src, b]), before);
      await expectStamped(await extractPages(src, [0]), before);
      await expectStamped((await splitEvery(src, 1))[0], before);
      await expectStamped(await deletePages(src, [0]), before);
    });
    it('carries source metadata on extract, split and delete', async () => {
      const src = await withMeta();
      await expectCarried(await extractPages(src, [0]));
      for (const part of await splitEvery(src, 2)) await expectCarried(part);
      await expectCarried(await deletePages(src, [0]));
    });
    it('does not carry Title/Author/Subject/Keywords on merge and sets CreationDate to now', async () => {
      const before = Date.now();
      const out = await readMeta(await mergePdfs([await withMeta(), await withMeta()]));
      expect(out.getTitle()).toBeUndefined();
      expect(out.getAuthor()).toBeUndefined();
      expect(out.getSubject()).toBeUndefined();
      expect(out.getKeywords()).toBeUndefined();
      expect(out.getCreationDate()!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });
    it('leaves absent metadata unset', async () => {
      const bare = await PDFDocument.create({ updateMetadata: false });
      bare.addPage([300, 400]);
      bare.addPage([300, 400]);
      const out = await readMeta(await extractPages(await bare.save(), [0]));
      expect(out.getTitle()).toBeUndefined();
      expect(out.getAuthor()).toBeUndefined();
      expect(out.getSubject()).toBeUndefined();
      expect(out.getKeywords()).toBeUndefined();
      expect(out.getCreationDate()).toBeUndefined();
    });
  });

  describe('encrypted input', () => {
    async function makeEncryptedLike(): Promise<Uint8Array> {
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.addPage([300, 400]);
      doc.addPage([300, 400]);
      const encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
      doc.context.trailerInfo.Encrypt = encrypt;
      return doc.save();
    }

    it('reports a distinct error for every operation', async () => {
      const locked = await makeEncryptedLike();
      const a = await makePdf('A', 2);
      await expect(extractPages(locked, [0])).rejects.toMatchObject({ code: 'encrypted' });
      await expect(splitEvery(locked, 1)).rejects.toMatchObject({ code: 'encrypted' });
      await expect(deletePages(locked, [0])).rejects.toMatchObject({ code: 'encrypted' });
      await expect(mergePdfs([a, locked])).rejects.toMatchObject({ code: 'encrypted' });
    });
    it('names the protected position when merging', async () => {
      const locked = await makeEncryptedLike();
      const a = await makePdf('A', 2);
      await expect(mergePdfs([a, locked])).rejects.toThrow(/file 2/i);
      await expect(mergePdfs([locked, a])).rejects.toThrow(/file 1/i);
    });
  });

  describe('page index messages', () => {
    it('asks for whole numbers from 1 to N for bad indices', async () => {
      const b = await makePdf('B', 3);
      for (const bad of [-1, NaN, 1.5]) {
        await expect(extractPages(b, [bad])).rejects.toThrow('Page numbers must be whole numbers from 1 to 3.');
        await expect(deletePages(b, [bad])).rejects.toMatchObject({ code: 'invalid-page-list' });
      }
    });
    it('keeps the outside-range message for whole numbers past the end', async () => {
      const b = await makePdf('B', 3);
      await expect(extractPages(b, [3])).rejects.toThrow('Page 4 is outside');
    });
  });

  it('sets the producer', async () => {
    const merged = await mergePdfs([await makePdf('A', 1), await makePdf('B', 1)]);
    const out = await PDFDocument.load(merged, { updateMetadata: false });
    expect(out.getProducer()).toBe('ICAI VERA');
  });
});

// ---- forms, links and what removed pages leave behind (Split and Delete pages) ------------------

/** The fields pdf-lib finds, by name, with their values and how many widgets each has. */
async function formOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: Record<string, { value: string | boolean | undefined; widgets: number; signature: boolean }> = {};
  for (const field of doc.getForm().getFields()) {
    const value = field instanceof PDFTextField ? field.getText() : field instanceof PDFCheckBox ? field.isChecked() : undefined;
    out[field.getName()] = { value, widgets: field.acroField.getWidgets().length, signature: field instanceof PDFSignature };
  }
  return out;
}

const acroFormOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes, { updateMetadata: false })).catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);

/** Where each link of a page goes: the result's page number, or null when it goes nowhere in the file. */
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

describe('Split and Delete pages carry the form of the pages kept', () => {
  let form: Uint8Array;
  let lazy: Uint8Array;
  beforeAll(async () => {
    form = await makeFormPdf({ links: true });
    lazy = await makeFormPdf({ needAppearances: true });
  }, 30_000);

  it('keeps filled-in fields and ticked boxes of the kept pages, with their values', async () => {
    for (const out of [await deletePages(form, [2]), await extractPages(form, [0, 1])]) {
      expect(await formOf(out)).toEqual({
        balance: { value: 'Rs 12,34,567 confirmed', widgets: 1, signature: false },
        agree: { value: true, widgets: 1, signature: false },
        both: { value: 'On pages 1 and 3', widgets: 1, signature: false },
        'address.city': { value: 'Mumbai', widgets: 1, signature: false },
        merged: { value: 'Merged value', widgets: 1, signature: false },
      });
    }
  });

  it('keeps only the kept widget of a field that is on a kept and a removed page, and the child fields of a kept parent', async () => {
    const [first, second] = await splitEvery(form, 2);
    expect(Object.keys(await formOf(first)).sort()).toEqual(['address.city', 'agree', 'balance', 'both', 'merged']);
    expect(await formOf(second)).toEqual({
      both: { value: 'On pages 1 and 3', widgets: 1, signature: false },
      'address.street': { value: 'MG Road on page 3', widgets: 1, signature: false },
      remarks: { value: 'Only on page 3', widgets: 1, signature: false },
    });
  });

  it('keeps /NeedAppearances, so a reader draws values that have no stored appearance', async () => {
    const out = await deletePages(lazy, [2]);
    const acroForm = await acroFormOf(out);
    expect(acroForm?.get(PDFName.of('NeedAppearances'))?.toString()).toBe('true');
    expect(acroForm?.has(PDFName.of('DA'))).toBe(true);
    expect(acroForm?.has(PDFName.of('DR'))).toBe(true);
    // the widget still has no appearance of its own: only the flag makes the value visible
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getTextField('balance').acroField.getWidgets()[0].dict.has(PDFName.of('AP'))).toBe(false);
    expect(await pdfjsFieldValues(out)).toMatchObject({ balance: 'Rs 12,34,567 confirmed', 'address.city': 'Mumbai' });
    expect(await pdfjsDrawnFieldText(out, 1)).toContain('Rs 12,34,567 confirmed');
    expect(await pdfjsDrawnFieldText(out, 2)).toContain('Mumbai');
    // The check tells the difference: pages copied without the form (as Split did before) draw no value.
    const bare = await PDFDocument.create();
    const source = await PDFDocument.load(lazy);
    for (const page of await bare.copyPages(source, [0, 1])) bare.addPage(page);
    const withoutForm = await bare.save();
    expect(await pdfjsDrawnFieldText(withoutForm, 1)).toContain('Form p1');
    expect(await pdfjsDrawnFieldText(withoutForm, 1)).not.toContain('Rs 12,34,567 confirmed');
  });

  it('copies the form resources into the result instead of pointing into the source', async () => {
    const out = await extractPages(lazy, [0]);
    const doc = await PDFDocument.load(out);
    const dr = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('DR'), PDFDict);
    expect(dr.lookup(PDFName.of('Font'), PDFDict).entries().length).toBeGreaterThan(0);
    expect(await danglingReferences(out)).toEqual([]);
  });

  it('leaves no value or appearance of a field whose widgets were all on removed pages, and no text of the removed pages', async () => {
    for (const out of [await deletePages(form, [2]), await extractPages(form, [0, 1]), (await splitEvery(form, 2))[0]]) {
      expect(await danglingReferences(out)).toEqual([]);
      const everything = await everythingIn(out);
      expect(everything).not.toContain('Only on page 3');
      expect(everything).not.toContain('MG Road on page 3');
      expect(everything).not.toContain('Form p3');
      expect(await pageTexts(out)).toEqual(['Form p1', 'Form p2']);
    }
  });

  it('keeps links to kept pages pointing at them and drops links to removed pages', async () => {
    expect(await linkTargets(form, 0)).toEqual([2, 3]);
    expect(await linkTargets(await deletePages(form, [2]), 0)).toEqual([2]);
    expect(await linkTargets(await deletePages(form, [1]), 0)).toEqual([2]);
    expect(await linkTargets(await extractPages(form, [0, 2, 1]), 0)).toEqual([3, 2]);
  });

  it('does not carry a removed page in through a link: its text and field value are not in the file', async () => {
    const out = await deletePages(form, [1]);
    expect(await pageTexts(out)).toEqual(['Form p1', 'Form p3']);
    expect(await everythingIn(out)).not.toContain('Form p2');
    expect(await everythingIn(out)).not.toContain('Mumbai');
  });

  it('re-opens with pdf-lib and pdf.js, and has no /AcroForm when the source had none', async () => {
    const plain = await makePdf('B', 3);
    for (const out of [await deletePages(plain, [1]), await extractPages(plain, [2]), ...(await splitEvery(plain, 2))]) {
      expect(await acroFormOf(out)).toBeUndefined();
      expect((await PDFDocument.load(out)).getPageCount()).toBeGreaterThan(0);
      expect(await danglingReferences(out)).toEqual([]);
    }
    const out = await deletePages(form, [0]);
    expect(await pageTexts(out)).toEqual(['Form p2', 'Form p3']);
    expect(Object.keys(await pdfjsFieldValues(out)).sort()).toEqual(['address.city', 'address.street', 'both', 'remarks']);
    // a form whose every field was on the removed pages leaves no /AcroForm behind
    const doc = await PDFDocument.create();
    const [first] = [doc.addPage([300, 400]), doc.addPage([300, 400])];
    const field = doc.getForm().createTextField('only.on.page.one');
    field.setText('Page one value');
    field.addToPage(first, { x: 20, y: 300, width: 200, height: 24 });
    const onlyFirst = await extractPages(await doc.save(), [1]);
    expect(await acroFormOf(onlyFirst)).toBeUndefined();
    expect(await everythingIn(onlyFirst)).not.toContain('Page one value');
    expect(await danglingReferences(onlyFirst)).toEqual([]);
  });

  it('a page listed twice keeps its fields once, shared by both copies', async () => {
    const out = await extractPages(form, [1, 1]);
    expect(await pageTexts(out)).toEqual(['Form p2', 'Form p2']);
    expect(await formOf(out)).toEqual({ 'address.city': { value: 'Mumbai', widgets: 1, signature: false } });
    expect(await danglingReferences(out)).toEqual([]);
  });

  it('does not carry a signature field as a signature: it is left out of the form and /SigFlags is dropped', async () => {
    const signed = await makeFormPdf({ signature: true });
    expect((await inspectPdf(signed)).hasSignature).toBe(true);
    const out = await extractPages(signed, [0]);
    const fields = await formOf(out);
    expect(Object.values(fields).some((f) => f.signature)).toBe(false);
    expect(Object.keys(fields).sort()).toEqual(['agree', 'balance', 'both', 'merged']);
    expect((await acroFormOf(out))?.has(PDFName.of('SigFlags'))).toBe(false);
    expect(await danglingReferences(out)).toEqual([]);
  });
});

describe('splitEvery: a one-page file', () => {
  it('says a one-page file cannot be split, with the same error code', async () => {
    const err = await splitEvery(await makePdf('A', 1), 1).catch((e) => e);
    expect(err).toMatchObject({ name: 'PdfToolsError', code: 'invalid-split-size' });
    expect(err.message).toMatch(/one page/i);
    expect(err.message).not.toMatch(/1 to 0/);
  });
});
