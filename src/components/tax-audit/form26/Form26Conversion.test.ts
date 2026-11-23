import { createElement, type ComponentType, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The application's contexts make their database client when they are imported; nothing here sends a request.
vi.hoisted(() => {
  const holder = globalThis as { window?: unknown };
  if (!holder.window) holder.window = { electronAPI: { sqliteQuery: async () => ({ data: null, error: { message: 'No database in this test.' } }) } };
});

import { Form26ConversionNotice } from '@/components/tax-audit/form26/Form26ConversionNotice';
import { Form26DraftNotice, FORM26_DRAFT_NOTICE_TEXT } from '@/components/tax-audit/form26/Form26DraftNotice';
import { Form26ReadOnlyBody } from '@/components/tax-audit/form26/Form26ReadOnlyView';
import { Form26ReviewSummary } from '@/components/tax-audit/form26/Form26ReviewSummary';
import type { Form26SharedParts } from '@/components/tax-audit/form26/Form26RightPane';
import { ThreeCdDraftReadOnly } from '@/components/tax-audit/form26/ThreeCdDraftReadOnly';
import { TaxAuditFormChooserView } from '@/components/tax-audit/form26/TaxAuditFormChooser';
import type { UseTaxAuditForm26Result } from '@/components/tax-audit/form26/useTaxAuditForm26';
import { Form26WorkspaceBody } from '@/components/tax-audit/form26/Form26Workspace';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { conversionNoticeText, type ThreeCdSnapshot } from '@/lib/taxAuditForm26Conversion';
import { buildForm26ExportModel } from '@/lib/taxAuditForm26ExportModel';
import { summarise } from '@/lib/taxAuditForm26Review';
import { prefillParticulars, readSetup, seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseEvidence, TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';
import { attributeValues, expectControlsNamed, expectFinished, expectReferencesResolve, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

const html = (element: ReactElement) => {
  const markup = renderToStaticMarkup(element);
  expectFinished(markup);
  expectReferencesResolve(markup.replace(/ aria-controls="radix-[^"]*"/g, ''));
  expectControlsNamed(markup);
  return markup;
};
// Nothing that can take an entry: no box, no choice, no editable text, no switch.
const WRITING = /<input|<textarea|<select|contenteditable|role="(checkbox|radio|switch|textbox|combobox)"/;

const parts: Form26SharedParts = {
  EvidenceRail: ({ clause }) => createElement('div', { 'data-rail': clause.clause_key }, `Sources, Evidence and Review · ${clause.workpaper_ref}`),
};

// The earlier Form 3CD draft: the 49 rows the 3CD page seeds, clause 13 and clause 31 answered later (invented).
function draft(answers: Record<string, Record<string, unknown>> = {}): ThreeCdSnapshot {
  const rows = FORM_3CD_CLAUSES.map((clause, index) => ({
    id: `3cd-${index}`, tax_audit_id: 'audit-3cd', clause_key: clause.key, clause_no: clause.clauseNo, clause_title: clause.title,
    statutory_version: 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025', response_json: answers[clause.key] ? JSON.stringify({ structured: answers[clause.key] }) : '{}',
    prefill_status: 'needs_input', qualification_required: 0, review_status: clause.key === 'clause_13' && answers.clause_13 ? 'prepared' : 'draft', locked: 0,
    created_at: '2026-11-20 09:00:00', updated_at: answers[clause.key] ? '2026-11-21 11:00:00' : '2026-11-20 09:00:00',
  })) as unknown as TaxAuditClauseResponse[];
  return { audit: { id: 'audit-3cd', engagement_id: 'eng-1' } as unknown as TaxAuditSetup, rows, evidenceCount: 0, hasAcceptanceCheck: false };
}
const ANSWERED = draft({
  clause_13: { method_of_accounting: 'Cash', whether_change_in_method: 'no' },
  clause_31: { clause_31a_loan_deposit_rows: [{ lender_or_depositor_name: 'Invented Lender', amount_of_loan_or_deposit: '50000' }] },
});

function result(options: { conversion?: Record<string, unknown>; brought?: boolean; values?: (values: Form26Values) => Form26Values } = {}): UseTaxAuditForm26Result {
  const prefill = prefillParticulars(defaultValues(DEF), { clientName: 'Invented Traders Private Limited', clientPan: 'AAAAA0000A', financialYear: '2026-27' });
  const rows = seedRows(DEF, 'audit-1', prefill.values, prefill.prefilled).map((row, index) => ({ ...row, id: `row-${index}`, created_at: '2026-11-22 10:00:00', updated_at: '2026-11-22 10:00:00' })) as Form26ClauseRow[];
  const rowsByKey = new Map(rows.map((row) => [row.clause_key, row]));
  let values: Form26Values = { ...prefill.values, f: { ...prefill.values.f, cat: '2' } };
  const unconfirmed = new Set<string>();
  if (options.brought) {
    const row = rowsByKey.get('f26_c15') as Form26ClauseRow;
    rowsByKey.set('f26_c15', { ...row, response_json: JSON.stringify({ v: 1, f: { c15a: 'Cash system', c15b: 'No' }, brought: { c15a: { from: 'clause_13', at: '2026-11-22T10:00:00.000Z' }, c15b: { from: 'clause_13', at: '2026-11-22T10:00:00.000Z' } } }) });
    values = { ...values, f: { ...values.f, c15a: 'Cash system', c15b: 'No' } };
    unconfirmed.add('c15a').add('c15b');
  }
  if (options.values) values = options.values(values);
  const setup = readSetup(JSON.stringify({ form26: { v: 1, category: '2', showAllSchedules: false, ...(options.conversion ? { conversion: options.conversion } : {}) } }));
  const unfilled = scanUnfilled(DEF, values, { showAllSchedules: false, unconfirmed });
  const nothing = async () => undefined;
  return {
    status: 'ready', errorMessage: null, retry: () => undefined, def: DEF,
    audit: { id: 'audit-1', engagement_id: 'eng-1', statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION, form_type: '3CB', financial_year: '2026-27' } as unknown as UseTaxAuditForm26Result['audit'],
    setup, values, rowsByKey, evidence: [] as TaxAuditClauseEvidence[], unfilled, counts: countUnfilled(DEF, unfilled), summary: summarise(FORM26_CLAUSE_UNITS, rowsByKey, []),
    saveState: { kind: 'idle' }, unconfirmed, fieldConflicts: {}, tableConflicts: {},
    setField: () => undefined, fieldFocused: () => undefined, fieldBlurred: () => undefined, setTable: () => undefined, tableLeft: () => undefined,
    setCategory: nothing, setShowAllSchedules: nothing, setStatus: async () => true, updateRow: async () => true, confirmBrought: nothing,
    resolveConflict: nothing, resolveTableConflict: nothing, linkEvidence: nothing, unlinkEvidence: nothing,
    applyImport: async () => ({ ok: false, written: 0, message: 'Not in this test.' }), flush: async () => true, reload: nothing,
    hasPending: () => false, hasUnresolved: () => false, unfilledNow: () => unfilled,
  };
}
const CONVERTED = { fromTaxAuditId: 'audit-3cd', startedAt: '2026-11-22T10:00:00.000Z', completedAt: '2026-11-22T10:00:01.000Z', untouched: false, carried: ['c15a', 'c15b'] };
const workspace = (form26: UseTaxAuditForm26Result, opts: { clause?: string; draft?: ThreeCdSnapshot | null; paneTab?: 'evidence' | 'last-year' | 'three-cd-draft'; year?: string } = {}) =>
  html(createElement(Form26WorkspaceBody, {
    parts, form26, canApprove: true, clientName: 'Invented Traders Private Limited', financialYear: opts.year ?? '2026-27',
    initialClauseKey: opts.clause, threeCdDraft: opts.draft === undefined ? ANSWERED : opts.draft, initialPaneTab: opts.paneTab, lastYear: null,
  }));

describe('task 26: the conversion notice', () => {
  it('says what happened in two sentences, that the draft is kept with its evidence, and where to see it; it can be dismissed', () => {
    const text = conversionNoticeText({ waiting: 2, brought: 2, beside: 5 });
    const markup = html(createElement(Form26ConversionNotice, { text, onView: () => undefined, onDismiss: () => undefined }));
    expect(visibleText(markup)).toBe(`${text} View the earlier 3CD draft`);
    expect(markup).toContain('aria-label="Dismiss this notice"');
    expect(visibleText(markup)).not.toMatch(/our reading|to be verified|mock-up|sic\b|editor's note/i);
  });

  it('is compact (task 27: at 1280 x 720 it took 110 px between header and panes): small type, small padding, half the column gaps; the whole text kept, no hover text', () => {
    const text = conversionNoticeText({ waiting: 3, brought: 3, beside: 5 });
    const markup = html(createElement(Form26ConversionNotice, { text, onView: () => undefined, onDismiss: () => undefined }));
    const box = /<section aria-label="Form 3CD draft brought across" class="([^"]*)"/.exec(markup)?.[1] ?? '';
    for (const cls of ['shrink-0', 'py-1', 'text-xs', 'leading-4', '-my-2']) expect(box.split(' ')).toContain(cls);
    // The words and the link: small type (the dismiss button holds an icon only).
    const link = /<button[^>]*class="([^"]*)"[^>]*data-f26-view-3cd-draft=""/.exec(markup)?.[1].split(' ') ?? [];
    const words = /<p class="([^"]*)"/.exec(markup)?.[1].split(' ') ?? [];
    expect(link).toContain('text-xs');
    for (const cls of ['py-2', 'text-sm', 'leading-5']) for (const classes of [box.split(' '), words, link]) expect(classes).not.toContain(cls);
    expect(visibleText(markup)).toBe(`${text} View the earlier 3CD draft`);
    // The full text is on screen, not behind a hover: the only title is the dismiss button's own name.
    expect(attributeValues(markup, 'title')).toEqual(['Dismiss this notice']);
  });

  it('the workspace of a converted audit shows it at the top, over the panes, with the live numbers', () => {
    const markup = workspace(result({ conversion: CONVERTED, brought: true }));
    const text = visibleText(markup);
    // clause 13 is tied to clauses 15, 17 and 18; clause 31 to 45.
    expect(text).toContain(conversionNoticeText({ waiting: 2, brought: 2, beside: 4 }));
    expect(markup.indexOf('data-f26-conversion-notice')).toBeGreaterThan(markup.indexOf('</header>'));
    expect(markup.indexOf('data-f26-conversion-notice')).toBeLessThan(markup.indexOf('data-f26-panes'));
    expect(markup).toMatch(/<section aria-label="Form 3CD draft brought across" class="[^"]*shrink-0/);
  });

  it('an untouched draft (or an audit not converted) has no notice and no "3CD draft" tab', () => {
    for (const markup of [workspace(result({ conversion: { ...CONVERTED, untouched: true, carried: [] } }), { draft: draft() }), workspace(result(), { draft: null })]) {
      expect(markup).not.toContain('data-f26-conversion-notice');
      expect(markup).not.toContain('data-f26-pane-tab="three-cd-draft"');
      expect(markup).not.toContain('data-f26-3cd-answer-line');
    }
  });
});

