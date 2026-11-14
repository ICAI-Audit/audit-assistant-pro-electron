import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  type PDFPage,
} from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { COMPRESS_LEVELS, compressPdf, type CompressLevel, type ImageRecoder, type RecodeRequest } from './compress';
import { inspectPdf } from './inspect';
import { makePdf, pageTexts } from './testPdf';

vi.setConfig({ testTimeout: 30_000 });

// The first pdfjs load is slow on a busy machine; do it once, outside any test's time limit.
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);

const A4: [number, number] = [595.28, 841.89];

// Deterministic bytes that do not deflate, so stream sizes stay predictable.
function noise(length: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(length);
  let x = seed | 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i] = x & 0xff;
  }
  return bytes;
}

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

interface FakeImage {
  kind: 'jpeg' | 'raw';
  width: number;
  height: number;
  payloadBytes?: number; // jpeg only; the fake recoders never decode it
  colorSpace?: 'DeviceRGB' | 'DeviceGray';
}

function addImageObject(doc: PDFDocument, entries: Record<string, unknown>, contents: Uint8Array): PDFRef {
  return doc.context.register(doc.context.stream(contents, { Type: 'XObject', Subtype: 'Image', ...(entries as object) }));
}

function addImage(doc: PDFDocument, image: FakeImage, seed = 1): PDFRef {
  const colorSpace = image.colorSpace ?? 'DeviceRGB';
  const entries = { Width: image.width, Height: image.height, ColorSpace: colorSpace, BitsPerComponent: 8 };
  if (image.kind === 'jpeg') {
    return addImageObject(doc, { ...entries, Filter: 'DCTDecode' }, noise(image.payloadBytes ?? 1000, seed));
  }
  const channels = colorSpace === 'DeviceGray' ? 1 : 3;
  const pixels = noise(image.width * image.height * channels, seed);
  return doc.context.register(doc.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', ...entries }));
}

function draw(page: PDFPage, name: string, ref: PDFRef, [x, y, w, h]: [number, number, number, number]): void {
  page.node.setXObject(PDFName.of(name), ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, x, y), drawObject(name), popGraphicsState());
}

// Each page gets its own image object, drawn over the whole page.
async function makeImagePdf(opts: { pages: number; image: FakeImage; pageSize?: [number, number] }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [width, height] = opts.pageSize ?? A4;
  for (let n = 1; n <= opts.pages; n++) {
    draw(doc.addPage([width, height]), 'Im1', addImage(doc, opts.image, n), [0, 0, width, height]);
  }
  return doc.save();
}

async function makeUnsupportedMix(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const jpeg = { Width: 100, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' };
  const softMask = addImageObject(doc, { Width: 100, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }, noise(10_000, 9));
  const images = [
    addImageObject(doc, { ...jpeg, SMask: softMask }, noise(20_000, 1)),
    addImageObject(doc, { ...jpeg, ColorSpace: 'DeviceCMYK' }, noise(20_000, 2)),
    // Real deflate data, so a reader that ignored these entries would get enough pixels to call the recoder.
    doc.context.register(
      doc.context.flateStream(noise(10_000, 3), { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, BitsPerComponent: 1, ColorSpace: 'DeviceGray' }),
    ),
    doc.context.register(
      doc.context.flateStream(noise(30_000, 4), {
        Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB',
        DecodeParms: { Predictor: 15, Colors: 3, Columns: 100 },
      }),
    ),
  ];
  images.forEach((ref, i) => draw(page, `Im${i}`, ref, [i * 100, 0, 100, 100]));
  return doc.save();
}

async function makeTextAndImage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 2; n++) {
    const page = doc.addPage(A4);
    draw(page, 'Im1', addImage(doc, { kind: 'jpeg', width: 1000, height: 1400, payloadBytes: 60_000 }, n), [50, 300, 400, 500]);
    page.drawText(`Visible text p${n}`, { x: 50, y: 100, size: 14, font });
  }
  return doc.save();
}

async function makeSharedImagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ref = addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 200_000 });
  for (let n = 0; n < 2; n++) draw(doc.addPage(A4), 'Im1', ref, [0, 0, ...A4]);
  return doc.save();
}

function xobjectRef(doc: PDFDocument, pageIndex: number, name: string): PDFRef {
  const xobjects = doc.getPage(pageIndex).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  return xobjects.get(PDFName.of(name)) as PDFRef;
}

// toEqual on large typed arrays is slow enough to time tests out.
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function rawStream(doc: PDFDocument, ref: PDFRef): PDFRawStream {
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) throw new Error(`${ref} is not a stream`);
  return stream;
}

function expectSameStream(after: PDFDocument, before: PDFDocument, ref: PDFRef): void {
  const a = rawStream(after, ref);
  const b = rawStream(before, ref);
  expect(a.dict.toString()).toBe(b.dict.toString());
  expect(sameBytes(a.getContents(), b.getContents())).toBe(true);
}

function contentStreams(doc: PDFDocument, pageIndex: number): Uint8Array[] {
  const contents = doc.getPage(pageIndex).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams.map((stream) => (stream as PDFRawStream).getContents());
}

// A header-only JPEG (SOI, APP0, SOF0, EOI): enough for the frame to be read, not for a viewer to decode.
function jpegHeader(width: number, height: number, components: number, precision = 8): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 8 + 3 * components, precision, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 1; c <= components; c++) sof.push(c, 0x11, 0);
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

// The header above, zero padding to the given length, then EOI.
function fakeJpeg(width: number, height: number, length: number, components = 3, precision = 8): Uint8Array {
  const head = jpegHeader(width, height, components, precision);
  const bytes = new Uint8Array(Math.max(length, head.length));
  bytes.set(head.subarray(0, head.length - 2));
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

// A recoder must return real JPEG framing at the requested size: zero-filled bytes are refused.
const half: ImageRecoder = async (r) => fakeJpeg(r.targetWidth, r.targetHeight, Math.floor(r.source.bytes.length / 2));

const bigScan = () => makeImagePdf({ pages: 2, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 } });

