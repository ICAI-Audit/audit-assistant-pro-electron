// Runs one tool on the chosen files and adds what it makes to the working list as results.
//
// - The list's context key and session are captured when the user presses Run and passed in.
//   Before each slow step, and before anything is added, the run checks that the list is still
//   that session's. If it has moved on (another engagement, sign-out) the run stops without a
//   word: nothing is added and nothing is named.
// - A cancel (the signal) is checked between files and pages. Any failure after a cancel counts
//   as the cancel. A cancelled or failed run adds nothing; results are added all at once at the end.
// - Every PDF made is re-opened with inspectPdf and its page count checked before it is added, so
//   a damaged or incomplete file is never offered as a result.
// - A result never carries a valid signature: it is never marked "Signed". Every PDF result of a
//   signed file (or of a result so marked) is marked "Signature no longer valid": it may still hold
//   the signature's data and widget. What a step did not carry over (form fields, bookmarks), made
//   invalid, or could not trim (a page's resources kept whole) is said in its summary and kept as
//   flags, for the record.
// - A result made from results carries their history (provenance.ts).
// - Sources' bytes are passed to the lib functions as they are: they never change them, and the
//   renderer copies what it gives to its worker.
import { compressPdf, COMPRESS_LEVELS, type CompressLevel, type ImageRecoder } from '@/lib/pdf-tools/compress';
import { pageImageName, partName, stripExtension } from '@/lib/pdf-tools/fileNames';
import { imagesToPdf, sniffImageFormat, type ImageInput, type ImagePageSize } from '@/lib/pdf-tools/imagesToPdf';
import { inspectPdf, type PdfInfo } from '@/lib/pdf-tools/inspect';
import { deletePages, extractPages, mergePdfs, splitEvery, type OrganiseReport } from '@/lib/pdf-tools/organise';
import { formatPageList, parsePageList } from '@/lib/pdf-tools/pageList';
import { addPageNumbers, type PageNumberOptions } from '@/lib/pdf-tools/pageNumbers';
import { historyOf, sourceRef } from '@/lib/pdf-tools/provenance';
import { defaultResultName, operationSummary, summaryWithNotes } from '@/lib/pdf-tools/resultNames';
import { LIST_MAX_BYTES, LIST_WARN_BYTES, newFileId, type WorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type OperationFlags, type OperationRecord, type ToolId, type WorkingFile } from '@/lib/pdf-tools/types';
import { nextPaint, yieldToUi } from './canvasUtils';
import { formatBytes, plural } from './format';
import { browserImageRecoder } from './imageRecoder';
import { IMAGE_ENCODE_FAILED, OUT_OF_MEMORY } from './canvasUtils';
import { numberedResultName } from './fileGroups';
import { OPEN_TIMEOUT, RENDER_UNAVAILABLE, RENDERER_RESTARTED, renderPage, type RenderedImage } from './pdfRenderer';
import { RenderTimeoutError, type Priority } from './renderQueue';
import { resolveResultName, resolveStem, rgbToHex } from './toolOptions';

export interface RunContext {
  contextKey: string;
  /** The list's session when Run was pressed (from the screen's guarded state). */
  session: number;
  store: Pick<WorkingListStore, 'getState' | 'addResults'>;
  signal: AbortSignal;
  /** `total` 0 means the step cannot be measured; `label` says what is happening. */
  onProgress: (done: number, total: number, label?: string) => void;
}

export interface MergeRunOptions {
  name?: string;
}
export type SplitRunOptions =
  | { mode: 'range'; from: number; to: number; name?: string }
  | { mode: 'selected'; pages: string; name?: string }
  | { mode: 'every'; every: number; stem?: string };
export interface DeletePagesRunOptions {
  pages: string;
  name?: string;
}
export interface CompressRunOptions {
  level: CompressLevel;
  /** One per input, in order; an empty or unusable name falls back to the default. */
  names?: string[];
}
export interface PageNumbersRunOptions {
  numbers: PageNumberOptions;
  name?: string;
}
export interface ImagesToPdfRunOptions {
  pageSize: ImagePageSize;
  marginPt: number;
  name?: string;
}
export interface PdfToImagesRunOptions {
  /** 'all' or a page list such as "1-5, 8". */
  pages: string;
  format: 'png' | 'jpg';
  dpi: 100 | 150 | 300;
  stem?: string;
}

export interface ToolRunOptions {
  merge: MergeRunOptions;
  split: SplitRunOptions;
  'delete-pages': DeletePagesRunOptions;
  compress: CompressRunOptions;
  'page-numbers': PageNumbersRunOptions;
  'images-to-pdf': ImagesToPdfRunOptions;
  'pdf-to-images': PdfToImagesRunOptions;
}

