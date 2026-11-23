import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  createForm26SaveQueue,
  FORM26_BUSY_AFTER_MS,
  FORM26_SAVE_FAILED_MESSAGE,
  FORM26_TABLE_DEBOUNCE_MS,
  type Form26SaveOutcome,
  type Form26SaveState,
} from '@/lib/taxAuditForm26SaveQueue';
import { parseClausePayload, parseTablePayload } from '@/lib/taxAuditForm26Storage';
import { createForm26RowWriter, createForm26Store, type Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { defaultValues, type Form26Row } from '@/lib/taxAuditForm26Values';
import { clientOn, FakeTaxAuditDb } from './__fixtures__/taxAuditForm26/fakeTaxAuditDb';

type Call = { kind: 'clause'; key: string; changes: Record<string, string> } | { kind: 'table'; key: string; rows: Form26Row[] };
type Deferred = { resolve(outcome: Form26SaveOutcome): void; reject(error: Error): void };

// The queue with stand-in savers: every call is recorded; by default it succeeds at once.
function harness(options: { isStored?: (clauseKey: string, fieldKey: string, value: string) => boolean } = {}) {
  const calls: Call[] = [];
  const seens: (Record<string, string> | undefined)[] = [];     // the `seen` of each clause save, in order
  const states: Form26SaveState[] = [];
  const waiting: Deferred[] = [];
  let answer: (call: Call) => Form26SaveOutcome | Promise<Form26SaveOutcome> = () => 'ok';
  const queue = createForm26SaveQueue({
    saveClause: async (key, changes, seen) => {
      const call: Call = { kind: 'clause', key, changes: { ...changes } };
      calls.push(call);
      seens.push(seen ? { ...seen } : undefined);
      return answer(call);
    },
    saveTable: async (key, rows) => {
      const call: Call = { kind: 'table', key, rows: rows.map((row) => ({ ...row })) };
      calls.push(call);
      return answer(call);
    },
    now: () => Date.now(),
    setTimeout,
    clearTimeout,
    onState: (state) => states.push(state),
    isStored: options.isStored,
  });
  return {
    queue, calls, seens, states,
    last: () => states[states.length - 1],
    answerWith(next: typeof answer) { answer = next; },
    /** Every save from now on waits until the test lets it finish (in the order asked). */
    hold() { answer = () => new Promise<Form26SaveOutcome>((resolve, reject) => { waiting.push({ resolve, reject }); }); return waiting; },
  };
}

const settle = async () => { await vi.advanceTimersByTimeAsync(0); };
const ROW = (name: string): Form26Row[] => [{ '1': name }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T10:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('answers', () => {
  it('a committed field is saved at once with only that field in the changes', async () => {
    const h = harness();
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Invented software');
    expect(h.queue.hasPending()).toBe(true);
    await settle();
    expect(h.calls).toEqual([{ kind: 'clause', key: 'f26_c14', changes: { c14b: 'Invented software' } }]);
    expect(h.queue.hasPending()).toBe(false);
    expect(h.last()).toEqual({ kind: 'saved', at: Date.now() });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('two quick edits to the same row produce one write with both', async () => {
    const h = harness();
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Invented software');
    h.queue.fieldCommitted('f26_c14', 'c14e', 'Invented address');
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Invented software, corrected');
    await settle();
    expect(h.calls).toEqual([{ kind: 'clause', key: 'f26_c14', changes: { c14b: 'Invented software, corrected', c14e: 'Invented address' } }]);
  });

  it('edits made while a save of the same row is on its way go together in ONE further write, after it', async () => {
    const h = harness();
    const waiting = h.hold();
    h.queue.fieldCommitted('f26_c14', 'c14b', 'first');
    await settle();
    h.queue.fieldCommitted('f26_c14', 'c14c', 'second');
    await settle();
    h.queue.fieldCommitted('f26_c14', 'c14e', 'third');
    h.queue.fieldCommitted('f26_c14', 'c14b', 'first, changed');
    await settle();
    expect(h.calls).toHaveLength(1);                         // never two saves of one row at the same time
    waiting[0].resolve('ok');
    await settle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ kind: 'clause', key: 'f26_c14', changes: { c14c: 'second', c14e: 'third', c14b: 'first, changed' } });
    waiting[1].resolve('ok');
    await settle();
    expect(h.queue.hasPending()).toBe(false);
    expect(h.calls).toHaveLength(2);
  });

  it('edits to two rows do not block each other', async () => {
    const h = harness();
    const waiting = h.hold();
    h.queue.fieldCommitted('f26_c14', 'c14b', 'slow row');
    await settle();
    h.queue.fieldCommitted('f26_c13', 'c13', 'other row');
    h.queue.tableChanged('S29', ROW('a table'));
    h.queue.tableLeft('S29');
    await settle();
    expect(h.calls[0].key).toBe('f26_c14');
    expect(h.calls.map((call) => call.key).sort()).toEqual(['S29', 'f26_c13', 'f26_c14']);   // all three on their way together
    waiting[1].resolve('ok');
    waiting[2].resolve('ok');
    await settle();
    expect(h.queue.hasPending()).toBe(true);                 // the slow one is still out
    waiting[0].resolve('ok');
    await settle();
    expect(h.queue.hasPending()).toBe(false);
  });

  it('nothing is sent for a value equal to the stored one', async () => {
    const storedValues: Record<string, string> = { c14d: 'Yes', c14b: '' };
    const h = harness({ isStored: (_clause, field, value) => storedValues[field] === value });
    h.queue.fieldCommitted('f26_c14', 'c14d', 'Yes');
    await settle();
    expect(h.calls).toEqual([]);
    expect(h.states).toEqual([]);
    expect(h.queue.hasPending()).toBe(false);
    // Changed and changed back before it went: nothing to send either.
    h.queue.fieldCommitted('f26_c14', 'c14d', 'No');
    h.queue.fieldCommitted('f26_c14', 'c14d', 'Yes');
    await settle();
    expect(h.calls).toEqual([]);
    expect(h.queue.hasPending()).toBe(false);
    // But changed back while the first change is on its way: the first value must be undone by a second save.
    const waiting = h.hold();
    h.queue.fieldCommitted('f26_c14', 'c14d', 'No');
    await settle();
    h.queue.fieldCommitted('f26_c14', 'c14d', 'Yes');
    waiting[0].resolve('ok');
    await settle();
    waiting[1].resolve('ok');
    await settle();
    expect(h.calls.map((call) => (call.kind === 'clause' ? call.changes : null))).toEqual([{ c14d: 'No' }, { c14d: 'Yes' }]);
  });
});

describe('tables', () => {
  it('typing in a table saves once, 800 ms after the last change, and only that table', async () => {
    const h = harness();
    expect(FORM26_TABLE_DEBOUNCE_MS).toBe(800);
    h.queue.tableChanged('S29', ROW('I'));
    await vi.advanceTimersByTimeAsync(500);
    h.queue.tableChanged('S29', ROW('In'));
    await vi.advanceTimersByTimeAsync(500);
    h.queue.tableChanged('S29', ROW('Inv'));
    await vi.advanceTimersByTimeAsync(799);
    expect(h.calls).toEqual([]);
    expect(h.queue.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls).toEqual([{ kind: 'table', key: 'S29', rows: ROW('Inv') }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.calls).toHaveLength(1);
    expect(h.queue.hasPending()).toBe(false);
  });

  it('each table has its own wait', async () => {
    const h = harness();
    h.queue.tableChanged('S29', ROW('first table'));
    await vi.advanceTimersByTimeAsync(600);
    h.queue.tableChanged('S30', ROW('second table'));
    await vi.advanceTimersByTimeAsync(200);
    expect(h.calls.map((call) => call.key)).toEqual(['S29']);
    await vi.advanceTimersByTimeAsync(600);
    expect(h.calls.map((call) => call.key)).toEqual(['S29', 'S30']);
  });

  it('leaving the table saves at once', async () => {
    const h = harness();
    h.queue.tableChanged('S29', ROW('Invented'));
    h.queue.tableLeft('S29');
    await settle();
    expect(h.calls).toEqual([{ kind: 'table', key: 'S29', rows: ROW('Invented') }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.calls).toHaveLength(1);                         // the wait was called off: no second save
    h.queue.tableLeft('S29');                                // leaving with nothing changed sends nothing
    h.queue.tableLeft('S30');
    await settle();
    expect(h.calls).toHaveLength(1);
  });

  it('typing that goes on while a save of the table is on its way is saved afterwards, with the last rows only', async () => {
    const h = harness();
    const waiting = h.hold();
    h.queue.tableChanged('S29', ROW('one'));
    await vi.advanceTimersByTimeAsync(800);
    h.queue.tableChanged('S29', ROW('two'));
    await vi.advanceTimersByTimeAsync(800);
    h.queue.tableChanged('S29', ROW('three'));
    await vi.advanceTimersByTimeAsync(800);
    expect(h.calls).toHaveLength(1);
    waiting[0].resolve('ok');
    await settle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ kind: 'table', key: 'S29', rows: ROW('three') });
    waiting[1].resolve('ok');
    await settle();
    expect(h.queue.hasPending()).toBe(false);
  });
});

describe('flush', () => {
  it('flush saves everything pending and resolves true', async () => {
    const h = harness();
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    h.queue.tableChanged('S29', ROW('still typing'));
    h.queue.tableChanged('S30', ROW('another'));
    const done = h.queue.flush();
    await settle();
    await expect(done).resolves.toBe(true);
    expect(h.calls.map((call) => call.key).sort()).toEqual(['S29', 'S30', 'f26_c13']);
    expect(h.queue.hasPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await expect(h.queue.flush()).resolves.toBe(true);       // nothing to do
    expect(h.calls).toHaveLength(3);
  });

  it('flush resolves only after everything is written', async () => {
    const h = harness();
    const waiting = h.hold();
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    await settle();
    h.queue.fieldCommitted('f26_c13', 'c13', 'No');          // waits behind the save on its way
    h.queue.tableChanged('S29', ROW('typing'));
    let resolved: boolean | null = null;
    void h.queue.flush().then((value) => { resolved = value; });
    await settle();
    expect(resolved).toBeNull();
    expect(h.calls.map((call) => call.key)).toEqual(['f26_c13', 'S29']);
    waiting[1].resolve('ok');                                // the table
    await settle();
    expect(resolved).toBeNull();
    waiting[0].resolve('ok');                                // the first save of the clause; the second now goes
    await settle();
    expect(resolved).toBeNull();
    expect(h.calls).toHaveLength(3);
    waiting[2].resolve('ok');
    await settle();
    expect(resolved).toBe(true);
    expect(h.calls[2]).toEqual({ kind: 'clause', key: 'f26_c13', changes: { c13: 'No' } });
  });

  it('flush resolves false when something could not be saved', async () => {
    const h = harness();
    h.answerWith((call) => (call.key === 'S29' ? 'failed' : 'ok'));
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    h.queue.tableChanged('S29', ROW('typing'));
    const done = h.queue.flush();
    await settle();
    await expect(done).resolves.toBe(false);
    expect(h.queue.hasPending()).toBe(true);
  });
});

describe('failures', () => {
  it('a failed save keeps the change, reports failed with the count, and retry sends it again', async () => {
    const h = harness();
    h.answerWith(() => ({ failed: 'database is locked' }));
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Invented software');
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    h.queue.tableChanged('S29', ROW('Invented'));
    h.queue.tableLeft('S29');
    await settle();
    expect(h.calls).toHaveLength(3);
    expect(h.last()).toEqual({ kind: 'failed', message: 'database is locked', pending: 3 });
    expect(h.queue.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls).toHaveLength(3);                         // it does not hammer the database on its own

    h.answerWith(() => 'ok');
    const retried = h.queue.retry();
    await settle();
    await expect(retried).resolves.toBe(true);
    expect(h.calls.slice(3)).toEqual(expect.arrayContaining([
      { kind: 'clause', key: 'f26_c14', changes: { c14b: 'Invented software' } },
      { kind: 'clause', key: 'f26_c13', changes: { c13: 'Yes' } },
      { kind: 'table', key: 'S29', rows: ROW('Invented') },
    ]));
    expect(h.calls).toHaveLength(6);
    expect(h.last()).toEqual({ kind: 'saved', at: Date.now() });
    expect(h.queue.hasPending()).toBe(false);
  });

  it('a save that throws or answers "failed" is a failed save with a plain message', async () => {
    const h = harness();
    h.answerWith(() => { throw new Error('IPC channel closed'); });
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    await settle();
    expect(h.last()).toEqual({ kind: 'failed', message: 'IPC channel closed', pending: 1 });
    h.answerWith(() => 'failed');
    const retried = h.queue.retry();
    await settle();
    await expect(retried).resolves.toBe(false);
    expect(h.last()).toEqual({ kind: 'failed', message: FORM26_SAVE_FAILED_MESSAGE, pending: 1 });
  });

  it('a later edit of the same row carries the unsaved one with it, and a newer value of the same field wins', async () => {
    const h = harness();
    h.answerWith(() => 'failed');
    h.queue.fieldCommitted('f26_c14', 'c14b', 'kept for later');
    h.queue.fieldCommitted('f26_c14', 'c14c', 'old value');
    await settle();
    h.answerWith(() => 'ok');
    h.queue.fieldCommitted('f26_c14', 'c14c', 'new value');
    await settle();
    expect(h.calls[1]).toEqual({ kind: 'clause', key: 'f26_c14', changes: { c14b: 'kept for later', c14c: 'new value' } });
    expect(h.queue.hasPending()).toBe(false);
    expect(h.last()?.kind).toBe('saved');
  });

  it('table rows that could not be saved are kept; newer rows replace them', async () => {
    const h = harness();
    h.answerWith(() => 'failed');
    h.queue.tableChanged('S29', ROW('first try'));
    await vi.advanceTimersByTimeAsync(800);
    expect(h.last()).toEqual({ kind: 'failed', message: FORM26_SAVE_FAILED_MESSAGE, pending: 1 });
    h.answerWith(() => 'ok');
    h.queue.tableChanged('S29', ROW('typed again'));
    await vi.advanceTimersByTimeAsync(800);
    expect(h.calls[1]).toEqual({ kind: 'table', key: 'S29', rows: ROW('typed again') });
    expect(h.queue.hasPending()).toBe(false);
  });
});

describe('what is shown while saving', () => {
  it('the busy state is reported only after 300 ms', async () => {
    const h = harness();
    expect(FORM26_BUSY_AFTER_MS).toBe(300);
    const waiting = h.hold();
    const started = Date.now();
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    await vi.advanceTimersByTimeAsync(299);
    expect(h.states).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.states).toEqual([{ kind: 'saving', since: started }]);
    await vi.advanceTimersByTimeAsync(700);
    waiting[0].resolve('ok');
    await settle();
    expect(h.states).toEqual([{ kind: 'saving', since: started }, { kind: 'saved', at: started + 1000 }]);
  });

  it('a quick save never shows the busy state', async () => {
    const h = harness();
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.states.map((state) => state.kind)).toEqual(['saved']);
  });
});

describe('a conflict reported by the saver', () => {
  it('the conflicting field is kept apart: not sent again by a flush or a later edit, until the user decides', async () => {
    const h = harness();
    h.answerWith((call) => (call.kind === 'clause' && 'c14b' in call.changes ? { conflict: ['c14b'] } : 'ok'));
    h.queue.fieldCommitted('f26_c14', 'c14b', 'mine');
    h.queue.fieldCommitted('f26_c14', 'c14e', 'not in conflict');
    await settle();
    expect(h.last()).toEqual({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] });
    expect(h.queue.conflicts()).toEqual([{ clauseKey: 'f26_c14', fields: ['c14b'] }]);
    expect(h.queue.hasPending()).toBe(true);

    h.queue.fieldCommitted('f26_c14', 'c14b', 'mine, typed again');
    h.queue.fieldCommitted('f26_c14', 'c14c', 'another field');
    const flushed = h.queue.flush();
    await settle();
    await expect(flushed).resolves.toBe(false);              // not everything is saved: a decision is waiting
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ kind: 'clause', key: 'f26_c14', changes: { c14c: 'another field' } });

    // "Keep mine" sends the user's latest value.
    h.answerWith(() => 'ok');
    const kept = h.queue.resolveConflict('f26_c14', ['c14b'], 'mine');
    await settle();
    await expect(kept).resolves.toBe(true);
    expect(h.calls[2]).toEqual({ kind: 'clause', key: 'f26_c14', changes: { c14b: 'mine, typed again' } });
    expect(h.queue.conflicts()).toEqual([]);
    expect(h.queue.hasPending()).toBe(false);
    expect(h.last()?.kind).toBe('saved');
  });

  it('"Use theirs" drops the user’s value and sends nothing', async () => {
    const h = harness();
    h.answerWith(() => 'conflict');                          // the plain answer: every field of that save
    h.queue.fieldCommitted('f26_c14', 'c14b', 'mine');
    await settle();
    expect(h.last()).toEqual({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] });
    const dropped = h.queue.resolveConflict('f26_c14', null, 'theirs');
    await settle();
    await expect(dropped).resolves.toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.queue.hasPending()).toBe(false);
    expect(h.last()).toEqual({ kind: 'idle' });
  });

  it('a table in conflict is held the same way', async () => {
    const h = harness();
    h.answerWith(() => ({ conflict: ['S29'] }));
    h.queue.tableChanged('S29', ROW('mine'));
    h.queue.tableLeft('S29');
    await settle();
    expect(h.last()).toEqual({ kind: 'changed-elsewhere', clauseKey: 'f26_t_S29', fields: ['S29'] });
    h.queue.tableChanged('S29', ROW('mine, more'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.calls).toHaveLength(1);
    h.answerWith(() => 'ok');
    const kept = h.queue.resolveConflict('f26_t_S29', null, 'mine');
    await settle();
    await expect(kept).resolves.toBe(true);
    expect(h.calls[1]).toEqual({ kind: 'table', key: 'S29', rows: ROW('mine, more') });
  });
});

