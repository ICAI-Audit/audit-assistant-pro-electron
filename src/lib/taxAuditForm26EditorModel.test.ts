import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import type { Form26Node } from '@/data/taxAuditForm26Types';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import {
  buildEditorModel,
  editorTitle,
  fieldConflictLine,
  fieldProvenance,
  FORM26_CONFLICT_ACTION_LABEL,
  FORM26_PROVENANCE_LABEL,
  FORM26_REVIEW_LABEL,
  form26CellDomId,
  form26ClockTime,
  form26FieldAccessibleName,
  form26FieldDomId,
  form26FieldLabelId,
  form26FieldLocalLabel,
  form26LeaveAction,
  form26NodeText,
  form26SaveStatus,
  form26ScheduleDomId,
  form26WordingId,
  parseWordingHtml,
  proseFieldInline,
  signatureClosing,
  signatureFields,
  yesNoForKey,
  type Form26EditorBlock,
} from '@/lib/taxAuditForm26EditorModel';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';

type UnfilledState = { name: string; values: Form26Values };
const STATES = JSON.parse(
  readFileSync(new URL('./__fixtures__/taxAuditForm26/unfilled.json', import.meta.url), 'utf8'),
) as UnfilledState[];
const stateValues = (name: string): Form26Values => {
  const state = STATES.find((entry) => entry.name === name);
  if (!state) throw new Error(`no fixture state ${name}`);
  return JSON.parse(JSON.stringify(state.values)) as Form26Values;
};

const NORMAL = { showAllSchedules: false };
const OPTS = { comparison: false };
const blocks = (clauseKey: string, values: Form26Values = defaultValues(DEF)) => buildEditorModel(DEF, clauseKey, values, NORMAL, OPTS);

/** A short name for each block, to compare orders. */
function shape(block: Form26EditorBlock): string {
  switch (block.kind) {
    case 'question':
      return `q${block.row.index}`;
    case 'table':
      return `t:${block.tableId}${block.shown ? '' : '(hidden)'}`;
    case 'schedule':
      return `s:${block.scheduleId}${block.shown ? '' : '(hidden)'}`;
    case 'signature':
      return `sign:${block.prefix}`;
    default:
      return block.kind;
  }
}

const fieldsIn = (nodes: Form26Node[]): string[] => {
  const keys: string[] = [];
  const walk = (list: Form26Node[]) => {
    for (const node of list) {
      if (typeof node === 'string') continue;
      if ('f' in node) keys.push(node.f);
      else if ('k' in node && node.k) walk(node.k);
    }
  };
  walk(nodes);
  return keys;
};

function row(clauseKey: string, patch: Partial<Form26ClauseRow> = {}): Form26ClauseRow {
  return {
    id: `row-${clauseKey}`,
    tax_audit_id: 'audit-1',
    clause_key: clauseKey,
    clause_no: clauseKey,
    clause_title: clauseKey,
    statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION,
    applicability_status: 'applicable',
    prefill_status: 'not_attempted',
    validation_status: 'not_run',
    qualification_required: 0,
    review_status: 'draft',
    locked: 0,
    ...patch,
  };
}

