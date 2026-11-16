// Messages that name a file of the list (the result message, a save's message) carry an id from here, so
// that all of them go when the list does: when the engagement or the user changes, also while the PDF Tools
// screen is closed (REV-B S3). Only ids are kept here, never anything about the files.
import type { WorkingListStore } from '@/lib/pdf-tools/workingList';

/** The one result message: a newer one replaces it (PdfTools.tsx). */
export const RESULT_MESSAGE = 'pdf-tools-result';

const shown = new Set<string>([RESULT_MESSAGE]);
let next = 0;

/** A new id for a message that names a file. */
export function fileMessageId(): string {
  const id = `pdf-tools-file-message-${++next}`;
  shown.add(id);
  return id;
}

/** Dismisses every message that names a file (`dismiss` is the toast library's). */
export function dismissFileMessages(dismiss: (id: string) => void): void {
  for (const id of shown) dismiss(id);
  shown.clear();
  shown.add(RESULT_MESSAGE);
}

/**
 * Dismisses them whenever the list moves to another engagement, user or session, until the returned function
 * is called. Registered once beside the list's other protections (useWorkingList.ts), not by the screen.
 */
export function dismissWhenListChanges(store: Pick<WorkingListStore, 'getState' | 'subscribe'>, dismiss: (id: string) => void): () => void {
  let { contextKey, session } = store.getState();
  return store.subscribe(() => {
    const now = store.getState();
    if (now.contextKey === contextKey && now.session === session) return;
    contextKey = now.contextKey;
    session = now.session;
    dismissFileMessages(dismiss);
  });
}
