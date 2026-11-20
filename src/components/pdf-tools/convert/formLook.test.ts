// The quality round (T-064): a ruled form with invented data (testConvertPdf.ts formFixture) read with pdf.js in
// Node, as the application reads it, and followed through the layout, the Word document and the workbook.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorkbook, planSheets } from '@/lib/pdf-tools/excelBuild';
import { pageLayout, type GridCell, type PageLayout } from '@/lib/pdf-tools/layout';
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import type { PictureFile } from '@/lib/pdf-tools/pdfPictures';
import { FORM, formFixture } from '@/lib/pdf-tools/testConvertPdf';
import { openPdfjs, standardMeasure, type PdfjsDocument } from '@/lib/pdf-tools/testRedactPdf';
import { buildDocx, planDocument } from '@/lib/pdf-tools/wordBuild';
import { createWordsReader, type PageRead, type WordsSource } from './pageWordsReader';

let doc: PdfjsDocument;
let read: PageRead;
let layout: PageLayout;
let cells: GridCell[];
let pictures: (PictureFile | null)[];
const cellWith = (text: string): GridCell => {
  const found = cells.filter((c) => c.text.includes(text));
  expect(found.map((c) => c.text)).toHaveLength(1);
  return found[0];
};

beforeAll(async () => {
  const bytes = await formFixture();
  const measure = await standardMeasure();
  doc = await openPdfjs(bytes);
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
      const page = await doc.getPage(1);
      const [x0, y0, x1, y1] = page.view;
      return [{ view: [x0, y0, x1, y1], rotate: page.rotate, userUnit: 1 }];
    },
    createMeasure: () => ({ measure, clear: () => undefined }),
    loadDocument: (file) => PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false }),
  };
  const reader = await createWordsReader(source)(bytes);
  read = await reader.page(0);
  layout = pageLayout(read.words, read.segments, read.extras);
  const table = layout.blocks.flatMap((b) => (b.kind === 'table' && b.table.source === 'ruled' ? [b.table] : []));
  cells = table[0]?.grid?.cells ?? [];
  pictures = (layout.pictures ?? []).map((p) => read.picture?.(p.index) ?? null);
}, 30_000);
afterAll(async () => {
  await doc.destroy();
});

describe('a ruled form: how its words are set', () => {
  it('gives each word its family, weight, colour and the way it reads', () => {
    const word = (text: string) => read.words.words.find((w) => w.text === text)!;
    expect(word('SAMPLE')).toMatchObject({ family: 'Arial', bold: true });
    expect(word('Code')).toMatchObject({ family: 'Arial' });
    expect(word('Code').bold).toBeUndefined();
    expect(word('(issued')).toMatchObject({ family: 'Times New Roman' });
    expect(word('ANYWHERE')).toMatchObject({ bold: true, color: 'FF0000' });
    expect(word('Income')).toMatchObject({ bold: true, turn: 90 });
    expect(word('Total').turn).toBeUndefined();
  });
});

describe('a ruled form: its layout', () => {
  it('is one table of true cells: merged where no line is drawn, none empty', () => {
    expect(layout.blocks.filter((b) => b.kind === 'table')).toHaveLength(1);
    expect(cells.filter((c) => c.words.length === 0)).toEqual([]);
    expect(cells).toHaveLength(2 + 2 + 4 + 1 + 9 + 1 + 1 + 1);
    expect(cellWith(FORM.title)).toMatchObject({ row: 0, col: 0, colSpan: 7, rowSpan: 1 });
    expect(cellWith('2030-31')).toMatchObject({ row: 0, col: 7, colSpan: 1 });
    expect(cellWith(FORM.code)).toMatchObject({ row: 1, col: 2, colSpan: 6 });
    expect(cellWith('Individual')).toMatchObject({ row: 2, col: 2, colSpan: 1 });
    expect(cellWith('S-3')).toMatchObject({ row: 2, col: 5, colSpan: 3 });
  });

  it('keeps turned text in its tall cell, in reading order', () => {
    expect(cellWith('Income')).toMatchObject({ text: FORM.sideLabel, turn: 90, row: 3, col: 0, rowSpan: 3, colSpan: 1 });
  });

  it('keeps a sentence together in its cell, with its underlined blanks', () => {
    const sentence = cellWith('Return transmitted');
    expect(sentence).toMatchObject({ colSpan: 8, rowSpan: 1 });
    expect(sentence.lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['Return transmitted on 01-Jan-2030 from address 10.0.0.1', 'and verified by SAMPLE PERSON using code ABC123']);
    expect(sentence.lines.map((l) => l.underlines?.length)).toEqual([2, 2]);
    expect(sentence.words.filter((w) => w.underline).map((w) => w.text)).toEqual(['01-Jan-2030', '10.0.0.1', 'SAMPLE', 'PERSON', 'ABC123']);
  });

  it('knows the line on each side of a cell, with its colour, and the underline of the title is not a line of the table', () => {
    const amount = cellWith('6,79,234');
    expect(amount.borders).toMatchObject({ top: { color: FORM.line }, left: { color: FORM.line }, right: { color: FORM.line }, bottom: { color: FORM.line } });
    expect(cellWith('Total income').borders.left).not.toBeNull();
    expect(cellWith(FORM.title).words.every((w) => w.underline === (FORM.title.includes(w.text) ? true : undefined))).toBe(true);
    expect(layout.rules).toEqual([expect.objectContaining({ x0: 40, x1: 555, color: '000000' })]);
  });

  it('gives back the pictures by their boxes: the faint one behind the text', () => {
    expect(layout.pictures).toHaveLength(2);
    expect(layout.pictures![0]).toMatchObject({ behind: true });
    expect(layout.pictures![0].alpha).toBeCloseTo(0.1, 2);
    expect(layout.pictures![1]).toMatchObject({ behind: false, x0: 250, x1: 370 });
    expect(pictures.map((p) => p && [p.type, p.width, p.height])).toEqual([['png', 40, 40], ['png', 60, 20]]);
  });
});

