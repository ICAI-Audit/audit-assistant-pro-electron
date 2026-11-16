// Test helper only: synthetic PDFs, PNGs and a pdf.js renderer for the marks tests. Not imported by production code.
import { deflateSync } from 'node:zlib';
import { degrees, PDFDocument, PDFName, PDFNumber, StandardFonts, type PDFObject } from 'pdf-lib';

// ---- PNG -------------------------------------------------------------------------------------

const CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A solid-colour RGB PNG. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  head[8] = 8;
  head[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---- files -----------------------------------------------------------------------------------

/** Five 612 x 792 pages: /Rotate 0, 90, 180, 270, and a page with a CropBox of 364 x 664 away from the origin. */
export async function makePositionsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rotate of [0, 90, 180, 270] as const) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Positions ${rotate}`, { x: 50, y: 700, size: 12, font });
    if (rotate) page.setRotation(degrees(rotate));
  }
  const cropped = doc.addPage([612, 792]);
  cropped.drawText('Positions cropped', { x: 150, y: 600, size: 12, font });
  cropped.setCropBox(100, 50, 364, 664);
  return doc.save();
}

/** One page covered by a picture, with no text: a scan. */
export async function makeScanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(solidPng(20, 20, [230, 230, 230]));
  doc.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  return doc.save();
}

export type StrayKind = 'unclosed-q' | 'flip' | 'scale' | 'extra-q';

/** One 612 x 792 page whose content leaves a stray state behind, as real files do. */
export async function makeStrayPdf(kind: StrayKind): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: doc.context.obj({ F1: font.ref }) }));
  const body = 'BT /F1 12 Tf 100 600 Td (Body) Tj ET';
  const content = {
    'unclosed-q': `${body}\n0.5 0 0 0.5 100 100 cm q 1 0 0 1 10 10 cm`,
    flip: `1 0 0 -1 0 792 cm\nBT /F1 12 Tf 100 192 Td (Body) Tj ET`,
    scale: `0.5 0 0 0.5 0 0 cm\nBT /F1 24 Tf 200 1200 Td (Body) Tj ET`,
    'extra-q': `Q Q 1 0 0 1 40 40 cm\nBT /F1 12 Tf 100 560 Td (Body) Tj ET`,
  }[kind];
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return doc.save();
}

/** n pages (300 x 400) sharing one indirect /Resources with a font and `extra` unused font entries. */
export async function makeSharedPagesPdf(n: number, extra = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: Record<string, unknown> = { F0: font.ref };
  for (let i = 0; i < extra; i++) fonts[`X${i}`] = font.ref;
  const res = doc.context.register(doc.context.obj({ Font: doc.context.obj(fonts as never) }));
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([300, 400]);
    page.node.set(PDFName.of('Resources'), res);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(`BT /F0 12 Tf 20 200 Td (Shared ${i + 1}) Tj ET`)));
  }
  return doc.save({ useObjectStreams: false });
}

export interface RawPdfOptions {
  /** The page's content: text (written with Flate) or bytes (written as they are, with `streamDict`). */
  content: string | Uint8Array;
  size?: [number, number];
  userUnit?: number;
  /** Extra /Resources entries; may also change the document (a layer, a graphics state). */
  resources?: (doc: PDFDocument) => Record<string, PDFObject> | Promise<Record<string, PDFObject>>;
  /** Written as the content stream's dictionary when `content` is bytes. */
  streamDict?: (doc: PDFDocument) => Record<string, PDFObject | string>;
}

/** One page with the font F1 and the given raw content. */
export async function makeRawPdf(opts: RawPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(opts.size ?? [612, 792]);
  const extra = (await opts.resources?.(doc)) ?? {};
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: doc.context.obj({ F1: font.ref }), ...extra }));
  const stream = typeof opts.content === 'string'
    ? doc.context.flateStream(opts.content)
    : doc.context.stream(opts.content, doc.context.obj(opts.streamDict?.(doc) ?? {}) as never);
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  if (opts.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(opts.userUnit));
  return doc.save();
}

export type PredictorKind = 'none' | 'sub' | 'up' | 'avg' | 'paeth' | 'mixed' | 'tiff';
export interface EncodeStep {
  /** The name as written in /Filter, in decode order (a long name or an abbreviation). */
  filter: 'FlateDecode' | 'Fl' | 'ASCIIHexDecode' | 'AHx' | 'RunLengthDecode' | 'RL';
  predictor?: { kind: PredictorKind; columns: number; colors?: number; bpc?: number; predictorValue?: number };
  /** Parameters written for a filter that takes none that matter (to test that they are not trusted). */
  junk?: boolean;
}

const PNG_TAG: Record<string, number> = { none: 0, sub: 1, up: 2, avg: 3, paeth: 4 };
function paethOf(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Encodes bytes with a predictor (one colour, 8 bits): the opposite of what the reader undoes. */
export function predictBytes(input: Uint8Array, kind: PredictorKind, columns: number): Uint8Array {
  const rows = Math.ceil(input.length / columns);
  const data = new Uint8Array(rows * columns).fill(32);
  data.set(input);
  if (kind === 'tiff') {
    const out = new Uint8Array(data);
    for (let i = 0; i < data.length; i++) if (i % columns !== 0) out[i] = (data[i] - data[i - 1]) & 255;
    return out;
  }
  const out = new Uint8Array(rows * (columns + 1));
  for (let r = 0; r < rows; r++) {
    const tag = kind === 'mixed' ? r % 5 : PNG_TAG[kind];
    out[r * (columns + 1)] = tag;
    for (let i = 0; i < columns; i++) {
      const x = data[r * columns + i];
      const left = i > 0 ? data[r * columns + i - 1] : 0;
      const up = r > 0 ? data[(r - 1) * columns + i] : 0;
      const ul = i > 0 && r > 0 ? data[(r - 1) * columns + i - 1] : 0;
      const pred = tag === 0 ? 0 : tag === 1 ? left : tag === 2 ? up : tag === 3 ? (left + up) >> 1 : paethOf(left, up, ul);
      out[r * (columns + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  return out;
}

function runLength(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 128) {
    const chunk = bytes.subarray(i, i + 128);
    out.push(chunk.length - 1, ...chunk);
  }
  out.push(128);
  return Uint8Array.from(out);
}

/** Content text encoded through a chain of filters (given in decode order), as the stream bytes and its dictionary entries. */
export function encodeContent(text: string, steps: EncodeStep[]): { bytes: Uint8Array; dict: (doc: PDFDocument) => Record<string, PDFObject | string> } {
  let data: Uint8Array = Uint8Array.from(Buffer.from(text, 'latin1'));
  for (const step of [...steps].reverse()) {
    const long = { Fl: 'FlateDecode', AHx: 'ASCIIHexDecode', RL: 'RunLengthDecode' }[step.filter as 'Fl'] ?? step.filter;
    if (long === 'FlateDecode') {
      if (step.predictor) data = predictBytes(data, step.predictor.kind, step.predictor.columns);
      data = Uint8Array.from(deflateSync(Buffer.from(data)));
    } else if (long === 'ASCIIHexDecode') data = Uint8Array.from(Buffer.from(`${Buffer.from(data).toString('hex')}>`, 'latin1'));
    else data = runLength(data);
  }
  return {
    bytes: data,
    dict: (doc) => {
      const parms = steps.map((st) => {
        if (st.predictor) {
          const pv = st.predictor.predictorValue ?? (st.predictor.kind === 'tiff' ? 2 : 15);
          return doc.context.obj({ Predictor: pv, Columns: st.predictor.columns, Colors: st.predictor.colors ?? 1, BitsPerComponent: st.predictor.bpc ?? 8 });
        }
        return st.junk ? doc.context.obj({ Junk: 1 }) : null;
      });
      const entries: Record<string, PDFObject | string> = steps.length === 1 ? { Filter: steps[0].filter } : { Filter: doc.context.obj(steps.map((st) => st.filter)) };
      if (parms.some((p) => p !== null)) entries.DecodeParms = steps.length === 1 ? (parms[0] as PDFObject) : doc.context.obj(parms as never);
      return entries;
    },
  };
}

/** The content the stray-state tests use: it leaves a `q` and a scale open. */
export const UNCLOSED_Q_CONTENT = 'BT /F1 12 Tf 100 600 Td (Body) Tj ET\n0.5 0 0 0.5 100 100 cm q 1 0 0 1 10 10 cm';

/** One page whose unclosed-`q` content is stored through the given filters. */
export async function makeEncodedPdf(steps: EncodeStep[], text = UNCLOSED_Q_CONTENT): Promise<Uint8Array> {
  const { bytes, dict } = encodeContent(text, steps);
  return makeRawPdf({ content: bytes, streamDict: dict });
}

/** A Flate content stream with a PNG predictor (Up, 16 columns): pdf-lib decodes it to nonsense without an error. */
export async function makePredictorPdf(predictor: Partial<NonNullable<EncodeStep['predictor']>> = {}): Promise<Uint8Array> {
  return makeEncodedPdf([{ filter: 'FlateDecode', predictor: { kind: 'up', columns: 16, ...predictor } }]);
}

/** A solid-colour RGBA PNG (so that pdf-lib writes a soft mask). */
export function solidPngRgba(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(rgba, y * (width * 4 + 1) + 1 + x * 4);
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  head[8] = 8;
  head[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** A page whose content ends inside marked content of a layer that is switched off (and, for 'text', inside a text object). */
export async function makeOffLayerPdf(kind: 'bdc' | 'nested' | 'bt'): Promise<Uint8Array> {
  const body = 'BT /F1 12 Tf 100 600 Td (Body) Tj';
  const content = {
    bdc: `${body} ET
