// The PDF to Excel run step (design 5.11 and 13; contract XLS; T-064), on the step contract of toolStep.ts:
// one PDF in, one `<name>.xlsx` out, as an office row (kind 'office', no page count, no viewer).
//
// - Refused before anything is read: not exactly one PDF, more than 1,000 pages.
// - Each page is read (words and ruling lines, pageWordsReader.ts) and laid out (layout.ts) one at a time,
//   with the bar moving per page; a Stop or a change of engagement ends the run between pages, and the
//   reader is let go however the run ends. A file with no text on any page (every page under 20
//   characters, design 13) is refused: it looks scanned.
// - The sheets are planned (excelBuild.ts) and packed giving the window its turns, then written by exceljs
//   in a worker (excelWrite.worker.ts): exceljs holds its thread for seconds on a long statement. Where no
//   worker can be started, or it fails without a reply, the workbook is written here instead. A Stop ends
//   the worker at once.
// - The row is built with run.result, not run.pdfResult: a workbook is not a PDF. It carries no
//   "signature no longer valid" mark (a workbook has no signature to lose; the dialog says that the signed
//   original is unchanged); a source opened with its password is recorded "protection removed" as usual.
// - The record holds the sheets choice and counts only (excelForm.ts RECORD_KEYS), never a cell.
import { packSheets, planSheetsPaced, writePacked, XLSX_MIME, type PackedWorkbook, type SheetMode } from '@/lib/pdf-tools/excelBuild';
import { cleanFileName } from '@/lib/pdf-tools/fileNames';
import { countsAsScanned, pageLayout, type PageExtras, type PageLayout, type PageWords, type Segment } from '@/lib/pdf-tools/layout';
import { pacer, type Pace } from '@/lib/pdf-tools/pace';
import type { PictureFile } from '@/lib/pdf-tools/pdfPictures';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { onePdf, type ToolStep } from '../toolStep';
import { MAX_PAGES, recordOptions, resultDescription, SCANNED_MESSAGE, STEP_LABELS, summary, TOO_MANY_PAGES_MESSAGE, UNREADABLE_MESSAGE } from './excelForm';
import type { WriterReply } from './excelWrite.worker';
import { openWordsReader, type WordsReader } from './pageWordsReader';

export const BUILT = true;

export type { SheetMode } from '@/lib/pdf-tools/excelBuild';

/** What the dialog passes: the sheets choice and the result name (without .xlsx). */
export interface ExcelRunOptions {
  sheets: SheetMode;
  name?: string;
}

/** Opens a file for reading its words page by page (openWordsReader in the application). */
export type OpenWords = (file: Uint8Array, opts?: { signal?: AbortSignal }) => Promise<WordsReader>;
/** Writes the packed workbook (off the window's thread in the application). */
export type WriteWorkbook = (packed: PackedWorkbook, signal: AbortSignal, pace: Pace) => Promise<Uint8Array>;

const NOTHING_ADDED = 'Nothing was added.';
/** Past this much picture data, further pictures are left out of the workbook (as PDF to Word does). */
const MAX_PICTURE_BYTES = 60_000_000;
const refusal = (code: string, message: string) => new PdfToolsError(code, `${message} ${NOTHING_ADDED}`);
const WRITE_FAILED = 'The workbook could not be written, and nothing was added. Try again; if it fails again, restart the application.';
const WRITE_TIMEOUT = 'Writing the workbook stopped answering, and nothing was added. Try again; if it fails again, restart the application.';

// ---- the write off the window's thread ------------------------------------------------------------------

/** How long the worker may stay silent before the write is given up. exceljs's own rendering is one stretch
 * with no sign of life (about 3.4 s for 500 statement pages on one sheet here, on a busy machine), so the
 * limit is generous; Stop ends the worker at any time. */
export const WRITE_TIME_LIMIT_MS = 5 * 60_000;

/** The part of a Worker the write uses (a stand-in in tests). */
export interface WriterWorker {
  onmessage: ((event: MessageEvent<WriterReply>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: Event) => void) | null;
  postMessage(message: PackedWorkbook): void;
  terminate(): void;
}

function startWorker(): WriterWorker {
  return new Worker(new URL('./excelWrite.worker.ts', import.meta.url), { type: 'module', name: 'vera-pdf-tools-excel' }) as unknown as WriterWorker;
}

const abortError = () => new DOMException('Aborted', 'AbortError');

/**
 * Writes in a worker, given a copy of the packed sheets (kept here, so a worker that cannot start or fails
 * without a reply is replaced by writing here). Rejects with an AbortError when `signal` is aborted (the
 * worker is ended at once).
 */
export function writeOffThread(packed: PackedWorkbook, signal: AbortSignal, pace: Pace, start: () => WriterWorker = startWorker, timeoutMs = WRITE_TIME_LIMIT_MS): Promise<Uint8Array> {
  if (signal.aborted) return Promise.reject(abortError());
  let worker: WriterWorker;
  try {
    worker = start();
  } catch {
    return writePacked(packed, pace);
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(abortError());
    };
    const silent = () => {
      if (settled) return;
      finish();
      reject(new PdfToolsError('excel-write-timeout', WRITE_TIMEOUT));
    };
    let timer = setTimeout(silent, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    const writeHere = (event: Event) => {
      event.preventDefault?.();
      if (settled) return;
      finish();
      writePacked(packed, pace).then(resolve, reject);
    };
    worker.onmessage = (event) => {
      if (settled) return;
      const reply = event.data;
      if ('alive' in reply) {
        clearTimeout(timer);
        timer = setTimeout(silent, timeoutMs);
        return;
      }
      finish();
      if (reply.ok) resolve(reply.bytes);
      else reject(new PdfToolsError('excel-write-failed', WRITE_FAILED));
    };
    worker.onerror = writeHere;
    worker.onmessageerror = writeHere;
    try {
      worker.postMessage(packed);
    } catch {
      finish();
      writePacked(packed, pace).then(resolve, reject);
    }
  });
}

