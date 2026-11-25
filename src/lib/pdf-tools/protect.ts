// Protect with password (design 5.18; plan Task B5; spike-protect.md and the lead's rulings of
// 14 November 2026): a copy of one PDF that opens only with a password.
//
// How. @cantoo/pdf-lib 2.11.1 (already a dependency; loaded on first use, as unlock.ts does, so it
// stays out of the main bundle) writes AES-256 (/V 5 /R 6, crypt filter AESV3, metadata encrypted).
// Used as documented it is not safe (spike-protect.md D1-D4), and this module closes each gap:
// - D1. Its writer encrypts streams only. A string is encrypted only by sitting inside an object
//   stream, so strings in the objects it keeps outside them (the catalog, the page tree, pages, stream
//   dictionaries, signature dictionaries, objects of generation above 0, and every object of a PDF/A-1
//   file, which it writes without object streams) would stay readable, and readers would "decrypt"
//   them into garbage. `sealStrings` encrypts each of those strings with the library's own cipher for
//   that object before the save. Which objects stay outside copies PDFStreamWriter.computeBufferSize of
//   2.11.1 (protect.test.ts pins the version and plants a marker in every category).
// - D2. Without explicit permissions it forbids printing and copying: every permission is granted.
// - D3. A second save() encrypts again, silently: the document is loaded, encrypted and saved inside
//   one function (`encryptOnce`) and never leaves it, so it cannot be saved twice.
// - D4. A protected file loaded with ignoreEncryption makes a broken result: protected input is refused.
// - Its encrypt() refuses any file whose XMP claims PDF/A (PDF/A does not allow encryption). The
//   security handler is created here as encrypt() creates it, so such a file can be protected too; the
//   protected copy is not PDF/A whatever its metadata says.
// sealStrings, the handler and the Stop hook use the library below its documented API (as unlock.ts
// does); protect.test.ts pins the version.
// Before the result is returned it is opened with the password by the application's own unlock code
// and compared with the source object by object (every string, number and name, every stream's
// bytes); any difference, or a file that does not open, discards it.
//
// The password is used only inside protectPdf: normalised to NFC and handed to the library. It is
// never stored, logged, put into an error, returned or kept in this module (which holds no state).
// JavaScript cannot overwrite a string; the file's random encryption key is overwritten once the file
// is written (best effort: it sits in the library's object).
import type {
  PDFDict as CantooDict,
  PDFDocument as CantooDocument,
  PDFHexString as CantooHexString,
  PDFName as CantooName,
  PDFObject as CantooObject,
  PDFRef as CantooRef,
  PDFString as CantooString,
} from '@cantoo/pdf-lib';
import { inspectPdf, PARSE_OBJECTS_PER_TICK, type PdfInfo } from './inspect';
import { withClockWaits } from './pace';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES } from './types';
import { unlockPdf } from './unlock';

type Library = typeof import('@cantoo/pdf-lib');
type Security = NonNullable<CantooDocument['context']['security']>;

/**
 * At least 8 characters (code points, after NFC); at most 127 bytes in UTF-8, where the PDF standard
 * cuts a password (ASCII letters, digits and symbols count one byte, most Hindi letters three). Google
 * Chrome's PDF engine refuses longer ones (spike-protect.md section 6).
 */
export const PASSWORD_LIMITS = { min: 8, maxBytes: 127 } as const;

/** Files above this are refused: protecting and checking hold about four to five times the file in memory. */
export const PROTECT_MAX_BYTES = 150 * 1024 * 1024;

/** Shown by the dialog while the password holds a character that is not on an English keyboard. */
export const NON_ENGLISH_PASSWORD_WARNING =
  'Some PDF readers cannot open files protected with non-English characters. Letters, digits and symbols on an English keyboard are safest.';

/** Shown by the dialog while the password starts or ends with a space (it is kept, never trimmed). */
export const SPACES_PASSWORD_WARNING = 'The password starts or ends with a space. It must be typed with that space every time.';

