import { deflateSync } from 'node:zlib';
import { PDFDocument as CantooDocument } from '@cantoo/pdf-lib';
import { PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from './inspect';
import { deletePages, extractPages, mergePdfs } from './organise';
import { makeFormPdf, makePdf } from './testPdf';
import { unlockPdf } from './unlock';

/** What a copy carries when it has no comments, no attachments and no document properties filled in. */
const NOTHING_CARRIED = { comments: 0, attachments: 0, properties: [] };

/** What a file with no form, no bookmarks, no links and no attachments reports. */
const PLAIN = { hasFormFields: false, hasBookmarks: false, hasPageLinks: false, hasAttachments: false, carried: NOTHING_CARRIED } as const;

vi.setConfig({ testTimeout: 20_000 });

beforeAll(async () => {
  await import('@cantoo/pdf-lib'); // pay the cold import once
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** A password-protected copy made with @cantoo/pdf-lib (synthetic content; only bytes cross between the libraries). */
async function makeProtected(classicXref: boolean): Promise<Uint8Array> {
  const doc = await CantooDocument.load(await makePdf('A', 3), { updateMetadata: false });
  doc.encrypt({ userPassword: 'Test@123', algorithm: 'AES-128' });
  return doc.save({ useObjectStreams: !classicXref });
}

/** The file up to its trailer: a classic xref table without `trailer`, or everything before the cross-reference stream. */
function cutBeforeTrailer(bytes: Uint8Array): Uint8Array {
  const raw = latin1(bytes);
  const trailer = raw.lastIndexOf('trailer');
  const cut = trailer > 0 ? trailer : raw.lastIndexOf('\n', raw.lastIndexOf(' obj', raw.lastIndexOf('/Type /XRef'))) + 1;
  return bytes.slice(0, cut);
}

/**
 * Appends a cross-reference stream section with no /Encrypt and no /Root, as the main cross-reference
 * stream of a linearised ("Fast Web View") file has: there those entries sit only in the first-page
 * section. pdf-lib 1.17.1 lets the last cross-reference stream it reads replace the whole trailer.
 */
function appendBareXRefStream(bytes: Uint8Array): Uint8Array {
  const raw = latin1(bytes);
  const sizes = [...raw.matchAll(/\/Size (\d+)/g)];
  const n = Number(sizes[sizes.length - 1][1]);
  const head = new TextEncoder().encode(`\n${n} 0 obj\n<< /Type /XRef /Size ${n + 1} /W [ 1 2 2 ] /Index [ ${n} 1 ] /Length 5 >>\nstream\n`);
  const entry = Uint8Array.of(0, 0, 0, 0xff, 0xff); // one free entry
  const tail = new TextEncoder().encode(`\nendstream\nendobj\nstartxref\n${bytes.length + 1}\n%%EOF\n`);
  const out = new Uint8Array(bytes.length + head.length + entry.length + tail.length);
  out.set(bytes);
  out.set(head, bytes.length);
  out.set(entry, bytes.length + head.length);
  out.set(tail, bytes.length + head.length + entry.length);
  return out;
}

/** An unprotected file holding an unused security dictionary (as some unlocking tools leave behind). */
async function withUnusedSecurityDictionary(useObjectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf('A', 2));
  const hex = PDFHexString.of('00'.repeat(32));
  doc.context.register(doc.context.obj({ Filter: 'Standard', V: 2, R: 3, O: hex, U: hex, P: -4 }));
  return doc.save({ useObjectStreams });
}

async function makeSignedLike(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  const sigField = doc.context.obj({ FT: 'Sig', T: 'Signature1', Type: 'Annot', Subtype: 'Widget' });
  const sigRef = doc.context.register(sigField);
  const acroForm = doc.context.obj({ SigFlags: PDFNumber.of(3), Fields: [sigRef] });
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acroForm));
  return doc.save();
}

