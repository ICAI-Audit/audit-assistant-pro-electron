// What a Split into several files makes, worked out before anything is made (design 5.3): one file for
// each range of a typed list ("1-32, 65-96" gives two files), or one file for each top-level bookmark;
// the pages that are in no file or in more than one; the files' names; and the line each file's record
// carries. Plain functions, no PDF: the dialog shows what the run step will make from the same rules.
import { cleanFileName, cutMiddle } from './fileNames';
import type { OutlineItem } from './outline';
import { parsePageList } from './pageList';
import { PdfToolsError } from './types';

/**
 * The most files one Split run makes from ranges or bookmarks (design call). Every file becomes a row of
 * the list, a name in the vault form and a file in the folder a save writes, all within the list's
 * 300 MB; 500 covers a ledger's accounts or a year of monthly statements, and a run past it is a slip.
 */
export const SPLIT_MAX_FILES = 500;

/** A run of pages, counted from 1, both ends included. */
export interface PagePart {
  from: number;
  to: number;
}

export const partPageCount = (part: PagePart): number => part.to - part.from + 1;

/** The part's pages, counted from 0, in order. */
export const partIndices = (part: PagePart): number[] => Array.from({ length: partPageCount(part) }, (_, i) => part.from - 1 + i);

/** "3-5", or "7" for one page (as the page list is written). */
export const partText = (part: PagePart): string => (part.from === part.to ? `${part.from}` : `${part.from}-${part.to}`);

const tooMany = (message: string) => new PdfToolsError('too-many-files', message);

/**
 * "1-32, 65-96" read as one part per comma item, in the order typed. A list the page parser refuses is
 * refused with its own message (as when the list makes one file); more than SPLIT_MAX_FILES parts are refused.
 */
export function parseRangeParts(text: string, pageCount: number): PagePart[] {
  parsePageList(text, pageCount); // throws 'invalid-page-list' with the parser's words
  const parts = text.split(',').map((token): PagePart => {
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(token);
    return range ? { from: Number(range[1]), to: Number(range[2]) } : { from: Number(token.trim()), to: Number(token.trim()) };
  });
  if (parts.length > SPLIT_MAX_FILES) throw tooMany(tooManyRanges(parts.length));
  return parts;
}

/** The refusal of more than SPLIT_MAX_FILES ranges, in one sentence. */
export const tooManyRanges = (count: number): string => `These ranges would make ${count} files; Split makes at most ${SPLIT_MAX_FILES} at a time.`;

/** The runs of pages in no part (`missing`) and in more than one part (`repeated`), in page order. */
export function partCoverage(parts: readonly PagePart[], pageCount: number): { missing: PagePart[]; repeated: PagePart[] } {
  // How many parts each page starts or stops being in: added up, the number of parts holding it.
  const delta = new Int32Array(pageCount + 2);
  for (const part of parts) {
    delta[part.from] += 1;
    delta[part.to + 1] -= 1;
  }
  const missing: PagePart[] = [];
  const repeated: PagePart[] = [];
  const add = (runs: PagePart[], page: number) => {
    const last = runs[runs.length - 1];
    if (last && last.to === page - 1) last.to = page;
    else runs.push({ from: page, to: page });
  };
  let inParts = 0;
  for (let page = 1; page <= pageCount; page++) {
    inParts += delta[page];
    if (inParts === 0) add(missing, page);
    else if (inParts > 1) add(repeated, page);
  }
  return { missing, repeated };
}

// ---- names -----------------------------------------------------------------------------------------

const MAX_NAME_LENGTH = 120;
/** As resolveStem cuts a stem typed for parts, so a bookmark's title keeps room in the name. */
const MAX_STEM_LENGTH = 90;
const PDF = '.pdf';

/** Cuts `text` to at most `room` UTF-16 units, never splitting a pair, nor a letter from its marks or joiners. */
function cutText(text: string, room: number): string {
  if (text.length <= room) return text;
  let end = Math.max(0, room);
  if (end > 0 && /[\uDC00-\uDFFF]/.test(text[end]) && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  // A vowel sign, a virama or a joiner belongs to the letter before it: cut before that letter instead.
  while (end > 0 && /[\p{M}\u200c\u200d]/u.test(text.slice(end, end + 1))) {
    end -= 1;
    if (end > 0 && /[\uDC00-\uDFFF]/.test(text[end]) && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  }
  return text.slice(0, end);
}

const emptyStem = (stem: string) => stem.replace(/^[. ]+|[. ]+$/g, '') === '';

/**
 * `stem` + `ending` + ".pdf", cleaned, at most 120 characters: a long stem is cut in its middle (as
 * resultNames.ts cuts the one-range result's name, so the two names agree: REV-A M1), never the ending.
 */
function withEnding(stem: string, ending: string): string {
  const base = emptyStem(stem) ? 'document' : stem;
  return cleanFileName(cutMiddle(base, MAX_NAME_LENGTH - ending.length - PDF.length) + ending, 'pdf');
}

/** "<stem>_pages_1-32.pdf" (as the one-range result is named), or "<stem>_page_5.pdf" for one page. */
export function rangePartName(stem: string, part: PagePart): string {
  return withEnding(stem, part.from === part.to ? `_page_${part.from}` : `_pages_${part.from}-${part.to}`);
}

/**
 * "<stem>_01_<title>.pdf": the file's place in page order (so a folder lists the files in the document's
 * order, and two bookmarks with one title still get two names), then the bookmark's title. The name is
 * cleaned as every name is; a long title is cut to fit 120 characters; an empty one reads "Untitled".
 */
export function bookmarkPartName(stem: string, index: number, total: number, title: string): string {
  const base = emptyStem(stem) ? 'document' : cutMiddle(stem, MAX_STEM_LENGTH);
  const head = `${base}_${String(index).padStart(Math.max(2, String(total).length), '0')}_`;
  const words = title.trim() === '' ? 'Untitled' : title.trim();
  return cleanFileName(head + cutText(words, MAX_NAME_LENGTH - head.length - PDF.length), 'pdf');
}

/** `name` with " (n)" before ".pdf", within 120 characters. */
function numbered(name: string, n: number): string {
  const base = name.toLowerCase().endsWith(PDF) ? name.slice(0, -PDF.length) : name;
  const tail = ` (${n})${PDF}`;
  return cutText(base, MAX_NAME_LENGTH - tail.length) + tail;
}

/** A name used twice in one run (the same range typed twice) gets " (2)", " (3)"…, without regard to case. */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let unique = name;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = numbered(name, n);
    taken.add(unique.toLowerCase());
    return unique;
  });
}

