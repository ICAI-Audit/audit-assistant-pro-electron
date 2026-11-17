import { describe, expect, it } from 'vitest';
import { addPageNumbers, defaultPageNumberOptions } from '@/lib/pdf-tools/pageNumbers';
import { makePdf } from '@/lib/pdf-tools/testPdf';
import { addWatermark, watermarkError, WATERMARK_DEFAULTS, type WatermarkOptions } from '@/lib/pdf-tools/watermark';
import {
  charactersError,
  HEADER_TOKEN_HELP,
  insertToken,
  loadCharacterCheck,
  MARK_TOKEN_HELP,
  markTextError,
  markTokenError,
  pagesInWords,
  usesToken,
} from './markText';

const tokens = { date: '14-11-2026', client: 'ABC Ltd' };

async function libraryMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the library accepted it');
}

const watermarkOptions = (text: string, client = tokens.client): WatermarkOptions => ({
  watermark: { ...WATERMARK_DEFAULTS.watermark, placement: { ...WATERMARK_DEFAULTS.watermark.placement }, text },
  pages: { from: 1, to: 1 },
  tokens: { date: tokens.date, client },
});

describe('characters the built-in fonts cannot write', () => {
  it('names the rupee sign, Hindi and an emoji in the words the library uses for the watermark', async () => {
    const check = await loadCharacterCheck();
    const pdf = await makePdf('A', 1);
    for (const text of ['Rs ₹500', 'मसौदा', 'DRAFT 😀']) {
      const ours = charactersError(check, text, 'watermark text');
      expect(ours).not.toBeNull();
      expect(ours).toBe(await libraryMessage(() => addWatermark(pdf, watermarkOptions(text))));
    }
    expect(charactersError(check, 'Rs ₹500', 'watermark text')).toContain('“₹500” cannot be printed in the watermark text; use English letters, digits and common signs (write Rs. for ₹).');
    // Hindi is shown as typed, never as code points (QA-FIX H).
    expect(charactersError(check, 'मौसम DRAFT', 'watermark text')).toBe('“मौसम” cannot be printed in the watermark text; use English letters, digits and common signs (write Rs. for ₹).');
    // A hang guard only (the font's first loading took 5.8 s of the default 5 s on a loaded machine, INT3).
  }, 60_000);

  it('says the same as Page numbers for a header or footer line', async () => {
    const check = await loadCharacterCheck();
    const pdf = await makePdf('A', 1);
    const ours = charactersError(check, 'Fees ₹', 'header or footer text');
    const theirs = await libraryMessage(() => addPageNumbers(pdf, { ...defaultPageNumberOptions(1), texts: { 'top-left': 'Fees ₹' } }));
    expect(ours).toBe(theirs);
  });

  it('accepts Latin letters, digits, common punctuation and accented Latin letters', async () => {
    const check = await loadCharacterCheck();
    expect(charactersError(check, 'DRAFT – Café, 31/03/2026 (copy) & “quoted”', 'watermark text')).toBeNull();
    expect(check('A₹B₹')).toEqual(['₹']);
  });

  it('checks nothing until the character list has loaded', () => {
    expect(charactersError(null, '₹', 'watermark text')).toBeNull();
  });
});

describe('tokens in a watermark or stamp', () => {
  it('accepts {date} and {client} in any letter case and names any other brace token, as the library does', () => {
    expect(markTokenError('PAID {date} {CLIENT}', 'stamp')).toBeNull();
    for (const [text, what] of [['PAID {page}', 'stamp'], ['COPY {pge}', 'watermark'], ['A {} B', 'stamp']] as const) {
      const ours = markTokenError(text, what);
      expect(ours).not.toBeNull();
      const opts: WatermarkOptions = what === 'stamp'
        ? { stamp: { ...WATERMARK_DEFAULTS.stamp, placement: { ...WATERMARK_DEFAULTS.stamp.placement }, text }, pages: { from: 1, to: 1 }, tokens }
        : watermarkOptions(text);
      expect(ours).toBe(watermarkError(opts, 1));
    }
    expect(markTokenError('PAID {page}', 'stamp')).toBe('The stamp text has {page}, which is not a known name. Use {date} or {client}.');
  });

  it('treats a brace that does not close as plain text', () => {
    expect(markTokenError('NOTE {draft', 'watermark')).toBeNull();
  });

  it('knows which token a text uses', () => {
    expect(usesToken('Paid {DATE}', 'date')).toBe(true);
    expect(usesToken('Paid date', 'date')).toBe(false);
  });
});