describe('Form 26 clause editor model', () => {
  it('the editor of clause 14 has, in order: 14(a) wording, table P14a, (b), (c), (d), (e)', () => {
    const model = blocks('f26_c14');
    expect(model.map(shape)).toEqual(['q19', 't:P14a', 'q21', 'q22', 'q23', 'q24']);
    const wordings = model.filter((block): block is Extract<Form26EditorBlock, { kind: 'question' }> => block.kind === 'question').map((block) => block.row.wording);
    expect(wordings[0]).toMatch(/^\(a\) Address at which such books of account are maintained/);
    expect(wordings[4]).toBe('(e) If yes, furnish address of location where backup server is located in India');
    // 14(e) is asked whatever 14(d) holds, as in the file.
    const values = defaultValues(DEF);
    values.f.c14d = 'No';
    expect(blocks('f26_c14', values).map(shape)).toEqual(['q19', 't:P14a', 'q21', 'q22', 'q23', 'q24']);
  });

  it('clause 12: (a) with its link text, schedule s12a shown, (b), s12b only when c12b is Yes, (c), s12c, (d), table P12d', () => {
    const atOpen = blocks('f26_c12');
    expect(atOpen.map(shape)).toEqual(['q13', 's:s12a', 'q14', 's:s12b(hidden)', 'q15', 's:s12c(hidden)', 'q16', 't:P12d']);
    const first = atOpen[0] as Extract<Form26EditorBlock, { kind: 'question' }>;
    expect(form26NodeText(first.answer)).toBe('Refer Schedule – General Information');
    const values = defaultValues(DEF);
    values.f.c12b = 'Yes';
    expect(blocks('f26_c12', values).map(shape)).toEqual(['q13', 's:s12a', 'q14', 's:s12b', 'q15', 's:s12c(hidden)', 'q16', 't:P12d']);
    // The link line of 12(b) is on screen only with Yes.
    const b = (model: Form26EditorBlock[]) => form26NodeText((model[2] as Extract<Form26EditorBlock, { kind: 'question' }>).answer);
    expect(b(atOpen)).toBe('');
    expect(b(blocks('f26_c12', values))).toBe('If yes, refer Schedule – General Information');
    // "Show all schedules" opens them all, the inline lines stay with their answers.
    const all = buildEditorModel(DEF, 'f26_c12', defaultValues(DEF), { showAllSchedules: true }, OPTS);
    expect(all.map(shape)).toEqual(['q13', 's:s12a', 'q14', 's:s12b', 'q15', 's:s12c', 'q16', 't:P12d']);
    expect(b(all)).toBe('');
  });

  it('clause 53 with c53b Yes shows s53bi and s53bii under 53(b)', () => {
    const values = defaultValues(DEF);
    values.f.c53b = 'Yes';
    expect(blocks('f26_c53', values).map(shape)).toEqual(['q88', 's:s53a(hidden)', 'q89', 's:s53bi', 's:s53bii']);
    expect(blocks('f26_c53').map(shape)).toEqual(['q88', 's:s53a(hidden)', 'q89', 's:s53bi(hidden)', 's:s53bii(hidden)']);
  });

  it('clause 24 shows the amount line only when c24 is Yes (inline item)', () => {
    const answerOf = (values: Form26Values) => (blocks('f26_c24', values)[0] as Extract<Form26EditorBlock, { kind: 'question' }>).answer;
    const values = defaultValues(DEF);
    expect(fieldsIn(answerOf(values))).toEqual(['c24']);
    values.f.c24 = 'Yes';
    expect(fieldsIn(answerOf(values))).toEqual(['c24', 'c24_amt']);
    expect(form26NodeText(answerOf(values))).toBe('If yes, amount (₹): ');
    values.f.c24 = 'yes';
    expect(fieldsIn(answerOf(values))).toEqual(['c24']);
  });

  it('every one of the 90 question rows, 65 tables and 55 schedules appears in exactly one clause\'s editor model when every answer is Yes', () => {
    const values = stateValues('state allYes');
    const rows: number[] = [];
    const tables: string[] = [];
    const schedules: string[] = [];
    for (const unit of FORM26_CLAUSE_UNITS) {
      for (const block of buildEditorModel(DEF, unit.key, values, NORMAL, OPTS)) {
        if (block.kind === 'question') rows.push(block.row.index);
        if (block.kind === 'table') {
          tables.push(block.tableId);
          const table = DEF.tables.find((entry) => entry.id === block.tableId);
          if (table?.questionRow !== null && table?.questionRow !== undefined) rows.push(table.questionRow);
          if (table?.category !== '1') expect(block.shown, block.tableId).toBe(true);
        }
        if (block.kind === 'schedule') {
          schedules.push(block.scheduleId);
          tables.push(...block.tables);
          expect(block.shown, block.scheduleId).toBe(true);
        }
      }
    }
    expect([...rows].sort((a, b) => a - b)).toEqual(DEF.questionRows.map((entry) => entry.index));
    expect(rows).toHaveLength(90);
    expect([...tables].sort()).toEqual(DEF.tables.map((table) => table.id).sort());
    expect(tables).toHaveLength(65);
    expect([...schedules].sort()).toEqual(DEF.schedules.map((schedule) => schedule.id).sort());
    expect(schedules).toHaveLength(55);
  });

  it('a question block carries its row and the answer as shown; the comparison lines only when the comparison is on (task 25)', () => {
    let lines = 0;
    for (const unit of FORM26_CLAUSE_UNITS) {
      for (const block of buildEditorModel(DEF, unit.key, defaultValues(DEF), NORMAL, { comparison: true })) {
        if (block.kind !== 'question') continue;
        expect(block.shown).toBe(true);
        expect(block.row.fullWidth).toBe(false);
        lines += block.comparison.length;
      }
      for (const block of buildEditorModel(DEF, unit.key, defaultValues(DEF), NORMAL, { comparison: false })) {
        if (block.kind === 'question') expect(block.comparison).toEqual([]);
      }
    }
    // 52 mapping rows; the four that name two clauses ("13, 14(a)", "17, 18", "24, 25", "30, 31") are shown under each.
    expect(lines).toBe(56);
  });

  it('radio options of one answer become one field in place of the first option (clause 9, 15(a), category)', () => {
    const q9 = blocks('f26_c9')[0] as Extract<Form26EditorBlock, { kind: 'question' }>;
    expect(q9.answer).toEqual([{ f: 'q9' }]);
    const c15a = blocks('f26_c15')[0] as Extract<Form26EditorBlock, { kind: 'question' }>;
    expect(c15a.answer).toEqual([{ f: 'c15a' }]);
  });

  it('category: the heading, the two radio options as one field, and the file\'s hint on the categories (marked not exported)', () => {
    const model = blocks('f26_category');
    expect(model.map((block) => block.kind)).toEqual(['prose', 'prose', 'prose']);
    const prose = model as Extract<Form26EditorBlock, { kind: 'prose' }>[];
    expect(prose.map((block) => block.exported)).toEqual([true, true, false]);
    expect(prose.map((block) => form26NodeText(block.nodes))).toEqual([
      'FORM NO. 26[See rule 47]Audit report and Statement of particulars required to be furnished under section 63',
      'Category of assessee (select one)',
      'Category (i) shows Parts A, C and D. Category (ii) shows Parts B, C and D.',
    ]);
    expect(fieldsIn(prose[1].nodes)).toEqual(['cat']);
    expect(prose[1].nodes).toContainEqual({ f: 'cat' });
  });

  it('the file\'s "Tip" about its own tabs and "Export to Word" button is not shown: the workspace has neither (lead\'s ruling)', () => {
    const text = blocks('f26_category').map((block) => (block.kind === 'prose' ? form26NodeText(block.nodes) : '')).join(' ');
    expect(text).not.toContain('Tip:');
    expect(text).not.toContain('Export to Word');
    expect(text).not.toContain('Schedules tab');
  });

  it('Part A: the prose of the panel in order with its tables (3(b) only with A.q3a Yes), the signature and the notes; Part B likewise', () => {
    const values = defaultValues(DEF);
    values.f.cat = '1';
    const partA = blocks('f26_part_a', values);
    expect(partA.map(shape)).toEqual(['prose', 't:A3b(hidden)', 'prose', 't:A5', 'sign:A', 'notes']);
    const firstText = form26NodeText((partA[0] as Extract<Form26EditorBlock, { kind: 'prose' }>).nodes);
    expect(firstText.startsWith('PART AAudit report under section 63, in a case where the accounts')).toBe(true);
    expect(firstText).not.toContain('(b) If yes, effect of such observations');
    expect(fieldsIn((partA[0] as Extract<Form26EditorBlock, { kind: 'prose' }>).nodes)).toEqual(['A.assessee', 'A.auditor', 'A.act', 'A.rdate', 'A.pl', 'A.from', 'A.to', 'A.bs', 'A.q3a']);
    values.f['A.q3a'] = 'Yes';
    const open = blocks('f26_part_a', values);
    expect(open.map(shape)).toEqual(['prose', 't:A3b', 'prose', 't:A5', 'sign:A', 'notes']);
    expect(form26NodeText((open[0] as Extract<Form26EditorBlock, { kind: 'prose' }>).nodes)).toContain(
      '(b) If yes, effect of such observations/qualifications/adverse remark/disclaimer/emphasis of matter in income or loss or book profit, which has not been considered in particulars filed in Part D of Form No. 26',
    );
    const notes = open[5] as Extract<Form26EditorBlock, { kind: 'notes' }>;
    expect(form26NodeText(notes.nodes)).toContain('Delete whichever is not applicable.');

    const partB = blocks('f26_part_b');
    expect(partB.map(shape)).toEqual(['prose', 't:B3b(hidden)', 'prose', 't:B5', 'sign:B', 'notes']);
    expect(fieldsIn((partB[0] as Extract<Form26EditorBlock, { kind: 'prose' }>).nodes)).toEqual(['B.bs', 'B.pl', 'B.from', 'B.to', 'B.ho', 'B.br', 'B.obs', 'B.q3b']);
    expect(fieldsIn((partB[2] as Extract<Form26EditorBlock, { kind: 'prose' }>).nodes)).toEqual(['B.res']);
    // Part A's table A5 is hidden while category (ii) is chosen.
    expect(blocks('f26_part_a').map(shape)).toContain('t:A5(hidden)');
  });

  it('signature: the signature block of Part D and the Notes', () => {
    const model = blocks('f26_sign');
    expect(model.map(shape)).toEqual(['sign:D', 'notes']);
    const notes = model[1] as Extract<Form26EditorBlock, { kind: 'notes' }>;
    expect(form26NodeText(notes.nodes)).toContain('The code for the nature of amount/ receipt/repayment is as below – ');
    expect(form26NodeText(notes.nodes)).toContain('Some of the information in the Form would be pre-filled to the extent possible.');
    expect(signatureFields(DEF, 'D').map((field) => field.key)).toEqual(['D.place', 'D.date', 'D.name', 'D.mrn', 'D.pan', 'D.udin', 'D.firm', 'D.frn']);
    expect(signatureFields(DEF, 'A').map((field) => field.key)).toEqual(['A.place', 'A.date', 'A.name', 'A.mrn', 'A.pan', 'A.udin', 'A.firm', 'A.frn']);
  });

  it('a schedule block holds its heading, tables, notes and its body in the file\'s order', () => {
    const values = defaultValues(DEF);
    values.f.c34 = 'Yes';
    values.f.c36 = 'Yes';
    const s34 = blocks('f26_c34', values).find((block) => block.kind === 'schedule') as Extract<Form26EditorBlock, { kind: 'schedule' }>;
    expect(s34.title).toBe('34. Particulars of amounts allowable as deduction under sections: (a) Furnish particulars');
    expect(s34.tables).toEqual(['S34a', 'S34b']);
    expect(s34.notes).toEqual([{ t: 'p', k: ['(b) Furnish particulars'] }]);
    expect(s34.body).toEqual([{ tbl: 'S34a' }, { t: 'p', k: ['(b) Furnish particulars'] }, { tbl: 'S34b' }]);
    const s36 = blocks('f26_c36', values).find((block) => block.kind === 'schedule') as Extract<Form26EditorBlock, { kind: 'schedule' }>;
    expect(s36.tables).toEqual(['Dpm', 'Dot']);
    expect(form26NodeText(s36.notes)).toContain('you can overwrite any figure.');
    expect(s36.body.filter((node) => typeof node !== 'string' && 'tbl' in node)).toEqual([{ tbl: 'Dpm' }, { tbl: 'Dot' }]);
  });

  it('wording: the allow-list renderer gives back every row\'s wording character for character', () => {
    let rowsWithWording = 0;
    for (const entry of DEF.questionRows) {
      if (entry.wordingHtml === null) continue;
      rowsWithWording += 1;
      expect(form26NodeText(parseWordingHtml(entry.wordingHtml)), String(entry.index)).toBe(entry.wording);
    }
    expect(rowsWithWording).toBe(86);
    expect(parseWordingHtml('Name <em>(refer Note 1)</em>')).toEqual(['Name ', { t: 'em', k: ['(refer Note 1)'] }]);
    expect(parseWordingHtml('profit &amp; loss<br>next')).toEqual(['profit & loss', { t: 'br' }, 'next']);
    expect(parseWordingHtml('<strong>a</strong> <a href="#s12a">b</a>')).toEqual([{ t: 'strong', k: ['a'] }, ' ', { t: 'a', a: { href: '#s12a' }, k: ['b'] }]);
    // Anything outside the allow-list is kept as its text only.
    expect(parseWordingHtml('<script>x</script><span onclick="y">z</span>')).toEqual(['xz']);
  });

  it('every answer has a name tied to its visible label', () => {
    expect(form26FieldLocalLabel(DEF, 'C.a1')).toBe('Country/Region');
    expect(form26FieldAccessibleName(DEF, 'C.a1')).toBe('Address (refer Note 2) Country/Region');
    expect(form26FieldLocalLabel(DEF, 'C.ph')).toBe('Number');
    expect(form26FieldLocalLabel(DEF, 'c14d')).toBe('');
    expect(form26FieldAccessibleName(DEF, 'c14d')).toBe('(d) Whether provisions of rule 46(8) have been complied with?');
    expect(form26FieldLocalLabel(DEF, 'c24_amt')).toBe('If yes, amount (₹)');
    expect(form26FieldLocalLabel(DEF, 'c16a1')).toBe('(i) Finished goods');
    expect(form26FieldLocalLabel(DEF, 'c16a2')).toBe('(ii) Raw material');
    expect(form26FieldLocalLabel(DEF, 'c37b_amt')).toBe('(ii) Amount of brought forward loss that can not be allowed to be carried forward (₹)');
    expect(form26FieldAccessibleName(DEF, 'q9')).toBe('Relevant provision under which the audit has been conducted (select one)');
    expect(form26FieldAccessibleName(DEF, 'cat')).toBe('Category of assessee (select one)');
    expect(form26FieldAccessibleName(DEF, 'A.assessee')).toBe('1. I report that the statutory audit of');
    expect(form26FieldAccessibleName(DEF, 'A.bs')).toBe('(b) the audited balance sheet and notes to accounts as at');
    expect(form26FieldAccessibleName(DEF, 'B.br')).toBe('and branches (total number of branches).');
    expect(form26FieldAccessibleName(DEF, 'B.obs')).toBe('3. (a) I report the following observations/comments/discrepancies/inconsistencies; if any');
    expect(form26FieldAccessibleName(DEF, 'A.place')).toBe('Place');
    expect(form26FieldAccessibleName(DEF, 'D.udin')).toBe('Unique Document Identification Number (UDIN), if any');
    for (const field of DEF.fields) expect(form26FieldAccessibleName(DEF, field.key).trim(), field.key).not.toBe('');
    expect(() => form26FieldAccessibleName(DEF, 'nope')).toThrow();
  });

  it('ids on screen are fixed, distinct and safe', () => {
    expect(form26FieldDomId('C.a1')).toBe('f26-f-C-a1');
    expect(form26FieldLabelId('C.a1')).toBe('f26-f-C-a1-label');
    expect(form26WordingId(23)).toBe('f26-q23-wording');
    expect(form26CellDomId('S28', 1, '3')).toBe('f26-t-S28-1-3');
    expect(form26ScheduleDomId('s53bii')).toBe('f26-s-s53bii');
    const ids = DEF.fields.map((field) => form26FieldDomId(field.key));
    expect(new Set(ids).size).toBe(DEF.fields.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });

  it('the editor heading: Item for particulars, Clause for Part D, the Parts and the signature by name', () => {
    const unit = (key: string) => FORM26_CLAUSE_UNITS.find((entry) => entry.key === key)!;
    expect(editorTitle(unit('f26_c14'))).toEqual({ prefix: 'Clause 14', label: unit('f26_c14').label });
    expect(editorTitle(unit('f26_p1'))).toEqual({ prefix: 'Item 1', label: 'Name' });
    expect(editorTitle(unit('f26_part_b'))).toEqual({ prefix: 'Part B', label: unit('f26_part_b').label });
    expect(editorTitle(unit('f26_category'))).toEqual({ prefix: null, label: 'Category of assessee' });
    expect(editorTitle(unit('f26_sign'))).toEqual({ prefix: null, label: 'Signature and Notes' });
    expect(FORM26_REVIEW_LABEL).toEqual({ draft: 'Draft', prepared: 'Prepared', reviewed: 'Reviewed', approved: 'Approved', locked: 'Locked' });
  });

  it('keys: Y and N choose on a yes/no; nothing else does', () => {
    expect(yesNoForKey('y')).toBe('Yes');
    expect(yesNoForKey('Y')).toBe('Yes');
    expect(yesNoForKey('n')).toBe('No');
    expect(yesNoForKey('N')).toBe('No');
    expect(yesNoForKey('Enter')).toBeNull();
    expect(yesNoForKey('x')).toBeNull();
  });

  it('a change by someone else: the line under the field, its time and its two answers; after approval only the stored entry', () => {
    const at = new Date(Date.UTC(2026, 10, 22, 10, 42, 5));
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    expect(form26ClockTime('2026-11-22 10:42:05')).toBe(hhmm);
    expect(form26ClockTime('2026-11-22T10:42:05.000Z')).toBe(hhmm);
    expect(form26ClockTime('not a time')).toBe('');
    expect(fieldConflictLine({ theirs: 'B', at: '2026-11-22 10:42:05' }, false)).toEqual({ text: `Changed by someone else at ${hhmm}.`, actions: ['mine', 'theirs'] });
    expect(fieldConflictLine({ theirs: 'B', at: '' }, false)).toEqual({ text: 'Changed by someone else.', actions: ['mine', 'theirs'] });
    expect(fieldConflictLine({ theirs: 'B', at: '2026-11-22 10:42:05' }, true)).toEqual({
      text: 'This clause was approved while you were typing. Your entry was not saved.',
      actions: ['theirs'],
    });
    expect(FORM26_CONFLICT_ACTION_LABEL).toEqual({ mine: 'Keep mine', theirs: 'Use theirs' });
  });

  it('leaving a text box (task 27, scenario 17): only what the user changed since the box took the keyboard is saved', () => {
    // Typed: saved.
    expect(form26LeaveAction({ atFocus: 'A', draft: 'A typed', value: 'A' })).toBe('commit');
    // Typed while someone else's value arrived: saved (the clash is judged against what the user began from).
    expect(form26LeaveAction({ atFocus: 'A', draft: 'A typed', value: 'B' })).toBe('commit');
    // Entered and left without typing, while someone else's value arrived: their value is shown, nothing is saved.
    expect(form26LeaveAction({ atFocus: '', draft: '', value: 'Theirs' })).toBe('show-stored');
    // Typed and put back as it was: nothing to save; the stored value is shown.
    expect(form26LeaveAction({ atFocus: 'A', draft: 'A', value: 'B' })).toBe('show-stored');
    // Nothing changed anywhere, or the box already holds what is stored.
    expect(form26LeaveAction({ atFocus: 'A', draft: 'A', value: 'A' })).toBe('none');
    expect(form26LeaveAction({ atFocus: 'A', draft: 'B', value: 'B' })).toBe('none');
  });

  it('where a value came from: client master, the 3CD draft, a field that can carry a mark, or none', () => {
    expect(fieldProvenance(row('f26_p1', { prefill_status: 'auto_filled' }), 'C.name')).toBe('client-master');
    expect(fieldProvenance(row('f26_p1'), 'C.name')).toBeNull();
    expect(fieldProvenance(row('f26_p2'), 'C.a1')).toBeUndefined();
    const brought = JSON.stringify({ v: 1, f: { c14b: 'Invented Books' }, brought: { c14b: { from: 'clause_11', at: '2026-11-22 10:00:00' } } });
    expect(fieldProvenance(row('f26_c14', { response_json: brought }), 'c14b')).toBe('brought-from-3cd');
    expect(fieldProvenance(row('f26_c14', { response_json: brought }), 'c14c')).toBeNull();
    expect(fieldProvenance(undefined, 'c14c')).toBeUndefined();
    expect(FORM26_PROVENANCE_LABEL).toEqual({ 'client-master': 'From client master', 'brought-from-3cd': 'Brought from the 3CD draft' });
  });

  it('what the save state says (and announces)', () => {
    const clock = () => '16:42';
    expect(form26SaveStatus({ kind: 'idle' }, clock)).toEqual({ text: '', tone: 'quiet', retry: false });
    expect(form26SaveStatus({ kind: 'saving', since: 1 }, clock)).toEqual({ text: 'Saving…', tone: 'quiet', retry: false });
    expect(form26SaveStatus({ kind: 'saved', at: 1 }, clock)).toEqual({ text: 'Saved 16:42', tone: 'quiet', retry: false });
    expect(form26SaveStatus({ kind: 'failed', message: 'disk full', pending: 2 }, clock)).toEqual({
      text: 'Could not save. Your entry is still on screen. Try again.',
      tone: 'error',
      retry: true,
    });
    expect(form26SaveStatus({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] }, clock)).toEqual({
      text: 'Someone else changed this clause. Choose which entry to keep.',
      tone: 'warning',
      retry: false,
    });
    expect(form26SaveStatus({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] }, clock, { locked: false }).text).toBe(
      'Someone else changed this clause. Choose which entry to keep.',
    );
  });

  it('an approval that landed while the user typed has its own sentence: there is no entry to choose, only "Use theirs"', () => {
    const clock = () => '16:42';
    const approved = form26SaveStatus({ kind: 'changed-elsewhere', clauseKey: 'f26_c14', fields: ['c14b'] }, clock, { locked: true });
    expect(approved).toEqual({ text: 'This clause was approved while you were typing. Your entry was not saved.', tone: 'warning', retry: false });
    expect(approved.text).not.toMatch(/choose|keep/i);
    // The same sentence as the line under the answer.
    expect(approved.text).toBe(fieldConflictLine({ theirs: 'x', at: '' }, true).text);
    // The lock says nothing about the other states.
    expect(form26SaveStatus({ kind: 'saved', at: 1 }, clock, { locked: true }).text).toBe('Saved 16:42');
    expect(form26SaveStatus({ kind: 'failed', message: 'x', pending: 1 }, clock, { locked: true }).text).toBe('Could not save. Your entry is still on screen. Try again.');
  });

  it('in the text of Parts A and B an answer sits in its sentence, except a long text box and a group of options', () => {
    const field = (key: string) => DEF.fields.find((entry) => entry.key === key)!;
    expect(proseFieldInline(field('A.assessee'))).toBe(true);
    expect(proseFieldInline(field('A.pl'))).toBe(true);
    expect(proseFieldInline(field('A.q3a'))).toBe(true);
    expect(proseFieldInline(field('B.obs'))).toBe(false);
    expect(proseFieldInline(field('cat'))).toBe(false);
  });

  it('the word under a signature block is the form\'s own', () => {
    expect(signatureClosing(DEF, 'A')).toBe('Signature');
    expect(signatureClosing(DEF, 'B')).toBe('Signature');
    expect(signatureClosing(DEF, 'D')).toBe('Signature');
  });

  it('throws for a clause the form does not have', () => {
    expect(() => blocks('f26_c99')).toThrow();
  });
});
