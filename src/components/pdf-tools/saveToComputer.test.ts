import JSZip from 'jszip';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import {
  cleanedName,
  extensionFor,
  freeNameIn,
  numberedName,
  saveAsZip,
  saveManyToFolder,
  saveOne,
  SaveFailedError,
} from './saveToComputer';

vi.setConfig({ testTimeout: 20_000 });

// JSZip's first use is the slow part of the zip tests: pay it before they run.
beforeAll(async () => {
  await new JSZip().file('warm-up.txt', 'x').generateAsync({ type: 'uint8array' });
}, 30_000);

const PDF = new TextEncoder().encode('%PDF-1.7\n%fake\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const domError = (name: string) => new DOMException(name, name);

class FakeWritable {
  chunks: Uint8Array[] = [];
  aborted = false;
  closed = false;
  constructor(private onClose: (bytes: Uint8Array) => void, private failWrite = false) {}
  async write(data: Uint8Array) {
    if (this.failWrite) throw domError('QuotaExceededError');
    this.chunks.push(new Uint8Array(data));
  }
  async close() {
    this.closed = true;
    this.onClose(this.chunks.length === 1 ? this.chunks[0] : new Uint8Array(0));
  }
  async abort() {
    this.aborted = true;
  }
}

class FakeFileHandle {
  writables: FakeWritable[] = [];
  removed = false;
  /** What the file on disk holds now, in bytes (null: it cannot be read back). */
  size: number | null = 0;
  constructor(public name: string, private store: (bytes: Uint8Array) => void, private failWrite = false) {}
  async remove() {
    this.removed = true;
  }
  async getFile() {
    if (this.size === null) throw domError('NotReadableError');
    return { size: this.size };
  }
  async createWritable() {
    const writable = new FakeWritable(this.store, this.failWrite);
    this.writables.push(writable);
    return writable;
  }
}

/** A folder whose names compare without case, as on Windows. */
class FakeDirectory {
  files = new Map<string, { name: string; bytes: Uint8Array }>();
  folders = new Set<string>();
  failOn = new Set<string>();
  removedNames: string[] = [];
  constructor(existing: string[] = []) {
    for (const name of existing) this.files.set(name.toLowerCase(), { name, bytes: new Uint8Array() });
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const key = name.toLowerCase();
    if (this.folders.has(key)) throw domError('TypeMismatchError');
    if (!this.files.has(key) && !options.create) throw domError('NotFoundError');
    const handle = new FakeFileHandle(name, (bytes) => this.files.set(key, { name, bytes }), this.failOn.has(name));
    handle.remove = async () => {
      this.removedNames.push(name);
      this.files.delete(key);
    };
    return handle as unknown as FileSystemFileHandle;
  }
  names() {
    return [...this.files.values()].map((f) => f.name);
  }
}

interface Download {
  name: string;
  href: string;
}

function installFakeDocument(): Download[] {
  const downloads: Download[] = [];
  const body = { appendChild: vi.fn() };
  vi.stubGlobal('document', {
    body,
    createElement: () => {
      const anchor = { href: '', download: '', rel: '', style: {} as Record<string, string>, remove: vi.fn(), click: () => downloads.push({ name: anchor.download, href: anchor.href }) };
      return anchor;
    },
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${downloads.length}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  return downloads;
}

let downloads: Download[];

beforeEach(() => {
  downloads = installFakeDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('names', () => {
  it('numbers a name before its extension', () => {
    expect(numberedName('Bank statement.pdf', 1)).toBe('Bank statement.pdf');
    expect(numberedName('Bank statement.pdf', 2)).toBe('Bank statement (2).pdf');
    expect(numberedName('notes', 3)).toBe('notes (3)');
  });

  it('keeps a numbered name within 120 characters', () => {
    const long = `${'a'.repeat(116)}.pdf`;
    const out = numberedName(long, 12);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(' (12).pdf')).toBe(true);
  });

  it('takes the extension from the type, then the name, then the content', () => {
    expect(extensionFor({ name: 'scan', bytes: PDF, mimeType: 'application/pdf' })).toBe('pdf');
    expect(extensionFor({ name: 'photo.jpeg', bytes: PNG, mimeType: 'image/jpeg' })).toBe('jpeg');
    expect(extensionFor({ name: 'page_001.png', bytes: PNG })).toBe('png');
    expect(extensionFor({ name: 'no extension', bytes: PDF })).toBe('pdf');
  });

  it('replaces an image extension that disagrees with the type, and keeps other dots', () => {
    expect(cleanedName({ name: 'scan.gif', bytes: PNG, mimeType: 'image/png' })).toBe('scan.png');
    expect(cleanedName({ name: 'Scan.WEBP', bytes: PNG, mimeType: 'image/png' })).toBe('Scan.png');
    expect(cleanedName({ name: 'photo.jpeg', bytes: PNG, mimeType: 'image/jpeg' })).toBe('photo.jpeg');
    expect(cleanedName({ name: 'merged.png', bytes: PDF, mimeType: 'application/pdf' })).toBe('merged.pdf');
    expect(cleanedName({ name: 'report.v2', bytes: PDF, mimeType: 'application/pdf' })).toBe('report.v2.pdf');
  });

  it('finds the first free name in a folder, ignoring case', async () => {
    const dir = new FakeDirectory(['Bank.pdf', 'bank (2).PDF']);
    expect(await freeNameIn(dir, 'Bank.pdf')).toBe('Bank (3).pdf');
    expect(await freeNameIn(dir, 'Other.pdf')).toBe('Other.pdf');
  });

  it('treats a folder of the same name as taken', async () => {
    const dir = new FakeDirectory();
    dir.folders.add('report.pdf');
    expect(await freeNameIn(dir, 'report.pdf')).toBe('report (2).pdf');
  });
});

describe('saveManyToFolder with the folder picker', () => {
  it('never overwrites: existing and repeated names get numbers', async () => {
    const dir = new FakeDirectory(['Bank.pdf', 'Bank (2).pdf']);
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dir));
    const result = await saveManyToFolder([
      { name: 'Bank.pdf', bytes: PDF },
      { name: 'Bank.pdf', bytes: PDF },
      { name: 'Ledger.PDF', bytes: PDF },
    ]);
    expect(result).toEqual({ outcome: 'saved', written: ['Bank (3).pdf', 'Bank (4).pdf', 'Ledger.pdf'] });
    expect(dir.names()).toEqual(['Bank.pdf', 'Bank (2).pdf', 'Bank (3).pdf', 'Bank (4).pdf', 'Ledger.pdf']);
    expect(Array.from(dir.files.get('bank (3).pdf')!.bytes)).toEqual(Array.from(PDF));
    expect(downloads).toEqual([]);
  });

  it('cleans names before saving', async () => {
    const dir = new FakeDirectory();
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dir));
    const result = await saveManyToFolder([{ name: 'Bad:name?<1>.PDF', bytes: PDF }, { name: 'CON', bytes: PDF }]);
    expect(result.written).toEqual(['Bad_name__1_.pdf', 'CON_.pdf']);
  });

  it('reports cancellation and writes nothing', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => Promise.reject(domError('AbortError'))));
    const result = await saveManyToFolder([{ name: 'a.pdf', bytes: PDF }]);
    expect(result).toEqual({ outcome: 'cancelled', written: [] });
    expect(downloads).toEqual([]);
  });

  it('stops at a failed write and says which files were saved', async () => {
    const dir = new FakeDirectory();
    dir.failOn.add('b.pdf');
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dir));
    const error = await saveManyToFolder([
      { name: 'a.pdf', bytes: PDF },
      { name: 'b.pdf', bytes: PDF },
      { name: 'c.pdf', bytes: PDF },
    ]).catch((e) => e);
    expect(error).toBeInstanceOf(SaveFailedError);
    expect(error.written).toEqual(['a.pdf']);
    expect(error.message).toContain('"b.pdf"');
    expect(error.message).toContain('1 of 3');
    expect(dir.names()).toEqual(['a.pdf']);
    expect(dir.removedNames).toEqual(['b.pdf']);
  });
});

