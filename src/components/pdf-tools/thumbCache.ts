// Page and image previews drawn once and shown wherever they are asked for at that size (QA-FIX C): the
// Organise pages grid draws its tiles at the page panel's size (104 px boxes, 208 px drawings), so a page
// the panel has drawn appears at once in the grid, and a page the panel is still waiting for is drawn once,
// for both, at the grid's priority. No DOM here (tests give stand-ins); Thumb.tsx uses the one cache.
//
// - A drawing is shared by everyone showing it (`take` / `give`). Drawings nobody shows are kept, up to
//   `maxIdle`, the oldest let go first (its object URL revoked); a shown one is never let go.
// - A drawing in progress is shared too: a later request joins it, and raises its priority when it asks
//   for a higher one. It is stopped only when every one waiting for it has left.
// - A failed drawing is not kept: the next request (Try again, or the automatic retry) draws afresh.
// - clear() lets everything go (the engagement or user changed, PDF Tools closed): drawings still shown are
//   let go when they are given back.
import { abortError, type Priority } from './renderQueue';

/** What a cached drawing is made with: the renderer's call for one preview. */
export type ThumbRender = (options: {
  signal: AbortSignal;
  priority: Priority;
  onStart: () => void;
  onQueued: (raise: (priority: Priority) => void) => void;
}) => Promise<string>;

export interface ThumbRequest {
  priority: Priority;
  signal: AbortSignal;
  /** Called when the drawing starts (at once when it already has). */
  onStart?: () => void;
}

export interface ThumbCache {
  /** A drawing already made, counted as shown by the caller until `give`; null when there is none. */
  take(bytes: Uint8Array, key: string): string | null;
  /** Draws (or joins the drawing in progress); resolves with the drawing, counted as shown until `give`. */
  draw(bytes: Uint8Array, key: string, render: ThumbRender, request: ThumbRequest): Promise<string>;
  /** The caller no longer shows the drawing it took. */
  give(bytes: Uint8Array, key: string): void;
  clear(): void;
}

interface Pending {
  promise: Promise<string>;
  controller: AbortController;
  waiters: number;
  priority: Priority;
  started: boolean;
  onStart: Set<() => void>;
  raise: ((priority: Priority) => void) | null;
}

interface Entry {
  key: string;
  owner: Map<string, Entry>;
  url: string | null;
  users: number;
  pending: Pending | null;
}

const RANK: Record<Priority, number> = { view: 0, run: 1, dialog: 2, high: 3, normal: 4 };

