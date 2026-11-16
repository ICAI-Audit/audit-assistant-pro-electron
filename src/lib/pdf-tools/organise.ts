import { PDFDocument, PDFObjectCopier, PDFPage } from 'pdf-lib';
import { carryOutline, cleanTitle, OUTLINE_MAX_DEPTH, OUTLINE_MAX_ITEMS, outlineDepth, outlineOverLimits, readOutline, writeOutline, type OutlineItem } from './outline';
import { isStop, loadPaced, pacer, savePaced, type Pace } from './pace';
import { copyPagesOf, pageMapping, SourceScans, type OrganiseReport, type PageMapping } from './pageCopy';
import { bookmarkPlan, bookmarkSplitError, partIndices, SPLIT_MAX_FILES, tooManyRanges, type BookmarkPlan, type PagePart } from './splitPlan';
import { PdfToolsError } from './types';

export type { OrganiseReport } from './pageCopy';

/** What happened to the bookmarks of a result. */
export interface BookmarkReport {
  /**
   * The count the "bookmarks not carried" flag is made from: this result lost a bookmark it would
   * otherwise have had. It is `bookmarksNotCarried + bookmarksLeftOut`, and never counts a bookmark
   * that simply belongs to another part of a Split (`bookmarksInOtherParts`). Absent when the source
   * has no bookmarks (and, for Merge, when no source has any).
   */
  bookmarksDropped?: number;
  /**
   * Bookmarks that could not be carried to any result: they open another file, launch something, run a
   * script or go to no page; or the source is over the limits (10,000 bookmarks, 32 levels) and every
   * bookmark read counts. Merge adds the bookmarks it did not write (own bookmarks not asked for, over
   * the limits once merged). In a Split every N, a bookmark that goes to no page belongs to no part and is
   * counted once, on the first part.
   */
  bookmarksNotCarried?: number;
  /** Bookmarks of pages that are in no result (Delete pages, a range extracted). */
  bookmarksLeftOut?: number;
  /** Split every N: bookmarks of pages that are in another part. Information only; they do not set the flag. */
  bookmarksInOtherParts?: number;
}

const APP_NAME = 'ICAI VERA';

