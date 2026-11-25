const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_STATE_CODES = new Set(Array.from({ length: 37 }, (_, index) => index + 1).concat([97]));
const GSTIN_LOOKUP_URL = 'https://api.e-waybill.in/api/gstin/validate';
const VALID_14TH_CHARACTERS = new Set('123456789ABDEFGHIJSCNRMZ');
const SPECIAL_REGISTRATION_LAYOUTS = {
  F: { digit13: 'N', digit15: 'T', label: 'Non Resident Tax Payer' },
  I: { digit13: 'U', digit15: 'N', label: 'UN Bodies' },
  N: { digit13: 'O', digit15: 'P', label: 'Other Notified Persons' },
  R: { digit13: 'T', digit15: 'P', label: 'Tax Return Preparers' },
  M: { digit13: 'T', digit15: 'P', label: 'Temporary ID' },
};
const TAXPAYER_TYPES_BY_14TH_CHARACTER = {
  S: 'ISD',
  C: 'TCS',
  D: 'TDS',
  F: 'NON_RESIDENT',
  I: 'UN_BODIES',
  R: 'TAX_RETURN_PREPARER',
  M: 'TEMPORARY_ID',
};

function normalizeGstin(value) {
  return (typeof value === 'string' ? value : '').trim().replace(/\s+/g, '').toUpperCase();
}

function getGstinTaxpayerType(value) {
  const gstin = normalizeGstin(value);
  if (gstin.length < 14 || !/^[0-9A-Z]$/.test(gstin[13])) return null;
  if (!VALID_14TH_CHARACTERS.has(gstin[13])) return null;
  return TAXPAYER_TYPES_BY_14TH_CHARACTER[gstin[13]] || 'REGULAR';
}

function calculateCheckDigit(gstin) {
  let total = 0;
  let factor = 2;

  for (let index = 13; index >= 0; index -= 1) {
    const codePoint = GSTIN_CHARSET.indexOf(gstin[index]);
    if (codePoint === -1) return null;

    let digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / GSTIN_CHARSET.length) + (digit % GSTIN_CHARSET.length);
    total += digit;
  }

  return GSTIN_CHARSET[(GSTIN_CHARSET.length - (total % GSTIN_CHARSET.length)) % GSTIN_CHARSET.length];
}

function getGstinValidationError(value) {
  const gstin = normalizeGstin(value);
  if (!gstin) return 'GSTIN is required.';
  if (gstin.length !== 15) return 'GSTIN must be 15 characters long.';
  if (!/^\d{2}/.test(gstin)) return 'The first two GSTIN characters must be the numeric state code.';
  if (!VALID_STATE_CODES.has(Number(gstin.slice(0, 2)))) return 'Invalid GSTIN state code.';

  const taxpayerTypeCode = gstin[13];
  const specialLayout = SPECIAL_REGISTRATION_LAYOUTS[taxpayerTypeCode];
  if (specialLayout) {
    if (!/^\d{10}$/.test(gstin.slice(2, 12))) {
      return `The first ten characters after the state code must be numeric for ${specialLayout.label}.`;
    }
    if (gstin[12] !== specialLayout.digit13 || gstin[14] !== specialLayout.digit15) {
      return `Invalid ${specialLayout.label} format. Character 13 must be ${specialLayout.digit13} and character 15 must be ${specialLayout.digit15}.`;
    }
    return null;
  }

  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(gstin.slice(2, 12))) return 'The PAN section of the GSTIN is invalid.';
  if (!/^[1-9]$/.test(gstin[12])) return 'The 13th GSTIN character must be a digit from 1 to 9.';
  if (!VALID_14TH_CHARACTERS.has(taxpayerTypeCode)) return 'The 14th GSTIN character is not an allowed registration type code.';
  if (!/^[0-9A-Z]$/.test(gstin[14])) return 'The 15th GSTIN character must be the checksum character.';
  if (gstin[14] !== calculateCheckDigit(gstin)) return 'GSTIN checksum is invalid.';
  return null;
}

function getFirstString(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseGstinLookupResponse(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('The GSTIN lookup service returned an unreadable response.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The GSTIN lookup service returned an unexpected response.');
  }

  const details = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const isValid = details.valid !== false && details.isValid !== false;
  if (!isValid) {
    return { valid: false, name: '', message: 'The lookup service did not confirm this GSTIN.' };
  }

  const name = getFirstString(details, ['name', 'legalName', 'legal_name', 'tradeName', 'trade_name']);
  return { valid: true, name, message: null };
}

async function fetchGstinDetails(value, options = {}) {
  const gstin = normalizeGstin(value);
  const validationError = getGstinValidationError(gstin);
  if (validationError) throw new Error(validationError);

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Network requests are unavailable in this runtime.');

  const url = new URL(GSTIN_LOOKUP_URL);
  url.searchParams.set('gstin', gstin);

  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
  });
  if (!response.ok) throw new Error(`GSTIN lookup failed with HTTP ${response.status}.`);

  const details = parseGstinLookupResponse(await response.text());
  return {
    ...details,
    taxpayerType: details.valid ? getGstinTaxpayerType(gstin) : null,
  };
}

function createGstinLookupHandler({ getAuthenticatedUserId, fetchDetails = fetchGstinDetails }) {
  return async (event, payload) => {
    if (!getAuthenticatedUserId(event)) {
      return { success: false, error: 'Authentication required.' };
    }
    if (payload?.consentConfirmed !== true) {
      return { success: false, error: 'Confirm internet lookup consent before continuing.' };
    }

    try {
      return { success: true, data: await fetchDetails(payload.gstin) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GSTIN lookup failed.' };
    }
  };
}

module.exports = {
  calculateCheckDigit,
  createGstinLookupHandler,
  fetchGstinDetails,
  getGstinTaxpayerType,
  getGstinValidationError,
  normalizeGstin,
  parseGstinLookupResponse,
};