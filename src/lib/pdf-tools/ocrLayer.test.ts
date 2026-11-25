// Make searchable, the invisible text layer (T-064, OCR part A). The words the engine would give are supplied by the
// fixtures (testOcrPdf.ts); the searchable copy is read back with pdf.js in Node, as the application's own reader
// reads it, and each word must come back in order with its baseline and size within 2 pt of where its ink is: on an
// upright page, a page shown turned by /Rotate 90, a page with a crop box, and pages the engine straightened by 2
// degrees (invented words, and twelve words of the OCR trial's skewed ledger with the engine's own reported angle).
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, type PDFPage } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeStreamBytes, textWidth, tokenize } from './marks';
import { addTextLayer, prepareTextLayer, printableText, wordPlacement } from './ocrLayer';
import type { RecognisedPage } from './ocrTypes';
import { pacer } from './pace';
import { A4, ocrFixture, type ExpectedWord, type OcrFixtureName } from './testOcrPdf';
import { openPdfjs, type PdfjsDocument } from './testRedactPdf';

const opened: PdfjsDocument[] = [];
afterAll(async () => {
  for (const doc of opened) await doc.destroy();
});

type M = number[];
/** pdf.js Util.transform: `b` then `a`. */
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

interface ReadWord {
  text: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  size: number;
  /** pdf.js joined the next word to this one with a space: the item then runs to the next word's start. */
  joined: boolean;
}

/** The page's text items as pdf.js gives them, in display points (origin top-left of the page as shown, y down). */
async function readBack(bytes: Uint8Array, pageIndex = 0): Promise<{ items: ReadWord[]; text: string }> {
  const pdf = await openPdfjs(bytes);
  opened.push(pdf);
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: ReadWord[] = [];
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str + (item.hasEOL ? '\n' : ' ');
    if (item.str.trim() === '') continue;
    const m = mul(viewport.transform, item.transform);
    const len = Math.hypot(m[0], m[1]);
    const start = { x: m[4], y: m[5] };
    items.push({ text: item.str.trim(), start, end: { x: start.x + (item.width * m[0]) / len, y: start.y + (item.width * m[1]) / len }, size: Math.hypot(m[2], m[3]), joined: /\s$/.test(item.str) });
  }
  return { items, text };
}

async function searchable(name: OcrFixtureName): Promise<{ bytes: Uint8Array; expected: ExpectedWord[]; report: ReturnType<typeof addTextLayer> }> {
  const fixture = await ocrFixture(name);
  const doc = await PDFDocument.load(fixture.bytes);
  const font = await prepareTextLayer(doc, pacer());
  const page = fixture.pages.find((p) => p.recognised)!;
  const report = addTextLayer(doc, doc.getPage(page.pageIndex), font, page.recognised!);
  return { bytes: await doc.save(), expected: page.expected, report };
}

const off = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function expectPlaced(items: ReadWord[], expected: ExpectedWord[], label: string): number {
  expect(items.map((i) => i.text), label).toEqual(expected.map((e) => e.text));
  let worst = 0;
  items.forEach((item, i) => {
    const e = { ...expected[i], end: item.joined && expected[i + 1] ? expected[i + 1].start : expected[i].end };
    worst = Math.max(worst, off(item.start, e.start), off(item.end, e.end), Math.abs(item.size - e.size));
    expect(off(item.start, e.start), `${label} ${e.text} start`).toBeLessThan(2);
    expect(off(item.end, e.end), `${label} ${e.text} end`).toBeLessThan(2);
    expect(Math.abs(item.size - e.size), `${label} ${e.text} size`).toBeLessThan(2);
  });
  return worst;
}

