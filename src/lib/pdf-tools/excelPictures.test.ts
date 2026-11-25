// A picture of the page never hides text on the sheet (T-068). Hand-made words; every value invented.
// The check is made on the sheet as planned: where each picture stands, in pixels, against where the text of
// each cell is written (at its cell's left edge, its middle or its right edge, as the cell is set).
import { describe, expect, it } from 'vitest';
import { planSheets, type CellPlan, type SheetPlan } from './excelBuild';
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
const ending = (text: string, right: number, y: number, more: Partial<Word> = {}): Word[] => {
  const probe = words(text, 0, y, 10, more);
  return words(text, right - probe[probe.length - 1].x1, y, 10, more);
};
const page = (list: Word[]): PageWords => ({ pageIndex: 0, width: 595, height: 842, words: list });
const BOLD = { bold: true } as const;
const picture: PictureFile = { bytes: encodePng(new Uint8Array(4 * 4).fill(90), 4, 4, 1), type: 'png', width: 4, height: 4 };
type Box = { x0: number; y0: number; x1: number; y1: number; alpha?: number };

/** The rows of a trial balance from `y`, 16 points apart: an account and its debit or credit, ending at 420 and 530. */
const TRIAL: [string, string, string][] = [
  ['Account', 'Debit', 'Credit'],
  ['Capital account', '', '12,00,000.00'],
  ['Plant and machinery', '8,40,000.00', ''],
  ['Stock in trade', '2,10,500.50', ''],
  ['Balance with banks', '1,49,499.50', ''],
  ['Total', '12,00,000.00', '12,00,000.00'],
];
const trial = (y: number): Word[] =>
  TRIAL.flatMap(([account, debit, credit], r) => {
    const more = r === 0 || account === 'Total' ? BOLD : {};
    return [...words(account, 60, y + r * 16, 10, more), ...(debit ? ending(debit, 420, y + r * 16, more) : []), ...(credit ? ending(credit, 530, y + r * 16, more) : [])];
  });

function sheetOf(list: Word[], boxes: Box[], rules: Segment[] = []): SheetPlan {
  const { sheets } = planSheets([pageLayout(page(list), rules, { pictures: boxes })], 'one-sheet', [boxes.map(() => picture)]);
  return sheets[0];
}

const textOf = (cell: CellPlan | undefined): string => (!cell ? '' : 'text' in cell ? cell.text : String(cell.number.value));
/** Excel's pixels for a column width in characters of the default font, and for a row height in points. */
const colPx = (sheet: SheetPlan, c: number) => Math.trunc((sheet.columnWidths[c] ?? 8.43) * 7 + 5);
const rowPx = (sheet: SheetPlan, r: number) => ((sheet.rowHeights?.[r] ?? 15) * 96) / 72;
const sum = (n: number, of: (k: number) => number) => {
  let total = 0;
  for (let k = 0; k < Math.floor(n); k++) total += of(k);
  return total + (n - Math.floor(n)) * of(Math.floor(n));
};

/** The texts of the cells that a picture of the sheet stands over. */
function hidden(sheet: SheetPlan): string[] {
  const out: string[] = [];
  for (const p of sheet.pictures ?? []) {
    const px0 = sum(p.col, (c) => colPx(sheet, c));
    const py0 = sum(p.row, (r) => rowPx(sheet, r));
    sheet.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        const text = textOf(cell);
        if (text === '') return;
        const merge = (sheet.merges ?? []).find(([r0, c0]) => r0 === r && c0 === c);
        const lastCol = merge ? merge[3] : c;
        const lastRow = merge ? merge[2] : r;
        const x0 = sum(c, (k) => colPx(sheet, k));
        const x1 = sum(lastCol + 1, (k) => colPx(sheet, k));
        const y0 = sum(r, (k) => rowPx(sheet, k));
        const y1 = sum(lastRow + 1, (k) => rowPx(sheet, k));
        const look = cell.look ?? {};
        const chars = Math.max(...text.split('\n').map((t) => t.length)) + ('number' in cell ? 3 : 0);
        const wide = chars * 7 * ((look.size ?? 11) / 11) * (look.bold ? 1.1 : 1);
        const align = look.align ?? ('number' in cell ? 'right' : 'left');
        const t0 = align === 'right' ? x1 - wide : align === 'center' ? (x0 + x1 - wide) / 2 : x0 + (look.indent ?? 0) * 9;
        const overX = Math.min(px0 + p.width, t0 + wide) - Math.max(px0, t0);
        const overY = Math.min(py0 + p.height, y1) - Math.max(py0, y0);
        if (overX > 1 && overY > 1) out.push(text);
      });
    });
  }
  return out;
}

