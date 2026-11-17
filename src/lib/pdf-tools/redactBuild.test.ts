// Redact's build (design 5.9 "Output" and what the result carries). Pages with boxes become a
// picture plus an invisible text layer; the other pages are copied unchanged by the page copy and
// cleaned of what cannot be checked; nothing else of the source document is carried. Every claim
// of removal is tested on the saved bytes: `rawHaystack` (every stream inflated, hex strings
// decoded) and the strings check's own reading (`stringsHaystack`, `findTargets`).
import * as zlib from 'node:zlib';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, StandardFonts, type PDFObject, type PDFPage } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from './inspect';
import { buildRedacted, REBUILT_PAGE_KEYS, type LayerWord, type PagePicture, type RebuiltPage, type RedactBuildReport } from './redactBuild';
import { checkHits, findTargets, stringsHaystack, structureProblems, targetMatcher, type CheckTarget } from './redactCheck';
import { markerPaths, rawFound, rawHaystack } from './testLeakPdf';
import { makeFormPdf, pdfjsFieldValues } from './testPdf';

vi.setConfig({ testTimeout: 120_000 });

const SECRET = 'BNZPM2501F';
const PAN: CheckTarget = { kind: 'pan', forms: [SECRET], wholeWord: false };
const hasPan = targetMatcher([PAN]);
const STANDARD_FONTS = `${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/standard_fonts/`;

// ---- pdf.js in the test: the independent reader, and the renderer that draws page pictures --------

type PdfjsDocument = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs')['getDocument']>['promise']>;

async function openPdf(bytes: Uint8Array): Promise<PdfjsDocument> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 }).promise;
}

interface Canvas {
  canvas: { encode(format: 'jpeg', quality: number): Promise<Uint8Array> };
  context: CanvasRenderingContext2D;
}
const canvasOf = (pdf: PdfjsDocument, w: number, h: number) => (pdf as unknown as { canvasFactory: { create(w: number, h: number): Canvas } }).canvasFactory.create(w, h);

/** A page drawn by pdf.js unturned at `dpi`, on white, as the renderer of Task A9 does; lossless, grey when it has no colour. */
async function renderPicture(bytes: Uint8Array, pageIndex: number, dpi = 72, encoding: 'flate' | 'jpeg' = 'flate'): Promise<PagePicture> {
  const pdf = await openPdf(bytes);
  try {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: dpi / 72, rotation: 0 });
    const w = Math.max(1, Math.floor(viewport.width));
    const h = Math.max(1, Math.floor(viewport.height));
    const { canvas, context } = canvasOf(pdf, w, h);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, w, h);
    await page.render({ canvas, canvasContext: context, viewport } as never).promise;
    if (encoding === 'jpeg') return { bytes: new Uint8Array(await canvas.encode('jpeg', 85)), widthPx: w, heightPx: h, encoding: 'jpeg' };
    const rgba = context.getImageData(0, 0, w, h).data;
    let grey = true;
    for (let p = 0; p < rgba.length && grey; p += 4) grey = rgba[p] === rgba[p + 1] && rgba[p + 1] === rgba[p + 2];
    const pixels = Buffer.alloc(w * h * (grey ? 1 : 3));
    for (let p = 0, q = 0; p < rgba.length; p += 4) {
      pixels[q++] = rgba[p];
      if (!grey) {
        pixels[q++] = rgba[p + 1];
        pixels[q++] = rgba[p + 2];
      }
    }
    return { bytes: new Uint8Array(zlib.deflateSync(pixels)), widthPx: w, heightPx: h, encoding: grey ? 'flate-gray' : 'flate-rgb' };
  } finally {
    await pdf.destroy();
  }
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

async function textItems(bytes: Uint8Array, pageIndex: number): Promise<TextItem[]> {
  const pdf = await openPdf(bytes);
  try {
    const content = await (await pdf.getPage(pageIndex + 1)).getTextContent();
    return (content.items as unknown as TextItem[]).filter((item) => typeof item.str === 'string' && item.str.trim() !== '');
  } finally {
    await pdf.destroy();
  }
}

/** Helvetica advance of one character at size 1 (the fixtures draw with Helvetica, no kerning, no Tc/Tz). */
let helveticaWidth: (ch: string) => number = () => 0.5;

/** pdf.js text items split into words, each placed along its item by Helvetica widths; `keep` chooses them. */
async function pageWords(bytes: Uint8Array, pageIndex: number, keep: (word: string) => boolean = () => true): Promise<LayerWord[]> {
  const words: LayerWord[] = [];
  for (const item of await textItems(bytes, pageIndex)) {
    const chars = Array.from(item.str);
    const total = chars.reduce((sum, ch) => sum + helveticaWidth(ch), 0) || 1;
    const [a, b, c, d, e, f] = item.transform;
    const along = Math.hypot(a, b) || 1;
    let offset = 0;
    let word = '';
    let wordStart = 0;
    const flush = () => {
      if (word && keep(word)) {
        const start = (item.width * wordStart) / total;
        words.push({ text: word, transform: [a, b, c, d, e + (a / along) * start, f + (b / along) * start], width: (item.width * (offset - wordStart)) / total });
      }
      word = '';
    };
    for (const ch of chars) {
      if (ch === ' ') {
        flush();
        offset += helveticaWidth(ch);
        wordStart = offset;
        continue;
      }
      word += ch;
      offset += helveticaWidth(ch);
    }
    flush();
  }
  return words;
}

/** A tiny grey picture, for tests about structure rather than looks. */
function greyPicture(widthPx = 20, heightPx = 28): PagePicture {
  return { bytes: new Uint8Array(zlib.deflateSync(Buffer.alloc(widthPx * heightPx, 230))), widthPx, heightPx, encoding: 'flate-gray' };
}

/** A page rebuilt "with boxes" whose one box is off the page, away from every word of these files. */
const AWAY = { reason: 'boxes' as const, boxes: [{ x0: -3, y0: -3, x1: -2, y1: -2 }] };

const NO_VALUE = { titleHasValue: () => false };

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  helveticaWidth = (ch) => font.widthOfTextAtSize(ch, 1);
  doc.addPage([100, 100]).drawText('warm up', { x: 10, y: 50, size: 10, font });
  await renderPicture(await doc.save(), 0, 36); // pdf.js loads its worker and fonts once
}, 60_000);

// ---- files built for the tests -----------------------------------------------------------------

/** A literal PDF string for Latin-1 text. */
function lit(text: string): string {
  let out = '(';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (c < 32 || c > 126) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `${out})`;
}

const tag = (place: string) => `${SECRET}-${place}`;

/** The trial's hiding places (spike report section 4): 18 on page 1, 11 on page 2, 15 in the document. */
const PAGE_1_PLACES = [
  'P1_TEXT', 'P1_ACTUALTEXT', 'P1_OCG_HIDDEN', 'P1_OUTSIDE_CROP', 'P1_WHITE', 'P1_COMMENT', 'P1_COMMENT_AUTHOR', 'P1_FREETEXT_AP', 'P1_LINK_URI',
  'P1_ATTACHMENT', 'P1_FIELD_VALUE', 'P1_FIELD_JS', 'P1_PAGE_AA', 'P1_PIECEINFO', 'P1_PAGE_XMP', 'P1_THUMB', 'P1_IMAGE_XMP', 'P1_REDACT_OVERLAY',
];
const PAGE_2_PLACES = [
  'P2_COMMENT', 'P2_REPLY_TO_P1', 'P2_FIELD_VALUE', 'P2_OUTSIDE_CROP', 'P2_OCG_HIDDEN', 'P2_ACTUALTEXT', 'P2_PIECEINFO', 'P2_IMAGE_XMP', 'P2_PAGE_AA',
  'P2_ATTACHMENT', 'P2_LINK_JS',
];
const DOCUMENT_PLACES = [
  'DOC_INFO_TITLE', 'DOC_INFO_AUTHOR', 'DOC_XMP', 'DOC_OUTLINE', 'DOC_OUTLINE_UTF16', 'DOC_OUTLINE_JS', 'DOC_EMBEDDED_FILE', 'DOC_JAVASCRIPT',
  'DOC_DEST_NAME', 'DOC_OPENACTION', 'DOC_PAGELABEL', 'DOC_STRUCT_ALT', 'DOC_STRUCT_ACTUALTEXT', 'DOC_HIDDEN_FIELD', 'DOC_OLD_REVISION',
];
/** Places added to the trial's 44 by this suite: a font and a form only page 1 uses, structure /E and /T, an object nothing refers to. */
const EXTRA_PLACES = ['P1_FONT_CMAP', 'P1_FORM_XOBJECT', 'DOC_STRUCT_E', 'DOC_STRUCT_T', 'DOC_ORPHAN'];

/**
 * The trial's file that hides one PAN in 44 places (pages 1 and 2 and the document), and page 3
 * whose only copy of it is in an earlier saved revision. Page 3's image also carries XMP.
 */
