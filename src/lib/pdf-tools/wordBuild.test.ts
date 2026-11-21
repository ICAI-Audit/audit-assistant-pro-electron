// PDF to Word's document plan and writer (wordBuild.ts; contract decision 13). The plan is tested on page
// layouts built by hand (layout.ts shapes), so no PDF reader is needed; the .docx is unzipped with jszip and
// its word/document.xml read. Every word here is invented.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { Block, Cell, Line, PageLayout, Table, Word } from './layout';
import type { Pace } from './pace';
import { buildDocx, DOCX_MIME, planDocument, planDocumentPaced, type DocPart } from './wordBuild';

// ---- hand-built layouts ---------------------------------------------------------------------------------

/** Width of a character in these tests: half the font size. */
const CH = 0.5;

/** Words of `text` from `x` on the baseline `y`; a space is 0.3 of the size. */
function words(text: string, x: number, y: number, size = 10): Word[] {
  const out: Word[] = [];
  let at = x;
  for (const part of text.split(' ')) {
    if (part === '') continue;
    const width = Array.from(part).length * CH * size;
    out.push({ text: part, x0: at, y0: y - 0.9 * size, x1: at + width, y1: y + 0.25 * size, size, font: 'Helvetica' });
    at += width + 0.3 * size;
  }
  return out;
}

function line(text: string, x: number, y: number, size = 10): Line {
  const w = words(text, x, y, size);
  return { y0: y - 0.9 * size, y1: y + 0.25 * size, size, words: w };
}

/** Lines of `text` wrapped at `width` points from `x`, baselines `pitch` apart from `y`. */
function wrapped(text: string, x: number, y: number, width: number, options: { size?: number; pitch?: number; firstIndent?: number } = {}): Line[] {
  const size = options.size ?? 10;
  const pitch = options.pitch ?? 14;
  const lines: Line[] = [];
  let current: string[] = [];
  let first = true;
  const room = () => width - (first ? (options.firstIndent ?? 0) : 0);
  const length = (parts: string[]) => parts.reduce((sum, p) => sum + Array.from(p).length * CH * size, 0) + Math.max(0, parts.length - 1) * 0.3 * size;
  const flush = () => {
    lines.push(line(current.join(' '), x + (first ? (options.firstIndent ?? 0) : 0), y + lines.length * pitch, size));
    current = [];
    first = false;
  };
  for (const word of text.split(' ')) {
    if (current.length > 0 && length([...current, word]) > room()) flush();
    current.push(word);
  }
  if (current.length > 0) flush();
  return lines;
}

const text = (...lines: Line[]): Block => ({ kind: 'text', lines });

function cell(t: string, x = 0, y = 0): Cell {
  return { text: t, words: t === '' ? [] : words(t, x, y) };
}

function table(source: Table['source'], rows: string[][], columns?: number[]): Block {
  const cols = columns ?? rows[0].map((_, i) => 50 + i * 100);
  return { kind: 'table', table: { source, y0: 100, y1: 100 + rows.length * 16, columns: cols, rows: rows.map((r, i) => r.map((t, c) => cell(t, cols[c] ?? 0, 110 + i * 16))) } };
}

function page(blocks: Block[], pageIndex = 0, hasText = true): PageLayout {
  return { pageIndex, width: 595, height: 842, hasText, blocks };
}

const LOREM =
  'The branch counts its stock on the last working day of the year and two members of staff sign every sheet together before it is sent to the head office for checking';
const SECOND =
  'Cash in the drawer is counted at the same time and agreed with the cash book and any difference is written on the sheet with a short reason';

/** A line long enough to make a page ordinary (20 characters or more). */
const STOCK_NOTE = 'Stock counted at the branch on the last day';

const kinds = (parts: readonly DocPart[]) => parts.map((p) => p.kind);
const texts = (parts: readonly DocPart[]) => parts.flatMap((p) => (p.kind === 'paragraph' || p.kind === 'heading' ? [p.text] : []));

