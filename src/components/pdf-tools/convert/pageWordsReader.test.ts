import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageLayout, type Block, type Table } from '@/lib/pdf-tools/layout';
import type { FontStyleLike, MeasureChar, TextItemLike } from '@/lib/pdf-tools/pageText';
import { CONVERT_FIXTURE_NAMES, convertFixture, convertFixtureExpected } from '@/lib/pdf-tools/testConvertPdf';
import { openPdfjs, standardMeasure, type PdfjsDocument } from '@/lib/pdf-tools/testRedactPdf';
import { createWordsReader, type WordsSource } from './pageWordsReader';

// The reader on pdf.js in Node (the same calls and shapes as pdfRenderer.ts), as the Redact find is tested.
const docs = new Map<Uint8Array, Promise<PdfjsDocument>>();
const open = (file: Uint8Array) => {
  let doc = docs.get(file);
  if (!doc) docs.set(file, (doc = openPdfjs(file)));
  return doc;
};
let measure: MeasureChar;
const calls = { text: 0, cleared: 0 };
const abortIf = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};
const nodeSource: WordsSource = {
  async pageTextContent(file, pageIndex, options) {
    calls.text++;
    abortIf(options?.signal);
    const page = await (await open(file)).getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const items: TextItemLike[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      items.push({ str: item.str, transform: item.transform, width: item.width, height: item.height, fontName: item.fontName, hasEOL: item.hasEOL });
    }
    const styles: Record<string, FontStyleLike> = {};
    for (const [name, style] of Object.entries(content.styles)) styles[name] = { fontFamily: style.fontFamily, ascent: style.ascent, descent: style.descent, vertical: style.vertical };
    return { items, styles };
  },
  async pageGeometries(file, options) {
    abortIf(options?.signal);
    const doc = await open(file);
    const out: { view: [number, number, number, number]; rotate: number; userUnit: number }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      out.push({ view: [x0, y0, x1, y1], rotate: page.rotate, userUnit: (page as unknown as { userUnit?: number }).userUnit ?? 1 });
    }
    return out;
  },
  createMeasure: () => ({ measure, clear: () => void calls.cleared++ }),
  loadDocument: (file) => PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false }),
};

/** A source that gives the same hand-made page for any file. */
function fixedSource(items: TextItemLike[], geometry: { view: [number, number, number, number]; rotate: number; userUnit: number }, load: WordsSource['loadDocument'] = nodeSource.loadDocument): WordsSource {
  return {
    pageTextContent: async () => ({ items, styles: { f: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.25, vertical: false } } }),
    pageGeometries: async () => [geometry],
    createMeasure: () => ({ measure: () => 50, clear: () => undefined }),
    loadDocument: load,
  };
}
const item = (str: string, x: number, y: number, size = 10): TextItemLike => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, fontName: 'f', hasEOL: false });
async function blank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  return doc.save();
}

const tables = (blocks: readonly Block[]): Table[] => blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []));
const texts = (table: Table): string[][] => table.rows.map((row) => row.map((c) => c.text));

beforeAll(async () => {
  measure = await standardMeasure();
});
afterAll(async () => {
  for (const doc of docs.values()) await (await doc).destroy();
});

describe('the words reader on real files', () => {
  it('reads every fixture page: the words where they were drawn, in display coordinates, and the lines', async () => {
    let worstX = 0;
    let worstY = 0;
    const loose: string[] = [];
    for (const name of CONVERT_FIXTURE_NAMES) {
      const drawn = await convertFixture(name);
      const reader = await createWordsReader(nodeSource)(drawn.bytes);
      expect(reader.pageCount).toBe(drawn.pages.length);
      for (let i = 0; i < reader.pageCount; i++) {
        const { words, segments } = await reader.page(i);
        const want = drawn.pages[i];
        expect([words.pageIndex, words.width, words.height]).toEqual([i, want.width, want.height]);
        expect(words.words.map((w) => w.text)).toEqual(want.words.map((w) => w.text));
        words.words.forEach((w, k) => {
          const d = want.words[k];
          const offX = Math.max(Math.abs(w.x0 - d.x0), Math.abs(w.x1 - d.x1));
          if (offX > 1) loose.push(`${name}: ${w.text}`);
          worstX = Math.max(worstX, offX);
          worstY = Math.max(worstY, Math.abs(w.y0 - d.y0), Math.abs(w.y1 - d.y1));
          expect(w.size).toBeCloseTo(d.size, 5);
        });
        expect(segments).toHaveLength(drawn.segments[i].length);
      }
      reader.close();
    }
    console.info(`words reader against the drawn boxes: worst edge ${worstX.toFixed(2)} pt across, ${worstY.toFixed(2)} pt down`);
    // Within 1 pt, but for the words inside a line of several words that is the only text in its font on the
    // page (two bold titles here): there pageText.ts cannot tell the font's widths and covers every estimate.
    expect(loose).toEqual(['two-column-letter: Traders', 'two-column-letter: (invented)', 'merged-heading: year']);
    expect(worstX).toBeLessThan(5);
    expect(worstY).toBeLessThan(0.5);
  });

  it('gives the layout the same tables from the file as from the drawn boxes', async () => {
    for (const name of CONVERT_FIXTURE_NAMES) {
      const drawn = await convertFixture(name);
      const expected = await convertFixtureExpected(name);
      const reader = await createWordsReader(nodeSource)(drawn.bytes);
      for (let i = 0; i < reader.pageCount; i++) {
        const { words, segments } = await reader.page(i);
        const fromFile = pageLayout(words, segments);
        const fromBoxes = pageLayout(drawn.pages[i], drawn.segments[i]);
        expect(fromFile.blocks.map((b) => b.kind)).toEqual(fromBoxes.blocks.map((b) => b.kind));
        expect(tables(fromFile.blocks).map(texts)).toEqual(tables(fromBoxes.blocks).map(texts));
        const ruled = name === 'statement-ruled' || name === 'merged-heading' || name === 'rotated-page';
        if (name !== 'two-column-letter') expect(tables(fromFile.blocks).map(texts)).toEqual([ruled ? expected.rows[i] : expected.lineRows[i]]);
      }
      reader.close();
    }
  });

  it('tells a bold font from a regular one by name', async () => {
    const { bytes } = await convertFixture('trial-balance');
    const reader = await createWordsReader(nodeSource)(bytes);
    const { words } = await reader.page(0);
    const fontOf = (text: string) => words.words.find((w) => w.text === text)?.font;
    expect(fontOf('Total')).toBe(fontOf('Particulars'));
    expect(fontOf('Total')).not.toBe(fontOf('Sundry'));
    reader.close();
  });
});

