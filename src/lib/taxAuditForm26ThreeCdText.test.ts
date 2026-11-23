import { describe, expect, it } from 'vitest';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { FORM26_MAPPING, shownEntry } from '@/data/taxAuditForm26Mapping';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import { prefillParticulars, seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26LastYearResult } from '@/lib/taxAuditForm26Store';
import {
  form26AnswerLines,
  FORM26_LAST_YEAR_TEXT,
  lastYearView,
  threeCdAnswerLines,
  threeCdClauseKey,
  threeCdClauseTitle,
} from '@/lib/taxAuditForm26ThreeCdText';
import { defaultValues } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';

const THREE_CD = 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025';
const clause = (clauseKey: string, structured: Record<string, unknown>, patch: Partial<TaxAuditClauseResponse> = {}): TaxAuditClauseResponse => ({
  id: `row-${clauseKey}`,
  tax_audit_id: 'audit-2025',
  clause_key: clauseKey,
  clause_no: clauseKey.replace('clause_', ''),
  clause_title: clauseKey,
  statutory_version: THREE_CD,
  applicability_status: 'applicable',
  response_json: JSON.stringify({ structured }),
  prefill_status: 'not_attempted',
  validation_status: 'not_run',
  qualification_required: 0,
  review_status: 'draft',
  locked: 0,
  ...patch,
} as TaxAuditClauseResponse);
const audit = { id: 'audit-2025', engagement_id: 'eng-2025', statutory_version: THREE_CD, form_type: '3CB', review_status: 'draft' } as unknown as TaxAuditSetup;
const found = (rows: TaxAuditClauseResponse[]): Form26LastYearResult => ({ state: 'found', year: '2025-26', form: '3cd', audit, rows });
const HEDGING = /our rea[d]ing|to be veri[f]ied|†|appe[a]r|check aga[i]nst|\bs[i]c\b/i;

describe('threeCdClauseKey', () => {
  it('a Form 3CD reference to the clause VERA holds; clauses 28, 29 and 36 are not held', () => {
    expect(threeCdClauseKey('13(a)–(c)')).toBe('clause_13');
    expect(threeCdClauseKey('29A')).toBe('clause_29a');
    expect(threeCdClauseKey('8a')).toBe('clause_8a');
    expect(threeCdClauseKey('30B(b)(iv), (v)')).toBe('clause_30b');
    expect(threeCdClauseKey('26 (sub-clause h)')).toBe('clause_26');
    expect(threeCdClauseKey('21(b)/(c)')).toBe('clause_21');
    expect(threeCdClauseKey('36A')).toBe('clause_36a');
    expect(threeCdClauseKey('28')).toBeNull();
    expect(threeCdClauseKey('29')).toBeNull();
    expect(threeCdClauseKey('36')).toBeNull();
    expect(threeCdClauseKey('')).toBeNull();
  });

  it('every Form 3CD clause the shown mapping names is one VERA holds', () => {
    for (const row of FORM26_MAPPING) {
      for (const ref of shownEntry(row).threeCd) expect(threeCdClauseKey(ref.clause), `${row.id} ${ref.clause}`).not.toBeNull();
    }
    expect(threeCdClauseTitle('clause_13')).toBe(FORM_3CD_CLAUSES.find((entry) => entry.key === 'clause_13')!.title);
    expect(threeCdClauseTitle('clause_28')).toBeNull();
  });
});

