const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_STATE_CODES = new Set(Array.from({ length: 37 }, (_, index) => index + 1).concat([97]));
const VALID_14TH_CHARACTERS = new Set('123456789ABDEFGHIJSCNRMZ');
const SPECIAL_REGISTRATION_LAYOUTS = {
  F: { digit13: 'N', digit15: 'T', label: 'Non Resident Tax Payer' },
  I: { digit13: 'U', digit15: 'N', label: 'UN Bodies' },
  R: { digit13: 'T', digit15: 'P', label: 'Tax Return Preparers' },
  M: { digit13: 'T', digit15: 'P', label: 'Temporary ID' },
} as const;

export type GstinTaxpayerType =
  | 'REGULAR'
  | 'ISD'
  | 'TCS'
  | 'TDS'
  | 'NON_RESIDENT'
  | 'UN_BODIES'
  | 'TAX_RETURN_PREPARER'
  | 'TEMPORARY_ID';

export const GSTIN_TAXPAYER_TYPE_LABELS: Record<GstinTaxpayerType, string> = {
  REGULAR: 'Regular Dealer',
  ISD: 'Input Service Distributor',
  TCS: 'TCS : eCommerce Operator',
  TDS: 'TDS : Government Deductor',
  NON_RESIDENT: 'Non Resident Tax Payer',
  UN_BODIES: 'UN Bodies',
  TAX_RETURN_PREPARER: 'Tax Return Preparers',
  TEMPORARY_ID: 'Temporary ID',
};

const GSTIN_TAXPAYER_TYPE_BY_14TH_CHARACTER: Record<string, GstinTaxpayerType> = {
  S: 'ISD',
  C: 'TCS',
  D: 'TDS',
  F: 'NON_RESIDENT',
  I: 'UN_BODIES',
  R: 'TAX_RETURN_PREPARER',
  M: 'TEMPORARY_ID',
};

export function normalizeGstin(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

export function formatGstinInput(value: string | null | undefined): string {
  return normalizeGstin(value);
}

export function getGstinTaxpayerType(value: string | null | undefined): GstinTaxpayerType | null {
  const gstin = normalizeGstin(value);
  if (gstin.length < 14) return null;
  const code = gstin.charAt(13);
  if (!VALID_14TH_CHARACTERS.has(code)) return null;
  return GSTIN_TAXPAYER_TYPE_BY_14TH_CHARACTER[code] ?? 'REGULAR';
}

export function calculateGstinCheckDigit(gstinWithoutChecksum: string): string {
  const normalized = normalizeGstin(gstinWithoutChecksum).slice(0, 14);

  if (normalized.length !== 14) {
    throw new Error('GSTIN must include the first 14 characters before checksum validation.');
  }

  let total = 0;
  let factor = 2;

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const character = normalized[index];
    const codePoint = GSTIN_CHARSET.indexOf(character);

    if (codePoint === -1) {
      throw new Error(`GSTIN contains an invalid character: ${character}`);
    }

    let digit = factor * codePoint;
    if (factor === 2) {
      factor = 1;
    } else {
      factor = 2;
    }

    digit = Math.floor(digit / GSTIN_CHARSET.length) + (digit % GSTIN_CHARSET.length);
    total += digit;
  }

  const checkCodePoint = ((GSTIN_CHARSET.length - (total % GSTIN_CHARSET.length)) % GSTIN_CHARSET.length);
  return GSTIN_CHARSET[checkCodePoint];
}

export function getGstinValidationError(value: string | null | undefined): string | null {
  const gstin = normalizeGstin(value);

  if (!gstin) {
    return 'GSTIN is required.';
  }

  if (gstin.length !== 15) {
    return 'GSTIN must be 15 characters long.';
  }

  if (!/^\d{2}/.test(gstin)) {
    return 'The first two GSTIN characters must be the numeric state code.';
  }

  const stateCode = Number(gstin.slice(0, 2));
  if (!VALID_STATE_CODES.has(stateCode)) {
    return 'Invalid GSTIN state code.';
  }

  const taxpayerTypeCode = gstin.charAt(13);
  const specialLayout = SPECIAL_REGISTRATION_LAYOUTS[taxpayerTypeCode as keyof typeof SPECIAL_REGISTRATION_LAYOUTS];
  if (specialLayout) {
    if (!/^\d{10}$/.test(gstin.slice(2, 12))) {
      return `The first ten characters after the state code must be numeric for ${specialLayout.label}.`;
    }
    if (gstin.charAt(12) !== specialLayout.digit13 || gstin.charAt(14) !== specialLayout.digit15) {
      return `Invalid ${specialLayout.label} format. Character 13 must be ${specialLayout.digit13} and character 15 must be ${specialLayout.digit15}.`;
    }
    return null;
  }

  const pan = gstin.slice(2, 12);
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) {
    return 'The PAN section of the GSTIN is invalid.';
  }

  if (!/^[1-9]$/.test(gstin.charAt(12))) {
    return 'The 13th GSTIN character must be a digit from 1 to 9.';
  }

  if (!VALID_14TH_CHARACTERS.has(taxpayerTypeCode)) {
    return 'The 14th GSTIN character is not an allowed registration type code.';
  }

  if (!/^[0-9A-Z]$/.test(gstin.charAt(14))) {
    return 'The 15th GSTIN character must be the checksum character.';
  }

  const expectedChecksum = calculateGstinCheckDigit(gstin);
  if (gstin.charAt(14) !== expectedChecksum) {
    return `Invalid GST Registration Number. Please Check GSTIN and re-enter.\nExpected Last Character should be ${expectedChecksum}.`;
  }

  return null;
}

export function isValidGstin(value: string | null | undefined): boolean {
  return getGstinValidationError(value) === null;
}