async function onePageWith(ref: (doc: PDFDocument) => PDFRef): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  draw(doc.addPage(A4), 'Im1', ref(doc), [0, 0, ...A4]);
  return doc.save();
}

async function requests(file: Uint8Array, level: CompressLevel = 'recommended'): Promise<RecodeRequest[]> {
  const seen: RecodeRequest[] = [];
  await compressPdf(file, level, async (r) => { seen.push(r); return null; });
  return seen;
}

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

// JPEG-shaped bytes (not decodable) carrying what a phone or a design tool writes, and the same without EXIF and ICC.
function taggedJpeg(): { tagged: Uint8Array; clean: Uint8Array } {
  const jfif = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const exif = segment(0xe1, [...ascii('Exif\0\0'), ...ascii('MM\0*'), 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0]);
  const xmp = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...ascii('<x:xmpmeta/>')]);
  const icc1 = segment(0xe2, [...ascii('ICC_PROFILE\0'), 1, 2, ...noise(300, 31)]);
  const icc2 = segment(0xe2, [...ascii('ICC_PROFILE\0'), 2, 2, ...noise(200, 32)]);
  const adobe = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
  const dqt = segment(0xdb, [0, ...new Array(64).fill(1)]);
  const sof = segment(0xc0, [8, 0, 100, 0, 200, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  // Scan data with an Exif-looking run inside it; nothing after SOS may be touched.
  const scan = [...Array.from(noise(400, 33), (b) => (b === 0xff ? 0 : b)), ...exif, 1, 2, 3];
  const build = (parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat(), ...scan, 0xff, 0xd9]);
  return {
    tagged: build([jfif, exif, xmp, icc1, adobe, icc2, dqt, sof, sos]),
    clean: build([jfif, xmp, adobe, dqt, sof, sos]),
  };
}

async function makeEveryOtherKind(): Promise<{ bytes: Uint8Array; onPage: number; untouched: PDFRef[] }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const size = { Width: 50, Height: 50 };
  const rgb8 = { ...size, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' };
  const dct = { ...rgb8, Filter: 'DCTDecode' };
  const flate = (entries: Record<string, unknown>, length: number, seed: number) =>
    doc.context.register(doc.context.flateStream(noise(length, seed), { Type: 'XObject', Subtype: 'Image', ...(entries as object) }));
  const stencil = addImageObject(doc, { ...size, ImageMask: true, BitsPerComponent: 1 }, noise(350, 20));
  const icc = doc.context.register(doc.context.flateStream(noise(200, 21), { N: 3 }));
  const tint = doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 });
  const onPage = [
    addImageObject(doc, { ...dct, Mask: [0, 10, 0, 10, 0, 10] }, noise(4000, 1)),
    addImageObject(doc, { ...dct, Mask: stencil }, noise(4000, 2)),
    addImageObject(doc, { ...dct, Decode: [1, 0, 1, 0, 1, 0] }, noise(4000, 3)),
    addImageObject(doc, { ...size, ImageMask: true, BitsPerComponent: 1 }, noise(350, 4)),
    flate({ ...size, BitsPerComponent: 8, ColorSpace: ['Indexed', 'DeviceRGB', 1, PDFHexString.of('000000FFFFFF')] }, 2500, 5),
    addImageObject(doc, { ...dct, ColorSpace: ['ICCBased', icc] }, noise(4000, 6)),
    addImageObject(doc, { ...dct, ColorSpace: ['Lab', { WhitePoint: [0.9505, 1, 1.089] }] }, noise(4000, 7)),
    addImageObject(doc, { ...dct, ColorSpace: ['DeviceN', ['Spot'], 'DeviceGray', tint] }, noise(4000, 8)),
    addImageObject(doc, { ...size, BitsPerComponent: 1, ColorSpace: 'DeviceGray', Filter: 'JBIG2Decode' }, noise(4000, 9)),
    addImageObject(doc, { ...size, BitsPerComponent: 1, ColorSpace: 'DeviceGray', Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, Columns: 50 } }, noise(4000, 10)),
    addImageObject(doc, { ...size, Filter: 'JPXDecode' }, noise(4000, 11)),
    addImageObject(doc, { ...rgb8, Filter: ['FlateDecode', 'DCTDecode'] }, noise(4000, 12)),
    addImageObject(doc, { ...rgb8, Filter: ['DCTDecode'] }, noise(4000, 13)),
    addImageObject(doc, { ...dct, DecodeParms: { ColorTransform: 0 } }, noise(4000, 14)),
    flate({ ...size, BitsPerComponent: 16, ColorSpace: 'DeviceRGB' }, 15_000, 15),
    addImageObject(doc, { ...dct, F: PDFString.of('scan.jpg') }, noise(4000, 16)),
    addImageObject(doc, { ...rgb8, Filter: 'LZWDecode' }, noise(4000, 17)),
    addImageObject(doc, rgb8, noise(7500, 18)),
  ];
  const supported = addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 });
  [...onPage, supported].forEach((ref, i) => draw(page, `Im${i}`, ref, [(i % 6) * 90, Math.floor(i / 6) * 90, 80, 80]));
  return { bytes: await doc.save(), onPage: onPage.length, untouched: [...onPage, stencil, icc] };
}

async function makeRichPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage(A4);
  draw(p1, 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 200_000 }, 1), [0, 0, ...A4]);
  p1.drawText('Balance sheet', { x: 50, y: 780, size: 18, font });
  p1.drawRectangle({ x: 40, y: 760, width: 300, height: 50, borderColor: rgb(1, 0, 0), borderWidth: 2 });
  const link = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [40, 760, 340, 810], Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.invalid/') },
  }));
  p1.node.set(PDFName.of('Annots'), doc.context.obj([link]));
  const field = doc.getForm().createTextField('client.name');
  field.setText('Synthetic Client Ltd');
  field.addToPage(p1, { x: 50, y: 600, width: 200, height: 24 });
  const p2 = doc.addPage([400, 600]);
  draw(p2, 'Im1', addImage(doc, { kind: 'raw', width: 300, height: 450 }, 2), [0, 0, 400, 600]);
  p2.drawText('Notes', { x: 50, y: 500, size: 18, font });
  p2.setRotation(degrees(90));
  const outlines = doc.context.nextRef();
  const item = doc.context.register(doc.context.obj({ Title: PDFString.of('Notes'), Parent: outlines, Dest: [p2.ref, 'Fit'] }));
  doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  return doc.save();
}

