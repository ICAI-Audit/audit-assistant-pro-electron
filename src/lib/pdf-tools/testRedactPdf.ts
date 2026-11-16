// Test helper only: synthetic files for Redact (trials 1, 3 and 4 of spike-report.md) and the pdf.js
// readers the Redact tests use in Node. Every value is synthetic. Not imported by production code.
//
// - makePositionsPdf(): five pages (plain, /Rotate 90, 180, 270, and a crop box with text outside it),
//   with the true along-text position of each value (`truths`).
// - makeHidingPdf(): one PAN hidden in 44 tagged places, including an earlier saved revision.
// - makeLatinPlusPdf(): Helvetica text whose ToUnicode map gives Devanagari and the rupee sign, and a
//   page with an "fi" ligature.
// - makeEmbeddedPdf(): Liberation Sans (pdf.js's own copy) embedded by jsPDF as Identity-H.
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, type PDFFont, type PDFObject } from 'pdf-lib';
import { calculateGstinCheckDigit } from '@/lib/gstinValidation';
import type { FontStyleLike, MeasureChar, TextItemLike } from './pageText';
import type { AnnotationText } from './redactFind';

const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')).replace(/\\/g, '/');
export const STANDARD_FONTS_DIR = `${pdfjsDir}/standard_fonts/`;

// ---- values ----------------------------------------------------------------------------------------

export const PAN = 'BNZPM2501F';
export const PAN2 = 'QZXCV0000W';
/** 23456789012 with its Verhoeff check digit. */
export const AADHAAR = '234567890124';
export const AADHAAR_SPACED = '2345 6789 0124';
export const GSTIN = `27QZXCV0000W1Z${calculateGstinCheckDigit('27QZXCV0000W1Z')}`;
export const MOBILE = '98450 12345';
export const EMAIL = 'r.kumar@example.in';
export const IFSC = 'HDFC0001234';
export const ACCOUNT = '50100123456789';
/** Drawn in render mode 3 (invisible) on every positions page. */
export const HIDDEN_PAN = 'CQZPK7777A';
/** Drawn white on white on every positions page. */
export const WHITE_PAN = 'DRYPK8888B';
/** Drawn outside page 5's crop box only. */
export const OUTSIDE_PAN = 'EXZPK9999C';

/** A literal PDF string for Latin-1 text. */
export function lit(text: string): string {
  let out = '(';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (c < 32 || c > 126) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `${out})`;
}

/**
 * A file of A4 pages, each drawn by the raw content stream given, with /F1 the standard Helvetica in
 * WinAnsi (fix wave 3: the re-tester's layouts, written exactly as their content streams are).
 */
export async function makeRawPagesPdf(contents: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  for (const content of contents) {
    const page = doc.addPage([595.28, 841.89]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  }
  return doc.save({ useObjectStreams: false });
}

// ---- the positions file (trial 1) ------------------------------------------------------------------

interface Fonts {
  F1: PDFFont; // Helvetica
  F2: PDFFont; // Times-Roman
  F3: PDFFont; // Courier
}

/** Where a value truly is: along-text start and end in user space, and its baseline. */
export interface Truth {
  id: string;
  /** 0-based page index. */
  page: number;
  value: string;
  /** 'x': text runs along +x; 'y': text runs upward along +y. */
  dir: 'x' | 'y';
  a0: number;
  a1: number;
  /** Baseline: y for horizontal text, x for upward text. */
  base: number;
  /** Font size in user space. */
  size: number;
  /** How close a box built from per-character widths must be (pt), by the trial's measurements. */
  tolerance: number;
}

async function standardFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    F1: await doc.embedFont(StandardFonts.Helvetica),
    F2: await doc.embedFont(StandardFonts.TimesRoman),
    F3: await doc.embedFont(StandardFonts.Courier),
  };
}

/** Width without kerning: a PDF show operator applies none. */
const w = (f: Fonts, key: keyof Fonts, s: string, size: number) => Array.from(s).reduce((sum, ch) => sum + f[key].widthOfTextAtSize(ch, size), 0);

function rawPage(doc: PDFDocument, fonts: Fonts, size: [number, number], content: string, opts: { rotate?: number; cropBox?: number[]; xobjects?: Record<string, PDFRef> } = {}) {
  const page = doc.addPage(size);
  const ctx = doc.context;
  const res: Record<string, PDFObject> = { Font: ctx.obj({ F1: fonts.F1.ref, F2: fonts.F2.ref, F3: fonts.F3.ref }) };
  if (opts.xobjects) res.XObject = ctx.obj(opts.xobjects);
  page.node.set(PDFName.of('Resources'), ctx.obj(res));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  if (opts.rotate) page.node.set(PDFName.of('Rotate'), PDFNumber.of(opts.rotate));
  if (opts.cropBox) page.node.set(PDFName.of('CropBox'), ctx.obj(opts.cropBox));
  return page;
}

