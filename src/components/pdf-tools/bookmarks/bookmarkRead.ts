// Reads a file's bookmarks for the Bookmarks dialog and the list beside the page panel, with PDF Tools'
// own reader (design 5.10: pdf.js reports page 1 for a page that is not in the file). One pdf-lib load
// gives the bookmarks as `readBookmarks` reads them and where each page starts, so a new bookmark can go
// to the top of its page (`/XYZ left top null`, as Acrobat writes it) without loading the file twice.
// No DOM: it also runs inside the reading worker (bookmarkReader.worker.ts).
import type { PDFDocument } from 'pdf-lib';
import type { BookmarkFile } from '@/lib/pdf-tools/bookmarks';
import { loadPaced } from '@/lib/pdf-tools/pace';
import { outlineOverLimits, readOutline, type DestView, type OutlineItem } from '@/lib/pdf-tools/outline';
import { PdfToolsError } from '@/lib/pdf-tools/types';

export interface BookmarkSource extends BookmarkFile {
  /** Per page: the left and top of its media box, where a new bookmark points. */
  pageTops: readonly (readonly [number, number])[];
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

/** The bookmarks of a file as the library reads them (`readBookmarks`), and where each page starts. */
export async function readBookmarkSource(bytes: Uint8Array): Promise<BookmarkSource> {
  let doc: PDFDocument;
  try {
    // pdf-lib's default waits for a timer every 100 objects: a 320-page ledger with no bookmarks
    // (16,330 objects) waited 163 times, which on a busy machine took 20 to 30 s (QA-FIX B). Its own
    // load waiting by the clock instead (pace.ts): at most one wait per 50 ms of reading, which matters
    // when the reading worker is not available and the file is read on the window's thread.
    doc = await loadPaced(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
  }
  if (doc.isEncrypted) throw new PdfToolsError('encrypted', 'This file is password-protected. Unlock it first.');
  const { items, problems } = readOutline(doc);
  const pageTops = doc.getPages().map((page): [number, number] => {
    const box = page.getMediaBox();
    return [box.x, box.y + box.height];
  });
  return {
    items,
    problems,
    editable: !outlineOverLimits(problems),
    notCarried: countNotCarried(items),
    pageTops,
  };
}

/** Where a bookmark added for `pageIndex` goes: the top of the page, at the reader's zoom. */
export function newBookmarkView(source: Pick<BookmarkSource, 'pageTops'>, pageIndex: number): DestView {
  const [left, top] = source.pageTops[pageIndex] ?? [0, null];
  return { kind: 'XYZ', args: [left, top, null] };
}
