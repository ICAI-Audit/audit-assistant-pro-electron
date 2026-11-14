import { describe, expect, it } from 'vitest';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { startEngagementWatch } from './engagementWatch';

function harness(initial: string | null) {
  const store = createWorkingListStore();
  let stored = initial;
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const listeners = new Map<string, () => void>();
  const stop = startEngagementWatch({
    store,
    readEngagement: () => stored,
    setInterval: (fn) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id as number);
    },
    listen: (type, fn) => {
      listeners.set(type, fn);
    },
  });
  return {
    store,
    stop,
    setStored: (value: string | null) => {
      stored = value;
    },
    tick: () => [...timers.values()].forEach((fn) => fn()),
    timerCount: () => timers.size,
    fire: (type: string) => listeners.get(type)?.(),
  };
}

const engagement = (id: string) => JSON.stringify({ id });
const pdf = (id: string): WorkingFile => ({
  id,
  name: `${id}.pdf`,
  kind: 'pdf',
  mimeType: 'application/pdf',
  origin: 'computer',
  bytes: new Uint8Array(10),
  size: 10,
  pageCount: 1,
  wasProtected: false,
  hasRestrictions: false,
  hasSignature: false,
  sentTo: [],
});

describe('engagement watch', () => {
  it('does not poll while the list has no context', () => {
    const h = harness(engagement('A'));
    expect(h.timerCount()).toBe(0);
  });

  it('polls while the list has a context, and keeps the list while the engagement is unchanged', () => {
    const h = harness(engagement('A'));
    h.store.setContext('u1:A');
    h.store.addFiles('u1:A', [pdf('f1')], h.store.getState().session);
    expect(h.timerCount()).toBe(1);
    h.tick();
    expect(h.store.getState().files).toHaveLength(1);
  });

  it('empties the list and moves the session on when another engagement is chosen', () => {
    const h = harness(engagement('A'));
    h.store.setContext('u1:A');
    h.store.addFiles('u1:A', [pdf('f1')]);
    const session = h.store.getState().session;
    h.setStored(engagement('B'));
    h.tick();
    expect(h.store.getState()).toMatchObject({ contextKey: null, files: [] });
    expect(h.store.getState().session).toBe(session + 1);
    expect(h.timerCount()).toBe(0);
  });

  it('empties the list when the engagement is cleared or unreadable', () => {
    const h = harness(engagement('A'));
    h.store.setContext('u1:A');
    h.setStored(null);
    h.tick();
    expect(h.store.getState().contextKey).toBeNull();

    h.store.setContext('u1:A');
    h.setStored('{broken');
    h.tick();
    expect(h.store.getState().contextKey).toBeNull();
  });

  it('checks at once when the window regains focus or becomes visible', () => {
    const h = harness(engagement('A'));
    h.store.setContext('u1:A');
    h.setStored(engagement('B'));
    h.fire('focus');
    expect(h.store.getState().contextKey).toBeNull();

    h.store.setContext('u1:A');
    h.fire('visibilitychange');
    expect(h.store.getState().contextKey).toBeNull();
  });

  it('stops when asked', () => {
    const h = harness(engagement('A'));
    h.store.setContext('u1:A');
    h.stop();
    expect(h.timerCount()).toBe(0);
    h.setStored(engagement('B'));
    h.fire('focus');
    expect(h.store.getState().contextKey).toBe('u1:A');
  });
});