export interface RunDeps {
  mergePdfs: typeof mergePdfs;
  extractPages: typeof extractPages;
  splitEvery: typeof splitEvery;
  deletePages: typeof deletePages;
  compressPdf: typeof compressPdf;
  addPageNumbers: typeof addPageNumbers;
  imagesToPdf: typeof imagesToPdf;
  inspectPdf: typeof inspectPdf;
  recoder: ImageRecoder;
  renderPage: (
    file: Uint8Array,
    pageIndex: number,
    dpi: 100 | 150 | 300,
    format: 'png' | 'jpg',
    options: { signal?: AbortSignal; priority?: Priority },
  ) => Promise<RenderedImage>;
  /** Lets the busy state paint before a slow step on the main thread. */
  paint: () => Promise<void>;
  /** Lets the window handle input between pages. */
  yieldToUi: () => Promise<void>;
  newId: () => string;
  maxBytes: number;
  /** Above this the list is large: the screen warns once when results take it past. */
  warnBytes: number;
}

export interface RunResult {
  /** 'nothing': the run worked but made no file (already compact); 'stale': the list moved on. */
  status: 'added' | 'nothing' | 'cancelled' | 'stale';
  added: number;
  ids: string[];
  /** What was made, or why nothing was. Never set for 'stale', so no name reaches another engagement. */
  message?: string;
  detail?: string;
  /** 'warning' when some of the files could not be done (Compress of several files). */
  tone?: 'success' | 'warning';
  /** The results took the list past the warning size. */
  listLarge?: boolean;
}

/** How Merge places images: A4, turned to suit each image, imagesToPdf's default margin. */
export const MERGE_IMAGE_OPTIONS = { pageSize: 'a4-auto', marginPt: 28 } as const;

// A merged file is about as large as its inputs together, rarely much smaller (re-saving can
// compact the structure). Refusing before merging uses this share of the inputs' size, so a merge
// that would fit is never refused; the real size is checked again before adding.
const MERGE_SIZE_FLOOR = 0.9;

const defaultDeps: RunDeps = {
  mergePdfs,
  extractPages,
  splitEvery,
  deletePages,
  compressPdf,
  addPageNumbers,
  imagesToPdf,
  inspectPdf,
  recoder: browserImageRecoder,
  renderPage,
  paint: () => nextPaint(),
  yieldToUi,
  newId: newFileId,
  maxBytes: LIST_MAX_BYTES,
  warnBytes: LIST_WARN_BYTES,
};

class Stale extends Error {}
class Cancelled extends Error {}

const unverified = () => new PdfToolsError('unverified', 'The result could not be verified and was not added.');
const wrongInput = (message: string) => new PdfToolsError('wrong-input', message);

interface Description {
  message: string;
  detail?: string;
  tone?: 'success' | 'warning';
}

/**
 * What a tool made. The names are settled only when the results are added (a name the list
 * already holds gets a number), so the message is written from the final files.
 */
interface Made {
  files: WorkingFile[];
  describe(files: WorkingFile[]): Description;
}

/** Shared by the tool steps below: the run's checks and how a result row is built. */
class Run {
  constructor(
    readonly tool: ToolId,
    readonly ctx: RunContext,
    readonly deps: RunDeps,
  ) {}

  live(): boolean {
    const state = this.ctx.store.getState();
    return state.session === this.ctx.session && state.contextKey === this.ctx.contextKey;
  }

  /** Stops the run when the list moved on or the user cancelled. */
  check(): void {
    if (!this.live()) throw new Stale();
    if (this.ctx.signal.aborted) throw new Cancelled();
  }

  progress(done: number, total: number, label?: string): void {
    this.check();
    this.ctx.onProgress(done, total, label);
  }

  /** Shows the step, lets it paint, then checks again before the slow work starts. */
  async slowStep(label: string): Promise<void> {
    this.progress(0, 0, label);
    await this.deps.paint();
    this.check();
  }

  listBytes(): number {
    this.check(); // only this session's files are counted
    return this.ctx.store.getState().files.reduce((sum, f) => sum + f.size, 0);
  }

  /**
   * Refuses before the slow work when the outcome is already known: the list is full, or `adding`
   * bytes (a fair lower bound of what will be made) would not fit. The real size is checked again
   * before the results are added.
   */
  ensureRoom(adding = 0, what = 'The result'): void {
    const list = this.listBytes();
    const max = this.deps.maxBytes;
    if (list >= max) {
      throw new PdfToolsError('list-full', `The list is full: ${formatBytes(max)} is the most PDF Tools can hold. Remove some files and try again.`);
    }
    if (list + adding > max) {
      throw new PdfToolsError('list-full', `${what} would take the list over ${formatBytes(max)}. Remove some files from the list and try again.`);
    }
  }

