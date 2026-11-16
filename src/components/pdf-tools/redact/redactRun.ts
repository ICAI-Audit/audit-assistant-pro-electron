// The Redact tool's run step (design 5.9; plan Task A9), on the step contract of toolStep.ts: one PDF
// in, one redacted copy out, or nothing.
//
// The review (the dialog) has decided what goes: `areas` (ticked places joined per page, and drawn
// boxes) and `targets` (the values chosen everywhere, which the check must not find). This step checks
// the options again, refuses before the slow work when the list cannot take the result, then draws each
// page to rebuild (rotation 0, at the chosen resolution), grows every text box past its ink, burns the
// boxes black, draws the replacements, encodes the picture and keeps the words that touch no box; builds
// the file (redactBuild.ts); and checks it (redactCheck.ts, and pdf.js reading it as a reader would),
// covering what is still found and building again, at most three times (redactRounds.ts). A value that
// cannot be covered ends the run: nothing is added, and the message names pages and places, never a value.
//
// Confidentiality: the options hold values (areas' keys, targets, the models' text, a masked or custom
// replacement) in memory for this call only. The record holds the twelve allowed counts and choices;
// messages hold numbers, page numbers and fixed words. Nothing is logged.
import { pageReadings, pageSeamPlaces, type MeasureChar, type PageTextModel } from '@/lib/pdf-tools/pageText';
import { buildRedacted } from '@/lib/pdf-tools/redactBuild';
import { checkHits, drawingPass, pageDrawingsAndVerdicts, readerGaveUp, structureProblems, targetMatcher, targetPass, type CheckTarget } from '@/lib/pdf-tools/redactCheck';
import { MAX_PLACES, tooManyPlaces } from '@/lib/pdf-tools/redactFind';
import { pacer, type Pace } from '@/lib/pdf-tools/pace';
import { keyOf, placesOfValue, type RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError, type OperationFlags, type OperationRecord, type SourceRef, type WorkingFile } from '@/lib/pdf-tools/types';
import * as renderer from '../pdfRenderer';
import { resolveResultName } from '../toolOptions';
import { onePdf, type Run, type ToolStep } from '../toolStep';
import { pictureFailed, type PictureCodecs } from './pageEncode';
import { canvasMeasure, rendererBusy, type FindReader } from './redactFindRun';
import { browserCodecs, canvasPainter, drawRebuiltPage, viewInk, type DrawChoices, type PageProof, type PageWork, type PixelRenderer, type TextPainter } from './redactPages';
import {
  DPI_CHOICES,
  estimateBytes,
  pagesInWords,
  redactRecord,
  replacementRecord,
  resultNotes,
  safeResultName,
  tokenError,
  WITHHELD_NAME,
  type RedactDpi,
  type RedactMode,
  type RedactOutput,
  type ReplacementStyle,
} from './redactRecord';
import { clusterRule, fromCheckHits, judgeInTurns, locatePlacesPaced, loosePlaces, makePlacer, proofCopies, proofInk, readerHits, redactInRounds, releaseClusterParts, unreadableTextAreas, wholeRunsIn, type FlattenInfo, type ProofCopies } from './redactRounds';
import { flaggedOperations, placeOperations, type TextOp } from './rendererView';
import { omitsHindi } from './redactView';
import type { RedactArea } from './reviewState';

/** Switched on (T-052): the toolbar offers Redact and runTool.ts runs its step. */
export const BUILT: boolean = true;

/** One chosen value's places in a text, by the find's own rule and by the check's looser net (every form of it). */
function spansOfTarget(target: CheckTarget, text: string): [number, number][] {
  return target.forms.flatMap((form) => [...placesOfValue(text, target.kind, keyOf(target.kind, form)), ...loosePlaces(text, target.kind, form)].map((p): [number, number] => [p.start, p.end]));
}

/** Where the chosen values stand in a text, all of them searched at once (the proof and the reader check ask this way). */
export function spansOf(targets: readonly CheckTarget[], text: string): [number, number][] {
  return targets.flatMap((t) => spansOfTarget(t, text));
}

/**
 * `spansOf`, one chosen value at a time, with a chance of a turn for the window before each (`pace` gives one when
 * its time has come, and throws on Stop): the same places in the same order. With about 200 values ticked on a
 * register page, the search made at once held the window 1.2 to 1.7 s (final pass, F1).
 */
export async function spansInTurns(targets: readonly CheckTarget[], text: string, pace: Pace): Promise<[number, number][]> {
  const out: [number, number][] = [];
  for (const target of targets) {
    const turn = pace();
    if (turn) await turn;
    out.push(...spansOfTarget(target, text));
  }
  return out;
}

