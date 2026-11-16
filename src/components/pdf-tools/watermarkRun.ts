// The Watermark tool's run step (design 5.16), on the step contract of toolStep.ts: one PDF in, one
// marked copy out. The marks library (watermark.ts) draws; this step checks the options again (the
// dialog's checks are a convenience), reports pages as it goes so Stop works between pages, records
// choices only (marks/watermarkForm.ts watermarkRecord: never a typed text, the client's name or the logo's
// file name), and says in plain words what the library's report found (markNotes.ts).
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { addWatermark, emptyMarkReport, watermarkError, type WatermarkOptions } from '@/lib/pdf-tools/watermark';
import { markMayBeMisplaced, watermarkRunNotes } from './marks/markNotes';
import { watermarkRecord } from './marks/watermarkForm';
import { resolveResultName } from './toolOptions';
import { onePdf, pageByPage, type ToolStep } from './toolStep';

export const BUILT = true;

/** What the Watermark dialog passes to run.start: the library's options (tokens filled in when Run was pressed) and the result name. */
export interface WatermarkRunOptions {
  options: WatermarkOptions;
  name?: string;
}

const NOTHING_ADDED = ' Nothing was added.';
const invalid = (message: string) => new PdfToolsError('invalid-watermark-options', `${message}${NOTHING_ADDED}`);

/** A refusal of the library (a character, a mark that does not fit) says that nothing changed (UX principle 9). */
function saysNothingAdded(error: unknown): unknown {
  if (!(error instanceof PdfToolsError) || error.message.endsWith(NOTHING_ADDED.trim())) return error;
  return new PdfToolsError(error.code, `${error.message}${NOTHING_ADDED}`);
}

/** "Watermark", "Stamp and logo", "Watermark, stamp and logo". */
function partsInWords(options: WatermarkOptions): string {
  const parts = [options.watermark && 'watermark', options.stamp && 'stamp', options.logo && 'logo'].filter((p): p is string => Boolean(p));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function pagesInWords(options: WatermarkOptions, pageCount: number): string {
  const { pages } = options;
  if (pages === 'first') return 'page 1';
  if (pages.from === 1 && pages.to === pageCount) return pageCount === 1 ? 'the page' : `all ${pageCount} pages`;
  return pages.from === pages.to ? `page ${pages.from}` : `pages ${pages.from} to ${pages.to}`;
}

export const step: ToolStep<WatermarkRunOptions> = async (run, inputs, opts) => {
  const source = onePdf(inputs);
  const options = opts.options;
  if (!options?.tokens || typeof options.tokens.date !== 'string' || typeof options.tokens.client !== 'string') {
    throw invalid('The date and client name for the marks are missing. Close the dialog and try again.');
  }
  const problem = watermarkError(options, source.pageCount);
  if (problem) throw invalid(problem);
  // The marked copy is about the size of the source: refuse now if the list cannot take it.
  run.ensureRoom(source.size, 'The marked file');

  const what = partsInWords(options);
  await run.slowStep(`Adding the ${what.toLowerCase()}…`);
  const report = emptyMarkReport();
  const onPage = pageByPage(run, (page, total) => `Adding the ${what.toLowerCase()} (page ${page} of ${total})…`);
  // Unsupported characters (also those the client name brings in) and marks that do not fit are refused
  // by the library before anything is drawn, as a PdfToolsError with a plain message.
  let bytes: Uint8Array;
  try {
    bytes = await addWatermark(source.bytes, options, { onPage, report, check: () => run.check() });
  } catch (error) {
    throw saysNothingAdded(error); // a Stop or a change of engagement passes through as it is
  }
  run.check();

  const name = resolveResultName(opts.name ?? '', defaultResultName('watermark', source.name, { stampOnly: !options.watermark }), 'pdf');
  const record = watermarkRecord(options, source.pageCount);
  const file = await run.pdfResult(name, bytes, source.pageCount, [source], record, { flags: markMayBeMisplaced(report) ? { markMayBeMisplaced: true } : {} });
  const notes = watermarkRunNotes(report);
  const done = `${what} added to ${pagesInWords(options, source.pageCount)}.`;
  return {
    files: [file],
    describe: ([made]) => ({ message: `Made ${made.name}`, detail: [done, ...notes].join(' '), tone: notes.length > 0 ? 'warning' : 'success' }),
  };
};
