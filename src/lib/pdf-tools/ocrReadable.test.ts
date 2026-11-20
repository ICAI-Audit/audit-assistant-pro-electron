// Make searchable: which recognised words go into the searchable text (T-064, OCR part C). The engine reads English
// only; print in another script, handwriting, stamps and logos come back as nonsense words it has little
// confidence in. Those are left out, by the engine's own confidence and nothing else: no word list, no rule for a
// kind of document. Invented words only.
import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE } from './ocrQuality';
import { readableWords, UNREADABLE_LINE_SHARE, UNSURE_CONFIDENCE } from './ocrReadable';
import type { RecognisedPage, RecognisedWord } from './ocrTypes';

let x = 0;
/** A word on line `line` (none: the engine gave no line) with the given confidence. */
const word = (text: string, confidence: number, line?: number): RecognisedWord => {
  x += 100;
  return { text, confidence, x0: x, y0: 10, x1: x + 80, y1: 40, ...(line === undefined ? {} : { line: { y0: 10, y1: 40, baseline: 34, index: line } }) };
};
const page = (words: RecognisedWord[]): RecognisedPage => ({ words, angle: 0, widthPx: 2480, heightPx: 3508, seconds: 1 });
const kept = (words: RecognisedWord[]) => readableWords(page(words)).page.words.map((w) => w.text);

describe('readableWords', () => {
  it('leaves out a word the engine gives less than an even chance, and keeps a doubtful word in a line it could read', () => {
    expect(UNSURE_CONFIDENCE).toBe(50);
    const words = [word('Halvick', 96, 0), word('Castings', 49.9, 0), word('ledger', 50, 0), word('1,23,456.78', 62, 0), word('balance', 93, 0)];
    const result = readableWords(page(words));
    expect(result.page.words.map((w) => w.text)).toEqual(['Halvick', 'ledger', '1,23,456.78', 'balance']);
    expect(result.leftOut).toBe(1);
    // The kept words are the same objects, in the engine's order; the page's other figures are untouched.
    expect(result.page.words[0]).toBe(words[0]);
    expect(result.page).toMatchObject({ angle: 0, widthPx: 2480, heightPx: 3508, seconds: 1 });
  });

  it('in a line where half the words or more are below 50, also leaves out the words below 80', () => {
    expect(UNREADABLE_LINE_SHARE).toBe(0.5);
    expect(LOW_CONFIDENCE).toBe(80);
    // Line 0: 2 of 4 below 50, so the 62 goes too; the 80 and the 91 stay. Line 1: 1 of 3 below 50, so its 62 stays.
    const words = [word('zqk', 12, 0), word('vuh', 31, 0), word('Plo', 62, 0), word('TQ', 80, 0), word('Zentharo', 91, 1), word('Forgings', 62, 1), word('xv', 20, 1), word('2,950.00', 91, 2)];
    expect(kept(words)).toEqual(['TQ', 'Zentharo', 'Forgings', '2,950.00']);
    expect(readableWords(page(words)).leftOut).toBe(4);
  });

  it('judges a word without a line by itself', () => {
    expect(kept([word('jjat', 30), word('Plo', 62), word('Nirvexa', 95), word('ubd', 10)])).toEqual(['Plo', 'Nirvexa']);
  });

  it('passes ruling-line marks and empty words through uncounted: the text layer leaves those out itself', () => {
    const words = [word('|', 5, 0), word('Opening', 95, 0), word('____', 0, 0), word(' ', 0, 0), word('Closing', 92, 0)];
    const result = readableWords(page(words));
    expect(result.page.words.map((w) => w.text)).toEqual(['|', 'Opening', '____', ' ', 'Closing']);
    expect(result.leftOut).toBe(0);
  });

  it('counts as left out only what holds a letter or a digit: a speck read as a comma is dropped unsaid', () => {
    const result = readableWords(page([word(',', 3, 0), word('’', 20, 0), word('Ledger', 95, 0), word('Traders', 95, 0), word('Private', 95, 0), word('xq', 20, 0)]));
    expect(result.page.words.map((w) => w.text)).toEqual(['Ledger', 'Traders', 'Private']);
    expect(result.leftOut).toBe(1);
  });

  it('does not let specks decide whether a line could be read', () => {
    // Two specks and two words: the line is judged on its words, so the doubtful one stays.
    expect(kept([word('Plo', 62, 0), word(',', 5, 0), word('.', 8, 0), word('Ledger', 95, 0)])).toEqual(['Plo', 'Ledger']);
  });

  it('keeps a doubtful number in a line it could read: the user is told to check it, it is not dropped', () => {
    // On office scans half of the numbers the engine gave less than 50 were right (OCR-C-report.md).
    const words = [word('Opening', 95, 0), word('balance', 93, 0), word('carried', 94, 0), word('8,11,53,122.79', 31, 0), word('Dr', 20, 0), word('NX/2291', 12, 1), word('dated', 90, 1), word('14-08-2025', 88, 1)];
    expect(kept(words)).toEqual(['Opening', 'balance', 'carried', '8,11,53,122.79', 'NX/2291', 'dated', '14-08-2025']);
    expect(readableWords(page(words)).leftOut).toBe(1);
    // In a line the engine could not read, a number needs an even chance and a word needs 80: a reference number
    // printed beside another script stays, digits inside nonsense go.
    expect(kept([word('zqk', 12, 2), word('47', 44, 2), word('vuh', 31, 2), word('Plo', 62, 2), word('Ref:NX/2291', 59, 2), word('4,18,725.50', 91, 2)])).toEqual(['Ref:NX/2291', '4,18,725.50']);
    expect(kept([word('ubd', 41, 3), word('Ref:880012', 50, 3)])).toEqual(['Ref:880012']);
    expect(kept([word('ubd', 41, 3), word('Ref:880012', 49, 3)])).toEqual([]);
    // Without a line a number is kept.
    expect(kept([word('4,500.00', 20), word('ubd', 20)])).toEqual(['4,500.00']);
  });

  it('treats a confidence that is not a number as no confidence', () => {
    expect(kept([word('Ledger', Number.NaN, 0), word('Traders', 95, 0), word('Private', 95, 0)])).toEqual(['Traders', 'Private']);
  });

  it('keeps every word of a page the engine read well, and none of a page it could not read', () => {
    const good = Array.from({ length: 40 }, (_, i) => word(`word${i}`, 88 + (i % 9), Math.floor(i / 8)));
    expect(readableWords(page(good))).toEqual({ page: page(good), leftOut: 0 });
    const bad = Array.from({ length: 12 }, (_, i) => word(`q${i}`, 10 + i * 3, Math.floor(i / 6)));
    expect(readableWords(page(bad))).toEqual({ page: page([]), leftOut: 12 });
  });
});
