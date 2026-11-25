// The quality round (T-064): rules stated in terms of what a page draws, on hand-made words and lines.
import { describe, expect, it } from 'vitest';
import { pageLayout, type Line, type PageWords, type Segment, type Word } from './layout';
import JSZip from 'jszip';
import { buildDocx, planDocument } from './wordBuild';
import { cellParagraphs, isSetLine, paragraphLook, type TextMeasure } from './wordLook';

const CH = 0.5;
/** A word of `text` starting at x with its baseline at y. */
function word(text: string, x: number, y: number, size = 10, more: Partial<Word> = {}): Word {
  return { text, x0: x, y0: y - 0.9 * size, x1: x + text.length * CH * size, y1: y + 0.25 * size, size, font: 'f', ...more };
}
/** The words of `text` from x, a normal space apart. */
function words(text: string, x: number, y: number, size = 10, more: Partial<Word> = {}): Word[] {
  const out: Word[] = [];
  let at = x;
  for (const part of text.split(' ')) {
    out.push(word(part, at, y, size, more));
    at += part.length * CH * size + 0.3 * size;
  }
  return out;
}
const line = (list: Word[]): Line => ({ y0: Math.min(...list.map((w) => w.y0)), y1: Math.max(...list.map((w) => w.y1)), size: list[0].size, words: list });
const page = (list: Word[]): PageWords => ({ pageIndex: 0, width: 595, height: 842, words: list });
const rule = (x0: number, x1: number, y: number, color = '000000'): Segment => ({ x0, y0: y, x1, y1: y, color, width: 0.5 });
const endOf = (list: Word[]) => list[list.length - 1].x1;

describe('lines drawn under text', () => {
  it('takes a thin line just under a word as its underline, and a line well below the text as a rule', () => {
    const title = words('Statement of account', 100, 100, 12);
    const body = words('The balance is carried forward to the next period', 100, 140);
    const layout = pageLayout(page([...title, ...body]), [rule(100, endOf(title), 101.5), rule(100, 400, 112)]);
    expect(title.map((w) => w.underline)).toEqual([true, true, true]);
    expect(body.some((w) => w.underline)).toBe(false);
    expect(layout.rules).toEqual([expect.objectContaining({ x0: 100, x1: 400, y: 112 })]);
  });

  it('joins the pieces of one rule drawn cell by cell', () => {
    const text = words('Totals are shown in the last row of each page', 100, 100);
    const layout = pageLayout(page(text), [rule(100, 200, 130), rule(200, 300, 130), rule(300, 420, 130)]);
    expect(layout.rules).toEqual([expect.objectContaining({ x0: 100, x1: 420 })]);
  });
});

describe('a table shown by how its text lines up', () => {
  const rows = [
    ['Date', 'Narration', 'Amount'],
    ['01-04-2030', 'Opening stock', '1,200.00'],
    ['02-04-2030', 'Purchases', '850.00'],
    ['03-04-2030', 'Sales', '2,400.00'],
  ];
  const cells = (y0: number) =>
    rows.flatMap((row, r) => [word(row[0], 60, y0 + r * 20), ...words(row[1], 150, y0 + r * 20), word(row[2], 480 - row[2].length * 5, y0 + r * 20)]);

  it('gets a grid with the lines drawn under its rows; the shading of its heading stays a box of the page', () => {
    const list = cells(100);
    const layout = pageLayout(page(list), [rule(50, 490, 106), rule(50, 490, 166)], { shades: [{ x0: 50, y0: 88, x1: 490, y1: 106, color: 'DDE6F2' }] });
    const table = layout.blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []))[0];
    expect(table.source).toBe('aligned');
    const grid = table.grid!;
    expect(grid.cells.filter((c) => c.row === 0).map((c) => [c.text, c.borders.bottom?.color])).toEqual([
      ['Date', '000000'],
      ['Narration', '000000'],
      ['Amount', '000000'],
    ]);
    expect(grid.shaded).toBe(true);
    expect(grid.cells.filter((c) => c.row === 3).every((c) => c.borders.bottom !== null)).toBe(true);
    expect(grid.cells.filter((c) => c.row === 1).some((c) => c.borders.bottom)).toBe(false);
    // The rules are the table's own: none is left as a rule of the page.
    expect(layout.rules).toBeUndefined();
    expect(layout.fills).toEqual([{ x0: 50, y0: 88, x1: 490, y1: 106, color: 'DDE6F2' }]);
    expect(grid.xs[0]).toBe(50);
  });

  it('makes one row of lines that stand side by side: a date centred beside two lines of narration', () => {
    const list = [
      ...cells(100),
      ...words('Transfer to the head office', 150, 176),
      word('04-04-2030', 60, 182),
      word('75.00', 455, 182),
      ...words('against the March account', 150, 188),
      word('05-04-2030', 60, 208),
      ...words('Bank charges', 150, 208),
      word('12.00', 455, 208),
    ];
    const grid = pageLayout(page(list), []).blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []))[0].grid!;
    const row = grid.cells.filter((c) => c.text.includes('Transfer'));
    expect(row).toHaveLength(1);
    expect(row[0].lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['Transfer to the head office', 'against the March account']);
    expect(grid.cells.filter((c) => c.row === row[0].row).map((c) => c.text)).toEqual(['04-04-2030', 'Transfer to the head office against the March account', '75.00']);
  });
});

