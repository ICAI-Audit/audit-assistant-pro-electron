// The Compare run step (design 5.13 "Compare two versions"; contract T-064 decisions 3-6, 8, 15-17), on the
// step contract of toolStep.ts: two PDFs in (the earlier version named by the dialog), one report out,
// `<later name>_changes.pdf`.
//
// - Each page's text is read through the page renderer (pdfRenderer.ts pageTextContent, as a tool run's
//   job) and joined as Redact joins it (pageText.ts buildPageText(...).text). `createStep(source)` takes
//   another reader: the test seam.
// - A file with no text on any page is refused: it must be made searchable first. A file over 1,000 pages
//   is refused before anything is read.
// - Identical text adds nothing and says "No text differences found.".
// - The report (compareReport.ts) is checked with run.verifyPdf and its row built with run.result, never
//   run.pdfResult: a report is a new document, so it is not badged "Signature no longer valid", and it
//   carries no title or author (decision 8).
// - Reading, comparing and writing give the window its turns (pace.ts) and see Stop; a Stop or a change of
//   engagement adds nothing.
// - The record is "Compared 2 files: 7 of 42 pages differ" with the comparison's counts only: never a word of
//   either document.
import { buildCompareReport } from '@/lib/pdf-tools/compareReport';
import { compareTexts, pageHasNoText, pagesThatDiffer } from '@/lib/pdf-tools/compareText';
import { pacer, type Pace } from '@/lib/pdf-tools/pace';
import { buildPageText, type FontStyleLike, type TextItemLike } from '@/lib/pdf-tools/pageText';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import * as renderer from '../pdfRenderer';
import { resolveResultName } from '../toolOptions';
import type { Run, ToolStep } from '../toolStep';
import {
  COMPARING,
  MAX_COMPARE_PAGES,
  noDifferencesDescription,
  readFailed,
  readingLabel,
  recordOptions,
  resultDescription,
  scanned,
  summary,
  tooManyPages,
  versions,
  WRITING,
  wrongFiles,
} from './compareForm';

export const BUILT = true;

/** What the dialog passes: which of the two files is the earlier version, and the report's name. */
export interface CompareRunOptions {
  earlierId: string;
  name?: string;
}

/** Where page text comes from (pdfRenderer.ts in the application; pdf.js in Node in the tests). */
export interface TextSource {
  pageTextContent(file: Uint8Array, pageIndex: number, options?: { signal?: AbortSignal }): Promise<{ items: TextItemLike[]; styles: Record<string, FontStyleLike> }>;
}

/** Pages asked of the renderer at once (each is its own job in its queue). */
const READ_BATCH = 8;
/** Room asked for before the work: a report is small. */
const REPORT_ROOM_BYTES = 256 * 1024;

type PdfFile = WorkingFile & { pageCount: number };

const isPdf = (f: WorkingFile): f is PdfFile => f.kind === 'pdf' && typeof f.pageCount === 'number' && f.pageCount > 0;

/** Every page's text of one file, with progress over both files; a Stop lands between pages. */
async function readTexts(run: Run, source: TextSource, file: PdfFile, which: 'earlier' | 'later', offset: number, total: number, pace: Pace): Promise<string[]> {
  const texts: string[] = [];
  for (let from = 0; from < file.pageCount; from += READ_BATCH) {
    const pages = Array.from({ length: Math.min(READ_BATCH, file.pageCount - from) }, (_, k) => from + k);
    run.progress(offset + from, total, readingLabel(which, from + 1, file.pageCount));
    let read: Awaited<ReturnType<TextSource['pageTextContent']>>[];
    try {
      read = await Promise.all(pages.map((page) => source.pageTextContent(file.bytes, page, { signal: run.ctx.signal })));
    } catch (error) {
      run.check(); // a Stop or a change of engagement is not a failure to read
      if (error instanceof PdfToolsError) throw error;
      throw readFailed(file.name);
    }
    run.check();
    for (const [k, content] of read.entries()) {
      texts.push(buildPageText(pages[k], content.items, content.styles, [0, 0, 0, 0], 0).text);
      const turn = pace();
      if (turn) await turn;
    }
  }
  run.progress(offset + file.pageCount, total, readingLabel(which, file.pageCount, file.pageCount));
  return texts;
}

/** The step, reading page text from `source`. */
export function createStep(source: TextSource): ToolStep<CompareRunOptions> {
  return async (run, inputs, options) => {
    if (inputs.length !== 2 || !inputs.every(isPdf)) throw wrongFiles();
    const chosen = versions(inputs as PdfFile[], typeof options?.earlierId === 'string' ? options.earlierId : '');
    if (!chosen) throw wrongFiles();
    const { earlier, later } = chosen;
    for (const file of [earlier, later]) if (file.pageCount > MAX_COMPARE_PAGES) throw tooManyPages(file.name);
    const name = resolveResultName(typeof options?.name === 'string' ? options.name : '', defaultResultName('compare', later.name), 'pdf');
    run.ensureRoom(REPORT_ROOM_BYTES, 'The report');

    const pace = pacer(() => run.check());
    const total = earlier.pageCount + later.pageCount;
    const earlierTexts = await readTexts(run, source, earlier, 'earlier', 0, total, pace);
    if (earlierTexts.every(pageHasNoText)) throw scanned(earlier.name);
    const laterTexts = await readTexts(run, source, later, 'later', earlier.pageCount, total, pace);
    if (laterTexts.every(pageHasNoText)) throw scanned(later.name);

    await run.slowStep(COMPARING);
    const comparison = await compareTexts(earlierTexts, laterTexts, pace);
    run.check();
    if (pagesThatDiffer(comparison) === 0) return { files: [], describe: () => noDifferencesDescription() };

    await run.slowStep(WRITING);
    const report = await buildCompareReport({ earlier: earlier.name, later: later.name }, comparison, new Date(), pace);
    run.check();
    const info = await run.verifyPdf(report.bytes, report.pages);
    run.check();
    const row = run.result(
      {
        name,
        bytes: report.bytes,
        kind: 'pdf',
        mimeType: 'application/pdf',
        pageCount: info.pageCount,
        hasFormFields: info.hasFormFields,
        hasBookmarks: info.hasBookmarks,
        hasPageLinks: info.hasPageLinks,
        hasAttachments: info.hasAttachments,
      },
      [earlier, later],
      { summary: summary(comparison), options: recordOptions(comparison) },
    );
    return { files: [row], describe: ([made]) => resultDescription(comparison, report, made?.name ?? name) };
  };
}

/** The application's reader: the page renderer, as a tool run's job. */
const rendererSource: TextSource = {
  pageTextContent: (file, page, options) => renderer.pageTextContent(file, page, { ...options, priority: 'run' }),
};

export const step: ToolStep<CompareRunOptions> = createStep(rendererSource);
