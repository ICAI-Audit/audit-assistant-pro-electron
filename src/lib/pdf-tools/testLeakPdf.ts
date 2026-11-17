// Test helper only: files built to show what of a left-out page could stay inside a result, and the
// checks that look for it. Not imported by production code. `rawHaystack`, `buildAdversarial` and
// `markerPaths` search a result's raw bytes for left-out pages' markers; `redrawCases` are the
// structures on which trimming a page's resources once changed how a kept page was drawn.
import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';

// ---- the raw-bytes search -----------------------------------------------------------------------

function inflateAll(data: Buffer): string | null {
  for (const fn of [
    (b: Buffer) => zlib.inflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
    (b: Buffer) => zlib.inflateRawSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
  ]) {
    try {
      return fn(data).toString('latin1');
    } catch {
      // next
    }
  }
  return null;
}

const decodeHexStrings = (text: string) =>
  text.replace(/<([0-9A-Fa-f\s]+)>/g, (whole, hex: string) => {
    const h = hex.replace(/\s/g, '');
    if (h.length % 2 !== 0) return whole;
    const raw = Buffer.from(h, 'hex').toString('latin1');
    return `${whole}${raw}${raw.replace(/\0/g, '')}`;
  });

/** Every byte of the file as text: the raw bytes, every stream inflated (object streams too), hex strings decoded. */
export function rawHaystack(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString('latin1');
  const parts = [s];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const inflated = inflateAll(Buffer.from(s.slice(start, end), 'latin1'));
    if (inflated !== null) {
      parts.push(inflated);
      const again = inflateAll(Buffer.from(inflated, 'latin1'));
      if (again !== null) parts.push(again);
    }
    re.lastIndex = end + 9;
  }
  return decodeHexStrings(parts.join('\n'));
}

/** The markers found anywhere in the file's bytes, streams inflated. */
export function rawFound(bytes: Uint8Array, ids: readonly string[]): string[] {
  const hay = rawHaystack(bytes);
  return ids.filter((id) => hay.includes(id));
}

// ---- where a marker sits: the object path from the trailer --------------------------------------

function leafText(o: PDFObject): string {
  if (o instanceof PDFString || o instanceof PDFHexString) {
    try {
      return `${o.decodeText()} ${o.toString()}`;
    } catch {
      return o.toString();
    }
  }
  if (o instanceof PDFName) return o.decodeText();
  return '';
}

function streamText(o: PDFRawStream): string {
  try {
    return decodeHexStrings(Buffer.from(decodePDFRawStream(o).decode()).toString('latin1'));
  } catch {
    return Buffer.from(o.contents).toString('latin1');
  }
}

/** For each marker found in the file's objects: the first (shortest) path from Root/Info, or UNREACHABLE n g R. */
export async function markerPaths(bytes: Uint8Array, ids: readonly string[]): Promise<Record<string, string>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const ctx = doc.context;
  const out: Record<string, string> = {};
  const seen = new Set<PDFRef>();
  const queue: [PDFObject, string][] = [];
  if (ctx.trailerInfo.Root) queue.push([ctx.trailerInfo.Root, 'Root']);
  if (ctx.trailerInfo.Info) queue.push([ctx.trailerInfo.Info, 'Info']);
  const note = (text: string, path: string) => {
    for (const id of ids) if (!(id in out) && text.includes(id)) out[id] = path;
  };
  while (queue.length > 0) {
    const [o, path] = queue.shift()!;
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      const v = ctx.lookup(o);
      if (v !== undefined) queue.push([v, `${path}(${o.objectNumber})`]);
      continue;
    }
    if (o instanceof PDFRawStream) {
      for (const [k, v] of o.dict.entries()) {
        note(k.decodeText(), `${path}/${k.decodeText()}`);
        queue.push([v, `${path}/${k.decodeText()}`]);
      }
      note(streamText(o), `${path}<stream>`);
    } else if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        note(k.decodeText(), `${path}/${k.decodeText()}`);
        queue.push([v, `${path}/${k.decodeText()}`]);
      }
    } else if (o instanceof PDFArray) {
      o.asArray().forEach((v, i) => queue.push([v, `${path}[${i}]`]));
    } else {
      note(leafText(o), path);
    }
  }
  for (const [ref, o] of ctx.enumerateIndirectObjects()) {
    if (seen.has(ref)) continue;
    const text = o instanceof PDFRawStream ? o.dict.toString() + streamText(o) : decodeHexStrings(o.toString());
    note(text, `UNREACHABLE ${ref.toString()}`);
  }
  return out;
}

// ---- rendering with pdf.js (pixels, text and warnings) ------------------------------------------

export interface RenderedPage {
  /** SHA-256 of the page's RGBA pixels at scale 1. */
  pixels: string;
  text: string;
}

/**
 * Every page drawn by pdf.js, with the warnings pdf.js gave while opening and drawing the file
 * (pdf.js warns through console.warn and logs through console.log: both are collected).
 */
export async function renderedPages(bytes: Uint8Array): Promise<{ pages: RenderedPage[]; warnings: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = `${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/standard_fonts/`;
  const warnings: string[] = [];
  const { log, warn } = console;
  const collect = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
  console.log = collect;
  console.warn = collect;
  try {
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 1, standardFontDataUrl }).promise;
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } }).canvasFactory;
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, canvasContext: context, viewport } as never).promise;
      const data = context.getImageData(0, 0, Math.ceil(viewport.width), Math.ceil(viewport.height)).data;
      const content = await page.getTextContent();
      pages.push({
        pixels: createHash('sha256').update(data).digest('hex'),
        text: content.items.map((item) => ('str' in item ? item.str : '')).join('').trim(),
      });
    }
    await pdf.destroy();
    return { pages, warnings };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

// ---- a file whose pages share and inherit their resources ----------------------------------------

/** Text that sits in the resources each page alone uses (or in its own content). */
export const SHARED_MARKERS: Record<1 | 2 | 3 | 4, string[]> = {
  1: ['PG1-TEXT', 'PG1-XOBJ', 'PG1-NESTED', 'PG1-XR', 'PG1-IMG', 'PG1-T3IMG', 'PG1-PAT', 'PG1-GS', 'PG1-CS', 'PG1-OCG', 'PG1-SPFONT'],
  2: ['PG2-TEXT', 'PG2-FONT', 'PG2-XOBJSHARED', 'PG2-NESTEDIMG', 'PG2-T3IMG', 'PG2-PAT', 'PG2-GS', 'PG2-CS', 'PG2-SHADING', 'PG2-OCG', 'PG2-ESCFONT'],
  3: ['PG3-TEXT'],
  4: ['PG4-TEXT', 'PG4-IMGSHARED', 'PG4-PRIV'],
};

