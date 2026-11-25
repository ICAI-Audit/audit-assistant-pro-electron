import { describe, expect, it } from 'vitest';
import { defaultResultName, FLAG_NOTES, operationSummary, summaryWithNotes } from './resultNames';

describe('defaultResultName', () => {
  it('follows the names of spec section 5', () => {
    expect(defaultResultName('merge', 'Bank.pdf')).toBe('Bank_merged.pdf');
    expect(defaultResultName('split', 'Bank.pdf', { from: 3, to: 7 })).toBe('Bank_pages_3-7.pdf');
    expect(defaultResultName('split', 'Bank.pdf')).toBe('Bank_selected_pages.pdf');
    expect(defaultResultName('delete-pages', 'Bank.pdf')).toBe('Bank_pages_removed.pdf');
    expect(defaultResultName('compress', 'Bank.pdf')).toBe('Bank_compressed.pdf');
    expect(defaultResultName('page-numbers', 'Bank.pdf')).toBe('Bank_numbered.pdf');
    expect(defaultResultName('images-to-pdf', 'Scan 1.jpg')).toBe('Scan 1.pdf');
  });

  it('removes the extension whatever its case', () => {
    expect(defaultResultName('merge', 'Bank.PDF')).toBe('Bank_merged.pdf');
  });

  it('gives PDF to images the stem its page images are named from', () => {
    expect(defaultResultName('pdf-to-images', 'Bank.pdf')).toBe('Bank');
  });

  it('keeps the name usable when the source name is long or awkward', () => {
    const long = `${'x'.repeat(200)}.pdf`;
    const name = defaultResultName('compress', long);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('_compressed.pdf')).toBe(true);
    expect(defaultResultName('merge', 'a:b?.pdf')).toBe('a_b__merged.pdf');
  });

  it('keeps the end of a long name: the middle is cut, not the end (QA-FIX G, user QA 4.12)', () => {
    const source = 'Synthetic M-s Gamma Traders Private Limited - Tax Audit Report u-s 44AB - Form 3CA 3CD with Annexures for AY 2025-26 - final copy v3 revised.pdf';
    const name = defaultResultName('split', source, { from: 1, to: 2 });
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.startsWith('Synthetic M-s Gamma Traders Private Limited')).toBe(true);
    expect(name.endsWith('AY 2025-26 - final copy v3 revised_pages_1-2.pdf')).toBe(true);
  });
});

describe('defaultResultName for the phase 2 tools', () => {
  const cases: [string, Parameters<typeof defaultResultName>[0], string, Parameters<typeof defaultResultName>[2]][] = [
    ['redact', 'redact', '_redacted', undefined],
    ['bookmarks', 'bookmarks', '_bookmarked', undefined],
    ['organise-pages', 'organise-pages', '_organised', undefined],
    ['watermark', 'watermark', '_watermarked', undefined],
    ['stamp only', 'watermark', '_stamped', { stampOnly: true }],
    ['protect', 'protect', '_protected', undefined],
    ['header and footer', 'page-numbers', '_header_footer', { headerFooter: true }],
    ['resize', 'resize-crop', '_resized', undefined],
    ['crop', 'resize-crop', '_cropped', { pageBoxMode: 'trim' }],
    ['margins', 'resize-crop', '_with_margins', { pageBoxMode: 'margin' }],
  ];

  it.each(cases)('names %s results from a normal stem', (_label, tool, suffix, detail) => {
    expect(defaultResultName(tool, 'Bank.pdf', detail)).toBe(`Bank${suffix}.pdf`);
  });

  it.each(cases)('keeps the suffix of %s results within 120 characters for a 200-character stem', (_label, tool, suffix, detail) => {
    const name = defaultResultName(tool, `${'x'.repeat(200)}.pdf`, detail);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(`${suffix}.pdf`)).toBe(true);
  });

  it.each(cases)('falls back to "document" for %s results from an empty stem', (_label, tool, suffix, detail) => {
    expect(defaultResultName(tool, '', detail)).toBe(`document${suffix}.pdf`);
  });

  it('keeps page numbers named _numbered unless header or footer text is used', () => {
    expect(defaultResultName('page-numbers', 'Bank.pdf', { headerFooter: false })).toBe('Bank_numbered.pdf');
  });
});

