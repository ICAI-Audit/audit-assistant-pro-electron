import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import type { Form26Table } from '@/data/taxAuditForm26Types';
import {
  addRow,
  blankRow,
  canAddRows,
  deleteRow,
  hasDeleteControl,
  isUnfilledCell,
  FORM26_TABLE_MAX_ROWS,
  normaliseRows,
  rowLimitReached,
  rowState,
  setCell,
  startRows,
  unfilledCellsByRow,
} from '@/lib/taxAuditForm26TableOps';
import { FORM26_SAVE_FILE_MAX_ROWS } from '@/lib/taxAuditForm26SaveFile';
import { form26BlankRow, type Form26Row } from '@/lib/taxAuditForm26Values';

const table = (id: string): Form26Table => {
  const found = DEF.tables.find((entry) => entry.id === id);
  if (!found) throw new Error(`no table ${id}`);
  return found;
};

// Expected figures are the owner's file's own (fixture calc.json, AS-BUILT section 9).
type DepProbe = {
  nos: number[];
  cols: { j: number; rate: string; steps: { set: number; col: Record<string, string> }[]; final: Record<string, string> }[];
};
type CalcFixture = { dep: Record<'Dpm' | 'Dot', DepProbe> };
const CALC = JSON.parse(readFileSync(new URL('./__fixtures__/taxAuditForm26/calc.json', import.meta.url), 'utf8')) as CalcFixture;
const depColumn = (dep: Form26Table, rows: Form26Row[], column: number): Record<string, string> =>
  Object.fromEntries((dep.dep?.rows ?? []).map((entry, index) => [String(entry.no), rows[index][entry.cells[column]]]));

