// Test helper only: synthetic PDFs for Resize or crop pages (pageBox.ts), and pdf.js comparisons of a
// page with another page's content scaled and placed. Not imported by production code.
import { degrees, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, rgb, StandardFonts, type PDFFont, type PDFObject, type PDFPage, type PDFRef } from 'pdf-lib';
import { renderPage, type Raster } from './testMarksPdf';
import { buildOutline } from './testOutlinePdf';

/**
 * The test picture, drawn inside the box (x, y, w, h) of the page's own coordinates: a dark frame 12 in
 * from the edges, a red square near the top-left and a green one near the bottom-right corner, a blue
 * bar across the middle and a label. Asymmetric, so a page turned or mirrored the wrong way shows.
 */
function picture(page: PDFPage, font: PDFFont, label: string, box: { x: number; y: number; width: number; height: number }, unit = 1): void {
  const { x, y, width: w, height: h } = box;
  const u = (n: number) => n / unit;
  page.drawRectangle({ x: x + u(12), y: y + u(12), width: w - u(24), height: h - u(24), borderColor: rgb(0.1, 0.1, 0.1), borderWidth: u(4) });
  page.drawRectangle({ x: x + u(30), y: y + h - u(90), width: u(60), height: u(60), color: rgb(0.85, 0.1, 0.1) });
  page.drawRectangle({ x: x + w - u(90), y: y + u(30), width: u(60), height: u(60), color: rgb(0.1, 0.6, 0.2) });
  page.drawRectangle({ x: x + w / 2 - u(80), y: y + h / 2 - u(10), width: u(160), height: u(20), color: rgb(0.1, 0.2, 0.8) });
  page.drawText(label, { x: x + u(40), y: y + h - u(130), size: u(20), font });
}

/** An annotation with an appearance drawn in page coordinates (its BBox is its Rect), added to the page. */
function annotation(doc: PDFDocument, page: PDFPage, entries: Record<string, PDFObject | string | number | number[] | unknown>, ops?: string): PDFRef {
  const ctx = doc.context;
  const rect = entries.Rect as number[];
  const dict: Record<string, unknown> = { Type: 'Annot', F: 4, P: page.ref, ...entries };
  if (ops) {
    const ap = ctx.register(ctx.flateStream(ops, { Type: 'XObject', Subtype: 'Form', BBox: rect }));
    dict.AP = ctx.obj({ N: ap });
  }
  const ref = ctx.register(ctx.obj(dict as never));
  page.node.addAnnot(ref);
  return ref;
}

export interface BundlePage {
  /** The page as displayed, in real points. */
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  userUnit: number;
}

/**
 * The pages of `makeBundlePdf`, as displayed: 1 Letter, 2-4 Letter turned 90, 180 and 270, 5 a page whose
 * MediaBox and CropBox are both away from the origin (content outside the CropBox, hidden), 6 /UserUnit 2,
 * 7 A4 (already A4), 8 a receipt (80 x 120 mm).
 */
export const BUNDLE_PAGES: BundlePage[] = [
  { width: 612, height: 792, rotate: 0, userUnit: 1 },
  { width: 792, height: 612, rotate: 90, userUnit: 1 },
  { width: 612, height: 792, rotate: 180, userUnit: 1 },
  { width: 792, height: 612, rotate: 270, userUnit: 1 },
  { width: 464, height: 664, rotate: 0, userUnit: 1 },
  { width: 612, height: 792, rotate: 0, userUnit: 2 },
  { width: 595.28, height: 841.89, rotate: 0, userUnit: 1 },
  { width: 226.77, height: 340.16, rotate: 0, userUnit: 1 },
];

/** Where the texts of `makeBundlePdf` are, by page (1-based), in the page's own coordinates. */
export const BUNDLE_TEXT = { link3: 'Go to page 3', chapter: 'Chapter five', back: 'Back to one', unit: 'Unit link', field: 'Amount' } as const;

