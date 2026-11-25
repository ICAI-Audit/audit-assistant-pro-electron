import * as XLSX from 'xlsx';
import { formatGstinInput, getGstinValidationError } from './gstinValidation';

export type InvalidGstinRow = {
  gstin: string;
  error: string;
};

export type ParsedGstinSpreadsheet = {
  validGstins: string[];
  invalidGstins: InvalidGstinRow[];
  duplicateCount: number;
};

export type VerifiedGstinCsvRow = {
  gstin: string;
  name: string;
  taxpayerType: string;
};

export function createVerifiedGstinCsv(rows: VerifiedGstinCsvRow[]): string {
  const escapeCell = (value: string) => {
    const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replace(/"/g, '""')}"`;
  };
  const csvRows = [
    ['GSTIN', 'Taxpayer Name', 'Taxpayer/Registration Type'],
    ...rows.map((row) => [row.gstin, row.name, row.taxpayerType]),
  ];
  return csvRows.map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

export function parseGstinSpreadsheet(data: ArrayBuffer): ParsedGstinSpreadsheet {
  const workbook = XLSX.read(data, { type: 'array', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('The spreadsheet does not contain a worksheet.');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: '',
    raw: false,
  });
  const header = formatGstinInput(String(rows[0]?.[0] ?? ''));
  if (header !== 'GSTIN') throw new Error('Cell A1 must contain the header GSTIN.');

  const validGstins: string[] = [];
  const invalidGstins: InvalidGstinRow[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const row of rows.slice(1)) {
    const rawValue = row[0];
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') continue;

    const gstin = formatGstinInput(String(rawValue));
    if (seen.has(gstin)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(gstin);

    const error = getGstinValidationError(gstin);
    if (error) invalidGstins.push({ gstin, error });
    else validGstins.push(gstin);
  }

  return { validGstins, invalidGstins, duplicateCount };
}