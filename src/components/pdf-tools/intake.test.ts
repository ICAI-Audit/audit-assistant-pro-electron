import { PDFDocument as CantooDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeFormPdf, makePdf } from '@/lib/pdf-tools/testPdf';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { unlockPdf } from '@/lib/pdf-tools/unlock';
import { imageFormatOf, prepareFile, type IntakeDeps } from './intake';

// Unlocking with @cantoo/pdf-lib is slow when the machine is busy; the cold import is paid in beforeAll.
vi.setConfig({ testTimeout: 20_000 });

const PASSWORD = 'Test@123';

async function protect(pages: number, userPassword: string, ownerPassword?: string): Promise<Uint8Array> {
  const doc = await CantooDocument.load(await makePdf('P', pages), { updateMetadata: false });
  doc.encrypt({ userPassword, ownerPassword, algorithm: 'AES-128', allowWeakCryptography: true });
  return doc.save();
}

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
function pngHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(width), ...be32(height), 8, 2, 0, 0, 0, 0, 0, 0, 0]);
}
function gifHeader(frames: number): Uint8Array {
  const frame = [0x2c, ...le16(0), ...le16(0), ...le16(2), ...le16(2), 0, 2, 2, 0x4c, 0x01, 0];
  return new Uint8Array([...ascii('GIF89a'), ...le16(2), ...le16(2), 0, 0, 0, ...new Array(frames).fill(frame).flat(), 0x3b]);
}
const PNG = pngHeader(10, 10);
const GIF = gifHeader(1);
const TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0, 0, 0, 0]);
const CONVERTED = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

function deps(over: Partial<IntakeDeps> = {}): IntakeDeps {
  return {
    decodeToPng: vi.fn(async () => CONVERTED),
    imageSize: vi.fn(async () => ({ width: 10, height: 10 })),
    askPassword: vi.fn(async () => null),
    ...over,
  };
}

let plain: Uint8Array;
let locked: Uint8Array;
let ownerOnly: Uint8Array;

beforeAll(async () => {
  plain = await makePdf('A', 2);
  locked = await protect(3, PASSWORD, 'owner-secret');
  ownerOnly = await protect(2, '', 'owner-secret');
}, 60_000);

