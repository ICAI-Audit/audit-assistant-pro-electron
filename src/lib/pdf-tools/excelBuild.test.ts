// PDF to Excel's sheet plan and workbook writer (design 5.11 and 13; contract XLS; T-064). The pages are
// built by hand here as PageLayout values (no PDF reader); the workbook is read back with exceljs. Every
// name and amount is invented.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { pageLayout, type Block, type Cell, type Line, type PageLayout, type PageWords, type Table, type Word } from './layout';
import { parseAmount } from './excelNumbers';
import { convertFixture, convertFixtureExpected, indianAmount } from './testConvertPdf';
import { buildWorkbook, EXCEL_MAX_ROWS, packSheets, planSheets, planSheetsPaced, safeSheetName, writePacked, xmlSafe, type SheetPlan } from './excelBuild';
import { pacer } from './pace';
import { PdfToolsError } from './types';

// ---- hand-built layouts ------------------------------------------------------------------------------

const word = (text: string, x0: number, y0 = 0): Word => ({ text, x0, y0, x1: x0 + text.length * 5, y1: y0 + 10, size: 9, font: 'Helvetica' });
/** The words of `text` from x, a word space apart (as a page sets them). */
const spaced = (text: string, x: number, y = 0): Word[] => {
  let at = x;
  return text.split(' ').map((t) => {
    const w = word(t, at, y);
    at = w.x1 + 2.5;
    return w;
  });
};
const cell = (text: string, x = 0): Cell => ({ text, words: text === '' ? [] : spaced(text, x) });
const line = (text: string, y = 0): Line => ({ y0: y, y1: y + 10, size: 9, words: spaced(text, 36, y) });
const table = (source: Table['source'], columns: number[], rows: string[][]): Block => ({
  kind: 'table',
  table: { source, y0: 100, y1: 100 + rows.length * 16, columns, rows: rows.map((r) => r.map((t, c) => cell(t, columns[c] ?? 0))) },
});
const text = (...lines: string[]): Block => ({ kind: 'text', lines: lines.map((t, i) => line(t, 50 + i * 14)) });
const page = (pageIndex: number, blocks: Block[], hasText = blocks.length > 0): PageLayout => ({ pageIndex, width: 595, height: 842, hasText, blocks });

const COLS = [36, 96, 300, 360, 430, 500];
const HEAD = ['Date', 'Narration', 'Ref', 'Debit', 'Credit', 'Balance'];

function statementPage(i: number, rows: string[][], columns = COLS): PageLayout {
  return page(i, [text('Example Co-operative Bank (invented)', 'Statement of account'), table('ruled', columns, [HEAD, ...rows]), text(`Page ${i + 1}`)]);
}

/** What a sheet holds as plain values: text as it is, a number as { n, f } (value and format). */
function values(sheet: SheetPlan): (string | number)[][] {
  return sheet.rows.map((row) => row.map((c) => ('number' in c ? c.number.value : c.text)));
}

// ---- planSheets ---------------------------------------------------------------------------------------