/** For Split (one result) and Delete pages. */
export interface OrganiseOptions {
  /** Filled in with what could not be trimmed from the result. */
  report?: OrganiseReport & BookmarkReport;
  /** Called before each page is copied, with the pages copied so far; it stops the run by throwing (a cancel). */
  onPage?: (done: number, total: number) => void | Promise<void>;
  /** The run's Stop check, asked after each wait while the source is read (pace.ts loadPaced); it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
}

/** For Split every N pages. */
export interface SplitOptions {
  /** One report per part, in order. */
  reports?: (OrganiseReport & BookmarkReport)[];
  /** Called before each part is made; it stops the split by throwing (a cancel). */
  onPart?: (done: number, total: number) => void | Promise<void>;
  /** Called before each page of part `part` is copied; it stops the split by throwing (REV-A B6: Stop had only the parts). */
  onPage?: (part: number, done: number, total: number) => void | Promise<void>;
  /** The run's Stop check, asked after each wait while the source is read (pace.ts loadPaced); it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
}

/** For Split into one file per range, or per top-level bookmark. */
export interface SplitPartsOptions {
  /** One report per file, in order. */
  reports?: (OrganiseReport & BookmarkReport)[];
  /** Called once the files are known, before any is made (with the bookmarks' sections when splitting at them). */
  onPlan?: (parts: readonly PagePart[]) => void | Promise<void>;
  /** Called before each file is made; it stops the split by throwing (a cancel). */
  onPart?: (done: number, total: number) => void | Promise<void>;
  /** Called before each page of file `part` is copied; it stops the split by throwing. */
  onPage?: (part: number, done: number, total: number) => void | Promise<void>;
  /** Called with each file as soon as it is made (the run checks the list's room); it stops the split by throwing. */
  onPartMade?: (bytes: Uint8Array, part: number) => void | Promise<void>;
  /** The run's Stop check, asked after each wait while the source is read (pace.ts loadPaced); it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
}

/** For Merge: bookmarks in the merged file. */
export interface MergeOptions {
  /**
   * `titles`: one bookmark per file, at its first page, named by the entry at the file's position
   * (cleaned; a name left empty becomes "Untitled"); leave it out for no per-file bookmarks.
   * `keepOwn`: each file's own bookmarks are carried, under its per-file bookmark or, without one, at
   * the top level. With neither a per-file bookmark nor `keepOwn` the result has no bookmarks.
   */
  fileBookmarks?: { titles?: string[]; keepOwn: boolean };
  /** `bookmarksDropped` is the number of source bookmarks not in the result. */
  report?: BookmarkReport;
  /**
   * Called before each page of file `file` (from 0, in list order) is copied; it stops the merge by throwing
   * (REV-A B6: a merge had no place for Stop at all).
   */
  onPage?: (file: number, done: number, total: number) => void | Promise<void>;
  /** The run's Stop check, asked after each wait while each file is read (pace.ts loadPaced); it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
}

const unreadable = (position?: number) =>
  new PdfToolsError('not-a-pdf', position === undefined ? 'This file could not be read as a PDF. It may be damaged.' : `File ${position} in the list could not be read as a PDF. It may be damaged.`);

async function load(bytes: Uint8Array, position?: number, check?: () => void): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await loadPaced(bytes, { ignoreEncryption: true, updateMetadata: false, check });
  } catch (error) {
    if (isStop(error)) throw error; // the run's own Stop, pressed while the file was read
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
  }
  if (doc.isEncrypted) {
    const which = position === undefined ? 'This file is' : `File ${position} in the list is`;
    throw new PdfToolsError('encrypted', `${which} password-protected. Unlock it first.`);
  }
  return doc;
}

/**
 * Runs a copy, refusing plainly (as a damaged file) when it overflows the call stack: a page tree that is
 * its own parent, or a chain of thousands of references from a kept page (REV-A S2, S3). Never the generic
 * failure, never a half-made result.
 */
async function stackSafe<T>(work: () => Promise<T>, position?: number): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RangeError) throw unreadable(position);
    throw error;
  }
}

/** New output document; carries descriptive metadata over only when a source is given and has it. */
async function createOutput(source?: PDFDocument): Promise<PDFDocument> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const now = new Date();
  out.setProducer(APP_NAME);
  out.setCreator(APP_NAME);
  out.setModificationDate(now);
  if (!source) {
    out.setCreationDate(now);
    return out;
  }
  const title = source.getTitle();
  const author = source.getAuthor();
  const subject = source.getSubject();
  const keywords = source.getKeywords();
  const created = source.getCreationDate();
  if (title !== undefined) out.setTitle(title, { showInWindowTitleBar: false });
  if (author !== undefined) out.setAuthor(author);
  if (subject !== undefined) out.setSubject(subject);
  if (keywords !== undefined) out.setKeywords([keywords]);
  if (created !== undefined) out.setCreationDate(created);
  return out;
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return savePaced(doc);
}

/**
 * Merge: pdf-lib's own page copy (`copyPages`: one copier for the whole file, so what pages share is copied
 * once), a page at a time with `step` before each, so the window gets its turns and Stop a place to land
 * (REV-A B6). The same objects in the same order as `copyPages`, so the same bytes. Adding a page walks the
 * page list, so adding thousands is paced too. Form fields, bookmarks and links are not carried (the dialog
 * says so).
 */
async function copyInto(target: PDFDocument, source: PDFDocument, indices: number[], step: (done: number, total: number) => Promise<void>, pace: Pace): Promise<void> {
  await source.flush();
  const copier = PDFObjectCopier.for(source.context, target.context);
  const pages = source.getPages();
  const copied: PDFPage[] = [];
  for (const [done, index] of indices.entries()) {
    await step(done, indices.length);
    const node = copier.copy(pages[index].node);
    copied.push(PDFPage.of(node, target.context.register(node), target));
  }
  for (const page of copied) {
    target.addPage(page);
    await pace();
  }
}