async function makeEncryptedLike(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 50_000 }), [0, 0, ...A4]);
  doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
  return doc.save();
}

describe('compressPdf', () => {
  it('defines the three levels', () => {
    expect(COMPRESS_LEVELS).toEqual({
      low: { dpi: 200, quality: 0.82, label: 'Low compression' },
      recommended: { dpi: 150, quality: 0.68, label: 'Recommended' },
      extreme: { dpi: 96, quality: 0.45, label: 'Extreme' },
    });
  });

  it('replaces the images of a scanned file and makes it much smaller', async () => {
    const big = await makeImagePdf({ pages: 2, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 } }); // A4 pages, one image each
    const res = await compressPdf(big, 'recommended', half);
    expect(res.imagesFound).toBe(2); expect(res.imagesReplaced).toBe(2);
    expect(res.bytes).not.toBeNull(); expect(res.newSize).toBeLessThan(res.originalSize * 0.6);
    expect((await PDFDocument.load(res.bytes!)).getPageCount()).toBe(2);
    expect(res.originalSize).toBe(big.length);
    expect(res.newSize).toBe(res.bytes!.length);
  });

  it('asks for the level resolution as if each image filled its page', async () => {
    const big = await makeImagePdf({ pages: 2, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 } });
    // target size: A4 is 8.27 x 11.69 in; at 150 dpi => 1240 x 1754 (rounded)
    const seen: RecodeRequest[] = [];
    await compressPdf(big, 'recommended', async (r) => { seen.push(r); return null; });
    expect(seen[0]).toMatchObject({ targetWidth: 1240, targetHeight: 1754, quality: 0.68 });
    await compressPdf(big, 'low', async (r) => { seen.push(r); return null; });
    expect(seen.at(-1)).toMatchObject({ targetWidth: 1654, targetHeight: 2339, quality: 0.82 });
    await compressPdf(big, 'extreme', async (r) => { seen.push(r); return null; });
    expect(seen.at(-1)).toMatchObject({ targetWidth: 794, targetHeight: 1123, quality: 0.45 });
    expect(seen[0]).toMatchObject({ width: 2480, height: 3508, grayscale: false });
    expect(seen[0].source.kind).toBe('jpeg');
    expect(seen[0].source.bytes.length).toBe(400_000);
  });

  it('never asks for an image larger than the source', async () => {
    const small = await makeImagePdf({ pages: 1, image: { kind: 'jpeg', width: 600, height: 800, payloadBytes: 50_000 } });
    await compressPdf(small, 'low', async (r) => { expect(r.targetWidth).toBe(600); expect(r.targetHeight).toBe(800); return null; });
    // The recoder's own expectations would be swallowed if compressPdf caught them, so check again outside it.
    const seen: RecodeRequest[] = [];
    await compressPdf(small, 'low', async (r) => { seen.push(r); return null; });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ targetWidth: 600, targetHeight: 800 });
  });

  it('keeps an image whose recoding is larger, and returns no file when nothing is gained', async () => {
    const big = await makeImagePdf({ pages: 2, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 } });
    // larger recode is discarded; nothing gained => bytes null
    const bigger: ImageRecoder = async (r) => fakeJpeg(r.targetWidth, r.targetHeight, r.source.bytes.length + 10);
    const none = await compressPdf(big, 'recommended', bigger);
    expect(none.imagesReplaced).toBe(0); expect(none.bytes).toBeNull();
    expect(none.imagesFound).toBe(2);
  });

  it('does not offer images with a soft mask, CMYK, 1 bit per component, or Flate with DecodeParms', async () => {
    const unsupportedMix = await makeUnsupportedMix();
    // unsupported images are not offered to the recoder: one with SMask, one CMYK, one 1-bit, one Flate with DecodeParms
    let calls = 0; await compressPdf(unsupportedMix, 'extreme', async () => { calls++; return null; }); expect(calls).toBe(0);
    expect((await compressPdf(unsupportedMix, 'extreme', half)).imagesFound).toBe(4);
  });

  it('keeps the text', async () => {
    const textAndImage = await makeTextAndImage();
    // text survives
    expect(await pageTexts((await compressPdf(textAndImage, 'extreme', half)).bytes!)).toEqual(await pageTexts(textAndImage));
  });

  it('recodes an image shared by two pages once, and both pages keep sharing it', async () => {
    const shared = await makeSharedImagePdf();
    let calls = 0;
    const res = await compressPdf(shared, 'recommended', async (r) => { calls++; return half(r); });
    expect(calls).toBe(1);
    expect(res).toMatchObject({ imagesFound: 1, imagesReplaced: 1 });
    const out = await PDFDocument.load(res.bytes!);
    const first = xobjectRef(out, 0, 'Im1');
    expect(xobjectRef(out, 1, 'Im1')).toBe(first);
    const stream = rawStream(out, first);
    expect(stream.getContentsSize()).toBe(100_000);
    expect(stream.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(stream.dict.get(PDFName.of('Width'))!.toString()).toBe('1240');
    expect(stream.dict.get(PDFName.of('Height'))!.toString()).toBe('1754');
    expect(stream.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
  });

  it('reports progress up to (total, total)', async () => {
    const big = await makeImagePdf({ pages: 2, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 } });
    const progress: [number, number][] = [];
    await compressPdf(big, 'recommended', half, (done, total) => progress.push([done, total]));
    expect(progress.at(-1)).toEqual([2, 2]);
    expect(progress.map(([done]) => done)).toEqual([...progress.map(([done]) => done)].sort((a, b) => a - b));
  });
});

