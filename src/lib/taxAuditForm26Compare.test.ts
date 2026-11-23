import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { FORM26_MAPPING, mappingRowsForClause, shownEntry, shownNotInForm26, type Form26MappingRow } from '@/data/taxAuditForm26Mapping';
import {
  briefingFileName,
  buildBriefingDocx,
  comparisonLine,
  comparisonLineForQuestion,
  comparisonOnByDefault,
  comparisonPlacement,
  form26ComparisonStorageKey,
  form26RefsText,
  FORM26_BRIEFING_TITLE,
  FORM26_CHANGE_FILTERS,
  previousYearCodes,
  readComparisonSetting,
  threeCdRefsText,
  whatChangedCells,
  whatChangedColumns,
  whatChangedRows,
  writeComparisonSetting,
  type Form26ChangeFilter,
} from '@/lib/taxAuditForm26Compare';
import { buildEditorModel } from '@/lib/taxAuditForm26EditorModel';
import { buildForm26ExportModel, exportModelText } from '@/lib/taxAuditForm26ExportModel';
import { defaultValues } from '@/lib/taxAuditForm26Values';

const row = (id: string): Form26MappingRow => {
  const found = FORM26_MAPPING.find((entry) => entry.id === id);
  if (!found) throw new Error(`no mapping row ${id}`);
  return found;
};
// Words that would mark the comparison as doubtful (ruling R7). One letter in brackets so that a search of
// the source for these words finds real uses only.
const HEDGING = /our rea[d]ing|to be veri[f]ied|†|appe[a]r|check aga[i]nst|\bs[i]c\b|edi[t]or's note|not con[f]irm/i;

