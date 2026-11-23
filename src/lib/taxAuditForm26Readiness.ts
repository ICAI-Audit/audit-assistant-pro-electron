// "To finish" on the Review Summary (BUILD-PLAN task 24): what is still to be done before the Form No. 26 draft is
// complete, clause by clause, in the form's order, grouped as the clause list groups them. Pure.
//
// For every clause the report has (the other category's Part is not part of it): the category not chosen; the
// items still to fill (as "Next unfilled" counts them); answers brought from the 3CD draft not yet confirmed; a
// change that met someone else's and waits for a choice; a clause marked for qualification that is not in the
// report's observations table; and where its review stands (not prepared, not reviewed, not approved).
// `ready` is true when nothing is left.
import { FORM26_CLAUSE_UNITS, FORM26_LIST_GROUPS, form26ClauseKeyOfField, type Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Definition } from '@/data/taxAuditForm26Types';
import { form26UnitTitle } from '@/lib/taxAuditForm26Import';
import { categoryOf, isFieldShown, type Form26ViewOptions } from '@/lib/taxAuditForm26Reveal';
import { hasObservationFor, isRowLocked, qualificationRow } from '@/lib/taxAuditForm26Review';
import { FORM26_CATEGORY_ROW_KEY } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import type { Form26Values } from '@/lib/taxAuditForm26Values';

export type Form26ToFinish = {
  kind: 'category' | 'unfilled' | 'to-confirm' | 'not-prepared' | 'not-reviewed' | 'not-approved' | 'qualified-without-row' | 'changed-elsewhere';
  clauseKey: string;
  text: string;
  count?: number;
};
export type Form26ToFinishGroup = { id: string; title: string; clauses: { clauseKey: string; title: string; label: string; items: Form26ToFinish[] }[] };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** Is this clause part of the report for the category chosen? (No category: both Parts are.) */
export function isUnitInReport(unit: Form26ClauseUnit, values: Form26Values): boolean {
  const category = categoryOf(values);
  return unit.category === null || category === null || unit.category === category;
}

export function buildForm26Readiness(input: {
  def: Form26Definition;
  values: Form26Values;
  rowsByKey: Map<string, Form26ClauseRow>;
  unconfirmed: ReadonlySet<string>;
  /** The screen's view ("Show all schedules" counts what it shows, as "Next unfilled" does). */
  view?: Form26ViewOptions;
  /** Clause keys with a change waiting for the user's choice (an answer's clause, or a table's clause). */
  conflicts?: string[];
}): { ready: boolean; items: Form26ToFinish[] } {
  const { def, values, rowsByKey, unconfirmed } = input;
  const view = input.view ?? { showAllSchedules: false };
  const unfilled = countUnfilled(def, scanUnfilled(def, values, view)).clause;
  const toConfirm: Record<string, number> = {};
  for (const key of unconfirmed) {
    if (!def.fields.some((field) => field.key === key) || !isFieldShown(def, key, values, view)) continue;
    const clauseKey = form26ClauseKeyOfField(key);
    toConfirm[clauseKey] = (toConfirm[clauseKey] ?? 0) + 1;
  }
  const conflicts = new Set(input.conflicts ?? []);
  const category = categoryOf(values);
  const observations = category === '1' ? values.t.A5 : category === '2' ? values.t.B5 : undefined;

  const items: Form26ToFinish[] = [];
  for (const unit of FORM26_CLAUSE_UNITS) {
    if (!isUnitInReport(unit, values)) continue;
    const key = unit.key;
    if (key === FORM26_CATEGORY_ROW_KEY && category === null) items.push({ kind: 'category', clauseKey: key, text: 'Choose the category of assessee' });
    const toFill = unfilled[key] ?? 0;
    if (toFill > 0) items.push({ kind: 'unfilled', clauseKey: key, text: plural(toFill, 'item to fill', 'items to fill'), count: toFill });
    const brought = toConfirm[key] ?? 0;
    if (brought > 0) items.push({ kind: 'to-confirm', clauseKey: key, text: `${plural(brought, 'answer', 'answers')} brought from the 3CD draft to confirm`, count: brought });
    if (conflicts.has(key)) items.push({ kind: 'changed-elsewhere', clauseKey: key, text: 'Changed by someone else: choose which entry to keep' });
    const row = rowsByKey.get(key);
    if (!row) continue;
    if (row.qualification_required) {
      const target = qualificationRow(unit.no, 'x', category ?? '');
      if (target && !hasObservationFor(observations, unit.no)) {
        items.push({ kind: 'qualified-without-row', clauseKey: key, text: `Marked for qualification, but not in the report's observations (${target.table === 'A5' ? 'Part A' : 'Part B'})` });
      }
    }
    if (isRowLocked(row)) continue;
    if (row.review_status === 'reviewed') items.push({ kind: 'not-approved', clauseKey: key, text: 'Reviewed, not approved yet' });
    else if (row.review_status === 'prepared') items.push({ kind: 'not-reviewed', clauseKey: key, text: 'Prepared, not reviewed yet' });
    else items.push({ kind: 'not-prepared', clauseKey: key, text: 'Not prepared yet' });
  }
  return { ready: items.length === 0, items };
}