  async verifyPdf(bytes: Uint8Array, expectedPages: number | null): Promise<PdfInfo & { pageCount: number }> {
    let info;
    try {
      info = await this.deps.inspectPdf(bytes);
    } catch {
      throw unverified();
    }
    if (info.encrypted || info.pageCount === null) throw unverified();
    if (expectedPages !== null && info.pageCount !== expectedPages) throw unverified();
    return { ...info, pageCount: info.pageCount };
  }

  result(
    made: Pick<WorkingFile, 'name' | 'bytes' | 'kind' | 'mimeType' | 'pageCount'> &
      Partial<Pick<WorkingFile, 'signatureInvalid' | 'hasFormFields' | 'hasBookmarks' | 'hasPageLinks'>>,
    sources: WorkingFile[],
    record: Pick<OperationRecord, 'summary' | 'options' | 'flags'>,
    groupId?: string,
  ): WorkingFile {
    const operation: OperationRecord = { tool: this.tool, summary: record.summary, sources: sources.map(sourceRef), options: record.options, ...historyOf(sources) };
    if (record.flags && Object.keys(record.flags).length > 0) operation.flags = record.flags;
    const file: WorkingFile = {
      ...made,
      id: this.deps.newId(),
      origin: 'result',
      size: made.bytes.byteLength,
      wasProtected: sources.some((f) => f.wasProtected),
      hasRestrictions: false,
      hasSignature: false, // a result never carries a valid signature
      operation,
      sentTo: [],
    };
    if (groupId) file.groupId = groupId;
    return file;
  }

  async pdfResult(
    name: string,
    bytes: Uint8Array,
    expectedPages: number | null,
    sources: WorkingFile[],
    record: Pick<OperationRecord, 'summary' | 'options'>,
    extra: { groupId?: string; report?: OrganiseReport } = {},
  ): Promise<WorkingFile> {
    this.check();
    const info = await this.verifyPdf(bytes, expectedPages);
    this.check();
    // Every result of a signed file (or of a result marked so) may still hold the signature, no longer valid.
    const signatureInvalid = sources.some((f) => f.hasSignature || f.signatureInvalid);
    const sharedResourcesKept = extra.report?.sharedResourcesKept === true;
    const flags: OperationFlags = {
      ...notCarried(this.tool, sources),
      ...(signatureInvalid ? { signatureInvalid: true } : {}),
      ...(sharedResourcesKept ? { sharedResourcesKept: true } : {}),
    };
    const made = {
      name,
      bytes,
      kind: 'pdf' as const,
      mimeType: 'application/pdf',
      pageCount: info.pageCount,
      hasFormFields: info.hasFormFields,
      hasBookmarks: info.hasBookmarks,
      hasPageLinks: info.hasPageLinks,
      ...(signatureInvalid ? { signatureInvalid: true } : {}),
      ...(sharedResourcesKept ? { sharedResourcesKept: true } : {}),
    };
    return this.result(made, sources, { summary: summaryWithNotes(record.summary, flags), options: record.options, flags }, extra.groupId);
  }
}

/** Said in the run's message when a Split or Delete pages result kept some page's resources whole. */
const RESOURCES_KEPT_NOTE = 'Some pages could not be read with certainty. The file may still contain images or fonts from pages that were left out.';

/** What a tool does not carry over from its sources (the dialogs say so before the run). */
function notCarried(tool: ToolId, sources: WorkingFile[]): OperationFlags {
  const flags: OperationFlags = {};
  if (tool === 'merge' && sources.some((f) => f.hasFormFields)) flags.formFieldsDropped = true;
  if ((tool === 'merge' || tool === 'split' || tool === 'delete-pages') && sources.some((f) => f.hasBookmarks)) flags.bookmarksDropped = true;
  return flags;
}

function imageInput(file: WorkingFile): ImageInput {
  return { bytes: file.bytes, format: file.mimeType === 'image/png' ? 'png' : 'jpeg', name: file.name };
}

function onePdf(inputs: WorkingFile[]): WorkingFile & { pageCount: number } {
  const [file] = inputs;
  if (inputs.length !== 1 || file.kind !== 'pdf' || file.pageCount === null) throw wrongInput('Choose exactly one PDF.');
  return file as WorkingFile & { pageCount: number };
}

function percentSmaller(before: number, after: number): number {
  return Math.min(99, Math.max(1, Math.round((1 - after / before) * 100)));
}

// ---- the tools ---------------------------------------------------------------------------------