function checkIndices(indices: number[], pageCount: number): void {
  if (indices.length === 0) throw new PdfToolsError('invalid-page-list', 'Choose at least one page.');
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0) {
      throw new PdfToolsError('invalid-page-list', `Page numbers must be whole numbers from 1 to ${pageCount}.`);
    }
    if (index >= pageCount) {
      throw new PdfToolsError('invalid-page-list', `Page ${index + 1} is outside this file's ${pageCount} pages.`);
    }
  }
}

/**
 * A Split into several files: which pages are in some other file, and whether this file is the one that
 * counts what no file has (the first): bookmarks that go to no page and, when ranges leave pages out,
 * bookmarks of those pages. Each is counted once for the whole split.
 */
interface PartOf {
  inAnotherPart: (oldIndex: number) => boolean;
  countNoPage: boolean;
}

/**
 * Writes the bookmarks that `map` keeps into `out`, which must already hold the pages, and fills in
 * `report`. A source with no outline writes none; one over the limits carries none (writing back what
 * was read would silently lose the rest), and every item read counts as not carried.
 */
function carryBookmarks(out: PDFDocument, read: ReturnType<typeof readOutline>, map: PageMapping, report: BookmarkReport | undefined, part?: PartOf): void {
  if (read.count === 0) return;
  if (outlineOverLimits(read.problems)) {
    if (report) Object.assign(report, { bookmarksDropped: read.count, bookmarksNotCarried: read.count, bookmarksLeftOut: 0, bookmarksInOtherParts: 0 });
    return;
  }
  const carried = carryOutline(read.items, map, part?.inAnotherPart);
  if (carried.items.length > 0) writeOutline(out, carried.items);
  if (!report) return;
  const notCarried = part && !part.countNoPage ? 0 : carried.droppedNoPage;
  // Split every N and at bookmarks leave no page out, so only ranges with gaps have any here.
  const leftOut = part && !part.countNoPage ? 0 : carried.droppedLeftOut;
  Object.assign(report, {
    bookmarksDropped: notCarried + leftOut,
    bookmarksNotCarried: notCarried,
    bookmarksLeftOut: leftOut,
    bookmarksInOtherParts: carried.droppedOtherResult,
  });
}

/** The bookmarks of one source, as they sit in a merged file whose first page of this source is at `offset`. */
function shiftOutline(items: readonly OutlineItem[], offset: number): OutlineItem[] {
  return items.map((item) => ({ ...item, page: item.page === null ? null : item.page + offset, children: shiftOutline(item.children, offset) }));
}

