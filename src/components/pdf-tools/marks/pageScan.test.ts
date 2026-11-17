import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { solidPng } from '@/lib/pdf-tools/testMarksPdf';
import { makeFormPdf, makePdf } from '@/lib/pdf-tools/testPdf';
import { isAbortError } from '../renderQueue';
import { pageShowsText, scanPages } from './pageScan';

vi.setConfig({ testTimeout: 60_000 });

type PageKind = 'text' | 'scan' | 'ocr-scan' | 'scan-with-form-text' | 'half-picture';

/** One page per kind: a text page, a scan, a scan with an invisible text layer (OCR), a scan with visible text in a form XObject, a picture over half the page. */
async function makeKindsPdf(kinds: PageKind[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(solidPng(20, 20, [220, 220, 220]));
  for (const kind of kinds) {
    const page = doc.addPage([612, 792]);
    if (kind === 'text') {
      page.drawText('Ledger', { x: 50, y: 700, size: 12, font });
      continue;
    }
    page.drawImage(image, { x: 0, y: 0, width: 612, height: kind === 'half-picture' ? 396 : 792 });
    if (kind === 'ocr-scan') {
      const ref = page.node.newFontDictionary('F1', font.ref);
      const ops = `q BT 3 Tr /${ref.decodeText()} 12 Tf 100 100 Td (Invoice 42) Tj ET Q`;
      page.node.addContentStream(doc.context.register(doc.context.flateStream(ops)));
    }
    if (kind === 'scan-with-form-text') {
      const form = doc.context.register(
        doc.context.flateStream('BT /F1 12 Tf 100 100 Td (Stamped) Tj ET', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 612, 792],
          Resources: doc.context.obj({ Font: doc.context.obj({ F1: font.ref }) }),
        }),
      );
      const name = page.node.newXObject('Fx', form);
      page.node.addContentStream(doc.context.register(doc.context.flateStream(`q /${name.decodeText()} Do Q`)));
    }
  }
  return doc.save();
}

describe('pageShowsText', () => {
  it('sees visible text, and not the invisible text layer of a scanned page', async () => {
    const doc = await PDFDocument.load(await makeKindsPdf(['text', 'scan', 'ocr-scan', 'scan-with-form-text']));
    expect(doc.getPages().map(pageShowsText)).toEqual([true, false, false, true]);
  });

  it('answers null when a content stream cannot be read', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 1));
    const page = doc.getPage(0);
    const stream = doc.context.stream('BT /F1 12 Tf (x) Tj ET', { Filter: 'JBIG2Decode' });
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
    expect(pageShowsText(page)).toBeNull();
  });
});

describe('scanPages', () => {
  it('lists the scanned pages, an OCR layer included, and leaves text pages and half pictures out', async () => {
    const scan = await scanPages(await makeKindsPdf(['text', 'scan', 'ocr-scan', 'scan-with-form-text', 'half-picture']));
    expect(scan.scans).toEqual([2, 3]);
    expect(scan.withFields).toEqual([]);
    expect(scan.pageCount).toBe(5);
  });

  it('lists the pages with form fields', async () => {
    const scan = await scanPages(await makeFormPdf());
    expect(scan.withFields).toEqual([1, 2, 3]);
    expect(scan.scans).toEqual([]);
  });

  it('pauses between pages and stops when asked', async () => {
    const pdf = await makeKindsPdf(['text', 'scan', 'scan', 'text']);
    const controller = new AbortController();
    let pauses = 0;
    const stopped = scanPages(pdf, {
      signal: controller.signal,
      pauseEvery: 1,
      pause: async () => {
        pauses += 1;
        if (pauses === 2) controller.abort();
      },
    });
    await expect(stopped).rejects.toSatisfy(isAbortError);
    expect(pauses).toBe(2);
  });

  it('does not change the bytes it reads', async () => {
    const pdf = await makeKindsPdf(['scan']);
    const before = pdf.slice();
    await scanPages(pdf);
    expect(pdf).toEqual(before);
  });
});
