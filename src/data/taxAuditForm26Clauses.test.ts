import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import {
  FORM26_ALL_ROW_KEYS,
  FORM26_CLAUSE_UNITS,
  FORM26_LIST_GROUPS,
  form26ClauseKeyOfField,
  form26ClauseKeyOfSchedule,
  form26ClauseKeyOfTable,
  form26TableRowKey,
} from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  TAX_AUDIT_FORM26_CLAUSE_PREFIX,
  TAX_AUDIT_FORM26_STATUTORY_VERSION,
  TAX_AUDIT_FORM26_WORKPAPER_PREFIX,
} from '@/data/taxAuditForm26Version';

type Frozen = {
  statutoryVersion: string;
  rowKeys: string[];
  fieldKeys: string[];
  tableIds: string[];
  columnKeys: Record<string, string[]>;
};

const FROZEN = JSON.parse(readFileSync(new URL('./taxAuditForm26Clauses.frozen.json', import.meta.url), 'utf8')) as Frozen;

const unit = (key: string) => {
  const found = FORM26_CLAUSE_UNITS.find((entry) => entry.key === key);
  if (!found) throw new Error(`no unit ${key}`);
  return found;
};
const clauseUnits = () => FORM26_CLAUSE_UNITS.filter((entry) => /^f26_c\d+$/.test(entry.key));
const once = (values: string[]) => new Set(values).size === values.length;
/** The keys a table row holds: its column keys, or for a depreciation table its cell keys. */
const columnKeysOf = (tableId: string) => {
  const table = DEF.tables.find((entry) => entry.id === tableId);
  if (!table) return [];
  return table.dep ? table.dep.rows.flatMap((row) => row.cells) : table.columns.map((column) => column.c);
};

