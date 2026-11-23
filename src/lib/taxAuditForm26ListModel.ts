// The clause list of the Form No. 26 workspace as data: groups in the form's order, one entry per clause
// unit (the Part of the other category left out) and one per schedule on screen, each with its unfilled
// count and its review marks; the five filter chips with counts over every entry; the search.
import {
  FORM26_CLAUSE_UNITS,
  FORM26_LIST_GROUPS,
  form26ClauseKeyOfField,
  form26ClauseKeyOfSchedule,
  form26ClauseKeyOfTable,
  type Form26ClauseUnit,
  type Form26ListGroupId,
} from '@/data/taxAuditForm26Clauses';
import type { Form26Definition, Form26Table } from '@/data/taxAuditForm26Types';
import { columnFullHeading } from '@/lib/taxAuditForm26Layout';
import { categoryOf, isScheduleShown, isTableShown, shownSchedules, type Form26ViewOptions } from '@/lib/taxAuditForm26Reveal';
import { isRowLocked } from '@/lib/taxAuditForm26Review';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { countUnfilled, scanUnfilled, type Form26UnfilledItem } from '@/lib/taxAuditForm26Unfilled';
import type { Form26Values } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseEvidence, TaxAuditReviewStatus } from '@/types/taxAudit';

export type Form26ListFilter = 'all' | 'unfilled' | 'evidence' | 'qualified' | 'reviewed';
export type Form26ListEntry = {
  id: string;                 // the clause key, or the schedule id for a schedule entry
  kind: 'clause' | 'schedule';
  clauseKey: string;          // the clause the entry opens
  scheduleId?: string;
  no: string;                 // clause: 'Category' | 'Part A' | '1'…'53' | 'Signature'; schedule: '12(a)', '53(b)(ii)'
  label: string;              // clause: its short list label; schedule: its own heading
  unfilled: number;
  reviewStatus: TaxAuditReviewStatus;
  hasEvidence: boolean;
  qualified: boolean;
  locked: boolean;
};
export type Form26ListGroup = { id: Form26ListGroupId; title: string; entries: Form26ListEntry[]; unfilled: number };
export type Form26ListEmpty = { message: string; action: { label: string; clears: 'search' | 'filter' } };
export type Form26ListModel = {
  groups: Form26ListGroup[];                       // only groups with an entry left by the filter and the search
  counts: Record<Form26ListFilter, number>;        // over every entry, whatever the filter and the search
  totalUnfilled: number;                           // the unfilled items of the form (task 6)
  totalEntries: number;
  empty: Form26ListEmpty | null;                   // the designed state when nothing is left to list
};

export const FORM26_LIST_FILTERS: { id: Form26ListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unfilled', label: 'Unfilled' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'reviewed', label: 'Reviewed' },
];

// ---------------------------------------------------------------------------------------------------
// The list's "View" control (POLISH-2): the three switches that change what the list and the editor show,
// behind one compact button in the list's title row. The button carries a mark only when the view is not
// the usual one, so a changed view is seen at a glance.

export type Form26ViewSwitchId = 'highlight-unfilled' | 'show-all-schedules' | 'show-comparison';
export const FORM26_VIEW_SWITCHES: { id: Form26ViewSwitchId; domId: string; label: string }[] = [
  { id: 'highlight-unfilled', domId: 'f26-highlight-unfilled', label: 'Highlight unfilled' },
  { id: 'show-all-schedules', domId: 'f26-show-all-schedules', label: 'Show all schedules' },
  { id: 'show-comparison', domId: 'f26-show-comparison', label: 'Show Form 3CD notes' },
];
export type Form26ViewSwitchState = { id: Form26ViewSwitchId; domId: string; label: string; on: boolean; usual: boolean; changed: boolean };
export type Form26ViewSummary = {
  switches: Form26ViewSwitchState[];
  /** How many switches are away from their usual state. */
  changed: number;
  /** The button's mark in words ('' for the usual view): "1 setting changed". */
  mark: string;
  /** Every switch's state in words, for the button's description: "Highlight unfilled: on. …". */
  description: string;
};

/**
 * The state of the "View" control. Usual: unfilled answers highlighted, schedules opened by their answers
 * only (the file's own default), Form 3CD notes as the year has them (`comparisonUsual`: on for 2026-27).
 * `showComparison` undefined: that switch is not offered.
 */