/**
 * Four pages. The page tree's root holds one resource dictionary that pages 1 and 2 inherit; page 3
 * names the same dictionary itself; page 4 has its own, which also names page 4's shared image. In
 * the shared dictionary: fonts (one with a name written `/F#20sp`, one used as `/Esc#32`, a Type 3
 * font with its own resources and one without), form XObjects (one with nested resource-less form,
 * one resource-less form drawn by the page, one only page 2 draws), images, graphics states, colour
 * spaces (with an implicit DefaultRGB), tiling patterns, a shading and two layers (page 1's hidden
 * by default). Every page draws only what its markers name.
 */
export async function makeSharedResourcesPdf(options: { predictorOnPage1?: boolean; nonStreamContentOnPage1?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const pages = [1, 2, 3, 4].map(() => doc.addPage([300, 400]));
  const reg = (o: PDFObject) => ctx.register(o);
  const flate = (content: string | Uint8Array, dict: Record<string, unknown> = {}) => reg(ctx.flateStream(content, dict as never));
  const S = (s: string) => PDFString.of(s);
  const image = (marker: string) => {
    const b = new Uint8Array(64).fill(0x80);
    b.set(Buffer.from(marker, 'latin1'));
    return flate(b, { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
  };
  const font = (base: string, marker: string) => reg(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: base, Encoding: 'WinAnsiEncoding', Marker: S(marker) }));
  const helv = reg(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  const form = (content: string, resources?: Record<string, unknown>) =>
    flate(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 400], ...(resources ? { Resources: resources } : {}) });
  const xn = form('BT /F1 9 Tf 20 250 Td (PG1-NESTED) Tj ET');
  const xk = form('BT /F1 9 Tf 20 270 Td (PG1-XOBJ) Tj ET /XN Do', { Font: { F1: helv }, XObject: { XN: xn } });
  const xr = form('/GS1 gs BT /F1 9 Tf 20 230 Td (PG1-XR) Tj ET');
  const xs2 = form('BT /F1 9 Tf 20 270 Td (PG2-XOBJSHARED) Tj ET', { Font: { F1: helv } });
  const xu = form('q 20 0 0 20 200 250 cm /IMU Do Q', { XObject: { IMU: image('PG2-NESTEDIMG') } });
  const t3 = (glyph: string, resources?: Record<string, unknown>) =>
    reg(
      ctx.obj({
        Type: 'Font',
        Subtype: 'Type3',
        FontBBox: [0, 0, 1000, 1000],
        FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        CharProcs: { g: flate(glyph) },
        Encoding: { Type: 'Encoding', Differences: [97, 'g'] },
        FirstChar: 97,
        LastChar: 97,
        Widths: [1000],
        ...(resources ? { Resources: resources } : {}),
      } as never),
    );
  const pattern = (marker: string) =>
    flate(`0 0 1 rg 0 0 5 5 re f % ${marker}`, { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {} });
  const im4 = image('PG4-IMGSHARED');
  const shared = reg(
    ctx.obj({
      ProcSet: ['PDF', 'Text', 'ImageB'],
      Font: {
        F1: helv,
        F2: font('Times-Roman', 'PG2-FONT'),
        'F sp': font('Courier', 'PG1-SPFONT'),
        Esc2: font('Courier-Bold', 'PG2-ESCFONT'),
        T3: t3('1000 0 d0 q 1000 0 0 1000 0 0 cm /GI Do Q', { XObject: { GI: image('PG1-T3IMG') } }),
        T3B: t3('1000 0 d0 q 1000 0 0 1000 0 0 cm /IMT Do Q'),
      },
      XObject: { XK: xk, XR: xr, XS2: xs2, XU: xu, IM1: image('PG1-IMG'), IM4: im4, IMT: image('PG2-T3IMG') },
      ExtGState: { GS1: { Type: 'ExtGState', CA: 1, ca: 1, Marker: S('PG1-GS') }, GS2: { Type: 'ExtGState', CA: 1, ca: 1, Marker: S('PG2-GS') } },
      ColorSpace: { CS1: ['Indexed', 'DeviceRGB', 1, S('PG1-CS')], CS2: ['Indexed', 'DeviceRGB', 1, S('PG2-CS')], DefaultRGB: ['CalRGB', { WhitePoint: [0.9505, 1, 1.089] }] },
      Pattern: { P1: pattern('PG1-PAT'), P2: pattern('PG2-PAT') },
      Shading: {
        SH2: { ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 300, 0], Function: { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 }, Marker: S('PG2-SHADING') },
      },
      Properties: { OC1: reg(ctx.obj({ Type: 'OCG', Name: S('PG1-OCG') })), OC2: reg(ctx.obj({ Type: 'OCG', Name: S('PG2-OCG') })) },
    } as never),
  );
  const root = ctx.lookup(doc.catalog.get(PDFName.of('Pages')), PDFDict);
  root.set(PDFName.of('Resources'), shared);
  for (const page of [pages[0], pages[1]]) page.node.delete(PDFName.of('Resources'));
  pages[2].node.set(PDFName.of('Resources'), shared);
  pages[3].node.set(
    PDFName.of('Resources'),
    ctx.obj({ Font: { F1: helv }, XObject: { IM4: im4, XP4: form('BT /F1 9 Tf 20 250 Td (PG4-PRIV) Tj ET', { Font: { F1: helv } }) } } as never),
  );
  const contents = [
    'BT /F1 14 Tf 20 360 Td (PG1-TEXT) Tj ET q /XK Do Q q /XR Do Q q 40 0 0 40 200 300 cm /IM1 Do Q BT /F#20sp 10 Tf 20 330 Td (spaced) Tj ET ' +
      'BT /T3 20 Tf 20 290 Td (a) Tj ET /CS1 cs 1 sc 20 150 30 30 re f /Pattern cs /P1 scn 60 150 30 30 re f ' +
      '/OC /OC1 BDC 0 0 1 rg 100 150 30 30 re f EMC 0.5 0.5 0.5 rg 140 150 30 30 re f',
    'BT /F2 14 Tf 20 360 Td (PG2-TEXT) Tj ET q /XS2 Do Q q /XU Do Q /GS2 gs /CS2 cs 0 sc 20 150 30 30 re f /Pattern cs /P2 scn 60 150 30 30 re f ' +
      'q 100 150 30 30 re W n /SH2 sh Q /OC /OC2 BDC 0 g 140 150 30 30 re f EMC BT /Esc#32 12 Tf 20 100 Td (esc) Tj ET BT /T3B 20 Tf 20 60 Td (a) Tj ET',
    'BT /F1 14 Tf 20 360 Td (PG3-TEXT) Tj ET',
    'BT /F1 14 Tf 20 360 Td (PG4-TEXT) Tj ET q 40 0 0 40 20 300 cm /IM4 Do Q q /XP4 Do Q',
  ];
  pages.forEach((page, i) => page.node.set(PDFName.of('Contents'), flate(contents[i])));
  if (options.predictorOnPage1) {
    // FlateDecode with a PNG predictor: pdf.js reads it; pdf-lib's decoder does not apply predictors.
    const raw = Buffer.from(contents[0], 'latin1');
    const predicted = Buffer.concat([Buffer.from([0]), raw]);
    pages[0].node.set(
      PDFName.of('Contents'),
      reg(ctx.stream(zlib.deflateSync(predicted), { Filter: 'FlateDecode', DecodeParms: { Predictor: 12, Columns: raw.length } } as never)),
    );
  }
  if (options.nonStreamContentOnPage1) {
    pages[0].node.set(PDFName.of('Contents'), ctx.obj([pages[0].node.get(PDFName.of('Contents'))!, 7] as never));
  }
  const oc = ctx.lookup(shared, PDFDict).lookup(PDFName.of('Properties'), PDFDict);
  const [oc1, oc2] = [oc.get(PDFName.of('OC1'))!, oc.get(PDFName.of('OC2'))!];
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [oc1, oc2], D: { Order: [oc1, oc2], ON: [oc2], OFF: [oc1] } } as never));
  return doc.save({ useObjectStreams: true });
}