describe('threeCdAnswerLines', () => {
  it('an invented clause_13 row gives "Method of accounting: …" with the option labels, blanks left out', () => {
    const lines = threeCdAnswerLines(clause('clause_13', { method_of_accounting: 'Mercantile', whether_change_in_method: 'no', change_details: '', effect_on_profit: null }));
    expect(lines).toEqual([
      { label: 'Method of accounting', value: 'Mercantile' },
      { label: 'Change in method', value: 'No' },
    ]);
  });

  it('tables row by row with their columns; the additional particulars as plain text; dates as dd/mm/yyyy', () => {
    const lines = threeCdAnswerLines({
      clause_key: 'clause_13',
      response_json: JSON.stringify({ structured: { method_of_accounting: 'Cash', disclosure_or_remarks: 'Invented remark\nsecond line' } }),
      response_html: '<p>Invented <strong>narrative</strong></p>',
    });
    expect(lines).toEqual([
      { label: 'Method of accounting', value: 'Cash' },
      { label: 'Disclosure or remarks', value: 'Invented remark\nsecond line' },
      { label: 'Additional report particulars', value: 'Invented narrative' },
    ]);
    const withTable = threeCdAnswerLines(clause('clause_9', {}));
    expect(withTable).toEqual([]);
  });

  it('a table of a Form 3CD clause: one line per row that holds something', () => {
    // clause_23's schema has a table; an invented row with two cells and an empty row.
    const tableLines = threeCdAnswerLines(clause('clause_23', { clause_23_rows: [{ specified_person_name: 'Invented Relative', amount_paid_or_payable: 1200 }, {}] }));
    expect(tableLines).toEqual([
      { label: 'Payments to specified persons under section 40A(2)(b) · row 1', value: 'Specified person name: Invented Relative; Amount paid / payable: 1200' },
    ]);
  });

  it('a row that is not JSON, or has nothing, gives no lines (never an error)', () => {
    expect(threeCdAnswerLines({ clause_key: 'clause_13', response_json: 'not json' })).toEqual([]);
    expect(threeCdAnswerLines({ clause_key: 'clause_99', response_json: '{"structured":{"x":"y"}}' })).toEqual([]);
  });
});

