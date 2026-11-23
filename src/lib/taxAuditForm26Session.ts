// One open Form No. 26 audit on screen: what the hook useTaxAuditForm26 holds. It loads the audit through
// the store, keeps the rows, the answers on screen and the evidence, and sends every change: answers and
// tables through the save queue, the review state, remarks and qualification box straight to the row,
// the category and "Show all schedules" to the setup. No React here, so every rule is tested against the
// stand-in database (taxAuditForm26Session.test.ts).
//
// Rules it adds to the store, the row writer and the queue:
//  - per row, one request at a time (N3): the queue's answer saves, a change of state and the remarks of one
//    row wait for each other (createForm26RowTurns), so none of them meets the other as "changed elsewhere";
//  - what the user saw is the measure (F3): a text box is judged against the value it showed when it took
//    focus, a yes/no, choice or group of options against the value shown before the choice;
//  - an answer not yet stored stays on screen as the user gave it (an overlay over the stored rows) until the
//    row holds it, or the user takes the other user's value ("Use theirs");
//  - marking a clause first saves what is waiting; an approval is refused when the clause's answers or any
//    of its tables changed since they were shown (N2);
//  - editing a value filled from the client master takes its mark away (prefill_status 'manual_override');
//  - a session belongs to one engagement; once disposed it reports nothing and sends nothing;
//  - loading a save file (task 23) first saves what waits, then writes the rows the file changes one by one in
//    their row turns, never into an approved clause, and shows each written row at once;
//  - an engagement that holds a Form 3CD draft and no Form No. 26 audit yet is converted at once, with no
//    question (task 26, R5); confirming an answer brought from that draft removes its mark and nothing else.
import { FORM26_CLAUSE_UNITS, form26ClauseKeyOfField, form26ClauseKeyOfTable, form26TableRowKey, type Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import type { Form26Category } from '@/data/taxAuditForm26Types';
import { form26ImportDoneSentence, form26ImportStoppedSentence, importWriteFor, importWrites, type Form26ImportablePlan } from '@/lib/taxAuditForm26Import';
import { isRowLocked, statusPatch } from '@/lib/taxAuditForm26Review';
import { createForm26SaveQueue, type Form26SaveQueue, type Form26SaveState } from '@/lib/taxAuditForm26SaveQueue';
import {
  clausePayloadPatch,
  FORM26_CATEGORY_FIELD,
  FORM26_PREFILL_KEYS,
  isForm26RowKey,
  parseClausePayload,
  readSetup,
  tablePayload,
  valuesFromRows,
  type Form26Setup,
} from '@/lib/taxAuditForm26Storage';
import { createForm26RowWriter, type Form26ClauseRow, type Form26Store } from '@/lib/taxAuditForm26Store';
import { getField, type Form26Row, type Form26Values } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseEvidence, TaxAuditReviewStatus, TaxAuditSetup } from '@/types/taxAudit';

export type Form26SessionStatus = 'loading' | 'ready' | 'needs-conversion' | 'no-access' | 'error' | 'no-engagement';
/** Someone else's value of an answer (or table) that met the user's change: the stored value and when the row changed. */
export type Form26Conflict = { theirs: string; at: string };
export type Form26Notice = { tone: 'error' | 'warning' | 'success'; text: string };
export type Form26SessionState = {
  status: Form26SessionStatus;
  errorMessage: string | null;
  /** The Form 3CD audit that waits for its conversion (status 'needs-conversion'). */
  threeCdAuditId: string | null;
  audit: TaxAuditSetup | null;
  setup: Form26Setup;
  values: Form26Values;
  rowsByKey: Map<string, Form26ClauseRow>;
  evidence: TaxAuditClauseEvidence[];
  saveState: Form26SaveState;
  /** Answers brought from the 3CD draft and not yet confirmed. */
  unconfirmed: ReadonlySet<string>;
  /** By answer key (the category as 'cat'): answers that met someone else's change. */
  fieldConflicts: Record<string, Form26Conflict>;
  /** By table id: tables that met someone else's change (or their clause's approval). */
  tableConflicts: Record<string, Form26Conflict>;
};
/** How a load of a save file ended. `written`: rows written; `skippedLocked`: approved clauses left as they were. */
export type Form26ImportOutcome =
  | { ok: true; written: number; skippedLocked: string[]; sentence: string }
  | { ok: false; written: number; message: string };
