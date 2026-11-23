// Bringing an existing Form 3CD draft into Form No. 26 (BUILD-PLAN task 26; owner's ruling R5), as pure
// functions: whether the draft was ever touched, which answers come across (only particulars and single
// answers of the same substance in the CORRECTED mapping, R9), which clauses show the earlier answer beside
// them, the sentences of the notice, the earlier draft as read-only text, and the line under item 8 when the
// engagement's year has moved on. The database is reached in taxAuditForm26Store.ts (`convert`), which writes
// a carried value only into a Form No. 26 row not edited since it was seeded and never writes a Form 3CD row.
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import { mappingRowsForClause, shownEntry } from '@/data/taxAuditForm26Mapping';
import type { Form26Definition } from '@/data/taxAuditForm26Types';
import { FORM26_REVIEW_LABEL } from '@/lib/taxAuditForm26EditorModel';
import type { Form26LastYearResult } from '@/lib/taxAuditForm26Store';
import { FORM26_LAST_YEAR_TEXT, lastYearView, threeCdAnswerLines, threeCdClauseKey, type Form26AnswerLine, type Form26LastYearView } from '@/lib/taxAuditForm26ThreeCdText';
import { getField, type Form26Values } from '@/lib/taxAuditForm26Values';
import { parseEngagementYear } from '@/lib/taxAuditForm26Year';
import type { TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';

/** The earlier Form 3CD draft as read (select only): its audit row, its clause rows, and what else hangs on it. */
export type ThreeCdSnapshot = { audit: TaxAuditSetup; rows: TaxAuditClauseResponse[]; evidenceCount: number; hasAcceptanceCheck: boolean };

/**
 * One answer that comes across: the Form No. 26 answer `field` takes the Form 3CD answer `from`.
 * `mappingRow`: the row of the corrected mapping that says the substance is the same (null for a particular).
 * `as`: 'text' as typed (trimmed; `length` exact when given), 'yesno' 'yes' / 'no' to "Yes" / "No", 'option'
 * through `options` (the stored Form 3CD value -> the Form No. 26 option). Anything else is not carried.
 */
export type Form26CarryRule = {
  field: string;
  from: { clause: string; field: string };
  mappingRow: string | null;
  as: 'text' | 'yesno' | 'option';
  length?: number;
  options?: Readonly<Record<string, string>>;
};

/**
 * Every answer that can come across. Checked against src/data/taxAudit3CDFieldSchemas.ts (each source is one
 * field, not a table column) and the corrected mapping (each row is "same"): rows 10, 15, 19 and 22. The other
 * "same" rows (12(d), 23, 29, 32, 33(a), 37, 40, 41(a), 50(c)) have only tables in the Form 3CD schema, and
 * rows 12(c) and 48 are "changed" once corrected: their clauses show the earlier answer beside them instead.
 */
export const FORM26_CARRY: Form26CarryRule[] = [
  { field: 'C.name', from: { clause: 'clause_1', field: 'assessee_name' }, mappingRow: null, as: 'text' },
  { field: 'C.pan', from: { clause: 'clause_3', field: 'pan_or_aadhaar' }, mappingRow: null, as: 'text', length: 10 },
  { field: 'c10', from: { clause: 'clause_8a', field: 'opted_for_section_115_taxation' }, mappingRow: 'm10', as: 'yesno' },
  { field: 'c15a', from: { clause: 'clause_13', field: 'method_of_accounting' }, mappingRow: 'm15', as: 'option', options: { Mercantile: 'Mercantile system', Cash: 'Cash system' } },
  { field: 'c15b', from: { clause: 'clause_13', field: 'whether_change_in_method' }, mappingRow: 'm15', as: 'yesno' },
  { field: 'c19', from: { clause: 'clause_12', field: 'whether_profit_loss_includes_presumptive_income' }, mappingRow: 'm19', as: 'yesno' },
  { field: 'c22', from: { clause: 'clause_15', field: 'whether_any_capital_asset_converted_into_stock_in_trade' }, mappingRow: 'm22', as: 'yesno' },
];

const isBlank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

function structuredOf(json: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json ?? '{}') as { structured?: unknown };
    const structured = parsed && typeof parsed === 'object' ? parsed.structured : null;
    return structured && typeof structured === 'object' && !Array.isArray(structured) ? (structured as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Untouched = every clause row as the 3CD page seeded it (state 'draft', never overridden by hand, no
 * qualification, `updated_at` equal to `created_at`), no evidence linked, no acceptance check started.
 */
export function isThreeCdUntouched(snapshot: ThreeCdSnapshot): boolean {
  if (snapshot.evidenceCount > 0 || snapshot.hasAcceptanceCheck) return false;
  return snapshot.rows.every((row) =>
    (row.review_status ?? 'draft') === 'draft'
    && row.prefill_status !== 'manual_override'
    && !Number(row.qualification_required ?? 0)
    && isBlank(row.qualification_text_html)
    && row.updated_at === row.created_at);
}

/** The Form No. 26 value a rule gives for a stored Form 3CD value, or null when it does not come across. */
export function carriedValue(rule: Form26CarryRule, raw: unknown): string | null {
  if (isBlank(raw) || (typeof raw !== 'string' && typeof raw !== 'number')) return null;
  const text = String(raw).trim();
  switch (rule.as) {
    case 'text':
      return rule.length !== undefined && text.length !== rule.length ? null : text;
    case 'yesno':
      return text === 'yes' ? 'Yes' : text === 'no' ? 'No' : null;
    case 'option':
      return rule.options && Object.prototype.hasOwnProperty.call(rule.options, text) ? rule.options[text] : null;
  }
}

const PARTICULARS = new Set(FORM26_CARRY.filter((rule) => rule.mappingRow === null).map((rule) => rule.field));

/** The clauses 9 to 53 whose Form 3CD clause(s) in the corrected mapping hold an answer in the draft, in form order. */
export function besideClauses(snapshot: ThreeCdSnapshot): { clauseKey: string; threeCdClauses: string[] }[] {
  const answered = new Set(snapshot.rows.filter((row) => threeCdAnswerLines(row).length > 0).map((row) => row.clause_key));
  const beside: { clauseKey: string; threeCdClauses: string[] }[] = [];
  for (const unit of FORM26_CLAUSE_UNITS) {
    if (!/^\d+$/.test(unit.no) || Number(unit.no) < 9 || Number(unit.no) > 53) continue;
    const keys: string[] = [];
    for (const row of mappingRowsForClause(unit.no)) {
      for (const ref of shownEntry(row).threeCd) {
        const key = threeCdClauseKey(ref.clause);
        if (key && answered.has(key) && !keys.includes(key)) keys.push(key);
      }
    }
    if (keys.length > 0) beside.push({ clauseKey: unit.key, threeCdClauses: keys });
  }
  return beside;
}

/**
 * What the conversion brings across onto `base` (the Form No. 26 answers as opened, with the file's presets,
 * decision A4): every rule whose Form 3CD source holds a value that comes across, with a "brought" mark to be
 * confirmed. A particular that already holds the same text (filled from the client master) is left as it is.
 * An untouched draft brings nothing and shows nothing beside. Which rows may be written is the store's call.
 */
export function planConversion(def: Form26Definition, snapshot: ThreeCdSnapshot, base: Form26Values, now: string): {
  values: Form26Values;
  brought: Record<string, { from: string; at: string }>;
  beside: { clauseKey: string; threeCdClauses: string[] }[];
  untouched: boolean;
} {
  if (isThreeCdUntouched(snapshot)) return { values: base, brought: {}, beside: [], untouched: true };
  const known = new Set(def.fields.map((field) => field.key));
  const byClause = new Map(snapshot.rows.map((row) => [row.clause_key, structuredOf(row.response_json)]));
  const f = { ...base.f };
  const brought: Record<string, { from: string; at: string }> = {};
  for (const rule of FORM26_CARRY) {
    if (!known.has(rule.field)) continue;
    const value = carriedValue(rule, byClause.get(rule.from.clause)?.[rule.from.field]);
    if (value === null) continue;
    if (PARTICULARS.has(rule.field) && getField(base, rule.field) === value) continue;
    f[rule.field] = value;
    brought[rule.field] = { from: rule.from.clause, at: now };
  }
  return { values: { f, t: base.t }, brought, beside: besideClauses(snapshot), untouched: false };
}

// ---------------------------------------------------------------------------------------------------
// What the screen says

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const KEPT = 'The earlier draft is kept unchanged, and the evidence linked to it stays in the Evidence Vault.';

/**
 * The notice at the top of a converted Form No. 26 audit: what happened (answers waiting for confirmation,
 * clauses with the earlier answer beside them), that the earlier draft is kept, and where its evidence is.
 */
export function conversionNoticeText(input: { waiting: number; brought: number; beside: number }): string {
  const parts: string[] = [];
  if (input.waiting > 0) parts.push(`${count(input.waiting, 'answer waits', 'answers wait')} for your confirmation`);
  else if (input.brought > 0) parts.push(`the ${count(input.brought, 'answer', 'answers')} brought across ${input.brought === 1 ? 'is' : 'are'} confirmed`);
  if (input.beside > 0) parts.push(`${count(input.beside, 'clause shows', 'clauses show')} the earlier answer beside ${input.beside === 1 ? 'it' : 'them'}`);
  const what = parts.length > 0 ? `: ${parts.join(', and ')}.` : '.';
  return `This engagement's Form 3CD draft was brought into Form No. 26${what} ${KEPT}`;
}

export const FORM26_THREE_CD_DRAFT_TEXT = {
  title: '3CD draft',
  subtitle: "This engagement's earlier Form 3CD draft",
  note: 'The answers of the earlier Form 3CD draft, to enter here where they still apply. The draft itself is not changed.',
  notCovered: 'The earlier answer is shown here for clauses 9 to 53. "View the earlier 3CD draft" shows the whole draft.',
  view: 'View the earlier 3CD draft',
  dialogTitle: 'The earlier Form 3CD draft',
  dialogNote: "This engagement's Form 3CD draft as it was kept, shown read only: nothing here can be changed.",
  hasAnswer: 'The earlier Form 3CD draft has an answer for this clause.',
  openTab: 'See it',
} as const;

/** The "3CD draft" tab of the right pane for one clause: the same view as "Last year", with the draft's own words. */
export function threeCdDraftView(unitKey: string, snapshot: ThreeCdSnapshot, def: Form26Definition = FORM26_DEFINITION): Form26LastYearView {
  const label = 'the 3CD draft';
  const result: Form26LastYearResult = { state: 'found', year: label, form: '3cd', audit: snapshot.audit, rows: snapshot.rows };
  const view = lastYearView(unitKey, result, def);
  return {
    ...view,
    title: FORM26_THREE_CD_DRAFT_TEXT.title,
    subtitle: FORM26_THREE_CD_DRAFT_TEXT.subtitle,
    note: view.note ? FORM26_THREE_CD_DRAFT_TEXT.note : null,
    message: view.message === FORM26_LAST_YEAR_TEXT.notCovered ? FORM26_THREE_CD_DRAFT_TEXT.notCovered : view.message,
  };
}

export type Form26ThreeCdDraftClause = { key: string; heading: string; state: string; lines: Form26AnswerLine[] };

/** The whole earlier draft as text: the 49 Form 3CD clauses VERA holds, with their short titles, state and answers. */
export function threeCdDraftList(snapshot: ThreeCdSnapshot): Form26ThreeCdDraftClause[] {
  const byKey = new Map(snapshot.rows.map((row) => [row.clause_key, row]));
  return FORM_3CD_CLAUSES.map((clause) => {
    const row = byKey.get(clause.key);
    return {
      key: clause.key,
      heading: `Clause ${clause.clauseNo} · ${clause.title}`,
      state: FORM26_REVIEW_LABEL[row?.review_status ?? 'draft'] ?? FORM26_REVIEW_LABEL.draft,
      lines: row ? threeCdAnswerLines(row) : [],
    };
  });
}

/**
 * Item 8 once the engagement's year has moved within Form No. 26 years (2026-27 -> 2027-28): while the answer
 * holds another tax year, the line under it and "Update". Nothing when it is blank or not a year.
 */
export function form26TaxYearUpdate(values: Form26Values, financialYear: string): { year: string; text: string; action: string } | null {
  const engagement = parseEngagementYear(financialYear);
  const held = getField(values, 'C.ty').trim();
  const answer = held === '' ? null : parseEngagementYear(held);
  if (!engagement || !answer) return null;
  const year = `${engagement.startYear}-${String(engagement.endYear % 100).padStart(2, '0')}`;
  if (answer.startYear === engagement.startYear) return null;
  return { year, text: `The engagement is now for ${year}.`, action: 'Update' };
}

// ---------------------------------------------------------------------------------------------------
// The notice is shown until the user dismisses it: remembered on this computer for the user and engagement
// (the application has no per-user preference store), as the comparison switch is.

type NoticeStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void } | null | undefined;

export function form26ConversionNoticeKey(userId: string | null | undefined, engagementId: string): string {
  return `vera.form26.conversionNotice.${userId || 'signed-out'}.${engagementId}`;
}

export function readNoticeDismissed(storage: NoticeStorage, key: string): boolean {
  try {
    return storage?.getItem(key) === 'dismissed';
  } catch {
    return false;
  }
}

export function writeNoticeDismissed(storage: NoticeStorage, key: string): void {
  try {
    storage?.setItem(key, 'dismissed');
  } catch {
    // Not remembered; the notice is gone for this visit.
  }
}