// ---- planDocument ---------------------------------------------------------------------------------------

describe('planDocument: paragraphs', () => {
  it('joins the wrapped lines of one paragraph with single spaces', () => {
    const lines = wrapped(LOREM, 50, 100, 250);
    expect(lines.length).toBeGreaterThan(3);
    const { parts, report } = planDocument([page([text(...lines)])]);
    expect(parts).toEqual([{ kind: 'paragraph', text: LOREM }]);
    expect(report).toEqual({ pages: 1, paragraphs: 1, headings: 0, tables: 0, pagesNoText: 0 });
  });

  it('starts a new paragraph at a clear vertical gap', () => {
    const first = wrapped(LOREM, 50, 100, 250);
    const next = wrapped(SECOND, 50, 100 + first.length * 14 + 14, 250); // one empty line between
    const { parts } = planDocument([page([text(...first, ...next)])]);
    expect(texts(parts)).toEqual([LOREM, SECOND]);
  });

  it('keeps double-spaced lines together: the gap is measured against the block’s own spacing', () => {
    const lines = wrapped(LOREM, 50, 100, 250, { pitch: 22 });
    const after = wrapped(SECOND, 50, 100 + lines.length * 22 + 22, 250, { pitch: 22 });
    const { parts } = planDocument([page([text(...lines, ...after)])]);
    expect(texts(parts)).toEqual([LOREM, SECOND]);
  });

  it('starts a new paragraph at a first-line indent, even when the line before ends at the margin', () => {
    // The first paragraph's last line is made to end at the right edge. (At this width that line has ten words: two words
    // alone, pushed to the two ends of the measure, are read as two pieces set apart, as a reference at the left and a date
    // at the right are; T-064.)
    const one = wrapped(LOREM, 50, 100, 270, { firstIndent: 20 });
    const two = wrapped(SECOND, 50, 100 + one.length * 14, 270, { firstIndent: 20 });
    const lastOfOne = one[one.length - 1];
    const right = Math.max(...[...one, ...two].map((l) => l.words[l.words.length - 1].x1));
    const shift = right - lastOfOne.words[lastOfOne.words.length - 1].x1;
    // Spread the last line's words out so that it reaches the margin, as justified text would.
    lastOfOne.words.forEach((w, i) => {
      const by = lastOfOne.words.length > 1 ? (shift * i) / (lastOfOne.words.length - 1) : 0;
      w.x0 += by;
      w.x1 += by;
    });
    const { parts } = planDocument([page([text(...one, ...two)])]);
    expect(texts(parts)).toEqual([LOREM, SECOND]);
  });

  it('starts a new paragraph after a short last line', () => {
    const one = wrapped(LOREM, 50, 100, 250);
    const two = wrapped(SECOND, 50, 100 + one.length * 14, 250);
    const { parts } = planDocument([page([text(...one, ...two)])]);
    expect(texts(parts)).toEqual([LOREM, SECOND]);
  });

  it('keeps a hanging indent together: the lines under the first one are the paragraph’s body', () => {
    const item = (label: string, body: string, y: number) => {
      const lines = wrapped(body, 70, y, 230);
      const first = line(`${label} ${lines[0].words.map((w) => w.text).join(' ')}`, 50, y);
      return [first, ...lines.slice(1)];
    };
    const a = item('1.', LOREM, 100);
    const b = item('2.', SECOND, 100 + a.length * 14);
    const { parts } = planDocument([page([text(...a, ...b)])]);
    expect(texts(parts)).toEqual([`1. ${LOREM}`, `2. ${SECOND}`]);
  });

  it('gives each line of an address its own paragraph: its lines end short of the letter below it', () => {
    const address = text(line('Sample Traders', 50, 100), line('12 Example Road', 50, 114), line('Sample Town 400001', 50, 128));
    const { parts } = planDocument([page([address, text(...wrapped(LOREM, 50, 170, 400))])]);
    expect(texts(parts)).toEqual(['Sample Traders', '12 Example Road', 'Sample Town 400001', LOREM]);
    // In the same block as the letter, too.
    const together = planDocument([page([text(...(address as { lines: Line[] }).lines, ...wrapped(LOREM, 50, 156, 400))])]);
    expect(texts(together.parts)).toEqual(['Sample Traders', '12 Example Road', 'Sample Town 400001', LOREM]);
  });

  it('keeps a column of a two-column page whole, with page-wide lines above and below it', () => {
    const above = text(line('Circular to all branch managers about the year end stock count and the cash', 50, 80));
    const left = text(...wrapped(LOREM, 50, 110, 230));
    const right = text(...wrapped(SECOND, 310, 110, 230));
    const below = text(line('For Sample Traders (invented), the accounts department, on behalf of the partners', 50, 300));
    const { parts } = planDocument([page([above, left, right, below])]);
    expect(texts(parts)).toEqual([
      'Circular to all branch managers about the year end stock count and the cash',
      LOREM,
      SECOND,
      'For Sample Traders (invented), the accounts department, on behalf of the partners',
    ]);
  });

  it('does not measure a block against a block that starts elsewhere (the other column)', () => {
    const left = wrapped(LOREM, 50, 100, 200);
    const right = text(line('Short one', 310, 100), line('Short two', 310, 114));
    const { parts } = planDocument([page([text(...left), right])]);
    expect(texts(parts)).toEqual([LOREM, 'Short one Short two']);
  });

  it('joins a word broken by a hyphen at a line end', () => {
    const lines = [line('The auditor checked the finan-', 50, 100), line('cial statements of the year 2024-', 50, 114), line('25 and signed them on the same day as the rest', 50, 128)];
    // Long enough that no line counts as short.
    lines.forEach((l) => {
      const last = l.words[l.words.length - 1];
      last.x1 = Math.max(last.x1, 280);
    });
    const { parts } = planDocument([page([text(...lines)])]);
    expect(texts(parts)).toEqual(['The auditor checked the financial statements of the year 2024-25 and signed them on the same day as the rest']);
  });

  it('does not join across a lone dash or a short line ending with a hyphen-like word', () => {
    const { parts } = planDocument([page([text(line('Opening balance -', 50, 100), line('Brought forward from last year', 50, 114))])]);
    expect(texts(parts)).toEqual(['Opening balance -', 'Brought forward from last year']);
  });

  it('each text block starts its own paragraph', () => {
    const { parts } = planDocument([page([text(...wrapped(LOREM, 50, 100, 250)), text(...wrapped(SECOND, 310, 100, 250))])]);
    expect(texts(parts)).toEqual([LOREM, SECOND]);
  });
});