export function form26ViewSummary(input: { highlightUnfilled: boolean; showAllSchedules: boolean; showComparison?: boolean; comparisonUsual?: boolean }): Form26ViewSummary {
  const state: Record<Form26ViewSwitchId, { on: boolean; usual: boolean } | null> = {
    'highlight-unfilled': { on: input.highlightUnfilled, usual: true },
    'show-all-schedules': { on: input.showAllSchedules, usual: false },
    'show-comparison': input.showComparison === undefined ? null : { on: input.showComparison, usual: Boolean(input.comparisonUsual) },
  };
  const switches: Form26ViewSwitchState[] = [];
  for (const entry of FORM26_VIEW_SWITCHES) {
    const value = state[entry.id];
    if (value) switches.push({ ...entry, on: value.on, usual: value.usual, changed: value.on !== value.usual });
  }
  const changed = switches.filter((entry) => entry.changed).length;
  return {
    switches,
    changed,
    mark: changed === 0 ? '' : `${changed} setting${changed === 1 ? '' : 's'} changed`,
    description: switches.map((entry) => `${entry.label}: ${entry.on ? 'on' : 'off'}.`).join(' '),
  };
}

/**
 * Where the list should scroll to show the selected entry (all in pixels from the top of the list's content):
 * `null` when it is already seen whole (a click on a seen entry never moves the list); otherwise the entry is
 * brought to the middle, so its neighbours on both sides are seen too; one taller than the view starts at its top.
 */
export function listScrollFor(input: { scrollTop: number; viewHeight: number; entryTop: number; entryHeight: number }): number | null {
  const { scrollTop, viewHeight, entryTop, entryHeight } = input;
  if (entryTop >= scrollTop && entryTop + entryHeight <= scrollTop + viewHeight) return null;
  if (entryHeight >= viewHeight) return entryTop;
  return Math.max(0, Math.round(entryTop - (viewHeight - entryHeight) / 2));
}

const FILTER_EMPTY: Record<Exclude<Form26ListFilter, 'all'>, string> = {
  unfilled: 'Nothing left to fill.',
  evidence: 'No clause has evidence linked.',
  qualified: 'No clause is marked for qualification.',
  reviewed: 'No clause has been reviewed yet.',
};

const REVIEWED: ReadonlySet<TaxAuditReviewStatus> = new Set(['reviewed', 'approved', 'locked']);

type SearchIndex = {
  /** Per clause unit: its number, label, the wording of its question rows and the labels of its answers. */
  unitText: Map<string, string>;
  /** Per table: its column headings (or a depreciation table's blocks and row labels). */
  tableText: Map<string, string>;
};

const INDEX = new WeakMap<Form26Definition, SearchIndex>();

function tableText(table: Form26Table): string {
  if (table.dep) return [...table.dep.columnGroups.map((group) => group.text), ...table.dep.rows.map((row) => row.label)].join('\n');
  return table.columns.map((column) => columnFullHeading(column)).join('\n');
}

function searchIndex(def: Form26Definition): SearchIndex {
  let index = INDEX.get(def);
  if (!index) {
    const fieldLabel = new Map(def.fields.map((field) => [field.key, field.label]));
    const unitText = new Map<string, string>();
    for (const unit of FORM26_CLAUSE_UNITS) {
      const parts = [unit.no, unit.label];
      for (const rowIndex of unit.questionRows) parts.push(def.questionRows[rowIndex]?.wording ?? '');
      for (const key of unit.fields) parts.push((fieldLabel.get(key) ?? '').replace(/\[[^\]]*\]/g, ' '));
      unitText.set(unit.key, parts.join('\n').toLowerCase());
    }
    index = { unitText, tableText: new Map(def.tables.map((table) => [table.id, tableText(table).toLowerCase()])) };
    INDEX.set(def, index);
  }
  return index;
}

/** The number shown for a schedule entry: the file's side label without "Form ", e.g. '12(a)'. */
function scheduleNo(navLabel: string): string {
  return navLabel.replace(/^Form\s+/, '');
}

// Evidence, qualification and review are marks of the clause: a schedule entry shows its clause's marks, but
// these filters list (and their chips count) the clause once, not again for each of its schedules.
function matchesFilter(entry: Form26ListEntry, filter: Form26ListFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unfilled':
      return entry.unfilled > 0;
    case 'evidence':
      return entry.kind === 'clause' && entry.hasEvidence;
    case 'qualified':
      return entry.kind === 'clause' && entry.qualified;
    case 'reviewed':
      return entry.kind === 'clause' && REVIEWED.has(entry.reviewStatus);
  }
}

