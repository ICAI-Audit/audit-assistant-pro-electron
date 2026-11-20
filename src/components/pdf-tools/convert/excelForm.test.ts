// PDF to Excel's words and rules (excelForm.ts; T-064): the sentences on screen, the record, the preview grid.
import { describe, expect, it } from 'vitest';
import type { ExcelReport } from '@/lib/pdf-tools/excelBuild';
import type { Block, PageLayout, Word } from '@/lib/pdf-tools/layout';
import {
  blockedReason,
  kindNote,
  littleTextSentence,
  NAME_HINT,
  PREVIEW_COLUMNS,
  PREVIEW_ROWS,
  previewCut,
  previewGrid,
  RECORD_KEYS,
  recordOptions,
  resultDescription,
  runSentence,
  SCANNED_MESSAGE,
  summary,
  TOO_MANY_PAGES_MESSAGE,
} from './excelForm';

const report = (over: Partial<ExcelReport> = {}): ExcelReport => ({ pages: 3, sheets: 1, tablesRuled: 1, tablesAligned: 0, pagesAsText: 0, pagesNoText: 0, rows: 142, numberCells: 90, ...over });

const w = (text: string, x0: number): Word => ({ text, x0, y0: 0, x1: x0 + 20, y1: 10, size: 9, font: 'F' });
const tableBlock = (source: 'ruled' | 'aligned', rows: string[][]): Block => ({
  kind: 'table',
  table: { source, y0: 0, y1: 0, columns: rows[0].map((_, i) => i * 50), rows: rows.map((r) => r.map((t, i) => ({ text: t, words: t ? [w(t, i * 50)] : [] }))) },
});
const textBlock = (...lines: string[]): Block => ({ kind: 'text', lines: lines.map((t) => ({ y0: 0, y1: 10, size: 9, words: t.split(' ').map((s, i) => w(s, i * 25)) })) });
const layout = (blocks: Block[], hasText = blocks.length > 0): PageLayout => ({ pageIndex: 0, width: 595, height: 842, hasText, blocks });

describe('the message after a run', () => {
  it.each([
    [report(), '3 pages, 1 sheet, 142 rows.'],
    [report({ pages: 1, rows: 1 }), '1 page, 1 sheet, 1 row.'],
    [report({ pagesAsText: 2 }), '3 pages, 1 sheet, 142 rows; 2 pages had no table and were written as text.'],
    [report({ pagesAsText: 1 }), '3 pages, 1 sheet, 142 rows; 1 page had no table and was written as text.'],
    [report({ pagesNoText: 1, pagesAsText: 2, sheets: 12, pages: 12, rows: 12345 }), '12 pages, 12 sheets, 12,345 rows; 2 pages had no table and were written as text.'],
  ])('%o', (r, sentence) => {
    expect(runSentence(r)).toBe(sentence);
  });

  it('pages with little or no text: the lead\'s sentence, singular and plural', () => {
    expect(littleTextSentence(0)).toBeNull();
    expect(littleTextSentence(1)).toBe('1 page has little or no text; it may be scanned. Make the file searchable to convert it.');
    expect(littleTextSentence(4)).toBe('4 pages have little or no text; they may be scanned. Make the file searchable to convert them.');
  });

  it('names the workbook, says the counts, and warns when pages had little or no text', () => {
    expect(resultDescription('Statement.xlsx', report())).toEqual({ message: 'Made Statement.xlsx', detail: '3 pages, 1 sheet, 142 rows.', tone: 'success' });
    expect(resultDescription('Statement.xlsx', report({ pagesNoText: 4, pages: 12 }))).toEqual({
      message: 'Made Statement.xlsx',
      detail: '12 pages, 1 sheet, 142 rows. 4 pages have little or no text; they may be scanned. Make the file searchable to convert them.',
      tone: 'warning',
    });
    expect(resultDescription('Statement.xlsx', report({ pagesAsText: 1 })).tone).toBe('success');
  });
});

describe('the record', () => {
  it('holds only counts and the sheets choice, under RECORD_KEYS', () => {
    const options = recordOptions({ ...report({ pagesNoText: 1, pagesFromScan: 1 }), sheetMode: 'per-page' });
    expect(Object.keys(options).sort()).toEqual([...RECORD_KEYS].sort());
    expect(options).toEqual({ sheetMode: 'per-page', pages: 3, sheets: 1, rows: 142, numberCells: 90, tablesRuled: 1, tablesAligned: 0, pagesAsText: 0, pagesNoText: 1, pagesFromScan: 1 });
    // The count of scanned pages is in the record only when there is one.
    expect(recordOptions({ ...report({ pagesNoText: 1 }), sheetMode: 'per-page' })).toEqual({ sheetMode: 'per-page', pages: 3, sheets: 1, rows: 142, numberCells: 90, tablesRuled: 1, tablesAligned: 0, pagesAsText: 0, pagesNoText: 1 });
    for (const value of Object.values(options)) expect(['string', 'number']).toContain(typeof value);
  });

  it('keeps nothing extra a report might carry', () => {
    const tainted = { ...report(), sheetMode: 'one-sheet' as const, cell: 'Sample Traders', name: 'Ledger.pdf' } as unknown as Parameters<typeof recordOptions>[0];
    expect(JSON.stringify(recordOptions(tainted))).not.toMatch(/Sample|Ledger/);
  });

  it('summary: the operation and its counts', () => {
    expect(summary(report())).toBe('Converted to Excel: 3 pages, 1 sheet');
    expect(summary(report({ pages: 1, sheets: 1 }))).toBe('Converted to Excel: 1 page, 1 sheet');
  });
});