const rowOf = (sheet: SheetPlan, text: string): number => sheet.rows.findIndex((row) => row.some((cell) => textOf(cell) === text));
const colOf = (sheet: SheetPlan, text: string): number => sheet.rows[rowOf(sheet, text)].findIndex((cell) => textOf(cell) === text);

describe('a picture that stands left of text in the same row of the page', () => {
  // A logo 40 points square at the top left; the name and the period to its right, over a trial balance.
  const heading = [...words('Sample Traders Private Limited', 110, 58, 12, BOLD), ...words('Trial balance as at 31 March 2030', 110, 74)];
  const logo: Box = { x0: 60, y0: 40, x1: 100, y1: 80 };

  it('hides no text of the sheet: over a table, the logo and the name are both readable', () => {
    const sheet = sheetOf([...heading, ...trial(120)], [logo]);
    expect(sheet.pictures).toHaveLength(1);
    expect(rowOf(sheet, 'Sample Traders Private Limited')).toBeGreaterThanOrEqual(0);
    expect(hidden(sheet)).toEqual([]);
  });

  it('stands in rows of its own above that text, in its size, and the text stays in its column', () => {
    const sheet = sheetOf([...heading, ...trial(120)], [logo]);
    const [p] = sheet.pictures!;
    const name = rowOf(sheet, 'Sample Traders Private Limited');
    // 40 points are 53 pixels: three rows of 15 points hold them.
    expect(p.height).toBe(53);
    expect(p.width).toBe(53);
    expect(p.row).toBe(0);
    expect(name).toBe(3);
    expect(sheet.rows.slice(0, 3).every((row) => row.every((cell) => textOf(cell) === ''))).toBe(true);
    expect(colOf(sheet, 'Sample Traders Private Limited')).toBe(0);
    expect(rowOf(sheet, 'Trial balance as at 31 March 2030')).toBe(4);
    // The table follows as before: its amounts are numbers in their columns.
    const total = sheet.rows[rowOf(sheet, 'Total')];
    expect(total.slice(1).map((cell) => ('number' in cell ? cell.number.value : null))).toEqual([1200000, 1200000]);
  });

  it('hides no text on a page that has no table', () => {
    const list = [...heading, ...words('Registered office: 14 Sample Road, Sample Town', 110, 90, 8), ...words('The stores of the branch were counted on the last day of the year.', 60, 140)];
    const sheet = sheetOf(list, [logo]);
    expect(sheet.pictures).toHaveLength(1);
    expect(hidden(sheet)).toEqual([]);
    expect(sheet.pictures![0].row).toBeLessThan(rowOf(sheet, 'Sample Traders Private Limited'));
  });

  it('hides no text when it stands left of the table itself, outside its first column', () => {
    // The logo stands in the page's margin, left of the name and of the table; the sheet has no column there.
    const sheet = sheetOf([...words('Sample Traders Private Limited', 60, 58, 12, BOLD), ...trial(120)], [{ x0: 15, y0: 40, x1: 55, y1: 80 }]);
    expect(sheet.pictures).toHaveLength(1);
    expect(hidden(sheet)).toEqual([]);
  });
});

