// Before an engagement change throws away results that exist only in the PDF Tools list, the application
// asks (owner, 15 November 2026). EngagementContext asks every registered guard inside setCurrentEngagement and
// clearEngagement (the header's switch, "Go to selector", Sign out, the Engagements page) in its own dialog,
// whose title asks the question ("Change engagement anyway?" or "Log out anyway?"); a guard only says what would
// be lost. A sign-out forced by the session ending does not go through them and clears the list at once, as
// before. If the user confirms, or the engagement or user changes by any other route, the list is cleared
// exactly as before.
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { shouldDropContext } from './contextGuard';
import { isUnsavedResult } from './destinations';

/** What would be lost, in one sentence, or null when nothing would be. */
export function leaveQuestion(files: readonly WorkingFile[]): string | null {
  const count = files.filter(isUnsavedResult).length;
  if (count === 0) return null;
  return count === 1 ? '1 result in PDF Tools is not saved and will be removed.' : `${count} results in PDF Tools are not saved and will be removed.`;
}

/**
 * A guard for registerEngagementLeaveGuard that reads the list when it is asked, not when it was made. A
 * list already on its way out asks nothing (REV-C M2): when the engagement EngagementContext has saved is no
 * longer the list's (a change answered a moment ago, whose clearing waits for the screen's effect or the
 * watch within a second; or none saved), its results go whatever is answered, so a second change in that
 * time is not asked about them again. `storedEngagement` reads that saved engagement (engagementWatch.ts).
 */
export function engagementLeaveGuard(
  list: () => { contextKey: string | null; files: readonly WorkingFile[] },
  storedEngagement: () => string | null,
): () => string | null {
  return () => {
    const { contextKey, files } = list();
    let stored: string | null = null;
    try {
      stored = storedEngagement();
    } catch {
      stored = null; // unreadable: the watch drops the list too (contextGuard.ts)
    }
    if (shouldDropContext(contextKey, stored)) return null;
    return leaveQuestion(files);
  };
}