export type Form26SessionDeps = {
  store: Form26Store;
  engagement: { id: string; client_id?: string | null; financial_year?: string | null };
  userId: string | null;
  /** The time written into the review stamps (as the Form 3CD hook: an ISO time). */
  nowIso?(): string;
  now?(): number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  /** A plain sentence for the user: a refused approval, a save that could not be made. */
  onNotice?(notice: Form26Notice): void;
};
export type Form26Session = {
  getState(): Form26SessionState;
  subscribe(listener: (state: Form26SessionState) => void): () => void;
  load(): Promise<void>;
  reload(): Promise<void>;
  setField(fieldKey: string, value: string): void;
  /** The box of this answer took focus: what it shows now is what the user's edit is judged against. */
  fieldFocused(fieldKey: string): void;
  fieldBlurred(fieldKey: string): void;
  setTable(tableId: string, rows: Form26Row[]): void;
  tableLeft(tableId: string): void;
  setCategory(category: '' | Form26Category): Promise<void>;
  setShowAllSchedules(on: boolean): Promise<void>;
  /** True when the new state is stored. */
  setStatus(clauseKey: string, status: TaxAuditReviewStatus, options?: { unlockReason?: string }): Promise<boolean>;
  /** Review remarks and the qualification box. True when stored. */
  updateRow(clauseKey: string, patch: Pick<Partial<Form26ClauseRow>, 'auditor_remarks_html' | 'qualification_required' | 'qualification_text_html'>): Promise<boolean>;
  confirmBrought(fieldKey: string): Promise<void>;
  resolveConflict(fieldKey: string, keep: 'mine' | 'theirs'): Promise<void>;
  resolveTableConflict(tableId: string, keep: 'mine' | 'theirs'): Promise<void>;
  linkEvidence(clauseKey: string, evidenceFileId: string): Promise<void>;
  unlinkEvidence(linkId: string): Promise<void>;
  /**
   * Loads a save file whose plan the user has seen and confirmed: saves what waits first (refused while a change
   * cannot be saved), writes every row the file changes, then the category and `importedFrom`. Never throws.
   */
  applyImport(plan: Form26ImportablePlan, fileName: string, opts?: { onProgress?(done: number, total: number): void }): Promise<Form26ImportOutcome>;
  /** Everything waiting is sent; true when nothing is left unsaved. */
  flush(): Promise<boolean>;
  /** Something is waiting or on its way. */
  hasPending(): boolean;
  /** A change that a flush cannot save by itself: a failed save, or a clash waiting for the user's choice. */
  hasUnresolved(): boolean;
  dispose(): void;
};

/** Work on one storage row runs one after the other; different rows do not wait for each other. */
export function createForm26RowTurns(): {
  run<T>(rowKey: string, work: () => Promise<T>): Promise<T>;
  busy(): boolean;
  idle(): Promise<void>;
} {
  const tails = new Map<string, Promise<void>>();
  let running = 0;
  let waiters: (() => void)[] = [];

  function run<T>(rowKey: string, work: () => Promise<T>): Promise<T> {
    const before = tails.get(rowKey) ?? Promise.resolve();
    running += 1;
    const result = before.then(() => work());
    const settled = result.then(() => undefined, () => undefined);
    tails.set(rowKey, settled);
    void settled.then(() => {
      if (tails.get(rowKey) === settled) tails.delete(rowKey);
      running -= 1;
      if (running === 0) {
        const wake = waiters;
        waiters = [];
        for (const resolve of wake) resolve();
      }
    });
    return result;
  }

  return {
    run,
    busy: () => running > 0,
    idle: () => (running === 0 ? Promise.resolve() : new Promise<void>((resolve) => { waiters.push(resolve); })),
  };
}

const AUDIT_TURN = 'audit';
const PREFILL_KEYS = new Set<string>(Object.values(FORM26_PREFILL_KEYS));
const CHOSEN_KINDS = new Set(['yesno', 'choice', 'radio']);
const BLANK_SETUP: Form26Setup = { v: 1, category: '', showAllSchedules: false };