/OC /MC0 BDC 0 0 1 rg 50 50 100 100 re f`,
    nested: `${body} ET
/OC /MC0 BDC /Span BMC 0 0 1 rg 50 50 100 100 re f`,
    bt: body,
  }[kind];
  return makeRawPdf({
    content,
    resources: (doc) => {
      const ocg = doc.context.register(doc.context.obj({ Type: 'OCG', Name: 'Hidden' }));
      doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [ocg], D: doc.context.obj({ OFF: [ocg] }) }));
      return { Properties: doc.context.obj({ MC0: ocg }) };
    },
  });
}

export { PDFNumber };

// ---- pdf.js ----------------------------------------------------------------------------------

const standardFontDataUrl = (): string => `${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/standard_fonts/`;

export interface Raster { data: Uint8ClampedArray; width: number; height: number }

/** Renders one page (1-based) at `scale` points-to-pixels, as the reader sees it. */
export async function renderPage(bytes: Uint8Array, pageNumber: number, scale = 1): Promise<Raster> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0, standardFontDataUrl: standardFontDataUrl() }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } }).canvasFactory;
    const { canvas, context } = factory.create(width, height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    await page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' } as never).promise;
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } finally {
    await pdf.destroy();
  }
}

export interface Changed { count: number; bbox: [number, number, number, number] | null; centre: [number, number] | null; width: number; height: number }

/** Pixels that differ by more than 6 (summed over the channels) between two renders of one page. */
export async function changedPixels(before: Uint8Array, after: Uint8Array, pageNumber: number, scale = 1): Promise<Changed> {
  const a = await renderPage(before, pageNumber, scale);
  const b = await renderPage(after, pageNumber, scale);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 6) { count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
  }
  return count === 0
    ? { count, bbox: null, centre: null, width: a.width, height: a.height }
    : { count, bbox: [x0, y0, x1, y1], centre: [(x0 + x1) / 2, (y0 + y1) / 2], width: a.width, height: a.height };
}

/** Where a text item lands as the reader sees it (top-left origin), and whether it is upright. */
export async function readerView(bytes: Uint8Array, pageNumber: number, text: string) {
  const { getDocument, Util } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const item = content.items.find((i) => 'str' in i && i.str === text);
    if (!item || !('transform' in item)) throw new Error(`text "${text}" not found`);
    const t = Util.transform(viewport.transform, item.transform);
    return { x: t[4], y: t[5], ux: item.transform[4], uy: item.transform[5], size: Math.hypot(item.transform[2], item.transform[3]), upright: Math.abs(t[1]) < 1e-6 && Math.abs(t[2]) < 1e-6 && t[0] > 0 && t[3] < 0, angle: (Math.atan2(-t[1], t[0]) * 180) / Math.PI, width: item.width, w: viewport.width, h: viewport.height };
  } finally {
    await pdf.destroy();
  }
}
