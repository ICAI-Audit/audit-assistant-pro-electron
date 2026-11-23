import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import type { Form26Table } from '@/data/taxAuditForm26Types';
import {
  evalExpr,
  formatTotal,
  numv,
  r2,
  recalcDepreciation,
  recalcRow,
  tableTotals,
} from '@/lib/taxAuditForm26Calc';
import { FORM26_QUIRKS } from '@/lib/taxAuditForm26Quirks';
import { form26BlankRow, type Form26Row } from '@/lib/taxAuditForm26Values';

// Expected values are figures entered in the owner's file and read back from it (fixture calc.json).
type RowCalc = {
  calcCols: number[];
  numCols: number[];
  steps: { step: string; row: Form26Row }[];
  afterAll: Form26Row;
  afterSecondPass: Form26Row;
  afterManual: Form26Row;
  afterSourceChange: Form26Row;
  afterClear: Form26Row;
};
type DepColumn = { j: number; rate: string; final: Record<string, string>; steps: { set: number; col: Record<string, string> }[] };
type DepProbe = { kind: string; rates: string[]; nos: number[]; calcRows: number[]; inputRows: number[]; cols: DepColumn[]; afterManual10: string };
type CalcFixture = {
  rowCalc: Record<string, RowCalc>;
  totals: Record<string, { sum: number[]; before: Record<string, string>; rows: Form26Row[]; after: Record<string, string> }>;
  dep: Record<string, DepProbe>;
  quirks: {
    totalZero: Record<string, string>;
    totalNegative: Record<string, string>;
    totalIndianFormat: Record<string, string>;
    depClamp: { r6: string; r10: string };
  };
};

const CALC = JSON.parse(
  readFileSync(new URL('./__fixtures__/taxAuditForm26/calc.json', import.meta.url), 'utf8'),
) as CalcFixture;

const AS_THE_FILE = { ...FORM26_QUIRKS, chainedCalcUsesFreshValue: false };
const FRESH = { ...FORM26_QUIRKS, chainedCalcUsesFreshValue: true };

const tableOf = (id: string): Form26Table => {
  const table = DEF.tables.find((entry) => entry.id === id);
  if (!table) throw new Error(`no table ${id}`);
  return table;
};
/** Type a value into one cell of a row and let the row recalculate, as one keystroke event does. */
const type = (table: Form26Table, row: Form26Row, column: string, value: string, quirks = AS_THE_FILE): Form26Row =>
  recalcRow(table, { ...row, [column]: value }, column, quirks);
/** Only the cells the fixture recorded (it lists the input cells of the row). */
const pick = (row: Form26Row, like: Form26Row): Form26Row => Object.fromEntries(Object.keys(like).map((key) => [key, row[key]]));

/** Replays the whole recorded probe of one table and returns every state the fixture recorded. */
function replay(id: string, quirks: typeof AS_THE_FILE) {
  const table = tableOf(id);
  const probe = CALC.rowCalc[id];
  const blank = form26BlankRow(table, 0);
  const steps: Form26Row[] = [];
  let row = blank;
  for (const step of probe.steps) {
    if (step.step === 'text only') {
      // A text typed in a column that is no source: the calculated cells stay blank.
      const [column, value] = Object.entries(step.row).find(([, cell]) => cell !== '') ?? ['', ''];
      steps.push(type(table, blank, column, value, quirks));
      continue;
    }
    const match = /^set c(\d+)=(.+)$/.exec(step.step);
    if (!match) throw new Error(`unknown step "${step.step}"`);
    row = type(table, row, match[1], match[2], quirks);
    steps.push(row);
  }
  const afterAll = row;
  const firstSource = String(probe.numCols[0]);
  const afterSecondPass = type(table, afterAll, firstSource, afterAll[firstSource], quirks);
  const afterManual = type(table, afterAll, String(probe.calcCols[0]), '5', quirks);
  const afterSourceChange = type(table, afterManual, firstSource, probe.afterSourceChange[firstSource], quirks);
  // The probe then put the first figure back and cleared the number columns one by one.
  let cleared = type(table, afterSourceChange, firstSource, probe.afterAll[firstSource], quirks);
  for (const column of probe.numCols) cleared = type(table, cleared, String(column), '', quirks);
  return { table, probe, steps, afterAll, afterSecondPass, afterManual, afterSourceChange, afterClear: cleared };
}

