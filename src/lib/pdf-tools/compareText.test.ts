// Compare's text comparison (compareText.ts; contract T-064 decisions 3, 5, 17, risk 5): words, the word
// diff and its guard for very long pages, how pages are paired, and the counts. Every text is invented.
import { describe, expect, it } from 'vitest';
import { pacer } from './pace';
import {
  alignPages,
  changeEntries,
  compareTexts,
  diffWords,
  LARGE_PAGE_WORDS,
  pageHasNoText,
  pagesThatDiffer,
  wordsOf,
  type WordChange,
} from './compareText';
import { inventedPage, inventedWords, largePageTexts } from './testComparePdf';

const noPace = () => undefined;
const words = (text: string) => text.split(' ').filter(Boolean);

/** The earlier and later sequences rebuilt from a diff: same + removed, and same + added. */
function rebuilt(changes: readonly WordChange[]): { a: string[]; b: string[] } {
  const a: string[] = [];
  const b: string[] = [];
  for (const c of changes) {
    const w = words(c.text);
    if (c.kind !== 'added') a.push(...w);
    if (c.kind !== 'removed') b.push(...w);
  }
  return { a, b };
}

/** Length of the longest common subsequence, by the textbook table (a reference for small inputs). */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = up;
    }
  }
  return row[b.length];
}

const sameCount = (changes: readonly WordChange[]) => changes.filter((c) => c.kind === 'same').reduce((n, c) => n + words(c.text).length, 0);

describe('wordsOf', () => {
  it('splits on any run of spaces, tabs and line breaks, so they are never a difference', () => {
    expect(wordsOf('Trade  receivables\n1,23,456.78\t\tNote 7 ')).toEqual(['Trade', 'receivables', '1,23,456.78', 'Note', '7']);
    expect(wordsOf('Trade receivables 1,23,456.78 Note 7')).toEqual(wordsOf('Trade\nreceivables\n\n1,23,456.78   Note\t7'));
  });

  it('reads ligatures and non-breaking spaces as plain text, and drops soft hyphens and zero-width marks', () => {
    expect(wordsOf('pro\uFB01t\u00A0after tax')).toEqual(['profit', 'after', 'tax']);
    expect(wordsOf('inter\u00ADnational re\u200Bport')).toEqual(['international', 'report']);
  });

  it('gives nothing for an empty page', () => {
    expect(wordsOf('')).toEqual([]);
    expect(wordsOf(' \n\t ')).toEqual([]);
  });
});

describe('words hyphenated across a line end (Round 2)', () => {
  it('a line ending in a hyphen before a small letter is one word, the hyphen dropped (as PDF to Word does)', () => {
    expect(wordsOf('the inter-\nnational body')).toEqual(['the', 'international', 'body']);
    expect(wordsOf('the inter-\n  national body')).toEqual(['the', 'international', 'body']);
  });

  it('a year range broken after its hyphen keeps it', () => {
    expect(wordsOf('for 2024-\n25 only')).toEqual(['for', '2024-25', 'only']);
  });

  it('is left alone before a capital, a blank line, a lone dash, an amount with a trailing minus, or within a line', () => {
    expect(wordsOf('North-\nEast')).toEqual(['North-', 'East']);
    expect(wordsOf('inter-\n\nnational')).toEqual(['inter-', 'national']);
    expect(wordsOf('text -\nnext')).toEqual(['text', '-', 'next']);
    expect(wordsOf('1,000-\n25')).toEqual(['1,000-', '25']);
    expect(wordsOf('inter- national')).toEqual(['inter-', 'national']);
  });

  it('compared with the other version: either form matches (dropped or kept), so a re-wrapped paragraph does not differ', async () => {
    const earlier = 'The inter-\nnational co-\noperative closed 2024-\n25 and the self-\nassessment was paid by the trea-\nsurer';
    const later = 'The international co-operative closed 2024-25 and the\nself-assessment was paid by the treasurer';
    expect(pagesThatDiffer(await compareTexts([earlier], [later], noPace))).toBe(0);
    expect(pagesThatDiffer(await compareTexts([later], [earlier], noPace))).toBe(0);
    // Both broken, at the same or other places: still the same.
    const other = 'The inter-\nnational co-operative closed 2024-25 and the self-assessment was paid by the treasurer';
    expect(pagesThatDiffer(await compareTexts([earlier], [other], noPace))).toBe(0);
  });

  it('a real change next to a broken word is still found, once', async () => {
    const c = await compareTexts(['The co-\noperative paid 1,000.00 in tax'], ['The co-operative paid 1,200.00 in tax'], noPace);
    expect(c).toMatchObject({ pagesDiffer: 1, wordsChanged: 1, wordsAdded: 0, wordsRemoved: 0 });
  });
});

