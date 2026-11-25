// Protect with password (plan Task B5; spike-protect.md; the lead's rulings of 14 November 2026).
// Protected files are read back with pdf.js, with the app's own unlockPdf, and with an independent
// check of the password data written on Node's crypto (cantoo's crypto descends from pdf.js, so pdf.js
// agreeing is not independent). Every file is built here; nothing is read from disk but the library's
// own package.json.
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDocument as CantooDocument, PDFInvalidObject as CantooInvalidObject } from '@cantoo/pdf-lib';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from './inspect';
import {
  NO_LONGER_ARCHIVAL_NOTE,
  NON_ENGLISH_PASSWORD_WARNING,
  PASSWORD_LIMITS,
  passwordError,
  passwordStrength,
  passwordWarning,
  passwordWarnings,
  PROTECT_MAX_BYTES,
  protectPdf,
  SPACES_PASSWORD_WARNING,
  type ProtectPhase,
  type ProtectReport,
} from './protect';
import { rawHaystack } from './testLeakPdf';
import { makeFormPdf, makePdf, pageTexts } from './testPdf';
import { PHASE_TWO_ERROR_MESSAGES, PdfToolsError } from './types';
import { unlockPdf } from './unlock';

// The check inside protectPdf opens the result with unlockPdf; some tests replace what it returns.
type UnlockOptions = Parameters<typeof import('./unlock').unlockPdf>[2];
const unlockControl = vi.hoisted(() => ({ replace: null as null | ((file: Uint8Array, password: string, options?: UnlockOptions) => Promise<Uint8Array>) }));
vi.mock('./unlock', async (importOriginal) => {
  const real = await importOriginal<typeof import('./unlock')>();
  return {
    ...real,
    unlockPdf: (file: Uint8Array, password: string, options?: UnlockOptions) => (unlockControl.replace ?? real.unlockPdf)(file, password, options),
  };
});

vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);
afterEach(() => {
  unlockControl.replace = null;
  vi.restoreAllMocks();
});

const PASSWORD = 'Vera#Pass-2026!';
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');
const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof PdfToolsError ? error.code : `not a PdfToolsError: ${String(error)}`),
  );

// ---- pdf.js --------------------------------------------------------------------------------------

const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');

/** The PasswordException code pdf.js gives (1 needs a password, 2 wrong password), or 'opened'. */
async function pdfjsOpens(bytes: Uint8Array, password?: string): Promise<number | 'opened' | 'failed'> {
  const task = (await pdfjs()).getDocument({ data: bytes.slice(), password, isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    await pdf.destroy();
    return 'opened';
  } catch (error) {
    await task.destroy();
    const { name, code } = error as { name?: string; code?: number };
    return name === 'PasswordException' && typeof code === 'number' ? code : 'failed';
  }
}

interface Annotation {
  subtype: string;
  contentsObj?: { str?: string };
  titleObj?: { str?: string };
  url?: string;
  dest?: unknown;
}
interface OutlineNode {
  title: string;
  dest: unknown;
  items: OutlineNode[];
}

/** What pdf.js shows of a file: pages, text, sizes, notes and links, bookmarks, fields, attachments, labels, names, properties, XMP. */
async function pdfjsView(bytes: Uint8Array, password?: string) {
  const task = (await pdfjs()).getDocument({ data: bytes.slice(), password, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const pageOf = async (dest: unknown): Promise<number | null> => {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit[0] === null || explicit[0] === undefined) return null;
      return typeof explicit[0] === 'number' ? explicit[0] : pdf.getPageIndex(explicit[0]);
    };
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join('');
      const annotations = [];
      for (const a of (await page.getAnnotations()) as Annotation[]) {
        if (a.subtype === 'Widget') continue;
        annotations.push({ subtype: a.subtype, contents: a.contentsObj?.str ?? '', author: a.titleObj?.str ?? '', url: a.url ?? null, page: a.dest ? await pageOf(a.dest) : null });
      }
      pages.push({ text, view: page.view, rotate: page.rotate, annotations });
    }
    const outline = async (items: OutlineNode[] | null): Promise<unknown[]> =>
      Promise.all((items ?? []).map(async (item) => ({ title: item.title, page: await pageOf(item.dest), children: await outline(item.items) })));
    const fields: Record<string, unknown> = {};
    for (const [name, list] of Object.entries(((await pdf.getFieldObjects()) ?? {}) as Record<string, { value?: unknown; defaultValue?: unknown; type?: string }[]>)) {
      fields[name] = list.map((f) => ({ value: f.value ?? null, defaultValue: f.defaultValue ?? null, type: f.type ?? null }));
    }
    const rawAttachments = ((await pdf.getAttachments()) ?? {}) as Record<string, { filename: string; description?: string; content: Uint8Array }>;
    const attachments = Object.fromEntries(
      Object.entries(rawAttachments).map(([key, a]) => [key, { filename: a.filename, description: a.description ?? '', content: latin1(a.content) }]),
    );
    const { info, metadata } = await pdf.getMetadata();
    const kept = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Language'];
    return {
      numPages: pdf.numPages,
      pages,
      outline: await outline((await pdf.getOutline()) as OutlineNode[] | null),
      fields,
      attachments,
      labels: await pdf.getPageLabels(),
      destinations: Object.keys((await pdf.getDestinations()) ?? {}).sort(),
      info: Object.fromEntries(kept.map((key) => [key, (info as Record<string, unknown>)[key] ?? null])),
      xmp: metadata?.getRaw() ?? null,
    };
  } finally {
    await pdf.destroy();
  }
}

// ---- the file with a marker in every place a string can sit ----------------------------------------

/** One distinct marker per place (lead ruling 1). Each is found in the source's raw bytes. */
const MARKERS = {
  infoTitle: 'MK-INFO-TITLE',
  infoAuthor: 'MK-INFO-AUTHOR',
  infoSubject: 'MK-INFO-SUBJECT',
  infoKeywords: 'MK-INFO-KEYWORDS',
  xmp: 'MK-XMP-PACKET',
  lang: 'MK-CATALOG-LANG',
  labelPrefix: 'MK-LABEL-PREFIX-',
  bookmark: 'MK-BOOKMARK-TITLE',
  note: 'MK-NOTE-CONTENTS',
  noteAuthor: 'MK-NOTE-AUTHOR',
  inlineNote: 'MK-INLINE-NOTE',
  inlineNoteAuthor: 'MK-INLINE-AUTHOR',
  fieldValue: 'MK-FIELD-VALUE',
  fieldDefault: 'MK-FIELD-DEFAULT',
  uri: 'MK-LINK-URI',
  attachmentName: 'MK-ATTACH-NAME.txt',
  attachmentContent: 'MK-ATTACH-CONTENT',
  attachmentDescription: 'MK-ATTACH-DESC',
  streamDictionary: 'MK-STREAM-DICT',
  generationOne: 'MK-GEN1-NOTE',
  signer: 'MK-SIG-NAME',
  signReason: 'MK-SIG-REASON',
  signLocation: 'MK-SIG-LOCATION',
  signContents: 'MK-SIG-CONTENTS',
  destination: 'MK-DEST-NAME',
  pageTree: 'MK-PAGE-TREE',
  pageText1: 'Form p1',
  pageText3: 'Form p3',
} as const;
const ALL_MARKERS = Object.values(MARKERS);