async function merge(run: Run, inputs: WorkingFile[], opts: MergeRunOptions): Promise<Made> {
  if (inputs.length < 2) throw new PdfToolsError('merge-needs-two', 'Choose at least two files to merge.');
  // The merged file is about as large as its inputs together: refuse now rather than after merging.
  run.ensureRoom(Math.floor(inputs.reduce((sum, f) => sum + f.size, 0) * MERGE_SIZE_FLOOR), 'The merged file');
  const images = inputs.filter((f) => f.kind === 'image');
  const parts: Uint8Array[] = [];
  let converted = 0;
  for (const file of inputs) {
    if (file.kind === 'image') {
      run.progress(converted, images.length, `Turning images into pages (${converted + 1} of ${images.length})…`);
      await run.deps.paint();
      run.check();
      parts.push(await run.deps.imagesToPdf([imageInput(file)], MERGE_IMAGE_OPTIONS));
      converted += 1;
    } else {
      parts.push(file.bytes);
    }
  }
  await run.slowStep('Merging…');
  const bytes = await run.deps.mergePdfs(parts);
  const expected = inputs.every((f) => f.kind === 'image' || f.pageCount !== null)
    ? inputs.reduce((sum, f) => sum + (f.kind === 'image' ? 1 : (f.pageCount as number)), 0)
    : null;
  const name = resolveResultName(opts.name ?? '', defaultResultName('merge', inputs[0].name), 'pdf');
  const options: Record<string, string | number | boolean> = { files: inputs.length, images: images.length };
  if (images.length > 0) {
    options.imagePageSize = MERGE_IMAGE_OPTIONS.pageSize;
    options.imageMarginPt = MERGE_IMAGE_OPTIONS.marginPt;
  }
  const file = await run.pdfResult(name, bytes, expected, inputs, { summary: operationSummary('merge', { files: inputs.length }), options });
  return {
    files: [file],
    describe: ([made]) => ({ message: `Merged ${plural(inputs.length, 'file')} into ${made.name}`, detail: `${plural(made.pageCount ?? 0, 'page')}.` }),
  };
}

/**
 * Page-by-page progress for Split (one result) and Delete pages on the main thread: the bar moves,
 * and a cancel takes effect between pages, about a hundred times in a run however long the file.
 */
function pageByPage(run: Run, label: (page: number, total: number) => string) {
  return async (done: number, total: number) => {
    if (done % Math.max(1, Math.ceil(total / 100)) !== 0) return;
    run.progress(done, total, label(done + 1, total));
    await run.deps.yieldToUi();
    run.check();
  };
}

async function split(run: Run, inputs: WorkingFile[], opts: SplitRunOptions): Promise<Made> {
  const source = onePdf(inputs);
  if (opts.mode === 'every') {
    await run.slowStep('Splitting…');
    const reports: OrganiseReport[] = [];
    // Part by part: the bar moves, and a cancel takes effect before the next part.
    const parts = await run.deps.splitEvery(source.bytes, opts.every, {
      reports,
      onPart: async (done, total) => {
        run.progress(done, total, `Splitting… part ${done + 1} of ${total}`);
        await run.deps.yieldToUi();
        run.check();
      },
    });
    const stem = resolveStem(opts.stem ?? '', stripExtension(source.name));
    const groupId = run.deps.newId();
    const files: WorkingFile[] = [];
    for (const [i, bytes] of parts.entries()) {
      run.progress(i, parts.length, `Checking part ${i + 1} of ${parts.length}…`);
      const expected = Math.min(opts.every, source.pageCount - i * opts.every);
      const summary = operationSummary('split', { every: opts.every, part: i + 1, parts: parts.length });
      const record = { summary, options: { mode: 'every', every: opts.every } };
      files.push(await run.pdfResult(partName(stem, i + 1, parts.length), bytes, expected, [source], record, { groupId, report: reports[i] }));
      await run.deps.yieldToUi();
    }
    return {
      files,
      describe: (made) => ({ message: `Split ${source.name} into ${parts.length} parts`, detail: `${made[0].name} to ${made[made.length - 1].name}.` }),
    };
  }

  const range = opts.mode === 'range';
  const indices = parsePageList(range ? `${opts.from}-${opts.to}` : opts.pages, source.pageCount);
  await run.slowStep('Taking out the pages…');
  const report: OrganiseReport = {};
  const onPage = pageByPage(run, (page, total) => `Taking out the pages (${page} of ${total})…`);
  const bytes = await run.deps.extractPages(source.bytes, indices, { report, onPage });
  const written = formatPageList(indices);
  const fallback = range ? defaultResultName('split', source.name, { from: opts.from, to: opts.to }) : defaultResultName('split', source.name);
  const name = resolveResultName(opts.name ?? '', fallback, 'pdf');
  const record = range
    ? { summary: operationSummary('split', { from: opts.from, to: opts.to }), options: { mode: 'range', from: opts.from, to: opts.to } }
    : { summary: operationSummary('split', { pages: written }), options: { mode: 'selected', pages: written } };
  const file = await run.pdfResult(name, bytes, indices.length, [source], record, { report });
  return { files: [file], describe: ([made]) => ({ message: `Made ${made.name}`, detail: `${plural(indices.length, 'page')} from ${source.name}.` }) };
}

