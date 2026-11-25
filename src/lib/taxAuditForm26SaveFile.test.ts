import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import type { Form26Table } from '@/data/taxAuditForm26Types';
import {
  FORM26_SAVE_FILE_MAX_CELLS,
  FORM26_SAVE_FILE_MAX_CHARS,
  FORM26_SAVE_FILE_MAX_ROWS,
  FORM26_SAVE_FILE_MAX_TOTAL_ROWS,
  fileStem,
  form26CellWhere,
  normaliseValue,
  parseForm26Where,
  planImport,
  saveFileName,
  serialiseSaveFile,
  type Form26ImportNote,
  type Form26ImportPlan,
} from '@/lib/taxAuditForm26SaveFile';

// Fixtures are read as text (tsconfig has no resolveJsonModule, and the bytes matter here).
const readText = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
type Row = Record<string, string>;
type Values = { f: Record<string, string>; t: Record<string, Row[]> };

const DEFAULT_TEXT = readText('save-default.json');
const FILLED_TEXT = readText('save-everything-3-rows.json');
const valuesOf = (text: string): Values => { const o = JSON.parse(text); return { f: o.f, t: o.t }; };
const atOpen = () => valuesOf(DEFAULT_TEXT);
const filled = () => valuesOf(FILLED_TEXT);

type OkPlan = Extract<Form26ImportPlan, { ok: true }>;
function plan(file: unknown, current: Values = filled()): OkPlan {
  const result = planImport(DEF, typeof file === 'string' ? file : JSON.stringify(file), current);
  if (result.ok !== true) throw new Error(`expected a plan, got: ${JSON.stringify(result)}`);
  return result;
}
function refusal(text: string, current: Values = filled()): string {
  const result = planImport(DEF, text, current);
  if (result.ok !== false) throw new Error('expected a refusal');
  return result.message;
}
const notesOf = <K extends Form26ImportNote['kind']>(p: OkPlan, kind: K) =>
  p.notes.filter((n): n is Extract<Form26ImportNote, { kind: K }> => n.kind === kind);
const table = (id: string): Form26Table => { const t = DEF.tables.find((x) => x.id === id); if (!t) throw new Error(id); return t; };
const COULD_NOT_READ = 'Could not read this file.';

describe('the format written', () => {
  it("writing the default values gives the owner's file text byte for byte", () => {
    const text = serialiseSaveFile(DEF, atOpen());
    expect(text).toBe(DEFAULT_TEXT);
    expect(text.startsWith('{\n "f": {\n  "cat": "2",\n  "A.assessee": "",')).toBe(true);   // one-space indent
    expect(text.endsWith('\n "v": 1\n}')).toBe(true);
    expect(text.includes('\r')).toBe(false);
  });

  it('reading then writing the 3-row file gives it back byte for byte', () => {
    const p = plan(FILLED_TEXT, atOpen());
    expect(p.summary).toEqual({ answers: 142, tables: 65, rows: 284, cells: 1204 });
    expect(p.notes).toEqual([]);
    expect(serialiseSaveFile(DEF, p.values)).toBe(FILLED_TEXT);
  });

  it('reading then writing the file saved at open gives it back byte for byte, from any present state', () => {
    const p = plan(DEFAULT_TEXT, filled());            // tables shrink back to their opening rows
    expect(p.summary).toEqual({ answers: 142, tables: 65, rows: 227, cells: 904 });
    expect(p.notes).toEqual([]);
    expect(p.values).toEqual(atOpen());
    expect(serialiseSaveFile(DEF, p.values)).toBe(DEFAULT_TEXT);
  });

  it('writes the keys and tables in the order of the file, whatever order the values hold them in', () => {
    const v = filled();
    const shuffled: Values = { f: {}, t: {} };
    for (const key of Object.keys(v.f).reverse()) shuffled.f[key] = v.f[key];
    for (const id of Object.keys(v.t).reverse()) shuffled.t[id] = v.t[id];
    expect(serialiseSaveFile(DEF, shuffled)).toBe(FILLED_TEXT);
  });

  it('writes a radio key only when it has a value, every other key always, and every value as text', () => {
    const v = atOpen();
    delete v.f.cat; v.f.q9 = ''; delete v.f['C.name'];
    v.t.S28 = [{ 1: 'x' } as Row];
    const o = JSON.parse(serialiseSaveFile(DEF, v));
    expect('cat' in o.f).toBe(false);
    expect('q9' in o.f).toBe(false);
    expect(o.f.c15a).toBe('Mercantile system');
    expect(o.f['C.name']).toBe('');
    expect(Object.keys(o.f)).toHaveLength(140);
    expect(o.t.S28).toEqual([{ 1: 'x', 2: '', 3: '' }]);    // every input column, blank as ""
    expect(o.v).toBe(1);
  });

  it('writes every table even when the values lack one, so the owner\'s file is wholly replaced on loading', () => {
    const v = atOpen();
    delete v.t.S28; v.t.S29 = []; delete v.t.P12d; delete v.t.Dpm;
    const o = JSON.parse(serialiseSaveFile(DEF, v));
    expect(Object.keys(o.t)).toEqual(DEF.saveFile.tableOrder);
    expect(o.t.S28).toEqual([{ 1: '', 2: '', 3: '' }, { 1: '', 2: '', 3: '' }]);   // absent: as the form opens it
    expect(o.t.S29).toHaveLength(1);                                                // no rows: the file's minimum of one
    expect(o.t.P12d).toHaveLength(5);
    expect(o.t.Dpm).toHaveLength(19);
  });

  it('never writes a key, a table or a column the form does not have', () => {
    const v = filled();
    v.f.extra = 'x'; v.t.Extra = [{ 1: 'x' }]; v.t.S28[0].zz = 'x'; v.t.S28[0]['0'] = 'x';
    expect(serialiseSaveFile(DEF, v)).toBe(FILLED_TEXT);
  });
});