const defaultWrite: WriteWorkbook = (packed, signal, pace) => (typeof Worker === 'function' ? writeOffThread(packed, signal, pace) : writePacked(packed, pace));

// ---- the step ---------------------------------------------------------------------------------------------

/** The result name: the typed stem (or the file's own) with .xlsx, cleaned as every result name is. */
function resultName(typed: unknown, sourceName: string): string {
  const text = typeof typed === 'string' ? typed.trim() : '';
  const stem = text.toLowerCase().endsWith('.xlsx') ? text.slice(0, -'.xlsx'.length) : text;
  return stem.replace(/[\s.\\/:*?"<>|]/g, '') === '' ? defaultResultName('pdf-to-excel', sourceName) : cleanFileName(text, 'xlsx');
}

export interface StepParts {
  /** One page's layout (layout.ts pageLayout). */
  layout?: (page: PageWords, segments: readonly Segment[], extras?: PageExtras) => PageLayout;
  write?: WriteWorkbook;
}

/** The step over a words reader (the test seam; the application's step reads with openWordsReader). */
export function createStep(open: OpenWords, parts: StepParts = {}): ToolStep<ExcelRunOptions> {
  const layoutOf = parts.layout ?? pageLayout;
  const write = parts.write ?? defaultWrite;
  return async (run, inputs, options) => {
    const source = onePdf(inputs);
    if (source.pageCount > MAX_PAGES) throw refusal('excel-too-many-pages', TOO_MANY_PAGES_MESSAGE);
    const sheetMode: SheetMode = options?.sheets === 'per-page' ? 'per-page' : 'one-sheet';
    const name = resultName(options?.name, source.name);
    run.ensureRoom(0, 'The workbook');
    const { signal } = run.ctx;
    const pace = pacer(() => run.check());
    // A library's own error during a Stop or a change of engagement is the run's: say nothing more.
    const passOn = (error: unknown): never => {
      run.check();
      throw error;
    };

    await run.slowStep(STEP_LABELS.opening);
    let reader: WordsReader;
    try {
      reader = await open(source.bytes, { signal });
    } catch (error) {
      if (!run.live() || signal.aborted || error instanceof PdfToolsError) passOn(error);
      throw new PdfToolsError('excel-unreadable', UNREADABLE_MESSAGE);
    }
    const layouts: PageLayout[] = [];
    // Each page's pictures as files, for the sheet (null: a kind that is not carried over, one that lies behind the
    // text, or past the room given to pictures). A file is made only for a picture that goes on the sheet.
    const pictures: (PictureFile | null)[][] = [];
    const counted = new Set<PictureFile>();
    let pictureBytes = 0;
    let scanned = true;
    try {
      const total = Math.min(reader.pageCount, source.pageCount);
      for (let i = 0; i < total; i++) {
        run.progress(i, total, STEP_LABELS.reading(i + 1, total));
        let page: Awaited<ReturnType<WordsReader['page']>>;
        try {
          page = await reader.page(i);
        } catch (error) {
          if (!run.live() || signal.aborted) passOn(error);
          throw new PdfToolsError('excel-unreadable', UNREADABLE_MESSAGE);
        }
        run.check();
        if (!countsAsScanned(page.words)) scanned = false;
        const layout = layoutOf(page.words, page.segments, page.extras);
        layouts.push(layout);
        const files: (PictureFile | null)[] = [];
        for (const p of layout.pictures ?? []) {
          const file = p.behind || pictureBytes > MAX_PICTURE_BYTES ? null : (page.picture?.(p.index) ?? null);
          if (file && !counted.has(file)) {
            counted.add(file);
            pictureBytes += file.bytes.byteLength;
          }
          files[p.index] = file;
        }
        pictures.push(files);
        const turn = pace();
        if (turn) await turn;
      }
    } finally {
      reader.close();
    }
    if (scanned) throw refusal('excel-scanned', SCANNED_MESSAGE);

    await run.slowStep(STEP_LABELS.placing);
    const { sheets, report } = await planSheetsPaced(layouts, sheetMode, pace, pictures);
    run.check();

    await run.slowStep(STEP_LABELS.writing);
    const packed = await packSheets(sheets, pace);
    run.check();
    let bytes: Uint8Array;
    try {
      bytes = await write(packed, signal, pace);
    } catch (error) {
      if (!run.live() || signal.aborted || error instanceof PdfToolsError) passOn(error);
      throw new PdfToolsError('excel-write-failed', WRITE_FAILED);
    }
    run.check();
    run.ensureRoom(bytes.byteLength, 'The workbook');

    const row = run.result(
      { name, bytes, kind: 'office', mimeType: XLSX_MIME, pageCount: null },
      [source],
      { summary: summary(report), options: recordOptions({ ...report, sheetMode }) },
    );
    return { files: [row], describe: ([made]) => resultDescription(made.name, report) };
  };
}

export const step: ToolStep<ExcelRunOptions> = createStep(openWordsReader);