/**
 * `judgeInTurns` with every `spans` answer made in turns: the judge is first given no places for a text it has no
 * answer for yet, those texts are then searched in turns and their answers kept in `memo`, and the judge runs again
 * until it asked for nothing new. Its verdict is the one it gives with every answer known.
 */
export async function judgeWithSpansInTurns<J>(
  judge: (holds: (text: string) => boolean, spans: (text: string) => [number, number][]) => J,
  answers: { holds: (text: string) => boolean; spansInTurns: (text: string) => Promise<[number, number][]> },
  pace: Pace,
  memo: { holds: Map<string, boolean>; spans: Map<string, [number, number][]> },
): Promise<J> {
  for (;;) {
    const asked = new Set<string>();
    const later = (text: string): [number, number][] => {
      asked.add(text);
      return [];
    };
    const verdict = await judgeInTurns(judge, { holds: answers.holds, spans: later }, pace, memo);
    if (asked.size === 0) return verdict;
    // judgeInTurns kept the empty answers; the real ones take their place before the judge runs again.
    for (const text of asked) memo.spans.set(text, await answers.spansInTurns(text));
  }
}

/** What the Redact dialog passes to run.start. Holds values: in memory only, never recorded or logged. */
export interface RedactRunOptions {
  /** The working-list file the review was made for: the step refuses any other. */
  fileId: string;
  /** What to remove (reviewState.ts areasToRedact). */
  areas: RedactArea[];
  /** The find's page text models, one per page (index = page). */
  models: PageTextModel[];
  /** What the check must not find (reviewState.ts checkTargets; `placedNowhere`: a typed word the find placed nowhere, ruling R). */
  targets: (CheckTarget & { placedNowhere?: boolean })[];
  mode: RedactMode;
  replacement: { style: ReplacementStyle; token: string };
  output: RedactOutput;
  dpi: RedactDpi;
  /** Ticked places plus drawn boxes by kind (confirmSummary.countsByKind). */
  counts: Partial<Record<RedactKind, number>>;
  /** Ticked places (the limit counts them). */
  ticked: number;
  /** Values ticked in some places and left visible in others. */
  valuesLeftVisible: number;
  autoBoxesDropped: number;
  /**
   * Asked when the check finds a value that is not drawn on a page and no box can cover (lead ruling E),
   * or a page to rebuild may show one Redact cannot place (`info.mayShow`, end-to-end review B5).
   */
  confirmFlatten?: (pages: number[], info?: FlattenInfo) => Promise<boolean>;
  /** The result's name; when it (or the usual one) holds a chosen value, "Redacted document.pdf" is used (B6). */
  name?: string;
}

/** Ruling S (wave 5): how much text (characters) the run keeps answers for whether it holds a chosen value. */
const HOLDS_MEMO_CHARS = 8_000_000;

/** A neutral word for a step's text in the record that held a chosen value (the record never holds one). */
const WITHHELD_TEXT = '(withheld: it held redacted text)';

/**
 * The record of `file` with every name or text that holds a chosen value replaced by a neutral one
 * (end-to-end review B6, lead's ruling): its sources, the files the earlier steps started from, and
 * those steps' result names, summaries and options. The run's own summary and options hold counts and
 * fixed words only.
 */
export function withheldRecord(file: WorkingFile, holds: (text: string) => boolean): WorkingFile {
  const operation = file.operation;
  if (!operation) return file;
  const source = (ref: SourceRef): SourceRef => (holds(ref.name) ? { ...ref, name: WITHHELD_NAME } : ref);
  const options = (o: Record<string, string | number | boolean>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && holds(v) ? WITHHELD_TEXT : v]));
  const record: OperationRecord = { ...operation, sources: operation.sources.map(source) };
  if (operation.originalSources) record.originalSources = operation.originalSources.map(source);
  if (operation.earlier) {
    record.earlier = operation.earlier.map((step) => ({
      ...step,
      resultName: holds(step.resultName) ? WITHHELD_NAME : step.resultName,
      summary: holds(step.summary) ? WITHHELD_TEXT : step.summary,
      options: options(step.options),
    }));
  }
  return { ...file, operation: record };
}

/** What the step needs from the application (pdfRenderer.ts, canvases); pdf.js in Node in the tests. */
export interface RedactEnv {
  renderer: FindReader & PixelRenderer;
  codecs: () => PictureCodecs;
  painter: () => TextPainter;
  measure: MeasureChar;
  /** Silence that ends a run (STALL_MS); smaller only in the tests. */
  stallMs?: number;
}

// ---- silence (wave 2b): a run never waits for ever ----

