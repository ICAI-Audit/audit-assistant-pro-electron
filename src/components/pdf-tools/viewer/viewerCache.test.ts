import { describe, expect, it, vi } from 'vitest';
import { createViewerCache, viewerKey } from './viewerCache';

const make = (max?: number) => {
  const release = vi.fn<(value: string) => void>();
  return { cache: createViewerCache<string>(release, max), release };
};

describe('viewer cache', () => {
  it('keeps three by default; a fourth releases the least recently used, once', () => {
    const { cache, release } = make();
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    expect(release).not.toHaveBeenCalled();
    cache.set('d', 'D');
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('A');
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined();
  });

  it('a get makes an entry the most recently used', () => {
    const { cache, release } = make(3);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    expect(cache.get('a')).toBe('A');
    cache.set('d', 'D');
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('B');
    expect(cache.get('a')).toBe('A');
  });

  it('keepOnly releases every other entry exactly once', () => {
    const { cache, release } = make(3);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    cache.keepOnly(['b']);
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls.map((c) => c[0]).sort()).toEqual(['A', 'C']);
    expect(cache.size).toBe(1);
    expect(cache.get('b')).toBe('B');
    cache.keepOnly(['b', 'missing']);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('clear releases everything and leaves it empty', () => {
    const { cache, release } = make(3);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.clear();
    expect(release).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
    cache.clear();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('setting an existing key releases the old value (not the new one)', () => {
    const { cache, release } = make(3);
    cache.set('a', 'A1');
    cache.set('a', 'A2');
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('A1');
    expect(cache.get('a')).toBe('A2');
    expect(cache.size).toBe(1);
    // The same value again is not released: it is still the one in use.
    cache.set('a', 'A2');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('has() looks without changing what goes first', () => {
    const { cache, release } = make(2);
    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.has('a')).toBe(true);
    cache.set('c', 'C');
    expect(release).toHaveBeenCalledWith('A');
  });

  it('keys tell file, page, scale and turn apart', () => {
    const keys = new Set([
      viewerKey('f1', 0, 2, 0),
      viewerKey('f1', 1, 2, 0),
      viewerKey('f2', 0, 2, 0),
      viewerKey('f1', 0, 2.5, 0),
      viewerKey('f1', 0, 2, 90),
    ]);
    expect(keys.size).toBe(5);
    // A scale that differs only by floating-point noise is the same drawing.
    expect(viewerKey('f1', 0, 2.0000000001, 0)).toBe(viewerKey('f1', 0, 2, 0));
  });
});
