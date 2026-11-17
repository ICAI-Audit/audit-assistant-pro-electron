// The page viewer's text search, without React or the DOM (unit-tested): which pages are read and in
// what order, the matches found so far, which match is the current one, and what the search box says.
//
// - Pages are read one at a time (one renderer job each, so a drawing of the page shown waits at most
//   for one page's text), from the page shown outward, and only while a query is typed. The first
//   match at or after the start of the page shown becomes the current one once the pages up to it are
//   read. When the user asks for the next match and a page in between is not read yet, that page is
//   read first, so no match is ever skipped.
// - The page texts read are kept for the next query, within a memory budget: the least recently used
//   are let go (their matches stay), and read again when a new query or a highlight needs them.
// - A page with nothing to search (a scan, a blank page) is counted; a page that cannot be read is
//   tried twice, then counted.
// - Confidentiality: after every read the working list must still be the one the viewer was opened
//   in (`inScope`); otherwise nothing read is kept or shown and the search ends. Closing cancels the
//   read in progress, lets every page text and the query go, and clears what the JavaScript engine
//   keeps of the last regular-expression match. The query is never logged or put into a message.
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import { buildSearchPage, findInPage, foldQuery, type SearchPage } from './searchText';

export interface SearchPageContent {
  items: readonly TextItemLike[];
  styles: Readonly<Record<string, FontStyleLike>>;
}

export interface ViewerSearchOptions {
  pageCount: number;
  /** A page's text (pdfRenderer's viewerPageText through the viewer's session). */
  read: (pageIndex: number, signal: AbortSignal) => Promise<SearchPageContent>;
  /** Whether the working list is still the one the viewer was opened in (engagement, user, session, file). */
  inScope: () => boolean;
  /** Something the search box shows has changed. */
  onChange: () => void;
  /** Bytes of page text kept for later queries (estimated; see SearchPage.cost). */
  budget?: number;
  /** Matches found before the search stops and says so. */
  maxHits?: number;
}

export interface CurrentMatch {
  pageIndex: number;
  /** The match's place among its page's matches, from 0. */
  index: number;
  /** Its place among every match found, in file order, from 1. */
  ordinal: number;
}

export interface SearchState {
  /** idle: nothing typed; reading: pages still to read; done: every page read; capped: stopped at the limit; closed. */
  status: 'idle' | 'reading' | 'done' | 'capped' | 'closed';
  found: number;
  pagesSearched: number;
  pageCount: number;
  /** Pages with nothing to search (scans, blank pages). */
  noText: number;
  /** Pages that could not be read. */
  unreadable: number;
  current: CurrentMatch | null;
  /** Changes whenever the matches or the current match change. */
  version: number;
}

export interface PageHits {
  page: SearchPage;
  /** [start, end) pairs in `page.text`. */
  ranges: Int32Array;
}

export interface ViewerSearch {
  /** A new query, searched from the start of `fromPage` (the page shown); an empty one clears the search. */
  setQuery(query: string, fromPage: number): void;
  /** The next match after the current one, or the first from the start of `shownPage` when the user has paged away. */
  next(shownPage: number): void;
  /** The match before the current one, or the last up to the end of `shownPage`. */
  prev(shownPage: number): void;
  state(): SearchState;
  /** The matches on a page and its text, or null when not known (yet): a page text let go is read again. */
  hitsOn(pageIndex: number): PageHits | null;
  /** For tests and the memory check: the page texts kept, and their estimated bytes. */
  keptPages(): number;
  keptCost(): number;
  close(): void;
}

/** About 24 MB: the text of a dense 320-page ledger (about 74 KB a page as estimated) stays for the next query. */
export const SEARCH_BUDGET = 24_000_000;
export const SEARCH_MAX_HITS = 10_000;
const ATTEMPTS = 2;