/** For the dialog and the record when the source claims PDF/A (ProtectReport.noLongerArchival; lead ruling). */
export const NO_LONGER_ARCHIVAL_NOTE =
  'This file is marked PDF/A (archival). A password-protected copy cannot be PDF/A; the copy keeps the mark but no longer meets the standard.';

const ALL_PERMISSIONS = {
  printing: 'highResolution',
  modifying: true,
  copying: true,
  annotating: true,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: true,
} as const;

/**
 * About this much encryption or decryption between two turns of the event loop (review F2): the
 * library's work is sliced by objects, so a slice is this many bytes' worth of objects, at least one.
 * A turn costs at least a timer tick (about 15 ms in Node on Windows, 4 ms in Chromium) and more when the
 * processor is busy: on a 52 MB scan, slices of 1 object made the decrypting read 32 s against 19 s
 * unsliced, slices of 2 objects 22.6 s with the longest block 0.85 s against 15.2 s (fix round 1).
 */
const SLICE_BYTES = 1024 * 1024;
/** The check's own comparison gives the event loop a turn after this long. */
const SLICE_MS = 40;

/**
 * Objects per slice for a file of `fileBytes` holding `objects` objects: about SLICE_BYTES' worth, from 1
 * (a large image) up to PARSE_OBJECTS_PER_TICK. The cap was 50: a 4.6 MB, 320-page text ledger (16,330
 * small objects) then waited for a timer about 1,600 times across the run, and Protect took 146 to 173 s
 * on a busy machine, most of it waiting (QA-FIX I). A slice of 1,500 small objects took up to 0.2 s of
 * processor time, so the writing and the decrypting read now also wait by the clock, at least every 50 ms
 * of work (pace.ts withClockWaits, INT3); these slices by size stay as a second rule.
 */
const objectsPerSlice = (fileBytes: number, objects: number) =>
  Math.max(1, Math.min(PARSE_OBJECTS_PER_TICK, Math.floor(SLICE_BYTES / Math.max(1, fileBytes / Math.max(1, objects)))));

/** Objects the library's writer packs into one object stream (its default). */
const WRITER_OBJECTS_PER_STREAM = 50;

/** How many times at most a phase says how far it has got, however large the file. */
const PROGRESS_STEPS = 100;

/** Reports `done` of `total` to `onProgress` about PROGRESS_STEPS times in all, and always the end. */
function progressReporter(phase: ProtectPhase, total: number, onProgress: ProtectOptions['onProgress']) {
  const every = Math.max(1, Math.ceil(total / PROGRESS_STEPS));
  let last = -1;
  return (done: number) => {
    if (!onProgress) return;
    const at = Math.min(done, total);
    if (at === last || (at !== total && at - last < every)) return;
    last = at;
    onProgress(phase, at, total);
  };
}

// ---- passwords ------------------------------------------------------------------------------------

/** The password as it is used: NFC (no PDF reader normalises a typed password; most keyboards type NFC). */
const usable = (typed: string) => typed.normalize('NFC');
const utf8Length = (text: string) => new TextEncoder().encode(text).length;
/** Control characters (C0, DEL, C1) and half of a broken character pair cannot be typed again reliably. */
const UNUSABLE = /[\p{Cc}\p{Cs}]/u;
const NOT_ON_ENGLISH_KEYBOARD = /[^\x20-\x7e]/;

type PasswordCode = 'password-too-short' | 'password-too-long' | 'password-invalid' | 'password-mismatch';

/** The first thing wrong with a password (and its confirmation, when given), in plain words without the password. */
function passwordProblem(typed: string, confirm?: string): { code: PasswordCode; message: string } | null {
  const password = usable(typed);
  const { min, maxBytes } = PASSWORD_LIMITS;
  if (password.length === 0) return { code: 'password-too-short', message: `Type a password of at least ${min} characters.` };
  if (Array.from(password).length < min) return { code: 'password-too-short', message: `The password is too short. Use at least ${min} characters.` };
  if (UNUSABLE.test(password)) {
    return { code: 'password-invalid', message: 'The password contains a character that cannot be typed again reliably, such as a control character. Type it again.' };
  }
  if (utf8Length(password) > maxBytes) {
    return {
      code: 'password-too-long',
      message: `The password is too long for PDF readers. Use at most ${maxBytes} letters, digits and symbols on an English keyboard; other characters count as two to four (most Hindi letters as three).`,
    };
  }
  if (confirm !== undefined && usable(confirm) !== password) return { code: 'password-mismatch', message: 'The two passwords are not the same. Type them again.' };
  return null;
}

