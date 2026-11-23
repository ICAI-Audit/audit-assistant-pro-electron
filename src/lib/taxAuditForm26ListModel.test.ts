import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_CLAUSE_UNITS, FORM26_LIST_GROUPS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import {
  buildListModel,
  entryForUnfilledItem,
  FORM26_LIST_FILTERS,
  FORM26_VIEW_SWITCHES,
  form26ViewSummary,
  listScrollFor,
  type Form26ListEntry,
  type Form26ListFilter,
  type Form26ListModel,
} from '@/lib/taxAuditForm26ListModel';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseEvidence, TaxAuditReviewStatus } from '@/types/taxAudit';

// Expected values: the owner's file's own states (fixture unfilled.json) and the form's definition.
type UnfilledState = { name: string; showAll: boolean; values: Form26Values };
const STATES = JSON.parse(
  readFileSync(new URL('./__fixtures__/taxAuditForm26/unfilled.json', import.meta.url), 'utf8'),
) as UnfilledState[];
const stateValues = (name: string): Form26Values => {
  const state = STATES.find((entry) => entry.name === name);
  if (!state) throw new Error(`no fixture state ${name}`);
  return JSON.parse(JSON.stringify(state.values)) as Form26Values;
};

const NORMAL = { showAllSchedules: false };

/** An invented clause row: only what the list reads differs between rows. */
function row(clauseKey: string, patch: Partial<Form26ClauseRow> = {}): Form26ClauseRow {
  return {
    id: `row-${clauseKey}`,
    tax_audit_id: 'audit-1',
    clause_key: clauseKey,
    clause_no: clauseKey,
    clause_title: clauseKey,
    statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION,
    applicability_status: 'applicable',
    prefill_status: 'not_attempted',
    validation_status: 'not_run',
    qualification_required: 0,
    review_status: 'draft',
    locked: 0,
    ...patch,
  };
}

function rowsFor(patches: Record<string, Partial<Form26ClauseRow>> = {}): Map<string, Form26ClauseRow> {
  return new Map(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, row(unit.key, patches[unit.key])]));
}

function link(clauseKey: string): TaxAuditClauseEvidence {
  return {
    id: `link-${clauseKey}`,
    tax_audit_id: 'audit-1',
    clause_response_id: `row-${clauseKey}`,
    clause_key: clauseKey,
    evidence_file_id: 'file-1',
    linked_at: '2026-11-22 10:00:00',
  };
}

function model(
  values: Form26Values,
  extra: Partial<{ filter: Form26ListFilter; search: string; showAll: boolean; rows: Map<string, Form26ClauseRow>; evidence: TaxAuditClauseEvidence[] }> = {},
): Form26ListModel {
  return buildListModel({
    def: DEF,
    values,
    view: { showAllSchedules: extra.showAll ?? false },
    rowsByKey: extra.rows ?? rowsFor(),
    evidence: extra.evidence ?? [],
    unconfirmed: new Set(),
    filter: extra.filter ?? 'all',
    search: extra.search ?? '',
  });
}

const entries = (m: Form26ListModel): Form26ListEntry[] => m.groups.flatMap((group) => group.entries);
const clauseNos = (m: Form26ListModel) => entries(m).filter((entry) => entry.kind === 'clause').map((entry) => entry.no);
const scheduleIds = (m: Form26ListModel) => entries(m).filter((entry) => entry.kind === 'schedule').map((entry) => entry.scheduleId);

