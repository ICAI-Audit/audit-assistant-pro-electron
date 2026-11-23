// The hook of the Form No. 26 workspace. Thin on purpose: it makes one session (src/lib/taxAuditForm26Session.ts,
// where every rule lives and is tested) per engagement with the application's SQLite client, follows its
// state, and works out the counts the screen shows. Changing the engagement closes the earlier session
// after saving what waits, so the earlier engagement's answers are never shown for the new one.
import * as React from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import type { Form26Category, Form26Definition } from '@/data/taxAuditForm26Types';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import type { Form26ImportablePlan } from '@/lib/taxAuditForm26Import';
import { summarise } from '@/lib/taxAuditForm26Review';
import type { Form26SaveState } from '@/lib/taxAuditForm26SaveQueue';
import { createForm26Session, type Form26Conflict, type Form26ImportOutcome, type Form26Session, type Form26SessionState, type Form26SessionStatus } from '@/lib/taxAuditForm26Session';
import type { Form26Setup } from '@/lib/taxAuditForm26Storage';
import { createForm26Store, type Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, createForm26UnfilledCache, scanUnfilled, type Form26UnfilledCounts, type Form26UnfilledItem } from '@/lib/taxAuditForm26Unfilled';
import type { Form26Row, Form26Values } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseEvidence, TaxAuditReviewStatus, TaxAuditSetup, TaxAuditSummary } from '@/types/taxAudit';

export type UseTaxAuditForm26Result = {
  status: Form26SessionStatus;
  errorMessage: string | null;
  retry(): void;
  def: Form26Definition;
  audit: TaxAuditSetup | null;
  setup: Form26Setup;
  values: Form26Values;
  rowsByKey: Map<string, Form26ClauseRow>;
  evidence: TaxAuditClauseEvidence[];
  unfilled: Form26UnfilledItem[];
  counts: Form26UnfilledCounts;
  summary: TaxAuditSummary;
  saveState: Form26SaveState;
  unconfirmed: ReadonlySet<string>;
  /** Answers (and the category, as 'cat') that met someone else's change, by key. */
  fieldConflicts: Record<string, Form26Conflict>;
  /** Tables that met someone else's change (or their clause's approval), by table id. */
  tableConflicts: Record<string, Form26Conflict>;
  setField(fieldKey: string, value: string): void;
  fieldFocused(fieldKey: string): void;
  fieldBlurred(fieldKey: string): void;
  setTable(tableId: string, rows: Form26Row[]): void;
  tableLeft(tableId: string): void;
  setCategory(category: '' | Form26Category): Promise<void>;
  setShowAllSchedules(on: boolean): Promise<void>;
  setStatus(clauseKey: string, status: TaxAuditReviewStatus, options?: { unlockReason?: string }): Promise<boolean>;
  updateRow(clauseKey: string, patch: Pick<Partial<Form26ClauseRow>, 'auditor_remarks_html' | 'qualification_required' | 'qualification_text_html'>): Promise<boolean>;
  confirmBrought(fieldKey: string): Promise<void>;
  resolveConflict(fieldKey: string, keep: 'mine' | 'theirs'): Promise<void>;
  resolveTableConflict(tableId: string, keep: 'mine' | 'theirs'): Promise<void>;
  linkEvidence(clauseKey: string, evidenceFileId: string): Promise<void>;
  unlinkEvidence(linkId: string): Promise<void>;
  /** Loads a save file the user has confirmed (task 23): see Form26Session.applyImport. */
  applyImport(plan: Form26ImportablePlan, fileName: string, opts?: { onProgress?(done: number, total: number): void }): Promise<Form26ImportOutcome>;
  flush(): Promise<boolean>;
  reload(): Promise<void>;
  hasPending(): boolean;
  hasUnresolved(): boolean;
  /** The unfilled items for the answers as they are this moment (also before the screen has repainted). */
  unfilledNow(): Form26UnfilledItem[];
};

const IDLE: Form26SessionState = {
  status: 'no-engagement',
  errorMessage: null,
  threeCdAuditId: null,
  audit: null,
  setup: { v: 1, category: '', showAllSchedules: false },
  values: { f: {}, t: {} },
  rowsByKey: new Map(),
  evidence: [],
  saveState: { kind: 'idle' },
  unconfirmed: new Set(),
  fieldConflicts: {},
  tableConflicts: {},
};

const OPENING: Form26SessionState = { ...IDLE, status: 'loading' };

const scan = (state: Form26SessionState) => scanUnfilled(FORM26_DEFINITION, state.values, { showAllSchedules: state.setup.showAllSchedules, unconfirmed: state.unconfirmed });

