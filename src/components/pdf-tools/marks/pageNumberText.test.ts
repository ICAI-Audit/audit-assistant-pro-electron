import { describe, expect, it, vi } from 'vitest';
import { addPageNumbers, defaultPageNumberOptions, type PageNumberRunOptions } from '@/lib/pdf-tools/pageNumbers';
import { extractPages } from '@/lib/pdf-tools/organise';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { defaultPageNumberForm } from '../toolOptions';
import { loadCharacterCheck } from './markText';
import {
  applyNumberSizes,
  headerFooterSummary,
  numberPreviewFor,
  numberSizesOf,
  pageNumberSummary,
  pageNumberTokens,
  pageNumbersResultName,
  pageNumbersRunLabel,
  previewTokenValues,
  slotTextProblems,
} from './pageNumberText';

vi.setConfig({ testTimeout: 60_000 });

const values = { file: 'Ledger FY25.pdf', client: 'ABC Ltd', fy: '2025-26', today: new Date(2026, 10, 14) };

describe('header and footer characters, checked as the user types', () => {
  it('names a rupee sign typed in a line, in the library words', async () => {
    const check = await loadCharacterCheck();
    const texts = { ...defaultPageNumberForm(3).texts, 'top-left': 'Fees ₹', 'top-right': 'WP {page}' };
    const problems = slotTextProblems(texts, check, values);
    expect(Object.keys(problems)).toEqual(['top-left']);
    let library = '';
    try {
      await addPageNumbers(await makePdf('A', 1), { ...defaultPageNumberOptions(1), texts: { 'top-left': 'Fees ₹' } });
    } catch (error) {
      library = (error as Error).message;
    }
    expect(problems['top-left']).toBe(library);
  });

  it('names a character a token brings in (the client name), as the library does', async () => {
    const check = await loadCharacterCheck();
    const client = 'श्री Traders';
    const problems = slotTextProblems({ ...defaultPageNumberForm(1).texts, 'top-center': 'For {client}' }, check, { ...values, client });
    let library = '';
    try {
      await addPageNumbers(await makePdf('A', 1), { ...defaultPageNumberOptions(1), texts: { 'top-center': 'For {client}' }, tokens: { ...values, client } });
    } catch (error) {
      library = (error as Error).message;
    }
    expect(problems['top-center']).toBe(library);
  });

  it('checks nothing in empty places, or before the character list has loaded', () => {
    expect(slotTextProblems({ ...defaultPageNumberForm(1).texts, 'bottom-left': '₹' }, null, values)).toEqual({});
    expect(slotTextProblems(defaultPageNumberForm(1).texts, () => ['x'], values)).toEqual({});
  });
});

describe('tokens', () => {
  it('takes the file name as shown and the engagement facts given, never anything else', () => {
    expect(pageNumberTokens(values)).toEqual(values);
    expect(pageNumberTokens({ file: 'a.pdf', client: undefined, fy: null, today: values.today })).toEqual({ file: 'a.pdf', client: '', fy: '', today: values.today });
  });

  it('gives the values a preview fills in, the date in the chosen format', () => {
    expect(previewTokenValues(values, 'long', 'roman-upper', 12)).toEqual({ page: 'I', pages: 'XII', file: 'Ledger FY25.pdf', name: 'Ledger FY25', date: '14 November 2026', client: 'ABC Ltd', fy: '2025-26' });
  });
});

describe('result name (design 5.17)', () => {
  it('is _numbered for numbers only and _header_footer whenever header or footer text is used', () => {
    const form = defaultPageNumberForm(3);
    expect(pageNumbersResultName('Ledger.pdf', form)).toBe('Ledger_numbered.pdf');
    expect(pageNumbersResultName('Ledger.pdf', { ...form, texts: { ...form.texts, 'top-left': 'WP A1' } })).toBe('Ledger_header_footer.pdf');
    expect(pageNumbersResultName('Ledger.pdf', { ...form, numbersOn: false, texts: { ...form.texts, 'top-left': 'WP A1' } })).toBe('Ledger_header_footer.pdf');
    expect(pageNumbersResultName('Ledger.pdf', { ...form, texts: { ...form.texts, 'top-left': '   ' } })).toBe('Ledger_numbered.pdf');
  });
});

