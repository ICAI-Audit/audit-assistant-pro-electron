// Compare's words and record (compareForm.ts; contract T-064 decisions 3, 4, 15 and 17): what the dialog and
// the run say, which file is the earlier version, and the record (the comparison's counts only).
import { describe, expect, it } from 'vitest';
import type { Comparison } from '@/lib/pdf-tools/compareText';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import {
  blockedReason,
  differLine,
  NO_DIFFERENCES,
  noDifferencesDescription,
  RECORD_KEYS,
  recordOptions,
  resultDescription,
  scannedMessage,
  signedWarning,
  summary,
  SUMMARY,
  versions,
} from './compareForm';

const comparison = (over: Partial<Comparison> = {}): Comparison => ({
  pagesEarlier: 42,
  pagesLater: 42,
  pairs: Array.from({ length: 42 }, (_, i) => ({ earlier: i, later: i, changes: i < 7 ? [{ kind: 'added' as const, text: 'Secretword' }] : [], added: i < 7 ? 1 : 0, removed: 0, changed: 0, coarse: false })),
  pagesDiffer: 7,
  pagesOnlyEarlier: 0,
  pagesOnlyLater: 0,
  wordsAdded: 7,
  wordsRemoved: 0,
  wordsChanged: 0,
  pagesWithoutText: 0,
  pagesComparedCoarsely: 0,
  ...over,
});

let seq = 0;
const file = (name: string, extra: Partial<WorkingFile> = {}): WorkingFile => ({
  id: `f-${++seq}`,
  name,
  kind: 'pdf',
  mimeType: 'application/pdf',
  origin: 'computer',
  bytes: new Uint8Array(1),
  size: 1,
  pageCount: 12,
  wasProtected: false,
  hasRestrictions: false,
  hasSignature: false,
  sentTo: [],
  ...extra,
});