async function removePages(run: Run, inputs: WorkingFile[], opts: DeletePagesRunOptions): Promise<Made> {
  const source = onePdf(inputs);
  // A page typed twice is removed once.
  const indices = parsePageList(opts.pages, source.pageCount, { unique: true }).sort((a, b) => a - b);
  await run.slowStep('Removing the pages…');
  const report: OrganiseReport = {};
  const onPage = pageByPage(run, (page, total) => `Copying the remaining pages (${page} of ${total})…`);
  const bytes = await run.deps.deletePages(source.bytes, indices, { report, onPage });
  const remaining = source.pageCount - indices.length;
  const name = resolveResultName(opts.name ?? '', defaultResultName('delete-pages', source.name), 'pdf');
  const written = formatPageList(indices);
  const file = await run.pdfResult(name, bytes, remaining, [source], { summary: operationSummary('delete-pages', { pages: written }), options: { pages: written } }, { report });
  return { files: [file], describe: ([made]) => ({ message: `Made ${made.name}`, detail: `${plural(remaining, 'page')} ${remaining === 1 ? 'remains' : 'remain'}.` }) };
}

async function compress(run: Run, inputs: WorkingFile[], opts: CompressRunOptions): Promise<Made> {
  if (inputs.length === 0 || inputs.some((f) => f.kind !== 'pdf')) throw wrongInput('Only PDFs can be compressed.');
  const label = COMPRESS_LEVELS[opts.level]?.label ?? opts.level;
  const STEPS = 1000; // per file, so several files share one bar
  const several = inputs.length > 1;
  const files: WorkingFile[] = [];
  const compact: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  let before = 0;
  let after = 0;
  for (const [i, source] of inputs.entries()) {
    const prefix = several ? `${source.name}: ` : '';
    try {
      run.progress(i * STEPS, inputs.length * STEPS, `${prefix}Reading…`);
      await run.deps.paint();
      run.check();
      // A cancel stops compressPdf by throwing from its progress callback.
      const outcome = await run.deps.compressPdf(source.bytes, opts.level, run.deps.recoder, (done, total) => {
        const share = total > 0 ? Math.round((done / total) * STEPS) : STEPS;
        run.progress(i * STEPS + share, inputs.length * STEPS, total > 0 ? `${prefix}Reducing images (${done} of ${total})…` : `${prefix}Re-saving…`);
      });
      run.check();
      if (!outcome.bytes) {
        compact.push(source.name);
        continue;
      }
      const saved = percentSmaller(outcome.originalSize, outcome.newSize);
      const summary = operationSummary('compress', { level: opts.level, saved, from: formatBytes(outcome.originalSize), to: formatBytes(outcome.newSize) });
      const name = resolveResultName(opts.names?.[i] ?? '', defaultResultName('compress', source.name), 'pdf');
      files.push(await run.pdfResult(name, outcome.bytes, source.pageCount, [source], { summary, options: { level: opts.level } }));
      before += outcome.originalSize;
      after += outcome.newSize;
    } catch (error) {
      // One file failing does not lose the others: it is named with its reason. A cancel or a change
      // of engagement still stops the whole run, and one file alone shows its error as it is.
      if (!several || error instanceof Stale || error instanceof Cancelled || !run.live() || run.ctx.signal.aborted) throw error;
      failed.push({ name: source.name, reason: error instanceof PdfToolsError ? error.message : 'It could not be compressed.' });
    }
  }

  const compactNote = compact.length > 0 ? `Already compact at this level: ${compact.join(', ')}.` : '';
  const failedNote = failed.length > 0 ? `Not compressed: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}` : '';
  if (files.length === 0) {
    if (failed.length > 0) throw new PdfToolsError('compress-failed', ['No file was compressed.', failedNote, compactNote].filter(Boolean).join(' '));
    const stronger = opts.level === 'extreme' ? '' : ' A stronger level may still make it smaller.';
    return {
      files,
      describe: () => ({ message: 'Already compact at this level', detail: `${label} would not make ${several ? 'these files' : 'this file'} smaller.${stronger}` }),
    };
  }
  const sizes = `${percentSmaller(before, after)}% smaller: ${formatBytes(before)} → ${formatBytes(after)}`;
  if (!several) return { files, describe: ([made]) => ({ message: `Compressed ${made.name}`, detail: sizes }) };
  return {
    files,
    describe: (made) => ({
      message: made.length === inputs.length ? `Compressed ${plural(made.length, 'file')}` : `Compressed ${made.length} of ${inputs.length} files`,
      detail: [`${made.length > 1 ? 'Together ' : ''}${sizes}.`, compactNote, failedNote].filter(Boolean).join(' '),
      tone: failed.length > 0 ? 'warning' : 'success',
    }),
  };
}

