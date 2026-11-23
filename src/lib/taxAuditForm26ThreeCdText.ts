// "Last year" (BUILD-PLAN task 25) as text: which Form 3CD clause VERA holds for a reference of the mapping,
// last year's answers of a Form 3CD clause as plain lines (through the application's own field schemas,
// read only), the same for a Form No. 26 clause of last year, and what the "Last year" tab shows for a
// clause. Nothing here writes, and nothing offers to copy an answer across (that is Task 26's conversion).
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE, type TaxAuditStructuredField, type TaxAuditStructuredTable } from '@/data/taxAudit3CDFieldSchemas';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import { mappingRowsForClause, shownEntry, type Form26MappingRow } from '@/data/taxAuditForm26Mapping';
import type { Form26Definition } from '@/data/taxAuditForm26Types';
import { threeCdRefsText } from '@/lib/taxAuditForm26Compare';
import { editorTitle, form26FieldLocalLabel, FORM26_REVIEW_LABEL } from '@/lib/taxAuditForm26EditorModel';
import { form26PlainText } from '@/lib/taxAuditForm26Review';
import { readSetup, valuesFromRows } from '@/lib/taxAuditForm26Storage';
import type { Form26LastYearResult } from '@/lib/taxAuditForm26Store';
import { getField, type Form26Values } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseResponse } from '@/types/taxAudit';

const DOT = ' · ';
const DASH = '—';

export type Form26AnswerLine = { label: string; value: string };

// ---------------------------------------------------------------------------------------------------
// Form 3CD clauses as VERA holds them

const THREE_CD_BY_KEY = new Map(FORM_3CD_CLAUSES.map((clause) => [clause.key, clause]));

/** The clause VERA holds for a Form 3CD reference of the mapping: '13(a)–(c)' → 'clause_13'; '28' → null (not held). */
export function threeCdClauseKey(reference: string): string | null {
  const match = /^(\d+)([A-Za-z]?)/.exec(String(reference ?? '').trim());
  if (!match) return null;
  const key = `clause_${match[1]}${match[2].toLowerCase()}`;
  return THREE_CD_BY_KEY.has(key) ? key : null;
}

/** The application's short title of a Form 3CD clause (its own words, not the statutory wording). */
export function threeCdClauseTitle(clauseKey: string): string | null {
  return THREE_CD_BY_KEY.get(clauseKey)?.title ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Last year's answers of a Form 3CD clause

type Structured = Record<string, unknown>;

function structuredOf(json: string | null | undefined): Structured {
  try {
    const parsed = JSON.parse(json ?? '{}') as { structured?: unknown };
    const structured = parsed && typeof parsed === 'object' ? parsed.structured : null;
    return structured && typeof structured === 'object' && !Array.isArray(structured) ? (structured as Structured) : {};
  } catch {
    return {};
  }
}

const isBlank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

function shownValue(field: TaxAuditStructuredField, value: unknown): string | null {
  if (isBlank(value)) return null;
  switch (field.type) {
    case 'checkbox':
      // An unticked box is the box's opening state, not an answer: only a ticked one is said.
      return value === true || value === 1 || value === '1' || value === 'true' ? 'Yes' : null;
    case 'select': {
      const text = String(value);
      return field.options?.find((option) => option.value === text)?.label ?? text;
    }
    case 'date': {
      const text = String(value).trim();
      const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
      return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : text;
    }
    case 'percentage':
      return `${String(value).trim()}%`;
    default:
      if (typeof value === 'object') return null;
      return String(value).trim();
  }
}

function visible(field: TaxAuditStructuredField, structured: Structured): boolean {
  const rule = field.visibleWhen;
  if (!rule) return true;
  const held = structured[rule.fieldKey] ?? null;
  if (rule.values) return rule.values.some((value) => value === held);
  if ('value' in rule) return rule.value === held;
  return !isBlank(held);
}

function tableLines(table: TaxAuditStructuredTable, structured: Structured): Form26AnswerLine[] {
  const rows = Array.isArray(structured[table.key]) ? (structured[table.key] as unknown[]) : [];
  const lines: Form26AnswerLine[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const cells = table.columns
      .map((column) => ({ column, value: shownValue(column, (row as Structured)[column.key]) }))
      .filter((cell) => cell.value !== null)
      .map((cell) => `${cell.column.label}: ${cell.value}`);
    if (cells.length > 0) lines.push({ label: `${table.shortLabel ?? table.label}${DOT}row ${index + 1}`, value: cells.join('; ') });
  });
  return lines;
}

/**
 * Last year's answer of a Form 3CD clause as plain lines "label: value", through the application's field
 * schema of that clause: blanks left out, options by their labels, a table row by row, the additional
 * report particulars as plain text. A row that cannot be read gives no lines.
 */