describe('fileStem and saveFileName', () => {
  const stem = (pan: string, name: string) => fileStem({ f: { 'C.pan': pan, 'C.name': name }, t: {} });
  it('fileStem', () => {
    expect(stem('AAAAA0000A', 'Invented Co')).toBe('Form26_AAAAA0000A');
    expect(stem('', 'Invented & Co. (Test) Ltd')).toBe('Form26_Invented_Co_Test_Ltd');
    expect(stem('', '')).toBe('Form26_Form26');
    expect(stem('  ', ' Invented ')).toBe('Form26_');              // as the file: the PAN box is taken, then trimmed
    expect(stem('aaaaa 0000a/x', '')).toBe('Form26_aaaaa_0000a_x');
    expect(fileStem({ f: {}, t: {} })).toBe('Form26_Form26');
  });
  it('saveFileName adds .json', () => {
    expect(saveFileName({ f: { 'C.pan': 'AAAAA0000A' }, t: {} })).toBe('Form26_AAAAA0000A.json');
    expect(saveFileName({ f: {}, t: {} })).toBe('Form26_Form26.json');
  });
});

describe('every edge case of roundtrip-check.md', () => {
  it('a table given an empty row list keeps ONE row, with the values that row held', () => {
    const p = plan({ f: filled().f, t: { S28: [] } });
    expect(p.values.t.S28).toEqual([{ 1: 'Invented S28 r1 c1', 2: 'Invented S28 r1 c2', 3: '103' }]);
    expect(notesOf(p, 'missing-key').map((n) => n.key)).toEqual(['S28[1].1', 'S28[1].2', 'S28[1].3']);
    const blank = plan({ t: { S28: [] } }, atOpen());
    expect(blank.values.t.S28).toEqual([{ 1: '', 2: '', 3: '' }]);
  });

  it('a table absent from t is untouched, and said', () => {
    const file = JSON.parse(FILLED_TEXT); delete file.t.S29;
    const p = plan(file);
    expect(p.values.t.S29).toEqual(filled().t.S29);
    expect(notesOf(p, 'missing-table')).toEqual([{ kind: 'missing-table', table: 'S29' }]);
    expect(p.summary.tables).toBe(64);
  });

  it('a field absent from f keeps its present value; the three radio groups are cleared', () => {
    const p = plan({ f: {}, t: filled().t });
    expect(p.values.f.c13).toBe('Invented line one c13\nInvented line two');
    for (const key of DEF.saveFile.radioKeys) expect(key in p.values.f, key).toBe(false);
    expect(DEF.saveFile.radioKeys).toEqual(['cat', 'q9', 'c15a']);
    expect(notesOf(p, 'missing-key').map((n) => n.key)).toEqual(DEF.saveFile.fieldOrder);
    expect(p.summary.answers).toBe(0);
    const text = serialiseSaveFile(DEF, p.values);
    expect(Object.keys(JSON.parse(text).f)).toHaveLength(139);
  });

  it('a cell absent from a row object keeps its present value', () => {
    const p = plan({ f: filled().f, t: { S28: [{ 3: '5' }] } });
    expect(p.values.t.S28).toEqual([{ 1: 'Invented S28 r1 c1', 2: 'Invented S28 r1 c2', 3: '5' }]);
    expect(notesOf(p, 'missing-key').map((n) => n.key)).toEqual(['S28[1].1', 'S28[1].2']);
  });

  it('a choice or yes/no value that is not an option becomes blank', () => {
    const ynTable = DEF.tables.find((t) => t.columns.some((c) => c.type === 'yn'))!;
    const ynCol = ynTable.columns.find((c) => c.type === 'yn')!.c;
    const p = plan({ f: { c10: 'Maybe', 'C.status': 'Something else', c11b: 'yes' }, t: { A5: [{ 2: 'Something else' }], [ynTable.id]: [{ [ynCol]: 'yes' }] } });
    expect(p.values.f.c10).toBe('');
    expect(p.values.f['C.status']).toBe('');
    expect(p.values.f.c11b).toBe('');
    expect(p.values.t.A5[0]['2']).toBe('');
    expect(p.values.t[ynTable.id][0][ynCol]).toBe('');
    expect(notesOf(p, 'value-dropped')).toEqual([
      { kind: 'value-dropped', where: 'A5[1].2', given: 'Something else', reason: 'not-an-option' },
      { kind: 'value-dropped', where: `${ynTable.id}[1].${ynCol}`, given: 'yes', reason: 'not-an-option' },
      { kind: 'value-dropped', where: 'C.status', given: 'Something else', reason: 'not-an-option' },
      { kind: 'value-dropped', where: 'c10', given: 'Maybe', reason: 'not-an-option' },
      { kind: 'value-dropped', where: 'c11b', given: 'yes', reason: 'not-an-option' },
    ]);
  });

  const AMOUNTS: [string, string][] = [
    ['01.50', '01.50'], ['1e3', '1e3'], ['-5', '-5'], ['1,000', ''], [' 12 ', ''], ['.5', '.5'], ['5.', ''],
    ['1234567890123456789', '1234567890123456789'], ['0.1234567', '0.1234567'], ['abc', ''],
  ];
  it.each(AMOUNTS)('an amount given as %j is held as %j', (given, held) => {
    const p = plan({ f: { c24_amt: given }, t: { S28: [{ 3: given }], Dpm: [{ 0: given }], A3b: [{ 4: given }] } });
    expect(p.values.f.c24_amt).toBe(held);
    expect(p.values.t.S28[0]['3']).toBe(held);
    expect(p.values.t.Dpm[0]['0']).toBe(held);           // a depreciation cell is a number box
    expect(p.values.t.A3b[0]['4']).toBe(held);           // so is a calculated cell
    const dropped = notesOf(p, 'value-dropped');
    if (held === '') {
      expect(dropped).toHaveLength(4);
      expect(dropped.every((n) => n.reason === 'not-a-number' && n.given === given)).toBe(true);
      expect(dropped.map((n) => n.where)).toEqual(['A3b[1].4', 'S28[1].3', 'Dpm[1].0', 'c24_amt']);
    } else expect(dropped).toEqual([]);
  });

  const DATES: [string, string][] = [['15/04/2026', ''], ['2026-4-5', ''], ['2026-02-30', ''], ['2026-04-15', '2026-04-15']];
  it.each(DATES)('a date given as %j is held as %j', (given, held) => {
    const dateTable = DEF.tables.find((t) => t.columns.some((c) => c.type === 'date'))!;
    const dateCol = dateTable.columns.find((c) => c.type === 'date')!.c;
    const p = plan({ f: { 'A.from': given }, t: { [dateTable.id]: [{ [dateCol]: given }] } });
    expect(p.values.f['A.from']).toBe(held);
    expect(p.values.t[dateTable.id][0][dateCol]).toBe(held);
    expect(notesOf(p, 'value-dropped').map((n) => n.reason)).toEqual(held === '' ? ['not-a-date', 'not-a-date'] : []);
  });

  it('A.rdate is a text box: kept as typed', () => {
    const p = plan({ f: { 'A.rdate': '15 April 2026' } });
    expect(p.values.f['A.rdate']).toBe('15 April 2026');
    expect(notesOf(p, 'value-dropped')).toEqual([]);
  });

  it('a radio value that is not an option clears the group; the key is absent on save', () => {
    const p = plan({ ...JSON.parse(FILLED_TEXT), f: { ...filled().f, cat: '3' } });
    expect('cat' in p.values.f).toBe(false);
    expect(notesOf(p, 'value-dropped')).toEqual([{ kind: 'value-dropped', where: 'cat', given: '3', reason: 'not-an-option' }]);
    const saved = JSON.parse(serialiseSaveFile(DEF, p.values));
    expect('cat' in saved.f).toBe(false);
    expect(saved.f.q9).toBe(filled().f.q9);
  });

  it('line breaks: long text turns CR LF and CR into LF; a one-line box drops them', () => {
    const p = plan({ f: { c13: 'a\r\nb\rc', 'C.name': 'a\r\nb' }, t: { A5: [{ 3: 'a\r\nb\rc', 1: 'a\nb' }] } });
    expect(p.values.f.c13).toBe('a\nb\nc');
    expect(p.values.f['C.name']).toBe('ab');
    expect(p.values.t.A5[0]['3']).toBe('a\nb\nc');
    expect(p.values.t.A5[0]['1']).toBe('ab');
    expect(notesOf(p, 'value-dropped')).toEqual([]);
  });

  it('spaces: text boxes keep them; the email box trims them', () => {
    const p = plan({ f: { 'C.name': '  Invented  Name ', 'C.email': '  x@example.invalid \n' } });
    expect(p.values.f['C.name']).toBe('  Invented  Name ');
    expect(p.values.f['C.email']).toBe('x@example.invalid');
  });

  it('PAN is kept as given: not capitalised, not cut to 10', () => {
    const p = plan({ f: { 'C.pan': 'aaaaa0000a-too-long' } });
    expect(p.values.f['C.pan']).toBe('aaaaa0000a-too-long');
  });

  it('values that are not text: numbers become their text; true in a yes/no becomes blank', () => {
    const p = plan({ f: { c24_amt: 12.5, 'C.name': 7, c10: true, 'A.from': 99, 'C.a1': null }, t: { S28: [{ 3: 99, 1: false }] } });
    expect(p.values.f.c24_amt).toBe('12.5');
    expect(p.values.f['C.name']).toBe('7');
    expect(p.values.f.c10).toBe('');
    expect(p.values.f['A.from']).toBe('');
    expect(p.values.f['C.a1']).toBe('');
    expect(p.values.t.S28[0]['3']).toBe('99');
    expect(p.values.t.S28[0]['1']).toBe('false');
    expect(notesOf(p, 'value-dropped')).toEqual([
      { kind: 'value-dropped', where: 'A.from', given: '99', reason: 'not-a-date' },
      { kind: 'value-dropped', where: 'c10', given: 'true', reason: 'not-an-option' },
    ]);
  });

  it('a radio answer must be the option text itself: the number 2 does not choose "2" (as the file)', () => {
    const p = plan({ f: { cat: 2, q9: '1', c15a: 'Cash system' } });
    expect('cat' in p.values.f).toBe(false);
    expect(p.values.f.q9).toBe('1');
    expect(p.values.f.c15a).toBe('Cash system');
  });

  it('unknown keys, unknown tables and extra top-level entries are ignored, said, and not written back', () => {
    const file = JSON.parse(FILLED_TEXT);
    file.f.zzz = 'x'; file.t.Zzz = [{ 1: 'x' }]; file.t.S28[0].zz = 'x'; file.t.S28[1].zz = 'y'; file.t.S28[0]['0'] = '9'; file.extra = { a: 1 }; file.note = 'x';
    const p = plan(file, atOpen());
    expect(p.notes).toEqual([
      { kind: 'unknown-key', key: 'extra' },
      { kind: 'unknown-key', key: 'note' },
      { kind: 'unknown-column', table: 'S28', column: '0' },      // the serial number is not saved by the file
      { kind: 'unknown-column', table: 'S28', column: 'zz' },     // once, not once per row
      { kind: 'unknown-table', table: 'Zzz' },
      { kind: 'unknown-key', key: 'zzz' },
    ]);
    expect(serialiseSaveFile(DEF, p.values)).toBe(FILLED_TEXT);
  });

  it('a fixed table given fewer rows: the rows given are set, the others keep their values', () => {
    const p = plan({ t: { P12d: [{ 2: '1', 3: '2' }, { 2: '3' }] } });
    const before = filled().t.P12d;
    expect(p.values.t.P12d).toHaveLength(5);
    expect(p.values.t.P12d[0]).toEqual({ 2: '1', 3: '2' });
    expect(p.values.t.P12d[1]).toEqual({ 2: '3', 3: before[1]['3'] });
    expect(p.values.t.P12d.slice(2)).toEqual(before.slice(2));
    expect(notesOf(p, 'rows-ignored')).toEqual([]);
  });

  it('a fixed table given more rows: the extra rows are ignored, and said', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ 2: String(i), 3: String(i * 2) }));
    const p = plan({ t: { P12d: rows, Dot: Array.from({ length: 20 }, () => ({})) } });
    expect(p.values.t.P12d).toEqual(rows.slice(0, 5));
    expect(p.values.t.Dot).toEqual(filled().t.Dot);
    expect(notesOf(p, 'rows-ignored')).toEqual([
      { kind: 'rows-ignored', table: 'P12d', given: 7, kept: 5 },
      { kind: 'rows-ignored', table: 'Dot', given: 20, kept: 16 },
    ]);
  });

  it('calculated cells are loaded as saved, never recalculated', () => {
    const p = plan({ t: { A3b: [{ 1: 'Invented', 2: '100', 3: '40', 4: '999', 5: '' }] } });
    expect(p.values.t.A3b).toEqual([{ 1: 'Invented', 2: '100', 3: '40', 4: '999', 5: '' }]);
  });

  it('v is not read; the file written always says 1', () => {
    for (const v of [7, '1', null, { a: 1 }]) {
      const p = plan({ ...JSON.parse(FILLED_TEXT), v }, atOpen());
      expect(p.notes).toEqual([]);
      expect(serialiseSaveFile(DEF, p.values)).toBe(FILLED_TEXT);
    }
    const noV = JSON.parse(FILLED_TEXT); delete noV.v;
    expect(serialiseSaveFile(DEF, plan(noV, atOpen()).values)).toBe(FILLED_TEXT);
  });

  it('{} loads: the radio groups are cleared, nothing else changes, and all 142 keys are named as missing', () => {
    const p = plan('{}');
    expect(notesOf(p, 'missing-key')).toHaveLength(142);
    expect(notesOf(p, 'missing-table')).toHaveLength(65);
    expect(p.notes).toHaveLength(207);
    expect(p.summary).toEqual({ answers: 0, tables: 0, rows: 0, cells: 0 });
    const expected = filled();
    for (const key of DEF.saveFile.radioKeys) delete expected.f[key];
    expect(p.values).toEqual(expected);
  });

  it('null gives "Could not read this file."', () => {
    expect(refusal('null')).toBe(COULD_NOT_READ);
  });

  it('[] loads as {}', () => {
    const p = plan('[]');
    expect(notesOf(p, 'missing-key')).toHaveLength(142);
    expect(p.values).toEqual(plan('{}').values);
    expect(plan('[1,2,3]').values).toEqual(p.values);
  });

  it('a table whose rows are text ("x") is refused: it is never turned into blank rows', () => {
    expect(refusal(JSON.stringify({ t: { S28: 'x' } }))).toBe('This is not a Form No. 26 save file.');
    expect(refusal(JSON.stringify({ t: { S28: 'x'.repeat(20_000) } }))).toBe('This is not a Form No. 26 save file.');
  });

  it('a table whose rows are a number, true or an object keeps the rows it has, and said', () => {
    for (const odd of [5, true, { a: 1 }]) {                 // as the file: the table keeps the rows it has
      const q = plan({ t: { S28: odd } });
      expect(q.values.t.S28).toEqual(filled().t.S28);
      expect(notesOf(q, 'rows-ignored')).toEqual([{ kind: 'rows-ignored', table: 'S28', given: 0, kept: 3 }]);
    }
    for (const empty of [null, 0, '', false]) {              // as the file: `if(!rows)return` — untouched
      const q = plan({ t: { S28: empty } });
      expect(q.values.t.S28).toEqual(filled().t.S28);
      expect(notesOf(q, 'missing-table').some((n) => n.table === 'S28')).toBe(true);
    }
  });
});

