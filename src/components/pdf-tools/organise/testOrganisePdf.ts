// Test helper only: the file the Organise pages run is checked on, built in memory, and pdf.js read-backs
// of a result by page content. Not imported by production code.
//
// Five pages, each headed "Org p<n>":
// - form fields "fieldP1" … "fieldP5", one per page, and "shared" with widgets on pages 2 and 4;
// - links: page 1 to page 4 directly and by the name "chap4", page 2 to page 5, page 4 to page 3,
//   page 5 to page 2 by a GoTo action;
// - nested bookmarks: Part A (p1) holding A.1 (p2) and the page 3 bookmark (p3), which holds A.2.i (p4);
//   Part B (p5);
// - page labels i, ii, 1, 2, 3;
// - page 3 carries markers found nowhere else: its text, its field's value, its bookmark's title and a
//   web link's address. Optionally a signature field on page 1.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';
import { buildOutline, fit } from '@/lib/pdf-tools/testOutlinePdf';

export const REMOVED_MARKERS = ['MKREMOVEDPAGETEXT', 'MKREMOVEDFIELDVALUE', 'MKREMOVEDBOOKMARK', 'MKREMOVEDLINKURI'] as const;

export async function makeOrganiseFixture(options: { signature?: boolean; pages?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = Math.max(5, options.pages ?? 5);
  const pages = Array.from({ length: total }, (_, i) => {
    const page = doc.addPage([300, 400]);
    page.drawText(`Org p${i + 1}`, { x: 20, y: 360, size: 16, font });
    return page;
  });
  pages[2].drawText('MKREMOVEDPAGETEXT', { x: 20, y: 330, size: 10, font });

  const form = doc.getForm();
  for (let n = 1; n <= 5; n++) {
    const field = form.createTextField(`fieldP${n}`);
    field.setText(n === 3 ? 'MKREMOVEDFIELDVALUE' : `Value on page ${n}`);
    field.addToPage(pages[n - 1], { x: 20, y: 280, width: 260, height: 24, font });
  }
  const shared = form.createTextField('shared');
  shared.setText('Shared value');
  shared.addToPage(pages[1], { x: 20, y: 240, width: 260, height: 24, font });
  shared.addToPage(pages[3], { x: 20, y: 240, width: 260, height: 24, font });

  const ctx = doc.context;
  const link = (from: number, rect: number[], entry: Record<string, unknown>) =>
    pages[from].node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...entry } as never)));
  link(0, [20, 20, 120, 34], { Dest: [pages[3].ref, 'Fit'] });
  link(0, [20, 40, 120, 54], { Dest: PDFString.of('chap4') });
  link(1, [20, 20, 120, 34], { Dest: [pages[4].ref, 'Fit'] });
  link(3, [20, 20, 120, 34], { Dest: [pages[2].ref, 'Fit'] });
  link(4, [20, 20, 120, 34], { A: { S: 'GoTo', D: [pages[1].ref, 'Fit'] } });
  link(2, [20, 60, 120, 74], { A: { S: 'URI', URI: PDFString.of('https://example.invalid/MKREMOVEDLINKURI') } });
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: { Names: [PDFString.of('chap4'), [pages[3].ref, 'Fit']] } }));

  buildOutline(doc, [
    {
      title: 'Part A',
      dest: fit(doc, 0),
      open: true,
      children: [
        { title: 'A.1', dest: fit(doc, 1) },
        { title: PDFHexString.fromText('MKREMOVEDBOOKMARK'), dest: fit(doc, 2), open: true, children: [{ title: 'A.2.i', dest: fit(doc, 3) }] },
      ],
    },
    { title: 'Part B', dest: fit(doc, 4) },
  ]);
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: [0, { S: 'r' }, 2, { S: 'D' }] }));

  if (options.signature) {
    const value = ctx.register(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 100, 200, 300], Contents: PDFHexString.of('00'.repeat(64)) }));
    const field = ctx.register(ctx.obj({ FT: 'Sig', T: PDFString.of('Signature1'), V: value, Kids: [] }));
    const widget = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [160, 20, 280, 50], F: 4, P: pages[0].ref, Parent: field }));
    ctx.lookup(field, PDFDict).lookup(PDFName.of('Kids'), PDFArray).push(widget);
    form.acroForm.addField(field);
    pages[0].node.addAnnot(widget);
    form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }
  return doc.save();
}

export interface PageView {
  text: string;
  rotate: number;
  /** The heading text ("Org p4") of the page each page link opens; null when it opens no page. */
  links: (string | null)[];
  /** Web links' addresses. */
  urls: string[];
  /** Field name to value, for the widgets on this page. */
  fields: Record<string, unknown>;
}

/** pdf.js: every page by its heading, its rotation, where its links go (by heading), its fields; the bookmarks with their pages' headings; the labels. */
export async function readByContent(bytes: Uint8Array): Promise<{ pages: PageView[]; outline: [number, string, string | null][]; labels: string[] | null }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const heading = async (index: number) => {
      const page = await pdf.getPage(index + 1);
      const items = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : ''));
      return items.find((s) => s.startsWith('Org p')) ?? items.join('');
    };
    const headings: string[] = [];
    for (let i = 0; i < pdf.numPages; i++) headings.push(await heading(i));
    const pageOf = async (dest: unknown): Promise<string | null> => {
      try {
        const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
        if (!Array.isArray(explicit) || explicit[0] === null || explicit[0] === undefined) return null;
        const index = typeof explicit[0] === 'number' ? explicit[0] : await pdf.getPageIndex(explicit[0]);
        return headings[index] ?? null;
      } catch {
        return null;
      }
    };
    const pages: PageView[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const view: PageView = { text: headings[n - 1], rotate: page.rotate, links: [], urls: [], fields: {} };
      for (const a of (await page.getAnnotations()) as { subtype: string; dest?: unknown; url?: string; fieldName?: string; fieldValue?: unknown }[]) {
        if (a.subtype === 'Link' && a.url) view.urls.push(a.url);
        else if (a.subtype === 'Link') view.links.push(await pageOf(a.dest));
        if (a.subtype === 'Widget' && a.fieldName) view.fields[a.fieldName] = a.fieldValue;
      }
      pages.push(view);
    }
    const outline: [number, string, string | null][] = [];
    const walk = async (items: { title: string; dest: unknown; items: unknown[] }[] | null, depth: number) => {
      for (const item of items ?? []) {
        outline.push([depth, item.title, await pageOf(item.dest)]);
        await walk(item.items as typeof items, depth + 1);
      }
    };
    await walk((await pdf.getOutline()) as never, 0);
    return { pages, outline, labels: await pdf.getPageLabels() };
  } finally {
    await pdf.destroy();
  }
}