describe('the text layer read back with pdf.js', () => {
  it.each<OcrFixtureName>(['scan', 'rotated', 'cropped', 'skewed', 'trial-skew'])('places every word where its ink is on the %s page', async (name) => {
    const { bytes, expected } = await searchable(name);
    const { items } = await readBack(bytes);
    const worst = expectPlaced(items, expected, name);
    expect(worst).toBeLessThan(name === 'trial-skew' ? 1 : 0.1); // the trial's boxes are whole pixels on a turned page
  });

  it('turns the boxes back by the reported angle: without it the trial page is off by up to 15 pt (spike concern 6)', async () => {
    const fixture = await ocrFixture('trial-skew');
    const page = fixture.pages[0];
    const doc = await PDFDocument.load(fixture.bytes);
    const font = await prepareTextLayer(doc, pacer());
    addTextLayer(doc, doc.getPage(0), font, { ...page.recognised!, angle: 0 });
    const { items } = await readBack(await doc.save());
    const worst = Math.max(...items.map((item, i) => off(item.start, page.expected[i].start)));
    expect(worst).toBeGreaterThan(9);
  });

  it('keeps the reading order, so text extraction gives the lines in order', async () => {
    const { bytes, expected } = await searchable('letter');
    const { text } = await readBack(bytes);
    expect(text.split(/\s+/).filter(Boolean)).toEqual(expected.map((e) => e.text));
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines).toEqual(['Nirvexa Traders Private Limited', 'Invoice NX/2291 dated 14-08-2025', 'Amount payable Rs. 1,23,456.78']);
  });

  it('leaves out ruling-line marks and words it cannot write, drops the characters it cannot encode, and counts them', async () => {
    const { report } = await searchable('scan');
    // "|" and "____"; "नमस्ते" (6 characters, none in the font); the rupee sign of "₹2,950.00".
    expect(report).toEqual({ wordsPlaced: 14, rulingMarks: 2, wordsUnprintable: 1, charactersDropped: 7, wordsBadBox: 0 });
  });
});

/** The streams the page draws, as refs, and their raw bytes. */
function contentRefs(page: PDFPage): PDFRef[] {
  const c = page.node.get(PDFName.of('Contents'));
  return c instanceof PDFArray ? c.asArray().map((r) => r as PDFRef) : [c as PDFRef];
}
const rawBytes = (doc: PDFDocument, ref: PDFRef) => Uint8Array.from((doc.context.lookup(ref) as PDFRawStream).contents);
const decoded = (doc: PDFDocument, ref: PDFRef) => new TextDecoder('latin1').decode(decodeStreamBytes(doc.context.lookup(ref) as PDFRawStream) ?? new Uint8Array());

