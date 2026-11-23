import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import type { Form26PartId } from '@/data/taxAuditForm26Types';
import {
  categoryOf,
  isFieldShown,
  isScheduleShown,
  isTableShown,
  isYes,
  shownParts,
  shownScheduleGroups,
  shownSchedules,
} from '@/lib/taxAuditForm26Reveal';
import { defaultValues, getField, type Form26Values } from '@/lib/taxAuditForm26Values';

// Expected values are the owner's file's own recorded behaviour (fixtures copied from the extraction).
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8')) as T;

type RevealRule = {
  key: string;
  schedules: string[];
  inline: { fields: string[]; tables: string[] }[];
};
type UnfilledState = {
  name: string;
  showAll: boolean;
  values: Form26Values;
  visibleScheds: string[];
  visiblePanels: Form26PartId[];
  hiddenKeys: string[];
};

const REVEAL = fixture<{ rules: RevealRule[] }>('reveal.json');
const STATES = fixture<UnfilledState[]>('unfilled.json');
const SAVE_DEFAULT = fixture<Form26Values & { v: number }>('save-default.json');

const NORMAL = { showAllSchedules: false };
const SHOW_ALL = { showAllSchedules: true };
const YES_NO_KEYS = DEF.fields.filter((field) => field.kind === 'yesno').map((field) => field.key);
const INLINE_FIELDS = DEF.fields.filter((field) => field.showIf.length > 0).map((field) => field.key);
const INLINE_TABLES = DEF.tables.filter((table) => table.schedule === null && table.showIf.length > 0).map((table) => table.id);
const ALWAYS_OPEN = DEF.schedules.filter((schedule) => schedule.showIf === null).map((schedule) => schedule.id);

/** Every yes/no answer set to one value; the category is the one of the key under test so that its Part is on screen. */
function allAnswers(answer: string, category: string): Form26Values {
  const values = defaultValues(DEF);
  for (const key of YES_NO_KEYS) values.f[key] = answer;
  values.f.cat = category;
  return values;
}

const categoryForKey = (key: string) => DEF.fields.find((field) => field.key === key)?.category ?? '2';

describe('Form 26: values at open', () => {
  it('defaultValues equals the file\'s save at open', () => {
    const values = defaultValues(DEF);
    expect(values).toEqual({ f: SAVE_DEFAULT.f, t: SAVE_DEFAULT.t });
    // The same keys in the same order as the file writes them.
    expect(JSON.stringify(values)).toBe(JSON.stringify({ f: SAVE_DEFAULT.f, t: SAVE_DEFAULT.t }));
    expect(Object.keys(values.f)).toHaveLength(142);
    expect(Object.keys(values.t)).toHaveLength(65);
  });

  it('defaultValues gives a fresh object every time', () => {
    const first = defaultValues(DEF);
    first.f.c10 = 'Yes';
    first.t.A3b[0]['2'] = '5';
    const second = defaultValues(DEF);
    expect(second.f.c10).toBe('No');
    expect(second.t.A3b[0]['2']).toBe('');
  });

  it('getField gives the value, and blank when the key is absent', () => {
    const values = defaultValues(DEF);
    expect(getField(values, 'c14d')).toBe('Yes');
    expect(getField(values, 'C.name')).toBe('');
    expect(getField({ f: {}, t: {} }, 'cat')).toBe('');
    expect(getField(values, 'toString')).toBe('');
  });
});

