// Turns for the window during long library work on the main thread (REV-A B6).
//
// pdf-lib waits for a timer between slices of work, counted in objects: every PARSE_OBJECTS_PER_TICK
// objects (below) when PDF Tools passes that number. Counted waits are rare on a file of few large
// objects, and when saving with object streams pdf-lib counts in steps of 50 that seldom land on a multiple
// of 1,500, so a save could run seconds without one (REV-A: 2.2 s against 0.2 s at pdf-lib's default). The
// paced load and save below are pdf-lib's own load and save with one change: pdf-lib asks its question
// "wait now?" of the clock instead of the count, so it waits once TURN_AFTER_MS have passed since the window
// last had a turn, however large the objects. They read and write exactly what pdf-lib's own calls do (only
// the waits differ); if pdf-lib's insides are not as expected they fall back to its own calls.
//
// PDF Tools' own loops over pages, files and objects call a pacer (`pacer` below) often: it reads the
// clock and, once TURN_AFTER_MS have passed since the window last had a turn, gives it one (the window
// paints and takes input, a Stop click is seen) and then runs the caller's check, which stops the work by
// throwing. Any turn counts, whoever gave it (the run's own yield between pages too: a message posted to
// oneself is delivered at the next turn and restarts the clock), so turns are never doubled, which matters
// because a turn costs a timer's wait (4 ms or more in a browser; under Node on this busy machine about
// 30 ms). A file whose work between turns is shorter than TURN_AFTER_MS is not slowed.
import { PDFDocument, PDFParser, PDFStreamWriter, PDFWriter, type PDFContext } from 'pdf-lib';

/**
 * The object count pdf-lib is given as its slice (`parseSpeed` on load, `objectsPerTick` on save). Every
 * non-Redact load and save of PDF Tools now waits by the clock instead (loadPaced, savePaced and
 * withClockWaits below, INT3): the count is still passed, because the library requires a number and
 * falls back to it if its insides are not as expected. pdf-lib's default (100) waited for a timer every
 * 100 objects: a 320-page text ledger (16,330 objects) waited 163 times, each wait a timer tick (4 to 15 ms
 * idle, far more on a busy machine), so the waits, not the reading, took most of the time. Only the waits
 * change: pdf-lib writes the same bytes (object streams are cut by their own count, 50). A slice of 1,500
 * objects is not short (in processor time up to 0.14 s on the 320-page ledger, 0.22 s on a 2,000-page one),
 * which is why the clock decides now. Kept here (inspect.ts re-exports it) so that inspect.ts can use the
 * paced load without an import cycle.
 */
export const PARSE_OBJECTS_PER_TICK = 1500;

/** How long library work may hold the main thread before it gives the window a turn. */
export const TURN_AFTER_MS = 50;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Port {
  onmessage: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
  unref?: () => void;
}
/** A port that posts messages to oneself, each delivered at the next turn. Undefined where there is no MessageChannel. */
function messageLoop(onMessage: () => void): Port | undefined {
  if (typeof MessageChannel === 'undefined') return undefined;
  const channel = new MessageChannel();
  const receive = channel.port1 as unknown as Port;
  const send = channel.port2 as unknown as Port;
  receive.onmessage = onMessage;
  // Under Node a port with a listener would keep the process alive.
  receive.unref?.();
  send.unref?.();
  return send;
}

/** When the window last had a turn, as far as this module can tell. */
let lastTurn = now();
let watching = false;
const sentinel = messageLoop(() => {
  watching = false;
  lastTurn = now();
});
/** Notes the next turn of the event loop, whoever gives it: a message posted now is delivered then. */
function watchForTurn(): void {
  if (watching || !sentinel) return;
  watching = true;
  sentinel.postMessage(0);
}

/**
 * One turn of the event loop: a timer, as pdf-lib and the run's own yields take it. (A posted message would
 * skip the browser's 4 ms timer wait, but Node delivers up to 1,000 posted messages in one go, so timers,
 * and with them other work waiting for its turn, could wait seconds: measured, 4 s on 2,000 pages.)
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Call it often; await what it returns. Undefined when no turn is due, so a hot loop pays only for the clock. */
export type Pace = () => Promise<void> | undefined;

/**
 * A pacer: gives the window a turn when more than `everyMs` have passed since it last had one (from when
 * the pacer is made, which counts as one), then awaits `check` (the caller's Stop check; it throws to stop).
 */
export function pacer(check?: () => void | Promise<void>, everyMs: number = TURN_AFTER_MS): Pace {
  lastTurn = now();
  const give = async (): Promise<void> => {
    await nextTurn();
    lastTurn = now();
    if (check) {
      await check();
      lastTurn = now();
    }
  };
  return () => {
    watchForTurn();
    return now() - lastTurn < everyMs ? undefined : give();
  };
}

