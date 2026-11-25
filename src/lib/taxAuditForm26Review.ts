// Review state of Form No. 26 clauses: the patch for a change of state, what is locked, and the counts.
// Pure functions; the state columns and their meaning are those of the Form 3CD clauses.
import { form26ClauseKeyOfField, form26ClauseKeyOfTable, type Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Category, Form26Definition, Form26Table } from '@/data/taxAuditForm26Types';
import { FORM26_SAVE_FILE_MAX_ROWS as FORM26_TABLE_MAX_ROWS } from '@/lib/taxAuditForm26SaveFile';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { form26BlankRow, form26RowCellKeys, type Form26Row } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseEvidence, TaxAuditClauseResponse, TaxAuditReviewStatus, TaxAuditSummary } from '@/types/taxAudit';

/**
 * The columns written when a clause is marked: the same object, field for field, that the Form 3CD
 * hook builds in `updateClauseStatus` (prepared: who and when; reviewed: who and when; approved: who and
 * when, and the lock with who and when; with a reason for unlocking: the lock is taken off and the reason kept).
 */
export function statusPatch(
  status: TaxAuditReviewStatus,
  input: { userId: string | null; now: string; unlockReason?: string },
): Partial<TaxAuditClauseResponse> {
  const isUnlockForEdit = Boolean(input.unlockReason);
  const userId = input.userId || null;
  const patch: Partial<TaxAuditClauseResponse> = {
    review_status: status,
    locked: isUnlockForEdit ? 0 : status === 'approved' || status === 'locked' ? 1 : 0,
  };
  if (status === 'prepared') {
    patch.prepared_by = userId;
    patch.prepared_at = input.now;
  }
  if (status === 'reviewed') {
    patch.reviewed_by = userId;
    patch.reviewed_at = input.now;
  }
  if (status === 'approved') {
    patch.approved_by = userId;
    patch.approved_at = input.now;
    patch.locked_by = userId;
    patch.locked_at = input.now;
  }
  if (isUnlockForEdit) {
    patch.unlock_reason = input.unlockReason || null;
    patch.locked_by = null;
    patch.locked_at = null;
  }
  return patch;
}

/** A row that must not be changed: locked, or in the state approved or locked. */
export function isRowLocked(row: Pick<TaxAuditClauseResponse, 'locked' | 'review_status'>): boolean {
  return Boolean(row.locked) || row.review_status === 'approved' || row.review_status === 'locked';
}

function clauseLocked(clauseKey: string, rowsByKey: Map<string, Form26ClauseRow>): boolean {
  const row = rowsByKey.get(clauseKey);
  return row ? isRowLocked(row) : false;
}

/** An answer is locked with its clause. Throws for a key the form does not have. */
export function isFieldLocked(def: Form26Definition, fieldKey: string, rowsByKey: Map<string, Form26ClauseRow>): boolean {
  return clauseLocked(form26ClauseKeyOfField(fieldKey), rowsByKey);
}

/** A table is locked with the clause it stands under (its own storage row carries no state). */
export function isTableLocked(def: Form26Definition, tableId: string, rowsByKey: Map<string, Form26ClauseRow>): boolean {
  return clauseLocked(form26ClauseKeyOfTable(tableId), rowsByKey);
}

/**
 * Who may approve or unlock a Form No. 26 clause: every user assigned to the engagement, as on a Form 3CD
 * clause today (decision A6; the lock is kept on screen only, recorded as a gap). One line to change.
 */
export function canApproveForm26(role: string | null | undefined): boolean {
  void role;
  return true;
}

/**
 * The row that "Add to the report's observations" puts into the observations table of the report (A5 for
 * category (i), B5 for category (ii)): the clause number, no type chosen, the plain text of the box (decision
 * A8). Null when no category is chosen or the clause is not one of 9 to 53 (the table's own heading).
 */
export function qualificationRow(clauseNo: string, plainText: string, category: '' | Form26Category): { table: 'A5' | 'B5'; row: Form26Row } | null {
  if (category !== '1' && category !== '2') return null;
  if (!/^\d+$/.test(clauseNo)) return null;
  const no = Number(clauseNo);
  if (no < 9 || no > 53) return null;
  return { table: category === '1' ? 'A5' : 'B5', row: { '1': clauseNo, '2': '', '3': plainText } };
}

const isBlankRow = (table: Form26Table, row: Form26Row | undefined): boolean =>
  form26RowCellKeys(table, 0).every((key) => (row?.[key] ?? '') === '');

/**
 * The observations table with one more observation: put in the first row that holds nothing (the file opens
 * the table with empty rows), else added at the end. Null when the table already has the largest number of
 * rows a table can hold.
 */
export function observationRows(table: Form26Table, rows: Form26Row[], row: Form26Row): Form26Row[] | null {
  const at = rows.findIndex((entry) => isBlankRow(table, entry));
  if (at >= 0) return rows.map((entry, index) => (index === at ? { ...form26BlankRow(table, index), ...row } : entry));
  if (rows.length >= FORM26_TABLE_MAX_ROWS) return null;
  return [...rows, { ...form26BlankRow(table, rows.length), ...row }];
}

/** True when the observations table already has a row for this clause number. */
export function hasObservationFor(rows: Form26Row[] | undefined, clauseNo: string): boolean {
  return (rows ?? []).some((row) => (row['1'] ?? '').trim() === clauseNo);
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** The plain text of a rich-text box (review remarks, the qualification box): one line per paragraph or break. */
export function form26PlainText(html: string | null | undefined): string {
  if (typeof html !== 'string' || html === '') return '';
  const marked = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<(p|div|li|h[1-6])\b[^>]*>/gi, '\u0001')         // a block begins: a new line unless one has just begun
    .replace(/<[^>]*>/g, '');
  let text = '';
  for (const char of marked) {
    if (char === '\u0001') {
      if (text !== '' && !text.endsWith('\n')) text += '\n';
    } else {
      text += char;
    }
  }
  text = text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITY[name]);
  const lines = text.split('\n').map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The counts of the header, over the clause rows only (a table's own row is not a clause). */
export function summarise(units: Form26ClauseUnit[], rowsByKey: Map<string, Form26ClauseRow>, evidence: TaxAuditClauseEvidence[]): TaxAuditSummary {
  const rows = units.map((unit) => rowsByKey.get(unit.key)).filter((row): row is Form26ClauseRow => row !== undefined);
  const withEvidence = new Set(evidence.map((link) => link.clause_response_id));
  return {
    totalClauses: units.length,
    prepared: rows.filter((row) => row.review_status === 'prepared').length,
    reviewed: rows.filter((row) => row.review_status === 'reviewed').length,
    approved: rows.filter((row) => row.review_status === 'approved' || row.review_status === 'locked').length,
    needsInput: rows.filter((row) => row.prefill_status === 'needs_input').length,
    partial: rows.filter((row) => row.prefill_status === 'partially_filled').length,
    conflicts: rows.filter((row) => row.prefill_status === 'source_conflict' || row.validation_status === 'error').length,
    evidenceLinked: rows.filter((row) => withEvidence.has(row.id)).length,
    qualifications: rows.filter((row) => Boolean(row.qualification_required)).length,
  };
}