describe('operationSummary for the phase 2 tools', () => {
  it('reads like the design records', () => {
    expect(operationSummary('redact', { areas: 14, pages: 3 })).toBe('Redacted 14 areas on 3 pages');
    expect(operationSummary('redact', { areas: 1, pages: 1 })).toBe('Redacted 1 area on 1 page');
    expect(operationSummary('bookmarks', { bookmarks: 2 })).toBe('Bookmarks edited: 2 bookmarks');
    expect(operationSummary('organise-pages', { turned: 2, removed: 1 })).toBe('Organised pages: 2 rotated, 1 removed');
    expect(operationSummary('organise-pages', { moved: 3, turned: 2, removed: 1 })).toBe('Organised pages: 3 moved, 2 rotated, 1 removed');
    expect(operationSummary('organise-pages', {})).toBe('Organised pages');
    expect(operationSummary('watermark', {})).toBe('Added watermark');
    expect(operationSummary('protect', {})).toBe('Protected with a password (AES-256)');
    expect(operationSummary('page-numbers', { headerFooter: 'with' })).toBe('Added page numbers, header and footer');
    expect(operationSummary('page-numbers', { headerFooter: 'only' })).toBe('Added header and footer');
  });

  it('has a note for every flag, in the order the summary adds them (design section 6)', () => {
    expect(FLAG_NOTES).toEqual([
      ['formFieldsDropped', 'form fields not carried'],
      ['bookmarksDropped', 'some bookmarks not carried'],
      ['signatureInvalid', 'signature no longer valid'],
      ['sharedResourcesKept', 'may still contain images or fonts of left-out pages'],
      ['redactedValuesLeftVisible', 'some chosen values left visible'],
      ['textLayerIncomplete', 'some text on redacted pages is not searchable'],
      ['markMayBeMisplaced', 'a mark may be misplaced'],
      ['protectionRemoved', 'protection removed'],
      ['oldBookmarksKept', 'some old bookmark titles may remain in the file'],
    ]);
    expect(summaryWithNotes('Merged 3 files', { protectionRemoved: true })).toBe('Merged 3 files; protection removed');
    expect(summaryWithNotes('Bookmarks edited: 1 bookmark', { oldBookmarksKept: true })).toBe('Bookmarks edited: 1 bookmark; some old bookmark titles may remain in the file');
    expect(summaryWithNotes('Deleted page 2', { bookmarksDropped: true, signatureInvalid: true })).toBe('Deleted page 2; some bookmarks not carried; signature no longer valid');
    expect(summaryWithNotes('Added page numbers', { markMayBeMisplaced: true })).toBe('Added page numbers; a mark may be misplaced');
    expect(summaryWithNotes('Redacted 3 areas on 1 page', { redactedValuesLeftVisible: true, textLayerIncomplete: true })).toBe(
      'Redacted 3 areas on 1 page; some chosen values left visible; some text on redacted pages is not searchable',
    );
  });

  it('says the redacted text layer note', () => {
    expect(summaryWithNotes('Redacted 2 areas on 1 page', { textLayerIncomplete: true })).toBe(
      'Redacted 2 areas on 1 page; some text on redacted pages is not searchable',
    );
  });
});

describe('operationSummary', () => {
  it('reads like the activity record examples', () => {
    expect(operationSummary('merge', { files: 3 })).toBe('Merged 3 files');
    expect(operationSummary('split', { from: 3, to: 7 })).toBe('Split pages 3-7');
    expect(operationSummary('split', { every: 2, part: 1, parts: 3 })).toBe('Split every 2 pages (part 1 of 3)');
    expect(operationSummary('split', { pages: '1-5, 8' })).toBe('Extracted pages 1-5, 8');
    expect(operationSummary('delete-pages', { pages: '2, 4' })).toBe('Deleted pages 2, 4');
    expect(operationSummary('compress', { level: 'recommended', saved: 42 })).toBe('Compressed, Balanced (42% smaller)');
    expect(operationSummary('page-numbers', {})).toBe('Added page numbers');
    expect(operationSummary('images-to-pdf', { images: 4 })).toBe('Converted 4 images to PDF');
    expect(operationSummary('pdf-to-images', { page: 3, format: 'png', dpi: 150 })).toBe('Converted page 3 to PNG at 150 dpi');
  });

  it('adds the sizes to a compress summary when they are given', () => {
    expect(operationSummary('compress', { level: 'recommended', saved: 42, from: '4.8 MB', to: '2.8 MB' })).toBe(
      'Compressed, Balanced (42% smaller: 4.8 MB → 2.8 MB)',
    );
    expect(operationSummary('compress', { level: 'extreme', saved: 70 })).toBe('Compressed, Strong (70% smaller)');
  });

  it('uses the singular for one', () => {
    expect(operationSummary('images-to-pdf', { images: 1 })).toBe('Converted 1 image to PDF');
    expect(operationSummary('split', { every: 1, part: 2, parts: 5 })).toBe('Split every 1 page (part 2 of 5)');
    expect(operationSummary('delete-pages', { pages: '4' })).toBe('Deleted page 4');
    expect(operationSummary('split', { pages: '8' })).toBe('Extracted page 8');
  });

  it('names JPG pages in capitals too', () => {
    expect(operationSummary('pdf-to-images', { page: 12, format: 'jpg', dpi: 300 })).toBe('Converted page 12 to JPG at 300 dpi');
  });
});