/**
 * How long a run may go without any sign of work (progress, a page drawn or read, a step finished) before it
 * ends. Counted in active time only (silenceWatch): a machine asleep or a window whose timers are throttled
 * is not silence. A page drawn at 300 dpi takes seconds; the slowest step reports progress every 50 ms.
 */
export const STALL_MS = 120_000;

/** The run went silent for STALL_MS of active time: it ends with this, and nothing is added. */
export const stalled = () =>
  new PdfToolsError('render-failed', 'Redact stopped because a page took too long to draw or read. Nothing was added. Try again; if it happens again, restart the application.');

/** A run's watch on silence (`silenceWatch`). */
export interface SilenceWatch {
  /** Aborted by the user's Stop (its reason) or by a stall (`stalled()`). */
  readonly signal: AbortSignal;
  /** The stall, once there is one. */
  readonly error: PdfToolsError | null;
  /** A sign of work: the silence starts again. */
  touch(): void;
  /** `work`, or the stall if it comes first; settling is a sign of work. */
  race<T>(work: Promise<T>): Promise<T>;
  /** Waiting for the user (a question): never silence. */
  hold<T>(wait: () => Promise<T>): Promise<T>;
  stop(): void;
}

/**
 * Watches a run for silence: after `limitMs` of active time without `touch`, it aborts `signal` and every
 * `race` rejects with `stalled()`. Active time is counted by a ticking timer: a gap between two ticks longer
 * than three ticks (the machine slept, a hidden window's timers were throttled, or the thread was busy)
 * counts as one tick, so none of these reads as a stall (the 30-minute "hang" of 15 November was the
 * machine asleep: wave 2b).
 */
export function silenceWatch(limitMs: number, outer: AbortSignal, now: () => number = () => performance.now()): SilenceWatch {
  const tick = Math.max(5, Math.min(1000, Math.floor(limitMs / 20)));
  const controller = new AbortController();
  let quiet = 0;
  let last = now();
  let held = 0;
  let error: PdfToolsError | null = null;
  const onOuter = () => controller.abort(outer.reason);
  if (outer.aborted) onOuter();
  else outer.addEventListener('abort', onOuter, { once: true });
  const timer = setInterval(() => {
    const t = now();
    const gap = t - last;
    last = t;
    if (held > 0 || error) return;
    quiet += gap > 3 * tick ? tick : Math.max(0, gap);
    if (quiet < limitMs) return;
    clearInterval(timer);
    error = stalled();
    controller.abort(error);
  }, tick);
  const touch = () => {
    quiet = 0;
  };
  return {
    signal: controller.signal,
    get error() {
      return error;
    },
    touch,
    // Not Promise.race against one long-lived promise: each race would leave a reaction on it holding its
    // settled result (a page's pixels) until the run ends (wave 3, ruling E: memory grew by a page a drawing).
    race: <T>(work: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        if (error) {
          reject(error);
          return;
        }
        const onStall = () => {
          if (error) reject(error);
        };
        controller.signal.addEventListener('abort', onStall);
        work.then(
          (value) => {
            controller.signal.removeEventListener('abort', onStall);
            touch();
            resolve(value);
          },
          (reason: unknown) => {
            controller.signal.removeEventListener('abort', onStall);
            touch();
            reject(reason);
          },
        );
      }),
    hold: async <T>(wait: () => Promise<T>) => {
      held++;
      try {
        return await wait();
      } finally {
        held--;
        touch();
      }
    },
    stop: () => {
      clearInterval(timer);
      outer.removeEventListener('abort', onOuter);
    },
  };
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * The renderer as the run uses it: every call raced against the watch, and a drawing that fails (a pdf.js
 * worker gone, a canvas refused) ends the run with the fixed sentence instead of the library's words.
 */
function watchedRenderer(env: RedactEnv, watch: SilenceWatch): RedactEnv['renderer'] {
  const r = env.renderer;
  return {
    pageTextContent: (file, page, options) => watch.race(r.pageTextContent(file, page, options)),
    pageGeometries: (file, options) => watch.race(r.pageGeometries(file, options)),
    pageAnnotationTexts: (file, page, options) => watch.race(r.pageAnnotationTexts(file, page, options)),
    renderPagePixels: (file, page, scale, options) =>
      watch.race(
        (async () => {
          // Wave 6 (T-052): a drawing the busy renderer could not finish (out of time, or restarted under it) is tried
          // again; if it still cannot, the run says the computer was busy, never that the page could not be drawn.
          for (let attempt = 0; ; attempt++) {
            try {
              return await r.renderPagePixels(file, page, scale, options);
            } catch (error) {
              if (options?.signal?.aborted || isAbort(error)) throw error;
              if (rendererBusy(error)) {
                if (attempt < DRAW_RETRIES) {
                  watch.touch();
                  await new Promise((resolve) => setTimeout(resolve, 250));
                  continue;
                }
                throw runBusy();
              }
              if (error instanceof PdfToolsError) throw error;
              throw pictureFailed();
            }
          }
        })(),
      ),
  };
}