const UNIT_BY_KEY = new Map(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit]));

export type Form26ReviewKind = 'not-prepared' | 'not-reviewed' | 'not-approved';
export type Form26ReviewLine = { kind: Form26ReviewKind; text: string; count: number; clauses: { clauseKey: string; title: string; label: string }[] };

const REVIEW_KINDS: Form26ReviewKind[] = ['not-prepared', 'not-reviewed', 'not-approved'];
const REVIEW_TEXT: Record<Form26ReviewKind, string> = {
  'not-prepared': 'not prepared yet',
  'not-reviewed': 'prepared, not reviewed yet',
  'not-approved': 'reviewed, not approved yet',
};
const isReviewKind = (kind: Form26ToFinish['kind']): kind is Form26ReviewKind => (REVIEW_KINDS as string[]).includes(kind);

/**
 * "To finish" as a to-do list (POLISH-3): first what is to be filled or decided, per clause with its counts
 * (grouped as the clause list groups them); then where the review stands, one line per state with the number of
 * clauses ("56 clauses not prepared yet") and every clause it stands for, in form order.
 */
export function form26ToFinishView(items: Form26ToFinish[]): { toFill: Form26ToFinishGroup[]; review: Form26ReviewLine[] } {
  const review: Form26ReviewLine[] = [];
  for (const kind of REVIEW_KINDS) {
    const clauses = items
      .filter((item) => item.kind === kind)
      .map((item) => UNIT_BY_KEY.get(item.clauseKey))
      .filter((unit): unit is Form26ClauseUnit => unit !== undefined)
      .map((unit) => ({ clauseKey: unit.key, title: form26UnitTitle(unit), label: unit.label }));
    if (clauses.length > 0) review.push({ kind, text: `${plural(clauses.length, 'clause', 'clauses')} ${REVIEW_TEXT[kind]}`, count: clauses.length, clauses });
  }
  return { toFill: form26ToFinishGroups(items.filter((item) => !isReviewKind(item.kind))), review };
}

/** The items as "To finish" shows them: by the groups of the clause list, in their order, under each clause. */
export function form26ToFinishGroups(items: Form26ToFinish[]): Form26ToFinishGroup[] {
  const groups: Form26ToFinishGroup[] = [];
  for (const group of FORM26_LIST_GROUPS) {
    const clauses: Form26ToFinishGroup['clauses'] = [];
    for (const item of items) {
      const unit = UNIT_BY_KEY.get(item.clauseKey);
      if (!unit || unit.group !== group.id) continue;
      let clause = clauses.find((entry) => entry.clauseKey === unit.key);
      if (!clause) {
        clause = { clauseKey: unit.key, title: form26UnitTitle(unit), label: unit.label, items: [] };
        clauses.push(clause);
      }
      clause.items.push(item);
    }
    if (clauses.length > 0) groups.push({ id: group.id, title: group.title, clauses });
  }
  return groups;
}