export function createThumbCache({ maxIdle, revoke }: { maxIdle: number; revoke: (url: string) => void }): ThumbCache {
  const files = new WeakMap<Uint8Array, Map<string, Entry>>();
  // Drawings let go by clear() while still shown, by file: revoked when given back.
  const retiredOf = new WeakMap<Map<string, Entry>, Map<string, Entry>>();
  // Drawings nobody shows, oldest first.
  const idle = new Set<Entry>();
  // Every entry with a drawing, for clear().
  const drawn = new Set<Entry>();

  const forget = (entry: Entry) => {
    idle.delete(entry);
    drawn.delete(entry);
    if (entry.owner.get(entry.key) === entry) entry.owner.delete(entry.key);
    if (entry.url) revoke(entry.url);
    entry.url = null;
  };

  const trim = () => {
    for (const entry of idle) {
      if (idle.size <= maxIdle) return;
      forget(entry);
    }
  };

  const entryFor = (bytes: Uint8Array, key: string, create: boolean): Entry | null => {
    let owner = files.get(bytes);
    if (!owner) {
      if (!create) return null;
      owner = new Map();
      files.set(bytes, owner);
    }
    let entry = owner.get(key) ?? null;
    if (!entry && create) {
      entry = { key, owner, url: null, users: 0, pending: null };
      owner.set(key, entry);
    }
    return entry;
  };

  const markShown = (entry: Entry): string => {
    entry.users += 1;
    idle.delete(entry);
    return entry.url!;
  };

  return {
    take(bytes, key) {
      const entry = entryFor(bytes, key, false);
      return entry?.url ? markShown(entry) : null;
    },

    draw(bytes, key, render, request) {
      if (request.signal.aborted) return Promise.reject(abortError());
      const entry = entryFor(bytes, key, true)!;
      if (entry.url) {
        request.onStart?.();
        return Promise.resolve(markShown(entry));
      }
      let pending = entry.pending;
      if (!pending) {
        const controller = new AbortController();
        const fresh: Pending = { promise: Promise.resolve(''), controller, waiters: 0, priority: request.priority, started: false, onStart: new Set(), raise: null };
        fresh.promise = render({
          signal: controller.signal,
          priority: request.priority,
          onStart: () => {
            fresh.started = true;
            for (const started of fresh.onStart) started();
            fresh.onStart.clear();
          },
          onQueued: (raise) => (fresh.raise = raise),
        }).then(
          (url) => {
            if (entry.pending === fresh) entry.pending = null;
            if (controller.signal.aborted || entry.owner.get(key) !== entry) {
              revoke(url);
              throw abortError();
            }
            entry.url = url;
            drawn.add(entry);
            // Kept for later even if everyone waiting has left meanwhile.
            idle.add(entry);
            trim();
            return url;
          },
          (error: unknown) => {
            if (entry.pending === fresh) entry.pending = null;
            if (!entry.url && entry.owner.get(key) === entry && !entry.pending) entry.owner.delete(key);
            throw error;
          },
        );
        // A rejection nobody waits for any more is not an unhandled one.
        fresh.promise.catch(() => undefined);
        entry.pending = fresh;
        pending = fresh;
      } else if (RANK[request.priority] < RANK[pending.priority]) {
        pending.priority = request.priority;
        pending.raise?.(request.priority);
      }
      const shared = pending;
      shared.waiters += 1;
      if (request.onStart) {
        if (shared.started) request.onStart();
        else shared.onStart.add(request.onStart);
      }
      return new Promise<string>((resolve, reject) => {
        let left = false;
        const leave = () => {
          if (left) return;
          left = true;
          if (request.onStart) shared.onStart.delete(request.onStart);
          shared.waiters -= 1;
          if (shared.waiters <= 0 && entry.pending === shared) {
            entry.pending = null;
            shared.controller.abort();
            if (!entry.url && entry.owner.get(key) === entry) entry.owner.delete(key);
          }
          reject(abortError());
        };
        request.signal.addEventListener('abort', leave, { once: true });
        shared.promise.then(
          () => {
            request.signal.removeEventListener('abort', leave);
            if (left) return;
            left = true;
            shared.waiters -= 1;
            resolve(markShown(entry));
          },
          (error: unknown) => {
            request.signal.removeEventListener('abort', leave);
            if (left) return;
            left = true;
            shared.waiters -= 1;
            reject(error);
          },
        );
      });
    },

    give(bytes, key) {
      const owner = files.get(bytes);
      const retired = owner ? retiredOf.get(owner)?.get(key) : undefined;
      if (retired && owner) {
        retired.users -= 1;
        if (retired.users <= 0) {
          retiredOf.get(owner)?.delete(key);
          if (retired.url) revoke(retired.url);
          retired.url = null;
        }
        return;
      }
      const entry = entryFor(bytes, key, false);
      if (!entry || entry.users === 0) return;
      entry.users -= 1;
      if (entry.users > 0) return;
      idle.delete(entry);
      idle.add(entry); // the newest
      trim();
    },

    clear() {
      for (const entry of [...drawn]) {
        if (entry.users > 0) {
          // Still on screen: it goes when it is given back; nobody new gets it.
          drawn.delete(entry);
          idle.delete(entry);
          if (entry.owner.get(entry.key) === entry) entry.owner.delete(entry.key);
          let retired = retiredOf.get(entry.owner);
          if (!retired) {
            retired = new Map();
            retiredOf.set(entry.owner, retired);
          }
          retired.set(entry.key, entry);
          continue;
        }
        forget(entry);
      }
    },
  };
}
