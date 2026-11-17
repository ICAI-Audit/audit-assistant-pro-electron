// The Bookmarks tool's file side (design 5.10): reads a file's bookmarks for editing and for the list
// beside the page panel, and saves an edited tree into a re-saved copy of the source. The edit model
// is in components/pdf-tools/bookmarkEdit.ts.
import type { PDFDocument } from 'pdf-lib';
import { carryOutline, cleanTitle, outlineOverLimits, TITLE_READ_MAX, readOutline, replaceOutline, type OutlineItem, type OutlineProblems } from './outline';
import { isStop, loadPaced, pacer, savePaced } from './pace';
import { PdfToolsError } from './types';

const PRODUCER = 'ICAI VERA';

export const BOOKMARKS_NOT_EDITABLE_MESSAGE =
  'This file has more bookmarks, or deeper levels, than PDF Tools can edit (10,000 bookmarks, 32 levels). Nothing was changed.';
export const BOOKMARK_TITLE_INVALID_MESSAGE = 'A bookmark needs a title.';

export interface BookmarkFile {
  items: OutlineItem[];
  problems: OutlineProblems;
  /** False when the file is over the limits: saving what was read would lose the rest. */
  editable: boolean;
  /** Bookmarks that open another file, launch something, run a script or go to no page: shown greyed, and dropped on save. */
  notCarried: number;
}

async function load(file: Uint8Array, check?: () => void): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    // Waits by the clock (pace.ts), not every 100 objects (user QA 2.18: saving a 320-page ledger's bookmarks took 38 s).
    doc = await loadPaced(file, { ignoreEncryption: true, updateMetadata: false, check });
  } catch (error) {
    if (isStop(error)) throw error; // the run's own Stop, pressed while the file was read
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
  }
  if (doc.isEncrypted) throw new PdfToolsError('encrypted', 'This file is password-protected. Unlock it first.');
  return doc;
}

function countNotCarried(items: readonly OutlineItem[]): number {
  let total = 0;
  const stack = [...items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.unresolved !== undefined) total++;
    stack.push(...item.children);
  }
  return total;
}

/** The bookmarks of a file, read with PDF Tools' own reader (pdf.js reports page 1 for a page that is not in the file). */
export async function readBookmarks(file: Uint8Array, options: { check?: () => void } = {}): Promise<BookmarkFile> {
  const doc = await load(file, options.check);
  const { items, problems } = readOutline(doc);
  return { items, problems, editable: !outlineOverLimits(problems), notCarried: countNotCarried(items) };
}

/**
 * Every title as it will be kept. A title is cut at the read limit (1,000), not at the 256 a person may
 * type, so a file's own long titles are not changed by a save. An untitled bookmark of the file stays
 * untitled; any other empty title is refused, naming the bookmark by its place in the list.
 */
function cleaned(items: readonly OutlineItem[], counter = { n: 0 }): OutlineItem[] {
  return items.map((item) => {
    counter.n++;
    const position = counter.n;
    const title = cleanTitle(item.title, TITLE_READ_MAX);
    if (title === '' && !item.untitled) {
      throw new PdfToolsError('bookmark-title-invalid', `${BOOKMARK_TITLE_INVALID_MESSAGE} (Bookmark ${position} in the list has none.)`);
    }
    return { ...item, title, children: cleaned(item.children, counter) };
  });
}

/** What applyBookmarks noticed. */
export interface BookmarkSaveReport {
  /**
   * Old bookmarks left in the file, unlinked, because deleting them was not certain to be safe (a damaged
   * outline that runs into other objects, an item that is not provably the outline's own): an old title
   * may still be in the saved bytes (REV-A B5). 0 for a healthy file.
   */
  oldBookmarksKept?: number;
}

/**
 * The source re-saved with `items` as its bookmarks: the old outline's own objects are deleted, so a
 * deleted or renamed title is not left in the bytes (anything not certainly its own stays and is counted
 * in `report`). Items that open another file, launch something or run a script (`unresolved`, other than a
 * web address) are left out. A file over the limits is refused. The page tree, form and everything else
 * are re-saved as they are, so a signature becomes invalid.
 */
export async function applyBookmarks(
  file: Uint8Array,
  items: readonly OutlineItem[],
  options: { report?: BookmarkSaveReport; /** The run's Stop check, asked after each wait while the file is read; its error is passed on. */ check?: () => void } = {},
): Promise<Uint8Array> {
  const doc = await load(file, options.check);
  if (outlineOverLimits(readOutline(doc).problems)) throw new PdfToolsError('bookmarks-not-editable', BOOKMARKS_NOT_EDITABLE_MESSAGE);
  const kept = cleaned(carryOutline(items, (page) => page).items);
  let keptBookmarks: number;
  try {
    ({ keptBookmarks } = await replaceOutline(doc, kept, pacer()));
  } catch (error) {
    if (error instanceof RangeError) {
      throw new PdfToolsError('invalid-bookmarks', 'A bookmark points at a page this file does not have, or is nested too deeply. Nothing was changed.');
    }
    throw error;
  }
  if (options.report) options.report.oldBookmarksKept = keptBookmarks;
  // An edit of the source in place: Producer and modification date are ours, the Creator stays (REV-A S12).
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  return savePaced(doc);
}