export function buildListModel(input: {
  def: Form26Definition;
  values: Form26Values;
  view: Form26ViewOptions;
  rowsByKey: Map<string, Form26ClauseRow>;
  evidence: TaxAuditClauseEvidence[];
  unconfirmed: ReadonlySet<string>;
  filter: Form26ListFilter;
  search: string;
}): Form26ListModel {
  const { def, values, view, rowsByKey, evidence, unconfirmed, filter } = input;
  const items = scanUnfilled(def, values, { ...view, unconfirmed });
  const counts = countUnfilled(def, items);
  const category = categoryOf(values);
  const linkedKeys = new Set(evidence.map((link) => link.clause_key));
  const linkedRows = new Set(evidence.map((link) => link.clause_response_id));
  const index = searchIndex(def);
  const term = input.search.trim().toLowerCase();

  const marksOf = (clauseKey: string) => {
    const row = rowsByKey.get(clauseKey);
    return {
      reviewStatus: row?.review_status ?? 'draft',
      hasEvidence: linkedKeys.has(clauseKey) || (row !== undefined && linkedRows.has(row.id)),
      qualified: Boolean(row && Number(row.qualification_required)),
      locked: row ? isRowLocked(row) : false,
    };
  };

  const listed = (unit: Form26ClauseUnit) => unit.category === null || category === null || unit.category === category;

  const byGroup = new Map<Form26ListGroupId, { entry: Form26ListEntry; text: () => string }[]>();
  const push = (group: Form26ListGroupId, entry: Form26ListEntry, text: () => string) => {
    const list = byGroup.get(group) ?? [];
    list.push({ entry, text });
    byGroup.set(group, list);
  };

  for (const unit of FORM26_CLAUSE_UNITS) {
    if (!listed(unit)) continue;
    const entry: Form26ListEntry = {
      id: unit.key,
      kind: 'clause',
      clauseKey: unit.key,
      no: unit.no,
      label: unit.label,
      unfilled: counts.clause[unit.key] ?? 0,
      ...marksOf(unit.key),
    };
    push(unit.group, entry, () => {
      // Schedule headings and column headings count only while they are on screen.
      const parts = [index.unitText.get(unit.key) ?? ''];
      for (const scheduleId of unit.schedules) {
        if (isScheduleShown(def, scheduleId, values, view)) parts.push((def.schedules.find((schedule) => schedule.id === scheduleId)?.title ?? '').toLowerCase());
      }
      for (const tableId of unit.tables) if (isTableShown(def, tableId, values, view)) parts.push(index.tableText.get(tableId) ?? '');
      return parts.join('\n');
    });
  }

  const scheduleById = new Map(def.schedules.map((schedule) => [schedule.id, schedule]));
  for (const scheduleId of shownSchedules(def, values, view)) {
    const schedule = scheduleById.get(scheduleId);
    if (!schedule) continue;
    const clauseKey = form26ClauseKeyOfSchedule(scheduleId);
    const no = scheduleNo(schedule.navLabel);
    const entry: Form26ListEntry = {
      id: scheduleId,
      kind: 'schedule',
      clauseKey,
      scheduleId,
      no,
      label: schedule.title,
      unfilled: counts.schedule[scheduleId] ?? 0,
      ...marksOf(clauseKey),
    };
    push('schedules', entry, () => [no.toLowerCase(), schedule.title.toLowerCase(), ...schedule.tables.map((id) => index.tableText.get(id) ?? '')].join('\n'));
  }

  const all = [...byGroup.values()].flat().map((item) => item.entry);
  const countsByFilter = Object.fromEntries(
    FORM26_LIST_FILTERS.map((chip) => [chip.id, all.filter((entry) => matchesFilter(entry, chip.id)).length]),
  ) as Record<Form26ListFilter, number>;

  const groups: Form26ListGroup[] = [];
  for (const group of FORM26_LIST_GROUPS) {
    const members = byGroup.get(group.id) ?? [];
    const kept = members.filter((item) => matchesFilter(item.entry, filter) && (term === '' || item.text().includes(term)));
    if (kept.length === 0) continue;
    groups.push({
      id: group.id,
      title: group.title,
      entries: kept.map((item) => item.entry),
      unfilled: members.reduce((sum, item) => sum + item.entry.unfilled, 0),
    });
  }

  let empty: Form26ListEmpty | null = null;
  if (groups.length === 0) {
    if (term !== '') empty = { message: `No clause matches "${input.search.trim()}".`, action: { label: 'Clear search', clears: 'search' } };
    else if (filter !== 'all') empty = { message: FILTER_EMPTY[filter], action: { label: 'Show all', clears: 'filter' } };
  }

  return { groups, counts: countsByFilter, totalUnfilled: counts.total, totalEntries: all.length, empty };
}

/** The clause (and schedule) to open for an unfilled item, and what to focus in it. Throws for an id the form does not have. */
export function entryForUnfilledItem(
  def: Form26Definition,
  item: Form26UnfilledItem,
): { clauseKey: string; scheduleId?: string; focus: { field?: string; table?: string; row?: number; column?: string } } {
  if ('k' in item) return { clauseKey: form26ClauseKeyOfField(item.k), focus: { field: item.k } };
  const clauseKey = form26ClauseKeyOfTable(item.t);
  const table = def.tables.find((entry) => entry.id === item.t);
  const focus = { table: item.t, row: item.r, column: item.c };
  return table?.schedule ? { clauseKey, scheduleId: table.schedule, focus } : { clauseKey, focus };
}
