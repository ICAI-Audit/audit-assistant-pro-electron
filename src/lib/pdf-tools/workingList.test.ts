import { describe, expect, it, vi } from 'vitest';
import {
  LIST_MAX_BYTES,
  LIST_WARN_BYTES,
  contextKeyFor,
  createWorkingListStore,
  newFileId,
  selectedInOrder,
  workingListStore,
  type WorkingListStore,
} from './workingList';
import { PdfToolsError, type WorkingFile } from './types';

const WARN = 100;
const MAX = 200;

/** A file with REAL bytes of the given length (declared size can be overridden to lie). */
function f(name: string, length = 4, declaredSize?: number): WorkingFile {
  return {
    id: newFileId(),
    name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'computer',
    bytes: new Uint8Array(length).fill(7), // identical bytes on purpose
    size: declaredSize ?? length,
    pageCount: 1,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
  };
}
const names = (s: WorkingListStore) => s.getState().files.map((x) => x.name);
const idOf = (s: WorkingListStore, name: string) => s.getState().files.find((x) => x.name === name)!.id;

function fresh(key = 'u1:e1') {
  const s = createWorkingListStore({ warnBytes: WARN, maxBytes: MAX });
  s.setContext(key);
  return s;
}

describe('contextKeyFor / newFileId / constants', () => {
  it('builds the key and unique ids', () => {
    expect(contextKeyFor('u1', 'e1')).toBe('u1:e1');
    expect(newFileId()).not.toBe(newFileId());
  });
  it('exposes a single application instance', () => {
    expect(workingListStore.getState()).toMatchObject({ contextKey: null, session: 0, files: [], selectedIds: [] });
  });
  it('exported limits are 150 MB and 300 MB and are the defaults', () => {
    expect(LIST_WARN_BYTES).toBe(150 * 1024 * 1024);
    expect(LIST_MAX_BYTES).toBe(300 * 1024 * 1024);
    const s = createWorkingListStore();
    s.setContext('k');
    // default max is 300 MB: a 1 KB file is fine, and declared 301 MB with tiny bytes is stored as tiny
    expect(s.addFiles('k', [f('a', 1024)])).toMatchObject({ added: 1, refused: 0, overWarn: false });
  });
});

describe('ordering and selection', () => {
  it('moves up/down, no-op at the edges, and selectedInOrder follows list order', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a'), f('b'), f('c')]);
    s.move(idOf(s, 'c'), 'up');
    expect(names(s)).toEqual(['a', 'c', 'b']);
    const before = s.getState();
    s.move(idOf(s, 'a'), 'up');
    expect(names(s)).toEqual(['a', 'c', 'b']);
    expect(s.getState()).toBe(before);
    s.move(idOf(s, 'b'), 'down');
    expect(s.getState()).toBe(before);
    s.move(idOf(s, 'a'), 'down');
    expect(names(s)).toEqual(['c', 'a', 'b']);
    s.setSelected([idOf(s, 'b'), idOf(s, 'c')]);
    expect(selectedInOrder(s.getState()).map((x) => x.name)).toEqual(['c', 'b']);
    s.move(idOf(s, 'b'), 'up');
    s.move(idOf(s, 'b'), 'up');
    expect(selectedInOrder(s.getState()).map((x) => x.name)).toEqual(['b', 'c']);
  });

  it('selectedInOrder follows list order, not selection order', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a'), f('b')]);
    s.setSelected([idOf(s, 'b'), idOf(s, 'a')]);
    expect(selectedInOrder(s.getState()).map((x) => x.name)).toEqual(['a', 'b']);
  });

  it('remove drops the file from the list and from the selection', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a'), f('b')]);
    s.setSelected([idOf(s, 'b'), idOf(s, 'a')]);
    const a = idOf(s, 'a');
    s.remove([a]);
    expect(s.getState().selectedIds).toEqual([idOf(s, 'b')]);
    expect(names(s)).toEqual(['b']);
  });

  it('the same file added twice gives two independent rows', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('Synthetic Traders ledger.pdf'), f('Synthetic Traders ledger.pdf')]);
    const [one, two] = s.getState().files;
    expect(one.id).not.toBe(two.id);
    s.setSelected([two.id]);
    expect(s.getState().selectedIds).toEqual([two.id]);
    s.move(two.id, 'up');
    expect(s.getState().files.map((x) => x.id)).toEqual([two.id, one.id]);
    s.remove([two.id]);
    expect(s.getState().files.map((x) => x.id)).toEqual([one.id]);
    expect(s.getState().selectedIds).toEqual([]);
  });

  it('gives a new id to an incoming file whose id is already in the list', () => {
    const s = fresh();
    const same = f('a');
    s.addFiles('u1:e1', [same]);
    s.addFiles('u1:e1', [same, same]);
    const ids = s.getState().files.map((x) => x.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('setSelected ignores unknown ids and duplicates', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a')]);
    const a = idOf(s, 'a');
    s.setSelected([a, a, 'nope']);
    expect(s.getState().selectedIds).toEqual([a]);
  });
});

