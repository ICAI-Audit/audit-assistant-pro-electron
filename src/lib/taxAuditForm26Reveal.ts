// What of Form No. 26 is on screen for a set of answers: the office's fillable file's own rules.
// - An item tied to an answer is shown only while that answer is exactly "Yes".
// - "Show all schedules" opens every schedule whatever the answers; it opens no item inside the form itself.
// - An item of Part A or Part B is hidden when a category is chosen and it is the other one.
import type {
  Form26Category,
  Form26Definition,
  Form26Field,
  Form26PartId,
  Form26Schedule,
  Form26Table,
} from '@/data/taxAuditForm26Types';
import { getField, type Form26Values } from '@/lib/taxAuditForm26Values';

export type Form26ViewOptions = { showAllSchedules: boolean };

type Form26Index = {
  fields: Map<string, Form26Field>;
  tables: Map<string, Form26Table>;
  schedules: Map<string, Form26Schedule>;
};

const INDEX = new WeakMap<Form26Definition, Form26Index>();

function indexOf(def: Form26Definition): Form26Index {
  let index = INDEX.get(def);
  if (!index) {
    index = {
      fields: new Map(def.fields.map((field) => [field.key, field])),
      tables: new Map(def.tables.map((table) => [table.id, table])),
      schedules: new Map(def.schedules.map((schedule) => [schedule.id, schedule])),
    };
    INDEX.set(def, index);
  }
  return index;
}

function need<T>(found: T | undefined, what: string, id: string): T {
  if (found === undefined) throw new Error(`Form 26 has no ${what} "${id}"`);
  return found;
}

/** True only for the exact text "Yes" ("yes", "No" and blank are not). */
export function isYes(values: Form26Values, key: string): boolean {
  return getField(values, key) === 'Yes';
}

/** The chosen category of assessee, or null when none is chosen. */
export function categoryOf(values: Form26Values): Form26Category | null {
  const chosen = getField(values, 'cat');
  return chosen === '1' || chosen === '2' ? chosen : null;
}

/** Hidden by the category: a category is chosen and the item belongs to the other one. */
function hiddenByCategory(itemCategory: Form26Category | null, values: Form26Values): boolean {
  if (itemCategory === null) return false;
  const chosen = getField(values, 'cat');
  return chosen !== '' && chosen !== itemCategory;
}

function scheduleShown(schedule: Form26Schedule, values: Form26Values, opts: Form26ViewOptions): boolean {
  return schedule.showIf === null || opts.showAllSchedules || isYes(values, schedule.showIf);
}

export function isScheduleShown(def: Form26Definition, scheduleId: string, values: Form26Values, opts: Form26ViewOptions): boolean {
  return scheduleShown(need(indexOf(def).schedules.get(scheduleId), 'schedule', scheduleId), values, opts);
}

export function isFieldShown(def: Form26Definition, fieldKey: string, values: Form26Values, opts: Form26ViewOptions): boolean {
  const index = indexOf(def);
  const field = need(index.fields.get(fieldKey), 'answer key', fieldKey);
  if (hiddenByCategory(field.category, values)) return false;
  if (field.schedule !== null) {
    const schedule = need(index.schedules.get(field.schedule), 'schedule', field.schedule);
    if (!scheduleShown(schedule, values, opts)) return false;
    return field.showIf.every((key) => key === schedule.showIf || isYes(values, key));
  }
  return field.showIf.every((key) => isYes(values, key));
}

export function isTableShown(def: Form26Definition, tableId: string, values: Form26Values, opts: Form26ViewOptions): boolean {
  const index = indexOf(def);
  const table = need(index.tables.get(tableId), 'table', tableId);
  if (hiddenByCategory(table.category, values)) return false;
  if (table.schedule !== null) {
    // A table in a schedule is on screen with its schedule (which "Show all schedules" opens).
    const schedule = need(index.schedules.get(table.schedule), 'schedule', table.schedule);
    if (!scheduleShown(schedule, values, opts)) return false;
    return table.showIf.every((key) => key === schedule.showIf || isYes(values, key));
  }
  return table.showIf.every((key) => isYes(values, key));
}

/** The schedules on screen, in the form's order. */
export function shownSchedules(def: Form26Definition, values: Form26Values, opts: Form26ViewOptions): string[] {
  return def.schedules.filter((schedule) => scheduleShown(schedule, values, opts)).map((schedule) => schedule.id);
}

/** The schedule groups that have at least one schedule on screen, in the form's order. */
export function shownScheduleGroups(def: Form26Definition, values: Form26Values, opts: Form26ViewOptions): string[] {
  const shown = new Set(shownSchedules(def, values, opts));
  return def.scheduleGroups.filter((group) => group.schedules.some((id) => shown.has(id))).map((group) => group.id);
}

/** The Parts on screen: for category (ii) 'cat', 'B', 'C', 'D', 'S'; with no category both A and B. */
export function shownParts(values: Form26Values): Form26PartId[] {
  const chosen = getField(values, 'cat');
  const parts: Form26PartId[] = ['cat'];
  if (chosen === '' || chosen === '1') parts.push('A');
  if (chosen === '' || chosen === '2') parts.push('B');
  parts.push('C', 'D', 'S');
  return parts;
}