describe('the line under a clause', () => {
  it('line for row 15: "Was Form 3CD clause 13(a)–(c) · No change in substance."', () => {
    expect(comparisonLine(row('m15'))).toBe('Was Form 3CD clause 13(a)–(c) · No change in substance.');
  });

  it('line for 14(b)–(e): new in Form No. 26, with the rest of the shown entry (its "NEW." is not repeated)', () => {
    expect(comparisonLine(row('m14be'))).toBe('New in Form No. 26. Digital trail of books is now a reporting item.');
    expect(comparisonLine(row('m39'))).toBe('New in Form No. 26.');
  });

  it('row 41(b),(c) is not shown as new (corrected)', () => {
    expect(row('m41bc').office.kind).toBe('new');
    expect(comparisonLine(row('m41bc'))).toBe('Was Form 3CD clause 30B(b)(iv), (v) · Not new in substance; each is now a separate Yes/No with its own table.');
  });

  it('several Form 3CD clauses: "clauses", joined with "and"; a part is said so', () => {
    expect(comparisonLine(row('m27a'))).toBe('Was Form 3CD clauses 20(a) and 21(e), (f), (g), (i) · Statute-wise tagging.');
    expect(comparisonLine(row('m27d'))).toBe('Was Form 3CD clause 21(b)/(c) (part) · TDS-linked items moved to clause 51.');
    expect(threeCdRefsText(shownEntry(row('m21')).threeCd)).toBe('16, 25, 24, 29A, 36B and 36A (part)');
  });

  it('clause 47 has no Form 3CD clause (28 and 29 were omitted): its own wording, not "Was Form 3CD clause"', () => {
    expect(comparisonLine(row('m47'))).toBe('No Form 3CD clause · In effect a new, wider clause: every acquisition or transfer of unquoted shares. Form 3CD clauses 28 and 29 were omitted from 1 April 2025.');
  });

  it('every line is the shown entry (corrected on the 18 rows, the office\'s elsewhere), with clause numbers only', () => {
    let corrected = 0;
    for (const entry of FORM26_MAPPING) {
      const shown = shownEntry(entry);
      const line = comparisonLine(entry);
      if (entry.corrected !== null) corrected += 1;
      if (entry.corrected !== null) expect(shown.whatChanged).toBe(entry.corrected.whatChanged);
      else expect(shown.whatChanged).toBe(entry.office.whatChanged);
      if (shown.kind === 'new') {
        expect(line).toBe(`New in Form No. 26.${shown.whatChanged.replace(/^NEW\.\s*/, '') ? ` ${shown.whatChanged.replace(/^NEW\.\s*/, '')}` : ''}`);
      } else if (shown.threeCd.length === 0) {
        expect(line).toBe(`No Form 3CD clause · ${shown.whatChanged}`);
      } else {
        expect(line).toBe(`Was Form 3CD clause${shown.threeCd.length > 1 ? 's' : ''} ${threeCdRefsText(shown.threeCd)} · ${shown.whatChanged}`);
      }
      // No section column on the line: those are in "What changed" and "Last year".
      for (const cell of [shown.section2025, shown.section1961]) {
        if (cell.length > 3 && !shown.whatChanged.includes(cell)) expect(line).not.toContain(cell);
      }
      expect(line).not.toMatch(/Section \(|Act\)/);
    }
    expect(corrected).toBe(18);
  });

  it('question 13 and question 14(a) both carry the line of the row "13, 14(a)"', () => {
    const expected = comparisonLine(row('m13_14a'));
    expect(comparisonLineForQuestion('13', null)).toBe(expected);
    expect(comparisonLineForQuestion('14', 'a')).toBe(expected);
    expect(comparisonLineForQuestion('14', 'b')).toBe(comparisonLine(row('m14be')));
    expect(comparisonLineForQuestion('8', null)).toBeNull();
    expect(comparisonLineForQuestion('27', null)).toBeNull();          // the heading row of 27; (a)-(d) carry their own
  });

  it('each line is placed once, under the first question row it covers; clause 52 (one row) carries both of its lines', () => {
    const placed = new Map<string, number>();
    for (const unit of FORM26_CLAUSE_UNITS) {
      const lines = comparisonPlacement(unit.questionRows.map((index) => DEF.questionRows[index]));
      for (const [index, list] of lines) {
        expect(DEF.questionRows[index].fullWidth).toBe(false);
        for (const line of list) placed.set(line.rowId, (placed.get(line.rowId) ?? 0) + 1);
      }
    }
    // A row naming two clauses ("13, 14(a)", "17, 18" …) is placed under each of them.
    for (const entry of FORM26_MAPPING) expect(placed.get(entry.id), entry.id).toBe(entry.form26.length);
    const c52 = FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c52')!;
    const lines52 = comparisonPlacement(c52.questionRows.map((index) => DEF.questionRows[index]));
    expect([...lines52.values()].flat().map((line) => line.rowId)).toEqual(['m52a', 'm52b']);
    const c15 = FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c15')!;
    const lines15 = comparisonPlacement(c15.questionRows.map((index) => DEF.questionRows[index]));
    expect([...lines15.keys()]).toEqual([c15.questionRows[0]]);
    expect(lines15.get(c15.questionRows[0])).toEqual([{ rowId: 'm15', text: comparisonLine(row('m15')), hasThreeCd: true }]);
  });

  it('every clause 9 to 53 shows its line(s) in the editor when the comparison is on, and none when it is off', () => {
    for (let no = 9; no <= 53; no += 1) {
      const unit = FORM26_CLAUSE_UNITS.find((entry) => entry.no === String(no))!;
      const on = buildEditorModel(DEF, unit.key, defaultValues(DEF), { showAllSchedules: false }, { comparison: true });
      const shown = on.flatMap((block) => (block.kind === 'question' ? block.comparison : []));
      const expected = mappingRowsForClause(String(no)).map((entry) => comparisonLine(entry));
      expect(shown.map((line) => line.text).sort(), `clause ${no}`).toEqual([...expected].sort());
      expect(shown.length, `clause ${no}`).toBeGreaterThan(0);
      const off = buildEditorModel(DEF, unit.key, defaultValues(DEF), { showAllSchedules: false }, { comparison: false });
      expect(off.flatMap((block) => (block.kind === 'question' ? block.comparison : []))).toEqual([]);
    }
    for (const key of ['f26_category', 'f26_part_a', 'f26_p1', 'f26_p8', 'f26_sign']) {
      const blocks = buildEditorModel(DEF, key, defaultValues(DEF), { showAllSchedules: false }, { comparison: true });
      expect(blocks.flatMap((block) => (block.kind === 'question' ? block.comparison : []))).toEqual([]);
    }
  });

  it('a new clause has no "Last year" to open (no Form 3CD answer); a changed or same one has', () => {
    const placed = FORM26_CLAUSE_UNITS.flatMap((unit) => [...comparisonPlacement(unit.questionRows.map((index) => DEF.questionRows[index])).values()].flat());
    expect(placed.find((line) => line.rowId === 'm39')?.hasThreeCd).toBe(false);
    expect(placed.find((line) => line.rowId === 'm47')?.hasThreeCd).toBe(false);
    expect(placed.find((line) => line.rowId === 'm15')?.hasThreeCd).toBe(true);
  });
});