describe('saying when the location was chosen (the writing starts)', () => {
  it('a folder save says so once the folder is chosen, and not when the folder window ends without one', async () => {
    const onPicked = vi.fn();
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => new FakeDirectory()));
    await saveManyToFolder([{ name: 'a.pdf', bytes: PDF }], { onPicked });
    expect(onPicked).toHaveBeenCalledTimes(1);
    onPicked.mockClear();
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => Promise.reject(domError('AbortError'))));
    expect(await saveManyToFolder([{ name: 'a.pdf', bytes: PDF }], { onPicked })).toEqual({ outcome: 'cancelled', written: [] });
    expect(onPicked).not.toHaveBeenCalled();
  });

  it('Save As says so once the file is chosen, not on a cancel; a download fallback says so too', async () => {
    const onPicked = vi.fn();
    vi.stubGlobal('showSaveFilePicker', vi.fn(async (o: { suggestedName: string }) => new FakeFileHandle(o.suggestedName, () => undefined)));
    expect(await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }, { onPicked })).toBe('saved');
    expect(onPicked).toHaveBeenCalledTimes(1);
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(domError('AbortError'))));
    expect(await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }, { onPicked })).toBe('cancelled');
    expect(onPicked).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    downloads = installFakeDocument();
    expect(await saveManyToFolder([{ name: 'a.pdf', bytes: PDF }], { onPicked })).toMatchObject({ outcome: 'downloaded' });
    expect(onPicked).toHaveBeenCalledTimes(2);
  });
});