describe('columns that are not columns, and boxes that are not tables', () => {
  const amount = (text: string, right: number, y: number) => word(text, right - text.length * 5, y);

  it('reads a narrow column of list marks as part of the captions when other captions start where the marks start', () => {
    const rows: [string, string, string][] = [
      ['I.', 'Revenue from operations', '1,240.00'],
      ['II.', 'Other income', '84.00'],
      ['IV.', 'Cost of materials', '680.00'],
      ['V.', 'Finance costs', '12.50'],
      ['VI.', 'Other expenses', '195.00'],
    ];
    const list = rows.flatMap(([mark, caption, value], r) => [word(mark, 60, 100 + r * 20), ...words(caption, 82, 100 + r * 20), amount(value, 500, 100 + r * 20)]);
    // Two captions written from the marks' own left edge, a word space after the mark.
    list.push(...words('III. Total income of the year', 60, 200), amount('1,324.00', 500, 200), ...words('VII. Profit before tax', 60, 220), amount('436.50', 500, 220));
    const table = pageLayout(page(list), []).blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []))[0];
    expect(table.columns).toHaveLength(2);
    expect(table.rows.map((row) => row[0].text)).toEqual(['I. Revenue from operations', 'II. Other income', 'IV. Cost of materials', 'V. Finance costs', 'VI. Other expenses', 'III. Total income of the year', 'VII. Profit before tax']);
    expect(table.rows.map((row) => row[1].text)).toEqual(['1,240.00', '84.00', '680.00', '12.50', '195.00', '1,324.00', '436.50']);
  });

  it('keeps a column of serial numbers a column, also when a total is written from its left edge', () => {
    const rows: [string, string, string][] = [['1', 'Cement bags', '2,940.00'], ['2', 'Steel rods', '1,150.00'], ['3', 'River sand', '310.00'], ['4', 'Bricks', '95.00']];
    const list = rows.flatMap(([n, item, value], r) => [word(n, 60, 100 + r * 20), ...words(item, 82, 100 + r * 20), amount(value, 500, 100 + r * 20)]);
    list.push(...words('Total of the items above', 60, 180), amount('4,495.00', 500, 180), ...words('Total with the tax on them', 60, 200), amount('5,304.10', 500, 200));
    const table = pageLayout(page(list), []).blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []))[0];
    expect(table.columns).toHaveLength(3);
    expect(table.rows.slice(0, 4).map((row) => row[0].text)).toEqual(['1', '2', '3', '4']);
  });

  it('does not take a few lines round a statement for a table when one of its boxes holds two columns of amounts', () => {
    const rows: [string, string, string, string][] = [['Property and plant', '5', '1,836.24', '1,669.24'], ['Work in progress', '6', '177.48', '153.87'], ['Investment property', '7', '3.20', '0.17'], ['Other assets', '8', '41.31', '43.46']];
    const list = rows.flatMap(([caption, note, a, b], r) => [...words(caption, 66, 120 + r * 16), word(note, 330, 120 + r * 16), amount(a, 440, 120 + r * 16), amount(b, 530, 120 + r * 16)]);
    // A frame with one line down it: two boxes, the right one holding the note and both amounts.
    const frame: Segment[] = [rule(60, 540, 100), rule(60, 540, 180), ...[60, 320, 540].map((x) => ({ x0: x, y0: 100, x1: x, y1: 180 }))];
    const tables = pageLayout(page(list), frame).blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []));
    expect(tables).toHaveLength(1);
    expect(tables[0].source).toBe('aligned');
    expect(tables[0].rows.map((row) => row.map((c) => c.text))).toEqual(rows);
  });
});