/** Why Run stays disabled, or null when the password and its confirmation can be used. */
export function passwordError(password: string, confirm: string): string | null {
  return passwordProblem(password, confirm)?.message ?? null;
}

/**
 * A plain hint, never a block (design 5.18): weak under 12 characters or of one kind only; strong with
 * 12 or more of three kinds (letters in any script, digits, symbols including spaces); fair otherwise.
 */
export function passwordStrength(password: string): 'weak' | 'fair' | 'strong' {
  const characters = Array.from(usable(password));
  const kinds = new Set(characters.map((c) => (/[\p{L}\p{M}]/u.test(c) ? 'letter' : /\p{N}/u.test(c) ? 'digit' : 'symbol')));
  if (characters.length < 12 || kinds.size < 2) return 'weak';
  return kinds.size >= 3 ? 'strong' : 'fair';
}

/** NON_ENGLISH_PASSWORD_WARNING when a character is not printable ASCII (non-English letters, other spaces), else null. */
export function passwordWarning(password: string): string | null {
  return NOT_ON_ENGLISH_KEYBOARD.test(usable(password)) ? NON_ENGLISH_PASSWORD_WARNING : null;
}

/** Every warning that applies, in this order: SPACES_PASSWORD_WARNING, NON_ENGLISH_PASSWORD_WARNING. */
export function passwordWarnings(password: string): string[] {
  const warnings: string[] = [];
  if (/^\s|\s$/u.test(usable(password))) warnings.push(SPACES_PASSWORD_WARNING);
  const nonEnglish = passwordWarning(password);
  if (nonEnglish) warnings.push(nonEnglish);
  return warnings;
}

// ---- protect --------------------------------------------------------------------------------------

/** The steps of a run, reported before each starts. */
export type ProtectPhase = 'preparing' | 'encrypting' | 'checking';

/**
 * What a successful run hands back besides the protected bytes. The protected file is AES-256 with one
 * password for opening and for permissions, and it grants every permission (/P -4): the tool's purpose
 * is that the file cannot be opened without the password, not to restrict what a reader may do once it
 * is open. The password is not here.
 */
export interface ProtectReport {
  /** The protected file opened with the password by the app's unlock code and checked: the row's preview bytes. */
  unlocked?: Uint8Array;
  pageCount?: number;
  /** The source was signed: rewriting it made the signature invalid (as phase 1 flags it). */
  signatureInvalid?: boolean;
  /**
   * The source claims PDF/A: the protected copy keeps the mark in its (encrypted) XMP but cannot meet
   * the standard, which does not allow encryption. Show and record NO_LONGER_ARCHIVAL_NOTE.
   */
  noLongerArchival?: boolean;
}

export interface ProtectOptions {
  /** Filled in when the run succeeds; left empty when it fails or stops. */
  report?: ProtectReport;
  /** Called before each phase; it stops the run by throwing (a cancel), and the error comes back as it is. */
  onPhase?: (phase: ProtectPhase) => void | Promise<void>;
  /**
   * How far the two slow phases have got (QA-FIX I): 'encrypting' counts the parts of the file written,
   * 'checking' the parts compared with the source; about a hundred calls a phase, the last with done =
   * total. Called from inside the library's work: it must not throw (Stop goes through the signal).
   */
  onProgress?: (phase: ProtectPhase, done: number, total: number) => void;
  /**
   * Stop. The work gives the event loop a turn about every 1 MB of encryption or decryption (one
   * object at least: a single large image is done in one go) and every 40 ms of the check's comparison,
   * so the screen can repaint and a Stop can land. Stop is then checked: before and after each phase;
   * while the library writes, before each stream is encrypted (through its per-object cipher); while
   * the result is opened again, between reading, decrypting and writing (unlockPdf's steps); and in the
   * comparison between slices. The library's own reading and writing of one slice cannot be
   * interrupted. A stop throws PdfToolsError 'cancelled'.
   */
  signal?: AbortSignal;
}