describe('context (engagement / sign-out)', () => {
  it('clears on a different key, keeps on the same key', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a')]);
    s.setSelected([idOf(s, 'a')]);
    s.setContext('u1:e1');
    expect(names(s)).toEqual(['a']);
    s.setContext('u1:e2');
    expect(s.getState()).toMatchObject({ contextKey: 'u1:e2', files: [], selectedIds: [] });
  });

  it('drops a stale result that finishes after an engagement switch', () => {
    const s = fresh('u1:e1');
    s.setContext('u1:e2');
    const listener = vi.fn();
    s.subscribe(listener);
    expect(s.addResults('u1:e1', [f('Synthetic late result.pdf')])).toBe(false);
    expect(s.addFiles('u1:e1', [f('late input.pdf')])).toMatchObject({ added: 0 });
    expect(s.getState().files).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(s.addResults('u1:e2', [f('ok')])).toBe(true);
    expect(names(s)).toEqual(['ok']);
  });

  it('does not resurrect the first engagement list when switching back', () => {
    const s = fresh('u1:e1');
    s.addFiles('u1:e1', [f('a')]);
    s.setContext('u1:e2');
    s.setContext('u1:e1');
    expect(s.getState().files).toEqual([]);
  });

  it('sign-out (null) clears everything and later results for the old key are dropped', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a')]);
    s.setSelected([idOf(s, 'a')]);
    s.setContext(null);
    expect(s.getState()).toMatchObject({ contextKey: null, files: [], selectedIds: [] });
    expect(s.addResults('u1:e1', [f('late')])).toBe(false);
    expect(s.addFiles('u1:e1', [f('late')]).added).toBe(0);
    expect(s.getState().files).toEqual([]);
  });

  it('a store with no context accepts nothing', () => {
    const s = createWorkingListStore();
    expect(s.addFiles('u1:e1', [f('a')])).toEqual({ added: 0, refused: 0, overWarn: false });
    expect(s.addResults('u1:e1', [f('a')])).toBe(false);
  });
});

describe('session number', () => {
  it('starts at 0 and counts every real change of key, including to and from null', () => {
    const s = createWorkingListStore();
    expect(s.getState().session).toBe(0);
    s.setContext('A');
    expect(s.getState().session).toBe(1);
    s.setContext('A');
    expect(s.getState().session).toBe(1);
    s.setContext(null);
    expect(s.getState().session).toBe(2);
    s.setContext('B');
    expect(s.getState().session).toBe(3);
  });

  it('refuses a late result or add from the first A session after A, B, A', () => {
    const s = createWorkingListStore({ warnBytes: WARN, maxBytes: MAX });
    s.setContext('A');
    const first = s.getState().session;
    s.setContext('B');
    s.setContext('A');
    const second = s.getState().session;
    expect(second).not.toBe(first);
    const l = vi.fn();
    s.subscribe(l);
    expect(s.addResults('A', [f('late result')], first)).toBe(false);
    expect(s.addFiles('A', [f('late file')], first)).toEqual({ added: 0, refused: 0, overWarn: false });
    expect(s.getState().files).toEqual([]);
    expect(l).not.toHaveBeenCalled();
    expect(s.addResults('A', [f('now')], second)).toBe(true);
    expect(s.addFiles('A', [f('also now')], second)).toMatchObject({ added: 1 });
    expect(names(s)).toEqual(['now', 'also now']);
  });

  it('omitting the session behaves as before (key only)', () => {
    const s = fresh('A');
    expect(s.addResults('A', [f('x')])).toBe(true);
    expect(s.addFiles('A', [f('y')]).added).toBe(1);
  });
});