describe('the name hint', () => {
  it('shows the file name the run will give', () => {
    expect(NAME_HINT('Statement')).toBe('Will be saved as Statement.xlsx');
    expect(NAME_HINT('Statement.XLSX')).toBe('Will be saved as Statement.xlsx');
  });
});

describe('why Run waits', () => {
  it('a scanned file, or one of more than 1,000 pages', () => {
    expect(SCANNED_MESSAGE).toBe('This file has no text to read; it looks scanned. Make it searchable first.');
    expect(blockedReason({ pageCount: 3 }, 'scanned')).toBe(SCANNED_MESSAGE);
    expect(blockedReason({ pageCount: 1001 }, 'ready')).toBe(TOO_MANY_PAGES_MESSAGE);
    expect(blockedReason({ pageCount: 1000 }, 'ready')).toBeNull();
    expect(blockedReason({ pageCount: 3 }, 'reading')).toBeNull(); // the run checks again
    expect(blockedReason({ pageCount: 3 }, 'error')).toBeNull();
  });
});

describe('the preview grid', () => {
  it('shows a page as its sheet will hold it: numbers as Excel will show them, marked for right alignment', () => {
    const grid = previewGrid(
      layout([
        textBlock('Sample Traders (invented)'),
        tableBlock('aligned', [
          ['Particulars', 'Debit (Rs.)', 'Credit (Rs.)'],
          ['Share capital', '', '₹ 25,00,000.00'],
          ['Accumulated depreciation', '( 1,25,000.00 )', ''],
          ['Cheque', '000101', '1,250.00Dr'],
        ]),
      ]),
    );
    expect(grid.kind).toBe('aligned');
    expect(grid.rows).toBe(5);
    expect(grid.columns).toBe(3);
    expect(grid.cells[0]).toEqual([{ text: 'Sample Traders (invented)', number: false }]);
    expect(grid.cells[2]).toEqual([
      { text: 'Share capital', number: false },
      { text: '', number: false },
      { text: '25,00,000.00', number: true },
    ]);
    expect(grid.cells[3][1]).toEqual({ text: '(1,25,000.00)', number: true });
    expect(grid.cells[4]).toEqual([
      { text: 'Cheque', number: false },
      { text: '000101', number: false },
      { text: '1,250.00 Dr', number: true },
    ]);
  });

  it(`at most ${PREVIEW_ROWS} rows by ${PREVIEW_COLUMNS} columns, with the full size given`, () => {
    const rows = Array.from({ length: 45 }, (_, r) => Array.from({ length: 15 }, (_, c) => `r${r}c${c}`));
    const grid = previewGrid(layout([tableBlock('ruled', rows)]));
    expect(grid.cells).toHaveLength(30);
    expect(Math.max(...grid.cells.map((r) => r.length))).toBe(12);
    expect(grid).toMatchObject({ rows: 45, columns: 15, kind: 'ruled' });
  });

  it('a page of text only, and an empty page', () => {
    expect(previewGrid(layout([textBlock('Dear Sir,', 'Please find the statement enclosed.')]))).toMatchObject({ kind: 'text', rows: 2, columns: 1 });
    expect(previewGrid(layout([], false))).toEqual({ kind: 'empty', rows: 0, columns: 0, cells: [] });
  });

  it('says in plain words what was found', () => {
    expect(kindNote('ruled')).toBe('Table found from the lines drawn on the page.');
    expect(kindNote('aligned')).toBe('Table found from how the text lines up. It may need tidying in Excel.');
    expect(kindNote('text')).toBe('No table found on this page. Its text goes in column A, one line per row.');
    expect(kindNote('empty')).toBe('This page has no text. It is left empty.');
  });
});

describe('what the preview leaves out', () => {
  const grid = (rows: number, columns: number) => ({ kind: 'ruled' as const, rows, columns, cells: [] });

  it('says nothing when the whole page is shown', () => {
    expect(previewCut(grid(30, 12))).toBeNull();
    expect(previewCut(grid(1, 1))).toBeNull();
  });

  it('names only what is cut: the rows, the columns, or both (never "6 of 6 columns")', () => {
    expect(previewCut(grid(32, 6))).toBe('Showing the first 30 of 32 rows.');
    expect(previewCut(grid(12, 15))).toBe('Showing the first 12 of 15 columns.');
    expect(previewCut(grid(45, 15))).toBe('Showing the first 30 of 45 rows and 12 of 15 columns.');
  });
});
