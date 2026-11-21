import { describe, expect, it } from 'vitest';
import { DOCX_MIME } from '@/lib/pdf-tools/wordBuild';
import { cleanedName } from './saveToComputer';
import { isOfficeFile, OFFICE_INPUT_REASON, officeInfo } from './officeFiles';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Excel and Word results in the list (T-064, decision 9)', () => {
  it('names a workbook and a Word document in plain words, with the tip that says how to open each', () => {
    expect(officeInfo({ mimeType: XLSX_MIME })).toEqual({ type: 'excel', label: 'Excel workbook', short: 'XLSX', extension: 'xlsx', tip: 'Save it, then open it in Excel.' });
    expect(officeInfo({ mimeType: DOCX_MIME })).toEqual({ type: 'word', label: 'Word document', short: 'DOCX', extension: 'docx', tip: 'Save it, then open it in Word.' });
  });

  it('tells the two apart by type only: anything that is not a Word document is a workbook', () => {
    expect(officeInfo({ mimeType: 'application/octet-stream' }).type).toBe('excel');
  });

  it('knows an office row by its kind, whatever its name', () => {
    expect(isOfficeFile({ kind: 'office' })).toBe(true);
    expect(isOfficeFile({ kind: 'pdf' })).toBe(false);
    expect(isOfficeFile({ kind: 'image' })).toBe(false);
  });

  it('gives the one sentence the toolbar and a run say when such a row is ticked', () => {
    expect(OFFICE_INPUT_REASON).toBe('Excel and Word results cannot be used by a tool.');
  });

  it('agrees with the save path on the extension: a name typed without one, or with another, ends in .xlsx or .docx', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
    for (const mimeType of [XLSX_MIME, DOCX_MIME]) {
      const extension = officeInfo({ mimeType }).extension;
      expect(cleanedName({ name: 'Statement', bytes, mimeType })).toBe(`Statement.${extension}`);
      expect(cleanedName({ name: 'Statement.pdf', bytes, mimeType })).toBe(`Statement.${extension}`);
      expect(cleanedName({ name: `Statement.${extension}`, bytes, mimeType })).toBe(`Statement.${extension}`);
    }
  });
});