describe('two columns of running text', () => {
  it('reads each column down, and keeps a drawn table in the column it stands in', () => {
    const para = 'the accounts of the branch were examined with the books and vouchers kept at the head office during the year';
    const wrap = (x: number, y: number, n: number) => Array.from({ length: n }, (_, i) => words(para.split(' ').slice(0, 7 + (i % 2)).join(' '), x, y + i * 14)).flat();
    const left = wrap(50, 100, 12);
    const right = [...wrap(320, 100, 4), ...wrap(320, 240, 4)];
    const table = [word('Item', 326, 172), word('Value', 446, 172), word('Stock', 326, 192), word('840', 446, 192)];
    const box: Segment[] = [
      ...[160, 180, 200].map((y) => rule(320, 540, y)),
      ...[320, 440, 540].map((x) => ({ x0: x, y0: 160, x1: x, y1: 200 })),
    ];
    const layout = pageLayout(page([...left, ...right, ...table]), box);
    const columns = layout.blocks.map((b) => [b.kind, b.column?.index]);
    expect(columns.filter(([, index]) => index === undefined)).toEqual([]);
    expect(layout.blocks.find((b) => b.kind === 'table')?.column).toMatchObject({ index: 1 });
    const order = layout.blocks.map((b) => b.column!.index);
    expect(order).toEqual([...order].sort());
    // In the Word plan the parts of the two columns carry where their columns lie.
    const { looks } = planDocument([layout]);
    const places = looks.looks.map((l) => l?.column?.index);
    expect(places.filter((i) => i === 0).length).toBeGreaterThan(0);
    expect(places.filter((i) => i === 1).length).toBeGreaterThan(1);
    expect(looks.looks.find((l) => l && 'table' in l)?.column).toMatchObject({ index: 1, rightStart: 320 });
  });
});

