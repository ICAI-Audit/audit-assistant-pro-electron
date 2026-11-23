import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  form26DownloadName,
  FORM26_SAVE_PICKER_ID,
  FORM26_SAVE_SENTENCES,
  FORM26_SAVE_TYPES,
  form26BeforeImportLine,
  form26SaveLine,
  saveForm26As,
  type Form26SaveResult,
} from '@/lib/taxAuditForm26SaveAs';
import type { Form26Values } from '@/lib/taxAuditForm26Values';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import { buildForm26ExportModel } from '@/lib/taxAuditForm26ExportModel';
import { form26BeforeImportFileName } from '@/lib/taxAuditForm26Import';
import { form26PackFileName } from '@/lib/taxAuditForm26Pack';
import { form26PdfFileName } from '@/lib/taxAuditForm26Pdf';
import { fileStem, saveFileName } from '@/lib/taxAuditForm26SaveFile';
import { form26DocxFileName } from '@/lib/taxAuditForm26Word';

// FIX-T29 D2: every Form No. 26 file goes through the window's own "Save As" (File System Access API), which
// answers only after the user has saved or cancelled. A download (Electron's own window) never tells the
// screen either, so a success sentence came while the window was still open and the import went ahead
// without its copy.

const domError = (name: string) => new DOMException(name, name);

class FakeHandle {
  bytes: Uint8Array | null = null;
  removed = false;
  aborted = false;
  /** What the chosen file holds on disk now (Chromium makes it, empty, when the user picks it). */
  size = 0;
  constructor(public name: string, private failWrite = false) {}
  async getFile() {
    return { size: this.size };
  }
  async remove() {
    this.removed = true;
  }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (data: Blob | string) => {
        if (this.failWrite) throw domError('QuotaExceededError');
        chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer()));
      },
      close: async () => {
        this.bytes = chunks.length === 1 ? chunks[0] : new Uint8Array(0);
        this.size = this.bytes.length;
      },
      abort: async () => {
        this.aborted = true;
      },
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

