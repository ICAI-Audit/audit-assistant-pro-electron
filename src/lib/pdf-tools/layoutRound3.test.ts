// Quality round 3 (T-064): how a page is read, on hand-made words and lines (invented text and figures).
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { planSheets } from './excelBuild';
import { pageLayout, type PageWords, type Segment, type Word } from './layout';
import { buildDocx, planDocument } from './wordBuild';
import { paragraphLook } from './wordLook';

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
/** An amount ending at `end`. */
const amount = (text: string, end: number, y: number, size = 10): Word => word(text, end - text.length * CH * size, y, size);
const page = (list: Word[]): PageWords => ({ pageIndex: 0, width: 595, height: 842, words: list });
const across = (x0: number, x1: number, y: number): Segment => ({ x0, y0: y, x1, y1: y, color: '000000', width: 0.5 });
const down = (x: number, y0: number, y1: number): Segment => ({ x0: x, y0, x1: x, y1, color: '000000', width: 0.5 });
const tablesOf = (list: Word[], segments: Segment[]) => pageLayout(page(list), segments).blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []));

describe('a box drawn round one column of a statement', () => {
  const captions = ['Sales of goods', 'Other income', 'Cost of materials', 'Staff cost', 'Finance cost', 'Net result'];
  const ys = captions.map((_, r) => 100 + r * 16);
  const list = () => captions.flatMap((caption, r) => [...words(caption, 60, ys[r]), word(`${r + 11}`, 290, ys[r]), amount(`${r + 1},2${r}0.50`, 400, ys[r]), amount(`${r + 2},1${r}5.25`, 520, ys[r])]);
  /**
   * A line under each row, drawn in pieces column by column (a gap between the pieces), and a frame round the first
   * column of amounts; the piece under the note numbers ends at the frame.
   */
  const pieces = (frame: boolean): Segment[] => [
    ...[88, ...ys.map((y) => y + 5)].flatMap((y) => [across(56, 264, y), across(270, 328, y), across(330, 404, y), across(410, 524, y)]),
    ...(frame ? [down(330, 88, ys[5] + 5), down(404, 88, ys[5] + 5)] : []),
  ];

  it('is not a table of its own when its rows run on outside it and its lines go on at the same heights: the statement stays one table', () => {
    const tables = tablesOf(list(), pieces(true));
    expect(tables).toHaveLength(1);
    expect(tables[0].source).toBe('aligned');
    expect(tables[0].rows).toHaveLength(6);
    expect(tables[0].rows[2].map((c) => c.text)).toEqual(['Cost of materials', '13', '3,220.50', '4,125.25']);
  });

  it('stays a drawn table when nothing of its rows stands outside it', () => {
    const inside = captions.flatMap((caption, r) => [word(caption.split(' ')[0], 334, ys[r]), amount(`${r + 1},2${r}0`, 520, ys[r])]);
    const grid: Segment[] = [...[88, ...ys.map((y) => y + 5)].map((y) => across(330, 524, y)), down(330, 88, ys[5] + 5), down(404, 88, ys[5] + 5), down(524, 88, ys[5] + 5)];
    const tables = tablesOf(inside, grid);
    expect(tables).toHaveLength(1);
    expect(tables[0].source).toBe('ruled');
  });

  it('stays a drawn table beside its labels when its lines do not go on outside it (boxes of a form)', () => {
    const labels = ['Name', 'Street', 'Town'];
    const rows = [100, 116, 132];
    const form = labels.flatMap((label, r) => [word(label, 60, rows[r] + 12, 9), word('A', 205, rows[r] + 12, 9), word('B', 221, rows[r] + 12, 9), word('C', 237, rows[r] + 12, 9)]);
    const grid: Segment[] = [...[100, 116, 132, 148].map((y) => across(200, 248, y)), ...[200, 216, 232, 248].map((x) => down(x, 100, 148))];
    const tables = tablesOf(form, grid);
    expect(tables.filter((t) => t.source === 'ruled')).toHaveLength(1);
  });
});

