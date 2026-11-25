import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { form26UnitTitle } from '@/lib/taxAuditForm26Import';
import { buildForm26Readiness, form26ToFinishGroups, form26ToFinishView } from '@/lib/taxAuditForm26Readiness';
import { planImport } from '@/lib/taxAuditForm26SaveFile';
import { prefillParticulars, seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
const NONE: ReadonlySet<string> = new Set();

function rowsOf(values: Form26Values, patch: (key: string) => Partial<Form26ClauseRow> = () => ({})): Map<string, Form26ClauseRow> {
  return new Map(
    seedRows(DEF, 'audit-1', values, []).map((row, i) => [row.clause_key, { ...row, id: `row-${i}`, ...patch(row.clause_key) } as unknown as Form26ClauseRow]),
  );
}
const opened = () => prefillParticulars(defaultValues(DEF), { clientName: 'Invented Traders Private Limited', clientPan: 'AAAAA0000A', financialYear: '2026-27' }).values;

// Every unfilled item given a value, until none is left (a "Yes" can open more).
function filledEverywhere(): Form26Values {
  const plan = planImport(DEF, fixture('save-everything-3-rows.json'), defaultValues(DEF));
  if ('message' in plan) throw new Error(plan.message);
  const values: Form26Values = JSON.parse(JSON.stringify(plan.values)) as Form26Values;
  for (let round = 0; round < 10; round += 1) {
    const items = scanUnfilled(DEF, values, { showAllSchedules: false });
    if (items.length === 0) break;
    for (const item of items) {
      if ('k' in item) {
        const field = DEF.fields.find((entry) => entry.key === item.k)!;
        values.f[item.k] = field.kind === 'yesno' ? 'No' : field.kind === 'radio' ? field.radioOptions![0].value : field.kind === 'choice' ? field.options![0] : field.kind === 'date' ? '2027-03-31' : field.kind === 'number' ? '1' : 'Invented';
      } else {
        const rows = (values.t[item.t] = values.t[item.t] ?? []);
        while (rows.length <= item.r) rows.push({});
        rows[item.r] = { ...rows[item.r], [item.c]: '1' };
      }
    }
  }
  return values;
}

describe('buildForm26Readiness', () => {
  it('as opened: not ready; the 45 unfilled items less the 3 prefilled ones, under their clauses; every clause "not prepared"', () => {
    const values = opened();
    const rows = rowsOf(values);
    const result = buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: NONE });
    expect(result.ready).toBe(false);
    const unfilled = result.items.filter((item) => item.kind === 'unfilled');
    expect(unfilled.reduce((n, item) => n + (item.count ?? 0), 0)).toBe(42);
    const counts = countUnfilled(DEF, scanUnfilled(DEF, values, { showAllSchedules: false })).clause;
    for (const item of unfilled) expect(item.count).toBe(counts[item.clauseKey]);
    expect(unfilled.find((item) => item.clauseKey === 'f26_c12')).toMatchObject({ count: 2, text: '2 items to fill' });
    // Category (ii) is the file's preset: Part A is not part of this report, so it is not listed.
    const notPrepared = result.items.filter((item) => item.kind === 'not-prepared').map((item) => item.clauseKey);
    expect(notPrepared).toEqual(FORM26_CLAUSE_UNITS.filter((unit) => unit.key !== 'f26_part_a').map((unit) => unit.key));
    expect(result.items.find((item) => item.kind === 'not-prepared')!.text).toBe('Not prepared yet');
  });

  it('everything filled, all approved: ready, nothing to finish', () => {
    const values = filledEverywhere();
    const rows = rowsOf(values, () => ({ review_status: 'approved', locked: 1 }));
    expect(buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: NONE })).toEqual({ ready: true, items: [] });
  });

  it('prepared and reviewed clauses say what is next', () => {
    const values = filledEverywhere();
    const rows = rowsOf(values, (key) => ({ review_status: key === 'f26_c14' ? 'prepared' : key === 'f26_c15' ? 'reviewed' : 'approved', locked: key === 'f26_c14' || key === 'f26_c15' ? 0 : 1 }));
    const items = buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: NONE }).items;
    expect(items).toEqual([
      { kind: 'not-reviewed', clauseKey: 'f26_c14', text: 'Prepared, not reviewed yet' },
      { kind: 'not-approved', clauseKey: 'f26_c15', text: 'Reviewed, not approved yet' },
    ]);
  });

  it('a qualified clause 14 with no row "14" in B5 is listed; with the row it is not', () => {
    const values = filledEverywhere();
    values.t.B5 = (values.t.B5 ?? []).map((row) => ({ ...row, 1: '' }));
    const rows = rowsOf(values, (key) => ({ review_status: 'approved', locked: 1, qualification_required: key === 'f26_c14' ? 1 : 0 }));
    const listed = buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: NONE });
    expect(listed.ready).toBe(false);
    expect(listed.items).toEqual([{ kind: 'qualified-without-row', clauseKey: 'f26_c14', text: "Marked for qualification, but not in the report's observations (Part B)" }]);
    values.t.B5 = [{ ...(values.t.B5?.[0] ?? {}), 1: '14', 3: 'Invented observation' }];
    expect(buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: NONE }).items).toEqual([]);
  });

  it('no category: one item of kind category, first', () => {
    const values = filledEverywhere();
    delete values.f.cat;
    const rows = rowsOf(values, () => ({ review_status: 'approved', locked: 1 }));
    const items = buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: NONE }).items;
    expect(items.filter((item) => item.kind === 'category')).toEqual([{ kind: 'category', clauseKey: 'f26_category', text: 'Choose the category of assessee' }]);
    expect(items[0].kind).toBe('category');
  });

  it('answers brought from the 3CD draft wait for confirmation; a clash waits for a choice', () => {
    const values = filledEverywhere();
    const rows = rowsOf(values, () => ({ review_status: 'approved', locked: 1 }));
    const items = buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: new Set(['c10', 'c15b']), conflicts: ['f26_c28'] }).items;
    expect(items).toEqual([
      { kind: 'to-confirm', clauseKey: 'f26_c10', text: '1 answer brought from the 3CD draft to confirm', count: 1 },
      { kind: 'to-confirm', clauseKey: 'f26_c15', text: '1 answer brought from the 3CD draft to confirm', count: 1 },
      { kind: 'changed-elsewhere', clauseKey: 'f26_c28', text: 'Changed by someone else: choose which entry to keep' },
    ]);
  });

  it('"To finish" as a to-do (POLISH-3): what to fill first, per clause; the review folded into one line per state', () => {
    const values = opened();
    const items = buildForm26Readiness({ def: DEF, values, rowsByKey: rowsOf(values), unconfirmed: NONE }).items;
    const view = form26ToFinishView(items);
    // The things to fill: per clause, with counts; no review state among them.
    const toFill = view.toFill.flatMap((group) => group.clauses);
    expect(toFill.flatMap((clause) => clause.items).every((item) => item.kind === 'unfilled')).toBe(true);
    expect(toFill.find((clause) => clause.clauseKey === 'f26_c12')!.items.map((item) => item.text)).toEqual(['2 items to fill']);
    expect(toFill.flatMap((clause) => clause.items).reduce((n, item) => n + (item.count ?? 0), 0)).toBe(42);
    // The review: one line, with its count and every clause it stands for, in form order.
    const inReport = FORM26_CLAUSE_UNITS.filter((unit) => unit.key !== 'f26_part_a');
    expect(view.review).toEqual([
      { kind: 'not-prepared', text: `${inReport.length} clauses not prepared yet`, count: inReport.length, clauses: inReport.map((unit) => ({ clauseKey: unit.key, title: form26UnitTitle(unit), label: unit.label })) },
    ]);
    expect(view.review[0].clauses.find((clause) => clause.clauseKey === 'f26_c12')!.title).toBe('Clause 12');
  });

  it('"To finish" (POLISH-3): one line per review state, in order, singular when one; every item still reachable', () => {
    const values = filledEverywhere();
    const state = (key: string) => (key === 'f26_c14' || key === 'f26_c16' ? 'prepared' : key === 'f26_c15' ? 'reviewed' : key === 'f26_c9' ? 'draft' : 'approved');
    const rows = rowsOf(values, (key) => ({ review_status: state(key), locked: state(key) === 'approved' ? 1 : 0, qualification_required: key === 'f26_c20' ? 1 : 0 }));
    values.t.B5 = (values.t.B5 ?? []).map((row) => ({ ...row, 1: '' }));
    const items = buildForm26Readiness({ def: DEF, values, rowsByKey: rows, unconfirmed: new Set(['c10']), conflicts: ['f26_c28'] }).items;
    const view = form26ToFinishView(items);
    expect(view.review.map((line) => [line.kind, line.text, line.clauses.map((clause) => clause.clauseKey)])).toEqual([
      ['not-prepared', '1 clause not prepared yet', ['f26_c9']],
      ['not-reviewed', '2 clauses prepared, not reviewed yet', ['f26_c14', 'f26_c16']],
      ['not-approved', '1 clause reviewed, not approved yet', ['f26_c15']],
    ]);
    expect(view.toFill.flatMap((group) => group.clauses).map((clause) => [clause.clauseKey, clause.items.map((item) => item.kind)])).toEqual([
      ['f26_c10', ['to-confirm']],
      ['f26_c20', ['qualified-without-row']],
      ['f26_c28', ['changed-elsewhere']],
    ]);
    // Nothing is lost by the folding: every item's clause is reachable from one of the two parts.
    const reachable = new Set([...view.toFill.flatMap((group) => group.clauses.map((clause) => clause.clauseKey)), ...view.review.flatMap((line) => line.clauses.map((clause) => clause.clauseKey))]);
    expect([...new Set(items.map((item) => item.clauseKey))].every((key) => reachable.has(key))).toBe(true);
    // Nothing left: both parts empty.
    expect(form26ToFinishView([])).toEqual({ toFill: [], review: [] });
  });

  it('groups: by the list groups of the form, in their order, each item under its clause', () => {
    const values = opened();
    const groups = form26ToFinishGroups(buildForm26Readiness({ def: DEF, values, rowsByKey: rowsOf(values), unconfirmed: NONE }).items);
    expect(groups.map((group) => group.title).slice(0, 3)).toEqual(['Audit report', 'Part C: Particulars of the assessee', 'A - General Information']);
    const c12 = groups.flatMap((group) => group.clauses).find((clause) => clause.clauseKey === 'f26_c12')!;
    expect(c12.title).toBe('Clause 12');
    expect(c12.items.map((item) => item.kind)).toEqual(['unfilled', 'not-prepared']);
  });
});
