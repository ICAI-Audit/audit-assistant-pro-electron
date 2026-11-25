// A searchable scan in PDF to Word and PDF to Excel (T-064): where a page's words are invisible text standing
// over a picture, the picture already shows those words. The converters type the words and leave that picture
// out, so nothing is printed twice, and they say so. Decided from what the page draws (text rendering mode 3
// over a picture), whoever wrote the layer. Visible text and the pictures no invisible word stands over are as
// before. Every page here is built with pdf-lib from invented words.
import JSZip from 'jszip';
import { PDFDocument, PDFName, StandardFonts, type PDFDict } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planSheets } from '@/lib/pdf-tools/excelBuild';
import { pageLayout, type PageLayout, type PageWords, type Word } from '@/lib/pdf-tools/layout';
import { addTextLayer, prepareTextLayer } from '@/lib/pdf-tools/ocrLayer';
import { pacer } from '@/lib/pdf-tools/pace';
import type { FontStyleLike, MeasureChar, TextItemLike } from '@/lib/pdf-tools/pageText';
import { pageDrawings } from '@/lib/pdf-tools/rulingLines';
import { addScanPicture, ocrFixture } from '@/lib/pdf-tools/testOcrPdf';
import { openPdfjs, standardMeasure, type PdfjsDocument } from '@/lib/pdf-tools/testRedactPdf';
import { buildDocx, planDocument } from '@/lib/pdf-tools/wordBuild';
import * as excelForm from './excelForm';
import { createWordsReader, type PageRead, type WordsSource } from './pageWordsReader';
import * as wordForm from './wordForm';

// The reader on pdf.js in Node, as pageWordsReader.test.ts reads.
const docs = new Map<Uint8Array, Promise<PdfjsDocument>>();
const open = (file: Uint8Array) => {
  let doc = docs.get(file);
  if (!doc) docs.set(file, (doc = openPdfjs(file)));
  return doc;
};
let measure: MeasureChar;
const source: WordsSource = {
  async pageTextContent(file, pageIndex) {
    const page = await (await open(file)).getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const items: TextItemLike[] = [];
    for (const item of content.items) {
      if ('str' in item) items.push({ str: item.str, transform: item.transform, width: item.width, height: item.height, fontName: item.fontName, hasEOL: item.hasEOL });
    }
    const styles: Record<string, FontStyleLike> = {};
    for (const [name, style] of Object.entries(content.styles)) styles[name] = { fontFamily: style.fontFamily, ascent: style.ascent, descent: style.descent, vertical: style.vertical };
    return { items, styles };
  },
  async pageGeometries(file) {
    const doc = await open(file);
    const out: { view: [number, number, number, number]; rotate: number; userUnit: number }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      out.push({ view: [x0, y0, x1, y1], rotate: page.rotate, userUnit: (page as unknown as { userUnit?: number }).userUnit ?? 1 });
    }
    return out;
  },
  createMeasure: () => ({ measure, clear: () => undefined }),
  loadDocument: (file) => PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false }),
};

beforeAll(async () => {
  measure = await standardMeasure();
});
afterAll(async () => {
  for (const doc of docs.values()) await (await doc).destroy();
});

async function read(bytes: Uint8Array): Promise<{ reads: PageRead[]; layouts: PageLayout[] }> {
  const reader = await createWordsReader(source)(bytes);
  const reads: PageRead[] = [];
  for (let i = 0; i < reader.pageCount; i++) reads.push(await reader.page(i));
  reader.close();
  return { reads, layouts: reads.map((r) => pageLayout(r.words, r.segments, r.extras)) };
}

/** The invented scan of testOcrPdf.ts made searchable by the application's own layer. */
async function ownSearchable(): Promise<Uint8Array> {
  const fixture = await ocrFixture('letter');
  const doc = await PDFDocument.load(fixture.bytes);
  const font = await prepareTextLayer(doc, pacer());
  addTextLayer(doc, doc.getPage(0), font, fixture.pages[0].recognised!);
  return doc.save();
}

/** A page whose content is `content(fontName)`, with Helvetica in its resources and the scan picture as /Scan1. */
async function pageOf(content: (font: string) => string, face: StandardFonts = StandardFonts.Helvetica): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(face);
  page.drawText('x', { x: 5, y: 5, size: 4, font });
  addScanPicture(page);
  page.node.normalize();
  const fontName = (page.node.Resources()!.lookup(PDFName.of('Font')) as PDFDict).keys()[0].asString();
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content(fontName))));
  return doc.save();
}

