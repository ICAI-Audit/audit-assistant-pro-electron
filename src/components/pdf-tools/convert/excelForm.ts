// PDF to Excel's words and rules (design 5.11; contract decisions 10, 11, 14, 17; T-064). Pure: the
// dialog's sentences, why Run waits, the preview grid of one page, the record and the result's message.
// Nothing here holds a value from the document except the preview grid, which only the dialog shows.
import { planSheets, type ExcelReport, type SheetMode } from '@/lib/pdf-tools/excelBuild';
import { displayNumber } from '@/lib/pdf-tools/excelNumbers';
import type { PageLayout } from '@/lib/pdf-tools/layout';
import type { Description } from '../toolStep';

/** Excel, Word and Compare take at most this many pages a file (contract decision 17). */
export const MAX_PAGES = 1000;

export const DESCRIPTION = 'Put the tables of this PDF into an Excel workbook. Amounts become numbers you can add up.';
export const RUN_LABEL = 'Make Excel workbook';
/** Contract decision 15: the dialog's own signed-file notice. */
export const SIGNED_WARNING = 'This file is signed. The result is a new file; the signed original is unchanged.';
/** Contract decision 14, word for word. */
export const SCANNED_MESSAGE = 'This file has no text to read; it looks scanned. Make it searchable first.';
export const TOO_MANY_PAGES_MESSAGE = `This file has more than ${MAX_PAGES.toLocaleString('en-IN')} pages, too many for one workbook. Split it into parts, then convert each part.`;
export const UNREADABLE_MESSAGE = 'The text of this file could not be read, and nothing was added. Open the file in a PDF reader, save a fresh copy and add that.';
/** Under the name field: the file name the step will give (excelRun.ts adds .xlsx unless it is typed). */
export const NAME_HINT = (stem: string) => `Will be saved as ${stem.replace(/\.xlsx$/i, '')}.xlsx`;

export const SHEET_CHOICES: { value: SheetMode; label: string; description: string }[] = [
  { value: 'one-sheet', label: 'All pages on one sheet', description: 'Best for statements and ledgers that run over several pages.' },
  { value: 'per-page', label: 'One sheet per page', description: 'Each page on its own sheet: Page_1, Page_2 and so on.' },
];

export const STEP_LABELS = {
  opening: 'Opening the file…',
  reading: (page: number, total: number) => `Reading page ${page} of ${total}…`,
  placing: 'Placing the tables in rows and columns…',
  writing: 'Writing the workbook…',
};

// ---- the message and the record -----------------------------------------------------------------------

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** "3 pages, 1 sheet, 142 rows; 2 pages had no table and were written as text." */
export function runSentence(report: ExcelReport): string {
  const parts = [`${count(report.pages, 'page')}, ${count(report.sheets, 'sheet')}, ${count(report.rows, 'row')}`];
  if (report.pagesAsText > 0) parts.push(`${count(report.pagesAsText, 'page')} had no table and ${report.pagesAsText === 1 ? 'was' : 'were'} written as text`);
  return `${parts.join('; ')}.`;
}

/** Lead's ruling (17 Nov): pages under 20 characters. Their words are still in the workbook. */
export function littleTextSentence(pages: number): string | null {
  if (pages <= 0) return null;
  return pages === 1
    ? '1 page has little or no text; it may be scanned. Make the file searchable to convert it.'
    : `${count(pages, 'page')} have little or no text; they may be scanned. Make the file searchable to convert them.`;
}

/**
 * Pages that are scans with recognised text (the same sentence as PDF to Word): their words were typed from the
 * recognition, so a number in a cell can be wrong, and the scan picture is not on the sheet.
 */
export function scanSentence(pages: number): string | null {
  if (pages <= 0) return null;
  return pages === 1
    ? '1 page is a scan: its text was typed from recognition and the scan picture was left out. Check numbers against the page.'
    : `${count(pages, 'page')} are scans: their text was typed from recognition and the scan pictures were left out. Check numbers against the page.`;
}

export function resultDescription(name: string, report: ExcelReport): Description {
  const scans = report.pagesFromScan ?? 0;
  const detail = [runSentence(report), littleTextSentence(report.pagesNoText), scanSentence(scans)].filter(Boolean).join(' ');
  return { message: `Made ${name}`, detail, tone: report.pagesNoText > 0 || scans > 0 ? 'warning' : 'success' };
}

