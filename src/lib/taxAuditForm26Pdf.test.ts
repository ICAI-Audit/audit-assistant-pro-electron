import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  buildForm26ExportModel,
  exportModelLines,
  type Form26ExportModel,
} from '@/lib/taxAuditForm26ExportModel';
import {
  buildForm26PdfBlob,
  FORM26_PDF_SUBSTITUTES,
  form26PdfFileName,
  form26PdfFontSize,
  FORM26_PDF_BOX,
  form26PdfMarks,
  form26PdfText,
  isForm26PdfPrintable,
  planForm26Pdf,
  renderForm26Pdf,
  type Form26PdfCell,
  type Form26PdfOp,
} from '@/lib/taxAuditForm26Pdf';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
type SaveObject = { f: Record<string, string>; t: Form26Values['t'] };
const SAVES = JSON.parse(fixture('word-values.json')) as Record<'default' | 'filledCat2' | 'filledCat1', SaveObject>;
const valuesOf = (save: SaveObject): Form26Values => JSON.parse(JSON.stringify({ f: save.f, t: save.t })) as Form26Values;
const AT = '2026-11-22T10:00:00.000Z';
const build = (values: Form26Values) => buildForm26ExportModel(DEF, values, { showAllSchedules: false, generatedAt: AT });

const cellText = (cell: Form26PdfCell) => (typeof cell === 'string' ? cell : cell.content);
const noSpace = (text: string) => text.replace(/\s+/g, '');
type TableOp = Extract<Form26PdfOp, { op: 'table' }>;

/** The text of the plan in drawing order, as the lines of the model are written (cells apart, rows apart). */
function planLines(ops: Form26PdfOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === 'text') out.push(op.text);
    if (op.op === 'table') {
      for (const row of [...op.head, ...op.body, ...(op.foot ? [op.foot] : [])]) out.push(row.map(cellText).join('\t'));
    }
  }
  return out;
}

/** Each line, white space removed, must be found after the one before (other text may lie between). */
function expectInOrder(haystack: string, lines: string[]) {
  let at = 0;
  for (const line of lines) {
    const needle = noSpace(form26PdfText(line));
    if (needle === '') continue;
    const found = haystack.indexOf(needle, at);
    if (found < 0) throw new Error(`not found in order: "${line.slice(0, 120)}" (searched from ${at} of ${haystack.length})`);
    at = found + needle.length;
  }
}

async function pdfPages(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pages: { text: string; width: number; height: number }[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const [, , width, height] = page.view;
    pages.push({ text: content.items.map((item) => ('str' in item ? item.str : '')).join(''), width, height });
  }
  await pdf.destroy();
  return pages;
}

const render = (model: Form26ExportModel) => new Uint8Array(renderForm26Pdf(planForm26Pdf(model)).output('arraybuffer'));

