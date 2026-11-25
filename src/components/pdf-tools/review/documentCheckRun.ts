// The Document check run step (T-064, contract REV; design 5.13), on the step contract of toolStep.ts: one PDF
// in, one PDF report out, `<name>_check.pdf`.
//
// - The facts come from the dialog, which read them when it opened (options.facts). They are checked again
//   here (the dialog's checks are a convenience): facts of another shape, page count, size or protection are
//   read again from the file, page by page ("Reading page N of M"), with Stop seen between pages.
// - The report (checkReport.ts) is built from nothing, so it carries no signature and no title or author. It is
//   checked with run.verifyPdf and added with run.result, never run.pdfResult, which would mark it "Signature
//   no longer valid" and "Still carries…" (contract decision 8).
// - The record is "Document check: 12 pages" with counts and the protection choice only (documentCheckForm.ts
//   RECORD_KEYS): never a property value, a signer's name or a file's title.
// - `createStep(reader)` is the test seam for reading text; `step` reads with the app's pdf.js renderer.
import { buildCheckReportCounted } from '@/lib/pdf-tools/checkReport';
import { charsIn, checkDocument, isDocumentFacts, type DocumentFacts } from '@/lib/pdf-tools/documentCheck';
import { carriesAnything } from '@/lib/pdf-tools/inspect';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError, PROTECTED_OUTPUT_REASON, type WorkingFile } from '@/lib/pdf-tools/types';
import * as renderer from '../pdfRenderer';
import type { Priority } from '../renderQueue';
import { resolveResultName } from '../toolOptions';
import { onePdf, wrongInput, type ToolStep } from '../toolStep';
import { READING_FILE, readingLabel, recordOptions, resultDescription, summary, WRITING_LABEL } from './documentCheckForm';

export const BUILT = true;

/** The facts the dialog already read (checked again by the step), and the report's name. */
export interface DocumentCheckRunOptions {
  name?: string;
  facts?: DocumentFacts;
}

/** Counts a page's text: non-space characters (0-based page index). */
export interface PageTextReader {
  pageChars(file: Uint8Array, pageIndex: number, options?: { signal?: AbortSignal; priority?: Priority }): Promise<number>;
}

/** The app's reader: pdf.js through the shared renderer (a tool run's priority unless asked otherwise). */
export const appReader: PageTextReader = {
  pageChars: async (file, pageIndex, options) => charsIn((await renderer.pageTextContent(file, pageIndex, { signal: options?.signal, priority: options?.priority ?? 'run' })).items),
};

const protectionOf = (source: WorkingFile): DocumentFacts['protection'] => (source.wasProtected ? (source.hasRestrictions ? 'restrictions' : 'password') : 'none');

/** The dialog's facts, if they are of this file as the list holds it; otherwise null (the step reads them itself). */
export function usableFacts(facts: unknown, source: WorkingFile & { pageCount: number }): DocumentFacts | null {
  if (!isDocumentFacts(facts)) return null;
  if (facts.pageCount !== source.pageCount || facts.sizeBytes !== source.size) return null;
  // A copy opened with its password is never reported as unprotected, nor the other way round.
  return facts.protection === protectionOf(source) ? facts : null;
}

const checkFailed = () =>
  new PdfToolsError('check-failed', 'The file could not be checked, and nothing was added. Open the file in a PDF reader, save a fresh copy and add that.');

/** The step, reading page text with `reader`; `now` dates the report. */
export function createStep(reader: PageTextReader, now: () => Date = () => new Date()): ToolStep<DocumentCheckRunOptions> {
  return async (run, inputs, options) => {
    const source = onePdf(inputs);
    if (source.protectedOutput) throw wrongInput(PROTECTED_OUTPUT_REASON);
    const name = resolveResultName(options?.name ?? '', defaultResultName('document-check', source.name), 'pdf');
    run.ensureRoom();

    let facts = usableFacts(options?.facts, source);
    if (!facts) {
      await run.slowStep(READING_FILE);
      const signal = run.ctx.signal;
      try {
        facts = await checkDocument(source.bytes, source, { pageChars: (i) => reader.pageChars(source.bytes, i, { signal }) }, {
          signal,
          // run.progress also checks: a Stop or a change of engagement ends the read between pages.
          onPage: (done, total) => run.progress(done, total, readingLabel(Math.min(done + 1, total), total)),
        });
      } catch (error) {
        run.check(); // a Stop (CheckStopped) or a change of engagement ends the run as such, never as a failure
        throw error instanceof PdfToolsError ? error : checkFailed();
      }
    }
    run.check();

    await run.slowStep(WRITING_LABEL);
    let report;
    try {
      report = await buildCheckReportCounted(source.name, facts, now());
    } catch {
      run.check();
      throw checkFailed();
    }
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
        ...(carriesAnything(info.carried) ? { carried: info.carried } : {}),
      },
      [source],
      { summary: summary(facts), options: recordOptions(facts) },
    );
    const signatures = facts.signatures.length;
    const { wordsNotShown } = report;
    return { files: [row], describe: ([made]) => resultDescription(made?.name ?? name, { signatures, wordsNotShown }) };
  };
}

export const step: ToolStep<DocumentCheckRunOptions> = createStep(appReader);
