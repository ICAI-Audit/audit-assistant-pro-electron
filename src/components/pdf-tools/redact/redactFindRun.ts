// Redact's find (design 5.9 "What is searched", "Every occurrence"; Task A9): the file's text read
// through the page renderer, page by page, with progress and Stop, then proposals for the review.
//
// The text is read from an enlarged-view copy of the file (no crop box, so pdf.js keeps text placed
// outside the visible page); each page's visible box and turn come from the file itself. The models and
// the annotation texts are kept, so a typed term added in the review searches them again at once
// (findInModels) without reading the file again.
//
// Confidentiality: the models, proposals and held places hold the file's text in memory, for the
// dialog only. Nothing here logs, stores or names any of it; errors are fixed sentences.
import { PDFDict, PDFName, type PDFDocument } from 'pdf-lib';
import { loadPaced, isStop, savePaced } from '@/lib/pdf-tools/pace';
import { buildPageText, ENLARGED_BOX, FALLBACK_FAMILY, pageHasText, type FontStyleLike, type MeasureChar, type PageTextModel, type TextItemLike } from '@/lib/pdf-tools/pageText';
import { dropPageSizedBoxes, everyOccurrence, findOnPage, holdPlaces, typedAcrossTurn, type AnnotationText, type HeldHit, type HeldStore, type Proposal } from '@/lib/pdf-tools/redactFind';
import { REDACT_GROUPS, type RedactGroup, type Term } from '@/lib/pdf-tools/redactPatterns';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES } from '@/lib/pdf-tools/types';

/** The page renderer's reading functions the find uses (pdfRenderer.ts; pdf.js in Node in the tests). */
export interface FindReader {
  pageTextContent(file: Uint8Array, pageIndex: number, options?: { signal?: AbortSignal }): Promise<{ items: TextItemLike[]; styles: Record<string, FontStyleLike> }>;
  pageGeometries(file: Uint8Array, options?: { signal?: AbortSignal }): Promise<{ view: [number, number, number, number]; rotate: number; userUnit: number }[]>;
  pageAnnotationTexts(file: Uint8Array, pageIndex: number, options?: { signal?: AbortSignal }): Promise<AnnotationText[]>;
}

/** Every kind is searched; the profile decides only what is ticked (R1 report, "What the run passes"). Every group the patterns know (RX-PAT widened them, T-052). */
export const ALL_GROUPS: ReadonlySet<RedactGroup> = new Set<RedactGroup>(REDACT_GROUPS);

export interface FindProgress {
  done: number;
  total: number;
}

/** The find was stopped (Stop, or the dialog closed): nothing is shown. */
export class FindStopped extends Error {
  constructor() {
    super('stopped');
    this.name = 'FindStopped';
  }
}

export const findFailed = () => new PdfToolsError('redact-find-failed', PHASE_TWO_ERROR_MESSAGES['redact-find-failed'] ?? 'The file could not be searched. It may be damaged.');

/** What the find read of the file: kept for the review, the run and a search for a new term. */
export interface FileText {
  /** One per page, in page order (0-based `pageIndex`). */
  models: PageTextModel[];
  /** The texts of each page's comments, fields and links, by page. */
  annotations: AnnotationText[][];
  /** Each page's visible box, turn and unit, from the file itself. */
  geometries: { view: [number, number, number, number]; rotate: number; userUnit: number }[];
  /** 0-based pages in which pdf.js found no text (scans): only drawn boxes remove anything there. */
  pagesWithoutText: number[];
}

export interface FindResult {
  /** The places to show and tick (every occurrence included, page-sized automatic boxes left out). */
  proposals: Proposal[];
  /** Possibles no profile ticks, held compactly (shown by kind with counts; built on demand). */
  held: HeldStore;
  /** Automatic boxes left out by the 95% rule. */
  autoBoxesDropped: number;
}

interface ReadOptions {
  reader: FindReader;
  signal: AbortSignal;
  /** False once the dialog's scope has moved on (engagement, user, session): the find stops quietly. */
  live: () => boolean;
  onProgress: (p: FindProgress) => void;
  /** Wave 6 (T-052): a turn for the window (the dialog's yield); absent, the work runs without turns (tests). */
  pause?: Pause;
  /** How long work may hold the window before it gives a turn (TURN_MS; tests pass 0 to count every chance). */
  turnEveryMs?: number;
}

function stopIfDone(options: Pick<ReadOptions, 'signal' | 'live'>): void {
  if (options.signal.aborted || !options.live()) throw new FindStopped();
}

/** Wave 6 (T-052): how long the find's own loops may hold the window before they give it a turn. */
export const TURN_MS = 40;