describe('prepareFile', () => {
  it('accepts a plain PDF with its page count', async () => {
    const result = await prepareFile({ name: 'a.pdf', bytes: plain, origin: 'computer' }, deps());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.file).toMatchObject({ name: 'a.pdf', kind: 'pdf', mimeType: 'application/pdf', origin: 'computer', pageCount: 2, wasProtected: false, sentTo: [] });
    expect(result.file.size).toBe(plain.byteLength);
    expect(result.file.bytes).toBe(plain);
  });

  it('notes form fields, bookmarks and links between pages, which Split, Delete pages and Merge may not carry', async () => {
    const plainResult = await prepareFile({ name: 'a.pdf', bytes: plain, origin: 'computer' }, deps());
    expect(plainResult).toMatchObject({ status: 'ready', file: { hasFormFields: false, hasBookmarks: false, hasPageLinks: false } });
    const form = await makeFormPdf({ bookmarks: true, links: true });
    const formResult = await prepareFile({ name: 'form.pdf', bytes: form, origin: 'computer' }, deps());
    expect(formResult).toMatchObject({ status: 'ready', file: { hasFormFields: true, hasBookmarks: true, hasPageLinks: true } });
    // a protected form: what the unlocked copy holds
    const doc = await CantooDocument.load(form, { updateMetadata: false });
    doc.encrypt({ userPassword: PASSWORD, algorithm: 'AES-128' });
    const lockedForm = await doc.save();
    const askPassword = vi.fn(async (_name: string, bytes: Uint8Array) => unlockPdf(bytes, PASSWORD));
    const unlocked = await prepareFile({ name: 'locked form.pdf', bytes: lockedForm, origin: 'computer' }, deps({ askPassword }));
    expect(unlocked).toMatchObject({ status: 'ready', file: { wasProtected: true, hasFormFields: true, hasBookmarks: true, hasPageLinks: true } });
  });

  it('keeps the vault record id for vault input', async () => {
    const result = await prepareFile({ name: 'v.pdf', bytes: plain, origin: 'vault', evidenceId: 'ev-1' }, deps());
    expect(result.status === 'ready' && result.file.evidenceId).toBe('ev-1');
  });

  it('refuses an empty file and a file that is neither PDF nor image', async () => {
    await expect(prepareFile({ name: 'e.pdf', bytes: new Uint8Array(), origin: 'computer' }, deps())).rejects.toMatchObject({ code: 'empty-file' });
    const error = await prepareFile({ name: 'x.docx', bytes: new TextEncoder().encode('PK\u0003\u0004 not a pdf'), origin: 'computer' }, deps()).catch((e) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect(error.message).toBe('This file is not a PDF or a supported image (JPG, PNG, WebP, BMP or GIF).');
  });

  it('refuses a damaged PDF with the inspection message', async () => {
    const damaged = plain.slice(0, 200);
    await expect(prepareFile({ name: 'd.pdf', bytes: damaged, origin: 'computer' }, deps())).rejects.toMatchObject({ code: 'not-a-pdf' });
  });

  it('asks for the password of a protected file and stores the unlocked bytes', async () => {
    const askPassword = vi.fn(async (_name: string, bytes: Uint8Array) => unlockPdf(bytes, PASSWORD));
    const stages: string[] = [];
    const result = await prepareFile(
      { name: 'locked.pdf', bytes: locked, origin: 'computer' },
      deps({ askPassword, onStage: (stage) => void stages.push(stage) }),
    );
    expect(stages).toEqual(['checking', 'unlocking']);
    expect(askPassword).toHaveBeenCalledTimes(1);
    expect(askPassword.mock.calls[0][0]).toBe('locked.pdf');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.file).toMatchObject({ kind: 'pdf', pageCount: 3, wasProtected: true, hasRestrictions: false });
    expect(result.notice).toBeUndefined();
    expect(result.file.bytes).not.toBe(locked);
    expect(new TextDecoder('latin1').decode(result.file.bytes)).not.toContain('/Encrypt');
  });

  it('skips a protected file when no password is given', async () => {
    expect(await prepareFile({ name: 'locked.pdf', bytes: locked, origin: 'computer' }, deps())).toEqual({ status: 'skipped' });
  });

  it('opens a file that needs no password without asking, with a neutral notice', async () => {
    const askPassword = vi.fn(async () => null);
    const result = await prepareFile({ name: 'r.pdf', bytes: ownerOnly, origin: 'computer' }, deps({ askPassword }));
    expect(askPassword).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ready', notice: 'opened-without-password', file: { pageCount: 2, wasProtected: true, hasRestrictions: true } });
  });

  it('refuses an image over the size limit from its header, before decoding it', async () => {
    const d = deps();
    const error = await prepareFile({ name: 'huge.png', bytes: pngHeader(30_000, 100), origin: 'computer' }, d).catch((e) => e);
    expect(error).toMatchObject({ code: 'bad-image' });
    expect(error.message).toContain('30,000 × 100 pixels');
    expect(d.imageSize).not.toHaveBeenCalled();
    expect(d.decodeToPng).not.toHaveBeenCalled();
  });

  it('refuses an image whose header cannot be read', async () => {
    const d = deps();
    await expect(prepareFile({ name: 'cut.png', bytes: PNG.slice(0, 18), origin: 'computer' }, d)).rejects.toMatchObject({ code: 'bad-image' });
    expect(d.imageSize).not.toHaveBeenCalled();
  });

  it('says when an animated GIF is reduced to its first frame', async () => {
    const result = await prepareFile({ name: 'moving.gif', bytes: gifHeader(3), origin: 'computer' }, deps());
    expect(result).toMatchObject({ status: 'ready', notice: 'first-frame' });
  });

  it('checks that a PNG decodes and keeps it as it is', async () => {
    const d = deps();
    const result = await prepareFile({ name: 'p.png', bytes: PNG, origin: 'computer' }, d);
    expect(d.imageSize).toHaveBeenCalledWith(PNG, 'image/png');
    expect(result).toMatchObject({ status: 'ready', file: { kind: 'image', mimeType: 'image/png', pageCount: null } });
  });

  it('converts a GIF to PNG and keeps the name', async () => {
    const d = deps();
    const result = await prepareFile({ name: 'scan.gif', bytes: GIF, origin: 'computer' }, d);
    expect(d.decodeToPng).toHaveBeenCalledWith(GIF, 'image/gif');
    expect(result).toMatchObject({ status: 'ready', file: { name: 'scan.gif', mimeType: 'image/png', bytes: CONVERTED, size: CONVERTED.byteLength } });
  });

  it('refuses TIFF with a plain message', async () => {
    await expect(prepareFile({ name: 't.tif', bytes: TIFF, origin: 'computer' }, deps())).rejects.toThrow('TIFF images cannot be used');
  });

  it('passes a decode failure through', async () => {
    const imageSize = vi.fn(async () => {
      throw new PdfToolsError('bad-image', 'This image could not be read.');
    });
    await expect(prepareFile({ name: 'p.png', bytes: PNG, origin: 'computer' }, deps({ imageSize }))).rejects.toMatchObject({ code: 'bad-image' });
  });
});

describe('imageFormatOf', () => {
  it('recognises the supported and refused formats', () => {
    expect(imageFormatOf(PNG)).toBe('png');
    expect(imageFormatOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(imageFormatOf(GIF)).toBe('gif');
    expect(imageFormatOf(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageFormatOf(TIFF)).toBe('tiff');
    expect(imageFormatOf(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
  });
});
