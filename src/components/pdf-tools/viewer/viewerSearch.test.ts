import { describe, expect, it, vi } from 'vitest';
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import { createViewerSearch, searchAnnouncement, searchCount, searchNotes, SEARCH_HELP, type SearchState, type ViewerSearchOptions } from './viewerSearch';

const STYLES: Record<string, FontStyleLike> = { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } };

/** A page's text content: one item per line. */
const content = (lines: string[]) => ({
  items: lines.map((str, k): TextItemLike => ({ str, transform: [10, 0, 0, 10, 72, 700 - 14 * k], width: str.length * 5, height: 10, fontName: 'f1', hasEOL: true })),
  styles: STYLES,
});

type PageSpec = string[] | 'fail';

/** A reader whose reads wait until the test lets them finish, in order. */
function fakeReader(pages: PageSpec[]) {
  const reads: number[] = [];
  const waiting: { pageIndex: number; signal: AbortSignal; finish: () => void }[] = [];
  let inFlight = 0;
  let most = 0;
  const read = vi.fn(
    (pageIndex: number, signal: AbortSignal) =>
      new Promise<ReturnType<typeof content>>((resolve, reject) => {
        reads.push(pageIndex);
        inFlight += 1;
        most = Math.max(most, inFlight);
        const spec = pages[pageIndex];
        waiting.push({
          pageIndex,
          signal,
          finish: () => {
            inFlight -= 1;
            if (spec === 'fail') reject(new Error('Bad content stream'));
            else resolve(content(spec));
          },
        });
      }),
  );
  return {
    read,
    reads,
    waiting,
    most: () => most,
    /** Lets the oldest read finish and the engine take it in. */
    async step() {
      const next = waiting.shift();
      if (!next) return false;
      next.finish();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      return true;
    },
    async all() {
      for (let guard = 0; guard < 1000 && (await this.step()); guard++);
    },
  };
}

function setup(pages: PageSpec[], options: Partial<ViewerSearchOptions> = {}) {
  const reader = fakeReader(pages);
  const onChange = vi.fn();
  let inScope = true;
  const search = createViewerSearch({ pageCount: pages.length, read: reader.read, inScope: () => inScope, onChange, ...options });
  return { search, reader, onChange, leaveScope: () => (inScope = false) };
}

const blank = (n: number): PageSpec[] => Array.from({ length: n }, () => ['Nothing to see here']);

