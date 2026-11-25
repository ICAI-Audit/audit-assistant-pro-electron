import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeFormPdf, makePdf, pageTexts } from './testPdf';
import { changedPixels, makePositionsPdf, makePredictorPdf, makeRawPdf, makeScanPdf, makeSharedPagesPdf, makeStrayPdf, solidPng, solidPngRgba } from './testMarksPdf';
import { addWatermark, describeWatermark, emptyMarkReport, fillStampTokens, watermarkError, WATERMARK_DEFAULTS, type WatermarkOptions } from './watermark';

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);

const wm = (over: Partial<NonNullable<WatermarkOptions['watermark']>> = {}): NonNullable<WatermarkOptions['watermark']> => ({
  ...WATERMARK_DEFAULTS.watermark,
  placement: { ...WATERMARK_DEFAULTS.watermark.placement },
  ...over,
});
const base = (over: Partial<WatermarkOptions> = {}): WatermarkOptions => ({
  watermark: wm(),
  pages: { from: 1, to: 5 },
  tokens: { date: '14-11-2026', client: 'ABC Ltd' },
  ...over,
});
const stamp = (text = 'VERIFIED'): NonNullable<WatermarkOptions['stamp']> => ({ ...WATERMARK_DEFAULTS.stamp, text, placement: { ...WATERMARK_DEFAULTS.stamp.placement } });
const logoOf = (image: Uint8Array): NonNullable<WatermarkOptions['logo']> => ({ image, format: 'png', ...WATERMARK_DEFAULTS.logo, placement: { ...WATERMARK_DEFAULTS.logo.placement } });