export async function mergePdfs(files: Uint8Array[], options: MergeOptions = {}): Promise<Uint8Array> {
  if (files.length < 2) throw new PdfToolsError('merge-needs-two', 'Choose at least two files to merge.');
  const out = await createOutput();
  const outline: OutlineItem[] = [];
  const titles = options.fileBookmarks?.titles;
  // The per-file bookmarks are always written; they count toward the limit the Bookmarks tool can open.
  let total = titles ? files.length : 0;
  let dropped = 0;
  let sawBookmarks = false;
  // Each entry is loaded separately, so the same bytes supplied twice are copied twice.
  let offset = 0;
  const pace = pacer();
  for (const [i, file] of files.entries()) {
    const source = await load(file, i + 1, options.check);
    const step = async (done: number, total: number) => {
      await options.onPage?.(i, done, total);
      await pace();
    };
    await stackSafe(() => copyInto(out, source, source.getPageIndices(), step, pace), i + 1);
    const read = readOutline(source);
    let own: OutlineItem[] = [];
    if (read.count > 0) {
      sawBookmarks = true;
      const keepOwn = options.fileBookmarks?.keepOwn === true;
      if (!keepOwn || outlineOverLimits(read.problems)) dropped += read.count;
      else {
        const carried = carryOutline(shiftOutline(read.items, offset), (page) => page);
        dropped += carried.dropped;
        own = carried.items;
      }
    }
    // A source's own bookmarks are carried whole, in list order, while the merged file stays within what the
    // Bookmarks tool can open (10,000 bookmarks, 32 levels, the per-file bookmark taking one level); the rest are counted.
    if (own.length > 0 && (total + outlineCount(own) > OUTLINE_MAX_ITEMS || (titles && outlineDepth(own) + 1 > OUTLINE_MAX_DEPTH))) {
      dropped += outlineCount(own);
      own = [];
    }
    total += outlineCount(own);
    if (titles) {
      outline.push({ title: cleanTitle(titles[i] ?? '') || 'Untitled', page: offset, open: false, children: own });
    } else {
      outline.push(...own);
    }
    offset += source.getPageCount();
  }
  if (outline.length > 0) writeOutline(out, outline);
  if (options.report && sawBookmarks) Object.assign(options.report, { bookmarksDropped: dropped, bookmarksNotCarried: dropped });
  return save(out);
}

function outlineCount(items: readonly OutlineItem[]): number {
  return items.reduce((sum, item) => sum + 1 + outlineCount(item.children), 0);
}

/** The pages at `indices`, in that order (pageCopy.ts says what comes with them). */
export async function extractPages(file: Uint8Array, indices: number[], options: OrganiseOptions = {}): Promise<Uint8Array> {
  const source = await load(file, undefined, options.check);
  checkIndices(indices, source.getPageCount());
  const out = await createOutput(source);
  const report = options.report ?? {};
  await stackSafe(() => copyPagesOf(out, source, indices, report, { onPage: options.onPage }));
  carryBookmarks(out, readOutline(source), pageMapping(indices), report);
  return save(out);
}

export async function splitEvery(file: Uint8Array, n: number, options: SplitOptions = {}): Promise<Uint8Array[]> {
  const source = await load(file, undefined, options.check);
  const pageCount = source.getPageCount();
  if (pageCount < 2) {
    throw new PdfToolsError('invalid-split-size', 'This file has only one page, so it cannot be split. Choose a file with at least two pages.');
  }
  if (!Number.isInteger(n) || n < 1 || n >= pageCount) {
    throw new PdfToolsError('invalid-split-size', `Enter a number from 1 to ${pageCount - 1}.`);
  }
  const total = Math.ceil(pageCount / n);
  const parts: Uint8Array[] = [];
  const scans = new SourceScans(); // the source is read once for all the parts
  const outline = readOutline(source); // and so are its bookmarks
  const pace = pacer();
  for (let start = 0; start < pageCount; start += n) {
    const part = parts.length;
    await options.onPart?.(part, total);
    const out = await createOutput(source);
    const end = Math.min(start + n, pageCount);
    const report: OrganiseReport & BookmarkReport = {};
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const onPage = options.onPage;
    await stackSafe(() => copyPagesOf(out, source, indices, report, { scans, pace, onPage: onPage ? (done, count) => onPage(part, done, count) : undefined }));
    carryBookmarks(out, outline, pageMapping(indices), report, { inAnotherPart: () => true, countNoPage: part === 0 });
    options.reports?.push(report);
    parts.push(await save(out));
  }
  return parts;
}

/**
 * The files of a split, one per entry of `parts` (pages counted from 0, in order), made from one reading
 * of the source: each holds what Split carries for its pages (pageCopy.ts), the bookmarks of its pages
 * (`carryBookmarks`, a page of another file counted as information only) and the source's description.
 * Each file is exactly what extractPages makes for its pages.
 */