describe('compressPdf: which images are recoded', () => {
  it('leaves every other kind of image byte-for-byte as it was', async () => {
    const { bytes, onPage, untouched } = await makeEveryOtherKind();
    const offered: RecodeRequest[] = [];
    const res = await compressPdf(bytes, 'extreme', async (r) => { offered.push(r); return half(r); });
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ width: 2480, height: 3508 });
    expect(res).toMatchObject({ imagesFound: onPage + 1, imagesReplaced: 1 });
    const before = await PDFDocument.load(bytes);
    const after = await PDFDocument.load(res.bytes!);
    for (const ref of untouched) expectSameStream(after, before, ref);
  });

  it('never recodes the soft mask or mask of another image, even when a page also draws it', async () => {
    const doc = await PDFDocument.create();
    const grey = { Width: 2480, Height: 3508, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'DCTDecode' };
    const softMask = addImageObject(doc, grey, noise(100_000, 41));
    const mask = addImageObject(doc, grey, noise(100_000, 42));
    const withSoftMask = addImageObject(doc, { ...grey, ColorSpace: 'DeviceRGB', SMask: softMask }, noise(100_000, 43));
    const withMask = addImageObject(doc, { ...grey, ColorSpace: 'DeviceRGB', Mask: mask }, noise(100_000, 44));
    const p1 = doc.addPage(A4);
    draw(p1, 'Im1', withSoftMask, [0, 0, 297, 420]);
    draw(p1, 'Im2', withMask, [297, 0, 297, 420]);
    const p2 = doc.addPage(A4);
    draw(p2, 'Mk1', softMask, [0, 0, 297, 420]);
    draw(p2, 'Mk2', mask, [297, 0, 297, 420]);
    draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 }), [0, 0, ...A4]);
    const file = await doc.save();
    const offered: RecodeRequest[] = [];
    const res = await compressPdf(file, 'recommended', async (r) => { offered.push(r); return half(r); });
    expect(offered).toHaveLength(1);
    expect(res).toMatchObject({ imagesFound: 5, imagesReplaced: 1 });
    const before = await PDFDocument.load(file);
    const after = await PDFDocument.load(res.bytes!);
    for (const ref of [softMask, mask, withSoftMask, withMask]) expectSameStream(after, before, ref);
  });

  it('leaves inline images in the page content untouched', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    draw(page, 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 }), [0, 0, ...A4]);
    const inline = doc.context.register(doc.context.stream('q 20 0 0 10 100 100 cm\nBI /W 2 /H 1 /CS /RGB /BPC 8 ID \xff\x00\x00\x00\xff\x00\nEI Q\n'));
    (page.node.Contents() as PDFArray).push(inline);
    const bytes = await doc.save();
    const res = await compressPdf(bytes, 'recommended', half);
    expect(res).toMatchObject({ imagesFound: 1, imagesReplaced: 1 });
    expect(contentStreams(await PDFDocument.load(res.bytes!), 0)).toEqual(contentStreams(await PDFDocument.load(bytes), 0));
  });

  it('treats /ImageMask false as an ordinary image', async () => {
    const file = await onePageWith((doc) =>
      addImageObject(doc, { Width: 100, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode', ImageMask: false }, noise(5000)));
    expect(await requests(file)).toHaveLength(1);
  });

  it('inflates Flate images and passes the pixels with their channel count', async () => {
    const [rgbReq] = await requests(await makeImagePdf({ pages: 1, image: { kind: 'raw', width: 200, height: 100 } }));
    const [grayReq] = await requests(await makeImagePdf({ pages: 1, image: { kind: 'raw', width: 200, height: 100, colorSpace: 'DeviceGray' } }));
    expect(rgbReq).toMatchObject({ width: 200, height: 100, targetWidth: 200, targetHeight: 100, grayscale: false, source: { kind: 'raw', channels: 3 } });
    expect(sameBytes(rgbReq.source.bytes, noise(200 * 100 * 3, 1))).toBe(true);
    expect(grayReq).toMatchObject({ grayscale: true, source: { kind: 'raw', channels: 1 } });
    expect(sameBytes(grayReq.source.bytes, noise(200 * 100, 1))).toBe(true);
  });

  it('skips Flate images it cannot inflate or that hold too few pixels', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    const entries = { Width: 200, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' };
    const corrupt = addImageObject(doc, { ...entries, Filter: 'FlateDecode' }, noise(5000, 3));
    const short = doc.context.register(doc.context.flateStream(noise(200 * 50 * 3, 4), { Type: 'XObject', Subtype: 'Image', ...entries }));
    draw(page, 'Im1', corrupt, [0, 0, 100, 100]);
    draw(page, 'Im2', short, [100, 0, 100, 100]);
    let calls = 0;
    const res = await compressPdf(await doc.save(), 'recommended', async () => { calls++; return new Uint8Array(1); });
    expect(calls).toBe(0);
    expect(res).toMatchObject({ imagesFound: 2, imagesReplaced: 0 });
  });

  it('writes the replacement as DCTDecode at the new size and keeps the other entries', async () => {
    const doc = await PDFDocument.create();
    const pixels = noise(300 * 200 * 3, 5);
    const ref = doc.context.register(doc.context.flateStream(pixels, {
      Type: 'XObject', Subtype: 'Image', Width: 300, Height: 200, BitsPerComponent: 8, ColorSpace: 'DeviceRGB',
      Interpolate: true, Intent: 'Perceptual', StructParent: 3, DL: pixels.length,
    }));
    draw(doc.addPage([72, 48]), 'Im1', ref, [0, 0, 72, 48]); // 1 x 0.67 in, so 150 x 100 px at 150 dpi
    const res = await compressPdf(await doc.save(), 'recommended', half);
    const stream = rawStream(await PDFDocument.load(res.bytes!), ref);
    const entry = (key: string) => stream.dict.get(PDFName.of(key))?.toString();
    expect(entry('Filter')).toBe('/DCTDecode');
    expect([entry('Width'), entry('Height')]).toEqual(['150', '100']);
    expect(entry('ColorSpace')).toBe('/DeviceRGB');
    expect(entry('BitsPerComponent')).toBe('8');
    expect([entry('Interpolate'), entry('Intent'), entry('StructParent')]).toEqual(['true', '/Perceptual', '3']);
    expect(entry('DecodeParms')).toBeUndefined();
    expect(entry('DL')).toBeUndefined();
    expect(stream.getContentsSize()).toBe(Math.floor(pixels.length / 2));
    expect(entry('Length')).toBe(String(stream.getContentsSize()));
  });
});

describe('compressPdf: what the recoder is given', () => {
  it('hands over JPEG data without its EXIF and ICC segments, and only those, leaving the document stream as it was', async () => {
    const { tagged, clean } = taggedJpeg();
    const doc = await PDFDocument.create();
    const ref = addImageObject(doc, { Width: 200, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }, tagged);
    draw(doc.addPage(A4), 'Im1', ref, [0, 0, 200, 100]);
    draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 }), [0, 0, ...A4]);
    const file = await doc.save();
    const given: Uint8Array[] = [];
    const res = await compressPdf(file, 'recommended', async (r) => {
      given.push(r.source.bytes);
      return given.length === 1 ? null : half(r);
    });
    expect(sameBytes(given[0], clean)).toBe(true);
    expect(res.imagesReplaced).toBe(1);
    expectSameStream(await PDFDocument.load(res.bytes!), await PDFDocument.load(file), ref);
  });

  it('passes a JPEG with neither segment through unchanged', async () => {
    const { clean } = taggedJpeg();
    const [req] = await requests(await onePageWith((doc) =>
      addImageObject(doc, { Width: 200, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }, clean)));
    expect(sameBytes(req.source.bytes, clean)).toBe(true);
  });
});

