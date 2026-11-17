// A file's bookmarks for the Bookmarks dialog and the list beside the page panel: read once per file,
// off the window's thread where a worker can be started (parsing a 500-page file takes about half a
// second, which would otherwise hold up the page panel), and on it where one cannot. The worker is ended
// as soon as nobody waits for its reading any more (the dialog closed, the list went, the engagement
// changed), and when it has not answered within READ_TIME_LIMIT_MS.
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { readBookmarkSource, type BookmarkSource } from './bookmarkRead';
import type { ReaderReply } from './bookmarkReader.worker';

export { newBookmarkView, readBookmarkSource, type BookmarkSource } from './bookmarkRead';

/**
 * How long the worker may stay silent before the reading is given up (and the worker ended). A worker
 * that reads says so every second (bookmarkReader.worker.ts), so a large file is never given up while it
 * is being read (QA-FIX B: a 320-page ledger was reported "could not be read" at 30 s while it still read).
 */
export const READ_TIME_LIMIT_MS = 30_000;
export const READ_TIMEOUT_MESSAGE = 'Reading the file stopped answering.';

/** The part of a Worker the reading uses (a stand-in in tests). */
export interface ReaderWorker {
  onmessage: ((event: MessageEvent<ReaderReply>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: Event) => void) | null;
  postMessage(message: Uint8Array, transfer: Transferable[]): void;
  terminate(): void;
}

function startWorker(): ReaderWorker {
  return new Worker(new URL('./bookmarkReader.worker.ts', import.meta.url), {
    type: 'module',
    name: 'vera-pdf-tools-bookmarks',
  }) as unknown as ReaderWorker;
}

const stopped = () => new PdfToolsError('cancelled', 'The reading of the bookmarks was stopped.');

export interface ReadOptions {
  /** Ends the worker at once and rejects with code 'cancelled'. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Reads in a worker given a copy of the bytes, and ends the worker once it has replied, been stopped or
 * run out of time. A worker that cannot start, or fails without a reply, is not a failure of the file:
 * it is read here instead.
 */
export function readOffThread(bytes: Uint8Array, start: () => ReaderWorker = startWorker, options: ReadOptions = {}): Promise<BookmarkSource> {
  const { signal, timeoutMs = READ_TIME_LIMIT_MS } = options;
  if (signal?.aborted) return Promise.reject(stopped());
  let worker: ReaderWorker;
  try {
    worker = start();
  } catch {
    return readBookmarkSource(bytes);
  }
  return new Promise<BookmarkSource>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(stopped());
    };
    const silent = () => {
      if (settled) return;
      finish();
      reject(new PdfToolsError('bookmarks-read-timeout', READ_TIMEOUT_MESSAGE));
    };
    let timer = setTimeout(silent, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    const readHere = (event: Event) => {
      event.preventDefault?.();
      if (settled) return;
      finish();
      readBookmarkSource(bytes).then(resolve, reject);
    };
    worker.onmessage = (event) => {
      if (settled) return;
      const reply = event.data;
      if ('alive' in reply) {
        // Still reading: the limit starts again.
        clearTimeout(timer);
        timer = setTimeout(silent, timeoutMs);
        return;
      }
      finish();
      if (reply.ok === true) resolve(reply.source);
      else {
        const refused = reply as Extract<ReaderReply, { ok: false }>;
        reject(new PdfToolsError(refused.code, refused.message));
      }
    };
    worker.onerror = readHere;
    worker.onmessageerror = readHere;
    try {
      const copy = bytes.slice();
      worker.postMessage(copy, [copy.buffer]);
    } catch {
      finish();
      readBookmarkSource(bytes).then(resolve, reject);
    }
  });
}

type Reader = (bytes: Uint8Array, signal: AbortSignal) => Promise<BookmarkSource>;

const defaultReader: Reader = (bytes, signal) => (typeof Worker === 'function' ? readOffThread(bytes, startWorker, { signal }) : readBookmarkSource(bytes));

interface Reading {
  promise: Promise<BookmarkSource>;
  /** Readers still waiting for it. */
  waiting: number;
  done: boolean;
  controller: AbortController;
}

// A working file's bytes never change, so a reading is kept with them and goes when they do (the file
// leaves the list, or the list is emptied on a change of engagement). Nothing is written anywhere.
const readings = new WeakMap<Uint8Array, Reading>();

/**
 * The file's bookmarks, read once: the list and the dialog share one reading. A reader that gives a
 * `signal` may leave (its promise rejects with code 'cancelled'); when the last waiting reader has left
 * before the reading is done, the reading is ended (its worker terminated) and not kept. A failure is not
 * kept either.
 */
export function cachedBookmarkSource(bytes: Uint8Array, signal?: AbortSignal, read: Reader = defaultReader): Promise<BookmarkSource> {
  if (signal?.aborted) return Promise.reject(stopped());
  let reading = readings.get(bytes);
  if (!reading) {
    const controller = new AbortController();
    const fresh: Reading = { promise: read(bytes, controller.signal), waiting: 0, done: false, controller };
    readings.set(bytes, fresh);
    fresh.promise.then(
      () => {
        fresh.done = true;
      },
      () => {
        fresh.done = true;
        if (readings.get(bytes) === fresh) readings.delete(bytes);
      },
    );
    reading = fresh;
  }
  if (!signal) {
    // A reader that never leaves keeps the reading going.
    reading.waiting = Number.POSITIVE_INFINITY;
    return reading.promise;
  }
  const shared = reading;
  shared.waiting++;
  return new Promise<BookmarkSource>((resolve, reject) => {
    const leave = () => {
      shared.waiting--;
      if (!shared.done && shared.waiting <= 0) {
        shared.controller.abort();
        if (readings.get(bytes) === shared) readings.delete(bytes);
      }
      reject(stopped());
    };
    signal.addEventListener('abort', leave, { once: true });
    shared.promise.then(
      (value) => {
        signal.removeEventListener('abort', leave);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', leave);
        reject(error);
      },
    );
  });
}