async function makeHidingSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const str = (place: string) => PDFString.of(tag(place));
  const stream = (text: string, dict: Record<string, unknown> = {}) => ctx.register(ctx.flateStream(text, dict as never));
  const xmp = (place: string) => stream(`<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:title="${tag(place)}"/></rdf:RDF></x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' });
  const js = (place: string) => ctx.obj({ S: 'JavaScript', JS: str(place) });
  const fileSpec = (place: string) => {
    const ef = stream(`Attached file holding ${tag(place)}`, { Type: 'EmbeddedFile' });
    return ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('notes.txt'), UF: PDFString.of('notes.txt'), EF: { F: ef } }));
  };
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Hidden layer') }));
  const image = (place: string) => ctx.register(ctx.stream(zlib.deflateSync(Buffer.alloc(16 * 16, 200)), { Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode', Metadata: xmp(place) } as never));
  const sharedForm = stream('BT /F1 9 Tf 0 0 Td (Header CONFIDENTIAL) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 20], Resources: { Font: { F1: helv.ref } } });
  const page1Font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding', ToUnicode: stream(`/CIDInit /ProcSet findresource begin\n% ${tag('P1_FONT_CMAP')}\nend`) }));
  const page1Form = stream(`BT /F1 9 Tf 0 0 Td ${lit(tag('P1_FORM_XOBJECT'))} Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 20], Resources: { Font: { F1: helv.ref } } });

  const pages = [1, 2, 3].map(() => doc.addPage([595, 842]));
  const content = (n: number) => {
    const p = `P${n}`;
    return [
      'q 1 0 0 1 50 800 cm /Hd Do Q',
      n === 1 ? 'q 1 0 0 1 50 560 cm /Fx1 Do Q BT /F9 10 Tf 50 540 Td (Font of page one) Tj ET' : '',
      `BT /F1 12 Tf 50 750 Td ${lit(n === 1 ? `PAN ${tag('P1_TEXT')} of the assessee` : `Page ${n} ordinary text without the secret`)} Tj ET`,
      `/Span <</ActualText ${lit(tag(`${p}_ACTUALTEXT`))}>> BDC BT /F1 12 Tf 50 720 Td (XXXX) Tj ET EMC`,
      `/OC /oc1 BDC BT /F1 12 Tf 50 690 Td ${lit(`Layer ${tag(`${p}_OCG_HIDDEN`)}`)} Tj ET EMC`,
      `BT /F1 12 Tf 50 900 Td ${lit(`Outside ${tag(`${p}_OUTSIDE_CROP`)}`)} Tj ET`,
      n === 1 ? `BT 1 1 1 rg /F1 12 Tf 50 660 Td ${lit(`White ${tag('P1_WHITE')}`)} Tj ET` : '',
      'q 16 0 0 16 50 600 cm /Im1 Do Q',
    ].join('\n');
  };
  pages.forEach((page, i) => {
    const n = i + 1;
    page.node.set(PDFName.of('CropBox'), ctx.obj([0, 0, 595, 842]));
    page.node.set(PDFName.of('MediaBox'), ctx.obj([0, 0, 595, 1000]));
    const fonts: Record<string, PDFRef> = n === 1 ? { F1: helv.ref, F9: page1Font } : { F1: helv.ref };
    const xobjects: Record<string, PDFRef> = n === 1 ? { Hd: sharedForm, Im1: image('P1_IMAGE_XMP'), Fx1: page1Form } : { Hd: sharedForm, Im1: image(`P${n}_IMAGE_XMP`) };
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: fonts, XObject: xobjects, Properties: { oc1: ocg } }));
    page.node.set(PDFName.of('Contents'), stream(n === 3 ? `BT /F1 12 Tf 50 750 Td (Old revision ${tag('DOC_OLD_REVISION')}) Tj ET` : content(n)));
  });

  const p1 = pages[0].node;
  p1.set(PDFName.of('AA'), ctx.obj({ O: js('P1_PAGE_AA') }));
  p1.set(PDFName.of('PieceInfo'), ctx.obj({ ExampleApp: { Private: str('P1_PIECEINFO'), LastModified: PDFString.of('D:20260101') } }));
  p1.set(PDFName.of('Metadata'), xmp('P1_PAGE_XMP'));
  p1.set(PDFName.of('Thumb'), image('P1_THUMB'));
  const comment1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 740, 420, 760], Contents: str('P1_COMMENT'), T: str('P1_COMMENT_AUTHOR'), P: pages[0].ref }));
  const freeAp = stream(`BT /F1 10 Tf 2 4 Td ${lit(tag('P1_FREETEXT_AP'))} Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 20], Resources: { Font: { F1: helv.ref } } });
  const freeText = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [300, 500, 500, 520], DA: PDFString.of('/Helv 10 Tf 0 g'), Contents: PDFString.of('see appearance'), AP: { N: freeAp } }));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 400, 200, 420], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(`https://example.in/?pan=${tag('P1_LINK_URI')}`) } }));
  const attach1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [500, 700, 520, 720], FS: fileSpec('P1_ATTACHMENT'), Contents: PDFString.of('attachment') }));
  const field1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('pan_field'), V: str('P1_FIELD_VALUE'), Rect: [50, 300, 250, 320], F: 4, P: pages[0].ref, AA: { K: js('P1_FIELD_JS') }, DA: PDFString.of('/Helv 10 Tf 0 g') }));
  const redactAnnot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Redact', Rect: [50, 745, 300, 765], OverlayText: str('P1_REDACT_OVERLAY') }));
  p1.set(PDFName.of('Annots'), ctx.obj([comment1, freeText, link, attach1, field1, redactAnnot]));

  const p2 = pages[1].node;
  p2.set(PDFName.of('AA'), ctx.obj({ C: js('P2_PAGE_AA') }));
  p2.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: str('P2_PIECEINFO') } }));
  const comment2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 740, 420, 760], Contents: str('P2_COMMENT'), P: pages[1].ref }));
  const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 700, 420, 720], Contents: str('P2_REPLY_TO_P1'), IRT: comment1, RT: 'R', P: pages[1].ref }));
  const field2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('notes_field'), V: str('P2_FIELD_VALUE'), Rect: [50, 300, 250, 320], F: 4, P: pages[1].ref, DA: PDFString.of('/Helv 10 Tf 0 g') }));
  const attach2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [500, 700, 520, 720], FS: fileSpec('P2_ATTACHMENT') }));
  const linkJs = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 400, 200, 420], Border: [0, 0, 0], A: js('P2_LINK_JS') }));
  const linkToP1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 380, 200, 395], Border: [0, 0, 0], Dest: [pages[0].ref, PDFName.of('Fit')] }));
  p2.set(PDFName.of('Annots'), ctx.obj([comment2, reply, field2, attach2, linkJs, linkToP1]));

  const hiddenField = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of('hidden_field'), V: str('DOC_HIDDEN_FIELD') }));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field1, field2, hiddenField], DA: PDFString.of('/Helv 10 Tf 0 g'), DR: { Font: { Helv: helv.ref } } }));
  doc.setTitle(tag('DOC_INFO_TITLE'));
  doc.setAuthor(tag('DOC_INFO_AUTHOR'));
  doc.catalog.set(PDFName.of('Metadata'), xmp('DOC_XMP'));
  const outlines = ctx.nextRef();
  const o = [ctx.nextRef(), ctx.nextRef(), ctx.nextRef()];
  ctx.assign(o[0], ctx.obj({ Title: str('DOC_OUTLINE'), Parent: outlines, Next: o[1], Dest: [pages[0].ref, PDFName.of('XYZ'), 0, 842, 0] }));
  ctx.assign(o[1], ctx.obj({ Title: PDFHexString.fromText(`${tag('DOC_OUTLINE_UTF16')} आधार`), Parent: outlines, Prev: o[0], Next: o[2], Dest: [pages[1].ref, PDFName.of('Fit')] }));
  ctx.assign(o[2], ctx.obj({ Title: PDFString.of('Script'), Parent: outlines, Prev: o[1], A: js('DOC_OUTLINE_JS') }));
  ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: o[0], Last: o[2], Count: 3 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  doc.catalog.set(
    PDFName.of('Names'),
    ctx.obj({
      EmbeddedFiles: { Names: [PDFString.of('notes.txt'), fileSpec('DOC_EMBEDDED_FILE')] },
      JavaScript: { Names: [PDFString.of('init'), ctx.register(js('DOC_JAVASCRIPT'))] },
      Dests: { Names: [str('DOC_DEST_NAME'), ctx.obj([pages[1].ref, PDFName.of('Fit')])] },
    }),
  );
  doc.catalog.set(PDFName.of('OpenAction'), js('DOC_OPENACTION'));
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: [0, { S: 'D', P: str('DOC_PAGELABEL') }] }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocg], D: { OFF: [ocg], Order: [ocg] } }));
  const structRoot = ctx.nextRef();
  const element = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Figure', P: structRoot, Alt: str('DOC_STRUCT_ALT'), ActualText: str('DOC_STRUCT_ACTUALTEXT'), E: str('DOC_STRUCT_E'), T: str('DOC_STRUCT_T'), Pg: pages[0].ref }));
  ctx.register(ctx.obj({ Note: str('DOC_ORPHAN') }));
  ctx.assign(structRoot, ctx.obj({ Type: 'StructTreeRoot', K: element }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), structRoot);
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));

  // First revision, then an incremental update that replaces page 3's content.
  const base = await doc.save({ useObjectStreams: false });
  const reloaded = await PDFDocument.load(base);
  const oldContents = reloaded.getPages()[2].node.get(PDFName.of('Contents')) as PDFRef;
  const text = 'BT /F1 12 Tf 50 750 Td (Page 3 clean text) Tj ET';
  const latin = Buffer.from(base).toString('latin1');
  const prev = Number(/startxref\s+(\d+)/.exec(latin.slice(latin.lastIndexOf('startxref')))![1]);
  const body = `\n${oldContents.objectNumber} 0 obj\n<< /Length ${text.length} >>\nstream\n${text}\nendstream\nendobj\n`;
  const root = reloaded.context.trailerInfo.Root as PDFRef;
  const info = reloaded.context.trailerInfo.Info as PDFRef;
  const xrefAt = base.length + Buffer.byteLength(body, 'latin1');
  const xref = `xref\n${oldContents.objectNumber} 1\n${String(base.length + 1).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${reloaded.context.largestObjectNumber + 1} /Root ${root.objectNumber} 0 R /Info ${info.objectNumber} 0 R /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([Buffer.from(base), Buffer.from(body + xref, 'latin1')]));
}

/** The decoded content of every page, joined per page. */
async function decodedContents(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page) => {
    const contents = page.node.lookup(PDFName.of('Contents'));
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    return streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
  });
}

// ---- the trial's 44 hiding places -----------------------------------------------------------------

describe('a file that hides one PAN in 44 places, pages 1 and 2 rebuilt', () => {
  let source: Uint8Array;
  let result: Uint8Array;
  let report: RedactBuildReport;
  beforeAll(async () => {
    source = await makeHidingSource();
    const pages: RebuiltPage[] = [];
    for (const pageIndex of [0, 1]) pages.push({ pageIndex, picture: await renderPicture(source, pageIndex), words: await pageWords(source, pageIndex, (w) => !w.includes(SECRET)), ...AWAY });
    ({ bytes: result, report } = await buildRedacted(source, pages, { titleHasValue: hasPan }));
  }, 120_000);

  it('the source holds every place (self-check)', async () => {
    expect(PAGE_1_PLACES.length + PAGE_2_PLACES.length + DOCUMENT_PLACES.length).toBe(44);
    const all = [...PAGE_1_PLACES, ...PAGE_2_PLACES, ...DOCUMENT_PLACES, ...EXTRA_PLACES, 'P3_IMAGE_XMP'].map(tag);
    expect(rawFound(source, all)).toEqual(all);
  });

  it('nothing of a rebuilt page is left, and nothing of the document', async () => {
    const gone = [...PAGE_1_PLACES, ...PAGE_2_PLACES, ...DOCUMENT_PLACES, ...EXTRA_PLACES].map(tag);
    expect(await markerPaths(result, gone)).toEqual({});
    expect(rawFound(result, gone)).toEqual([]);
    expect(rawHaystack(result)).not.toContain(SECRET);
    expect(await stringsHaystack(result)).not.toContain(SECRET);
    expect(await findTargets(result, [PAN], new Set([0, 1]))).toEqual({ pages: [], elsewhere: [] });
  });

  it('a copied page loses its image XMP and keeps its content, byte for byte; the earlier revision is gone', async () => {
    expect(rawFound(result, [tag('P3_IMAGE_XMP')])).toEqual([]);
    expect((await decodedContents(result))[2]).toBe((await decodedContents(source))[2]);
    expect((await decodedContents(result))[2]).toContain('Page 3 clean text');
    expect(rawHaystack(result)).not.toContain('Old revision');
    expect((await inspectPdf(result)).pageCount).toBe(3);
    expect(await structureProblems(result, [0, 1])).toEqual([]);
  });

  it('only Producer, Creator and dates are in /Info; the catalog carries none of the document-level entries', async () => {
    const doc = await PDFDocument.load(result, { updateMetadata: false });
    const info = doc.context.lookup(doc.context.trailerInfo.Info as PDFRef, PDFDict);
    expect(info.keys().map((k) => k.decodeText()).sort()).toEqual(['CreationDate', 'Creator', 'ModDate', 'Producer']);
    expect(doc.getProducer()).toBe('ICAI VERA');
    expect(doc.getCreator()).toBe('ICAI VERA');
    const keys = doc.catalog.keys().map((k) => k.decodeText());
    for (const key of ['Metadata', 'Names', 'OpenAction', 'PageLabels', 'StructTreeRoot', 'MarkInfo', 'AA', 'Dests', 'AcroForm']) expect(keys, key).not.toContain(key);
    expect(doc.context.trailerInfo.ID).toBeUndefined();
  });

  it('bookmarks holding the value are removed, the script one dropped', () => {
    expect(report.bookmarksRemoved).toBe(2);
    expect(report.bookmarksDropped).toBe(1);
  });
});

// ---- copied pages: cleaned of what cannot be checked, everything else kept --------------------------

const CLEANED = ['C_PAGE_AA', 'C_PIECEINFO', 'C_IMAGE_XMP', 'C_PAGE_XMP', 'C_THUMB', 'C_ATTACHMENT', 'C_ATTACH_POPUP', 'C_LINK_JS', 'C_REDACT_OVERLAY', 'C_FIELD_AA', 'C_NEXT_JS', 'C_LAYER_CONFIG', 'C_LAYER_LABEL', 'C_DEST_NAME'];

/**
 * Page 1 to be rebuilt; page 2 to be copied, holding each thing the cleaning removes (tagged) and
 * the things it must keep: a comment, a GoTo link, a web link, a form field, a layer, a link to a
 * named destination (made direct) and a GoTo link with a script chained after it.
 */
async function makeCarriedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const js = (text: string) => ctx.obj({ S: 'JavaScript', JS: PDFString.of(text) });
  const [page1, page2] = [doc.addPage([400, 400]), doc.addPage([400, 400])];
  page1.drawText('Page one', { x: 20, y: 350, size: 12, font: helv });
  const xmp = (text: string) => ctx.register(ctx.flateStream(`<x:xmpmeta><rdf:Description dc:title="${text}"/></x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' } as never));
  const image = ctx.register(ctx.stream(zlib.deflateSync(Buffer.alloc(4 * 4, 120)), { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode', Metadata: xmp('C_IMAGE_XMP') } as never));
  const layer = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Kept layer') }));
  const content = ['BT /F1 12 Tf 20 350 Td (Page two kept text) Tj ET', 'q 20 0 0 20 20 300 cm /Im1 Do Q', '/OC /L1 BDC BT /F1 12 Tf 20 280 Td (Layer text) Tj ET EMC'].join('\n');
  page2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: helv.ref }, XObject: { Im1: image }, Properties: { L1: layer } }));
  page2.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  page2.node.set(PDFName.of('AA'), ctx.obj({ O: js('C_PAGE_AA') }));
  page2.node.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: PDFString.of('C_PIECEINFO') } }));
  page2.node.set(PDFName.of('Metadata'), xmp('C_PAGE_XMP'));
  page2.node.set(PDFName.of('Thumb'), ctx.register(ctx.stream(Buffer.from('C_THUMB pixels', 'latin1'), { Width: 2, Height: 7, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never)));

  const annots: PDFRef[] = [];
  const add = (dict: Record<string, unknown>) => {
    const ref = ctx.register(ctx.obj({ Type: 'Annot', P: page2.ref, ...dict } as never));
    annots.push(ref);
    return ref;
  };
  const spec = ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('a.txt'), EF: { F: ctx.register(ctx.flateStream('C_ATTACHMENT file', { Type: 'EmbeddedFile' } as never)) } }));
  const attachment = add({ Subtype: 'FileAttachment', Rect: [300, 300, 320, 320], FS: spec });
  add({ Subtype: 'Popup', Rect: [300, 200, 380, 280], Parent: attachment, Contents: PDFString.of('C_ATTACH_POPUP') });
  add({ Subtype: 'Link', Rect: [20, 20, 120, 30], A: js('C_LINK_JS') });
  add({ Subtype: 'Redact', Rect: [20, 345, 120, 365], OverlayText: PDFString.of('C_REDACT_OVERLAY') });
  add({ Subtype: 'Text', Rect: [350, 350, 370, 370], Contents: PDFString.of('Kept comment') });
  add({ Subtype: 'Link', Rect: [20, 40, 120, 50], A: { S: 'GoTo', D: [page1.ref, PDFName.of('Fit')] } });
  add({ Subtype: 'Link', Rect: [20, 60, 120, 70], A: { S: 'URI', URI: PDFString.of('https://example.in/kept') } });
  add({ Subtype: 'Link', Rect: [20, 80, 120, 90], Dest: PDFString.of('C_DEST_NAME') });
  add({ Subtype: 'Link', Rect: [20, 100, 120, 110], A: { S: 'GoTo', D: [page1.ref, PDFName.of('Fit')], Next: js('C_NEXT_JS') } });
  const widget = add({ Subtype: 'Widget', FT: 'Tx', T: PDFString.of('kept_field'), V: PDFString.of('Kept value'), Rect: [20, 120, 200, 140], F: 4, AA: { K: js('C_FIELD_AA') }, DA: PDFString.of('/Helv 10 Tf 0 g') });
  page2.node.set(PDFName.of('Annots'), ctx.obj(annots));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [widget], DA: PDFString.of('/Helv 10 Tf 0 g'), DR: { Font: { Helv: helv.ref } } }));
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: { Names: [PDFString.of('C_DEST_NAME'), ctx.obj([page1.ref, PDFName.of('Fit')])] } }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [layer], D: { Name: PDFString.of('C_LAYER_CONFIG'), ON: [layer], Order: [PDFString.of('C_LAYER_LABEL'), layer] } }));
  return doc.save({ useObjectStreams: false });
}

