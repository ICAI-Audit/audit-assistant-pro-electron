// What the page viewer draws and when (design section 4, "Rendering"), without React, pdf.js or the
// DOM, so that the rules are unit-tested with fake drawings:
//
// - The page shown is drawn first, at zoom x screen pixel ratio within the caps (renderPlan). Then
//   the pages either side are drawn at the same zoom and turn, next page first.
// - A change of page or turn draws at once. A change of zoom or window size, on a page whose drawing
//   is already shown, is drawn RERENDER_DELAY_MS after the last change; until then the drawing shown
//   is stretched by the screen. A change of page while a page is still being drawn also waits
//   RERENDER_DELAY_MS, so a burst of PgDn draws only the last page (cancelling a drawing does not
//   stop pdf.js decoding a scan in its worker; spike-viewer 4.3).
// - Every change cancels the drawings no longer wanted, except the one now wanted for the page
//   shown (going to the next page uses the drawing already under way for it).
// - At most three drawings are kept (the page shown and the pages either side); each drawing that
//   leaves, a drawing that arrives when it is no longer wanted, and everything on close, is handed
//   to `release` exactly once.
// - `onPaint` is called synchronously with the drawing to show: the caller copies it to the screen
//   at once, before anything can release it.
// - After running out of memory, Try again (retry with lowMemory) lets every kept drawing go, tells
//   the renderer to keep no page parsed, and from then on, until the viewer closes, keeps only the
//   drawing of the page shown and draws no page either side (lane V review, item 3).
import { createViewerCache, viewerKey, VIEWER_CACHE_MAX } from './viewerCache';
import { displayedSize, renderPlan, RERENDER_DELAY_MS, zoomFitScale, type RenderPlan, type Size, type ViewRotation, type ZoomMode } from './viewerMath';
import type { PageGeometry } from './pageGeometry';

export interface PageInfo {
  geometry: PageGeometry;
  /** The page's size in points as the reader sees it (its own /Rotate applied, no view turn). */
  widthPt: number;
  heightPt: number;
}

export interface Drawing<B> {
  bitmap: B;
  widthPx: number;
  heightPx: number;
}

export interface ViewRequest {
  /** Counted from 0. */
  pageIndex: number;
  turn: ViewRotation;
  zoom: ZoomMode;
  /** The space the page is fitted into, in CSS pixels. */
  frame: Size;
  /** The screen's device pixel ratio. */
  dpr: number;
}

export interface Painted<B> {
  pageIndex: number;
  turn: ViewRotation;
  key: string;
  /** Device pixels per point of this drawing. */
  scale: number;
  plan: RenderPlan;
  drawing: Drawing<B>;
}