describe('reading pages for a search', () => {
  it('reads from the page shown outward, one page at a time, and only once a query is typed', async () => {
    const { search, reader } = setup(blank(10));
    await reader.all();
    expect(reader.reads).toEqual([]);
    search.setQuery('ledger', 5);
    await reader.all();
    expect(reader.reads).toEqual([5, 6, 4, 7, 3, 8, 2, 9, 1, 0]);
    expect(reader.most()).toBe(1);
    expect(search.state()).toMatchObject({ status: 'done', found: 0, pagesSearched: 10 });
  });

  it('counts while reading ("so far"), then gives the position once every page is read', async () => {
    const pages = blank(6);
    pages[0] = ['Cash at Bank'];
    pages[2] = ['cash at bank', 'Cash  at', 'Bank'];
    const { search, reader } = setup(pages);
    search.setQuery('Cash at Bank', 2);
    await reader.step(); // page 3
    expect(search.state()).toMatchObject({ status: 'reading', found: 2, pagesSearched: 1 });
    expect(searchCount(search.state())).toBe('2+ so far');
    await reader.all();
    const done = search.state();
    expect(done).toMatchObject({ status: 'done', found: 3, current: { pageIndex: 2, index: 0, ordinal: 2 } });
    expect(searchCount(done)).toBe('2 of 3');
  });

  it('the first match at or after the page shown comes first, even when an earlier page is read before it', async () => {
    const pages = blank(10);
    pages[4] = ['Suspense account'];
    pages[8] = ['Suspense account'];
    const { search, reader } = setup(pages);
    search.setQuery('suspense', 5);
    for (let i = 0; i < 3; i++) await reader.step();
    expect(search.state().current).toBeNull();
    await reader.all();
    expect(search.state().current).toEqual({ pageIndex: 8, index: 0, ordinal: 2 });
    // Read outward from the page shown all the same.
    expect(reader.reads.slice(0, 6)).toEqual([5, 6, 4, 7, 3, 8]);
  });

  it('with no match after the page shown, the first match in the file', async () => {
    const pages = blank(8);
    pages[1] = ['Suspense'];
    const { search, reader } = setup(pages);
    search.setQuery('suspense', 5);
    await reader.all();
    expect(search.state().current).toEqual({ pageIndex: 1, index: 0, ordinal: 1 });
  });

  it('pages with no text (scans, blank pages) are counted and said plainly', async () => {
    const pages: PageSpec[] = [['Cash'], [], ['   '], ['Cash book'], []];
    const { search, reader } = setup(pages);
    search.setQuery('cash', 0);
    await reader.all();
    const state = search.state();
    expect(state).toMatchObject({ found: 2, noText: 3, status: 'done' });
    expect(searchNotes(state)).toEqual(['3 pages are scans or blank, so they cannot be searched.']);
    const one = setup([['Cash'], []]);
    one.search.setQuery('cash', 0);
    await one.reader.all();
    expect(searchNotes(one.search.state())).toEqual(['1 page is a scan or blank, so it cannot be searched.']);
    const scan = setup([[], [], []]);
    scan.search.setQuery('cash', 0);
    await scan.reader.all();
    expect(searchCount(scan.search.state())).toBe('No matches');
    expect(searchNotes(scan.search.state())).toEqual(['This file has no text that can be searched. Its pages are scans or blank.']);
  });

  it('a page that cannot be read is tried twice, then counted', async () => {
    const { search, reader } = setup([['Cash'], 'fail', ['Cash']]);
    search.setQuery('cash', 0);
    await reader.all();
    expect(reader.reads.filter((p) => p === 1)).toHaveLength(2);
    expect(search.state()).toMatchObject({ status: 'done', found: 2, unreadable: 1 });
    expect(searchNotes(search.state())).toEqual(['1 page could not be read.']);
  });

  it('a new query uses the page texts already read; nothing is read again', async () => {
    const pages = blank(5);
    pages[3] = ['Bank charges'];
    const { search, reader } = setup(pages);
    search.setQuery('bank', 0);
    await reader.all();
    expect(reader.reads).toHaveLength(5);
    search.setQuery('charges', 0);
    await reader.all();
    expect(reader.reads).toHaveLength(5);
    expect(search.state()).toMatchObject({ status: 'done', found: 1, current: { pageIndex: 3, index: 0, ordinal: 1 } });
  });

  it('the page texts kept stay within a memory budget; pages let go are read again for a new query', async () => {
    const pages = Array.from({ length: 20 }, (_, k): PageSpec => [`Page ${k} of the ledger with some text to fill it out`]);
    const { search, reader } = setup(pages, { budget: 2_000 });
    search.setQuery('ledger', 0);
    await reader.all();
    expect(search.state()).toMatchObject({ status: 'done', found: 20 });
    expect(search.keptCost()).toBeLessThanOrEqual(2_000);
    expect(search.keptPages()).toBeLessThan(20);
    search.setQuery('fill', 0);
    await reader.all();
    expect(reader.reads.length).toBeGreaterThan(20);
    expect(search.state()).toMatchObject({ status: 'done', found: 20 });
  });

  it("the hits of a page whose text was let go come back after reading it again", async () => {
    const pages = Array.from({ length: 20 }, (_, k): PageSpec => [`Page ${k} of the ledger with some text to fill it out`]);
    const { search, reader, onChange } = setup(pages, { budget: 2_000 });
    search.setQuery('ledger', 0);
    await reader.all();
    const gone = Array.from({ length: 20 }, (_, k) => k).find((k) => search.hitsOn(k) === null)!;
    expect(gone).toBeDefined();
    onChange.mockClear();
    await reader.all();
    const back = search.hitsOn(gone)!;
    expect(onChange).toHaveBeenCalled();
    expect(back.page.text.slice(back.ranges[0], back.ranges[1])).toBe('ledger');
  });

  it('stops at the limit of matches and says so', async () => {
    const pages = Array.from({ length: 10 }, (): PageSpec => ['a a a']);
    const { search, reader } = setup(pages, { maxHits: 7 });
    search.setQuery('a', 0);
    await reader.all();
    expect(search.state()).toMatchObject({ status: 'capped', found: 7 });
    expect(reader.reads).toHaveLength(3);
    expect(searchCount(search.state())).toBe('1 of 7+');
    expect(searchNotes(search.state())).toEqual(['Showing the first 7 matches. Type more of what you are looking for.']);
  });

  it('says the limit also when every page text was already kept from an earlier query (found in the app)', async () => {
    const pages = Array.from({ length: 10 }, (): PageSpec => ['a a a']);
    const { search, reader } = setup(pages, { maxHits: 7 });
    search.setQuery('nothing here', 0);
    await reader.all();
    expect(search.keptPages()).toBe(10);
    const reads = reader.reads.length;
    search.setQuery('a', 0);
    await reader.all();
    expect(reader.reads).toHaveLength(reads);
    expect(search.state()).toMatchObject({ status: 'capped', found: 7 });
    expect(searchCount(search.state())).toBe('1 of 7+');
    expect(searchNotes(search.state())).toEqual(['Showing the first 7 matches. Type more of what you are looking for.']);
    // The limit reached exactly on the last page read is still the limit.
    const exact = setup([['a a a'], ['a a a'], ['a']], { maxHits: 7 });
    exact.search.setQuery('a', 0);
    await exact.reader.all();
    expect(exact.search.state()).toMatchObject({ status: 'capped', found: 7 });
  });

  it('an empty query clears the search and reads nothing more', async () => {
    const { search, reader } = setup(blank(10));
    search.setQuery('ledger', 0);
    await reader.step();
    search.setQuery('   ', 0);
    await reader.all();
    expect(reader.reads.length).toBeLessThanOrEqual(2);
    expect(search.state()).toMatchObject({ status: 'idle', found: 0, current: null });
    expect(searchCount(search.state())).toBe('');
  });
});