describe('Form 26 clause list model', () => {
  it('at open the list has 56 clause entries (Part A left out) and 5 schedule entries (12(a), 50(a), 50(b), 52(a), 52(b)); total unfilled equals task 6 for the same values', () => {
    const values = defaultValues(DEF);
    const m = model(values);
    expect(clauseNos(m)).toHaveLength(56);
    expect(clauseNos(m)).not.toContain('Part A');
    expect(clauseNos(m)).toContain('Part B');
    expect(scheduleIds(m)).toEqual(['s12a', 's50a', 's50b', 's52a', 's52b']);
    expect(m.totalEntries).toBe(61);
    expect(m.totalUnfilled).toBe(scanUnfilled(DEF, values, NORMAL).length);
    expect(m.totalUnfilled).toBe(45);
  });

  it('with every answer Yes the list has 56 + 55 = 111 entries and the unfilled chip shows the number of entries with a count', () => {
    const values = stateValues('state allYes');
    const m = model(values);
    expect(clauseNos(m)).toHaveLength(56);
    expect(scheduleIds(m)).toHaveLength(55);
    expect(m.totalEntries).toBe(111);
    const withCount = entries(m).filter((entry) => entry.unfilled > 0).length;
    expect(m.counts.unfilled).toBe(withCount);
    expect(m.counts.all).toBe(111);
    expect(m.totalUnfilled).toBe(109);
  });

  it('with no category both Part A and Part B are listed (57)', () => {
    const values = defaultValues(DEF);
    delete values.f.cat;
    const m = model(values);
    expect(clauseNos(m)).toHaveLength(57);
    expect(clauseNos(m).slice(0, 3)).toEqual(['Category', 'Part A', 'Part B']);
  });

  it('category (i) lists Part A and not Part B', () => {
    const values = defaultValues(DEF);
    values.f.cat = '1';
    const m = model(values);
    expect(clauseNos(m)).toContain('Part A');
    expect(clauseNos(m)).not.toContain('Part B');
    expect(clauseNos(m)).toHaveLength(56);
  });

  it('groups come in the order of task 3; an entry counts its clause; a schedule entry has the schedule heading, its own count and opens its clause', () => {
    const values = defaultValues(DEF);
    const m = model(values);
    expect(m.groups.map((group) => group.id)).toEqual(FORM26_LIST_GROUPS.map((group) => group.id));
    expect(m.groups.map((group) => group.title)).toEqual(FORM26_LIST_GROUPS.map((group) => group.title));
    const counts = countUnfilled(DEF, scanUnfilled(DEF, values, NORMAL));
    for (const entry of entries(m).filter((item) => item.kind === 'clause')) {
      expect(entry.unfilled, entry.clauseKey).toBe(counts.clause[entry.clauseKey] ?? 0);
      const unit = FORM26_CLAUSE_UNITS.find((item) => item.key === entry.clauseKey);
      expect(entry.label).toBe(unit?.label);
      expect(entry.id).toBe(entry.clauseKey);
    }
    const s12a = entries(m).find((entry) => entry.scheduleId === 's12a');
    expect(s12a).toMatchObject({ kind: 'schedule', clauseKey: 'f26_c12', no: '12(a)', label: '12. (a) Nature of businesses / professions', unfilled: 1 });
    expect(entries(m).find((entry) => entry.clauseKey === 'f26_c12' && entry.kind === 'clause')?.unfilled).toBe(2);
    const schedulesGroup = m.groups.find((group) => group.id === 'schedules');
    expect(schedulesGroup?.unfilled).toBe(5);
    const reportGroup = m.groups.find((group) => group.id === 'report');
    expect(reportGroup?.entries.map((entry) => entry.no)).toEqual(['Category', 'Part B']);
    expect(reportGroup?.unfilled).toBe(12);
    const s53bii = entries(model(stateValues('state allYes'))).find((entry) => entry.scheduleId === 's53bii');
    expect(s53bii).toMatchObject({ clauseKey: 'f26_c53', no: '53(b)(ii)' });
  });

  it('filter unfilled keeps only entries with a count; counts on the chips do not change with the filter', () => {
    const values = defaultValues(DEF);
    const all = model(values);
    const unfilled = model(values, { filter: 'unfilled' });
    expect(entries(unfilled).every((entry) => entry.unfilled > 0)).toBe(true);
    expect(entries(unfilled)).toHaveLength(all.counts.unfilled);
    expect(unfilled.counts).toEqual(all.counts);
    expect(model(values, { search: 'backup' }).counts).toEqual(all.counts);
    // A group whose entries are all filtered out is not listed.
    expect(unfilled.groups.every((group) => group.entries.length > 0)).toBe(true);
    // Group counts are over all its entries, whatever the filter.
    expect(unfilled.groups.find((group) => group.id === 'schedules')?.unfilled).toBe(5);
  });

  it('evidence, qualified and reviewed: the marks of an entry, the filters and their counts', () => {
    const values = defaultValues(DEF);
    const rows = rowsFor({
      f26_c12: { qualification_required: 1, review_status: 'reviewed' },
      f26_c14: { review_status: 'approved', locked: 1 },
      f26_c28: { review_status: 'prepared' },
    });
    const m = model(values, { rows, evidence: [link('f26_c12'), link('f26_c14')] });
    const c12 = entries(m).find((entry) => entry.id === 'f26_c12');
    expect(c12).toMatchObject({ hasEvidence: true, qualified: true, reviewStatus: 'reviewed' as TaxAuditReviewStatus, locked: false });
    const c14 = entries(m).find((entry) => entry.id === 'f26_c14');
    expect(c14).toMatchObject({ hasEvidence: true, qualified: false, reviewStatus: 'approved', locked: true });
    // A schedule entry shows the marks of the clause it opens under.
    const s12a = entries(m).find((entry) => entry.id === 's12a');
    expect(s12a).toMatchObject({ hasEvidence: true, qualified: true, reviewStatus: 'reviewed' });
    // The marks belong to the clause: a chip counts a clause once, not again for its schedule entry ("Evidence 2"
    // for one link was seen in the running app, POLISH-1), and its filter lists the clauses.
    expect(m.counts).toMatchObject({ evidence: 2, qualified: 1, reviewed: 2 });
    expect(entries(model(values, { rows, evidence: [link('f26_c12'), link('f26_c14')], filter: 'evidence' })).map((entry) => entry.id)).toEqual(['f26_c12', 'f26_c14']);
    expect(entries(model(values, { rows, filter: 'qualified' })).map((entry) => entry.id)).toEqual(['f26_c12']);
    expect(entries(model(values, { rows, filter: 'reviewed' })).map((entry) => entry.id)).toEqual(['f26_c12', 'f26_c14']);
    // One link on a clause with a schedule entry on screen: "Evidence 1".
    const one = model(values, { rows, evidence: [link('f26_c12')] });
    expect(entries(one).filter((entry) => entry.clauseKey === 'f26_c12').map((entry) => entry.id)).toEqual(['f26_c12', 's12a']);
    expect(one.counts.evidence).toBe(1);
    // Each chip's count is what its filter lists.
    for (const chip of FORM26_LIST_FILTERS) expect(entries(model(values, { rows, evidence: [link('f26_c12'), link('f26_c14')], filter: chip.id })), chip.id).toHaveLength(m.counts[chip.id]);
    // No row yet (the audit is still loading): a plain draft entry.
    const bare = model(values, { rows: new Map() });
    expect(entries(bare).find((entry) => entry.id === 'f26_c12')).toMatchObject({ reviewStatus: 'draft', hasEvidence: false, qualified: false, locked: false });
  });

  it('search "backup" finds clause 14; search "aadhaar" finds clauses 30, 31 and 45 by their column headings when their schedules are shown; search "zzz" gives no entry', () => {
    const atOpen = defaultValues(DEF);
    expect(clauseNos(model(atOpen, { search: 'backup' }))).toEqual(['14']);
    expect(clauseNos(model(atOpen, { search: '  BackUp ' }))).toEqual(['14']);

    const allYes = stateValues('state allYes');
    const found = model(allYes, { search: 'aadhaar' });
    expect(clauseNos(found)).toEqual(['30', '31', '45']);
    expect(scheduleIds(found)).toEqual(['s30', 's31', 's45a', 's45b', 's45c', 's45d']);
    // The same columns while their schedules are closed: nothing on screen holds the word.
    expect(entries(model(atOpen, { search: 'aadhaar' }))).toEqual([]);
    // "Show all schedules" opens them, so the search finds them again.
    expect(clauseNos(model(atOpen, { search: 'aadhaar', showAll: true }))).toEqual(['30', '31', '45']);

    // Number, label, wording and schedule heading.
    expect(clauseNos(model(atOpen, { search: '53' }))).toContain('53');
    expect(clauseNos(model(atOpen, { search: 'unquoted' }))).toEqual(['47']);
    expect(scheduleIds(model(atOpen, { search: 'nature of businesses' }))).toEqual(['s12a']);

    const none = model(atOpen, { search: 'zzz' });
    expect(entries(none)).toEqual([]);
    expect(none.groups).toEqual([]);
    expect(none.empty).toEqual({ message: 'No clause matches "zzz".', action: { label: 'Clear search', clears: 'search' } });
    expect(model(atOpen, { search: 'zzz', filter: 'qualified' }).empty?.action.clears).toBe('search');
    expect(model(atOpen).empty).toBeNull();
  });

  it('a filter that leaves nothing gives its own plain sentence and "Show all"', () => {
    const values = defaultValues(DEF);
    expect(model(values, { filter: 'evidence' }).empty).toEqual({ message: 'No clause has evidence linked.', action: { label: 'Show all', clears: 'filter' } });
    expect(model(values, { filter: 'qualified' }).empty?.message).toBe('No clause is marked for qualification.');
    expect(model(values, { filter: 'reviewed' }).empty?.message).toBe('No clause has been reviewed yet.');
    const filled = stateValues('everything filled, every gateway Yes');
    expect(model(filled, { filter: 'unfilled' }).empty?.message).toBe('Nothing left to fill.');
  });

  it('the five chips in order with plain labels', () => {
    expect(FORM26_LIST_FILTERS).toEqual([
      { id: 'all', label: 'All' },
      { id: 'unfilled', label: 'Unfilled' },
      { id: 'evidence', label: 'Evidence' },
      { id: 'qualified', label: 'Qualified' },
      { id: 'reviewed', label: 'Reviewed' },
    ]);
  });

  it('entryForUnfilledItem({t:S50a,r:0,c:0}) gives clause f26_c50, schedule s50a, focus table S50a row 0 column 0; an answer gives its clause and the field', () => {
    expect(entryForUnfilledItem(DEF, { t: 'S50a', r: 0, c: '0' })).toEqual({
      clauseKey: 'f26_c50',
      scheduleId: 's50a',
      focus: { table: 'S50a', row: 0, column: '0' },
    });
    expect(entryForUnfilledItem(DEF, { k: 'c14e' })).toEqual({ clauseKey: 'f26_c14', focus: { field: 'c14e' } });
    expect(entryForUnfilledItem(DEF, { t: 'P14a', r: 2, c: '1' })).toEqual({ clauseKey: 'f26_c14', focus: { table: 'P14a', row: 2, column: '1' } });
    expect(entryForUnfilledItem(DEF, { k: 'cat' })).toEqual({ clauseKey: 'f26_category', focus: { field: 'cat' } });
    expect(entryForUnfilledItem(DEF, { t: 'Dpm', r: 0, c: '0' })).toEqual({ clauseKey: 'f26_c36', scheduleId: 's36', focus: { table: 'Dpm', row: 0, column: '0' } });
    expect(() => entryForUnfilledItem(DEF, { k: 'nope' })).toThrow();
  });
});

