import { describe, expect, it } from 'vitest';
import { formatPageList, parsePageList } from './pageList';
import { PdfToolsError } from './types';

describe('parsePageList', () => {
  it('parses ranges and singles into 0-based indices', () => {
    expect(parsePageList('1-5, 8, 10-12', 12)).toEqual([0, 1, 2, 3, 4, 7, 9, 10, 11]);
  });
  it('keeps the order as written', () => {
    expect(parsePageList(' 3 ,1 ', 5)).toEqual([2, 0]);
  });
  it('keeps duplicates unless unique is requested', () => {
    expect(parsePageList('2,2', 5)).toEqual([1, 1]);
    expect(parsePageList('2,2,1-2', 5, { unique: true })).toEqual([1, 0]);
  });
  it('rejects malformed or out-of-range input', () => {
    for (const bad of ['', ' ', '0', '6', '5-2', 'a', '1-', '1.5', '-3', '1--2', '1,,2', '1,']) {
      expect(() => parsePageList(bad, 5)).toThrowError(PdfToolsError);
    }
  });
  it('accepts spaces around the dash', () => {
    expect(parsePageList('1 - 3', 5)).toEqual([0, 1, 2]);
  });
  it('rejects exponent and non-ASCII numerals', () => {
    for (const bad of ['1e3', '१', '१-३']) {
      expect(() => parsePageList(bad, 5)).toThrowError(PdfToolsError);
    }
  });
  it('rejects a huge range quickly', () => {
    const start = Date.now();
    expect(() => parsePageList('1-999999999', 5)).toThrowError(PdfToolsError);
    expect(Date.now() - start).toBeLessThan(500);
  });
  it('reports a user-facing message and code', () => {
    try {
      parsePageList('6', 5);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PdfToolsError);
      expect((e as PdfToolsError).code).toBe('invalid-page-list');
      expect((e as PdfToolsError).message).toBe("Page 6 is outside this file's 5 pages");
    }
  });
});

describe('formatPageList', () => {
  it('collapses consecutive runs', () => {
    expect(formatPageList([0, 1, 2, 7])).toBe('1-3, 8');
    expect(formatPageList([])).toBe('');
  });
});
