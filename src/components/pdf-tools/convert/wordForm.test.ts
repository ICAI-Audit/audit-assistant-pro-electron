// PDF to Word's words and rules (wordForm.ts): what the dialog and the result say, the record, and the check
// for text made when the dialog opens. Every count here is invented.
import { describe, expect, it } from 'vitest';
import type { WordReport } from '@/lib/pdf-tools/wordBuild';
import {
  blockedReason,
  DESCRIPTION,
  findText,
  NO_TEXT_MESSAGE,
  nonSpaceChars,
  recordOptions,
  RECORD_KEYS,
  resultDescription,
  SIGNED_WARNING,
  summary,
  SUMMARY,
  TOO_MANY_PAGES_MESSAGE,
  WORD_MAX_PAGES,
  wordFileName,
} from './wordForm';

const report = (over: Partial<WordReport> = {}): WordReport => ({ pages: 12, paragraphs: 48, headings: 6, tables: 3, pagesNoText: 0, ...over });

describe('PDF to Word words', () => {
  it('says in plain words what will be made', () => {
    expect(DESCRIPTION).toBe('A Word document that keeps the look of the pages: text, tables and pictures in their places, ready to edit. Fonts Word does not have are replaced by similar ones.');
    expect(NO_TEXT_MESSAGE).toBe('This file has no text to read; it looks scanned. Make it searchable first.');
    expect(SIGNED_WARNING).toBe('This file is signed. The result is a new file; the signed original is unchanged.');
  });

  it('names the result <name>.docx, cleaned', () => {
    expect(wordFileName('Ledger 2025')).toBe('Ledger 2025.docx');
    expect(wordFileName('Ledger.docx')).toBe('Ledger.docx');
    expect(wordFileName('a:b')).toBe('a_b.docx');
    expect(wordFileName('  ')).toBe('document.docx');
  });

  it('describes the result by its counts', () => {
    expect(resultDescription('Ledger.docx', report())).toEqual({ message: 'Made Ledger.docx', detail: '12 pages: 48 paragraphs, 6 headings, 3 tables.', tone: 'success' });
    expect(resultDescription('L.docx', report({ pages: 1, paragraphs: 1, headings: 1, tables: 1 })).detail).toBe('1 page: 1 paragraph, 1 heading, 1 table.');
    expect(resultDescription('L.docx', report({ headings: 0, tables: 0 })).detail).toBe('12 pages: 48 paragraphs.');
    expect(resultDescription('L.docx', report({ paragraphs: 0, headings: 0 })).detail).toBe('12 pages: 3 tables.');
  });

  it('says how many pages have little or no text, as a warning', () => {
    expect(resultDescription('L.docx', report({ pagesNoText: 4 }))).toEqual({
      message: 'Made L.docx',
      detail: '12 pages: 48 paragraphs, 6 headings, 3 tables. 4 pages have little or no text; they may be scanned. Make the file searchable to convert them.',
      tone: 'warning',
    });
    expect(resultDescription('L.docx', report({ pagesNoText: 1 })).detail).toBe(
      '12 pages: 48 paragraphs, 6 headings, 3 tables. 1 page has little or no text; it may be scanned. Make the file searchable to convert it.',
    );
  });

  it('records counts only, under the allowed keys', () => {
    expect(RECORD_KEYS).toEqual(['pages', 'paragraphs', 'headings', 'tables', 'pagesNoText', 'pagesFromScan']);
    const options = recordOptions(report({ pagesNoText: 2 }));
    expect(options).toEqual({ pages: 12, paragraphs: 48, headings: 6, tables: 3, pagesNoText: 2 });
    // Anything else on the report is left out.
    // (The count of scanned pages is in the record only when there is one.)
    expect(Object.keys(recordOptions({ ...report({ pagesFromScan: 1 }), text: 'Sample Traders' } as WordReport))).toEqual([...RECORD_KEYS]);
    expect(Object.keys(recordOptions({ ...report(), text: 'Sample Traders' } as WordReport))).toEqual(RECORD_KEYS.filter((key) => key !== 'pagesFromScan'));
    expect(SUMMARY).toBe('Converted to Word');
    expect(summary(report())).toBe('Converted to Word: 12 pages');
    expect(summary(report({ pages: 1 }))).toBe('Converted to Word: 1 page');
  });
});

describe('why Run waits', () => {
  it('blocks a file with no text, and one over the page limit', () => {
    expect(blockedReason({ pageCount: 3 }, 'none')).toBe(NO_TEXT_MESSAGE);
    expect(blockedReason({ pageCount: 3 }, 'some')).toBeNull();
    expect(blockedReason({ pageCount: 3 }, 'checking')).toBeNull();
    expect(blockedReason({ pageCount: 3 }, 'unknown')).toBeNull();
    expect(WORD_MAX_PAGES).toBe(1000);
    expect(blockedReason({ pageCount: 1001 }, 'some')).toBe(TOO_MANY_PAGES_MESSAGE);
    expect(blockedReason({ pageCount: 1000 }, 'some')).toBeNull();
    expect(TOO_MANY_PAGES_MESSAGE).toBe('This file has more than 1,000 pages, too many to turn into a Word document. Split it into parts first.');
  });
});

describe('the check for text when the dialog opens', () => {
  it('counts the characters that are not spaces', () => {
    expect(nonSpaceChars([{ str: 'Ab c' }, { str: ' \n' }, { str: 'लेखा' }])).toBe(3 + 4);
  });

  it('stops at the first page with text (20 characters or more)', async () => {
    const asked: number[] = [];
    const chars = [0, 19, 20, 500];
    const found = await findText(4, async (i) => (asked.push(i), chars[i]));
    expect(found).toBe('some');
    expect(asked).toEqual([0, 1, 2]);
  });

  it('says none when no page has 20 characters', async () => {
    expect(await findText(3, async () => 5)).toBe('none');
    expect(await findText(0, async () => 0)).toBe('none');
  });

  it('gives up quietly when a page cannot be read, or when stopped', async () => {
    expect(await findText(3, async () => Promise.reject(new Error('damaged')))).toBe('unknown');
    const controller = new AbortController();
    controller.abort();
    expect(await findText(3, async () => 0, { signal: controller.signal })).toBe('unknown');
  });
});
