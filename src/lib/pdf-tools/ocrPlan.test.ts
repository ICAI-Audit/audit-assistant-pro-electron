// Make searchable, the page plan (T-064, OCR): which pages are recognised. Under 20 characters of text and anything
// drawn on the page (a picture of any size, a line, a shape) is recognised; under 20 characters and nothing drawn is
// empty; 20 or more is text (ruling of 18 November 2026: PDF to Excel and PDF to Word send every page with little
// text here). Text is counted with pdf.js, as the application counts it.
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { charsIn } from './documentCheck';
import { SCANNED_MAX_CHARS } from './layout';
import { nothingToRecognise, pageHasDrawing, pageKind, planPages, readPlan, type PageKind } from './ocrPlan';
import { pacer } from './pace';
import { A4, addScanPicture, ocrFixture } from './testOcrPdf';

const opened: { destroy(): Promise<void> }[] = [];
afterAll(async () => {
  for (const doc of opened) await doc.destroy();
});

/** Characters per page as pdf.js reads them (the same count the app's reader makes). */
async function pdfjsChars(bytes: Uint8Array): Promise<(i: number) => Promise<number>> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  opened.push(pdf);
  return async (i) => {
    const content = await (await pdf.getPage(i + 1)).getTextContent();
    return charsIn(content.items.map((item) => ({ str: 'str' in item ? item.str : '' })));
  };
}

describe('pageKind', () => {
  it('recognises a page with little text and anything drawn on it', () => {
    expect(SCANNED_MAX_CHARS).toBe(20);
    expect(pageKind(0, true)).toBe('scanned');
    expect(pageKind(19, true)).toBe('scanned');
    expect(pageKind(20, true)).toBe('text');
    expect(pageKind(20, false)).toBe('text');
    expect(pageKind(19, false)).toBe('empty');
    expect(pageKind(0, false)).toBe('empty');
    expect(pageKind(null, true)).toBe('unread');
  });
});

describe('planPages', () => {
  const kinds: PageKind[] = ['text', 'scanned', 'empty', 'scanned', 'unread', 'text'];

  it('recognises only the pages that look scanned, and counts the others', () => {
    const plan = planPages(kinds);
    expect(plan.total).toBe(6);
    expect(plan.toRecognise).toEqual([1, 3]);
    expect(plan.pages.map((p) => p.recognise)).toEqual([false, true, false, true, false, false]);
    expect({ scanned: plan.scanned, withText: plan.withText, empty: plan.empty, unread: plan.unread }).toEqual({ scanned: 2, withText: 2, empty: 1, unread: 1 });
    expect(nothingToRecognise(plan)).toBe(false);
  });

  it('is one argument away from recognising every page (not offered on screen in this version)', () => {
    const plan = planPages(kinds, 'every-page');
    expect(plan.toRecognise).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.scanned).toBe(2); // the counts still say what the pages are
  });

  it('has nothing to recognise when no page looks scanned', () => {
    expect(nothingToRecognise(planPages(['text', 'text']))).toBe(true);
    expect(nothingToRecognise(planPages(['text', 'empty']))).toBe(true);
    expect(nothingToRecognise(planPages([]))).toBe(true);
  });
});

describe('readPlan on files', () => {
  it('tells a text page, a scanned page and an empty page apart, with pdf.js counting the text', async () => {
    const fixture = await ocrFixture('mixed');
    const doc = await PDFDocument.load(fixture.bytes);
    const done: number[] = [];
    const plan = await readPlan(doc, { pageChars: await pdfjsChars(fixture.bytes) }, { onPage: (n) => void done.push(n) });
    expect(plan.pages.map((p) => p.kind)).toEqual(fixture.pages.map((p) => p.kind));
    expect(plan.toRecognise).toEqual([1]);
    expect(done).toEqual([1, 2, 3]);
  });

  it('calls a rotated scan and a cropped scan scanned', async () => {
    for (const name of ['rotated', 'cropped', 'skewed', 'scan'] as const) {
      const fixture = await ocrFixture(name);
      const doc = await PDFDocument.load(fixture.bytes);
      const plan = await readPlan(doc, { pageChars: await pdfjsChars(fixture.bytes) });
      expect(plan.toRecognise, name).toEqual([0]);
    }
  });

  it('still calls a scan with a printed page number scanned, and a page of text with a picture text', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const numbered = doc.addPage(A4);
    addScanPicture(numbered);
    numbered.drawText('Page 7', { x: 280, y: 20, size: 9, font });
    const captioned = doc.addPage(A4);
    addScanPicture(captioned);
    captioned.drawText('Photograph of the stock register, taken on site', { x: 60, y: 20, size: 9, font });
    const half = doc.addPage(A4);
    addScanPicture(half);
    half.node.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, A4[0], A4[1] * 2])); // the picture now covers half of the page
    const bytes = await doc.save();
    const loaded = await PDFDocument.load(bytes);
    const plan = await readPlan(loaded, { pageChars: await pdfjsChars(bytes) });
    // The half-page picture is recognised too: a picture of any size is enough.
    expect(plan.pages.map((p) => p.kind)).toEqual(['scanned', 'text', 'scanned']);
  });

  it('recognises a page with a small picture, a line or a filled shape, and leaves a page with nothing drawn', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const small = doc.addPage(A4);
    addScanPicture(small);
    small.node.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, A4[0] * 4, A4[1] * 4])); // the picture covers a sixteenth of the page
    doc.addPage(A4).drawLine({ start: { x: 40, y: 700 }, end: { x: 500, y: 700 }, thickness: 1 });
    doc.addPage(A4).drawRectangle({ x: 40, y: 40, width: 200, height: 80 }); // letters drawn as shapes are fills like this one
    doc.addPage(A4).drawText('Page 7', { x: 280, y: 20, size: 9, font }); // a few characters of text and nothing else
    doc.addPage(A4); // nothing at all
    const bytes = await doc.save();
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPages().map((page) => pageHasDrawing(page))).toEqual([true, true, true, false, false]);
    const plan = await readPlan(loaded, { pageChars: await pdfjsChars(bytes) });
    expect(plan.pages.map((p) => p.kind)).toEqual(['scanned', 'scanned', 'scanned', 'empty', 'empty']);
    expect(plan.toRecognise).toEqual([0, 1, 2]);
  });

  it('takes a page whose drawing cannot be read as drawn: its picture decides', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    const broken = doc.context.register(doc.context.stream(new Uint8Array([1, 2, 3, 4]), { Filter: 'FlateDecode' }));
    page.node.set(PDFName.of('Contents'), broken);
    expect(pageHasDrawing(page)).toBe(true);
  });

  it('leaves a page whose text cannot be read as it is, and passes a Stop on', async () => {
    const fixture = await ocrFixture('mixed');
    const doc = await PDFDocument.load(fixture.bytes);
    const failing = async (i: number) => {
      if (i === 1) throw new Error('unreadable');
      return 40;
    };
    const plan = await readPlan(doc, { pageChars: failing });
    expect(plan.pages.map((p) => p.kind)).toEqual(['text', 'unread', 'text']);
    expect(plan.toRecognise).toEqual([]);

    const stop = new Error('stopped');
    let asked = 0;
    const check = () => {
      if (++asked > 1) throw stop;
    };
    await expect(readPlan(doc, { pageChars: async () => 0 }, { check, pace: pacer(check, 0) })).rejects.toBe(stop);
  });
});
