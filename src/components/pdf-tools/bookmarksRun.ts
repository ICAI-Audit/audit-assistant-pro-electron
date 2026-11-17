// The Bookmarks tool's run step (design 5.10, plan A3; the contract is at the top of toolStep.ts). It
// writes the edited tree into a re-saved copy of the one PDF chosen (the old bookmark objects deleted,
// so a deleted or renamed title is gone from the bytes), reads the saved bookmarks back to check them,
// and adds the copy as `<name>_bookmarked.pdf`. Bookmarks that open another file, launch something or
// run a script are not kept; the record says so. A signed source's copy is marked "Signature no longer
// valid" by `run.pdfResult`. The record holds counts only, never a title.
import { applyBookmarks, readBookmarks, type BookmarkSaveReport } from '@/lib/pdf-tools/bookmarks';
import { carryOutline, cleanTitle, TITLE_READ_MAX, type OutlineItem } from '@/lib/pdf-tools/outline';
import { defaultResultName, operationSummary } from '@/lib/pdf-tools/resultNames';
import { countLabel } from './bookmarks/bookmarkView';
import { resolveResultName } from './toolOptions';
import { onePdf, unverified, wrongInput, type ToolStep } from './toolStep';

export const BUILT = true;

/** What the dialog counted (bookmarkView.ts editCounts), for the record only. */
export interface BookmarkEditTally {
  added: number;
  renamed: number;
  moved: number;
  removed: number;
  /** The file's own bookmarks that open another file, launch something or run a script: not kept. */
  notCarried: number;
}

/** Plan A3: the edited tree (bookmarkEdit.ts `toOutline`), the result name typed in the dialog, and the dialog's counts. */
export interface BookmarksRunOptions {
  items: OutlineItem[];
  name?: string;
  edits?: BookmarkEditTally;
}

const TALLY_KEYS = ['added', 'renamed', 'moved', 'removed', 'notCarried'] as const;

/** Said after the bookmark count when old bookmarks stayed in the file (REV-A B5): one plain sentence. */
export const OLD_BOOKMARKS_KEPT_NOTE = 'Some old bookmarks could not be removed safely; their titles may still be in the file’s data, though no reader shows them.';

/** The dialog's counts, each a whole number from 0 (anything else counts 0). */
function tally(edits: BookmarkEditTally | undefined): BookmarkEditTally {
  const out = { added: 0, renamed: 0, moved: 0, removed: 0, notCarried: 0 };
  for (const key of TALLY_KEYS) {
    const value = edits?.[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) out[key] = value;
  }
  return out;
}

function countAll(items: readonly OutlineItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countAll(item.children), 0);
}

function isTree(items: unknown): items is OutlineItem[] {
  if (!Array.isArray(items)) return false;
  return items.every((item) => item !== null && typeof item === 'object' && typeof (item as OutlineItem).title === 'string' && isTree((item as OutlineItem).children));
}

/**
 * Whether the bookmarks read back from the saved file are the ones written: the same tree, titles (as
 * the reader cleans them), pages and web addresses.
 */
export function verifySavedOutline(expected: readonly OutlineItem[], read: readonly OutlineItem[]): boolean {
  if (expected.length !== read.length) return false;
  return expected.every((want, i) => {
    const got = read[i];
    return (
      cleanTitle(want.title, TITLE_READ_MAX) === got.title &&
      want.page === got.page &&
      (want.page !== null || (want.uri ?? null) === (got.uri ?? null)) &&
      verifySavedOutline(want.children, got.children)
    );
  });
}

export const step: ToolStep<BookmarksRunOptions> = async (run, inputs, options) => {
  const source = onePdf(inputs);
  // The copy is about the size of the file: a list without room for it refuses now, not after the slow save.
  run.ensureRoom(source.size, 'The bookmarked copy');
  if (!options || !isTree(options.items)) throw wrongInput('The bookmarks to save could not be read. Nothing was changed.');
  // What applyBookmarks keeps: bookmarks that go to no page of the file (other than web addresses) are left out.
  const carried = carryOutline(options.items, (page) => page);
  const edits = tally(options.edits);
  const notCarried = edits.notCarried + carried.droppedNoPage;

  await run.slowStep('Saving the bookmarks…');
  // A refusal (a title left empty, a file over the limits) is a PdfToolsError with its plain message.
  const saveReport: BookmarkSaveReport = {};
  const bytes = await applyBookmarks(source.bytes, options.items, { report: saveReport, check: () => run.check() });
  run.check();
  // Old bookmarks not certainly the outline's own stay in the file, unlinked (REV-A B5): said, never silent.
  const oldKept = (saveReport.oldBookmarksKept ?? 0) > 0;

  await run.slowStep('Checking the saved bookmarks…');
  let saved;
  try {
    saved = await readBookmarks(bytes, { check: () => run.check() });
  } catch {
    run.check();
    throw unverified();
  }
  run.check();
  if (!saved.editable || !verifySavedOutline(carried.items, saved.items)) throw unverified();

  const total = countAll(carried.items);
  const name = resolveResultName(options.name ?? '', defaultResultName('bookmarks', source.name), 'pdf');
  const record = {
    summary: operationSummary('bookmarks', { bookmarks: total }),
    options: {
      bookmarks: total,
      added: edits.added,
      renamed: edits.renamed,
      moved: edits.moved,
      removed: edits.removed,
      notCarried,
    },
  };
  // The file's own bookmarks that could not be kept make the record say "not carried"; those the user removed do not.
  const flags = oldKept ? { oldBookmarksKept: true } : {};
  const file = await run.pdfResult(name, bytes, source.pageCount, [source], record, { report: { bookmarksDropped: notCarried }, flags });
  return {
    files: [file],
    describe: ([made]) => {
      const has = total === 0 ? 'It has no bookmarks.' : `It has ${countLabel(total, 'bookmark')}.`;
      return {
        // The tool's own verb in the title (ux-audit C6.10).
        message: `Bookmarks saved: ${made.name}`,
        detail: oldKept ? `${has} ${OLD_BOOKMARKS_KEPT_NOTE}` : has,
        ...(oldKept ? { tone: 'warning' as const } : {}),
      };
    },
  };
};
