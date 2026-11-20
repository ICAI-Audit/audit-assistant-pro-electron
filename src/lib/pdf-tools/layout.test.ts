import { describe, expect, it } from 'vitest';
import {
  COLUMN_CLUSTER_PT,
  COLUMN_WIDEN_PT,
  MAX_COLUMNS,
  ROW_TOLERANCE_PT,
  SCANNED_MAX_CHARS,
  columnStarts,
  countsAsScanned,
  gridFromLines,
  groupLines,
  lineText,
  pageLayout,
  ruledTables,
  wordsText,
  type Block,
  type PageWords,
  type Segment,
  type Table,
  type Word,
} from './layout';
import { CONVERT_FIXTURE_NAMES, convertFixture, convertFixtureExpected } from './testConvertPdf';

// Helvetica-like test words: every character 0.5 em wide, the box from 0.9 em above the baseline to 0.25 below.
const word = (text: string, x0: number, baseline: number, size = 10): Word => ({ text, x0, y0: baseline - 0.9 * size, x1: x0 + text.length * size * 0.5, y1: baseline + 0.25 * size, size, font: 'F1' });
/** Words of `text` from `x`, a quarter em between them; returns the words. */
function phrase(text: string, x: number, baseline: number, size = 10): Word[] {
  const out: Word[] = [];
  for (const t of text.split(' ')) {
    out.push(word(t, x, baseline, size));
    x += t.length * size * 0.5 + 0.25 * size;
  }
  return out;
}
/** Words of `text` ending at `xRight`. */
function rightPhrase(text: string, xRight: number, baseline: number, size = 10): Word[] {
  const width = text.split(' ').reduce((s, t) => s + t.length * size * 0.5, 0) + (text.split(' ').length - 1) * 0.25 * size;
  return phrase(text, xRight - width, baseline, size);
}
const page = (words: Word[], width = 595, height = 842): PageWords => ({ pageIndex: 0, width, height, words });
const texts = (table: Table): string[][] => table.rows.map((row) => row.map((c) => c.text));
const tables = (blocks: readonly Block[]): Table[] => blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []));
const textLines = (blocks: readonly Block[]): string[] => blocks.flatMap((b) => (b.kind === 'text' ? b.lines.map(lineText) : []));
const wordsIn = (blocks: readonly Block[]): Word[] => blocks.flatMap((b) => (b.kind === 'text' ? b.lines.flatMap((l) => l.words) : b.table.rows.flatMap((row) => row.flatMap((c) => c.words))));

describe('the constants of design section 13', () => {
  it('are the numbers the design records', () => {
    expect([ROW_TOLERANCE_PT, COLUMN_CLUSTER_PT, COLUMN_WIDEN_PT, MAX_COLUMNS, SCANNED_MAX_CHARS]).toEqual([4, 18, 6, 80, 20]);
  });
});

describe('groupLines', () => {
  it('puts words whose tops are within 4 pt on one line, left to right, and others on their own', () => {
    const lines = groupLines([word('balance', 200, 103.5), word('Opening', 100, 100), word('Next', 100, 114), word('row', 130, 114.4)]);
    expect(lines.map(lineText)).toEqual(['Opening balance', 'Next row']);
    expect(lines[0].y0).toBeCloseTo(91, 5);
    expect(lines[0].y1).toBeCloseTo(106, 5);
    expect(lines[0].size).toBe(10);
  });

  it('keeps tops more than 4 pt apart on separate lines', () => {
    expect(groupLines([word('one', 100, 100), word('two', 150, 104.5)]).length).toBe(2);
  });

  it('keeps lines of small print apart although their tops are under 4 pt apart', () => {
    const lines = groupLines([...phrase('first line', 50, 100, 3), ...phrase('second line', 50, 103.6, 3)]);
    expect(lines.map(lineText)).toEqual(['first line', 'second line']);
  });

  it('joins a large word to the small ones on its baseline, and gives the size most of the text has', () => {
    const lines = groupLines([word('Rs.', 50, 100, 18), ...phrase('twelve thousand only', 90, 100, 9)]);
    expect(lines.map(lineText)).toEqual(['Rs. twelve thousand only']);
    expect(lines[0].size).toBe(9);
  });

  it('leaves out words of white space and changes no word', () => {
    const hindi = word('लेखा', 60, 100);
    const lines = groupLines([word('  ', 10, 100), hindi]);
    expect(lines).toHaveLength(1);
    expect(lines[0].words[0]).toBe(hindi);
  });

  it('gives no line for no word', () => {
    expect(groupLines([])).toEqual([]);
  });
});

