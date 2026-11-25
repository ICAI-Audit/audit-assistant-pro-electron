// How a Form No. 26 table and a question row are laid out in the room the clause editor has, and the
// small decisions of a row list: which columns sum a row up, what a row's state reads, what Enter does
// and what is announced. Nothing ever scrolls sideways: a table that does not fit is drawn as a list of
// rows (one open at a time as a small form), a depreciation table as one rate column at a time.
import type { Form26Column, Form26ColumnType, Form26Table } from '@/data/taxAuditForm26Types';
import { FORM26_TABLE_MAX_ROWS, hasDeleteControl, rowState } from '@/lib/taxAuditForm26TableOps';
import type { Form26Row } from '@/lib/taxAuditForm26Values';

export type Form26TableLayout = 'table' | 'rowlist' | 'blocks';

/** The narrowest a column can be and still show its heading and figures whole. */
export const FORM26_MIN_COLUMN_PX: Record<Form26ColumnType, number> = { sl: 56, s: 120, text: 140, num: 112, calc: 112, date: 136, yn: 88, sel: 160, ta: 200 };
/** Depreciation: Row | Block of assets | one cell per rate column. */
export const FORM26_DEP_MIN_PX = { row: 40, label: 220, cell: 104 } as const;
/** The column that holds a row's delete control. */
export const FORM26_ROW_ACTION_PX = 40;
/** Below this width a question row puts its answer under its wording instead of beside it. */
export const FORM26_QUESTION_COLUMNS_MIN_PX = 560;

/** The width a table needs to show every column at its minimum. */
export function tableMinWidth(table: Form26Table): number {
  if (table.dep) return FORM26_DEP_MIN_PX.row + FORM26_DEP_MIN_PX.label + table.dep.rates.length * FORM26_DEP_MIN_PX.cell;
  const columns = table.columns.reduce((sum, column) => sum + FORM26_MIN_COLUMN_PX[column.type], 0);
  return columns + (hasDeleteControl(table) ? FORM26_ROW_ACTION_PX : 0);
}

/** A table when every column gets its minimum width; otherwise a row list (a depreciation table: blocks). */
export function chooseTableLayout(table: Form26Table, availablePx: number): Form26TableLayout {
  if (tableMinWidth(table) <= availablePx) return 'table';
  return table.dep ? 'blocks' : 'rowlist';
}

/** The columns that sum a row up in a row list: the first three that take input and are not optional. */
export function rowListSummaryColumns(table: Form26Table): string[] {
  return table.columns.filter((column) => column.input && !column.optional).slice(0, 3).map((column) => column.c);
}

/** A column's heading in full: a heading under a group heading reads "Group › Heading". */
export function columnFullHeading(column: Form26Column): string {
  return column.headerPath && column.headerPath.length > 0 ? column.headerPath.join(' › ') : column.header;
}

/** The heading a row list shows over a summing-up column: its letter and full heading, "(B) Nature of …". */
export function rowListHeading(column: Form26Column): string {
  return `${column.letter ? `${column.letter} ` : ''}${columnFullHeading(column)}`;
}

/** The width allowed per character of a row list's heading (12 px semibold; generous, so a word always fits). */
export const FORM26_HEADING_CHAR_PX = 7.5;

/**
 * The widest piece of a heading that a line cannot break, in px: a word, or the part of a word up to a "/" or
 * a "-" (a line may break after those, between words). A column narrower than this would break a word inside
 * itself ("transactio n", seen in the running app at 1280 x 720).
 */
export function headingWordPx(text: string): number {
  const pieces = text.split(/\s+/).flatMap((word) => word.split(/(?<=[/-])/));
  return Math.max(0, ...pieces.map((piece) => piece.length)) * FORM26_HEADING_CHAR_PX;
}

// A row list's line: serial (2.75rem), the summing-up columns, the row's state (4.75rem: "Complete", "16 to
// fill"), its chevron (1rem), side padding (2 x 8 px), the gaps (8 px) and the delete column (w-9) when shown.
const ROW_LINE_SERIAL_PX = 44;
const ROW_LINE_STATE_PX = 76;
const ROW_LINE_CHEVRON_PX = 16;
const ROW_LINE_GAP_PX = 8;
const ROW_LINE_DELETE_PX = 36;
/** What a row list's line takes besides its summing-up columns (with the delete column and two gaps). */
export const FORM26_ROW_LINE_FIXED_PX = ROW_LINE_SERIAL_PX + ROW_LINE_STATE_PX + ROW_LINE_CHEVRON_PX + 16 + 2 * ROW_LINE_GAP_PX + ROW_LINE_DELETE_PX;
/** The narrowest a summing-up column is drawn, so that its values (a PAN, an amount) read whole. */
export const FORM26_ROW_LINE_MIN_COLUMN_PX = 96;

