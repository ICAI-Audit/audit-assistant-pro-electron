import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyBookmarks, readBookmarks } from '@/lib/pdf-tools/bookmarks';
import { baseDoc, buildOutline, fit, makeOutlinePdf } from '@/lib/pdf-tools/testOutlinePdf';
import { makePdf } from '@/lib/pdf-tools/testPdf';
import { bookmarkEditReducer, initialBookmarkState, toOutline } from '../bookmarkEdit';
import type { ReaderReply } from './bookmarkReader.worker';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { cachedBookmarkSource, newBookmarkView, READ_TIME_LIMIT_MS, READ_TIMEOUT_MESSAGE, readBookmarkSource, readOffThread, type BookmarkSource, type ReaderWorker } from './bookmarkSource';

vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

/** The first bookmark's destination as pdf.js reads it: [page index, kind, ...numbers]. */
async function firstDestination(bytes: Uint8Array): Promise<unknown[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const [first] = (await pdf.getOutline()) ?? [];
  const dest = (typeof first.dest === 'string' ? await pdf.getDestination(first.dest) : first.dest) as unknown[];
  const page = await pdf.getPageIndex(dest[0] as never);
  await pdf.destroy();
  return [page, (dest[1] as { name: string }).name, ...dest.slice(2)];
}

describe('readBookmarkSource', () => {
  it('reads the same bookmarks as the library reader, in one load, with where each page starts', async () => {
    const bytes = await makeOutlinePdf();
    const source = await readBookmarkSource(bytes);
    const library = await readBookmarks(bytes);
    expect({
      items: source.items,
      problems: source.problems,
      editable: source.editable,
      notCarried: source.notCarried,
    }).toEqual(library);
    expect(source.pageTops).toEqual(Array.from({ length: 6 }, () => [0, 400]));
  });

  it('a page whose media box does not start at 0 gives its own left and top', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    doc.addPage([300, 400]).setMediaBox(10, 20, 300, 400);
    const source = await readBookmarkSource(await doc.save());
    expect(source.pageTops).toEqual([
      [0, 400],
      [10, 420],
    ]);
    expect(newBookmarkView(source, 1)).toEqual({
      kind: 'XYZ',
      args: [10, 420, null],
    });
  });

  it('a new bookmark goes to the top of its page at the reader’s zoom (/XYZ left top null), as pdf.js reads it', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    doc.addPage([500, 700]).setMediaBox(10, 20, 500, 700);
    const bytes = await doc.save();
    const source = await readBookmarkSource(bytes);
    const state = bookmarkEditReducer(initialBookmarkState(source.items), {
      type: 'add',
      page: 1,
      view: newBookmarkView(source, 1),
    });
    const saved = await applyBookmarks(bytes, toOutline(state));
    expect(await firstDestination(saved)).toEqual([1, 'XYZ', 10, 720, null]);
  });

  it('a file over the limits reads as not editable', async () => {
    const { doc } = await baseDoc(1);
    buildOutline(
      doc,
      Array.from({ length: 10_001 }, (_, i) => ({
        title: `B${i}`,
        dest: fit(doc, 0),
      })),
    );
    const source = await readBookmarkSource(await doc.save());
    expect(source.editable).toBe(false);
    expect(source.items).toHaveLength(10_000);
  });

  it('refuses what is not a PDF, in the library’s words', async () => {
    await expect(readBookmarkSource(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'not-a-pdf' });
  });

  // Measured on the build machine under load: pdf-lib's load 435-635 ms, the outline 49-94 ms, the page
  // boxes 3-14 ms (inspectPdf, which every added file goes through, 473-735 ms). The guard is loose
  // because other work shares the machine.
  it('reads 2,000 bookmarks of a 500-page file in about the time of one pdf-lib load', async () => {
    const { doc } = await baseDoc(500);
    buildOutline(
      doc,
      Array.from({ length: 400 }, (_, i) => ({
        title: `Section ${i + 1}`,
        dest: fit(doc, i),
        open: i % 2 === 0,
        children: Array.from({ length: 4 }, (_, k) => ({
          title: `Section ${i + 1}.${k + 1}`,
          dest: fit(doc, (i + k) % 500),
        })),
      })),
    );
    const bytes = await doc.save();
    const started = performance.now();
    // The limit is on this thread's processor time, not the clock, which on a busy machine also counts other work.
    const startedCpu = process.threadCpuUsage();
    const source = await readBookmarkSource(bytes);
    const used = process.threadCpuUsage(startedCpu);
    const took = performance.now() - started;
    const cpu = (used.user + used.system) / 1000;
    expect(source.items).toHaveLength(400);
    expect(source.pageTops).toHaveLength(500);
    console.log(`readBookmarkSource, 500 pages, 2,000 bookmarks: ${took.toFixed(0)} ms (${cpu.toFixed(0)} ms of processor time)`);
    expect(cpu).toBeLessThan(4_000);
  });
});

