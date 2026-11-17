// The viewer's kept drawings: at most a few (three by default: the page shown and the pages either
// side), the least recently used going first. Every value that leaves, for whatever reason, is
// handed to `release` exactly once (an ImageBitmap is closed there). No DOM here.
import type { ViewRotation } from './viewerMath';

export interface ViewerCache<T> {
  get(key: string): T | undefined;
  /** Looks without making the entry recently used. */
  has(key: string): boolean;
  set(key: string, value: T): void;
  keepOnly(keys: readonly string[]): void;
  clear(): void;
  readonly size: number;
  readonly keys: string[];
}

export const VIEWER_CACHE_MAX = 3;

export function createViewerCache<T>(release: (value: T) => void, max: number = VIEWER_CACHE_MAX): ViewerCache<T> {
  // A Map keeps insertion order: the first entry is the least recently used.
  const entries = new Map<string, T>();
  const drop = (key: string) => {
    const value = entries.get(key) as T;
    entries.delete(key);
    release(value);
  };

  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as T;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    has(key) {
      return entries.has(key);
    },
    set(key, value) {
      if (entries.has(key)) {
        const old = entries.get(key) as T;
        entries.delete(key);
        if (old !== value) release(old);
      }
      entries.set(key, value);
      while (entries.size > Math.max(1, max)) drop(entries.keys().next().value as string);
    },
    keepOnly(keys) {
      const keep = new Set(keys);
      for (const key of [...entries.keys()]) if (!keep.has(key)) drop(key);
    },
    clear() {
      for (const key of [...entries.keys()]) drop(key);
    },
    get size() {
      return entries.size;
    },
    get keys() {
      return [...entries.keys()];
    },
  };
}

/** One drawing: a file's page at a drawing scale (rounded, so floating-point noise is the same drawing) and turn. */
export function viewerKey(fileId: string, pageIndex: number, scale: number, rotation: ViewRotation): string {
  return `${fileId}|${pageIndex}|${scale.toFixed(4)}|${rotation}`;
}
