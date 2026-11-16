import { PDFArray, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BOX_PAD_PT,
  buildPageText,
  enlargedViewCopy,
  FALLBACK_FAMILY,
  growPastInk,
  isUniform,
  pageSeamPlaces,
  rangePieces,
  rangeRects,
  textAxis,
  wordRanges,
  wordRect,
  type MeasureChar,
  type PageTextModel,
  type Rect,
  type TextItemLike,
} from './pageText';
import { makeEmbeddedPdf, makePositionsPdf, openPdfjs, pdfjsPageText, renderPdfjsPage, standardMeasure, type Truth } from './testRedactPdf';

// pdf.js and the 200 dpi drawings are slow, and the suite runs alongside others: pay for the first
// import here, with room to spare.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
let measure: MeasureChar;
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
  measure = await standardMeasure();
}, 60_000);

/** Models of every page as the find builds them: text from the enlarged-view copy, view from the file itself. */
async function models(bytes: Uint8Array, enlarged = true): Promise<PageTextModel[]> {
  const source = await openPdfjs(bytes);
  const reader = enlarged ? await openPdfjs(await enlargedViewCopy(bytes)) : source;
  const out: PageTextModel[] = [];
  for (let i = 0; i < source.numPages; i++) {
    const { view } = await pdfjsPageText(source, i);
    const t = await pdfjsPageText(reader, i);
    out.push(buildPageText(i, t.items, t.styles, view, t.rotate));
  }
  if (reader !== source) await reader.destroy();
  await source.destroy();
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The place of a truth in the page text: its value, letting a space through, on the truth's baseline. */
function locate(model: PageTextModel, t: Truth): [number, number] {
  const g = ['2345', '6789', '0124'];
  const pattern =
    t.id === 'C7-aadhaar-groups'
      ? `${g[0]}\\s*${g[1]}\\s*${g[2]}(?!\\s*for)`
      : t.id === 'C8-aadhaar-linebreak-1'
        ? `${g[0]}\\s*${g[1]}(?=\\s*${g[2]} for)`
        : t.id === 'C8-aadhaar-linebreak-2'
          ? `${g[2]}(?= for KYC)`
          : Array.from(t.value).map(esc).join(' ?');
  let best: [number, number] | null = null;
  let bestDistance = Infinity;
  for (const m of model.text.matchAll(new RegExp(pattern, 'g'))) {
    const at = model.map[m.index];
    if (!at) continue;
    const tr = model.items[at[0]].transform;
    const upward = Math.abs(tr[1]) > 0.01;
    if (upward !== (t.dir === 'y')) continue;
    const d = Math.abs((t.dir === 'x' ? tr[5] : tr[4]) - t.base);
    if (d < bestDistance) {
      bestDistance = d;
      best = [m.index, m.index + m[0].length];
    }
  }
  if (!best || bestDistance > 0.5) throw new Error(`${t.id} not found on page ${t.page + 1}`);
  return best;
}

const along = (r: Rect, dir: 'x' | 'y') => (dir === 'x' ? [r.x0, r.x1] : [r.y0, r.y1]);

describe('buildPageText', () => {
  it('joins the items, with a line break for each end of line, and maps every character back', () => {
    const item = (str: string, x: number, hasEOL: boolean): TextItemLike => ({ str, transform: [10, 0, 0, 10, x, 700], width: str.length * 5, height: 10, fontName: 'f1', hasEOL });
    const model = buildPageText(3, [item('PAN ', 72, false), item('BNZPM2501F', 92, false), item('', 72, true), item('next', 72, false)], {}, [0, 0, 612, 792], 90);
    expect(model.text).toBe('PAN BNZPM2501F\nnext');
    expect(model.map[4]).toEqual([1, 0]);
    expect(model.map[14]).toBeNull();
    expect(model.map[15]).toEqual([3, 0]);
    expect(model).toMatchObject({ pageIndex: 3, view: [0, 0, 612, 792], rotate: 90 });
  });

  it('keeps items apart that pdf.js did not mark: a line break for another line, a space for a gap (a tab when wider than 1 em)', () => {
    const at = (str: string, x: number, y: number, width: number, transform?: number[]): TextItemLike => ({ str, transform: transform ?? [10, 0, 0, 10, x, y], width, height: 10, fontName: 'f1', hasEOL: false });
    const items = [
      at('for KYC', 72, 538, 35),
      at('GSTIN: 27QZXCV0000W1ZM', 300, 500, 120), // another line (a form XObject), no end of line given
      at('BNZPM2501F', 428, 500, 60), // same line, after an 8 pt gap (0.8 em)
      at('next', 488, 500, 20), // straight on: one word continued
      at('up', 40, 100, 10, [0, 10, -10, 0, 40, 100]), // another direction
    ];
    const model = buildPageText(0, items, {}, [0, 0, 612, 792], 0);
    expect(model.text).toBe('for KYC\nGSTIN: 27QZXCV0000W1ZM BNZPM2501Fnext\nup');
    expect(model.map[7]).toBeNull();
    expect(model.map[30]).toBeNull();
    // Fix wave 4 (RX-PAT2): after a 20 pt gap (2 em) the next item stands in another cell: a tab.
    const wide = buildPageText(0, [items[1], at('BNZPM2501F', 440, 500, 60)], {}, [0, 0, 612, 792], 0);
    expect(wide.text).toBe('GSTIN: 27QZXCV0000W1ZM\tBNZPM2501F');
    expect(wide.map[22]).toBeNull();
  });

  it('fix wave 4 (RX-PAT2): a white-space item wider than 1 em is a tab; one narrower, or one between letters set apart one by one, stays a space', () => {
    const at = (str: string, x: number, width: number): TextItemLike => ({ str, transform: [10, 0, 0, 10, x, 600], width, height: 10, fontName: 'f1', hasEOL: false });
    // An ITR-V's label cell, then the name in the next cell after a 2 em white-space item from pdf.js.
    const cells = buildPageText(0, [at('Name', 60, 24), at(' ', 84, 20), at('Ramesh Kumar Gupta', 104, 90)], {}, [0, 0, 612, 792], 0);
    expect(cells.text).toBe('Name\tRamesh Kumar Gupta');
    expect(cells.map[4]).toEqual([1, 0]);
    // A justified line's wider space (0.8 em) stays a space.
    expect(buildPageText(0, [at('Name', 60, 24), at(' ', 84, 8), at('Ramesh', 92, 32)], {}, [0, 0, 612, 792], 0).text).toBe('Name Ramesh');
    // Letter-spaced words: the 1.5 em word gap between single letters stays a space (one value).
    const spaced = [at('R A M E S H', 60, 66), at(' ', 126, 15), at('K U M A R', 141, 54)];
    expect(buildPageText(0, spaced, {}, [0, 0, 612, 792], 0).text).toBe('R A M E S H K U M A R');
  });

  it('puts a space before a raised or lowered item, and keeps small capitals joined (fix round 1, F8)', () => {
    const at = (str: string, x: number, y: number, size: number, width: number): TextItemLike => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: 'f1', hasEOL: false });
    // a superscript value right after its label, and a footnote figure right after a value
    expect(buildPageText(0, [at('PAN', 72, 600, 10, 22), at('BNZPM2501F', 94, 604, 6, 36)], {}, [0, 0, 612, 792], 0).text).toBe('PAN BNZPM2501F');
    expect(buildPageText(0, [at('BNZPM2501F', 72, 600, 10, 60), at('1', 132, 604, 6, 3)], {}, [0, 0, 612, 792], 0).text).toBe('BNZPM2501F 1');
    // small capitals: smaller letters on the same baseline, one word
    expect(buildPageText(0, [at('B', 72, 600, 10, 6.67), at('NZPM', 78.67, 600, 7, 19), at('2501F', 97.67, 600, 10, 28)], {}, [0, 0, 612, 792], 0).text).toBe('BNZPM2501F');
  });

  it('reads characters drawn out of reading order in their order along the line (fix wave, non-blocking 2)', () => {
    const at = (str: string, x: number, y: number, width: number, hasEOL = false): TextItemLike => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10, fontName: 'f1', hasEOL });
    const widths = [7.78, 9.44, 6.67, 6.67, 6.11, 5.56, 5.56, 5.56, 5.56, 6.67];
    let x = 60;
    const chars = Array.from('QWXPT4821K').map((ch, i) => {
      const item = at(ch, x, 600, widths[i]);
      x += widths[i];
      return item;
    });
    // each character its own text object, written last to first, after a heading
    const items = [at('Second page', 60, 780, 55), at('', 60, 780, 0, true), ...[...chars].reverse()];
    const model = buildPageText(0, items, {}, [0, 0, 612, 792], 0);
    expect(model.text).toBe('Second page\nQWXPT4821K');
    // every character still maps back to its own item
    expect(Array.from({ length: 10 }, (_, k) => model.map[12 + k])).toEqual(Array.from({ length: 10 }, (_, k) => [11 - k, 0]));
    // pdf.js ends the line after the character drawn last (the first one): the end of line stays at the end
    const ended = [...chars].reverse().map((c, k, all) => ({ ...c, hasEOL: k === all.length - 1 }));
    expect(buildPageText(0, [...ended, at('next', 60, 580, 20)], {}, [0, 0, 612, 792], 0).text).toBe('QWXPT4821K\nnext');
    // words drawn backwards with gaps between them keep their gaps (2 em: a tab since fix wave 4)
    expect(buildPageText(0, [at('holder', 100, 600, 30), at('PAN', 60, 600, 20)], {}, [0, 0, 612, 792], 0).text).toBe('PAN\tholder');
    expect(buildPageText(0, [at('holder', 85, 600, 30), at('PAN', 60, 600, 20)], {}, [0, 0, 612, 792], 0).text).toBe('PAN holder');
    // left as drawn: a line in order; a word printed twice a hair apart (simulated bold); a right-to-left script
    expect(buildPageText(0, [at('PAN', 60, 600, 20), at('holder', 100, 600, 30)], {}, [0, 0, 612, 792], 0).text).toBe('PAN\tholder');
    expect(buildPageText(0, [at('PAN', 60, 600, 20), at('PAN', 59.7, 600, 20)], {}, [0, 0, 612, 792], 0).text).toBe('PAN PAN');
    // (and any item that steps back less than 0.1 em: a correction printed over a word stays after it)
    expect(buildPageText(0, [at('Total', 60, 600, 24), at('TOTAL', 59.3, 600, 30)], {}, [0, 0, 612, 792], 0).text).toBe('Total TOTAL');
    const shalom = '\u05e9\u05dc\u05d5\u05dd';
    const olam = '\u05e2\u05d5\u05dc\u05dd';
    expect(buildPageText(0, [at(shalom, 200, 600, 30), at(olam, 150, 600, 30)], {}, [0, 0, 612, 792], 0).text).toBe(`${shalom} ${olam}`);
  });

  it('uses the explicit family of each generic font name', () => {
    expect(FALLBACK_FAMILY).toEqual({ 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Courier New' });
  });
});

