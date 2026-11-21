// Quality round 3 (T-064): the content of one page of the source is fitted to one page of the document.
// Rules stated on what a page draws, on hand-made words and lines (invented text).
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { pageLayout, type Line, type PageWords, type Segment, type Word } from './layout';
import { buildDocx, planDocument } from './wordBuild';
import { paragraphLook, type TextMeasure } from './wordLook';

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
const line = (list: Word[]): Line => ({ y0: Math.min(...list.map((w) => w.y0)), y1: Math.max(...list.map((w) => w.y1)), size: list[0].size, words: list });
const page = (list: Word[]): PageWords => ({ pageIndex: 0, width: 595, height: 842, words: list });
const across = (x0: number, x1: number, y: number): Segment => ({ x0, y0: y, x1, y1: y, color: '000000', width: 0.5 });
const down = (x: number, y0: number, y1: number): Segment => ({ x0: x, y0, x1: x, y1, color: '000000', width: 0.5 });
const endOf = (list: Word[]) => list[list.length - 1].x1;
/** Letters 0.6 of the size wide where the page has 0.5: a font of other widths. */
const wider: TextMeasure = (text) => text.length * 0.6;
/** The words of `text` from x, the last one ending at `end` (a justified line). */
function upTo(text: string, x: number, y: number, end: number, size = 10): Word[] {
  const list = words(text, x, y, size);
  const spare = (end - endOf(list)) / Math.max(1, list.length - 1);
  list.forEach((w, i) => {
    w.x0 += i * spare;
    w.x1 += i * spare;
  });
  return list;
}
async function bodyOf(list: Word[], segments: Segment[] = [], measure?: TextMeasure): Promise<string> {
  const { parts, looks } = planDocument([pageLayout(page(list), segments)], measure);
  const zip = await JSZip.loadAsync(await buildDocx(parts, () => undefined, looks));
  return zip.file('word/document.xml')!.async('string');
}
const paragraphsOf = (xml: string): string[] => [...xml.matchAll(/<w:p>.*?<\/w:p>/gs)].map((m) => m[0]);

describe('a row never grows beyond its height on the page', () => {
  it('gives the lines of a cell no more height than the row has, when rows stand closer than a line usually takes', async () => {
    // Five rows 8.5 points apart, text of 8 points (a single line usually takes 9.2).
    const ys = [100, 108.5, 117, 125.5, 134, 142.5];
    const names = ['Stock', 'Debtors', 'Cash', 'Loans', 'Deposits'];
    const list = names.flatMap((name, r) => [word(name, 64, ys[r] + 6.6, 8), word(`${r + 1},200`, 330, ys[r] + 6.6, 8)]);
    const segments = [...ys.map((y) => across(60, 400, y)), down(60, 100, 142.5), down(300, 100, 142.5), down(400, 100, 142.5)];
    const xml = await bodyOf(list, segments);
    const rows = [...xml.matchAll(/<w:tr>.*?<\/w:tr>/gs)].map((m) => m[0]);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      const height = Number(/w:trHeight w:val="(\d+)"/.exec(row)![1]);
      for (const cell of row.matchAll(/<w:tc>.*?<\/w:tc>/gs)) {
        let content = 0;
        for (const p of paragraphsOf(cell[0])) {
          const m = /w:before="(\d+)" w:after="0" w:line="(\d+)"/.exec(p)!;
          content += Number(m[1]) + Number(m[2]);
        }
        expect(content).toBeLessThanOrEqual(height);
      }
    }
  });
});

