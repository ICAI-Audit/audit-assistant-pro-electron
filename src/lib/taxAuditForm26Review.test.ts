import { describe, expect, it } from 'vitest';
import { FORM26_CLAUSE_UNITS, form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  canApproveForm26,
  form26PlainText,
  hasObservationFor,
  isFieldLocked,
  isRowLocked,
  isTableLocked,
  observationRows,
  qualificationRow,
  statusPatch,
  summarise,
} from '@/lib/taxAuditForm26Review';
import { seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { defaultValues } from '@/lib/taxAuditForm26Values';
import type { TaxAuditClauseEvidence, TaxAuditClauseResponse, TaxAuditReviewStatus } from '@/types/taxAudit';

const NOW = '2026-11-22T09:30:00.000Z';
const USER = 'user-invented-1';

// What the Form 3CD hook builds (src/hooks/useTaxAudit.ts, updateClauseStatus), written out as a literal
// function of the same inputs, so that the two can be compared field for field.
function threeCdHookPayload(status: TaxAuditReviewStatus, userId: string | null, timestamp: string, unlockReason?: string): Record<string, unknown> {
  const isUnlockForEdit = Boolean(unlockReason);
  const payload: Record<string, unknown> = {
    review_status: status,
    locked: isUnlockForEdit ? 0 : status === 'approved' || status === 'locked' ? 1 : 0,
  };
  if (status === 'prepared') {
    payload.prepared_by = userId || null;
    payload.prepared_at = timestamp;
  }
  if (status === 'reviewed') {
    payload.reviewed_by = userId || null;
    payload.reviewed_at = timestamp;
  }
  if (status === 'approved') {
    payload.approved_by = userId || null;
    payload.approved_at = timestamp;
    payload.locked_by = userId || null;
    payload.locked_at = timestamp;
  }
  if (isUnlockForEdit) {
    payload.unlock_reason = unlockReason || null;
    payload.locked_by = null;
    payload.locked_at = null;
  }
  return payload;
}

function rowsByKey(change?: (row: Form26ClauseRow) => Form26ClauseRow): Map<string, Form26ClauseRow> {
  const map = new Map<string, Form26ClauseRow>();
  seedRows(DEF, 'audit-1', defaultValues(DEF), []).forEach((seed, index) => {
    const row: Form26ClauseRow = { ...seed, id: `row-${index}` };
    map.set(row.clause_key, change ? change(row) : row);
  });
  return map;
}

describe('statusPatch', () => {
  it('prepared', () => {
    expect(statusPatch('prepared', { userId: USER, now: NOW })).toEqual({ review_status: 'prepared', locked: 0, prepared_by: USER, prepared_at: NOW });
  });
  it('reviewed', () => {
    expect(statusPatch('reviewed', { userId: USER, now: NOW })).toEqual({ review_status: 'reviewed', locked: 0, reviewed_by: USER, reviewed_at: NOW });
  });
  it('approved', () => {
    expect(statusPatch('approved', { userId: USER, now: NOW })).toEqual({
      review_status: 'approved', locked: 1, approved_by: USER, approved_at: NOW, locked_by: USER, locked_at: NOW,
    });
  });
  it('draft and locked', () => {
    expect(statusPatch('draft', { userId: USER, now: NOW })).toEqual({ review_status: 'draft', locked: 0 });
    expect(statusPatch('locked', { userId: USER, now: NOW })).toEqual({ review_status: 'locked', locked: 1 });
  });
  it('unlock with a reason', () => {
    expect(statusPatch('draft', { userId: USER, now: NOW, unlockReason: 'Figure corrected' })).toEqual({
      review_status: 'draft', locked: 0, unlock_reason: 'Figure corrected', locked_by: null, locked_at: null,
    });
    expect(statusPatch('prepared', { userId: USER, now: NOW, unlockReason: 'Figure corrected' })).toEqual({
      review_status: 'prepared', locked: 0, prepared_by: USER, prepared_at: NOW, unlock_reason: 'Figure corrected', locked_by: null, locked_at: null,
    });
  });
  it('is the object the Form 3CD hook builds, for every status, with and without a user and a reason', () => {
    const statuses: TaxAuditReviewStatus[] = ['draft', 'prepared', 'reviewed', 'approved', 'locked'];
    for (const status of statuses) {
      for (const userId of [USER, null]) {
        for (const unlockReason of [undefined, '', 'Reopened for a correction']) {
          expect(statusPatch(status, { userId, now: NOW, unlockReason })).toEqual(threeCdHookPayload(status, userId, NOW, unlockReason));
        }
      }
    }
  });
  it('never names a column that identifies the row', () => {
    const patch = statusPatch('approved', { userId: USER, now: NOW });
    for (const key of ['id', 'tax_audit_id', 'clause_key', 'statutory_version', 'response_json']) expect(key in patch).toBe(false);
  });
});

describe('locking', () => {
  it('isRowLocked: locked, approved or locked state', () => {
    expect(isRowLocked({ locked: 0, review_status: 'draft' })).toBe(false);
    expect(isRowLocked({ locked: 0, review_status: 'prepared' })).toBe(false);
    expect(isRowLocked({ locked: 0, review_status: 'reviewed' })).toBe(false);
    expect(isRowLocked({ locked: 1, review_status: 'draft' })).toBe(true);
    expect(isRowLocked({ locked: true, review_status: 'reviewed' })).toBe(true);
    expect(isRowLocked({ locked: 0, review_status: 'approved' })).toBe(true);
    expect(isRowLocked({ locked: false, review_status: 'locked' })).toBe(true);
  });

  it('a field is locked when its clause is approved, and only then', () => {
    const rows = rowsByKey((row) => (row.clause_key === 'f26_c14' ? { ...row, review_status: 'approved', locked: 1 } : row));
    expect(isFieldLocked(DEF, 'c14d', rows)).toBe(true);
    expect(isFieldLocked(DEF, 'c14b', rows)).toBe(true);
    expect(isFieldLocked(DEF, 'c13', rows)).toBe(false);
    expect(isFieldLocked(DEF, 'c15a', rows)).toBe(false);
  });

  it('the category is locked by its own row', () => {
    expect(isFieldLocked(DEF, 'cat', rowsByKey())).toBe(false);
    expect(isFieldLocked(DEF, 'cat', rowsByKey((row) => (row.clause_key === 'f26_category' ? { ...row, locked: 1 } : row)))).toBe(true);
  });

  it('a table is locked when its clause is approved', () => {
    const rows = rowsByKey((row) => (row.clause_key === 'f26_c45' ? { ...row, review_status: 'approved', locked: 1 } : row));
    for (const id of ['S45a', 'S45b', 'S45c', 'S45d']) expect(isTableLocked(DEF, id, rows)).toBe(true);
    expect(isTableLocked(DEF, 'S44', rows)).toBe(false);
    expect(isTableLocked(DEF, 'P14a', rows)).toBe(false);
    expect(rows.get(form26TableRowKey('S45a'))?.review_status).toBe('draft');     // the table's own row is not what locks it
  });

  it('a table inside Part A follows Part A', () => {
    const rows = rowsByKey((row) => (row.clause_key === 'f26_part_a' ? { ...row, review_status: 'locked' } : row));
    expect(isTableLocked(DEF, 'A5', rows)).toBe(true);
    expect(isTableLocked(DEF, 'B5', rows)).toBe(false);
  });

  it('an id the form does not have throws; a clause whose row is not loaded is not locked', () => {
    expect(() => isFieldLocked(DEF, 'c999', rowsByKey())).toThrow();
    expect(() => isTableLocked(DEF, 'S999', rowsByKey())).toThrow();
    expect(isFieldLocked(DEF, 'c14d', new Map())).toBe(false);
    expect(isTableLocked(DEF, 'S45a', new Map())).toBe(false);
  });
});

describe('summarise', () => {
  const link = (rowId: string, fileId: string): TaxAuditClauseEvidence => ({
    id: `link-${rowId}-${fileId}`, tax_audit_id: 'audit-1', clause_response_id: rowId, clause_key: 'f26_x', evidence_file_id: fileId, linked_at: NOW,
  });

  it('summary counts 57 clauses', () => {
    expect(summarise(FORM26_CLAUSE_UNITS, rowsByKey(), [])).toEqual({
      totalClauses: 57, prepared: 0, reviewed: 0, approved: 0, needsInput: 0, partial: 0, conflicts: 0, evidenceLinked: 0, qualifications: 0,
    });
  });

  it('counts states, qualifications and evidence over the clause rows, never over the table rows', () => {
    const state: Record<string, Partial<TaxAuditClauseResponse>> = {
      f26_c9: { review_status: 'prepared' },
      f26_c10: { review_status: 'prepared', qualification_required: 1 },
      f26_c11: { review_status: 'reviewed' },
      f26_c12: { review_status: 'approved', locked: 1 },
      f26_c13: { review_status: 'locked', locked: 1 },
      f26_c14: { qualification_required: true },
      f26_c15: { prefill_status: 'needs_input' },
      f26_c16: { prefill_status: 'partially_filled' },
      f26_c17: { prefill_status: 'source_conflict' },
      f26_c18: { validation_status: 'error' },
      f26_t_S45a: { review_status: 'approved', qualification_required: 1, prefill_status: 'needs_input' },
    };
    const rows = rowsByKey((row) => ({ ...row, ...(state[row.clause_key] ?? {}) }));
    const idOf = (key: string) => rows.get(key)?.id ?? '';
    const evidence = [link(idOf('f26_c9'), 'file-1'), link(idOf('f26_c9'), 'file-2'), link(idOf('f26_c20'), 'file-1'), link(idOf('f26_t_S45a'), 'file-3'), link('row-of-another-audit', 'file-4')];
    expect(summarise(FORM26_CLAUSE_UNITS, rows, evidence)).toEqual({
      totalClauses: 57, prepared: 2, reviewed: 1, approved: 2, needsInput: 1, partial: 1, conflicts: 2, evidenceLinked: 2, qualifications: 2,
    });
  });

  it('a unit whose row is not loaded is counted in the total only', () => {
    expect(summarise(FORM26_CLAUSE_UNITS, new Map(), []).totalClauses).toBe(57);
  });
});

describe('who may approve (decision A6)', () => {
  it('canApproveForm26 returns true for every role, as Approve on a Form 3CD clause today', () => {
    for (const role of ['admin', 'partner', 'manager', 'senior', 'staff', 'article', '', null, undefined, 'something else']) {
      expect(canApproveForm26(role)).toBe(true);
    }
  });
});

describe('qualification into the report\'s observations (decision A8)', () => {
  it('qualificationRow: category (ii) gives table B5, category (i) table A5, no category or a clause outside 9-53 nothing', () => {
    expect(qualificationRow('14', 'text', '2')).toEqual({ table: 'B5', row: { '1': '14', '2': '', '3': 'text' } });
    expect(qualificationRow('14', 'text', '1')).toEqual({ table: 'A5', row: { '1': '14', '2': '', '3': 'text' } });
    expect(qualificationRow('14', 'text', '')).toBeNull();
    expect(qualificationRow('Part A', 'text', '2')).toBeNull();
    expect(qualificationRow('8', 'text', '2')).toBeNull();
    expect(qualificationRow('9', 'text', '2')?.table).toBe('B5');
    expect(qualificationRow('53', 'text', '1')?.table).toBe('A5');
    expect(qualificationRow('54', 'text', '1')).toBeNull();
    expect(qualificationRow('Signature', 'text', '1')).toBeNull();
  });

  it('observationRows fills the first empty row (the file opens the table with two) and adds a row only when every row holds something', () => {
    const b5 = DEF.tables.find((table) => table.id === 'B5')!;
    const blank = [{ '1': '', '2': '', '3': '' }, { '1': '', '2': '', '3': '' }];
    const first = observationRows(b5, blank, { '1': '14', '2': '', '3': 'Invented observation' });
    expect(first).toEqual([{ '1': '14', '2': '', '3': 'Invented observation' }, { '1': '', '2': '', '3': '' }]);
    const second = observationRows(b5, first!, { '1': '20', '2': '', '3': 'Another' });
    expect(second?.[1]).toEqual({ '1': '20', '2': '', '3': 'Another' });
    const third = observationRows(b5, second!, { '1': '21', '2': '', '3': 'Third' });
    expect(third).toHaveLength(3);
    expect(third?.[2]).toEqual({ '1': '21', '2': '', '3': 'Third' });
    // A table that has reached the largest number of rows takes no more.
    const full = Array.from({ length: 5000 }, () => ({ '1': '9', '2': '', '3': 'x' }));
    expect(observationRows(b5, full, { '1': '14', '2': '', '3': 'y' })).toBeNull();
  });

  it('hasObservationFor finds a row of the table for the clause number', () => {
    expect(hasObservationFor([{ '1': '14', '2': '', '3': 'x' }], '14')).toBe(true);
    expect(hasObservationFor([{ '1': ' 14 ', '2': '', '3': 'x' }], '14')).toBe(true);
    expect(hasObservationFor([{ '1': '15', '2': '', '3': 'x' }], '14')).toBe(false);
    expect(hasObservationFor(undefined, '14')).toBe(false);
  });

  it('form26PlainText turns the rich text of the qualification box into plain lines', () => {
    expect(form26PlainText('<p>First <strong>line</strong></p><p>Second&nbsp;line &amp; more</p>')).toBe('First line\nSecond line & more');
    expect(form26PlainText('One<br>Two<div>Three</div>')).toBe('One\nTwo\nThree');
    expect(form26PlainText('<ul><li>a</li><li>b &lt;c&gt;</li></ul>')).toBe('a\nb <c>');
    expect(form26PlainText('')).toBe('');
    expect(form26PlainText(null)).toBe('');
    expect(form26PlainText('<p></p><p>  </p>')).toBe('');
    expect(form26PlainText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });
});