describe('columnStarts', () => {
  const rows = [
    [...phrase('Cash in hand', 60, 100), ...rightPhrase('37,600.00', 420, 100)],
    [...phrase('Plant and machinery', 60, 116), ...rightPhrase('18,45,000.00', 420, 116), ...rightPhrase('5.00', 530, 116)],
    [...phrase('Stock', 60, 132), ...rightPhrase('12,34,56,789.00', 530, 132)],
  ];

  it('finds a text column and two right-aligned amount columns, each starting at its longest amount', () => {
    const starts = columnStarts(groupLines(rows.flat()));
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBeCloseTo(60, 5);
    expect(starts[1]).toBeCloseTo(420 - '18,45,000.00'.length * 5, 5);
    expect(starts[2]).toBeCloseTo(530 - '12,34,56,789.00'.length * 5, 5);
  });

  it('does not make a column of each word of a cell', () => {
    expect(columnStarts(groupLines([...phrase('Provision for doubtful debts', 60, 100), ...phrase('Reserves and surplus', 60, 116)]))).toHaveLength(1);
  });

  it('keeps two columns apart under a heading that lies over both', () => {
    // The heading starts left of the debit column and ends inside the credit column.
    const heading = phrase('Amount in rupees for the year', 330, 84);
    const lines = groupLines([...heading, ...rows.flat()]);
    const starts = columnStarts(lines);
    expect(starts.map((x) => Math.round(x))).toEqual([60, 360, 455]);
    expect(texts(gridFromLines(lines))).toEqual([
      ['', 'Amount in rupees for the year', ''],
      ['Cash in hand', '37,600.00', ''],
      ['Plant and machinery', '18,45,000.00', '5.00'],
      ['Stock', '', '12,34,56,789.00'],
    ]);
  });

  it('keeps an amount in its column when it is so long that it reaches under the text of other rows', () => {
    // The long amount ends at the amounts' right edge (300) and starts at 180, under the other rows' narrations.
    const words = [
      ...phrase('Cash deposit at the branch counter', 40, 100), ...rightPhrase('1,200.00', 300, 100),
      ...phrase('Rent paid for the godown', 40, 116), ...rightPhrase('90.00', 300, 116),
      ...phrase('Sale', 40, 132), ...rightPhrase('12,34,56,78,90,12,345.00', 300, 132),
      ...phrase('Salary transfer for the month', 40, 148), ...rightPhrase('45,000.00', 300, 148),
    ];
    expect(words.find((w) => w.text.startsWith('12,34'))?.x0).toBe(180);
    expect(texts(gridFromLines(groupLines(words)))).toEqual([
      ['Cash deposit at the branch counter', '1,200.00'],
      ['Rent paid for the godown', '90.00'],
      ['Sale', '12,34,56,78,90,12,345.00'],
      ['Salary transfer for the month', '45,000.00'],
    ]);
  });

  it('puts a long amount by its right edge, though it starts exactly where another column starts', () => {
    const words = [
      ...phrase('Cash deposit', 40, 100), ...phrase('R101', 180, 100), ...rightPhrase('1,200.00', 300, 100),
      ...phrase('Rent paid', 40, 116), ...phrase('R102', 180, 116), ...rightPhrase('90.00', 300, 116),
      ...phrase('Sale', 40, 132), ...rightPhrase('12,34,56,78,90,12,345.00', 300, 132),
      ...phrase('Salary', 40, 148), ...phrase('R104', 180, 148), ...rightPhrase('45,000.00', 300, 148),
    ];
    expect(texts(gridFromLines(groupLines(words)))).toEqual([
      ['Cash deposit', 'R101', '1,200.00'],
      ['Rent paid', 'R102', '90.00'],
      ['Sale', '', '12,34,56,78,90,12,345.00'],
      ['Salary', 'R104', '45,000.00'],
    ]);
  });

  it('reads a column written with a wide space on a few lines as one column', () => {
    const words = [
      ...phrase('Cash', 60, 100), ...phrase('paid', 130, 100), ...rightPhrase('10.00', 420, 100),
      ...phrase('Cheque paid to the supplier', 60, 116), ...rightPhrase('20.00', 420, 116),
      ...phrase('Transfer to the head office', 60, 132), ...rightPhrase('30.00', 420, 132),
      ...phrase('Rent of the godown premises', 60, 148), ...rightPhrase('40.00', 420, 148),
    ];
    expect(columnStarts(groupLines(words))).toHaveLength(2);
  });

  it('never gives more than 80 columns', () => {
    const many: Word[] = [];
    for (let c = 0; c < 130; c++) for (let r = 0; r < 3; r++) many.push(word('9', 20 + c * 30, 100 + r * 16));
    const lines = groupLines(many);
    const starts = columnStarts(lines);
    expect(starts.length).toBeLessThanOrEqual(MAX_COLUMNS);
    expect(starts.length).toBeGreaterThan(40);
    const table = gridFromLines(lines);
    expect(table.columns.length).toBe(starts.length);
    expect(table.rows.every((row) => row.length === starts.length)).toBe(true);
    expect(table.rows.flatMap((row) => row.flatMap((c) => c.words))).toHaveLength(many.length);
  });

  it('gives nothing for no line', () => {
    expect(columnStarts([])).toEqual([]);
  });
});

