import { describe, expect, it } from 'vitest';
import { getGstinValidationError, isValidGstin } from './gstinValidation';

describe('GSTIN validation', () => {
  it('accepts a valid GSTIN structure and checksum', () => {
    expect(isValidGstin('07AABCT1234A1Z2')).toBe(true);
    expect(getGstinValidationError('07AABCT1234A1Z2')).toBeNull();
  });

  it('rejects invalid state codes and structure', () => {
    expect(isValidGstin('00AABCT1234A1Z2')).toBe(false);
    expect(getGstinValidationError('00AABCT1234A1Z2')).toContain('state');
  });

  it('rejects wrong checksum and wrong length with the correct user-facing message', () => {
    const error = getGstinValidationError('07AABCT1234A1Z9');
    expect(isValidGstin('07AABCT1234A1Z9')).toBe(false);
    expect(isValidGstin('07AABCT1234A1Z')).toBe(false);
    expect(error).toContain('Invalid GST Registration Number. Please Check GSTIN and re-enter.');
    expect(error).toContain('Expected Last Character should be');
  });
});