describe('Form 26 table operations', () => {
  it('startRows: S28 → 2, P14a → 1, S40 → 1, S20 → 13, Dpm → 19, Dot → 16', () => {
    expect(startRows(table('S28'))).toHaveLength(2);
    expect(startRows(table('P14a'))).toHaveLength(1);
    expect(startRows(table('S40'))).toHaveLength(1);
    expect(startRows(table('S20'))).toHaveLength(13);
    expect(startRows(table('Dpm'))).toHaveLength(19);
    expect(startRows(table('Dot'))).toHaveLength(16);
    // Every cell blank; depreciation rows hold their own cells.
    expect(startRows(table('S28'))[0]).toEqual({ '1': '', '2': '', '3': '' });
    expect(startRows(table('Dpm'))[1]).toEqual(form26BlankRow(table('Dpm'), 1));
    // Every table opens with the rows the file opens with.
    for (const entry of DEF.tables) expect(startRows(entry), entry.id).toHaveLength(entry.startRows);
  });

  it('blankRow: every input column blank (calculated columns too; serial numbers and fixed texts are not held)', () => {
    expect(blankRow(table('S15b'))).toEqual({ '1': '', '2': '', '3': '', '4': '', '5': '' });
    expect(blankRow(table('P12d'))).toEqual({ '2': '', '3': '' });
  });

  it('addRow adds one blank row; a fixed table does not take rows', () => {
    const rows = [{ '1': 'Invented law', '2': '12', '3': '700' }];
    const added = addRow(table('S28'), rows);
    expect(added).toEqual([rows[0], { '1': '', '2': '', '3': '' }]);
    expect(rows).toHaveLength(1);
    expect(addRow(table('P12d'), startRows(table('P12d')))).toHaveLength(5);
    expect(canAddRows(table('S28'))).toBe(true);
    expect(canAddRows(table('P12d'))).toBe(false);
    expect(canAddRows(table('Dpm'))).toBe(false);
  });

  it('"Add row" stops at the most rows a table can hold (the save file\'s limit, 5,000)', () => {
    const s28 = table('S28');
    const full = Array.from({ length: FORM26_SAVE_FILE_MAX_ROWS }, () => blankRow(s28));
    expect(FORM26_TABLE_MAX_ROWS).toBe(5000);
    expect(rowLimitReached(s28, full)).toBe(true);
    expect(addRow(s28, full)).toBe(full);
    const almost = full.slice(1);
    expect(rowLimitReached(s28, almost)).toBe(false);
    expect(addRow(s28, almost)).toHaveLength(5000);
    // A fixed table never takes rows, so it never reaches the limit.
    expect(rowLimitReached(table('P12d'), startRows(table('P12d')))).toBe(false);
  });

  it('deleteRow of one of two removes it', () => {
    const rows: Form26Row[] = [{ '1': 'A', '2': '1', '3': '700' }, { '1': 'B', '2': '2', '3': '300' }];
    expect(deleteRow(table('S28'), rows, 0)).toEqual([{ '1': 'B', '2': '2', '3': '300' }]);
    expect(rows).toHaveLength(2);
  });

  it('deleteRow of the only row clears it', () => {
    expect(deleteRow(table('S28'), [{ '1': 'A', '2': '1', '3': '700' }], 0)).toEqual([{ '1': '', '2': '', '3': '' }]);
    // A fixed table keeps its rows.
    const fixed = startRows(table('P12d'));
    expect(deleteRow(table('P12d'), fixed, 0)).toBe(fixed);
  });

  it('every table that takes added rows has a delete control (decision A3); the file\'s own setting leaves eight without one', () => {
    const withoutSerial = DEF.tables.filter((entry) => entry.kind === 'rows' && !entry.hasSerialColumn).map((entry) => entry.id);
    expect(withoutSerial).toEqual(['S38', 'S41a', 'S41b', 'S41c', 'S46', 'S50a', 'S50b', 'S50c']);
    for (const entry of DEF.tables) expect(hasDeleteControl(entry), entry.id).toBe(entry.kind === 'rows');
    const fileSetting = { chainedCalcUsesFreshValue: false, deleteControlOnEveryRowTable: false, showAllSchedulesAffectsExport: true };
    for (const id of withoutSerial) expect(hasDeleteControl(table(id), fileSetting), id).toBe(false);
    expect(hasDeleteControl(table('S28'), fileSetting)).toBe(true);
  });

  it('setCell on S15b column 2 fills column 4', () => {
    const rows = startRows(table('S15b'));
    const once = setCell(table('S15b'), rows, 0, '2', '1234.567');
    expect(once[0]['4']).toBe('1234.57');
    const twice = setCell(table('S15b'), once, 0, '3', '234.561');
    expect(twice[0]['4']).toBe('1000.01');
    // The other row object is kept as it was (only the edited row is new).
    expect(twice[1]).toBe(rows[1]);
    expect(rows[0]['2']).toBe('');
    // Typing in the calculated cell itself keeps what is typed (as the file).
    expect(setCell(table('S15b'), twice, 0, '4', '5')[0]['4']).toBe('5');
  });

  it('setCell on Dpm row index 0 fills rows 6 and 10 of that rate column', () => {
    const dpm = table('Dpm');
    const rows = setCell(dpm, startRows(dpm), 0, '0', '1000');
    // Row 6 = max(0, r3 + r4 - r5) = 1000; row 10 = r6 * 15 / 100 = 150.
    expect(rows[3]['60']).toBe('1000');
    expect(rows[7]['140']).toBe('150');
    expect(rows[3]['61']).toBe('');
    // Keystroke by keystroke as the file recorded it, in every rate column of both tables.
    for (const id of ['Dpm', 'Dot'] as const) {
      const dep = table(id);
      const probe = CALC.dep[id];
      for (const column of probe.cols) {
        let current = startRows(dep);
        for (const step of column.steps) {
          current = setCell(dep, current, probe.nos.indexOf(step.set), dep.dep?.rows[probe.nos.indexOf(step.set)].cells[column.j] ?? '', column.final[String(step.set)]);
          expect(depColumn(dep, current, column.j), `${id} rate ${column.rate} after row ${step.set}`).toEqual(step.col);
        }
      }
    }
  });

  it('normaliseRows([]) gives one blank row; a fixed table given 9 rows keeps 5 (P12d)', () => {
    expect(normaliseRows(table('S28'), [])).toEqual([{ '1': '', '2': '', '3': '' }]);
    expect(normaliseRows(table('S28'), undefined)).toEqual([{ '1': '', '2': '', '3': '' }]);
    const nine = Array.from({ length: 9 }, (_, index) => ({ '2': String(index), '3': '' }));
    const kept = normaliseRows(table('P12d'), nine);
    expect(kept).toHaveLength(5);
    expect(kept.map((entry) => entry['2'])).toEqual(['0', '1', '2', '3', '4']);
    expect(normaliseRows(table('P12d'), [])).toEqual(startRows(table('P12d')));
    expect(normaliseRows(table('Dot'), [])).toHaveLength(16);
    // A missing cell is blank; complete rows (and the list) are given back as they are.
    expect(normaliseRows(table('S28'), [{ '1': 'A' }])).toEqual([{ '1': 'A', '2': '', '3': '' }]);
    const complete = [{ '1': 'A', '2': '', '3': '' }];
    expect(normaliseRows(table('S28'), complete)).toBe(complete);
  });

  it('unfilled cells of one table by row, as text a screen can compare cheaply', () => {
    const items = [{ k: 'c28' }, { t: 'S28', r: 0, c: '1' }, { t: 'S28', r: 0, c: '3' }, { t: 'S29', r: 0, c: '1' }, { t: 'S28', r: 2, c: '2' }];
    const byRow = unfilledCellsByRow(items, 'S28');
    expect(byRow).toEqual({ 0: '|1|3|', 2: '|2|' });
    expect(isUnfilledCell(byRow[0], '1')).toBe(true);
    expect(isUnfilledCell(byRow[0], '2')).toBe(false);
    expect(isUnfilledCell(byRow[1], '1')).toBe(false);
    expect(unfilledCellsByRow([], 'S28')).toEqual({});
  });

  it('rowState: a row with one value in S29 has toFill 4; with optional columns blank in S30 → 0', () => {
    expect(rowState(table('S29'), { '1': 'Invented Person', '2': '', '3': '', '4': '', '5': '' })).toEqual({ filled: true, toFill: 4 });
    expect(rowState(table('S30'), { '1': '2026-05-01', '2': 'Invented payment', '3': '1000', '4': '', '5': '', '6': '' })).toEqual({ filled: true, toFill: 0 });
    expect(rowState(table('S29'), blankRow(table('S29')))).toEqual({ filled: false, toFill: 0 });
    // A calculated figure alone is not a value of the row (as the file counts).
    expect(rowState(table('S15b'), { '1': '', '2': '', '3': '', '4': '5', '5': '' })).toEqual({ filled: false, toFill: 0 });
    expect(rowState(table('S15b'), { '1': 'Invented', '2': '', '3': '', '4': '', '5': '' })).toEqual({ filled: true, toFill: 2 });
  });
});