describe('task 26: a brought answer, the old answer beside a clause', () => {
  it('a brought field shows "Brought from the 3CD draft" with "Confirm"', () => {
    const text = visibleText(workspace(result({ conversion: CONVERTED, brought: true }), { clause: 'f26_c15' }));
    expect(text).toContain('Brought from the 3CD draft');
    expect(text).toContain('Confirm');
  });

  it('a clause the draft has an answer for says so quietly, and its pane has the tab "3CD draft" beside Evidence and Last year', () => {
    const markup = workspace(result({ conversion: CONVERTED }), { clause: 'f26_c45' });
    expect(visibleText(markup)).toContain('The earlier Form 3CD draft has an answer for this clause. See it');
    expect(markup).toContain('data-f26-pane-tab="three-cd-draft"');
    expect(markup).toMatch(/role="tablist"[^>]*aria-label="Evidence, last year or 3CD draft"/);
    // A clause the draft holds nothing for has no such line.
    expect(workspace(result({ conversion: CONVERTED }), { clause: 'f26_c22' })).not.toContain('data-f26-3cd-answer-line');
  });

  it('the "3CD draft" tab shows the old clause 31 rows of clause 45 as text, with nothing that writes', () => {
    const markup = workspace(result({ conversion: CONVERTED }), { clause: 'f26_c45', paneTab: 'three-cd-draft' });
    const pane = markup.slice(markup.indexOf('aria-label="Sources, Evidence and Review"'));
    const text = visibleText(pane);
    expect(text).toContain("This engagement's earlier Form 3CD draft");
    expect(text).toContain('Clause 31 · Loans, deposits and specified sums');
    expect(text).toContain('Invented Lender');
    expect(text).not.toMatch(/Last year's answers/);
    expect(pane.slice(0, pane.indexOf('</section>'))).not.toMatch(WRITING);
  });
});

describe('task 26: the earlier draft read only', () => {
  it('ThreeCdDraftReadOnly lists the 49 clauses with titles, state and answers, and holds no control at all', () => {
    const markup = html(createElement(ThreeCdDraftReadOnly, { snapshot: ANSWERED }));
    expect(markup.match(/data-f26-3cd-draft-clause=/g)).toHaveLength(49);
    const text = visibleText(markup);
    expect(text).toContain('Clause 13 · Method of accounting and changes therein Prepared Method of accounting Cash Change in method No');
    expect(text).toContain('Clause 1 · Name of the assessee Draft No answer was recorded.');
    expect(markup).not.toMatch(WRITING);
    expect(markup).not.toContain('<button');
  });

  it('the Review Summary of an audit with an earlier draft has the quiet link; without one it has none', () => {
    const props = { form26: result({ conversion: { ...CONVERTED, untouched: true, carried: [] } }), openClause: () => undefined, clientName: 'Invented Traders Private Limited', financialYear: '2026-27' };
    const withLink = html(createElement(Form26ReviewSummary, { ...props, onViewThreeCdDraft: () => undefined }));
    expect(visibleText(withLink)).toContain('This engagement also holds an earlier Form 3CD draft, kept unchanged. View the earlier 3CD draft');
    expect(html(createElement(Form26ReviewSummary, props))).not.toContain('data-f26-summary-3cd-draft');
  });
});

describe('task 26: a changed year', () => {
  it('2026-27 -> 2027-28: under item 8 "The engagement is now for 2027-28." with "Update"; nothing when it already says so', () => {
    const moved = visibleText(workspace(result(), { clause: 'f26_p8', year: '2027-28', draft: null }));
    expect(moved).toContain('The engagement is now for 2027-28. Update');
    expect(visibleText(workspace(result(), { clause: 'f26_p8', draft: null }))).not.toContain('The engagement is now for');
  });

  it('a year changed back: the Form 3CD page with the notice above it, and the page itself drawn as it is', () => {
    const ThreeCd: ComponentType = () => createElement('section', { 'data-page': '3cd' }, 'The Form 3CD page as today');
    const draw = (form26DraftOf: string | null) =>
      renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TaxAuditFormChooserView, { view: 'three-cd', ThreeCd, parts, financialYear: '2025-26', form26DraftOf })));
    const page = renderToStaticMarkup(createElement(ThreeCd));
    expect(draw(null)).toBe(page);
    const markup = draw('eng-1');
    expect(markup.endsWith(page)).toBe(true);
    expect(visibleText(markup)).toBe(`${FORM26_DRAFT_NOTICE_TEXT} View it The Form 3CD page as today`);
    expectControlsNamed(markup);
  });

  it('the notice alone: one button, nothing else', () => {
    const markup = html(createElement(Form26DraftNotice, { engagementId: 'eng-1' }));
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).not.toMatch(WRITING);
  });

  it('Form26ReadOnlyView draws the export model as text and tables: no box, no choice, no button; nothing cut', () => {
    const values = defaultValues(DEF);
    values.f['C.name'] = 'Invented Traders Private Limited';
    values.f.c13 = 'Books kept at the invented office';
    values.t.S28 = [{ '1': 'Invented Act', '2': 'Invented penalty', '3': '1000' }];
    values.f.c28 = 'Yes';
    const model = buildForm26ExportModel(DEF, values, { showAllSchedules: false, generatedAt: '2026-11-22T10:00:00.000Z' });
    const markup = html(createElement(Form26ReadOnlyBody, { model }));
    const text = visibleText(markup);
    expect(text).toContain('Invented Traders Private Limited');
    expect(text).toContain('Books kept at the invented office');
    expect(text).toContain('Invented penalty');
    expect(markup).not.toMatch(WRITING);
    // No draft notice (owner, 22 Nov 2026): the view opens with the form's own heading.
    expect(text).not.toMatch(/Draft review note|Draft prepared in ICAI VERA/);
    expect(text.startsWith('FORM NO. 26')).toBe(true);
    expect(markup).not.toContain('<button');
    for (const cell of markup.match(/<t[hd][\s>][^>]*>/g) ?? []) expect(cell).toContain('!whitespace-normal');
  });
});