describe('Form No. 26 files through the save window', () => {
  it('asks with a proper name and the file type, then makes and writes the file: "saved" only after the write', async () => {
    const handle = new FakeHandle('Form26_AAAAA0000A.json');
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const order: string[] = [];
    const result = await saveForm26As({
      name: 'Form26_AAAAA0000A.json',
      kind: 'json',
      onPicked: () => order.push('picked'),
      ready: async () => (order.push('ready'), true),
      make: async () => (order.push('make'), '{"C.pan":"AAAAA0000A"}'),
    });
    expect(result).toEqual({ outcome: 'saved', name: 'Form26_AAAAA0000A.json' });
    expect(order).toEqual(['picked', 'ready', 'make']);
    expect(text(handle.bytes)).toBe('{"C.pan":"AAAAA0000A"}');
    expect(picker).toHaveBeenCalledWith({
      suggestedName: 'Form26_AAAAA0000A.json',
      id: FORM26_SAVE_PICKER_ID,
      types: [{ description: FORM26_SAVE_TYPES.json.description, accept: { 'application/json': ['.json'] } }],
    });
  });

  it('the Word and PDF types name their files and extensions', () => {
    expect(FORM26_SAVE_TYPES.docx).toEqual({ description: 'Word document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' });
    expect(FORM26_SAVE_TYPES.pdf).toEqual({ description: 'PDF document', mime: 'application/pdf', extension: '.pdf' });
    expect(FORM26_SAVE_TYPES.json).toEqual({ description: 'Form No. 26 save file', mime: 'application/json', extension: '.json' });
  });

  it('a Blob is written as it is', async () => {
    const handle = new FakeHandle('x.docx');
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const result = await saveForm26As({ name: 'x.docx', kind: 'docx', make: async () => new Blob([new Uint8Array([80, 75, 3, 4])]) });
    expect(result.outcome).toBe('saved');
    expect([...(handle.bytes ?? [])]).toEqual([80, 75, 3, 4]);
  });

  it('cancelled: nothing is made, nothing is written, and the caller is told so', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(domError('AbortError'))));
    const ready = vi.fn(async () => true);
    const make = vi.fn(async () => 'x');
    const onPicked = vi.fn();
    expect(await saveForm26As({ name: 'a.json', kind: 'json', ready, make, onPicked })).toEqual({ outcome: 'cancelled' });
    expect(ready).not.toHaveBeenCalled();
    expect(make).not.toHaveBeenCalled();
    expect(onPicked).not.toHaveBeenCalled();
  });

  it('another save window open: "busy", nothing made', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(domError('NotAllowedError'))));
    const make = vi.fn(async () => 'x');
    expect(await saveForm26As({ name: 'a.json', kind: 'json', make })).toEqual({ outcome: 'busy' });
    expect(make).not.toHaveBeenCalled();
  });

  it('no save window in this window: "unavailable" — never a silent download instead', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined);
    const make = vi.fn(async () => 'x');
    const click = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    expect(await saveForm26As({ name: 'a.json', kind: 'json', make })).toEqual({ outcome: 'unavailable' });
    expect(make).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    // A picker that fails for another reason (a security refusal): also unavailable, also no download.
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => Promise.reject(domError('SecurityError'))));
    expect(await saveForm26As({ name: 'a.json', kind: 'json', make })).toEqual({ outcome: 'unavailable' });
  });

  it('not ready (changes that cannot be saved): stopped, nothing made, the empty chosen file taken away', async () => {
    const handle = new FakeHandle('a.json');
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const make = vi.fn(async () => 'x');
    expect(await saveForm26As({ name: 'a.json', kind: 'json', ready: async () => false, make })).toEqual({ outcome: 'stopped' });
    expect(make).not.toHaveBeenCalled();
    expect(handle.removed).toBe(true);
    expect(handle.bytes).toBeNull();
  });

  it('the file could not be made: failed at "make", the empty chosen file taken away; a file the user chose to replace is kept', async () => {
    const handle = new FakeHandle('a.docx');
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const result = await saveForm26As({ name: 'a.docx', kind: 'docx', make: async () => { throw new Error('boom'); } });
    expect(result).toMatchObject({ outcome: 'failed', stage: 'make' });
    expect(handle.removed).toBe(true);

    const kept = new FakeHandle('old.docx');
    kept.size = 1234;
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => kept));
    expect((await saveForm26As({ name: 'old.docx', kind: 'docx', make: async () => { throw new Error('boom'); } })).outcome).toBe('failed');
    expect(kept.removed).toBe(false);
  });

  it('the write failed (no room, no right to write): failed at "write", the partial copy dropped, an empty file taken away', async () => {
    const handle = new FakeHandle('a.pdf', true);
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const result = await saveForm26As({ name: 'a.pdf', kind: 'pdf', make: async () => new Blob(['%PDF-']) });
    expect(result).toMatchObject({ outcome: 'failed', stage: 'write' });
    expect(handle.aborted).toBe(true);
    expect(handle.removed).toBe(true);
  });

  it('never throws, whatever goes wrong (a "ready" that throws counts as failed)', async () => {
    const handle = new FakeHandle('a.json');
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    await expect(saveForm26As({ name: 'a.json', kind: 'json', ready: async () => { throw new Error('x'); }, make: async () => 'x' })).resolves.toMatchObject({ outcome: 'failed', stage: 'make' });
  });

  it('the sentences: one plain sentence per outcome, none of them claiming a save that did not happen', () => {
    expect(FORM26_SAVE_SENTENCES).toEqual({
      cancelled: 'Not saved.',
      busy: 'Another save window is open. Finish with it, then try again.',
      unavailable: 'Files cannot be saved from this window.',
      writeFailed: 'The file could not be saved. Check that the folder can be written to and has free space, then try again.',
    });
  });

  it('file names come from the answers before anything is made (the Word, PDF, pack, save file and the copy before a load)', () => {
    const values = { f: { 'C.pan': 'AAAAA0000A' }, t: {} } as unknown as Form26Values;
    expect(form26DownloadName('word', values)).toBe('Form26_AAAAA0000A.docx');
    expect(form26DownloadName('pdf', values)).toBe('Form26_AAAAA0000A.pdf');
    expect(form26DownloadName('pack', values)).toBe('Form26_AAAAA0000A_working-papers.docx');
    expect(form26DownloadName('json', values)).toBe('Form26_AAAAA0000A.json');
    expect(form26DownloadName('before-import', values)).toBe('Form26_AAAAA0000A_before-import.json');
    expect(form26DownloadName('json', { f: {}, t: {} } as unknown as Form26Values)).toBe('Form26_Form26.json');
    // The same names the libraries give once the file is made.
    const model = buildForm26ExportModel(FORM26_DEFINITION, values, { showAllSchedules: false, generatedAt: '2026-11-23T00:00:00.000Z' });
    expect(form26DownloadName('word', values)).toBe(form26DocxFileName(model));
    expect(form26DownloadName('pdf', values)).toBe(form26PdfFileName(model));
    expect(form26DownloadName('pack', values)).toBe(form26PackFileName({ fileStem: model.fileStem }));
    expect(form26DownloadName('json', values)).toBe(saveFileName(values));
    expect(form26DownloadName('before-import', values)).toBe(form26BeforeImportFileName(fileStem(values)));
  });
});

describe('what the screen says after a save', () => {
  const texts = { done: 'The Word file was saved.', makeFailed: 'The Word file could not be made. Try again.', notReady: 'Some changes are not saved yet.' };
  const results: Form26SaveResult[] = [
    { outcome: 'saved', name: 'a.docx' },
    { outcome: 'cancelled' },
    { outcome: 'busy' },
    { outcome: 'unavailable' },
    { outcome: 'stopped' },
    { outcome: 'failed', stage: 'make', error: new Error('x') },
    { outcome: 'failed', stage: 'write', error: new Error('x') },
  ];

  it('a download: the success sentence only for a written file; a cancel says only "Not saved." in the line, without a toast', () => {
    expect(results.map((result) => form26SaveLine(result, texts))).toEqual([
      { text: 'The Word file was saved.', failed: false, toast: true },
      { text: 'Not saved.', failed: false, toast: false },
      { text: FORM26_SAVE_SENTENCES.busy, failed: true, toast: true },
      { text: FORM26_SAVE_SENTENCES.unavailable, failed: true, toast: true },
      { text: 'Some changes are not saved yet.', failed: true, toast: true },
      { text: 'The Word file could not be made. Try again.', failed: true, toast: true },
      { text: FORM26_SAVE_SENTENCES.writeFailed, failed: true, toast: true },
    ]);
  });

  it('the copy before a load: nothing is replaced unless it was saved, and one plain sentence says so', () => {
    expect(results.map((result) => form26BeforeImportLine(result, 'Some changes are not saved yet.'))).toEqual([
      null,
      'Nothing was changed: the copy of the present answers was not saved.',
      'Nothing was changed: the copy of the present answers was not saved.',
      'Nothing was changed: the copy of the present answers was not saved.',
      'Some changes are not saved yet.',
      'Nothing was changed: the copy of the present answers could not be saved.',
      'Nothing was changed: the copy of the present answers could not be saved.',
    ]);
  });
});
