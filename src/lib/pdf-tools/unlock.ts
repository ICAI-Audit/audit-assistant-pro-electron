// Opens password-protected PDFs and returns an unprotected copy in memory.
//
// @cantoo/pdf-lib (a fork of pdf-lib that can decrypt) is used here and nowhere else, and is
// loaded on first use so it stays out of the main bundle. Its objects never leave this module:
// the result is plain bytes for pdf-lib 1.17.1. The password is handed straight to the library;
// it is never stored, logged, or put into an error.
import type { PDFDocument as CantooDocument } from '@cantoo/pdf-lib';
import { PdfToolsError } from './types';

type Library = typeof import('@cantoo/pdf-lib');

// @cantoo/pdf-lib 2.11.1 has no error class for these: a wrong password throws
// Error('Password incorrect'), and an empty password that does not open the file Error('NEEDS PASSWORD').
// It also throws them for security dictionaries it cannot handle, so checkSecurityHandler runs first.
const WRONG_PASSWORD_MESSAGES = new Set(['Password incorrect', 'NEEDS PASSWORD']);

// Revisions (/R) that go with each algorithm version (/V) and that the library implements.
const REVISIONS = new Map([
  [1, [2, 3]],
  [2, [2, 3]],
  [4, [4]],
  [5, [5, 6]],
]);

// PDFDocEncoding (ISO 32000-1, Annex D, Table D.2): the characters whose codes differ from Latin-1.
const PDF_DOC_ENCODING = new Map<string, number>([
  ['˘', 0x18], // breve
  ['ˇ', 0x19], // caron
  ['ˆ', 0x1a], // modifier letter circumflex accent
  ['˙', 0x1b], // dot above
  ['˝', 0x1c], // double acute accent
  ['˛', 0x1d], // ogonek
  ['˚', 0x1e], // ring above
  ['˜', 0x1f], // small tilde
  ['•', 0x80], // bullet
  ['†', 0x81], // dagger
  ['‡', 0x82], // double dagger
  ['…', 0x83], // horizontal ellipsis
  ['—', 0x84], // em dash
  ['–', 0x85], // en dash
  ['ƒ', 0x86], // latin small letter f with hook (florin)
  ['⁄', 0x87], // fraction slash
  ['‹', 0x88], // single left-pointing angle quotation mark
  ['›', 0x89], // single right-pointing angle quotation mark
  ['−', 0x8a], // minus sign
  ['‰', 0x8b], // per mille sign
  ['„', 0x8c], // double low-9 quotation mark
  ['“', 0x8d], // left double quotation mark
  ['”', 0x8e], // right double quotation mark
  ['‘', 0x8f], // left single quotation mark
  ['’', 0x90], // right single quotation mark
  ['‚', 0x91], // single low-9 quotation mark
  ['™', 0x92], // trade mark sign
  ['ﬁ', 0x93], // latin small ligature fi
  ['ﬂ', 0x94], // latin small ligature fl
  ['Ł', 0x95], // latin capital letter l with stroke
  ['Œ', 0x96], // latin capital ligature oe
  ['Š', 0x97], // latin capital letter s with caron
  ['Ÿ', 0x98], // latin capital letter y with diaeresis
  ['Ž', 0x99], // latin capital letter z with caron
  ['ı', 0x9a], // latin small letter dotless i
  ['ł', 0x9b], // latin small letter l with stroke
  ['œ', 0x9c], // latin small ligature oe
  ['š', 0x9d], // latin small letter s with caron
  ['ž', 0x9e], // latin small letter z with caron
  ['€', 0xa0], // euro sign
]);

/** Codes PDFDocEncoding shares with Latin-1. 0x7F, 0x9F and 0xAD are undefined there. */
const isSharedWithLatin1 = (code: number) =>
  code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff && code !== 0xad);

/** The password spelled one byte per character in PDFDocEncoding, or undefined if a character has no code there. */
function pdfDocEncodingSpelling(password: string): string | undefined {
  let spelling = '';
  for (const character of password) {
    const code = PDF_DOC_ENCODING.get(character) ?? character.codePointAt(0)!;
    if (!PDF_DOC_ENCODING.has(character) && !isSharedWithLatin1(code)) return undefined;
    spelling += String.fromCharCode(code);
  }
  return spelling;
}