interface Annotation {
  subtype: string;
  dest?: unknown;
  url?: string;
  contentsObj?: { str: string };
  fieldValue?: unknown;
}

async function annotationsOf(bytes: Uint8Array, pageIndex: number): Promise<{ list: Annotation[]; targets: (number | null)[] }> {
  const pdf = await openPdf(bytes);
  try {
    const list = (await (await pdf.getPage(pageIndex + 1)).getAnnotations()) as Annotation[];
    const targets: (number | null)[] = [];
    for (const a of list) {
      if (a.subtype !== 'Link' || a.url) continue;
      const dest = typeof a.dest === 'string' ? await pdf.getDestination(a.dest) : (a.dest as unknown[] | undefined);
      targets.push(Array.isArray(dest) && dest[0] && typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0] as never) : null);
    }
    return { list, targets };
  } finally {
    await pdf.destroy();
  }
}

describe('copied pages are cleaned of what cannot be checked', () => {
  let source: Uint8Array;
  let result: Uint8Array;
  let report: RedactBuildReport;
  beforeAll(async () => {
    source = await makeCarriedPdf();
    ({ bytes: result, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...AWAY }], NO_VALUE));
  }, 60_000);

  it('removes every tagged thing from the bytes, and counts each', () => {
    expect(rawFound(source, CLEANED), 'self-check').toEqual(CLEANED);
    expect(rawFound(result, CLEANED)).toEqual([]);
    expect(report.cleaned).toEqual({
      'page /AA': 1,
      'page /PieceInfo': 1,
      'page /Metadata': 1,
      'page /Thumb': 1,
      'object /Metadata': 1,
      'field /AA': 1,
      'annotation FileAttachment': 1,
      'annotation Popup': 1,
      'annotation Redact': 1,
      'action JavaScript': 1,
      'link without destination': 1,
      'action /Next': 1,
      'named destination made direct': 1,
      'layer settings text': 2,
    });
  });

  it('keeps the comment, the links, the field and the layer, and the page content byte for byte', async () => {
    const { list, targets } = await annotationsOf(result, 1);
    expect(list.map((a) => a.subtype).sort()).toEqual(['Link', 'Link', 'Link', 'Link', 'Text', 'Widget']);
    expect(list.find((a) => a.subtype === 'Text')?.contentsObj?.str).toBe('Kept comment');
    expect(list.find((a) => a.url)?.url).toBe('https://example.in/kept');
    expect(targets).toEqual([0, 0, 0]); // GoTo, the named destination made direct, GoTo with the script removed
    expect(await pdfjsFieldValues(result)).toEqual({ kept_field: 'Kept value' });
    expect((await decodedContents(result))[1]).toBe((await decodedContents(source))[1]);
    const doc = await PDFDocument.load(result);
    const layers = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray);
    expect(layers.size()).toBe(1);
    expect(await findTargets(result, [{ kind: 'typed', forms: ['Kept layer'], wholeWord: true }], new Set([0]))).toEqual({ pages: [1], elsewhere: [] });
  });

  it('leaves no reference to a removed object', async () => {
    const doc = await PDFDocument.load(result);
    const missing: string[] = [];
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      const stack: PDFObject[] = [object];
      while (stack.length > 0) {
        const item = stack.pop()!;
        if (item instanceof PDFRef) {
          if (doc.context.lookup(item) === undefined) missing.push(item.toString());
        } else if (item instanceof PDFDict) stack.push(...item.values());
        else if (item instanceof PDFArray) stack.push(...item.asArray());
        else if (item instanceof PDFRawStream) stack.push(...item.dict.values());
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("what a copied page points at on a rebuilt page does not come back", () => {
  it("a reply's /IRT, a popup's /Parent and a field's other widget bring nothing of the rebuilt page", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const [page1, page2] = [doc.addPage([300, 300]), doc.addPage([300, 300])];
    page1.drawText('Rebuilt page', { x: 20, y: 250, size: 12, font: helv });
    page2.drawText('Copied page', { x: 20, y: 250, size: 12, font: helv });
    const comment = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [200, 200, 220, 220], Contents: PDFString.of(tag('X_COMMENT')), P: page1.ref }));
    const field = ctx.nextRef();
    const appearance = ctx.register(ctx.flateStream(`BT /F1 9 Tf 2 4 Td ${lit(tag('X_WIDGET_AP'))} Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 20], Resources: { Font: { F1: helv.ref } } } as never));
    const widget1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [20, 100, 220, 120], F: 4, Parent: field, P: page1.ref, AP: { N: appearance } }));
    const widget2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [20, 100, 220, 120], F: 4, Parent: field, P: page2.ref }));
    ctx.assign(field, ctx.obj({ FT: 'Tx', T: PDFString.of('shared'), V: PDFString.of('Kept value'), Kids: [widget1, widget2] }));
    const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [200, 150, 220, 170], Contents: PDFString.of('Kept reply'), IRT: comment, RT: 'R', P: page2.ref }));
    const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [100, 150, 200, 200], Parent: comment, P: page2.ref }));
    page1.node.set(PDFName.of('Annots'), ctx.obj([comment, widget1]));
    page2.node.set(PDFName.of('Annots'), ctx.obj([reply, popup, widget2]));
    doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field], DA: PDFString.of('/Helv 10 Tf 0 g') }));
    const source = await doc.save({ useObjectStreams: false });
    expect(rawFound(source, [tag('X_COMMENT'), tag('X_WIDGET_AP')]), 'self-check').toHaveLength(2);

    const { bytes } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...AWAY }], NO_VALUE);
    expect(rawFound(bytes, [tag('X_COMMENT'), tag('X_WIDGET_AP')])).toEqual([]);
    expect(await pdfjsFieldValues(bytes)).toEqual({ shared: 'Kept value' });
    const { list } = await annotationsOf(bytes, 1);
    expect(list.map((a) => a.subtype).sort()).toEqual(['Text', 'Widget']);
    expect(await findTargets(bytes, [PAN], new Set([0]))).toEqual({ pages: [], elsewhere: [] });
  });
});

// ---- copied pages: what they keep is the check's to find -------------------------------------------

const KEPT_PLACES = [
  'K_COMMENT', 'K_RICH_TEXT', 'K_AUTHOR', 'K_POPUP', 'K_APPEARANCE', 'K_FIELD_VALUE', 'K_FIELD_DEFAULT', 'K_FIELD_OPTION', 'K_FIELD_APPEARANCE',
  'K_LINK_URI', 'K_LAYER_NAME', 'K_OUTSIDE_BOX', 'K_ACTUALTEXT',
];

/** Three pages; page 2 holds, once each, a value in every place a copied page keeps: comment, form, link, layer, content. */
async function makeKeptPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const str = (place: string) => PDFString.of(tag(place));
  const pages = [1, 2, 3].map((n) => {
    const page = doc.addPage([400, 400]);
    page.drawText(`Page ${n}`, { x: 20, y: 350, size: 12, font: helv });
    return page;
  });
  const page2 = pages[1];
  page2.node.set(PDFName.of('CropBox'), ctx.obj([0, 0, 400, 380]));
  const layer = ctx.register(ctx.obj({ Type: 'OCG', Name: str('K_LAYER_NAME') }));
  const content = [
    'BT /F1 12 Tf 20 350 Td (Page 2) Tj ET',
    `BT /F1 12 Tf 20 390 Td ${lit(tag('K_OUTSIDE_BOX'))} Tj ET`,
    `/Span <</ActualText ${lit(tag('K_ACTUALTEXT'))}>> BDC BT /F1 12 Tf 20 300 Td (XXXX) Tj ET EMC`,
    '/OC /L1 BDC BT /F1 12 Tf 20 280 Td (Layer text) Tj ET EMC',
  ].join('\n');
  page2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: helv.ref }, Properties: { L1: layer } }));
  page2.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  const form = (text: string) => ctx.register(ctx.flateStream(`BT /F1 9 Tf 2 4 Td ${lit(text)} Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 20], Resources: { Font: { F1: helv.ref } } } as never));
  const comment = ctx.nextRef();
  const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [200, 200, 300, 260], Parent: comment, Contents: str('K_POPUP') }));
  ctx.assign(comment, ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [350, 350, 370, 370], Contents: str('K_COMMENT'), RC: str('K_RICH_TEXT'), T: str('K_AUTHOR'), Popup: popup, AP: { N: form(tag('K_APPEARANCE')) }, P: page2.ref }));
  const field = ctx.nextRef();
  const widget = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [20, 100, 200, 120], F: 4, Parent: field, P: page2.ref, AP: { N: form(tag('K_FIELD_APPEARANCE')) } }));
  ctx.assign(field, ctx.obj({ FT: 'Ch', T: PDFString.of('choice'), V: str('K_FIELD_VALUE'), DV: str('K_FIELD_DEFAULT'), Opt: [str('K_FIELD_OPTION'), str('K_FIELD_VALUE')], Kids: [widget] }));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 60, 120, 70], A: { S: 'URI', URI: PDFString.of(`https://example.in/?id=${tag('K_LINK_URI')}`) } }));
  page2.node.set(PDFName.of('Annots'), ctx.obj([comment, popup, widget, link]));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field] }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [layer], D: { ON: [layer] } }));
  return doc.save({ useObjectStreams: false });
}