describe('addWatermark', () => {
  it('marks the chosen pages only, with real searchable text', async () => {
    const out = await addWatermark(await makePdf('W', 5), base({ pages: { from: 2, to: 3 } }));
    const texts = await pageTexts(out);
    expect(texts.map((t) => t.includes('DRAFT'))).toEqual([false, true, true, false, false]);
    expect(texts[1]).toContain('W p2');
  });

  it('first page only', async () => {
    const out = await addWatermark(await makePdf('W', 3), base({ pages: 'first', watermark: undefined, stamp: stamp() }));
    expect((await pageTexts(out)).map((t) => t.includes('VERIFIED'))).toEqual([true, false, false]);
  });

  const centres: [number, number][] = [[306, 396], [396, 306], [306, 396], [396, 306], [182, 332]];

  it('centres a diagonal watermark on every displayed page, turned or cropped', async () => {
    const src = await makePositionsPdf();
    const out = await addWatermark(src, base({ watermark: wm({ size: 96 }) }));
    for (let p = 1; p <= 5; p++) {
      const c = await changedPixels(src, out, p);
      expect(Math.abs(c.centre![0] - centres[p - 1][0])).toBeLessThanOrEqual(6);
      expect(Math.abs(c.centre![1] - centres[p - 1][1])).toBeLessThanOrEqual(6);
    }
  });

  it('with automatic size, fills most of the diagonal, stays on the page and is centred to within the shape of its letters', async () => {
    const src = await makePositionsPdf();
    const out = await addWatermark(src, base());
    for (let p = 1; p <= 5; p++) {
      const c = await changedPixels(src, out, p);
      const [x0, y0, x1, y1] = c.bbox!;
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThan(c.width);
      expect(y1).toBeLessThan(c.height);
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeGreaterThan(0.6 * Math.hypot(c.width, c.height));
      expect(Math.abs(c.centre![0] - centres[p - 1][0])).toBeLessThanOrEqual(14);
      expect(Math.abs(c.centre![1] - centres[p - 1][1])).toBeLessThanOrEqual(14);
    }
  });

  it('fills {date} and {client} in the stamp and the watermark from the tokens, in any letter case', async () => {
    const out = await addWatermark(await makePdf('S', 1), base({ watermark: wm({ text: 'FOR {Client}', size: 30, angle: 0 }), stamp: { ...stamp('PAID {date} {CLIENT}'), size: 10 }, pages: { from: 1, to: 1 } }));
    const text = (await pageTexts(out))[0];
    expect(text).toContain('PAID 14-11-2026 ABC Ltd');
    expect(text).toContain('FOR ABC Ltd');
    expect(fillStampTokens('{date}{date}', { date: '$&', client: 'x' })).toBe('$&$&');
  });

  it('draws a logo from the image bytes, embedded once for every page', async () => {
    const src = await makeSharedPagesPdf(6);
    const out = await addWatermark(src, base({ watermark: undefined, logo: logoOf(solidPng(200, 100, [0, 0, 200])), pages: { from: 1, to: 6 } }));
    const doc = await PDFDocument.load(out);
    const images = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(1);
    const c = await changedPixels(src, out, 3);
    expect(Math.abs(c.bbox![2] - c.bbox![0] + 1 - 0.18 * 300)).toBeLessThanOrEqual(1.5);
  });

  it('refuses characters the built-in font cannot draw, naming them, and returns nothing', async () => {
    const src = await makePdf('H', 1);
    const cases: [WatermarkOptions, string][] = [
      [base({ watermark: wm({ text: 'गोपनीय' }) }), 'ग'],
      [base({ watermark: undefined, stamp: stamp('PAID ₹') }), '₹'],
      [base({ watermark: undefined, stamp: stamp('{client}'), tokens: { date: 'x', client: '😀' } }), '😀'],
    ];
    for (const [options, ch] of cases) {
      const err = await addWatermark(src, { ...options, pages: { from: 1, to: 1 } }).catch((e) => e);
      expect(err).toMatchObject({ name: 'PdfToolsError', code: 'unsupported-characters' });
      expect(err.message).toContain(ch);
    }
  });

  it('does not change the source bytes', async () => {
    const src = await makePdf('K', 2);
    const copy = src.slice();
    await addWatermark(src, base({ pages: { from: 1, to: 2 } }));
    expect(src).toEqual(copy);
  });

  it('reports each page to the caller and stops when the caller throws', async () => {
    const seen: number[] = [];
    await addWatermark(await makePdf('P', 4), base({ pages: { from: 1, to: 4 } }), { onPage: (done, total) => void seen.push(done * 10 + total) });
    expect(seen).toEqual([4, 14, 24, 34, 44]);
    await expect(addWatermark(await makePdf('P', 4), base({ pages: { from: 1, to: 4 } }), { onPage: (done) => { if (done === 2) throw new Error('stop'); } })).rejects.toThrow('stop');
  });
});

describe('addWatermark: what it tells the caller', () => {
  it('lists the pages where a watermark behind the page is hidden', async () => {
    const behind = emptyMarkReport();
    await addWatermark(await makeScanPdf(), base({ watermark: wm({ layer: 'behind' }), pages: { from: 1, to: 1 } }), { report: behind });
    expect(behind.hiddenBehind).toEqual([1]);
    const inFront = emptyMarkReport();
    await addWatermark(await makeScanPdf(), base({ pages: { from: 1, to: 1 } }), { report: inFront });
    expect(inFront.hiddenBehind).toEqual([]);
  });

  it('lists pages with form fields under a mark in front, and damaged pages', async () => {
    const report = emptyMarkReport();
    await addWatermark(await makeFormPdf(), base({ pages: { from: 1, to: 3 } }), { report });
    expect(report.underFields).toEqual([1, 2, 3]);
    const damaged = emptyMarkReport();
    await addWatermark(await makeStrayPdf('extra-q'), base({ pages: { from: 1, to: 1 } }), { report: damaged });
    expect(damaged.damaged).toEqual([1]);
    const behind = emptyMarkReport();
    await addWatermark(await makeStrayPdf('extra-q'), base({ watermark: wm({ layer: 'behind' }), pages: { from: 1, to: 1 } }), { report: behind });
    expect(behind.damaged).toEqual([]);
  });
});

