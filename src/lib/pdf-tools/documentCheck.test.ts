// Document check (T-064, contract REV): the facts read from one PDF, and the rows the dialog and the report
// show. Every file is invented and built here with pdf-lib: a signed file (an invented /Sig dictionary with
// /Name, /M and /ByteRange), one without /Name, a protected file opened through unlockPdf, a scanned page
// (a full-page image), mixed page sizes, empty and filled properties.
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
  type PDFPage,
} from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { formatBytes } from '@/components/pdf-tools/format';
import { readPlan } from './ocrPlan';
import {
  CheckStopped,
  NAME_NOT_STATED,
  SCANNED_NOTE,
  SIGNATURE_CHECK_NOTE,
  charsIn,
  checkDocument,
  factRows,
  isDocumentFacts,
  plainDate,
  plainPdfDate,
  sizeText,
  type DocumentFacts,
} from './documentCheck';
import { protectPdf } from './protect';
import { unlockPdf } from './unlock';

vi.setConfig({ testTimeout: 60_000 });

const plainSource = (bytes: Uint8Array) => ({ size: bytes.byteLength, wasProtected: false, hasRestrictions: false });

/** Every page has plenty of text. */
const allText = { pageChars: async () => 200 };

async function textPages(doc: PDFDocument, n: number, size: [number, number] = [300, 400]): Promise<PDFPage[]> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages: PDFPage[] = [];
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage(size);
    page.drawText(`Invented ledger page ${i} with enough words to count as text`, { x: 20, y: size[1] / 2, size: 9, font });
    pages.push(page);
  }
  return pages;
}

interface SigSpec {
  name?: string;
  date?: string;
  reason?: string;
  location?: string;
  /** The byte range runs to the end of the file (nothing added after signing). */
  whole?: boolean;
}

/** A PDF with invented signature dictionaries in signature fields (no real certificate: /Contents is zeros). */
async function signedPdf(specs: SigSpec[], pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const [first] = await textPages(doc, pages);
  const { context } = doc;
  const sigs = specs.map((spec) =>
    context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: [0, 10, 20, 30],
      Contents: PDFHexString.of('00'.repeat(64)),
      ...(spec.name !== undefined ? { Name: PDFString.of(spec.name) } : {}),
      ...(spec.date !== undefined ? { M: PDFString.of(spec.date) } : {}),
      ...(spec.reason !== undefined ? { Reason: PDFString.of(spec.reason) } : {}),
      ...(spec.location !== undefined ? { Location: PDFString.of(spec.location) } : {}),
    }),
  );
  const widgets = sigs.map((sig, i) =>
    context.register(
      context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of(`Signature${i + 1}`), V: context.register(sig), Rect: [0, 0, 0, 0], F: 132, P: first.ref }),
    ),
  );
  first.node.set(PDFName.of('Annots'), context.obj(widgets));
  doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: widgets, SigFlags: 3 }));
  let bytes = await doc.save({ useObjectStreams: false });
  const whole = specs.map((s) => s.whole === true);
  if (!whole.some(Boolean)) return bytes;
  // The byte range must end where the file ends; the file's length depends on the numbers written in it.
  for (let round = 0; round < 6; round++) {
    const length = bytes.byteLength;
    sigs.forEach((sig, i) => {
      if (whole[i]) sig.set(PDFName.of('ByteRange'), context.obj([0, 100, 200, length - 200]));
    });
    bytes = await doc.save({ useObjectStreams: false });
    if (bytes.byteLength === length) return bytes;
  }
  throw new Error('byte range did not settle');
}