describe('gridFromLines', () => {
  it('puts every amount in its own column, whatever its length', () => {
    const words = [
      ...phrase('Particulars', 60, 84), ...rightPhrase('Debit', 420, 84), ...rightPhrase('Credit', 530, 84),
      ...phrase('Share capital', 60, 100), ...rightPhrase('25,00,000.00', 530, 100),
      ...phrase('Cash in hand', 60, 116), ...rightPhrase('5.00', 420, 116),
      ...phrase('Plant and machinery', 60, 132), ...rightPhrase('18,45,00,000.00', 420, 132),
      ...phrase('Accumulated depreciation', 60, 148), ...rightPhrase('(1,25,000.00)', 420, 148),
      ...phrase('Total', 60, 164), ...rightPhrase('18,43,75,005.00', 420, 164), ...rightPhrase('25,00,000.00', 530, 164),
    ];
    const table = gridFromLines(groupLines(words));
    expect(table.source).toBe('aligned');
    expect(texts(table)).toEqual([
      ['Particulars', 'Debit', 'Credit'],
      ['Share capital', '', '25,00,000.00'],
      ['Cash in hand', '5.00', ''],
      ['Plant and machinery', '18,45,00,000.00', ''],
      ['Accumulated depreciation', '(1,25,000.00)', ''],
      ['Total', '18,43,75,005.00', '25,00,000.00'],
    ]);
    expect(table.y0).toBeCloseTo(75, 5);
    expect(table.y1).toBeCloseTo(166.5, 5);
    expect(table.rows[2][1].words.map((w) => w.text)).toEqual(['5.00']);
  });

  it('keeps a second line of a narration in the narration column, as a row of its own', () => {
    const words = [
      ...phrase('01-04-2025', 40, 100), ...phrase('NEFT from Sample Buyer Two against', 110, 100), ...rightPhrase('1,200.00', 520, 100),
      ...phrase('invoices 114 and 115', 110, 111),
      ...phrase('02-04-2025', 40, 127), ...phrase('Cash deposit', 110, 127), ...rightPhrase('90.00', 520, 127),
    ];
    expect(texts(gridFromLines(groupLines(words)))).toEqual([
      ['01-04-2025', 'NEFT from Sample Buyer Two against', '1,200.00'],
      ['', 'invoices 114 and 115', ''],
      ['02-04-2025', 'Cash deposit', '90.00'],
    ]);
  });

  it('cuts a narration that runs up to the amount beside it', () => {
    const words = [
      ...phrase('Cash deposit', 40, 100), ...rightPhrase('1,200.00', 300, 100),
      ...phrase('Rent paid', 40, 116), ...rightPhrase('90.00', 300, 116),
      // The narration ends 2 pt before its amount: one run of words on the line.
      ...phrase('A long narration that reaches up to the amounts', 40, 132), ...rightPhrase('45,000.00', 300, 132),
    ];
    const last = words.filter((w) => w.y0 === 123);
    expect(last[last.length - 2].x1).toBeGreaterThan(last[last.length - 1].x0 - 6);
    expect(texts(gridFromLines(groupLines(words)))).toEqual([
      ['Cash deposit', '1,200.00'],
      ['Rent paid', '90.00'],
      ['A long narration that reaches up to the amounts', '45,000.00'],
    ]);
  });

  it('does not draw a number at the end of a narration into the amount beside it', () => {
    const words = [
      ...phrase('Cash deposit', 40, 100), ...rightPhrase('1,200.00', 300, 100),
      ...phrase('Rent paid', 40, 116), ...rightPhrase('90.00', 300, 116),
      ...phrase('Paid against the bills numbered nos 114 and 115', 40, 132), ...rightPhrase('45,000.00', 300, 132),
      ...phrase('Paid to the supplier against their bill 2,116', 40, 148), ...rightPhrase('Rs. 7,500.00', 300, 148),
    ];
    expect(texts(gridFromLines(groupLines(words)))).toEqual([
      ['Cash deposit', '1,200.00'],
      ['Rent paid', '90.00'],
      ['Paid against the bills numbered nos 114 and 115', '45,000.00'],
      ['Paid to the supplier against their bill 2,116', 'Rs. 7,500.00'],
    ]);
  });

  it('carries on the columns of another page: a longer amount still lands in its own column', () => {
    const first = groupLines([
      ...phrase('Cash deposit', 40, 100), ...rightPhrase('0.00', 300, 100), ...rightPhrase('5.00', 400, 100),
      ...phrase('Rent paid', 40, 116), ...rightPhrase('1.00', 300, 116), ...rightPhrase('4.00', 400, 116),
    ]);
    const columns = columnStarts(first);
    expect(columns).toHaveLength(3);
    const next = groupLines([
      ...phrase('Machinery bought', 40, 100), ...rightPhrase('12,34,56,789.00', 300, 100), ...rightPhrase('98,76,54,321.00', 400, 100),
      ...phrase('Stock', 40, 116), ...rightPhrase('7.00', 300, 116), ...rightPhrase('8.00', 400, 116),
    ]);
    const table = gridFromLines(next, columns);
    expect(table.columns).toEqual(columns);
    expect(texts(table)).toEqual([
      ['Machinery bought', '12,34,56,789.00', '98,76,54,321.00'],
      ['Stock', '7.00', '8.00'],
    ]);
  });

  it('passes Hindi and right-to-left words through unchanged, a right-to-left cell joined in its reading order', () => {
    const hindi = phrase('नकद जमा', 40, 100);
    const urdu = phrase('نقد جمع', 40, 116);
    const table = gridFromLines(groupLines([...hindi, ...rightPhrase('1,200.00', 300, 100), ...urdu, ...rightPhrase('90.00', 300, 116)]));
    expect(texts(table)).toEqual([
      ['नकद जमा', '1,200.00'],
      ['جمع نقد', '90.00'],
    ]);
    expect(table.rows[0][0].words).toEqual(hindi);
    expect(table.rows[1][0].words).toEqual(urdu);
    expect(wordsText(urdu)).toBe('جمع نقد');
  });

  it('gives an empty table for no line', () => {
    expect(gridFromLines([])).toEqual({ source: 'aligned', y0: 0, y1: 0, columns: [], rows: [] });
  });
});