describe('rangeRects on the positions file', () => {
  let file: Awaited<ReturnType<typeof makePositionsPdf>>;
  let pages: PageTextModel[];
  beforeAll(async () => {
    file = await makePositionsPdf();
    pages = await models(file.bytes);
  });

  it('places every value within the trial tolerance of its true position, on every page', () => {
    const errors: string[] = [];
    for (const t of file.truths) {
      const [s, e] = locate(pages[t.page], t);
      const rects = rangeRects(pages[t.page], s, e, measure, 0);
      expect(rects, t.id).toHaveLength(1);
      const [a0, a1] = along(rects[0], t.dir);
      if (Math.abs(a0 - t.a0) > t.tolerance || Math.abs(a1 - t.a1) > t.tolerance) errors.push(`${t.id} p${t.page + 1}: ${(a0 - t.a0).toFixed(2)} / ${(a1 - t.a1).toFixed(2)}`);
    }
    expect(errors).toEqual([]);
  });

  it('gives the same user-space rectangles on pages turned 90, 180 and 270 degrees', () => {
    for (const t of file.truths.filter((x) => x.page === 0)) {
      const [s, e] = locate(pages[0], t);
      const first = rangeRects(pages[0], s, e, measure);
      for (const p of [1, 2, 3]) {
        const other = file.truths.find((x) => x.page === p && x.id === t.id)!;
        const [s2, e2] = locate(pages[p], other);
        expect(rangeRects(pages[p], s2, e2, measure)).toEqual(first);
      }
    }
  });

  it('covers all the ink of each value, padded 1.5 pt, in a 200 dpi drawing', async () => {
    // Page 5 is drawn without its crop box, so the ink of text outside it can be seen.
    const uncropped = await PDFDocument.load(file.bytes);
    uncropped.getPage(4).node.delete(PDFName.of('CropBox'));
    const doc = await openPdfjs(await uncropped.save());
    const uncovered: string[] = [];
    for (let p = 0; p < 5; p++) {
      const drawing = await renderPdfjsPage(doc, p, 200);
      for (const t of file.truths.filter((x) => x.page === p)) {
        const [s, e] = locate(pages[p], t);
        const [rect] = rangeRects(pages[p], s, e, measure);
        const region =
          t.dir === 'x' ? { x0: t.a0, x1: t.a1, y0: t.base - 0.35 * t.size, y1: t.base + t.size } : { x0: t.base - t.size, x1: t.base + 0.35 * t.size, y0: t.a0, y1: t.a1 };
        const area = drawing.pixelRect(region);
        const data = drawing.pixels(area);
        const box = drawing.pixelRect(rect);
        let inked = 0;
        const width = area.right - area.left;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] >= 160 && data[i + 1] >= 160 && data[i + 2] >= 160) continue;
          inked++;
          const x = area.left + ((i / 4) % width);
          const y = area.top + Math.floor(i / 4 / width);
          if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) {
            uncovered.push(`${t.id} p${p + 1} at ${x},${y}`);
            break;
          }
        }
        expect(inked, `${t.id} p${p + 1} has ink`).toBeGreaterThan(0);
      }
    }
    await doc.destroy();
    expect(uncovered).toEqual([]);
  });

  it('makes one rectangle of an Aadhaar written as three groups, and two of one across a line break', () => {
    const page = pages[0];
    const groups = /2345\s*6789\s*0124(?!\s*for)/.exec(page.text)!;
    expect(rangeRects(page, groups.index, groups.index + groups[0].length, measure)).toHaveLength(1);
    const broken = /2345 6789\n0124/.exec(page.text)!;
    const rects = rangeRects(page, broken.index, broken.index + broken[0].length, measure);
    expect(rects).toHaveLength(2);
    expect(rects[0].y0).toBeGreaterThan(rects[1].y0);
  });

  it('pads by 1.5 pt unless told otherwise', () => {
    const at = pages[0].text.indexOf('BNZPM2501F');
    const [tight] = rangeRects(pages[0], at, at + 10, measure, 0);
    const [padded] = rangeRects(pages[0], at, at + 10, measure);
    expect(BOX_PAD_PT).toBe(1.5);
    expect(padded.x0).toBeCloseTo(tight.x0 - 1.5, 6);
    expect(padded.y1).toBeCloseTo(tight.y1 + 1.5, 6);
  });

  it('gives the pieces of a range along each item, for building text-layer words', () => {
    const at = pages[0].text.indexOf('BNZPM2501F');
    const [piece] = rangePieces(pages[0], at, at + 10, measure);
    const truth = file.truths.find((t) => t.page === 0 && t.id === 'C1-helvetica')!;
    expect(piece.itemIndex).toBe(pages[0].map[at]![0]);
    expect(piece.origin[0]).toBeCloseTo(truth.a0, 1);
    expect(piece.origin[1]).toBeCloseTo(760, 6);
    expect(piece.length).toBeCloseTo(truth.a1 - truth.a0, 1);
    expect(piece.direction).toEqual([1, 0]);
  });
});

