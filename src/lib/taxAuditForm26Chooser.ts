// What the Tax Audit page shows for the chosen engagement (task 19): the Form 3CD screens, the Form No. 26
// workspace, a short opening state while one check runs, or the plain "year not understood" message.
// Deliberately light: it is loaded with the page, so it must not bring the Form No. 26 definition with it.
import { TAX_AUDIT_FORM26_STATUTORY_VERSION } from '@/data/taxAuditForm26Version';
import type { Form26Db } from '@/lib/taxAuditForm26Store';
import type { TaxAuditFormChoice } from '@/lib/taxAuditForm26Year';

export type TaxAuditChooserView = 'three-cd' | 'form26' | 'checking' | 'year-unknown';

/** The answer of the Form 3CD check, held with the engagement it was asked for. */
export type ThreeCdAuditCheck = { engagementId: string; found: boolean };

export function taxAuditChooserView(input: {
  engagementId: string | null | undefined;
  choice: TaxAuditFormChoice;
  threeCdCheck: ThreeCdAuditCheck | null;
}): TaxAuditChooserView {
  // No engagement: the Form 3CD page says so itself, as today.
  if (!input.engagementId || input.choice === '3cd') return 'three-cd';
  if (input.choice === 'form26') return 'form26';
  // The year is not understood: work already done on Form 3CD stays reachable (decision A10); otherwise the
  // message, and nothing is created.
  const check = input.threeCdCheck;
  if (!check || check.engagementId !== input.engagementId) return 'checking';
  return check.found ? 'three-cd' : 'year-unknown';
}

/**
 * Whether the engagement has a tax audit that is not Form No. 26's (the Form 3CD audit). Reads only. A read
 * that fails counts as "none": the year message is then shown, and nothing is created either way.
 */
export async function hasThreeCdAudit(db: Form26Db, engagementId: string): Promise<boolean> {
  try {
    const { data, error } = (await db
      .from('tax_audit_engagements')
      .select('id')
      .eq('engagement_id', engagementId)
      .neq('statutory_version', TAX_AUDIT_FORM26_STATUTORY_VERSION)
      .execute()) as { data: unknown; error: unknown };
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Whether the engagement holds a Form No. 26 audit (task 26: a year changed back to before 2026-27 shows the
 * Form 3CD screens with a notice that the Form No. 26 draft is kept). Reads only; a failed read counts as "none".
 */
export async function hasForm26Audit(db: Form26Db, engagementId: string): Promise<boolean> {
  try {
    const { data, error } = (await db
      .from('tax_audit_engagements')
      .select('id')
      .eq('engagement_id', engagementId)
      .eq('statutory_version', TAX_AUDIT_FORM26_STATUTORY_VERSION)
      .execute()) as { data: unknown; error: unknown };
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
