import { describe, expect, it } from 'vitest';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE } from '@/data/taxAudit3CDFieldSchemas';
import { FORM26_CLAUSE_UNITS, form26ClauseKeyOfField } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { FORM26_MAPPING, isSameSubstance, shownEntry } from '@/data/taxAuditForm26Mapping';
import {
  conversionNoticeText,
  FORM26_CARRY,
  FORM26_THREE_CD_DRAFT_TEXT,
  form26TaxYearUpdate,
  isThreeCdUntouched,
  planConversion,
  threeCdDraftList,
  threeCdDraftView,
  type ThreeCdSnapshot,
} from '@/lib/taxAuditForm26Conversion';
import { prefillParticulars } from '@/lib/taxAuditForm26Storage';
import { threeCdClauseKey } from '@/lib/taxAuditForm26ThreeCdText';
import { defaultValues } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';

const NOW = '2026-11-22T10:00:00.000Z';
const AUDIT = { id: 'audit-3cd', engagement_id: 'eng-1', statutory_version: 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025', form_type: '3CB', financial_year: '2026-27' } as unknown as TaxAuditSetup;

// The 49 rows the 3CD page seeds, as it leaves them when nobody has touched them (invented values).
function seeded(): TaxAuditClauseResponse[] {
  return FORM_3CD_CLAUSES.map((clause, index) => ({
    id: `3cd-${index}`,
    tax_audit_id: 'audit-3cd',
    clause_key: clause.key,
    clause_no: clause.clauseNo,
    clause_title: clause.title,
    statutory_version: 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025',
    applicability_status: 'applicable',
    response_json: clause.key === 'clause_1' ? JSON.stringify({ structured: { assessee_name: 'Invented Traders' } }) : '{}',
    prefill_status: clause.key === 'clause_1' ? 'auto_filled' : 'needs_input',
    qualification_required: 0,
    qualification_text_html: '',
    review_status: 'draft',
    locked: 0,
    created_at: '2026-11-20 09:00:00',
    updated_at: '2026-11-20 09:00:00',
  }) as unknown as TaxAuditClauseResponse);
}

const snapshotOf = (rows: TaxAuditClauseResponse[], extra: Partial<ThreeCdSnapshot> = {}): ThreeCdSnapshot => ({ audit: AUDIT, rows, evidenceCount: 0, hasAcceptanceCheck: false, ...extra });

// One clause of the seeded rows given answers (and stamped later, as the 3CD page's save would).
function answered(rows: TaxAuditClauseResponse[], clauseKey: string, structured: Record<string, unknown>, html?: string): TaxAuditClauseResponse[] {
  return rows.map((row) => (row.clause_key === clauseKey ? { ...row, response_json: JSON.stringify({ structured }), response_html: html ?? null, updated_at: '2026-11-21 11:30:00' } : row));
}

function base() {
  return prefillParticulars(defaultValues(DEF), { clientName: 'Invented Traders', clientPan: 'AAAAA0000A', financialYear: '2026-27' }).values;
}

describe('isThreeCdUntouched', () => {
  it('rows as the 3CD page seeded them, no evidence, no acceptance check: untouched', () => {
    expect(isThreeCdUntouched(snapshotOf(seeded()))).toBe(true);
  });

  it('a 3CD audit with no clause rows at all (its seeding stopped): untouched', () => {
    expect(isThreeCdUntouched(snapshotOf([]))).toBe(true);
  });

  it('one edited clause (updated_at later) -> untouched false', () => {
    expect(isThreeCdUntouched(snapshotOf(answered(seeded(), 'clause_13', { method_of_accounting: 'Cash' })))).toBe(false);
  });

  it('evidence only -> untouched false; an acceptance check only -> untouched false', () => {
    expect(isThreeCdUntouched(snapshotOf(seeded(), { evidenceCount: 1 }))).toBe(false);
    expect(isThreeCdUntouched(snapshotOf(seeded(), { hasAcceptanceCheck: true }))).toBe(false);
  });

  it('a clause marked prepared, overridden by hand, or marked for qualification -> untouched false', () => {
    const change = (patch: Partial<TaxAuditClauseResponse>) => seeded().map((row, index) => (index === 5 ? { ...row, ...patch } : row));
    expect(isThreeCdUntouched(snapshotOf(change({ review_status: 'prepared' })))).toBe(false);
    expect(isThreeCdUntouched(snapshotOf(change({ prefill_status: 'manual_override' })))).toBe(false);
    expect(isThreeCdUntouched(snapshotOf(change({ qualification_required: 1 } as Partial<TaxAuditClauseResponse>)))).toBe(false);
    expect(isThreeCdUntouched(snapshotOf(change({ qualification_text_html: '<p>Invented qualification</p>' })))).toBe(false);
  });
});

describe('FORM26_CARRY', () => {
  it('holds exactly the particulars and the single answers of rows that are "same" in the corrected mapping', () => {
    expect(FORM26_CARRY.map((rule) => `${rule.field}<-${rule.from.clause}.${rule.from.field}`)).toEqual([
      'C.name<-clause_1.assessee_name',
      'C.pan<-clause_3.pan_or_aadhaar',
      'c10<-clause_8a.opted_for_section_115_taxation',
      'c15a<-clause_13.method_of_accounting',
      'c15b<-clause_13.whether_change_in_method',
      'c19<-clause_12.whether_profit_loss_includes_presumptive_income',
      'c22<-clause_15.whether_any_capital_asset_converted_into_stock_in_trade',
    ]);
  });

  it('every rule: its source field exists in TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE as one field of a matching kind', () => {
    for (const rule of FORM26_CARRY) {
      const schema = TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE.get(rule.from.clause);
      const field = schema?.fields?.find((entry) => entry.key === rule.from.field);
      expect(field, `${rule.field}: ${rule.from.clause}.${rule.from.field}`).toBeDefined();
      if (!field) continue;
      if (rule.as === 'text') expect(field.type).toBe('text');
      if (rule.as === 'yesno') {
        expect(field.type).toBe('select');
        expect(field.options?.map((option) => option.value)).toEqual(expect.arrayContaining(['yes', 'no']));
      }
      if (rule.as === 'option') {
        expect(field.type).toBe('select');
        for (const value of Object.keys(rule.options ?? {})) expect(field.options?.map((option) => option.value)).toContain(value);
      }
    }
  });

  it('every rule: its target is a Form 26 answer of the matching kind; never a table, an amount or long text', () => {
    for (const rule of FORM26_CARRY) {
      const field = DEF.fields.find((entry) => entry.key === rule.field);
      expect(field, rule.field).toBeDefined();
      if (!field) continue;
      expect(DEF.tables.some((table) => table.id === rule.field)).toBe(false);
      expect(['number', 'longtext']).not.toContain(field.kind);
      if (rule.as === 'text') expect(field.kind).toBe('text');
      if (rule.as === 'yesno') expect(field.kind).toBe('yesno');
      if (rule.as === 'option') {
        expect(field.kind).toBe('radio');
        const options = (field.radioOptions ?? []).map((option) => option.value);
        for (const target of Object.values(rule.options ?? {})) expect(options).toContain(target);
      }
    }
  });

  it('every rule: its mapping row is "same" in the corrected mapping and ties the source clause to the target clause (particulars excepted)', () => {
    for (const rule of FORM26_CARRY) {
      const unit = FORM26_CLAUSE_UNITS.find((entry) => entry.key === form26ClauseKeyOfField(rule.field));
      if (rule.mappingRow === null) {
        expect(unit?.group, rule.field).toBe('particulars');
        continue;
      }
      const row = FORM26_MAPPING.find((entry) => entry.id === rule.mappingRow);
      expect(row, rule.mappingRow).toBeDefined();
      if (!row) continue;
      expect(isSameSubstance(row), rule.mappingRow).toBe(true);
      expect(shownEntry(row).threeCd.map((ref) => threeCdClauseKey(ref.clause))).toContain(rule.from.clause);
      expect(row.form26.map((ref) => ref.clause)).toContain(unit?.no);
    }
  });

  it('rows that are "changed" once corrected carry nothing: 12(c) (Form 3CD clause 37) and 48 (Form 3CD clause 36A)', () => {
    const rows = new Set(FORM26_CARRY.map((rule) => rule.mappingRow));
    expect(rows.has('m12c')).toBe(false);
    expect(rows.has('m48')).toBe(false);
    expect(FORM26_CARRY.some((rule) => rule.field === 'c12c' || rule.field === 'c48')).toBe(false);
    expect(shownEntry(FORM26_MAPPING.find((row) => row.id === 'm12c')!).kind).toBe('changed');
    expect(shownEntry(FORM26_MAPPING.find((row) => row.id === 'm48')!).kind).toBe('changed');
  });
});

describe('planConversion', () => {
  it('untouched snapshot -> untouched true, no brought mark, values equal defaults with the prefilled particulars', () => {
    const plan = planConversion(DEF, snapshotOf(seeded()), base(), NOW);
    expect(plan.untouched).toBe(true);
    expect(plan.brought).toEqual({});
    expect(plan.beside).toEqual([]);
    expect(plan.values).toEqual(base());
  });

  it("carry: clause_8a 'yes' -> c10 \"Yes\" with a brought mark; 'not_applicable' -> not carried", () => {
    let rows = answered(seeded(), 'clause_8a', { opted_for_section_115_taxation: 'yes', selected_section_115_taxation: '115BAA' });
    rows = answered(rows, 'clause_12', { whether_profit_loss_includes_presumptive_income: 'not_applicable' });
    const plan = planConversion(DEF, snapshotOf(rows), base(), NOW);
    expect(plan.untouched).toBe(false);
    expect(plan.values.f.c10).toBe('Yes');
    expect(plan.brought.c10).toEqual({ from: 'clause_8a', at: NOW });
    expect(plan.values.f.c19).toBe(base().f.c19);
    expect(plan.brought.c19).toBeUndefined();
  });

  it("clause_8a 'no' is brought as \"No\" to be confirmed, though it equals the form's preset", () => {
    const plan = planConversion(DEF, snapshotOf(answered(seeded(), 'clause_8a', { opted_for_section_115_taxation: 'no' })), base(), NOW);
    expect(plan.values.f.c10).toBe('No');
    expect(plan.brought.c10).toEqual({ from: 'clause_8a', at: NOW });
  });

  it('the method of accounting: Mercantile and Cash become the options of 15(a); "Hybrid / Other" is not carried', () => {
    const cash = planConversion(DEF, snapshotOf(answered(seeded(), 'clause_13', { method_of_accounting: 'Cash', whether_change_in_method: 'yes' })), base(), NOW);
    expect(cash.values.f.c15a).toBe('Cash system');
    expect(cash.values.f.c15b).toBe('Yes');
    expect(Object.keys(cash.brought).sort()).toEqual(['c15a', 'c15b']);
    const mercantile = planConversion(DEF, snapshotOf(answered(seeded(), 'clause_13', { method_of_accounting: 'Mercantile' })), base(), NOW);
    expect(mercantile.values.f.c15a).toBe('Mercantile system');
    const hybrid = planConversion(DEF, snapshotOf(answered(seeded(), 'clause_13', { method_of_accounting: 'Hybrid / Other' })), base(), NOW);
    expect(hybrid.brought.c15a).toBeUndefined();
    expect(hybrid.values.f.c15a).toBe(base().f.c15a);
  });

  it('particulars: a name or PAN that differs from the one filled from the client master is brought; the same one is left as it is; a 12-digit number is not a PAN', () => {
    let rows = answered(seeded(), 'clause_1', { assessee_name: 'Invented Traders Private Limited' });
    rows = answered(rows, 'clause_3', { pan_or_aadhaar: 'AAAAA0000A' });
    const plan = planConversion(DEF, snapshotOf(rows), base(), NOW);
    expect(plan.values.f['C.name']).toBe('Invented Traders Private Limited');
    expect(plan.brought['C.name']).toEqual({ from: 'clause_1', at: NOW });
    expect(plan.brought['C.pan']).toBeUndefined();
    const aadhaar = planConversion(DEF, snapshotOf(answered(seeded(), 'clause_3', { pan_or_aadhaar: '000000000000' })), { ...base(), f: { ...base().f, 'C.pan': '' } }, NOW);
    expect(aadhaar.brought['C.pan']).toBeUndefined();
    const pan = planConversion(DEF, snapshotOf(answered(seeded(), 'clause_3', { pan_or_aadhaar: ' BBBBB1111B ' })), base(), NOW);
    expect(pan.values.f['C.pan']).toBe('BBBBB1111B');
  });

  it('blank sources and tables are never carried; the clause of a table shows the old answer beside it', () => {
    const rows = answered(seeded(), 'clause_31', {
      clause_31a_loan_deposit_rows: [{ lender_or_depositor_name: 'Invented Lender', amount_of_loan_or_deposit: '50000' }],
    });
    const plan = planConversion(DEF, snapshotOf(rows), base(), NOW);
    expect(plan.brought).toEqual({});
    expect(plan.values).toEqual(base());
    expect(plan.beside).toContainEqual({ clauseKey: 'f26_c45', threeCdClauses: ['clause_31'] });
  });

  it('beside: only clauses whose Form 3CD clause holds an answer, in the order of the form', () => {
    let rows = answered(seeded(), 'clause_13', { method_of_accounting: 'Cash' });
    rows = answered(rows, 'clause_37', { clause_37_cost_audit_rows: [{ whether_cost_audit_carried_out: 'yes', cost_auditor_name: 'Invented Cost Auditor' }] });
    const plan = planConversion(DEF, snapshotOf(rows), base(), NOW);
    // Form 3CD clause 13 is tied to clause 15 (13(a)-(c)) and to clauses 17 and 18 (13(d)-(f)).
    expect(plan.beside.map((entry) => entry.clauseKey)).toEqual(['f26_c12', 'f26_c15', 'f26_c17', 'f26_c18']);
    expect(plan.beside[0]).toEqual({ clauseKey: 'f26_c12', threeCdClauses: ['clause_37'] });
  });
});

describe('the notice and the 3CD draft as text', () => {
  it('the conversion notice says what happened, that the draft is kept and where its evidence is, in two sentences', () => {
    expect(conversionNoticeText({ waiting: 6, brought: 6, beside: 31 })).toBe(
      "This engagement's Form 3CD draft was brought into Form No. 26: 6 answers wait for your confirmation, and 31 clauses show the earlier answer beside them. The earlier draft is kept unchanged, and the evidence linked to it stays in the Evidence Vault.",
    );
    expect(conversionNoticeText({ waiting: 1, brought: 2, beside: 1 })).toBe(
      "This engagement's Form 3CD draft was brought into Form No. 26: 1 answer waits for your confirmation, and 1 clause shows the earlier answer beside it. The earlier draft is kept unchanged, and the evidence linked to it stays in the Evidence Vault.",
    );
    expect(conversionNoticeText({ waiting: 0, brought: 2, beside: 3 })).toContain('the 2 answers brought across are confirmed, and 3 clauses show');
    expect(conversionNoticeText({ waiting: 0, brought: 0, beside: 3 })).toContain('Form No. 26: 3 clauses show the earlier answer beside them.');
    expect(conversionNoticeText({ waiting: 0, brought: 0, beside: 0 })).toBe(
      "This engagement's Form 3CD draft was brought into Form No. 26. The earlier draft is kept unchanged, and the evidence linked to it stays in the Evidence Vault.",
    );
    const text = conversionNoticeText({ waiting: 6, brought: 6, beside: 31 });
    expect(text.split(/(?<!No)\. /)).toHaveLength(2); // "Form No. 26" does not end a sentence
    expect(text).not.toMatch(/our reading|to be verified|mock-up|sic\b/i);
  });

  it('threeCdDraftList: the 49 Form 3CD clauses with the application\'s short titles, state and answers; nothing that writes', () => {
    const rows = answered(seeded(), 'clause_13', { method_of_accounting: 'Cash', whether_change_in_method: 'no' });
    const list = threeCdDraftList(snapshotOf(rows));
    expect(list).toHaveLength(49);
    expect(list.map((entry) => entry.key)).toEqual(FORM_3CD_CLAUSES.map((clause) => clause.key));
    const c13 = list.find((entry) => entry.key === 'clause_13');
    expect(c13).toMatchObject({ heading: 'Clause 13 · Method of accounting and changes therein', state: 'Draft' });
    expect(c13?.lines).toEqual([{ label: 'Method of accounting', value: 'Cash' }, { label: 'Change in method', value: 'No' }]);
    expect(list.find((entry) => entry.key === 'clause_2')?.lines).toEqual([]);
  });

  it('threeCdDraftView: clause 45 shows the old clause 31 rows as text under the tab "3CD draft"', () => {
    const rows = answered(seeded(), 'clause_31', {
      clause_31a_loan_deposit_rows: [{ lender_or_depositor_name: 'Invented Lender', amount_of_loan_or_deposit: '50000' }],
    });
    const view = threeCdDraftView('f26_c45', snapshotOf(rows));
    expect(view.title).toBe(FORM26_THREE_CD_DRAFT_TEXT.title);
    expect(view.title).toBe('3CD draft');
    expect(view.subtitle).toBe("This engagement's earlier Form 3CD draft");
    expect(view.note).toBe(FORM26_THREE_CD_DRAFT_TEXT.note);
    const block = view.answers.find((answer) => answer.key === 'clause_31');
    expect(block?.lines.map((line) => line.value).join(' ')).toContain('Invented Lender');
    expect(JSON.stringify(view)).not.toMatch(/last year|2025-26/i);
    const empty = threeCdDraftView('f26_c22', snapshotOf(rows));
    expect(empty.answers[0].empty).toBe('No answer was recorded for this clause in the 3CD draft.');
    expect(threeCdDraftView('f26_p1', snapshotOf(rows)).message).toBe(FORM26_THREE_CD_DRAFT_TEXT.notCovered);
  });
});

describe('a changed year inside Form No. 26 years (item 8)', () => {
  it('the line under item 8 is offered only while it holds another tax year than the engagement', () => {
    const values = base();
    expect(form26TaxYearUpdate(values, '2026-27')).toBeNull();
    expect(form26TaxYearUpdate(values, '2027-28')).toEqual({ year: '2027-28', text: 'The engagement is now for 2027-28.', action: 'Update' });
    expect(form26TaxYearUpdate(values, 'FY 2027-28')?.year).toBe('2027-28');
    expect(form26TaxYearUpdate({ ...values, f: { ...values.f, 'C.ty': '' } }, '2027-28')).toBeNull();
    expect(form26TaxYearUpdate({ ...values, f: { ...values.f, 'C.ty': 'typed by hand' } }, '2027-28')).toBeNull();
    expect(form26TaxYearUpdate(values, 'Year 27')).toBeNull();
  });
});
