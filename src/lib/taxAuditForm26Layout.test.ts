import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import type { Form26Table } from '@/data/taxAuditForm26Types';
import {
  cellAccessibleName,
  chooseTableLayout,
  columnFullHeading,
  depreciationColumnLabels,
  FORM26_DEP_MIN_PX,
  FORM26_MIN_COLUMN_PX,
  FORM26_QUESTION_COLUMNS_MIN_PX,
  FORM26_HEADING_CHAR_PX,
  FORM26_ROW_ACTION_PX,
  FORM26_ROW_LINE_FIXED_PX,
  FORM26_ROW_LINE_MIN_COLUMN_PX,
  headingWordPx,
  questionLayout,
  rowListEnterAction,
  rowListHeading,
  rowListInitialOpen,
  rowListLabels,
  rowListRowName,
  rowListSummaryColumns,
  rowListSummaryCount,
  rowListTemplate,
  showsDeleteColumn,
  rowLimitText,
  rowListToggleLabel,
  rowStateText,
  segmentKeyTarget,
  summaryValue,
  tableAnnouncement,
  tableMinWidth,
  tableRoom,
} from '@/lib/taxAuditForm26Layout';

const table = (id: string): Form26Table => {
  const found = DEF.tables.find((entry) => entry.id === id);
  if (!found) throw new Error(`no table ${id}`);
  return found;
};

