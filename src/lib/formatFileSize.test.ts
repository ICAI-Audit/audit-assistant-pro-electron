import { describe, expect, it } from 'vitest';
import { formatFileSize } from './formatFileSize';

describe('formatFileSize', () => {
  it('shows bytes below one KiB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('uses one decimal below 10 and none above', () => {
    expect(formatFileSize(1024)).toBe('1 KiB');
    expect(formatFileSize(1536)).toBe('1.5 KiB');
    expect(formatFileSize(15 * 1024)).toBe('15 KiB');
  });

  it('rolls over to MiB and stops at GiB', () => {
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MiB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GiB');
    expect(formatFileSize(2048 * 1024 * 1024 * 1024)).toBe('2048 GiB');
  });
});
