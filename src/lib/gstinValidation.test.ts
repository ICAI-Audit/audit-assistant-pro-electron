import { describe, expect, it } from 'vitest';
import { getGstinTaxpayerType, getGstinValidationError, isValidGstin } from './gstinValidation';

describe('GSTIN validation', () => {
  it('accepts a valid GSTIN structure and checksum', () => {
    expect(isValidGstin('07AABCT1234A1Z2')).toBe(true);
    expect(getGstinValidationError('07AABCT1234A1Z2')).toBeNull();
  });

  it('rejects invalid state codes and structure', () => {
    expect(isValidGstin('00AABCT1234A1Z2')).toBe(false);
    expect(getGstinValidationError('00AABCT1234A1Z2')).toContain('state');
    expect(getGstinValidationError('07AABCT1234A1!2')).toContain('14th GSTIN character');
    expect(getGstinValidationError('07AABCT1234A1K2')).toContain('14th GSTIN character');
    expect(getGstinValidationError('07AABCT1234AAZ2')).toContain('13th GSTIN character');
  });

  it('rejects wrong checksum and wrong length with the correct user-facing message', () => {
    const error = getGstinValidationError('07AABCT1234A1Z9');
    expect(isValidGstin('07AABCT1234A1Z9')).toBe(false);
    expect(isValidGstin('07AABCT1234A1Z')).toBe(false);
    expect(error).toContain('Invalid GST Registration Number. Please Check GSTIN and re-enter.');
    expect(error).toContain('Expected Last Character should be');
  });

  it('derives taxpayer type from the 14th character', () => {
    expect(getGstinTaxpayerType('07AABCT1234A1S2')).toBe('ISD');
    expect(getGstinTaxpayerType('07AABCT1234A1C2')).toBe('TCS');
    expect(getGstinTaxpayerType('07AABCT1234A1D2')).toBe('TDS');
    expect(getGstinTaxpayerType('07AABCT1234A1K2')).toBeNull();
    expect(getGstinTaxpayerType('072600100001NFT')).toBe('NON_RESIDENT');
    expect(getGstinTaxpayerType('072600100001UIN')).toBe('UN_BODIES');
    expect(getGstinTaxpayerType('072600000001TRP')).toBe('TAX_RETURN_PREPARER');
    expect(getGstinTaxpayerType('072600000001TMP')).toBe('TEMPORARY_ID');
    expect(getGstinTaxpayerType('07AABCT1234A1Z2')).toBe('REGULAR');
  });

  it('validates the special registration layouts shown in the GSTIN structure chart', () => {
    expect(isValidGstin('072600100001NFT')).toBe(true);
    expect(isValidGstin('072600100001UIN')).toBe(true);
    expect(isValidGstin('072600000001TRP')).toBe(true);
    expect(isValidGstin('072600000001TMP')).toBe(true);
    expect(getGstinValidationError('072600100001NFX')).toContain('character 15 must be T');
  });
});