describe('watermarkError and addWatermark options', () => {
  const bad: [string, WatermarkOptions][] = [
    ['nothing on', base({ watermark: undefined })],
    ['empty text', base({ watermark: wm({ text: '   ' }) })],
    ['61 characters', base({ watermark: wm({ text: 'x'.repeat(61) }) })],
    ['size 11', base({ watermark: wm({ size: 11 }) })],
    ['angle 91', base({ watermark: wm({ angle: 91 }) })],
    ['opacity 0.01', base({ watermark: wm({ opacity: 0.01 }) })],
    ['colour 2', base({ watermark: wm({ color: { r: 2, g: 0, b: 0 } }) })],
    ['stamp size 80', base({ stamp: { ...stamp(), size: 80 } })],
    ['logo share 0.9', base({ logo: { ...logoOf(solidPng(4, 4, [0, 0, 0])), widthShare: 0.9 } })],
    ['range 4-2', base({ pages: { from: 4, to: 2 } })],
    ['range past end', base({ pages: { from: 1, to: 6 } })],
    ['point outside', base({ watermark: wm({ placement: { point: { u: 2, v: 0 } } }) })],
  ];
  for (const [name, options] of bad) {
    it(`rejects ${name}`, async () => {
      expect(watermarkError(options, 5)).toEqual(expect.any(String));
      await expect(addWatermark(await makePdf('A', 5), options)).rejects.toMatchObject({ code: 'invalid-watermark-options' });
    });
  }
  it('accepts the defaults', () => {
    expect(watermarkError(base(), 5)).toBeNull();
    expect(watermarkError(base({ pages: 'first' }), 5)).toBeNull();
  });
  it('names the first page a stamp does not fit', async () => {
    const doc = await PDFDocument.create();
    for (const w of [300, 60, 300]) doc.addPage([w, 400]);
    await expect(addWatermark(await doc.save(), base({ watermark: undefined, stamp: stamp('VERIFIED VERIFIED'), pages: { from: 1, to: 3 } })))
      .rejects.toMatchObject({ code: 'invalid-watermark-options', message: expect.stringContaining('page 2') });
  });
  it('rejects bytes that are not a PDF', async () => {
    await expect(addWatermark(new Uint8Array([1, 2, 3]), base())).rejects.toMatchObject({ code: 'not-a-pdf' });
  });
  it('rejects an unreadable logo and a huge PNG', async () => {
    const logo = (image: Uint8Array) => base({ watermark: undefined, logo: logoOf(image), pages: { from: 1, to: 1 } });
    await expect(addWatermark(await makePdf('A', 1), logo(new Uint8Array([1, 2, 3, 4])))).rejects.toMatchObject({ code: 'invalid-watermark-options' });
    const huge = solidPng(4, 4, [0, 0, 0]);
    new DataView(huge.buffer).setUint32(16, 6000);
    new DataView(huge.buffer).setUint32(20, 6000);
    await expect(addWatermark(await makePdf('A', 1), logo(huge))).rejects.toMatchObject({ message: expect.stringContaining('too large') });
  });
});

describe('describeWatermark', () => {
  it('names the parts and the pages, with what each text was in the words of the record, never the text as typed (REV-B B1)', () => {
    const o = base({ stamp: stamp('VERIFIED'), logo: logoOf(new Uint8Array([1])), pages: { from: 1, to: 12 } });
    expect(describeWatermark(o, 30, { watermark: 'DRAFT', stamp: 'VERIFIED' })).toBe('Watermark DRAFT, stamp VERIFIED, logo, pages 1-12');
    expect(describeWatermark({ ...o, watermark: wm({ text: 'ACME LTD' }) }, 12, { watermark: '(custom text)', stamp: 'VERIFIED' })).toBe('Watermark (custom text), stamp VERIFIED, logo, all pages');
    // without the record's words the parts are only named: nothing typed is ever written
    expect(describeWatermark({ ...o, watermark: wm({ text: 'ACME LTD' }) }, 12)).toBe('Watermark, stamp, logo, all pages');
    expect(describeWatermark(base({ watermark: undefined, stamp: stamp(), pages: 'first' }), 9, { stamp: 'VERIFIED' })).toBe('Stamp VERIFIED, page 1');
  });
});