/**
 * Eight pages (BUNDLE_PAGES) with the test picture on each, and everything a resize must carry and move:
 * page 1 has a link to page 3 (/XYZ, with /QuadPoints), a link by name (/A /GoTo to "chapter5", a
 * /FitH on page 5), a square comment with /RD and a border, an ink drawing, a line, a highlight
 * (/QuadPoints), a popup, a text field (value, appearance, /DA 12 pt), an annotation of an unknown kind
 * and a bead of an article thread; page 2 (turned) a link back to page 1 (/FitR); page 6 (/UserUnit 2) a
 * link to itself. Bookmarks (/Fit, /XYZ, /FitH, /FitR, a named destination), an opening view, named
 * destinations in /Names and /Dests, an attachment, document properties and an XMP stream.
 */
export async function makeBundlePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const pages: PDFPage[] = [];

  for (const [i, spec] of BUNDLE_PAGES.entries()) {
    const n = i + 1;
    const sideways = spec.rotate === 90 || spec.rotate === 270;
    const w = (sideways ? spec.height : spec.width) / spec.userUnit;
    const h = (sideways ? spec.width : spec.height) / spec.userUnit;
    let page: PDFPage;
    if (n === 5) {
      page = doc.addPage([612, 792]);
      page.setMediaBox(50, 60, 612, 792);
      page.setCropBox(100, 110, 464, 664);
      // Drawn but hidden: inside the MediaBox and outside the CropBox, and outside the MediaBox.
      page.drawRectangle({ x: 60, y: 300, width: 30, height: 200, color: rgb(1, 0, 0) });
      page.drawRectangle({ x: 0, y: 0, width: 45, height: 45, color: rgb(1, 0, 0) });
      picture(page, font, `Box p${n}`, { x: 100, y: 110, width: 464, height: 664 });
    } else {
      page = doc.addPage([w, h]);
      if (spec.userUnit !== 1) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(spec.userUnit));
      picture(page, font, `Box p${n}`, { x: 0, y: 0, width: w, height: h }, spec.userUnit);
    }
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    pages.push(page);
  }
  const [p1, p2, p3, p4, p5, p6, p7] = pages;
  void p4;

  // Page 1: links over text, comments, a field, an unknown kind, a bead.
  const size = 14;
  const w3 = font.widthOfTextAtSize(BUNDLE_TEXT.link3, size);
  p1.drawText(BUNDLE_TEXT.link3, { x: 100, y: 600, size, font });
  annotation(doc, p1, { Subtype: 'Link', Rect: [98, 596, 102 + w3, 614], QuadPoints: [98, 614, 102 + w3, 614, 98, 596, 102 + w3, 596], Border: [0, 0, 0], Dest: ctx.obj([p3.ref, 'XYZ', 72, 700, 0]) });
  const wc = font.widthOfTextAtSize(BUNDLE_TEXT.chapter, size);
  p1.drawText(BUNDLE_TEXT.chapter, { x: 100, y: 560, size, font });
  annotation(doc, p1, { Subtype: 'Link', Rect: [98, 556, 102 + wc, 574], Border: [0, 0, 0], A: ctx.obj({ S: 'GoTo', D: PDFString.of('chapter5') }) });
  const square = annotation(
    doc,
    p1,
    { Subtype: 'Square', Rect: [400, 600, 520, 700], RD: [2, 2, 2, 2], BS: ctx.obj({ W: 3 }), C: [1, 0, 0], Contents: PDFString.of('Checked') },
    '1 0 0 RG 3 w 401.5 601.5 117 97 re S',
  );
  annotation(doc, p1, { Subtype: 'Ink', Rect: [300, 300, 400, 380], InkList: [[302, 302, 350, 378, 398, 302]], BS: ctx.obj({ W: 2 }) }, '0 0 1 RG 2 w 302 302 m 350 378 l 398 302 l S');
  annotation(doc, p1, { Subtype: 'Line', Rect: [95, 195, 305, 255], L: [100, 200, 300, 250], LL: 10, BS: ctx.obj({ W: 2 }) }, '0 0.5 0 RG 2 w 100 200 m 300 250 l S');
  annotation(doc, p1, { Subtype: 'Highlight', Rect: [100, 500, 250, 520], QuadPoints: [100, 520, 250, 520, 100, 500, 250, 500], C: [1, 0.9, 0] }, '1 0.9 0 rg 100 500 150 20 re f');
  annotation(doc, p1, { Subtype: 'Popup', Rect: [420, 450, 580, 560], Parent: square, Open: false });
  annotation(doc, p1, { Subtype: 'Weird', Rect: [450, 100, 500, 150] });
  const fieldWidth = 200;
  p1.drawText(BUNDLE_TEXT.field, { x: 100, y: 430, size: 12, font });
  const field = doc.getForm().createTextField('amount');
  field.setText('1,250.00');
  field.addToPage(p1, { x: 100, y: 400, width: fieldWidth, height: 24, font });
  // The text size comes from the field (the widget has none of its own), as many form makers write it.
  field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 12 Tf 0 g'));
  for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('DA'));
  const thread = ctx.nextRef();
  const bead = ctx.register(ctx.obj({ Type: 'Bead', T: thread, P: p1.ref, R: [50, 50, 300, 300] }));
  ctx.lookup(bead, PDFDict).set(PDFName.of('N'), bead);
  ctx.assign(thread, ctx.obj({ Type: 'Thread', F: bead }));
  p1.node.set(PDFName.of('B'), ctx.obj([bead]));
  doc.catalog.set(PDFName.of('Threads'), ctx.obj([thread]));

  // Page 2 (turned 90): a link back to page 1.
  p2.drawText(BUNDLE_TEXT.back, { x: 100, y: 655, size: 12, font });
  annotation(doc, p2, { Subtype: 'Link', Rect: [98, 651, 104 + font.widthOfTextAtSize(BUNDLE_TEXT.back, 12), 667], Border: [0, 0, 0], Dest: ctx.obj([p1.ref, 'FitR', 50, 50, 200, 200]) });

  // Page 6 (/UserUnit 2): a link to itself.
  p6.drawText(BUNDLE_TEXT.unit, { x: 50, y: 305, size: 6, font });
  annotation(doc, p6, { Subtype: 'Link', Rect: [49, 303, 52 + font.widthOfTextAtSize(BUNDLE_TEXT.unit, 6), 311], Border: [0, 0, 0], Dest: ctx.obj([p6.ref, 'XYZ', 20, 380, 0]) });

  // Bookmarks, opening view, named destinations.
  const named = ctx.obj([p5.ref, 'FitH', 700]);
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: ctx.obj({ Names: [PDFString.of('chapter5'), named] }) }));
  doc.catalog.set(PDFName.of('Dests'), ctx.obj({ old: ctx.obj([p2.ref, 'XYZ', 10, 20, 0]) }));
  doc.catalog.set(PDFName.of('OpenAction'), ctx.obj([p1.ref, 'XYZ', 0, 792, 0]));
  buildOutline(doc, [
    { title: 'One', dest: ctx.obj([p1.ref, 'Fit']) },
    { title: 'Two', dest: ctx.obj([p2.ref, 'XYZ', 100, 500, null]) },
    { title: 'Five', dest: ctx.obj([p5.ref, 'FitH', 760]) },
    { title: 'Six', dest: ctx.obj([p6.ref, 'FitR', 10, 10, 100, 100]) },
    { title: 'Seven', dest: ctx.obj([p7.ref, 'XYZ', 72, 800, 0]) },
    { title: 'Chapter', action: ctx.obj({ S: 'GoTo', D: PDFString.of('chapter5') }) },
  ]);

  // Carried as they are: an attachment, document properties, an XMP stream.
  await doc.attach(Uint8Array.from(Buffer.from('attached note', 'latin1')), 'note.txt', { mimeType: 'text/plain', description: 'Note' });
  doc.setTitle('Bundle title');
  doc.setAuthor('Bundle author');
  doc.setCreator('Bundle creator');
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream('<x:xmpmeta>BundleXMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
  // Saved without redrawing the field (that would give the widget a text size of its own again).
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** One Letter page filled by a shading pattern (a red-to-blue gradient across) and a tiling pattern (stripes). */
export async function makePatternPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([612, 792]);
  const shading = ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [100, 0, 500, 0], Function: ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 }), Extend: [true, true] });
  const gradient = ctx.register(ctx.obj({ PatternType: 2, Shading: shading, Matrix: [1, 0, 0, 1, 0, 0] }));
  const stripes = ctx.register(
    ctx.flateStream('0 0.6 0 rg 0 0 10 20 re f', { PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 20, 20], XStep: 20, YStep: 20, Resources: ctx.obj({}), Matrix: [1, 0, 0, 1, 0, 0] }),
  );
  page.node.set(PDFName.of('Resources'), ctx.obj({ Pattern: ctx.obj({ G: gradient, S: stripes }) }));
  const content = '/Pattern cs /G scn 100 450 400 250 re f\n/Pattern cs /S scn 100 100 400 250 re f\n0 0 0 RG 4 w 12 12 588 768 re S';
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  return doc.save();
}

