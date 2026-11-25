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
import { HEADER_TEXT_TOKENS, typedTextRecord } from '@/lib/pdf-tools/activity';
import { compressPdf, COMPRESS_LEVELS, type CompressLevel, type ImageRecoder } from '@/lib/pdf-tools/compress';
import { compressToTarget } from '@/lib/pdf-tools/compressTarget';
import { pageImageName, partName, stripExtension } from '@/lib/pdf-tools/fileNames';
import { imagesToPdf, sniffImageFormat, type ImageInput, type ImagePageSize } from '@/lib/pdf-tools/imagesToPdf';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { emptyMarkReport } from '@/lib/pdf-tools/marks';
import { forgetMatchedText } from '@/lib/pdf-tools/matchedText';
import { deletePages, extractPages, mergePdfs, splitEvery, type BookmarkReport, type MergeOptions, type OrganiseReport } from '@/lib/pdf-tools/organise';
import { formatPageList, parsePageList } from '@/lib/pdf-tools/pageList';
import { addPageNumbers, type PageNumberRunOptions } from '@/lib/pdf-tools/pageNumbers';
import { defaultResultName, operationSummary } from '@/lib/pdf-tools/resultNames';
import { LIST_MAX_BYTES, LIST_WARN_BYTES, listHeldBytes, newFileId } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES, type ToolId, type WorkingFile } from '@/lib/pdf-tools/types';
import { nextPaint, yieldToUi } from './canvasUtils';
import { formatBytes, plural } from './format';
import { compressToFit, sizesText, type CompressFitOptions } from './compressFit';
import { browserImageRecoder } from './imageRecoder';
import { IMAGE_ENCODE_FAILED, OUT_OF_MEMORY } from './canvasUtils';
import { numberedResultName } from './fileGroups';
import { isOfficeFile, OFFICE_INPUT_REASON, officeInfo } from './officeFiles';
import { carriedFilesNotice } from './carriedNotice';
import { OPEN_TIMEOUT, RENDER_UNAVAILABLE, RENDERER_RESTARTED, renderPage, type RenderedImage } from './pdfRenderer';
import { RenderTimeoutError, type Priority } from './renderQueue';
import { resolveResultName, resolveStem, rgbToHex } from './toolOptions';
import { splitIntoFiles, type SplitPartsRunOptions } from './splitRun';
import { RUN_MODULES, type ModuleRunOptions, type ModuleToolId, type PhaseThreeRunOptions, type PhaseTwoRunOptions } from './toolModules';
import {
  Cancelled,
  markFlags,
  markNotes,
  onePdf,
  pageByPage,
  Run as StepRun,
  Stale,
  unverified,
  wrongInput,
  type Made,
  type RunContext,
  type RunModule,
  type StepDeps,
} from './toolStep';

// The step contract (what a step receives and returns, and what a phase 2 run module exports) is at the
// top of toolStep.ts. The phase 2 tools' options types live in their run modules (toolModules.ts).
export type { RunContext } from './toolStep';
export type { PhaseThreeRunOptions, PhaseTwoRunOptions } from './toolModules';

export interface MergeRunOptions {
  name?: string;
  /** "Add a bookmark for each file" (design 5.2): one bookmark per input, images included, at its first page. Off when absent. */
  fileBookmarks?: boolean;
  /** "Keep each file's own bookmarks under it": the inputs' bookmarks are carried (under their file's bookmark when there is one). Off when absent. */
  keepOwnBookmarks?: boolean;
}
export type SplitRunOptions =
  | { mode: 'range'; from: number; to: number; name?: string }
  | { mode: 'selected'; pages: string; name?: string }
  | { mode: 'every'; every: number; stem?: string }
  // Phase 2: a separate file for each range, or one file per main bookmark (splitRun.ts).
  | SplitPartsRunOptions;
export interface DeletePagesRunOptions {
  pages: string;
  name?: string;
}
/** A level, or (lane CT) Fit to a size: `{ fit: { value, unit } }`, run by compressFit.ts. */
export type CompressRunOptions =
  | {
      level: CompressLevel;
      /** One per input, in order; an empty or unusable name falls back to the default. */
      names?: string[];
    }
  | CompressFitOptions;