describe('how a paragraph looks', () => {
  const box = { x0: 50, x1: 550 };

  it('knows a line whose pieces are set apart from a line of running text', () => {
    expect(isSetLine(line([...words('Reference 14', 50, 100), ...words('Date 01-04-2030', 420, 100)]))).toBe(true);
    expect(isSetLine(line(words('The accounts were examined with the books', 50, 100)))).toBe(false);
    // A blank drawn as an underline makes a set line too.
    expect(isSetLine({ ...line(words('Signed by', 50, 100)), underlines: [[110, 300]] })).toBe(true);
  });

  it('sets the pieces of a set line at their places with tab stops, a blank as an underlined tab', () => {
    const left = words('Reference 14', 50, 100);
    const right = words('Date 01-04-2030', 420, 100);
    const look = paragraphLook([line([...left, ...right])], box)!;
    expect(look.tabs).toEqual([370]);
    expect(look.runs.map((r) => (r.tab ? '<tab>' : r.text))).toEqual(['Reference 14', '<tab>', 'Date 01-04-2030']);
    const signed = words('Signed by', 50, 130);
    const blank = paragraphLook([{ ...line(signed), underlines: [[endOf(signed) + 5, 300]] }], box)!;
    expect(blank.runs.filter((r) => r.tab).map((r) => r.underline)).toEqual([undefined, true]);
    expect(blank.tabs).toEqual([endOf(signed) + 5 - 50, 250]);
  });

  it('centres a line that sits in the middle of its box, sets an amount at the right edge right, and leaves the rest left', () => {
    const middle = words('Balance sheet', 0, 100);
    const shift = 300 - endOf(middle) / 2;
    expect(paragraphLook([line(middle.map((w) => ({ ...w, x0: w.x0 + shift, x1: w.x1 + shift })))], box)).toMatchObject({ align: 'center' });
    expect(paragraphLook([line([word('1,200.00', 504, 100)])], box)).toMatchObject({ align: 'right', right: 6 });
    const plain = paragraphLook([line(words('Cash in hand', 62, 100))], box)!;
    expect(plain.align).toBeUndefined();
    expect(plain.left).toBe(12);
  });

  it('keeps how wide the text is drawn: the size to the half point, the rest as a character scale', () => {
    const look = paragraphLook([line(words('Total income', 60, 100, 7.11, { stretch: 1.22, family: 'Trebuchet MS', bold: true, color: 'FF0000' }))], box)!;
    expect(look.runs).toEqual([{ text: 'Total income', family: 'Trebuchet MS', size: 7, bold: true, color: 'FF0000', scale: 124 }]);
  });

  it('flows the lines of a cell that run on to its edge as one paragraph with the line pitch of the page, and keeps short lines apart', () => {
    const cell = { x0: 100, y0: 90, x1: 300, y1: 160, turn: 0 as const };
    const flowing = [line(words('The stock was counted on the last day of', 104, 100, 8)), line(words('the year by two members of the staff', 104, 110, 8))];
    flowing[0].words.forEach((w, i, all) => {
      const by = ((296 - endOf(all)) * i) / (all.length - 1);
      w.x0 += by;
      w.x1 += by;
    });
    const one = cellParagraphs({ ...cell, lines: flowing });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ lines: 2, line: 10 });
    const apart = cellParagraphs({ ...cell, lines: [line(words('Sample Traders', 104, 100, 8)), line(words('12 Example Road', 104, 110, 8))] });
    expect(apart.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['Sample Traders', '12 Example Road']);
  });
});

// ---- lines kept, and a replacement font fitted to the page's widths (quality round 2) -------------------

/** A font whose letters are 0.6 of the font size wide (the hand-made words are 0.5 wide) and whose space is 0.3. */
const wider: TextMeasure = (text) => Array.from(text).reduce((n, ch) => n + (ch === ' ' ? 0.3 : 0.6), 0);

