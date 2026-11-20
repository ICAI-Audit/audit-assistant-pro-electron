import { PDFDocument, PDFName, type PDFObject } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Segment } from './layout';
import { displayTransform, MAX_PAGE_SEGMENTS, pageSegments, THIN_FILL_PT } from './rulingLines';
import { CONVERT_FIXTURE_NAMES, convertFixture } from './testConvertPdf';
import { makeRawPdf, type RawPdfOptions } from './testMarksPdf';

const rounded = (segments: readonly Segment[]): string[] => segments.map((s) => [s.x0, s.y0, s.x1, s.y1].map((v) => (Math.round(v * 100) / 100 + 0).toFixed(2)).join(' ')).sort();

/** The segments of a one-page file (612 x 792 unless said) with this content. */
async function segmentsOf(content: string, options: Partial<RawPdfOptions> = {}, change?: (doc: PDFDocument) => void): Promise<Segment[]> {
  const doc = await PDFDocument.load(await makeRawPdf({ content, ...options }));
  change?.(doc);
  return pageSegments(doc, 0);
}

describe('displayTransform', () => {
  it('gives the top-left origin of the page as shown, for each turn', () => {
    const view = [10, 20, 310, 420]; // 300 x 400
    expect(displayTransform(view, 0)(10, 420)).toEqual([0, 0]);
    expect(displayTransform(view, 0)(310, 20)).toEqual([300, 400]);
    // Turned 90: the page's bottom-left corner is shown top-left, and the page is 400 wide.
    expect(displayTransform(view, 90)(10, 20)).toEqual([0, 0]);
    expect(displayTransform(view, 90)(310, 420)).toEqual([400, 300]);
    expect(displayTransform(view, 180)(310, 20)).toEqual([0, 0]);
    expect(displayTransform(view, 270)(310, 420)).toEqual([0, 0]);
    expect(displayTransform(view, 270)(10, 20)).toEqual([400, 300]);
    expect(displayTransform(view, -90)(310, 420)).toEqual([0, 0]);
  });

  it('applies the page unit and takes a box written with its corners reversed', () => {
    expect(displayTransform([310, 420, 10, 20], 0, 2)(160, 220)).toEqual([300, 400]);
  });
});