describe('size limits (real bytes, small limits)', () => {
  it('refuses a first file larger than the maximum on a clean store', () => {
    const s = fresh();
    const before = s.getState();
    expect(s.addFiles('u1:e1', [f('big', MAX + 1)])).toMatchObject({ added: 0, refused: 1 });
    expect(s.getState()).toBe(before);
  });

  it('refuses a file that would pass the maximum and leaves the list unchanged', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('x')]);
    const before = s.getState();
    const listener = vi.fn();
    s.subscribe(listener);
    expect(s.addFiles('u1:e1', [f('big', MAX)])).toMatchObject({ added: 0, refused: 1 });
    expect(s.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('allows exactly the maximum, refuses one byte more', () => {
    const s = fresh();
    expect(s.addFiles('u1:e1', [f('big', MAX)])).toMatchObject({ added: 1, refused: 0 });
    expect(s.addFiles('u1:e1', [f('one', 1)])).toMatchObject({ added: 0, refused: 1 });
    expect(s.getState().files).toHaveLength(1);
  });

  it('warns only above the warning size', () => {
    const s = fresh();
    expect(s.addFiles('u1:e1', [f('w', WARN)]).overWarn).toBe(false);
    expect(s.addFiles('u1:e1', [f('one', 1)]).overWarn).toBe(true);
  });

  it('accepts the files that fit and refuses the rest of one batch, in order', () => {
    const s = fresh();
    const r = s.addFiles('u1:e1', [f('a', MAX - 10), f('b', 11), f('c', 10)]);
    expect(r).toMatchObject({ added: 2, refused: 1 });
    expect(s.getState().files.map((x) => x.size)).toEqual([MAX - 10, 10]);
  });

  it('releases the size when a file is removed', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a', MAX)]);
    s.remove([s.getState().files[0].id]);
    expect(s.addFiles('u1:e1', [f('b', MAX)]).added).toBe(1);
  });

  it('addResults refuses the whole call past the maximum with a PdfToolsError "list-full", and changes nothing', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a', MAX - 10)]);
    const before = s.getState();
    let error: unknown;
    try {
      s.addResults('u1:e1', [f('fits', 5), f('too much', 6)]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).code).toBe('list-full');
    expect((error as PdfToolsError).message).toMatch(/The list is full/);
    expect(s.getState()).toBe(before); // not even the file that would fit alone
  });

  it('addResults allows exactly the maximum', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a', MAX - 10)]);
    expect(s.addResults('u1:e1', [f('r1', 4), f('r2', 6)])).toBe(true);
    expect(s.getState().files).toHaveLength(3);
  });

  it('addResults says "stale" (false) for another context before it looks at the size', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a', MAX)]);
    expect(s.addResults('u1:e2', [f('r', MAX)])).toBe(false);
    expect(s.addResults('u1:e1', [f('r', MAX)], s.getState().session + 1)).toBe(false);
  });

  it('does not trust a declared size: NaN, negative and mismatched values cannot bypass the limit', () => {
    const s = fresh();
    expect(s.addFiles('u1:e1', [f('nan', MAX + 1, NaN)])).toMatchObject({ added: 0, refused: 1 });
    expect(s.addFiles('u1:e1', [f('neg', MAX + 1, -5)])).toMatchObject({ added: 0, refused: 1 });
    expect(s.addFiles('u1:e1', [f('zero', MAX + 1, 0)])).toMatchObject({ added: 0, refused: 1 });
    expect(s.getState().files).toEqual([]);
    s.addFiles('u1:e1', [f('liar', 50, 1)]);
    expect(s.getState().files[0].size).toBe(50);
    s.addResults('u1:e1', [f('liar result', 30, -1)]);
    expect(s.getState().files[1].size).toBe(30);
    // the 50+30 already held count: 121 more would pass MAX
    expect(s.addFiles('u1:e1', [f('over', MAX - 79, 0)])).toMatchObject({ added: 0, refused: 1 });
    expect(s.addFiles('u1:e1', [f('fits', MAX - 80, 0)])).toMatchObject({ added: 1, refused: 0 });
  });
});

