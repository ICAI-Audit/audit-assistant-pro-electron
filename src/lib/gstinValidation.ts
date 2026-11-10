const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_STATE_CODES = new Set(Array.from({ length: 37 }, (_, index) => index + 1).concat([97]));

export function normalizeGstin(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

export function formatGstinInput(value: string | null | undefined): string {
  return normalizeGstin(value);
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

  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return 'GSTIN format is invalid. Expected: 2-digit state code + 10-char PAN + entity code + Z + checksum.';
  }

  const stateCode = Number(gstin.slice(0, 2));
  if (!VALID_STATE_CODES.has(stateCode)) {
    return 'Invalid GSTIN state code.';
  }

  const pan = gstin.slice(2, 12);
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) {
    return 'The PAN section of the GSTIN is invalid.';
  }

  const entityCode = gstin.charAt(12);
  if (!/^[1-9A-Z]$/.test(entityCode)) {
    return 'The entity code must be 1-9 or A-Z.';
  }

  if (gstin.charAt(13) !== 'Z') {
    return 'The 14th GSTIN character must be Z.';
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
