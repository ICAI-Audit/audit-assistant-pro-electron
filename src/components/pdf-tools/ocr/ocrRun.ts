// The Make searchable run step (T-064, OCR part B; design 5.12; contract section 6), on the step contract of
// toolStep.ts: one PDF in, one searchable copy out, `<name>_searchable.pdf`. The pages look the same; the text
// the engine read on the pages without text is added to them as invisible text (ocrLayer.ts).
//
// The order (OCR-A-report.md, "What part B must implement"):
// 1. The file is read once with pdf-lib; the same document serves the page plan and the text layer.
// 2. The page plan (ocrPlan.ts): a page with fewer than 20 characters of text and anything drawn on it
//    is recognised; every other page is left as it is. The dialog has usually read the pages' kinds already and
//    passes them (`kinds`); they are used when they fit the file, else the step looks itself. No page to
//    recognise: nothing is added and the one sentence says why, before the engine is started.
// 3. The engine is started ("Getting the text reader ready…"). One engine, one worker, serves the run.
// 4. Each page to recognise is drawn whole at 300 dpi (ocrRender.ts), read by the engine within the per-page
//    time limit (60 s), and its words added to the page, without those the engine could not read (ocrReadable.ts:
//    print in another script, handwriting, stamps). A page that runs out of time is left exactly as it
//    was and named in the message. So is a page the engine fails on, or that cannot be drawn ("Page 5 could
//    not be read and was left as it was."): the run goes on with the next page, on a fresh worker (ruling of
//    18 November 2026). Only one page's picture is held at a time.
// 5. The figures are added up (ocrQuality.ts buildReport). No word read on any page: nothing is added.
// 6. The copy is saved with the window given its turns, checked and added with run.pdfResult (so a copy of a
//    signed file says its signature is no longer valid, and a removed password is recorded).
// The engine is closed however the run ends.
//
// Stop lands at once: inside a page the engine ends its worker and the page's wait ends with it; between
// pages run.check() sees it. Nothing is added. Besides Stop, only two things end the run with nothing added:
// the engine cannot start, or every page to recognise fails. After the engine has failed on three pages in a
// row it is not asked again (each new start may wait its 30 s limit): the remaining pages are left as they
// were and named with the others.
// The record is "Made searchable: 8 of 12 pages recognised" with the eleven counts of ocrForm.ts RECORD_KEYS:
// never a recognised word.
import type { PDFDocument, PDFPage } from 'pdf-lib';
import { displayedPage, PRODUCER } from '@/lib/pdf-tools/marks';
import { addTextLayer, prepareTextLayer } from '@/lib/pdf-tools/ocrLayer';
import { nothingToRecognise, planPages, readPlan, type OcrPlan, type PageKind } from '@/lib/pdf-tools/ocrPlan';
import { buildReport, pageQuality, type PageOutcome } from '@/lib/pdf-tools/ocrQuality';
import { readableWords } from '@/lib/pdf-tools/ocrReadable';
import { OCR_PAGE_TIME_LIMIT_MS, OcrPageTimedOut, type OcrEngine, type RecognisedPage } from '@/lib/pdf-tools/ocrTypes';
import { isStop, loadPaced, pacer, savePaced } from '@/lib/pdf-tools/pace';
import { PdfToolsError, PROTECTED_OUTPUT_REASON } from '@/lib/pdf-tools/types';
import { resolveResultName } from '../toolOptions';
import { onePdf, wrongInput, type Made, type ToolStep } from '../toolStep';
import { openAppEngine, type OpenEngine, type PageRecogniseOptions } from './ocrEngine';
import {
  ALL_PAGES_FAILED_MESSAGE,
  CHECKING_LABEL,
  ENGINE_FAILED_MESSAGE,
  NOTHING_READ_MESSAGE,
  nothingToRecogniseMessage,
  RECOGNISING_LABEL,
  recordOptions,
  resultDescription,
  resultWorthAdding,
  searchableName,
  STARTING_LABEL,
  summary,
  WRITING_LABEL,
} from './ocrForm';
import { appPages, type PagePicture, type PageSource } from './ocrRender';

export const BUILT = true;

