import { describe, expect, it } from 'vitest';
import { TAX_AUDIT_DISCLAIMER_VERSION } from '@/data/taxAuditDisclaimers';
import {
  buildTaxAuditDisclaimerSetupJson,
  normalizeTaxAuditDisclaimerAcknowledgement,
} from '@/lib/taxAuditDisclaimer';

describe('taxAuditDisclaimer', () => {
  it('normalizes missing or malformed acknowledgement safely', () => {
    expect(normalizeTaxAuditDisclaimerAcknowledgement(undefined)).toEqual({
      accepted: false,
      accepted_by: '',
      accepted_at: '',
      version: TAX_AUDIT_DISCLAIMER_VERSION,
    });

    expect(normalizeTaxAuditDisclaimerAcknowledgement({ accepted: 'yes', accepted_by: 1 })).toEqual({
      accepted: false,
      accepted_by: '',
      accepted_at: '',
      version: TAX_AUDIT_DISCLAIMER_VERSION,
    });
  });

  it('saves acknowledgement while preserving existing setup sections', () => {
    const nextSetupJson = buildTaxAuditDisclaimerSetupJson({
      currentSetupJson: JSON.stringify({
        applicabilityInputs: { business_turnover: 20_000_000 },
        auditProgramme: { items: { planning: { status: 'Reviewed' } } },
        complianceTracker: { due_date_for_return: '2025-10-31' },
        customSection: { keep: true },
      }),
      acknowledgement: {
        accepted: true,
        accepted_by: 'Reviewer',
        accepted_at: '2025-09-30T00:00:00.000Z',
        version: TAX_AUDIT_DISCLAIMER_VERSION,
      },
    });

    const parsed = JSON.parse(nextSetupJson);

    expect(parsed.applicabilityInputs).toEqual({ business_turnover: 20_000_000 });
    expect(parsed.auditProgramme).toEqual({ items: { planning: { status: 'Reviewed' } } });
    expect(parsed.complianceTracker).toEqual({ due_date_for_return: '2025-10-31' });
    expect(parsed.customSection).toEqual({ keep: true });
    expect(parsed.disclaimerAcknowledgement).toEqual({
      accepted: true,
      accepted_by: 'Reviewer',
      accepted_at: '2025-09-30T00:00:00.000Z',
      version: TAX_AUDIT_DISCLAIMER_VERSION,
    });
  });
});