describe('a page whose text is drawn turned (a wide table set along the page)', () => {
  const rows = [
    ['Class of asset', 'Opening', 'Additions', 'Closing'],
    ['Buildings', '1,200.00', '150.00', '1,350.00'],
    ['Machines', '2,400.00', '75.50', '2,475.50'],
    ['Vehicles', '310.25', '20.00', '330.25'],
  ];
  /** The table as it reads on a page of 842 by 595, then every word turned with the page: drawn on a page of 595 by 842, reading from the bottom up (90) or from the top down (270). */
  const upright = (): Word[] => rows.flatMap((row, r) => [...words(row[0], 80, 120 + r * 18), amount(row[1], 420, 120 + r * 18), amount(row[2], 560, 120 + r * 18), amount(row[3], 700, 120 + r * 18)]);
  const turned = (turn: 90 | 270): Word[] =>
    upright().map((w) => (turn === 90 ? { ...w, x0: w.y0, x1: w.y1, y0: 842 - w.x1, y1: 842 - w.x0, turn } : { ...w, x0: 595 - w.y1, x1: 595 - w.y0, y0: w.x0, y1: w.x1, turn }));

  for (const turn of [90, 270] as const) {
    it(`is read as the page turned so that its text is upright (${turn}): a wide page, the table read row by row`, () => {
      const layout = pageLayout(page(turned(turn)), []);
      expect([layout.width, layout.height, layout.turned]).toEqual([842, 595, turn]);
      const tables = layout.blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []));
      expect(tables).toHaveLength(1);
      expect(tables[0].rows.map((row) => row.map((c) => c.text))).toEqual(rows);
      const first = tables[0].rows[0][0].words[0];
      expect([first.turn ?? 0, Math.round(first.x0), Math.round(first.y1)]).toEqual([0, 80, 123]);
    });
  }

  it('turns the lines and the pictures of such a page with it', () => {
    // A line under the heading row on the upright page from x 76 to 704 at y 126: drawn down the page at x 126.
    const layout = pageLayout(page(turned(90)), [{ x0: 126, y0: 842 - 704, x1: 126, y1: 842 - 76, color: '000000', width: 0.5 }], { pictures: [{ x0: 20, y0: 700, x1: 60, y1: 800 }] });
    const table = layout.blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []))[0];
    expect(table.grid!.cells.filter((c) => c.row === 0).every((c) => c.borders.bottom !== null)).toBe(true);
    expect(layout.pictures).toEqual([expect.objectContaining({ x0: 42, y0: 20, x1: 142, y1: 60, turn: 90 })]);
  });

  it('leaves a page as it is when only some of its words are turned (a label up the margin)', () => {
    const body = upright().map((w) => ({ ...w, x0: w.x0 * 0.6, x1: w.x1 * 0.6 }));
    const layout = pageLayout(page([...body, { ...word('Sample', 20, 0), x0: 20, x1: 30, y0: 300, y1: 340, turn: 90 }]), []);
    expect([layout.width, layout.height, layout.turned]).toEqual([595, 842, undefined]);
  });
});