describe('markSent and unmarkVault', () => {
  it('marks destinations once each and stores the vault record', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('x')]);
    const id = idOf(s, 'x');
    const snap = s.getState();
    s.markSent(id, 'vault', { id: 'ev1', name: 'x.pdf', file_path: 'e2/u1/1-x.pdf', file_type: 'document', file_size: 10 });
    s.markSent(id, 'vault');
    s.markSent(id, 'computer');
    const x = s.getState().files[0];
    expect(x).toMatchObject({ sentTo: ['vault', 'computer'], vaultRecord: { id: 'ev1' } });
    expect(snap.files[0].sentTo).toEqual([]);
    s.markSent(id, 'working-paper');
    expect(s.getState().files[0].vaultRecord?.id).toBe('ev1');
    expect(Object.isFrozen(s.getState().files[0].sentTo)).toBe(true);
  });

  it('ignores unknown ids without notifying', () => {
    const s = fresh();
    const l = vi.fn();
    s.subscribe(l);
    s.markSent('nope', 'vault');
    s.remove(['nope']);
    s.move('nope', 'up');
    expect(s.unmarkVault('u1:e1', s.getState().session, 'nope')).toBe(false);
    expect(l).not.toHaveBeenCalled();
  });

  it('marks a download separately from a save', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('x')]);
    s.markSent(idOf(s, 'x'), 'download');
    expect(s.getState().files[0].sentTo).toEqual(['download']);
  });

  it('unmarkVault drops the vault mark and record, keeps the other marks, and only in its own context and session', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('x')]);
    const id = idOf(s, 'x');
    s.markSent(id, 'vault', { id: 'ev1', name: 'x.pdf', file_path: 'e1/u1/1-x.pdf', file_type: 'document', file_size: 4 });
    s.markSent(id, 'working-paper');
    const session = s.getState().session;
    expect(s.unmarkVault('u1:e2', session, id)).toBe(false);
    expect(s.unmarkVault('u1:e1', session + 1, id)).toBe(false);
    expect(s.getState().files[0].vaultRecord?.id).toBe('ev1');
    const snap = s.getState();
    expect(s.unmarkVault('u1:e1', session, id)).toBe(true);
    const x = s.getState().files[0];
    expect(x.sentTo).toEqual(['working-paper']);
    expect(x.vaultRecord).toBeUndefined();
    expect('vaultRecord' in x).toBe(false);
    expect(snap.files[0].vaultRecord?.id).toBe('ev1');
    expect(s.unmarkVault('u1:e1', session, id)).toBe(false); // nothing left to drop
  });
});

describe('store semantics for React', () => {
  it('returns the same snapshot when nothing changed and a new one on change', () => {
    const s = fresh();
    const a = s.getState();
    expect(s.getState()).toBe(a);
    s.setContext('u1:e1');
    s.setSelected([]);
    s.remove(['nope']);
    expect(s.getState()).toBe(a);
    s.addFiles('u1:e1', [f('a')]);
    const b = s.getState();
    expect(b).not.toBe(a);
    expect(b.files).not.toBe(a.files);
    expect(a.files).toEqual([]);
  });

  it('notifies once per change and not after unsubscribe', () => {
    const s = fresh();
    const l = vi.fn();
    const off = s.subscribe(l);
    s.addFiles('u1:e1', [f('a'), f('b'), f('c')]);
    expect(l).toHaveBeenCalledTimes(1);
    s.setSelected([idOf(s, 'a')]);
    expect(l).toHaveBeenCalledTimes(2);
    s.remove([idOf(s, 'a')]);
    expect(l).toHaveBeenCalledTimes(3);
    s.setContext('u1:e2');
    expect(l).toHaveBeenCalledTimes(4);
    off();
    off();
    s.addFiles('u1:e2', [f('z')]);
    expect(l).toHaveBeenCalledTimes(4);
  });

  it('remove releases the file: no snapshot field refers to it', () => {
    const s = fresh();
    const file = f('a');
    s.addFiles('u1:e1', [file, f('b')]);
    const id = s.getState().files[0].id;
    s.remove([id]);
    const state = s.getState();
    expect(state.files.some((x) => x.id === id)).toBe(false);
    expect(state.selectedIds).not.toContain(id);
  });
});