/**
 * Two pages sharing one resource dictionary. Page 1 shows text containing "/IMX" and an inline
 * image whose bytes read "/F9 ": IMX and F9 may only be kept because of them (an extra keep, never
 * a wrong drop). UNUSED is used by no page.
 */
export async function makeNameLookalikePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const [p1, p2] = [doc.addPage([300, 400]), doc.addPage([300, 400])];
  const helv = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  const image = (marker: string) => {
    const b = new Uint8Array(64).fill(0x40);
    b.set(Buffer.from(marker, 'latin1'));
    return ctx.register(ctx.flateStream(b, { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never));
  };
  const shared = ctx.register(
    ctx.obj({
      Font: { F1: helv, F9: ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Courier', Marker: PDFString.of('LOOK-F9') } as never) },
      XObject: { IMX: image('LOOK-IMX'), UNUSED: image('LOOK-UNUSED'), IP2: image('LOOK-P2') },
    } as never),
  );
  for (const p of [p1, p2]) p.node.set(PDFName.of('Resources'), shared);
  const inline = Buffer.concat([
    Buffer.from('BT /F1 12 Tf 20 360 Td (draws /IMX by name only in a string) Tj ET q 80 0 0 10 20 300 cm BI /W 8 /H 1 /CS /G /BPC 8 ID ', 'latin1'),
    Buffer.from([0x2f, 0x46, 0x39, 0x20, 0x10, 0x20, 0x30, 0x40]),
    Buffer.from(' EI Q', 'latin1'),
  ]);
  p1.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(inline)));
  p2.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('q 40 0 0 40 20 300 cm /IP2 Do Q')));
  return doc.save({ useObjectStreams: true });
}

/**
 * `n` pages, each drawing its own image from one XObject dictionary all pages share (as some
 * scanners write): written into every page's resources, or (`indirect`) one object they all name.
 */
