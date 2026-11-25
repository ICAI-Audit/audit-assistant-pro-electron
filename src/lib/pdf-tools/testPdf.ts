// Test helper only: builds synthetic PDFs in memory. Not imported by production code.
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  type PDFObject,
} from 'pdf-lib';

export async function makePdf(
  label: string,
  pages: number,
  opts: { size?: [number, number]; rotate?: 0 | 90 | 180 | 270; cropBox?: [number, number, number, number] } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(opts.size ?? [300, 400]);
    page.drawText(`${label} p${n}`, { x: 20, y: 200, size: 18, font });
    if (opts.rotate) page.setRotation(degrees(opts.rotate));
    if (opts.cropBox) page.setCropBox(...opts.cropBox);
  }
  return doc.save();
}

export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs transfers the buffer to its worker, so hand it a copy to keep the caller's bytes intact.
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join('').trim());
  }
  await pdf.destroy();
  return texts;
}

export interface FormPdfOptions {
  /** Leave the values without drawn appearances and set /NeedAppearances, as some form fillers do. */
  needAppearances?: boolean;
  /** Add a signature field (with a signature value holding /ByteRange) on page 1, and /SigFlags. */
  signature?: boolean;
  /** Add links on page 1 to pages 2 and 3. */
  links?: boolean;
  /** Add a bookmark for each page. */
  bookmarks?: boolean;
}

/**
 * A three-page form, each page headed "Form p<n>". Page 1: text field "balance", ticked check box
 * "agree", a field "merged" whose field and widget are one dictionary, and the first widget of
 * "both". Page 2: "address.city" (a child of the field "address"). Page 3: the second widget of
 * "both", "address.street" and "remarks".
 */
export async function makeFormPdf(opts: FormPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2, 3].map((n) => {
    const page = doc.addPage([300, 400]);
    page.drawText(`Form p${n}`, { x: 20, y: 360, size: 14, font });
    return page;
  });
  const form = doc.getForm();
  const at = (y: number) => ({ x: 20, y, width: 260, height: 28, font });
  const balance = form.createTextField('balance');
  balance.setText('Rs 12,34,567 confirmed');
  balance.addToPage(pages[0], at(300));
  const agree = form.createCheckBox('agree');
  agree.addToPage(pages[0], { x: 20, y: 260, width: 18, height: 18 });
  agree.check();
  const both = form.createTextField('both');
  both.setText('On pages 1 and 3');
  both.addToPage(pages[0], at(200));
  both.addToPage(pages[2], at(200));
  const city = form.createTextField('address.city');
  city.setText('Mumbai');
  city.addToPage(pages[1], at(300));
  const street = form.createTextField('address.street');
  street.setText('MG Road on page 3');
  street.addToPage(pages[2], at(300));
  const remarks = form.createTextField('remarks');
  remarks.setText('Only on page 3');
  remarks.addToPage(pages[2], at(250));

  // A field and its widget in one dictionary, listed in /Fields and in the page's /Annots.
  const merged = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('merged'), V: PDFString.of('Merged value'), Rect: [20, 120, 280, 148], F: 4, P: pages[0].ref }),
  );
  form.acroForm.addField(merged);
  pages[0].node.addAnnot(merged);

  if (opts.signature) {
    const value = doc.context.register(
      doc.context.obj({
        Type: 'Sig',
        Filter: 'Adobe.PPKLite',
        SubFilter: 'adbe.pkcs7.detached',
        ByteRange: [0, 100, 200, 300],
        Contents: PDFHexString.of('00'.repeat(64)),
      }),
    );
    const field = doc.context.register(doc.context.obj({ FT: 'Sig', T: PDFString.of('Signature1'), V: value, Kids: [] }));
    const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [20, 60, 200, 100], F: 4, P: pages[0].ref, Parent: field }));
    doc.context.lookup(field, PDFDict).lookup(PDFName.of('Kids'), PDFArray).push(widget);
    form.acroForm.addField(field);
    pages[0].node.addAnnot(widget);
    form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  if (opts.links) {
    for (const [target, y] of [[1, 40], [2, 20]] as const) {
      const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, y, 120, y + 12], Border: [0, 0, 0], Dest: [pages[target].ref, 'Fit'] }));
      pages[0].node.addAnnot(link);
    }
  }

  if (opts.bookmarks) {
    const outlines = doc.context.nextRef();
    const items = pages.map(() => doc.context.nextRef());
    items.forEach((ref, i) => {
      const entry: Record<string, PDFObject> = { Title: PDFString.of(`Page ${i + 1}`), Parent: outlines, Dest: doc.context.obj([pages[i].ref, 'Fit']) };
      if (i > 0) entry.Prev = items[i - 1];
      if (i < items.length - 1) entry.Next = items[i + 1];
      doc.context.assign(ref, doc.context.obj(entry));
    });
    doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: items[0], Last: items[items.length - 1], Count: items.length }));
    doc.catalog.set(PDFName.of('Outlines'), outlines);
  }

  const bytes = await doc.save();
  if (!opts.needAppearances) return bytes;

  // The values stay, their drawn appearances go. The form says how
  // to draw them (/DA) and with which font (/DR), as form fillers that leave this flag do.
  const loaded = await PDFDocument.load(bytes);
  const acroForm = loaded.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
  acroForm.set(PDFName.of('NeedAppearances'), loaded.context.obj(true));
  acroForm.set(PDFName.of('DA'), PDFString.of('/Helv 12 Tf 0 g'));
  const helvetica = loaded.context.register(loaded.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  acroForm.set(PDFName.of('DR'), loaded.context.obj({ Font: { Helv: helvetica } }));
  for (const field of loaded.getForm().getFields()) for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
  return loaded.save({ updateFieldAppearances: false });
}