const MESSAGE_FAILED = PHASE_TWO_ERROR_MESSAGES['protect-failed'] ?? 'The file could not be protected.';
const failed = (detail?: string) => new PdfToolsError('protect-failed', detail ? `${MESSAGE_FAILED} ${detail}` : MESSAGE_FAILED);
const unverified = () => new PdfToolsError('protect-unverified', PHASE_TWO_ERROR_MESSAGES['protect-unverified'] ?? 'The protected file could not be verified. Nothing was added.');
const protectedInput = () => new PdfToolsError('encrypted', 'This file is password-protected. Unlock it first.');
const cancelled = () => new PdfToolsError('cancelled', 'Protecting was stopped. Nothing was added.');

function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelled();
}

/**
 * Makes a password-protected copy of a PDF: AES-256, the same password to open it and for its
 * permissions, every permission granted (see ProtectReport). The source is not changed.
 *
 * Phases, each reported through `onPhase` before it starts: 'preparing' (reading the source),
 * 'encrypting' (the library encrypts and writes the file), 'checking' (the result is opened with the
 * password by the app's own unlock code and compared with the source). Both of the last two give the
 * event loop a turn between slices and take Stop there (see `signal`). A 50 MB scan takes several
 * seconds in each of the last two (protect.test.ts logs the times and the longest block).
 *
 * Throws PdfToolsError: 'password-too-short', 'password-too-long', 'password-invalid' (before the
 * file is read); 'protect-too-large' over PROTECT_MAX_BYTES; inspectPdf's 'empty-file', 'not-a-pdf'
 * and 'no-pages'; 'encrypted' for a protected source (unlock it first); 'protect-failed' when the
 * library cannot write it, or a part of the file that is referred to cannot be read (it could not be
 * encrypted); 'protect-unverified' when the result does not open with the password or differs from
 * the source; 'cancelled'. No message holds the password.
 */
export async function protectPdf(file: Uint8Array, password: string, options: ProtectOptions = {}): Promise<Uint8Array> {
  const problem = passwordProblem(password);
  if (problem) throw new PdfToolsError(problem.code, problem.message);
  if (file.length > PROTECT_MAX_BYTES) {
    throw new PdfToolsError('protect-too-large', 'This file is larger than 150 MB, too large to protect in PDF Tools.');
  }
  const { signal, report } = options;
  const enter = async (phase: ProtectPhase) => {
    stopIfAborted(signal);
    await options.onPhase?.(phase);
    stopIfAborted(signal);
  };

  await enter('preparing');
  const source = await readSource(file);
  await enter('encrypting');
  const written = await encryptOnce(file, usable(password), signal, options.onProgress);
  await enter('checking');
  const unlocked = await checkProtected(written, file, usable(password), source.pageCount, signal, options.onProgress);
  stopIfAborted(signal);
  if (report) {
    report.unlocked = unlocked;
    report.pageCount = source.pageCount;
    if (source.hasSignature) report.signatureInvalid = true;
    if (written.claimsPdfA) report.noLongerArchival = true;
  }
  return written.bytes;
}

/** What encryptOnce made: the protected bytes, how finely to slice work on them, and whether the source claims PDF/A. */
interface Written {
  bytes: Uint8Array;
  objectsPerTick: number;
  claimsPdfA: boolean;
}

async function readSource(file: Uint8Array): Promise<{ pageCount: number; hasSignature: boolean }> {
  let info: PdfInfo;
  try {
    info = await inspectPdf(file);
  } catch (error) {
    throw error instanceof PdfToolsError ? error : failed();
  }
  if (info.encrypted || info.pageCount === null) throw protectedInput();
  return { pageCount: info.pageCount, hasSignature: info.hasSignature };
}

