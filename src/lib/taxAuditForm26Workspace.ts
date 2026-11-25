// The decisions of the Form No. 26 workspace screen, as pure functions: its keys, moving through the
// clauses, the header, the sentences of its states, its tabs, what happens when the window is closed, and
// when "Add to the report's observations" is offered. The components only draw what these give.
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import type { Form26Category, Form26Definition } from '@/data/taxAuditForm26Types';
import { form26ClauseKeyOfTable } from '@/data/taxAuditForm26Clauses';
import { form26ClockTime, form26FieldDomId, form26SaveStatus } from '@/lib/taxAuditForm26EditorModel';
import { entryForUnfilledItem, type Form26ListModel } from '@/lib/taxAuditForm26ListModel';
import { hasObservationFor, isRowLocked, isTableLocked, qualificationRow } from '@/lib/taxAuditForm26Review';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { Form26SaveState } from '@/lib/taxAuditForm26SaveQueue';
import { nextUnfilled, previousUnfilled, type Form26UnfilledItem } from '@/lib/taxAuditForm26Unfilled';
import type { Form26Row } from '@/lib/taxAuditForm26Values';
import { form26WhySentence } from '@/lib/taxAuditForm26Year';

// ---------------------------------------------------------------------------------------------------
// Keys

export type Form26KeyCommand = 'next-unfilled' | 'previous-unfilled' | 'next-clause' | 'previous-clause' | 'focus-search';
export type Form26KeyLike = { key: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

/**
 * The workspace's own keys. None needs Ctrl, so none meets the application's shortcuts (which all do).
 * Y / N, Enter and Esc are handled inside the controls and tables; Tab is the browser's.
 */
export function form26KeyCommand(event: Form26KeyLike, typing: boolean): Form26KeyCommand | null {
  if (event.ctrlKey || event.metaKey) return null;
  if (event.key === 'F8' && !event.altKey) return event.shiftKey ? 'previous-unfilled' : 'next-unfilled';
  if (event.altKey && !event.shiftKey && event.key === 'PageDown') return 'next-clause';
  if (event.altKey && !event.shiftKey && event.key === 'PageUp') return 'previous-clause';
  if (event.key === '/' && !event.altKey && !typing) return 'focus-search';
  return null;
}

const NOT_TYPING_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** True when the keyboard is in a place that takes text (a "/" typed there is text, not a command). */
export function isTypingElement(element: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = (element.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TYPING_INPUTS.has((element.type ?? 'text').toLowerCase());
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Moving through the clauses

/** The clause entries the list shows, in order (schedule entries open a clause but are not clauses). */
export function listedClauseKeys(model: Form26ListModel): string[] {
  return model.groups.flatMap((group) => group.entries.filter((entry) => entry.kind === 'clause').map((entry) => entry.clauseKey));
}

const FORM_ORDER = new Map(FORM26_CLAUSE_UNITS.map((unit, index) => [unit.key, index]));

/** The next (1) or previous (-1) listed clause; from a clause the list does not show, the nearest in the form's order. */
export function adjacentClause(listed: string[], current: string, direction: 1 | -1): string | null {
  const at = listed.indexOf(current);
  if (at >= 0) return listed[at + direction] ?? null;
  const place = FORM_ORDER.get(current) ?? -1;
  if (direction === 1) return listed.find((key) => (FORM_ORDER.get(key) ?? -1) > place) ?? null;
  for (let index = listed.length - 1; index >= 0; index -= 1) if ((FORM_ORDER.get(listed[index]) ?? -1) < place) return listed[index];
  return null;
}

/** Arrow keys, Home and End in the clause list (one Tab stop; the keys move among the entries). */
export function rovingTarget(ids: string[], current: string, key: string): string | null {
  if (ids.length === 0) return null;
  const at = ids.indexOf(current);
  switch (key) {
    case 'ArrowDown':
      return at < 0 ? ids[0] : ids[Math.min(at + 1, ids.length - 1)];
    case 'ArrowUp':
      return at < 0 ? ids[0] : ids[Math.max(at - 1, 0)];
    case 'Home':
      return ids[0];
    case 'End':
      return ids[ids.length - 1];
    default:
      return null;
  }
}

/** "Next unfilled" (1) / "Previous unfilled" (-1): the item and the clause, schedule and control to open. */
export function form26UnfilledStep(
  def: Form26Definition,
  items: Form26UnfilledItem[],
  last: Form26UnfilledItem | null,
  direction: 1 | -1,
): { item: Form26UnfilledItem; target: ReturnType<typeof entryForUnfilledItem> } | null {
  const item = direction === 1 ? nextUnfilled(items, last, def) : previousUnfilled(items, last, def);
  if (!item) return null;
  return { item, target: entryForUnfilledItem(def, item) };
}

// ---------------------------------------------------------------------------------------------------
// The header

export function form26CategoryBadge(category: '' | Form26Category): string {
  if (category === '1') return 'Category (i)';
  if (category === '2') return 'Category (ii)';
  return 'Category not chosen';
}

export type Form26HeaderModel = {
  title: string;
  subtitle: string;
  badges: string[];
  why: string;
  save: ReturnType<typeof form26SaveStatus>;
  /** The main button: its words, its key, and the count said in words for a screen reader. */
  next: { label: string; keys: 'F8'; count: string };
  message: string | null;
};

export function form26HeaderModel(input: {
  clientName: string;
  financialYear: string;
  category: '' | Form26Category;
  saveState: Form26SaveState;
  clock: (ms: number) => string;
  unfilled: number;
  message?: string | null;
  /** The clause of a clash was approved meanwhile (`form26SaveStateLocked`). */
  saveLocked?: boolean;
}): Form26HeaderModel {
  const year = String(input.financialYear ?? '').trim();
  return {
    title: 'Tax Audit',
    subtitle: `${input.clientName} - ${year}`,
    badges: ['Form No. 26', 'Income-tax Act, 2025', 'Rule 47', form26CategoryBadge(input.category)],
    why: form26WhySentence(year),
    save: form26SaveStatus(input.saveState, input.clock, { locked: input.saveLocked }),
    next: {
      label: `Next unfilled · ${input.unfilled}`,
      keys: 'F8',
      count: input.unfilled === 0 ? 'Nothing left to fill' : `${input.unfilled} unfilled item${input.unfilled === 1 ? '' : 's'} left`,
    },
    message: input.message ?? null,
  };
}

/**
 * Whether the clash the save state names is on an approved (or locked) clause: an approval that landed while the
 * user typed. For a table's own row it is the clause the table stands under.
 */
export function form26SaveStateLocked(def: Form26Definition, state: Form26SaveState, rowsByKey: Map<string, Form26ClauseRow>): boolean {
  if (state.kind !== 'changed-elsewhere') return false;
  const tableId = state.clauseKey.startsWith('f26_t_') ? state.clauseKey.slice('f26_t_'.length) : null;
  if (tableId !== null) return def.tables.some((table) => table.id === tableId) && isTableLocked(def, tableId, rowsByKey);
  const row = rowsByKey.get(state.clauseKey);
  return row ? isRowLocked(row) : false;
}

// ---------------------------------------------------------------------------------------------------
// States, tabs, leaving

export const FORM26_STATE_TEXT = {
  noAccess: 'You are not assigned to this engagement, so its tax audit cannot be opened.',
  noEngagement: 'Please select an engagement before opening Tax Audit.',
  errorTitle: 'Form No. 26 could not be opened',
  errorRetry: 'Try again',
  conversionTitle: 'This engagement has a Form 3CD draft',
  conversionText: 'Form No. 26 opens once the earlier Form 3CD draft has been brought across. The earlier draft is kept unchanged.',
  yearTitle: 'The tax audit form cannot be chosen',
  yearLink: 'Open Engagements',
} as const;

export function form26YearUnknownText(financialYear: string): string {
  return `The financial year of this engagement ("${String(financialYear ?? '').trim()}") is not in the form 2026-27, so the tax audit form cannot be chosen. Correct it in Engagements.`;
}

export type Form26TabId = 'clauses' | 'what-changed' | 'summary';

/** The tabs of the workspace: "What changed" and "Review Summary" only once their content exists (nothing stubbed). */
export function form26Tabs(slots: { whatChanged: boolean; reviewSummary: boolean }): { id: Form26TabId; label: string }[] {
  const tabs: { id: Form26TabId; label: string }[] = [{ id: 'clauses', label: 'Clauses' }];
  if (slots.whatChanged) tabs.push({ id: 'what-changed', label: 'What changed' });
  if (slots.reviewSummary) tabs.push({ id: 'summary', label: 'Review Summary' });
  return tabs;
}

/**
 * When the window is closed (F6), after the focused answer has been committed: nothing waiting → close;
 * something waiting that a save can finish → hold the close and save (see `form26HeldCloseOutcome`); while
 * that save is still out → keep holding, no second save; a failed save or a clash waiting for the user's
 * choice → one plain warning, after which the user may leave.
 */
export function form26CloseDecision(input: { allowed: boolean; pending: boolean; unresolved: boolean; warned: boolean; holding?: boolean }): 'allow' | 'hold' | 'wait' | 'warn' {
  if (input.allowed) return 'allow';
  if (input.unresolved) return input.warned ? 'allow' : 'warn';
  if (input.holding) return 'wait';
  return input.pending ? 'hold' : 'allow';
}

/** Said (toast and live region) once a held close has been saved; the user then closes again. */
export const FORM26_CLOSE_SAVED = 'All changes are saved. You can close the window now.';

/**
 * What follows the save of a held close. The workspace never closes the window itself: a reload from the
 * application's menu cannot be told from a close, so closing it would turn a reload into a close.
 */
export function form26HeldCloseOutcome(saved: boolean): { kind: 'saved'; message: string } | { kind: 'warn' } {
  return saved ? { kind: 'saved', message: FORM26_CLOSE_SAVED } : { kind: 'warn' };
}

export const FORM26_CLOSE_WARNING = {
  title: 'Close without saving?',
  text: 'Some changes are not saved: a save failed, or someone else changed the same answer. If you close now, they are lost.',
  stay: 'Stay',
  close: 'Close without saving',
} as const;

/** What the question before a change of engagement says (null: nothing would be lost, no question). */
export function form26LeaveGuardText(unresolved: boolean): string | null {
  return unresolved ? 'Some Form No. 26 changes could not be saved and will be lost.' : null;
}

/** The room the clause editor gives its rows: its scrolling body's width less its side padding (2 × 12 px). */
export function form26EditorWidth(clientWidth: number): number {
  return Math.max(0, clientWidth - 24);
}

const FIELD_KEY_BY_DOM_ID = new Map(FORM26_DEFINITION.fields.map((field) => [form26FieldDomId(field.key), field.key]));

/** The answer a focused element belongs to: its own id, or the id of the group it sits in (a radio option). */
export function form26FieldKeyOfElement(element: { id?: string; parentElement?: unknown } | null | undefined): string | null {
  let node = element;
  for (let depth = 0; node && depth < 4; depth += 1) {
    const key = node.id ? FIELD_KEY_BY_DOM_ID.get(node.id) : undefined;
    if (key) return key;
    node = node.parentElement as { id?: string; parentElement?: unknown } | null | undefined;
  }
  return null;
}

/**
 * The line for a table that met someone else's change (or whose clause was approved while the user typed),
 * and the choices it allows. A table is saved whole, so the choice is for the whole table.
 */
export function form26TableConflictLine(
  def: Form26Definition,
  tableId: string,
  conflict: { theirs: string; at: string },
  locked: boolean,
): { text: string; actions: ('mine' | 'theirs')[] } {
  const unit = FORM26_CLAUSE_UNITS.find((entry) => entry.key === form26ClauseKeyOfTable(tableId));
  const clause = unit ? (/^\d+$/.test(unit.no) ? `Clause ${unit.no}` : unit.no) : 'This clause';
  if (locked) return { text: `${clause} was approved while you were typing. Your entry in its table was not saved.`, actions: ['theirs'] };
  const table = def.tables.find((entry) => entry.id === tableId);
  const schedule = table?.schedule ? def.schedules.find((entry) => entry.id === table.schedule) : undefined;
  const which = schedule ? `The table under "${schedule.title}"` : `The table of ${clause.charAt(0).toLowerCase()}${clause.slice(1)}`;
  const time = form26ClockTime(conflict.at);
  return { text: `${which} was changed by someone else${time ? ` at ${time}` : ''}.`, actions: ['mine', 'theirs'] };
}

// ---------------------------------------------------------------------------------------------------
// The qualification box

/** Whether "Add to the report's observations" can be used for a clause now, and why not. */
export function form26ObservationAction(input: {
  clauseNo: string;
  category: '' | Form26Category;
  plainText: string;
  rows: Form26Row[] | undefined;
  locked: boolean;
  partLocked: boolean;
}): { enabled: boolean; reason: string | null; table: 'A5' | 'B5' | null; part: 'Part A' | 'Part B' | null } {
  const target = qualificationRow(input.clauseNo, input.plainText, input.category);
  const no = { enabled: false, table: null, part: null } as const;
  if (input.category === '') return { ...no, reason: 'Choose the category of assessee first.' };
  if (!target) return { ...no, reason: 'Only clauses 9 to 53 go into the report\'s observations.' };
  const part = target.table === 'A5' ? 'Part A' : 'Part B';
  const found = { table: target.table, part } as const;
  if (input.locked) return { enabled: false, reason: 'This clause is approved. Choose Edit to change it.', ...found };
  if (input.partLocked) return { enabled: false, reason: `${part} is approved, so its observations cannot be changed.`, ...found };
  if (input.plainText.trim() === '') return { enabled: false, reason: 'Write the qualification first.', ...found };
  if (hasObservationFor(input.rows, input.clauseNo)) return { enabled: false, reason: `Clause ${input.clauseNo} is already in the report's observations (${part}).`, ...found };
  return { enabled: true, reason: null, ...found };
}