describe('the "Last year" pane (as data)', () => {
  it('found: clause 15 shows Form 3CD clause 13(a)–(c) with its subject and both sections, then last year\'s clause 13 answers, read only', () => {
    const view = lastYearView('f26_c15', found([clause('clause_13', { method_of_accounting: 'Mercantile', whether_change_in_method: 'no' })]));
    expect(view.subtitle).toBe('Form 3CD of 2025-26');
    expect(view.message).toBeNull();
    expect(view.note).toBe(FORM26_LAST_YEAR_TEXT.note);
    expect(view.links).toEqual([{
      rowId: 'm15',
      form26: '15',
      threeCd: 'Form 3CD clause 13(a)–(c)',
      subject: 'Method of accounting and change in it',
      sections: 'Section (2025 Act): — · Section (1961 Act): 145',
      whatChanged: 'No change in substance.',
    }]);
    expect(view.answers).toEqual([{
      key: 'clause_13',
      heading: `Clause 13 · ${threeCdClauseTitle('clause_13')}`,
      state: 'Draft',
      lines: [{ label: 'Method of accounting', value: 'Mercantile' }, { label: 'Change in method', value: 'No' }],
      empty: null,
    }]);
  });

  it('several mapping rows of one clause, and one Form 3CD clause named twice, give its answers once', () => {
    const view = lastYearView('f26_c51', found([clause('clause_21', {})]));
    expect(view.links.map((link) => link.rowId)).toEqual(['m51ac', 'm51bd']);
    expect(view.answers.map((block) => block.key)).toEqual(['clause_21']);
    expect(view.answers[0].empty).toBe('No answer was recorded for this clause in 2025-26.');
  });

  it('a clause with no Form 3CD counterpart says so plainly (new clause 39; clause 47)', () => {
    const view39 = lastYearView('f26_c39', found([]));
    expect(view39.answers).toEqual([]);
    expect(view39.notes).toEqual(['Clause 39 is new in Form No. 26. There is no Form 3CD answer for it.']);
    const view47 = lastYearView('f26_c47', found([]));
    expect(view47.notes).toEqual(['Clause 47 has no Form 3CD clause. There is no Form 3CD answer for it.']);
  });

  it('a Form 3CD clause row absent from last year\'s audit: "No answer was recorded …"', () => {
    const view = lastYearView('f26_c15', found([]));
    expect(view.answers[0].empty).toBe('No answer was recorded for this clause in 2025-26.');
  });

  it('none (no audit, or no access to it): one plain line, not an error, and the mapping is still shown', () => {
    const view = lastYearView('f26_c15', { state: 'none', year: '2025-26', form: '3cd' });
    expect(view.message).toBe('No Form 3CD audit of 2025-26 is available to you for this client.');
    expect(view.retry).toBe(false);
    expect(view.answers).toEqual([]);
    expect(view.links.map((link) => link.rowId)).toEqual(['m15']);
  });

  it('loading, a failure with Try again, parts outside clauses 9 to 53', () => {
    expect(lastYearView('f26_c15', null).message).toBe(FORM26_LAST_YEAR_TEXT.loading);
    const failed = lastYearView('f26_c15', { state: 'error', message: 'database is locked' });
    expect(failed.message).toBe(FORM26_LAST_YEAR_TEXT.failed);
    expect(failed.retry).toBe(true);
    const item = lastYearView('f26_p1', found([]));
    expect(item.links).toEqual([]);
    expect(item.message).toBe(FORM26_LAST_YEAR_TEXT.notCovered);
  });

  it('last year is a Form No. 26 audit (an engagement of 2027-28): that clause\'s own answers, no Form 3CD block', () => {
    const prefill = prefillParticulars(defaultValues(DEF), { clientName: 'Invented Traders', clientPan: 'AAAAA0000A', financialYear: '2026-27' });
    const values = { ...prefill.values, f: { ...prefill.values.f, c15b: 'Yes' } };
    const rows = seedRows(DEF, 'audit-2026', values, prefill.prefilled).map((row, index) => ({ ...row, id: `r${index}` })) as unknown as TaxAuditClauseResponse[];
    const f26Audit = { ...audit, id: 'audit-2026', statutory_version: TAX_AUDIT_FORM26_STATUTORY_VERSION, setup_json: '{"form26":{"v":1,"category":"2","showAllSchedules":false}}' } as TaxAuditSetup;
    const view = lastYearView('f26_c15', { state: 'found', year: '2026-27', form: 'form26', audit: f26Audit, rows });
    expect(view.subtitle).toBe('Form No. 26 of 2026-27');
    expect(view.links).toEqual([]);
    expect(view.answers).toHaveLength(1);
    expect(view.answers[0].heading).toBe('Clause 15');
    expect(view.answers[0].lines).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'Yes' })]));
    expect(lastYearView('f26_c15', { state: 'none', year: '2026-27', form: 'form26' }).message).toBe('No Form No. 26 audit of 2026-27 is available to you for this client.');
  });

  it('form26AnswerLines: the clause\'s answers as text, numbered as in the form; tables by their filled rows', () => {
    const values = defaultValues(DEF);
    values.f.c28 = 'Yes';
    values.t.S28 = [{ 1: 'Invented Law', 2: '1', 3: '700' }];
    const lines = form26AnswerLines(DEF, 'f26_c28', values);
    expect(lines[0]).toEqual({ label: '28', value: 'Yes' });
    expect(lines.some((line) => /1 row filled/.test(line.value))).toBe(true);
  });

  it('no produced string hedges, and nothing offers to copy', () => {
    const texts: string[] = [...Object.values(FORM26_LAST_YEAR_TEXT)];
    for (const row of FORM26_MAPPING) {
      const key = `f26_c${row.form26[0].clause}`;
      const view = lastYearView(key, found([]));
      texts.push(...view.links.flatMap((link) => [link.threeCd, link.subject, link.sections, link.whatChanged]), ...view.notes, view.subtitle ?? '');
    }
    for (const text of texts) {
      expect(text).not.toMatch(HEDGING);
      expect(text).not.toMatch(/\bcopy\b/i);
    }
  });
});
