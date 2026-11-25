// Text drawn in the standard symbol font ZapfDingbats (T-064, quality round 2): the reader gives the signs the
// page shows, not the letters the file stores for them. Read with pdf.js in Node, as the application reads.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import { openPdfjs, standardMeasure } from '@/lib/pdf-tools/testRedactPdf';
import { createWordsReader, type WordsSource } from './pageWordsReader';

async function wordsOf(bytes: Uint8Array): Promise<string[]> {
  const measure = await standardMeasure();
  const doc = await openPdfjs(bytes);
  try {
    const source: WordsSource = {
      async pageTextContent(_file, pageIndex) {
        const content = await (await doc.getPage(pageIndex + 1)).getTextContent();
        const items: TextItemLike[] = [];
        for (const item of content.items) if ('str' in item) items.push({ str: item.str, transform: item.transform, width: item.width, height: item.height, fontName: item.fontName, hasEOL: item.hasEOL });
        const styles: Record<string, FontStyleLike> = {};
        for (const [name, style] of Object.entries(content.styles)) styles[name] = { fontFamily: style.fontFamily, ascent: style.ascent, descent: style.descent, vertical: style.vertical };
        return { items, styles };
      },
      async pageGeometries() {
        const [x0, y0, x1, y1] = (await doc.getPage(1)).view;
        return [{ view: [x0, y0, x1, y1], rotate: 0, userUnit: 1 }];
      },
      createMeasure: () => ({ measure, clear: () => undefined }),
      loadDocument: (file) => PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false }),
    };
    const reader = await createWordsReader(source)(bytes);
    const read = await reader.page(0);
    reader.close();
    return [...read.words.words].sort((a, b) => Math.round(a.y1 / 20) - Math.round(b.y1 / 20) || a.x0 - b.x0).map((w) => w.text);
  } finally {
    await doc.destroy();
  }
}

describe('text in the standard symbol font', () => {
  it('reads a sign drawn from ZapfDingbats as that sign, inside a word of another font too', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const plain = await doc.embedFont(StandardFonts.Helvetica);
    const signs = await doc.embedFont(StandardFonts.ZapfDingbats);
    // "Rate (■)" with the square from the symbol font, and a tick on a line of its own.
    page.drawText('Rate (', { x: 40, y: 150, size: 10, font: plain });
    const at = 40 + plain.widthOfTextAtSize('Rate (', 10);
    page.drawText('■', { x: at, y: 150, size: 10, font: signs });
    page.drawText(')', { x: at + signs.widthOfTextAtSize('■', 10), y: 150, size: 10, font: plain });
    page.drawText('✔', { x: 40, y: 100, size: 10, font: signs });
    page.drawText('Agreed', { x: 60, y: 100, size: 10, font: plain });
    const words = await wordsOf(await doc.save());
    expect(words).toEqual(['Rate', '(■)', '✔', 'Agreed']);
  });

  it('also when the sign stands only inside a word of another font, as in "(■)" after a heading', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const plain = await doc.embedFont(StandardFonts.Helvetica);
    const signs = await doc.embedFont(StandardFonts.ZapfDingbats);
    page.drawText('Amount (', { x: 40, y: 150, size: 10, font: plain });
    const at = 40 + plain.widthOfTextAtSize('Amount (', 10);
    page.drawText('■', { x: at, y: 150, size: 10, font: signs });
    page.drawText(')', { x: at + signs.widthOfTextAtSize('■', 10), y: 150, size: 10, font: plain });
    page.drawText('1,200.00', { x: 40, y: 100, size: 10, font: plain });
    expect(await wordsOf(await doc.save())).toEqual(['Amount', '(■)', '1,200.00']);
  });
});

// ---- signs a font of the file draws for a letter (quality round 3) --------------------------------------

/**
 * "(C in lakh)" with the C set in a second font, and "Cash 1,200.00" in the first. `change` is given the second
 * font's dictionary of the saved file, to make it the font the test is about.
 */
async function signPage(change: (font: PDFDict, doc: PDFDocument) => void, sign = 'C'): Promise<Uint8Array> {
  const made = await PDFDocument.create();
  const page = made.addPage([300, 200]);
  const plain = await made.embedFont(StandardFonts.Helvetica);
  const other = await made.embedFont(StandardFonts.Courier);
  page.drawText('(', { x: 40, y: 150, size: 10, font: plain });
  const at = 40 + plain.widthOfTextAtSize('(', 10);
  page.drawText(sign, { x: at, y: 150, size: 10, font: other });
  page.drawText('in lakh)', { x: at + other.widthOfTextAtSize(sign, 10) + 3, y: 150, size: 10, font: plain });
  page.drawText('Cash 1,200.00', { x: 40, y: 100, size: 10, font: plain });
  const doc = await PDFDocument.load(await made.save());
  const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  for (const [, ref] of fonts.entries()) {
    const font = doc.context.lookup(ref, PDFDict);
    if (font.lookup(PDFName.of('BaseFont'), PDFName).decodeText() === 'Courier') change(font, doc);
  }
  return doc.save();
}

describe('a sign the font draws for a letter', () => {
  it('reads the one letter a page sets in a font that names itself a rupee font as the rupee sign', async () => {
    const bytes = await signPage((font) => font.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+SampleRupee')));
    expect(await wordsOf(bytes)).toEqual(['(₹', 'in', 'lakh)', 'Cash', '1,200.00']);
  });

  it('reads a letter whose glyph the font names as the rupee sign as that sign', async () => {
    const bytes = await signPage((font, doc) => {
      const differences = PDFArray.withContext(doc.context);
      differences.push(PDFNumber.of(67));
      differences.push(PDFName.of('uni20B9'));
      font.set(PDFName.of('Encoding'), doc.context.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: differences }));
    });
    expect(await wordsOf(bytes)).toEqual(['(₹', 'in', 'lakh)', 'Cash', '1,200.00']);
  });

  it('leaves the letters of a font alone when the page sets several different letters in it, whatever its name', async () => {
    const bytes = await signPage((font) => font.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+SampleRupee')), 'Cr');
    expect(await wordsOf(bytes)).toEqual(['(Cr', 'in', 'lakh)', 'Cash', '1,200.00']);
  });

  it('leaves a C in an ordinary font a C', async () => {
    expect(await wordsOf(await signPage(() => undefined))).toEqual(['(C', 'in', 'lakh)', 'Cash', '1,200.00']);
  });
});