describe('a save that met a change AND then failed (combined outcome)', () => {
  it('the clashing field is held for the user; only the others are failed, and retry sends only those', async () => {
    const h = harness();
    h.answerWith(() => ({ conflict: ['c14b'], failed: 'database is locked' }));
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Mine');
    h.queue.fieldCommitted('f26_c14', 'c14e', 'My backup');
    await settle();
    expect(h.queue.conflicts()).toEqual([{ clauseKey: 'f26_c14', fields: ['c14b'] }]);
    expect(h.last()).toEqual({ kind: 'failed', message: 'database is locked', pending: 1 });
    h.answerWith(() => 'ok');
    const retried = h.queue.retry();
    await settle();
    await expect(retried).resolves.toBe(false);                // the decision on c14b still waits
    expect(h.calls[1]).toEqual({ kind: 'clause', key: 'f26_c14', changes: { c14e: 'My backup' } });
    expect(h.calls).toHaveLength(2);
    expect(h.last()).toEqual({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] });
  });

  it('a table answer naming the table as clashing is a conflict even when it also failed', async () => {
    const h = harness();
    h.answerWith(() => ({ conflict: ['S29'], failed: 'database is locked' }));
    h.queue.tableChanged('S29', ROW('mine'));
    h.queue.tableLeft('S29');
    await settle();
    expect(h.queue.conflicts()).toEqual([{ clauseKey: 'f26_t_S29', fields: ['S29'] }]);
    const flushed = h.queue.flush();
    await settle();
    await expect(flushed).resolves.toBe(false);
    expect(h.calls).toHaveLength(1);
  });
});