/** The record's line (resultNames.ts operationSummary('pdf-to-excel') is its first part). */
export const SUMMARY = 'Converted to Excel';
export function summary(report: Pick<ExcelReport, 'pages' | 'sheets'>): string {
  return `${SUMMARY}: ${count(report.pages, 'page')}, ${count(report.sheets, 'sheet')}`;
}

export type ExcelRunReport = ExcelReport & { sheetMode: SheetMode };

/** The only keys the record keeps: the sheets choice and counts; never a cell, a name or a word. */
export const RECORD_KEYS = ['sheetMode', 'pages', 'sheets', 'rows', 'numberCells', 'tablesRuled', 'tablesAligned', 'pagesAsText', 'pagesNoText', 'pagesFromScan'] as const;

export function recordOptions(report: ExcelRunReport): Record<string, string | number> {
  const options: Record<string, string | number> = {};
  for (const key of RECORD_KEYS) {
    const value = report[key];
    if (key === 'sheetMode') options[key] = value === 'per-page' ? 'per-page' : 'one-sheet';
    else if (typeof value === 'number' && Number.isFinite(value)) options[key] = value;
  }
  return options;
}

// ---- why Run waits --------------------------------------------------------------------------------------

/** What the dialog knows about the file's text: still reading, found some, none on any page, or could not tell. */
export type TextState = 'reading' | 'ready' | 'scanned' | 'error';

export function blockedReason(file: { pageCount: number | null }, text: TextState): string | null {
  if ((file.pageCount ?? 0) > MAX_PAGES) return TOO_MANY_PAGES_MESSAGE;
  if (text === 'scanned') return SCANNED_MESSAGE;
  return null;
}

// ---- the preview -----------------------------------------------------------------------------------------

export const PREVIEW_ROWS = 30;
export const PREVIEW_COLUMNS = 12;

export type PageKind = 'ruled' | 'aligned' | 'text' | 'empty';
export interface PreviewCell { text: string; number: boolean }
export interface PreviewGrid {
  kind: PageKind;
  /** The page's full size on its sheet. */
  rows: number;
  columns: number;
  /** At most PREVIEW_ROWS rows of at most PREVIEW_COLUMNS cells. */
  cells: PreviewCell[][];
}

/** One page as its sheet will hold it (the same plan as the run), numbers shown as Excel will show them. */
export function previewGrid(layout: PageLayout): PreviewGrid {
  if (!layout.hasText) return { kind: 'empty', rows: 0, columns: 0, cells: [] };
  const { sheets, report } = planSheets([layout], 'per-page');
  const [sheet] = sheets;
  const kind: PageKind = report.tablesRuled > 0 ? 'ruled' : report.tablesAligned > 0 ? 'aligned' : 'text';
  const columns = sheet.rows.reduce((n, row) => Math.max(n, row.length), 0);
  const cells = sheet.rows.slice(0, PREVIEW_ROWS).map((row) =>
    row.slice(0, PREVIEW_COLUMNS).map((cell): PreviewCell => ('number' in cell ? { text: displayNumber(cell.number), number: true } : { text: cell.text, number: false })),
  );
  return { kind, rows: sheet.rows.length, columns, cells };
}

export function kindNote(kind: PageKind): string {
  switch (kind) {
    case 'ruled':
      return 'Table found from the lines drawn on the page.';
    case 'aligned':
      return 'Table found from how the text lines up. It may need tidying in Excel.';
    case 'text':
      return 'No table found on this page. Its text goes in column A, one line per row.';
    case 'empty':
      return 'This page has no text. It is left empty.';
  }
}

/** Under the grid when the page holds more than it shows. */
export function previewCut(grid: PreviewGrid): string | null {
  // Only what is cut is named: "30 of 32 rows and 6 of 6 columns" made the reader look for missing columns.
  const parts = [
    grid.rows > PREVIEW_ROWS ? `${PREVIEW_ROWS} of ${count(grid.rows, 'row')}` : null,
    grid.columns > PREVIEW_COLUMNS ? `${PREVIEW_COLUMNS} of ${count(grid.columns, 'column')}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `Showing the first ${parts.join(' and ')}.`;
}
