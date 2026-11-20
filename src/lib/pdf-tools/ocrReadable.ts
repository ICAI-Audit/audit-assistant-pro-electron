// Make searchable (T-064, OCR part C): which recognised words go into the searchable text.
//
// The engine reads English only. Whatever else is on a page (print in another script, handwriting, a stamp, a
// logo, a signature, specks) it still turns into Latin "words", and says so itself: it has little confidence in
// them. On a real two-language scan half of all words in the layer were such nonsense; a search or a copy then
// gives rubbish between the real lines. So the words the engine could not read are left out, by its own
// confidence and nothing else. There is no word list and no rule for a kind of document.
//
// - A word below UNSURE_CONFIDENCE (50: the engine gives it less than an even chance) is left out.
// - In a line where half the words or more are below 50, the engine could not read the line: its words below
//   LOW_CONFIDENCE (80) are left out as well. A confident word in such a line (a name in Latin letters inside a
//   line of another script) stays.
// - A number (a word that holds a digit) is trusted one step further, because a number silently missing is
//   worse for the user than a number he is told to check: in a line the engine could read it always stays, in a
//   line it could not read it stays from 50. Doubtful numbers that stay are counted as numbers to check
//   (ocrQuality.ts). On office scans half of the numbers below 50 were right; on a real two-language scan the
//   reference number and a date printed beside the other script had 59 and 68.
// - A line is judged on its words that hold a letter or a digit: specks read as commas do not decide.
// - Ruling-line marks and empty words are passed through untouched: the text layer and the figures leave those
//   out themselves.
// - `leftOut` counts the words left out that hold a letter or a digit. A speck read as a comma is dropped unsaid.
//
// Measured on 38 pages with exact truth (OCR-C-report.md): on a real two-language scan 375 wrong words and 4 right
// ones were left out (of 398 right ones); on 10 clean pages 45 wrong and 14 right (of 3,300); on 10 office scans
// at 200 dpi 245 wrong and 32 right (of 3,220). A plain cut at 50 without the line rule left twice as many wrong
// words in on the two-language pages.
//
// The figures the user is given are made after this (ocrQuality.ts): "numbers to check" are doubtful numbers that
// stayed in, and a page of which a tenth or more was left out is named as partly read.
import { LOW_CONFIDENCE } from './ocrQuality';
import { isRulingMark, type RecognisedPage, type RecognisedWord } from './ocrTypes';

/** Below this the engine gives a word less than an even chance. */
export const UNSURE_CONFIDENCE = 50;
/** A line is unreadable when this share of its words, or more, is below UNSURE_CONFIDENCE. */
export const UNREADABLE_LINE_SHARE = 0.5;

export interface Readable {
  /** The page with the unreadable words taken out; the other words are the same objects, in the same order. */
  page: RecognisedPage;
  /** Words left out that hold a letter or a digit. */
  leftOut: number;
}

/** Not an empty word and not a ruling-line mark: those are passed through. */
const judged = (word: RecognisedWord): boolean => {
  const text = typeof word.text === 'string' ? word.text.trim() : '';
  return text !== '' && !isRulingMark(text);
};
const holdsLetterOrDigit = (word: RecognisedWord): boolean => /[\p{L}\p{N}]/u.test(word.text);
const holdsDigit = (word: RecognisedWord): boolean => /\d/.test(word.text);
/** A confidence that is not a number is no confidence. */
const sure = (word: RecognisedWord, level: number): boolean => word.confidence >= level;

export function readableWords(page: RecognisedPage): Readable {
  // Each line's count of words (those holding a letter or a digit), and of those below even odds.
  const lines = new Map<number, { words: number; unsure: number }>();
  for (const word of page.words) {
    const index = word.line?.index;
    if (index === undefined || !judged(word) || !holdsLetterOrDigit(word)) continue;
    const line = lines.get(index) ?? { words: 0, unsure: 0 };
    line.words += 1;
    if (!sure(word, UNSURE_CONFIDENCE)) line.unsure += 1;
    lines.set(index, line);
  }
  let leftOut = 0;
  const words = page.words.filter((word) => {
    if (!judged(word)) return true;
    const line = word.line?.index === undefined ? undefined : lines.get(word.line.index);
    const unreadableLine = !!line && line.unsure >= UNREADABLE_LINE_SHARE * line.words;
    const number = holdsDigit(word);
    const keep = unreadableLine ? sure(word, number ? UNSURE_CONFIDENCE : LOW_CONFIDENCE) : number || sure(word, UNSURE_CONFIDENCE);
    if (!keep && holdsLetterOrDigit(word)) leftOut += 1;
    return keep;
  });
  return { page: { ...page, words }, leftOut };
}