describe('a paragraph in a font of other widths', () => {
  const box = { x0: 50, x1: 550 };
  const three = () => [
    line(words('The accounts of the branch were examined with the', 50, 100)),
    line(words('books and vouchers kept at the head office during', 50, 114)),
    line(words('the year under report', 50, 128)),
  ];

  it('without a measure flows as before: one run, no line break', () => {
    const look = paragraphLook(three(), box)!;
    expect(look.runs.filter((r) => r.br)).toHaveLength(0);
    expect(look.runs).toHaveLength(1);
  });

  it('with a measure keeps each line of the page as a line, and narrows the letters to the page\'s width', () => {
    const look = paragraphLook(three(), box, undefined, wider)!;
    expect(look.lines).toBe(3);
    expect(look.runs.map((r) => (r.br ? '<br>' : r.text))).toEqual([
      'The accounts of the branch were examined with the', '<br>', 'books and vouchers kept at the head office during', '<br>', 'the year under report',
    ]);
    // Letters 0.5 wide on the page, 0.6 in the font Word has: 83 %. The first two lines end at one place, so the
    // paragraph runs from edge to edge and two hundredths are kept in hand (round 3): the short last line gets 82.
    expect(look.runs.filter((r) => !r.br).map((r) => r.scale)).toEqual([83, 83, 82]);
  });

  it('gives a centred line that is fitted a little room on both sides, so that it cannot wrap', () => {
    const title = words('Report of the working group', 0, 100);
    const by = 300 - endOf(title) / 2;
    const centred = line(title.map((w) => ({ ...w, x0: w.x0 + by, x1: w.x1 + by })));
    const look = paragraphLook([centred], box, undefined, wider)!;
    expect(look.align).toBe('center');
    expect(500 - look.left - look.right).toBeGreaterThanOrEqual(endOf(title) + 10);
    expect(look.left).toBeCloseTo(look.right, 3);
  });

  it('never lets a kept line come out wider than it is on the page (it would wrap)', () => {
    // Words set closer than the font's own space: the letters give way.
    const tight = (text: string, y: number) => {
      const list = words(text, 50, y);
      list.forEach((w, i) => {
        w.x0 -= i * 2;
        w.x1 -= i * 2;
      });
      return line(list);
    };
    const lines = [tight('The accounts of the branch were examined with the', 100), tight('books and vouchers kept at the head office during', 114), tight('the year', 128)];
    const look = paragraphLook(lines, box, undefined, wider)!;
    const first = look.runs[0];
    const natural = (wider(first.text, {}) * 10 * first.scale!) / 100;
    expect(natural).toBeLessThanOrEqual(endOf(lines[0].words) - 50 + 0.01);
    expect(first.scale).toBeLessThan(83);
  });

  it('fits a single line and each piece of a line set apart, so that no piece runs into the next', () => {
    const one = paragraphLook([line(words('Cash in hand', 62, 100))], box, undefined, wider)!;
    expect(one.runs).toEqual([expect.objectContaining({ text: 'Cash in hand', scale: 83 })]);
    const apart = paragraphLook([line([...words('Reference ZX-0001', 50, 100), ...words('Dated 01-Jan-2030', 400, 100)])], box, undefined, wider)!;
    expect(apart.runs.filter((r) => !r.tab).map((r) => [r.text, r.scale])).toEqual([['Reference ZX-0001', 83], ['Dated 01-Jan-2030', 83]]);
  });

  it('gives kept lines that are wider than their box room beyond it, so that they do not wrap: a heading set right over a narrow column', () => {
    // Two lines ending at 500 in a box from 450 to 502: the second starts 30 points left of the box.
    const to500 = (text: string, y: number) => {
      const by = 500 - endOf(words(text, 0, y));
      return line(words(text, by, y));
    };
    const lines = [to500('As at', 100), to500('31 March 2030', 114)];
    expect(lines[1].words[0].x0).toBeLessThan(440);
    const look = paragraphLook(lines, { x0: 450, x1: 502 }, undefined, wider)!;
    expect(look.align).toBe('right');
    expect(look.lines).toBe(2);
    expect(look.left).toBeLessThanOrEqual(lines[1].words[0].x0 - 450);
    // Lines that start left of their box and run on: room at the left too.
    const flowing = [line(words('The accounts of the branch were examined with the', 40, 100)), line(words('books and vouchers kept at the head office during', 40, 114)), line(words('the year under report', 40, 128))];
    const out = paragraphLook(flowing, { x0: 50, x1: 250 }, undefined, wider)!;
    expect(out.right).toBeLessThan(250 - endOf(flowing[1].words));
  });

  it('writes a numbered paragraph as one paragraph with a hanging indent: the number, a tab, the text', () => {
    const list = [
      word('1.', 60, 100), ...words('We have audited the accompanying statements of the', 84, 100),
      ...words('sample company, which comprise the balance sheet', 84, 114),
      ...words('and the notes for the year then ended', 84, 128),
      word('2.', 60, 156), ...words('In our opinion the statements give the information', 84, 156),
      ...words('required in the manner so required and give a fair', 84, 170),
      ...words('view of the state of affairs', 84, 184),
    ];
    const { parts, looks } = planDocument([pageLayout(page(list), [])], wider);
    expect(parts.map((p) => p.kind)).toEqual(['paragraph', 'paragraph']);
    const first = looks.looks[0]!;
    if (!('para' in first)) throw new Error('not a paragraph');
    expect(first.para.runs.slice(0, 3).map((r) => (r.tab ? '<tab>' : r.text))).toEqual(['1.', '<tab>', 'We have audited the accompanying statements of the']);
    expect(first.para.first).toBeCloseTo(-24, 0);
    expect(first.para.lines).toBe(3);
  });

  it('writes the line breaks and the character scale into the document', async () => {
    const list = three().flatMap((l) => l.words);
    const { parts, looks } = planDocument([pageLayout(page(list), [])], wider);
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.match(/<w:br\/>/g)).toHaveLength(2);
    expect(xml).toContain('<w:w w:val="83"/>');
  });
});

