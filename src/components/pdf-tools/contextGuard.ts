import type { WorkingListState } from '@/lib/pdf-tools/workingList';

/**
 * Whether the working list must be emptied because the engagement saved by EngagementContext
 * (localStorage `auditpro_current_engagement`, JSON with an `id`) is no longer the list's.
 * `contextKey` is contextKeyFor(userId, engagementId), "<user>:<engagement>". An unreadable or
 * missing value counts as a change: the list is only kept when it provably still matches.
 */
export function shouldDropContext(contextKey: string | null, storedEngagement: string | null): boolean {
  if (contextKey === null) return false;
  if (storedEngagement === null) return true;
  let id: unknown;
  try {
    id = (JSON.parse(storedEngagement) as { id?: unknown } | null)?.id;
  } catch {
    return true;
  }
  if (typeof id !== 'string' || id === '') return true;
  const separator = contextKey.indexOf(':');
  return separator < 0 || contextKey.slice(separator + 1) !== id;
}

const emptyStates = new Map<string | null, WorkingListState>();

/**
 * What the screen may show: the store's snapshot only when it belongs to the signed-in user's
 * current engagement, otherwise an empty list (session -1, which the store never accepts).
 */
export function guardedState(snapshot: WorkingListState, contextKey: string | null): WorkingListState {
  if (snapshot.contextKey === contextKey && contextKey !== null) return snapshot;
  let empty = emptyStates.get(contextKey);
  if (!empty) {
    empty = Object.freeze({ contextKey, session: -1, files: [], selectedIds: [] }) as WorkingListState;
    emptyStates.clear(); // only the latest context is ever needed
    emptyStates.set(contextKey, empty);
  }
  return empty;
}