/** One Letter page whose content is an array of three streams: a `q` and a scale in the first, closed in the third. */
export async function makeArrayContentPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Resources'), ctx.obj({ Font: ctx.obj({ F1: font.ref }) }));
  const parts = ['q 0.5 0 0 0.5 0 0 cm', 'BT /F1 48 Tf 200 1200 Td (Array) Tj ET', 'Q 0 0 1 rg 50 50 100 100 re f 0 0 0 RG 4 w 12 12 588 768 re S'];
  page.node.set(PDFName.of('Contents'), ctx.obj(parts.map((p) => ctx.register(ctx.flateStream(p)))));
  return doc.save();
}

/** `count` pages of mixed sizes (Letter, A4, A4 landscape, a receipt, Letter turned 90), each with text and a frame. */
export async function makeLongPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes: [number, number, number][] = [[612, 792, 0], [595.28, 841.89, 0], [841.89, 595.28, 0], [226.77, 340.16, 0], [612, 792, 90]];
  for (let n = 1; n <= count; n++) {
    const [w, h, r] = sizes[(n - 1) % sizes.length];
    const page = doc.addPage([w, h]);
    page.drawRectangle({ x: 12, y: 12, width: w - 24, height: h - 24, borderColor: rgb(0, 0, 0), borderWidth: 2 });
    page.drawText(`Long page ${n}`, { x: 30, y: h - 60, size: 14, font });
    if (r) page.setRotation(degrees(r));
  }
  return doc.save();
}