describe('the words reader', () => {
  it('turns user space into display coordinates on a turned page with a page unit', async () => {
    // A 600 x 800 page turned 90 with unit 2 is shown 1600 x 1200. The word runs up the page in user space.
    const up: TextItemLike = { str: 'Total', transform: [0, 10, -10, 0, 100, 200], width: 25, height: 10, fontName: 'f', hasEOL: false };
    const reader = await createWordsReader(fixedSource([up], { view: [0, 0, 600, 800], rotate: 90, userUnit: 2 }))(await blank());
    const { words } = await reader.page(0);
    expect([words.width, words.height]).toEqual([1600, 1200]);
    expect(words.words).toHaveLength(1);
    const w = words.words[0];
    expect(w.text).toBe('Total');
    expect(w.size).toBe(20);
    // Along the page as shown: from y = 200 for 25 units, doubled. Down the page: 0.9 em above x = 100 to 0.25 em below.
    expect(w.x0).toBeCloseTo(400, 5);
    expect(w.x1).toBeCloseTo(450, 5);
    expect(w.y0).toBeCloseTo(182, 5);
    expect(w.y1).toBeCloseTo(205, 5);
  });

  it('gives a word drawn twice once, and leaves out text outside the visible page', async () => {
    const items = [item('Total', 100, 500), item('Total', 100.3, 500), item('Total', 300, 500), item('hidden', 700, 500), item('below', 100, -40)];
    const reader = await createWordsReader(fixedSource(items, { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 }))(await blank());
    const { words } = await reader.page(0);
    expect(words.words.map((w) => [w.text, Math.round(w.x0)])).toEqual([['Total', 100], ['Total', 300]]);
  });

  it('passes Hindi and right-to-left words through unchanged', async () => {
    const items = [item('लेखा परीक्षा', 100, 500), item('نقد', 300, 500)];
    const reader = await createWordsReader(fixedSource(items, { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 }))(await blank());
    expect((await reader.page(0)).words.words.map((w) => w.text)).toEqual(['लेखा', 'परीक्षा', 'نقد']);
  });

  it('still gives the words of a file whose lines cannot be read', async () => {
    const source = fixedSource([item('Total', 100, 500)], { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 }, async () => {
      throw new Error('not a file pdf-lib reads');
    });
    const reader = await createWordsReader(source)(new Uint8Array([1, 2, 3]));
    const { words, segments } = await reader.page(0);
    expect(words.words).toHaveLength(1);
    expect(segments).toEqual([]);
  });

  it('stops at once when the signal is aborted, at open and in a page read', async () => {
    const { bytes } = await convertFixture('rotated-page');
    const stop = new AbortController();
    const reader = await createWordsReader(nodeSource)(bytes, { signal: stop.signal });
    await reader.page(0);
    stop.abort();
    const before = calls.text;
    await expect(reader.page(0)).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.text).toBe(before);
    await expect(createWordsReader(nodeSource)(bytes, { signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses a page that is not there, and any page once closed, letting its measure go', async () => {
    const { bytes } = await convertFixture('rotated-page');
    const reader = await createWordsReader(nodeSource)(bytes);
    await expect(reader.page(1)).rejects.toBeInstanceOf(RangeError);
    await expect(reader.page(-1)).rejects.toBeInstanceOf(RangeError);
    const cleared = calls.cleared;
    reader.close();
    expect(calls.cleared).toBe(cleared + 1);
    await expect(reader.page(0)).rejects.toThrow('closed');
  });

  it('reads a dense page without holding the window', async () => {
    // 60 rows of 12 cells of small print: about 1,400 words on one page.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    const page = doc.addPage([595, 842]);
    for (let r = 0; r < 60; r++) for (let c = 0; c < 12; c++) page.drawText(c < 2 ? `item ${r} ${c}` : `${(r + 1) * (c + 3)},${100 + c}.${10 + r}`, { x: 20 + c * 46, y: 800 - r * 12, size: 5, font });
    const bytes = await doc.save();
    // The text is read beforehand, so the time below is the reader's own work on the page (placing the words, reading the lines).
    const content = await nodeSource.pageTextContent(bytes, 0);
    const reader = await createWordsReader({ ...nodeSource, pageTextContent: async () => content })(bytes);
    await reader.page(0);
    const start = performance.now();
    const { words } = await reader.page(0);
    const ms = performance.now() - start;
    console.info(`words reader on a dense page (${words.words.length} words): ${ms.toFixed(0)} ms of its own work`);
    expect(words.words).toHaveLength(960);
    reader.close();
  });
});