describe('"What changed"', () => {
  it('counts on the chips add up: new + changed + same = 52; they equal the mapping\'s own counts', () => {
    const { counts } = whatChangedRows('all');
    const kinds = FORM26_MAPPING.map((entry) => shownEntry(entry).kind);
    expect(counts).toEqual({
      all: 52,
      new: kinds.filter((kind) => kind === 'new').length,
      changed: kinds.filter((kind) => kind === 'changed').length,
      same: kinds.filter((kind) => kind === 'same').length,
      'not-in-form26': shownNotInForm26().length,
    });
    expect(counts).toEqual({ all: 52, new: 6, changed: 33, same: 13, 'not-in-form26': 15 });
    expect(counts.new + counts.changed + counts.same).toBe(52);
    expect(FORM26_CHANGE_FILTERS.map((chip) => chip.label)).toEqual(['All', 'New', 'Changed', 'Same', 'Not in Form 26']);
  });

  it('each filter lists exactly what its chip counts, in the form\'s order', () => {
    for (const chip of FORM26_CHANGE_FILTERS) {
      const result = whatChangedRows(chip.id);
      const listed = chip.id === 'not-in-form26' ? result.notInForm26.length : result.rows.length;
      expect(listed, chip.id).toBe(result.counts[chip.id]);
      if (chip.id === 'not-in-form26') expect(result.rows).toEqual([]);
      else expect(result.notInForm26).toEqual([]);
      if (chip.id !== 'all' && chip.id !== 'not-in-form26') for (const entry of result.rows) expect(shownEntry(entry).kind).toBe(chip.id);
    }
    expect(whatChangedRows('all').rows.map((entry) => entry.id)).toEqual(FORM26_MAPPING.map((entry) => entry.id));
    expect(whatChangedRows('new').rows.map((entry) => entry.id)).toEqual(['m14be', 'm39', 'm42', 'm43', 'm44', 'm51bd']);
  });

  it('"Not in Form 26" lists the corrected list (29A is not in it; 43, 36B, 24 … are)', () => {
    const listed = whatChangedRows('not-in-form26').notInForm26;
    expect(listed).toEqual(shownNotInForm26('corrected'));
    expect(listed.map((entry) => entry.threeCd)).not.toContain('29A');
    expect(listed.map((entry) => entry.threeCd)).toEqual(expect.arrayContaining(['43', '36B', '24', '28, 29', '25']));
  });

  it('columns: clause, subject, both sections, Form 3CD clause, what changed; "What to ask the client" only when every new row has its sentence', () => {
    const labels = (filter: Form26ChangeFilter) => whatChangedColumns(filter).map((column) => column.label);
    expect(labels('all')).toEqual(['Form 26 clause', 'Subject', 'Section (2025 Act)', 'Section (1961 Act)', 'Form 3CD clause', 'What changed']);
    // No sentence has been given by the owner yet: the column stays "What changed" on the New chip too.
    expect(labels('new')).toEqual(['Form 26 clause', 'Subject', 'Section (2025 Act)', 'Section (1961 Act)', 'Form 3CD clause', 'What changed']);
    expect(labels('not-in-form26')).toEqual(['Form 3CD clause', 'Subject', 'Where it is now']);
  });

  it('cells: Form 26 clause numbers as written in the form, sections, "None" where no Form 3CD clause; the shown (corrected) entry', () => {
    expect(form26RefsText(row('m13_14a'))).toBe('13, 14(a)');
    expect(form26RefsText(row('m14be'))).toBe('14(b)–(e)');
    expect(form26RefsText(row('m51ac'))).toBe('51(a), (c)');
    expect(form26RefsText(row('m37ae'))).toBe('37(a)–(e)');
    expect(whatChangedCells(row('m09'))).toEqual(['9', 'Ground on which audit is conducted', '63; 58(2), 61(2), 58(8)', '44AB; 44AD/44ADA/44AE, 44B etc.; 44AD(5)', '8', 'Same substance; presumptive opt-out shown as a separate ground.']);
    expect(whatChangedCells(row('m39'))[4]).toBe('None');
    expect(whatChangedCells(row('m11ab'))[2]).toBe('—');
    // Row 51(b),(d): its 1961 cell could not be confirmed, so the office's value is shown (data rule of Task 12).
    expect(whatChangedCells(row('m51bd'))[3]).toBe('Provisos to 40(a)(i)/(ia)');
  });

  it('no produced string contains "our reading", "†", "to be verified" or any other hedging word', () => {
    const produced: string[] = [];
    for (const chip of FORM26_CHANGE_FILTERS) {
      const result = whatChangedRows(chip.id);
      produced.push(chip.label, ...whatChangedColumns(chip.id).map((column) => column.label));
      for (const entry of result.rows) produced.push(comparisonLine(entry), ...whatChangedCells(entry));
      for (const entry of result.notInForm26) produced.push(entry.threeCd, entry.subject, entry.position);
    }
    for (const text of produced) expect(text, text).not.toMatch(HEDGING);
  });
});