/** A stand-in for the reading worker: it does what `behave` says once it has been given the bytes. */
function fakeWorker(behave: (worker: ReaderWorker, bytes: Uint8Array) => void) {
  const calls = { terminated: 0, posted: null as Uint8Array | null };
  const worker: ReaderWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      calls.posted = message;
      setTimeout(() => behave(worker, message), 0);
    },
    terminate() {
      calls.terminated++;
    },
  };
  return { worker, calls };
}

describe('readOffThread', () => {
  it('takes the worker’s reply, gives it a copy of the bytes and ends it', async () => {
    const bytes = await makeOutlinePdf();
    const reply = await readBookmarkSource(bytes);
    const { worker, calls } = fakeWorker((w) =>
      w.onmessage?.({
        data: { ok: true, source: reply },
      } as MessageEvent<ReaderReply>),
    );
    expect(await readOffThread(bytes, () => worker)).toBe(reply);
    expect(calls.terminated).toBe(1);
    expect(calls.posted).not.toBe(bytes);
    expect(calls.posted?.buffer).not.toBe(bytes.buffer);
    expect(Array.from(calls.posted!)).toEqual(Array.from(bytes));
  });

  it('a refusal from the worker is the file’s refusal, in its plain words', async () => {
    const { worker, calls } = fakeWorker((w) =>
      w.onmessage?.({
        data: {
          ok: false,
          code: 'encrypted',
          message: 'This file is password-protected. Unlock it first.',
        },
      } as MessageEvent<ReaderReply>),
    );
    await expect(readOffThread(new Uint8Array([1]), () => worker)).rejects.toMatchObject({
      code: 'encrypted',
      message: 'This file is password-protected. Unlock it first.',
    });
    expect(calls.terminated).toBe(1);
  });

  it('a worker that fails without a reply, or cannot start, is not the file’s failure: it is read here instead', async () => {
    const bytes = await makeOutlinePdf();
    const { worker, calls } = fakeWorker((w) => w.onerror?.(new Event('error')));
    expect((await readOffThread(bytes, () => worker)).items).toHaveLength(5);
    expect(calls.terminated).toBe(1);
    const garbled = fakeWorker((w) => w.onmessageerror?.(new Event('messageerror')));
    expect((await readOffThread(bytes, () => garbled.worker)).items).toHaveLength(5);
    expect(
      (
        await readOffThread(bytes, () => {
          throw new Error('workers are not allowed here');
        })
      ).items,
    ).toHaveLength(5);
  });

  it('a late second message after the reply changes nothing', async () => {
    const bytes = await makeOutlinePdf();
    const reply = await readBookmarkSource(bytes);
    const { worker, calls } = fakeWorker((w) => {
      const first = w.onmessage;
      first?.({
        data: { ok: true, source: reply },
      } as MessageEvent<ReaderReply>);
      first?.({
        data: { ok: false, code: 'x', message: 'late' },
      } as MessageEvent<ReaderReply>);
    });
    expect(await readOffThread(bytes, () => worker)).toBe(reply);
    expect(calls.terminated).toBe(1);
  });
});