/** One hit in the file order: by page, then by its place on the page. */
interface Move {
  dir: 1 | -1;
  pageIndex: number;
  /** Start after (next) or before (previous) this index on `pageIndex`. */
  index: number;
  /** Asked for by the user: the pages it needs are read before any other. The first match of a new query is not. */
  user: boolean;
}

export function createViewerSearch(o: ViewerSearchOptions): ViewerSearch {
  const pageCount = Math.max(0, o.pageCount);
  const budget = o.budget ?? SEARCH_BUDGET;
  const maxHits = o.maxHits ?? SEARCH_MAX_HITS;

  let closed = false;
  let needle = '';
  let generation = 0;
  let version = 0;
  let status: SearchState['status'] = 'idle';
  let anchor = 0;
  let found = 0;
  let pagesSearched = 0;
  let current: { pageIndex: number; index: number } | null = null;
  let move: Move | null = null;
  // The page a pending move waits for: read before any other.
  let blocking = -1;

  // Per page: the generation its matches are for (-1: none), the matches, no text, could not be read, tries.
  const matchedFor = new Int32Array(pageCount).fill(-1);
  const hits: (Int32Array | null)[] = new Array(pageCount).fill(null);
  const noText = new Uint8Array(pageCount);
  const failed = new Uint8Array(pageCount);
  const tries = new Uint8Array(pageCount);
  let noTextCount = 0;
  let failedCount = 0;

  // Page texts kept, least recently used first (a Map keeps its insertion order).
  const kept = new Map<number, SearchPage>();
  let keptCost = 0;
  // Pages whose text a highlight needs again.
  const wanted = new Set<number>();

  let reading: AbortController | null = null;

  const changed = () => {
    version += 1;
    if (!closed) o.onChange();
  };

  const known = (p: number) => noText[p] === 1 || failed[p] === 1 || matchedFor[p] === generation;
  const hitCount = (p: number) => (matchedFor[p] === generation && hits[p] ? hits[p]!.length / 2 : 0);

  const keep = (page: SearchPage) => {
    const was = kept.get(page.pageIndex);
    if (was) {
      kept.delete(page.pageIndex);
      keptCost -= was.cost;
    }
    kept.set(page.pageIndex, page);
    keptCost += page.cost;
    // Let the oldest go, never the page just kept.
    for (const [p, old] of kept) {
      if (keptCost <= budget) break;
      if (p === page.pageIndex) continue;
      kept.delete(p);
      keptCost -= old.cost;
    }
  };

  const touch = (p: number): SearchPage | null => {
    const page = kept.get(p);
    if (!page) return null;
    kept.delete(p);
    kept.set(p, page);
    return page;
  };

  /** Matches `page` for the current query, up to the limit of matches; a page with no text is counted. */
  const match = (page: SearchPage): void => {
    const p = page.pageIndex;
    if (!page.hasText) {
      if (!noText[p]) {
        noText[p] = 1;
        noTextCount += 1;
      }
      return;
    }
    if (!needle) return;
    // At the limit, a page is not searched at all (it stays unread for this query).
    if (found >= maxHits) return;
    const ranges = findInPage(page, needle, maxHits - found);
    hits[p] = ranges;
    matchedFor[p] = generation;
    found += ranges.length / 2;
  };

  const countSearched = () => {
    let n = 0;
    for (let p = 0; p < pageCount; p++) if (known(p)) n++;
    pagesSearched = n;
  };

  const updateStatus = () => {
    if (!needle) status = 'idle';
    // The limit is said once reached, even on the last page or with every page text already kept (drive 3).
    else if (found >= maxHits) status = 'capped';
    else status = pagesSearched >= pageCount ? 'done' : 'reading';
  };

  /** The pages in the order a move visits them, starting with its own page. */
  function* visit(m: Move): Generator<number> {
    for (let k = 0; k <= pageCount; k++) yield (((m.pageIndex + m.dir * k) % pageCount) + pageCount) % pageCount;
  }

  /** Settles a pending move if the pages it needs are read; otherwise says which page it waits for. */
  const resolveMove = () => {
    blocking = -1;
    if (!move || !needle || pageCount === 0) return;
    const m = move;
    let step = 0;
    for (const p of visit(m)) {
      const first = step === 0;
      const last = step === pageCount;
      step += 1;
      if (!known(p)) {
        // At the limit nothing more is read: a page not read has no match to wait for.
        if (status === 'capped') continue;
        if (m.user) blocking = p;
        return;
      }
      const n = hitCount(p);
      if (n === 0) continue;
      let index = -1;
      if (m.dir === 1) {
        if (first) index = m.index + 1 < n ? m.index + 1 : -1;
        else if (last) index = m.index >= 0 ? 0 : -1;
        else index = 0;
      } else if (first) index = Math.min(m.index, n) - 1;
      else if (last) index = m.index < n ? n - 1 : -1;
      else index = n - 1;
      if (index >= 0 && (!last || (m.dir === 1 ? index <= m.index : index >= m.index))) {
        current = { pageIndex: p, index };
        move = null;
        return;
      }
    }
    // Every page read and no match there: the current one stays.
    move = null;
  };

  /** The next page to read, or -1. */
  const pick = (): number => {
    for (const p of wanted) {
      if (!kept.has(p)) return p;
      wanted.delete(p);
    }
    if (!needle || status === 'capped') return -1;
    const needs = (p: number) => !known(p) && tries[p] < ATTEMPTS;
    if (blocking >= 0 && needs(blocking)) return blocking;
    for (let d = 0; d < pageCount; d++) {
      const after = anchor + d;
      if (after < pageCount && needs(after)) return after;
      const before = anchor - d;
      if (d > 0 && before >= 0 && needs(before)) return before;
    }
    return -1;
  };

  const pump = async () => {
    if (reading || closed) return;
    const p = pick();
    if (p < 0) return;
    const controller = new AbortController();
    reading = controller;
    let content: SearchPageContent | null = null;
    let error = false;
    try {
      content = await o.read(p, controller.signal);
    } catch {
      error = true;
    }
    if (reading === controller) reading = null;
    if (closed || controller.signal.aborted) return;
    // Nothing read is kept or shown once the list has moved on.
    if (!o.inScope()) {
      close(true);
      return;
    }
    wanted.delete(p);
    if (error || !content) {
      tries[p] += 1;
      if (tries[p] >= ATTEMPTS && !failed[p]) {
        failed[p] = 1;
        failedCount += 1;
      }
    } else {
      const page = buildSearchPage(p, content.items, content.styles);
      if (page.hasText) keep(page);
      // A page read again for a highlight already has its matches.
      if (matchedFor[p] !== generation) match(page);
    }
    countSearched();
    updateStatus();
    resolveMove();
    changed();
    void pump();
  };

  const close = (tell = false) => {
    if (closed) return;
    closed = true;
    reading?.abort();
    reading = null;
    needle = '';
    current = null;
    move = null;
    kept.clear();
    keptCost = 0;
    wanted.clear();
    hits.fill(null);
    matchedFor.fill(-1);
    found = 0;
    status = 'closed';
    // V8 keeps the last string any regular expression matched until the next match anywhere.
    /(?:)/.exec('');
    version += 1;
    // Ended by a change of engagement or user: the box is told, with nothing left to show.
    if (tell) o.onChange();
  };

  return {
    setQuery(query, fromPage) {
      if (closed) return;
      needle = foldQuery(query);
      generation += 1;
      found = 0;
      current = null;
      move = null;
      hits.fill(null);
      anchor = Math.min(Math.max(0, Math.round(fromPage)), Math.max(0, pageCount - 1));
      if (needle) {
        // The texts kept are matched at once; the others are read.
        for (const page of kept.values()) match(page);
        move = { dir: 1, pageIndex: anchor, index: -1, user: false };
      }
      countSearched();
      updateStatus();
      resolveMove();
      changed();
      void pump();
    },
    next(shownPage) {
      if (closed || !needle) return;
      move = { dir: 1, pageIndex: shownPage, index: current && current.pageIndex === shownPage ? current.index : -1, user: true };
      resolveMove();
      changed();
      void pump();
    },
    prev(shownPage) {
      if (closed || !needle) return;
      move = { dir: -1, pageIndex: shownPage, index: current && current.pageIndex === shownPage ? current.index : Number.MAX_SAFE_INTEGER, user: true };
      resolveMove();
      changed();
      void pump();
    },
    state() {
      let ordinal = 0;
      if (current) {
        for (let p = 0; p < current.pageIndex; p++) ordinal += hitCount(p);
        ordinal += current.index + 1;
      }
      return {
        status,
        found,
        pagesSearched: closed ? 0 : pagesSearched,
        pageCount,
        noText: noTextCount,
        unreadable: failedCount,
        current: current ? { ...current, ordinal } : null,
        version,
      };
    },
    hitsOn(pageIndex) {
      if (closed || !needle || pageIndex < 0 || pageIndex >= pageCount || matchedFor[pageIndex] !== generation) return null;
      const ranges = hits[pageIndex];
      if (!ranges || ranges.length === 0) return null;
      const page = touch(pageIndex);
      if (page) return { page, ranges };
      wanted.add(pageIndex);
      void pump();
      return null;
    },
    keptPages: () => kept.size,
    keptCost: () => keptCost,
    close: () => close(false),
  };
}