describe('a line the page keeps cannot wrap', () => {
  it('says that a heading drawn in a plain weight is not bold (the heading style of Word is)', async () => {
    const body = Array.from({ length: 6 }, (_, i) => words('The accounts of the branch were examined with the books', 60, 160 + i * 14)).flat();
    const xml = await bodyOf([...words('Report of the sample branch', 60, 100, 18), ...body]);
    const heading = paragraphsOf(xml).find((p) => p.includes('Report of the sample branch'))!;
    expect(heading).toContain('w:pStyle w:val="Heading1"');
    expect(heading).toContain('<w:b w:val="0"/>');
    const bold = await bodyOf([...words('Report of the sample branch', 60, 100, 18, { bold: true }), ...body]);
    expect(paragraphsOf(bold).find((p) => p.includes('Report of the sample branch'))!).not.toContain('<w:b w:val="0"/>');
  });

  it('does not set a numbered paragraph right because its lines all end at one edge: the number hangs, the lines run from edge to edge', () => {
    const lines = [
      line([word('3.', 60, 100), ...upTo('The compliance with the conditions set for the', 84, 100, 400)]),
      line(upTo('branch is the duty of those who manage it and', 84, 114, 400)),
      line(upTo('covers the keeping of all books and vouchers', 84, 128, 400)),
    ];
    for (const measure of [undefined, wider]) {
      const look = paragraphLook(lines, { x0: 60, x1: 402 }, undefined, measure)!;
      expect(look.align).not.toBe('right');
      expect(look.left).toBeCloseTo(24, 0);
      expect(look.first).toBeCloseTo(-24, 0);
      expect(look.runs[1].tab).toBe(true);
    }
  });

  it('still sets right two lines of a heading that end at one edge and start at different places', () => {
    const to500 = (text: string, y: number) => line(words(text, 500 - endOf(words(text, 0, y)), y));
    expect(paragraphLook([to500('As at', 100), to500('31 March 2030', 114)], { x0: 300, x1: 502 }, undefined, wider)!.align).toBe('right');
  });

  it('gives kept lines that end unevenly room at the right, and lines that run from edge to edge letters a little narrower than measured', () => {
    const ragged = [line(words('The accounts of the branch were examined with the', 50, 100)), line(words('books and vouchers kept at the head office', 50, 114)), line(words('during the year under report by us', 50, 128))];
    const out = paragraphLook(ragged, { x0: 50, x1: 300 }, undefined, wider)!;
    expect(out.align).toBeUndefined();
    expect(out.right).toBeLessThanOrEqual(300 - endOf(ragged[0].words) - 8);
    // Two lines of the same length, then a short last one; the words a little closer than the font's own space.
    const even = [line(words('The accounts of the branch were examined with the', 50, 100)), line(words('books and vouchers kept at the head office during', 50, 114)), line(words('the year under report', 50, 128))];
    expect(endOf(even[0].words)).toBeCloseTo(endOf(even[1].words), 3);
    const both = paragraphLook(even, { x0: 50, x1: endOf(even[0].words) + 2 }, undefined, wider)!;
    expect(both.align).toBe('both');
    // 0.5 on the page against 0.6 in the font is 83 %: at least two hundredths are kept in hand, the line being stretched to its edge anyway.
    for (const run of both.runs.filter((r) => !r.br && !r.tab)) expect(run.scale).toBeLessThanOrEqual(82);
  });
});

describe('the foot of a page', () => {
  const body = () => Array.from({ length: 8 }, (_, i) => words('The accounts of the branch were examined with the books', 60, 100 + i * 14)).flat();

  it('is set at its own spot when it stands after a clear gap at the bottom of the page: what is above may grow a little without pushing it over', async () => {
    const list = [...body(), ...words('130', 60, 810, 8), ...words('Sample Traders Limited', 440, 810, 8)];
    const { looks } = planDocument([pageLayout(page(list), [])]);
    const framed = looks.looks.flatMap((l) => (l && 'para' in l && l.para.frame ? [[l.para.runs.map((r) => r.text).join(''), Math.round(l.para.frame.x)]] : []));
    expect(framed).toEqual([['130', 60], ['Sample Traders Limited', 440]]);
    const xml = await bodyOf(list);
    // A box of text anchored to the page, 440 points from its left edge; the text above stays in the flow.
    expect(xml).toMatch(/<wp:positionH relativeFrom="page"><wp:posOffset>5588000<\/wp:posOffset>(?:(?!<\/w:drawing>).)*<wps:txbx>(?:(?!<\/w:drawing>).)*Sample Traders Limited/s);
    expect(paragraphsOf(xml).find((p) => p.includes('The accounts'))!).not.toContain('wps:txbx');
  });

  it('stays in the flow when it follows the text closely, or stands in the middle of the page', () => {
    const close = [...body(), ...words('Sample Traders Limited', 60, 100 + 8 * 14 + 4)];
    expect(planDocument([pageLayout(page(close), [])]).looks.looks.some((l) => l && 'para' in l && l.para.frame)).toBe(false);
    const middle = [...body(), ...words('Sample Traders Limited', 60, 400)];
    expect(planDocument([pageLayout(page(middle), [])]).looks.looks.some((l) => l && 'para' in l && l.para.frame)).toBe(false);
  });
});
