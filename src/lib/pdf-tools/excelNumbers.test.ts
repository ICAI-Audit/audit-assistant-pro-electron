// The number rules of PDF to Excel (contract decision 12, "Number rules"; T-064): a cell is a number only
// when the whole cell parses; its format shows what the page showed. Every value here is invented.
import { describe, expect, it } from 'vitest';
import { displayNumber, numberFormat, parseAmount, type ParsedNumber } from './excelNumbers';

type Expect = Partial<ParsedNumber> & { value: number };

/** [cell text, what it parses to] for the cells that are numbers. */
const NUMBERS: [string, Expect][] = [
  // plain, ungrouped
  ['0', { value: 0, decimals: 0, grouping: 'none', negative: null, suffix: null }],
  ['7', { value: 7, decimals: 0, grouping: 'none' }],
  ['500', { value: 500, decimals: 0, grouping: 'none' }],
  ['0.50', { value: 0.5, decimals: 2, grouping: 'none' }],
  ['1234.5', { value: 1234.5, decimals: 1, grouping: 'none' }],
  ['123456.789', { value: 123456.789, decimals: 3, grouping: 'none' }],
  ['12345678', { value: 12345678, decimals: 0, grouping: 'none' }],
  ['100201', { value: 100201, decimals: 0, grouping: 'none' }],
  // western grouping
  ['123,456.78', { value: 123456.78, decimals: 2, grouping: 'western' }],
  ['1,234,567.00', { value: 1234567, decimals: 2, grouping: 'western' }],
  ['1,000', { value: 1000, decimals: 0, grouping: 'western' }],
  ['999,999,999,999.99', { value: 999999999999.99, decimals: 2, grouping: 'western' }],
  // Indian grouping
  ['1,23,456.78', { value: 123456.78, decimals: 2, grouping: 'indian' }],
  ['12,34,567.00', { value: 1234567, decimals: 2, grouping: 'indian' }],
  ['1,00,00,000', { value: 10000000, decimals: 0, grouping: 'indian' }],
  ['50,19,818.25', { value: 5019818.25, decimals: 2, grouping: 'indian' }],
  ['1,25,00,00,000.00', { value: 1250000000, decimals: 2, grouping: 'indian' }],
  // Below a lakh the two groupings read the same: western.
  ['12,345.00', { value: 12345, decimals: 2, grouping: 'western' }],
  ['42,500.00', { value: 42500, decimals: 2, grouping: 'western' }],
  // currency marks
  ['₹500', { value: 500, grouping: 'none' }],
  ['₹ 1,23,456.78', { value: 123456.78, grouping: 'indian' }],
  ['Rs 1,000.00', { value: 1000, decimals: 2, grouping: 'western' }],
  ['Rs.1,000.00', { value: 1000, decimals: 2 }],
  ['Rs. 2,50,000', { value: 250000, grouping: 'indian' }],
  ['RS. 75.50', { value: 75.5, decimals: 2 }],
  ['INR 9,999.99', { value: 9999.99, decimals: 2 }],
  ['INR12,00,000.00', { value: 1200000, grouping: 'indian' }],
  // negatives
  ['-500', { value: -500, negative: 'minus' }],
  ['- 500.00', { value: -500, decimals: 2, negative: 'minus' }],
  ['\u22121,250.00', { value: -1250, negative: 'minus' }],
  ['500-', { value: -500, negative: 'trailing-minus' }],
  ['1,23,456.78-', { value: -123456.78, negative: 'trailing-minus', grouping: 'indian' }],
  ['(500)', { value: -500, negative: 'brackets' }],
  ['(1,25,000.00)', { value: -125000, decimals: 2, negative: 'brackets', grouping: 'indian' }],
  ['( 500.00 )', { value: -500, decimals: 2, negative: 'brackets' }],
  ['(42,500.00)', { value: -42500, negative: 'brackets', grouping: 'western' }],
  ['-₹500', { value: -500, negative: 'minus' }],
  ['₹-500', { value: -500, negative: 'minus' }],
  ['(₹ 1,000.00)', { value: -1000, negative: 'brackets' }],
  ['₹(1,000.00)', { value: -1000, negative: 'brackets' }],
  ['Rs.(15,750.00)', { value: -15750, negative: 'brackets' }],
  ['(0.00)', { value: 0, decimals: 2, negative: 'brackets' }],
  // Dr / Cr: a literal suffix; the value is never turned negative
  ['1,250.00 Dr', { value: 1250, decimals: 2, suffix: 'Dr', negative: null }],
  ['1,250.00 Cr', { value: 1250, decimals: 2, suffix: 'Cr', negative: null }],
  ['12,34,567.50Cr', { value: 1234567.5, suffix: 'Cr', grouping: 'indian' }],
  ['500 DR', { value: 500, suffix: 'Dr' }],
  ['500 cr', { value: 500, suffix: 'Cr' }],
  ['₹ 2,000.00 Dr', { value: 2000, suffix: 'Dr' }],
  // spaces dropped next to a comma, dot, bracket, sign or currency mark
  ['1,23, 456.78', { value: 123456.78, grouping: 'indian' }],
  ['1,23 ,456.78', { value: 123456.78, grouping: 'indian' }],
  ['123 .45', { value: 123.45, decimals: 2 }],
  ['  1,000.00  ', { value: 1000 }],
  ['1,000.00\u00a0Cr', { value: 1000, suffix: 'Cr' }],
  // 15 digits is still a number
  ['1,23,45,67,89,012.00', { value: 123456789012, decimals: 2, grouping: 'indian' }],
  ['123456789012.345', { value: 123456789012.345, decimals: 3 }],
  // Only a bare whole number of more than 8 digits is an identifier: grouped or with decimals it is an amount.
  ['12,34,56,789.00', { value: 123456789, decimals: 2, grouping: 'indian' }],
  ['12,34,56,789', { value: 123456789, decimals: 0, grouping: 'indian' }],
  ['123,456,789', { value: 123456789, decimals: 0, grouping: 'western' }],
  ['123456789.50', { value: 123456789.5, decimals: 2, grouping: 'none' }],
  ['99,99,99,99,99,999.00', { value: 9999999999999, decimals: 2, grouping: 'indian' }], // 15 digits in all
];

