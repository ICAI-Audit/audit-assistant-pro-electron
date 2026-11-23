// The engagement's earlier Form 3CD draft for the Form No. 26 workspace (BUILD-PLAN task 26): the one the audit
// was converted from, or else any Form 3CD audit the engagement holds (a year changed back and forth). Read
// through the store's select-only reader when the workspace opens; "Try again" reads again. Never a write.
import * as React from 'react';

import { getSQLiteClient } from '@/integrations/sqlite/client';
import type { ThreeCdSnapshot } from '@/lib/taxAuditForm26Conversion';
import { createForm26Store } from '@/lib/taxAuditForm26Store';

export type Form26ThreeCdDraftRead = { state: 'none' | 'loading' | 'found' | 'error'; snapshot: ThreeCdSnapshot | null; retry(): void };
type Held = { key: string; state: Form26ThreeCdDraftRead['state']; snapshot: ThreeCdSnapshot | null };

async function readDraft(engagementId: string, fromTaxAuditId: string | null): Promise<ThreeCdSnapshot | null> {
  const store = createForm26Store(getSQLiteClient());
  const id = fromTaxAuditId ?? (await store.findThreeCdAudit(engagementId))?.id ?? null;
  return id ? store.loadThreeCdSnapshot(id) : null;
}

/** `given` (tests): the draft as read already; then nothing is read. */
export function useForm26ThreeCdDraft(input: { engagementId: string; fromTaxAuditId: string | null } | null, given?: ThreeCdSnapshot | null): Form26ThreeCdDraftRead {
  const [attempt, setAttempt] = React.useState(0);
  const key = input ? `${input.engagementId}|${input.fromTaxAuditId ?? ''}|${attempt}` : '';
  const [held, setHeld] = React.useState<Held>({ key: '', state: 'none', snapshot: null });
  const retry = React.useCallback(() => setAttempt((value) => value + 1), []);

  const inputRef = React.useRef(input);
  inputRef.current = input;
  const reading = given === undefined;

  React.useEffect(() => {
    const now = inputRef.current;
    if (!reading || !now || key === '') return undefined;
    let alive = true;
    setHeld({ key, state: 'loading', snapshot: null });
    readDraft(now.engagementId, now.fromTaxAuditId).then(
      (snapshot) => {
        if (alive) setHeld({ key, state: snapshot ? 'found' : 'none', snapshot });
      },
      () => {
        if (alive) setHeld({ key, state: 'error', snapshot: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [key, reading]);

  if (given !== undefined) return { state: given ? 'found' : 'none', snapshot: given, retry };
  if (held.key !== key) return { state: input ? 'loading' : 'none', snapshot: null, retry };
  return { state: held.state, snapshot: held.snapshot, retry };
}