/** The result name's stem, as the dialog's name field gives it, and the pages' kinds as the dialog read them. */
export interface OcrRunOptions {
  name?: string;
  kinds?: PageKind[];
}

export interface OcrRunLimits {
  /** The per-page time limit (ocrTypes.ts OCR_PAGE_TIME_LIMIT_MS); a test passes a short one. */
  pageTimeLimitMs?: number;
}

const KINDS: readonly PageKind[] = ['scanned', 'text', 'empty', 'unread'];

/** The dialog's kinds, if they are of a file of this many pages; otherwise null (the step looks itself). */
export function usableKinds(kinds: unknown, pageCount: number): PageKind[] | null {
  if (!Array.isArray(kinds) || kinds.length !== pageCount) return null;
  return kinds.every((kind) => KINDS.includes(kind as PageKind)) ? (kinds as PageKind[]) : null;
}

const unreadable = () => new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF, and nothing was added. It may be damaged.');
const engineFailed = () => new PdfToolsError('ocr-engine-failed', ENGINE_FAILED_MESSAGE);
const allPagesFailed = () => new PdfToolsError('ocr-all-pages-failed', ALL_PAGES_FAILED_MESSAGE);
/** After the engine has failed on this many pages in a row it is not asked again in this run. */
export const ENGINE_FAILURES_IN_A_ROW = 3;

/** The look at a file's pages was stopped (the dialog closed). */
export class LookStopped extends Error {
  constructor() {
    super('The look at the pages was stopped.');
    this.name = 'LookStopped';
  }
}

/**
 * The page plan of a file, for the dialog: the file is read, then each page's text count and picture share,
 * with the window given its turns. Rejects with LookStopped when `signal` fires, and with the reason when the
 * file or its pages cannot be read (the dialog then says nothing and the run looks itself).
 */
export async function lookAtPages(
  bytes: Uint8Array,
  pages: Pick<PageSource, 'pageChars'>,
  options: { signal?: AbortSignal; onPage?(done: number, total: number): void } = {},
): Promise<OcrPlan> {
  const { signal } = options;
  const check = () => {
    if (signal?.aborted) throw new LookStopped();
  };
  try {
    const doc = await loadPaced(bytes, { updateMetadata: false, check });
    return await readPlan(doc, { pageChars: (i) => pages.pageChars(bytes, i, { signal, priority: 'dialog' }) }, { pace: pacer(check), check, onPage: options.onPage });
  } catch (error) {
    check();
    throw error;
  }
}

/** Nothing was made: the dialog stays and shows the sentence. */
const nothing = (message: string): Made => ({ files: [], describe: () => ({ message }) });