describe('rangeRects with an embedded font', () => {
  it('places Liberation Sans values within 0.1 pt', async () => {
    const { bytes, truths } = await makeEmbeddedPdf();
    const [page] = await models(bytes);
    for (const t of truths) {
      const re = new RegExp(Array.from(t.value).map(esc).join(' ?'), 'g');
      const m = [...page.text.matchAll(re)].find((x) => Math.abs(page.items[page.map[x.index]![0]].transform[5] - t.base) < 0.5)!;
      expect(m, t.id).toBeDefined();
      const [rect] = rangeRects(page, m.index, m.index + m[0].length, measure, 0);
      expect(Math.abs(rect.x0 - t.a0), t.id).toBeLessThanOrEqual(0.1);
      expect(Math.abs(rect.x1 - t.a1), t.id).toBeLessThanOrEqual(0.1);
    }
  });
});

describe('rangeRects: edge cases', () => {
  const style = { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false };
  it('boxes the whole item, generously, for vertical writing', () => {
    const items: TextItemLike[] = [{ str: 'ABCDEFGHIJ', transform: [10, 0, 0, 10, 100, 500], width: 0, height: 100, fontName: 'v', hasEOL: false }];
    const model = buildPageText(0, items, { v: { ...style, vertical: true } }, [0, 0, 612, 792], 0);
    const [rect] = rangeRects(model, 2, 4, measure, 0);
    expect(rect.x0).toBeLessThanOrEqual(95);
    expect(rect.x1).toBeGreaterThanOrEqual(105);
    expect(rect.y0).toBeLessThanOrEqual(400);
    expect(rect.y1).toBeGreaterThanOrEqual(510);
  });

  it('skips pieces made only of spaces and line breaks', () => {
    const items: TextItemLike[] = [
      { str: 'ab ', transform: [10, 0, 0, 10, 100, 500], width: 15, height: 10, fontName: 's', hasEOL: true },
      { str: ' ', transform: [10, 0, 0, 10, 100, 480], width: 3, height: 10, fontName: 's', hasEOL: true },
      { str: 'cd', transform: [10, 0, 0, 10, 100, 460], width: 10, height: 10, fontName: 's', hasEOL: false },
    ];
    const model = buildPageText(0, items, { s: style }, [0, 0, 612, 792], 0);
    expect(model.text).toBe('ab \n \ncd');
    expect(rangeRects(model, 0, model.text.length, measure)).toHaveLength(2);
    expect(rangeRects(model, 2, 6, measure)).toEqual([]);
  });

  it('reads missing ascent and descent as 0.9 and -0.25 of the font size', () => {
    const items: TextItemLike[] = [{ str: 'AB', transform: [10, 0, 0, 10, 100, 500], width: 13.34, height: 10, fontName: 't', hasEOL: false }];
    const model = buildPageText(0, items, { t: { fontFamily: 'serif', ascent: null as unknown as number, descent: null as unknown as number, vertical: false } }, [0, 0, 612, 792], 0);
    const [rect] = rangeRects(model, 0, 2, measure, 0);
    expect(rect.y0).toBeCloseTo(497.5, 6);
    expect(rect.y1).toBeCloseTo(509, 6);
  });
});