/**
 * Loads the source into a new document, encrypts it, seals its strings and saves it: the only save
 * this document ever gets (D3). Nothing of the document leaves this function.
 */
async function encryptOnce(file: Uint8Array, password: string, signal: AbortSignal | undefined, onProgress?: ProtectOptions['onProgress']): Promise<Written> {
  const lib = await import('@cantoo/pdf-lib');
  try {
    // The library's own load and save, their waits taken by the clock (pace.ts; the same bytes).
    const doc = await withClockWaits(lib, file, () =>
      lib.PDFDocument.load(file, { updateMetadata: false, preserveXFA: true, forIncrementalUpdate: false, parseSpeed: PARSE_OBJECTS_PER_TICK }),
    );
    if (doc.isEncrypted) throw protectedInput();
    // The library refuses object streams for a file that claims PDF/A-1; it then writes every object
    // on its own, and every string is sealed.
    const xmp = catalogXmp(lib, doc);
    const part = xmp === undefined ? undefined : lib.parsePDFAConformanceFromXmp(xmp)?.part;
    const objectStreams = part !== 1;
    dropUnreadable(lib, doc);
    inlineExtensions(lib, doc);
    // What doc.encrypt() does, without its refusal of files that claim PDF/A (PDF/A does not allow
    // encryption, so the protected copy is no longer PDF/A whatever its metadata says; design 5.18
    // makes no exception for them). The handler's options are not kept by the library.
    const security = lib.PDFSecurity.create(doc.context, {
      userPassword: password,
      ownerPassword: password,
      algorithm: 'AES-256',
      permissions: ALL_PERMISSIONS,
    }).encrypt();
    doc.context.security = security;
    sealStrings(lib, doc, security, objectStreams);
    // The writer asks for the cipher of each object before encrypting it: Stop is checked there, and the
    // count of objects written so far is reported (QA-FIX I).
    const all = doc.context.enumerateIndirectObjects();
    // The writer encrypts each stream, and each object stream it packs the other objects into (50 a
    // stream): about this many ciphers are asked for. The bar never passes the end before the file is written.
    const streams = all.filter(([, object]) => object instanceof lib.PDFStream).length;
    const expected = Math.max(1, streams + (objectStreams ? Math.ceil((all.length - streams) / WRITER_OBJECTS_PER_STREAM) : 0));
    const report = progressReporter('encrypting', expected, onProgress);
    let asked = 0;
    const cipherFor = security.getEncryptFn.bind(security);
    security.getEncryptFn = (objectNumber: number, generationNumber: number) => {
      stopIfAborted(signal);
      asked = Math.min(asked + 1, expected - 1);
      report(asked);
      return cipherFor(objectNumber, generationNumber);
    };
    const objectsPerTick = objectsPerSlice(file.length, all.length);
    try {
      // Slices by size (objectsPerTick) as before, and by the clock too.
      const bytes = await withClockWaits(
        lib,
        doc.context,
        () => doc.save({ useObjectStreams: objectStreams, updateFieldAppearances: false, addDefaultPage: false, rewrite: true, objectsPerTick }),
        { keepCount: true },
      );
      report(expected);
      // Any PDF/A claim (the library itself recognises conformance B and U only).
      return { bytes, objectsPerTick, claimsPdfA: part !== undefined || /pdfaid:part/.test(xmp ?? '') };
    } finally {
      forgetKey(security);
    }
  } catch (error) {
    if (error instanceof PdfToolsError) throw error;
    if (error instanceof lib.EncryptedPDFError) throw protectedInput();
    throw failed();
  }
}

/** Overwrites the file key (random; the password unlocks it) once the file is written (best effort: a field of the library's object). */
function forgetKey(security: Security): void {
  const held = security as unknown as { encryptionKey?: unknown };
  if (held.encryptionKey instanceof Uint8Array) held.encryptionKey.fill(0);
}

/** The catalog's XMP as text, read exactly as the library's save() reads it for its PDF/A test, or undefined. */
function catalogXmp(lib: Library, doc: CantooDocument): string | undefined {
  try {
    const metadata = doc.catalog.lookup(lib.PDFName.of('Metadata'));
    if (!(metadata instanceof lib.PDFRawStream)) return undefined;
    return new TextDecoder('utf-8').decode(lib.decodePDFRawStream(metadata).decode());
  } catch {
    return undefined;
  }
}