/**
 * How many summing-up columns a row list's line shows in the room it has: as many of `headings` (in order)
 * as can each have at least the floor and the widest word of their heading; none when not even one can (the
 * line then shows its number and its state). Seen in the running app at 1280 x 720 with the right pane open:
 * three columns in about 330 px squeezed each heading to a letter a line; one column of ~70 px still broke
 * "transaction" inside the word.
 */
export function rowListSummaryCount(roomPx: number, headings: readonly string[], withDeleteColumn: boolean, fixedRows = false): number {
  // A fixed row's line has no number column (its labels stand on a line of their own above the values).
  const room = roomPx - FORM26_ROW_LINE_FIXED_PX + (withDeleteColumn ? 0 : ROW_LINE_DELETE_PX) + (fixedRows ? ROW_LINE_SERIAL_PX + ROW_LINE_GAP_PX : 0);
  for (let count = headings.length; count > 0; count -= 1) {
    const width = (room - count * ROW_LINE_GAP_PX) / count;
    if (headings.slice(0, count).every((heading) => width >= Math.max(FORM26_ROW_LINE_MIN_COLUMN_PX, headingWordPx(heading)))) return count;
  }
  return 0;
}

/**
 * The grid of a row list's line (header and rows alike) for `count` summing-up columns. A fixed table's line has
 * no number column: with summing-up columns its row's labels take the whole first line of the grid, above the
 * values; with none the labels take the room beside the state (FIX-T29 D1).
 */
export function rowListTemplate(count: number, fixedRows = false): string {
  if (fixedRows) return count > 0 ? `repeat(${count}, minmax(0, 1fr)) 4.75rem 1rem` : 'minmax(0, 1fr) 4.75rem 1rem';
  return count > 0 ? `2.75rem repeat(${count}, minmax(0, 1fr)) 4.75rem 1rem` : '2.75rem minmax(0, 1fr) 1rem';
}

/** A fixed row's pre-printed labels exactly as the definition holds them ("(i)", "Total turnover"); [] for any other row. */
export function rowListLabels(table: Form26Table, r: number): string[] {
  return table.dep ? [] : (table.fixedRows?.[r] ?? []);
}

/** What a row of a row list is called: a fixed row by its labels ("(i) Total turnover"), another by its number ("Row 2"). */
export function rowListRowName(table: Form26Table, r: number): string {
  const labels = rowListLabels(table, r);
  return labels.length > 0 ? labels.join(' ') : `Row ${r + 1}`;
}

/** Whether a table draws its delete column: only where a row can be deleted now (a locked table keeps no empty column). */
export function showsDeleteColumn(table: Form26Table, locked: boolean): boolean {
  return !locked && hasDeleteControl(table);
}

/** The rate columns of a depreciation table by letter, block of assets and rate, e.g. "(iii) Building (not including land) · 10%". */
export function depreciationColumnLabels(table: Form26Table): string[] {
  const dep = table.dep;
  if (!dep) throw new Error(`Form 26 table ${table.id} is not a depreciation table`);
  const blockOf: string[] = [];
  for (const group of dep.columnGroups) for (let i = 0; i < group.span; i += 1) blockOf.push(group.text);
  return dep.rates.map((rate, column) => {
    const shownRate = /^\d+(\.\d+)?$/.test(rate) ? `${rate}%` : rate;
    return `${dep.columnLetters[column] ?? ''} ${blockOf[column] ?? ''} · ${shownRate}`.trim();
  });
}

/**
 * The name of a cell's control: its column letter and full heading with its row; a fixed row by its own
 * text ("(C) Tax year, (ii) Gross profit/Turnover"); a depreciation cell by its row and rate column.
 * Throws for a column the table does not have.
 */
export function cellAccessibleName(table: Form26Table, columnKey: string, r: number): string {
  if (table.dep) {
    const row = table.dep.rows[r];
    const column = row ? row.cells.indexOf(columnKey) : -1;
    if (!row || column < 0) throw new Error(`Form 26 table ${table.id} has no cell ${columnKey} in row ${r}`);
    return `${row.no}. ${row.label}, ${depreciationColumnLabels(table)[column]}`;
  }
  const column = table.columns.find((entry) => entry.c === columnKey);
  if (!column) throw new Error(`Form 26 table ${table.id} has no column ${columnKey}`);
  const heading = `${column.letter ? `${column.letter} ` : ''}${columnFullHeading(column)}`;
  const fixed = table.fixedRows?.[r];
  return fixed ? `${heading}, ${fixed.join(' ')}` : `${heading}, row ${r + 1}`;
}

