import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useEngagement } from '@/contexts/EngagementContext';
import { contextKeyFor, workingListStore, type WorkingListState, type WorkingListStore } from '@/lib/pdf-tools/workingList';
import { guardedState } from './contextGuard';
import { ENGAGEMENT_STORAGE_KEY, startEngagementWatch } from './engagementWatch';

// Registered once, when PDF Tools is first loaded, and never removed: they protect the list while
// the screen is closed. Sign-out (AuthContext's 'auditpro:session-reset') empties it at once; a
// change of engagement is noticed by engagementWatch within a second or on window focus.
if (typeof window !== 'undefined') {
  const onSessionReset = () => workingListStore.setContext(null);
  const listeners: [EventTarget, string, () => void][] = [];
  window.addEventListener('auditpro:session-reset', onSessionReset);
  const stopWatch = startEngagementWatch({
    store: workingListStore,
    readEngagement: () => window.localStorage.getItem(ENGAGEMENT_STORAGE_KEY),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    listen: (type, fn) => {
      const target = type === 'visibilitychange' ? document : window;
      target.addEventListener(type, fn);
      listeners.push([target, type, fn]);
    },
  });
  // In development a hot reload runs this module again; take the old watcher and listeners away first.
  import.meta.hot?.dispose(() => {
    window.removeEventListener('auditpro:session-reset', onSessionReset);
    stopWatch();
    for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
  });
}

/**
 * The PDF Tools file list of the signed-in user in the current engagement. The store is switched
 * to that user and engagement in an effect; until it has been, an empty list is returned, so files
 * of another engagement or user are never shown, not even for one render.
 *
 * Read working files only from this hook's `state`, never from `workingListStore.getState()`
 * directly. The one exception is a flow that captured `const { contextKey, session } =
 * store.getState()` before its first await and passes both back to the store's calls (and checks
 * the session again before marking or announcing anything).
 */
export function useWorkingList(): { state: WorkingListState; contextKey: string | null; store: WorkingListStore } {
  const { user } = useAuth();
  const { currentEngagement } = useEngagement();
  const userId = user?.id ?? null;
  const engagementId = currentEngagement?.id ?? null;
  const contextKey = userId && engagementId ? contextKeyFor(userId, engagementId) : null;

  const snapshot = useSyncExternalStore(workingListStore.subscribe, workingListStore.getState);

  useEffect(() => {
    workingListStore.setContext(contextKey);
  }, [contextKey]);

  return { state: guardedState(snapshot, contextKey), contextKey, store: workingListStore };
}