describe('moving between matches', () => {
  const pages: PageSpec[] = [['Cash', 'cash'], ['nothing'], ['Cash'], ['nothing'], ['cash book', 'petty cash']];

  it('next and previous go through the matches in file order, across pages, and wrap', async () => {
    const { search, reader } = setup(pages);
    search.setQuery('cash', 0);
    await reader.all();
    const at = () => [search.state().current!.pageIndex, search.state().current!.index, search.state().current!.ordinal];
    expect(at()).toEqual([0, 0, 1]);
    search.next(0);
    expect(at()).toEqual([0, 1, 2]);
    search.next(0);
    expect(at()).toEqual([2, 0, 3]);
    search.next(2);
    search.next(4);
    expect(at()).toEqual([4, 1, 5]);
    search.next(4);
    expect(at()).toEqual([0, 0, 1]);
    search.prev(0);
    expect(at()).toEqual([4, 1, 5]);
    search.prev(4);
    search.prev(4);
    expect(at()).toEqual([2, 0, 3]);
  });

  it('after the user has paged away, next and previous start from the page shown', async () => {
    const { search, reader } = setup(pages);
    search.setQuery('cash', 0);
    await reader.all();
    search.next(3); // the user is on page 4
    expect(search.state().current).toMatchObject({ pageIndex: 4, index: 0 });
    search.prev(1); // the user is on page 2
    expect(search.state().current).toMatchObject({ pageIndex: 0, index: 1 });
  });

  it('next waits for a page not yet read rather than skipping a match on it', async () => {
    const spec = blank(10);
    spec[2] = ['Cash'];
    spec[6] = ['Cash'];
    spec[9] = ['Cash'];
    const { search, reader } = setup(spec);
    search.setQuery('cash', 2);
    await reader.step(); // page 3 only
    expect(search.state().current).toMatchObject({ pageIndex: 2 });
    search.next(2);
    expect(search.state().current).toMatchObject({ pageIndex: 2 });
    await reader.all();
    expect(search.state().current).toMatchObject({ pageIndex: 6, index: 0 });
  });
});

