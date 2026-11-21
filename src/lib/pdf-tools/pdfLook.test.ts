import { PDFDocument, PDFName, PDFStream, StandardFonts, type PDFDict } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { pageDrawings } from './rulingLines';
import { fontFileLook, fontLook } from './pdfFontLook';
import { encodePng, pictureFile } from './pdfPictures';

async function lookOf(base: string, descriptor?: Record<string, number | string>) {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: base, ...(descriptor ? { FontDescriptor: doc.context.obj({ Type: 'FontDescriptor', ...descriptor }) } : {}) });
  return fontLook(dict as PDFDict);
}

describe('fontLook: the family and weight a font states about itself', () => {
  it('reads names as fonts write them, without the subset prefix', async () => {
    expect(await lookOf('ABCDEF+Arial-BoldMT')).toEqual({ family: 'Arial', bold: true, italic: false });
    expect(await lookOf('TimesNewRomanPS-BoldItalicMT')).toEqual({ family: 'Times New Roman', bold: true, italic: true });
    expect(await lookOf('TrebuchetMS')).toEqual({ family: 'Trebuchet MS', bold: false, italic: false });
    expect(await lookOf('Calibri,Italic')).toEqual({ family: 'Calibri', bold: false, italic: true });
    expect(await lookOf('Helvetica-Oblique')).toEqual({ family: 'Arial', bold: false, italic: true });
    expect(await lookOf('Courier')).toEqual({ family: 'Courier New', bold: false, italic: false });
  });

  it('keeps the fonts of signs Windows ships as themselves (their letters are signs: a tick, a box), and names a rupee font (round 3)', async () => {
    expect(await lookOf('ABCDEF+Wingdings-Regular')).toMatchObject({ family: 'Wingdings' });
    expect(await lookOf('Wingdings2')).toMatchObject({ family: 'Wingdings 2' });
    expect(await lookOf('ABCDEF+Webdings')).toMatchObject({ family: 'Webdings' });
    expect(await lookOf('ABCDEF+SymbolMT')).toMatchObject({ family: 'Symbol' });
    expect(await lookOf('ABCDEF+SampleRupee')).toEqual({ family: 'Arial', bold: false, italic: false, signs: 'rupee' });
  });

  it('falls back to a family of the same class, and takes weight and slant from the descriptor', async () => {
    expect(await lookOf('QWERTY+SomeUnknownFace', { Flags: 2 | 64, FontWeight: 700 })).toEqual({ family: 'Times New Roman', bold: true, italic: true });
    expect(await lookOf('SomeUnknownFace', { Flags: 1 })).toMatchObject({ family: 'Courier New' });
    expect(await lookOf('CIDFont+F1', { Flags: 4 })).toMatchObject({ family: 'Arial', bold: false });
  });

  it('reads the family name and weight an embedded font file holds', () => {
    // A font file with two tables: OS/2 (weight 700, bold bit) and name (family "Verdana", Windows, English).
    const name = 'Verdana';
    const bytes = new Uint8Array(12 + 32 + 96 + 6 + 12 + name.length * 2);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 2);
    const table = (i: number, tag: string, offset: number, length: number) => {
      for (let k = 0; k < 4; k++) bytes[12 + i * 16 + k] = tag.charCodeAt(k);
      view.setUint32(12 + i * 16 + 8, offset);
      view.setUint32(12 + i * 16 + 12, length);
    };
    table(0, 'OS/2', 44, 96);
    table(1, 'name', 140, 18 + name.length * 2);
    view.setUint16(44 + 4, 700);
    view.setUint16(44 + 62, 32);
    view.setUint16(140 + 2, 1);
    view.setUint16(140 + 4, 18);
    view.setUint16(146, 3);
    view.setUint16(146 + 2, 1);
    view.setUint16(146 + 4, 0x409);
    view.setUint16(146 + 6, 1);
    view.setUint16(146 + 8, name.length * 2);
    view.setUint16(146 + 10, 0);
    for (let k = 0; k < name.length; k++) view.setUint16(158 + k * 2, name.charCodeAt(k));
    expect(fontFileLook(bytes)).toEqual({ family: 'Verdana', bold: true, italic: false });
    expect(fontFileLook(new Uint8Array(8))).toBeNull();
  });
});