export interface EngineDeps<B> {
  fileId: string;
  pageCount: number;
  info(pageIndex: number, signal: AbortSignal): Promise<PageInfo>;
  /** `ahead` is true for a page either side, drawn before it is asked for. */
  draw(pageIndex: number, scale: number, turn: ViewRotation, signal: AbortSignal, ahead: boolean): Promise<Drawing<B>>;
  release(bitmap: B): void;
  /** How a page is drawn for a zoom: renderPlan unless given. */
  plan?: (widthPt: number, heightPt: number, cssScale: number, dpr: number) => RenderPlan;
  onInfo(pageIndex: number, info: PageInfo): void;
  onPaint(painted: Painted<B>): void;
  onFailed(pageIndex: number, error: unknown): void;
  /** The pages whose drawings are kept or wanted (from 0, sorted): the renderer keeps those parsed. */
  onKept?: (pageIndexes: number[]) => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface RetryOptions {
  /**
   * The failure was for want of memory: let every kept drawing go and keep no page parsed before
   * drawing the page shown again, and draw only the page shown from then on.
   */
  lowMemory?: boolean;
  /** Draw the page shown afresh: its kept drawing is let go first (a drawing that showed nothing). */
  redraw?: boolean;
}

export interface ViewerEngine {
  show(request: ViewRequest): void;
  /** Draws the page shown again (after a failure). */
  retry(options?: RetryOptions): void;
  close(): void;
  readonly closed: boolean;
  /** For the tests: the drawings kept, and those being drawn. */
  readonly cachedKeys: string[];
  readonly drawingKeys: string[];
}

interface Target {
  pageIndex: number;
  turn: ViewRotation;
  key: string;
  plan: RenderPlan;
}

interface Job<B> {
  target: Target;
  controller: AbortController;
  promise: Promise<Drawing<B>>;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function createViewerEngine<B>(deps: EngineDeps<B>): ViewerEngine {
  const planFor = deps.plan ?? renderPlan;
  const delayMs = deps.delayMs ?? RERENDER_DELAY_MS;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const cache = createViewerCache<Drawing<B>>((drawing) => deps.release(drawing.bitmap), VIEWER_CACHE_MAX);
  const infos = new Map<number, PageInfo>();
  const infoJobs = new Map<number, Promise<PageInfo>>();
  const infoController = new AbortController();
  const jobs = new Map<string, Job<B>>();
  let closed = false;
  let version = 0;
  let request: ViewRequest | null = null;
  // The key wanted for the page shown, and what is on screen now.
  let wanted: Target | null = null;
  let painted: { pageIndex: number; turn: ViewRotation; key: string } | null = null;
  let timer: unknown = null;
  // A show is waiting for its page's size.
  let awaitingInfo = false;
  let lastKept = '';
  // Memory ran out: only the page shown is drawn and kept, and no page is kept parsed.
  let lowMemory = false;

  const reportKept = (extra: readonly string[] = []) => {
    if (!deps.onKept || lowMemory) return;
    const pages = [...new Set([...cache.keys, ...extra].map((key) => Number(key.split('|')[1])))].sort((a, b) => a - b);
    const text = pages.join(',');
    if (text === lastKept) return;
    lastKept = text;
    deps.onKept(pages);
  };

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  function infoFor(pageIndex: number): PageInfo | Promise<PageInfo> {
    const known = infos.get(pageIndex);
    if (known) return known;
    let job = infoJobs.get(pageIndex);
    if (!job) {
      job = deps.info(pageIndex, infoController.signal).then(
        (info) => {
          infoJobs.delete(pageIndex);
          if (!closed) infos.set(pageIndex, info);
          return info;
        },
        (error: unknown) => {
          infoJobs.delete(pageIndex);
          throw error;
        },
      );
      infoJobs.set(pageIndex, job);
    }
    return job;
  }

  function targetFor(pageIndex: number, info: PageInfo, view: ViewRequest): Target {
    const shown = displayedSize({ width: info.widthPt, height: info.heightPt }, view.turn);
    const cssScale = zoomFitScale(view.zoom, shown, view.frame);
    const plan = planFor(shown.width, shown.height, cssScale, view.dpr);
    return { pageIndex, turn: view.turn, plan, key: viewerKey(deps.fileId, pageIndex, plan.scale, view.turn) };
  }

  function paint(target: Target, drawing: Drawing<B>): void {
    painted = { pageIndex: target.pageIndex, turn: target.turn, key: target.key };
    deps.onPaint({ pageIndex: target.pageIndex, turn: target.turn, key: target.key, scale: target.plan.scale, plan: target.plan, drawing });
  }

  /** Cancels every drawing under way except the ones for `keep`. */
  function cancelExcept(keep: ReadonlySet<string>): void {
    for (const [key, job] of jobs) {
      if (keep.has(key)) continue;
      jobs.delete(key);
      job.controller.abort();
    }
  }

  function start(target: Target, ahead: boolean): Promise<Drawing<B>> {
    const running = jobs.get(target.key);
    if (running) return running.promise;
    const controller = new AbortController();
    const promise = deps.draw(target.pageIndex, target.plan.scale, target.turn, controller.signal, ahead);
    const job: Job<B> = { target, controller, promise };
    jobs.set(target.key, job);
    const done = () => {
      if (jobs.get(target.key) === job) jobs.delete(target.key);
    };
    promise.then(done, done);
    return promise;
  }

  /** Keeps a finished drawing if it is still wanted (the page shown or a page either side), else releases it. */
  function keep(target: Target, drawing: Drawing<B>, wantedKeys: ReadonlySet<string>): boolean {
    if (closed || !wantedKeys.has(target.key)) {
      deps.release(drawing.bitmap);
      return false;
    }
    cache.set(target.key, drawing);
    return true;
  }

  function drawCurrent(v: number, target: Target): void {
    start(target, false).then(
      (drawing) => {
        if (closed || wanted?.key !== target.key) {
          // Still useful as a neighbour only if this version planned it; otherwise let it go.
          if (!closed && v === version && neighbourKeys.has(target.key)) cache.set(target.key, drawing);
          else deps.release(drawing.bitmap);
          return;
        }
        cache.set(target.key, drawing);
        paint(target, drawing);
        prefetch(v);
      },
      (error: unknown) => {
        if (closed || isAbort(error) || wanted?.key !== target.key) return;
        deps.onFailed(target.pageIndex, error);
      },
    );
  }

  // Keys of the pages either side planned for the current version.
  let neighbourKeys = new Set<string>();

  function prefetch(v: number): void {
    const view = request;
    if (!view || closed || v !== version || lowMemory) return;
    const around = [view.pageIndex + 1, view.pageIndex - 1].filter((p) => p >= 0 && p < deps.pageCount);
    const planned: Target[] = [];
    let waiting = around.length;
    const finishPlanning = () => {
      if (closed || v !== version) return;
      neighbourKeys = new Set(planned.map((t) => t.key));
      const keepKeys = new Set([wanted?.key ?? '', ...neighbourKeys]);
      cache.keepOnly([...keepKeys]);
      reportKept([...keepKeys].filter(Boolean));
      for (const target of planned) {
        if (cache.has(target.key)) continue;
        start(target, true).then(
          (drawing) => {
            // Kept for later, or for now when the user has meanwhile moved to this page: then
            // drawCurrent is waiting on the same drawing and shows it.
            const stillWanted = new Set(v === version ? [wanted?.key ?? '', ...neighbourKeys] : [wanted?.key ?? '']);
            keep(target, drawing, stillWanted);
          },
          () => undefined, // a page either side that cannot be drawn says so only when it is shown
        );
      }
    };
    if (waiting === 0) {
      finishPlanning();
      return;
    }
    for (const pageIndex of around) {
      const add = (info: PageInfo) => {
        if (!closed && v === version) planned.push(targetFor(pageIndex, info, view));
      };
      const settled = () => {
        waiting -= 1;
        if (waiting === 0) finishPlanning();
      };
      const info = infoFor(pageIndex);
      if (info instanceof Promise) {
        info.then(add, () => undefined).finally(settled);
      } else {
        add(info);
        settled();
      }
    }
  }

  function showWith(v: number, view: ViewRequest, info: PageInfo, slow: boolean): void {
    if (closed || v !== version) return;
    awaitingInfo = false;
    deps.onInfo(view.pageIndex, info);
    const target = targetFor(view.pageIndex, info, view);
    wanted = target;
    neighbourKeys = new Set();
    cancelExcept(new Set([target.key]));
    // Drawings of pages that are no longer near, or at another turn, are dropped at once; short of
    // memory, every drawing but the one wanted.
    const near = new Set([view.pageIndex - 1, view.pageIndex, view.pageIndex + 1]);
    cache.keepOnly(
      lowMemory
        ? [target.key]
        : cache.keys.filter((key) => {
            const [, page, , turn] = key.split('|');
            return near.has(Number(page)) && Number(turn) === view.turn;
          }),
    );
    reportKept([target.key]);
    const kept = cache.get(target.key);
    if (kept) {
      paint(target, kept);
      prefetch(v);
      return;
    }
    // A zoom or size change on the page and turn already shown waits a moment: the drawing shown is
    // stretched meanwhile, and only the last of several quick changes is drawn.
    const stretched = painted !== null && painted.pageIndex === view.pageIndex && painted.turn === view.turn;
    if ((stretched || slow) && delayMs > 0 && !jobs.has(target.key)) {
      timer = setTimer(() => {
        timer = null;
        if (!closed && v === version) drawCurrent(v, target);
      }, delayMs);
      return;
    }
    drawCurrent(v, target);
  }

  function show(view: ViewRequest): void {
    if (closed) return;
    version += 1;
    const v = version;
    // Something is still being drawn or waited for: this change comes in a burst.
    const slow = timer !== null || awaitingInfo || (wanted !== null && jobs.has(wanted.key) && painted?.key !== wanted.key);
    request = view;
    stopTimer();
    const info = infoFor(view.pageIndex);
    if (info instanceof Promise) {
      // Until the page's size is known, nothing else is wanted.
      wanted = null;
      awaitingInfo = true;
      cancelExcept(new Set());
      info.then(
        (known) => showWith(v, view, known, slow),
        (error: unknown) => {
          if (closed || v !== version) return;
          awaitingInfo = false;
          if (!isAbort(error)) deps.onFailed(view.pageIndex, error);
        },
      );
    } else {
      showWith(v, view, info, slow);
    }
  }

  return {
    show,
    retry(options: RetryOptions = {}) {
      if (closed) return;
      if (options.lowMemory) {
        lowMemory = true;
        stopTimer();
        cancelExcept(new Set());
        cache.clear();
        neighbourKeys = new Set();
        // Nothing is on screen any more (the caller empties its canvas): draw at once, not after a delay.
        painted = null;
        lastKept = '';
        deps.onKept?.([]);
      } else if (options.redraw && wanted) {
        const stale = wanted.key;
        cache.keepOnly(cache.keys.filter((key) => key !== stale));
        // Drawn at once, not after the delay a zoom on the page shown waits.
        painted = null;
      }
      if (request) show(request);
    },
    close() {
      if (closed) return;
      closed = true;
      stopTimer();
      infoController.abort();
      cancelExcept(new Set());
      cache.clear();
      infos.clear();
      infoJobs.clear();
      wanted = null;
      painted = null;
      request = null;
    },
    get closed() {
      return closed;
    },
    get cachedKeys() {
      return cache.keys;
    },
    get drawingKeys() {
      return [...jobs.keys()];
    },
  };
}