describe('compressPdf: a malformed EXIF segment', () => {
  it('leaves the JPEG untouched when the APP1 length lands in the middle of the data', async () => {
    const exif = segment(0xe1, [...ascii('Exif  '), ...ascii('MM *'), 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0]);
    const dqt = segment(0xdb, [0, ...new Array(64).fill(1)]);
    const sof = segment(0xc0, [8, 0, 100, 0, 200, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const sos = segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
    const scan = Array.from(noise(100, 41), (b) => (b === 0xff ? 0 : b));
    const declared = (exif[2] << 8) | exif[3];
    for (const shortBy of [2, 5]) {
      const bad = [...exif];
      bad[2] = (declared - shortBy) >> 8;
      bad[3] = (declared - shortBy) & 0xff;
      expect(bad[4 + declared - 2 - shortBy]).not.toBe(0xff); // the cut falls inside the payload
      const jpeg = new Uint8Array([0xff, 0xd8, ...bad, ...dqt, ...sof, ...sos, ...scan, 0xff, 0xd9]);
      const [req] = await requests(await onePageWith((doc) =>
        addImageObject(doc, { Width: 200, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }, jpeg)));
      expect(sameBytes(req.source.bytes, jpeg)).toBe(true);
    }
  });
});

describe('compressPdf: EXIF segment length limits', () => {
  const header = () => segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const exif = () => segment(0xe1, [...ascii('Exif\0\0'), ...ascii('MM\0*'), 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0]);
  const given = async (jpeg: Uint8Array) => {
    const [req] = await requests(await onePageWith((doc) =>
      addImageObject(doc, { Width: 200, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }, jpeg)));
    return req.source.bytes;
  };

  it('leaves the JPEG untouched when the declared length runs past the end', async () => {
    const bad = exif();
    const declared = (bad[2] << 8) | bad[3];
    bad[2] = (declared + 40) >> 8;
    bad[3] = (declared + 40) & 0xff;
    const jpeg = new Uint8Array([0xff, 0xd8, ...header(), ...bad, 0xff, 0xd9]);
    expect(sameBytes(await given(jpeg), jpeg)).toBe(true);
  });

  it('removes an EXIF segment that ends exactly at the end of the file', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, ...header(), ...exif()]);
    expect(sameBytes(await given(jpeg), new Uint8Array([0xff, 0xd8, ...header()]))).toBe(true);
  });
});

describe('compressPdf: target size', () => {
  it('sizes a shared image for the largest page that uses it', async () => {
    const doc = await PDFDocument.create();
    const ref = addImage(doc, { kind: 'jpeg', width: 3000, height: 3000, payloadBytes: 1000 });
    for (const side of [72, 720, 144]) draw(doc.addPage([side, side]), 'Im1', ref, [0, 0, side, side]);
    const seen = await requests(await doc.save());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ targetWidth: 1500, targetHeight: 1500 });
  });

  it('fits a landscape image to a portrait page as if turned to fill it', async () => {
    const landscape = await makeImagePdf({ pages: 1, image: { kind: 'jpeg', width: 3508, height: 2480, payloadBytes: 1000 } });
    expect((await requests(landscape))[0]).toMatchObject({ targetWidth: 1754, targetHeight: 1240 });
  });

  it('counts the page UserUnit', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([360, 360]);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)); // 10 x 10 in
    draw(page, 'Im1', addImage(doc, { kind: 'jpeg', width: 3000, height: 3000, payloadBytes: 1000 }), [0, 0, 360, 360]);
    expect((await requests(await doc.save()))[0]).toMatchObject({ targetWidth: 1500, targetHeight: 1500 });
  });

  it('leaves alone the images of a page whose size or resources cannot be read', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    draw(page, 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 50_000 }), [0, 0, ...A4]);
    page.node.delete(PDFName.of('MediaBox'));
    doc.addPage(A4).node.set(PDFName.of('Resources'), PDFNumber.of(5));
    const res = await compressPdf(await doc.save(), 'recommended', async () => { throw new Error('must not be called'); });
    expect(res).toMatchObject({ imagesFound: 1, imagesReplaced: 0 });
  });
});