// Whole digits grouped the Indian way, exactly (no rounding of long figures).
const groupIndian = (digits: string) => BigInt(digits).toLocaleString('en-IN');

/** A cell's value as a row list sums a row up: amounts with Indian grouping (decimals as typed), dates as dd/mm/yyyy. */
export function summaryValue(column: Form26Column, text: string): string {
  const value = text ?? '';
  if ((column.type === 'num' || column.type === 'calc') && /^-?\d+(\.\d+)?$/.test(value)) {
    const negative = value.startsWith('-');
    const [whole, decimals] = value.replace('-', '').split('.');
    return `${negative ? '-' : ''}${groupIndian(whole)}${decimals !== undefined ? `.${decimals}` : ''}`;
  }
  if (column.type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return value;
}

/** The row a row list opens with: the first that has cells to fill, else the first empty one, else none. */
export function rowListInitialOpen(states: { filled: boolean; toFill: number }[]): number | null {
  const toFill = states.findIndex((state) => state.filled && state.toFill > 0);
  if (toFill >= 0) return toFill;
  const empty = states.findIndex((state) => !state.filled);
  return empty >= 0 ? empty : null;
}

/** The name of a row's open/close button in a row list: "Row 2: Loan; Invented Lender. 5 to fill"; a fixed row by its labels. */
export function rowListToggleLabel(table: Form26Table, row: Form26Row, r: number): string {
  const values = rowListSummaryColumns(table)
    .map((key) => {
      const column = table.columns.find((entry) => entry.c === key);
      return column ? summaryValue(column, row[key] ?? '') : '';
    })
    .filter((value) => value !== '');
  const state = rowStateText(rowState(table, row));
  const name = rowListRowName(table, r);
  return values.length > 0 ? `${name}: ${values.join('; ')}. ${state}` : `${name}. ${state}`;
}

/** Arrow keys move along a row of choices (wrapping), Home and End go to its ends; any other key: null. */
export function segmentKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** What a row of a row list says about itself. */
export function rowStateText(state: { filled: boolean; toFill: number }): string {
  if (!state.filled) return 'Empty';
  return state.toFill === 0 ? 'Complete' : `${state.toFill} to fill`;
}

/**
 * Enter in a field of an open row: in the last field of the last row a new row is added and opened; in
 * the last field of another row the next row opens. A long text box keeps Enter for a new line.
 */
export function rowListEnterAction(input: {
  fieldIndex: number;
  fieldCount: number;
  rowIndex: number;
  rowCount: number;
  canAdd: boolean;
  multiline: boolean;
}): 'add-row' | 'next-row' | 'none' {
  if (input.multiline || input.fieldIndex !== input.fieldCount - 1) return 'none';
  if (input.rowIndex < input.rowCount - 1) return 'next-row';
  return input.canAdd ? 'add-row' : 'none';
}

/** What a full table says beside "Add row". */
export function rowLimitText(): string {
  return `A table can hold at most ${FORM26_TABLE_MAX_ROWS.toLocaleString('en-IN')} rows.`;
}

/** The sentence a table announces after a row is added, deleted or cleared (rows numbered from 1). */
export function tableAnnouncement(what: 'added' | 'deleted' | 'cleared', rowNumber: number): string {
  return `Row ${rowNumber} ${what}.`;
}

/** A table's own frame (its border), and a schedule's frame around its tables (border and padding). */
export const FORM26_TABLE_FRAME_PX = 2;
export const FORM26_SCHEDULE_FRAME_PX = 18;

/** The room a table has in a clause editor whose content is `editorPx` wide. */
export function tableRoom(editorPx: number, inSchedule: boolean): number {
  return editorPx - FORM26_TABLE_FRAME_PX - (inSchedule ? FORM26_SCHEDULE_FRAME_PX : 0);
}

/** A question row: number | wording | answer side by side when there is room, else the answer under the wording. */
export function questionLayout(availablePx: number): 'columns' | 'stacked' {
  return availablePx >= FORM26_QUESTION_COLUMNS_MIN_PX ? 'columns' : 'stacked';
}
