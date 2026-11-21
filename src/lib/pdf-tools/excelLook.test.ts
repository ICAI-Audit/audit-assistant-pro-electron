// How the sheet looks for a table the page shows only by how its text lines up (T-064, quality round 2):
// shaded and bold heading rows, a heading lying over several columns, indented captions, the lines the page
// draws on its rows, pieces of one line of text set apart, and pictures. Hand-made words; every value invented.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, planSheets } from './excelBuild';
import { pageLayout, type PageWords, type Segment, type Word } from './layout';
import { encodePng, type PictureFile } from './pdfPictures';

const CH = 0.5;
function word(text: string, x: number, y: number, size = 10, more: Partial<Word> = {}): Word {
  return { text, x0: x, y0: y - 0.9 * size, x1: x + text.length * CH * size, y1: y + 0.25 * size, size, font: 'f', ...more };
}
function words(text: string, x: number, y: number, size = 10, more: Partial<Word> = {}): Word[] {
  const out: Word[] = [];
  let at = x;
  for (const part of text.split(' ')) {
    out.push(word(part, at, y, size, more));
    at += part.length * CH * size + 0.3 * size;
  }
  return out;
}
/** `text` ending at `right`. */
const ending = (text: string, right: number, y: number, more: Partial<Word> = {}): Word[] => {
  const probe = words(text, 0, y, 10, more);
  const width = probe[probe.length - 1].x1;
  return words(text, right - width, y, 10, more);
};
/** `text` with its middle at `mid`. */
const centredAt = (text: string, mid: number, y: number, more: Partial<Word> = {}): Word[] => {
  const probe = words(text, 0, y, 10, more);
  return words(text, mid - probe[probe.length - 1].x1 / 2, y, 10, more);
};
const page = (list: Word[]): PageWords => ({ pageIndex: 0, width: 595, height: 842, words: list });
const rule = (x0: number, x1: number, y: number): Segment => ({ x0, y0: y, x1, y1: y, color: '000000', width: 0.5 });
const BOLD = { bold: true } as const;

/** A statement with no ruled grid: a heading over its two amount columns, a shaded bold heading row, captions at two depths, a total between rules. */
function statement(): { list: Word[]; rules: Segment[]; shades: { x0: number; y0: number; x1: number; y1: number; color: string }[] } {
  const list: Word[] = [
    ...centredAt('Amounts in lakhs', 450, 100, BOLD),
    ...words('Particulars', 60, 120, 10, BOLD),
    ...words('Note', 290, 120, 10, BOLD),
    ...ending('31-03-2030', 420, 120, BOLD),
    ...ending('31-03-2029', 520, 120, BOLD),
    ...words('Current assets', 60, 140, 10, BOLD),
    ...words('Cash on hand', 74, 160),
    word('4', 296, 160),
    ...ending('1,200.00', 420, 160),
    ...ending('900.00', 520, 160),
    ...words('Balances with banks', 74, 180),
    word('5', 296, 180),
    ...ending('2,300.50', 420, 180),
    ...ending('1,100.00', 520, 180),
    ...words('Total', 60, 200, 10, BOLD),
    ...ending('3,500.50', 420, 200, BOLD),
    ...ending('2,000.00', 520, 200, BOLD),
  ];
  // A rule above the total under the two amount columns, and a double rule under it.
  const rules = [rule(360, 520, 187), rule(360, 520, 205), rule(360, 520, 207)];
  const shades = [{ x0: 55, y0: 108, x1: 525, y1: 125, color: 'DDE6F2' }];
  return { list, rules, shades };
}

async function sheetOf(list: Word[], rules: Segment[], extras: Parameters<typeof pageLayout>[2] = {}, pictures?: (PictureFile | null)[][]) {
  const layout = pageLayout(page(list), rules, extras);
  const { sheets, report } = planSheets([layout], 'one-sheet', pictures);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await buildWorkbook(sheets, () => undefined)).buffer as ArrayBuffer);
  const sheet = book.worksheets[0];
  const find = (value: string | number): ExcelJS.Cell => {
    let hit: ExcelJS.Cell | undefined;
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.master === cell && cell.value === value) hit = cell;
    }));
    if (!hit) throw new Error(`no cell ${String(value)}`);
    return hit;
  };
  const merges = Object.values((sheet as unknown as { _merges: Record<string, { model: { top: number; left: number; bottom: number; right: number } }> })._merges).map((m) => m.model);
  return { sheet, find, merges, report, layout };
}