describe('a save window that is already open', () => {
  it('is reported as such, never turned into a download', async () => {
    const onPicked = vi.fn();
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => Promise.reject(domError('NotAllowedError'))));
    expect(await saveManyToFolder([{ name: 'a.pdf', bytes: PDF }, { name: 'b.pdf', bytes: PDF }], { onPicked })).toEqual({ outcome: 'busy', written: [] });
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(domError('NotAllowedError'))));
    expect(await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }, { onPicked })).toBe('busy');
    expect(await saveAsZip('both', [{ name: 'a.pdf', bytes: PDF }], { onPicked })).toBe('busy');
    expect(downloads).toEqual([]);
    expect(onPicked).not.toHaveBeenCalled();
  });
});

describe('fallback to downloads', () => {
  it('downloads each file with distinct names when there is no folder picker', async () => {
    const result = await saveManyToFolder([
      { name: 'a.pdf', bytes: PDF },
      { name: 'A.pdf', bytes: PDF },
      { name: 'page_001.png', bytes: PNG },
    ]);
    expect(result).toEqual({ outcome: 'downloaded', written: ['a.pdf', 'A (2).pdf', 'page_001.png'] });
    expect(downloads.map((d) => d.name)).toEqual(['a.pdf', 'A (2).pdf', 'page_001.png']);
  });

  it('downloads when the folder picker fails for another reason', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => Promise.reject(domError('SecurityError'))));
    const result = await saveManyToFolder([{ name: 'x.pdf', bytes: PDF }]);
    expect(result.outcome).toBe('downloaded');
    expect(downloads.map((d) => d.name)).toEqual(['x.pdf']);
  });

  it('saveOne downloads a PDF as .pdf, never zipped, when there is no save picker', async () => {
    expect(await saveOne({ name: 'Merged: final', bytes: PDF, mimeType: 'application/pdf' })).toBe('downloaded');
    expect(downloads.map((d) => d.name)).toEqual(['Merged_ final.pdf']);
  });

  it('saveOne downloads when the save picker throws something other than a cancel', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(new TypeError('not supported'))));
    expect(await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' })).toBe('downloaded');
    expect(downloads).toHaveLength(1);
  });
});

