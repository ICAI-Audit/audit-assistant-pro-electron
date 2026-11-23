// Last year's tax audit for the "Last year" tab (BUILD-PLAN task 25), read through the store's select-only
// reader (`loadLastYear`; the main process applies the access rules) when the tab is first opened, and kept
// for the engagement: a change of engagement, client or year reads again; "Try again" reads again.
import * as React from 'react';

import { getSQLiteClient } from '@/integrations/sqlite/client';
import { createForm26Store, type Form26LastYearResult } from '@/lib/taxAuditForm26Store';

export type Form26LastYearInput = { engagementId: string; clientId: string | null; financialYear: string };

type Held = { key: string; attempt: number; result: Form26LastYearResult | null };

async function readLastYear(input: Form26LastYearInput): Promise<Form26LastYearResult> {
  try {
    return await createForm26Store(getSQLiteClient()).loadLastYear(input);
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : 'Last year\'s tax audit could not be read.' };
  }
}

/** `result` is null while last year is being read (or before `enabled` was ever true). */
export function useForm26LastYear(input: Form26LastYearInput | null, enabled: boolean): { result: Form26LastYearResult | null; retry(): void } {
  const key = input ? `${input.engagementId}|${input.clientId ?? ''}|${input.financialYear}` : '';
  const [attempt, setAttempt] = React.useState(0);
  const [held, setHeld] = React.useState<Held>({ key: '', attempt: -1, result: null });
  const heldRef = React.useRef(held);
  heldRef.current = held;
  const inputRef = React.useRef(input);
  inputRef.current = input;

  React.useEffect(() => {
    const given = inputRef.current;
    if (!enabled || !given || key === '') return undefined;
    const now = heldRef.current;
    if (now.key === key && now.attempt === attempt) return undefined;          // read already, or being read
    let alive = true;
    setHeld({ key, attempt, result: null });
    void readLastYear(given).then((result) => {
      if (alive) setHeld({ key, attempt, result });
    });
    return () => {
      alive = false;
      // A read cut short (the tab left before it answered) is read again next time.
      setHeld((current) => (current.key === key && current.attempt === attempt && current.result === null ? { key: '', attempt: -1, result: null } : current));
    };
  }, [key, enabled, attempt]);

  const retry = React.useCallback(() => setAttempt((value) => value + 1), []);
  return { result: held.key === key ? held.result : null, retry };
}