describe('planDocument: headings by font size (1.5 × body = Heading 1, 1.2 × = Heading 2)', () => {
  it('finds the body size from the characters and marks larger lines as headings', () => {
    const body = wrapped(LOREM, 50, 160, 400);
    const { parts, report } = planDocument([
      page([
        text(line('Annual stock count', 50, 80, 15)), // 1.5 × 10
        text(line('Instructions for branches', 50, 110, 12)), // 1.2 × 10
        text(line('A note in slightly larger type', 50, 130, 11.9)),
        text(...body),
      ]),
    ]);
    expect(parts.slice(0, 3)).toEqual([
      { kind: 'heading', level: 1, text: 'Annual stock count' },
      { kind: 'heading', level: 2, text: 'Instructions for branches' },
      { kind: 'paragraph', text: 'A note in slightly larger type' },
    ]);
    expect(report.headings).toBe(2);
    expect(report.paragraphs).toBe(2);
  });

  it('joins the lines of a two-line heading and splits it from the body that follows in the same block', () => {
    const heading = [line('Circular to all branch managers about the', 50, 80, 16), line('year end count', 50, 100, 16)];
    const body = wrapped(LOREM, 50, 120, 400);
    const { parts } = planDocument([page([text(...heading, ...body)])]);
    expect(parts).toEqual([
      { kind: 'heading', level: 1, text: 'Circular to all branch managers about the year end count' },
      { kind: 'paragraph', text: LOREM },
    ]);
  });

  it('counts table words for the body size, so a table-heavy page keeps its title a heading', () => {
    const rows = Array.from({ length: 8 }, (_, i) => [`0${i + 1}-04-2025`, `Narration number ${i + 1}`, `${i + 1},000.00`]);
    // Without the table's words the title would be the body size itself, and no heading.
    const { parts } = planDocument([page([text(line('Example Bank (invented)', 36, 50, 15)), table('ruled', rows)])]);
    expect(parts[0]).toEqual({ kind: 'heading', level: 1, text: 'Example Bank (invented)' });
  });

  it('makes no heading when every line has the same size', () => {
    const { report } = planDocument([page([text(line('Title in body size', 50, 80)), text(...wrapped(LOREM, 50, 110, 300))])]);
    expect(report.headings).toBe(0);
  });
});