describe('pageHasNoText', () => {
  it('counts a page with fewer than 20 characters besides spaces as having no text, as the other tools do', () => {
    expect(pageHasNoText('')).toBe(true);
    expect(pageHasNoText('Page 3')).toBe(true);
    expect(pageHasNoText('Balance sheet as at 31 March')).toBe(false);
  });
});

describe('diffWords', () => {
  it('marks a word added, a word removed, and keeps the rest as the same', () => {
    expect(diffWords(words('net profit for the year'), words('net profit after tax for the year'))).toEqual([
      { kind: 'same', text: 'net profit' },
      { kind: 'added', text: 'after tax' },
      { kind: 'same', text: 'for the year' },
    ]);
    expect(diffWords(words('net profit after tax for the year'), words('net profit for the year'))).toEqual([
      { kind: 'same', text: 'net profit' },
      { kind: 'removed', text: 'after tax' },
      { kind: 'same', text: 'for the year' },
    ]);
  });

  it('shows a changed number as removed then added, side by side', () => {
    const changes = diffWords(words('Trade receivables 1,23,456.78 Note 7'), words('Trade receivables 1,24,000.00 Note 7'));
    expect(changes).toEqual([
      { kind: 'same', text: 'Trade receivables' },
      { kind: 'removed', text: '1,23,456.78' },
      { kind: 'added', text: '1,24,000.00' },
      { kind: 'same', text: 'Note 7' },
    ]);
  });

  it('handles empty sides and identical sides', () => {
    expect(diffWords([], [])).toEqual([]);
    expect(diffWords([], words('a b'))).toEqual([{ kind: 'added', text: 'a b' }]);
    expect(diffWords(words('a b'), [])).toEqual([{ kind: 'removed', text: 'a b' }]);
    expect(diffWords(words('a b c'), words('a b c'))).toEqual([{ kind: 'same', text: 'a b c' }]);
  });

  it('is a shortest diff: on random inputs it rebuilds both sides and keeps a longest common subsequence', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 200; round++) {
      const vocab = 2 + Math.floor(rand() * 6);
      const a = Array.from({ length: Math.floor(rand() * 40) }, () => `w${Math.floor(rand() * vocab)}`);
      const b = Array.from({ length: Math.floor(rand() * 40) }, () => `w${Math.floor(rand() * vocab)}`);
      const changes = diffWords(a, b);
      expect(rebuilt(changes)).toEqual({ a, b });
      expect(sameCount(changes)).toBe(lcsLength(a, b));
      // Runs are merged: never two runs of the same kind in a row.
      for (let k = 1; k < changes.length; k++) expect(changes[k].kind === changes[k - 1].kind).toBe(false);
    }
  });
});

describe('changeEntries', () => {
  it('gives each change with up to five words of the same text on each side', () => {
    const a = words('one two three four five six seven 1,23,456.78 eight nine ten eleven twelve thirteen');
    const b = words('one two three four five six seven 1,24,000.00 eight nine ten eleven twelve thirteen');
    expect(changeEntries(diffWords(a, b))).toEqual([
      { before: words('three four five six seven'), removed: ['1,23,456.78'], added: ['1,24,000.00'], after: words('eight nine ten eleven twelve'), atStart: false, atEnd: false },
    ]);
  });

  it('stops the context at the next change, so it is always text found in both versions', () => {
    const entries = changeEntries(diffWords(words('a b X c d Y e'), words('a b c d e')));
    expect(entries).toEqual([
      { before: ['a', 'b'], removed: ['X'], added: [], after: ['c', 'd'], atStart: true, atEnd: false },
      { before: ['c', 'd'], removed: ['Y'], added: [], after: ['e'], atStart: false, atEnd: true },
    ]);
  });
});

