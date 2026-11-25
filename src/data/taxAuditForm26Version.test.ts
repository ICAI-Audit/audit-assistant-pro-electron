import { describe, expect, it } from 'vitest';
import { TAX_AUDIT_STATUTORY_VERSION } from '@/data/taxAudit3CDClauses';
import {
  TAX_AUDIT_FORM26_CLAUSE_PREFIX,
  TAX_AUDIT_FORM26_LABELS,
  TAX_AUDIT_FORM26_STATUTORY_VERSION,
  TAX_AUDIT_FORM26_WORKPAPER_PREFIX,
} from '@/data/taxAuditForm26Version';
import type { TaxAuditFormType, TaxAuditStatutoryVersion } from '@/types/taxAudit';

describe('Form No. 26 statutory-version key', () => {
  it("the Form 26 key differs from the 3CD key and from the old key 'ITA_1961_RULE_6G_3CA_3CB_3CD'", () => {
    expect(TAX_AUDIT_FORM26_STATUTORY_VERSION).toBe('ITA_2025_FORM_26_RULE_47_NOTIF_22_2026');
    expect(TAX_AUDIT_FORM26_STATUTORY_VERSION).not.toBe(TAX_AUDIT_STATUTORY_VERSION);
    expect(TAX_AUDIT_FORM26_STATUTORY_VERSION).not.toBe('ITA_1961_RULE_6G_3CA_3CB_3CD');
    // the 3CD key itself is as it was
    expect(TAX_AUDIT_STATUTORY_VERSION).toBe('ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025');
  });

  it('the key is assignable to TaxAuditStatutoryVersion', () => {
    // The two typed constants are the test: the type check fails when either key leaves the union.
    const form26Key: TaxAuditStatutoryVersion = TAX_AUDIT_FORM26_STATUTORY_VERSION;
    const threeCdKey: TaxAuditStatutoryVersion = TAX_AUDIT_STATUTORY_VERSION;
    expect(new Set<TaxAuditStatutoryVersion>([form26Key, threeCdKey]).size).toBe(2);
    // the form type keeps its two values (the CHECK of the table): Form 26 adds none
    const formTypes: Record<TaxAuditFormType, true> = { '3CA': true, '3CB': true };
    expect(Object.keys(formTypes)).toEqual(['3CA', '3CB']);
  });

  it('the prefixes and the header labels are the fixed ones', () => {
    expect(TAX_AUDIT_FORM26_CLAUSE_PREFIX).toBe('f26_');
    expect(TAX_AUDIT_FORM26_WORKPAPER_PREFIX).toBe('TA-F26-');
    expect(TAX_AUDIT_FORM26_LABELS).toEqual({ form: 'Form No. 26', act: 'Income-tax Act, 2025', rule: 'Rule 47' });
  });
});
