import { describe, expect, it } from 'vitest';
import { clientOn, FakeTaxAuditDb, FORM26_VERSION, THREE_CD_VERSION } from '@/lib/__fixtures__/taxAuditForm26/fakeTaxAuditDb';
import { hasForm26Audit, hasThreeCdAudit, taxAuditChooserView } from '@/lib/taxAuditForm26Chooser';
import { chooseTaxAuditForm } from '@/lib/taxAuditForm26Year';

describe('the tax-audit chooser (task 19)', () => {
  it('no engagement and every Form 3CD year open the Form 3CD screens, without waiting for anything', () => {
    expect(taxAuditChooserView({ engagementId: null, choice: '3cd', threeCdCheck: null })).toBe('three-cd');
    expect(taxAuditChooserView({ engagementId: undefined, choice: 'form26', threeCdCheck: null })).toBe('three-cd');
    expect(taxAuditChooserView({ engagementId: null, choice: 'unknown', threeCdCheck: null })).toBe('three-cd');
    expect(taxAuditChooserView({ engagementId: 'e1', choice: '3cd', threeCdCheck: null })).toBe('three-cd');
  });

  it('a Form No. 26 year opens the Form No. 26 workspace', () => {
    expect(taxAuditChooserView({ engagementId: 'e1', choice: 'form26', threeCdCheck: null })).toBe('form26');
  });

  it('a year not understood: Form 3CD when a Form 3CD audit is there (A10), else the year message; while the check runs, the opening state', () => {
    expect(taxAuditChooserView({ engagementId: 'e1', choice: 'unknown', threeCdCheck: null })).toBe('checking');
    expect(taxAuditChooserView({ engagementId: 'e1', choice: 'unknown', threeCdCheck: { engagementId: 'e1', found: true } })).toBe('three-cd');
    expect(taxAuditChooserView({ engagementId: 'e1', choice: 'unknown', threeCdCheck: { engagementId: 'e1', found: false } })).toBe('year-unknown');
    // The answer for another engagement is never used.
    expect(taxAuditChooserView({ engagementId: 'e2', choice: 'unknown', threeCdCheck: { engagementId: 'e1', found: true } })).toBe('checking');
  });

  it('released: tax years from 2026-27 open Form No. 26, earlier years Form 3CD, a year not understood the message or the Form 3CD audit already there', () => {
    const view = (year: string | null | undefined, threeCdFound: boolean | null) =>
      taxAuditChooserView({
        engagementId: 'e1',
        choice: chooseTaxAuditForm(year),
        threeCdCheck: threeCdFound === null ? null : { engagementId: 'e1', found: threeCdFound },
      });
    for (const year of ['2026-27', '2026-2027', 'FY 2026-27', '2027-28', '2030-31']) {
      expect(view(year, null), year).toBe('form26');
      // A Form 3CD audit of such an engagement is converted by the workspace, not opened (R5).
      expect(view(year, true), year).toBe('form26');
    }
    for (const year of ['2024-25', '2025-26', '2025-2026', 'FY 2025-26', '2017-18']) {
      expect(view(year, null), year).toBe('three-cd');
      expect(view(year, false), year).toBe('three-cd');
    }
    for (const year of ['Year 26', '', null, undefined, 'AY 2027-28', '2026-28']) {
      expect(view(year, null), String(year)).toBe('checking');
      expect(view(year, false), String(year)).toBe('year-unknown');
      expect(view(year, true), String(year)).toBe('three-cd');
    }
  });

  it('the Form 3CD check reads only, finds a Form 3CD audit of the engagement, ignores the Form No. 26 audit and other engagements', async () => {
    const db = new FakeTaxAuditDb();
    db.assigned.add('e1');
    db.assigned.add('e2');
    db.seed('engagements', { id: 'e1', financial_year: 'Year 26' });
    db.seed('engagements', { id: 'e2', financial_year: 'Year 26' });
    const client = await clientOn(db);
    expect(await hasThreeCdAudit(client, 'e1')).toBe(false);
    db.seed('tax_audit_engagements', { id: 'a26', engagement_id: 'e1', statutory_version: FORM26_VERSION });
    db.seed('tax_audit_engagements', { id: 'a3cd-other', engagement_id: 'e2', statutory_version: THREE_CD_VERSION });
    expect(await hasThreeCdAudit(client, 'e1')).toBe(false);
    db.seed('tax_audit_engagements', { id: 'a3cd', engagement_id: 'e1', statutory_version: THREE_CD_VERSION });
    expect(await hasThreeCdAudit(client, 'e1')).toBe(true);
    expect(db.writes()).toEqual([]);
    expect(db.calls.every((call) => call.table === 'tax_audit_engagements' && call.action === 'select')).toBe(true);
  });

  it('a check that cannot be read counts as "no Form 3CD audit": the year message is shown and nothing is created', async () => {
    const db = new FakeTaxAuditDb();
    db.assigned.add('e1');
    db.seed('tax_audit_engagements', { id: 'a3cd', engagement_id: 'e1', statutory_version: THREE_CD_VERSION });
    const client = await clientOn(db);
    db.before = () => ({ data: null, error: { message: 'The database is busy.' } });
    expect(await hasThreeCdAudit(client, 'e1')).toBe(false);
    db.before = () => {
      throw new Error('IPC failed');
    };
    expect(await hasThreeCdAudit(client, 'e1')).toBe(false);
    expect(db.writes()).toEqual([]);
  });

  it('task 26: the Form No. 26 check (a year changed back) reads only, finds the Form No. 26 audit of this engagement alone; a failed read is "none"', async () => {
    const db = new FakeTaxAuditDb();
    db.assigned.add('e1');
    db.assigned.add('e2');
    const client = await clientOn(db);
    db.seed('tax_audit_engagements', { id: 'a3cd', engagement_id: 'e1', statutory_version: THREE_CD_VERSION });
    db.seed('tax_audit_engagements', { id: 'a26-other', engagement_id: 'e2', statutory_version: FORM26_VERSION });
    expect(await hasForm26Audit(client, 'e1')).toBe(false);
    db.seed('tax_audit_engagements', { id: 'a26', engagement_id: 'e1', statutory_version: FORM26_VERSION });
    expect(await hasForm26Audit(client, 'e1')).toBe(true);
    db.before = () => ({ data: null, error: { message: 'The database is busy.' } });
    expect(await hasForm26Audit(client, 'e1')).toBe(false);
    expect(db.writes()).toEqual([]);
    expect(db.calls.every((call) => call.table === 'tax_audit_engagements' && call.action === 'select')).toBe(true);
  });
});