describe('ending a search', () => {
  it('closing cancels the page being read, reads nothing more and says nothing afterwards', async () => {
    const { search, reader, onChange } = setup(blank(10));
    search.setQuery('ledger', 0);
    await reader.step();
    const inFlight = reader.waiting[0];
    search.close();
    expect(inFlight.signal.aborted).toBe(true);
    onChange.mockClear();
    const readsAtClose = reader.reads.length;
    await reader.all();
    expect(reader.reads).toHaveLength(readsAtClose);
    expect(onChange).not.toHaveBeenCalled();
    expect(search.state()).toMatchObject({ status: 'closed', found: 0, current: null });
    search.setQuery('ledger', 0);
    search.next(0);
    expect(reader.reads).toHaveLength(readsAtClose);
  });

  it('a page read that comes back after the engagement or user changed shows nothing, and the search ends', async () => {
    const pages = blank(4);
    pages[0] = ['Client ledger'];
    const { search, reader, leaveScope } = setup(pages);
    search.setQuery('ledger', 0);
    leaveScope();
    await reader.all();
    expect(search.state()).toMatchObject({ status: 'closed', found: 0, current: null });
    expect(search.hitsOn(0)).toBeNull();
    expect(reader.reads).toEqual([0]);
  });

  it('closing forgets the page texts and leaves nothing of a match in the engine-wide RegExp statics', async () => {
    const pages = blank(3);
    pages[1] = ['Client ledger'];
    const { search, reader } = setup(pages);
    search.setQuery('ledger', 0);
    await reader.all();
    expect(search.hitsOn(1)).not.toBeNull();
    /ledger/.exec('Client ledger');
    search.close();
    expect(search.hitsOn(1)).toBeNull();
    expect(search.keptPages()).toBe(0);
    const statics = RegExp as unknown as { input: string; lastMatch: string };
    expect([statics.input, statics.lastMatch]).toEqual(['', '']);
  });
});

describe('what the search box says', () => {
  const state = (s: Partial<SearchState>): SearchState => ({ status: 'done', found: 0, pagesSearched: 320, pageCount: 320, noText: 0, unreadable: 0, current: null, version: 1, ...s });

  it('the count, in Indian grouping', () => {
    expect(searchCount(state({ status: 'idle' }))).toBe('');
    expect(searchCount(state({ status: 'reading', found: 0, pagesSearched: 3 }))).toBe('Searching…');
    expect(searchCount(state({ status: 'reading', found: 17, pagesSearched: 3 }))).toBe('17+ so far');
    expect(searchCount(state({ found: 17, current: { pageIndex: 51, index: 0, ordinal: 3 } }))).toBe('3 of 17');
    expect(searchCount(state({ found: 123456, current: { pageIndex: 51, index: 0, ordinal: 100000 } }))).toBe('1,00,000 of 1,23,456');
    expect(searchCount(state({ found: 0 }))).toBe('No matches');
  });

  it('what is read out: the match and its page, once settled', () => {
    expect(searchAnnouncement(state({ found: 17, current: { pageIndex: 51, index: 0, ordinal: 3 } }))).toBe('Match 3 of 17, on page 52.');
    expect(searchAnnouncement(state({ status: 'reading', found: 4, pagesSearched: 9, current: { pageIndex: 7, index: 1, ordinal: 2 } }))).toBe('Match on page 8. 4 found so far; still searching.');
    expect(searchAnnouncement(state({ found: 0, noText: 12 }))).toBe('No matches. 12 pages are scans or blank, so they cannot be searched.');
    expect(searchAnnouncement(state({ status: 'idle' }))).toBe('');
  });

  it('the help line says what matches, in plain words', () => {
    expect(SEARCH_HELP).toBe('Capitals, extra spaces and line breaks do not matter. 100000 also finds 1,00,000.');
  });
});
