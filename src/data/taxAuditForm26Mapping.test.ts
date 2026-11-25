import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  FORM26_MAPPING,
  FORM26_MAPPING_OFFICE_MARKS,
  FORM26_MAPPING_SHOWN,
  FORM26_NOT_IN_FORM26,
  isSameSubstance,
  mappingRowsForClause,
  shownEntry,
  shownNotInForm26,
  type Form26MappingEntry,
  type Form26MappingRow,
} from '@/data/taxAuditForm26Mapping';

// Figures: form26/MAPPING-CHECK.md section 5 (its own count), and the office's document itself.
const SOURCE = readFileSync(new URL('./taxAuditForm26Mapping.ts', import.meta.url), 'utf8');
const byId = (id: string): Form26MappingRow => { const row = FORM26_MAPPING.find((r) => r.id === id); if (!row) throw new Error(id); return row; };
const ids = (rows: Form26MappingRow[]) => rows.map((r) => r.id);

// 9, 12(d), 21, 27(a), 27(b), 27(c), 33(b),(c), 34, 35(a),(b), 38, 41(b),(c), 45(a)–(d), 46, 47, 48, 50(a),(b), 51(a),(c), 52(b)
const CORRECTED_IDS = ['m09', 'm12d', 'm21', 'm27a', 'm27b', 'm27c', 'm33bc', 'm34', 'm35ab', 'm38', 'm41bc', 'm45ad', 'm46', 'm47', 'm48', 'm50ab', 'm51ac', 'm52b'];
const CELLS = ['subject', 'section2025', 'section1961', 'whatChanged'] as const;
const sameRefs = (a: Form26MappingEntry, b: Form26MappingEntry) => JSON.stringify(a.threeCd.map((r) => [r.clause, r.part === true])) === JSON.stringify(b.threeCd.map((r) => [r.clause, r.part === true]));
const differing = (cell: (typeof CELLS)[number] | 'threeCd') =>
  FORM26_MAPPING.filter((r) => r.corrected !== null && (cell === 'threeCd' ? !sameRefs(r.corrected, r.office) : r.corrected[cell] !== r.office[cell])).map((r) => r.id);