describe('planSheets', () => {
  it('one sheet: every block of every page in reading order, text lines in column A, numbers as numbers', () => {
    const p1 = statementPage(0, [['01-04-2025', 'Opening balance', '', '', '', '12,50,000.00'], ['02-04-2025', 'NEFT from Sample Buyer One', '000101', '', '5,000.00', '12,55,000.00']]);
    const { sheets, report } = planSheets([p1], 'one-sheet');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('All pages');
    expect(values(sheets[0])).toEqual([
      ['Example Co-operative Bank (invented)'],
      ['Statement of account'],
      HEAD,
      ['01-04-2025', 'Opening balance', '', '', '', 1250000],
      ['02-04-2025', 'NEFT from Sample Buyer One', '000101', '', 5000, 1255000],
      ['Page 1'],
    ]);
    // The cheque number with its leading zero and the date stay text.
    expect(sheets[0].rows[4][2]).toEqual({ text: '000101' });
    expect(sheets[0].rows[4][0]).toEqual({ text: '02-04-2025' });
    expect(report).toEqual({ pages: 1, sheets: 1, tablesRuled: 1, tablesAligned: 0, pagesAsText: 0, pagesNoText: 0, rows: 6, numberCells: 3 });
  });

  it('one sheet: a table with the same number of columns continues, wherever its columns start; repeated heading rows are kept', () => {
    const p1 = statementPage(0, [['01-04-2025', 'Rent', '', '1,000.00', '', '9,000.00']]);
    // A right-aligned column's left edge moves with the longest amount on the page: starts far apart still carry on.
    const shifted = COLS.map((x, i) => x + (i >= 3 ? -25 : 8));
    const p2 = statementPage(1, [['03-04-2025', 'Salary', '', '2,000.00', '', '7,000.00']], shifted);
    const { sheets, report } = planSheets([p1, p2], 'one-sheet');
    const rows = values(sheets[0]);
    // No blank row between the pages: the table goes on, and page 2's own heading row is there.
    expect(rows.filter((r) => r.length === 0)).toHaveLength(0);
    expect(rows.filter((r) => r[0] === 'Date')).toHaveLength(2);
    expect(rows.find((r) => r[1] === 'Salary')).toEqual(['03-04-2025', 'Salary', '', 2000, '', 7000]);
    expect(report.rows).toBe(rows.length);
  });

  it('one sheet: a table with another number of columns starts after a blank row, and becomes the one later pages follow', () => {
    const p1 = statementPage(0, [['01-04-2025', 'Rent', 'R1', '1,000.00', '', '9,000.00']]);
    const p2 = page(1, [table('aligned', [36, 300], [['Summary', ''], ['Total debits', '3,000.00']])]);
    const p3 = page(2, [table('ruled', [36, 300], [['Total credits', '4,000.00']])]);
    const rows = values(planSheets([p1, p2, p3], 'one-sheet').sheets[0]);
    const blanks = rows.map((r, i) => (r.length === 0 ? i : -1)).filter((i) => i >= 0);
    expect(blanks).toHaveLength(1);
    expect(rows[blanks[0] + 1]).toEqual(['Summary']); // trailing empty cells are not written
    expect(rows[blanks[0] + 2]).toEqual(['Total debits', 3000]);
    expect(rows[blanks[0] + 3]).toEqual(['Total credits', 4000]); // same count as the summary: carries on
  });

  it('one sheet: a later page with a much longer amount (no ruling lines) keeps every amount in the same Excel column', async () => {
    const f = await convertFixture('statement-plain');
    const expected = await convertFixtureExpected('statement-plain');
    // Page 1's balances become short (a thousandth), still ending at the column's right edge, so page 1's
    // Balance column starts about 16 pt to the right of page 2's, whose balances are as long as the column
    // allows: the left edges differ by far more than 6 pt, and the table must still carry on.
    const short = (text: string) => indianAmount(Math.round(parseAmount(text)!.value / 10));
    const balanceRight = Math.max(...f.pages[0].words.map((w) => w.x1));
    const page1: PageWords = {
      ...f.pages[0],
      words: f.pages[0].words.map((w) => {
        if (Math.abs(w.x1 - balanceRight) > 1 || !/^\d[\d,]*\.\d\d$/.test(w.text)) return w;
        const text = short(w.text);
        return { ...w, text, x0: w.x1 - ((w.x1 - w.x0) * text.length) / w.text.length };
      }),
    };
    const layouts = [page1, f.pages[1], f.pages[2]].map((p, i) => pageLayout(p, f.segments[i]));
    const starts = layouts.map((l) => l.blocks.flatMap((b) => (b.kind === 'table' ? [b.table.columns] : []))[0]);
    expect(starts.map((c) => c.length)).toEqual([6, 6, 6]);
    expect(starts[0][5] - starts[1][5]).toBeGreaterThan(6);
    const rows = values(planSheets(layouts, 'one-sheet').sheets[0]);
    const dated = rows.filter((r) => typeof r[0] === 'string' && /^\d\d-\d\d-2025$/.test(r[0]));
    const want = expected.lineRows.flatMap((p, i) => p.filter((r) => /^\d\d-\d\d-2025$/.test(r[0])).map((r) => (i === 0 && r[5] ? [...r.slice(0, 5), short(r[5])] : r)));
    expect(dated).toHaveLength(want.length);
    want.forEach((r, i) => {
      for (const c of [3, 4, 5]) expect(dated[i][c] ?? '', `${r[0]} column ${c}`).toBe(r[c] === '' ? '' : parseAmount(r[c])!.value);
    });
    // One table on the sheet: no blank row between pages.
    expect(rows.filter((r) => r.length === 0)).toHaveLength(0);
  });

  // ---- round 2: the reference re-grid (lead's ruling): an aligned table is placed in the columns of the
  // table before it whenever that is consistent, whatever number of columns the page itself showed.

  /** statement-plain, with page 2's balances a thousand times larger: so long they reach under the Credit column. */
  async function crowdedStatement() {
    const f = await convertFixture('statement-plain');
    const expected = await convertFixtureExpected('statement-plain');
    const long = (t: string) => indianAmount(Math.round(parseAmount(t)!.value * 100) * 1000);
    const balanceRight = Math.max(...f.pages[1].words.map((w) => w.x1));
    const page2: PageWords = {
      ...f.pages[1],
      words: f.pages[1].words.map((w) => {
        if (Math.abs(w.x1 - balanceRight) > 1 || !/^\d[\d,]*\.\d\d$/.test(w.text)) return w;
        const t = long(w.text);
        return { ...w, text: t, x0: w.x1 - ((w.x1 - w.x0) * t.length) / w.text.length };
      }),
    };
    const layouts = [f.pages[0], page2, f.pages[2]].map((p, i) => pageLayout(p, f.segments[i]));
    const want = expected.lineRows.map((p, i) => p.filter((r) => /^\d\d-\d\d-2025$/.test(r[0])).map((r) => (i === 1 && r[5] ? [...r.slice(0, 5), long(r[5])] : r)));
    return { layouts, want };
  }

  const dated = (rows: (string | number)[][]) => rows.filter((r) => typeof r[0] === 'string' && /^\d\d-\d\d-2025$/.test(r[0]));
  const expectAmounts = (got: (string | number)[][], want: string[][]) => {
    expect(got).toHaveLength(want.length);
    want.forEach((r, i) => {
      for (const c of [1, 3, 4, 5]) expect(got[i][c] ?? '', `${r[0]} column ${c}`).toBe(r[c] === '' ? '' : c === 1 ? r[c] : parseAmount(r[c])!.value);
    });
  };
  const ownColumns = (l: PageLayout) => l.blocks.flatMap((b) => (b.kind === 'table' ? [b.table.columns.length] : []));

  it('fewer columns found: page 2\'s long balances made the page show 5 columns; re-gridded, every balance stays in Balance', async () => {
    const { layouts, want } = await crowdedStatement();
    expect(ownColumns(layouts[1])).toEqual([5]); // what the page alone shows (FND)
    const rows = values(planSheets(layouts, 'one-sheet').sheets[0]);
    expectAmounts(dated(rows), want.flat());
    expect(rows.filter((r) => r.length === 0)).toHaveLength(0); // one table, carried on over every page
    expect(rows.filter((r) => r[0] === 'Date')).toEqual([HEAD, HEAD, HEAD]); // each page's heading, in the same columns
  });

  it('one sheet per page: the same re-grid, so the same statement has the same columns on every sheet', async () => {
    const { layouts, want } = await crowdedStatement();
    const { sheets } = planSheets(layouts, 'per-page');
    sheets.forEach((sheet, i) => expectAmounts(dated(values(sheet)), want[i]));
  });

  it('more columns found (a narration happened to line up and split its column): the re-grid joins it again', async () => {
    const f = await convertFixture('statement-plain');
    const expected = await convertFixtureExpected('statement-plain');
    const layouts = f.pages.map((p, i) => pageLayout(p, f.segments[i]));
    // Page 2's table as if its narrations had shown a seventh column starting at 180 pt.
    const split = (t: Table): Table => {
      const at = 180;
      const rows = t.rows.map((row) => {
        const words = row[1].words;
        const left = words.filter((w) => w.x0 < at);
        const right = words.filter((w) => w.x0 >= at);
        const cellOf = (ws: Word[]): Cell => ({ text: ws.map((w) => w.text).join(' '), words: ws });
        return [row[0], cellOf(left), cellOf(right), ...row.slice(2)];
      });
      return { ...t, columns: [t.columns[0], t.columns[1], at, ...t.columns.slice(2)], rows };
    };
    layouts[1] = { ...layouts[1], blocks: layouts[1].blocks.map((b) => (b.kind === 'table' ? { kind: 'table', table: split(b.table) } : b)) };
    expect(ownColumns(layouts[1])).toEqual([7]);
    const rows = values(planSheets(layouts, 'one-sheet').sheets[0]);
    expectAmounts(dated(rows), expected.lineRows.flatMap((p) => p.filter((r) => /^\d\d-\d\d-2025$/.test(r[0]))));
    expect(rows.filter((r) => r.length === 0)).toHaveLength(0);
  });

  it('never carries a table on in columns that would join two of its amounts into one text', () => {
    const w = (t: string, x0: number, y0: number): Word => ({ text: t, x0, y0, x1: x0 + t.length * 4.6, y1: y0 + 10, size: 9, font: 'Helvetica' });
    const right = (t: string, x1: number, y0: number) => w(t, x1 - t.length * 4.6, y0);
    // A small box of two cells above (a title and a note), then a statement of two amount columns that both lie in the box's second column.
    const box = table('ruled', [40, 250], [['Sample statement', 'for the year']]);
    const rowOf = (y: number, caption: string, a: string, b: string): Cell[] => [
      { text: caption, words: spaced(caption, 40, y) },
      { text: a, words: [right(a, 420, y)] },
      { text: b, words: [right(b, 520, y)] },
    ];
    const statement: Table = { source: 'aligned', y0: 140, y1: 200, columns: [40, 380, 480], rows: [rowOf(140, 'Plant and equipment', '1,836.24', '1,669.24'), rowOf(158, 'Work in progress', '177.48', '153.87'), rowOf(176, 'Other assets', '41.31', '43.46')] };
    const { sheets, report } = planSheets([page(0, [box, { kind: 'table', table: statement }])], 'one-sheet');
    expect(report.numberCells).toBe(6);
    expect(values(sheets[0]).filter((r) => typeof r[1] === 'number')).toEqual([
      ['Plant and equipment', 1836.24, 1669.24],
      ['Work in progress', 177.48, 153.87],
      ['Other assets', 41.31, 43.46],
    ]);
  });

  it('a genuinely different table on the next page: a new table from its own columns, never forced into the statement\'s', async () => {
    const f = await convertFixture('statement-plain');
    const w = (t: string, x0: number, y0: number): Word => ({ text: t, x0, y0, x1: x0 + t.length * 4.6, y1: y0 + 10, size: 9, font: 'Helvetica' });
    const right = (t: string, x1: number, y0: number) => w(t, x1 - t.length * 4.6, y0);
    const rowOf = (y: number, item: string, qty: string, value: string): Cell[] => [
      { text: item, words: item.split(' ').map((t, i) => w(t, 40 + i * 30, y)) },
      { text: qty, words: [right(qty, 250, y)] },
      { text: value, words: value.split(' ').map((t, i, all) => right(t, 400 - (all.length - 1 - i) * 30, y)) },
    ];
    const stock: Table = {
      source: 'aligned',
      y0: 100,
      y1: 160,
      columns: [40, 236, 349],
      rows: [rowOf(100, 'Item', 'Quantity', 'Value (Rs.)'), rowOf(118, 'Cement bags', '840', '2,94,000.00'), rowOf(136, 'Binding wire', '65', '9,750.00')],
    };
    const layouts = [pageLayout(f.pages[0], f.segments[0]), page(1, [{ kind: 'table', table: stock }])];
    const rows = values(planSheets(layouts, 'one-sheet').sheets[0]);
    const at = rows.findIndex((r) => r[0] === 'Item');
    expect(rows[at - 1]).toEqual([]); // a new table starts after a blank row
    expect(rows.slice(at, at + 3)).toEqual([
      ['Item', 'Quantity', 'Value (Rs.)'],
      ['Cement bags', 840, 294000],
      ['Binding wire', 65, 9750],
    ]);
  });

  it('a narration\'s second line stays a row of its own; no amount moves', () => {
    const p = page(0, [table('aligned', COLS, [HEAD, ['01-04-2025', 'NEFT from Sample Buyer Two against', 'R1', '', '5,000.00', '9,000.00'], ['', 'invoices 114 and 115 for March', '', '', '', '']])]);
    expect(values(planSheets([p], 'one-sheet').sheets[0]).slice(1)).toEqual([
      ['01-04-2025', 'NEFT from Sample Buyer Two against', 'R1', '', 5000, 9000],
      ['', 'invoices 114 and 115 for March'],
    ]);
  });

  it('a page with little text (under 20 characters) is counted, and its words are still written', () => {
    const stamp = page(1, [text('Page 7')]);
    const { sheets, report } = planSheets([statementPage(0, [['01-04-2025', 'Rent', '', '1,000.00', '', '9,000.00']]), stamp], 'per-page');
    expect(values(sheets[1])).toEqual([['Page 7']]);
    expect(report).toMatchObject({ pagesNoText: 1, pagesAsText: 0 });
  });

  it('one sheet per page: Page_n sheets, an empty page kept as an empty sheet', () => {
    const p1 = statementPage(0, [['01-04-2025', 'Rent', '', '1,000.00', '', '9,000.00']]);
    const blank = page(1, [], false);
    const p3 = page(2, [text('Notes to the statement', 'Interest is credited quarterly.')]);
    const { sheets, report } = planSheets([p1, blank, p3], 'per-page');
    expect(sheets.map((s) => s.name)).toEqual(['Page_1', 'Page_2', 'Page_3']);
    expect(sheets[1].rows).toEqual([]);
    expect(values(sheets[2])).toEqual([['Notes to the statement'], ['Interest is credited quarterly.']]);
    expect(report).toMatchObject({ pages: 3, sheets: 3, tablesRuled: 1, tablesAligned: 0, pagesAsText: 1, pagesNoText: 1 });
  });

  it('a page without a table is written as its text in column A, from A1 (the last fallback)', () => {
    const letter = page(0, [text('Sample Traders (invented)'), text('Every branch will count its stock on the last working day of March.', 'Two members of staff count each rack.')]);
    const { sheets, report } = planSheets([letter], 'per-page');
    expect(values(sheets[0])).toEqual([['Sample Traders (invented)'], ['Every branch will count its stock on the last working day of March.'], ['Two members of staff count each rack.']]);
    expect(report.pagesAsText).toBe(1);
    // A line of text that happens to be an amount stays text: only table cells become numbers.
    expect(planSheets([page(0, [text('1,000.00')])], 'one-sheet').sheets[0].rows).toEqual([[{ text: '1,000.00' }]]);
  });

  it('counts ruled and aligned tables, and the cells that became numbers', () => {
    const p = page(0, [
      table('ruled', [36, 300], [['Item', 'Value (Rs.)'], ['Cement bags', '2,94,000.00']]),
      table('aligned', [60, 420, 530], [['Particulars', 'Debit (Rs.)', 'Credit (Rs.)'], ['Accumulated depreciation', '(1,25,000.00)', ''], ['Share capital', '', '25,00,000.00']]),
    ]);
    const { sheets, report } = planSheets([p], 'one-sheet');
    expect(report).toMatchObject({ tablesRuled: 1, tablesAligned: 1, numberCells: 3, pagesAsText: 0 });
    const neg = sheets[0].rows.flat().find((c) => 'number' in c && c.number.value < 0);
    // (The hand-made amount starts where its heading starts, so the cell also says it sits at the left.)
    expect(neg).toMatchObject({ number: { value: -125000, decimals: 2, grouping: 'indian', negative: 'brackets', suffix: null } });
  });

  it('an empty page in one-sheet mode adds nothing; all pages empty still give one sheet', () => {
    const { sheets, report } = planSheets([page(0, [], false), page(1, [], false)], 'one-sheet');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].rows).toEqual([]);
    expect(report).toMatchObject({ pages: 2, sheets: 1, pagesNoText: 2, rows: 0 });
  });

  it('caps a row at 80 columns: what lies beyond is joined into column 80 as text, nothing dropped', () => {
    const wide = Array.from({ length: 83 }, (_, i) => String(i + 1));
    const { sheets } = planSheets([page(0, [table('ruled', wide.map((_, i) => i * 7), [wide])])], 'one-sheet');
    const [row] = sheets[0].rows;
    expect(row).toHaveLength(80);
    expect(row[78]).toEqual({ number: expect.objectContaining({ value: 79 }) });
    expect(row[79]).toEqual({ text: '80 81 82 83' });
  });

  it('refuses in plain words when one sheet would need more than 1,048,576 rows', () => {
    // One block shared by every page (the refusal comes before any row is built).
    const block = text(...Array.from({ length: 1000 }, (_, i) => `Line ${i}`));
    const pages = Array.from({ length: Math.ceil(EXCEL_MAX_ROWS / 1000) + 1 }, (_, i) => page(i, [block]));
    let error: unknown;
    try {
      planSheets(pages, 'one-sheet');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).message).toBe(
      'This file gives more rows than one Excel sheet can hold (1,048,576). Choose "One sheet per page" and try again. Nothing was added.',
    );
    expect(() => planSheets(pages.slice(0, 3), 'per-page')).not.toThrow();
  });

  it('sizes columns to their table content, within limits, not to the long text lines above the table', () => {
    const p = statementPage(0, [['01-04-2025', 'NEFT from Sample Buyer One against invoices', '', '', '5,000.00', '1,02,55,000.00']]);
    const [sheet] = planSheets([p], 'one-sheet').sheets;
    expect(sheet.columnWidths).toHaveLength(6);
    const [date, narration, ref, , , balance] = sheet.columnWidths;
    expect(date).toBeGreaterThanOrEqual(11); // "01-04-2025" and a little room
    expect(date).toBeLessThan(20); // not the bank's name above the table
    expect(narration).toBeGreaterThan(date);
    expect(ref).toBeGreaterThanOrEqual(6);
    expect(balance).toBeGreaterThanOrEqual(14);
    for (const w of sheet.columnWidths) expect(w).toBeLessThanOrEqual(60);
    // A sheet of text only: column A is wide enough to read the lines.
    const [letter] = planSheets([page(0, [text('A line of running text that is fairly long, as letters are.')])], 'one-sheet').sheets;
    expect(letter.columnWidths[0]).toBeGreaterThan(40);
  });

  it('the paced plan is the same plan', async () => {
    const pages = [statementPage(0, [['01-04-2025', 'Rent', '', '1,000.00', '', '9,000.00']]), page(1, [], false)];
    for (const mode of ['one-sheet', 'per-page'] as const) {
      expect(await planSheetsPaced(pages, mode, pacer())).toEqual(planSheets(pages, mode));
    }
  });
});

