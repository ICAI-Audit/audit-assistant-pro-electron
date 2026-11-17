import { describe, expect, it } from 'vitest';
import type { WorkingListState } from '@/lib/pdf-tools/workingList';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { guardedState, shouldDropContext } from './contextGuard';

const stored = (id: unknown) => JSON.stringify({ id, name: 'Statutory audit', client_name: 'Synthetic' });

describe('shouldDropContext', () => {
  it('keeps the list while the stored engagement is the list engagement', () => {
    expect(shouldDropContext('user-1:eng-A', stored('eng-A'))).toBe(false);
  });

  it('drops it when another engagement is stored', () => {
    expect(shouldDropContext('user-1:eng-A', stored('eng-B'))).toBe(true);
  });

  it('drops it when no engagement is stored', () => {
    expect(shouldDropContext('user-1:eng-A', null)).toBe(true);
  });

  it('drops it when the stored value cannot be read', () => {
    expect(shouldDropContext('user-1:eng-A', '{not json')).toBe(true);
    expect(shouldDropContext('user-1:eng-A', stored(42))).toBe(true);
    expect(shouldDropContext('user-1:eng-A', 'null')).toBe(true);
    expect(shouldDropContext('user-1:eng-A', stored(''))).toBe(true);
  });

  it('does nothing when the list has no context', () => {
    expect(shouldDropContext(null, stored('eng-A'))).toBe(false);
    expect(shouldDropContext(null, null)).toBe(false);
  });

  it('compares the whole engagement id, not a suffix of it', () => {
    expect(shouldDropContext('user-1:eng-AB', stored('B'))).toBe(true);
    expect(shouldDropContext('user-1:eng-A', stored('user-1:eng-A'))).toBe(true);
  });
});

describe('guardedState', () => {
  const file = { id: 'f1' } as WorkingFile;
  const snapshot: WorkingListState = { contextKey: 'user-1:eng-A', session: 3, files: [file], selectedIds: ['f1'] };

  it('passes the snapshot through when it belongs to the current context', () => {
    expect(guardedState(snapshot, 'user-1:eng-A')).toBe(snapshot);
  });

  it('shows nothing from another context', () => {
    const guarded = guardedState(snapshot, 'user-1:eng-B');
    expect(guarded).toEqual({ contextKey: 'user-1:eng-B', session: -1, files: [], selectedIds: [] });
  });

  it('shows nothing when signed out or no engagement is open', () => {
    expect(guardedState(snapshot, null).files).toEqual([]);
  });

  it('returns the same empty object for the same context, so renders stay stable', () => {
    expect(guardedState(snapshot, 'user-1:eng-B')).toBe(guardedState(snapshot, 'user-1:eng-B'));
  });
});