describe('sizes and margins chosen in mm (UX audit C6.5)', () => {
  const form = defaultPageNumberForm(12);
  const sizes = { sizeChoice: 'normal', sizeMm: '2.5', marginChoice: 'normal', marginMm: '10' };

  it('gives exactly phase 1 defaults for the recommended presets: 10 pt, 28 pt', () => {
    const applied = applyNumberSizes(form, sizes);
    expect(applied.errors).toEqual({});
    expect(applied.form.fontSize).toBe('10');
    expect(applied.form.marginPt).toBe('28');
    expect(numberSizesOf(form)).toEqual(sizes);
  });

  it('turns presets and typed millimetres into points, and refuses a typed size outside its limits in mm', () => {
    expect(applyNumberSizes(form, { ...sizes, sizeChoice: 'large', marginChoice: 'wide' }).form).toMatchObject({ fontSize: '14', marginPt: '57' });
    const typed = applyNumberSizes(form, { ...sizes, sizeChoice: 'other', sizeMm: '3', marginChoice: 'other', marginMm: '15' });
    expect(Number(typed.form.fontSize)).toBeCloseTo(11.84, 2);
    expect(Number(typed.form.marginPt)).toBeCloseTo(42.52, 2);
    const wrong = applyNumberSizes(form, { ...sizes, sizeChoice: 'other', sizeMm: '12', marginChoice: 'other', marginMm: '1' });
    expect(wrong.errors).toEqual({ fontSize: 'Enter a letter height from 1.5 to 9 mm.', marginPt: 'Enter a margin from 3 to 50 mm.' });
  });

  it('reads back a phase 1 size that is not a preset as a size in mm', () => {
    expect(numberSizesOf({ ...form, fontSize: '12', marginPt: '36' })).toEqual({ sizeChoice: 'other', sizeMm: '3', marginChoice: 'other', marginMm: '12.7' });
  });

  it('summarises the folded choices in words and mm', () => {
    expect(pageNumberSummary(form, sizes)).toBe('Starts at 1, numbers 1, 2, 3, Helvetica, normal size (2.5 mm), black, normal margin (10 mm)');
    expect(pageNumberSummary({ ...form, startNumber: '3', style: 'roman-upper', font: 'times', bold: true, color: '#a00000' }, { ...sizes, sizeChoice: 'other', sizeMm: '3' })).toBe(
      'Starts at 3, numbers I, II, III, Times bold, letters 3 mm tall, dark red, normal margin (10 mm)',
    );
    expect(headerFooterSummary(form.texts)).toBe('None');
    expect(headerFooterSummary({ ...form.texts, 'top-left': 'WP {page}', 'bottom-right': '{name}' })).toBe('Top left “WP {page}”, bottom right “{name}”');
  });

  it('names the result in the Run button, starting with a verb', () => {
    expect(pageNumbersRunLabel(form, 12, 12)).toBe('Add page numbers to 12 pages');
    expect(pageNumbersRunLabel({ ...form, texts: { ...form.texts, 'top-left': 'WP' } }, 11, 12)).toBe('Add page numbers, header and footer to 11 pages');
    expect(pageNumbersRunLabel({ ...form, numbersOn: false, texts: { ...form.texts, 'top-left': 'WP' } }, 12, 12)).toBe('Add header and footer to 12 pages');
    expect(pageNumbersRunLabel(form, 1, 1)).toBe('Add page numbers');
    expect(pageNumbersRunLabel(form, null, 12)).toBe('Add page numbers');
  });
});

describe('numberPreviewFor: one page of the file, numbered as the run numbers it', () => {
  const base = (over: Partial<PageNumberRunOptions>): PageNumberRunOptions => ({ ...defaultPageNumberOptions(6), ...over });

  it('gives each page in the range the text the whole run gives it, styles and totals included', async () => {
    const source = await makePdf('S', 6);
    const options = base({
      format: 'page-n-of-total',
      style: 'roman-lower',
      startNumber: 3,
      fromPage: 2,
      toPage: 5,
      texts: { 'top-left': 'WP {page} / {pages}', 'top-right': '{name} {client}' },
      tokens: values,
    });
    const whole = await pageTexts(await addPageNumbers(source, options));
    for (const page of [2, 3, 5]) {
      const plan = numberPreviewFor(options, page)!;
      const one = await addPageNumbers(await extractPages(source, [page - 1]), plan);
      expect((await pageTexts(one))[0]).toBe(whole[page - 1]);
    }
    expect(numberPreviewFor(options, 1)).toBeNull();
    expect(numberPreviewFor(options, 6)).toBeNull();
    // Four runs and four pdf.js reads: 35-42 s on a loaded machine, near the file's 60 s. A hang guard only.
  }, 180_000);

  it('keeps a circled plain number and the date format', () => {
    const plan = numberPreviewFor(base({ style: 'circled', startNumber: 1, dateFormat: 'long', texts: { 'top-left': '{date}' }, tokens: values }), 4)!;
    expect(plan).toMatchObject({ style: 'circled', format: 'n', startNumber: 4, fromPage: 1, toPage: 1, dateFormat: 'long' });
  });
});