describe('a picture that lies over the start of a word', () => {
  it('hides no text of the sheet', () => {
    // The seal covers the first letters of the name (one word's middle is not under it: it is no ground behind the text).
    const sheet = sheetOf([...words('Sample Traders Private Limited', 60, 58, 12, BOLD), ...trial(120)], [{ x0: 40, y0: 44, x1: 70, y1: 66 }]);
    expect(sheet.pictures).toHaveLength(1);
    expect(hidden(sheet)).toEqual([]);
  });
});

describe('a picture that stands left of the text of a table row, in the same column', () => {
  it('hides no text: it stands in rows of its own above the table', () => {
    // A mark 12 points square in the margin before the caption "Plant and machinery": the sheet has no column there,
    // so the mark and the caption would both start at the left edge of column A.
    const sheet = sheetOf([...words('Sample Traders Private Limited', 60, 58, 12, BOLD), ...trial(120)], [{ x0: 44, y0: 142, x1: 56, y1: 154 }]);
    expect(sheet.pictures).toHaveLength(1);
    expect(hidden(sheet)).toEqual([]);
    expect(sheet.pictures![0].row).toBeLessThan(rowOf(sheet, 'Account'));
    expect(sheet.pictures![0].row).toBeGreaterThan(rowOf(sheet, 'Sample Traders Private Limited'));
    // The table's rows stay together under it.
    expect(rowOf(sheet, 'Total') - rowOf(sheet, 'Account')).toBe(5);
  });

  it('stays beside its row when the sheet sets the caption in after it, as the page does', () => {
    // The mark stands at the column's left edge and the caption "Plant and machinery" 21 points in (three indent steps).
    const list = trial(120).map((w) => (w.y1 > 142 && w.y0 < 154 && w.x0 < 300 ? { ...w, x0: w.x0 + 21, x1: w.x1 + 21 } : w));
    const sheet = sheetOf(list, [{ x0: 60, y0: 142, x1: 72, y1: 154 }]);
    expect(sheet.pictures).toHaveLength(1);
    expect(Math.floor(sheet.pictures![0].row)).toBe(rowOf(sheet, 'Plant and machinery'));
    expect(sheet.rows[rowOf(sheet, 'Plant and machinery')][0].look?.indent).toBe(3);
    expect(hidden(sheet)).toEqual([]);
  });
});

describe('a picture that hides nothing where it stands', () => {
  it('stays beside its row: a logo at the right of the name', () => {
    const sheet = sheetOf([...words('Sample Traders Private Limited', 60, 58, 12, BOLD), ...trial(120)], [{ x0: 470, y0: 46, x1: 530, y1: 62 }]);
    expect(sheet.pictures).toHaveLength(1);
    expect(sheet.pictures![0].row).toBe(rowOf(sheet, 'Sample Traders Private Limited'));
    expect(rowOf(sheet, 'Sample Traders Private Limited')).toBe(0);
    expect(hidden(sheet)).toEqual([]);
  });

  it('stays beside its rows: a picture in the empty stretch between the captions and the amounts', () => {
    const sheet = sheetOf(trial(120), [{ x0: 230, y0: 142, x1: 260, y1: 170 }]);
    expect(sheet.pictures).toHaveLength(1);
    expect(Math.floor(sheet.pictures![0].row)).toBe(rowOf(sheet, 'Plant and machinery'));
    expect(hidden(sheet)).toEqual([]);
  });
});

describe('a picture the page shows behind its text', () => {
  it('is left out of the sheet as before: a faint ground, and a band with the words of a heading over it', () => {
    const list = [...words('Sample Traders Private Limited', 60, 58, 12, BOLD), ...trial(120)];
    const ground: Box = { x0: 100, y0: 100, x1: 500, y1: 220, alpha: 0.1 };
    const band: Box = { x0: 40, y0: 40, x1: 555, y1: 70 };
    const sheet = sheetOf(list, [ground, band]);
    expect(sheet.pictures ?? []).toHaveLength(0);
    expect(rowOf(sheet, 'Sample Traders Private Limited')).toBe(0);
  });
});
