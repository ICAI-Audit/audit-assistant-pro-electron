// What the progress bar says while Organise pages runs: the pages one by one, a second pass said as
// such when the library starts again from page 1 (files with unusual names, pageOrder.ts fix round 1),
// and the check of every page against the original after the last page.
import { describe, expect, it } from 'vitest';
import { CHECKING_PAGES, pageLabeller } from './organiseProgress';

describe('pageLabeller', () => {
  it('copying, then a second pass that never looks like the bar went backwards for no reason', () => {
    const label = pageLabeller(false);
    expect([1, 2, 3].map((page) => label(page, 3))).toEqual(['Copying the pages (1 of 3)…', 'Copying the pages (2 of 3)…', 'Copying the pages (3 of 3)…']);
    expect(label(1, 3)).toBe('Copying the pages, second pass (1 of 3)…');
    expect(label(2, 3)).toBe('Copying the pages, second pass (2 of 3)…');
  });
  it('rotating in place says so', () => {
    const label = pageLabeller(true);
    expect(label(1, 5)).toBe('Rotating the pages (1 of 5)…');
    expect(label(5, 5)).toBe('Rotating the pages (5 of 5)…');
    expect(label(1, 5)).toBe('Rotating the pages, second pass (1 of 5)…');
  });
  it('the same page twice (a repeated report) is not a second pass', () => {
    const label = pageLabeller(false);
    label(4, 9);
    expect(label(4, 9)).toBe('Copying the pages (4 of 9)…');
  });
  it('the check after the last page', () => {
    expect(CHECKING_PAGES).toBe('Checking every page against the original…');
  });
});