describe('words', () => {
  it('splits the text into words and boxes each word without padding', async () => {
    const { bytes, truths } = await makePositionsPdf();
    const [page] = await models(bytes);
    const words = wordRanges(page);
    expect(words.map(([s, e]) => page.text.slice(s, e)).slice(0, 5)).toEqual(['PAN', 'of', 'the', 'assessee:', 'BNZPM2501F,']);
    const pan = words.find(([s, e]) => page.text.slice(s, e) === 'BNZPM2501F,')!;
    const rect = wordRect(page, pan, measure);
    const truth = truths.find((t) => t.page === 0 && t.id === 'C1-helvetica')!;
    expect(rect.x0).toBeCloseTo(truth.a0, 1);
    expect(rect.x1).toBeGreaterThan(truth.a1);
  });
});

describe('pageSeamPlaces: the ways a page turn is read (fix wave 5, ruling Q)', () => {
  const line = (str: string, x: number, y: number, size = 11): TextItemLike => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, fontName: 'f1', hasEOL: true });
  const pageOf = (index: number, lines: readonly TextItemLike[]) => buildPageText(index, lines, {}, [0, 0, 595, 842], 0);
  const all = (re: RegExp) => (text: string) => [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const prev = pageOf(0, [
    line('Zeta and Orchid LLP, Chartered Accountants', 51, 807, 10),
    line('The loans were confirmed in writing by every lender.', 51, 780),
    line('paid during the year, were taken from the proprietor, Shri Ramesh Kumar', 51, 70),
    line('1 The loans are unsecured and repayable on demand.', 51, 52, 10),
    line('Page 1 of 2', 274, 30, 9),
  ]);
  const next = pageOf(1, [
    line('Orchard Traders, year ended 31 March 2026', 51, 807, 10),
    line('Page 2 of 2', 274, 30, 9),
    line('Gupta, and from his relatives, and were confirmed by them in writing.', 51, 768),
    line('The loans are repayable on demand and are considered good.', 51, 750),
  ]);

  it('with up to four lines left out at the end of one page and at the start of the next: the two pieces of a name, each on its page', () => {
    const found = pageSeamPlaces(prev, next, all(/Ramesh Kumar\s+Gupta/g));
    expect(found).toHaveLength(1);
    expect(found[0].prev.map(([s, e]) => prev.text.slice(s, e))).toEqual(['Ramesh Kumar']);
    expect(found[0].next.map(([s, e]) => next.text.slice(s, e))).toEqual(['Gupta']);
  });

  it('a place never runs from one way of reading into another: a find that takes everything between two words gives only text of the two pages', () => {
    const words = new Set(`${prev.text} ${next.text}`.split(/\s+/));
    const found = pageSeamPlaces(prev, next, all(/Shri[\s\S]*writing/g));
    expect(found.length).toBeGreaterThan(0);
    for (const place of found) expect(place.text.split(/\s+/).filter((w) => !words.has(w))).toEqual([]);
    // Nothing is found twice, and nothing that lies on one page only.
    expect(new Set(found.map((f) => JSON.stringify([f.prev, f.next]))).size).toBe(found.length);
    expect(pageSeamPlaces(prev, next, all(/confirmed in writing/g))).toEqual([]);
  });

  it('leaves out no more than four lines on a side, and never reads backwards', () => {
    const far = pageOf(1, [...[0, 1, 2, 3, 4].map((k) => line(`Schedule ${'ABCDE'[k]} lists the parties and the terms agreed with each.`, 51, 800 - 14 * k)), line('Gupta, and from his relatives.', 51, 700)]);
    expect(pageSeamPlaces(prev, far, all(/Ramesh Kumar\s+Gupta/g))).toEqual([]);
    expect(pageSeamPlaces(next, prev, all(/Ramesh Kumar\s+Gupta/g))).toEqual([]);
  });
});