export function threeCdAnswerLines(row: Pick<TaxAuditClauseResponse, 'clause_key' | 'response_json'> & { response_html?: string | null }): Form26AnswerLine[] {
  const schema = TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE.get(row.clause_key);
  const structured = structuredOf(row.response_json);
  const lines: Form26AnswerLine[] = [];
  if (schema) {
    for (const field of schema.fields ?? []) {
      if (!visible(field, structured)) continue;
      const value = shownValue(field, structured[field.key]);
      if (value !== null && value !== '') lines.push({ label: field.label, value });
    }
    for (const table of [schema.table, ...(schema.tables ?? [])]) if (table) lines.push(...tableLines(table, structured));
  }
  const narrative = form26PlainText(row.response_html);
  if (schema && narrative !== '') lines.push({ label: 'Additional report particulars', value: narrative });
  return lines;
}

// ---------------------------------------------------------------------------------------------------
// Last year's answers of a Form No. 26 clause (an engagement of 2027-28 or later)

const UNIT_BY_KEY = new Map(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit]));

/** The answers of one clause of last year's Form No. 26 as lines, numbered as in the form; tables by their filled rows. */
export function form26AnswerLines(def: Form26Definition, unitKey: string, values: Form26Values): Form26AnswerLine[] {
  const unit = UNIT_BY_KEY.get(unitKey);
  if (!unit) return [];
  const fieldByKey = new Map(def.fields.map((field) => [field.key, field]));
  const lines: Form26AnswerLine[] = [];
  for (const key of unit.fields) {
    const value = getField(values, key).trim();
    const field = fieldByKey.get(key);
    if (value === '' || !field) continue;
    const row = field.questionRow !== null ? def.questionRows[field.questionRow] : undefined;
    const ref = row ? `${row.clause}${row.sub ? `(${row.sub})` : ''}` : '';
    const local = form26FieldLocalLabel(def, key).trim();
    const label = [ref, local].filter(Boolean).join(' ') || field.label.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    lines.push({ label, value });
  }
  const tableById = new Map(def.tables.map((table) => [table.id, table]));
  for (const tableId of unit.tables) {
    const table = tableById.get(tableId);
    if (!table) continue;
    const inputs = table.kind === 'depreciation' ? null : table.columns.filter((column) => column.input && column.type !== 'calc' && column.type !== 'sl').map((column) => column.c);
    const filled = (values.t[tableId] ?? []).filter((row) =>
      Object.entries(row).some(([cell, text]) => (inputs === null || inputs.includes(cell)) && String(text ?? '').trim() !== ''),
    ).length;
    if (filled === 0) continue;
    const schedule = table.schedule ? def.schedules.find((entry) => entry.id === table.schedule) : undefined;
    lines.push({ label: schedule?.title ?? `Table of clause ${unit.no}`, value: `${filled} ${filled === 1 ? 'row' : 'rows'} filled` });
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------
// The "Last year" tab of a clause

export const FORM26_LAST_YEAR_TEXT = {
  title: 'Last year',
  loading: 'Opening last year\'s tax audit.',
  failed: 'Last year\'s tax audit could not be read.',
  retry: 'Try again',
  notCovered: 'The comparison with Form 3CD covers clauses 9 to 53.',
  note: 'Last year\'s answers, for reference. Nothing here is filled in for you.',
  yearUnknown: 'Last year cannot be found: the year of this engagement is not in the form 2026-27.',
} as const;

export type Form26LastYearLink = { rowId: string; form26: string; threeCd: string; subject: string; sections: string; whatChanged: string };
export type Form26LastYearAnswers = { key: string; heading: string; state: string | null; lines: Form26AnswerLine[]; empty: string | null };
export type Form26LastYearView = {
  title: string;
  /** 'Form 3CD of 2025-26' once last year's audit is found. */
  subtitle: string | null;
  /** The one plain line in place of answers (loading, none, a failure, a part the comparison does not cover). */
  message: string | null;
  retry: boolean;
  note: string | null;
  /** What the mapping says for this clause (Form 3CD clause, its subject, both sections, what changed). */
  links: Form26LastYearLink[];
  answers: Form26LastYearAnswers[];
  /** Plain lines where there can be no Form 3CD answer (a new clause, a clause VERA does not hold). */
  notes: string[];
};

const ownRefs = (row: Form26MappingRow, clauseNo: string) =>
  row.form26
    .filter((ref) => ref.clause === clauseNo)
    .map((ref) => {
      if (ref.subs.length === 0) return ref.clause;
      const codes = ref.subs.map((sub) => sub.charCodeAt(0));
      const run = ref.subs.length >= 3 && codes.every((code, index) => index === 0 || code === codes[index - 1] + 1);
      return run ? `${ref.clause}(${ref.subs[0]})–(${ref.subs[ref.subs.length - 1]})` : `${ref.clause}${ref.subs.map((sub) => `(${sub})`).join(', ')}`;
    })
    .join(', ');

function linkOf(row: Form26MappingRow, clauseNo: string): Form26LastYearLink {
  const entry = shownEntry(row);
  const subjects = [...new Set(entry.threeCd.map((ref) => ref.subject))];
  const threeCd =
    entry.threeCd.length > 0 ? `Form 3CD clause${entry.threeCd.length > 1 ? 's' : ''} ${threeCdRefsText(entry.threeCd)}` : entry.kind === 'new' ? 'New in Form No. 26' : 'No Form 3CD clause';
  return {
    rowId: row.id,
    form26: ownRefs(row, clauseNo),
    threeCd,
    subject: subjects.length > 0 ? subjects.join('; ') : entry.subject,
    sections: `Section (2025 Act): ${entry.section2025 || DASH}${DOT}Section (1961 Act): ${entry.section1961 || DASH}`,
    whatChanged: entry.whatChanged,
  };
}

function noneMessage(result: Extract<Form26LastYearResult, { state: 'none' }>): string {
  if (result.year === null) return FORM26_LAST_YEAR_TEXT.yearUnknown;
  return result.form === 'form26'
    ? `No Form No. 26 audit of ${result.year} is available to you for this client.`
    : `No Form 3CD audit of ${result.year} is available to you for this client.`;
}

/** What the "Last year" tab shows for one clause unit; `result` null while last year is being read. */
export function lastYearView(unitKey: string, result: Form26LastYearResult | null, def: Form26Definition = FORM26_DEFINITION): Form26LastYearView {
  const view: Form26LastYearView = { title: FORM26_LAST_YEAR_TEXT.title, subtitle: null, message: null, retry: false, note: null, links: [], answers: [], notes: [] };
  const unit = UNIT_BY_KEY.get(unitKey);
  if (result === null) return { ...view, message: FORM26_LAST_YEAR_TEXT.loading };
  if (result.state === 'error') return { ...view, message: FORM26_LAST_YEAR_TEXT.failed, retry: true };

  if (result.form === 'form26') {
    // Last year is Form No. 26 itself: the same clause's own answers; the Form 3CD block is simply absent.
    if (result.state === 'none') return { ...view, message: noneMessage(result) };
    if (!unit) return view;
    const setup = readSetup(result.audit.setup_json);
    const values = valuesFromRows(def, setup, result.rows);
    const row = result.rows.find((entry) => entry.clause_key === unit.key);
    const lines = form26AnswerLines(def, unit.key, values);
    const title = editorTitle(unit);
    return {
      ...view,
      subtitle: `Form No. 26 of ${result.year}`,
      note: FORM26_LAST_YEAR_TEXT.note,
      answers: [{ key: unit.key, heading: title.prefix ?? title.label, state: row ? FORM26_REVIEW_LABEL[row.review_status] ?? null : null, lines, empty: lines.length > 0 ? null : `No answer was recorded for this clause in ${result.year}.` }],
    };
  }

  const clauseNo = unit?.no ?? '';
  const covered = /^\d+$/.test(clauseNo) && Number(clauseNo) >= 9 && Number(clauseNo) <= 53;
  const mappings = covered ? mappingRowsForClause(clauseNo) : [];
  const links = mappings.map((row) => linkOf(row, clauseNo));
  if (!covered) return { ...view, subtitle: result.state === 'found' ? `Form 3CD of ${result.year}` : null, message: FORM26_LAST_YEAR_TEXT.notCovered };
  if (result.state === 'none') return { ...view, links, message: noneMessage(result) };

  const notes: string[] = [];
  const keys: string[] = [];
  for (const row of mappings) {
    const entry = shownEntry(row);
    if (entry.threeCd.length === 0) {
      notes.push(entry.kind === 'new'
        ? `Clause ${ownRefs(row, clauseNo)} is new in Form No. 26. There is no Form 3CD answer for it.`
        : `Clause ${ownRefs(row, clauseNo)} has no Form 3CD clause. There is no Form 3CD answer for it.`);
      continue;
    }
    for (const ref of entry.threeCd) {
      const key = threeCdClauseKey(ref.clause);
      if (key === null) {
        const line = `Form 3CD clause ${ref.clause} is not held in VERA.`;
        if (!notes.includes(line)) notes.push(line);
      } else if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  const answers = keys.map((key): Form26LastYearAnswers => {
    const row = result.rows.find((entry) => entry.clause_key === key);
    const lines = row ? threeCdAnswerLines(row) : [];
    const clause = THREE_CD_BY_KEY.get(key);
    return {
      key,
      heading: `Clause ${clause?.clauseNo ?? key}${DOT}${clause?.title ?? ''}`,
      state: row ? FORM26_REVIEW_LABEL[row.review_status] ?? null : null,
      lines,
      empty: lines.length > 0 ? null : `No answer was recorded for this clause in ${result.year}.`,
    };
  });
  return { ...view, subtitle: `Form 3CD of ${result.year}`, note: FORM26_LAST_YEAR_TEXT.note, links, answers, notes };
}