describe('what a copied page keeps is left to the check, which finds it on that page', () => {
  it('each kept place is located to page 2 alone, and is gone once page 2 is rebuilt too', async () => {
    const source = await makeKeptPdf();
    expect(rawFound(source, KEPT_PLACES.map(tag)), 'self-check').toEqual(KEPT_PLACES.map(tag));
    const { bytes: carried } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...AWAY }], NO_VALUE);
    for (const place of KEPT_PLACES) {
      const target: CheckTarget = { kind: 'pan', forms: [tag(place)], wholeWord: false };
      expect(await findTargets(carried, [target], new Set([0])), place).toEqual({ pages: [1], elsewhere: [] });
    }
    const { bytes: rebuilt } = await buildRedacted(source, [0, 1].map((pageIndex) => ({ pageIndex, picture: greyPicture(), words: [], ...AWAY })), NO_VALUE);
    expect(rawFound(rebuilt, KEPT_PLACES.map(tag))).toEqual([]);
    expect(await findTargets(rebuilt, [PAN], new Set([0, 1]))).toEqual({ pages: [], elsewhere: [] });
  });
});

// ---- rebuilt pages ---------------------------------------------------------------------------------

describe('rebuilt page structure', () => {
  it('holds only REBUILT_PAGE_KEYS, its picture and the text font, the visible box and the turn of the source page', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const [rotate, crop] of [[90, null], [180, null], [270, null], [0, [20, 30, 250, 380]]] as const) {
      const page = doc.addPage([300, 400]);
      page.drawText(`Turned ${rotate}`, { x: 20, y: 200, size: 12, font });
      if (rotate) page.node.set(PDFName.of('Rotate'), PDFNumber.of(rotate));
      if (crop) page.node.set(PDFName.of('CropBox'), doc.context.obj([...crop]));
      page.node.set(PDFName.of('Group'), doc.context.obj({ S: 'Transparency' }));
      page.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
    }
    const source = await doc.save();
    const word: LayerWord = { text: 'Turned', transform: [12, 0, 0, 12, 20, 200], width: 40 };
    const pages: RebuiltPage[] = [0, 1, 2, 3].map((pageIndex) => ({ pageIndex, picture: greyPicture(), words: pageIndex === 3 ? [] : [word], ...AWAY }));
    const { bytes } = await buildRedacted(source, pages, NO_VALUE);
    const out = await PDFDocument.load(bytes);
    const outPages = out.getPages();
    outPages.forEach((page, i) => {
      const keys = page.node.keys().map((k) => k.decodeText());
      expect(keys.every((k) => REBUILT_PAGE_KEYS.includes(k)), `page ${i + 1}: ${keys.join(' ')}`).toBe(true);
      const resources = page.node.lookup(PDFName.of('Resources'), PDFDict);
      expect(resources.keys().map((k) => k.decodeText()).sort(), `page ${i + 1}`).toEqual(i === 3 ? ['XObject'] : ['Font', 'XObject']);
      expect(resources.lookup(PDFName.of('XObject'), PDFDict).keys().map((k) => k.decodeText())).toEqual(['Im0']);
      if (i !== 3) expect(resources.lookup(PDFName.of('Font'), PDFDict).keys().map((k) => k.decodeText())).toEqual(['Fh']);
    });
    expect(outPages.map((p) => p.getRotation().angle)).toEqual([90, 180, 270, 0]);
    expect(outPages[3].node.lookup(PDFName.of('MediaBox'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([20, 30, 250, 380]);
    expect(outPages[0].node.lookup(PDFName.of('MediaBox'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([0, 0, 300, 400]);
    expect(await structureProblems(bytes, [0, 1, 2, 3])).toEqual([]);
    const pdf = await openPdf(bytes);
    const viewports = [];
    for (let n = 1; n <= 4; n++) {
      const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
      viewports.push([viewport.width, viewport.height]);
    }
    await pdf.destroy();
    expect(viewports).toEqual([[400, 300], [300, 400], [400, 300], [230, 350]]);
  });

  it('a JPEG picture is drawn with /DCTDecode and its own colour space', async () => {
    const source = (await buildSource(['Colour page'])).bytes;
    const picture = await renderPicture(source, 0, 36, 'jpeg');
    const { bytes } = await buildRedacted(source, [{ pageIndex: 0, picture, words: [], ...AWAY }], NO_VALUE);
    const doc = await PDFDocument.load(bytes);
    const image = doc.getPages()[0].node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('Im0'), PDFStream);
    expect(image.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(image.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    expect(await structureProblems(bytes, [0])).toEqual([]);
    const pdf = await openPdf(bytes);
    await (await pdf.getPage(1)).getOperatorList();
    await pdf.destroy();
  });
});

/** One page per line of text, Helvetica 12 at (50, 700). */
async function buildSource(lines: string[], extraLines: [string, number, number, number?][] = []): Promise<{ bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of lines) {
    const page = doc.addPage([595, 842]);
    page.drawText(line, { x: 50, y: 700, size: 12, font });
    for (const [text, x, y, size] of extraLines) page.drawText(text, { x, y, size: size ?? 10, font });
  }
  return { bytes: await doc.save() };
}

describe('the text layer', () => {
  it('reads back in pdf.js on the same baselines, without the redacted words', async () => {
    const { bytes: source } = await buildSource([`PAN ${SECRET} of the assessee`], [['Second line of ordinary words', 50, 680], ['Alone', 300, 640, 14]]);
    const words = await pageWords(source, 0, (w) => w !== SECRET);
    expect(words.map((w) => w.text)).toEqual(['PAN', 'of', 'the', 'assessee', 'Second', 'line', 'of', 'ordinary', 'words', 'Alone']);
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: await renderPicture(source, 0), words, ...AWAY }], NO_VALUE);
    expect(report.textLayerCharsOmitted).toBe(0);
    const items = await textItems(bytes, 0);
    for (const word of words) {
      const item = items.find((i) => i.str.includes(word.text) && Math.abs(i.transform[5] - word.transform[5]) < 0.01);
      expect(item, `${word.text} on its baseline`).toBeDefined();
    }
    expect(items.some((i) => i.str.includes(SECRET))).toBe(false);
    const alone = items.find((i) => i.str.trim() === 'Alone')!;
    const given = words.find((w) => w.text === 'Alone')!;
    expect(alone.width).toBeCloseTo(given.width, 2);
    expect(alone.transform[4]).toBeCloseTo(given.transform[4], 2);
    expect(rawHaystack(bytes)).not.toContain(SECRET);
  });

  it('scales each word to the width it is given, along its own direction', async () => {
    const { bytes: source } = await buildSource(['Widths']);
    const words: LayerWord[] = [
      { text: 'Wide', transform: [10, 0, 0, 10, 50, 600], width: 80 },
      { text: 'Narrow', transform: [10, 0, 0, 10, 50, 560], width: 12 },
      { text: 'Upward', transform: [0, 10, -10, 0, 300, 300], width: 55 },
    ];
    const { bytes } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words, ...AWAY }], NO_VALUE);
    const items = await textItems(bytes, 0);
    for (const word of words) {
      const item = items.find((i) => i.str.trim() === word.text)!;
      expect(item, word.text).toBeDefined();
      expect(item.width, word.text).toBeCloseTo(word.width, 2);
      expect(item.transform[4], word.text).toBeCloseTo(word.transform[4], 2);
      expect(item.transform[5], word.text).toBeCloseTo(word.transform[5], 2);
    }
  });

  it("never writes a word that touches one of the page's boxes, or lies outside the page", async () => {
    const { bytes: source } = await buildSource(['Boxes']);
    const words: LayerWord[] = [
      { text: 'Under', transform: [12, 0, 0, 12, 50, 700], width: 40 },
      { text: 'Beside', transform: [12, 0, 0, 12, 92, 700], width: 40 },
      { text: 'Clear', transform: [12, 0, 0, 12, 200, 700], width: 30 },
      { text: 'Below', transform: [12, 0, 0, 12, 50, 650], width: 35 },
      { text: 'Outside', transform: [12, 0, 0, 12, 50, 900], width: 45 },
    ];
    // A box over "Under" ending 1 pt before "Beside": "Beside" padded by 1.5 pt meets it; "Below" is 50 pt lower.
    const boxes = [{ x0: 48, y0: 695, x1: 91, y1: 713 }];
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words, boxes, reason: 'boxes' }], NO_VALUE);
    expect(report.wordsLeftOut).toBe(3);
    const text = (await textItems(bytes, 0)).map((i) => i.str).join(' ');
    expect(text).toContain('Clear');
    expect(text).toContain('Below');
    for (const gone of ['Under', 'Beside', 'Outside']) expect(text, gone).not.toContain(gone);
    expect(rawHaystack(bytes)).not.toMatch(/Under|Beside|Outside/);
  });

  it('leaves out, and counts, what the standard font cannot write (Hindi, the rupee sign)', async () => {
    const line = ['करदाता', 'का', 'पैन', '₹', '1,25,000', 'के', 'लिए', 'Amount', '₹', '12,34,567', 'received', 'from'];
    const words: LayerWord[] = line.map((text, i) => ({ text, transform: [12, 0, 0, 12, 50 + 45 * i, 700], width: 40 }));
    const helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const writable = new Set(helvetica.getCharacterSet());
    const expected = line.join('').split('').filter((ch) => !writable.has(ch.codePointAt(0)!)).length;
    expect(expected).toBe(18);
    const { bytes: source } = await buildSource(['Hindi line']);
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words, ...AWAY }], NO_VALUE);
    expect(report.textLayerCharsOmitted).toBe(expected);
    const text = (await textItems(bytes, 0)).map((i) => i.str).join(' ');
    for (const kept of ['1,25,000', 'Amount', '12,34,567', 'received', 'from']) expect(text).toContain(kept);
    expect(text).not.toMatch(/[\u0900-\u097f\u20b9]/);
  });
});

