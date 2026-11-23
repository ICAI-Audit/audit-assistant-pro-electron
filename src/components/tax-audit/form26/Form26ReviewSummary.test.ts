import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The application's database client is made when its module is imported; nothing here sends a request.
vi.hoisted(() => {
  const holder = globalThis as { window?: unknown };
  if (!holder.window) holder.window = { electronAPI: { sqliteQuery: async () => ({ data: null, error: { message: 'No database in this test.' } }) } };
});

import { Form26ImportDialogBody } from '@/components/tax-audit/form26/Form26ImportDialog';
import { Form26ReviewSummary } from '@/components/tax-audit/form26/Form26ReviewSummary';
import type { UseTaxAuditForm26Result } from '@/components/tax-audit/form26/useTaxAuditForm26';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { importSummary } from '@/lib/taxAuditForm26Import';
import { summarise } from '@/lib/taxAuditForm26Review';
import { planImport } from '@/lib/taxAuditForm26SaveFile';
import { prefillParticulars, readSetup, seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues } from '@/lib/taxAuditForm26Values';
import { attributeValues, expectControlsNamed, expectFinished, expectReferencesResolve, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

const html = (element: ReactElement) => {
  const markup = renderToStaticMarkup(element);
  expectFinished(markup);
  expectReferencesResolve(markup.replace(/ aria-controls="radix-[^"]*"/g, ''));
  expectControlsNamed(markup);
  return markup;
};

function result(): UseTaxAuditForm26Result {
  const prefill = prefillParticulars(defaultValues(DEF), { clientName: 'Invented Traders Private Limited', clientPan: 'AAAAA0000A', financialYear: '2026-27' });
  const rows = seedRows(DEF, 'audit-1', prefill.values, prefill.prefilled).map((row, index) => ({ ...row, id: `row-${index}`, created_at: '2026-11-22 10:00:00', updated_at: '2026-11-22 10:00:00' })) as Form26ClauseRow[];
  const rowsByKey = new Map(rows.map((row) => [row.clause_key, row]));
  rowsByKey.set('f26_c28', { ...rowsByKey.get('f26_c28')!, review_status: 'approved', locked: 1, qualification_required: 1 });
  const values = { ...prefill.values, f: { ...prefill.values.f, cat: '2' } };
  const unfilled = scanUnfilled(DEF, values, { showAllSchedules: false });
  const nothing = async () => undefined;
  return {
    status: 'ready', errorMessage: null, retry: () => undefined, def: DEF,
    audit: { id: 'audit-1', engagement_id: 'eng-1', client_id: 'client-1', statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION, form_type: '3CB', financial_year: '2026-27' } as unknown as UseTaxAuditForm26Result['audit'],
    setup: readSetup(JSON.stringify({ form26: { v: 1, category: '2', showAllSchedules: false } })),
    values, rowsByKey,
    evidence: [{ id: 'link-1', tax_audit_id: 'audit-1', clause_response_id: 'row-x', clause_key: 'f26_c28', evidence_file_id: 'file-1', workpaper_ref: 'TA-F26-28', linked_at: '2026-11-22 10:00:00' }],
    unfilled, counts: countUnfilled(DEF, unfilled), summary: summarise(FORM26_CLAUSE_UNITS, rowsByKey, []),
    saveState: { kind: 'idle' }, unconfirmed: new Set(), fieldConflicts: {}, tableConflicts: {},
    setField: () => undefined, fieldFocused: () => undefined, fieldBlurred: () => undefined, setTable: () => undefined, tableLeft: () => undefined,
    setCategory: nothing, setShowAllSchedules: nothing, setStatus: async () => true, updateRow: async () => true, confirmBrought: nothing,
    resolveConflict: nothing, resolveTableConflict: nothing, linkEvidence: nothing, unlinkEvidence: nothing,
    applyImport: async () => ({ ok: false, written: 0, message: 'Not in this test.' }), flush: async () => true, reload: nothing,
    hasPending: () => false, hasUnresolved: () => false, unfilledNow: () => unfilled,
  };
}

describe('Form26ReviewSummary', () => {
  const markup = html(createElement(Form26ReviewSummary, { form26: result(), openClause: () => undefined, clientName: 'Invented Traders Private Limited', financialYear: '2026-27' }));
  const text = visibleText(markup);

  it('top to bottom: "To finish", the downloads, the clauses', () => {
    const at = (needle: string) => text.indexOf(needle);
    expect(at('Review Summary')).toBe(0);
    expect(at('To finish')).toBeGreaterThan(0);
    expect(at('Downloads')).toBeGreaterThan(at('To finish'));
    expect(at('Clauses')).toBeGreaterThan(at('Downloads'));
  });

  it('"To finish": grouped as the clause list, each clause a link that opens it, with what is left', () => {
    expect(text).toContain('Audit report');
    expect(text).toContain('Clause 12 · 2 items to fill');
    // Clause 28 is approved but marked for qualification with no row in B5.
    expect(text).toContain("Clause 28 · Marked for qualification, but not in the report's observations (Part B)");
    expect(attributeValues(markup, 'data-f26-finish-link')).toContain('f26_c12');
    expect(attributeValues(markup, 'data-f26-finish-link')).not.toContain('f26_part_a');
  });

  it('"To finish" reads as a to-do (POLISH-3): the things to fill first; the review folded into one line per state, which opens the list of its clauses', () => {
    // No register of "Not prepared yet" lines: the state is said once, with its count.
    expect(text).not.toMatch(/Not prepared yet/);
    const toFinish = /data-f26-to-finish="".*?<\/section>/s.exec(markup)?.[0] ?? '';
    const finishText = visibleText(toFinish);
    expect(finishText.indexOf('Clause 12 · 2 items to fill')).toBeGreaterThan(0);
    // 56 clauses are in a category (ii) report; clause 28 is approved.
    expect(finishText.indexOf('55 clauses not prepared yet')).toBeGreaterThan(finishText.indexOf('Clause 12 · 2 items to fill'));
    const line = /<button[^>]*data-f26-finish-review="not-prepared"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(line).toContain('aria-expanded="false"');
    const listId = /aria-controls="([^"]+)"/.exec(line)?.[1] ?? '';
    const list = new RegExp(`<ul[^>]*id="${listId}"[^>]*>.*?</ul>`, 's').exec(markup)?.[0] ?? '';
    expect(list).toMatch(/^<ul[^>]*\shidden=""/);
    // A display class would show it in spite of `hidden` (seen in the app: the folded "reviewed" line showed its clause).
    const listClasses = /^<ul[^>]*class="([^"]*)"/.exec(list)?.[1].split(' ') ?? [];
    for (const shown of ['flex', 'block', 'grid', 'inline-flex']) expect(listClasses).not.toContain(shown);
    // Folded, every clause stays reachable: one link per clause in that state, each opening it.
    const links = attributeValues(list, 'data-f26-finish-review-link');
    expect(links).toHaveLength(55);
    expect(links).toContain('f26_c12');
    expect(links).not.toContain('f26_c28');
    expect(links).not.toContain('f26_part_a');
    expect(visibleText(list)).toContain('Clause 12');
  });

  it('the downloads, in the plan’s words, and "Load a save file" with its hidden file box (.json)', () => {
    expect(attributeValues(markup, 'data-f26-download')).toEqual(['word', 'pdf', 'pack', 'json']);
    for (const label of ['Form No. 26 — Word', 'Form No. 26 — PDF', 'Working-paper pack', 'Save file (.json)', 'Load a save file']) expect(text).toContain(label);
    expect(markup).toMatch(/<input[^>]*type="file"[^>]*accept="\.json,application\/json"/);
    expect(text).not.toMatch(/portal/i);
    // No draft notice on the outputs, and no line saying they carry one (owner, 22 Nov 2026).
    expect(text).not.toMatch(/draft for review|Draft prepared in ICAI VERA|Draft review note/i);
  });

  it('the table of all 57 clauses: state, unfilled, evidence, qualified; every cell wraps (the global table rule is overridden)', () => {
    const rows = attributeValues(markup, 'data-f26-review-row');
    expect(rows).toEqual(FORM26_CLAUSE_UNITS.map((unit) => unit.key));
    const row28 = new RegExp(`data-f26-review-row="f26_c28".*?</tr>`).exec(markup)?.[0] ?? '';
    expect(visibleText(row28)).toContain('Approved');
    expect(visibleText(row28)).toMatch(/ 1 Yes$/);
    for (const cell of markup.match(/<t[hd]\b[^>]*>/g) ?? []) {
      expect(cell).toContain('!whitespace-normal');
      expect(cell).toContain('!max-w-none');
      expect(cell).toContain('!overflow-visible');
    }
    // No box of its own scrolls without `relative` (POLISH-1 rule).
    for (const box of markup.match(/class="[^"]*overflow-y-auto[^"]*"/g) ?? []) expect(box).toContain('relative');
  });
});

