// The save queue of Form No. 26: answers are saved when a field is left, tables a short while after the
// last keystroke, and everything before the user moves away (flush).
//
// Rules it keeps:
//  - one save of a row at a time; what is changed meanwhile in that row goes in ONE further save after it,
//    so an earlier save can never land on top of a later one; different rows never wait for each other;
//  - a change that could not be saved is kept and sent again by retry(), by flush() or with the next change
//    of the same row; it is never dropped and never sent in an endless loop;
//  - a change that met someone else's change of the same answer is held apart and is sent again only when
//    the user says "Keep mine" (resolveConflict); flush() does not push it through — also when the same save
//    then failed for another reason (the saver names both; only the other answers are retried);
//  - each answer is sent with the value the user saw when they began editing it (`seen`), so the saver can
//    tell someone else's change from the user's own; after a save the stored value is what the next edit
//    of that answer is judged against.
// It knows nothing of the database: the two savers are handed in (createForm26RowWriter gives them).
import { form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import type { Form26Row } from '@/lib/taxAuditForm26Values';

export type Form26SaveState =
  | { kind: 'idle' } | { kind: 'saving'; since: number } | { kind: 'saved'; at: number }
  | { kind: 'failed'; message: string; pending: number }
  | { kind: 'changed-elsewhere'; clauseKey: string; fields: string[] };
/**
 * What a saver answers. 'conflict' alone means every field of that save; `{ conflict: [...] }` names the
 * fields that met someone else's change (the others were saved); `{ failed: '...' }` carries the reason;
 * `{ conflict: [...], failed: '...' }`: the fields named met someone else's change and were not written,
 * and the rest of the save could not be saved.
 */
export type Form26SaveOutcome = 'ok' | 'conflict' | 'failed' | { conflict: string[] } | { failed: string } | { conflict: string[]; failed: string };
export type Form26SaveQueueDeps = {
  /** `seen`: for the fields that have one, the value the user saw when they began editing it. */
  saveClause(clauseKey: string, changes: Record<string, string>, seen?: Record<string, string>): Promise<Form26SaveOutcome>;
  saveTable(tableId: string, rows: Form26Row[]): Promise<Form26SaveOutcome>;
  now(): number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  onState(s: Form26SaveState): void;
  /** True when the row already holds this value: such a change is not sent. */
  isStored?(clauseKey: string, fieldKey: string, value: string): boolean;
};
export type Form26SaveQueue = {
  /**
   * On leaving a field / on choosing an option: saved at once. `seen` is the value the field showed when the
   * user began editing it (on focus; for an option, the one chosen before the click). Without it the row the
   * screen holds is taken as what the user saw.
   */
  fieldCommitted(clauseKey: string, fieldKey: string, value: string, seen?: string): void;
  tableChanged(tableId: string, rows: Form26Row[]): void;                     // debounced 800 ms per table
  tableLeft(tableId: string): void;                                           // focus left the table: save now
  flush(): Promise<boolean>;                                                  // true when nothing is pending or failed
  retry(): Promise<boolean>;
  hasPending(): boolean;
  dispose(): void;
  /** What waits for the user's decision: for a table, `clauseKey` is the table's own row key and `fields` its id. */
  conflicts(): { clauseKey: string; fields: string[] }[];
  /** "Keep mine" sends the held value(s) again, now on top of what the other user wrote; "Use theirs" drops them. `fields` null = all of that row. */
  resolveConflict(rowKey: string, fields: string[] | null, keep: 'mine' | 'theirs'): Promise<boolean>;
};

export const FORM26_TABLE_DEBOUNCE_MS = 800;
export const FORM26_BUSY_AFTER_MS = 300;
export const FORM26_SAVE_FAILED_MESSAGE = 'Your changes could not be saved.';

type Timer = ReturnType<typeof setTimeout>;
type Fields = Record<string, string>;
// `seen`: per field not yet stored, the value the stored row held from the user's point of view (what the
// user saw when they began editing it). Kept while the change waits, is on its way or has failed.
type ClauseSlot = { key: string; pending: Fields; inFlight: Fields | null; failed: Fields; conflict: Fields; seen: Fields; scheduled: boolean };
type TableSlot = { id: string; pending: Form26Row[] | null; inFlight: Form26Row[] | null; failed: Form26Row[] | null; conflict: Form26Row[] | null; timer: Timer | null };
// A failure may name fields that met someone else's change as well (`conflict`): those are held, not retried.
type Settled = { kind: 'ok' } | { kind: 'conflict'; fields: string[] | null } | { kind: 'failed'; message: string; conflict: string[] };

const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const isEmpty = (o: object): boolean => Object.keys(o).length === 0;

function read(outcome: Form26SaveOutcome): Settled {
  if (outcome === 'ok') return { kind: 'ok' };
  if (outcome === 'conflict') return { kind: 'conflict', fields: null };
  if (outcome === 'failed') return { kind: 'failed', message: FORM26_SAVE_FAILED_MESSAGE, conflict: [] };
  if (typeof outcome === 'object' && outcome !== null) {
    const named = 'conflict' in outcome && Array.isArray(outcome.conflict) ? outcome.conflict.filter((key): key is string => typeof key === 'string') : null;
    if ('failed' in outcome) {
      const message = typeof outcome.failed === 'string' && outcome.failed !== '' ? outcome.failed : FORM26_SAVE_FAILED_MESSAGE;
      return { kind: 'failed', message, conflict: named ?? [] };
    }
    if (named) return named.length > 0 ? { kind: 'conflict', fields: named } : { kind: 'ok' };
  }
  return { kind: 'failed', message: FORM26_SAVE_FAILED_MESSAGE, conflict: [] };   // an answer that is not understood is not a success
}

const thrown = (error: unknown): Settled => ({ kind: 'failed', message: error instanceof Error && error.message ? error.message : FORM26_SAVE_FAILED_MESSAGE, conflict: [] });

export function createForm26SaveQueue(deps: Form26SaveQueueDeps): Form26SaveQueue {
  const clauses = new Map<string, ClauseSlot>();
  const tables = new Map<string, TableSlot>();
  let active = 0;                      // saves on their way
  let activeSince = 0;
  let busyShown = false;
  let busyTimer: Timer | null = null;
  let lastSavedAt: number | null = null;
  let failMessage = FORM26_SAVE_FAILED_MESSAGE;
  let lastState = JSON.stringify({ kind: 'idle' });      // where the screen starts: not reported until it changes
  let disposed = false;
  let idleWaiters: (() => void)[] = [];

  const clauseSlot = (key: string): ClauseSlot => {
    let slot = clauses.get(key);
    if (!slot) {
      slot = { key, pending: {}, inFlight: null, failed: {}, conflict: {}, seen: {}, scheduled: false };
      clauses.set(key, slot);
    }
    return slot;
  };
  const tableSlot = (id: string): TableSlot => {
    let slot = tables.get(id);
    if (!slot) {
      slot = { id, pending: null, inFlight: null, failed: null, conflict: null, timer: null };
      tables.set(id, slot);
    }
    return slot;
  };

  function conflicts(): { clauseKey: string; fields: string[] }[] {
    const list: { clauseKey: string; fields: string[] }[] = [];
    for (const slot of clauses.values()) if (!isEmpty(slot.conflict)) list.push({ clauseKey: slot.key, fields: Object.keys(slot.conflict) });
    for (const slot of tables.values()) if (slot.conflict) list.push({ clauseKey: form26TableRowKey(slot.id), fields: [slot.id] });
    return list;
  }

  function failedCount(): number {
    let count = 0;
    for (const slot of clauses.values()) count += Object.keys(slot.failed).length;
    for (const slot of tables.values()) if (slot.failed) count += 1;
    return count;
  }

  function hasPending(): boolean {
    for (const slot of clauses.values()) {
      if (slot.inFlight || !isEmpty(slot.pending) || !isEmpty(slot.failed) || !isEmpty(slot.conflict)) return true;
    }
    for (const slot of tables.values()) {
      if (slot.inFlight || slot.pending || slot.failed || slot.conflict || slot.timer !== null) return true;
    }
    return false;
  }

  function report(): void {
    if (disposed) return;
    let state: Form26SaveState | null;
    const failed = failedCount();
    const waiting = conflicts();
    if (failed > 0) state = { kind: 'failed', message: failMessage, pending: failed };
    else if (waiting.length > 0) state = { kind: 'changed-elsewhere', clauseKey: waiting[0].clauseKey, fields: waiting[0].fields };
    else if (active > 0) state = busyShown ? { kind: 'saving', since: activeSince } : null;      // a quick save shows nothing
    else if (hasPending()) state = null;                                                         // waiting for a table's pause
    else state = lastSavedAt !== null ? { kind: 'saved', at: lastSavedAt } : { kind: 'idle' };
    if (!state) return;
    const text = JSON.stringify(state);
    if (text === lastState) return;
    lastState = text;
    deps.onState(state);
  }

  function begin(): void {
    if (active === 0) {
      activeSince = deps.now();
      busyShown = false;
      busyTimer = deps.setTimeout(() => {
        busyTimer = null;
        if (disposed || active === 0) return;
        busyShown = true;
        report();
      }, FORM26_BUSY_AFTER_MS);
    }
    active += 1;
  }

  // After a save has come back and any follow-up save of that row has been started.
  function finish(): void {
    if (active === 0) {
      if (busyTimer !== null) deps.clearTimeout(busyTimer);
      busyTimer = null;
      busyShown = false;
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const wake of waiters) wake();
    }
    report();
  }

  function call(start: () => Promise<Form26SaveOutcome>, done: (settled: Settled) => void): void {
    begin();
    let request: Promise<Form26SaveOutcome>;
    try {
      request = Promise.resolve(start());
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(read, thrown).then((settled) => {
      active -= 1;
      if (disposed) return;
      if (settled.kind === 'ok') lastSavedAt = deps.now();
      if (settled.kind === 'failed') failMessage = settled.message;
      done(settled);
      finish();
    });
  }

  function pumpClause(slot: ClauseSlot): void {
    if (disposed || slot.inFlight || isEmpty(slot.pending)) return;
    // What could not be saved earlier goes with it; a newer value of the same field wins.
    const batch: Fields = { ...slot.failed, ...slot.pending };
    const seen: Fields = {};
    for (const key of Object.keys(batch)) if (has(slot.seen, key)) seen[key] = slot.seen[key];
    slot.failed = {};
    slot.pending = {};
    slot.inFlight = batch;
    call(() => deps.saveClause(slot.key, { ...batch }, seen), (settled) => {
      slot.inFlight = null;
      const clashing = settled.kind === 'conflict' ? settled.fields ?? Object.keys(batch) : settled.kind === 'failed' ? settled.conflict : [];
      for (const key of clashing) {
        if (!has(batch, key) && !has(slot.pending, key)) continue;
        // Held apart with the user's newest value; it is not sent again until the user decides. Deciding
        // "Keep mine" is a choice made on what is stored now, so the value seen no longer counts.
        slot.conflict[key] = has(slot.pending, key) ? slot.pending[key] : batch[key];
        delete slot.pending[key];
        delete slot.seen[key];
      }
      for (const key of Object.keys(batch)) {
        if (has(slot.conflict, key)) continue;
        if (settled.kind === 'failed') {
          // Not stored: kept for retry, still judged against what the user first saw.
          if (!has(slot.pending, key)) slot.failed[key] = batch[key];
        } else if (has(slot.pending, key)) {
          slot.seen[key] = batch[key];                   // stored now: a newer edit is judged against it
        } else {
          delete slot.seen[key];
        }
      }
      pumpClause(slot);
    });
  }

  function pumpTable(slot: TableSlot): void {
    if (disposed || slot.inFlight || !slot.pending || slot.timer !== null) return;
    const rows = slot.pending;
    slot.pending = null;
    slot.failed = null;
    slot.inFlight = rows;
    call(() => deps.saveTable(slot.id, rows), (settled) => {
      slot.inFlight = null;
      if (settled.kind === 'conflict' || (settled.kind === 'failed' && settled.conflict.includes(slot.id))) {
        if (slot.timer !== null) deps.clearTimeout(slot.timer);
        slot.timer = null;
        slot.conflict = slot.pending ?? rows;
        slot.pending = null;
      } else if (settled.kind === 'failed' && !slot.pending) {
        slot.failed = rows;
      }
      pumpTable(slot);
    });
  }

  function fieldCommitted(clauseKey: string, fieldKey: string, value: string, seen?: string): void {
    if (disposed) return;
    const slot = clauseSlot(clauseKey);
    if (has(slot.conflict, fieldKey)) {
      slot.conflict[fieldKey] = value;                       // still the user's to decide; "mine" is now this value
      return;
    }
    const onItsWay = slot.inFlight !== null && has(slot.inFlight, fieldKey);
    if (!onItsWay && deps.isStored?.(clauseKey, fieldKey, value)) {
      delete slot.pending[fieldKey];                         // back to what is stored: nothing to send
      delete slot.failed[fieldKey];
      delete slot.seen[fieldKey];
      report();
      return;
    }
    // The first edit of a field not yet stored says what the user saw; a later one (showing the user's own
    // unsaved value) does not replace it.
    if (typeof seen === 'string' && !has(slot.seen, fieldKey)) slot.seen[fieldKey] = seen;
    delete slot.failed[fieldKey];
    slot.pending[fieldKey] = value;
    if (slot.scheduled) return;
    slot.scheduled = true;
    // At once, but after the event that is running: answers committed together go in one save.
    void Promise.resolve().then(() => {
      slot.scheduled = false;
      pumpClause(slot);
    });
  }

  function tableChanged(tableId: string, rows: Form26Row[]): void {
    if (disposed) return;
    const slot = tableSlot(tableId);
    if (slot.conflict) {
      slot.conflict = rows;
      return;
    }
    slot.pending = rows;
    slot.failed = null;
    if (slot.timer !== null) deps.clearTimeout(slot.timer);
    slot.timer = deps.setTimeout(() => {
      slot.timer = null;
      pumpTable(slot);
    }, FORM26_TABLE_DEBOUNCE_MS);
  }

  function tableLeft(tableId: string): void {
    if (disposed) return;
    const slot = tables.get(tableId);
    if (!slot) return;
    if (slot.timer !== null) deps.clearTimeout(slot.timer);
    slot.timer = null;
    pumpTable(slot);
  }

  function startEverything(withFailed: boolean): void {
    for (const slot of clauses.values()) {
      if (withFailed && !isEmpty(slot.failed)) {
        slot.pending = { ...slot.failed, ...slot.pending };
        slot.failed = {};
      }
      pumpClause(slot);
    }
    for (const slot of tables.values()) {
      if (slot.timer !== null) deps.clearTimeout(slot.timer);
      slot.timer = null;
      if (withFailed && slot.failed && !slot.pending) slot.pending = slot.failed;
      if (withFailed) slot.failed = slot.pending ? null : slot.failed;
      pumpTable(slot);
    }
  }

  async function flush(): Promise<boolean> {
    // What failed before is tried once more, once; then whatever is changed while waiting is sent too.
    let withFailed = true;
    for (;;) {
      if (disposed) return false;
      startEverything(withFailed);
      withFailed = false;
      if (active === 0) break;
      await new Promise<void>((resolve) => { idleWaiters.push(resolve); });
    }
    report();
    return failedCount() === 0 && conflicts().length === 0;
  }

  function resolveConflict(rowKey: string, fields: string[] | null, keep: 'mine' | 'theirs'): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    const clause = clauses.get(rowKey);
    if (clause) {
      for (const key of fields ?? Object.keys(clause.conflict)) {
        if (!has(clause.conflict, key)) continue;
        if (keep === 'mine') clause.pending[key] = clause.conflict[key];
        delete clause.conflict[key];
        delete clause.seen[key];
      }
    }
    for (const table of tables.values()) {
      if (form26TableRowKey(table.id) !== rowKey || !table.conflict) continue;
      if (keep === 'mine') table.pending = table.conflict;
      table.conflict = null;
    }
    return flush();
  }

  function dispose(): void {
    disposed = true;
    for (const slot of tables.values()) {
      if (slot.timer !== null) deps.clearTimeout(slot.timer);
      slot.timer = null;
    }
    if (busyTimer !== null) deps.clearTimeout(busyTimer);
    busyTimer = null;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const wake of waiters) wake();
  }

  return { fieldCommitted, tableChanged, tableLeft, flush, retry: flush, hasPending, dispose, conflicts, resolveConflict };
}