/**
 * Work written once for both ways of running it: a generator that yields wherever a turn may be given.
 * `runPaced` gives the window its turns through `pace`; `runAtOnce` runs it to the end in one stretch
 * (for a caller that must stay synchronous).
 */
export type Work<T> = Generator<void, T, void>;

export async function runPaced<T>(work: Work<T>, pace: Pace): Promise<T> {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
    const turn = pace();
    if (turn) await turn;
  }
}

export function runAtOnce<T>(work: Work<T>): T {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}

// ---- pdf-lib's load and save, waiting by the clock --------------------------------------------------

/**
 * pdf-lib's question "wait for a timer now?", answered by the clock: yes once `everyMs` have passed since
 * the window last had a turn. pdf-lib asks before it waits, so the clock restarts at the first question
 * after a wait (a wait that itself took longer than `everyMs`, on a busy machine, must not make the next
 * answer yes at once: that waited after every object and made a load ten times slower).
 */
export function byTheClock(everyMs: number = TURN_AFTER_MS, afterWait?: () => void): () => boolean {
  lastTurn = now();
  let waited = false;
  return () => {
    const t = now();
    if (waited) {
      waited = false;
      lastTurn = t;
      // The first question after a wait: the window has had its turn, so a Stop clicked in it is seen here.
      afterWait?.();
      return false;
    }
    watchForTurn();
    if (t - lastTurn < everyMs) return false;
    waited = true;
    return true;
  };
}

interface Waits {
  shouldWaitForTick?: unknown;
}

export interface PacedLoadOptions {
  ignoreEncryption?: boolean;
  updateMetadata?: boolean;
  /**
   * The caller's Stop check (a run's `run.check()`), asked after each wait while the file is read: what it
   * throws ends the read, and loadPaced throws it as it is (`isStop` says so), never as a damaged file.
   */
  check?: () => void;
}

/** The errors a load's Stop check threw (the run's own), passed on by loadPaced. */
const stopErrors = new WeakSet<object>();

/**
 * Whether an error from loadPaced is its caller's own Stop (thrown by `check`): a caller that reports a load
 * error as "could not be read" passes this one on as it is.
 */
export function isStop(error: unknown): boolean {
  return typeof error === 'object' && error !== null && stopErrors.has(error);
}

/**
 * `PDFDocument.load(bytes, { ...options, parseSpeed: PARSE_OBJECTS_PER_TICK })`, with pdf-lib's waits
 * taken by the clock (one at least every `everyMs` of reading). Throws what pdf-lib throws, or what
 * `options.check` throws after a wait (FIX-A2 follow-up: a Stop pressed during the read lands within it).
 */