describe('the clause-by-clause mapping', () => {
  it('52 rows; every Form 26 clause 9 to 53 is covered by at least one row; every sub-clause named in a row exists in the definition', () => {
    expect(FORM26_MAPPING).toHaveLength(52);
    expect(new Set(ids(FORM26_MAPPING)).size).toBe(52);
    for (const row of FORM26_MAPPING) expect(row.id, row.id).toMatch(/^m\d{2}[a-e]{0,4}(_\d{2}[a-e]{0,4})?$/);
    expect(byId('m09').form26).toEqual([{ clause: '9', subs: [] }]);
    expect(byId('m11ab').form26).toEqual([{ clause: '11', subs: ['a', 'b'] }]);
    expect(byId('m14be').form26).toEqual([{ clause: '14', subs: ['b', 'c', 'd', 'e'] }]);
    expect(byId('m13_14a').form26).toEqual([{ clause: '13', subs: [] }, { clause: '14', subs: ['a'] }]);

    const covered = new Set(FORM26_MAPPING.flatMap((r) => r.form26.map((f) => f.clause)));
    for (let clause = 9; clause <= 53; clause += 1) expect(covered.has(String(clause)), `clause ${clause}`).toBe(true);
    expect(covered.size).toBe(45);

    // A sub-clause is a question row of the form, or (clause 52) a schedule opened by the clause's one answer.
    const subExists = (clause: string, sub: string) =>
      DEF.questionRows.some((q) => q.part === 'D' && q.clause === clause && q.sub === sub) || DEF.schedules.some((s) => s.id === `s${clause}${sub}`);
    for (const row of FORM26_MAPPING) {
      for (const ref of row.form26) {
        expect(DEF.questionRows.some((q) => q.part === 'D' && q.clause === ref.clause), `${row.id} clause ${ref.clause}`).toBe(true);
        for (const sub of ref.subs) expect(subExists(ref.clause, sub), `${row.id} ${ref.clause}(${sub})`).toBe(true);
      }
    }
  });

  it('no clause or sub-clause is claimed by two rows, and the rows are in the order of the form', () => {
    const claimed = new Set<string>();
    for (const row of FORM26_MAPPING) {
      for (const ref of row.form26) {
        for (const key of ref.subs.length ? ref.subs.map((s) => `${ref.clause}(${s})`) : [ref.clause]) {
          expect(claimed.has(key), key).toBe(false);
          claimed.add(key);
        }
      }
    }
    const first = FORM26_MAPPING.map((r) => Number(r.form26[0].clause) * 10 + (r.form26[0].subs[0]?.charCodeAt(0) ?? 96) - 96);
    expect([...first].sort((a, b) => a - b)).toEqual(first);
  });

  it('the eleven headings are the office\'s own, in order', () => {
    expect([...new Set(FORM26_MAPPING.map((r) => r.sectionHeading))]).toEqual([
      'A – General Information', 'B – Books of Account and Method of Accounting', 'C – Particulars of Receipt / Income',
      'D – Particulars of Expenses', 'E – Prior Period', 'F – Losses, Depreciation and Deductions', 'G – International Taxation',
      'H – Other Key Parameters', 'I – TDS / TCS', 'J – Indirect Taxation', 'K – Quantitative Details',
    ]);
    const perHeading = FORM26_MAPPING.reduce<Record<string, number>>((acc, r) => { const k = r.sectionHeading[0]; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
    expect(perHeading).toEqual({ A: 6, B: 6, C: 5, D: 12, E: 1, F: 4, G: 5, H: 5, I: 5, J: 2, K: 1 });
  });

  it('18 rows have a corrected entry, 34 have none', () => {
    expect(ids(FORM26_MAPPING.filter((r) => r.corrected !== null))).toEqual(CORRECTED_IDS);
    expect(FORM26_MAPPING.filter((r) => r.corrected === null)).toHaveLength(34);
    for (const id of CORRECTED_IDS) expect(JSON.stringify(byId(id).corrected), id).not.toBe(JSON.stringify(byId(id).office));
  });

  it('the corrected cells are the ones MAPPING-CHECK counts as differing, column by column', () => {
    expect(differing('subject')).toEqual(['m51ac']);                                                   // clause and subject: 1
    expect(differing('section2025')).toEqual(['m51ac']);                                               // 2025 section: 1
    expect(differing('section1961')).toEqual(['m09', 'm27a', 'm34', 'm38', 'm46', 'm51ac']);           // 1961 section: 6
    expect(differing('whatChanged')).toEqual(['m12d', 'm21', 'm27b', 'm27c', 'm35ab', 'm41bc', 'm45ad', 'm46', 'm47', 'm48', 'm50ab', 'm52b']);   // 12
    // Form 3CD clause: the 6 of MAPPING-CHECK (33(b),(c), 34, 41(b),(c), 45, 46, 47) and three the domain review's
    // suggested entries make finer where MAPPING-CHECK confirms the column: 21, 27(a), 51(a),(c).
    expect(differing('threeCd')).toEqual(['m21', 'm27a', 'm33bc', 'm34', 'm41bc', 'm45ad', 'm46', 'm47', 'm51ac']);
  });

  it('not confirmable: 2025 section of row 19; 1961 section of rows 44 and 51(b),(d) — shownEntry returns the office\'s cell there', () => {
    const marked = FORM26_MAPPING.filter((r) => r.notConfirmable !== undefined);
    expect(marked.map((r) => [r.id, r.notConfirmable])).toEqual([['m19', ['section2025']], ['m44', ['section1961']], ['m51bd', ['section1961']]]);
    expect(shownEntry(byId('m19')).section2025).toBe('58, 61');
    expect(shownEntry(byId('m44')).section1961).toBe('56(2)(x) provisos');
    expect(shownEntry(byId('m51bd')).section1961).toBe('Provisos to 40(a)(i)/(ia)');
    for (const row of marked) expect(shownEntry(row), row.id).toEqual(row.office);
    // Of the 34 rows without a difference, 31 are confirmed in every column; the others carry one such cell.
    expect(FORM26_MAPPING.filter((r) => r.corrected === null && r.notConfirmable === undefined)).toHaveLength(31);
    expect(marked.every((r) => r.corrected === null && r.notConfirmable!.length === 1)).toBe(true);
  });

  it('a not-confirmable cell shows the office\'s value even where the row has a corrected entry', () => {
    const office: Form26MappingEntry = { subject: 'Invented subject', section2025: 'office 2025', section1961: 'office 1961', threeCd: [], kind: 'changed', whatChanged: 'Invented.' };
    const corrected: Form26MappingEntry = { ...office, section2025: 'corrected 2025', section1961: 'corrected 1961', whatChanged: 'Invented, corrected.' };
    const row: Form26MappingRow = { id: 'm99', form26: [{ clause: '99', subs: [] }], sectionHeading: 'Invented', office, corrected, notConfirmable: ['section1961'], checkState: 'to_check' };
    expect(shownEntry(row)).toEqual({ ...corrected, section1961: 'office 1961' });
    expect(shownEntry(row, 'corrected')).toEqual({ ...corrected, section1961: 'office 1961' });
    expect(shownEntry(row, 'office')).toBe(office);
    expect(row.corrected).toEqual(corrected);                       // nothing is changed in place
    expect(shownEntry({ ...row, notConfirmable: undefined })).toBe(corrected);
    expect(shownEntry({ ...row, corrected: null })).toBe(office);
  });

  it('office marks 7 rows new (14(b)–(e), 39, 41(b)(c), 42, 43, 44, 51(b)(d)); corrected marks 6 — 41(b),(c) is not new', () => {
    expect(ids(FORM26_MAPPING.filter((r) => r.office.kind === 'new'))).toEqual(['m14be', 'm39', 'm41bc', 'm42', 'm43', 'm44', 'm51bd']);
    expect(ids(FORM26_MAPPING.filter((r) => shownEntry(r, 'corrected').kind === 'new'))).toEqual(['m14be', 'm39', 'm42', 'm43', 'm44', 'm51bd']);
    expect(byId('m41bc').corrected?.kind).toBe('changed');
    expect(byId('m41bc').corrected?.threeCd.map((r) => r.clause)).toEqual(['30B(b)(iv), (v)']);
    for (const row of FORM26_MAPPING) {
      expect(row.office.whatChanged.startsWith('NEW.'), row.id).toBe(row.office.kind === 'new');
      if (row.office.kind === 'new') expect(row.office.threeCd, row.id).toEqual([]);          // the office writes "None"
      if (row.corrected) expect(row.corrected.whatChanged.includes('NEW'), row.id).toBe(false);
    }
  });

  it('kinds: the office has 7 new, 29 changed, 16 same; shown there are 6 new, 33 changed, 13 same', () => {
    const count = (entries: Form26MappingEntry[]) => ({ new: entries.filter((e) => e.kind === 'new').length, changed: entries.filter((e) => e.kind === 'changed').length, same: entries.filter((e) => e.kind === 'same').length });
    expect(count(FORM26_MAPPING.map((r) => r.office))).toEqual({ new: 7, changed: 29, same: 16 });
    expect(count(FORM26_MAPPING.map((r) => shownEntry(r)))).toEqual({ new: 6, changed: 33, same: 13 });
    // One rule: "same" is said only where the entry itself says the substance has not changed.
    for (const row of FORM26_MAPPING) {
      for (const entry of [row.office, row.corrected]) {
        if (entry) expect(entry.kind === 'same', `${row.id}: ${entry.whatChanged}`).toBe(entry.whatChanged.startsWith('No change in substance'));
      }
    }
  });

  it('isSameSubstance follows the corrected entry', () => {
    expect(isSameSubstance(byId('m15'))).toBe(true);
    expect(isSameSubstance(byId('m10'))).toBe(true);
    expect(isSameSubstance(byId('m12d'))).toBe(true);      // the office says changed; Form 3CD already had both columns
    expect(isSameSubstance(byId('m48'))).toBe(false);      // the office says no change; the question now goes to the payer
    expect(isSameSubstance(byId('m27b'))).toBe(false);
    expect(isSameSubstance(byId('m41bc'))).toBe(false);
    expect(isSameSubstance(byId('m12c'))).toBe(false);     // "Moved up into General Information."
    expect(ids(FORM26_MAPPING.filter(isSameSubstance))).toEqual(['m10', 'm12d', 'm15', 'm19', 'm22', 'm23', 'm29', 'm32ab', 'm33a', 'm37ae', 'm40', 'm41a', 'm50c']);
  });

  it('the switch: one constant; with \'office\' shownEntry returns the office entry for all 52 rows', () => {
    expect(FORM26_MAPPING_SHOWN).toBe('corrected');
    for (const row of FORM26_MAPPING) {
      expect(shownEntry(row, 'office'), row.id).toBe(row.office);
      expect(shownEntry(row), row.id).toEqual(shownEntry(row, FORM26_MAPPING_SHOWN));
      if (row.corrected && !row.notConfirmable) expect(shownEntry(row), row.id).toBe(row.corrected);
      if (!row.corrected) expect(shownEntry(row), row.id).toBe(row.office);
    }
    // The switch is used as the default of both functions and written nowhere else.
    expect(SOURCE.match(/FORM26_MAPPING_SHOWN/g)).toHaveLength(3);
    expect(SOURCE).toMatch(/export const FORM26_MAPPING_SHOWN: 'corrected' \| 'office' = 'corrected';/);
    expect(SOURCE.match(/= FORM26_MAPPING_SHOWN\)/g)).toHaveLength(2);
    expect(shownNotInForm26('office')).toHaveLength(7);
  });

  it('the shown entry is the corrected one (examples)', () => {
    expect(shownEntry(byId('m09')).section1961).toBe('44AB; 44AD/44ADA/44AE, 44B etc.; 44AD(5)');
    expect(byId('m09').office.section1961).toBe('44AB; 44AD/44ADA/44AE, 44B etc.; 44AD(4)');
    const tds = shownEntry(byId('m51ac'));
    expect(tds.section2025).toBe('51(a): 35(b)(i), 30%; 51(c): 35(b)(ii), 100%');
    expect(tds.section1961).toBe('51(a): 40(a)(ia); 51(c): 40(a)(i)');
    expect(tds.threeCd.map((r) => r.clause)).toEqual(['21(b)(ii)', '21(b)(i)']);
    expect(byId('m51ac').office.section1961).toBe('40(a)(i), 40(a)(ia)');
    expect(shownEntry(byId('m34')).threeCd.map((r) => r.clause)).toEqual(['19']);
    expect(shownEntry(byId('m21')).threeCd.map((r) => r.clause)).toEqual(['16', '25', '24', '29A', '36B', '36A']);
    expect(shownEntry(byId('m46')).threeCd.map((r) => r.clause)).toEqual(['42']);
    expect(shownEntry(byId('m47')).threeCd).toEqual([]);
    expect(shownEntry(byId('m33bc')).threeCd.map((r) => r.clause)).toEqual(['22(ii), (iii)']);
    expect(shownEntry(byId('m15'))).toMatchObject({ kind: 'same', whatChanged: 'No change in substance.', threeCd: [{ clause: '13(a)–(c)' }] });
  });

  it('the office\'s entries are held as written, without its marks', () => {
    expect(byId('m26').office).toEqual({
      subject: 'Expenditure relating to exempt income', section2025: '14', section1961: '14A',
      threeCd: [{ clause: '21(h)', subject: 'Expenditure relating to exempt income' }], kind: 'changed',
      whatChanged: 'Expressly covers years where exempt income has not accrued or been received.',
    });
    expect(byId('m27a').office.threeCd).toEqual([
      { clause: '20', subject: 'Disallowance under 29, 31 and 32' },
      { clause: '21', part: true, subject: 'Disallowance under 29, 31 and 32' },
    ]);
    expect(byId('m21').office.threeCd.map((r) => r.clause)).toEqual(['16', '25']);
    expect(byId('m46').office.threeCd.map((r) => r.clause)).toEqual(['42', '43']);
    expect(byId('m47').office.threeCd.map((r) => r.clause)).toEqual(['28', '29']);
    expect(byId('m11ab').office.section2025).toBe('');                 // the office's dash: no entry
    expect(byId('m42').office.whatChanged).toBe('NEW.');
    expect(byId('m14be').office).toMatchObject({ section2025: 'Rule 46(8) of 2026 Rules', section1961: '', threeCd: [], kind: 'new', whatChanged: 'NEW. Digital trail of books is now a reporting item.' });
    // Its dagger marks (8 rows, 12 marks) and its two reminders are kept apart from the text.
    expect(Object.keys(FORM26_MAPPING_OFFICE_MARKS)).toEqual(['m26', 'm27a', 'm27b', 'm36', 'm39', 'm42', 'm43', 'm46']);
    expect(Object.values(FORM26_MAPPING_OFFICE_MARKS).reduce((n, m) => n + m.daggerCells.length, 0)).toBe(12);
    expect(Object.entries(FORM26_MAPPING_OFFICE_MARKS).filter(([, m]) => m.note !== undefined).map(([id]) => id)).toEqual(['m27a', 'm42']);
    for (const id of Object.keys(FORM26_MAPPING_OFFICE_MARKS)) expect(FORM26_MAPPING.some((r) => r.id === id), id).toBe(true);
  });

  it('check state is data only: one row rests on the office\'s own addition, two wait for a text not yet read', () => {
    expect(FORM26_MAPPING.filter((r) => r.checkState !== 'checked').map((r) => [r.id, r.checkState])).toEqual([['m19', 'our_reading'], ['m44', 'to_check'], ['m51bd', 'to_check']]);
  });

  it('every 3CD reference carries its own subject text', () => {
    expect(SOURCE).not.toMatch(/taxAudit3CDClauses|FORM_3CD_CLAUSES/);
    expect(SOURCE).not.toMatch(/^import /m);                           // the mapping stands on its own
    let references = 0;
    for (const row of FORM26_MAPPING) {
      for (const entry of [row.office, row.corrected]) {
        for (const ref of entry?.threeCd ?? []) {
          references += 1;
          expect(ref.clause, row.id).toMatch(/^\d/);
          expect(ref.subject.trim().length, `${row.id} ${ref.clause}`).toBeGreaterThan(5);
          if (ref.part !== undefined) expect(ref.part).toBe(true);
        }
      }
    }
    expect(references).toBeGreaterThan(70);
    // Form 3CD clauses VERA's own list does not hold (28, 29) or the office never lists (24, 36B) have their text here.
    expect(byId('m47').office.threeCd.every((r) => r.subject === 'Transactions in unquoted shares')).toBe(true);
    expect(shownEntry(byId('m21')).threeCd.find((r) => r.clause === '36B')?.subject).toContain('buyback of shares');
  });

  it('mappingRowsForClause', () => {
    expect(ids(mappingRowsForClause('13'))).toEqual(['m13_14a']);
    expect(ids(mappingRowsForClause('14', 'a'))).toEqual(['m13_14a']);
    expect(ids(mappingRowsForClause('14', 'b'))).toEqual(['m14be']);
    expect(ids(mappingRowsForClause('14', 'e'))).toEqual(['m14be']);
    expect(ids(mappingRowsForClause('14'))).toEqual(['m13_14a', 'm14be']);
    expect(ids(mappingRowsForClause('14', null))).toEqual(['m13_14a', 'm14be']);
    expect(ids(mappingRowsForClause('15', 'a'))).toEqual(['m15']);        // a row for the whole clause covers each of its sub-clauses
    expect(ids(mappingRowsForClause('51', 'c'))).toEqual(['m51ac']);
    expect(ids(mappingRowsForClause('51', 'd'))).toEqual(['m51bd']);
    expect(ids(mappingRowsForClause('52'))).toEqual(['m52a', 'm52b']);
    expect(ids(mappingRowsForClause('18'))).toEqual(['m17_18']);
    expect(mappingRowsForClause('8')).toEqual([]);
    expect(mappingRowsForClause('54')).toEqual([]);
    expect(mappingRowsForClause('14', 'z')).toEqual([]);
    // Every question row of Part D from clause 9 on finds its row(s).
    for (const q of DEF.questionRows.filter((r) => r.part === 'D' && Number(r.clause) >= 9)) {
      expect(mappingRowsForClause(q.clause, q.sub).length, `${q.clause}(${q.sub})`).toBeGreaterThan(0);
    }
  });
});

describe('Form 3CD clauses without a clause of their own in Form 26', () => {
  it('not in Form 26: the office lists 7 (25, 27(a), 29A, 30C, 36, 38–39, 41); the corrected list does not contain 29A and contains 36B', () => {
    const office = shownNotInForm26('office');
    expect(office.map((r) => r.threeCd)).toEqual(['25', '27(a)', '29A', '30C', '36', '38, 39', '41']);
    expect(office.map((r) => r.position)).toEqual([
      'No separate clause; appears to be covered by clause 21.', 'Not found in the file.', 'Not found in the file.', 'Not found in the file.',
      'Dropped (already obsolete).', 'Dropped.', 'Not found in the file.',
    ]);
    const corrected = shownNotInForm26('corrected');
    expect(corrected.map((r) => r.threeCd)).toEqual([
      '25', '27(a)', '30C', '36', '38, 39', '41',
      // the nine clauses or limbs MAPPING-CHECK section 3 adds
      '43', '36B', '28, 29', '24', '11(a), 11(c)', '16(a)–(c)', '18 (detail)', '26 (closing words)', '21(b)(i), (ii) detail',
    ]);
    expect(shownNotInForm26()).toEqual(corrected);
    expect(FORM26_NOT_IN_FORM26).toHaveLength(16);
    expect(new Set(FORM26_NOT_IN_FORM26.map((r) => r.id)).size).toBe(16);
  });

  it('of the office\'s 7 rows, 6 stand and 1 (29A) is in Form 26 after all', () => {
    const officeRows = FORM26_NOT_IN_FORM26.filter((r) => r.office !== null);
    expect(officeRows.filter((r) => r.corrected === null).map((r) => r.office!.threeCd)).toEqual(['29A']);
    // Two stand word for word; three stand as "Not in Form 26."; row 25 stands with its wording made firm.
    expect(officeRows.filter((r) => r.corrected !== null && JSON.stringify(r.corrected) === JSON.stringify(r.office)).map((r) => r.office!.threeCd)).toEqual(['36', '38, 39']);
    const notIn = officeRows.filter((r) => r.office!.position === 'Not found in the file.' && r.corrected !== null);
    expect(notIn.map((r) => [r.corrected!.threeCd, r.corrected!.subject, r.corrected!.position])).toEqual(notIn.map((r) => [r.office!.threeCd, r.office!.subject, 'Not in Form 26.']));
    expect(notIn.map((r) => r.office!.threeCd)).toEqual(['27(a)', '30C', '41']);
    const r25 = officeRows.find((r) => r.office!.threeCd === '25')!;
    expect(r25.corrected).toEqual({ threeCd: '25', subject: 'Profits chargeable under section 41', position: 'No separate clause; covered by row "(iv) 38" of the table headed "20.", which opens under clause 20.' });
    expect(FORM26_NOT_IN_FORM26.filter((r) => r.office === null)).toHaveLength(9);
    expect(FORM26_NOT_IN_FORM26.every((r) => r.office !== null || r.corrected !== null)).toBe(true);
    // 29A has its place in the mapping itself: the row of clause 21.
    expect(shownEntry(byId('m21')).threeCd.some((r) => r.clause === '29A')).toBe(true);
  });

  it('every entry has a clause, a subject and a position', () => {
    for (const row of FORM26_NOT_IN_FORM26) {
      for (const entry of [row.office, row.corrected]) {
        if (!entry) continue;
        expect(entry.threeCd, row.id).toMatch(/^\d/);
        expect(entry.subject.length, row.id).toBeGreaterThan(5);
        expect(entry.position.length, row.id).toBeGreaterThan(5);
      }
    }
  });
});

describe('nothing on screen marks the tool\'s own content as doubtful (R7)', () => {
  const shownStrings = (): string[] => {
    const out: string[] = [];
    for (const row of FORM26_MAPPING) {
      const e = shownEntry(row);
      out.push(row.sectionHeading, e.subject, e.section2025, e.section1961, e.whatChanged, e.askClient ?? '');
      for (const ref of e.threeCd) out.push(ref.clause, ref.subject);
    }
    for (const e of shownNotInForm26()) out.push(e.threeCd, e.subject, e.position);
    return out;
  };

  it('no text in the file contains "our reading", "to be verified", "†", "sic"', () => {
    const lower = SOURCE.toLowerCase();
    for (const banned of ['our reading', 'to be verified', '†', '[sic]', "editor's note", 'mock-up']) expect(lower.includes(banned), banned).toBe(false);
    expect(/\bsic\b/i.test(SOURCE)).toBe(false);
  });

  it('no hedging words in any shown string', () => {
    const hedges = ['our reading', 'to be verified', '†', 'appear', 'check against', 'not confirmable', 'as far as', 'to check', 'unsure', 'perhaps', 'probably', 'presumably', 'may be', 'might', 'seems', 'tbc', 'todo', 'editor', 'mock-up', 'draft', '?'];
    for (const text of shownStrings()) {
      const lower = text.toLowerCase();
      for (const hedge of hedges) expect(lower.includes(hedge), `"${text}" has "${hedge}"`).toBe(false);
      expect(/\bsic\b/i.test(text), text).toBe(false);
    }
  });

  it('shown strings are clean text: no dash standing for "none", no stray spaces, no line breaks', () => {
    for (const text of shownStrings()) {
      expect(text, JSON.stringify(text)).toBe(text.trim());
      expect(/[\r\n\t]| {2}/.test(text), JSON.stringify(text)).toBe(false);
      expect(['—', '-', 'None', 'none', 'N/A'].includes(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('the office\'s own hedged wording stays in its entry, behind the switch', () => {
    expect(byId('m21').office.whatChanged).toBe('Section 41-type receipts appear to fall here.');
    expect(shownEntry(byId('m21')).whatChanged).toBe('Section 41-type receipts fall in row "(iv) 38" of the table headed "20.", which opens under clause 20.');
    expect(FORM26_MAPPING_OFFICE_MARKS.m42.note).toBe('Check against notified Rules.');
  });

  it('no shown string speaks of "the file" (the office\'s search result): a Form 3CD clause with no place says "Not in Form 26."', () => {
    for (const text of shownStrings()) expect(/\bthe file\b/i.test(text), text).toBe(false);
    expect(shownNotInForm26().filter((e) => ['27(a)', '30C', '41'].includes(e.threeCd)).map((e) => e.position)).toEqual(['Not in Form 26.', 'Not in Form 26.', 'Not in Form 26.']);
    // The office's own words are kept in its entries, untouched.
    expect(shownNotInForm26('office').filter((e) => e.position === 'Not found in the file.').map((e) => e.threeCd)).toEqual(['27(a)', '29A', '30C', '41']);
  });

  it('no shown string sends a row of the table headed "20." to clause 21: the tool opens that table under clause 20', () => {
    // As built (AS-BUILT-DEFINITION, schedules s20 and s21): "Yes" at clause 20 opens the table headed "20.",
    // whose fixed rows are these; "Yes" at clause 21 opens the table headed "21." (section 92(2)(m)).
    const s20 = DEF.tables.find((t) => t.id === 'S20')!;
    expect(DEF.schedules.find((s) => s.id === 's20')).toMatchObject({ showIf: 'c20' });
    expect(DEF.schedules.find((s) => s.id === 's21')).toMatchObject({ showIf: 'c21' });
    expect(s20.fixedRows?.length).toBe(13);
    const prose = (): string[] => {
      const out: string[] = [];
      for (const row of FORM26_MAPPING) { const e = shownEntry(row); out.push(e.subject, e.whatChanged, e.askClient ?? ''); for (const ref of e.threeCd) out.push(ref.subject); }
      for (const e of shownNotInForm26()) out.push(e.subject, e.position);
      return out;
    };
    const citesTable20 = (text: string) => text.includes('headed "20."') || /\brows? "?\((?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii)\)/.test(text);
    let cited = 0;
    for (const text of prose()) {
      expect(/\bclause 21\b/i.test(text), text).toBe(false);
      if (!citesTable20(text)) continue;
      cited += 1;
      expect(text, text).toContain('of the table headed "20.", which opens under clause 20');
    }
    expect(cited).toBe(6);                                       // m21, m48 and the not-in rows 25, 36B, 24, 16(a)–(c)
    expect(shownEntry(byId('m48')).whatChanged).toBe('Now asked of the payer. The receipt is reported in row "(i) 2(40)(e)" of the table headed "20.", which opens under clause 20.');
  });
});