describe('addWatermark: size', () => {
  it('grows in line with the page count when pages share one resource dictionary', async () => {
    const added: number[] = [];
    for (const n of [150, 300, 600]) {
      const src = await makeSharedPagesPdf(n, 40);
      const out = await addWatermark(src, base({ stamp: stamp(), pages: { from: 1, to: n } }));
      added.push(out.length - src.length);
    }
    expect(added[2] / added[1]).toBeLessThan(2.3);
    expect(added[1] / added[0]).toBeLessThan(2.3);
    expect(added[1] / 300).toBeLessThan(1200);
  });
});

describe('fix round 1', () => {
  it('F1: a page whose content cannot be trusted is reported and still marked', async () => {
    const report = emptyMarkReport();
    const out = await addWatermark(await makePredictorPdf({ colors: 3 }), base({ pages: { from: 1, to: 1 } }), { report });
    expect(report.unverified).toEqual([1]);
    expect((await pageTexts(out))[0]).toContain('DRAFT');
  });

  describe('F3: the default watermark stays whole on every page shape (rendered, nothing touches an edge)', () => {
    const shapes: [string, [number, number]][] = [['receipt 80 mm', [226.8, 800]], ['short wide strip', [600, 120]], ['A5', [419.5, 595.3]], ['A4', [595.3, 841.9]], ['A3', [841.9, 1190.6]], ['A4 landscape', [841.9, 595.3]]];
    for (const [name, size] of shapes) {
      for (const text of ['DRAFT', 'COPY']) {
        it(`${text} on a ${name} page`, async () => {
          const src = await makeRawPdf({ content: ' ', size });
          const out = await addWatermark(src, base({ watermark: wm({ text }), pages: { from: 1, to: 1 } }));
          const c = await changedPixels(src, out, 1);
          const [x0, y0, x1, y1] = c.bbox!;
          expect(x0).toBeGreaterThanOrEqual(1);
          expect(y0).toBeGreaterThanOrEqual(1);
          expect(x1).toBeLessThanOrEqual(c.width - 2);
          expect(y1).toBeLessThanOrEqual(c.height - 2);
          expect(c.count).toBeGreaterThan(300);
        });
      }
    }
  });

  it('F6: stamp and watermark texts take {date} and {client} in any case, and name any other token', () => {
    expect(watermarkError(base({ stamp: stamp('PAID {Dat}') }), 5)).toContain('{Dat}');
    expect(watermarkError(base({ stamp: stamp('PAID {page}') }), 5)).toContain('{page}');
    expect(watermarkError(base({ watermark: wm({ text: 'COPY {Foo}' }) }), 5)).toContain('{Foo}');
    expect(watermarkError(base({ watermark: wm({ text: 'COPY FOR {CLIENT}' }), stamp: stamp('{Date} {client}') }), 5)).toBeNull();
    expect(watermarkError(base({ stamp: stamp('a lone { brace') }), 5)).toBeNull();
  });

  it('F9: a watermark larger than the page is reported as cut off, the default is not', async () => {
    const big = emptyMarkReport();
    await addWatermark(await makePdf('A', 1, { size: [595, 842] }), base({ watermark: wm({ text: 'NOT FOR CIRCULATION', size: 200, angle: 0 }), pages: { from: 1, to: 1 } }), { report: big });
    expect(big.clipped).toEqual([1]);
    const fine = emptyMarkReport();
    await addWatermark(await makePdf('A', 1, { size: [595, 842] }), base({ pages: { from: 1, to: 1 } }), { report: fine });
    expect(fine.clipped).toEqual([]);
  });

  it('F10: a JPEG logo is refused above the same pixel limit as a PNG, from its header', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x17, 0x70, 0x17, 0x70, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
    const err = await addWatermark(await makePdf('A', 1), base({ watermark: undefined, logo: { ...logoOf(jpeg), format: 'jpeg' }, pages: { from: 1, to: 1 } })).catch((e) => e);
    expect(err).toMatchObject({ code: 'invalid-watermark-options', message: expect.stringContaining('too large') });
  });
});

