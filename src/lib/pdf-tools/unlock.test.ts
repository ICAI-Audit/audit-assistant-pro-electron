// Protected test files are made here with @cantoo/pdf-lib's encrypt(); only bytes cross between it and pdf-lib 1.17.1.
import {
  PDFBool as CantooBool,
  PDFDict as CantooDict,
  PDFDocument as CantooDocument,
  PDFHexString as CantooHexString,
  PDFName as CantooName,
  PDFRef as CantooRef,
  PDFString as CantooString,
} from '@cantoo/pdf-lib';
import { pdfDocEncodingDecode, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from './inspect';
import { makePdf, pageTexts } from './testPdf';
import { PdfToolsError } from './types';
import { tryOpenWithoutPassword, unlockPdf } from './unlock';

vi.setConfig({ testTimeout: 20_000 });

const SCHEMES = ['rc4-40', 'rc4-128', 'aes-128', 'aes-256'] as const;
type Scheme = (typeof SCHEMES)[number];
const ALGORITHMS = { 'rc4-40': 'RC4-40', 'rc4-128': 'RC4-128', 'aes-128': 'AES-128', 'aes-256': 'AES-256' } as const;

const PASSWORD = 'Test@123';
const OWNER = 'Owner#456';
const TITLE = 'Synthetic title ₹ αβγ';
const AUTHOR = 'VERA synthetic author';

const UNSUPPORTED = 'This file uses a kind of protection that cannot be opened here.';
const DAMAGED = 'This file is damaged and cannot be opened.';

/** A synthetic PDF ("<label> p<n>" on each page, with Title and Author) protected with the given scheme. */
async function makeProtectedPdf(
  label: string,
  pages: number,
  userPassword: string,
  scheme: Scheme,
  opts: { ownerPassword?: string; classicXref?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await CantooDocument.load(await makePdf(label, pages), { updateMetadata: false });
  doc.setTitle(TITLE);
  doc.setAuthor(AUTHOR);
  doc.encrypt({ userPassword, ownerPassword: opts.ownerPassword, algorithm: ALGORITHMS[scheme], allowWeakCryptography: true });
  // The default packs the Info dictionary into an encrypted object stream and writes a cross-reference
  // stream. classicXref writes every object on its own with an xref table and a plain trailer; the
  // library's writer then encrypts only streams, so encrypt the Info strings here as other tools do.
  if (opts.classicXref) encryptInfoStrings(doc);
  return doc.save({ useObjectStreams: !opts.classicXref });
}

function encryptInfoStrings(doc: CantooDocument) {
  const infoRef = doc.context.trailerInfo.Info as CantooRef;
  const info = doc.context.lookup(infoRef, CantooDict);
  const seal = doc.context.security!.getEncryptFn(infoRef.objectNumber, infoRef.generationNumber);
  for (const [key, value] of info.entries()) {
    if (!(value instanceof CantooString || value instanceof CantooHexString)) continue;
    const hex = Array.from(seal(value.asBytes()), (byte) => byte.toString(16).padStart(2, '0')).join('');
    info.set(key, CantooHexString.of(hex));
  }
}

/** Title and raw XMP as pdfjs-dist reads them: an independent check on both the protected input and the result. */
async function pdfjsMetadata(bytes: Uint8Array, password?: string): Promise<{ title: unknown; xmp: unknown }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), password, isEvalSupported: false }).promise;
  const { info, metadata } = await pdf.getMetadata();
  await pdf.destroy();
  return { title: (info as { Title?: unknown }).Title, xmp: metadata?.getRaw() };
}

const pdfjsTitle = async (bytes: Uint8Array, password?: string) => (await pdfjsMetadata(bytes, password)).title;

const XMP = new TextEncoder().encode(
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Synthetic XMP ₹</rdf:li>' +
    '</rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
);

/**
 * AES-256 file with /EncryptMetadata false: the document's XMP stream is stored unencrypted, as
 * Acrobat's "do not encrypt metadata" and qpdf --cleartext-metadata write it. The library's encrypt()
 * cannot do this, so the XMP object is left out of encryption and the flag is set afterwards
 * (for AES-256 the flag does not enter the file key).
 */
