// Test helper only: one PDF with the page kinds marks must be right on. Not imported by production code.
import { degrees, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';

/** The kinds, in page order. */
export const MIXED_PAGES = ['portrait', 'landscape', 'rotate-90', 'cropped', 'unclosed-q', 'user-unit-2'] as const;

/**
 * Six pages: A4 portrait; A4 landscape; A4 portrait with /Rotate 90; 612 x 792 with a CropBox of
 * 364 x 664 away from the origin; a page whose content leaves a `q` open after a `cm`; a 306 x 396 page
 * with /UserUnit 2 (612 x 792 points on paper). Each has a line of text.
 */
export async function makeMixedPagesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = (size: [number, number], label: string) => {
    const page = doc.addPage(size);
    page.drawText(label, { x: 60, y: size[1] - 120, size: 14, font });
    return page;
  };
  text([595.28, 841.89], 'Portrait page');
  text([841.89, 595.28], 'Landscape page');
  text([595.28, 841.89], 'Turned page').setRotation(degrees(90));
  const cropped = doc.addPage([612, 792]);
  cropped.drawText('Cropped page', { x: 150, y: 600, size: 14, font });
  cropped.setCropBox(100, 50, 364, 664);
  for (const [size, content, unit] of [
    [[612, 792], 'BT /F1 12 Tf 100 600 Td (Unbalanced page) Tj ET\n0.5 0 0 0.5 100 100 cm q 1 0 0 1 10 10 cm', 0],
    [[306, 396], 'BT /F1 7 Tf 30 300 Td (User unit page) Tj ET', 2],
  ] as const) {
    const page = doc.addPage([size[0], size[1]]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: doc.context.obj({ F1: font.ref }) }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    if (unit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(unit));
  }
  return doc.save();
}