const CALC_TABLES = ['A3b', 'B3b', 'S12c', 'S15b', 'S16b', 'S17', 'S34a', 'S39', 'S41a', 'S43', 'S51a', 'S51c'];

describe('Form 26: the switches for the file\'s accidents', () => {
  it('are set as decision A3 says', () => {
    expect(FORM26_QUIRKS).toEqual({
      chainedCalcUsesFreshValue: true,
      deleteControlOnEveryRowTable: true,
      showAllSchedulesAffectsExport: false,
    });
  });
});

describe('Form 26: numbers', () => {
  it('numv reads a number as the file does; anything else is 0', () => {
    expect(numv('1234.567')).toBe(1234.567);
    expect(numv('-5')).toBe(-5);
    expect(numv('')).toBe(0);
    expect(numv(undefined)).toBe(0);
    expect(numv('Invented')).toBe(0);
    expect(numv('Infinity')).toBe(0);
    expect(numv('1e3')).toBe(1000);
    expect(numv(' 12 ')).toBe(12);
    expect(numv('1,000')).toBe(1);
  });

  it('r2 rounds to two decimals as the file does', () => {
    expect(r2(1000.006)).toBe(1000.01);
    expect(r2(1234.567 * 0.3)).toBe(370.37);
    expect(r2(-234.561)).toBe(-234.56);
    expect(r2(1.005)).toBe(1); // binary floating point, exactly as the file
    expect(r2(0)).toBe(0);
  });

  it('evalExpr: difference, share and excess', () => {
    const row = { '0': '1234.567', '1': '234.561', '2': '', '5': 'x' };
    expect(evalExpr({ op: 'sub', a: '0', b: '1' }, row)).toBe(1234.567 - 234.561);
    expect(evalExpr({ op: 'sub', a: '2', b: '1' }, row)).toBe(-234.561);
    expect(evalExpr({ op: 'scale', a: '0', factor: 0.3 }, row)).toBe(1234.567 * 0.3);
    expect(evalExpr({ op: 'scale', a: '5', factor: 1 }, row)).toBe(0);
    expect(evalExpr({ op: 'excess', a: '0', b: '1', share: 0.3 }, row)).toBe(1234.567 - 0.3 * 234.561);
    expect(evalExpr({ op: 'excess', a: '1', b: '0', share: 0.3 }, row)).toBe(0);
    expect(evalExpr({ op: 'sub', a: '8', b: '9' }, row)).toBe(0);
  });
});