describe('the "View" control of the list (POLISH-2): three switches in one compact control', () => {
  it('the three switches keep their labels and ids, in the order they had in the list', () => {
    expect(FORM26_VIEW_SWITCHES.map((entry) => [entry.id, entry.domId, entry.label])).toEqual([
      ['highlight-unfilled', 'f26-highlight-unfilled', 'Highlight unfilled'],
      ['show-all-schedules', 'f26-show-all-schedules', 'Show all schedules'],
      ['show-comparison', 'f26-show-comparison', 'Show Form 3CD notes'],
    ]);
  });

  it('the usual view (highlight on, schedules off, Form 3CD notes as the year has them) changes nothing: no mark on the button', () => {
    const usual = form26ViewSummary({ highlightUnfilled: true, showAllSchedules: false, showComparison: true, comparisonUsual: true });
    expect(usual.changed).toBe(0);
    expect(usual.mark).toBe('');
    expect(usual.description).toBe('Highlight unfilled: on. Show all schedules: off. Show Form 3CD notes: on.');
    expect(usual.switches.map((entry) => [entry.label, entry.on, entry.usual])).toEqual([
      ['Highlight unfilled', true, true],
      ['Show all schedules', false, false],
      ['Show Form 3CD notes', true, true],
    ]);
    // 2027-28: the notes are off by default, so off is the usual view there.
    expect(form26ViewSummary({ highlightUnfilled: true, showAllSchedules: false, showComparison: false, comparisonUsual: false }).changed).toBe(0);
  });

  it('every switch away from its usual state is counted, and the button says how many in words', () => {
    const one = form26ViewSummary({ highlightUnfilled: true, showAllSchedules: true, showComparison: true, comparisonUsual: true });
    expect(one.changed).toBe(1);
    expect(one.mark).toBe('1 setting changed');
    expect(one.description).toBe('Highlight unfilled: on. Show all schedules: on. Show Form 3CD notes: on.');
    const three = form26ViewSummary({ highlightUnfilled: false, showAllSchedules: true, showComparison: false, comparisonUsual: true });
    expect(three.changed).toBe(3);
    expect(three.mark).toBe('3 settings changed');
    expect(three.switches.filter((entry) => entry.changed).map((entry) => entry.id)).toEqual(['highlight-unfilled', 'show-all-schedules', 'show-comparison']);
    // Notes switched on in a year where they are off by default: changed.
    expect(form26ViewSummary({ highlightUnfilled: true, showAllSchedules: false, showComparison: true, comparisonUsual: false }).changed).toBe(1);
  });

  it('without the Form 3CD notes switch (not offered), only the two switches of the file', () => {
    const two = form26ViewSummary({ highlightUnfilled: false, showAllSchedules: false });
    expect(two.switches.map((entry) => entry.id)).toEqual(['highlight-unfilled', 'show-all-schedules']);
    expect(two.changed).toBe(1);
    expect(two.description).toBe('Highlight unfilled: off. Show all schedules: off.');
  });
});