/**
 * The spellings of a typed password to try, in order and without repeats: as typed, then NFC and
 * NFKC (decomposed accents, full-width letters, ligatures). RC4 and AES-128 files (R 4 or lower)
 * hold one byte per character, and other programs store a non-ASCII password there in
 * PDFDocEncoding (as the standard asks) or, where that has no code for a character, as its UTF-8
 * bytes; those two spellings are tried last.
 */
function passwordSpellings(password: string, oneBytePerCharacter: boolean): string[] {
  const composed = password.normalize('NFC');
  const spellings = [password, composed, password.normalize('NFKC')];
  if (oneBytePerCharacter && Array.from(password).some((character) => character.charCodeAt(0) > 0x7f)) {
    const pdfDoc = pdfDocEncodingSpelling(composed);
    if (pdfDoc !== undefined) spellings.push(pdfDoc);
    spellings.push(String.fromCharCode(...new TextEncoder().encode(composed)));
  }
  return spellings.filter((spelling, index) => spellings.indexOf(spelling) === index);
}

const wrongPassword = () => new PdfToolsError('wrong-password', 'The password is not correct. Check it and try again.');
const damaged = () => new PdfToolsError('unlock-failed', 'This file is damaged and cannot be opened.');
const unsupported = () => new PdfToolsError('unlock-failed', 'This file uses a kind of protection that cannot be opened here.');
const unlockFailed = () =>
  new PdfToolsError(
    'unlock-failed',
    'This file could not be unlocked. It may be damaged, or use a kind of protection that is not supported.',
  );

function hasPages(doc: CantooDocument): boolean {
  try {
    return doc.getPageCount() > 0;
  } catch {
    return false;
  }
}

/**
 * Refuses security dictionaries the library would decrypt wrongly or report as a wrong password
 * whatever is typed. Returns the error to throw, or undefined when the file can be tried.
 */
function checkSecurityHandler(lib: Library, encrypt: unknown): PdfToolsError | undefined {
  const { PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } = lib;
  if (!(encrypt instanceof PDFDict) || encrypt.lookup(PDFName.of('Filter')) !== PDFName.of('Standard')) return unsupported();
  const version = encrypt.lookup(PDFName.of('V'));
  const revision = encrypt.lookup(PDFName.of('R'));
  if (!(version instanceof PDFNumber) || !(revision instanceof PDFNumber)) return unsupported();
  if (!REVISIONS.get(version.asNumber())?.includes(revision.asNumber())) return unsupported();

  // Crypt filters exist only from version 4; RC4 files (versions 1 and 2) ignore StmF, StrF and EFF.
  if (version.asNumber() >= 4) {
    // The library decrypts every stream with the string filter and ignores the embedded-file filter,
    // so only files that use one filter for all three are decrypted correctly. Absent means /Identity.
    const identity = PDFName.of('Identity');
    const streamFilter = encrypt.lookup(PDFName.of('StmF')) ?? identity;
    const stringFilter = encrypt.lookup(PDFName.of('StrF')) ?? identity;
    const fileFilter = encrypt.lookup(PDFName.of('EFF')) ?? streamFilter;
    if (streamFilter !== stringFilter || fileFilter !== streamFilter) return unsupported();

    // That filter must be defined, with the cipher its version prescribes. Otherwise the library
    // decrypts with no cipher or the wrong one, or cannot read any stream, and the pages would come
    // out garbled or blank instead of failing.
    if (streamFilter !== identity) {
      const filters = encrypt.lookup(PDFName.of('CF'));
      const filter = filters instanceof PDFDict && streamFilter instanceof PDFName ? filters.lookup(streamFilter) : undefined;
      const method = filter instanceof PDFDict ? filter.lookup(PDFName.of('CFM')) : undefined;
      const allowed = version.asNumber() === 4 ? ['V2', 'AESV2'] : ['AESV3'];
      if (!allowed.some((name) => method === PDFName.of(name))) return unsupported();
    }
  }

  // Cut-down password checks would otherwise be reported as a wrong password.
  const checkLength = revision.asNumber() >= 5 ? 48 : 32;
  for (const key of ['O', 'U']) {
    const check = encrypt.lookup(PDFName.of(key));
    if (!(check instanceof PDFString || check instanceof PDFHexString) || check.asBytes().length < checkLength) return damaged();
  }
  return undefined;
}

/** Decrypting load, trying each spelling of the password in turn. The spellings live only here. */
async function loadWithPassword(lib: Library, file: Uint8Array, password: string, oneBytePerCharacter: boolean): Promise<CantooDocument> {
  for (const spelling of passwordSpellings(password, oneBytePerCharacter)) {
    try {
      return await lib.PDFDocument.load(file, { password: spelling, updateMetadata: false });
    } catch (error) {
      if (!(error instanceof Error && WRONG_PASSWORD_MESSAGES.has(error.message))) throw unlockFailed();
    }
  }
  throw wrongPassword();
}