describe('Form 26: calculated columns', () => {
  it('the fixture covers the 13 calculated columns of the definition', () => {
    const inDefinition = DEF.tables.flatMap((table) => table.columns.filter((column) => column.calc).map((column) => `${table.id}.${column.c}`));
    const inFixture = Object.entries(CALC.rowCalc).flatMap(([id, probe]) => probe.calcCols.map((column) => `${id}.${column}`));
    expect(inFixture).toEqual(inDefinition);
    expect(inFixture).toHaveLength(13);
    expect(Object.keys(CALC.rowCalc)).toEqual(CALC_TABLES);
  });

  it('net = increase - decrease', () => {
    for (const id of ['A3b', 'B3b', 'S12c', 'S15b', 'S16b', 'S17']) {
      const table = tableOf(id);
      const row = recalcRow(table, { ...form26BlankRow(table, 0), '2': '1234.567', '3': '234.561' }, '3');
      expect(row['4'], id).toBe('1000.01');
    }
  });

  it('S34a column 4 = c3 - c2; S41a column 2 = max(0, c0 - 0.3 x c1); S43 column 5 = c3 - c4; S51a column 6 = 30% of c5; S51c column 6 = c5', () => {
    expect(recalcRow(tableOf('S34a'), { '2': '1234.567', '3': '234.561', '4': '' }, '3')['4']).toBe('-1000.01');
    expect(recalcRow(tableOf('S41a'), { '0': '1234.567', '1': '234.561', '2': '' }, '1')['2']).toBe('1164.2');
    expect(recalcRow(tableOf('S43'), { '1': '', '2': '', '3': '234.561', '4': '98765.4321', '5': '' }, '4')['5']).toBe('-98530.87');
    expect(recalcRow(tableOf('S51a'), { ...form26BlankRow(tableOf('S51a'), 0), '5': '1234.567' }, '5')['6']).toBe('370.37');
    expect(recalcRow(tableOf('S51c'), { ...form26BlankRow(tableOf('S51c'), 0), '5': '1234.567' }, '5')['6']).toBe('1234.57');
  });

  it('every recorded keystroke of every calculated table gives the file\'s row (the file\'s own order of calculation)', () => {
    for (const id of CALC_TABLES) {
      const run = replay(id, AS_THE_FILE);
      run.probe.steps.forEach((step, index) => {
        const got = run.steps[index];
        if (step.step === 'text only') {
          for (const column of run.probe.calcCols) expect(got[String(column)], `${id} ${step.step}`).toBe('');
        } else {
          expect(pick(got, step.row), `${id} ${step.step}`).toEqual(step.row);
        }
      });
      expect(pick(run.afterAll, run.probe.afterAll), `${id} afterAll`).toEqual(run.probe.afterAll);
      expect(pick(run.afterSecondPass, run.probe.afterSecondPass), `${id} afterSecondPass`).toEqual(run.probe.afterSecondPass);
      expect(pick(run.afterManual, run.probe.afterManual), `${id} afterManual`).toEqual(run.probe.afterManual);
      expect(pick(run.afterSourceChange, run.probe.afterSourceChange), `${id} afterSourceChange`).toEqual(run.probe.afterSourceChange);
      expect(pick(run.afterClear, run.probe.afterClear), `${id} afterClear`).toEqual(run.probe.afterClear);
    }
  });

  it('as built (later column reads the fresh value) every table but S39 behaves exactly as the file', () => {
    for (const id of CALC_TABLES.filter((entry) => entry !== 'S39')) {
      const file = replay(id, AS_THE_FILE);
      const fresh = replay(id, FRESH);
      expect(fresh.steps, id).toEqual(file.steps);
      expect(fresh.afterSecondPass, id).toEqual(file.afterSecondPass);
      expect(fresh.afterManual, id).toEqual(file.afterManual);
      expect(fresh.afterSourceChange, id).toEqual(file.afterSourceChange);
      expect(fresh.afterClear, id).toEqual(file.afterClear);
    }
    // The default of recalcRow is the switch as shipped.
    const table = tableOf('S39');
    const row = { ...form26BlankRow(table, 0), '2': '1234.567' };
    expect(recalcRow(table, row, '2')).toEqual(recalcRow(table, row, '2', FORM26_QUIRKS));
  });

  it('S39: both calculated columns; after column 2 changes to 1235.567 column 6 follows at once', () => {
    const table = tableOf('S39');
    const blank = form26BlankRow(table, 0);

    // As built (decision A3): column 6 reads the column 4 just computed.
    const whole = recalcRow(table, { ...blank, '2': '1234.567', '3': '234.561', '5': '98765.4321' }, '5');
    expect(whole['4']).toBe('1000.01');
    expect(whole['6']).toBe('-97765.42');
    const changed = type(table, whole, '2', '1235.567', FRESH);
    expect(changed['4']).toBe('1001.01');
    expect(changed['6']).toBe('-97764.42');
    expect(type(table, whole, '2', '1235.567', FORM26_QUIRKS)).toEqual(changed);
    // From the very first figure column 6 is right, where the file showed "0" and then "1234.57".
    const first = type(table, blank, '2', '1234.567', FRESH);
    expect([first['4'], first['6']]).toEqual(['1234.57', '1234.57']);
    const second = type(table, first, '3', '234.561', FRESH);
    expect([second['4'], second['6']]).toEqual(['1000.01', '1000.01']);
    expect(replay('S39', FRESH).afterAll).toEqual(whole);

    // With the switch off: the file, one step behind. A hand-typed 5 in column 4, then column 2 changes.
    const file = replay('S39', AS_THE_FILE);
    expect(file.steps[1]['6']).toBe('0');
    expect(file.steps[2]['6']).toBe('1234.57');
    expect(file.afterManual['4']).toBe('5');
    expect(file.afterManual['6']).toBe('-98760.43');
    expect(file.afterSourceChange['4']).toBe('1001.01');
    expect(file.afterSourceChange['6']).toBe('-98760.43');
    // The same keystrokes as built.
    const fresh = replay('S39', FRESH);
    expect(fresh.afterManual['6']).toBe('-98760.43');
    expect(fresh.afterSourceChange['4']).toBe('1001.01');
    expect(fresh.afterSourceChange['6']).toBe('-97764.42');
    expect(fresh.afterClear).toEqual(file.afterClear);
  });

  it('a calculated cell stays blank while every source is blank', () => {
    for (const id of CALC_TABLES) {
      const table = tableOf(id);
      const other = table.columns.find((column) => column.input && !column.calc && !table.columns.some((entry) => entry.calc?.sources.includes(column.c)));
      const row = form26BlankRow(table, 0);
      const typed = other ? type(table, row, other.c, 'Invented', FRESH) : recalcRow(table, row, null, FRESH);
      for (const column of table.columns.filter((entry) => entry.calc)) expect(typed[column.c], `${id}.${column.c}`).toBe('');
    }
  });

  it('the cell being typed in is not overwritten; the next edit of a source replaces it', () => {
    const table = tableOf('A3b');
    const filled = { ...form26BlankRow(table, 0), '2': '1234.567', '3': '234.561', '4': '1000.01' };
    const typed = type(table, filled, '4', '5');
    expect(typed['4']).toBe('5');
    expect(type(table, typed, '5', 'Invented remark')['4']).toBe('1000.01');
    expect(type(table, typed, '2', '1235.567')['4']).toBe('1001.01');
    // With no edited cell (null) every calculated column with a source is set.
    expect(recalcRow(table, typed, null)['4']).toBe('1000.01');
  });

  it('a calculated figure stays when its sources are cleared one by one', () => {
    const table = tableOf('A3b');
    let row: Form26Row = { ...form26BlankRow(table, 0), '2': '1234.567', '3': '234.561', '4': '1000.01' };
    row = type(table, row, '2', '');
    expect(row['4']).toBe('-234.56');
    row = type(table, row, '3', '');
    expect(row['4']).toBe('-234.56');
    expect(CALC.rowCalc.A3b.afterClear['4']).toBe('-234.56');
  });

  it('recalcRow gives a new row and leaves the one it was given alone; a missing cell counts as blank', () => {
    const table = tableOf('S39');
    const given: Form26Row = { '2': '10' };
    const got = recalcRow(table, given, '2');
    expect(given).toEqual({ '2': '10' });
    expect(got).toEqual({ '2': '10', '4': '10', '6': '10' });
    expect(recalcRow(tableOf('S20'), { '3': '7' }, '3')).toEqual({ '3': '7' });
  });
});