/** A page with no text, drawn over by one opaque image the size of the page (a scan). */
function addScannedPage(doc: PDFDocument, size: [number, number] = [300, 400]): PDFPage {
  const page = doc.addPage(size);
  const image = doc.context.register(
    doc.context.stream(new Uint8Array([128]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
  );
  page.node.setXObject(PDFName.of('Scan1'), image);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(size[0], 0, 0, size[1], 0, 0), drawObject('Scan1'), popGraphicsState());
  return page;
}

/** Characters per page as pdf.js reads them (the same count the app's reader makes). */
async function pdfjsChars(bytes: Uint8Array): Promise<{ pageChars(i: number): Promise<number>; close(): Promise<void> }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  return {
    pageChars: async (i) => {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      return charsIn(content.items.map((item) => ({ str: 'str' in item ? item.str : '' })));
    },
    close: () => pdf.destroy(),
  };
}

const rowText = (facts: DocumentFacts) =>
  factRows(facts)
    .map((r) => `${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`)
    .join('\n');

const row = (facts: DocumentFacts, label: string) => factRows(facts).find((r) => r.label === label);

describe('plain dates', () => {
  it('reads PDF dates into a plain form and never returns the raw value', () => {
    expect(plainPdfDate("D:20261117140500+05'30'")).toBe('17 November 2026, 14:05 (UTC+05:30)');
    expect(plainPdfDate("D:20261117140500+05'30")).toBe('17 November 2026, 14:05 (UTC+05:30)');
    expect(plainPdfDate('D:20261117140500Z')).toBe('17 November 2026, 14:05 (UTC)');
    expect(plainPdfDate("D:20261117090500-04'00'")).toBe('17 November 2026, 09:05 (UTC-04:00)');
    expect(plainPdfDate('D:20261117140500')).toBe('17 November 2026, 14:05');
    expect(plainPdfDate('D:20261117')).toBe('17 November 2026');
    expect(plainPdfDate('D:202611')).toBe('November 2026');
    expect(plainPdfDate('20260301083000')).toBe('1 March 2026, 08:30');
    expect(plainPdfDate('2026-11-17T14:05:00+05:30')).toBe('17 November 2026, 14:05 (UTC+05:30)');
    expect(plainPdfDate('2026-11-17')).toBe('17 November 2026');
  });

  it('gives null for a date that cannot be read', () => {
    for (const bad of ['', 'yesterday', 'D:2026131714', 'D:20260230', 'D:20261117250000', 'D:20261117146100', 'D:12']) expect(plainPdfDate(bad)).toBeNull();
  });

  it('writes a moment in local time as day, month name, year, hours and minutes', () => {
    expect(plainDate(new Date(2026, 10, 17, 14, 5))).toBe('17 November 2026, 14:05');
    expect(plainDate(new Date(2026, 0, 3, 9, 7))).toBe('3 January 2026, 09:07');
  });
});

describe('small helpers', () => {
  it('counts the characters of text items, leaving out spaces', () => {
    expect(charsIn([{ str: 'Ab c' }, { str: ' \n' }, { str: 'दे' }])).toBe(5);
    expect(charsIn([])).toBe(0);
  });

  it('writes sizes as the rest of PDF Tools does', () => {
    for (const n of [0, 512, 1024, 1536, 10 * 1024 * 1024, 123_456_789, 5 * 1024 ** 3]) expect(sizeText(n)).toBe(formatBytes(n));
  });
});