describe('nothing visible changes', () => {
  it('keeps the page’s own content streams byte for byte, before the layer, wrapped so the layer cannot disturb them', async () => {
    const fixture = await ocrFixture('rotated');
    const doc = await PDFDocument.load(fixture.bytes);
    const page = doc.getPage(0);
    const before = contentRefs(page).map((ref) => ({ ref, bytes: rawBytes(doc, ref) }));
    const font = await prepareTextLayer(doc, pacer());
    addTextLayer(doc, page, font, fixture.pages[0].recognised!);
    const reloaded = await PDFDocument.load(await doc.save());
    const after = contentRefs(reloaded.getPage(0));
    const at = after.findIndex((ref) => ref.objectNumber === before[0].ref.objectNumber);
    expect(at).toBe(1); // after one opening `q`
    before.forEach((b, i) => {
      expect(after[at + i].objectNumber).toBe(b.ref.objectNumber);
      expect(rawBytes(reloaded, after[at + i])).toEqual(b.bytes);
    });
    expect(decoded(reloaded, after[0]).trim()).toBe('q');
    expect(decoded(reloaded, after[at + before.length]).trim()).toBe('Q');
    expect(after.length).toBe(at + before.length + 2);
    // The picture is still drawn from the same resources.
    const xobjects = reloaded.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'));
    expect(String(xobjects)).toContain('/Scan1');
  });

  it('writes only invisible text: its own q … Q, the reader frame, and text set in rendering mode 3', async () => {
    const fixture = await ocrFixture('scan');
    const doc = await PDFDocument.load(fixture.bytes);
    const font = await prepareTextLayer(doc, pacer());
    addTextLayer(doc, doc.getPage(0), font, fixture.pages[0].recognised!);
    const reloaded = await PDFDocument.load(await doc.save());
    const refs = contentRefs(reloaded.getPage(0));
    const layer = decoded(reloaded, refs[refs.length - 1]);
    const ops: string[] = [];
    tokenize(layer, (t) => {
      if (t.k === 'op') ops.push(t.v);
    });
    expect(new Set(ops)).toEqual(new Set(['q', 'cm', 'BT', 'Tr', 'Tf', 'Tz', 'Tm', 'Tj', 'ET', 'Q']));
    expect(ops[0]).toBe('q');
    expect(ops[ops.length - 1]).toBe('Q');
    expect(layer).toMatch(/BT\s+3 Tr/);
    expect(ops.indexOf('Tr')).toBeLessThan(ops.indexOf('Tj'));
    expect(ops.filter((o) => o === 'Tr')).toHaveLength(1);
  });

  it('leaves a page with no usable word exactly as it was', async () => {
    const fixture = await ocrFixture('scan');
    const doc = await PDFDocument.load(fixture.bytes);
    const page = doc.getPage(0);
    const before = page.node.get(PDFName.of('Contents'));
    const font = await prepareTextLayer(doc, pacer());
    const empty: RecognisedPage = { words: [{ text: '|', x0: 1, y0: 1, x1: 5, y1: 90, confidence: 90 }, { text: 'Bad', x0: 5, y0: 5, x1: 5, y1: 9, confidence: 90 }], angle: 0, widthPx: 2480, heightPx: 3508, seconds: 1 };
    expect(addTextLayer(doc, page, font, empty)).toEqual({ wordsPlaced: 0, rulingMarks: 1, wordsUnprintable: 0, charactersDropped: 0, wordsBadBox: 1 });
    expect(page.node.get(PDFName.of('Contents'))).toBe(before);
  });

  it('uses one embedded font for every page of the file', async () => {
    const fixture = await ocrFixture('mixed');
    const doc = await PDFDocument.load(fixture.bytes);
    const font = await prepareTextLayer(doc, pacer());
    const again = await prepareTextLayer(doc, pacer());
    expect(again.font.ref).toBe(font.font.ref);
    const rec = fixture.pages[1].recognised!;
    addTextLayer(doc, doc.getPage(1), font, rec);
    addTextLayer(doc, doc.getPage(2), font, rec);
    const helveticas = async (bytes: Uint8Array) =>
      (await PDFDocument.load(bytes)).context.enumerateIndirectObjects().filter(([, o]) => String(o).includes('/BaseFont /Helvetica')).length;
    expect(await helveticas(await doc.save())).toBe((await helveticas(fixture.bytes)) + 1); // the text page's own font, and ours
  });
});

describe('printableText and wordPlacement', () => {
  it('drops what Helvetica cannot write and keeps the rest', async () => {
    const doc = await PDFDocument.create();
    const font = await prepareTextLayer(doc, pacer());
    expect(printableText('₹1,250.00', font)).toEqual({ text: '1,250.00', dropped: 1 });
    expect(printableText('“Café” — €5 ½', font)).toEqual({ text: '“Café” — €5 ½', dropped: 0 });
    expect(printableText('ﬁnal→', font)).toEqual({ text: 'nal', dropped: 2 });
    expect(printableText('किताब', font)).toEqual({ text: '', dropped: 5 });
  });

  it('sizes a word to its line and scales it to its box', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    const font = await prepareTextLayer(doc, pacer());
    const rec: RecognisedPage = { words: [], angle: 0, widthPx: 2480, heightPx: 3508, seconds: 1 };
    const word = { text: 'Ledger', x0: 170, y0: 245, x1: 297, y1: 283, confidence: 96, line: { y0: 245, y1: 283, baseline: 275 } };
    const p = wordPlacement(word, 'Ledger', rec, page, font)!;
    expect(p.size).toBeCloseTo(38 * 0.24, 6);
    const natural = font.font.widthOfTextAtSize('Ledger', p.size);
    expect((p.scale / 100) * natural).toBeCloseTo(127 * 0.24, 6);
    // Origin: left edge, on the baseline, in the reader frame (y up).
    expect(p.matrix[4]).toBeCloseTo(170 * 0.24, 6);
    expect(p.matrix[5]).toBeCloseTo(A4[1] - 275 * 0.24, 6);
    expect(wordPlacement({ ...word, x1: 170 }, 'Ledger', rec, page, font)).toBeNull();
    expect(wordPlacement({ ...word, y0: Number.NaN }, 'Ledger', rec, page, font)).toBeNull();
  });

  it('takes the size the engine measured for the line when there is one: a line box swollen by its neighbours no longer swells the text', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    const font = await prepareTextLayer(doc, pacer());
    const rec: RecognisedPage = { words: [], angle: 0, widthPx: 2480, heightPx: 3508, seconds: 1 };
    // The line box is 100 px tall (marks of the line above touch it); the text itself measures 40 px.
    const word = { text: 'Ledger', x0: 170, y0: 245, x1: 297, y1: 283, confidence: 96, line: { y0: 215, y1: 315, baseline: 275, size: 40 } };
    const p = wordPlacement(word, 'Ledger', rec, page, font)!;
    expect(p.size).toBeCloseTo(40 * 0.24, 6);
    expect((p.scale / 100) * font.font.widthOfTextAtSize('Ledger', p.size)).toBeCloseTo(127 * 0.24, 6);
    expect(p.matrix[5]).toBeCloseTo(A4[1] - 275 * 0.24, 6);
    // A size that is no use falls back to the line box.
    for (const size of [0, -3, Number.NaN]) expect(wordPlacement({ ...word, line: { ...word.line, size } }, 'Ledger', rec, page, font)!.size).toBeCloseTo(100 * 0.24, 6);
  });
});