describe('compressPdf: shared images', () => {
  it('recodes an image used twice on a page and inside a form on another page once', async () => {
    const doc = await PDFDocument.create();
    const ref = addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 });
    const p1 = doc.addPage(A4);
    draw(p1, 'Logo1', ref, [0, 0, 100, 100]);
    draw(p1, 'Logo2', ref, [200, 0, 100, 100]);
    const form = doc.context.register(doc.context.stream('q 100 0 0 100 0 0 cm /Im1 Do Q', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], Resources: { XObject: { Im1: ref } },
    }));
    draw(doc.addPage(A4), 'Fm1', form, [0, 0, 1, 1]);
    let calls = 0;
    const res = await compressPdf(await doc.save(), 'recommended', async (r) => { calls++; return half(r); });
    expect(calls).toBe(1);
    expect(res).toMatchObject({ imagesFound: 1, imagesReplaced: 1 });
    const out = await PDFDocument.load(res.bytes!);
    expect(xobjectRef(out, 0, 'Logo1')).toBe(ref);
    expect(xobjectRef(out, 0, 'Logo2')).toBe(ref);
    const formOut = rawStream(out, xobjectRef(out, 1, 'Fm1'));
    expect(formOut.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).get(PDFName.of('Im1'))).toBe(ref);
    expect(rawStream(out, ref).getContentsSize()).toBe(50_000);
  });

  it('finds images in nested forms and survives a form that draws itself', async () => {
    const doc = await PDFDocument.create();
    const image = addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 50_000 });
    const inner = doc.context.register(doc.context.stream('/Im1 Do', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Im1: image } },
    }));
    const outer = doc.context.nextRef();
    doc.context.assign(outer, doc.context.stream('/Fm2 Do /Fm1 Do', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Fm1: outer, Fm2: inner } },
    }));
    draw(doc.addPage(A4), 'Fm1', outer, [0, 0, ...A4]);
    expect(await compressPdf(await doc.save(), 'recommended', half)).toMatchObject({ imagesFound: 1, imagesReplaced: 1 });
  });
});

describe('compressPdf: only worthwhile gains', () => {
  it('replaces only the images whose recoding is smaller', async () => {
    const big = await bigScan();
    let n = 0;
    const res = await compressPdf(big, 'recommended', async (r) =>
      fakeJpeg(r.targetWidth, r.targetHeight, n++ === 0 ? r.source.bytes.length : Math.floor(r.source.bytes.length / 2)));
    expect(res).toMatchObject({ imagesFound: 2, imagesReplaced: 1 });
    const before = await PDFDocument.load(big);
    expectSameStream(await PDFDocument.load(res.bytes!), before, xobjectRef(before, 0, 'Im1'));
  });

  it('replaces an image only when the new encoding is at most 90% of the old', async () => {
    const big = await bigScan(); // 400,000 bytes per image
    let n = 0;
    const res = await compressPdf(big, 'recommended', async (r) => fakeJpeg(r.targetWidth, r.targetHeight, n++ === 0 ? 360_000 : 360_001));
    expect(res.imagesReplaced).toBe(1);
    const out = await PDFDocument.load(res.bytes!);
    expect(rawStream(out, xobjectRef(out, 0, 'Im1')).getContentsSize()).toBe(360_000);
    expect(rawStream(out, xobjectRef(out, 1, 'Im1')).getContentsSize()).toBe(400_000);
  });

  it('returns no file for a second run at the same level', async () => {
    const first = await compressPdf(await bigScan(), 'recommended', half);
    const nearlyAsBig: ImageRecoder = async (r) => fakeJpeg(r.targetWidth, r.targetHeight, Math.floor(r.source.bytes.length * 0.95));
    const again = await compressPdf(first.bytes!, 'recommended', nearlyAsBig);
    expect(again).toMatchObject({ imagesFound: 2, imagesReplaced: 0, bytes: null });
  });

  it('returns no file when the whole result is less than 1% smaller', async () => {
    const doc = await PDFDocument.create();
    draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 }, 1), [0, 0, ...A4]);
    draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 3000 }, 2), [0, 0, ...A4]);
    const res = await compressPdf(await doc.save(), 'recommended', async (r) =>
      (r.source.bytes.length === 3000 ? fakeJpeg(r.targetWidth, r.targetHeight, 1500) : null));
    expect(res.imagesReplaced).toBe(1);
    expect(res.bytes).toBeNull();
  });

  it('returns no file for a text-only file that is already compact', async () => {
    expect((await compressPdf(await makePdf('Text only', 5), 'recommended', half)).bytes).toBeNull();
  });

  it('gives a smaller file at each stronger level', async () => {
    const big = await bigScan();
    const sized: ImageRecoder = async (r) => fakeJpeg(r.targetWidth, r.targetHeight, Math.floor((r.targetWidth * r.targetHeight * r.quality) / 30));
    const sizes: number[] = [];
    for (const level of ['low', 'recommended', 'extreme'] as CompressLevel[]) {
      const res = await compressPdf(big, level, sized);
      expect(res.bytes).not.toBeNull();
      sizes.push(res.newSize);
    }
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
  });

  it('does not count a shorter Producer as a gain', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 50_000 }), [0, 0, ...A4]);
    doc.setProducer('Synthetic producer '.repeat(30));
    doc.setCreator('Synthetic creator '.repeat(30));
    const res = await compressPdf(await doc.save(), 'recommended', async () => null);
    expect(res.bytes).toBeNull();
  });

  it('returns a file re-saved in a compact structure even when no image changes', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 40; n++) doc.addPage(A4).drawText(`Ledger page ${n}`, { x: 50, y: 700, size: 12, font });
    const loose = await doc.save({ useObjectStreams: false });
    const res = await compressPdf(loose, 'recommended', half);
    expect(res).toMatchObject({ imagesFound: 0, imagesReplaced: 0 });
    expect(res.bytes).not.toBeNull();
    expect(res.newSize).toBeLessThan(loose.length);
    const out = await PDFDocument.load(res.bytes!, { updateMetadata: false });
    expect(out.getProducer()).toBe('ICAI VERA');
    expect(out.getPageCount()).toBe(40);
  });

  it('handles a file with no images', async () => {
    const doc = await PDFDocument.create();
    doc.addPage(A4).drawText('No pictures here');
    const progress: [number, number][] = [];
    const res = await compressPdf(await doc.save(), 'recommended', half, (done, total) => progress.push([done, total]));
    expect(res).toMatchObject({ imagesFound: 0, imagesReplaced: 0 });
    expect(progress).toEqual([[0, 0]]);
  });
});