export async function loadPaced(bytes: Uint8Array, options: PacedLoadOptions = {}, everyMs: number = TURN_AFTER_MS): Promise<PDFDocument> {
  const ignoreEncryption = options.ignoreEncryption ?? false;
  const updateMetadata = options.updateMetadata ?? true;
  const parser = PDFParser.forBytesWithOptions(bytes, PARSE_OBJECTS_PER_TICK, false, false) as unknown as Waits & { parseDocument(): Promise<PDFContext> };
  const Doc = PDFDocument as unknown as new (context: PDFContext, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument;
  if (typeof parser.shouldWaitForTick !== 'function' || typeof parser.parseDocument !== 'function') {
    return PDFDocument.load(bytes, { ignoreEncryption, updateMetadata, parseSpeed: PARSE_OBJECTS_PER_TICK });
  }
  const { check } = options;
  if (!check) {
    parser.shouldWaitForTick = byTheClock(everyMs);
    return new Doc(await parser.parseDocument(), ignoreEncryption, updateMetadata);
  }
  // pdf-lib catches what is thrown while it reads an object stream (it reads the object again as a damaged
  // one), so once the check has thrown, every later question throws the same error until the read ends.
  let stopped: { error: unknown } | undefined;
  const clock = byTheClock(everyMs, () => {
    try {
      check();
    } catch (error) {
      stopped = { error };
      throw error;
    }
  });
  parser.shouldWaitForTick = () => {
    if (stopped) throw stopped.error;
    return clock();
  };
  const stop = (): never => {
    const { error } = stopped!;
    if (typeof error === 'object' && error !== null) stopErrors.add(error);
    throw error;
  };
  let context: PDFContext;
  try {
    context = await parser.parseDocument();
  } catch (error) {
    if (stopped) stop();
    throw error;
  }
  if (stopped) stop();
  return new Doc(context, ignoreEncryption, updateMetadata);
}

/**
 * `doc.save({ useObjectStreams, objectsPerTick: PARSE_OBJECTS_PER_TICK })`, with pdf-lib's waits taken by
 * the clock. The same steps as pdf-lib's save: a page added to a document with none, form appearances
 * brought up to date when the form was opened, embedded fonts and images written, then the writer.
 */
export async function savePaced(doc: PDFDocument, options: { useObjectStreams?: boolean } = {}, everyMs: number = TURN_AFTER_MS): Promise<Uint8Array> {
  const useObjectStreams = options.useObjectStreams ?? true;
  const writer = (useObjectStreams ? PDFStreamWriter : PDFWriter).forContext(doc.context, PARSE_OBJECTS_PER_TICK) as unknown as Waits & { serializeToBuffer(): Promise<Uint8Array> };
  const forms = (doc as unknown as { formCache?: { getValue?: () => { updateFieldAppearances(): void } | undefined } }).formCache;
  if (typeof writer.shouldWaitForTick !== 'function' || typeof writer.serializeToBuffer !== 'function' || typeof forms?.getValue !== 'function') {
    return doc.save({ useObjectStreams, objectsPerTick: PARSE_OBJECTS_PER_TICK });
  }
  if (doc.getPageCount() === 0) doc.addPage();
  forms.getValue()?.updateFieldAppearances();
  await doc.flush();
  writer.shouldWaitForTick = byTheClock(everyMs);
  return writer.serializeToBuffer();
}

// ---- the second library (@cantoo/pdf-lib, Protect and unlock): its own load and save, waiting by the clock --

/** pdf-lib's question before a wait: `n` objects more done (a writer passes how many), "wait now?". */
type WaitQuestion = (n?: number) => boolean;
/** Makes the question a parser or writer will ask, from the one it was made with. */
type Pacing = (own: WaitQuestion) => WaitQuestion;

/** The inputs of calls in progress (bytes being loaded, a document's context being saved) and how they wait. */
const pacedInputs = new WeakMap<object, Pacing>();
/** The factories already watched, per class. */
const watchedFactories = new WeakMap<object, Set<string>>();

/**
 * Watches one factory of a parser or writer class: what it makes for an input registered in `pacedInputs`
 * (its first argument) gets that input's question; anything else is exactly what the library made. The
 * watch stays (it changes nothing for other calls), so calls that overlap never undo each other's.
 */
function watchFactory(owner: unknown, name: string): void {
  if ((typeof owner !== 'function' && typeof owner !== 'object') || owner === null) return;
  const record = owner as Record<string, unknown>;
  const original = record[name];
  if (typeof original !== 'function') return;
  const seen = watchedFactories.get(owner) ?? new Set<string>();
  if (seen.has(name)) return;
  seen.add(name);
  watchedFactories.set(owner, seen);
  record[name] = function watched(this: unknown, ...args: unknown[]): unknown {
    const made = (original as (...a: unknown[]) => unknown).apply(this, args);
    const input = args[0];
    const pacing = typeof input === 'object' && input !== null ? pacedInputs.get(input) : undefined;
    const waits = made as { shouldWaitForTick?: unknown } | null;
    if (pacing && waits && typeof waits.shouldWaitForTick === 'function') {
      waits.shouldWaitForTick = pacing((waits.shouldWaitForTick as WaitQuestion).bind(made));
    }
    return made;
  };
}

/**
 * `work`, one load or save of a pdf-lib-shaped library (`lib`, here @cantoo/pdf-lib: its load with a
 * password and its save rules cannot be rebuilt from outside, as loadPaced and savePaced rebuild pdf-lib's),
 * with the waits of every parser or writer it makes for `input` (the bytes it loads, or the context of the
 * document it saves) asked of the clock: one at least every `everyMs` of work. With `keepCount` the
 * library's own count still makes it wait too (a caller that asked for its own slices, such as Protect's
 * slices by size). Everything else is the library's own call, so the bytes are the same; if its insides are
 * not as expected, its waits stay as they were.
 */
export async function withClockWaits<T>(
  lib: unknown,
  input: object,
  work: () => Promise<T>,
  options: { keepCount?: boolean; everyMs?: number } = {},
): Promise<T> {
  const parts = (lib ?? {}) as { PDFParser?: unknown; PDFWriter?: unknown; PDFStreamWriter?: unknown };
  watchFactory(parts.PDFParser, 'forBytesWithOptions');
  for (const writer of [parts.PDFWriter, parts.PDFStreamWriter]) {
    watchFactory(writer, 'forContext');
    watchFactory(writer, 'forContextWithSnapshot');
  }
  const { keepCount = false, everyMs = TURN_AFTER_MS } = options;
  pacedInputs.set(input, (own) => {
    const clock = byTheClock(everyMs);
    if (!keepCount) return () => clock();
    return (n) => {
      const byCount = own(n); // the library's own count goes on as before
      const byClock = clock();
      return byCount || byClock;
    };
  });
  try {
    return await work();
  } finally {
    pacedInputs.delete(input);
  }
}