describe('Form26ImportDialogBody', () => {
  const fixture = readFileSync(new URL('../../../lib/__fixtures__/taxAuditForm26/save-everything-3-rows.json', import.meta.url), 'utf8');
  const current = { f: { ...defaultValues(DEF).f, 'C.pan': 'AAAAA1111A', 'C.name': 'Invented Other Client' }, t: defaultValues(DEF).t };
  const plan = planImport(DEF, fixture, current);
  if ('message' in plan) throw new Error(plan.message);
  const summary = importSummary(DEF, plan, current, ['f26_c28']);

  it('before anything is written: the file name, the counts, the PAN and name warning, what will not be taken', () => {
    const markup = html(createElement(Form26ImportDialogBody, { fileName: 'Form26_AAAAA0000A.json', summary, changes: 120, state: { phase: 'review' } }));
    const text = visibleText(markup);
    expect(text).toContain('Form26_AAAAA0000A.json');
    expect(text).toContain(summary.counts);
    expect(text).toContain('This file is for PAN AAAAA0000A. This audit is for PAN AAAAA1111A.');
    expect(text).toContain('This file is for Invented C.name. This audit is for Invented Other Client.');
    expect(text).toContain('1 approved clause will not be changed');
    // FIX-T29 D2: the copy is saved where the user chooses, and nothing is replaced without it.
    expect(text).toContain('First you choose where to save a copy of the present answers; nothing is replaced unless that copy is saved.');
    expect(text).not.toContain('downloaded');
    expect(markup).toContain('role="alert"');
  });

  it('while it writes: the progress "38 of 120"; a failure: its one sentence', () => {
    const running = visibleText(renderToStaticMarkup(createElement(Form26ImportDialogBody, { fileName: 'a.json', summary, changes: 120, state: { phase: 'running', done: 38, total: 120 } })));
    expect(running).toContain('38 of 120');
    const failed = visibleText(html(createElement(Form26ImportDialogBody, { fileName: 'a.json', summary, changes: 120, state: { phase: 'failed', message: 'Loading stopped after 38 of 120. The rest is unchanged. Try again.' } })));
    expect(failed).toContain('Loading stopped after 38 of 120. The rest is unchanged. Try again.');
  });

  it('the copy of the present answers was not saved (save window cancelled): nothing replaced, one plain sentence, the dialog ready to try again (FIX-T29 D2)', () => {
    const markup = html(createElement(Form26ImportDialogBody, { fileName: 'a.json', summary, changes: 120, state: { phase: 'review', notice: 'Nothing was changed: the copy of the present answers was not saved.' } }));
    expect(visibleText(markup)).toContain('Nothing was changed: the copy of the present answers was not saved.');
    expect(markup).toMatch(/<p role="status"[^>]*data-f26-import-notice=""[^>]*>Nothing was changed: the copy of the present answers was not saved\.<\/p>/);
    expect(markup).not.toContain('data-f26-import-progress');
  });

  it('a file the audit already holds says so', () => {
    expect(visibleText(html(createElement(Form26ImportDialogBody, { fileName: 'a.json', summary, changes: 0, state: { phase: 'review' } })))).toContain('The answers in this audit already match this file.');
  });
});