/** Wave 6 (T-052): how many times a drawing the busy renderer could not finish is tried again. */
const DRAW_RETRIES = 2;

/** Wave 6 (T-052): the renderer stayed too busy to draw a page: nothing is added, and the file is not to blame. */
export const runBusy = () => new PdfToolsError('render-failed', 'The computer was too busy to finish. Nothing was added. Close other programs, then try again.');

const appEnv: RedactEnv = {
  renderer: {
    pageTextContent: (file, page, options) => renderer.pageTextContent(file, page, { ...options, priority: 'run' }),
    pageGeometries: (file, options) => renderer.pageGeometries(file, { ...options, priority: 'run' }),
    pageAnnotationTexts: (file, page, options) => renderer.pageAnnotationTexts(file, page, { ...options, priority: 'run' }),
    renderPagePixels: (file, page, scale, options) => renderer.renderPagePixels(file, page, scale, { ...options, priority: 'run' }),
  },
  codecs: browserCodecs,
  painter: canvasPainter,
  measure: canvasMeasure,
};

const invalid = (message: string) => new PdfToolsError('wrong-input', `${message} Nothing was added.`);

/** The step's own checks of what the dialog passed (a dialog's checks are a convenience; these are the rule). */
export function checkRedactOptions(options: RedactRunOptions, pageCount: number): void {
  if (!['remove', 'replace'].includes(options.mode)) throw invalid('Choose Remove or Replace.');
  if (!['token', 'label', 'masked'].includes(options.replacement?.style)) throw invalid('Choose what replaces the text.');
  if (!['searchable', 'picture'].includes(options.output)) throw invalid('Choose Searchable or Picture only.');
  if (!DPI_CHOICES.includes(options.dpi)) throw invalid('Choose 150, 200 or 300 dpi.');
  if (options.mode === 'replace' && options.replacement.style === 'token') {
    const problem = tokenError(options.replacement.token ?? '');
    if (problem) throw invalid(problem);
  }
  if (!Array.isArray(options.areas) || options.areas.length === 0) throw new PdfToolsError('redact-nothing-chosen', 'Tick or draw at least one area to redact.');
  if (options.ticked > MAX_PLACES) throw tooManyPlaces(options.ticked);
  if (!Array.isArray(options.models) || options.models.length !== pageCount || options.models.some((m, i) => m?.pageIndex !== i)) {
    throw invalid('The review does not match this file. Close Redact and open it again.');
  }
  for (const area of options.areas) {
    if (!Number.isInteger(area.page) || area.page < 0 || area.page >= pageCount) throw invalid('The review does not match this file. Close Redact and open it again.');
  }
}

/**
 * Every step's Stop and change of scope; a library's own failure is re-thrown as it is unless the run moved on.
 * With a watch: the step is raced against silence, and a stall ends the run with its own sentence.
 */
async function guarded<T>(run: Run, work: () => Promise<T>, watch?: SilenceWatch): Promise<T> {
  try {
    const value = await (watch ? watch.race(work()) : work());
    run.check();
    return value;
  } catch (error) {
    run.check();
    if (watch?.error) throw watch.error;
    throw error;
  }
}

