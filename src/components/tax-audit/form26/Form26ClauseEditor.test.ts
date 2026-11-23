import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Form26ClauseEditor, type Form26ClauseEditorProps } from '@/components/tax-audit/form26/Form26ClauseEditor';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { buildEditorModel, form26ClockTime } from '@/lib/taxAuditForm26EditorModel';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';
import { expectControlsNamed, expectFinished, expectReferencesResolve, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

// The clause editor drawn without a browser (react-dom/server) for representative states.
type UnfilledState = { name: string; values: Form26Values };
const STATES = JSON.parse(readFileSync(new URL('../../../lib/__fixtures__/taxAuditForm26/unfilled.json', import.meta.url), 'utf8')) as UnfilledState[];
const allYes = (): Form26Values => JSON.parse(JSON.stringify(STATES.find((state) => state.name === 'state allYes')?.values)) as Form26Values;

function clauseRow(clauseKey: string, patch: Partial<Form26ClauseRow> = {}): Form26ClauseRow {
  const unit = FORM26_CLAUSE_UNITS.find((entry) => entry.key === clauseKey);
  return {
    id: `row-${clauseKey}`,
    tax_audit_id: 'audit-1',
    clause_key: clauseKey,
    clause_no: unit?.no ?? clauseKey,
    clause_title: unit?.label ?? clauseKey,
    statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION,
    applicability_status: 'applicable',
    prefill_status: 'not_attempted',
    validation_status: 'not_run',
    qualification_required: 0,
    workpaper_ref: unit?.workpaperRef,
    review_status: 'draft',
    locked: 0,
    ...patch,
  };
}

function draw(clauseKey: string, values: Form26Values = defaultValues(DEF), extra: Partial<Form26ClauseEditorProps> = {}): string {
  const unit = FORM26_CLAUSE_UNITS.find((entry) => entry.key === clauseKey);
  if (!unit) throw new Error(`no clause ${clauseKey}`);
  const view = { showAllSchedules: false };
  const html = renderToStaticMarkup(
    createElement(Form26ClauseEditor, {
      def: DEF,
      unit,
      blocks: buildEditorModel(DEF, clauseKey, values, view, { comparison: false }),
      values,
      row: clauseRow(clauseKey),
      lockedTables: new Set<string>(),
      unfilled: scanUnfilled(DEF, values, view),
      highlightUnfilled: true,
      availableWidth: 900,
      onField: () => undefined,
      onTable: () => undefined,
      onTableLeft: () => undefined,
      onStatus: async () => undefined,
      onRowUpdate: async () => undefined,
      onOpenLastYear: () => undefined,
      focusTarget: null,
      ...extra,
    }),
  );
  expectFinished(html);
  expectReferencesResolve(html);
  expectControlsNamed(html);
  return html;
}

describe('Form 26 clause editor (static render)', () => {
  it('clause 14: heading and status line, every wording exactly, number | wording | answer on one grid, table P14a under 14(a)', () => {
    const unit = FORM26_CLAUSE_UNITS.find((entry) => entry.key === 'f26_c14')!;
    const html = draw('f26_c14');
    const text = visibleText(html);
    expect(text.startsWith(`Clause 14 · ${unit.label} Draft · TA-F26-14`)).toBe(true);
    for (const index of unit.questionRows) {
      const row = DEF.questionRows[index];
      if (row.wording) expect(text).toContain(row.wording);
    }
    expect(html).toContain('id="f26-q23-wording"');
    expect(html).toMatch(/<select [^>]*id="f26-f-c14d" aria-labelledby="f26-q23-wording"/);
    expect(html).toContain('grid-cols-[3.25rem_minmax(0,1fr)_minmax(11rem,40%)]');
    expect(html).toContain('id="f26-t-P14a"');
    expect(html).toContain('aria-label="Address at which books of account are maintained, row 1"');
    // Unfilled at open: the rows 14(b), (c) and (e) carry the hollow ring; 14(d) (answered) does not.
    expect((html.match(/rounded-full border-2 border-subtle/g) ?? []).length).toBe(3);
  });

  it('every question\'s wording, every schedule heading and every column heading is on screen word for word when every answer is Yes', () => {
    const values = allYes();
    values.f.cat = '';
    for (const unit of FORM26_CLAUSE_UNITS) {
      const text = visibleText(draw(unit.key, values, { availableWidth: 4000 }));
      for (const index of unit.questionRows) {
        const row = DEF.questionRows[index];
        if (row.wording) expect(text, `${unit.key} row ${index}`).toContain(row.wording);
      }
      for (const scheduleId of unit.schedules) expect(text).toContain(DEF.schedules.find((entry) => entry.id === scheduleId)?.title);
      for (const tableId of unit.tables) {
        const table = DEF.tables.find((entry) => entry.id === tableId)!;
        for (const cell of table.headerRows.flatMap((headerRow) => headerRow.cells)) expect(text, `${tableId} heading`).toContain(cell.text);
      }
    }
  });

  it('Yes with its schedule: the schedule opens under its question with the group heading, its own heading and its table; the link line goes to it', () => {
    const values = defaultValues(DEF);
    expect(draw('f26_c28', values)).not.toContain('id="f26-s-s28"');
    values.f.c28 = 'Yes';
    const html = draw('f26_c28', values);
    expect(html).toMatch(/<section id="f26-s-s28" aria-labelledby="f26-s-s28-title" tabindex="-1"/);
    expect(visibleText(html)).toContain('Schedule – Computation of Expenses 28. Particulars of penalty levied under any law in force in or outside India');
    expect(visibleText(html)).toContain('If yes, refer Schedule – Computation of Expenses');
    expect(html).toMatch(/<button type="button"[^>]*>Schedule – Computation of Expenses<\/button>/);
    expect(html).toContain('id="f26-t-S28-1-3"');
  });

  it('a wide schedule is a row list at 1280 px with the right pane closed and a table where there is room', () => {
    const values = defaultValues(DEF);
    values.f.c45a = 'Yes';
    const narrow = draw('f26_c45', values, { availableWidth: 616 });
    expect(narrow).toMatch(/id="f26-t-S45a"/);
    expect(narrow).not.toContain('<table');
    expect(narrow).toContain('aria-expanded');
    const wide = draw('f26_c45', values, { availableWidth: 1600 });
    expect(wide).toContain('<table');
  });

  it('depreciation: the plant and machinery table as a table, the other assets by rate column, and the file\'s hint under them', () => {
    const values = defaultValues(DEF);
    values.f.c36 = 'Yes';
    const html = draw('f26_c36', values, { availableWidth: 900 });
    expect(html).toContain('id="f26-t-Dpm"');
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).toContain('role="tablist"');
    expect(visibleText(html)).toContain('Rows shaded as calculated fields fill automatically from the formulas printed in the form; you can overwrite any figure.');
    expect(visibleText(html)).toContain('Depreciation on Plant and Machinery (Other than assets on which full capital expenditure is allowable as deduction under any other section)');
  });

  it('category: the heading, the two options word for word as one group named by its heading, and the file\'s hint on the categories (not its "Tip")', () => {
    const html = draw('f26_category');
    const text = visibleText(html);
    expect(text).toContain('FORM NO. 26');
    expect(text).toContain('[See rule 47]');
    expect(text).toContain('Category of assessee (select one)');
    for (const option of DEF.fields.find((field) => field.key === 'cat')?.radioOptions ?? []) expect(text).toContain(option.label);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Category of assessee (select one)"');
    expect(text).toContain('Category (i) shows Parts A, C and D. Category (ii) shows Parts B, C and D.');
    expect(text).not.toContain('Tip:');
  });

  it('Part A: the sentences with their answers in them, each answer named by its words; the signature block with its labels; the notes', () => {
    const values = defaultValues(DEF);
    values.f.cat = '1';
    const html = draw('f26_part_a', values);
    expect(html).toContain('aria-label="1. I report that the statutory audit of"');
    expect(html).toContain('placeholder="name of assessee"');
    expect(visibleText(html)).toContain('1. I report that the statutory audit of');
    expect(html).toMatch(/<label id="f26-f-A-place-name" for="f26-f-A-place"[^>]*>Place:<\/label>/);
    expect(html).toMatch(/aria-labelledby="f26-f-A-place-name"/);
    expect(visibleText(html)).toContain('Signature');
    expect(visibleText(html)).toContain('Notes: This report has to be signed by an accountant as defined in section 515(3)(b).');
  });

  it('signature and notes of Part D, with the table of codes', () => {
    const text = visibleText(draw('f26_sign'));
    expect(text).toContain('Name of the Accountant:');
    expect(text).toContain('Journal entry [Debit]');
    expect(text).toContain('Some of the information in the Form would be pre-filled to the extent possible.');
  });

  it('locked: read-only answers and tables, no adding or deleting rows, no unfilled marks, the heading says so', () => {
    const values = defaultValues(DEF);
    values.f.c28 = 'Yes';
    const html = draw('f26_c28', values, { row: clauseRow('f26_c28', { review_status: 'approved', locked: 1 }) });
    expect(visibleText(html)).toContain('Approved · TA-F26-28 · Read-only');
    expect(html).toMatch(/<select [^>]*disabled=""/);
    expect(visibleText(html)).not.toContain('Add row');
    expect(html).not.toContain('aria-label="Delete row');
    expect(html).not.toContain('border-subtle');
    expect(html).not.toContain('bg-warning-soft');
    expect(html).toContain('lucide-lock');
  });

  it('validation (unfilled) and save failed: the field keeps the entry; a change by someone else and an approval while typing are said under the answer', () => {
    const values = defaultValues(DEF);
    values.f.c14b = 'Invented Books';
    const conflicts = { c14b: { theirs: 'Other Books', at: '2026-11-22 10:42:05' } };
    const open = draw('f26_c14', values, { conflicts });
    expect(open).toContain('value="Invented Books"');
    expect(visibleText(open)).toContain(`Changed by someone else at ${form26ClockTime('2026-11-22 10:42:05')}. Keep mine Use theirs`);
    expect(open).toContain('bg-warning-soft');
    const approved = draw('f26_c14', values, { conflicts, row: clauseRow('f26_c14', { review_status: 'approved', locked: 1 }) });
    expect(visibleText(approved)).toContain('This clause was approved while you were typing. Your entry was not saved. Use theirs');
  });

  it('the review bar and the footer are drawn where they belong; a value from the client master carries its chip', () => {
    const values = defaultValues(DEF);
    values.f['C.name'] = 'Invented Traders Private Limited';
    const html = draw('f26_p1', values, {
      row: clauseRow('f26_p1', { prefill_status: 'auto_filled' }),
      reviewBar: createElement('div', { id: 'invented-review-bar' }, 'Review bar'),
      footer: createElement('div', { id: 'invented-footer' }, 'Footer'),
    });
    expect(visibleText(html).startsWith('Item 1 · Name Draft · TA-F26-1 Review bar')).toBe(true);
    expect(visibleText(html).endsWith('Footer')).toBe(true);
    expect(visibleText(html)).toContain('From client master');
  });

  it('a narrow clause puts each answer under its wording, on the same left edge', () => {
    const html = draw('f26_c14', defaultValues(DEF), { availableWidth: 372 });
    expect(html).toContain('grid-cols-[3.25rem_minmax(0,1fr)]');
    expect(html).not.toContain('minmax(11rem,40%)');
    expect(html).toContain('min-w-0 col-start-2');
  });

  it('spacing on the 4 / 8 / 12 / 16 / 24 px scale: a wording and its answer 8 px apart, comparison lines 4 px (FIX-T29, UX 3.12 item 2: 6 px and 2 px were measured)', () => {
    for (const width of [372, 760]) {
      const blocks = buildEditorModel(DEF, 'f26_c14', defaultValues(DEF), { showAllSchedules: false }, { comparison: true });
      const markup = draw('f26_c14', defaultValues(DEF), { availableWidth: width, blocks });
      const rows = markup.match(/<div class="[^"]*" data-question-row=/g) ?? [];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toContain('gap-y-2');
        expect(row).not.toMatch(/gap-y-1\.5|gap-y-0\.5/);
      }
      const comparison = markup.match(/<div class="[^"]*" data-f26-comparison=/g) ?? [];
      expect(comparison.length).toBeGreaterThan(0);
      for (const lines of comparison) expect(lines).toContain('space-y-1 ');
    }
    const source = readFileSync(new URL('./Form26ClauseEditor.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/(gap|space)-y-(0\.5|1\.5)/);
  });
});