describe('a ruled form: the Word document', () => {
  let xml = '';
  let names: string[] = [];
  beforeAll(async () => {
    const { parts, looks, report } = planDocument([layout]);
    expect(report).toMatchObject({ pages: 1, tables: 1, headings: 0 });
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks, [pictures]));
    xml = (await zip.file('word/document.xml')!.async('string')) ?? '';
    names = Object.keys(zip.files);
  });
  const cellXml = (text: string): string => {
    const all = [...xml.matchAll(/<w:tc>.*?<\/w:tc>/gs)].map((m) => m[0]).filter((c) => c.includes(text));
    expect(all).toHaveLength(1);
    return all[0];
  };

  it('is a page of the source size, one table, the line above it one paragraph with its date set at the right by a tab', () => {
    expect(xml).toContain('<w:pgSz w:w="11900" w:h="16840"/>');
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(1);
    const top = xml.slice(0, xml.indexOf('<w:tbl>'));
    expect(top).toMatch(/Reference number: ZX-0000-1234<\/w:t><\/w:r><w:r><w:rPr>.*?<\/w:rPr><w:tab\/><\/w:r><w:r>.*?Date of issue: 01-Jan-2030/s);
    expect(top).not.toContain('Heading');
  });

  it('merges cells, sets their widths from the page and draws the pale lines of the page', () => {
    expect(xml).toContain(`<w:tblGrid>${FORM.xs.slice(1).map((x, i) => `<w:gridCol w:w="${(x - FORM.xs[i]) * 20}"/>`).join('')}</w:tblGrid>`);
    expect(cellXml(FORM.title)).toContain('<w:gridSpan w:val="7"/>');
    expect(cellXml(FORM.code)).toContain('<w:gridSpan w:val="6"/>');
    expect(cellXml('Income')).toContain('<w:vMerge w:val="restart"/>');
    expect((xml.match(/<w:vMerge\/>/g) ?? []).length).toBe(2);
    expect(cellXml('6,79,234')).toContain(`w:color="${FORM.line}"`);
  });

  it('keeps bold, underline, colour, family, alignment and turned text', () => {
    const title = cellXml(FORM.title);
    expect(title).toMatch(/<w:jc w:val="center"\/>.*<w:rFonts w:ascii="Arial"[^>]*\/><w:b\/><w:bCs\/><w:sz w:val="22"\/><w:szCs w:val="22"\/><w:u w:val="single"\/>/s);
    expect(title).toContain('w:ascii="Times New Roman"');
    expect(cellXml('6,79,234')).toContain('<w:jc w:val="right"/>');
    expect(cellXml('Total income')).not.toContain('<w:jc');
    expect(cellXml('Income')).toContain('<w:textDirection w:val="btLr"/>');
    expect(cellXml('Income')).toContain(`>${FORM.sideLabel}<`);
    expect(cellXml(FORM.footer)).toMatch(/<w:color w:val="FF0000"\/>.*<w:u w:val="single"\/>/s);
  });

  it('writes the sentence as its two lines, each blank an underlined tab', () => {
    const sentence = cellXml('Return transmitted');
    expect((sentence.match(/<w:p>/g) ?? []).length).toBe(2);
    expect((sentence.match(/<w:u w:val="single"\/><\/w:rPr><w:tab\/>/g) ?? []).length).toBe(8);
    expect(sentence).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">SAMPLE PERSON<\/w:t>/);
  });

  it('stays one page: one section, no page break, nothing after the table but the closing paragraph', () => {
    expect((xml.match(/<w:sectPr>/g) ?? []).length).toBe(1);
    expect(xml).not.toContain('w:type="page"');
    expect(xml).not.toContain('<w:tblpPr');
    const after = xml.slice(xml.indexOf('</w:tbl>'));
    expect(after).not.toContain('<w:t ');
  });

  it('with a measure of the fonts is the same table: nothing moves out of its cell, single lines get no line break', async () => {
    const wider = (text: string) => Array.from(text).reduce((n, ch) => n + (ch === ' ' ? 0.3 : 0.62), 0);
    const fitted = planDocument([layout], wider);
    expect(fitted.report).toMatchObject({ pages: 1, tables: 1, headings: 0 });
    const zip = await JSZip.loadAsync(await buildDocx(fitted.parts, () => undefined, fitted.looks, [pictures]));
    const fittedXml = (await zip.file('word/document.xml')!.async('string')) ?? '';
    expect((fittedXml.match(/<w:tc>/g) ?? []).length).toBe((xml.match(/<w:tc>/g) ?? []).length);
    expect((fittedXml.match(/<w:gridSpan /g) ?? []).length).toBe((xml.match(/<w:gridSpan /g) ?? []).length);
    expect(fittedXml).not.toContain('<w:br/>');
    expect(fittedXml).toMatch(/<w:w w:val="\d+"\/>/);
  });

  it('places both pictures on the page, the faint one behind the text', () => {
    expect(names.filter((n) => /^word\/media\/.+/.test(n))).toEqual(['word/media/image1.png', 'word/media/image2.png']);
    const anchors = [...xml.matchAll(/<wp:anchor [^>]*behindDoc="(\d)"[^>]*>.*?<\/wp:anchor>/gs)].filter((m) => m[0].includes('<pic:pic'));
    expect(anchors.map((m) => m[1])).toEqual(['1', '0']);
    expect(anchors[0][0]).toContain('<a:alphaModFix amt="10000"/>');
    expect(anchors[1][0]).toContain(`<wp:posOffset>${250 * 12700}</wp:posOffset>`);
  });
});