// ---- tables that stand beside other things (quality round 2) ---------------------------------------------

describe('a small drawn table standing beside its label', () => {
  /** A row of `n` boxes of 16 points from x, between y and y + 16, a letter in each. */
  const boxes = (x: number, y: number, letters: string): { words: Word[]; lines: Segment[] } => ({
    words: Array.from(letters).map((ch, i) => word(ch, x + i * 16 + 5, y + 12, 9)),
    lines: [rule(x, x + letters.length * 16, y), rule(x, x + letters.length * 16, y + 16), ...Array.from({ length: letters.length + 1 }, (_, i) => ({ x0: x + i * 16, y0: y, x1: x + i * 16, y1: y + 16 }))],
  });
  const first = boxes(200, 100, 'SAMPLE');
  const second = boxes(200, 130, 'QZXCV');
  const list = [...words('Name of the holder', 60, 112, 9), ...first.words, ...words('Code of the holder', 60, 142, 9), ...second.words, ...words('This form is a made-up sample for the tests of the converter', 60, 190, 9)];

  it('is placed at its own spot on the page, so that it stays beside the label and pushes nothing down', async () => {
    const layout = pageLayout(page(list), [...first.lines, ...second.lines]);
    const { parts, looks } = planDocument([layout]);
    const tables = looks.looks.flatMap((l) => (l && 'table' in l ? [l.table] : []));
    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.float)).toEqual([true, true]);
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
    const xml = await zip.file('word/document.xml')!.async('string');
    const placed = [...xml.matchAll(/<w:tblpPr [^>]*w:tblpX="(\d+)" w:tblpY="(\d+)"/g)].map((m) => [Number(m[1]) / 20, Number(m[2]) / 20]);
    expect(placed).toEqual([[200, 100], [200, 130]]);
    // The last line still stands 190 points down the page: what comes before it adds up to its place, the tables counting for nothing.
    expect(xml).toContain('made-up sample');
  });

  it('sets the text beside such a table at its own spot too (a frame), a piece standing between two tables on its own, and leaves the text below in the flow', async () => {
    // A date in three small tables with a stroke between them, a label before and a hint after.
    const d1 = boxes(200, 100, '01');
    const d2 = boxes(244, 100, '02');
    const all = [...words('Date of the form', 60, 112, 9), ...d1.words, word('/', 236, 112, 9), ...d2.words, ...words('DD / MM', 320, 112, 9), ...words('This form is a made-up sample for the tests of the converter', 60, 190, 9)];
    const { parts, looks } = planDocument([pageLayout(page(all), [...d1.lines, ...d2.lines])]);
    const framed = looks.looks.flatMap((l) => (l && 'para' in l && l.para.frame ? [[l.para.runs.map((r) => r.text).join(''), Math.round(l.para.frame.x)]] : []));
    expect(framed).toEqual([['Date of the form', 60], ['/', 236], ['DD / MM', 320]]);
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
    const xml = await zip.file('word/document.xml')!.async('string');
    const paragraphs = [...xml.matchAll(/<w:p>.*?<\/w:p>/gs)].map((m) => m[0]);
    const label = paragraphs.find((x) => x.includes('Date of the form'))!;
    // (Round 3: text set at its own spot is a box anchored to the page, 60 points from its left edge; Word wrapped the
    // line below round a frame.)
    expect(label).toMatch(/<wp:positionH relativeFrom="page"><wp:posOffset>762000<\/wp:posOffset>/);
    expect(label).toContain('<wps:txbx>');
    const below = paragraphs.find((x) => x.includes('made-up sample'))!;
    expect(xml).not.toContain('w:framePr');
    // The line below stands where it stands on the page: the space above it is counted from the page's top, the framed text and the tables taking none.
    // (Round 3: the gap above the first line after placed tables is an empty paragraph of its own, not that line's
    // space above: Word broke the line at the tables' left edge when its space above lay beside them.)
    const top = Number(/w:top="(\d+)"/.exec(xml)![1]) / 20;
    expect(/<w:spacing w:before="(\d+)"/.exec(below)![1]).toBe('0');
    const gap = paragraphs[paragraphs.indexOf(below) - 1];
    expect(gap).not.toContain('<w:t');
    const before = Number(/w:line="(\d+)"/.exec(gap)![1]) / 20;
    const line = Number(/w:line="(\d+)"/.exec(below)![1]) / 20;
    expect(top + before + line).toBeGreaterThan(190 + 0.21 * 9 - 2.5);
    expect(top + before + line).toBeLessThan(190 + 0.21 * 9 + 2.5);
  });

  it('leaves a table with nothing beside it in the flow of the page', () => {
    const alone = boxes(60, 100, 'SAMPLE');
    const layout = pageLayout(page([...alone.words, ...words('This form is a made-up sample for the tests of the converter', 60, 190, 9)]), alone.lines);
    const tables = planDocument([layout]).looks.looks.flatMap((l) => (l && 'table' in l ? [l.table] : []));
    expect(tables).toHaveLength(1);
    expect(tables[0].float).toBeUndefined();
  });
});