export function useTaxAuditForm26(engagement: { id: string; client_id?: string | null; financial_year?: string | null } | null): UseTaxAuditForm26Result {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const engagementId = engagement?.id ?? null;
  const clientId = engagement?.client_id ?? null;
  const financialYear = engagement?.financial_year ?? null;

  const [session, setSession] = React.useState<Form26Session | null>(null);
  // The state is kept with the engagement it belongs to: for one frame after a change of engagement the
  // earlier session's state is still held, and it must not be shown for the new engagement.
  const [held, setHeld] = React.useState<{ engagementId: string | null; state: Form26SessionState }>({ engagementId: null, state: IDLE });
  const state = held.engagementId === engagementId ? held.state : engagementId ? OPENING : IDLE;

  React.useEffect(() => {
    if (!engagementId) {
      setSession(null);
      setHeld({ engagementId: null, state: IDLE });
      return undefined;
    }
    const next = createForm26Session({
      store: createForm26Store(getSQLiteClient()),
      engagement: { id: engagementId, client_id: clientId, financial_year: financialYear },
      userId,
      onNotice: (notice) => {
        if (notice.tone === 'error') toast.error(notice.text);
        else if (notice.tone === 'warning') toast.warning(notice.text);
        else toast.success(notice.text);
      },
    });
    setSession(next);
    setHeld({ engagementId, state: next.getState() });
    const stop = next.subscribe((latest) => setHeld({ engagementId, state: latest }));
    void next.load();
    return () => {
      stop();
      // What waits is saved before the session is closed; the screen no longer follows it.
      void next.flush().finally(() => next.dispose());
    };
  }, [engagementId, clientId, financialYear, userId]);

  const { values, unconfirmed } = state;
  const showAllSchedules = state.setup.showAllSchedules;
  // Tables whose rows did not change are not read again on every key (task 27: 250 rows in every table).
  // (Keyed by the lists of rows themselves, so one cache serves every engagement the hook shows.)
  const [unfilledCache] = React.useState(createForm26UnfilledCache);
  const unfilled = React.useMemo(() => scanUnfilled(FORM26_DEFINITION, values, { showAllSchedules, unconfirmed, cache: unfilledCache }), [values, showAllSchedules, unconfirmed, unfilledCache]);
  const counts = React.useMemo(() => countUnfilled(FORM26_DEFINITION, unfilled), [unfilled]);
  const summary = React.useMemo(() => summarise(FORM26_CLAUSE_UNITS, state.rowsByKey, state.evidence), [state.rowsByKey, state.evidence]);

  const actions = React.useMemo(() => {
    const none = async () => false;
    return {
      retry: () => void session?.reload(),
      setField: (key: string, value: string) => session?.setField(key, value),
      fieldFocused: (key: string) => session?.fieldFocused(key),
      fieldBlurred: (key: string) => session?.fieldBlurred(key),
      setTable: (id: string, rows: Form26Row[]) => session?.setTable(id, rows),
      tableLeft: (id: string) => session?.tableLeft(id),
      setCategory: async (category: '' | Form26Category) => session?.setCategory(category),
      setShowAllSchedules: async (on: boolean) => session?.setShowAllSchedules(on),
      setStatus: (key: string, status: TaxAuditReviewStatus, options?: { unlockReason?: string }) => session?.setStatus(key, status, options) ?? none(),
      updateRow: (key: string, patch: Pick<Partial<Form26ClauseRow>, 'auditor_remarks_html' | 'qualification_required' | 'qualification_text_html'>) => session?.updateRow(key, patch) ?? none(),
      confirmBrought: async (key: string) => session?.confirmBrought(key),
      resolveConflict: async (key: string, keep: 'mine' | 'theirs') => session?.resolveConflict(key, keep),
      resolveTableConflict: async (id: string, keep: 'mine' | 'theirs') => session?.resolveTableConflict(id, keep),
      linkEvidence: async (key: string, fileId: string) => {
        if (!session) throw new Error('Form No. 26 is not open.');
        await session.linkEvidence(key, fileId);
      },
      unlinkEvidence: async (linkId: string) => {
        if (!session) throw new Error('Form No. 26 is not open.');
        await session.unlinkEvidence(linkId);
      },
      applyImport: (plan: Form26ImportablePlan, fileName: string, opts?: { onProgress?(done: number, total: number): void }) =>
        session?.applyImport(plan, fileName, opts) ?? Promise.resolve<Form26ImportOutcome>({ ok: false, written: 0, message: 'Form No. 26 is not open.' }),
      flush: () => session?.flush() ?? Promise.resolve(true),
      reload: async () => session?.reload(),
      hasPending: () => session?.hasPending() ?? false,
      hasUnresolved: () => session?.hasUnresolved() ?? false,
      unfilledNow: () => (session ? scan(session.getState()) : []),
    };
  }, [session]);

  return {
    status: engagementId ? state.status : 'no-engagement',
    errorMessage: state.errorMessage,
    def: FORM26_DEFINITION,
    audit: state.audit,
    setup: state.setup,
    values: state.values,
    rowsByKey: state.rowsByKey,
    evidence: state.evidence,
    unfilled,
    counts,
    summary,
    saveState: state.saveState,
    unconfirmed: state.unconfirmed,
    fieldConflicts: state.fieldConflicts,
    tableConflicts: state.tableConflicts,
    ...actions,
  };
}
