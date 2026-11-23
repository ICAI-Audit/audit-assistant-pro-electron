import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The application's contexts make their database client when they are imported; no database is reached
// here (nothing in these tests sends a request), so the client is given a stand-in that refuses everything.
vi.hoisted(() => {
  const holder = globalThis as { window?: unknown };
  if (!holder.window) holder.window = { electronAPI: { sqliteQuery: async () => ({ data: null, error: { message: 'No database in this test.' } }) } };
});

import { Form26ClauseEditor } from '@/components/tax-audit/form26/Form26ClauseEditor';
import { Form26LastYear } from '@/components/tax-audit/form26/Form26LastYear';
import type { Form26SharedParts } from '@/components/tax-audit/form26/Form26RightPane';
import { Form26WhatChanged } from '@/components/tax-audit/form26/Form26WhatChanged';
import { Form26WorkspaceBody } from '@/components/tax-audit/form26/Form26Workspace';
import type { UseTaxAuditForm26Result } from '@/components/tax-audit/form26/useTaxAuditForm26';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { FORM26_MAPPING } from '@/data/taxAuditForm26Mapping';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { comparisonLine, whatChangedRows, type Form26ChangeFilter } from '@/lib/taxAuditForm26Compare';
import { buildEditorModel } from '@/lib/taxAuditForm26EditorModel';
import { summarise } from '@/lib/taxAuditForm26Review';
import { prefillParticulars, readSetup, seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow, Form26LastYearResult } from '@/lib/taxAuditForm26Store';
import { lastYearView } from '@/lib/taxAuditForm26ThreeCdText';
import { countUnfilled, scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';
import { attributeValues, expectControlsNamed, expectFinished, expectReferencesResolve, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

const html = (element: ReactElement) => {
  const markup = renderToStaticMarkup(element);
  expectFinished(markup);
  expectReferencesResolve(markup.replace(/ aria-controls="radix-[^"]*"/g, ''));
  expectControlsNamed(markup);
  return markup;
};
const HEDGING = /our rea[d]ing|to be veri[f]ied|†|appe[a]r|check aga[i]nst/i;
const parts: Form26SharedParts = { EvidenceRail: ({ clause }) => createElement('div', { 'data-rail': clause.clause_key }, `Sources, Evidence and Review · ${clause.workpaper_ref}`) };

function result(): UseTaxAuditForm26Result {
  const prefill = prefillParticulars(defaultValues(DEF), { clientName: 'Invented Traders Private Limited', clientPan: 'AAAAA0000A', financialYear: '2026-27' });
  const rows = seedRows(DEF, 'audit-1', prefill.values, prefill.prefilled).map((row, index) => ({ ...row, id: `row-${index}`, created_at: '2026-11-22 10:00:00', updated_at: '2026-11-22 10:00:00' })) as Form26ClauseRow[];
  const rowsByKey = new Map(rows.map((row) => [row.clause_key, row]));
  const values = { ...prefill.values, f: { ...prefill.values.f, cat: '2' } };
  const unfilled = scanUnfilled(DEF, values, { showAllSchedules: false });
  const nothing = async () => undefined;
  return {
    status: 'ready', errorMessage: null, retry: () => undefined, def: DEF,
    audit: { id: 'audit-1', engagement_id: 'eng-1', client_id: 'client-1', statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION, form_type: '3CB', financial_year: '2026-27' } as unknown as UseTaxAuditForm26Result['audit'],
    setup: readSetup(JSON.stringify({ form26: { v: 1, category: '2', showAllSchedules: false } })),
    values, rowsByKey, evidence: [], unfilled, counts: countUnfilled(DEF, unfilled), summary: summarise(FORM26_CLAUSE_UNITS, rowsByKey, []),
    saveState: { kind: 'idle' }, unconfirmed: new Set(), fieldConflicts: {}, tableConflicts: {},
    setField: () => undefined, fieldFocused: () => undefined, fieldBlurred: () => undefined, setTable: () => undefined, tableLeft: () => undefined,
    setCategory: nothing, setShowAllSchedules: nothing, setStatus: async () => true, updateRow: async () => true, confirmBrought: nothing,
    resolveConflict: nothing, resolveTableConflict: nothing, linkEvidence: nothing, unlinkEvidence: nothing, applyImport: async () => ({ ok: false, written: 0, message: 'Not in this test.' }), flush: async () => true, reload: nothing,
    hasPending: () => false, hasUnresolved: () => false, unfilledNow: () => unfilled,
  };
}

const THREE_CD = 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025';
const lastYearFound: Form26LastYearResult = {
  state: 'found', year: '2025-26', form: '3cd',
  audit: { id: 'audit-2025', engagement_id: 'eng-2025', statutory_version: THREE_CD, form_type: '3CB', review_status: 'draft' } as unknown as TaxAuditSetup,
  rows: [{ id: 'r13', tax_audit_id: 'audit-2025', clause_key: 'clause_13', clause_no: '13', clause_title: 'Method', statutory_version: THREE_CD, response_json: '{"structured":{"method_of_accounting":"Mercantile","whether_change_in_method":"no"}}', review_status: 'approved', locked: 1 } as unknown as TaxAuditClauseResponse],
};

const workspace = (options: { financialYear?: string; clause?: string; lastYear?: Form26LastYearResult | null; paneTab?: 'evidence' | 'last-year' } = {}) =>
  html(createElement(Form26WorkspaceBody, {
    parts, form26: result(), canApprove: true, clientName: 'Invented Traders Private Limited', financialYear: options.financialYear ?? '2026-27',
    initialClauseKey: options.clause ?? 'f26_c15', clientId: 'client-1', userId: 'user-1', lastYear: options.lastYear, initialPaneTab: options.paneTab,
  }));

describe('the line under a clause (static render)', () => {
  it('2026-27: the line under clause 15 and its "Last year" link; the switch "Show Form 3CD notes" is on', () => {
    const markup = workspace({ clause: 'f26_c15' });
    const text = visibleText(markup);
    expect(text).toContain('Was Form 3CD clause 13(a)–(c) · No change in substance. Last year');
    // The switch lives behind the list's "View" button (POLISH-2); the button says its state in words.
    expect(markup).toContain('>Highlight unfilled: on. Show all schedules: off. Show Form 3CD notes: on.</span>');
    expect((markup.match(/data-f26-comparison=""/g) ?? []).length).toBe(1);
  });

  it('a new clause: "New in Form No. 26." and its words, no "Last year" link, no badge', () => {
    const markup = workspace({ clause: 'f26_c14' });
    const text = visibleText(markup);
    expect(text).toContain('New in Form No. 26. Digital trail of books is now a reporting item.');
    expect(text).toContain(comparisonLine(FORM26_MAPPING.find((row) => row.id === 'm13_14a')!));
    // One link, on the line that has a Form 3CD clause (14(a)); none on the new 14(b)-(e).
    expect((markup.match(/data-f26-last-year-link=""/g) ?? []).length).toBe(1);
    expect(text).not.toMatch(/\bNEW\b/);
  });

  it('2027-28: off by default; no line and no "Last year" tab, the "What changed" tab stays', () => {
    const markup = workspace({ clause: 'f26_c15', financialYear: '2027-28' });
    const text = visibleText(markup);
    expect(text).not.toContain('Was Form 3CD');
    expect(markup).not.toContain('data-f26-pane-tab');
    expect(text).toContain('What changed');
    // Off is the usual view from 2027-28: the "View" button carries no mark.
    expect(markup).toContain('>Highlight unfilled: on. Show all schedules: off. Show Form 3CD notes: off.</span>');
    expect(markup).not.toContain('data-f26-view-mark=""');
  });

  it('the line spans wording and answer in three columns, and stays in the wording column when stacked (no extra grid column)', () => {
    const unit = FORM26_CLAUSE_UNITS.find((entry) => entry.key === 'f26_c15')!;
    const editor = (width: number) =>
      renderToStaticMarkup(createElement(Form26ClauseEditor, {
        def: DEF, unit, blocks: buildEditorModel(DEF, unit.key, defaultValues(DEF), { showAllSchedules: false }, { comparison: true }), values: defaultValues(DEF),
        row: result().rowsByKey.get('f26_c15')!, lockedTables: new Set<string>(), unfilled: [], highlightUnfilled: true, availableWidth: width,
        onField: () => undefined, onTable: () => undefined, onTableLeft: () => undefined, onStatus: async () => undefined, onRowUpdate: async () => undefined,
        onOpenLastYear: () => undefined, focusTarget: null,
      }));
    const lineClass = (markup: string) => /<div class="([^"]*)" data-f26-comparison=""/.exec(markup)?.[1] ?? '';
    expect(lineClass(editor(700))).not.toBe('');
    expect(lineClass(editor(700)).split(/\s+/)).toEqual(expect.arrayContaining(['col-start-2', 'col-span-2']));
    expect(lineClass(editor(340)).split(/\s+/)).toContain('col-start-2');
    expect(lineClass(editor(340)).split(/\s+/)).not.toContain('col-span-2');
    expect(lineClass(editor(340))).not.toMatch(/lg:col-span/);
  });
});

describe('"Last year" in the right pane (static render)', () => {
  it('the pane has the tabs "Evidence" and "Last year"; clause 15 shows Form 3CD clause 13 and last year\'s answers as text, read only, no copy', () => {
    const markup = workspace({ clause: 'f26_c15', lastYear: lastYearFound, paneTab: 'last-year' });
    const text = visibleText(markup);
    expect(markup).toContain('data-f26-pane-tab="evidence"');
    expect(markup).toContain('data-f26-pane-tab="last-year"');
    expect(text).toContain('Form 3CD of 2025-26');
    expect(text).toContain('Form 3CD clause 13(a)–(c) Method of accounting and change in it Section (2025 Act): — · Section (1961 Act): 145 No change in substance.');
    expect(text).toContain('Clause 13 · Method of accounting and changes therein Approved Method of accounting Mercantile Change in method No');
    const pane = markup.slice(markup.indexOf('data-f26-last-year=""'));
    const paneEnd = pane.indexOf('</section>');
    const lastYearMarkup = pane.slice(0, paneEnd);
    expect(lastYearMarkup).not.toMatch(/<(input|select|textarea)\b/);
    expect(visibleText(lastYearMarkup)).not.toMatch(/\bcopy\b/i);
    // Nothing to fill in or carry across: not even a button (the fold is in the pane's title row, POLISH-2).
    expect((lastYearMarkup.match(/<button\b/g) ?? []).length).toBe(0);
    // No title row of its own inside the tab: "Last year" names the section for a screen reader only, and the
    // year's line ("Form 3CD of 2025-26") opens the body.
    expect(lastYearMarkup).toMatch(/<h3 id="f26-last-year-title" class="sr-only">Last year<\/h3>/);
    expect(visibleText(lastYearMarkup.slice(lastYearMarkup.indexOf('>') + 1)).startsWith('Last year Form 3CD of 2025-26 Clause 15 · Method of accounting and change in it')).toBe(true);
    const titleRow = markup.slice(markup.indexOf('data-f26-pane-title'), markup.indexOf('role="tabpanel"', markup.indexOf('data-f26-pane-title')));
    expect(titleRow).toContain('aria-label="Collapse evidence pane"');
  });

  it('drawn on its own (with a fold of its own), it keeps its title row as before', () => {
    const markup = html(createElement(Form26LastYear, { view: lastYearView('f26_c15', lastYearFound), clauseTitle: 'Clause 15', onRetry: () => undefined, onCollapse: () => undefined }));
    expect(markup).toMatch(/<h3 id="f26-last-year-title" class="text-sm font-semibold">Last year<\/h3>/);
    expect((markup.match(/<button\b/g) ?? []).length).toBe(1);
  });

  it('a user without access to last year (or no audit): one plain line, not an error', () => {
    const markup = html(createElement(Form26LastYear, { view: lastYearView('f26_c15', { state: 'none', year: '2025-26', form: '3cd' }), clauseTitle: 'Clause 15', onRetry: () => undefined, onCollapse: () => undefined }));
    const text = visibleText(markup);
    expect(text).toContain('No Form 3CD audit of 2025-26 is available to you for this client.');
    expect(text).not.toMatch(/error|failed|could not/i);
    expect(markup).not.toContain('Try again');
  });

  it('a new clause says so plainly; a failed read offers Try again', () => {
    const view39 = visibleText(html(createElement(Form26LastYear, { view: lastYearView('f26_c39', lastYearFound), clauseTitle: 'Clause 39', onRetry: () => undefined, onCollapse: () => undefined })));
    expect(view39).toContain('Clause 39 is new in Form No. 26. There is no Form 3CD answer for it.');
    const failed = visibleText(html(createElement(Form26LastYear, { view: lastYearView('f26_c15', { state: 'error', message: 'x' }), clauseTitle: 'Clause 15', onRetry: () => undefined, onCollapse: () => undefined })));
    expect(failed).toContain('Last year\'s tax audit could not be read. Try again');
  });
});

describe('"What changed" (static render)', () => {
  const view = (filter: Form26ChangeFilter) => html(createElement(Form26WhatChanged, { form26: result(), openClause: () => undefined, initialFilter: filter }));

  it('chips with the mapping\'s counts; the table of the chip with its six columns; every Form 26 clause opens its clause', () => {
    const markup = view('all');
    const text = visibleText(markup);
    for (const [label, count] of [['All', 52], ['New', 6], ['Changed', 33], ['Same', 13], ['Not in Form 26', 15]] as const) {
      expect(markup).toMatch(new RegExp(`>${label}<span[^>]*>${count}</span>`));
    }
    for (const label of ['Form 26 clause', 'Subject', 'Section (2025 Act)', 'Section (1961 Act)', 'Form 3CD clause', 'What changed']) expect(text).toContain(label);
    expect(attributeValues(markup, 'data-f26-change-row')).toHaveLength(52);
    expect(markup).toContain('aria-label="Open clause 14(b)–(e)"');
    expect(markup).toContain('Download briefing');
    expect(text).not.toMatch(HEDGING);
  });

  it('fit found in the running app: every cell and heading wraps (the application\'s global table rule cuts cells with "…")', () => {
    for (const filter of ['all', 'not-in-form26'] as const) {
      const markup = view(filter);
      const cells = markup.match(/<t[hd]\b[^>]*>/g) ?? [];
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        const cls = /class="([^"]*)"/.exec(cell)?.[1].split(/\s+/) ?? [];
        expect(cls, cell).toEqual(expect.arrayContaining(['!whitespace-normal', '!max-w-none', '!overflow-visible']));
      }
    }
  });

  it('each filter lists exactly what its chip counts; "Not in Form 26" lists the corrected list with its own columns', () => {
    for (const filter of ['new', 'changed', 'same'] as const) {
      expect(attributeValues(view(filter), 'data-f26-change-row')).toHaveLength(whatChangedRows(filter).counts[filter]);
    }
    const markup = view('not-in-form26');
    const text = visibleText(markup);
    for (const label of ['Form 3CD clause', 'Subject', 'Where it is now']) expect(text).toContain(label);
    expect((markup.match(/<tr class="border-b border-border\/60/g) ?? []).length).toBe(15);
    for (const entry of whatChangedRows('not-in-form26').notInForm26) expect(text).toContain(entry.position);
    expect(text).not.toMatch(HEDGING);
  });
});