describe('pictures of a page as files', () => {
  it('writes a PNG that a PDF library reads back with its size', async () => {
    const png = encodePng(new Uint8Array(70_000 * 3).fill(200), 350, 200, 3);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(png);
    expect([image.width, image.height]).toEqual([350, 200]);
  });

  it('gives a grey picture drawn on a page back as a PNG, and null for a kind it does not read', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawImage(await doc.embedPng(encodePng(new Uint8Array(16).fill(9), 4, 4, 1)), { x: 10, y: 10, width: 40, height: 40 });
    const loaded = await PDFDocument.load(await doc.save());
    const stream = loaded.context.enumerateIndirectObjects().map(([, object]) => object).find((object): object is PDFStream => object instanceof PDFStream && object.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'))!;
    expect(pictureFile(stream)).toMatchObject({ type: 'png', width: 4, height: 4 });
    stream.dict.set(PDFName.of('Filter'), PDFName.of('JPXDecode'));
    expect(pictureFile(stream)).toBeNull();
  });
});

describe('the colour text is drawn in, when it is an ink of its own (a separation)', () => {
  /** A page that sets the fill colour as `tint` of an ink named in its resources, then draws a word. */
  async function colourOf(ink: unknown[], tint: string): Promise<string> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('x', { x: 5, y: 5, size: 4, font });
    page.node.normalize();
    const resources = page.node.Resources()!;
    resources.set(PDFName.of('ColorSpace'), doc.context.obj({ Cs8: ink } as Parameters<typeof doc.context.obj>[0]));
    const fontName = (resources.lookup(PDFName.of('Font')) as PDFDict).keys()[0].asString();
    const stream = doc.context.stream(`/Cs8 cs ${tint} scn BT ${fontName} 10 Tf 50 100 Td (Ink) Tj ET`);
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
    const reread = await PDFDocument.load(await doc.save());
    const starts = pageDrawings(reread, 0).starts;
    expect(starts).toHaveLength(1);
    return starts[0].color;
  }
  const fn = (c0: number[], c1: number[]) => ({ FunctionType: 2, Domain: [0, 1], C0: c0, C1: c1, N: 1 });

  it('reads the full tint of a black ink as black, not as white', async () => {
    expect(await colourOf(['Separation', 'Black', 'DeviceCMYK', fn([0, 0, 0, 0], [0, 0, 0, 1])], '1')).toBe('000000');
    expect(await colourOf(['Separation', 'Black', 'DeviceCMYK', fn([0, 0, 0, 0], [0, 0, 0, 1])], '0.5')).toBe('808080');
  });

  it('reads a coloured ink through the colour its tint stands for', async () => {
    expect(await colourOf(['Separation', 'SampleGreen', 'DeviceCMYK', fn([0, 0, 0, 0], [1, 0, 1, 0])], '1')).toBe('00FF00');
    expect(await colourOf(['Separation', 'SampleRed', 'DeviceRGB', fn([1, 1, 1], [1, 0, 0])], '1')).toBe('FF0000');
  });

  it('takes an ink whose colour it cannot work out as grey by its tint (full ink dark), never as white', async () => {
    expect(await colourOf(['Separation', 'Unknown', 'DeviceCMYK', { FunctionType: 4, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1] }], '1')).toBe('000000');
  });
});

describe('pageDrawings: strokes that run neither across nor down the page (round 3)', () => {
  it('gives the two strokes of a drawn tick with their ends, and keeps them out of the ruling lines', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    // A tick in a box at the left: down to its foot at (104, 96), then up to the right.
    const stream = doc.context.stream('0.5 w 100 100 m 104 96 l S 104 96 m 112 108 l S 20 50 m 280 50 l S');
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
    const reread = await PDFDocument.load(await doc.save());
    const drawings = pageDrawings(reread, 0);
    expect(drawings.segments).toHaveLength(1);
    expect(drawings.strokes.map((q) => [q.x0, q.y0, q.x1, q.y1].map(Math.round))).toEqual([[100, 100, 104, 104], [104, 104, 112, 92]]);
  });
});
