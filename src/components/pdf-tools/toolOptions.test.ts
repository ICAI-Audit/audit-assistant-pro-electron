import { beforeAll, describe, expect, it, vi } from 'vitest';
import { deletePages, splitEvery } from '@/lib/pdf-tools/organise';
import { addPageNumbers, defaultPageNumberOptions, pageNumberLabel, type PageNumberOptions } from '@/lib/pdf-tools/pageNumbers';
import { makePdf } from '@/lib/pdf-tools/testPdf';
import {
  closeUpOffset,
  defaultPageNumberForm,
  deleteError,
  estimateImageBytes,
  hexToRgb,
  IMAGE_MARGIN,
  imageBudgetWarning,
  pagesLeft,
  partCount,
  previewMessage,
  previewPlan,
  rangeError,
  readImageMargin,
  readPageNumberForm,
  resolveResultName,
  resolveStem,
  rgbToHex,
  splitSizeError,
  throttleProgress,
  type PageNumberForm,
} from './toolOptions';

vi.setConfig({ testTimeout: 20_000 });

let pdf3: Uint8Array;
beforeAll(async () => {
  pdf3 = await makePdf('T', 3); // also pays the cold pdf-lib import
}, 30_000);

describe('resolveResultName', () => {
  it('cleans a typed name and ensures the extension', () => {
    expect(resolveResultName('Bank: final?', 'Bank_merged.pdf', 'pdf')).toBe('Bank_ final_.pdf');
    expect(resolveResultName('Report.PDF', 'x.pdf', 'pdf')).toBe('Report.pdf');
    expect(resolveResultName('  Report  ', 'x.pdf', 'pdf')).toBe('Report.pdf');
  });

  it('falls back to the default when nothing usable was typed', () => {
    expect(resolveResultName('', 'Bank_merged.pdf', 'pdf')).toBe('Bank_merged.pdf');
    expect(resolveResultName('   ', 'Bank_merged.pdf', 'pdf')).toBe('Bank_merged.pdf');
    expect(resolveResultName('???', 'Bank_merged.pdf', 'pdf')).toBe('Bank_merged.pdf');
    expect(resolveResultName('<>:"/\\|?*', 'Bank_merged.pdf', 'pdf')).toBe('Bank_merged.pdf');
    expect(resolveResultName('...', 'Bank_merged.pdf', 'pdf')).toBe('Bank_merged.pdf');
    expect(resolveResultName('.pdf', 'Bank_merged.pdf', 'pdf')).toBe('Bank_merged.pdf');
  });

  it('keeps Unicode letters and caps the length', () => {
    expect(resolveResultName('बैंक विवरण', 'x.pdf', 'pdf')).toBe('बैंक विवरण.pdf');
    expect(resolveResultName('a'.repeat(300), 'x.pdf', 'pdf').length).toBe(120);
  });
});

describe('resolveStem', () => {
  it('cleans the stem and leaves room for the part or page suffix', () => {
    expect(resolveStem('Bank: 2026', 'Bank')).toBe('Bank_ 2026');
    expect(resolveStem('Bank.pdf', 'x')).toBe('Bank');
    expect(resolveStem('', 'Bank')).toBe('Bank');
    expect(resolveStem('***', 'Bank')).toBe('Bank');
    expect(resolveStem('a'.repeat(300), 'Bank').length).toBe(90);
  });
});