describe('inspectPdf', () => {
  it('reports page count for a plain PDF', async () => {
    expect(await inspectPdf(await makePdf('A', 3))).toEqual({ encrypted: false, pageCount: 3, hasSignature: false, ...PLAIN });
  });
  it('rejects empty input', async () => {
    await expect(inspectPdf(new Uint8Array())).rejects.toMatchObject({ code: 'empty-file' });
  });
  it('rejects non-PDF input', async () => {
    await expect(inspectPdf(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'not-a-pdf' });
  });
  it('rejects a truncated PDF', async () => {
    const whole = await makePdf('A', 3);
    await expect(inspectPdf(whole.slice(0, 200))).rejects.toMatchObject({ code: 'not-a-pdf' });
  });
  it('detects a digital signature field', async () => {
    expect((await inspectPdf(await makeSignedLike())).hasSignature).toBe(true);
  });
  it('detects a signature by /ByteRange when there is no AcroForm', async () => {
    const plain = await makePdf('A', 1);
    const marker = new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n');
    const bytes = new Uint8Array(plain.length + marker.length);
    bytes.set(plain);
    bytes.set(marker, plain.length);
    expect((await inspectPdf(bytes)).hasSignature).toBe(true);
  });
  it('reports a protected file as encrypted', async () => {
    for (const classicXref of [true, false]) {
      expect(await inspectPdf(await makeProtected(classicXref))).toEqual({ encrypted: true, pageCount: null, hasSignature: false, ...PLAIN });
    }
  });
  it('rejects a protected file whose trailer is cut off, instead of reporting it unprotected', async () => {
    for (const classicXref of [true, false]) {
      const whole = await makeProtected(classicXref);
      const cuts = [cutBeforeTrailer(whole)];
      if (classicXref) cuts.push(whole.slice(0, Math.floor(whole.length * 0.98)));
      for (const bytes of cuts) await expect(inspectPdf(bytes)).rejects.toMatchObject({ code: 'not-a-pdf' });
    }
  });
  it('still opens an unprotected file whose trailer is cut off, as today', async () => {
    const classic = await (await PDFDocument.load(await makePdf('A', 3))).save({ useObjectStreams: false });
    expect(await inspectPdf(cutBeforeTrailer(classic))).toEqual({ encrypted: false, pageCount: 3, hasSignature: false, ...PLAIN });
  });
  it('still opens an unprotected file that keeps an unused security dictionary but has its trailer', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 2));
    const hex = PDFHexString.of('00'.repeat(32));
    doc.context.register(doc.context.obj({ Filter: 'Standard', V: 2, R: 3, O: hex, U: hex, P: -4 }));
    for (const useObjectStreams of [true, false]) {
      expect(await inspectPdf(await doc.save({ useObjectStreams }))).toEqual({ encrypted: false, pageCount: 2, hasSignature: false, ...PLAIN });
    }
  });
  it('does not take "/Encrypt n g R" text inside a content stream for an /Encrypt entry', async () => {
    // An unprotected file with an unused security dictionary (object 5 here is not it) and the literal text
    // in an uncompressed content stream, which a plain search for the text would find.
    const doc = await PDFDocument.load(await makePdf('A', 2));
    const hex = PDFHexString.of('00'.repeat(32));
    const security = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 2, R: 3, O: hex, U: hex, P: -4 }));
    expect(security.objectNumber).not.toBe(5); // "/Encrypt 5 0 R" below must not name the security dictionary
    const note = doc.context.stream('BT /F1 9 Tf 10 10 Td (see /Encrypt 5 0 R and /Encrypt 1 0 R) Tj ET');
    doc.getPage(0).node.set(PDFName.of('Contents'), doc.context.obj([doc.getPage(0).node.get(PDFName.of('Contents')), doc.context.register(note)]));
    for (const useObjectStreams of [true, false]) {
      const bytes = await doc.save({ useObjectStreams });
      expect(latin1(bytes)).toContain('/Encrypt 5 0 R');
      expect(await inspectPdf(bytes)).toEqual({ encrypted: false, pageCount: 2, hasSignature: false, ...PLAIN });
    }
  });
  it('does not take "/Encrypt << ..." text inside a content stream for an /Encrypt entry', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 2));
    const hex = PDFHexString.of('00'.repeat(32));
    doc.context.register(doc.context.obj({ Filter: 'Standard', V: 2, R: 3, O: hex, U: hex, P: -4 }));
    const note = doc.context.stream('BT /F1 9 Tf 10 10 Td (/Encrypt << /Filter /Standard >>) Tj ET');
    doc.getPage(0).node.set(PDFName.of('Contents'), doc.context.obj([doc.getPage(0).node.get(PDFName.of('Contents')), doc.context.register(note)]));
    for (const useObjectStreams of [true, false]) {
      const bytes = await doc.save({ useObjectStreams });
      expect(latin1(bytes)).toContain('/Encrypt << /Filter /Standard >>');
      expect(await inspectPdf(bytes)).toEqual({ encrypted: false, pageCount: 2, hasSignature: false, ...PLAIN });
    }
  });
  it('still detects an inline /Encrypt dictionary after a word that merely contains "stream"', async () => {
    // The first cross-reference stream dictionary names /Encrypt inline and, ahead of it, a title containing "Upstream";
    // a later bare cross-reference stream hides it from pdf-lib, as in a linearised file.
    const raw = latin1(await makeProtected(false));
    const swapped = raw.replace(/\/Encrypt \d+ \d+ R/, '/Title (Upstream) /Encrypt << /Filter /Standard >>');
    expect(swapped).not.toBe(raw);
    const locked = appendBareXRefStream(Uint8Array.from(Buffer.from(swapped, 'latin1')));
    expect(await inspectPdf(locked)).toEqual({ encrypted: true, pageCount: null, hasSignature: false, ...PLAIN });
  });
  it('reports a protected linearised-style file (a last cross-reference stream without /Encrypt) as encrypted', async () => {
    const locked = appendBareXRefStream(await makeProtected(false));
    expect(await inspectPdf(locked)).toEqual({ encrypted: true, pageCount: null, hasSignature: false, ...PLAIN });
    expect(await inspectPdf(await unlockPdf(locked, 'Test@123'))).toEqual({ encrypted: false, pageCount: 3, hasSignature: false, ...PLAIN });
  });
  it('keeps unprotected files with extra cross-reference streams or unused security dictionaries unprotected', async () => {
    const controls: [string, Uint8Array, number][] = [
      ['unlocked output', await unlockPdf(await makeProtected(false), 'Test@123'), 3],
      ['unlocked output with a second cross-reference stream', appendBareXRefStream(await unlockPdf(await makeProtected(false), 'Test@123')), 3],
      ['unused security dictionary, object streams', await withUnusedSecurityDictionary(true), 2],
      ['unused security dictionary, classic xref', await withUnusedSecurityDictionary(false), 2],
      ['second cross-reference stream', appendBareXRefStream(await makePdf('A', 2)), 2],
      ['second cross-reference stream and unused security dictionary', appendBareXRefStream(await withUnusedSecurityDictionary(true)), 2],
    ];
    for (const [label, bytes, pageCount] of controls) {
      expect({ label, info: await inspectPdf(bytes) }).toEqual({ label, info: { encrypted: false, pageCount, hasSignature: false, ...PLAIN } });
    }
  });
  it('rejects a protected file cut off before its security dictionary (no trailer, contents still encrypted)', async () => {
    const whole = await makeProtected(true);
    const raw = latin1(whole);
    const securityAt = raw.indexOf('/Filter /Standard');
    const securityObject = raw.lastIndexOf('\n', raw.lastIndexOf(' obj', securityAt)) + 1;
    const afterSecurity = raw.indexOf('endobj', securityAt) + 'endobj'.length;
    const cuts = [securityObject, securityObject - 1, Math.floor(securityObject * 0.97), afterSecurity, raw.lastIndexOf('\nxref') + 1];
    for (const cut of cuts) {
      await expect(inspectPdf(whole.slice(0, cut)), `cut at ${cut} of ${whole.length}`).rejects.toMatchObject({ code: 'not-a-pdf' });
    }
  });
  it('still opens an unprotected object-stream file whose cross-reference stream is cut off', async () => {
    expect(await inspectPdf(cutBeforeTrailer(await makePdf('A', 3)))).toEqual({ encrypted: false, pageCount: 3, hasSignature: false, ...PLAIN });
  });
  it('rejects a file with a PDF header but no document in it', async () => {
    await expect(inspectPdf(new TextEncoder().encode('%PDF-1.7\nnot really'))).rejects.toMatchObject({ code: 'not-a-pdf' });
  });
  it('reports form fields, bookmarks and links between pages', async () => {
    expect(await inspectPdf(await makeFormPdf())).toMatchObject({ hasFormFields: true, hasBookmarks: false, hasPageLinks: false });
    expect(await inspectPdf(await makeFormPdf({ bookmarks: true, links: true }))).toMatchObject({ hasFormFields: true, hasBookmarks: true, hasPageLinks: true });
    // a result of Split keeps the form of its pages and, from phase 2 (design 5.3), the bookmarks of the pages it keeps
    expect(await inspectPdf(await extractPages(await makeFormPdf({ bookmarks: true, links: true }), [0, 1]))).toMatchObject({ hasFormFields: true, hasBookmarks: true, hasPageLinks: true });
  });
  it('does not count a signature field, an empty form or an empty outline', async () => {
    expect(await inspectPdf(await makeSignedLike())).toMatchObject({ hasSignature: true, ...PLAIN });
    const doc = await PDFDocument.load(await makePdf('A', 2));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(doc.context.obj({ Fields: [] })));
    doc.catalog.set(PDFName.of('Outlines'), doc.context.register(doc.context.obj({ Type: 'Outlines', Count: 0 })));
    expect(await inspectPdf(await doc.save())).toMatchObject(PLAIN);
  });
  it('counts a field nested under a parent, and a field whose signature type is not its own', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 1));
    const form = doc.getForm();
    form.createTextField('group.inner').addToPage(doc.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
    expect(await inspectPdf(await doc.save())).toMatchObject({ hasFormFields: true });
    // A parent that is a signature field: its unnamed child widget inherits the type.
    const signed = await PDFDocument.load(await makePdf('A', 1));
    const widget = signed.context.nextRef();
    const field = signed.context.register(signed.context.obj({ FT: 'Sig', T: PDFHexString.fromText('Sig'), Kids: [widget] }));
    signed.context.assign(widget, signed.context.obj({ Type: 'Annot', Subtype: 'Widget', Parent: field, Rect: [0, 0, 10, 10] }));
    signed.catalog.set(PDFName.of('AcroForm'), signed.context.register(signed.context.obj({ Fields: [field] })));
    expect(await inspectPdf(await signed.save())).toMatchObject({ hasFormFields: false });
  });
  it('does not count push buttons as fields that hold values', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 1));
    doc.getForm().createButton('print').addToPage('Print', doc.getPage(0));
    expect(await inspectPdf(await doc.save())).toMatchObject({ hasFormFields: false });
    doc.getForm().createCheckBox('agree').addToPage(doc.getPage(0), { x: 10, y: 10, width: 10, height: 10 });
    expect(await inspectPdf(await doc.save())).toMatchObject({ hasFormFields: true });
  });
  it('reports a link that goes through an action to a page, but not a web link', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 2));
    const web = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'URI', URI: PDFHexString.fromText('https://example.invalid') } }));
    doc.getPage(0).node.addAnnot(web);
    expect(await inspectPdf(await doc.save())).toMatchObject({ hasPageLinks: false });
    const goTo = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'GoTo', D: [doc.getPage(1).ref, 'Fit'] } }));
    doc.getPage(0).node.addAnnot(goTo);
    expect(await inspectPdf(await doc.save())).toMatchObject({ hasPageLinks: true });
  });
  it("reports attachments in the document's list (its embedded-files name tree), which Split, Delete pages and Merge do not carry", async () => {
    const doc = await PDFDocument.load(await makePdf('A', 3));
    await doc.attach(new TextEncoder().encode('synthetic attachment body'), 'notes.txt', { mimeType: 'text/plain', description: 'synthetic' });
    const attached = await doc.save();
    expect(await inspectPdf(attached)).toMatchObject({ hasAttachments: true, hasFormFields: false, hasBookmarks: false, hasPageLinks: false });
    expect(await inspectPdf(await extractPages(attached, [0, 1]))).toMatchObject({ hasAttachments: false });
    expect(await inspectPdf(await deletePages(attached, [0]))).toMatchObject({ hasAttachments: false });
    expect(await inspectPdf(await mergePdfs([attached, await makePdf('B', 1)]))).toMatchObject({ hasAttachments: false });
  });
  it('finds an attachment down the name tree, but not in an empty tree', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 1));
    const { context } = doc;
    const spec = context.register(context.obj({ Type: 'Filespec', F: PDFHexString.fromText('a.txt') }));
    const leaf = context.register(context.obj({ Limits: [PDFHexString.fromText('a.txt'), PDFHexString.fromText('a.txt')], Names: [PDFHexString.fromText('a.txt'), spec] }));
    const middle = context.register(context.obj({ Kids: [leaf] }));
    const names = context.register(context.obj({ EmbeddedFiles: context.obj({ Kids: [middle] }) }));
    doc.catalog.set(PDFName.of('Names'), names);
    expect(await inspectPdf(await doc.save())).toMatchObject({ hasAttachments: true });
    const empty = await PDFDocument.load(await makePdf('A', 1));
    empty.catalog.set(PDFName.of('Names'), empty.context.register(empty.context.obj({ EmbeddedFiles: empty.context.obj({ Names: [] }) })));
    expect(await inspectPdf(await empty.save())).toMatchObject({ hasAttachments: false });
    const loop = await PDFDocument.load(await makePdf('A', 1));
    const self = loop.context.nextRef();
    loop.context.assign(self, loop.context.obj({ Kids: [self] }));
    loop.catalog.set(PDFName.of('Names'), loop.context.register(loop.context.obj({ EmbeddedFiles: self })));
    expect(await inspectPdf(await loop.save())).toMatchObject({ hasAttachments: false });
  });
  it('counts what a copy still carries: comments that hold text, attachments, and the document properties filled in', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 2));
    const { context } = doc;
    const annot = (page: number, fields: Record<string, unknown>) =>
      doc.getPage(page).node.addAnnot(context.register(context.obj({ Type: 'Annot', Rect: [10, 10, 40, 40], ...fields } as never)));
    annot(0, { Subtype: 'Text', Contents: PDFHexString.fromText('Synthetic reviewer note') });
    annot(1, { Subtype: 'FreeText', Contents: PDFHexString.fromText('Synthetic typed comment') });
    annot(1, { Subtype: 'Highlight' }); // a mark with no text
    annot(1, { Subtype: 'Square', Contents: PDFHexString.fromText('   ') }); // only spaces
    annot(0, { Subtype: 'Link', Contents: PDFHexString.fromText('not a comment') });
    annot(0, { Subtype: 'Popup', Contents: PDFHexString.fromText('the note again, in its window') });
    annot(0, { Subtype: 'Widget', FT: 'Tx', T: PDFHexString.fromText('field'), Contents: PDFHexString.fromText('a form field') });
    annot(1, { Subtype: 'FileAttachment', Contents: PDFHexString.fromText('Synthetic workings'), FS: context.obj({ Type: 'Filespec', F: PDFHexString.fromText('w.txt') }) });
    await doc.attach(new TextEncoder().encode('synthetic attachment body'), 'notes.txt', { mimeType: 'text/plain' });
    doc.setTitle('Synthetic title');
    doc.setAuthor('Synthetic author');
    doc.setSubject('   ');
    const info = await inspectPdf(await doc.save());
    expect(info.carried).toEqual({ comments: 2, attachments: 2, properties: ['title', 'author'] });
  });
  it('counts the document properties kept only in its XMP metadata, and never reads their values out', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 1));
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Keywords="synthetic, draft">' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Synthetic XMP title</rdf:li></rdf:Alt></dc:title>' +
      '<dc:creator><rdf:Seq><rdf:li> </rdf:li></rdf:Seq></dc:creator>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta>';
    const stream = doc.context.flateStream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
    const info = await inspectPdf(await doc.save());
    expect(info.carried).toEqual({ comments: 0, attachments: 0, properties: ['title', 'keywords'] });
    expect(JSON.stringify(info)).not.toContain('Synthetic XMP title');
  });
  it('reports nothing carried for a protected file it cannot read', async () => {
    expect((await inspectPdf(await makeProtected(false))).carried).toEqual(NOTHING_CARRIED);
  });
  it('does not mutate the input', async () => {
    const bytes = await makePdf('A', 2);
    const before = bytes.slice();
    await inspectPdf(bytes);
    expect(bytes).toEqual(before);
  });
});