const XMP = (marker: string, pdfa = '') =>
  '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
  `xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${marker}</rdf:li>` +
  `</rdf:Alt></dc:title></rdf:Description>${pdfa}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const PDFA = (part: 1 | 2) =>
  `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>${part}</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>`;

function findFieldDict(doc: PDFDocument, name: string): PDFDict {
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
  for (const ref of acro.lookup(PDFName.of('Fields'), PDFArray).asArray()) {
    const field = doc.context.lookup(ref, PDFDict);
    if ((field.lookup(PDFName.of('T')) as PDFString | PDFHexString).decodeText() === name) return field;
  }
  throw new Error(`no field ${name}`);
}

/**
 * The three-page form of testPdf.ts (fields, links between pages, bookmarks, a signature) with a marker
 * in: Info, XMP, catalog /Lang, an inline page-label prefix, a bookmark title (UTF-16), a note (object
 * of its own), a note and a URI link written inside a page's /Annots, a field value and default, an
 * attachment (name in the catalog's inline /Names, content, description, a string in its stream
 * dictionary), a generation-1 note, a signature dictionary (/Name, /Reason, /Location, /Contents), a
 * named destination in the catalog's inline /Names, the page tree's root, and the page text. Written
 * without object streams, so every string is plain in the source.
 */
async function makeMarkedPdf(options: { pdfa?: 1 | 2 } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makeFormPdf({ links: true, bookmarks: true, signature: true }), { updateMetadata: false });
  const ctx = doc.context;
  const S = (text: string) => PDFString.of(text);
  const [p1, p2, p3] = doc.getPages();
  const rect = [20, 60, 60, 90];
  doc.setTitle(MARKERS.infoTitle);
  doc.setAuthor(MARKERS.infoAuthor);
  doc.setSubject(MARKERS.infoSubject);
  doc.setKeywords([MARKERS.infoKeywords]);
  const xmp = new TextEncoder().encode(XMP(MARKERS.xmp, options.pdfa ? PDFA(options.pdfa) : ''));
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.flateStream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
  doc.catalog.set(PDFName.of('Lang'), S(MARKERS.lang));
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: [0, { S: 'D', P: S(MARKERS.labelPrefix) }] }));
  const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  ctx.lookup(outlines.get(PDFName.of('First')), PDFDict).set(PDFName.of('Title'), PDFHexString.fromText(`${MARKERS.bookmark} करदाता`));
  p1.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, Contents: S(MARKERS.note), T: S(MARKERS.noteAuthor) })));
  // Inside the page object itself: the writer keeps pages outside object streams.
  const p2Annots = p2.node.lookup(PDFName.of('Annots'), PDFArray);
  p2Annots.push(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, Contents: S(MARKERS.inlineNote), T: S(MARKERS.inlineNoteAuthor) }));
  p2Annots.push(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 100, 120, 112], Border: [0, 0, 0], A: { S: 'URI', URI: S(`https://example.invalid/${MARKERS.uri}`) } }));
  const remarks = findFieldDict(doc, 'remarks');
  remarks.set(PDFName.of('V'), S(MARKERS.fieldValue));
  remarks.set(PDFName.of('DV'), S(MARKERS.fieldDefault));
  const embedded = ctx.register(
    ctx.flateStream(`${MARKERS.attachmentContent} attachment body`, {
      Type: 'EmbeddedFile',
      Params: { ModDate: S('D:20260102030405Z') },
      MKNote: S(MARKERS.streamDictionary),
    } as never),
  );
  const filespec = ctx.register(
    ctx.obj({ Type: 'Filespec', F: S(MARKERS.attachmentName), UF: PDFHexString.fromText(MARKERS.attachmentName), Desc: S(MARKERS.attachmentDescription), EF: { F: embedded } }),
  );
  doc.catalog.set(
    PDFName.of('Names'),
    ctx.obj({ Dests: { Names: [S(MARKERS.destination), [p1.ref, 'Fit']] }, EmbeddedFiles: { Names: [S(MARKERS.attachmentName), filespec] } }),
  );
  const generationOne = PDFRef.of(ctx.largestObjectNumber + 1, 1);
  ctx.assign(generationOne, ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, Contents: S(MARKERS.generationOne) }));
  p3.node.addAnnot(generationOne);
  for (const [, object] of ctx.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Sig')) continue;
    object.set(PDFName.of('Name'), S(MARKERS.signer));
    object.set(PDFName.of('Reason'), S(MARKERS.signReason));
    object.set(PDFName.of('Location'), S(MARKERS.signLocation));
    object.set(PDFName.of('M'), S('D:20260101000000Z'));
    object.set(PDFName.of('Contents'), PDFHexString.of(Buffer.from(`${MARKERS.signContents}`.padEnd(64, '\0'), 'latin1').toString('hex')));
  }
  ctx.lookup(doc.catalog.get(PDFName.of('Pages')), PDFDict).set(PDFName.of('MKNote'), S(MARKERS.pageTree));
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** A marker as it could sit in bytes: as written, UTF-16 big- and little-endian (raw and hex), and as hex. */
function spellings(text: string): string[] {
  const utf8 = Buffer.from(text, 'utf8');
  const be = Buffer.from(text, 'utf16le').swap16();
  const le = Buffer.from(text, 'utf16le');
  return [utf8.toString('latin1'), be.toString('latin1'), le.toString('latin1'), utf8.toString('hex'), utf8.toString('hex').toUpperCase(), be.toString('hex'), be.toString('hex').toUpperCase()];
}

const foundIn = (haystack: string, texts: readonly string[]) => texts.filter((text) => spellings(text).some((form) => haystack.includes(form)));

// ---- an independent check of the AES-256 (R6) password data, on Node's crypto ---------------------

/** ISO 32000-2 Algorithm 2.B, written from the standard (the loop as pdf.js runs it). */
function hash2B(password: Buffer, salt: Buffer, userKey: Buffer): Buffer {
  let k = createHash('sha256').update(Buffer.concat([password, salt, userKey])).digest();
  let e = Buffer.alloc(0);
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([password, k, userKey])));
    const aes = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)); // the standard's step, no padding
    aes.setAutoPadding(false);
    e = Buffer.concat([aes.update(k1), aes.final()]);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3]).update(e).digest();
  }
  return k.subarray(0, 32);
}

const aes256NoPadding = (key: Buffer, data: Buffer, mode: 'aes-256-cbc' | 'aes-256-ecb') => {
  const decipher = createDecipheriv(mode, key, mode === 'aes-256-cbc' ? Buffer.alloc(16) : null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
};

async function securityDictionary(bytes: Uint8Array): Promise<{ doc: PDFDocument; encrypt: PDFDict }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return { doc, encrypt: doc.context.lookup(doc.context.trailerInfo.Encrypt, PDFDict) };
}

const bytesOf = (dict: PDFDict, key: string) => Buffer.from((dict.lookup(PDFName.of(key)) as PDFString | PDFHexString).asBytes());

// ---- the protected file ---------------------------------------------------------------------------

