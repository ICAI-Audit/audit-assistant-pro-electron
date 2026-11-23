import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  createForm26UnfilledCache,
  countUnfilled,
  nextUnfilled,
  previousUnfilled,
  scanUnfilled,
  type Form26UnfilledItem,
} from '@/lib/taxAuditForm26Unfilled';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';

// Expected values are the owner's file's own lists of unfilled items in 24 states (fixture unfilled.json).
type Buckets = Record<string, number>;
type UnfilledState = {
  name: string;
  showAll: boolean;
  values: Form26Values;
  expected: { total: number; panel: Buckets; dsec: Buckets; sg: Buckets; form: Buckets; items: Form26UnfilledItem[] };
};

const STATES = JSON.parse(
  readFileSync(new URL('./__fixtures__/taxAuditForm26/unfilled.json', import.meta.url), 'utf8'),
) as UnfilledState[];

const NORMAL = { showAllSchedules: false };
const scanState = (state: UnfilledState) => scanUnfilled(DEF, state.values, { showAllSchedules: state.showAll });
/** The page keeps a bucket named "null" for items outside any section, group or schedule: named buckets only. */
const named = (buckets: Buckets): Buckets => Object.fromEntries(Object.entries(buckets).filter(([name]) => name !== 'null'));
const sum = (buckets: Buckets) => Object.values(buckets).reduce((total, count) => total + count, 0);
const clone = (values: Form26Values): Form26Values => JSON.parse(JSON.stringify(values)) as Form26Values;

const TOTALS: Record<string, number> = {
  default: 45,
  'default+showAll': 97,
  'default cat1': 47,
  allYes: 109,
  allBlank: 107,
  'allYes + first cell of each add/delete table': 251,
  'allYes + also one cell of each fixed table': 238,
  'calculated cell only in S15b': 256,
  'everything filled, every gateway No (3 rows per table)': 0,
  'everything filled, every gateway Yes': 0,
  'everything filled, every gateway Yes, cat1': 0,
  'everything filled, UDINs and B.obs blank': 0,
  'everything filled, radio answers removed by load (both Parts A and B shown)': 3,
  'everything filled, optional columns blank': 0,
  'one blank required cell in S28, three in S29 row 2, S29 row 3 wholly blank': 4,
  'state default': 45,
  'state cat1': 47,
  'state cat2': 45,
  'state catNone': 62,
  'state allNo': 41,
  'state allBlank': 107,
  'state allNoShowAll': 97,
  'state allYes': 109,
  'state allYesCat1': 111,
};