describe('enlargedViewCopy', () => {
  it('drops every crop box, inherited ones too, and opens each page to 200,000 pt', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]).node.set(PDFName.of('CropBox'), doc.context.obj([10, 10, 200, 200]));
    doc.addPage([300, 400]);
    doc.catalog.Pages().set(PDFName.of('CropBox'), doc.context.obj([0, 0, 100, 100]));
    const bytes = await doc.save();
    const before = bytes.slice();
    const copy = await PDFDocument.load(await enlargedViewCopy(bytes));
    expect(copy.getPageCount()).toBe(2);
    for (const page of copy.getPages()) {
      expect(page.node.get(PDFName.of('CropBox'))).toBeUndefined();
      const media = page.node.get(PDFName.of('MediaBox')) as PDFArray;
      expect(media.asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([-100000, -100000, 100000, 100000]);
    }
    expect(copy.catalog.Pages().get(PDFName.of('CropBox'))).toBeUndefined();
    expect(bytes).toEqual(before);
  });

  it('refuses a file it cannot read with a message that names nothing in it', async () => {
    await expect(enlargedViewCopy(new TextEncoder().encode('not a pdf BNZPM2501F'))).rejects.toMatchObject({ code: 'redact-find-failed', message: 'The file could not be searched. It may be damaged.' });
  });
});