describe('Form 26: totals', () => {
  it('totals: every one of the 35 tables gives the file\'s Total cells', () => {
    const withTotals = DEF.tables.filter((table) => table.total).map((table) => table.id);
    expect(Object.keys(CALC.totals)).toEqual(withTotals);
    expect(withTotals).toHaveLength(35);
    let cells = 0;
    for (const id of withTotals) {
      const table = tableOf(id);
      const probe = CALC.totals[id];
      expect(tableTotals(table, probe.rows), id).toEqual(probe.after);
      expect(Object.keys(probe.after), id).toEqual(table.total?.columns);
      // Blank rows as at open: every Total cell blank.
      const blankRows = [form26BlankRow(table, 0), form26BlankRow(table, 1)];
      expect(tableTotals(table, blankRows), id).toEqual(probe.before);
      expect(tableTotals(table, []), id).toEqual(probe.before);
      cells += Object.keys(probe.after).length;
    }
    expect(cells).toBe(62);
    expect(CALC.totals.S39.after).toEqual({ '2': '7,98,765.43', '3': '16,661.01', '4': '7,82,104.43', '5': '10,00,00,829', '6': '-9,92,18,724.57' });
  });

  it('a table without a Total line has no totals', () => {
    expect(tableTotals(tableOf('S11b'), [{ '5': '10', '6': '20' }])).toEqual({});
    expect(tableTotals(tableOf('Dpm'), [{ '0': '10' }])).toEqual({});
  });

  it('zero gives \'\'; -1500000.456 gives \'-15,00,000.46\'; 1234567.891 + 0.005 gives \'12,34,567.9\'', () => {
    const table = tableOf('S20');
    expect(tableTotals(table, [{ '3': '0' }, { '3': '' }])).toEqual(CALC.quirks.totalZero);
    expect(tableTotals(table, [{ '3': '5' }, { '3': '-5' }])).toEqual({ '3': '' });
    expect(tableTotals(table, [{ '3': '-1500000.456' }])).toEqual(CALC.quirks.totalNegative);
    expect(tableTotals(table, [{ '3': '1234567.891' }, { '3': '0.005' }])).toEqual(CALC.quirks.totalIndianFormat);
    expect(formatTotal(0)).toBe('');
    expect(formatTotal(-1500000.456)).toBe('-15,00,000.46');
    expect(formatTotal(1234567.891 + 0.005)).toBe('12,34,567.9');
    expect(formatTotal(100000829)).toBe('10,00,00,829');
    // Blank only when the sum itself is 0, as the file.
    expect(formatTotal(0.001)).toBe('0');
  });

  it('text in an amount cell counts as 0 in the Total', () => {
    expect(tableTotals(tableOf('S20'), [{ '3': 'Invented' }, { '3': '12.5' }])).toEqual({ '3': '12.5' });
  });
});

