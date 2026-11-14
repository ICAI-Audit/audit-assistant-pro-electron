// Empties the PDF Tools list when the engagement changes while the screen is closed.
//
// useWorkingList switches the store only while PDF Tools is mounted, so after A → (close) → B
// the list would still hold A's files in memory, and show them again on A. EngagementContext
// writes the chosen engagement to localStorage on every switch and removes it when none is chosen
// (and AuthContext removes it on sign-out). While the list has a context, this compares that
// value with the list's engagement every second and whenever the window regains focus or becomes
// visible, and empties the list (a new session) as soon as they differ. A notification from
// EngagementContext itself would be cleaner, but that needs an edit to a shared file.
import type { WorkingListStore } from '@/lib/pdf-tools/workingList';
import { shouldDropContext } from './contextGuard';

export const ENGAGEMENT_STORAGE_KEY = 'auditpro_current_engagement';
const POLL_MS = 1000;

export interface EngagementWatchDeps {
  store: Pick<WorkingListStore, 'getState' | 'subscribe' | 'setContext'>;
  readEngagement: () => string | null;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  listen: (type: 'focus' | 'visibilitychange', fn: () => void) => void;
}

/** Starts the watch and returns a function that stops it (used by tests). */
export function startEngagementWatch(deps: EngagementWatchDeps): () => void {
  const { store } = deps;
  let timer: unknown = null;
  let stopped = false;

  const check = () => {
    if (stopped) return;
    const { contextKey } = store.getState();
    let stored: string | null = null;
    try {
      stored = deps.readEngagement();
    } catch {
      stored = null; // storage unavailable: treat as no engagement
    }
    if (shouldDropContext(contextKey, stored)) store.setContext(null);
  };

  // Poll only while there is something to protect.
  const update = () => {
    const { contextKey, files } = store.getState();
    const needed = !stopped && (contextKey !== null || files.length > 0);
    if (needed && timer === null) timer = deps.setInterval(check, POLL_MS);
    if (!needed && timer !== null) {
      deps.clearInterval(timer);
      timer = null;
    }
  };

  const unsubscribe = store.subscribe(update);
  deps.listen('focus', check);
  deps.listen('visibilitychange', check);
  update();

  return () => {
    stopped = true;
    unsubscribe();
    update();
  };
}