describe('Form 26: what counts as unfilled', () => {
  it('matches the owner\'s file item for item and in order in all 24 states', () => {
    expect(STATES).toHaveLength(24);
    expect(Object.fromEntries(STATES.map((state) => [state.name, state.expected.total]))).toEqual(TOTALS);
    for (const state of STATES) {
      const items = scanState(state);
      expect(items, state.name).toEqual(state.expected.items);
      expect(items.length, state.name).toBe(TOTALS[state.name]);
    }
  });

  it('at open: 45 items, the same as the file', () => {
    const items = scanUnfilled(DEF, defaultValues(DEF), NORMAL);
    expect(items).toEqual(STATES[0].expected.items);
    expect(scanUnfilled(DEF, defaultValues(DEF), { showAllSchedules: true })).toHaveLength(97);
  });

  it('counts by part, section, group and schedule equal the page', () => {
    for (const state of STATES) {
      const counts = countUnfilled(DEF, scanState(state));
      expect(counts.total, state.name).toBe(state.expected.total);
      expect(counts.part, state.name).toEqual(named(state.expected.panel));
      expect(counts.section, state.name).toEqual(named(state.expected.dsec));
      expect(counts.scheduleGroup, state.name).toEqual(named(state.expected.sg));
      expect(counts.schedule, state.name).toEqual(named(state.expected.form));
      expect(sum(counts.part), state.name).toBe(counts.total);
    }
    const atOpen = countUnfilled(DEF, scanUnfilled(DEF, defaultValues(DEF), NORMAL));
    expect(atOpen.total).toBe(45);
    expect(atOpen.part).toEqual({ B: 12, C: 14, D: 14, S: 5 });
    expect(atOpen.section).toEqual({ A: 1, B: 5, I: 1, Z: 7 });
    expect(atOpen.scheduleGroup).toEqual({ '0': 1, '8': 2, '9': 2 });
    expect(atOpen.schedule).toEqual({ s12a: 1, s50a: 1, s50b: 1, s52a: 1, s52b: 1 });
  });

  it('clause counts add up to the total; at open clause f26_c14 has 4', () => {
    const clauseKeys = new Set(FORM26_CLAUSE_UNITS.map((unit) => unit.key));
    for (const state of STATES) {
      const counts = countUnfilled(DEF, scanState(state));
      expect(sum(counts.clause), state.name).toBe(counts.total);
      for (const key of Object.keys(counts.clause)) expect(clauseKeys.has(key), `${state.name} ${key}`).toBe(true);
    }
    const atOpen = countUnfilled(DEF, scanUnfilled(DEF, defaultValues(DEF), NORMAL));
    expect(atOpen.clause.f26_c14).toBe(4);
    expect(atOpen.clause.f26_part_b).toBe(12);
    expect(atOpen.clause.f26_c12).toBe(2); // P12d and schedule 12(a)
    expect(atOpen.clause.f26_c52).toBe(2);
    expect(atOpen.clause.f26_sign).toBe(7);
    expect(atOpen.clause.f26_part_a).toBeUndefined();
    expect(countUnfilled(DEF, [])).toEqual({ total: 0, part: {}, section: {}, scheduleGroup: {}, schedule: {}, clause: {} });
  });

  it('the rules one by one, from the open form', () => {
    const base = defaultValues(DEF);
    const at = (values: Form26Values, table: string) =>
      scanUnfilled(DEF, values, NORMAL).filter((item) => 't' in item && item.t === table);

    // A wholly blank table is ONE item: its first cell that is not calculated.
    expect(at(base, 'S50a')).toEqual([{ t: 'S50a', r: 0, c: '0' }]);
    // A table with no rows at all is still one item.
    const noRows = clone(base);
    noRows.t.S50a = [];
    delete noRows.t.S52a;
    expect(at(noRows, 'S50a')).toEqual([{ t: 'S50a', r: 0, c: '0' }]);
    expect(at(noRows, 'S52a')).toEqual([{ t: 'S52a', r: 0, c: '1' }]);

    // A value only in a calculated cell does not make the table filled.
    const calcOnly = clone(base);
    calcOnly.f['B.q3b'] = 'Yes';
    calcOnly.t.B3b[0]['4'] = '5';
    expect(at(calcOnly, 'B3b')).toEqual([{ t: 'B3b', r: 0, c: '1' }]);

    // In a row with a value: every blank cell that is not optional and not calculated; a blank row counts nothing.
    const partly = clone(calcOnly);
    partly.t.B3b[1]['2'] = '100';
    expect(at(partly, 'B3b')).toEqual([{ t: 'B3b', r: 1, c: '3' }]);
    partly.t.B3b[1]['3'] = '40';
    expect(at(partly, 'B3b')).toEqual([]);

    // A fixed table is complete once one cell has a value.
    const fixed = clone(base);
    expect(at(fixed, 'P12d')).toEqual([{ t: 'P12d', r: 0, c: '2' }]);
    fixed.t.P12d[4]['3'] = '7';
    expect(at(fixed, 'P12d')).toEqual([]);

    // A depreciation table: one item at its first row; a figure in a calculated row alone does not fill it.
    const dep = clone(base);
    dep.f.c36 = 'Yes';
    expect(at(dep, 'Dpm')).toEqual([{ t: 'Dpm', r: 0, c: '0' }]);
    dep.t.Dpm[3]['60'] = '9';
    expect(at(dep, 'Dpm')).toEqual([{ t: 'Dpm', r: 0, c: '0' }]);
    dep.t.Dpm[4]['83'] = '9';
    expect(at(dep, 'Dpm')).toEqual([]);
    expect(at(dep, 'Dot')).toEqual([{ t: 'Dot', r: 0, c: '0' }]);

    // The three tables that never count.
    const exempt = clone(base);
    exempt.f.cat = '';
    expect(scanUnfilled(DEF, exempt, NORMAL).filter((item) => 't' in item && ['A5', 'B5', 'P11a'].includes(item.t))).toEqual([]);

    // A hidden item never counts; shown again it does.
    expect(scanUnfilled(DEF, base, NORMAL)).not.toContainEqual({ k: 'c24_amt' });
    const shown = clone(base);
    shown.f.c24 = 'Yes';
    expect(scanUnfilled(DEF, shown, NORMAL)).toContainEqual({ k: 'c24_amt' });

    // Clause 14(e) is asked whatever 14(d) says, as in the file.
    const noBackup = clone(base);
    noBackup.f.c14d = 'No';
    expect(scanUnfilled(DEF, noBackup, NORMAL)).toContainEqual({ k: 'c14e' });
  });

  it('typing in one table of a large audit does not read the cells of every other table again (task 27: 250 rows in every table, one key at a time)', () => {
    // Rows that count every read of a cell.
    let reads = 0;
    const counted = (rows: Form26Values['t'][string]) =>
      rows.map((row) => new Proxy(row, { get: (target, key, receiver) => { if (typeof key === 'string') reads += 1; return Reflect.get(target, key, receiver); } }));
    const values = defaultValues(DEF);
    values.f.c28 = 'Yes';
    values.f.c29 = 'Yes';
    values.t.S28 = counted(Array.from({ length: 250 }, (_, i) => ({ '1': `Invented Act ${i}`, '2': 'x', '3': '1' })));
    values.t.S29 = Array.from({ length: 250 }, (_, i) => ({ '1': `Invented ${i}`, '2': 'AAAAA0000A', '3': 'x', '4': 'x', '5': '1' }));
    // The screen's cache (the hook keeps one); without it every table is read, as before.
    const view = { showAllSchedules: false, cache: createForm26UnfilledCache() };
    const first = scanUnfilled(DEF, values, view);
    expect(reads).toBeGreaterThan(250);
    reads = 0;
    // A key typed in S29: a new list of rows for S29 only (as the screen gives it); S28's list is the same one.
    const typed = { f: values.f, t: { ...values.t, S29: values.t.S29.map((row, i) => (i === 239 ? { ...row, '1': '' } : row)) } };
    const second = scanUnfilled(DEF, typed, view);
    expect(reads).toBe(0);
    expect(second.filter((item) => 't' in item && item.t === 'S29')).toEqual([{ t: 'S29', r: 239, c: '1' }]);
    expect(second.length).toBe(first.length + 1);
    // The same answer without a cache: equal item for item.
    expect(second).toEqual(scanUnfilled(DEF, JSON.parse(JSON.stringify(typed)) as Form26Values, { showAllSchedules: false }));
    // Without a cache every table is read again; with it, a row changed in place in a kept list is not seen, so
    // only the screen (which never changes a row in place) passes one.
    reads = 0;
    scanUnfilled(DEF, typed, { showAllSchedules: false });
    expect(reads).toBeGreaterThan(250);
  });

  it('an unconfirmed key counts although it has a value', () => {
    const values = defaultValues(DEF);
    const plain = scanUnfilled(DEF, values, NORMAL);
    expect(plain).not.toContainEqual({ k: 'C.res' });

    const items = scanUnfilled(DEF, values, { ...NORMAL, unconfirmed: new Set(['C.res', 'C.name', 'A.pl', 'c24_amt']) });
    // C.res has a value ("Resident") and now counts, in its place in the form; C.name was blank anyway (once);
    // A.pl and c24_amt are not on screen and do not count.
    expect(items).toHaveLength(plain.length + 1);
    expect(items.filter((item) => 'k' in item && item.k === 'C.name')).toHaveLength(1);
    const keys = items.map((item) => ('k' in item ? item.k : item.t));
    expect(keys.slice(keys.indexOf('C.status'), keys.indexOf('C.email') + 1)).toEqual(['C.status', 'C.res', 'C.email']);
    expect(items).not.toContainEqual({ k: 'A.pl' });
    expect(items).not.toContainEqual({ k: 'c24_amt' });
    expect(scanUnfilled(DEF, values, { ...NORMAL, unconfirmed: new Set<string>() })).toEqual(plain);
  });

  it('nextUnfilled walks the list and wraps; with an empty list returns null', () => {
    for (const state of STATES) {
      const items = scanState(state);
      if (items.length === 0) {
        expect(nextUnfilled(items, null), state.name).toBeNull();
        expect(previousUnfilled(items, null), state.name).toBeNull();
        continue;
      }
      let current = nextUnfilled(items, null);
      const walked: (Form26UnfilledItem | null)[] = [];
      for (let i = 0; i < items.length; i += 1) {
        walked.push(current);
        current = nextUnfilled(items, current);
      }
      expect(walked, state.name).toEqual(items);
      expect(current, state.name).toEqual(items[0]); // wrapped

      let back = previousUnfilled(items, null);
      const walkedBack: (Form26UnfilledItem | null)[] = [];
      for (let i = 0; i < items.length; i += 1) {
        walkedBack.push(back);
        back = previousUnfilled(items, back);
      }
      expect(walkedBack, state.name).toEqual([...items].reverse());
      expect(back, state.name).toEqual(items[items.length - 1]);
    }
    expect(nextUnfilled([], { k: 'C.name' })).toBeNull();
    expect(previousUnfilled([], { k: 'C.name' })).toBeNull();
  });

  it('after the item just visited has been filled, "next" goes on from its place (as the file), not back to the first', () => {
    const values = defaultValues(DEF);
    const before = scanUnfilled(DEF, values, NORMAL);
    const visited = before[12];
    expect(visited).toEqual({ k: 'C.name' });
    values.f['C.name'] = 'Invented Trading Company';
    const after = scanUnfilled(DEF, values, NORMAL);
    expect(after).toHaveLength(44);
    expect(nextUnfilled(after, visited)).toEqual({ k: 'C.a1' });
    expect(previousUnfilled(after, visited)).toEqual({ k: 'B.frn' });

    // The same inside a table: the cell visited is filled, the next blank cell of the row follows.
    values.f.c28 = 'Yes';
    values.t.S28[0]['1'] = 'Invented';
    const inTable = scanUnfilled(DEF, values, NORMAL);
    const cells = inTable.filter((item) => 't' in item && item.t === 'S28');
    expect(cells.length).toBeGreaterThan(1);
    expect(nextUnfilled(inTable, { t: 'S28', r: 0, c: '1' })).toEqual(cells[0]);
    expect(nextUnfilled(inTable, cells[0])).toEqual(cells[1]);
    expect(previousUnfilled(inTable, cells[1])).toEqual(cells[0]);

    // After the last place of the form it wraps to the first; an item the form does not have starts at the first.
    expect(nextUnfilled(after, { t: 'S53bii', r: 5, c: '1' })).toEqual(after[0]);
    expect(previousUnfilled(after, { k: 'cat' })).toEqual(after[after.length - 1]);
    expect(nextUnfilled(after, { k: 'no such key' })).toEqual(after[0]);
    expect(previousUnfilled(after, { k: 'no such key' })).toEqual(after[after.length - 1]);
  });
});