describe('split validation', () => {
  it("explains a bad range in the parser's words", () => {
    expect(rangeError('3', '7', 10)).toBeNull();
    expect(rangeError('7', '3', 10)).toBe('"7-3" is backwards: the first page must not be after the last');
    expect(rangeError('1', '11', 10)).toBe("Page 11 is outside this file's 10 pages");
    expect(rangeError('0', '2', 10)).toBe("Page 0 is outside this file's 10 pages");
    expect(rangeError('', '2', 10)).toBe('Enter whole page numbers from 1 to 10.');
    expect(rangeError('1.5', '2', 10)).toBe('Enter whole page numbers from 1 to 10.');
  });

  it('accepts N from 1 to one less than the page count, with the same words as splitEvery', async () => {
    expect(splitSizeError('1', 3)).toBeNull();
    expect(splitSizeError('2', 3)).toBeNull();
    const message = splitSizeError('3', 3);
    expect(message).toBe('Enter a number from 1 to 2.');
    await expect(splitEvery(pdf3, 3)).rejects.toThrow(message!);
    expect(splitSizeError('0', 3)).toBe(message);
    expect(splitSizeError('1.5', 3)).toBe(message);
    expect(splitSizeError('', 3)).toBe(message);
    expect(splitSizeError('1', 1)).toBe('This file has only one page, so it cannot be split into parts.');
  });

  it('counts the parts', () => {
    expect(partCount(5, 2)).toBe(3);
    expect(partCount(4, 2)).toBe(2);
    expect(partCount(5, 1)).toBe(5);
  });
});

describe('delete pages validation', () => {
  it('refuses every page with the words deletePages uses, and counts what is left', async () => {
    expect(deleteError([0, 2], 3)).toBeNull();
    expect(pagesLeft([0, 2], 3)).toBe(1);
    const message = deleteError([0, 1, 2], 3);
    expect(message).toBe('You cannot delete every page of a PDF.');
    await expect(deletePages(pdf3, [0, 1, 2])).rejects.toThrow(message!);
    expect(pagesLeft([0, 1, 2], 3)).toBe(0);
  });
});

describe('page number form', () => {
  const form = (change: Partial<PageNumberForm> = {}): PageNumberForm => ({ ...defaultPageNumberForm(3), ...change });

  it('starts from the defaults of pageNumbers.ts', () => {
    const read = readPageNumberForm(form(), 3);
    expect(read.error).toBeNull();
    expect(read.options).toEqual(defaultPageNumberOptions(3));
  });

  it('reads the range, custom text and colour', () => {
    const read = readPageNumberForm(
      form({ format: 'custom', prefix: 'WP-A1 / ', suffix: '', range: 'some', fromPage: '2', toPage: '3', startNumber: '0', color: '#ff8000', fontSize: '12', marginPt: '40' }),
      3,
    );
    expect(read.options).toMatchObject({ format: 'custom', prefix: 'WP-A1 / ', fromPage: 2, toPage: 3, startNumber: 0, fontSize: 12, marginPt: 40 });
    expect(read.options!.color.r).toBe(1);
    expect(read.options!.color.g).toBeCloseTo(128 / 255);
    expect(read.options!.color.b).toBe(0);
  });

  it('ignores the From/To fields while all pages are chosen', () => {
    expect(readPageNumberForm(form({ range: 'all', fromPage: 'x', toPage: '99' }), 3).error).toBeNull();
  });

  const cases: [Partial<PageNumberForm>, Partial<PageNumberOptions>][] = [
    [{ startNumber: '-1' }, { startNumber: -1 }],
    [{ startNumber: '1000001' }, { startNumber: 1_000_001 }],
    [{ startNumber: '1.5' }, { startNumber: 1.5 }],
    [{ startNumber: '' }, { startNumber: Number.NaN }],
    [{ range: 'some', fromPage: '3', toPage: '2' }, { fromPage: 3, toPage: 2 }],
    [{ range: 'some', fromPage: '1', toPage: '4' }, { fromPage: 1, toPage: 4 }],
    [{ range: 'some', fromPage: '', toPage: '2' }, { fromPage: Number.NaN, toPage: 2 }],
    [{ fontSize: '5' }, { fontSize: 5 }],
    [{ fontSize: '37' }, { fontSize: 37 }],
    [{ fontSize: '' }, { fontSize: Number.NaN }],
    [{ marginPt: '7' }, { marginPt: 7 }],
    [{ marginPt: '145' }, { marginPt: 145 }],
    [{ color: 'red' }, { color: { r: Number.NaN, g: 0, b: 0 } }],
  ];

  it.each(cases)('rejects %o with the message addPageNumbers gives', async (change, libChange) => {
    const read = readPageNumberForm(form(change), 3);
    expect(read.options).toBeNull();
    await expect(addPageNumbers(pdf3, { ...defaultPageNumberOptions(3), ...libChange })).rejects.toThrow(read.error!);
  });

  it('says which field is wrong, so the input can be marked', () => {
    expect(readPageNumberForm(form({ startNumber: '-1' }), 3).field).toBe('startNumber');
    expect(readPageNumberForm(form({ range: 'some', fromPage: '3', toPage: '2' }), 3).field).toBe('range');
    expect(readPageNumberForm(form({ fontSize: '99' }), 3).field).toBe('fontSize');
    expect(readPageNumberForm(form({ marginPt: '1' }), 3).field).toBe('marginPt');
    expect(readPageNumberForm(form({ color: 'red' }), 3).field).toBe('color');
    expect(readPageNumberForm(form(), 3).field).toBeNull();
  });

  it('accepts the limits themselves', () => {
    expect(readPageNumberForm(form({ startNumber: '0' }), 3).error).toBeNull();
    expect(readPageNumberForm(form({ startNumber: '1000000' }), 3).error).toBeNull();
    expect(readPageNumberForm(form({ fontSize: '6', marginPt: '8' }), 3).error).toBeNull();
    expect(readPageNumberForm(form({ fontSize: '36', marginPt: '144' }), 3).error).toBeNull();
  });

  it('converts colours both ways', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb('blue')).toBeNull();
    expect(rgbToHex({ r: 1, g: 128 / 255, b: 0 })).toBe('#ff8000');
  });
});