export async function makeSharedScan(n: number, imageBytes: number, options: { indirect?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = Array.from({ length: n }, () => doc.addPage([595, 842]));
  let seed = 12345;
  const images = pages.map((_, i) => {
    // Scan-like data: it does not compress (a simple generator, so the file is the same every run).
    const b = new Uint8Array(imageBytes);
    for (let k = 0; k < b.length; k++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      b[k] = seed >>> 24;
    }
    b.set(Buffer.from(`SCAN-IMG-${i + 1}-`, 'latin1'));
    return ctx.register(ctx.flateStream(b, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: imageBytes, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never));
  });
  pages.forEach((page, i) => page.drawText(`Page ${i + 1}`, { x: 50, y: 800, size: 12, font }));
  await doc.flush();
  const dictionary = ctx.obj(Object.fromEntries(images.map((ref, i) => [`Im${i}`, ref])));
  const xobjects = options.indirect ? ctx.register(dictionary) : dictionary;
  pages.forEach((page, i) => {
    page.node.Resources()!.set(PDFName.of('XObject'), xobjects);
    const content = ctx.register(ctx.flateStream(`q 100 0 0 100 300 300 cm /Im${i} Do Q`));
    const existing = page.node.get(PDFName.of('Contents'))!;
    const looked = existing instanceof PDFRef ? ctx.lookup(existing) : existing;
    if (looked instanceof PDFArray) looked.push(content);
    else page.node.set(PDFName.of('Contents'), ctx.obj([existing, content]));
  });
  return doc.save({ useObjectStreams: true });
}

// ---- the re-review's adversarial file ------------------------------------------------------------

export interface Marker {
  id: string;
  /** 0 = document-level */
  page: number;
}

export const ADVERSARIAL_MARKERS: Marker[] = [
  ...['PG1-TEXT', 'PG1-XOBJ', 'PG1-FIELDVAL', 'PG1-CITY', 'PG1-REPLY', 'PG1-RADIOAP', 'PG1-THUMB', 'PG1-SIGAP', 'PG1-ORPHVAL', 'PG1-BEAD', 'PG1-BOOKMARK', 'PG1-STRUCT'].map((id) => ({ id, page: 1 })),
  ...[
    'PG2-TEXT',
    'PG2-ACTUAL',
    'PG2-XOBJSHARED',
    'PG2-FONT',
    'PG2-OCG',
    'PG2-ANNOT',
    'PG2-AUTHOR',
    'PG2-LINKANNOT',
    'PG2-FIELDVAL',
    'PG2-FIELDAP',
    'PG2-BOTHAP',
    'PG2-MKCA',
    'PG2-KIDVAL',
    'PG2-KIDAP',
    'PG2-RADIOAP',
    'PG2-OPTB',
    'PG2-SIGNER',
    'PG2-SIGAP',
    'PG2-SIGWIDGETAP',
    'PG2-ORPHVAL',
    'PG2-ORPHAP',
    'PG2-BEAD',
    'PG2-THUMB',
    'PG2-PAGEAA',
    'PG2-BOOKMARK',
    'PG2-STRUCT',
    'PG2-STRUCTALT',
    'PG2-LABEL',
  ].map((id) => ({ id, page: 2 })),
  { id: 'PG3-TEXT', page: 3 },
  ...['PG4-TEXT', 'PG4-IMGSHARED', 'PG4-XOBJPRIV', 'PG4-POPUPPARENT'].map((id) => ({ id, page: 4 })),
  { id: 'DOC-XMP', page: 0 },
  { id: 'DOC-THREADTITLE', page: 0 },
];

/**
 * Four pages. Page tree: root (shared /Resources SR) -> A (/Rotate 90, /MediaBox 500x300) -> p1, p2;
 * root -> B -> p3 (own /Resources = SR, /Rotate 180), p4 (own private resources). Fields, comments
 * with replies and popups, a signature field on two pages, a parent field missing from /Fields,
 * article beads, a structure tree, bookmarks, layers. `sd`: a link on page 1 with a PDF 2.0
 * structure destination (/SD) into page 2's structure element.
 */
export async function buildAdversarial(opts: { objectStreams?: boolean; sd?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  doc.setTitle('DOC-TITLE');
  const pages = [0, 1, 2, 3].map(() => doc.addPage([300, 400]));
  const [p1, p2, p3, p4] = pages;
  const reg = (o: PDFObject) => ctx.register(o);
  const later = () => ctx.nextRef();
  const put = (ref: PDFRef, o: Record<string, unknown>) => ctx.assign(ref, ctx.obj(o as never));
  const flate = (text: string | Uint8Array, dict: Record<string, unknown> = {}) => reg(ctx.flateStream(text, dict as never));
  const S = (s: string) => PDFString.of(s);

  const helv = reg(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  const secretFont = reg(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'PG2-FONT', Encoding: 'WinAnsiEncoding' }));
  const form = (text: string) => flate(`BT /F1 10 Tf 10 10 Td (${text}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 400], Resources: { Font: { F1: helv } } });
  const image = (text: string) => {
    const bytes = new Uint8Array(64);
    bytes.set(Buffer.from(text, 'latin1'));
    return flate(bytes, { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
  };
  const xs2 = form('PG2-XOBJSHARED');
  const xk = form('PG1-XOBJ');
  const im4 = image('PG4-IMGSHARED');
  const xp4 = form('PG4-XOBJPRIV');
  const ocg2 = reg(ctx.obj({ Type: 'OCG', Name: S('PG2-OCG') }));
  const SR = reg(ctx.obj({ Font: { F1: helv, F2: secretFont }, XObject: { XS2: xs2, XK: xk, IM4: im4 }, Properties: { OC2: ocg2 } } as never));

  const rootRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef;
  const root = ctx.lookup(rootRef, PDFDict);
  const A = reg(ctx.obj({ Type: 'Pages', Parent: rootRef, Kids: [p1.ref, p2.ref], Count: 2, Rotate: 90, MediaBox: [0, 0, 500, 300] }));
  const B = reg(ctx.obj({ Type: 'Pages', Parent: rootRef, Kids: [p3.ref, p4.ref], Count: 2 }));
  root.set(PDFName.of('Kids'), ctx.obj([A, B]));
  root.set(PDFName.of('Count'), ctx.obj(4));
  root.set(PDFName.of('Resources'), SR);
  for (const p of [p1, p2]) {
    p.node.set(PDFName.of('Parent'), A);
    p.node.delete(PDFName.of('MediaBox'));
    p.node.delete(PDFName.of('Resources'));
  }
  for (const p of [p3, p4]) p.node.set(PDFName.of('Parent'), B);
  p3.node.set(PDFName.of('Resources'), SR);
  p3.node.set(PDFName.of('Rotate'), ctx.obj(180));
  p4.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: helv }, XObject: { IM4: im4, XP4: xp4 } } as never));

  const contents = [
    'BT /F1 18 Tf 20 200 Td (PG1-TEXT) Tj ET q /XK Do Q',
    'BT /F2 18 Tf 20 200 Td (PG2-TEXT) Tj ET /OC /OC2 BDC q /XS2 Do Q EMC /Span <</ActualText (PG2-ACTUAL)>> BDC EMC',
    'BT /F1 18 Tf 20 200 Td (PG3-TEXT) Tj ET',
    'BT /F1 18 Tf 20 200 Td (PG4-TEXT) Tj ET q 8 0 0 8 10 10 cm /IM4 Do Q q /XP4 Do Q',
  ];
  pages.forEach((p, i) => p.node.set(PDFName.of('Contents'), flate(contents[i])));

  const ap = (text: string) => flate(`BT /F1 10 Tf 2 2 Td (${text}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 20], Resources: SR });
  const rect = [20, 20, 200, 40];
  const W = (o: Record<string, unknown>) => ({ Type: 'Annot', Subtype: 'Widget', Rect: rect, F: 4, ...o });

  const kept1 = reg(ctx.obj(W({ FT: 'Tx', T: S('kept1'), V: S('PG1-FIELDVAL'), P: p1.ref, AP: { N: ap('PG1-FIELDVAL') } }) as never));
  const both = later();
  const wb1 = reg(ctx.obj(W({ Parent: both, P: p1.ref, AP: { N: ap('BOTHVALUE') } }) as never));
  const wb2 = reg(ctx.obj(W({ Parent: both, P: p2.ref, AP: { N: ap('PG2-BOTHAP') }, MK: { CA: S('PG2-MKCA') } }) as never));
  put(both, { FT: 'Tx', T: S('both'), V: S('BOTHVALUE'), Kids: [wb1, wb2] });
  const addr = later();
  const city = reg(ctx.obj(W({ FT: 'Tx', T: S('city'), V: S('PG1-CITY'), Parent: addr, P: p1.ref, AP: { N: ap('PG1-CITY') } }) as never));
  const zip = reg(ctx.obj(W({ FT: 'Tx', T: S('zip'), V: S('PG2-KIDVAL'), Parent: addr, P: p2.ref, AP: { N: ap('PG2-KIDAP') } }) as never));
  put(addr, { T: S('addr'), Kids: [city, zip] });
  const removedOnly = reg(ctx.obj(W({ FT: 'Tx', T: S('removedonly'), V: S('PG2-FIELDVAL'), P: p2.ref, AP: { N: ap('PG2-FIELDAP') } }) as never));
  const off = ap('OFF');
  const choice = later();
  const r1 = reg(ctx.obj(W({ Parent: choice, P: p1.ref, AS: 'OptA', AP: { N: { OptA: ap('PG1-RADIOAP'), Off: off } } }) as never));
  const r2 = reg(ctx.obj(W({ Parent: choice, P: p2.ref, AS: 'Off', AP: { N: { 'PG2-OPTB': ap('PG2-RADIOAP'), Off: off } } }) as never));
  put(choice, { FT: 'Btn', Ff: 49152, T: S('choice'), V: 'OptA', Kids: [r1, r2] });
  const sigDict = (name: string) =>
    reg(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 10, 20, 30], Contents: PDFHexString.of('30'.repeat(32)), Name: S(name), Reason: S('REASON') }));
  const sig1 = later();
  const sw1 = reg(ctx.obj(W({ Parent: sig1, P: p1.ref, AP: { N: ap('PG1-SIGAP') } }) as never));
  const sw2 = reg(ctx.obj(W({ Parent: sig1, P: p2.ref, AP: { N: ap('PG2-SIGWIDGETAP') } }) as never));
  put(sig1, { FT: 'Sig', T: S('sig1'), V: sigDict('SIGNER-KEPT'), Kids: [sw1, sw2] });
  const sigp2 = reg(ctx.obj(W({ FT: 'Sig', T: S('sigp2'), V: sigDict('PG2-SIGNER'), P: p2.ref, AP: { N: ap('PG2-SIGAP') } }) as never));
  const orph = later();
  const oa = reg(ctx.obj(W({ FT: 'Tx', T: S('a'), V: S('PG1-ORPHVAL'), Parent: orph, P: p1.ref }) as never));
  const ob = reg(ctx.obj(W({ FT: 'Tx', T: S('b'), V: S('PG2-ORPHVAL'), Parent: orph, P: p2.ref, AP: { N: ap('PG2-ORPHAP') } }) as never));
  put(orph, { T: S('orph'), Kids: [oa, ob] });
  const acro = reg(ctx.obj({ Fields: [kept1, both, addr, removedOnly, choice, sig1, sigp2], NeedAppearances: true, DA: S('/Helv 0 Tf 0 g'), DR: { Font: { Helv: helv } }, SigFlags: 3, CO: [kept1, removedOnly] } as never));
  doc.catalog.set(PDFName.of('AcroForm'), acro);

  const textP2 = later();
  const popupP2 = reg(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Parent: textP2, P: p2.ref, Rect: rect } as never));
  put(textP2, { Type: 'Annot', Subtype: 'Text', Contents: S('PG2-ANNOT'), T: S('PG2-AUTHOR'), Rect: rect, P: p2.ref, Popup: popupP2 });
  const linkP2 = reg(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Contents: S('PG2-LINKANNOT'), Dest: [p1.ref, 'Fit'] } as never));
  const reply = reg(ctx.obj({ Type: 'Annot', Subtype: 'Text', IRT: textP2, RT: 'R', Contents: S('PG1-REPLY'), Rect: rect, P: p1.ref } as never));
  const markupP4 = later();
  const popupP3 = reg(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Parent: markupP4, P: p3.ref, Rect: rect } as never));
  put(markupP4, { Type: 'Annot', Subtype: 'Text', Contents: S('PG4-POPUPPARENT'), Rect: rect, P: p4.ref, Popup: popupP3 });
  const link = (o: Record<string, unknown>) => reg(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...o } as never));
  const l1 = link({ Dest: [p2.ref, 'Fit'] });
  const l2 = link({ A: { S: 'GoTo', D: [p4.ref, 'XYZ', 0, 0, 0] } });
  const l3 = link({ Dest: S('toP2') });
  const l4 = link({ Dest: [p3.ref, 'Fit'] });
  const l3to1 = link({ Dest: [p1.ref, 'Fit'] });

  const str = later();
  const se1 = reg(ctx.obj({ Type: 'StructElem', S: 'P', P: str, Pg: p1.ref, K: 0, ActualText: S('PG1-STRUCT') } as never));
  const se2 = reg(ctx.obj({ Type: 'StructElem', S: 'Figure', P: str, Pg: p2.ref, K: [0, { Type: 'OBJR', Obj: textP2, Pg: p2.ref }], Alt: S('PG2-STRUCTALT'), ActualText: S('PG2-STRUCT') } as never));
  put(str, { Type: 'StructTreeRoot', K: [se1, se2], ParentTree: { Nums: [0, [se1], 1, [se2]] } });
  p1.node.set(PDFName.of('StructParents'), ctx.obj(0));
  p2.node.set(PDFName.of('StructParents'), ctx.obj(1));
  doc.catalog.set(PDFName.of('StructTreeRoot'), str);
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));

  const p1Annots = [kept1, wb1, city, r1, sw1, l1, l2, l3, l4, reply, oa];
  if (opts.sd) p1Annots.push(link({ A: { S: 'GoTo', D: [p3.ref, 'Fit'], SD: [se2, 'Fit'] } }));
  p1.node.set(PDFName.of('Annots'), ctx.obj(p1Annots));
  p2.node.set(PDFName.of('Annots'), ctx.obj([wb2, zip, removedOnly, r2, sw2, sigp2, textP2, popupP2, linkP2, ob]));
  p3.node.set(PDFName.of('Annots'), ctx.obj([popupP3, l3to1]));
  p4.node.set(PDFName.of('Annots'), ctx.obj([markupP4]));

  p1.node.set(PDFName.of('AA'), ctx.obj({ O: { S: 'GoTo', D: [p2.ref, 'Fit'] } } as never));
  p2.node.set(PDFName.of('AA'), ctx.obj({ O: { S: 'JavaScript', JS: S('PG2-PAGEAA') } } as never));
  const thread = later();
  const bead1 = later();
  const bead2 = later();
  put(thread, { Type: 'Thread', F: bead1, I: { Title: S('DOC-THREADTITLE') } });
  put(bead1, { Type: 'Bead', T: thread, N: bead2, V: bead2, P: p1.ref, R: rect, Marker: S('PG1-BEAD') });
  put(bead2, { Type: 'Bead', T: thread, N: bead1, V: bead1, P: p2.ref, R: rect, Marker: S('PG2-BEAD') });
  doc.catalog.set(PDFName.of('Threads'), ctx.obj([thread]));
  p1.node.set(PDFName.of('B'), ctx.obj([bead1]));
  p2.node.set(PDFName.of('B'), ctx.obj([bead2]));
  p1.node.set(PDFName.of('Thumb'), image('PG1-THUMB'));
  p2.node.set(PDFName.of('Thumb'), image('PG2-THUMB'));

  const outlines = later();
  const o1 = later();
  const o2 = later();
  put(o1, { Title: S('PG1-BOOKMARK'), Parent: outlines, Dest: [p1.ref, 'Fit'], Next: o2 });
  put(o2, { Title: S('PG2-BOOKMARK'), Parent: outlines, Dest: [p2.ref, 'Fit'], Prev: o1 });
  put(outlines, { Type: 'Outlines', First: o1, Last: o2, Count: 2 });
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: { Names: [S('toP2'), [p2.ref, 'Fit']] } } as never));
  doc.catalog.set(PDFName.of('OpenAction'), ctx.obj([p2.ref, 'Fit']));
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: [0, { S: 'D' }, 1, { P: S('PG2-LABEL') }, 2, { S: 'D' }] } as never));
  doc.catalog.set(PDFName.of('Metadata'), flate('<x:xmpmeta>DOC-XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocg2], D: { Order: [ocg2], ON: [ocg2] } } as never));

  return doc.save({ useObjectStreams: opts.objectStreams ?? false, updateFieldAppearances: false });
}

// ---- the structures the second re-review drew before and after (probe wrongdrop.test.ts, wd2.test.ts) ----

export interface RedrawCase {
  label: string;
  bytes: Uint8Array;
  /** The source pages (from 0) a result keeps. */
  kept: number[];
  /**
   * 'same': every kept page draws as in the source and the run says nothing. 'flagged': the run
   * keeps the page's resources whole and says so (the source cannot be read with certainty).
   */
  expect: 'same' | 'flagged';
  /** Resource names no kept page uses: none may be in the result. */
  absent: string[];
  /** A resource the first kept page must keep, for a rule pdf.js does not show in pixels. */
  keeps?: { category: string; name: string };
}

type Builder = ReturnType<typeof builder>;
function builder(doc: PDFDocument) {
  const ctx = doc.context;
  const reg = (o: PDFObject) => ctx.register(o);
  const obj = (o: unknown) => ctx.obj(o as never);
  const flate = (content: string | Uint8Array, dict: Record<string, unknown> = {}) => reg(ctx.flateStream(content, dict as never));
  const raw = (content: Uint8Array, dict: Record<string, unknown> = {}) => reg(ctx.stream(content, dict as never));
  const image = (gray: number) => flate(new Uint8Array(64).fill(gray), { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
  const form = (content: string, extra: Record<string, unknown> = {}) => flate(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 400], ...extra });
  const helv = reg(obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  return { ctx, reg, obj, flate, raw, image, form, helv };
}

/** Two pages that inherit one resource dictionary from the page tree; page 2 draws IM2ONLY. */
async function twoPages(build: (b: Builder, p1: PDFPage) => { sr: Record<string, unknown>; p1Contents: PDFObject | undefined }): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const p1 = doc.addPage([300, 400]);
  const p2 = doc.addPage([300, 400]);
  const b = builder(doc);
  const { sr, p1Contents } = build(b, p1);
  const shared = b.reg(b.obj({ ...sr, XObject: { ...((sr.XObject as object) ?? {}), IM2ONLY: b.image(0x99) } }));
  b.ctx.lookup(doc.catalog.get(PDFName.of('Pages')), PDFDict).set(PDFName.of('Resources'), shared);
  for (const p of [p1, p2]) p.node.delete(PDFName.of('Resources'));
  if (p1Contents === undefined) p1.node.delete(PDFName.of('Contents'));
  else p1.node.set(PDFName.of('Contents'), p1Contents);
  p2.node.set(PDFName.of('Contents'), b.flate('q 200 0 0 200 50 100 cm /IM2ONLY Do Q'));
  return doc;
}

const asciiHex = (b: Uint8Array) => Buffer.from(`${Buffer.from(b).toString('hex').toUpperCase()}>`, 'latin1');
function ascii85(b: Uint8Array): Buffer {
  let out = '';
  for (let i = 0; i < b.length; i += 4) {
    let n = ((b[i] << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0);
    const count = Math.min(4, b.length - i);
    if (n === 0 && count === 4) {
      out += 'z';
      continue;
    }
    const digits: string[] = [];
    for (let k = 0; k < 5; k++) {
      digits.unshift(String.fromCharCode((n % 85) + 33));
      n = Math.floor(n / 85);
    }
    out += digits.slice(0, count + 1).join('');
  }
  return Buffer.from(`${out}~>`, 'latin1');
}
function runLength(b: Uint8Array): Uint8Array {
  const parts: number[] = [];
  for (let i = 0; i < b.length; i += 128) {
    const chunk = b.subarray(i, i + 128);
    parts.push(chunk.length - 1, ...chunk);
  }
  parts.push(128);
  return Uint8Array.from(parts);
}
/** LZW with literal codes only and a Clear code every 200 codes (it stays at 9 bits). */
function lzw(b: Uint8Array): Uint8Array {
  const codes: number[] = [256];
  let n = 0;
  for (const byte of b) {
    if (n === 200) {
      codes.push(256);
      n = 0;
    }
    codes.push(byte);
    n++;
  }
  codes.push(257);
  let bits = '';
  for (const code of codes) bits += code.toString(2).padStart(9, '0');
  while (bits.length % 8) bits += '0';
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

const P1_DRAW = 'q 100 0 0 100 50 150 cm /IM1 Do Q BT /F1 18 Tf 20 360 Td (Page one) Tj ET';

/** Every structure of the re-review's wrong-drop hunt, built the same way. */
export async function redrawCases(): Promise<RedrawCase[]> {
  const cases: RedrawCase[] = [];
  const add = async (label: string, doc: PDFDocument | Uint8Array, kept = [0], expect: RedrawCase['expect'] = 'same', absent = ['IM2ONLY']) =>
    void cases.push({ label, bytes: doc instanceof Uint8Array ? doc : await doc.save(), kept, expect, absent });

  // W1: a name split across two content streams (not allowed, but pdf.js joins the streams)
  for (const [label, a, c] of [
    ['W1 name split inside the token', 'q 100 0 0 100 50 150 cm /IM', '1 Do Q'],
    ['W1b split right after the slash', 'q 100 0 0 100 50 150 cm /', 'IM1 Do Q'],
    ['W1c split at a token boundary', 'q 100 0 0 100 50 150 cm /IM1', ' Do Q'],
  ]) {
    await add(label, await twoPages((b) => ({ sr: { XObject: { IM1: b.image(0x20) } }, p1Contents: b.obj([b.flate(a), b.flate(c)]) })));
  }
  // W2: a soft mask whose group has no /Resources draws with the page's resources
  await add(
    'W2 soft-mask group without /Resources (shading)',
    await twoPages((b) => {
      const shading = b.obj({ ShadingType: 2, ColorSpace: 'DeviceGray', Coords: [0, 0, 300, 0], Function: { FunctionType: 2, Domain: [0, 1], C0: [0], C1: [1], N: 1 } });
      const mask = b.form('/ShM sh', { Group: { S: 'Transparency', CS: 'DeviceGray' } });
      return { sr: { ExtGState: { GS1: { Type: 'ExtGState', SMask: { S: 'Luminosity', G: mask } } }, Shading: { ShM: shading } }, p1Contents: b.flate('/GS1 gs 1 0 0 rg 0 0 300 400 re f') };
    }),
  );
  await add(
    'W2b soft-mask group without /Resources (image)',
    await twoPages((b) => {
      const mask = b.form('q 300 0 0 400 0 0 cm /IMM Do Q', { Group: { S: 'Transparency', CS: 'DeviceGray' } });
      return { sr: { ExtGState: { GS1: { Type: 'ExtGState', SMask: { S: 'Luminosity', G: mask } } }, XObject: { IMM: b.image(0x40) } }, p1Contents: b.flate('/GS1 gs 1 0 0 rg 0 0 300 400 re f') };
    }),
  );
  // W3: colour spaces whose base is given by a resource name (pdf.js resolves it)
  await add(
    'W3 Indexed colour space based on a named one',
    await twoPages((b) => ({
      sr: { ColorSpace: { CSI: ['Indexed', 'CSB', 1, PDFHexString.of('FF000000FF00')], CSB: ['CalRGB', { WhitePoint: [0.9505, 1, 1.089], Gamma: [2.2, 2.2, 2.2] }] } },
      p1Contents: b.flate('/CSI cs 1 sc 0 0 300 400 re f'),
    })),
  );
  await add(
    'W3b Pattern colour space based on a named one',
    await twoPages((b) => {
      const pattern = b.flate('0 0 5 5 re f', { Type: 'Pattern', PatternType: 1, PaintType: 2, TilingType: 1, BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {} });
      return { sr: { ColorSpace: { CSP: ['Pattern', 'CSB'], CSB: ['CalRGB', { WhitePoint: [0.9505, 1, 1.089] }] }, Pattern: { PU: pattern } }, p1Contents: b.flate('/CSP cs 0.1 0.7 0.2 /PU scn 0 0 300 400 re f') };
    }),
  );
  // W4: a tiling pattern is drawn with its own resources and its drawer's (pdf.js merges them)
  for (const [label, own] of [
    ['W4 tiling pattern with an empty /Resources drawing a page resource', { Resources: {} }],
    ['W4b tiling pattern without /Resources', {}],
  ] as const) {
    await add(
      label,
      await twoPages((b) => {
        const pattern = b.flate('q 10 0 0 10 0 0 cm /IMP Do Q', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 20, 20], XStep: 20, YStep: 20, ...own });
        return { sr: { Pattern: { P1: pattern }, XObject: { IMP: b.image(0x10) } }, p1Contents: b.flate('/Pattern cs /P1 scn 0 0 300 400 re f') };
      }),
    );
  }
  // W5: forms nested three deep, with and without their own resources
  await add(
    'W5 nested forms A (no resources) > B (resources) > C (no resources)',
    await twoPages((b) => {
      const C = b.form('BT /F1 20 Tf 20 200 Td (Nested three) Tj ET q 50 0 0 50 20 100 cm /IMC Do Q');
      const B = b.form('/C Do', { Resources: { XObject: { C, IMC: b.image(0x30) }, Font: { F1: b.helv } } });
      const A = b.form('/B Do');
      return { sr: { XObject: { A, B, IMNOT: b.image(0x50) } }, p1Contents: b.flate('/A Do') };
    }),
    [0],
    'same',
    ['IM2ONLY', 'IMNOT'],
  );
  await add(
    'W5b nested forms whose /Resources is one shared dictionary',
    await twoPages((b) => {
      const shared = b.ctx.nextRef();
      const C = b.form('q 50 0 0 50 20 100 cm /IMC Do Q BT /F1 20 Tf 20 200 Td (Deep) Tj ET');
      const B = b.form('/C Do', { Resources: shared });
      const A = b.form('/B Do', { Resources: shared });
      b.ctx.assign(shared, b.obj({ XObject: { A, B, C, IMC: b.image(0x30) }, Font: { F1: b.helv } }));
      return { sr: { XObject: { A, IM1: b.image(0x22) } }, p1Contents: b.flate('/A Do') };
    }),
  );
  // W6: escaped names; W6b: a key written with a lower-case escape, which pdf-lib rewrites on save
  await add(
    'W6 escapes in the content (#30, #45, a raw byte E9)',
    await twoPages((b) => ({
      sr: { XObject: { Im0: b.image(0x11), ImE: b.image(0x33), 'Im\u00e9': b.image(0x55) }, Font: { F1: b.helv } },
      p1Contents: b.flate(Buffer.concat([Buffer.from('q 50 0 0 50 10 10 cm /Im#30 Do Q q 50 0 0 50 70 10 cm /Im#45 Do Q q 50 0 0 50 130 10 cm /Im', 'latin1'), Buffer.from([0xe9]), Buffer.from(' Do Q', 'latin1')])),
    })),
  );
  {
    const doc = await twoPages((b) => ({ sr: { XObject: { ImLOWERX: b.image(0x11) } }, p1Contents: b.flate('q 50 0 0 50 10 10 cm /Im#3aXXX Do Q') }));
    const saved = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
    await add('W6b a key with a lower-case escape', new Uint8Array(Buffer.from(saved.replace('/ImLOWERX', '/Im#3aXXX'), 'latin1')), [0], 'flagged', []);
  }
  // W7: content filters
  const body = Buffer.from(P1_DRAW, 'latin1');
  for (const [label, filter, data, expected] of [
    ['W7 LZW', 'LZWDecode', lzw(body), 'same'],
    ['W7 ASCII85 then Flate', ['ASCII85Decode', 'FlateDecode'], ascii85(zlib.deflateSync(body)), 'same'],
    ['W7 RunLength', 'RunLengthDecode', runLength(body), 'same'],
    ['W7 ASCIIHex', 'ASCIIHexDecode', asciiHex(body), 'same'],
    ['W7 DCT on content (unreadable)', 'DCTDecode', body, 'flagged'],
  ] as const) {
    const doc = await twoPages((b) => ({ sr: { XObject: { IM1: b.image(0x20) }, Font: { F1: b.helv } }, p1Contents: b.raw(data, { Filter: filter }) }));
    await add(label, doc, [0], expected, expected === 'same' ? ['IM2ONLY'] : []);
  }
  // W8: an inline image whose colour space is named from the resources
  await add(
    'W8 inline image with a named colour space',
    await twoPages((b) => ({
      sr: { ColorSpace: { CSI2: ['Indexed', 'DeviceRGB', 1, PDFHexString.of('00FF00FF00FF')] } },
      p1Contents: b.flate(Buffer.concat([Buffer.from('q 200 0 0 100 50 150 cm BI /W 2 /H 1 /CS /CSI2 /BPC 8 ID ', 'latin1'), Buffer.from([0, 1]), Buffer.from(' EI Q', 'latin1')])),
    })),
  );
  // W9, W10: empty or no content, and an annotation appearance
  await add(
    'W9 empty content and an annotation appearance with its own resources',
    await twoPages((b, p1) => {
      const ap = b.form('q 80 0 0 80 0 0 cm /IMA Do Q BT /F1 12 Tf 5 90 Td (Annot) Tj ET', { BBox: [0, 0, 100, 100] });
      const own = b.ctx.nextRef();
      (b.ctx.lookup(ap) as PDFRawStream).dict.set(PDFName.of('Resources'), own);
      b.ctx.assign(own, b.obj({ XObject: { IMA: b.image(0x44), IMX: b.image(0x77) }, Font: { F1: b.helv } }));
      p1.node.set(PDFName.of('Annots'), b.obj([b.reg(b.obj({ Type: 'Annot', Subtype: 'Square', Rect: [50, 150, 150, 250], F: 4, AP: { N: ap } }))]));
      return { sr: { XObject: { IMX: b.image(0x77) } }, p1Contents: b.flate('') };
    }),
  );
  await add(
    'W10 a page with no /Contents',
    await twoPages((b, p1) => {
      const ap = b.form('1 0 0 RG 5 w 5 5 90 90 re S', { BBox: [0, 0, 100, 100] });
      p1.node.set(PDFName.of('Annots'), b.obj([b.reg(b.obj({ Type: 'Annot', Subtype: 'Square', Rect: [50, 150, 150, 250], F: 4, C: [1, 0, 0], AP: { N: ap } }))]));
      return { sr: {}, p1Contents: undefined };
    }),
  );
  // W11: three ancestor levels: root (Resources) > A (Rotate 90) > B (MediaBox) > pages
  {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const pages = [doc.addPage([300, 400]), doc.addPage([300, 400]), doc.addPage([300, 400])];
    const b = builder(doc);
    const rootRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef;
    const root = b.ctx.lookup(rootRef, PDFDict);
    const A = b.ctx.nextRef();
    const B = b.ctx.nextRef();
    b.ctx.assign(B, b.obj({ Type: 'Pages', Parent: A, Kids: [pages[0].ref, pages[1].ref], Count: 2, MediaBox: [0, 0, 400, 250] }));
    b.ctx.assign(A, b.obj({ Type: 'Pages', Parent: rootRef, Kids: [B, pages[2].ref], Count: 3, Rotate: 90 }));
    root.set(PDFName.of('Kids'), b.obj([A]));
    root.set(PDFName.of('Resources'), b.reg(b.obj({ XObject: { IM1: b.image(0x20), IM2: b.image(0x99) }, Font: { F1: b.helv } })));
    for (const [i, p] of pages.entries()) {
      p.node.set(PDFName.of('Parent'), i < 2 ? B : A);
      p.node.delete(PDFName.of('Resources'));
      if (i < 2) p.node.delete(PDFName.of('MediaBox'));
      p.node.set(PDFName.of('Contents'), b.flate(i === 1 ? 'q 100 0 0 100 50 100 cm /IM2 Do Q' : P1_DRAW));
    }
    await add('W11 three ancestor levels (pages 1 and 3 kept)', doc, [0, 2], 'same', ['IM2']);
  }
  // W15: a form drawn by a kept and by a left-out page
  {
    const doc = await twoPages((b) => {
      const XS = b.form('q 60 0 0 60 10 10 cm /IMS Do Q BT /F1 14 Tf 10 300 Td (Shared form) Tj ET');
      (b.ctx.lookup(XS) as PDFRawStream).dict.set(PDFName.of('Resources'), b.reg(b.obj({ XObject: { IMS: b.image(0x66), IMZ: b.image(0x12) }, Font: { F1: b.helv } })));
      return { sr: { XObject: { XS } }, p1Contents: b.flate('/XS Do') };
    });
    doc.getPage(1).node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('/XS Do q 100 0 0 100 150 150 cm /IM2ONLY Do Q')));
    const bytes = await doc.save();
    await add('W15 a form drawn by both pages (page 1 kept)', bytes, [0], 'same', ['IM2ONLY', 'IMZ']);
    await add('W15 a form drawn by both pages (page 2 kept)', bytes, [1], 'same', ['IMZ']);
  }
  // W16: a field drawn from /DA and /DR (NeedAppearances)
  {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const [p1, p2] = [doc.addPage([300, 400]), doc.addPage([300, 400])];
    const b = builder(doc);
    const widget = b.reg(
      b.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('amount'), V: PDFString.of('Rs 9,99,999'), DA: PDFString.of('/Helv 14 Tf 0 g'), Rect: [20, 300, 280, 330], F: 4, P: p1.ref }),
    );
    p1.node.set(PDFName.of('Annots'), b.obj([widget]));
    doc.catalog.set(PDFName.of('AcroForm'), b.obj({ Fields: [widget], NeedAppearances: true, DR: { Font: { Helv: b.helv } }, DA: PDFString.of('/Helv 0 Tf 0 g') }));
    const sr = b.reg(b.obj({ Font: { Helv: b.helv }, XObject: { IM2: b.image(0x99) } }));
    for (const p of [p1, p2]) p.node.set(PDFName.of('Resources'), sr);
    p1.node.set(PDFName.of('Contents'), b.flate('BT /Helv 12 Tf 20 360 Td (Form page) Tj ET'));
    p2.node.set(PDFName.of('Contents'), b.flate('q 100 0 0 100 50 100 cm /IM2 Do Q'));
    await add('W16 a field drawn from /DA and /DR', await doc.save({ updateFieldAppearances: false }), [0], 'same', ['IM2']);
  }

  // Further structures for the rules of round 3 (not from the re-review).
  const calGray = ['CalGray', { WhitePoint: [0.9505, 1, 1.089], Gamma: 2.2 }];
  {
    // pdf.js reads an image XObject's colour space without the resources, so only the structure shows it.
    const doc = await twoPages((b) => {
      const img = b.flate(new Uint8Array(64).fill(0x60), { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'CSG', BitsPerComponent: 8 });
      return { sr: { ColorSpace: { CSG: calGray }, XObject: { IMG: img } }, p1Contents: b.flate('q 100 0 0 100 50 150 cm /IMG Do Q') };
    });
    await add('X1 an image whose /ColorSpace is a resource name', doc);
    cases[cases.length - 1].keeps = { category: 'ColorSpace', name: 'CSG' };
  }
  await add(
    "X2 a form whose /Group colour space is a resource name (its drawer's)",
    await twoPages((b) => {
      const XG = b.form('0.2 g 20 20 200 200 re f', { Group: { S: 'Transparency', CS: 'CSG' }, Resources: {} });
      return { sr: { ColorSpace: { CSG: calGray }, XObject: { XG } }, p1Contents: b.flate('/XG Do') };
    }),
  );
  await add(
    "X3 a tiling pattern inside another pattern's own resources, drawing a page resource",
    await twoPages((b) => {
      const tiling = { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1 };
      const inner = b.flate('q 10 0 0 10 0 0 cm /IMQ Do Q', { ...tiling, BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {} });
      const outer = b.flate('/Pattern cs /PIN scn 0 0 20 20 re f', { ...tiling, BBox: [0, 0, 40, 40], XStep: 40, YStep: 40, Resources: { Pattern: { PIN: inner } } });
      return { sr: { Pattern: { P1: outer }, XObject: { IMQ: b.image(0x30) } }, p1Contents: b.flate('/Pattern cs /P1 scn 0 0 300 400 re f') };
    }),
  );
  await add(
    'X4 a DeviceN colour space whose alternate is a resource name',
    await twoPages((b) => ({
      sr: {
        ColorSpace: {
          CSD: ['DeviceN', ['Spot'], 'CSB', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0], C1: [1, 0.2, 0], N: 1 }],
          CSB: ['CalRGB', { WhitePoint: [0.9505, 1, 1.089] }],
        },
      },
      p1Contents: b.flate('/CSD cs 1 sc 0 0 300 400 re f'),
    })),
  );
  await add(
    'X5 an XObject entry that is not a stream (flagged)',
    await twoPages((b) => ({ sr: { XObject: { BAD: b.obj({ Subtype: 'Form' }) } }, p1Contents: b.flate('/BAD Do') })),
    [0],
    'flagged',
    [],
  );
  await add(
    'X6 a soft-mask group that is not a stream (flagged)',
    await twoPages((b) => ({ sr: { ExtGState: { GS1: { Type: 'ExtGState', SMask: { S: 'Luminosity', G: b.obj({ Subtype: 'Form' }) } } } }, p1Contents: b.flate('/GS1 gs 0 0 10 10 re f') })),
    [0],
    'flagged',
    [],
  );
  await add(
    'X7 references deeper than the limit (flagged)',
    await twoPages((b) => {
      let chain = b.reg(b.obj({ End: true }));
      for (let i = 0; i < 40; i++) chain = b.reg(b.obj({ Next: chain }));
      return { sr: { ExtGState: { GS1: { Type: 'ExtGState', CA: 1, Private: chain } } }, p1Contents: b.flate('/GS1 gs 0 0 10 10 re f') };
    }),
    [0],
    'flagged',
    [],
  );
  return cases;
}