/** A layer as another maker writes it: the picture first, then one text object, a whole line to each show. */
const foreignLayer = (font: string) =>
  [
    'q 595 0 0 842 0 0 cm /Scan1 Do Q',
    `BT 3 Tr ${font} 11 Tf 60 760 Td (Halvick Traders ledger for the quarter) Tj 0 -16 Td (Opening balance 1,250.00 carried forward) Tj 0 -16 Td (Closing balance 3,480.50 as per books) Tj ET`,
  ].join('\n');

const entries = async (bytes: Uint8Array, folder: string) => Object.keys((await JSZip.loadAsync(bytes)).files).filter((name) => name.startsWith(folder));

describe('the page tells which of its text is invisible', () => {
  it('marks a run written in text rendering mode 3, and no other', async () => {
    const bytes = await pageOf((f) => `BT ${f} 10 Tf 50 700 Td (Seen) Tj ET q 3 Tr BT ${f} 10 Tf 50 650 Td (Hidden) Tj ET Q BT ${f} 10 Tf 50 600 Td (Seen again) Tj 3 Tr 0 -20 Td (Hidden again) Tj 0 Tr 0 -20 Td (Seen last) Tj ET`);
    const drawings = pageDrawings(await PDFDocument.load(bytes), 0);
    expect(drawings.starts.map((s) => [Math.round(s.y), s.hidden === true])).toEqual([[142, false], [192, true], [242, false], [262, true], [282, false]]);
    expect(drawings.hiddenText).toBe('some');
  });

  it('says so when all the text of the page is invisible, and says nothing on a page of visible text', async () => {
    expect(pageDrawings(await PDFDocument.load(await pageOf(foreignLayer)), 0).hiddenText).toBe('all');
    const plain = pageDrawings(await PDFDocument.load(await pageOf((f) => `BT ${f} 10 Tf 50 700 Td (Seen) Tj ET`)), 0);
    expect(plain.hiddenText).toBeUndefined();
    expect(plain.starts.every((s) => !('hidden' in s))).toBe(true);
  });

  it('follows the mode into a form drawn on the page', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('x', { x: 5, y: 5, size: 4, font });
    page.node.normalize();
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font')) as PDFDict;
    const fontName = fonts.keys()[0].asString();
    const form = doc.context.register(doc.context.stream(`BT ${fontName} 10 Tf 20 100 Td (In a form) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: { Font: fonts } }));
    page.node.setXObject(PDFName.of('Fm1'), form);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('3 Tr /Fm1 Do')));
    const drawings = pageDrawings(await PDFDocument.load(await doc.save()), 0);
    expect(drawings.starts.map((s) => s.hidden)).toEqual([true]);
    expect(drawings.hiddenText).toBe('all');
  });
});

describe('a searchable scan: its words are typed and its picture is left out', () => {
  it('reads the words of the application’s own layer as invisible, without a colour of their own', async () => {
    const { reads, layouts } = await read(await ownSearchable());
    const words = reads[0].words.words;
    expect(words.length).toBeGreaterThanOrEqual(10);
    expect(words.every((w) => w.hidden === true)).toBe(true);
    expect(words.some((w) => 'color' in w)).toBe(false);
    // The page's one picture is the scan: every word stands over it.
    expect(reads[0].extras?.pictures).toHaveLength(1);
    expect(layouts[0].pictures).toBeUndefined();
    expect(layouts[0].scan).toBe(true);
    expect(layouts[0].hasText).toBe(true);
  });

  it('does the same for a layer another maker wrote (whole lines, one text object)', async () => {
    const { reads, layouts } = await read(await pageOf(foreignLayer));
    expect(reads[0].words.words.map((w) => w.text).join(' ')).toContain('Opening balance 1,250.00 carried forward');
    expect(reads[0].words.words.every((w) => w.hidden === true)).toBe(true);
    expect(layouts[0].pictures).toBeUndefined();
    expect(layouts[0].scan).toBe(true);
  });

  it('never loses the layer’s colour as white text: invisible words whose fill is white are typed in the usual colour', async () => {
    const { reads } = await read(await pageOf((f) => `q 595 0 0 842 0 0 cm /Scan1 Do Q BT 1 1 1 rg 3 Tr ${f} 11 Tf 60 760 Td (Halvick Traders ledger for the quarter) Tj ET`));
    expect(reads[0].words.words.length).toBeGreaterThan(0);
    expect(reads[0].words.words.some((w) => 'color' in w)).toBe(false);
  });

  it('puts no picture in the Word document or the workbook, keeps every word, and counts the page', async () => {
    const { reads, layouts } = await read(await ownSearchable());
    const typed = reads[0].words.words.map((w) => w.text);
    const pictures = layouts.map((layout, i) => (layout.pictures ?? []).map((p) => reads[i].picture?.(p.index) ?? null));
    const { parts, report, looks } = planDocument(layouts);
    expect(report.pagesFromScan).toBe(1);
    const docx = await buildDocx(parts, () => undefined, looks, pictures);
    expect(await entries(docx, 'word/media/')).toEqual([]);
    const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
    expect(xml).not.toContain('<pic:pic');
    const text = [...xml.replace(/<mc:Fallback>.*?<\/mc:Fallback>/gs, '').matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ');
    for (const word of typed) expect(text).toContain(word.replace(/&/g, '&amp;'));

    const sheets = planSheets(layouts, 'one-sheet', pictures);
    expect(sheets.report.pagesFromScan).toBe(1);
    expect(sheets.sheets.flatMap((s) => s.pictures ?? [])).toEqual([]);
  });

  it('keeps a picture no invisible word stands over, and leaves visible text as it was', async () => {
    // A heading in visible text, a small picture beside it (a logo), and under them a scan with its layer.
    const bytes = await pageOf(
      (f) =>
        [
          `BT ${f} 14 Tf 60 790 Td (Halvick Traders statement of account) Tj ET`,
          'q 60 0 0 40 480 770 cm /Scan1 Do Q',
          'q 495 0 0 600 50 100 cm /Scan1 Do Q',
          `BT 3 Tr ${f} 11 Tf 60 650 Td (Opening balance 1,250.00 carried forward) Tj 0 -16 Td (Closing balance 3,480.50 as per books) Tj ET`,
        ].join('\n'),
      StandardFonts.HelveticaBold,
    );
    const { reads, layouts } = await read(bytes);
    const words = reads[0].words.words;
    const heading = words.filter((w) => w.y1 < 80);
    expect(heading.map((w) => w.text).join(' ')).toBe('Halvick Traders statement of account');
    expect(heading.some((w) => w.hidden)).toBe(false);
    expect(heading.every((w) => w.bold === true)).toBe(true);
    expect(words.filter((w) => w.y0 > 150).every((w) => w.hidden === true)).toBe(true);
    expect(reads[0].extras?.pictures).toHaveLength(2);
    // Only the logo is left, with its own place in the page's list of pictures.
    expect(layouts[0].pictures).toEqual([expect.objectContaining({ index: 0, behind: false })]);
    expect(Math.round(layouts[0].pictures![0].x0)).toBe(480);
    expect(layouts[0].scan).toBe(true);
    expect(reads[0].picture?.(layouts[0].pictures![0].index)).toMatchObject({ type: 'png', width: 2, height: 2 });
  });
});

describe('a page of visible text is as before', () => {
  const word = (text: string, x: number, y: number, more: Partial<Word> = {}): Word => ({ text, x0: x, y0: y - 9, x1: x + text.length * 5, y1: y + 2.5, size: 10, font: 'f', ...more });
  const row = (text: string, x: number, y: number, more: Partial<Word> = {}): Word[] => {
    let at = x;
    return text.split(' ').map((part) => {
      const w = word(part, at, y, more);
      at += part.length * 5 + 3;
      return w;
    });
  };
  const page = (words: Word[]): PageWords => ({ pageIndex: 0, width: 595, height: 842, words });
  const ground = { x0: 0, y0: 0, x1: 595, y1: 842 };

  it('keeps a picture that visible text lies over, behind the text, and says nothing of a scan', () => {
    const words = [...row('Statement of account for the quarter', 60, 100), ...row('Opening balance carried forward', 60, 130)];
    const layout = pageLayout(page(words), [], { pictures: [ground] });
    expect(layout.pictures).toEqual([{ ...ground, index: 0, behind: true }]);
    expect('scan' in layout).toBe(false);
    const { report } = planDocument([layout]);
    expect(report).toEqual({ pages: 1, paragraphs: 2, headings: 0, tables: 0, pagesNoText: 0 });
    expect('pagesFromScan' in planSheets([layout], 'one-sheet').report).toBe(false);
  });

  it('leaves the picture out as soon as the words over it are invisible', () => {
    const words = [...row('Statement of account for the quarter', 60, 100, { hidden: true }), ...row('Opening balance carried forward', 60, 130, { hidden: true })];
    const layout = pageLayout(page(words), [], { pictures: [ground, { x0: 400, y0: 700, x1: 500, y1: 800 }] });
    // The second picture has no word over it: it stays, and keeps its place in the list.
    expect(layout.pictures).toEqual([{ x0: 400, y0: 700, x1: 500, y1: 800, index: 1, behind: false }]);
    expect(layout.scan).toBe(true);
  });

  it('does the same on a page read turned', () => {
    const words = Array.from({ length: 12 }, (_, i) => ({ ...word(`word${i}`, 0, 0), x0: 100, x1: 111.5, y0: 700 - i * 40, y1: 730 - i * 40, turn: 90, hidden: true as const }));
    const layout = pageLayout(page(words), [], { pictures: [ground] });
    expect(layout.turned).toBe(90);
    expect(layout.pictures).toBeUndefined();
    expect(layout.scan).toBe(true);
  });
});

describe('what the user is told, and what the record keeps', () => {
  const wordReport = { pages: 3, paragraphs: 40, headings: 2, tables: 1, pagesNoText: 0 };
  const excelReport = { pages: 3, sheets: 1, tablesRuled: 0, tablesAligned: 1, pagesAsText: 2, pagesNoText: 0, rows: 90, numberCells: 30 };

  it('says in one plain sentence that scanned pages were typed from recognition and their picture left out', () => {
    expect(wordForm.scanNote(1)).toBe('1 page is a scan: its text was typed from recognition and the scan picture was left out. Check numbers against the page.');
    expect(wordForm.scanNote(3)).toBe('3 pages are scans: their text was typed from recognition and the scan pictures were left out. Check numbers against the page.');
    expect(excelForm.scanSentence(1)).toBe(wordForm.scanNote(1));
    expect(excelForm.scanSentence(3)).toBe(wordForm.scanNote(3));
    expect(excelForm.scanSentence(0)).toBeNull();
  });

  it('adds the sentence to PDF to Word’s message as a warning, and not when no page is a scan', () => {
    const plain = wordForm.resultDescription('Ledger.docx', wordReport);
    expect(plain).toEqual({ message: 'Made Ledger.docx', detail: '3 pages: 40 paragraphs, 2 headings, 1 table.', tone: 'success' });
    const scanned = wordForm.resultDescription('Ledger.docx', { ...wordReport, pagesFromScan: 2 });
    expect(scanned).toEqual({ message: 'Made Ledger.docx', detail: `3 pages: 40 paragraphs, 2 headings, 1 table. ${wordForm.scanNote(2)}`, tone: 'warning' });
  });

  it('adds the sentence to PDF to Excel’s message as a warning, and not when no page is a scan', () => {
    const plain = excelForm.resultDescription('Ledger.xlsx', excelReport);
    expect(plain.tone).toBe('success');
    expect(plain.detail).not.toContain('scan');
    const scanned = excelForm.resultDescription('Ledger.xlsx', { ...excelReport, pagesFromScan: 1 });
    expect(scanned).toEqual({ message: 'Made Ledger.xlsx', detail: `${plain.detail} ${excelForm.scanSentence(1)}`, tone: 'warning' });
  });

  it('keeps the count in the record, and only when there is one', () => {
    expect(wordForm.RECORD_KEYS).toContain('pagesFromScan');
    expect(excelForm.RECORD_KEYS).toContain('pagesFromScan');
    // A file with no scanned page is recorded exactly as before.
    expect(wordForm.recordOptions(wordReport)).toEqual(wordReport);
    expect(wordForm.recordOptions({ ...wordReport, pagesFromScan: 2 })).toEqual({ ...wordReport, pagesFromScan: 2 });
    expect(excelForm.recordOptions({ ...excelReport, sheetMode: 'one-sheet' })).not.toHaveProperty('pagesFromScan');
    expect(excelForm.recordOptions({ ...excelReport, sheetMode: 'one-sheet', pagesFromScan: 1 })).toMatchObject({ pagesFromScan: 1 });
  });
});