/**
 * Wave 6 (T-052): a gate on `pause` by the clock: it gives a turn only once `everyMs` have passed since the last
 * one, so a loop can ask at every step and a quick file is not slowed. Undefined when no turn is due.
 */
export function turnsEvery(pause: Pause, everyMs: number = TURN_MS): () => Promise<void> | undefined {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let last = now();
  return () => {
    if (now() - last < everyMs) return undefined;
    return pause().then(() => {
      last = now();
    });
  };
}

/** Wave 6 (T-052): the renderer ran out of time or had to restart; the machine was busy, the file is not to blame. */
export const findBusy = () => new PdfToolsError('redact-find-failed', 'The computer was too busy to search this file. Close other programs, then search again.');

/** Wave 6 (T-052): how many times a read the busy renderer could not finish is tried again before the find stops. */
const BUSY_RETRIES = 2;

/** The renderer's own "out of time" or "had to restart": a busy machine, not a damaged file. */
export function rendererBusy(error: unknown): boolean {
  return (error instanceof Error && error.name === 'RenderTimeoutError') || (error instanceof PdfToolsError && error.code === RENDERER_RESTARTED_CODE);
}
/** pdfRenderer.ts RENDERER_RESTARTED (not imported: this module does not load the renderer). */
const RENDERER_RESTARTED_CODE = 'renderer-restarted';

/**
 * Wave 6 (T-052): the enlarged-view copy (pageText.ts enlargedViewCopy, the same steps and the same bytes) read and
 * written with pdf-lib's waits taken by the clock (pace.ts loadPaced, savePaced): its parse held the window 1.07 s on
 * a 500-page statement. `check` (the find's Stop) is asked after each wait while the file is read.
 */
export async function enlargedCopyInTurns(file: Uint8Array, check: () => void): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await loadPaced(file, { ignoreEncryption: true, updateMetadata: false, check });
  } catch (error) {
    if (isStop(error)) throw error;
    throw findFailed();
  }
  if (doc.isEncrypted) throw findFailed();
  try {
    const box = doc.context.obj([...ENLARGED_BOX]);
    const cleared = new Set<PDFDict>();
    for (const page of doc.getPages()) {
      // /CropBox and /MediaBox are inherited: clear them up the page tree as well.
      for (let node: PDFDict | undefined = page.node; node && !cleared.has(node); node = node.lookupMaybe(PDFName.of('Parent'), PDFDict)) {
        cleared.add(node);
        node.delete(PDFName.of('CropBox'));
      }
      page.node.set(PDFName.of('MediaBox'), box);
    }
    return await savePaced(doc, { useObjectStreams: false });
  } catch {
    throw findFailed();
  }
}

/** Reads every page's text (of the enlarged-view copy) and annotation texts, with progress and Stop between pages. */
export async function readFileText(file: Uint8Array, options: ReadOptions): Promise<FileText> {
  const { reader, signal } = options;
  stopIfDone(options);
  // Wave 6 (T-052): a read the busy renderer could not finish (out of time, or restarted) is tried again, after a
  // turn; if it still cannot, the find says the computer was busy, never that the file may be damaged.
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        stopIfDone(options);
        if (rendererBusy(error)) {
          if (attempt < BUSY_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            stopIfDone(options);
            continue;
          }
          throw findBusy();
        }
        if (error instanceof PdfToolsError && error.code === 'redact-find-failed') throw error;
        throw findFailed();
      }
    }
  };
  const turn = turnsEvery(async () => {
    await (options.pause ?? noPause)();
    stopIfDone(options);
  }, options.turnEveryMs);
  const geometries = await guard(() => reader.pageGeometries(file, { signal }));
  stopIfDone(options);
  const total = geometries.length;
  // Two passes, each over one file, in batches handed to the renderer at once: its queue then serves
  // them back to back and keeps that file open (the renderer holds one document for tool runs, and
  // alternating two files would reopen them for every page).
  const annotations: AnnotationText[][] = [];
  const texts: { items: TextItemLike[]; styles: Record<string, FontStyleLike> }[] = [];
  let done = 0;
  options.onProgress({ done, total: total * 2 });
  const inBatches = async <T>(read: (page: number) => Promise<T>, into: T[]) => {
    for (let from = 0; from < total; from += READ_BATCH) {
      const pages = Array.from({ length: Math.min(READ_BATCH, total - from) }, (_, k) => from + k);
      const read_ = await guard(() =>
        Promise.all(
          pages.map(async (page) => {
            const value = await read(page);
            done += 1;
            if (!signal.aborted) options.onProgress({ done, total: total * 2 });
            return value;
          }),
        ),
      );
      stopIfDone(options);
      into.push(...read_);
    }
  };
  await inBatches((page) => reader.pageAnnotationTexts(file, page, { signal }), annotations);
  const enlarged = await guard(() => enlargedCopyInTurns(file, () => stopIfDone(options)));
  stopIfDone(options);
  await inBatches((page) => reader.pageTextContent(enlarged, page, { signal }), texts);
  const models: PageTextModel[] = [];
  const pagesWithoutText: number[] = [];
  // Wave 6 (T-052): a turn for the window when one is due between pages (all 500 in one loop held it 1.04 s).
  for (const [page, text] of texts.entries()) {
    const due = turn();
    if (due) await due;
    const model = buildPageText(page, text.items, text.styles, geometries[page].view, geometries[page].rotate);
    models.push(model);
    if (!pageHasText(model)) pagesWithoutText.push(page);
  }
  return { models, annotations, geometries, pagesWithoutText };
}