describe('planForm26Pdf', () => {
  const model = build(valuesOf(SAVES.filledCat2));
  const ops = planForm26Pdf(model);

  it('the plan lists every block of the model in order (the PDF\'s substitutes for ☑ ☐ ₹ applied)', () => {
    const { portrait, landscape } = exportModelLines(model);
    const lines = [...portrait, ...landscape];
    expectInOrder(noSpace(planLines(ops).join('\n')), lines);
    // Nothing is printed that the model does not have, except the numbers of the notes.
    const extra = noSpace(planLines(ops).join('')).length - noSpace(form26PdfText([...lines].join(''))).length;
    const notes = [...model.portrait].filter((block) => block.kind === 'notes').reduce((n, block) => n + (block.kind === 'notes' ? block.items.length : 0), 0);
    expect(extra).toBeGreaterThan(0);
    expect(extra).toBeLessThanOrEqual(notes * 3);
  });

  it('no draft notice (owner, 22 Nov 2026): the first text is the form\'s own heading', () => {
    const texts = ops.filter((op): op is Extract<Form26PdfOp, { op: 'text' }> => op.op === 'text');
    expect(ops[0]).toEqual({ op: 'page', orientation: 'portrait' });
    expect(texts[0].text).toBe('FORM NO. 26');
    expect(planLines(ops).join('\n')).not.toMatch(/Draft review note|Draft prepared in ICAI VERA/);
  });

  it('portrait pages for the form, landscape for the schedules: the schedules start on a landscape page', () => {
    const pages = ops.flatMap((op, i) => (op.op === 'page' ? [{ i, orientation: op.orientation }] : []));
    expect(pages.map((page) => page.orientation)).toEqual(['portrait', 'landscape']);
    const next = ops[pages[1].i + 1];
    expect(next).toMatchObject({ op: 'text', text: 'Schedule – General Information', bold: true });
    // Nothing of the schedules before the landscape page; nothing of the form after it.
    const before = planLines(ops.slice(0, pages[1].i)).join('\n');
    expect(before).not.toContain('11. (b) Particulars of changes in members/partners');
    expect(planLines(ops.slice(pages[1].i)).join('\n')).not.toContain('Part C: Particulars of the assessee');
  });

  it('font size steps 9, 8, 7, 6 by the number of columns (6 or fewer, 9, 12, more)', () => {
    expect([1, 6, 7, 9, 10, 12, 13, 17].map(form26PdfFontSize)).toEqual([9, 9, 8, 8, 7, 7, 6, 6]);
    for (const op of ops) if (op.op === 'table' && op.theme === 'grid') expect(op.fontSize).toBe(form26PdfFontSize(op.columnShare.length));
  });

  it('S47 (13 columns) and S53bi (17) keep all their headings at the smallest size; every table keeps every column', () => {
    const tables = ops.filter((op): op is TableOp => op.op === 'table');
    const find = (heading: string) => {
      const at = ops.findIndex((op) => op.op === 'text' && op.text.startsWith(heading));
      return ops.slice(at).find((op): op is TableOp => op.op === 'table')!;
    };
    for (const [id, heading, columns] of [['S47', '47.', 13], ['S53bi', '53. (b)(i)', 17]] as const) {
      const table = find(heading);
      const def = DEF.tables.find((t) => t.id === id)!;
      expect(table.columnShare).toHaveLength(columns);
      expect(table.fontSize).toBe(6);
      const printed = table.head.flat().map(cellText);
      for (const cell of def.headerRows.flatMap((row) => row.cells)) expect(printed).toContain(form26PdfText(cell.text));
      expect(table.body.every((row) => row.reduce((n, cell) => n + (typeof cell === 'string' ? 1 : cell.colSpan ?? 1), 0) === columns)).toBe(true);
    }
    for (const table of tables) {
      expect(table.columnShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(table.body.every((row) => row.reduce((n, cell) => n + (typeof cell === 'string' ? 1 : cell.colSpan ?? 1), 0) === table.columnShare.length)).toBe(true);
    }
  });

  it('headings of the tables are shaded and bold; the letters row is not', () => {
    const table = ops.find((op): op is TableOp => op.op === 'table' && op.head.length === 2)!;
    expect(table.head[0].every((cell) => typeof cell !== 'string' && cell.fill === true && cell.bold === true)).toBe(true);
    expect(table.head[1].every((cell) => typeof cell === 'string' || (!cell.fill && !cell.bold))).toBe(true);
  });

  it("every character it prints is one the PDF's standard font holds: ₹ has a plain substitute, the tick boxes are drawn", () => {
    expect(FORM26_PDF_SUBSTITUTES).toEqual({ '₹': 'Rs.', '\u00A0': ' ' });
    const unprintable = planLines(ops).flatMap((line) => [...line.split(FORM26_PDF_BOX).join('')].filter((char) => !isForm26PdfPrintable(char)).map((char) => `"${char}" in "${line.slice(0, 60)}"`));
    // (The rooms of the tick boxes are non-breaking spaces, which the font holds; the boxes are drawn in them.)
    expect(unprintable).toEqual([]);
    // The form's own text has only these three outside the font (plus non-breaking spaces): nothing else is changed.
    const { portrait, landscape } = exportModelLines(model);
    const outside = new Set([...portrait, ...landscape].join('').split('').filter((char) => !isForm26PdfPrintable(char)));
    expect([...outside].sort()).toEqual(['\u00A0', '₹', '☐', '☑'].sort());
    // No character fell back to "?": the plan has exactly the question marks of the form's own wording.
    const marks = (text: string) => text.split('?').length - 1;
    expect(marks(planLines(ops).join(''))).toBe(marks([...portrait, ...landscape].join('')));
    // No "[X]" / "[ ]" is printed any more (lead's ruling: vector tick boxes).
    expect(planLines(ops).join('\n')).not.toMatch(/\[X\]|\[ \]/);
  });

  it('form26PdfMarks: each ☑ / ☐ becomes the room of its box in the text and a box in order (chosen = true)', () => {
    expect(form26PdfMarks('☑ (i) one ☐ (ii) two\u00A0₹')).toEqual({ text: `${FORM26_PDF_BOX} (i) one ${FORM26_PDF_BOX} (ii) two Rs.`, boxes: [true, false] });
    expect(form26PdfMarks('no box')).toEqual({ text: 'no box', boxes: [] });
    // The room is the only place non-breaking spaces remain in the printed text (every other one is a space).
    expect(FORM26_PDF_BOX).toMatch(/^\u00A0+$/);
    expect(form26PdfText('a\u00A0b ☑')).toBe(`a b ${FORM26_PDF_BOX}`);
  });

  it('the tick boxes of the plan: one box per ☑ / ☐ of the model, in order, each with its room in the text', () => {
    const { portrait, landscape } = exportModelLines(model);
    const symbols = [...[...portrait, ...landscape].join('')].filter((char) => char === '☑' || char === '☐');
    expect(symbols.length).toBeGreaterThan(3);
    const planned: boolean[] = [];
    const room = new RegExp(FORM26_PDF_BOX, 'g');
    const look = (text: string, boxes: boolean[] | undefined) => {
      expect((text.match(room) ?? []).length).toBe(boxes?.length ?? 0);
      planned.push(...(boxes ?? []));
    };
    for (const op of ops) {
      if (op.op === 'text') look(op.text, op.boxes);
      if (op.op === 'table') for (const row of [...op.head, ...op.body, ...(op.foot ? [op.foot] : [])]) for (const cell of row) look(cellText(cell), typeof cell === 'string' ? undefined : cell.boxes);
    }
    expect(planned).toEqual(symbols.map((char) => char === '☑'));
    expect(planned.some(Boolean) && planned.some((chosen) => !chosen)).toBe(true);
  });
});

describe('renderForm26Pdf', () => {
  it('the as-opened model gives a PDF (first bytes %PDF) of at least 3 pages, A4, portrait then landscape', async () => {
    const bytes = render(build(defaultValues(DEF)));
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    const pages = await pdfPages(bytes);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(Math.round(pages[0].width)).toBe(595);
    expect(Math.round(pages[0].height)).toBe(842);
    const last = pages[pages.length - 1];
    expect(Math.round(last.width)).toBe(842);
    expect(Math.round(last.height)).toBe(595);
    const firstLandscape = pages.findIndex((page) => page.width > page.height);
    expect(pages.slice(firstLandscape).every((page) => page.width > page.height)).toBe(true);
    expect(noSpace(pages[firstLandscape].text).startsWith(noSpace('Schedule – General Information'))).toBe(true);
    expect(noSpace(pages[0].text).startsWith(noSpace('FORM NO. 26'))).toBe(true);
    expect(pages.map((page) => page.text).join('\n')).not.toMatch(/Draft review note|Draft prepared in ICAI VERA/);
    // Drawing and reading back a PDF takes several seconds while the other files run: the limit its siblings have.
  }, 60000);

  for (const name of ['default', 'filledCat2', 'filledCat1'] as const) {
    it(`the text read back from the PDF holds every line of the model in order (${name})`, async () => {
      const model = build(valuesOf(SAVES[name]));
      const pages = await pdfPages(render(model));
      const { portrait, landscape } = exportModelLines(model);
      const firstLandscape = pages.findIndex((page) => page.width > page.height);
      const portraitText = noSpace(pages.slice(0, firstLandscape).map((page) => page.text).join(''));
      const landscapeText = noSpace(pages.slice(firstLandscape).map((page) => page.text).join(''));
      expectInOrder(portraitText, portrait);
      expectInOrder(landscapeText, landscape);
    }, 60000);
  }

  it('no page ends with a heading: a heading starts on the page of what follows it', async () => {
    const model = build(valuesOf(SAVES.filledCat2));
    const ops = planForm26Pdf(model);
    // Headings whose words appear nowhere else (a schedule group's name is also in the "If yes, refer …" lines).
    const all = noSpace(planLines(ops).join(''));
    const headings = ops
      .flatMap((op) => (op.op === 'text' && op.heading ? [noSpace(op.text)] : []))
      .filter((heading) => all.indexOf(heading) === all.lastIndexOf(heading));
    expect(headings.length).toBeGreaterThan(60);
    const pages = await pdfPages(render(model));
    for (const page of pages) {
      const text = noSpace(page.text);
      for (const heading of headings) expect(text.endsWith(heading), `a page ends with "${heading}"`).toBe(false);
    }
  }, 60000);

  it('the tick boxes are drawn as squares standing on the baseline of their text, the chosen one with a tick (two strokes)', () => {
    const model = build(valuesOf(SAVES.filledCat2));
    const ops = planForm26Pdf(model);
    const cells = (op: TableOp) => [...op.head, ...op.body, ...(op.foot ? [op.foot] : [])].flat();
    const wanted = ops.flatMap((op) => (op.op === 'text' ? op.boxes ?? [] : op.op === 'table' ? cells(op).flatMap((cell) => (typeof cell === 'string' ? [] : cell.boxes ?? [])) : []));
    const drawn: { chosen: boolean; x: number; top: number; side: number; baseline: number; strokes: number }[] = [];
    renderForm26Pdf(ops, { onBox: (box) => drawn.push(box) });
    expect(drawn.length).toBeGreaterThan(3);
    expect(drawn.map((box) => box.chosen)).toEqual(wanted);
    for (const box of drawn) {
      expect(box.side).toBeGreaterThan(4);
      expect(box.side).toBeLessThan(9);
      expect(Math.abs(box.top + box.side - box.baseline)).toBeLessThan(0.01);
      expect(box.strokes).toBe(box.chosen ? 2 : 0);
    }
  });

  it('the PDF read back has no "[X]" or "[ ]"', async () => {
    const pages = await pdfPages(render(build(valuesOf(SAVES.filledCat2))));
    expect(pages.map((page) => page.text).join('')).not.toMatch(/\[X\]|\[ \]/);
  }, 60000);

  it('the file name is the file stem with .pdf', () => {
    expect(form26PdfFileName(build(valuesOf(SAVES.filledCat2)))).toBe('Form26_AAAAA0000A.pdf');
  });

  /** 250 rows in a table: every add/delete table (`all`) or S29 alone; S29's rows of one to seven lines. */
  const big = (all: boolean) => {
    const values = valuesOf(SAVES.filledCat2);
    for (const table of DEF.tables) {
      if (table.kind !== 'rows' || (!all && table.id !== 'S29')) continue;
      const row = values.t[table.id]?.[0] ?? {};
      values.t[table.id] = Array.from({ length: 250 }, (_, i) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, `${value} #${i + 1}#`])));
    }
    // The nature of the transaction over one to seven lines, so page ends fall inside rows.
    values.t.S29 = values.t.S29.map((row, i) => ({ ...row, 4: `${row[4]}\n${'another line\n'.repeat(i % 6)}end of row #${i + 1}#` }));
    return build(values);
  };

  it('a 250-row table runs across pages: no row is cut between two pages or lost, in order; its headings on every page', async () => {
    const pages = (await pdfPages(render(big(false)))).map((page) => noSpace(page.text));
    const pageOf = (token: string) => pages.flatMap((text, n) => (text.includes(noSpace(token)) ? [n] : []));
    let lastPage = -1;
    const pagesUsed = new Set<number>();
    for (let i = 1; i <= 250; i += 1) {
      const first = pageOf(`Invented S29 r1 c1 #${i}#`);
      const last = pageOf(`end of row #${i}#`);
      const amount = pageOf(`105 #${i}#`);
      expect(first, `row ${i}`).toHaveLength(1);
      expect(last, `row ${i}`).toEqual(first);
      expect(amount, `row ${i}`).toEqual(first);
      expect(first[0]).toBeGreaterThanOrEqual(lastPage);
      lastPage = first[0];
      pagesUsed.add(first[0]);
    }
    expect(pagesUsed.size).toBeGreaterThan(3);
    for (const n of pagesUsed) expect(pages[n]).toContain(noSpace('Amount debited to profit & loss account'));
  }, 120000);

  it('250 rows in every add/delete table (13,000 rows): planned and drawn in reasonable time', () => {
    const model = big(true);
    const started = performance.now();
    const doc = renderForm26Pdf(planForm26Pdf(model));
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    const ms = performance.now() - started;
    console.info(`[T22] PDF, 250 rows per table: ${ms.toFixed(0)} ms to plan and render, ${doc.getNumberOfPages()} pages, ${(bytes.length / 1e6).toFixed(1)} MB`);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    expect(doc.getNumberOfPages()).toBeGreaterThan(300);
    expect(ms).toBeLessThan(90000);
  }, 180000);
});

describe('the PDF file (FIX-T29)', () => {
  it('is made as a PDF Blob for the save window, never saved by jsPDF through a download', async () => {
    const model = buildForm26ExportModel(DEF, defaultValues(DEF), { showAllSchedules: false, generatedAt: '2026-11-23T00:00:00.000Z' });
    const blob = buildForm26PdfBlob(model);
    expect(blob.type).toBe('application/pdf');
    expect(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    expect(form26PdfFileName(model)).toBe('Form26_Form26.pdf');
    expect(Object.keys(await import('@/lib/taxAuditForm26Pdf'))).not.toContain('saveForm26Pdf');
  }, 60000);
});
