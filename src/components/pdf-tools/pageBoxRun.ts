// The Resize or crop pages tool's run step, on the step contract of toolStep.ts: one PDF in, one copy out
// with the chosen pages resized, trimmed or given a margin. The library (pageBox.ts) changes the pages;
// this step checks the options again (the dialog's checks are a convenience), reports pages as it goes so
// Stop works between pages, records counts and choices only, and says in plain words what the library's
// report found (pagebox/pageBoxForm.ts).
import { changePageBoxes, emptyPageBoxReport, pageBoxError, type PageBoxOptions } from '@/lib/pdf-tools/pageBox';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { paperLabelOf, pageBoxRecord, pageBoxResultName, pageBoxRunNotes } from './pagebox/pageBoxForm';
import { resolveResultName } from './toolOptions';
import { onePdf, pageByPage, type ToolStep } from './toolStep';

export const BUILT = true;

/** What the dialog passes to run.start: the library's options and the result name. */
export interface PageBoxRunOptions {
  options: PageBoxOptions;
  name?: string;
}

const NOTHING_ADDED = ' Nothing was added.';
const invalid = (message: string) => new PdfToolsError('invalid-page-box-options', `${message}${NOTHING_ADDED}`);

/** A refusal of the library (a page a trim would leave too small) says that nothing changed (UX principle 9). */
function saysNothingAdded(error: unknown): unknown {
  if (!(error instanceof PdfToolsError) || error.message.endsWith(NOTHING_ADDED.trim())) return error;
  return new PdfToolsError(error.code, `${error.message}${NOTHING_ADDED}`);
}

const WORDS = {
  resize: { start: 'Resizing the pages…', page: 'Resizing page' },
  trim: { start: 'Trimming the pages…', page: 'Trimming page' },
  margin: { start: 'Adding the margins…', page: 'Adding margins to page' },
} as const;

export const step: ToolStep<PageBoxRunOptions> = async (run, inputs, opts) => {
  const source = onePdf(inputs);
  const options = opts?.options;
  const problem = pageBoxError(options as PageBoxOptions, source.pageCount);
  if (problem) throw invalid(problem);
  // The new file is about the size of the source: refuse now if the list cannot take it.
  run.ensureRoom(source.size, 'The new file');

  const words = WORDS[options.mode];
  await run.slowStep(words.start);
  const report = emptyPageBoxReport();
  const onPage = pageByPage(run, (page, total) => `${words.page} ${page} of ${total}…`);
  // The file is written in one step: say so and let it paint; Stop takes effect once it is written.
  const onSaving = () => run.slowStep('Writing the file…');
  let bytes: Uint8Array;
  try {
    bytes = await changePageBoxes(source.bytes, options, { onPage, onSaving, report, check: () => run.check() });
  } catch (error) {
    throw saysNothingAdded(error); // a Stop or a change of engagement passes through as it is
  }
  run.check();

  const size = options.mode === 'resize' ? paperLabelOf(options.size) : '';
  if (report.changed.length === 0) {
    return { files: [], describe: () => ({ message: `Nothing to change: every chosen page is already ${size}.${NOTHING_ADDED}` }) };
  }
  const name = resolveResultName(opts.name ?? '', pageBoxResultName(source.name, options.mode === 'resize' ? { mode: 'resize', cropKind: 'trim' } : { mode: 'crop', cropKind: options.mode }), 'pdf');
  const file = await run.pdfResult(name, bytes, source.pageCount, [source], pageBoxRecord(options, report, source.pageCount, size));
  const { done, notes } = pageBoxRunNotes(report, options, size);
  return {
    files: [file],
    describe: ([made]) => ({ message: `Made ${made.name}`, detail: [done, ...notes].join(' '), tone: notes.length > 0 ? 'warning' : 'success' }),
  };
};