describe('forms and links', () => {
  it('a field only on the rebuilt page leaves the form; links to it still go there; it has no annotations', async () => {
    const source = await makeFormPdf({ needAppearances: true, links: true });
    const before = await pdfjsFieldValues(source);
    const picture = await renderPicture(source, 2);
    const { bytes } = await buildRedacted(source, [{ pageIndex: 2, picture, words: await pageWords(source, 2), ...AWAY }], NO_VALUE);
    const after = await pdfjsFieldValues(bytes);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).filter((k) => k !== 'address.street' && k !== 'remarks').sort());
    expect(after.both).toBe(before.both);
    expect((await annotationsOf(bytes, 0)).targets).toEqual([1, 2]);
    expect((await annotationsOf(bytes, 2)).list).toEqual([]);
    expect(await structureProblems(bytes, [2])).toEqual([]);
  });
});

describe('bookmarks', () => {
  async function outlined(items: (pages: PDFRef[], ctx: PDFDocument['context']) => Record<string, unknown>[][]): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = [1, 2, 3].map((n) => {
      const page = doc.addPage([300, 400]);
      page.drawText(`Page ${n}`, { x: 20, y: 300, size: 14, font });
      return page.ref;
    });
    const ctx = doc.context;
    const root = ctx.nextRef();
    const write = (list: Record<string, unknown>[][], parent: PDFRef): PDFRef[] => {
      const refs = list.map(() => ctx.nextRef());
      list.forEach(([entry, ...children], i) => {
        const dict: Record<string, unknown> = { ...entry, Parent: parent };
        if (i > 0) dict.Prev = refs[i - 1];
        if (i < refs.length - 1) dict.Next = refs[i + 1];
        if (children.length > 0) {
          const kids = write(children.map((c) => [c]), refs[i]);
          Object.assign(dict, { First: kids[0], Last: kids[kids.length - 1], Count: kids.length });
        }
        ctx.assign(refs[i], ctx.obj(dict as never));
      });
      return refs;
    };
    const top = write(items(pages, ctx), root);
    ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: top.length }));
    doc.catalog.set(PDFName.of('Outlines'), root);
    return doc.save();
  }

  async function outlineOf(bytes: Uint8Array): Promise<{ title: string; page: number | null; children: number }[]> {
    const pdf = await openPdf(bytes);
    try {
      const outline = (await pdf.getOutline()) ?? [];
      const out = [];
      for (const item of outline) {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        out.push({ title: item.title, page: Array.isArray(dest) ? await pdf.getPageIndex(dest[0] as never) : null, children: item.items.length });
      }
      return out;
    } finally {
      await pdf.destroy();
    }
  }

  it('a bookmark holding the value is removed, its children move up; one to a rebuilt page stays; a script one goes', async () => {
    const source = await outlined((pages, ctx) => [
      [{ Title: PDFString.of(`PAN ${SECRET}`), Dest: [pages[0], PDFName.of('Fit')] }, { Title: PDFString.of('Child A'), Dest: [pages[1], PDFName.of('Fit')] }, { Title: PDFString.of('Child B'), Dest: [pages[2], PDFName.of('Fit')] }],
      [{ Title: PDFString.of('Rebuilt page'), Dest: [pages[1], PDFName.of('Fit')] }],
      [{ Title: PDFString.of('Script'), A: ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }) }],
    ]);
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 1, picture: greyPicture(), words: [], ...AWAY }], { titleHasValue: hasPan });
    expect(report.bookmarksRemoved).toBe(1);
    expect(report.bookmarksDropped).toBe(1);
    expect(await outlineOf(bytes)).toEqual([
      { title: 'Child A', page: 1, children: 0 },
      { title: 'Child B', page: 2, children: 0 },
      { title: 'Rebuilt page', page: 1, children: 0 },
    ]);
    expect(rawHaystack(bytes)).not.toContain(SECRET);
    expect(await stringsHaystack(bytes)).not.toContain(SECRET);
    expect(rawHaystack(bytes)).not.toContain('app.alert');
  });

  it('a web-address bookmark whose address holds the value is removed too', async () => {
    const source = await outlined((pages, ctx) => [
      [{ Title: PDFString.of('Portal'), A: ctx.obj({ S: 'URI', URI: PDFString.of(`https://example.in/?pan=${SECRET}`) }) }],
      [{ Title: PDFString.of('Kept'), Dest: [pages[0], PDFName.of('Fit')] }],
    ]);
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...AWAY }], { titleHasValue: hasPan });
    expect(report.bookmarksRemoved).toBe(1);
    expect(await outlineOf(bytes)).toEqual([{ title: 'Kept', page: 0, children: 0 }]);
    expect(rawHaystack(bytes)).not.toContain(SECRET);
  });
});