/** The step, reading with `openEngine` and `pages` (the test seam: a stand-in engine and stand-in pictures). */
export function createStep(openEngine: OpenEngine, pages: PageSource, limits: OcrRunLimits = {}): ToolStep<OcrRunOptions> {
  const timeoutMs = limits.pageTimeLimitMs ?? OCR_PAGE_TIME_LIMIT_MS;
  return async (run, inputs, options) => {
    const source = onePdf(inputs);
    if (source.protectedOutput) throw wrongInput(PROTECTED_OUTPUT_REASON);
    const name = resolveResultName(typeof options?.name === 'string' ? options.name : '', searchableName(source.name), 'pdf');
    // The searchable copy is about the size of the source: refuse now if the list cannot take it.
    run.ensureRoom(source.size, 'The searchable file');
    const { signal } = run.ctx;
    const check = () => run.check();

    // 1. The file, read once.
    await run.slowStep(CHECKING_LABEL(1, source.pageCount));
    let doc: PDFDocument;
    let docPages: PDFPage[];
    try {
      doc = await loadPaced(source.bytes, { updateMetadata: false, check });
      docPages = doc.getPages(); // pdf-lib reads a file without a page tree and fails only here
    } catch (error) {
      if (isStop(error)) throw error;
      run.check();
      throw unreadable();
    }
    run.check();
    const pace = pacer(check);

    // 2. Which pages are recognised.
    const given = usableKinds(options?.kinds, docPages.length);
    let plan: OcrPlan;
    if (given) plan = planPages(given);
    else {
      plan = await readPlan(
        doc,
        { pageChars: (i) => pages.pageChars(source.bytes, i, { signal }) },
        // run.progress also checks: a Stop or a change of engagement ends the look between pages.
        { pace, check, onPage: (done, total) => run.progress(done, total, CHECKING_LABEL(Math.min(done + 1, total), total)) },
      );
    }
    run.check();
    if (nothingToRecognise(plan)) return nothing(nothingToRecogniseMessage(plan));
    const layer = await prepareTextLayer(doc, pace);
    run.check();

    // 3 and 4. The engine, then page by page.
    await run.slowStep(STARTING_LABEL);
    const outcomes: PageOutcome[] = [];
    let engine: OcrEngine | undefined;
    try {
      try {
        engine = await openEngine({ signal });
      } catch {
        run.check(); // a Stop or a change of engagement while it started is not a failure
        throw engineFailed();
      }
      run.check();
      const total = plan.toRecognise.length;
      const began = Date.now();
      let engineFailures = 0;
      for (let n = 0; n < total; n++) {
        const pageIndex = plan.toRecognise[n];
        if (engineFailures >= ENGINE_FAILURES_IN_A_ROW) {
          outcomes.push({ pageIndex, status: 'failed' });
          continue;
        }
        // Once a page has been measured, the label says about how long the rest will take at that pace.
        const secondsLeft = n > 0 ? ((Date.now() - began) / 1000 / n) * (total - n) : undefined;
        const label = RECOGNISING_LABEL(pageIndex + 1, n + 1, total, secondsLeft);
        run.progress(n, total, label);

        let picture: PagePicture;
        try {
          picture = await pages.picture(source.bytes, pageIndex, { signal });
        } catch {
          run.check(); // Stop or a change of engagement ends the run as such
          // The page could not be drawn: it is left as it was and named; the run goes on.
          outcomes.push({ pageIndex, status: 'failed' });
          continue;
        }
        run.check();

        const pageOptions: PageRecogniseOptions = {
          signal,
          timeoutMs,
          dpi: picture.dpi,
          // Inside the engine's work: a Stop is left to the signal, and a run that moved on says nothing.
          onProgress: (share) => {
            if (run.live() && !signal.aborted) run.ctx.onProgress(n + Math.min(1, Math.max(0, share)), total, label);
          },
        };
        let recognised: RecognisedPage | null = null;
        let failed = false;
        try {
          recognised = await engine.recognise(picture.image, pageOptions);
        } catch (error) {
          run.check(); // Stop (OcrStopped) or a change of engagement ends the run as such
          // Out of time, or the engine failed on this page: either way the page is left as it was and named.
          failed = !(error instanceof OcrPageTimedOut);
        }
        run.check();
        engineFailures = failed ? engineFailures + 1 : 0;

        if (failed) outcomes.push({ pageIndex, status: 'failed' });
        else if (!recognised) outcomes.push({ pageIndex, status: 'timed-out' });
        else {
          const page = docPages[pageIndex];
          // What the engine could not read (another script, handwriting, stamps) is left out, and counted.
          const readable = readableWords(recognised);
          const added = addTextLayer(doc, page, layer, readable.page);
          outcomes.push({ pageIndex, status: 'recognised', quality: pageQuality(pageIndex, readable.page, displayedPage(page), readable.leftOut), layer: added });
        }
        const turn = pace();
        if (turn) await turn;
      }
    } finally {
      await engine?.close().catch(() => undefined);
    }

    // 5 and 6. The figures, then the file.
    if (outcomes.every((o) => o.status === 'failed')) throw allPagesFailed();
    const report = buildReport(plan, outcomes);
    if (!resultWorthAdding(report)) return nothing(NOTHING_READ_MESSAGE);
    await run.slowStep(WRITING_LABEL);
    doc.setProducer(PRODUCER); // the Creator stays the source's, as Page numbers leaves it
    const bytes = await savePaced(doc);
    run.check();
    const file = await run.pdfResult(name, bytes, source.pageCount, [source], { summary: summary(report), options: recordOptions(report) });
    return { files: [file], describe: ([made]) => resultDescription(made?.name ?? name, report) };
  };
}

/** The application's step: the real engine and the application's renderer. */
export const step: ToolStep<OcrRunOptions> = createStep(openAppEngine, appPages);
