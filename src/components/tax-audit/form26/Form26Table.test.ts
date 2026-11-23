import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Form26Table, type Form26TableProps } from '@/components/tax-audit/form26/Form26Table';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import type { Form26Table as Form26TableDef } from '@/data/taxAuditForm26Types';
import { tableTotals } from '@/lib/taxAuditForm26Calc';
import { cellAccessibleName, chooseTableLayout, depreciationColumnLabels } from '@/lib/taxAuditForm26Layout';
import { setCell, startRows } from '@/lib/taxAuditForm26TableOps';
import type { Form26Row } from '@/lib/taxAuditForm26Values';
import { attributeValues, expectControlsNamed, expectFinished, expectReferencesResolve, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

// The tables drawn without a browser (react-dom/server): layouts by room, headings, rows, totals, states.
const tableOf = (id: string): Form26TableDef => {
  const table = DEF.tables.find((entry) => entry.id === id);
  if (!table) throw new Error(`no table ${id}`);
  return table;
};

function draw(id: string, extra: Partial<Form26TableProps> = {}): string {
  const table = tableOf(id);
  const html = renderToStaticMarkup(
    createElement(Form26Table, {
      table,
      rows: startRows(table),
      locked: false,
      unfilled: [],
      highlight: false,
      layout: chooseTableLayout(table, 2000),
      onChange: () => undefined,
      onLeave: () => undefined,
      focus: null,
      ...extra,
    }),
  );
  expectFinished(html);
  expectReferencesResolve(html);
  expectControlsNamed(html);
  return html;
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe('Form 26 tables (static render)', () => {
  it('a grid: the file\'s headings word for word with the letter row, serial numbers, named cells, the Total line and "Add row"', () => {
    const table = tableOf('S28');
    let rows: Form26Row[] = startRows(table);
    rows = setCell(table, rows, 0, '1', 'Invented Act');
    rows = setCell(table, rows, 0, '3', '700');
    rows = setCell(table, rows, 1, '3', '300');
    const html = draw('S28', { rows });
    expect(html).toContain('<table');
    for (const cell of table.headerRows.flatMap((row) => row.cells)) expect(visibleText(html)).toContain(cell.text);
    expect(html).toContain('id="f26-t-S28-0-1"');
    expect(html).toContain(`aria-label="${cellAccessibleName(table, '1', 0)}"`);
    expect(html).toContain('value="Invented Act"');
    expect(tableTotals(table, rows)).toEqual({ '3': '1,000' });
    expect(visibleText(html)).toContain('Total 1,000');
    expect(visibleText(html)).toContain('Add row');
    expect(count(html, /aria-label="Delete row \d+"/g)).toBe(2);
    expect(html).toContain('<span class="sr-only">Delete row</span>');
    // The global table rule (cut at 250 px, no wrap) is overridden on every cell.
    for (const cls of attributeValues(html, 'class').filter((value) => value.includes('align-top'))) expect(cls).toContain('!whitespace-normal');
  });

  it('a calculated cell is an ordinary number box with a soft background, filled by the file\'s formula', () => {
    const table = tableOf('S15b');
    const rows = setCell(table, setCell(table, startRows(table), 0, '2', '1234.567'), 0, '3', '234.561');
    const html = draw('S15b', { rows });
    expect(html).toMatch(/<input type="number"[^>]*class="[^"]*bg-muted\/60[^"]*"[^>]*id="f26-t-S15b-0-4"[^>]*value="1000.01"/);
    expect(visibleText(html)).toContain('Total 1,234.57 234.56 1,000.01');
  });

  it('every table of added rows has a delete control (S38 has no "Sl. No." in the file); a fixed table has none and takes no rows', () => {
    expect(count(draw('S38'), /aria-label="Delete row \d+"/g)).toBe(tableOf('S38').startRows);
    const fixed = draw('P12d');
    expect(fixed).not.toContain('Delete row');
    expect(visibleText(fixed)).not.toContain('Add row');
    expect(visibleText(fixed)).toContain('(i) Total turnover');
    expect(visibleText(fixed)).toContain('(v) Material consumed/Finished goods produced');
    expect(fixed).toContain('aria-label="(C) Tax year, (ii) Gross profit/Turnover"');
  });

  it('a wide table as a row list: rows summed up with full headings, one row open as a form labelled with letter and full heading', () => {
    const table = tableOf('S45a');
    expect(chooseTableLayout(table, 730)).toBe('rowlist');
    const rows: Form26Row[] = [
      { '1': 'Loan', '2': 'Invented Lender One', '3': 'AAAAA0000A', '4': '', '5': '500000', '6': 'Yes', '7': 'No', '8': '500000', '9': 'A - Cash payment' },
      { '1': 'Deposit', '2': 'Invented Lender Two', '3': '', '4': '', '5': '250000', '6': '', '7': '', '8': '', '9': '' },
    ];
    const html = draw('S45a', { rows, layout: 'rowlist' });
    expect(html).not.toContain('<table');
    expect(visibleText(html)).toContain('(B) Nature of transaction (Loan/ Deposit/ Specified sum)');
    expect(html).toContain('aria-label="Row 1: Loan; Invented Lender One; AAAAA0000A. Complete"');
    expect(html).toContain('aria-label="Row 2: Deposit; Invented Lender Two. 5 to fill"');
    // The row with cells to fill opens first; only its controls are drawn.
    expect(html).toContain('aria-expanded="true"');
    expect(count(html, /role="group"/g)).toBe(1);
    expect(count(html, /<(input|select|textarea)\b(?![^>]*aria-hidden)/g)).toBe(9);
    expect(html).toContain('for="f26-t-S45a-1-6"');
    expect(visibleText(html)).toContain('(G) Whether accepted through modes as per section 185(1) (Yes/No)');
    // In the box the amount stays as typed (no grouped figures in an input).
    expect(html).toMatch(/id="f26-t-S45a-1-5"[^>]*value="250000"/);
    expect(visibleText(html)).toContain('Add row');
    // An amount among the summing-up columns is shown grouped the Indian way.
    const s28 = draw('S28', { rows: [{ '1': 'Invented Act', '2': '12', '3': '1500000' }], layout: 'rowlist' });
    expect(s28).toContain('aria-label="Row 1: Invented Act; 12; 15,00,000. Complete"');
    expect(visibleText(s28)).toContain('Invented Act 12 15,00,000 Complete');
  });

  it('a row list in a narrow editor sums a row up in fewer columns, so no heading is squeezed or broken inside a word (task 20, POLISH-1, 1280 x 720)', () => {
    const narrow = draw('S45a', { layout: 'rowlist', room: 326 });
    expect(narrow).toContain('grid-template-columns:2.75rem repeat(1, minmax(0, 1fr)) 4.75rem 1rem');
    const wide = draw('S45a', { layout: 'rowlist', room: 700 });
    expect(wide).toContain('grid-template-columns:2.75rem repeat(3, minmax(0, 1fr)) 4.75rem 1rem');
    // Without a room given (as before): three.
    expect(draw('S45a', { layout: 'rowlist' })).toContain('repeat(3, minmax(0, 1fr))');
    // No room for even one column: the line keeps its number and state only.
    const tiny = draw('S45a', { layout: 'rowlist', room: 150 });
    expect(tiny).toContain('grid-template-columns:2.75rem minmax(0, 1fr) 1rem');
    expect(visibleText(tiny)).not.toContain('Nature of transaction (Loan/ Deposit/ Specified sum) Row');
    // A heading never breaks inside a word: no class that lets a line break anywhere in a word.
    for (const html of [narrow, wide]) expect(html).not.toMatch(/break-all|\[overflow-wrap:anywhere\]/);
  });

  it('a depreciation table in blocks: a label too long for its line breaks rather than spilling out (task 20, 1280 x 720)', () => {
    const html = draw('Dpm', { layout: 'blocks' });
    const labels = (html.match(/<label for="f26-t-Dpm-[^"]*" class="[^"]*"/g) ?? []);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toContain('break-words');
  });

  it('the same table as a grid where there is room', () => {
    const html = draw('S45a', { layout: 'table' });
    expect(html).toContain('<table');
    expect(count(html, /id="f26-t-S45a-\d+-\d+"/g)).toBe(2 * 9);
  });

  it('250 rows in a row list: 250 short lines and the controls of one open row only', () => {
    const table = tableOf('S29');
    const rows: Form26Row[] = Array.from({ length: 250 }, (_, index) => ({ '1': `Invented Person ${index + 1}`, '2': 'AAAAA0000A', '3': 'Relative', '4': 'Purchase', '5': String(1000 + index) }));
    rows[239] = { ...rows[239], '5': '' };
    const html = draw('S29', { rows, layout: 'rowlist' });
    expect(count(html, /aria-expanded=/g)).toBe(250);
    expect(count(html, /<input\b/g)).toBe(5);
    expect(html).toContain('id="f26-t-S29-239-5"');
  });

  it('a full table (5,000 rows): "Add row" stays focusable and says why it takes no more', () => {
    const rows: Form26Row[] = Array.from({ length: 5000 }, () => ({ '1': 'Invented Act', '2': '12', '3': '1' }));
    const html = draw('S28', { rows, layout: 'rowlist' });
    expect(html).toMatch(/<button [^>]*type="button" aria-disabled="true" aria-describedby="f26-t-S28-limit"[^>]*>.*?Add row<\/button>/);
    expect(visibleText(html)).toContain('Add row A table can hold at most 5,000 rows.');
    expect(draw('S28')).not.toContain('aria-disabled');
    // Drawing 5,000 rows takes 3-5 s while the other test files run beside it (it went past vitest's 5 s three times
    // in a row in task 27's runs, at 5.1 s): a time limit of its own.
  }, 30000);

  it('a depreciation table as the file\'s table where it fits: headings, rows 3 to 21, calculated rows shaded', () => {
    const table = tableOf('Dpm');
    expect(chooseTableLayout(table, 730)).toBe('table');
    const rows = setCell(table, startRows(table), 0, '0', '1000');
    const html = draw('Dpm', { rows, layout: 'table' });
    expect(html).toContain('colSpan="4"');
    expect(visibleText(html)).toContain('Plant and machinery');
    for (const row of table.dep?.rows ?? []) expect(visibleText(html)).toContain(row.label);
    expect(count(html, /<input\b/g)).toBe(19 * 4);
    expect(html).toMatch(/id="f26-t-Dpm-3-60"[^>]*value="1000"/);
    expect(html).toMatch(/id="f26-t-Dpm-7-140"[^>]*value="150"/);
    expect(count(html, /<tr class="bg-muted\/30">/g)).toBe(7);
  });

  it('a depreciation table that does not fit: one rate column at a time, chosen from the rate columns by block and rate', () => {
    const table = tableOf('Dot');
    expect(chooseTableLayout(table, 730)).toBe('blocks');
    const html = draw('Dot', { layout: 'blocks' });
    expect(html).toContain('role="tablist"');
    expect(count(html, /role="tab"/g)).toBe(7);
    for (const label of depreciationColumnLabels(table)) expect(visibleText(html)).toContain(label);
    expect(html).toContain('aria-selected="true"');
    expect(count(html, /<input\b/g)).toBe(16);
    expect(html).toContain('for="f26-t-Dot-0-0"');
  });

  it('locked: no adding or deleting, read-only cells, and no empty column reserved for a delete control (POLISH-1)', () => {
    const html = draw('S28', { locked: true });
    expect(visibleText(html)).not.toContain('Add row');
    expect(html).not.toContain('aria-label="Delete row');
    expect(html).not.toContain('<span class="sr-only">Delete row</span>');
    // One <col> per column of the file (S28: Sl. No., law, section, amount), none for a delete column.
    expect(count(html, /<col /g)).toBe(tableOf('S28').columns.length);
    // The Total line has exactly the table's columns too.
    expect(count(html.slice(html.indexOf('<tfoot')), /<td /g)).toBe(1 + tableOf('S28').columns.length - (tableOf('S28').total?.labelColspan ?? 0));
    expect(count(html, /readonly=""/g)).toBe(2 * 3);
    const rowList = draw('S45a', { locked: true, layout: 'rowlist', rows: [{ '1': 'Loan', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': '' }] });
    expect(rowList).toMatch(/<select[^>]*disabled=""/);
    expect(rowList).not.toContain('w-9 shrink-0');
    // Open for editing, the delete column is there.
    expect(count(draw('S28'), /<col /g)).toBe(tableOf('S28').columns.length + 1);
    expect(draw('S45a', { layout: 'rowlist' })).toContain('w-9 shrink-0');
  });

  it('unfilled cells: tinted with a dashed edge only with "Highlight unfilled", always described for screen readers', () => {
    const items = [{ t: 'S28', r: 0, c: '1' }];
    const quiet = draw('S28', { unfilled: items });
    expect(quiet).toMatch(/id="f26-t-S28-0-1" aria-label="[^"]*" aria-describedby="f26-t-S28-hint" data-unfilled="true"/);
    expect(quiet).not.toContain('bg-warning-soft');
    const tinted = draw('S28', { unfilled: items, highlight: true });
    expect(count(tinted, /bg-warning-soft/g)).toBe(1);
    expect(tinted).toContain('border-dashed');
  });
});

// FIX-T29 D1: a fixed table drawn as a row list showed only "1, 2, 3 … Empty" at 1280 x 720 (12(d), 16(b), 20,
// 17, 18, 27, 34). Every fixed row must show its pre-printed labels on its line and at the top of the open row.
describe('fixed rows in a row list keep their labels (FIX-T29 D1)', () => {
  const fixedTables = DEF.tables.filter((entry) => entry.fixedRows !== undefined);
  const filled = (table: Form26TableDef, row: Form26Row): Form26Row => {
    const next = { ...row };
    for (const column of table.columns) if (column.input) next[column.c] = column.type === 'yn' ? 'Yes' : '1';
    return next;
  };
  // Rows before `r` complete, so that row `r` is the one the list opens with.
  const openAt = (table: Form26TableDef, r: number) => startRows(table).map((row, i) => (i < r ? filled(table, row) : row));
  const lineOf = (html: string, id: string, r: number) => new RegExp(`<button[^>]*id="f26-t-${id}-row-${r}"[^>]*>([^]*?)</button>`).exec(html)?.[1] ?? '';
  const formOf = (html: string, id: string, r: number) => new RegExp(`<div id="f26-t-${id}-row-${r}-form"[^>]*>([^]*?)<label`).exec(html)?.[0] ?? '';

  it('EVERY fixed row of EVERY fixed table, at the rooms of 1280 x 720 and 1600 x 900: its labels on its line (whole, wrapping between words) and at the top of the open row', () => {
    let checked = 0;
    for (const table of fixedTables) {
      for (const room of [326, 533]) {
        (table.fixedRows ?? []).forEach((labels, r) => {
          const html = draw(table.id, { rows: openAt(table, r), layout: 'rowlist', room });
          const name = labels.join(' ');
          const line = lineOf(html, table.id, r);
          expect(visibleText(line).startsWith(name), `${table.id} row ${r} line at ${room}: ${visibleText(line)}`).toBe(true);
          expect(line).toContain('data-f26-row-labels=""');
          expect(line).not.toMatch(/break-all|\[overflow-wrap:anywhere\]|whitespace-nowrap/);
          const form = formOf(html, table.id, r);
          expect(form, `${table.id} row ${r} open`).toContain(`aria-label="${name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`);
          expect(visibleText(form).startsWith(name), `${table.id} row ${r} open: ${visibleText(form)}`).toBe(true);
          // Every other row's line also carries its own labels (not only the open one).
          (table.fixedRows ?? []).forEach((other, o) => expect(visibleText(lineOf(html, table.id, o)).startsWith(other.join(' '))).toBe(true));
          checked += 1;
        });
      }
    }
    expect(checked).toBe(2 * 93);
  });

  it('no number column on a fixed row\'s line; with room for summing-up columns the labels sit on a line of their own above them', () => {
    const narrow = draw('S20', { layout: 'rowlist', room: 326 });
    expect(narrow).toContain('grid-template-columns:repeat(1, minmax(0, 1fr)) 4.75rem 1rem');
    expect(narrow).toMatch(/style="grid-column:1 \/ -1" data-f26-row-labels=""/);
    expect(visibleText(lineOf(narrow, 'S20', 0))).toBe('(i) 2(40)(e) Deemed dividend Empty');
    const tiny = draw('S20', { layout: 'rowlist', room: 150 });
    expect(tiny).toContain('grid-template-columns:minmax(0, 1fr) 4.75rem 1rem');
    expect(visibleText(lineOf(tiny, 'S20', 12))).toBe('(xiii) - Capital receipt, if any Empty');
    // A table of added rows keeps its number column.
    expect(visibleText(lineOf(draw('S45a', { layout: 'rowlist', room: 326 }), 'S45a', 0))).toMatch(/^1 /);
  });

  it('both depreciation tables in blocks show every row by its number and label', () => {
    for (const id of ['Dpm', 'Dot']) {
      const table = tableOf(id);
      const html = draw(id, { layout: 'blocks' });
      for (const row of table.dep?.rows ?? []) expect(visibleText(html), `${id} ${row.no}`).toContain(row.label);
    }
  });
});

describe('a row list\'s Total, figures as the grid shows them (FIX-T29, UX 3.12 item 11)', () => {
  it('each total stands right-aligned in tabular figures under its full heading, as in the grid\'s Total line', () => {
    const table = tableOf('S28');
    const rows = setCell(table, setCell(table, startRows(table), 0, '3', '700'), 1, '3', '1250000');
    const html = draw('S28', { rows, layout: 'rowlist', room: 326 });
    const block = /<div class="[^"]*" data-f26-rowlist-total="">[^]*?<\/dl>/.exec(html)?.[0] ?? '';
    expect(visibleText(block)).toContain('Total');
    expect(visibleText(block)).toContain('12,50,700');
    const pairs = block.match(/<div class="[^"]*"><dt/g) ?? [];
    expect(pairs.length).toBe(1);
    for (const pair of pairs) expect(pair).toContain('text-right');
    expect(block).toMatch(/<dd class="[^"]*text-right[^"]*tabular-nums[^"]*"|<dd class="[^"]*tabular-nums[^"]*text-right[^"]*"/);
    // The grid's own Total line: right-aligned figures (unchanged).
    expect(draw('S28', { rows, layout: 'table' })).toMatch(/<td class="[^"]*text-right font-semibold tabular-nums[^"]*">12,50,700<\/td>/);
  });
});
