// Calculated columns, Total lines and the two depreciation tables of Form No. 26, exactly as the
// office's fillable file works them out. Every value is the text a cell holds; nothing here is
// recalculated on load or import (the caller runs these only when a cell is edited).
import type { Form26DepFormula, Form26Expr, Form26Table } from '@/data/taxAuditForm26Types';
import { FORM26_QUIRKS, type Form26Quirks } from '@/lib/taxAuditForm26Quirks';
import { form26BlankRow, type Form26Row } from '@/lib/taxAuditForm26Values';

/** The number a cell holds as the file reads it: the leading number of the text; anything else is 0. */
export function numv(v: string | undefined): number {
  const x = parseFloat(v ?? '');
  return Number.isFinite(x) ? x : 0;
}

/** Rounded to two decimals as the file does. */
export function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function evalExpr(expr: Form26Expr, row: Form26Row): number {
  switch (expr.op) {
    case 'sub':
      return numv(row[expr.a]) - numv(row[expr.b]);
    case 'scale':
      return numv(row[expr.a]) * expr.factor;
    case 'excess':
      return Math.max(0, numv(row[expr.a]) - expr.share * numv(row[expr.b]));
  }
}

const isBlank = (value: string | undefined) => value === undefined || value === '';

/**
 * One row after an edit: each calculated column, left to right, is set to its rounded figure unless
 * it is the cell being typed in (`editedColumn`) or every one of its source cells is blank.
 * Returns a new row; the given row is not changed.
 */
export function recalcRow(
  table: Form26Table,
  row: Form26Row,
  editedColumn: string | null,
  quirks: Form26Quirks = FORM26_QUIRKS,
): Form26Row {
  const next: Form26Row = { ...row };
  // The file reads the row's figures once, before it writes any; a later calculated column then
  // works from the figure an earlier one held before the keystroke.
  const figures = quirks.chainedCalcUsesFreshValue ? next : row;
  for (const column of table.columns) {
    if (!column.calc) continue;
    if (column.c === editedColumn) continue;
    if (column.calc.sources.every((source) => isBlank(next[source]))) continue;
    next[column.c] = String(r2(evalExpr(column.calc.expr, figures)));
  }
  return next;
}

/** A Total cell: blank when the sum is 0; otherwise Indian grouping, at most two decimals, no padding. */
export function formatTotal(sum: number): string {
  return sum ? r2(sum).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
}

/** The Total line of a table: one text per total column; {} for a table without a Total line. */
export function tableTotals(table: Form26Table, rows: Form26Row[]): Record<string, string> {
  const totals: Record<string, string> = {};
  for (const column of table.total?.columns ?? []) {
    let sum = 0;
    for (const row of rows) sum += numv(row[column]);
    totals[column] = formatTotal(sum);
  }
  return totals;
}

type DepRead = (rowNo: number) => number;

/**
 * A depreciation formula of the definition as a function. The definition holds three shapes only:
 * a sum or difference of rows ("r10 + r11", "r15 - r16"), the same floored at 0 ("max(0, r3 + r4 - r5)"),
 * and a row at the column's rate ("r6 * rate / 100"). Anything else is refused.
 */
function depFormula(formula: Form26DepFormula, tableId: string): (get: DepRead, rate: number) => number {
  const refuse = () => new Error(`Form 26 table ${tableId}: unknown depreciation formula "${formula.formula}" for row ${formula.row}`);
  const floored = /^max\(0, (.+)\)$/.exec(formula.formula);
  const body = floored ? floored[1] : formula.formula;

  const atRate = /^r(\d+) \* rate \/ (\d+)$/.exec(body);
  if (atRate) {
    if (floored) throw refuse();
    const rowNo = Number(atRate[1]);
    const divisor = Number(atRate[2]);
    return (get, rate) => (get(rowNo) * rate) / divisor;
  }

  if (!/^r\d+(?: [+-] r\d+)*$/.test(body)) throw refuse();
  const parts = body.split(' ');
  const first = Number(parts[0].slice(1));
  const rest: { sign: 1 | -1; rowNo: number }[] = [];
  for (let i = 1; i < parts.length; i += 2) rest.push({ sign: parts[i] === '-' ? -1 : 1, rowNo: Number(parts[i + 1].slice(1)) });
  return (get) => {
    let sum = get(first);
    for (const term of rest) sum = term.sign === 1 ? sum + get(term.rowNo) : sum - get(term.rowNo);
    return floored ? Math.max(0, sum) : sum;
  };
}

/**
 * A depreciation table after an edit: for every rate column the table's formulas in order, each one
 * skipped while all its source rows are blank. There is no exception for the cell being typed in.
 * Rate "Nil" is 0. Returns new rows (one per row of the table); the given rows are not changed.
 */
export function recalcDepreciation(table: Form26Table, rows: Form26Row[]): Form26Row[] {
  const dep = table.dep;
  if (!dep) throw new Error(`Form 26 table ${table.id} is not a depreciation table`);
  const next = rows.map((row) => ({ ...row }));
  while (next.length < dep.rows.length) next.push(form26BlankRow(table, next.length));

  const indexOfRow = new Map(dep.rows.map((row, index) => [row.no, index]));
  const formulas = dep.formulas.map((formula) => ({ formula, run: depFormula(formula, table.id) }));

  dep.rates.forEach((rateText, column) => {
    const rate = parseFloat(rateText) || 0;
    const cell = (rowNo: number): { rowIndex: number; key: string } => {
      const rowIndex = indexOfRow.get(rowNo);
      if (rowIndex === undefined) throw new Error(`Form 26 table ${table.id} has no row ${rowNo}`);
      return { rowIndex, key: dep.rows[rowIndex].cells[column] };
    };
    const text = (rowNo: number) => {
      const at = cell(rowNo);
      return next[at.rowIndex][at.key];
    };
    const get: DepRead = (rowNo) => numv(text(rowNo));
    for (const { formula, run } of formulas) {
      if (formula.sources.every((source) => isBlank(text(source)))) continue;
      const at = cell(formula.row);
      next[at.rowIndex][at.key] = String(r2(run(get, rate)));
    }
  });
  return next;
}