describe('bringing the selected entry into the list\'s view (POLISH-2)', () => {
  it('an entry already seen whole: the list does not move', () => {
    expect(listScrollFor({ scrollTop: 100, viewHeight: 340, entryTop: 120, entryHeight: 40 })).toBeNull();
    expect(listScrollFor({ scrollTop: 100, viewHeight: 340, entryTop: 400, entryHeight: 40 })).toBeNull();
  });
  it('an entry out of view or cut at an edge: brought to the middle, with its neighbours on both sides', () => {
    expect(listScrollFor({ scrollTop: 0, viewHeight: 340, entryTop: 600, entryHeight: 120 })).toBe(490);
    expect(listScrollFor({ scrollTop: 0, viewHeight: 340, entryTop: 320, entryHeight: 40 })).toBe(170);
    expect(listScrollFor({ scrollTop: 500, viewHeight: 340, entryTop: 480, entryHeight: 40 })).toBe(330);
  });
  it('never above the top of the list; an entry taller than the view starts at its top', () => {
    expect(listScrollFor({ scrollTop: 300, viewHeight: 340, entryTop: 20, entryHeight: 40 })).toBe(0);
    expect(listScrollFor({ scrollTop: 0, viewHeight: 100, entryTop: 300, entryHeight: 140 })).toBe(300);
  });
});