describe('Form 26 table layout by room', () => {
  it('the minimum widths of the plan', () => {
    expect(FORM26_MIN_COLUMN_PX).toEqual({ sl: 56, s: 120, text: 140, num: 112, calc: 112, date: 136, yn: 88, sel: 160, ta: 200 });
    expect(FORM26_DEP_MIN_PX).toEqual({ row: 40, label: 220, cell: 104 });
    expect(FORM26_ROW_ACTION_PX).toBe(40);
  });

  it('at 730 px S28 (4 columns) is a table; S45a (10 columns), S47 (13), S50a (10) are row lists', () => {
    expect(table('S28').columns).toHaveLength(4);
    expect(chooseTableLayout(table('S28'), 730)).toBe('table');
    expect(table('S45a').columns).toHaveLength(10);
    expect(chooseTableLayout(table('S45a'), 730)).toBe('rowlist');
    expect(table('S47').columns).toHaveLength(13);
    expect(chooseTableLayout(table('S47'), 730)).toBe('rowlist');
    expect(table('S50a').columns).toHaveLength(10);
    expect(chooseTableLayout(table('S50a'), 730)).toBe('rowlist');
  });

  it('at 420 px (right pane open) S15b (6 columns) is a row list; at 730 px it is a table', () => {
    expect(table('S15b').columns).toHaveLength(6);
    expect(chooseTableLayout(table('S15b'), 420)).toBe('rowlist');
    expect(chooseTableLayout(table('S15b'), 730)).toBe('table');
  });

  it('Dpm (4 rate columns) is a table at 730 px, Dot (7) is blocks at 730 px', () => {
    expect(table('Dpm').dep?.rates).toHaveLength(4);
    expect(chooseTableLayout(table('Dpm'), 730)).toBe('table');
    expect(table('Dot').dep?.rates).toHaveLength(7);
    expect(chooseTableLayout(table('Dot'), 730)).toBe('blocks');
    expect(chooseTableLayout(table('Dot'), 2000)).toBe('table');
  });

  it('a table exactly when every column gets its minimum width (the delete column included)', () => {
    // S28: Sl. No. 56 + text 140 + text 140 + num 112, and the delete column 40.
    expect(tableMinWidth(table('S28'))).toBe(56 + 140 + 140 + 112 + 40);
    expect(chooseTableLayout(table('S28'), 488)).toBe('table');
    expect(chooseTableLayout(table('S28'), 487)).toBe('rowlist');
    // A fixed table has no delete column.
    expect(tableMinWidth(table('P12d'))).toBe(120 + 120 + 112 + 112);
    // S38 has no serial column; it still gets a delete column (decision A3).
    expect(tableMinWidth(table('S38'))).toBe(table('S38').columns.reduce((sum, column) => sum + FORM26_MIN_COLUMN_PX[column.type], 0) + 40);
    // Depreciation: Row 40 + label 220 + 104 per rate column.
    expect(tableMinWidth(table('Dpm'))).toBe(40 + 220 + 4 * 104);
    expect(tableMinWidth(table('Dot'))).toBe(40 + 220 + 7 * 104);
    // Never anything that scrolls sideways: every table has a layout at any width.
    for (const entry of DEF.tables) {
      expect(['rowlist', 'blocks']).toContain(chooseTableLayout(entry, 100));
      expect(chooseTableLayout(entry, 4000)).toBe('table');
    }
  });

  it('rowListSummaryColumns: the first three input columns that are not optional', () => {
    expect(rowListSummaryColumns(table('S45a'))).toEqual(['1', '2', '3']);
    expect(rowListSummaryColumns(table('S30'))).toEqual(['1', '2', '3']);
    expect(rowListSummaryColumns(table('A3b'))).toEqual(['2', '3', '4']);
    expect(rowListSummaryColumns(table('P14a'))).toEqual(['1', '2']);
    expect(rowListSummaryColumns(table('S50a'))).toEqual(['0', '1', '2']);
  });

  it('headingWordPx: the widest piece of a heading a line cannot break (a word, or a part of one up to "/" or "-") (POLISH-1)', () => {
    expect(headingWordPx('(B) Nature of transaction (Loan/ Deposit/ Specified sum)')).toBe(11 * FORM26_HEADING_CHAR_PX);
    expect(headingWordPx('Registration/Identification')).toBe(14 * FORM26_HEADING_CHAR_PX);
    expect(headingWordPx('[non-deduction/')).toBe(10 * FORM26_HEADING_CHAR_PX);
    expect(headingWordPx('')).toBe(0);
    expect(rowListHeading(table('S45a').columns[1])).toBe('(B) Nature of transaction (Loan/ Deposit/ Specified sum)');
    expect(rowListHeading(table('S53a').columns[3])).toBe('(D) Opening Stock › Quantity');
  });

  it('rowListSummaryCount: as many summing-up columns as the room holds with every heading word whole; none when not even one fits (task 20, POLISH-1)', () => {
    const headings = (id: string) => rowListSummaryColumns(table(id)).map((key) => rowListHeading(table(id).columns.find((column) => column.c === key)!));
    // 1280 x 720 with the right pane open: the editor gives a schedule's table about 326 px. "transaction"
    // was broken inside the word ("transactio n") in the ~70 px the old fixed widths left: now one column of 116 px.
    expect(rowListSummaryCount(326, headings('S45a'), true)).toBe(1);
    expect(rowListSummaryCount(460, headings('S45a'), true)).toBe(2);
    expect(rowListSummaryCount(700, headings('S45a'), true)).toBe(3);
    expect(rowListSummaryCount(Number.POSITIVE_INFINITY, headings('S45a'), true)).toBe(3);
    expect(rowListSummaryCount(700, headings('P14a'), true)).toBe(2);
    expect(rowListSummaryCount(150, headings('S45a'), true)).toBe(0);
    // Without the delete column (a locked table, or a table of fixed rows) the line has 44 px more.
    const tight = FORM26_ROW_LINE_FIXED_PX + 8 + FORM26_ROW_LINE_MIN_COLUMN_PX - 1;
    expect(rowListSummaryCount(tight, ['x'], true)).toBe(0);
    expect(rowListSummaryCount(tight, ['x'], false)).toBe(1);
    // Every table that can be a row list, at every room from 200 to 1,400 px: each column shown is at least as
    // wide as the widest word of its heading (and as the floor for values), and one more column would not be.
    const wrong: string[] = [];
    for (const entry of DEF.tables.filter((item) => !item.dep)) {
      const list = headings(entry.id);
      const needs = list.map((heading) => Math.max(FORM26_ROW_LINE_MIN_COLUMN_PX, headingWordPx(heading)));
      for (const withDelete of [true, false]) {
        for (let room = 200; room <= 1400; room += 4) {
          const count = rowListSummaryCount(room, list, withDelete);
          const width = (shown: number) => (room - FORM26_ROW_LINE_FIXED_PX + (withDelete ? 0 : 36) - shown * 8) / shown;
          const fits = (shown: number) => needs.slice(0, shown).every((need) => width(shown) >= need);
          if (count > 0 && !fits(count)) wrong.push(`${entry.id} at ${room}: ${count} do not fit`);
          if (count < list.length && fits(count + 1)) wrong.push(`${entry.id} at ${room}: ${count + 1} would fit`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('rowListTemplate: serial, the summing-up columns, the row state and the chevron; with no summing-up column the state takes the room (POLISH-1)', () => {
    expect(rowListTemplate(1)).toBe('2.75rem repeat(1, minmax(0, 1fr)) 4.75rem 1rem');
    expect(rowListTemplate(3)).toBe('2.75rem repeat(3, minmax(0, 1fr)) 4.75rem 1rem');
    expect(rowListTemplate(0)).toBe('2.75rem minmax(0, 1fr) 1rem');
  });

  it('showsDeleteColumn: only where a row can be deleted now; a locked table reserves no room for it (POLISH-1)', () => {
    expect(showsDeleteColumn(table('S28'), false)).toBe(true);
    expect(showsDeleteColumn(table('S28'), true)).toBe(false);
    expect(showsDeleteColumn(table('P12d'), false)).toBe(false);
  });

  it('a field of an open row is labelled with the full heading; depreciation rate columns by block and rate', () => {
    const s53a = table('S53a');
    expect(columnFullHeading(s53a.columns[3])).toBe('Opening Stock › Quantity');
    expect(columnFullHeading(table('S45a').columns[1])).toBe('Nature of transaction (Loan/ Deposit/ Specified sum)');
    expect(depreciationColumnLabels(table('Dpm'))).toEqual([
      '(i) Plant and machinery · 15%',
      '(ii) Plant and machinery · 30%',
      '(iii) Plant and machinery · 40%',
      '(iv) Plant and machinery · 45%',
    ]);
    expect(depreciationColumnLabels(table('Dot'))).toEqual([
      '(i) Land · Nil',
      '(ii) Building (not including land) · 5%',
      '(iii) Building (not including land) · 10%',
      '(iv) Building (not including land) · 40%',
      '(v) Furniture and fittings · 10%',
      '(vi) Intangible assets · 25%',
      '(vii) Ships · 20%',
    ]);
    expect(() => depreciationColumnLabels(table('S28'))).toThrow();
  });

  it('a row of a row list says where it stands', () => {
    expect(rowStateText({ filled: true, toFill: 0 })).toBe('Complete');
    expect(rowStateText({ filled: true, toFill: 1 })).toBe('1 to fill');
    expect(rowStateText({ filled: true, toFill: 4 })).toBe('4 to fill');
    expect(rowStateText({ filled: false, toFill: 0 })).toBe('Empty');
  });

  it('Enter in the last field of the last row adds a row and opens it; in the last field of another row it opens the next row; a long text box keeps Enter', () => {
    expect(rowListEnterAction({ fieldIndex: 4, fieldCount: 5, rowIndex: 1, rowCount: 2, canAdd: true, multiline: false })).toBe('add-row');
    expect(rowListEnterAction({ fieldIndex: 4, fieldCount: 5, rowIndex: 0, rowCount: 2, canAdd: true, multiline: false })).toBe('next-row');
    expect(rowListEnterAction({ fieldIndex: 2, fieldCount: 5, rowIndex: 1, rowCount: 2, canAdd: true, multiline: false })).toBe('none');
    expect(rowListEnterAction({ fieldIndex: 4, fieldCount: 5, rowIndex: 1, rowCount: 2, canAdd: true, multiline: true })).toBe('none');
    expect(rowListEnterAction({ fieldIndex: 4, fieldCount: 5, rowIndex: 4, rowCount: 5, canAdd: false, multiline: false })).toBe('none');
  });

  it('what a full table says beside "Add row"', () => {
    expect(rowLimitText()).toBe('A table can hold at most 5,000 rows.');
  });

  it('what a table announces', () => {
    expect(tableAnnouncement('added', 3)).toBe('Row 3 added.');
    expect(tableAnnouncement('deleted', 2)).toBe('Row 2 deleted.');
    expect(tableAnnouncement('cleared', 1)).toBe('Row 1 cleared.');
  });

  it('every cell has a name: letter and full heading with its row (a fixed row by its own text; a depreciation cell by row and rate)', () => {
    expect(cellAccessibleName(table('S28'), '1', 0)).toBe('(B) Law under which penalty levied, row 1');
    expect(cellAccessibleName(table('S53a'), '3', 4)).toBe('(D) Opening Stock › Quantity, row 5');
    expect(cellAccessibleName(table('P14a'), '2', 0)).toBe('List of books of account maintained at such address, row 1');
    expect(cellAccessibleName(table('P12d'), '2', 1)).toBe('(C) Tax year, (ii) Gross profit/Turnover');
    expect(cellAccessibleName(table('Dpm'), '61', 3)).toBe('6. Amount on which depreciation at full rate to be allowed (3 + 4 - 5) (enter 0, if result is negative), (ii) Plant and machinery · 30%');
    expect(() => cellAccessibleName(table('S28'), '9', 0)).toThrow();
  });

  it('a row list sums a row up in plain figures: amounts grouped the Indian way with the typed decimals, dates as dd/mm/yyyy', () => {
    const s30 = table('S30');
    expect(summaryValue(s30.columns[3], '1500000.5')).toBe('15,00,000.5');
    expect(summaryValue(s30.columns[3], '-1234567')).toBe('-12,34,567');
    expect(summaryValue(s30.columns[3], '12abc')).toBe('12abc');
    expect(summaryValue(s30.columns[3], '123456789012345678.25')).toBe('1,23,45,67,89,01,23,45,678.25');
    expect(summaryValue(s30.columns[1], '2026-05-01')).toBe('01/05/2026');
    expect(summaryValue(s30.columns[2], 'Invented payment')).toBe('Invented payment');
    expect(summaryValue(s30.columns[1], '')).toBe('');
  });

  it('the row a row list opens with: the first with cells to fill, else the first empty one, else none', () => {
    expect(rowListInitialOpen([{ filled: true, toFill: 0 }, { filled: true, toFill: 2 }, { filled: false, toFill: 0 }])).toBe(1);
    expect(rowListInitialOpen([{ filled: true, toFill: 0 }, { filled: false, toFill: 0 }])).toBe(1);
    expect(rowListInitialOpen([{ filled: true, toFill: 0 }])).toBeNull();
  });

  it('a row of a row list is named by its number, its summing-up values and its state', () => {
    const s45a = table('S45a');
    expect(rowListToggleLabel(s45a, { '1': 'Loan', '2': 'Invented Lender', '3': '', '4': '', '5': '250000', '6': '', '7': '', '8': '', '9': '' }, 1)).toBe(
      'Row 2: Loan; Invented Lender. 5 to fill',
    );
    expect(rowListToggleLabel(s45a, { '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': '' }, 0)).toBe('Row 1. Empty');
  });

  it('arrow keys move along the rate columns of a depreciation table (Home and End to the ends); other keys do nothing', () => {
    expect(segmentKeyTarget('ArrowRight', 0, 7)).toBe(1);
    expect(segmentKeyTarget('ArrowRight', 6, 7)).toBe(0);
    expect(segmentKeyTarget('ArrowLeft', 0, 7)).toBe(6);
    expect(segmentKeyTarget('Home', 4, 7)).toBe(0);
    expect(segmentKeyTarget('End', 1, 7)).toBe(6);
    expect(segmentKeyTarget('Enter', 1, 7)).toBeNull();
  });

  it('the room a table has: the clause editor\'s width less the table\'s frame, and the schedule\'s frame for a table in a schedule', () => {
    expect(tableRoom(732, false)).toBe(730);
    expect(tableRoom(750, true)).toBe(730);
    expect(chooseTableLayout(table('S28'), tableRoom(490, false))).toBe('table');
    expect(chooseTableLayout(table('S28'), tableRoom(490, true))).toBe('rowlist');
  });

  it('question rows: three columns when the clause has room, otherwise the answer under its wording', () => {
    expect(FORM26_QUESTION_COLUMNS_MIN_PX).toBe(560);
    expect(questionLayout(560)).toBe('columns');
    expect(questionLayout(559)).toBe('stacked');
    expect(questionLayout(372)).toBe('stacked');
  });
});

// FIX-T29 D1: a fixed table drawn as a row list showed only "1, 2, 3 … Empty" (seen at 1280 x 720 on 12(d), 16(b),
// 20, 17, 18, 27, 34): the row's own pre-printed labels must be on its line and at the top of the open row.
describe('Form 26 row lists of fixed tables (FIX-T29 D1)', () => {
  const fixedTables = DEF.tables.filter((entry) => entry.fixedRows !== undefined);

  it('the definition: 11 fixed tables, every fixed row holding its labels (none blank), one label per pre-printed column', () => {
    expect(fixedTables.map((entry) => entry.id)).toEqual(['P12d', 'S16b', 'S17', 'S18', 'S20', 'S27a', 'S27c', 'S27d', 'S34a', 'S34b', 'S52b']);
    for (const entry of fixedTables) {
      const printed = entry.columns.filter((column) => column.type === 's').length;
      expect(entry.fixedRows?.length, entry.id).toBe(entry.startRows);
      for (const labels of entry.fixedRows ?? []) {
        expect(labels.length, entry.id).toBe(printed);
        for (const label of labels) expect(label.trim(), entry.id).not.toBe('');
      }
    }
    expect(DEF.tables.filter((entry) => entry.kind === 'fixed').map((entry) => entry.id)).toEqual(fixedTables.map((entry) => entry.id));
  });

  it('rowListLabels: EVERY fixed row of EVERY fixed table gives its labels exactly as the definition holds them; a row of added rows none', () => {
    let rows = 0;
    for (const entry of fixedTables) {
      (entry.fixedRows ?? []).forEach((labels, r) => {
        expect(rowListLabels(entry, r), `${entry.id} row ${r}`).toEqual(labels);
        rows += 1;
      });
    }
    expect(rows).toBe(93);
    expect(rowListLabels(table('S45a'), 0)).toEqual([]);
    expect(rowListLabels(table('P12d'), 5)).toEqual([]);
  });

  it('a fixed row is named by its labels (the open row and its line), a row of added rows by its number', () => {
    expect(rowListRowName(table('P12d'), 0)).toBe('(i) Total turnover');
    expect(rowListRowName(table('S20'), 0)).toBe('(i) 2(40)(e) Deemed dividend');
    expect(rowListRowName(table('S16b'), 0)).toBe('(i) 277(1)(i)');
    expect(rowListRowName(table('S52b'), 0)).toBe('Expenditure relating to entities registered under GST');
    expect(rowListRowName(table('S45a'), 1)).toBe('Row 2');
    const p12d = table('P12d');
    expect(rowListToggleLabel(p12d, { '2': '500000', '3': '' }, 0)).toBe('(i) Total turnover: 5,00,000. 1 to fill');
    expect(rowListToggleLabel(p12d, { '2': '', '3': '' }, 1)).toBe('(ii) Gross profit/Turnover. Empty');
    for (const entry of fixedTables) {
      (entry.fixedRows ?? []).forEach((labels, r) => expect(rowListToggleLabel(entry, {}, r).startsWith(labels.join(' '))).toBe(true));
    }
  });

  it('the line of a fixed row has no number column: with summing-up columns its labels take a line of their own above them; with none they share the line with the state', () => {
    expect(rowListTemplate(2, true)).toBe('repeat(2, minmax(0, 1fr)) 4.75rem 1rem');
    expect(rowListTemplate(0, true)).toBe('minmax(0, 1fr) 4.75rem 1rem');
    // No number column on the line: the room of that column goes to the summing-up columns.
    // Without the delete column the line holds the serial (44 px) and one gap (8 px) besides each column; a
    // fixed row's line has no serial, so 52 px more room: just enough for one column of the 96 px floor here.
    const room = FORM26_ROW_LINE_FIXED_PX - 36 + 8 + FORM26_ROW_LINE_MIN_COLUMN_PX - 52;
    expect(rowListSummaryCount(room, ['x'], false, true)).toBe(1);
    expect(rowListSummaryCount(room, ['x'], false, false)).toBe(0);
    expect(rowListSummaryCount(room, ['x'], false)).toBe(0);
  });
});
