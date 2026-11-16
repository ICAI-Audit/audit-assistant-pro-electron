import { describe, expect, it, vi } from 'vitest';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { dismissFileMessages, dismissWhenListChanges, fileMessageId, RESULT_MESSAGE } from './fileMessages';

describe('messages that name a file go when the list does (REV-B S3)', () => {
  it('gives each message its own id, and dismisses them all, the result message included, once', () => {
    const a = fileMessageId();
    const b = fileMessageId();
    expect(a).not.toBe(b);
    const dismiss = vi.fn();
    dismissFileMessages(dismiss);
    expect(dismiss.mock.calls.map(([id]) => id).sort()).toEqual([RESULT_MESSAGE, a, b].sort());
    dismiss.mockClear();
    dismissFileMessages(dismiss);
    expect(dismiss.mock.calls.map(([id]) => id)).toEqual([RESULT_MESSAGE]); // the others went the first time
  });

  it('dismisses them when the list moves to another engagement, user or session (also with the screen closed), not on other changes', () => {
    const store = createWorkingListStore();
    store.setContext('u1:A');
    const dismiss = vi.fn();
    const stop = dismissWhenListChanges(store, dismiss);
    const saved = fileMessageId();
    store.setSelected([]); // a change inside the same list
    expect(dismiss).not.toHaveBeenCalled();
    store.setContext('u1:B'); // another engagement
    expect(dismiss).toHaveBeenCalledWith(saved);
    expect(dismiss).toHaveBeenCalledWith(RESULT_MESSAGE);
    dismiss.mockClear();
    store.setContext(null); // signed out
    expect(dismiss).toHaveBeenCalledWith(RESULT_MESSAGE);
    stop();
    dismiss.mockClear();
    store.setContext('u1:A');
    expect(dismiss).not.toHaveBeenCalled();
  });
});