describe('the message and the record', () => {
  it('groups the digits of large counts as the other tools do (1,000, not 1000)', () => {
    const large = comparison({ pagesEarlier: 1000, pagesLater: 1000, pagesDiffer: 1000, pagesOnlyEarlier: 0, pagesOnlyLater: 0 });
    expect(differLine(large)).toBe('1,000 of 1,000 pages differ.');
    expect(summary(large)).toBe('Compared 2 files: 1,000 of 1,000 pages differ');
    const uneven = comparison({ pagesLater: 1200, pagesDiffer: 0, pagesOnlyEarlier: 1100, pagesOnlyLater: 1200, pagesWithoutText: 2300, pagesComparedCoarsely: 1500 });
    expect(differLine(uneven)).toBe('No page that is in both versions differs. 1,100 pages are only in the earlier version; 1,200 pages are only in the later version.');
    expect(summary(uneven)).toBe('Compared 2 files: 0 of 1,200 pages differ; 1,100 pages only in the earlier version, 1,200 pages only in the later version');
    const said = resultDescription(comparison({ pagesLater: 1000, pagesDiffer: 1000, pagesOnlyEarlier: 400, pagesWithoutText: 2300, pagesComparedCoarsely: 1500 }), { wordsNotShown: 123456 }, 'r.pdf').detail ?? '';
    expect(said).toContain('counts the other 1,200.');
    expect(said).toContain('1,500 very long pages were compared in larger pieces');
    expect(said).toContain('2,300 pages have no text to compare');
    expect(said).toContain('1,23,456 words in another script');
    expect(said).not.toMatch(/\d{4}/);
  });

  it('says how many pages in both versions differ, out of the later version pages: "7 of 42 pages differ."', () => {
    expect(differLine(comparison())).toBe('7 of 42 pages differ.');
    expect(differLine(comparison({ pagesDiffer: 1 }))).toBe('1 of 42 pages differs.');
    // Round 2 ruling: 12 against 13 pages, two changed and one inserted: "2 of 13 pages differ.", the inserted page said apart.
    const mixed = comparison({ pagesEarlier: 12, pagesLater: 13, pagesDiffer: 2, pagesOnlyLater: 1 });
    expect(differLine(mixed)).toBe('2 of 13 pages differ.');
    expect(resultDescription(mixed, { wordsNotShown: 0 }, 'R.pdf')).toEqual({
      message: '2 of 13 pages differ.',
      detail: '1 page is only in the later version. The report R.pdf lists each change with the words around it.',
      tone: 'success',
    });
  });

  it('no page in both versions differs, but pages are in one version only: a report, led by the only-in sentence', () => {
    const inserted = comparison({ pagesLater: 43, pagesDiffer: 0, pagesOnlyLater: 1 });
    expect(differLine(inserted)).toBe('No page that is in both versions differs. 1 page is only in the later version.');
    expect(resultDescription(inserted, { wordsNotShown: 0 }, 'R.pdf')).toEqual({
      message: 'No page that is in both versions differs. 1 page is only in the later version.',
      detail: 'The report R.pdf lists each change with the words around it.',
      tone: 'success',
    });
    expect(summary(inserted)).toBe('Compared 2 files: 0 of 43 pages differ; 1 page only in the later version');
  });

  it('the record summary is "Compared 2 files: 7 of 42 pages differ", with the pages in one version only after it', () => {
    expect(SUMMARY).toBe('Compared 2 files');
    expect(summary(comparison())).toBe('Compared 2 files: 7 of 42 pages differ');
    expect(summary(comparison({ pagesLater: 43, pagesOnlyEarlier: 2, pagesOnlyLater: 3 }))).toBe(
      'Compared 2 files: 7 of 43 pages differ; 2 pages only in the earlier version, 3 pages only in the later version',
    );
  });

  it('RECORD_KEYS are the counts of the comparison, and the options hold only them, as numbers', () => {
    const c = comparison({ pagesComparedCoarsely: 1, pagesWithoutText: 2 });
    const countKeys = Object.keys(c).filter((k) => k !== 'pairs');
    expect([...RECORD_KEYS].sort()).toEqual(countKeys.sort());
    const options = recordOptions(c);
    expect(Object.keys(options).sort()).toEqual([...RECORD_KEYS].sort());
    for (const value of Object.values(options)) expect(typeof value).toBe('number');
    expect(JSON.stringify(options)).not.toContain('Secretword');
    expect(options).toMatchObject({ pagesDiffer: 7, pagesComparedCoarsely: 1, pagesWithoutText: 2 });
  });

  it('the result message names the report and says what to keep in mind', () => {
    const plain = resultDescription(comparison(), { wordsNotShown: 0 }, 'Signed_changes.pdf');
    expect(plain).toEqual({ message: '7 of 42 pages differ.', detail: 'The report Signed_changes.pdf lists each change with the words around it.', tone: 'success' });
    const full = resultDescription(
      comparison({ pagesOnlyEarlier: 1, pagesOnlyLater: 2, pagesComparedCoarsely: 1, pagesWithoutText: 3, pagesLater: 244, pairs: Array.from({ length: 245 }, () => comparison().pairs[0]), pagesDiffer: 230 }),
      { wordsNotShown: 4 },
      'R.pdf',
    );
    expect(full.message).toBe('230 of 244 pages differ.');
    expect(full.detail).toBe(
      [
        '1 page is only in the earlier version; 2 pages are only in the later version.',
        'The report R.pdf lists each change with the words around it.',
        'It details the first 200 pages that differ and counts the other 33.',
        '1 very long page was compared in larger pieces, so some changes there are shown as whole passages.',
        '3 pages have no text to compare; they may be scanned.',
        '4 words in another script could not be printed and are shown as [word in another script].',
      ].join(' '),
    );
  });

  it('identical text: no result, and "No text differences found."', () => {
    expect(NO_DIFFERENCES).toBe('No text differences found.');
    expect(noDifferencesDescription().message).toBe('No text differences found.');
  });

  it('a file with no text must be made searchable first', () => {
    expect(scannedMessage('Scan.pdf')).toBe('Scan.pdf has no text to read; it looks scanned. Make it searchable first. Nothing was added.');
  });
});

describe('the dialog', () => {
  it('the earlier version is the first in the list unless swapped', () => {
    const a = file('Draft.pdf');
    const b = file('Signed.pdf');
    expect(versions([a, b], a.id)).toEqual({ earlier: a, later: b });
    expect(versions([a, b], b.id)).toEqual({ earlier: b, later: a });
    expect(versions([a, b], 'nobody')).toBeNull();
    expect(versions([a], a.id)).toBeNull();
  });

  it('says why Compare cannot run', () => {
    expect(blockedReason([file('A.pdf'), file('B.pdf')])).toBeNull();
    expect(blockedReason([file('A.pdf')])).toBe('Select exactly two PDFs to compare.');
    expect(blockedReason([file('A.pdf'), file('B.png', { kind: 'image', mimeType: 'image/png', pageCount: null })])).toBe('Select exactly two PDFs to compare.');
    expect(blockedReason([file('A.pdf'), file('Big.pdf', { pageCount: 1001 })])).toBe('Big.pdf has more than 1,000 pages. Compare takes files of up to 1,000 pages: split it first.');
  });

  it('warns about a signed file in its own words (decision 15), and is silent otherwise', () => {
    expect(signedWarning([file('A.pdf'), file('B.pdf')])).toBeUndefined();
    expect(signedWarning([file('A.pdf'), file('Signed.pdf', { hasSignature: true })])).toBe('Signed.pdf is signed. The report is a new file; the signed original is unchanged.');
    expect(signedWarning([file('A.pdf', { hasSignature: true }), file('B.pdf', { hasSignature: true })])).toBe('Both files are signed. The report is a new file; the signed originals are unchanged.');
  });
});