const NOT_SAVED_YET = 'This clause has changes that are not saved yet. Save them, or choose which entry to keep, then mark it again.';
const CHANGED_BEFORE_APPROVAL = 'Someone else changed this clause just now, so it was not approved. Check its answers and approve it again.';
const CHANGED_BEFORE_MARK = 'Someone else changed this clause just now. Check its answers and mark it again.';
const MARK_FAILED = 'The review state could not be saved. Try again.';
const APPROVED_NO_REMARKS = 'This clause is approved. Choose Edit to change it.';
const REMARKS_CHANGED = 'Someone else changed this just now. Their text is shown; add yours again if it is still needed.';
const REMARKS_FAILED = 'Could not save. Try again.';
const CATEGORY_FAILED = 'The category of assessee could not be saved. Try again.';
const SWITCH_FAILED = '"Show all schedules" could not be saved. Try again.';
const CONFIRM_FAILED = 'The answer could not be confirmed. Try again.';
const CONFIRM_CHANGED = 'Someone else changed this answer just now. Their answer is shown.';
const EVIDENCE_LINK_FAILED = 'The evidence could not be linked. Try again.';
const EVIDENCE_UNLINK_FAILED = 'The evidence link could not be removed. Try again.';
const IMPORT_NOT_SAVED = 'Some changes on screen are not saved yet. Save them, or choose which entry to keep, then load the file again.';
const IMPORT_NOT_OPEN = 'This Form No. 26 audit is not open. Open the engagement again.';
const IMPORT_SETUP_FAILED = 'The answers were loaded, but the category of assessee could not be saved. Load the file again.';

const UNIT_BY_KEY = new Map<string, Form26ClauseUnit>(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit]));
const TABLE_ID_BY_ROW_KEY = new Map<string, string>(FORM26_DEFINITION.tables.map((table) => [form26TableRowKey(table.id), table.id]));
const TABLE_IDS = new Set(FORM26_DEFINITION.tables.map((table) => table.id));
const FIELD_BY_KEY = new Map(FORM26_DEFINITION.fields.map((field) => [field.key, field]));

// A stored value as text, for comparing a column before and after.
function held(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function brought(rows: Map<string, Form26ClauseRow>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const unit of FORM26_CLAUSE_UNITS) {
    const marks = parseClausePayload(rows.get(unit.key)?.response_json).brought;
    if (marks) for (const key of Object.keys(marks)) if (unit.fields.includes(key)) keys.add(key);
  }
  return keys;
}

