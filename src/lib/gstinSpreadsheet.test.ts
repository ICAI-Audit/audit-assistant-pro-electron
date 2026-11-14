import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { createVerifiedGstinCsv, parseGstinSpreadsheet } from './gstinSpreadsheet';

const makeWorkbook = (rows: unknown[][], bookType: 'xlsx' | 'biff8' = 'xlsx') => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'GSTINs');
  return XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer;
};

describe('GSTIN spreadsheet parsing', () => {
  it.each(['xlsx', 'biff8'] as const)('reads %s rows and separates valid, invalid, and duplicate GSTINs', (bookType) => {
    const result = parseGstinSpreadsheet(
      makeWorkbook([['GSTIN'], ['07aabct1234a1z2'], ['00AABCT1234A1Z2'], ['07AABCT1234A1Z2'], ['']], bookType)
    );

    expect(result.validGstins).toEqual(['07AABCT1234A1Z2']);
    expect(result.invalidGstins).toHaveLength(1);
    expect(result.invalidGstins[0].gstin).toBe('00AABCT1234A1Z2');
    expect(result.duplicateCount).toBe(1);
  });

  it('exports only the provided verified rows and escapes CSV/formula cells', () => {
    const csv = createVerifiedGstinCsv([
      { gstin: '07AABCT1234A1Z2', name: '=2+2, "Limited"', taxpayerType: 'Regular Dealer' },
    ]);
    expect(csv).toBe(
      '"GSTIN","Taxpayer Name","Taxpayer/Registration Type"\r\n"07AABCT1234A1Z2","\'=2+2, ""Limited""","Regular Dealer"\r\n'
    );
  });

  it('reads CSV data and rejects a different first-row header', () => {
    const csv = new TextEncoder().encode('GSTIN\n07AABCT1234A1Z2\n00AABCT1234A1Z2').buffer as ArrayBuffer;
    expect(parseGstinSpreadsheet(csv).validGstins).toEqual(['07AABCT1234A1Z2']);
    expect(() => parseGstinSpreadsheet(new TextEncoder().encode('Registration Number\n07AABCT1234A1Z2').buffer as ArrayBuffer))
      .toThrow('Cell A1 must contain the header GSTIN.');
  });
});