describe('alignPages', () => {
  const pages = (n: number, seed: number) => Array.from({ length: n }, (_, i) => inventedWords(seed * 1000 + i, 120));

  it('pairs identical files page by page', () => {
    const a = pages(5, 1);
    expect(alignPages(a, a.map((p) => [...p]))).toEqual([0, 1, 2, 3, 4].map((i) => [i, i]));
  });

  it('an inserted page is listed only in the later file and every later page still pairs with its own', () => {
    const a = pages(6, 2);
    const b = [...a.slice(0, 3), inventedWords(99, 120), ...a.slice(3)];
    expect(alignPages(a, b)).toEqual([[0, 0], [1, 1], [2, 2], [null, 3], [3, 4], [4, 5], [5, 6]]);
  });

  it('a removed page is listed only in the earlier file', () => {
    const a = pages(6, 3);
    const b = [...a.slice(0, 2), ...a.slice(3)];
    expect(alignPages(a, b)).toEqual([[0, 0], [1, 1], [2, null], [3, 2], [4, 3], [5, 4]]);
  });

  it('pairs a changed page in order when at least half its words are shared, else lists both pages as only in one file', () => {
    const a = pages(3, 4);
    const lightly = [...a[1].slice(0, 100), ...inventedWords(500, 20)]; // 100 of 120 words shared
    const mostly = [...a[1].slice(0, 50), ...inventedWords(501, 70)]; // 50 of 120 shared: under half
    expect(alignPages(a, [a[0], lightly, a[2]])).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(alignPages(a, [a[0], mostly, a[2]])).toEqual([[0, 0], [1, null], [null, 1], [2, 2]]);
  });

  it('a new page that shares the boilerplate of a changed page does not take its place', () => {
    const boiler = inventedWords(700, 50); // the same heading and footer on every page
    const a = [0, 1, 2, 3].map((i) => [...boiler.slice(0, 25), ...inventedWords(710 + i, 60), ...boiler.slice(25)]);
    const changed = [...a[2].slice(0, 120), ...inventedWords(800, 15)]; // page 3 edited, still mostly the same
    const inserted = [...boiler.slice(0, 25), ...inventedWords(801, 60), ...boiler.slice(25)]; // shares 50 of 110: under half
    const b = [a[0], a[1], inserted, changed, a[3]];
    expect(alignPages(a, b)).toEqual([[0, 0], [1, 1], [null, 2], [2, 3], [3, 4]]);
  });

  it('pages of different counts with a page moved to the end', () => {
    const a = pages(5, 5);
    const b = [a[0], a[2], a[3], a[4], a[1], inventedWords(900, 120), inventedWords(901, 120)];
    const pairs = alignPages(a, b);
    // Every page of either file appears once, in order.
    expect(pairs.map(([i]) => i).filter((i) => i !== null)).toEqual([0, 1, 2, 3, 4]);
    expect(pairs.map(([, j]) => j).filter((j) => j !== null)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pairs.filter(([i, j]) => i !== null && j !== null)).toEqual([[0, 0], [2, 1], [3, 2], [4, 3]]);
  });
});

