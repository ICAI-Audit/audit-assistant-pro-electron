import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The application's contexts make their database client when they are imported; no database is reached
// here (nothing in these tests sends a request), so the client is given a stand-in that refuses everything.
vi.hoisted(() => {
  const holder = globalThis as { window?: unknown };
  if (!holder.window) holder.window = { electronAPI: { sqliteQuery: async () => ({ data: null, error: { message: 'No database in this test.' } }) } };
});

import { Form26ClauseFooter, type Form26ClauseFooterProps } from '@/components/tax-audit/form26/Form26ClauseFooter';
import { Form26ClauseList, Form26ViewSwitches, type Form26ClauseListProps } from '@/components/tax-audit/form26/Form26ClauseList';
import { Form26Header } from '@/components/tax-audit/form26/Form26Header';
import { Form26ReviewBar } from '@/components/tax-audit/form26/Form26ReviewBar';
import { Form26RightPane, type Form26SharedParts } from '@/components/tax-audit/form26/Form26RightPane';
import {
  Form26ConflictBanner,
  Form26ConversionState,
  Form26ErrorState,
  Form26LoadingState,
  Form26NoAccessState,
  Form26NoEngagementState,
  Form26YearUnknownState,
} from '@/components/tax-audit/form26/Form26States';
import type { UseTaxAuditForm26Result } from '@/components/tax-audit/form26/useTaxAuditForm26';
import { Form26WorkspaceBody } from '@/components/tax-audit/form26/Form26Workspace';
import { FORM26_CLAUSE_UNITS, form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { buildListModel, form26ViewSummary } from '@/lib/taxAuditForm26ListModel';
import { summarise } from '@/lib/taxAuditForm26Review';
import type { Form26SaveState } from '@/lib/taxAuditForm26SaveQueue';
import { prefillParticulars, readSetup, seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';
import { form26HeaderModel } from '@/lib/taxAuditForm26Workspace';
import type { TaxAuditClauseEvidence } from '@/types/taxAudit';
import { attributeValues, expectControlsNamed, expectFinished, expectReferencesResolve, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

// The workspace and its parts drawn without a browser (react-dom/server), for the states the plan names.
const html = (element: ReactElement) => {
  const markup = renderToStaticMarkup(element);
  expectFinished(markup);
  // The colour menu of the shared rich-text editor (a Radix popover) names its content, which is put on the
  // page only when the menu opens: that one reference is Radix's own and is not checked here.
  expectReferencesResolve(markup.replace(/ aria-controls="radix-[^"]*"/g, ''));
  expectControlsNamed(markup);
  return markup;
};

// A stand-in for the page's EvidenceRail: it shows what it was given.
const parts: Form26SharedParts = {
  EvidenceRail: ({ clause, evidenceLinks }) =>
    createElement('div', { 'data-rail': clause.clause_key }, `Sources, Evidence and Review · ${clause.workpaper_ref} · ${evidenceLinks.filter((link) => link.clause_response_id === clause.id).length} linked`),
};

function openAudit(): { values: Form26Values; rowsByKey: Map<string, Form26ClauseRow> } {
  const prefill = prefillParticulars(defaultValues(DEF), { clientName: 'Invented Traders Private Limited', clientPan: 'AAAAA0000A', financialYear: '2026-27' });
  const rows = seedRows(DEF, 'audit-1', prefill.values, prefill.prefilled).map((row, index) => ({
    ...row,
    id: `row-${index}`,
    created_at: '2026-11-22 10:00:00',
    updated_at: '2026-11-22 10:00:00',
  })) as Form26ClauseRow[];
  const values = { ...prefill.values, f: { ...prefill.values.f, cat: '2' } };
  return { values, rowsByKey: new Map(rows.map((row) => [row.clause_key, row])) };
}

function result(patch: Partial<UseTaxAuditForm26Result> = {}): UseTaxAuditForm26Result {
  const { values, rowsByKey } = openAudit();
  const setup = readSetup(JSON.stringify({ form26: { v: 1, category: '2', showAllSchedules: false } }));
  const merged = { values, rowsByKey, evidence: [] as TaxAuditClauseEvidence[], ...patch };
  const unfilled = scanUnfilled(DEF, merged.values, { showAllSchedules: false });
  const nothing = async () => undefined;
  return {
    status: 'ready',
    errorMessage: null,
    retry: () => undefined,
    def: DEF,
    audit: { id: 'audit-1', engagement_id: 'eng-1', statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION, form_type: '3CB', financial_year: '2026-27' } as unknown as UseTaxAuditForm26Result['audit'],
    setup,
    unfilled,
    counts: countUnfilled(DEF, unfilled),
    summary: summarise(FORM26_CLAUSE_UNITS, merged.rowsByKey, merged.evidence),
    saveState: { kind: 'idle' },
    unconfirmed: new Set(),
    fieldConflicts: {},
    tableConflicts: {},
    setField: () => undefined,
    fieldFocused: () => undefined,
    fieldBlurred: () => undefined,
    setTable: () => undefined,
    tableLeft: () => undefined,
    setCategory: nothing,
    setShowAllSchedules: nothing,
    setStatus: async () => true,
    updateRow: async () => true,
    confirmBrought: nothing,
    resolveConflict: nothing,
    resolveTableConflict: nothing,
    linkEvidence: nothing,
    unlinkEvidence: nothing,
    applyImport: async () => ({ ok: false, written: 0, message: 'Not in this test.' }), flush: async () => true,
    reload: nothing,
    hasPending: () => false,
    hasUnresolved: () => false,
    unfilledNow: () => unfilled,
    ...merged,
    ...patch,
  };
}

const workspace = (form26 = result(), initialClauseKey?: string) =>
  html(createElement(Form26WorkspaceBody, { parts, form26, canApprove: true, clientName: 'Invented Traders Private Limited', financialYear: '2026-27', initialClauseKey }));

describe('Form 26 workspace (static render)', () => {
  it('opens in the present layout: header with the form\'s badges and Next unfilled, list, editor with the review bar and footer, evidence pane', () => {
    const form26 = result();
    const markup = workspace(form26);
    const text = visibleText(markup);
    // The page's views ("Clauses · What changed · Review Summary", task 24) sit beside the title (POLISH-2), then client, year and why.
    expect(text.startsWith('Tax Audit Clauses What changed Review Summary Invented Traders Private Limited - 2026-27 Form No. 26 applies to tax years from 2026-27. This engagement is for 2026-27.')).toBe(true);
    for (const badge of ['Form No. 26', 'Income-tax Act, 2025', 'Rule 47', 'Category (ii)']) expect(text).toContain(badge);
    expect(text).toContain(`Next unfilled · ${form26.counts.total}`);
    expect(markup).toContain('aria-keyshortcuts="F8"');
    expect(text).not.toMatch(/1961|Rule 6G|Beta/);
    // The three panes on the grid of the 3CD clause workspace.
    expect(markup).toContain('xl:grid-cols-[280px_minmax(0,1fr)_300px]');
    expect(markup).toContain('<nav aria-label="Form No. 26 clauses"');
    expect(text).toContain('Category of assessee Draft · TA-F26-Category');
    expect(text).toMatch(/Prepared Reviewed Approve/);
    expect(text).toContain('Review remarks');
    expect(text).toContain('Qualification or observation required in the report');
    expect(markup).toContain('data-rail="f26_category"');
    expect(text).toContain('Sources, Evidence and Review · TA-F26-Category · 0 linked');
    // One polite live region for the whole workspace; the tabs "Clauses" and "What changed" (task 25).
    expect(attributeValues(markup, 'aria-live').filter((value) => value === 'polite')).toHaveLength(1);
    expect(markup).toContain('role="tablist"');
    expect(text).toMatch(/^.*Clauses What changed Review Summary /);
  });

  it('room at 1280 x 720 (POLISH-2): "Clauses · What changed · Review Summary" is a compact control in the header row beside the title, not a band of its own', () => {
    const markup = workspace(result(), 'f26_c14');
    // The workspace itself is the tabs' root, so the header (its first child) holds the switch between views.
    expect(markup).toMatch(/^<div dir="ltr" data-orientation="horizontal" class="relative flex flex-col gap-4 xl:h-full" data-f26-workspace="">/);
    const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
    const tablist = /<div role="tablist"[^>]*>/.exec(header)?.[0] ?? '';
    expect(tablist).not.toBe('');
    expect(tablist).toContain('aria-label="Form No. 26 views"');
    // In the title's row: the h1 and the tabs are siblings in one line of the header.
    expect(header).toMatch(/<div class="flex flex-wrap items-center gap-x-3 gap-y-1"><h1[^>]*>Tax Audit<\/h1><div role="tablist"/);
    // Compact: as tall as the title's line (28 px), the triggers 24 px; nothing between the header and the panes.
    expect(tablist).toMatch(/class="[^"]*\bh-7\b[^"]*"/);
    const triggers = header.match(/<button type="button" role="tab"[^>]*>/g) ?? [];
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) expect(trigger).toMatch(/class="[^"]*\bh-6\b[^"]*"/);
    // Keyboard: one Tab stop (the active tab); the arrow keys move between them (Radix's tabs).
    expect(triggers[0]).toMatch(/aria-selected="true"/);
    for (const trigger of triggers.slice(1)) expect(trigger).toMatch(/aria-selected="false"[^>]*tabindex="-1"|tabindex="-1"[^>]*aria-selected="false"/);
    expect(markup.match(/role="tablist"/g)).toHaveLength(2); // the header's and the right pane's (Evidence · Last year)
    const afterHeader = markup.slice(markup.indexOf('</header>'), markup.indexOf('data-f26-panes'));
    expect(afterHeader).not.toContain('role="tablist"');
  });

  it('fit found in the running app (task 20): what is placed out of the flow stays inside its scrolling box, and the title keeps its room', () => {
    const markup = workspace(result(), 'f26_sign');
    // Hidden labels (sr-only, absolute) inside a scrolling box whose ancestors are not positioned made the
    // whole window scrollable (the document grew to 4,546 px at 1280 x 720): each scrolling box is their frame.
    const scrolling = attributeValues(markup, 'class').filter((value) => /\boverflow-y-auto\b/.test(value));
    expect(scrolling.length).toBeGreaterThanOrEqual(2);
    for (const value of scrolling) expect(value.split(/\s+/)).toContain('relative');
    expect(markup).toMatch(/<div [^>]*class="relative [^"]*" data-f26-workspace="">/);
    // The clause title block keeps 12rem: in a narrow editor the review bar goes under it ("TA-F26-Signature" was cut).
    expect(markup).toMatch(/class="min-w-\[12rem\] flex-1"/);
  });

  it('fit found in the running app (POLISH-1): from 1280 px the panes fill the page under the header, nothing scrolls the page, nothing covers the panes', () => {
    const markup = workspace(result(), 'f26_c14');
    const classes = (pattern: RegExp) => attributeValues(markup, 'class').filter((value) => pattern.test(value));
    // The workspace is as tall as the page's room, a column: the header, then the panes taking the rest.
    const root = classes(/(^|\s)relative(\s|$)/).find((value) => markup.includes(` class="${value}" data-f26-workspace="">`));
    expect(root?.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'xl:h-full']));
    // The panes are sized to the space under the header (no fixed minimum, no height worked out from the window).
    const grid = classes(/\bxl:grid-cols-\[280px_minmax\(0,1fr\)_300px\]/)[0]?.split(/\s+/) ?? [];
    expect(grid).toEqual(expect.arrayContaining(['xl:flex-1', 'xl:min-h-0', 'xl:h-auto', 'xl:grid-rows-[minmax(0,1fr)]']));
    // The headers are in the flow: the page's header never slides over the panes; the clause's heading sits
    // above the editor's scrolling body, which is the only part that scrolls.
    expect(classes(/\bsticky\b/)).toEqual([]);
    // A pane clips what overflows it but is not a scrolling box: focusing a control deep in a schedule scrolls
    // the editor's body only, so the clause's title and review bar stay in view (the T19-20 open point).
    expect(classes(/\boverflow-hidden\b/)).toEqual([]);
    expect(classes(/\boverflow-clip\b/).length).toBeGreaterThanOrEqual(2);
  });

  it('a clause with a schedule: clause 28 Yes shows the schedule under it; the list has its schedule entry; evidence goes on the clause', () => {
    const { values, rowsByKey } = openAudit();
    values.f.c28 = 'Yes';
    const markup = workspace(result({ values, rowsByKey }), 'f26_c28');
    const text = visibleText(markup);
    expect(text).toContain('Clause 28 ·');
    expect(markup).toContain('id="f26-s-s28"');
    expect(markup).toContain('data-entry-id="s28"');
    expect(markup).toContain('data-rail="f26_c28"');
    expect(markup).toMatch(/data-entry-id="f26_c28"[^>]*aria-current="true"/);
  });

  it('an approved clause is read-only with the Edit button of the present module', () => {
    const { values, rowsByKey } = openAudit();
    const row = rowsByKey.get('f26_c13')!;
    rowsByKey.set('f26_c13', { ...row, review_status: 'approved', locked: 1 });
    const markup = workspace(result({ values, rowsByKey }), 'f26_c13');
    const text = visibleText(markup);
    expect(text).toContain('Approved · TA-F26-13 · Read-only');
    expect(text).toContain('Edit');
    expect(text).not.toMatch(/Prepared Reviewed Approve/);
    expect(markup).toMatch(/<textarea[^>]*readOnly=""/i);
  });

  it('save failed: the header says so with Try again; the entry stays on screen', () => {
    const { values, rowsByKey } = openAudit();
    values.f.c13 = 'Invented books';
    const saveState: Form26SaveState = { kind: 'failed', message: 'database is locked', pending: 1 };
    const text = visibleText(workspace(result({ values, rowsByKey, saveState }), 'f26_c13'));
    expect(text).toContain('Could not save. Your entry is still on screen. Try again. Try again');
    expect(text).toContain('Invented books');
  });

  it('changed elsewhere: an answer shows Keep mine / Use theirs under it; a table gets one line above the editor', () => {
    const { values, rowsByKey } = openAudit();
    values.f.c28 = 'Yes';
    const markup = workspace(
      result({
        values,
        rowsByKey,
        saveState: { kind: 'changed-elsewhere', clauseKey: 'f26_c28', fields: ['c28'] },
        fieldConflicts: { c28: { theirs: 'No', at: '2026-11-22 10:42:05' } },
        tableConflicts: { S28: { theirs: '', at: '2026-11-22 10:42:05' } },
      }),
      'f26_c28',
    );
    const text = visibleText(markup);
    expect(text).toContain('Someone else changed this clause. Choose which entry to keep.');
    expect(text).toMatch(/Changed by someone else at \d\d:\d\d\. Keep mine Use theirs/);
    expect(text).toMatch(/The table under "28\. Particulars of penalty levied under any law in force in or outside India" was changed by someone else at \d\d:\d\d\. Keep mine Use theirs/);
  });

  it('approved while the user typed: the header says so in its own sentence; the only choice is "Use theirs"', () => {
    const { values, rowsByKey } = openAudit();
    values.f.c28 = 'Yes';
    const c28 = rowsByKey.get('f26_c28')!;
    rowsByKey.set('f26_c28', { ...c28, review_status: 'approved', locked: 1 });
    const text = visibleText(
      workspace(
        result({
          values,
          rowsByKey,
          saveState: { kind: 'changed-elsewhere', clauseKey: 'f26_c28', fields: ['c28'] },
          fieldConflicts: { c28: { theirs: 'No', at: '2026-11-22 10:42:05' } },
        }),
        'f26_c28',
      ),
    );
    expect(text).not.toContain('Choose which entry to keep');
    expect(text).not.toContain('Keep mine');
    // Once in the header, once under the answer (with its one choice).
    expect(text.split('This clause was approved while you were typing. Your entry was not saved.').length - 1).toBe(2);
    expect(text).toContain('This clause was approved while you were typing. Your entry was not saved. Use theirs');
  });

  it('nothing at all to fill: the button says 0 and the count is said in words', () => {
    const form26 = result();
    const markup = workspace({ ...form26, counts: { ...form26.counts, total: 0 } });
    expect(visibleText(markup)).toContain('Next unfilled · 0');
    expect(markup).toContain('Nothing left to fill');
  });
});

describe('header', () => {
  const model = (saveState: Form26SaveState, message?: string) =>
    form26HeaderModel({ clientName: 'Invented Traders', financialYear: '2026-27', category: '1', saveState, clock: () => '16:42', unfilled: 3, message });
  const draw = (saveState: Form26SaveState, message?: string) => html(createElement(Form26Header, { model: model(saveState, message), onNext: () => undefined, onRetry: () => undefined }));
  it('stays in the flow above the panes (never over them), keeps the save line in its place, and "Next unfilled" carries the tool\'s "go to" arrow', () => {
    const markup = draw({ kind: 'saved', at: 1 });
    expect(markup).not.toContain('sticky');
    expect(markup).toContain('lucide-arrow-right');
    expect(markup).not.toContain('lucide-arrow-down-to-line');
    expect(visibleText(markup)).toContain('Saved 16:42');
    expect(visibleText(markup)).toContain('Category (i)');
    expect(markup).toContain('min-h-8');
  });
  it('the message "Nothing left to fill." and a failure with Try again', () => {
    expect(visibleText(draw({ kind: 'idle' }, 'Nothing left to fill.'))).toContain('Nothing left to fill.');
    const failed = draw({ kind: 'failed', message: 'x', pending: 2 });
    expect(visibleText(failed)).toContain('Could not save. Your entry is still on screen. Try again. Try again');
    expect(failed).toContain('text-danger-ink');
  });
});

describe('clause list', () => {
  const props = (patch: Partial<Form26ClauseListProps> = {}): Form26ClauseListProps => {
    const { values, rowsByKey } = openAudit();
    return {
      model: buildListModel({ def: DEF, values, view: { showAllSchedules: false }, rowsByKey, evidence: [], unconfirmed: new Set(), filter: 'all', search: '' }),
      selectedId: 'f26_c14',
      filter: 'all',
      onFilter: () => undefined,
      search: '',
      onSearch: () => undefined,
      highlightUnfilled: true,
      onHighlightUnfilled: () => undefined,
      showAllSchedules: false,
      onShowAllSchedules: () => undefined,
      onSelect: () => undefined,
      ...patch,
    };
  };

  it('search, the five chips with counts, the two switches of the file, the groups in the form\'s order with every entry', () => {
    const p = props();
    const markup = html(createElement(Form26ClauseList, p));
    const text = visibleText(markup);
    expect(markup).toContain('aria-label="Search clauses"');
    for (const chip of ['All', 'Unfilled', 'Evidence', 'Qualified', 'Reviewed']) expect(text).toContain(chip);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>All<span[^>]*>61<\/span>/);
    // The file's switches are behind the "View" button of the title row (POLISH-2), not drawn in the pane.
    expect(markup).not.toContain('role="switch"');
    expect(markup).toContain('data-f26-view-button=""');
    for (const group of p.model.groups) expect(text).toContain(group.title);
    expect(attributeValues(markup, 'data-entry-id')).toHaveLength(61);
    expect(text).toContain(FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c14')!.label);
  });

  it('room at 1280 x 720 (POLISH-2): the title row holds "View" (a button opening the three switches) and the count; chips compact, counts kept', () => {
    const markup = html(createElement(Form26ClauseList, props({ showComparison: true, comparisonUsual: true, onShowComparison: () => undefined })));
    const titleRow = markup.slice(0, markup.indexOf('aria-label="Search clauses"'));
    const button = /<button[^>]*data-f26-view-button=""[^>]*>/.exec(titleRow)?.[0] ?? '';
    expect(button).not.toBe('');
    // A popup button: its name is "View", its state said in words (aria-describedby), keyboard as any button.
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('type="button"');
    const described = /aria-describedby="([^"]+)"/.exec(button)?.[1] ?? '';
    expect(described).not.toBe('');
    expect(markup).toContain(`id="${described}" hidden="">Highlight unfilled: on. Show all schedules: off. Show Form 3CD notes: on.</span>`);
    const buttonEnd = markup.indexOf('</button>', markup.indexOf(button));
    expect(visibleText(markup.slice(markup.indexOf(button), buttonEnd))).toBe('View');
    expect(visibleText(titleRow)).toMatch(/^Form No\. 26 \d+ shown/);
    // The usual view: no mark. Show all schedules on: the mark "1", said as "1 setting changed".
    const changed = html(createElement(Form26ClauseList, props({ showAllSchedules: true, showComparison: true, comparisonUsual: true, onShowComparison: () => undefined })));
    const start = changed.indexOf('data-f26-view-button');
    expect(visibleText(`<x ${changed.slice(start, changed.indexOf('</button>', start))}`)).toBe('View 1 setting changed');
    expect(changed).toContain('data-f26-view-mark=""');
    expect(markup).not.toContain('data-f26-view-mark=""');
    // The chips: one group, 24 px high with short padding, each with its count.
    const chips = markup.match(/<button[^>]*aria-pressed="(true|false)"[^>]*>/g) ?? [];
    expect(chips).toHaveLength(5);
    for (const chip of chips) {
      const cls = /class="([^"]*)"/.exec(chip)?.[1].split(/\s+/) ?? [];
      expect(cls).toEqual(expect.arrayContaining(['h-6', 'px-1.5']));
    }
    // The labels keep the text's own line height (16 px at 12 px type): more entries in the same room.
    expect(markup).toMatch(/class="min-w-0 flex-1 break-words text-xs leading-4/);
    // The marks (unfilled count, evidence, review) sit beside the number, as the 3CD list's dot does, so the
    // label has the whole width to the right edge.
    const entry14 = markup.slice(markup.indexOf('data-entry-id="f26_c14"'), markup.indexOf('</button>', markup.indexOf('data-entry-id="f26_c14"')));
    expect(entry14).toMatch(/<span class="flex w-16 shrink-0 flex-wrap items-center gap-x-1 gap-y-0\.5"><span class="[^"]*font-mono[^"]*">14<\/span><span class="flex[^"]*"><span[^>]*>\d+<span class="sr-only"> unfilled<\/span><\/span><\/span><\/span><span class="min-w-0 flex-1 break-words text-xs leading-4/);
    expect(entry14).toMatch(/break-words text-xs leading-4[^"]*">[^<]*<\/span>$/); // nothing after the label
  });

  it('the three switches of "View": each labelled exactly as before, its state as a switch; two without the Form 3CD notes', () => {
    const three = html(createElement(Form26ViewSwitches, { summary: form26ViewSummary({ highlightUnfilled: true, showAllSchedules: false, showComparison: false, comparisonUsual: true }), onChange: () => undefined }));
    for (const [id, label, checked] of [['f26-highlight-unfilled', 'Highlight unfilled', 'true'], ['f26-show-all-schedules', 'Show all schedules', 'false'], ['f26-show-comparison', 'Show Form 3CD notes', 'false']]) {
      expect(three).toMatch(new RegExp(`<label for="${id}"[^>]*>${label}</label>`));
      expect(three).toMatch(new RegExp(`<button type="button" role="switch" aria-checked="${checked}"[^>]*id="${id}"`));
    }
    expect(three.match(/role="switch"/g)).toHaveLength(3);
    const two = html(createElement(Form26ViewSwitches, { summary: form26ViewSummary({ highlightUnfilled: true, showAllSchedules: false }), onChange: () => undefined }));
    expect(two.match(/role="switch"/g)).toHaveLength(2);
    expect(two).not.toContain('f26-show-comparison');
  });

  it('one Tab stop: the selected entry; it carries aria-current and the present blue edge', () => {
    const markup = html(createElement(Form26ClauseList, props()));
    expect((markup.match(/data-entry-id="[^"]*" tabindex="0"/g) ?? [])).toHaveLength(1);
    expect(markup).toMatch(/data-entry-id="f26_c14" tabindex="0" aria-current="true"/);
    expect(markup).toContain('border-primary bg-primary/10');
  });

  it('marks are said in words too: unfilled counts, evidence, qualification, review state', () => {
    const { values, rowsByKey } = openAudit();
    const c13 = rowsByKey.get('f26_c13')!;
    rowsByKey.set('f26_c13', { ...c13, review_status: 'reviewed', qualification_required: 1 });
    const evidence = [{ id: 'link-1', tax_audit_id: 'audit-1', clause_response_id: c13.id, clause_key: 'f26_c13', evidence_file_id: 'file-1' } as TaxAuditClauseEvidence];
    const model = buildListModel({ def: DEF, values, view: { showAllSchedules: false }, rowsByKey, evidence, unconfirmed: new Set(), filter: 'all', search: '' });
    const text = visibleText(html(createElement(Form26ClauseList, props({ model }))));
    expect(text).toMatch(/13 [^]*?Evidence linked Marked for qualification Reviewed/);
    expect(text).toMatch(/\d+ unfilled/);
  });

  it('nothing matches the search: the designed empty state with "Clear search"', () => {
    const { values, rowsByKey } = openAudit();
    const model = buildListModel({ def: DEF, values, view: { showAllSchedules: false }, rowsByKey, evidence: [], unconfirmed: new Set(), filter: 'all', search: 'zzz' });
    const text = visibleText(html(createElement(Form26ClauseList, props({ model, search: 'zzz' }))));
    expect(text).toContain('No clause matches "zzz". Clear search');
    expect(text).toContain('0 shown');
  });
});