// ---- what the search box says --------------------------------------------------------------------

const count = new Intl.NumberFormat('en-IN');

/** Under the empty search box: what matches, in plain words. */
export const SEARCH_HELP = 'Capitals, extra spaces and line breaks do not matter. 100000 also finds 1,00,000.';

/** The count beside the box: "3 of 17"; "17+ so far" while pages are still being read. */
export function searchCount(s: SearchState): string {
  if (s.status === 'idle' || s.status === 'closed') return '';
  if (s.status === 'reading') return s.found === 0 ? 'Searching…' : `${count.format(s.found)}+ so far`;
  if (s.found === 0) return 'No matches';
  const at = s.current ? `${count.format(s.current.ordinal)} of ` : '';
  return `${at}${count.format(s.found)}${s.status === 'capped' ? '+' : ''}`;
}

/** Lines under the box once the search has ended (pages with no text, pages not read, the limit). */
export function searchNotes(s: SearchState): string[] {
  if (s.status !== 'done' && s.status !== 'capped') return [];
  const notes: string[] = [];
  if (s.status === 'capped') notes.push(`Showing the first ${count.format(s.found)} matches. Type more of what you are looking for.`);
  if (s.noText > 0 && s.noText >= s.pageCount) notes.push('This file has no text that can be searched. Its pages are scans or blank.');
  else if (s.noText === 1) notes.push('1 page is a scan or blank, so it cannot be searched.');
  else if (s.noText > 1) notes.push(`${count.format(s.noText)} pages are scans or blank, so they cannot be searched.`);
  if (s.unreadable === 1) notes.push('1 page could not be read.');
  else if (s.unreadable > 1) notes.push(`${count.format(s.unreadable)} pages could not be read.`);
  return notes;
}

/** What a screen reader hears once the search has settled: the match and its page, or that there is none. */
export function searchAnnouncement(s: SearchState): string {
  if (s.status === 'idle' || s.status === 'closed') return '';
  if (s.status === 'reading') {
    if (!s.current) return s.found === 0 ? 'Searching.' : `${count.format(s.found)} found so far; still searching.`;
    return `Match on page ${s.current.pageIndex + 1}. ${count.format(s.found)} found so far; still searching.`;
  }
  if (s.found === 0) return ['No matches.', ...searchNotes(s)].join(' ');
  if (!s.current) return `${count.format(s.found)} matches.`;
  return `Match ${count.format(s.current.ordinal)} of ${count.format(s.found)}${s.status === 'capped' ? '+' : ''}, on page ${s.current.pageIndex + 1}.`;
}