describe('what the plan tells the screen before anything is written', () => {
  it('a file from another client is announced', () => {
    const current = atOpen(); current.f['C.pan'] = 'AAAAA0000A'; current.f['C.name'] = 'Invented Present Ltd';
    const other = JSON.parse(FILLED_TEXT); other.f['C.pan'] = 'AAAAA1111A'; other.f['C.name'] = 'Invented Other Ltd';
    const p = plan(other, current);
    expect(p.summary).toEqual({ answers: 142, tables: 65, rows: 284, cells: 1204 });
    expect([p.values.f['C.pan'], current.f['C.pan']]).toEqual(['AAAAA1111A', 'AAAAA0000A']);   // the caller shows both
    expect([p.values.f['C.name'], current.f['C.name']]).toEqual(['Invented Other Ltd', 'Invented Present Ltd']);
  });

  it('never changes the present values it was given', () => {
    const current = filled();
    const copy = JSON.parse(JSON.stringify(current));
    const p = plan({ f: { c13: 'changed' }, t: { S28: [{ 1: 'changed' }], P12d: [{ 2: 'changed' }] } }, current);
    expect(current).toEqual(copy);
    p.values.t.S29[0]['1'] = 'edited afterwards';
    p.values.f.c10 = 'edited afterwards';
    expect(current).toEqual(copy);
  });

  it('a table present in the file is resized to its rows (minimum one), more or fewer than now', () => {
    const p = plan({ t: { S28: [{ 1: 'a' }, { 1: 'b' }, { 1: 'c' }, { 1: 'd' }, { 1: 'e' }], S29: [{ 1: 'only' }] } });
    expect(p.values.t.S28).toHaveLength(5);
    expect(p.values.t.S28[3]).toEqual({ 1: 'd', 2: '', 3: '' });                 // a new row starts blank
    expect(p.values.t.S29).toHaveLength(1);
    expect(p.values.t.S29[0]['1']).toBe('only');
  });

  it('a kept cell is named only when it holds something', () => {
    const p = plan({ t: { S28: [{}, {}, {}, {}] } }, atOpen());
    expect(p.values.t.S28).toHaveLength(4);
    expect(notesOf(p, 'missing-key').filter((n) => n.key.startsWith('S28'))).toEqual([]);
  });

  it('a row that is not an object is read as an empty row', () => {
    const p = plan({ t: { S28: [5, null, 'x', [1]] } }, atOpen());
    expect(p.values.t.S28).toEqual(Array.from({ length: 4 }, () => ({ 1: '', 2: '', 3: '' })));
  });

  it('where: a field is its key, a cell is table[row].column', () => {
    expect(form26CellWhere('S28', 1, '3')).toBe('S28[2].3');
    expect(parseForm26Where('S28[2].3')).toEqual({ table: 'S28', row: 1, column: '3' });
    expect(parseForm26Where('Dpm[19].363')).toEqual({ table: 'Dpm', row: 18, column: '363' });
    expect(parseForm26Where('c24_amt')).toEqual({ key: 'c24_amt' });
    expect(parseForm26Where('C.pan')).toEqual({ key: 'C.pan' });
  });
});