describe('page number preview', () => {
  it('numbers a one-page extract with the label the first numbered page will get', () => {
    for (const format of ['n', 'page-n', 'n-of-total', 'page-n-of-total', 'custom'] as const) {
      const options: PageNumberOptions = { ...defaultPageNumberOptions(10), format, prefix: 'WP ', suffix: ' A', fromPage: 3, toPage: 8, startNumber: 5 };
      const plan = previewPlan(options);
      expect(plan.pageIndex).toBe(2);
      expect(plan.options.fromPage).toBe(1);
      expect(plan.options.toPage).toBe(1);
      const realTotal = 8 - 3 + 1 + 5 - 1;
      expect(pageNumberLabel(plan.options, plan.options.startNumber, 1)).toBe(pageNumberLabel(options, 5, realTotal));
      expect(plan.label).toBe(pageNumberLabel(options, 5, realTotal));
    }
  });

  it('names the real page in a fit message from the preview', () => {
    const lib = 'The page number does not fit on page 1. Use shorter text, a smaller font size or a smaller margin.';
    expect(previewMessage(lib, 7)).toBe('The page number does not fit on page 7. Use shorter text, a smaller font size or a smaller margin.');
    expect(previewMessage('Enter a font size from 6 to 36.', 7)).toBe('Enter a font size from 6 to 36.');
  });

  it('frames the corner the number sits in', () => {
    const base = { imageWidth: 1000, imageHeight: 1400, pxPerPt: 1, marginPt: 28, fontSize: 10, viewWidth: 300, viewHeight: 80 };
    const bottomCentre = closeUpOffset({ ...base, position: 'bottom-center', marginPt: 60 });
    expect(bottomCentre.x).toBe(-350);
    expect(bottomCentre.y).toBe(80 / 2 - (1400 - 60 - 5)); // the number's middle in the middle of the view
    expect(closeUpOffset({ ...base, position: 'bottom-center' }).y).toBe(80 - 1400); // clamped: no gap below the page
    const topLeft = closeUpOffset({ ...base, position: 'top-left', marginPt: 10 });
    expect(topLeft).toEqual({ x: 0, y: 0 }); // clamped: the image never leaves a gap
    const bottomRight = closeUpOffset({ ...base, position: 'bottom-right', marginPt: 100 });
    expect(bottomRight.x).toBe(300 - 16 - (1000 - 100));
    expect(bottomRight.y).toBeLessThanOrEqual(0);
    expect(bottomRight.y).toBeGreaterThanOrEqual(80 - 1400);
  });
});