describe('pageSegments', () => {
  it('reads every fixture page’s lines exactly as they were drawn', async () => {
    let total = 0;
    for (const name of CONVERT_FIXTURE_NAMES) {
      const { bytes, segments } = await convertFixture(name);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(segments.length);
      segments.forEach((drawn, i) => {
        expect(rounded(pageSegments(doc, i))).toEqual(rounded(drawn));
        total += drawn.length;
      });
    }
    // Stroked lines (the statement), thin filled bars (the merged heading), `re` on a turned page.
    expect(total).toBeGreaterThan(100);
  });

  it('reads a stroked line and follows the matrix through q and Q', async () => {
    const got = await segmentsOf('q 2 0 0 2 10 20 cm 0 0 m 50 0 l S Q 0 100 m 0 300 l S');
    expect(rounded(got)).toEqual(rounded([{ x0: 10, y0: 772, x1: 110, y1: 772 }, { x0: 0, y0: 492, x1: 0, y1: 692 }]));
    // Two matrices one after the other: the later one is applied to the point first.
    const twice = await segmentsOf('1 0 0 1 10 20 cm 2 0 0 2 0 0 cm 0 0 m 50 0 l S');
    expect(rounded(twice)).toEqual(rounded([{ x0: 10, y0: 772, x1: 110, y1: 772 }]));
  });

  it('reads a stroked rectangle as four lines, and a closed path’s closing piece', async () => {
    expect(rounded(await segmentsOf('100 100 200 50 re S'))).toEqual(
      rounded([{ x0: 100, y0: 692, x1: 300, y1: 692 }, { x0: 100, y0: 642, x1: 300, y1: 642 }, { x0: 100, y0: 642, x1: 100, y1: 692 }, { x0: 300, y0: 642, x1: 300, y1: 692 }]),
    );
    expect(await segmentsOf('100 100 m 300 100 l 300 150 l 100 150 l h S')).toHaveLength(4);
    expect(await segmentsOf('100 100 m 300 100 l 300 150 l 100 150 l s')).toHaveLength(4);
    expect(await segmentsOf('100 100 m 300 100 l 300 150 l 100 150 l S')).toHaveLength(3);
    expect(await segmentsOf('100 100 200 50 re B')).toHaveLength(4);
  });

  it('reads a thin filled rectangle as its centre line, and not a fat one', async () => {
    expect(THIN_FILL_PT).toBe(1.5);
    expect(rounded(await segmentsOf('100 100 200 1 re f'))).toEqual(rounded([{ x0: 100, y0: 691.5, x1: 300, y1: 691.5 }]));
    expect(rounded(await segmentsOf('100 100 1.5 200 re f*'))).toEqual(rounded([{ x0: 100.75, y0: 492, x1: 100.75, y1: 692 }]));
    expect(rounded(await segmentsOf('100 100 m 300 100 l 300 101 l 100 101 l f'))).toEqual(rounded([{ x0: 100, y0: 691.5, x1: 300, y1: 691.5 }]));
    expect(await segmentsOf('100 100 200 1.6 re f')).toEqual([]);
    expect(await segmentsOf('100 100 200 50 re f')).toEqual([]);
    // Thin on paper is what counts: 0.5 units under a matrix that doubles is 1 pt.
    expect(await segmentsOf('q 2 0 0 2 0 0 cm 100 100 200 0.5 re f Q')).toHaveLength(1);
    expect(await segmentsOf('q 4 0 0 4 0 0 cm 10 10 20 0.5 re f Q')).toEqual([]);
  });

  it('leaves out clipping paths, curves, slanted lines and dots', async () => {
    expect(await segmentsOf('0 0 612 792 re W n')).toEqual([]);
    expect(await segmentsOf('100 100 m 150 200 250 200 300 100 c S')).toEqual([]);
    expect(await segmentsOf('100 100 m 300 300 l S')).toEqual([]);
    expect(await segmentsOf('100 100 m 100.5 100 l S')).toEqual([]);
    // The straight piece of a path that also has a curve is kept.
    expect(await segmentsOf('100 100 m 300 100 l 350 150 350 200 300 250 c S')).toHaveLength(1);
  });

  it('is not fooled by operators inside a string or by text', async () => {
    expect(await segmentsOf('BT /F1 12 Tf 100 600 Td (0 0 m 500 0 l S) Tj ET')).toEqual([]);
  });

  it('reads a form drawn on the page through the form’s own matrix, one level deep only', async () => {
    const form = (doc: PDFDocument, content: string, extra: Record<string, PDFObject> = {}) =>
      doc.context.register(doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 400], ...extra }));
    const got = await segmentsOf('q 1 0 0 1 50 60 cm /Fm0 Do Q', {
      resources: (doc) => {
        const inner = form(doc, '0 5 m 300 5 l S');
        const outer = form(doc, '0 0 m 100 0 l S /Fm1 Do', { Matrix: doc.context.obj([2, 0, 0, 2, 0, 0]), Resources: doc.context.obj({ XObject: doc.context.obj({ Fm1: inner }) }) });
        return { XObject: doc.context.obj({ Fm0: outer }) };
      },
    });
    // The form's line: (0,0)-(100,0) doubled, then moved by (50,60). The form inside the form is not read.
    expect(rounded(got)).toEqual(rounded([{ x0: 50, y0: 732, x1: 250, y1: 732 }]));
  });

  it('gives display coordinates on a page with a crop box, a turn and a page unit', async () => {
    const got = await segmentsOf('100 200 m 300 200 l S', { size: [600, 800], userUnit: 2 }, (doc) => {
      const page = doc.getPage(0);
      page.setCropBox(50, 100, 500, 600);
      page.node.set(PDFName.of('Rotate'), doc.context.obj(90));
    });
    // Turned 90 the line runs down the page: x = (200 - 100) * 2, y from (100 - 50) * 2 to (300 - 50) * 2.
    expect(rounded(got)).toEqual(rounded([{ x0: 200, y0: 100, x1: 200, y1: 500 }]));
  });

  it('gives nothing for content it cannot read with certainty, a page that is not there, or a drawing of too many pieces', async () => {
    expect(await segmentsOf('', { content: new Uint8Array([1, 2, 3]), streamDict: () => ({ Filter: 'DCTDecode' }) })).toEqual([]);
    // One part of the page's content cannot be read: the readable part alone is not the page.
    const mixed = await segmentsOf('0 0 m 100 0 l S', {}, (doc) => {
      const node = doc.getPage(0).node;
      const unreadable = doc.context.register(doc.context.stream(new Uint8Array([1, 2, 3]), { Filter: 'DCTDecode' }));
      node.set(PDFName.of('Contents'), doc.context.obj([node.get(PDFName.of('Contents'))!, unreadable]));
    });
    expect(mixed).toEqual([]);
    const doc = await PDFDocument.load(await makeRawPdf({ content: '0 0 m 100 0 l S' }));
    expect(pageSegments(doc, 1)).toEqual([]);
    expect(pageSegments(doc, -1)).toEqual([]);
    expect(pageSegments(doc, 0)).toHaveLength(1);
    const many = Array.from({ length: MAX_PAGE_SEGMENTS + 1 }, (_, i) => `0 ${i % 700} m 100 ${i % 700} l S`).join('\n');
    expect(await segmentsOf(many)).toEqual([]);
    expect(await segmentsOf(many.split('\n').slice(0, 500).join('\n'))).toHaveLength(500);
  });

  it('reads a dense ruled page quickly', async () => {
    // 60 rows of 12 cells, each cell its own stroked rectangle: 2,880 pieces.
    const cells: string[] = [];
    for (let r = 0; r < 60; r++) for (let c = 0; c < 12; c++) cells.push(`${20 + c * 46} ${40 + r * 12} 46 12 re S`);
    const doc = await PDFDocument.load(await makeRawPdf({ content: cells.join('\n') }));
    pageSegments(doc, 0);
    const start = performance.now();
    const got = pageSegments(doc, 0);
    const ms = performance.now() - start;
    console.info(`pageSegments on a dense ruled page (${got.length} pieces): ${ms.toFixed(1)} ms`);
    expect(got).toHaveLength(2880);
    expect(ms).toBeLessThan(150);
  });
});