describe('hostile or broken input is refused safely', () => {
  it.each(['', ' ', '{', '{"f":', 'hello', '<html></html>', '{f:{}}', "{'f':{}}", 'undefined', 'NaN', '{"f":{}}}', '\u0000'])('not JSON: %j', (text) => {
    expect(refusal(text)).toBe(COULD_NOT_READ);
  });

  it.each(['5', '"text"', 'true', 'false', '0', '""'])('a top level that is not an object: %s', (text) => {
    expect(refusal(text)).toBe(COULD_NOT_READ);
  });

  it('text that is not text at all', () => {
    for (const odd of [undefined, null, 5, {}, []]) {
      expect(planImport(DEF, odd as unknown as string, filled())).toEqual({ ok: false, message: COULD_NOT_READ });
    }
  });

  it('a byte-order mark before the text is allowed (a file re-saved in a text editor)', () => {
    const mark = String.fromCharCode(0xfeff);
    expect(serialiseSaveFile(DEF, plan(mark + FILLED_TEXT, atOpen()).values)).toBe(FILLED_TEXT);
  });

  it.each([
    ['f is a list', { f: [] }], ['f is text', { f: 'x' }], ['f is a number', { f: 5 }], ['f is true', { f: true }],
    ['t is a list', { t: [[]] }], ['t is text', { t: 'S28' }], ['t is a number', { t: 1 }],
  ])('wrong shape, %s: refused in one sentence', (_name, file) => {
    expect(refusal(JSON.stringify(file))).toBe('This is not a Form No. 26 save file.');
  });

  it('wrong shape, f or t empty (null, 0, false, ""): read as absent, as the file does', () => {
    for (const empty of [null, 0, false, '']) {
      const p = plan({ f: empty, t: empty });
      expect(notesOf(p, 'missing-key')).toHaveLength(142);
      expect(notesOf(p, 'missing-table')).toHaveLength(65);
    }
  });

  it.each([
    ['an answer that is an object', { f: { c13: { a: 1 } } }],
    ['an answer that is a list', { f: { c10: ['Yes'] } }],
    ['a radio answer that is an object', { f: { cat: { value: '1' } } }],
    ['a cell that is an object', { t: { S28: [{ 1: { a: 1 } }] } }],
    ['a cell that is a list', { t: { S28: [{ 3: [1] }] } }],
  ])('wrong type, %s: refused in one sentence', (_name, file) => {
    expect(refusal(JSON.stringify(file))).toBe('This is not a Form No. 26 save file.');
  });

  it('a huge file is refused at once, before it is read', () => {
    const huge = `{"f":{"c13":"${'x'.repeat(FORM26_SAVE_FILE_MAX_CHARS)}"}}`;
    const started = performance.now();
    expect(refusal(huge)).toBe('This file is too large to be a Form No. 26 save file.');
    expect(performance.now() - started).toBeLessThan(200);
    expect(FORM26_SAVE_FILE_MAX_CHARS).toBeGreaterThan(10 * 1_905_397);        // ten times the 250-row file
  });

  it('a table with more rows than can be held is refused in one sentence', () => {
    expect(FORM26_SAVE_FILE_MAX_ROWS).toBe(5_000);                          // twenty times the 250-row file
    const rows = `[${Array.from({ length: FORM26_SAVE_FILE_MAX_ROWS + 1 }, () => '{}').join(',')}]`;
    expect(refusal(`{"t":{"S28":${rows}}}`)).toBe('This file cannot be loaded: one of its tables has more than 5,000 rows.');
    const atLimit = `[${Array.from({ length: FORM26_SAVE_FILE_MAX_ROWS }, () => '{}').join(',')}]`;
    expect(plan(`{"t":{"S28":${atLimit}}}`, atOpen()).values.t.S28).toHaveLength(FORM26_SAVE_FILE_MAX_ROWS);
  });

  // The add/delete tables of the definition, narrowest or widest first, with their number of input cells.
  const rowTables = (order: 'narrow' | 'wide') => DEF.tables
    .filter((t) => t.kind === 'rows' && !t.dep)
    .map((t) => ({ id: t.id, width: t.columns.filter((c) => c.input).length }))
    .sort((a, b) => (order === 'narrow' ? a.width - b.width : b.width - a.width));
  const fullTables = (tables: { id: string }[]) => `{"t":{${tables.map((t) => `"${t.id}":[${Array.from({ length: FORM26_SAVE_FILE_MAX_ROWS }, () => '{}').join(',')}]`).join(',')}}}`;

  it('all tables together may not hold more rows than can be held, even when each is within its own limit', () => {
    expect(FORM26_SAVE_FILE_MAX_TOTAL_ROWS).toBe(50_000);
    const narrow = rowTables('narrow').slice(0, FORM26_SAVE_FILE_MAX_TOTAL_ROWS / FORM26_SAVE_FILE_MAX_ROWS + 1);
    expect(narrow.reduce((n, t) => n + t.width * FORM26_SAVE_FILE_MAX_ROWS, 0)).toBeLessThan(FORM26_SAVE_FILE_MAX_CELLS);   // so it is the rows that stop it
    const started = performance.now();
    expect(refusal(fullTables(narrow), atOpen())).toBe('This file cannot be loaded: its tables have more than 50,000 rows in all.');
    expect(performance.now() - started).toBeLessThan(500);                 // refused before the rows are built
    // REVIEW-F probe 3: every table 20,000 empty rows (3.9 million characters) is refused too.
    const probe = `{"t":{${DEF.tables.map((t) => `"${t.id}":[${Array.from({ length: 20_000 }, () => '{}').join(',')}]`).join(',')}}}`;
    expect(refusal(probe, atOpen())).toMatch(/^This file cannot be loaded: /);
  });

  it('all tables together may not hold more cells than can be held', () => {
    expect(FORM26_SAVE_FILE_MAX_CELLS).toBe(400_000);
    const wide: { id: string; width: number }[] = [];
    let cells = 0;
    for (const t of rowTables('wide')) { if (cells > FORM26_SAVE_FILE_MAX_CELLS) break; wide.push(t); cells += t.width * FORM26_SAVE_FILE_MAX_ROWS; }
    expect(wide.length * FORM26_SAVE_FILE_MAX_ROWS).toBeLessThanOrEqual(FORM26_SAVE_FILE_MAX_TOTAL_ROWS);   // so it is the cells that stop it
    expect(refusal(fullTables(wide), atOpen())).toBe('This file cannot be loaded: its tables have more than 400,000 cells in all.');
    // One table fewer is within every limit and loads.
    const within = plan(fullTables(wide.slice(0, -1)), atOpen());
    expect(within.values.t[wide[0].id]).toHaveLength(FORM26_SAVE_FILE_MAX_ROWS);
  });

  it('very deep nesting does not crash', () => {
    const deep = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
    const result = planImport(DEF, deep, filled());
    expect(result.ok === false ? result.message : 'loaded as {}').toMatch(/^(Could not read this file\.|loaded as \{\})$/);
  });

  it('prototype-polluting keys change nothing outside the plan', () => {
    const text = '{"__proto__":{"polluted":"top"},"constructor":{"prototype":{"polluted":"ctor"}},'
      + '"f":{"__proto__":{"polluted":"f"},"constructor":"x","toString":"x","hasOwnProperty":"x","c10":"Yes"},'
      + '"t":{"__proto__":[{"1":"x"}],"constructor":[{"1":"x"}],"S28":[{"__proto__":{"polluted":"row"},"constructor":"x","1":"kept"}]}}';
    const p = plan(text, atOpen());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(([] as unknown as Record<string, unknown>).polluted).toBeUndefined();
    for (const o of [p.values, p.values.f, p.values.t, p.values.t.S28[0], p.summary]) {
      expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(o, '__proto__')).toBe(false);
      expect((o as Record<string, unknown>).polluted).toBeUndefined();
    }
    expect(Object.keys(p.values.f).every((key) => DEF.saveFile.fieldOrder.includes(key))).toBe(true);
    expect(Object.keys(p.values.t)).toEqual(DEF.saveFile.tableOrder);
    expect(p.values.f.c10).toBe('Yes');
    expect(p.values.t.S28[0]).toEqual({ 1: 'kept', 2: '', 3: '' });
    expect(typeof p.values.f.toString).toBe('function');                 // the ordinary inherited one, not "x"
    expect(notesOf(p, 'unknown-key').map((n) => n.key)).toEqual(['__proto__', 'constructor', '__proto__', 'constructor', 'toString', 'hasOwnProperty']);
    expect(notesOf(p, 'unknown-table').map((n) => n.table)).toEqual(['__proto__', 'constructor']);
    expect(notesOf(p, 'unknown-column')).toEqual([
      { kind: 'unknown-column', table: 'S28', column: '__proto__' },
      { kind: 'unknown-column', table: 'S28', column: 'constructor' },
    ]);
  });

  it('a present state that lacks keys or tables (or is itself odd) still gives whole values', () => {
    const p = plan('{}', { f: {}, t: {} });
    expect(Object.keys(p.values.t)).toEqual(DEF.saveFile.tableOrder);
    expect(p.values.t.S28).toHaveLength(table('S28').startRows);
    expect(p.values.t.P12d).toHaveLength(5);
    expect(p.values.t.Dpm).toHaveLength(19);
    expect(Object.keys(p.values.f)).toHaveLength(139);
    expect(Object.values(p.values.f).every((v) => v === '')).toBe(true);
    const odd = plan('{}', { f: { c10: 5 }, t: { S28: 'x', S29: [null, 7] } } as unknown as Values);
    expect(odd.values.f.c10).toBe('');
    expect(odd.values.t.S28).toHaveLength(table('S28').startRows);
    expect(odd.values.t.S29).toEqual(Array.from({ length: 2 }, () => ({ 1: '', 2: '', 3: '', 4: '', 5: '' })));
  });
});