// ---- hostile files: one pass over the bytes, and a page tree that ends (REV-A B1, S2) --------------

/** A PDF written by hand: objects 1..n in order, a classic cross-reference table and trailer. */
function rawPdf(objects: string[], between: string[] = []): Uint8Array {
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    out += between[i] ?? '';
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

const ONE_PAGE = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>'];
/** Object 4: an unused security dictionary, which makes inspectPdf look through the bytes for an /Encrypt entry. */
const UNUSED_SECURITY = '<< /Filter /Standard /O (x) /U (y) >>';
const streamObject = (body: string) => `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;

/** This thread's processor time for `work`, in ms: on a busy machine the clock also counts other work. */
async function processorTime(work: () => Promise<unknown>): Promise<{ outcome: unknown; ms: number }> {
  const since = process.threadCpuUsage();
  let outcome: unknown;
  try {
    outcome = await work();
  } catch (error) {
    outcome = error;
  }
  const used = process.threadCpuUsage(since);
  return { outcome, ms: (used.user + used.system) / 1000 };
}

/**
 * The rule before REV-A B1, kept here as the reference: an /Encrypt followed by `<<` counts unless it lies
 * in a stream body, each position checked by walking the bodies from the start of the file; one followed
 * by `n g R` counts when it names the security dictionary (object 4 in these files).
 */
function namesEncryptByTheOldRule(bytes: Uint8Array): boolean {
  const raw = latin1(bytes);
  const isWhite = (c: string) => c === '\0' || c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === ' ';
  const isKeyword = (at: number) => {
    if (raw[at + 6] !== '\r' && raw[at + 6] !== '\n') return false;
    let i = at - 1;
    while (i >= 0 && isWhite(raw[i])) i--;
    return i >= 1 && raw[i] === '>' && raw[i - 1] === '>';
  };
  const inside = (at: number) => {
    let from = 0;
    for (;;) {
      let start = raw.indexOf('stream', from);
      while (start >= 0 && start < at && !isKeyword(start)) start = raw.indexOf('stream', start + 1);
      if (start < 0 || start >= at) return false;
      const end = raw.indexOf('endstream', start + 6);
      if (end < 0 || end > at) return true;
      from = end + 9;
    }
  };
  for (let at = raw.indexOf('/Encrypt'); at >= 0; at = raw.indexOf('/Encrypt', at + 1)) {
    let i = at + 8;
    while (i < raw.length && isWhite(raw[i])) i++;
    if (raw.startsWith('<<', i) && !inside(at)) return true;
    const reference = /^(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+R/.exec(raw.slice(i, i + 40));
    if (reference && Number(reference[1]) === 4 && Number(reference[2]) === 0) return true;
  }
  return false;
}

describe('inspectPdf on hostile files', () => {
  it('reads a file with thousands of "/Encrypt<<" in a content stream in one pass, and still finds it unprotected (REV-A B1)', async () => {
    // 82 KB, 8,397 names in one stream body: checked one by one from the start of the file, it held the window for 25 s
    const file = rawPdf([...ONE_PAGE, UNUSED_SECURITY, streamObject('/Encrypt<<'.repeat(8397))]);
    const { outcome, ms } = await processorTime(() => inspectPdf(file));
    expect(outcome).toEqual({ encrypted: false, pageCount: 1, hasSignature: false, ...PLAIN });
    expect(ms).toBeLessThan(3000);
  });

  it('refuses as damaged, quickly, a file with more /Encrypt names than any protected file has', async () => {
    for (const body of ['/Encrypt<<'.repeat(104_858), '/Encrypt 9 0 R '.repeat(20_000)]) {
      const file = rawPdf([...ONE_PAGE, UNUSED_SECURITY, streamObject(body)]);
      const { outcome, ms } = await processorTime(() => inspectPdf(file));
      expect(outcome).toMatchObject({ code: 'not-a-pdf' });
      expect(ms).toBeLessThan(3000);
    }
  });

  it('still finds an /Encrypt entry outside the stream bodies after thousands inside them, and in a body never closed', async () => {
    const decoys = streamObject('/Encrypt<< '.repeat(5000));
    const after = rawPdf([...ONE_PAGE, UNUSED_SECURITY, decoys, decoys], ['', '', '', '', '', '% /Encrypt << /Filter /Standard >>\n']);
    expect(await inspectPdf(after)).toEqual({ encrypted: true, pageCount: null, hasSignature: false, ...PLAIN });
    // the last body has no endstream: everything after its keyword is in it
    const open = latin1(rawPdf([...ONE_PAGE, UNUSED_SECURITY, streamObject('q Q')])).replace(/endstream\nendobj\nxref/, 'endobj\n% /Encrypt << >>\nxref');
    expect(await inspectPdf(Uint8Array.from(open, (c) => c.charCodeAt(0)))).toMatchObject({ encrypted: false });
  });

  it('gives the same answer as the rule it replaces on files made of stream keywords, decoys and names (fixed seed)', async () => {
    const tokens = ['/Encrypt<<', '/Encrypt <<', '/Encrypt\n<<', 'stream\n', '>>stream\n', '>> stream\r\n', '>>\nstream\r', '(upstream)', ' ', 'x', '/Encrypt 9 0 R', '>>', '<<'];
    let seed = 2026;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    // a word that ends a body early, or a reference to the security dictionary, decides a file: kept rare
    const token = () => {
      const r = random();
      return r < 0.004 ? '/Encrypt 4 0 R' : r < 0.02 ? 'endstream' : tokens[Math.floor(random() * tokens.length)];
    };
    let protectedFiles = 0;
    for (let n = 0; n < 300; n++) {
      const bodies = Array.from({ length: 1 + Math.floor(random() * 4) }, () => Array.from({ length: Math.floor(random() * 60) }, token).join(''));
      const between = bodies.map(() => (random() < 0.04 ? '% /Encrypt<<\n' : ''));
      const file = rawPdf([...ONE_PAGE, UNUSED_SECURITY, ...bodies.map(streamObject)], ['', '', '', '', ...between]);
      const expected = namesEncryptByTheOldRule(file);
      if (expected) protectedFiles++;
      expect({ n, encrypted: (await inspectPdf(file)).encrypted }).toEqual({ n, encrypted: expected });
    }
    expect(protectedFiles).toBeGreaterThan(30); // both answers are well represented
    expect(protectedFiles).toBeLessThan(270);
  });

  it('reads only the first few MB of XMP or of a comment that inflates to hundreds of MB, and still finds what is there', async () => {
    // 128 MB of XMP from a 128 KB stream: decoded whole, a 512 MB one held the window for 27 s
    const title = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title><rdf:Alt><rdf:li>Synthetic bomb title</rdf:li></rdf:Alt></dc:title>';
    const inflated = Buffer.alloc(128 * 1024 * 1024, 0x20);
    inflated.write(title, 0, 'latin1');
    const z = deflateSync(inflated, { level: 9 });
    const doc = await PDFDocument.load(await makePdf('A', 1));
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(z, { Type: 'Metadata', Subtype: 'XML', Filter: 'FlateDecode' })));
    const rich = doc.context.register(doc.context.stream(z, { Filter: 'FlateDecode' }));
    doc.getPage(0).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [0, 0, 10, 10], RC: rich })));
    const file = await doc.save();
    const { outcome, ms } = await processorTime(() => inspectPdf(file));
    expect(outcome).toMatchObject({ encrypted: false, pageCount: 1, carried: { comments: 1, attachments: 0, properties: ['title'] } });
    expect(ms).toBeLessThan(3000);
    // Building 128 MB and deflating it took 22 s of the file's 20 s on a loaded machine (INT3); the processor
    // time above decides, this limit is a hang guard only.
  }, 120_000);

  it('refuses a page tree whose node is its own ancestor, which makes every tool climb for ever (REV-A S2)', async () => {
    const own = rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 2 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>']);
    const pair = rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 4 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>', '<< /Type /Pages /Kids [] /Count 0 /Parent 2 0 R >>']);
    for (const file of [own, pair]) await expect(inspectPdf(file)).rejects.toMatchObject({ code: 'not-a-pdf' });
  });

  it('accepts a deep page tree that ends, and refuses one deeper than 1,024 levels', async () => {
    const chain = (levels: number) => {
      // the page's parent is node 4, whose parent is node 5, and so on; the last has none
      const nodes = Array.from({ length: levels }, (_, k) => `<< /Type /Pages /Kids [] /Count 0${k < levels - 1 ? ` /Parent ${k + 5} 0 R` : ''} >>`);
      return rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] >>', ...nodes]);
    };
    expect(await inspectPdf(chain(200))).toMatchObject({ encrypted: false, pageCount: 1 });
    await expect(inspectPdf(chain(1100))).rejects.toMatchObject({ code: 'not-a-pdf' });
  });
});