describe('R2: hidden behind, clip paths, patterns, shadings, several rectangles, soft masks', () => {
  const body = 'BT /F1 12 Tf 100 700 Td (Body) Tj ET\n';
  const png = async (doc: PDFDocument, bytes: Uint8Array) => ({ XObject: doc.context.obj({ Im0: (await doc.embedPng(bytes)).ref }) });
  type Verdict = 'hidden' | 'silent' | 'uncertain';
  const small = { size: 30, angle: 0 } as const;
  const cases: [string, () => Promise<Uint8Array>, Verdict, Partial<NonNullable<WatermarkOptions['watermark']>>?][] = [
    // the earlier seven
    ['a 10 pt page frame painted with f*', () => makeRawPdf({ content: `${body}0.8 g 0 0 612 792 re 10 10 592 772 re f*` }), 'silent'],
    ['a page-size fill at 10% opacity', () => makeRawPdf({ content: `${body}/GS1 gs 0.9 g 0 0 612 792 re f`, resources: (d) => ({ ExtGState: d.context.obj({ GS1: d.context.obj({ Type: 'ExtGState', ca: 0.1 }) }) }) }), 'silent'],
    ['plain text', () => makeRawPdf({ content: body }), 'silent'],
    ['a page-size white background', () => makeRawPdf({ content: `1 g 0 0 612 792 re f\n${body}0 g\n` }), 'hidden'],
    ['a centred picture covering 75% of the page', () => makeRawPdf({ content: `${body}q 530 0 0 686 41 53 cm /Im0 Do Q`, resources: (d) => png(d, solidPng(8, 8, [60, 60, 160])) }), 'hidden'],
    ['a full-page inline image', () => makeRawPdf({ content: `${body}q 612 0 0 792 0 0 cm BI /W 1 /H 1 /CS /G /BPC 8 ID 8\nEI Q` }), 'hidden'],
    ['a full-page scan', makeScanPdf, 'hidden'],
    // the reviewer's five
    ['a sparse tiling pattern fill over the whole page', () => makeRawPdf({
      content: `${body}/Pattern cs /P1 scn 0 0 612 792 re f`,
      resources: (d) => ({ Pattern: d.context.obj({ P1: d.context.register(d.context.stream('0 0 1 1 re f', d.context.obj({ Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 20, 20], XStep: 20, YStep: 20, Resources: d.context.obj({}) }) as never)) }) }),
    }), 'uncertain'],
    ['a full-page image clipped to a 100 x 100 corner', () => makeRawPdf({ content: `${body}q 0 692 100 100 re W n 612 0 0 792 0 0 cm /Im0 Do Q`, resources: (d) => png(d, solidPng(8, 8, [60, 60, 160])) }), 'silent'],
    ['a full-page shading (sh)', () => makeRawPdf({
      content: `${body}/Sh1 sh`,
      resources: (d) => ({ Shading: d.context.obj({ Sh1: d.context.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 612, 792], Extend: [true, true], Function: d.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [1, 1, 1], C1: [0.8, 0.8, 1], N: 1 }) }) }) }),
    }), 'hidden'],
    ['two rectangles in one fill that together cover the page', () => makeRawPdf({ content: `${body}0.9 g 0 0 612 400 re 0 400 612 392 re f` }), 'hidden'],
    ['a full-page scan with a nearly opaque soft mask', () => makeRawPdf({ content: `${body}q 612 0 0 792 0 0 cm /Im0 Do Q`, resources: (d) => png(d, solidPngRgba(8, 8, [60, 60, 160, 252])) }), 'hidden'],
    ['a full-page picture with a mostly transparent soft mask', () => makeRawPdf({ content: `${body}q 612 0 0 792 0 0 cm /Im0 Do Q`, resources: (d) => png(d, solidPngRgba(8, 8, [60, 60, 160, 20])) }), 'silent'],
    ['a full-page picture with a half-transparent soft mask', () => makeRawPdf({ content: `${body}q 612 0 0 792 0 0 cm /Im0 Do Q`, resources: (d) => png(d, solidPngRgba(8, 8, [60, 60, 160, 128])) }), 'silent'],
    ['a centred picture covering 60% of the page, with a small watermark in the corner', () => makeRawPdf({ content: `${body}q 474 0 0 614 69 89 cm /Im0 Do Q`, resources: (d) => png(d, solidPng(8, 8, [60, 60, 160])) }), 'silent', { ...small, placement: { anchor: 'bottom-left', padPt: 20 } }],
    ['a picture only in the centre, with a centred watermark', () => makeRawPdf({ content: `${body}q 240 0 0 120 186 336 cm /Im0 Do Q`, resources: (d) => png(d, solidPng(8, 8, [60, 60, 160])) }), 'hidden', { ...small, size: 24 }],
  ];
  for (const [name, build, verdict, mark] of cases) {
    it(`${verdict} for ${name}, and the pixels agree`, async () => {
      const src = await build();
      const behind = emptyMarkReport();
      const outBehind = await addWatermark(src, base({ watermark: wm({ layer: 'behind', ...mark }), pages: { from: 1, to: 1 } }), { report: behind });
      const outFront = await addWatermark(src, base({ watermark: wm({ ...mark }), pages: { from: 1, to: 1 } }));
      expect(behind.hiddenBehind).toEqual(verdict === 'hidden' ? [1] : []);
      expect(behind.uncertain).toEqual(verdict === 'uncertain' ? [1] : []);
      const seen = (await changedPixels(src, outBehind, 1)).count;
      const would = (await changedPixels(src, outFront, 1)).count;
      if (verdict === 'hidden') expect(seen / would).toBeLessThan(0.5);
      else expect(seen / would).toBeGreaterThan(0.8); // uncertain: the sparse pattern really leaves it visible
    });
  }
});