// ---- the run's contract: progress, stop, bad input, the source untouched ------------------------------

describe('progress, stop and input', () => {
  it('reports progress per page and stops when the callback throws', async () => {
    const { bytes: source } = await buildSource(['one', 'two', 'three', 'four']);
    const before = source.slice();
    const pages: RebuiltPage[] = [1, 3].map((pageIndex) => ({ pageIndex, picture: greyPicture(), words: [], ...AWAY }));
    const calls: [number, number][] = [];
    await buildRedacted(source, pages, { ...NO_VALUE, onPage: (done, total) => void calls.push([done, total]) });
    expect(calls).toEqual([0, 1, 2, 3, 4, 5, 6].map((done) => [done, 6]));
    const stop = new Error('stopped');
    await expect(buildRedacted(source, pages, { ...NO_VALUE, onPage: (done) => { if (done === 4) throw stop; } })).rejects.toBe(stop);
    expect(source).toEqual(before);
  });

  it('refuses pages it cannot place and pictures that are not what they say', async () => {
    const { bytes: source } = await buildSource(['one', 'two']);
    const page = (pageIndex: number, picture = greyPicture()): RebuiltPage => ({ pageIndex, picture, words: [], ...AWAY });
    await expect(buildRedacted(source, [page(0), page(0)], NO_VALUE)).rejects.toThrow(RangeError);
    await expect(buildRedacted(source, [page(2)], NO_VALUE)).rejects.toThrow(RangeError);
    const notFlate: PagePicture = { bytes: new Uint8Array([1, 2, 3, 4]), widthPx: 2, heightPx: 2, encoding: 'flate-gray' };
    await expect(buildRedacted(source, [page(0, notFlate)], NO_VALUE)).rejects.toThrow(RangeError);
    await expect(buildRedacted(source, [page(0, { ...greyPicture(), widthPx: 0 })], NO_VALUE)).rejects.toThrow(RangeError);
    const jpeg = await renderPicture(source, 0, 36, 'jpeg');
    await expect(buildRedacted(source, [page(0, { ...jpeg, heightPx: jpeg.heightPx + 1 })], NO_VALUE)).rejects.toThrow(RangeError);
    const word = { text: 'x', transform: [1, 0, 0, 1, Number.NaN, 0] as const, width: 1 };
    await expect(buildRedacted(source, [{ ...page(0), words: [word] }], NO_VALUE)).rejects.toThrow(RangeError);
  });

  it('counts each picture just before its page is put together, so progress and Stop come between pictures (fix wave, R2 open item)', async () => {
    // Counting a 200 dpi picture takes tens of milliseconds; all of them before the first progress call
    // held the window for 4.2 s on 200 pages (W2-RD drive).
    const { bytes: source } = await buildSource(['one', 'two', 'three', 'four']);
    const wrong: PagePicture = { ...greyPicture(), heightPx: 29 };
    const pages: RebuiltPage[] = [
      { pageIndex: 1, picture: greyPicture(), words: [], ...AWAY },
      { pageIndex: 3, picture: wrong, words: [], ...AWAY },
    ];
    const calls: number[] = [];
    await expect(buildRedacted(source, pages, { ...NO_VALUE, onPage: (done) => void calls.push(done) })).rejects.toThrow(RangeError);
    expect(calls).toEqual([0, 1, 2, 3, 4, 5]);
    const stop = new Error('stopped');
    await expect(buildRedacted(source, pages, { ...NO_VALUE, onPage: (done) => { if (done === 5) throw stop; } })).rejects.toBe(stop);
    // What needs no counting is still refused before the source is read.
    await expect(buildRedacted(new Uint8Array([1, 2, 3]), [{ pageIndex: 0, picture: greyPicture(), words: [], reason: 'boxes', boxes: [] }], NO_VALUE)).rejects.toThrow(RangeError);
  });

  it('a picture counted in one build is counted again in the next when its bytes or its stated size have changed', async () => {
    const { bytes: source } = await buildSource(['one']);
    const picture = greyPicture();
    const page: RebuiltPage = { pageIndex: 0, picture, words: [], ...AWAY };
    await expect(buildRedacted(source, [page], NO_VALUE)).resolves.toBeDefined();
    await expect(buildRedacted(source, [{ ...page, picture: { ...picture, heightPx: 27 } }], NO_VALUE)).rejects.toThrow(RangeError);
    picture.bytes.fill(0, 2); // the same array, now holding no Flate data
    await expect(buildRedacted(source, [page], NO_VALUE)).rejects.toThrow(RangeError);
  });

  it('refuses an encrypted source', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 2, R: 3 });
    await expect(buildRedacted(await doc.save(), [], NO_VALUE)).rejects.toMatchObject({ code: 'encrypted' });
  });
});