describe('planDocument: tables', () => {
  it('always keeps a ruled table, however small', () => {
    // A line of text with it, so the page has 20 characters or more (an ordinary page).
    const { parts, report } = planDocument([page([text(line(STOCK_NOTE, 50, 80)), table('ruled', [['Item', 'Value'], ['Cement', '840']])])]);
    expect(parts).toEqual([{ kind: 'paragraph', text: STOCK_NOTE }, { kind: 'table', rows: [['Item', 'Value'], ['Cement', '840']] }]);
    expect(report.tables).toBe(1);
  });

  it('keeps an aligned grid of 3 rows sharing 3 column starts as a table', () => {
    const rows = [['Particulars', 'Debit', 'Credit'], ['Share capital', '', '25,00,000.00'], ['Plant', '18,45,000.00', '1.00'], ['Stock', '9,80,400.25', '2.00'], ['Total', '50,19,818.25', '50,19,818.25']];
    const { parts, report } = planDocument([page([table('aligned', rows)])]);
    expect(parts).toEqual([{ kind: 'table', rows }]);
    expect(report.tables).toBe(1);
  });

  it('keeps a trial balance as a table: most rows fill only two of its three columns, but each column is shared by 3 rows', () => {
    const rows = [
      ['Particulars', 'Debit', 'Credit'],
      ['Share capital', '', '25,00,000.00'],
      ['Secured loans', '', '8,75,000.00'],
      ['Plant', '18,45,000.00', ''],
      ['Stock', '9,80,400.25', ''],
      ['Total', '28,25,400.25', '33,75,000.00'],
    ];
    expect(planDocument([page([table('aligned', rows)])]).parts).toEqual([{ kind: 'table', rows }]);
  });

  it('writes an aligned grid of only two such rows as text, its cells apart by a tab', () => {
    const rows = [['Particulars', 'Debit', 'Credit'], ['Share capital', '', '25,00,000.00'], ['Total', '10.00', '10.00']];
    const { parts, report } = planDocument([page([table('aligned', rows)])]);
    expect(parts).toEqual([
      { kind: 'paragraph', text: 'Particulars\tDebit\tCredit' },
      { kind: 'paragraph', text: 'Share capital\t25,00,000.00' },
      { kind: 'paragraph', text: 'Total\t10.00\t10.00' },
    ]);
    expect(report).toMatchObject({ tables: 0, paragraphs: 3 });
  });

  it('writes an aligned grid of only two columns as text', () => {
    const rows = [['Cash', '100'], ['Bank', '200'], ['Stock', '300'], ['Debtors', '400']];
    const { parts } = planDocument([page([table('aligned', rows)])]);
    expect(kinds(parts)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  });

  it('pads short rows so every row has as many cells as the table has columns, and leaves out an empty table', () => {
    const block: Block = { kind: 'table', table: { source: 'ruled', y0: 0, y1: 10, columns: [0, 100, 200], rows: [[cell('A'), cell('B'), cell('C')], [cell('D')]] } };
    const empty: Block = { kind: 'table', table: { source: 'ruled', y0: 0, y1: 10, columns: [0, 100], rows: [[cell(''), cell('')]] } };
    const { parts, report } = planDocument([page([text(line(STOCK_NOTE, 50, 80)), block, empty])]);
    expect(parts).toEqual([{ kind: 'paragraph', text: STOCK_NOTE }, { kind: 'table', rows: [['A', 'B', 'C'], ['D', '', '']] }]);
    expect(report.tables).toBe(1);
  });
});

describe('planDocument: pages', () => {
  const one = (i: number) => page([text(line(`Page ${i} text of the invented document`, 50, 100))], i);

  it('puts one page break between pages and none after the last', () => {
    const { parts, report } = planDocument([one(0), one(1), one(2)]);
    expect(kinds(parts)).toEqual(['paragraph', 'page-break', 'paragraph', 'page-break', 'paragraph']);
    expect(report).toEqual({ pages: 3, paragraphs: 3, headings: 0, tables: 0, pagesNoText: 0 });
  });

  it('keeps a page without text as an empty page, and counts it', () => {
    const scanned = page([], 1, false);
    const { parts, report } = planDocument([one(0), scanned, one(2)]);
    expect(kinds(parts)).toEqual(['paragraph', 'page-break', 'page-break', 'paragraph']);
    expect(report.pagesNoText).toBe(1);
  });

  it('keeps the words of a page with little text (under 20 characters) as one paragraph, and counts the page', () => {
    const label = page([text(line('Annexure A', 50, 400, 20))], 1);
    const { parts, report } = planDocument([one(0), label, one(2)]);
    expect(parts).toEqual([
      { kind: 'paragraph', text: 'Page 0 text of the invented document' },
      { kind: 'page-break' },
      { kind: 'paragraph', text: 'Annexure A' },
      { kind: 'page-break' },
      { kind: 'paragraph', text: 'Page 2 text of the invented document' },
    ]);
    expect(report).toEqual({ pages: 3, paragraphs: 3, headings: 0, tables: 0, pagesNoText: 1 });
  });

  it('joins every word of a little-text page, from all its blocks and cells, into that one paragraph', () => {
    const stamp = page([text(line('Page', 50, 800)), table('ruled', [['3', 'of'], ['9', '']])], 0);
    const { parts, report } = planDocument([stamp]);
    expect(parts).toEqual([{ kind: 'paragraph', text: 'Page 3 of 9' }]);
    expect(report).toMatchObject({ paragraphs: 1, tables: 0, pagesNoText: 1 });
  });

  it('treats a page of 20 characters or more as an ordinary page', () => {
    const twenty = page([text(line('Abcdefghij Klmnopqrst', 50, 100))], 0); // 20 characters that are not spaces
    const nineteen = page([text(line('Abcdefghij Klmnopqr', 50, 100))], 1);
    expect(planDocument([twenty]).report.pagesNoText).toBe(0);
    expect(planDocument([nineteen]).report.pagesNoText).toBe(1);
  });

  it('starts with an empty page when the first page has no text', () => {
    const { parts } = planDocument([page([], 0, false), one(1)]);
    expect(kinds(parts)).toEqual(['page-break', 'paragraph']);
  });

  it('gives an empty plan for no pages', () => {
    expect(planDocument([])).toEqual({ parts: [], report: { pages: 0, paragraphs: 0, headings: 0, tables: 0, pagesNoText: 0 }, looks: { looks: [], pages: [] } });
  });

  it('makes the same plan paced, asking the pace at least once a page, and stops when the pace throws', async () => {
    const pages = Array.from({ length: 40 }, (_, i) => one(i));
    let asked = 0;
    expect(await planDocumentPaced(pages, () => void asked++)).toEqual(planDocument(pages));
    expect(asked).toBeGreaterThanOrEqual(40);
    const stop = new Error('stopped');
    let n = 0;
    await expect(planDocumentPaced(pages, () => (++n === 10 ? Promise.reject(stop) : undefined))).rejects.toBe(stop);
  });
});

describe('planDocument: text as it is', () => {
  it('passes Hindi and other scripts through unchanged', () => {
    const { parts } = planDocument([page([text(line('लेखा परीक्षा रिपोर्ट', 50, 100)), text(line('Statement — ₹ 1,23,456.78 Dr', 50, 130))])]);
    expect(texts(parts)).toEqual(['लेखा परीक्षा रिपोर्ट', 'Statement — ₹ 1,23,456.78 Dr']);
  });

  it('drops characters a Word file cannot hold (control characters, lone surrogates) and keeps the rest', () => {
    const l = line('Total amount due', 50, 100);
    l.words[0].text = 'To\u0001tal';
    l.words[1].text = 'amo\uD800unt';
    const { parts } = planDocument([page([text(l)])]);
    expect(texts(parts)).toEqual(['Total amount due']);
  });
});

// ---- buildDocx ------------------------------------------------------------------------------------------

/** A pace that never waits but counts how often it was asked. */
function countingPace(): { pace: Pace; asked: () => number } {
  let n = 0;
  return { pace: () => void n++, asked: () => n };
}

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('no word/document.xml');
  return file.async('string');
}