describe('review bar', () => {
  const row = (patch: Partial<Form26ClauseRow> = {}) => ({ ...openAudit().rowsByKey.get('f26_c28')!, ...patch });
  it('Prepared, Reviewed, Approve in the present order and look, with the unfilled count beside them', () => {
    const markup = html(createElement(Form26ReviewBar, { row: row(), unfilled: 3, onStatus: async () => true }));
    expect(visibleText(markup)).toBe('3 unfilled Prepared Reviewed Approve');
    expect((markup.match(/h-7 px-2 text-xs/g) ?? []).length).toBe(3);
  });
  it('an approved clause offers Edit (the reason dialog opens from it)', () => {
    const markup = html(createElement(Form26ReviewBar, { row: row({ review_status: 'approved', locked: 1 }), unfilled: 3, onStatus: async () => true }));
    expect(visibleText(markup)).toBe('Edit');
  });
});

describe('footer: review remarks and qualification', () => {
  const props = (patch: Partial<Form26ClauseFooterProps> = {}): Form26ClauseFooterProps => {
    const { rowsByKey } = openAudit();
    return {
      row: rowsByKey.get('f26_c14')!,
      unit: FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c14')!,
      category: '2',
      observationRows: [{ '1': '', '2': '', '3': '' }],
      partLocked: false,
      onUpdate: async () => true,
      onAddObservation: () => undefined,
      ...patch,
    };
  };
  it('the remarks for the working papers only, and the qualification tick', () => {
    const text = visibleText(html(createElement(Form26ClauseFooter, props())));
    expect(text).toContain('Review remarks For the working papers only. Not part of Form No. 26.');
    expect(text).toContain('Qualification or observation required in the report');
    expect(text).not.toContain('Add to the report');
  });
  it('the remarks caption sits 4 px under its label (FIX-T29, UX 3.12 item 2: 2 px was measured)', () => {
    const markup = html(createElement(Form26ClauseFooter, props()));
    expect(markup).toMatch(/<span class="mt-1 block text-xs text-subtle">For the working papers only/);
  });
  it('a qualified clause: its text box, and "Add to the report\'s observations" offered or said why not', () => {
    const base = props();
    const qualified = { ...base.row, qualification_required: 1, qualification_text_html: '<p>Invented qualification</p>' };
    const ready = html(createElement(Form26ClauseFooter, props({ row: qualified })));
    expect(visibleText(ready)).toContain("Add to the report's observations");
    expect(ready).toContain('aria-disabled="false"');
    const noCategory = html(createElement(Form26ClauseFooter, props({ row: qualified, category: '' })));
    expect(noCategory).toContain('aria-disabled="true"');
    expect(visibleText(noCategory)).toContain('Choose the category of assessee first.');
    const already = html(createElement(Form26ClauseFooter, props({ row: qualified, observationRows: [{ '1': '14', '2': '', '3': 'x' }] })));
    expect(visibleText(already)).toContain("Clause 14 is already in the report's observations (Part B).");
  });
  it('the qualification box of an item of Part C has no "Add" (only clauses 9 to 53 go into the observations)', () => {
    const { rowsByKey } = openAudit();
    const row = { ...rowsByKey.get('f26_p2')!, qualification_required: 1 };
    const text = visibleText(html(createElement(Form26ClauseFooter, props({ row, unit: FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_p2')! }))));
    expect(text).not.toContain("Add to the report's observations");
  });
});

describe('right pane (task 18)', () => {
  const row = () => openAudit().rowsByKey.get('f26_c14')!;
  it('open: the page\'s EvidenceRail for the selected clause with its links', () => {
    const r = row();
    const evidence = [{ id: 'link-1', tax_audit_id: 'audit-1', clause_response_id: r.id, clause_key: 'f26_c14', evidence_file_id: 'file-1' } as TaxAuditClauseEvidence];
    const text = visibleText(html(createElement(Form26RightPane, { parts, row: r, evidence, open: true, onOpenChange: () => undefined, onLink: async () => undefined, onUnlink: async () => undefined })));
    expect(text).toBe('Sources, Evidence and Review · TA-F26-14 · 1 linked');
  });
  it('with "Last year" (POLISH-2): the tabs sit in the pane\'s own title row with its fold button; no band above the title', () => {
    const r = row();
    const markup = html(createElement(Form26RightPane, {
      parts, row: r, evidence: [], open: true, onOpenChange: () => undefined, onLink: async () => undefined, onUnlink: async () => undefined,
      tab: 'evidence', onTabChange: () => undefined, lastYear: () => createElement('p', null, 'Last year content'),
    }));
    // The pane is named as before; its first line is the title row: the two tabs and the fold button.
    expect(markup).toMatch(/^<section aria-label="Sources, Evidence and Review" class="[^"]*"/);
    const frame = (/^<section[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/);
    expect(frame).toEqual(expect.arrayContaining(['overflow-clip', 'rounded-md', 'border', 'flex', 'flex-col']));
    const titleRow = markup.slice(markup.indexOf('data-f26-pane-title'), markup.indexOf('role="tabpanel"'));
    expect(titleRow).toMatch(/<div role="tablist" aria-orientation="horizontal"[^>]*aria-label="Evidence or last year"/);
    expect(titleRow).toContain('data-f26-pane-tab="evidence"');
    expect(titleRow).toContain('data-f26-pane-tab="last-year"');
    expect(titleRow).toMatch(/<button[^>]*title="Collapse evidence pane"[^>]*aria-label="Collapse evidence pane"/);
    // The title row has the look of the 3CD pane's header (muted band under a line).
    expect(markup).toContain('class="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5" data-f26-pane-title=""');
    // Inside the Evidence tab the page's rail draws its body only: its own title row (title, count, fold) is the
    // pane's title row now, and its frame is the pane's.
    const evidencePanel = /<div[^>]*role="tabpanel"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(evidencePanel).toContain('[&amp;&gt;div&gt;div:first-child]:hidden');
    expect(evidencePanel).toContain('[&amp;&gt;div]:border-0');
    expect(markup).toContain('data-rail="f26_c14"');
  });

  it('folded: the narrow strip with a named button to open it and the count in words', () => {
    const markup = html(createElement(Form26RightPane, { parts, row: row(), evidence: [], open: false, onOpenChange: () => undefined, onLink: async () => undefined, onUnlink: async () => undefined }));
    expect(markup).toContain('aria-label="Show sources, evidence and review"');
    expect(visibleText(markup)).toBe('0 evidence files linked');
  });
  it('a table\'s own row never takes evidence: the pane is given clause rows only', () => {
    expect(openAudit().rowsByKey.get(form26TableRowKey('S28'))?.workpaper_ref).toBe('TA-F26-28');
  });
});

describe('states', () => {
  it('opening: a skeleton shaped like the three panes, said in words', () => {
    const markup = html(createElement(Form26LoadingState));
    expect(visibleText(markup)).toBe('Opening Form No. 26.');
    expect(markup).toContain('xl:grid-cols-[280px_minmax(0,1fr)_300px]');
  });
  it('no engagement, no access, a 3CD draft waiting, an error with Try again', () => {
    expect(visibleText(html(createElement(Form26NoEngagementState)))).toBe('Tax Audit Please select an engagement before opening Tax Audit.');
    expect(visibleText(html(createElement(Form26NoAccessState)))).toContain('You are not assigned to this engagement, so its tax audit cannot be opened.');
    expect(visibleText(html(createElement(Form26ConversionState, { onRetry: () => undefined })))).toContain('This engagement has a Form 3CD draft');
    const error = html(createElement(Form26ErrorState, { message: 'Form No. 26 could not be loaded.', onRetry: () => undefined }));
    expect(visibleText(error)).toBe('Tax Audit Form No. 26 could not be opened Form No. 26 could not be loaded. Try again');
    expect(error).toContain('role="alert"');
  });
  it('the year not understood: the plain message and a link to Engagements; nothing else', () => {
    const markup = html(createElement(MemoryRouter, null, createElement(Form26YearUnknownState, { financialYear: 'Year 26' })));
    expect(visibleText(markup)).toContain('The financial year of this engagement ("Year 26") is not in the form 2026-27, so the tax audit form cannot be chosen. Correct it in Engagements.');
    expect(markup).toContain('href="/engagements"');
  });
  it('the table line offers only "Use theirs" after an approval', () => {
    const text = visibleText(html(createElement(Form26ConflictBanner, { lines: [{ id: 'S28', text: 'Clause 28 was approved while you were typing. Your entry in its table was not saved.', actions: ['theirs'] }], onResolve: () => undefined })));
    expect(text).toBe('Clause 28 was approved while you were typing. Your entry in its table was not saved. Use theirs');
  });
});