describe('compareTexts', () => {
  const page = (seed: number) => inventedPage(seed, 150);

  it('counts pages and words: two pages differ, a number changed, words added and removed', async () => {
    const earlier = [0, 1, 2, 3, 4].map(page);
    const later = [...earlier];
    later[1] = earlier[1].replace(/^(\S+ \S+ \S+)/, '$1 1,23,456.78').replace(/(\S+)$/, '$1 extra words');
    const earlier1 = earlier[1].replace(/^(\S+ \S+ \S+)/, '$1 1,22,000.00');
    const earlierPages = [earlier[0], earlier1, earlier[2], earlier[3], earlier[4]];
    later[3] = wordsOf(earlier[3]).filter((_, i) => i !== 10).join(' ');
    const c = await compareTexts(earlierPages, later, noPace);
    expect(c).toMatchObject({ pagesEarlier: 5, pagesLater: 5, pagesDiffer: 2, pagesOnlyEarlier: 0, pagesOnlyLater: 0, wordsAdded: 2, wordsRemoved: 1, wordsChanged: 1, pagesWithoutText: 0, pagesComparedCoarsely: 0 });
    expect(pagesThatDiffer(c)).toBe(2);
    expect(c.pairs.map((p) => [p.earlier, p.later, p.changes.length > 0])).toEqual([
      [0, 0, false],
      [1, 1, true],
      [2, 2, false],
      [3, 3, true],
      [4, 4, false],
    ]);
  });

  it('whitespace and line breaks are not differences', async () => {
    const text = page(3);
    const c = await compareTexts([text], [text.replace(/ /g, '\n').replace(/\n(\S+)\n/, '   $1\t')], noPace);
    expect(pagesThatDiffer(c)).toBe(0);
  });

  it('an inserted page: one page differs, only in the later file, and its words are not counted as added', async () => {
    const earlier = [0, 1, 2, 3].map(page);
    const later = [earlier[0], earlier[1], page(50), earlier[2], earlier[3]];
    const c = await compareTexts(earlier, later, noPace);
    expect(c).toMatchObject({ pagesDiffer: 0, pagesOnlyEarlier: 0, pagesOnlyLater: 1, wordsAdded: 0 });
    expect(pagesThatDiffer(c)).toBe(1);
    expect(c.pairs).toHaveLength(5);
    // The page in one file only keeps its words, as one run, for the report.
    expect(c.pairs[2]).toMatchObject({ earlier: null, later: 2, changes: [{ kind: 'added', text: wordsOf(page(50)).join(' ') }] });
  });

  it('counts pages with no text in both files', async () => {
    const c = await compareTexts([page(1), '', 'Page 3'], [page(1), '', page(2)], noPace);
    expect(c.pagesWithoutText).toBe(3);
  });

  it('a page over 5,000 words is compared in larger pieces, quickly, with every stretch between turns under 100 ms', async () => {
    const { earlier, later } = largePageTexts();
    expect(wordsOf(earlier).length).toBeGreaterThan(LARGE_PAGE_WORDS);
    // The longest stretch of work between two chances of a turn (the turn's own timer wait left out).
    let last = performance.now();
    let longest = 0;
    const paced = pacer(undefined, 10);
    const pace = () => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      const turn = paced();
      return turn?.then(() => {
        last = performance.now();
      });
    };
    const started = performance.now();
    const c = await compareTexts([earlier], [later], pace);
    const took = performance.now() - started;
    expect(c.pagesComparedCoarsely).toBe(1);
    expect(c.pairs[0].coarse).toBe(true);
    expect(c.pagesDiffer).toBe(1);
    // The fixture changes 6 numbers, adds 4 words and removes 3, spread over the page.
    expect(c.wordsChanged).toBe(6);
    expect(c.wordsAdded).toBe(4);
    expect(c.wordsRemoved).toBe(3);
    expect(took).toBeLessThan(3000);
    // Well under the 0.3 s rule; 100 ms leaves room for a cold start on a busy machine (50.3 ms was seen once).
    expect(longest).toBeLessThan(100);
  });

  it('a long page totally rewritten stays bounded (a whole passage removed and added), never seconds', async () => {
    const a = inventedWords(1, 20_000).join(' ');
    const b = inventedWords(2, 20_000).join(' ');
    const started = performance.now();
    const c = await compareTexts([a, page(5)], [b, page(5)], noPace);
    expect(performance.now() - started).toBeLessThan(3000);
    // Under half the words shared: listed as only in each file, not diffed.
    expect(c).toMatchObject({ pagesOnlyEarlier: 1, pagesOnlyLater: 1, pagesDiffer: 0 });
  });

  it('a long page with its words shuffled is still paired, compared in larger pieces, and bounded in time', async () => {
    const a = inventedWords(3, 8_000);
    let seed = 11;
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [b[i], b[j]] = [b[j], b[i]];
    }
    const started = performance.now();
    const c = await compareTexts([a.join(' ')], [b.join(' ')], noPace);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(c.pairs).toHaveLength(1);
    expect(c.pairs[0]).toMatchObject({ earlier: 0, later: 0, coarse: true });
    expect(c.pagesComparedCoarsely).toBe(1);
    // Every word is accounted for: what is the same, plus removed and changed, is the earlier page.
    const same = sameCount(c.pairs[0].changes ?? []);
    expect(same + c.wordsRemoved + c.wordsChanged).toBe(8_000);
    expect(same + c.wordsAdded + c.wordsChanged).toBe(8_000);
  });

  it('Stop lands during a long comparison: the pace check throws and nothing comes back', async () => {
    const { earlier, later } = largePageTexts();
    let calls = 0;
    const stop = new Error('stopped');
    const pace = () => {
      calls += 1;
      if (calls > 20) throw stop;
      return undefined;
    };
    await expect(compareTexts([earlier, earlier], [later, later], pace)).rejects.toBe(stop);
  });
});