// ---- fix round 1: what the review (R2-review.md) got past the first build -----------------------------

const R = { pan: 'AQZPK7314L', email: 'devi.rao@example.in', ip: '172.16.9.44' };
const REVIEW_TARGETS: CheckTarget[] = [
  { kind: 'pan', forms: [R.pan], wholeWord: false },
  { kind: 'email', forms: [R.email], wholeWord: false },
  { kind: 'ip', forms: [R.ip], wholeWord: false },
  { kind: 'typed', forms: ['gx45tr', 'GX45TR'], wholeWord: true },
];
const reviewMatcher = targetMatcher(REVIEW_TARGETS);
const ONE_BOX = { reason: 'boxes' as const, boxes: [{ x0: 60, y0: 740, x1: 400, y1: 780 }] };

/** An independent reading of a result: the raw-bytes search, plus every stream decoded and un-gzipped, plus percent-decoding. */
async function deepReading(bytes: Uint8Array): Promise<string> {
  const parts = [rawHaystack(bytes)];
  const doc = await PDFDocument.load(bytes);
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let data: Buffer;
    try {
      data = Buffer.from(decodePDFRawStream(object).decode());
    } catch {
      data = Buffer.from(object.contents);
    }
    parts.push(data.toString('latin1'));
    for (const undo of [zlib.gunzipSync, zlib.inflateSync]) {
      try {
        parts.push(undo(data).toString('latin1'));
      } catch {
        // not that format
      }
    }
  }
  const all = parts.join('\n');
  return `${all}\n${all.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))}`;
}

/** Three Helvetica pages; `edit` adds things to page 2 (index 1) or the document. */
async function reviewSource(edit: (doc: PDFDocument, page: PDFPage, refs: PDFRef[]) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2, 3].map((n) => {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${n} of the review file`, { x: 72, y: 790, size: 12, font });
    return page;
  });
  edit(doc, pages[1], pages.map((p) => p.ref));
  return doc.save({ useObjectStreams: false });
}

const flate = (data: Buffer, widthPx: number, heightPx: number, encoding: 'flate-gray' | 'flate-rgb' = 'flate-gray'): PagePicture => ({ bytes: new Uint8Array(data), widthPx, heightPx, encoding });

const gzipFileSpec = (doc: PDFDocument, name: string, text: string) =>
  doc.context.register(doc.context.obj({ Type: 'Filespec', F: PDFString.of(name), UF: PDFString.of(name), EF: { F: doc.context.register(doc.context.flateStream(zlib.gzipSync(Buffer.from(text)), { Type: 'EmbeddedFile', Subtype: 'application#2Fgzip' } as never)) } }));

function outlineOf(doc: PDFDocument, refs: PDFRef[], items: Record<string, PDFObject>[]): void {
  const ctx = doc.context;
  const root = ctx.nextRef();
  const itemRefs = items.map(() => ctx.nextRef());
  items.forEach((entry, i) => {
    const dict: Record<string, PDFObject> = { ...entry, Parent: root };
    if (!('A' in entry)) dict.Dest = ctx.obj([refs[1], PDFName.of('Fit')]);
    if (i > 0) dict.Prev = itemRefs[i - 1];
    if (i < items.length - 1) dict.Next = itemRefs[i + 1];
    ctx.assign(itemRefs[i], ctx.obj(dict));
  });
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: items.length }));
  doc.catalog.set(PDFName.of('Outlines'), root);
}

describe('fix round 1: values that survived the first build are removed (R2-review B1, B2, B3, medium 7)', () => {
  it('B1: a link and a bookmark whose web address holds the value written with %40 lose it', async () => {
    const encoded = `https://portal.example.in/u?e=${R.email.replace('@', '%40')}`;
    const source = await reviewSource((doc, page, refs) => {
      const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 400, 200, 420], A: { S: 'URI', URI: PDFString.of(encoded) } }));
      page.node.set(PDFName.of('Annots'), doc.context.obj([link]));
      outlineOf(doc, refs, [{ Title: PDFString.of('Write to us'), A: doc.context.obj({ S: 'URI', URI: PDFString.of(encoded) }) }, { Title: PDFString.of('Kept') }]);
    });
    expect(await deepReading(source), 'self-check').toContain(R.email);
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...ONE_BOX }], { titleHasValue: reviewMatcher });
    expect(report.cleaned['link address holding a value']).toBe(1);
    expect(report.bookmarksRemoved).toBe(1);
    expect(await deepReading(bytes)).not.toContain(R.email);
    expect(await checkHits(bytes, REVIEW_TARGETS, new Set([0]))).toEqual([]);
  });

  it('B2: attached files are not carried, compressed or not: page and image /AF, a /FS on a comment', async () => {
    const source = await reviewSource((doc, page) => {
      page.node.set(PDFName.of('AF'), doc.context.obj([gzipFileSpec(doc, 'data.gz', `PAN ${R.pan}`)]));
      const image = doc.context.register(doc.context.stream(zlib.deflateSync(Buffer.alloc(4, 0x80)), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode', AF: [gzipFileSpec(doc, 'x.gz', R.email)] } as never));
      page.node.lookup(PDFName.of('Resources'), PDFDict).set(PDFName.of('XObject'), doc.context.obj({ Im9: image }));
      page.node.addContentStream(doc.context.register(doc.context.flateStream('q 20 0 0 20 300 300 cm /Im9 Do Q')));
      const comment = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('note'), FS: gzipFileSpec(doc, 'a.gz', `PAN ${R.pan}`) }));
      page.node.set(PDFName.of('Annots'), doc.context.obj([comment]));
    });
    const before = await deepReading(source);
    expect(before.includes(R.pan) && before.includes(R.email), 'self-check').toBe(true);
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...ONE_BOX }], { titleHasValue: reviewMatcher });
    const after = await deepReading(bytes);
    for (const gone of [R.pan, R.email, 'data.gz', 'x.gz', 'a.gz']) expect(after, gone).not.toContain(gone);
    expect(report.cleaned).toMatchObject({ 'page /AF': 1, 'object /AF': 1, 'annotation /FS': 1 });
    const doc = await PDFDocument.load(bytes);
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      const dict = object instanceof PDFDict ? object : object instanceof PDFRawStream ? object.dict : undefined;
      for (const key of ['AF', 'EF', 'RF', 'FS']) expect(dict?.has(PDFName.of(key)), key).not.toBe(true);
      expect(dict?.get(PDFName.of('Type'))).not.toBe(PDFName.of('EmbeddedFile'));
    }
    expect((await annotationsOf(bytes, 1)).list.map((a) => a.subtype)).toEqual(['Text']);
    expect(await structureProblems(bytes, [0])).toEqual([]);
  });

  it('B3 and the same class: bookmark titles the first rules missed are removed', async () => {
    const source = await reviewSource((doc, _page, refs) =>
      outlineOf(doc, refs, [
        { Title: PDFHexString.fromText(`Server ${R.ip}.`) },
        { Title: PDFHexString.fromText(`IP.${R.ip} primary`) },
        { Title: PDFHexString.fromText('Ref GX4 5TR') },
        { Title: PDFHexString.fromText(`Mail devi.rao@exam${String.fromCharCode(0xfff9)}ple.in`) },
        { Title: PDFString.of('Kept title') },
      ]),
    );
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...ONE_BOX }], { titleHasValue: reviewMatcher });
    expect(report.bookmarksRemoved).toBe(4);
    expect((await outlineTitles(bytes))).toEqual(['Kept title']);
    expect(await checkHits(bytes, REVIEW_TARGETS, new Set([0]))).toEqual([]);
  });

  it('medium 7: scripts in every action slot, and addresses that are not web or mail addresses, are removed', async () => {
    const source = await reviewSource((doc, page, refs) => {
      const ctx = doc.context;
      outlineOf(doc, refs, [
        { Title: PDFString.of('Run me'), A: ctx.obj({ S: 'URI', URI: PDFString.of('javascript:app.alert(2)') }) },
        { Title: PDFString.of('Data page'), A: ctx.obj({ S: 'URI', URI: PDFString.of('data:text/html,<i>bookmark</i>') }) },
        { Title: PDFString.of('Web page'), A: ctx.obj({ S: 'URI', URI: PDFString.of('https://kept.example.in/bookmark') }) },
        { Title: PDFString.of('Kept') },
      ]);
      const annots = [
        { Subtype: 'Link', Rect: [72, 400, 200, 420], A: { S: 'URI', URI: PDFString.of('javascript:app.alert(1)') }, PA: { S: 'JavaScript', JS: PDFString.of('app.launchURL("x")') } },
        { Subtype: 'Link', Rect: [72, 380, 200, 395], A: { S: 'URI', URI: PDFString.of(`data:text/html;base64,${Buffer.from('<b>x</b>').toString('base64')}`) } },
        { Subtype: 'Link', Rect: [72, 360, 200, 375], A: { S: 'URI', URI: PDFString.of('https://kept.example.in/page') } },
      ].map((dict) => ctx.register(ctx.obj({ Type: 'Annot', ...dict } as never)));
      page.node.set(PDFName.of('Annots'), ctx.obj(annots));
    });
    const { bytes, report } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words: [], ...ONE_BOX }], NO_VALUE);
    const after = await deepReading(bytes);
    for (const gone of ['app.alert', 'app.launchURL', 'data:text/html']) expect(after, gone).not.toContain(gone);
    expect(report.cleaned).toMatchObject({ 'link address not http, https or mailto': 2, 'action JavaScript': 1, 'link without destination': 2 });
    const { list } = await annotationsOf(bytes, 1);
    expect(list.map((a) => a.url)).toEqual(['https://kept.example.in/page']);
    // Bookmarks with such addresses are not carried either (outline.ts carries any web address).
    expect(await outlineTitles(bytes)).toEqual(['Web page', 'Kept']);
    expect(report.bookmarksDropped).toBe(2);
  });
});