/**
 * A direct copy of a dictionary or array and of every dictionary and array inside it, references to
 * them included (followed `depth` levels; deeper references stay references).
 */
function deepCopy(lib: Library, doc: CantooDocument, object: CantooObject, depth = 8): CantooObject {
  const looked = object instanceof lib.PDFRef && depth > 0 ? doc.context.lookup(object) : object;
  if (looked instanceof lib.PDFDict && !(looked instanceof lib.PDFStream)) {
    const copy = doc.context.obj({});
    for (const [key, value] of looked.entries()) copy.set(key, deepCopy(lib, doc, value, depth - 1));
    return copy;
  }
  if (looked instanceof lib.PDFArray) return doc.context.obj(looked.asArray().map((value) => deepCopy(lib, doc, value, depth - 1)));
  return object;
}

/**
 * The library declares AES-256 in the catalog's /Extensions by setting that dictionary into the
 * catalog and adding ADBE to it. Were it an indirect object (or held direct dictionaries of one), the
 * object would change, and its strings would be sealed with the catalog and then encrypted again in
 * the object stream (review F1). The catalog gets its own copy first; the object stays as it was.
 */
function inlineExtensions(lib: Library, doc: CantooDocument): void {
  const key = lib.PDFName.of('Extensions');
  const value = doc.catalog.get(key);
  if (value !== undefined) doc.catalog.set(key, deepCopy(lib, doc, value));
}

/** The references reachable from the trailer's /Root and /Info. */
function reachableRefs(lib: Library, doc: CantooDocument): Set<CantooRef> {
  const { context } = doc;
  const reachable = new Set<CantooRef>();
  const stack: CantooObject[] = [context.trailerInfo.Root, context.trailerInfo.Info].filter((x): x is CantooObject => x !== undefined);
  while (stack.length > 0) {
    const object = stack.pop()!;
    if (object instanceof lib.PDFRef) {
      if (reachable.has(object)) continue;
      reachable.add(object);
      const value = context.lookup(object);
      if (value !== undefined) stack.push(value);
    } else if (object instanceof lib.PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof lib.PDFArray) {
      stack.push(...object.asArray());
    } else if (object instanceof lib.PDFStream) {
      for (const [, value] of object.dict.entries()) stack.push(value);
    }
  }
  return reachable;
}

/**
 * Objects the parser could not read are written back as they were, unencrypted. One nothing refers to
 * is removed (no reader uses it); one that is referred to cannot be encrypted, so the file is refused.
 */
function dropUnreadable(lib: Library, doc: CantooDocument): void {
  const unreadable = doc.context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof lib.PDFInvalidObject)
    .map(([ref]) => ref);
  if (unreadable.length === 0) return;
  const reachable = reachableRefs(lib, doc);
  if (unreadable.some((ref) => reachable.has(ref))) throw failed('Part of it is damaged, so it could not all be encrypted.');
  for (const ref of unreadable) doc.context.delete(ref);
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const toHex = (bytes: Uint8Array) => {
  let text = '';
  for (const byte of bytes) text += HEX[byte];
  return text;
};

/**
 * D1: encrypts, with the library's cipher for each object, every string of every object the writer
 * keeps outside an encrypted object stream, wherever the string sits inside it (nested dictionaries and
 * arrays, a stream's dictionary). The writer rule copied (PDFStreamWriter.computeBufferSize, 2.11.1):
 * the security dictionary is never encrypted; with object streams, these stay outside: streams,
 * objects the parser could not read, the catalog, page tree nodes, pages, objects of generation above
 * 0, and /Type /Sig dictionaries; without object streams, every object. A signature's /Contents is
 * sealed too: the signature is invalid after any rewrite, and its certificate names the signer.
 */