/** Cells that must stay text, with why. */
const TEXT: [string, string][] = [
  ['', 'empty'],
  ['   ', 'blank'],
  ['-', 'a lone dash'],
  ['--', 'two dashes'],
  ['–', 'an en dash for nil'],
  ['₹', 'a lone currency mark'],
  ['Rs.', 'a lone currency word'],
  ['Nil', 'a word'],
  ['01-04-2025', 'a date with dashes'],
  ['1-4-2025', 'a short date'],
  ['31/03/2025', 'a date with slashes'],
  ['31.03.2025', 'a date with dots'],
  ['2025-03-31', 'an ISO date'],
  ['31-Mar-2025', 'a date with a month name'],
  ['31 Mar 2025', 'a written date'],
  ['10:30', 'a time'],
  ['000101', 'a leading zero (cheque number)'],
  ['0123', 'a leading zero'],
  ['00.50', 'two leading zeros'],
  ['0,123', 'a grouped leading zero'],
  ['1234567890123456', 'sixteen digits'],
  ['12,34,56,78,90,12,345.00', 'seventeen digits'],
  ['50100123456789', 'an account number: a bare whole number of more than 8 digits'],
  ['123456789', 'a nine-digit identifier'],
  ['9876543210', 'a mobile-like number'],
  ['12%', 'a percentage'],
  ['12.5 %', 'a spaced percentage'],
  ['1.234,56', 'European decimal comma'],
  ['1,5', 'a comma with one digit'],
  ['12 345', 'digits split by a plain space'],
  ['1 234.56', 'a space as a thousands separator'],
  ['1234 5678 9012', 'a spaced identity number'],
  ['1,2,3', 'bad grouping'],
  ['1,2345.00', 'a group of four'],
  ['12,34,5678', 'Indian grouping ending in four'],
  ['1234,567', 'a first group of four'],
  ['123,45', 'a last group of two'],
  ['1,23,', 'a trailing comma (half of a split number)'],
  [',456.78', 'a leading comma (the other half)'],
  ['.50', 'no digit before the point'],
  ['500.', 'a trailing point'],
  ['1.2.3', 'two points'],
  ['(500', 'an open bracket only'],
  ['500)', 'a close bracket only'],
  ['-(500)', 'a minus and brackets'],
  ['(500)-', 'brackets and a trailing minus'],
  ['-500-', 'two minus signs'],
  ['-500 Dr', 'a minus with Dr'],
  ['(500) Cr', 'brackets with Cr'],
  ['+500', 'a plus sign'],
  ['500 INR', 'a currency mark after the number'],
  ['Dr 500', 'Dr before the number'],
  ['500 Dr Cr', 'Dr and Cr'],
  ['₹₹500', 'two currency marks'],
  ['Rs ₹500', 'two currency marks of two kinds'],
  ['R100207', 'a reference with a letter'],
  ['TEST-0001', 'an account label'],
  ['1e5', 'exponent notation'],
  ['0x1F', 'hex'],
  ['१२३', 'Devanagari digits'],
  ['Page 1 of 3', 'words with digits'],
  ['12 Cr Dr', 'two suffixes'],
];

