// The Organise pages dialog's edit state: organiseEdit.ts's reducer, applied synchronously so that a
// key, a button and a drop each see the state the last one left, with the sentence a screen reader
// hears for what really changed (organiseAnnounce.ts). Nothing here holds file content.
import { useCallback, useRef, useState } from 'react';
import { createOrganiseState, type OrganiseEditAction, type OrganiseEditState } from '../organiseEdit';
import { announceActions } from './organiseAnnounce';

export interface Announcement {
  text: string;
  /** Counts announcements, so the same words are read out again (OrganiseLiveRegion). */
  n: number;
}

export interface OrganiseEditor {
  state: OrganiseEditState;
  /** The state as of the last apply, for handlers that run before the next render. */
  current: () => OrganiseEditState;
  /** Applies the actions in order and announces the last thing they did; returns the new state. */
  apply: (actions: readonly OrganiseEditAction[]) => OrganiseEditState;
  announcement: Announcement;
  /** Reads out a sentence that is not an edit (why an action cannot be used). */
  say: (text: string) => void;
}

export function useOrganiseEditor(pageCount: number): OrganiseEditor {
  const [state, setState] = useState(() => createOrganiseState(pageCount));
  const ref = useRef(state);
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', n: 0 });

  const apply = useCallback((actions: readonly OrganiseEditAction[]) => {
    const { state: next, text: said } = announceActions(ref.current, actions);
    if (next !== ref.current) {
      ref.current = next;
      setState(next);
    }
    if (said) setAnnouncement((last) => ({ text: said, n: last.n + 1 }));
    return next;
  }, []);

  const current = useCallback(() => ref.current, []);
  const say = useCallback((text: string) => setAnnouncement((last) => ({ text, n: last.n + 1 })), []);
  return { state, current, apply, announcement, say };
}