describe('safeSheetName', () => {
  it.each([
    ['Page_1', 'Page_1'],
    ['A/B:C*D?E[F]G\\H', 'A_B_C_D_E_F_G_H'],
    ["'quoted'", 'quoted'],
    ['', 'Sheet'],
    ['History', 'History_'],
    ['x'.repeat(40), 'x'.repeat(31)],
  ])('%s → %s', (name, safe) => {
    expect(safeSheetName(name, new Set())).toBe(safe);
  });
  it('never repeats a name, whatever the letter case', () => {
    const used = new Set<string>();
    expect([safeSheetName('Page', used), safeSheetName('page', used), safeSheetName('PAGE', used)]).toEqual(['Page', 'page (2)', 'PAGE (3)']);
  });
});

// ---- buildWorkbook, read back with exceljs ------------------------------------------------------------

async function readBack(bytes: Uint8Array) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return book;
}

describe('buildWorkbook', () => {
  it('writes numbers as numbers with the page\'s format, and text as text cells Excel will not reinterpret', async () => {
    const p = page(0, [
      text('Sample Traders (invented)'),
      table('aligned', [60, 300, 420, 530], [
        ['Particulars', 'Ref', 'Debit (Rs.)', 'Credit (Rs.)'],
        ['Share capital', '000101', '', '25,00,000.00'],
        ['Accumulated depreciation', '01-04-2025', '(1,25,000.00)', ''],
        ['Sundry debtors', '1234567890123456', '1,250.00 Dr', '12%'],
        ['Cash', '=SUM(A1)', '-500', '500-'],
      ]),
    ]);
    const plan = planSheets([p], 'one-sheet');
    const bytes = await buildWorkbook(plan.sheets, pacer());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]); // a zip
    const book = await readBack(bytes);
    expect(book.worksheets.map((w) => w.name)).toEqual(['All pages']);
    const ws = book.getWorksheet('All pages')!;
    const at = (ref: string) => ws.getCell(ref);

    expect(at('A1').value).toBe('Sample Traders (invented)');
    expect(at('A1').type).toBe(ExcelJS.ValueType.String);
    expect(at('D3').value).toBe(2500000);
    expect(at('D3').type).toBe(ExcelJS.ValueType.Number);
    expect(at('D3').numFmt).toBe('##","##","##0.00');
    expect(at('C4').value).toBe(-125000);
    expect(at('C4').numFmt).toBe('#","##","##0.00;(#","##","##0.00)');
    expect(at('C5').value).toBe(1250); // Dr: never turned negative
    expect(at('C5').numFmt).toBe('#,##0.00" Dr"');
    expect(at('C6').value).toBe(-500);
    expect(at('D6').value).toBe(-500);
    expect(at('D6').numFmt).toBe('0;0-');
    for (const [ref, shown] of [['B3', '000101'], ['B4', '01-04-2025'], ['B5', '1234567890123456'], ['D5', '12%'], ['B6', '=SUM(A1)']] as const) {
      expect(at(ref).type, ref).toBe(ExcelJS.ValueType.String);
      expect(at(ref).value, ref).toBe(shown);
      expect(at(ref).numFmt, ref).toBe('@');
    }
    // Empty cells stay empty.
    expect(at('C3').type).toBe(ExcelJS.ValueType.Null);
    // The file itself, as Excel reads it: the Indian format's commas are quoted literals, the text format is "@".
    const styles = await (await JSZip.loadAsync(bytes)).file('xl/styles.xml')!.async('string');
    expect(styles).toContain('formatCode="##&quot;,&quot;##&quot;,&quot;##0.00"');
    expect(styles).toContain('formatCode="#,##0.00&quot; Dr&quot;"');
    expect(styles).toContain('numFmtId="49"'); // Excel's built-in Text format, "@"
    // Column widths from the plan.
    expect(ws.getColumn(1).width).toBe(plan.sheets[0].columnWidths[0]);
  });

  it('one sheet per page, in page order, an empty page as an empty sheet', async () => {
    const plan = planSheets([page(0, [text('First')]), page(1, [], false), page(2, [table('ruled', [0, 100], [['a', '1']])])], 'per-page');
    const book = await readBack(await buildWorkbook(plan.sheets, pacer()));
    expect(book.worksheets.map((w) => w.name)).toEqual(['Page_1', 'Page_2', 'Page_3']);
    expect(book.getWorksheet('Page_2')!.rowCount).toBe(0);
    expect(book.getWorksheet('Page_3')!.getCell('B1').value).toBe(1);
  });

  it('holds no author name of a person and no cell value outside the sheets', async () => {
    const book = await readBack(await buildWorkbook(planSheets([page(0, [text('Only line')])], 'one-sheet').sheets, pacer()));
    expect(book.creator).toBe('ICAI VERA');
    expect(book.lastModifiedBy).toBe('ICAI VERA');
    expect(book.title ?? '').toBe('');
  });

  it('the packed hand-off (for the worker) writes the same cells; unsafe characters are marked, not dropped', async () => {
    const p = page(0, [text('Bad\u0001char and a lone \ud800 surrogate'), table('ruled', [0, 100, 200], [['Cash', '1,000.00', 'R1'], ['Bank', '(2,50,000.00)', '']])]);
    const plan = planSheets([p], 'per-page');
    const packed = await packSheets(plan.sheets, pacer());
    expect(packed.sheets).toHaveLength(1);
    const [s] = packed.sheets;
    expect(Array.from(s.rows)).toEqual([1, 2, 2, 2, 3, 3]);
    expect(Array.from(s.cols)).toEqual([1, 1, 2, 3, 1, 2]);
    expect(packed.formats).toEqual(['#,##0.00', '#","##","##0.00;(#","##","##0.00)']);
    expect(xmlSafe('a\u0000b\u000bc\td\ne')).toBe('a\ufffdb\ufffdc\td\ne');
    const book = await readBack(await writePacked(packed));
    const ws = book.getWorksheet('Page_1')!;
    expect(ws.getCell('A1').value).toBe('Bad\ufffdchar and a lone \ufffd surrogate');
    expect(ws.getCell('B3').value).toBe(-250000);
    expect(ws.getCell('C2').value).toBe('R1');
  });

  it('a Stop during the write ends it: what the pace throws comes out', async () => {
    const big = planSheets([page(0, [text(...Array.from({ length: 30000 }, (_, i) => `Line ${i}`))])], 'one-sheet');
    let calls = 0;
    const stop = new Error('stopped');
    const pace = () => {
      calls += 1;
      return calls > 3 ? Promise.reject(stop) : undefined;
    };
    await expect(buildWorkbook(big.sheets, pace)).rejects.toBe(stop);
  });
});