async function makeClearMetadataPdf(classicXref: boolean): Promise<Uint8Array> {
  const doc = await CantooDocument.load(await makePdf('M', 2), { updateMetadata: false });
  const xmpRef = doc.context.register(doc.context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' }));
  doc.catalog.set(CantooName.of('Metadata'), xmpRef);
  doc.encrypt({ userPassword: PASSWORD, algorithm: 'AES-256' });
  doc.context.lookup(doc.context.trailerInfo.Encrypt, CantooDict).set(CantooName.of('EncryptMetadata'), CantooBool.False);
  if (classicXref) encryptInfoStrings(doc);
  const security = doc.context.security!;
  const seal = security.getEncryptFn.bind(security);
  security.getEncryptFn = (obj, gen) => (obj === xmpRef.objectNumber ? (bytes: Uint8Array) => bytes : seal(obj, gen));
  return doc.save({ useObjectStreams: !classicXref });
}

/** Replaces the first occurrence of an ASCII run. Lengths may differ: both libraries read objects in sequence. */
function edit(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const at = latin1(bytes).indexOf(from);
  expect(at).toBeGreaterThan(0);
  const replacement = new TextEncoder().encode(to);
  const out = new Uint8Array(bytes.length - from.length + replacement.length);
  out.set(bytes.subarray(0, at));
  out.set(replacement, at);
  out.set(bytes.subarray(at + from.length), at + replacement.length);
  return out;
}

/** Cuts a password check (/O or /U) of the security dictionary down to 10 bytes. */
function shortenPasswordCheck(bytes: Uint8Array, key: 'O' | 'U'): Uint8Array {
  const raw = latin1(bytes);
  const start = raw.indexOf(`/${key} <`) + key.length + 3;
  const end = raw.indexOf('>', start);
  return edit(bytes, raw.slice(start - 1, end + 1), `<${raw.slice(start, start + 20)}>`);
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The password must not be in the bytes, whether written as UTF-8 or one byte per character. */
function expectPasswordAbsent(bytes: Uint8Array, password: string) {
  expect(containsBytes(bytes, new TextEncoder().encode(password))).toBe(false);
  expect(latin1(bytes)).not.toContain(password);
}

/** Security-handler dictionaries (/Filter /Standard, or /O and /U password checks) left anywhere in the file. */
function securityDictionaries(doc: PDFDocument): string[] {
  const found: string[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : undefined;
    if (!dict) continue;
    const standard = dict.get(PDFName.of('Filter')) === PDFName.of('Standard');
    const passwordChecks = dict.has(PDFName.of('O')) && dict.has(PDFName.of('U'));
    if (standard || passwordChecks) found.push(ref.toString());
  }
  return found;
}

/** Locks in the second fix: the result is genuinely unprotected, not just readable. */
async function expectUnprotected(bytes: Uint8Array, texts: string[]) {
  const raw = latin1(bytes);
  expect(raw).not.toMatch(/\/Encrypt\b/); // no /Encrypt in the trailer (or anywhere uncompressed)
  expect(raw).not.toMatch(/\/Filter\s*\/Standard\b/);
  expect(raw.match(/\/Type\s*\/XRef\b/g)?.length ?? 0).toBeLessThanOrEqual(1); // only the file's own, no stale one
  const doc = await PDFDocument.load(bytes, { updateMetadata: false }); // pdf-lib 1.17.1, WITHOUT ignoreEncryption
  expect(doc.isEncrypted).toBe(false);
  expect(doc.context.trailerInfo.Encrypt).toBeUndefined();
  expect(securityDictionaries(doc)).toEqual([]); // also sees objects packed inside object streams
  expect(await inspectPdf(bytes)).toMatchObject({ encrypted: false, pageCount: texts.length });
  expect(await pageTexts(bytes)).toEqual(texts);
}

/** Locks in the first fix: the trailer /Info link survives, so the document properties do. */
async function expectPropertiesKept(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getTitle()).toBe(TITLE);
  expect(doc.getAuthor()).toBe(AUTHOR);
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

/** Replaces one ASCII run of the file with another of the same length, so cross-reference offsets stay valid. */
function patch(bytes: Uint8Array, from: string, to: string): Uint8Array {
  expect(to.length).toBe(from.length);
  const at = latin1(bytes).indexOf(from);
  expect(at).toBeGreaterThan(0);
  const out = bytes.slice();
  out.set(new TextEncoder().encode(to), at);
  return out;
}

const fixtures = new Map<Scheme, Uint8Array>(); // user PASSWORD, owner OWNER, cross-reference stream
const classicFixtures = new Map<Scheme, Uint8Array>(); // same, with a classic xref table and trailer

beforeAll(async () => {
  await import('@cantoo/pdf-lib'); // pay the cold imports once
  await pageTexts(await makePdf('warm', 1));
  for (const scheme of SCHEMES) {
    fixtures.set(scheme, await makeProtectedPdf('U', 3, PASSWORD, scheme, { ownerPassword: OWNER }));
    classicFixtures.set(scheme, await makeProtectedPdf('U', 3, PASSWORD, scheme, { ownerPassword: OWNER, classicXref: true }));
  }
}, 30_000);

describe('unlockPdf and tryOpenWithoutPassword', () => {
  it('opens each scheme with its password, refuses a wrong one, and needs a password (brief)', async () => {
    for (const scheme of ['rc4-40', 'rc4-128', 'aes-128', 'aes-256'] as const) {
      const locked = await makeProtectedPdf('S', 3, 'Test@123', scheme);
      expect((await inspectPdf(locked)).encrypted).toBe(true);
      const open = await unlockPdf(locked, 'Test@123');
      expect(await inspectPdf(open)).toMatchObject({ encrypted: false, pageCount: 3 });
      expect(await pageTexts(open)).toEqual(['S p1', 'S p2', 'S p3']);
      await expect(unlockPdf(locked, 'wrong')).rejects.toMatchObject({ code: 'wrong-password' });
      expect(await tryOpenWithoutPassword(locked)).toBeNull();
      expect(new TextDecoder('latin1').decode(open)).not.toContain('Test@123');
    }
    const ownerOnly = await makeProtectedPdf('R', 2, '', 'aes-256', { ownerPassword: 'owner' });
    expect(await pageTexts((await tryOpenWithoutPassword(ownerOnly))!)).toEqual(['R p1', 'R p2']);
  });

  it.each(SCHEMES)('%s: leaves no security dictionary, no /Encrypt and no stale cross-reference stream', async (scheme) => {
    for (const locked of [fixtures.get(scheme)!, classicFixtures.get(scheme)!]) {
      const open = await unlockPdf(locked, PASSWORD);
      await expectUnprotected(open, ['U p1', 'U p2', 'U p3']);
      expectPasswordAbsent(open, PASSWORD);
      expectPasswordAbsent(open, OWNER);
    }
  });

  it.each(SCHEMES)('%s: keeps the document properties (Title, Author)', async (scheme) => {
    for (const locked of [fixtures.get(scheme)!, classicFixtures.get(scheme)!]) {
      expect(await pdfjsTitle(locked, PASSWORD)).toBe(TITLE); // the fixture itself is well formed
      const open = await unlockPdf(locked, PASSWORD);
      await expectPropertiesKept(open);
      expect(await pdfjsTitle(open)).toBe(TITLE);
    }
  });

  it.each(SCHEMES)('%s: opens with the owner password as well as the user password', async (scheme) => {
    const open = await unlockPdf(fixtures.get(scheme)!, OWNER);
    await expectUnprotected(open, ['U p1', 'U p2', 'U p3']);
    await expectPropertiesKept(open);
    expectPasswordAbsent(open, OWNER);
  });

  it.each(SCHEMES)('%s: refuses wrong and empty passwords with a plain message that repeats no password', async (scheme) => {
    const locked = fixtures.get(scheme)!;
    for (const attempt of ['Wrong@999', 'test@123', 'Test@1234', 'Test@12', ' Test@123', '']) {
      const error = await caught(unlockPdf(locked, attempt));
      expect(error).toBeInstanceOf(PdfToolsError);
      expect(error).toMatchObject({ code: 'wrong-password' });
      const { message } = error as PdfToolsError;
      expect(message.length).toBeGreaterThan(0);
      if (attempt) expect(message).not.toContain(attempt);
      expect(message).not.toContain(PASSWORD);
      expect(message).not.toContain(OWNER);
      expect((error as { cause?: unknown }).cause).toBeUndefined();
    }
    expect(await tryOpenWithoutPassword(locked)).toBeNull();
  });

  it.each(SCHEMES)('%s: opens a restrictions-only file (owner password, empty user password) without asking', async (scheme) => {
    const ownerOnly = await makeProtectedPdf('R', 2, '', scheme, { ownerPassword: 'owner' });
    expect((await inspectPdf(ownerOnly)).encrypted).toBe(true);
    const open = await tryOpenWithoutPassword(ownerOnly);
    expect(open).not.toBeNull();
    await expectUnprotected(open!, ['R p1', 'R p2']);
    await expectPropertiesKept(open!);
    await expectUnprotected(await unlockPdf(ownerOnly, ''), ['R p1', 'R p2']);
    await expectUnprotected(await unlockPdf(ownerOnly, 'owner'), ['R p1', 'R p2']);
    await expect(unlockPdf(ownerOnly, 'not-the-owner')).rejects.toMatchObject({ code: 'wrong-password' });
  });

  it('opens AES-256 files with Devanagari and accented passwords', async () => {
    for (const password of ['पासवर्ड१२३', 'pässwört']) {
      const locked = await makeProtectedPdf('N', 2, password, 'aes-256');
      const open = await unlockPdf(locked, password);
      await expectUnprotected(open, ['N p1', 'N p2']);
      expectPasswordAbsent(open, password);
      expect(await tryOpenWithoutPassword(locked)).toBeNull();
    }
    const devanagari = await makeProtectedPdf('N', 1, 'पासवर्ड१२३', 'aes-256');
    await expect(unlockPdf(devanagari, 'पासवर्ड१२')).rejects.toMatchObject({ code: 'wrong-password' });
    await expect(unlockPdf(devanagari, 'पासवर्ड123')).rejects.toMatchObject({ code: 'wrong-password' });
  });

  it.each(['rc4-40', 'rc4-128', 'aes-128'] as const)('%s: opens a file with an accented (Latin-1) password', async (scheme) => {
    const locked = await makeProtectedPdf('L', 2, 'pässwört', scheme);
    const open = await unlockPdf(locked, 'pässwört');
    await expectUnprotected(open, ['L p1', 'L p2']);
    expectPasswordAbsent(open, 'pässwört');
    await expect(unlockPdf(locked, 'passwort')).rejects.toMatchObject({ code: 'wrong-password' });
  });

  it.each(['rc4-40', 'rc4-128', 'aes-128'] as const)(
    '%s: a password outside Latin-1 cannot be set by the test library, and is refused as wrong on these files',
    async (scheme) => {
      // The older schemes only define one byte per character; @cantoo/pdf-lib refuses to create such a file.
      await expect(makeProtectedPdf('X', 1, 'पासवर्ड१२३', scheme)).rejects.toThrow();
      await expect(unlockPdf(fixtures.get(scheme)!, 'पासवर्ड१२३')).rejects.toMatchObject({ code: 'wrong-password' });
    },
  );

  it.each(SCHEMES)('%s: opens a file with a 200-character password', async (scheme) => {
    const long = 'Ab1#-'.repeat(40);
    expect(long).toHaveLength(200);
    const locked = await makeProtectedPdf('G', 1, long, scheme);
    const open = await unlockPdf(locked, long);
    await expectUnprotected(open, ['G p1']);
    expectPasswordAbsent(open, long);
    await expect(unlockPdf(locked, long.slice(0, 20))).rejects.toMatchObject({ code: 'wrong-password' });
  });

  it('follows the PDF standard on long passwords: 32 bytes count for RC4 and AES-128, 127 for AES-256', async () => {
    const long = 'Ab1#-'.repeat(40);
    for (const scheme of ['rc4-40', 'rc4-128', 'aes-128'] as const) {
      const locked = await makeProtectedPdf('G', 1, long, scheme);
      expect(await pageTexts(await unlockPdf(locked, long.slice(0, 32)))).toEqual(['G p1']);
      await expect(unlockPdf(locked, long.slice(0, 31))).rejects.toMatchObject({ code: 'wrong-password' });
    }
    const aes256 = await makeProtectedPdf('G', 1, long, 'aes-256');
    expect(await pageTexts(await unlockPdf(aes256, long.slice(0, 127)))).toEqual(['G p1']);
    await expect(unlockPdf(aes256, long.slice(0, 126))).rejects.toMatchObject({ code: 'wrong-password' });
  });

  it('returns a valid file that is not protected unchanged, as the same array', async () => {
    const objectStreams = await makePdf('P', 2);
    const classic = await (await PDFDocument.load(objectStreams)).save({ useObjectStreams: false });
    for (const plain of [objectStreams, classic]) {
      expect(await unlockPdf(plain, 'anything')).toBe(plain);
      expect(await unlockPdf(plain, '')).toBe(plain);
      expect(await tryOpenWithoutPassword(plain)).toBe(plain);
    }
  });

  it.each([true, false])('refuses a protected file whose end is cut off (classic xref: %s)', async (classicXref) => {
    // Without its trailer the file no longer says it is protected, but its contents are still encrypted.
    const locked = await makeProtectedPdf('T', 40, PASSWORD, 'aes-128', { classicXref });
    const raw = latin1(locked);
    const cuts = classicXref
      ? [raw.lastIndexOf('trailer'), Math.floor(locked.length * 0.98)]
      : [raw.lastIndexOf('\n', raw.lastIndexOf(' obj', raw.lastIndexOf('/Type /XRef'))) + 1]; // before the cross-reference stream
    for (const cut of cuts) {
      const bytes = locked.slice(0, cut);
      for (const password of [PASSWORD, '']) {
        await expect(unlockPdf(bytes, password)).rejects.toMatchObject({ code: 'unlock-failed', message: DAMAGED });
      }
      await expect(tryOpenWithoutPassword(bytes)).rejects.toMatchObject({ code: 'unlock-failed', message: DAMAGED });
    }
  });

  it('refuses an unprotected file whose trailer is cut off rather than return it', async () => {
    const classic = await (await PDFDocument.load(await makePdf('P', 2))).save({ useObjectStreams: false });
    const bytes = classic.slice(0, latin1(classic).lastIndexOf('trailer'));
    await expect(unlockPdf(bytes, '')).rejects.toMatchObject({ code: 'unlock-failed', message: DAMAGED });
  });

  it.each([true, false])('keeps clear-text XMP metadata (/EncryptMetadata false) byte for byte (classic xref: %s)', async (classicXref) => {
    const locked = await makeClearMetadataPdf(classicXref);
    const xmpText = new TextDecoder().decode(XMP);
    expect((await pdfjsMetadata(locked, PASSWORD)).xmp).toBe(xmpText); // the fixture itself is well formed
    const open = await unlockPdf(locked, PASSWORD);
    await expectUnprotected(open, ['M p1', 'M p2']);
    const doc = await PDFDocument.load(open, { updateMetadata: false });
    const stream = doc.context.lookup(doc.catalog.get(PDFName.of('Metadata')));
    expect(stream).toBeInstanceOf(PDFRawStream);
    expect((stream as PDFRawStream).contents).toEqual(XMP);
    expect((await pdfjsMetadata(open)).xmp).toBe(xmpText);
  });

  const unsupportedLayouts: [string, () => Uint8Array][] = [
    ['AES-128, strings not encrypted (StrF /Identity)', () => edit(fixtures.get('aes-128')!, '/StrF /StdCF', '/StrF /Identity')],
    ['AES-256, strings not encrypted (StrF /Identity)', () => edit(fixtures.get('aes-256')!, '/StrF /StdCF', '/StrF /Identity')],
    ['AES-128, streams not encrypted (StmF /Identity)', () => edit(fixtures.get('aes-128')!, '/StmF /StdCF', '/StmF /Identity')],
    ['AES-128, attachments filtered differently (EFF /Identity)', () => edit(fixtures.get('aes-128')!, '/StrF /StdCF', '/StrF /StdCF\n/EFF /Identity')],
    ['AES-256, unknown revision /R 7', () => patch(fixtures.get('aes-256')!, '/R 6', '/R 7')],
    ['AES-256, certificate security /Adobe.PubSec', () => edit(fixtures.get('aes-256')!, '/Filter /Standard', '/Filter /Adobe.PubSec')],
    ['AES-256, version 5 with revision 4', () => patch(fixtures.get('aes-256')!, '/R 6', '/R 4')],
    ['RC4-128, version 2 with revision 4', () => patch(fixtures.get('rc4-128')!, '/R 3', '/R 4')],
    ['AES-128, unknown cipher /CFM /AESV9', () => patch(fixtures.get('aes-128')!, '/CFM /AESV2', '/CFM /AESV9')],
    ['AES-256, stream filter missing from /CF', () => patch(fixtures.get('aes-256')!, '/StdCF <<', '/XxxCF <<')],
    ['AES-128, cipher declared as none (/CFM /None)', () => patch(fixtures.get('aes-128')!, '/CFM /AESV2', '/CFM /None ')],
    ['AES-256, cipher that does not match version 5 (/CFM /AESV2)', () => patch(fixtures.get('aes-256')!, '/CFM /AESV3', '/CFM /AESV2')],
  ];

  it.each(unsupportedLayouts)('refuses an unsupported protection layout whatever the password: %s', async (_label, make) => {
    const bytes = make();
    expect((await inspectPdf(bytes)).encrypted).toBe(true);
    for (const password of [PASSWORD, OWNER, 'Wrong@999', '']) {
      await expect(unlockPdf(bytes, password)).rejects.toMatchObject({ code: 'unlock-failed', message: UNSUPPORTED });
    }
    await expect(tryOpenWithoutPassword(bytes)).rejects.toMatchObject({ code: 'unlock-failed', message: UNSUPPORTED });
  });

  it('still opens a file whose attachment filter is the same as its stream filter (EFF = StmF)', async () => {
    const bytes = edit(fixtures.get('aes-128')!, '/StrF /StdCF', '/StrF /StdCF\n/EFF /StdCF');
    await expectUnprotected(await unlockPdf(bytes, PASSWORD), ['U p1', 'U p2', 'U p3']);
  });

  it('reports a damaged password check (/O or /U too short) as damaged, not as a wrong password', async () => {
    const damaged = [
      shortenPasswordCheck(fixtures.get('rc4-128')!, 'U'),
      shortenPasswordCheck(fixtures.get('aes-128')!, 'O'),
      shortenPasswordCheck(fixtures.get('aes-256')!, 'U'),
    ];
    for (const bytes of damaged) {
      await expect(unlockPdf(bytes, PASSWORD)).rejects.toMatchObject({ code: 'unlock-failed', message: DAMAGED });
      await expect(tryOpenWithoutPassword(bytes)).rejects.toMatchObject({ code: 'unlock-failed', message: DAMAGED });
    }
  });

  it('ignores a stray /StmF on an RC4 file (version 2), where crypt filters do not apply', async () => {
    const bytes = edit(fixtures.get('rc4-128')!, '/R 3', '/R 3\n/StmF /StdCF');
    await expectUnprotected(await unlockPdf(bytes, PASSWORD), ['U p1', 'U p2', 'U p3']);
  });

  // How other programs store a non-Latin password in an RC4 or AES-128 file (one byte per character):
  // in PDFDocEncoding when every character has a code there, otherwise as its UTF-8 bytes (qpdf does this).
  const utf8Spelling = (text: string) => String.fromCharCode(...new TextEncoder().encode(text.normalize('NFC')));
  const storedSpellings: [string, string][] = [
    ['पासवर्ड१२३', utf8Spelling('पासवर्ड१२३')], // Devanagari: not in PDFDocEncoding
    ['Rs₹500', utf8Spelling('Rs₹500')], // ₹: not in PDFDocEncoding
    ['Pay€2024', 'Pay\u00A02024'], // € is 0xA0 in PDFDocEncoding
    ['naïve–dash', 'naïve\u0085dash'], // ï is Latin-1, – (en dash) is 0x85
  ];

  it.each(['rc4-128', 'aes-128'] as const)('%s: opens files whose non-Latin password was stored as PDFDocEncoding or UTF-8 bytes', async (scheme) => {
    for (const [typed, stored] of storedSpellings) {
      const locked = await makeProtectedPdf('B', 1, stored, scheme);
      expect(await pageTexts(await unlockPdf(locked, typed)), typed).toEqual(['B p1']);
      expect(await pageTexts(await unlockPdf(locked, typed.normalize('NFD'))), `${typed} (NFD)`).toEqual(['B p1']);
    }
  });

  it('maps every PDFDocEncoding character to the code that decodes back to it (checked against pdf-lib)', async () => {
    // Every code PDFDocEncoding defines (Annex D): 0x09, 0x0A, 0x0D, 0x18-0x7E, 0x80-0x9E, 0xA0-0xFF except 0xAD.
    const codes = [0x09, 0x0a, 0x0d];
    for (let code = 0x18; code <= 0xff; code++) if (code !== 0x7f && code !== 0x9f && code !== 0xad) codes.push(code);
    const text = pdfDocEncodingDecode(Uint8Array.from(codes));
    expect(text).not.toContain('\uFFFD');
    const locked = await makeProtectedPdf('D', 1, String.fromCharCode(...codes.slice(0, 32)), 'rc4-128');
    expect(await pageTexts(await unlockPdf(locked, text.slice(0, 32)))).toEqual(['D p1']);
    for (let start = 32; start < codes.length; start += 32) {
      const chunk = codes.slice(start, start + 32);
      const file = await makeProtectedPdf('D', 1, String.fromCharCode(...chunk), 'aes-128');
      const typed = pdfDocEncodingDecode(Uint8Array.from(chunk));
      expect(await pageTexts(await unlockPdf(file, typed)), JSON.stringify(typed)).toEqual(['D p1']);
    }
  });

  it('tries an ASCII password once, a non-ASCII one at most five times, and AES-256 files without byte spellings', async () => {
    const decomposed = 'Wrong-ﬁ-é-€'.normalize('NFD'); // NFD, NFC, NFKC, PDFDocEncoding and UTF-8 spellings all differ
    const rc4 = fixtures.get('rc4-128')!;
    const aes256 = fixtures.get('aes-256')!;
    const load = vi.spyOn(CantooDocument, 'load');
    const attempts = async (bytes: Uint8Array, password: string) => {
      load.mockClear();
      await expect(unlockPdf(bytes, password)).rejects.toMatchObject({ code: 'wrong-password' });
      return load.mock.calls.filter(([, options]) => options?.password !== undefined).length;
    };
    try {
      expect(await attempts(rc4, 'Wrong@999')).toBe(1);
      expect(await attempts(rc4, decomposed)).toBe(5);
      expect(await attempts(rc4, 'पासवर्ड१२३')).toBe(2); // the UTF-8 spelling; no PDFDocEncoding spelling exists
      expect(await attempts(aes256, 'Wrong@999')).toBe(1);
      expect(await attempts(aes256, decomposed)).toBe(3); // as before: typed, NFC and NFKC only
    } finally {
      load.mockRestore();
    }
  });

  it('opens a file when the password is typed in another Unicode form', async () => {
    const composed = 'pässwört'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    for (const scheme of ['aes-256', 'aes-128'] as const) {
      const locked = await makeProtectedPdf('C', 1, composed, scheme);
      expect(await pageTexts(await unlockPdf(locked, decomposed))).toEqual(['C p1']);
      await expect(unlockPdf(locked, 'päßwört'.normalize('NFD'))).rejects.toMatchObject({ code: 'wrong-password' });
    }
    // Compatibility forms: a ligature and a full-width letter stand for their plain letters (NFKC).
    for (const scheme of ['aes-256', 'rc4-128'] as const) {
      const locked = await makeProtectedPdf('K', 1, 'file-Test@123', scheme);
      expect(await pageTexts(await unlockPdf(locked, 'ﬁle-Ｔest@123'))).toEqual(['K p1']);
      await expect(unlockPdf(locked, 'ﬁle-Ｔest@124')).rejects.toMatchObject({ code: 'wrong-password' });
    }
  });

  it('reports a damaged protected file as unlock-failed, not as a wrong password', async () => {
    const locked = fixtures.get('aes-256')!;
    const damaged = [
      patch(locked, '/Filter /Standard', '/Filter /Stbndard'), // unknown security handler
      patch(locked, '/V 5', '/V 9'), // unsupported algorithm version
      locked.slice(0, 200), // cut off: only the header and part of the first object remain
    ];
    for (const bytes of damaged) {
      await expect(unlockPdf(bytes, PASSWORD)).rejects.toMatchObject({ code: 'unlock-failed' });
      await expect(tryOpenWithoutPassword(bytes)).rejects.toMatchObject({ code: 'unlock-failed' });
    }
    const error = await caught(unlockPdf(damaged[0], PASSWORD));
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as Error).message).not.toContain(PASSWORD);
  });

  it('reports a file that is not a PDF as unlock-failed', async () => {
    const noise = Uint8Array.from({ length: 512 }, (_, i) => (i * 37 + 11) & 0xff);
    for (const bytes of [new TextEncoder().encode('hello, this is not a PDF'), noise, new Uint8Array()]) {
      await expect(unlockPdf(bytes, PASSWORD)).rejects.toMatchObject({ code: 'unlock-failed' });
      await expect(tryOpenWithoutPassword(bytes)).rejects.toMatchObject({ code: 'unlock-failed' });
    }
  });

  it('does not change the input bytes', async () => {
    const locked = fixtures.get('aes-128')!;
    const before = locked.slice();
    await unlockPdf(locked, PASSWORD);
    await caught(unlockPdf(locked, 'Wrong@999'));
    await tryOpenWithoutPassword(locked);
    expect(locked).toEqual(before);
  });

  describe('password secrecy', () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('never writes a password to the console or into an error, on failure or success', async () => {
      const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
      const wrong = 'Wr0ng-Secret-Ω7';
      const decomposedWrong = 'Wr0ng-Sécret-ﬁ'.normalize('NFD'); // retried in NFC and NFKC form
      const errors: unknown[] = [];
      for (const scheme of SCHEMES) {
        errors.push(await caught(unlockPdf(fixtures.get(scheme)!, wrong)));
        errors.push(await caught(unlockPdf(fixtures.get(scheme)!, decomposedWrong)));
        errors.push(await caught(unlockPdf(fixtures.get(scheme)!, '')));
        await unlockPdf(fixtures.get(scheme)!, PASSWORD);
        await unlockPdf(fixtures.get(scheme)!, OWNER);
        await tryOpenWithoutPassword(fixtures.get(scheme)!);
      }
      errors.push(await caught(unlockPdf(patch(fixtures.get('aes-256')!, '/V 5', '/V 9'), PASSWORD)));

      const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(' '));
      expect(logged).toEqual([]); // nothing at all is logged on these paths today
      const variants = [
        decomposedWrong,
        decomposedWrong.normalize('NFC'),
        decomposedWrong.normalize('NFKC'),
        'Wr0ng-Sécret-\u0093', // its PDFDocEncoding spelling (ﬁ is 0x93), tried on RC4 and AES-128 files
        String.fromCharCode(...new TextEncoder().encode(decomposedWrong.normalize('NFC'))), // its UTF-8 spelling
      ];
      expect(new Set(variants).size).toBe(5);
      for (const secret of [wrong, ...variants, PASSWORD, OWNER]) {
        for (const line of logged) expect(line).not.toContain(secret);
        for (const error of errors) {
          expect(error).toBeInstanceOf(PdfToolsError);
          const { message, stack, cause } = error as Error & { cause?: unknown };
          expect(message).not.toContain(secret);
          expect(String(stack)).not.toContain(secret);
          expect(cause).toBeUndefined();
          expect(JSON.stringify(error)).not.toContain(secret);
        }
      }
    });
  });
});