describe('the protected file', () => {
  let source: Uint8Array;
  let result: Uint8Array;
  let unlocked: Uint8Array;
  let report: ProtectReport;
  const sourceCopy: { bytes?: Uint8Array } = {};

  beforeAll(async () => {
    source = await makeMarkedPdf();
    sourceCopy.bytes = source.slice();
    report = {};
    result = await protectPdf(source, PASSWORD, { report });
    unlocked = await unlockPdf(result, PASSWORD);
  }, 300_000);

  it('the source holds every marker in its raw bytes, and is left unchanged (self-check)', () => {
    expect(foundIn(rawHaystack(source), ALL_MARKERS)).toEqual(ALL_MARKERS);
    expect(source).toEqual(sourceCopy.bytes);
  });

  it('writes AES-256 (V 5, R 6) with every permission and encrypted metadata', async () => {
    const { doc, encrypt } = await securityDictionary(result);
    const name = (key: string) => encrypt.lookup(PDFName.of(key));
    expect(name('Filter')).toBe(PDFName.of('Standard'));
    expect(encrypt.lookup(PDFName.of('V'), PDFNumber).asNumber()).toBe(5);
    expect(encrypt.lookup(PDFName.of('R'), PDFNumber).asNumber()).toBe(6);
    expect(encrypt.lookup(PDFName.of('Length'), PDFNumber).asNumber()).toBe(256);
    expect(encrypt.lookup(PDFName.of('P'), PDFNumber).asNumber()).toBe(-4);
    const filter = encrypt.lookup(PDFName.of('CF'), PDFDict).lookup(PDFName.of('StdCF'), PDFDict);
    expect(filter.lookup(PDFName.of('CFM'))).toBe(PDFName.of('AESV3'));
    expect(name('StmF')).toBe(PDFName.of('StdCF'));
    expect(name('StrF')).toBe(PDFName.of('StdCF'));
    expect(encrypt.has(PDFName.of('EncryptMetadata'))).toBe(false);
    expect([bytesOf(encrypt, 'O').length, bytesOf(encrypt, 'U').length, bytesOf(encrypt, 'OE').length, bytesOf(encrypt, 'UE').length, bytesOf(encrypt, 'Perms').length]).toEqual([48, 48, 32, 32, 16]);
    const id = doc.context.lookup(doc.context.trailerInfo.ID, PDFArray).asArray().map((entry) => Buffer.from((entry as PDFHexString).asBytes()).toString('hex'));
    expect(id).toHaveLength(2);
    expect(id[0]).toHaveLength(32);
    expect(latin1(result.subarray(0, 8))).toMatch(/^%PDF-(1\.[7-9]|2\.\d)/);
    const adbe = doc.catalog.lookup(PDFName.of('Extensions'), PDFDict).lookup(PDFName.of('ADBE'), PDFDict);
    expect(adbe.lookup(PDFName.of('ExtensionLevel'), PDFNumber).asNumber()).toBe(8);
  });

  it('holds password data that an independent implementation accepts, and a content stream it can decrypt', async () => {
    const { doc, encrypt } = await securityDictionary(result);
    const password = Buffer.from(PASSWORD.normalize('NFC'), 'utf8');
    const u = bytesOf(encrypt, 'U');
    const o = bytesOf(encrypt, 'O');
    expect(hash2B(password, u.subarray(32, 40), Buffer.alloc(0)).equals(u.subarray(0, 32))).toBe(true);
    expect(hash2B(Buffer.from('wrong password'), u.subarray(32, 40), Buffer.alloc(0)).equals(u.subarray(0, 32))).toBe(false);
    expect(hash2B(password, o.subarray(32, 40), u).equals(o.subarray(0, 32))).toBe(true);
    const fileKey = aes256NoPadding(hash2B(password, u.subarray(40, 48), Buffer.alloc(0)), bytesOf(encrypt, 'UE'), 'aes-256-cbc');
    const ownerKey = aes256NoPadding(hash2B(password, o.subarray(40, 48), u), bytesOf(encrypt, 'OE'), 'aes-256-cbc');
    expect(ownerKey.equals(fileKey)).toBe(true);
    const perms = aes256NoPadding(fileKey, bytesOf(encrypt, 'Perms'), 'aes-256-ecb');
    expect(perms.readInt32LE(0)).toBe(-4);
    expect(perms.subarray(9, 12).toString('latin1')).toBe('adb');
    // Page 1's content streams sit outside the object stream: decrypt them here and inflate them.
    const contents = doc.getPage(0).node.get(PDFName.of('Contents'));
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents!];
    const text = refs
      .map((ref) => {
        const data = Buffer.from((doc.context.lookup(ref) as PDFRawStream).contents);
        const decipher = createDecipheriv('aes-256-cbc', fileKey, data.subarray(0, 16));
        return inflateSync(Buffer.concat([decipher.update(data.subarray(16)), decipher.final()])).toString('latin1');
      })
      .join('\n');
    expect(text).toContain('Tf');
  });

  it('opens only with the password, in pdf.js', async () => {
    expect(await pdfjsOpens(result)).toBe(1);
    expect(await pdfjsOpens(result, 'not the password')).toBe(2);
    expect(await pdfjsOpens(result, `${PASSWORD} `)).toBe(2);
    expect(await pdfjsOpens(result, PASSWORD)).toBe('opened');
    const task = (await pdfjs()).getDocument({ data: result.slice(), password: PASSWORD, isEvalSupported: false, verbosity: 0 });
    const pdf = await task.promise;
    const permissions = await pdf.getPermissions();
    await pdf.destroy();
    const { PermissionFlag } = await pdfjs();
    // /P -4 grants everything: pdf.js lists every flag (or none at all, meaning no restriction).
    if (permissions !== null) expect([...permissions].sort((a, b) => a - b)).toEqual(Object.values(PermissionFlag).sort((a, b) => a - b));
  });

  it('leaves no marker readable in the raw bytes, with every stream inflated where it can be without the key', () => {
    const haystack = rawHaystack(result);
    expect(foundIn(haystack, ALL_MARKERS)).toEqual([]);
    // Without the key, no stream inflates: the haystack is the raw bytes alone, hex strings decoded.
    expect(haystack.length).toBeLessThan(result.length * 2 + 4096);
    expect(foundIn(rawHaystack(result), [PASSWORD])).toEqual([]);
  });

  it('every marker is back after unlocking with the password (app unlock), in the raw bytes and where each belongs', async () => {
    expect(foundIn(rawHaystack(unlocked), ALL_MARKERS)).toEqual(ALL_MARKERS);
    const doc = await PDFDocument.load(unlocked, { updateMetadata: false });
    const text = (dict: PDFDict, key: string) => (dict.lookup(PDFName.of(key)) as PDFString | PDFHexString).decodeText();
    expect(text(doc.catalog, 'Lang')).toBe(MARKERS.lang);
    expect(text(doc.context.lookup(doc.catalog.get(PDFName.of('Pages')), PDFDict), 'MKNote')).toBe(MARKERS.pageTree);
    const sig = doc.context.enumerateIndirectObjects().map(([, o]) => o).find((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Sig'))!;
    expect(['Name', 'Reason', 'Location'].map((key) => text(sig, key))).toEqual([MARKERS.signer, MARKERS.signReason, MARKERS.signLocation]);
    expect(latin1((sig.lookup(PDFName.of('Contents')) as PDFHexString).asBytes())).toContain(MARKERS.signContents);
    const embedded = doc.context.enumerateIndirectObjects().map(([, o]) => o).find((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Type')) === PDFName.of('EmbeddedFile'))!;
    expect(text(embedded.dict, 'MKNote')).toBe(MARKERS.streamDictionary);
    expect(doc.getTitle()).toBe(MARKERS.infoTitle);
  });

  it('pdf.js sees the same document with the password as the source without one: pages, text, notes, links, bookmarks, fields, attachments, labels, names, properties and XMP', async () => {
    const before = await pdfjsView(source);
    // self-check: the view holds what the markers name
    expect(before.info).toMatchObject({ Title: MARKERS.infoTitle, Author: MARKERS.infoAuthor, Subject: MARKERS.infoSubject, Keywords: MARKERS.infoKeywords, Language: MARKERS.lang });
    expect(before.labels).toEqual([1, 2, 3].map((n) => `${MARKERS.labelPrefix}${n}`));
    expect(before.destinations).toEqual([MARKERS.destination]);
    expect(Object.values(before.attachments)).toEqual([{ filename: MARKERS.attachmentName, description: MARKERS.attachmentDescription, content: `${MARKERS.attachmentContent} attachment body` }]);
    expect(JSON.stringify(before.pages)).toContain(MARKERS.generationOne);
    expect(JSON.stringify(before.pages)).toContain(MARKERS.inlineNote);
    expect(JSON.stringify(before.pages)).toContain(MARKERS.uri);
    expect(JSON.stringify(before.outline)).toContain(MARKERS.bookmark);
    expect(JSON.stringify(before.fields)).toContain(MARKERS.fieldValue);
    expect(before.xmp).toContain(MARKERS.xmp);
    expect(await pdfjsView(result, PASSWORD)).toEqual(before);
    expect(await pdfjsView(unlocked)).toEqual(before);
  });

  it('is reported as protected by inspectPdf; once unlocked it has the source pages, fields, bookmarks and links', async () => {
    const info = await inspectPdf(result);
    expect(info.encrypted).toBe(true);
    const sourceInfo = await inspectPdf(source);
    const unlockedInfo = await inspectPdf(unlocked);
    expect(unlockedInfo).toEqual(sourceInfo);
    expect(sourceInfo).toMatchObject({ pageCount: 3, hasFormFields: true, hasBookmarks: true, hasPageLinks: true, hasSignature: true });
    expect(await pageTexts(unlocked)).toEqual(await pageTexts(source));
  });

  it('reports the checked copy for previews, the page count and the lost signature, and nothing else', () => {
    expect(Object.keys(report).sort()).toEqual(['pageCount', 'signatureInvalid', 'unlocked']);
    expect(report.pageCount).toBe(3);
    expect(report.signatureInvalid).toBe(true);
    expect(report.unlocked).toBeInstanceOf(Uint8Array);
    expect(foundIn(rawHaystack(report.unlocked!), ALL_MARKERS)).toEqual(ALL_MARKERS);
    expect(foundIn(rawHaystack(report.unlocked!), [PASSWORD])).toEqual([]);
  });

  it('keeps the properties exactly as they were: Producer, dates and the XMP bytes are not rewritten', async () => {
    const [a, b] = await Promise.all([PDFDocument.load(source, { updateMetadata: false }), PDFDocument.load(unlocked, { updateMetadata: false })]);
    for (const get of [(d: PDFDocument) => d.getProducer(), (d: PDFDocument) => d.getCreator(), (d: PDFDocument) => d.getModificationDate()?.toISOString(), (d: PDFDocument) => d.getCreationDate()?.toISOString()]) {
      expect(get(b)).toEqual(get(a));
    }
    const xmpOf = (d: PDFDocument) => latin1((d.context.lookup(d.catalog.get(PDFName.of('Metadata'))) as PDFRawStream).contents);
    expect(xmpOf(b)).toBe(xmpOf(a));
  });
});

// ---- passwords --------------------------------------------------------------------------------------

describe('password rules', () => {
  it('limits: at least 8 characters, at most 127 bytes in UTF-8 (the PDF standard cuts there; the PDF engine of Google Chrome refuses longer)', () => {
    expect(PASSWORD_LIMITS).toEqual({ min: 8, maxBytes: 127 });
    expect(PROTECT_MAX_BYTES).toBe(150 * 1024 * 1024);
  });

  it('passwordError: empty, short, long, unusable characters and a mismatch, in plain words without the password', () => {
    const secret = 'Zq9!Zq9!Zq9!';
    expect(passwordError('', '')).toMatch(/password/i);
    expect(passwordError('Ab1!', 'Ab1!')).toMatch(/at least 8 characters/);
    expect(passwordError('a'.repeat(127), 'a'.repeat(127))).toBeNull();
    expect(passwordError('a'.repeat(128), 'a'.repeat(128))).toMatch(/too long/);
    expect(passwordError('क'.repeat(42), 'क'.repeat(42))).toBeNull(); // 126 bytes
    expect(passwordError('क'.repeat(43), 'क'.repeat(43))).toMatch(/too long/); // 129 bytes
    expect(passwordError('abc\u0007defgh', 'abc\u0007defgh')).toMatch(/cannot be typed/);
    expect(passwordError('abcdefgh\ud800', 'abcdefgh\ud800')).toMatch(/cannot be typed/);
    expect(passwordError(secret, `${secret}x`)).toMatch(/not the same/);
    expect(passwordError(secret, secret)).toBeNull();
    // the two boxes are compared as they will be used (NFC)
    expect(passwordError('pässwört-1'.normalize('NFD'), 'pässwört-1'.normalize('NFC'))).toBeNull();
    for (const [a, b] of [['', ''], ['Zq9!', 'Zq9!'], ['Zq9!'.repeat(40), 'Zq9!'.repeat(40)], [secret, 'other-one']]) {
      const message = passwordError(a, b) ?? '';
      if (a.length > 0) expect(message.includes(a)).toBe(false);
      expect(message.includes(b) && b.length > 0).toBe(false);
    }
  });

  it('passwordStrength: weak under 12 characters or with one kind, strong with 12 of three kinds (letters, digits, symbols), fair between', () => {
    expect(passwordStrength('abcdefgh')).toBe('weak');
    expect(passwordStrength('Abcdefgh12!x')).toBe('strong');
    expect(passwordStrength('abcdefghijklmnop')).toBe('weak');
    expect(passwordStrength('abcdefgh1234')).toBe('fair');
    expect(passwordStrength('Abc1!')).toBe('weak');
    expect(passwordStrength('पासवर्ड₹2025')).toBe('strong'); // Devanagari letters and marks count as letters
    expect(passwordStrength('')).toBe('weak');
  });

  it('passwordWarning: only when a character is not on an English keyboard', () => {
    expect(passwordWarning('Audit@2026 ok')).toBeNull();
    expect(passwordWarning('पासवर्ड₹2025')).toBe(NON_ENGLISH_PASSWORD_WARNING);
    expect(passwordWarning('pass\u00A0word')).toBe(NON_ENGLISH_PASSWORD_WARNING);
    expect(passwordWarning('Ünïcødé-Paß')).toBe(NON_ENGLISH_PASSWORD_WARNING);
    expect(NON_ENGLISH_PASSWORD_WARNING).toMatch(/English keyboard/);
  });

  it('passwordWarnings: a space at the start or end, a non-English character, both, or none (review F10, lead ruling 4)', () => {
    expect(passwordWarnings('Audit@2026 ok')).toEqual([]);
    expect(passwordWarnings(' Audit@2026')).toEqual([SPACES_PASSWORD_WARNING]);
    expect(passwordWarnings('Audit@2026  ')).toEqual([SPACES_PASSWORD_WARNING]);
    expect(passwordWarnings('पासवर्ड₹2025')).toEqual([NON_ENGLISH_PASSWORD_WARNING]);
    expect(passwordWarnings(' पासवर्ड₹2025')).toEqual([SPACES_PASSWORD_WARNING, NON_ENGLISH_PASSWORD_WARNING]);
    expect(passwordWarnings('\u00A0Audit@2026')).toEqual([SPACES_PASSWORD_WARNING, NON_ENGLISH_PASSWORD_WARNING]);
    expect(SPACES_PASSWORD_WARNING).toMatch(/starts or ends with a space/);
  });
});

describe('passwords on real files', () => {
  let small: Uint8Array;
  beforeAll(async () => {
    small = await makePdf('Pw', 2);
  });

  for (const password of ['पासवर्ड₹2025', 'Ünïcødé-Paß', 'パスワードですね', '  pass word  ', 'x'.repeat(127), 'Audit🔒2026']) {
    it(`${JSON.stringify(password.length > 20 ? `${password.slice(0, 8)}… (${password.length})` : password)} opens in pdf.js and in the app, and nothing else does`, async () => {
      const result = await protectPdf(small, password);
      const wrong = `Q${password.slice(1)}`;
      expect(await pdfjsOpens(result, password)).toBe('opened');
      expect(await pdfjsOpens(result, wrong)).toBe(2);
      expect(await pageTexts(await unlockPdf(result, password))).toEqual(['Pw p1', 'Pw p2']);
      await expect(unlockPdf(result, wrong)).rejects.toMatchObject({ code: 'wrong-password' });
      if (password.trim() !== password) await expect(unlockPdf(result, password.trim())).rejects.toMatchObject({ code: 'wrong-password' });
    });
  }

  it('is stored as NFC: typed decomposed, it opens in pdf.js when typed composed', async () => {
    const decomposed = 'pässwört-2026'.normalize('NFD');
    const result = await protectPdf(small, decomposed);
    expect(await pdfjsOpens(result, decomposed.normalize('NFC'))).toBe('opened');
    expect(await pageTexts(await unlockPdf(result, decomposed))).toEqual(['Pw p1', 'Pw p2']);
  });

  it('refuses an empty, short, overlong or unusable password before reading the file', async () => {
    const notAPdf = new Uint8Array([1, 2, 3]);
    expect(await codeOf(protectPdf(notAPdf, ''))).toBe('password-too-short');
    expect(await codeOf(protectPdf(notAPdf, 'short'))).toBe('password-too-short');
    expect(await codeOf(protectPdf(notAPdf, 'y'.repeat(128)))).toBe('password-too-long');
    expect(await codeOf(protectPdf(notAPdf, 'क'.repeat(43)))).toBe('password-too-long');
    expect(await codeOf(protectPdf(notAPdf, 'abcdefgh\u0000'))).toBe('password-invalid');
    expect(await codeOf(protectPdf(notAPdf, 'long enough'))).toBe('not-a-pdf');
  });
});

describe('the password never leaves the call', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

  it('is absent from the console, every error, the result, the checked copy and the report, on success and on failure', async () => {
    const secret = 'Leak-Probe-ज्ञ-77';
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const errors: unknown[] = [];
    const report: ProtectReport = {};
    const file = await makeMarkedPdf();
    const result = await protectPdf(file, secret, { report });
    // Each failure is caught as it is made: the password checks fail at once, and the reads wait by the
    // clock (pace.ts), so an attempt left without a handler while an earlier one is awaited would be an
    // unhandled rejection for a moment (INT3).
    const caught = (attempt: Promise<unknown>) => attempt.then(() => undefined, (error: unknown) => void errors.push(error));
    const attempts: Promise<unknown>[] = [
      caught(protectPdf(new Uint8Array([37, 80, 68, 70]), secret)),
      caught(protectPdf(result, secret)), // already protected
      caught(protectPdf(file, secret.slice(0, 4))),
      caught(protectPdf(file, `${secret}${'z'.repeat(130)}`)),
      caught(protectPdf(file, `${secret}\u0001`)),
    ];
    unlockControl.replace = async () => {
      throw new Error(`library said: ${secret}`);
    };
    attempts.push(caught(protectPdf(file, secret)));
    await Promise.all(attempts);
    unlockControl.replace = null;
    expect(errors).toHaveLength(6);
    const forms = [secret, secret.slice(0, 4), ...spellings(secret).slice(1)];
    for (const error of errors) {
      expect(error).toBeInstanceOf(PdfToolsError);
      const text = [String(error), (error as Error).stack ?? '', JSON.stringify(error), String((error as { cause?: unknown }).cause ?? '')].join('\n');
      for (const form of forms) expect(text.includes(form), `${(error as PdfToolsError).code}`).toBe(false);
    }
    const printed = spies.flatMap((spy) => spy.mock.calls.flat().map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg)))).join('\n');
    for (const form of forms) expect(printed.includes(form)).toBe(false);
    expect(foundIn(rawHaystack(result), [secret])).toEqual([]);
    expect(foundIn(rawHaystack(report.unlocked!), [secret])).toEqual([]);
    expect(JSON.stringify({ ...report, unlocked: undefined })).not.toContain(secret);
  });

  it('keeps nothing between calls: two files protected one after the other each open only with their own password', async () => {
    const file = await makePdf('Two', 1);
    const a = await protectPdf(file, 'First-Password-1');
    const b = await protectPdf(file, 'Second-Password-2');
    expect(await pdfjsOpens(a, 'First-Password-1')).toBe('opened');
    expect(await pdfjsOpens(a, 'Second-Password-2')).toBe(2);
    expect(await pdfjsOpens(b, 'Second-Password-2')).toBe('opened');
    expect(await pdfjsOpens(b, 'First-Password-1')).toBe(2);
  });
});