async function outlineTitles(bytes: Uint8Array): Promise<string[]> {
  const pdf = await openPdf(bytes);
  try {
    return ((await pdf.getOutline()) ?? []).map((item) => item.title);
  } finally {
    await pdf.destroy();
  }
}

describe('fix round 1: flattened pages, required boxes, and pictures that are not what they say', () => {
  it("a page flattened on the user's confirmation is rebuilt without boxes and reported", async () => {
    const { bytes: source } = await buildSource(['one', 'two', 'three']);
    const { bytes, report } = await buildRedacted(
      source,
      [
        { pageIndex: 0, picture: greyPicture(), words: [], ...ONE_BOX },
        { pageIndex: 2, picture: greyPicture(), words: [{ text: 'three', transform: [12, 0, 0, 12, 50, 700], width: 30 }], reason: 'flattened', boxes: [] },
      ],
      NO_VALUE,
    );
    expect(report.pagesFlattened).toEqual([2]);
    expect(await structureProblems(bytes, [0, 2])).toEqual([]);
  });

  it("wave 4, ruling M: a page rebuilt only because it may not be copied ('safety') takes boxes or none, and is never reported as flattened", async () => {
    const { bytes: source } = await buildSource(['one', 'two', 'three']);
    const { bytes, report } = await buildRedacted(
      source,
      [
        { pageIndex: 0, picture: greyPicture(), words: [], ...ONE_BOX },
        { pageIndex: 1, picture: greyPicture(), words: [{ text: 'two', transform: [12, 0, 0, 12, 50, 700], width: 20 }], reason: 'safety', boxes: [] },
        { pageIndex: 2, picture: greyPicture(), words: [], reason: 'safety', boxes: ONE_BOX.boxes },
      ],
      NO_VALUE,
    );
    expect(report.pagesFlattened).toEqual([]);
    expect(await structureProblems(bytes, [0, 1, 2])).toEqual([]);
  });

  it('refuses a page rebuilt for boxes without any, a flattened page with boxes, and a page without a reason or boxes', async () => {
    const { bytes: source } = await buildSource(['one', 'two']);
    const base = { pageIndex: 0, picture: greyPicture(), words: [] };
    for (const page of [
      { ...base, reason: 'boxes', boxes: [] },
      { ...base, reason: 'flattened', boxes: ONE_BOX.boxes },
      { ...base, boxes: ONE_BOX.boxes },
      { ...base, reason: 'boxes' },
    ]) {
      await expect(buildRedacted(source, [page as unknown as RebuiltPage], NO_VALUE), JSON.stringify(Object.keys(page))).rejects.toThrow(RangeError);
    }
  });

  it('medium 5: a picture of the wrong size, a broken Flate stream or a JPEG without its data is refused', async () => {
    const { bytes: source } = await buildSource(['one']);
    const jpeg = await renderPicture(source, 0, 36, 'jpeg');
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x55, 0x00, 0x3c, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    const bad: [string, PagePicture][] = [
      ['data for 60 x 40 stated as 60 x 85', flate(zlib.deflateSync(Buffer.alloc(60 * 40, 255)), 60, 85)],
      ['10 bytes stated as 60 x 85', flate(zlib.deflateSync(Buffer.alloc(10, 255)), 60, 85)],
      ['a zlib header then garbage', flate(Buffer.concat([Buffer.from([0x78, 0x9c]), Buffer.from('not deflate data at all, just text')]), 60, 85)],
      ['grey data stated as RGB', flate(zlib.deflateSync(Buffer.alloc(60 * 85, 255)), 60, 85, 'flate-rgb')],
      ['a JPEG with a frame and no image data', { bytes: new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])])), widthPx: 60, heightPx: 85, encoding: 'jpeg' }],
      ['a JPEG cut short (no end marker)', { ...jpeg, bytes: jpeg.bytes.slice(0, jpeg.bytes.length - 40) }],
    ];
    for (const [label, picture] of bad) {
      await expect(buildRedacted(source, [{ pageIndex: 0, picture, words: [], ...ONE_BOX }], NO_VALUE), label).rejects.toThrow(RangeError);
    }
    for (const picture of [flate(zlib.deflateSync(Buffer.alloc(60 * 85, 200)), 60, 85), flate(zlib.deflateSync(Buffer.alloc(60 * 85 * 3, 90), { level: 0 }), 60, 85, 'flate-rgb'), jpeg]) {
      await expect(buildRedacted(source, [{ pageIndex: 0, picture, words: [], ...ONE_BOX }], NO_VALUE)).resolves.toBeDefined();
    }
  });

  it('counts the inflated length of real pictures exactly, without keeping them (against zlib)', async () => {
    const { bytes: source } = await buildSource(['A line of text to draw', 'Another page']);
    for (const dpi of [72, 150]) {
      const picture = await renderPicture(source, 0, dpi);
      await expect(buildRedacted(source, [{ pageIndex: 0, picture, words: [], ...ONE_BOX }], NO_VALUE), `${dpi} dpi`).resolves.toBeDefined();
      const wrong = { ...picture, heightPx: picture.heightPx - 1 };
      await expect(buildRedacted(source, [{ pageIndex: 0, picture: wrong, words: [], ...ONE_BOX }], NO_VALUE), `${dpi} dpi, one row short`).rejects.toThrow(RangeError);
    }
    // Every block type: stored, fixed and dynamic Huffman, with long and overlapping matches.
    const noise = Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 7919) % 251));
    for (const [label, data, level] of [
      ['stored', noise, 0],
      ['fixed', Buffer.from('ab'.repeat(30)), 9],
      ['dynamic, runs', Buffer.alloc(100_000, 7), 9],
      ['dynamic, noise', noise, 6],
    ] as const) {
      const width = data.length;
      await expect(buildRedacted(source, [{ pageIndex: 0, picture: flate(zlib.deflateSync(data, { level }), width, 1), words: [], ...ONE_BOX }], NO_VALUE), label).resolves.toBeDefined();
      await expect(buildRedacted(source, [{ pageIndex: 0, picture: flate(zlib.deflateSync(data, { level }), width + 1, 1), words: [], ...ONE_BOX }], NO_VALUE), `${label}, stated one longer`).rejects.toThrow(RangeError);
    }
  });
});

// ---- size and time ---------------------------------------------------------------------------------

describe('200 pages, every page rebuilt (the trial 7 ledger)', () => {
  it('builds and checks within the trial budget', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let p = 1; p <= 200; p++) {
      const page = doc.addPage([595, 842]);
      page.drawText(`Client PAN ${SECRET} - Ledger extract page ${p} of 200`, { x: 50, y: 810, size: 9, font });
      for (let l = 0; l < 45; l++) page.drawText(`${String(l + 1).padStart(2, '0')}/04/2024  Voucher JV/${p}/${l}  Sundry creditors  ${(p * 1000 + l * 37).toLocaleString('en-IN')}.00 Dr`, { x: 50, y: 780 - l * 16, size: 10, font });
    }
    const source = await doc.save();
    const picture = await renderPicture(source, 0, 200);
    const words = await pageWords(source, 0, (w) => w !== SECRET);
    const pages: RebuiltPage[] = Array.from({ length: 200 }, (_, pageIndex) => ({ pageIndex, picture, words, ...AWAY }));
    const t0 = performance.now();
    const { bytes, report } = await buildRedacted(source, pages, { titleHasValue: hasPan });
    const buildMs = performance.now() - t0;
    const t1 = performance.now();
    const found = await findTargets(bytes, [PAN], new Set(pages.map((p) => p.pageIndex)));
    const findMs = performance.now() - t1;
    const t2 = performance.now();
    const problems = await structureProblems(bytes, pages.map((p) => p.pageIndex));
    const structureMs = performance.now() - t2;
    console.info(`[redact 200 pages] picture ${Math.round(picture.bytes.length / 1024)} KB, ${words.length} words a page; build ${Math.round(buildMs)} ms, result ${(bytes.length / 1048576).toFixed(1)} MB; findTargets ${Math.round(findMs)} ms; structureProblems ${Math.round(structureMs)} ms`);
    expect(found).toEqual({ pages: [], elsewhere: [] });
    expect(problems).toEqual([]);
    expect(report.textLayerCharsOmitted).toBe(0);
    expect(buildMs).toBeLessThan(30_000);
    expect(findMs + structureMs).toBeLessThan(30_000);
  }, 240_000);
});
