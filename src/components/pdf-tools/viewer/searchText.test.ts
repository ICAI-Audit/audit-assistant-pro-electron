import { describe, expect, it } from 'vitest';
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import { buildSearchPage, findInPage, foldQuery, foldText } from './searchText';

const STYLES: Record<string, FontStyleLike> = { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } };

/** A text item at (x, y), `size` points, each character half an em wide unless `width` is given. */
function item(str: string, x: number, y: number, more: Partial<TextItemLike> & { size?: number } = {}): TextItemLike {
  const size = more.size ?? 10;
  return { str, transform: [size, 0, 0, size, x, y], width: more.width ?? str.length * size * 0.5, height: size, fontName: 'f1', hasEOL: more.hasEOL ?? false };
}

/** The original text of every hit of `query` on a page made of `items`. */
function hitsOf(items: TextItemLike[], query: string, limit?: number): string[] {
  const page = buildSearchPage(0, items, STYLES);
  const ranges = findInPage(page, foldQuery(query), limit);
  const out: string[] = [];
  for (let k = 0; k < ranges.length; k += 2) out.push(page.text.slice(ranges[k], ranges[k + 1]));
  return out;
}

describe('what a search matches', () => {
  it('ignores capitals', () => {
    expect(hitsOf([item('Cash at Bank', 72, 700)], 'cash AT bank')).toEqual(['Cash at Bank']);
    expect(hitsOf([item('CASH AT BANK', 72, 700)], 'Cash at bank')).toEqual(['CASH AT BANK']);
  });

  it('treats any run of spaces and line breaks in the file, and in what is typed, as one space', () => {
    const items = [item('Cash   at', 72, 700, { hasEOL: true }), item('Bank', 72, 686)];
    expect(hitsOf(items, 'cash at bank')).toEqual(['Cash   at Bank']);
    expect(hitsOf(items, '  cash    at  bank ')).toEqual(['Cash   at Bank']);
    // A non-breaking space and a tab are spaces too.
    expect(hitsOf([item('Cash\u00a0at\tBank', 72, 700)], 'cash at bank')).toEqual(['Cash\u00a0at\tBank']);
  });

  it('a phrase runs across items and lines; a space typed is still needed where words are apart', () => {
    // Two items on two lines, pdf.js marking no end of line: a space between them all the same.
    const twoLines = [item('Balance as per', 72, 700), item('books', 72, 686)];
    expect(hitsOf(twoLines, 'per books')).toEqual(['per books']);
    expect(hitsOf(twoLines, 'perbooks')).toEqual([]);
    // Two items on one line with a gap between them: a space.
    const gap = [item('Total', 72, 700), item('due', 120, 700)];
    expect(hitsOf(gap, 'total due')).toEqual(['Total due']);
    // A word drawn in two touching pieces (kerning): one word.
    const pieces = [item('Ba', 72, 700, { width: 10 }), item('nk', 82, 700, { width: 10 })];
    expect(hitsOf(pieces, 'bank')).toEqual(['Bank']);
    expect(hitsOf(pieces, 'ba nk')).toEqual([]);
  });

  it('commas between digits are ignored on both sides, so Indian and international grouping find each other', () => {
    const page = [item('Opening 12,34,567.00 and 1,234,567 and 1234567', 72, 700)];
    expect(hitsOf(page, '1234567')).toEqual(['12,34,567', '1,234,567', '1234567']);
    expect(hitsOf(page, '12,34,567')).toEqual(['12,34,567', '1,234,567', '1234567']);
    expect(hitsOf(page, '1,234,567.00')).toEqual(['12,34,567.00']);
    // A comma in a list is not inside a number: kept.
    expect(hitsOf([item('Notes 1, 2 and 3', 72, 700)], '12')).toEqual([]);
    expect(hitsOf([item('Notes 1, 2 and 3', 72, 700)], '1, 2')).toEqual(['1, 2']);
    // A decimal point is never dropped.
    expect(hitsOf([item('15.00 and 1.500', 72, 700)], '1500')).toEqual([]);
  });

  it('compatibility forms match their plain letters: ligatures, full-width digits, non-breaking spaces', () => {
    expect(hitsOf([item('Re\ufb01nance', 72, 700)], 'refinance')).toEqual(['Re\ufb01nance']);
    expect(hitsOf([item('Ref \uff11\uff12\uff13', 72, 700)], 'ref 123')).toEqual(['Ref \uff11\uff12\uff13']);
  });

  it('Hindi text matches as typed; invisible joiners and soft hyphens do not matter', () => {
    const bank = '\u092c\u0948\u0902\u0915'; // bank
    expect(hitsOf([item(`${bank} \u0935\u093f\u0935\u0930\u0923`, 72, 700)], bank)).toEqual([bank]);
    // KSSA written with and without a zero-width joiner.
    const withJoiner = '\u0915\u094d\u200d\u0937';
    const plain = '\u0915\u094d\u0937';
    expect(hitsOf([item(withJoiner, 72, 700)], plain)).toEqual([withJoiner]);
    expect(hitsOf([item(plain, 72, 700)], withJoiner)).toEqual([plain]);
    expect(hitsOf([item('recon\u00adciliation', 72, 700)], 'reconciliation')).toEqual(['recon\u00adciliation']);
    // A letter with a nukta, composed or written in two parts.
    expect(hitsOf([item('\u0921\u093c', 72, 700)], '\u095c')).toEqual(['\u0921\u093c']);
  });

  it('finds every occurrence without overlap, in order, up to a limit', () => {
    expect(hitsOf([item('aaaa', 72, 700)], 'aa')).toEqual(['aa', 'aa']);
    expect(hitsOf([item('x y x y x y', 72, 700)], 'x', 2)).toEqual(['x', 'x']);
  });

  it('nothing to look for: an empty or blank query finds nothing', () => {
    expect(foldQuery('   \n ')).toBe('');
    expect(hitsOf([item('Cash', 72, 700)], '  ')).toEqual([]);
  });

  it('a page with no letters or digits has no searchable text (a scan, or a blank page)', () => {
    expect(buildSearchPage(3, [], STYLES).hasText).toBe(false);
    expect(buildSearchPage(3, [item('  ', 72, 700, { hasEOL: true }), item('', 72, 690, { hasEOL: true })], STYLES).hasText).toBe(false);
    expect(buildSearchPage(3, [item('Rs. 500', 72, 700)], STYLES).hasText).toBe(true);
  });

  it('folding keeps a map from every folded unit back to the text it came from', () => {
    const f = foldText('A  \ufb01,1,000');
    expect(f.folded).toBe('a fi,1000');
    // The ligature's two letters both point at the ligature.
    expect([f.starts[2], f.ends[2], f.starts[3], f.ends[3]]).toEqual([3, 4, 3, 4]);
    // The space points at the first of the spaces.
    expect([f.starts[1], f.ends[1]]).toEqual([1, 2]);
  });

  it('never runs a regular expression on the page text or the query (the engine would keep both)', () => {
    /sentinel/.exec('a sentinel value');
    const statics = RegExp as unknown as { input: string; lastMatch: string };
    hitsOf([item('Secret ledger text 4,56,789', 72, 700, { hasEOL: true }), item('second line', 72, 686)], 'secret ledger');
    foldQuery('Secret ledger');
    expect([statics.input, statics.lastMatch]).toEqual(['a sentinel value', 'sentinel']);
  });

  it('keeps only items with something to find: spaces and empty line ends become one space in the text', () => {
    // pdf.js gives a column layout as text, " ", text, " ", ..., "" (line end): half the items hold nothing.
    const items = [
      item('01-04-2024', 40, 700),
      item(' ', 90, 700),
      item('Cash at', 150, 700),
      item('', 185, 700, { hasEOL: true }),
      item('Bank', 150, 686),
      item(' ', 170, 686),
      item('1,000.00', 470, 686, { hasEOL: true }),
    ];
    const page = buildSearchPage(0, items, STYLES);
    expect(page.items.map((i) => i.str)).toEqual(['01-04-2024', 'Cash at', 'Bank', '1,000.00']);
    expect(page.text).toBe('01-04-2024 Cash at Bank 1,000.00 ');
    expect(hitsOf(items, 'cash at bank')).toEqual(['Cash at Bank']);
    expect(hitsOf(items, 'bank 1000')).toEqual(['Bank 1,000']);
  });

  it('records where each item starts in the joined text; one space stands for each line end', () => {
    const page = buildSearchPage(0, [item('Cash at', 72, 700, { hasEOL: true }), item('', 72, 690, { hasEOL: true }), item('Bank', 72, 686)], STYLES);
    expect(page.text).toBe('Cash at Bank');
    expect(Array.from(page.itemStarts)).toEqual([0, 8]);
  });
});