describe('the value the user saw when they began editing (seen)', () => {
  it('is handed to the saver with the change; a field committed without it is handed none', async () => {
    const h = harness();
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Mine', '');
    h.queue.fieldCommitted('f26_c14', 'c14e', 'My backup');
    await settle();
    expect(h.calls).toEqual([{ kind: 'clause', key: 'f26_c14', changes: { c14b: 'Mine', c14e: 'My backup' } }]);
    expect(h.seens).toEqual([{ c14b: '' }]);
  });

  it('a second edit of a field not yet stored keeps the first seen; once stored, the stored value is the next seen', async () => {
    const h = harness();
    const waiting = h.hold();
    h.queue.fieldCommitted('f26_c14', 'c14b', 'first', 'old');
    await settle();
    h.queue.fieldCommitted('f26_c14', 'c14b', 'second', 'first');   // the screen showed the user's own unsaved value
    waiting[0].resolve('ok');                                       // 'first' is now stored
    await settle();
    expect(h.seens[1]).toEqual({ c14b: 'first' });
    waiting[1].resolve('ok');
    await settle();

    // The same, but the first save fails: nothing was stored, so the next save is still judged against 'old'.
    const g = harness();
    const held = g.hold();
    g.queue.fieldCommitted('f26_c14', 'c14b', 'first', 'old');
    await settle();
    g.queue.fieldCommitted('f26_c14', 'c14b', 'second', 'first');
    held[0].resolve({ failed: 'database is locked' });
    await settle();
    expect(g.calls[1].kind === 'clause' ? g.calls[1].changes : null).toEqual({ c14b: 'second' });
    expect(g.seens[1]).toEqual({ c14b: 'old' });
  });

  it('after "Keep mine" the field is sent without seen: the user chose to overwrite what is there now', async () => {
    const h = harness();
    h.answerWith(() => ({ conflict: ['c14b'] }));
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Mine', '');
    await settle();
    h.answerWith(() => 'ok');
    const kept = h.queue.resolveConflict('f26_c14', ['c14b'], 'mine');
    await settle();
    await expect(kept).resolves.toBe(true);
    expect(h.calls[1]).toEqual({ kind: 'clause', key: 'f26_c14', changes: { c14b: 'Mine' } });
    expect(h.seens[1]).toEqual({});
    // And a later edit of it starts afresh from what the screen shows then.
    h.queue.fieldCommitted('f26_c14', 'c14b', 'Mine again', 'Mine');
    await settle();
    expect(h.seens[2]).toEqual({ c14b: 'Mine' });
  });
});