describe('normaliseValue', () => {
  it('yes/no and choices must equal an option exactly', () => {
    expect(normaliseValue('yesno', ['Yes', 'No'], 'Yes')).toEqual({ value: 'Yes' });
    expect(normaliseValue('yesno', ['Yes', 'No'], 'yes')).toEqual({ value: '', dropped: 'not-an-option' });
    expect(normaliseValue('yesno', ['Yes', 'No'], ' Yes')).toEqual({ value: '', dropped: 'not-an-option' });
    expect(normaliseValue('yn', undefined, 'No')).toEqual({ value: 'No' });
    expect(normaliseValue('yn', undefined, 'NO')).toEqual({ value: '', dropped: 'not-an-option' });
    expect(normaliseValue('choice', ['Resident', 'Non-resident'], 'Resident')).toEqual({ value: 'Resident' });
    expect(normaliseValue('sel', ['A - Cash payment'], 'A')).toEqual({ value: '', dropped: 'not-an-option' });
    expect(normaliseValue('radio', ['1', '2'], '2')).toEqual({ value: '2' });
    expect(normaliseValue('radio', ['1', '2'], '3')).toEqual({ value: '', dropped: 'not-an-option' });
    expect(normaliseValue('radio', ['1', '2'], 2)).toEqual({ value: '', dropped: 'not-an-option' });
    for (const kind of ['yesno', 'yn', 'choice', 'sel', 'radio'] as const) expect(normaliseValue(kind, ['Yes', 'No'], '')).toEqual({ value: '' });
    expect(normaliseValue('yesno', ['Yes', 'No'], true)).toEqual({ value: '', dropped: 'not-an-option' });
  });

  it('a number must be a plain number', () => {
    for (const ok of ['01.50', '1e3', '-5', '.5', '0', '1E-3', '1e+3', '-.5', '12.50']) expect(normaliseValue('number', undefined, ok), ok).toEqual({ value: ok });
    for (const bad of ['1,000', ' 12 ', '5.', '+5', '--5', '1e', '0x10', 'Infinity', 'NaN', '1 000', '१२', '5-', '.', '-']) {
      expect(normaliseValue('num', undefined, bad), bad).toEqual({ value: '', dropped: 'not-a-number' });
    }
    expect(normaliseValue('calc', undefined, 12.5)).toEqual({ value: '12.5' });
    expect(normaliseValue('num', undefined, -0.5)).toEqual({ value: '-0.5' });
    expect(normaliseValue('number', undefined, '')).toEqual({ value: '' });
    expect(normaliseValue('number', undefined, true)).toEqual({ value: '', dropped: 'not-a-number' });
  });

  it('a date must be a real yyyy-mm-dd', () => {
    for (const ok of ['2026-04-15', '2024-02-29', '2000-02-29', '2026-12-31', '0001-01-01']) expect(normaliseValue('date', undefined, ok), ok).toEqual({ value: ok });
    for (const bad of ['15/04/2026', '2026-4-5', '2026-02-30', '2025-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-04-00', '2026-04-31', '0000-01-01', '2026-04-15T00:00', ' 2026-04-15', '20260415']) {
      expect(normaliseValue('date', undefined, bad), bad).toEqual({ value: '', dropped: 'not-a-date' });
    }
    expect(normaliseValue('date', undefined, '')).toEqual({ value: '' });
  });

  it('text: long text keeps line breaks as LF, one-line text drops them, the email box trims', () => {
    expect(normaliseValue('longtext', undefined, 'a\r\nb\rc\nd')).toEqual({ value: 'a\nb\nc\nd' });
    expect(normaliseValue('ta', undefined, 'a\r\n\r\nb')).toEqual({ value: 'a\n\nb' });
    expect(normaliseValue('text', undefined, ' a\r\nb\n ')).toEqual({ value: ' ab ' });
    expect(normaliseValue('email', undefined, ' \tx@example.invalid\r\n ')).toEqual({ value: 'x@example.invalid' });
    expect(normaliseValue('text', undefined, 7)).toEqual({ value: '7' });
    expect(normaliseValue('text', undefined, null)).toEqual({ value: '' });
    expect(normaliseValue('text', undefined, undefined)).toEqual({ value: '' });
    expect(normaliseValue('text', undefined, { a: 1 })).toEqual({ value: '' });
  });

  it('a column that takes no input holds nothing', () => {
    expect(normaliseValue('sl', undefined, '3')).toEqual({ value: '' });
    expect(normaliseValue('s', undefined, 'fixed text')).toEqual({ value: '' });
  });
});