describe('images to PDF margin', () => {
  it('accepts 0 to 279 points, the most an A4 page can take', () => {
    expect(IMAGE_MARGIN).toEqual({ min: 0, max: 279, default: 28 });
    expect(readImageMargin('0')).toEqual({ marginPt: 0, error: null });
    expect(readImageMargin('279')).toEqual({ marginPt: 279, error: null });
    expect(readImageMargin('12.5')).toEqual({ marginPt: 12.5, error: null });
    expect(readImageMargin('280').error).toBe('Enter a margin from 0 to 279 points.');
    expect(readImageMargin('-1').error).toBe('Enter a margin from 0 to 279 points.');
    expect(readImageMargin('').error).toBe('Enter a margin from 0 to 279 points.');
    expect(readImageMargin('abc').error).toBe('Enter a margin from 0 to 279 points.');
  });
});

describe('PDF to images size check', () => {
  it('estimates more for PNG than JPG and more at a higher resolution', () => {
    expect(estimateImageBytes(10, 150, 'png')).toBeGreaterThan(estimateImageBytes(10, 150, 'jpg'));
    expect(estimateImageBytes(10, 300, 'png')).toBeGreaterThan(estimateImageBytes(10, 150, 'png') * 3);
    expect(estimateImageBytes(0, 300, 'png')).toBe(0);
  });

  it('warns, without refusing, when the estimate may not fit', () => {
    const MB = 1024 * 1024;
    expect(imageBudgetWarning(10 * MB, 100 * MB, 300 * MB, { dpi: 150, format: 'png' })).toBeNull();
    expect(imageBudgetWarning(250 * MB, 100 * MB, 300 * MB, { dpi: 150, format: 'png' })).toBe(
      'These images may come to about 250 MB, more than the 200 MB left in the list (300 MB at most). If they do not fit, the run stops and nothing is added; fewer pages, a lower resolution or JPG make them smaller.',
    );
  });

  it('suggests only what the chosen resolution and type are not already using', () => {
    const MB = 1024 * 1024;
    const ending = (dpi: 100 | 150 | 300, format: 'png' | 'jpg') =>
      /nothing is added(.*)$/.exec(imageBudgetWarning(250 * MB, 100 * MB, 300 * MB, { dpi, format }) ?? '')?.[1];
    expect(ending(300, 'png')).toBe('; fewer pages, a lower resolution or JPG make them smaller.');
    expect(ending(100, 'png')).toBe('; fewer pages or JPG make them smaller.');
    expect(ending(300, 'jpg')).toBe('; fewer pages or a lower resolution make them smaller.');
    // At 100 dpi as JPG only the number of pages is left to change.
    expect(ending(100, 'jpg')).toBe('. Choosing fewer pages makes them smaller.');
  });
});

describe('throttleProgress', () => {
  it('passes the first, the last and at most one update per interval', () => {
    let t = 0;
    const seen: number[] = [];
    const report = throttleProgress((done) => seen.push(done), 100, () => t);
    report(0, 10);
    t = 10;
    report(1, 10);
    t = 50;
    report(2, 10);
    t = 120;
    report(3, 10);
    t = 130;
    report(10, 10);
    expect(seen).toEqual([0, 3, 10]);
  });

  it('passes a change of label at once', () => {
    let t = 0;
    const seen: (string | undefined)[] = [];
    const report = throttleProgress((_d, _t, label) => seen.push(label), 100, () => t);
    report(0, 0, 'Converting images…');
    t = 5;
    report(0, 0, 'Merging…');
    expect(seen).toEqual(['Converting images…', 'Merging…']);
  });
});