describe('dispose', () => {
  it('after dispose nothing is sent and nothing is reported', async () => {
    const h = harness();
    const waiting = h.hold();
    h.queue.fieldCommitted('f26_c13', 'c13', 'Yes');
    await settle();
    h.queue.fieldCommitted('f26_c13', 'c13', 'No');
    h.queue.tableChanged('S29', ROW('typing'));
    const flushed = h.queue.flush();
    await settle();
    const calls = h.calls.length;
    const states = h.states.length;
    h.queue.dispose();
    await expect(flushed).resolves.toBe(false);
    waiting.forEach((entry) => entry.resolve('ok'));
    h.queue.fieldCommitted('f26_c14', 'c14b', 'late');
    h.queue.tableChanged('S30', ROW('late'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.calls).toHaveLength(calls);
    expect(h.states).toHaveLength(states);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// The queue on the real row writer and store, over the in-memory database: what two users see.
describe('with the store: two users on one clause', () => {
  let db: FakeTaxAuditDb;

  async function openAll() {
    db = new FakeTaxAuditDb();
    db.assigned.add('eng-1');
    db.seed('clients', { id: 'client-1', name: 'Invented Traders', pan: 'AAAAA0000A' });
    db.seed('engagements', { id: 'eng-1', client_id: 'client-1', financial_year: '2026-27' });
    const store = createForm26Store(await clientOn(db));
    const loaded = await store.load({ engagementId: 'eng-1', clientId: 'client-1', financialYear: '2026-27', userId: 'user-1' });
    if (loaded.state !== 'ready') throw new Error(loaded.state);
    const rows = new Map<string, Form26ClauseRow>(loaded.rows.map((row) => [row.clause_key, row]));
    const writer = createForm26RowWriter({ store, getRow: (key) => rows.get(key), onRow: (row) => { rows.set(row.clause_key, row); } });
    const states: Form26SaveState[] = [];
    const queue = createForm26SaveQueue({
      saveClause: writer.saveClause, saveTable: writer.saveTable, isStored: writer.isStored,
      now: () => Date.now(), setTimeout, clearTimeout, onState: (state) => states.push(state),
    });
    const idOf = (key: string) => rows.get(key)?.id ?? '';
    const answers = (key: string) => parseClausePayload(String(db.rows('tax_audit_clause_responses').find((row) => row.clause_key === key)?.response_json)).f;
    const updates = () => db.writes().filter((call) => call.action === 'update');
    return { queue, states, rows, idOf, answers, updates };
  }
  const c14 = (changes: Record<string, string>) => JSON.stringify({ v: 1, f: { c14b: '', c14c: '', c14d: 'Yes', c14e: '', ...changes } });

  afterEach(() => {
    expect(db.violations).toEqual([]);
  });

  it('a conflict on other fields merges and saves without a message', async () => {
    const { queue, states, idOf, answers } = await openAll();
    db.tick(2);
    db.changeElsewhere('tax_audit_clause_responses', idOf('f26_c14'), { response_json: c14({ c14c: 'Their cloud' }) });
    db.tick(2);
    queue.fieldCommitted('f26_c14', 'c14b', 'My software');
    await expect(queue.flush()).resolves.toBe(true);
    expect(answers('f26_c14')).toEqual({ c14b: 'My software', c14c: 'Their cloud', c14d: 'Yes', c14e: '' });
    expect(states.map((state) => state.kind)).toEqual(['saved']);
  });

  it("a conflict on the same field reports changed-elsewhere and keeps the user's value in memory", async () => {
    const { queue, states, idOf, answers, rows, updates } = await openAll();
    db.tick(2);
    db.changeElsewhere('tax_audit_clause_responses', idOf('f26_c14'), { response_json: c14({ c14b: 'Their software' }) });
    db.tick(2);
    queue.fieldCommitted('f26_c14', 'c14b', 'My software');
    await expect(queue.flush()).resolves.toBe(false);
    expect(states[states.length - 1]).toEqual({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] });
    expect(answers('f26_c14').c14b).toBe('Their software');                       // nothing was overwritten
    expect(parseClausePayload(rows.get('f26_c14')?.response_json).f.c14b).toBe('Their software');   // "theirs" is at hand for the screen
    expect(queue.hasPending()).toBe(true);                                        // "mine" is still held

    // Leaving the page, or a later edit elsewhere in the clause, must not push "mine" through.
    const before = updates().length;
    queue.fieldCommitted('f26_c14', 'c14e', 'My backup address');
    await expect(queue.flush()).resolves.toBe(false);
    expect(updates()).toHaveLength(before + 1);
    expect(answers('f26_c14')).toMatchObject({ c14b: 'Their software', c14e: 'My backup address' });

    await expect(queue.resolveConflict('f26_c14', ['c14b'], 'mine')).resolves.toBe(true);
    expect(answers('f26_c14')).toEqual({ c14b: 'My software', c14c: '', c14d: 'Yes', c14e: 'My backup address' });
    expect(queue.hasPending()).toBe(false);
  });

  it('"Use theirs" leaves the other user’s answer in the database', async () => {
    const { queue, idOf, answers, updates } = await openAll();
    db.tick(2);
    db.changeElsewhere('tax_audit_clause_responses', idOf('f26_c14'), { response_json: c14({ c14b: 'Their software' }) });
    queue.fieldCommitted('f26_c14', 'c14b', 'My software');
    await expect(queue.flush()).resolves.toBe(false);
    const before = updates().length;
    await expect(queue.resolveConflict('f26_c14', ['c14b'], 'theirs')).resolves.toBe(true);
    expect(updates()).toHaveLength(before);
    expect(answers('f26_c14').c14b).toBe('Their software');
  });

  it('a clause approved while the user was typing is not overwritten, and "Keep mine" cannot force it', async () => {
    const { queue, states, idOf, answers, rows } = await openAll();
    db.tick(2);
    db.changeElsewhere('tax_audit_clause_responses', idOf('f26_c14'), { review_status: 'approved', locked: 1 });
    queue.fieldCommitted('f26_c14', 'c14b', 'Typed too late');
    await expect(queue.flush()).resolves.toBe(false);
    expect(states[states.length - 1]).toEqual({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] });
    expect(rows.get('f26_c14')?.review_status).toBe('approved');
    await expect(queue.resolveConflict('f26_c14', ['c14b'], 'mine')).resolves.toBe(false);
    expect(answers('f26_c14').c14b).toBe('');
  });

  it('a save failing midway leaves no half-written state and the user’s values are kept for retry', async () => {
    const { queue, states, answers } = await openAll();
    const before = db.rows('tax_audit_clause_responses');
    db.before = (query) => (query.action === 'update' ? { data: null, error: { message: 'disk I/O error' } } : undefined);
    queue.fieldCommitted('f26_c14', 'c14b', 'My software');
    queue.fieldCommitted('f26_c13', 'c13', 'My books');
    queue.tableChanged('S29', [{ ...defaultValues(DEF).t.S29[0], '1': 'Invented person' }]);
    await expect(queue.flush()).resolves.toBe(false);
    expect(db.rows('tax_audit_clause_responses')).toEqual(before);
    expect(states[states.length - 1]).toEqual({ kind: 'failed', message: 'disk I/O error', pending: 3 });

    db.before = null;
    await expect(queue.retry()).resolves.toBe(true);
    expect(answers('f26_c14').c14b).toBe('My software');
    expect(answers('f26_c13').c13).toBe('My books');
    const table = db.rows('tax_audit_clause_responses').find((row) => row.clause_key === 'f26_t_S29');
    expect(parseTablePayload(String(table?.response_json)).rows[0]['1']).toBe('Invented person');
    // Exactly the three rows were written; the other 119 are as they were.
    const after = db.rows('tax_audit_clause_responses');
    expect(after.filter((row, index) => JSON.stringify(row) !== JSON.stringify(before[index])).map((row) => row.clause_key).sort()).toEqual(['f26_c13', 'f26_c14', 'f26_t_S29']);
  });

  it('a value equal to the stored one sends nothing to the database', async () => {
    const { queue, updates } = await openAll();
    queue.fieldCommitted('f26_c14', 'c14d', 'Yes');
    queue.tableChanged('S29', defaultValues(DEF).t.S29);
    await expect(queue.flush()).resolves.toBe(true);
    expect(updates()).toEqual([]);
  });

  // REVIEW-F scenario S1.
  it('a retry after a merge that failed midway never overwrites the other user’s answer: it waits for "Keep mine"', async () => {
    const { queue, states, idOf, answers } = await openAll();
    db.tick(2);
    db.changeElsewhere('tax_audit_clause_responses', idOf('f26_c14'), { response_json: c14({ c14b: 'Theirs', c14c: 'Their cloud' }) });
    db.tick(2);
    let updatesSeen = 0;
    // The first write meets the other user's change; the merged second write fails.
    db.before = (query) => (query.action === 'update' && ++updatesSeen === 2 ? { data: null, error: { message: 'database is locked' } } : undefined);
    queue.fieldCommitted('f26_c14', 'c14b', 'Mine', '');
    queue.fieldCommitted('f26_c14', 'c14e', 'My backup', '');
    await expect(queue.flush()).resolves.toBe(false);
    db.before = null;
    expect(queue.conflicts()).toEqual([{ clauseKey: 'f26_c14', fields: ['c14b'] }]);
    expect(states[states.length - 1]).toEqual({ kind: 'failed', message: 'database is locked', pending: 1 });

    await expect(queue.retry()).resolves.toBe(false);           // c14e goes in; c14b still waits for the user
    expect(answers('f26_c14')).toEqual({ c14b: 'Theirs', c14c: 'Their cloud', c14d: 'Yes', c14e: 'My backup' });
    expect(states[states.length - 1]).toEqual({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] });
    await expect(queue.flush()).resolves.toBe(false);
    expect(answers('f26_c14').c14b).toBe('Theirs');

    await expect(queue.resolveConflict('f26_c14', ['c14b'], 'mine')).resolves.toBe(true);
    expect(answers('f26_c14')).toEqual({ c14b: 'Mine', c14c: 'Their cloud', c14d: 'Yes', c14e: 'My backup' });
  });

  // REVIEW-F scenario S2.
  it('a field is judged against what the user saw when they began editing it, not against a row refreshed meanwhile', async () => {
    const { queue, idOf, answers, rows } = await openAll();
    db.tick(2);
    db.changeElsewhere('tax_audit_clause_responses', idOf('f26_c14'), { response_json: c14({ c14b: 'Theirs' }) });   // B writes c14b
    db.tick(2);
    // A, who opened c14b while it was blank, first leaves c14c: merged silently, and A's row now holds B's c14b.
    queue.fieldCommitted('f26_c14', 'c14c', 'My cloud', '');
    await expect(queue.flush()).resolves.toBe(true);
    expect(parseClausePayload(rows.get('f26_c14')?.response_json).f.c14b).toBe('Theirs');
    // Then A leaves c14b with A's own text: that is a clash, not an overwrite.
    queue.fieldCommitted('f26_c14', 'c14b', 'Mine', '');
    await expect(queue.flush()).resolves.toBe(false);
    expect(queue.conflicts()).toEqual([{ clauseKey: 'f26_c14', fields: ['c14b'] }]);
    expect(answers('f26_c14')).toEqual({ c14b: 'Theirs', c14c: 'My cloud', c14d: 'Yes', c14e: '' });
    // A user who began editing after the screen showed B's value overwrites it knowingly.
    await expect(queue.resolveConflict('f26_c14', ['c14b'], 'theirs')).resolves.toBe(true);
    queue.fieldCommitted('f26_c14', 'c14b', 'Mine, after reading theirs', 'Theirs');
    await expect(queue.flush()).resolves.toBe(true);
    expect(answers('f26_c14').c14b).toBe('Mine, after reading theirs');
  });
});