describe('a label drawn up the side of the page', () => {
  const body = Array.from({ length: 6 }, (_, i) => words('The accounts of the branch were examined with the books', 80, 100 + i * 14)).flat();
  /** "Income details" reading from the bottom up at x 40 to 50: "Income" below (y 240 to 270), "details" above it (y 202 to 237). */
  const label: Word[] = [
    { text: 'Income', x0: 40, x1: 50, y0: 240, y1: 270, size: 8, font: 'f', turn: 90 },
    { text: 'details', x0: 40, x1: 50, y0: 202, y1: 237, size: 8, font: 'f', turn: 90 },
  ];

  it('is one line read the way it is drawn, last on the page', () => {
    const layout = pageLayout(page([...label.slice().reverse(), ...body]), []);
    const last = layout.blocks[layout.blocks.length - 1];
    if (last.kind !== 'text') throw new Error('not text');
    expect(last.lines).toHaveLength(1);
    expect([last.lines[0].turn, last.lines[0].words.map((w) => w.text).join(' ')]).toEqual([90, 'Income details']);
  });

  it('stands turned at its own place in the document (a box of text anchored to the page, its text turned), taking no room in the flow and never a page of its own', async () => {
    const { parts, looks, report } = planDocument([pageLayout(page([...label, ...body]), [])]);
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toContain('<w:tbl>');
    const box = /<w:drawing>(?:(?!<\/w:drawing>).)*<wps:txbx>.*?<\/w:drawing>/s.exec(xml)![0];
    expect(box).toContain('vert="vert270"');
    const [x, y] = [...box.matchAll(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/g)].map((m) => Number(m[1]) / 12700);
    expect(x).toBeGreaterThan(36);
    expect(x).toBeLessThanOrEqual(40);
    expect(y).toBeGreaterThan(190);
    expect(y).toBeLessThanOrEqual(202);
    expect([...box.matchAll(/<w:t [^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')).toBe('Income details');
    expect(report.tables).toBe(0);
  });

  it('is one cell of the sheet, its words in the order they read', () => {
    const { sheets } = planSheets([pageLayout(page([...label, ...body]), [])], 'one-sheet');
    const texts = sheets[0].rows.flatMap((row) => row.map((c) => ('text' in c ? c.text : '')));
    expect(texts).toContain('Income details');
  });
});

describe('small text raised or lowered right after a word', () => {
  /** "As at 31st March 2030": the "st" in 6 points, its baseline 4 points above the line's, touching the 31. */
  const dated = (): Word[] => {
    const start = words('As at 31', 60, 100);
    const st: Word = { text: 'st', x0: start[2].x1 + 0.2, x1: start[2].x1 + 6.2, y0: 96 - 5.4, y1: 96 + 1.5, size: 6, font: 'f' };
    return [...start, st, ...words('March 2030', st.x1 + 3, 100)];
  };
  const body = () => Array.from({ length: 4 }, (_, i) => words('The accounts of the branch were examined with the books', 60, 130 + i * 14)).flat();

  it('is part of that word, raised: no space is put before it, and the line reads as the page does', async () => {
    const layout = pageLayout(page([...dated(), ...body()]), []);
    const first = layout.blocks[0];
    if (first.kind !== 'text') throw new Error('not text');
    expect(first.lines[0].words.map((w) => [w.text, w.raised, w.glued])).toEqual([['As', undefined, undefined], ['at', undefined, undefined], ['31', undefined, undefined], ['st', 'super', true], ['March', undefined, undefined], ['2030', undefined, undefined]]);
    const look = paragraphLook([first.lines[0]], { x0: 60, x1: 500 })!;
    expect(look.runs.map((r) => [r.text, r.raised, r.size])).toEqual([['As at 31', undefined, 10], ['st', 'super', 10], [' March 2030', undefined, 10]]);
    const { parts, looks } = planDocument([layout]);
    expect(parts[0]).toEqual({ kind: 'paragraph', text: 'As at 31st March 2030' });
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/<w:vertAlign w:val="superscript"\/>(?:(?!<w:t ).)*<w:t [^>]*>st<\/w:t>/);
    const { sheets } = planSheets([layout], 'one-sheet');
    expect(sheets[0].rows[0].map((c) => ('text' in c ? c.text : ''))).toEqual(['As at 31st March 2030']);
  });

  it('reads lowered small text as a subscript, and the letter touching it after as part of the word too', () => {
    const h = word('H', 60, 100);
    const two: Word = { text: '2', x0: h.x1 + 0.2, x1: h.x1 + 3.4, y0: 102 - 5.4, y1: 102 + 1.5, size: 6, font: 'f' };
    const o = word('O', two.x1 + 0.2, 100);
    const layout = pageLayout(page([h, two, o, ...words('content is noted', o.x1 + 3, 100), ...body()]), []);
    const first = layout.blocks[0];
    if (first.kind !== 'text') throw new Error('not text');
    expect(first.lines[0].words.slice(0, 4).map((w) => [w.text, w.raised, w.glued])).toEqual([['H', undefined, undefined], ['2', 'sub', true], ['O', undefined, true], ['content', undefined, undefined]]);
    expect(planDocument([layout]).parts[0]).toEqual({ kind: 'paragraph', text: 'H2O content is noted' });
  });

  it('leaves small text that stands apart, or on the line, as it is', () => {
    const start = words('Total', 60, 100);
    const note: Word = { text: 'net', x0: start[0].x1 + 3, x1: start[0].x1 + 12, y0: 100 - 5.4, y1: 100 + 1.5, size: 6, font: 'f' };
    const apart: Word = { text: 'a', x0: note.x1 + 4, x1: note.x1 + 7, y0: 96 - 5.4, y1: 96 + 1.5, size: 6, font: 'f' };
    const layout = pageLayout(page([...start, note, apart, ...body()]), []);
    const first = layout.blocks[0];
    if (first.kind !== 'text') throw new Error('not text');
    expect(first.lines[0].words.some((w) => w.raised || w.glued)).toBe(false);
  });
});

describe('marks drawn with strokes', () => {
  const stroke = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1, color: '000000', width: 0.8 });
  /** A square of 10 points at (x, y). */
  const square = (x: number, y: number): Segment[] => [across(x, x + 10, y), across(x, x + 10, y + 10), down(x, y, y + 10), down(x + 10, y, y + 10)];
  const body = () => Array.from({ length: 4 }, (_, i) => words('The accounts of the branch were examined with the books', 60, 160 + i * 14)).flat();
  /** A tick in the square at (60, 92): a short arm down to its foot, a long arm up to the right. A cross in the square at (160, 92). */
  const tick = [stroke(62, 97, 64.5, 100.5), stroke(64.5, 100.5, 69, 93.5)];
  const cross = [stroke(162, 94, 168, 100), stroke(168, 94, 162, 100)];
  const list = () => [...words('Resident', 76, 100, 9), ...words('Not resident', 176, 100, 9), ...body()];

  it('reads a tick and a cross as the signs they are, standing in the line they are drawn on', () => {
    const layout = pageLayout(page(list()), [...square(60, 92), ...square(160, 92)], { strokes: [...tick, ...cross] });
    const first = layout.blocks[0];
    if (first.kind !== 'text') throw new Error('not text');
    expect(first.lines[0].words.map((w) => w.text)).toEqual(['✓', 'Resident', '✗', 'Not', 'resident']);
    const sign = first.lines[0].words[0];
    expect(sign.x0).toBeGreaterThanOrEqual(60);
    expect(sign.x1).toBeLessThanOrEqual(70);
    expect(layout.strokes).toBeUndefined();
  });

  it('keeps any other slanted stroke as a line of the page, and draws it in the document', async () => {
    const layout = pageLayout(page(list()), [], { strokes: [stroke(300, 60, 380, 90)] });
    expect(layout.strokes).toEqual([expect.objectContaining({ x0: 300, y0: 60, x1: 380, y1: 90 })]);
    const { parts, looks } = planDocument([layout]);
    const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<a:prstGeom prst="line">');
  });

  it('writes the sign into the sheet with the words of its line', () => {
    const layout = pageLayout(page(list()), [...square(60, 92), ...square(160, 92)], { strokes: [...tick, ...cross] });
    const { sheets } = planSheets([layout], 'one-sheet');
    const texts = sheets[0].rows[0].map((c) => ('text' in c ? c.text : ''));
    expect(texts.join(' | ')).toBe('✓ Resident | ✗ Not resident');
  });
});

describe('an amount longer than its column is wide', () => {
  it('has its whole text inside its cell: the edge before it gives way, it never runs through the digits', () => {
    // Three columns; the amounts of the last end at 520 and usually start near 480. One total starts at 392, left of
    // where the middle column ends (400), in a row whose middle cell is empty; another row has all three cells.
    const rows: [string, string, string][] = [
      ['Opening stock', '1,200.00', '850.00'],
      ['Purchases', '2,400.00', '75.50'],
      ['Sales', '3,100.25', '410.00'],
      ['Carried to the summary', '', '12,34,56,78,90,12,34,567.00'],
      ['Closing stock', '1,050.00', '125.75'],
    ];
    const list = rows.flatMap(([caption, middle, last], r) => [...words(caption, 60, 100 + r * 16), ...(middle ? [amount(middle, 400, 100 + r * 16)] : []), amount(last, 520, 100 + r * 16)]);
    const long = list.find((w) => w.text.startsWith('12,34,'))!;
    expect(long.x0).toBeLessThan(400);
    const table = tablesOf(list, [])[0];
    expect(table.rows[3].map((c) => c.text)).toEqual(['Carried to the summary', '', '12,34,56,78,90,12,34,567.00']);
    for (const cell of table.grid!.cells) {
      if (cell.words.length === 0) continue;
      expect(cell.x0).toBeLessThanOrEqual(Math.min(...cell.words.map((w) => w.x0)) + 0.5);
      expect(cell.x1).toBeGreaterThanOrEqual(Math.max(...cell.words.map((w) => w.x1)) - 0.5);
    }
  });
});

describe('small squares to tick, with their options beside them', () => {
  const square = (x: number, y: number): Segment[] => [across(x, x + 9, y), across(x, x + 9, y + 9), down(x, y, y + 9), down(x + 9, y, y + 9)];
  const body = () => Array.from({ length: 4 }, (_, i) => words('The accounts of the branch were examined with the books', 60, 260 + i * 14)).flat();
  /** A row: its label at 60, then squares at the given places, each with its option 14 points after it. */
  const row = (label: string, y: number, options: [number, string][]): { words: Word[]; lines: Segment[] } => ({
    words: [...words(label, 60, y + 8, 9, { bold: true }), ...options.flatMap(([x, name]) => words(name, x + 14, y + 8, 9))],
    lines: options.flatMap(([x]) => square(x, y)),
  });

  it('keeps the sides of a square as lines of the page: never an underline or a blank of the line they stand on', () => {
    const one = row('Kind of member', 100, [[190, 'Individual'], [270, 'Firm'], [330, 'Company']]);
    const layout = pageLayout(page([...one.words, ...body()]), one.lines);
    const first = layout.blocks[0];
    if (first.kind !== 'text') throw new Error('not text');
    expect(first.lines[0].underlines).toBeUndefined();
    expect(first.lines[0].words.some((w) => w.underline)).toBe(false);
    expect((layout.rules ?? []).filter((r) => r.side)).toHaveLength(6);
    expect(layout.uprights).toHaveLength(6);
  });

  it('does not take the sides of the squares for the lines between the rows of a table read from its text', () => {
    const rows = [row('Residence', 100, [[190, 'Resident'], [290, 'Not resident']]), row('Payment by', 124, [[190, 'Cheque'], [290, 'Transfer']]), row('Sent by', 148, [[190, 'Post'], [290, 'Hand']])];
    const layout = pageLayout(page([...rows.flatMap((r) => r.words), ...body()]), rows.flatMap((r) => r.lines));
    const table = layout.blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []))[0];
    expect(table.source).toBe('aligned');
    expect(table.grid!.cells.some((c) => c.borders.top || c.borders.bottom)).toBe(false);
    expect((layout.rules ?? []).filter((r) => r.side)).toHaveLength(12);
    // The middle row is as tall as the rows stand apart on the page (24 points): no side of a square cuts it short.
    expect(table.grid!.ys[2] - table.grid!.ys[1]).toBeCloseTo(24, 0);
  });

  it('places a row of drawn boxes that stands inside such a table (a label before it, a note after it) at its own spot', () => {
    const rows = [row('Residence', 100, [[190, 'Resident'], [290, 'Not resident']]), row('Payment by', 124, [[190, 'Cheque'], [290, 'Transfer']])];
    // "Code" then six boxes of 14 points from x 190, then a note at 290, on the next row of the same table.
    const boxes: Segment[] = [across(190, 274, 144), across(190, 274, 160), ...Array.from({ length: 7 }, (_, i) => down(190 + i * 14, 144, 160))];
    const digits = Array.from('411000').map((ch, i) => word(ch, 194 + i * 14, 156, 9));
    const third = [...words('Code', 60, 156, 9, { bold: true }), ...words('As above', 304, 156, 9)];
    const layout = pageLayout(page([...rows.flatMap((r) => r.words), ...third, ...digits, ...body()]), [...rows.flatMap((r) => r.lines), ...boxes]);
    const { looks } = planDocument([layout]);
    const drawn = looks.looks.flatMap((l) => (l && 'table' in l && l.table.rows.length === 1 && l.table.rows[0].cells.length === 6 ? [l.table] : []));
    expect(drawn).toHaveLength(1);
    expect(drawn[0].float).toBe(true);
    // The rows round it are lines of text (a table in the flow would be moved under the placed boxes by Word): the
    // label and the note of its own row stand at their own spots, the rows above stay in the flow.
    expect(looks.looks.filter((l) => l && 'table' in l)).toHaveLength(1);
    const spots = looks.looks.flatMap((l) => (l && 'para' in l && l.para.frame ? [[l.para.runs.map((r) => r.text).join(''), Math.round(l.para.frame.x)]] : []));
    expect(spots).toEqual([['Code', 60], ['As above', 304]]);
    const flowing = looks.looks.flatMap((l) => (l && 'para' in l && !l.para.frame ? [l.para.runs.filter((r) => !r.tab).map((r) => r.text).join('|')] : []));
    expect(flowing.slice(0, 2)).toEqual(['Residence|Resident|Not resident', 'Payment by|Cheque|Transfer']);
  });
});