describe('Form No. 26 clause units and row keys', () => {
  it("57 units and 65 table rows give 122 distinct row keys, every one starting with 'f26_'", () => {
    expect(FORM26_CLAUSE_UNITS).toHaveLength(57);
    const tableKeys = DEF.tables.map((table) => form26TableRowKey(table.id));
    expect(tableKeys).toHaveLength(65);
    expect(FORM26_ALL_ROW_KEYS).toHaveLength(122);
    expect(new Set(FORM26_ALL_ROW_KEYS).size).toBe(122);
    expect(FORM26_ALL_ROW_KEYS.every((key) => key.startsWith('f26_'))).toBe(true);
    expect(TAX_AUDIT_FORM26_CLAUSE_PREFIX).toBe('f26_');
    // clause keys first in the order of the form, then one key per table in the order of the form's tables
    expect(FORM26_ALL_ROW_KEYS.slice(0, 57)).toEqual(FORM26_CLAUSE_UNITS.map((entry) => entry.key));
    expect(FORM26_ALL_ROW_KEYS.slice(57)).toEqual(tableKeys);
    expect(tableKeys.every((key) => key.startsWith('f26_t_'))).toBe(true);
    expect(FORM26_CLAUSE_UNITS.some((entry) => entry.key.startsWith('f26_t_'))).toBe(false);
  });

  it('the key scheme is the fixed one', () => {
    expect(FORM26_CLAUSE_UNITS.map((entry) => entry.key)).toEqual([
      'f26_category',
      'f26_part_a',
      'f26_part_b',
      ...Array.from({ length: 8 }, (_, i) => `f26_p${i + 1}`),
      ...Array.from({ length: 45 }, (_, i) => `f26_c${i + 9}`),
      'f26_sign',
    ]);
    expect(FORM26_CLAUSE_UNITS.map((entry) => entry.no)).toEqual([
      'Category',
      'Part A',
      'Part B',
      ...Array.from({ length: 53 }, (_, i) => String(i + 1)),
      'Signature',
    ]);
    expect(form26TableRowKey('A3b')).toBe('f26_t_A3b');
    expect(form26TableRowKey('S45a')).toBe('f26_t_S45a');
    expect(form26TableRowKey('Dpm')).toBe('f26_t_Dpm');
    for (const entry of FORM26_CLAUSE_UNITS) expect(entry.workpaperRef, entry.key).toBe(TAX_AUDIT_FORM26_WORKPAPER_PREFIX + entry.no.replace(/\s+/g, ''));
    expect(unit('f26_part_a').workpaperRef).toBe('TA-F26-PartA');
    expect(unit('f26_c14').workpaperRef).toBe('TA-F26-14');
    expect(unit('f26_p3').workpaperRef).toBe('TA-F26-3');
    expect(unit('f26_sign').workpaperRef).toBe('TA-F26-Signature');
    expect(once(FORM26_CLAUSE_UNITS.map((entry) => entry.no))).toBe(true);
    expect(once(FORM26_CLAUSE_UNITS.map((entry) => entry.workpaperRef))).toBe(true);
    // Part A is for category (i) only, Part B for category (ii) only; nothing else depends on the category
    expect(FORM26_CLAUSE_UNITS.filter((entry) => entry.category !== null).map((entry) => [entry.key, entry.category])).toEqual([['f26_part_a', '1'], ['f26_part_b', '2']]);
  });

  it('every one of the 142 keys belongs to exactly one unit; every one of the 65 tables belongs to exactly one unit; every one of the 55 schedules is opened under exactly one unit', () => {
    const fields = FORM26_CLAUSE_UNITS.flatMap((entry) => entry.fields);
    const tables = FORM26_CLAUSE_UNITS.flatMap((entry) => entry.tables);
    const schedules = FORM26_CLAUSE_UNITS.flatMap((entry) => entry.schedules);
    expect(fields).toHaveLength(142);
    expect(tables).toHaveLength(65);
    expect(schedules).toHaveLength(55);
    expect([...fields].sort()).toEqual(DEF.fields.map((entry) => entry.key).sort());
    expect([...tables].sort()).toEqual(DEF.tables.map((entry) => entry.id).sort());
    expect([...schedules].sort()).toEqual(DEF.schedules.map((entry) => entry.id).sort());
    // the look-ups agree with the units
    for (const entry of FORM26_CLAUSE_UNITS) {
      for (const key of entry.fields) expect(form26ClauseKeyOfField(key), key).toBe(entry.key);
      for (const id of entry.tables) expect(form26ClauseKeyOfTable(id), id).toBe(entry.key);
      for (const id of entry.schedules) expect(form26ClauseKeyOfSchedule(id), id).toBe(entry.key);
    }
    expect(form26ClauseKeyOfField('cat')).toBe('f26_category');
    expect(form26ClauseKeyOfField('c14d')).toBe('f26_c14');
    expect(form26ClauseKeyOfField('C.pan')).toBe('f26_p3');
    expect(form26ClauseKeyOfField('D.udin')).toBe('f26_sign');
    expect(form26ClauseKeyOfTable('A3b')).toBe('f26_part_a');
    expect(form26ClauseKeyOfTable('S45a')).toBe('f26_c45');
    expect(form26ClauseKeyOfTable('Dot')).toBe('f26_c36');
    expect(form26ClauseKeyOfSchedule('s53bii')).toBe('f26_c53');
    expect(form26ClauseKeyOfSchedule('s12a')).toBe('f26_c12');
    // an id the form does not have is refused, never mapped to some clause
    expect(() => form26ClauseKeyOfField('c99')).toThrow(/c99/);
    expect(() => form26ClauseKeyOfTable('S99')).toThrow(/S99/);
    expect(() => form26ClauseKeyOfSchedule('s99')).toThrow(/s99/);
    expect(() => form26ClauseKeyOfField('toString')).toThrow(/toString/);
  });

  it('the units follow the form: an answer or table belongs to the clause of its question row, a schedule to the clause whose answer opens it', () => {
    const rows = FORM26_CLAUSE_UNITS.flatMap((entry) => entry.questionRows);
    expect(rows).toEqual(DEF.questionRows.map((row) => row.index));
    for (const entry of FORM26_CLAUSE_UNITS.filter((item) => item.questionRows.length > 0)) {
      const ownRows = DEF.questionRows.filter((row) => entry.questionRows.includes(row.index));
      expect(new Set(ownRows.map((row) => row.clause)), entry.key).toEqual(new Set([entry.no]));
      expect(entry.fields, entry.key).toEqual(DEF.fields.filter((item) => item.questionRow !== null && entry.questionRows.includes(item.questionRow)).map((item) => item.key));
      const ownTables = DEF.tables.filter((item) => item.questionRow !== null && entry.questionRows.includes(item.questionRow)).map((item) => item.id);
      const opened = DEF.schedules.filter((schedule) => (schedule.showIf !== null && entry.fields.includes(schedule.showIf)) || ownRows.some((row) => row.links.some((link) => link.schedule === schedule.id)));
      expect(entry.schedules, entry.key).toEqual(opened.map((schedule) => schedule.id));
      expect(entry.tables, entry.key).toEqual([...ownTables, ...opened.flatMap((schedule) => schedule.tables)]);
    }
    // the report parts and the signature are not question rows: they take what stands in their part
    const inPart = (part: string) => DEF.fields.filter((item) => item.part === part).map((item) => item.key);
    expect(unit('f26_category').fields).toEqual(['cat']);
    expect(unit('f26_part_a').fields).toEqual(inPart('A'));
    expect(unit('f26_part_b').fields).toEqual(inPart('B'));
    expect(unit('f26_part_a').fields).toHaveLength(17);
    expect(unit('f26_part_b').fields).toHaveLength(17);
    expect(unit('f26_part_a').tables).toEqual(['A3b', 'A5']);
    expect(unit('f26_part_b').tables).toEqual(['B3b', 'B5']);
    // (Parts A and B close with a signature block of their own; the Signature unit is the one of Part D)
    const signatureOfPartD = DEF.fields.filter((item) => item.part === 'D' && item.signature);
    expect(unit('f26_sign').fields).toEqual(signatureOfPartD.map((item) => item.key));
    expect(unit('f26_sign').fields).toEqual(['D.place', 'D.date', 'D.name', 'D.mrn', 'D.pan', 'D.udin', 'D.firm', 'D.frn']);
    expect(signatureOfPartD.every((item) => item.section === 'Z' && item.questionRow === null)).toBe(true);
    expect(DEF.fields.filter((item) => item.part === 'D' && item.questionRow === null)).toEqual(signatureOfPartD);
    // rows of the plan's unit table
    expect(['f26_p1', 'f26_p2', 'f26_p3', 'f26_p4', 'f26_p5', 'f26_p6', 'f26_p7', 'f26_p8'].map((key) => unit(key).fields)).toEqual([
      ['C.name'],
      ['C.a1', 'C.a2', 'C.a3', 'C.a4', 'C.a5', 'C.a6', 'C.a7'],
      ['C.pan'],
      ['C.status'],
      ['C.res'],
      ['C.email'],
      ['C.cc', 'C.ph'],
      ['C.ty'],
    ]);
    expect(unit('f26_c9').fields).toEqual(['q9']);
    expect(unit('f26_c11')).toMatchObject({ fields: ['c11b'], tables: ['P11a', 'S11b'], schedules: ['s11b'] });
    expect(unit('f26_c12')).toMatchObject({ fields: ['c12b', 'c12c'], tables: ['P12d', 'S12a', 'S12b', 'S12c'], schedules: ['s12a', 's12b', 's12c'] });
    expect(unit('f26_c14')).toMatchObject({ fields: ['c14b', 'c14c', 'c14d', 'c14e'], tables: ['P14a'], schedules: [] });
    expect(unit('f26_c16')).toMatchObject({ fields: ['c16a1', 'c16a2', 'c16b'], schedules: ['s16b'] });
    expect(unit('f26_c24')).toMatchObject({ fields: ['c24', 'c24_amt'], tables: [], schedules: [] });
    expect(unit('f26_c33')).toMatchObject({ fields: ['c33a', 'c33a_amt', 'c33b', 'c33b_amt', 'c33c', 'c33c_amt'], tables: [], schedules: [] });
    expect(unit('f26_c34')).toMatchObject({ fields: ['c34'], tables: ['S34a', 'S34b'], schedules: ['s34'] });
    expect(unit('f26_c36')).toMatchObject({ fields: ['c36'], tables: ['Dpm', 'Dot'], schedules: ['s36'] });
    expect(unit('f26_c37')).toMatchObject({ fields: ['c37a', 'c37b', 'c37b_amt', 'c37c', 'c37c_amt', 'c37d', 'c37d_amt', 'c37e', 'c37e_amt'], schedules: ['s37a'] });
    expect(unit('f26_c42')).toMatchObject({ fields: ['c42', 'c42_amt'], schedules: [] });
    expect(unit('f26_c49')).toMatchObject({ fields: [], tables: ['P49'], schedules: [] });
    expect(unit('f26_c52')).toMatchObject({ fields: ['c52'], schedules: ['s52a', 's52b'] });
    expect(unit('f26_c53')).toMatchObject({ fields: ['c53a', 'c53b'], schedules: ['s53a', 's53bi', 's53bii'] });
  });

  it('no Form 26 key equals a 3CD key', () => {
    const threeCd = new Set(FORM_3CD_CLAUSES.map((clause) => clause.key));
    expect(threeCd.size).toBeGreaterThan(40);
    expect(FORM26_ALL_ROW_KEYS.filter((key) => threeCd.has(key))).toEqual([]);
    expect([...threeCd].filter((key) => key.startsWith('f26_'))).toEqual([]);
  });

  it('clauses 9 to 53 are 45 consecutive units in the order of the form; sections DA..DK hold 4,7,6,9,1,4,4,5,3,1,1 units', () => {
    const clauses = clauseUnits();
    expect(clauses).toHaveLength(45);
    expect(clauses.map((entry) => entry.no)).toEqual(Array.from({ length: 45 }, (_, i) => String(i + 9)));
    const first = FORM26_CLAUSE_UNITS.indexOf(clauses[0]);
    expect(FORM26_CLAUSE_UNITS.slice(first, first + 45)).toEqual(clauses);
    const groups = ['DA', 'DB', 'DC', 'DD', 'DE', 'DF', 'DG', 'DH', 'DI', 'DJ', 'DK'];
    expect(groups.map((group) => clauses.filter((entry) => entry.group === group).length)).toEqual([4, 7, 6, 9, 1, 4, 4, 5, 3, 1, 1]);
    const numbers = (group: string) => clauses.filter((entry) => entry.group === group).map((entry) => Number(entry.no));
    expect(groups.map((group) => [numbers(group)[0], numbers(group)[numbers(group).length - 1]])).toEqual([[9, 12], [13, 19], [20, 25], [26, 34], [35, 35], [36, 39], [40, 43], [44, 48], [49, 51], [52, 52], [53, 53]]);
    // a clause sits in the list group of its section of the form
    for (const entry of clauses) {
      const sections = new Set(DEF.questionRows.filter((row) => entry.questionRows.includes(row.index)).map((row) => `D${row.section}`));
      expect(sections, entry.key).toEqual(new Set([entry.group]));
    }
    expect(FORM26_CLAUSE_UNITS.map((entry) => entry.group).filter((group, i, all) => i === 0 || all[i - 1] !== group)).toEqual(['report', 'particulars', ...groups, 'DZ']);
  });

  it('the list groups carry the headings of the form', () => {
    expect(FORM26_LIST_GROUPS).toEqual([
      { id: 'report', title: 'Audit report' },
      { id: 'particulars', title: 'Part C: Particulars of the assessee' },
      { id: 'DA', title: 'A - General Information' },
      { id: 'DB', title: 'B - Particulars of books of account and method of accounting' },
      { id: 'DC', title: 'C - Particulars of receipt/income' },
      { id: 'DD', title: 'D - Particulars of expenses' },
      { id: 'DE', title: 'E - Particulars of Prior Period' },
      { id: 'DF', title: 'F - Particulars of Losses, Depreciation, and Deductions' },
      { id: 'DG', title: 'G - International Taxation' },
      { id: 'DH', title: 'H - Other Key Parameters' },
      { id: 'DI', title: 'I - Particulars of TDS/TCS' },
      { id: 'DJ', title: 'J - Particulars of indirect taxation' },
      { id: 'DK', title: 'K - Quantitative Details' },
      { id: 'DZ', title: 'Signature and Notes' },
      { id: 'schedules', title: 'Schedules' },
    ]);
    for (const section of DEF.sections) expect(FORM26_LIST_GROUPS.find((group) => group.id === `D${section.id}`)?.title, section.id).toBe(section.title);
    expect(FORM26_LIST_GROUPS.find((group) => group.id === 'particulars')?.title).toBe(DEF.parts.find((part) => part.id === 'C')?.heading);
    const used = new Set(FORM26_CLAUSE_UNITS.map((entry) => entry.group));
    expect(FORM26_LIST_GROUPS.map((group) => group.id).filter((id) => !used.has(id))).toEqual(['schedules']);
  });

  it('frozen ids', () => {
    const message = 'ids are for ever — see BUILD-PLAN task 3';
    const rowKeys = new Set(FORM26_ALL_ROW_KEYS);
    const fieldKeys = new Set(DEF.fields.map((entry) => entry.key));
    const tableIds = new Set(DEF.tables.map((entry) => entry.id));
    expect(FROZEN.rowKeys.filter((key) => !rowKeys.has(key)), message).toEqual([]);
    expect(FROZEN.fieldKeys.filter((key) => !fieldKeys.has(key)), message).toEqual([]);
    expect(FROZEN.tableIds.filter((id) => !tableIds.has(id)), message).toEqual([]);
    const lostColumns = Object.entries(FROZEN.columnKeys).flatMap(([tableId, columns]) => {
      const present = new Set(columnKeysOf(tableId));
      return columns.filter((c) => !present.has(c)).map((c) => `${tableId}.${c}`);
    });
    expect(lostColumns, message).toEqual([]);
    expect(TAX_AUDIT_FORM26_STATUTORY_VERSION, message).toBe(FROZEN.statutoryVersion);
    // a frozen key keeps its clause: an answer never moves to another storage row
    for (const key of FROZEN.fieldKeys) expect(FROZEN.rowKeys, message).toContain(form26ClauseKeyOfField(key));
    // the frozen file is not empty: it holds what this release has
    expect(FROZEN.rowKeys).toHaveLength(122);
    expect(FROZEN.fieldKeys).toHaveLength(142);
    expect(FROZEN.tableIds).toHaveLength(65);
    expect(Object.keys(FROZEN.columnKeys).sort()).toEqual([...FROZEN.tableIds].sort());
    expect(Object.values(FROZEN.columnKeys).flat()).toHaveLength(368 + 188);
  });

  it('every unit has a label and no label is longer than 200 characters', () => {
    for (const entry of FORM26_CLAUSE_UNITS) {
      expect(entry.label.trim().length, entry.key).toBeGreaterThan(0);
      expect(entry.label.length, entry.key).toBeLessThanOrEqual(200);
      expect(entry.label, entry.key).toBe(entry.label.trim());
      // no label marks the tool's own content as doubtful or unfinished
      expect(entry.label, entry.key).not.toMatch(/our reading|to be verified|\bsic\b|editor|mock-?up|†|\?\?|TODO/i);
    }
    const longest = [...FORM26_CLAUSE_UNITS].sort((a, b) => b.label.length - a.label.length)[0];
    expect([longest.key, longest.label.length]).toEqual(['f26_c27', 182]);
    expect(unit('f26_category').label).toBe('Category of assessee');
    expect(unit('f26_part_a').label).toBe('Audit report where the accounts have been audited under any other law');
    expect(unit('f26_part_b').label).toBe('Audit report in the case of a person referred to in clause (b) of sub-rule (1) of rule 47');
    expect(unit('f26_c9').label).toBe('Ground on which audit is conducted');
    expect(unit('f26_c14').label).toBe('Books maintained and address(es) where kept; Accounting software; cloud storage with IP address and country; rule 46(8) compliance; backup server address in India');
    expect(unit('f26_c53').label).toBe('Trading unit / manufacturing concern');
    // particulars 1 to 8: the form's own wording without "(refer Note n)"
    for (const entry of FORM26_CLAUSE_UNITS.filter((item) => item.group === 'particulars')) {
      const wording = DEF.questionRows.find((row) => row.index === entry.questionRows[0])?.wording ?? '';
      expect(entry.label, entry.key).toBe(wording.replace(/\s*\(refer Note \d+\)/, ''));
    }
    expect(FORM26_CLAUSE_UNITS.filter((item) => item.group === 'particulars').map((entry) => entry.label)).toEqual(['Name', 'Address', 'Permanent Account Number', 'Status', 'Residential status', 'Email id', 'Contact number', 'Tax year']);
  });
});