/** The body's paragraphs and tables in order: a paragraph as its style and text, a table as its cells. */
function bodyParts(xml: string): ({ p: string; style: string | null; breaks: number } | { table: string[][] })[] {
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('<w:sectPr'));
  const out: ({ p: string; style: string | null; breaks: number } | { table: string[][] })[] = [];
  const cellText = (s: string) => [...s.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => (m[0] === '<w:tab/>' ? '\t' : m[1])).join('');
  for (const m of body.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>|<w:p>([\s\S]*?)<\/w:p>|<w:p\/>/g)) {
    if (m[1] !== undefined) {
      const rows = [...m[1].matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map((r) => [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) => cellText(c[1])));
      out.push({ table: rows });
    } else {
      const inner = m[2] ?? '';
      const style = /<w:pStyle w:val="([^"]+)"\/>/.exec(inner)?.[1] ?? null;
      out.push({ p: cellText(inner), style, breaks: (inner.match(/<w:br w:type="page"\/>/g) ?? []).length });
    }
  }
  return out;
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

describe('buildDocx', () => {
  const parts: DocPart[] = [
    { kind: 'heading', level: 1, text: 'Annual stock count' },
    { kind: 'paragraph', text: 'Every branch counts its stock & cash <on the day>.' },
    { kind: 'heading', level: 2, text: 'Cash' },
    { kind: 'paragraph', text: 'Total\t1,23,456.78' },
    { kind: 'table', rows: [['Item', 'Value'], ['Cement', '2,94,000.00'], ['लेखा', '']] },
    { kind: 'page-break' },
    { kind: 'page-break' },
    { kind: 'paragraph', text: 'Last page' },
  ];

  it('writes a Word file whose body holds the headings, paragraphs, tables and page breaks in order', async () => {
    const bytes = await buildDocx(parts, countingPace().pace);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes.subarray(0, 2)).toString('latin1')).toBe('PK');
    const found = bodyParts(await documentXml(bytes)).map((p) => ('p' in p ? { ...p, p: unescape(p.p) } : p));
    expect(found).toEqual([
      { p: 'Annual stock count', style: 'Heading1', breaks: 0 },
      { p: 'Every branch counts its stock & cash <on the day>.', style: null, breaks: 0 },
      { p: 'Cash', style: 'Heading2', breaks: 0 },
      { p: 'Total\t1,23,456.78', style: null, breaks: 0 },
      { table: [['Item', 'Value'], ['Cement', '2,94,000.00'], ['लेखा', '']] },
      { p: '', style: null, breaks: 1 },
      { p: '', style: null, breaks: 1 },
      { p: 'Last page', style: null, breaks: 0 },
    ]);
  });

  it('uses a plain default font and size, has heading styles, and holds no pictures', async () => {
    const zip = await JSZip.loadAsync(await buildDocx(parts, countingPace().pace));
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toMatch(/<w:docDefaults>[\s\S]*<w:rFonts w:ascii="Calibri"[\s\S]*<w:sz w:val="22"\/>/);
    for (const id of ['Heading1', 'Heading2']) {
      const style = new RegExp(`<w:style w:type="paragraph" w:styleId="${id}">([\\s\\S]*?)</w:style>`).exec(styles)?.[1] ?? '';
      expect(style).toContain('<w:b/>');
      expect(style).not.toContain('<w:color'); // in the text colour, not the package's blue
    }
    expect(Object.keys(zip.files).filter((n) => n.startsWith('word/media/'))).toEqual([]);
    const xml = await documentXml(await buildDocx(parts, countingPace().pace));
    expect(xml).not.toContain('<w:drawing');
    expect(xml).not.toMatch(/<w:cols [^>]*w:num="[2-9]/);
    expect(xml).not.toContain('<w:color ');
  });

  it('draws the table’s grid lines and gives it the page width', async () => {
    const xml = await documentXml(await buildDocx([{ kind: 'table', rows: [['A', 'B', 'C']] }], countingPace().pace));
    expect(xml).toMatch(/<w:tblBorders>[\s\S]*<w:insideH w:val="single"/);
    expect((xml.match(/<w:gridCol /g) ?? []).length).toBe(3);
  });

  it('keeps two tables in a row apart with an empty paragraph, and ends the body with a paragraph', async () => {
    const found = bodyParts(await documentXml(await buildDocx([{ kind: 'table', rows: [['A']] }, { kind: 'table', rows: [['B']] }], countingPace().pace)));
    expect(found).toEqual([{ table: [['A']] }, { p: '', style: null, breaks: 0 }, { table: [['B']] }, { p: '', style: null, breaks: 0 }]);
  });

  it('sets no title or author', async () => {
    const zip = await JSZip.loadAsync(await buildDocx(parts, countingPace().pace));
    const core = await zip.file('docProps/core.xml')!.async('string');
    expect(core).not.toMatch(/<dc:title>[^<]+|<dc:creator>[^<]+|<dc:description>[^<]+/);
  });

  it('writes an empty document with one empty paragraph', async () => {
    const found = bodyParts(await documentXml(await buildDocx([], countingPace().pace)));
    expect(found).toEqual([{ p: '', style: null, breaks: 0 }]);
  });

  it('gives the window turns while it builds: the pace is asked for every part', async () => {
    const many: DocPart[] = Array.from({ length: 300 }, (_, i) => ({ kind: 'paragraph', text: `Line ${i}` }));
    const { pace, asked } = countingPace();
    await buildDocx(many, pace);
    expect(asked()).toBeGreaterThanOrEqual(300);
  });

  it('stops when the pace throws (a Stop)', async () => {
    let n = 0;
    const stop = new Error('stopped');
    const pace: Pace = () => {
      if (++n === 50) return Promise.reject(stop);
      return undefined;
    };
    const many: DocPart[] = Array.from({ length: 300 }, (_, i) => ({ kind: 'paragraph', text: `Line ${i}` }));
    await expect(buildDocx(many, pace)).rejects.toBe(stop);
  });

  it('names the Word MIME type', () => {
    expect(DOCX_MIME).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