export interface PageNumbersRunOptions {
  /**
   * Phase 1 fields plus the optional phase 2 ones (style, font, bold, italic, texts, dateFormat, numbersOn,
   * tokens): pageNumbers.ts PageNumberRunOptions. `tokens` (file, client, financial year, today) are read
   * by the dialog when Run is pressed; they fill the texts and are never recorded.
   */
  numbers: PageNumberRunOptions;
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

export interface ToolRunOptions extends PhaseTwoRunOptions, PhaseThreeRunOptions {
  merge: MergeRunOptions;
  split: SplitRunOptions;
  'delete-pages': DeletePagesRunOptions;
  compress: CompressRunOptions;
  'page-numbers': PageNumbersRunOptions;
  'images-to-pdf': ImagesToPdfRunOptions;
  'pdf-to-images': PdfToImagesRunOptions;
}

/** The run's own needs (toolStep.ts StepDeps) and the phase 1 libraries its steps call; tests replace any of them. */
export interface RunDeps extends StepDeps {
  mergePdfs: typeof mergePdfs;
  extractPages: typeof extractPages;
  splitEvery: typeof splitEvery;
  deletePages: typeof deletePages;
  compressPdf: typeof compressPdf;
  /** Compress, Fit to a size (compressTarget.ts). */
  compressToTarget: typeof compressToTarget;
  addPageNumbers: typeof addPageNumbers;
  imagesToPdf: typeof imagesToPdf;
  recoder: ImageRecoder;
  renderPage: (
    file: Uint8Array,
    pageIndex: number,
    dpi: 100 | 150 | 300,
    format: 'png' | 'jpg',
    options: { signal?: AbortSignal; priority?: Priority },
  ) => Promise<RenderedImage>;
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
  compressToTarget,
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

/** Phase 1's steps call the phase 1 libraries through `run.deps`, so tests can replace them. */
type Run = StepRun<RunDeps>;

/**
 * From this size a Merge or Images to PDF result says why it is large and what makes it smaller (user QA
 * 1.8 and 1.27: portals often allow 5 MB). Only then: a small result needs no word.
 */
const LARGE_RESULT_BYTES = 5 * 1024 * 1024;
const MERGE_SIZE_NOTE = 'Merging does not make files smaller; Compress can make scans smaller.';
const IMAGES_SIZE_NOTE = 'Photos are kept as they are; Compress can make this PDF smaller.';

/** Said in the run's message when a Split or Delete pages result kept some page's resources whole. */
const RESOURCES_KEPT_NOTE = 'Some pages could not be read with certainty. The file may still contain images or fonts from pages that were left out.';

function imageInput(file: WorkingFile): ImageInput {
  return { bytes: file.bytes, format: file.mimeType === 'image/png' ? 'png' : 'jpeg', name: file.name };
}

function percentSmaller(before: number, after: number): number {
  return Math.min(99, Math.max(1, Math.round((1 - after / before) * 100)));
}

// ---- the tools ---------------------------------------------------------------------------------

/**
 * The bookmarks Merge writes (design 5.2): with "a bookmark for each file", one per input in list order,
 * images included (each image is one page), titled with its name without the extension; with "keep each
 * file's own bookmarks", the inputs' own bookmarks, under their file's bookmark when there is one.
 */
export function mergeBookmarkOptions(inputs: readonly WorkingFile[], opts: Pick<MergeRunOptions, 'fileBookmarks' | 'keepOwnBookmarks'>): MergeOptions['fileBookmarks'] {
  const keepOwn = opts.keepOwnBookmarks === true;
  if (opts.fileBookmarks === true) return { titles: inputs.map((f) => stripExtension(f.name)), keepOwn };
  return keepOwn ? { keepOwn: true } : undefined;
}

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
  // One part per input, in input order, so the file bookmarks' titles line up with their first pages.
  const report: BookmarkReport = {};
  const fileBookmarks = mergeBookmarkOptions(inputs, opts);
  // Before each page is copied: a Stop (or a change of engagement) lands between pages (REV-A B6).
  const onPage = () => run.check();
  // While each file is still being read too (FIX-A2 follow-up): the read asks the same check at each wait.
  const check = () => run.check();
  const bytes = await run.deps.mergePdfs(parts, fileBookmarks ? { fileBookmarks, report, onPage, check } : { report, onPage, check });
  const expected = inputs.every((f) => f.kind === 'image' || f.pageCount !== null)
    ? inputs.reduce((sum, f) => sum + (f.kind === 'image' ? 1 : (f.pageCount as number)), 0)
    : null;
  const name = resolveResultName(opts.name ?? '', defaultResultName('merge', inputs[0].name), 'pdf');
  const options: Record<string, string | number | boolean> = { files: inputs.length, images: images.length };
  if (images.length > 0) {
    options.imagePageSize = MERGE_IMAGE_OPTIONS.pageSize;
    options.imageMarginPt = MERGE_IMAGE_OPTIONS.marginPt;
  }
  options.fileBookmarks = opts.fileBookmarks === true;
  options.keepOwnBookmarks = opts.keepOwnBookmarks === true;
  const flags = inputs.some((f) => f.hasFormFields) ? { formFieldsDropped: true } : {};
  const file = await run.pdfResult(name, bytes, expected, inputs, { summary: operationSummary('merge', { files: inputs.length }), options }, { report, flags });
  return {
    files: [file],
    describe: ([made]) => ({
      message: `Merged ${plural(inputs.length, 'file')} into ${made.name}`,
      detail: `${plural(made.pageCount ?? 0, 'page')}.${made.size >= LARGE_RESULT_BYTES ? ` ${MERGE_SIZE_NOTE}` : ''}`,
    }),
  };
}

async function split(run: Run, inputs: WorkingFile[], opts: SplitRunOptions): Promise<Made> {
  const source = onePdf(inputs);
  if (opts.mode === 'ranges' || opts.mode === 'bookmarks') return splitIntoFiles(run, source, opts);
  if (opts.mode === 'every') {
    await run.slowStep('Splitting…');
    const reports: (OrganiseReport & BookmarkReport)[] = [];
    // Part by part: the bar moves; a cancel takes effect before the next page (REV-A B6).
    const parts = await run.deps.splitEvery(source.bytes, opts.every, {
      reports,
      onPart: async (done, total) => {
        run.progress(done, total, `Splitting… part ${done + 1} of ${total}`);
        await run.deps.yieldToUi();
        run.check();
      },
      onPage: () => run.check(),
      check: () => run.check(), // while the source is still being read (FIX-A2 follow-up)
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
  const report: OrganiseReport & BookmarkReport = {};
  const onPage = pageByPage(run, (page, total) => `Taking out the pages (${page} of ${total})…`);
  const bytes = await run.deps.extractPages(source.bytes, indices, { report, onPage, check: () => run.check() });
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
  const report: OrganiseReport & BookmarkReport = {};
  const onPage = pageByPage(run, (page, total) => `Copying the remaining pages (${page} of ${total})…`);
  const bytes = await run.deps.deletePages(source.bytes, indices, { report, onPage, check: () => run.check() });
  const remaining = source.pageCount - indices.length;
  const name = resolveResultName(opts.name ?? '', defaultResultName('delete-pages', source.name), 'pdf');
  const written = formatPageList(indices);
  const file = await run.pdfResult(name, bytes, remaining, [source], { summary: operationSummary('delete-pages', { pages: written }), options: { pages: written } }, { report });
  return { files: [file], describe: ([made]) => ({ message: `Made ${made.name}`, detail: `${plural(remaining, 'page')} ${remaining === 1 ? 'remains' : 'remain'}.` }) };
}

/**
 * What a level that made nothing says (user Q&A 1.20): why, and "a stronger level" only when a file has images
 * a level can recode. `recodable` and `withImages` count the files with such images, and with any image.
 */
function nothingMade(label: string, level: CompressLevel, several: boolean, recodable: number, withImages: number): { message: string; detail: string } {
  // One plain sentence (owner, 15 November 2026); which kinds of image are left alone is in PDF_TOOLS.md 5.5.
  const nothingAdded = 'so no level can make it smaller; nothing was added.';
  if (several) {
    if (recodable === 0) return { message: 'No images to reduce', detail: `${label} would not make these files smaller: none of them has images Compress can reduce.` };
    return { message: 'Already compact at this level', detail: `${label} would not make these files smaller.${level === 'extreme' ? '' : ' A stronger level may still make them smaller.'}` };
  }
  if (withImages === 0) return { message: 'No images to reduce', detail: `This file has no images to reduce, ${nothingAdded}` };
  if (recodable === 0) return { message: 'Its images cannot be reduced', detail: `Its images are of a kind Compress cannot reduce, ${nothingAdded}` };
  return { message: 'Already compact at this level', detail: `${label} would not make this file smaller.${level === 'extreme' ? '' : ' A stronger level may still make it smaller.'}` };
}

async function compress(run: Run, inputs: WorkingFile[], opts: CompressRunOptions): Promise<Made> {
  if ('fit' in opts) return compressToFit(run, inputs, opts);
  if (inputs.length === 0 || inputs.some((f) => f.kind !== 'pdf')) throw wrongInput('Only PDFs can be compressed.');
  const label = COMPRESS_LEVELS[opts.level]?.label ?? opts.level;
  const STEPS = 1000; // per file, so several files share one bar
  const several = inputs.length > 1;
  const files: WorkingFile[] = [];
  const compact: string[] = [];
  // How many of the compact files have images a level can recode, and whether any has images at all (user Q&A
  // 1.20: "a stronger level may still make it smaller" only when one has something to work on).
  let compactRecodable = 0;
  let compactWithImages = 0;
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
        if ((outcome.imagesRecodable ?? outcome.imagesFound) > 0) compactRecodable += 1;
        if (outcome.imagesFound > 0) compactWithImages += 1;
        continue;
      }
      const saved = percentSmaller(outcome.originalSize, outcome.newSize);
      // Sizes that read differently: never "1.0 MB → 1.0 MB" for a result 1% smaller (user Q&A 5.8).
      const [from, to] = sizesText(outcome.originalSize, outcome.newSize).split(' → ');
      const summary = operationSummary('compress', { level: opts.level, saved, from, to });
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
    return { files, describe: () => nothingMade(label, opts.level, several, compactRecodable, compactWithImages) };
  }
  const sizes = `${percentSmaller(before, after)}% smaller: ${sizesText(before, after)}`;
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

/** "text_top_left" for the record: the slot of a header or footer line as an option key. */
const textKey = (slot: string) => `text_${slot.replace(/-/g, '_')}`;

/**
 * Page numbers' record, flat (strings, numbers, booleans): the phase 1 fields and the phase 2 choices, counts
 * and choices only (lead's ruling on REV-B B1). A header or footer line is recorded as it is only when it is a
 * template of tokens and punctuation ("{client} - {fy}"), else as custom text with its length and the tokens
 * it uses (activity.ts typedTextRecord); the text around a custom number the same way (it fills no tokens).
 * Never a typed text, and never the token values (file, client, financial year, date).
 */
export function pageNumberRecord(numbers: PageNumberRunOptions): Record<string, string | number | boolean> {
  const { color, texts, tokens, prefix, suffix, ...rest } = numbers;
  void tokens;
  const options: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) options[key] = value;
  }
  options.color = rgbToHex(color);
  const put = (key: string, text: string, lengthKey: string, usesKey: string, tokenNames: readonly string[]) => {
    const typed = typedTextRecord(text, [], tokenNames);
    options[key] = typed.value;
    if (typed.length !== undefined) options[lengthKey] = typed.length;
    if (typed.uses) options[usesKey] = typed.uses;
  };
  if (numbers.format === 'custom') {
    if (prefix) put('prefix', prefix, 'prefixLength', 'prefixUses', []);
    if (suffix) put('suffix', suffix, 'suffixLength', 'suffixUses', []);
  }
  for (const [slot, text] of Object.entries(texts ?? {})) {
    if (typeof text === 'string' && text !== '') put(textKey(slot), text, `${textKey(slot)}_length`, `${textKey(slot)}_uses`, HEADER_TEXT_TOKENS);
  }
  return options;
}

const NOTHING_ADDED = 'Nothing was added.';

/**
 * A refusal of the library (a text that does not fit on a page, a character the font cannot print) says
 * that nothing changed, as Watermark's does (UX principle 9). A Stop or a change of engagement is not a
 * PdfToolsError and passes through as it is.
 */
function saysNothingAdded(error: unknown): unknown {
  if (!(error instanceof PdfToolsError) || error.message.endsWith(NOTHING_ADDED)) return error;
  return new PdfToolsError(error.code, `${error.message} ${NOTHING_ADDED}`);
}

async function numberPages(run: Run, inputs: WorkingFile[], opts: PageNumbersRunOptions): Promise<Made> {
  const source = onePdf(inputs);
  // The numbered copy is about the size of the source: refuse now if the list cannot take it (as Watermark does).
  run.ensureRoom(source.size, 'The numbered file');
  const numbers = opts.numbers;
  const headerFooter = Object.values(numbers.texts ?? {}).some((text) => typeof text === 'string' && text !== '');
  const numbersOn = numbers.numbersOn !== false;
  const what = numbersOn ? (headerFooter ? 'page numbers, header and footer' : 'page numbers') : 'the header and footer';
  await run.slowStep(`Adding ${what}…`);
  const report = emptyMarkReport();
  const onPage = pageByPage(run, (page, total) => `Adding ${what} (page ${page} of ${total})…`);
  let bytes: Uint8Array;
  try {
    bytes = await run.deps.addPageNumbers(source.bytes, numbers, { onPage, report, check: () => run.check() });
  } catch (error) {
    throw saysNothingAdded(error);
  }
  const name = resolveResultName(opts.name ?? '', defaultResultName('page-numbers', source.name, { headerFooter }), 'pdf');
  const summary = operationSummary('page-numbers', headerFooter ? { headerFooter: numbersOn ? 'with' : 'only' } : {});
  const file = await run.pdfResult(name, bytes, source.pageCount, [source], { summary, options: pageNumberRecord(numbers) }, { flags: markFlags(report) });
  const { fromPage, toPage } = numbers;
  const which = fromPage === 1 && toPage === source.pageCount ? 'every page' : `pages ${fromPage} to ${toPage}`;
  const added = numbersOn ? (headerFooter ? 'Numbers, header and footer' : 'Numbers') : 'Header and footer';
  const notes = markNotes(report, 'page-numbers');
  return {
    files: [file],
    describe: ([made]) => ({ message: `Made ${made.name}`, detail: [`${added} added to ${which}.`, ...notes].join(' '), tone: notes.length > 0 ? 'warning' : 'success' }),
  };
}

async function imagesIntoPdf(run: Run, inputs: WorkingFile[], opts: ImagesToPdfRunOptions): Promise<Made> {
  if (inputs.length === 0 || inputs.some((f) => f.kind !== 'image')) throw wrongInput('Only images can be turned into a PDF.');
  // pdf-lib reports no progress here and large PNGs take a while: show the busy state first.
  await run.slowStep(`Placing ${plural(inputs.length, 'image')}…`);
  const bytes = await run.deps.imagesToPdf(inputs.map(imageInput), { pageSize: opts.pageSize, marginPt: opts.marginPt });
  const name = resolveResultName(opts.name ?? '', defaultResultName('images-to-pdf', inputs[0].name), 'pdf');
  const record = { summary: operationSummary('images-to-pdf', { images: inputs.length }), options: { pageSize: opts.pageSize, marginPt: opts.marginPt } };
  const file = await run.pdfResult(name, bytes, inputs.length, inputs, record);
  return {
    files: [file],
    describe: ([made]) => ({ message: `Made ${made.name}`, detail: `${plural(inputs.length, 'image')}, one per page.${made.size >= LARGE_RESULT_BYTES ? ` ${IMAGES_SIZE_NOTE}` : ''}` }),
  };
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

/**
 * A phase 2 tool's step, from its run module (loaded the first time the tool runs). A module that is still
 * the integration stub, or that cannot be loaded, runs nothing and says why.
 */
function phaseTwoStep<T extends ModuleToolId>(tool: T) {
  return async (run: Run, inputs: WorkingFile[], opts: ModuleRunOptions[T]): Promise<Made> => {
    let module: RunModule<ModuleRunOptions[T]>;
    try {
      module = await RUN_MODULES[tool]();
    } catch {
      run.check(); // a change of engagement or a Stop while loading is not a failure to load
      throw new PdfToolsError('tool-load-failed', PHASE_TWO_ERROR_MESSAGES['tool-load-failed'] ?? 'This tool could not be loaded.');
    }
    run.check();
    if (module.BUILT !== true) throw new PdfToolsError('tool-not-built', 'This tool is still being built, so it cannot run yet.');
    return module.step(run, inputs, opts);
  };
}

const STEPS_BY_TOOL: { [T in ToolId]: (run: Run, inputs: WorkingFile[], opts: ToolRunOptions[T]) => Promise<Made> } = {
  merge,
  split,
  'delete-pages': removePages,
  compress,
  'page-numbers': numberPages,
  'images-to-pdf': imagesIntoPdf,
  'pdf-to-images': pdfIntoImages,
  bookmarks: phaseTwoStep('bookmarks'),
  'organise-pages': phaseTwoStep('organise-pages'),
  'resize-crop': phaseTwoStep('resize-crop'),
  watermark: phaseTwoStep('watermark'),
  protect: phaseTwoStep('protect'),
  redact: phaseTwoStep('redact'),
  'pdf-to-excel': phaseTwoStep('pdf-to-excel'),
  'pdf-to-word': phaseTwoStep('pdf-to-word'),
  'document-check': phaseTwoStep('document-check'),
  compare: phaseTwoStep('compare'),
  ocr: phaseTwoStep('ocr'),
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
    const extension = file.kind === 'pdf' ? 'pdf' : isOfficeFile(file) ? officeInfo(file).extension : file.mimeType === 'image/png' ? 'png' : 'jpg';
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
  const run: Run = new StepRun(tool, ctx, { ...defaultDeps, ...overrides });
  try {
    run.check();
    // The rule; the toolbar's reason is the convenience (T-064, decision 9). Without it Merge, which takes any
    // two files, would read a workbook as a PDF and end as "could not finish".
    if (inputs.some(isOfficeFile)) throw wrongInput(OFFICE_INPUT_REASON);
    run.ensureRoom();
    const made = await STEPS_BY_TOOL[tool](run, inputs, options);
    run.check();
    if (made.files.length === 0) {
      const said = made.describe([]);
      return { status: 'nothing', added: 0, ids: [], message: said.message, detail: said.detail };
    }

    // From here to addResults nothing is awaited, so the list cannot change in between.
    const before = run.listBytes();
    const adding = listHeldBytes(made.files); // a Protect result's preview bytes count too
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
    // What the copies still carry (comments, attachments, properties): one sentence, only when there is any.
    const detail = [said.detail, kept ? RESOURCES_KEPT_NOTE : null, carriedFilesNotice(files)].filter(Boolean).join(' ');
    return {
      status: 'added',
      added: files.length,
      ids: files.map((f) => f.id),
      message: said.message,
      detail: detail === '' ? said.detail : detail,
      tone: kept ? 'warning' : (said.tone ?? 'success'),
      listLarge: before <= run.deps.warnBytes && before + adding > run.deps.warnBytes,
    };
  } catch (error) {
    // The list moving on comes first: then nothing is said at all.
    if (error instanceof Stale || !run.live()) return { status: 'stale', added: 0, ids: [] };
    if (error instanceof Cancelled || ctx.signal.aborted) return { status: 'cancelled', added: 0, ids: [] };
    if (error instanceof PdfToolsError) throw error;
    throw new PdfToolsError('run-failed', 'The tool could not finish, and nothing was added. Open the file in a PDF reader, save a fresh copy and add that.');
  } finally {
    // Added, nothing made, failed, stopped or overtaken: the engine forgets the document text or file
    // name a pattern read last (matchedText.ts).
    forgetMatchedText();
  }
}
