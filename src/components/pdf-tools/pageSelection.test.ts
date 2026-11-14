import { describe, expect, it } from 'vitest';
import { formatPageList } from '@/lib/pdf-tools/pageList';
import { chosenPageNumbers, readPageList, togglePage } from './pageSelection';

describe('readPageList', () => {
  it('keeps the written order and duplicates for an ordered list', () => {
    expect(readPageList('8, 1-3, 1', 10, 'as-written')).toEqual({ indices: [7, 0, 1, 2, 0], error: null });
  });

  it('sorts and drops duplicates for a set of pages', () => {
    expect(readPageList('8, 1-3, 1', 10, 'sorted')).toEqual({ indices: [0, 1, 2, 7], error: null });
  });

  it("returns the parser's own message for a bad list", () => {
    expect(readPageList('3-1', 10, 'sorted')).toEqual({ indices: null, error: '"3-1" is backwards: the first page must not be after the last' });
    expect(readPageList('12', 10, 'as-written').error).toBe("Page 12 is outside this file's 10 pages");
    expect(readPageList('', 10, 'as-written').error).toBe('Enter the pages you want, for example 1-3, 5');
    expect(readPageList('a', 10, 'as-written').error).toMatch(/is not a page or page range/);
  });
});

describe('togglePage', () => {
  it('removes every occurrence of a chosen page', () => {
    expect(togglePage([0, 4, 0, 2], 0, 'as-written')).toEqual([4, 2]);
  });

  it('keeps a set sorted', () => {
    expect(togglePage([1, 5], 3, 'sorted')).toEqual([1, 3, 5]);
  });

  it('keeps an ascending list ascending when pages are clicked in any order', () => {
    let list: number[] = [];
    for (const page of [0, 1, 2, 4, 3]) list = togglePage(list, page, 'as-written');
    expect(formatPageList(list)).toBe('1-5');
  });

  it('places a clicked page after the nearest lower page of a list written out of order', () => {
    expect(formatPageList(togglePage([7, 0, 1, 2, 3, 4], 5, 'as-written'))).toBe('8, 1-6');
    expect(togglePage([7, 3], 0, 'as-written')).toEqual([0, 7, 3]);
  });
});

describe('typed list and thumbnails stay in step', () => {
  it('round-trips: typed text -> chosen thumbnails -> click -> text', () => {
    const typed = readPageList('2-4, 9', 10, 'sorted');
    expect(chosenPageNumbers(typed.indices!)).toEqual([2, 3, 4, 9]);
    const afterClick = togglePage(typed.indices!, 4, 'sorted'); // page 5 clicked
    expect(formatPageList(afterClick)).toBe('2-5, 9');
    expect(readPageList(formatPageList(afterClick), 10, 'sorted').indices).toEqual(afterClick);
    const unclicked = togglePage(afterClick, 8, 'sorted'); // page 9 clicked again
    expect(formatPageList(unclicked)).toBe('2-5');
  });

  it('shows each chosen page once, in page order', () => {
    expect(chosenPageNumbers([7, 0, 0, 2])).toEqual([1, 3, 8]);
  });
});