describe('lines to write on, under the values of a list of labels and values', () => {
  it('are still drawn when the list is written as lines of text because a row of placed boxes stands inside it', () => {
    const labels: [string, string][] = [['Address', 'Example Road'], ['City', 'Pune'], ['State', 'Goa']];
    const list = labels.flatMap(([label, value], r) => [...words(label, 60, 100 + r * 22, 9, { bold: true }), ...words(value, 200, 100 + r * 22, 9)]);
    const under = labels.map((_, r) => across(198, 400, 104.5 + r * 22));
    // "Code", six boxes of 14 points from x 200, and a note after them, as the next row of the list.
    const boxes: Segment[] = [across(200, 284, 154), across(200, 284, 170), ...Array.from({ length: 7 }, (_, i) => down(200 + i * 14, 154, 170))];
    const code = [...words('Code', 60, 166, 9, { bold: true }), ...Array.from('411000').map((ch, i) => word(ch, 204 + i * 14, 166, 9)), ...words('As above', 310, 166, 9)];
    const body = Array.from({ length: 4 }, (_, i) => words('The accounts of the branch were examined with the books', 60, 220 + i * 14)).flat();
    const { looks } = planDocument([pageLayout(page([...list, ...code, ...body]), [...under, ...boxes])]);
    const tables = looks.looks.flatMap((l) => (l && 'table' in l ? [l.table] : []));
    expect(tables.map((t) => t.float)).toEqual([true]);
    const drawn = looks.pages[0].shapes.filter((q) => q.x1 - q.x0 > 150).map((q) => Math.round((q.y0 + q.y1) / 2));
    expect(drawn).toEqual([105, 127, 149]);
  });
});
