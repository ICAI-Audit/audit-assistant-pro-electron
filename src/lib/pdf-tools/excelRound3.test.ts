// Quality round 3 (T-064): the sheet of a page, on hand-made words (every value invented).
import { describe, expect, it } from 'vitest';
import { planSheets } from './excelBuild';
import { pageLayout, type PageWords, type Word } from './layout';
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
const ending = (text: string, right: number, y: number): Word[] => {
  const probe = words(text, 0, y);
  return words(text, right - probe[probe.length - 1].x1, y);
};
const page = (list: Word[]): PageWords => ({ pageIndex: 0, width: 595, height: 842, words: list });
const textsOf = (list: Word[], pictures?: (PictureFile | null)[][], extras: Parameters<typeof pageLayout>[2] = {}) => {
  const { sheets } = planSheets([pageLayout(page(list), [], extras)], 'one-sheet', pictures);
  return { sheet: sheets[0], rows: sheets[0].rows.map((row) => row.map((c) => ('text' in c ? c.text : c.number.value))) };
};
/** Three rows of a statement from `y`, `pitch` apart: a caption and two amounts ending at 420 and 520. */
const figures = (y: number, pitch = 20): Word[] =>
  ['Cash on hand', 'Balances with banks', 'Deposits'].flatMap((caption, r) => [...words(caption, 60, y + r * pitch), ...ending(`${r + 1},200.00`, 420, y + r * pitch), ...ending(`${r + 2},100.50`, 520, y + r * pitch)]);

describe('a heading of two lines beside a heading of one line', () => {
  it('is one row of the sheet: the two lines in one cell, one under the other', () => {
    // "Particulars" stands at the middle height of the two lines "As at" / the date over each amount column.
    const list = [...ending('As at', 420, 105), ...ending('As at', 520, 105), ...words('Particulars', 60, 110), ...ending('31-03-2030', 420, 115), ...ending('31-03-2029', 520, 115), ...figures(140)];
    const { sheet, rows } = textsOf(list);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(['Particulars', 'As at\n31-03-2030', 'As at\n31-03-2029']);
    expect(sheet.rows[0][1]).toMatchObject({ look: { wrap: true } });
    expect(rows[1][0]).toBe('Cash on hand');
    expect(rows[1][1]).toBe(1200);
  });

  it('never joins two rows of amounts, however their lines lie between the lines of text beside them', () => {
    // Running text at the left, 11 points a line; a table at the right, 9 points a row: their lines fall between each
    // other all the way down, each within three quarters of a font size of the one before.
    const text = Array.from({ length: 6 }, (_, i) => words('The stores of the branch were counted', 60, 100 + i * 11, 8)).flat();
    const rowsOf = Array.from({ length: 7 }, (_, r) => [...words(`Item ${r + 1}`, 300, 104 + r * 9, 8), ...ending(`${r + 1},200.00`, 470, 104 + r * 9), ...ending(`${r + 2},100.50`, 540, 104 + r * 9)]).flat();
    const { rows } = textsOf([...text, ...rowsOf]);
    const amounts = rows.flatMap((row) => row.filter((v) => typeof v === 'number'));
    expect(amounts).toHaveLength(14);
    expect(rows.every((row) => row.every((v) => typeof v !== 'string' || !/\d,\d{3}\.\d\d\n/.test(v)))).toBe(true);
  });

  it('leaves rows that stand a full line apart as rows of their own', () => {
    const { rows } = textsOf(figures(140, 14));
    expect(rows).toHaveLength(3);
  });
});

describe('the foot of a page on the sheet', () => {
  it('stands after an empty row when it stands after a clear gap at the bottom of the page', () => {
    const { rows } = textsOf([...figures(140), ...words('130', 60, 810, 8), ...words('Sample Traders Limited', 440, 810, 8)]);
    expect(rows).toHaveLength(5);
    expect(rows[3]).toEqual([]);
    expect(rows[4].filter((t) => t !== '')).toEqual(['130', 'Sample Traders Limited']);
  });

  it('follows directly when it stands right under the table', () => {
    const { rows } = textsOf([...figures(140), ...words('Figures in lakhs', 60, 200, 8)]);
    expect(rows).toHaveLength(4);
  });
});

describe('a picture beside rows that are shorter on the sheet than on the page', () => {
  const picture: PictureFile = { bytes: encodePng(new Uint8Array(4 * 4).fill(90), 4, 4, 1), type: 'png', width: 4, height: 4 };

  it('is made smaller, in its proportions, so that it ends where it ends on the page and covers nothing under it', () => {
    // Rows 40 points apart on the page (15 on the sheet); the picture stands beside the first two, 60 points tall and wide.
    const list = [...figures(140, 40), ...words('Scan the code above', 230, 220, 8)];
    const { sheet } = textsOf(list, [[picture]], { pictures: [{ x0: 230, y0: 130, x1: 290, y1: 190 }] });
    expect(sheet.pictures).toHaveLength(1);
    const [p] = sheet.pictures!;
    // 60 points are 80 pixels; the two rows it stands beside are 30 points (40 pixels) on the sheet.
    expect(p.height).toBeLessThanOrEqual(42);
    expect(p.height).toBeGreaterThanOrEqual(20);
    expect(p.width).toBe(p.height);
  });

  it('keeps its size when the rows give it the room it has on the page', () => {
    const { sheet } = textsOf(figures(140, 15), [[picture]], { pictures: [{ x0: 230, y0: 131, x1: 260, y1: 161 }] });
    expect(sheet.pictures![0].height).toBe(40);
  });
});