describe('saveOne with the save picker', () => {
  it('suggests the cleaned name and writes the bytes', async () => {
    let written: Uint8Array | null = null;
    const picker = vi.fn(async (options: { suggestedName: string }) => new FakeFileHandle(options.suggestedName, (b) => (written = b)));
    vi.stubGlobal('showSaveFilePicker', picker);
    expect(await saveOne({ name: 'Bank Statement.PDF', bytes: PDF, mimeType: 'application/pdf' })).toBe('saved');
    expect(picker.mock.calls[0][0].suggestedName).toBe('Bank Statement.pdf');
    expect(picker.mock.calls[0][0]).toMatchObject({ types: [{ accept: { 'application/pdf': ['.pdf'] } }] });
    expect(Array.from(written!)).toEqual(Array.from(PDF));
    expect(downloads).toEqual([]);
  });

  it('keeps an image type', async () => {
    const picker = vi.fn(async (options: { suggestedName: string }) => new FakeFileHandle(options.suggestedName, () => undefined));
    vi.stubGlobal('showSaveFilePicker', picker);
    await saveOne({ name: 'Bank_page_001.png', bytes: PNG, mimeType: 'image/png' });
    expect(picker.mock.calls[0][0].suggestedName).toBe('Bank_page_001.png');
  });

  it('reports cancellation without downloading', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(domError('AbortError'))));
    expect(await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' })).toBe('cancelled');
    expect(downloads).toEqual([]);
  });

  it('throws a plain error when the write fails, and discards the partial file', async () => {
    const handle = new FakeFileHandle('r.pdf', () => undefined, true);
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const error = await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }).catch((e) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect(error.code).toBe('save-failed');
    expect(handle.writables[0].aborted).toBe(true);
    expect(handle.writables[0].closed).toBe(false);
    expect(downloads).toEqual([]);
  });

  it('removes the chosen file after a failed write only when it is empty, and says so', async () => {
    const handle = new FakeFileHandle('r.pdf', () => undefined, true);
    handle.size = 0;
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const error = await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }).catch((e) => e);
    expect(handle.removed).toBe(true);
    expect(error.message).toContain('An empty file was removed.');
    expect(error.message).not.toContain('Nothing usable');
  });

  it('never removes a file that still holds data (for example one the user chose to replace)', async () => {
    const handle = new FakeFileHandle('r.pdf', () => undefined, true);
    handle.size = 5000;
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const error = await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }).catch((e) => e);
    expect(handle.removed).toBe(false);
    expect(error.code).toBe('save-failed');
    expect(error.message).toContain('may be incomplete: r.pdf');
    expect(error.message).not.toContain('removed');
  });

  it('leaves the file alone when it cannot be read back', async () => {
    const handle = new FakeFileHandle('r.pdf', () => undefined, true);
    handle.size = null;
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const error = await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }).catch((e) => e);
    expect(handle.removed).toBe(false);
    expect(error.message).toContain('may be incomplete: r.pdf');
  });

  it('swallows a remove that fails and does not claim the file was removed', async () => {
    const handle = new FakeFileHandle('r.pdf', () => undefined, true);
    handle.size = 0;
    handle.remove = async () => {
      throw domError('NoModificationAllowedError');
    };
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const error = await saveOne({ name: 'r.pdf', bytes: PDF, mimeType: 'application/pdf' }).catch((e) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect(error.code).toBe('save-failed');
    expect(error.message).toContain('may be incomplete: r.pdf');
  });

  it('looks the picker up at call time', async () => {
    expect(await saveOne({ name: 'a.pdf', bytes: PDF, mimeType: 'application/pdf' })).toBe('downloaded');
    vi.stubGlobal('showSaveFilePicker', vi.fn(async (o: { suggestedName: string }) => new FakeFileHandle(o.suggestedName, () => undefined)));
    expect(await saveOne({ name: 'a.pdf', bytes: PDF, mimeType: 'application/pdf' })).toBe('saved');
  });
});

describe('saveAsZip', () => {
  it('asks for the location first and writes a zip with distinct, cleaned names', async () => {
    let written: Uint8Array | null = null;
    const picker = vi.fn(async (options: { suggestedName: string }) => new FakeFileHandle(options.suggestedName, (b) => (written = b)));
    vi.stubGlobal('showSaveFilePicker', picker);
    const outcome = await saveAsZip('Results?', [
      { name: 'a.pdf', bytes: PDF },
      { name: 'a.pdf', bytes: PDF },
      { name: 'p:1.png', bytes: PNG },
    ]);
    expect(outcome).toBe('saved');
    expect(picker.mock.calls[0][0].suggestedName).toBe('Results_.zip');
    const zip = await JSZip.loadAsync(written!);
    expect(Object.keys(zip.files).sort()).toEqual(['a (2).pdf', 'a.pdf', 'p_1.png']);
    expect(Array.from(await zip.file('a (2).pdf')!.async('uint8array'))).toEqual(Array.from(PDF));
  });

  it('builds nothing when cancelled', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(domError('AbortError'))));
    expect(await saveAsZip('r', [{ name: 'a.pdf', bytes: PDF }])).toBe('cancelled');
    expect(downloads).toEqual([]);
  });

  it('downloads the zip when there is no save picker', async () => {
    expect(await saveAsZip('r.zip', [{ name: 'a.pdf', bytes: PDF }])).toBe('downloaded');
    expect(downloads.map((d) => d.name)).toEqual(['r.zip']);
  });
});