async function numberPages(run: Run, inputs: WorkingFile[], opts: PageNumbersRunOptions): Promise<Made> {
  const source = onePdf(inputs);
  await run.slowStep('Adding page numbers…');
  const bytes = await run.deps.addPageNumbers(source.bytes, opts.numbers);
  const name = resolveResultName(opts.name ?? '', defaultResultName('page-numbers', source.name), 'pdf');
  const { color, ...rest } = opts.numbers;
  const options: Record<string, string | number | boolean> = { ...rest, prefix: rest.prefix ?? '', suffix: rest.suffix ?? '', color: rgbToHex(color) };
  const file = await run.pdfResult(name, bytes, source.pageCount, [source], { summary: operationSummary('page-numbers', {}), options });
  const { fromPage, toPage } = opts.numbers;
  const which = fromPage === 1 && toPage === source.pageCount ? 'every page' : `pages ${fromPage} to ${toPage}`;
  return { files: [file], describe: ([made]) => ({ message: `Made ${made.name}`, detail: `Numbers added to ${which}.` }) };
}

async function imagesIntoPdf(run: Run, inputs: WorkingFile[], opts: ImagesToPdfRunOptions): Promise<Made> {
  if (inputs.length === 0 || inputs.some((f) => f.kind !== 'image')) throw wrongInput('Only images can be turned into a PDF.');
  // pdf-lib reports no progress here and large PNGs take a while: show the busy state first.
  await run.slowStep(`Placing ${plural(inputs.length, 'image')}…`);
  const bytes = await run.deps.imagesToPdf(inputs.map(imageInput), { pageSize: opts.pageSize, marginPt: opts.marginPt });
  const name = resolveResultName(opts.name ?? '', defaultResultName('images-to-pdf', inputs[0].name), 'pdf');
  const record = { summary: operationSummary('images-to-pdf', { images: inputs.length }), options: { pageSize: opts.pageSize, marginPt: opts.marginPt } };
  const file = await run.pdfResult(name, bytes, inputs.length, inputs, record);
  return { files: [file], describe: ([made]) => ({ message: `Made ${made.name}`, detail: `${plural(inputs.length, 'image')}, one per page.` }) };
}

/** What a PDF-to-images run can still change to make lighter images: only what it is not using yet. */
function lighterChoices(opts: Pick<PdfToImagesRunOptions, 'dpi' | 'format'>): string[] {
  return [opts.dpi > 100 ? 'a lower resolution' : null, opts.format === 'png' ? 'JPG' : null].filter((x): x is string => x !== null);
}

/** "a", "a or b", "a, b or c". */
function orList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

const TRY_AGAIN = 'Try again; if it happens again, restart the application.';

/**
 * The renderer's errors are worded for previews; say what really stopped the image of a page and
 * what to try. Only a file pdf.js could not read is called possibly damaged.
 */
function imageError(error: unknown, page: number, opts: Pick<PdfToImagesRunOptions, 'dpi' | 'format'>): PdfToolsError {
  const code = error instanceof PdfToolsError ? error.code : null;
  const failed = `Page ${page} could not be turned into an image`;
  // At 100 dpi as JPG there is nothing lighter left to suggest.
  const lighter = lighterChoices(opts);
  const advice = `Nothing was added. ${lighter.length > 0 ? `Try ${orList(lighter)}.` : TRY_AGAIN}`;
  if (code === RENDER_UNAVAILABLE) {
    return new PdfToolsError(RENDER_UNAVAILABLE, 'The pages could not be turned into images: the page renderer did not start. Nothing was added. Restart the application and try again.');
  }
  if (error instanceof RenderTimeoutError) {
    return new PdfToolsError('render-timeout', `Page ${page} took too long to turn into an image. ${advice}`);
  }
  if (code === OPEN_TIMEOUT) {
    // Opening does not depend on the resolution, the format or the number of pages.
    return new PdfToolsError(OPEN_TIMEOUT, `${failed}: the file took too long to open. Nothing was added. ${TRY_AGAIN}`);
  }
  if (code === RENDERER_RESTARTED) {
    return new PdfToolsError(RENDERER_RESTARTED, `${failed}: the page renderer had to restart, usually because memory ran short. ${advice}`);
  }
  if (code === OUT_OF_MEMORY || code === IMAGE_ENCODE_FAILED) {
    return new PdfToolsError(OUT_OF_MEMORY, `${failed}: there was not enough memory. ${advice}`);
  }
  if (code === 'render-failed') {
    return new PdfToolsError('render-failed', `${failed}. The file may be damaged. Nothing was added.`);
  }
  return new PdfToolsError('render-failed', `${failed}. ${advice}`);
}