describe('ruledTables', () => {
  it('reads the ruled statement: every row and cell as drawn, on each of its three pages', async () => {
    const { pages, segments } = await convertFixture('statement-ruled');
    const expected = await convertFixtureExpected('statement-ruled');
    expect(pages).toHaveLength(3);
    pages.forEach((p, i) => {
      const found = ruledTables(p, segments[i]);
      expect(found).toHaveLength(1);
      expect(found[0].source).toBe('ruled');
      expect(found[0].columns).toEqual([36, 96, 300, 360, 430, 500]);
      expect(texts(found[0])).toEqual(expected.rows[i]);
      expect(found[0].y0).toBe(100);
    });
  });

  it('gives a merged heading cell to its first cell and keeps a two-line narration in one cell', async () => {
    const { pages, segments } = await convertFixture('merged-heading');
    const expected = await convertFixtureExpected('merged-heading');
    const found = ruledTables(pages[0], segments[0]);
    expect(found).toHaveLength(1);
    expect(texts(found[0])).toEqual(expected.rows[0]);
    expect(texts(found[0])[3]).toEqual(['Purchases during the year from registered and unregistered dealers', '32,10,500.00', '']);
  });

  it('reads a table on a turned page, where every inner line is drawn twice', async () => {
    const { pages, segments } = await convertFixture('rotated-page');
    const expected = await convertFixtureExpected('rotated-page');
    expect([pages[0].width, pages[0].height]).toEqual([842, 595]);
    const found = ruledTables(pages[0], segments[0]);
    expect(found).toHaveLength(1);
    expect(found[0].columns).toEqual([60, 300, 420]);
    expect(texts(found[0])).toEqual(expected.rows[0]);
  });

  it('finds no ruled table where the only lines are rules above and below a total', async () => {
    const { pages, segments } = await convertFixture('trial-balance');
    expect(segments[0].length).toBe(2);
    expect(ruledTables(pages[0], segments[0])).toEqual([]);
  });

  it('does not take a box round a paragraph, an underline or a crossing pair of lines for a table', () => {
    const p = page([...phrase('A note in a box', 60, 100), ...phrase('with a second line', 60, 114)]);
    const box: Segment[] = [{ x0: 50, y0: 80, x1: 300, y1: 80 }, { x0: 50, y0: 125, x1: 300, y1: 125 }, { x0: 50, y0: 80, x1: 50, y1: 125 }, { x0: 300, y0: 80, x1: 300, y1: 125 }];
    expect(ruledTables(p, box)).toEqual([]);
    expect(ruledTables(p, [{ x0: 60, y0: 103, x1: 140, y1: 103 }])).toEqual([]);
    expect(ruledTables(p, [{ x0: 50, y0: 107, x1: 300, y1: 107 }, { x0: 150, y0: 80, x1: 150, y1: 125 }])).toEqual([]);
    expect(ruledTables(p, [])).toEqual([]);
    // A box with a line down it, and text on one side of the line only.
    expect(ruledTables(p, [...box, { x0: 250, y0: 80, x1: 250, y1: 125 }])).toEqual([]);
  });

  it('reads one row per line of text where only the columns are ruled', () => {
    const words: Word[] = [];
    const data = [['01-04-2025', 'Cash deposit', '1,200.00'], ['02-04-2025', 'Rent paid', '90.00'], ['03-04-2025', 'Salary transfer', '45,000.00']];
    data.forEach((row, r) => words.push(...phrase(row[0], 44, 112 + r * 14), ...phrase(row[1], 124, 112 + r * 14), ...rightPhrase(row[2], 396, 112 + r * 14)));
    words.push(...phrase('Date', 44, 94), ...phrase('Narration', 124, 94), ...rightPhrase('Amount', 396, 94));
    const lines: Segment[] = [
      { x0: 40, y0: 82, x1: 400, y1: 82 }, { x0: 40, y0: 100, x1: 400, y1: 100 }, { x0: 40, y0: 150, x1: 400, y1: 150 },
      ...[40, 120, 300, 400].map((x) => ({ x0: x, y0: 82, x1: x, y1: 150 })),
    ];
    const found = ruledTables(page(words), lines);
    expect(found).toHaveLength(1);
    expect(texts(found[0])).toEqual([['Date', 'Narration', 'Amount'], ...data]);
  });

  it('keeps every amount in its column where only the heading row is boxed', () => {
    const words: Word[] = [...phrase('Date', 44, 94), ...phrase('Narration', 124, 94), ...rightPhrase('Amount', 396, 94)];
    const data = [['01-04-2025', 'Cash deposit', '1,200.00'], ['02-04-2025', 'Rent paid', '90.00'], ['03-04-2025', 'Salary transfer', '45,000.00'], ['04-04-2025', 'GST payment', '3,10,000.00']];
    data.forEach((row, r) => words.push(...phrase(row[0], 44, 112 + r * 14), ...phrase(row[1], 124, 112 + r * 14), ...rightPhrase(row[2], 396, 112 + r * 14)));
    // A frame, a rule under the heading, and column lines in the heading row only.
    const lines: Segment[] = [
      { x0: 40, y0: 82, x1: 400, y1: 82 }, { x0: 40, y0: 100, x1: 400, y1: 100 }, { x0: 40, y0: 164, x1: 400, y1: 164 },
      { x0: 40, y0: 82, x1: 40, y1: 164 }, { x0: 400, y0: 82, x1: 400, y1: 164 },
      { x0: 120, y0: 82, x1: 120, y1: 100 }, { x0: 300, y0: 82, x1: 300, y1: 100 },
    ];
    const found = ruledTables(page(words), lines);
    expect(found).toHaveLength(1);
    expect(texts(found[0])).toEqual([['Date', 'Narration', 'Amount'], ...data]);
  });

  it('reads a title row across the whole table as one cell', () => {
    const words = [...phrase('Stock summary for March', 150, 94), ...phrase('Steel rods', 44, 112), ...rightPhrase('1,250', 396, 112), ...phrase('Cement bags', 44, 130), ...rightPhrase('840', 396, 130)];
    const lines: Segment[] = [
      ...[82, 100, 118, 136].map((y) => ({ x0: 40, y0: y, x1: 400, y1: y })),
      { x0: 40, y0: 82, x1: 40, y1: 136 }, { x0: 400, y0: 82, x1: 400, y1: 136 }, { x0: 300, y0: 100, x1: 300, y1: 136 },
    ];
    expect(ruledTables(page(words), lines).map(texts)).toEqual([[['Stock summary for March', ''], ['Steel rods', '1,250'], ['Cement bags', '840']]]);
  });

  it('reads a table with no outer border, and two tables on one page top to bottom', () => {
    const grid = (top: number, label: string): { words: Word[]; lines: Segment[] } => ({
      words: [...phrase(`${label} one`, 44, top + 12), ...phrase('two', 204, top + 12), ...phrase('three', 44, top + 30), ...phrase('four', 204, top + 30)],
      // One line across and one down: the border is not drawn, the lines' ends are the table's edges.
      lines: [{ x0: 40, y0: top + 18, x1: 360, y1: top + 18 }, { x0: 200, y0: top, x1: 200, y1: top + 36 }, { x0: 40, y0: top + 36, x1: 360, y1: top + 36 }],
    });
    const a = grid(300, 'lower');
    const b = grid(100, 'upper');
    const found = ruledTables(page([...a.words, ...b.words]), [...a.lines, ...b.lines]);
    expect(found.map(texts)).toEqual([
      [['upper one', 'two'], ['three', 'four']],
      [['lower one', 'two'], ['three', 'four']],
    ]);
  });
});