function positionsContent(f: Fonts, page: number): { content: string; truths: Truth[] } {
  const truths: Truth[] = [];
  const parts: string[] = [];
  const line = `PAN of the assessee: ${PAN}, dated 01-04-2025 (AY 2025-26)`;
  const pre = 'PAN of the assessee: ';
  const add = (id: string, key: keyof Fonts, size: number, x: number, y: number) => {
    parts.push(`BT /${key} ${size} Tf ${x} ${y} Td ${lit(line)} Tj ET`);
    const a0 = x + w(f, key, pre, size);
    truths.push({ id, page, value: PAN, dir: 'x', a0, a1: a0 + w(f, key, PAN, size), base: y, size, tolerance: 0.1 });
  };
  add('C1-helvetica', 'F1', 10, 72, 760);
  add('C2-times', 'F2', 11, 72, 730);
  add('C3-courier', 'F3', 9, 72, 700);

  // C4: one value split across two show operators.
  parts.push(`BT /F1 10 Tf 72 670 Td ${lit('PAN: BNZPM')} Tj ${lit('2501F, dated today')} Tj ET`);
  {
    const a0 = 72 + w(f, 'F1', 'PAN: ', 10);
    truths.push({ id: 'C4-split-Tj', page, value: PAN, dir: 'x', a0, a1: a0 + w(f, 'F1', PAN, 10), base: 670, size: 10, tolerance: 0.1 });
  }
  // C5: a kerning array; pdf.js reads the -120 gap as a space inside the value.
  parts.push(`BT /F1 10 Tf 72 640 Td [${lit('PAN: BN')} -120 ${lit('ZPM2')} 80 ${lit('501F, dated')}] TJ ET`);
  {
    const a0 = 72 + w(f, 'F1', 'PAN: ', 10);
    const a1 = 72 + w(f, 'F1', 'PAN: BN', 10) + 1.2 + w(f, 'F1', 'ZPM2', 10) - 0.8 + w(f, 'F1', '501F', 10);
    truths.push({ id: 'C5-TJ-kerning', page, value: PAN, dir: 'x', a0, a1, base: 640, size: 10, tolerance: 0.7 });
  }
  // C6: character spacing, word spacing and horizontal scaling (inside q/Q so they do not leak).
  {
    const text = `Account holder PAN ${PAN} here`;
    parts.push(`q BT /F1 10 Tf 0.6 Tc 3 Tw 85 Tz 72 610 Td ${lit(text)} Tj ET Q`);
    let x = 72;
    let a0 = 0;
    let a1 = 0;
    const start = text.indexOf(PAN);
    for (let i = 0; i < text.length; i++) {
      if (i === start) a0 = x;
      const ch = text[i];
      x += (w(f, 'F1', ch, 10) + 0.6 + (ch === ' ' ? 3 : 0)) * 0.85;
      if (i === start + PAN.length - 1) a1 = x - 0.6 * 0.85; // the last glyph's own width, without the spacing after it
    }
    truths.push({ id: 'C6-Tc-Tw-Tz', page, value: PAN, dir: 'x', a0, a1, base: 610, size: 10, tolerance: 3.4 });
  }
  // C7: an Aadhaar written as three groups placed apart.
  {
    const g = [AADHAAR.slice(0, 4), AADHAAR.slice(4, 8), AADHAAR.slice(8)];
    const x0 = 72 + w(f, 'F1', 'Aadhaar No. ', 10);
    parts.push(`BT /F1 10 Tf 72 580 Td ${lit('Aadhaar No.')} Tj ET`);
    parts.push(`BT /F1 10 Tf ${x0} 580 Td ${lit(g[0])} Tj 30 0 Td ${lit(g[1])} Tj 30 0 Td ${lit(g[2])} Tj ET`);
    truths.push({ id: 'C7-aadhaar-groups', page, value: AADHAAR_SPACED, dir: 'x', a0: x0, a1: x0 + 60 + w(f, 'F1', g[2], 10), base: 580, size: 10, tolerance: 0.1 });
  }
  // C8: an Aadhaar across a line break.
  {
    parts.push(`BT /F1 10 Tf 72 550 Td ${lit(`linked Aadhaar ${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)}`)} Tj 0 -12 Td ${lit(`${AADHAAR.slice(8)} for KYC`)} Tj ET`);
    const a0 = 72 + w(f, 'F1', 'linked Aadhaar ', 10);
    const first = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)}`;
    truths.push({ id: 'C8-aadhaar-linebreak-1', page, value: first, dir: 'x', a0, a1: a0 + w(f, 'F1', first, 10), base: 550, size: 10, tolerance: 0.1 });
    truths.push({ id: 'C8-aadhaar-linebreak-2', page, value: AADHAAR.slice(8), dir: 'x', a0: 72, a1: 72 + w(f, 'F1', AADHAAR.slice(8), 10), base: 538, size: 10, tolerance: 0.1 });
  }
  // C9: a GSTIN inside a form XObject drawn at 1.2x at (300, 500).
  {
    parts.push('q 1.2 0 0 1.2 300 500 cm /Fx1 Do Q');
    const a0 = 300 + 1.2 * w(f, 'F1', 'GSTIN: ', 9);
    truths.push({ id: 'C9-form-xobject', page, value: GSTIN, dir: 'x', a0, a1: a0 + 1.2 * w(f, 'F1', GSTIN, 9), base: 500, size: 10.8, tolerance: 0.1 });
  }
  // C10: text running upward.
  {
    parts.push(`BT /F1 10 Tf 0 1 -1 0 40 100 Tm ${lit(`PAN ${PAN2}`)} Tj ET`);
    const a0 = 100 + w(f, 'F1', 'PAN ', 10);
    truths.push({ id: 'C10-upward-text', page, value: PAN2, dir: 'y', a0, a1: a0 + w(f, 'F1', PAN2, 10), base: 40, size: 10, tolerance: 0.1 });
  }
  // C11: hidden text: render mode 3 (invisible), and white on white.
  parts.push(`BT /F1 10 Tf 3 Tr 72 450 Td ${lit(`Hidden PAN ${HIDDEN_PAN}`)} Tj ET`);
  parts.push(`BT 1 1 1 rg /F1 10 Tf 72 430 Td ${lit(`White PAN ${WHITE_PAN}`)} Tj ET`);
  // C12: email, mobile, account and IFSC on one line.
  parts.push(`BT /F1 9 Tf 72 400 Td ${lit(`Contact ${EMAIL}, mobile +91 ${MOBILE}; A/c ${ACCOUNT} IFSC ${IFSC}`)} Tj ET`);
  return { content: parts.join('\n'), truths };
}

/** Page 5's crop box. Text at x = 450 lies outside it. */
export const POSITIONS_CROP_BOX = [36, 36, 400, 700] as const;

/**
 * Five Letter pages with the same content: plain, /Rotate 90, 180, 270, and a crop box (36 36 400 700)
 * with "Outside crop PAN EXZPK9999C" at x = 450. `truths` gives each value's true position per page.
 */
export async function makePositionsPdf(): Promise<{ bytes: Uint8Array; truths: Truth[] }> {
  const doc = await PDFDocument.create();
  const fonts = await standardFonts(doc);
  const ctx = doc.context;
  const fx = ctx.register(
    ctx.flateStream(`BT /F1 9 Tf 0 0 Td ${lit(`GSTIN: ${GSTIN}`)} Tj ET`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 250, 20],
      Resources: { Font: { F1: fonts.F1.ref, F2: fonts.F2.ref, F3: fonts.F3.ref } },
    } as never),
  );
  const truths: Truth[] = [];
  const pages: { rotate?: number; cropBox?: number[] }[] = [{}, { rotate: 90 }, { rotate: 180 }, { rotate: 270 }, { cropBox: [...POSITIONS_CROP_BOX] }];
  pages.forEach((opts, i) => {
    const { content, truths: t } = positionsContent(fonts, i);
    const extra = i === 4 ? `\nBT /F1 10 Tf 450 300 Td ${lit(`Outside crop PAN ${OUTSIDE_PAN}`)} Tj ET` : '';
    rawPage(doc, fonts, [612, 792], content + extra, { ...opts, xobjects: { Fx1: fx } });
    truths.push(...t);
  });
  return { bytes: await doc.save({ useObjectStreams: false }), truths };
}

// ---- the hiding-places file (trial 4) --------------------------------------------------------------

export const SECRET = PAN;
/** Where each marker hides; a marker is SECRET followed by its place tag, so a hit says where it came from. */
export const PLACES: Readonly<Record<string, string>> = {
  P1_TEXT: 'visible text on page 1 (to be boxed)',
  P1_ACTUALTEXT: 'marked-content /ActualText on page 1',
  P1_OCG_HIDDEN: 'text in a hidden layer on page 1',
  P1_OUTSIDE_CROP: 'text outside the crop box on page 1',
  P1_WHITE: 'white text on page 1',
  P1_COMMENT: 'comment /Contents on page 1',
  P1_COMMENT_AUTHOR: 'comment author /T on page 1',
  P1_FREETEXT_AP: 'FreeText appearance text on page 1',
  P1_LINK_URI: 'link URI on page 1',
  P1_ATTACHMENT: 'file attachment annotation on page 1 (file content)',
  P1_FIELD_VALUE: 'form field value on page 1',
  P1_FIELD_JS: 'form field /AA JavaScript on page 1',
  P1_PAGE_AA: 'page /AA JavaScript on page 1',
  P1_PIECEINFO: 'page /PieceInfo on page 1',
  P1_PAGE_XMP: 'page /Metadata on page 1',
  P1_THUMB: 'page /Thumb on page 1',
  P1_IMAGE_XMP: 'image /Metadata on page 1',
  P1_REDACT_OVERLAY: 'unapplied /Redact annotation overlay on page 1',
  P2_COMMENT: 'comment /Contents on page 2',
  P2_REPLY_TO_P1: 'reply on page 2 to the page 1 comment',
  P2_FIELD_VALUE: 'form field value on page 2',
  P2_OUTSIDE_CROP: 'text outside the crop box on page 2',
  P2_OCG_HIDDEN: 'text in a hidden layer on page 2',
  P2_ACTUALTEXT: 'marked-content /ActualText on page 2',
  P2_PIECEINFO: 'page /PieceInfo on page 2',
  P2_IMAGE_XMP: 'image /Metadata on page 2',
  P2_PAGE_AA: 'page /AA JavaScript on page 2',
  P2_ATTACHMENT: 'file attachment annotation on page 2',
  P2_LINK_JS: 'link with a JavaScript action on page 2',
  DOC_INFO_TITLE: '/Info title',
  DOC_INFO_AUTHOR: '/Info author',
  DOC_XMP: 'catalog /Metadata',
  DOC_OUTLINE: 'bookmark title',
  DOC_OUTLINE_UTF16: 'bookmark title in UTF-16',
  DOC_OUTLINE_JS: 'bookmark with a JavaScript action',
  DOC_EMBEDDED_FILE: '/Names /EmbeddedFiles',
  DOC_JAVASCRIPT: '/Names /JavaScript',
  DOC_DEST_NAME: '/Names /Dests key',
  DOC_OPENACTION: '/OpenAction JavaScript',
  DOC_PAGELABEL: '/PageLabels prefix',
  DOC_STRUCT_ALT: 'structure tree /Alt',
  DOC_STRUCT_ACTUALTEXT: 'structure tree /ActualText',
  DOC_HIDDEN_FIELD: 'form field with no widget on any page',
  DOC_OLD_REVISION: 'page 3 content in an earlier saved revision',
};
export const tag = (place: string): string => `${SECRET}-${place}`;

/**
 * Three A4 pages (media box 595 x 1000, crop box 595 x 842) hiding SECRET in the 44 PLACES, then an
 * incremental update that replaces page 3's content (the old content stays in the earlier revision).
 */
export async function makeHidingPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const str = (place: string) => PDFString.of(tag(place));
  const stream = (text: string, dict: Record<string, unknown> = {}) => ctx.register(ctx.flateStream(text, dict as never));
  const xmp = (place: string) =>
    stream(`<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:title="${tag(place)}"/></rdf:RDF></x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' });
  const js = (place: string) => ctx.obj({ S: 'JavaScript', JS: str(place) });
  const fileSpec = (place: string) => {
    const ef = stream(`Attached file holding ${tag(place)}`, { Type: 'EmbeddedFile' });
    return ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('notes.txt'), UF: PDFString.of('notes.txt'), EF: { F: ef } }));
  };
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Hidden layer') }));
  const image = (place: string) => {
    const pixels = zlib.deflateSync(Buffer.alloc(16 * 16, 200));
    return ctx.register(ctx.stream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode', Metadata: xmp(place) } as never));
  };
  const sharedForm = stream('BT /F1 9 Tf 0 0 Td (Header CONFIDENTIAL) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 20], Resources: { Font: { F1: helv.ref } } });

  const pages = [1, 2, 3].map(() => doc.addPage([595, 842]));
  const content = (n: number) => {
    const p = `P${n}`;
    return [
      'q 1 0 0 1 50 800 cm /Hd Do Q',
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
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: helv.ref }, XObject: { Hd: sharedForm, Im1: image(`P${n}_IMAGE_XMP`) }, Properties: { oc1: ocg } }));
    page.node.set(PDFName.of('Contents'), stream(n === 3 ? `BT /F1 12 Tf 50 750 Td (Old revision ${tag('DOC_OLD_REVISION')}) Tj ET` : content(n)));
  });

  // page 1 extras
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
  const field1 = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('pan_field'), V: str('P1_FIELD_VALUE'), Rect: [50, 300, 250, 320], F: 4, P: pages[0].ref, AA: { K: js('P1_FIELD_JS') }, DA: PDFString.of('/Helv 10 Tf 0 g') }),
  );
  const redactAnnot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Redact', Rect: [50, 745, 300, 765], OverlayText: str('P1_REDACT_OVERLAY') }));
  p1.set(PDFName.of('Annots'), ctx.obj([comment1, freeText, link, attach1, field1, redactAnnot]));

  // page 2 extras
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

  // document level
  const hiddenField = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of('hidden_field'), V: str('DOC_HIDDEN_FIELD') }));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field1, field2, hiddenField], DA: PDFString.of('/Helv 10 Tf 0 g'), DR: { Font: { Helv: helv.ref } } }));
  doc.setTitle(tag('DOC_INFO_TITLE'));
  doc.setAuthor(tag('DOC_INFO_AUTHOR'));
  doc.catalog.set(PDFName.of('Metadata'), xmp('DOC_XMP'));
  const outlines = ctx.nextRef();
  const o = [ctx.nextRef(), ctx.nextRef(), ctx.nextRef()];
  ctx.assign(o[0], ctx.obj({ Title: str('DOC_OUTLINE'), Parent: outlines, Next: o[1], Dest: [pages[0].ref, PDFName.of('XYZ'), 0, 842, 0] }));
  ctx.assign(o[1], ctx.obj({ Title: PDFHexString.fromText(`${tag('DOC_OUTLINE_UTF16')} \u0906\u0927\u093e\u0930`), Parent: outlines, Prev: o[0], Next: o[2], Dest: [pages[1].ref, PDFName.of('Fit')] }));
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
  const se = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Figure', P: structRoot, Alt: str('DOC_STRUCT_ALT'), ActualText: str('DOC_STRUCT_ACTUALTEXT'), Pg: pages[0].ref }));
  ctx.assign(structRoot, ctx.obj({ Type: 'StructTreeRoot', K: se }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), structRoot);
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));

  // First revision, then an incremental update that replaces page 3's content stream.
  const base = await doc.save({ useObjectStreams: false });
  const reloaded = await PDFDocument.load(base);
  const oldContents = reloaded.getPages()[2].node.get(PDFName.of('Contents')) as PDFRef;
  const text = Buffer.from('BT /F1 12 Tf 50 750 Td (Page 3 clean text) Tj ET', 'latin1');
  const latin = Buffer.from(base).toString('latin1');
  const prev = Number(/startxref\s+(\d+)/.exec(latin.slice(latin.lastIndexOf('startxref')))![1]);
  const objNum = oldContents.objectNumber;
  const body = `\n${objNum} 0 obj\n<< /Length ${text.length} >>\nstream\n${text.toString('latin1')}\nendstream\nendobj\n`;
  const offset = base.length + 1;
  const size = reloaded.context.largestObjectNumber + 1;
  const rootRef = reloaded.context.trailerInfo.Root as PDFRef;
  const infoRef = reloaded.context.trailerInfo.Info as PDFRef;
  const xrefAt = base.length + Buffer.byteLength(body, 'latin1');
  const xref = `xref\n${objNum} 1\n${String(offset).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${size} /Root ${rootRef.objectNumber} 0 R /Info ${infoRef.objectNumber} 0 R /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([Buffer.from(base), Buffer.from(body + xref, 'latin1')]));
}

// ---- Latin-plus text: Devanagari and the rupee sign through a ToUnicode map -------------------------

/** "taxpayer's PAN" in Hindi. */
export const HINDI = '\u0915\u0930\u0926\u093e\u0924\u093e \u0915\u093e \u092a\u0948\u0928';
/** Page 1's two lines (as pdf.js reads them). Their 18 characters outside Windows Latin-1 are the Hindi letters and both rupee signs. */
export const LATIN_PLUS_LINES: readonly string[] = [`${HINDI} ${PAN} \u20b9 1,25,000 \u0915\u0947 \u0932\u093f\u090f`, `Amount \u20b9 12,34,567 received from ${PAN}`];
/** Page 2's line, drawn with an "fi" ligature glyph. */
export const LIGATURE_TEXT = `Net profit of the ${PAN} certificate holder`;
/** Width (thousandths of an em) given to each non-Latin character, which Helvetica draws as nothing. */
export const LATIN_PLUS_GLYPH_WIDTH = 500;

/** Characters the standard Helvetica font (WinAnsi) cannot hold. */
export function notWinAnsi(text: string): number {
  const extra = new Set(Array.from('\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178'));
  return Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) > 0xff && !extra.has(ch)).length;
}

/**
 * Page 1: LATIN_PLUS_LINES at (50, 700) and (50, 670), Helvetica 12, each non-Latin character drawn
 * through a code that the font's ToUnicode map turns into Devanagari or the rupee sign (Helvetica
 * draws nothing for it but advances LATIN_PLUS_GLYPH_WIDTH). Page 2: LIGATURE_TEXT at (50, 700), with
 * an "fi" glyph through /Differences.
 */
export async function makeLatinPlusPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const special = [...new Set(Array.from(LATIN_PLUS_LINES.join('')).filter((ch) => ch.charCodeAt(0) > 126))];
  const codeOf = new Map(special.map((ch, i) => [ch, i + 1]));
  const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  const hex4 = (n: number) => n.toString(16).padStart(4, '0').toUpperCase();
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    `${special.length} beginbfchar`,
    ...special.map((ch) => `<${hex2(codeOf.get(ch)!)}> <${hex4(ch.charCodeAt(0))}>`),
    'endbfchar',
    '1 beginbfrange',
    '<20> <7E> <0020>',
    'endbfrange',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  const widths = Array.from({ length: 126 }, (_, i) => {
    const code = i + 1;
    if (code <= special.length) return LATIN_PLUS_GLYPH_WIDTH;
    if (code < 32) return 0;
    return Math.round(helvetica.widthOfTextAtSize(String.fromCharCode(code), 1000));
  });
  const f1 = ctx.register(
    ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding', FirstChar: 1, LastChar: 126, Widths: widths, ToUnicode: ctx.register(ctx.flateStream(cmap)) }),
  );
  const encode = (text: string) => `<${Array.from(text).map((ch) => hex2(codeOf.get(ch) ?? ch.charCodeAt(0))).join('')}>`;
  const page1 = doc.addPage([595, 842]);
  page1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: f1 } }));
  page1.node.set(
    PDFName.of('Contents'),
    ctx.register(ctx.flateStream(LATIN_PLUS_LINES.map((line, i) => `BT /F1 12 Tf 50 ${700 - 30 * i} Td ${encode(line)} Tj ET`).join('\n'))),
  );
  const f2 = ctx.register(
    ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [1, PDFName.of('fi'), PDFName.of('fl')] } }),
  );
  const page2 = doc.addPage([595, 842]);
  page2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F2: f2 } }));
  page2.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`BT /F2 12 Tf 50 700 Td ${lit(LIGATURE_TEXT.replace(/fi/g, '\u0001'))} Tj ET`)));
  return doc.save({ useObjectStreams: false });
}

// ---- an embedded TrueType font (jsPDF, Identity-H) ---------------------------------------------------

export interface EmbeddedTruth {
  id: string;
  value: string;
  /** Along-text start and end (x, pt, user space) and baseline (y). */
  a0: number;
  a1: number;
  base: number;
  size: number;
}

/**
 * One Letter page in Liberation Sans (pdf.js's own copy, embedded by jsPDF): a PAN, a GSTIN, a
 * grouped Aadhaar and a PAN between wide and narrow letters, each placed by jsPDF's own widths.
 */
export async function makeEmbeddedPdf(): Promise<{ bytes: Uint8Array; truths: EmbeddedTruth[] }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: [612, 792], compress: true });
  doc.addFileToVFS('liberation.ttf', fs.readFileSync(`${STANDARD_FONTS_DIR}LiberationSans-Regular.ttf`).toString('base64'));
  doc.addFont('liberation.ttf', 'liberation', 'normal');
  doc.setFont('liberation', 'normal');
  const truths: EmbeddedTruth[] = [];
  const lines: [string, string, string, string, number][] = [
    ['pan', 'PAN of the assessee: ', PAN, ', dated 01-04-2025 (AY 2025-26)', 10],
    ['gstin', 'GST registration ', GSTIN, ' is active since 2019', 11],
    ['aadhaar', 'Aadhaar of the partner ', AADHAAR_SPACED, ' was verified', 9],
    ['pan-wide', 'Wide WWW MMM text before ', PAN, ' and lllll iiii after', 12],
  ];
  lines.forEach(([id, pre, value, post, size], i) => {
    doc.setFontSize(size);
    const x = 72;
    const yTop = 100 + i * 40;
    const wPre = doc.getTextWidth(pre);
    const wVal = doc.getTextWidth(value);
    doc.text(pre, x, yTop);
    doc.text(value, x + wPre, yTop);
    doc.text(post, x + wPre + wVal, yTop);
    truths.push({ id, value, a0: x + wPre, a1: x + wPre + wVal, base: 792 - yTop, size });
  });
  return { bytes: new Uint8Array(doc.output('arraybuffer')), truths };
}

// ---- pdf.js in Node ---------------------------------------------------------------------------------

export type PdfjsDocument = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument>['promise']>;

export async function openPdfjs(bytes: Uint8Array): Promise<PdfjsDocument> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS_DIR, useSystemFonts: false, verbosity: 0 }).promise;
}

/** What the renderer's pageTextContent gives (Task A9): pdf.js text items, font styles, view and rotation. */
export async function pdfjsPageText(
  doc: PdfjsDocument,
  pageIndex: number,
): Promise<{ items: TextItemLike[]; styles: Record<string, FontStyleLike>; view: number[]; rotate: number }> {
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const items = content.items.filter((i): i is (typeof content.items)[number] & TextItemLike => 'str' in i) as unknown as TextItemLike[];
  return { items, styles: content.styles as unknown as Record<string, FontStyleLike>, view: [...page.view], rotate: page.rotate };
}

/** What the renderer's pageAnnotationTexts gives (Task A9): each annotation's subtype, rectangle and texts. */
export async function pdfjsAnnotationTexts(doc: PdfjsDocument, pageIndex: number): Promise<AnnotationText[]> {
  const page = await doc.getPage(pageIndex + 1);
  const annotations = (await page.getAnnotations()) as {
    subtype?: string;
    rect?: number[];
    annotationFlags?: number;
    contentsObj?: { str?: string };
    titleObj?: { str?: string };
    textContent?: string[];
    fieldValue?: unknown;
    url?: string;
    unsafeUrl?: string;
  }[];
  return annotations.map((a) => {
    const values = Array.isArray(a.fieldValue) ? a.fieldValue : [a.fieldValue];
    const texts = [a.contentsObj?.str, a.titleObj?.str, ...(a.textContent ?? []), ...values, a.url ?? a.unsafeUrl].filter((t): t is string => typeof t === 'string' && t !== '');
    return { subtype: a.subtype ?? '', rect: a.rect ?? [0, 0, 0, 0], texts, flags: a.annotationFlags ?? 0 };
  });
}

/** A page drawn by pdf.js with rotation 0 on white, as the redaction pictures are drawn. */
export async function renderPdfjsPage(doc: PdfjsDocument, pageIndex: number, dpi: number) {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: dpi / 72, rotation: 0 });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } }).canvasFactory;
  const { canvas, context } = factory.create(width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  await page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' } as never).promise;
  /** A user-space rectangle as whole pixels of this drawing (outward), clipped to it. */
  const pixelRect = (r: { x0: number; y0: number; x1: number; y1: number }) => {
    const [a, b, c, d] = viewport.convertToViewportRectangle([r.x0, r.y0, r.x1, r.y1]);
    const left = Math.max(0, Math.floor(Math.min(a, c)));
    const top = Math.max(0, Math.floor(Math.min(b, d)));
    const right = Math.min(width, Math.ceil(Math.max(a, c)));
    const bottom = Math.min(height, Math.ceil(Math.max(b, d)));
    return { left, top, right, bottom };
  };
  const pixels = (r: { left: number; top: number; right: number; bottom: number }) =>
    r.right > r.left && r.bottom > r.top ? context.getImageData(r.left, r.top, r.right - r.left, r.bottom - r.top).data : new Uint8ClampedArray(0);
  return { context, viewport, width, height, pixelRect, pixels };
}

// ---- ink coverage (fix round 1): every pixel of a value's ink inside its boxes ------------------------

/** One case: content operators with {V} where the value starts and {N} where it ends (render modes are put there). */
export interface InkCase {
  id: string;
  content: string;
  rotate?: number;
  /**
   * The invisible twin's own content, when the visible one must stay as written (one `Tj` for a whole
   * justified line, so pdf.js gives one item): it must draw everything else at the same places, the
   * value in render mode 3 (fix wave, B7).
   */
  hidden?: string;
  /** Page size in points (default 612 x 792): a short page draws faster. */
  size?: readonly [number, number];
}

/**
 * The cases drawn twice, one page each, identical but for the value's render mode: visible (0, or the
 * case's own mode) and invisible (3). The pixels that differ are exactly the value's ink. Fonts: F1
 * Helvetica, F2 Times-Roman, F3 Courier, F4 Times-Italic, F5 a monospaced face (600-unit advances)
 * that pdf.js reports as sans-serif, F6 Helvetica-Bold.
 */
export async function makeInkPdfs(cases: readonly InkCase[]): Promise<{ visible: Uint8Array; hidden: Uint8Array }> {
  const build = async (hidden: boolean) => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    // Monospaced advances (600, one 601 so they are not all equal) under a neutral name with no
    // fixed-pitch flag: pdf.js reports it as sans-serif, as it does for embedded monospaced fonts
    // whose width table is not uniform.
    const widths = Array.from({ length: 95 }, (_, i) => (i === 94 ? 601 : 600));
    const descriptor = ctx.obj({ Type: 'FontDescriptor', FontName: 'LedgerFace', Flags: 32, FontBBox: [-166, -225, 1000, 931], ItalicAngle: 0, Ascent: 718, Descent: -207, CapHeight: 718, StemV: 88 });
    const oddCourier = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'LedgerFace', Encoding: 'WinAnsiEncoding', FirstChar: 32, LastChar: 126, Widths: widths, FontDescriptor: descriptor }));
    const fonts = {
      F1: (await doc.embedFont(StandardFonts.Helvetica)).ref,
      F2: (await doc.embedFont(StandardFonts.TimesRoman)).ref,
      F3: (await doc.embedFont(StandardFonts.Courier)).ref,
      F4: (await doc.embedFont(StandardFonts.TimesRomanItalic)).ref,
      F5: oddCourier,
      F6: (await doc.embedFont(StandardFonts.HelveticaBold)).ref,
    };
    for (const c of cases) {
      const mode = /(\d) Tr/.exec(c.content)?.[1] ?? '0';
      const content = hidden && c.hidden !== undefined ? c.hidden : c.content.replace('{V}', hidden ? '3 Tr' : `${mode} Tr`).replace('{N}', `${mode} Tr`);
      const page = doc.addPage([c.size?.[0] ?? 612, c.size?.[1] ?? 792]);
      page.node.set(PDFName.of('Resources'), ctx.obj({ Font: ctx.obj(fonts) }));
      page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
      if (c.rotate) page.node.set(PDFName.of('Rotate'), PDFNumber.of(c.rotate));
    }
    return doc.save({ useObjectStreams: false });
  };
  return { visible: await build(false), hidden: await build(true) };
}

/**
 * The value's ink (pixels differing by more than 24 levels between the visible and the invisible
 * drawing, at `dpi`, rotation 0) that lies outside every box, and how far outside the worst pixel is.
 */
export async function inkOutside(visible: PdfjsDocument, hidden: PdfjsDocument, pageIndex: number, rects: readonly { x0: number; y0: number; x1: number; y1: number }[], dpi = 300) {
  const a = await renderPdfjsPage(visible, pageIndex, dpi);
  const b = await renderPdfjsPage(hidden, pageIndex, dpi);
  const A = a.context.getImageData(0, 0, a.width, a.height).data;
  const B = b.context.getImageData(0, 0, b.width, b.height).data;
  const boxes = rects.map((r) => {
    const [x0, y0, x1, y1] = a.viewport.convertToViewportRectangle([r.x0, r.y0, r.x1, r.y1]);
    return { l: Math.min(x0, x1), t: Math.min(y0, y1), r: Math.max(x0, x1), b: Math.max(y0, y1) };
  });
  let ink = 0;
  let outside = 0;
  let worst = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) <= 24) continue;
      ink++;
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (boxes.some((q) => cx >= q.l && cx <= q.r && cy >= q.t && cy <= q.b)) continue;
      outside++;
      const d = Math.min(...boxes.map((q) => Math.hypot(Math.max(q.l - cx, 0, cx - q.r), Math.max(q.t - cy, 0, cy - q.b))), Infinity);
      worst = Math.max(worst, d);
    }
  }
  return { ink, outside, worstPt: Number(((worst * 72) / dpi).toFixed(2)) };
}

/**
 * A MeasureChar from pdf-lib's standard-font widths: "Arial" measures with Helvetica, "Times New Roman"
 * with Times-Roman, "Courier New" with Courier. A character the font cannot encode measures
 * LATIN_PLUS_GLYPH_WIDTH / 10 (an advance at 100 px), as makeLatinPlusPdf draws it.
 */
export async function standardMeasure(): Promise<MeasureChar> {
  const doc = await PDFDocument.create();
  const fonts: Record<string, PDFFont> = {
    Arial: await doc.embedFont(StandardFonts.Helvetica),
    'Times New Roman': await doc.embedFont(StandardFonts.TimesRoman),
    'Courier New': await doc.embedFont(StandardFonts.Courier),
  };
  const cache = new Map<string, number>();
  return (ch, family) => {
    const font = fonts[family] ?? fonts.Arial;
    const key = `${family}\u0000${ch}`;
    let width = cache.get(key);
    if (width === undefined) {
      try {
        width = font.widthOfTextAtSize(ch, 100);
      } catch {
        width = LATIN_PLUS_GLYPH_WIDTH / 10;
      }
      cache.set(key, width);
    }
    return width;
  };
}