function sealStrings(lib: Library, doc: CantooDocument, security: Security, objectStreams: boolean): void {
  const { PDFArray: Arr, PDFCatalog, PDFDict: Dict, PDFHexString: Hex, PDFInvalidObject: Invalid, PDFName: Name, PDFPageLeaf, PDFPageTree, PDFStream, PDFString: Str } = lib;
  const typeKey = Name.of('Type');
  const signature = Name.of('Sig');
  const { context } = doc;
  const encryptRef = context.trailerInfo.Encrypt;
  const outside = (ref: CantooRef, object: CantooObject) =>
    !objectStreams ||
    object instanceof PDFStream ||
    object instanceof Invalid ||
    object instanceof PDFCatalog ||
    object instanceof PDFPageTree ||
    object instanceof PDFPageLeaf ||
    ref.generationNumber !== 0 ||
    (object instanceof Dict && object.lookup(typeKey) === signature);
  const isString = (object: CantooObject): object is CantooString | CantooHexString => object instanceof Str || object instanceof Hex;
  const done = new Set<CantooObject>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (ref === encryptRef || !outside(ref, object)) continue;
    if (object instanceof Invalid) throw failed('Part of it is damaged, so it could not all be encrypted.');
    const cipher = security.getEncryptFn(ref.objectNumber, ref.generationNumber);
    const seal = (text: CantooString | CantooHexString) => Hex.of(toHex(cipher(text.asBytes())));
    if (isString(object)) {
      context.assign(ref, seal(object));
      continue;
    }
    const pending: CantooObject[] = [object instanceof PDFStream ? object.dict : object];
    while (pending.length > 0) {
      const container = pending.pop()!;
      if (done.has(container)) continue;
      done.add(container);
      if (container instanceof Dict) {
        for (const [key, value] of container.entries()) {
          if (isString(value)) container.set(key, seal(value));
          else if (value instanceof Dict || value instanceof Arr) pending.push(value);
        }
      } else if (container instanceof Arr) {
        for (let i = 0; i < container.size(); i++) {
          const value = container.get(i);
          if (isString(value)) container.set(i, seal(value));
          else if (value instanceof Dict || value instanceof Arr) pending.push(value);
        }
      }
    }
  }
}

// ---- the check ------------------------------------------------------------------------------------

/** Gives the event loop a turn once SLICE_MS have passed since the last turn, then honours Stop. */
function slicer(signal: AbortSignal | undefined): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < SLICE_MS) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    stopIfAborted(signal);
    last = performance.now();
  };
}

/**
 * Opens the result with the password through the app's own unlock code (the code that opens it when
 * it comes back to PDF Tools) and compares it with the source. Returns the unlocked copy.
 */