describe('size', () => {
  it('250 rows per table (70,364 cells) plans in under one second', () => {
    const big: Values = { f: filled().f, t: {} };
    for (const t of DEF.tables) {
      if (t.kind === 'depreciation') { big.t[t.id] = t.dep!.rows.map((r, i) => Object.fromEntries(r.cells.map((c) => [c, String(i + 1)]))); continue; }
      const cols = t.columns.filter((c) => c.input);
      const count = t.kind === 'rows' ? 250 : t.startRows;
      big.t[t.id] = Array.from({ length: count }, (_, i) => Object.fromEntries(cols.map((c) => [c.c,
        c.type === 'num' || c.type === 'calc' ? String(i + 1) : c.type === 'date' ? '2026-04-15' : c.type === 'yn' ? 'Yes' : c.type === 'sel' ? c.options![0] : `Invented ${t.id} r${i + 1} c${c.c}`])));
    }
    const text = serialiseSaveFile(DEF, big);
    const started = performance.now();
    const p = plan(text, atOpen());
    const elapsed = performance.now() - started;
    expect(p.summary.cells).toBe(70_364);
    expect(p.summary.tables).toBe(65);
    expect(p.notes).toEqual([]);
    expect(elapsed).toBeLessThan(1000);
    expect(serialiseSaveFile(DEF, p.values)).toBe(text);
  });
});
