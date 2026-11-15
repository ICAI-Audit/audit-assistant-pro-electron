import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { formatConstitution, formatDisplayDate, groupCategories, kindLabel } from './format';
import { MAX_UPLOAD_BYTES, uploadBlocker, validateOwnershipDates, validateUpload } from './validation';

describe('formatDisplayDate', () => {
  it('formats plain dates as dd MMM yyyy without changing the day', () => {
    expect(formatDisplayDate('2022-04-01')).toBe('01 Apr 2022');
    expect(formatDisplayDate('2024-03-31')).toBe('31 Mar 2024');
  });

  it('treats SQLite timestamps as UTC and shows the local date', () => {
    const expected = format(new Date(Date.UTC(2026, 10, 14, 10, 30, 0)), 'dd MMM yyyy');
    expect(formatDisplayDate('2026-11-14 10:30:00')).toBe(expected);
  });

  it('returns empty for missing and the raw text for unparseable values', () => {
    expect(formatDisplayDate(null)).toBe('');
    expect(formatDisplayDate(undefined)).toBe('');
    expect(formatDisplayDate('')).toBe('');
    expect(formatDisplayDate('not a date')).toBe('not a date');
  });
});

describe('formatConstitution and kindLabel', () => {
  it('capitalises stored values and uses registered labels', () => {
    expect(formatConstitution('company')).toBe('Company');
    expect(formatConstitution('partnership')).toBe('Partnership Firm');
    expect(formatConstitution('some_new_type')).toBe('Some new type');
    expect(formatConstitution(null)).toBe('');
  });

  it('falls back to the stored kind', () => {
    expect(kindLabel('director')).toBe('Director');
    expect(kindLabel('mystery')).toBe('mystery');
  });
});

describe('groupCategories', () => {
  it('groups known codes in order and puts unknown codes under Other', () => {
    const groups = groupCategories({ 'PF-02': 'B', 'PF-01': 'A', 'PF-99': 'Z' });
    expect(groups.map((group) => group.label)).toEqual(['Entity and constitution', 'Other']);
    expect(groups[0].options).toEqual([['PF-01', 'A'], ['PF-02', 'B']]);
    expect(groups[1].options).toEqual([['PF-99', 'Z']]);
  });

  it('omits empty groups', () => {
    expect(groupCategories({})).toEqual([]);
  });
});

describe('validateUpload and uploadBlocker', () => {
  it('rejects empty and oversized files with the existing message', () => {
    const message = 'Choose a non-empty document no larger than 25 MiB.';
    expect(validateUpload({ size: 0 })).toBe(message);
    expect(validateUpload({ size: MAX_UPLOAD_BYTES + 1 })).toBe(message);
    expect(validateUpload({ size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(validateUpload({ size: 1 })).toBeNull();
  });

  it('explains why saving is unavailable', () => {
    const file = new File(['x'], 'a.pdf');
    expect(uploadBlocker({ file: null, existingDocumentId: '', name: 'x' })).toBe('Choose a file to enable saving.');
    expect(uploadBlocker({ file, existingDocumentId: '', name: '  ' })).toBe('Enter a document name to enable saving.');
    expect(uploadBlocker({ file, existingDocumentId: 'doc-1', name: '' })).toBeNull();
    expect(uploadBlocker({ file, existingDocumentId: '', name: 'MoA' })).toBeNull();
  });
});

describe('validateOwnershipDates', () => {
  const today = '2026-11-14';

  it('accepts an open record and a proper range', () => {
    expect(validateOwnershipDates({ from: '2022-04-01', until: '', today })).toEqual({});
    expect(validateOwnershipDates({ from: '2022-04-01', until: '2024-03-31', today })).toEqual({});
  });

  it('requires Until to be strictly after From, as the main process does', () => {
    expect(validateOwnershipDates({ from: '2022-04-01', until: '2022-04-01', today }).until).toMatch(/after/);
    expect(validateOwnershipDates({ from: '2022-04-01', until: '2022-03-31', today }).until).toMatch(/after/);
  });

  it('rejects future dates', () => {
    expect(validateOwnershipDates({ from: '2026-11-15', until: '', today }).from).toMatch(/future/);
    expect(validateOwnershipDates({ from: '2022-04-01', until: '2026-11-15', today }).until).toMatch(/future/);
  });
});