/**
 * Everything a file holds, as text: every object in it (dictionaries with their strings) and the
 * decoded content of every stream, whether or not anything refers to it.
 */
export async function everythingIn(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      parts.push(object.dict.toString());
      try {
        parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()));
      } catch {
        parts.push(new TextDecoder('latin1').decode(object.contents));
      }
    } else {
      parts.push(object.toString());
    }
  }
  // pdf-lib writes strings as (literal) text or <hex>: decode the hex ones too.
  return parts.join('\n').replace(/<([0-9A-Fa-f]+)>/g, (whole, hex: string) => (hex.length % 2 === 0 ? `${whole}${Buffer.from(hex, 'hex').toString('latin1')}` : whole));
}

/** References reachable from the trailer that point at nothing. */
export async function danglingReferences(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { context } = doc;
  const seen = new Set<PDFRef>();
  const missing: string[] = [];
  const stack: PDFObject[] = [context.trailerInfo.Root, context.trailerInfo.Info].filter((x): x is PDFObject => Boolean(x));
  while (stack.length > 0) {
    const object = stack.pop()!;
    if (object instanceof PDFRef) {
      if (seen.has(object)) continue;
      seen.add(object);
      const target = context.lookup(object);
      if (target === undefined) missing.push(object.toString());
      else stack.push(target);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof PDFArray) {
      stack.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      for (const [, value] of object.dict.entries()) stack.push(value);
    }
  }
  return missing;
}

/** The form fields pdf.js finds in the file, by name, with their values. */
export async function pdfjsFieldValues(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const fields = (await pdf.getFieldObjects()) ?? {};
  await pdf.destroy();
  const out: Record<string, unknown> = {};
  for (const [name, list] of Object.entries(fields)) {
    // A parent field (one that only groups others) has no type of its own.
    const terminal = (list as { value?: unknown; type?: string }[]).find((f) => f.type !== undefined && f.type !== '');
    if (terminal) out[name] = terminal.value;
  }
  return out;
}

/**
 * The text pdf.js draws for the form fields of one page when it paints the page (it builds a
 * field's appearance itself when the file asks for that with /NeedAppearances).
 */
export async function pdfjsDrawnFieldText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const { getDocument, AnnotationMode, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const page = await pdf.getPage(pageNumber);
  const list = await page.getOperatorList({ annotationMode: AnnotationMode.ENABLE });
  let text = '';
  list.fnArray.forEach((fn, i) => {
    if (fn !== OPS.showText) return;
    const glyphs = list.argsArray[i][0] as ({ unicode?: string } | number | null)[];
    for (const glyph of glyphs) if (glyph && typeof glyph === 'object' && glyph.unicode) text += glyph.unicode;
    text += '\n';
  });
  await pdf.destroy();
  return text;
}