describe('the briefing (.docx)', () => {
  const unzip = async (filter: Form26ChangeFilter) => {
    const blob = await buildBriefingDocx(filter);
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const xml = await zip.file('word/document.xml')!.async('string');
    const text = (xml.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) ?? [])
      .map((run) => run.replace(/<[^>]*>/g, ''))
      .join(' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    return { blob, xml, text };
  };

  it('a Word file titled "Form No. 26 and Form No. 3CD: what changed" with the filtered table: clause, subject, sections, 3CD clause, what changed', async () => {
    const { blob, xml, text } = await unzip('new');
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(FORM26_BRIEFING_TITLE).toBe('Form No. 26 and Form No. 3CD: what changed');
    expect(text.startsWith(FORM26_BRIEFING_TITLE)).toBe(true);
    for (const label of whatChangedColumns('new').map((column) => column.label)) expect(text).toContain(label);
    for (const entry of whatChangedRows('new').rows) for (const cell of whatChangedCells(entry)) expect(text).toContain(cell);
    // Only the rows on screen: a changed row is not in the "New" briefing.
    expect(text).not.toContain(shownEntry(row('m15')).subject);
    expect((xml.match(/<w:tr[ >]/g) ?? []).length).toBe(1 + 6);
    // Landscape, so the six columns fit one page width.
    expect(xml).toMatch(/w:orient="landscape"/);
  });

  it('every filter: the rows of its chip, and the "Not in Form 26" list with its own columns', async () => {
    for (const chip of FORM26_CHANGE_FILTERS) {
      const { xml, text } = await unzip(chip.id);
      const result = whatChangedRows(chip.id);
      expect((xml.match(/<w:tr[ >]/g) ?? []).length, chip.id).toBe(1 + result.counts[chip.id]);
      expect(text, chip.id).not.toMatch(HEDGING);
      if (chip.id === 'not-in-form26') for (const entry of result.notInForm26) expect(text).toContain(entry.position);
    }
  });

  it('a file name that says what it holds', () => {
    expect(briefingFileName('all')).toBe('Form26_vs_Form3CD_what_changed_all.docx');
    expect(briefingFileName('not-in-form26')).toBe('Form26_vs_Form3CD_what_changed_not_in_form26.docx');
  });
});

describe('years and the setting', () => {
  it('previousYearCodes', () => {
    expect(previousYearCodes('2026-27')).toEqual(['2025-26', '2025-2026']);
    expect(previousYearCodes('FY 2027-2028')).toEqual(['2026-27', '2026-2027']);
    expect(previousYearCodes('Year 26')).toEqual([]);
  });

  it('comparisonOnByDefault: true for 2026-27 only', () => {
    expect(comparisonOnByDefault('2026-27')).toBe(true);
    expect(comparisonOnByDefault('FY 2026-2027')).toBe(true);
    expect(comparisonOnByDefault('2027-28')).toBe(false);
    expect(comparisonOnByDefault('2025-26')).toBe(false);
    expect(comparisonOnByDefault('')).toBe(false);
  });

  it('the switch is remembered per user and engagement on this computer; nothing remembered gives the year\'s default; a storage that fails is no error', () => {
    const held = new Map<string, string>();
    const storage = { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value) };
    const key = form26ComparisonStorageKey('user-1', 'eng-1');
    expect(key).toBe('vera.form26.comparison.user-1.eng-1');
    expect(form26ComparisonStorageKey('user-2', 'eng-1')).not.toBe(key);
    expect(readComparisonSetting(storage, key, '2026-27')).toBe(true);
    expect(readComparisonSetting(storage, key, '2027-28')).toBe(false);
    writeComparisonSetting(storage, key, false);
    expect(readComparisonSetting(storage, key, '2026-27')).toBe(false);
    writeComparisonSetting(storage, key, true);
    expect(readComparisonSetting(storage, key, '2027-28')).toBe(true);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readComparisonSetting(broken, key, '2026-27')).toBe(true);
    expect(() => writeComparisonSetting(broken, key, false)).not.toThrow();
    expect(readComparisonSetting(null, key, '2026-27')).toBe(true);
  });
});

describe('comparison text never enters the exported form (L9)', () => {
  it('the export model text never contains "Was Form 3CD", "New in Form No. 26" or a "What changed" entry', () => {
    const both = exportModelText(buildForm26ExportModel(DEF, defaultValues(DEF), { showAllSchedules: true, generatedAt: '2026-11-22T10:00:00.000Z' }));
    const text = `${both.portrait}\n${both.landscape}`;
    expect(text.length).toBeGreaterThan(1000);
    expect(text).not.toContain('Was Form 3CD');
    expect(text).not.toContain('New in Form No. 26');
    expect(text).not.toContain(shownEntry(row('m14be')).whatChanged.replace(/^NEW\.\s*/, ''));
  });
});