export function createForm26Session(deps: Form26SessionDeps): Form26Session {
  const def = FORM26_DEFINITION;
  const { store, engagement, userId } = deps;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const notify = (tone: Form26Notice['tone'], text: string) => {
    if (!disposed) deps.onNotice?.({ tone, text });
  };

  let disposed = false;
  let loadRun = 0;
  const listeners = new Set<(state: Form26SessionState) => void>();
  const turns = createForm26RowTurns();

  // What is on screen beyond the stored rows: answers and tables the user changed that the row does not hold yet.
  const localFields = new Map<string, string>();
  const localTables = new Map<string, Form26Row[]>();
  // The value each text box showed when it took focus.
  const focusSeen = new Map<string, string>();
  // Answers of each clause whose save is on its way (the queue then sends a later equal value too).
  const inFlight = new Map<string, Set<string>>();
  // The category the user chose when it met someone else's choice.
  let categoryMine: { value: '' | Form26Category } | null = null;

  let state: Form26SessionState = {
    status: 'loading',
    errorMessage: null,
    threeCdAuditId: null,
    audit: null,
    setup: { ...BLANK_SETUP },
    values: { f: {}, t: {} },
    rowsByKey: new Map(),
    evidence: [],
    saveState: { kind: 'idle' },
    unconfirmed: new Set(),
    fieldConflicts: {},
    tableConflicts: {},
  };

  const getRow = (key: string) => state.rowsByKey.get(key);

  function conflictsNow(): Pick<Form26SessionState, 'fieldConflicts' | 'tableConflicts'> {
    const fieldConflicts: Record<string, Form26Conflict> = {};
    const tableConflicts: Record<string, Form26Conflict> = {};
    for (const waiting of queue.conflicts()) {
      const row = getRow(waiting.clauseKey);
      const at = row?.updated_at ?? '';
      const tableId = TABLE_ID_BY_ROW_KEY.get(waiting.clauseKey);
      if (tableId) {
        tableConflicts[tableId] = { theirs: '', at };
        continue;
      }
      const stored = parseClausePayload(row?.response_json).f;
      for (const key of waiting.fields) fieldConflicts[key] = { theirs: stored[key] ?? '', at };
    }
    if (categoryMine) fieldConflicts[FORM26_CATEGORY_FIELD] = { theirs: state.setup.category, at: state.audit?.updated_at ?? '' };
    return { fieldConflicts, tableConflicts };
  }

  function emit(patch: Partial<Form26SessionState> = {}): void {
    if (disposed) return;
    state = { ...state, ...patch };
    state = { ...state, ...conflictsNow() };
    for (const listener of listeners) listener(state);
  }

  // The category as an answer on screen ('cat' is absent when none is chosen, as in the office's save file).
  function withCategory(values: Form26Values, category: '' | Form26Category): Form26Values {
    const f = { ...values.f };
    if (category === '1' || category === '2') f[FORM26_CATEGORY_FIELD] = category;
    else delete f[FORM26_CATEGORY_FIELD];
    return { f, t: values.t };
  }

  // A fresher row (read or written): into the map, and its answers onto the screen where the user has no
  // change of his own waiting.
  function acceptRow(row: Form26ClauseRow): void {
    if (disposed || !isForm26RowKey(row.clause_key)) return;
    if (state.audit?.id && row.tax_audit_id !== state.audit.id) return;
    const rowsByKey = new Map(state.rowsByKey);
    rowsByKey.set(row.clause_key, row);
    const fromRow = valuesFromRows(def, state.setup, [row]);
    let values = state.values;
    const tableId = TABLE_ID_BY_ROW_KEY.get(row.clause_key);
    if (tableId) {
      const stored = fromRow.t[tableId] ?? [];
      const local = localTables.get(tableId);
      if (local && tablePayload(def, tableId, local) === tablePayload(def, tableId, stored)) localTables.delete(tableId);
      values = { f: values.f, t: { ...values.t, [tableId]: localTables.get(tableId) ?? stored } };
    } else {
      const unit = UNIT_BY_KEY.get(row.clause_key);
      if (unit && unit.key !== 'f26_category') {
        const f = { ...values.f };
        for (const key of unit.fields) {
          const storedHas = Object.prototype.hasOwnProperty.call(fromRow.f, key);
          const stored = storedHas ? fromRow.f[key] : '';
          if (localFields.has(key) && localFields.get(key) === stored) localFields.delete(key);
          if (localFields.has(key)) f[key] = localFields.get(key) as string;
          else if (storedHas) f[key] = stored;
          else delete f[key];
        }
        values = { f, t: values.t };
      }
    }
    emit({ rowsByKey, values, unconfirmed: brought(rowsByKey) });
  }

  const writer = createForm26RowWriter({ store, getRow, onRow: acceptRow });

  // After an answer of a particular filled from the client master is stored as the user's own, its mark goes.
  async function markPrefillEdited(clauseKey: string, changes: Record<string, string>): Promise<void> {
    let row = getRow(clauseKey);
    if (!row || row.prefill_status !== 'auto_filled') return;
    const storedNow = parseClausePayload(row.response_json).f;
    if (!Object.keys(changes).some((key) => PREFILL_KEYS.has(key) && storedNow[key] === changes[key])) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await store.saveRow({ id: row.id, updated_at: row.updated_at }, { prefill_status: 'manual_override' });
      if ('row' in result) {
        acceptRow(result.row);
        return;
      }
      if (!('latest' in result)) return;                        // the mark stays; the next edit tries again
      acceptRow(result.latest);
      row = result.latest;
      if (row.prefill_status !== 'auto_filled') return;
    }
  }

  const queue: Form26SaveQueue = createForm26SaveQueue({
    saveClause: (clauseKey, changes, seen) => turns.run(clauseKey, async () => {
      const going = inFlight.get(clauseKey) ?? new Set<string>();
      inFlight.set(clauseKey, going);
      for (const key of Object.keys(changes)) going.add(key);
      try {
        const outcome = await writer.saveClause(clauseKey, changes, seen);
        await markPrefillEdited(clauseKey, changes);
        return outcome;
      } finally {
        for (const key of Object.keys(changes)) going.delete(key);
      }
    }),
    saveTable: (tableId, rows) => turns.run(form26TableRowKey(tableId), () => writer.saveTable(tableId, rows)),
    isStored: writer.isStored,
    now: deps.now ?? (() => Date.now()),
    // Called as the queue's own methods: bound here, so the browser's timers never run with another `this`.
    setTimeout: deps.setTimeout ?? (((handler: () => void, ms?: number) => globalThis.setTimeout(handler, ms)) as unknown as typeof setTimeout),
    clearTimeout: deps.clearTimeout ?? (((timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer)) as unknown as typeof clearTimeout),
    onState: (saveState) => emit({ saveState }),
  });

  async function load(): Promise<void> {
    if (disposed) return;
    const run = ++loadRun;
    emit({ status: 'loading', errorMessage: null });
    const input = { engagementId: engagement.id, clientId: engagement.client_id ?? null, financialYear: engagement.financial_year ?? '', userId: userId ?? '' };
    let loaded = await store.load(input);
    if (disposed || run !== loadRun) return;
    // A Form 3CD draft on a Form No. 26 year: brought across at once (an untouched one simply gives a new audit).
    if (loaded.state === 'needs-conversion') {
      loaded = await store.convert({ ...input, threeCdAuditId: loaded.threeCdAuditId });
      if (disposed || run !== loadRun) return;
    }
    if (loaded.state === 'ready') {
      const rowsByKey = new Map(loaded.rows.map((row) => [row.clause_key, row]));
      // The user's own changes still waiting (after a reload) stay on screen.
      const f = { ...loaded.values.f };
      for (const [key, value] of localFields) f[key] = value;
      const t = { ...loaded.values.t };
      for (const [id, rows] of localTables) t[id] = rows;
      emit({
        status: 'ready', errorMessage: null, threeCdAuditId: null, audit: loaded.audit, setup: loaded.setup,
        values: { f, t }, rowsByKey, evidence: loaded.evidence, unconfirmed: brought(rowsByKey),
      });
    } else if (loaded.state === 'needs-conversion') {
      emit({ status: 'needs-conversion', threeCdAuditId: loaded.threeCdAuditId });
    } else if (loaded.state === 'no-access') {
      emit({ status: 'no-access' });
    } else {
      emit({ status: 'error', errorMessage: loaded.message });
    }
  }

  async function flush(): Promise<boolean> {
    const saved = await queue.flush();
    await turns.idle();
    return saved && !hasUnresolved();
  }

  async function reload(): Promise<void> {
    await flush();
    if (!hasUnresolved()) {
      localFields.clear();
      localTables.clear();
    }
    await load();
  }

  function setField(fieldKey: string, value: string): void {
    if (disposed) return;
    if (fieldKey === FORM26_CATEGORY_FIELD) {
      void setCategory(value === '1' || value === '2' ? value : '');
      return;
    }
    let clauseKey: string;
    try {
      clauseKey = form26ClauseKeyOfField(fieldKey);
    } catch {
      return;
    }
    const shown = getField(state.values, fieldKey);
    const kind = FIELD_BY_KEY.get(fieldKey)?.kind ?? 'text';
    const seen = CHOSEN_KINDS.has(kind) ? shown : focusSeen.get(fieldKey) ?? shown;
    localFields.set(fieldKey, value);
    queue.fieldCommitted(clauseKey, fieldKey, value, seen);
    if (!inFlight.get(clauseKey)?.has(fieldKey) && writer.isStored(clauseKey, fieldKey, value)) localFields.delete(fieldKey);
    if (focusSeen.has(fieldKey)) focusSeen.set(fieldKey, value);           // the box now shows the user's own value
    emit({ values: { f: { ...state.values.f, [fieldKey]: value }, t: state.values.t } });
  }

  function fieldFocused(fieldKey: string): void {
    if (FIELD_BY_KEY.has(fieldKey)) focusSeen.set(fieldKey, getField(state.values, fieldKey));
  }

  function fieldBlurred(fieldKey: string): void {
    focusSeen.delete(fieldKey);
  }

  function setTable(tableId: string, rows: Form26Row[]): void {
    if (disposed || !TABLE_IDS.has(tableId)) return;
    localTables.set(tableId, rows);
    queue.tableChanged(tableId, rows);
    emit({ values: { f: state.values.f, t: { ...state.values.t, [tableId]: rows } } });
  }

  function tableLeft(tableId: string): void {
    if (!disposed) queue.tableLeft(tableId);
  }

  // A setup save: the audit row as held now is passed (its setup is "what the user saw" for entries without `seen`).
  function setupTurn(work: (audit: TaxAuditSetup) => Promise<void>): Promise<void> {
    return turns.run(AUDIT_TURN, async () => {
      const audit = state.audit;
      if (!audit || disposed) return;
      await work(audit);
    });
  }

  function showSetup(audit: TaxAuditSetup, setup: Form26Setup): void {
    emit({ audit, setup, values: withCategory(state.values, setup.category) });
  }

  function setCategory(category: '' | Form26Category): Promise<void> {
    if (disposed || (category === state.setup.category && !categoryMine)) return Promise.resolve();
    const categoryRow = getRow('f26_category');
    if (categoryRow && isRowLocked(categoryRow)) {
      notify('warning', APPROVED_NO_REMARKS);
      return Promise.resolve();
    }
    categoryMine = null;
    // Shown at once; the save goes in its turn, judged against the category the user saw.
    const shownBefore = state.setup.category;
    emit({ setup: { ...state.setup, category }, values: withCategory(state.values, category) });
    return setupTurn(async (audit) => {
      const before = readSetup(audit.setup_json).category;
      const result = await store.saveSetup(audit, { category }, { category: shownBefore });
      if ('audit' in result) {
        if (!result.ok) categoryMine = { value: category };
        showSetup(result.audit, result.setup);
        return;
      }
      emit({ setup: { ...state.setup, category: before }, values: withCategory(state.values, before) });
      notify('error', CATEGORY_FAILED);
    });
  }

  function setShowAllSchedules(on: boolean): Promise<void> {
    if (disposed) return Promise.resolve();
    emit({ setup: { ...state.setup, showAllSchedules: on } });
    return setupTurn(async (audit) => {
      const before = readSetup(audit.setup_json).showAllSchedules;
      const result = await store.saveSetup(audit, { showAllSchedules: on });
      if ('audit' in result) {
        showSetup(result.audit, result.setup);
        if (!result.ok) notify('warning', `Someone else changed "Show all schedules" just now. It is ${result.setup.showAllSchedules ? 'on' : 'off'}.`);
        return;
      }
      emit({ setup: { ...state.setup, showAllSchedules: before } });
      notify('error', SWITCH_FAILED);
    });
  }

  // The clause's tables as stored now, against those on screen: false (and the screen refreshed) when one moved.
  async function tablesAsShown(unit: Form26ClauseUnit): Promise<boolean> {
    let same = true;
    for (const tableId of unit.tables) {
      const shown = getRow(form26TableRowKey(tableId));
      if (!shown) continue;
      const fresh = await store.reloadRow(shown.id);
      if (fresh && fresh.response_json !== shown.response_json) {
        acceptRow(fresh);
        same = false;
      }
    }
    return same;
  }

  async function setStatus(clauseKey: string, status: TaxAuditReviewStatus, options?: { unlockReason?: string }): Promise<boolean> {
    if (disposed) return false;
    const unlocking = Boolean(options?.unlockReason?.trim());
    const unit = UNIT_BY_KEY.get(clauseKey);
    if (!unit) return false;
    if (!unlocking && !(await flush())) {
      notify('warning', NOT_SAVED_YET);
      return false;
    }
    return turns.run(clauseKey, async () => {
      const row = getRow(clauseKey);
      if (!row || disposed) return false;
      const patch = statusPatch(status, { userId, now: nowIso(), unlockReason: unlocking ? options?.unlockReason?.trim() : undefined });
      const approving = status === 'approved' && !unlocking;
      if (approving && !(await tablesAsShown(unit))) {
        notify('warning', CHANGED_BEFORE_APPROVAL);
        return false;
      }
      // A mark is about the answers on screen: they go with the row as "seen". Unlocking is not.
      const seenRow = unlocking || typeof row.response_json !== 'string'
        ? { id: row.id, updated_at: row.updated_at }
        : { id: row.id, updated_at: row.updated_at, response_json: row.response_json };
      let result = await store.saveRow(seenRow, patch);
      if (unlocking && 'latest' in result && isRowLocked(result.latest)) {
        acceptRow(result.latest);                                   // something else of the row moved: once more
        result = await store.saveRow({ id: result.latest.id, updated_at: result.latest.updated_at }, patch);
      }
      if ('row' in result) {
        acceptRow(result.row);
        return true;
      }
      if ('latest' in result) {
        acceptRow(result.latest);
        notify('warning', approving ? CHANGED_BEFORE_APPROVAL : CHANGED_BEFORE_MARK);
        return false;
      }
      notify('error', MARK_FAILED);
      return false;
    });
  }

  function updateRow(clauseKey: string, patch: Pick<Partial<Form26ClauseRow>, 'auditor_remarks_html' | 'qualification_required' | 'qualification_text_html'>): Promise<boolean> {
    if (disposed || !UNIT_BY_KEY.has(clauseKey)) return Promise.resolve(false);
    const columns = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined);
    if (columns.length === 0) return Promise.resolve(false);
    return turns.run(clauseKey, async () => {
      let row = getRow(clauseKey);
      if (!row || disposed) return false;
      if (isRowLocked(row)) {
        notify('warning', APPROVED_NO_REMARKS);
        return false;
      }
      const shown = row;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await store.saveRow({ id: row.id, updated_at: row.updated_at }, patch);
        if ('row' in result) {
          acceptRow(result.row);
          return true;
        }
        if (!('latest' in result)) {
          notify('error', REMARKS_FAILED);
          return false;
        }
        acceptRow(result.latest);
        const latest = result.latest;
        const untouched = columns.every((key) => held((latest as Record<string, unknown>)[key]) === held((shown as Record<string, unknown>)[key]));
        if (!untouched || isRowLocked(latest)) break;
        row = latest;                                               // another column moved: once more on top of it
      }
      notify('warning', isRowLocked(getRow(clauseKey) ?? row) ? APPROVED_NO_REMARKS : REMARKS_CHANGED);
      return false;
    });
  }

  // The value stays as it is; only its mark goes. Judged against the row as shown (its answers are what the
  // user confirmed): a change elsewhere to another answer of the row is taken in and the confirmation sent once
  // more on top of it; a change to this very answer is shown instead, and nothing is confirmed.
  function confirmBrought(fieldKey: string): Promise<void> {
    let clauseKey: string;
    try {
      clauseKey = form26ClauseKeyOfField(fieldKey);
    } catch {
      return Promise.resolve();
    }
    return turns.run(clauseKey, async () => {
      let row = getRow(clauseKey);
      if (!row || disposed) return;
      const shown = parseClausePayload(row.response_json);
      if (!shown.brought?.[fieldKey]) return;
      const value = shown.f[fieldKey] ?? '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const payload = parseClausePayload(row.response_json);
        const next = clausePayloadPatch(def, clauseKey, { [fieldKey]: value }, payload);
        const result = await store.saveRow(row, { response_json: JSON.stringify(next) });
        if ('row' in result) {
          acceptRow(result.row);
          return;
        }
        if (!('latest' in result)) break;
        acceptRow(result.latest);
        const latest = parseClausePayload(result.latest.response_json);
        if (isRowLocked(result.latest)) break;
        if ((latest.f[fieldKey] ?? '') !== value) {
          notify('warning', CONFIRM_CHANGED);
          return;
        }
        if (!latest.brought?.[fieldKey]) return;                    // confirmed elsewhere already
        row = result.latest;                                         // another answer of the row moved: once more
      }
      notify('error', isRowLocked(getRow(clauseKey) ?? row) ? APPROVED_NO_REMARKS : CONFIRM_FAILED);
    });
  }

  async function resolveConflict(fieldKey: string, keep: 'mine' | 'theirs'): Promise<void> {
    if (disposed) return;
    if (fieldKey === FORM26_CATEGORY_FIELD) {
      const mine = categoryMine;
      categoryMine = null;
      if (keep === 'theirs' || !mine) {
        emit();
        return;
      }
      await setupTurn(async (audit) => {
        emit({ setup: { ...state.setup, category: mine.value }, values: withCategory(state.values, mine.value) });
        const result = await store.saveSetup(audit, { category: mine.value });
        if ('audit' in result) {
          if (!result.ok) categoryMine = mine;
          showSetup(result.audit, result.setup);
          return;
        }
        categoryMine = mine;
        notify('error', CATEGORY_FAILED);
        emit();
      });
      return;
    }
    let clauseKey: string;
    try {
      clauseKey = form26ClauseKeyOfField(fieldKey);
    } catch {
      return;
    }
    const resolving = queue.resolveConflict(clauseKey, [fieldKey], keep);
    if (keep === 'theirs') {
      localFields.delete(fieldKey);
      const row = getRow(clauseKey);
      const fromRow = row ? valuesFromRows(def, state.setup, [row]).f : {};
      const f = { ...state.values.f };
      if (Object.prototype.hasOwnProperty.call(fromRow, fieldKey)) f[fieldKey] = fromRow[fieldKey];
      else delete f[fieldKey];                                       // a group of options with none chosen
      emit({ values: { f, t: state.values.t } });
    } else {
      emit();
    }
    await resolving;
    await turns.idle();
    emit();
  }

  async function resolveTableConflict(tableId: string, keep: 'mine' | 'theirs'): Promise<void> {
    if (disposed || !TABLE_IDS.has(tableId)) return;
    const rowKey = form26TableRowKey(tableId);
    const resolving = queue.resolveConflict(rowKey, null, keep);
    if (keep === 'theirs') {
      localTables.delete(tableId);
      const row = getRow(rowKey);
      const stored = row ? valuesFromRows(def, state.setup, [row]).t[tableId] ?? [] : [];
      emit({ values: { f: state.values.f, t: { ...state.values.t, [tableId]: stored } } });
    } else {
      emit();
    }
    await resolving;
    await turns.idle();
    emit();
  }

  async function linkEvidence(clauseKey: string, evidenceFileId: string): Promise<void> {
    const audit = state.audit;
    const row = getRow(clauseKey);
    try {
      if (!audit?.id || !row || !UNIT_BY_KEY.has(clauseKey)) throw new Error('Evidence can be linked only to a clause of this Form No. 26 audit.');
      if (!userId) throw new Error('Sign in again to link evidence.');
      await store.linkEvidence({ id: audit.id }, row, evidenceFileId, userId);
      const evidence = await store.listEvidence(audit.id);
      emit({ evidence });
    } catch (error) {
      notify('error', EVIDENCE_LINK_FAILED);
      throw error;
    }
  }

  async function unlinkEvidence(linkId: string): Promise<void> {
    const audit = state.audit;
    try {
      if (!audit?.id) throw new Error('This Form No. 26 audit is not open.');
      await store.unlinkEvidence(linkId);
      const evidence = await store.listEvidence(audit.id);
      emit({ evidence });
    } catch (error) {
      notify('error', EVIDENCE_UNLINK_FAILED);
      throw error;
    }
  }

  async function applyImport(plan: Form26ImportablePlan, fileName: string, opts: { onProgress?(done: number, total: number): void } = {}): Promise<Form26ImportOutcome> {
    if (disposed || !state.audit) return { ok: false, written: 0, message: IMPORT_NOT_OPEN };
    if (!(await flush()) || hasUnresolved()) return { ok: false, written: 0, message: IMPORT_NOT_SAVED };
    const planned = importWrites(def, plan, state.rowsByKey, { category: state.setup.category });
    const skipped = new Set(planned.skippedLocked);
    const total = planned.writes.length;
    let done = 0;
    let written = 0;
    opts.onProgress?.(0, total);
    for (const { rowKey } of planned.writes) {
      // Judged again in the row's turn, on the row as held then (someone may have approved its clause meanwhile).
      const outcome = await turns.run(rowKey, async (): Promise<'written' | 'left' | 'failed'> => {
        const tableId = TABLE_ID_BY_ROW_KEY.get(rowKey);
        if (tableId) {
          // A table is locked with its clause, which may have been approved since it was read (its own row is not).
          const clause = getRow(form26ClauseKeyOfTable(tableId));
          const fresh = clause ? await store.reloadRow(clause.id) : null;
          if (fresh) acceptRow(fresh);
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (disposed) return 'failed';
          const now = importWriteFor(def, plan, rowKey, state.rowsByKey);
          if (now.locked) {
            skipped.add(now.clauseKey);
            return 'left';
          }
          const row = getRow(rowKey);
          if (!now.write) return 'left';
          if (!row) return 'failed';
          const result = await store.saveRow(row, { response_json: now.write.responseJson });
          if ('row' in result) {
            acceptRow(result.row);
            if ('f' in now.write.payload) await markPrefillEdited(rowKey, now.write.payload.f);
            return 'written';
          }
          if (!('latest' in result)) return 'failed';
          acceptRow(result.latest);                                  // changed elsewhere: judged again on it
        }
        return 'failed';
      });
      if (outcome === 'failed') return { ok: false, written, message: form26ImportStoppedSentence(done, total) };
      done += 1;
      if (outcome === 'written') written += 1;
      opts.onProgress?.(done, total);
    }

    // The category (unless its entry is approved) and where the answers came from, in the setup.
    const categoryRow = getRow('f26_category');
    const patch: Partial<Form26Setup> = { importedFrom: { fileName, at: nowIso(), by: userId ?? '' } };
    if (planned.category !== state.setup.category && !(categoryRow && isRowLocked(categoryRow))) patch.category = planned.category;
    let setupSaved = false;
    await setupTurn(async (audit) => {
      let held = audit;
      for (let attempt = 0; attempt < 2 && !setupSaved; attempt += 1) {
        const result = await store.saveSetup(held, patch);
        if (!('audit' in result)) return;
        showSetup(result.audit, result.setup);
        if (result.ok) setupSaved = true;
        else held = result.audit;                                   // the file is the user's choice: once more on top
      }
    });
    if (!setupSaved) return { ok: false, written, message: IMPORT_SETUP_FAILED };
    const order = FORM26_CLAUSE_UNITS.map((unit) => unit.key);
    const skippedLocked = [...skipped].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return { ok: true, written, skippedLocked, sentence: form26ImportDoneSentence(plan.summary, fileName) };
  }

  function hasPending(): boolean {
    return queue.hasPending() || turns.busy();
  }

  function hasUnresolved(): boolean {
    return queue.conflicts().length > 0 || state.saveState.kind === 'failed' || categoryMine !== null;
  }

  function dispose(): void {
    disposed = true;
    queue.dispose();
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    reload,
    setField,
    fieldFocused,
    fieldBlurred,
    setTable,
    tableLeft,
    setCategory,
    setShowAllSchedules,
    setStatus,
    updateRow,
    confirmBrought,
    resolveConflict,
    resolveTableConflict,
    linkEvidence,
    unlinkEvidence,
    applyImport,
    flush,
    hasPending,
    hasUnresolved,
    dispose,
  };
}