describe('markTextError', () => {
  it('asks for 1 to 60 characters first, in the library words', () => {
    expect(markTextError('   ', 'watermark', null, tokens)).toBe(watermarkError(watermarkOptions('   '), 1));
    expect(markTextError('x'.repeat(61), 'stamp', null, tokens)).toBe('Enter stamp text of 1 to 60 characters.');
    expect(markTextError('x'.repeat(60), 'stamp', null, tokens)).toBeNull();
  });

  it('refuses a character brought in by {client} with the library words, before the run', async () => {
    const check = await loadCharacterCheck();
    const client = 'Shree ₹ Traders';
    const ours = markTextError('FOR {client}', 'watermark', check, { ...tokens, client });
    const theirs = await libraryMessage(async () => addWatermark(await makePdf('A', 1), watermarkOptions('FOR {client}', client)));
    expect(ours).toBe(theirs);
  });

  it('refuses a text that would print as nothing: {client} alone when the engagement has no client name (REV-B minor 9)', () => {
    const none = { ...tokens, client: '' };
    expect(markTextError('{client}', 'watermark', null, none)).toBe('This engagement has no client name, so the watermark would be empty. Type the text instead.');
    expect(markTextError(' {CLIENT} ', 'stamp', null, none)).toBe('This engagement has no client name, so the stamp would be empty. Type the text instead.');
    expect(markTextError('FOR {client}', 'watermark', null, none)).toBeNull();
    expect(markTextError('{client}', 'watermark', null, tokens)).toBeNull();
  });

  it('accepts ordinary text with tokens', async () => {
    const check = await loadCharacterCheck();
    expect(markTextError('CHECKED {date}', 'stamp', check, tokens)).toBeNull();
  });
});

describe('insertToken', () => {
  it('puts the token at the caret, or over the selection, and leaves the caret after it', () => {
    expect(insertToken('PAID ', 5, 5, '{date}')).toEqual({ value: 'PAID {date}', caret: 11 });
    expect(insertToken('PAID on X', 8, 9, '{date}')).toEqual({ value: 'PAID on {date}', caret: 14 });
    expect(insertToken('', null, null, '{client}')).toEqual({ value: '{client}', caret: 8 });
  });

  it('adds a space between a word and the token', () => {
    expect(insertToken('WP', 2, 2, '{page}')).toEqual({ value: 'WP {page}', caret: 9 });
  });
});

describe('help and page lists', () => {
  it('lists the tokens each kind of text may use', () => {
    expect(MARK_TOKEN_HELP.map((t) => t.token)).toEqual(['{date}', '{client}']);
    expect(HEADER_TOKEN_HELP.map((t) => t.token)).toEqual(['{page}', '{pages}', '{file}', '{name}', '{date}', '{client}', '{fy}']);
  });

  it('writes pages as a reader would, and shortens a long list', () => {
    expect(pagesInWords([3])).toBe('page 3');
    expect(pagesInWords([1, 2, 3, 8])).toBe('pages 1-3, 8');
    expect(pagesInWords([8, 1, 2, 3, 3])).toBe('pages 1-3, 8');
    const many = Array.from({ length: 40 }, (_, i) => 2 * i + 1);
    expect(pagesInWords(many)).toBe('pages 1, 3, 5, 7, 9, 11, 13, 15 and 32 more');
  });
});