async function makeParts(source: PDFDocument, read: ReturnType<typeof readOutline>, parts: readonly PagePart[], options: SplitPartsOptions): Promise<Uint8Array[]> {
  await options.onPlan?.(parts);
  const scans = new SourceScans(); // the source is read once for all the files
  const inSomePart = new Set<number>();
  for (const part of parts) for (const index of partIndices(part)) inSomePart.add(index);
  const made: Uint8Array[] = [];
  const pace: Pace = pacer();
  for (const [k, part] of parts.entries()) {
    await options.onPart?.(k, parts.length);
    const out = await createOutput(source);
    const report: OrganiseReport & BookmarkReport = {};
    const indices = partIndices(part);
    const onPage = options.onPage;
    await stackSafe(() => copyPagesOf(out, source, indices, report, { scans, pace, onPage: onPage ? (done, total) => onPage(k, done, total) : undefined }));
    carryBookmarks(out, read, pageMapping(indices), report, { inAnotherPart: (index) => inSomePart.has(index), countNoPage: k === 0 });
    options.reports?.push(report);
    const bytes = await save(out);
    await options.onPartMade?.(bytes, k);
    made.push(bytes);
  }
  return made;
}

/** Refuses parts this file cannot give, with the page list's own words, before anything is made. */
function checkParts(parts: readonly PagePart[], pageCount: number): void {
  if (parts.length === 0) throw new PdfToolsError('invalid-page-list', 'Choose at least one page.');
  if (parts.length > SPLIT_MAX_FILES) throw new PdfToolsError('too-many-files', tooManyRanges(parts.length));
  for (const { from, to } of parts) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1) {
      throw new PdfToolsError('invalid-page-list', `Page numbers must be whole numbers from 1 to ${pageCount}.`);
    }
    if (from > to) throw new PdfToolsError('invalid-page-list', `"${from}-${to}" is backwards: the first page must not be after the last`);
    if (to > pageCount) throw new PdfToolsError('invalid-page-list', `Page ${to} is outside this file's ${pageCount} pages.`);
  }
}

/** Split into one file per range (`parts`, pages counted from 1), in the order given; a page may be in several. */
export async function splitParts(file: Uint8Array, parts: readonly PagePart[], options: SplitPartsOptions = {}): Promise<Uint8Array[]> {
  const source = await load(file, undefined, options.check);
  checkParts(parts, source.getPageCount());
  return makeParts(source, readOutline(source), parts, options);
}

/**
 * Split into one file per top-level bookmark (splitPlan.ts bookmarkPlan says where the files are cut).
 * A file it cannot split this way (no bookmarks, more than the reader reads, none at the top that opens a
 * page, more than SPLIT_MAX_FILES files) is refused before anything is made.
 */
export async function splitAtBookmarks(file: Uint8Array, options: SplitPartsOptions = {}): Promise<{ plan: BookmarkPlan; parts: Uint8Array[] }> {
  const source = await load(file, undefined, options.check);
  const read = readOutline(source);
  const plan = bookmarkPlan(read.items, source.getPageCount());
  const problem = bookmarkSplitError({ count: read.count, overLimits: outlineOverLimits(read.problems) }, plan);
  if (problem) throw new PdfToolsError(plan.sections.length > SPLIT_MAX_FILES ? 'too-many-files' : 'no-bookmarks', problem);
  return { plan, parts: await makeParts(source, read, plan.sections, options) };
}

export async function deletePages(file: Uint8Array, indices: number[], options: OrganiseOptions = {}): Promise<Uint8Array> {
  const source = await load(file, undefined, options.check);
  const pageCount = source.getPageCount();
  checkIndices(indices, pageCount);
  const doomed = new Set(indices);
  const keep = source.getPageIndices().filter((i) => !doomed.has(i));
  if (keep.length === 0) throw new PdfToolsError('cannot-delete-all', 'You cannot delete every page of a PDF.');
  const out = await createOutput(source);
  const report = options.report ?? {};
  await stackSafe(() => copyPagesOf(out, source, keep, report, { onPage: options.onPage }));
  carryBookmarks(out, readOutline(source), pageMapping(keep), report);
  return save(out);
}