/** The rows of a depreciation table from one recorded figure per row number and rate column. */
function depRows(table: Form26Table, figure: (rowNo: number, column: number) => string): Form26Row[] {
  if (!table.dep) throw new Error(`${table.id} is not a depreciation table`);
  return table.dep.rows.map((row) => Object.fromEntries(row.cells.map((cell, column) => [cell, figure(row.no, column)])));
}
const depColumn = (table: Form26Table, rows: Form26Row[], column: number): Record<string, string> =>
  Object.fromEntries((table.dep?.rows ?? []).map((row, index) => [String(row.no), rows[index][row.cells[column]]]));

function checkDepreciation(id: 'Dpm' | 'Dot') {
  const table = tableOf(id);
  const probe = CALC.dep[id];
  expect(probe.rates).toEqual(table.dep?.rates);
  expect(probe.cols).toHaveLength(probe.rates.length);
  expect(table.dep?.rows.filter((row) => row.calculated).map((row) => row.no)).toEqual(probe.calcRows);
  expect(table.dep?.formulas.map((formula) => formula.row)).toEqual(probe.calcRows);

  // All rate columns at once: only the figures that were typed go in; the seven calculated rows come out.
  const typed = depRows(table, (rowNo, column) => (probe.inputRows.includes(rowNo) ? probe.cols[column].final[String(rowNo)] : ''));
  const result = recalcDepreciation(table, typed);
  probe.cols.forEach((column) => {
    expect(depColumn(table, result, column.j), `${id} rate ${column.rate} (column ${column.j})`).toEqual(column.final);
  });
  // A second pass changes nothing.
  expect(recalcDepreciation(table, result)).toEqual(result);

  // Each rate column on its own, keystroke by keystroke as recorded.
  for (const column of probe.cols) {
    let rows = depRows(table, () => '');
    for (const step of column.steps) {
      const rowIndex = probe.nos.indexOf(step.set);
      const cell = table.dep?.rows[rowIndex].cells[column.j] ?? '';
      rows = rows.map((row, index) => (index === rowIndex ? { ...row, [cell]: column.final[String(step.set)] } : row));
      rows = recalcDepreciation(table, rows);
      expect(depColumn(table, rows, column.j), `${id} rate ${column.rate} after row ${step.set}`).toEqual(step.col);
    }
    expect(depColumn(table, rows, column.j), `${id} rate ${column.rate}`).toEqual(column.final);
    // The other rate columns stay blank.
    for (const other of probe.cols) {
      if (other.j !== column.j) expect(Object.values(depColumn(table, rows, other.j)).every((cell) => cell === '')).toBe(true);
    }
  }
  return { table, probe, result };
}

