// Test helper only: synthetic image PDFs and a JPEG-shaped recoder for the Compress tests (Fit to a size).
// Not imported by production code. The images are deterministic noise; the recoder never decodes them,
// it answers with framed JPEG bytes whose length follows the pixels and the quality asked for.
import { concatTransformationMatrix, drawObject, PDFDocument, PDFName, popGraphicsState, pushGraphicsState, StandardFonts, type PDFPage, type PDFRef } from 'pdf-lib';
import type { ImageRecoder, RecodeRequest } from './compress';

export const A4: [number, number] = [595.28, 841.89];

/** Deterministic bytes that do not deflate, so stream sizes stay predictable. */
export function noise(length: number, seed = 1): Uint8Array {
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

/** A header-only JPEG (SOI, APP0, SOF0, EOI), padded with zeros to `length`, ending in EOI. */
export function fakeJpeg(width: number, height: number, length: number, components = 3): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 8 + 3 * components, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 1; c <= components; c++) sof.push(c, 0x11, 0);
  const head = [0xff, 0xd8, ...app0, ...sof];
  const bytes = new Uint8Array(Math.max(length, head.length + 2));
  bytes.set(head);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

/**
 * Output bytes for a request: about `scale` bytes per pixel at quality 1, falling with the square of the
 * quality, so that fewer pixels or a lower quality always give fewer bytes (as a real encoder does).
 */
export function modelBytes(r: Pick<RecodeRequest, 'targetWidth' | 'targetHeight' | 'quality'>, scale = 0.125): number {
  return Math.max(64, Math.floor(r.targetWidth * r.targetHeight * r.quality * r.quality * scale));
}

/** A recoder following modelBytes; `seen` collects every request. */
export function modelRecoder(seen: RecodeRequest[] = [], scale?: number): ImageRecoder {
  return async (r) => {
    seen.push(r);
    return fakeJpeg(r.targetWidth, r.targetHeight, modelBytes(r, scale));
  };
}

export interface ScanImage {
  kind: 'jpeg' | 'raw';
  width: number;
  height: number;
  /** jpeg only: the stored size (the fake recoders never decode it). */
  payloadBytes?: number;
  colorSpace?: 'DeviceRGB' | 'DeviceGray';
  /** Put the image in an ICC space of its channels (as an sRGB scan with its profile is written), one profile object per document. */
  profile?: boolean;
}

const profiles = new WeakMap<PDFDocument, Map<number, PDFRef>>();
function iccProfile(doc: PDFDocument, n: number): PDFRef {
  const mine = profiles.get(doc) ?? new Map<number, PDFRef>();
  profiles.set(doc, mine);
  if (!mine.has(n)) mine.set(n, doc.context.register(doc.context.flateStream(noise(3000, 50 + n), { N: n })));
  return mine.get(n)!;
}

export function addImage(doc: PDFDocument, image: ScanImage, seed = 1): PDFRef {
  const device = image.colorSpace ?? 'DeviceRGB';
  const colorSpace = image.profile ? doc.context.obj(['ICCBased', iccProfile(doc, device === 'DeviceGray' ? 1 : 3)]) : device;
  const entries = { Type: 'XObject', Subtype: 'Image', Width: image.width, Height: image.height, ColorSpace: colorSpace, BitsPerComponent: 8 };
  if (image.kind === 'jpeg') return doc.context.register(doc.context.stream(noise(image.payloadBytes ?? 1000, seed), { ...entries, Filter: 'DCTDecode' }));
  const channels = device === 'DeviceGray' ? 1 : 3;
  return doc.context.register(doc.context.flateStream(noise(image.width * image.height * channels, seed), entries));
}

export function drawImage(page: PDFPage, name: string, ref: PDFRef, [x, y, w, h]: [number, number, number, number]): void {
  page.node.setXObject(PDFName.of(name), ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, x, y), drawObject(name), popGraphicsState());
}

/**
 * A scan: `pages` A4 pages, each one full-page image of its own (a 300 dpi A4 scan is 2480 x 3508), with a
 * line of text on top so the text can be checked after compression.
 */
export async function makeScanPdf(opts: { pages: number; image: ScanImage; text?: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = opts.text ? await doc.embedFont(StandardFonts.Helvetica) : null;
  for (let n = 1; n <= opts.pages; n++) {
    const page = doc.addPage(A4);
    drawImage(page, 'Im1', addImage(doc, opts.image, n), [0, 0, ...A4]);
    if (font) page.drawText(`Scan page ${n}`, { x: 40, y: 800, size: 12, font });
  }
  return doc.save();
}

/** Text pages only: no image at all. `lines` lines of ledger text per page. */
export async function makeTextPdf(pages: number, lines = 40): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(A4);
    for (let l = 0; l < lines; l++) page.drawText(`Ledger ${n}.${l}  Opening balance 12,34,567.89  Closing balance 98,76,543.21`, { x: 40, y: 800 - l * 18, size: 10, font });
  }
  return doc.save();
}

/** Text pages with a small logo image each: images are not the bulk of the file. */
export async function makeMostlyTextPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Raw text that does not deflate much: a long run of distinct numbers per page.
  const logo = addImage(doc, { kind: 'jpeg', width: 300, height: 300, payloadBytes: 6000 }, 99);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(A4);
    drawImage(page, 'Logo', logo, [40, 760, 60, 60]);
    const digits = Array.from(noise(4000, n), (b) => String(b % 10)).join('');
    for (let l = 0; l < 40; l++) page.drawText(digits.slice(l * 90, l * 90 + 90), { x: 40, y: 740 - l * 17, size: 8, font });
  }
  return doc.save();
}