describe('checkDocument', () => {
  let three: Uint8Array;
  beforeAll(async () => {
    const doc = await PDFDocument.create();
    await textPages(doc, 3);
    three = await doc.save();
  });

  it('counts pages and their sizes, the file size and the PDF version', async () => {
    const facts = await checkDocument(three, plainSource(three), allText);
    expect(facts.pageCount).toBe(3);
    expect(facts.sizeBytes).toBe(three.byteLength);
    expect(facts.pageSizes).toEqual([{ label: '106 × 141 mm', pages: 3 }]);
    expect(facts.pdfVersion).toBe('1.7');
    expect(facts.protection).toBe('none');
    expect(facts.signatures).toEqual([]);
    expect(facts.text).toEqual({ pagesWithText: 3, pagesScanned: 0, pagesEmpty: 0 });
    expect(facts.hasBookmarks).toBe(false);
    expect(facts.hasFormFields).toBe(false);
    expect(facts.hasAttachments).toBe(false);
    expect(isDocumentFacts(facts)).toBe(true);
  });

  it('names paper sizes and their direction as the page is shown, most pages first', async () => {
    const doc = await PDFDocument.create();
    await textPages(doc, 1, [841.89, 595.28]); // A4 landscape
    await textPages(doc, 2, [595.28, 841.89]); // A4 portrait
    await textPages(doc, 1, [612, 792]); // Letter
    const turned = (await textPages(doc, 1, [595.28, 841.89]))[0];
    turned.setRotation(degrees(90)); // shown as A4 landscape
    await textPages(doc, 1, [283.46, 283.46]); // 100 mm square
    const bytes = await doc.save();
    const facts = await checkDocument(bytes, plainSource(bytes), allText);
    expect(facts.pageSizes).toEqual([
      { label: 'A4 landscape', pages: 2 },
      { label: 'A4 portrait', pages: 2 },
      { label: 'Letter portrait', pages: 1 },
      { label: '100 × 100 mm', pages: 1 },
    ]);
    expect(row(facts, 'Page size')?.value).toBe('A4 landscape on 2 pages; A4 portrait on 2 pages; Letter portrait on 1 page; 100 × 100 mm on 1 page');
  });

  it('counts scanned pages exactly as Make searchable plans them: fewer than 20 characters and anything but text drawn (ruling of 18 November 2026)', async () => {
    const doc = await PDFDocument.create();
    await textPages(doc, 1);
    addScannedPage(doc); // a whole-page picture
    doc.addPage([300, 400]); // nothing on it
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 400]).drawText('Page 4', { x: 20, y: 200, size: 9, font }); // text only, under 20 characters: no text, not scanned
    // a small picture in a corner (a tenth of the page): Make searchable recognises it, so it is counted as scanned
    const small = doc.addPage([300, 400]);
    const image = doc.context.register(doc.context.stream(new Uint8Array([90]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    small.node.setXObject(PDFName.of('Small1'), image);
    small.pushOperators(pushGraphicsState(), concatTransformationMatrix(60, 0, 0, 40, 20, 340), drawObject('Small1'), popGraphicsState());
    // a ruled line and nothing else
    doc.addPage([300, 400]).drawLine({ start: { x: 20, y: 200 }, end: { x: 280, y: 200 }, thickness: 1 });
    const bytes = await doc.save();
    const reader = await pdfjsChars(bytes);
    try {
      const facts = await checkDocument(bytes, plainSource(bytes), reader);
      expect(facts.text).toEqual({ pagesWithText: 1, pagesScanned: 3, pagesEmpty: 2 });
      const plan = await readPlan(await PDFDocument.load(bytes, { updateMetadata: false }), reader);
      expect(plan.pages.map((p) => p.kind)).toEqual(['text', 'scanned', 'empty', 'empty', 'scanned', 'scanned']);
      expect(facts.text).toEqual({ pagesWithText: plan.withText, pagesScanned: plan.scanned, pagesEmpty: plan.empty });
      expect(plan.toRecognise).toHaveLength(facts.text.pagesScanned);
      expect(row(facts, 'Pages that look scanned')).toEqual({ label: 'Pages that look scanned', value: '3 pages', note: 'Make it searchable before converting or redacting.' });
    } finally {
      await reader.close();
    }
  });

  it('tells pages with searchable text, pages that look scanned and empty pages apart, with pdf.js counting the text', async () => {
    const doc = await PDFDocument.create();
    await textPages(doc, 1);
    addScannedPage(doc);
    doc.addPage([300, 400]); // nothing on it
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 400]).drawText('Page 4', { x: 20, y: 200, size: 9, font }); // under 20 characters, no image: empty
    addScannedPage(doc).drawText('7', { x: 5, y: 5, size: 6, font }); // a page number on a scan is still a scan
    const bytes = await doc.save();
    const reader = await pdfjsChars(bytes);
    try {
      const facts = await checkDocument(bytes, plainSource(bytes), reader);
      expect(facts.text).toEqual({ pagesWithText: 1, pagesScanned: 2, pagesEmpty: 2 });
      expect(row(facts, 'Searchable text')?.value).toBe('On 1 of 5 pages');
      expect(row(facts, 'Pages that look scanned')).toEqual({ label: 'Pages that look scanned', value: '2 pages', note: SCANNED_NOTE });
      expect(SCANNED_NOTE).toBe('Make it searchable before converting or redacting.');
      expect(row(facts, 'Pages with no text')?.value).toBe('2 pages');
    } finally {
      await reader.close();
    }
  });

  it('counts a page whose text cannot be read as not read, and says so', async () => {
    const facts = await checkDocument(three, plainSource(three), { pageChars: async (i) => (i === 1 ? Promise.reject(new Error('worker gone')) : 300) });
    expect(facts.text).toEqual({ pagesWithText: 2, pagesScanned: 0, pagesEmpty: 0 });
    expect(row(facts, 'Pages not read')?.value).toBe('1 page');
  });

  it('reads each signature as the file states it, and never calls it valid', async () => {
    const bytes = await signedPdf([
      { name: 'Signer Alpha Example', date: "D:20261117140500+05'30'", reason: 'Approved for filing', location: 'Test City' },
      { date: 'D:20261118' },
    ]);
    const facts = await checkDocument(bytes, plainSource(bytes), allText);
    expect(facts.signatures).toEqual([
      { signer: 'Signer Alpha Example', signedOn: '17 November 2026, 14:05 (UTC+05:30)', reason: 'Approved for filing', location: 'Test City', coversWholeFile: false },
      { signer: null, signedOn: '18 November 2026', reason: null, location: null, coversWholeFile: false },
    ]);
    const text = rowText(facts);
    expect(text).toContain('Digital signatures: 2 signatures');
    expect(text).toContain(SIGNATURE_CHECK_NOTE);
    expect(SIGNATURE_CHECK_NOTE).toBe('Open the file in Adobe Acrobat Reader to verify the signature.');
    expect(row(facts, 'Signature 1')?.value).toBe('Signed by Signer Alpha Example on 17 November 2026, 14:05 (UTC+05:30). Reason: Approved for filing. Location: Test City.');
    expect(row(facts, 'Signature 2')?.value).toBe(`${NAME_NOT_STATED}; signed on 18 November 2026.`);
    expect(NAME_NOT_STATED).toBe('Name not stated in the file');
    expect(text).not.toMatch(/valid/i);
    expect(text).not.toContain('D:2026');
  });

  it('says whether a signature covers the whole file', async () => {
    const whole = await signedPdf([{ name: 'Signer Beta Example', whole: true }]);
    const facts = await checkDocument(whole, plainSource(whole), allText);
    expect(facts.signatures[0].coversWholeFile).toBe(true);
    expect(row(facts, 'Signature 1')?.note).toBeUndefined();
    expect(row(facts, 'Signature 1')?.value).toBe('Signed by Signer Beta Example; no readable date in the file.');

    const added = await signedPdf([{ name: 'Signer Beta Example' }]);
    const later = await checkDocument(added, plainSource(added), allText);
    expect(later.signatures[0].coversWholeFile).toBe(false);
    expect(row(later, 'Signature 1')?.note).toBe('The file was added to after this signature, for example by another signature or a change.');
  });

  it('finds a signature dictionary that is not in a form field, and an empty signature field is no signature', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const [page] = await textPages(doc, 1);
    const { context } = doc;
    context.register(context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of('00'), Name: PDFString.of('Signer Gamma Example') }));
    const empty = context.register(context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Unsigned'), Rect: [0, 0, 10, 10], P: page.ref }));
    page.node.set(PDFName.of('Annots'), context.obj([empty]));
    doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [empty] }));
    const bytes = await doc.save({ useObjectStreams: false });
    const facts = await checkDocument(bytes, plainSource(bytes), allText);
    expect(facts.signatures.map((s) => s.signer)).toEqual(['Signer Gamma Example']);
    expect(facts.hasFormFields).toBe(false); // a signature field is not a field to fill in
  });

  it('reports a file opened with its password, and one with restrictions, without judging signatures it cannot see', async () => {
    const password = 'Invented-Pass-4821';
    const locked = await protectPdf(three, password);
    const unlocked = await unlockPdf(locked, password);
    const facts = await checkDocument(unlocked, { size: locked.byteLength, wasProtected: true, hasRestrictions: false }, allText);
    expect(facts.protection).toBe('password');
    expect(facts.pageCount).toBe(3);
    expect(facts.sizeBytes).toBe(locked.byteLength);
    expect(row(facts, 'Protection')).toEqual({ label: 'Protection', value: 'Opened with its password', note: 'The copy in this list has no password; the original file still has one.' });

    const restricted = await checkDocument(three, { size: three.byteLength, wasProtected: true, hasRestrictions: true }, allText);
    expect(restricted.protection).toBe('restrictions');
    expect(row(restricted, 'Protection')?.value).toBe('Restrictions, for example on copying or printing');

    const signed = await signedPdf([{ name: 'Signer Delta Example' }]);
    const unlockedSigned = await checkDocument(signed, { size: signed.byteLength, wasProtected: true, hasRestrictions: false }, allText);
    expect(row(unlockedSigned, 'Signature 1')?.note).toBeUndefined();
    expect(row(await checkDocument(three, plainSource(three), allText), 'Protection')?.value).toBe('No password or restrictions');
  });

  it('reads the properties and dates, and says when they are empty', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    await textPages(doc, 1);
    const empty = await doc.save();
    const none = await checkDocument(empty, plainSource(empty), allText);
    expect(none.properties).toEqual({ title: null, author: null, subject: null, keywords: null, creator: null, producer: null, created: null, modified: null });
    expect(row(none, 'Title')?.value).toBe('Not filled in');
    expect(row(none, 'Author')?.value).toBe('Not filled in');
    expect(row(none, 'Created')?.value).toBe('Not stated in the file');
    expect(row(none, 'Last changed')?.value).toBe('Not stated in the file');
    expect(row(none, 'Subject')).toBeUndefined();
    expect(row(none, 'Created with')).toBeUndefined();

    doc.setTitle('Invented Trial Balance FY 2025-26');
    doc.setAuthor('Invented Accounts Team');
    doc.setSubject('Year end');
    doc.setKeywords(['ledger', 'draft']);
    doc.setCreator('Invented Writer 3');
    doc.setProducer('Invented Producer 9');
    const info = doc.context.lookup(doc.context.trailerInfo.Info) as unknown as { set(k: PDFName, v: PDFString): void };
    info.set(PDFName.of('CreationDate'), PDFString.of("D:20260401093000+05'30'"));
    info.set(PDFName.of('ModDate'), PDFString.of('D:20261117140500Z'));
    const filled = await doc.save();
    const facts = await checkDocument(filled, plainSource(filled), allText);
    expect(facts.properties).toEqual({
      title: 'Invented Trial Balance FY 2025-26',
      author: 'Invented Accounts Team',
      subject: 'Year end',
      keywords: 'ledger draft',
      creator: 'Invented Writer 3',
      producer: 'Invented Producer 9',
      created: '1 April 2026, 09:30 (UTC+05:30)',
      modified: '17 November 2026, 14:05 (UTC)',
    });
    expect(row(facts, 'Created')?.value).toBe('1 April 2026, 09:30 (UTC+05:30)');
    expect(row(facts, 'Created with')?.value).toBe('Invented Writer 3');
    expect(row(facts, 'PDF produced by')?.value).toBe('Invented Producer 9');
    expect(rowText(facts)).not.toContain('D:2026');
  });

  it('reads the properties from the XMP metadata when the document information has none', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    await textPages(doc, 1);
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Invented &amp; XMP Title</rdf:li></rdf:Alt></dc:title>' +
      '<dc:creator><rdf:Seq><rdf:li>Invented XMP Author</rdf:li></rdf:Seq></dc:creator>' +
      '<xmp:CreateDate>2026-03-01T08:30:00+05:30</xmp:CreateDate><pdf:Producer>Invented XMP Producer</pdf:Producer>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta>';
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.flateStream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })));
    const bytes = await doc.save();
    const facts = await checkDocument(bytes, plainSource(bytes), allText);
    expect(facts.properties.title).toBe('Invented & XMP Title');
    expect(facts.properties.author).toBe('Invented XMP Author');
    expect(facts.properties.producer).toBe('Invented XMP Producer');
    expect(facts.properties.created).toBe('1 March 2026, 08:30 (UTC+05:30)');
  });

  it('notices bookmarks, form fields and attachments', async () => {
    const doc = await PDFDocument.create();
    const [page] = await textPages(doc, 2);
    const field = doc.getForm().createTextField('invented_balance');
    field.addToPage(page, { x: 20, y: 300, width: 100, height: 20 });
    await doc.attach(new TextEncoder().encode('invented note'), 'note.txt', { mimeType: 'text/plain' });
    const outlines = doc.context.register(doc.context.obj({ Type: 'Outlines' }));
    const item = doc.context.register(doc.context.obj({ Title: PDFString.of('Invented chapter'), Parent: outlines, Dest: [page.ref, PDFName.of('Fit')] }));
    const outlineDict = doc.context.lookup(outlines) as unknown as { set(k: PDFName, v: unknown): void };
    outlineDict.set(PDFName.of('First'), item);
    outlineDict.set(PDFName.of('Last'), item);
    doc.catalog.set(PDFName.of('Outlines'), outlines);
    const bytes = await doc.save();
    const facts = await checkDocument(bytes, plainSource(bytes), allText);
    expect(facts.hasBookmarks).toBe(true);
    expect(facts.hasFormFields).toBe(true);
    expect(facts.hasAttachments).toBe(true);
    expect(row(facts, 'Bookmarks')?.value).toBe('Yes');
    expect(row(facts, 'Form fields')?.value).toBe('Yes');
    expect(row(facts, 'Attachments')).toEqual({ label: 'Attachments', value: 'Yes', note: 'Files are attached inside this PDF. Open it in a PDF reader to see them.' });
  });

  it('reports progress page by page and stops when asked, giving the window turns', async () => {
    const doc = await PDFDocument.create();
    await textPages(doc, 6);
    const bytes = await doc.save();
    const seen: string[] = [];
    await checkDocument(bytes, plainSource(bytes), allText, { onPage: (done, total) => seen.push(`${done}/${total}`) });
    expect(seen).toEqual(['0/6', '1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);

    const controller = new AbortController();
    const read: number[] = [];
    const stopping = checkDocument(
      bytes,
      plainSource(bytes),
      {
        pageChars: async (i) => {
          read.push(i);
          if (i === 2) controller.abort();
          return 100;
        },
      },
      { signal: controller.signal },
    );
    await expect(stopping).rejects.toBeInstanceOf(CheckStopped);
    expect(read).toEqual([0, 1, 2]);

    const already = new AbortController();
    already.abort();
    await expect(checkDocument(bytes, plainSource(bytes), allText, { signal: already.signal })).rejects.toBeInstanceOf(CheckStopped);
  });

  it('passes on what onPage throws (a run that was stopped or moved on)', async () => {
    class Moved extends Error {}
    await expect(
      checkDocument(three, plainSource(three), allText, {
        onPage: (done) => {
          if (done === 1) throw new Moved();
        },
      }),
    ).rejects.toBeInstanceOf(Moved);
  });

  it('refuses bytes that are not a PDF with a plain message', async () => {
    await expect(checkDocument(new TextEncoder().encode('not a pdf at all'), { size: 16, wasProtected: false, hasRestrictions: false }, allText)).rejects.toMatchObject({
      message: expect.stringMatching(/could not be read/),
    });
  });
});