describe('Form 26: depreciation', () => {
  it('depreciation, plant and machinery, every rate column', () => {
    const { table, result } = checkDepreciation('Dpm');
    const rate15 = depColumn(table, result, 0);
    expect([rate15['6'], rate15['9'], rate15['10'], rate15['11'], rate15['15'], rate15['17'], rate15['21']]).toEqual([
      '24925.83', '4265.45', '3738.87', '319.91', '4781.11', '-95219.02', '24410.17',
    ]);
  });

  it('depreciation, other assets, every rate column', () => {
    const { table, result } = checkDepreciation('Dot');
    const nil = depColumn(table, result, 0);
    expect(table.dep?.rates[0]).toBe('Nil');
    expect([nil['10'], nil['11'], nil['12'], nil['14'], nil['18']]).toEqual(['0', '0', '0', '-700', '29191.28']);
  });

  it('depreciation: a negative base is floored at 0', () => {
    for (const id of ['Dpm', 'Dot']) {
      const table = tableOf(id);
      const rows = recalcDepreciation(table, depRows(table, (rowNo) => ({ 3: '100', 4: '0', 5: '500' })[rowNo] ?? ''));
      (table.dep?.rates ?? []).forEach((rate, column) => {
        const got = depColumn(table, rows, column);
        expect({ r6: got['6'], r10: got['10'] }, `${id} rate ${rate}`).toEqual(CALC.quirks.depClamp);
      });
    }
  });

  it('depreciation: a figure typed into a calculated row is replaced while its sources have values', () => {
    for (const id of ['Dpm', 'Dot'] as const) {
      const table = tableOf(id);
      const probe = CALC.dep[id];
      const filled = depRows(table, (rowNo, column) => probe.cols[column].final[String(rowNo)]);
      const rowIndex = probe.nos.indexOf(10);
      const cell = table.dep?.rows[rowIndex].cells[0] ?? '';
      const typed = filled.map((row, index) => (index === rowIndex ? { ...row, [cell]: '1' } : row));
      expect(recalcDepreciation(table, typed)[rowIndex][cell], id).toBe(probe.afterManual10);
      expect(recalcDepreciation(table, typed), id).toEqual(filled);
    }
    expect(CALC.dep.Dpm.afterManual10).toBe('3738.87');
  });

  it('depreciation: a calculated row stays as it is while all its source rows are blank', () => {
    const table = tableOf('Dpm');
    const rows = depRows(table, (rowNo, column) => (rowNo === 17 && column === 0 ? '55' : rowNo === 20 ? 'x' : ''));
    expect(recalcDepreciation(table, rows)).toEqual(rows);
  });

  it('depreciation: gives new rows, leaves the given ones alone, and stands on a short list of rows', () => {
    const table = tableOf('Dot');
    const given: Form26Row[] = [{ '1': '1000' }];
    const got = recalcDepreciation(table, given);
    expect(given).toEqual([{ '1': '1000' }]);
    expect(got).toHaveLength(16);
    // Rate 5 (second column): row 6 = 1000, row 10 = 50, row 12 = 50, row 14 = 50, row 18 = 950.
    expect(depColumn(table, got, 1)).toMatchObject({ '3': '1000', '6': '1000', '10': '50', '12': '50', '14': '50', '18': '950' });
    expect(() => recalcDepreciation(tableOf('S20'), [])).toThrow(/S20/);
  });
});