async function pdfIntoImages(run: Run, inputs: WorkingFile[], opts: PdfToImagesRunOptions): Promise<Made> {
  const source = onePdf(inputs);
  // A page typed twice is made once: two images would have the same name.
  const indices =
    opts.pages.trim().toLowerCase() === 'all'
      ? Array.from({ length: source.pageCount }, (_, i) => i)
      : parsePageList(opts.pages, source.pageCount, { unique: true }).sort((a, b) => a - b);
  // The size estimate is only shown as a warning in the dialog; the real bytes decide here.
  const listBytes = run.listBytes();
  const max = run.deps.maxBytes;
  const stem = resolveStem(opts.stem ?? '', stripExtension(source.name));
  const groupId = run.deps.newId();
  const wanted = opts.format === 'png' ? 'png' : 'jpeg';
  const written = formatPageList(indices);
  const files: WorkingFile[] = [];
  const reduced: { page: number; dpi: number }[] = [];
  let total = 0;
  for (const [k, index] of indices.entries()) {
    run.progress(k, indices.length, `Page ${index + 1} (${k + 1} of ${indices.length})…`);
    let picture: RenderedImage;
    try {
      // One page at a time; the renderer draws on a copy of the file.
      // 'run': served before the page panel's tiles, which can be hundreds deep.
      picture = await run.deps.renderPage(source.bytes, index, opts.dpi, opts.format, { signal: run.ctx.signal, priority: 'run' });
    } catch (error) {
      run.check(); // a cancel or a change of engagement, not a failure of the page
      throw imageError(error, index + 1, opts);
    }
    run.check();
    if (sniffImageFormat(picture.bytes) !== wanted) throw unverified();
    total += picture.bytes.byteLength;
    if (listBytes + total > max) {
      const fit = files.length === 0 ? 'None' : `Only ${files.length}`;
      throw new PdfToolsError(
        'too-large',
        `${fit} of ${indices.length} page images fit in the list (${formatBytes(max)} at most). Nothing was added. Choose ${orList(['fewer pages', ...lighterChoices(opts)])}.`,
      );
    }
    if (picture.reduced) reduced.push({ page: index + 1, dpi: picture.dpi });
    const summary = operationSummary('pdf-to-images', { page: index + 1, format: opts.format, dpi: picture.dpi });
    files.push(
      run.result(
        { name: pageImageName(stem, index + 1, source.pageCount, opts.format), bytes: picture.bytes, kind: 'image', mimeType: picture.mimeType, pageCount: null },
        [source],
        { summary, options: { format: opts.format, dpi: opts.dpi, pages: written } },
        groupId,
      ),
    );
    await run.deps.yieldToUi();
  }
  run.progress(indices.length, indices.length, 'Done');

  const notes = [`${opts.format.toUpperCase()} at ${opts.dpi} dpi.`];
  if (reduced.length === 1) {
    notes.push(`Page ${reduced[0].page} is very large, so it was saved at ${reduced[0].dpi} dpi.`);
  } else if (reduced.length > 1) {
    notes.push(`${reduced.length} very large pages were saved at a lower resolution (pages ${formatPageList(reduced.map((r) => r.page - 1))}).`);
  }
  return { files, describe: (made) => ({ message: made.length === 1 ? `Made ${made[0].name}` : `Made ${made.length} page images`, detail: notes.join(' ') }) };
}

const STEPS_BY_TOOL: { [T in ToolId]: (run: Run, inputs: WorkingFile[], opts: ToolRunOptions[T]) => Promise<Made> } = {
  merge,
  split,
  'delete-pages': removePages,
  compress,
  'page-numbers': numberPages,
  'images-to-pdf': imagesIntoPdf,
  'pdf-to-images': pdfIntoImages,
};

/**
 * A name the list already holds (compared without case, as Windows does) gets " (2)", " (3)"…
 * Should numbering a name fail for any reason, the file is named "result (n)" instead: a name is
 * never the reason a run that worked ends as a failure.
 */