describe('growPastInk (fix round 1, F2: a box edge never cuts ink; fix round 2, MF1: along the text only)', () => {
  const W = 60;
  const H = 30;
  const page = (shade = 255, w = W, h = H) => new Uint8ClampedArray(w * h * 4).fill(shade).map((v, i) => (i % 4 === 3 ? 255 : v));
  const paint = (rgba: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, v = 0, w = W) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set([v, v, v, 255], (y * w + x) * 4);
  };
  /**
   * Glyph-like ink filling [x0, x1) x [y0, y1): runs of six pixels along each row, the gaps of one row
   * under ink in the next, so every column has ink but no row has a run longer than six (no rule).
   * `vertical` turns it for text that runs down the picture.
   */
  const glyphs = (rgba: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, v = 0, w = W, vertical = false) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const [u, across] = vertical ? [y - y0, x - x0] : [x - x0, y - y0];
        if ((u + (across % 2) * 3) % 7 !== 6) rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
  };
  const none = { left: 0, top: 0, right: 0, bottom: 0 };

  it('grows a side whose edge cuts through ink until the ink is inside', () => {
    const rgba = page();
    paint(rgba, 10, 8, 20, 16); // a glyph the box's right edge cuts
    const r = growPastInk(rgba, W, H, { left: 8, top: 6, right: 15, bottom: 20 }, { maxGrowPx: 20 });
    expect(r).toEqual({ box: { left: 8, top: 6, right: 20, bottom: 20 }, grew: { left: 0, top: 0, right: 5, bottom: 0 }, hitLimit: false });
  });

  it('never grows across the text: ink above and below the box is left to the padding', () => {
    const rgba = page();
    paint(rgba, 10, 4, 14, 26);
    const r = growPastInk(rgba, W, H, { left: 8, top: 10, right: 16, bottom: 20 }, { maxGrowPx: 20 });
    expect(r).toEqual({ box: { left: 8, top: 10, right: 16, bottom: 20 }, grew: none, hitLimit: false });
    const clear = growPastInk(page(), W, H, { left: 8, top: 10, right: 16, bottom: 20 }, { maxGrowPx: 20 });
    expect(clear.grew).toEqual(none);
  });

  it('stops at the stated maximum and says so', () => {
    const rgba = page();
    glyphs(rgba, 10, 8, 50, 16);
    const r = growPastInk(rgba, W, H, { left: 8, top: 6, right: 15, bottom: 20 }, { maxGrowPx: 6 });
    expect(r.box.right).toBe(21);
    expect(r.grew.right).toBe(6);
    expect(r.hitLimit).toBe(true);
  });

  it('stops at the edge of the picture without calling it the limit', () => {
    const rgba = page();
    glyphs(rgba, 40, 8, 60, 16);
    const r = growPastInk(rgba, W, H, { left: 30, top: 6, right: 45, bottom: 20 }, { maxGrowPx: 40 });
    expect(r.box.right).toBe(60);
    expect(r.hitLimit).toBe(false);
  });

  it('judges ink against the paper around the box, so a shaded cell is not ink but faint text is', () => {
    const shaded = page(200);
    paint(shaded, 12, 10, 16, 18, 0);
    expect(growPastInk(shaded, W, H, { left: 10, top: 8, right: 20, bottom: 22 }, { maxGrowPx: 10 }).grew).toEqual(none);
    const faint = page();
    glyphs(faint, 10, 8, 30, 16, 220);
    expect(growPastInk(faint, W, H, { left: 8, top: 6, right: 15, bottom: 20 }, { maxGrowPx: 30 }).box.right).toBe(30);
  });

  // A line of text 50 px long and 20 px tall (3 px of it padding on each side), in a 120 x 40 picture.
  const LW = 120;
  const LH = 40;
  const line = { left: 30, top: 10, right: 80, bottom: 30 };
  const lineOptions = { maxGrowPx: 20, padPx: 3 };
  const text = () => {
    const rgba = page(255, LW, LH);
    glyphs(rgba, 34, 14, 76, 26, 0, LW);
    return rgba;
  };

  it('ignores an underline and a strike-through that run on past the box, as rules, not glyphs', () => {
    const under = text();
    paint(under, 0, 25, LW, 26, 0, LW); // the whole line underlined
    expect(growPastInk(under, LW, LH, line, lineOptions)).toEqual({ box: line, grew: none, hitLimit: false });
    const valueOnly = text();
    paint(valueOnly, 50, 25, 110, 27, 0, LW); // an underline from inside the box running 30 px past it
    expect(growPastInk(valueOnly, LW, LH, line, lineOptions)).toEqual({ box: line, grew: none, hitLimit: false });
    const struck = text();
    paint(struck, 0, 19, LW, 21, 0, LW);
    expect(growPastInk(struck, LW, LH, line, lineOptions)).toEqual({ box: line, grew: none, hitLimit: false });
  });

  it('still grows for a glyph its edge cuts on a struck-through or underlined line', () => {
    const rgba = text();
    glyphs(rgba, 76, 14, 86, 26, 0, LW); // a glyph across the right edge
    paint(rgba, 0, 19, LW, 21, 0, LW);
    paint(rgba, 0, 25, LW, 26, 0, LW);
    expect(growPastInk(rgba, LW, LH, line, lineOptions)).toMatchObject({ box: { ...line, right: 86 }, hitLimit: false });
  });

  it('ignores a short rule glued to the box that is longer than the box is tall (a fill-in line)', () => {
    const rgba = text();
    paint(rgba, 80, 24, 110, 25, 0, LW); // starts at the edge, runs 30 px out
    expect(growPastInk(rgba, LW, LH, line, lineOptions)).toEqual({ box: line, grew: none, hitLimit: false });
  });

  it('follows a short stroke out of the box: shorter than the box is tall, it may be a glyph', () => {
    const rgba = text();
    paint(rgba, 74, 22, 88, 23, 0, LW); // 6 px inside, 8 px out: 14 px, under 20
    expect(growPastInk(rgba, LW, LH, line, lineOptions)).toMatchObject({ box: { ...line, right: 88 }, hitLimit: false });
  });

  it('leaves table rules 1 px above and below the box alone, and still sees a glyph between them', () => {
    const rgba = text();
    paint(rgba, 0, 9, LW, 10, 0, LW);
    paint(rgba, 0, 30, LW, 31, 0, LW);
    paint(rgba, 20, 9, 21, 31, 0, LW); // the cell's left border, clear of the box
    expect(growPastInk(rgba, LW, LH, line, lineOptions)).toEqual({ box: line, grew: none, hitLimit: false });
    // the rules make up most of the ring around the box: the paper is still judged white
    glyphs(rgba, 76, 14, 86, 26, 0, LW);
    expect(growPastInk(rgba, LW, LH, line, lineOptions)).toEqual({ box: { ...line, right: 86 }, grew: { ...none, right: 6 }, hitLimit: false });
  });

  it('under tight leading, does not follow the next lines through the padding', () => {
    const rgba = text();
    glyphs(rgba, 0, 0, LW, 13, 0, LW); // the line above: its descenders reach 3 px into the box
    glyphs(rgba, 0, 28, LW, LH, 0, LW); // the line below: its capitals reach 2 px into the box
    expect(growPastInk(rgba, LW, LH, line, lineOptions)).toEqual({ box: line, grew: none, hitLimit: false });
  });

  it('steps over a cell border on both sides and stops', () => {
    const rgba = text();
    paint(rgba, 0, 5, LW, 6, 0, LW);
    paint(rgba, 0, 35, LW, 36, 0, LW);
    paint(rgba, 28, 5, 30, 36, 0, LW); // touching the left edge
    paint(rgba, 80, 5, 82, 36, 0, LW); // touching the right edge
    expect(growPastInk(rgba, LW, LH, line, lineOptions)).toEqual({ box: { ...line, left: 28, right: 82 }, grew: { left: 2, top: 0, right: 2, bottom: 0 }, hitLimit: false });
  });

  it('says so when glyphs run on past its maximum, rules or not', () => {
    const rgba = text();
    glyphs(rgba, 76, 14, LW, 26, 0, LW);
    paint(rgba, 0, 25, LW, 26, 0, LW);
    const r = growPastInk(rgba, LW, LH, line, lineOptions);
    expect(r).toMatchObject({ box: { ...line, right: 100 }, grew: { left: 0, top: 0, right: 20, bottom: 0 }, hitLimit: true });
  });

  it('for text that runs down the picture, grows only its top and bottom', () => {
    const VW = 40;
    const VH = 120;
    const rgba = page(255, VW, VH);
    const box = { left: 10, top: 30, right: 30, bottom: 80 };
    glyphs(rgba, 14, 34, 26, 76, 0, VW, true);
    glyphs(rgba, 14, 76, 26, 86, 0, VW, true); // a glyph across the bottom edge
    paint(rgba, 24, 0, 25, VH, 0, VW); // its underline, running the whole height
    glyphs(rgba, 30, 50, 34, 56, 0, VW, true); // ink just right of the box: across the text, left alone
    const r = growPastInk(rgba, VW, VH, box, { maxGrowPx: 20, padPx: 3, along: 'vertical' });
    expect(r).toEqual({ box: { ...box, bottom: 86 }, grew: { left: 0, top: 0, right: 0, bottom: 6 }, hitLimit: false });
  });

  it('steps over a gap narrower than 0.2 em to the glyph beyond it, and stops in a wider one (fix wave B7)', () => {
    // A line 40 px tall with 4 px of padding: an em of at most (40 - 8) / 1.15 = 27.8 px, so 0.2 em is 6 px.
    const BW = 160;
    const BH = 60;
    const box = { left: 30, top: 10, right: 100, bottom: 50 };
    const opts = { maxGrowPx: 40, padPx: 4 };
    const base = () => {
      const rgba = page(255, BW, BH);
      glyphs(rgba, 34, 16, 96, 44, 0, BW); // the value's glyphs end 4 px inside the right edge, start 4 px inside the left
      return rgba;
    };
    // 4 px inside the box and 1 px outside it: a 5 px gap between two glyphs, under 0.2 em
    const narrow = base();
    glyphs(narrow, 101, 16, 107, 44, 0, BW);
    glyphs(narrow, 23, 16, 29, 44, 0, BW);
    expect(growPastInk(narrow, BW, BH, box, opts)).toEqual({ box: { ...box, left: 23, right: 107 }, grew: { left: 7, top: 0, right: 7, bottom: 0 }, hitLimit: false });
    // 3 px outside: a 7 px gap, over 0.2 em: the edges stand in gaps between words
    const wide = base();
    glyphs(wide, 103, 16, 109, 44, 0, BW);
    glyphs(wide, 21, 16, 27, 44, 0, BW);
    expect(growPastInk(wide, BW, BH, box, opts)).toEqual({ box, grew: none, hitLimit: false });
    // a gap given in pixels replaces the estimate
    expect(growPastInk(wide, BW, BH, box, { ...opts, gapPx: 8 }).box).toEqual({ ...box, left: 21, right: 109 });
    expect(growPastInk(narrow, BW, BH, box, { ...opts, gapPx: 1 }).box).toEqual(box);
    // a glyph past a narrow gap but beyond the maximum: the box cannot be trusted
    expect(growPastInk(narrow, BW, BH, box, { ...opts, maxGrowPx: 3 })).toMatchObject({ box: { ...box, left: 27, right: 103 }, hitLimit: true });
  });

  it('standing in a wide gap, takes in a glyph of the next word that touches its edge, but not the rest of that word', () => {
    // The box's end stands 7 px (over 0.2 em) past the value's last glyph, its edge touching the next word,
    // whose letters are 2 px apart: the touching letter is taken in (it may be a cut glyph), the word is not.
    const BW = 160;
    const BH = 60;
    const box = { left: 30, top: 10, right: 103, bottom: 50 };
    const rgba = page(255, BW, BH);
    glyphs(rgba, 34, 16, 96, 44, 0, BW);
    glyphs(rgba, 103, 16, 109, 44, 0, BW);
    glyphs(rgba, 111, 16, 117, 44, 0, BW);
    glyphs(rgba, 119, 16, 125, 44, 0, BW);
    expect(growPastInk(rgba, BW, BH, box, { maxGrowPx: 40, padPx: 4 })).toEqual({ box: { ...box, right: 109 }, grew: { left: 0, top: 0, right: 6, bottom: 0 }, hitLimit: false });
  });

  it("gives the axis a text runs along from its angle and the drawing's rotation", () => {
    expect([0, 30, 90, 180, 270, 300].map((a) => textAxis(a))).toEqual(['horizontal', 'horizontal', 'vertical', 'horizontal', 'vertical', 'vertical']);
    expect([textAxis(0, 90), textAxis(90, 90), textAxis(0, 270)]).toEqual(['vertical', 'horizontal', 'vertical']);
  });
});

describe('isUniform', () => {
  it('is true when every pixel is within 8 levels of the first', () => {
    const px = (...values: number[][]) => new Uint8ClampedArray(values.flat());
    expect(isUniform(px([255, 255, 255, 255], [250, 251, 247, 255]))).toBe(true);
    expect(isUniform(px([255, 255, 255, 255], [246, 255, 255, 255]))).toBe(false);
    expect(isUniform(px([255, 255, 255, 255], [246, 255, 255, 255]), 10)).toBe(true);
    expect(isUniform(new Uint8ClampedArray(0))).toBe(true);
  });
});
