import { PDFDocument as CantooDocument } from '@cantoo/pdf-lib';
import { PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from './inspect';
import { extractPages } from './organise';
import { makeFormPdf, makePdf } from './testPdf';
import { unlockPdf } from './unlock';

/** What a file with no form, no bookmarks and no links reports. */
const PLAIN = { hasFormFields: false, hasBookmarks: false, hasPageLinks: false } as const;

vi.setConfig({ testTimeout: 20_000 });

beforeAll(async () => {
  await import('@cantoo/pdf-lib'); // pay the cold import once
}, 30_000);

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
    // a result of Split keeps the form of its pages, not the bookmarks
    expect(await inspectPdf(await extractPages(await makeFormPdf({ bookmarks: true, links: true }), [0, 1]))).toMatchObject({ hasFormFields: true, hasBookmarks: false, hasPageLinks: true });
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
  it('does not mutate the input', async () => {
    const bytes = await makePdf('A', 2);
    const before = bytes.slice();
    await inspectPdf(bytes);
    expect(bytes).toEqual(before);
  });
});