/**
 * Returns the file without its password protection: bytes that pdf-lib 1.17.1 loads normally.
 * Either the user (open) password or the owner password opens it. A valid file that is not
 * protected is returned unchanged (the same array).
 * Throws PdfToolsError 'wrong-password' (also for an empty password that does not open it),
 * or 'unlock-failed' for a damaged file, a file that is not a PDF, or unsupported protection.
 */
export async function unlockPdf(file: Uint8Array, password: string): Promise<Uint8Array> {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFBool, PDFDict, PDFInvalidObject, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } = lib;

  // A plain parse tells whether the file is protected, and holds what the decrypting parse
  // below loses or garbles: the trailer /Info link and clear-text XMP metadata.
  let plain: CantooDocument;
  try {
    plain = await lib.PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw unlockFailed();
  }
  if (!plain.isEncrypted) {
    // A protected file whose end is cut off loses its trailer, and with it the link to its security
    // dictionary: it looks unprotected while its contents are still encrypted. A file whose parse
    // had to be rebuilt without a trailer (no /Size), or that has no pages, is not returned.
    if (!plain.context.trailerInfo.Size || !hasPages(plain)) throw damaged();
    return file;
  }
  const encrypt = plain.context.lookup(plain.context.trailerInfo.Encrypt);
  const refusal = checkSecurityHandler(lib, encrypt);
  if (refusal) throw refusal;
  const clearMetadata = encrypt instanceof PDFDict && encrypt.lookup(PDFName.of('EncryptMetadata')) === PDFBool.False;
  const revision = encrypt instanceof PDFDict ? encrypt.lookup(PDFName.of('R')) : undefined;
  const oneBytePerCharacter = revision instanceof PDFNumber && revision.asNumber() <= 4;
  const infoRef = plain.context.trailerInfo.Info;

  const doc = await loadWithPassword(lib, file, password, oneBytePerCharacter);

  try {
    const context = doc.context;

    // Fix 1. With a cross-reference stream, the decrypting parse cannot read that stream, so the
    // trailer /Info link is lost and Title, Author and the other properties would disappear.
    // The Info dictionary itself is decrypted correctly; link it again.
    if (!context.trailerInfo.Info && infoRef instanceof PDFRef && context.lookup(infoRef) instanceof PDFDict) {
      context.trailerInfo.Info = infoRef;
    }

    // With /EncryptMetadata false the XMP metadata is stored unencrypted, but the library decrypts it
    // anyway and turns it into noise. Take those streams from the plain parse instead.
    if (clearMetadata) {
      for (const [ref, object] of plain.context.enumerateIndirectObjects()) {
        if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) {
          context.assign(ref, object.clone(context));
        }
      }
    }

    // Fix 2. The library unlinks the security dictionary from the trailer but keeps the object, and
    // its /O and /U entries are password checks: delete it. Also delete objects the decrypting parse
    // could not read; they hold still-encrypted bytes, among them the old cross-reference stream
    // that still names /Encrypt.
    for (const [ref, object] of context.enumerateIndirectObjects()) {
      if (object instanceof PDFInvalidObject) {
        context.delete(ref);
        continue;
      }
      const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : undefined;
      const isSecurityHandler =
        dict?.get(PDFName.of('Filter')) === PDFName.of('Standard') && dict.has(PDFName.of('O')) && dict.has(PDFName.of('U'));
      if (isSecurityHandler) context.delete(ref);
    }

    if (doc.isEncrypted || !hasPages(doc)) throw damaged();
    return await doc.save();
  } catch (error) {
    throw error instanceof PdfToolsError ? error : unlockFailed();
  }
}

/**
 * Opens a file that needs no password to read: one protected only by an owner password
 * (restrictions such as no editing or copying) opens with an empty password. Returns the
 * unprotected bytes, the file unchanged if it is not protected, or null when a password is needed.
 * Throws PdfToolsError 'unlock-failed' as unlockPdf does.
 */
export async function tryOpenWithoutPassword(file: Uint8Array): Promise<Uint8Array | null> {
  try {
    return await unlockPdf(file, '');
  } catch (error) {
    if (error instanceof PdfToolsError && error.code === 'wrong-password') return null;
    throw error;
  }
}
