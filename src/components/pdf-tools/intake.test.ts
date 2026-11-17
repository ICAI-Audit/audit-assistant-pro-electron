import { PDFDocument as CantooDocument } from '@cantoo/pdf-lib';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeFormPdf, makePdf } from '@/lib/pdf-tools/testPdf';
import { bilevelPicture, jpegOf, makeTiff, packBits1, rgbPicture, type PageSpec } from '@/lib/pdf-tools/testTiff';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { unlockPdf } from '@/lib/pdf-tools/unlock';
import { convertedNote, imageFormatOf, prepareFile, type IntakeDeps } from './intake';

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

  it("notes attachments in the document's list (Organise pages keeps them; Split, Delete pages and Merge do not)", async () => {
    expect(await prepareFile({ name: 'a.pdf', bytes: plain, origin: 'computer' }, deps())).toMatchObject({ status: 'ready', file: { hasAttachments: false } });
    const doc = await PDFDocument.load(plain);
    await doc.attach(new TextEncoder().encode('synthetic attachment body'), 'notes.txt', { mimeType: 'text/plain' });
    const attached = await prepareFile({ name: 'attached.pdf', bytes: await doc.save(), origin: 'computer' }, deps());
    expect(attached).toMatchObject({ status: 'ready', file: { hasAttachments: true } });
  });

  it('keeps the vault record id for vault input', async () => {
    const result = await prepareFile({ name: 'v.pdf', bytes: plain, origin: 'vault', evidenceId: 'ev-1' }, deps());
    expect(result.status === 'ready' && result.file.evidenceId).toBe('ev-1');
  });

  it('refuses an empty file and a file that is neither PDF nor image', async () => {
    await expect(prepareFile({ name: 'e.pdf', bytes: new Uint8Array(), origin: 'computer' }, deps())).rejects.toMatchObject({ code: 'empty-file' });
    const error = await prepareFile({ name: 'x.docx', bytes: new TextEncoder().encode('PK\u0003\u0004 not a pdf'), origin: 'computer' }, deps()).catch((e) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect(error.message).toBe('This file is not a PDF or a supported image (JPG, PNG, TIFF, WebP, BMP or GIF).');
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

  it('still refuses HEIC, in one sentence that says how to get a JPG from the phone (owner, 15 November 2026)', async () => {
    const heic = new TextEncoder().encode('\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000');
    const error = await prepareFile({ name: 'p.heic', bytes: heic, origin: 'computer' }, deps()).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'bad-image',
      message: 'iPhone photos (HEIC) cannot be used here; send the photo from the phone as a JPG, or set Camera > Formats > Most Compatible, and add it again.',
    });
  });

  it('passes a decode failure through', async () => {
    const imageSize = vi.fn(async () => {
      throw new PdfToolsError('bad-image', 'This image could not be read.');
    });
    await expect(prepareFile({ name: 'p.png', bytes: PNG, origin: 'computer' }, deps({ imageSize }))).rejects.toMatchObject({ code: 'bad-image' });
  });
});