describe('listeners that misbehave', () => {
  it('a throwing listener does not break the mutator or the other listeners', () => {
    const s = fresh();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    s.subscribe(bad);
    s.subscribe(good);
    let result: ReturnType<typeof s.addFiles> | undefined;
    expect(() => {
      result = s.addFiles('u1:e1', [f('a')]);
    }).not.toThrow();
    expect(result).toMatchObject({ added: 1 });
    expect(good).toHaveBeenCalledTimes(1);
    expect(names(s)).toEqual(['a']);
    expect(s.addResults('u1:e1', [f('r')])).toBe(true);
  });

  it('a listener that unsubscribes itself is called once and not again', () => {
    const s = fresh();
    const other = vi.fn();
    let off = () => {};
    const self = vi.fn(() => off());
    off = s.subscribe(self);
    s.subscribe(other);
    s.addFiles('u1:e1', [f('a')]);
    s.addFiles('u1:e1', [f('b')]);
    expect(self).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it('a listener removed mid-round is still called once in that round, then never again', () => {
    const s = fresh();
    const second = vi.fn();
    let offSecond = () => {};
    s.subscribe(() => offSecond());
    offSecond = s.subscribe(second);
    s.addFiles('u1:e1', [f('a')]);
    expect(second).toHaveBeenCalledTimes(1);
    s.addFiles('u1:e1', [f('b')]);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('immutability and input copies', () => {
  it('snapshots are frozen: pushing or assigning does not reach the store', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a')]);
    s.setSelected([idOf(s, 'a')]);
    const snap = s.getState();
    expect(() => (snap.files as WorkingFile[]).push(f('evil'))).toThrow();
    expect(() => (snap.selectedIds as string[]).push('x')).toThrow();
    expect(() => {
      (snap.files[0] as WorkingFile).name = 'hacked';
    }).toThrow();
    expect(() => (snap.files[0].sentTo as string[]).push('vault')).toThrow();
    expect(() => {
      (snap as { session: number }).session = 99;
    }).toThrow();
    expect(names(s)).toEqual(['a']);
    expect(s.getState().session).toBe(1);
  });

  it('copies inputs: mutating the caller object after adding changes nothing', () => {
    const s = fresh();
    const original = f('a');
    s.addFiles('u1:e1', [original]);
    original.name = 'changed';
    original.sentTo.push('vault');
    expect(names(s)).toEqual(['a']);
    expect(s.getState().files[0].sentTo).toEqual([]);
    const result = f('r');
    s.addResults('u1:e1', [result]);
    result.name = 'changed';
    expect(names(s)).toEqual(['a', 'r']);
    // bytes are shared, not copied or frozen
    expect(s.getState().files[0].bytes).toBe(original.bytes);
    expect(Object.isFrozen(original.bytes)).toBe(false);
  });

  it('mutators never alter a snapshot taken earlier', () => {
    const s = fresh();
    s.addFiles('u1:e1', [f('a'), f('b')]);
    s.setSelected([idOf(s, 'a')]);
    const snap = s.getState();
    const filesBefore = snap.files.slice();
    const selBefore = snap.selectedIds.slice();
    const a = idOf(s, 'a');
    s.move(idOf(s, 'b'), 'up');
    s.markSent(a, 'computer');
    s.setSelected([]);
    s.remove([a]);
    expect(snap.files).toEqual(filesBefore);
    expect(snap.selectedIds).toEqual(selBefore);
  });
});