describe('a table shown only by how its text lines up: the workbook', () => {
  it('keeps every amount a number in its own column, and text as text', async () => {
    const { list, rules, shades } = statement();
    const { find, report } = await sheetOf(list, rules, { shades });
    expect(report.tablesAligned).toBe(1);
    const cash = find('Cash on hand');
    const row = Number(cash.row);
    expect(find(1200).row).toBe(row);
    expect(find(900).row).toBe(row);
    expect(Number(find(900).col)).toBe(Number(find(1200).col) + 1);
    expect(find(3500.5).col).toBe(find(1200).col);
    expect(find(2000).col).toBe(find(900).col);
    expect(find('31-03-2030').type).toBe(ExcelJS.ValueType.String);
  });

  it('shades and bolds the heading row as the page does, the whole row through', async () => {
    const { list, rules, shades } = statement();
    const { sheet, find } = await sheetOf(list, rules, { shades });
    const head = find('Particulars');
    expect(head.font).toMatchObject({ bold: true });
    const filled = (cell: ExcelJS.Cell) => (cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? cell.fill.fgColor?.argb : undefined);
    for (let c = 1; c <= 4; c++) expect(filled(sheet.getRow(Number(head.row)).getCell(c))).toBe('FFDDE6F2');
    expect(filled(find('Cash on hand'))).toBeUndefined();
    expect(find('Total').font).toMatchObject({ bold: true });
    expect(find(3500.5).font).toMatchObject({ bold: true });
    expect(find(1200).font?.bold).toBeFalsy();
  });

  it('merges a heading lying over several columns across them, centred', async () => {
    const { list, rules, shades } = statement();
    const { find, merges } = await sheetOf(list, rules, { shades });
    const over = find('Amounts in lakhs');
    const first = Number(find(1200).col);
    expect(merges).toContainEqual({ top: Number(over.row), left: first, bottom: Number(over.row), right: first + 1 });
    expect(over.alignment).toMatchObject({ horizontal: 'center' });
    // A caption that only runs on over empty cells from its column's left edge is not merged.
    expect(merges.some((m) => m.top === Number(find('Current assets').row))).toBe(false);
  });

  it('keeps the depth of a caption as the cell indent, and sets a heading over amounts at their right edge', async () => {
    const { list, rules, shades } = statement();
    const { find } = await sheetOf(list, rules, { shades });
    expect(find('Cash on hand').alignment).toMatchObject({ indent: 2 });
    expect(find('Balances with banks').alignment).toMatchObject({ indent: 2 });
    expect(find('Total').alignment?.indent ?? 0).toBe(0);
    expect(find('31-03-2030').alignment).toMatchObject({ horizontal: 'right' });
  });

  it('does not set a caption right because another caption happens to end where it ends', async () => {
    const { list, rules, shades } = statement();
    // The same word twice, set in: both end at one place, as words of one length do.
    const twice = [...words('Loans', 88, 220), ...ending('10.00', 420, 220), ...ending('12.00', 520, 220), ...words('Loans', 88, 240), ...ending('20.00', 420, 240), ...ending('22.00', 520, 240)];
    const { sheet, find } = await sheetOf([...list, ...twice], rules, { shades });
    const cell = sheet.getRow(Number(find(10).row)).getCell(1);
    expect(cell.value).toBe('Loans');
    expect(cell.alignment?.horizontal ?? 'left').toBe('left');
    expect(cell.alignment).toMatchObject({ indent: 4 });
  });

  it('draws the lines the page draws on its rows as cell borders: one above a total, a double one under it', async () => {
    const { list, rules, shades } = statement();
    const { find, sheet } = await sheetOf(list, rules, { shades });
    expect(find(2300.5).border?.bottom?.style).toBe('thin');
    expect(find(1100).border?.bottom?.style).toBe('thin');
    expect(find('Balances with banks').border?.bottom).toBeUndefined();
    expect(find(3500.5).border?.bottom?.style).toBe('double');
    expect(find(2000).border?.bottom?.style).toBe('double');
    expect(sheet.getRow(Number(find(1200).row)).getCell(Number(find(1200).col)).border?.bottom).toBeUndefined();
  });
});

