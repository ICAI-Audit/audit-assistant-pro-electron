import { describe, expect, it } from 'vitest';
import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { TAX_AUDIT_PROGRAMME_CHECKLIST } from '@/data/taxAuditProgrammeChecklist';
import {
  buildTaxAuditProgrammeSetupJson,
  normalizeTaxAuditProgramme,
  summarizeTaxAuditProgramme,
} from '@/lib/taxAuditProgramme';

describe('taxAuditProgramme helpers', () => {
  it('normalizes an empty Audit Programme from the checklist master', () => {
    const programme = normalizeTaxAuditProgramme(undefined);

    expect(Object.keys(programme.items)).toHaveLength(TAX_AUDIT_PROGRAMME_CHECKLIST.length);
    expect(programme.last_updated_at).toBe('');
    expect(programme.items[TAX_AUDIT_PROGRAMME_CHECKLIST[0].id]).toMatchObject({
      status: 'Not started',
      response: 'To be reviewed',
      working_reference: '',
    });
  });

  it('calculates completion and review counts from item state', () => {
    const programme = normalizeTaxAuditProgramme({
      items: {
        [TAX_AUDIT_PROGRAMME_CHECKLIST[0].id]: {
          status: 'Completed',
          response: 'Yes',
          assigned_to: '',
          due_date: '',
          working_reference: 'WP-1',
          remarks: '',
          reviewed_by: '',
          reviewed_at: '',
        },
        [TAX_AUDIT_PROGRAMME_CHECKLIST[1].id]: {
          status: 'Reviewed',
          response: 'Yes',
          assigned_to: '',
          due_date: '',
          working_reference: 'WP-2',
          remarks: '',
          reviewed_by: 'Reviewer',
          reviewed_at: '2025-09-30T00:00:00.000Z',
        },
        [TAX_AUDIT_PROGRAMME_CHECKLIST[2].id]: {
          status: 'Not applicable',
          response: 'Not applicable',
          assigned_to: '',
          due_date: '',
          working_reference: '',
          remarks: '',
          reviewed_by: '',
          reviewed_at: '',
        },
      },
    });
    const stats = summarizeTaxAuditProgramme(programme);

    expect(stats.total).toBe(TAX_AUDIT_PROGRAMME_CHECKLIST.length);
    expect(stats.completed).toBe(1);
    expect(stats.reviewed).toBe(1);
    expect(stats.notApplicable).toBe(1);
    expect(stats.hasResponses).toBe(true);
  });

  it('normalizes old or malformed Audit Programme item state safely', () => {
    const programme = normalizeTaxAuditProgramme({
      items: {
        [TAX_AUDIT_PROGRAMME_CHECKLIST[0].id]: {
          status: 'Done',
          response: 'Maybe',
          assigned_to: 123,
          due_date: null,
          working_reference: ['WP'],
          remarks: false,
          reviewed_by: {},
          reviewed_at: 1,
        },
        [TAX_AUDIT_PROGRAMME_CHECKLIST[1].id]: {
          status: 'In progress',
          response: 'No',
          assigned_to: 'A1',
          due_date: '2025-09-30',
          working_reference: 'WP-2',
          remarks: 'Needs review',
          reviewed_by: '',
          reviewed_at: '',
        },
      },
    });

    expect(programme.items[TAX_AUDIT_PROGRAMME_CHECKLIST[0].id]).toMatchObject({
      status: 'Not started',
      response: 'To be reviewed',
      assigned_to: '',
      due_date: '',
      working_reference: '',
      remarks: '',
      reviewed_by: '',
      reviewed_at: '',
    });
    expect(programme.items[TAX_AUDIT_PROGRAMME_CHECKLIST[1].id]).toMatchObject({
      status: 'In progress',
      response: 'No',
      assigned_to: 'A1',
      due_date: '2025-09-30',
      working_reference: 'WP-2',
      remarks: 'Needs review',
    });
  });

  it('preserves unrelated setup details when building saved Audit Programme data', () => {
    const programme = normalizeTaxAuditProgramme({
      items: {
        [TAX_AUDIT_PROGRAMME_CHECKLIST[0].id]: {
          status: 'Completed',
          response: 'Yes',
          assigned_to: 'A1',
          due_date: '2025-09-30',
          working_reference: 'WP-A',
          remarks: 'Done',
          reviewed_by: 'Reviewer',
          reviewed_at: '2025-09-30T00:00:00.000Z',
        },
      },
    });
    const saved = JSON.parse(
      buildTaxAuditProgrammeSetupJson({
        currentSetupJson: JSON.stringify({
          applicabilityInputs: { has_business_activity: true },
          complianceTracker: { due_date_for_return: '2025-10-31' },
          customSection: { keep: true },
          auditProgramme: { previousNote: 'keep me' },
        }),
        programme,
        updatedAt: '2025-10-01T00:00:00.000Z',
      })
    );

    expect(saved.applicabilityInputs).toEqual({ has_business_activity: true });
    expect(saved.complianceTracker).toEqual({ due_date_for_return: '2025-10-31' });
    expect(saved.customSection).toEqual({ keep: true });
    expect(saved.auditProgramme.previousNote).toBe('keep me');
    expect(saved.auditProgramme.last_updated_at).toBe('2025-10-01T00:00:00.000Z');
    expect(saved.auditProgramme.items[TAX_AUDIT_PROGRAMME_CHECKLIST[0].id].working_reference).toBe('WP-A');
  });

  it('saving one checklist item keeps other checklist item state intact', () => {
    const firstItem = TAX_AUDIT_PROGRAMME_CHECKLIST[0].id;
    const secondItem = TAX_AUDIT_PROGRAMME_CHECKLIST[1].id;
    const programme = normalizeTaxAuditProgramme({
      items: {
        [firstItem]: {
          status: 'Completed',
          response: 'Yes',
          assigned_to: 'A1',
          due_date: '2025-09-30',
          working_reference: 'WP-1',
          remarks: 'Completed',
          reviewed_by: '',
          reviewed_at: '',
        },
        [secondItem]: {
          status: 'Reviewed',
          response: 'Yes',
          assigned_to: 'A2',
          due_date: '2025-10-01',
          working_reference: 'WP-2',
          remarks: 'Reviewed',
          reviewed_by: 'Reviewer',
          reviewed_at: '2025-10-01T00:00:00.000Z',
        },
      },
    });

    const saved = JSON.parse(
      buildTaxAuditProgrammeSetupJson({
        currentSetupJson: '{}',
        programme,
        updatedAt: '2025-10-02T00:00:00.000Z',
      })
    );

    expect(saved.auditProgramme.items[firstItem]).toMatchObject({
      status: 'Completed',
      response: 'Yes',
      assigned_to: 'A1',
      due_date: '2025-09-30',
      working_reference: 'WP-1',
      remarks: 'Completed',
    });
    expect(saved.auditProgramme.items[secondItem]).toMatchObject({
      status: 'Reviewed',
      response: 'Yes',
      assigned_to: 'A2',
      due_date: '2025-10-01',
      working_reference: 'WP-2',
      remarks: 'Reviewed',
      reviewed_by: 'Reviewer',
      reviewed_at: '2025-10-01T00:00:00.000Z',
    });
  });

  it('keeps Audit Programme navigation targets valid and safe', () => {
    const linkedTabs = new Set(TAX_AUDIT_PROGRAMME_CHECKLIST.map((item) => item.linkedTab));
    const activeClauseKeys = new Set(FORM_3CD_CLAUSES.map((clause) => clause.key));

    expect(linkedTabs).toEqual(new Set(['setup', 'acceptance', 'compliance', 'clauses', 'summary']));
    expect(
      TAX_AUDIT_PROGRAMME_CHECKLIST
        .filter((item) => item.linkedTab === 'clauses' && item.linkedClauseKey)
        .every((item) => activeClauseKeys.has(item.linkedClauseKey || ''))
    ).toBe(true);
  });
});