// ---- refusals, the one save and the check ---------------------------------------------------------

describe('refusals', () => {
  it('refuses a protected input (it must be unlocked first) and never loads it ignoring its protection', async () => {
    const once = await protectPdf(await makePdf('Twice', 1), PASSWORD);
    const load = vi.spyOn(CantooDocument, 'load');
    const error = await protectPdf(once, 'Another-Password-9').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).code).toBe('encrypted');
    expect((error as PdfToolsError).message).toBe('This file is password-protected. Unlock it first.');
    for (const call of load.mock.calls) expect((call[1] as { ignoreEncryption?: boolean } | undefined)?.ignoreEncryption).not.toBe(true);
    // unlock, then protect again: the new password opens it, the old one does not
    const again = await protectPdf(await unlockPdf(once, PASSWORD), 'Another-Password-9');
    expect(await pdfjsOpens(again, 'Another-Password-9')).toBe('opened');
    expect(await pdfjsOpens(again, PASSWORD)).toBe(2);
  });

  it('refuses a file over 150 MB before reading it', async () => {
    const big = new Uint8Array(PROTECT_MAX_BYTES + 1);
    const error = await protectPdf(big, PASSWORD).catch((e: unknown) => e);
    expect((error as PdfToolsError).code).toBe('protect-too-large');
    expect((error as PdfToolsError).message).toMatch(/150 MB/);
  });

  it('a part pdf-lib cannot read: dropped when nothing uses it, refused when something does (it could not be encrypted)', async () => {
    const make = async (used: boolean) => {
      const doc = await PDFDocument.load(await makePdf('Damaged', 1));
      const broken = doc.context.register(doc.context.obj({ MKSecret: PDFString.of('MK-UNREADABLE-PART'), Broken: 1 }));
      if (used) doc.catalog.set(PDFName.of('MKPart'), broken);
      const text = latin1(await doc.save({ useObjectStreams: false }));
      expect(text).toContain('/Broken 1\n');
      return new Uint8Array(Buffer.from(text.replace('/Broken 1\n', '/Broken ]\n'), 'latin1'));
    };
    const unused = await make(false);
    const parsed = await CantooDocument.load(unused, { updateMetadata: false });
    expect(parsed.context.enumerateIndirectObjects().some(([, o]) => o instanceof CantooInvalidObject)).toBe(true); // self-check
    const result = await protectPdf(unused, PASSWORD);
    expect(foundIn(rawHaystack(result), ['MK-UNREADABLE-PART'])).toEqual([]);
    expect(await pageTexts(await unlockPdf(result, PASSWORD))).toEqual(['Damaged p1']);
    const error = await protectPdf(await make(true), PASSWORD).catch((e: unknown) => e);
    expect((error as PdfToolsError).code).toBe('protect-failed');
    expect((error as PdfToolsError).message).toMatch(/^The file could not be protected\./);
  });

  it('a file that claims PDF/A is protected (the copy can no longer be PDF/A); PDF/A-1 without object streams, every string sealed', async () => {
    for (const part of [1, 2] as const) {
      const source = await makeMarkedPdf({ pdfa: part });
      const result = await protectPdf(source, PASSWORD);
      expect(latin1(result).includes('/ObjStm'), `part ${part}`).toBe(part === 2);
      expect(foundIn(rawHaystack(result), ALL_MARKERS), `part ${part}`).toEqual([]);
      expect(await pdfjsView(result, PASSWORD)).toEqual(await pdfjsView(source));
      expect(foundIn(rawHaystack(await unlockPdf(result, PASSWORD)), ALL_MARKERS)).toEqual(ALL_MARKERS);
    }
  });

  it('an incremental update is written as one revision: the replaced title is gone, the latest kept', async () => {
    const first = await PDFDocument.load(await makePdf('Rev', 1));
    first.setTitle('MK-OLD-TITLE');
    const base = await first.save({ useObjectStreams: false });
    const later = await CantooDocument.load(base, { forIncrementalUpdate: true, updateMetadata: false });
    later.setTitle('MK-NEW-TITLE');
    const updated = await later.save();
    expect(latin1(updated).split('%%EOF').length - 1).toBe(2); // self-check: two revisions
    expect(foundIn(rawHaystack(updated), ['MK-OLD-TITLE', 'MK-NEW-TITLE'])).toEqual(['MK-OLD-TITLE', 'MK-NEW-TITLE']);
    const result = await protectPdf(updated, PASSWORD);
    expect(latin1(result).split('%%EOF').length - 1).toBe(1);
    expect(foundIn(rawHaystack(result), ['MK-OLD-TITLE', 'MK-NEW-TITLE'])).toEqual([]);
    const back = await unlockPdf(result, PASSWORD);
    expect(foundIn(rawHaystack(back), ['MK-OLD-TITLE', 'MK-NEW-TITLE'])).toEqual(['MK-NEW-TITLE']);
  });

  it('an unsigned file is not flagged', async () => {
    const report: ProtectReport = {};
    await protectPdf(await makePdf('Plain', 1), PASSWORD, { report });
    expect(report.signatureInvalid).toBeUndefined();
    expect(report.pageCount).toBe(1);
  });

  it('the library is the version whose writer the sealing pass copies', () => {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/node_modules/@cantoo/pdf-lib/package.json`, 'utf8')) as { version: string };
    expect(pkg.version).toBe('2.11.1');
  });
});

/** Whether pdf.js paints an image on the page (its operator list draws an image XObject). */
async function paintsImage(bytes: Uint8Array, pageNumber: number, password?: string): Promise<boolean> {
  const { getDocument, OPS } = await pdfjs();
  const pdf = await getDocument({ data: bytes.slice(), password, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const ops = await (await pdf.getPage(pageNumber)).getOperatorList();
    return ops.fnArray.includes(OPS.paintImageXObject);
  } finally {
    await pdf.destroy();
  }
}

/** One page drawing a small red image whose resource name is written `name` in the file (review probe o4). */
async function makeImageNamedPdf(name: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);
  const pixels = new Uint8Array(Array.from({ length: 16 }, () => [255, 0, 0]).flat());
  const image = doc.context.register(doc.context.stream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { IMPLACEHOLDER: image } }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('q 150 0 0 150 25 25 cm /IMPLACEHOLDER Do Q')));
  const text = latin1(await doc.save({ useObjectStreams: false }));
  return new Uint8Array(Buffer.from(text.split('/IMPLACEHOLDER').join(`/${name}`), 'latin1'));
}

describe('valid files the check must not refuse (review F1), and it stays strict', () => {
  let base: string;
  beforeAll(async () => {
    base = latin1(await (await PDFDocument.load(await makePdf('Syn', 1))).save({ useObjectStreams: false }));
    expect(base).toContain('/Type /Catalog'); // self-check
  });
  const withCatalogEntry = (entry: string) => new Uint8Array(Buffer.from(base.replace('/Type /Catalog', `/Type /Catalog ${entry}`), 'latin1'));

  const cases: [string, string][] = [
    ['names with lower-case escapes', '/ZqA /text#2fplain /ZqB /Caf#c3#a9 /ZqC /Arial#20Bold'],
    ['entries whose value is null', '/ZqA null /ZqB << /K null /L (kept) >>'],
    ['a hex string with white space in it', '/ZqA <41 42 43> /ZqB <4D4B 2D 48 45 58>'],
    ['all three together', '/ZqA /text#2fplain /ZqB null /ZqC <41 42 43>'],
  ];
  for (const [label, entry] of cases) {
    it(`protects a file with ${label}, and it opens as the source does`, async () => {
      const source = withCatalogEntry(entry);
      const result = await protectPdf(source, PASSWORD);
      expect(await pdfjsOpens(result, PASSWORD)).toBe('opened');
      expect(await pdfjsView(result, PASSWORD)).toEqual(await pdfjsView(source));
    });
  }

  it('protects a page whose image is named with a lower-case escape; the unlocked copy still paints the image', async () => {
    const source = await makeImageNamedPdf('Im#2d1');
    expect(await paintsImage(source, 1)).toBe(true); // self-check: pdf.js reads /Im#2d1 as Im-1
    const result = await protectPdf(source, PASSWORD);
    expect(await paintsImage(result, 1, PASSWORD)).toBe(true);
    expect(await paintsImage(await unlockPdf(result, PASSWORD), 1)).toBe(true);
  });

  for (const [label, inline, withString, level] of [
    ['an indirect /Extensions holding a string', false, true, 0],
    ['an indirect /Extensions of names only', false, false, 0],
    ['an indirect /Extensions holding a string and ADBE level 8 already', false, true, 8],
    ['an inline /Extensions holding a string', true, true, 0],
  ] as const) {
    it(`protects a file with ${label}; the string is sealed once`, async () => {
      const doc = await PDFDocument.load(await makePdf('Ext', 1), { updateMetadata: false });
      const ctx = doc.context;
      const ext = ctx.obj({ ISO_: { BaseVersion: PDFName.of('2.0'), ExtensionLevel: 32001, ...(withString ? { URL: PDFString.of('MK-EXTENSION-URL') } : {}) } });
      if (level > 0) ext.set(PDFName.of('ADBE'), ctx.obj({ BaseVersion: PDFName.of('1.7'), ExtensionLevel: level }));
      doc.catalog.set(PDFName.of('Extensions'), inline ? ext : ctx.register(ext));
      const source = await doc.save({ useObjectStreams: false });
      const result = await protectPdf(source, PASSWORD);
      expect(await pdfjsOpens(result, PASSWORD)).toBe('opened');
      expect(foundIn(rawHaystack(result), ['MK-EXTENSION-URL'])).toEqual([]);
      if (withString) expect(foundIn(rawHaystack(await unlockPdf(result, PASSWORD)), ['MK-EXTENSION-URL'])).toEqual(['MK-EXTENSION-URL']);
    });
  }
});

describe('PDF/A sources are protected and flagged (lead ruling 4)', () => {
  it('a source that claims PDF/A gives noLongerArchival with the dialog and record wording; the XMP is not edited', async () => {
    for (const part of [1, 2] as const) {
      const report: ProtectReport = {};
      const source = await makeMarkedPdf({ pdfa: part });
      const result = await protectPdf(source, PASSWORD, { report });
      expect(report.noLongerArchival, `part ${part}`).toBe(true);
      const xmpOf = async (bytes: Uint8Array) => {
        const d = await PDFDocument.load(bytes, { updateMetadata: false });
        return latin1((d.context.lookup(d.catalog.get(PDFName.of('Metadata'))) as PDFRawStream).contents);
      };
      expect(await xmpOf(await unlockPdf(result, PASSWORD))).toBe(await xmpOf(source));
    }
    expect(NO_LONGER_ARCHIVAL_NOTE).toBe(
      'This file is marked PDF/A (archival). A password-protected copy cannot be PDF/A; the copy keeps the mark but no longer meets the standard.',
    );
    const plain: ProtectReport = {};
    await protectPdf(await makePdf('NotA', 1), PASSWORD, { report: plain });
    expect(plain.noLongerArchival).toBeUndefined();
  });
});

describe('one save, and the check before anything is returned', () => {
  it('encrypts and saves exactly once per call, on a fresh document; the same input twice gives two good files', async () => {
    const original = CantooDocument.prototype.save;
    let encryptingSaves = 0;
    vi.spyOn(CantooDocument.prototype, 'save').mockImplementation(function (this: CantooDocument, options) {
      if (this.context.security) encryptingSaves += 1;
      return original.call(this, options);
    });
    const file = await makePdf('Once', 2);
    const before = file.slice();
    const a = await protectPdf(file, PASSWORD);
    expect(encryptingSaves).toBe(1);
    const b = await protectPdf(file, PASSWORD);
    expect(encryptingSaves).toBe(2);
    expect(file).toEqual(before);
    for (const result of [a, b]) expect(await pageTexts(await unlockPdf(result, PASSWORD))).toEqual(['Once p1', 'Once p2']);
  });

  /** What the app's unlock hands back instead of the genuine unlocked copy. */
  const failures: [string, (genuine: Uint8Array, protectedFile: Uint8Array) => Promise<Uint8Array>][] = [
    ['the app cannot open it', async () => Promise.reject(new Error('cannot open'))],
    ['the app finds no protection (the same bytes back)', async (_genuine, protectedFile) => protectedFile],
    ['another file of the same page count', async () => makeFormPdf({ links: true })],
    [
      'one string differs',
      async (genuine) => {
        const doc = await PDFDocument.load(genuine, { updateMetadata: false });
        doc.catalog.set(PDFName.of('Lang'), PDFString.of('xx'));
        return doc.save();
      },
    ],
    [
      "an existing string's bytes differ (same key, same object)",
      async (genuine) => {
        const doc = await PDFDocument.load(genuine, { updateMetadata: false });
        const field = findFieldDict(doc, 'balance');
        field.set(PDFName.of('V'), PDFString.of('Rs 12,34,568 confirmed'));
        return doc.save();
      },
    ],
    [
      "a stream's bytes differ under the same reference",
      async (genuine) => {
        const doc = await PDFDocument.load(genuine, { updateMetadata: false });
        const contents = doc.getPage(1).node.get(PDFName.of('Contents'));
        const ref = (contents instanceof PDFArray ? contents.get(contents.size() - 1) : contents) as PDFRef;
        const stream = doc.context.lookup(ref) as PDFRawStream;
        const changed = stream.contents.slice();
        changed[changed.length - 1] ^= 0xff;
        doc.context.assign(ref, PDFRawStream.of(stream.dict, changed));
        return doc.save();
      },
    ],
    [
      'one page draws differently (as a second save leaves it)',
      async (genuine) => {
        const doc = await PDFDocument.load(genuine, { updateMetadata: false });
        const page = doc.getPage(2).node;
        page.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('BT /F1 9 Tf 1 1 Td (other) Tj ET')));
        return doc.save();
      },
    ],
  ];
  for (const [label, replace] of failures) {
    it(`discards the result when ${label}`, async () => {
      const source = await makeFormPdf();
      unlockControl.replace = async (file, password) => {
        unlockControl.replace = null; // the mocked unlockPdf is the real one again
        return replace(await unlockPdf(file, password), file);
      };
      const report: ProtectReport = {};
      const error = await protectPdf(source, PASSWORD, { report }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PdfToolsError);
      expect((error as PdfToolsError).code).toBe('protect-unverified');
      expect((error as PdfToolsError).message).toBe(PHASE_TWO_ERROR_MESSAGES['protect-unverified']);
      expect(report).toEqual({});
    });
  }
});

describe('progress and Stop', () => {
  it('reports the three phases in order', async () => {
    const phases: ProtectPhase[] = [];
    await protectPdf(await makePdf('Ph', 1), PASSWORD, { onPhase: (phase) => void phases.push(phase) });
    expect(phases).toEqual(['preparing', 'encrypting', 'checking']);
  });

  it('says how far the two slow phases have got, in parts of the file done (QA-FIX I: a 320-page ledger looked hung)', async () => {
    const steps: { phase: ProtectPhase; done: number; total: number }[] = [];
    const doc = await PDFDocument.create();
    for (let i = 0; i < 120; i++) doc.addPage([300, 400]).drawText(`Ledger page ${i + 1}`, { x: 20, y: 380, size: 10 });
    await protectPdf(await doc.save(), PASSWORD, { onProgress: (phase, done, total) => void steps.push({ phase, done, total }) });
    for (const phase of ['encrypting', 'checking'] as const) {
      const seen = steps.filter((s) => s.phase === phase);
      expect(seen.length, phase).toBeGreaterThan(2);
      expect(seen.every((s) => s.total > 0 && s.done >= 0 && s.done <= s.total), phase).toBe(true);
      expect(seen[seen.length - 1].done, phase).toBe(seen[seen.length - 1].total);
      // At most about a hundred reports however large the file.
      expect(seen.length, phase).toBeLessThanOrEqual(110);
    }
  });

  it('reads and writes small objects in slices of up to 1,500, not 50: far fewer timer waits on a text-heavy file', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 300; i++) doc.addPage([300, 400]).drawText(`Ledger page ${i + 1}`, { x: 20, y: 380, size: 10 });
    const bytes = await doc.save();
    // The reads and writes also wait by the clock (pace.ts, at least every 50 ms of work), which a busy
    // machine stretches; with the clock standing still only the waits counted in objects are left, and
    // those are what this test is about (INT3: the count was the same before the clock was added).
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      await protectPdf(bytes, PASSWORD);
      // About 1,200 objects: at 50 or 100 per slice the reads and writes waited well over 100 times.
      expect(timers.mock.calls.length).toBeLessThan(60);
    } finally {
      timers.mockRestore();
      clock.mockRestore();
    }
  });

  it('a cancel from the progress callback stops before the encryption; nothing is saved or reported', async () => {
    const save = vi.spyOn(CantooDocument.prototype, 'save');
    const report: ProtectReport = {};
    const stop = new Error('stopped by the user');
    const error = await protectPdf(await makePdf('Ph', 1), PASSWORD, {
      report,
      onPhase: (phase) => {
        if (phase === 'encrypting') throw stop;
      },
    }).catch((e: unknown) => e);
    expect(error).toBe(stop);
    expect(save).not.toHaveBeenCalled();
    expect(report).toEqual({});
  });

  it('an aborted signal stops before anything is read', async () => {
    const controller = new AbortController();
    controller.abort();
    const load = vi.spyOn(CantooDocument, 'load');
    expect(await codeOf(protectPdf(await makePdf('Ph', 1), PASSWORD, { signal: controller.signal }))).toBe('cancelled');
    expect(load).not.toHaveBeenCalled();
  });

  it('Stop during the check takes effect between slices of it (review F2)', async () => {
    const scan = await makeScan(12, 300_000);
    const controller = new AbortController();
    const report: ProtectReport = {};
    const onPhase = (phase: ProtectPhase) => {
      if (phase === 'checking') setTimeout(() => controller.abort(), 0); // pressed as the check starts
    };
    expect(await codeOf(protectPdf(scan, PASSWORD, { signal: controller.signal, report, onPhase }))).toBe('cancelled');
    expect(report).toEqual({});
  });

  it('Stop during the encryption takes effect before the next stream is encrypted', async () => {
    const controller = new AbortController();
    const original = CantooDocument.prototype.save;
    let saved = false;
    vi.spyOn(CantooDocument.prototype, 'save').mockImplementation(async function (this: CantooDocument, options) {
      controller.abort(); // the user presses Stop while the library is writing
      const bytes = await original.call(this, options);
      saved = true;
      return bytes;
    });
    const report: ProtectReport = {};
    expect(await codeOf(protectPdf(await makePdf('Ph', 3), PASSWORD, { signal: controller.signal, report }))).toBe('cancelled');
    expect(saved).toBe(false);
    expect(report).toEqual({});
  });
});

// ---- a large scan ---------------------------------------------------------------------------------

/** A JPEG pdf-lib accepts (it reads only the header) with `size` bytes of scan-like data after it. */
function scanLikeJpeg(size: number): Uint8Array {
  const header = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0d, 0xb4, 0x09, 0xb0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  const bytes = new Uint8Array(header.length + sos.length + size + 2);
  bytes.set(header);
  bytes.set(sos, header.length);
  let seed = 2026;
  for (let i = header.length + sos.length; i < bytes.length - 2; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    bytes[i] = (seed >>> 24) & 0x7f; // never 0xFF, so no marker inside the data
  }
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

/** `pages` pages, each drawing its own copy of one scan-like JPEG of `jpegBytes` bytes. */
async function makeScan(pages: number, jpegBytes: number): Promise<Uint8Array> {
  const jpeg = scanLikeJpeg(jpegBytes);
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const image = await doc.embedJpg(jpeg); // one repeated JPEG, embedded once per page
    doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return doc.save({ useObjectStreams: true });
}

/** This thread's processor time (ms) since `since`: the work itself, what an idle machine would take. */
const cpuMs = (since: NodeJS.CpuUsage) => {
  const used = process.threadCpuUsage(since);
  return (used.user + used.system) / 1000;
};

/**
 * The longest time the event loop was held since the last `take()`: what a screen would freeze for, in
 * this thread's processor time (`cpu`, what an idle machine would take: a busy machine stretches the clock
 * but not this) and on the clock (`wall`, logged only).
 */
function blockMeter() {
  let last = performance.now();
  let lastCpu = process.threadCpuUsage();
  let longest = 0;
  let longestCpu = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    longestCpu = Math.max(longestCpu, cpuMs(lastCpu));
    last = now;
    lastCpu = process.threadCpuUsage();
  }, 10);
  return {
    take: () => {
      const value = { cpu: Math.round(Math.max(longestCpu, cpuMs(lastCpu))), wall: Math.round(Math.max(longest, performance.now() - last)) };
      longest = 0;
      longestCpu = 0;
      last = performance.now();
      lastCpu = process.threadCpuUsage();
      return value;
    },
    stop: () => clearInterval(timer),
  };
}

describe('a 50 MB scan', () => {
  it('is protected and checked in reasonable time, about the same size, without holding the event loop long (times logged)', async () => {
    const scan = await makeScan(40, 1_300_000);
    expect(scan.length).toBeGreaterThan(50_000_000);
    // Times in this thread's processor time (INT3: the clock times failed on a loaded machine, WRAP's survey).
    const startCpu = process.threadCpuUsage();
    const marks: [string, number][] = [['start', 0]];
    const blocks: Record<string, { cpu: number; wall: number }> = {};
    let current = 'start';
    let peakArrayBuffers = process.memoryUsage().arrayBuffers;
    const report: ProtectReport = {};
    const meter = blockMeter();
    const result = await protectPdf(scan, PASSWORD, {
      report,
      onPhase: (phase) => {
        blocks[current] = meter.take();
        current = phase;
        marks.push([phase, cpuMs(startCpu)]);
        peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
      },
    });
    blocks[current] = meter.take();
    marks.push(['end', cpuMs(startCpu)]);
    peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
    // Before review F2 the check was one unsliced decrypting read and save (unlockPdf with the library's
    // defaults then; unlockPdf now always waits by the clock, INT3): time that, and unlockPdf in one-object
    // slices, back to back, so the cost of slicing shows under the same load.
    let started = process.threadCpuUsage();
    const unsliced = await CantooDocument.load(result, { password: PASSWORD, updateMetadata: false, parseSpeed: 1500 });
    await unsliced.save({ objectsPerTick: 1500 });
    const unlockDefaultMs = Math.round(cpuMs(started));
    blocks['one unsliced decrypting read and save (the check before)'] = meter.take();
    started = process.threadCpuUsage();
    await unlockPdf(result, PASSWORD, { objectsPerTick: 1 });
    const unlockSlicedMs = Math.round(cpuMs(started));
    blocks['unlockPdf in one-object slices'] = meter.take();
    meter.stop();
    console.warn(`opening the result: ${unlockDefaultMs} ms processor time unsliced, ${unlockSlicedMs} ms with unlockPdf in one-object slices`);
    const span = (from: string, to: string) => Math.round(marks.find(([m]) => m === to)![1] - marks.find(([m]) => m === from)![1]);
    const times = { preparing: span('preparing', 'encrypting'), encrypting: span('encrypting', 'checking'), checking: span('checking', 'end'), total: span('start', 'end') };
    // On stderr, which the test run prints for passing tests too.
    console.warn(
      `50 MB scan (${scan.length} bytes -> ${result.length}): processor time ${JSON.stringify(times)} ms; longest event-loop block per phase ${JSON.stringify(blocks)} ms; peak array buffers ${Math.round(peakArrayBuffers / 1048576)} MB`,
    );
    expect(blocks.checking.cpu).toBeLessThan(blocks['one unsliced decrypting read and save (the check before)'].cpu / 2);
    expect(Math.abs(result.length - scan.length) / scan.length).toBeLessThan(0.01);
    expect(report.pageCount).toBe(40);
    expect(report.unlocked!.length).toBeGreaterThan(50_000_000);
    // Loose bounds that catch work growing out of proportion, not a slow machine: on an idle machine the
    // library's save takes 6-9 s (spike-protect.md). In processor time, so a loaded machine (WRAP's survey:
    // 498 s of the 600 s on the clock) does not decide them; the test's own limit is a hang guard only.
    expect(times.encrypting).toBeLessThan(120_000);
    expect(times.total).toBeLessThan(400_000);
    expect(await pdfjsOpens(result)).toBe(1);
  }, 1_800_000);
});