async function checkProtected(
  written: Written,
  file: Uint8Array,
  password: string,
  pageCount: number,
  signal: AbortSignal | undefined,
  onProgress?: ProtectOptions['onProgress'],
): Promise<Uint8Array> {
  const { bytes, objectsPerTick } = written;
  let unlocked: Uint8Array;
  try {
    // unlockPdf hands back the same array when it finds no protection; inspectPdf's reading of the
    // result as protected is pinned by protect.test.ts rather than paid for here (a whole-file parse).
    unlocked = await unlockPdf(bytes, password, { objectsPerTick, onStep: () => stopIfAborted(signal) });
  } catch (error) {
    if (error instanceof PdfToolsError && error.code === 'cancelled') throw error;
    throw unverified();
  }
  if (unlocked === bytes || !(await sameDocument(file, unlocked, pageCount, signal, onProgress))) throw unverified();
  return unlocked;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Whether the unlocked copy holds the source: the same page count, and every object of the source
 * under the same number with the same content: strings (by their bytes), numbers, names, booleans,
 * references, and every stream's bytes. Both sides are read with the library's parser, which reads
 * what readers read where pdf-lib 1.17.1 does not (names with lower-case #xx escapes, hex strings with
 * white space; review F1). A dictionary entry whose value is null counts as absent, as the standard
 * says. Allowed differences: a stream's /Length (rewritten by the writer) and the catalog's
 * /Extensions (the library declares AES-256 there). Objects the parser could not read are skipped
 * (removed before protecting), and so are the source's object and cross-reference stream containers
 * (their contents are compared as objects). A string left unencrypted would come back garbled, a
 * stream encrypted twice unreadable: both differ.
 */
async function sameDocument(
  file: Uint8Array,
  unlockedBytes: Uint8Array,
  pageCount: number,
  signal: AbortSignal | undefined,
  onProgress?: ProtectOptions['onProgress'],
): Promise<boolean> {
  const lib = await import('@cantoo/pdf-lib');
  const next = slicer(signal);
  let source: CantooDocument;
  let unlocked: CantooDocument;
  try {
    // Plain reads only copy bytes; their waits are taken by the clock (pace.ts; the library's default of
    // 100 objects a slice waited for a timer 160 times a read on a 320-page ledger).
    source = await withClockWaits(lib, file, () => lib.PDFDocument.load(file, { updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK }));
    await next();
    unlocked = await withClockWaits(lib, unlockedBytes, () => lib.PDFDocument.load(unlockedBytes, { updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK }));
    if (source.getPageCount() !== pageCount || unlocked.getPageCount() !== pageCount) return false;
  } catch (error) {
    if (error instanceof PdfToolsError) throw error;
    return false;
  }
  const typeKey = lib.PDFName.of('Type');
  const containers = new Set([lib.PDFName.of('ObjStm'), lib.PDFName.of('XRef')]);
  const catalogRef = source.context.trailerInfo.Root;
  const objects = source.context.enumerateIndirectObjects();
  const report = progressReporter('checking', objects.length, onProgress);
  let compared = 0;
  for (const [ref, object] of objects) {
    await next();
    report(++compared);
    if (object instanceof lib.PDFInvalidObject) continue;
    if (object instanceof lib.PDFRawStream && containers.has(object.dict.get(typeKey) as CantooName)) continue;
    const other = unlocked.context.lookup(ref);
    if (other === undefined || !sameObject(lib, object, other, ref === catalogRef)) return false;
  }
  return true;
}

function sameObject(lib: Library, a: CantooObject, b: CantooObject, isCatalog: boolean): boolean {
  const { PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFString } = lib;
  const isString = (o: CantooObject): o is CantooString | CantooHexString => o instanceof PDFString || o instanceof PDFHexString;
  /** A dictionary's entries without those set to null and without `ignored`. */
  const entriesOf = (dict: CantooDict, ignored: CantooName | undefined) => new Map(dict.entries().filter(([key, value]) => key !== ignored && value !== PDFNull));
  const pending: [CantooObject, CantooObject, CantooName | undefined][] = [[a, b, isCatalog ? PDFName.of('Extensions') : undefined]];
  while (pending.length > 0) {
    const [x, y, ignored] = pending.pop()!;
    if (x === y) continue; // names, references, null and booleans are shared instances
    if (isString(x) && isString(y)) {
      if (!sameBytes(x.asBytes(), y.asBytes())) return false;
    } else if (x instanceof PDFNumber && y instanceof PDFNumber) {
      if (x.asNumber() !== y.asNumber()) return false;
    } else if (x instanceof PDFBool && y instanceof PDFBool) {
      if (x.asBoolean() !== y.asBoolean()) return false;
    } else if (x instanceof PDFArray && y instanceof PDFArray) {
      if (x.size() !== y.size()) return false;
      for (let i = 0; i < x.size(); i++) pending.push([x.get(i), y.get(i), undefined]);
    } else if (x instanceof PDFRawStream && y instanceof PDFRawStream) {
      if (!sameBytes(x.contents, y.contents)) return false;
      pending.push([x.dict, y.dict, PDFName.of('Length')]);
    } else if (x instanceof PDFDict && y instanceof PDFDict) {
      const xs = entriesOf(x, ignored);
      const ys = entriesOf(y, ignored);
      if (xs.size !== ys.size) return false;
      for (const [key, value] of xs) {
        const other = ys.get(key);
        if (other === undefined) return false;
        pending.push([value, other, undefined]);
      }
    } else {
      return false;
    }
  }
  return true;
}