// ---- pdf.js comparisons ------------------------------------------------------------------------------

/** Each colour channel averaged over the 3 x 3 pixels around each pixel: a part-pixel shift of an anti-aliased edge then counts for little, a real move for a lot. */
function blurred(r: Raster): Float32Array {
  const { width: w, height: h, data } = r;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      let sr = 0, sg = 0, sb = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
          n++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = sr / n;
      out[o + 1] = sg / n;
      out[o + 2] = sb / n;
    }
  }
  return out;
}

export interface Placement {
  /** Share of the source's pixels that differ by more than 120 (summed over the channels, both drawings blurred 3 x 3) at the best offset. */
  mismatch: number;
  /** The offset (px, from where it was expected) at which the source matches best, within ±2 px. */
  best: [number, number];
  /** The mismatch at the expected place. */
  atExpected: number;
}

/**
 * Where `inner` (a page drawn at its expected scale) sits in `outer` (another page drawn at scale 1),
 * compared with where it should sit, (x, y) px from the top-left: the mismatch at every offset within
 * ±2 px, and the best one. Both drawings are blurred 3 x 3 first, and a 2 px band at the edge of `inner`
 * is left out: the two are drawn at different part-pixel positions, so their anti-aliased edges differ
 * slightly even when the placement is exact.
 */
