import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSY_DELAY_MS, delayedBusy } from './delayedBusy';

describe('delayedBusy', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('shows nothing when the work ends before the delay (no flash in the usual instant case)', () => {
    const show = vi.fn();
    const hide = vi.fn();
    const done = delayedBusy(show, hide);
    vi.advanceTimersByTime(BUSY_DELAY_MS - 1);
    done();
    vi.advanceTimersByTime(BUSY_DELAY_MS * 10);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it('shows the busy state once the delay passes, and hides it once when the work ends', () => {
    const show = vi.fn();
    const hide = vi.fn();
    const done = delayedBusy(show, hide);
    vi.advanceTimersByTime(BUSY_DELAY_MS);
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
    done();
    done();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('waits about 300 ms by default', () => {
    expect(BUSY_DELAY_MS).toBe(300);
  });
});