describe('Form 26: what is shown', () => {
  it('each of the 65 keys set to Yes shows exactly its schedules and inline items; No and blank show none', () => {
    expect(REVEAL.rules).toHaveLength(65);
    for (const rule of REVEAL.rules) {
      const category = categoryForKey(rule.key);
      const values = allAnswers('No', category);

      for (const off of ['No', '']) {
        values.f[rule.key] = off;
        expect(shownSchedules(DEF, values, NORMAL), `${rule.key}=${JSON.stringify(off)}`).toEqual(ALWAYS_OPEN);
        expect(INLINE_FIELDS.filter((key) => isFieldShown(DEF, key, values, NORMAL)), rule.key).toEqual([]);
        expect(INLINE_TABLES.filter((id) => isTableShown(DEF, id, values, NORMAL)), rule.key).toEqual([]);
      }

      values.f[rule.key] = 'Yes';
      const expectedSchedules = DEF.schedules
        .map((schedule) => schedule.id)
        .filter((id) => ALWAYS_OPEN.includes(id) || rule.schedules.includes(id));
      expect(shownSchedules(DEF, values, NORMAL), `${rule.key}=Yes`).toEqual(expectedSchedules);
      expect(INLINE_FIELDS.filter((key) => isFieldShown(DEF, key, values, NORMAL)), `${rule.key}=Yes`).toEqual(
        rule.inline.flatMap((item) => item.fields),
      );
      expect(INLINE_TABLES.filter((id) => isTableShown(DEF, id, values, NORMAL)), `${rule.key}=Yes`).toEqual(
        rule.inline.flatMap((item) => item.tables),
      );
      // A table inside a schedule is shown exactly when its schedule is.
      for (const table of DEF.tables) {
        if (table.schedule === null) continue;
        expect(isTableShown(DEF, table.id, values, NORMAL), `${rule.key}=Yes ${table.id}`).toBe(
          expectedSchedules.includes(table.schedule),
        );
      }
    }
    const rule = (key: string) => REVEAL.rules.find((entry) => entry.key === key);
    expect(rule('c52')?.schedules).toEqual(['s52a', 's52b']);
    expect(rule('c53b')?.schedules).toEqual(['s53bi', 's53bii']);
    expect(rule('c24')?.inline[0].fields).toEqual(['c24_amt']);
    expect(rule('A.q3a')?.inline[0].tables).toEqual(['A3b']);
  });

  it('c10 and c14d reveal nothing', () => {
    const base = allAnswers('No', '2');
    for (const key of ['c10', 'c14d']) {
      const values = { f: { ...base.f, [key]: 'Yes' }, t: base.t };
      expect(shownSchedules(DEF, values, NORMAL)).toEqual(ALWAYS_OPEN);
      expect(INLINE_FIELDS.filter((field) => isFieldShown(DEF, field, values, NORMAL))).toEqual([]);
      expect(INLINE_TABLES.filter((id) => isTableShown(DEF, id, values, NORMAL))).toEqual([]);
    }
  });

  it('shown schedules equal the page in all 24 states', () => {
    expect(STATES).toHaveLength(24);
    for (const state of STATES) {
      const opts = { showAllSchedules: state.showAll };
      expect(shownSchedules(DEF, state.values, opts), state.name).toEqual(state.visibleScheds);
      for (const schedule of DEF.schedules) {
        expect(isScheduleShown(DEF, schedule.id, state.values, opts), `${state.name} ${schedule.id}`).toBe(
          state.visibleScheds.includes(schedule.id),
        );
      }
      const groups = DEF.scheduleGroups
        .filter((group) => group.schedules.some((id) => state.visibleScheds.includes(id)))
        .map((group) => group.id);
      expect(shownScheduleGroups(DEF, state.values, opts), state.name).toEqual(groups);
    }
    expect(shownSchedules(DEF, defaultValues(DEF), NORMAL)).toEqual(['s12a', 's50a', 's50b', 's52a', 's52b']);
    expect(shownScheduleGroups(DEF, defaultValues(DEF), NORMAL)).toEqual(['0', '8', '9']);
  });

  it('hidden answers equal the page in all 24 states', () => {
    for (const state of STATES) {
      const opts = { showAllSchedules: state.showAll };
      const hidden = DEF.fields.map((field) => field.key).filter((key) => !isFieldShown(DEF, key, state.values, opts));
      expect(hidden, state.name).toEqual(state.hiddenKeys);
    }
  });

  it('category: \'2\' shows cat,B,C,D,S; \'1\' shows cat,A,C,D,S; none shows both A and B', () => {
    for (const state of STATES) {
      expect(shownParts(state.values), state.name).toEqual(state.visiblePanels);
    }
    const values = defaultValues(DEF);
    expect(categoryOf(values)).toBe('2');
    expect(shownParts(values)).toEqual(['cat', 'B', 'C', 'D', 'S']);
    values.f.cat = '1';
    expect(categoryOf(values)).toBe('1');
    expect(shownParts(values)).toEqual(['cat', 'A', 'C', 'D', 'S']);
    delete values.f.cat;
    expect(categoryOf(values)).toBeNull();
    expect(shownParts(values)).toEqual(['cat', 'A', 'B', 'C', 'D', 'S']);
    values.f.cat = '';
    expect(categoryOf(values)).toBeNull();
  });

  it('an item of the other category is hidden whatever its answer; with no category both Parts show', () => {
    const values = allAnswers('Yes', '2');
    expect(isFieldShown(DEF, 'A.assessee', values, NORMAL)).toBe(false);
    expect(isTableShown(DEF, 'A3b', values, NORMAL)).toBe(false);
    expect(isTableShown(DEF, 'A5', values, NORMAL)).toBe(false);
    expect(isFieldShown(DEF, 'B.bs', values, NORMAL)).toBe(true);
    expect(isTableShown(DEF, 'B3b', values, NORMAL)).toBe(true);
    values.f.cat = '1';
    expect(isTableShown(DEF, 'A3b', values, NORMAL)).toBe(true);
    expect(isTableShown(DEF, 'B3b', values, NORMAL)).toBe(false);
    expect(isFieldShown(DEF, 'B.bs', values, NORMAL)).toBe(false);
    delete values.f.cat;
    expect(isTableShown(DEF, 'A3b', values, NORMAL)).toBe(true);
    expect(isTableShown(DEF, 'B3b', values, NORMAL)).toBe(true);
    expect(isTableShown(DEF, 'A5', values, NORMAL)).toBe(true);
  });

  it('"yes" in lower case does not reveal', () => {
    const values = allAnswers('No', '2');
    for (const answer of ['yes', 'YES', ' Yes', 'Yes ', 'Y', 'true', '1']) {
      for (const key of YES_NO_KEYS) values.f[key] = answer;
      expect(isYes(values, 'c24'), answer).toBe(false);
      expect(shownSchedules(DEF, values, NORMAL), answer).toEqual(ALWAYS_OPEN);
      expect(isFieldShown(DEF, 'c24_amt', values, NORMAL), answer).toBe(false);
      expect(isTableShown(DEF, 'B3b', values, NORMAL), answer).toBe(false);
    }
    values.f.c24 = 'Yes';
    expect(isYes(values, 'c24')).toBe(true);
    expect(isYes(values, 'no such key')).toBe(false);
    expect(isFieldShown(DEF, 'c24_amt', values, NORMAL)).toBe(true);
  });

  it('show all opens all 55 schedules and no inline item', () => {
    const values = allAnswers('No', '2');
    expect(shownSchedules(DEF, values, SHOW_ALL)).toEqual(DEF.schedules.map((schedule) => schedule.id));
    expect(shownSchedules(DEF, values, SHOW_ALL)).toHaveLength(55);
    expect(shownScheduleGroups(DEF, values, SHOW_ALL)).toEqual(DEF.scheduleGroups.map((group) => group.id));
    expect(INLINE_FIELDS.filter((key) => isFieldShown(DEF, key, values, SHOW_ALL))).toEqual([]);
    expect(INLINE_TABLES.filter((id) => isTableShown(DEF, id, values, SHOW_ALL))).toEqual([]);
    // Every table that sits in a schedule is on screen with it.
    for (const table of DEF.tables) {
      if (table.schedule !== null) expect(isTableShown(DEF, table.id, values, SHOW_ALL), table.id).toBe(true);
    }
  });

  it('an id the form does not have is an error, not a silent "hidden"', () => {
    const values = defaultValues(DEF);
    expect(() => isScheduleShown(DEF, 's99', values, NORMAL)).toThrow(/s99/);
    expect(() => isFieldShown(DEF, 'c99', values, NORMAL)).toThrow(/c99/);
    expect(() => isTableShown(DEF, 'S99', values, NORMAL)).toThrow(/S99/);
  });
});