export function placementOf(inner: Raster, outer: Raster, x: number, y: number): Placement {
  const a = blurred(inner);
  const b = blurred(outer);
  const score = (dx: number, dy: number): number => {
    let bad = 0;
    let total = 0;
    const ox = Math.round(x) + dx;
    const oy = Math.round(y) + dy;
    for (let py = 2; py < inner.height - 2; py++) {
      const ty = py + oy;
      if (ty < 0 || ty >= outer.height) continue;
      for (let px = 2; px < inner.width - 2; px++) {
        const tx = px + ox;
        if (tx < 0 || tx >= outer.width) continue;
        total++;
        const i = (py * inner.width + px) * 3;
        const j = (ty * outer.width + tx) * 3;
        if (Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]) > 120) bad++;
      }
    }
    return total === 0 ? 1 : bad / total;
  };
  let best: [number, number] = [0, 0];
  let low = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const s = score(dx, dy);
      if (s < low) {
        low = s;
        best = [dx, dy];
      }
    }
  }
  return { mismatch: low, best, atExpected: score(0, 0) };
}

/** Pixels of `page` outside the box (x, y, w, h) px, `pad` px outside it, that are not white. */
export function inkOutside(page: Raster, x: number, y: number, w: number, h: number, pad = 2): number {
  let count = 0;
  for (let py = 0; py < page.height; py++) {
    for (let px = 0; px < page.width; px++) {
      if (px >= x - pad && px <= x + w + pad && py >= y - pad && py <= y + h + pad) continue;
      const i = (py * page.width + px) * 4;
      if (page.data[i] + page.data[i + 1] + page.data[i + 2] < 3 * 245) count++;
    }
  }
  return count;
}

export { renderPage };

/** pdf.js's view of a page: its size at scale 1, a point of the page's own coordinates as displayed, text positions and annotation boxes. */
export async function pdfjsPage(bytes: Uint8Array, pageNumber: number, scale = 1) {
  const { getDocument, Util } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const text = await page.getTextContent();
    const items = text.items.filter((i): i is typeof i & { str: string; transform: number[]; width: number } => 'str' in i);
    const annotations = (await page.getAnnotations()) as { subtype: string; rect: number[]; fieldName?: string; dest?: unknown }[];
    const toView = (x: number, y: number): [number, number] => {
      const p = viewport.convertToViewportPoint(x, y);
      return [p[0], p[1]];
    };
    return {
      width: viewport.width,
      height: viewport.height,
      toView,
      /** The top-left of a text item as displayed (px), and its width along the line. */
      textAt: (str: string): [number, number] => {
        const item = items.find((i) => i.str === str);
        if (!item) throw new Error(`text "${str}" not found on page ${pageNumber}`);
        const t = Util.transform(viewport.transform, item.transform);
        return [t[4], t[5]];
      },
      /** Each annotation's box as displayed: [left, top, right, bottom] px. */
      boxes: annotations.map((a) => {
        const r = viewport.convertToViewportRectangle(a.rect);
        return { subtype: a.subtype, fieldName: a.fieldName, box: [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])] as [number, number, number, number] };
      }),
      dests: annotations.map((a) => a.dest),
    };
  } finally {
    await pdf.destroy();
  }
}

/** pdf.js's outline: each bookmark's title and its destination array (page as a 0-based index). */
export async function pdfjsOutlineDests(bytes: Uint8Array): Promise<{ title: string; page: number | null; dest: unknown[] | null }[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const outline = (await pdf.getOutline()) ?? [];
    const out: { title: string; page: number | null; dest: unknown[] | null }[] = [];
    for (const item of outline) {
      let dest = item.dest as unknown;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) {
        out.push({ title: item.title, page: null, dest: null });
        continue;
      }
      const page = await pdf.getPageIndex(dest[0] as never);
      out.push({ title: item.title, page, dest });
    }
    return out;
  } finally {
    await pdf.destroy();
  }
}
