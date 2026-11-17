// The Organise pages run step (design 5.15; plan Task B1), on the step contract of toolStep.ts.
//
// - The plan (organiseEdit.ts toPagePlan) is checked again here: a dialog's checks are a convenience.
// - A turn-only plan is made in the file itself and keeps everything; any move or removal goes through
//   the page copy of Split and Delete pages with the bookmarks carried and re-pointed (pageOrder.ts).
// - Pages are reported one by one, so the bar moves and Stop takes effect between pages; a second
//   pass of the library is said as such, and so is its check of every page after the last one.
// - One result, `<name>_organised.pdf`, re-opened and its page count checked by run.pdfResult, which
//   also marks a result of a signed file "Signature no longer valid" and flags bookmarks not carried.
// - The record says "Organised pages: 3 moved, 2 rotated, 1 removed" (the dialog's line) with the
//   metadata of design 5.15, and what the copy did not keep by kind (pageOrder.ts PageOrderReport); the
//   message adds the library's own sentences about it. Page numbers and kinds only: never a file name,
//   text or value from the file.
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { checkPagePlan, isTurnOnly, organiseNotes, organisePages, type PagePlan, type PageOrderReport } from '@/lib/pdf-tools/pageOrder';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { plural } from './format';
import { CHECKING_PAGES, pageLabeller } from './organise/organiseProgress';
import { changeLine, countsOfPlan, organiseRecord } from './organise/organiseSummary';
import { onePdf, pageByPage, type ToolStep } from './toolStep';
import { resolveResultName } from './toolOptions';

export const BUILT = true;

/** Plan B1: the new order and turns (organiseEdit.ts toPagePlan), and the result name typed in the dialog. */
export interface OrganisePagesRunOptions {
  plan: PagePlan;
  name?: string;
}

/** The plan as the dialog passed it, copied; anything that is not a plan is refused in plain words. */
function readPlan(value: unknown): PagePlan {
  const plan = value as Partial<PagePlan> | null | undefined;
  if (!plan || !Array.isArray(plan.order) || typeof plan.turns !== 'object' || plan.turns === null || Array.isArray(plan.turns)) {
    throw new PdfToolsError('invalid-page-list', 'The new page order could not be read. Close the dialog and try again.');
  }
  return { order: [...plan.order], turns: { ...plan.turns } };
}

/** What the copy did not keep, for the record: kinds and counts only. */
function notKept(report: PageOrderReport): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (report.notCarried && report.notCarried.length > 0) out.notCarried = report.notCarried.join(', ');
  if ((report.namedDestinationsDropped ?? 0) > 0) out.namedDestinationsDropped = report.namedDestinationsDropped!;
  if (report.pageLabelsDropped) out.pageLabelsDropped = true;
  return out;
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const step: ToolStep<OrganisePagesRunOptions> = async (run, inputs, options) => {
  const source = onePdf(inputs);
  const plan = readPlan(options?.plan);
  checkPagePlan(plan, source.pageCount);
  const counts = countsOfPlan(plan, source.pageCount);
  if (counts.moved + counts.turned + counts.removed === 0) {
    return { files: [], describe: () => ({ message: 'Nothing to change', detail: 'The pages are already in this order, and none is rotated or removed. Nothing was added.' }) };
  }

  const inPlace = isTurnOnly(plan, source.pageCount);
  await run.slowStep('Organising the pages…');
  const report: PageOrderReport = {};
  const pages = pageByPage(run, pageLabeller(inPlace));
  const onPage = async (done: number, total: number) => {
    await pages(done, total);
    // After the last page the library checks every page against the original, without reports.
    if (done === total - 1) run.progress(0, 0, CHECKING_PAGES);
  };
  const bytes = await organisePages(source.bytes, plan, { report, onPage, check: () => run.check() });
  run.check();
  run.progress(plan.order.length, plan.order.length, 'Checking the result…');

  const name = resolveResultName(options.name ?? '', defaultResultName('organise-pages', source.name), 'pdf');
  const libraryNotes = organiseNotes(report);
  const record = organiseRecord(plan, source.pageCount, libraryNotes);
  const file = await run.pdfResult(name, bytes, plan.order.length, [source], { summary: record.summary, options: { ...record.options, ...notKept(report) } }, { report });
  const dropped = report.bookmarksDropped ?? 0;
  const notes = [
    `${sentence(changeLine(counts))}.`,
    `${plural(counts.kept, 'page')}.`,
    dropped > 0 ? `${plural(dropped, 'bookmark')} ${dropped === 1 ? 'was' : 'were'} not carried.` : null,
    ...libraryNotes,
  ].filter((note): note is string => note !== null);
  return { files: [file], describe: ([made]) => ({ message: `Made ${made.name}`, detail: notes.join(' ') }) };
};
