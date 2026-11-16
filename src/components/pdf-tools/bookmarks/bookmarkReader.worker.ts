// Reads one file's bookmarks off the window's thread (bookmarkSource.ts starts it, gives it a copy of
// the file's bytes, takes the one reply and ends it). It keeps nothing, writes nothing and says nothing
// but the reply: the bookmarks, or a PdfToolsError's code and plain message.
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { readBookmarkSource } from './bookmarkRead';

export type ReaderReply =
  | { ok: true; source: Awaited<ReturnType<typeof readBookmarkSource>> }
  | { ok: false; code: string; message: string }
  /** Sent every second while it reads: the reading is alive, however long a large file takes (QA-FIX B). */
  | { alive: true };

/** How often the worker says it is still reading. */
export const ALIVE_EVERY_MS = 1000;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Uint8Array>) => void) | null;
  postMessage: (reply: ReaderReply) => void;
};

scope.onmessage = (event) => {
  // The parse gives the event loop a turn every 1,500 objects, so this keeps coming while it reads.
  const alive = setInterval(() => scope.postMessage({ alive: true }), ALIVE_EVERY_MS);
  readBookmarkSource(event.data).finally(() => clearInterval(alive)).then(
    (source) => scope.postMessage({ ok: true, source }),
    (error: unknown) =>
      scope.postMessage(
        error instanceof PdfToolsError
          ? { ok: false, code: error.code, message: error.message }
          : {
              ok: false,
              code: 'not-a-pdf',
              message: 'This file could not be read as a PDF. It may be damaged.',
            },
      ),
  );
};