describe('readOffThread: ended when stopped or too slow', () => {
  it('a reading stopped by its signal ends the worker at once, without waiting for its reply', async () => {
    const { worker, calls } = fakeWorker(() => undefined); // never answers
    const controller = new AbortController();
    const reading = readOffThread(new Uint8Array([1, 2]), () => worker, { signal: controller.signal });
    controller.abort();
    await expect(reading).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls.terminated).toBe(1);
  });

  it('a signal already stopped starts no worker', async () => {
    const start = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(readOffThread(new Uint8Array([1]), start, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(start).not.toHaveBeenCalled();
  });

  it('a worker that does not answer in time is ended, and the reading fails in plain words', async () => {
    const { worker, calls } = fakeWorker(() => undefined);
    await expect(readOffThread(new Uint8Array([1]), () => worker, { timeoutMs: 40 })).rejects.toMatchObject({
      code: 'bookmarks-read-timeout',
      message: READ_TIMEOUT_MESSAGE,
    });
    expect(calls.terminated).toBe(1);
    // The limit is for a worker that says nothing at all: one that reads says so every second (QA-FIX B).
    expect(READ_TIME_LIMIT_MS).toBe(30_000);
  });
});

describe('cachedBookmarkSource: one reading shared, ended when the last reader leaves', () => {
  function pendingReader() {
    const signals: AbortSignal[] = [];
    const finish: ((value: BookmarkSource) => void)[] = [];
    const read = vi.fn((_bytes: Uint8Array, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<BookmarkSource>((resolve) => finish.push(resolve));
    });
    return { read, signals, finish };
  }
  const empty: BookmarkSource = {
    items: [],
    problems: { cycles: 0, truncatedNodes: false, truncatedDepth: false, longTitles: 0, unresolved: 0 },
    editable: true,
    notCarried: 0,
    pageTops: [],
  };

  it('goes on while one reader still waits, is ended when the last one leaves, and starts afresh after', async () => {
    const bytes = new Uint8Array([7]);
    const { read, signals } = pendingReader();
    const a = new AbortController();
    const b = new AbortController();
    const forA = cachedBookmarkSource(bytes, a.signal, read);
    const forB = cachedBookmarkSource(bytes, b.signal, read);
    expect(read).toHaveBeenCalledTimes(1);
    a.abort();
    await expect(forA).rejects.toMatchObject({ code: 'cancelled' });
    expect(signals[0].aborted).toBe(false);
    b.abort();
    await expect(forB).rejects.toMatchObject({ code: 'cancelled' });
    expect(signals[0].aborted).toBe(true);
    void cachedBookmarkSource(bytes, undefined, read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a reader that leaves after the reading is done changes nothing; the reading is kept', async () => {
    const bytes = new Uint8Array([8]);
    const { read, signals, finish } = pendingReader();
    const a = new AbortController();
    const forA = cachedBookmarkSource(bytes, a.signal, read);
    finish[0](empty);
    expect(await forA).toBe(empty);
    a.abort();
    expect(signals[0].aborted).toBe(false);
    expect(await cachedBookmarkSource(bytes, undefined, read)).toBe(empty);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a reading that ran out of time is not kept: the next reader tries again', async () => {
    const bytes = new Uint8Array([9]);
    const read = vi.fn(async () => {
      throw new PdfToolsError('bookmarks-read-timeout', 'The bookmarks could not be read in time.');
    });
    await expect(cachedBookmarkSource(bytes, undefined, read)).rejects.toMatchObject({ code: 'bookmarks-read-timeout' });
    await expect(cachedBookmarkSource(bytes, undefined, read)).rejects.toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('cachedBookmarkSource', () => {
  it('reads a file once, however often it is asked for', async () => {
    const bytes = await makeOutlinePdf();
    const first = cachedBookmarkSource(bytes);
    expect(cachedBookmarkSource(bytes)).toBe(first);
    expect(cachedBookmarkSource(bytes.slice())).not.toBe(first);
    expect((await first).items).toHaveLength(5);
  });

  it('a failed read is tried again next time', async () => {
    const bad = new Uint8Array([1, 2, 3]);
    const first = cachedBookmarkSource(bad);
    await expect(first).rejects.toMatchObject({ code: 'not-a-pdf' });
    expect(cachedBookmarkSource(bad)).not.toBe(first);
    await expect(cachedBookmarkSource(bad)).rejects.toBeTruthy();
  });

  it('a file without bookmarks reads as empty', async () => {
    expect((await cachedBookmarkSource(await makePdf('N', 2))).items).toEqual([]);
  });
});

describe('reading a large file without bookmarks is fast, and never "could not be read" while it works (QA-FIX B)', () => {
  it('reads without waiting for a timer every 100 objects (a 320-page ledger waited 163 times)', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 400; i++) doc.addPage([300, 400]).drawText(`Ledger page ${i + 1}`, { x: 20, y: 380, size: 10 });
    const bytes = await doc.save({ useObjectStreams: false });
    // The read waits by the clock now (pace.ts, at least every 50 ms of work), which a busy machine
    // stretches; with the clock standing still only waits counted in objects are left (INT3).
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      const source = await readBookmarkSource(bytes);
      expect(source.items).toEqual([]);
      expect(source.pageTops).toHaveLength(400);
      // pdf-lib's default would wait once per 100 of the file's 1,600-odd objects.
      expect(timers.mock.calls.length).toBeLessThan(4);
    } finally {
      timers.mockRestore();
      clock.mockRestore();
    }
  });

  it('a worker that keeps saying it is still reading is not stopped at the limit', async () => {
    const bytes = await makeOutlinePdf();
    const reply = await readBookmarkSource(bytes);
    const { worker, calls } = fakeWorker(() => undefined);
    vi.useFakeTimers();
    try {
      const reading = readOffThread(bytes, () => worker, { timeoutMs: 60 });
      // Five times the limit in all, with a sign of life every 50 ms.
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(50);
        worker.onmessage?.({ data: { alive: true } } as MessageEvent<ReaderReply>);
      }
      expect(calls.terminated).toBe(0);
      worker.onmessage?.({ data: { ok: true, source: reply } } as MessageEvent<ReaderReply>);
      expect(await reading).toBe(reply);
      expect(calls.terminated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('only a worker silent for the whole limit is ended, and the words say so plainly', async () => {
    const { worker, calls } = fakeWorker(() => undefined);
    await expect(readOffThread(new Uint8Array([1]), () => worker, { timeoutMs: 40 })).rejects.toMatchObject({
      code: 'bookmarks-read-timeout',
      message: READ_TIMEOUT_MESSAGE,
    });
    expect(READ_TIMEOUT_MESSAGE).not.toMatch(/could not be read/);
    expect(calls.terminated).toBe(1);
  });
});