/** Pages read at once (see readFileText). */
const READ_BATCH = 16;

/** Lets the window handle input between slices of the search (the dialog passes a yield; tests none). */
export type Pause = () => Promise<void>;
const noPause: Pause = async () => undefined;

/** Wave 6 (T-052): about how long one piece of a value's search over the pages should take before a turn may come. */
const PIECE_MS = 25;

/**
 * Wave 6 (T-052): every other place of each value of `places` (redactFind.ts everyOccurrence, the same places), one
 * value at a time over a few pages at a time, with a chance of a turn (`turn`) between the pieces: one value over a
 * 500-page statement's every page held the window 1.89 s. Each piece shares its last page with the next, so a value
 * that runs on over a page turn is found as at once; the places found so far go into each piece, so none is
 * repeated. How many pages a piece takes follows how long the last one took.
 */
export async function everyOccurrenceInTurns(
  text: Pick<FileText, 'models' | 'annotations'>,
  places: readonly Proposal[],
  measure: MeasureChar,
  turn: () => Promise<void> | undefined,
): Promise<Proposal[]> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const models = text.models;
  const out: Proposal[] = [];
  // By value (kind and key), without joining a key into a string; the file's own marks and drawn boxes as they are.
  const byValue = new Map<string, Map<string, Proposal[]>>();
  for (const p of places) {
    if (p.kind === 'drawn' || p.kind === 'marked' || p.key === '') {
      out.push(p);
      continue;
    }
    let byKey = byValue.get(p.kind);
    if (!byKey) byValue.set(p.kind, (byKey = new Map()));
    const list = byKey.get(p.key);
    if (list) list.push(p);
    else byKey.set(p.key, [p]);
  }
  let span = 8;
  for (const group of [...byValue.values()].flatMap((byKey) => [...byKey.values()])) {
    const known = [...group];
    const ids = new Set(known.map((p) => p.id));
    for (let from = 0; models.length > 0; ) {
      const to = Math.min(models.length - 1, from + span);
      const t0 = now();
      for (const p of everyOccurrence(models.slice(from, to + 1), known, measure, text.annotations)) {
        if (ids.has(p.id)) continue;
        ids.add(p.id);
        known.push(p);
      }
      const took = now() - t0;
      span = Math.max(1, Math.min(64, Math.round((span * PIECE_MS) / Math.max(1, took))));
      const due = turn();
      if (due) await due;
      if (to >= models.length - 1) break;
      from = to;
    }
    out.push(...known);
  }
  return out;
}

/**
 * Whether a value's other places are searched at once: values ticked by default or chosen by the user
 * (some place sure; typed words, text the user chose everywhere, the file's own marks). A value that is
 * only possible is searched for its other places when the user ticks it (expandValue): an ordinary
 * 200-page statement lists thousands of possibles, and searching each everywhere took over a minute.
 * Places a possible value has in the same form on other pages are found anyway (the patterns run on
 * every page); its other forms, if it is ticked without being expanded (the Strict profile), are left
 * to the check, whose rounds box them.
 */
function expandsAtOnce(group: readonly Proposal[]): boolean {
  return group.some((p) => p.confidence === 'sure' || p.kind === 'typed' || p.kind === 'same-text' || p.kind === 'marked');
}

/**
 * Proposals from what was read: the patterns of every group and the typed terms on each page
 * (findOnPage), the held possibles packed (holdPlaces), every other place of each chosen value
 * (everyOccurrence, see expandsAtOnce), and the 95% rule. Pauses between slices of pages and values,
 * so the window stays responsive on a long file. Run again when a typed word changes (no file reading).
 */
