import { describe, expect, it } from 'vitest';
import { defaultResultName, operationSummary } from './resultNames';

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
});

describe('operationSummary', () => {
  it('reads like the activity record examples', () => {
    expect(operationSummary('merge', { files: 3 })).toBe('Merged 3 files');
    expect(operationSummary('split', { from: 3, to: 7 })).toBe('Split pages 3-7');
    expect(operationSummary('split', { every: 2, part: 1, parts: 3 })).toBe('Split every 2 pages (part 1 of 3)');
    expect(operationSummary('split', { pages: '1-5, 8' })).toBe('Extracted pages 1-5, 8');
    expect(operationSummary('delete-pages', { pages: '2, 4' })).toBe('Deleted pages 2, 4');
    expect(operationSummary('compress', { level: 'recommended', saved: 42 })).toBe('Compressed, Recommended (42% smaller)');
    expect(operationSummary('page-numbers', {})).toBe('Added page numbers');
    expect(operationSummary('images-to-pdf', { images: 4 })).toBe('Converted 4 images to PDF');
    expect(operationSummary('pdf-to-images', { page: 3, format: 'png', dpi: 150 })).toBe('Converted page 3 to PNG at 150 dpi');
  });

  it('adds the sizes to a compress summary when they are given', () => {
    expect(operationSummary('compress', { level: 'recommended', saved: 42, from: '4.8 MB', to: '2.8 MB' })).toBe(
      'Compressed, Recommended (42% smaller: 4.8 MB → 2.8 MB)',
    );
    expect(operationSummary('compress', { level: 'extreme', saved: 70 })).toBe('Compressed, Extreme (70% smaller)');
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
