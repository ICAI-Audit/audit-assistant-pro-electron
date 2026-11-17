// Split into several files (design 5.3, phase 2): a separate file for each typed range ("1-32, 65-96"
// gives two files), or one file for each main bookmark. runTool.ts's Split step hands these two modes
// here; one file with the chosen pages, one range of pages and equal parts stay in runTool.ts as they were.
//
// - The typed list is read again here with the page parser's own words (the dialog's reading is a convenience).
// - Nothing is added unless every file was made and checked: a stop, a change of engagement or a failure adds
//   nothing (runTool adds all the results at once at the end).
// - The list's room is checked before anything is made and again as each file is made, so a run that cannot
//   fit stops at the first file that takes the list over, not after making them all.
// - Each file is checked as every result is (run.pdfResult) and gets its own record: its pages and its place
//   among the files, never a bookmark's title (the title is only in the file's name).
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import { splitAtBookmarks, splitParts, type BookmarkReport, type OrganiseReport, type SplitPartsOptions } from '@/lib/pdf-tools/organise';
import {
  bookmarkPartName,
  parseRangeParts,
  partCoverage,
  partPageCount,
  partSummary,
  partText,
  rangePartName,
  type PagePart,
} from '@/lib/pdf-tools/splitPlan';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { formatBytes, plural } from './format';
import { pagesInNoFile } from './splitForm';
import { resolveStem } from './toolOptions';
import type { Made, Run } from './toolStep';

/** "A separate file for each range" (`pages` as typed) and "At bookmarks"; `stem` is what the files are named from. */
export type SplitPartsRunOptions = { mode: 'ranges'; pages: string; stem?: string } | { mode: 'bookmarks'; stem?: string };

const partLabel = (index: number, total: number) => `Splitting… part ${index + 1} of ${total}`;

/** The step for the two modes: makes the files, checks each, and says what was made. */
export async function splitIntoFiles(run: Run, source: WorkingFile & { pageCount: number }, opts: SplitPartsRunOptions): Promise<Made> {
  const stem = resolveStem(opts.stem ?? '', stripExtension(source.name));
  const ranges = opts.mode === 'ranges' ? parseRangeParts(opts.pages, source.pageCount) : null;
  // Before anything is made: a full list refuses now, and what it holds is what the files are added to.
  run.ensureRoom(0, 'The files');
  const listBytes = run.listBytes();
  const max = run.deps.maxBytes;

  // The bar follows the pages copied; the label names the file being made.
  let pagesBefore: number[] = [];
  let totalPages = 0;
  let step = 1;
  let madeBytes = 0;
  const reports: (OrganiseReport & BookmarkReport)[] = [];
  const hooks: SplitPartsOptions = {
    reports,
    // A Stop pressed while the source is still being read lands within the read (FIX-A2 follow-up).
    check: () => run.check(),
    onPlan: (parts) => {
      pagesBefore = parts.map((_, k) => parts.slice(0, k).reduce((sum, part) => sum + partPageCount(part), 0));
      totalPages = parts.reduce((sum, part) => sum + partPageCount(part), 0);
      step = Math.max(1, Math.ceil(totalPages / 100));
    },
    onPart: async (k, total) => {
      run.progress(pagesBefore[k] ?? 0, totalPages, partLabel(k, total));
      await run.deps.yieldToUi();
      run.check();
    },
    onPage: async (k, done) => {
      const page = (pagesBefore[k] ?? 0) + done;
      if (done === 0 || page % step !== 0) return;
      run.progress(page, totalPages, partLabel(k, pagesBefore.length));
      await run.deps.yieldToUi();
      run.check();
    },
    onPartMade: (bytes) => {
      madeBytes += bytes.byteLength;
      if (listBytes + madeBytes > max) {
        throw new PdfToolsError('list-full', `The files would take the list over ${formatBytes(max)}. Nothing was added; make fewer files or remove some from the list.`);
      }
    },
  };

  let parts: PagePart[];
  let names: string[];
  let made: Uint8Array[];
  if (ranges) {
    await run.slowStep('Splitting…');
    made = await splitParts(source.bytes, ranges, hooks);
    parts = ranges;
    names = ranges.map((part) => rangePartName(stem, part));
  } else {
    await run.slowStep('Reading the bookmarks…');
    const result = await splitAtBookmarks(source.bytes, hooks);
    made = result.parts;
    parts = result.plan.sections;
    names = result.plan.sections.map((section, i, all) => bookmarkPartName(stem, i + 1, all.length, section.title));
  }
  run.check();

  // A name given twice (a range typed twice) is numbered when the files are added, as every name is
  // (runTool's withUniqueNames: " (2)", " (3)"), which is what the dialog's list shows (uniqueNames).
  const total = parts.length;
  const groupId = total > 1 ? run.deps.newId() : undefined;
  const asTyped = ranges ? ranges.map(partText).join(', ') : null;
  const files: WorkingFile[] = [];
  for (const [i, bytes] of made.entries()) {
    run.progress(i, total, `Checking part ${i + 1} of ${total}…`);
    const part = parts[i];
    const options: Record<string, string | number> = { mode: opts.mode, pages: partText(part), part: i + 1, parts: total };
    if (asTyped !== null) options.ranges = asTyped;
    const record = { summary: partSummary(opts.mode, part, i + 1, total), options };
    files.push(await run.pdfResult(names[i], bytes, partPageCount(part), [source], record, { groupId, report: reports[i] }));
    await run.deps.yieldToUi();
  }

  // With several files, the pages none of them holds are said again (one file is plainly an extract).
  const missing = ranges && total > 1 ? pagesInNoFile(partCoverage(ranges, source.pageCount).missing) : null;
  return {
    files,
    describe: (results) => {
      if (results.length === 1) return { message: `Made ${results[0].name}`, detail: `${plural(partPageCount(parts[0]), 'page')} from ${source.name}.` };
      return {
        message: `Split ${source.name} into ${results.length} files`,
        detail: [`${results[0].name} to ${results[results.length - 1].name}.`, missing].filter(Boolean).join(' '),
      };
    },
  };
}
