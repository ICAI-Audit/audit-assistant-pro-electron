import { TAX_AUDIT_DISCLAIMER_VERSION } from '@/data/taxAuditDisclaimers';

export type TaxAuditDisclaimerAcknowledgement = {
  accepted: boolean;
  accepted_by: string;
  accepted_at: string;
  version: typeof TAX_AUDIT_DISCLAIMER_VERSION;
};

export type SaveTaxAuditDisclaimerInput = {
  currentSetupJson?: string | null;
  acknowledgement: TaxAuditDisclaimerAcknowledgement;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const parseSetupJson = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const buildDefaultTaxAuditDisclaimerAcknowledgement = (): TaxAuditDisclaimerAcknowledgement => ({
  accepted: false,
  accepted_by: '',
  accepted_at: '',
  version: TAX_AUDIT_DISCLAIMER_VERSION,
});

export const normalizeTaxAuditDisclaimerAcknowledgement = (
  value: unknown
): TaxAuditDisclaimerAcknowledgement => {
  const fallback = buildDefaultTaxAuditDisclaimerAcknowledgement();
  const raw = isPlainObject(value) ? value : {};
  const accepted = raw.accepted === true;

  return {
    accepted,
    accepted_by: accepted && typeof raw.accepted_by === 'string' ? raw.accepted_by : '',
    accepted_at: accepted && typeof raw.accepted_at === 'string' ? raw.accepted_at : '',
    version:
      raw.version === TAX_AUDIT_DISCLAIMER_VERSION
        ? TAX_AUDIT_DISCLAIMER_VERSION
        : fallback.version,
  };
};

export const buildTaxAuditDisclaimerSetupJson = ({
  currentSetupJson,
  acknowledgement,
}: SaveTaxAuditDisclaimerInput) => {
  const setupJson = parseSetupJson(currentSetupJson);

  return JSON.stringify({
    ...setupJson,
    disclaimerAcknowledgement: {
      accepted: acknowledgement.accepted,
      accepted_by: acknowledgement.accepted_by,
      accepted_at: acknowledgement.accepted_at,
      version: TAX_AUDIT_DISCLAIMER_VERSION,
    },
  });
};