describe('a ruled form: the workbook', () => {
  it('holds the picture that stands on the page, at the row of its cell, and not the faint one behind the text', async () => {
    const { sheets } = planSheets([layout], 'one-sheet', [pictures]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildWorkbook(sheets, () => undefined)).buffer as ArrayBuffer);
    const sheet = book.worksheets[0];
    const images = sheet.getImages();
    expect(images).toHaveLength(1);
    let row = 0;
    sheet.eachRow((r, n) => r.eachCell((cell) => {
      if (typeof cell.value === 'string' && cell.value.includes('System generated')) row = n;
    }));
    expect((images[0].range as unknown as { tl: { nativeRow: number } }).tl.nativeRow).toBe(row - 1);
    expect((images[0].range as unknown as { ext: { width: number; height: number } }).ext).toMatchObject({ width: 160, height: 32 });
  });

  it('has the same cells: merged ranges, amounts as numbers, bold, turned text, the lines and colours', async () => {
    const { sheets, report } = planSheets([layout], 'one-sheet');
    expect(report).toMatchObject({ tablesRuled: 1 });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildWorkbook(sheets, () => undefined)).buffer as ArrayBuffer);
    const sheet = book.worksheets[0];
    const find = (text: string | number) => {
      let hit: ExcelJS.Cell | undefined;
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.master === cell && (cell.value === text || (typeof text === 'string' && typeof cell.value === 'string' && cell.value.includes(text)))) hit = cell;
        }),
      );
      return hit!;
    };
    const merges = Object.values((sheet as unknown as { _merges: Record<string, { model: { top: number; left: number; bottom: number; right: number } }> })._merges).map((m) => m.model);
    const title = find(FORM.title);
    expect(merges).toContainEqual({ top: Number(title.row), left: 1, bottom: Number(title.row), right: 7 });
    expect(title.font).toMatchObject({ bold: true, name: 'Arial', size: 11 });
    expect(title.alignment).toMatchObject({ horizontal: 'center' });
    const side = find(FORM.sideLabel);
    expect(side.alignment).toMatchObject({ textRotation: 90 });
    expect(merges).toContainEqual({ top: Number(side.row), left: 1, bottom: Number(side.row) + 2, right: 1 });
    const amount = find(679234);
    expect(amount.type).toBe(ExcelJS.ValueType.Number);
    expect(amount.border?.top?.color?.argb).toBe(`FF${FORM.line}`);
    expect(find('(-) 70,000').alignment).toMatchObject({ horizontal: 'right' });
    expect(find(FORM.footer).font).toMatchObject({ bold: true, underline: true, color: { argb: 'FFFF0000' } });
    expect(find(FORM.code).value).toBe(FORM.code);
    // A cell of several short lines keeps them as lines.
    expect(find('System generated').value).toBe('System generated\nSample code\nZZ0000SAMPLE0000CAPTION');
    expect(find('System generated').alignment).toMatchObject({ wrapText: true });
    // The line above the form: its two pieces in cells of their own, the date at the table's right edge.
    const reference = find('Reference number: ZX-0000-1234');
    const date = find('Date of issue: 01-Jan-2030');
    expect([Number(reference.col), Number(date.col), date.row]).toEqual([1, FORM.xs.length - 1, reference.row]);
    expect(date.alignment).toMatchObject({ horizontal: 'right' });
    expect(date.type).toBe(ExcelJS.ValueType.String);
    // Columns as wide as on the page, in proportion.
    expect(sheet.getColumn(3).width! / sheet.getColumn(2).width!).toBeCloseTo((300 - 130) / (130 - 64), 1);
  });
});