describe('words of one line are written with a space between them', () => {
  const line = (index: number, baseline: number) => ({ y0: baseline - 40, y1: baseline + 10, baseline, index, size: 44 });
  const at = (text: string, x0: number, x1: number, index: number, baseline: number, confidence = 95) => ({ text, x0, y0: baseline - 38, x1, y1: baseline, confidence, line: line(index, baseline) });
  const twoLines: RecognisedPage = {
    // Ordinary gaps, a third of the text's height; "|" is a ruled column line and is left out.
    words: [at('Halvick', 300, 470, 0, 400), at('Castings', 484, 680, 0, 400), at('|', 690, 694, 0, 400), at('Limited', 704, 860, 0, 400), at('Ledger', 300, 440, 1, 470), at('account', 454, 630, 1, 470)],
    angle: 0,
    widthPx: 2480,
    heightPx: 3508,
    seconds: 1,
  };

  async function layered(rec: RecognisedPage) {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    const font = await prepareTextLayer(doc, pacer());
    const report = addTextLayer(doc, page, font, rec);
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const refs = contentRefs(reloaded.getPage(0));
    const stream = decoded(reloaded, refs[refs.length - 1]);
    const shown = [...stream.matchAll(/([\d.]+) Tz [^\n]*? Tm <([0-9A-Fa-f]*)> Tj/g)].map((m) => ({
      scale: Number(m[1]),
      text: (m[2].match(/../g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16))).join(''),
    }));
    return { bytes, report, shown, font, page };
  }

  it('ends every word but the last of its line with a space, so a reader never joins two words', async () => {
    const { shown, report, bytes } = await layered(twoLines);
    expect(report.wordsPlaced).toBe(5);
    expect(shown.map((s) => s.text)).toEqual(['Halvick ', 'Castings ', 'Limited', 'Ledger ', 'account']);
    const { text } = await readBack(bytes);
    expect(text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)).toEqual(['Halvick Castings Limited', 'Ledger account']);
  });

  it('still scales the word itself to its box: the space comes after the box', async () => {
    const { shown, font, page } = await layered(twoLines);
    const word = twoLines.words[0];
    const placed = wordPlacement(word, 'Halvick', twoLines, page, font)!;
    expect(shown[0].scale).toBeCloseTo(placed.scale, 2);
    // Width as it is written, letter by letter (no kerning).
    expect((placed.scale / 100) * textWidth(font.font, 'Halvick', placed.size)).toBeCloseTo((470 - 300) * 0.24, 6);
  });

  it('writes no space when the engine gave no line number: the words are then placed alone, as before', async () => {
    const alone: RecognisedPage = { ...twoLines, words: twoLines.words.map((w) => ({ ...w, line: { y0: w.line.y0, y1: w.line.y1, baseline: w.line.baseline } })) };
    expect((await layered(alone)).shown.map((s) => s.text)).toEqual(['Halvick', 'Castings', 'Limited', 'Ledger', 'account']);
  });
});