describe('parseAmount: cells that are numbers', () => {
  it.each(NUMBERS)('%s', (text, expected) => {
    const parsed = parseAmount(text);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject(expected);
    expect(Object.is(parsed!.value, -0)).toBe(false);
  });
});

describe('parseAmount: cells that stay text', () => {
  it.each(TEXT)('%s (%s)', (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe('the table itself', () => {
  it('has at least 60 cases and no case twice', () => {
    const all = [...NUMBERS.map(([t]) => t), ...TEXT.map(([t]) => t)];
    expect(all.length).toBeGreaterThanOrEqual(60);
    expect(new Set(all).size).toBe(all.length);
  });
});

const parsed = (text: string) => {
  const n = parseAmount(text);
  if (!n) throw new Error(`expected ${text} to parse`);
  return n;
};

describe('numberFormat: what Excel shows is what the page showed', () => {
  it.each([
    ['500', '0'],
    ['0.50', '0.00'],
    ['123456.789', '0.000'],
    ['123,456.78', '#,##0.00'],
    ['1,000', '#,##0'],
    ['-1,250.00', '#,##0.00;-#,##0.00'],
    ['(1,000.00)', '#,##0.00;(#,##0.00)'],
    ['1,000.00-', '#,##0.00;#,##0.00-'],
    ['1,250.00 Dr', '#,##0.00" Dr"'],
    ['500 Cr', '0" Cr"'],
    ['(0.00)', '0.00;(0.00);(0.00)'],
    // Indian grouping: quoted (literal) commas placed for the value's own digits (no conditions, which some readers sign differently).
    ['1,23,456.78', '#","##","##0.00'],
    ['12,34,567.00', '##","##","##0.00'],
    ['1,00,00,000', '#","##","##","##0'],
    ['1,25,00,00,000.00', '#","##","##","##","##0.00'],
    ['(1,25,000.00)', '#","##","##0.00;(#","##","##0.00)'],
    ['12,34,567.50 Cr', '##","##","##0.00" Cr"'],
  ])('%s → %s', (text, format) => {
    expect(numberFormat(parsed(text))).toBe(format);
  });
});

describe('displayNumber: the preview shows the cell as Excel will', () => {
  it.each([
    ['500', '500'],
    ['₹ 1,23,456.78', '1,23,456.78'],
    ['Rs. 2,50,000', '2,50,000'],
    ['1,23, 456.78', '1,23,456.78'],
    ['( 500.00 )', '(500.00)'],
    ['- 500.00', '-500.00'],
    ['\u22121,250.00', '-1,250.00'],
    ['500-', '500-'],
    ['1,250.00Dr', '1,250.00 Dr'],
    ['500 cr', '500 Cr'],
    ['1,25,00,00,000.00', '1,25,00,00,000.00'],
    ['999,999,999,999.99', '999,999,999,999.99'],
    ['0.50', '0.50'],
    ['(0.00)', '(0.00)'],
  ])('%s → %s', (text, shown) => {
    expect(displayNumber(parsed(text))).toBe(shown);
  });
});