export function makeStep(env: RedactEnv): ToolStep<RedactRunOptions> {
  return async (run, inputs, options) => {
    const source = onePdf(inputs);
    if (source.id !== options.fileId) throw invalid('The review was made for another file. Close Redact and open it again.');
    checkRedactOptions(options, source.pageCount);

    // The pages to rebuild and what goes on each.
    const initial = new Map<number, PageWork>();
    for (const area of options.areas) {
      const work = initial.get(area.page) ?? { page: area.page, model: options.models[area.page], areas: [] };
      initial.set(area.page, { ...work, areas: [...work.areas, area] });
    }
    const pages = [...initial.keys()];
    const withoutText = pages.filter((p) => !/\S/.test(options.models[p]?.text ?? '')).length;
    const chars = pages.reduce((n, p) => n + (options.models[p]?.text ?? '').replace(/\s/g, '').length, 0);
    // The rebuilt pages, plus the copied ones (about the source's size): refuse now if the list cannot take it.
    run.ensureRoom(estimateBytes(pages.length - withoutText, withoutText, options.dpi, chars) + source.size, 'The redacted file');

    const choices: DrawChoices = { mode: options.mode, replacement: { style: options.replacement.style, token: options.replacement.token ?? '' }, output: options.output, dpi: options.dpi };
    const codecs = env.codecs();
    const painter = env.painter();
    const holds = targetPass(options.targets);
    // Ruling S (wave 5): the same texts are asked again and again (the proof's copies asked 106,000 times on H33's
    // two pages): each answer is kept for the run (and dropped with it), up to about 8 million characters of text.
    const known = new Map<string, boolean>();
    let knownChars = 0;
    const has = (text: string) => {
      const kept = known.get(text);
      if (kept !== undefined) return kept;
      const answer = holds(text) !== null;
      if (knownChars + text.length > HOLDS_MEMO_CHARS) {
        known.clear();
        knownChars = 0;
      }
      known.set(text, answer);
      knownChars += text.length;
      return answer;
    };
    const matches = targetMatcher(options.targets);
    let replacementsNotFitted = 0;
    let boxesWidened = 0;
    let checkLabel = 'Checking…';
    // Wave 2b: the run never waits for ever. Every step and every drawing or reading is raced against
    // silence (silenceWatch, STALL_MS of active time); its signal is the user's Stop or a stall.
    const watch = silenceWatch(env.stallMs ?? STALL_MS, run.ctx.signal);
    const signal = watch.signal;
    const drawer = watchedRenderer(env, watch);
    const guard = <T>(work: () => Promise<T>) => guarded(run, work, watch);
    // Ruling D (wave 3b): work that waits for nothing (the proof's reading of every stream, the net, the reader
    // check of copied pages) gives the window a turn once 50 ms have passed since its last one (pace.ts).
    const pace = pacer(() => {
      watch.touch();
      run.check();
    });
    // R2's check yields through this (every 50 ms of its work): the bar moves, the window stays
    // responsive, and a Stop ends it there.
    const onProgress = async (done: number, total: number) => {
      watch.touch();
      run.progress(done, total, checkLabel);
      await run.deps.yieldToUi();
      run.check();
    };

    let outcome: Awaited<ReturnType<typeof redactInRounds>>;
    try {
      await run.slowStep('Preparing the pages…');
      // B1: the source, checked once before anything is drawn, for what the pages to rebuild draw.
      checkLabel = 'Looking through the file…';
      const sourceHits = fromCheckHits(await guard(() => checkHits(source.bytes, options.targets, new Set(), { signal, onProgress })));
      // The proof (wave 2, rulings 1 and 2): pdf-lib's copy with what holds a chosen value made invisible,
      // so that what every rebuilt page draws can be proved, drawing by drawing. A drawn hit of the strings
      // check that the proof does not find again is covered whole there. A file pdf-lib cannot read is not
      // redacted: the picture must be made from what was checked.
      const mustCut = new Set(sourceHits.filter((h) => h.drawn && h.object).map((h) => h.object!));
      const spans = (text: string): [number, number][] => spansOf(options.targets, text);
      // RX-LIB's per-drawing reading (rx2-contract.md (b)) of every page, since any page may come to be
      // rebuilt: each drawing that holds a value (drawingPass) or cannot be read goes into the proof. The same
      // read gives each page's copy verdict (wave 4, ruling M): a page off the allow-list is never copied.
      const drawingHolds = drawingPass(options.targets);
      const read = await guard(() => pageDrawingsAndVerdicts(source.bytes, Array.from({ length: source.pageCount }, (_, i) => i), { signal, onProgress }));
      const unsafeToCopy = new Set(read.verdicts.filter((v) => !v.plain).map((v) => v.page));
      const drawings = read.drawings
        .map((d) => ({ page: d.page, kind: d.kind, source: d.source, unreadable: d.unreadable, holds: d.text !== undefined && drawingHolds(d) !== null, gaveUp: readerGaveUp(d) }))
        .filter((d) => d.holds || d.unreadable !== undefined);
      // K1 (wave 4): a glyph with no letter of its own inside a word of a script no chosen value uses is not covered.
      // Ruling R (wave 5): on a page whose unreadable text is of a script whose typed value the find placed nowhere,
      // K1 does not apply at all: what cannot be read there is covered whole, as in round 3 (`whole`).
      const forms = options.targets.flatMap((t) => t.forms);
      const rule = clusterRule(forms, options.targets.filter((t) => t.placedNowhere).flatMap((t) => t.forms));
      const whole = new Set(rule.whole.size > 0 ? options.models.flatMap((m, page) => (m && wholeRunsIn(m.text, rule) ? [page] : [])) : []);
      const noLetter = (page: number) => (whole.has(page) ? 0 : [...(options.models[page]?.text ?? '')].filter((c) => c === '\u0000').length);
      let copies: ProofCopies;
      try {
        copies = await guard(() => proofCopies(source.bytes, { holds: has, spans, mustCut, drawings, pace, noLetter }));
      } catch (error) {
        run.check();
        if (error instanceof PdfToolsError) throw error;
        throw new PdfToolsError('redact-check-failed', 'Some pages could not be read with certainty, so parts of the redacted pages may still be inside the file. Nothing was added. Print the file to a new PDF and redact that copy.');
      }
      const proof: PageProof = { base: copies.base, cut: copies.cut, pages: new Set([...copies.valuePages, ...copies.unreadablePages]), unreadable: copies.unreadablePages, unplaced: copies.unplacedPages };
      // The renderer's own reading (wave 3, ruling A): which operations pdf.js draws that hold a chosen value
      // or cannot be read; the union with the file reading above is the proof's (a disagreement is never clean).
      // Ruling L (wave 4, RX-VIEW): the chosen values' forms, for what an unplaced operation holds (L3), and every page's
      // operations placed by pixels at 72 dpi before they are judged (L1, L2). K1: cluster glyphs that cannot be part of
      // a chosen value are not flagged (releaseClusterParts).
      // Ruling S (wave 5): the judge runs in turns (judgeInTurns), with what it worked out kept for the page's next judging.
      const judgeMemo = { page: -1, memo: { holds: new Map<string, boolean>(), spans: new Map<string, [number, number][]>() } };
      const judge = async (ops: TextOp[], _pxPerPt: number, page: number) => {
        if (judgeMemo.page !== page) judgeMemo.memo = { holds: new Map(), spans: new Map() };
        judgeMemo.page = page;
        const judged = await judgeWithSpansInTurns((h, s) => flaggedOperations(ops, h, s, undefined, forms), { holds: has, spansInTurns: (text) => spansInTurns(options.targets, text, pace) }, pace, judgeMemo.memo);
        return whole.has(page) ? judged : releaseClusterParts(judged, ops, options.models[page], env.measure, rule);
      };
      const placeOps = async (ops: TextOp[], file: Uint8Array, page: number, into: { transform: number[]; width: number; height: number; scale: number }) => {
        const turn = async () => {
          watch.touch();
          await run.deps.yieldToUi();
          run.check();
        };
        const glance = into.scale === 1 ? (into as unknown as { data: Uint8ClampedArray; width: number; height: number; transform: number[] }) : undefined;
        return (await placeOperations(ops, (skip) => drawer.renderPagePixels(file, page, 1, { signal, ...(skip ? { skip } : {}) }), { into, values: forms, tick: turn, ...(glance ? { full: glance } : {}) })).ops;
      };
      const place = makePlacer({ renderer: drawer, holds: has, scale: options.dpi / 72, signal, pace });
      const located = new Map<number, RedactArea[]>();
      // J (wave 4): the places on the pages to rebuild are worked out now, with turns for the window between the
      // chosen values (a page of a statement with many of them held it 0.4 s); the rounds reuse them.
      for (const page of new Set([...initial.keys(), ...unsafeToCopy])) {
        const model = options.models[page];
        if (model) located.set(page, await guard(() => locatePlacesPaced(model, options.targets, env.measure, { prev: options.models[page - 1], next: options.models[page + 1] }, pace)));
      }
      const confirmFlatten = options.confirmFlatten;
      outcome = await redactInRounds(initial, {
        async draw(work) {
          const pause = async () => {
            watch.touch();
            await run.deps.yieldToUi();
            run.check();
          };
          const drawn = await guard(() => drawRebuiltPage(source.bytes, work, choices, { renderer: drawer, codecs, painter, measure: env.measure, signal, proof, pause, judge, pace, place: placeOps }));
          await run.deps.yieldToUi();
          run.check();
          return drawn;
        },
        async build(rebuilt) {
          try {
            return await guard(() =>
              buildRedacted(source.bytes, rebuilt, {
                titleHasValue: matches,
                onPage: async (done, total) => {
                  watch.touch();
                  if (done % Math.max(1, Math.ceil(total / 50)) !== 0 && done !== total) return;
                  run.progress(done, total, 'Putting the redacted file together…');
                  await run.deps.yieldToUi();
                  run.check();
                },
              }),
            );
          } catch (error) {
            // pdf-lib overflows the stack copying the pages of a page tree whose node is its own parent (it climbs
            // /Parent without end): the file is damaged, and the user gets the plain refusal Organise gives (FIX-A2).
            if (error instanceof RangeError && /call stack/i.test(error.message)) throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
            // The build refuses a page it cannot take with a RangeError (its own check of the pictures):
            // the user gets the fixed sentence, never the library's words (end-to-end review, non-blocking 4).
            if (error instanceof RangeError) throw pictureFailed();
            throw error;
          }
        },
        async check(bytes, rebuilt) {
          const structure = await guard(() => structureProblems(bytes, [...rebuilt], { signal, onProgress }));
          const lib = fromCheckHits(await guard(() => checkHits(bytes, options.targets, rebuilt, { signal, onProgress })));
          const reader = await guard(() => readerHits(bytes, source.pageCount, rebuilt, options.models, has, drawer, signal, (text) => spans(text).map(([start, end]) => ({ start, end })), pace));
          return { hits: [...lib, ...reader], structure };
        },
        source: { bytes: source.bytes, hits: async () => sourceHits },
        place: (bytes, page, hit) => guard(() => place(bytes, page, hit)),
        // A copied page whose drawing holds a value, or one the reader gave up on (ruling B, readerGaveUp), is
        // boxed and rebuilt; one whose only unreadable text is in a real font with no usable map (bullets) is copied.
        proof: { pages: new Set([...copies.valuePages, ...copies.gaveUpPages]), held: copies.valuePages, ink: (page) => guard(() => proofInk(drawer, copies, page, options.dpi / 72, signal, pace)), mayShow: copies.mayShowPages, unplaced: copies.unplacedPages },
        view: {
          pageCount: source.pageCount,
          ink: (page) => guard(() => viewInk(drawer, source.bytes, page, options.dpi / 72, judge, signal, pace, placeOps)),
        },
        // Ruling C: a value that runs on across a page turn is boxed on both pages (pageSeamPlaces).
        locate: async (page) => {
          // The same for every round: worked out once a page (every reading and both page turns). Ruling S (wave 5): a
          // page the check names later is worked out in turns too (H33's second page held the window 0.8 s here).
          let areas = located.get(page);
          const model = options.models[page];
          if (!areas) located.set(page, (areas = model ? await guard(() => locatePlacesPaced(model, options.targets, env.measure, { prev: options.models[page - 1], next: options.models[page + 1] }, pace)) : []));
          return areas;
        },
        turn: pace,
        unreadableText: (page) => (options.models[page] ? unreadableTextAreas(options.models[page], env.measure, whole.has(page) ? undefined : rule) : []),
        unsafeToCopy,
        // Ruling P: whether the page as pdf.js shows it (the find's reading, and across each page turn) holds a chosen value.
        shows: (page) => {
          const model = options.models[page];
          if (!model || model.text === '') return false;
          const places = (text: string) => spans(text).map(([start, end]) => ({ start, end }));
          if (pageReadings(model).some((r) => r.text !== '' && has(r.text))) return true;
          const [prev, next] = [options.models[page - 1], options.models[page + 1]];
          return (prev !== undefined && prev.text !== '' && pageSeamPlaces(prev, model, places).length > 0) || (next !== undefined && next.text !== '' && pageSeamPlaces(model, next, places).length > 0);
        },
        model: (page) => options.models[page],
        // Waiting for the user's answer is never silence.
        ...(confirmFlatten ? { confirmFlatten: (pages: number[], info: FlattenInfo) => watch.hold(() => confirmFlatten(pages, info)) } : {}),
        onStage(stage, build, done, total) {
          watch.touch();
          if (stage === 'drawing') run.progress(done ?? 0, total ?? 0, `${build === 1 ? 'Drawing' : 'Drawing again'} page ${(done ?? 0) + 1} of ${total ?? 0}…`);
          else if (stage === 'checking') {
            checkLabel = build === 0 ? 'Looking through the file…' : build === 1 ? 'Checking…' : `Checking again (round ${build})…`;
            run.progress(0, 0, checkLabel);
          }
        },
        checkpoint: () => {
          run.check();
          if (watch.error) throw watch.error;
        },
      });
    } finally {
      watch.stop();
    }
    const coveredMore: number[] = [];
    const coveredWhole: number[] = [];
    // Ruling R (wave 5): pages where only glyphs with no letter of their own were covered, one by one (never "covered whole").
    const coveredLetters: number[] = [];
    const hiddenText: number[] = [];
    for (const [index, page] of outcome.drawn) {
      replacementsNotFitted += page.replacementsNotFitted;
      boxesWidened += page.boxesWidened;
      if (page.coveredMore > 0) (page.unreadable ? coveredWhole : page.unreadableLetters ? coveredLetters : coveredMore).push(index);
      if (page.hiddenTextOnly) hiddenText.push(index);
    }
    for (const page of outcome.pagesUnreadableText) if (!coveredWhole.includes(page)) coveredWhole.push(page);
    for (const page of outcome.pagesUnreadableLetters) if (!coveredLetters.includes(page)) coveredLetters.push(page);
    // Ruling M: a page made a picture only because it could not be copied safely, with no other sentence about it.
    const said = new Set([...outcome.pagesBoxedByCheck, ...coveredMore, ...coveredWhole, ...coveredLetters]);
    const madePictures = outcome.pagesNotCopied.filter((page) => !said.has(page));
    const { report } = outcome;
    // A copied page whose resources were kept whole may still carry what a rebuilt page drew with (its
    // original picture): the check cannot read pixels, so this result is not verified.
    if (report.sharedResourcesKept) {
      throw new PdfToolsError(
        'redact-check-failed',
        'Some pages could not be read with certainty, so parts of the redacted pages may still be inside the file. Nothing was added. Print the file to a new PDF and redact that copy.',
      );
    }

    const output = options.output;
    const addedByCheck = [...outcome.pagesBoxedByCheck, ...outcome.pagesFlattened];
    const record = redactRecord({
      // K3 (wave 4): what a person sees, as the confirmation counted it (places at the same spot once); else the places.
      areas: Object.values(options.counts).reduce((n, c) => n + (c ?? 0), 0) || options.areas.reduce((n, a) => n + (a.kind === 'drawn' ? 1 : 0), 0) + options.ticked,
      pagesWithAreas: pages.length,
      pagesRebuilt: outcome.drawn.size,
      pagesRebuiltHidden: addedByCheck.length,
      pagesFlattened: outcome.pagesFlattened.length,
      counts: options.counts,
      mode: options.mode,
      replacement: replacementRecord(options.mode, options.replacement.style, options.replacement.token ?? ''),
      output,
      dpi: options.dpi,
      valuesLeftVisible: options.valuesLeftVisible,
      textLayerCharsOmitted: output === 'searchable' ? report.textLayerCharsOmitted : 0,
      autoBoxesDropped: options.autoBoxesDropped,
      bookmarksRemoved: report.bookmarksRemoved,
    });
    const flags: OperationFlags = {};
    if (options.valuesLeftVisible > 0) flags.redactedValuesLeftVisible = true;
    if (output === 'searchable' && report.textLayerCharsOmitted > 0) flags.textLayerIncomplete = true;
    // B6: a name that would show a chosen value (Form 16, 26AS and ITR-V files are named with the PAN)
    // is replaced, and the dialog says so before the run; the record keeps no such name either.
    // The check's own matcher, the one loose rule: it also holds a typed name run together in a file name
    // (RameshKumarGupta_Form16.pdf; wave 2, R8 and ruling 4).
    const name = safeResultName(resolveResultName(options.name ?? '', defaultResultName('redact', source.name), 'pdf'), matches);
    const file = withheldRecord(await run.pdfResult(name, outcome.bytes, source.pageCount, [source], record, { flags, report: { bookmarksDropped: report.bookmarksDropped } }), matches);

    const notes = resultNotes({
      pagesRebuiltHidden: outcome.pagesBoxedByCheck,
      pagesFlattened: outcome.pagesFlattened,
      replacementsNotFitted,
      boxesWidened,
      textLayerCharsOmitted: report.textLayerCharsOmitted,
      autoBoxesDropped: options.autoBoxesDropped,
      valuesLeftVisible: options.valuesLeftVisible,
      bookmarksRemoved: report.bookmarksRemoved,
      output,
      pagesCoveredMore: coveredMore,
      pagesCoveredWhole: coveredWhole,
      pagesCoveredLetters: coveredLetters.sort((a, b) => a - b),
      pagesMadePictures: madePictures,
      pagesHiddenTextOnly: hiddenText.sort((a, b) => a - b),
      // Ruling R: the searchable note names Hindi only where the redacted pages' text has Devanagari.
      omittedHindi: omitsHindi([...outcome.drawn.keys()].map((page) => options.models[page]?.text ?? '')),
    });
    const areas = Number(record.options.areas);
    // "That page" / "those pages" are the pages just named; a page the check added has its own note.
    const done = `${areas} ${areas === 1 ? 'area' : 'areas'} removed on ${pagesInWords(pages)}; ${pages.length === 1 ? 'that page is now a picture' : 'those pages are now pictures'}${output === 'searchable' ? ' with searchable text' : ''}.`;
    const signed = file.signatureInvalid ? ['The digital signature is not valid in this copy; the signed original is unchanged.'] : [];
    return {
      files: [file],
      describe: ([made]) => ({
        message: `Redacted: ${made.name}`,
        detail: [done, 'The original stays in the list, unchanged.', ...notes, ...signed].join(' '),
        tone: notes.length > 0 || signed.length > 0 ? 'warning' : 'success',
      }),
    };
  };
}

export const step: ToolStep<RedactRunOptions> = makeStep(appEnv);