describe('column widths of a table shown by how its text lines up', () => {
  it('are the page\'s: a caption that runs on over the empty cell beside it does not widen its column', async () => {
    const { list, rules, shades } = statement();
    // In the place of the short caption between the heading row and the first row of figures.
    const long = words('Total of all the current assets shown above in this sample', 60, 140, 10, BOLD);
    expect(long[long.length - 1].x1).toBeGreaterThan(300);
    const { sheet, find, report } = await sheetOf([...list.filter((w) => !(w.y1 === 142.5 && w.x0 < 200)), ...long], rules, { shades });
    expect(report.tablesAligned).toBe(1);
    expect(Number(find('Total of all the current assets shown above in this sample').row)).toBe(Number(find('Cash on hand').row) - 1);
    expect(Number(find('Total of all the current assets shown above in this sample').col)).toBe(1);
    // Column A is 230 points wide on the page (60 to 290): about 43 characters, not the 60 the long caption would ask for.
    expect(sheet.getColumn(1).width).toBeGreaterThan(40);
    expect(sheet.getColumn(1).width).toBeLessThan(48);
  });
});

describe('a line of text with pieces set apart', () => {
  it('puts each piece in a cell of its own, in the column of the table it stands over', async () => {
    const { list, rules, shades } = statement();
    const top = [...words('Reference ZX-0001', 60, 60), ...ending('Dated 01-Jan-2030', 520, 60)];
    const { find } = await sheetOf([...top, ...list], rules, { shades });
    const left = find('Reference ZX-0001');
    const right = find('Dated 01-Jan-2030');
    expect(right.row).toBe(left.row);
    expect(Number(left.col)).toBe(1);
    expect(Number(right.col)).toBe(Number(find(900).col));
    expect(right.type).toBe(ExcelJS.ValueType.String);
  });

  it('keeps a plain line of text one cell in column A', async () => {
    const { list, rules, shades } = statement();
    const { find } = await sheetOf([...words('Statement of the sample company for the year', 60, 60), ...list], rules, { shades });
    expect(Number(find('Statement of the sample company for the year').col)).toBe(1);
  });
});

describe('pictures of the page', () => {
  const picture: PictureFile = { bytes: encodePng(new Uint8Array(4 * 4).fill(90), 4, 4, 1), type: 'png', width: 4, height: 4 };

  it('places a picture in the sheet at the rows and columns it stands at, in its size', async () => {
    const { list, rules, shades } = statement();
    // Beside the second amount column's rows of figures, under the table's heading.
    const { sheet, find } = await sheetOf(list, rules, { shades, pictures: [{ x0: 200, y0: 150, x1: 260, y1: 180 }] }, [[picture]]);
    const images = sheet.getImages();
    expect(images).toHaveLength(1);
    const { tl, ext } = images[0].range as unknown as { tl: { nativeRow: number; nativeCol: number }; ext: { width: number; height: number } };
    expect(tl.nativeRow).toBe(Number(find('Cash on hand').row) - 1);
    expect(tl.nativeCol).toBe(0);
    // 60 by 30 points are 80 by 40 pixels; the rows it stands beside are 20 points apart on the page and 15 on the
    // sheet, so it is made smaller in its proportions (round 3: it ends where it ends on the page).
    expect(ext.height).toBeLessThanOrEqual(40);
    expect(ext.height).toBeGreaterThanOrEqual(28);
    expect(ext.width / ext.height).toBeCloseTo(2, 1);
  });

  it('leaves out a picture that lies behind the text, and one whose file could not be made', async () => {
    const { list, rules, shades } = statement();
    const behind = { x0: 50, y0: 90, x1: 530, y1: 210, alpha: 0.1 };
    const { sheet } = await sheetOf(list, rules, { shades, pictures: [behind, { x0: 200, y0: 150, x1: 260, y1: 180 }] }, [[picture, null]]);
    expect(sheet.getImages()).toHaveLength(0);
  });
});