describe('TIFF', () => {
  const [W, H] = [61, 43];
  const black = bilevelPicture(W, H, 3);
  const g4Page = (): PageSpec => ({ width: W, height: H, bitsPerSample: 1, photometric: 0, samples: packBits1(black, W, H), compression: 'g4', resolution: { x: 300, y: 300 } });
  // The JPEG pictures are made by pdf.js's canvas; its cold start took more than 20 s on a loaded
  // machine, so it is paid here, with its own limit, and not inside a test.
  let photoJpeg: Uint8Array;
  let smallJpeg: Uint8Array;
  beforeAll(async () => {
    photoJpeg = await jpegOf(rgbPicture(32, 24, 1), 32, 24, 3);
    smallJpeg = await jpegOf(rgbPicture(16, 16, 2), 16, 16, 3);
  }, 120_000);

  it('a one-page TIFF becomes a PNG image like a converted GIF: its name kept, marked as converted from TIFF', async () => {
    const bytes = makeTiff([g4Page()]);
    const before = Buffer.from(bytes).toString('hex');
    const stages: string[] = [];
    const d = deps({ onStage: (stage) => void stages.push(stage) });
    const result = await prepareFile({ name: 'Scan 001.tif', bytes, origin: 'computer' }, d);
    expect(result).toMatchObject({ status: 'ready', file: { name: 'Scan 001.tif', kind: 'image', mimeType: 'image/png', pageCount: null, origin: 'computer', convertedFrom: 'tiff' } });
    if (result.status !== 'ready') return;
    expect(result.notice).toBeUndefined();
    expect(Array.from(result.file.bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(result.file.size).toBe(result.file.bytes.byteLength);
    expect(stages).toEqual(['converting']);
    expect(d.decodeToPng).not.toHaveBeenCalled();
    expect(Buffer.from(bytes).toString('hex')).toBe(before); // the TIFF itself is not changed
    expect(convertedNote(result.file)).toBe('Converted from TIFF');
  });

  it('a one-page JPEG TIFF becomes its JPEG, checked by the same decoder as other JPEGs', async () => {
    const bytes = makeTiff([{ width: 32, height: 24, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: photoJpeg } }], 'MM');
    const d = deps();
    const result = await prepareFile({ name: 'photo.tiff', bytes, origin: 'vault', evidenceId: 'ev-9' }, d);
    expect(result).toMatchObject({ status: 'ready', file: { kind: 'image', mimeType: 'image/jpeg', evidenceId: 'ev-9', convertedFrom: 'tiff' } });
    if (result.status !== 'ready') return;
    expect(d.imageSize).toHaveBeenCalledWith(result.file.bytes, 'image/jpeg');
  });

  it('a several-page TIFF becomes one PDF with a page for each, marked as converted, with a notice', async () => {
    const bytes = makeTiff([g4Page(), g4Page(), { ...g4Page(), compression: 'lzw' }]);
    const pauses: { page: number; pages: number }[] = [];
    const result = await prepareFile({ name: 'statement.tif', bytes, origin: 'computer' }, deps({ pause: async (p) => void pauses.push(p) }));
    expect(result).toMatchObject({
      status: 'ready',
      notice: 'tiff-converted',
      file: { name: 'statement.tif', kind: 'pdf', mimeType: 'application/pdf', pageCount: 3, convertedFrom: 'tiff', wasProtected: false, hasSignature: false, hasFormFields: false, hasBookmarks: false },
    });
    if (result.status !== 'ready') return;
    expect((await PDFDocument.load(result.file.bytes)).getPageCount()).toBe(3);
    expect(new Set(pauses.map((p) => p.page))).toEqual(new Set([1, 2, 3]));
    expect(pauses.every((p) => p.pages === 3)).toBe(true);
    expect(convertedNote(result.file)).toBe('Converted from a 3-page TIFF');
  });

  it('a one-page TIFF that is turned, or has uneven pixels (a fax), becomes a one-page PDF', async () => {
    for (const extra of [{ orientation: 6 }, { resolution: { x: 204, y: 98 } }]) {
      const result = await prepareFile({ name: 'fax.tif', bytes: makeTiff([{ ...g4Page(), ...extra }]), origin: 'computer' }, deps());
      expect(result).toMatchObject({ status: 'ready', notice: 'tiff-converted', file: { kind: 'pdf', pageCount: 1, convertedFrom: 'tiff' } });
      if (result.status === 'ready') expect(convertedNote(result.file)).toBe('Converted from TIFF');
    }
  });

  it('stops when the pause throws (the list moved on), with that error', async () => {
    const stop = new Error('abandoned');
    const bytes = makeTiff([g4Page(), g4Page()]);
    await expect(prepareFile({ name: 's.tif', bytes, origin: 'computer' }, deps({ pause: async () => { throw stop; } }))).rejects.toBe(stop);
  });

  it('refuses a TIFF it cannot read exactly, with one plain sentence saying what to do', async () => {
    const plain = 'This TIFF is saved in a form PDF Tools cannot read; save it as PDF, JPG or PNG and add it again.';
    const big = new Uint8Array([0x49, 0x49, 43, 0, 8, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0, 0]);
    await expect(prepareFile({ name: 'b.tif', bytes: big, origin: 'computer' }, deps())).rejects.toMatchObject({ code: 'bad-image', message: plain, detail: 'BigTIFF' });
    const cmyk = makeTiff([{ width: 4, height: 4, photometric: 5, samplesPerPixel: 4, samples: new Uint8Array(64) }]);
    const error = await prepareFile({ name: 'c.tif', bytes: cmyk, origin: 'computer' }, deps()).catch((e) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect(error.message).toBe(plain);
    await expect(prepareFile({ name: 't.tif', bytes: TIFF, origin: 'computer' }, deps())).rejects.toMatchObject({
      code: 'bad-image',
      message: 'This TIFF file is damaged or incomplete; open it in the program that made it, save it again and add it again.',
    });
  });

  it('a JPEG page of a several-page TIFF that does not decode refuses the file, naming the page', async () => {
    const spec: PageSpec = { width: 16, height: 16, photometric: 6, samplesPerPixel: 3, compression: 'jpeg', jpeg: { strip: smallJpeg } };
    const imageSize = vi.fn(async () => {
      throw new PdfToolsError('bad-image', 'This image could not be read.');
    });
    const error = await prepareFile({ name: 'j.tif', bytes: makeTiff([spec, spec]), origin: 'computer' }, deps({ imageSize })).catch((e) => e);
    expect(error.message).toMatch(/^Page 1 of this TIFF is damaged/);
  });
});

describe('convertedNote', () => {
  it('says nothing for a file that was not converted', () => {
    expect(convertedNote({ kind: 'pdf', pageCount: 4 })).toBeNull();
    expect(convertedNote({ kind: 'pdf', pageCount: 12, convertedFrom: 'tiff' })).toBe('Converted from a 12-page TIFF');
    expect(convertedNote({ kind: 'image', pageCount: null, convertedFrom: 'tiff' })).toBe('Converted from TIFF');
  });
});

describe('imageFormatOf', () => {
  it('recognises the supported and refused formats', () => {
    expect(imageFormatOf(PNG)).toBe('png');
    expect(imageFormatOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(imageFormatOf(GIF)).toBe('gif');
    expect(imageFormatOf(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageFormatOf(TIFF)).toBe('tiff');
    expect(imageFormatOf(new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]))).toBe('tiff');
    expect(imageFormatOf(new Uint8Array([0x49, 0x49, 43, 0, 8, 0, 0, 0]))).toBe('tiff'); // BigTIFF: refused by the reader with its own sentence
    expect(imageFormatOf(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
  });
});