describe('pageLayout', () => {
  it('reads the ruled statement as text, the table, then the page number', async () => {
    const { pages, segments } = await convertFixture('statement-ruled');
    const expected = await convertFixtureExpected('statement-ruled');
    pages.forEach((p, i) => {
      const layout = pageLayout(p, segments[i]);
      expect(layout).toMatchObject({ pageIndex: i, width: 595, height: 842, hasText: true });
      expect(layout.blocks.map((b) => b.kind)).toEqual(['text', 'text', 'table', 'text']);
      expect(tables(layout.blocks).map((t) => t.source)).toEqual(['ruled']);
      expect(texts(tables(layout.blocks)[0])).toEqual(expected.rows[i]);
      expect(textLines(layout.blocks)).toEqual(expected.text[i]);
    });
  });

  it('reads the same statement without its lines as an aligned table: every amount in its column', async () => {
    const { pages, segments } = await convertFixture('statement-plain');
    const expected = await convertFixtureExpected('statement-plain');
    pages.forEach((p, i) => {
      expect(segments[i]).toEqual([]);
      const layout = pageLayout(p, segments[i]);
      const found = tables(layout.blocks);
      expect(found.map((t) => t.source)).toEqual(['aligned']);
      expect(texts(found[0])).toEqual(expected.lineRows[i]);
      expect(found[0].columns).toHaveLength(6);
      expect(textLines(layout.blocks)).toEqual(expected.text[i]);
    });
  });

  it('gives the plain statement the same columns on every page when the first page carries them on', async () => {
    const { pages } = await convertFixture('statement-plain');
    const expected = await convertFixtureExpected('statement-plain');
    const first = tables(pageLayout(pages[0], []).blocks)[0];
    pages.slice(1).forEach((p, k) => {
      const own = tables(pageLayout(p, []).blocks)[0];
      const lines = groupLines(own.rows.flatMap((row) => row.flatMap((c) => c.words)));
      expect(texts(gridFromLines(lines, first.columns))).toEqual(expected.lineRows[k + 1]);
    });
  });

  it('reads the trial balance: bracketed and Indian-grouped amounts in the right column, headings as text', async () => {
    const { pages, segments } = await convertFixture('trial-balance');
    const expected = await convertFixtureExpected('trial-balance');
    const layout = pageLayout(pages[0], segments[0]);
    expect(layout.blocks.map((b) => b.kind)).toEqual(['text', 'text', 'table', 'text']);
    const table = tables(layout.blocks)[0];
    expect(table.source).toBe('aligned');
    expect(texts(table)).toEqual(expected.rows[0]);
    expect(textLines(layout.blocks)).toEqual(expected.text[0]);
    expect(texts(table)[8]).toEqual(['Accumulated depreciation', '(1,25,000.00)', '']);
  });

  it('reads a two-column letter down the left column, then down the right', async () => {
    const { pages, segments } = await convertFixture('two-column-letter');
    const expected = await convertFixtureExpected('two-column-letter');
    const layout = pageLayout(pages[0], segments[0]);
    expect(tables(layout.blocks)).toEqual([]);
    expect(textLines(layout.blocks)).toEqual(expected.text[0]);
    // The title, the line across, the two columns, the closing line.
    expect(layout.blocks).toHaveLength(5);
  });

  it('reads the merged-heading table without its lines: the heading lines are rows, no amount moves', async () => {
    const { pages } = await convertFixture('merged-heading');
    const expected = await convertFixtureExpected('merged-heading');
    const layout = pageLayout(pages[0], []);
    const found = tables(layout.blocks);
    expect(found.map((t) => t.source)).toEqual(['aligned']);
    expect(texts(found[0])).toEqual(expected.lineRows[0]);
    expect(textLines(layout.blocks)).toEqual(expected.text[0]);
  });

  it('reads the turned page in display coordinates', async () => {
    const { pages, segments } = await convertFixture('rotated-page');
    const expected = await convertFixtureExpected('rotated-page');
    const layout = pageLayout(pages[0], segments[0]);
    expect(layout.blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text']);
    expect(texts(tables(layout.blocks)[0])).toEqual(expected.rows[0]);
    expect(textLines(layout.blocks)).toEqual(expected.text[0]);
  });

  it('keeps every word of every fixture page exactly once', async () => {
    for (const name of CONVERT_FIXTURE_NAMES) {
      const { pages, segments } = await convertFixture(name);
      pages.forEach((p, i) => {
        for (const lines of [segments[i], []]) {
          const got = wordsIn(pageLayout(p, lines).blocks);
          expect(got).toHaveLength(p.words.length);
          expect(new Set(got).size).toBe(p.words.length);
        }
      });
    }
  });

  it('leaves plain paragraphs as text, a block for each, and a heading apart from its text', () => {
    const words = [
      ...phrase('Notes to the accounts', 60, 80, 14),
      ...phrase('The firm keeps its books on the accrual basis and', 60, 110), ...phrase('values its stock at cost or market price.', 60, 124),
      ...phrase('Fixed assets are shown at cost less depreciation', 60, 150), ...phrase('charged on the written down value.', 60, 164),
    ];
    const layout = pageLayout(page(words), []);
    expect(layout.blocks.map((b) => b.kind)).toEqual(['text', 'text', 'text']);
    expect(layout.blocks.map((b) => (b.kind === 'text' ? b.lines.length : 0))).toEqual([1, 2, 2]);
    expect(layout.blocks[0].kind === 'text' && layout.blocks[0].lines[0].size).toBe(14);
  });

  it('does not make a table of two paragraph lines that happen to have a wide space', () => {
    const words = [
      ...phrase('The count starts after the', 60, 100), ...phrase('shop closes for the day', 200, 100),
      ...phrase('and is finished before', 60, 114), ...phrase('it opens again on Monday', 185, 114),
      ...phrase('with two members of staff at each rack.', 60, 128),
    ];
    expect(tables(pageLayout(page(words), []).blocks)).toEqual([]);
  });

  it('puts words drawn turned on the page last, so they cannot disturb a table', async () => {
    const { pages, segments } = await convertFixture('statement-ruled');
    const expected = await convertFixtureExpected('statement-ruled');
    const mark: Word = { text: 'DRAFT', x0: 150, y0: 200, x1: 450, y1: 600, size: 60, font: 'F9' };
    const layout = pageLayout({ ...pages[0], words: [mark, ...pages[0].words] }, segments[0]);
    expect(texts(tables(layout.blocks)[0])).toEqual(expected.rows[0]);
    const last = layout.blocks[layout.blocks.length - 1];
    expect(last.kind === 'text' && last.lines.map(lineText)).toEqual(['DRAFT']);
  });

  it('says a page without a word has no text', () => {
    expect(pageLayout(page([]), [])).toEqual({ pageIndex: 0, width: 595, height: 842, hasText: false, blocks: [] });
    expect(pageLayout(page([word(' ', 10, 10)]), []).hasText).toBe(false);
  });

  it('lays out a dense page well within one turn of the window', () => {
    // 70 rows of 12 columns in small print, each cell its own box: 840 cells, 1,120 words, 3,360 line pieces.
    const words: Word[] = [];
    const lines: Segment[] = [];
    for (let r = 0; r < 70; r++) {
      for (let c = 0; c < 12; c++) {
        const x = 20 + c * 46;
        const y = 30 + r * 11;
        if (c < 2) words.push(...phrase(`item ${r} ${c}`, x + 2, y + 8, 5));
        else words.push(...rightPhrase(`${(r + 1) * (c + 3)},${100 + c}.${10 + r}`, x + 44, y + 8, 5));
        lines.push({ x0: x, y0: y, x1: x + 46, y1: y }, { x0: x, y0: y + 11, x1: x + 46, y1: y + 11 }, { x0: x, y0: y, x1: x, y1: y + 11 }, { x0: x + 46, y0: y, x1: x + 46, y1: y + 11 });
      }
    }
    const dense = page(words);
    const time = (segments: Segment[]) => {
      pageLayout(dense, segments);
      const runs = 5;
      const start = performance.now();
      for (let k = 0; k < runs; k++) pageLayout(dense, segments);
      return (performance.now() - start) / runs;
    };
    const ruled = time(lines);
    const aligned = time([]);
    console.info(`pageLayout on a dense page (${words.length} words, ${lines.length} line pieces): ruled ${ruled.toFixed(1)} ms, aligned ${aligned.toFixed(1)} ms`);
    expect(tables(pageLayout(dense, lines).blocks)[0].rows).toHaveLength(70);
    expect(tables(pageLayout(dense, []).blocks)[0].columns).toHaveLength(12);
    expect(ruled).toBeLessThan(150);
    expect(aligned).toBeLessThan(150);
  });
});

describe('countsAsScanned', () => {
  it('is true under 20 characters that are not white space, false from 20', () => {
    expect(countsAsScanned(page([]))).toBe(true);
    expect(countsAsScanned(page([word('Page', 10, 10), word('3', 40, 10)]))).toBe(true);
    expect(countsAsScanned(page([word('1234567890', 10, 10), word('123456789', 80, 10), word('   ', 200, 10)]))).toBe(true);
    expect(countsAsScanned(page([word('1234567890', 10, 10), word('1234567890', 80, 10)]))).toBe(false);
  });

  it('counts a character outside the basic plane once', () => {
    expect(countsAsScanned(page([word('😀'.repeat(19), 10, 10)]))).toBe(true);
    expect(countsAsScanned(page([word('😀'.repeat(20), 10, 10)]))).toBe(false);
  });
});
