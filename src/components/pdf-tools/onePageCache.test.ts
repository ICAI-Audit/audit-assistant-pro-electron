import { describe, expect, it, vi } from 'vitest';
import { createOnePageCache } from './onePageCache';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createOnePageCache', () => {
  it('copies a page out once and reuses it while the file and page stay the same', async () => {
    const extract = vi.fn(async (_bytes: Uint8Array, indices: number[]) => new Uint8Array([indices[0]]));
    const cache = createOnePageCache(extract);
    const file = new Uint8Array([1, 2, 3]);
    const first = await cache.get(file, 2);
    const again = await cache.get(file, 2);
    expect(again).toBe(first);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith(file, [2]);
  });

  it('copies again for another page or another file', async () => {
    const extract = vi.fn(async (_bytes: Uint8Array, indices: number[]) => new Uint8Array([indices[0]]));
    const cache = createOnePageCache(extract);
    const file = new Uint8Array([1]);
    await cache.get(file, 0);
    await cache.get(file, 1);
    await cache.get(new Uint8Array([1]), 1); // equal content, different file
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it('does not keep a failed copy', async () => {
    let fail = true;
    const extract = vi.fn(async () => {
      if (fail) throw new Error('could not read');
      return new Uint8Array([9]);
    });
    const cache = createOnePageCache(extract);
    const file = new Uint8Array([1]);
    await expect(cache.get(file, 0)).rejects.toThrow('could not read');
    await flush();
    fail = false;
    expect(await cache.get(file, 0)).toEqual(new Uint8Array([9]));
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('joins a copy still in progress instead of starting another', async () => {
    let finish!: (value: Uint8Array) => void;
    const extract = vi.fn(() => new Promise<Uint8Array>((resolve) => (finish = resolve)));
    const cache = createOnePageCache(extract);
    const file = new Uint8Array([1]);
    const a = cache.get(file, 0);
    const b = cache.get(file, 0);
    finish(new Uint8Array([7]));
    expect(await a).toBe(await b);
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