describe('what is written into attributes of the document (hardening)', () => {
  const xmlOf = async (list: Word[], segments: Segment[] = []) => {
    const { parts, looks } = planDocument([pageLayout(page(list), segments)]);
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
    return zip.file('word/document.xml')!.async('string');
  };

  it('escapes a font family for an attribute: quotes and markup cannot end it', async () => {
    const family = 'Bad" w:evil="1"><w:b/>&\'x';
    const xml = await xmlOf(words('Carried forward to the next period', 100, 100, 10, { family }));
    const safe = 'Bad&quot; w:evil=&quot;1&quot;&gt;&lt;w:b/&gt;&amp;&apos;x';
    expect(xml).toContain(`<w:rFonts w:ascii="${safe}" w:hAnsi="${safe}" w:cs="${safe}"/>`);
    expect(xml).not.toContain('w:evil="1"');
    expect(xml).not.toContain('<w:b/>');
    // Every attribute value of the body is free of raw quotes and angle brackets: the tags still parse one by one.
    for (const tag of xml.match(/<[^>]*>/g) ?? []) expect(tag).toMatch(/^<[/?]?[\w:]+(\s+[\w:]+="[^"<>]*")*\s*[/?]?>$/);
  });

  it('writes a colour only as six hex digits: anything else is left out, or black for a drawn line or box', async () => {
    const bad = 'FF0000"/><w:b/><w:color w:val="00FF00';
    const text = words('Carried forward to the next period', 100, 100, 10, { color: bad });
    const xml = await xmlOf(text, [rule(100, 400, 130, bad)]);
    expect(xml).not.toContain('FF0000"/>');
    expect(xml).not.toContain('<w:b/>');
    expect(xml).not.toContain('<w:color');
    expect(xml).toContain('<a:srgbClr val="000000"/>');
    // A good colour is written as it is.
    const good = await xmlOf(words('Carried forward to the next period', 100, 100, 10, { color: '1F4E79' }), [rule(100, 400, 130, 'C00000')]);
    expect(good).toContain('<w:color w:val="1F4E79"/>');
    expect(good).toContain('<a:srgbClr val="C00000"/>');
  });

  it('does not change text itself: quotes in a paragraph are written as they are', async () => {
    const xml = await xmlOf(words('He said "carried" & it\'s <done>', 100, 100));
    expect(xml).toContain('He said "carried" &amp; it\'s &lt;done&gt;');
  });
});