// REV-A (15 November 2026): a self-drawing form behind, damaged page attributes, a page listed twice,
// empty filled text (in the dialog's words), a page with no size, the modification date.
describe('REV-A fixes in Watermark', () => {
  const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  /** A PDF written by hand, object by object (1 is the catalog), so damage can be exact. */
  function rawPdf(objects: string[]): Uint8Array {
    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return enc(out);
  }
  const onePage = (extra: string) =>
    rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R ${extra} /Contents 4 0 R >>`, '<< /Length 13 >>\nstream\n0 0 m 1 1 l S\nendstream']);
  const one = (over: Partial<WatermarkOptions> = {}) => base({ pages: { from: 1, to: 1 }, ...over });

  it('B4: a 6 KB page whose form draws itself is checked within a budget behind, and said to be uncertain', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const formRef = doc.context.nextRef();
    const res = doc.context.obj({ XObject: doc.context.obj({ X: formRef }) });
    const inner = Array.from({ length: 1000 }, () => '/X Do').join('\n');
    doc.context.assign(formRef, doc.context.flateStream(inner, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: res } as never));
    page.node.set(PDFName.of('Resources'), res);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(inner)));
    const report = emptyMarkReport();
    const out = await addWatermark(await doc.save({ useObjectStreams: false }), one({ watermark: wm({ layer: 'behind' }) }), { report });
    expect(report.uncertain).toEqual([1]);
    expect(report.hiddenBehind).toEqual([]);
    expect((await pageTexts(out))[0]).toContain('DRAFT');
  });

  it('S2: a page whose box or turn cannot be read is refused plainly, naming the page; odd annotations or resources are read as none', async () => {
    for (const extra of ['', '/MediaBox [0 0 612]', '/MediaBox [0 0 612 792] /Rotate /Ninety', '/MediaBox [0 0 612 792] /CropBox /None']) {
      const err = await addWatermark(onePage(extra), one()).catch((e) => e);
      expect(err, extra).toMatchObject({ name: 'PdfToolsError', code: 'invalid-watermark-options', message: 'Page 1 could not be read, so it cannot be marked. The file may be damaged.' });
    }
    const cycle = rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 2 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>']);
    await expect(addWatermark(cycle, one())).rejects.toMatchObject({ code: 'invalid-watermark-options', message: expect.stringContaining('Page 1 could not be read') });
    for (const extra of ['/MediaBox [0 0 612 792] /Annots << >>', '/MediaBox [0 0 612 792] /Resources 5', '/MediaBox [0 0 612 792] /Resources << /Font 5 /ExtGState /bad >>']) {
      const out = await addWatermark(onePage(extra), one({ watermark: wm({ opacity: 0.5 }) }), { report: emptyMarkReport() });
      expect((await pageTexts(out))[0], extra).toContain('DRAFT');
    }
  });

  it('S2: a file with no pages is refused for "first page" in plain words', async () => {
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    await expect(addWatermark(empty, one({ pages: 'first' }))).rejects.toMatchObject({ code: 'invalid-watermark-options', message: 'This file has no pages to mark.' });
  });

  it('S6: one page listed twice in the page tree is refused, naming both places', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const tree = doc.catalog.Pages();
    const kids = tree.lookup(PDFName.of('Kids'), PDFArray);
    kids.push(kids.get(0));
    tree.set(PDFName.of('Count'), PDFNumber.of(2));
    const twice = await doc.save();
    for (const pages of [{ from: 1, to: 2 }, { from: 2, to: 2 }, { from: 1, to: 1 }]) {
      await expect(addWatermark(twice, base({ pages })), JSON.stringify(pages)).rejects.toMatchObject({
        code: 'invalid-watermark-options',
        message: 'Pages 1 and 2 are one page listed twice in this file, so they cannot be marked separately. The file may be damaged.',
      });
    }
  });

  it('M4: a text that is only {client} with no client name is refused; without tokens a token is filled with nothing', async () => {
    const src = await makePdf('T', 1);
    await expect(addWatermark(src, one({ watermark: wm({ text: '{client}' }), tokens: { date: '', client: '' } }))).rejects.toMatchObject({
      code: 'invalid-watermark-options',
      message: 'This engagement has no client name, so the watermark would be empty. Type the text instead.',
    });
    await expect(addWatermark(src, one({ watermark: undefined, stamp: stamp('{client} {date}'), tokens: { date: ' ', client: '' } }))).rejects.toMatchObject({
      message: 'This engagement has no client name, so the stamp would be empty. Type the text instead.',
    });
    const out = await addWatermark(src, { ...one({ watermark: wm({ text: 'FOR {client}', size: 30, angle: 0 }) }), tokens: undefined as never });
    expect((await pageTexts(out))[0]).toContain('FOR');
  });

  it('M5: a page with no size is refused, naming it', async () => {
    await expect(addWatermark(onePage('/MediaBox [0 0 0 0]'), one())).rejects.toMatchObject({ code: 'invalid-watermark-options', message: 'Page 1 has no size, so it cannot be marked. The file may be damaged.' });
  });

  it('S12: the result gets our Producer and a new modification date; the source Creator stays', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([612, 792]);
    doc.setCreator('Tally');
    doc.setModificationDate(new Date('2020-01-01T00:00:00Z'));
    const out = await PDFDocument.load(await addWatermark(await doc.save(), one()), { updateMetadata: false });
    expect(out.getCreator()).toBe('Tally');
    expect(out.getProducer()).toBe('ICAI VERA');
    expect(out.getModificationDate()!.getFullYear()).toBeGreaterThan(2020);
  });
});

// FIX-A2 follow-up (INT3 concern 1): a Stop pressed while the file is still being read ends the run within the
// read, with the run's own error, never "could not be read".
describe('Watermark: Stop while the file is read', () => {
  class Stopped extends Error {}
  it('stops with the run’s own error', async () => {
    let clock = 0;
    // A clock that runs 60 ms between two looks at it: every look finds a turn due, so the read waits often.
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60));
    try {
      const stop = new Stopped('watermark');
      const error = await addWatermark(await makePdf('W', 3), base({ pages: { from: 1, to: 3 } }), { check: () => { throw stop; } }).catch((e: unknown) => e);
      expect(error).toBe(stop);
    } finally {
      spy.mockRestore();
    }
  });
});