describe('compressPdf: the rest of the document', () => {
  it('keeps text, drawings, fonts, links, bookmarks, form fields and page geometry', async () => {
    const rich = await makeRichPdf();
    const res = await compressPdf(rich, 'recommended', half);
    expect(res.imagesReplaced).toBe(2);
    const before = await PDFDocument.load(rich);
    const after = await PDFDocument.load(res.bytes!);
    expect(after.getPageCount()).toBe(2);
    for (const i of [0, 1]) {
      expect(after.getPage(i).getSize()).toEqual(before.getPage(i).getSize());
      expect(after.getPage(i).getRotation()).toEqual(before.getPage(i).getRotation());
      expect(contentStreams(after, i)).toEqual(contentStreams(before, i));
      expect(after.getPage(i).node.Resources()!.toString()).toBe(before.getPage(i).node.Resources()!.toString());
    }
    expect(await pageTexts(res.bytes!)).toEqual(await pageTexts(rich));
    const annots = (doc: PDFDocument) => doc.getPage(0).node.Annots()!.asArray().map((ref) => doc.context.lookup(ref, PDFDict).toString());
    expect(annots(after)).toEqual(annots(before));
    expect(annots(after)).toHaveLength(2);
    const outline = (doc: PDFDocument) => doc.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookup(PDFName.of('First'), PDFDict).toString();
    expect(outline(after)).toBe(outline(before));
    expect(after.getForm().getTextField('client.name').getText()).toBe('Synthetic Client Ltd');
  });

  it('stamps Creator and Producer and keeps the source description', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 }), [0, 0, ...A4]);
    doc.setTitle('Synthetic Title');
    doc.setAuthor('Synthetic Author');
    doc.setSubject('Synthetic Subject');
    doc.setKeywords(['alpha', 'beta']);
    doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));
    doc.setProducer('Synthetic Scanner');
    doc.setCreator('Synthetic Scanner');
    const before = Date.now();
    const res = await compressPdf(await doc.save(), 'recommended', half);
    const out = await PDFDocument.load(res.bytes!, { updateMetadata: false });
    expect(out.getProducer()).toBe('ICAI VERA');
    expect(out.getCreator()).toBe('ICAI VERA');
    expect(out.getModificationDate()!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(out.getTitle()).toBe('Synthetic Title');
    expect(out.getAuthor()).toBe('Synthetic Author');
    expect(out.getSubject()).toBe('Synthetic Subject');
    expect(out.getKeywords()).toBe('alpha beta');
    expect(out.getCreationDate()!.toISOString()).toBe('2020-01-02T03:04:05.000Z');
  });

  it('adds no form and no font to a file that had none', async () => {
    const doc = await PDFDocument.create();
    draw(doc.addPage(A4), 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 }), [0, 0, ...A4]);
    const bytes = await doc.save({ updateFieldAppearances: false });
    expect((await PDFDocument.load(bytes)).catalog.has(PDFName.of('AcroForm'))).toBe(false);
    const out = await PDFDocument.load((await compressPdf(bytes, 'recommended', half)).bytes!);
    expect(out.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    const fonts = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'));
    expect(fonts).toHaveLength(0);
  });

  it('still compresses a signed file and leaves the signature field in place', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    draw(page, 'Im1', addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 100_000 }), [0, 0, ...A4]);
    const signature = doc.context.register(doc.context.obj({
      Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 100, 200, 300], Contents: PDFHexString.of('00'.repeat(64)),
    }));
    const field = doc.context.register(doc.context.obj({
      FT: 'Sig', T: PDFString.of('Signature1'), Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 0, 0], V: signature, P: page.ref,
    }));
    page.node.set(PDFName.of('Annots'), doc.context.obj([field]));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(doc.context.obj({ SigFlags: 3, Fields: [field] })));
    const signed = await doc.save({ updateFieldAppearances: false });
    const res = await compressPdf(signed, 'recommended', half);
    expect(res.imagesReplaced).toBe(1);
    expect((await inspectPdf(res.bytes!)).hasSignature).toBe(true);
    const before = await PDFDocument.load(signed);
    const after = await PDFDocument.load(res.bytes!);
    for (const ref of [field, signature]) expect(after.context.lookup(ref, PDFDict).toString()).toBe(before.context.lookup(ref, PDFDict).toString());
  });
});

describe('compressPdf: refusals', () => {
  it('refuses a password-protected file without calling the recoder', async () => {
    let calls = 0;
    await expect(compressPdf(await makeEncryptedLike(), 'recommended', async () => { calls++; return null; })).rejects.toMatchObject({ code: 'encrypted' });
    expect(calls).toBe(0);
  });

  it('reports a protected file as protected even when its page tree cannot be read', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage(A4);
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 4, R: 4 }));
    // As when the catalog sits in an encrypted object stream: unreadable, and not recoverable by a scan.
    doc.catalog.delete(PDFName.of('Type'));
    doc.context.trailerInfo.Root = PDFRef.of(9999);
    const locked = await doc.save({ updateFieldAppearances: false });
    await expect(compressPdf(locked, 'recommended', half)).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('refuses bytes that are not a PDF', async () => {
    await expect(compressPdf(new TextEncoder().encode('hello'), 'recommended', half)).rejects.toMatchObject({ code: 'not-a-pdf' });
  });

  it('refuses a file that pdf-lib reads but that has no pages', async () => {
    await expect(compressPdf(new TextEncoder().encode('%PDF-1.7\nnot really'), 'recommended', half)).rejects.toMatchObject({ code: 'not-a-pdf' });
    const empty = await PDFDocument.create();
    await expect(compressPdf(await empty.save({ addDefaultPage: false }), 'recommended', half)).rejects.toMatchObject({ code: 'not-a-pdf' });
  });

  it('refuses an unknown level', async () => {
    await expect(compressPdf(await bigScan(), 'medium' as unknown as CompressLevel, half)).rejects.toMatchObject({ code: 'invalid-level' });
  });
});

