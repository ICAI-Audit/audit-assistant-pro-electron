import { describe, expect, it } from 'vitest';
import { getTaxAuditStatutoryVersionWarning } from '@/lib/taxAuditStatutoryVersion';

describe('getTaxAuditStatutoryVersionWarning', () => {
  it('does not warn for the supported assessment year', () => {
    expect(getTaxAuditStatutoryVersionWarning('2025-26')).toBe('');
  });

  it('warns when assessment year differs from the configured Form 3CD library', () => {
    expect(getTaxAuditStatutoryVersionWarning('2026-27')).toContain('AY 2026-27');
    expect(getTaxAuditStatutoryVersionWarning('2026-27')).toContain('AY 2025-26');
  });

  it('warns when assessment year is missing', () => {
    expect(getTaxAuditStatutoryVersionWarning('')).toContain('Assessment year is not set');
  });
});