export function withUniqueNames(files: WorkingFile[], inList: readonly WorkingFile[], numbered: typeof numberedResultName = numberedResultName): WorkingFile[] {
  const taken = new Set(inList.map((f) => f.name.toLowerCase()));
  const named = new Map<WorkingFile, string>();
  const take = (file: WorkingFile, name: string) => {
    named.set(file, name);
    taken.add(name.toLowerCase());
  };
  const fallback = (file: WorkingFile) => {
    const extension = file.kind === 'pdf' ? 'pdf' : file.mimeType === 'image/png' ? 'png' : 'jpg';
    let name = '';
    for (let n = 2; name === '' || taken.has(name.toLowerCase()); n++) name = `result (${n}).${extension}`;
    take(file, name);
  };
  const keepOrFallBack = (file: WorkingFile) => (taken.has(file.name.toLowerCase()) ? fallback(file) : take(file, file.name));
  const one = (file: WorkingFile) => {
    try {
      let name = file.name;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = numbered(file.name, n);
      take(file, name);
    } catch {
      keepOrFallBack(file);
    }
  };
  // The files of one group (the parts of a split, the images of one PDF) all get the same number:
  // the smallest that frees every one of their names, so a group never mixes "(2)" and no number.
  const usable = (names: string[]) => {
    const lower = names.map((name) => name.toLowerCase());
    return new Set(lower).size === lower.length && lower.every((name) => !taken.has(name));
  };
  const together = (members: WorkingFile[]) => {
    // A taken name can block at most one number per member, so a free number exists within this bound.
    const last = taken.size * members.length + 1;
    try {
      for (let n = 1; n <= last; n++) {
        const names = members.map((f) => (n === 1 ? f.name : numbered(f.name, n)));
        if (usable(names)) {
          members.forEach((f, i) => take(f, names[i]));
          return;
        }
      }
    } catch {
      members.forEach(keepOrFallBack);
      return;
    }
    members.forEach(one); // names that no single number can separate: each on its own, as before
  };
  const groups = new Map<string, WorkingFile[]>();
  for (const file of files) if (file.groupId) groups.set(file.groupId, [...(groups.get(file.groupId) ?? []), file]);
  for (const file of files) {
    if (named.has(file)) continue;
    if (file.groupId) together(groups.get(file.groupId)!);
    else one(file);
  }
  return files.map((file) => {
    const name = named.get(file)!;
    return name === file.name ? file : { ...file, name };
  });
}

/**
 * Runs `tool` on `inputs` (in list order) and adds its results to the list. Resolves with what was
 * added; rejects only with a PdfToolsError whose message can be shown as it is.
 */
export async function runTool<T extends ToolId>(
  tool: T,
  inputs: WorkingFile[],
  options: ToolRunOptions[T],
  ctx: RunContext,
  overrides: Partial<RunDeps> = {},
): Promise<RunResult> {
  const run = new Run(tool, ctx, { ...defaultDeps, ...overrides });
  try {
    run.check();
    run.ensureRoom();
    const made = await STEPS_BY_TOOL[tool](run, inputs, options);
    run.check();
    if (made.files.length === 0) {
      const said = made.describe([]);
      return { status: 'nothing', added: 0, ids: [], message: said.message, detail: said.detail };
    }

    // From here to addResults nothing is awaited, so the list cannot change in between.
    const before = run.listBytes();
    const adding = made.files.reduce((sum, f) => sum + f.size, 0);
    if (before + adding > run.deps.maxBytes) {
      throw new PdfToolsError(
        'list-full',
        `The ${made.files.length === 1 ? 'result' : 'results'} would take the list over ${formatBytes(run.deps.maxBytes)}. Remove some files from the list and try again.`,
      );
    }
    const files = withUniqueNames(made.files, ctx.store.getState().files);
    if (!ctx.store.addResults(ctx.contextKey, files, ctx.session)) return { status: 'stale', added: 0, ids: [] };
    const said = made.describe(files);
    const kept = files.some((f) => f.sharedResourcesKept);
    return {
      status: 'added',
      added: files.length,
      ids: files.map((f) => f.id),
      message: said.message,
      detail: kept ? [said.detail, RESOURCES_KEPT_NOTE].filter(Boolean).join(' ') : said.detail,
      tone: kept ? 'warning' : (said.tone ?? 'success'),
      listLarge: before <= run.deps.warnBytes && before + adding > run.deps.warnBytes,
    };
  } catch (error) {
    // The list moving on comes first: then nothing is said at all.
    if (error instanceof Stale || !run.live()) return { status: 'stale', added: 0, ids: [] };
    if (error instanceof Cancelled || ctx.signal.aborted) return { status: 'cancelled', added: 0, ids: [] };
    if (error instanceof PdfToolsError) throw error;
    throw new PdfToolsError('run-failed', 'The tool could not finish. The file may be damaged or use features that are not supported.');
  }
}