// ---- bookmarks -------------------------------------------------------------------------------------

export interface BookmarkSection extends PagePart {
  /** The top-level bookmark's title as the outline reader cleaned it ('' for an untitled one). */
  title: string;
}

export interface BookmarkPlan {
  /** One per top-level bookmark that opens a page, in page order. Together they hold every page once. */
  sections: BookmarkSection[];
  /** Pages before the first bookmark's page: they go into the first file. */
  before: number;
  /** Top-level bookmarks that open no page of this file (a web address, another file), nor does any under them. */
  noPage: number;
  /** Top-level bookmarks that open the same page as another: the first in the outline names that file. */
  samePage: number;
}

/** The page a bookmark opens in this file (from 0), or null. */
const ownPage = (item: OutlineItem): number | null => (item.unresolved === undefined && item.page !== null ? item.page : null);

/** The earliest page that a bookmark, or any bookmark under it, opens. */
function firstPage(item: OutlineItem): number | null {
  const own = ownPage(item);
  if (own !== null) return own;
  let first: number | null = null;
  const stack = [...item.children];
  while (stack.length > 0) {
    const next = stack.pop()!;
    const page = ownPage(next);
    if (page !== null && (first === null || page < first)) first = page;
    stack.push(...next.children);
  }
  return first;
}

/**
 * Where a file is cut at its top-level bookmarks: each file runs from its bookmark's page to the page
 * before the next one's, in page order; the pages before the first bookmark go into the first file, so
 * every page is in exactly one file. A top-level bookmark with no page of its own starts at the first
 * page a bookmark under it opens.
 */
export function bookmarkPlan(items: readonly OutlineItem[], pageCount: number): BookmarkPlan {
  let noPage = 0;
  const starts: { page: number; title: string; order: number }[] = [];
  items.forEach((item, order) => {
    const page = firstPage(item);
    if (page === null || page < 0 || page >= pageCount) noPage++;
    else starts.push({ page, title: item.title, order });
  });
  starts.sort((a, b) => a.page - b.page || a.order - b.order);
  const kept = starts.filter((start, i) => i === 0 || start.page !== starts[i - 1].page);
  const sections = kept.map((start, i): BookmarkSection => ({ title: start.title, from: i === 0 ? 1 : start.page + 1, to: i + 1 < kept.length ? kept[i + 1].page : pageCount }));
  return { sections, before: kept.length > 0 ? kept[0].page : 0, noPage, samePage: starts.length - kept.length };
}

/**
 * Why a file cannot be split at its bookmarks, or null. `count` is how many bookmarks the outline reader
 * found; `overLimits` that it stopped at its limits (then the top level read may be incomplete).
 */
export function bookmarkSplitError(source: { count: number; overLimits: boolean }, plan: BookmarkPlan): string | null {
  if (source.count === 0) return 'This file has no bookmarks, so it cannot be split at them.';
  // More than OUTLINE_MAX_ITEMS bookmarks or OUTLINE_MAX_DEPTH levels: the main bookmarks read may not be all of them.
  if (source.overLimits) return 'This file has too many bookmarks to read, so it cannot be split at them.';
  if (plan.sections.length === 0) return "This file's bookmarks do not open any of its pages, so it cannot be split at them.";
  if (plan.sections.length > SPLIT_MAX_FILES) return `Splitting at these bookmarks would make ${plan.sections.length} files; Split makes at most ${SPLIT_MAX_FILES} at a time.`;
  return null;
}

// ---- records ---------------------------------------------------------------------------------------

/** The line a file's record carries: its pages and its place among the files, never a bookmark's title. */
export function partSummary(mode: 'ranges' | 'bookmarks', part: PagePart, index: number, total: number): string {
  const pages = part.from === part.to ? `page ${part.from}` : `pages ${part.from}-${part.to}`;
  return mode === 'ranges' ? `Split ${pages} (part ${index} of ${total})` : `Split at bookmarks, ${pages} (part ${index} of ${total})`;
}