export async function findInModels(text: FileText, terms: readonly Term[], measure: MeasureChar, pause: Pause = noPause, turnEveryMs: number = TURN_MS): Promise<FindResult> {
  // Wave 6 (T-052): turns by the clock, not by a count of pages or values (ten pages, or 25 values over every page,
  // held the window 1 to 1.9 s on long statements).
  const turn = turnsEvery(pause, turnEveryMs);
  const found: Proposal[] = [];
  const held: HeldHit[][] = [];
  let before: PageTextModel | undefined;
  for (const model of text.models) {
    const due = turn();
    if (due) await due;
    const page = findOnPage(model, text.annotations[model.pageIndex] ?? [], { groups: ALL_GROUPS, terms, measure });
    found.push(...page.proposals);
    held.push(page.held);
    // Ruling Q (RX-LIB3): typed words that stand only across the turn from the page before to this one.
    if (before) {
      const between = turn();
      if (between) await between;
      found.push(...typedAcrossTurn(before, model, terms, measure));
    }
    before = model;
  }
  // By value (kind and key), without joining a key into a string.
  const byValue = new Map<string, Map<string, Proposal[]>>();
  for (const p of found) {
    let byKey = byValue.get(p.kind);
    if (!byKey) byValue.set(p.kind, (byKey = new Map()));
    const list = byKey.get(p.key);
    if (list) list.push(p);
    else byKey.set(p.key, [p]);
  }
  const groups = [...byValue.values()].flatMap((byKey) => [...byKey.values()]);
  const every: Proposal[] = [];
  const expanding: Proposal[] = [];
  for (const group of groups) {
    if (expandsAtOnce(group)) expanding.push(...group);
    else every.push(...group);
  }
  every.push(...(await everyOccurrenceInTurns(text, expanding, measure, turn)));
  const area = (page: number) => {
    const g = text.geometries[page];
    return g ? Math.abs((g.view[2] - g.view[0]) * (g.view[3] - g.view[1])) : 0;
  };
  const { kept, dropped } = dropPageSizedBoxes(every, area);
  return { proposals: kept, held: holdPlaces(held), autoBoxesDropped: dropped };
}

/** A value's other places, searched now (the user ticked a possible value): the new places only. */
export function expandValue(text: FileText, places: readonly Proposal[], known: ReadonlySet<string>, measure: MeasureChar): Proposal[] {
  return everyOccurrence(text.models, places, measure, text.annotations).filter((p) => !known.has(p.id));
}

/** `expandValue` in turns for the window (wave 6, T-052): the same places. */
export async function expandValueInTurns(text: FileText, places: readonly Proposal[], known: ReadonlySet<string>, measure: MeasureChar, pause: Pause): Promise<Proposal[]> {
  return (await everyOccurrenceInTurns(text, places, measure, turnsEvery(pause))).filter((p) => !known.has(p.id));
}

/** The find as the dialog runs it on opening: read the file, then search what was read. */
export async function findInFile(file: Uint8Array, options: ReadOptions & { terms: readonly Term[]; measure: MeasureChar }): Promise<FileText & FindResult> {
  const text = await readFileText(file, options);
  stopIfDone(options);
  const pause: Pause = async () => {
    await (options.pause ?? noPause)();
    stopIfDone(options);
  };
  return { ...text, ...(await findInModels(text, options.terms, options.measure, pause, options.turnEveryMs)) };
}

// ---- measuring characters in the application --------------------------------------------------------------

type MeasuringContext = { font: string; measureText(text: string): { width: number } };
let measuring: MeasuringContext | null = null;
let measuringFamily = '';
const measured = new Map<string, number>();

function measuringContext(): MeasuringContext | null {
  if (measuring) return measuring;
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    measuring = (canvas.getContext('2d') as MeasuringContext | null) ?? null;
  } catch {
    measuring = null;
  }
  return measuring;
}

/**
 * A character's advance at 100 px in one of the fallback families (FALLBACK_FAMILY: Arial, Times New
 * Roman, Courier New), measured one character at a time with the canvas (a whole string would be
 * kerned), and cached. 0 when nothing can be measured: pageText.ts then places by character count.
 */
export const canvasMeasure: MeasureChar = (ch, family) => {
  const known = Object.values(FALLBACK_FAMILY).includes(family) ? family : 'Arial';
  const key = `${known}\u0000${ch}`;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  const context = measuringContext();
  let width = 0;
  if (context) {
    if (measuringFamily !== known) {
      context.font = `100px "${known}"`;
      measuringFamily = known;
    }
    width = context.measureText(ch).width;
  }
  const value = Number.isFinite(width) && width > 0 ? width : 0;
  measured.set(key, value);
  return value;
};