describe('factRows', () => {
  const base: DocumentFacts = {
    pageCount: 12,
    sizeBytes: 1_258_291,
    pageSizes: [{ label: 'A4 portrait', pages: 12 }],
    protection: 'none',
    signatures: [],
    text: { pagesWithText: 12, pagesScanned: 0, pagesEmpty: 0 },
    properties: { title: null, author: null, subject: null, keywords: null, creator: null, producer: null, created: null, modified: null },
    pdfVersion: '1.7',
    hasBookmarks: false,
    hasFormFields: false,
    hasAttachments: false,
  };

  it('lists the facts in a fixed order, with notes only where one is needed', () => {
    expect(factRows(base)).toEqual([
      { label: 'Pages', value: '12' },
      { label: 'Page size', value: 'A4 portrait' },
      { label: 'File size', value: '1.2 MB' },
      { label: 'Protection', value: 'No password or restrictions' },
      { label: 'Digital signatures', value: 'None' },
      { label: 'Searchable text', value: 'On all 12 pages' },
      { label: 'Title', value: 'Not filled in' },
      { label: 'Author', value: 'Not filled in' },
      { label: 'Created', value: 'Not stated in the file' },
      { label: 'Last changed', value: 'Not stated in the file' },
      { label: 'PDF version', value: '1.7' },
      { label: 'Bookmarks', value: 'No' },
      { label: 'Form fields', value: 'No' },
      { label: 'Attachments', value: 'No' },
    ]);
  });

  it('says plainly when no page has text, and shortens a very long property', () => {
    const scanned = factRows({ ...base, pageCount: 1, text: { pagesWithText: 0, pagesScanned: 1, pagesEmpty: 0 }, properties: { ...base.properties, keywords: 'k'.repeat(500) } });
    expect(scanned.find((r) => r.label === 'Searchable text')?.value).toBe('On no page');
    expect(scanned.find((r) => r.label === 'Pages that look scanned')?.value).toBe('1 page');
    const keywords = scanned.find((r) => r.label === 'Keywords')!.value;
    expect(keywords.length).toBeLessThanOrEqual(300);
    expect(keywords.endsWith('…')).toBe(true);
  });

  it('lists only the first few page sizes and counts the rest', () => {
    const sizes = ['A4 portrait', 'A4 landscape', 'A3 portrait', 'Letter portrait', '100 × 100 mm', '90 × 50 mm'].map((label) => ({ label, pages: 2 }));
    expect(factRows({ ...base, pageSizes: sizes }).find((r) => r.label === 'Page size')?.value).toBe(
      'A4 portrait on 2 pages; A4 landscape on 2 pages; A3 portrait on 2 pages; Letter portrait on 2 pages; 2 other sizes on 4 pages',
    );
  });

  it('removes control characters from what the file states', () => {
    const facts = { ...base, signatures: [{ signer: 'Signer\u0000 Eps\u0007ilon', signedOn: null, reason: 'Line\none', location: null, coversWholeFile: true }] };
    expect(factRows(facts).find((r) => r.label === 'Signature 1')?.value).toBe('Signed by Signer Epsilon; no readable date in the file. Reason: Line one.');
  });
});

describe('isDocumentFacts', () => {
  it('accepts only the full shape', async () => {
    const doc = await PDFDocument.create();
    await textPages(doc, 1);
    const bytes = await doc.save();
    const facts = await checkDocument(bytes, plainSource(bytes), allText);
    expect(isDocumentFacts(facts)).toBe(true);
    expect(isDocumentFacts(null)).toBe(false);
    expect(isDocumentFacts({ ...facts, pageCount: '1' })).toBe(false);
    expect(isDocumentFacts({ ...facts, protection: 'strong' })).toBe(false);
    expect(isDocumentFacts({ ...facts, signatures: [{ signer: 1 }] })).toBe(false);
    expect(isDocumentFacts({ ...facts, properties: { ...facts.properties, title: 3 } })).toBe(false);
    expect(isDocumentFacts({ ...facts, text: { pagesWithText: -1, pagesScanned: 0, pagesEmpty: 0 } })).toBe(false);
  });
});