describe('compressPdf: recoder failures', () => {
  it('keeps the original when the recoder throws, and carries on with the other images', async () => {
    const big = await bigScan();
    let n = 0;
    const res = await compressPdf(big, 'recommended', async (r) => {
      if (n++ === 0) throw new Error('decoder failed');
      return half(r);
    });
    expect(res).toMatchObject({ imagesFound: 2, imagesReplaced: 1 });
    const before = await PDFDocument.load(big);
    expectSameStream(await PDFDocument.load(res.bytes!), before, xobjectRef(before, 0, 'Im1'));
  });

  it('reports a failure instead of "already compact" when every recoder call throws', async () => {
    const failing: ImageRecoder = async () => { throw new Error('OffscreenCanvas is not defined'); };
    await expect(compressPdf(await bigScan(), 'recommended', failing)).rejects.toMatchObject({
      code: 'recode-failed',
      message: 'The images in this file could not be processed, so it was not compressed.',
    });
  });

  it('ignores recoder output that is not usable bytes', async () => {
    const five = await makeImagePdf({ pages: 5, image: { kind: 'jpeg', width: 1000, height: 1000, payloadBytes: 5000 } });
    const outputs: unknown[] = [new Uint8Array(0), undefined, 'not bytes', new ArrayBuffer(10), [1, 2, 3]];
    let n = 0;
    const res = await compressPdf(five, 'recommended', async () => outputs[n++] as Uint8Array);
    expect(n).toBe(5);
    expect(res.imagesReplaced).toBe(0);
  });

  it('keeps the original when the JPEG is not at the requested size', async () => {
    const res = await compressPdf(await bigScan(), 'recommended', async () => jpegHeader(1000, 1414, 3));
    expect(res.imagesReplaced).toBe(0);
  });

  it('keeps the original unless the recoder returns a whole 8-bit JPEG at exactly the requested size', async () => {
    const big = await bigScan();
    const bad: ((r: RecodeRequest) => Uint8Array)[] = [
      () => new Uint8Array(1000), // the brief's zero-filled fake
      () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(992).fill(0)]), // PNG
      () => new Uint8Array([...ascii('RIFF'), 0xe0, 0x03, 0, 0, ...ascii('WEBPVP8 '), ...new Array(980).fill(0)]), // WebP
      (r) => fakeJpeg(r.targetHeight, r.targetWidth, 1000), // width and height swapped
      (r) => fakeJpeg(r.targetWidth - 1, r.targetHeight, 1000),
      (r) => fakeJpeg(r.targetWidth, r.targetHeight, 1000).subarray(0, 900), // truncated: no EOI
      (r) => fakeJpeg(r.targetWidth, r.targetHeight, 1000, 1), // grey from a colour image
      (r) => fakeJpeg(r.targetWidth, r.targetHeight, 1000, 4), // CMYK
      (r) => fakeJpeg(r.targetWidth, r.targetHeight, 1000, 3, 12), // 12-bit
      (r) => { const j = fakeJpeg(r.targetWidth, r.targetHeight, 1000); j[2] = 0x00; return j; }, // no marker after SOI
      () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), // no frame header
      () => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0x06, 0xff, 0xd9]), // frame header cut short
    ];
    for (const [i, make] of bad.entries()) {
      const res = await compressPdf(big, 'recommended', async (r) => make(r));
      expect(res.imagesReplaced, `bad output ${i}`).toBe(0);
    }
  });

  it('matches the colour space to the components of the returned JPEG', async () => {
    const gray = await makeImagePdf({ pages: 1, image: { kind: 'raw', width: 400, height: 300, colorSpace: 'DeviceGray' } });
    const colourSpaceAfter = async (components: number) => {
      const res = await compressPdf(gray, 'recommended', async () => jpegHeader(400, 300, components));
      expect(res.imagesReplaced).toBe(1);
      const out = await PDFDocument.load(res.bytes!);
      return rawStream(out, xobjectRef(out, 0, 'Im1')).dict.get(PDFName.of('ColorSpace'));
    };
    // Browsers write three-component JPEGs even for grey pixels.
    expect(await colourSpaceAfter(3)).toBe(PDFName.of('DeviceRGB'));
    expect(await colourSpaceAfter(1)).toBe(PDFName.of('DeviceGray'));
  });
});

describe('compressPdf: input and cancellation', () => {
  it('never changes the input, even when the recoder scribbles over what it is given', async () => {
    const big = await bigScan();
    const copy = big.slice();
    let n = 0;
    const res = await compressPdf(big, 'recommended', async (r) => {
      r.source.bytes.fill(0);
      return n++ === 0 ? null : half(r);
    });
    expect(sameBytes(big, copy)).toBe(true);
    expect(res.imagesReplaced).toBe(1);
    const before = await PDFDocument.load(big);
    expectSameStream(await PDFDocument.load(res.bytes!), before, xobjectRef(before, 0, 'Im1'));
  });

  it('stops with no result when the progress callback throws', async () => {
    const big = await bigScan();
    const copy = big.slice();
    const cancelled = new Error('cancelled');
    let calls = 0;
    const run = compressPdf(big, 'recommended', async (r) => { calls++; return half(r); }, (done) => {
      if (done === 1) throw cancelled;
    });
    await expect(run).rejects.toBe(cancelled);
    expect(calls).toBe(1);
    expect(sameBytes(big, copy)).toBe(true);
  });
});
